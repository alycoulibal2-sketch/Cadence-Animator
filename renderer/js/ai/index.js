// Cadence Animation Intelligence — the semantic layer.
//
// One import point for everything under `renderer/js/ai/`. Built to the master directive
// (`Cadence_Animator_Ultimate_Master_Directive.md`); the audit that decided its shape is
// `docs/animation-intelligence/00-foundation-audit.md`, and requirement-by-requirement status is
// in `docs/animation-intelligence/requirements-matrix.md`.
//
// The whole tree obeys two rules, and both are enforced by test rather than by convention:
//
//   * **Pure at load.** No `window`, no DOM, no three.js, no `state.js`. `test/aitest.mjs`
//     imports every module in plain Node, so a stray renderer dependency fails immediately.
//   * **Plain data in, plain data out.** Every entry point takes a `project` object, so the same
//     code runs on the live scene, a snapshot, an undo state, a baseline or a fixture.
//
// What is here (Phases 1 and 2 of Part 62's roadmap):
//
//   hash          content addressing, revisions
//   certainty     Part 13's taxonomy, evidence and coverage shapes
//   ids           stable entity ids, and honest reporting of what each one survives
//   kinematics    pure track evaluation and pure forward kinematics
//   roles         semantic roles, inference with evidence, user/AI overrides
//   riggraph      Part 18's Rig Graph + rig validation
//   timelinegraph Part 19's Timeline Graph
//   scenegraph    Part 17's Scene Graph + Part 66's Dependency Graph
//   select        semantic selection ("the planted foot"), with a question when it cannot decide
//   snapshot      content-addressed immutable snapshots + structural project diff
//   provenance    Part 56's provenance graph
//   patch         Part 55's reversible operations — plan on a clone, commit with a verified hash
//   constraints   Parts 20.6 and 54 — ConstraintSpec, the priority ladder, locks, conflicts
//   scope         Part 54's scope analysis, traced through the Dependency Graph
//   transaction   Part 55's transaction record, ledger and scoped rollback
//   vocabulary    Part 21 — what "heavy" asks for, as dimensions rather than a slider
//   cal           Part 20 — IntentSpec, MotionPlan, PoseSpec, Timing/Spacing, Contact, Acceptance
//   intent        Part 20.1 — a request becomes an IntentSpec, and says what it was taken to mean
//   plan          Parts 20.2 and 24 — phase segmentation, the planner, the first motion compiler
//
// What is deliberately NOT here yet, so nothing accidentally implies it exists: motion measurement
// (Part 23), render passes (Part 43), baselines and regression (Part 44), the VFX compiler (Part
// 37), shots and cameras (Parts 40-41), knowledge, memory and benchmarks (Parts 25, 57, 59).

export * as hash from './hash.js';
export * as certainty from './certainty.js';
export * as ids from './ids.js';
export * as kinematics from './kinematics.js';
export * as roles from './roles.js';
export * as riggraph from './riggraph.js';
export * as timelinegraph from './timelinegraph.js';
export * as scenegraph from './scenegraph.js';
export * as select from './select.js';
export * as snapshot from './snapshot.js';
export * as provenance from './provenance.js';
export * as patch from './patch.js';
export * as constraints from './constraints.js';
export * as scope from './scope.js';
export * as transaction from './transaction.js';
export * as vocabulary from './vocabulary.js';
export * as cal from './cal.js';
export * as intent from './intent.js';
export * as plan from './plan.js';

export { CERTAINTY } from './certainty.js';
export { ROLE, SIDE } from './roles.js';
export { sceneGraph, resolveEntity } from './scenegraph.js';
export { rigGraph, validateRig } from './riggraph.js';
export { timelineGraph, sampleTrack } from './timelinegraph.js';
export { resolve as resolveSemantic, vocabulary as selectionVocabulary } from './select.js';
export { SnapshotStore, diffProjects } from './snapshot.js';
export { makePatch, planPatch, commitPatch } from './patch.js';
export { PRIORITY, compileConstraints, checkPatch, constraintVocabulary } from './constraints.js';
export { analyseScope } from './scope.js';
export { TransactionLedger, preview as previewPatch, apply as applyPatch, rollback as rollbackTransaction, mutationResult } from './transaction.js';
export { interpret as interpretTerms, explain as explainTerms, vocabulary as animationVocabulary, setTerm, clearTerm } from './vocabulary.js';
export { intentSpec, motionPlan, poseSpec, contactSpec, acceptanceSpec, evaluateAcceptance, describePlan } from './cal.js';
export { interpretRequest, intentVocabulary } from './intent.js';
export { planMotion, compilePlan, segmentPhases } from './plan.js';

/** The version of the semantic layer itself, separate from the app version. Bumped when a graph's
 *  shape changes in a way a consumer would notice. Phase 3 adds the CAL structures and a project
 *  field (`semantics.vocabulary`), so this is a minor bump rather than a patch one. */
export const SEMANTIC_LAYER_VERSION = '1.2.0';

/** One place to ask what this layer can and cannot currently answer. Returned by
 *  `inspect_scene` so a model never has to infer capability from silence. */
export function capabilities() {
  return {
    version: SEMANTIC_LAYER_VERSION,
    phase: 'Phase 3 — the formal animation language (directive Part 62)',
    can: [
      'project the scene, any rig and any timeline into stable-id graphs with semantic roles',
      'resolve semantic selections such as "the left foot", "the planted foot" and "the weapon hand", with evidence',
      'validate a rig for root, cycles, duplicate motors, orphans, rest-pose consistency, mirror completeness and role coverage',
      'evaluate any track and solve full forward kinematics at any frame, on live or snapshot data',
      'take content-addressed immutable snapshots and diff two project states down to the keyframe',
      'record and query provenance that survives save/load',
      'dry-run an animation patch: what it would change, what depends on it, what it would violate — without touching the project',
      'compile a change request into constraints, including an allow-list that protects everything it does not name',
      'enforce persisted locks and per-request constraints, and report a conflict rather than resolving it',
      'apply a patch atomically, with the committed state verified against the plan',
      'roll a transaction back whole, or scoped to one property or one frame range, and say what a scope left behind',
      'interpret a request into an IntentSpec and say back what it was taken to mean, including the words it did not understand',
      'carry an editable, scoped vocabulary: what "heavy" pulls on, what it deliberately does not change, and where a project disagrees',
      'cut an animation into phases from key times and markers, and say how certain each phase name is',
      'plan a motion as phases, poses, timing, spacing, declared contacts and acceptance criteria',
      'compile a plan into operations, blocking any strategy a constraint forbids and naming what the motion loses',
      'evaluate an AcceptanceSpec against a before-state, separating pass, fail and NOT RUN',
    ],
    cannot: [
      'measure velocity, acceleration, jerk, arcs or contact drift (Part 23 — Phase 5), so a declared foot contact is recorded and NOT verified',
      'render anything but a beauty pass: no silhouette, depth, object-ID or motion-vector pass (Part 43 — Phase 4)',
      'compare against an approved baseline or detect a visual regression (Part 44 — Phase 4)',
      'generate a motion from nothing: every planner strategy edits existing keys, and none may add or remove one (see plan.planLimitations())',
      'plan for cameras, props or effect items — the motion compiler covers rig joint tracks only',
      'judge whether a result looks right. Nothing here renders, so every acceptance report ends by saying so',
      'patch rig topology, attachment, effect documents or key groups — those tools exist but are not transactional (see patch.patchLimitations())',
      'reason about shots, cameras, framing, shot events or VFX timing relationships (Parts 40-41 — Phase 6)',
    ],
    never_claims: 'a result reports what it examined in its `coverage` field, and every assertion carries a certainty level from Part 13 — an absent check is named, not implied to have passed. A constraint whose check does not exist yet is reported as not checked, never as satisfied, and an acceptance report distinguishes `accepted` from `fully_validated`.',
  };
}
