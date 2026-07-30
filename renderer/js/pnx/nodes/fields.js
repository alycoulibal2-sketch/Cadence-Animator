// Field node family (spec Parts 18 and 19) — sources, spatial operations, and vector fields.
//
// This is the family the specification calls one of the most important parts of the engine, and the
// reason is worth stating plainly: a field turns "a value" into "a value that depends on where you
// are". Once that exists, every ordinary maths node in the engine becomes a spatial operator for
// free, and effects that would otherwise need bespoke features become compositions.
//
// The predefined vector fields below are conveniences, NOT the limit (Part 19 is explicit about
// this). Every one of them is a short composition of primitives, and a user can build a field this
// file never anticipated by wiring Position through maths into a vector. The Custom Field node
// exists to make that path obvious rather than clever.

import * as V from '../values.js';
import * as F from '../fields.js';
import { node, n, v3, out, mode } from './_helpers.js';

const C = 'Fields';

const fieldOfFloat = (key, label, dflt = 0) => ({ key, label, type: 'field<float>', default: dflt });
const fieldOfVec = (key, label, dflt = [0, 0, 0]) => ({ key, label, type: 'field<vector3>', default: dflt });

// Falloff shared by every force field. Exponent 0 means no falloff at all (a uniform force),
// 1 is linear, 2 is inverse-square like real gravity. The +epsilon keeps the centre finite: a true
// inverse-square singularity would fling a particle at the exact centre to infinity.
function falloffAt(distance, exponent, radius) {
  if (exponent <= 0) return 1;
  if (radius > 0 && distance > radius) return 0;
  return 1 / Math.pow(Math.max(distance, 1e-3), exponent);
}

// ---------------------------------------------------------------- sources
// The read-only facts about the point being evaluated. These are the entry points into field space:
// almost every graph that does anything spatial starts at one of them.
const source = (id, label, aliases, summary, type, read, extra = {}) => node({
  id, label, category: C, subcategory: 'Sources', aliases, summary,
  exportSupport: extra.exportSupport || 'native',
  explain: extra.explain,
  commonUses: extra.commonUses,
  inputs: [],
  outputs: [{ key: 'out', label, type: `field<${type}>`, unit: extra.unit }],
  evaluate: () => F.makeField(type, read),
});

source('cadence.fields.position', 'Position', ['where', 'location', 'point', 'coordinates', 'xyz', 'place'],
  'Where the thing being evaluated is.', 'vector3', (ctx) => ctx.position || [0, 0, 0],
  { unit: 'studs', explain: 'The starting point for nearly every spatial effect. Feed it into noise for spatial variation, into Distance for a falloff, or into maths for a pattern.' });

source('cadence.fields.normal', 'Normal', ['surface direction', 'facing', 'perpendicular to surface'],
  'Which way the surface faces at this point.', 'vector3', (ctx) => ctx.normal || [0, 1, 0],
  { commonUses: ['rim lighting', 'pushing particles out along a surface'] });

source('cadence.fields.tangent', 'Tangent', ['along surface', 'flow direction', 'curve direction'],
  'The direction running along the surface or curve at this point.', 'vector3', (ctx) => ctx.tangent || [0, 0, 0]);

source('cadence.fields.uv', 'UV', ['texture coordinates', 'surface coordinates', 'st'],
  'The texture coordinates at this point.', 'vector2', (ctx) => ctx.uv || [0, 0]);

source('cadence.fields.velocity', 'Velocity', ['movement', 'motion', 'direction of travel', 'speed vector'],
  'How fast and which way the thing being evaluated is moving.', 'vector3', (ctx) => ctx.velocity || [0, 0, 0],
  { unit: 'studs/second', commonUses: ['stretching a sprite along its motion', 'colouring by speed'] });

source('cadence.fields.index', 'Index', ['id', 'element number', 'particle number', 'which one'],
  'A stable number identifying this particular element.', 'int', (ctx) => ctx.index || 0,
  { explain: 'Stable for the life of the element, and never its position in an array — an element keeps its index however many neighbours are born or die around it. Randomising from this is what makes per-particle variation hold still instead of reshuffling every frame.' });

// ---------------------------------------------------------------- geometric fields
node({
  id: 'cadence.fields.distance', label: 'Distance Field', category: C, subcategory: 'Geometric',
  aliases: ['distance from', 'radius', 'falloff', 'how far', 'proximity', 'range'],
  summary: 'How far each point is from a place.',
  teach: 'Measures the distance from a chosen spot. Feed it into a gradient and you have a glow that fades with distance.',
  commonUses: ['radial falloff', 'a glow around a point', 'shrinking with distance'],
  exportSupport: 'baked',
  inputs: [v3('center', 'From', [0, 0, 0], { unit: 'studs' })],
  outputs: [{ key: 'out', label: 'Distance', type: 'field<float>', unit: 'studs' }],
  evaluate: (api, i) => F.makeField('float', (ctx) => V.vDistance(ctx.position || [0, 0, 0], i.center)),
});

node({
  id: 'cadence.fields.directionFrom', label: 'Direction Field', category: C, subcategory: 'Geometric',
  aliases: ['away from', 'outward', 'radial direction', 'toward centre'],
  summary: 'The unit direction pointing away from a place at each point.',
  exportSupport: 'baked',
  inputs: [v3('center', 'From', [0, 0, 0], { unit: 'studs' })],
  outputs: [{ key: 'out', label: 'Direction', type: 'field<vector3>' }],
  evaluate: (api, i) => F.makeField('vector3', (ctx) => {
    const p = ctx.position || [0, 0, 0];
    return V.vNormalize([p[0] - i.center[0], p[1] - i.center[1], p[2] - i.center[2]]);
  }),
});

// ---------------------------------------------------------------- spatial operations
// The operations that manipulate the sample POINT rather than the sampled value. These are the ones
// that genuinely need to be field-aware; everything pointwise auto-lifts instead.
node({
  id: 'cadence.fields.sample', label: 'Sample Field', category: C, subcategory: 'Operations',
  aliases: ['read field at', 'evaluate field', 'field value', 'lookup', 'probe'],
  summary: 'Reads a field at a specific point instead of at the point being drawn.',
  explain: 'Normally a field is read wherever the current element happens to be. This reads it somewhere else — which is how you compare a value here with a value over there, the basis of gradients, edge detection and look-ahead.',
  exportSupport: 'baked',
  generics: { T: { kinds: [...V.NUMERIC_KINDS] } },
  inputs: [
    { key: 'field', label: 'Field', type: 'field<T>' },
    v3('position', 'At position', [0, 0, 0], { unit: 'studs' }),
  ],
  outputs: [out('out', 'Value')],
  evaluate: (api, i) => F.sampleAny(i.field, F.newSampleContext({ position: i.position })),
});

node({
  id: 'cadence.fields.warp', label: 'Warp Field', category: C, subcategory: 'Operations',
  aliases: ['offset field', 'move field', 'shift field', 'distort', 'push pattern'],
  summary: 'Shifts where a field is read from, moving its pattern without changing its shape.',
  explain: 'The offset may itself be a field, which is how domain warping is built: a noise field offsetting another noise field\'s lookup position.',
  exportSupport: 'baked',
  generics: { T: { kinds: [...V.NUMERIC_KINDS] } },
  inputs: [
    { key: 'field', label: 'Field', type: 'field<T>' },
    fieldOfVec('offset', 'Offset', [0, 0, 0]),
  ],
  outputs: [{ key: 'out', label: 'Field', type: 'field<T>' }],
  evaluate: (api, i) => F.warpField(i.field, i.offset),
});

node({
  id: 'cadence.fields.transform', label: 'Transform Field', category: C, subcategory: 'Operations',
  aliases: ['move field', 'rotate field', 'scale field', 'place field', 'position pattern'],
  summary: 'Moves, rotates and scales a field\'s pattern in space.',
  explain: 'Applies the transform\'s inverse to the lookup point, which is the part that is easy to get backwards: moving a pattern to the right means reading it further to the left.',
  exportSupport: 'baked',
  generics: { T: { kinds: [...V.NUMERIC_KINDS] } },
  inputs: [
    { key: 'field', label: 'Field', type: 'field<T>' },
    { key: 'transform', label: 'Transform', type: 'transform', default: V.IDENTITY_TRANSFORM },
  ],
  outputs: [{ key: 'out', label: 'Field', type: 'field<T>' }],
  evaluate: (api, i) => F.transformField(i.field, i.transform),
});

node({
  id: 'cadence.fields.smooth', label: 'Smooth Field', category: C, subcategory: 'Operations',
  aliases: ['blur field', 'soften', 'average', 'reduce detail', 'feather'],
  summary: 'Softens a field by averaging it over a small area.',
  explain: 'Averages a fixed set of jittered samples within the radius, so the result is identical every evaluation — no random taps, no shimmer between frames. Cost scales with the sample count.',
  performance: 'expensive',
  exportSupport: 'baked',
  generics: { T: { kinds: [...V.NUMERIC_KINDS] } },
  inputs: [
    { key: 'field', label: 'Field', type: 'field<T>' },
    n('radius', 'Radius', 0.2, { min: 0, unit: 'studs' }),
    n('samples', 'Samples', 8, { min: 1, max: 12 }),
  ],
  outputs: [{ key: 'out', label: 'Field', type: 'field<T>' }],
  evaluate: (api, i) => F.blurField(i.field, i.radius, i.samples),
});

node({
  id: 'cadence.fields.gradient', label: 'Field Gradient', category: C, subcategory: 'Operations',
  aliases: ['slope', 'steepest direction', 'derivative', 'uphill', 'normal from field', 'edge'],
  summary: 'The direction in which a field increases fastest, at each point.',
  explain: 'Turns any scalar field into a direction. The gradient of a distance field is the outward normal; the gradient of a density field points toward denser regions; crossed with an axis it becomes a swirl. This is the node that makes scalar fields and vector fields interchangeable.',
  commonUses: ['deriving a surface normal from a distance field', 'building a flow from a density'],
  performance: 'moderate',
  exportSupport: 'baked',
  inputs: [fieldOfFloat('field', 'Field'), n('epsilon', 'Sampling step', 0.01, { min: 1e-5 })],
  outputs: [{ key: 'out', label: 'Direction', type: 'field<vector3>' }],
  evaluate: (api, i) => F.gradientField(i.field, i.epsilon),
});

node({
  id: 'cadence.fields.curl', label: 'Field Curl', category: C, subcategory: 'Operations',
  aliases: ['swirl', 'rotation of', 'vorticity', 'divergence free', 'eddy'],
  summary: 'Turns a vector field into a swirling flow that never bunches particles up.',
  explain: 'The curl of any vector field is divergence-free: as much flows out of every region as flows in. Taking the curl of a noise field is the standard way to get smoke-like motion, and it is why this is an operation rather than a preset.',
  performance: 'expensive',
  exportSupport: 'unsupported',
  exportNote: 'Roblox has no per-particle velocity field; curl motion must be baked.',
  inputs: [fieldOfVec('field', 'Field'), n('epsilon', 'Sampling step', 0.01, { min: 1e-5 })],
  outputs: [{ key: 'out', label: 'Flow', type: 'field<vector3>' }],
  evaluate: (api, i) => F.curlField(i.field, i.epsilon),
});

// ---------------------------------------------------------------- vector fields (Part 19)
node({
  id: 'cadence.fields.constantDirection', label: 'Constant Direction', category: C, subcategory: 'Vector fields',
  aliases: ['uniform force', 'push', 'wind', 'gravity', 'directional force', 'everywhere'],
  summary: 'The same direction and strength everywhere.',
  exportSupport: 'native',
  exportNote: 'Maps directly onto a Roblox ParticleEmitter Acceleration.',
  inputs: [v3('direction', 'Direction', [0, -1, 0]), n('strength', 'Strength', 1)],
  outputs: [{ key: 'out', label: 'Force', type: 'field<vector3>' }],
  evaluate: (api, i) => {
    const d = V.vNormalize(i.direction).map((c) => c * i.strength);
    return F.constantField('vector3', d);
  },
});

node({
  id: 'cadence.fields.radial', label: 'Radial Field', category: C, subcategory: 'Vector fields',
  aliases: ['outward', 'explode', 'burst', 'blast', 'expand', 'shockwave'],
  summary: 'Pushes outward from a centre in every direction.',
  commonUses: ['explosions and shockwaves'],
  exportSupport: 'approximated',
  inputs: [
    v3('center', 'Centre', [0, 0, 0], { unit: 'studs' }),
    n('strength', 'Strength', 1),
    n('falloff', 'Falloff power', 0, { min: 0, max: 4 }),
    n('radius', 'Range (0 = unlimited)', 0, { min: 0, unit: 'studs' }),
  ],
  outputs: [{ key: 'out', label: 'Force', type: 'field<vector3>' }],
  evaluate: (api, i) => F.makeField('vector3', (ctx) => {
    const p = ctx.position || [0, 0, 0];
    const rel = [p[0] - i.center[0], p[1] - i.center[1], p[2] - i.center[2]];
    const d = V.vLength(rel);
    const k = i.strength * falloffAt(d, i.falloff, i.radius);
    return V.vNormalize(rel).map((c) => c * k);
  }),
});

node({
  id: 'cadence.fields.attract', label: 'Attraction Field', category: C, subcategory: 'Vector fields',
  aliases: ['pull', 'gravity well', 'suck in', 'black hole', 'magnet', 'inward', 'implode'],
  summary: 'Pulls everything toward a centre.',
  explain: 'A falloff power of 2 is real inverse-square gravity, which accelerates violently up close. The strength is capped near the centre rather than going infinite, so a particle that reaches the middle does not vanish across the map.',
  commonUses: ['a gravity well', 'gathering energy before a release'],
  exportSupport: 'unsupported',
  exportNote: 'Roblox particles have no attractor; approximate with an inward emitter or bake the motion.',
  inputs: [
    v3('center', 'Centre', [0, 0, 0], { unit: 'studs' }),
    n('strength', 'Strength', 1),
    n('falloff', 'Falloff power', 2, { min: 0, max: 4 }),
    n('radius', 'Range (0 = unlimited)', 0, { min: 0, unit: 'studs' }),
  ],
  outputs: [{ key: 'out', label: 'Force', type: 'field<vector3>' }],
  evaluate: (api, i) => F.makeField('vector3', (ctx) => {
    const p = ctx.position || [0, 0, 0];
    const rel = [i.center[0] - p[0], i.center[1] - p[1], i.center[2] - p[2]];
    const d = V.vLength(rel);
    const k = i.strength * falloffAt(d, i.falloff, i.radius);
    return V.vNormalize(rel).map((c) => c * k);
  }),
});

node({
  id: 'cadence.fields.vortex', label: 'Vortex Field', category: C, subcategory: 'Vector fields',
  aliases: ['swirl', 'spiral', 'tornado', 'whirlpool', 'spin around', 'orbit', 'twister', 'cyclone'],
  summary: 'Swirls around an axis, with optional inward pull and lift along the axis.',
  teach: 'Makes things spin around a line, like water going down a drain.',
  explain: 'The swirl direction is the cross product of the axis and the radius — perpendicular to both, so motion is purely circular. Adding inward pull turns a ring into a spiral; adding lift turns a spiral into a tornado. Three primitives, one field.',
  commonUses: ['tornadoes and whirlpools', 'energy gathering in a spiral'],
  exportSupport: 'unsupported',
  exportNote: 'No Roblox equivalent; bake the motion or approximate with an orbiting attachment.',
  inputs: [
    v3('center', 'Centre', [0, 0, 0], { unit: 'studs' }),
    v3('axis', 'Axis', [0, 1, 0]),
    n('strength', 'Swirl strength', 1),
    n('inward', 'Inward pull', 0),
    n('lift', 'Lift along axis', 0),
    n('falloff', 'Falloff power', 0, { min: 0, max: 4 }),
    n('radius', 'Range (0 = unlimited)', 0, { min: 0, unit: 'studs' }),
  ],
  outputs: [{ key: 'out', label: 'Force', type: 'field<vector3>' }],
  evaluate: (api, i) => {
    const axis = V.vNormalize(i.axis);
    return F.makeField('vector3', (ctx) => {
      const p = ctx.position || [0, 0, 0];
      const rel = [p[0] - i.center[0], p[1] - i.center[1], p[2] - i.center[2]];
      // Only the component perpendicular to the axis defines the radius — a point directly above
      // the centre has zero radius however high it is.
      const radial = V.vReject(rel, axis);
      const d = V.vLength(radial);
      const k = falloffAt(d, i.falloff, i.radius);
      if (k === 0) return [0, 0, 0];
      const tangent = V.vNormalize(V.vCross(axis, radial));
      const inward = V.vNormalize(radial).map((c) => -c * i.inward);
      return [0, 1, 2].map((c) =>
        (tangent[c] * i.strength + inward[c] + axis[c] * i.lift) * k);
    });
  },
});

node({
  id: 'cadence.fields.orbit', label: 'Orbit Field', category: C, subcategory: 'Vector fields',
  aliases: ['circle around', 'ring', 'revolve', 'satellite', 'accretion', 'swirl'],
  summary: 'Holds things at a chosen distance from a centre while they circle it.',
  explain: 'A vortex swirls but lets the radius drift. This adds a spring toward the target radius, so particles settle into a ring instead of spiralling in or out — the difference between a whirlpool and a planetary ring.',
  commonUses: ['a ring of energy', 'an accretion disc'],
  exportSupport: 'unsupported',
  inputs: [
    v3('center', 'Centre', [0, 0, 0], { unit: 'studs' }),
    v3('axis', 'Axis', [0, 1, 0]),
    n('radius', 'Target radius', 2, { min: 0, unit: 'studs' }),
    n('strength', 'Orbit speed', 1),
    n('stiffness', 'Radius hold', 1, { min: 0 }),
  ],
  outputs: [{ key: 'out', label: 'Force', type: 'field<vector3>' }],
  evaluate: (api, i) => {
    const axis = V.vNormalize(i.axis);
    return F.makeField('vector3', (ctx) => {
      const p = ctx.position || [0, 0, 0];
      const rel = [p[0] - i.center[0], p[1] - i.center[1], p[2] - i.center[2]];
      const radial = V.vReject(rel, axis);
      const d = V.vLength(radial);
      const dir = V.vNormalize(radial);
      const tangent = V.vNormalize(V.vCross(axis, radial));
      const correction = (i.radius - d) * i.stiffness;
      return [0, 1, 2].map((c) => tangent[c] * i.strength + dir[c] * correction);
    });
  },
});

node({
  id: 'cadence.fields.turbulenceForce', label: 'Turbulence Field', category: C, subcategory: 'Vector fields',
  aliases: ['random push', 'chaos', 'wobble force', 'noise force', 'buffet', 'gust'],
  summary: 'Pushes things around with smooth noise, differently at every point.',
  explain: 'Not divergence-free, so particles will thin out in some places and bunch in others. That is the right look for wind buffeting and the wrong one for smoke — use Curl Noise where the flow should conserve density.',
  performance: 'moderate',
  exportSupport: 'approximated',
  exportNote: 'Roughly approximated by a Roblox emitter\'s Drag plus a randomised Acceleration.',
  inputs: [
    n('scale', 'Scale', 1, { min: 0.001 }),
    n('strength', 'Strength', 1),
    n('octaves', 'Detail', 2, { min: 1, max: 8 }),
    n('seed', 'Variation', 0),
  ],
  outputs: [{ key: 'out', label: 'Force', type: 'field<vector3>' }],
  evaluate: (api, i) => F.makeField('vector3', (ctx) => {
    const p = ctx.position || [0, 0, 0];
    const s = Math.round(i.seed) ^ api.seed;
    // Three decorrelated smooth noise channels, centred on zero so the push goes both ways.
    return [0, 1, 2].map((k) => {
      const h = (a, b, c) => V.hash01(Math.floor(a) * 73856093 + Math.floor(b) * 19349663 + Math.floor(c) * 83492791, s + k * 7919);
      const sx = p[0] * i.scale, sy = p[1] * i.scale, sz = p[2] * i.scale;
      const fx = sx - Math.floor(sx), fy = sy - Math.floor(sy), fz = sz - Math.floor(sz);
      const sm = (t) => t * t * (3 - 2 * t);
      const lerp = (a, bb, t) => a + (bb - a) * t;
      const c00 = lerp(h(sx, sy, sz), h(sx + 1, sy, sz), sm(fx));
      const c10 = lerp(h(sx, sy + 1, sz), h(sx + 1, sy + 1, sz), sm(fx));
      const c01 = lerp(h(sx, sy, sz + 1), h(sx + 1, sy, sz + 1), sm(fx));
      const c11 = lerp(h(sx, sy + 1, sz + 1), h(sx + 1, sy + 1, sz + 1), sm(fx));
      const v = lerp(lerp(c00, c10, sm(fy)), lerp(c01, c11, sm(fy)), sm(fz));
      return (v * 2 - 1) * i.strength;
    });
  }),
});

// The escape hatch that makes Part 19's "do not make the predefined fields the limit" concrete: any
// vector, however it was computed, becomes a field. Because the input auto-lifts, wiring Position
// through arbitrary maths into here produces a completely custom field with no special support.
node({
  id: 'cadence.fields.custom', label: 'Custom Field', category: C, subcategory: 'Vector fields',
  aliases: ['make field', 'my own field', 'build field', 'from vector', 'as field'],
  summary: 'Turns any vector you have built into a field.',
  explain: 'Wire Position through whatever maths you like and bring the result here. Nothing about the predefined fields is privileged — they are all short compositions of exactly this.',
  exportSupport: 'baked',
  inputs: [fieldOfVec('vector', 'Vector', [0, 0, 0])],
  outputs: [{ key: 'out', label: 'Field', type: 'field<vector3>' }],
  evaluate: (api, i) => (F.isField(i.vector) ? i.vector : F.constantField('vector3', i.vector)),
});

node({
  id: 'cadence.fields.customScalar', label: 'Custom Scalar Field', category: C, subcategory: 'Vector fields',
  aliases: ['make scalar field', 'from number', 'as field', 'mask from value'],
  summary: 'Turns any number you have built into a field.',
  exportSupport: 'baked',
  inputs: [fieldOfFloat('value', 'Value', 0)],
  outputs: [{ key: 'out', label: 'Field', type: 'field<float>' }],
  evaluate: (api, i) => (F.isField(i.value) ? i.value : F.constantField('float', i.value)),
});
