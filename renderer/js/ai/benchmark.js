// The benchmark library and evaluation dimensions (directive Part 59). BCH-001, BCH-002, BCH-003.
//
// Part 59 opens with the sentence this module is built around: *"Cadence requires permanent
// benchmark scenes and test cases. Do not judge architectural improvement only by intuition or a
// single attractive demo."* So a benchmark here is not a unit test with a different name. It is a
// permanent SCENE (a fixture built from the real builtin rigs), an INPUT REQUEST that runs through
// the real semantic pipeline — the same interpret → plan → compile → check → apply → evaluate chain
// `apply_motion_plan` drives, only through the pure functions — and a set of MEASURED OUTCOMES on
// Part 59's own evaluation dimensions. Two runs of the suite can then be compared, which is what
// Part 62's Phase 9 success condition asks for: *"an architecture change can be shown to improve or
// regress measured outcomes."*
//
// Five decisions shaped it, each the answer to a way this could have gone wrong.
//
// 1. **Every Part 59 category keeps a row, and only some are DEFINED.** Twenty-five categories are
//    listed verbatim in `BENCHMARK_CATEGORIES`. A category this build can run carries benchmark
//    ids; one it cannot names what blocks it (no camera model, no animation layers, no locomotion
//    state model). Inventing a "walk cycle" benchmark whose only measurable outcome is "the file
//    still parses" would be the row of feature shells directive 4.6 forbids.
//
// 2. **Every Part 59 dimension keeps a row, and only some are MEASURED.** Twenty-one dimensions
//    are listed in `EVALUATION_DIMENSIONS` (the directive's list, counted rather than assumed to
//    be a round number). Eleven are measured from project data; the other ten (time to acceptable
//    result, number of user corrections, user approval rate, render cost, ...) are session or human
//    facts a headless run cannot know, and each says so. A run reports what it measured AND what
//    it did not, on every benchmark, so nobody reads an absent number as a good one.
//
// 3. **There is no overall score, deliberately.** Part 59: *"Do not optimize a metric in isolation.
//    A faster system that damages user work is not better."* `compareRuns` returns a verdict PER
//    DIMENSION PER BENCHMARK — improved, regressed, unchanged, not comparable — plus counts. It
//    never averages a contact drift against a recall rate. `WHY_NO_OVERALL_SCORE` is exported so a
//    reader of a comparison finds the reason next to the missing number.
//
// 4. **Human evaluation is a separate structure that the comparison never reads** (BCH-003). Every
//    result carries `human_evaluation` with Part 59's rubric and `ratings: null`. A rating recorded
//    later with `recordHumanRating` lives there and only there; `measured` is frozen. Merging the
//    two is how an opinion starts looking like a measurement (Part 4.5).
//
// 5. **The implementation under test is INJECTED.** `runSuite` takes an `implementation` — the
//    production modules by default, or a prototype that overrides some of them (code) or flips a
//    declared option (data). That is Part 60's "define minimum prototype → build benchmark →
//    compare old and new" made concrete: the same fixtures and the same measurements, two
//    implementations, one comparison. `ai/improve.js` consumes exactly that.
//
// What the numbers rest on, stated once: fixtures are built from `rigs/builtin.json`, which the
// caller supplies (this module is pure at load and reads no files); the FK solve is pure and
// deterministic, so a result hash is comparable across machines; wall-clock time is reported when
// the caller supplies a clock and is NEVER a verdict, because a busy machine is not a regression.
//
// Pure at load like the rest of `ai/`.

import * as CF from '../cf.js';
import * as INT from './intent.js';
import * as PLAN from './plan.js';
import * as CAL from './cal.js';
import * as CON from './constraints.js';
import * as PATCH from './patch.js';
import * as TXN from './transaction.js';
import * as SNAP from './snapshot.js';
import * as EXP from './explain.js';
import * as MOTION from './motion.js';
import * as DIAG from './diagnose.js';
import * as VS from './vfxspec.js';
import * as EVENTS from './events.js';
import * as REF from './reference.js';
import { contentHash, shortHash } from './hash.js';
import { CERTAINTY, coverage, evidence, finding } from './certainty.js';

const I = () => CF.IDENTITY.slice();
const round6 = (v) => (v === null || v === undefined ? null : Math.round(v * 1e6) / 1e6);
const round3 = (v) => (v === null || v === undefined ? null : Math.round(v * 1e3) / 1e3);

// ---------------------------------------------------------------- Part 59, verbatim

/** Part 59's baseline benchmark categories, in the directive's order. Every one keeps a row. */
export const BENCHMARK_CATEGORIES = Object.freeze([
  'idle breathing and subtle weight shift',
  'walk cycle',
  'run cycle',
  'start and stop',
  'jump and landing',
  'turn and pivot',
  'heavy attack',
  'light attack',
  'dodge',
  'reaction animation',
  'weapon swing',
  'layered upper-body action',
  'character-to-environment contact',
  'camera follow',
  'impact event',
  'smoke',
  'sparks',
  'dust impact',
  'explosion',
  'magic effect',
  'effect dissolve',
  'complex character, VFX, and camera shot',
  'reference adaptation',
  'constrained correction',
  'regression detection',
]);

/** Part 59's field list for one benchmark entry. Every defined benchmark carries all fifteen. */
export const BENCHMARK_FIELDS = Object.freeze([
  'benchmark_id', 'goal', 'scene_and_rig_prerequisites', 'input_request', 'reference_or_baseline',
  'required_constraints', 'allowed_variation', 'forbidden_variation', 'technical_metrics',
  'visual_metrics', 'review_rubric', 'expected_artifacts', 'performance_budget',
  'known_failure_cases', 'human_acceptance_procedure',
]);

/** Part 59's structured human-review dimensions. Rated by a person, kept apart from everything
 *  measured — see `recordHumanRating`. */
export const HUMAN_RUBRIC = Object.freeze([
  'intent_clarity', 'pose_readability', 'timing', 'weight', 'camera_readability',
  'vfx_integration', 'style_fit', 'absence_of_distracting_artifacts',
]);

/**
 * Part 59's twenty-one evaluation dimensions. `measured` says whether THIS build can compute it from
 * project data in a headless run; `direction` is the declared reading convention `compareRuns`
 * uses ('lower' — less is better, 'higher' — more is better). A direction is a convention, not a
 * law: heavier legitimately raises peak jerk, which is why "curve continuity" is defined as
 * discontinuities INTRODUCED and not as smoothness. Every verdict says its direction is one.
 */
export const EVALUATION_DIMENSIONS = Object.freeze({
  time_to_acceptable_result: { measured: false, kind: 'session', unit: 'seconds', direction: 'lower', blocked_by: 'a human decides when a result is acceptable; a headless run has no acceptance event to time. Part 59 lists this for a production session, which the provenance graph can carry once a decision node marks acceptance' },
  number_of_user_corrections: { measured: false, kind: 'session', unit: 'count', direction: 'lower', blocked_by: 'a correction is an edit a HUMAN makes to the AI\'s work (Part 57) — none happens inside a benchmark. `record_user_correction` captures them in a real session' },
  number_of_iterations: { measured: false, kind: 'session', unit: 'count', direction: 'lower', blocked_by: 'iterations are round trips between the model and the user; a benchmark makes one pass by construction' },
  unintended_change_rate: { measured: true, kind: 'deterministic', unit: 'ratio', direction: 'lower', tolerance: 0, method: 'tracks changed outside the operations the pipeline declared, over all tracks changed (0 when nothing changed); items and project fields that changed unannounced count as well' },
  constraint_violation_rate: { measured: true, kind: 'deterministic', unit: 'ratio', direction: 'lower', tolerance: 0, method: 'violations reported by constraints.checkPatch on the final patch, over constraints checked — warn-level violations included, because a warning is still a violation' },
  regression_detection_recall: { measured: true, kind: 'deterministic', unit: 'ratio', direction: 'higher', tolerance: 0, method: 'untracked edits injected into a project that explain_change classifies as unexpected, over untracked edits injected (curve and scene-graph difference only — no pixels in a headless run)' },
  regression_detection_false_positive_rate: { measured: true, kind: 'deterministic', unit: 'ratio', direction: 'lower', tolerance: 0, method: 'differences a recorded transaction fully explains that explain_change nevertheless classifies as unexpected, over differences a transaction explains' },
  correct_causal_diagnosis_rate: { measured: true, kind: 'deterministic', unit: 'ratio', direction: 'higher', tolerance: 0, method: 'contact drifts whose top-ranked cause from explain_motion_problem is the joint the benchmark broke on purpose, over drifts injected' },
  animation_intent_alignment: { measured: true, kind: 'deterministic', unit: 'ratio', direction: 'higher', tolerance: 0, method: 'acceptance checks the plan\'s own AcceptanceSpec could run that passed, over those that ran (0 when the pipeline refused to apply). A PROXY: amplitude rising is a fact, "it reads heavier" is not (ai/cal.js proxy_for)' },
  reference_alignment: { measured: true, kind: 'deterministic', unit: 'relative distance', direction: 'lower', tolerance: 1e-9, method: 'mean relative difference between the target item\'s Part 36 profile and the reference item\'s, over the dimensions ai/reference.js measures numerically (spacing variability, peak speed, peak angular speed), after the edit' },
  contact_stability: { measured: true, kind: 'deterministic', unit: 'studs', direction: 'lower', tolerance: 1e-9, method: 'the largest drift measureContactDrift reports across the benchmark\'s DECLARED contacts after the edit — measured against the effector\'s own position on the contact\'s first frame, because Cadence has no ground plane (MOT-008)' },
  curve_continuity: { measured: true, kind: 'deterministic', unit: 'count', direction: 'lower', tolerance: 0, method: 'acceleration spikes INTRODUCED by the edit on contact-capable parts: samples above 4× the subject\'s median acceleration (the convention ai/diagnose.js declares) after, minus the same count before. Not smoothness — heavier is allowed to add contrast' },
  visual_temporal_continuity: { measured: false, kind: 'visual', unit: 'count', direction: 'lower', blocked_by: 'flicker and one-frame pops need consecutive rendered frames; nothing in ai/ renders, and the observation policy targets suspect frames rather than sequences (OBS-*)' },
  vfx_timing_alignment: { measured: true, kind: 'deterministic', unit: 'frames', direction: 'lower', tolerance: 1e-9, method: 'distance in frames between the rate-envelope key the compiled effect actually carries and the frame the spec declared for it (peak, or end for a dissolve)' },
  camera_readability: { measured: false, kind: 'visual', unit: 'ratio', direction: 'higher', blocked_by: 'no active-camera model exists (SHOT-003/004); readability from a camera needs framing, which nothing here computes' },
  reproducibility: { measured: true, kind: 'deterministic', unit: 'boolean', direction: 'higher', tolerance: 0, method: 'the benchmark is run twice in one process and the two result hashes compared: 1 when identical, 0 when not' },
  export_success: { measured: false, kind: 'deterministic', unit: 'boolean', direction: 'higher', blocked_by: 'the export validator (renderer/js/validate.js) imports state.js and cannot run in the pure layer — the same gap that keeps export_valid unrunnable in ai/cal.js' },
  render_cost: { measured: false, kind: 'visual', unit: 'milliseconds', direction: 'lower', blocked_by: 'nothing renders in a headless run. The Electron smoketest can time a render; a number from it would belong in that run\'s report, not in a run that drew nothing' },
  tool_call_efficiency: { measured: false, kind: 'session', unit: 'calls', direction: 'lower', blocked_by: 'the count of MCP calls a MODEL needs to reach a result is a fact about the model\'s session, not about the pipeline; a benchmark makes a fixed number of calls by construction' },
  rollback_frequency: { measured: false, kind: 'session', unit: 'ratio', direction: 'lower', blocked_by: 'how often a human rolls a result back is session data; the transaction ledger and provenance carry it in a real session (ai/improve.js detectRecurringProblems reads it)' },
  user_approval_rate: { measured: false, kind: 'human', unit: 'ratio', direction: 'higher', blocked_by: 'approval is a human decision. It is recorded per proposal by ai/improve.js and per difference by approve_difference, never inferred' },
});

export const DIMENSION_IDS = Object.freeze(Object.keys(EVALUATION_DIMENSIONS));
export const MEASURED_DIMENSIONS = Object.freeze(DIMENSION_IDS.filter((d) => EVALUATION_DIMENSIONS[d].measured));

export const WHY_NO_OVERALL_SCORE = 'Part 59: "Do not optimize a metric in isolation. A faster system that damages user work is not better." One number would average a contact drift in studs against a recall rate, and a comparison that improved it could still have broken a planted foot. Verdicts are per dimension, per benchmark, and the counts are counts — not a score.';

/** The convention ai/diagnose.js declares for "notable" acceleration, reused rather than invented. */
const SPIKE_RATIO = DIAG.SPIKE_RATIO;
const NOTABLE_ACCEL = DIAG.NOTABLE_ACCEL;

// ---------------------------------------------------------------- implementations under test

/** Declared options a prototype can flip WITHOUT new code. Each is off in production and says
 *  exactly what it changes in the pipeline; a proposal names one, a run reports it. */
export const IMPLEMENTATION_OPTIONS = Object.freeze({
  prune_violating_ops: {
    default: false,
    changes: 'compilePlan is run with no constraints, then the operations that would violate a refusing constraint are dropped ONE BY ONE and the remainder re-checked — instead of the production rule that drops a whole strategy when any of its operations is refused (ai/plan.js compilePlan)',
    hypothesis_it_serves: 'an allow-list or a lock should narrow an edit, not cancel it',
  },
  protect_support_chains: {
    default: false,
    changes: 'after compilation, operations on the joints between a DECLARED planted contact\'s effector and the root are dropped inside the contact\'s frame range, so the support chain of a planted foot is never scaled or re-eased by a strategy',
    hypothesis_it_serves: 'a declared contact should be enforced by the planner, not only measured after the fact',
  },
});

const PRODUCTION_FUNCTIONS = Object.freeze({
  interpretRequest: INT.interpretRequest,
  compileConstraints: CON.compileConstraints,
  planMotion: PLAN.planMotion,
  compilePlan: PLAN.compilePlan,
  checkPatch: CON.checkPatch,
  evaluateAcceptance: CAL.evaluateAcceptance,
  explainChange: EXP.explainChange,
  compileSpec: VS.compileSpec,
  validateTiming: VS.validateTiming,
  measureContactDrift: MOTION.measureContactDrift,
  diagnose: DIAG.diagnose,
  sampleMotion: MOTION.sampleMotion,
  buildReferenceProfile: REF.buildReferenceProfile,
});

export const OVERRIDABLE_FUNCTIONS = Object.freeze(Object.keys(PRODUCTION_FUNCTIONS));

/**
 * Build the implementation a run measures.
 *
 *   makeImplementation()                                   production
 *   makeImplementation({ label, options: { ... } })         a declared-option prototype (no code)
 *   makeImplementation({ label, overrides: { planMotion } }) a code prototype
 *
 * Unknown option and override names throw: a prototype that silently changed nothing would
 * compare equal to production and read as "no effect".
 */
export function makeImplementation(spec = {}) {
  const options = { ...Object.fromEntries(Object.entries(IMPLEMENTATION_OPTIONS).map(([k, v]) => [k, v.default])) };
  for (const [k, v] of Object.entries(spec.options || {})) {
    if (!(k in IMPLEMENTATION_OPTIONS)) throw new TypeError(`makeImplementation: unknown option "${k}" (known: ${Object.keys(IMPLEMENTATION_OPTIONS).join(', ')})`);
    options[k] = !!v;
  }
  const fn = { ...PRODUCTION_FUNCTIONS };
  const overrides = [];
  for (const [k, v] of Object.entries(spec.overrides || {})) {
    if (!(k in PRODUCTION_FUNCTIONS)) throw new TypeError(`makeImplementation: "${k}" is not an overridable function (known: ${OVERRIDABLE_FUNCTIONS.join(', ')})`);
    if (typeof v !== 'function') throw new TypeError(`makeImplementation: override "${k}" must be a function`);
    fn[k] = v;
    overrides.push(k);
  }
  const optionsOn = Object.entries(options).filter(([, v]) => v).map(([k]) => k);
  const production = !overrides.length && !optionsOn.length;
  return {
    label: spec.label ?? (production ? 'production' : 'prototype'),
    production,
    options,
    options_on: optionsOn,
    overrides,
    fn,
  };
}

// ---------------------------------------------------------------- fixtures
//
// Built from the caller's rig table (`rigs/builtin.json`), so this module reads no files. Each is
// small and deliberately shaped: what matters is that the pipeline has something real to plan
// against, and that the numbers a run reports are reproducible.

function rigItem(rigs, key, id, name) {
  if (!rigs || !rigs[key]) throw new Error(`benchmark fixture: rig "${key}" was not supplied — pass rigs (the contents of rigs/builtin.json)`);
  return { id, kind: 'rig', name, rig: rigs[key], origin: I() };
}

function baseProject(id, name, items, tracks, markers, length = 60) {
  return {
    id, name, version: 1, fps: 30, length, loop: false, priority: 'Action',
    items, tracks, groups: [], markers,
    playRange: null, onionSkin: { enabledItemIds: [], range: 3 }, audio: null,
  };
}

const key = (t, v, es = 'Sine', ed = 'Out') => ({ t, v, es, ed });
const arc4 = (a, b, c = null) => ({ keys: [key(0, I()), key(8, a, 'Sine', 'InOut'), key(16, b), key(28, c ?? I())] });

/** A body-driven sword slash on an R15: the torso turns, the right arm swings, the left foot is
 *  keyed still (planted) while the turn drags it a little — which is what a static-origin slash
 *  does to a planted foot, and what the contact benchmarks measure. */
function slashFixture(rigs, { withSword = false, cleanRoot = false } = {}) {
  const hero = rigItem(rigs, 'r15', 'hero', 'Hero');
  const items = [hero];
  const tracks = {
    hero: {
      Root: cleanRoot ? { keys: [key(0, I()), key(28, I())] } : arc4(CF.fromEuler(0, 0.3, 0), CF.fromEuler(0, -0.4, 0)),
      Waist: arc4(CF.fromEuler(0, 0.4, 0), CF.fromEuler(0, -0.5, 0)),
      RightShoulder: arc4(CF.fromEuler(0, 0, 1.2), CF.fromEuler(0, 0, -0.9)),
      RightElbow: arc4(CF.fromEuler(0.6, 0, 0), CF.fromEuler(0.1, 0, 0)),
      LeftHip: cleanRoot ? { keys: [key(0, I()), key(28, I())] } : arc4(CF.fromEuler(0.2, 0, 0), CF.fromEuler(-0.2, 0, 0)),
      LeftAnkle: { keys: [key(0, I()), key(8, I()), key(16, I()), key(28, I())] },
    },
  };
  if (withSword) {
    items.push({ id: 'sword', kind: 'prop', name: 'Sword', className: 'Part', attachedTo: { itemId: 'hero', partId: 'RightHand', offset: I() } });
    tracks.sword = {};
  }
  return baseProject('bench-slash', 'Slash', items, tracks, { hero: [{ t: 16, width: 2, name: 'impact' }] });
}

/** A flinch: the body is hit at frame 4, recoils to a peak at 10 and recovers by 20. */
function flinchFixture(rigs) {
  const hero = rigItem(rigs, 'r15', 'hero', 'Hero');
  const k = (t, v, es = 'Quad', ed = 'Out') => key(t, v, es, ed);
  const tracks = {
    hero: {
      Waist: { keys: [k(0, I()), k(4, CF.fromEuler(-0.15, 0, 0), 'Quad', 'In'), k(10, CF.fromEuler(-0.55, 0.1, 0)), k(20, I())] },
      Neck: { keys: [k(0, I()), k(4, CF.fromEuler(-0.2, 0, 0), 'Quad', 'In'), k(10, CF.fromEuler(-0.6, 0, 0)), k(20, I())] },
      LeftShoulder: { keys: [k(0, I()), k(4, CF.fromEuler(0, 0, -0.3), 'Quad', 'In'), k(10, CF.fromEuler(0.4, 0, -1.1)), k(20, I())] },
      RightShoulder: { keys: [k(0, I()), k(4, CF.fromEuler(0, 0, 0.3), 'Quad', 'In'), k(10, CF.fromEuler(0.4, 0, 1.1)), k(20, I())] },
      LeftAnkle: { keys: [k(0, I()), k(20, I())] },
      RightAnkle: { keys: [k(0, I()), k(20, I())] },
    },
  };
  return baseProject('bench-flinch', 'Flinch', [hero], tracks, { hero: [{ t: 4, width: 1, name: 'hit' }] }, 40);
}

/** Two steps of a walk on a static origin: the stance leg holds while the swing leg travels, the
 *  pelvis yaws with the stride, the arms counter-swing. The yaw is what makes a static-origin walk
 *  drag its planted foot by a fraction of a stud — the contact benchmark's declared tolerance sits
 *  just above that authored drift, so an edit that scales the yaw breaks it and one that leaves the
 *  support chain alone does not. */
function walkFixture(rigs) {
  const hero = rigItem(rigs, 'r15', 'hero', 'Hero');
  const k = (t, v, es = 'Sine', ed = 'InOut') => key(t, v, es, ed);
  const tracks = {
    hero: {
      Root: { keys: [k(0, CF.fromEuler(0, 0.12, 0)), k(15, CF.fromEuler(0, -0.12, 0)), k(30, CF.fromEuler(0, 0.12, 0))] },
      Waist: { keys: [k(0, CF.fromEuler(0.06, -0.08, 0)), k(15, CF.fromEuler(0.06, 0.08, 0)), k(30, CF.fromEuler(0.06, -0.08, 0))] },
      // Left foot planted 0–15: the left hip holds; the right leg swings through.
      LeftHip: { keys: [k(0, I()), k(15, I()), k(30, CF.fromEuler(0.7, 0, 0))] },
      RightHip: { keys: [k(0, CF.fromEuler(0.7, 0, 0)), k(15, I()), k(30, I())] },
      LeftKnee: { keys: [k(0, I()), k(15, I()), k(30, CF.fromEuler(-0.6, 0, 0))] },
      RightKnee: { keys: [k(0, CF.fromEuler(-0.6, 0, 0)), k(15, I()), k(30, I())] },
      LeftAnkle: { keys: [k(0, I()), k(15, I()), k(30, I())] },
      RightAnkle: { keys: [k(0, I()), k(15, I()), k(30, I())] },
      LeftShoulder: { keys: [k(0, CF.fromEuler(-0.5, 0, 0)), k(15, CF.fromEuler(0.5, 0, 0)), k(30, CF.fromEuler(-0.5, 0, 0))] },
      RightShoulder: { keys: [k(0, CF.fromEuler(0.5, 0, 0)), k(15, CF.fromEuler(-0.5, 0, 0)), k(30, CF.fromEuler(0.5, 0, 0))] },
    },
  };
  return baseProject('bench-walk', 'Walk', [hero], tracks, { hero: [{ t: 0, width: 1, name: 'plant left' }, { t: 15, width: 1, name: 'plant right' }] }, 30);
}

/** Two rigs in one project: `ref` performs the slash at speed, `hero` performs the same poses at
 *  half the speed. The reference benchmark asks the hero to become snappier and measures whether
 *  its profile moved toward the reference's. */
function referenceFixture(rigs) {
  const fast = slashFixture(rigs, { cleanRoot: true });
  const ref = rigItem(rigs, 'r15', 'ref', 'Reference');
  const hero = rigItem(rigs, 'r15', 'hero', 'Hero');
  const slow = {};
  for (const [name, tr] of Object.entries(fast.tracks.hero)) {
    slow[name] = { keys: tr.keys.map((kf) => ({ ...kf, v: kf.v.slice(), t: kf.t * 2 })) };
  }
  return baseProject('bench-reference', 'Reference adaptation', [ref, hero], { ref: fast.tracks.hero, hero: slow }, {
    ref: [{ t: 16, width: 2, name: 'impact' }], hero: [{ t: 32, width: 2, name: 'impact' }],
  }, 60);
}

// ---------------------------------------------------------------- the pure pipeline
//
// The same chain `apply_motion_plan` drives in app.js, through the pure functions and against a
// working COPY of the fixture, so a benchmark never touches the project it was given. Every step
// is the implementation's own function, which is what makes a prototype comparable.

function resolveEffectorPart(project, itemId, effector) {
  const item = (project.items || []).find((i) => i.id === itemId);
  if (!item || !item.rig) return null;
  const r = MOTION.resolveEffector(project, item, effector);
  return r.part ? { item, part: r.part } : null;
}

/** IMPLEMENTATION_OPTIONS.protect_support_chains, as an op filter. */
function dropSupportChainOps(project, ops, contacts) {
  const protectedKeys = new Set();
  const chains = [];
  for (const c of contacts || []) {
    const eff = resolveEffectorPart(project, c.itemId, c.effector);
    if (!eff) continue;
    const chain = DIAG.ancestorMotors(eff.item, eff.part.id).filter((m) => m.kind === 'joint').map((m) => m.track);
    chains.push({ effector: c.effector, tracks: chain, range: [c.start, c.end] });
    for (const tr of chain) protectedKeys.add(`${c.itemId}|${tr}|${c.start}|${c.end}`);
  }
  const kept = [], dropped = [];
  for (const op of ops) {
    const hit = chains.some((ch) => ch.tracks.includes(op.track) && Number.isFinite(op.t) && op.t >= ch.range[0] - 1e-6 && op.t <= ch.range[1] + 1e-6);
    (hit ? dropped : kept).push(op);
  }
  return { ops: kept, dropped: dropped.length, chains };
}

/** IMPLEMENTATION_OPTIONS.prune_violating_ops: drop the individual operations a refusing
 *  constraint rejects, then re-check what is left. */
function pruneViolatingOps(project, impl, ops, constraints, frame) {
  let current = ops;
  let dropped = 0;
  // A violation names the op it hit; removing that op may not change what the others hit, so one
  // pass suffices in practice — the loop is a guard against a checker that reports lazily.
  for (let pass = 0; pass < 4 && current.length; pass++) {
    const trial = PATCH.makePatch({ ops: current, intent: 'prune trial', author: 'benchmark' });
    const plan = PATCH.planPatch(project, trial);
    const report = impl.fn.checkPatch(project, trial, constraints, { frame, result: plan.result });
    const refusing = report.violations.filter((v) => v.response === 'refuse');
    if (!refusing.length) break;
    const bad = new Set(refusing.map((v) => opFingerprint(v.op || v.operation || null)).filter(Boolean));
    if (!bad.size) break;
    const next = current.filter((o) => !bad.has(opFingerprint(o)));
    dropped += current.length - next.length;
    if (next.length === current.length) break;
    current = next;
  }
  return { ops: current, dropped };
}

function opFingerprint(op) {
  if (!op) return null;
  return `${op.op}|${op.itemId ?? ''}|${op.track ?? ''}|${op.t ?? ''}|${op.path ?? ''}`;
}

/**
 * Interpret → plan → compile → check → apply → evaluate, on a copy.
 *
 * Returns everything a measurement needs: the untouched `before`, the `after` copy, the compiled
 * plan, the constraint report on the final patch, the acceptance evaluation, and whether the
 * recorded inverse brought the copy back byte-identical.
 */
function runPlanPipeline(project, impl, { request, itemId, constrain = null, contacts = [], timestamp = null }) {
  const notes = [];
  const interp = impl.fn.interpretRequest(project, { request, itemId });
  const intentSpec = interp.intent;
  const extra = constrain
    ? impl.fn.compileConstraints(constrain, project, { source: constrain.source || 'user', author: 'benchmark', createdAt: timestamp })
    : { constraints: [], unparsed: [], questions: [] };
  const constraints = [...interp.constraints.constraints, ...extra.constraints];

  const planned = impl.fn.planMotion(project, { intent: intentSpec, itemId, constraints });
  let compiled;
  let pruned = 0;
  if (impl.options.prune_violating_ops) {
    compiled = impl.fn.compilePlan(project, planned.plan, planned.ctx, { constraints: [], frame: 0 });
    const p = pruneViolatingOps(project, impl, compiled.ops, constraints, 0);
    pruned = p.dropped;
    compiled = { ...compiled, ops: p.ops };
    if (pruned) notes.push(`prune_violating_ops dropped ${pruned} operation(s) a refusing constraint rejected, and kept the rest`);
  } else {
    compiled = impl.fn.compilePlan(project, planned.plan, planned.ctx, { constraints, frame: 0 });
  }
  let chainDrop = null;
  if (impl.options.protect_support_chains && contacts.length) {
    chainDrop = dropSupportChainOps(project, compiled.ops, contacts);
    compiled = { ...compiled, ops: chainDrop.ops };
    if (chainDrop.dropped) notes.push(`protect_support_chains dropped ${chainDrop.dropped} operation(s) on ${chainDrop.chains.map((c) => `${c.tracks.join('→')} (${c.effector})`).join('; ')}`);
  }

  const base = { interp, intent: intentSpec, constraints, planned, compiled, notes, pruned, chain_dropped: chainDrop?.dropped ?? 0 };
  if (!compiled.ops.length) {
    return { ...base, applied: false, refused_because: compiled.summary, before: project, after: project, report: null, acceptance: null, rollback_exact: null, txn: null, ledger: null };
  }

  const work = SNAP.cloneProject(project);
  const patch = PATCH.makePatch({ ops: compiled.ops, intent: `${intentSpec.request || intentSpec.id}: ${compiled.applied.map((a) => a.strategy).join(' + ')}`, request, author: 'benchmark' });
  const ledger = new TXN.TransactionLedger();
  const plan = PATCH.planPatch(work, patch);
  const report = impl.fn.checkPatch(work, patch, constraints, { frame: 0, result: plan.result });
  const txn = ledger.open({ request, intent: patch.intent, tool: 'benchmark', plan, constraints, author: 'benchmark', timestamp });
  const out = TXN.apply(work, patch, plan, { ledger, txn, constraintReport: report, timestamp });
  if (!out.applied) {
    return { ...base, applied: false, refused_because: out.reason ?? out.refused_because ?? 'refused', before: project, after: project, report, acceptance: null, rollback_exact: null, txn, ledger };
  }
  const after = SNAP.cloneProject(work);
  const acceptance = impl.fn.evaluateAcceptance(project, after, planned.plan.acceptance_criteria, { itemId });
  const rb = TXN.rollback(work, ledger, txn.transaction_id, { timestamp, author: 'benchmark' });
  const rollbackExact = !!rb.rolled_back && contentHash(SNAP.withoutHistory(work)) === contentHash(SNAP.withoutHistory(project));
  return { ...base, applied: true, refused_because: null, before: project, after, report, acceptance, rollback_exact: rollbackExact, txn, ledger };
}

/** Plan and commit a hand-built list of operations on a copy (the VFX and diagnosis benchmarks). */
function applyOps(project, impl, ops, { intent, constraints = [], timestamp = null }) {
  const work = SNAP.cloneProject(project);
  const patch = PATCH.makePatch({ ops, intent, author: 'benchmark' });
  const ledger = new TXN.TransactionLedger();
  const plan = PATCH.planPatch(work, patch);
  const report = impl.fn.checkPatch(work, patch, constraints, { frame: 0, result: plan.result });
  const txn = ledger.open({ intent, tool: 'benchmark', plan, constraints, author: 'benchmark', timestamp });
  const out = TXN.apply(work, patch, plan, { ledger, txn, constraintReport: report, timestamp });
  if (!out.applied) return { applied: false, refused_because: out.reason ?? 'refused', after: project, report, ledger, txn, rollback_exact: null };
  const after = SNAP.cloneProject(work);
  const rb = TXN.rollback(work, ledger, txn.transaction_id, { timestamp, author: 'benchmark' });
  const rollbackExact = !!rb.rolled_back && contentHash(SNAP.withoutHistory(work)) === contentHash(SNAP.withoutHistory(project));
  return { applied: true, refused_because: null, after, report, ledger, txn, rollback_exact: rollbackExact };
}

// ---------------------------------------------------------------- measurements
//
// Each returns `{ value, method }` or null when it cannot be measured on this benchmark. Nothing
// here judges: a direction is applied by `compareRuns`, and is a convention there.

function measureUnintended(before, after, allowedTracks, allowedItems = []) {
  const diff = SNAP.diffProjects(before, after);
  const allowedT = new Set(allowedTracks);
  const allowedI = new Set(allowedItems);
  const changed = diff.tracks.map((t) => `${t.itemId}/${t.track}`);
  const unintended = changed.filter((k) => !allowedT.has(k) && !allowedI.has(k.split('/')[0]));
  const itemsUnannounced = [...diff.items.added, ...diff.items.removed, ...diff.items.changed.map((c) => c.itemId)].filter((id) => !allowedI.has(id));
  const fields = diff.project_fields;
  const total = changed.length + itemsUnannounced.length + fields.length;
  const bad = unintended.length + itemsUnannounced.length + fields.length;
  return {
    value: total ? round6(bad / total) : 0,
    detail: { changed_tracks: changed.length, unintended_tracks: unintended, unannounced_items: itemsUnannounced, project_fields: fields },
  };
}

function measureViolations(report) {
  if (!report || !report.checked) return null;
  // A constraint whose target could not be resolved was never enforced, so it belongs in neither
  // the numerator nor the denominator: counting it as checked would read as a clean pass.
  const unresolved = (report.unresolved_targets || []).length;
  const evaluated = report.checked - unresolved;
  if (evaluated <= 0) return null;
  return {
    value: round6(report.violations.length / evaluated),
    detail: { checked: report.checked, evaluated, unresolved, violations: report.violations.map((v) => v.rule) },
  };
}

/** A declared constraint that could not be resolved is a benchmark defect, not a pass. */
function constraintsResolvedCheck(pipeline) {
  const name = 'every declared constraint was resolved and enforced';
  if (!pipeline.report) return { name, ok: null, detail: 'no patch reached the constraint checker' };
  const unresolved = pipeline.report.unresolved_targets || [];
  return { name, ok: unresolved.length === 0, detail: unresolved.length ? unresolved.map((u) => `${u.rule}: ${u.question || 'unresolved'}`).join('; ') : null };
}

function measureIntentAlignment(pipeline) {
  if (!pipeline.applied) return { value: 0, detail: { applied: false, reason: pipeline.refused_because } };
  const a = pipeline.acceptance;
  const ran = a.results.filter((r) => r.status !== 'not_run');
  const passed = ran.filter((r) => r.status === 'pass').length;
  return {
    value: ran.length ? round6(passed / ran.length) : 0,
    detail: { passed, ran: ran.length, not_run: a.results.length - ran.length, failed: ran.filter((r) => r.status === 'fail').map((r) => r.check), proxy: 'a passing acceptance check is a measured fact about the data, not a judgement that the motion reads as asked' },
  };
}

function measureContacts(project, impl, contacts) {
  if (!contacts || !contacts.length) return null;
  const per = contacts.map((c) => {
    const d = impl.fn.measureContactDrift(project, { itemId: c.itemId, effector: c.effector, start: c.start, end: c.end, tolerance_studs: c.tolerance_studs });
    return d.measured ? { effector: c.effector, max_drift_studs: d.max_drift_studs, within_tolerance: d.within_tolerance, tolerance_studs: c.tolerance_studs } : { effector: c.effector, not_measured: d.reason };
  });
  const measured = per.filter((p) => p.max_drift_studs !== undefined);
  if (!measured.length) return null;
  return { value: round6(Math.max(...measured.map((p) => p.max_drift_studs))), detail: { contacts: per, reference: 'the effector\'s own world position on the contact\'s first frame (MOT-008)' } };
}

function spikeCount(project, impl, itemId, frameRange = null) {
  const m = impl.fn.sampleMotion(project, { itemId, frameRange });
  let spikes = 0;
  const per = [];
  for (const s of m.subjects) {
    if (!s.contact_capable) continue;
    const acc = s.samples.map((x) => x.acceleration).filter((x) => x !== null && Number.isFinite(x));
    if (acc.length < 3) continue;
    const sorted = [...acc].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const n = acc.filter((a) => a > NOTABLE_ACCEL && a > SPIKE_RATIO * median).length;
    per.push({ part: s.part_id, spikes: n });
    spikes += n;
  }
  return { spikes, per };
}

function measureContinuity(pipeline, impl, itemId) {
  if (!pipeline.applied) return null;
  const before = spikeCount(pipeline.before, impl, itemId);
  const after = spikeCount(pipeline.after, impl, itemId);
  return { value: after.spikes - before.spikes, detail: { before: before.spikes, after: after.spikes, per_part_after: after.per, convention: `a spike is a sample above ${SPIKE_RATIO}× the subject's median acceleration and above ${NOTABLE_ACCEL} studs/frame² (ai/diagnose.js)` } };
}

function planAllowedTracks(pipeline) {
  return [...new Set((pipeline.compiled?.ops || []).map((o) => `${o.itemId}/${o.track}`))];
}

// ---------------------------------------------------------------- the benchmarks
//
// Each entry carries Part 59's fifteen fields plus what the runner needs: the category it belongs
// to, the dimensions it can measure, the tools its pipeline exercises (for Part 52's
// benchmark_coverage), and `run(ctx)`, which returns `{ measured, checks, after_hash, detail }`.

const PLAN_TOOLS = ['interpret_intent', 'plan_motion', 'apply_motion_plan', 'evaluate_acceptance', 'preview_animation_patch', 'apply_animation_patch', 'rollback_transaction', 'animation_vocabulary', 'analyze_contacts', 'analyze_motion'];
const VFX_TOOLS = ['compile_effect', 'validate_effect_timing', 'apply_animation_patch', 'rollback_transaction', 'list_shot_events', 'describe_shot'];

/** The walk fixture's planted feet each drift ~0.12 studs under the authored pelvis yaw; the
 *  tolerance sits above that so the fixture is clean and a scaled yaw is not. Measured, not guessed
 *  — see the walk_cycle entry. */
const WALK_PLANT_TOLERANCE = 0.14;

const REVIEW_RUBRIC_MOTION = ['intent_clarity', 'pose_readability', 'timing', 'weight', 'absence_of_distracting_artifacts'];
const REVIEW_RUBRIC_VFX = ['intent_clarity', 'vfx_integration', 'timing', 'absence_of_distracting_artifacts'];

function contactList(itemId, list) {
  return list.map((c) => ({ itemId, ...c }));
}

/** The plan-based benchmarks share one runner: plan the request, then measure the standard set. */
function planBenchmark(def) {
  return {
    ...def,
    dimensions: ['unintended_change_rate', 'constraint_violation_rate', 'animation_intent_alignment', 'contact_stability', 'curve_continuity', 'reproducibility'],
    exercises_tools: PLAN_TOOLS,
    technical_metrics: ['unintended_change_rate', 'constraint_violation_rate', 'animation_intent_alignment', ...(def.contacts?.length ? ['contact_stability'] : []), 'curve_continuity', 'reproducibility', 'rollback byte-identical'],
    visual_metrics: ['none in a headless run — the silhouette and object-ID passes need the Electron renderer (OBS-002/003)'],
    review_rubric: REVIEW_RUBRIC_MOTION,
    expected_artifacts: ['a transaction with a recorded inverse', 'an AcceptanceSpec evaluation', 'the compiled operation list', 'a contact-drift measurement per declared contact'],
    run(ctx) {
      const project = def.fixture(ctx.rigs);
      const contacts = contactList(def.itemId, def.contacts || []);
      const pipeline = runPlanPipeline(project, ctx.impl, { request: def.input_request, itemId: def.itemId, constrain: def.constrain ?? null, contacts, timestamp: ctx.timestamp });
      const measured = {};
      measured.unintended_change_rate = measureUnintended(pipeline.before, pipeline.after, planAllowedTracks(pipeline));
      const viol = measureViolations(pipeline.report);
      if (viol) measured.constraint_violation_rate = viol;
      measured.animation_intent_alignment = measureIntentAlignment(pipeline);
      const contact = measureContacts(pipeline.after, ctx.impl, contacts);
      if (contact) {
        const beforeDrift = measureContacts(pipeline.before, ctx.impl, contacts);
        contact.detail.before_edit_studs = beforeDrift?.value ?? null;
        measured.contact_stability = contact;
      }
      const cont = measureContinuity(pipeline, ctx.impl, def.itemId);
      if (cont) measured.curve_continuity = cont;
      const checks = [
        { name: 'the plan applied', ok: pipeline.applied, detail: pipeline.applied ? `${pipeline.compiled.ops.length} operation(s), strategies: ${pipeline.compiled.applied.map((a) => a.strategy).join(', ') || 'none'}` : pipeline.refused_because },
        // `ok: null` is "not applicable", distinct from a failure: a plan that never applied has
        // nothing to roll back, and counting that as a rollback failure would double-report.
        { name: 'rollback landed byte-identical', ok: pipeline.applied ? pipeline.rollback_exact === true : null, detail: pipeline.applied ? null : 'nothing was applied, so nothing was rolled back' },
        constraintsResolvedCheck(pipeline),
        ...(def.forbidden_checks ? def.forbidden_checks(pipeline) : []),
      ];
      return {
        measured, checks,
        after_hash: contentHash({ applied: pipeline.applied, after: pipeline.applied ? SNAP.withoutHistory(pipeline.after) : null, refused: pipeline.refused_because }),
        detail: {
          applied: pipeline.applied, refused_because: pipeline.refused_because,
          strategies_applied: pipeline.compiled.applied.map((a) => a.strategy), blocked: pipeline.compiled.blocked.map((b) => ({ strategy: b.strategy, reason: b.reason })),
          operations: pipeline.compiled.ops.length, pruned: pipeline.pruned, support_chain_dropped: pipeline.chain_dropped,
          acceptance: pipeline.acceptance ? pipeline.acceptance.summary : null,
          notes: pipeline.notes,
        },
      };
    },
  };
}

function keyTimesUnchanged(pipeline) {
  if (!pipeline.applied) return { name: 'no key changed time (forbidden variation)', ok: true, detail: 'nothing applied' };
  const diff = SNAP.diffProjects(pipeline.before, pipeline.after);
  const moved = diff.tracks.filter((t) => (t.keys_added || []).length || (t.keys_removed || []).length);
  return { name: 'no key changed time (forbidden variation)', ok: moved.length === 0, detail: moved.length ? moved.map((t) => t.track).join(', ') : null };
}

const PLAN_BENCHMARKS = {
  heavy_attack: planBenchmark({
    benchmark_id: 'heavy_attack', category: 'heavy attack',
    goal: 'a body-driven slash reads heavier without its timing changing and without the planted foot leaving its mark',
    scene_and_rig_prerequisites: 'builtin R15; a 28-frame slash on Root, Waist, RightShoulder, RightElbow, LeftHip; LeftAnkle keyed still; an "impact" marker at frame 16',
    input_request: 'make the slash heavier without changing timing',
    itemId: 'hero', fixture: (rigs) => slashFixture(rigs),
    reference_or_baseline: 'the fixture itself — the acceptance spec compares after against before',
    required_constraints: 'timing preserved (from the request); the left foot planted frames 0–28 within 0.3 studs (the fixture\'s own authored drift is 0.224 — the torso turn drags the foot on a static origin — so the tolerance sits above it, and a turn scaled by "heavier" crosses it)',
    // The effector is a ROLE PHRASE, not the part name. "left foot" resolves on both paths — the
    // constraint target (via ai/select.js, to the ankle track) and the drift measurement (to the
    // part). The part name "LeftFoot" resolves for the measurement only, and a constraint whose
    // target cannot be resolved is NOT enforced — which the "every declared constraint was
    // resolved" check below exists to catch, because that is how this benchmark first shipped
    // with a false zero violation rate.
    contacts: [{ effector: 'left foot', start: 0, end: 28, tolerance_studs: 0.3 }],
    constrain: { contacts: [{ effector: 'left foot', from: 0, to: 28, tolerance_studs: 0.3 }] },
    allowed_variation: 'rotation amplitude and easing on the hero\'s joint tracks',
    forbidden_variation: 'any key moving in time; any track outside the plan\'s operations; the planted foot exceeding its tolerance',
    performance_budget: { max_operations: 200, note: 'wall-clock is reported, never budgeted — a busy machine is not a regression' },
    known_failure_cases: ['amplitude scales the Root turn, which drags the planted foot past tolerance — this is the fixture\'s point, and what protect_support_chains exists to test', 'body-lead offsets are dropped whole because they move keys (timing is protected) — reported, not a failure'],
    human_acceptance_procedure: 'a reviewer scrubs before/after at frames 8, 16 and 28 and rates intent_clarity, weight and timing on the rubric; ratings are recorded with recordHumanRating and never enter the comparison',
    forbidden_checks: (p) => [keyTimesUnchanged(p)],
  }),
  light_attack: planBenchmark({
    benchmark_id: 'light_attack', category: 'light attack',
    goal: 'the same slash reads lighter: amplitude comes down without anything else moving',
    scene_and_rig_prerequisites: 'the heavy_attack fixture',
    input_request: 'make the slash lighter',
    itemId: 'hero', fixture: (rigs) => slashFixture(rigs),
    reference_or_baseline: 'the fixture itself',
    required_constraints: 'none declared — this benchmark measures what an unconstrained edit touches',
    allowed_variation: 'rotation amplitude and easing on the hero\'s joint tracks',
    forbidden_variation: 'any track outside the plan\'s operations',
    performance_budget: { max_operations: 200 },
    known_failure_cases: ['no constraint is declared, so constraint_violation_rate is not measured here — that is a fact about the benchmark, not a clean result'],
    human_acceptance_procedure: 'as heavy_attack, rating weight and intent_clarity',
  }),
  weapon_swing: planBenchmark({
    benchmark_id: 'weapon_swing', category: 'weapon swing',
    goal: 'a snappier swing changes the arm\'s spacing and reaches the sword through attachment without touching the sword\'s own data',
    scene_and_rig_prerequisites: 'the slash fixture plus a Part prop attached to RightHand',
    input_request: 'make the slash snappier',
    itemId: 'hero', fixture: (rigs) => slashFixture(rigs, { withSword: true }),
    reference_or_baseline: 'the fixture itself',
    required_constraints: 'none declared',
    allowed_variation: 'easing and amplitude on the hero; the sword moves only because it is attached',
    forbidden_variation: 'any operation on the sword item or its tracks',
    performance_budget: { max_operations: 200 },
    known_failure_cases: ['a strategy that wrote to the prop would show up as an unintended change'],
    human_acceptance_procedure: 'rate timing and intent_clarity from the side view at frames 8–16',
    forbidden_checks: (p) => [{ name: 'the sword was not edited directly', ok: !(p.compiled?.ops || []).some((o) => o.itemId === 'sword'), detail: null }],
  }),
  reaction: planBenchmark({
    benchmark_id: 'reaction', category: 'reaction animation',
    goal: 'a flinch reads snappier: the recoil concentrates without the hit frame moving',
    scene_and_rig_prerequisites: 'builtin R15; a 20-frame flinch on Waist, Neck and both shoulders; a "hit" marker at frame 4',
    input_request: 'make the flinch snappier, keep frame 4',
    itemId: 'hero', fixture: (rigs) => flinchFixture(rigs),
    reference_or_baseline: 'the fixture itself',
    required_constraints: 'frame 4 stays put (from the request)',
    allowed_variation: 'easing and amplitude after the hit',
    forbidden_variation: 'any key at frame 4 moving',
    performance_budget: { max_operations: 200 },
    known_failure_cases: ['a reaction template names its phases at `possible` certainty, so no easing direction is inverted — spacing_contrast changes the style only'],
    human_acceptance_procedure: 'rate timing and pose_readability at frames 4 and 10',
    forbidden_checks: (p) => [keyTimesUnchanged(p)],
  }),
  walk_cycle: planBenchmark({
    benchmark_id: 'walk_cycle', category: 'walk cycle',
    goal: 'two steps of a walk read heavier while both planted feet stay within tolerance',
    scene_and_rig_prerequisites: 'builtin R15; a 30-frame two-step walk on a static origin with alternating declared plants',
    input_request: 'make the walk heavier without changing timing',
    itemId: 'hero', fixture: (rigs) => walkFixture(rigs),
    reference_or_baseline: 'the fixture itself',
    required_constraints: 'timing preserved (from the request); the left foot planted 0–15 and the right foot planted 15–30, each within WALK_PLANT_TOLERANCE studs — set just above the drift the authored pelvis yaw already produces on a static origin, so a yaw scaled by "heavier" crosses it',
    contacts: [{ effector: 'left foot', start: 0, end: 15, tolerance_studs: WALK_PLANT_TOLERANCE }, { effector: 'right foot', start: 15, end: 30, tolerance_studs: WALK_PLANT_TOLERANCE }],
    constrain: { contacts: [{ effector: 'left foot', from: 0, to: 15, tolerance_studs: WALK_PLANT_TOLERANCE }, { effector: 'right foot', from: 15, to: 30, tolerance_studs: WALK_PLANT_TOLERANCE }] },
    allowed_variation: 'amplitude and easing on the swing leg, pelvis and arms',
    forbidden_variation: 'a planted foot exceeding its tolerance; any key moving in time',
    performance_budget: { max_operations: 300 },
    known_failure_cases: ['the pelvis yaw is scaled by weight_transfer, which moves both planted feet — the benchmark exists to measure exactly that', 'there is no locomotion state model (MOT-016): the plants are DECLARED, and a foot the fixture meant to plant without declaring is not checked'],
    human_acceptance_procedure: 'rate weight and absence_of_distracting_artifacts across the two steps',
    forbidden_checks: (p) => [keyTimesUnchanged(p)],
  }),
  constrained_correction: planBenchmark({
    benchmark_id: 'constrained_correction', category: 'constrained correction',
    goal: 'a heavier slash under an allow-list, a lock and a protected impact frame: the edit stays inside the allowed scope or is refused',
    scene_and_rig_prerequisites: 'the heavy_attack fixture',
    input_request: 'make the slash heavier',
    itemId: 'hero', fixture: (rigs) => slashFixture(rigs),
    reference_or_baseline: 'the fixture itself',
    required_constraints: 'only RightShoulder and RightElbow may change (allow-list, Part 54); LeftHip is locked; frame 16 is protected within 1 frame',
    constrain: {
      allow: [{ kind: 'track', itemId: 'hero', track: 'RightShoulder' }, { kind: 'track', itemId: 'hero', track: 'RightElbow' }],
      lock: [{ kind: 'track', itemId: 'hero', track: 'LeftHip' }],
      protect_frames: [{ frame: 16, tolerance: 1 }],
    },
    allowed_variation: 'amplitude and easing on the two allowed arm tracks',
    forbidden_variation: 'any operation on Root, Waist, LeftHip or LeftAnkle; any key moving near frame 16',
    performance_budget: { max_operations: 100 },
    known_failure_cases: ['production compilePlan drops a WHOLE strategy when any one of its operations is refused, so an allow-list of two tracks can cancel the edit entirely — measured here as intent alignment 0, and the hypothesis prune_violating_ops exists to test'],
    human_acceptance_procedure: 'confirm only the right arm moved; rate intent_clarity',
    forbidden_checks: (p) => [
      { name: 'no operation left the allowed scope', ok: !(p.compiled?.ops || []).some((o) => o.itemId === 'hero' && !['RightShoulder', 'RightElbow'].includes(o.track)), detail: null },
      keyTimesUnchangedNear(p, 16, 1),
    ],
  }),
};

/** Like keyTimesUnchanged, but only inside a protected window — the request here protects frame
 *  16, not every key, so a body-lead offset elsewhere is allowed variation. */
function keyTimesUnchangedNear(pipeline, frame, tolerance) {
  const name = `no key inside frame ${frame} ±${tolerance} changed time (forbidden variation)`;
  if (!pipeline.applied) return { name, ok: true, detail: 'nothing applied' };
  const diff = SNAP.diffProjects(pipeline.before, pipeline.after);
  const inWindow = (t) => Math.abs(t - frame) <= tolerance + 1e-6;
  const hit = diff.tracks.filter((t) => (t.keys_added || []).some(inWindow) || (t.keys_removed || []).some(inWindow));
  return { name, ok: hit.length === 0, detail: hit.length ? hit.map((t) => t.track).join(', ') : null };
}

// ---- regression detection (Part 44, curve level)

const REGRESSION_BENCHMARK = {
  benchmark_id: 'regression_detection', category: 'regression detection',
  goal: 'after one recorded edit and two untracked ones, explain_change flags exactly the untracked ones as unexpected and never the recorded one',
  scene_and_rig_prerequisites: 'the slash fixture',
  input_request: 'apply one transactional key edit on RightShoulder; then, outside any transaction, change a RightElbow key and add a LeftHip key; then ask what changed',
  reference_or_baseline: 'the fixture before any edit, as the before-state',
  required_constraints: 'none — this benchmark measures detection, not enforcement',
  allowed_variation: 'the recorded edit',
  forbidden_variation: 'the two untracked edits — which is the point: they must be caught',
  technical_metrics: ['regression_detection_recall', 'regression_detection_false_positive_rate', 'reproducibility'],
  visual_metrics: ['none — curve and scene-graph difference only; the rendered comparison (OBS-002/003) needs the Electron renderer'],
  review_rubric: ['absence_of_distracting_artifacts'],
  expected_artifacts: ['an explain_change report with per-difference classification and ranked causes'],
  performance_budget: { max_differences_reported: 10 },
  known_failure_cases: ['a difference on a track the transaction touched but at a key it did not claim is classified from the entity list, so an over-broad changed_entities would read as expected'],
  human_acceptance_procedure: 'none — the outcome is deterministic and a human adds nothing to it',
  dimensions: ['regression_detection_recall', 'regression_detection_false_positive_rate', 'reproducibility'],
  exercises_tools: ['snapshot_scene', 'diff_snapshots', 'explain_change', 'apply_animation_patch', 'list_transactions', 'rollback_transaction'],
  run(ctx) {
    const before = slashFixture(ctx.rigs);
    const tracked = applyOps(before, ctx.impl, [
      { op: 'set_key', itemId: 'hero', track: 'RightShoulder', t: 8, value: CF.fromEuler(0, 0, 1.6) },
    ], { intent: 'recorded shoulder edit', timestamp: ctx.timestamp });
    const after = SNAP.cloneProject(tracked.after);
    // Two edits made the way the UI makes them: directly, with no transaction.
    after.tracks.hero.RightElbow.keys[1].v = CF.fromEuler(0.9, 0, 0);
    after.tracks.hero.LeftHip.keys.push({ t: 12, v: CF.fromEuler(0.5, 0, 0), es: 'Sine', ed: 'Out' });
    after.tracks.hero.LeftHip.keys.sort((a, b) => a.t - b.t);
    const injected = ['hero/RightElbow', 'hero/LeftHip'];
    const claimed = ['hero/RightShoulder'];

    const out = ctx.impl.fn.explainChange({ before, after, transactions: tracked.ledger.list().transactions, timestamp: ctx.timestamp });
    // A difference answers Part 44's ten questions by name — `where_did_it_change`, not `where`.
    const byTrack = (k) => out.differences.filter((d) => d.where_did_it_change && `${d.where_did_it_change.item}/${d.where_did_it_change.track}` === k);
    const caught = injected.filter((k) => byTrack(k).some((d) => d.classification === EXP.CLASSIFICATION.UNEXPECTED));
    const falsePositives = claimed.filter((k) => byTrack(k).some((d) => d.classification === EXP.CLASSIFICATION.UNEXPECTED));
    const measured = {
      regression_detection_recall: { value: round6(caught.length / injected.length), detail: { injected, caught, classifications: out.classification_counts } },
      regression_detection_false_positive_rate: { value: round6(falsePositives.length / claimed.length), detail: { claimed, flagged_as_unexpected: falsePositives } },
    };
    const checks = [
      { name: 'the recorded edit applied', ok: tracked.applied, detail: tracked.refused_because },
      { name: 'the recorded edit is classified expected', ok: byTrack('hero/RightShoulder').every((d) => d.classification === EXP.CLASSIFICATION.EXPECTED), detail: null },
      { name: 'a minimum safe correction is offered for an unexpected difference', ok: !!out.minimum_safe_correction && out.minimum_safe_correction.action !== null, detail: out.minimum_safe_correction?.action ?? null },
    ];
    return {
      measured, checks,
      after_hash: contentHash({ differences: out.differences.map((d) => [d.kind, d.where, d.classification]) }),
      detail: { differences: out.differences.length, classification_counts: out.classification_counts, ranked_causes: out.ranked_causes.map((c) => c.kind) },
    };
  },
};

// ---- causal diagnosis of a broken contact (Part 46)

const CONTACT_BENCHMARK = {
  benchmark_id: 'contact_diagnosis', category: 'character-to-environment contact',
  goal: 'a planted foot is broken by one known joint edit among two edits; the "why?" diagnostic names that joint as the top cause',
  scene_and_rig_prerequisites: 'the slash fixture with a still Root and LeftHip, so the left foot is genuinely planted before the edit',
  input_request: 'set LeftHip at frame 8 to 0.5 rad (the cause) and RightShoulder at frame 8 to 1.6 rad (a distractor that cannot move the foot); ask why the contact is unstable',
  reference_or_baseline: 'the fixture before the edit — the contact is measured against the effector\'s own first-frame position',
  required_constraints: 'the left foot planted frames 0–28 within 0.05 studs',
  allowed_variation: 'the two edits',
  forbidden_variation: 'none — the breakage is deliberate',
  technical_metrics: ['correct_causal_diagnosis_rate', 'contact_stability', 'reproducibility'],
  visual_metrics: ['none'],
  review_rubric: ['absence_of_distracting_artifacts'],
  expected_artifacts: ['an explain_motion_problem response with ranked, counterfactually attributed causes'],
  performance_budget: { max_candidates_considered: 8 },
  known_failure_cases: ['a drift produced only by two joints in combination is reported as unattributed, because each ancestor is frozen one at a time (EXP-002)'],
  human_acceptance_procedure: 'none — deterministic',
  dimensions: ['correct_causal_diagnosis_rate', 'contact_stability', 'reproducibility'],
  exercises_tools: ['apply_animation_patch', 'analyze_contacts', 'explain_motion_problem', 'rollback_transaction'],
  run(ctx) {
    const before = slashFixture(ctx.rigs, { cleanRoot: true });
    const contact = { itemId: 'hero', effector: 'left foot', start: 0, end: 28, tolerance_studs: 0.05 };
    const edit = applyOps(before, ctx.impl, [
      { op: 'set_key', itemId: 'hero', track: 'LeftHip', t: 8, value: CF.fromEuler(0.5, 0, 0) },
      { op: 'set_key', itemId: 'hero', track: 'RightShoulder', t: 8, value: CF.fromEuler(0, 0, 1.6) },
    ], { intent: 'break the plant on purpose', timestamp: ctx.timestamp });
    const drift = measureContacts(edit.after, ctx.impl, [contact]);
    const why = ctx.impl.fn.diagnose(edit.after, { question: 'why_is_this_contact_unstable', ...contact });
    // Part 46's response names its ranked list `likely_causes`; each cause carries the entity it
    // blames in `target` (an ai/ids.js track id) and a human `cause` string.
    const ranked = why.likely_causes || [];
    const top = ranked[0] || null;
    const topTrack = top ? String(top.target || top.cause || '') : '';
    const correct = /LeftHip/.test(topTrack);
    const measured = {
      correct_causal_diagnosis_rate: { value: correct ? 1 : 0, detail: { expected_cause: 'LeftHip', top_cause: topTrack || null, ranked: ranked.map((c) => c.target || c.cause) } },
      ...(drift ? { contact_stability: drift } : {}),
    };
    const checks = [
      { name: 'the two edits applied', ok: edit.applied, detail: edit.refused_because },
      { name: 'the contact measures as broken', ok: !!drift && drift.value > contact.tolerance_studs, detail: drift ? `${drift.value} studs against ${contact.tolerance_studs}` : 'not measured' },
      { name: 'the distractor is not the top cause', ok: !/RightShoulder/.test(topTrack), detail: null },
      { name: 'rollback landed byte-identical', ok: edit.rollback_exact === true, detail: null },
    ];
    return {
      measured, checks,
      after_hash: contentHash({ ranked: ranked.map((c) => [c.target || c.cause, c.share_of_drift ?? null]), drift: drift?.value ?? null }),
      detail: { confidence: why.confidence ?? null, header: why.header ?? null, ranked: ranked.slice(0, 3) },
    };
  },
};

// ---- the VFX family (Parts 37–41): one runner, several effects

function ratePeakOf(project, itemId) {
  const keys = project.tracks?.[itemId]?.['@rate']?.keys || [];
  if (!keys.length) return null;
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  let peak = sorted[0];
  for (const k of sorted) if ((k.v ?? -Infinity) > (peak.v ?? -Infinity)) peak = k;
  const nonzero = sorted.filter((k) => (k.v ?? 0) > 0);
  const end = sorted[sorted.length - 1];
  return { peak_frame: peak.t, peak_rate: peak.v, end_frame: end.t, first_frame: sorted[0].t, keys: sorted.length, last_nonzero_frame: nonzero.length ? nonzero[nonzero.length - 1].t : null };
}

function vfxBenchmark(def) {
  return {
    ...def,
    scene_and_rig_prerequisites: def.scene_and_rig_prerequisites ?? 'the slash fixture, whose "impact" marker at frame 16 is the trigger event',
    reference_or_baseline: 'the spec\'s own declared timing — the compiled envelope is measured against it',
    required_constraints: 'none beyond the spec: the effect must attach where declared and peak when declared',
    allowed_variation: 'the one emitter item the spec compiles to, and its @rate envelope',
    forbidden_variation: 'any change to the hero\'s tracks; a second emitter; an envelope that never returns to zero',
    technical_metrics: ['vfx_timing_alignment', 'unintended_change_rate', 'reproducibility', 'attached to the declared part', 'rollback byte-identical'],
    visual_metrics: ['none — particle density, flicker and depth integration are VFX-008/009 and need the renderer'],
    review_rubric: REVIEW_RUBRIC_VFX,
    expected_artifacts: ['an add_item operation with its remove_item inverse', 'a four-key @rate envelope', 'validate_effect_timing findings'],
    performance_budget: { max_particles: def.specs.reduce((a, s) => a + (s.budget?.maxParticles ?? 200), 0) },
    known_failure_cases: def.known_failure_cases ?? ['a VFXSpec compiles to ONE emitter — no beams, meshes, light or sound (vfxspec.js VFXSPEC_FIELDS.absent)'],
    human_acceptance_procedure: 'a reviewer scrubs the emitter through its envelope in the app and rates vfx_integration and timing',
    dimensions: ['vfx_timing_alignment', 'unintended_change_rate', 'reproducibility'],
    exercises_tools: VFX_TOOLS,
    run(ctx) {
      const before = (def.fixture || ((rigs) => slashFixture(rigs)))(ctx.rigs);
      let project = before;
      const created = [];
      const deviations = [];
      const checks = [];
      let ledgerTail = null;
      for (const spec of def.specs) {
        const compiled = ctx.impl.fn.compileSpec(project, spec);
        if (!compiled.ok) {
          checks.push({ name: `"${spec.primitive}" compiled`, ok: false, detail: compiled.summary });
          continue;
        }
        const applied = applyOps(project, ctx.impl, compiled.ops, { intent: `compile ${spec.primitive}`, timestamp: ctx.timestamp });
        checks.push({ name: `"${spec.primitive}" compiled and applied`, ok: applied.applied, detail: applied.refused_because });
        if (!applied.applied) continue;
        checks.push({ name: `"${spec.primitive}" rollback landed byte-identical`, ok: applied.rollback_exact === true, detail: null });
        ledgerTail = applied;
        project = applied.after;
        const item = project.items.find((i) => i.id === compiled.item.id);
        const attachedOk = !!item && item.attachedTo?.itemId === spec.anchor.itemId && (!spec.anchor.partId || item.attachedTo?.partId === spec.anchor.partId);
        checks.push({ name: `"${spec.primitive}" is attached where declared`, ok: attachedOk, detail: item ? JSON.stringify(item.attachedTo) : 'item missing' });
        const env = ratePeakOf(project, compiled.item.id);
        const intended = def.measure === 'end' ? compiled.timing.end_frame : compiled.timing.peak_frame;
        const achieved = env ? (def.measure === 'end' ? env.end_frame : env.peak_frame) : null;
        deviations.push({ primitive: spec.primitive, intended, achieved, deviation: achieved === null ? null : Math.abs(achieved - intended), envelope: env });
        created.push(compiled.item.id);
      }
      const tv = project === before ? { findings: [] } : ctx.impl.fn.validateTiming(project);
      const hard = tv.findings.filter((f) => /^VFX-(NO-ENVELOPE|ENVELOPE-VALUELESS)/.test(f.id));
      checks.push({ name: 'every emitter carries a timed envelope', ok: hard.length === 0 && created.length === def.specs.length, detail: hard.map((f) => f.statement).join('; ') || null });
      const measuredDeviations = deviations.filter((d) => d.deviation !== null);
      const measured = {
        unintended_change_rate: measureUnintended(before, project, created.flatMap((id) => Object.keys(project.tracks?.[id] || {}).map((t) => `${id}/${t}`)), created),
      };
      if (measuredDeviations.length) {
        measured.vfx_timing_alignment = { value: round6(Math.max(...measuredDeviations.map((d) => d.deviation))), detail: { per_effect: deviations, measured: def.measure === 'end' ? 'end frame of the envelope' : 'peak frame of the envelope' } };
      }
      if (def.extra_checks) checks.push(...def.extra_checks(project, before, created));
      return {
        measured, checks,
        after_hash: contentHash({ created, after: SNAP.withoutHistory(project), deviations: deviations.map((d) => [d.primitive, d.deviation]) }),
        detail: { created, deviations, timing_findings: tv.findings.map((f) => f.id), rollback: ledgerTail ? ledgerTail.rollback_exact : null },
      };
    },
  };
}

const anchorHand = { itemId: 'hero', partId: 'RightHand' };
const anchorFoot = { itemId: 'hero', partId: 'LeftFoot' };

const VFX_BENCHMARKS = {
  sparks: vfxBenchmark({
    benchmark_id: 'sparks', category: 'sparks',
    goal: 'sparks burst from the weapon hand exactly at impact and are gone within a short decay',
    input_request: 'a muzzle-spark burst on RightHand, timed to the "impact" event, lead 0, decay 4',
    specs: [{ primitive: 'muzzle-spark', theme: 'ember', scale: 'standard', role: 'primary', anchor: anchorHand, timing: { event: 'impact', lead: 0, attack: 1, sustain: 0, decay: 4 } }],
  }),
  dust_impact: vfxBenchmark({
    benchmark_id: 'dust_impact', category: 'dust impact',
    goal: 'dust rises from the planted foot one frame AFTER the impact — a physically motivated lag, not simultaneity (Part 39)',
    input_request: 'dust-motes on LeftFoot, timed to "impact" with a one-frame lag (lead −1), supporting role',
    specs: [{ primitive: 'dust-motes', theme: 'classic', scale: 'large', role: 'supporting', anchor: anchorFoot, timing: { event: 'impact', lead: -1, attack: 2, sustain: 2, decay: 10 } }],
    known_failure_cases: ['a negative lead is a lag; getting the sign backwards would put the dust BEFORE the foot lands, which Part 41 lists as a detectable defect'],
  }),
  smoke: vfxBenchmark({
    benchmark_id: 'smoke', category: 'smoke',
    goal: 'smoke continues after the action as a consequence: a long sustain and decay, residual role, budget shared down',
    input_request: 'smoke on RightHand, timed to "impact", sustain 8, decay 20, residual role with a 200-particle ask',
    specs: [{ primitive: 'smoke', theme: 'classic', scale: 'standard', role: 'residual', anchor: anchorHand, timing: { event: 'impact', lead: 0, attack: 2, sustain: 8, decay: 20 }, budget: { maxParticles: 200 } }],
    extra_checks: (after, _before, created) => [{
      name: 'the residual role took 25% of the asked budget',
      ok: created.length === 1 && after.items.find((i) => i.id === created[0])?.emitter?.maxParticles === 50,
      detail: created.length ? String(after.items.find((i) => i.id === created[0])?.emitter?.maxParticles) : 'no item',
    }],
  }),
  explosion: vfxBenchmark({
    benchmark_id: 'explosion', category: 'explosion',
    goal: 'debris spreads after the impact, peaking one frame late and decaying over a long tail',
    input_request: 'explosion-debris on RightHand, timed to "impact" with lead −1, decay 14, primary role',
    specs: [{ primitive: 'explosion-debris', theme: 'ember', scale: 'large', role: 'primary', anchor: anchorHand, timing: { event: 'impact', lead: -1, attack: 1, sustain: 1, decay: 14 } }],
  }),
  magic_effect: vfxBenchmark({
    benchmark_id: 'magic_effect', category: 'magic effect',
    goal: 'a charge glow peaks three frames BEFORE the hit (Part 39: "a charge glow may begin before the attack")',
    input_request: 'mana-burst on RightHand, timed to "impact" with lead 3, attack 6',
    specs: [{ primitive: 'mana-burst', theme: 'arcane', scale: 'standard', role: 'primary', anchor: anchorHand, timing: { event: 'impact', lead: 3, attack: 6, sustain: 0, decay: 5 } }],
  }),
  effect_dissolve: vfxBenchmark({
    benchmark_id: 'effect_dissolve', category: 'effect dissolve',
    goal: 'an aura dissolves by a declared frame: the envelope ENDS where the spec says, not merely peaks',
    input_request: 'arcane-sparkle on RightHand, timed to "impact", sustain 4, decay 16 — the end frame is the measured quantity',
    measure: 'end',
    specs: [{ primitive: 'arcane-sparkle', theme: 'arcane', scale: 'small', role: 'residual', anchor: anchorHand, timing: { event: 'impact', lead: 0, attack: 2, sustain: 4, decay: 16 } }],
  }),
  impact_event: vfxBenchmark({
    benchmark_id: 'impact_event', category: 'impact event',
    goal: 'one shot event drives two effects: sparks at the hand on the frame, dust at the foot one frame later, and both stay attached and timed (Part 41)',
    input_request: 'sparks on RightHand at "impact" and dust on LeftFoot lagging it by one frame',
    specs: [
      { primitive: 'muzzle-spark', theme: 'ember', scale: 'standard', role: 'primary', anchor: anchorHand, timing: { event: 'impact', lead: 0, attack: 1, sustain: 0, decay: 4 } },
      { primitive: 'dust-motes', theme: 'classic', scale: 'standard', role: 'supporting', anchor: anchorFoot, timing: { event: 'impact', lead: -1, attack: 2, sustain: 1, decay: 8 } },
    ],
    extra_checks: (after) => {
      const tl = EVENTS.buildTimeline(after);
      const impact = tl.events.find((e) => e.name === 'impact');
      return [{ name: 'the shared event timeline still carries the impact the effects are timed to', ok: !!impact && impact.frame === 16, detail: impact ? `frame ${impact.frame}` : 'missing' }];
    },
  }),
};

// ---- reference adaptation (Part 36)

function numericProfile(profile) {
  const out = {};
  for (const s of profile.dimensions.spacing.per_subject || []) if (s.variability !== null) out[`spacing_variability:${s.part}`] = s.variability;
  for (const s of profile.dimensions.energy.per_subject || []) {
    if (s.peak_speed !== null) out[`peak_speed:${s.part}`] = s.peak_speed;
    if (s.peak_angular_speed_deg !== null) out[`peak_angular_speed_deg:${s.part}`] = s.peak_angular_speed_deg;
  }
  return out;
}

function profileDistance(ref, target) {
  const a = numericProfile(ref), b = numericProfile(target);
  const keys = Object.keys(a).filter((k) => k in b && Math.abs(a[k]) > 1e-9);
  if (!keys.length) return null;
  const rel = keys.map((k) => Math.abs(b[k] - a[k]) / Math.abs(a[k]));
  return { value: round6(rel.reduce((x, y) => x + y, 0) / rel.length), keys: keys.length };
}

const REFERENCE_BENCHMARK = {
  benchmark_id: 'reference_adaptation', category: 'reference adaptation',
  goal: 'a slow performance asked to become snappier moves its measured profile toward a fast reference of the same poses, without copying the reference\'s keys',
  scene_and_rig_prerequisites: 'two builtin R15s in one project: "ref" performs the slash in 28 frames, "hero" performs the same poses in 56',
  input_request: 'make the hero snappier (the reference is measured, never applied)',
  reference_or_baseline: 'the reference item\'s Part 36 profile, built by ai/reference.js',
  required_constraints: 'none — the comparison is advisory (Part 36)',
  allowed_variation: 'easing and amplitude on the hero',
  forbidden_variation: 'any operation on the reference item; any hero key moving in time',
  technical_metrics: ['reference_alignment', 'unintended_change_rate', 'constraint_violation_rate', 'reproducibility'],
  visual_metrics: ['none'],
  review_rubric: ['timing', 'style_fit'],
  expected_artifacts: ['two profiles (reference, hero after) and their numeric distance'],
  performance_budget: { max_operations: 200 },
  known_failure_cases: ['only 3 numeric profile dimensions exist to compare (spacing variability, peak speed, peak angular speed) — alignment on the other 12 is not measured, and the number here is a sample of the profile, not the profile'],
  human_acceptance_procedure: 'a reviewer plays ref and hero side by side and rates timing and style_fit',
  dimensions: ['reference_alignment', 'unintended_change_rate', 'constraint_violation_rate', 'reproducibility'],
  exercises_tools: ['store_reference_profile', ...PLAN_TOOLS],
  run(ctx) {
    const project = referenceFixture(ctx.rigs);
    const refProfile = ctx.impl.fn.buildReferenceProfile(project, { itemId: 'ref', label: 'benchmark reference' });
    const pipeline = runPlanPipeline(project, ctx.impl, { request: 'make the slash snappier', itemId: 'hero', constrain: { preserve: [{ kind: 'item', itemId: 'ref' }] }, timestamp: ctx.timestamp });
    const beforeProfile = ctx.impl.fn.buildReferenceProfile(project, { itemId: 'hero' });
    const afterProfile = ctx.impl.fn.buildReferenceProfile(pipeline.after, { itemId: 'hero' });
    const dBefore = profileDistance(refProfile, beforeProfile);
    const dAfter = profileDistance(refProfile, afterProfile);
    const measured = {
      unintended_change_rate: measureUnintended(pipeline.before, pipeline.after, planAllowedTracks(pipeline)),
    };
    const viol = measureViolations(pipeline.report);
    if (viol) measured.constraint_violation_rate = viol;
    if (dAfter) measured.reference_alignment = { value: dAfter.value, detail: { before_edit: dBefore?.value ?? null, compared_values: dAfter.keys, note: 'relative distance over the numeric profile dimensions; lower is closer to the reference' } };
    const checks = [
      { name: 'the plan applied', ok: pipeline.applied, detail: pipeline.refused_because },
      { name: 'the reference item was not touched', ok: !(pipeline.compiled?.ops || []).some((o) => o.itemId === 'ref'), detail: null },
      { name: 'rollback landed byte-identical', ok: pipeline.applied ? pipeline.rollback_exact === true : null, detail: null },
      constraintsResolvedCheck(pipeline),
      keyTimesUnchanged(pipeline),
    ];
    return {
      measured, checks,
      after_hash: contentHash({ applied: pipeline.applied, after: pipeline.applied ? SNAP.withoutHistory(pipeline.after) : null }),
      detail: { distance_before: dBefore?.value ?? null, distance_after: dAfter?.value ?? null, strategies_applied: pipeline.compiled.applied.map((a) => a.strategy) },
    };
  },
};

export const BENCHMARKS = Object.freeze({
  ...PLAN_BENCHMARKS,
  regression_detection: REGRESSION_BENCHMARK,
  contact_diagnosis: CONTACT_BENCHMARK,
  ...VFX_BENCHMARKS,
  reference_adaptation: REFERENCE_BENCHMARK,
});

export const BENCHMARK_IDS = Object.freeze(Object.keys(BENCHMARKS));

/** What blocks the categories no benchmark is defined for. Named per category, never grouped. */
const UNDEFINED_CATEGORIES = Object.freeze({
  'idle breathing and subtle weight shift': 'no strategy generates motion (CMP-001 edits existing keys) and an idle has no phase template (Part 20.2 — gesture/idle spans stay unnamed), so nothing measurable distinguishes a good idle edit from a no-op beyond what light_attack already measures',
  'run cycle': 'walk_cycle proves the mechanism (declared alternating plants under a heavier edit). A run needs a flight phase, which is a contact the animator did NOT declare — and nothing infers a contact (MOT-016)',
  'start and stop': 'needs root motion (@origin) to accelerate and decelerate; no strategy writes @origin (plan.planLimitations)',
  'jump and landing': 'needs a compression/landing model (Part 30) and a detected, not declared, airborne phase (MOT-016)',
  'turn and pivot': 'a pivot is a sliding contact by design (CONTACT_MODES sliding) and nothing measures a sliding contact against an intended path — MOT-008 measures drift from a point',
  'dodge': 'needs root motion and a target to dodge from; neither is modelled',
  'layered upper-body action': 'Cadence has no animation layers or blend weights — SEM-015 reports layer/blend_mode/weight as null',
  'camera follow': 'no active-camera model (SHOT-003/004); a camera is an item with @origin and @fov tracks and nothing measures framing',
  'complex character, VFX, and camera shot': 'the character and VFX halves exist separately (heavy_attack, impact_event); the camera half is blocked as above, and a benchmark that omitted it would not be this category',
});

export function listBenchmarks() {
  const categories = BENCHMARK_CATEGORIES.map((c) => {
    const ids = BENCHMARK_IDS.filter((id) => BENCHMARKS[id].category === c);
    return ids.length ? { category: c, defined: true, benchmark_ids: ids } : { category: c, defined: false, benchmark_ids: [], blocked_by: UNDEFINED_CATEGORIES[c] ?? 'not defined' };
  });
  return {
    categories,
    defined_categories: categories.filter((c) => c.defined).length,
    undefined_categories: categories.filter((c) => !c.defined).length,
    benchmarks: BENCHMARK_IDS.map((id) => describeBenchmark(id)),
    fields: BENCHMARK_FIELDS,
    dimensions: EVALUATION_DIMENSIONS,
    measured_dimensions: MEASURED_DIMENSIONS,
    human_rubric: HUMAN_RUBRIC,
    implementation_options: IMPLEMENTATION_OPTIONS,
    overridable_functions: OVERRIDABLE_FUNCTIONS,
    no_overall_score: WHY_NO_OVERALL_SCORE,
    limitations: benchmarkLimitations(),
  };
}

/** One benchmark, Part 59's fifteen fields and nothing executable. */
export function describeBenchmark(id) {
  const b = BENCHMARKS[id];
  if (!b) return null;
  const out = {};
  for (const f of BENCHMARK_FIELDS) out[f] = b[f] ?? null;
  out.category = b.category;
  out.dimensions_measured = b.dimensions;
  out.exercises_tools = b.exercises_tools;
  return out;
}

/** The workflows a benchmark exercises: every tool in the workflow's chain is one the benchmark
 *  drives. Consumed by ai/workflows.js for Part 52's benchmark_coverage field. */
export function benchmarksExercising(workflowTools) {
  const need = new Set(workflowTools || []);
  if (!need.size) return [];
  return BENCHMARK_IDS.filter((id) => {
    const have = new Set(BENCHMARKS[id].exercises_tools || []);
    return [...need].every((t) => have.has(t));
  });
}

// ---------------------------------------------------------------- running

function humanBlock(b) {
  return {
    rubric: b.review_rubric,
    full_rubric: HUMAN_RUBRIC,
    procedure: b.human_acceptance_procedure,
    ratings: null,
    separate_from_measured: true,
    note: 'Part 59: human evaluation is structured, subjective, and kept apart from the deterministic outcomes. recordHumanRating writes here and only here; compareRuns never reads this block.',
  };
}

/**
 * Run one benchmark.
 *
 * @param opts.rigs           the rig table (rigs/builtin.json contents); fixtures need it
 * @param opts.implementation from makeImplementation(); production when omitted
 * @param opts.repeat         how many times to run for the reproducibility measurement (≥ 2)
 * @param opts.clock          `{ now() }` in milliseconds, or null — the layer never reads a clock itself
 * @param opts.timestamp      caller-supplied ISO time for the transaction records
 */
export function runBenchmark(id, { rigs = null, implementation = null, repeat = 2, clock = null, timestamp = null } = {}) {
  const b = BENCHMARKS[id];
  if (!b) throw new TypeError(`runBenchmark: no benchmark "${id}" — listBenchmarks() has the ${BENCHMARK_IDS.length}`);
  const impl = implementation || makeImplementation();
  const base = {
    benchmark_id: id, category: b.category, goal: b.goal,
    implementation: { label: impl.label, production: impl.production, options_on: impl.options_on, overrides: impl.overrides },
    human_evaluation: humanBlock(b),
  };
  if (!rigs) {
    return {
      ...base, status: 'not_run', reason: 'no rig table was supplied — every fixture is built from rigs/builtin.json, which the caller must pass as `rigs`',
      measured: {}, not_measured: DIMENSION_IDS.map((d) => ({ dimension: d, reason: 'the benchmark did not run' })), checks: [], result_hash: null, reproducible: null, elapsed_ms: null, findings: [],
      coverage: coverage({ scope: `benchmark ${id}`, loop: 'full', notRun: ['everything — no rigs'] }),
    };
  }
  const runs = [];
  const t0 = clock ? clock.now() : null;
  const times = Math.max(2, repeat | 0);
  let error = null;
  for (let i = 0; i < times; i++) {
    try {
      runs.push(b.run({ rigs, impl, timestamp }));
    } catch (e) {
      error = e;
      break;
    }
  }
  const elapsed = clock ? round3((clock.now() - t0) / times) : null;
  if (error) {
    return {
      ...base, status: 'failed', reason: `the benchmark threw: ${error.message}`,
      measured: {}, not_measured: DIMENSION_IDS.map((d) => ({ dimension: d, reason: 'the benchmark threw before measuring' })),
      checks: [{ name: 'the benchmark ran to completion', ok: false, detail: error.message }], result_hash: null, reproducible: null, elapsed_ms: elapsed,
      findings: [finding({ id: 'BENCHMARK-THREW', certainty: CERTAINTY.CERTAIN, statement: `${id} threw: ${error.message}`, evidence: [evidence('data', 'an exception escaped the benchmark', { stack: String(error.stack || '').split('\n').slice(0, 3) })] })],
      coverage: coverage({ scope: `benchmark ${id}`, loop: 'full', notRun: ['every dimension — the run failed'] }),
    };
  }
  const first = runs[0];
  const reproducible = runs.every((r) => r.after_hash === first.after_hash);
  const measured = {};
  for (const [dim, m] of Object.entries(first.measured)) {
    if (!EVALUATION_DIMENSIONS[dim]) throw new Error(`benchmark ${id} measured an unknown dimension "${dim}"`);
    measured[dim] = { value: m.value, unit: EVALUATION_DIMENSIONS[dim].unit, direction: EVALUATION_DIMENSIONS[dim].direction, method: EVALUATION_DIMENSIONS[dim].method, detail: m.detail ?? null };
  }
  measured.reproducibility = { value: reproducible ? 1 : 0, unit: 'boolean', direction: 'higher', method: EVALUATION_DIMENSIONS.reproducibility.method, detail: { runs: times, hashes: runs.map((r) => shortHash(r.after_hash)) } };
  const notMeasured = DIMENSION_IDS.filter((d) => !(d in measured)).map((d) => ({
    dimension: d,
    reason: EVALUATION_DIMENSIONS[d].measured
      ? `this benchmark does not exercise it (${b.dimensions.includes(d) ? 'the fixture gave it nothing to measure' : 'not in its declared set'})`
      : EVALUATION_DIMENSIONS[d].blocked_by,
  }));
  const findings = [];
  if (!reproducible) {
    findings.push(finding({
      id: 'BENCHMARK-NOT-REPRODUCIBLE', certainty: CERTAINTY.CERTAIN,
      statement: `${id} produced ${new Set(runs.map((r) => r.after_hash)).size} different results in ${times} runs`,
      evidence: [evidence('measurement', 'result hashes differ between identical runs', { hashes: runs.map((r) => shortHash(r.after_hash)) })],
    }));
  }
  for (const c of first.checks.filter((x) => x.ok === false)) {
    findings.push(finding({
      id: 'BENCHMARK-CHECK-FAILED', certainty: CERTAINTY.CERTAIN,
      statement: `${id}: ${c.name}${c.detail ? ` — ${c.detail}` : ''}`,
      evidence: [evidence('data', 'a benchmark check did not hold', { check: c.name, detail: c.detail })],
    }));
  }
  return {
    ...base,
    status: 'ran',
    measured,
    not_measured: notMeasured,
    checks: first.checks,
    result_hash: first.after_hash,
    reproducible,
    elapsed_ms: elapsed,
    detail: first.detail,
    findings,
    coverage: coverage({
      scope: `benchmark ${id} (${b.category}), ${times} runs`,
      loop: 'full',
      notRun: [
        ...notMeasured.filter((n) => !EVALUATION_DIMENSIONS[n.dimension].measured).map((n) => `${n.dimension}: ${n.reason}`),
        'no pixel was rendered: the visual metrics are the Electron smoketest\'s (OBS-002/003), not this run\'s',
        'human evaluation: the rubric is attached, nobody has rated it',
      ],
    }),
  };
}

/**
 * Run the suite, or a subset of it. Returns a BenchmarkRun — the object `compareRuns` consumes and
 * the CLI writes as the committed baseline.
 */
export function runSuite({ ids = null, rigs = null, implementation = null, repeat = 2, clock = null, timestamp = null, label = null } = {}) {
  const impl = implementation || makeImplementation();
  const chosen = ids && ids.length ? ids : BENCHMARK_IDS;
  const unknown = chosen.filter((id) => !BENCHMARKS[id]);
  if (unknown.length) throw new TypeError(`runSuite: unknown benchmark id(s): ${unknown.join(', ')}`);
  const t0 = clock ? clock.now() : null;
  const results = chosen.map((id) => runBenchmark(id, { rigs, implementation: impl, repeat, clock, timestamp }));
  const ran = results.filter((r) => r.status === 'ran');
  const measuredDims = [...new Set(ran.flatMap((r) => Object.keys(r.measured)))].sort();
  const lib = listBenchmarks();
  const run = {
    kind: 'benchmark_run',
    id: null,
    label: label ?? impl.label,
    created_at: timestamp,
    implementation: { label: impl.label, production: impl.production, options: impl.options, options_on: impl.options_on, overrides: impl.overrides },
    benchmarks_requested: chosen,
    results,
    summary: {
      ran: ran.length, not_run: results.filter((r) => r.status === 'not_run').length, failed: results.filter((r) => r.status === 'failed').length,
      reproducible: ran.filter((r) => r.reproducible).length,
      checks_failed: ran.reduce((a, r) => a + r.checks.filter((c) => c.ok === false).length, 0),
      checks_not_applicable: ran.reduce((a, r) => a + r.checks.filter((c) => c.ok === null).length, 0),
    },
    dimensions: {
      measured_in_this_run: measuredDims,
      not_measured_in_this_build: DIMENSION_IDS.filter((d) => !EVALUATION_DIMENSIONS[d].measured).map((d) => ({ dimension: d, reason: EVALUATION_DIMENSIONS[d].blocked_by })),
    },
    categories: { defined: lib.defined_categories, undefined: lib.undefined_categories, blocked: lib.categories.filter((c) => !c.defined).map((c) => ({ category: c.category, blocked_by: c.blocked_by })) },
    elapsed_ms: clock ? round3(clock.now() - t0) : null,
    no_overall_score: WHY_NO_OVERALL_SCORE,
    coverage: coverage({
      scope: `${chosen.length} benchmark(s) against implementation "${impl.label}"`,
      loop: 'full',
      notRun: [
        `${DIMENSION_IDS.length - MEASURED_DIMENSIONS.length} of Part 59's ${DIMENSION_IDS.length} dimensions are not measurable in a headless run — listed per dimension in dimensions.not_measured_in_this_build`,
        `${lib.undefined_categories} of Part 59's ${BENCHMARK_CATEGORIES.length} categories have no benchmark — listed with a reason each in categories.blocked`,
        'nothing was rendered, exported or rated by a person',
      ],
    }),
    limitations: benchmarkLimitations(),
  };
  // The id is content-addressed over what was MEASURED, not over timing, so two runs on two
  // machines that measured the same things share an id.
  run.id = `run:${shortHash(contentHash({ impl: run.implementation, results: results.map((r) => [r.benchmark_id, r.status, r.result_hash, Object.fromEntries(Object.entries(r.measured).map(([k, v]) => [k, v.value]))]) }))}`;
  return run;
}

/**
 * Attach a person's ratings to a result. Returns a NEW result; `measured` is untouched and the
 * ratings live only in `human_evaluation`. Ratings are 1–5 on rubric dimensions; anything else is
 * refused rather than coerced.
 */
export function recordHumanRating(result, { reviewer, ratings, notes = null, timestamp = null } = {}) {
  if (!result || !result.human_evaluation) throw new TypeError('recordHumanRating: a benchmark result is required');
  if (!reviewer) throw new TypeError('recordHumanRating: a reviewer is required — an anonymous rating cannot be asked about later');
  if (!ratings || typeof ratings !== 'object') throw new TypeError('recordHumanRating: ratings must be an object of rubric dimension → 1..5');
  for (const [k, v] of Object.entries(ratings)) {
    if (!HUMAN_RUBRIC.includes(k)) throw new TypeError(`recordHumanRating: "${k}" is not on Part 59's rubric (${HUMAN_RUBRIC.join(', ')})`);
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new TypeError(`recordHumanRating: "${k}" must be an integer 1..5 (got ${JSON.stringify(v)})`);
  }
  return {
    ...result,
    measured: result.measured,
    human_evaluation: {
      ...result.human_evaluation,
      ratings: { reviewer, ratings: { ...ratings }, notes, recorded_at: timestamp },
    },
  };
}

// ---------------------------------------------------------------- comparison

function verdictFor(dim, a, b) {
  const spec = EVALUATION_DIMENSIONS[dim];
  const tol = spec.tolerance ?? 0;
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return 'not_comparable';
  const delta = b - a;
  if (Math.abs(delta) <= tol) return 'unchanged';
  if (spec.direction === 'lower') return delta < 0 ? 'improved' : 'regressed';
  return delta > 0 ? 'improved' : 'regressed';
}

/**
 * Compare two runs, per benchmark, per dimension.
 *
 * `before` and `after` are BenchmarkRun objects (from runSuite, the committed baseline, or a JSON
 * file). Only dimensions both runs measured on the same benchmark get a verdict; everything else
 * is `not_comparable` with the reason. Wall-clock is reported and never judged.
 */
export function compareRuns(before, after) {
  if (!before || before.kind !== 'benchmark_run') throw new TypeError('compareRuns: `before` must be a benchmark_run');
  if (!after || after.kind !== 'benchmark_run') throw new TypeError('compareRuns: `after` must be a benchmark_run');
  const bIndex = new Map(before.results.map((r) => [r.benchmark_id, r]));
  const aIndex = new Map(after.results.map((r) => [r.benchmark_id, r]));
  const idsAll = [...new Set([...bIndex.keys(), ...aIndex.keys()])];

  const cells = [];
  const benchmarks = [];
  const findings = [];
  for (const id of idsAll) {
    const rb = bIndex.get(id), ra = aIndex.get(id);
    if (!rb || !ra) {
      benchmarks.push({ benchmark_id: id, comparable: false, reason: `present only in ${rb ? 'before' : 'after'}` });
      continue;
    }
    if (rb.status !== 'ran' || ra.status !== 'ran') {
      benchmarks.push({ benchmark_id: id, comparable: false, reason: `before ${rb.status}, after ${ra.status}` });
      continue;
    }
    const dims = [...new Set([...Object.keys(rb.measured), ...Object.keys(ra.measured)])];
    const rows = [];
    for (const dim of dims) {
      const mb = rb.measured[dim], ma = ra.measured[dim];
      if (!mb || !ma) {
        rows.push({ dimension: dim, verdict: 'not_comparable', before: mb?.value ?? null, after: ma?.value ?? null, why: `measured only ${mb ? 'before' : 'after'}` });
        continue;
      }
      const verdict = verdictFor(dim, mb.value, ma.value);
      const row = { dimension: dim, verdict, before: mb.value, after: ma.value, delta: round6(ma.value - mb.value), unit: mb.unit, direction: mb.direction, direction_is_convention: true };
      rows.push(row);
      cells.push({ benchmark_id: id, ...row });
      if (verdict === 'regressed' || verdict === 'improved') {
        findings.push(finding({
          id: verdict === 'regressed' ? 'BENCHMARK-REGRESSED' : 'BENCHMARK-IMPROVED',
          certainty: CERTAINTY.CERTAIN,
          statement: `${id}: ${dim} ${verdict} — ${mb.value} → ${ma.value} ${mb.unit} (${mb.direction} is read as better)`,
          evidence: [
            evidence('measurement', `before ${mb.value}, after ${ma.value}`, { benchmark: id, dimension: dim }),
            evidence('convention', `the direction "${mb.direction} is better" is a declared reading of this dimension, not a law (Part 59: do not optimize a metric in isolation)`),
          ],
        }));
      }
    }
    const checksB = new Map(rb.checks.map((c) => [c.name, c.ok])), checksA = new Map(ra.checks.map((c) => [c.name, c.ok]));
    const checkFlips = [...new Set([...checksB.keys(), ...checksA.keys()])].filter((n) => checksB.has(n) && checksA.has(n) && checksB.get(n) !== checksA.get(n)).map((n) => ({ check: n, before: checksB.get(n), after: checksA.get(n) }));
    // A flip TO false is a regression. A flip from null (not applicable) to true, or true to null,
    // is a change in what could be checked, and is reported in check_flips without a finding.
    for (const f of checkFlips.filter((x) => x.before === true && x.after === false)) {
      findings.push(finding({ id: 'BENCHMARK-CHECK-REGRESSED', certainty: CERTAINTY.CERTAIN, statement: `${id}: the check "${f.check}" held before and does not now`, evidence: [evidence('data', 'a benchmark check flipped from ok to failed', f)] }));
    }
    benchmarks.push({
      benchmark_id: id, comparable: true,
      result_hash_changed: rb.result_hash !== ra.result_hash,
      dimensions: rows,
      check_flips: checkFlips,
      timing_ms: { before: rb.elapsed_ms, after: ra.elapsed_ms, informational_only: true },
    });
  }
  const count = (v) => cells.filter((c) => c.verdict === v).length;
  return {
    kind: 'benchmark_comparison',
    before: { id: before.id, label: before.label, implementation: before.implementation, created_at: before.created_at },
    after: { id: after.id, label: after.label, implementation: after.implementation, created_at: after.created_at },
    benchmarks,
    cells,
    counts: { improved: count('improved'), regressed: count('regressed'), unchanged: count('unchanged'), not_comparable: benchmarks.reduce((a, b) => a + (b.dimensions || []).filter((d) => d.verdict === 'not_comparable').length, 0) + benchmarks.filter((b) => !b.comparable).length },
    regressions: cells.filter((c) => c.verdict === 'regressed'),
    improvements: cells.filter((c) => c.verdict === 'improved'),
    no_overall_score: WHY_NO_OVERALL_SCORE,
    human_evaluation_read: false,
    findings,
    coverage: coverage({
      scope: `${benchmarks.filter((b) => b.comparable).length} comparable benchmark(s), ${cells.length} dimension cells`,
      loop: 'full',
      notRun: [
        'wall-clock time was not judged — it is reported per benchmark as informational',
        'human ratings were not read (BCH-003): a comparison is deterministic or it is not one',
        ...(benchmarks.filter((b) => !b.comparable).map((b) => `${b.benchmark_id}: ${b.reason}`)),
      ],
    }),
  };
}

// ---------------------------------------------------------------- limitations

export function benchmarkLimitations() {
  return [
    `${BENCHMARK_IDS.length} benchmarks cover ${new Set(BENCHMARK_IDS.map((id) => BENCHMARKS[id].category)).size} of Part 59's ${BENCHMARK_CATEGORIES.length} categories; the rest are listed with what blocks each (listBenchmarks().categories). No benchmark is a shell: each runs the real pipeline and measures at least two dimensions.`,
    `${MEASURED_DIMENSIONS.length} of Part 59's ${DIMENSION_IDS.length} evaluation dimensions are measured. The other ${DIMENSION_IDS.length - MEASURED_DIMENSIONS.length} are session facts (corrections, iterations, approval, rollback frequency, tool calls) or need a renderer (render cost, visual continuity, camera readability) or the impure validator (export), and each says so in EVALUATION_DIMENSIONS.`,
    'A headless run renders nothing. The visual metrics of every benchmark are "none", and the silhouette/object-ID comparison belongs to the Electron smoketest (OBS-002/003).',
    'animation_intent_alignment is a PROXY: it counts the plan\'s own acceptance checks that passed. Amplitude rising is a fact; whether the motion reads as asked is not measured by any dimension here.',
    'Fixtures are authored, small and static-origin. A contact benchmark measures drift against the effector\'s own first-frame position (MOT-008); nothing here has a ground plane.',
    'There is no overall score, and no dimension is weighted. compareRuns returns verdicts per cell and counts of them; the counts are counts.',
    'Human evaluation is attached as a rubric and never read by compareRuns. A benchmark result can carry a rating (recordHumanRating), but the rating changes nothing measured.',
    'Reproducibility is measured within one process by running each benchmark twice. Cross-machine reproducibility rests on the FK solve being pure and V8\'s Math being deterministic, and is checked by comparing a fresh run against the committed baseline (ai/benchmarkBaseline.js), not proven here.',
    'Wall-clock time is reported only when the caller supplies a clock, and is never a verdict.',
  ];
}
