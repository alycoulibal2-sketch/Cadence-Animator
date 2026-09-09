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
| `renderer/js/observationPasses.js` | Diagnostic render passes. Outside `ai/` because three.js. |
| `renderer/js/pnx/**`, `renderer-vfx/` | The procedural VFX engine and its own studio window. |
| `mcp-server/index.js` | `server.tool(...)` registrations. The other half of every MCP tool. |
| `docs/animation-intelligence/requirements-matrix.md` | Living requirement status. Every row kept forever. |

## Commands

`npm` is broken under Git Bash here. Use PowerShell, and invoke binaries directly.

```
node test/aitest.mjs     # semantic layer — 303 checks
node test/coretest.mjs   # core           —  41
node test/pnxtest.mjs    # PNX engine     — 298
```

```powershell
# Electron smoketest, ~4 min, 99 steps against the real app
Remove-Item test-output/userdata -Recurse -Force -ErrorAction SilentlyContinue
.\node_modules\.bin\electron.cmd . --disable-backgrounding-occluded-windows `
  --disable-renderer-backgrounding --disable-background-timer-throttling `
  --user-data-dir=test-output/userdata --screenshot=test-output/smoketest.png `
  --demo-js-file=test/smoketest.js
# results: test-output/smoketest-report.json
```

The smoketest is GPU-sensitive. Before concluding a failure is yours, `git stash` and re-run: a
4-minute comparison against unmodified HEAD beats an hour of guessing.

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
- **`report.allowed` is not "nothing is wrong".** A contact constraint compiles to `warn`, so a
  violation is reported while `allowed` stays true and the apply proceeds — correct there, because
  a human asked for that edit. Anything that treats `allowed` as a pass will let a violation
  through; count `violations` when the protection is meant to be a boundary (`ai/experiment.js`).
- **The transaction ledger and the snapshot/raster stores are in memory, session-scoped.** The
  durable record is the provenance graph inside the project. Anything that promises recovery across
  a restart is promising something it cannot do.

## Style

Comments explain **why**, especially why a limit exists or an alternative was rejected. Match the
surrounding density — this codebase comments heavily where a decision was non-obvious and not at
all where the code says it. Prose in results is for a reader; structured evidence sits beside it,
never instead of it.
