// PNX grid fluid solver: smoke and fire on a uniform grid, with deterministic scrubbing (spec Parts 31–32).
//
// This is the subsystem volume.js's UNIMPLEMENTED table used to name as absent, built now with the
// scope stated plainly: a Stam-style stable-fluids solver on a collocated grid — semi-Lagrangian
// advection, buoyancy, vorticity confinement, a Jacobi pressure projection, and a combustion model
// (fuel + temperature → heat + soot). CPU, Float32Arrays, preview resolutions (16³–64³). It is a real
// solver rather than a look: divergence is projected out every step, smoke curls because vorticity is
// confined, fire rises because it is hot. What it is NOT is a production pyro solver: no MAC grid, no
// multigrid, no expansion from combustion, no sparse tiles. At 32³ a step is tens of milliseconds
// (measured in the tests); at 64³ it is a bake, and the node says so.
//
// DETERMINISM follows solver.js exactly: fixed dt from the frame rate, no Math.random anywhere, and
// replay from checkpoints — every route to frame f runs the same steps from the same start. Checkpoints
// clone the grids, so they are capped by memory rather than by count.
//
// UNITS. Velocities are stored in grid cells per second; world velocities (studs/s) convert through
// the cell size, so the same fire at 24³ and 48³ moves at the same speed in studs. Density, temperature
// and fuel are dimensionless amounts a user reasons about as "how much".

import * as F from './fields.js';
import * as V from './values.js';
import * as GEO from './geometry.js';
import { SpatialGrid } from './spatial.js';

export const MAX_RESOLUTION = 64;
export const DEFAULT_RESOLUTION = 32;

// ---------------------------------------------------------------- state
export function newFluidState(resolution, { center = [0, 2, 0], size = [4, 4, 4], startFrame = 0 } = {}) {
  const r = Math.max(4, Math.min(MAX_RESOLUTION, Math.round(resolution)));
  const n = r * r * r;
  return {
    resolution: r,
    center: V.toComponents('vector3', center),
    size: V.toComponents('vector3', size).map((v) => Math.max(1e-3, Math.abs(v))),
    u: new Float32Array(n), v: new Float32Array(n), w: new Float32Array(n),
    density: new Float32Array(n), temperature: new Float32Array(n), fuel: new Float32Array(n),
    frame: startFrame,
    time: 0,
    stats: { burned: 0 },
  };
}

export function cloneFluidState(s) {
  return {
    resolution: s.resolution, center: [...s.center], size: [...s.size],
    u: new Float32Array(s.u), v: new Float32Array(s.v), w: new Float32Array(s.w),
    density: new Float32Array(s.density), temperature: new Float32Array(s.temperature), fuel: new Float32Array(s.fuel),
    frame: s.frame, time: s.time, stats: { ...s.stats },
  };
}

export const cellSize = (s) => [s.size[0] / s.resolution, s.size[1] / s.resolution, s.size[2] / s.resolution];

export function worldOfCell(s, x, y, z) {
  const r = s.resolution;
  return [
    s.center[0] + ((x + 0.5) / r - 0.5) * s.size[0],
    s.center[1] + ((y + 0.5) / r - 0.5) * s.size[1],
    s.center[2] + ((z + 0.5) / r - 0.5) * s.size[2],
  ];
}

// World position → continuous grid coordinate (cell centres at integer + 0.5).
function gridOf(s, p) {
  const r = s.resolution;
  return [
    ((p[0] - s.center[0]) / s.size[0] + 0.5) * r - 0.5,
    ((p[1] - s.center[1]) / s.size[1] + 0.5) * r - 0.5,
    ((p[2] - s.center[2]) / s.size[2] + 0.5) * r - 0.5,
  ];
}

// Trilinear read of a channel at a continuous grid coordinate, clamped at the box.
export function sampleGrid(arr, r, gx, gy, gz) {
  const cx = Math.max(0, Math.min(r - 1.0001, gx)), cy = Math.max(0, Math.min(r - 1.0001, gy)), cz = Math.max(0, Math.min(r - 1.0001, gz));
  const x0 = Math.floor(cx), y0 = Math.floor(cy), z0 = Math.floor(cz);
  const tx = cx - x0, ty = cy - y0, tz = cz - z0;
  const x1 = Math.min(r - 1, x0 + 1), y1 = Math.min(r - 1, y0 + 1), z1 = Math.min(r - 1, z0 + 1);
  const i = (x, y, z) => (z * r + y) * r + x;
  const c00 = arr[i(x0, y0, z0)] + (arr[i(x1, y0, z0)] - arr[i(x0, y0, z0)]) * tx;
  const c10 = arr[i(x0, y1, z0)] + (arr[i(x1, y1, z0)] - arr[i(x0, y1, z0)]) * tx;
  const c01 = arr[i(x0, y0, z1)] + (arr[i(x1, y0, z1)] - arr[i(x0, y0, z1)]) * tx;
  const c11 = arr[i(x0, y1, z1)] + (arr[i(x1, y1, z1)] - arr[i(x0, y1, z1)]) * tx;
  const c0 = c00 + (c10 - c00) * ty;
  const c1 = c01 + (c11 - c01) * ty;
  return c0 + (c1 - c0) * tz;
}

export function sampleWorld(s, channel, p) {
  const g = gridOf(s, p);
  return sampleGrid(s[channel], s.resolution, g[0], g[1], g[2]);
}

// The velocity at a world point, in studs per second — what a particle riding the smoke needs.
export function velocityAtWorld(s, p) {
  const g = gridOf(s, p);
  const cs = cellSize(s);
  return [
    sampleGrid(s.u, s.resolution, g[0], g[1], g[2]) * cs[0],
    sampleGrid(s.v, s.resolution, g[0], g[1], g[2]) * cs[1],
    sampleGrid(s.w, s.resolution, g[0], g[1], g[2]) * cs[2],
  ];
}

// ---------------------------------------------------------------- the step
// spec = {
//   sources: [{ points: Float32Array|null (world xyz triples), radius, sdf: field<float>|null,
//               density, temperature, fuel, velocity: [x,y,z] studs/s }],
//   buoyancy, weight, cooling, dissipation, vorticity, iterations,
//   ignition, burnRate, heatRelease, soot,
//   wind: field<vector3>|null (studs/s²), boundary: 'open'|'closed'
// }
export function stepFluid(s, spec, dt) {
  const r = s.resolution, n = r * r * r;
  const cs = cellSize(s);
  const idx = (x, y, z) => (z * r + y) * r + x;

  // --- 1. SOURCES. A source is a set of world points (any geometry) with a radius, an SDF region, or
  // both. Cells inside gain density/temperature/fuel at the source's rates and take its velocity.
  for (const src of spec.sources || []) {
    const rad = Math.max(cs[0] * 0.75, Number(src.radius) || 0);
    const grid = src.points && src.points.length ? SpatialGrid.fromTable({ count: src.points.length / 3, attrs: { position: { components: 3, data: src.points } } }, rad) : null;
    const sdf = src.sdf || null;
    const sdfCtx = sdf ? F.newSampleContext() : null;
    const vel = src.velocity ? [src.velocity[0] / cs[0], src.velocity[1] / cs[1], src.velocity[2] / cs[2]] : null;
    const dD = (Number(src.density) || 0) * dt, dF = (Number(src.fuel) || 0) * dt, tT = Number(src.temperature) || 0;
    if (!grid && !sdf) continue;
    for (let z = 0; z < r; z++) for (let y = 0; y < r; y++) for (let x = 0; x < r; x++) {
      const p = worldOfCell(s, x, y, z);
      let inside = false;
      if (grid) { grid.query(p, rad, -1, () => { inside = true; }); }
      if (!inside && sdf) { sdfCtx.position = p; inside = Number(F.sampleAny(sdf, sdfCtx)) < 0; }
      if (!inside) continue;
      const i = idx(x, y, z);
      s.density[i] += dD;
      s.fuel[i] += dF;
      if (tT > s.temperature[i]) s.temperature[i] = tT;
      if (vel) { s.u[i] = vel[0]; s.v[i] = vel[1]; s.w[i] = vel[2]; }
    }
  }

  // --- 2. COMBUSTION. Fuel above the ignition temperature burns: it is consumed, heat is released and
  // soot (smoke density) is produced. No expansion term — an honest omission that costs the "whump" of
  // ignition, not the look of a flame.
  const ignition = Number(spec.ignition) || 0, burnRate = Math.max(0, Number(spec.burnRate) || 0);
  const heat = Number(spec.heatRelease) || 0, soot = Number(spec.soot) || 0;
  if (burnRate > 0) {
    for (let i = 0; i < n; i++) {
      const f = s.fuel[i];
      if (f <= 0 || s.temperature[i] < ignition) continue;
      const burn = Math.min(f, burnRate * dt);
      s.fuel[i] = f - burn;
      s.temperature[i] += burn * heat;
      s.density[i] += burn * soot;
      s.stats.burned += burn;
    }
  }

  // --- 3. FORCES. Buoyancy (hot rises, heavy smoke sinks), an external force field sampled at every
  // cell (wind, turbulence — any PNX vector field), and vorticity confinement, which puts back the
  // small swirls that numerical dissipation smears away.
  const buoy = Number(spec.buoyancy) || 0, weight = Number(spec.weight) || 0;
  const windField = spec.wind && F.isField(spec.wind) ? spec.wind : null;
  const windCtx = windField ? F.newSampleContext({ time: s.time }) : null;
  const constWind = spec.wind && !F.isField(spec.wind) ? V.toComponents('vector3', spec.wind) : null;
  for (let z = 0; z < r; z++) for (let y = 0; y < r; y++) for (let x = 0; x < r; x++) {
    const i = idx(x, y, z);
    s.v[i] += dt * (buoy * s.temperature[i] - weight * s.density[i]) / cs[1];
    if (windField || constWind) {
      let wv = constWind;
      if (windField) { windCtx.position = worldOfCell(s, x, y, z); wv = V.toComponents('vector3', F.sampleAny(windField, windCtx)); }
      s.u[i] += dt * wv[0] / cs[0]; s.v[i] += dt * wv[1] / cs[1]; s.w[i] += dt * wv[2] / cs[2];
    }
  }
  const eps = Number(spec.vorticity) || 0;
  if (eps > 0) confineVorticity(s, eps, dt);

  // --- 4. ADVECTION, semi-Lagrangian: each cell looks back along the velocity to where its contents
  // came from and takes a trilinear sample there. Unconditionally stable, slightly diffusive.
  const u0 = new Float32Array(s.u), v0 = new Float32Array(s.v), w0 = new Float32Array(s.w);
  const adv = (src, dst) => {
    for (let z = 0; z < r; z++) for (let y = 0; y < r; y++) for (let x = 0; x < r; x++) {
      const i = idx(x, y, z);
      dst[i] = sampleGrid(src, r, x - u0[i] * dt, y - v0[i] * dt, z - w0[i] * dt);
    }
  };
  adv(u0, s.u); adv(v0, s.v); adv(w0, s.w);
  const d0 = new Float32Array(s.density), t0 = new Float32Array(s.temperature), f0 = new Float32Array(s.fuel);
  adv(d0, s.density); adv(t0, s.temperature); adv(f0, s.fuel);

  // --- 5. DISSIPATION and COOLING.
  const diss = Math.max(0, Math.min(1, (Number(spec.dissipation) || 0) * dt));
  const cool = Math.max(0, Math.min(1, (Number(spec.cooling) || 0) * dt));
  if (diss > 0 || cool > 0) {
    for (let i = 0; i < n; i++) {
      if (diss > 0) s.density[i] *= 1 - diss;
      if (cool > 0) s.temperature[i] *= 1 - cool;
    }
  }

  // --- 6. PROJECTION. Make the velocity divergence-free with a Jacobi pressure solve. This is the step
  // that separates a fluid from a pile of particles: it is why smoke goes AROUND things and rolls into
  // itself instead of piling up.
  project(s, Math.max(4, Math.min(80, Math.round(spec.iterations) || 24)), spec.boundary === 'closed');

  s.time += dt;
  s.frame += 1;
  return s;
}

function confineVorticity(s, eps, dt) {
  const r = s.resolution, n = r * r * r;
  const idx = (x, y, z) => (z * r + y) * r + x;
  const cx = new Float32Array(n), cy = new Float32Array(n), cz = new Float32Array(n), mag = new Float32Array(n);
  const at = (arr, x, y, z) => arr[idx(Math.max(0, Math.min(r - 1, x)), Math.max(0, Math.min(r - 1, y)), Math.max(0, Math.min(r - 1, z)))];
  for (let z = 0; z < r; z++) for (let y = 0; y < r; y++) for (let x = 0; x < r; x++) {
    const i = idx(x, y, z);
    const wx = (at(s.w, x, y + 1, z) - at(s.w, x, y - 1, z)) * 0.5 - (at(s.v, x, y, z + 1) - at(s.v, x, y, z - 1)) * 0.5;
    const wy = (at(s.u, x, y, z + 1) - at(s.u, x, y, z - 1)) * 0.5 - (at(s.w, x + 1, y, z) - at(s.w, x - 1, y, z)) * 0.5;
    const wz = (at(s.v, x + 1, y, z) - at(s.v, x - 1, y, z)) * 0.5 - (at(s.u, x, y + 1, z) - at(s.u, x, y - 1, z)) * 0.5;
    cx[i] = wx; cy[i] = wy; cz[i] = wz; mag[i] = Math.sqrt(wx * wx + wy * wy + wz * wz);
  }
  for (let z = 1; z < r - 1; z++) for (let y = 1; y < r - 1; y++) for (let x = 1; x < r - 1; x++) {
    const i = idx(x, y, z);
    let nx = (mag[idx(x + 1, y, z)] - mag[idx(x - 1, y, z)]) * 0.5;
    let ny = (mag[idx(x, y + 1, z)] - mag[idx(x, y - 1, z)]) * 0.5;
    let nz = (mag[idx(x, y, z + 1)] - mag[idx(x, y, z - 1)]) * 0.5;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) + 1e-5;
    nx /= len; ny /= len; nz /= len;
    // force = eps * (N × ω)
    s.u[i] += dt * eps * (ny * cz[i] - nz * cy[i]);
    s.v[i] += dt * eps * (nz * cx[i] - nx * cz[i]);
    s.w[i] += dt * eps * (nx * cy[i] - ny * cx[i]);
  }
}

function project(s, iterations, closed) {
  const r = s.resolution, n = r * r * r;
  const idx = (x, y, z) => (z * r + y) * r + x;
  const div = new Float32Array(n);
  let p = new Float32Array(n), q = new Float32Array(n);
  const at = (arr, x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= r || y >= r || z >= r) return closed ? 0 : null;
    return arr[idx(x, y, z)];
  };
  // A missing neighbour (open boundary) mirrors the cell itself, so the box edge is not a wall.
  const nb = (arr, x, y, z, self) => { const v = at(arr, x, y, z); return v === null ? self : v; };
  for (let z = 0; z < r; z++) for (let y = 0; y < r; y++) for (let x = 0; x < r; x++) {
    const i = idx(x, y, z);
    div[i] = 0.5 * ((nb(s.u, x + 1, y, z, s.u[i]) - nb(s.u, x - 1, y, z, s.u[i]))
      + (nb(s.v, x, y + 1, z, s.v[i]) - nb(s.v, x, y - 1, z, s.v[i]))
      + (nb(s.w, x, y, z + 1, s.w[i]) - nb(s.w, x, y, z - 1, s.w[i])));
  }
  for (let it = 0; it < iterations; it++) {
    for (let z = 0; z < r; z++) for (let y = 0; y < r; y++) for (let x = 0; x < r; x++) {
      const i = idx(x, y, z);
      // Open boundary: pressure outside is zero (the atmosphere), which lets flow leave the box.
      const px = closed ? nb(p, x - 1, y, z, p[i]) : (at(p, x - 1, y, z) ?? 0);
      const qx = closed ? nb(p, x + 1, y, z, p[i]) : (at(p, x + 1, y, z) ?? 0);
      const py = closed ? nb(p, x, y - 1, z, p[i]) : (at(p, x, y - 1, z) ?? 0);
      const qy = closed ? nb(p, x, y + 1, z, p[i]) : (at(p, x, y + 1, z) ?? 0);
      const pz = closed ? nb(p, x, y, z - 1, p[i]) : (at(p, x, y, z - 1) ?? 0);
      const qz = closed ? nb(p, x, y, z + 1, p[i]) : (at(p, x, y, z + 1) ?? 0);
      q[i] = (px + qx + py + qy + pz + qz - div[i]) / 6;
    }
    const t = p; p = q; q = t;
  }
  for (let z = 0; z < r; z++) for (let y = 0; y < r; y++) for (let x = 0; x < r; x++) {
    const i = idx(x, y, z);
    const gx = closed ? (nb(p, x + 1, y, z, p[i]) - nb(p, x - 1, y, z, p[i])) : ((at(p, x + 1, y, z) ?? 0) - (at(p, x - 1, y, z) ?? 0));
    const gy = closed ? (nb(p, x, y + 1, z, p[i]) - nb(p, x, y - 1, z, p[i])) : ((at(p, x, y + 1, z) ?? 0) - (at(p, x, y - 1, z) ?? 0));
    const gz = closed ? (nb(p, x, y, z + 1, p[i]) - nb(p, x, y, z - 1, p[i])) : ((at(p, x, y, z + 1) ?? 0) - (at(p, x, y, z - 1) ?? 0));
    s.u[i] -= 0.5 * gx; s.v[i] -= 0.5 * gy; s.w[i] -= 0.5 * gz;
    if (closed) {
      if (x === 0 || x === r - 1) s.u[i] = 0;
      if (y === 0 || y === r - 1) s.v[i] = 0;
      if (z === 0 || z === r - 1) s.w[i] = 0;
    }
  }
}

// The divergence of the velocity field, for tests and diagnostics: a projected field is near zero.
export function meanAbsDivergence(s) {
  const r = s.resolution;
  const idx = (x, y, z) => (z * r + y) * r + x;
  let sum = 0, count = 0;
  for (let z = 1; z < r - 1; z++) for (let y = 1; y < r - 1; y++) for (let x = 1; x < r - 1; x++) {
    const d = 0.5 * ((s.u[idx(x + 1, y, z)] - s.u[idx(x - 1, y, z)]) + (s.v[idx(x, y + 1, z)] - s.v[idx(x, y - 1, z)]) + (s.w[idx(x, y, z + 1)] - s.w[idx(x, y, z - 1)]));
    sum += Math.abs(d); count++;
  }
  return count ? sum / count : 0;
}

export function totals(s) {
  let d = 0, t = 0, f = 0, dy = 0;
  const r = s.resolution;
  for (let z = 0; z < r; z++) for (let y = 0; y < r; y++) for (let x = 0; x < r; x++) {
    const i = (z * r + y) * r + x;
    d += s.density[i]; t += s.temperature[i]; f += s.fuel[i]; dy += s.density[i] * y;
  }
  return { density: d, temperature: t, fuel: f, densityCentreY: d > 1e-9 ? dy / d : 0 };
}

// ---------------------------------------------------------------- the simulation, with replay
export class FluidSimulation {
  constructor(spec, options = {}) {
    this.spec = spec;
    this.fps = options.fps || 30;
    this.startFrame = options.startFrame || 0;
    this.resolution = options.resolution || DEFAULT_RESOLUTION;
    this.box = { center: options.center || [0, 2, 0], size: options.size || [4, 4, 4] };
    this.checkpointEvery = Math.max(1, options.checkpointEvery || 8);
    // Checkpoints are capped by MEMORY: a 48³ state is 2.6 MB, and sixty of them would be 160 MB.
    this.maxCheckpointBytes = options.maxCheckpointBytes || 48 * 1024 * 1024;
    this.maxCatchUpFrames = Math.max(1, options.maxCatchUpFrames || 2000);
    this.state = newFluidState(this.resolution, { ...this.box, startFrame: this.startFrame });
    this.checkpoints = new Map();
    this.lastSeek = { frame: null, steps: 0, ms: 0 };
  }

  reset() {
    this.state = newFluidState(this.resolution, { ...this.box, startFrame: this.startFrame });
    this.checkpoints.clear();
  }

  bytesPerState() { return this.state.resolution ** 3 * 6 * 4; }

  seek(frame) {
    const target = Math.max(this.startFrame, Math.floor(frame));
    const dt = 1 / this.fps;
    if (this.state.frame === target) { this.lastSeek = { frame: target, steps: 0, ms: 0 }; return this.state; }
    if (target < this.state.frame) {
      let bestFrame = -Infinity, best = null;
      for (const [f, s] of this.checkpoints) if (f <= target && f > bestFrame) { bestFrame = f; best = s; }
      this.state = best ? cloneFluidState(best) : newFluidState(this.resolution, { ...this.box, startFrame: this.startFrame });
    }
    const t0 = (globalThis.performance?.now ? performance.now() : Date.now());
    let steps = 0;
    while (this.state.frame < target && steps < this.maxCatchUpFrames) {
      stepFluid(this.state, this.spec, dt);
      steps++;
      if (this.state.frame % this.checkpointEvery === 0) this._checkpoint();
    }
    this.lastSeek = { frame: target, steps, truncated: this.state.frame < target, ms: (globalThis.performance?.now ? performance.now() : Date.now()) - t0 };
    return this.state;
  }

  _checkpoint() {
    this.checkpoints.set(this.state.frame, cloneFluidState(this.state));
    const limit = Math.max(2, Math.floor(this.maxCheckpointBytes / this.bytesPerState()));
    while (this.checkpoints.size > limit) {
      const frames = [...this.checkpoints.keys()].sort((a, b) => a - b);
      this.checkpoints.delete(frames[1] ?? frames[0]);
    }
  }
}
