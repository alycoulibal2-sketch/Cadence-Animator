# Watch sessions — ten batches of the 100-video list

`WATCHLIST.md` is the whole list. It is split here into ten self-contained prompts, `W01.md` to `W10.md`,
ten videos each in the list's order, so a session can afford full frames on the videos that show motion
instead of skimming a hundred. Each session writes ONLY its own notes file (`Wnn-notes.md`) and its own
knowledge entries (`../knowledge/inbox/Wnn-*.json`), so all ten can run at the same time — on both machines —
without conflicting; each one rebases before it pushes.

## How to run one

Give a fresh session this line (the Documents copies are in `C:\Users\User\Documents\Cadence_Watch_Sessions\`):

```
Read docs/animation-intelligence/watch/W03.md in the Cadence-Animator repo (branch animation-intelligence, git fetch first) and follow it.
```

A session that runs out of context ticks what it finished and stops; the next session runs the same
prompt and continues from the first unticked video.

## The merge step (the learning-loop session, or any session after the batches)

**All ten batches are merged as of 2026-09-12** — W01+W02 on 2026-09-11, W03–W10 on 2026-09-12.
271 entries are in `knowledge/`, `knowledge/inbox/` is empty, and every one of the hundred videos is
ticked. The steps below stand for any batch the user adds later.

0. **Validate every inbox file mechanically before anything else**: it parses, it answers all 20
   Part 25 fields, its category is one of the five, and its concept is unique against the other inbox
   files AND the existing corpus AND the twelve compiled principles. The merge tool runs the two
   gates; it does not catch a duplicate between two inbox files, and reasoning about a gate is not
   running it — W09 found a real bracket mismatch (`style_variations` closed with `]`) only by
   validating all 43 of its own files in one pass.
1. Load every `knowledge/inbox/*.json` through `ai/knowledge.js`'s Part 72 gate (`validateProposedEntry`);
   a refused file is fixed or dropped with the reason written in `LESSONS.md`, never loaded as is.
2. Accepted entries move to `knowledge/` (status `experimental` until a benchmark or the user validates them).
3. Tick the watched videos in `WATCHLIST.md` from the notes files, with the date and the entries produced.
4. Append each notes file's paragraphs to `LESSONS.md` under the batch id, and collect the `check:` lines
   and capture candidates into one list at the top of `LESSONS.md` for the next building session.
5. **Hand all of `knowledge/*.json` to `registerUserEntries` afterwards** and report the counts. Moving
   a file is not the same claim as the app being able to load it; the W03–W10 merge proved 271 accepted
   / 0 refused / 12 skipped as `already_builtin` that way, and the 12 are the shipped seed
   re-presenting the compiled principles, which is correct rather than a problem.
6. A merge surfaces decisions it must not make. `category` is the live example: it is gate-legal but
   convention-bound, W09 broke the convention at scale, and the merge wrote the number down instead of
   re-categorising another session's 25 entries. Record; do not adjudicate.

## The batches

- `W01.md` — videos 1–10 — A. Fundamentals — the twelve principles — about 114 min
- `W02.md` — videos 11–20 — A. Fundamentals — the twelve principles · B. Body mechanics, weight, posing, locomotion, combat — about 121 min
- `W03.md` — videos 21–30 — B. Body mechanics, weight, posing, locomotion, combat — about 146 min
- `W04.md` — videos 31–40 — B. Body mechanics, weight, posing, locomotion, combat — about 162 min
- `W05.md` — videos 41–50 — C. Game animation talks and analysis — about 354 min
- `W06.md` — videos 51–60 — C. Game animation talks and analysis · D. Anime and stylised action — about 203 min
- `W07.md` — videos 61–70 — D. Anime and stylised action · E. Roblox and Moon Animator — about 145 min
- `W08.md` — videos 71–80 — E. Roblox and Moon Animator — about 148 min
- `W09.md` — videos 81–90 — E. Roblox and Moon Animator · F. VFX, camera and curves — about 193 min
- `W10.md` — videos 91–100 — F. VFX, camera and curves · G. Workflow, reference and critique — about 185 min
