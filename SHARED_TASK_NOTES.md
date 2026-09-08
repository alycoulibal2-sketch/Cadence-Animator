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
- **Phases 0, 1, 2 and 3 are done.** Phases 4–9 are not started.
- Commits: `54ea3f4` (Phase 1), `88265c9` (Phase 2), `0cadfd9` (Phase 3).
- The semantic layer is `renderer/js/ai/**` — 19 modules, 26 MCP tools.

**Phase 4 is next: observation and baseline.** Part 62's success condition is *"Cadence can explain
what changed after a scoped edit."* Its rows in the matrix are the `OBS-*` group (Parts 43–46), and
the honest note to start from is that **nothing in this build has ever looked at a pixel** — every
result currently says so in its own `coverage.notRun`, and Phase 4 is what changes that.

## The rules this codebase holds itself to

These are not style preferences. Each one is load-bearing, and several were learned by getting them
wrong first. Breaking one silently is worse than not doing the work.

1. **Pure at load.** Nothing under `renderer/js/ai/` may touch `window`, the DOM, three.js or
   `state.js`. `test/aitest.mjs` imports every module in plain Node and a test enforces both the
   purity and the "every module on disk is imported here" completeness.
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
node test/aitest.mjs     # semantic layer   — currently 214/214, ~1s
node test/coretest.mjs   # core             — currently  41/41
node test/pnxtest.mjs    # PNX engine       — currently 293/293
```

```powershell
# the Electron smoketest: 95 steps against the real app, ~4 minutes
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
