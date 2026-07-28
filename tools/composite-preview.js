#!/usr/bin/env node
'use strict';
// Offline preview of Roblox's avatar clothing composite.
//
// Runs the SAME algorithm renderer/js/clothing.js uses (Roblox's own compositing meshes, where a
// vertex position is a destination pixel and its UV samples the source template) but in plain
// Node with a software rasteriser, writing a PNG out. That makes the compositor inspectable and
// iterable without launching the app, which is how the coordinate conventions below were pinned
// down rather than guessed.
//
//   node tools/composite-preview.js <shirt.png> <pants.png> <out.png>
//
// Any argument may be "-" to skip that layer.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parseMesh } = require('../src/lib/rbxmesh');
const { readPng } = require('./png-probe');

// ---------------------------------------------------------------- local Roblox content
function findContentDir() {
  const roots = [
    path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'Versions'),
    'C:/Program Files (x86)/Roblox/Versions',
    'C:/Program Files/Roblox/Versions',
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const v of fs.readdirSync(root)) {
      const dir = path.join(root, v, 'content');
      if (fs.existsSync(path.join(dir, 'avatar', 'heads', 'head.mesh'))) return dir;
    }
  }
  return null;
}
const CONTENT = findContentDir();
const loadMesh = (rel) => parseMesh(fs.readFileSync(path.join(CONTENT, rel)));

// ---------------------------------------------------------------- PNG writing
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePng(file, width, height, rgba) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// ---------------------------------------------------------------- rasteriser
// Barycentric fill with nearest-neighbour sampling. Nearest, not bilinear, because the composite
// is a 1:1-ish blit and bilinear would soften Roblox's hard template edges.
function rasterise(dst, dw, dh, src, tri) {
  const [p0, p1, p2] = tri; // each: { x, y, u, v } — x/y destination px, u/v source px
  const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
  const maxX = Math.min(dw - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
  const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
  const maxY = Math.min(dh - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));
  const det = (p1.y - p2.y) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.y - p2.y);
  if (Math.abs(det) < 1e-12) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      let a = ((p1.y - p2.y) * (px - p2.x) + (p2.x - p1.x) * (py - p2.y)) / det;
      let b = ((p2.y - p0.y) * (px - p2.x) + (p0.x - p2.x) * (py - p2.y)) / det;
      let c = 1 - a - b;
      const EPS = -0.002; // a hair of overlap, so neighbouring triangles leave no seam
      if (a < EPS || b < EPS || c < EPS) continue;
      a = Math.max(0, a); b = Math.max(0, b); c = Math.max(0, c);
      const su = Math.round(a * p0.u + b * p1.u + c * p2.u);
      const sv = Math.round(a * p0.v + b * p1.v + c * p2.v);
      if (su < 0 || sv < 0 || su >= src.width || sv >= src.height) continue;
      const s = (sv * src.width + su) * 4;
      if (src.rgba[s + 3] === 0) continue; // transparent template pixel: leave what's underneath
      const d = (y * dw + x) * 4;
      dst[d] = src.rgba[s]; dst[d + 1] = src.rgba[s + 1];
      dst[d + 2] = src.rgba[s + 2]; dst[d + 3] = 255;
    }
  }
}

// Run one compositing mesh. `flipDestY` and `flipSrcV` are the two conventions that had to be
// resolved empirically; see the notes in clothing.js.
function runMesh(dst, dw, dh, src, mesh, opts = {}) {
  const { positions: p, uvs: u, indices: idx } = mesh;
  const { flipDestY = false, flipSrcV = false, zFilter = null } = opts;
  let drawn = 0;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const ids = [idx[t], idx[t + 1], idx[t + 2]];
    if (zFilter !== null && !ids.every((i) => zFilter(p[i * 3 + 2]))) continue;
    const tri = ids.map((i) => ({
      x: p[i * 3],
      y: flipDestY ? dh - p[i * 3 + 1] : p[i * 3 + 1],
      u: u[i * 2] * src.width,
      v: (flipSrcV ? 1 - u[i * 2 + 1] : u[i * 2 + 1]) * src.height,
    }));
    rasterise(dst, dw, dh, src, tri);
    drawn++;
  }
  return drawn;
}

// ---------------------------------------------------------------- main
function main() {
  const [shirtPath, pantsPath, outPath, mode] = process.argv.slice(2);
  if (!CONTENT) { console.error('No local Roblox content directory found'); process.exit(1); }
  if (!outPath) {
    console.error('usage: node tools/composite-preview.js <shirt.png|-> <pants.png|-> <out.png> [mode]');
    process.exit(1);
  }
  const W = 1024, H = 512;
  const dst = Buffer.alloc(W * H * 4); // transparent

  // Independent flags, spelled out, because these were the two conventions that had to be
  // resolved empirically and conflating them hid the correct combination.
  const flags = new Set((mode || '').split('+'));
  const flipDestY = flags.has('flipY');
  const flipSrcV = flags.has('flipV');

  const layers = [];
  if (pantsPath && pantsPath !== '-') layers.push(['avatar/compositing/CompositPantsTemplate.mesh', pantsPath]);
  if (shirtPath && shirtPath !== '-') layers.push(['avatar/compositing/CompositShirtTemplate.mesh', shirtPath]);

  for (const [meshRel, imgPath] of layers) {
    const mesh = loadMesh(meshRel);
    const img = readPng(imgPath);
    const n = runMesh(dst, W, H, img, mesh, { flipDestY, flipSrcV });
    console.error(`${path.basename(meshRel)}: ${n} triangles, source ${img.width}x${img.height}`);
  }

  writePng(outPath, W, H, dst);
  console.error(`wrote ${outPath} (${W}x${H}) flipDestY=${flipDestY} flipSrcV=${flipSrcV}`);
}

main();
