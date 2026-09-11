// The mathematical motion model (directive Part 23), plus the two things Parts 22 and 30 need
// from it: contact drift and chain lead/lag.
//
// Everything else in `ai/` reasons about the project as DATA — which keys exist, what they hold,
// what a patch would change. This module is the first that reasons about the MOTION: it samples
// the forward-kinematic solve on a grid of frames and differentiates it. That is the difference
// between "the shoulder key at frame 8 changed" and "the wrist reaches peak speed four frames
// before the torso contributes".
//
// Four decisions shape the whole file.
//
// 1. **Measurement only.** Part 4.5 — "separate measurement from judgment". Nothing here decides
//    that a motion is bad. `driftExceedsTolerance` is a comparison against a number the USER
//    declared; the classification of an unexplained jerk spike is `unclassified`, never `defect`.
//    The judging lives in `ai/diagnose.js`, which is where a reader can see what it rests on.
//
// 2. **A sample grid is uniform, finite and declared.** Derivatives are finite differences, and a
//    non-uniform grid makes the second and third ones quietly wrong. So the grid is always
//    `from … to` at a constant `step`, it is capped, and the cap is REPORTED — an analysis that
//    silently looked at a third of the range is worse than one that refuses.
//
// 3. **Contact drift is measured against the effector's own position at the contact's first
//    frame.** Cadence has no ground plane, no collision surface and no world target, so there is
//    nothing else to measure against. That is stated in every result rather than hidden behind a
//    plausible number: a contact that was already sliding when it was declared reads as clean.
//
// 4. **Angular speed is unsigned.** It comes from `angleBetween`, which is the magnitude of a
//    relative rotation. That is enough to find an onset and a peak; it cannot tell a reversal from
//    a continuation, and `MEASUREMENTS` says so.
//
// This module is pure at load like the rest of `ai/`: plain data in, plain data out, no renderer.

import * as ids from './ids.js';
import * as roles from './roles.js';
import { ROLE } from './roles.js';
import * as K from './kinematics.js';
import { resolve as resolveSemantic } from './select.js';
import { CERTAINTY, evidence, finding, coverage } from './certainty.js';

/** The largest number of frames one call will sample. A 60-frame clip at step 1 is 61 samples;
 *  the cap exists for a caller that asks for a 10 000-frame range, and it is always reported. */
export const MAX_SAMPLES = 601;

/** Below this the frame-to-frame travel is not motion, it is float noise in the FK solve. */
const STILL_STUDS_PER_FRAME = 1e-4;
const STILL_DEG_PER_FRAME = 1e-3;

/** An onset is the first frame a subject reaches this fraction of its OWN peak. Relative rather
 *  than absolute, because a wrist and a pelvis in the same swing differ by an order of magnitude
 *  and an absolute threshold would report the pelvis as never starting. */
const ONSET_FRACTION = 0.1;

// ---------------------------------------------------------------- what Part 23 asks for
//
// Same pattern as `CHECKS` in ai/constraints.js and `PASSES` in ai/observe.js, for the same
// reason: a measurement this build cannot make is listed, named and given its obstacle. A caller
// reading `MEASUREMENTS` can see the shape of the gap without inferring it from an absent field.

export const MEASUREMENTS = Object.freeze({
  position: { implemented: true, unit: 'studs (world)', from: 'the FK solve at each sampled frame' },
  rotation: { implemented: true, unit: 'degrees from the rest orientation', from: 'the FK solve' },
  linear_velocity: { implemented: true, unit: 'studs/frame', from: 'central difference of position' },
  angular_velocity: { implemented: true, unit: 'degrees/frame (unsigned)', from: 'relative rotation angle between neighbouring samples' },
  acceleration: { implemented: true, unit: 'studs/frame²', from: 'second central difference of position' },
  angular_acceleration: { implemented: true, unit: 'degrees/frame² (unsigned)', from: 'difference of angular speed' },
  jerk: { implemented: true, unit: 'studs/frame³', from: 'central difference of acceleration' },
  path_curvature: { implemented: true, unit: '1/studs', from: 'Menger curvature of three neighbouring positions' },
  orientation_change: { implemented: true, unit: 'degrees', from: 'total unsigned rotation across the sampled range' },
  key_density: { implemented: true, unit: 'keys/frame', from: 'the track key times inside the range' },
  interpolation_type: { implemented: true, unit: 'easing style/direction per key', from: 'the keys themselves' },
  distance_to_contact_target: { implemented: true, unit: 'studs', from: 'measureContactDrift — see its own caveat about what the target is' },
  relation_to_motion_graph_parent: { implemented: true, unit: 'frames of lead/lag', from: 'analyseChain — onset and peak frame per link' },

  screen_space_velocity: {
    implemented: false,
    unblocked_by: 'MOT-006 — a screen-space measurement needs an active camera with a projection, and Cadence has camera ITEMS but no notion of which one is live (SEM-021, Phase 6)',
  },
  screen_space_acceleration: {
    implemented: false,
    unblocked_by: 'MOT-006 — same missing camera model',
  },
  tangent_continuity: {
    implemented: false,
    unblocked_by: 'nothing in this phase: Cadence keys carry an easing STYLE and DIRECTION, not tangent vectors (SEM-015), so there is no tangent whose continuity could be measured. What IS measurable — a curvature or acceleration discontinuity at a key — is reported instead, and is a different claim',
  },
  distance_to_expected_arc: {
    implemented: false,
    unblocked_by: 'there is no expected-arc model (Part 26.7 — KNW-003, Phase 8). `bow_studs` is measured instead: how far the path departs from the straight chord between its endpoints. That DESCRIBES the path; it does not say the arc is wrong',
  },
  relation_to_reference_motion: {
    implemented: false,
    unblocked_by: 'not the reference itself — ai/reference.js builds a Part 36 profile and ai/library.js compares two of them (relativeDistance, 3 numeric dimensions). What is missing is here: sampleMotion measures ONE item and never subtracts a second one\'s samples, so a per-frame "how far is this from the reference at frame 12" does not exist. Use store_reference_profile + search_library nearItemId for the profile-level answer',
  },
});

// ---------------------------------------------------------------- sample grid

/**
 * Build the uniform sample grid, and say what it left out.
 *
 * `frameRange` defaults to the item's own first-to-last key time, because sampling outside the key
 * range measures a hold — real, but rarely the question.
 */
export function sampleGrid(project, itemId, { frameRange = null, step = 1 } = {}) {
  const tracks = K.tracksOf(project, itemId);
  const times = K.keyTimesOf(tracks);
  let from, to;
  if (Array.isArray(frameRange) && frameRange.length === 2) {
    from = Math.min(frameRange[0], frameRange[1]);
    to = Math.max(frameRange[0], frameRange[1]);
  } else if (times.length) {
    [from, to] = [times[0], times[times.length - 1]];
  } else {
    from = 0; to = 0;
  }
  const h = step > 0 ? step : 1;
  const wanted = Math.floor((to - from) / h) + 1;
  const n = Math.min(Math.max(wanted, 1), MAX_SAMPLES);
  const frames = [];
  for (let i = 0; i < n; i++) frames.push(+(from + i * h).toFixed(6));
  return {
    frames,
    step: h,
    from,
    to,
    // A truncated grid is a different question from the one that was asked, so it is named.
    truncated: wanted > MAX_SAMPLES
      ? `frames ${+(from + n * h).toFixed(6)}–${to} were NOT sampled: the range asked for ${wanted} samples and the cap is ${MAX_SAMPLES}. Raise \`step\` or narrow \`frameRange\``
      : null,
  };
}

// ---------------------------------------------------------------- the core sampler

/**
 * Sample the world motion of one or more rig parts.
 *
 * @param opts.itemId     the rig item
 * @param opts.partIds    which parts, or null for every contact-capable part plus the root
 * @param opts.frameRange `[from, to]`, or null for the item's key range
 * @param opts.step       frames between samples (default 1)
 *
 * Returns one entry per subject with a per-frame series and a summary, plus the coverage that
 * says which frames were genuinely looked at.
 */
export function sampleMotion(project, { itemId, partIds = null, frameRange = null, step = 1 } = {}) {
  const item = (project.items || []).find((i) => i.id === itemId);
  if (!item) throw new TypeError(`sampleMotion: no item "${itemId}"`);
  if (!item.rig) throw new TypeError(`sampleMotion: item "${itemId}" has no rig, and motion is measured on rig parts`);

  const grid = sampleGrid(project, itemId, { frameRange, step });
  const chosen = subjectParts(project, item, partIds);

  // One FK solve per frame serves every subject — solving per part would be N times the work for
  // the same numbers.
  const series = new Map(chosen.map((s) => [s.part.id, []]));
  const unsolved = new Set();
  for (const t of grid.frames) {
    const worlds = K.solveItemWorlds(project, item, t);
    for (const s of chosen) {
      const w = worlds && worlds.get(s.part.id);
      if (w) series.get(s.part.id).push({ t, cf: w });
      else unsolved.add(s.part.id);
    }
  }

  const subjects = chosen.map((s) => {
    const raw = series.get(s.part.id);
    return {
      entity_id: ids.partId(item.id, s.part.id),
      part_id: s.part.id,
      name: s.part.name || s.part.id,
      role: s.role.role,
      side: s.role.side,
      contact_capable: roles.isContactCapable(s.role.role),
      ...derive(raw, grid.step),
    };
  });

  return {
    item: { id: item.id, name: item.name, entity_id: ids.itemId(item) },
    fps: project.fps ?? null,
    range: [grid.from, grid.to],
    step: grid.step,
    subjects,
    key_density: keyDensity(project, itemId, grid.from, grid.to),
    interpolation: interpolationTypes(project, itemId, grid.from, grid.to),
    measurements: MEASUREMENTS,
    coverage: coverage({
      scope: `${subjects.length} part(s) of "${item.name}" over frames ${grid.from}–${grid.to} at step ${grid.step}`,
      frames: grid.frames,
      loop: 'full',
      notRun: [
        ...(grid.truncated ? [grid.truncated] : []),
        ...(unsolved.size ? [`${[...unsolved].join(', ')} could not be solved at every frame and their series are short — the FK solve reports an unreachable part rather than substituting identity`] : []),
        'no screen-space velocity or acceleration: there is no active-camera model (MOT-006)',
        'no distance to an EXPECTED arc: no expected-arc model exists (Part 26.7). `bow_studs` describes the path, it does not judge it',
        'no comparison against a reference motion (REF-001)',
        'nothing here decides whether the motion is good — see explain_motion_problem for the judging layer, and what it rests on',
      ],
    }),
  };
}

function subjectParts(project, item, partIds) {
  const out = [];
  for (const p of item.rig.parts || []) {
    const role = roles.partRole(project, item, p);
    if (partIds) {
      if (partIds.includes(p.id)) out.push({ part: p, role });
      continue;
    }
    // The default subject set is what a motion question is usually about: the effectors that can
    // touch the world, plus the root that carries the whole body. Sampling all 15 R15 parts by
    // default would bury those in a wall of numbers.
    if (roles.isContactCapable(role.role) || role.role === ROLE.ROOT || role.role === ROLE.HIPS) out.push({ part: p, role });
  }
  if (!out.length) {
    for (const p of item.rig.parts || []) out.push({ part: p, role: roles.partRole(project, item, p) });
  }
  return out;
}

/**
 * Finite differences over the sampled series.
 *
 * Interior points use central differences; the two ends use one-sided ones and are FLAGGED, because
 * a one-sided derivative at a boundary is systematically different from its neighbours and reading
 * an end spike as a pop is one of the easier mistakes to make with this data.
 */
function derive(raw, h) {
  const n = raw.length;
  if (!n) {
    return { samples: [], summary: { samples: 0, reason: 'the part was never solved at any sampled frame' } };
  }
  const pos = raw.map((r) => [r.cf[0], r.cf[1], r.cf[2]]);
  const speed = new Array(n).fill(null);
  const angSpeed = new Array(n).fill(null);
  const accel = new Array(n).fill(null);
  const angAccel = new Array(n).fill(null);
  const jerk = new Array(n).fill(null);
  const curvature = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    const a = i > 0 ? i - 1 : i;
    const b = i < n - 1 ? i + 1 : i;
    const span = (b - a) * h;
    speed[i] = span > 0 ? dist(pos[a], pos[b]) / span : 0;
    angSpeed[i] = span > 0 ? K.angleBetween(raw[a].cf, raw[b].cf) / span : 0;
  }
  for (let i = 1; i < n - 1; i++) {
    // Second central difference of position, taken component-wise then normed: the magnitude of
    // the acceleration VECTOR, not the change in speed. A part rounding a corner at constant speed
    // is accelerating, and the two differ exactly where it matters.
    const v = [0, 0, 0];
    for (let k = 0; k < 3; k++) v[k] = (pos[i + 1][k] - 2 * pos[i][k] + pos[i - 1][k]) / (h * h);
    accel[i] = Math.hypot(v[0], v[1], v[2]);
    angAccel[i] = Math.abs(angSpeed[i + 1] - angSpeed[i - 1]) / (2 * h);
    curvature[i] = menger(pos[i - 1], pos[i], pos[i + 1]);
  }
  for (let i = 2; i < n - 2; i++) jerk[i] = Math.abs(accel[i + 1] - accel[i - 1]) / (2 * h);

  const samples = raw.map((r, i) => ({
    t: r.t,
    position: pos[i].map(r6),
    speed: r6(speed[i]),
    angular_speed_deg: r6(angSpeed[i]),
    acceleration: accel[i] === null ? null : r6(accel[i]),
    angular_acceleration_deg: angAccel[i] === null ? null : r6(angAccel[i]),
    jerk: jerk[i] === null ? null : r6(jerk[i]),
    curvature: curvature[i] === null ? null : r6(curvature[i]),
    // Part 15 again: an end sample is not the same measurement as an interior one.
    boundary: i === 0 || i === n - 1,
  }));

  let path = 0;
  for (let i = 1; i < n; i++) path += dist(pos[i - 1], pos[i]);
  let rotTotal = 0;
  for (let i = 1; i < n; i++) rotTotal += K.angleBetween(raw[i - 1].cf, raw[i].cf);

  const peak = pickPeak(speed, raw);
  const angPeak = pickPeak(angSpeed, raw);

  return {
    samples,
    summary: {
      samples: n,
      path_length_studs: r6(path),
      displacement_studs: r6(dist(pos[0], pos[n - 1])),
      bow_studs: r6(bow(pos)),
      orientation_change_deg: r6(rotTotal),
      peak_speed: peak.value === null ? null : r6(peak.value),
      peak_speed_frame: peak.t,
      peak_angular_speed_deg: angPeak.value === null ? null : r6(angPeak.value),
      peak_angular_speed_frame: angPeak.t,
      onset_frame: onsetFrame(speed, angSpeed, raw),
      onset_rule: `the first sampled frame at or above ${ONSET_FRACTION * 100}% of this subject's own peak (linear or angular), which is relative on purpose — an absolute threshold reports a pelvis as never starting`,
      still: path <= STILL_STUDS_PER_FRAME * Math.max(1, n - 1) && rotTotal <= STILL_DEG_PER_FRAME * Math.max(1, n - 1),
    },
  };
}

function pickPeak(series, raw) {
  let best = null, at = null;
  for (let i = 0; i < series.length; i++) {
    if (series[i] === null) continue;
    if (best === null || series[i] > best) { best = series[i]; at = raw[i].t; }
  }
  return { value: best, t: at };
}

function onsetFrame(speed, angSpeed, raw) {
  const peakL = Math.max(0, ...speed.filter((x) => x !== null));
  const peakA = Math.max(0, ...angSpeed.filter((x) => x !== null));
  if (peakL <= STILL_STUDS_PER_FRAME && peakA <= STILL_DEG_PER_FRAME) return null;
  const tl = peakL * ONSET_FRACTION, ta = peakA * ONSET_FRACTION;
  for (let i = 0; i < raw.length; i++) {
    if ((speed[i] !== null && peakL > STILL_STUDS_PER_FRAME && speed[i] >= tl)
      || (angSpeed[i] !== null && peakA > STILL_DEG_PER_FRAME && angSpeed[i] >= ta)) return raw[i].t;
  }
  return null;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const r6 = (x) => (x === null || x === undefined ? null : +Number(x).toFixed(6));

/** Menger curvature through three points: 1/R of the circle they define. Null when they are
 *  collinear or coincident, which is the honest answer — a straight line has no radius. */
function menger(a, b, c) {
  const ab = dist(a, b), bc = dist(b, c), ca = dist(c, a);
  if (ab < 1e-9 || bc < 1e-9 || ca < 1e-9) return null;
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const area = 0.5 * Math.hypot(cross[0], cross[1], cross[2]);
  if (area < 1e-12) return 0;
  return (4 * area) / (ab * bc * ca);
}

/** The path's greatest perpendicular departure from the chord between its endpoints. NOT
 *  "deviation from the expected arc" — there is no expected arc here, and conflating the two is
 *  how a measurement starts sounding like a verdict. */
function bow(pos) {
  const n = pos.length;
  if (n < 3) return 0;
  const a = pos[0], b = pos[n - 1];
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  let worst = 0;
  for (let i = 1; i < n - 1; i++) {
    const p = pos[i];
    if (len < 1e-9) { worst = Math.max(worst, dist(a, p)); continue; }
    const w = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const cross = [w[1] * d[2] - w[2] * d[1], w[2] * d[0] - w[0] * d[2], w[0] * d[1] - w[1] * d[0]];
    worst = Math.max(worst, Math.hypot(cross[0], cross[1], cross[2]) / len);
  }
  return worst;
}

// ---------------------------------------------------------------- key density and interpolation

/** Part 23's `key density`, per track and overall, inside the range. */
export function keyDensity(project, itemId, from, to) {
  const tracks = K.tracksOf(project, itemId);
  const span = Math.max(1e-9, to - from);
  const per = [];
  let total = 0;
  for (const [name, tr] of Object.entries(tracks)) {
    if (name.startsWith('@')) continue;
    const inRange = (tr.keys || []).filter((k) => k.t >= from - 1e-6 && k.t <= to + 1e-6);
    total += inRange.length;
    per.push({ track: name, keys: inRange.length, keys_per_frame: r6(inRange.length / span), gaps: gapsOf(inRange) });
  }
  return {
    range: [from, to],
    total_keys: total,
    keys_per_frame: r6(total / span),
    per_track: per.sort((a, b) => b.keys - a.keys),
  };
}

function gapsOf(keys) {
  const g = [];
  for (let i = 1; i < keys.length; i++) g.push(+(keys[i].t - keys[i - 1].t).toFixed(6));
  return g;
}

/** Part 23's `interpolation type`, counted. Tangent continuity is NOT here — see MEASUREMENTS. */
export function interpolationTypes(project, itemId, from, to) {
  const tracks = K.tracksOf(project, itemId);
  const counts = {};
  let bezier = 0, stepped = 0;
  for (const [name, tr] of Object.entries(tracks)) {
    if (name.startsWith('@')) continue;
    for (const k of tr.keys || []) {
      if (k.t < from - 1e-6 || k.t > to + 1e-6) continue;
      const label = `${k.es || 'Linear'}/${k.ed || 'InOut'}`;
      counts[label] = (counts[label] || 0) + 1;
      if (k.bez) bezier++;
      if (k.es === 'Constant' || k.es === 'None') stepped++;
    }
  }
  return {
    by_style: counts,
    custom_bezier_keys: bezier,
    stepped_keys: stepped,
    tangent_continuity: null,
    tangent_continuity_reason: MEASUREMENTS.tangent_continuity.unblocked_by,
  };
}

// ---------------------------------------------------------------- MOT-008: contact drift

/**
 * How far a declared contact effector actually travelled while it was supposed to be planted.
 *
 * @param spec.itemId     the rig
 * @param spec.effector   a part id, a part name, or a semantic phrase ("the left foot")
 * @param spec.start/end  the contact's frame range
 * @param spec.tolerance_studs   the declared positional tolerance
 * @param spec.rotational_tolerance_deg  optional
 * @param spec.mode       Part 20.5's contact mode — a `sliding` contact is measured and NOT judged
 * @param spec.target     an explicit world position to hold, if the caller has one
 *
 * The reference is the effector's own world position at `start` unless `target` is given. Cadence
 * has no ground plane and no collision surface, so there is nothing external to measure against;
 * saying that plainly is the difference between a measurement and a guess wearing a unit.
 */
export function measureContactDrift(project, spec = {}) {
  const item = (project.items || []).find((i) => i.id === spec.itemId);
  if (!item || !item.rig) {
    return notMeasured(spec, `no rig item "${spec.itemId}" — contact drift is measured on a rig part`);
  }
  const eff = resolveEffector(project, item, spec.effector);
  if (!eff.part) return notMeasured(spec, eff.reason, eff.question);

  const from = Number.isFinite(spec.start) ? spec.start : null;
  const to = Number.isFinite(spec.end) ? spec.end : null;
  if (from === null || to === null) {
    return notMeasured(spec, 'the contact declares no frame range, and drift is only defined over one');
  }
  const grid = sampleGrid(project, item.id, { frameRange: [from, to], step: spec.step ?? 1 });

  const samples = [];
  for (const t of grid.frames) {
    const worlds = K.solveItemWorlds(project, item, t);
    const w = worlds && worlds.get(eff.part.id);
    if (w) samples.push({ t, cf: w });
  }
  if (!samples.length) {
    return notMeasured(spec, `"${eff.part.name || eff.part.id}" could not be solved at any frame in ${from}–${to}`);
  }

  const ref = Array.isArray(spec.target) && spec.target.length >= 3
    ? { kind: 'declared_target', position: spec.target.slice(0, 3).map(r6) }
    : { kind: 'effector_at_first_frame', position: [samples[0].cf[0], samples[0].cf[1], samples[0].cf[2]].map(r6) };
  const refRot = samples[0].cf;

  const series = samples.map((s) => ({
    t: s.t,
    position: [s.cf[0], s.cf[1], s.cf[2]].map(r6),
    drift_studs: r6(dist([s.cf[0], s.cf[1], s.cf[2]], ref.position)),
    rotation_deg: r6(K.angleBetween(refRot, s.cf)),
  }));

  const worst = series.reduce((a, b) => (b.drift_studs > a.drift_studs ? b : a));
  const worstRot = series.reduce((a, b) => (b.rotation_deg > a.rotation_deg ? b : a));
  const mean = r6(series.reduce((a, s) => a + s.drift_studs, 0) / series.length);
  const tol = Number.isFinite(spec.tolerance_studs) ? spec.tolerance_studs : null;
  const rotTol = Number.isFinite(spec.rotational_tolerance_deg) ? spec.rotational_tolerance_deg : null;

  const within = tol === null ? null : worst.drift_studs <= tol + 1e-9;
  const rotWithin = rotTol === null ? null : worstRot.rotation_deg <= rotTol + 1e-9;

  // Part 20.5's modes. A sliding or glancing contact is EXPECTED to move; measuring it is still
  // useful, but calling the movement a violation would be reporting the animator's own plan back
  // at them as a defect.
  const mode = spec.mode || 'planted';
  const judgeable = mode === 'planted' || mode === 'gripping';

  const ev = [
    evidence('measurement', `"${eff.part.name || eff.part.id}" is ${worst.drift_studs} stud(s) from its contact reference at frame ${worst.t}`, { max_drift_studs: worst.drift_studs, at_frame: worst.t, mean_drift_studs: mean }),
    evidence('data', 'the contact as declared', { mode, start: from, end: to, tolerance_studs: tol }),
    evidence('assumption', `the contact point is ${ref.kind === 'declared_target' ? 'the target the caller supplied' : `where the effector was at frame ${samples[0].t}`}`, 'Cadence has no ground plane or collision surface, so there is no external surface to measure against. A contact that was ALREADY sliding when it was declared reads as clean'),
  ];

  const exceeded = tol !== null && within === false;
  const f = finding({
    id: exceeded ? 'CONTACT-DRIFT-EXCEEDED' : 'CONTACT-DRIFT',
    // The number is deterministic; how sure we are that it MEANS a broken contact inherits the
    // certainty of how the effector was identified. A semantic phrase resolved as "highly likely"
    // cannot produce a "certain" verdict about a foot nobody named.
    certainty: eff.certainty,
    statement: tol === null
      ? `"${eff.part.name || eff.part.id}" moved at most ${worst.drift_studs} stud(s) between frames ${from} and ${to}; no tolerance was declared, so nothing was judged`
      : exceeded
        ? `"${eff.part.name || eff.part.id}" drifts ${worst.drift_studs} stud(s) at frame ${worst.t}, past the declared ${tol}-stud tolerance for a ${mode} contact on frames ${from}–${to}`
        : `"${eff.part.name || eff.part.id}" stays within ${tol} stud(s) of its contact point across frames ${from}–${to} (worst ${worst.drift_studs} at frame ${worst.t})`,
    evidence: ev,
    target: ids.partId(item.id, eff.part.id),
    frame: worst.t,
    suggestion: exceeded && judgeable
      ? { text: `the drift begins at frame ${firstBreach(series, tol)}; a scoped rollback of the transaction that moved this leg, or a counter-key on the ankle at that frame, are the two narrow corrections`, reversible: true }
      : null,
  });

  return {
    measured: true,
    item: { id: item.id, name: item.name },
    effector: {
      entity_id: ids.partId(item.id, eff.part.id),
      part_id: eff.part.id,
      name: eff.part.name || eff.part.id,
      role: eff.role,
      side: eff.side,
      how_identified: eff.how,
      certainty: eff.certainty,
    },
    mode,
    judgeable,
    range: [from, to],
    reference: ref,
    samples: series,
    max_drift_studs: worst.drift_studs,
    max_drift_frame: worst.t,
    mean_drift_studs: mean,
    first_breach_frame: tol === null ? null : firstBreach(series, tol),
    tolerance_studs: tol,
    within_tolerance: within,
    exceeded_by_studs: exceeded ? r6(worst.drift_studs - tol) : null,
    max_rotation_deg: worstRot.rotation_deg,
    max_rotation_frame: worstRot.t,
    rotational_tolerance_deg: rotTol,
    rotation_within_tolerance: rotWithin,
    findings: [f],
    coverage: coverage({
      scope: `world travel of "${eff.part.name || eff.part.id}" over frames ${from}–${to}`,
      frames: series.map((s) => s.t),
      loop: 'full',
      notRun: [
        ...(grid.truncated ? [grid.truncated] : []),
        ...(tol === null ? ['no tolerance was declared, so the drift was measured and NOT judged'] : []),
        ...(judgeable ? [] : [`the contact mode is "${mode}", which is expected to move — the drift is reported, not treated as a violation`]),
        'no ground plane and no collision surface exist in Cadence, so the contact point is the effector\'s own position, not a surface',
        'whether the contact was DECLARED correctly in the first place is not checked — a contact declared over the wrong frames measures clean',
      ],
    }),
  };
}

function firstBreach(series, tol) {
  for (const s of series) if (s.drift_studs > tol + 1e-9) return s.t;
  return null;
}

function notMeasured(spec, reason, question = null) {
  return {
    measured: false,
    reason,
    question,
    effector: null,
    max_drift_studs: null,
    within_tolerance: null,
    findings: [],
    coverage: coverage({
      scope: `contact on ${spec.effector ?? 'an unnamed effector'}`,
      frames: null,
      loop: 'fast',
      notRun: [`contact drift was NOT measured: ${reason}`],
    }),
  };
}

/**
 * A part id, a part name, or a semantic phrase, in that order of preference.
 *
 * The order matters: an exact part id is `certain`, and a phrase resolved by `ai/select.js` carries
 * whatever certainty the resolution earned — often `highly_likely` for "the planted foot", which
 * is a measurement of intent and not a fact.
 */
export function resolveEffector(project, item, effector) {
  if (!effector) return { part: null, reason: 'no effector was named' };
  if (typeof effector === 'object' && effector.partId) {
    const p = (item.rig.parts || []).find((q) => q.id === effector.partId);
    return p
      ? { part: p, ...roleOf(project, item, p), how: 'part id', certainty: CERTAINTY.CERTAIN }
      : { part: null, reason: `"${effector.partId}" is not a part of "${item.name}"` };
  }
  const text = String(effector);
  const byId = (item.rig.parts || []).find((q) => q.id === text);
  if (byId) return { part: byId, ...roleOf(project, item, byId), how: 'part id', certainty: CERTAINTY.CERTAIN };
  const byName = (item.rig.parts || []).find((q) => (q.name || '').toLowerCase() === text.toLowerCase());
  if (byName) return { part: byName, ...roleOf(project, item, byName), how: 'part name', certainty: CERTAINTY.CERTAIN };

  const r = resolveSemantic(project, text, { itemId: item.id });
  if (!r.resolved) {
    return { part: null, reason: `"${text}" did not resolve to a part of "${item.name}": ${r.interpretation}`, question: r.question };
  }
  const m = r.matches.find((x) => x.kind === 'part') || r.matches[0];
  const parsed = ids.parseId(m.entityId);
  const p = parsed && (item.rig.parts || []).find((q) => q.id === parsed.partId);
  if (!p) {
    return { part: null, reason: `"${text}" resolved to ${m.entityId}, which is not a part of "${item.name}" — drift is measured on a part` };
  }
  return { part: p, ...roleOf(project, item, p), how: `semantic phrase "${text}"`, certainty: m.certainty };
}

function roleOf(project, item, part) {
  const r = roles.partRole(project, item, part);
  return { role: r.role, side: r.side };
}

// ---------------------------------------------------------------- MOT-009: chain lead/lag

/**
 * Part 22's first Motion Graph question, and the one its own example is about: does the body drive
 * the limb, or does the limb lead the body?
 *
 * The chain is a list of JOINT track names in the order they are expected to fire. When the caller
 * does not give one, it is derived from `roles.chainDepth` — root-most first — and that derivation
 * is reported as an ASSUMPTION, because Part 22 is explicit that a whip crack, an isolated finger
 * gesture and a nonhuman creature may legitimately violate it.
 *
 * What comes back is per-link: each joint's onset frame, its peak frame, and the lag from its
 * parent in the chain. An inversion (a child starting before its parent) is REPORTED with the
 * numbers; whether it is wrong is a judgement, and `ai/diagnose.js` is where that is made and
 * labelled.
 */
export function analyseChain(project, { itemId, chain = null, frameRange = null, step = 1 } = {}) {
  const item = (project.items || []).find((i) => i.id === itemId);
  if (!item) throw new TypeError(`analyseChain: no item "${itemId}"`);
  if (!item.rig) throw new TypeError(`analyseChain: item "${itemId}" has no rig`);

  const tracks = K.tracksOf(project, itemId);
  const grid = sampleGrid(project, itemId, { frameRange, step });

  const links = (chain && chain.length ? chain.map((n) => ({ name: n })) : derivedChain(project, item, tracks))
    .filter((l) => tracks[l.name] && (tracks[l.name].keys || []).length);

  if (links.length < 2) {
    return {
      item: { id: item.id, name: item.name },
      chain_source: chain && chain.length ? 'caller' : 'derived from rig depth',
      links: [],
      inversions: [],
      findings: [],
      coverage: coverage({
        scope: `lead/lag on "${item.name}"`,
        frames: grid.frames,
        loop: 'fast',
        notRun: [`fewer than two animated joints in the chain, so there is no lead/lag relationship to measure${chain ? '' : ' — pass `chain` explicitly if the derivation missed the joints you meant'}`],
      }),
    };
  }

  // The joint's own rotation track is what "when did this joint contribute" means. Measuring the
  // world motion of its child part would answer a different question: a wrist carried along by a
  // moving shoulder has world velocity while contributing nothing.
  const measured = links.map((l) => {
    const series = grid.frames.map((t) => ({ t, cf: K.evalTrackCF(tracks[l.name], t) }));
    const ang = series.map((s, i) => {
      const a = i > 0 ? i - 1 : i;
      const b = i < series.length - 1 ? i + 1 : i;
      const span = (b - a) * grid.step;
      return span > 0 ? K.angleBetween(series[a].cf, series[b].cf) / span : 0;
    });
    const peak = Math.max(0, ...ang);
    const threshold = peak * ONSET_FRACTION;
    let onset = null, peakAt = null;
    for (let i = 0; i < series.length; i++) {
      if (onset === null && peak > STILL_DEG_PER_FRAME && ang[i] >= threshold) onset = series[i].t;
      if (ang[i] === peak) peakAt ??= series[i].t;
    }
    const jr = jointRoleFor(project, item, l.name);
    return {
      joint: l.name,
      role: jr.role,
      side: jr.side,
      depth: l.depth ?? roles.chainDepth(jr.role),
      onset_frame: onset,
      peak_frame: peak > STILL_DEG_PER_FRAME ? peakAt : null,
      peak_deg_per_frame: r6(peak),
      total_rotation_deg: r6(ang.reduce((a, b) => a + b, 0) * grid.step),
      moves: peak > STILL_DEG_PER_FRAME,
    };
  });

  const inversions = [];
  for (let i = 1; i < measured.length; i++) {
    const parent = measured[i - 1], child = measured[i];
    if (!parent.moves || !child.moves) continue;
    if (parent.onset_frame === null || child.onset_frame === null) continue;
    const lag = r6(child.onset_frame - parent.onset_frame);
    child.lag_from_parent_frames = lag;
    child.parent_joint = parent.joint;
    if (lag < 0) {
      inversions.push({
        parent: parent.joint,
        child: child.joint,
        parent_onset: parent.onset_frame,
        child_onset: child.onset_frame,
        lead_frames: r6(-lag),
        parent_peak: parent.peak_frame,
        child_peak: child.peak_frame,
      });
    }
  }

  const findings = inversions.map((inv) => finding({
    id: 'CHAIN-INVERSION',
    // Never `certain`: the ordering this is measured against is a convention about body-driven
    // motion, not a property of the project. Part 22 names four legitimate exceptions.
    certainty: CERTAINTY.POSSIBLE,
    statement: `"${inv.child}" starts moving ${inv.lead_frames} frame(s) BEFORE "${inv.parent}", which is the reverse of the root-first order a body-driven action is usually built on`,
    evidence: [
      evidence('measurement', `${inv.parent} onset frame ${inv.parent_onset}, peak frame ${inv.parent_peak}`),
      evidence('measurement', `${inv.child} onset frame ${inv.child_onset}, peak frame ${inv.child_peak}`),
      evidence('assumption', 'a body-driven action propagates root → extremity', 'Part 22 lists whip cracks, isolated gestures, comedic double-takes and nonhuman anatomy as legitimate exceptions. Nothing in the project declares which this is'),
    ],
    target: ids.trackId(item.id, inv.child),
    frame: inv.child_onset,
  }));

  return {
    item: { id: item.id, name: item.name },
    chain_source: chain && chain.length ? 'caller' : 'derived from rig depth (roles.chainDepth), root-most first, midline joints plus the side with the most animated joints',
    range: [grid.from, grid.to],
    links: measured,
    inversions,
    findings,
    coverage: coverage({
      scope: `onset and peak of ${measured.length} joint(s) on "${item.name}" over frames ${grid.from}–${grid.to}`,
      frames: grid.frames,
      loop: 'full',
      notRun: [
        ...(grid.truncated ? [grid.truncated] : []),
        ...(chain && chain.length ? [] : ['the expected ORDER was assumed from rig depth, not read from a plan — no MotionPlan declares a propagation order yet (SEM-020)']),
        'amplitude and direction relationships between links are not compared, only timing (Part 22 asks for four edge properties; this measures one)',
        'nothing here decides that an inversion is wrong — Part 22 names four kinds of motion where it is correct',
      ],
    }),
  };
}

/**
 * The default chain: the midline joints plus ONE side's, root-most first.
 *
 * Mixing a left leg and a right arm into one chain would produce lag numbers between joints that
 * have no propagation relationship at all — a left hip "leading" a right elbow is not a finding,
 * it is two unrelated actions read as one. So the side with the most animated joints wins, and the
 * other side is left out. The result names its own side, and a caller who meant the other one
 * passes `chain` explicitly.
 */
function derivedChain(project, item, tracks) {
  const all = [];
  for (const name of Object.keys(tracks)) {
    if (name.startsWith('@')) continue;
    const j = (item.rig.joints || []).find((q) => q.name === name);
    if (!j) continue;
    const jr = roles.jointRole(project, item, j);
    const depth = roles.chainDepth(jr.role);
    if (depth === null) continue;
    all.push({ name, depth, side: jr.side });
  }
  const counts = { left: 0, right: 0 };
  for (const l of all) if (l.side === 'left' || l.side === 'right') counts[l.side]++;
  const dominant = counts.right >= counts.left ? 'right' : 'left';
  const picked = all.filter((l) => l.side !== 'left' && l.side !== 'right' ? true : l.side === dominant);
  return picked.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));
}

function jointRoleFor(project, item, trackName) {
  const j = (item.rig.joints || []).find((q) => q.name === trackName);
  if (!j) return { role: ROLE.UNKNOWN, side: null };
  return roles.jointRole(project, item, j);
}

// ---------------------------------------------------------------- MOT-010: noise vs signal

/**
 * Part 23's noise-and-signal policy, as a classifier that is honest about how little it can settle.
 *
 * "Never label motion as bad simply because it deviates from smoothness." The directive lists nine
 * kinds of variation. This build can separate exactly three of them from the rest, because each
 * has a mark in the project data:
 *
 *   stylised_hold        two neighbouring keys hold the same value
 *   stepped              the key's easing is Constant/None, so the discontinuity is authored
 *   impact_discontinuity a marker sits on the frame — the animator named the moment
 *
 * Everything else comes back `unclassified`, which is a real answer: a jerk spike with no authored
 * mark on it might be accidental jitter, procedural detail, or an interpolation artefact, and
 * nothing in a Cadence project distinguishes them. Reporting it as a defect would be the exact
 * failure Part 23 warns about.
 */
export const VARIATION_KINDS = Object.freeze({
  stylised_hold: { distinguishable: true, mark: 'two neighbouring keys hold the same value' },
  stepped: { distinguishable: true, mark: 'the key easing is Constant/None' },
  impact_discontinuity: { distinguishable: true, mark: 'a shot-event marker sits on the frame' },
  controlled_asymmetry: { distinguishable: false, needs: 'a comparison against the mirror side over the same span, and a declared intent to be asymmetric (MOT-015)' },
  procedural_secondary: { distinguishable: false, needs: 'a procedural rig behaviour to attribute it to; Cadence has none on the animation side (PHY-002)' },
  simulation_detail: { distinguishable: false, needs: 'a simulation to attribute it to (PHY-002)' },
  numerical_noise: { distinguishable: false, needs: 'a magnitude floor tied to the solve\'s precision; the FK solve is deterministic here, so anything above the still threshold is authored, not numerical' },
  accidental_jitter: { distinguishable: false, needs: 'the animator\'s intent. It is indistinguishable in the data from deliberate texture (POL-002)' },
  interpolation_artefact: { distinguishable: false, needs: 'a tangent model; Cadence keys carry easing style and direction, not tangents (SEM-015)' },
});

/**
 * Classify a frame at which something discontinuous happens.
 * Returns `{ kind, certainty, why }`. `kind` is only ever one of the three distinguishable
 * classes or `unclassified`.
 */
export function classifyVariation(project, itemId, track, t) {
  const tracks = K.tracksOf(project, itemId);
  const keys = (tracks[track] && tracks[track].keys) || [];
  const at = keys.find((k) => Math.abs(k.t - t) < 0.5);

  if (at && (at.es === 'Constant' || at.es === 'None')) {
    return { kind: 'stepped', certainty: CERTAINTY.CERTAIN, why: `the key at frame ${at.t} is stepped (${at.es}), so the discontinuity is authored` };
  }
  if (at) {
    const i = keys.indexOf(at);
    const same = (a, b) => (Array.isArray(a.v) && Array.isArray(b.v)
      ? K.angleBetween(a.v, b.v) < 1e-6 && Math.hypot(a.v[0] - b.v[0], a.v[1] - b.v[1], a.v[2] - b.v[2]) < 1e-6
      : a.v === b.v);
    if ((i > 0 && same(keys[i - 1], at)) || (i < keys.length - 1 && same(keys[i + 1], at))) {
      return { kind: 'stylised_hold', certainty: CERTAINTY.CERTAIN, why: `the key at frame ${at.t} repeats its neighbour's value, which is a deliberate hold` };
    }
  }
  const markers = (project.markers && project.markers[itemId]) || [];
  const m = markers.find((x) => Math.abs(x.t - t) <= (x.width ?? 0) / 2 + 0.5);
  if (m) {
    return { kind: 'impact_discontinuity', certainty: CERTAINTY.HIGHLY_LIKELY, why: `the shot event "${m.name || 'marker'}" is on frame ${m.t}, so a discontinuity here was named by the animator` };
  }
  return {
    kind: 'unclassified',
    certainty: CERTAINTY.POSSIBLE,
    why: 'no authored mark explains this frame: it is not stepped, not a held key, and no marker names it. Accidental jitter, procedural detail and an interpolation artefact are indistinguishable in Cadence project data, so this is NOT called a defect',
  };
}

// ---------------------------------------------------------------- limitations

export function motionLimitations() {
  const implemented = Object.entries(MEASUREMENTS).filter(([, m]) => m.implemented).map(([k]) => k);
  const blocked = Object.entries(MEASUREMENTS).filter(([, m]) => !m.implemented);
  return {
    summary: `${implemented.length} of Part 23's ${Object.keys(MEASUREMENTS).length} listed quantities are measured; ${blocked.length} are not`,
    measured: implemented,
    not_measured: blocked.map(([k, m]) => ({ measurement: k, unblocked_by: m.unblocked_by })),
    cannot: [
      'decide that a motion is bad. Every number here is a measurement; the judging is in ai/diagnose.js and says what it rests on',
      'measure against a ground plane, a collision surface or any world geometry — Cadence has none, so a contact reference is the effector\'s own position',
      'tell accidental jitter from deliberate texture: see VARIATION_KINDS, 3 of Part 23\'s 9 variation kinds are distinguishable and 6 are not',
      'sign an angular velocity — it is the magnitude of a relative rotation, so a reversal and a continuation look alike',
      'measure centre of mass, balance or support polygon (MOT-011 — part mass is unknown)',
      'compare two characters, or a character against a reference clip (REF-001)',
    ],
    variation_kinds: VARIATION_KINDS,
  };
}
