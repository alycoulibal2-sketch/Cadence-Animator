# Seeding the first corpus — what only you can do

The library is built (`renderer/js/ai/library.js`, seven MCP tools, §3A of
`LEARNING_LOOP_PROMPT.md`). It is empty, and it stays empty until somebody does the clicks. Those
clicks are yours: they involve your Adobe account, your licence decisions, and Roblox Studio's own
UI, and a session guessing at any of the three would record a guess as a fact forever.

This file is the step-by-step. Nothing here costs money. Work through as much of it as you want —
every clip helps on its own, and the target below is a target, not a prerequisite.

**The app must be running** for any of the `import_*` / `add_to_library` steps: the Studio plugin
talks to `127.0.0.1:35747` and the MCP shim to `:35748`, and **the MCP client shows "Connected"
while the app is closed** — that is the shim, not the app.

---

## The target: ten categories

Part 59's benchmark categories are the shelves. Ten of them cover what the planner is measured
against today:

| Category | Where it can come from |
| --- | --- |
| idle breathing and subtle weight shift | Mixamo |
| walk cycle | Mixamo |
| run cycle | Mixamo |
| jump and landing | Mixamo |
| turn and pivot | Mixamo |
| dodge | Mixamo |
| heavy attack | Mixamo, and a capture (video 2 @ 8:09–8:24 — see `LESSONS.md`) |
| light attack | Mixamo, and a capture (video 2 @ 7:14–7:25) |
| reaction animation | Mixamo ("hit reaction") |
| weapon swing | Mixamo ("sword slash"), and a capture (video 6 @ 4:27–4:52) |

Plus at least three captured clips from videos you choose — the queue in `LESSONS.md` has seven
candidates with exact timestamps, or pick your own.

You do not have to do all thirteen in one sitting. `search_library` reports what is covered and
what is missing against this exact list.

---

## Route A — Mixamo (about 2,500 free mocap clips)

### A1. Download

1. Sign in at **mixamo.com** with an Adobe ID (free).
2. **Characters** → pick any character. Which one barely matters: Studio retargets onto R15, and
   what you are keeping is the MOTION, not the body.
3. **Animations** → search the category (e.g. "walking", "sword slash", "hit reaction").
4. Adjust the per-animation sliders if you want (overdrive, character arm-space, trim). Leave them
   alone the first time — you are building a reference, not a final shot.
5. **Download**, and set:
   - **Format: FBX Binary (.fbx)**
   - **Skin: With Skin** for the first download of a character, **Without Skin** for every further
     animation on that same character (a skinned FBX carries the mesh and is much larger; you only
     need the mesh once, if at all)
   - **Frames per Second: 30** — Cadence projects default to 30fps, and a 60fps clip imported at
     30 doubles every frame number in the profile
   - **Keyframe Reduction: none** — reduction throws away exactly the spacing detail the profile
     measures

### A2. Into Studio

Roblox's own Animation Importer retargets an FBX onto an R15 rig. **Check the exact menu path in
your Studio build before following a remembered one** — this is the one step in this file I could
not verify against the live documentation (`create.roblox.com` was reachable for Animation Capture
and not for the importer page), and the UI has moved between versions. It is in the Avatar tab,
alongside the 3D importer.

What matters, whatever the path is:

- the target rig in the scene must be **R15**;
- the result must end up saved from the **Animation Editor**, which writes it into the rig's
  **`AnimSaves`** folder — that is the folder Cadence reads.

### A3. Into Cadence

With the app running and the Cadence plugin installed:

```
import_from_studio                      → lists every rig's AnimSaves
import_from_studio { rigName, animName } → imports one as a REFERENCE item, with a Part 36 profile
```

Then store it:

```
add_to_library {
  itemId,
  semanticDescription: "a relaxed walk cycle, two steps, arms swinging",
  actionType: "walk cycle",
  intentTags: ["locomotion", "relaxed"],
  styleTags: ["realistic"],
  provenance: { kind: "mocap", source: "Mixamo", added_at: <now> },
  licenseOrOwnership: {
    terms: "Mixamo: free to use inside a project under the Adobe/Mixamo terms; the clip file itself is not redistributable",
    redistributable: false
  }
}
```

**`redistributable: false` is not optional and is not inferred.** Mixamo permits use of the
animation inside your project and does not permit redistributing the clips as standalone files.
The library sits in your user-data folder precisely so that a repo, a build or a release never
carries one — and the flag is what makes any future export step able to tell.

### A4. Why not the RoMixamo plugin

Its free tier cannot export, the paid tier costs money, and it has been removed from the Creator
Store before. Roblox's own importer is free, first-party, and the route above.

---

## Route B — Animation Capture (a real performance, from video)

This is how a video becomes animation at all: **Cadence never looks at a video frame.** Roblox
Studio estimates the poses, and Cadence imports the keyframes it produced.

### B1. Requirements, from Roblox's own documentation

Verified 2026-09-11 against `create.roblox.com/docs/animation/capture`:

| | Body capture | Face capture |
| --- | --- | --- |
| File | `.mp4` or `.mov` | not stated |
| Length | **less than 15 seconds** | up to 60 seconds |
| Content | **just one person, well-lit and visible throughout**, "a continuous single shot… from a stable camera" | face centred in frame, well-lit room, close to camera |
| Rig | **R15 rigs** | "animation compatible heads" |
| Time | "After about a minute" the keyframes appear | same |
| Output | keyframes in the Animation Editor timeline | same |

Roblox states no accuracy figure. That is exactly why every entry made this way is stored as an
estimate.

### B2. The clicks

1. Trim your source to **under 15 seconds** of a **single continuous shot** with **one person**
   fully visible. Most YouTube reference is cut — a clip that cuts mid-action will track badly or
   not at all.
2. In Studio, select an **R15** rig → **Avatar** tab → **Animation Editor**.
3. **Capture → Body** (or **Face**) → choose the video file.
4. Wait about a minute. Keyframes appear on the timeline.
5. **Save** from the Animation Editor. The clip lands in the rig's `AnimSaves` folder.

### B3. Into Cadence

Same `import_from_studio` as above, then:

```
add_to_library {
  itemId,
  semanticDescription: "a telegraphed longsword swing with a long recovery",
  actionType: "heavy attack",
  intentTags: ["telegraphed", "punishable"],
  provenance: {
    kind: "captured",
    estimated: true,
    source_video_url: "https://youtu.be/rHEJZXvFc5I",
    source_timestamps: "8:09-8:24",
    estimated_by: "Roblox Studio Animation Capture (Body)"
  },
  licenseOrOwnership: {
    terms: "reference only — poses estimated from a third-party video; not redistributable",
    redistributable: false
  }
}
```

`add_to_library` **refuses** a `captured` entry with `estimated: false`, and refuses one with no
`source_video_url`. Both refusals are deliberate: a pose estimate labelled exact would turn every
later measurement into a false measurement of the performer.

---

## Route C — your own accepted shots (free, and the best data you will get)

When a shot you made is finished and you are happy with it:

```
accept_shot { itemId, statement: "<what made it work>", evidence: [...], retainedFeatures: [...] }
```

That records the lesson as Part 58 memory and **offers** the library — it never adds anything by
itself, because a description, an action type and a licence are not derivable from motion data.
Take the offer with `add_to_library` and `provenance: { kind: "authored" }`,
`licenseOrOwnership: { terms: "the user's own work", redistributable: true }`.

An authored clip is the only kind whose poses are exactly what somebody intended. Mixamo is a
retarget and a capture is an estimate; yours is ground truth.

---

## What the library then does for you

- `search_library { actionType: "heavy attack", nearItemId: <your shot> }` — what do we already
  have that is closest to this, measured, with the distance and what could not be compared;
- `load_from_library { libraryId }` — brings a clip in as a reference item beside your work, with
  its stored profile. It is never applied to your rig and never retargeted;
- coverage against Part 59's categories, so the gaps in the list at the top of this file are
  reported rather than remembered.

Two honest caveats, both reported in every result:

1. The measured distance compares **3 of Part 36's 15 profile dimensions** — spacing variability,
   peak speed and peak angular speed, per part. "Nearest" means nearest on those three. It is not
   a claim that two motions look alike.
2. Two clips profiled on **different rigs** share no part names, so their distance is `null`, not
   large. A cross-rig "which is closest" question cannot be answered by this measurement at all.

---

## Decisions that are yours, and are waiting

1. **Which videos to capture from** — the queue in `LESSONS.md` has seven candidates with exact
   timestamps; the batch W01 notes say why each is worth having.
2. **How many Mixamo clips**, and whether the ten-category target above is the right shape for
   what you are actually building.
3. **Whether captured (estimated) clips may serve as references for the director's loop** in
   `NEXT_SESSION_PROMPT.md`. The default is yes, labelled — but it is your call, and it decides
   whether an estimate can influence a generated shot or only be looked at.
