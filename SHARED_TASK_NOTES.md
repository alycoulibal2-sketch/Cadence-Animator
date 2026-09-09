# Shared task notes — Cadence Animation Intelligence

This file is the memory between iterations. Each `continuous-claude` run starts a **fresh Claude
session with no history**, reads this file, does one phase of work, and appends what the next
session needs to know. Keep it short enough to read in full and specific enough to act on.

Append to the log at the bottom. Do not rewrite the sections above it unless a fact in them has
become wrong.

---

## What this programme is

Building Cadence Animator into an animation-intelligence product, to
`C:\Users\alyco\Documents\Cadence_Animator_Ultimate_Master_Directive.md` (75 parts, 4151 lines).
The roadmap is the directive's **Part 62**, phases 0–9, each with a stated success condition.

**Read only the directive sections relevant to the phase you are on.** It is far too long to load
whole, and Part 7 explicitly says to load only what the work needs.

## The two documents that carry state

| File | What it is |
| --- | --- |
| `docs/animation-intelligence/00-foundation-audit.md` | the point-in-time starting state. **Never rewritten** — it is a record of what was true at the start, not a status page. |
| `docs/animation-intelligence/requirements-matrix.md` | **the living document.** Every requirement has a row and keeps it. This is where you find the next thing to do, and where you record what you did. |

## Where the programme is

- Branch: `animation-intelligence`, off `main` at `8343e2f` (v0.11.0).
- **Phases 0, 1, 2, 3 and 4 are done.** Phases 5–9 are not started.
- Commits: `54ea3f4` (Phase 1), `88265c9` (Phase 2), `0cadfd9` (Phase 3), Phase 4 is the tip.
- The semantic layer is `renderer/js/ai/**` — 23 modules, 31 MCP tools. Phase 4 also added one
  module OUTSIDE that tree, `renderer/js/observationPasses.js`, which is where three.js lives.

**Phase 5 is next: motion and contact analysis.** Part 62's success condition is *"Cadence can
identify a known contact error or motion-propagation problem with evidence."* Its rows are
`MOT-003`…`MOT-016` (Parts 22, 23, 27–30) plus `EXP-002` (Part 46). `MOT-008` (distance to contact
target / foot drift) is the keystone: four separate things across the matrix are waiting on it —
the `contact_drift` constraint check, the `contact_drift_within` acceptance check, the
`contact_firmness` dimension, and overshoot's blanket refusal to touch a contact-capable effector.
`ai/kinematics.js` already solves world-space FK at any frame purely, so the measurement has a
foundation; nothing samples it per frame yet.

## The rules this codebase holds itself to

These are not style preferences. Each one is load-bearing, and several were learned by getting them
wrong first. Breaking one silently is worse than not doing the work.

1. **Pure at load.** Nothing under `renderer/js/ai/` may touch `window`, the DOM, three.js or
   `state.js`. `test/aitest.mjs` imports every module in plain Node and a test enforces both the
   purity and the "every module on disk is imported here" completeness. Phase 4 kept this while
   adding pixels: a raster crosses the boundary as `{width, height, encoding, data}` and nothing
   else, and the GPU work lives in `renderer/js/observationPasses.js`, outside the tree.
2. **Plain data in, plain data out.** Every entry point takes a `project` OBJECT, never the
   singleton. That is the only reason the same code runs on a snapshot, a baseline, an undo state
   and a fixture.
3. **Unknown is `null`, never a default.** `joint_limits: null` means Cadence stores none, not
   "unlimited". A planner that conflates those generates knees that bend backwards.
4. **Nothing claims a check it did not run.** Every result carries `coverage.notRun` naming the
   checks that were skipped, and every assertion carries a certainty level from Part 13.
   `ai/certainty.js` throws on an unlabelled finding.
5. **An unimplemented check is never counted as satisfied.** It is compiled, reported, and named
   with what unblocks it. See `CHECKS` in `ai/constraints.js` and `ACCEPTANCE_CHECKS` in `ai/cal.js`
   for the pattern to copy.
6. **A capability that is missing is named, not hidden** (Part 4.7). Every module exports a
   `*Limitations()` function saying what it cannot do and why.
7. **Register both halves of an MCP tool.** A handler in `renderer/js/app.js` `MCP_HANDLERS` with no
   matching `server.tool(...)` in `mcp-server/index.js` is unreachable. This has happened more than
   once in this repo; two tests now guard it, and a third runs the handlers against the live app.
8. **Negative-test a regression test.** After fixing a bug, reintroduce it and confirm the test
   fails. A test that passes both ways is not a test. Two of Phase 3's were verified this way.

## How to verify

Run from the repo root. `npm` is broken under Git Bash here — use PowerShell, and invoke
`.\node_modules\.bin\electron.cmd` directly rather than `npm run`.

```
node test/aitest.mjs     # semantic layer   — currently 248/248, ~1s
node test/coretest.mjs   # core             — currently  41/41
node test/pnxtest.mjs    # PNX engine       — currently 293/293
```

```powershell
# the Electron smoketest: 96 steps against the real app, ~4 minutes
Remove-Item test-output/userdata -Recurse -Force -ErrorAction SilentlyContinue
.\node_modules\.bin\electron.cmd . --disable-backgrounding-occluded-windows `
  --disable-renderer-backgrounding --disable-background-timer-throttling `
  --user-data-dir=test-output/userdata --screenshot=test-output/smoketest.png `
  --demo-js-file=test/smoketest.js
# results land in test-output/smoketest-report.json
```

**Known flakes, and how to tell them from a real failure.** These steps time out or fail to draw
when the GPU is contended, and pass on a re-run: *Fire & smoke*, *Effect Look*, *classic clothing*,
*camera shake*, and several PNX render steps. A run where **many** of them fail at once with
"drew no sprites" / "lit 0 of N" / 30s timeouts is a starved GPU, not a regression. **Re-run before
concluding anything** — but never dismiss a failure in a step your change actually touches.

*Fire & smoke* and *Effect Look* now fail together on **every** run on this machine, not
intermittently: the volume step times out at 30 s and the Look step then fails on a studio sheet
the timeout left half-built (it is a cascade, not two faults). The Phase 4 session verified this by
`git stash`-ing the whole change and re-running: **identical two failures on unmodified HEAD**,
94/96. If you see exactly those two, they are not yours. If you see them plus anything else,
stash and re-run before believing it. Doing that comparison costs 4 minutes and is worth it.

## Working agreement for each iteration

1. Read `docs/animation-intelligence/requirements-matrix.md` and pick the next work: the current
   phase's rows, highest priority first (P0 before P1).
2. Read only the directive sections those rows cite.
3. Build the **smallest complete vertical slice** — Part 4.6: a narrow loop that can inspect,
   change, render, compare and safely undo, rather than a row of feature shells.
4. Test it, including a negative test of anything that pins a bug.
5. Run all four suites. Say what actually happened, including flakes.
6. **Update the matrix.** Move only the rows the work genuinely moved, and write an honest `Limits`
   cell for each. Recount the status totals in the header from the table itself.
7. Commit with a message that says what was built, what was decided, and what was deliberately not
   done.
8. Append a log entry below.

Say `CONTINUOUS_CLAUDE_PROJECT_COMPLETE` only when every phase 0–9 success condition in Part 62 is
met and the matrix has no `unplanned` P0 row left.

---

## Log

### Phase 3 — the formal animation language (commit `0cadfd9`)

Built `ai/vocabulary.js` (Part 21), `ai/cal.js` (Part 20), `ai/intent.js` (Part 20.1) and
`ai/plan.js` (Parts 20.2, 24); six MCP tools: `interpret_intent`, `plan_motion`,
`apply_motion_plan`, `evaluate_acceptance`, `animation_vocabulary`, `set_vocabulary_term`.

Part 62's success condition is met and proven end to end in both `aitest` and the smoketest:
"heavier without changing timing" is interpreted, planned, and the one strategy that moves keys is
refused by name with what the motion loses — while the rest still applies, and the acceptance check
measures that no key moved.

**Things a later phase will need to know:**

- `plan.js` composes patch operations and hands them to the Phase 2 machinery, so a motion plan is
  as transactional and reversible as a hand-written patch. Do not add a second mutation path.
- Strategies declare which edit **aspects** they touch (`timing` / `value` / `easing` / `space` /
  `existence`), and are blocked by the real `constraints.checkPatch` — not a copy of it. A new
  strategy must declare its aspects or the constraint system cannot refuse it.
- Phase names are evidence-bound: declared = `certain`, marker = `highly_likely`, rate template =
  `possible`, and only `attack` and `reaction` have a template. Everything else gets unnamed spans.
- 8 of 15 motion dimensions and all 5 VFX dimensions compile to nothing yet. They are carried,
  reported in `blocked`, and named with what unblocks each. Phase 4 unblocks none of them; Phase 5
  unblocks `contact_firmness` and `settle_duration`.
- `apply_animation_patch` returns `provenance_id` so a caller can attach a typed edge. Edge
  directions are defined in `EDGE_TYPES` in `ai/provenance.js` and mean what they say —
  `implements` runs patch → plan, not the reverse.

**Three defects found and fixed** (all three are now pinned by tests, two negative-tested):
spacing reshaped the span *after* the one it targeted (an epsilon cancelled itself); three
dimensions sharing one strategy overwrote each other so the largest pull was discarded; and
`motionPlan` re-ran already-built phase specs through the constructor, nulling every field.

**Not done, on purpose:** the planner edits existing keys and may not add or remove one, because
inserting a key safely needs the contact model (Phase 5). Nothing renders. No camera, prop or
effect item can be planned for.

### Phase 4 — observation and baseline

Built `ai/raster.js` (Part 44's comparison methods), `ai/observe.js` (Part 43's pass catalogue and
hierarchical policy), `ai/baseline.js` (Part 44 baselines), `ai/explain.js` (Parts 44–45), and
`renderer/js/observationPasses.js` — the only new file that imports three.js. Five MCP tools:
`plan_observation`, `create_baseline`, `list_baselines`, `explain_change`, `approve_difference`.

Part 62's success condition is met and proven end to end in both suites. The smoketest takes a
baseline of a real R15 rig at frame 16 (silhouette + object-ID, 16 part meshes), applies a scoped
shoulder patch, and `explain_change` reports: the outline displaced 9px inside a 22×30 region, the
right arm's three parts moved and the left leg did not, the curve difference names the transaction
that caused it, and a rollback brings every pass back **byte-identical**.

**Things a later phase needs to know:**

- **The purity rule survived, and here is how.** A raster crosses into `ai/` as
  `{width, height, encoding, data}` and nothing else. Keep it that way — the moment `ai/` needs a
  renderer handle, the whole "same code runs on a snapshot, a baseline and a fixture" property is
  gone. `test/aitest.mjs` feeds the comparisons hand-drawn byte buffers; the smoketest is the only
  place a real GPU is involved, and it is the only thing that can catch a readback bug.
- **Every raster carries a camera fingerprint, and a mismatch REFUSES.** This is not defensive
  padding: the user nudges the orbit camera and every silhouette moves. `explain_change`
  temporarily restores the baseline's exact viewpoint (`withCamera`) and puts it back.
- **Passes are square, antialiasing off, rig parts only.** Off-AA is what makes exact comparison
  exact and object-ID indices survive readback. The subject set is built POSITIVELY
  (`withSubjectsOnly`): everything renderable is hidden, then only part meshes that were already
  visible are re-shown. The per-part selection boxes are `visible: true` at opacity 0 so they stay
  raycast targets — under a flat override material they render as solid boxes, and the smoketest
  asserts the silhouette covers 19 of 256 blocks specifically to catch that.
- **An object-ID pass measures VISIBLE pixels.** An R15 arm sweeping a radian crosses the torso, so
  Head and UpperTorso report a change every single run without having moved. That is classified
  `uncertain` with the occlusion explanation and the checks that would settle it (a depth pass —
  OBS-004 — is the cheapest, and the machinery for it now exists). Do NOT "fix" this by tightening
  a threshold; the pass genuinely cannot tell the two apart.
- **`project.semantics.baselines` is NOT state.** It is in `snapshot.js NOT_STATE` alongside
  `provenance`, held out of snapshots, out of undo (`state.js undoableSemantics`) and carried
  across a restore. Any future `semantics.*` key that records something ABOUT states rather than
  being state belongs there too, and a test reads `state.js` to prove the two lists agree.
- **`scope.propagateTracks`** is the bridge that makes a visual difference explainable: it answers
  "which parts SHOULD have moved" from the same walk `analyseScope` uses. `expectedMovers: null`
  and `expectedMovers: []` mean different things to `explainChange` — not-asked versus asked-and-
  none — and collapsing them turns every unasked question into a clean bill.
- **`transaction.recordBaselineComparison`** fills Part 55's `baseline_comparison`, which was a
  "blocked on Phase 4" placeholder. It records that a comparison RAN and what it attributed; it is
  explicitly not an approval (`approval_status` stays separate).

**One defect found and fixed, negative-tested:** creating a baseline wrote into
`project.semantics`, so `diffProjects` reported `project field "semantics" changed` — every
comparison opened by announcing that a baseline had been taken, and `explain_change` classified it
as an unexplained difference. Fixed by generalising `withoutHistory` into `NOT_STATE`. Reintroduced
(`NOT_STATE = ['provenance']`) and confirmed **six** checks fail, including the success-condition
test; restored and all 248 pass.

**One design decision worth not re-litigating:** a `render_diagnostic_passes` tool (Part 50 names
it) was deliberately NOT added. A tool that renders passes nothing stores or compares returns
numbers no caller can act on — exactly the feature shell directive 4.6 forbids. `create_baseline`
is how you render a pass in this build. MCP-006's Limits cell records this.

**Not done, on purpose:** no depth, normal, motion-vector, alpha, shadow, material-ID, crop,
contact-sheet or overlay pass (19 of Part 43's 24, each named in `observe.PASSES` with what blocks
it). No perceptual comparison. No temporal comparison, so flicker and one-frame pops between
sampled frames are not looked for. Part 43 tier 4 (crops/isolation) can never be chosen and the
plan says so. The two visual acceptance checks in `ai/cal.js` are still NOT RUN — the capability
now exists, but `evaluateAcceptance` takes two projects and a visual check needs two renders, so it
needs a baseline id threaded through. That is a small, well-defined piece of wiring and a good
warm-up for whoever picks up Phase 5.

### Phase 4 review pass — the stale-blocker class

The verification pass on Phase 4 found no functional defect: all three node suites pass
(248/41/293) and the smoketest is 94/96 with only *Fire & smoke* and *Effect Look* failing, which
reproduce identically on unmodified HEAD and are the two documented above.

What it did find is a whole class of honesty bug that arrives **the moment a phase lands**, and it
is worth naming because Phase 5 will create it again:

**When a capability ships, every string that said "blocked on it" becomes a lie.** Phase 4 built
silhouette, object-ID, baselines and rendered comparison — and eight `blocked_by` / `blocked_on` /
`notRun` strings elsewhere in `ai/` still told a caller those things did not exist:
`cal.js` (`no_visual_regression`, `silhouette_readable`), `constraints.js`
(`silhouette_unchanged`, `no_visual_change`, and the `checkConstraints` coverage note),
`plan.js` (the plan coverage note and `baselinePolicy`), `scenegraph.js` (`render_impact`), and
`transaction.js` (`compareStates.methods_unavailable` plus the `inspect_transaction` coverage note).
The Phase 4 author correctly rewrote the ones in the files they were already editing and missed the
files they were not. All are fixed: each now distinguishes **"does not exist"** from **"exists, but
is not reachable from here"**, and names the tool that does run it.

Two counting errors came from the same seam:

- `create_baseline`'s tool description said **six** of Part 44's seventeen fields are null while
  listing four, and `baseline.js`'s header said six; the code, its limitations string and the test
  all say four. Now four everywhere.
- `observeLimitations()` said "4 of Part 43's 24 … the other 20" while `PASSES` holds **5**
  implemented and **19** not — the pre-existing beauty render was counted in the registry and
  omitted from the prose. Now 5/19 in the module, the matrix and the notes above.

**A test that asserts a phase number will hide exactly this.** Two did:
`transaction: compareStates names the comparison methods it did NOT use` asserted
`methods_unavailable.every(/Phase 4/)`, and the `cal` acceptance test asserted `/Phase 4/` in
`notRun`. Both passed *because* the strings were stale, so the drift was invisible. Both now assert
that a reason names its own real obstacle and that it does **not** defer to a shipped phase. Each
fix was negative-tested by reintroducing the stale string.

`observe.PASSES` and `observeLimitations()` are now tied together by a test, so the next pass to
land cannot leave that sentence stale.

**One matrix cell claimed more than the test proved.** OBS-002's Tests cell said the smoketest
"asserts a real R15 silhouette covers 19 of 256 blocks"; the step only asserted `lit > 0` and
`lit < 256`, and recorded 19 as a diagnostic. `lit < 256` catches only a leak that fills the entire
frame — the ground plane covers about half, so it would have passed. The step now asserts the band
`8..64` (19 in practice, stable across three runs) and the cell describes what is actually checked.

## Health pause - 2026-09-08 19:19:36 AST

- Iteration: (2/7)
- Consecutive failures: 2
- Reason: exit_code

Recent diagnostics:
    You've hit your session limit · resets 11:10pm (Asia/Dubai)

Next step: Inspect the failure, fix the project or adjust the prompt, then rerun Continuous Claude.
