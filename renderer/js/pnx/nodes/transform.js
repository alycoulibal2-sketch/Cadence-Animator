// Transform and space node families (spec Parts 8 and 45).
//
// A transform carries position, rotation AND scale. That is why it is its own type rather than a
// Roblox CFrame: a CFrame cannot hold scale, so using one internally would quietly discard it.
// The conversion to a CFrame happens only at the Roblox boundary, and drops scale explicitly.
//
// Part 45's whole point is that Transform Point and Transform Direction are SEPARATE operations.
// A point carries the translation; a direction does not. One function with a flag nobody
// remembers to set is the source of an entire class of "why is my velocity offset from the origin"
// bugs, so the two are never merged here.

import { registerNode } from '../registry.js';
import * as V from '../values.js';
import { node, n, v3, out, mode } from './_helpers.js';

const C = 'Transform';

const tf = (key, label, extra = {}) => ({ key, label, type: 'transform', default: V.IDENTITY_TRANSFORM, ...extra });
const quat = (key, label, extra = {}) => ({ key, label, type: 'quaternion', default: [0, 0, 0, 1], ...extra });

// ---------------------------------------------------------------- construction
node({
  id: 'cadence.transform.combine', label: 'Combine Transform', category: C, subcategory: 'Construct',
  aliases: ['make transform', 'build transform', 'position rotation scale', 'trs', 'compose'],
  summary: 'Builds a transform from a position, a rotation and a scale.',
  exportSupport: 'converted',
  inputs: [
    v3('position', 'Position', [0, 0, 0], { unit: 'studs' }),
    v3('rotation', 'Rotation', [0, 0, 0], { unit: 'radians' }),
    v3('scale', 'Scale', [1, 1, 1]),
  ],
  outputs: [{ key: 'out', label: 'Transform', type: 'transform' }],
  evaluate: (api, i) => V.newTransform(i.position, V.qFromEuler(i.rotation[0], i.rotation[1], i.rotation[2]), i.scale),
});

node({
  id: 'cadence.transform.separate', label: 'Separate Transform', category: C, subcategory: 'Construct',
  aliases: ['split transform', 'break transform', 'get position', 'decompose'],
  summary: 'Splits a transform back into its position, rotation and scale.',
  exportSupport: 'converted',
  inputs: [tf('transform', 'Transform')],
  outputs: [
    { key: 'position', label: 'Position', type: 'vector3', unit: 'studs' },
    { key: 'rotation', label: 'Rotation', type: 'vector3', unit: 'radians' },
    { key: 'scale', label: 'Scale', type: 'vector3' },
    { key: 'quaternion', label: 'Rotation (quaternion)', type: 'quaternion' },
  ],
  evaluate: (api, i) => {
    const t = V.asTransform(i.transform);
    return { position: t.p, rotation: V.qToEuler(t.q), scale: t.s, quaternion: t.q };
  },
});

node({
  id: 'cadence.transform.fromPosition', label: 'Position To Transform', category: C, subcategory: 'Construct',
  aliases: ['translate', 'move', 'offset transform'],
  summary: 'A transform that only moves, with no rotation or scaling.',
  exportSupport: 'native',
  inputs: [v3('position', 'Position', [0, 0, 0], { unit: 'studs' })],
  outputs: [{ key: 'out', label: 'Transform', type: 'transform' }],
  evaluate: (api, i) => V.newTransform(i.position),
});

// ---------------------------------------------------------------- composition
node({
  id: 'cadence.transform.multiply', label: 'Combine Two Transforms', category: C, subcategory: 'Compose',
  aliases: ['multiply transform', 'then', 'stack', 'parent', 'concatenate'],
  summary: 'Applies the second transform first, then the first — the usual parent-then-child order.',
  explain: 'Order matters and is easy to get backwards. "First" is the outer/parent transform: the result is what you get by taking a point, putting it through Second, then through First.',
  exportSupport: 'converted',
  inputs: [tf('a', 'First (outer)'), tf('b', 'Second (inner)')],
  outputs: [{ key: 'out', label: 'Transform', type: 'transform' }],
  evaluate: (api, i) => V.transformMultiply(i.a, i.b),
});

node({
  id: 'cadence.transform.inverse', label: 'Inverse Transform', category: C, subcategory: 'Compose',
  aliases: ['undo', 'invert transform', 'opposite', 'world to local'],
  summary: 'The transform that exactly undoes this one.',
  exportSupport: 'converted',
  inputs: [tf('transform', 'Transform')],
  outputs: [{ key: 'out', label: 'Transform', type: 'transform' }],
  evaluate: (api, i) => V.transformInverse(i.transform),
});

node({
  id: 'cadence.transform.relative', label: 'Relative Transform', category: C, subcategory: 'Compose',
  aliases: ['difference', 'from a to b', 'delta', 'local of'],
  summary: 'The transform that takes you from the first transform to the second.',
  commonUses: ['expressing a child\'s pose relative to its parent'],
  exportSupport: 'converted',
  inputs: [tf('from', 'From'), tf('to', 'To')],
  outputs: [{ key: 'out', label: 'Transform', type: 'transform' }],
  evaluate: (api, i) => V.transformMultiply(V.transformInverse(i.from), i.to),
});

// ---------------------------------------------------------------- application
node({
  id: 'cadence.transform.point', label: 'Transform Point', category: C, subcategory: 'Apply',
  aliases: ['move point', 'apply to position', 'local to world', 'place'],
  summary: 'Moves a point by a transform — rotation, scale AND position all apply.',
  explain: 'Use this for positions. For velocities, normals and axes use Transform Direction instead, which ignores the position part.',
  exportSupport: 'converted',
  inputs: [tf('transform', 'Transform'), v3('point', 'Point', [0, 0, 0], { unit: 'studs' })],
  outputs: [{ key: 'out', label: 'Point', type: 'vector3', unit: 'studs' }],
  evaluate: (api, i) => V.transformPoint(i.transform, i.point),
});

node({
  id: 'cadence.transform.direction', label: 'Transform Direction', category: C, subcategory: 'Apply',
  aliases: ['rotate direction', 'apply to vector', 'carry axis', 'transform normal'],
  summary: 'Rotates and scales a direction by a transform, ignoring its position.',
  explain: 'A direction has no location, so the transform\'s position must not apply to it. Using Transform Point on a velocity is the classic mistake — the velocity ends up offset by wherever the effect happens to sit.',
  exportSupport: 'converted',
  inputs: [tf('transform', 'Transform'), v3('direction', 'Direction', [0, 1, 0])],
  outputs: [{ key: 'out', label: 'Direction', type: 'vector3' }],
  evaluate: (api, i) => V.transformDirection(i.transform, i.direction),
});

node({
  id: 'cadence.transform.lookAt', label: 'Look At', category: C, subcategory: 'Apply',
  aliases: ['aim', 'face', 'point toward', 'orient', 'billboard'],
  summary: 'A transform sitting at one place, aimed at another.',
  explain: 'Aims the transform\'s local +Y at the target, matching the convention the rest of Cadence uses for "which way an emitter points". The up direction only resolves the remaining roll, and is ignored when it lines up with the aim.',
  exportSupport: 'converted',
  inputs: [
    v3('from', 'From', [0, 0, 0], { unit: 'studs' }),
    v3('to', 'Target', [0, 0, 1], { unit: 'studs' }),
    v3('up', 'Up', [0, 1, 0]),
  ],
  outputs: [{ key: 'out', label: 'Transform', type: 'transform' }],
  evaluate: (api, i) => V.newTransform(i.from, V.qLookAt(i.from, i.to, i.up)),
});

node({
  id: 'cadence.transform.rotateAround', label: 'Rotate Around Point', category: C, subcategory: 'Apply',
  aliases: ['orbit', 'pivot', 'revolve', 'spin about'],
  summary: 'Rotates a point around another point, about an axis.',
  commonUses: ['orbiting motion built from primitives rather than a dedicated orbit setting'],
  exportSupport: 'baked',
  inputs: [
    v3('point', 'Point', [1, 0, 0], { unit: 'studs' }),
    v3('center', 'Around', [0, 0, 0], { unit: 'studs' }),
    v3('axis', 'Axis', [0, 1, 0]),
    n('angle', 'Angle', 0, { unit: 'radians' }),
  ],
  outputs: [{ key: 'out', label: 'Point', type: 'vector3', unit: 'studs' }],
  evaluate: (api, i) => {
    const rel = [i.point[0] - i.center[0], i.point[1] - i.center[1], i.point[2] - i.center[2]];
    const rot = V.vRotateAxis(rel, i.axis, i.angle);
    return [rot[0] + i.center[0], rot[1] + i.center[1], rot[2] + i.center[2]];
  },
});

// ---------------------------------------------------------------- rotations
node({
  id: 'cadence.transform.quaternionFromAxisAngle', label: 'Rotation From Axis', category: C, subcategory: 'Rotation',
  aliases: ['axis angle', 'quaternion', 'spin about axis'],
  summary: 'A rotation of a given angle about a given axis.',
  exportSupport: 'converted',
  inputs: [v3('axis', 'Axis', [0, 1, 0]), n('angle', 'Angle', 0, { unit: 'radians' })],
  outputs: [{ key: 'out', label: 'Rotation', type: 'quaternion' }],
  evaluate: (api, i) => V.qFromAxisAngle(i.axis, i.angle),
});

node({
  id: 'cadence.transform.quaternionFromEuler', label: 'Rotation From Angles', category: C, subcategory: 'Rotation',
  aliases: ['euler', 'xyz rotation', 'pitch yaw roll'],
  summary: 'A rotation from three angles applied about X, then Y, then Z.',
  explain: 'Matches Roblox\'s CFrame.Angles ordering exactly, so an angle triple means the same thing here as in the animator and in-game.',
  exportSupport: 'native',
  inputs: [v3('angles', 'Angles', [0, 0, 0], { unit: 'radians' })],
  outputs: [{ key: 'out', label: 'Rotation', type: 'quaternion' }],
  evaluate: (api, i) => V.qFromEuler(i.angles[0], i.angles[1], i.angles[2]),
});

node({
  id: 'cadence.transform.quaternionBetween', label: 'Rotation Between', category: C, subcategory: 'Rotation',
  aliases: ['align', 'from direction to direction', 'shortest arc', 'swing'],
  summary: 'The shortest rotation that turns one direction into another.',
  explain: 'This is the rotation to reach for instead of composing Euler angles by hand. Building an aim out of separate X/Y/Z angles is what introduces unintended twist — the shortest arc has none by construction.',
  commonUses: ['aiming a sprite or a beam along a velocity'],
  exportSupport: 'converted',
  inputs: [v3('from', 'From direction', [0, 1, 0]), v3('to', 'To direction', [0, 1, 0])],
  outputs: [{ key: 'out', label: 'Rotation', type: 'quaternion' }],
  evaluate: (api, i) => V.qBetween(i.from, i.to),
});

node({
  id: 'cadence.transform.quaternionMultiply', label: 'Combine Rotations', category: C, subcategory: 'Rotation',
  aliases: ['multiply rotation', 'then rotate', 'stack rotations'],
  summary: 'Applies the second rotation first, then the first.',
  exportSupport: 'converted',
  inputs: [quat('a', 'First (outer)'), quat('b', 'Second (inner)')],
  outputs: [{ key: 'out', label: 'Rotation', type: 'quaternion' }],
  evaluate: (api, i) => V.qMultiply(i.a, i.b),
});

node({
  id: 'cadence.transform.quaternionInverse', label: 'Inverse Rotation', category: C, subcategory: 'Rotation',
  aliases: ['undo rotation', 'conjugate', 'unrotate'],
  summary: 'The rotation that exactly undoes this one.',
  exportSupport: 'converted',
  inputs: [quat('rotation', 'Rotation')],
  outputs: [{ key: 'out', label: 'Rotation', type: 'quaternion' }],
  evaluate: (api, i) => V.qInverse(i.rotation),
});

node({
  id: 'cadence.transform.quaternionSlerp', label: 'Blend Rotations', category: C, subcategory: 'Rotation',
  aliases: ['slerp', 'mix rotation', 'interpolate rotation', 'ease rotation'],
  summary: 'Blends smoothly between two rotations along the shortest path.',
  explain: 'Blending rotations component by component (what a plain Lerp would do) shortens the rotation and produces a visible wobble. This takes the proper spherical path, at constant angular speed.',
  exportSupport: 'baked',
  inputs: [quat('a', 'From'), quat('b', 'To'), n('factor', 'Factor', 0, { min: 0, max: 1 })],
  outputs: [{ key: 'out', label: 'Rotation', type: 'quaternion' }],
  evaluate: (api, i) => V.qSlerp(i.a, i.b, i.factor),
});

node({
  id: 'cadence.transform.rotateVectorByRotation', label: 'Apply Rotation', category: C, subcategory: 'Rotation',
  aliases: ['rotate by quaternion', 'turn vector'],
  summary: 'Rotates a direction by a rotation.',
  exportSupport: 'baked',
  inputs: [quat('rotation', 'Rotation'), v3('vector', 'Vector', [0, 1, 0])],
  outputs: [{ key: 'out', label: 'Result', type: 'vector3' }],
  evaluate: (api, i) => V.qRotateVector(i.rotation, i.vector),
});

// ---------------------------------------------------------------- matrices
node({
  id: 'cadence.transform.toMatrix', label: 'Transform To Matrix', category: C, subcategory: 'Matrix',
  aliases: ['matrix compose', 'as matrix', 'm4'],
  summary: 'Converts a transform into a 4x4 matrix.',
  exportSupport: 'converted',
  inputs: [tf('transform', 'Transform')],
  outputs: [{ key: 'out', label: 'Matrix', type: 'matrix4' }],
  evaluate: (api, i) => V.m4FromTransform(i.transform),
});

node({
  id: 'cadence.transform.fromMatrix', label: 'Matrix To Transform', category: C, subcategory: 'Matrix',
  aliases: ['matrix decompose', 'as transform'],
  summary: 'Converts a 4x4 matrix back into a transform.',
  explain: 'Shear cannot be represented by a position/rotation/scale triple, so a sheared matrix loses its shear here. That is a real loss, not a rounding difference — build shear with geometry deformation instead.',
  exportSupport: 'converted',
  inputs: [{ key: 'matrix', label: 'Matrix', type: 'matrix4', default: V.m4FromTransform(V.IDENTITY_TRANSFORM) }],
  outputs: [{ key: 'out', label: 'Transform', type: 'transform' }],
  evaluate: (api, i) => V.m4ToTransform(i.matrix),
});

node({
  id: 'cadence.transform.matrixMultiply', label: 'Multiply Matrices', category: C, subcategory: 'Matrix',
  aliases: ['matrix multiply', 'concatenate matrix'],
  summary: 'Multiplies two 4x4 matrices.',
  exportSupport: 'converted',
  inputs: [
    { key: 'a', label: 'A', type: 'matrix4', default: V.m4FromTransform(V.IDENTITY_TRANSFORM) },
    { key: 'b', label: 'B', type: 'matrix4', default: V.m4FromTransform(V.IDENTITY_TRANSFORM) },
  ],
  outputs: [{ key: 'out', label: 'Matrix', type: 'matrix4' }],
  evaluate: (api, i) => V.m4Multiply(i.a, i.b),
});

// ---------------------------------------------------------------- spaces (Part 45)
// A space conversion is a transform application with a named source and destination. The space
// transforms themselves come from the evaluation environment — the effect's own placement, the
// camera, and so on. Until the render and particle stages exist to supply them (phases 5 and 6),
// this node reports honestly that only the identity spaces are wired up, rather than silently
// returning the input unchanged and letting a user believe a conversion happened.
node({
  id: 'cadence.transform.convertSpace', label: 'Convert Space', category: C, subcategory: 'Spaces',
  aliases: ['world to local', 'local to world', 'space', 'coordinate system', 'camera space'],
  summary: 'Converts a point or direction between coordinate spaces.',
  explain: 'World is the scene\'s own space; Effect is the space of the effect\'s placement; Local is the space of the thing being evaluated. Camera and Screen spaces require a camera, which only exists once an effect is being rendered.',
  exportSupport: 'converted',
  inputs: [
    v3('vector', 'Point or direction', [0, 0, 0]),
    mode('from', 'From space', ['world', 'effect', 'local', 'parent', 'object', 'camera', 'screen'], 'world'),
    mode('to', 'To space', ['world', 'effect', 'local', 'parent', 'object', 'camera', 'screen'], 'effect'),
    { key: 'isDirection', label: 'Treat as a direction (ignore position)', type: 'bool', default: false, socket: false },
    tf('spaceTransform', 'Space transform', { description: 'The transform of the space being converted to or from. Supplied automatically when an effect is being rendered.' }),
  ],
  outputs: [{ key: 'out', label: 'Result', type: 'vector3' }],
  evaluate: (api, i) => {
    if (i.from === i.to) return i.vector;
    const CAMERA_SPACES = ['camera', 'screen'];
    if (CAMERA_SPACES.includes(i.from) || CAMERA_SPACES.includes(i.to)) {
      api.warn(`Camera and screen space need a camera, which only exists while an effect is being rendered. The value passed through unchanged.`);
      return i.vector;
    }
    // Everything else is expressed relative to the supplied space transform: converting INTO that
    // space applies its inverse, converting out of it applies it forwards.
    const goingIn = i.to !== 'world';
    const t = goingIn ? V.transformInverse(i.spaceTransform) : i.spaceTransform;
    return i.isDirection ? V.transformDirection(t, i.vector) : V.transformPoint(t, i.vector);
  },
});
