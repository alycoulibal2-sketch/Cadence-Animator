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
//   plan          Parts 20.2 and 24 — phase segmentation, the planner, the motion compiler, and authoring
//   pose          Parts 20.3, 26, 28, 29 — exact pose compilation: degrees in, analytic two-bone IK, measured
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
//   review        Parts 49 and 14 — the structured shot review, ordered by the quality hierarchy
//   simulate      Part 47 — the pre-commit evaluation: the review, run on a planned result
//   workflows     Part 52 — the sixteen named workflows, as declared and validated tool chains
//   style         Part 35 — style profiles that change vocabulary thresholds, not just a label
//   knowledge     Parts 25, 26, 71, 73 — the twelve classical principles, the relevance gate, the premium standard
//   memory        Part 57 — scoped project/preference memory; Part 58 — learning from accepted and failed work
//   reference     Part 36 — reference profiles built from an in-project source, never blindly copied
//   library       Part 70 — the cross-project motion library: entries, search, nearest by measurement
//   benchmark     Part 59 — the benchmark library: permanent fixtures, measured dimensions, run comparison
//   benchmarkBaseline  the committed production run every fresh run is compared against (generated)
//   improve       Part 60 — the architecture-improvement loop: detect, propose, benchmark, review, decide
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
// Phase 8 note on where things live: `knowledge.js`'s twelve principles are compiled reference data,
// like `vocabulary.js TERMS` — not project state, because they are not learned or per-project.
// `memory.js` and `style.js` DO live in `project.semantics` (undoable, like vocabulary overrides),
// because a declared style or a captured correction IS an edit a project can make and undo.
// `reference.js` profiles live in `project.semantics.references`, held out of snapshots and undo
// exactly like `baselines` and `provenance` — a reference profile is a record ABOUT a source, not a
// change to this project's own animation.
//
// Part 70 note on what DOES cross a project boundary now: `ai/library.js` (motion clips and their
// profiles) and the on-disk half of `ai/knowledge.js` (Part 25 entries a session wrote). Both live
// in the app's user-data folder, both are passed in as plain data like everything else here, and
// neither is project state. `memory.js` and `style.js` still do NOT cross — a captured correction
// and a declared style are edits one project made, and generalising them is a person's decision
// (Part 57), not a folder's.
//
// Phase 9 note on what a benchmark is: `benchmark.js` runs the SAME pure pipeline `apply_motion_plan`
// drives, on permanent fixtures, against an INJECTED implementation — production by default, or a
// prototype that flips a declared option or overrides a function. Two runs compare per dimension,
// per benchmark, with no overall score (Part 59). `improve.js` consumes exactly that comparison to
// evaluate a proposal's adoption rule, and stops there: approval is a person's, recorded, versioned
// (Part 4.8, Part 60). The committed baseline run in `benchmarkBaseline.js` is generated by
// `tools/benchmark.mjs --write-baseline` and never edited by hand.
//
// What is deliberately NOT here yet, so nothing accidentally implies it exists: a Shot entity and
// CameraSpec (Parts 40 and 41 beyond the event timeline — see `events.describeShot().absent`), and a
// benchmark for anything that needs a camera, animation layers, or a locomotion state model
// (`benchmark.listBenchmarks().categories` names each blocked category with its reason).

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
export * as pose from './pose.js';
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
export * as review from './review.js';
export * as simulate from './simulate.js';
export * as workflows from './workflows.js';
export * as style from './style.js';
export * as knowledge from './knowledge.js';
export * as memory from './memory.js';
export * as reference from './reference.js';
export * as library from './library.js';
export * as benchmark from './benchmark.js';
export * as benchmarkBaseline from './benchmarkBaseline.js';
export * as improve from './improve.js';

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
export { planMotion, compilePlan, segmentPhases, authorMotion } from './plan.js';
export { compilePose, measurePose, solveTwoBone, poseConventions, rotationFromDegrees, degreesFromRotation } from './pose.js';
export { propagateTracks } from './scope.js';
export { makeRaster, rasterDigest, signature as rasterSignature, cameraFingerprint } from './raster.js';
export { PASSES, observationPlan, suspectFrames, availablePasses } from './observe.js';
export { createBaseline, listBaselines, getBaseline, approveDifference, snapshotAvailable } from './baseline.js';
export { explainChange, CLASSIFICATION } from './explain.js';
export { MEASUREMENTS, sampleMotion, measureContactDrift, analyseChain, classifyVariation } from './motion.js';
export { DIAGNOSTICS, diagnose as diagnoseMotion } from './diagnose.js';
export { runSuite as runBenchmarkSuite, compareRuns as compareBenchmarkRuns, makeImplementation as makeBenchmarkImplementation, listBenchmarks } from './benchmark.js';
export { detectRecurringProblems, proposeImprovement, evaluateAdoption, decideProposal } from './improve.js';
export { searchLibrary, nearest as nearestLibraryEntry, makeEntry as makeLibraryEntry, validateEntry as validateLibraryEntry, libraryLimitations } from './library.js';

/** The version of the semantic layer itself, separate from the app version. Bumped when a graph's
 *  shape changes in a way a consumer would notice. 1.11.0 adds GENERATION: `ai/pose.js` compiles a
 *  PoseSpec into exact keys (degrees about named axes, analytic two-bone IK), and `plan.authorMotion`
 *  turns an IntentSpec plus declared phase frames into key poses with breakdowns, holds and a
 *  settle. Every strategy in this layer still only EDITS; authoring is a separate entry point with
 *  a separate acceptance spec, because "nothing else changed" and "what I promised exists" are
 *  different claims.
 *
 *  1.12.0 adds the CROSS-PROJECT LIBRARY (`ai/library.js`, Part 70) and puts the knowledge base
 *  on disk (Part 72). Until now every learned thing — a reference profile, a captured
 *  correction, a declared style — lived inside one `.cadence` file, and three modules said so
 *  in their own limitations. A library entry now carries Part 70's sixteen fields plus a Part
 *  36 profile, and is searched by action, tags, rig and measured distance; a knowledge entry
 *  can be written by a session and loaded by the next one through Part 72's gate. Neither
 *  store is project state and neither is ever applied automatically. */
export const SEMANTIC_LAYER_VERSION = '1.12.0';

/** One place to ask what this layer can and cannot currently answer. Returned by
 *  `inspect_scene` so a model never has to infer capability from silence.
 *
 *  This function itself was found stale during Phase 8's own landing: `phase` still read "Phase 5"
 *  and `can`/`cannot` never mentioned Phases 6 or 7, even though their modules were already
 *  exported above — the exact "stale-blocker" class of bug the Phase 4 review pass named. Fixed
 *  here rather than left for a later session, since Phase 8 was already touching this file. */
export function capabilities() {
  return {
    version: SEMANTIC_LAYER_VERSION,
    phase: 'Part 62\'s nine phases are complete. Slice A — GENERATION: the layer can now author a motion from nothing, not only edit one',
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
      'AUTHOR a motion from an empty timeline: an IntentSpec plus declared phase frames plus a PoseSpec per phase become key poses, breakdowns, holds and a settle, applied as one reversible transaction (authorMotion)',
      'compile a pose exactly — a joint rotation in DEGREES about named axes in the rig\'s own convention, or an analytic two-bone reach that lands on its target to floating-point precision and reports the shortfall in studs when it cannot (ai/pose.js)',
      'hold a declared contact by SOLVING for it at every authored key, so the planted foot stays put by construction rather than being measured afterwards and apologised for',
      'measure a pose\'s line of action, a volume-proxy centre of mass, and balance against a DECLARED support polygon (MOT-011) — as measurements with their method named, never as a verdict on whether the pose reads',
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
      'compile a declarative VFX spec into a reversible operation on the emitter item, timed to the shared shot-event timeline (Parts 37-41)',
      'gate every mutating semantic tool by an operating mode, and refuse to leave analyze mode on its own (Part 11)',
      'compare bounded, named experiment candidates on clones and either recommend one with named evidence or say the measured dimensions tied (Part 48)',
      'run a structured shot review ordered by Part 14\'s quality hierarchy, with deterministic defects and artistic suggestions kept in separate arrays that never merge (Part 49)',
      'simulate a proposed change before it lands — plan on a clone, review both states, and report which quality layer regressed (Part 47)',
      'run one of Part 52\'s sixteen declared workflows, stopping before its first mutating step until approval is given',
      'change a vocabulary term\'s numeric pull by a declared project style — the same word produces a measurably different amplitude under different styles, never only a label (Part 35)',
      'answer Part 71\'s nine-question relevance gate for any of the twelve classical principles, honestly marking which questions this build can compute and which it cannot',
      'record scoped project/preference memory with evidence, and surface a preference candidate only once the same correction has been observed enough times — never applying one automatically (Part 57)',
      'build a reference profile from an existing in-project animation and separate what the caller wants to emulate from what is deliberately not copied (Part 36)',
      'carry motion ACROSS projects: a clip plus its Part 36 profile, Part 70 sixteen fields, a declared provenance and a declared licence, stored outside every project file and searched by action type, tags, rig compatibility and measured distance (ai/library.js)',
      'import a Roblox animation as a REFERENCE, from a rig AnimSaves folder over the Studio bridge or from an .rbxm/.rbxmx file. That is also how a video reaches this build: Roblox Studio Animation Capture estimates the poses, Cadence imports the keyframes, and the entry stays labelled captured and estimated for as long as it exists',
      'grow its own knowledge base: a Part 25 entry written by one session is loaded by the next through Part 72 shape AND evidence gates, may not shadow a classical principle, and becomes a runnable check in review_shot only where it names an ai/motion.js measurement that already exists',
      'record that a shot was accepted or rejected as Part 58 memory, offer (never force) the accepted one into the library, and return a dated lesson paragraph',
      'run Part 59\'s benchmark library — permanent fixtures through the real pipeline, measuring 11 of the 21 evaluation dimensions — and compare two runs per dimension, per benchmark, with no overall score',
      'compare production against a prototype (a declared option or an injected function) on the same benchmarks, and say which measured outcomes improved or regressed — Part 62\'s Phase 9 success condition',
      'detect a recurring problem from durable evidence (repeated corrections, rollback frequency, a reproducibly failing benchmark), record a Part 60 proposal with its category and adoption rule, evaluate the rule mechanically, and record a human decision with a version and a rollback path — never applying anything itself (Part 4.8)',
    ],
    cannot: [
      'detect a contact nobody declared. Drift is measured against a ContactSpec; a foot the animator meant to plant and never said so about is not checked',
      'measure screen-space velocity (no active-camera model) or distance from an EXPECTED arc (no arc model). Balance and centre of mass ARE measured now (ai/pose.js), with two stated caveats: the mass is a part-VOLUME proxy because Cadence stores no density, and the support polygon comes from contacts a caller DECLARED, because nothing infers one',
      'tell accidental jitter from deliberate texture: 6 of Part 23\'s 9 variation kinds have no mark in Cadence project data, and an unexplained discontinuity is reported as unclassified',
      'answer 3 of Part 46\'s 7 "why?" workflows — weight, effect change and camera framing are all blocked on models that do not exist (see diagnose.DIAGNOSTICS)',
      'render 20 of Part 43\'s 24 observation kinds — no depth, normal, motion-vector, alpha, shadow, material-ID, crop, contact-sheet or overlay pass (see observe.PASSES for what blocks each)',
      'see anything but rig parts: props, effect items, screen effects, the ground and the grid are excluded from every pass by construction',
      'detect flicker or a one-frame pop — that needs consecutive frames, and the policy targets suspect frames instead',
      'generate a motion from a STRATEGY: all four edit existing keys and none may add or remove one. Generation is `authorMotion`, a separate entry point, and it cannot invent phase DURATIONS either — a template names an attack\'s phases in order and says nothing about their length, so a call with no frames asks rather than guessing (see plan.planLimitations().authoring)',
      'generate secondary motion, overlap, drag or root travel when authoring — the authored keys are the poses asked for, exactly. Overlap is an EDIT (lead_lag) applied afterwards, and nothing writes the @origin track',
      'respect a joint limit when composing a pose: Cadence stores none, so a knee can be authored bending backwards, and `bend: "reverse"` does exactly that on purpose',
      'plan for cameras, props or effect items — the motion compiler covers rig joint tracks only',
      'judge whether a result looks RIGHT. It can now say exactly what is different and who did it; whether that is good is not a measurement it makes',
      'patch rig topology, attachment, effect documents or key groups — those tools exist but are not transactional (see patch.patchLimitations())',
      'model an active camera or camera framing at all (Parts 40-41) — shot EVENTS and VFX timing relationships are covered (Phase 6), framing and staging readability are not',
      'author a multi-layer PNX VFX graph from a spec — a VFXSpec compiles to exactly one emitter item, by deliberate choice (see vfxspec.js header)',
      'infer which mode is active, or let a tool force its way out of a read-only mode — Part 11 makes both the user\'s decision, never the tool\'s',
      'ingest video ITSELF, a pose sequence, a reference render or a style board. 4 of Part 36\'s 7 reference kinds are now supported (an in-project item; a Roblox animation file or AnimSave used as a MOTION source; an approved prior shot, via accept_shot into the library; and video only INDIRECTLY — Roblox Studio\'s Animation Capture estimates the poses and Cadence imports its result, labelled estimated). Nothing in this build looks at a video frame',
      'infer a learned preference from project data alone, or apply one automatically once accepted — a candidate is surfaced only from an explicitly-tagged repeated correction, and acceptance changes only its own status field (Part 57, see memory.memoryLimitations())',
      'carry a captured correction or a declared style across projects — ai/memory.js and ai/style.js remain per-project by design (Part 57: generalising a preference is a decision a person makes). Motion clips and knowledge entries DO cross now, through ai/library.js and the on-disk knowledge folder',
      'measure readability, visual noise, or the technical/performance cost of a technique — Part 71\'s relevance gate reports these as unanswerable rather than guessing (see knowledge.evaluateRelevance)',
      'measure 10 of Part 59\'s 21 evaluation dimensions — time to result, corrections, iterations, tool calls, rollback frequency and approval rate are session or human facts; render cost, visual continuity and camera readability need the renderer; export success needs the impure validator (see benchmark.EVALUATION_DIMENSIONS)',
      'benchmark 9 of Part 59\'s 25 categories — idle, run, start/stop, jump, turn, dodge, layered upper-body, camera follow and the complex shot each name what blocks them (see benchmark.listBenchmarks().categories)',
      'adopt an architecture change on its own: a proposal\'s verdict is mechanical and its approval is a person\'s, recorded with the version it shipped in and the commit that reverses it (Part 60, Part 4.8)',
    ],
    never_claims: 'a result reports what it examined in its `coverage` field, and every assertion carries a certainty level from Part 13 — an absent check is named, not implied to have passed. A constraint whose check does not exist yet is reported as not checked, never as satisfied, and an acceptance report distinguishes `accepted` from `fully_validated`.',
  };
}
