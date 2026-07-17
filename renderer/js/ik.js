// Inverse kinematics: position a limb's end part and the joints up the chain auto-adjust.
// CCD (cyclic coordinate descent) in joint-pivot space over the existing Motor6D structures —
// no separate skeleton representation. Works on any rig the solver can pose, including
// custom-imported ones, because the chain is read straight from rig.joints.
import * as CF from './cf.js';
import * as S from './state.js';

// Apply a CFrame to a 3D point (rotate + translate — CF.mul composes frames, this maps points).
function applyToPoint(cf, p) {
  const [x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22] = cf;
  return [
    r00 * p[0] + r01 * p[1] + r02 * p[2] + x,
    r10 * p[0] + r11 * p[1] + r12 * p[2] + y,
    r20 * p[0] + r21 * p[1] + r22 * p[2] + z,
  ];
}

// Rotation-only CFrame taking unit vector a to unit vector b (shortest arc), with the step
// optionally clamped — a small per-iteration cap keeps CCD from snapping/flipping on big drags.
function rotationBetween(a, b, maxStep = Math.PI) {
  const la = Math.hypot(a[0], a[1], a[2]);
  const lb = Math.hypot(b[0], b[1], b[2]);
  if (la < 1e-6 || lb < 1e-6) return null;
  const ax = a[0] / la, ay = a[1] / la, az = a[2] / la;
  const bx = b[0] / lb, by = b[1] / lb, bz = b[2] / lb;
  const dot = Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz));
  let angle = Math.acos(dot);
  if (angle < 1e-4) return null;
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const nl = Math.hypot(nx, ny, nz);
  if (nl < 1e-6) {
    // exactly opposite vectors — pick any perpendicular axis
    const [px, py, pz] = Math.abs(ax) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    nx = ay * pz - az * py; ny = az * px - ax * pz; nz = ax * py - ay * px;
    const l2 = Math.hypot(nx, ny, nz) || 1;
    nx /= l2; ny /= l2; nz /= l2;
  } else {
    nx /= nl; ny /= nl; nz /= nl;
  }
  angle = Math.min(angle, maxStep);
  const s = Math.sin(angle / 2);
  return CF.fromQuatPos([nx * s, ny * s, nz * s, Math.cos(angle / 2)], 0, 0, 0);
}

// The motor-joint chain from `endPartId` upward (tip joint first), stopping at the root part,
// a branch with no motor, or `maxJoints`. R15 hand → [Wrist, Elbow, Shoulder] at the default 3.
export function buildChain(item, endPartId, maxJoints = 3) {
  const rig = item.rig;
  if (!rig) return [];
  const byPart1 = new Map();
  for (const j of rig.joints || []) {
    if (j.kind !== 'weld') byPart1.set(j.part1, j);
  }
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

// Solve the chain toward a world-space target point. Returns { pose, error, chain } where `pose`
// holds ONLY the chain joints' new Transforms (ready for overlayPose or setKey), `error` is the
// final end-effector→target distance in studs. Pure: mutates nothing, renders nothing.
export function solveIK(inst, item, endPartId, targetPos, opts = {}) {
  const chain = buildChain(item, endPartId, opts.chainLength ?? S.state.ikChainLength ?? 3);
  if (!chain.length || !inst?.solvePoseWorlds) return null;
  const iterations = opts.iterations ?? 12;
  const tolerance = opts.tolerance ?? 0.03;
  const origin = opts.origin || item.origin || CF.IDENTITY;
  const pose = { ...(opts.basePose || S.evalPose(item, opts.frame ?? S.state.playhead)) };
  const unparented = opts.unparented;

  const endDistance = (worlds) => {
    const end = worlds.get(endPartId);
    return Math.hypot(end[0] - targetPos[0], end[1] - targetPos[1], end[2] - targetPos[2]);
  };

  let worlds = inst.solvePoseWorlds(pose, origin, unparented);
  for (let it = 0; it < iterations; it++) {
    // Tip-first CCD: each joint rotates (about its own pivot, in pivot space) to swing the
    // current end-effector position toward the target, then the pass repeats.
    for (const j of chain) {
      const end = worlds.get(endPartId);
      const p0World = worlds.get(j.part0);
      if (!end || !p0World) continue;
      const pivotInv = CF.inverse(CF.mul(p0World, j.c0));
      const e = applyToPoint(pivotInv, [end[0], end[1], end[2]]);
      const t = applyToPoint(pivotInv, targetPos);
      const R = rotationBetween(e, t, opts.maxStep ?? 0.9);
      if (!R) continue;
      pose[j.name] = CF.orthonormalize(CF.mul(R, pose[j.name] || CF.IDENTITY.slice()));
      worlds = inst.solvePoseWorlds(pose, origin, unparented);
    }
    if (endDistance(worlds) < tolerance) break;
  }

  const out = {};
  for (const j of chain) out[j.name] = pose[j.name] || CF.IDENTITY.slice();
  return { pose: out, error: endDistance(worlds), chain: chain.map((j) => j.name) };
}
