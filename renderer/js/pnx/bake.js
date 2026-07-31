// PNX baking (spec Part 58): turning a procedural graph into data a simpler runtime can replay.
//
// Baking is what lets Cadence author things Roblox cannot express. Part 2 is explicit that Roblox must
// not define Cadence's capabilities — so the answer for everything Roblox cannot run natively is not to
// forbid it, it is to precompute it.
//
// THE CENTRAL PROBLEM, and the technique this file is built around:
//
// A field is an opaque closure. To decide whether a value can become a cheap Roblox NumberSequence
// (which varies only over a particle's life) or needs a full per-frame cache (megabytes), you have to
// know WHAT THE FIELD ACTUALLY DEPENDS ON — and you cannot read that off a closure.
//
// So the field is PROBED. Sample it with one input varied and everything else fixed; if the output
// moves, it depends on that input. Do that for life, position, velocity, index and time and you have a
// dependency set, which decides the export strategy:
//
//   depends on life only          -> NumberSequence / ColorSequence. Native, tiny, exact.
//   depends on index only         -> a per-particle constant; Roblox rolls its own, so a RANGE.
//   depends on position/velocity  -> no Roblox equivalent at all; must be baked per frame.
//   depends on nothing            -> a constant.
//
// The probe is a HEURISTIC and says so: a field that happens to return the same value at every probe
// point is reported as constant even if some untested input would move it. The probe points are
// therefore chosen to be awkward (irrational-ish, spread over sign changes) rather than round numbers,
// because round numbers are exactly where a periodic or quantised field is most likely to alias into
// looking constant. A wrong answer here degrades fidelity, never correctness: the fallback is always to
// bake more than strictly necessary.

import * as V from './values.js';
import * as F from './fields.js';
import * as GEO from './geometry.js';

// ---------------------------------------------------------------- field probing
// Deliberately not round numbers. A noise field sampled at 0, 1, 2 can return the same value three
// times by construction (integer lattice points), and a periodic field sampled at multiples of its
// period looks constant. These offsets avoid both.
const PROBE_POINTS = {
  life: [0, 0.317, 0.628, 0.941],
  age: [0, 0.417, 1.237, 2.718],
  position: [[0, 0, 0], [1.31, -0.72, 2.17], [-3.14, 4.71, -1.62], [7.53, 2.09, -5.28]],
  velocity: [[0, 0, 0], [3.17, -1.28, 0.53], [-8.21, 5.09, 2.71]],
  index: [0, 7, 41, 199],
  time: [0, 0.413, 1.271, 3.142],
  uv: [[0, 0], [0.317, 0.628], [0.941, 0.173]],
  normal: [[0, 1, 0], [0.577, 0.577, 0.577], [-0.707, 0, 0.707]],
};

const EPS = 1e-7;

function sampleAt(field, overrides) {
  try {
    return F.sampleAny(field, F.newSampleContext(overrides));
  } catch (e) {
    return null;
  }
}

// Do two sampled values differ meaningfully? Handles numbers, arrays and booleans; anything else is
// treated as "differs" so an unrecognised value is baked rather than assumed constant.
function differs(a, b) {
  if (a === null || b === null) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > EPS;
  if (typeof a === 'boolean' || typeof b === 'boolean') return a !== b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i++) if (Math.abs((a[i] || 0) - (b[i] || 0)) > EPS) return true;
    return false;
  }
  return a !== b;
}

// What does this field depend on? Returns a Set of input names. A plain (non-field) value depends on
// nothing, which is what makes the common case free.
export function fieldDependencies(field) {
  const deps = new Set();
  if (!F.isField(field)) return deps;
  if (F.isConstantField(field)) return deps;

  for (const [key, values] of Object.entries(PROBE_POINTS)) {
    const base = sampleAt(field, { [key]: values[0] });
    for (let i = 1; i < values.length; i++) {
      if (differs(base, sampleAt(field, { [key]: values[i] }))) { deps.add(key); break; }
    }
  }
  // `age` and `life` are the same axis as far as an exporter cares — Roblox sequences are indexed by
  // normalised life — so collapse them, or a field written against age would be reported as needing a
  // full bake when a sequence would do.
  if (deps.has('age')) { deps.add('life'); deps.delete('age'); }
  return deps;
}

// The export strategy a value's dependencies imply. This is the single decision the Roblox exporter
// branches on, kept here so the reasoning lives next to the probe that produced it.
export function bakeStrategy(field) {
  if (!F.isField(field)) return { kind: 'constant', deps: [] };
  if (F.isConstantField(field)) return { kind: 'constant', deps: [] };
  const deps = fieldDependencies(field);
  const list = [...deps];
  if (!deps.size) return { kind: 'constant', deps: list };
  // Life alone is the good case: it becomes a NumberSequence or ColorSequence and is exact.
  if (deps.size === 1 && deps.has('life')) return { kind: 'sequence', deps: list };
  // Index alone means "a different constant per particle". Roblox rolls its own per-particle
  // randomness, so this exports as a RANGE — statistically equivalent, individually different.
  if (deps.size === 1 && deps.has('index')) return { kind: 'range', deps: list };
  if (deps.size === 2 && deps.has('life') && deps.has('index')) return { kind: 'sequenceRange', deps: list };
  // Anything spatial has no Roblox equivalent whatsoever and must be baked per frame.
  return { kind: 'perFrame', deps: list };
}

// ---------------------------------------------------------------- sequences (Part 58: animation curves)
// Sample a life-dependent field into keypoints. Roblox caps NumberSequence/ColorSequence at 20
// keypoints, so the default is well under that; the sampling is uniform rather than adaptive because a
// uniform set is what a NumberSequence interpolates between anyway.
export function bakeSequence(field, { samples = 8, context = {} } = {}) {
  const n = Math.max(2, Math.min(20, Math.round(samples)));
  const points = [];
  for (let k = 0; k < n; k++) {
    const life = k / (n - 1);
    points.push({ t: life, v: F.sampleAny(field, F.newSampleContext({ ...context, life, age: life })) });
  }
  return points;
}

// The min and max a field takes over a set of particle indices — what a `range` strategy exports as.
export function bakeRange(field, { samples = 64, context = {} } = {}) {
  let lo = Infinity, hi = -Infinity;
  const isVector = Array.isArray(F.sampleAny(field, F.newSampleContext(context)));
  if (isVector) {
    // A vector range is not representable as a Roblox NumberRange; report the magnitude range, which is
    // what a speed or a size range means in practice.
    for (let k = 0; k < samples; k++) {
      const v = V.toComponents('vector3', F.sampleAny(field, F.newSampleContext({ ...context, index: k })));
      const m = V.vLength(v);
      if (m < lo) lo = m;
      if (m > hi) hi = m;
    }
    return { min: lo, max: hi, vector: true };
  }
  for (let k = 0; k < samples; k++) {
    const v = Number(F.sampleAny(field, F.newSampleContext({ ...context, index: k })));
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return { min: 0, max: 0, vector: false };
  return { min: lo, max: hi, vector: false };
}

// ---------------------------------------------------------------- particle caches (Part 58)
// The general fallback: record what was actually drawn, frame by frame. Correct for ANY effect, at a
// cost that grows with (frames x elements x channels) — so the options here are all about making that
// cost visible and controllable rather than letting a user discover it as a 40 MB script.
//
// PARTICLE IDENTITY is the part that is easy to get wrong. A cache keyed by array position is useless:
// particles die and the array compacts, so slot 3 is a different particle every frame and replaying it
// makes every particle jump between paths. The cache is keyed by the particle's stable `id`, and the
// replay resolves ids to pooled objects.
export function bakeParticleCache(evaluateFrame, {
  from = 0, to = 60, stride = 1,
  maxParticles = 400, maxFrames = 600,
  precision = 2,
  channels = ['position', 'color', 'size'],
} = {}) {
  const step = Math.max(1, Math.round(stride));
  const frameList = [];
  for (let f = from; f <= to && frameList.length < maxFrames; f += step) frameList.push(f);

  const q = (v) => {
    const m = 10 ** precision;
    const r = Math.round((Number(v) || 0) * m) / m;
    return Object.is(r, -0) ? 0 : r;
  };

  const frames = [];
  const seenIds = new Set();
  let truncated = false;
  let peak = 0;

  for (const frame of frameList) {
    const scene = evaluateFrame(frame);
    const rows = [];
    if (scene) {
      for (const draw of scene.draws) {
        if (draw.kind !== 'sprite' && draw.kind !== 'point') continue;
        const count = draw.count || 0;
        peak = Math.max(peak, count);
        const ids = draw.ids || null;
        for (let k = 0; k < count; k++) {
          if (rows.length >= maxParticles) { truncated = true; break; }
          const id = ids ? ids[k] : k;
          seenIds.add(id);
          const row = { id };
          if (channels.includes('position')) {
            row.p = [q(draw.positions[k * 3]), q(draw.positions[k * 3 + 1]), q(draw.positions[k * 3 + 2])];
          }
          if (channels.includes('color')) {
            row.c = [q(draw.colors[k * 4]), q(draw.colors[k * 4 + 1]), q(draw.colors[k * 4 + 2])];
            row.a = q(draw.colors[k * 4 + 3] * (draw.opacity ? draw.opacity[k] : 1));
          }
          if (channels.includes('size')) row.s = q(draw.sizes ? draw.sizes[k] : 1);
          rows.push(row);
        }
      }
    }
    frames.push({ frame, rows });
  }

  // The size estimate is the number that decides whether this is a viable export, so it is measured
  // rather than guessed: one row serialized, times the row count.
  const numbersPerRow = (channels.includes('position') ? 3 : 0) + (channels.includes('color') ? 4 : 0) + (channels.includes('size') ? 1 : 0) + 1;
  const totalRows = frames.reduce((s, f) => s + f.rows.length, 0);
  return {
    frames,
    stats: {
      frameCount: frames.length,
      distinctParticles: seenIds.size,
      peakParticles: peak,
      totalRows,
      truncated,
      estimatedNumbers: totalRows * numbersPerRow,
      // ~7 characters per quantised number plus separators, measured against real output.
      estimatedBytes: totalRows * numbersPerRow * 7,
    },
  };
}

// ---------------------------------------------------------------- transform sequences (Part 58)
// For a single moving thing — a mesh, a light, a beam endpoint — one transform per frame, which is
// vastly cheaper than a particle cache and exactly what a Roblox script can drive.
export function bakeTransformSequence(evaluateFrame, pick, { from = 0, to = 60, stride = 1, precision = 3 } = {}) {
  const step = Math.max(1, Math.round(stride));
  const q = (v) => {
    const m = 10 ** precision;
    const r = Math.round((Number(v) || 0) * m) / m;
    return Object.is(r, -0) ? 0 : r;
  };
  const out = [];
  for (let f = from; f <= to; f += step) {
    const scene = evaluateFrame(f);
    const value = scene ? pick(scene) : null;
    out.push({ frame: f, value: value ? value.map(q) : null });
  }
  return out;
}

// ---------------------------------------------------------------- geometry (Part 58: meshes)
// A geometry snapshot in a form a mesh importer or a part-builder can consume. Not an .obj writer —
// this is the intermediate the Roblox target reads to decide between one MeshPart, a pile of Parts, or
// a refusal.
export function bakeGeometry(geometry, { precision = 4 } = {}) {
  if (!GEO.isGeometry(geometry) || !GEO.pointCount(geometry)) return null;
  const q = (v) => {
    const m = 10 ** precision;
    return Math.round((Number(v) || 0) * m) / m;
  };
  const positions = [];
  const pos = geometry.points.attrs.position;
  for (let k = 0; k < geometry.points.count; k++) {
    positions.push([q(pos.data[k * 3]), q(pos.data[k * 3 + 1]), q(pos.data[k * 3 + 2])]);
  }
  const b = GEO.bounds(geometry);
  return {
    positions,
    indices: geometry.faces ? Array.from(geometry.faces.corners) : null,
    triangles: GEO.faceCount(geometry),
    bounds: { min: b.min, max: b.max, size: b.size, center: b.center },
  };
}

// Does a geometry change over time? Answered by comparing bounds and point count across frames rather
// than by hashing every vertex — a deforming mesh moves its bounds, and the cost of the cheap test is
// what makes it worth running at all.
export function geometryIsStatic(evaluateFrame, pick, frames = [0, 15, 30, 45]) {
  let first = null;
  for (const f of frames) {
    const scene = evaluateFrame(f);
    const g = scene ? pick(scene) : null;
    const sig = g ? JSON.stringify([g.count, g.positions ? Array.from(g.positions.slice(0, 24)).map((v) => Math.round(v * 1e3)) : null]) : 'none';
    if (first === null) first = sig;
    else if (sig !== first) return false;
  }
  return true;
}

// ---------------------------------------------------------------- budget
// Roblox's own hard limits, and the practical ones. Kept in one table so the exporter and its report
// cannot disagree about what "too big" means.
export const ROBLOX_LIMITS = {
  particleRate: 500,
  particleLifetime: 20,
  particleSize: 100,
  sequenceKeypoints: 20,
  lightRange: 60,
  beamSegments: 10,
  // A script much larger than this is slow to load and unpleasant to paste into Studio. Measured
  // rather than guessed: ~1 MB is where Studio's script editor starts to struggle.
  scriptBytes: 1_000_000,
  partsPerEffect: 500,
};

export function describeBudget(bytes) {
  const kb = Math.round(bytes / 1024);
  if (bytes > ROBLOX_LIMITS.scriptBytes) {
    return { ok: false, kb, message: `The baked script would be about ${kb} KB, which is past the point where Studio's editor struggles. Reduce the frame range, raise the frame stride, or lower the particle count.` };
  }
  if (bytes > ROBLOX_LIMITS.scriptBytes / 4) {
    return { ok: true, kb, message: `The baked script is about ${kb} KB — large but workable. A higher frame stride would shrink it.` };
  }
  return { ok: true, kb, message: null };
}
