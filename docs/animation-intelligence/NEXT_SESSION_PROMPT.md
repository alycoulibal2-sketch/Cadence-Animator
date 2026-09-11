# Cadence Animator — next session master prompt (v4, written 2026-09-11)

You are continuing the Cadence Animation Intelligence programme in a FRESH session. Everything
you need is in the repo; this prompt tells you where, what the numbers are, the target, what to
build next and in what order, the rules, and the traps. Read section 0, run its four commands,
then start the first unfinished slice in section 3. Do not re-read the whole directive. Do not
re-litigate decisions the notes say are settled.

**The learning loop IS built** (2026-09-11, `LEARNING_LOOP_PROMPT.md` v2 in this folder): the
cross-project library (`ai/library.js` + seven MCP tools), knowledge on disk behind Part 72's two
gates, the `cadence-learn` skill, the `library_search` benchmark, and `LESSONS.md`. Slice A of
THIS prompt is also done (see `SHARED_TASK_NOTES.md`); **Slice F is next**.

What is NOT done there is the corpus itself: the library is empty until the user works through
`CORPUS.md`, because Mixamo downloads, Studio's Animation Capture and every licence decision are
theirs. Do not invent one. **Read `docs/animation-intelligence/LESSONS.md` before starting** —
it holds what the watch batches have taught, a queue of 15 buildable measurements with their
evidence, and a queue of 7 motions worth capturing.

## 0. Read this first, in this order (about ten minutes)

1. The repo is the `Cadence-Animator` checkout (desktop: `C:\Users\User\CadenceAnimator`; laptop:
   the same repo under `C:\Users\alyco\`). Work on branch `animation-intelligence`:
   `git fetch origin && git checkout animation-intelligence && git pull`. `main` is still v0.11.0
   at `8343e2f`; do not merge into it unless the user asks.
2. `SHARED_TASK_NOTES.md` in full — the log between sessions. The **Slice A** entry at the bottom
   is the latest; its "decisions worth not relitigating" apply to you, and its two R15 rig traps
   will cost you an hour each if you skip them.
3. `docs/animation-intelligence/requirements-matrix.md` — the living state, one row per
   requirement, 165 rows. You will move rows and recount its header.
4. `CLAUDE.md` — rules and pitfalls, each learned the hard way.
5. `docs/animation-intelligence/LESSONS.md` — what the system KNOWS, as opposed to what the code
   does: the merged watch batches, the checks queue a building session picks from, and the
   capture queue waiting on the user.
6. The directive, `Cadence_Animator_Ultimate_Master_Directive.md` (in `Documents` on both
   machines, 4150 lines): read ONLY the parts a task below cites. Loading it whole wastes the
   context this session has.
7. Before touching anything, prove the tree is green here:

   ```
   node test/aitest.mjs                # 390/390
   node test/coretest.mjs              #  41/41
   node test/pnxtest.mjs               # 298/298
   node tools/benchmark.mjs --compare  # clean: 66 cells unchanged against the committed baseline
   ```

## 1. Where the programme is (with the numbers)

- **Part 62's nine phases are done, and so is Slice A.** The semantic layer is
  `renderer/js/ai/**`: 40 modules (`benchmarkBaseline.js` is GENERATED), 60 semantic MCP tools
  (200 in the app), `SEMANTIC_LAYER_VERSION` 1.11.0. Matrix: implemented 87 · benchmarked 9 ·
  partial 33 · designed 7 · deferred 2 · blocked 1 · unplanned 26. No unplanned P0 row remains.
- **Slice A — GENERATION — is DONE.** `ai/pose.js` compiles a PoseSpec into exact keys (degrees
  about named axes, or analytic two-bone IK onto a target in studs, landing at 4.6e-16 studs or
  reporting the shortfall) and measures the solved pose (line of action, a volume-proxy centre of
  mass, balance against DECLARED support). `plan.authorMotion` turns an IntentSpec + declared
  phase frames + a PoseSpec per phase into a start key, key poses, breakdowns, holds and a settle.
  Three tools: `pose_conventions`, `compile_pose`, `author_motion`. A 17th benchmark
  (`authored_attack`) runs it from an EMPTY R15. Read the Slice A entry at the bottom of
  `SHARED_TASK_NOTES.md` before touching any of it — especially the two R15 rig traps.
- **What was verified on 2026-09-11, and what Slice A changed about it.** The layer WAS only the
  quality-assurance half of a pipeline: it measured, constrained, explained and reversed edits
  honestly, and did not make animation. Slice A closed the generation gap; everything else below
  is still true. Evidence, from the pure pipeline itself:
  - The directive's own Part 3 product-promise request ("a 1.2-second anime sword slash, extremely
    heavy, subtle anticipation, ...") on an EMPTY rig used to produce **zero operations** — every
    planner strategy edits keys that already exist. It still does: `plan_motion` on an empty
    timeline correctly produces nothing, and `author_motion` is the entry point that produces the
    motion (48 operations across 8 steps on the benchmark's script). **The INTERPRETATION half is
    unchanged and still weak**: 2 of about 23 content words understood, intent confidence 0.06.
    Authoring takes its poses from the script, so a weak interpretation cannot become a weak pose
    — but nothing yet turns that sentence into a script, and that is what Slice F's `author_shot`
    and the animate skill are for.
  - On an already-keyed slash the planner applies 3 of its 4 strategies (amplitude, spacing
    contrast, lead/lag). 9 of 15 motion dimensions compile; the rest are named as blocked.
  - `review_shot` measures 3 of Part 14's 13 quality layers fully (timing, spacing, contacts).
    Readability/staging, pose design, camera relationship and secondary motion are NOT measured —
    the top of the hierarchy Part 14 says to fix first.
  - `capabilities().cannot` has 21 lines, including "judge whether a result looks RIGHT".
  - The knowledge system is 12 principle cards, all `essential`.
- **So expert output today still comes from the model's own animation judgement** — but it now has
  an exact compiler to drive instead of only the 140 raw tools: the model states degrees, frames and
  reach targets in words, and `author_motion` computes the CFrames, solves the contacts and measures
  the result. What the model still supplies alone is WHICH pose, WHICH frame and WHICH timing. The
  mission below is the rest of the craft, and then the machinery that takes it past what one human
  attempt can do.

## 2. The target, stated honestly, and the principle that reaches it

The user's target: **animation above expert human level, with not one mistake.** Split it the way
the directive splits quality (Part 2), because the two halves are reached by different means:

- **Zero TECHNICAL mistakes is reachable by construction.** Foot sliding, an accidental key, an
  IK pop, a one-frame pop, a timing shift on a protected event, a detached emitter, an export
  that drops data — every one of these is deterministic, and the layer already measures most of
  them. What is missing is that nothing GATES on them: a shot can be exported with a known drift.
  Slice E below turns the defect list into gates that `ship` mode and `export_to_studio` cannot
  pass while any is present. From then on a technical mistake is impossible to ship, whatever
  model is driving.
- **Above-expert ARTISTIC quality is reached by doing what no human attempt does: exhaustive,
  measured search.** A human animator tries two or three timings; the tool can author fifty
  candidates from a parameter grid, measure every one on the acceptance spec and the twelve
  principles' detection methods, render each as a contact sheet, and hand the model and the user
  the three that are genuinely different and measurably best (Part 48, `EXPT-002`). Add exact
  physics where a human eyeballs (contacts solved by IK to the target, arcs fitted, settles
  computed), style consistency enforced across the whole project from memory, and expert
  reference clips matched on measured characteristics, and the result is systematically better
  than a single expert pass. **What the machine may never do is CERTIFY artistic perfection**:
  Part 4.5 and the codebase's own rules forbid calling a subjective judgement a fact. "Perfect"
  is declared by the user (a rating, an acceptance), never by a tool; a tool that said it would
  be lying, and the honesty tests would fail it.

The user's three standing constraints apply to every authoring feature, and each has already
killed a design in this repo (see `docs/effect-sheet.md` and the notes):

| Constraint | Meaning here |
| --- | --- |
| **Exact** | a pose or a timing is COMPUTED from explicit targets and numbers; never estimated, never "interpreted". Analytic IK from a reach target is exact; a guessed pose is not |
| **No learning** | nothing trained, nothing needing a big-name API (the user is a minor with none; other users will have none). The model supplies goals; the compiler does exactly what they say |
| **Full power** | any pose and any timing must be reachable through explicit goals. Starting recipes are allowed ONLY as starting points that open fully editable — never as a ceiling |

## 2b. How the models think, and what the MCP must do about it

The MCP is driven by a Claude model (Sonnet 5, Opus 5, or Fable 5.1 — Mythos-class), and every
one of them shares the same shape of strengths and weaknesses. Design the tools so the weaknesses
never touch the animation and the strengths are what decides it. These are the rules; Slice F
makes them concrete.

**What every model is bad at, and the tool must therefore do:**

1. **Numeric 3D.** No model should ever produce a CFrame, compose rotations, or pick a sign on an
   axis. Every authoring input is semantic and exact: degrees about a named axis in the rig's
   declared convention, a reach target in studs relative to a named part, a phase in frames. The
   tool computes; a wrong-axis mistake becomes impossible rather than checked.
2. **Seeing motion.** A model reads one image at a time and cannot flip frames. Give it what a
   human animator uses: a contact sheet (a grid of numbered frames), onion-skin overlays, motion
   trails and arcs drawn INTO the image, silhouette strips, and an x-sheet (a frames × joints
   table of keys, holds, contacts and events — models read tables well). Every mutating tool
   returns the sheet for its changed range.
3. **Holding a plan over a long tool chain.** Models drift and forget constraints. Carry the shot
   card (intent, plan, constraints, acceptance, what is done, what is next) as an MCP resource
   the model re-reads cheaply, and put `next_best_actions` on every result.
4. **Believing themselves.** A model will call its own output done. `done` is never a model
   claim: `ship` mode gates, `accepted` vs `fully_validated` stays separate, and any claim of
   quality carries the measurement or the certainty label `subjective`.
5. **Consistency across calls.** Sampling varies. Let the tool generate the candidates
   deterministically from a parameter grid and let the model CHOOSE — previews replace names, the
   user's own rule for the effect sheet — so the numbers never come from the model's temperature.
6. **Long chains.** Each tool call is a chance to lose the thread. Offer one-call loops
   (`author_shot`: plan → author → contact sheet → measure → critique → next actions in one
   result) for the fast tier, with the individual tools still there for the deep tiers.
7. **Context cost.** Tool results and descriptions are paid for on every turn. Compact by
   default, `verbose` on request, and a resource instead of a re-fetch.

**What every model is good at, and the tool must therefore leave to it:** turning intent into a
phased plan in words; writing an acceptance spec; critiquing a contact sheet against the twelve
principles WHEN the measurements are printed next to it; choosing among candidates; explaining a
decision to the user. The tool computes and measures; the model decides and explains.

**The three tiers differ in how much rope to give them**, not in the gates (the gates are the
same for everyone — a mistake is never allowed):

| Tier | Give it | Default `discipline` |
| --- | --- | --- |
| Sonnet 5 (fast) | the one-call loops, short option sets, checklists in every result, `next_best_actions`, the shot card re-read before each decision | production: strict constraints, full provenance, minimal unrelated change |
| Opus 5 (deep) | the full tool surface, experiment mode with 3–7 candidates, custom acceptance specs, the shot review before every commit | production, exploration on request |
| Fable 5.1 (frontier) | everything Opus gets plus the director's loop (§3, Slice D) with wide grids, and the right to write new benchmarks and propose architecture changes — never to adopt them | exploration for candidates, production for the commit |

An MCP server cannot see which model is calling it. The profile is DECLARED: an environment
variable at registration (`CADENCE_MODEL_PROFILE=sonnet|opus|fable`) with a `set_operating_profile`
tool to change it, reported on every result. No profile weakens a gate.

## 3. The slices, in value order — ONE per session

Each slice ends with: a smoketest step at the handler boundary, aitest checks (negative-tested), a
Part 59 benchmark that measures it, matrix rows moved with honest Limits, the notes appended, this
prompt bumped, a commit, a push. The order is by leverage: nothing can be expert until something
can be authored (A — DONE); the skill and profiles make every later slice cheaper for every model
(F — next); gates make mistakes impossible before anything gets ambitious (E); eyes before search
because search needs to see (B, then D); reference last because it needs A, B and D to be worth
anything. **Slice F is now worth more than it was**: there is finally something for `author_shot`
to compose, and `compile_pose` is the natural dry-run step in the skill's checklist.

### Slice A — GENERATION — ✅ DONE (2026-09-11). Kept here for what it settled; do not redo it.

Goal, met and proven in `aitest`, the `authored_attack` benchmark and a smoketest step at the
handler boundary: *"from an empty R15, an IntentSpec becomes key poses at phase boundaries with
breakdowns, holds and a settle, applied transactionally, measured, and rolled back to an empty
timeline."* **The one thing left open in this slice is the user's, not yours: §7.3, whether a set
of starting recipes may ship.** Everything else below was built; the details are in the Slice A
entry of `SHARED_TASK_NOTES.md`.

1. **`ai/pose.js` — exact pose compilation.** Input: a `PoseSpec` (Part 20.3; `ai/cal.js poseSpec`
   carries the fields, the measurable half is null). Output: joint rotations as `set_key`
   operations (`ai/patch.js` creates a key that does not exist). Two exact mechanisms: explicit
   per-joint rotation goals in DEGREES about named axes in the rig's convention (the tool converts;
   the model never writes a CFrame), and analytic two-bone IK for a reach target on an arm or leg
   (the pure FK is in `ai/kinematics.js`; the app's `solve_ik` is impure — write the pure solve and
   gate it by a smoketest cross-check against the app's solver, the way `kinematics.js` is gated
   against `rigbuild.js`). A target that cannot be reached is REPORTED with the shortfall, never
   approximated silently. Line of action and balance are MEASURED from the solved pose (fit through
   root, torso, head; centre of mass by part volume as a declared proxy — `MOT-011`), never guessed.
2. **`ai/plan.js` gains authoring.** A new entry point (`authorMotion`) takes the IntentSpec + a
   `TimingSpec` (phase durations from the action template `segmentPhases` already knows for attack
   and reaction) + PoseSpecs per phase, and emits keys at phase boundaries, breakdowns between
   them, holds where the spec says hold, and a settle. Every inserted key is checked against
   declared contacts through the existing `contact_drift` constraint (`MOT-008` shipped the safety
   half of key insertion for exactly this). Timing is exact frames from the spec; nothing infers a
   phase it was not given.
3. **Starting recipes, if you add any, are data that opens editable**: an `attack` recipe is a
   parameter set (windup angle, reach, weight shift, impact frame) whose every value the caller
   can change, and a pose built from explicit goals must always be possible without a recipe. Ask
   the user before adding a recipe set; never a "pose library" as a product.
4. **Measure it.** A new benchmark `authored_attack` in `ai/benchmark.js`: from an EMPTY rig,
   author the slash, then measure `animation_intent_alignment`, `contact_stability` (declare the
   planted foot with the ROLE PHRASE `'left foot'`), `curve_continuity`, `reproducibility`; check
   that rollback empties the timeline. Re-write the baseline and commit it with the change.
5. **Expose it** in BOTH halves (`renderer/js/app.js MCP_HANDLERS` and `mcp-server/index.js`),
   through `apply_animation_patch`. Descriptions open with `READ-ONLY.` / `MUTATING ...`.
6. **Matrix rows**: `CMP-001` (edits → generates), `CAL-003` (PoseSpec's null half), `MOT-011`
   (balance as a volume proxy — say so), part of `MOT-013` (holds). Directive parts: 20.2–20.4,
   24, 26.2, 26.4, 28, 29, 32.

### Slice F — MAKE THE MODEL'S JOB EASY (the skill, the profiles, the resources) — DO THIS ONE NEXT

1. **The animate skill.** Write `.claude/skills/cadence-animate/SKILL.md` (and register it in the
   README): the operating procedure of directive Part 64 as a checklist a model follows —
   understand → inspect (shot card) → plan in phases → constrain (compile the preserve clause) →
   author or edit through the transactional tools → contact sheet → measure → critique against the
   twelve principles with the measurements printed → correct or run candidates → validate → ship
   gate → record. One paragraph per step, each naming the exact tool. Golden rule from the effect
   sheet: every phrase understandable by an intelligent 11-year-old in ten seconds.
2. **`next_best_actions` on every semantic tool result**: two to four concrete next calls with
   their arguments, derived from the result (a failed check → the tool that fixes it; a plan → the
   apply; an apply → the contact sheet and the review). Sonnet needs this; Fable is faster with it.
3. **MCP resources (`MCP-011`)**: `cadence://shot/current` (the shot card: intent, plan,
   constraints, acceptance, transactions, what is done, what is next), `cadence://timeline/current`
   as an x-sheet, `cadence://project/conventions`, `cadence://analysis/{id}`. Compact, with revision
   ids, so a model re-reads instead of re-fetching.
4. **Operating profiles**: `CADENCE_MODEL_PROFILE` + `set_operating_profile`; profile changes
   default discipline, result verbosity, candidate counts, whether one-call loops are offered —
   never a gate. `OPS-002` (exploration vs production always visible) closes here.
5. **One-call loop**: `author_shot` = plan → author → sheet → measure → critique → next actions,
   for the fast tier; it composes the Slice A tools and adds nothing of its own (Part 52's rule).

### Slice E — THE MISTAKE GATES (zero technical defects by construction)

1. **The defect catalogue as checks.** Part 44's list — one-frame pop, flicker, accidental
   keyframe, silhouette jump, foot sliding, IK pop, event timing shift, emitter detachment,
   accidental object creation or deletion, camera drift — each becomes a registered check with
   `implemented: true|false` and what blocks it (the pattern in `ai/constraints.js CHECKS`).
   Most are one call away from measurements that exist (`analyze_motion`, `measureContactDrift`,
   `diffProjects`, `validateTiming`). Flicker and pops between frames need consecutive samples:
   sample them (the FK solve is cheap), not pixels.
2. **Run the catalogue after every mutation** and put the result on the transaction
   (`validation_results.defects`). A defect the transaction introduced is reported at `certain`
   with the operation that did it and the minimum safe correction.
3. **`ship` mode gates**: `export_to_studio` and any "final" workflow refuse while a deterministic
   defect exists, while any acceptance check is `not_run`, or while an unapproved difference
   against the approved baseline exists — and say exactly which. `force` records an override on
   provenance; it never makes the gate disappear.
4. **Export truth**: split `renderer/js/validate.js` so the pure half runs in `ai/`, so
   `export_valid` (the last blocked acceptance check) actually runs, and `prepare_for_export`
   stops being the unimplemented workflow it is.
5. **`no_visual_regression` runs**: thread a baseline id through `evaluateAcceptance` (the wiring
   the Phase 4 notes named as "a small, well-defined piece"). Rows: `TXN-007`, `CAL-008`'s three
   blocked checks, `MCP-012`'s `prepare_for_export`, `OPS-006` (trust rules, from designed to
   implemented).

### Slice B — EYES (what the model looks at)

1. **Camera model** (`SHOT-003`/`SHOT-004`): project a part through a camera item's `@origin` and
   `@fov` — pure math — giving screen-space position, size and velocity (`MOT-006`) and framing
   facts (in frame, occluded by, share of the frame).
2. **Contact sheets, overlays, crops** (`OBS-008`, `OBS-007`): a numbered grid of frames from a
   named view, with motion trails, arcs and the planned event markers drawn in, plus a silhouette
   strip and an isolate of the changed parts. Returned as an image content block by every tool
   that changes a range, sized for the profile (small for the fast tier).
3. **Silhouette readability** (`MOT-012`) measured from the existing pass: limb separation
   (connected components), negative-space ratio, aspect change between key poses — reported as
   measurements; "reads clearly" stays `subjective`.
4. **Suspect frames** (`REV-002`) from the defect catalogue and the temporal samples, so a model
   looks at five frames, not sixty.
5. **The human rating stream**: an MCP tool that records the USER's rubric rating on a benchmark
   result or a shot (`recordHumanRating` exists and nothing calls it), shown beside the measured
   cells, never inside them. This is how "perfect" gets declared — by a person.

### Slice D — THE DIRECTOR'S LOOP (search that beats a single expert attempt)

1. **Meaningful candidates** (`EXPT-002`): the tool authors N variants from a parameter grid over
   the plan's own dimensions (anticipation frames, impact contrast, torso lead, overshoot, settle
   length), each a named hypothesis, each planned on a clone; duplicates by result hash collapse.
2. **Measured selection**: every candidate is measured on the acceptance spec, the defect
   catalogue, the twelve principles' detection methods (turn the knowledge cards' `detection`
   fields into measurements: anticipation-to-action duration ratio, stop-time offsets across a
   chain, arc bow, overlap lag — `KNW-003` → `MOT-*`), and the reference profile when one is
   declared. The tool returns the top three that are genuinely different, with contact sheets.
   A tie returns no winner and the question a human must answer (the rule Phase 7 set).
3. **Iterate**: the model picks or narrows the grid; the user picks the final; the choice and its
   evidence are recorded (Part 58: learning from accepted work, which `recordAcceptedWork` already
   captures).
4. **Style consistency across the project**: candidates are scored against the declared style and
   the project's accepted memory, so shot 12 matches shot 1 without anyone remembering.

### Slice C — REFERENCE (matching experts without learning)

The learning-loop session (`LEARNING_LOOP_PROMPT.md`) builds the cross-project library: real motion
from Roblox Studio's Animation Capture (video → R15 keyframes, labelled estimated), Mixamo mocap
through Studio's importer, and the user's own accepted shots, each with a Part 36 profile. This
slice CONSUMES it: rewire `compare_to_reference` (the one unimplemented workflow with a named
follow-up) to `search_library` + `store_reference_profile`, and let the director's loop (Slice D)
minimise profile distance to a reference the user chose. If the library does not exist yet, build
the minimum of it here (`import_from_studio`, `add_to_library`, `search_library`) rather than
skipping the slice. Research pose models (GVHMR, WHAM, TRAM) are non-commercial and stay out of the
product. Cites Parts 36, 33, 70.

## 4. Ground rules (non-negotiable — each has been got wrong here at least once)

- Nothing under `renderer/js/ai/` may import `window`, the DOM, three.js or `state.js`; a test
  greps for it and another fails if a module on disk is not imported by `test/aitest.mjs`.
- Every result carries `coverage.notRun` naming what it did NOT check; every assertion carries a
  Part 13 certainty level; an unimplemented check is reported as not run, never counted as
  satisfied; every module exports `*Limitations()`.
- A new MCP tool needs BOTH halves. A mutating semantic tool goes through `apply_animation_patch`.
- After fixing a bug, reintroduce it and confirm the new test fails. A test that passes both ways
  is not a test.
- No feature shells (directive 4.6): one narrow loop that can inspect, change, observe and undo
  beats a row of stubs.
- **No tool may claim artistic perfection or "no mistakes" beyond what it measured.** The honesty
  tests exist to fail such a claim. Say `fully_validated: false` and why.
- **Never adopt an architecture proposal on your own** (Part 4.8). Two are evaluated and waiting
  for the USER: `protect_support_chains` and `prune_violating_ops` (see the notes). If the user
  says yes, the change goes into the planner, the baseline is re-written, and the proposal record
  is adopted with the version through `review_architecture_experiment`.
- Never stage `site/` or the stray root files (`cd.html`, `sp*.html`, `yt.html`, `ids.txt`,
  `posts.json`) — they belong to other sessions. `git add` your files by name.
- Do not run `run-continuous.sh` unless the user asks; it spends money.
- Work in cheap loops: probe in plain Node (`node -e`, a scratch `.mjs`) before the four-minute
  smoketest; run the smoketest once per slice, not per edit. Do not fan out subagents for this
  work; one focused session with the notes is faster and cheaper.
- Write the next version of THIS prompt when the slice is done, not when the context is nearly
  full (the user's standing instruction: after each phase, write the next session's prompt).
  Update it in place, bump the version, commit it.

## 5. Verification, every time

The four headless checks in §0, then the Electron smoketest from PowerShell (about four minutes,
102 steps):

```powershell
Remove-Item test-output/userdata -Recurse -Force -ErrorAction SilentlyContinue
.\node_modules\.bin\electron.cmd . --disable-backgrounding-occluded-windows `
  --disable-renderer-backgrounding --disable-background-timer-throttling `
  --user-data-dir=test-output/userdata --screenshot=test-output/smoketest.png `
  --demo-js-file=test/smoketest.js
# results: test-output/smoketest-report.json
```

103 steps as of Slice A. Two of them flake on both machines and are documented in the notes:
*classic clothing* (fetches from the Roblox CDN — it times out after 20s, and the failing sub-step
varies run to run) and *observation: baseline → scoped edit* (a GPU pixel comparison). Both failed
on 3 of 4 runs on 2026-09-11, which is more than "occasionally" — so **prove it rather than assume
it**: copy your changed files aside, `git checkout --` them, re-run, and compare. At HEAD on
2026-09-11 the run was 100/102 with exactly those two failures and the same error text. A run where
MANY render steps fail at once is a starved GPU. Never dismiss a failure in a step your change
touched. `tools/benchmark.mjs --compare`
exits 1 on a difference in EITHER direction: intended → `--write-baseline` and commit the diff;
not intended → a regression.

## 6. Operational lessons (the traps, so you do not relearn them)

- **A DNS outage reads exactly like a GPU flake.** On 2026-09-11 the desktop lost DNS mid-session:
  `git push` said "Could not resolve host", the clothing step timed out. Retry before concluding.
- **A contact effector must be a ROLE PHRASE (`'left foot'`), not the part name (`'LeftFoot'`).**
  The part name resolves for the drift measurement and NOT for the constraint target, so the
  constraint is silently unenforced and a violation rate of 0 is a lie. Print
  `report.unresolved_targets` before trusting a zero.
- **Print a real compiled shape before consuming it** (`node -e`): a `ConstraintSpec` keeps its
  range in `time_range` and its `target` is an ARRAY; a difference answers Part 44's questions by
  name (`where_did_it_change`, not `where`); a diagnosis ranks causes in `likely_causes` with
  `target`; a stored keyframe's value is `v`, a patch op's is `value`.
- **`add_item` keeps its id in `op.item.id`, not `op.itemId`** — grep every reader of `op.itemId`
  when you add an op kind (four files last time).
- **A benchmark check's `ok` is three-valued**: `null` is not applicable; only `false` fails.
- **`{}` and an absent key hash differently**: deleting the last entry of a `semantics.*`
  container must delete the container.
- **`state.js snapshot()` clones a hard-coded field list**: a new top-level project field is
  outside undo until it is added there; `NOT_STATE` (`provenance`, `baselines`, `references`) is
  held out of snapshots and undo on purpose.
- **Rig conventions for exact authoring** — all of this is now data in `ai/pose.js`
  (`ROTATION_CONVENTION`, `AXIS_MEANING`, `BEND_AXES`) and reachable through `pose_conventions`;
  read that tool rather than retyping it. Every joint's rest axes are world-aligned, so a keyed
  rotation sets the child's orientation exactly; the rig faces local −Z, right is +X; `+X`
  shoulder/hip = limb forward, `+X` elbow and `−X` knee = natural bend, `−X` waist/neck = lean
  forward, `+Y` = turn left.
- **An R15 limb at rest is already at its reach limit**, and this cost two debugging rounds on
  2026-09-11. Hip-pivot-to-foot is 1.85 studs against a chain maximum of exactly 1.85;
  shoulder-to-hand is 1.6897 against 1.6888. So a reach target offset from a limb's REST position is
  almost always out of range (the solver reports the shortfall honestly, and the test proves
  nothing), and a planted foot on a straight leg becomes unreachable the moment the hips turn. Bend
  the knee in the stance pose — what a real animator does — and sample test targets around the JOINT
  PIVOT at a radius inside the reported `reach_range_studs`.
- **The R15 upper arm is ANGLED**: the elbow pivot sits 0.5 studs outboard and 0.728 down from the
  shoulder, so bone 1 is `(±0.5, −0.728, 0)` and maximum arm reach is 1.6888, not the 1.7675 that
  |bone1| + |bone2| suggests. `ai/pose.js boneGeometry` derives both bones from the real C0/C1 and
  `aitest` asserts the angle is still in `rigs/builtin.json`.
- On the laptop `npm` is broken under Git Bash — use PowerShell and call `electron.cmd`
  directly. On both machines the Bash tool's working directory PERSISTS between calls.
- A killed run can leave a poisoned source file mid negative-test: restore from the backup and
  `cmp` before trusting the tree.

## 7. Decisions that are the user's, not yours

1. Adopt either evaluated architecture proposal (§4).
2. Merge `animation-intelligence` into `main` and release 0.12.0 (the README's release checklist
   includes the site sync; `site/` in the desktop checkout carries another session's superseded
   edits).
3. **Still open, and now the blocking one for authoring ergonomics:** whether a set of starting
   recipes may ship (§3, A.3) — a parameter set per action (windup angle, reach, weight shift,
   impact frame, phase proportions) whose every value opens fully editable. Slice A deliberately
   shipped none: `authorMotion` refuses to invent phase durations and asks instead. That is honest
   and it is also friction on every call. A recipe set would remove it; a pose LIBRARY as a product
   is still forbidden by the "full power" constraint.
4. Which model runs sessions, and therefore which profile the MCP is registered with (§2b).
5. Anything that costs money (Stripe, Render, RunPod, continuous runs).

## 8. End of the session

Update the matrix honestly (move only what moved; recount the header from the table by script),
append a log entry to `SHARED_TASK_NOTES.md` that a session with no memory of this one could act
on, bump and update this file in place, run everything in §5 and say what actually happened —
including flakes — then commit with a message that says what was built, what was decided and
what was deliberately not done, and push. If the slice's goal cannot be met, say so plainly in
the notes with the reason and what would unblock it, rather than moving a row to implemented.
