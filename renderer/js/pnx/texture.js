// PNX textures (spec Part 17): a 2D raster type, and the image operations that work on it.
//
// PART 17'S PREMISE: "Cadence must not require every visual texture to come from a library." So a
// texture here is something a graph can BUILD — from noise, from patterns, from an SDF, from maths —
// and then blur, warp, threshold, edge-detect and bake. That is what makes a flipbook, a normal map or
// a gradient ramp authorable rather than sourced.
//
// A TEXTURE IS A FIELD PLUS A RESOLUTION, and the distinction matters more than it sounds:
//
//   a FIELD is continuous and lazy — infinite resolution, evaluated where you ask
//   a TEXTURE is discrete and eager — a fixed grid of pixels, evaluated once
//
// Both exist because each is right for different work. Noise driving a particle colour should stay a
// field: sampling it at 10 000 particle positions is exactly right and rasterising it first would
// quantise it for nothing. But BLUR needs neighbours, EDGE DETECT needs neighbours, and DILATE needs
// neighbours — and "neighbour" is meaningless in a continuous field. Those operations need a grid.
//
// So `Rasterize` is the explicit, visible moment a field becomes pixels, and `Sample Texture` is the
// moment pixels become a field again. Making both explicit is what keeps the cost legible: a user can
// see where the resolution was fixed, rather than discovering that a chain silently rasterised at 64x64
// somewhere in the middle.
//
// STORAGE is RGBA Float32, not 8-bit. Emission above 1 is normal in VFX, an intermediate that clamps to
// 1 loses the highlights a bloom pass needs, and a height map wants signed values. The memory cost is
// 4x an 8-bit buffer and worth it; the export path quantises at the boundary where it must.

import * as V from './values.js';
import * as F from './fields.js';

export const MAX_RESOLUTION = 2048;   // 2048^2 RGBA float32 is 64 MB — the point where this stops being
                                      // a reasonable thing to hold several of in a graph.
export const DEFAULT_RESOLUTION = 256;

export const WRAP_MODES = ['repeat', 'clamp', 'mirror'];
export const FILTER_MODES = ['linear', 'nearest'];

// ---------------------------------------------------------------- construction
export function newTexture(width, height = width, { wrap = 'repeat', filter = 'linear' } = {}) {
  const w = Math.max(1, Math.min(MAX_RESOLUTION, Math.round(width)));
  const h = Math.max(1, Math.min(MAX_RESOLUTION, Math.round(height)));
  return {
    __texture: true,
    width: w, height: h,
    wrap: WRAP_MODES.includes(wrap) ? wrap : 'repeat',
    filter: FILTER_MODES.includes(filter) ? filter : 'linear',
    data: new Float32Array(w * h * 4),
  };
}

export const isTexture = (v) => !!v && v.__texture === true;

export function cloneTexture(tex) {
  if (!isTexture(tex)) return null;
  const out = newTexture(tex.width, tex.height, tex);
  out.data.set(tex.data);
  return out;
}

// A texture whose every pixel is the same colour — the sane default for an unconnected texture input,
// because a zero-filled one is transparent black and reads as "the node is broken".
export function solidTexture(color = [1, 1, 1, 1], size = 4) {
  const t = newTexture(size);
  const c = V.toComponents('color', color);
  for (let i = 0; i < t.width * t.height; i++) {
    t.data[i * 4] = c[0]; t.data[i * 4 + 1] = c[1]; t.data[i * 4 + 2] = c[2]; t.data[i * 4 + 3] = c[3];
  }
  return t;
}

// ---------------------------------------------------------------- addressing
// Wrap a coordinate into range. `mirror` is worth having rather than being an exotic option: it is the
// only wrap mode that makes a non-tiling texture tile without a visible seam, which is most of what
// wrapping is for.
function wrapCoord(v, n, mode) {
  if (mode === 'clamp') return Math.max(0, Math.min(n - 1, v));
  if (mode === 'mirror') {
    const period = 2 * n;
    let m = ((v % period) + period) % period;
    return m < n ? m : period - 1 - m;
  }
  return ((v % n) + n) % n;
}

export function getPixel(tex, x, y, into = [0, 0, 0, 0]) {
  const px = wrapCoord(Math.floor(x), tex.width, tex.wrap);
  const py = wrapCoord(Math.floor(y), tex.height, tex.wrap);
  const base = (py * tex.width + px) * 4;
  into[0] = tex.data[base]; into[1] = tex.data[base + 1];
  into[2] = tex.data[base + 2]; into[3] = tex.data[base + 3];
  return into;
}

export function setPixel(tex, x, y, rgba) {
  if (x < 0 || y < 0 || x >= tex.width || y >= tex.height) return;
  const base = (Math.floor(y) * tex.width + Math.floor(x)) * 4;
  tex.data[base] = rgba[0] || 0;
  tex.data[base + 1] = rgba[1] || 0;
  tex.data[base + 2] = rgba[2] || 0;
  tex.data[base + 3] = rgba[3] === undefined ? 1 : rgba[3];
}

// Sample at normalised UV. The half-pixel offset is the detail that is always wrong the first time: a
// texel's colour belongs at its CENTRE, so uv 0 is half a texel in, not on the boundary. Without it a
// linear sample of a 2x2 texture reads as a quarter-pixel-shifted blur of itself.
export function sampleTexture(tex, u, v, into = [0, 0, 0, 0]) {
  if (!isTexture(tex)) { into[0] = into[1] = into[2] = into[3] = 0; return into; }
  const x = u * tex.width - 0.5;
  const y = v * tex.height - 0.5;
  if (tex.filter === 'nearest') return getPixel(tex, Math.round(x), Math.round(y), into);

  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const a = getPixel(tex, x0, y0, [0, 0, 0, 0]);
  const b = getPixel(tex, x0 + 1, y0, [0, 0, 0, 0]);
  const c = getPixel(tex, x0, y0 + 1, [0, 0, 0, 0]);
  const d = getPixel(tex, x0 + 1, y0 + 1, [0, 0, 0, 0]);
  for (let k = 0; k < 4; k++) {
    const top = a[k] + (b[k] - a[k]) * fx;
    const bot = c[k] + (d[k] - c[k]) * fx;
    into[k] = top + (bot - top) * fy;
  }
  return into;
}

// A texture as a `field<color>`, sampled by the element's UV. This is the bridge back to the rest of the
// engine: once a texture is a field, every colour node applies to it.
export function textureAsField(tex) {
  const scratch = [0, 0, 0, 0];
  return F.makeField('color', (ctx) => {
    const uv = ctx.uv || [0, 0];
    sampleTexture(tex, uv[0], uv[1], scratch);
    return [scratch[0], scratch[1], scratch[2], scratch[3]];
  });
}

// ---------------------------------------------------------------- rasterisation
// Evaluate a field over a grid. The sample context gives each pixel its `uv` AND a `position` on the
// z=0 plane spanning -1..1, so a field built for 3D space (noise, an SDF) rasterises sensibly without
// the user having to convert coordinates by hand — which is the single most annoying part of doing this
// in other systems.
export function rasterize(field, width, height = width, { wrap = 'repeat', filter = 'linear', extent = 1, time = 0 } = {}) {
  const tex = newTexture(width, height, { wrap, filter });
  const ctx = F.newSampleContext({ time });
  const uv = [0, 0];
  const pos = [0, 0, 0];
  ctx.uv = uv;
  ctx.position = pos;

  for (let y = 0; y < tex.height; y++) {
    for (let x = 0; x < tex.width; x++) {
      uv[0] = (x + 0.5) / tex.width;
      uv[1] = (y + 0.5) / tex.height;
      pos[0] = (uv[0] * 2 - 1) * extent;
      pos[1] = (uv[1] * 2 - 1) * extent;
      pos[2] = 0;
      ctx.index = y * tex.width + x;
      const v = F.sampleAny(field, ctx);
      const base = (y * tex.width + x) * 4;
      if (typeof v === 'number') {
        tex.data[base] = tex.data[base + 1] = tex.data[base + 2] = v;
        tex.data[base + 3] = 1;
      } else if (typeof v === 'boolean') {
        const b = v ? 1 : 0;
        tex.data[base] = tex.data[base + 1] = tex.data[base + 2] = b;
        tex.data[base + 3] = 1;
      } else {
        const c = V.toComponents('color', v);
        tex.data[base] = c[0]; tex.data[base + 1] = c[1];
        tex.data[base + 2] = c[2]; tex.data[base + 3] = c[3] === undefined ? 1 : c[3];
      }
    }
  }
  return tex;
}

// ---------------------------------------------------------------- per-pixel operations
export function mapTexture(tex, fn) {
  const out = cloneTexture(tex);
  if (!out) return null;
  const px = [0, 0, 0, 0];
  for (let i = 0; i < out.width * out.height; i++) {
    const base = i * 4;
    px[0] = out.data[base]; px[1] = out.data[base + 1]; px[2] = out.data[base + 2]; px[3] = out.data[base + 3];
    const r = fn(px, i % out.width, Math.floor(i / out.width));
    out.data[base] = r[0]; out.data[base + 1] = r[1]; out.data[base + 2] = r[2]; out.data[base + 3] = r[3];
  }
  return out;
}

// Combine two textures. Where the sizes differ, `b` is SAMPLED at `a`'s resolution rather than either
// being resized — so blending a 1024 detail map onto a 256 base does not silently upscale the base.
export function zipTextures(a, b, fn) {
  if (!isTexture(a)) return cloneTexture(b);
  if (!isTexture(b)) return cloneTexture(a);
  const out = cloneTexture(a);
  const pa = [0, 0, 0, 0], pb = [0, 0, 0, 0];
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const base = (y * out.width + x) * 4;
      pa[0] = a.data[base]; pa[1] = a.data[base + 1]; pa[2] = a.data[base + 2]; pa[3] = a.data[base + 3];
      sampleTexture(b, (x + 0.5) / out.width, (y + 0.5) / out.height, pb);
      const r = fn(pa, pb);
      out.data[base] = r[0]; out.data[base + 1] = r[1]; out.data[base + 2] = r[2]; out.data[base + 3] = r[3];
    }
  }
  return out;
}

// ---------------------------------------------------------------- neighbourhood operations
// The reason textures exist as a distinct type. Every one of these needs to look at adjacent pixels,
// which a continuous field cannot express.

// Separable Gaussian blur: a horizontal pass then a vertical one. Separating it turns an O(r^2) kernel
// into O(2r), which at radius 16 is 32 taps per pixel instead of 1089 — the difference between usable
// and not.
export function blurTexture(tex, radius) {
  if (!isTexture(tex) || !(radius > 0)) return cloneTexture(tex);
  const r = Math.max(1, Math.min(64, Math.round(radius)));
  const sigma = r / 2;
  const kernel = [];
  let sum = 0;
  for (let k = -r; k <= r; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel.push(w);
    sum += w;
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;

  const pass = (src, dx, dy) => {
    const dst = newTexture(src.width, src.height, src);
    const px = [0, 0, 0, 0];
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        let a = 0, b = 0, c = 0, d = 0;
        for (let k = -r; k <= r; k++) {
          getPixel(src, x + dx * k, y + dy * k, px);
          const w = kernel[k + r];
          a += px[0] * w; b += px[1] * w; c += px[2] * w; d += px[3] * w;
        }
        const base = (y * src.width + x) * 4;
        dst.data[base] = a; dst.data[base + 1] = b; dst.data[base + 2] = c; dst.data[base + 3] = d;
      }
    }
    return dst;
  };
  return pass(pass(tex, 1, 0), 0, 1);
}

// Morphological dilate/erode on the alpha channel, carrying colour with it. `sign` +1 dilates (grow),
// -1 erodes (shrink). Used for outlines, for closing gaps in a mask, and for the "grow then subtract"
// pair that produces a border.
export function morphTexture(tex, radius, sign = 1) {
  if (!isTexture(tex) || !(radius > 0)) return cloneTexture(tex);
  const r = Math.max(1, Math.min(32, Math.round(radius)));
  const out = newTexture(tex.width, tex.height, tex);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < tex.height; y++) {
    for (let x = 0; x < tex.width; x++) {
      let bestA = sign > 0 ? -Infinity : Infinity;
      let best = [0, 0, 0, 0];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;   // a round kernel, so a dilate does not read as square
          getPixel(tex, x + dx, y + dy, px);
          if (sign > 0 ? px[3] > bestA : px[3] < bestA) { bestA = px[3]; best = [px[0], px[1], px[2], px[3]]; }
        }
      }
      const base = (y * tex.width + x) * 4;
      out.data[base] = best[0]; out.data[base + 1] = best[1];
      out.data[base + 2] = best[2]; out.data[base + 3] = best[3];
    }
  }
  return out;
}

// Sobel edge magnitude on luminance. Written to all three colour channels plus alpha, so the result is
// usable as a mask directly rather than needing a channel pick.
export function edgeTexture(tex, strength = 1) {
  if (!isTexture(tex)) return null;
  const out = newTexture(tex.width, tex.height, tex);
  const px = [0, 0, 0, 0];
  const lum = (x, y) => { getPixel(tex, x, y, px); return V.luminance(px); };
  for (let y = 0; y < tex.height; y++) {
    for (let x = 0; x < tex.width; x++) {
      const gx = (lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1))
        - (lum(x - 1, y - 1) + 2 * lum(x - 1, y) + lum(x - 1, y + 1));
      const gy = (lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1))
        - (lum(x - 1, y - 1) + 2 * lum(x, y - 1) + lum(x + 1, y - 1));
      const m = Math.min(1, Math.sqrt(gx * gx + gy * gy) * strength);
      const base = (y * tex.width + x) * 4;
      out.data[base] = out.data[base + 1] = out.data[base + 2] = m;
      out.data[base + 3] = 1;
    }
  }
  return out;
}

// A normal map from a height field. The cross product of the two surface tangents, which is the correct
// derivation rather than the "pack the gradient and hope" version — and it is why `strength` scales the
// height rather than the resulting normal: scaling the normal afterwards denormalises it.
export function normalFromHeight(tex, strength = 1) {
  if (!isTexture(tex)) return null;
  const out = newTexture(tex.width, tex.height, tex);
  const px = [0, 0, 0, 0];
  const h = (x, y) => { getPixel(tex, x, y, px); return V.luminance(px) * strength; };
  for (let y = 0; y < tex.height; y++) {
    for (let x = 0; x < tex.width; x++) {
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const nrm = V.vNormalize([-dx, -dy, 2 / Math.max(1, tex.width) * 2]);
      const base = (y * tex.width + x) * 4;
      // Packed into 0..1, the convention every renderer expects of a normal map.
      out.data[base] = nrm[0] * 0.5 + 0.5;
      out.data[base + 1] = nrm[1] * 0.5 + 0.5;
      out.data[base + 2] = nrm[2] * 0.5 + 0.5;
      out.data[base + 3] = 1;
    }
  }
  return out;
}

// Warp: displace each pixel's SOURCE coordinate by a vector read from another texture. Reading the
// offset from a texture rather than from a field is deliberate — the offsets have to be at the same
// resolution as the thing being warped, or the warp shows the offset map's own texel grid.
export function warpTexture(tex, offsetTex, amount = 0.1) {
  if (!isTexture(tex)) return null;
  const out = newTexture(tex.width, tex.height, tex);
  const off = [0, 0, 0, 0], px = [0, 0, 0, 0];
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const u = (x + 0.5) / out.width, v = (y + 0.5) / out.height;
      if (isTexture(offsetTex)) sampleTexture(offsetTex, u, v, off);
      // Offsets are signed, so a 0..1 texture is remapped to -1..1 — otherwise a neutral grey offset map
      // would displace everything by half the amount instead of leaving it alone.
      sampleTexture(tex, u + (off[0] * 2 - 1) * amount, v + (off[1] * 2 - 1) * amount, px);
      const base = (y * out.width + x) * 4;
      out.data[base] = px[0]; out.data[base + 1] = px[1]; out.data[base + 2] = px[2]; out.data[base + 3] = px[3];
    }
  }
  return out;
}

// Resample to a new resolution. Bilinear on the way down is a box-ish filter and will alias on a big
// reduction; that is stated rather than silently mitigated, because a proper mip chain is a different
// piece of work and pretending otherwise would be the fake-feature trap.
export function resizeTexture(tex, width, height = width) {
  if (!isTexture(tex)) return null;
  const out = newTexture(width, height, tex);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      sampleTexture(tex, (x + 0.5) / out.width, (y + 0.5) / out.height, px);
      const base = (y * out.width + x) * 4;
      out.data[base] = px[0]; out.data[base + 1] = px[1]; out.data[base + 2] = px[2]; out.data[base + 3] = px[3];
    }
  }
  return out;
}

// ---------------------------------------------------------------- flipbooks (Part 58)
// An atlas built by rasterising a field at N points in time. This is what turns a simulation or an
// animated noise into something Roblox can actually play, because a ParticleEmitter can read a flipbook
// and cannot read a field.
export function bakeFlipbook(rasterizeAt, { columns = 4, rows = 4, cellSize = 128, duration = 1 } = {}) {
  const cols = Math.max(1, Math.min(16, Math.round(columns)));
  const rws = Math.max(1, Math.min(16, Math.round(rows)));
  const cell = Math.max(8, Math.min(512, Math.round(cellSize)));
  const sheet = newTexture(cols * cell, rws * cell, { wrap: 'clamp' });
  const frames = cols * rws;
  const px = [0, 0, 0, 0];

  for (let i = 0; i < frames; i++) {
    const t = frames === 1 ? 0 : (i / frames) * duration;
    const frame = rasterizeAt(t, cell);
    if (!isTexture(frame)) continue;
    const cx = (i % cols) * cell;
    const cy = Math.floor(i / cols) * cell;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        sampleTexture(frame, (x + 0.5) / cell, (y + 0.5) / cell, px);
        setPixel(sheet, cx + x, cy + y, px);
      }
    }
  }
  return { sheet, columns: cols, rows: rws, cellSize: cell, frames };
}

// ---------------------------------------------------------------- output
// A texture as 8-bit RGBA, for handing to a canvas, a PNG encoder or an upload. This is the one place
// the float pipeline is quantised, and values above 1 clamp HERE rather than earlier — which is the
// whole reason the intermediate is float.
export function toBytes(tex) {
  if (!isTexture(tex)) return null;
  const out = new Uint8ClampedArray(tex.width * tex.height * 4);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(V.clamp01(tex.data[i]) * 255);
  return { width: tex.width, height: tex.height, data: out };
}

export function describeTexture(tex) {
  if (!isTexture(tex)) return { empty: true };
  let min = Infinity, max = -Infinity, sumA = 0;
  for (let i = 0; i < tex.width * tex.height; i++) {
    for (let k = 0; k < 3; k++) {
      const v = tex.data[i * 4 + k];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    sumA += tex.data[i * 4 + 3];
  }
  const pixels = tex.width * tex.height;
  return {
    width: tex.width, height: tex.height,
    wrap: tex.wrap, filter: tex.filter,
    range: { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0 },
    averageAlpha: pixels ? sumA / pixels : 0,
    bytes: tex.data.byteLength,
  };
}
