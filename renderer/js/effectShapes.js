// The base-shape system: every primitive an effect can be built around (a slash arc, a ring, a
// lightning bolt, a custom spline...) described as pure math — no three.js in here, so the same
// definitions drive particle emission (spawn a particle at shapePoint(def, u, v)), shape-layer
// meshes (rigbuild.js tessellates shapePolyline into geometry), AND the smoketest can assert on
// exact coordinates without a GPU. All randomness is stateless hashing (lightning's jaggedness is
// a function of its seed), preserving the whole pipeline's same-frame-same-result guarantee.
//
// Conventions: shapes are defined in the effect's local space, Y up, centered on the local
// origin. `u` walks the shape's primary dimension in [0,1]; `v` (also [0,1]) walks the secondary
// dimension where one exists (a sphere's second angle, a rect's height, a ring's band width) and
// is ignored by pure paths (line, arc, spiral...). Both always clamp, never wrap — wrapping is
// the caller's decision.

function hash01(a, b = 0) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
  return x - Math.floor(x);
}
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const TAU = Math.PI * 2;

// Every primitive: label + editable params (with UI metadata) + point(def, u, v) → [x,y,z].
// Params deliberately stay few and physical (radius, height, turns...) — "artistic intent, not
// Roblox plumbing". A new primitive = one entry here; the studio UI, emission sampling, mesh
// tessellation, presets, and validation all pick it up automatically.
export const SHAPE_KINDS = {
  point: {
    label: 'Point', params: [],
    point: () => [0, 0, 0],
  },
  line: {
    label: 'Line', params: [{ key: 'length', label: 'Length', def: 4, min: 0.05, max: 100 }],
    point: (d, u) => [0, 0, (u - 0.5) * d.length],
  },
  arc: {
    label: 'Arc',
    params: [
      { key: 'radius', label: 'Radius', def: 2, min: 0.05, max: 100 },
      { key: 'angleDeg', label: 'Angle°', def: 120, min: 5, max: 360 },
    ],
    point: (d, u) => {
      const a = (u - 0.5) * (d.angleDeg * Math.PI / 180);
      return [Math.sin(a) * d.radius, 0, -Math.cos(a) * d.radius];
    },
  },
  circle: {
    label: 'Circle', params: [{ key: 'radius', label: 'Radius', def: 2, min: 0.05, max: 100 }],
    point: (d, u) => [Math.cos(u * TAU) * d.radius, 0, Math.sin(u * TAU) * d.radius],
    closed: true,
  },
  ring: {
    label: 'Ring',
    params: [
      { key: 'radius', label: 'Radius', def: 2, min: 0.05, max: 100 },
      { key: 'width', label: 'Band width', def: 0.5, min: 0.01, max: 50 },
    ],
    point: (d, u, v = 0.5) => {
      const r = d.radius + (v - 0.5) * d.width;
      return [Math.cos(u * TAU) * r, 0, Math.sin(u * TAU) * r];
    },
    closed: true,
  },
  sphere: {
    label: 'Sphere', params: [{ key: 'radius', label: 'Radius', def: 1.5, min: 0.05, max: 100 }],
    point: (d, u, v = 0.5) => {
      // u = azimuth, v = polar via arccos for uniform area distribution over the surface.
      const phi = u * TAU;
      const cosT = 1 - 2 * clamp01(v);
      const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
      return [Math.cos(phi) * sinT * d.radius, cosT * d.radius, Math.sin(phi) * sinT * d.radius];
    },
    surface: true,
  },
  cone: {
    label: 'Cone',
    params: [
      { key: 'radius', label: 'Base radius', def: 1.5, min: 0.05, max: 100 },
      { key: 'height', label: 'Height', def: 2.5, min: 0.05, max: 100 },
    ],
    point: (d, u, v = 1) => {
      // Apex at origin opening upward: v walks apex→rim, u spins around.
      const r = d.radius * clamp01(v);
      return [Math.cos(u * TAU) * r, d.height * clamp01(v), Math.sin(u * TAU) * r];
    },
    surface: true,
  },
  slash: {
    label: 'Slash',
    params: [
      { key: 'radius', label: 'Radius', def: 2.5, min: 0.05, max: 100 },
      { key: 'angleDeg', label: 'Sweep°', def: 150, min: 10, max: 360 },
      { key: 'tiltDeg', label: 'Tilt°', def: 25, min: -90, max: 90 },
    ],
    // A sword-slash crescent: an arc swept in a plane tilted off horizontal — the classic
    // anime-slash silhouette when rendered as a ribbon with tapering thickness.
    point: (d, u, v = 0.5) => {
      const a = (u - 0.5) * (d.angleDeg * Math.PI / 180);
      const tilt = d.tiltDeg * Math.PI / 180;
      const x = Math.sin(a) * d.radius;
      const z = -Math.cos(a) * d.radius;
      // v spreads across the blade's width, thickest mid-sweep, tapering to the tips.
      const taper = Math.sin(clamp01(u) * Math.PI);
      const w = (v - 0.5) * 0.7 * taper;
      return [x, z * Math.sin(tilt) + w * Math.cos(tilt), z * Math.cos(tilt) - w * Math.sin(tilt)];
    },
    surface: true,
  },
  ribbon: {
    label: 'Ribbon',
    params: [
      { key: 'length', label: 'Length', def: 5, min: 0.1, max: 100 },
      { key: 'waveAmp', label: 'Wave', def: 0.4, min: 0, max: 20 },
      { key: 'cycles', label: 'Cycles', def: 1.5, min: 0, max: 20 },
    ],
    point: (d, u) => [Math.sin(u * TAU * d.cycles) * d.waveAmp, 0, (u - 0.5) * d.length],
  },
  cylinder: {
    label: 'Cylinder',
    params: [
      { key: 'radius', label: 'Radius', def: 1.5, min: 0.05, max: 100 },
      { key: 'height', label: 'Height', def: 3, min: 0.05, max: 100 },
    ],
    point: (d, u, v = 0.5) => [Math.cos(u * TAU) * d.radius, clamp01(v) * d.height, Math.sin(u * TAU) * d.radius],
    surface: true,
  },
  wave: {
    label: 'Wave',
    params: [
      { key: 'length', label: 'Length', def: 6, min: 0.1, max: 100 },
      { key: 'amplitude', label: 'Amplitude', def: 0.8, min: 0, max: 20 },
      { key: 'cycles', label: 'Cycles', def: 2, min: 0.25, max: 20 },
    ],
    point: (d, u) => [(u - 0.5) * d.length, Math.sin(u * TAU * d.cycles) * d.amplitude, 0],
  },
  spiral: {
    label: 'Spiral',
    params: [
      { key: 'radius', label: 'Radius', def: 1.5, min: 0.05, max: 100 },
      { key: 'turns', label: 'Turns', def: 3, min: 0.25, max: 20 },
      { key: 'height', label: 'Height', def: 3, min: 0, max: 100 },
    ],
    point: (d, u) => [Math.cos(u * TAU * d.turns) * d.radius, u * d.height, Math.sin(u * TAU * d.turns) * d.radius],
  },
  lightning: {
    label: 'Lightning',
    params: [
      { key: 'length', label: 'Length', def: 6, min: 0.1, max: 100 },
      { key: 'jag', label: 'Jaggedness', def: 0.8, min: 0, max: 10 },
      { key: 'segments', label: 'Segments', def: 9, min: 2, max: 40, step: 1 },
      { key: 'seed', label: 'Seed', def: 1, min: 0, max: 9999, step: 1 },
    ],
    // A jagged polyline from top to bottom: deterministic per-segment lateral offsets from the
    // seed, zero offset pinned at both endpoints so the bolt always connects its ends.
    point: (d, u) => {
      const segs = Math.max(2, Math.round(d.segments));
      const su = clamp01(u) * segs;
      const i = Math.min(segs - 1, Math.floor(su));
      const f = su - i;
      const offAt = (k) => {
        if (k <= 0 || k >= segs) return [0, 0];
        return [(hash01(k, d.seed) - 0.5) * 2 * d.jag, (hash01(k, d.seed + 77) - 0.5) * 2 * d.jag];
      };
      const [x0, z0] = offAt(i), [x1, z1] = offAt(i + 1);
      return [x0 + (x1 - x0) * f, (1 - clamp01(u)) * d.length, z0 + (z1 - z0) * f];
    },
  },
  rect: {
    label: 'Rectangle',
    params: [
      { key: 'width', label: 'Width', def: 4, min: 0.05, max: 100 },
      { key: 'depth', label: 'Depth', def: 4, min: 0.05, max: 100 },
    ],
    point: (d, u, v = 0.5) => [(u - 0.5) * d.width, 0, (clamp01(v) - 0.5) * d.depth],
    surface: true,
  },
  spline: {
    label: 'Custom spline',
    params: [], // edited via points, not sliders
    point: (d, u) => splinePoint(d, u),
  },
};

export const SHAPE_KIND_KEYS = Object.keys(SHAPE_KINDS);

export function defaultShape(kind) {
  const meta = SHAPE_KINDS[kind] || SHAPE_KINDS.point;
  const def = { kind: SHAPE_KINDS[kind] ? kind : 'point' };
  for (const p of meta.params) def[p.key] = p.def;
  if (def.kind === 'spline') {
    // A gentle S as the starting spline: enough points to make "drag these" self-evident.
    def.points = [
      { p: [-2, 0, 0], h: [0.8, 0, 1] },
      { p: [0, 0.6, 0], h: [0.8, 0, -0.6] },
      { p: [2, 0, 0], h: [0.8, 0, 1] },
    ];
    def.closed = false;
  }
  return def;
}

// Cubic bezier through spline control points: each point carries a symmetric handle vector `h`
// (out-handle = p + h, in-handle of the NEXT segment's start = p - h) — one draggable handle per
// point keeps the editing model simple while still giving real curvature control.
function splinePoint(def, u) {
  const pts = def.points || [];
  if (pts.length === 0) return [0, 0, 0];
  if (pts.length === 1) return pts[0].p.slice();
  const segCount = def.closed ? pts.length : pts.length - 1;
  const su = clamp01(u) * segCount;
  const i = Math.min(segCount - 1, Math.floor(su));
  const t = su - i;
  const a = pts[i], b = pts[(i + 1) % pts.length];
  const ah = a.h || [0, 0, 0], bh = b.h || [0, 0, 0];
  const p0 = a.p, p3 = b.p;
  const p1 = [p0[0] + ah[0], p0[1] + ah[1], p0[2] + ah[2]];
  const p2 = [p3[0] - bh[0], p3[1] - bh[1], p3[2] - bh[2]];
  const mt = 1 - t;
  const c0 = mt * mt * mt, c1 = 3 * mt * mt * t, c2 = 3 * mt * t * t, c3 = t * t * t;
  return [
    c0 * p0[0] + c1 * p1[0] + c2 * p2[0] + c3 * p3[0],
    c0 * p0[1] + c1 * p1[1] + c2 * p2[1] + c3 * p3[1],
    c0 * p0[2] + c1 * p1[2] + c2 * p2[2] + c3 * p3[2],
  ];
}

// One point on/in a shape. u walks the primary dimension; v the secondary one (surface shapes).
export function shapePoint(def, u, v = 0.5) {
  const meta = SHAPE_KINDS[def?.kind] || SHAPE_KINDS.point;
  const filled = { ...defaultShape(def?.kind || 'point'), ...(def || {}) };
  const p = meta.point(filled, clamp01(u), v);
  return [p[0], p[1], p[2]];
}

// Central-difference tangent — good enough for orienting ribbons/tube segments, and it works
// uniformly for every kind without each primitive needing an analytic derivative.
export function shapeTangent(def, u, v = 0.5) {
  const eps = 0.002;
  const a = shapePoint(def, Math.max(0, u - eps), v);
  const b = shapePoint(def, Math.min(1, u + eps), v);
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
}

// Tessellate the shape's primary path into `segments+1` points — what mesh building and the
// studio's shape overlays consume. Surface shapes tessellate their characteristic outline
// (v = its default), which is exactly what you want to SEE as "the shape" in a viewport.
export function shapePolyline(def, segments = 48) {
  const pts = [];
  for (let i = 0; i <= segments; i++) pts.push(shapePoint(def, i / segments));
  return pts;
}

export function isClosedShape(def) {
  return !!(SHAPE_KINDS[def?.kind]?.closed || (def?.kind === 'spline' && def.closed));
}
export function isSurfaceShape(def) {
  return !!SHAPE_KINDS[def?.kind]?.surface;
}
