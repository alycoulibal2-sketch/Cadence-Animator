// Signed distance fields (spec Part 20).
//
// An SDF is just a `field<float>` whose value is the signed distance to a surface: negative inside,
// zero exactly on it, positive outside, and the magnitude is how far away you are. That single
// convention is why the spec asks for SDFs as a GENERAL system rather than a modelling feature —
// because one representation serves every use in Part 20's list at once:
//
//   masks        smoothstep the distance to get a soft-edged 0..1 mask
//   spawn regions   "inside" is `distance < 0`; a shell is `abs(distance) < thickness`
//   collisions   the distance is the penetration depth and its gradient is the contact normal
//   materials    distance drives colour, emission, opacity
//   volumes      the distance IS a density source once thresholded
//   geometry     a surface to walk, march or sample
//
// Nothing here is a shape "object". Every node below returns a field, so an SDF composes with the
// entire maths library: multiply two distances, warp one through noise, remap one through a curve.
// The boolean and rounding operators exist because their correct forms are non-obvious, not because
// composition would otherwise be impossible.
//
// EXACTNESS, which matters more than it looks: `min(a, b)` is an exact union only for exact SDFs,
// and several operations below (scaling non-uniformly, twisting, noise displacement) produce a
// distance BOUND rather than a true distance. That is fine for masks and rendering, and it is why
// each such node says so — a raymarcher fed a non-exact field either over-steps and misses the
// surface or crawls. Marking them honestly is the difference between a usable field and a mystery.

import * as V from '../values.js';
import * as F from '../fields.js';
import { node, n, v3, out, mode } from './_helpers.js';

const C = 'SDF';

const posIn = () => ({
  key: 'position', label: 'Position', type: 'field<vector3>', default: [0, 0, 0], defaultFrom: 'position',
  description: 'Where to measure from. Left unconnected it follows the point being evaluated.',
});

// Every primitive is "sample the position field, then apply a closed-form distance". Sharing this
// wrapper keeps the position/space handling identical across all of them — a primitive that read
// ctx.position directly would ignore an incoming Position wire, which is a bug users would report as
// "my SDF ignores the transform I fed it".
function primitive(spec) {
  return node({
    id: spec.id, label: spec.label, category: C, subcategory: 'Primitives',
    aliases: spec.aliases, summary: spec.summary, teach: spec.teach, explain: spec.explain,
    commonUses: spec.commonUses,
    preview: 'sdf',
    exportSupport: spec.exportSupport || 'baked',
    exportNote: spec.exportNote,
    performance: spec.performance || 'cheap',
    inputs: [posIn(), ...spec.inputs],
    outputs: [{ key: 'out', label: 'Distance', type: 'field<float>', unit: 'studs' }],
    evaluate: (api, i) => F.makeField('float', (ctx) => {
      const p = F.sampleAny(i.position, ctx);
      return spec.distance(V.toComponents('vector3', p), i, ctx);
    }),
  });
}

const sub3 = (a, b) => [a[0] - (b?.[0] || 0), a[1] - (b?.[1] || 0), a[2] - (b?.[2] || 0)];
const len3 = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
const len2 = (x, y) => Math.sqrt(x * x + y * y);
// Distance from the origin to the corner of a box, counting only the axes we are outside on. This
// `max(v,0)` + `min(max,0)` pair is the standard exact box distance and gets the INSIDE right too:
// inside, the largest (least negative) component is the distance to the nearest face.
const boxDist = (q) => {
  const ax = Math.max(q[0], 0), ay = Math.max(q[1], 0), az = Math.max(q[2], 0);
  return len3([ax, ay, az]) + Math.min(Math.max(q[0], Math.max(q[1], q[2])), 0);
};

// ---------------------------------------------------------------- primitives
primitive({
  id: 'cadence.sdf.sphere', label: 'Sphere', aliases: ['ball', 'round', 'orb', 'radius', 'blob'],
  summary: 'Distance to the surface of a sphere.',
  teach: 'Negative inside the ball, zero on its skin, positive outside — and the number is how far.',
  commonUses: ['a spherical spawn region', 'a soft radial mask', 'a shockwave front'],
  inputs: [v3('center', 'Centre'), n('radius', 'Radius', 1, { min: 0, unit: 'studs' })],
  distance: (p, i) => len3(sub3(p, i.center)) - Math.max(0, i.radius),
});

primitive({
  id: 'cadence.sdf.box', label: 'Box', aliases: ['cube', 'rectangle', 'brick', 'block'],
  summary: 'Distance to the surface of a box.',
  inputs: [v3('center', 'Centre'), v3('size', 'Half size', [1, 1, 1], { unit: 'studs' })],
  distance: (p, i) => {
    const d = sub3(p, i.center);
    const s = V.toComponents('vector3', i.size);
    return boxDist([Math.abs(d[0]) - Math.abs(s[0]), Math.abs(d[1]) - Math.abs(s[1]), Math.abs(d[2]) - Math.abs(s[2])]);
  },
});

primitive({
  id: 'cadence.sdf.roundedBox', label: 'Rounded Box', aliases: ['soft cube', 'chamfer box', 'radius box'],
  summary: 'Distance to the surface of a box with rounded corners.',
  explain: 'Rounding is subtracted from the distance, which is also why the box shrinks by the rounding amount: the corner radius eats into the half size rather than growing outwards.',
  inputs: [v3('center', 'Centre'), v3('size', 'Half size', [1, 1, 1], { unit: 'studs' }), n('rounding', 'Corner radius', 0.1, { min: 0, unit: 'studs' })],
  distance: (p, i) => {
    const d = sub3(p, i.center);
    const s = V.toComponents('vector3', i.size);
    const r = Math.max(0, i.rounding);
    return boxDist([Math.abs(d[0]) - Math.abs(s[0]) + r, Math.abs(d[1]) - Math.abs(s[1]) + r, Math.abs(d[2]) - Math.abs(s[2]) + r]) - r;
  },
});

primitive({
  id: 'cadence.sdf.plane', label: 'Plane', aliases: ['ground', 'floor', 'wall', 'half space', 'flat'],
  summary: 'Signed distance to an infinite flat plane.',
  explain: 'Positive on the side the normal points towards. An infinite plane is the cheapest possible collider and the natural way to build a ground for particles to bounce on.',
  inputs: [v3('point', 'Point on plane'), v3('normal', 'Normal', [0, 1, 0])],
  distance: (p, i) => {
    const nrm = V.vNormalize(V.toComponents('vector3', i.normal));
    return V.vDot(sub3(p, i.point), nrm);
  },
});

primitive({
  id: 'cadence.sdf.cylinder', label: 'Cylinder', aliases: ['tube', 'pillar', 'rod', 'pipe', 'column'],
  summary: 'Distance to the surface of a capped cylinder.',
  inputs: [v3('center', 'Centre'), n('radius', 'Radius', 1, { min: 0, unit: 'studs' }), n('height', 'Half height', 1, { min: 0, unit: 'studs' }), mode('axis', 'Axis', ['x', 'y', 'z'], 'y')],
  distance: (p, i) => {
    const d = sub3(p, i.center);
    const ai = i.axis === 'x' ? 0 : i.axis === 'z' ? 2 : 1;
    const along = Math.abs(d[ai]) - Math.max(0, i.height);
    const r1 = d[(ai + 1) % 3], r2 = d[(ai + 2) % 3];
    const radial = len2(r1, r2) - Math.max(0, i.radius);
    return Math.min(Math.max(radial, along), 0) + len2(Math.max(radial, 0), Math.max(along, 0));
  },
});

primitive({
  id: 'cadence.sdf.capsule', label: 'Capsule', aliases: ['pill', 'rounded cylinder', 'limb', 'segment'],
  summary: 'Distance to a line segment thickened into a rounded tube.',
  explain: 'The exact distance to a segment, which makes a capsule the cheapest well-behaved collider for anything limb-shaped — and unlike a cylinder it has no sharp rim to catch particles on.',
  inputs: [v3('a', 'From', [0, 0, 0]), v3('b', 'To', [0, 1, 0]), n('radius', 'Radius', 0.25, { min: 0, unit: 'studs' })],
  distance: (p, i) => {
    const a = V.toComponents('vector3', i.a), b = V.toComponents('vector3', i.b);
    const pa = sub3(p, a), ba = sub3(b, a);
    const bb = V.vDot(ba, ba);
    const h = bb <= 1e-12 ? 0 : V.clamp01(V.vDot(pa, ba) / bb);
    return len3([pa[0] - ba[0] * h, pa[1] - ba[1] * h, pa[2] - ba[2] * h]) - Math.max(0, i.radius);
  },
});

primitive({
  id: 'cadence.sdf.cone', label: 'Cone', aliases: ['spike', 'point', 'funnel', 'beam shape'],
  summary: 'Distance to a capped cone standing on its base.',
  exportNote: 'A distance bound near the tip rather than the exact distance — accurate enough for masks, slightly conservative for raymarching.',
  inputs: [v3('center', 'Base centre'), n('radius', 'Base radius', 1, { min: 0, unit: 'studs' }), n('height', 'Height', 2, { min: 1e-4, unit: 'studs' })],
  distance: (p, i) => {
    const d = sub3(p, i.center);
    const h = Math.max(1e-4, i.height), r = Math.max(0, i.radius);
    const q = len2(d[0], d[2]);
    // Distance to the slanted side, and to the base disc; the cone is the intersection of both.
    const side = (q * h + d[1] * r - r * h) / Math.sqrt(h * h + r * r);
    const base = -d[1];
    return Math.max(side, Math.max(base, d[1] - h));
  },
});

primitive({
  id: 'cadence.sdf.torus', label: 'Torus', aliases: ['ring', 'donut', 'halo', 'loop'],
  summary: 'Distance to the surface of a ring.',
  commonUses: ['a halo or portal rim', 'a shockwave ring that has thickness'],
  inputs: [v3('center', 'Centre'), n('major', 'Ring radius', 1, { min: 0, unit: 'studs' }), n('minor', 'Thickness', 0.25, { min: 0, unit: 'studs' }), mode('axis', 'Axis', ['x', 'y', 'z'], 'y')],
  distance: (p, i) => {
    const d = sub3(p, i.center);
    const ai = i.axis === 'x' ? 0 : i.axis === 'z' ? 2 : 1;
    const r1 = d[(ai + 1) % 3], r2 = d[(ai + 2) % 3];
    return len2(len2(r1, r2) - Math.max(0, i.major), d[ai]) - Math.max(0, i.minor);
  },
});

primitive({
  id: 'cadence.sdf.line', label: 'Line', aliases: ['infinite line', 'axis', 'ray distance'],
  summary: 'Distance to an infinite line.',
  explain: 'Unlike Capsule, this does not stop at its endpoints — it is the distance to the line the two points define, extended forever. That is what you want for a beam that should not fade at its ends.',
  inputs: [v3('point', 'Point on line'), v3('direction', 'Direction', [0, 1, 0]), n('radius', 'Radius', 0, { min: 0, unit: 'studs' })],
  distance: (p, i) => {
    const dir = V.vNormalize(V.toComponents('vector3', i.direction));
    const d = sub3(p, i.point);
    const along = V.vDot(d, dir);
    return len3([d[0] - dir[0] * along, d[1] - dir[1] * along, d[2] - dir[2] * along]) - Math.max(0, i.radius);
  },
});

primitive({
  id: 'cadence.sdf.circle', label: 'Circle', aliases: ['disc', 'flat ring', '2d circle'],
  summary: 'Distance to a flat circle lying in a plane.',
  explain: 'A circle has no thickness, so this distance is never negative — nothing is "inside" a flat disc in 3D. Use Cylinder with a small height for a disc you can be inside of.',
  inputs: [v3('center', 'Centre'), n('radius', 'Radius', 1, { min: 0, unit: 'studs' }), mode('axis', 'Axis', ['x', 'y', 'z'], 'y')],
  distance: (p, i) => {
    const d = sub3(p, i.center);
    const ai = i.axis === 'x' ? 0 : i.axis === 'z' ? 2 : 1;
    // Distance to the RING itself: how far off the radius you are, and how far off the plane.
    const radial = len2(d[(ai + 1) % 3], d[(ai + 2) % 3]) - Math.max(0, i.radius);
    return len2(radial, d[ai]);
  },
});

// ---------------------------------------------------------------- booleans
// The smooth variants use the polynomial smooth-minimum. `k` is a blend WIDTH in studs, not a 0..1
// factor, because the amount of visible rounding has to be independent of how large the shapes are —
// a normalised factor would make the same setting look different on a 1-stud and a 100-stud shape.
const smin = (a, b, k) => {
  if (k <= 1e-6) return Math.min(a, b);
  const h = V.clamp01(0.5 + 0.5 * (b - a) / k);
  return b * (1 - h) + a * h - k * h * (1 - h);
};
const smax = (a, b, k) => {
  if (k <= 1e-6) return Math.max(a, b);
  const h = V.clamp01(0.5 - 0.5 * (b - a) / k);
  return b * (1 - h) + a * h + k * h * (1 - h);
};

function boolean(id, label, aliases, summary, fn, extra = {}) {
  return node({
    id, label, category: C, subcategory: 'Combine', aliases, summary,
    teach: extra.teach, explain: extra.explain, commonUses: extra.commonUses,
    preview: 'sdf', exportSupport: 'baked', performance: 'cheap',
    inputs: [
      { key: 'a', label: 'A', type: 'field<float>', default: 0, unit: 'studs' },
      { key: 'b', label: 'B', type: 'field<float>', default: 0, unit: 'studs' },
      ...(extra.smooth ? [n('smoothing', 'Blend width', 0, { min: 0, unit: 'studs' })] : []),
    ],
    outputs: [{ key: 'out', label: 'Distance', type: 'field<float>', unit: 'studs' }],
    evaluate: (api, i) => F.makeField('float', (ctx) => fn(F.sampleAny(i.a, ctx), F.sampleAny(i.b, ctx), Math.max(0, i.smoothing || 0))),
  });
}

boolean('cadence.sdf.union', 'Union', ['combine', 'add shapes', 'merge', 'or', 'either'],
  'Both shapes together.', (a, b) => Math.min(a, b),
  { teach: 'Glues two shapes into one. A point is inside if it is inside either of them.' });

boolean('cadence.sdf.intersect', 'Intersection', ['overlap', 'and', 'both', 'common part'],
  'Only where both shapes overlap.', (a, b) => Math.max(a, b),
  { teach: 'Keeps only the part where the two shapes overlap.' });

boolean('cadence.sdf.subtract', 'Difference', ['cut', 'carve', 'remove', 'minus', 'hole', 'bite'],
  'The first shape with the second cut out of it.', (a, b) => Math.max(a, -b),
  { teach: 'Uses the second shape as a cookie cutter to carve a piece out of the first.',
    explain: 'Negating a distance turns a shape inside out, which is why cutting is an intersection with the inverse. Order matters here, unlike Union and Intersection.' });

boolean('cadence.sdf.smoothUnion', 'Smooth Union', ['blend shapes', 'melt together', 'soft combine', 'metaball', 'fuse'],
  'Both shapes together, blending into each other.', (a, b, k) => smin(a, b, k),
  { smooth: true,
    teach: 'Like Union, but the join melts smoothly instead of leaving a crease.',
    explain: 'Blend width is a real distance in studs, so it means the same thing whatever the size of the shapes. This is what makes blobby, organic, metaball-like forms — two spheres approaching each other reach out and merge.',
    commonUses: ['blobby energy shapes', 'organic growths', 'liquid merging'] });

boolean('cadence.sdf.smoothIntersect', 'Smooth Intersection', ['soft overlap', 'rounded and'],
  'Only where both shapes overlap, with a rounded seam.', (a, b, k) => smax(a, b, k), { smooth: true });

boolean('cadence.sdf.smoothSubtract', 'Smooth Difference', ['soft cut', 'rounded carve', 'melt away'],
  'The first shape with the second melted out of it.', (a, b, k) => smax(a, -b, k), { smooth: true });

// ---------------------------------------------------------------- shape operators
function unary(spec) {
  return node({
    id: spec.id, label: spec.label, category: C, subcategory: 'Shape', aliases: spec.aliases,
    summary: spec.summary, teach: spec.teach, explain: spec.explain, commonUses: spec.commonUses,
    preview: 'sdf', exportSupport: 'baked', performance: spec.performance || 'cheap',
    inputs: [{ key: 'distance', label: 'Distance', type: 'field<float>', default: 0, unit: 'studs' }, ...(spec.inputs || [])],
    outputs: [{ key: 'out', label: 'Distance', type: 'field<float>', unit: 'studs' }],
    evaluate: (api, i) => F.makeField('float', (ctx) => spec.fn(F.sampleAny(i.distance, ctx), i, ctx)),
  });
}

unary({
  id: 'cadence.sdf.round', label: 'Round', aliases: ['inflate', 'fatten', 'soften edges', 'grow'],
  summary: 'Grows a shape outwards, rounding its edges.',
  explain: 'Subtracting a constant from a distance moves the whole surface outwards by that much, and corners become quarter-rounds because a corner is equidistant from more than one face. A negative amount shrinks instead.',
  inputs: [n('amount', 'Amount', 0.1, { unit: 'studs' })],
  fn: (d, i) => d - i.amount,
});

unary({
  id: 'cadence.sdf.shell', label: 'Shell', aliases: ['hollow', 'outline', 'skin', 'surface only', 'onion'],
  summary: 'Keeps only a thin layer at the surface, hollowing the shape out.',
  teach: 'Turns a solid shape into an empty shell, like a chocolate egg.',
  explain: 'The absolute value of a distance is a shape whose inside is the surface of the original. That is the whole trick, and it is what you want for bubbles, force fields and portal rims.',
  commonUses: ['bubble and shield surfaces', 'a ring from a sphere', 'spawning particles on a surface rather than through a volume'],
  inputs: [n('thickness', 'Thickness', 0.1, { min: 0, unit: 'studs' })],
  fn: (d, i) => Math.abs(d) - Math.max(0, i.thickness) * 0.5,
});

unary({
  id: 'cadence.sdf.invert', label: 'Invert', aliases: ['flip inside out', 'negate', 'complement', 'outside'],
  summary: 'Swaps inside and outside.',
  explain: 'Everything that was inside becomes outside. Combined with Intersection this is how cutting works, and on its own it turns a container into the space around it.',
  fn: (d) => -d,
});

// ---------------------------------------------------------------- domain operators
// These transform the SAMPLE POINT, not the distance, which is why they can produce infinite
// repetition from a single finite shape at no extra cost. They also break exactness: after a twist,
// the value is a bound, not a distance.
function domain(spec) {
  return node({
    id: spec.id, label: spec.label, category: C, subcategory: 'Domain', aliases: spec.aliases,
    summary: spec.summary, teach: spec.teach, explain: spec.explain, commonUses: spec.commonUses,
    preview: 'sdf', exportSupport: 'baked', performance: spec.performance || 'cheap',
    exportNote: spec.exportNote,
    inputs: [
      { key: 'shape', label: 'Shape', type: 'field<float>', default: 0, unit: 'studs' },
      ...(spec.inputs || []),
    ],
    outputs: [{ key: 'out', label: 'Distance', type: 'field<float>', unit: 'studs' }],
    evaluate: (api, i) => F.makeField('float', (ctx) => {
      const p = V.toComponents('vector3', ctx.position || [0, 0, 0]);
      const moved = spec.map(p, i, ctx);
      const inner = F.sampleAny(i.shape, F.withPosition(ctx, moved));
      return spec.after ? spec.after(inner, i) : inner;
    }),
  });
}

domain({
  id: 'cadence.sdf.repeat', label: 'Repeat', aliases: ['tile', 'array', 'grid of', 'infinite copies', 'clone'],
  summary: 'Repeats a shape forever on a grid.',
  teach: 'Makes endless copies of the shape, spaced out evenly.',
  explain: 'Costs exactly the same as one copy, because it folds the space rather than duplicating the shape. A spacing of zero on an axis means "do not repeat along that axis".',
  commonUses: ['debris fields', 'a grid of holograms', 'repeating energy rings'],
  inputs: [v3('spacing', 'Spacing', [2, 0, 2], { unit: 'studs' })],
  map: (p, i) => {
    const s = V.toComponents('vector3', i.spacing);
    return p.map((v, a) => (s[a] > 1e-6 ? v - s[a] * Math.round(v / s[a]) : v));
  },
});

domain({
  id: 'cadence.sdf.mirror', label: 'Mirror', aliases: ['symmetry', 'reflect', 'both sides', 'fold'],
  summary: 'Mirrors a shape across the chosen axes.',
  explain: 'Folds space with an absolute value, so only one half of the shape needs to exist. Anything built this way is perfectly symmetric by construction.',
  inputs: [
    { key: 'x', label: 'Mirror X', type: 'bool', default: true },
    { key: 'y', label: 'Mirror Y', type: 'bool', default: false },
    { key: 'z', label: 'Mirror Z', type: 'bool', default: false },
  ],
  map: (p, i) => [i.x ? Math.abs(p[0]) : p[0], i.y ? Math.abs(p[1]) : p[1], i.z ? Math.abs(p[2]) : p[2]],
});

domain({
  id: 'cadence.sdf.twist', label: 'Twist', aliases: ['spiral', 'wring', 'corkscrew', 'spin along axis'],
  summary: 'Twists a shape around an axis, more the further along it you go.',
  commonUses: ['a spiralling energy column', 'a drill or vortex form'],
  exportNote: 'Produces a distance bound rather than an exact distance — fine for masks, conservative for raymarching.',
  inputs: [n('turns', 'Turns per stud', 0.25, { unit: 'turns' }), mode('axis', 'Axis', ['x', 'y', 'z'], 'y')],
  map: (p, i) => {
    const ai = i.axis === 'x' ? 0 : i.axis === 'z' ? 2 : 1;
    const a = p[ai] * i.turns * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const u = (ai + 1) % 3, w = (ai + 2) % 3;
    const q = [0, 0, 0];
    q[ai] = p[ai];
    q[u] = c * p[u] - s * p[w];
    q[w] = s * p[u] + c * p[w];
    return q;
  },
});

domain({
  id: 'cadence.sdf.bend', label: 'Bend', aliases: ['curve shape', 'arc', 'warp along axis'],
  summary: 'Bends a shape around an axis.',
  exportNote: 'Produces a distance bound rather than an exact distance.',
  inputs: [n('amount', 'Amount', 0.2), mode('axis', 'Axis', ['x', 'y', 'z'], 'y')],
  map: (p, i) => {
    const ai = i.axis === 'x' ? 0 : i.axis === 'z' ? 2 : 1;
    const u = (ai + 1) % 3;
    const a = p[u] * i.amount;
    const c = Math.cos(a), s = Math.sin(a);
    const q = [...p];
    q[ai] = c * p[ai] - s * p[u];
    q[u] = s * p[ai] + c * p[u];
    return q;
  },
});

node({
  id: 'cadence.sdf.displace', label: 'Displace', category: C, subcategory: 'Domain',
  aliases: ['noise shape', 'roughen', 'bumpy', 'erode surface', 'organic', 'add noise to shape', 'surface detail', 'perturb'],
  summary: 'Pushes a shape\'s surface in and out by another field.',
  teach: 'Roughens up a smooth shape. Feed it noise to make something look natural instead of manufactured.',
  explain: 'Adding a value to a distance moves the surface. It is the single most useful SDF operator for VFX: a sphere plus noise is a cloud, a fireball, an asteroid or an explosion front, depending only on what noise you feed in and how you colour it. Positive values grow the shape, negative ones eat into it.',
  commonUses: ['fireball and explosion fronts', 'clouds', 'rocks and asteroids', 'dissolving surfaces'],
  preview: 'sdf', exportSupport: 'baked', performance: 'cheap',
  exportNote: 'Produces a distance bound rather than an exact distance; raymarching needs smaller steps.',
  inputs: [
    { key: 'distance', label: 'Distance', type: 'field<float>', default: 0, unit: 'studs' },
    { key: 'amount', label: 'Displacement', type: 'field<float>', default: 0, unit: 'studs' },
  ],
  outputs: [{ key: 'out', label: 'Distance', type: 'field<float>', unit: 'studs' }],
  evaluate: (api, i) => F.makeField('float', (ctx) => F.sampleAny(i.distance, ctx) + F.sampleAny(i.amount, ctx)),
});

// ---------------------------------------------------------------- reading an SDF
// The four ways an SDF becomes something else. Without these, an SDF is a number nobody consumes;
// with them it is Part 20's "usable for geometry, masks, spawn regions, volumes, collisions,
// materials, effects" — each of those is one of the nodes below.
node({
  id: 'cadence.sdf.inside', label: 'Inside', category: C, subcategory: 'Read',
  aliases: ['is inside', 'contained', 'within', 'test point', 'in shape'],
  summary: 'Whether a point is inside a shape.',
  explain: 'Simply "distance is negative". This is the node that turns a shape into a spawn region or a hit test.',
  exportSupport: 'baked',
  inputs: [{ key: 'distance', label: 'Distance', type: 'field<float>', default: 0, unit: 'studs' }],
  outputs: [{ key: 'out', label: 'Inside', type: 'field<bool>' }],
  evaluate: (api, i) => F.makeField('bool', (ctx) => F.sampleAny(i.distance, ctx) < 0),
});

node({
  id: 'cadence.sdf.mask', label: 'Shape Mask', category: C, subcategory: 'Read',
  aliases: ['soft mask', 'falloff', 'fade at edge', 'feather', 'gradient from shape', 'antialias'],
  summary: 'Turns a shape into a soft 0-to-1 mask that fades out over a chosen distance.',
  teach: 'Makes a shape into a fade: fully on inside, fading to nothing as you move away from it.',
  explain: 'One inside the shape, falling to zero `softness` studs outside it. This is the single most-used way to connect an SDF to anything visual — feed it into opacity, into a colour mix, into an emission strength. A softness of zero gives a hard edge, which will alias.',
  commonUses: ['fading particles out at the edge of a region', 'a soft-edged shield', 'masking one effect by a shape'],
  exportSupport: 'baked',
  inputs: [
    { key: 'distance', label: 'Distance', type: 'field<float>', default: 0, unit: 'studs' },
    n('softness', 'Softness', 0.25, { min: 0, unit: 'studs' }),
    { key: 'invert', label: 'Invert', type: 'bool', default: false },
  ],
  outputs: [{ key: 'out', label: 'Mask', type: 'field<float>' }],
  evaluate: (api, i) => F.makeField('float', (ctx) => {
    const d = F.sampleAny(i.distance, ctx);
    const s = Math.max(1e-6, i.softness);
    const t = V.clamp01(1 - d / s);
    const smooth = t * t * (3 - 2 * t);
    return i.invert ? 1 - smooth : smooth;
  }),
});

node({
  id: 'cadence.sdf.normal', label: 'Shape Normal', category: C, subcategory: 'Read',
  aliases: ['surface normal', 'push direction', 'away from shape', 'gradient', 'bounce direction'],
  summary: 'The direction pointing straight out of a shape\'s surface.',
  explain: 'The gradient of a distance field is its surface normal, computed here by measuring the distance a tiny step either side on each axis. This is what gives you a bounce direction for a collision, a push direction for a force, or a normal for shading — from any shape at all, including ones you built by combining others.',
  commonUses: ['bouncing particles off an arbitrary shape', 'pushing particles out of a volume', 'shading a procedural surface'],
  exportSupport: 'baked', performance: 'moderate',
  inputs: [
    { key: 'distance', label: 'Distance', type: 'field<float>', default: 0, unit: 'studs' },
    n('epsilon', 'Sampling step', 0.01, { min: 1e-5, unit: 'studs' }),
  ],
  outputs: [{ key: 'out', label: 'Normal', type: 'field<vector3>' }],
  evaluate: (api, i) => {
    const grad = F.gradientField(i.distance, i.epsilon);
    return F.makeField('vector3', (ctx) => V.vNormalize(grad.sample(ctx)));
  },
});

node({
  id: 'cadence.sdf.surface', label: 'Nearest Surface Point', category: C, subcategory: 'Read',
  aliases: ['closest point', 'snap to surface', 'project onto shape', 'stick to shape'],
  summary: 'The closest point on a shape\'s surface to where you are.',
  explain: 'Step from here by the distance, against the normal, and you land on the surface. Exact for the primitive shapes; approximate after the domain operators, where the distance is a bound rather than a true distance — so it may take a couple of steps to converge.',
  commonUses: ['sticking particles to a surface', 'resolving a collision by pushing out to the skin'],
  exportSupport: 'baked', performance: 'moderate',
  inputs: [
    { key: 'distance', label: 'Distance', type: 'field<float>', default: 0, unit: 'studs' },
    n('epsilon', 'Sampling step', 0.01, { min: 1e-5, unit: 'studs' }),
    { key: 'steps', label: 'Refinement steps', type: 'int', default: 2, min: 1, max: 8 },
  ],
  outputs: [{ key: 'out', label: 'Point', type: 'field<vector3>', unit: 'studs' }],
  evaluate: (api, i) => {
    const grad = F.gradientField(i.distance, i.epsilon);
    const steps = Math.max(1, Math.min(8, Math.round(i.steps)));
    return F.makeField('vector3', (ctx) => {
      let p = V.toComponents('vector3', ctx.position || [0, 0, 0]);
      for (let s = 0; s < steps; s++) {
        const at = F.withPosition(ctx, p);
        const d = F.sampleAny(i.distance, at);
        if (Math.abs(d) < 1e-6) break;
        const nrm = V.vNormalize(grad.sample(at));
        p = [p[0] - nrm[0] * d, p[1] - nrm[1] * d, p[2] - nrm[2] * d];
      }
      return p;
    });
  },
});
