# Requirements coverage matrix

Directive Part 9. **This is the living document.** Every requirement in
`Cadence_Animator_Ultimate_Master_Directive.md` gets a row and keeps it. Part 9: *"No requirement
may disappear because it is inconvenient. If it is deferred, explain the dependency and preserve
its interface."*

Last reconciled against the source tree: **v0.11.0 + animation-intelligence Phase 1**, by reading
`renderer/js/ai/*.js`, `test/aitest.mjs`, the semantic-layer block of `MCP_HANDLERS` in
`renderer/js/app.js`, and the semantic-layer section of `mcp-server/index.js`. Cells were verified
against the code, not carried forward.

## How to read a row

| Column | Meaning |
| --- | --- |
| **ID** | stable; never reused, never renumbered |
| **§** | directive section that is the source of the requirement |
| **Pri** | P0 foundation (something else is blocked on it) · P1 core product promise · P2 quality · P3 optional/specialised |
| **Status** | `unplanned` · `designed` (interface exists, behaviour does not) · `partial` (some of the requirement genuinely works; the Limits cell says which part does not) · `implemented` · `benchmarked` · `deferred` (with a stated dependency) · `blocked` |
| **Repr.** | the data representation that carries it |
| **Module** | primary owning module |
| **MCP** | tools / resources / workflows that expose it |
| **UI** | user-visible location, or `—` for model-facing only |
| **Tests** | what proves it |
| **Bench** | benchmark coverage (Part 59) |
| **Limits** | the honest caveat |

`Owner` is the animation-intelligence programme for every row below unless a row says otherwise.
`Version introduced` is recorded in the Status cell for anything past `designed`.

Status counts, this revision, counted from the table itself — **165 rows**:
**implemented 41 · partial 7 · designed 10 · deferred 2 · blocked 1 · unplanned 104.**
Nothing is `benchmarked`; no benchmark suite exists yet (BCH-001).

(The previous revision claimed *implemented 31 · designed 14 · deferred 9 · unplanned 96*, which
summed to 150 against 165 rows. Those counts were hand-written and wrong; these are counted.)

---

## A. Semantic model — Parts 16–19, 66

| ID | Requirement | § | Pri | Status | Repr. | Module | MCP | UI | Tests | Bench | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SEM-001 | Stable immutable id on every exposed entity | 16 | P0 | implemented (0.12.0) | `entityId` strings, derived deterministically | `ai/ids.js` (mint/parse) + `ai/scenegraph.js` `resolveEntity` (inverse) | all `inspect_*` | — | `aitest ids`; smoketest "entity ids round-trip back to the live objects they name" proved every r15 part and joint id resolves back, and that a joint id survives a rename | — | joint/key ids are *derived*, not native; see SEM-002/003. `idDurability()` reports per type what each survives |
| SEM-002 | Native joint id in project data | 16 | P2 | deferred | — | `state.js` | — | — | — | — | blocked on a track-table migration (tracks are keyed by joint name); derived ids used instead |
| SEM-003 | Native keyframe id | 19 | P2 | deferred | — | `state.js` | — | — | — | — | same migration as SEM-002; keys addressed as `(itemId, track, t)` |
| SEM-004 | Human-readable name distinct from id | 16 | P0 | implemented (0.12.0) | `name` field on every node | `ai/scenegraph.js`, `ai/riggraph.js`, `ai/timelinegraph.js` | `inspect_*` | explorer | `aitest scene graph`, `aitest rig graph` | — | — |
| SEM-005 | Type, source/owner, lifecycle status per entity | 16 | P1 | implemented (0.12.0) | `type`/`source_asset`/`lifecycle` | `ai/scenegraph.js` | `inspect_scene` | — | `aitest scene graph` | — | `lifecycle` is `active`/`attached` only; no archived state yet |
| SEM-006 | Parent + dependent references per entity | 16 | P1 | implemented (0.12.0) | `parent_id`/`children_ids`/`dependency_ids` | `ai/scenegraph.js` | `inspect_scene` | — | `aitest scene graph` | — | dependency edges are structural + attachment + animation-binding only until SEM-016 |
| SEM-007 | Version / revision per entity | 16 | P1 | implemented (0.12.0) | `revision` = 128-bit content hash of the entity's own subtree | `ai/hash.js` (consumed by all three graphs) | `inspect_*` | — | `aitest hash` (10 checks incl. a 4096-value distribution check); `aitest rig graph` proves a rig revision ignores track edits | — | revision changes on any field change, incl. cosmetic ones. Baked textures are excluded from the scene revision so a re-bake is not read as a semantic change. Non-cryptographic — content addressing only |
| SEM-008 | Semantic role per entity | 17 | P0 | implemented (0.12.0) | `role` + `side` + `role_source` + `role_certainty` + `role_confidence` + `role_evidence` | `ai/roles.js` | `inspect_rig`, `resolve_semantic` | — | `aitest roles` — all 4 builtin rigs map `exact` on every part and joint | — | inference covers R6/R15/Rthro exactly; custom rigs are token-matched at `possible`; unmatched are `unknown` + `user_intent_required` |
| SEM-009 | Role override, user- and AI-settable | 21, 57 | P1 | implemented (0.12.0) | `project.semantics.roles` | `ai/roles.js` | `set_semantic_role` | — | `aitest roles`; smoketest proves a pin resolves `certain` and that `undo` removes it (see TXN-004) | — | no UI yet; MCP-only |
| SEM-010 | Visibility / lock / edit-permission metadata | 16 | P1 | designed | `project.semantics.locks` | `ai/scenegraph.js` (item locks), `ai/timelinegraph.js` (`locked_range` per track) | reported by `inspect_scene` / `inspect_timeline`; no setter yet | — | — | — | shape reserved and reported; nothing enforces it until CON-005 |
| SEM-011 | Scene Graph, Part 17 field list | 17 | P0 | implemented (0.12.0) | `SceneGraph` | `ai/scenegraph.js` | `inspect_scene` | — | `aitest scene graph` | — | `material_ids`, `light_relationships` are `null` — Cadence has no material or light entities. `selection_state` null unless the caller supplies session state |
| SEM-012 | Semantic selection ("the weapon hand") | 17 | P0 | implemented (0.12.0) | `Resolution{matches,alternatives,question,coverage}` | `ai/select.js` | `resolve_semantic`, `selection_vocabulary` | — | `aitest select` (12 checks) | — | "planted foot" is a motion heuristic labelled *highly likely*, never *certain*; "impact target" refuses honestly (needs SHOT-002) |
| SEM-013 | Rig Graph, Part 18 field list | 18 | P0 | implemented (0.12.0) | `RigGraph` | `ai/riggraph.js` | `inspect_rig` | — | `aitest rig graph` | — | `joint_limits` is `null` (unknown) — Cadence stores none; not zero, *unknown* |
| SEM-014 | Rig validation before generation | 18 | P0 | implemented (0.12.0) | `RigGraph.validation` (findings + `coverage.notRun`) | `ai/riggraph.js` | `inspect_rig` | — | `aitest rig graph` — incl. the rthro rest-pose defect and the R6 rotated-bind case | — | checks root, duplicate motors, orphans, rest-pose consistency, mirror completeness, role coverage, joint-name clashes, export shape. NOT pose validity (needs MOT-*), animation layers, prop attachment points, or constraints — all named in `coverage.notRun` |
| SEM-015 | Timeline Graph, Part 19 field list | 19 | P0 | implemented (0.12.0) | `TimelineGraph` | `ai/timelinegraph.js` | `inspect_timeline` | — | `aitest timeline graph` | — | `layer`/`blend_mode`/`weight` are `null` — Cadence has no animation layers. `in_tangent`/`out_tangent` null — keys carry easing style/direction, not tangent vectors |
| SEM-016 | Dependency Graph with typed edges | 66 | P1 | designed | `DependencyGraph{edges,types_present,types_absent}` | `ai/scenegraph.js` | `inspect_scene` | — | `aitest scene graph` | — | `transform_inheritance`, `animation_binding`, `attachment`, `effect_binding` only. The six absent types (material, lighting, cache, render, export, rig-constraint) are enumerated with a reason each, not omitted |
| SEM-017 | Invalidation policy on change | 66 | P1 | unplanned | — | — | — | — | — | — | needs SEM-016 complete + OBS-* |
| SEM-018 | Immutable content-addressed scene snapshots | 17 | P0 | implemented (0.12.0) | `Snapshot{id,hash,project,captures,not_captured}` | `ai/snapshot.js` | `snapshot_scene`, `list_snapshots`, `restore_snapshot` | — | `aitest snapshot` (8 checks) | — | deep-frozen clones deduped by hash, in memory, capacity-capped, pinned ones never evicted; **not persisted across an app restart**. `semantics.provenance` is deliberately excluded (`withoutHistory`) so taking a snapshot cannot change what it snapshots and a restore cannot erase history |
| SEM-019 | Canonical time representation + explicit fps conversion | 19 | P0 | implemented (0.12.0) | `TimelineGraph.time` | `ai/timelinegraph.js` | `inspect_timeline` | — | `aitest timeline graph`; smoketest asserts the reported fps matches the project's | — | frames are canonical; `seconds` is derived, rounded to 6 dp, and always reported with the fps used |
| SEM-020 | Motion Graph | 22 | P1 | unplanned | — | — | — | — | — | — | Phase 5 |
| SEM-021 | Shot Graph | 40 | P1 | unplanned | — | — | — | — | — | — | Phase 6/7 |
| SEM-022 | Provenance Graph | 56 | P0 | implemented (0.12.0) | `project.semantics.provenance` — 11 node types, 11 edge types | `ai/provenance.js` | `record_provenance`, `inspect_provenance` | — | `aitest provenance` (8 checks) incl. a JSON save/load round trip | — | append-only, capped (truncation is counted and announced, never silent). Lives in the project so it survives save/load; **undo deliberately does not rewind it** (`state.js undoableSemantics`) — an undo that erased the record of the change being undone would defeat the point |

## B. Formal animation language — Part 20

| ID | Requirement | § | Pri | Status | Repr. | Module | MCP | UI | Tests | Bench | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CAL-001 | IntentSpec | 20.1 | P0 | unplanned | — | — | — | — | — | — | Phase 3 |
| CAL-002 | MotionPlan with phases | 20.2 | P0 | unplanned | — | — | — | — | — | — | Phase 3 |
| CAL-003 | PoseSpec | 20.3 | P0 | unplanned | — | — | — | — | — | — | Phase 3 |
| CAL-004 | TimingSpec | 20.4 | P0 | unplanned | — | — | — | — | — | — | Phase 3 |
| CAL-005 | SpacingSpec | 20.4 | P0 | unplanned | — | — | — | — | — | — | Phase 3 |
| CAL-006 | ContactSpec | 20.5 | P0 | unplanned | — | — | — | — | — | — | Phase 3; contact *capability* per joint already in SEM-013 |
| CAL-007 | ConstraintSpec | 20.6 | P0 | unplanned | — | — | — | — | — | — | Phase 2 |
| CAL-008 | AcceptanceSpec | 20.7 | P0 | unplanned | — | — | — | — | — | — | Phase 3 |
| CAL-009 | Independent timing/pose/spacing edits | 20.4, 27 | P1 | unplanned | — | — | — | — | — | — | needs CAL-002/004/005 |
| CAL-010 | Human-readable interpretation of intent | 20.1 | P1 | unplanned | — | — | — | — | — | — | — |

## C. Vocabulary and interpretation — Part 21

| ID | Requirement | § | Pri | Status | Repr. | Module | MCP | UI | Tests | Bench | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| VOC-001 | Editable term → dimension vocabulary | 21 | P1 | unplanned | — | — | — | — | — | — | Phase 8 |
| VOC-002 | Terms: heavy / snappy / floaty / panicked / elegant | 21 | P1 | unplanned | — | — | — | — | — | — | — |
| VOC-003 | Per-term counterexamples + failure modes | 21 | P2 | unplanned | — | — | — | — | — | — | — |
| VOC-004 | Scoped user/project override of a term | 21, 57 | P1 | unplanned | — | — | — | — | — | — | must not silently overwrite the global definition |

## D. Motion measurement — Parts 22, 23, 27, 28, 29, 30

| ID | Requirement | § | Pri | Status | Repr. | Module | MCP | UI | Tests | Bench | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MOT-001 | Pure forward-kinematic world solve at any frame | 23 | P0 | implemented (0.12.0) | `Map<partId, CFrame>` | `ai/kinematics.js` | (internal; feeds `inspect_scene`, `resolve_semantic`) | — | `aitest kinematics` (identity pose reproduces r6/r15 rest exactly) **+ in-app cross-check vs `rigbuild.js solvePoseWorlds`: worst deviation 0 on all four builtin rigs (r6 35 comparisons, r15/rthro/rthroSlender 80 each, over 5 frames), and 0 again on the world-space "unparented" branch** | — | mirrors `rigbuild.js` rather than sharing code (the original is three.js-bound). Drift is caught by test, not prevented by construction — the two smoketest steps are the gate on any edit to this file |
| MOT-002 | Pure track evaluation at any frame | 19 | P0 | implemented (0.12.0) | value (CFrame or number) | `ai/kinematics.js` | (internal) | — | `aitest kinematics` **+ in-app cross-check vs `state.js evalTrackCF`/`evalTrackNum`: 133 samples at 0.25-frame steps across Cubic/Quad/Elastic/Bounce/Back/Linear + a bezier override, worst deviation 0** | — | same drift caveat as MOT-001. One deliberate divergence: a held value outside the key range is returned as a copy, not the live array, so a caller cannot mutate project data through a query |
| MOT-003 | Linear + angular velocity | 23 | P0 | unplanned | — | — | — | — | — | — | Phase 5 |
| MOT-004 | Acceleration, angular acceleration, jerk | 23 | P0 | unplanned | — | — | — | — | — | — | Phase 5 |
| MOT-005 | Path curvature and arc deviation | 23, 26.7 | P1 | unplanned | — | — | — | — | — | — | Phase 5 |
| MOT-006 | Screen-space velocity / acceleration | 23 | P1 | unplanned | — | — | — | — | — | — | needs an active camera model (SEM-021) |
| MOT-007 | Key density + tangent continuity as measurements | 23, 31 | P1 | unplanned | — | — | — | — | — | — | Phase 5 |
| MOT-008 | Distance to contact target / foot drift | 23, 30 | P0 | unplanned | — | — | — | — | — | — | Phase 5; needs CAL-006 |
| MOT-009 | Motion Graph lead/lag analysis | 22 | P1 | unplanned | — | — | — | — | — | — | Phase 5 |
| MOT-010 | Noise vs signal policy (stylised holds, stepped, jitter) | 23 | P1 | unplanned | — | — | — | — | — | — | must not label deviation-from-smooth as a defect |
| MOT-011 | Centre of mass, support polygon, balance state | 28, 29 | P1 | unplanned | — | — | — | — | — | — | part mass unknown; would use volume as a proxy and say so |
| MOT-012 | Silhouette derivation + comparison | 28 | P1 | unplanned | — | — | — | — | — | — | needs OBS-002 |
| MOT-013 | Timing analysis (phase duration, holds, contrast) | 27 | P1 | unplanned | — | — | — | — | — | — | needs CAL-004 |
| MOT-014 | Spacing analysis | 27 | P1 | unplanned | — | — | — | — | — | — | needs CAL-005 |
| MOT-015 | Counter-rotation / kinetic-chain analysis | 29 | P2 | unplanned | — | — | — | — | — | — | — |
| MOT-016 | Locomotion state reasoning (contact/passing/up/down) | 30 | P2 | unplanned | — | — | — | — | — | — | — |
| MOT-017 | Per-frame rotation/position pop detection | 23 | P1 | implemented (pre-existing) | findings list | `validate.js` | `validate_animation` | — | in-app smoketest | — | fixed thresholds (35°, 3 studs); not style-aware |
| MOT-018 | Hinge-axis misalignment detection | 32 | P1 | implemented (pre-existing) | findings list | `validate.js` | `validate_animation` | — | in-app smoketest | — | weak on rigs whose C0/C1 are not identity. **Its own comment is factually wrong**: it claims identity C0/C1 on every builtin rig, but all six R6 joints carry 90° rotations (verified; R15/Rthro are identity). Whether that weakens the check is unestablished — see audit §4. `inspect_rig` now reports `local_axis_convention` per joint so a caller can see which rigs the assumption holds for |
| MOT-019 | Degenerate-CFrame detection | 23 | P1 | implemented (pre-existing) | findings list | `validate.js` | `validate_animation` | — | in-app smoketest | — | — |

## E. Compilation and platform — Part 24, 33

| ID | Requirement | § | Pri | Status | Repr. | Module | MCP | UI | Tests | Bench | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CMP-001 | Motion compiler (CAL → rig edits) | 24 | P0 | unplanned | — | — | — | — | — | — | Phase 3 |
| CMP-002 | Roblox adapter: semantic role → rig component | 24 | P0 | implemented (0.12.0) | `roblox_mapping` on each rig node (`partId`/`jointName`/`className`/`part0`/`part1`/`trackName`) | `ai/riggraph.js` | `inspect_rig` | — | `aitest rig graph` | — | mapping only; no compilation yet |
| CMP-003 | Report unsupported constructs rather than dropping | 24 | P0 | designed | `limitations[]` on every graph | `ai/riggraph.js`, `ai/scenegraph.js`, `ai/timelinegraph.js` | `inspect_scene`, `inspect_rig`, `inspect_timeline` | — | `aitest scene graph` / `rig graph` / `timeline graph` assert the specific limitation strings | — | every graph carries a `limitations` array; populated for what is known now |
| CMP-004 | Mapping provenance (low-level change → intent) | 24 | P1 | designed | provenance `implements`/`interprets` edges | `ai/provenance.js` | `inspect_provenance` | — | `aitest provenance` | — | edge types exist and `explain()` traverses them; nothing emits intent edges until CAL-001 |
| CMP-005 | Retargeting as adaptation, with a transfer report | 33 | P2 | unplanned | — | — | — | — | — | — | `mirror_partner` (SEM-013) is the first ingredient |
| CMP-006 | Existing Roblox export bake (easing → per-frame keys) | 24 | P1 | implemented (pre-existing) | — | `io.js` | `export_to_studio` | export menu | in-app smoketest | — | — |

## F. Knowledge system — Parts 25, 26, 71, 72, 73

| ID | Requirement | § | Pri | Status | Repr. | Module | MCP | UI | Tests | Bench | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| KNW-001 | Knowledge entries with the Part 25 field list | 25 | P1 | unplanned | — | — | — | — | — | — | Phase 8 |
| KNW-002 | Category: essential/advanced/optional/specialised/experimental | 25 | P1 | unplanned | — | — | — | — | — | — | — |
| KNW-003 | 12 classical principles, operationalised | 26 | P1 | unplanned | — | — | — | — | — | — | Phase 8 |
| KNW-004 | Principle Interaction Graph | 71 | P2 | unplanned | — | — | — | — | — | — | — |
| KNW-005 | Relevance gate ("does this serve the intent?") | 25, 71 | P1 | unplanned | — | — | — | — | — | — | — |
| KNW-006 | Controlled knowledge expansion procedure | 72 | P2 | unplanned | — | — | — | — | — | — | — |
| KNW-007 | Premium-animation standard as an explicit definition | 73 | P2 | unplanned | — | — | — | — | — | — | — |

## G. Style, reference, performance animation — Parts 34, 35, 36

| ID | Requirement | § | Pri | Status | Repr. | Module | MCP | UI | Tests | Bench | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| STY-001 | Style profiles change thresholds, not just labels | 35 | P1 | unplanned | — | — | — | — | — | — | Phase 8 |
| STY-002 | Named styles: realistic/anime/cartoon/game-combat/cinematic/mechanical/genre | 35 | P1 | unplanned | — | — | — | — | — | — | — |
| REF-001 | Reference ingestion → profile (not raw copy) | 36 | P2 | unplanned | — | — | — | — | — | — | Phase 8 |
| REF-002 | Separate "emulate" from "deliberately not copied" | 36 | P2 | unplanned | — | — | — | — | — | — | — |
| FAC-001 | Facial / performance representation | 34 | P3 | designed (pre-existing) | face layers | `state.js` face tracks | `add_face_layer`, `apply_face_preset` | inspector | in-app smoketest | — | decals/layers only; no gaze, blink timing, or micro-expression semantics |

## H. VFX intelligence — Parts 37, 38, 39

| ID | Requirement | § | Pri | Status | Repr. | Module | MCP | UI | Tests | Bench | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| VFX-001 | Semantic VFX language + compiler | 37 | P1 | implemented (0.10.0) | PNX graph | `pnx/**` | 31 `pnx_*` tools | node editor, Effect Sheet | `pnxtest` — 293 checks, 292 pass here (the 1 failure is a hardware-dependent perf budget, not a defect) | — | authoring language is nodes/sheet, not `VFXSpec` prose |
| VFX-002 | `VFXSpec` structure per Part 37.1 | 37.1 | P2 | unplanned | — | — | — | — | — | — | PNX covers the *capability*; the declarative spec object does not exist |
| VFX-003 | Effect primitives, parameterised and composable | 37.2 | P1 | implemented (0.10.0) | recipes | `pnx/library.js` | `pnx_list_recipes`, `pnx_add_recipe` | palette | `pnxtest` | — | — |
| VFX-004 | Preview + render of an effect frame | 37 | P1 | implemented (0.10.0) | image | `pnx/render.js` | `pnx_render_frame`, `pnx_scrub` | studio | `pnxtest` | — | — |
| VFX-005 | Determinism under scrubbing | 37, 67 | P0 | implemented (0.10.0) | checkpoint replay | `pnx/solver.js` | `pnx_verify_range` | — | `pnxtest` | — | — |
| VFX-006 | Performance budget reporting | 37, 38 | P1 | implemented (0.10.0) | report | `pnx/**` | `pnx_profile`, `vfx_performance_report` | studio | `pnxtest` | — | — |
| VFX-007 | Export-compatibility probing | 24, 37 | P1 | implemented (0.11.0) | report | `pnx/targets` | `pnx_export_compatibility` | — | `pnxtest` | — | — |
| VFX-008 | VFX temporal/quality analysis (Part 38 list) | 38 | P2 | designed | validators | `effectValidators.js` | `vfx_validate` | studio | `coretest` | — | covers a subset; attachment stability, depth integration, flicker are not measured |
| VFX-009 | VFX failure patterns (Part 38 list) | 38 | P2 | unplanned | — | — | — | — | — | — | needs OBS-* to observe most of them |
| VFX-010 | VFX timing tied to shot events (lead/lag) | 39 | P1 | unplanned | — | — | — | — | — | — | needs SHOT-002 |
| VFX-011 | VFX hierarchy (primary/supporting/residual) | 38 | P2 | unplanned | — | — | — | — | — | — | — |

## I. Shot, camera, events, audio — Parts 40, 41, 42

| ID | Requirement | § | Pri | Status | Repr. | Module | MCP | UI | Tests | Bench | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SHOT-001 | Shot model (Part 40 field list) | 40 | P1 | unplanned | — | — | — | — | — | — | Phase 6/7 |
| SHOT-002 | Shared shot-event timeline | 41 | P0 | unplanned | — | — | — | — | — | — | Phase 6; markers (`state.js`) are the migration target |
| SHOT-003 | `CameraSpec` | 40 | P1 | unplanned | — | — | — | — | — | — | — |
| SHOT-004 | Camera reasoning (framing, readability, occlusion) | 40 | P1 | unplanned | — | — | — | — | — | — | needs OBS-* |
| SHOT-005 | Deliberate camera shake with decay + budget | 40 | P2 | unplanned | — | — | — | — | — | — | — |
| SHOT-006 | Event markers with width and code hooks | 41 | P1 | implemented (pre-existing) | `project.markers` | `state.js` | `add_marker`, `set_marker`, `list_markers` | timeline | in-app smoketest | — | no causal parent, tolerance, priority, or dependent-system fields |
| AUD-001 | Audio as a shot partner | 42 | P3 | designed (pre-existing) | `project.audio` | `state.js`/`audio.js` | `set_project_props` | timeline | in-app smoketest | — | one track, offset + volume; no cue graph |

## J. Observation and regression — Parts 43, 44, 45, 46

| ID | Requirement | § | Pri | Status | Repr. | Module | MCP | UI | Tests | Bench | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OBS-001 | Beauty render of a chosen frame | 43 | P0 | implemented (pre-existing) | PNG | `app.js`/`viewport.js` | `render_frame` | viewport | in-app smoketest | — | — |
| OBS-002 | Silhouette pass | 43 | P0 | unplanned | — | — | — | — | — | — | Phase 4; buildable on the existing scene |
| OBS-003 | Object-ID pass | 43 | P0 | unplanned | — | — | — | — | — | — | Phase 4; buildable |
| OBS-004 | Depth pass | 43 | P1 | unplanned | — | — | — | — | — | — | Phase 4; buildable |
| OBS-005 | Normal pass | 43 | P2 | unplanned | — | — | — | — | — | — | buildable |
| OBS-006 | Motion-vector pass | 43 | P2 | blocked | — | — | — | — | — | — | needs a velocity-writing material set the renderer does not have |
| OBS-007 | Isolation renders (object / effect) | 43 | P1 | unplanned | — | — | — | — | — | — | buildable |
| OBS-008 | Contact sheets, crops, overlays, changed-region masks | 43 | P1 | unplanned | — | — | — | — | — | — | Phase 4 |
| OBS-009 | Hierarchical observation policy (cheapest evidence first) | 43 | P0 | unplanned | — | — | — | — | — | — | policy, not a pass — belongs with REG-002 |
| REG-001 | Baselines with the Part 44 field list | 44 | P0 | unplanned | — | — | — | — | — | — | Phase 4; SEM-018 snapshots are the substrate |
| REG-002 | Regression workflow (scope → cheapest evidence → classify) | 44 | P0 | unplanned | — | — | — | — | — | — | Phase 4 |
| REG-003 | Multiple comparison methods (pixel/perceptual/edge/ID/depth/curve/scene/temporal) | 44 | P0 | partial (0.12.0) | `Diff{items,tracks,project_fields,changed_frame_range}` | `ai/snapshot.js` `diffProjects` | `diff_snapshots` | — | `aitest diff` (7 checks); smoketest asserts a one-key edit reports exactly one modified key and frames 10–10 | — | **Only the two data-side methods exist**: scene-graph difference (items added/removed/changed with the changed field names) and curve difference (keys added/removed/modified per track, plus track-space changes). It is key-aware, not a generic deep diff, so a key inserted mid-track reads as one addition rather than as every later key moving. Every image-based method — pixel, perceptual, edge, object-ID, depth, temporal — needs OBS-* and does not exist |
| REG-004 | Difference classification (expected/unexpected/uncertain/approved) | 44 | P0 | unplanned | — | — | — | — | — | — | `diff_snapshots` reports *what* changed but classifies nothing; needs REG-001 baselines + TXN-001 to know what was approved |
| EXP-001 | Change explanation with ranked causes and evidence | 45 | P0 | unplanned | — | — | — | — | — | — | Phase 4 |
| EXP-002 | "Why?" diagnostic workflows | 46 | P1 | unplanned | — | — | — | — | — | — | Phase 5 |
| EXP-003 | Certainty taxonomy on every finding | 13 | P0 | implemented (0.12.0) | `certainty` field on every finding + `evidence[]` with a closed kind set | `ai/certainty.js` | every `ai/*` tool result | — | `aitest certainty` (5 checks) — an unlabelled finding or an unknown evidence kind **throws** at construction | — | enforced on the new layer only; `validate.js` still uses error/warn/info |

## K. Simulation, experiments, review — Parts 47, 48, 49

| ID | Requirement | § | Pri | Status | Repr. | Module | MCP | UI | Tests | Bench | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SIM-001 | Cadence Simulation pre-commit report | 47 | P1 | unplanned | — | — | — | — | — | — | Phase 7 |
| EXPT-001 | Named, bounded, reversible experiments | 48 | P1 | unplanned | — | — | — | — | — | — | Phase 7; needs TXN-* |
| EXPT-002 | Meaningful (non-random) candidate generation | 48 | P1 | unplanned | — | — | — | — | — | — | — |
| REV-001 | Structured senior-review command | 49 | P1 | unplanned | — | — | — | — | — | — | Phase 7 |
| REV-002 | Suspect-frame identification | 49 | P1 | unplanned | — | — | — | — | — | — | — |

## L. MCP interface — Parts 50, 51, 52

| ID | Requirement | § | Pri | Status | Repr. | Module | MCP | UI | Tests | Bench | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MCP-001 | Structured arguments and structured results | 50 | P0 | implemented (pre-existing) | zod + JSON | `mcp-server/index.js` | all 152 tools (140 pre-existing + 12 semantic-layer) | — | in-app registration gate | — | — |
| MCP-002 | Every handler is reachable (no dead capability) | 50 | P0 | implemented (pre-existing) | — | `test/smoketest.js` | — | — | registration-coverage step — 87 handler keys, all registered, 2 deliberate exclusions | — | — |
| MCP-003 | Tools declare read-only / preview / transactional / destructive | 50 | P0 | partial (0.12.0) | the effect is the first word of the tool description (`READ-ONLY.` / `MUTATING (undoable).` / `DESTRUCTIVE (undoable).`) | `mcp-server/index.js` | the 12 semantic-layer tools | — | `aitest mcp` — parses `mcp-server/index.js` and asserts all 12 open with one of the three markers, and that the three mutating ones are not declared read-only. Negative-tested: removing one marker fails the check | — | still `partial`: the convention holds and is now enforced for the 12 semantic-layer tools, but the 140 pre-existing ones are undeclared and the marker is prose in a description rather than a structured field a client could filter on |
| MCP-004 | Mutating tools return transaction id, scope, rollback availability | 50 | P0 | unplanned | — | — | — | — | — | — | Phase 2. `restore_snapshot` returns `before_snapshot` + a diff, which is the shape but not the contract |
| MCP-005 | Core inspection tools (Part 50 list) | 50 | P0 | partial (0.12.0) | — | `ai/scenegraph.js`, `ai/riggraph.js`, `ai/timelinegraph.js`, `ai/provenance.js` | `inspect_scene`, `inspect_rig`, `inspect_timeline`, `inspect_provenance` | — | smoketest "every new MCP handler runs against the live project and returns its documented shape" | — | 4 of the 10 named in Part 50. `inspect_animation_curves` is folded into `inspect_timeline`; `inspect_motion_graph`, `inspect_effect_graph`, `inspect_shot_events`, `inspect_constraints`, `inspect_dependencies` (as its own tool) do not exist |
| MCP-006 | Rendering/observation tools (Part 50 list) | 50 | P0 | unplanned | — | — | `render_frame` (pre-existing) only | — | — | — | 1 of 9; the rest need OBS-* |
| MCP-007 | Analysis tools (Part 50 list) | 50 | P0 | unplanned | — | — | — | — | — | — | Phase 5 |
| MCP-008 | Planning/generation tools (Part 50 list) | 50 | P0 | unplanned | — | — | — | — | — | — | Phase 3 |
| MCP-009 | Safe mutation tools (Part 50 list) | 50 | P0 | partial (0.12.0) | — | `ai/snapshot.js` | `snapshot_scene`, `list_snapshots`, `restore_snapshot`, `diff_snapshots` | — | `aitest snapshot`, `aitest diff`; smoketest runs snapshot → edit → diff → restore end to end | — | 2 of Part 50's 15 (`snapshot_scene`, `restore_snapshot`); `undo_change`/`redo_change` exist as the pre-existing `undo`/`redo`. The `preview_*_patch`, `apply_*_patch`, `rollback_transaction` and `lock_constraint` families all need Phase 2 |
| MCP-010 | Learning/admin tools (Part 50 list) | 50 | P1 | unplanned | — | — | — | — | — | — | Phase 8/9 |
| MCP-011 | MCP resources (`cadence://…`) | 51 | P1 | unplanned | — | — | — | — | — | — | the graphs are resource-shaped already; only the transport is missing |
| MCP-012 | Reusable workflows | 52 | P1 | unplanned | — | — | — | — | — | — | Phase 7 |
| MCP-013 | Analysis results pair prose with structured evidence | 50 | P0 | implemented (0.12.0) | `{statement, evidence[], certainty}` per finding; `{summary, coverage}` per result | `ai/certainty.js`, `ai/riggraph.js`, `ai/select.js` | `inspect_rig`, `resolve_semantic` | — | `aitest certainty`, `aitest rig graph`, `aitest select` | — | new layer only; `validate_animation` still returns prose-plus-severity |

## M. Safety: constraints, transactions, provenance — Parts 12, 54, 55, 56

| ID | Requirement | § | Pri | Status | Repr. | Module | MCP | UI | Tests | Bench | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CON-001 | ConstraintSpec compilation from a request | 54 | P0 | unplanned | — | — | — | — | — | — | Phase 2 |
| CON-002 | Constraint priorities (Part 54 ordering) | 54 | P0 | unplanned | — | — | — | — | — | — | Phase 2 |
| CON-003 | Scope analysis before a patch | 54 | P0 | unplanned | — | — | — | — | — | — | Phase 2 |
| CON-004 | Conflict reporting instead of silent resolution | 54 | P0 | unplanned | — | — | — | — | — | — | Phase 2 |
| CON-005 | Lock enforcement on locked properties | 54 | P0 | unplanned | — | — | — | — | — | — | Phase 2; `project.semantics.locks` reserved (SEM-010) |
| TXN-001 | Transaction record (Part 55 field list) | 55 | P0 | unplanned | — | — | — | — | — | — | Phase 2 |
| TXN-002 | Dry run / preview before apply | 55 | P0 | unplanned | — | — | — | — | — | — | Phase 2 |
| TXN-003 | Scoped rollback (property, time range, whole transaction) | 55 | P0 | unplanned | — | — | — | — | — | — | Phase 2, via recorded inverse edits |
| TXN-004 | Whole-project undo/redo | 55 | P0 | implemented (pre-existing, extended 0.12.0) | clone stack over an explicit field allowlist | `state.js` `snapshot`/`applySnapshot`/`undoableSemantics` | `undo`, `redo` | Ctrl+Z | in-app smoketest; the semantic-layer step asserts `undo` removes a pinned role | — | linear; no branch. **`snapshot()` clones a hard-coded field list, so any new top-level project field is silently outside undo until added** — `semantics` was, and was fixed in 0.12.0 (audit §7.2). `semantics.provenance` is deliberately held out and carried across live: rewinding history would erase the record of the change being undone |
| TXN-005 | Restore an approved baseline | 55 | P0 | unplanned | — | — | — | — | — | — | needs REG-001. `restore_snapshot` + a pinned snapshot is the mechanism; what is missing is the *approval* that makes a snapshot a baseline |
| TXN-006 | Failure behaviour (preserve state, never apply partial) | 55 | P0 | designed | — | `ai/snapshot.js` | `snapshot_scene` (pinned), and `restore_snapshot` auto-pins a before-state | — | `aitest snapshot` | — | snapshot-before is available and `restore_snapshot` takes one automatically; the discipline is not yet *enforced* by a transaction engine |
| TXN-007 | Fix-only-unintended-changes workflow | 55 | P1 | unplanned | — | — | — | — | — | — | needs REG-001..004 |
| PRV-001 | Provenance record per request/plan/patch/render/analysis/decision | 56 | P0 | implemented (0.12.0) | `provenance` graph — 11 node types, 11 edge types, monotonic ids | `ai/provenance.js` | `record_provenance`, `inspect_provenance` | — | `aitest provenance` | — | nodes and edges exist; only the tools written so far emit them (`set_semantic_role`, `snapshot_scene`, `restore_snapshot`). Nothing emits `intent`/`plan` until CAL-001 |
| PRV-002 | Provenance answers "why is this built this way" | 56 | P0 | implemented (0.12.0) | `explain()` ancestry traversal + `historyOf()` per entity | `ai/provenance.js` | `inspect_provenance` | — | `aitest provenance`; smoketest asserts a patch traces back to its request and that `historyOf` names the originating request | — | answer quality is bounded by what has been recorded. A truncated graph reports `complete: false` rather than presenting a partial ancestry as whole |
| PRV-003 | Never self-modify silently | 4.8 | P0 | designed | — | `ai/provenance.js` | — | — | — | — | policy; enforced by review, and by the fact that the only `ai/*` writer is `set_semantic_role`, which writes under `project.semantics` and records what it did |

## N. Memory, benchmarks, improvement — Parts 57, 58, 59, 60

| ID | Requirement | § | Pri | Status | Repr. | Module | MCP | UI | Tests | Bench | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MEM-001 | Scoped memory (facts/heuristics/conventions/character/preferences) | 57 | P1 | unplanned | — | — | — | — | — | — | Phase 8; `project.semantics.memory` reserved |
| MEM-002 | Preference *candidates*, never auto-applied global rules | 57 | P0 | unplanned | — | — | — | — | — | — | — |
| MEM-003 | Learning from accepted work | 58 | P2 | unplanned | — | — | — | — | — | — | — |
| MEM-004 | Learning from failure | 58 | P2 | unplanned | — | — | — | — | — | — | — |
| BCH-001 | Benchmark library (Part 59 categories) | 59 | P1 | unplanned | — | — | — | — | — | — | Phase 9 |
| BCH-002 | Evaluation dimensions (Part 59 list) | 59 | P1 | unplanned | — | — | — | — | — | — | Phase 9 |
| BCH-003 | Human evaluation kept separate from deterministic outcomes | 59 | P1 | unplanned | — | — | — | — | — | — | — |
| ARCH-001 | Controlled architecture-improvement loop | 60 | P2 | unplanned | — | — | — | — | — | — | Phase 9 |
| ARCH-002 | Problem categorisation before rewriting | 60 | P2 | unplanned | — | — | — | — | — | — | — |

## O. Physics, render truth, polish, library — Parts 67, 68, 69, 70

| ID | Requirement | § | Pri | Status | Repr. | Module | MCP | UI | Tests | Bench | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PHY-001 | Perceived-force reasoning distinct from simulation | 67 | P1 | unplanned | — | — | — | — | — | — | — |
| PHY-002 | Procedural assistance with the Part 67 field list | 67 | P2 | partial (PNX only) | — | `pnx/**` | `pnx_*` | node editor | `pnxtest` | — | VFX-side only; no procedural rig behaviour |
| PHY-003 | Controlled, seeded, reproducible randomness | 67 | P0 | implemented (0.10.0) | checkpointed state | `pnx/solver.js` | `pnx_verify_range` | — | `pnxtest` | — | VFX-side only |
| RND-001 | Lighting / material / compositing inspection | 68 | P2 | unplanned | — | — | — | — | — | — | needs OBS-* |
| RND-002 | Alpha and matte correctness | 68 | P2 | unplanned | — | — | — | — | — | — | — |
| RND-003 | Effect Look post chain | 68 | P2 | implemented (0.11.0) | — | `pnx/render.js` | `pnx_*` | studio | `pnxtest` | — | VFX-side only |
| POL-001 | Micro-animation as optional, never a cover for weak timing | 69 | P2 | unplanned | — | — | — | — | — | — | — |
| POL-002 | Intentional imperfection distinguished from artefact | 69 | P1 | unplanned | — | — | — | — | — | — | ties to MOT-010 |
| POL-003 | Professional affordances (onion skin, trails, pose libs, markers) | 69 | P2 | partial (pre-existing) | — | `state.js`/`viewport.js` | — | timeline/viewport | in-app smoketest | — | onion skin, markers, face presets exist; motion trails, pose library, ghosting do not |
| LIB-001 | Project effect/motion library with the Part 70 field list | 70 | P2 | partial (pre-existing) | recipes | `pnx/library.js` | `pnx_list_recipes` | palette | `pnxtest` | — | effects only; no motion library, no acceptance tests or provenance per entry |

## P. Operating discipline — Parts 10, 11, 12, 13, 15

| ID | Requirement | § | Pri | Status | Repr. | Module | MCP | UI | Tests | Bench | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OPS-001 | Explicit operating modes (create/polish/analyse/compare/fix/experiment/review/ship) | 11 | P1 | unplanned | — | — | — | — | — | — | Phase 7 |
| OPS-002 | Exploration vs production mode, always visible | 11 | P1 | unplanned | — | — | — | — | — | — | — |
| OPS-003 | Certainty labels on findings | 13 | P0 | implemented (0.12.0) | `certainty` ∈ {certain, highly_likely, possible, subjective, user_intent_required} | `ai/certainty.js` | `inspect_rig`, `resolve_semantic` | — | `aitest certainty` | — | see EXP-003. `requiresUser()` marks the two levels Part 13 forbids acting on automatically, but nothing yet *consumes* that gate — no tool acts autonomously |
| OPS-004 | Fast loop vs full validation loop, never conflated | 15 | P0 | implemented (0.12.0) | `coverage{scope, frames, loop, notRun}` on every result | `ai/certainty.js` | `inspect_rig`, `resolve_semantic` | — | `aitest certainty` (an unknown `loop` throws); `aitest rig graph` asserts `notRun` is populated; `aitest select` asserts the exact frames sampled | — | `notRun` is hand-maintained per producer — it is a claim by the author, not derived, so a new check added without updating it would silently over-report coverage |
| OPS-005 | Quality hierarchy ordering when critiquing | 14 | P1 | unplanned | — | — | — | — | — | — | Phase 7 |
| OPS-006 | Trust rules (never claim an unrun validation) | 12 | P0 | designed | — | `ai/certainty.js` + every `ai/*` producer | — | — | — | — | enforced by the `coverage`/`certainty` fields and by review. Not machine-checkable: nothing can prove a `notRun` list is complete |
