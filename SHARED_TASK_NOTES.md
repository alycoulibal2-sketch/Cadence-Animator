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
- **Phases 0, 1, 2, 3, 4 and 5 are done.** Phases 6–9 are not started.
- Commits: `54ea3f4` (Phase 1), `88265c9` (Phase 2), `0cadfd9` (Phase 3), `d36e10c` (Phase 4),
  Phase 5 is the tip.
- The semantic layer is `renderer/js/ai/**` — 25 modules, 34 MCP tools (174 in the app overall).
  Phase 4 also added one module OUTSIDE that tree, `renderer/js/observationPasses.js`, which is
  where three.js lives.

**Phase 6 is next: VFX compiler and shot events.** Part 62's success condition is *"Cadence can
generate a parameterized impact effect that remains attached, timed, and reversible."* Its parts
are VFXSpec, a small set of effect primitives, an event timeline, animation/VFX timing validation,
and effect isolation and diagnostics (directive Part 37 and around it; `VFX-*` and `SHOT-*` rows in
the matrix).

The situation Phase 6 walks into is different from every phase before it, and worth understanding
before picking rows. **Cadence already HAS a large procedural VFX engine** — `renderer/js/pnx/**`,
390+ node types, its own studio window, its own Luau exporter, its own 298-check suite. Phase 6 is
therefore **not** "build VFX"; it is building the semantic/spec layer that can *drive and reason
about* what already exists, the way Phase 3's CAL drives the keyframe machinery rather than
reimplementing it. Two consequences:

- The `ai/` purity rule and `pnx/` are in tension: `pnx/` is not pure and not importable from
  `ai/`. Expect to need the same boundary trick Phase 4 used for pixels — a plain-data spec crosses,
  the impure engine work stays outside the tree. Decide that boundary FIRST, before writing a
  VFXSpec, or the whole phase ends up unimportable in `aitest`.
- 5 of Part 20's VFX motion dimensions currently compile to nothing (see `ai/cal.js`). They are the
  natural first customers for a VFXSpec, and are the honest way to check the layer is real rather
  than a row of shells (rule 9 / directive 4.6).

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
node test/aitest.mjs     # semantic layer   — currently 272/272, ~1s
node test/coretest.mjs   # core             — currently  41/41
node test/pnxtest.mjs    # PNX engine       — currently 298/298
```

```powershell
# the Electron smoketest: 97 steps against the real app, ~4 minutes
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
94/96. Phase 5 saw the same two, and is **95/97**. If you see exactly those two, they are not
yours. If you see them plus anything else, stash and re-run before believing it. Doing that
comparison costs 4 minutes and is worth it.

**The cascade changes SHAPE between runs, and that does not mean it is something new.** The Look
step failed with a 30 s timeout on one Phase 5 run and with `assertion failed: the look is a drawn
thing with an approximated badge: undefined` on the next — because what it trips over is a
half-built sheet, and how far the sheet got depends on where the volume step died. A Phase 5
session burned two wrong conclusions on this (ordinary contention, then a regression in the VFX
Studio commits below) before re-reading this section. **Read this section first.**

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

### Phase 5 — motion and contact analysis

Two new modules, both pure at load, and the first in `ai/` that reason about the MOTION rather than
about the project as data:

- **`ai/motion.js`** (Part 23, plus what Parts 22 and 30 need from it). Samples the FK solve on a
  frame grid and differentiates it: world position and rotation, linear and angular velocity,
  acceleration, jerk, path curvature, key density and interpolation types. Also contact drift and
  chain lead/lag.
- **`ai/diagnose.js`** (Part 46). The judging layer. It consumes `motion.js` and **never
  re-measures**.

Three MCP tools, both halves registered: `analyze_motion`, `analyze_contacts`,
`explain_motion_problem`. 174 tools in the app. `SEMANTIC_LAYER_VERSION` → `1.5.0`.

**The keystone landed.** `MOT-008` (contact drift) was what four other things were waiting on, and
two checks that previously reported themselves as NOT-RUN now actually run: the `contact_drift`
constraint check and the `contact_drift_within` acceptance check. The same measurement therefore
refuses a patch *before* it applies and evaluates it *after* — one code path, not two
approximations. Matrix: 3 rows to `implemented` (MOT-003, MOT-004, MOT-008), 5 to `partial`
(MOT-005, MOT-007, MOT-009, MOT-010, EXP-002); 165 rows now
*implemented 75 · partial 22 · designed 8 · deferred 2 · blocked 1 · unplanned 57.*

Part 62's success condition is proven at the handler boundary by a new smoketest step: *"a planted
foot is broken, measured, attributed to the joint that did it, and undone."*

**The decisions worth not relitigating:**

- **Measurement is separated from judgement** (Part 4.5). Nothing in `motion.js` decides a motion
  is bad. An unexplained jerk spike is `unclassified`, never `defect`. `driftExceedsTolerance`
  compares against a number the *user* declared. All the judging is in `diagnose.js`, where a
  reader can see what it rests on.
- **A cause is proved by a counterfactual, not by proximity.** "The knee rotated during the
  contact" is a coincidence. `attributeDrift` re-solves the rig with each ancestor frozen at the
  contact's first frame in turn and ranks by how much drift each one owns — root motion included.
  That is the only evidence in the phase strong enough to carry a `certain` label, and it is cheap
  only because the FK solve is pure and takes a project object.
- **The sample grid is uniform, finite and declared.** Derivatives are finite differences, and a
  non-uniform grid makes the 2nd and 3rd ones quietly wrong. The cap is REPORTED — an analysis that
  silently looked at a third of the range is worse than one that refuses.
- **Contact drift is measured against the effector's own world position on the contact's first
  frame**, because Cadence has no ground plane, no collision surface and no world target. Stated in
  every result rather than hidden behind a plausible number. **A contact that was already sliding
  when it was declared measures clean** — know this before trusting a clean drift result.
- **Nothing infers a contact.** No ContactSpec, no measurement, and the tool says so instead of
  guessing which foot was meant to be planted.
- **Authored discontinuities are not defects.** A stepped key, a held pose and a marked impact are
  run through Part 23's noise-and-signal policy *before* anything is called wrong.
- **Angular speed is unsigned** (it is the magnitude of a relative rotation). Enough to find an
  onset and a peak; it cannot tell a reversal from a continuation, and `MEASUREMENTS` says so.
- **A chain inversion is reported, never called wrong** — Part 22 lists whip cracks and isolated
  gestures as legitimate exceptions.

**Deliberately not done, and named rather than hidden:** screen-space velocity (no active-camera
model), balance and centre of mass (part mass is unknown), distance from an EXPECTED arc (no arc
model); 6 of Part 23's 9 variation kinds have no mark in Cadence project data, so accidental jitter
and deliberate texture cannot be told apart; 3 of Part 46's 7 "why?" workflows are blocked on
models that do not exist (weight, effect change, camera framing) and 2 are routed to
`explain_change`. All seven are listed in `diagnose.DIAGNOSTICS` with the reason.

**How this iteration actually ended, because it matters for the next one.** A Windows update
restarted the machine mid-iteration (1/6) — the work was finished and green but **never committed,
and no PR was opened**. A later session recovered it. Two things that recovery turned up:

1. **A killed iteration can leave a deliberately poisoned source file.** The negative-test cycle is
   `cp <file> /tmp/x.bak && python -c "<reintroduce the bug>"` … then restore. The run died inside
   that cycle on `plan.js` and the log shows no restore line for it. The backups survive a reboot
   in Git Bash's `/tmp`, and here `plan.js` and `constraints.js` both diffed byte-identical to
   `/tmp/plan.bak` / `/tmp/con.bak`, so the tree was clean. **After any interrupted run, diff
   against those backups before trusting the working tree.**
2. The recovering session burned two wrong conclusions on the known *Fire & smoke* / *Effect Look*
   cascade before re-reading the "Known flakes" section above. That section is now explicit that
   the cascade changes shape between runs.

## Health pause - 2026-09-08 19:19:36 AST

- Iteration: (2/7)
- Consecutive failures: 2
- Reason: exit_code

Recent diagnostics:
    You've hit your session limit · resets 11:10pm (Asia/Dubai)

Next step: Inspect the failure, fix the project or adjust the prompt, then rerun Continuous Claude.
