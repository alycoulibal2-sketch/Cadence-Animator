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

1. Load every `knowledge/inbox/*.json` through `ai/knowledge.js`'s Part 72 gate (`validateProposedEntry`);
   a refused file is fixed or dropped with the reason written in `LESSONS.md`, never loaded as is.
2. Accepted entries move to `knowledge/` (status `experimental` until a benchmark or the user validates them).
3. Tick the watched videos in `WATCHLIST.md` from the notes files, with the date and the entries produced.
4. Append each notes file's paragraphs to `LESSONS.md` under the batch id, and collect the `check:` lines
   and capture candidates into one list at the top of `LESSONS.md` for the next building session.

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
