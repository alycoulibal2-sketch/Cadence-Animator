// Procedural patterns (spec Part 16).
//
// Every node here outputs a MASK or a coordinate — a `float` in a stated range, or a `vector` of
// pattern coordinates — never a finished look. Part 16 is explicit about this, and it is the reason
// the family is small: a "stripes" node that also took a colour, a blend mode and an opacity would be
// six nodes' worth of decisions welded shut. Stripes that emit 0-or-1 compose with Mix Color, with
// Color Ramp, with a Curve, with SDF booleans, and with each other.
//
// TWO OUTPUTS ON MOST PATTERNS, and the second is the interesting one:
//
//   `mask`  the pattern itself, 0..1
//   `cell`  which tile/ring/segment/brick you are in, as a number or a vector
//
// `cell` is what makes patterns generative rather than decorative: feed it into a hash to give every
// brick its own colour, every ring its own delay, every grid cell its own random rotation. Without a
// cell id, a pattern can only ever be a texture; with one, it is a way to index a population.
//
// SHARPNESS, on every pattern with an edge: it is the width of the transition in pattern units, not
// a 0..1 "softness" factor. Zero gives a hard edge, which aliases badly on anything that moves —
// so the default is a small non-zero value, chosen so a pattern looks correct rather than looking
// like the aliased default users would otherwise have to learn to fix.

import * as V from '../values.js';
import * as F from '../fields.js';
import * as N from '../noisecore.js';
import { node, n, v3, out, mode, emod } from './_helpers.js';

const C = 'Patterns';

// Patterns are spatial by nature, so their coordinate input follows the point being evaluated unless
// something else is wired in — the same convention as noise and SDFs.
const posIn = () => ({
  key: 'position', label: 'Position', type: 'vector3', default: [0, 0, 0], defaultFrom: 'position',
  description: 'Where to evaluate the pattern. Left unconnected it follows the point being evaluated.',
});
const scaleIn = (dflt = 1) => n('scale', 'Scale', dflt, { min: 1e-4, max: 1000 });
const sharpIn = (dflt = 0.05) => n('sharpness', 'Edge width', dflt, {
  min: 0, max: 1,
  description: 'How wide the transition is, in pattern units. Zero is a hard edge and will alias on anything that moves.',
});

// A soft step centred on `edge`, `w` wide. Degenerates to a hard step at w = 0 rather than dividing
// by zero — the one place a naive implementation produces NaN across an entire pattern.
function sstep(edge, w, x) {
  if (w <= 1e-9) return x < edge ? 0 : 1;
  const t = V.clamp01((x - edge + w * 0.5) / w);
  return t * t * (3 - 2 * t);
}

// A symmetric band: 1 inside `[-half, half]` of the wrapped coordinate, falling off over `w`.
function band(distance, half, w) {
  return 1 - sstep(half, w, distance);
}

const scaled = (i) => {
  const p = V.toComponents('vector3', i.position);
  return [p[0] * i.scale, p[1] * i.scale, p[2] * i.scale];
};

// The two-axis plane a flat (2D) pattern lives in. A pattern has to choose a plane, and making it
// explicit is better than silently using XY: a stripe pattern on a ground plane wants XZ, and
// discovering that by trial and error is a waste of everyone's time.
const planeIn = () => mode('plane', 'Plane', ['xy', 'xz', 'yz'], 'xy');
const onPlane = (p, plane) => (plane === 'xz' ? [p[0], p[2]] : plane === 'yz' ? [p[1], p[2]] : [p[0], p[1]]);

// Shared node shape. Patterns differ only in their maths, so the plumbing is declared once.
function pattern(spec) {
  return node({
    id: spec.id, label: spec.label, category: C, subcategory: spec.subcategory || 'Flat',
    aliases: spec.aliases, summary: spec.summary, teach: spec.teach, explain: spec.explain,
    commonUses: spec.commonUses,
    preview: 'pattern',
    exportSupport: spec.exportSupport || 'baked',
    exportNote: spec.exportNote || 'Baked to a texture on export; Roblox has no procedural pattern node.',
    performance: spec.performance || 'cheap',
    inputs: [posIn(), scaleIn(spec.defaultScale), ...(spec.inputs || [])],
    outputs: spec.outputs || [
      { key: 'mask', label: 'Mask (0-1)', type: 'float' },
      { key: 'cell', label: 'Cell', type: 'float' },
    ],
    evaluate: (api, i) => spec.evaluate(scaled(i), i, api),
  });
}

// ---------------------------------------------------------------- gradients
pattern({
  id: 'cadence.pattern.linearGradient', label: 'Linear Gradient', subcategory: 'Gradients',
  aliases: ['ramp', 'fade', 'linear ramp', 'blend across', 'slope', 'axis fade'],
  summary: 'A value that rises steadily from one end of a direction to the other.',
  teach: 'Fades smoothly from 0 to 1 as you move along a direction.',
  explain: 'Measures how far along the direction you are, between the start and end distances. Everything before the start reads 0 and everything past the end reads 1, so it is a fade with a defined extent rather than one that goes on forever.',
  commonUses: ['fading a beam out along its length', 'a dissolve that sweeps across an object'],
  inputs: [
    v3('direction', 'Direction', [0, 1, 0]),
    n('start', 'Start', 0, { unit: 'studs' }),
    n('end', 'End', 1, { unit: 'studs' }),
  ],
  outputs: [{ key: 'mask', label: 'Value (0-1)', type: 'float' }, { key: 'raw', label: 'Distance along', type: 'float', unit: 'studs' }],
  evaluate: (p, i) => {
    const d = V.vNormalize(V.toComponents('vector3', i.direction));
    const along = V.vDot(p, d);
    const span = i.end - i.start;
    return { mask: Math.abs(span) < 1e-9 ? (along < i.start ? 0 : 1) : V.clamp01((along - i.start) / span), raw: along };
  },
});

pattern({
  id: 'cadence.pattern.radialGradient', label: 'Radial Gradient', subcategory: 'Gradients',
  aliases: ['sphere fade', 'distance fade', 'falloff', 'glow', 'vignette', 'point light falloff', 'centre out'],
  summary: 'A value based on how far you are from a centre point.',
  teach: 'Bright in the middle, fading out as you move away.',
  explain: 'The single most useful pattern in VFX: it is the shape of a glow, a blast radius, a soft particle, a shockwave and a vignette. Feed the raw distance into a Curve when you want a falloff shape that a plain fade cannot give you.',
  commonUses: ['glows and soft particles', 'blast falloff from an impact point', 'fading an effect out at its edges'],
  inputs: [
    v3('center', 'Centre'),
    n('radius', 'Radius', 1, { min: 1e-4, unit: 'studs' }),
    { key: 'invert', label: 'Invert', type: 'bool', default: false },
  ],
  outputs: [{ key: 'mask', label: 'Value (0-1)', type: 'float' }, { key: 'raw', label: 'Distance', type: 'float', unit: 'studs' }],
  evaluate: (p, i) => {
    const c = V.toComponents('vector3', i.center);
    const dist = V.vDistance(p, c);
    const t = V.clamp01(dist / Math.max(1e-4, i.radius));
    return { mask: i.invert ? t : 1 - t, raw: dist };
  },
});

pattern({
  id: 'cadence.pattern.angularGradient', label: 'Angular Gradient', subcategory: 'Gradients',
  aliases: ['sweep', 'radar', 'pie', 'clock', 'angle fade', 'conical', 'rotation mask', 'wipe'],
  summary: 'A value that goes once around a centre, from 0 to 1.',
  teach: 'Sweeps around in a circle like a clock hand.',
  explain: 'The angle around the chosen axis, normalised to 0..1. Because it wraps, there is always a seam where 1 meets 0 — that is unavoidable for an angle, and the usual fix is to feed it through Ping Pong so the value comes back rather than jumping.',
  commonUses: ['a radar sweep or scanning effect', 'a circular wipe', 'spiral arms when combined with radius'],
  inputs: [v3('center', 'Centre'), planeIn(), n('offset', 'Rotate', 0, { unit: 'turns' })],
  outputs: [{ key: 'mask', label: 'Angle (0-1)', type: 'float' }, { key: 'radians', label: 'Angle', type: 'float', unit: 'radians' }],
  evaluate: (p, i) => {
    const c = V.toComponents('vector3', i.center);
    const [u, w] = onPlane([p[0] - c[0], p[1] - c[1], p[2] - c[2]], i.plane);
    const a = Math.atan2(w, u);
    return { mask: emod(a / (Math.PI * 2) + i.offset, 1), radians: a };
  },
});

// ---------------------------------------------------------------- tilings
pattern({
  id: 'cadence.pattern.checker', label: 'Checker', subcategory: 'Tilings',
  aliases: ['chequerboard', 'chess', 'alternating squares', 'test pattern', 'uv check'],
  summary: 'Alternating squares, on or off.',
  explain: 'Also the standard way to check that a UV mapping or a scale is what you think it is: a checker that looks stretched means the coordinates are stretched.',
  inputs: [{ key: 'threeD', label: '3D', type: 'bool', default: false, description: 'Alternate along all three axes rather than in a plane.' }, planeIn()],
  evaluate: (p, i) => {
    const cells = i.threeD ? [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])] : (() => { const [u, w] = onPlane(p, i.plane); return [Math.floor(u), Math.floor(w), 0]; })();
    const parity = emod(cells[0] + cells[1] + cells[2], 2);
    return { mask: parity < 1 ? 0 : 1, cell: cells[0] * 73856093 ^ cells[1] * 19349663 ^ cells[2] * 83492791 };
  },
});

pattern({
  id: 'cadence.pattern.grid', label: 'Grid', subcategory: 'Tilings',
  aliases: ['lines', 'mesh lines', 'wireframe', 'graph paper', 'tech lines', 'hologram lines', 'scan lines'],
  summary: 'Thin lines on a regular grid.',
  commonUses: ['hologram and tech overlays', 'a floor grid', 'scan lines when only one axis is used'],
  inputs: [n('thickness', 'Line thickness', 0.05, { min: 0, max: 0.5 }), sharpIn(0.01), planeIn()],
  evaluate: (p, i) => {
    const [u, w] = onPlane(p, i.plane);
    const du = Math.abs(emod(u, 1) - 0.5), dw = Math.abs(emod(w, 1) - 0.5);
    const half = 0.5 - V.clamp(i.thickness, 0, 0.5);
    const line = Math.max(sstep(half, i.sharpness, du), sstep(half, i.sharpness, dw));
    return { mask: line, cell: Math.floor(u) * 73856093 ^ Math.floor(w) * 19349663 };
  },
});

pattern({
  id: 'cadence.pattern.stripes', label: 'Stripes', subcategory: 'Tilings',
  aliases: ['bands', 'lines', 'ribs', 'barber pole', 'venetian', 'slats'],
  summary: 'Parallel bands, on or off.',
  explain: 'Stripes running along a direction. Combine with Angular Gradient instead of Position to get radiating spokes, or with Radial Gradient to get concentric bands — the pattern is the same, only the coordinate changes.',
  commonUses: ['energy bands travelling along a beam', 'spokes radiating from a centre', 'venetian-blind dissolves'],
  inputs: [v3('direction', 'Direction', [0, 1, 0]), n('width', 'Stripe width', 0.5, { min: 0, max: 1 }), sharpIn()],
  evaluate: (p, i) => {
    const d = V.vNormalize(V.toComponents('vector3', i.direction));
    const along = V.vDot(p, d);
    const f = emod(along, 1);
    const w = V.clamp01(i.width);
    return { mask: 1 - sstep(w, i.sharpness, f), cell: Math.floor(along) };
  },
});

pattern({
  id: 'cadence.pattern.rings', label: 'Rings', subcategory: 'Tilings',
  aliases: ['concentric', 'ripples', 'target', 'bullseye', 'shockwave rings', 'sonar', 'tree rings'],
  summary: 'Concentric rings expanding from a centre.',
  teach: 'Rings like ripples in a pond.',
  explain: 'Rings are stripes measured from a point rather than along a direction. Animate the phase and they travel outwards, which is the whole of a shockwave, a sonar ping or a ripple.',
  commonUses: ['expanding shockwave rings', 'sonar and radar pings', 'ripples on water'],
  inputs: [
    v3('center', 'Centre'),
    n('thickness', 'Ring thickness', 0.3, { min: 0, max: 1 }),
    n('phase', 'Phase', 0, { unit: 'turns', description: 'Shifts the rings outwards. Animate this to make them travel.' }),
    sharpIn(),
  ],
  evaluate: (p, i) => {
    const dist = V.vDistance(p, V.toComponents('vector3', i.center));
    const f = emod(dist - i.phase, 1);
    return { mask: 1 - sstep(V.clamp01(i.thickness), i.sharpness, f), cell: Math.floor(dist - i.phase) };
  },
});

pattern({
  id: 'cadence.pattern.dots', label: 'Dots', subcategory: 'Tilings',
  aliases: ['polka', 'circles', 'spots', 'halftone', 'bubbles', 'holes'],
  summary: 'Round dots on a regular grid.',
  inputs: [n('radius', 'Dot radius', 0.3, { min: 0, max: 0.7071 }), sharpIn(), planeIn()],
  evaluate: (p, i) => {
    const [u, w] = onPlane(p, i.plane);
    const du = emod(u, 1) - 0.5, dw = emod(w, 1) - 0.5;
    const d = Math.sqrt(du * du + dw * dw);
    return { mask: 1 - sstep(Math.max(0, i.radius), i.sharpness, d), cell: Math.floor(u) * 73856093 ^ Math.floor(w) * 19349663 };
  },
});

pattern({
  id: 'cadence.pattern.bricks', label: 'Bricks', subcategory: 'Tilings',
  aliases: ['wall', 'masonry', 'offset grid', 'staggered', 'brickwork', 'tiles'],
  summary: 'Offset rows of rectangles with mortar lines between them.',
  explain: 'Every other row is shifted, which is what stops the pattern reading as a grid. The cell output identifies each individual brick, so a hash of it gives every brick its own shade or its own crumbling delay.',
  commonUses: ['a wall that disintegrates brick by brick', 'staggered tiles'],
  inputs: [
    v3('proportions', 'Brick size', [1, 0.5, 0], { description: 'Width and height of one brick, in pattern units.' }),
    n('offset', 'Row shift', 0.5, { min: 0, max: 1 }),
    n('mortar', 'Mortar thickness', 0.05, { min: 0, max: 0.5 }),
    sharpIn(0.01), planeIn(),
  ],
  evaluate: (p, i) => {
    const prop = V.toComponents('vector3', i.proportions);
    const bw = Math.max(1e-4, Math.abs(prop[0])), bh = Math.max(1e-4, Math.abs(prop[1]));
    const [u0, w0] = onPlane(p, i.plane);
    const row = Math.floor(w0 / bh);
    const u = u0 / bw + (emod(row, 2) < 1 ? 0 : i.offset);
    const w = w0 / bh;
    const du = Math.abs(emod(u, 1) - 0.5), dw = Math.abs(emod(w, 1) - 0.5);
    const half = 0.5 - V.clamp(i.mortar, 0, 0.5);
    const inBrick = Math.min(1 - sstep(half, i.sharpness, du), 1 - sstep(half, i.sharpness, dw));
    return { mask: inBrick, cell: Math.floor(u) * 73856093 ^ row * 19349663 };
  },
});

pattern({
  id: 'cadence.pattern.hexagons', label: 'Hexagons', subcategory: 'Tilings',
  aliases: ['hex', 'honeycomb', 'shield pattern', 'tech hex', 'force field'],
  summary: 'A honeycomb of hexagonal cells.',
  commonUses: ['sci-fi shield surfaces', 'hex-tiled dissolves', 'tech panelling'],
  performance: 'moderate',
  inputs: [n('thickness', 'Edge thickness', 0.08, { min: 0, max: 0.5 }), sharpIn(0.02), planeIn()],
  evaluate: (p, i) => {
    // Hex tiling by taking the nearer of two offset rectangular lattices — the standard trick, and
    // exact: the resulting cell boundaries ARE the hexagon edges.
    const [u, w] = onPlane(p, i.plane);
    const S = [1, 1.7320508075688772];       // hex spacing: 1 across, sqrt(3) up
    const a = [emod(u, S[0]) - S[0] / 2, emod(w, S[1]) - S[1] / 2];
    const b = [emod(u + S[0] / 2, S[0]) - S[0] / 2, emod(w + S[1] / 2, S[1]) - S[1] / 2];
    const la = Math.sqrt(a[0] * a[0] + a[1] * a[1]);
    const lb = Math.sqrt(b[0] * b[0] + b[1] * b[1]);
    const near = la < lb ? a : b;
    const cx = la < lb ? Math.floor(u / S[0]) : Math.floor((u + S[0] / 2) / S[0]) + 1000;
    const cy = la < lb ? Math.floor(w / S[1]) : Math.floor((w + S[1] / 2) / S[1]);
    // Distance to the nearest hex edge: the largest projection onto the three edge normals.
    const d = Math.max(
      Math.abs(near[0]),
      Math.abs(near[0] * 0.5 + near[1] * 0.8660254037844386),
      Math.abs(near[0] * 0.5 - near[1] * 0.8660254037844386),
    );
    const half = 0.5 - V.clamp(i.thickness, 0, 0.5);
    return { mask: sstep(half, i.sharpness, d), cell: cx * 73856093 ^ cy * 19349663 };
  },
});

// ---------------------------------------------------------------- shapes and spirals
pattern({
  id: 'cadence.pattern.waves', label: 'Waves', subcategory: 'Shapes',
  aliases: ['sine pattern', 'ripple', 'wavy', 'undulate', 'corrugated'],
  summary: 'A smooth wave running along a direction.',
  explain: 'Unlike Stripes this has no edges at all — it is a sine, so it is naturally smooth and never aliases. That makes it the right choice for a displacement, where a hard-edged pattern would produce a visible staircase.',
  commonUses: ['displacing a surface into ripples', 'a smooth pulse travelling along a beam'],
  inputs: [
    v3('direction', 'Direction', [0, 1, 0]),
    n('phase', 'Phase', 0, { unit: 'turns' }),
    { key: 'signed', label: 'Allow negative', type: 'bool', default: false, description: 'On: -1 to 1, for displacing in both directions. Off: 0 to 1, for a mask.' },
  ],
  outputs: [{ key: 'mask', label: 'Value', type: 'float' }, { key: 'cell', label: 'Wave number', type: 'float' }],
  evaluate: (p, i) => {
    const d = V.vNormalize(V.toComponents('vector3', i.direction));
    const along = V.vDot(p, d) + i.phase;
    const s = Math.sin(along * Math.PI * 2);
    return { mask: i.signed ? s : s * 0.5 + 0.5, cell: Math.floor(along) };
  },
});

pattern({
  id: 'cadence.pattern.spiral', label: 'Spiral', subcategory: 'Shapes',
  aliases: ['swirl', 'helix pattern', 'whirlpool', 'galaxy arms', 'vortex pattern', 'twist pattern'],
  summary: 'Arms winding out from a centre.',
  teach: 'Curls around a centre point, getting wider as it goes.',
  explain: 'A spiral is an angular gradient with the radius mixed in: turn the angle by an amount that grows with distance and the stripes wind. More arms means more stripes around; tightness is how quickly they wind.',
  commonUses: ['galaxy arms', 'a whirlpool or vortex surface', 'swirling energy'],
  inputs: [
    v3('center', 'Centre'),
    n('arms', 'Arms', 2, { min: 1, max: 32 }),
    n('tightness', 'Tightness', 1),
    n('phase', 'Rotation', 0, { unit: 'turns' }),
    sharpIn(0.1), planeIn(),
  ],
  evaluate: (p, i) => {
    const c = V.toComponents('vector3', i.center);
    const [u, w] = onPlane([p[0] - c[0], p[1] - c[1], p[2] - c[2]], i.plane);
    const r = Math.sqrt(u * u + w * w);
    const a = Math.atan2(w, u) / (Math.PI * 2);
    const t = emod((a + r * i.tightness + i.phase) * Math.max(1, i.arms), 1);
    return { mask: 1 - sstep(0.5, i.sharpness, t), cell: Math.floor((a + r * i.tightness + i.phase) * Math.max(1, i.arms)) };
  },
});

pattern({
  id: 'cadence.pattern.star', label: 'Star', subcategory: 'Shapes',
  aliases: ['spikes', 'flare', 'burst', 'rays', 'sparkle', 'anime impact', 'glint'],
  summary: 'A star or burst of spikes radiating from a centre.',
  commonUses: ['a sparkle or lens glint', 'anime-style impact bursts', 'a spiky shockwave silhouette'],
  inputs: [
    v3('center', 'Centre'),
    n('points', 'Points', 5, { min: 2, max: 64 }),
    n('radius', 'Radius', 1, { min: 1e-4, unit: 'studs' }),
    n('sharpnessOfPoints', 'Spike length', 0.5, { min: 0, max: 1, description: 'How far the spikes reach in compared to the outer radius.' }),
    sharpIn(0.02), planeIn(),
  ],
  evaluate: (p, i) => {
    const c = V.toComponents('vector3', i.center);
    const [u, w] = onPlane([p[0] - c[0], p[1] - c[1], p[2] - c[2]], i.plane);
    const r = Math.sqrt(u * u + w * w);
    const a = Math.atan2(w, u);
    const pts = Math.max(2, Math.round(i.points));
    // A cosine in the angle modulates the radius between the inner and outer points.
    const wobble = Math.abs(Math.cos(a * pts * 0.5));
    const inner = 1 - V.clamp01(i.sharpnessOfPoints);
    const edge = Math.max(1e-4, i.radius) * (inner + (1 - inner) * wobble);
    return { mask: 1 - sstep(edge, i.sharpness * Math.max(1e-4, i.radius), r), cell: Math.floor(a / (Math.PI * 2) * pts) };
  },
});

// ---------------------------------------------------------------- cells
pattern({
  id: 'cadence.pattern.cells', label: 'Cells', subcategory: 'Cells',
  aliases: ['voronoi cells', 'crackle', 'shatter', 'organic tiles', 'stone', 'cracks', 'scales', 'fracture pattern'],
  summary: 'Irregular organic cells, with an id for each one.',
  teach: 'Breaks space into random blobby tiles, like cracked mud or fish scales.',
  explain: 'Voronoi cells. The distance output is how far you are from the nearest cell centre, which reads as cracks when you threshold it; the cell id lets you give each cell its own colour, delay or direction. Randomness of 0 collapses the cells onto a regular grid — occasionally what you want.',
  commonUses: ['a wall cracking into shards', 'organic scales or crystal facets', 'per-cell random colour variation'],
  performance: 'moderate',
  inputs: [
    n('randomness', 'Irregularity', 1, { min: 0, max: 1 }),
    n('seed', 'Variation', 0),
    mode('metric', 'Shape', ['euclidean', 'manhattan', 'chebyshev'], 'euclidean'),
  ],
  outputs: [
    { key: 'mask', label: 'Distance to centre', type: 'float', unit: 'studs' },
    { key: 'cell', label: 'Cell id (0-1)', type: 'float' },
    { key: 'edge', label: 'Distance to edge', type: 'float', unit: 'studs' },
    { key: 'center', label: 'Cell centre', type: 'vector3', unit: 'studs' },
  ],
  evaluate: (p, i, api) => {
    const r = N.voronoi3(p[0], p[1], p[2], Math.round(i.seed) ^ api.seed, V.clamp01(i.randomness), i.metric);
    return {
      mask: r.f1,
      cell: r.cell,
      // The gap between the nearest and second-nearest centre: zero exactly on a cell boundary and
      // growing towards the middle of a cell. This is the crack metric — thresholding `mask` instead
      // gives blobs around each centre, which is a different (and usually wrong) look.
      edge: r.f2 - r.f1,
      center: r.position,
    };
  },
});

pattern({
  id: 'cadence.pattern.randomCells', label: 'Random Cells', subcategory: 'Cells',
  aliases: ['random tiles', 'per cell value', 'mosaic', 'pixelate', 'blocky random', 'flicker cells'],
  summary: 'A different random value in each cell of a regular grid.',
  explain: 'The quantised counterpart to noise: constant within a cell and unrelated between cells. Useful anywhere a population needs per-member variation that is stable in space — one shade per tile, one delay per brick, one flicker phase per panel.',
  commonUses: ['per-tile brightness variation', 'pixelating an effect', 'staggering an animation cell by cell'],
  inputs: [n('seed', 'Variation', 0), { key: 'threeD', label: '3D', type: 'bool', default: true }, planeIn()],
  outputs: [
    { key: 'mask', label: 'Value (0-1)', type: 'float' },
    { key: 'cell', label: 'Cell id', type: 'float' },
  ],
  evaluate: (p, i, api) => {
    const seed = Math.round(i.seed) ^ api.seed;
    const cells = i.threeD
      ? [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])]
      : (() => { const [u, w] = onPlane(p, i.plane); return [Math.floor(u), Math.floor(w), 0]; })();
    return {
      mask: N.white3(cells[0] + 0.5, cells[1] + 0.5, cells[2] + 0.5, seed),
      cell: cells[0] * 73856093 ^ cells[1] * 19349663 ^ cells[2] * 83492791,
    };
  },
});
