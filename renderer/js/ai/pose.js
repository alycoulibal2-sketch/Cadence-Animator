// Exact pose compilation (directive Parts 20.3, 26, 28, 29, 32) — the first module in this layer
// that GENERATES animation rather than editing it.
//
// Everything before this edits keys that already exist. `plan.js`'s four strategies scale, re-ease
// and offset what an animator already authored; on an empty timeline they have nothing to work on
// and say so (`planLimitations().cannot[0]`). This module is the other half: a PoseSpec in, a list
// of `set_key` operations out, with the rotations COMPUTED from explicit goals.
//
// The three constraints this build is held to shaped every decision here:
//
//   * **Exact.** A rotation is a number of degrees about a named axis in a declared convention;
//     a reach is solved analytically to the target and the residual is exactly zero, or the
//     shortfall is reported in studs. Nothing is estimated and nothing is "interpreted".
//   * **No learning.** There is no model, no corpus and no API. The caller states the goal; this
//     file does trigonometry.
//   * **Full power.** Any pose is reachable, because every joint is addressable by an explicit
//     rotation goal. There is no pose library and no ceiling.
//
// And one rule about the CALLER, who is a language model (directive Part 62's operating notes):
// **a model must never write a CFrame or pick a sign on an axis.** Composing rotations and
// choosing handedness is exactly what models are worst at, and a wrong-axis pose is expensive to
// spot in a still frame. So the authoring surface is degrees about X/Y/Z in the convention the
// editor's own rotation fields and `get_rotation_degrees` already use, plus reach targets in
// studs. This module does the composition; a wrong-axis mistake becomes impossible rather than
// caught later.
//
// What this file does NOT do, stated here rather than implied: it does not decide WHICH pose is
// wanted, does not rank two poses, and does not judge whether a pose reads. Line of action, centre
// of mass and balance are MEASURED from the solved pose and reported as measurements with their
// method named; "this silhouette reads clearly" is a subjective judgement and Part 4.5 forbids a
// tool from stating one as fact.

import * as CF from '../cf.js';
import * as K from './kinematics.js';
import * as ROLES from './roles.js';
import { ROLE } from './roles.js';
import * as SEL from './select.js';
import { CERTAINTY, coverage, evidence, finding, sortFindings } from './certainty.js';

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const EPS = 1e-9;

// ---------------------------------------------------------------- the declared conventions
//
// Every one of these is a FACT about `rigs/builtin.json` and `renderer/js/cf.js`, verified by
// `test/aitest.mjs` against the rig data rather than asserted here. They are exported as data
// because a caller that has to guess the convention will guess wrong, and because the MCP tool
// prints them next to the goal fields a caller is about to fill in.

/** Rotation order and units. `CF.fromEuler` composes R = Rx·Ry·Rz, which is Roblox's
 *  `CFrame.Angles` and exactly what the editor's rotation fields and `get_rotation_degrees`
 *  read and write — so a number a caller reads out of the UI can be written straight back. */
export const ROTATION_CONVENTION = Object.freeze({
  units: 'degrees',
  order: 'X then Y then Z, composed as Rx·Ry·Rz (CF.fromEuler — Roblox CFrame.Angles)',
  frame: 'the joint\'s own rest frame. Every builtin rig\'s C0/C1 are pure translations, so a joint\'s rest axes are world-aligned and a keyed rotation sets the child\'s orientation exactly',
  same_numbers_as: 'get_rotation_degrees, and the editor\'s X/Y/Z rotation fields',
});

/** What each axis means on a humanoid rig facing local −Z with +X to its right. Written as prose
 *  a caller can act on, because "+X on the shoulder" is meaningless without it. */
export const AXIS_MEANING = Object.freeze({
  facing: 'the rig faces its own local −Z; +X is its right; +Y is up',
  shoulder: '+X swings the limb forward (toward −Z); −X swings it back; +Z raises the arm away from the body on the LEFT side and across the body on the right (the sign is the rig\'s, not the body\'s — mirror_item exists for the other side)',
  hip: '+X swings the leg forward, −X back',
  elbow: '+X is the natural bend (the forearm comes forward)',
  knee: '−X is the natural bend (the shin comes back)',
  waist: '−X leans the chest forward, +Y turns it to the rig\'s left',
  neck: '−X drops the chin, +Y turns the head to the rig\'s left',
});

/**
 * Which way a two-bone chain's middle joint bends naturally, per joint role.
 *
 * This is a declared convention, not a measurement: nothing in Cadence stores joint limits (the
 * Rig Graph reports them as unknown rather than unlimited), so the solver cannot DISCOVER that a
 * knee does not bend forwards. It is given the direction, states that it was given it, and the
 * caller may override it — which is what makes a deliberately broken pose still authorable.
 */
export const BEND_AXES = Object.freeze({
  [ROLE.ELBOW]: { axis: [1, 0, 0], why: 'the forearm comes forward; +X at the elbow is the human bend' },
  [ROLE.KNEE]: { axis: [-1, 0, 0], why: 'the shin comes back; −X at the knee is the human bend, and +X is a knee bending backwards' },
});

/** How far off a target counts as "reached". 0.001 studs is three orders of magnitude below the
 *  smallest part on an R15 (a 0.3-stud foot) and far above the 1e-14 the analytic solve actually
 *  lands at — so a non-zero residual here means the target was genuinely out of reach, never
 *  floating-point noise. */
export const REACH_TOLERANCE_STUDS = 0.001;

// ---------------------------------------------------------------- small vector helpers

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (v, k) => [v[0] * k, v[1] * k, v[2] * k];
function unit(v) { const n = norm(v); return n < EPS ? [0, 0, 0] : [v[0] / n, v[1] / n, v[2] / n]; }
const round4 = (v) => (v === null || v === undefined ? null : Math.round(v * 1e4) / 1e4);
const round3 = (v) => (v === null || v === undefined ? null : Math.round(v * 1e3) / 1e3);
const vecRound = (v) => (v ? v.map(round4) : null);

const tracksOf = (project, itemId) => (project.tracks && project.tracks[itemId]) || {};
const itemOf = (project, itemId) => (project.items || []).find((i) => i.id === itemId) || null;

// ---------------------------------------------------------------- degrees ⇄ transform

/**
 * A rotation goal in degrees becomes the joint Transform that realises it.
 *
 * Deliberately NOT a delta: the value written is the joint's absolute rotation from rest, which is
 * what a keyframe stores and what `get_rotation_degrees` reads back. A caller asking for "the
 * shoulder at −120° about X" gets a pose whose read-back is −120, whatever was there before.
 */
export function rotationFromDegrees({ x = 0, y = 0, z = 0 } = {}) {
  return CF.fromEuler(x * RAD, y * RAD, z * RAD);
}

/** The inverse, for reporting what a solved pose actually came out as. */
export function degreesFromRotation(cf) {
  const [rx, ry, rz] = CF.toEuler(cf || CF.IDENTITY);
  return { x: round3(rx * DEG), y: round3(ry * DEG), z: round3(rz * DEG) };
}

// ---------------------------------------------------------------- chains and bone geometry

/** The motor-joint chain from a part upward, tip first. Mirrors `renderer/js/ik.js buildChain`
 *  exactly — the two must agree on what "the arm" is, or the smoketest cross-check compares two
 *  different chains and passes for the wrong reason. */
export function buildChain(rig, endPartId, maxJoints = 3) {
  if (!rig) return [];
  const byPart1 = new Map();
  for (const j of rig.joints || []) if (j.kind !== 'weld') byPart1.set(j.part1, j);
  const chain = [];
  let cur = endPartId;
  while (chain.length < Math.max(1, maxJoints)) {
    const j = byPart1.get(cur);
    if (!j) break;
    chain.push(j);
    cur = j.part0;
    if (cur === rig.rootPart) break;
  }
  return chain;
}

/**
 * The two-bone geometry of a chain, in the exact frames the FK solve uses.
 *
 * `Part1World = Part0World · C0 · Transform · C1⁻¹`, so for a chain j1 (proximal) → j2 (distal) →
 * fixed joints → end part:
 *
 *     endWorld − pivot1 = F1 · R1 · ( u + Q · R2 · w )
 *
 * where `F1` is the proximal pivot's world rotation, `u` and `Q` are the translation and rotation
 * of `C1(j1)⁻¹ · C0(j2)` (pivot1 → pivot2), and `w` is the translation of everything from pivot2
 * down to the effector point with the tip-ward joints held at their current pose.
 *
 * Computing `w` from the real rest offsets is not a detail: R15's upper arm is ANGLED — the elbow
 * sits half a stud outboard of the shoulder — so a solver that assumed two straight collinear
 * bones would place the hand systematically wrong and never know it. `u` here is (±0.5, −0.729, 0)
 * and the maximum reach is 1.690 studs, not the 1.768 that |u|+|w| would suggest.
 */
export function boneGeometry(rig, endPartId, { maxJoints = 3, fixedPose = null, effectorOffset = null } = {}) {
  const chain = buildChain(rig, endPartId, maxJoints);
  if (chain.length < 2) return { ok: false, reason: `"${endPartId}" has fewer than two driving joints above it — a two-bone solve needs a distal and a proximal joint`, chain: chain.map((j) => j.name) };
  const j1 = chain[chain.length - 1];
  const j2 = chain[chain.length - 2];
  const fixed = chain.slice(0, chain.length - 2);           // tip-first
  const M12 = CF.mul(CF.inverse(j1.c1), j2.c0);
  // Root-to-tip, because each fixed joint's frame is built on the one above it.
  let M2E = CF.inverse(j2.c1);
  for (let i = fixed.length - 1; i >= 0; i--) {
    const j = fixed[i];
    const T = (fixedPose && fixedPose[j.name]) || CF.IDENTITY;
    M2E = CF.mul(CF.mul(CF.mul(M2E, j.c0), T), CF.inverse(j.c1));
  }
  // An effector offset is expressed in the END PART's own frame, so it composes on the right —
  // the same place the part's own geometry sits. That makes "the sword tip" authorable without
  // the caller ever computing a world position.
  if (effectorOffset) M2E = CF.mul(M2E, Array.isArray(effectorOffset) ? CF.cfNew(effectorOffset[0], effectorOffset[1], effectorOffset[2]) : effectorOffset);
  const u = [M12[0], M12[1], M12[2]];
  const w = [M2E[0], M2E[1], M2E[2]];
  return {
    ok: true,
    proximal: j1, distal: j2, fixed, chain: chain.map((j) => j.name),
    M12, M2E, u, w,
    bone1_studs: norm(u), bone2_studs: norm(w),
  };
}

/**
 * Analytic two-bone inverse kinematics.
 *
 * Closed form, not iterative, and that is the whole point: CCD (what `renderer/js/ik.js` does for
 * the mouse-dragged handle) converges toward a target and stops at a tolerance, so its answer
 * depends on the iteration count and on where the limb started. A generator whose pose depends on
 * its own previous pose is not reproducible, and Part 59's `reproducibility` dimension would
 * measure exactly that drift. This lands on the target to floating-point precision, from any start.
 *
 * The maths: with the bend angle θ about a declared axis `a` in the distal joint's frame,
 *
 *     |u + Q·R_a(θ)·w|² = |u|² + |w|² + 2[(C−K)cosθ + S·sinθ + K]
 *
 * for C = u₂·w, S = u₂·(a×w), K = (u₂·a)(a·w) and u₂ = Qᵀu — a plain sinusoid in θ, so the bend
 * that puts the effector at distance d is solved directly. Two roots exist (the limb bends either
 * way); the declared bend axis picks the natural one. `R1` is then the minimal rotation carrying
 * the bent limb onto the target direction, plus an optional roll about it.
 *
 * @param opts.axis       bend axis in the distal joint's frame; defaults to the role's BEND_AXES
 * @param opts.bend       'natural' (the declared direction) or 'reverse'
 * @param opts.twistDeg   roll about the reach direction, in degrees — the one remaining freedom
 */
export function solveTwoBone(geo, targetLocal, { axis = null, bend = 'natural', twistDeg = 0 } = {}) {
  const { M12, u, w } = geo;
  const a = unit(axis || [1, 0, 0]);
  const u2 = CF.rotateVector(CF.inverse(M12), u);
  const L1 = norm(u), L2 = norm(w);
  const C = dot(u2, w);
  const S = dot(u2, cross(a, w));
  const Kk = dot(u2, a) * dot(a, w);
  const A = 2 * (C - Kk), B = 2 * S, base = L1 * L1 + L2 * L2 + 2 * Kk;
  const R = Math.hypot(A, B);
  const phi = Math.atan2(B, A);

  const d = norm(targetLocal);
  const minReach = Math.sqrt(Math.max(0, base - R));
  const maxReach = Math.sqrt(Math.max(0, base + R));
  let d2 = d * d;
  let shortfall = null;
  if (d > maxReach + EPS) { shortfall = { studs: round4(d - maxReach), direction: 'too far', reachable_studs: round4(maxReach) }; d2 = base + R; }
  else if (d < minReach - EPS) { shortfall = { studs: round4(minReach - d), direction: 'too close', reachable_studs: round4(minReach) }; d2 = Math.max(0, base - R); }

  const alpha = R < EPS ? 0 : Math.acos(Math.max(-1, Math.min(1, (d2 - base) / R)));
  const wrap = (t) => Math.atan2(Math.sin(t), Math.cos(t));
  const roots = [wrap(phi + alpha), wrap(phi - alpha)];
  // The declared axis is oriented so that a POSITIVE rotation about it is the natural bend, which
  // is what makes `bend: 'reverse'` a deliberate, visible choice rather than a coin toss.
  const wanted = bend === 'reverse' ? roots.filter((t) => t <= EPS) : roots.filter((t) => t >= -EPS);
  const theta = wanted.length
    ? wanted.sort((x, y) => Math.abs(x) - Math.abs(y))[0]
    : roots.slice().sort((x, y) => Math.abs(x) - Math.abs(y))[0];

  const R2 = CF.axisAngle(a, theta);
  const bent = add(u, CF.rotateVector(M12, CF.rotateVector(R2, w)));
  let R1 = CF.rotationBetween(bent, targetLocal, Math.PI) || CF.IDENTITY.slice();
  if (twistDeg) {
    // A roll about the reach direction leaves every point on that axis fixed, so it changes the
    // limb's orientation without moving the effector at all — the same freedom ik.js exposes.
    const axisLocal = unit(targetLocal);
    R1 = CF.orthonormalize(CF.mul(CF.axisAngle(axisLocal, twistDeg * RAD), R1));
  }
  return {
    proximal: geo.proximal.name, distal: geo.distal.name,
    transforms: { [geo.proximal.name]: R1, [geo.distal.name]: R2 },
    bend_deg: round3(theta * DEG),
    bend_axis: a.map(round4), bend_choice: bend,
    alternative_bend_deg: (() => { const other = roots.find((t) => Math.abs(t - theta) > EPS); return other === undefined ? null : round3(other * DEG); })(),
    reach_range_studs: { min: round4(minReach), max: round4(maxReach) },
    requested_distance_studs: round4(d),
    shortfall,
    fixed_joints: geo.fixed.map((j) => j.name),
    bone_lengths_studs: { proximal_to_distal: round4(L1), distal_to_effector: round4(L2) },
  };
}

// ---------------------------------------------------------------- resolving goals to joints

/** Resolve a goal's joint: an exact track/joint name wins, then a `{role, side}` pair, then a
 *  phrase through `ai/select.js`. A phrase that resolves to more than one joint is REFUSED with
 *  the alternatives, never silently narrowed — the same rule selection already follows. */
function resolveJoint(project, item, target) {
  const joints = (item.rig.joints || []).filter((j) => j.kind !== 'weld');
  const named = target.joint ?? null;
  if (named) {
    const exact = joints.find((j) => j.name === named);
    if (exact) return { joint: exact, how: 'the joint was named exactly' };
    return { joint: null, why: `"${named}" is not a joint on this rig. Joints: ${joints.map((j) => j.name).join(', ')}` };
  }
  const role = target.semantic_role ?? target.role ?? null;
  if (!role) return { joint: null, why: 'the goal names neither a joint nor a semantic role' };
  if (typeof role === 'string' && !Object.values(ROLE).includes(role)) {
    // A phrase such as "right shoulder".
    const res = SEL.resolve(project, role, { itemId: item.id, kind: 'joint' });
    if (!res.resolved) return { joint: null, why: res.question || `"${role}" resolved to no joint` };
    if (res.matches.length > 1) return { joint: null, why: `"${role}" resolves to ${res.matches.length} joints (${res.matches.map((m) => m.name).join(', ')}) — name one, or add a side` };
    const j = joints.find((x) => x.name === res.matches[0].name);
    return j ? { joint: j, how: `the phrase "${role}" resolved to ${j.name}` } : { joint: null, why: `"${role}" resolved to "${res.matches[0].name}", which is not a joint on this rig` };
  }
  const side = target.side ?? null;
  const hits = joints.filter((j) => {
    const r = ROLES.jointRole(project, item, j);
    return r.role === role && (!side || r.side === side);
  });
  if (!hits.length) return { joint: null, why: `no joint on this rig has role "${role}"${side ? ` on the ${side}` : ''}` };
  if (hits.length > 1) return { joint: null, why: `role "${role}"${side ? ` on the ${side}` : ''} matches ${hits.length} joints (${hits.map((j) => j.name).join(', ')}) — add a side, or name the joint` };
  return { joint: hits[0], how: `role "${role}"${side ? ` (${side})` : ''} resolved to ${hits[0].name}` };
}

/** Resolve an effector part for a reach goal. Same rules, over parts. */
function resolvePart(project, item, ref) {
  const parts = item.rig.parts || [];
  if (!ref) return { part: null, why: 'no part was named' };
  const exact = parts.find((p) => p.id === ref || p.name === ref);
  if (exact) return { part: exact, how: 'the part was named exactly' };
  const res = SEL.resolve(project, ref, { itemId: item.id, kind: 'part' });
  if (!res.resolved) return { part: null, why: res.question || `"${ref}" resolved to no part` };
  if (res.matches.length > 1) return { part: null, why: `"${ref}" resolves to ${res.matches.length} parts (${res.matches.map((m) => m.name).join(', ')}) — name one, or add a side` };
  const p = parts.find((x) => (x.name || x.id) === res.matches[0].name || x.id === res.matches[0].name);
  return p ? { part: p, how: `the phrase "${ref}" resolved to ${p.id}` } : { part: null, why: `"${ref}" resolved to "${res.matches[0].name}", which is not a part on this rig` };
}

/**
 * Where a reach target actually is, in world studs.
 *
 * Three forms, in decreasing order of how much the caller has to know:
 *   `{ hold: true }`             — wherever this effector is at `holdFrame`. This is what pins a
 *                                  planted foot: the target is the foot's own position at the
 *                                  frame the contact began, so solving to it IS the contact.
 *   `{ relative_to, offset }`    — a named part's position plus an offset in studs. The offset is
 *                                  in WORLD axes, because the whole point of the rig-convention
 *                                  table above is that the caller can reason in them.
 *   `{ world: [x,y,z] }`         — absolute, for a caller that measured one.
 */
function resolveTarget(project, item, spec, worlds, holdWorlds, effectorPartId) {
  if (!spec) return { pos: null, why: 'the reach goal has no target' };
  if (spec.world) return { pos: spec.world.slice(0, 3), how: 'an absolute world position' };
  if (spec.hold) {
    const w = (holdWorlds || worlds).get(effectorPartId);
    if (!w) return { pos: null, why: `"${effectorPartId}" was not solved at the hold frame, so there is no position to hold` };
    const base = [w[0], w[1], w[2]];
    const off = spec.offset ? spec.offset.slice(0, 3) : [0, 0, 0];
    return { pos: add(base, off), how: `the effector's own world position at the hold frame${spec.offset ? ', plus the declared offset' : ''}` };
  }
  const refName = spec.relative_to ?? spec.relativeTo ?? null;
  if (!refName) return { pos: null, why: 'the target names neither `world`, `hold`, nor `relative_to`' };
  const r = resolvePart(project, item, refName);
  if (!r.part) return { pos: null, why: `the target is relative to "${refName}": ${r.why}` };
  const w = worlds.get(r.part.id);
  if (!w) return { pos: null, why: `"${r.part.id}" was not solved at this frame` };
  const off = spec.offset ? spec.offset.slice(0, 3) : [0, 0, 0];
  return { pos: add([w[0], w[1], w[2]], off), how: `${r.part.id}'s world position${spec.offset ? ' plus the declared offset in world studs' : ''}`, referencePart: r.part.id };
}

// ---------------------------------------------------------------- measurement (Parts 28, 29)

/**
 * A least-squares 3D line through the spine parts, reported as a direction and a fit residual.
 *
 * Part 26 calls the line of action "the single most important readability tool"; what this
 * measures is the straight line the spine actually lies along and how far it departs from it. It
 * does NOT say whether that line is a good one — a strong C-curve and a broken spine both produce
 * a large residual, and distinguishing them is a judgement, not a measurement.
 *
 * The principal direction comes from fixed-count power iteration on the covariance matrix, seeded
 * from the first-to-last vector. Deterministic by construction: no random start, no convergence
 * test, so two runs on the same pose return identical digits — which `reproducibility` measures.
 */
function fitLine(points) {
  if (points.length < 2) return null;
  const n = points.length;
  const centroid = scale(points.reduce(add, [0, 0, 0]), 1 / n);
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) {
    const d = sub(p, centroid);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j];
  }
  let v = unit(sub(points[points.length - 1], points[0]));
  if (norm(v) < EPS) v = [0, 1, 0];
  for (let it = 0; it < 64; it++) {
    const nv = [
      cov[0][0] * v[0] + cov[0][1] * v[1] + cov[0][2] * v[2],
      cov[1][0] * v[0] + cov[1][1] * v[1] + cov[1][2] * v[2],
      cov[2][0] * v[0] + cov[2][1] * v[1] + cov[2][2] * v[2],
    ];
    if (norm(nv) < EPS) break;
    v = unit(nv);
  }
  // Keep the direction pointing the way the chain runs, so "up the spine" is stable across poses.
  if (dot(v, sub(points[points.length - 1], points[0])) < 0) v = scale(v, -1);
  let maxDev = 0;
  for (const p of points) {
    const d = sub(p, centroid);
    const along = dot(d, v);
    maxDev = Math.max(maxDev, norm(sub(d, scale(v, along))));
  }
  return { direction: v, centroid, max_deviation_studs: maxDev };
}

/**
 * Centre of mass, by part VOLUME.
 *
 * Cadence stores no mass and no density — a part carries a size and nothing else — so this weights
 * each part by `x·y·z` and SAYS SO, every time, in the method field. Volume is proportional to mass
 * only under uniform density, which an avatar is not: a head and a foot of equal volume do not
 * weigh the same. Treat the number as a consistent, reproducible proxy that moves the right way
 * when the body leans, not as a physical centre of mass. MOT-011's row says the same.
 */
function centreOfMass(item, worlds) {
  const contributions = [];
  let total = 0;
  let acc = [0, 0, 0];
  for (const p of item.rig.parts || []) {
    const w = worlds.get(p.id);
    if (!w || !Array.isArray(p.size)) continue;
    const vol = Math.abs(p.size[0] * p.size[1] * p.size[2]);
    if (!(vol > 0)) continue;
    total += vol;
    acc = add(acc, scale([w[0], w[1], w[2]], vol));
    contributions.push({ part: p.id, volume: round4(vol) });
  }
  if (!(total > 0)) return null;
  return {
    point: vecRound(scale(acc, 1 / total)),
    method: 'volume proxy — each part weighted by its bounding size x·y·z. Cadence stores no mass or density, so this is NOT a physical centre of mass; it is a reproducible proxy that moves in the right direction when the body leans (MOT-011)',
    total_volume: round4(total),
    parts_counted: contributions.length,
  };
}

/**
 * Balance: is the centre of mass over the support?
 *
 * The support polygon is the convex hull, in the ground plane, of the DECLARED support effectors.
 * Declared, never inferred: nothing in this build detects a contact from motion (MOT-016), and a
 * balance verdict computed over a foot the animator never said was planted would be a guess
 * wearing a number's clothes. With no declared support the polygon is null, the reason is stated,
 * and the centre of mass is still reported — which is the honest half of the answer.
 */
function balanceOf(item, worlds, com, supportPartIds) {
  if (!com) return { supported: null, why: 'no centre of mass could be computed (no part carries a size)' };
  if (!supportPartIds || !supportPartIds.length) {
    return { supported: null, support_polygon: null, why: 'no support was declared. Nothing here infers which foot is planted (MOT-016), so no support polygon exists to test the centre of mass against — declare `support: ["left foot"]` to get a verdict' };
  }
  const pts = [];
  for (const id of supportPartIds) {
    const w = worlds.get(id);
    const part = (item.rig.parts || []).find((p) => p.id === id);
    if (!w) continue;
    // The footprint is the part's own XZ extent at its solved position, axis-aligned. An
    // axis-aligned box is wider than a rotated foot really is, so a verdict of "outside" is
    // conservative (it is outside even the generous polygon) and "inside" is the looser half.
    const hx = part && Array.isArray(part.size) ? Math.abs(part.size[0]) / 2 : 0;
    const hz = part && Array.isArray(part.size) ? Math.abs(part.size[2]) / 2 : 0;
    pts.push([w[0] - hx, w[2] - hz], [w[0] + hx, w[2] - hz], [w[0] + hx, w[2] + hz], [w[0] - hx, w[2] + hz]);
  }
  if (pts.length < 3) return { supported: null, support_polygon: null, why: 'the declared support effectors did not solve to positions at this frame' };
  const hull = convexHull(pts);
  const p = [com.point[0], com.point[2]];
  const inside = pointInPolygon(p, hull);
  const margin = distanceToPolygon(p, hull);
  return {
    supported: inside,
    margin_studs: round4(inside ? margin : -margin),
    support_polygon: hull.map((q) => [round4(q[0]), round4(q[1])]),
    method: 'the centre-of-mass proxy projected onto the ground plane (XZ), against the convex hull of the declared support parts\' axis-aligned footprints. Cadence has no ground plane, so "the ground" is the plane y = the support parts\' own height',
    certainty: CERTAINTY.HIGHLY_LIKELY,
    rests_on: 'the volume proxy for mass, and the caller\'s declaration of which effectors are supporting',
  };
}

function convexHull(points) {
  const pts = [...points].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (pts.length < 3) return pts;
  const cross2 = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) { while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / ((yj - yi) || EPS) + xi) inside = !inside;
  }
  return inside;
}

function distanceToPolygon(p, poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const ab = [b[0] - a[0], b[1] - a[1]];
    const len2 = ab[0] * ab[0] + ab[1] * ab[1];
    const t = len2 < EPS ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / len2));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + ab[0] * t), p[1] - (a[1] + ab[1] * t)));
  }
  return best === Infinity ? 0 : best;
}

/**
 * Measure a solved pose: line of action, centre of mass, balance, and the height of the effectors.
 *
 * Takes a pose (a `{ jointName: transform }` table), not a frame — so it measures what a pose
 * WOULD be before any of it is written, which is what lets `compilePose` report the consequences
 * of a goal set the caller can still change.
 */
export function measurePose(project, { itemId, pose = {}, origin = null, support = [], frame = 0 } = {}) {
  const item = itemOf(project, itemId);
  if (!item || !item.rig) throw new Error(`measurePose: "${itemId}" is not a rig item`);
  const plan = K.buildSolvePlan(item.rig);
  const originCF = origin || K.itemOriginAt(project, item, frame);
  const worlds = K.solveWorlds(plan, pose, originCF, K.unparentedSet(tracksOf(project, itemId)));

  const byRole = new Map();
  for (const p of item.rig.parts || []) {
    const r = ROLES.partRole(project, item, p);
    if (!byRole.has(r.role)) byRole.set(r.role, []);
    byRole.get(r.role).push(p);
  }
  const spineOrder = [ROLE.ROOT, ROLE.HIPS, ROLE.TORSO, ROLE.CHEST, ROLE.HEAD];
  const spinePoints = [];
  const spineParts = [];
  for (const role of spineOrder) {
    for (const p of byRole.get(role) || []) {
      const w = worlds.get(p.id);
      if (w) { spinePoints.push([w[0], w[1], w[2]]); spineParts.push(p.id); }
    }
  }
  const line = fitLine(spinePoints);
  const com = centreOfMass(item, worlds);

  const supportIds = [];
  const supportUnresolved = [];
  for (const s of support || []) {
    const r = resolvePart(project, item, s);
    if (r.part) supportIds.push(r.part.id); else supportUnresolved.push({ declared: s, why: r.why });
  }
  const balance = balanceOf(item, worlds, com, supportIds);

  const notRun = [
    'silhouette readability: limb separation and negative space need a rendered pass (MOT-012, OBS-002) — nothing here looks at a pixel',
    'screen-space framing and the pose\'s relationship to camera need an active-camera model (SHOT-003/004)',
    'whether the pose READS as its intent is a subjective judgement and this module makes none (Part 4.5)',
  ];
  if (!supportIds.length) notRun.push('balance: no support was declared, so no support polygon was built (MOT-016 — nothing infers a contact)');

  return {
    frame,
    line_of_action: line ? {
      direction: vecRound(line.direction),
      through: spineParts,
      tilt_from_vertical_deg: round3(Math.acos(Math.max(-1, Math.min(1, Math.abs(dot(unit(line.direction), [0, 1, 0]))))) * DEG),
      max_deviation_studs: round4(line.max_deviation_studs),
      method: `a least-squares 3D line through ${spineParts.length} spine part centres (${spineParts.join(' → ')}). The deviation is how far the spine departs from straight; whether a curve of that size reads as a strong line of action is a judgement, not this measurement`,
      certainty: CERTAINTY.CERTAIN,
    } : null,
    centre_of_mass: com,
    balance,
    support_unresolved: supportUnresolved,
    coverage: coverage({ scope: `item ${itemId}, frame ${frame}`, frames: [frame, frame], loop: 'fast', notRun }),
  };
}

// ---------------------------------------------------------------- the compiler

/**
 * Compile a PoseSpec into `set_key` operations at one frame.
 *
 * Order is fixed and stated, because it is observable: explicit rotation goals are applied FIRST,
 * then reach goals are solved against the pose that produces. So a caller can lean the torso and
 * then pin the hand to a world point, and the hand stays pinned — which is the order an animator
 * works in, and the only order under which "hold this contact" means anything.
 *
 * Returns operations, never applies them. The transaction, the constraint check and the rollback
 * all belong to `apply_animation_patch`, which is the single place Part 11's operating mode is
 * enforced; a generator that wrote to the project directly would walk around all four.
 *
 * @param opts.pose        a PoseSpec (`ai/cal.js poseSpec`), or its `body_region_targets` array
 * @param opts.t           the frame to key at
 * @param opts.basePose    the pose to layer goals onto (default: the item's pose at `t`)
 * @param opts.holdFrame   the frame a `{ hold: true }` target reads its position from (default 0)
 * @param opts.holdPose    the pose AT that frame, when it is not in the project yet. Authoring
 *                         needs this: the frame-0 stance a script is generating exists only as
 *                         operations, so reading the project would hold the rig's REST foot
 *                         position rather than the stance's — a target a bent leg cannot reach,
 *                         and a silently wrong contact
 * @param opts.easing      `{ es, ed }` for the keys written
 * @param opts.support     effectors to measure balance against
 */
export function compilePose(project, { itemId, pose, t = 0, basePose = null, holdFrame = 0, holdPose = null, easing = null, support = [], onlyNamed = true } = {}) {
  const item = itemOf(project, itemId);
  if (!item) throw new Error(`compilePose: no item "${itemId}"`);
  if (!item.rig) throw new Error(`compilePose: "${item.name || itemId}" has no rig — a pose is joint rotations, and a camera or prop has none`);
  const targets = Array.isArray(pose) ? pose : (pose && pose.body_region_targets) || [];
  const findings = [];
  const unresolved = [];
  const applied = [];

  const tracks = tracksOf(project, itemId);
  const unparented = K.unparentedSet(tracks);
  const solvePlan = K.buildSolvePlan(item.rig);
  const originCF = K.itemOriginAt(project, item, t);
  // The pose this builds ON. From the tracks by default, so a goal set that names three joints
  // leaves the other twelve exactly where the animation already had them.
  const working = { ...(basePose || K.evalPose(tracks, t)) };

  // --- pass 1: explicit rotation goals
  for (const target of targets) {
    const goal = target.rotation_goal ?? target.rotationGoal ?? null;
    if (goal === null || goal === undefined) continue;
    const r = resolveJoint(project, item, target);
    if (!r.joint) { unresolved.push({ goal: 'rotation', target: target.joint ?? target.semantic_role ?? target.role ?? null, why: r.why }); continue; }
    if (typeof goal === 'string') {
      // A described relationship ("the sword points at the target") is a legitimate PoseSpec value
      // and this build cannot compile one. Saying so is the requirement (Part 4.7); pretending to
      // understand it would produce a pose nobody asked for.
      unresolved.push({ goal: 'rotation', target: r.joint.name, why: `the rotation goal is prose ("${goal}"). This compiler takes degrees about named axes: { x, y, z }. A described relationship needs a solver that does not exist here` });
      continue;
    }
    if (typeof goal !== 'object' || !['x', 'y', 'z'].some((k) => typeof goal[k] === 'number')) {
      unresolved.push({ goal: 'rotation', target: r.joint.name, why: 'a rotation goal must be an object with at least one of x, y, z in degrees' });
      continue;
    }
    const cf = rotationFromDegrees(goal);
    working[r.joint.name] = cf;
    applied.push({ kind: 'rotation', joint: r.joint.name, degrees: { x: goal.x ?? 0, y: goal.y ?? 0, z: goal.z ?? 0 }, resolved_by: r.how });
  }

  // --- pass 2: reach goals, solved against the pose pass 1 produced
  const holdWorlds = K.solveWorlds(solvePlan, holdPose || K.evalPose(tracks, holdFrame), K.itemOriginAt(project, item, holdFrame), unparented);
  for (const target of targets) {
    const goal = target.position_goal ?? target.positionGoal ?? null;
    if (goal === null || goal === undefined) continue;
    if (typeof goal === 'string') {
      unresolved.push({ goal: 'reach', target: target.joint ?? target.semantic_role ?? target.role ?? null, why: `the position goal is prose ("${goal}"). This compiler takes a target: { world | relative_to+offset | hold }, in studs` });
      continue;
    }
    const effRef = goal.effector ?? target.joint ?? target.semantic_role ?? target.role ?? null;
    const ep = resolvePart(project, item, effRef);
    if (!ep.part) { unresolved.push({ goal: 'reach', target: effRef, why: ep.why }); continue; }

    const geo = boneGeometry(item.rig, ep.part.id, {
      maxJoints: goal.chain_length ?? 3,
      fixedPose: working,
      effectorOffset: goal.effector_offset ?? null,
    });
    if (!geo.ok) { unresolved.push({ goal: 'reach', target: ep.part.id, why: geo.reason }); continue; }

    // Solve against the pose so far, so an earlier rotation goal on the torso moves the shoulder
    // and the hand still lands where it was asked to.
    const worlds = K.solveWorlds(solvePlan, working, originCF, unparented);
    const tgt = resolveTarget(project, item, goal.target ?? goal, worlds, holdWorlds, ep.part.id);
    if (!tgt.pos) { unresolved.push({ goal: 'reach', target: ep.part.id, why: tgt.why }); continue; }

    const p0World = worlds.get(geo.proximal.part0);
    if (!p0World) { unresolved.push({ goal: 'reach', target: ep.part.id, why: `"${geo.proximal.part0}" was not solved at this frame, so the chain has no base` }); continue; }
    const pivot1 = CF.mul(p0World, geo.proximal.c0);
    const targetLocal = CF.rotateVector(CF.inverse(pivot1), sub(tgt.pos, [pivot1[0], pivot1[1], pivot1[2]]));

    const distalRole = ROLES.jointRole(project, item, geo.distal).role;
    const declaredAxis = goal.bend_axis ?? BEND_AXES[distalRole]?.axis ?? null;
    if (!declaredAxis) {
      unresolved.push({ goal: 'reach', target: ep.part.id, why: `no bend axis is declared for a "${distalRole}" joint (${geo.distal.name}), and this module will not pick one. Pass \`bend_axis\` — the axis in the joint's own frame that a positive rotation bends it about` });
      continue;
    }
    const sol = solveTwoBone(geo, targetLocal, {
      axis: declaredAxis,
      bend: goal.bend ?? 'natural',
      twistDeg: goal.twist_deg ?? 0,
    });
    for (const [name, cf] of Object.entries(sol.transforms)) working[name] = cf;

    // Verify by forward kinematics rather than by trusting the algebra. The residual is the
    // honest number: zero when reachable, exactly the shortfall when not.
    const after = K.solveWorlds(solvePlan, working, originCF, unparented);
    const endCF = after.get(ep.part.id);
    const reached = geo.M2E && (goal.effector_offset)
      ? CF.position(CF.mul(endCF, Array.isArray(goal.effector_offset) ? CF.cfNew(...goal.effector_offset) : goal.effector_offset))
      : [endCF[0], endCF[1], endCF[2]];
    const residual = norm(sub(reached, tgt.pos));

    applied.push({
      kind: 'reach', effector: ep.part.id, joints: [sol.proximal, sol.distal], fixed: sol.fixed_joints,
      target_studs: vecRound(tgt.pos), target_from: tgt.how,
      residual_studs: round4(residual), reached: residual <= REACH_TOLERANCE_STUDS,
      bend_deg: sol.bend_deg, bend_axis_from: goal.bend_axis ? 'declared by the caller' : `BEND_AXES[${distalRole}]: ${BEND_AXES[distalRole].why}`,
      reach_range_studs: sol.reach_range_studs,
      shortfall: sol.shortfall,
      resolved_by: ep.how,
    });
    if (residual > REACH_TOLERANCE_STUDS) {
      findings.push(finding({
        id: 'POSE-REACH-SHORT',
        certainty: CERTAINTY.CERTAIN,
        statement: `${ep.part.id} cannot reach the target: it stops ${round4(residual)} studs ${sol.shortfall?.direction ?? 'short'}.`,
        evidence: [
          evidence('measurement', `the chain reaches between ${sol.reach_range_studs.min} and ${sol.reach_range_studs.max} studs from ${geo.proximal.name}; the target is ${sol.requested_distance_studs} away`),
          evidence('data', `bones: ${sol.bone_lengths_studs.proximal_to_distal} + ${sol.bone_lengths_studs.distal_to_effector} studs (${geo.chain.join(' ← ')})`),
        ],
        frame: t,
        target: ep.part.id,
        suggestion: { text: 'move the target inside the reach range, lengthen the chain with `chain_length`, or move the rig — the pose returned is the closest reachable one and the residual above is exactly how far it falls short', reversible: true },
      }));
    }
  }

  // --- the operations
  const touched = new Set(applied.flatMap((a) => (a.kind === 'rotation' ? [a.joint] : a.joints)));
  const ops = [];
  for (const name of [...touched].sort()) {
    const op = { op: 'set_key', itemId, track: name, t, value: working[name] };
    if (easing && easing.es) op.es = easing.es;
    if (easing && easing.ed) op.ed = easing.ed;
    ops.push(op);
  }
  if (!onlyNamed) {
    // Writing every joint makes the frame a true full-body key — a pose nothing else can drift
    // out from under. Off by default because a key nobody asked for is exactly the "accidental
    // keyframe" Part 44 lists as a defect.
    for (const j of (item.rig.joints || []).filter((x) => x.kind !== 'weld')) {
      if (touched.has(j.name)) continue;
      const op = { op: 'set_key', itemId, track: j.name, t, value: working[j.name] || CF.IDENTITY.slice() };
      if (easing && easing.es) op.es = easing.es;
      if (easing && easing.ed) op.ed = easing.ed;
      ops.push(op);
    }
  }

  for (const u of unresolved) {
    findings.push(finding({
      id: 'POSE-GOAL-UNRESOLVED',
      certainty: CERTAINTY.CERTAIN,
      statement: `a ${u.goal} goal for "${u.target ?? 'an unnamed target'}" was not compiled: ${u.why}`,
      evidence: [evidence('absence', u.why)],
      frame: t,
      suggestion: { text: 'name the joint or part exactly (inspect_rig lists them), or give the goal in the form this compiler takes (degrees about x/y/z; a target in studs)', reversible: true },
    }));
  }

  const measured = measurePose(project, { itemId, pose: working, origin: originCF, support, frame: t });

  return {
    ops,
    pose: working,
    applied,
    unresolved,
    measured,
    degrees: Object.fromEntries([...touched].sort().map((n) => [n, degreesFromRotation(working[n])])),
    findings: sortFindings(findings),
    coverage: coverage({
      scope: `item ${itemId}, frame ${t}, ${ops.length} joint(s)`,
      frames: [t, t],
      loop: 'fast',
      notRun: [
        ...measured.coverage.notRun,
        'nothing was applied: these are operations, and whether a constraint permits them is decided by checkPatch inside apply_animation_patch',
        'no joint limit was consulted — Cadence stores none, and the Rig Graph reports them as unknown rather than unlimited, so a pose that a real body could not hold is still compiled if it is asked for',
        'self-intersection is not checked: check_collision compares axis-aligned boxes in the app and is not available in this layer',
      ],
    }),
  };
}

/** What a caller needs to know before writing a goal, as data rather than prose in a docstring. */
export function poseConventions(project = null, itemId = null) {
  const item = project && itemId ? itemOf(project, itemId) : null;
  const chains = [];
  if (item && item.rig) {
    for (const p of item.rig.parts || []) {
      const r = ROLES.partRole(project, item, p);
      if (!ROLES.isContactCapable(r.role)) continue;
      const geo = boneGeometry(item.rig, p.id, {});
      if (!geo.ok) continue;
      const declared = BEND_AXES[ROLES.jointRole(project, item, geo.distal).role] ?? null;
      chains.push({
        effector: p.id, role: r.role, side: r.side,
        solves: [geo.proximal.name, geo.distal.name],
        holds: geo.fixed.map((j) => j.name),
        bone_studs: [round4(geo.bone1_studs), round4(geo.bone2_studs)],
        bend_axis: declared?.axis ?? null,
        // A hand and a foot have a knee or an elbow in the middle and a declared bend. A LOWER arm
        // is contact-capable too, but its chain's middle joint is a shoulder, which has no natural
        // bend direction — so the caller must state one rather than this module picking a sign.
        bend_axis_required_from_caller: !declared,
      });
    }
  }
  return {
    rotation: ROTATION_CONVENTION,
    axes: AXIS_MEANING,
    bend_axes: BEND_AXES,
    reach_tolerance_studs: REACH_TOLERANCE_STUDS,
    goal_forms: {
      rotation: '{ joint | semantic_role, rotation_goal: { x, y, z } } — degrees, absolute from rest',
      reach: '{ position_goal: { effector, target: { world:[x,y,z] } | { relative_to, offset:[x,y,z] } | { hold: true }, bend?, twist_deg?, chain_length?, bend_axis? } }',
    },
    reach_chains: chains,
    never_ask_the_caller_for: 'a CFrame, a quaternion, a rotation matrix, or an axis sign. Every input here is degrees or studs, and this module composes them',
  };
}

export function poseLimitations() {
  return {
    can: [
      'set any joint to an exact rotation in degrees about X/Y/Z, in the same convention the editor\'s fields and get_rotation_degrees use',
      'solve a two-bone chain (shoulder+elbow, hip+knee) analytically onto a world target, landing on it to floating-point precision or reporting the shortfall in studs',
      'hold an effector at its own position from another frame — which is how a planted contact is authored rather than measured after the fact',
      'measure the line of action, a volume-proxy centre of mass, and balance against a DECLARED support polygon',
    ],
    cannot: [
      'decide which pose is wanted, or rank two poses — it compiles the goals it is given',
      'compile a prose goal ("the sword points at the enemy"); goals are degrees and studs',
      'solve a chain longer than two driving joints — a three-bone spine solve has no unique answer and this module will not invent one',
      'respect a joint limit: Cadence stores none, so a knee CAN be authored bending backwards (and `bend: "reverse"` does exactly that on purpose)',
      'weigh a part by mass — the centre of mass is a VOLUME proxy and says so wherever it appears (MOT-011)',
      'infer which effector is planted; balance needs a declared support (MOT-016)',
      'judge readability, silhouette or whether the pose reads as its intent — those need a renderer (MOT-012) and a judgement this layer does not make (Part 4.5)',
    ],
    rests_on: [
      'every builtin rig\'s C0/C1 are pure translations, so a joint\'s rest axes are world-aligned — verified against rigs/builtin.json by test, not assumed',
      'the R15 upper arm is angled (the elbow sits 0.5 studs outboard of the shoulder), so bone lengths come from the real rest offsets and maximum arm reach is 1.69 studs, not the 1.77 a straight-bone model would give',
    ],
  };
}
