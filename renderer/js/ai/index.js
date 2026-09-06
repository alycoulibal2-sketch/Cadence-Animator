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
// What is here (Phase 1 of Part 62's roadmap):
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
//
// What is deliberately NOT here yet, so nothing accidentally implies it exists: CAL (Part 20),
// motion measurement (Part 23), render passes (Part 43), baselines and regression (Part 44),
// constraints and transactions (Parts 54–55), knowledge, memory and benchmarks (Parts 25, 57, 59).

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

export { CERTAINTY } from './certainty.js';
export { ROLE, SIDE } from './roles.js';
export { sceneGraph, resolveEntity } from './scenegraph.js';
export { rigGraph, validateRig } from './riggraph.js';
export { timelineGraph, sampleTrack } from './timelinegraph.js';
export { resolve as resolveSemantic, vocabulary as selectionVocabulary } from './select.js';
export { SnapshotStore, diffProjects } from './snapshot.js';

/** The version of the semantic layer itself, separate from the app version. Bumped when a graph's
 *  shape changes in a way a consumer would notice. */
export const SEMANTIC_LAYER_VERSION = '1.0.0';

/** One place to ask what this layer can and cannot currently answer. Returned by
 *  `inspect_scene` so a model never has to infer capability from silence. */
export function capabilities() {
  return {
    version: SEMANTIC_LAYER_VERSION,
    phase: 'Phase 1 — semantic inspection bridge (directive Part 62)',
    can: [
      'project the scene, any rig and any timeline into stable-id graphs with semantic roles',
      'resolve semantic selections such as "the left foot", "the planted foot" and "the weapon hand", with evidence',
      'validate a rig for root, cycles, duplicate motors, orphans, rest-pose consistency, mirror completeness and role coverage',
      'evaluate any track and solve full forward kinematics at any frame, on live or snapshot data',
      'take content-addressed immutable snapshots and diff two project states down to the keyframe',
      'record and query provenance that survives save/load',
    ],
    cannot: [
      'measure velocity, acceleration, jerk, arcs or contact drift (Part 23 — Phase 5)',
      'render anything but a beauty pass: no silhouette, depth, object-ID or motion-vector pass (Part 43 — Phase 4)',
      'compare against a baseline or detect a visual regression (Part 44 — Phase 4)',
      'represent intent, motion plans, poses, timing, contacts or acceptance criteria (Part 20 — Phase 3)',
      'compile or enforce constraints, preview a patch, or roll back one property or frame range (Parts 54-55 — Phase 2)',
      'reason about shots, cameras, framing, shot events or VFX timing relationships (Parts 40-41 — Phase 6)',
    ],
    never_claims: 'a result reports what it examined in its `coverage` field, and every assertion carries a certainty level from Part 13 — an absent check is named, not implied to have passed',
  };
}
