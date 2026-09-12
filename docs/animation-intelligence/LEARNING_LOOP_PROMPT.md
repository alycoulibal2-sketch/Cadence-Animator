# Cadence Animator — the learning loop (v3, written 2026-09-11, updated 2026-09-12 after the W03–W10 merge)

> **v1 is BUILT.** Sections 3A, 3B, 3C and 3E landed on `animation-intelligence` on 2026-09-11:
> the cross-project library (`renderer/js/ai/library.js`, seven MCP tools, the IPC half in
> `src/main.js`), knowledge on disk behind both Part 72 gates, the `cadence-learn` skill, the
> `library_search` benchmark, and the W01 merge (19 entries). Read the log entry at the bottom of
> `SHARED_TASK_NOTES.md` before touching any of it.
>
> **What is left in this prompt is §3D — the first corpus — and it is the USER's, not a
> session's.** `docs/animation-intelligence/CORPUS.md` is the step-by-step (Mixamo download
> settings, the Studio importer, Animation Capture's verified limits, and the three decisions
> that are theirs). The library is empty until somebody does those clicks; a session that invents
> a corpus instead has invented data.
>
> **The merge is DONE, and so is the watch list (2026-09-12).** All ten batches W01–W10 are watched,
> ticked and merged: 271 entries in `docs/animation-intelligence/knowledge/`, `knowledge/inbox/`
> empty, 81 checks and 9 capture candidates in `LESSONS.md`. The merge procedure stays documented in
> `watch/README.md` for any future batch the user adds at the bottom of `WATCHLIST.md`:
> `node tools/merge-knowledge-inbox.mjs --batch Wnn` — always name the batch, because several watch
> sessions run at once and merging a live inbox takes files out from under a session still writing
> them. Validate every file mechanically before the commit (parses, 20 fields, valid category, no
> duplicate concept); W09 caught a real bracket mismatch that way that per-entry review had missed.
>
> **One thing the merge could not decide and left for the user**: `category: "essential"` meant the
> twelve compiled classical principles through W08, then W09 wrote 25 entries claiming it, so
> `listKnowledge({ category: 'essential' })` now returns 37 rather than the canon. Enforce the
> convention or drop it — both costs are in `LESSONS.md`.

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
   Then **`docs/animation-intelligence/LESSONS.md`** — what the watch batches have taught so far,
   the queue of measurements worth building, and the queue of motions worth capturing. It is the
   shortest path to "what does this system already know".
3. Prove the tree is green before touching it:

   ```
   node test/aitest.mjs                # 390/390
   node test/coretest.mjs              #  41/41
   node test/pnxtest.mjs               # 298/298
   node tools/benchmark.mjs --compare  # clean (66 cells)
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
  The limits, **verified against that page on 2026-09-11** (the v1 prompt could not reach it):
  body capture takes an `.mp4` or `.mov` **under 15 seconds**, "just one person who is well-lit
  and visible throughout", "a continuous single shot… from a stable camera", onto **R15 rigs**,
  with keyframes appearing "after about a minute"; face capture takes up to 60 seconds onto
  "animation compatible heads". Roblox states no accuracy figure, which is exactly why every entry
  made this way is stored as an estimate. The full click path is in `CORPUS.md`.
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

**DONE 2026-09-12 — all 100 videos watched and all ten batches merged.** The list, the ten batch
prompts, the skill, the loader and the merge tool all exist and have now been run end to end: 271
entries in `knowledge/`, an empty inbox, 100/100 ticked, 81 checks and 9 capture candidates in
`LESSONS.md`. The procedure below stands for any batch the user adds later.

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

**The watch list is already seeded and already split into sessions**:
`docs/animation-intelligence/WATCHLIST.md` holds 100 real videos (found with `yt-dlp` on
2026-09-11, listed again in the appendix of this prompt), and `docs/animation-intelligence/watch/`
holds ten self-contained session prompts, `W01.md` to `W10.md`, ten videos each. **The watching is
NOT this session's job** — the user gives each `Wnn.md` to its own fresh session, several at once,
so every video that shows motion gets full frames. Each watch session writes only its own notes
file and its own `knowledge/inbox/Wnn-*.json` entries. **This session's job is the MERGE** (the
steps in `watch/README.md`): load every inbox entry through Part 72's gate, move the accepted ones
into `knowledge/`, tick the watched videos in `WATCHLIST.md`, and append the notes' paragraphs,
`check:` lines and capture candidates to `LESSONS.md`. If no batch has run yet, build the loader
and the skill anyway; the inbox may be empty. Links the user adds at the bottom of `WATCHLIST.md`
are watched first by whichever batch runs next.

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

1. Which videos to watch and which clips to capture (§3C, §3D). **Still open** — the capture queue
   in `LESSONS.md` has seven candidates with exact timestamps, and `CORPUS.md` is the click path.
2. Anything that costs money — the answer is no unless the user says otherwise.
3. Whether captured (estimated) clips may serve as references for the director's loop in the next
   prompt. **ANSWERED 2026-09-11: yes, labelled.** A captured clip is a reference like any other,
   and every result that touches one carries `estimated: true` and its source video through to the
   caller — `add_to_library` refuses an entry that claims otherwise, `search_library` and
   `load_from_library` both flag it, and its Part 36 profile is advisory twice over. The director's
   loop may compare against one; it may never present a measurement taken from one as a fact about
   the performer in the video.

## 8. End of the session

Update the matrix honestly, append to `SHARED_TASK_NOTES.md` and `LESSONS.md`, bump this prompt in
place, run §5 and say what actually happened, commit with a message that says what was built and
what was deliberately not done, push. Then tell the user to give the next session
`NEXT_SESSION_PROMPT.md`.

**As of 2026-09-12 the only step of this prompt still open is §3D, the first corpus, and it is the
USER's clicks** (`CORPUS.md`, plus the 9 capture candidates in `LESSONS.md`). Everything else here is
built and has been run. A session handed this prompt now should read `LESSONS.md` and take a queued
check — check #10 is the user's standing choice, and #64, #79, #73 and #38 are the strongest of the
51 that arrived with the W03–W10 merge — rather than re-reading §3A–§3E as work to do.

## Appendix — the 100 videos (also in WATCHLIST.md, which is the file you tick)

### A. Fundamentals — the twelve principles (16)
1. 12 Principles of Animation (Official Full Series) — AlanBeckerTutorials (24:03) — https://youtu.be/uDqjIdI4bF4
2. TIMING - The 12 Principles of Animation in Games — New Frame Plus (9:38) — https://youtu.be/rHEJZXvFc5I
3. ANTICIPATION - The 12 Principles of Animation in Games — New Frame Plus (7:52) — https://youtu.be/28s1Hv3Zqlo
4. SQUASH & STRETCH - The 12 Principles of Animation in Games — New Frame Plus (8:19) — https://youtu.be/1kFRU_xBZnE
5. SLOW IN & SLOW OUT - The 12 Principles of Animation in Games — New Frame Plus (7:24) — https://youtu.be/3jNiNctcQ4c
6. ARCS - The 12 Principles of Animation in Games — New Frame Plus (7:47) — https://youtu.be/lOzgxMgAnxQ
7. FOLLOW THROUGH & OVERLAPPING ACTION - The 12 Principles of Animation in Games — New Frame Plus (16:53) — https://youtu.be/rYtrV1lChsA
8. The most important animation principle: An introduction on animation spacing and timing — Dong Chang (11:04) — https://youtu.be/vSJ5lT_ma-E
9. 3 Easy Ways to Master Animation Timing — Dong Chang (13:58) — https://youtu.be/13QIh7vsCpQ
10. Animation basics: The art of timing and spacing - TED-Ed — TED-Ed (6:42) — https://youtu.be/KRVhtMxQWRs
11. The #1 Animation Principle (How To In-Between) — NobleFrugal Studio (12:41) — https://youtu.be/6UXjRCORV44
12. Animation Principles / Everything Moves in Arcs / Animating Classic Motion — Russ Edmonds Animation (10:31) — https://youtu.be/thDT-4RjAeo
13. Animating with Arcs — The Art of Aaron Blaise (6:03) — https://youtu.be/GHf8ie4Nq9Y
14. 12 Principles of Animation - Follow Through and Overlapping Action Tutorial — Arree Chung (19:54) — https://youtu.be/t_gH-OADlSw
15. Should you PLAN your animation? — Alex Grigg // Animation for Anyone (5:01) — https://youtu.be/ABCUjauQBI4
16. Easy animation with overshoot and anticipation - Blender Tutorial — Joey Carlino (10:27) — https://youtu.be/DLzcSSzVjeI
### B. Body mechanics, weight, posing, locomotion, combat (24)
17. Body Mechanics - Maya Beginner's Animation Tutorial | In 5 simple steps — Learn CGI with Yawyee (23:22) — https://youtu.be/7CBcvu8HLEQ
18. 3 Coco Animation Tips [On Body Mechanics] — Rusty Animator (10:26) — https://youtu.be/fFf8EsPC_ws
19. Animating HEAVY Weight (Objects, Punches, Throwing) — Sir Wade Neistadt (10:16) — https://youtu.be/ZYKAMCZq2UI
20. Weight in Animation (Tutorial) — Alessandro Camporota (12:39) — https://youtu.be/b3oIxjzdMqY
21. James Baxter on Weight and Balance — The SPA Studios (3:07) — https://youtu.be/EASbvJNQz0U
22. How to Animate Weight — AnimSchool (8:32) — https://youtu.be/0x9f21vFqcE
23. How to use Line of Action for Better Poses — Character Design 360 (6:06) — https://youtu.be/P_BY38z-n4M
24. Improve Your Animation! Good Posing vs Bad Posing | Animation Techniques — Foxy Fern Animation (9:07) — https://youtu.be/QCHSPSBmSHk
25. Create BETTER animations using SILHOUETTES — Start Animating (10:12) — https://youtu.be/uwK0DFEbcCk
26. Animating LEGS (Walk Cycles and Weight) — Doodley (11:25) — https://youtu.be/6lGPvMLE8Oo
27. how to animate a walk cycle (100% polish) — Alessandro Camporota (32:40) — https://youtu.be/ynXadXE9UjU
28. ALAN BECKER - Animating Walk Cycles — AlanBeckerTutorials (3:53) — https://youtu.be/2y6aVz0Acx0
29. The COMPLETE Guide to Run Cycle Animation — owenferny (49:04) — https://youtu.be/7NkvAP3aqeo
30. How to Animate Run Cycles — moderndayjames (11:41) — https://youtu.be/nKvBYXzRszw
31. Jump Animation: The Complete Beginner's Guide — Plainly Simple (16:15) — https://youtu.be/n29cFugfM_c
32. Body Mechanics: Jumping and Landing — Animation Mentor (11:02) — https://youtu.be/VjRCxm8nrNE
33. How To Improve Idle Animations In Games — Libby Pete (6:11) — https://youtu.be/tYwNSm8Q3l8
34. Punch Tutorial — Greg Marlow Learning (11:45) — https://youtu.be/tcBT-6wdSC8
35. How to Animate Fight Scenes (Part 1): Punches — Besty Animates (6:02) — https://youtu.be/4uvQytZ3DmA
36. Fisticuffs: Tips for animating action and fight scenes — Dong Chang (6:07) — https://youtu.be/-HXx1fK415I
37. How to ANIMATE SWORD COMBAT Part 1 — Gogan (77:15) — https://youtu.be/sBNDzqO8ZT8
38. How to Animate a Sword Fight: Full Creative Process — Winged Canvas (15:40) — https://youtu.be/ZTH3meW3o4E
39. Breaking Down Attack Animations [Animation] — Masahiro Sakurai on Creating Games (3:35) — https://youtu.be/LewXWM7HDd8
40. Animation vs Choreography — Honored Clarity (8:03) — https://youtu.be/xlfcZ2B8Vvs
### C. Game animation talks and analysis (18)
41. Animation Bootcamp: An Indie Approach to Procedural Animation — GDC (26:13) — https://youtu.be/LNidsMesxSE
42. Animation Bootcamp: 2018 Tricks of the Trade — GDC (31:10) — https://youtu.be/o1tti636Kag
43. Animation Bootcamp: The First Person Animation of Overwatch — GDC (34:03) — https://youtu.be/7t0hLZd_8Z4
44. How Overwatch Conveys Character in First Person — New Frame Plus (15:32) — https://youtu.be/7Dga-UqdBR8
45. Animation Bootcamp: Animating Cameras for Games — GDC (26:26) — https://youtu.be/hP1Vz70WouE
46. Animation Bootcamp: Script to Screen: The Development Diary of Marvel's Spider-Man — GDC (31:13) — https://youtu.be/r_rJJyIPrmM
47. Evolving Combat in 'God of War' for a New Perspective — GDC (59:52) — https://youtu.be/hE5tWF-Ou2k
48. Keyframes and Cardboard Props: The Cinematic Process Behind 'God of War' — GDC (54:01) — https://youtu.be/MNinZWlhprE
49. Unsynced: The Last of Us Melee System — GDC (54:20) — https://youtu.be/Ox2H3kUQByo
50. Making Fluid and Powerful Animations For 'Skullgirls' — GDC (21:06) — https://youtu.be/Mw0h9WmBlsw
51. GuiltyGearXrd's Art Style : The X Factor Between 2D and 3D — GDC (58:59) — https://youtu.be/yhGjCzxJV3E
52. The Animation of Guilty Gear Xrd & Dragon Ball FighterZ — New Frame Plus (17:21) — https://youtu.be/kZsboyfs-L4
53. How to Animate a Smash Bros Character // MARIO — New Frame Plus (12:59) — https://youtu.be/NHwnTm5o1kc
54. The Overanimation of Zenless Zone Zero — New Frame Plus (24:03) — https://youtu.be/1yH4Qz23FqM
55. The Brilliant Animation in Metroid Dread — Video Game Animation Study (38:26) — https://youtu.be/1B1beXTnvEI
56. The Animation of Cuphead — Video Game Animation Study (10:57) — https://youtu.be/pOBKGcehi8U
57. How 2D Fighter Games are Animated — Video Game Animation Study (7:13) — https://youtu.be/WYCjmVhiLaM
58. The Effects Animation of Hollow Knight — New Frame Plus (7:19) — https://youtu.be/SIJtfr-PO4Y
### D. Anime and stylised action (8)
59. How to add IMPACT frames to your animation — Howard Wimshurst Animation (18:42) — https://youtu.be/6UaUi5fBmJc
60. Animate action with SMEAR FRAMES — Kuzillon (6:37) — https://youtu.be/5v0IZSr9-j0
61. Types of Frames in Animation — NobleFrugal Studio (9:53) — https://youtu.be/EMXSFQ4pdUM — keys, extremes, breakdowns, in-betweens, smears, holds
62. Every (Anime) Animation Technique Explained in 12 Minutes — SinChi (13:01) — https://youtu.be/iMV9Tlpo1wY
63. The Art of Animators (or Sakuga) — RCAnime (7:44) — https://youtu.be/-aChpK2jcnQ
64. Sakuga OVERKILL! | Animation Analysis: Stark vs Dragon — MankoMan (25:12) — https://youtu.be/ibavOZYfsnQ
65. I Spent 30 Days ANIMATING this FIGHT SCENE!! — Shrimpy (16:31) — https://youtu.be/OVPfRoIP69Q
66. PWOW Workshop - Introduction to Animation Breakdowns — Toniko Pantoja (16:25) — https://youtu.be/wdPbiy-8BRo
### E. Roblox and Moon Animator (18)
67. Moon Animator 2 Basics - Official Tutorial — six (4:41) — https://youtu.be/q8tGNMo_jHg
68. Roblox ANIMATION Guide #1 - Moon Animator (2026) — Nisky (12:07) — https://youtu.be/267aFypaeWU
69. Roblox Animation in Blender: Full Beginner Guide [2026] — Nisky (7:46) — https://youtu.be/eg6COxaPCyo
70. Roblox Animation in Blender: Advanced Guide (2026) — Nisky (31:26) — https://youtu.be/EM9u4gIHoRg
71. How I Animate: An Unofficial Moon Animator 2 Tutorial — Tycoon (45:46) — https://youtu.be/Yzf3iGZis7A
72. How to Animate in ROBLOX the RIGHT way [NEW] {Tutorial} — DatBoiEle (10:47) — https://youtu.be/dqAAa9aubM8
73. How to Make SUPER SMOOTH Roblox Animations with Moon Animator 2! | Beginner to Pro Tutorial — TnxBlox (16:56) — https://youtu.be/EAW6F6PnW0w
74. 3 Must-Know Moon Animator 2 TIPS for Better Roblox Animations — TnxBlox (2:41) — https://youtu.be/xQHlThYcgz4
75. Make Your Roblox Animations Feel REAL | Roblox Animation Tips 2026 — Devgrams and Draco (8:53) — https://youtu.be/AH30avEEC9A
76. How to Animate a Sword Slash [Moon Animator] — Thundey (24:36) — https://youtu.be/KneO6y3FebM
77. How to ANIMATE a Perfect Sword Swing in Roblox Studio! (EASY) — Nobel Courses (8:01) — https://youtu.be/I1T5Rcm9g3E
78. How to make WEAPON animations in ROBLOX STUDIO! [Moon Animator Tutorial] — MonkeyDev (11:29) — https://youtu.be/UURYhAVph5g
79. How to ANIMATE Tools In Roblox Studio! — Rustysillyband (11:24) — https://youtu.be/nKC3-pAtN5g
80. ROBLOX VFX Guide #1 - Particles — TrendyV2 (7:14) — https://youtu.be/xzZeP65SSlA
81. How to ACTUALLY Use VFX in Roblox — Develuper (9:24) — https://youtu.be/TkNZETIu0CM
82. How to Learn Roblox Aura VFX in 1 Hour — Twist VFX (41:47) — https://youtu.be/u2o-wHKDlpw
83. How to make Cutscenes in Roblox Studio (Camera-Movement/Animations/VFX/Subtitles) — Jayyy (3:49) — https://youtu.be/APfRtdLkcYc
84. How To Make Animated Character Cutscenes in Roblox Studio — RKGAM3ZS (15:42) — https://youtu.be/cd3fnYN2BQs — animation, camera and events in one shot
### F. VFX, camera and curves (9)
85. The BEST way to learn FX Animation? — Alex Grigg // Animation for Anyone (15:51) — https://youtu.be/VjAbB9492VA
86. #5: Timing | Artistic Principles of VFX — VFX Apprentice (23:10) — https://youtu.be/WLMVpcK0WvA
87. Ultimate Guide to Camera Movement — Every Camera Movement Technique Explained — StudioBinder (29:09) — https://youtu.be/IiyBo-qLDeM
88. 7 Rules of Cinematic Framing and Composition — Kellan Reck (9:29) — https://youtu.be/MYlgj1hwcYw
89. Animate Cameras like a Pro (Blender Tutorial) — CG Boost (23:10) — https://youtu.be/COwENnPwWJ8
90. How to Animate with the Graph Editor — Sir Wade Neistadt (21:04) — https://youtu.be/RQ31vjgJM2c
91. How to use Blender's Graph Editor like a Professional Animator — BrianKouhi (15:53) — https://youtu.be/vKgO3NsYORo
92. Animating ARMS (FK vs. IK) - Doodley — Doodley (11:28) — https://youtu.be/JnkAlwMjalc
93. FK and IK Explained - Which One to Use and When? — Miloš Černý Animation (7:47) — https://youtu.be/0a9qIj7kwiA
### G. Workflow, reference and critique (7)
94. The Ultimate Animation Workflow for Beginners — Chester Sampson (12:59) — https://youtu.be/v71G6TCw_0M
95. Animation Power Tips - When to go from BLOCKING to SPLINE — Harvey Newman (20:24) — https://youtu.be/TIBzcsOt2FU
96. Why Your Stepped Animation Sucks in Spline — Sir Wade Neistadt (8:59) — https://youtu.be/KSRZg7PwgyU
97. Tips for Polishing Animation from a Disney Animator — Sir Wade Neistadt (22:09) — https://youtu.be/ujo7aHa7DGQ
98. Animation Critique: How To Instantly Improve Your Blender Animation With Easy Tricks — CG Cookie (35:55) — https://youtu.be/r_wQmGKUdZ4
99. How to use video reference for Animation — Chester Sampson (11:40) — https://youtu.be/UkWnwHwMapQ
100. The COMPLETE Guide to Reference for Feature Animation — owenferny (38:06) — https://youtu.be/TaiJauNiKH4
