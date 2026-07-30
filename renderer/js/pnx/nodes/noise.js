// Noise node family (spec Part 15).
//
// Every noise node takes a POSITION input and returns a FIELD. That combination is the whole reason
// noise is useful here: connect Position and you get spatial noise; connect a warped position and
// you get domain warping; connect a position built from age and index and you get per-particle
// variation. There is no separate 1D/2D/3D/4D variant, because a position is a position.
//
// Output range is 0-1 for every node here, deliberately. Classic Perlin and simplex are -1..1, but
// 0-1 is what feeds straight into a gradient, an opacity, or a Map Range without an intervening
// conversion — and a beginner reaching for noise almost always wants a mask. Where the signed form
// is needed (a displacement that should push both ways) subtract 0.5, or use the Signed output that
// the fractal nodes provide.

import * as V from '../values.js';
import * as F from '../fields.js';
import * as N from '../noisecore.js';
import { node, n, v3, out, mode } from './_helpers.js';

const C = 'Noise';

const posIn = () => ({
  key: 'position', label: 'Position', type: 'vector3', default: [0, 0, 0], defaultFrom: 'position',
  description: 'Where to sample the noise. Left unconnected it follows the point being evaluated, which is what makes noise spatial without any wiring.',
});
const scaleIn = () => n('scale', 'Scale', 1, { min: 0.001, max: 1000 });
const seedIn = () => n('seed', 'Variation', 0);

// Every node takes its position as a vector3 socket, which auto-lifts when a field is connected.
// This helper reads the position the same way whether the node was lifted or not: when lifted, the
// evaluator has already sampled the incoming field for us, so `i.position` is a plain vector.
const scaled = (i) => [i.position[0] * i.scale, i.position[1] * i.scale, i.position[2] * i.scale];

// ---------------------------------------------------------------- basic
node({
  id: 'cadence.noise.white', label: 'White Noise', category: C, subcategory: 'Basic',
  aliases: ['random noise', 'static', 'grain', 'speckle', 'hash noise', 'film grain'],
  summary: 'A completely different random value at every point, with no smoothness.',
  explain: 'Nothing about a point predicts its neighbours. Use it for grain, sparkle and per-cell randomness — never for motion, where it reads as violent jitter rather than as movement.',
  preview: 'noise', performance: 'trivial',
  exportSupport: 'baked',
  inputs: [posIn(), scaleIn(), seedIn()],
  outputs: [{ key: 'out', label: 'Value (0-1)', type: 'float' }],
  evaluate: (api, i) => {
    const p = scaled(i);
    return N.white3(p[0], p[1], p[2], Math.round(i.seed) ^ api.seed);
  },
});

node({
  id: 'cadence.noise.value', label: 'Value Noise', category: C, subcategory: 'Basic',
  aliases: ['smooth random', 'blocky noise', 'lattice noise'],
  summary: 'Smooth random blobs, interpolated between random values on a grid.',
  explain: 'Cheaper than gradient noise but visibly blockier: its peaks and valleys sit exactly on the grid, so a faint square pattern shows through at low scales. Perfectly good as a mask, less good as a displacement.',
  preview: 'noise', performance: 'cheap',
  exportSupport: 'baked',
  inputs: [posIn(), scaleIn(), seedIn()],
  outputs: [{ key: 'out', label: 'Value (0-1)', type: 'float' }],
  evaluate: (api, i) => {
    const p = scaled(i);
    return N.value3(p[0], p[1], p[2], Math.round(i.seed) ^ api.seed);
  },
});

node({
  id: 'cadence.noise.perlin', label: 'Perlin Noise', category: C, subcategory: 'Basic',
  aliases: ['noise', 'gradient noise', 'smooth noise', 'clouds', 'organic', 'wobble', 'natural'],
  summary: 'Smooth, natural-looking noise — the standard building block for organic variation.',
  teach: 'Random, but gently: nearby points get similar values, so it looks like clouds or ripples rather than television static.',
  explain: 'Gradient noise: the random data sits on a grid as directions rather than values, so the peaks land BETWEEN grid points and no grid pattern shows. This is the one to reach for by default.',
  commonUses: ['cloud and smoke shapes', 'gentle drift', 'surface variation'],
  preview: 'noise', performance: 'cheap',
  exportSupport: 'baked',
  exportNote: 'Roblox cannot evaluate noise per particle at runtime; a noise-driven property is baked or dropped depending on what it drives.',
  inputs: [posIn(), scaleIn(), seedIn()],
  outputs: [
    { key: 'out', label: 'Value (0-1)', type: 'float' },
    { key: 'signed', label: 'Value (-1 to 1)', type: 'float' },
  ],
  evaluate: (api, i) => {
    const p = scaled(i);
    const raw = N.perlin3(p[0], p[1], p[2], Math.round(i.seed) ^ api.seed);
    return { out: N.to01(raw), signed: raw };
  },
});

node({
  id: 'cadence.noise.simplex', label: 'Simplex Noise', category: C, subcategory: 'Basic',
  aliases: ['noise', 'smooth noise', 'organic', 'better perlin', 'isotropic noise'],
  summary: 'Smooth natural noise on a triangular lattice — no directional bias, so it stays even when stretched.',
  explain: 'Built on packed tetrahedra rather than a cube grid, so there are no axis-aligned directions for artefacts to line up along. Prefer it over Perlin when the noise gets stretched unevenly or heavily warped, where Perlin\'s grid starts to show.',
  preview: 'noise', performance: 'cheap',
  exportSupport: 'baked',
  inputs: [posIn(), scaleIn(), seedIn()],
  outputs: [
    { key: 'out', label: 'Value (0-1)', type: 'float' },
    { key: 'signed', label: 'Value (-1 to 1)', type: 'float' },
  ],
  evaluate: (api, i) => {
    const p = scaled(i);
    const raw = N.simplex3(p[0], p[1], p[2], Math.round(i.seed) ^ api.seed);
    return { out: N.to01(raw), signed: raw };
  },
});

// ---------------------------------------------------------------- fractal
const BASIS_OPTIONS = ['perlin', 'simplex', 'value'];

const fractalInputs = () => [
  posIn(), scaleIn(),
  n('octaves', 'Detail', 4, { min: 1, max: 12 }),
  n('roughness', 'Roughness', 0.5, { min: 0, max: 1 }),
  n('lacunarity', 'Detail spacing', 2, { min: 1, max: 6 }),
  seedIn(),
  mode('basis', 'Base noise', BASIS_OPTIONS, 'perlin'),
];

node({
  id: 'cadence.noise.fbm', label: 'Fractal Noise', category: C, subcategory: 'Fractal',
  aliases: ['fbm', 'fractal', 'detail noise', 'clouds', 'terrain', 'layered noise', 'multi octave'],
  summary: 'Several sizes of noise layered together, giving both large shapes and fine detail.',
  teach: 'One noise gives soft blobs. This stacks a big one, a medium one and a small one on top of each other, the way real clouds have both broad shapes and wispy edges.',
  explain: 'Detail is how many layers. Roughness is how loud each finer layer is relative to the one before — low values stay soft, near 1 gets scratchy. Detail spacing is how much finer each layer is; 2 is the natural choice and non-integer values avoid layers lining up.',
  commonUses: ['clouds and smoke density', 'weathering and surface variation'],
  preview: 'noise', performance: 'moderate',
  exportSupport: 'baked',
  inputs: fractalInputs(),
  outputs: [
    { key: 'out', label: 'Value (0-1)', type: 'float' },
    { key: 'signed', label: 'Value (-1 to 1)', type: 'float' },
  ],
  evaluate: (api, i) => {
    const p = scaled(i);
    const raw = N.fbm(N.BASIS[i.basis] || N.perlin3, p[0], p[1], p[2], {
      octaves: i.octaves, lacunarity: i.lacunarity, gain: i.roughness, seed: Math.round(i.seed) ^ api.seed,
    });
    return { out: N.to01(raw), signed: raw };
  },
});

node({
  id: 'cadence.noise.ridged', label: 'Ridged Noise', category: C, subcategory: 'Fractal',
  aliases: ['ridged fbm', 'ridges', 'creases', 'lightning', 'veins', 'cracks', 'sharp noise', 'filaments'],
  summary: 'Fractal noise folded so its zero crossings become sharp ridges.',
  explain: 'Where fractal noise is soft everywhere, this has creases: the places the underlying noise crossed zero become thin bright lines. That is what makes lightning filaments, mountain ridges and the sharp interior structure of an explosion.',
  commonUses: ['lightning and electricity', 'veins and cracks', 'sharp interior detail in smoke'],
  preview: 'noise', performance: 'moderate',
  exportSupport: 'baked',
  inputs: [...fractalInputs(), n('sharpness', 'Sharpness', 1, { min: 0.05, max: 8 })],
  outputs: [{ key: 'out', label: 'Value (0-1)', type: 'float' }],
  evaluate: (api, i) => {
    const p = scaled(i);
    return N.ridgedFbm(N.BASIS[i.basis] || N.perlin3, p[0], p[1], p[2], {
      octaves: i.octaves, lacunarity: i.lacunarity, gain: i.roughness,
      seed: Math.round(i.seed) ^ api.seed, sharpness: i.sharpness,
    });
  },
});

node({
  id: 'cadence.noise.turbulence', label: 'Turbulence', category: C, subcategory: 'Fractal',
  aliases: ['billow', 'smoke noise', 'cauliflower', 'churn', 'fire noise', 'puffy'],
  summary: 'Fractal noise with its negative half flipped, giving billowing, puffy forms.',
  explain: 'Visibly different from Ridged despite both using absolute value: turbulence keeps the folded lobes as rounded billows, while ridged inverts them into creases. Turbulence is the classic smoke and fire basis.',
  commonUses: ['smoke and fire density', 'churning cloud interiors'],
  preview: 'noise', performance: 'moderate',
  exportSupport: 'baked',
  inputs: fractalInputs(),
  outputs: [{ key: 'out', label: 'Value (0-1)', type: 'float' }],
  evaluate: (api, i) => {
    const p = scaled(i);
    return N.turbulence(N.BASIS[i.basis] || N.perlin3, p[0], p[1], p[2], {
      octaves: i.octaves, lacunarity: i.lacunarity, gain: i.roughness, seed: Math.round(i.seed) ^ api.seed,
    });
  },
});

// ---------------------------------------------------------------- cellular
node({
  id: 'cadence.noise.voronoi', label: 'Voronoi', category: C, subcategory: 'Cellular',
  aliases: ['worley', 'cellular', 'cells', 'scales', 'cracks', 'shatter', 'stones', 'bubbles', 'honeycomb'],
  summary: 'Divides space into cells around scattered points, giving distances and a value per cell.',
  teach: 'Scatters dots through space and asks, for every point, "which dot is nearest, and how far?" — which draws cells, like bubbles or cracked ground.',
  explain: 'Nearest gives rounded bubble shapes. Cell gives one random value for the whole cell, for per-cell colour or per-shard variation. Border (second-nearest minus nearest) goes to zero exactly on the boundary between two cells, which is how cracks and cell outlines are drawn — that difference cannot be reconstructed from two separate lookups.',
  commonUses: ['shattered glass and fracture patterns', 'scales and honeycomb', 'per-cell random colour'],
  preview: 'noise', performance: 'moderate',
  exportSupport: 'baked',
  inputs: [
    posIn(), scaleIn(),
    n('randomness', 'Randomness', 1, { min: 0, max: 1 }),
    mode('metric', 'Distance measure', ['euclidean', 'manhattan', 'chebyshev'], 'euclidean'),
    seedIn(),
  ],
  outputs: [
    { key: 'distance', label: 'Nearest', type: 'float' },
    { key: 'cell', label: 'Cell value (0-1)', type: 'float' },
    { key: 'border', label: 'Border', type: 'float' },
    { key: 'position', label: 'Cell centre', type: 'vector3' },
  ],
  evaluate: (api, i) => {
    const p = scaled(i);
    const r = N.voronoi3(p[0], p[1], p[2], Math.round(i.seed) ^ api.seed, i.randomness, i.metric);
    const inv = i.scale === 0 ? 1 : 1 / i.scale;
    return {
      distance: r.f1 * inv,
      cell: r.cell,
      border: (r.f2 - r.f1) * inv,
      position: [r.position[0] * inv, r.position[1] * inv, r.position[2] * inv],
    };
  },
});

// ---------------------------------------------------------------- wave and pattern noise
node({
  id: 'cadence.noise.wave', label: 'Wave Noise', category: C, subcategory: 'Wave',
  aliases: ['bands', 'rings', 'marble', 'wood', 'stripes noise', 'distorted bands', 'veins'],
  summary: 'Bands or rings pushed out of shape by noise — the classic marble and wood pattern.',
  explain: 'A clean sine of position, with noise added to the phase before the sine is taken. Distortion 0 gives perfect bands; raising it turns them into marble veining. Which is a good illustration of the whole engine: marble is not a marble node, it is a wave whose input has been disturbed.',
  commonUses: ['marble and wood', 'energy banding on a beam or shield'],
  preview: 'noise', performance: 'cheap',
  exportSupport: 'baked',
  inputs: [
    posIn(), scaleIn(),
    mode('form', 'Form', ['bands', 'rings'], 'bands'),
    { key: 'direction', label: 'Direction', type: 'vector3', default: [1, 0, 0] },
    n('distortion', 'Distortion', 1, { min: 0, max: 20 }),
    n('detail', 'Distortion detail', 2, { min: 1, max: 8 }),
    seedIn(),
  ],
  outputs: [{ key: 'out', label: 'Value (0-1)', type: 'float' }],
  evaluate: (api, i) => {
    const p = scaled(i);
    const base = i.form === 'rings'
      ? Math.hypot(p[0], p[1], p[2])
      : V.vDot(p, V.vNormalize(i.direction));
    const warp = i.distortion === 0 ? 0 : N.fbm(N.perlin3, p[0], p[1], p[2], {
      octaves: Math.round(i.detail), seed: Math.round(i.seed) ^ api.seed,
    }) * i.distortion;
    return N.to01(Math.sin((base + warp) * Math.PI * 2));
  },
});

// ---------------------------------------------------------------- derived vector noise
node({
  id: 'cadence.noise.curl', label: 'Curl Noise', category: C, subcategory: 'Vector',
  aliases: ['swirl', 'vortex noise', 'turbulent flow', 'smoke motion', 'divergence free', 'eddies', 'flow'],
  summary: 'A swirling flow field that never pushes particles apart or bunches them up.',
  teach: 'Makes particles swirl around each other like smoke, instead of drifting away in straight lines.',
  explain: 'The curl of a noise field is divergence-free by construction: whatever flows into any region flows out again. That is the mathematical reason curl-noise motion reads as smoke or water and plain noise motion reads as particles wandering off — with plain noise, particles pile up wherever the noise happens to point inward.',
  commonUses: ['smoke and steam motion', 'magical energy swirl', 'underwater drift'],
  preview: 'noise', performance: 'expensive',
  exportSupport: 'unsupported',
  exportNote: 'Roblox has no per-particle velocity field. Curl motion must be baked into a mesh/trail animation or approximated with drag and turbulence.',
  inputs: [
    posIn(), scaleIn(),
    n('octaves', 'Detail', 2, { min: 1, max: 8 }),
    n('epsilon', 'Sampling step', 0.05, { min: 1e-4, max: 1 }),
    seedIn(),
  ],
  outputs: [{ key: 'out', label: 'Flow direction', type: 'vector3' }],
  evaluate: (api, i) => {
    const seed = Math.round(i.seed) ^ api.seed;
    const e = Math.max(1e-4, i.epsilon);
    const oct = Math.round(i.octaves);
    // Three decorrelated scalar noise fields make a vector potential; its curl is the flow.
    const pot = (x, y, z, channel) => N.fbm(N.perlin3, x * i.scale, y * i.scale, z * i.scale, { octaves: oct, seed: seed + channel * 7919 });
    const p = i.position;
    const d = (channel, ax) => {
      const o = [0, 0, 0];
      o[ax] = e;
      return (pot(p[0] + o[0], p[1] + o[1], p[2] + o[2], channel) - pot(p[0] - o[0], p[1] - o[1], p[2] - o[2], channel)) / (2 * e);
    };
    // curl(P) = (dPz/dy - dPy/dz, dPx/dz - dPz/dx, dPy/dx - dPx/dy)
    return [
      d(2, 1) - d(1, 2),
      d(0, 2) - d(2, 0),
      d(1, 0) - d(0, 1),
    ];
  },
});

node({
  id: 'cadence.noise.vectorNoise', label: 'Vector Noise', category: C, subcategory: 'Vector',
  aliases: ['random direction field', 'noise vector', 'displacement', 'wobble direction', 'jitter field'],
  summary: 'Smooth noise in all three directions at once, for pushing things around.',
  explain: 'Three decorrelated noise fields, one per axis, centred on zero so it pushes both ways rather than only outward. Unlike Curl Noise this is NOT divergence-free, so particles driven by it will bunch and thin — which is right for displacement and wrong for flow.',
  commonUses: ['displacing geometry or particle positions', 'wobbling a beam off a straight line'],
  preview: 'noise', performance: 'moderate',
  exportSupport: 'baked',
  inputs: [posIn(), scaleIn(), n('octaves', 'Detail', 2, { min: 1, max: 8 }), seedIn()],
  outputs: [{ key: 'out', label: 'Offset', type: 'vector3' }],
  evaluate: (api, i) => {
    const p = scaled(i);
    const seed = Math.round(i.seed) ^ api.seed;
    const oct = Math.round(i.octaves);
    return [0, 1, 2].map((k) => N.fbm(N.perlin3, p[0], p[1], p[2], { octaves: oct, seed: seed + k * 7919 }));
  },
});

// ---------------------------------------------------------------- domain warp
// Domain warping is a node rather than an option on every noise node — which is the difference
// between an engine and a pile of settings. Anything that produces a position can be warped, and
// anything that consumes a position can be the thing warped.
node({
  id: 'cadence.noise.domainWarp', label: 'Domain Warp', category: C, subcategory: 'Warp',
  aliases: ['warp', 'distort position', 'twist noise', 'flow warp', 'melt', 'smear'],
  summary: 'Pushes a position around with noise before it is used — the trick behind most convincing organic shapes.',
  teach: 'Instead of changing what a pattern looks like, this bends WHERE you are looking. Stacking it twice turns simple noise into something that looks hand-painted.',
  explain: 'Feed the output into any node that takes a position. Warping the same noise twice (warp a warp) is the standard way to get the flowing, marbled look that no single noise achieves — an effect that comes from composition, not from a setting.',
  commonUses: ['organic smoke and cloud shapes', 'flowing energy', 'melting distortion'],
  preview: 'noise', performance: 'moderate',
  exportSupport: 'baked',
  inputs: [
    posIn(), scaleIn(),
    n('strength', 'Strength', 0.5),
    n('octaves', 'Detail', 2, { min: 1, max: 8 }),
    seedIn(),
  ],
  outputs: [{ key: 'out', label: 'Warped position', type: 'vector3' }],
  evaluate: (api, i) => {
    const p = scaled(i);
    const seed = Math.round(i.seed) ^ api.seed;
    const oct = Math.round(i.octaves);
    return [0, 1, 2].map((k) =>
      i.position[k] + N.fbm(N.perlin3, p[0], p[1], p[2], { octaves: oct, seed: seed + k * 6151 }) * i.strength);
  },
});
