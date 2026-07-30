// PNX fields — the abstraction the whole engine's generality rests on (spec Part 18).
//
// A Field<T> is not a value; it is a value that VARIES over a sample point. Its graph-time
// representation is a closure:
//
//   { __field: true, type: TypeRef, sample(ctx) -> T, constant?: T }
//
// The point of this indirection: `Position -> Noise -> Color Ramp -> Emission` cannot be expressed
// by computing anything once, because "position" has no single value — it is different for every
// particle, vertex and volume cell. Fields defer the computation to the moment there IS a sample
// point, and because the deferral is uniform, arbitrary chains of ordinary maths compose into
// spatial patterns without any node in the chain knowing it is being used spatially.
//
// `constant` is set when a field is known to be position-invariant (the T -> Field<T> lift in
// types.js). Consumers can use it to skip per-element sampling entirely — an important
// optimisation, since most inputs on most nodes are constants in practice.
//
// SAMPLE CONTEXT — the sample point, and everything an element knows about itself:
//   position          [x,y,z]  the point being evaluated, in `space`
//   normal, tangent   [x,y,z]  surface frame, when sampling geometry
//   uv                [u,v]
//   time, frame       seconds / frames (effect time)
//   age, life         seconds / 0..1 normalised age, when sampling a particle
//   velocity          [x,y,z]
//   index             integer element index (stable per element, never an array position)
//   seed              integer, derived structurally — see seedFor()
//   attributes        arbitrary named per-element values (Part 5) — read via attr()
//   space             which coordinate space `position` is expressed in (Part 45)
//
// Every field must tolerate a partial context. A Noise field asked for a value with no position
// must return something finite, because a graph is edited in an incomplete state most of the time.

import * as V from './values.js';
import { parseType, formatType, fieldOf } from './types.js';

export const SPACES = ['world', 'local', 'parent', 'object', 'effect', 'camera', 'screen', 'uv', 'tangent'];

const ZERO3 = Object.freeze([0, 0, 0]);
const UP3 = Object.freeze([0, 1, 0]);

// ---------------------------------------------------------------- sample contexts
export function newSampleContext(overrides = {}) {
  return {
    position: ZERO3,
    normal: UP3,
    tangent: ZERO3,
    uv: [0, 0],
    time: 0,
    frame: 0,
    age: 0,
    life: 0,
    velocity: ZERO3,
    index: 0,
    seed: 0,
    attributes: null,
    space: 'world',
    ...overrides,
  };
}

// A shallow clone with a different position. Used by every spatial operation (warp, blur,
// gradient estimation) — cloning rather than mutating is deliberate: a field's sample() may
// itself sample other fields, and a mutate-then-restore scheme breaks the moment a nested sampler
// holds onto the context, which is exactly the kind of bug that would only show up as
// intermittently wrong noise.
export function withPosition(ctx, position) {
  return { ...ctx, position };
}

export function withAttributes(ctx, attributes) {
  return { ...ctx, attributes };
}

// Read a named per-element attribute, or `undefined` when the element does not carry one.
//
// This is the single read path for Part 5's custom attributes, so a node never has to know whether
// an attribute is built in or user-defined. It returns `undefined` rather than taking a fallback
// parameter deliberately: a fallback with a default value cannot express "absent", because JS
// default parameters fire on an explicitly-passed `undefined` — so `attr(ctx, name, undefined)`
// would quietly become the default and "missing" and "zero" would be indistinguishable. attr() and
// hasAttr() below layer the two behaviours on top of this one honest primitive.
export function attrRaw(ctx, name) {
  const a = ctx?.attributes;
  if (a && name in a) {
    const v = a[name];
    return v === null ? undefined : v;
  }
  // The intrinsics are readable as attributes too, so `Read Attribute "velocity"` works without a
  // separate node per intrinsic.
  switch (name) {
    case 'position': return ctx?.position;
    case 'velocity': return ctx?.velocity;
    case 'normal': return ctx?.normal;
    case 'tangent': return ctx?.tangent;
    case 'age': return ctx?.age;
    case 'life': case 'normalizedAge': return ctx?.life;
    case 'index': case 'id': return ctx?.index;
    case 'seed': return ctx?.seed;
    case 'time': return ctx?.time;
    case 'uv': return ctx?.uv;
    default: return undefined;
  }
}

// Whether the element carries the attribute at all — which is not the same question as whether its
// value is zero.
export function hasAttr(ctx, name) {
  return attrRaw(ctx, name) !== undefined;
}

// Read with a fallback, for the common case where absent and zero mean the same thing.
export function attr(ctx, name, fallback = 0) {
  const v = attrRaw(ctx, name);
  return v === undefined ? fallback : v;
}

// ---------------------------------------------------------------- construction
export function isField(v) {
  return !!v && v.__field === true && typeof v.sample === 'function';
}

export function makeField(type, sample, extra = {}) {
  return { __field: true, type: parseType(type) || parseType('float'), sample, ...extra };
}

export function constantField(type, value) {
  return { __field: true, type: parseType(type) || parseType('float'), constant: value, sample: () => value };
}

export const isConstantField = (f) => isField(f) && 'constant' in f;

// Sample anything: a field is sampled, a plain value is itself. Every consumer of a
// possibly-field input goes through this, which is why nodes downstream of a lifted chain do not
// need a field-aware code path.
export function sampleAny(v, ctx) {
  return isField(v) ? v.sample(ctx) : v;
}

// The inner type of a field, or the type of a plain value's declared type.
export function fieldValueType(f, fallback = 'float') {
  return isField(f) ? formatType(f.type) : fallback;
}

// ---------------------------------------------------------------- field algebra
// map/zip mirror values.js's component machinery one level up. Note both PRESERVE constancy: a
// mapped constant field stays constant, so an optimisation chain (constant -> lifted maths ->
// constant) never silently degrades into per-element sampling.
export function mapField(type, f, fn) {
  if (!isField(f)) return fn(f);
  if (isConstantField(f)) return constantField(type, fn(f.constant));
  return makeField(type, (ctx) => fn(f.sample(ctx)));
}

export function zipFields(type, a, b, fn) {
  if (!isField(a) && !isField(b)) return fn(a, b);
  if (isConstantField(a) && isConstantField(b)) return constantField(type, fn(a.constant, b.constant));
  return makeField(type, (ctx) => fn(sampleAny(a, ctx), sampleAny(b, ctx)));
}

// ---------------------------------------------------------------- spatial operations
// These are the operations that genuinely need to be field-aware (as opposed to the pointwise
// maths, which auto-lifts). Each one manipulates the sample POINT rather than the sampled value.

// Warp: sample `f` at position + offset. `offset` may itself be a field, which is what makes
// domain warping (Part 15) a two-node composition instead of a built-in noise option.
export function warpField(f, offset) {
  if (!isField(f)) return f;
  return makeField(f.type, (ctx) => {
    const o = sampleAny(offset, ctx);
    const p = ctx.position;
    return f.sample(withPosition(ctx, [
      (p?.[0] || 0) + (o?.[0] || 0),
      (p?.[1] || 0) + (o?.[1] || 0),
      (p?.[2] || 0) + (o?.[2] || 0),
    ]));
  });
}

// Transform a field's domain: sampling the result at world point p samples the source at the
// point p expressed in the transform's own space. The INVERSE is applied to the sample point,
// which is the part that is easy to get backwards — moving a noise field "to the right" means
// sampling it further left.
export function transformField(f, transform) {
  if (!isField(f)) return f;
  const inv = V.transformInverse(transform);
  return makeField(f.type, (ctx) => f.sample(withPosition(ctx, V.transformPoint(inv, ctx.position))));
}

// Blur/smooth a field spatially: average N deterministic jittered taps within `radius`. Taps come
// from a fixed low-discrepancy-ish offset table scaled by radius, so the result is identical every
// evaluation (no Math.random anywhere in this engine) and scrub-stable.
const BLUR_TAPS = [
  [0, 0, 0], [0.86, 0.24, -0.44], [-0.71, 0.63, 0.31], [0.19, -0.88, 0.44],
  [-0.34, -0.27, -0.90], [0.55, 0.71, 0.44], [-0.90, -0.35, 0.26], [0.28, 0.41, 0.87],
  [-0.47, 0.83, -0.30], [0.74, -0.52, 0.42], [-0.16, -0.72, -0.68], [0.41, -0.13, -0.90],
];
export function blurField(f, radius, taps = 8) {
  if (!isField(f) || !(radius > 0)) return f;
  const n = Math.max(1, Math.min(BLUR_TAPS.length, Math.round(taps)));
  const typeName = formatType(f.type);
  return makeField(f.type, (ctx) => {
    const p = ctx.position;
    let acc = null;
    for (let i = 0; i < n; i++) {
      const t = BLUR_TAPS[i];
      const v = f.sample(withPosition(ctx, [
        (p?.[0] || 0) + t[0] * radius,
        (p?.[1] || 0) + t[1] * radius,
        (p?.[2] || 0) + t[2] * radius,
      ]));
      const comps = V.toComponents(typeName, v);
      if (!acc) acc = comps;
      else for (let c = 0; c < acc.length; c++) acc[c] += comps[c];
    }
    for (let c = 0; c < acc.length; c++) acc[c] /= n;
    return V.fromComponents(typeName, acc);
  });
}

// Numerical gradient of a scalar field — central differences. This is what turns any scalar field
// into a direction (steepest ascent), and with a cross product, into a curl/vortex field. It is
// the reason the engine does not need a built-in "swirl" primitive.
export function gradientField(f, epsilon = 0.01) {
  const e = Math.max(1e-5, epsilon);
  return makeField(fieldOf('vector3').param ? 'vector3' : 'vector3', (ctx) => {
    const p = ctx.position || ZERO3;
    const at = (dx, dy, dz) => {
      const v = sampleAny(f, withPosition(ctx, [(p[0] || 0) + dx, (p[1] || 0) + dy, (p[2] || 0) + dz]));
      return typeof v === 'number' ? v : V.toComponents('float', v)[0];
    };
    return [
      (at(e, 0, 0) - at(-e, 0, 0)) / (2 * e),
      (at(0, e, 0) - at(0, -e, 0)) / (2 * e),
      (at(0, 0, e) - at(0, 0, -e)) / (2 * e),
    ];
  });
}

// Curl of a vector field — divergence-free by construction, which is exactly what makes curl noise
// read as swirling smoke rather than as particles drifting apart (Part 19).
export function curlField(f, epsilon = 0.01) {
  const e = Math.max(1e-5, epsilon);
  return makeField('vector3', (ctx) => {
    const p = ctx.position || ZERO3;
    const at = (dx, dy, dz) => {
      const v = sampleAny(f, withPosition(ctx, [(p[0] || 0) + dx, (p[1] || 0) + dy, (p[2] || 0) + dz]));
      return V.toComponents('vector3', v);
    };
    const px = at(e, 0, 0), nx = at(-e, 0, 0);
    const py = at(0, e, 0), ny = at(0, -e, 0);
    const pz = at(0, 0, e), nz = at(0, 0, -e);
    const d = 2 * e;
    return [
      (py[2] - ny[2]) / d - (pz[1] - nz[1]) / d,
      (pz[0] - nz[0]) / d - (px[2] - nx[2]) / d,
      (px[1] - nx[1]) / d - (py[0] - ny[0]) / d,
    ];
  });
}

// ---------------------------------------------------------------- structural seeding
// A seed derived from WHERE a node is in the graph, never from evaluation order or array index.
// This is the mechanism behind Part 14's requirement that editing an unrelated branch must not
// change an unrelated random result: `path` is the node's stable id plus its group path, so adding
// or deleting other nodes cannot perturb it.
export function seedFor(path, userSeed = 0, element = 0) {
  return V.mixSeeds(V.mixSeeds(V.hashString(String(path)), userSeed >>> 0), element >>> 0);
}

// Per-element random in [0,1) from a structural seed. Distinct calls with the same (path, seed,
// element, channel) always agree; different channels decorrelate (so a random size and a random
// colour on the same particle are independent, not identical).
export function randomAt(path, userSeed, element, channel = 0) {
  return V.seedToUnit(V.mixSeeds(seedFor(path, userSeed, element), channel >>> 0));
}
