# Foundation audit — Cadence Animation Intelligence

Directive: `Cadence_Animator_Ultimate_Master_Directive.md`, Part 7 ("Required project inventory
before architecture changes") and Part 62 Phase 0.

Audited against **v0.11.0 / `8343e2f`**, the tip of `origin/main`, working tree clean.
Every claim below was read out of the source at that commit, not recalled.

The purpose of this document is narrow: establish what already exists, who owns which data, and
**where the narrowest compatible insertion point for a semantic layer is**. Part 7 is explicit —
"Do not invent an API when existing code can answer the question. Do not rewrite stable systems
simply because a new abstraction is appealing."

---

## 1. What Cadence is today

| Subsystem | Where | Size | Maturity |
| --- | --- | --- | --- |
| Electron main (window, autosave, Studio bridge :35747, MCP channel :35748, `.rbxm`/`.rbxmx` parsing, updater) | `src/` | ~2.6k lines | stable |
| Project model, tracks, keyframes, undo/redo, evaluation | `renderer/js/state.js` | 1625 | stable |
| CFrame math | `renderer/js/cf.js` | 249 | stable, pure |
| Easing / segment evaluation | `renderer/js/easing.js` | — | stable, pure |
| three.js rig build + FK solve + viewport | `renderer/js/rigbuild.js`, `viewport.js` | large | stable |
| Timeline (canvas dope sheet), curve editor | `timeline.js`, `curves.js` | large | stable |
| Import/export, Roblox bake | `renderer/js/io.js` | 1032 | stable |
| Animation quality heuristics | `renderer/js/validate.js` | 139 | thin |
| Diagnostic framework (validators + auto-fixes) | `renderer/js/diagnostics.js` | 114 | stable, pure |
| PNX procedural VFX engine | `renderer/js/pnx/**` | 390 node types / 30 categories | mature |
| Legacy layer VFX + VFX Studio window | `renderer/js/effect*.js`, `renderer-vfx/` | ~8.8k lines | mature |
| MCP server (stdio → HTTP → IPC → renderer) | `mcp-server/index.js` + `MCP_HANDLERS` in `app.js` | 140 tools | mature |
| Licence service (Cadence Pro) | `services/license/` | 515 | live |

The **VFX half of the directive is largely built.** PNX already satisfies a great deal of Parts
37–39: a semantic effect language compiled to a graph, primitives, previews, validation, a
performance report, export-compatibility probing, and determinism under scrubbing. Parts 37.2's
effect primitives exist as recipes; Part 38's temporal analysis exists in part.

The **animation-intelligence half of the directive is essentially absent.** That is the gap this
programme addresses.

---

## 2. Data ownership map (Part 7.4)

Authoritative owner per data class. "Authoritative" means: if two places disagree, this one wins.

| Data | Authoritative owner | Notes |
| --- | --- | --- |
| Project (items, tracks, keys, groups, markers, playRange, audio) | `state.js` `state.project` | single mutable object; every mutator emits an event |
| Selection, playhead, transport | `state.js` `state.selection` / `state.playhead` | session state, not project data |
| Rig geometry + joint topology | `item.rig` inside the project | parts `{id,name,className,size,cf,color,…}`, joints `{name,kind,part0,part1,c0,c1}` |
| World transforms (rendered) | `rigbuild.js` `RigInstance` | derived; `solvePoseWorlds()` is the side-effect-free query |
| Undo history | `state.js` `undoStack`/`redoStack` | whole-project `structuredClone` snapshots, linear, capped |
| Autosave / recovery | `src/main.js` (`autosave:*` IPC) | rotating `.bak1`–`.bak10`, atomic rename |
| VFX documents | `effectModel.js` (layer docs) / `pnx/graph.js` (procedural) | third document mode is exclusive |
| Render output | `viewport.js` → `capturePage()` in main | one beauty pass only |
| Roblox export | `io.js` (+ `pnx/targets`, `effectExport.js`) | bakes easing to per-frame keys |
| MCP dispatch | `MCP_HANDLERS` in `app.js` | plain `{name: (payload) => result}` |

**Three ownership facts that constrain everything downstream:**

1. **A joint has no stable identifier.** Joints are addressed by `joint.name`, and the entire
   track table is keyed by that same string (`project.tracks[itemId][jointName]`). Parts *do*
   carry `part.id`. Directive Part 16 says "Do not use a display name as the primary identifier" —
   Cadence currently violates that for joints. Re-keying the track table is a destructive
   migration touching `state.js`, `io.js`, `timeline.js`, `curves.js`, the Studio bridge and every
   saved `.cadence` file. **Decision: do not migrate.** The semantic layer mints stable IDs that
   *map onto* name addressing and treats the name as an unstable display attribute. Recorded as a
   known limitation, not hidden. See §5.

2. **Undo is whole-project and linear.** `pushUndo()` deep-clones the project. There is no notion
   of a scoped transaction, no inverse-edit record, no way to roll back one property or one frame
   range, and no baseline. Directive Part 55 requires all four. This is additive work — a
   transaction layer can sit *above* `pushUndo()` without replacing it.

3. **Undo clones an explicit field allowlist, not the whole project.** Despite the name, `snapshot()`
   in `state.js` copies exactly `items, tracks, groups, markers, playRange, onionSkin, length, fps,
   loop, priority, name, audio` — anything else on `state.project` is invisible to undo. Worse,
   `applySnapshot()` merges with `Object.assign`, which never *deletes* a key, so a field outside
   the list not only fails to revert, it cannot be removed by undo at all. This was found the hard
   way: the first `set_semantic_role` call called `pushUndo()` correctly, and `undo` then left the
   pinned role in place. **Fixed** — see §7.2. Anyone adding a new top-level project field must add
   it to that allowlist or it silently sits outside the undo system.

---

## 3. Current AI integration boundary (Part 7.3)

```
Claude ──stdio──▶ mcp-server/index.js ──HTTP :35748──▶ src/main.js ──IPC──▶ app.js MCP_HANDLERS
                     (140 tools, zod)                   (relay)            (executes in renderer)
```

The boundary is healthy and worth keeping:

- Tools take **structured arguments** and return **structured JSON**, not screen coordinates.
- `get_pose` returns exact world CFrames from the pure `solvePoseWorlds`, with no display
  side-effects.
- `render_frame` returns a real image content block, so the model can see a pose.
- A smoketest step already enforces that **every** `MCP_HANDLERS` key has a matching tool
  registration, so a capability cannot be implemented-but-unreachable.

What the boundary lacks, measured against Part 50:

- No tool states whether it is read-only, preview-only, transaction-creating, or destructive.
- No mutating tool returns a transaction id, changed-object list, changed time range, constraint
  results, baseline relationship, or rollback availability. They return the new value only.
- There are **no MCP resources** at all (Part 51) and **no reusable workflows** (Part 52).
- Analysis tools return prose-plus-data in one blob rather than the required "human-readable
  explanation *and* structured evidence" pairing — `validate_animation` is closest to correct.

---

## 4. Gap analysis against the directive

Legend: ● built · ◐ partial · ○ absent

### Semantic model (Parts 16–19)

| Requirement | State | Evidence |
| --- | --- | --- |
| Stable immutable IDs | ◐ | items yes (`crypto.randomUUID()`), parts yes (`part.id`), joints **no**, keys **no** |
| Semantic roles (hips, torso, weapon hand, planted foot…) | ○ | nothing anywhere maps a part to a role |
| Semantic selection | ○ | selection is `{itemId, partId}` only |
| Scene Graph (Part 17 field list) | ◐ | ~8 of 22 fields derivable; no `semantic_role`, `dependency_ids`, `effect_ids`, `lock_state`, `version` |
| Rig Graph (Part 18 field list) | ◐ | topology + rest pose derivable; no limits, mirror partner, chain membership, contact capability, preferred space |
| Timeline Graph (Part 19 field list) | ◐ | keys have `t/v/es/ed/bez/ep`; no `key_id`, `intent_annotation`, `phase_annotation`, `lock_state`, `transaction_origin`, `confidence`; tracks have no `layer`, `blend_mode`, `locked_range`, `weight`, `revision` |
| Motion Graph (Part 22) | ○ | — |
| Effect Graph | ● | PNX |
| Shot Graph (Part 40) | ○ | cameras exist as items; no shot model |
| Dependency Graph (Part 66) | ○ | — |
| Provenance Graph (Part 56) | ○ | — |
| Scene snapshots (Part 17) | ◐ | undo clones and autosave files exist, but neither is immutable, addressable, or content-identified |

### Formal animation language (Part 20)

`IntentSpec`, `MotionPlan`, `PoseSpec`, `TimingSpec`, `SpacingSpec`, `ContactSpec`,
`ConstraintSpec`, `AcceptanceSpec` — **all ○.** Nothing in the codebase represents intent, phase,
contact, constraint, or acceptance. This is the single largest gap and the reason the model
currently has to reason in raw CFrames, which Part 4.2 forbids.

### Measurement (Parts 23, 27, 28)

| Requirement | State |
| --- | --- |
| Per-frame rotation/position delta | ● `validate.js` |
| Degenerate-CFrame detection | ● `validate.js` |
| Hinge-axis misalignment | ● `validate.js` (genuinely good; empirically calibrated) |
| Velocity / angular velocity | ○ |
| Acceleration / angular acceleration / jerk | ○ |
| Path curvature, arc deviation | ○ |
| Screen-space velocity | ○ |
| Key density, tangent continuity as measurements | ○ |
| Contact drift against a declared tolerance | ○ (`check_collision` is AABB overlap, a different question) |
| Centre of mass / support polygon / balance | ○ |
| Silhouette analysis | ○ |

**A verified inaccuracy in `validate.js`'s own documentation.** The comment above
`checkHingeAxisMisalignment` states that a joint's "C0/C1 rotation is identity on every built-in
rig, verified directly against `rigs/builtin.json`". That is **false for R6**: all six R6 joints
(`Right Shoulder`, `Left Shoulder`, `Right Hip`, `Left Hip`, `Neck`, `RootJoint`) carry real 90°
rotations in *both* C0 and C1. R15, Rthro and RthroSlender are identity, so the claim holds for
three rigs out of four. Read straight out of `rigs/builtin.json`.

What is *not* established is whether this weakens the check. The check reads the keyframe
transform's own `r00`, and that transform is expressed in the joint's pivot frame — which does not
obviously depend on C0/C1 being identity. So the comment's factual claim is wrong; whether the
heuristic it justifies is affected on R6 is an open question that this audit did not answer. The
Rig Graph now reports `local_axis_convention: 'rotated-bind'` per joint and raises
`RIG-ROTATED-BIND`, so a caller can at least see which rigs the assumption does not hold for.

### Observation (Part 43)

Only a beauty render exists. No silhouette, object-ID, depth, normal, motion-vector, alpha,
isolation, contact-sheet, crop, overlay, changed-region, trail, or flicker pass. Some are
straightforwardly buildable on the existing three.js scene (silhouette, object-ID, depth, normal,
isolation, wireframe, bounding boxes, contact sheets, crops, motion paths); some are not
(true motion vectors need a velocity pass the current material set does not produce).

### Safety (Parts 12, 54, 55)

| Requirement | State |
| --- | --- |
| Whole-project undo/redo | ● |
| Autosave with rotation + atomic write | ● |
| Transaction records | ○ |
| Dry run / preview before apply | ○ |
| Constraint compilation and enforcement | ○ |
| Scope analysis before a patch | ○ |
| Scoped rollback (one property, one time range) | ○ |
| Baselines | ○ |
| Approved-difference tracking | ○ |

### Knowledge, memory, benchmarks (Parts 25, 57, 59)

All ○. `docs/` holds design documents, not a machine-readable knowledge system.

---

## 5. Compatibility strategy (Part 7.7)

**The insertion point is a new pure module tree, `renderer/js/ai/`, that reads plain project data
and owns no editor state.**

Rules for the tree, chosen to make it safe to add to a stable app:

1. **Pure at load.** No `window`, no DOM, no three.js, no `state.js`. It may import `cf.js`,
   `easing.js`, and `propTracks.js` — all three were verified importable in bare Node at this
   commit. `state.js` is not (it touches `window`), which is exactly why the layer must not depend
   on it. This is the same purity discipline `pnx/` already follows and `test/coretest.mjs`
   already enforces for the effect core.

2. **Plain data in, plain data out.** Every entry point takes a `project` object (or an `item`),
   never a singleton. The same function therefore works on the live project, an undo snapshot, a
   baseline, or a fixture — which is what makes comparison and regression possible at all.

3. **Derived, not authoritative.** The semantic layer never becomes a second source of truth for
   scene data. It projects. The things it *does* own are additive and stored inside the project
   under one new key, `project.semantics` (role overrides, annotations, locks, constraints,
   provenance) — additive because `loadProject()` already tolerates missing keys, and JSON-safe so
   it survives a save/load round trip.

   Undo needed a change to match, and the split is deliberate (§2 fact 3, §7.2). `state.js`'s
   `undoableSemantics()` now clones the *state* half of `project.semantics` — roles, annotations,
   locks — into every undo snapshot, and `applySnapshot()` handles that key separately from the
   `Object.assign` so a snapshot taken before the first role pin can genuinely remove it.
   `semantics.provenance` is deliberately excluded and carried across live instead: provenance is
   append-only history (Part 56), and an undo that rewinds it would erase the record of the very
   change being undone. It is the same carry-by-reference pattern `HEAVY_FIELDS` already uses for
   immutable geometry, and for the same second reason — a growing graph deep-cloned on every
   `setKey` is exactly the cost that mechanism exists to avoid.

   The snapshot store and the diff engine draw the same line for the same reason: `withoutHistory()`
   in `ai/snapshot.js` strips provenance before hashing, so taking a snapshot cannot change what it
   is snapshotting, and a growing log is never reported as a change to the animation.

4. **Duplicated maths must be provably identical.** The layer reimplements track evaluation and
   the FK solve purely, because the originals live in impure modules. That is a drift risk, so it
   is closed by test rather than by hope: an in-app smoketest step compares the pure
   implementations against `state.js`'s `evalTrackCF` and `rigbuild.js`'s `solvePoseWorlds` across
   a sampled grid and fails on any disagreement.

5. **Names are display data; ids are addresses.** The layer mints a stable id for every entity it
   exposes. For joints — which have no native id — the id is derived deterministically from the
   rig topology (`part0→part1`), not from the name, so it survives a rename. A `roblox_mapping`
   field carries the name back for anything that has to talk to `state.js` or Studio.

### Known limitations recorded up front (Part 4.7)

- **Joint ids are derived, not native.** Renaming a joint in Cadence today also renames its track
  key, because the track table is name-keyed; the derived id survives, but the underlying data
  move is still `state.js`'s. A native joint id is a future migration with its own plan.
- **Keyframes have no native id.** The layer addresses keys as `(itemId, track, t)`, which is what
  every existing mutator already uses. Key-level annotations therefore live in a side table keyed
  the same way, and a key moved by `moveKeys` carries its annotation only if the mover is
  annotation-aware. Phase 2 makes the transaction layer annotation-aware; direct UI drags are not,
  and that is stated rather than hidden.
- **No render passes beyond beauty**, so anything in Parts 43–44 that needs depth, object-ID or
  motion vectors is not merely unimplemented — it is currently unmeasurable. Phase 4 adds passes;
  until then no tool may claim to have checked those things.

---

## 6. First vertical slice (Part 7.7, Part 10.5)

Phase 1 of the roadmap, built as one narrow but complete loop:

> **Cadence can be asked what exists in a shot — semantically, with stable ids and evidence — and
> can capture and restore an exact, content-identified state of it.**

Concretely: semantic roles + Rig Graph + Scene Graph + Timeline Graph + semantic selection +
content-addressed snapshots + a provenance graph, exposed as MCP tools, tested in plain Node, and
cross-checked in-app against the real evaluator and the real FK solver.

Deliberately *not* in this slice: motion measurement (Phase 5), render passes (Phase 4), CAL
(Phase 3), constraints and transactions (Phase 2). Their interfaces are anticipated but not
faked — `project.semantics` reserves the keys, and no tool reports a check it did not run.

Progress against every requirement is tracked in `requirements-matrix.md`, which is the living
document. This audit stays a point-in-time record of the starting state: it is not rewritten as the
programme advances, and where building the slice proved one of its claims wrong, the claim is
corrected in place and the correction is labelled rather than quietly swapped (§2 fact 3, §4's note
on `validate.js`, §5 rule 3, and §7 below).

---

## 7. Pre-existing defects this work uncovered

An audit that finds bugs should record them, whether or not it fixes them. Both were found by
building the semantic layer against real data rather than by looking for them.

### 7.1 `rigs/builtin.json`: rthro and rthroSlender carry inconsistent rest data — NOT fixed

The two Rthro rigs describe their own geometry twice and the two descriptions disagree. Their joint
`c0`/`c1` bind offsets are correctly Rthro-proportioned, but **7 of 16 part `cf` rest CFrames are
still verbatim R15 values**, and several of the remainder are partly stale.

Measured by solving the joint chain from the root with an identity pose and comparing each part
against its own declared rest CFrame:

| Rig | Parts off by >1e-3 | Worst deviation |
| --- | --- | --- |
| r6 | 0 of 7 | 0.0000 studs |
| r15 | 0 of 16 | 0.0000 studs |
| **rthro** | **15 of 16** | **0.9119 studs** (LeftFoot) |
| **rthroSlender** | **14 of 16** | **0.6224 studs** (LeftFoot) |

Rotation deviation is exactly zero everywhere; the error is purely positional and accumulates down
each limb chain, which is the signature of proportions updated in one place and not the other.

**Why this is not visible.** The viewport renders from the FK solve, so the joint offsets win and
the rig *looks* correct. `HumanoidRootPart` is the root (its world comes from the origin, not from
`part.cf`) and neither rig has static parts, so nothing on the display path reads the stale values.

**Where it bites.** `state.js addJoint` derives a new joint's C0 as `P0rest⁻¹ · P1rest` from
`part.cf` (state.js:1487, with the deliberate comment explaining why rest and not the live pose).
On these rigs those rest CFrames are wrong, so a joint created through Rigging Tools or
`create_joint` is placed up to 0.9 studs off from where the existing chain puts the part, and the
part visibly jumps the moment the new joint takes over. `weldAllParts` derives offsets the same way.

**Status: not fixed.** Rebuilding the rest CFrames is a separate change with its own risk surface
(export, IK, bounding boxes) and belongs in its own commit with its own verification. It is now
caught automatically rather than silently: `RIG-REST-INCONSISTENT` in `renderer/js/ai/riggraph.js`
raises it as a `certain` finding with the measurement and the `addJoint` consequence spelled out,
and `test/aitest.mjs` pins the deviation so it cannot regress — or vanish — unnoticed. If that test
starts failing because the deviation is gone, the rig data was fixed and the test should be folded
into the r6/r15 exact-match check above it.

### 7.2 `project.semantics` was invisible to undo — fixed

Described in §2 fact 3. `state.js`'s `snapshot()` clones a hard-coded field allowlist that did not
include `semantics`, and `applySnapshot()` merges with `Object.assign`, which never deletes. The
combination meant a pinned semantic role could be neither reverted nor removed by undo, even though
`set_semantic_role` called `pushUndo()` correctly and advertised itself as undoable.

Found by a smoketest assertion (`undo must remove the pinned role`) rather than by inspection —
the handler looked right, and only exercising the round trip exposed it.

Fixed in `state.js` via `undoableSemantics()`, with `provenance` deliberately held out of the undo
system for the reasons in §5 rule 3. This is a genuine pre-existing hazard beyond the semantic
layer: **any** future top-level project field is silently outside undo until it is added to that
allowlist, and nothing warns about it.
