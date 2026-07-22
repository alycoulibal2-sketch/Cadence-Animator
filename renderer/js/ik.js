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
      const R = CF.rotationBetween(e, t, opts.maxStep ?? 0.9);
      if (!R) continue;
      pose[j.name] = CF.orthonormalize(CF.mul(R, pose[j.name] || CF.IDENTITY.slice()));
      worlds = inst.solvePoseWorlds(pose, origin, unparented);
    }
    if (endDistance(worlds) < tolerance) break;
  }

  // Optional orientation control: the tip-most joint (chain[0], whose part1 === endPartId) is the
  // only one whose rotation can change endPartId's FACING/ROLL without moving its already-solved
  // POSITION — rotating about the exact axis from that joint's own pivot to the current
  // end-effector position leaves every point ON that axis fixed, and the end-effector position is
  // one such point. This is a real, but limited, notion of "orientation-aware IK": it controls
  // twist/roll around the reach direction (e.g. which way a gripped item's edge faces), not
  // arbitrary 3-axis facing — a chain built for position-reaching doesn't have spare degrees of
  // freedom for full independent orientation matching.
  if (opts.twistDeg) {
    const tipJoint = chain[0];
    const p0World = worlds.get(tipJoint.part0);
    const end = worlds.get(endPartId);
    if (p0World && end) {
      const pivotCF = CF.mul(p0World, tipJoint.c0);
      const pivotPos = CF.position(pivotCF);
      const axisWorld = [end[0] - pivotPos[0], end[1] - pivotPos[1], end[2] - pivotPos[2]];
      const axisLocal = CF.rotateVector(CF.inverse(pivotCF), axisWorld);
      const Rtwist = CF.axisAngle(axisLocal, (opts.twistDeg * Math.PI) / 180);
      pose[tipJoint.name] = CF.orthonormalize(CF.mul(Rtwist, pose[tipJoint.name] || CF.IDENTITY.slice()));
      worlds = inst.solvePoseWorlds(pose, origin, unparented);
    }
  }

  const out = {};
  for (const j of chain) out[j.name] = pose[j.name] || CF.IDENTITY.slice();
  return { pose: out, error: endDistance(worlds), chain: chain.map((j) => j.name) };
}
