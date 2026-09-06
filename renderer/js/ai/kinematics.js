// Pure track evaluation and pure forward kinematics.
//
// Everything the semantic layer wants to measure — where a hand actually is, how far a foot
// drifted, what a pose looks like at frame 47 — needs two things Cadence already has but keeps in
// impure modules: track evaluation (`state.js`, which touches `window`) and the FK solve
// (`rigbuild.js`, which is three.js). Neither can be imported in plain Node, and neither can be
// run against anything other than the one live project.
//
// So the maths is reimplemented here over PLAIN DATA. That buys three things the originals
// cannot give:
//
//   * it runs on a snapshot, a baseline, an undo state or a fixture, not only on `state.project`;
//   * it runs under `node test/aitest.mjs` with no Electron;
//   * it has no display side-effects at all, so an analysis pass can never disturb the viewport.
//
// It also creates a real risk: two implementations of the same maths drift. That is closed by
// test, not by hope — `test/smoketest.js` runs both implementations side by side inside the app
// across a sampled grid of frames and fails on any disagreement. If this file is edited, that
// check is the gate.
//
// Conventions inherited from the rest of the app and NOT re-litigated here:
//   * a CFrame is a flat 12-array [x,y,z, r00..r22], same order as Roblox's GetComponents().
//   * a joint track stores a Transform (a delta from rest), except when the track is in 'world'
//     space, where it stores an origin-relative part CFrame ("unparented animation").
//   * Part1World = Part0World * C0 * Transform * C1^-1.

import * as CF from '../cf.js';
import { evalSegment } from '../easing.js';

// ---------------------------------------------------------------- track evaluation
//
// Mirrors state.js evalTrackCF / evalTrackNum exactly, minus the memoisation (the cache there is
// keyed by live track-object identity, which is meaningless for a value that may have come from a
// snapshot). Before the first key and after the last, the value HOLDS — it does not extrapolate.

function segmentAt(keys, t) {
  if (t <= keys[0].t) return { hold: keys[0] };
  if (t >= keys[keys.length - 1].t) return { hold: keys[keys.length - 1] };
  for (let i = 0; i < keys.length - 1; i++) {
    if (t >= keys[i].t && t <= keys[i + 1].t) return { a: keys[i], b: keys[i + 1] };
  }
  // Unreachable for sorted keys; treated as a hold rather than as a throw, because a corrupt key
  // order is the analysis layer's subject matter, not its crash condition.
  return { hold: keys[keys.length - 1] };
}

function alphaFor(a, b, t) {
  const span = b.t - a.t || 1;
  // `span` is passed through so Elastic's frame-relative Period reads the same on a short and a
  // long segment — the same reason state.js passes it.
  return evalSegment(a, (t - a.t) / span, span);
}

/**
 * Evaluate a CFrame track at time `t`. `track` is the raw `{keys:[…]}` object.
 *
 * One deliberate divergence from `state.js`: outside the key range this returns a COPY of the
 * held key's value, where state.js returns the live array. Same numbers either way — the
 * cross-check compares values — but a pure query layer handing out a mutable reference into
 * project data is a bug waiting to be written, and Phase 2 will build patches out of evaluated
 * values.
 */
export function evalTrackCF(track, t, fallback = CF.IDENTITY) {
  if (!track || !track.keys || !track.keys.length) return fallback;
  const seg = segmentAt(track.keys, t);
  if (seg.hold) return Array.isArray(seg.hold.v) ? seg.hold.v.slice() : seg.hold.v;
  return CF.lerp(seg.a.v, seg.b.v, alphaFor(seg.a, seg.b, t));
}

/** Evaluate a numeric track at time `t`. */
export function evalTrackNum(track, t, fallback = 0) {
  if (!track || !track.keys || !track.keys.length) return fallback;
  const seg = segmentAt(track.keys, t);
  if (seg.hold) return seg.hold.v;
  return seg.a.v + (seg.b.v - seg.a.v) * alphaFor(seg.a, seg.b, t);
}

/**
 * The pose of an item at time `t`: `{ [jointName]: transformCF }` for every non-reserved track.
 * Reserved tracks (`@origin`, `@fov`, `@act:…`) are excluded — they are not joint transforms.
 */
export function evalPose(tracks, t) {
  const pose = {};
  if (!tracks) return pose;
  for (const name of Object.keys(tracks)) {
    if (name.startsWith('@')) continue;
    pose[name] = evalTrackCF(tracks[name], t, CF.IDENTITY);
  }
  return pose;
}

/** Joint tracks authored in world ("unparented") space — their values are origin-relative part
 *  CFrames rather than parent-relative transforms. Mirrors state.js `unparentedSet`. */
export function unparentedSet(tracks) {
  const out = new Set();
  if (!tracks) return out;
  for (const [name, tr] of Object.entries(tracks)) {
    if (tr && tr.space === 'world' && !name.startsWith('@')) out.add(name);
  }
  return out;
}

// ---------------------------------------------------------------- solve plan
//
// Mirrors rigbuild.js #computeSolveOrder. The traversal is a repeated sweep rather than a proper
// topological sort because that is what the renderer does, and the two must agree on the order in
// which a malformed rig gets partially solved as much as on the order a well-formed one does.
//
// Two facts encoded here that are easy to get wrong:
//   * `isMotor` is per-PART1, not per-joint: the first non-weld joint claiming a part drives it;
//     any further joint into the same part contributes only its rigid C0/C1 offset.
//   * a part no joint ever reaches keeps a rigid offset from the root, computed from the REST
//     CFrames in the rig definition — not from wherever it happens to be posed.

/** Build the reusable solve plan for a rig. Cheap enough to call per query; cache if profiling says so. */
export function buildSolvePlan(rig) {
  const rootId = rig.rootPart;
  const joints = [], welds = [];
  for (const j of rig.joints || []) (j.kind === 'weld' ? welds : joints).push(j);

  const motorByPart1 = new Map();
  for (const j of joints) if (!motorByPart1.has(j.part1)) motorByPart1.set(j.part1, j);

  const order = [];
  const visited = new Set([rootId]);
  const all = [...joints, ...welds];
  let progress = true;
  while (progress) {
    progress = false;
    for (const j of all) {
      if (visited.has(j.part1) || !visited.has(j.part0)) continue;
      order.push(j);
      visited.add(j.part1);
      progress = true;
    }
  }

  const steps = order.map((j) => ({ j, isMotor: motorByPart1.get(j.part1) === j, c1Inv: CF.inverse(j.c1) }));

  const partById = new Map((rig.parts || []).map((p) => [p.id, p]));
  const rootDef = partById.get(rootId);
  const staticParts = [];
  if (rootDef) {
    const rootInv = CF.inverse(rootDef.cf);
    for (const p of rig.parts || []) {
      if (!visited.has(p.id)) staticParts.push({ id: p.id, rel: CF.mul(rootInv, p.cf) });
    }
  }

  // Parts left unsolvable (no root definition, or a joint chain rooted somewhere unreachable) are
  // reported rather than silently omitted — a caller measuring "where is the left hand" must be
  // able to tell "it did not move" from "it was never solved".
  const unreached = (rig.parts || []).map((p) => p.id).filter((id) => !visited.has(id) && !staticParts.some((s) => s.id === id));

  return { rootId, steps, staticParts, order, partById, unreached, hasRoot: !!rootDef };
}

/**
 * Solve world CFrames for every part. Returns `Map<partId, CFrame>`.
 * Mirrors rigbuild.js #solve, including its behaviour when a parent is missing (the step is
 * skipped, leaving that subtree unsolved, rather than substituting identity and lying about it).
 */
export function solveWorlds(plan, pose, originCF, unparented = null) {
  const out = new Map();
  out.set(plan.rootId, originCF);
  for (const step of plan.steps) {
    const { j, isMotor, c1Inv } = step;
    if (isMotor && unparented && unparented.has(j.name) && pose && pose[j.name]) {
      out.set(j.part1, CF.mul(originCF, pose[j.name]));
      continue;
    }
    const p0World = out.get(j.part0);
    if (!p0World) continue;
    const transform = isMotor ? ((pose && pose[j.name]) || CF.IDENTITY) : CF.IDENTITY;
    out.set(j.part1, CF.mul(CF.mul(CF.mul(p0World, j.c0), transform), c1Inv));
  }
  for (const s of plan.staticParts) out.set(s.id, CF.mul(originCF, s.rel));
  return out;
}

/**
 * The item's own placement at time `t`, resolving attachment recursively.
 *
 * This deliberately re-solves an attached item's PARENT at the same frame rather than reading the
 * parent's current on-screen pose. The live render loop can get away with the latter because
 * every item shares one playhead; a query for an arbitrary frame cannot — app.js's
 * `resolveItemOrigin` carries the same note and the same recursion for the same reason.
 *
 * `seen` guards against an attachment cycle, which the UI prevents but a hand-edited or
 * corrupted project file does not.
 */
export function itemOriginAt(project, item, t, seen = new Set()) {
  if (item.attachedTo && !seen.has(item.id)) {
    seen.add(item.id);
    const parent = (project.items || []).find((i) => i.id === item.attachedTo.itemId);
    if (parent && parent.rig) {
      const parentWorlds = solveItemWorlds(project, parent, t, seen);
      const partWorld = parentWorlds && parentWorlds.get(item.attachedTo.partId);
      if (partWorld) return CF.mul(partWorld, item.attachedTo.offset);
    }
  }
  return evalTrackCF(tracksOf(project, item.id)['@origin'], t, item.origin || CF.IDENTITY);
}

export function tracksOf(project, itemId) {
  return (project.tracks && project.tracks[itemId]) || {};
}

/** World CFrames for every part of `item` at time `t`. Null for an item with no rig. */
export function solveItemWorlds(project, item, t, seen = new Set()) {
  if (!item || !item.rig) return null;
  const tracks = tracksOf(project, item.id);
  const plan = buildSolvePlan(item.rig);
  const pose = evalPose(tracks, t);
  const origin = itemOriginAt(project, item, t, seen);
  return solveWorlds(plan, pose, origin, unparentedSet(tracks));
}

/**
 * The anatomical pivot of a joint in world space: `Part0World * C0`. This is the point the
 * viewport's joint handle sits on, and the correct centre for "how far did the elbow travel".
 * Null when the parent part was not solved.
 */
export function jointPivotWorld(worlds, joint) {
  const p0 = worlds.get(joint.part0);
  return p0 ? CF.mul(p0, joint.c0) : null;
}

// ---------------------------------------------------------------- small geometric helpers
//
// Kept here rather than in cf.js because they are analysis vocabulary, not CFrame algebra, and
// cf.js is depended on by the renderer's hot path.

/** Euclidean distance between two CFrames' positions, in studs. */
export function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Relative rotation angle between two CFrames, in degrees, via trace(A^T·B). */
export function angleBetween(a, b) {
  const trace = (a[3] * b[3] + a[6] * b[6] + a[9] * b[9])
    + (a[4] * b[4] + a[7] * b[7] + a[10] * b[10])
    + (a[5] * b[5] + a[8] * b[8] + a[11] * b[11]);
  return (Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2))) * 180) / Math.PI;
}

/** Axis-aligned bounds of a set of world positions: `{min, max, size, centre}` or null if empty. */
export function boundsOf(positions) {
  if (!positions.length) return null;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of positions) {
    for (let i = 0; i < 3; i++) { if (p[i] < min[i]) min[i] = p[i]; if (p[i] > max[i]) max[i] = p[i]; }
  }
  return {
    min, max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    centre: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
  };
}

/**
 * Every distinct keyframe time on an item, sorted. The natural sampling grid for "where does
 * anything actually change" — cheaper and more honest than sampling every frame, because a frame
 * with no key on any track is fully determined by its neighbours.
 */
export function keyTimesOf(tracks, { includeReserved = false } = {}) {
  const times = new Set();
  for (const [name, tr] of Object.entries(tracks || {})) {
    if (!includeReserved && name.startsWith('@')) continue;
    for (const k of tr.keys || []) times.add(k.t);
  }
  return [...times].sort((a, b) => a - b);
}
