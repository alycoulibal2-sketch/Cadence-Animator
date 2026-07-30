// Random node family (spec Part 14).
//
// There is no Math.random() anywhere in this engine. Every random value is a pure function of a
// STRUCTURAL seed — the node's own stable position in the graph, the graph's seed, an explicit
// variation input, and (for per-element randomness) the element's own index. Three consequences,
// all of them requirements from the specification:
//
//   - Scrubbing is repeatable. Frame 40 looks identical whether you arrived from 39 or from 400.
//   - Adding, deleting or editing an UNRELATED node cannot perturb an unrelated random result,
//     because the seed depends on identity rather than on evaluation order (Part 14, explicitly).
//   - A whole effect can be re-rolled by changing one graph seed, without touching the graph.
//
// Nodes that produce a value PER ELEMENT return a field: one particle's random size must not be
// every particle's random size. Nodes that produce one value for the whole graph return a plain
// number. Which of the two you want is the single most common confusion here, so each node says
// which it is in its own summary.

import * as V from '../values.js';
import * as F from '../fields.js';
import { node, n, i as intIn, out, mode } from './_helpers.js';

const C = 'Random';

// Channel constants keep independent uses of the same element decorrelated. Two nodes asking for
// "a random number for particle 12" must not agree, or every randomised property on a particle
// would move in lockstep — a distinctive and confusing artefact.
const CH = { FLOAT: 1, INT: 2, BOOL: 3, VEC_X: 11, VEC_Y: 12, VEC_Z: 13, DIR_U: 21, DIR_V: 22, COL_H: 31, COL_S: 32, COL_V: 33, GAUSS_A: 41, GAUSS_B: 42, PICK: 51 };

// Box-Muller from two uniforms. The log guard keeps u1 away from exactly zero, which would produce
// an infinity — the one place in this file where a naive implementation can escape the finite range.
function gaussian(u1, u2) {
  const a = Math.sqrt(-2 * Math.log(Math.max(1e-12, u1)));
  return a * Math.cos(2 * Math.PI * u2);
}

// ---------------------------------------------------------------- per element
node({
  id: 'cadence.random.float', label: 'Random Number', category: C, subcategory: 'Per element',
  aliases: ['random', 'random float', 'variation', 'jitter', 'noise value', 'rand', 'scatter'],
  summary: 'A different random number for each particle or point, between a low and a high value.',
  teach: 'Gives every particle its own random number, so they do not all look identical. The same particle always gets the same number.',
  exportSupport: 'approximated',
  exportNote: 'Roblox rolls its own per-particle randomness, so the spread matches but individual particles differ.',
  inputs: [n('min', 'Low', 0), n('max', 'High', 1), n('seed', 'Variation', 0)],
  outputs: [{ key: 'out', label: 'Value', type: 'field<float>' }],
  evaluate: (api, i) => F.makeField('float', (ctx) => {
    const u = api.random(ctx.index || 0, CH.FLOAT + Math.round(i.seed) * 1009);
    return i.min + (i.max - i.min) * u;
  }),
});

node({
  id: 'cadence.random.int', label: 'Random Whole Number', category: C, subcategory: 'Per element',
  aliases: ['random int', 'random integer', 'dice', 'pick number'],
  summary: 'A different random whole number for each particle, from a low to a high value inclusive.',
  explain: 'Both limits are included, so low 1 and high 6 really is a six-sided die. Getting this off by one is the classic mistake — the top value would never come up.',
  exportSupport: 'approximated',
  inputs: [intIn('min', 'Low', 0), intIn('max', 'High', 10), n('seed', 'Variation', 0)],
  outputs: [{ key: 'out', label: 'Value', type: 'field<int>' }],
  evaluate: (api, i) => F.makeField('int', (ctx) => {
    const lo = Math.round(Math.min(i.min, i.max)), hi = Math.round(Math.max(i.min, i.max));
    const u = api.random(ctx.index || 0, CH.INT + Math.round(i.seed) * 1009);
    return lo + Math.min(hi - lo, Math.floor(u * (hi - lo + 1)));
  }),
});

node({
  id: 'cadence.random.bool', label: 'Random Yes/No', category: C, subcategory: 'Per element',
  aliases: ['coin flip', 'random bool', 'maybe', 'either'],
  summary: 'Yes or no at random, differently for each particle.',
  exportSupport: 'approximated',
  inputs: [n('probability', 'Chance of yes', 0.5, { min: 0, max: 1 }), n('seed', 'Variation', 0)],
  outputs: [{ key: 'out', label: 'Yes/No', type: 'field<bool>' }],
  evaluate: (api, i) => F.makeField('bool', (ctx) => api.random(ctx.index || 0, CH.BOOL + Math.round(i.seed) * 1009) < i.probability),
});

node({
  id: 'cadence.random.vector', label: 'Random Vector', category: C, subcategory: 'Per element',
  aliases: ['random offset', 'scatter', 'random position', 'jitter position', 'random box'],
  summary: 'A different random vector for each particle, with each component between a low and a high value.',
  commonUses: ['scattering spawn positions inside a box', 'per-particle offset'],
  exportSupport: 'approximated',
  inputs: [
    { key: 'min', label: 'Low', type: 'vector3', default: [-1, -1, -1] },
    { key: 'max', label: 'High', type: 'vector3', default: [1, 1, 1] },
    n('seed', 'Variation', 0),
  ],
  outputs: [{ key: 'out', label: 'Vector', type: 'field<vector3>' }],
  evaluate: (api, i) => F.makeField('vector3', (ctx) => {
    const e = ctx.index || 0, s = Math.round(i.seed) * 1009;
    return [
      i.min[0] + (i.max[0] - i.min[0]) * api.random(e, CH.VEC_X + s),
      i.min[1] + (i.max[1] - i.min[1]) * api.random(e, CH.VEC_Y + s),
      i.min[2] + (i.max[2] - i.min[2]) * api.random(e, CH.VEC_Z + s),
    ];
  }),
});

node({
  id: 'cadence.random.unitVector', label: 'Random Direction', category: C, subcategory: 'Per element',
  aliases: ['random unit vector', 'random direction', 'sphere', 'omnidirectional', 'burst direction', 'explode'],
  summary: 'A random direction, evenly spread over every direction, different for each particle.',
  explain: 'Evenly distributed over the sphere, which is not what you get from three random components — that clusters toward the corners of a cube, and an explosion built that way visibly has eight bulges. This inverts the area distribution properly.',
  commonUses: ['explosion and burst directions'],
  exportSupport: 'approximated',
  inputs: [n('seed', 'Variation', 0)],
  outputs: [{ key: 'out', label: 'Direction', type: 'field<vector3>' }],
  evaluate: (api, i) => F.makeField('vector3', (ctx) => {
    const e = ctx.index || 0, s = Math.round(i.seed) * 1009;
    // z is uniform in [-1,1] and the azimuth uniform in [0,2pi): the standard even-area sphere
    // sampling. Uniform z is the part that matters — uniform polar ANGLE would bunch at the poles.
    const z = api.random(e, CH.DIR_U + s) * 2 - 1;
    const phi = api.random(e, CH.DIR_V + s) * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    return [r * Math.cos(phi), z, r * Math.sin(phi)];
  }),
});

node({
  id: 'cadence.random.cone', label: 'Random Direction In Cone', category: C, subcategory: 'Per element',
  aliases: ['spread', 'cone', 'spray', 'random within angle', 'jet', 'nozzle'],
  summary: 'A random direction within a cone around an axis — a spray rather than a full burst.',
  commonUses: ['a jet, a nozzle, a spray of sparks'],
  exportSupport: 'native',
  exportNote: 'Maps directly onto a Roblox ParticleEmitter SpreadAngle.',
  inputs: [
    { key: 'axis', label: 'Axis', type: 'vector3', default: [0, 1, 0] },
    n('angle', 'Spread', 0.35, { min: 0, max: Math.PI, unit: 'radians' }),
    n('seed', 'Variation', 0),
  ],
  outputs: [{ key: 'out', label: 'Direction', type: 'field<vector3>' }],
  evaluate: (api, i) => F.makeField('vector3', (ctx) => {
    const e = ctx.index || 0, s = Math.round(i.seed) * 1009;
    const axis = V.vNormalize(i.axis);
    // Uniform over the cone's spherical CAP, again by sampling cos(theta) uniformly rather than
    // theta — otherwise a wide spray is denser at its edge than at its centre.
    const cosMax = Math.cos(Math.min(Math.max(i.angle, 0), Math.PI));
    const cosTheta = 1 - api.random(e, CH.DIR_U + s) * (1 - cosMax);
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = api.random(e, CH.DIR_V + s) * Math.PI * 2;
    const ref = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = V.vNormalize(V.vCross(axis, ref));
    const w = V.vCross(axis, u);
    return [0, 1, 2].map((k) =>
      axis[k] * cosTheta + (u[k] * Math.cos(phi) + w[k] * Math.sin(phi)) * sinTheta);
  }),
});

node({
  id: 'cadence.random.color', label: 'Random Color', category: C, subcategory: 'Per element',
  aliases: ['random colour', 'colour variation', 'tint variation', 'hue jitter'],
  summary: 'A random colour for each particle, varying around a base colour.',
  explain: 'Varies hue, saturation and brightness separately rather than the raw red/green/blue channels: jittering RGB independently drifts toward grey, whereas jittering hue keeps the colour vivid, which is nearly always what is wanted.',
  exportSupport: 'approximated',
  inputs: [
    { key: 'base', label: 'Base colour', type: 'color', default: [1, 0.7, 0.3, 1] },
    n('hueRange', 'Hue variation', 0.05, { min: 0, max: 1 }),
    n('saturationRange', 'Saturation variation', 0.1, { min: 0, max: 1 }),
    n('valueRange', 'Brightness variation', 0.1, { min: 0, max: 1 }),
    n('seed', 'Variation', 0),
  ],
  outputs: [{ key: 'out', label: 'Color', type: 'field<color>' }],
  evaluate: (api, i) => F.makeField('color', (ctx) => {
    const e = ctx.index || 0, s = Math.round(i.seed) * 1009;
    const [h, sat, val] = V.rgbToHsv(i.base);
    const j = (ch, range) => (api.random(e, ch + s) * 2 - 1) * range;
    const rgb = V.hsvToRgb(
      h + j(CH.COL_H, i.hueRange),
      Math.min(Math.max(sat + j(CH.COL_S, i.saturationRange), 0), 1),
      Math.max(0, val + j(CH.COL_V, i.valueRange)),
    );
    return [...rgb, i.base[3] ?? 1];
  }),
});

// ---------------------------------------------------------------- distributions
node({
  id: 'cadence.random.gaussian', label: 'Random Bell Curve', category: C, subcategory: 'Distribution',
  aliases: ['gaussian', 'normal distribution', 'bell', 'natural variation', 'clustered random'],
  summary: 'A random number clustered around a middle value, rarely far from it.',
  teach: 'Most results land near the middle and only a few stray far — the way real-world variation usually looks, unlike a flat random number where every value is equally likely.',
  explain: 'Box-Muller from two decorrelated uniforms. Unbounded in principle; the result is clamped to four standard deviations, which cuts off about one sample in sixteen thousand and keeps a stray outlier from throwing a particle across the map.',
  commonUses: ['natural-looking size or speed variation'],
  exportSupport: 'approximated',
  inputs: [n('mean', 'Middle', 0), n('deviation', 'Spread', 1, { min: 0 }), n('seed', 'Variation', 0)],
  outputs: [{ key: 'out', label: 'Value', type: 'field<float>' }],
  evaluate: (api, i) => F.makeField('float', (ctx) => {
    const e = ctx.index || 0, s = Math.round(i.seed) * 1009;
    const g = gaussian(api.random(e, CH.GAUSS_A + s), api.random(e, CH.GAUSS_B + s));
    return i.mean + Math.min(Math.max(g, -4), 4) * i.deviation;
  }),
});

node({
  id: 'cadence.random.powerDistribution', label: 'Random Biased', category: C, subcategory: 'Distribution',
  aliases: ['biased random', 'skewed', 'weighted toward', 'exponent random'],
  summary: 'A random number biased toward the low or the high end of its range.',
  explain: 'A bias of 1 is an even spread. Above 1 crowds toward the low end; below 1 crowds toward the high end. Useful when "mostly small, occasionally large" is the look — most debris chips are small.',
  exportSupport: 'approximated',
  inputs: [n('min', 'Low', 0), n('max', 'High', 1), n('bias', 'Bias', 2, { min: 0.05, max: 20 }), n('seed', 'Variation', 0)],
  outputs: [{ key: 'out', label: 'Value', type: 'field<float>' }],
  evaluate: (api, i) => F.makeField('float', (ctx) => {
    const u = api.random(ctx.index || 0, CH.FLOAT + 7 + Math.round(i.seed) * 1009);
    return i.min + (i.max - i.min) * Math.pow(u, Math.max(0.05, i.bias));
  }),
});

// ---------------------------------------------------------------- whole-graph values
// These give ONE value for the whole graph rather than one per element — for an effect-wide
// variation, or a seed to feed several nodes so they vary together rather than independently.
node({
  id: 'cadence.random.onceFloat', label: 'Random Once', category: C, subcategory: 'Whole effect',
  aliases: ['one random value', 'per effect random', 'instance variation', 'single random'],
  summary: 'One random number for the whole effect, not one per particle.',
  explain: 'Use this when two copies of an effect should differ from each other but be internally consistent — a variation seed shared by every part of one explosion.',
  exportSupport: 'baked',
  inputs: [n('min', 'Low', 0), n('max', 'High', 1), n('seed', 'Variation', 0)],
  outputs: [{ key: 'out', label: 'Value', type: 'float' }],
  evaluate: (api, i) => i.min + (i.max - i.min) * api.random(0, CH.FLOAT + Math.round(i.seed) * 1009),
});

node({
  id: 'cadence.random.seed', label: 'Seed', category: C, subcategory: 'Whole effect',
  aliases: ['random seed', 'variation number', 'reroll', 'randomise'],
  summary: 'A stable number derived from this node\'s place in the graph, for feeding other nodes\' variation inputs.',
  explain: 'Two nodes given the same seed vary together; given different seeds they vary independently. Because the value comes from graph structure rather than from a counter, adding nodes elsewhere never shifts it.',
  exportSupport: 'baked',
  inputs: [intIn('offset', 'Offset', 0)],
  outputs: [{ key: 'out', label: 'Seed', type: 'int' }],
  evaluate: (api, i) => V.mixSeeds(api.seed, Math.round(i.offset)) % 1000000,
});

node({
  id: 'cadence.random.hash', label: 'Hash', category: C, subcategory: 'Whole effect',
  aliases: ['deterministic random', 'scramble', 'random from value', 'from number'],
  summary: 'Turns any number into a repeatable random-looking number between 0 and 1.',
  explain: 'The same input always gives the same output. This is the building block behind every other node here, exposed so you can randomise from something meaningful — a cell index, a whole-number position, an id — rather than from an element counter.',
  commonUses: ['a random value per grid cell', 'a random value per whole-number position'],
  exportSupport: 'baked',
  inputs: [n('value', 'Value', 0), n('seed', 'Variation', 0)],
  outputs: [{ key: 'out', label: 'Value (0-1)', type: 'float' }],
  evaluate: (api, i) => V.hash01(i.value, i.seed),
});
