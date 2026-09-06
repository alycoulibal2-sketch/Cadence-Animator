// Semantic selection (directive Part 17).
//
// "A user or AI should be able to request 'the weapon hand', 'the planted foot', 'the impact
// target', 'the smoke layer', or 'the camera that frames the attack', without manually searching
// raw hierarchy names."
//
// The hard part is not the string matching. It is being honest about which of those questions the
// project can actually answer:
//
//   "the left hand"      — a naming fact. Certain on a standard rig.
//   "the weapon hand"    — a scene fact IF something is attached to a hand. Otherwise unanswerable,
//                          and the right response is a question, not a guess.
//   "the planted foot"   — a measurement, and only ever *highly likely*: planting is an intent,
//                          and a foot that happens to move least is evidence for it, not proof.
//   "the impact target"  — not representable at all yet. Says so.
//
// Part 13 governs the labels; Part 12 forbids dressing a guess as a fact. So every resolution
// carries its certainty, the evidence behind it, the alternatives it rejected, and — when it
// cannot decide — the question a human would have to answer.

import * as ids from './ids.js';
import * as roles from './roles.js';
import { ROLE, SIDE } from './roles.js';
import { CERTAINTY, evidence, coverage } from './certainty.js';
import { solveItemWorlds, keyTimesOf, tracksOf } from './kinematics.js';

// ---------------------------------------------------------------- query vocabulary
//
// A phrase maps to an ORDERED list of roles: the first is the best answer, the rest are what to
// fall back to and report as alternatives. R15 is why this is a list rather than a single role —
// nothing on an R15 rig has the role `torso`, because Roblox splits it into LowerTorso (the
// pelvis) and UpperTorso (the ribcage), and answering "the torso" with silence would be useless.

const QUERY_ROLES = {
  head: [ROLE.HEAD],
  skull: [ROLE.HEAD],
  face: [ROLE.HEAD],
  neck: [ROLE.NECK, ROLE.HEAD],
  torso: [ROLE.TORSO, ROLE.CHEST, ROLE.HIPS],
  chest: [ROLE.CHEST, ROLE.TORSO],
  ribcage: [ROLE.CHEST, ROLE.TORSO],
  spine: [ROLE.CHEST, ROLE.TORSO],
  hips: [ROLE.HIPS, ROLE.TORSO],
  pelvis: [ROLE.HIPS, ROLE.TORSO],
  waist: [ROLE.WAIST, ROLE.HIPS],
  root: [ROLE.ROOT, ROLE.ROOT_JOINT],
  hand: [ROLE.HAND, ROLE.ARM],
  palm: [ROLE.HAND],
  fist: [ROLE.HAND],
  finger: [ROLE.FINGER, ROLE.HAND],
  foot: [ROLE.FOOT, ROLE.LEG],
  feet: [ROLE.FOOT, ROLE.LEG],
  toe: [ROLE.TOE, ROLE.FOOT],
  arm: [ROLE.ARM, ROLE.UPPER_ARM, ROLE.LOWER_ARM],
  forearm: [ROLE.LOWER_ARM, ROLE.ARM],
  upperarm: [ROLE.UPPER_ARM, ROLE.ARM],
  bicep: [ROLE.UPPER_ARM, ROLE.ARM],
  leg: [ROLE.LEG, ROLE.UPPER_LEG, ROLE.LOWER_LEG],
  thigh: [ROLE.UPPER_LEG, ROLE.LEG],
  shin: [ROLE.LOWER_LEG, ROLE.LEG],
  calf: [ROLE.LOWER_LEG, ROLE.LEG],
  shoulder: [ROLE.SHOULDER, ROLE.UPPER_ARM],
  elbow: [ROLE.ELBOW, ROLE.LOWER_ARM],
  wrist: [ROLE.WRIST, ROLE.HAND],
  hip: [ROLE.HIP, ROLE.UPPER_LEG],
  knee: [ROLE.KNEE, ROLE.LOWER_LEG],
  ankle: [ROLE.ANKLE, ROLE.FOOT],
  tail: [ROLE.TAIL],
  wing: [ROLE.WING],
  character: [ROLE.CHARACTER],
  camera: [ROLE.CAMERA],
  weapon: [ROLE.WEAPON],
  prop: [ROLE.PROP, ROLE.WEAPON],
  target: [ROLE.TARGET],
};

const SIDE_WORDS = { left: SIDE.LEFT, l: SIDE.LEFT, right: SIDE.RIGHT, r: SIDE.RIGHT };
const PLURAL_WORDS = new Set(['both', 'all', 'each', 'every', 'hands', 'feet', 'arms', 'legs', 'shoulders', 'elbows', 'knees', 'wrists', 'ankles', 'hips', 'fingers']);
const NOISE_WORDS = new Set(['the', 'a', 'an', 'my', 'his', 'her', 'their', 'its', 'this', 'that', 'of', 'on', 'in', 's']);

// Phrases that mean something beyond a role lookup. Order matters: `weapon hand` must be tried
// before the bare `hand`.
const SPECIAL = [
  { match: (t) => has(t, 'weapon') && (has(t, 'hand') || has(t, 'hands')), handler: weaponHand, name: 'weapon hand' },
  { match: (t) => has(t, 'sword') && has(t, 'hand'), handler: weaponHand, name: 'weapon hand' },
  { match: (t) => (has(t, 'planted') || has(t, 'grounded') || has(t, 'support') || has(t, 'supporting') || has(t, 'standing')) && (has(t, 'foot') || has(t, 'feet') || has(t, 'leg')), handler: plantedFoot, name: 'planted foot' },
  { match: (t) => has(t, 'free') && (has(t, 'foot') || has(t, 'feet')), handler: freeFoot, name: 'free foot' },
  { match: (t) => has(t, 'active') && (has(t, 'camera') || has(t, 'cam')), handler: activeCamera, name: 'active camera' },
  { match: (t) => has(t, 'impact') && (has(t, 'target') || has(t, 'point')), handler: impactTarget, name: 'impact target' },
];

function has(tokens, w) { return tokens.includes(w); }

function tokenise(q) {
  return String(q)
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !NOISE_WORDS.has(t));
}

// ---------------------------------------------------------------- result construction

function match({ entityId, kind, item, name, role, side, certainty, confidence, ev }) {
  return {
    entityId, kind, itemId: item.id, itemName: item.name, name,
    role, side: side ?? null, certainty, confidence, evidence: ev,
  };
}

function result(query, interpretation, matches, extra = {}) {
  return {
    query,
    interpretation,
    matches,
    resolved: matches.length > 0,
    ambiguous: extra.ambiguous ?? matches.length > 1,
    alternatives: extra.alternatives ?? [],
    question: extra.question ?? null,
    coverage: extra.coverage ?? coverage({ scope: 'project data only', loop: 'fast', notRun: [] }),
    limitations: extra.limitations ?? [],
  };
}

// ---------------------------------------------------------------- entry point

/**
 * Resolve a semantic query to concrete entity ids.
 *
 * @param query   a phrase ("the left foot", "the weapon hand") or a structured selector
 *                `{ role, side?, kind? }`
 * @param opts.itemId   restrict to one item (otherwise every rig in the project is searched)
 * @param opts.frame    the frame the question is about — required by anything measured
 * @param opts.window   `[from, to]` frame window for measurements (default ±3 around `frame`)
 * @param opts.kind     'part' | 'joint' | 'item' | 'any' (default 'any')
 */
export function resolve(project, query, opts = {}) {
  if (query && typeof query === 'object') return resolveStructured(project, query, opts);
  const tokens = tokenise(query);
  if (!tokens.length) {
    return result(query, 'empty query', [], { question: 'What should be selected? Name a body part, a role, or a phrase such as "the planted foot".' });
  }

  for (const s of SPECIAL) {
    if (s.match(tokens)) return s.handler(project, query, tokens, opts);
  }

  // plain role lookup
  const side = tokens.map((t) => SIDE_WORDS[t]).find(Boolean) ?? null;
  const plural = tokens.some((t) => PLURAL_WORDS.has(t));
  let roleWord = null;
  for (const t of tokens) {
    const singular = t.endsWith('s') && QUERY_ROLES[t.slice(0, -1)] ? t.slice(0, -1) : t;
    if (QUERY_ROLES[singular]) { roleWord = singular; break; }
    if (QUERY_ROLES[t]) { roleWord = t; break; }
  }
  if (!roleWord) {
    return result(query, `no known role in "${query}"`, [], {
      question: `"${query}" does not name a role this layer knows. Known roles: ${Object.keys(QUERY_ROLES).sort().join(', ')}. To address a rig-specific part, pin a role with set_semantic_role.`,
    });
  }

  return resolveStructured(project, { role: QUERY_ROLES[roleWord], side, plural }, { ...opts, originalQuery: query, roleWord });
}

function resolveStructured(project, sel, opts = {}) {
  const query = opts.originalQuery ?? JSON.stringify(sel);
  const roleList = Array.isArray(sel.role) ? sel.role : [sel.role];
  const side = sel.side ?? null;
  const kind = sel.kind ?? opts.kind ?? 'any';
  const items = candidateItems(project, opts.itemId);

  const all = [];
  for (const item of items) {
    // item-level roles
    if (kind === 'any' || kind === 'item') {
      const r = roles.itemRole(project, item);
      if (roleList.includes(r.role)) {
        all.push({ ...match({
          entityId: ids.itemId(item), kind: 'item', item, name: item.name,
          role: r.role, side: r.side, certainty: r.certainty, confidence: r.confidence, ev: r.evidence,
        }), rank: roleList.indexOf(r.role) });
      }
    }
    if (!item.rig) continue;
    if (kind === 'any' || kind === 'part') {
      for (const p of item.rig.parts || []) {
        const r = roles.partRole(project, item, p);
        if (!roleList.includes(r.role)) continue;
        if (side && r.side !== side) continue;
        all.push({ ...match({
          entityId: ids.partId(item.id, p.id), kind: 'part', item, name: p.name || p.id,
          role: r.role, side: r.side, certainty: r.certainty, confidence: r.confidence, ev: r.evidence,
        }), rank: roleList.indexOf(r.role) });
      }
    }
    if (kind === 'any' || kind === 'joint') {
      for (const j of item.rig.joints || []) {
        const r = roles.jointRole(project, item, j);
        if (!roleList.includes(r.role)) continue;
        if (side && r.side !== side) continue;
        all.push({ ...match({
          entityId: ids.jointId(item.id, j), kind: 'joint', item, name: j.name,
          role: r.role, side: r.side, certainty: r.certainty, confidence: r.confidence, ev: r.evidence,
        }), rank: roleList.indexOf(r.role) });
      }
    }
  }

  if (!all.length) {
    return result(query, `looked for role(s) ${roleList.join(' or ')}${side ? ` on the ${side}` : ''}`, [], {
      question: `Nothing in this project resolves to ${roleList[0]}${side ? ` on the ${side}` : ''}. ${items.length ? 'The rig may use names this layer does not recognise — inspect_rig lists what it did map, and set_semantic_role pins the rest.' : 'There are no items to search.'}`,
    });
  }

  // Prefer the best-ranked role, then the most confident. Everything rejected becomes an
  // alternative rather than disappearing — Part 12: "surface unexpected changes early", and a
  // silently discarded second candidate is exactly the kind of thing that surprises later.
  const bestRank = Math.min(...all.map((m) => m.rank));
  const chosen = all.filter((m) => m.rank === bestRank);
  const alternatives = all.filter((m) => m.rank !== bestRank).map(strip);
  // Every equally-good match is returned, never silently narrowed to one. A singular query that
  // finds two (both hands; or one hand on each of two characters) is AMBIGUOUS, and saying so is
  // the point — picking one and not mentioning the other is how a caller ends up editing the
  // wrong arm.
  const matches = chosen.map(strip);

  const interp = `${sel.plural ? 'every' : 'the'} ${side ? `${side} ` : ''}${roleList[bestRank]}`
    + (bestRank > 0 ? ` (nothing has the role "${roleList[0]}" here, so the nearest equivalent was used)` : '');

  return result(query, interp, matches, {
    ambiguous: !sel.plural && matches.length > 1,
    alternatives,
    question: !sel.plural && matches.length > 1
      ? `${matches.length} things match equally: ${matches.map((m) => `${m.itemName}/${m.name}`).join(', ')}. Which one?`
      : null,
    limitations: matches.some((m) => m.certainty === CERTAINTY.POSSIBLE)
      ? ['at least one match came from a naming convention rather than a known rig standard — pin it with set_semantic_role to make it certain']
      : [],
  });
}

function strip(m) { const { rank, ...rest } = m; return rest; }

function candidateItems(project, itemId) {
  const items = project.items || [];
  return itemId ? items.filter((i) => i.id === itemId) : items;
}

// ---------------------------------------------------------------- "the weapon hand"

function weaponHand(project, query, tokens, opts) {
  const items = project.items || [];
  const characters = candidateItems(project, opts.itemId).filter((i) => i.rig);
  const found = [];

  // The strongest evidence is a scene fact: something is attached to a hand.
  for (const held of items) {
    if (!held.attachedTo) continue;
    const owner = items.find((i) => i.id === held.attachedTo.itemId);
    if (!owner || !owner.rig) continue;
    if (opts.itemId && owner.id !== opts.itemId) continue;
    const part = (owner.rig.parts || []).find((p) => p.id === held.attachedTo.partId);
    if (!part) continue;
    const pr = roles.partRole(project, owner, part);
    if (pr.role !== ROLE.HAND && pr.role !== ROLE.ARM) continue;

    const heldRole = roles.itemRole(project, held);
    const isDeclaredWeapon = heldRole.role === ROLE.WEAPON;
    found.push(match({
      entityId: ids.partId(owner.id, part.id), kind: 'part', item: owner, name: part.name || part.id,
      role: pr.role, side: pr.side,
      certainty: isDeclaredWeapon ? CERTAINTY.CERTAIN : CERTAINTY.HIGHLY_LIKELY,
      confidence: isDeclaredWeapon ? 1 : 0.8,
      ev: [
        evidence('data', `"${held.name}" is attached to "${part.name || part.id}"`),
        isDeclaredWeapon
          ? evidence('data', `"${held.name}" has a pinned role of "weapon"`)
          : evidence('inference', `"${held.name}" is a ${held.kind} held in a hand, so that hand is very likely the weapon hand`,
            'pin the item\'s role to "weapon" with set_semantic_role to make this certain'),
        ...pr.evidence,
      ],
    }));
  }

  if (found.length === 1) {
    return result(query, 'the hand something is attached to', found, {
      coverage: coverage({ scope: 'item attachments and part roles', loop: 'fast', notRun: ['whether the attached item is used as a weapon in the animation'] }),
    });
  }
  if (found.length > 1) {
    return result(query, 'more than one hand holds something', found, {
      ambiguous: true,
      question: `Two-handed, or is one of these the weapon hand? Candidates: ${found.map((m) => `${m.itemName}/${m.name}`).join(', ')}.`,
    });
  }

  // Nothing is attached. A pinned role on a hand is the only remaining evidence.
  const pinned = [];
  for (const item of characters) {
    for (const p of item.rig.parts || []) {
      const pr = roles.partRole(project, item, p);
      if (pr.source === 'override' && (pr.role === ROLE.HAND || pr.role === ROLE.ARM)) {
        pinned.push(match({
          entityId: ids.partId(item.id, p.id), kind: 'part', item, name: p.name || p.id,
          role: pr.role, side: pr.side, certainty: CERTAINTY.CERTAIN, confidence: 1, ev: pr.evidence,
        }));
      }
    }
  }
  if (pinned.length === 1) return result(query, 'the hand whose role was pinned', pinned);

  // Part 13's `user_intent_required`: the system cannot safely decide, so it asks instead of
  // picking the right hand because most people are right-handed.
  const hands = [];
  for (const item of characters) {
    for (const p of item.rig.parts || []) {
      const pr = roles.partRole(project, item, p);
      if (pr.role === ROLE.HAND || pr.role === ROLE.ARM) {
        hands.push({ entityId: ids.partId(item.id, p.id), itemName: item.name, name: p.name || p.id, side: pr.side });
      }
    }
  }
  return result(query, 'no item is attached to a hand, and no hand has a pinned role', [], {
    alternatives: hands,
    question: hands.length
      ? `Nothing is held, so the weapon hand cannot be determined from the scene. Which of these is it: ${hands.map((h) => `${h.itemName}/${h.name}`).join(', ')}? (Or attach the weapon to the hand, or pin the role.)`
      : 'No hands were found on any rig in this project.',
    coverage: coverage({ scope: 'item attachments, pinned roles, hand parts', loop: 'fast', notRun: ['pose analysis — a hand can be posed as if gripping without anything attached'] }),
    limitations: ['a hand posed as if gripping, with no attached item, is indistinguishable from an empty hand at this layer'],
  });
}

// ---------------------------------------------------------------- "the planted foot"

function windowFor(project, item, opts) {
  if (Array.isArray(opts.window) && opts.window.length === 2) return [Math.min(...opts.window), Math.max(...opts.window)];
  const times = keyTimesOf(tracksOf(project, item.id));
  if (opts.frame !== undefined && opts.frame !== null) {
    const r = opts.windowRadius ?? 3;
    return [opts.frame - r, opts.frame + r];
  }
  if (times.length) return [times[0], times[times.length - 1]];
  return [0, 0];
}

function footMotion(project, item, opts) {
  const [from, to] = windowFor(project, item, opts);
  const feet = [];
  for (const p of item.rig.parts || []) {
    const pr = roles.partRole(project, item, p);
    if (pr.role !== ROLE.FOOT && pr.role !== ROLE.LEG) continue;
    feet.push({ part: p, role: pr });
  }
  if (feet.length < 1) return { feet: [], from, to, frames: [] };

  const frames = [];
  for (let f = Math.ceil(from); f <= Math.floor(to); f++) frames.push(f);
  if (!frames.length) frames.push(Math.round((from + to) / 2));

  const samples = new Map(feet.map((f) => [f.part.id, []]));
  for (const f of frames) {
    const worlds = solveItemWorlds(project, item, f);
    if (!worlds) continue;
    for (const foot of feet) {
      const w = worlds.get(foot.part.id);
      if (w) samples.get(foot.part.id).push([w[0], w[1], w[2]]);
    }
  }

  const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const measured = feet.map((foot) => {
    const pts = samples.get(foot.part.id);
    let path = 0;
    for (let i = 1; i < pts.length; i++) path += dist3(pts[i - 1], pts[i]);
    const ys = pts.map((p) => p[1]);
    return {
      ...foot,
      samples: pts.length,
      path_length_studs: +path.toFixed(4),
      mean_height: pts.length ? +(ys.reduce((a, b) => a + b, 0) / ys.length).toFixed(4) : null,
      min_height: pts.length ? +Math.min(...ys).toFixed(4) : null,
    };
  });
  return { feet: measured, from, to, frames };
}

function plantedFoot(project, query, tokens, opts) {
  return footPick(project, query, opts, 'planted');
}
function freeFoot(project, query, tokens, opts) {
  return footPick(project, query, opts, 'free');
}

function footPick(project, query, opts, want) {
  const characters = candidateItems(project, opts.itemId).filter((i) => i.rig);
  if (!characters.length) return result(query, 'no rig to measure', [], { question: 'There is no rig in this project.' });
  if (characters.length > 1) {
    // Measuring the first rig and not mentioning the others would be a silent narrowing — the
    // caller would get a confident answer about a character they did not ask about.
    return result(query, `${characters.length} rigs are in this project`, [], {
      ambiguous: true,
      alternatives: characters.map((c) => ({ entityId: ids.itemId(c), name: c.name })),
      question: `Which character? ${characters.map((c) => c.name).join(', ')}. Pass itemId to measure one.`,
    });
  }

  const item = characters[0];
  const { feet, from, to, frames } = footMotion(project, item, opts);
  const cov = coverage({
    scope: `world-space foot travel on "${item.name}" over frames ${from}–${to}`,
    frames, loop: 'fast',
    notRun: ['whether a contact was ever declared (ContactSpec does not exist yet — Phase 3)', 'ground geometry (Cadence has no ground plane or collision surface)'],
  });

  if (feet.length < 2) {
    return result(query, 'fewer than two feet were found', [], {
      coverage: cov,
      question: feet.length ? `Only one foot ("${feet[0].part.name}") resolved on "${item.name}", so there is nothing to compare it against.` : `No part on "${item.name}" resolves to a foot.`,
    });
  }

  const anyMotion = feet.some((f) => f.path_length_studs > 1e-6);
  const sorted = [...feet].sort((a, b) => a.path_length_studs - b.path_length_studs);
  const [least, most] = [sorted[0], sorted[sorted.length - 1]];
  const pick = want === 'planted' ? least : most;
  const other = want === 'planted' ? most : least;

  const ev = [
    evidence('measurement', `"${least.part.name}" travelled ${least.path_length_studs} studs over frames ${from}–${to}`, { samples: least.samples, mean_height: least.mean_height }),
    evidence('measurement', `"${most.part.name}" travelled ${most.path_length_studs} studs over the same window`, { samples: most.samples, mean_height: most.mean_height }),
  ];

  if (!anyMotion) {
    // Both feet are stationary. Height is the only remaining discriminator, and it is weak.
    const lower = [...feet].sort((a, b) => (a.mean_height ?? 0) - (b.mean_height ?? 0))[0];
    const tie = Math.abs((feet[0].mean_height ?? 0) - (feet[1].mean_height ?? 0)) < 1e-4;
    if (tie || want === 'free') {
      return result(query, 'neither foot moves in this window', [], {
        coverage: cov,
        alternatives: feet.map((f) => ({ entityId: ids.partId(item.id, f.part.id), name: f.part.name, side: f.role.side, path_length_studs: f.path_length_studs, mean_height: f.mean_height })),
        question: `Neither foot moves over frames ${from}–${to} and they are at the same height, so nothing in the animation distinguishes a planted foot from a free one. Which did you mean — or should a wider frame window be measured?`,
      });
    }
    return result(query, 'neither foot moves; the lower one was chosen on height alone', [match({
      entityId: ids.partId(item.id, lower.part.id), kind: 'part', item, name: lower.part.name || lower.part.id,
      role: lower.role.role, side: lower.role.side, certainty: CERTAINTY.POSSIBLE, confidence: 0.4,
      ev: [...ev, evidence('inference', 'neither foot moved, so travel could not discriminate; the lower foot was chosen on height, which is weak evidence')],
    })], { coverage: cov });
  }

  // How separated are they? A foot that moves 90% as much as the other is not a planted foot.
  const ratio = most.path_length_studs > 0 ? least.path_length_studs / most.path_length_studs : 0;
  const decisive = ratio < 0.5;

  const m = match({
    entityId: ids.partId(item.id, pick.part.id), kind: 'part', item, name: pick.part.name || pick.part.id,
    role: pick.role.role, side: pick.role.side,
    // Never `certain`. Part 13's own worked example for a foot contact is "highly likely", and
    // planting is an intent that a travel measurement supports but cannot establish.
    certainty: decisive ? CERTAINTY.HIGHLY_LIKELY : CERTAINTY.POSSIBLE,
    confidence: decisive ? 0.8 : 0.5,
    ev: [
      ...ev,
      evidence('inference',
        want === 'planted'
          ? `"${pick.part.name}" ${ratio < 1e-9 ? 'does not move at all while' : `travels only ${Math.round(ratio * 100)}% as far as`} "${other.part.name}"${ratio < 1e-9 ? ' moves' : ''}, which is the signature of a planted support foot`
          : `"${pick.part.name}" travels furthest, which is the signature of the free foot`,
        decisive ? null : 'the two feet travel similar distances, so this reading is weak — the character may be moving both feet, or the window may not cover a step'),
    ],
  });

  return result(query, `the foot that travels ${want === 'planted' ? 'least' : 'most'} over frames ${from}–${to}`, [m], {
    coverage: cov,
    alternatives: feet.filter((f) => f.part.id !== pick.part.id).map((f) => ({
      entityId: ids.partId(item.id, f.part.id), name: f.part.name, side: f.role.side,
      path_length_studs: f.path_length_studs, mean_height: f.mean_height,
    })),
    limitations: [
      'no ContactSpec exists yet, so this is inferred from motion rather than read from a declared contact (Phase 3)',
      'Cadence has no ground plane, so "planted" cannot be checked against a surface',
    ],
  });
}

// ---------------------------------------------------------------- other special queries

function activeCamera(project, query, tokens, opts) {
  const cams = (project.items || []).filter((i) => i.kind === 'camera');
  if (!cams.length) {
    return result(query, 'no camera in this project', [], {
      question: 'There is no camera in this project. Add one with add_camera.',
      limitations: ['with no camera, nothing screen-space can be measured: framing, staging, screen-space velocity and readability all need one'],
    });
  }
  const looked = project.__cameraView ? cams.find((c) => c.id === project.__cameraView) : null;
  if (looked) {
    return result(query, 'the camera currently being looked through', [match({
      entityId: ids.itemId(looked), kind: 'item', item: looked, name: looked.name,
      role: ROLE.CAMERA, side: null, certainty: CERTAINTY.CERTAIN, confidence: 1,
      ev: [evidence('data', `the viewport is looking through "${looked.name}"`)],
    })]);
  }
  if (cams.length === 1) {
    return result(query, 'the only camera in the project', [match({
      entityId: ids.itemId(cams[0]), kind: 'item', item: cams[0], name: cams[0].name,
      role: ROLE.CAMERA, side: null, certainty: CERTAINTY.HIGHLY_LIKELY, confidence: 0.85,
      ev: [evidence('data', 'exactly one camera exists'), evidence('absence', 'the viewport is not looking through any camera, so "active" was read as "the only one"')],
    })]);
  }
  return result(query, `${cams.length} cameras exist and none is being looked through`, [], {
    ambiguous: true,
    alternatives: cams.map((c) => ({ entityId: ids.itemId(c), name: c.name })),
    question: `Which camera? ${cams.map((c) => c.name).join(', ')}. Cadence has no shot model yet, so there is no "the camera that frames the attack" to resolve (Part 40, Phase 6).`,
  });
}

function impactTarget(project, query, tokens, opts) {
  // Honest refusal. Part 12: "never claim that a missing analyzer has checked something."
  const pinned = [];
  for (const item of project.items || []) {
    const r = roles.itemRole(project, item);
    if (r.role === ROLE.TARGET) pinned.push(match({
      entityId: ids.itemId(item), kind: 'item', item, name: item.name,
      role: r.role, side: null, certainty: CERTAINTY.CERTAIN, confidence: 1, ev: r.evidence,
    }));
  }
  if (pinned.length) return result(query, 'items with a pinned "target" role', pinned);
  return result(query, 'no impact target is representable yet', [], {
    question: 'Cadence has no shot-event system, so there is no impact event and no target to resolve (Part 41, Phase 6). Pin an item\'s role to "target" with set_semantic_role if you want to address one now.',
    limitations: ['shot events, impact events and contact targets are Phase 6; markers exist on the timeline but carry no causal or target information'],
  });
}

/** Every phrase this resolver understands, for discovery and for the MCP tool description. */
export function vocabulary() {
  return {
    roles: Object.keys(QUERY_ROLES).sort(),
    sides: Object.keys(SIDE_WORDS),
    special: SPECIAL.map((s) => s.name).filter((v, i, a) => a.indexOf(v) === i),
    plural_words: [...PLURAL_WORDS].sort(),
  };
}
