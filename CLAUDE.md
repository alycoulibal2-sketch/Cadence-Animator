# CLAUDE.md — durable knowledge for Cadence Animator

Long-lived project memory. Conventions, commands and pitfalls that are expensive to rediscover.
Status and "what to do next" live in `SHARED_TASK_NOTES.md`, not here.

## Layout

| Path | What it is |
| --- | --- |
| `src/main.js` | Electron main. Owns the MCP control socket, window capture, the VFX studio window. |
| `renderer/js/state.js` | The project model, undo/redo, track evaluation. The singleton. |
| `renderer/js/app.js` | UI wiring **and** `MCP_HANDLERS` — every MCP tool's renderer-side body. |
| `renderer/js/viewport.js` | three.js scene, orbit/transform controls, picking. |
| `renderer/js/rigbuild.js` | `RigInstance` and friends: meshes, joints, FK solve. |
| `renderer/js/ai/**` | The animation-intelligence semantic layer. **Pure** — see below. |
| `renderer/js/ai/motion.js` | Part 23's measurements: velocity, acceleration, jerk, curvature, contact drift, chain lead/lag. Measurement only. |
| `renderer/js/ai/diagnose.js` | Part 46's "why?" workflows. The judging layer; it consumes `motion.js` and never re-measures. |
| `renderer/js/ai/events.js` | Part 41's shared shot-event timeline, **derived** from the per-item `project.markers` tables, never migrated. |
| `renderer/js/ai/vfxspec.js` | Parts 37-39. A declarative effect compiled into reversible ops. Targets the `kind:'vfx'` emitter item, **never** `pnx/**` — the reasoning is at the top of the file. |
| `renderer/js/ai/modes.js` | Part 11's operating modes. Policy, not police: it decides only "may this mutate", enforced in `apply_animation_patch`. |
| `renderer/js/ai/experiment.js` | Part 48. Bounded named alternatives, compared on clones, with a recommendation that names its measurements — or withholds one. |
| `renderer/js/ai/review.js` | Parts 49 + 14. The shot review, and the quality hierarchy that orders it. Defects and artistic suggestions never merge. |
| `renderer/js/ai/simulate.js` | Part 47. The pre-commit report: the review run on a planned result, diffed per quality layer. No overall score, deliberately. |
| `renderer/js/ai/workflows.js` | Part 52. Exactly the directive's 16 workflows as declared tool chains; `run_workflow` enforces their approval points. |
| `renderer/js/ai/style.js` | Part 35. Per-style multipliers on vocabulary dimensions — makes a declared style change a numeric pull, not just a label. No default; `project.semantics.style` is undoable state. |
| `renderer/js/ai/knowledge.js` | Parts 25, 26, 71, 73. The twelve classical principles (full 20-field structure), the relevance gate, the premium-animation standard. Compiled reference data, like `vocabulary.js TERMS` — not project state. |
| `renderer/js/ai/memory.js` | Parts 57, 58. Scoped project/preference memory in `project.semantics.memory`, undoable. A correction is only surfaced as a candidate once observed enough times; accepting one changes only its own status field. |
| `renderer/js/ai/reference.js` | Part 36. A motion profile built from an in-project item via `ai/motion.js`, stored in `project.semantics.references` (NOT_STATE, like baselines). `emulate`/`not_copied` are the caller's own declaration. |
| `renderer/js/ai/benchmark.js` | Part 59. The benchmark library: 25 categories (16 defined), 16 fixtures through the REAL pipeline, 21 dimensions (11 measured), `runSuite`, `compareRuns` (per cell, no score), human evaluation as a separate block. The implementation under test is injected (`makeImplementation`). |
| `renderer/js/ai/benchmarkBaseline.js` | **GENERATED** by `node tools/benchmark.mjs --write-baseline`. The committed production run every fresh run is compared against. Never hand-edit; re-generate and commit the diff with the change that moved a number. |
| `renderer/js/ai/improve.js` | Part 60. Detect recurring problems from durable evidence, record a proposal (category REQUIRED), evaluate its adoption rule against two runs, record a human decision with a version and a rollback path. Applies nothing (Part 4.8). |
| `tools/benchmark.mjs` | The suite from the command line: run, `--compare` (exit 1 on any deterministic difference), `--write-baseline`, `--options '{…}'` / `--prototype file.mjs` for prototypes, `--json` to hand a run to `review_architecture_experiment`. |
| `renderer/js/observationPasses.js` | Diagnostic render passes. Outside `ai/` because three.js. |
| `renderer/js/pnx/**`, `renderer-vfx/` | The procedural VFX engine and its own studio window. |
| `mcp-server/index.js` | `server.tool(...)` registrations. The other half of every MCP tool. |
| `docs/animation-intelligence/requirements-matrix.md` | Living requirement status. Every row kept forever. |

## Commands

`npm` is broken under Git Bash here. Use PowerShell, and invoke binaries directly.

```
node test/aitest.mjs                # semantic layer — 359 checks
node test/coretest.mjs              # core           —  41
node test/pnxtest.mjs               # PNX engine     — 298
node tools/benchmark.mjs --compare  # Part 59 suite vs the committed baseline (deterministic only)
```

`--compare` exits 1 on a difference in EITHER direction. Intended: `node tools/benchmark.mjs
--write-baseline` and commit the new baseline with the change. Not intended: a regression.

```powershell
# Electron smoketest, ~4 min, 100 steps against the real app
Remove-Item test-output/userdata -Recurse -Force -ErrorAction SilentlyContinue
.\node_modules\.bin\electron.cmd . --disable-backgrounding-occluded-windows `
  --disable-renderer-backgrounding --disable-background-timer-throttling `
  --user-data-dir=test-output/userdata --screenshot=test-output/smoketest.png `
  --demo-js-file=test/smoketest.js
# results: test-output/smoketest-report.json
```

The smoketest is GPU- AND network-sensitive. Before concluding a failure is yours, `git stash` and
re-run: a 4-minute comparison against unmodified HEAD beats an hour of guessing. Two steps flake
intermittently on this machine — *classic clothing* (it fetches textures from `fts.rbxcdn.com`, so
grep the log for `ENOTFOUND` before blaming your change) and *observation: baseline → scoped edit*
(a pixel comparison that occasionally finds differences between a baseline and its own state).
Neither pair is a fingerprint: across five runs in one session they appeared in two.

## Rules that are load-bearing

Each of these was learned by getting it wrong. Breaking one silently is worse than not doing the
work.

1. **`renderer/js/ai/**` is pure at load.** No `window`, no DOM, no three.js, no `state.js`. A test
   in `aitest.mjs` imports every module in plain Node and greps the sources, and a second test
   fails if a module on disk is not imported there. This is what lets the same code run on the live
   project, a snapshot, an undo state, a baseline and a fixture.
2. **Plain data in, plain data out.** Every entry point takes a `project` OBJECT, never the
   singleton. Pixels cross the boundary as `{width, height, encoding, data}` and nothing more.
3. **Unknown is `null`, never a default.** `joint_limits: null` means Cadence stores none, not
   "unlimited". Conflating those generates knees that bend backwards.
4. **Nothing claims a check it did not run.** Every result carries `coverage.notRun` naming what
   was skipped; every assertion carries a Part 13 certainty level. `ai/certainty.js` throws on an
   unlabelled finding or an unknown evidence kind.
5. **An unimplemented check is reported, never counted as satisfied.** Copy the pattern in
   `CHECKS` (`ai/constraints.js`), `ACCEPTANCE_CHECKS` (`ai/cal.js`) or `PASSES` (`ai/observe.js`):
   the entry exists, `implemented: false`, and `unblocked_by` says what would change that.
6. **A missing capability is named, not hidden.** Every `ai/` module exports `*Limitations()`.
7. **Register BOTH halves of an MCP tool.** A `MCP_HANDLERS` entry in `app.js` with no matching
   `server.tool(...)` in `mcp-server/index.js` is unreachable. This has shipped more than once;
   three tests now guard it. Tool descriptions must open with `READ-ONLY.` / `MUTATING …` /
   `DESTRUCTIVE …` — `aitest mcp` parses for it.
8. **Negative-test a regression test.** After fixing a bug, reintroduce it and confirm the test
   fails. A test that passes both ways is not a test.
9. **Don't build feature shells.** Directive 4.6: one narrow loop that can inspect, change, observe
   and undo beats a row of stubs. A tool whose output nothing consumes is worse than its absence.

## Pitfalls with teeth

- **`state.js snapshot()` clones a hard-coded field list.** Any new top-level project field is
  silently outside undo until you add it there.
- **`semantics.provenance` and `semantics.baselines` are NOT state** (`ai/snapshot.js NOT_STATE`).
  They are held out of snapshots and undo and carried across a restore, because they are records
  *about* states. Forgetting this makes taking a baseline look like an edit. Kept in sync with
  `state.js undoableSemantics` by a test.
- **`{}` and an absent key hash differently.** Deleting the last entry from a `semantics.*`
  container must delete the container, or an empty one reads as a change forever.
- **Reading pixels races the paint.** Scrub, then wait a double-`requestAnimationFrame` before
  `capturePage` or `readRenderTargetPixels`. A pass read one frame early baselines the wrong pose,
  which looks like a result rather than a crash.
- **Per-part selection boxes are `visible: true` at opacity 0** so they stay raycast targets. Under
  a flat override material they render as solid boxes and fill the frame. Any new pass must build
  its subject set positively (hide everything, re-show what you want) — see `withSubjectsOnly`.
- **`readRenderTargetPixels` returns rows bottom-up.** Flip on the way in, so every raster in the
  system shares one origin.
- **An object-ID pass measures visible pixels, not motion.** An object occluded by one that moved
  reports a change it did not make. That is `uncertain`, not a regression.
- **Entity ids come from `ai/ids.js`, separator `/`, segments percent-encoded.** Mint them with
  `ids.partId()` etc., never by string concatenation, or nothing joins to anything.
- **`validate.js` imports `state.js`**, so it cannot be used from `ai/`. That is why the export
  acceptance check is blocked.
- **A patch may now CREATE an item (`add_item`), and anything that pre-validates op ids must
  account for it.** `buildPatch` in `app.js` checks every `op.itemId` against the live project;
  ids added earlier in the same patch have to count as present, or compiling an effect is rejected
  for addressing the emitter it is in the middle of creating. `add_item` keeps its id in
  `op.item.id`, not `op.itemId`, so any code that filters or groups ops by item needs the same
  care (see `opItemId` in `ai/patch.js`).
- **A patch op's value field is `value`; a stored keyframe's is `v`.** Reading `k.value` off a
  track silently measures `undefined`, and a comparison against it is quietly always false.
- **An item id in a patch must be DERIVED, never minted.** `commitPatch` verifies the applied
  result against the hash the plan predicted, so `crypto.randomUUID()` inside an op handler makes
  every commit fail its own post-condition. Hash the request instead — which also makes the
  operation idempotent.
- **A mutating semantic tool must go through `apply_animation_patch`.** That is the single place
  Part 11's operating mode is enforced (`analyze`/`compare`/`review` refuse to mutate, and the
  refusal is deliberately not forceable). A new mutating tool that writes to `state.js` directly
  bypasses the mode gate, the constraint check, the transaction and the snapshot at once.
- **A compiled `ConstraintSpec` keeps its range in `time_range`, not on `condition`, and its
  `target` is an ARRAY of selectors.** Reading `condition.from` or `target.itemId` silently yields
  `undefined`, and a review built on that reported no contact problem at all — a false clean bill of
  health. Print a real compiled spec with `node -e` before consuming a shape.
- **`motion.classifyVariation` refuses to call an unexplained discontinuity a defect** and returns
  `unclassified` instead (Part 4.5: jitter, procedural detail and an interpolation artefact are
  indistinguishable in project data). A judging layer must not overrule that — report it as a
  suggestion and point at `explain_motion_problem`.
- **`report.allowed` is not "nothing is wrong".** A contact constraint compiles to `warn`, so a
  violation is reported while `allowed` stays true and the apply proceeds — correct there, because
  a human asked for that edit. Anything that treats `allowed` as a pass will let a violation
  through; count `violations` when the protection is meant to be a boundary (`ai/experiment.js`).
- **The transaction ledger and the snapshot/raster stores are in memory, session-scoped.** The
  durable record is the provenance graph inside the project. Anything that promises recovery across
  a restart is promising something it cannot do.
- **`NOT_STATE` is now three fields, not two: `provenance`, `baselines`, `references`.** All three
  are records ABOUT a state, never state itself — held out of `ai/snapshot.js` snapshots and out of
  `state.js undoableSemantics`, kept in sync by the same test. `ai/style.js` and `ai/memory.js`
  deliberately do NOT join that list: a declared style or a captured correction is an edit a project
  can make and undo, the same as a vocabulary override.
- **`ai/vocabulary.js interpret()` resolves an unstated `style` from `project.semantics.style`
  automatically.** A caller wanting a one-off "what if this were anime" query must pass `style`
  explicitly — that argument always wins over the declared project style. Do not add a second,
  competing way to override this; `activeStyle = style ?? resolveStyle(project)` is the one seam.
- **A contact effector must be a ROLE PHRASE (`'left foot'`), not the part name (`'LeftFoot'`).**
  `measureContactDrift` resolves either; the constraint target goes through `ai/select.js`, where a
  part name is "no known role" → the constraint is UNRESOLVED and never enforced, and a violation
  rate of 0 is a lie. Read `report.unresolved_targets` before trusting a zero. The benchmarks carry
  a check for exactly this.
- **A benchmark check's `ok` is three-valued.** `null` means not applicable (a plan that never
  applied has nothing to roll back); only `ok === false` is a failure. Code that tests `!c.ok`
  double-reports.
- **`compareRuns` is symmetric and directionless until a dimension's declared `direction` is
  applied — and that direction is a convention.** Never add an overall score, a weight, or a
  human rating into it; `curve_continuity` counts INTRODUCED spikes precisely because "smoother"
  is not "better" for a heavier edit.
- **The benchmark suite runs on its own fixtures, never on the open project**, and
  `run_benchmark_suite` proves it by hashing the project before and after. Do not "optimise" that
  away; it is the evidence for the tool being READ-ONLY.
- **A proposal is a record and a verdict is not a decision.** `evaluateAdoption` never advances a
  proposal past `evaluated`; `decideProposal` records what a PERSON chose and refuses an approval
  with no evaluation behind it. Nothing under `ai/` may adopt a change, flip an option default, or
  edit a threshold on its own — the adopting change is a commit, and git is the rollback path.
- **Accepting a memory candidate (`review_preference_candidate`, decision `accept`) changes only
  that entry's own `status` field.** It never writes `ai/vocabulary.js` or a track by itself — that
  silent step is exactly the "unapproved global assumption" Part 62 forbids. A caller that wants an
  accepted preference to take effect must separately call `set_vocabulary_term`, citing the
  candidate as evidence.

## Style

Comments explain **why**, especially why a limit exists or an alternative was rejected. Match the
surrounding density — this codebase comments heavily where a decision was non-obvious and not at
all where the code says it. Prose in results is for a reader; structured evidence sits beside it,
never instead of it.
