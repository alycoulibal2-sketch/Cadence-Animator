// Animation quality heuristics exposed to the MCP server, so Claude can find problems by
// asking a tool instead of eyeballing every frame the way a human has to.
import * as S from './state.js';

function isOrthonormal(cf) {
  const [, , , r00, r01, r02, r10, r11, r12, r20, r21, r22] = cf;
  const col0 = [r00, r10, r20], col1 = [r01, r11, r21], col2 = [r02, r12, r22];
  const len = (v) => Math.hypot(v[0], v[1], v[2]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.abs(len(col0) - 1) < 0.05 && Math.abs(len(col1) - 1) < 0.05 && Math.abs(len(col2) - 1) < 0.05
    && Math.abs(dot(col0, col1)) < 0.05 && Math.abs(dot(col0, col2)) < 0.05 && Math.abs(dot(col1, col2)) < 0.05;
}

// Relative rotation angle (degrees) between two CFrames' rotation parts, via trace(A^T * B).
function angleBetweenRotations(a, b) {
  const [, , , a00, a01, a02, a10, a11, a12, a20, a21, a22] = a;
  const [, , , b00, b01, b02, b10, b11, b12, b20, b21, b22] = b;
  const trace = (a00 * b00 + a10 * b10 + a20 * b20) + (a01 * b01 + a11 * b11 + a21 * b21) + (a02 * b02 + a12 * b12 + a22 * b22);
  const cosAngle = Math.max(-1, Math.min(1, (trace - 1) / 2));
  return (Math.acos(cosAngle) * 180) / Math.PI;
}

const POP_ANGLE_DEG = 35;   // per-frame rotation change beyond this reads as a pop, not motion
const POP_POS_STUDS = 3;    // per-frame position jump beyond this reads as a pop
const SAMPLE_STEP = 1;      // frames

const HINGE_DOMINANCE_THRESHOLD = 0.5; // arccos(0.5) = 60° off rest — comfortable margin from both
                                         // the 0.09 (broken) and 0.93 (fixed) real measurements below

// Generic/rig-agnostic: walks item.rig.joints by part0/part1 links (same technique ik.js's
// buildChain uses), so it applies to R6/R15/Rthro/RthroSlender or any custom rig without
// hardcoding joint names. By this project's rig convention a joint's own bend axis is local X (its
// C0/C1 rotation is identity on every built-in rig, verified directly against rigs/builtin.json),
// so rotating [1,0,0] through a joint's CFrame and dotting the result with [1,0,0] again reduces to
// exactly that CFrame's r00 (flat-12 index 3) — a plain single-axis-X hinge (an elbow/knee bending
// however far) always keeps r00 at 1 and can never trigger this, while a ball-and-socket joint
// (shoulder/hip) keyed with real Y/Z rotation at the same time can twist a CHILD joint's own bend
// axis into a wrong direction — the exact bug class a numerically-clean pose can otherwise hide.
// Measured empirically: a real broken shoulder pose scored ~0.09 here; the fixed version scored
// ~0.93. Weakest on custom-imported rigs whose C0/C1 aren't identity (FBX/GLB bone-derived joints)
// — same "warn, don't assert" caveat class check_collision's AABB approach already carries.
function checkHingeAxisMisalignment(item, tracks, findings) {
  const joints = item.rig.joints || [];
  for (const j of joints) {
    if (j.kind === 'weld') continue;
    const tr = tracks[j.name];
    if (!tr || !tr.keys.length) continue;
    const children = joints.filter((k) => k.kind !== 'weld' && k.part0 === j.part1);
    if (!children.length) continue;
    for (const k of tr.keys) {
      if (!Array.isArray(k.v) || k.v.length !== 12 || !isOrthonormal(k.v)) continue; // degenerate_cframe already flags this
      const dominance = k.v[3];
      if (dominance < HINGE_DOMINANCE_THRESHOLD) {
        const angleOff = (Math.acos(Math.max(-1, Math.min(1, dominance))) * 180) / Math.PI;
        findings.push({
          severity: 'warn', type: 'hinge_axis_misalignment', track: j.name, frame: k.t,
          message: `"${j.name}" at frame ${k.t} swings its own local-X axis ~${angleOff.toFixed(0)}° off rest. Downstream joint(s) may visibly twist as a result (e.g. a curl reading as a sideways swing): ${children.map((c) => c.name).join(', ')}. Usually caused by keying more than one rotation axis at once on a ball-and-socket-style joint — check the render, or use solve_ik/compute_swing_twist instead of a hand-composed rotation.`,
        });
      }
    }
  }
}

// Returns { findings: [{severity, type, track, frame, message}], summary }
export function validateAnimation(itemId) {
  const item = S.getItem(itemId);
  if (!item) return { error: `No item with id ${itemId}` };
  const findings = [];
  const tracks = S.getTracks(itemId);
  const trackNames = Object.keys(tracks).filter((n) => !n.startsWith('@'));
  const length = S.state.project.length;

  for (const tn of trackNames) {
    const tr = tracks[tn];
    if (!tr.keys.length) continue;

    for (const k of tr.keys) {
      if (Array.isArray(k.v) && k.v.length === 12 && !isOrthonormal(k.v)) {
        findings.push({
          severity: 'error', type: 'degenerate_cframe', track: tn, frame: k.t,
          message: `"${tn}" keyframe at frame ${k.t} has a corrupted (non-orthonormal) rotation — likely bad data, not just a fast move.`,
        });
      }
    }

    if (tr.keys.length < 2) continue;
    let prevCf = null;
    const first = tr.keys[0].t, last = tr.keys[tr.keys.length - 1].t;
    for (let f = Math.floor(first); f <= Math.ceil(last); f += SAMPLE_STEP) {
      const cf = S.evalTrackCF(itemId, tn, f);
      if (prevCf) {
        const angleDeg = angleBetweenRotations(prevCf, cf);
        const posDelta = Math.hypot(cf[0] - prevCf[0], cf[1] - prevCf[1], cf[2] - prevCf[2]);
        if (angleDeg > POP_ANGLE_DEG) {
          findings.push({
            severity: 'warn', type: 'rotation_pop', track: tn, frame: f,
            message: `"${tn}" rotates ${angleDeg.toFixed(0)}° in one frame near frame ${f} — check for a pop.`,
          });
        }
        if (posDelta > POP_POS_STUDS) {
          findings.push({
            severity: 'warn', type: 'position_pop', track: tn, frame: f,
            message: `"${tn}" moves ${posDelta.toFixed(1)} studs in one frame near frame ${f} — check for a pop.`,
          });
        }
      }
      prevCf = cf;
    }
  }

  if (item.rig) {
    const animated = new Set(trackNames.filter((tn) => tracks[tn].keys.length > 0));
    const allJoints = (item.rig.joints || []).filter((j) => j.kind !== 'weld').map((j) => j.name);
    const neverAnimated = allJoints.filter((n) => !animated.has(n));
    if (neverAnimated.length && animated.size > 0) {
      findings.push({
        severity: 'info', type: 'unanimated_joints', joints: neverAnimated,
        message: `These joints have no keyframes at all: ${neverAnimated.join(', ')}. Intentional (e.g. a static prop hand) or forgotten?`,
      });
    }
    checkHingeAxisMisalignment(item, tracks, findings);
  }

  const endTimes = trackNames.map((tn) => tracks[tn].keys[tracks[tn].keys.length - 1]?.t ?? 0);
  const maxEnd = Math.max(0, ...endTimes);
  if (maxEnd < length - 1 && maxEnd > 0) {
    findings.push({
      severity: 'info', type: 'trailing_hold', frame: maxEnd,
      message: `Last keyframe is at frame ${maxEnd} but the animation is ${length} frames long — the pose holds static for the remaining ${length - maxEnd} frames.`,
    });
  }

  return {
    findings,
    summary: findings.length
      ? `${findings.filter((f) => f.severity === 'error').length} error(s), ${findings.filter((f) => f.severity === 'warn').length} warning(s), ${findings.filter((f) => f.severity === 'info').length} note(s)`
      : 'No issues found',
  };
}
