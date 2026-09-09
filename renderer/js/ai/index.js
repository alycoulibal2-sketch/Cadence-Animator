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
//   raster        Part 44's comparison systems, over plain byte buffers — the layer's only pixels
//   observe       Part 43 — the pass catalogue and the hierarchical observation policy
//   baseline      Part 44 — baselines as project data, not disposable screenshots
//   explain       Parts 44 and 45 — difference classification and evidence-backed explanation
//   motion        Part 23 — velocity, acceleration, jerk, curvature, contact drift, chain lead/lag
//   diagnose      Part 46 — the "why?" workflows, built on those measurements
//   events        Part 41 — the shared shot-event timeline, derived from per-item markers
//   vfxspec       Parts 37-39 — a declarative effect, compiled into reversible operations
//   modes         Part 11 — the operating modes, and what each one actually permits
//   experiment    Part 48 — bounded named alternatives, compared, with a justified recommendation
//
// Phase 4 note on purity: the layer now reasons about pixels, and still imports no renderer. A
// raster crosses the boundary as `{ width, height, encoding, data }` and nothing else; the GPU
// work is in `renderer/js/observationPasses.js`, outside this tree.
//
// Phase 6 note on the VFX boundary: `ai/vfxspec.js` compiles a declarative spec onto the
// `kind: 'vfx'` emitter item, whose sampler (`renderer/js/vfx.js`) is pure and importable here.
// It deliberately does NOT author `pnx/**` graphs — the reasoning is at the top of that file.
//
// Phase 7 note on modes: `modes.js` is policy, not police. It decides the one question it can — may
// this action mutate — and returns everything else as obligations on the caller, because this layer
// sees a project and one action, never the session history that would prove a diagnosis came first.
// The enforcement point is `apply_animation_patch`, which every mutating semantic tool goes through.
//
// What is deliberately NOT here yet, so nothing accidentally implies it exists: a Shot entity and
// CameraSpec (Parts 40 and 41 beyond the event timeline — see `events.describeShot().absent`), the
// simulation report and the structured review (Parts 47 and 49, the rest of Phase 7), knowledge,
// memory and benchmarks (Parts 25, 57, 59).

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
export * as raster from './raster.js';
export * as observe from './observe.js';
export * as baseline from './baseline.js';
export * as explain from './explain.js';
export * as motion from './motion.js';
export * as diagnose from './diagnose.js';
export * as events from './events.js';
export * as vfxspec from './vfxspec.js';
export * as modes from './modes.js';
export * as experiment from './experiment.js';

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
export { propagateTracks } from './scope.js';
export { makeRaster, rasterDigest, signature as rasterSignature, cameraFingerprint } from './raster.js';
export { PASSES, observationPlan, suspectFrames, availablePasses } from './observe.js';
export { createBaseline, listBaselines, getBaseline, approveDifference, snapshotAvailable } from './baseline.js';
export { explainChange, CLASSIFICATION } from './explain.js';
export { MEASUREMENTS, sampleMotion, measureContactDrift, analyseChain, classifyVariation } from './motion.js';
export { DIAGNOSTICS, diagnose as diagnoseMotion } from './diagnose.js';

/** The version of the semantic layer itself, separate from the app version. Bumped when a graph's
 *  shape changes in a way a consumer would notice. Phase 5 adds the Part 23 measurements and the
 *  Part 46 diagnostics, and turns two previously NOT-RUN checks into ones that run. */
export const SEMANTIC_LAYER_VERSION = '1.7.0';

/** One place to ask what this layer can and cannot currently answer. Returned by
 *  `inspect_scene` so a model never has to infer capability from silence. */
export function capabilities() {
  return {
    version: SEMANTIC_LAYER_VERSION,
    phase: 'Phase 5 — motion and contact analysis (directive Part 62)',
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
      'render a silhouette and an object-ID pass, and compare two of either by exact pixel, coverage, edge displacement and per-object screen movement',
      'record a baseline inside the project — Part 44\'s field list, with the six fields Cadence has nothing behind named rather than omitted',
      'classify each difference against a baseline as expected, unexpected, uncertain or approved, and say which transaction explains it',
      'explain a change with ranked causes and the evidence that distinguishes them, and name the minimum safe correction',
      'choose the cheapest evidence that can settle a question, and say what would make it escalate (Part 43\'s hierarchical policy)',
      'measure per-frame world velocity, acceleration, jerk and path curvature for any rig part on any state (Part 23)',
      'measure a declared contact\'s drift against its own tolerance, and REFUSE a patch that would break it — the same measurement runs as a constraint before the patch and as an acceptance check after it',
      'attribute a drifting contact to the joint that owns it, by freezing each ancestor in turn and re-measuring',
      'measure onset and peak per joint along a chain and report an inversion, without claiming an inversion is wrong',
      'classify a discontinuity as a stepped key, a held pose or a marked impact before anything calls it a defect (Part 23\'s noise-and-signal policy)',
    ],
    cannot: [
      'detect a contact nobody declared. Drift is measured against a ContactSpec; a foot the animator meant to plant and never said so about is not checked',
      'measure screen-space velocity (no active-camera model), balance or centre of mass (part mass is unknown), or distance from an EXPECTED arc (no arc model)',
      'tell accidental jitter from deliberate texture: 6 of Part 23\'s 9 variation kinds have no mark in Cadence project data, and an unexplained discontinuity is reported as unclassified',
      'answer 3 of Part 46\'s 7 "why?" workflows — weight, effect change and camera framing are all blocked on models that do not exist (see diagnose.DIAGNOSTICS)',
      'render 20 of Part 43\'s 24 observation kinds — no depth, normal, motion-vector, alpha, shadow, material-ID, crop, contact-sheet or overlay pass (see observe.PASSES for what blocks each)',
      'see anything but rig parts: props, effect items, screen effects, the ground and the grid are excluded from every pass by construction',
      'detect flicker or a one-frame pop — that needs consecutive frames, and the policy targets suspect frames instead',
      'generate a motion from nothing: every planner strategy edits existing keys, and none may add or remove one (see plan.planLimitations())',
      'plan for cameras, props or effect items — the motion compiler covers rig joint tracks only',
      'judge whether a result looks RIGHT. It can now say exactly what is different and who did it; whether that is good is not a measurement it makes',
      'patch rig topology, attachment, effect documents or key groups — those tools exist but are not transactional (see patch.patchLimitations())',
      'reason about shots, cameras, framing, shot events or VFX timing relationships (Parts 40-41 — Phase 6)',
    ],
    never_claims: 'a result reports what it examined in its `coverage` field, and every assertion carries a certainty level from Part 13 — an absent check is named, not implied to have passed. A constraint whose check does not exist yet is reported as not checked, never as satisfied, and an acceptance report distinguishes `accepted` from `fully_validated`.',
  };
}
