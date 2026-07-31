// PNX volumes (spec Part 33) — the data model, and the operations that are honestly implementable.
//
// PART 78 GOVERNS THIS FILE. Parts 31-33 and 35 ask for a fluid/pyro grid solver and volumetric
// raymarching, and the specification's own instruction for a subsystem that cannot be correctly built is:
// define the interface, implement the foundational architecture, mark the backend as not yet implemented,
// and do not create a button that pretends it exists.
//
// So this file draws a line, and states which side of it everything is on:
//
//   BUILT, and correct:      the Volume data model, sampling with trilinear interpolation, combining,
//                            masking, transforming, thresholding, blurring, and rasterising a field into
//                            a grid. All of these are pointwise or neighbourhood operations on a grid —
//                            no time integration, no solver, no pressure projection.
//
//   NOT BUILT, deliberately: advection, divergence, pressure solve, viscosity, vorticity confinement,
//                            combustion. A grid solver needs a stable projection step at a resolution
//                            worth looking at, and a 64^3 CPU projection per frame is seconds, not
//                            milliseconds. A version that ran at 16^3 would produce mush and would be
//                            worse than nothing, because it would look like the feature working badly
//                            rather than like the feature being absent.
//
//   NOT BUILT, blocked:      volume RENDERING. Raymarching needs the renderer to march a ray per pixel
//                            through a 3D texture, which the sprite/mesh preview backend cannot do at
//                            all. Without it a volume is data you can query but not see directly.
//
// WHAT A VOLUME IS FOR TODAY, given no solver and no renderer, and it is not nothing: a volume is a
// CACHE of an expensive field. Rasterise a costly noise chain into a grid once, then sample it per
// particle for the price of eight array reads and some arithmetic. It is also the only way to blur in
// three dimensions, for the same reason a texture is the only way to blur in two — "neighbour" has no
// meaning in a continuous field.
//
// The `volume` TYPE stays `implemented: false` in types.js, which mechanically prevents any node from
// being registered against it until a backend exists. The nodes in nodes/volume.js therefore speak
// `volumeGrid`, a separate type for the thing that IS built — so the absent capability and the present
// one cannot be confused for each other.

import * as V from './values.js';
import * as F from './fields.js';

// 64^3 float32 is 1 MB per channel, and a 128^3 is 8 MB. The cap is where holding a few of these in a
// graph stops being reasonable rather than where the maths stops working.
export const MAX_RESOLUTION = 128;
export const DEFAULT_RESOLUTION = 32;

// ---------------------------------------------------------------- construction
// A volume is a grid plus the world box it occupies. Carrying the bounds with the data is what lets
// sampling take a world position rather than a grid index — without it every consumer would have to know
// the transform, and they would each get it slightly wrong.
export function newVolume(resolution = DEFAULT_RESOLUTION, { center = [0, 0, 0], size = [4, 4, 4], channels = 1 } = {}) {
  const r = Math.max(2, Math.min(MAX_RESOLUTION, Math.round(resolution)));
  const c = Math.max(1, Math.min(4, Math.round(channels)));
  return {
    __volume: true,
    resolution: r,
    channels: c,
    center: V.toComponents('vector3', center),
    size: V.toComponents('vector3', size).map((v) => Math.max(1e-4, Math.abs(v))),
    data: new Float32Array(r * r * r * c),
  };
}

export const isVolume = (v) => !!v && v.__volume === true;

export function cloneVolume(vol) {
  if (!isVolume(vol)) return null;
  const out = newVolume(vol.resolution, vol);
  out.data.set(vol.data);
  return out;
}

export function voxelCount(vol) {
  return isVolume(vol) ? vol.resolution ** 3 : 0;
}

// ---------------------------------------------------------------- addressing
// World position -> normalised grid coordinate in 0..resolution. The half-voxel convention matches
// texture.js: a voxel's value belongs at its CENTRE, so the grid coordinate of the box's low corner is
// 0 and the first voxel centre is at 0.5.
function toGrid(vol, p) {
  const r = vol.resolution;
  return [
    ((p[0] - vol.center[0]) / vol.size[0] + 0.5) * r,
    ((p[1] - vol.center[1]) / vol.size[1] + 0.5) * r,
    ((p[2] - vol.center[2]) / vol.size[2] + 0.5) * r,
  ];
}

export function worldOfVoxel(vol, ix, iy, iz) {
  const r = vol.resolution;
  return [
    vol.center[0] + ((ix + 0.5) / r - 0.5) * vol.size[0],
    vol.center[1] + ((iy + 0.5) / r - 0.5) * vol.size[1],
    vol.center[2] + ((iz + 0.5) / r - 0.5) * vol.size[2],
  ];
}

// Clamped voxel read. Clamping rather than wrapping is right for a volume: a density field has a
// boundary, and wrapping would make smoke re-enter on the far side.
export function getVoxel(vol, ix, iy, iz, channel = 0) {
  const r = vol.resolution;
  const x = Math.max(0, Math.min(r - 1, ix | 0));
  const y = Math.max(0, Math.min(r - 1, iy | 0));
  const z = Math.max(0, Math.min(r - 1, iz | 0));
  return vol.data[((z * r + y) * r + x) * vol.channels + channel];
}

export function setVoxel(vol, ix, iy, iz, value, channel = 0) {
  const r = vol.resolution;
  const x = ix | 0, y = iy | 0, z = iz | 0;
  if (x < 0 || y < 0 || z < 0 || x >= r || y >= r || z >= r) return;
  vol.data[((z * r + y) * r + x) * vol.channels + channel] = Number(value) || 0;
}

// Trilinear sample at a WORLD position. Eight reads and seven lerps — which is the whole cost argument
// for volumes as a cache: a noise chain that costs six FBM evaluations per sample becomes this.
export function sampleVolume(vol, p, channel = 0) {
  if (!isVolume(vol)) return 0;
  const g = toGrid(vol, p);
  const fx = g[0] - 0.5, fy = g[1] - 0.5, fz = g[2] - 0.5;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  const tx = fx - ix, ty = fy - iy, tz = fz - iz;

  const c000 = getVoxel(vol, ix, iy, iz, channel);
  const c100 = getVoxel(vol, ix + 1, iy, iz, channel);
  const c010 = getVoxel(vol, ix, iy + 1, iz, channel);
  const c110 = getVoxel(vol, ix + 1, iy + 1, iz, channel);
  const c001 = getVoxel(vol, ix, iy, iz + 1, channel);
  const c101 = getVoxel(vol, ix + 1, iy, iz + 1, channel);
  const c011 = getVoxel(vol, ix, iy + 1, iz + 1, channel);
  const c111 = getVoxel(vol, ix + 1, iy + 1, iz + 1, channel);

  const x00 = c000 + (c100 - c000) * tx;
  const x10 = c010 + (c110 - c010) * tx;
  const x01 = c001 + (c101 - c001) * tx;
  const x11 = c011 + (c111 - c011) * tx;
  const y0v = x00 + (x10 - x00) * ty;
  const y1v = x01 + (x11 - x01) * ty;
  return y0v + (y1v - y0v) * tz;
}

// A volume as a `field<float>` — the bridge back into the engine, and the reason a volume is useful
// without a renderer. Once it is a field, particles can read it, materials can be driven by it, and an
// SDF can be masked by it.
export function volumeAsField(vol, channel = 0) {
  return F.makeField('float', (ctx) => sampleVolume(vol, ctx.position || [0, 0, 0], channel));
}

// ---------------------------------------------------------------- rasterisation
// Evaluate a field into a grid. The expensive step, done once — which is the entire point.
export function rasterizeVolume(field, resolution, { center = [0, 0, 0], size = [4, 4, 4], time = 0 } = {}) {
  const vol = newVolume(resolution, { center, size, channels: 1 });
  const r = vol.resolution;
  const ctx = F.newSampleContext({ time });
  const pos = [0, 0, 0];
  ctx.position = pos;
  let i = 0;
  for (let z = 0; z < r; z++) {
    for (let y = 0; y < r; y++) {
      for (let x = 0; x < r; x++) {
        const w = worldOfVoxel(vol, x, y, z);
        pos[0] = w[0]; pos[1] = w[1]; pos[2] = w[2];
        ctx.index = i;
        const v = F.sampleAny(field, ctx);
        vol.data[i++] = typeof v === 'number' ? v : (typeof v === 'boolean' ? (v ? 1 : 0) : Number(V.toComponents('float', v)[0]) || 0);
      }
    }
  }
  return vol;
}

// ---------------------------------------------------------------- operations
export function mapVolume(vol, fn) {
  const out = cloneVolume(vol);
  if (!out) return null;
  for (let i = 0; i < out.data.length; i++) out.data[i] = fn(out.data[i], i);
  return out;
}

// Combine two volumes. `b` is SAMPLED at `a`'s grid rather than either being resampled, so combining a
// fine detail volume into a coarse base does not silently upscale the base.
export function zipVolumes(a, b, fn) {
  if (!isVolume(a)) return cloneVolume(b);
  if (!isVolume(b)) return cloneVolume(a);
  const out = cloneVolume(a);
  const r = out.resolution;
  let i = 0;
  for (let z = 0; z < r; z++) {
    for (let y = 0; y < r; y++) {
      for (let x = 0; x < r; x++) {
        const w = worldOfVoxel(out, x, y, z);
        out.data[i] = fn(a.data[i], sampleVolume(b, w));
        i++;
      }
    }
  }
  return out;
}

// Separable 3D box blur, repeated to approximate a Gaussian. Separable matters more here than in 2D: a
// radius-4 spherical kernel is 257 taps per voxel, and three separable passes are 27.
export function blurVolume(vol, radius, passes = 2) {
  if (!isVolume(vol) || !(radius > 0)) return cloneVolume(vol);
  const r = Math.max(1, Math.min(16, Math.round(radius)));
  const res = vol.resolution;
  let src = cloneVolume(vol);

  const axisPass = (input, axis) => {
    const out = newVolume(res, input);
    const idx = (x, y, z) => ((z * res + y) * res + x) * input.channels;
    for (let z = 0; z < res; z++) {
      for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
          let sum = 0, n = 0;
          for (let k = -r; k <= r; k++) {
            const cx = axis === 0 ? Math.max(0, Math.min(res - 1, x + k)) : x;
            const cy = axis === 1 ? Math.max(0, Math.min(res - 1, y + k)) : y;
            const cz = axis === 2 ? Math.max(0, Math.min(res - 1, z + k)) : z;
            sum += input.data[idx(cx, cy, cz)];
            n++;
          }
          out.data[idx(x, y, z)] = sum / n;
        }
      }
    }
    return out;
  };

  for (let p = 0; p < Math.max(1, Math.min(4, passes)); p++) {
    src = axisPass(axisPass(axisPass(src, 0), 1), 2);
  }
  return src;
}

// Move a volume's world box without touching its data. Cheap, and the right way to reposition one —
// resampling into a new grid would blur it for no reason.
export function transformVolume(vol, { center = null, size = null } = {}) {
  const out = cloneVolume(vol);
  if (!out) return null;
  if (center) out.center = V.toComponents('vector3', center);
  if (size) out.size = V.toComponents('vector3', size).map((v) => Math.max(1e-4, Math.abs(v)));
  return out;
}

export function describeVolume(vol) {
  if (!isVolume(vol)) return { empty: true };
  let min = Infinity, max = -Infinity, sum = 0, occupied = 0;
  for (let i = 0; i < vol.data.length; i++) {
    const v = vol.data[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    if (v > 0.01) occupied++;
  }
  const n = vol.data.length || 1;
  return {
    resolution: vol.resolution,
    voxels: voxelCount(vol),
    center: vol.center, size: vol.size,
    range: { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0 },
    average: sum / n,
    // What fraction of the grid holds anything. A low number means the volume is mostly empty, which is
    // the usual reason a volume-driven effect looks sparse — the box is too big for the content.
    occupancy: occupied / n,
    megabytes: Math.round((vol.data.byteLength / 1e6) * 100) / 100,
  };
}

// ---------------------------------------------------------------- the unimplemented backends
// Named explicitly, so a caller asking "can this engine do pyro" gets an answer rather than an absence.
// Read by the export report and by the MCP capability query.
export const UNIMPLEMENTED = {
  fluidSolver: {
    parts: [31],
    what: 'Advection, divergence, pressure projection, viscosity, vorticity confinement.',
    why: 'A stable pressure projection at a resolution worth looking at is seconds per frame on a CPU. At the resolution that would run in real time the result is mush, which would look like the feature working badly rather than being absent.',
    needs: 'A GPU compute backend, or an offline bake with a progress indicator.',
  },
  pyro: {
    parts: [32],
    what: 'Combustion, ignition, fuel consumption, temperature-driven buoyancy, soot.',
    why: 'Pyro is a fluid solver plus a reaction model, so it is blocked on the solver above.',
    needs: 'The fluid solver first.',
  },
  volumeRendering: {
    parts: [35],
    what: 'Raymarched density, absorption, scattering, blackbody emission.',
    why: 'Raymarching needs the renderer to march a ray per pixel through a 3D texture. The preview backend draws sprites and meshes and cannot read back its own output.',
    needs: 'A shader-based backend with a 3D texture binding.',
  },
};
