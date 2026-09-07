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
//
// What is deliberately NOT here yet, so nothing accidentally implies it exists: CAL (Part 20),
// motion measurement (Part 23), render passes (Part 43), baselines and regression (Part 44),
// knowledge, memory and benchmarks (Parts 25, 57, 59).

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

/** The version of the semantic layer itself, separate from the app version. Bumped when a graph's
 *  shape changes in a way a consumer would notice. Phase 2 added `lock_state` and `constraint_ids`
 *  content to the Scene Graph, so this is a minor bump rather than a patch one. */
export const SEMANTIC_LAYER_VERSION = '1.1.0';

/** One place to ask what this layer can and cannot currently answer. Returned by
 *  `inspect_scene` so a model never has to infer capability from silence. */
export function capabilities() {
  return {
    version: SEMANTIC_LAYER_VERSION,
    phase: 'Phase 2 — safe patch and rollback layer (directive Part 62)',
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
    ],
    cannot: [
      'measure velocity, acceleration, jerk, arcs or contact drift (Part 23 — Phase 5), so a declared foot contact is recorded and NOT verified',
      'render anything but a beauty pass: no silhouette, depth, object-ID or motion-vector pass (Part 43 — Phase 4)',
      'compare against an approved baseline or detect a visual regression (Part 44 — Phase 4)',
      'represent intent, motion plans, poses, timing or acceptance criteria (Part 20 — Phase 3)',
      'patch rig topology, attachment, effect documents or key groups — those tools exist but are not transactional (see patch.patchLimitations())',
      'reason about shots, cameras, framing, shot events or VFX timing relationships (Parts 40-41 — Phase 6)',
    ],
    never_claims: 'a result reports what it examined in its `coverage` field, and every assertion carries a certainty level from Part 13 — an absent check is named, not implied to have passed. A constraint whose check does not exist yet is reported as not checked, never as satisfied.',
  };
}
