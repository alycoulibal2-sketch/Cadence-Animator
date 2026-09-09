// CAL — the Cadence Animation Language (directive Part 20).
//
// This is the AI's animation reasoning language. Part 4.2 is the rule it exists to satisfy: "The
// AI must not use raw CFrame or Motor6D values as its primary mental model. Low-level Roblox
// representations are compilation targets."
//
// So this module holds structures, not behaviour. It defines what an intent, a plan, a pose, a
// timing, a spacing, a contact and an acceptance criterion ARE, validates them, and gives each a
// content-addressed id. `ai/intent.js` builds an IntentSpec from a request; `ai/plan.js` turns one
// into a MotionPlan and compiles a MotionPlan into patch operations. Neither of those decisions
// belongs here, and keeping them out is what lets a plan be stored, diffed, replayed and reviewed
// independently of the code that produced it.
//
// Two conventions carried over from the rest of the semantic layer, both load-bearing:
//
//   * **Every field in the directive's list is present.** A spec with fields quietly omitted
//     because this build cannot fill them would let a reader infer they do not matter. They are
//     present and `null`, and `null` means *unknown*, never *zero* and never *none*.
//   * **An unknown enum value throws.** A typo in `action_type` that silently becomes 'custom'
//     would produce a plan built for the wrong kind of motion. Construction is the checkpoint.
//
// The one piece of behaviour that IS here is acceptance evaluation, because an AcceptanceSpec that
// cannot be run is a wish. It compares two project states and answers each declared check —
// including, loudly, the ones it cannot answer.

import * as CF from '../cf.js';
import * as K from './kinematics.js';
import { CERTAINTY, coverage, evidence, finding } from './certainty.js';
import { contentHash, shortHash } from './hash.js';

// ---------------------------------------------------------------- controlled vocabularies

export const ACTION_TYPES = Object.freeze(['attack', 'locomotion', 'reaction', 'gesture', 'idle', 'cinematic', 'custom']);

/** Part 20.2's phase names, in the order a full action passes through them. Not every motion has
 *  every phase — Part 20.2: "A subtle glance, an idle shift, a sudden reaction, and a heavy attack
 *  require different phase structures." The planner must justify what it omits, which is why
 *  `motionPlan` records omitted phases rather than just not mentioning them. */
export const PHASE_NAMES = Object.freeze([
  'preparation', 'anticipation', 'acceleration', 'action', 'impact', 'follow_through', 'recovery', 'settle',
]);

export const POSE_ROLES = Object.freeze([
  'key', 'extreme', 'breakdown', 'passing', 'contact', 'recoil', 'anticipation', 'recovery', 'hold', 'follow_through',
]);

export const CONTACT_MODES = Object.freeze(['planted', 'sliding', 'glancing', 'gripping', 'collision', 'suspended', 'custom']);

export const REALISM_LEVELS = Object.freeze(['stylized', 'hybrid', 'realistic']);
export const READABILITY = Object.freeze(['low', 'medium', 'high']);
export const AUDIENCE_FOCUS = Object.freeze(['character', 'weapon', 'target', 'environment', 'camera']);

/** Part 35's style profiles. A style is not decoration: it changes which dimensions a term pulls,
 *  what counts as a defect, and how much imperfection is acceptable. */
export const STYLE_PROFILES = Object.freeze([
  'realistic', 'anime', 'cartoon', 'game_combat', 'cinematic', 'mechanical', 'horror', 'fantasy', 'abstract', 'unspecified',
]);

/** Part 20.1's "controlled vocabulary plus free text" for emotional intent. The controlled half is
 *  short on purpose — a long enum invites a caller to pick the nearest wrong word instead of using
 *  the free-text half. */
export const EMOTIONS = Object.freeze([
  'neutral', 'determined', 'angry', 'afraid', 'exhausted', 'joyful', 'sorrowful', 'confident', 'hesitant', 'surprised', 'menacing', 'playful',
]);

function must(value, allowed, field) {
  if (value === null || value === undefined) return null;
  if (!allowed.includes(value)) {
    throw new TypeError(`${field}: expected one of ${allowed.join(', ')} (got ${JSON.stringify(value)})`);
  }
  return value;
}

function id(prefix, body) {
  return `${prefix}:${shortHash(contentHash(body))}`;
}

/** A normalised 0..1 magnitude that must carry its reasoning. Part 20.1 asks for "normalized range
 *  with explanation" on `energy` and `weight`; a bare number with no explanation is exactly the
 *  opaque single slider Part 21 forbids. */
export function scalar(value, why = null) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`scalar: expected a number in [0,1] (got ${JSON.stringify(value)})`);
  }
  return { value, explanation: why };
}

// ---------------------------------------------------------------- 20.1 IntentSpec

/**
 * What the user is asking for, and why. Everything downstream reads this rather than the raw
 * request string, so an intent that misreads the request produces a plan that is wrong in a
 * *legible* way — which is the point of having it at all.
 *
 * `confidence` and `unresolved_questions` are not optional politeness. A planner is allowed to
 * proceed on a low-confidence intent, but it must say what it guessed, and a question left here
 * is a question that reaches the user.
 */
export function intentSpec(s = {}) {
  const spec = {
    id: null,
    action_type: must(s.actionType ?? null, ACTION_TYPES, 'intentSpec.action_type'),
    narrative_purpose: s.narrativePurpose ?? null,
    emotional_intent: s.emotionalIntent
      ? {
        controlled: must(s.emotionalIntent.controlled ?? null, EMOTIONS, 'intentSpec.emotional_intent.controlled'),
        free_text: s.emotionalIntent.freeText ?? null,
      }
      : null,
    style_profile: must(s.styleProfile ?? null, STYLE_PROFILES, 'intentSpec.style_profile'),
    energy: scalar(s.energy ?? null, s.energyWhy ?? null),
    weight: scalar(s.weight ?? null, s.weightWhy ?? null),
    readability_priority: must(s.readabilityPriority ?? null, READABILITY, 'intentSpec.readability_priority'),
    realism_level: must(s.realismLevel ?? null, REALISM_LEVELS, 'intentSpec.realism_level'),
    audience_focus: must(s.audienceFocus ?? null, AUDIENCE_FOCUS, 'intentSpec.audience_focus'),
    requested_duration: s.requestedDuration ?? null,      // { frames } | { from, to } | null
    critical_events: (s.criticalEvents || []).map((e) => ({
      event_id: e.eventId ?? e.id ?? null,
      expected_time: e.expectedTime ?? null,
      tolerance: e.tolerance ?? null,
    })),
    preserve: [...(s.preserve || [])],                    // semantic targets or property paths
    avoid: [...(s.avoid || [])],
    evidence_source: [...(s.evidenceSource || [])],
    confidence: s.confidence ?? null,
    unresolved_questions: [...(s.unresolvedQuestions || [])],

    // Not in the directive's field list, and here because the whole layer would be poorer without
    // it: the dimension vector the request's vocabulary terms produced. Keeping it on the intent
    // is what lets a plan be re-derived from the intent alone, and lets a reviewer see that the
    // words and the numbers agree.
    dimensions: { ...(s.dimensions || {}) },
    vfx_dimensions: { ...(s.vfxDimensions || {}) },
    terms: [...(s.terms || [])],
    target: s.target ?? null,                             // { itemId, timeRange } — what it applies to
    request: s.request ?? null,                           // the raw text, kept verbatim
    mode: s.mode ?? null,                                 // Part 11's operating mode
  };
  spec.id = id('intent', { ...spec, id: null });
  return spec;
}

// ---------------------------------------------------------------- 20.2 MotionPlan

/** One phase of a motion. Every rule field is a list of plain strings or structured rules — the
 *  planner writes them, a reviewer reads them, and the compiler consults only the ones it knows
 *  how to honour (and says which those were). */
export function phaseSpec(p = {}) {
  const spec = {
    id: null,
    name: must(p.name ?? null, PHASE_NAMES, 'phaseSpec.name'),
    time_range: p.timeRange ?? null,                      // [from, to] in frames
    purpose: p.purpose ?? null,
    dominant_body_regions: [...(p.dominantBodyRegions || [])],  // semantic roles
    pose_goals: [...(p.poseGoals || [])],                 // PoseSpec ids, or free text goals
    motion_graph_rules: [...(p.motionGraphRules || [])],
    contact_rules: [...(p.contactRules || [])],           // ContactSpec ids or rules
    timing_rules: [...(p.timingRules || [])],
    spacing_rules: [...(p.spacingRules || [])],
    camera_rules: [...(p.cameraRules || [])],
    VFX_rules: [...(p.vfxRules || [])],
    exit_conditions: [...(p.exitConditions || [])],
    // How the boundaries were arrived at, because a phase boundary guessed from key density and
    // one declared by the user are very different things to build on.
    derivation: p.derivation ?? null,
    certainty: p.certainty ?? null,
  };
  spec.id = id('phase', { ...spec, id: null });
  return spec;
}

/**
 * Part 20.2's MotionPlan. Phases with goals, not a list of transforms.
 *
 * `omitted_phases` has no counterpart in the directive's field list and earns its place: Part 20.2
 * requires the planner to "justify omitted or compressed phases when relevant", and a justification
 * with nowhere to live is a justification nobody writes.
 */
export function motionPlan(p = {}) {
  // Detection is by id prefix, NOT by "does it have a name": an unnamed phase is a legitimate
  // result (a span nothing gives evidence to name), and testing for a name would send an
  // already-built spec back through the constructor, which reads camelCase input fields and would
  // silently null out every snake_case field it already has.
  const phases = (p.phases || []).map((ph) => (typeof ph.id === 'string' && ph.id.startsWith('phase:') ? ph : phaseSpec(ph)));
  const spec = {
    id: null,
    intent_id: p.intentId ?? null,
    duration: p.duration ?? null,
    phases,
    omitted_phases: (p.omittedPhases || []).map((o) => ({
      name: must(o.name, PHASE_NAMES, 'motionPlan.omitted_phases[].name'),
      why: o.why ?? null,
    })),
    root_motion_strategy: p.rootMotionStrategy ?? null,
    secondary_motion_strategy: p.secondaryMotionStrategy ?? null,
    style_overrides: p.styleOverrides ?? null,
    protected_elements: [...(p.protectedElements || [])],
    acceptance_criteria: p.acceptanceCriteria ?? null,    // an AcceptanceSpec, or its id
    risks: [...(p.risks || [])],

    // The executable half. `edits` are strategy instances the compiler understands; `blocked` are
    // the ones a constraint or a missing capability stopped, each with the reason and what the
    // motion loses by their absence. A plan that dropped them silently would read as complete.
    target: p.target ?? null,
    edits: [...(p.edits || [])],
    blocked: [...(p.blocked || [])],
    timing: p.timing ?? null,                             // TimingSpec
    spacing: p.spacing ?? null,                           // SpacingSpec
    contacts: [...(p.contacts || [])],                    // ContactSpecs
    poses: [...(p.poses || [])],                          // PoseSpecs
  };
  spec.id = id('plan', { ...spec, id: null });
  return spec;
}

// ---------------------------------------------------------------- 20.3 PoseSpec

/**
 * A pose is not a list of rotations (Part 6): "it has a silhouette, balance state, line of action,
 * contact state, emotional function, and relationship to camera."
 *
 * Most of those cannot be measured in this build. They are present and null, and the honest
 * consequence is stated once here rather than implied per field: a PoseSpec produced by this
 * build describes the *rotational* target with certainty and everything else as intent.
 */
export function poseSpec(p = {}) {
  const spec = {
    id: null,
    time: p.time ?? null,
    role: must(p.role ?? null, POSE_ROLES, 'poseSpec.role'),
    purpose: p.purpose ?? null,
    line_of_action: p.lineOfAction ?? null,
    silhouette_goals: [...(p.silhouetteGoals || [])],
    balance_state: p.balanceState ?? null,
    center_of_mass_target: p.centerOfMassTarget ?? null,
    support_polygon: p.supportPolygon ?? null,
    body_region_targets: (p.bodyRegionTargets || []).map((t) => ({
      semantic_role: t.role ?? t.semanticRole ?? null,
      joint: t.joint ?? null,                             // the concrete track this compiles to
      position_goal: t.positionGoal ?? null,
      rotation_goal: t.rotationGoal ?? null,              // a CFrame, or a described relationship
      orientation_intent: t.orientationIntent ?? null,
      constraint: t.constraint ?? null,
    })),
    weapon_or_prop_relationship: p.weaponOrPropRelationship ?? null,
    camera_readability_notes: p.cameraReadabilityNotes ?? null,
    mirror_policy: p.mirrorPolicy ?? null,
    style_notes: p.styleNotes ?? null,
    confidence: p.confidence ?? null,
  };
  spec.id = id('pose', { ...spec, id: null });
  return spec;
}

// ---------------------------------------------------------------- 20.4 TimingSpec / SpacingSpec

/** Part 27's first half. Kept separate from SpacingSpec because the whole point of Part 27 is that
 *  they are independently editable: "Two animations can use the same poses and total duration yet
 *  feel completely different because their spacing differs." */
export function timingSpec(p = {}) {
  return {
    duration: p.duration ?? null,
    frame_rate: p.frameRate ?? null,
    phase_boundaries: [...(p.phaseBoundaries || [])],
    held_frames: [...(p.heldFrames || [])],
    impact_frames: [...(p.impactFrames || [])],
    contact_ranges: [...(p.contactRanges || [])],
    beat_markers: [...(p.beatMarkers || [])],
    timing_contrast: p.timingContrast ?? null,
    protected_times: [...(p.protectedTimes || [])],
    retiming_limits: p.retimingLimits ?? null,
  };
}

/** Part 27's second half. `tangent_policy` is null on every plan this build produces and that is a
 *  data fact, not an oversight: Cadence keys carry an easing style and direction, not tangent
 *  vectors (see the Timeline Graph's own limitation on `in_tangent`/`out_tangent`). */
export function spacingSpec(p = {}) {
  return {
    target_regions: [...(p.targetRegions || [])],
    positional_profile: p.positionalProfile ?? null,
    rotational_profile: p.rotationalProfile ?? null,
    acceleration_profile: p.accelerationProfile ?? null,
    deceleration_profile: p.decelerationProfile ?? null,
    screen_space_speed_target: p.screenSpaceSpeedTarget ?? null,
    overshoot_profile: p.overshootProfile ?? null,
    tangent_policy: p.tangentPolicy ?? null,
    interpolation_policy: p.interpolationPolicy ?? null,
    noise_policy: p.noisePolicy ?? null,
  };
}

// ---------------------------------------------------------------- 20.5 ContactSpec

/**
 * Part 20.5: "Contacts are first-class information. Foot contacts, hand grips, weapon hits, wall
 * braces, and prop interactions should not be inferred solely after animation generation."
 *
 * `validation_method` is where this build's honesty lives. Contact drift cannot be measured until
 * Part 23 lands, so a ContactSpec created now records `declared` and every consumer treats it as a
 * declaration to protect, never as a verified fact. `verified` is a value only Phase 5 may write.
 */
export const CONTACT_VALIDATION = Object.freeze(['declared', 'measured', 'user_confirmed']);

export function contactSpec(p = {}) {
  const spec = {
    id: null,
    effector: p.effector ?? null,                         // semantic role, entity id, or track name
    target: p.target ?? null,
    mode: must(p.mode ?? null, CONTACT_MODES, 'contactSpec.mode'),
    start: p.start ?? null,
    end: p.end ?? null,
    positional_tolerance: p.positionalTolerance ?? null,  // studs
    rotational_tolerance: p.rotationalTolerance ?? null,  // degrees
    force_intent: p.forceIntent ?? null,
    break_condition: p.breakCondition ?? null,
    validation_method: must(p.validationMethod ?? 'declared', CONTACT_VALIDATION, 'contactSpec.validation_method'),
    user_locked: p.userLocked ?? false,
    // Why this contact is believed to exist. `declared` contacts carry the user's word; anything
    // inferred says what it inferred from and never claims better than `possible`.
    certainty: p.certainty ?? CERTAINTY.USER_INTENT_REQUIRED,
    evidence: [...(p.evidence || [])],
  };
  spec.id = id('contact', { ...spec, id: null });
  return spec;
}

// ---------------------------------------------------------------- 20.7 AcceptanceSpec
//
// Part 20.7: "An acceptance specification is the difference between 'looks good' and 'has passed
// the agreed review.'"
//
// The registry below is modelled on `ai/constraints.js` CHECKS and for the same reason: an
// unimplemented check is carried, named and reported as NOT RUN. It is never counted as a pass.
// `proxy_for` is the second honesty column — a check can be perfectly measurable and still not
// prove the artistic claim it was chosen to support, and conflating those is how a system starts
// reporting that an animation "feels heavier" because a number went up.

export const ACCEPTANCE_CHECKS = Object.freeze({
  key_times_unchanged: {
    id: 'key_times_unchanged',
    category: 'temporal_checks',
    summary: 'no keyframe moved, was added or was removed, within the named scope',
    args: 'itemId?, track?, timeRange?',
    implemented: true,
    proxy_for: null,
  },
  key_count_unchanged: {
    id: 'key_count_unchanged',
    category: 'objective_checks',
    summary: 'the number of keys is the same',
    args: 'itemId?, track?',
    implemented: true,
    proxy_for: null,
  },
  key_count_within: {
    id: 'key_count_within',
    category: 'performance_checks',
    summary: 'total key count stays under a budget',
    args: 'max, itemId?',
    implemented: true,
    proxy_for: 'export size and editability — not a measured runtime cost',
  },
  no_new_tracks: {
    id: 'no_new_tracks',
    category: 'objective_checks',
    summary: 'no track appeared or disappeared',
    args: 'itemId?',
    implemented: true,
    proxy_for: null,
  },
  pose_unchanged_at: {
    id: 'pose_unchanged_at',
    category: 'protected_state_checks',
    summary: 'a joint holds the same rotation at a frame, within a tolerance in degrees',
    args: 'itemId, track, t, tolerance_deg?',
    implemented: true,
    proxy_for: null,
  },
  pose_changed_at: {
    id: 'pose_changed_at',
    category: 'style_checks',
    summary: 'a joint\'s rotation at a frame moved by at least this many degrees',
    args: 'itemId, track, t, min_deg',
    implemented: true,
    proxy_for: 'that the edit reached the joint it was aimed at — not that the result reads correctly',
  },
  amplitude_increased: {
    id: 'amplitude_increased',
    category: 'style_checks',
    summary: 'summed rotation magnitude across the named tracks rose by at least a ratio',
    args: 'itemId, tracks?, timeRange?, min_ratio',
    implemented: true,
    proxy_for: 'perceived force or weight. Amplitude going up is a fact; "it reads heavier" is a judgement no measurement here can make',
  },
  amplitude_within: {
    id: 'amplitude_within',
    category: 'style_checks',
    summary: 'summed rotation magnitude did not grow past a ratio',
    args: 'itemId, tracks?, timeRange?, max_ratio',
    implemented: true,
    proxy_for: 'restraint — the counterweight to amplitude_increased, so "bigger" cannot become "bigger everywhere"',
  },
  easing_changed: {
    id: 'easing_changed',
    category: 'style_checks',
    summary: 'at least this many keys changed easing style or direction',
    args: 'itemId, track?, timeRange?, min_keys?',
    implemented: true,
    proxy_for: 'spacing change. The easing changed; whether the spacing now reads as intended needs Part 23',
  },
  marker_within: {
    id: 'marker_within',
    category: 'temporal_checks',
    summary: 'a shot event stayed within a frame tolerance of where it was',
    args: 'itemId, t, tolerance',
    implemented: true,
    proxy_for: null,
  },
  scope_unchanged: {
    id: 'scope_unchanged',
    category: 'protected_state_checks',
    summary: 'everything outside the declared edit scope hashes identically before and after',
    args: 'itemIds?, tracks?',
    implemented: true,
    proxy_for: null,
  },
  contact_drift_within: {
    id: 'contact_drift_within',
    category: 'temporal_checks',
    summary: 'a declared contact effector stayed within its positional tolerance',
    args: 'contactId | (itemId, effector, start, end, tolerance)',
    implemented: false,
    blocked_by: 'contact drift is a world-space measurement over a frame range — Part 23 (Phase 5). Declared contacts are protected by constraint, and NOT verified',
    proxy_for: null,
  },
  no_visual_regression: {
    id: 'no_visual_regression',
    category: 'visual_checks',
    summary: 'no unapproved pixel difference against the baseline beyond the threshold',
    args: 'baselineId, threshold',
    implemented: false,
    blocked_by: 'baselines and a rendered comparison DO exist now (Part 44 — create_baseline then explain_change). What blocks this CHECK is that evaluateAcceptance receives two project objects and nothing else: no raster reaches it, and it must not stand in for the comparison it cannot run',
    proxy_for: null,
  },
  silhouette_readable: {
    id: 'silhouette_readable',
    category: 'visual_checks',
    summary: 'key poses read clearly in silhouette from the active camera',
    args: 'frames, cameraId',
    implemented: false,
    blocked_by: 'the silhouette pass exists (OBS-002) and explain_change compares it, but "reads clearly" is a perceptual judgement and this build makes none — the rendered methods are exact-pixel, coverage, edge displacement and object-ID (REG-003)',
    proxy_for: null,
  },
  export_valid: {
    id: 'export_valid',
    category: 'export_checks',
    summary: 'the animation still exports to the target Roblox format without loss',
    args: '—',
    implemented: false,
    blocked_by: 'the validator (renderer/js/validate.js) imports state.js and cannot run in this layer; exposing it needs the pure-at-load split the rest of ai/ obeys',
    proxy_for: null,
  },
});

const CHECK_CATEGORIES = Object.freeze([
  'objective_checks', 'visual_checks', 'temporal_checks', 'style_checks',
  'performance_checks', 'export_checks', 'protected_state_checks',
]);

/**
 * Part 20.7's AcceptanceSpec. Checks are supplied as a flat list and filed into the directive's
 * seven buckets by their registry entry, so a caller cannot put a visual check in the export
 * bucket and have it quietly not run.
 */
export function acceptanceSpec(p = {}) {
  const buckets = Object.fromEntries(CHECK_CATEGORIES.map((c) => [c, []]));
  for (const raw of p.checks || []) {
    const def = ACCEPTANCE_CHECKS[raw.check];
    if (!def) {
      throw new TypeError(`acceptanceSpec: unknown check "${raw.check}" — see ACCEPTANCE_CHECKS in renderer/js/ai/cal.js`);
    }
    buckets[def.category].push({ ...raw, _def: def.id });
  }
  const spec = {
    id: null,
    ...buckets,
    review_required: p.reviewRequired ?? null,
    baseline_policy: p.baselinePolicy ?? null,
    tolerance_policy: p.tolerancePolicy ?? null,
    escalation_policy: p.escalationPolicy ?? null,
    // The list a caller reads before believing a pass. Filled at construction so it is impossible
    // to build a spec whose unrunnable checks are not already enumerated.
    not_runnable: (p.checks || [])
      .filter((c) => !ACCEPTANCE_CHECKS[c.check].implemented)
      .map((c) => ({ check: c.check, blocked_by: ACCEPTANCE_CHECKS[c.check].blocked_by })),
    proxies: (p.checks || [])
      .filter((c) => ACCEPTANCE_CHECKS[c.check].proxy_for)
      .map((c) => ({ check: c.check, proxy_for: ACCEPTANCE_CHECKS[c.check].proxy_for })),
  };
  spec.id = id('acceptance', { ...spec, id: null });
  return spec;
}

/** Every check in a spec, flattened back out of its buckets. */
export function checksOf(spec) {
  return CHECK_CATEGORIES.flatMap((c) => (spec[c] || []).map((x) => ({ ...x, category: c })));
}

// ---------------------------------------------------------------- acceptance evaluation

const tracksOf = (project, itemId) => (project.tracks && project.tracks[itemId]) || {};
const rot = (cf) => (Array.isArray(cf) ? K.angleBetween(CF.IDENTITY, cf) : 0);

function trackNames(project, itemId, only) {
  const t = tracksOf(project, itemId);
  const all = Object.keys(t).filter((n) => !n.startsWith('@'));
  return only && only.length ? all.filter((n) => only.includes(n)) : all;
}

function keysIn(track, timeRange) {
  const keys = (track && track.keys) || [];
  if (!timeRange) return keys;
  return keys.filter((k) => k.t >= timeRange[0] - 1e-6 && k.t <= timeRange[1] + 1e-6);
}

function amplitudeOf(project, itemId, tracks, timeRange) {
  let total = 0, count = 0;
  for (const name of trackNames(project, itemId, tracks)) {
    for (const k of keysIn(tracksOf(project, itemId)[name], timeRange)) { total += rot(k.v); count++; }
  }
  return { total, count };
}

/**
 * Run an AcceptanceSpec against a before/after pair.
 *
 * The result never says "passed" for a check that did not run. Each entry is
 * `pass | fail | not_run`, and the summary counts all three separately — a spec of ten checks
 * where six could not run is not 4/4.
 */
export function evaluateAcceptance(before, after, spec, { itemId: defaultItem = null } = {}) {
  const results = [];
  const notRun = [];

  for (const c of checksOf(spec)) {
    const def = ACCEPTANCE_CHECKS[c.check];
    if (!def.implemented) {
      results.push({ check: c.check, category: c.category, status: 'not_run', reason: def.blocked_by, args: sanitise(c) });
      notRun.push(`${c.check}: ${def.blocked_by}`);
      continue;
    }
    const item = c.itemId ?? defaultItem;
    try {
      results.push({ ...runAcceptance(before, after, c, item), check: c.check, category: c.category, args: sanitise(c) });
    } catch (e) {
      results.push({ check: c.check, category: c.category, status: 'not_run', reason: `could not be evaluated: ${e.message}`, args: sanitise(c) });
      notRun.push(`${c.check}: ${e.message}`);
    }
  }

  const passed = results.filter((r) => r.status === 'pass');
  const failed = results.filter((r) => r.status === 'fail');
  const skipped = results.filter((r) => r.status === 'not_run');

  const findings = failed.map((r) => finding({
    id: 'ACCEPTANCE-FAILED',
    certainty: CERTAINTY.CERTAIN,
    statement: `${r.check}: ${r.detail}`,
    evidence: [evidence('measurement', r.detail, r.measured ?? null)],
  }));

  return {
    accepted: failed.length === 0 && passed.length > 0,
    // Deliberately separate from `accepted`: a spec where everything measurable passed but half the
    // checks could not run has NOT been fully validated, and Part 15 forbids implying otherwise.
    fully_validated: failed.length === 0 && skipped.length === 0 && passed.length > 0,
    summary: `${passed.length} passed, ${failed.length} failed, ${skipped.length} not run`,
    results,
    findings,
    proxies: spec.proxies,
    coverage: coverage({
      scope: `AcceptanceSpec ${spec.id}`,
      loop: 'fast',
      notRun,
    }),
  };
}

function sanitise(c) {
  const { _def, ...rest } = c;
  return rest;
}

function runAcceptance(before, after, c, itemId) {
  switch (c.check) {
    case 'key_times_unchanged': {
      const moved = [];
      const items = itemId ? [itemId] : Object.keys(after.tracks || {});
      for (const iid of items) {
        for (const name of new Set([...trackNames(before, iid, c.track ? [c.track] : null), ...trackNames(after, iid, c.track ? [c.track] : null)])) {
          const b = keysIn(tracksOf(before, iid)[name], c.timeRange).map((k) => k.t);
          const a = keysIn(tracksOf(after, iid)[name], c.timeRange).map((k) => k.t);
          if (b.length !== a.length || b.some((t, i) => Math.abs(t - a[i]) > 1e-6)) {
            moved.push({ itemId: iid, track: name, before: b, after: a });
          }
        }
      }
      return moved.length
        ? { status: 'fail', detail: `${moved.length} track(s) had a key time change`, measured: moved }
        : { status: 'pass', detail: 'every key is at the same frame it was', measured: null };
    }

    case 'key_count_unchanged': {
      const b = countKeys(before, itemId, c.track);
      const a = countKeys(after, itemId, c.track);
      return b === a
        ? { status: 'pass', detail: `${a} keys, unchanged`, measured: { before: b, after: a } }
        : { status: 'fail', detail: `key count went from ${b} to ${a}`, measured: { before: b, after: a } };
    }

    case 'key_count_within': {
      const a = countKeys(after, itemId, null);
      return a <= c.max
        ? { status: 'pass', detail: `${a} keys, budget ${c.max}`, measured: a }
        : { status: 'fail', detail: `${a} keys exceeds the budget of ${c.max}`, measured: a };
    }

    case 'no_new_tracks': {
      const items = itemId ? [itemId] : [...new Set([...Object.keys(before.tracks || {}), ...Object.keys(after.tracks || {})])];
      const diffs = [];
      for (const iid of items) {
        const b = new Set(Object.keys(tracksOf(before, iid)));
        const a = new Set(Object.keys(tracksOf(after, iid)));
        const added = [...a].filter((n) => !b.has(n));
        const removed = [...b].filter((n) => !a.has(n));
        if (added.length || removed.length) diffs.push({ itemId: iid, added, removed });
      }
      return diffs.length
        ? { status: 'fail', detail: `track set changed on ${diffs.length} item(s)`, measured: diffs }
        : { status: 'pass', detail: 'the same tracks exist', measured: null };
    }

    case 'pose_unchanged_at': {
      const tol = c.tolerance_deg ?? 0.01;
      const b = K.evalTrackCF(tracksOf(before, itemId)[c.track], c.t);
      const a = K.evalTrackCF(tracksOf(after, itemId)[c.track], c.t);
      const d = K.angleBetween(b, a);
      return d <= tol
        ? { status: 'pass', detail: `${c.track} at ${c.t} moved ${d.toFixed(3)}°, within ${tol}°`, measured: d }
        : { status: 'fail', detail: `${c.track} at ${c.t} moved ${d.toFixed(2)}°, tolerance ${tol}°`, measured: d };
    }

    case 'pose_changed_at': {
      const b = K.evalTrackCF(tracksOf(before, itemId)[c.track], c.t);
      const a = K.evalTrackCF(tracksOf(after, itemId)[c.track], c.t);
      const d = K.angleBetween(b, a);
      return d >= c.min_deg
        ? { status: 'pass', detail: `${c.track} at ${c.t} moved ${d.toFixed(2)}°, wanted at least ${c.min_deg}°`, measured: d }
        : { status: 'fail', detail: `${c.track} at ${c.t} moved only ${d.toFixed(2)}°, wanted at least ${c.min_deg}°`, measured: d };
    }

    case 'amplitude_increased': {
      const b = amplitudeOf(before, itemId, c.tracks, c.timeRange);
      const a = amplitudeOf(after, itemId, c.tracks, c.timeRange);
      if (b.total < 1e-6) {
        return { status: 'not_run', reason: 'the before state has no rotation to measure a ratio against — an increase from zero has no ratio', detail: 'no baseline amplitude', measured: { before: b, after: a } };
      }
      const ratio = a.total / b.total;
      return ratio >= c.min_ratio
        ? { status: 'pass', detail: `rotation amplitude ×${ratio.toFixed(3)} (wanted ≥ ${c.min_ratio})`, measured: { ratio, before: b.total, after: a.total } }
        : { status: 'fail', detail: `rotation amplitude ×${ratio.toFixed(3)}, wanted ≥ ${c.min_ratio}`, measured: { ratio, before: b.total, after: a.total } };
    }

    case 'amplitude_within': {
      const b = amplitudeOf(before, itemId, c.tracks, c.timeRange);
      const a = amplitudeOf(after, itemId, c.tracks, c.timeRange);
      if (b.total < 1e-6) return { status: 'not_run', reason: 'no baseline amplitude to compare against', detail: 'no baseline amplitude', measured: { before: b, after: a } };
      const ratio = a.total / b.total;
      return ratio <= c.max_ratio
        ? { status: 'pass', detail: `rotation amplitude ×${ratio.toFixed(3)} (cap ${c.max_ratio})`, measured: { ratio } }
        : { status: 'fail', detail: `rotation amplitude ×${ratio.toFixed(3)} exceeds the cap of ${c.max_ratio}`, measured: { ratio } };
    }

    case 'easing_changed': {
      let changed = 0;
      const names = c.track ? [c.track] : trackNames(after, itemId, null);
      for (const name of names) {
        const b = keysIn(tracksOf(before, itemId)[name], c.timeRange);
        const a = keysIn(tracksOf(after, itemId)[name], c.timeRange);
        for (const ka of a) {
          const kb = b.find((k) => Math.abs(k.t - ka.t) < 1e-6);
          if (!kb) continue;
          if ((kb.es || null) !== (ka.es || null) || (kb.ed || null) !== (ka.ed || null)) changed++;
        }
      }
      const want = c.min_keys ?? 1;
      return changed >= want
        ? { status: 'pass', detail: `${changed} key(s) changed easing (wanted ≥ ${want})`, measured: changed }
        : { status: 'fail', detail: `${changed} key(s) changed easing, wanted ≥ ${want}`, measured: changed };
    }

    case 'marker_within': {
      const b = (before.markers && before.markers[itemId]) || [];
      const a = (after.markers && after.markers[itemId]) || [];
      const nearest = a.length ? a.reduce((best, m) => (Math.abs(m.t - c.t) < Math.abs(best.t - c.t) ? m : best)) : null;
      if (!b.some((m) => Math.abs(m.t - c.t) < 1e-6)) {
        return { status: 'not_run', reason: `there was no marker at frame ${c.t} before the change, so there is nothing to hold in place`, detail: 'no such marker', measured: null };
      }
      if (!nearest) return { status: 'fail', detail: `the marker at ${c.t} is gone`, measured: null };
      const drift = Math.abs(nearest.t - c.t);
      return drift <= (c.tolerance ?? 0)
        ? { status: 'pass', detail: `marker held at ${nearest.t} (drift ${drift})`, measured: drift }
        : { status: 'fail', detail: `marker moved from ${c.t} to ${nearest.t}, tolerance ${c.tolerance ?? 0}`, measured: drift };
    }

    case 'scope_unchanged': {
      // Anything NOT named is what must be identical. This is the acceptance-side mirror of the
      // constraint compiler's allow-list, and it is the check that catches an edit that reached
      // somewhere nobody was looking.
      const allowedItems = new Set(c.itemIds || (itemId ? [itemId] : []));
      const allowedTracks = new Set(c.tracks || []);
      const touched = [];
      const items = new Set([...Object.keys(before.tracks || {}), ...Object.keys(after.tracks || {})]);
      for (const iid of items) {
        const names = new Set([...Object.keys(tracksOf(before, iid)), ...Object.keys(tracksOf(after, iid))]);
        for (const n of names) {
          if (allowedItems.has(iid) && (!allowedTracks.size || allowedTracks.has(n))) continue;
          const hb = contentHash(tracksOf(before, iid)[n] ?? null);
          const ha = contentHash(tracksOf(after, iid)[n] ?? null);
          if (hb !== ha) touched.push({ itemId: iid, track: n });
        }
      }
      return touched.length
        ? { status: 'fail', detail: `${touched.length} track(s) outside the declared scope changed`, measured: touched }
        : { status: 'pass', detail: 'nothing outside the declared scope changed', measured: null };
    }

    default:
      throw new Error(`no evaluator for "${c.check}" — it is listed as implemented but has no case`);
  }
}

function countKeys(project, itemId, track) {
  let n = 0;
  const items = itemId ? [itemId] : Object.keys(project.tracks || {});
  for (const iid of items) {
    for (const name of trackNames(project, iid, track ? [track] : null)) n += (tracksOf(project, iid)[name].keys || []).length;
  }
  return n;
}

// ---------------------------------------------------------------- reading a plan

/** A MotionPlan in prose. Generated from the structure so the summary and the plan cannot drift. */
export function describePlan(plan) {
  const lines = [];
  lines.push(`Plan ${plan.id}${plan.duration ? ` — ${plan.duration} frames` : ''}`);
  const known = new Set(plan.phases.map((p) => p.id));
  for (const ph of plan.phases) {
    const r = ph.time_range ? `${ph.time_range[0]}–${ph.time_range[1]}` : '?';
    lines.push(`  ${ph.name ?? '(unnamed span)'} (${r}): ${ph.purpose || ph.derivation || 'no stated purpose'}`);
    for (const e of plan.edits.filter((x) => x.phase === ph.id)) lines.push(`    → ${e.summary}`);
  }
  // An edit whose phase is not one of the listed spans still has to appear. Silently dropping it
  // from the description would make the plan read as smaller than it is.
  for (const e of plan.edits.filter((x) => !x.phase || !known.has(x.phase))) lines.push(`  → ${e.summary}`);
  for (const o of plan.omitted_phases) lines.push(`  (no ${o.name}: ${o.why})`);
  for (const b of plan.blocked) lines.push(`  ✕ ${b.summary} — ${b.reason}`);
  for (const r of plan.risks) lines.push(`  ! ${r}`);
  return lines.join('\n');
}

/** What CAL can and cannot express in this build. Returned alongside a plan so a caller never has
 *  to infer a limit from an empty field. */
export function calLimitations() {
  return {
    expressible: [
      'intent, with the vocabulary terms and dimension vector it came from',
      'a phase-structured motion plan with per-phase purpose and rules',
      'pose targets at the joint level, with a semantic role attached',
      'timing and spacing as independently protected dimensions',
      'declared contacts, with tolerances',
      'acceptance criteria in the directive\'s seven categories',
    ],
    not_expressible: [
      'line of action, silhouette goals, balance state and centre of mass — the PoseSpec fields exist and stay null; measuring them needs Parts 28 and 43',
      'camera and VFX rules are carried on a phase as text and consumed by nothing (Parts 40, 37 — Phases 6 and 7)',
      'tangent policy — Cadence keys carry an easing style and direction, not tangent vectors',
      'verified contacts — every ContactSpec this build makes is `declared`, and contact drift is unmeasurable until Part 23',
    ],
    acceptance_checks: Object.values(ACCEPTANCE_CHECKS).map((c) => ({
      id: c.id, category: c.category, implemented: c.implemented, blocked_by: c.blocked_by ?? null, proxy_for: c.proxy_for,
    })),
  };
}
