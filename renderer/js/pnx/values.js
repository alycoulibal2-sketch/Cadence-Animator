// PNX value layer: the concrete representation of every implemented type, plus the generic
// component-wise machinery the math/vector/colour node families are built on.
//
// Rotation and transform maths deliberately route through cf.js rather than being reimplemented:
// cf.js is this codebase's established pure-maths leaf, its Euler convention matches Roblox's
// (R = Rx·Ry·Rz, i.e. CFrame.Angles / fromEulerAnglesXYZ), and going through it is what makes
// "rotate 30° about X" mean the same thing in the animator and in a VFX graph.
//
// Representations:
//   float/int      number
//   bool           boolean
//   string         string
//   vector2/3/4    [x, y, ...]                 plain arrays
//   color          [r, g, b, a]                linear, 0..1 nominal, >1 allowed for emission
//   quaternion     [x, y, z, w]                w last
//   transform      { p:[3], q:[4], s:[3] }     position, rotation, scale
//   matrix4        [16]                        row-major
//   curve          { kind, keys:[{t,v,es,ed,bez}] }   key shape is effectModel.js's, so
//                                              easing.js evaluates it unchanged
//   gradient       { kind, stops:[{t,v}] }     rampEval.js's shape
//   field<T>       see fields.js

import * as CF from '../cf.js';

export const EPSILON = 1e-9;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Coerce non-numbers to 0 but let NaN and Infinity THROUGH. Used by the struct constructors, and
// the distinction matters: the evaluator NaN-checks every value crossing a socket so it can name
// the node that produced it (see evaluator.js). A constructor that quietly zeroed NaN would leave
// the user with a transform silently snapped to the origin and no diagnostic explaining why — the
// exact failure mode that check exists to prevent. sanitize() does the repair, one layer up, after
// the warning has been raised.
const numKeepBad = (v) => (typeof v === 'number' ? v : 0);
export const clamp = (v, lo, hi) => Math.min(Math.max(num(v), lo), hi);
export const clamp01 = (v) => clamp(v, 0, 1);

// ---------------------------------------------------------------- component-wise machinery
// The component counts the generic numeric node families operate over. `transform` and
// `quaternion` are deliberately absent: component-wise addition of a rotation is meaningless, and
// the spec gives both their own dedicated operation sets.
export const COMPONENTS = { float: 1, int: 1, bool: 1, vector2: 2, vector3: 3, vector4: 4, color: 4, matrix4: 16 };

// The type list a generic numeric node should accept. Kept here (not duplicated in every node
// module) so widening the engine's numeric reach is a one-line change.
export const NUMERIC_KINDS = ['float', 'int', 'vector2', 'vector3', 'vector4', 'color'];
export const SCALAR_KINDS = ['float', 'int'];

export function componentCount(typeName) {
  return COMPONENTS[typeName] || 1;
}

export function toComponents(typeName, v) {
  const n = componentCount(typeName);
  if (n === 1) return [typeof v === 'boolean' ? (v ? 1 : 0) : num(v)];
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = num(v?.[i]);
  return out;
}

// Rebuild a value of `typeName` from components. Colour alpha defaults to opaque when a shorter
// array is supplied, so `float -> color` style widening never produces an invisible result.
export function fromComponents(typeName, arr) {
  const n = componentCount(typeName);
  if (typeName === 'bool') return num(arr[0]) !== 0;
  if (typeName === 'int') return Math.round(num(arr[0]));
  if (n === 1) return num(arr[0]);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = num(arr[i]);
  if (typeName === 'color' && arr.length < 4) out[3] = 1;
  return out;
}

// Coerce a value of UNKNOWN provenance into a known kind, falling back when it cannot be read.
//
// The type system handles typed sockets; this is for the untyped edges of the engine — a custom
// attribute, a value from a project file, an MCP call. A scalar broadcasts to every component (so an
// attribute written as a number reads sensibly as a vector), a longer array is truncated, a shorter
// one is padded from the fallback rather than with zeros — padding a colour with zeros would turn a
// two-channel write into a transparent black, which reads as "my effect vanished".
export function coerceToKind(typeName, value, fallback = 0) {
  if (value === undefined || value === null) return fallback;
  const n = componentCount(typeName);
  if (typeName === 'bool') return typeof value === 'boolean' ? value : num(Array.isArray(value) ? value[0] : value) !== 0;
  if (typeof value === 'number' || typeof value === 'boolean') {
    const s = typeof value === 'boolean' ? (value ? 1 : 0) : value;
    return n === 1 ? fromComponents(typeName, [s]) : fromComponents(typeName, new Array(n).fill(s));
  }
  if (Array.isArray(value)) {
    if (n === 1) return fromComponents(typeName, [value[0]]);
    const pad = toComponents(typeName, fallback);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = value[i] === undefined ? pad[i] : num(value[i]);
    return fromComponents(typeName, out);
  }
  return fallback;
}

// map/zip over a value's components, preserving its type. These two functions are what let one
// `Add` or one `Sine` implementation serve every numeric type in the engine.
export function mapValue(typeName, v, fn) {
  const c = toComponents(typeName, v);
  for (let i = 0; i < c.length; i++) c[i] = fn(c[i], i);
  return fromComponents(typeName, c);
}

export function zipValue(typeName, a, b, fn) {
  const ca = toComponents(typeName, a), cb = toComponents(typeName, b);
  const out = new Array(ca.length);
  for (let i = 0; i < ca.length; i++) out[i] = fn(ca[i], cb[i], i);
  return fromComponents(typeName, out);
}

export function zip3Value(typeName, a, b, c, fn) {
  const ca = toComponents(typeName, a), cb = toComponents(typeName, b), cc = toComponents(typeName, c);
  const out = new Array(ca.length);
  for (let i = 0; i < ca.length; i++) out[i] = fn(ca[i], cb[i], cc[i], i);
  return fromComponents(typeName, out);
}

// ---------------------------------------------------------------- vector maths
export const vLength = (v) => Math.hypot(...v.map(num));
export const vDot = (a, b) => a.reduce((s, x, i) => s + num(x) * num(b?.[i]), 0);

export function vNormalize(v) {
  const l = vLength(v);
  return l < EPSILON ? v.map(() => 0) : v.map((x) => num(x) / l);
}

export function vCross(a, b) {
  return [
    num(a[1]) * num(b[2]) - num(a[2]) * num(b[1]),
    num(a[2]) * num(b[0]) - num(a[0]) * num(b[2]),
    num(a[0]) * num(b[1]) - num(a[1]) * num(b[0]),
  ];
}

export function vDistance(a, b) {
  return Math.hypot(...a.map((x, i) => num(x) - num(b?.[i])));
}

// Angle between two vectors in radians, 0..PI. Zero-length inputs give 0 rather than NaN — a NaN
// escaping into a position is the single worst failure mode in a particle system, so every
// degenerate case in this file resolves to a finite value.
export function vAngle(a, b) {
  const la = vLength(a), lb = vLength(b);
  if (la < EPSILON || lb < EPSILON) return 0;
  return Math.acos(clamp(vDot(a, b) / (la * lb), -1, 1));
}

// Signed angle from a to b about `axis` (right-hand rule), -PI..PI.
export function vSignedAngle(a, b, axis) {
  const unsigned = vAngle(a, b);
  const c = vCross(a, b);
  return vDot(c, axis) < 0 ? -unsigned : unsigned;
}

// Mirror `v` about the plane whose normal is `n` — the reflection convention where the incoming
// direction bounces off a surface: v - 2(v·n̂)n̂.
export function vReflect(v, n) {
  const nn = vNormalize(n);
  const d = vDot(v, nn);
  return v.map((x, i) => num(x) - 2 * d * num(nn[i]));
}

// Snell refraction of a direction through a surface with normal `n` and relative index `eta`.
// Total internal reflection returns the zero vector, which downstream Length/If nodes can detect —
// silently returning the reflection instead would hide a real physical condition.
export function vRefract(v, n, eta) {
  const i = vNormalize(v), nn = vNormalize(n);
  const cosi = -clamp(vDot(nn, i), -1, 1);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return i.map(() => 0);
  const s = eta * cosi - Math.sqrt(k);
  return i.map((x, idx) => eta * num(x) + s * num(nn[idx]));
}

// Component of `v` along `onto` (Project), and the remainder (Reject).
export function vProject(v, onto) {
  const l2 = vDot(onto, onto);
  if (l2 < EPSILON) return v.map(() => 0);
  const k = vDot(v, onto) / l2;
  return onto.map((x) => num(x) * k);
}
export function vReject(v, onto) {
  const p = vProject(v, onto);
  return v.map((x, i) => num(x) - num(p[i]));
}

// Rotate a 3-vector about an arbitrary axis by `angleRad` (Rodrigues, via cf.js so the sign
// convention matches every rotation elsewhere in the app).
export function vRotateAxis(v, axis, angleRad) {
  if (vLength(axis) < EPSILON) return v.slice();
  return CF.rotateVector(CF.axisAngle(axis, angleRad), [num(v[0]), num(v[1]), num(v[2])]);
}

// ---------------------------------------------------------------- quaternions
export function qNormalize(q) {
  const l = Math.hypot(num(q[0]), num(q[1]), num(q[2]), num(q[3]));
  return l < EPSILON ? [0, 0, 0, 1] : [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export function qMultiply(a, b) {
  const [ax, ay, az, aw] = a.map(num), [bx, by, bz, bw] = b.map(num);
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export const qConjugate = (q) => [-num(q[0]), -num(q[1]), -num(q[2]), num(q[3])];
export const qInverse = (q) => qConjugate(qNormalize(q));

export function qFromAxisAngle(axis, angleRad) {
  return CF.toQuat(CF.axisAngle(axis, angleRad));
}

// Euler <-> quaternion through cf.js, so the composition order (Rx·Ry·Rz) is the app's single
// definition of what an Euler triple means.
export function qFromEuler(rx, ry, rz) {
  return CF.toQuat(CF.fromEuler(num(rx), num(ry), num(rz)));
}
export function qToEuler(q) {
  return CF.toEuler(CF.fromQuatPos(qNormalize(q), 0, 0, 0));
}

export function qRotateVector(q, v) {
  return CF.rotateVector(CF.fromQuatPos(qNormalize(q), 0, 0, 0), [num(v[0]), num(v[1]), num(v[2])]);
}

// Shortest-arc rotation taking direction a to direction b. Returns identity when either is
// degenerate or they already agree.
export function qBetween(a, b) {
  const cf = CF.rotationBetween([num(a[0]), num(a[1]), num(a[2])], [num(b[0]), num(b[1]), num(b[2])]);
  return cf ? CF.toQuat(cf) : [0, 0, 0, 1];
}

export function qSlerp(a, b, t) {
  const cf = CF.lerp(CF.fromQuatPos(qNormalize(a), 0, 0, 0), CF.fromQuatPos(qNormalize(b), 0, 0, 0), clamp01(t));
  return CF.toQuat(cf);
}

// A rotation aiming local -Z... no: this app's convention is that a part's FORWARD is local +Y for
// emitters (vfx.js's localUpInWorld reads column +Y). Look-at therefore aims local +Y at the
// target and uses `up` only to resolve the remaining roll.
export function qLookAt(from, to, up = [0, 1, 0]) {
  const dir = vNormalize([num(to[0]) - num(from[0]), num(to[1]) - num(from[1]), num(to[2]) - num(from[2])]);
  if (vLength(dir) < EPSILON) return [0, 0, 0, 1];
  const aim = qBetween([0, 1, 0], dir);
  // Roll-resolve: rotate about the aim direction until the transformed local +Z is as close to
  // `up` as the aim allows. Skipped when `up` is parallel to the aim (roll is then undefined).
  const side = vCross(dir, up);
  if (vLength(side) < 1e-5) return aim;
  const currentZ = qRotateVector(aim, [0, 0, 1]);
  const wantZ = vNormalize(vReject(up, dir));
  const roll = vSignedAngle(vNormalize(vReject(currentZ, dir)), wantZ, dir);
  return qMultiply(qFromAxisAngle(dir, roll), aim);
}

// ---------------------------------------------------------------- transforms
export const newTransform = (p = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) => ({
  p: [numKeepBad(p[0]), numKeepBad(p[1]), numKeepBad(p[2])],
  q: qNormalize(q),
  s: [numKeepBad(s[0]) || 1, numKeepBad(s[1]) || 1, numKeepBad(s[2]) || 1],
});

export const IDENTITY_TRANSFORM = Object.freeze(newTransform());

export function asTransform(v) {
  if (v && Array.isArray(v.p)) return v;
  if (Array.isArray(v) && v.length === 12) return newTransform([v[0], v[1], v[2]], CF.toQuat(v));
  if (Array.isArray(v) && v.length === 3) return newTransform(v);
  return newTransform();
}

// transform -> flat-12 CFrame. SCALE IS DROPPED — a Roblox CFrame cannot carry it. Every caller
// that goes through here is exporting or handing off to cf.js/the animator, where non-unit scale
// has no representation; the transform's own scale stays available separately.
export function transformToCFrame(t) {
  const tr = asTransform(t);
  return CF.fromQuatPos(tr.q, tr.p[0], tr.p[1], tr.p[2]);
}

export function transformFromCFrame(cf, scale = [1, 1, 1]) {
  return newTransform([cf[0], cf[1], cf[2]], CF.toQuat(cf), scale);
}

// Compose: apply `b` first, then `a` (the same argument order as CF.mul and matrix multiplication).
export function transformMultiply(a, b) {
  const ta = asTransform(a), tb = asTransform(b);
  const scaledP = [num(tb.p[0]) * ta.s[0], num(tb.p[1]) * ta.s[1], num(tb.p[2]) * ta.s[2]];
  const rotated = qRotateVector(ta.q, scaledP);
  return newTransform(
    [ta.p[0] + rotated[0], ta.p[1] + rotated[1], ta.p[2] + rotated[2]],
    qMultiply(ta.q, tb.q),
    [ta.s[0] * tb.s[0], ta.s[1] * tb.s[1], ta.s[2] * tb.s[2]],
  );
}

export function transformInverse(t) {
  const tr = asTransform(t);
  const invS = tr.s.map((v) => (Math.abs(v) < EPSILON ? 0 : 1 / v));
  const invQ = qInverse(tr.q);
  const p = qRotateVector(invQ, [-tr.p[0], -tr.p[1], -tr.p[2]]);
  return newTransform([p[0] * invS[0], p[1] * invS[1], p[2] * invS[2]], invQ, invS);
}

// Points carry the translation; directions do not (Part 45's world/local distinction rests on
// exactly this pair being separate operations, never one function with a flag nobody sets).
export function transformPoint(t, v) {
  const tr = asTransform(t);
  const scaled = [num(v[0]) * tr.s[0], num(v[1]) * tr.s[1], num(v[2]) * tr.s[2]];
  const r = qRotateVector(tr.q, scaled);
  return [r[0] + tr.p[0], r[1] + tr.p[1], r[2] + tr.p[2]];
}

export function transformDirection(t, v) {
  const tr = asTransform(t);
  return qRotateVector(tr.q, [num(v[0]) * tr.s[0], num(v[1]) * tr.s[1], num(v[2]) * tr.s[2]]);
}

// ---------------------------------------------------------------- matrices (row-major 4x4)
export function m4Multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += num(a[r * 4 + k]) * num(b[k * 4 + c]);
      out[r * 4 + c] = s;
    }
  }
  return out;
}

export function m4FromTransform(t) {
  const tr = asTransform(t);
  const cf = CF.fromQuatPos(tr.q, 0, 0, 0);
  const [, , , r00, r01, r02, r10, r11, r12, r20, r21, r22] = cf;
  const [sx, sy, sz] = tr.s;
  return [
    r00 * sx, r01 * sy, r02 * sz, tr.p[0],
    r10 * sx, r11 * sy, r12 * sz, tr.p[1],
    r20 * sx, r21 * sy, r22 * sz, tr.p[2],
    0, 0, 0, 1,
  ];
}

// Decompose a 4x4 back into position/rotation/scale. Shear (a non-orthogonal upper 3x3) cannot be
// represented by a transform and is discarded by the orthonormalisation — that is a real,
// documented loss, not an approximation to gloss over.
export function m4ToTransform(m) {
  const sx = Math.hypot(num(m[0]), num(m[4]), num(m[8]));
  const sy = Math.hypot(num(m[1]), num(m[5]), num(m[9]));
  const sz = Math.hypot(num(m[2]), num(m[6]), num(m[10]));
  const dx = sx < EPSILON ? 1 : sx, dy = sy < EPSILON ? 1 : sy, dz = sz < EPSILON ? 1 : sz;
  const cf = CF.orthonormalize([
    num(m[3]), num(m[7]), num(m[11]),
    num(m[0]) / dx, num(m[1]) / dy, num(m[2]) / dz,
    num(m[4]) / dx, num(m[5]) / dy, num(m[6]) / dz,
    num(m[8]) / dx, num(m[9]) / dy, num(m[10]) / dz,
  ]);
  return newTransform([num(m[3]), num(m[7]), num(m[11])], CF.toQuat(cf), [sx, sy, sz]);
}

// ---------------------------------------------------------------- colour
const hexRe = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// Hex is treated as sRGB-encoded (that is what a colour picker hands over) and is NOT
// linearised here: the existing effect pipeline stores and interpolates hex directly, so
// silently changing the numeric meaning of a colour would shift every existing effect. Explicit
// sRGB<->linear nodes exist for when the distinction matters.
export function hexToColor(hex, fallback = [1, 1, 1, 1]) {
  const m = hexRe.exec(String(hex || '').trim());
  if (!m) return fallback.slice();
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const v = parseInt(h.slice(0, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, a];
}

export function colorToHex(c) {
  const ch = (v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  return `#${ch(c?.[0])}${ch(c?.[1])}${ch(c?.[2])}`;
}

export const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
export const linearToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055);

// Rec. 709 luminance — the same weights three.js and Roblox's own tone mapping use.
export const luminance = (c) => 0.2126 * num(c?.[0]) + 0.7152 * num(c?.[1]) + 0.0722 * num(c?.[2]);

export function rgbToHsv(c) {
  const r = num(c?.[0]), g = num(c?.[1]), b = num(c?.[2]);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > EPSILON) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, max < EPSILON ? 0 : d / max, max];
}

export function hsvToRgb(h, s, v) {
  const hh = ((num(h) % 1) + 1) % 1;
  const i = Math.floor(hh * 6), f = hh * 6 - i;
  const sat = clamp01(s), val = num(v);
  const p = val * (1 - sat), q = val * (1 - f * sat), t = val * (1 - (1 - f) * sat);
  switch (i % 6) {
    case 0: return [val, t, p];
    case 1: return [q, val, p];
    case 2: return [p, val, t];
    case 3: return [p, q, val];
    case 4: return [t, p, val];
    default: return [val, p, q];
  }
}

export function rgbToHsl(c) {
  const r = num(c?.[0]), g = num(c?.[1]), b = num(c?.[2]);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2, d = max - min;
  if (d < EPSILON) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

export function hslToRgb(h, s, l) {
  const sat = clamp01(s), lig = num(l);
  if (sat < EPSILON) return [lig, lig, lig];
  const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
  const p = 2 * lig - q;
  const hh = ((num(h) % 1) + 1) % 1;
  const chan = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [chan(hh + 1 / 3), chan(hh), chan(hh - 1 / 3)];
}

// Blackbody / colour-temperature approximation (Tanner Helland's fit to the Planckian locus,
// valid roughly 1000K-40000K). An APPROXIMATION, stated as such: a physically exact spectral
// integration is not what a stylised VFX tool needs, but the fit is close enough that 1700K reads
// as candle flame and 6500K as neutral daylight, which is the actual requirement.
export function temperatureToColor(kelvin) {
  const t = clamp(kelvin, 1000, 40000) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [clamp01(r / 255), clamp01(g / 255), clamp01(b / 255), 1];
}

export function premultiply(c) {
  const a = clamp01(c?.[3] ?? 1);
  return [num(c?.[0]) * a, num(c?.[1]) * a, num(c?.[2]) * a, a];
}
export function unpremultiply(c) {
  const a = clamp01(c?.[3] ?? 1);
  if (a < EPSILON) return [0, 0, 0, 0];
  return [num(c?.[0]) / a, num(c?.[1]) / a, num(c?.[2]) / a, a];
}

// ---------------------------------------------------------------- deterministic hashing
// The SAME construction vfx.js, effectEngine.js and expr.js already use, so a value randomised in
// a graph and one randomised by the legacy engine draw from the same distribution and a port
// between the two is verifiable rather than "looks about right".
export function hash01(a, b = 0) {
  const x = Math.sin(num(a) * 127.1 + num(b) * 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

// Integer hash for seed derivation: stable across runs and platforms (pure 32-bit integer
// arithmetic — no floating point, so it cannot drift the way a sin-based hash could between
// engines). FNV-1a over the string, then a final avalanche.
export function hashString(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

export function mixSeeds(a, b) {
  let h = (Math.imul(a >>> 0, 0x9e3779b1) ^ Math.imul(b >>> 0, 0x85ebca6b)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// A uniform [0,1) from an integer seed. Distinct from hash01 in that it takes an already-mixed
// 32-bit seed, so seed derivation (structural, integer) and sampling (float) stay separable.
export const seedToUnit = (seed) => ((seed >>> 0) % 16777216) / 16777216;

// ---------------------------------------------------------------- NaN containment
// Every value crossing a socket boundary passes through here. A NaN or Infinity that reaches a
// particle position or a colour propagates silently and irreversibly — one bad divide can blank an
// entire effect with no visible cause. Sanitising at the boundary means a division by zero
// produces a zero and a diagnostic, never an invisible effect nobody can explain.
export function sanitize(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (Array.isArray(value)) {
    let dirty = false;
    for (let i = 0; i < value.length; i++) {
      if (typeof value[i] === 'number' && !Number.isFinite(value[i])) { dirty = true; break; }
    }
    if (!dirty) return value;
    return value.map((v) => (typeof v === 'number' && !Number.isFinite(v) ? 0 : v));
  }
  // Transforms are structs, not arrays, and a NaN in one is the most damaging kind — it propagates
  // through every subsequent CFrame multiply and blanks whatever it is attached to. A repaired
  // transform falls back to identity rotation/unit scale rather than to zeros, because a zero
  // quaternion and a zero scale are both degenerate in their own right.
  if (value && typeof value === 'object' && Array.isArray(value.p)) {
    if (!hasNonFinite(value)) return value;
    const fix = (arr, dflt) => arr.map((v, idx) => (Number.isFinite(v) ? v : dflt[idx]));
    return {
      p: fix(value.p, [0, 0, 0]),
      q: hasNonFinite(value.q || []) ? [0, 0, 0, 1] : value.q,
      s: fix(value.s || [1, 1, 1], [1, 1, 1]),
    };
  }
  return value;
}

export function hasNonFinite(value) {
  if (typeof value === 'number') return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some((v) => typeof v === 'number' && !Number.isFinite(v));
  if (value && typeof value === 'object' && Array.isArray(value.p)) {
    return [...value.p, ...value.q, ...value.s].some((v) => !Number.isFinite(v));
  }
  return false;
}
