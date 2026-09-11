# Cadence Animator — the learning loop (v1, written 2026-09-11)

**Run this BEFORE `NEXT_SESSION_PROMPT.md`.** It builds the part of Cadence that makes Claude better
at animation OVER TIME while the user works: a library of real motion Claude can measure against, a
knowledge library that grows from videos Claude watches, and a lessons file every session reads.
The next-session prompt's slices then consume what this one builds.

You are a FRESH session. Read section 0, then build section 3 in order. Do not re-read the whole
directive; read only the parts a step cites.

## 0. Read this first (about ten minutes)

1. Repo: the `Cadence-Animator` checkout (desktop `C:\Users\User\CadenceAnimator`; laptop the same
   repo under `C:\Users\alyco\`). Branch `animation-intelligence`:
   `git fetch origin && git checkout animation-intelligence && git pull`. Never merge into `main`
   unless the user asks.
2. `SHARED_TASK_NOTES.md` in full, then `docs/animation-intelligence/requirements-matrix.md`, then
   `CLAUDE.md`. Their rules and "decisions worth not relitigating" apply to you.
3. Prove the tree is green before touching it:

   ```
   node test/aitest.mjs                # 359/359
   node test/coretest.mjs              #  41/41
   node test/pnxtest.mjs               # 298/298
   node tools/benchmark.mjs --compare  # clean
   ```

## 1. The goal in one sentence, and its honest boundary

**Claude gets better at animation over time because everything it watches, captures, is corrected
on, and ships is kept as measured, evidence-backed data that its tools consult — a reference
library of real motion, a knowledge library of principles with detection methods, and a lessons
file — never a trained model.**

The boundary: Claude (the model) cannot be fine-tuned by this project, and the user has no
big-name API access (a minor; other users will have none either). So "training Claude" means
growing the corpus its tools measure against and the notes every session reads. That is real
learning at the system level, consistent with the directive (Parts 36, 57, 58, 70, 72), and it is
the only kind that survives a new session. A local open-weights model trained on this library is
a possible LATER step once the library exists; it is not this session.

## 2. What already exists — verified 2026-09-11, do not rebuild it

- **Claude can already watch videos here.** The `/watch` skill is installed and configured
  (`C:\Users\User\.claude\plugins\marketplaces\claude-video\skills\watch\SKILL.md`; Whisper keys and
  `WATCH_DETAIL` are set in `~/.config/watch/.env`; `yt-dlp` and `ffmpeg` are on PATH). It downloads
  a YouTube or local video, extracts scene-aware frames, pulls the transcript, and hands Claude the
  frame paths to Read. On Windows its commands run with `python`, never `python3` (the Store stub).
  This is how Claude learns PRINCIPLES from tutorials and how it looks at a reference clip.
- **Video becomes R15 keyframes without any research model: Roblox Studio's own Animation
  Capture (Body, and Face).** Upload a video in the Animation Editor and Studio tracks the body and
  generates keyframes on the R15 rig; the editor saves them to the rig's `AnimSaves` folder.
  Read `https://create.roblox.com/docs/animation/capture` for the exact input limits (the page
  could not be fetched when this prompt was written — DNS was flaky).
- **Cadence already pulls animations out of Studio.** The bridge plugin (`plugin/CadenceBridge.lua`,
  port 35747) has `HANDLERS.listAnimSaves` and `HANDLERS.getAnimSave(rigName, animName)`, and can
  fetch a published animation by asset id (`KeyframeSequenceProvider:GetKeyframeSequenceAsync`);
  `renderer/js/io.js` imports KeyframeSequences from files, AnimSaves and the bridge. **These are UI
  flows only: there is NO MCP import tool** (the surface has `export_to_studio` and nothing that
  imports). That gap is step 3A.
- **Mixamo** offers about 2,500 free mocap animations, free to use inside projects and NOT
  redistributable as standalone files. Route: Mixamo FBX → Roblox Studio's official Animation
  Importer onto an R15 rig → `AnimSaves` → Cadence. Do not build on the RoMixamo plugin (its free
  tier cannot export, the paid tier costs money, and it was once removed from the Creator Store).
- **Research pose models are out.** GVHMR's licence is "educational, research and non-profit
  purposes only" (verified); WHAM and TRAM are the same family of licence. Cadence Pro is sold,
  so none of them may sit in the product. RTMW3D (Apache 2.0) outputs keypoints, not joint
  rotations, and is not needed while Roblox's capture exists.
- **In the semantic layer already:** Part 36 reference profiles (`ai/reference.js` — in-project
  items only), Part 57/58 memory (`ai/memory.js` — per project, no cross-project store, a NAMED
  limitation), Part 25/72 knowledge (`ai/knowledge.js` — 12 hard-coded cards, `EXPANSION_PROCEDURE`
  and the `validateProposedEntry` shape gate), Part 59 benchmarks (`ai/benchmark.js`).

## 3. Build, in this order — each step verified before the next

### A. The cross-project LIBRARY store (everything else needs it)

The one thing every "learn with time" feature was blocked on is that nothing persists outside one
`.cadence` file. Build the store:

- Location: the app's user-data folder (Electron `app.getPath('userData')`, the same place
  `settings.json` and autosaves live), subfolder `library/`: `index.json` plus one `.cadence` file
  and one profile JSON per entry. **Never inside the repo, and gitignored if a dev path is used** —
  Mixamo clips may not be redistributed, and the user's own captures are theirs.
- Entry shape = Part 70's field list, all of it: library id, semantic description, intent tags,
  style tags, compatible rigs, technical implementation, parameters, dependencies, performance
  cost, preview media, acceptance tests, baseline examples, known failure cases, version,
  provenance, licence/ownership. Provenance `kind` is one of `captured` (Roblox Animation Capture —
  **an estimate, and labelled so**, with the source video URL and timestamps), `mocap` (Mixamo,
  with the licence note), `authored` (the user's own accepted shot), `imported` (a file). Every
  entry carries the Part 36 profile `ai/reference.js` builds, plus `action_type` and the measured
  characteristics search uses.
- Pure module `renderer/js/ai/library.js`: the index shape and its validation, `search` (by action
  type, tags, style, and profile distance — reuse the numeric-profile distance the
  `reference_adaptation` benchmark already computes), `nearest`, and `libraryLimitations()`. It
  reads no files: `src/main.js` owns the folder through IPC, the same way autosave does.
- MCP tools, BOTH halves (`renderer/js/app.js MCP_HANDLERS` + `mcp-server/index.js`), each
  opening with `READ-ONLY.` / `MUTATING …`:
  - `import_from_studio` — list a rig's `AnimSaves` through the bridge, or pull one named animation
    (or an asset id) into the project as a rig item whose role is `reference`; never onto the user's
    working rig.
  - `import_animation_file` — a KeyframeSequence / AnimSaves `.rbxm`/`.rbxmx`, same result.
  - `add_to_library` — from an item: builds the profile, takes tags, action type, provenance and
    licence from the caller (nothing infers a licence), writes the entry.
  - `search_library` / `load_from_library` — find by action, tags, style or "closest to this item",
    and load an entry as a reference item.
  - `accept_shot` — Part 58's learning from accepted work as a tool: records `recordAcceptedWork`,
    offers (never forces) `add_to_library` with provenance `authored`, and appends a one-paragraph
    lesson (see D). Rejections go through `recordFailedApproach` the same way.

### B. The knowledge library on disk

- Export the 12 cards to `docs/animation-intelligence/knowledge/*.json` as the seed, and load a
  user folder `library/knowledge/*.json` at startup through Part 72's gate
  (`validateProposedEntry`) so a malformed entry is refused with the field that failed.
- `propose_knowledge_entry` (MCP, both halves): a full Part 25 entry with `evidence_status:
  experimental` until a benchmark or the user validates it; evidence must name its source (a video
  URL and timestamp, a directive part, a measured project). Nothing here is applied to any
  animation — it is knowledge a planner or a review may cite.
- Where an entry's `detection_and_measurement_methods` names a measurement that exists in
  `ai/motion.js`, wire it as a check the review can run; where it does not, the entry says
  `not measured` — never a fake check.

### C. The WATCH-AND-LEARN procedure (a skill)

Write `.claude/skills/cadence-learn/SKILL.md` (register it in the README), the procedure a session
follows for one video:

1. `/watch <url>` (frames + transcript). Read the frames.
2. Write what the video TEACHES as knowledge entries through `propose_knowledge_entry`, with the
   timestamp as evidence — principles, timing rules of thumb, failure patterns. Not summaries: an
   entry must say when the technique applies, when it does not, and how it could be measured.
3. If the video SHOWS a motion worth having as a reference, write the user the exact Studio click
   path (Animation Editor → Capture → Body → the video → save to AnimSaves), then
   `import_from_studio` and `add_to_library` with the source URL, `captured` provenance and the
   label "estimated by Roblox Animation Capture".
4. Append one dated paragraph to `docs/animation-intelligence/LESSONS.md`: what was learned, the
   evidence, and what changed in the library or the knowledge folder. Every later session reads
   this file (add it to §0 of both prompts).

Also create `docs/animation-intelligence/WATCHLIST.md`: search for the best sources — the twelve
principles taught for 3D, attack and hit-reaction breakdowns, body mechanics and weight, Roblox and
Moon Animator tutorials, game-feel talks — list them with what each is expected to teach, and mark
each one watched with the date and the entries it produced. The user adds links to this file too.

### D. The first corpus (the user does the clicks; you write the instructions and wait)

Seed the library with at least ten Mixamo clips that cover Part 59's categories (idle, walk, run,
jump and landing, turn, dodge, heavy attack, light attack, hit reaction, sword swing) and at least
three captured clips from videos the user chooses. Profile every one. Write the step-by-step for
Mixamo download settings and the Studio importer, and for Animation Capture, then stop and ask;
do not invent a corpus.

### E. Measure it

- `aitest`: `ai/library.js` (index validation, search, distance, a refused entry) and the knowledge
  loader (a malformed file is refused by name); every new module in the purity list.
- A benchmark `library_search` in `ai/benchmark.js` (a second "reference adaptation" benchmark):
  with a SEEDED synthetic index (built from the existing fixtures so the benchmark never depends on
  the user's library), the nearest entry for each action type is the right one — measured as
  `reference_alignment` and a `correct_causal_diagnosis_rate`-style hit rate. Re-write the baseline.
- Smoketest step: import from a fixture AnimSaves `.rbxm` (put one under `test/fixtures/`), add it
  to a TEMP library folder, search it, load it as a reference item, and prove the user's rig and
  tracks are byte-identical apart from the reference item.

### F. Matrix and notes

Rows this moves: `REF-001` (three more reference kinds: captured video via Studio, mocap, files),
`LIB-001` (a motion library with Part 70's fields — from "effects only"), `MEM-001/003/004` (the
cross-project store the notes named as missing), `KNW-001/006` (entries beyond the twelve; the
expansion procedure now writes entries), `MCP-010` (`record_user_correction` gets its accepted-work
sibling). Recount the header. Append a log entry to `SHARED_TASK_NOTES.md`. Bump this prompt.

## 4. Rules (the repo's, plus this session's own)

- Everything in `CLAUDE.md` and the notes: `ai/**` pure at load, `coverage.notRun` on every result,
  both halves of every MCP tool, negative-test every regression test, no feature shells.
- **Estimated data is labelled estimated.** A clip from Animation Capture is a pose-estimation
  result; its profile is advisory (Part 36) and its provenance says so. Nothing labels it exact.
- **The library is per user, outside the repo, never committed.** Mixamo's terms forbid
  redistribution; the user's captures are the user's.
- **Nothing learned is applied automatically** (Parts 57, 62): a library entry is loaded when asked,
  a knowledge entry is cited, a preference candidate is reviewed by a person.
- **No trained model, no paid API, no purchases.** If a step seems to need one, stop and say so.
- The user's clicks are the user's: Studio capture, Mixamo downloads, licence choices. Write the
  instructions, then wait.
- Never adopt an evaluated architecture proposal (two are waiting for the user — see the notes).
- Never stage `site/` or the stray root files; `git add` your files by name.

## 5. Verification, every time

The four headless checks in §0, then the Electron smoketest from PowerShell:

```powershell
Remove-Item test-output/userdata -Recurse -Force -ErrorAction SilentlyContinue
.\node_modules\.bin\electron.cmd . --disable-backgrounding-occluded-windows `
  --disable-renderer-backgrounding --disable-background-timer-throttling `
  --user-data-dir=test-output/userdata --screenshot=test-output/smoketest.png `
  --demo-js-file=test/smoketest.js
# results: test-output/smoketest-report.json
```

Two steps flake and are documented in the notes (*classic clothing* on the Roblox CDN — grep the
log for `ENOTFOUND`; *observation: baseline → scoped edit*, a GPU pixel comparison). Never dismiss
a failure in a step your change touched.

## 6. Traps specific to this work

- **The app must be running for the bridge and the MCP.** The Studio plugin talks to
  `127.0.0.1:35747`; the MCP shim to `:35748`. The MCP client can show "Connected" while the app is
  closed — that is the shim, not the app.
- **The bridge already defines the animation shape**: `neutralAnimFromInstance` in the plugin and
  the importer in `renderer/js/io.js`. Read both before inventing a second format.
- **`python` on Windows, never `python3`** for the watch skill; DNS on this machine drops
  intermittently and reads exactly like a tool failure (`ENOTFOUND`, `ETIMEOUT`) — retry.
- **A contact effector is a role phrase (`'left foot'`), never a part name** — the constraint target
  silently fails to resolve otherwise (see CLAUDE.md).
- **Mixamo clips are human-proportioned**; Studio's importer retargets onto R15, and the result is
  still a retarget — profile it, do not assume its contacts are clean (measure them).
- On the laptop `npm` is broken under Git Bash — PowerShell and `electron.cmd` directly.

## 7. Decisions that are the user's

1. Which videos to watch and which clips to capture (§3C, §3D).
2. Anything that costs money — the answer is no unless the user says otherwise.
3. Whether captured (estimated) clips may serve as references for the director's loop in the next
   prompt — default yes, labelled.

## 8. End of the session

Update the matrix honestly, append to `SHARED_TASK_NOTES.md` and `LESSONS.md`, bump this prompt in
place, run §5 and say what actually happened, commit with a message that says what was built and
what was deliberately not done, push. Then tell the user to give the next session
`NEXT_SESSION_PROMPT.md`.
