// The node-group library (spec Part 47).
//
// PART 47 CHANGES CADENCE'S LIBRARY PHILOSOPHY, and states the acceptance test itself:
//
//   "A user should be able to delete the entire complete-effect library and still build new effects.
//    That is an important test."
//
// This file passes that test by construction: every entry is a RECIPE — a list of primitive nodes and
// the wires between them — not an engine capability. Deleting this module removes some convenience and
// changes nothing about what the engine can express. Nothing else imports it, and no node type is
// defined here.
//
// WHY RECIPES RATHER THAN SERIALIZED GROUPS. A stored group document would freeze the node ids and
// versions of the day it was written; a recipe is re-evaluated against the live registry every time it
// is used, so a group built from `cadence.noise.curl` picks up an improved curl noise automatically and
// FAILS LOUDLY if a node it needs is gone, rather than loading as a silently broken subgraph.
//
// The entries are drawn from Part 47's own list (Orbit Field, Curl Motion, Shockwave Geometry, Soft
// Glow, Fire Turbulence, Radial Burst, Dissolve, Impact Camera, Smoke Advection) plus the ones that
// turned out to be genuinely reusable while building the engine. Where Part 47 names something this
// engine cannot yet do — Impact Camera needs the camera nodes, Smoke Advection needs the volume solver —
// it is ABSENT rather than approximated, and §"unavailable" below says which and why.

import { newGraph, newNode, connect, newGroupDef, nodesInScope, GROUP_INPUT_TYPE, GROUP_OUTPUT_TYPE } from './graph.js';
import { getNode as getNodeType } from './registry.js';

// A recipe: the group's boundary, its interior nodes, and its wires. `nodes` is a map of local names to
// [type, values]; `links` uses those local names, plus the reserved `in` and `out` for the boundary.
// Local names rather than ids because a recipe is read by humans as often as by the builder.
const RECIPES = {
  // ---------------------------------------------------------------- forces and motion
  curlMotion: {
    name: 'Curl Motion',
    category: 'Forces',
    description: 'Swirling, divergence-free motion — the force that makes particles read as smoke rather than as drifting dust.',
    teaches: 'Curl noise is a vector field, and a force input takes any vector field. Strength is just a multiply.',
    inputs: [
      { key: 'scale', label: 'Scale', type: 'float', default: 0.4 },
      { key: 'strength', label: 'Strength', type: 'float', default: 8 },
      { key: 'detail', label: 'Detail', type: 'float', default: 2 },
    ],
    outputs: [{ key: 'force', label: 'Force', type: 'field<vector3>' }],
    nodes: {
      curl: ['cadence.noise.curl', { scale: 0.4, octaves: 2 }],
      gain: ['cadence.math.multiply', { b: 8 }],
    },
    links: [
      ['in.scale', 'curl.scale'],
      ['in.detail', 'curl.octaves'],
      ['in.strength', 'gain.b'],
      ['curl.out', 'gain.a'],
      ['gain.out', 'out.force'],
    ],
  },

  orbitField: {
    name: 'Orbit Field',
    category: 'Forces',
    description: 'Holds particles in a ring at a chosen radius while they circle a centre.',
    teaches: 'A vortex swirls but lets the radius drift; adding a spring toward a target radius is what makes a stable ring.',
    inputs: [
      { key: 'center', label: 'Centre', type: 'vector3', default: [0, 0, 0] },
      { key: 'radius', label: 'Radius', type: 'float', default: 3 },
      { key: 'speed', label: 'Speed', type: 'float', default: 4 },
    ],
    outputs: [{ key: 'force', label: 'Force', type: 'field<vector3>' }],
    nodes: { orbit: ['cadence.fields.orbit', {}] },
    links: [
      ['in.center', 'orbit.center'],
      ['in.radius', 'orbit.radius'],
      ['in.speed', 'orbit.strength'],
      ['orbit.out', 'out.force'],
    ],
  },

  fireTurbulence: {
    name: 'Fire Turbulence',
    category: 'Forces',
    description: 'Upward buoyancy plus turbulence that grows with height — the motion a flame has.',
    teaches: 'Combining forces is an Add. Making one vary with height is Position, Separate, and a multiply.',
    inputs: [
      { key: 'rise', label: 'Rise', type: 'float', default: 9 },
      { key: 'turbulence', label: 'Turbulence', type: 'float', default: 5 },
      { key: 'scale', label: 'Scale', type: 'float', default: 0.6 },
    ],
    outputs: [{ key: 'force', label: 'Force', type: 'field<vector3>' }],
    nodes: {
      up: ['cadence.fields.constantDirection', { direction: [0, 1, 0], strength: 9 }],
      noise: ['cadence.noise.curl', { scale: 0.6, octaves: 3 }],
      pos: ['cadence.fields.position', {}],
      sep: ['cadence.vector.separate', {}],
      // Turbulence ramps in with height, so the base of the flame is steady and the top is chaotic —
      // which is the single cue that separates fire from a puff of smoke.
      ramp: ['cadence.math.mapRange', { fromMin: 0, fromMax: 4, toMin: 0.15, toMax: 1 }],
      strength: ['cadence.math.multiply', { b: 5 }],
      scaled: ['cadence.math.multiply', {}],
      total: ['cadence.math.add', {}],
    },
    links: [
      ['in.rise', 'up.strength'],
      ['in.scale', 'noise.scale'],
      ['in.turbulence', 'strength.b'],
      ['pos.out', 'sep.vector'],
      ['sep.y', 'ramp.value'],
      ['ramp.out', 'strength.a'],
      ['noise.out', 'scaled.a'],
      ['strength.out', 'scaled.b'],
      ['up.out', 'total.a'],
      ['scaled.out', 'total.b'],
      ['total.out', 'out.force'],
    ],
  },

  // ---------------------------------------------------------------- looks
  softGlow: {
    name: 'Soft Glow',
    category: 'Materials',
    description: 'An additive material that fades out over a particle\'s life, with a hot core.',
    teaches: 'There is no "colour over lifetime" property: Normalized Age into a Gradient is the pattern, and it works for every other over-life curve too.',
    inputs: [
      { key: 'gradient', label: 'Colours', type: 'gradient', default: { kind: 'color', stops: [{ u: 0, v: '#ffffff' }, { u: 0.4, v: '#80c0ff' }, { u: 1, v: '#101840' }] } },
      { key: 'opacity', label: 'Opacity', type: 'float', default: 0.6 },
    ],
    outputs: [{ key: 'material', label: 'Material', type: 'material' }],
    nodes: {
      life: ['cadence.particles.life', {}],
      grad: ['cadence.color.sampleGradient', {}],
      // Opacity fades with life as well as being scaled, so the glow dies out instead of vanishing.
      fade: ['cadence.math.subtract', { a: 1 }],
      scale: ['cadence.math.multiply', { b: 0.6 }],
      mat: ['cadence.material.surface', { blend: 'additive' }],
    },
    links: [
      ['in.gradient', 'grad.gradient'],
      ['in.opacity', 'scale.b'],
      ['life.out', 'grad.position'],
      ['life.out', 'fade.b'],
      ['fade.out', 'scale.a'],
      ['grad.out', 'mat.baseColor'],
      ['scale.out', 'mat.opacity'],
      ['mat.out', 'out.material'],
    ],
  },

  dissolve: {
    name: 'Dissolve',
    category: 'Materials',
    description: 'A noise-driven threshold that eats a surface away over time.',
    teaches: 'A dissolve is a noise field compared against a rising threshold. Feeding the comparison into opacity is all there is to it.',
    inputs: [
      { key: 'progress', label: 'Progress', type: 'float', default: 0 },
      { key: 'scale', label: 'Scale', type: 'float', default: 6 },
      { key: 'softness', label: 'Edge softness', type: 'float', default: 0.1 },
    ],
    outputs: [{ key: 'opacity', label: 'Opacity', type: 'field<float>' }],
    nodes: {
      noise: ['cadence.noise.fbm', { scale: 6, octaves: 3 }],
      // Smoothstep between progress and progress+softness gives a soft eaten edge rather than a hard
      // cutoff, which is what makes a dissolve read as burning rather than as clipping.
      edge: ['cadence.math.add', {}],
      mask: ['cadence.math.smoothstep', {}],
    },
    links: [
      ['in.scale', 'noise.scale'],
      ['in.progress', 'mask.a'],
      ['in.progress', 'edge.a'],
      ['in.softness', 'edge.b'],
      ['edge.out', 'mask.b'],
      ['noise.out', 'mask.c'],
      ['mask.out', 'out.opacity'],
    ],
  },

  // ---------------------------------------------------------------- geometry
  shockwaveGeometry: {
    name: 'Shockwave Geometry',
    category: 'Geometry',
    description: 'An expanding ring whose radius and thickness are driven from outside.',
    teaches: 'A shockwave is a disc with an inner radius. Animating both radii is the whole effect.',
    inputs: [
      { key: 'radius', label: 'Radius', type: 'float', default: 3 },
      { key: 'thickness', label: 'Thickness', type: 'float', default: 0.4 },
      { key: 'segments', label: 'Segments', type: 'int', default: 48 },
    ],
    outputs: [{ key: 'geometry', label: 'Geometry', type: 'geometry' }],
    nodes: {
      inner: ['cadence.math.subtract', {}],
      // Clamped at zero: a thickness larger than the radius would give a negative inner radius, which
      // turns the ring inside out rather than simply making it solid.
      clamped: ['cadence.math.maximum', { b: 0 }],
      disc: ['cadence.geometry.disc', { plane: 'xz' }],
    },
    links: [
      ['in.radius', 'inner.a'],
      ['in.thickness', 'inner.b'],
      ['inner.out', 'clamped.a'],
      ['in.radius', 'disc.radius'],
      ['clamped.out', 'disc.innerRadius'],
      ['in.segments', 'disc.segments'],
      ['disc.out', 'out.geometry'],
    ],
  },

  radialBurst: {
    name: 'Radial Burst',
    category: 'Particles',
    description: 'Particles thrown outward from a point in every direction.',
    teaches: 'A burst is an emitter with a burst count and a velocity that points away from the centre — which is Random Unit Vector times a speed.',
    inputs: [
      { key: 'count', label: 'Count', type: 'int', default: 120 },
      { key: 'speed', label: 'Speed', type: 'float', default: 12 },
      { key: 'lifetime', label: 'Lifetime', type: 'float', default: 0.9 },
    ],
    outputs: [{ key: 'emitter', label: 'Emitter', type: 'emitter' }],
    nodes: {
      dir: ['cadence.random.unitVector', {}],
      vel: ['cadence.math.multiply', { b: 12 }],
      em: ['cadence.particles.emitter', { rate: 0, burstTime: 0 }],
    },
    links: [
      ['in.speed', 'vel.b'],
      ['dir.out', 'vel.a'],
      ['vel.out', 'em.velocity'],
      ['in.count', 'em.burstCount'],
      ['in.lifetime', 'em.lifetime'],
      ['em.out', 'out.emitter'],
    ],
  },

  sizeOverLife: {
    name: 'Size Over Life',
    category: 'Particles',
    description: 'A grow-then-shrink size curve driven by a particle\'s own age.',
    teaches: 'The pattern that replaces every "over lifetime" property in the engine: Normalized Age into a Curve.',
    inputs: [
      { key: 'curve', label: 'Shape', type: 'curve', default: { kind: 'float', keys: [{ t: 0, v: 0.1 }, { t: 0.25, v: 1 }, { t: 1, v: 0 }] } },
      { key: 'size', label: 'Size', type: 'float', default: 0.5 },
    ],
    outputs: [{ key: 'size', label: 'Size', type: 'field<float>' }],
    nodes: {
      life: ['cadence.particles.life', {}],
      curve: ['cadence.curve.evaluate', {}],
      scale: ['cadence.math.multiply', { b: 0.5 }],
    },
    links: [
      ['in.curve', 'curve.curve'],
      ['in.size', 'scale.b'],
      ['life.out', 'curve.position'],
      ['curve.out', 'scale.a'],
      ['scale.out', 'out.size'],
    ],
  },

  // ---------------------------------------------------------------- textures
  fireTexture: {
    name: 'Fire Texture',
    category: 'Textures',
    description: 'A fire-coloured sprite built from layered noise, with a soft glow.',
    teaches: 'Rasterize is where a field becomes pixels. Levels stretches noise to full contrast; Gradient Map turns brightness into colour.',
    inputs: [
      { key: 'resolution', label: 'Resolution', type: 'int', default: 128 },
      { key: 'scale', label: 'Scale', type: 'float', default: 3 },
      { key: 'gradient', label: 'Colours', type: 'gradient', default: { kind: 'color', stops: [{ u: 0, v: '#000000' }, { u: 0.35, v: '#c02000' }, { u: 0.7, v: '#ffa020' }, { u: 1, v: '#fff8e0' }] } },
    ],
    outputs: [{ key: 'texture', label: 'Texture', type: 'texture2d' }],
    nodes: {
      noise: ['cadence.noise.fbm', { scale: 3, octaves: 4 }],
      ras: ['cadence.texture.rasterize', { resolution: 128 }],
      levels: ['cadence.texture.levels', { inputBlack: 0.3, inputWhite: 0.7 }],
      grad: ['cadence.texture.gradientMap', {}],
      glow: ['cadence.compositing.glow', { threshold: 0.5, radius: 4, intensity: 0.8 }],
    },
    links: [
      ['in.scale', 'noise.scale'],
      ['in.resolution', 'ras.resolution'],
      ['in.gradient', 'grad.gradient'],
      ['noise.out', 'ras.field'],
      ['ras.out', 'levels.texture'],
      ['levels.out', 'grad.texture'],
      ['grad.out', 'glow.texture'],
      ['glow.out', 'out.texture'],
    ],
  },
};

// Part 47 lists these, and this engine cannot build them yet. Named rather than silently missing, so a
// user looking for one finds out why instead of concluding the library is incomplete by accident.
export const UNAVAILABLE = [
  { name: 'Impact Camera', why: 'Camera nodes are not built (spec Part 40), so there is nothing to shake.' },
  { name: 'Smoke Advection', why: 'The volume/fluid solver is not built (spec Parts 31-33). Curl Motion is the closest available thing and reads convincingly for most uses.' },
];

// ---------------------------------------------------------------- building
export function listRecipes() {
  return Object.entries(RECIPES).map(([id, r]) => ({
    id, name: r.name, category: r.category, description: r.description, teaches: r.teaches,
    inputs: r.inputs.map((s) => s.key),
    outputs: r.outputs.map((s) => s.key),
    // Whether this build can actually make it. A recipe naming a node type that no longer exists is a
    // real possibility across versions, and reporting it beats failing at insert time.
    available: Object.values(r.nodes).every(([type]) => !!getNodeType(type)),
    nodeCount: Object.keys(r.nodes).length,
  }));
}

export function getRecipe(id) {
  return RECIPES[id] || null;
}

// Build a recipe into `graph` as a new group, and return its id. Returns { ok: false, reason } rather
// than throwing when a node type is missing, because that is a version-skew condition a caller should
// report, not a crash.
export function buildRecipe(graph, id) {
  const r = RECIPES[id];
  if (!r) return { ok: false, reason: `no recipe called "${id}"` };

  const missing = Object.values(r.nodes).map(([type]) => type).filter((type) => !getNodeType(type));
  if (missing.length) {
    return { ok: false, reason: `this build does not have the node type${missing.length > 1 ? 's' : ''} ${missing.join(', ')}` };
  }

  const group = newGroupDef(graph, r.name, {
    description: r.description,
    inputs: r.inputs,
    outputs: r.outputs,
  });

  const boundary = nodesInScope(graph, group.id);
  const gIn = boundary.find((n) => n.type === GROUP_INPUT_TYPE);
  const gOut = boundary.find((n) => n.type === GROUP_OUTPUT_TYPE);

  const local = { in: gIn, out: gOut };
  const names = Object.keys(r.nodes);
  names.forEach((name, idx) => {
    const [type, values] = r.nodes[name];
    // Laid out in a rough left-to-right chain so opening the group shows something readable rather than
    // a pile at the origin — a group a user is invited to inspect has to be inspectable.
    local[name] = newNode(graph, type, (idx % 4) * 240 - 240, Math.floor(idx / 4) * 160, {
      scope: group.id,
      values: structuredClone(values || {}),
    });
  });
  if (gIn) { gIn.x = -600; gIn.y = 0; }
  if (gOut) { gOut.x = 480; gOut.y = 0; }

  const failures = [];
  for (const [from, to] of r.links) {
    const [fa, fs] = from.split('.');
    const [ta, ts] = to.split('.');
    const a = local[fa], b = local[ta];
    if (!a || !b) { failures.push(`${from} -> ${to} (missing node)`); continue; }
    const res = connect(graph, a.id, fs, b.id, ts);
    if (!res.ok) failures.push(`${from} -> ${to} (${res.reason})`);
  }

  return {
    ok: !failures.length,
    groupId: group.id,
    name: r.name,
    // A recipe whose wiring does not take is a bug in the recipe, and it must be reported rather than
    // producing a half-connected group that looks like the user's mistake.
    failures,
    reason: failures.length ? `some connections in the recipe failed: ${failures.join('; ')}` : undefined,
  };
}
