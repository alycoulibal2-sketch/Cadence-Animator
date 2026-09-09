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
- **Phases 0–7 are done.** Phases 8–9 are not started.
- Commits: `54ea3f4` (Phase 1), `88265c9` (Phase 2), `0cadfd9` (Phase 3), `d36e10c` (Phase 4),
  `c9973b8` (Phase 5), `a5da0ec` (Phase 6), `a10d297` (Phase 7 first half), Phase 7's second half
  is the tip.
- The semantic layer is `renderer/js/ai/**` — 32 modules, 44 MCP tools (184 in the app overall).
  Phase 4 also added one module OUTSIDE that tree, `renderer/js/observationPasses.js`, which is
  where three.js lives.

**Phase 8 is next: reference, style memory, and the knowledge suite.** Part 62's success condition
is *"Cadence can adapt a new animation using approved project style without making unapproved
global assumptions."* Its deliverables are reference profiles, project conventions, preference
candidates, accepted/failed lesson capture, and knowledge-suite routing — the `KNW-*`, `MEM-*` and
`REF-*` rows. (Benchmarks, `BCH-*`, are Phase 9.)

**Read the directive parts directly. They are at
`C:\Users\alyco\Documents\Cadence_Animator_Ultimate_Master_Directive.md`, and Phase 7 proved this
matters:** Part 62's success condition for Phase 7 turned out to be *"compare bounded alternatives
and justify a recommendation"*, which made Part 48 the keystone rather than the simulation report
the phase title implied. Extract one part with
`python -c "import re,io; s=io.open(PATH,encoding='utf-8').read(); print(re.search(r'^## 25\..*?(?=^## \d+\.)', s, re.M|re.S).group(0))"`.
For Phase 8 that means Parts 25, 26, 57, 58 and 71–73.

Four things about the ground Phase 8 lands on:

- **The success condition's second half is the hard half.** "Without making unapproved global
  assumptions" is the whole risk. `MEM-002` is already `partial` and is the pattern to copy:
  `ai/vocabulary.js` stores a preference as a **scoped delta with required evidence and an
  observations count**, never as a global rule, and the shared definition is frozen. Phase 8 should
  generalise that shape, not invent a new one.
- **There is no cross-project store, and choosing one is a real decision.** Nothing in Cadence holds
  data outside a single `.cadence` file. "Approved project style" can live in
  `project.semantics` (durable, travels with the file, already inside the undo allowlist —
  see `state.js undoableSemantics`); knowledge that spans projects cannot, and needs either a new
  user-data store in `src/main.js` (outside the pure layer, so it needs the plain-data boundary
  Phase 4 used for pixels) or an explicit import step. **Settle this before writing a `KNW` row**,
  the way Phase 6 had to settle the pnx/vfx boundary and Phase 7 the modes/enforcement point.
- **`ai/baseline.js` is the closest existing thing to remembered work**, and it is already project
  data rather than disposable screenshots. Read it before designing a store; what Phase 8 wants may
  be a generalisation of it.
- **`KNW-003` (the 12 classical principles) has a trap recorded in its own matrix cell.** Four
  principles are already *implicitly* operationalised by the planner with no knowledge entry behind
  them. A knowledge entry has to say when a technique is HARMFUL, and none of them does — so
  "we already do anticipation" is not that row.

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
node test/aitest.mjs     # semantic layer   — currently 314/314, ~1s
node test/coretest.mjs   # core             — currently  41/41
node test/pnxtest.mjs    # PNX engine       — currently 298/298
```

```powershell
# the Electron smoketest: 100 steps against the real app, ~4 minutes
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

### Phase 6 — VFX compiler and shot events

Two new modules, both pure at load, plus the first patch operations that CREATE and DESTROY an
entity rather than editing one:

- **`ai/events.js`** (Part 41, and Part 40 as far as it honestly goes). The shared shot-event
  timeline, plus `describeShot`.
- **`ai/vfxspec.js`** (Parts 37–39, and Part 38's hierarchy). A declarative effect, compiled into
  reversible operations.
- **`ai/patch.js` gains `add_item` and `remove_item`**, mutual inverses.

Four MCP tools, both halves registered: `list_shot_events`, `describe_shot`,
`validate_effect_timing` (read) and `compile_effect` (mutating). 178 tools in the app.
`SEMANTIC_LAYER_VERSION` → `1.6.0`. Matrix: 3 rows to `implemented` (VFX-002, VFX-010, SHOT-002),
2 to `partial` (SHOT-001, VFX-011); 165 rows now
*implemented 78 · partial 24 · designed 8 · deferred 2 · blocked 1 · unplanned 52.*

Part 62's success condition is proven at the handler boundary by a new smoketest step: *"a
parameterized impact effect is attached to a hand, timed to an event, and undone."*

**THE decision this phase turned on, settled before any code: a VFXSpec targets the
`kind: 'vfx'` emitter item, NOT the PNX graph.** Cadence already has a 390-node procedural VFX
engine, so the question was never "how do we make effects" but "which of the three VFX systems
does the semantic layer drive". The emitter item won on three grounds: it is the one effect
representation `ai/patch.js` can edit field-by-field (so a spec can be previewed and rolled back,
where a PNX document has its own undo the transaction ledger cannot see); `renderer/js/vfx.js` and
`particleLibrary.js` are pure and importable from `ai/` while `pnx/**` is not; and the sampler is
already deterministic under scrubbing. The full reasoning is at the top of `ai/vfxspec.js` —
**read it before proposing that Phase 7+ author PNX graphs from a spec.**

**The other decisions worth not relitigating:**

- **The shared timeline is DERIVED, never migrated.** Markers stay in `project.markers[itemId]`.
  Re-keying them into one project-level table would be a destructive migration across `state.js`,
  `io.js`, the timeline UI and every saved file, and buys nothing a projection cannot. Same call
  `ai/ids.js` made about the track table.
- **A shared timeline has to earn its keep, and `concurrentEvents`/`overlaps` are how.** Any one
  item's markers are already visible in the editor; what no surface showed is two events on
  DIFFERENT items sharing a frame, or one event's Luau hook firing inside another's span. Co-timing
  is reported as a fact, never a problem — two characters impacting on one frame is usually the
  point.
- **The primitive vocabulary is `particleLibrary.js`, not a new list.** 22 material archetypes ×
  6 themes × 3 scales, already shared by the Inspector and the VFX Studio. `PRIMITIVES` is derived
  from the preset table, so adding a material extends the spec language for free.
- **A new item may declare its attachment; an existing one may not.** `set_item_field` still
  refuses `attachedTo`, because re-parenting something that already has a world position must
  re-derive the offset to keep it visually still — and this layer has no solved poses. A newly
  created item has no prior position to preserve, so its offset IS the declared offset. The
  asymmetry is real; it is not an oversight to be "fixed".
- **The new item's id is DERIVED from the spec** (`vfx-<hash>`), for two reasons that both matter:
  `commitPatch` verifies the applied result against the hash the plan predicted, so a
  `crypto.randomUUID()` would make every commit fail its own post-condition; and compiling the same
  spec twice then refuses as a duplicate instead of silently stacking two identical emitters.
- **`remove_item` refuses rather than stranding.** `state.removeItem` drops an item and its tracks
  and leaves group entries and semantic records pointing at nothing. Reproducing that would make
  the op non-invertible, so it refuses when a key group, a semantic record or another item's
  attachment still refers to the item, and names which.
- **`lead` is defined once**: how far BEFORE the event the effect PEAKS. It is the field most
  easily got backwards, so the definition lives in one place with the envelope algebra beside it.
- **The envelope goes on `@rate` only.** `@lifetime` and `@speed` stay static because `vfx.js`
  resolves them AT SPAWN; keying them would mean a per-particle constant that changes
  retroactively, which is precisely what that file is built not to do.
- **Measurement is separated from judgement again** (Part 4.5): `resolveTiming` computes the
  envelope, `validateTiming` judges it.

**Two real bugs this phase found in existing code, both pre-existing and neither introduced here:**

1. **`diffProjects` reported a whole new keyed track as a key COUNT and never its key TIMES.**
   `frameRangeOf`, `ai/explain.js` and `ai/observe.js` all build their frame lists from
   `keys_added`/`keys_removed`, so a brand-new track contributed **no affected frames at all** —
   `changed_frame_range` came back `null`, and that range is exactly what Part 44 uses to avoid
   re-rendering a whole shot. Only the human-readable line was right (it reads `t.keys`), which is
   why it went unnoticed. Fixed at the source, with `keys` kept for existing callers.
2. **`buildPatch` (app.js) pre-validated every op's `itemId` against the CURRENT project**, so a
   patch that creates the item its later ops address was rejected for addressing the emitter it was
   in the middle of creating. Ids added earlier in the same patch now count as present. **This one
   is only reachable through the handler boundary** — the unit tests build patches directly and
   never see it. It is the second time this programme has found a bug that only the in-app
   smoketest could reach; budget for that step, do not skip it.

**Deliberately not done, and named rather than hidden:** a VFXSpec compiles to ONE emitter — no
multi-layer PNX authoring, no beams/trails/meshes, no light, no sound, no particle collision (all
listed in `VFXSPEC_FIELDS.absent`, with the reason each is impossible in a Cadence project rather
than merely unbuilt). There is still no Shot entity: `describeShot` reports what the project holds
and names the rest in an `absent` block instead of inventing a record whose fields cannot be
written (SHOT-001 is `partial` for exactly that reason, not `implemented`). Part 38's hierarchy is
a declared intent with one real consequence (the budget share); nothing measures whether the
primary effect actually READS as primary, which needs the observation passes (VFX-009).

**A note on the known flakes:** the *Fire & smoke* / *Effect Look* cascade documented above did
**not** fire on either full smoketest run this iteration. That does not mean it is fixed — it is
GPU-timing dependent, and the previous two sessions both saw it. Do not read a clean run as
evidence either way.

### Phase 7 (first half) — operating modes and controlled experiments

Two new modules, both pure at load, and the phase's success condition met:

- **`ai/modes.js`** (Part 11). The eight operating modes and the exploration/production axis.
- **`ai/experiment.js`** (Part 48). Bounded named alternatives, compared, with a justified
  recommendation. **This is the success condition**: *"Cadence can compare bounded alternatives and
  justify a recommendation."*

Two MCP tools, both halves registered: `operating_modes` and `compare_experiments` (both
READ-ONLY). 180 tools in the app. `SEMANTIC_LAYER_VERSION` → `1.7.0`. Matrix: `EXPT-001` and
`OPS-001` to `implemented`; 165 rows now
*implemented 80 · partial 24 · designed 7 · deferred 2 · blocked 1 · unplanned 51.*

**`OPS-001` was a lie, and fixing it was the right place to start.** `IntentSpec.mode` existed, was
carried through interpretation, reached provenance, and **was read by nobody** — so declaring
`mode: 'analyze'` recorded an intention and permitted exactly the same edits as `create`. It is now
enforced, in **one** place: `apply_animation_patch`. That is deliberate and worth preserving —
`apply_motion_plan` and `compile_effect` both reach the project through that handler, so gating it
gates every mutating semantic tool. A future mutating tool that writes to `state.js` directly
bypasses the mode gate, the constraint check, the transaction and the snapshot in one step.

**The decisions worth not relitigating:**

- **A mode narrows; it never widens.** No mode grants permission the constraint system would
  refuse. Part 11 requires even `create` — the most exploratory mode — to preserve locked
  properties, so a lock outranks every mode.
- **A read-only mode's refusal is NOT forceable.** Part 11 says leaving `analyze` is a transition
  *the user* makes; a `force` flag that let a tool leave it would be the tool making that decision.
- **There is no default mode.** `DEFAULT_MODE` is `null`, not `'create'`. Not knowing which mode is
  active is a distinct state from being in a permissive one, and an unstated mode gets the strictest
  defaults plus a `MODE-UNDECLARED` finding. Nothing infers the mode from request text — guessing it
  would make the safest reading the one nobody chose.
- **`modes.js` is policy, not police.** It decides the one question it can (may this mutate) and
  returns the rest as `obligations`. "Polish must start with diagnosis" and "fix must stop when the
  issue is resolved" are real Part 11 requirements that this layer *cannot verify* — it sees a
  project and one action, never the session history. Named as limitations rather than faked.
- **Comparing candidates never mutates.** Each one is planned against a clone, so a four-candidate
  comparison touches the project zero times. That is why `compare_experiments` is READ-ONLY, and
  the smoketest asserts the live singleton project is byte-identical afterwards.
- **A candidate with no hypothesis is REFUSED, not compared.** Part 48 forbids "superficial random
  parameter changes", and a parameter change with no stated claim is exactly that.
- **Superficiality is only partly decidable, and the file says which part.** Identical result
  hashes are caught outright. Two candidates moving the same variable in different units are
  *reported for a human to judge, never refused* — Part 48's own example set has "anticipation plus
  10 percent" and "anticipation plus four frames", so refusing that pattern would refuse the
  directive's own example.
- **A recommendation is justified from measured dimensions or withheld.** 5 of Part 48's 8
  comparison dimensions are measured; when they tie, `recommend` returns **no winner** plus the
  question a human must answer. A recommendation with nothing behind it is the failure Part 48
  exists to prevent, so having none is better.
- **Motion is measured but does not vote.** A peak speed is neither good nor bad without a declared
  target direction — "snappier" wants it higher, "heavier" wants more deceleration contrast, and the
  same number serves both. Motion decides only *through* `intent_alignment`, because an acceptance
  check encodes the direction. That is exactly how the candidate that dragged a planted foot lost.

**Two real bugs this half found, one in Phase 6's own work:**

1. **`analyseScope` did not see an item the patch CREATES.** `add_item` keeps its id in
   `op.item.id`, not `op.itemId` — the same root cause as the `buildPatch` bug in Phase 6, which
   means the CLAUDE.md warning written *during* Phase 6 was not then applied to `scope.js`. An
   `add_item` alone reported an **empty blast radius**, and with a following `set_key` the item
   appeared but was resolved against the *pre-patch* project, so a creating patch reported a direct
   target named `"(missing)"` with a null kind. Created items are now described from the planned
   result and flagged `created_by_this_patch`. **When a new op kind is added, grep for every reader
   of `op.itemId` — there were four files.**
2. **`report.allowed` is not "nothing is wrong".** A contact constraint compiles to `warn`, so a
   violation is reported while `allowed` stays `true` and the apply proceeds. That is right for
   `apply_animation_patch` (a human asked for that exact edit) and wrong for an experiment, where
   the declared protections are the *boundary*. `ai/experiment.js` therefore counts `violations`
   rather than trusting `allowed`, and says so in the exclusion text. The first version of the
   viability gate used `allowed` and silently let a protection-breaking candidate win.

**Also corrected here:** the previous session's note said Phase 7 was "knowledge, memory and
self-improvement". It is not — the matrix's own per-row phase annotations put `KNW-*`/`MEM-*` in
Phase 8 and `BCH-*` in Phase 9. **The matrix rows are the authority on phase membership**, not the
directive's part ordering. `MCP-007` was also stale from Phase 6 and now counts
`validate_effect_timing`.

**The directive is on disk at `C:\Users\alyco\Documents\Cadence_Animator_Ultimate_Master_Directive.md`
and Phases 1–6 were built without reading it directly.** Reading Parts 47, 48, 49, 52, 14 and 11
verbatim changed this phase's design materially — Part 62's success condition for Phase 7 is
*"compare bounded alternatives and justify a recommendation"*, which makes `EXPT-001` the keystone
rather than the simulation report a phase title would suggest. **Read the actual parts for the phase
you are on.** `awk`/`python -c` on `^## <n>\.` extracts one part cleanly.

### Phase 7 (second half) — the shot review, the pre-commit simulation, and the workflow registry

Three more modules, completing Phase 7:

- **`ai/review.js`** (Parts 49 and 14). The structured shot review, plus the quality hierarchy that
  orders it. `REV-001` is `partial`, not `implemented` — see below.
- **`ai/simulate.js`** (Part 47). The pre-commit evaluation.
- **`ai/workflows.js`** (Part 52). The sixteen named workflows as declared tool chains.

Four MCP tools, both halves registered: `review_shot`, `simulate_change`, `list_workflows` (read)
and `run_workflow` (mutating when its chain is). 184 tools in the app.
`SEMANTIC_LAYER_VERSION` → `1.8.0`. Matrix: `SIM-001`, `OPS-005`, `MCP-012` to `implemented`,
`REV-001` to `partial`; 165 rows now
*implemented 83 · partial 25 · designed 7 · deferred 2 · blocked 1 · unplanned 47.*

**The question this half had to answer first was "what does a fourth report add?"** —
`preview_animation_patch`, `analyse_scope` and `evaluate_acceptance` already answer much of what a
simulation report asks, and re-answering them slightly differently would have been worse than
nothing (Part 4.6). The division that came out of it is recorded at the top of `ai/simulate.js` and
is worth keeping:

    preview_animation_patch   what would CHANGE
    analyse_scope             how far the change REACHES
    review_shot               whether the shot as it STANDS is any good
    simulate_change           whether it would be any good AFTER — per quality layer

**So the one thing only `simulate_change` says is whether a change makes the shot better or worse,
layer by layer, before it is committed.** It plans on a clone, reviews both states and diffs the two
reviews. A regression is *a layer whose verdict got worse*, never *a finding that appeared* —
counting findings would report noise.

**The decisions worth not relitigating:**

- **Deterministic defects and artistic suggestions are separate arrays and are never merged.** Part
  49 and Part 11 both require the distinction. A suggestion carries **no severity**, because a
  severity on a subjective judgement is exactly how an opinion starts looking like a measurement.
- **There is deliberately no overall score.** Part 47: *"The report must never imply that a
  subjective score is ground truth."* One number would have to average a measured contact drift
  against an unmeasurable pose judgement. `WHY_NO_OVERALL_SCORE` is exported so a reader of the
  result finds the reason, and a test asserts the field does not exist.
- **Layer beats severity in the ordering.** A blocking micro-polish nit ranks below a major timing
  problem, because fixing the polish first is how a shot gets beautifully wrong. Part 14's *"fix the
  highest-impact failing layer first"* is only an instruction a tool can follow if the ordering is
  lexicographic on layer.
- **Severity is this codebase's own convention and says so.** Parts 49 and 66 both require a
  severity and no part defines a scale, so every finding carrying one has an `evidence` entry
  labelling it a convention. It describes CONSEQUENCE; Part 13's certainty describes CONFIDENCE.
- **An unmeasurable layer is reported as unmeasured, never as passing.** 3 of Part 14's 13 layers
  are measured fully, 6 partly, 4 not at all. `"pose design: fine"` would be worse than useless.
- **The registry is EXACTLY Part 52's sixteen, and a test pins it against the directive's list.** My
  first version had 21 — I miscounted the directive as 17 and added five entries from Part 50. Two
  of those existed only to say "this would be a shell", which belongs in a comment and not a
  registry row. An extra row is drift; a missing one is a gap.
- **Every workflow reports `benchmark_coverage: none`.** Part 52 requires the field and no benchmark
  suite exists (BCH-001, Phase 9). Reporting none is the honest answer.
- **Part 52's approval points are enforced, not documented.** `run_workflow` stops BEFORE the first
  mutating step and returns the remaining plan so the caller sees what it would be approving;
  `approve: true` runs the chain. Required input is validated before any step runs, because failing
  three tools into a chain is worse than a refusal.

**Two things the measurement layer taught this one:**

1. **`motion.classifyVariation` deliberately refuses to call an unexplained discontinuity a
   defect** — accidental jitter, procedural detail and an interpolation artefact are
   indistinguishable in Cadence project data (Part 4.5). My first `review.js` looked for a
   `classification === 'defect'` that does not exist, and would have overruled that refusal. An
   unexplained jerk spike is now an artistic SUGGESTION pointing at
   `explain_motion_problem`, and an authored one (stepped key, held pose, marked impact) is not
   reported at all.
2. **A compiled `ConstraintSpec` keeps its range in `time_range`, not on the condition, and its
   `target` is an ARRAY of selectors.** Reading `condition.from` / `target.itemId` measured
   `undefined` and reported *no contact problem at all* — a false clean bill of health, which is the
   worst possible failure for a review tool. The mistake was assuming a shape instead of printing
   one; `node -e` on a real compile takes ten seconds.

**Also fixed here:** `review_shot`'s "no deterministic defect was found" recommendation previously
returned `requires_user_approval: false`, while its own text says *"That is not \"the shot is
good\""*. A statement that disclaims itself must not be auto-actionable.

**`REV-001` is `partial`, and that is the honest status.** All 10 of Part 49's return fields are
present, but 3 of its 10 analysis steps cannot run: key poses and silhouette (MOT-011/012), camera
framing (no active-camera model) and the rendered baseline comparison. Part 49 also asks for
"annotated render crops", which this layer cannot produce at all; it returns the suspect frame list
to render instead.

## Health pause - 2026-09-08 19:19:36 AST

- Iteration: (2/7)
- Consecutive failures: 2
- Reason: exit_code

Recent diagnostics:
    You've hit your session limit · resets 11:10pm (Asia/Dubai)

Next step: Inspect the failure, fix the project or adjust the prompt, then rerun Continuous Claude.
