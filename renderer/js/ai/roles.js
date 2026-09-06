// Semantic roles (directive Part 17).
//
// Part 17: "The system must support semantic selection. A user or AI should be able to request
// 'the weapon hand', 'the planted foot', 'the impact target', 'the smoke layer', or 'the camera
// that frames the attack', without manually searching raw hierarchy names."
//
// Nothing in Cadence maps a part to a body role today. This module is that map. Three things
// matter about how it is built:
//
//   1. It is a MAPPING, not a rename. `roblox_mapping` always carries the real part id and joint
//      name back, because that is what state.js, the Studio bridge and the exporter address.
//
//   2. Every mapping carries its own confidence and evidence. An exact match against a Roblox
//      rig's own naming is a different kind of fact from a token match on `mixamorig:LeftForeArm`,
//      and the difference has to survive into the result — Part 4.5: "Separate measurement from
//      judgment."
//
//   3. A user or the AI can pin a role, and a pinned role always wins. That is the escape hatch
//      for creature rigs, mechanical rigs, and anything whose author did not name parts the way
//      this table expects. Part 21: capture a scoped preference rather than silently overwriting
//      a global definition.

import { CERTAINTY, evidence } from './certainty.js';

// ---------------------------------------------------------------- vocabulary
//
// Part 17's list, plus the articulation roles a rig needs (a joint is an articulation; a part is a
// segment) and the few Cadence-specific ones its item kinds require.

export const ROLE = Object.freeze({
  // whole entities
  CHARACTER: 'character',
  CAMERA: 'camera',
  PROP: 'prop',
  WEAPON: 'weapon',
  PROJECTILE: 'projectile',
  TARGET: 'target',
  ENVIRONMENT: 'environment',
  VFX_EMITTER: 'vfx_emitter',
  VFX_COLLIDER: 'vfx_collider',
  EVENT_TRIGGER: 'event_trigger',
  AUDIO_SOURCE: 'audio_source',
  CAMERA_TARGET: 'camera_target',
  KEY_LIGHT: 'key_light',
  FILL_LIGHT: 'fill_light',
  RIM_LIGHT: 'rim_light',

  // body segments (parts)
  ROOT: 'root',
  HIPS: 'hips',
  TORSO: 'torso',
  CHEST: 'chest',
  HEAD: 'head',
  UPPER_ARM: 'upper_arm',
  LOWER_ARM: 'lower_arm',
  HAND: 'hand',
  FINGER: 'finger',
  UPPER_LEG: 'upper_leg',
  LOWER_LEG: 'lower_leg',
  FOOT: 'foot',
  TOE: 'toe',
  ARM: 'arm',   // R6: one part is the whole arm
  LEG: 'leg',   // R6: one part is the whole leg
  TAIL: 'tail',
  WING: 'wing',
  ACCESSORY: 'accessory',

  // articulations (joints)
  ROOT_JOINT: 'root_joint',
  WAIST: 'waist',
  NECK: 'neck',
  SHOULDER: 'shoulder',
  ELBOW: 'elbow',
  WRIST: 'wrist',
  HIP: 'hip',
  KNEE: 'knee',
  ANKLE: 'ankle',

  UNKNOWN: 'unknown',
});

export const SIDE = Object.freeze({ LEFT: 'left', RIGHT: 'right', CENTRE: 'centre', NONE: null });

/** Roles whose part can plausibly make and hold a contact with the world (Part 18
 *  `contact_capability`). Used by contact planning and by "the planted foot". */
const CONTACT_CAPABLE = new Set([ROLE.HAND, ROLE.FOOT, ROLE.TOE, ROLE.FINGER, ROLE.ARM, ROLE.LEG, ROLE.LOWER_ARM, ROLE.LOWER_LEG]);
export function isContactCapable(role) { return CONTACT_CAPABLE.has(role); }

/** Roles that sit on the body's midline — a mirror of them is themselves, not a partner. */
const MIDLINE = new Set([ROLE.ROOT, ROLE.HIPS, ROLE.TORSO, ROLE.CHEST, ROLE.HEAD, ROLE.NECK, ROLE.WAIST, ROLE.ROOT_JOINT, ROLE.TAIL]);
export function isMidline(role) { return MIDLINE.has(role); }

/** Distal-to-proximal ordering, used to reason about motion propagation and lead/lag. Lower is
 *  closer to the root. Null for anything that is not a body role. */
const CHAIN_DEPTH = {
  [ROLE.ROOT]: 0, [ROLE.ROOT_JOINT]: 0,
  [ROLE.HIPS]: 1, [ROLE.WAIST]: 1,
  [ROLE.TORSO]: 2, [ROLE.CHEST]: 2,
  [ROLE.NECK]: 3, [ROLE.SHOULDER]: 3, [ROLE.HIP]: 2,
  [ROLE.HEAD]: 4, [ROLE.UPPER_ARM]: 4, [ROLE.UPPER_LEG]: 3, [ROLE.ARM]: 4, [ROLE.LEG]: 3,
  [ROLE.ELBOW]: 5, [ROLE.KNEE]: 4,
  [ROLE.LOWER_ARM]: 6, [ROLE.LOWER_LEG]: 5,
  [ROLE.WRIST]: 7, [ROLE.ANKLE]: 6,
  [ROLE.HAND]: 8, [ROLE.FOOT]: 7,
  [ROLE.FINGER]: 9, [ROLE.TOE]: 8,
};
export function chainDepth(role) { return CHAIN_DEPTH[role] ?? null; }

// ---------------------------------------------------------------- exact tables
//
// Roblox's own names, which are fixed by the platform. A match here is as close to a fact as this
// module gets — R15's `LowerTorso` really is the pelvis and `UpperTorso` really is the chest,
// which is why they map to `hips` and `chest` and not both to `torso`. Getting that wrong would
// make "rotate the hips" address the ribcage.

const EXACT_PARTS = new Map(Object.entries({
  // shared
  humanoidrootpart: { role: ROLE.ROOT, side: SIDE.CENTRE, rig: ['R6', 'R15'] },
  head: { role: ROLE.HEAD, side: SIDE.CENTRE, rig: ['R6', 'R15'] },
  // R6
  torso: { role: ROLE.TORSO, side: SIDE.CENTRE, rig: ['R6'] },
  'left arm': { role: ROLE.ARM, side: SIDE.LEFT, rig: ['R6'] },
  'right arm': { role: ROLE.ARM, side: SIDE.RIGHT, rig: ['R6'] },
  'left leg': { role: ROLE.LEG, side: SIDE.LEFT, rig: ['R6'] },
  'right leg': { role: ROLE.LEG, side: SIDE.RIGHT, rig: ['R6'] },
  // R15 / Rthro
  lowertorso: { role: ROLE.HIPS, side: SIDE.CENTRE, rig: ['R15'] },
  uppertorso: { role: ROLE.CHEST, side: SIDE.CENTRE, rig: ['R15'] },
  leftupperarm: { role: ROLE.UPPER_ARM, side: SIDE.LEFT, rig: ['R15'] },
  rightupperarm: { role: ROLE.UPPER_ARM, side: SIDE.RIGHT, rig: ['R15'] },
  leftlowerarm: { role: ROLE.LOWER_ARM, side: SIDE.LEFT, rig: ['R15'] },
  rightlowerarm: { role: ROLE.LOWER_ARM, side: SIDE.RIGHT, rig: ['R15'] },
  lefthand: { role: ROLE.HAND, side: SIDE.LEFT, rig: ['R15'] },
  righthand: { role: ROLE.HAND, side: SIDE.RIGHT, rig: ['R15'] },
  leftupperleg: { role: ROLE.UPPER_LEG, side: SIDE.LEFT, rig: ['R15'] },
  rightupperleg: { role: ROLE.UPPER_LEG, side: SIDE.RIGHT, rig: ['R15'] },
  leftlowerleg: { role: ROLE.LOWER_LEG, side: SIDE.LEFT, rig: ['R15'] },
  rightlowerleg: { role: ROLE.LOWER_LEG, side: SIDE.RIGHT, rig: ['R15'] },
  leftfoot: { role: ROLE.FOOT, side: SIDE.LEFT, rig: ['R15'] },
  rightfoot: { role: ROLE.FOOT, side: SIDE.RIGHT, rig: ['R15'] },
}));

const EXACT_JOINTS = new Map(Object.entries({
  // R6
  rootjoint: { role: ROLE.ROOT_JOINT, side: SIDE.CENTRE, rig: ['R6'] },
  neck: { role: ROLE.NECK, side: SIDE.CENTRE, rig: ['R6', 'R15'] },
  'left shoulder': { role: ROLE.SHOULDER, side: SIDE.LEFT, rig: ['R6'] },
  'right shoulder': { role: ROLE.SHOULDER, side: SIDE.RIGHT, rig: ['R6'] },
  'left hip': { role: ROLE.HIP, side: SIDE.LEFT, rig: ['R6'] },
  'right hip': { role: ROLE.HIP, side: SIDE.RIGHT, rig: ['R6'] },
  // R15 / Rthro
  root: { role: ROLE.ROOT_JOINT, side: SIDE.CENTRE, rig: ['R15'] },
  waist: { role: ROLE.WAIST, side: SIDE.CENTRE, rig: ['R15'] },
  leftshoulder: { role: ROLE.SHOULDER, side: SIDE.LEFT, rig: ['R15'] },
  rightshoulder: { role: ROLE.SHOULDER, side: SIDE.RIGHT, rig: ['R15'] },
  leftelbow: { role: ROLE.ELBOW, side: SIDE.LEFT, rig: ['R15'] },
  rightelbow: { role: ROLE.ELBOW, side: SIDE.RIGHT, rig: ['R15'] },
  leftwrist: { role: ROLE.WRIST, side: SIDE.LEFT, rig: ['R15'] },
  rightwrist: { role: ROLE.WRIST, side: SIDE.RIGHT, rig: ['R15'] },
  lefthip: { role: ROLE.HIP, side: SIDE.LEFT, rig: ['R15'] },
  righthip: { role: ROLE.HIP, side: SIDE.RIGHT, rig: ['R15'] },
  leftknee: { role: ROLE.KNEE, side: SIDE.LEFT, rig: ['R15'] },
  rightknee: { role: ROLE.KNEE, side: SIDE.RIGHT, rig: ['R15'] },
  leftankle: { role: ROLE.ANKLE, side: SIDE.LEFT, rig: ['R15'] },
  rightankle: { role: ROLE.ANKLE, side: SIDE.RIGHT, rig: ['R15'] },
}));

// ---------------------------------------------------------------- token fallback
//
// For rigs Cadence did not author: FBX/GLB imports, Mixamo, Blender, hand-built Studio rigs.
// Rules are ordered most-specific first and matched against a normalised token list, so
// `mixamorig:LeftForeArm` and `arm_lower.L` both land on `lower_arm`.
//
// These are CONVENTIONS, not facts. Everything matched here comes back as `possible`, and a rig
// that lands here reports how much of itself was guessed so a caller can decide to ask.

const TOKEN_RULES = [
  // most specific first — 'lowerarm' must beat 'arm', 'uppertorso' must beat 'torso'
  { role: ROLE.ROOT, any: ['humanoidrootpart', 'rootpart'] },
  // 'hip' alone is deliberately absent: on a part it almost always means a joint's name leaking
  // into a part list, and on a real part "LeftHip" would be a thigh, not the pelvis.
  { role: ROLE.HIPS, any: ['lowertorso', 'pelvis', 'hips'] },
  { role: ROLE.CHEST, any: ['uppertorso', 'chest', 'ribcage', 'spine2', 'upperchest'] },
  { role: ROLE.TORSO, any: ['torso', 'spine', 'spine1', 'abdomen', 'body'] },
  { role: ROLE.HEAD, any: ['head', 'skull', 'cranium'] },
  { role: ROLE.TOE, any: ['toe', 'toebase', 'ball'] },
  { role: ROLE.FOOT, any: ['foot', 'feet', 'ankle_end'] },
  { role: ROLE.LOWER_LEG, any: ['lowerleg', 'calf', 'shin', 'leg_lower', 'shinbone'] },
  { role: ROLE.UPPER_LEG, any: ['upperleg', 'thigh', 'upleg', 'leg_upper'] },
  { role: ROLE.FINGER, any: ['finger', 'thumb', 'index', 'middle', 'ring', 'pinky', 'digit'] },
  { role: ROLE.HAND, any: ['hand', 'palm'] },
  { role: ROLE.LOWER_ARM, any: ['lowerarm', 'forearm', 'arm_lower'] },
  { role: ROLE.UPPER_ARM, any: ['upperarm', 'arm_upper', 'humerus'] },
  { role: ROLE.TAIL, any: ['tail'] },
  { role: ROLE.WING, any: ['wing'] },
  { role: ROLE.LEG, any: ['leg'] },
  { role: ROLE.ARM, any: ['arm', 'shoulder_pad'] },
  { role: ROLE.ACCESSORY, any: ['hat', 'hair', 'accessory', 'cape', 'backpack'] },
];

const JOINT_TOKEN_RULES = [
  { role: ROLE.ROOT_JOINT, any: ['rootjoint', 'rootmotor'] },
  { role: ROLE.WAIST, any: ['waist', 'spinejoint'] },
  { role: ROLE.NECK, any: ['neck'] },
  { role: ROLE.SHOULDER, any: ['shoulder', 'clavicle'] },
  { role: ROLE.ELBOW, any: ['elbow'] },
  { role: ROLE.WRIST, any: ['wrist'] },
  { role: ROLE.HIP, any: ['hip', 'thighjoint'] },
  { role: ROLE.KNEE, any: ['knee'] },
  { role: ROLE.ANKLE, any: ['ankle'] },
];

const LEFT_TOKENS = new Set(['l', 'left', 'lft', 'lt']);
const RIGHT_TOKENS = new Set(['r', 'right', 'rgt', 'rt']);

/**
 * Normalise a rig name into lowercase tokens. Handles the four conventions that actually turn up:
 * Roblox spaces ("Left Arm"), Roblox camelCase ("LeftUpperArm"), Blender/Mixamo separators
 * ("arm_lower.L", "mixamorig:LeftForeArm"), and numeric suffixes ("Spine1").
 */
export function tokenise(name) {
  const stripped = String(name).replace(/^[a-z]+rig[:|]/i, ''); // mixamorig:, rig|, …
  return stripped
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s._:|\-/\\]+/)
    .map((s) => s.toLowerCase())
    .filter(Boolean);
}

function sideFromTokens(tokens) {
  for (const t of tokens) {
    if (LEFT_TOKENS.has(t)) return SIDE.LEFT;
    if (RIGHT_TOKENS.has(t)) return SIDE.RIGHT;
    if (t.startsWith('left')) return SIDE.LEFT;
    if (t.startsWith('right')) return SIDE.RIGHT;
  }
  return SIDE.NONE;
}

// The token list with side markers removed, and joined variants added: "left upper arm" produces
// the tokens ['left','upper','arm'] but the rules key on 'upperarm', so adjacent pairs are joined
// too. That is what lets one rule table cover both `LeftUpperArm` and `arm_upper.L`.
function matchTokens(tokens, rules) {
  const bare = tokens.filter((t) => !LEFT_TOKENS.has(t) && !RIGHT_TOKENS.has(t) && !t.startsWith('left') && !t.startsWith('right'));
  const candidates = new Set(bare);
  for (let i = 0; i < bare.length - 1; i++) {
    candidates.add(bare[i] + bare[i + 1]);
    candidates.add(`${bare[i]}_${bare[i + 1]}`);
  }
  for (const rule of rules) {
    for (const key of rule.any) if (candidates.has(key)) return { role: rule.role, matched: key };
  }
  return null;
}

// ---------------------------------------------------------------- resolution

function overrideFor(project, itemId, kind, key) {
  const table = project?.semantics?.roles?.[itemId];
  const hit = table && table[kind] && table[kind][key];
  return hit || null;
}

/**
 * The role of one rig part.
 * Returns `{ role, side, confidence, certainty, evidence[], source }`.
 * `source` is one of `override` | `exact` | `token` | `none` — a caller that wants to warn about
 * guessed mappings filters on it rather than on a numeric threshold.
 */
export function partRole(project, item, part) {
  const key = part.id;
  const ov = overrideFor(project, item.id, 'parts', key);
  if (ov) {
    return {
      role: ov.role, side: ov.side ?? sideFromTokens(tokenise(part.name || part.id)),
      confidence: 1, certainty: CERTAINTY.CERTAIN, source: 'override',
      evidence: [evidence('data', `role pinned to "${ov.role}" for part "${key}"`, ov.reason || null)],
    };
  }

  const rigType = item.rig?.rigType || null;
  const nameKey = String(part.name || part.id).toLowerCase();
  const exact = EXACT_PARTS.get(nameKey) || EXACT_PARTS.get(String(part.id).toLowerCase());
  if (exact) {
    const rigAgrees = !rigType || exact.rig.includes(rigType);
    return {
      role: exact.role, side: exact.side,
      confidence: rigAgrees ? 0.99 : 0.9,
      certainty: rigAgrees ? CERTAINTY.CERTAIN : CERTAINTY.HIGHLY_LIKELY,
      source: 'exact',
      evidence: [evidence('convention',
        `"${part.name || part.id}" is a standard ${exact.rig.join('/')} part name`,
        rigAgrees ? null : `the rig declares rigType "${rigType}", which this name is not standard for`)],
    };
  }

  const tokens = tokenise(part.name || part.id);
  const m = matchTokens(tokens, TOKEN_RULES);
  if (m) {
    return {
      role: m.role, side: sideFromTokens(tokens), confidence: 0.6, certainty: CERTAINTY.POSSIBLE, source: 'token',
      evidence: [evidence('convention', `"${part.name || part.id}" contains the token "${m.matched}"`,
        'matched by naming convention, not by a known rig standard')],
    };
  }

  return {
    role: ROLE.UNKNOWN, side: sideFromTokens(tokens), confidence: 0,
    certainty: CERTAINTY.USER_INTENT_REQUIRED, source: 'none',
    evidence: [evidence('absence', `"${part.name || part.id}" matches no known part name or naming convention`,
      'pin a role with set_semantic_role if this part matters')],
  };
}

/** The role of one joint. Same contract as `partRole`. */
export function jointRole(project, item, joint) {
  const ov = overrideFor(project, item.id, 'joints', joint.name);
  if (ov) {
    return {
      role: ov.role, side: ov.side ?? sideFromTokens(tokenise(joint.name)),
      confidence: 1, certainty: CERTAINTY.CERTAIN, source: 'override',
      evidence: [evidence('data', `role pinned to "${ov.role}" for joint "${joint.name}"`, ov.reason || null)],
    };
  }

  const rigType = item.rig?.rigType || null;
  const exact = EXACT_JOINTS.get(String(joint.name).toLowerCase());
  if (exact) {
    const rigAgrees = !rigType || exact.rig.includes(rigType);
    return {
      role: exact.role, side: exact.side,
      confidence: rigAgrees ? 0.99 : 0.9,
      certainty: rigAgrees ? CERTAINTY.CERTAIN : CERTAINTY.HIGHLY_LIKELY,
      source: 'exact',
      evidence: [evidence('convention', `"${joint.name}" is a standard ${exact.rig.join('/')} joint name`)],
    };
  }

  const tokens = tokenise(joint.name);
  const m = matchTokens(tokens, JOINT_TOKEN_RULES);
  if (m) {
    return {
      role: m.role, side: sideFromTokens(tokens), confidence: 0.6, certainty: CERTAINTY.POSSIBLE, source: 'token',
      evidence: [evidence('convention', `"${joint.name}" contains the token "${m.matched}"`)],
    };
  }

  // A joint with no recognisable name can still be described by what it drives: a joint into a
  // part known to be a hand is a wrist, whatever it is called. This is inference from a separate
  // fact, so it is labelled as inference and confidence stays below a name match.
  const driven = (item.rig?.parts || []).find((p) => p.id === joint.part1);
  if (driven) {
    const dr = partRole(project, item, driven);
    const implied = JOINT_FOR_PART[dr.role];
    if (implied && dr.role !== ROLE.UNKNOWN) {
      return {
        role: implied, side: dr.side, confidence: Math.min(0.55, dr.confidence * 0.8),
        certainty: CERTAINTY.POSSIBLE, source: 'token',
        evidence: [
          evidence('inference', `"${joint.name}" drives "${driven.name || driven.id}", which reads as a ${dr.role}`),
          ...dr.evidence,
        ],
      };
    }
  }

  return {
    role: ROLE.UNKNOWN, side: sideFromTokens(tokens), confidence: 0,
    certainty: CERTAINTY.USER_INTENT_REQUIRED, source: 'none',
    evidence: [evidence('absence', `"${joint.name}" matches no known joint name or naming convention`)],
  };
}

// The articulation that produces each segment. Used only by the inference branch above.
const JOINT_FOR_PART = {
  [ROLE.HEAD]: ROLE.NECK,
  [ROLE.CHEST]: ROLE.WAIST,
  [ROLE.TORSO]: ROLE.WAIST,
  [ROLE.HIPS]: ROLE.ROOT_JOINT,
  [ROLE.UPPER_ARM]: ROLE.SHOULDER,
  [ROLE.ARM]: ROLE.SHOULDER,
  [ROLE.LOWER_ARM]: ROLE.ELBOW,
  [ROLE.HAND]: ROLE.WRIST,
  [ROLE.UPPER_LEG]: ROLE.HIP,
  [ROLE.LEG]: ROLE.HIP,
  [ROLE.LOWER_LEG]: ROLE.KNEE,
  [ROLE.FOOT]: ROLE.ANKLE,
};

/** The role of a whole item, from its kind and any override. */
export function itemRole(project, item) {
  const ov = overrideFor(project, item.id, 'items', item.id);
  if (ov) {
    return {
      role: ov.role, side: ov.side ?? SIDE.NONE, confidence: 1, certainty: CERTAINTY.CERTAIN, source: 'override',
      evidence: [evidence('data', `role pinned to "${ov.role}" for item "${item.name}"`, ov.reason || null)],
    };
  }
  const byKind = {
    rig: ROLE.CHARACTER, camera: ROLE.CAMERA, vfx: ROLE.VFX_EMITTER, effect: ROLE.VFX_EMITTER, prop: ROLE.PROP,
  }[item.kind];
  if (byKind) {
    return {
      role: byKind, side: SIDE.NONE, confidence: 0.9, certainty: CERTAINTY.HIGHLY_LIKELY, source: 'exact',
      evidence: [evidence('data', `item kind is "${item.kind}"`,
        byKind === ROLE.CHARACTER ? 'a rig is treated as a character; pin a role if it is a vehicle, door or set piece' : null)],
    };
  }
  return {
    role: ROLE.UNKNOWN, side: SIDE.NONE, confidence: 0, certainty: CERTAINTY.USER_INTENT_REQUIRED, source: 'none',
    evidence: [evidence('absence', `item kind "${item.kind}" has no default role`)],
  };
}

/** The name a mirrored counterpart would have, by swapping side tokens in place. Null for a
 *  midline or sideless name. Used for Part 18's `mirror_partner`. */
export function mirrorName(name) {
  // One pass over the alternation, never a sequence of replaces: replacing Left→Right and then
  // Right→Left over the same string turns "Left Arm" back into "Left Arm".
  const combined = /Left|Right|\bleft\b|\bright\b|\bL\b|\bR\b|\.L\b|\.R\b|_l\b|_r\b/g;
  const SWAP = { Left: 'Right', Right: 'Left', left: 'right', right: 'left', L: 'R', R: 'L', '.L': '.R', '.R': '.L', _l: '_r', _r: '_l' };
  if (!combined.test(name)) return null;
  combined.lastIndex = 0;
  return name.replace(combined, (m) => SWAP[m] ?? m);
}

/** Set (or clear, with `role: null`) a pinned role. Mutates `project.semantics` in place and
 *  returns the entry written, so a caller can record it in provenance. */
export function setRole(project, itemId, kind, key, role, { side = undefined, reason = null } = {}) {
  if (!['items', 'parts', 'joints'].includes(kind)) throw new TypeError(`setRole: kind must be items|parts|joints (got ${kind})`);
  if (role !== null && !Object.values(ROLE).includes(role)) {
    throw new TypeError(`setRole: "${role}" is not a known role — see ROLE in renderer/js/ai/roles.js`);
  }
  project.semantics = project.semantics || {};
  project.semantics.roles = project.semantics.roles || {};
  const forItem = project.semantics.roles[itemId] = project.semantics.roles[itemId] || {};
  const table = forItem[kind] = forItem[kind] || {};
  if (role === null) { delete table[key]; return null; }
  const entry = { role };
  if (side !== undefined) entry.side = side;
  if (reason) entry.reason = reason;
  table[key] = entry;
  return entry;
}

/** Every pinned role in the project, flattened — for reporting and for provenance. */
export function listOverrides(project) {
  const out = [];
  const roles = project?.semantics?.roles || {};
  for (const [itemId, kinds] of Object.entries(roles)) {
    for (const [kind, table] of Object.entries(kinds)) {
      for (const [key, entry] of Object.entries(table)) out.push({ itemId, kind, key, ...entry });
    }
  }
  return out;
}
