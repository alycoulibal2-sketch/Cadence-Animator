#!/usr/bin/env node
'use strict';
// Minimal PNG reader for measuring rendered output instead of eyeballing it.
//
//   node tools/png-probe.js <file.png> info
//   node tools/png-probe.js <file.png> px <x> <y> [radius]     average RGBA around a pixel
//   node tools/png-probe.js <file.png> bbox [alphaThreshold]   bounds of non-transparent content
//
// Supports the colour types Roblox assets and Electron screenshots actually use (8-bit RGB,
// RGBA, greyscale, greyscale+alpha, and paletted), non-interlaced. Enough to answer "how big is
// the smiley inside face.png" and "what colour is this surface actually rendering at".

const fs = require('fs');
const zlib = require('zlib');

function readPng(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
  if (interlace) throw new Error('interlaced PNGs not supported');
  const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!CHANNELS) throw new Error(`unsupported colour type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = CHANNELS;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride); rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = (prev && i >= bpp) ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
  }

  // normalise everything to RGBA
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const s = i * bpp, d = i * 4;
    let r, g, b, a = 255;
    if (colorType === 0) { r = g = b = out[s]; }
    else if (colorType === 2) { r = out[s]; g = out[s + 1]; b = out[s + 2]; }
    else if (colorType === 3) {
      const ix = out[s];
      r = palette[ix * 3]; g = palette[ix * 3 + 1]; b = palette[ix * 3 + 2];
      if (trns && ix < trns.length) a = trns[ix];
    } else if (colorType === 4) { r = g = b = out[s]; a = out[s + 1]; }
    else { r = out[s]; g = out[s + 1]; b = out[s + 2]; a = out[s + 3]; }
    rgba[d] = r; rgba[d + 1] = g; rgba[d + 2] = b; rgba[d + 3] = a;
  }
  return { width, height, colorType, rgba };
}

function main() {
  const [file, cmd = 'info', ...rest] = process.argv.slice(2);
  if (!file) { console.error('usage: node tools/png-probe.js <file.png> [info|px x y [r]|bbox [alpha]]'); process.exit(1); }
  const img = readPng(file);
  if (cmd === 'info') {
    console.log(`${img.width}x${img.height} colourType=${img.colorType}`);
    return;
  }
  if (cmd === 'px') {
    const x = +rest[0], y = +rest[1], rad = rest[2] === undefined ? 0 : +rest[2];
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let j = y - rad; j <= y + rad; j++) {
      for (let i = x - rad; i <= x + rad; i++) {
        if (i < 0 || j < 0 || i >= img.width || j >= img.height) continue;
        const d = (j * img.width + i) * 4;
        r += img.rgba[d]; g += img.rgba[d + 1]; b += img.rgba[d + 2]; a += img.rgba[d + 3]; n++;
      }
    }
    console.log(JSON.stringify({ x, y, rgba: [r / n, g / n, b / n, a / n].map((v) => Math.round(v)) }));
    return;
  }
  if (cmd === 'bbox') {
    const thresh = rest[0] === undefined ? 8 : +rest[0];
    let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (img.rgba[(y * img.width + x) * 4 + 3] > thresh) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    console.log(JSON.stringify({
      size: [img.width, img.height],
      bbox: [x0, y0, x1, y1],
      contentSize: [x1 - x0 + 1, y1 - y0 + 1],
      fractionOfImage: [+((x1 - x0 + 1) / img.width).toFixed(4), +((y1 - y0 + 1) / img.height).toFixed(4)],
      centreOffset: [+(((x0 + x1) / 2 - img.width / 2) / img.width).toFixed(4), +(((y0 + y1) / 2 - img.height / 2) / img.height).toFixed(4)],
    }));
    return;
  }
  console.error('unknown command ' + cmd);
  process.exit(1);
}

module.exports = { readPng };

if (require.main === module) main();
