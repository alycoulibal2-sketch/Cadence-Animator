---
name: cadence-learn
description: Watch one animation video and turn it into durable, evidence-backed data Cadence can use — knowledge entries through Part 72's gate, a capture candidate when the video shows a real motion worth having as a reference, and a dated lesson. Use when the user gives a video URL to learn from, when working through docs/animation-intelligence/WATCHLIST.md, or when a session is told to run a Wnn.md watch batch.
---

# Watch and learn — one video

This is how Cadence gets better at animation over time. Not by training a model: by growing the
corpus its tools measure against and the notes every session reads. Everything this procedure
produces is measured, sourced, and refusable.

Read `docs/animation-intelligence/watch/README.md` first if you are running a numbered batch
(`W01.md`–`W10.md`); it owns the batch protocol and the merge. This file is the per-video loop.

## Before you start

- The app does not need to be running to write knowledge entries. It DOES need to be running for
  `propose_knowledge_entry`, `import_from_studio` or anything else over MCP — the Studio bridge is
  `127.0.0.1:35747` and the MCP shim `:35748`, and **the shim reports "Connected" while the app is
  closed**. A batch session normally writes JSON files into
  `docs/animation-intelligence/knowledge/inbox/` directly and never touches MCP at all.
- On Windows the `/watch` skill runs `python`, never `python3` (the Store stub). DNS on this
  machine drops intermittently and reads exactly like a tool failure (`ENOTFOUND`, `ETIMEDOUT`) —
  retry once before concluding anything.

## The loop

### 1. Watch it

```
/watch <url>
```

It downloads the video, extracts scene-aware frames and pulls the transcript. **Read the frames.**
A transcript alone tells you what someone said about animation; the frames are the only way to see
what they showed. For a video that demonstrates motion, that difference is the whole value.

### 2. Write what it TEACHES, as knowledge entries

One JSON file per technique, in Part 25's twenty-field shape, at
`docs/animation-intelligence/knowledge/inbox/Wnn-<video>-<slug>.json`. Copy the shape from any
entry already in `docs/animation-intelligence/knowledge/`.

An entry is not a summary. It has to say:

- **when the technique applies** (`use_cases`) and **when it does not** (`non_use_cases`) — an
  entry with no non-use case has not been thought about yet;
- **how it could be measured** (`detection_and_measurement_methods`) — and if nothing in this
  build can measure it, say *none, and why*. Never "TBD": the gate refuses placeholders;
- **where it lives in Cadence** (`cadence_representation`), or the honest statement that it does
  not.

Two gates run on the way in, and both refuse rather than storing something partial:

| Gate | What it checks |
| --- | --- |
| `validateProposedEntry` | every Part 25 field answered, a real category, no placeholder text |
| `validateEvidenceSource` | `evidence_status` names a URL **with a timestamp**, a directive part, or a measurement this build made |

Check your file before committing it:

```
node -e "import('./renderer/js/ai/knowledge.js').then(async K => {
  const e = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
  console.log(K.validateProposedEntry(e), K.validateEvidenceSource(e));
})" docs/animation-intelligence/knowledge/inbox/W03-21-your-entry.json
```

**A concept name that already exists is refused, not merged.** The twelve classical principles are
compiled into `ai/knowledge.js` and may not be shadowed; a project-specific exception to one
belongs in `ai/memory.js`'s `project_conventions`, scoped and evidenced. If a video confirms an
existing card rather than adding to it, that goes in the notes as a **cross-check**, not as a new
entry — and a confirmation is worth writing down, because it is evidence the card is right.

**If the entry names a measurement `ai/motion.js` already makes, add `measurement_keys`.** That one
optional field is what turns prose into a check `review_shot` actually runs (see `MEASUREMENTS` in
`renderer/js/ai/motion.js` for the list — `linear_velocity`, `path_curvature`, `key_density`,
`relation_to_motion_graph_parent` and the rest). Without it the entry is still useful and still
cited; it is just never measured, and the result says so.

### 3. If the video SHOWS a motion worth having, write a capture candidate

Cadence cannot look at a video. **Roblox Studio can**, and that is the whole route:

> Animation Editor → **Capture** → **Body** → choose the video → Studio tracks it and generates
> keyframes on the R15 rig → save → the clip lands in the rig's `AnimSaves` folder.

That is a click path for the USER, not something a session performs. Write the candidate into the
notes with the exact timestamps and why the motion is worth having:

```
capture: <what the motion is> — video N @ mm:ss–mm:ss — <what makes it worth a reference>
```

Then, once the user has done it, a session runs `import_from_studio` (it lists AnimSaves when
called with no arguments) and `add_to_library`.

**A captured clip is an ESTIMATE and is labelled one, permanently.** Its provenance is
`kind: "captured"`, `estimated: true`, with `source_video_url`, `source_timestamps` and
`estimated_by`. `add_to_library` refuses an entry that claims otherwise. Every number measured from
it is a measurement of Roblox's pose estimate, not of the performer.

**Its licence is yours to declare and is never inferred.** A clip estimated from somebody else's
video is a reference for your own work, not redistributable material — say so in
`licenseOrOwnership.terms` and set `redistributable: false`.

Most videos have no capture candidate at all. A 2D drawn demonstration, archival footage, or a
screen recording of software has no 3D motion to track. Write "none" and why.

### 4. Append one dated paragraph to LESSONS.md

`docs/animation-intelligence/LESSONS.md` — what was learned, the evidence, and what changed in the
library or the knowledge folder. Every later session reads this file before starting.

If a `check:` line came out of the video (a measurement this build could make and does not), put it
in the checks list at the top of `LESSONS.md` rather than burying it in a paragraph. That list is
the queue a building session picks from.

## The rules this procedure holds itself to

- **Nothing learned is applied automatically.** A knowledge entry is cited, a library clip is
  loaded when asked, a preference candidate is reviewed by a person. Parts 57 and 62.
- **Estimated data is labelled estimated**, every time it is stored and every time it is returned.
- **The library is per user and outside the repo.** It lives in the app's user-data folder.
  Mixamo's terms forbid redistributing its clips as files; the user's captures are the user's.
- **No paid API, no purchases, no trained model.** If a step seems to need one, stop and say so.
- **The user's clicks are the user's**: Studio capture, Mixamo downloads, licence decisions. Write
  the instructions, then wait.
- **A video that contradicts an existing card is the most valuable result of the whole batch.**
  Do not resolve it yourself: write both claims, both sources, and leave it for the user.

## What this produces, and where it ends up

| Output | Written to | Consumed by |
| --- | --- | --- |
| knowledge entry | `knowledge/inbox/Wnn-*.json` → merged into `knowledge/` | `animation_knowledge`, `review_shot`'s `knowledge_checks` |
| capture candidate | the batch's `Wnn-notes.md`, collected into `LESSONS.md` | the user, then `import_from_studio` + `add_to_library` |
| `check:` line | the list at the top of `LESSONS.md` | the next building session |
| cross-check / contradiction | `Wnn-notes.md` | the merge session, and the user |

The merge (`node tools/merge-knowledge-inbox.mjs --batch Wnn`) moves accepted entries up into the
corpus and leaves refused ones in the inbox with the reason. **Only merge a batch that has
finished** — several watch sessions run at once, and merging a live inbox takes files out from
under the session still writing them.
