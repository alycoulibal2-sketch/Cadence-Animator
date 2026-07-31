// Vector node family (spec Part 7).
//
// Notice what is NOT here: Add, Subtract, Multiply and Divide. Those already work on vectors,
// because the Math family is generic over every numeric type. Duplicating them as "Vector Add"
// would be exactly the copy-paste Part 79 forbids. This file holds only the operations that are
// genuinely about vectors — the ones that change dimensionality (length, dot) or care about
// direction (cross, reflect, project).

import { registerNode } from '../registry.js';
import * as V from '../values.js';
import { node, n, v3, out } from './_helpers.js';

const C = 'Vector';

// ---------------------------------------------------------------- construction
node({
  id: 'cadence.vector.combine', label: 'Combine Vector', category: C, subcategory: 'Construct',
  aliases: ['make vector', 'vector from xyz', 'build', 'xyz', 'compose'],
  summary: 'Builds a vector from separate X, Y and Z numbers.',
  exportSupport: 'baked',
  inputs: [n('x', 'X'), n('y', 'Y'), n('z', 'Z')],
  outputs: [{ key: 'out', label: 'Vector', type: 'vector3' }],
  evaluate: (api, i) => [i.x, i.y, i.z],
});

node({
  id: 'cadence.vector.separate', label: 'Separate Vector', category: C, subcategory: 'Construct',
  aliases: ['split vector', 'break', 'xyz out', 'components', 'decompose'],
  summary: 'Splits a vector into its separate X, Y and Z numbers.',
  exportSupport: 'baked',
  inputs: [v3('vector', 'Vector')],
  outputs: [
    { key: 'x', label: 'X', type: 'float' },
    { key: 'y', label: 'Y', type: 'float' },
    { key: 'z', label: 'Z', type: 'float' },
  ],
  evaluate: (api, i) => ({ x: i.vector[0], y: i.vector[1], z: i.vector[2] }),
});

node({
  id: 'cadence.vector.combine2', label: 'Combine Vector 2', category: C, subcategory: 'Construct',
  aliases: ['make vector2', 'uv', 'xy'],
  summary: 'Builds a two-component vector from separate X and Y numbers.',
  exportSupport: 'baked',
  inputs: [n('x', 'X'), n('y', 'Y')],
  outputs: [{ key: 'out', label: 'Vector', type: 'vector2' }],
  evaluate: (api, i) => [i.x, i.y],
});

// ---------------------------------------------------------------- measurement
node({
  id: 'cadence.vector.length', label: 'Length', category: C, subcategory: 'Measure',
  aliases: ['magnitude', 'size', 'distance from origin', 'norm', 'speed'],
  summary: 'How long the vector is.',
  teach: 'Measures a direction arrow. A vector pointing 3 right and 4 up has a length of 5.',
  commonUses: ['turning a velocity into a speed', 'turning an offset into a distance for a falloff'],
  exportSupport: 'baked',
  inputs: [v3('vector', 'Vector')],
  outputs: [{ key: 'out', label: 'Length', type: 'float', unit: 'studs' }],
  evaluate: (api, i) => V.vLength(i.vector),
});

node({
  id: 'cadence.vector.distance', label: 'Distance', category: C, subcategory: 'Measure',
  aliases: ['how far', 'between', 'gap', 'proximity', 'radius'],
  summary: 'How far apart two points are.',
  commonUses: ['distance-based falloff, the backbone of most soft edges'],
  exportSupport: 'baked',
  inputs: [v3('a', 'From'), v3('b', 'To')],
  outputs: [{ key: 'out', label: 'Distance', type: 'float', unit: 'studs' }],
  evaluate: (api, i) => V.vDistance(i.a, i.b),
});

node({
  id: 'cadence.vector.dot', label: 'Dot Product', category: C, subcategory: 'Measure',
  aliases: ['dot', 'alignment', 'facing', 'similarity', 'fresnel'],
  summary: 'Measures how similarly two directions point: 1 is the same way, 0 is at right angles, -1 is opposite.',
  teach: 'Asks "are these two arrows pointing the same way?" Answer 1 means yes, 0 means they are at right angles, -1 means they point opposite ways.',
  explain: 'For unit-length inputs this is the cosine of the angle between them. It is the standard way to build a facing test, a rim/fresnel term, or a directional mask.',
  commonUses: ['rim light and fresnel', 'checking whether a particle moves toward the camera'],
  exportSupport: 'baked',
  inputs: [v3('a', 'A'), v3('b', 'B')],
  outputs: [{ key: 'out', label: 'Result', type: 'float' }],
  evaluate: (api, i) => V.vDot(i.a, i.b),
});

node({
  id: 'cadence.vector.angle', label: 'Angle', category: C, subcategory: 'Measure',
  aliases: ['angle between', 'how far apart in degrees'],
  summary: 'The angle between two directions, always positive.',
  exportSupport: 'baked',
  inputs: [v3('a', 'A'), v3('b', 'B')],
  outputs: [{ key: 'out', label: 'Angle', type: 'float', unit: 'radians' }],
  evaluate: (api, i) => V.vAngle(i.a, i.b),
});

node({
  id: 'cadence.vector.signedAngle', label: 'Signed Angle', category: C, subcategory: 'Measure',
  aliases: ['angle around', 'which way round', 'clockwise'],
  summary: 'The angle between two directions, negative when the turn goes the other way round the given axis.',
  explain: 'Angle alone cannot tell clockwise from anticlockwise. Supplying the axis to measure around resolves it, which is what you need for a spiral, a compass heading, or an angular gradient that wraps the full way round.',
  exportSupport: 'baked',
  inputs: [v3('a', 'From'), v3('b', 'To'), v3('axis', 'Around axis', [0, 1, 0])],
  outputs: [{ key: 'out', label: 'Angle', type: 'float', unit: 'radians' }],
  evaluate: (api, i) => V.vSignedAngle(i.a, i.b, i.axis),
});

// ---------------------------------------------------------------- direction
node({
  id: 'cadence.vector.normalize', label: 'Normalize', category: C, subcategory: 'Direction',
  aliases: ['unit', 'direction only', 'length 1', 'just the direction'],
  summary: 'Shortens or lengthens a vector to exactly 1 unit long, keeping its direction.',
  teach: 'Throws away "how far" and keeps only "which way".',
  explain: 'A zero-length vector has no direction, so it normalises to zero rather than to a NaN. Every degenerate case in this engine resolves to a finite value.',
  exportSupport: 'baked',
  inputs: [v3('vector', 'Vector')],
  outputs: [{ key: 'out', label: 'Direction', type: 'vector3' }],
  evaluate: (api, i) => V.vNormalize(i.vector),
});

node({
  id: 'cadence.vector.directionBetween', label: 'Direction Between', category: C, subcategory: 'Direction',
  aliases: ['toward', 'point at', 'aim', 'look direction', 'from to'],
  summary: 'The unit direction pointing from one place to another.',
  commonUses: ['making particles move toward a target', 'aiming a beam'],
  exportSupport: 'baked',
  inputs: [v3('from', 'From'), v3('to', 'To')],
  outputs: [{ key: 'out', label: 'Direction', type: 'vector3' }],
  evaluate: (api, i) => V.vNormalize([i.to[0] - i.from[0], i.to[1] - i.from[1], i.to[2] - i.from[2]]),
});

node({
  id: 'cadence.vector.cross', label: 'Cross Product', category: C, subcategory: 'Direction',
  aliases: ['cross', 'perpendicular', 'right angle to both', 'sideways', 'tangent', 'swirl'],
  summary: 'A direction at right angles to both inputs.',
  teach: 'Given two arrows, finds the arrow that sticks straight out of the flat surface they make.',
  explain: 'Crossing a radius with an up axis gives the tangential direction, which is how a vortex is built from primitives instead of needing a dedicated swirl node.',
  commonUses: ['building a vortex or orbit direction', 'deriving a surface tangent'],
  exportSupport: 'baked',
  inputs: [v3('a', 'A'), v3('b', 'B', [0, 1, 0])],
  outputs: [{ key: 'out', label: 'Result', type: 'vector3' }],
  evaluate: (api, i) => V.vCross(i.a, i.b),
});

node({
  id: 'cadence.vector.scale', label: 'Scale', category: C, subcategory: 'Direction',
  aliases: ['multiply by number', 'lengthen', 'strength', 'times'],
  summary: 'Makes a vector longer or shorter by a single number, keeping its direction.',
  exportSupport: 'baked',
  inputs: [v3('vector', 'Vector'), n('scale', 'Scale', 1)],
  outputs: [{ key: 'out', label: 'Result', type: 'vector3' }],
  evaluate: (api, i) => i.vector.map((c) => c * i.scale),
});

node({
  id: 'cadence.vector.setLength', label: 'Set Length', category: C, subcategory: 'Direction',
  aliases: ['clamp speed', 'limit magnitude', 'exact length'],
  summary: 'Keeps the direction but forces the vector to an exact length.',
  commonUses: ['giving every particle the same speed regardless of how its direction was built'],
  exportSupport: 'baked',
  inputs: [v3('vector', 'Vector'), n('length', 'Length', 1, { unit: 'studs' })],
  outputs: [{ key: 'out', label: 'Result', type: 'vector3' }],
  evaluate: (api, i) => V.vNormalize(i.vector).map((c) => c * i.length),
});

// ---------------------------------------------------------------- geometry
node({
  id: 'cadence.vector.reflect', label: 'Reflect', category: C, subcategory: 'Geometry',
  aliases: ['bounce', 'mirror', 'ricochet'],
  summary: 'Bounces a direction off a surface with the given normal.',
  commonUses: ['a particle bouncing off a wall'],
  exportSupport: 'baked',
  inputs: [v3('vector', 'Direction'), v3('normal', 'Surface normal', [0, 1, 0])],
  outputs: [{ key: 'out', label: 'Result', type: 'vector3' }],
  evaluate: (api, i) => V.vReflect(i.vector, i.normal),
});

node({
  id: 'cadence.vector.refract', label: 'Refract', category: C, subcategory: 'Geometry',
  aliases: ['bend through', 'glass', 'water', 'snell'],
  summary: 'Bends a direction as it passes into a material with a different refractive index.',
  explain: 'When the angle is too shallow for light to pass through at all (total internal reflection) the result is zero, which a Length or If node downstream can detect. Quietly returning the reflection instead would hide a real physical condition.',
  exportSupport: 'unsupported',
  exportNote: 'Roblox has no screen-space refraction; a refracted direction can only be baked into geometry or approximated.',
  inputs: [v3('vector', 'Direction'), v3('normal', 'Surface normal', [0, 1, 0]), n('ior', 'Index ratio', 1.45, { min: 0 })],
  outputs: [{ key: 'out', label: 'Result', type: 'vector3' }],
  evaluate: (api, i) => V.vRefract(i.vector, i.normal, i.ior),
});

node({
  id: 'cadence.vector.project', label: 'Project', category: C, subcategory: 'Geometry',
  aliases: ['along', 'component along', 'shadow onto'],
  summary: 'The part of a vector that lies along another direction.',
  exportSupport: 'baked',
  inputs: [v3('vector', 'Vector'), v3('onto', 'Onto', [0, 1, 0])],
  outputs: [{ key: 'out', label: 'Result', type: 'vector3' }],
  evaluate: (api, i) => V.vProject(i.vector, i.onto),
});

node({
  id: 'cadence.vector.reject', label: 'Reject', category: C, subcategory: 'Geometry',
  aliases: ['perpendicular part', 'remove component', 'flatten', 'tangential'],
  summary: 'The part of a vector left over after removing everything along another direction.',
  commonUses: ['flattening a motion onto a plane', 'isolating sideways drift from forward motion'],
  exportSupport: 'baked',
  inputs: [v3('vector', 'Vector'), v3('onto', 'Remove along', [0, 1, 0])],
  outputs: [{ key: 'out', label: 'Result', type: 'vector3' }],
  evaluate: (api, i) => V.vReject(i.vector, i.onto),
});

node({
  id: 'cadence.vector.rotate', label: 'Rotate Vector', category: C, subcategory: 'Geometry',
  aliases: ['spin', 'turn', 'swirl', 'twist', 'orbit'],
  summary: 'Rotates a vector around an axis by an angle.',
  exportSupport: 'baked',
  inputs: [
    v3('vector', 'Vector', [1, 0, 0]),
    v3('axis', 'Axis', [0, 1, 0]),
    n('angle', 'Angle', 0, { unit: 'radians' }),
  ],
  outputs: [{ key: 'out', label: 'Result', type: 'vector3' }],
  evaluate: (api, i) => V.vRotateAxis(i.vector, i.axis, i.angle),
});

node({
  id: 'cadence.vector.perpendicular', label: 'Any Perpendicular', category: C, subcategory: 'Geometry',
  aliases: ['orthogonal', 'sideways', 'basis', 'tangent frame'],
  summary: 'Some direction at right angles to the input — useful when any perpendicular will do.',
  explain: 'Picks whichever world axis is least aligned with the input before crossing, so the result never collapses to zero however the input is oriented. Which particular perpendicular you get is arbitrary but stable for a given input.',
  exportSupport: 'baked',
  inputs: [v3('vector', 'Vector', [0, 1, 0])],
  outputs: [{ key: 'out', label: 'Perpendicular', type: 'vector3' }],
  evaluate: (api, i) => {
    const v = V.vNormalize(i.vector);
    const ref = Math.abs(v[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    return V.vNormalize(V.vCross(v, ref));
  },
});
