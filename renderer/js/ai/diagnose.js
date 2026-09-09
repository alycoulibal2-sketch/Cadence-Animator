// "Why?" diagnostics (directive Part 46), built on the Part 23 measurements in `ai/motion.js`.
//
// Part 43's observation layer answered "what is different, and who changed it". Part 46 asks a
// harder question: "why is this motion wrong". The difference is attribution — not which
// transaction touched a track, but which JOINT is responsible for a foot that slides.
//
// Three rules hold this module together.
//
// 1. **A cause is proved by a counterfactual, not by proximity.** "The knee rotated during the
//    contact window" is a coincidence; "holding the knee at its frame-12 value removes 87% of the
//    drift" is a cause. `attributeDrift` re-solves the rig with one joint frozen at a time and
//    ranks by how much of the measured drift each one owns. That is cheap here — the FK solve is
//    pure and takes a project object — and it is the only evidence in this file strong enough to
//    carry a `certain` label.
//
// 2. **Measurement and judgement stay apart** (Part 4.5). Every number comes from `ai/motion.js`.
//    What this module adds is the ranking and the recommendation, and each one says what it rests
//    on. A drift within its declared tolerance is reported as clean; a drift with no declared
//    tolerance is reported as unjudged, not as fine.
//
// 3. **A workflow that does not exist is listed, not omitted.** `DIAGNOSTICS` carries all seven of
//    Part 46's workflows. Two are implemented here, two are routed to the tool that already
//    answers them, and three are named with what blocks each. Copying `CHECKS` in
//    `ai/constraints.js` deliberately.
//
// Pure at load, like everything else under `ai/`.

import * as ids from './ids.js';
import * as K from './kinematics.js';
import * as MOTION from './motion.js';
import { CERTAINTY, coverage, evidence, finding, sortFindings } from './certainty.js';

/** Part 46's list, verbatim, with what each one actually is in this build. */
export const DIAGNOSTICS = Object.freeze({
  why_is_this_contact_unstable: {
    implemented: true,
    args: 'itemId, effector, start, end, tolerance_studs, mode?',
    summary: 'measures the drift, then attributes it to the joint that owns it by freezing each ancestor in turn',
  },
  why_is_this_motion_bad: {
    implemented: true,
    args: 'itemId, frame, joint',
    summary: 'measures speed, acceleration and jerk around the frame, and classifies any discontinuity against Part 23\'s noise-and-signal policy before calling anything wrong',
  },
  why_is_this_frame_different: {
    implemented: false,
    routed_to: 'explain_change',
    summary: 'this is Part 44/45\'s question and `explain_change` answers it against a baseline with real rasters. Duplicating it here would produce a second, weaker answer',
  },
  why_did_this_object_move: {
    implemented: false,
    routed_to: 'explain_change',
    summary: 'the object-ID pass plus the transaction ledger already answer this, with pixels. See EXP-001',
  },
  why_did_this_effect_change: {
    implemented: false,
    unblocked_by: 'VFX-009 — the PNX studio owns its own document and undo stack, and no observation pass sees an effect item (Part 43 tier 4, Phase 6)',
  },
  why_does_this_animation_feel_light: {
    implemented: false,
    unblocked_by: 'PHY-001 and STY-001. Part 46\'s own worked example compares the centre-of-mass shift against "the chosen reference profile" — Cadence has neither a centre of mass (MOT-011: part mass is unknown) nor a style profile to compare against. Amplitude and contact firmness ARE measurable now, and `analyze_motion` returns them; turning those into "feels light" is the judgement that is missing, and guessing it would be exactly the "reads heavier because a number went up" failure the acceptance registry exists to prevent',
  },
  why_does_the_camera_hide_the_impact: {
    implemented: false,
    unblocked_by: 'SHOT-002 and SHOT-004 — there is no active-camera model, no framing model, and no shot-event timeline (Phase 6)',
  },
});

/**
 * Part 46's required response shape. Every diagnostic returns this, so a caller never has to work
 * out which fields a particular question happens to fill.
 *
 * The eight fields are the directive's own list. `user_question` is null when the diagnostic could
 * decide on its own — an always-present question trains a reader to ignore it.
 */
function response({
  question, header, observed_facts = [], referenced_plan = [], dependencies = [],
  likely_causes = [], certainty, next_checks = [], recommended_action = null,
  user_question = null, findings = [], coverage: cov, measurements = null,
}) {
  return {
    question,
    header,
    observed_facts,
    referenced_plan,
    dependencies,
    likely_causes,
    confidence: certainty,
    next_checks,
    recommended_action,
    user_question,
    findings: sortFindings(findings),
    measurements,
    coverage: cov,
  };
}

/** Dispatch. An unknown or unimplemented question is refused BY NAME with its obstacle. */
export function diagnose(project, args = {}) {
  const q = args.question;
  const def = DIAGNOSTICS[q];
  if (!def) {
    throw new TypeError(`diagnose: no diagnostic named "${q}". Part 46's workflows are: ${Object.keys(DIAGNOSTICS).join(', ')}`);
  }
  if (!def.implemented) {
    return response({
      question: q,
      header: def.routed_to
        ? `"${q}" is answered by \`${def.routed_to}\`, not here`
        : `"${q}" is not implemented`,
      certainty: CERTAINTY.USER_INTENT_REQUIRED,
      next_checks: def.routed_to ? [`call \`${def.routed_to}\``] : [],
      coverage: coverage({
        scope: q,
        frames: null,
        loop: 'fast',
        notRun: [`${q}: ${def.routed_to ? def.summary : def.unblocked_by}`],
      }),
    });
  }
  if (q === 'why_is_this_contact_unstable') return whyIsThisContactUnstable(project, args);
  return whyIsThisMotionBad(project, args);
}

// ---------------------------------------------------------------- contact instability

/**
 * The Phase 5 keystone question: a declared contact drifts — which joint did it?
 *
 * Steps, in the order Part 46 asks for them:
 *   1. measure the drift (ai/motion.js, MOT-008);
 *   2. if it is inside tolerance, say so and stop — a clean contact is an answer;
 *   3. otherwise freeze each ancestor joint in turn and re-measure, which attributes the drift;
 *   4. rank the causes by how much drift each one owns;
 *   5. name the non-destructive checks and the narrowest correction.
 */
export function whyIsThisContactUnstable(project, args = {}) {
  const drift = MOTION.measureContactDrift(project, args);
  const q = 'why_is_this_contact_unstable';

  if (!drift.measured) {
    return response({
      question: q,
      header: `the contact could not be measured: ${drift.reason}`,
      certainty: CERTAINTY.USER_INTENT_REQUIRED,
      user_question: drift.question,
      coverage: drift.coverage,
    });
  }

  const item = (project.items || []).find((i) => i.id === args.itemId);
  const facts = [
    `"${drift.effector.name}" is ${drift.max_drift_studs} stud(s) from its contact reference at frame ${drift.max_drift_frame}`,
    `the contact is declared ${drift.mode} over frames ${drift.range[0]}–${drift.range[1]}${drift.tolerance_studs === null ? ' with no tolerance' : ` with a ${drift.tolerance_studs}-stud tolerance`}`,
    `mean drift across the window is ${drift.mean_drift_studs} stud(s); the effector also rotates ${drift.max_rotation_deg}° at frame ${drift.max_rotation_frame}`,
  ];

  if (drift.tolerance_studs === null) {
    return response({
      question: q,
      header: `"${drift.effector.name}" moves ${drift.max_drift_studs} stud(s) during the declared contact, and no tolerance was declared to judge that against`,
      observed_facts: facts,
      certainty: CERTAINTY.USER_INTENT_REQUIRED,
      next_checks: ['declare a positional tolerance on the contact and ask again'],
      user_question: `How far may "${drift.effector.name}" move and still count as ${drift.mode}? Without a tolerance the drift is a number, not a defect.`,
      findings: drift.findings,
      measurements: { drift },
      coverage: drift.coverage,
    });
  }

  if (drift.within_tolerance) {
    return response({
      question: q,
      header: `the contact is stable: "${drift.effector.name}" stays within ${drift.tolerance_studs} stud(s) across frames ${drift.range[0]}–${drift.range[1]}`,
      observed_facts: facts,
      certainty: drift.effector.certainty,
      next_checks: [
        `if the contact LOOKS wrong anyway, the reference is the effector's own position at frame ${drift.range[0]} — check that the contact starts on the frame you meant`,
        'create_baseline then explain_change at the worst frame, which is the only thing here that looks at pixels',
      ],
      findings: drift.findings,
      measurements: { drift },
      coverage: drift.coverage,
    });
  }

  if (!drift.judgeable) {
    return response({
      question: q,
      header: `"${drift.effector.name}" moves ${drift.max_drift_studs} stud(s), but the contact mode is "${drift.mode}", which is expected to move`,
      observed_facts: facts,
      certainty: CERTAINTY.POSSIBLE,
      next_checks: [`re-declare the contact as \`planted\` if it was meant to hold still, then ask again`],
      user_question: `Was this contact meant to be ${drift.mode}? A ${drift.mode} contact is not judged against a positional tolerance here.`,
      findings: drift.findings,
      measurements: { drift },
      coverage: drift.coverage,
    });
  }

  const attribution = attributeDrift(project, item, drift, args);

  const causes = attribution.candidates.map((c) => ({
    cause: c.label,
    kind: c.kind,
    target: c.entity_id,
    // The counterfactual number IS the ranking. Nothing here is ranked by plausibility.
    share_of_drift: c.share,
    residual_drift_studs: c.residual_studs,
    certainty: c.share >= 0.5 ? CERTAINTY.CERTAIN : CERTAINTY.HIGHLY_LIKELY,
    distinguishing_evidence: `freezing ${c.label} at its frame-${drift.range[0]} value leaves ${c.residual_studs} stud(s) of the original ${drift.max_drift_studs}`,
  }));

  const top = causes[0] || null;
  const facts2 = [
    ...facts,
    `the drift first passes tolerance at frame ${drift.first_breach_frame}`,
    ...(top ? [`freezing ${top.cause} removes ${Math.round(top.share_of_drift * 100)}% of it`] : []),
    ...(attribution.unattributed > 1e-4 ? [`${attribution.unattributed} stud(s) are not explained by any single ancestor — the joints combine, so the shares do not sum to 1`] : []),
  ];

  const f = finding({
    id: 'CONTACT-UNSTABLE',
    // The measurement is deterministic and so is the counterfactual, so a dominant single cause is
    // `certain`. It is still capped by how the effector was identified: a foot picked out by a
    // semantic phrase cannot produce a certain verdict about a foot nobody named.
    certainty: top && top.share_of_drift >= 0.5 && drift.effector.certainty === CERTAINTY.CERTAIN
      ? CERTAINTY.CERTAIN
      : CERTAINTY.HIGHLY_LIKELY,
    statement: top
      ? `the ${drift.mode} contact on "${drift.effector.name}" breaks at frame ${drift.first_breach_frame}; ${top.cause} owns ${Math.round(top.share_of_drift * 100)}% of the ${drift.max_drift_studs}-stud drift`
      : `the ${drift.mode} contact on "${drift.effector.name}" breaks at frame ${drift.first_breach_frame}, and no single ancestor joint owns the drift`,
    evidence: [
      evidence('measurement', `drift ${drift.max_drift_studs} studs at frame ${drift.max_drift_frame}, tolerance ${drift.tolerance_studs}`, { exceeded_by_studs: drift.exceeded_by_studs }),
      ...causes.slice(0, 3).map((c) => evidence('measurement', c.distinguishing_evidence, { share: c.share_of_drift })),
      evidence('assumption', 'the contact point is the effector\'s own position at the first frame of the contact', 'Cadence has no ground plane'),
    ],
    target: drift.effector.entity_id,
    frame: drift.first_breach_frame,
    suggestion: top
      ? { text: `hold ${top.cause} across frames ${drift.range[0]}–${drift.range[1]}, or roll back the transaction that last wrote to it — preview_animation_patch will show the drift before committing`, reversible: true }
      : null,
  });

  return response({
    question: q,
    header: top
      ? `"${drift.effector.name}" slides ${drift.max_drift_studs} stud(s) during a ${drift.mode} contact; ${top.cause} is responsible for most of it`
      : `"${drift.effector.name}" slides ${drift.max_drift_studs} stud(s) during a ${drift.mode} contact, and the cause is distributed across the chain`,
    observed_facts: facts2,
    referenced_plan: [
      `the contact itself: ${drift.mode}, frames ${drift.range[0]}–${drift.range[1]}, tolerance ${drift.tolerance_studs} stud(s)`,
      'Part 30 contact locking: "report a conflict rather than silently breaking the contact"',
    ],
    dependencies: attribution.candidates.map((c) => c.entity_id),
    likely_causes: causes,
    certainty: f.certainty,
    next_checks: [
      `analyze_motion on ${attribution.candidates.slice(0, 3).map((c) => c.label).join(', ') || 'the leg chain'} over frames ${drift.range[0]}–${drift.range[1]}`,
      `inspect_provenance for the transaction that last wrote ${top ? top.cause : 'these tracks'}`,
      `create_baseline at frame ${drift.range[0]} then explain_change at frame ${drift.max_drift_frame} — none of the above looks at a pixel`,
    ],
    recommended_action: top
      ? {
        text: `preview_animation_patch holding ${top.cause} at its frame-${drift.range[0]} value across the contact window`,
        reversible: true,
        destructive: false,
        // A recommendation is not an instruction to act. Part 13: nothing acts on its own here.
        requires_user_approval: true,
      }
      : null,
    user_question: top ? null : `The drift is spread across ${attribution.candidates.length} joints, so there is no single narrow correction. Should the whole leg be rolled back over frames ${drift.range[0]}–${drift.range[1]}, or was this slide intentional?`,
    findings: [f, ...drift.findings],
    measurements: { drift, attribution },
    coverage: coverage({
      scope: `contact drift on "${drift.effector.name}" over frames ${drift.range[0]}–${drift.range[1]}, attributed across ${attribution.candidates.length} ancestor(s)`,
      frames: drift.samples.map((s) => s.t),
      loop: 'full',
      notRun: [
        ...drift.coverage.notRun,
        'the attribution freezes one joint at a time, so a drift produced only by two joints in combination is reported as unattributed rather than split between them',
        'nothing visual was checked: this is a kinematic measurement, and a foot can be geometrically planted and still read wrong on screen',
      ],
    }),
  });
}

/**
 * Freeze each ancestor of the effector in turn and re-measure. The reduction in peak drift is that
 * joint's share.
 *
 * `@origin` is included and matters: Part 30 lists "handle changes in root motion" as its own case,
 * and a foot that slides because the whole character was translated is a completely different fix
 * from a foot that slides because the knee bent.
 */
export function attributeDrift(project, item, drift, args) {
  const chain = ancestorMotors(item, drift.effector.part_id);
  const tracks = K.tracksOf(project, item.id);
  const t0 = drift.range[0];

  const candidates = [];
  for (const c of chain) {
    if (!tracks[c.track] || !(tracks[c.track].keys || []).length) continue;
    const held = holdTrack(project, item.id, c.track, t0);
    const re = MOTION.measureContactDrift(held, args);
    if (!re.measured) continue;
    const residual = re.max_drift_studs;
    const share = drift.max_drift_studs > 1e-9 ? Math.max(0, (drift.max_drift_studs - residual) / drift.max_drift_studs) : 0;
    candidates.push({
      kind: c.kind,
      label: c.kind === 'root_motion' ? 'the item\'s @origin (root motion)' : `"${c.track}"`,
      track: c.track,
      entity_id: ids.trackId(item.id, c.track),
      residual_studs: +residual.toFixed(6),
      share: +share.toFixed(4),
    });
  }
  candidates.sort((a, b) => b.share - a.share);
  const kept = candidates.filter((c) => c.share > 1e-4);
  const best = kept[0];
  return {
    method: 'counterfactual: each ancestor track is held at its value on the contact\'s first frame and the drift is re-measured',
    candidates: kept,
    considered: candidates.length,
    unattributed: best ? +Math.max(0, best.residual_studs).toFixed(6) : +drift.max_drift_studs.toFixed(6),
  };
}

/** The motor joints between the root and this part, root-most first, plus `@origin`. */
export function ancestorMotors(item, partId) {
  const joints = item.rig.joints || [];
  const motorByPart1 = new Map();
  for (const j of joints) if (j.kind !== 'weld' && !motorByPart1.has(j.part1)) motorByPart1.set(j.part1, j);

  const upward = [];
  const seen = new Set();
  let cur = partId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const j = motorByPart1.get(cur);
    if (!j) break;
    upward.push({ kind: 'joint', track: j.name, part1: j.part1 });
    cur = j.part0;
  }
  upward.reverse();
  return [{ kind: 'root_motion', track: '@origin' }, ...upward];
}

/** A project in which one track holds a single value. Structurally shared with the original
 *  everywhere else, because nothing downstream mutates a project. */
function holdTrack(project, itemId, trackName, t) {
  const tracks = K.tracksOf(project, itemId);
  const tr = tracks[trackName];
  if (!tr) return project;
  const v = Array.isArray((tr.keys || [])[0]?.v) ? K.evalTrackCF(tr, t) : K.evalTrackNum(tr, t);
  return {
    ...project,
    tracks: { ...project.tracks, [itemId]: { ...tracks, [trackName]: { ...tr, keys: [{ t, v }] } } },
  };
}

// ---------------------------------------------------------------- "why is this motion bad"

/**
 * Part 46's `why_is_this_motion_bad(frame, joint)`.
 *
 * The important half of this is the refusal: before anything is called a problem, the frame is run
 * through Part 23's noise-and-signal policy (`motion.classifyVariation`). A stepped key, a held
 * pose and a marked impact are all discontinuities the animator authored, and reporting them as
 * defects is exactly what "never label motion as bad simply because it deviates from smoothness"
 * forbids.
 */
/** How many times the window's median acceleration counts as a discontinuity, and the absolute
 *  floor below which a ratio is meaningless. Both are declared conventions, reported as such, and
 *  neither turns a measurement into a defect on its own — the noise-and-signal policy runs first. */
export const SPIKE_RATIO = 4;
export const NOTABLE_ACCEL = 0.01;

export function whyIsThisMotionBad(project, args = {}) {
  const q = 'why_is_this_motion_bad';
  const { itemId, joint, frame } = args;
  const item = (project.items || []).find((i) => i.id === itemId);
  if (!item || !item.rig) throw new TypeError(`whyIsThisMotionBad: no rig item "${itemId}"`);
  if (!Number.isFinite(frame)) throw new TypeError('whyIsThisMotionBad: a frame is required');

  const jointDef = (item.rig.joints || []).find((j) => j.name === joint);
  if (!jointDef) {
    return response({
      question: q,
      header: `"${joint}" is not a joint of "${item.name}"`,
      certainty: CERTAINTY.CERTAIN,
      user_question: `Which joint? "${item.name}" has ${(item.rig.joints || []).length} joint(s).`,
      coverage: coverage({ scope: `${itemId}/${joint} @ ${frame}`, frames: null, loop: 'fast', notRun: [`nothing was measured: "${joint}" does not exist on this rig`] }),
    });
  }

  const radius = Number.isFinite(args.radius) ? args.radius : 6;
  const sampled = MOTION.sampleMotion(project, {
    itemId,
    partIds: [jointDef.part1],
    frameRange: [frame - radius, frame + radius],
    step: 1,
  });
  const subject = sampled.subjects[0];
  const at = subject.samples.find((s) => Math.abs(s.t - frame) < 1e-6) || null;
  const cls = MOTION.classifyVariation(project, itemId, joint, frame);

  const medianJerk = median(subject.samples.filter((s) => s.jerk !== null).map((s) => s.jerk));
  const medianAccel = median(subject.samples.filter((s) => s.acceleration !== null).map((s) => s.acceleration));
  // ACCELERATION, not jerk, is the discontinuity signal. Jerk needs two samples either side, so it
  // is undefined near the window edge and smeared across three frames when it is defined; the
  // acceleration magnitude spikes exactly on the frame the motion changed direction or rate. Jerk
  // is still reported, because it is Part 23's own quantity.
  const spike = at && at.acceleration !== null && medianAccel > 0 ? at.acceleration / medianAccel : null;

  const facts = [
    at
      ? `at frame ${frame}, "${jointDef.part1}" moves at ${at.speed} studs/frame and ${at.angular_speed_deg}°/frame`
      : `frame ${frame} was not sampled`,
    at && at.acceleration !== null
      ? `acceleration ${at.acceleration} studs/frame², ${spike === null ? 'with no median to compare against' : `${spike.toFixed(1)}× the window median of ${medianAccel}`}`
      : 'acceleration is undefined at the edge of the sampled window',
    at && at.jerk !== null ? `jerk ${at.jerk} studs/frame³ against a window median of ${medianJerk}` : 'jerk needs two samples either side and this frame is too close to the window edge',
    `peak speed in the window is ${subject.summary.peak_speed} at frame ${subject.summary.peak_speed_frame}`,
  ];

  const authored = cls.kind !== 'unclassified';
  // The floor matters as much as the ratio: in a window that is nearly still, dividing one tiny
  // number by another produces a large ratio out of solve noise. NOTABLE_ACCEL is roughly a
  // hundredth of a stud per frame per frame — below that, nothing is visible.
  const notable = spike !== null && spike >= SPIKE_RATIO && at.acceleration >= NOTABLE_ACCEL;

  const findings = [];
  if (authored) {
    findings.push(finding({
      id: 'MOTION-AUTHORED-VARIATION',
      certainty: cls.certainty,
      statement: `the discontinuity at frame ${frame} is authored (${cls.kind}) — ${cls.why}`,
      evidence: [evidence('data', cls.why), evidence('measurement', `acceleration ${at && at.acceleration !== null ? at.acceleration : 'n/a'} against a window median of ${medianAccel}`)],
      target: ids.trackId(itemId, joint),
      frame,
    }));
  } else if (notable) {
    findings.push(finding({
      id: 'MOTION-DISCONTINUITY',
      // Never higher: the measurement is certain, the interpretation is not. Part 23's own warning
      // is that a deviation from smoothness is not a defect, and nothing in the data says which
      // this is.
      certainty: CERTAINTY.POSSIBLE,
      statement: `frame ${frame} on "${joint}" carries ${spike.toFixed(1)}× the window's median acceleration, and no stepped key, held pose or shot-event marker explains it`,
      evidence: [
        evidence('measurement', `acceleration ${at.acceleration} vs median ${medianAccel}`, { frames: [frame - radius, frame + radius], jerk: at.jerk, median_jerk: medianJerk, ratio_threshold: SPIKE_RATIO }),
        evidence('absence', cls.why),
      ],
      target: ids.trackId(itemId, joint),
      frame,
      suggestion: { text: 'if it is unwanted, softening the easing on the nearest key is the smallest change; if it is deliberate, a marker on this frame records that and stops it being reported again', reversible: true },
    }));
  }

  return response({
    question: q,
    header: authored
      ? `frame ${frame} on "${joint}" is a deliberate ${cls.kind}, not a defect`
      : notable
        ? `frame ${frame} on "${joint}" is discontinuous and nothing in the project says it was meant to be`
        : `nothing unusual was measured on "${joint}" around frame ${frame}`,
    observed_facts: facts,
    referenced_plan: [
      'Part 23 noise-and-signal policy: "Never label motion as bad simply because it deviates from smoothness"',
      `variation classification: ${cls.kind} — ${cls.why}`,
    ],
    dependencies: [ids.trackId(itemId, joint), ids.partId(itemId, jointDef.part1)],
    likely_causes: authored
      ? [{ cause: cls.kind, kind: 'authored', certainty: cls.certainty, distinguishing_evidence: cls.why }]
      : notable
        ? [
          { cause: 'an easing choice on the nearest key produces a sharp arrival', kind: 'interpolation', certainty: CERTAINTY.POSSIBLE, distinguishing_evidence: `the keys nearest frame ${frame} are ${nearestKeys(project, itemId, joint, frame)}` },
          { cause: 'accidental jitter', kind: 'authoring', certainty: CERTAINTY.POSSIBLE, distinguishing_evidence: 'indistinguishable in the data from deliberate texture — see motion.VARIATION_KINDS' },
        ]
        : [],
    certainty: authored ? cls.certainty : notable ? CERTAINTY.POSSIBLE : CERTAINTY.CERTAIN,
    next_checks: [
      `analyze_motion on ${jointDef.part1} over frames ${frame - radius}–${frame + radius} for the full series`,
      `create_baseline at frame ${frame - 1} and at frame ${frame}, then explain_change — the only check here that looks at pixels`,
      'inspect_timeline for the easing on the surrounding keys',
    ],
    recommended_action: null,
    user_question: !authored && notable
      ? `Was the discontinuity at frame ${frame} intended? Nothing in the project marks it, and Cadence cannot tell deliberate texture from accidental jitter.`
      : null,
    findings,
    measurements: { subject, classification: cls, median_jerk: medianJerk, median_acceleration: medianAccel },
    coverage: coverage({
      scope: `"${joint}" driving ${jointDef.part1} over frames ${frame - radius}–${frame + radius}`,
      frames: subject.samples.map((s) => s.t),
      loop: 'full',
      notRun: [
        ...sampled.coverage.notRun,
        '6 of Part 23\'s 9 variation kinds cannot be distinguished in Cadence project data (see motion.VARIATION_KINDS), so an unexplained discontinuity is reported as unclassified rather than as jitter',
        'the joint\'s relationship to its parent and children in the chain is not examined here — analyze_motion with a chain does that',
      ],
    }),
  });
}

function median(xs) {
  const v = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return +(v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2).toFixed(6);
}

function nearestKeys(project, itemId, track, frame) {
  const keys = (K.tracksOf(project, itemId)[track] || {}).keys || [];
  const near = keys
    .map((k) => ({ t: k.t, es: k.es || 'Linear', ed: k.ed || 'InOut', d: Math.abs(k.t - frame) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 2);
  return near.length ? near.map((k) => `${k.t}:${k.es}/${k.ed}`).join(', ') : 'none';
}

// ---------------------------------------------------------------- limitations

export function diagnoseLimitations() {
  const impl = Object.entries(DIAGNOSTICS).filter(([, d]) => d.implemented);
  const routed = Object.entries(DIAGNOSTICS).filter(([, d]) => !d.implemented && d.routed_to);
  const blocked = Object.entries(DIAGNOSTICS).filter(([, d]) => !d.implemented && !d.routed_to);
  return {
    summary: `${impl.length} of Part 46's ${Object.keys(DIAGNOSTICS).length} diagnostic workflows run here, ${routed.length} are routed to a tool that already answers them, and ${blocked.length} are blocked`,
    implemented: impl.map(([k]) => k),
    routed: routed.map(([k, d]) => ({ question: k, routed_to: d.routed_to })),
    blocked: blocked.map(([k, d]) => ({ question: k, unblocked_by: d.unblocked_by })),
    cannot: [
      'look at a pixel. Every answer here is kinematic — a contact can be geometrically planted and still read wrong on screen, and the diagnostic says so and points at explain_change',
      'attribute a drift produced only by two joints acting together: the counterfactual freezes one at a time, and what neither owns is reported as unattributed',
      'tell whether an unexplained discontinuity was deliberate. Six of Part 23\'s nine variation kinds have no mark in Cadence project data',
      'answer any question about weight, style or camera framing — the three blocked workflows above',
    ],
  };
}
