# Watch session W01 notes — videos 1–10

## Checklist

- [x] 1. 12 Principles of Animation (Official Full Series) — AlanBeckerTutorials (24:03) — https://youtu.be/uDqjIdI4bF4
- [ ] 2. TIMING - The 12 Principles of Animation in Games — New Frame Plus (9:38) — https://youtu.be/rHEJZXvFc5I
- [ ] 3. ANTICIPATION - The 12 Principles of Animation in Games — New Frame Plus (7:52) — https://youtu.be/28s1Hv3Zqlo
- [ ] 4. SQUASH & STRETCH - The 12 Principles of Animation in Games — New Frame Plus (8:19) — https://youtu.be/1kFRU_xBZnE
- [ ] 5. SLOW IN & SLOW OUT - The 12 Principles of Animation in Games — New Frame Plus (7:24) — https://youtu.be/3jNiNctcQ4c
- [ ] 6. ARCS - The 12 Principles of Animation in Games — New Frame Plus (7:47) — https://youtu.be/lOzgxMgAnxQ
- [ ] 7. FOLLOW THROUGH & OVERLAPPING ACTION - The 12 Principles of Animation in Games — New Frame Plus (16:53) — https://youtu.be/rYtrV1lChsA
- [ ] 8. The most important animation principle: An introduction on animation spacing and timing — Dong Chang (11:04) — https://youtu.be/vSJ5lT_ma-E
- [ ] 9. 3 Easy Ways to Master Animation Timing — Dong Chang (13:58) — https://youtu.be/13QIh7vsCpQ
- [ ] 10. Animation basics: The art of timing and spacing - TED-Ed — TED-Ed (6:42) — https://youtu.be/KRVhtMxQWRs

## Per-video notes

### 1. 12 Principles of Animation (Official Full Series) — 2026-09-11

Watched at `efficient` detail (50 keyframes, sparse across 24:03 — the script's own warning flagged the length) plus the full 744-segment caption transcript, which turned out to be the stronger source here: Alan Becker narrates in a describe-what-you-see style ("here's a character with and without X"), so the transcript alone pins down almost everything, and I read ~10 frames spread across all twelve sections to ground that rather than reading all 50 (per the file's own guidance, `efficient` detail does not carry the "read every frame" obligation `balanced` does).

**Cross-check against `ai/knowledge.js`'s existing twelve essential cards: all twelve confirmed, none contradicted.** Frank Thomas/Ollie Johnston's canonical list maps 1:1 onto the twelve concepts already in the table (`pose_workflow` = straight-ahead/pose-to-pose, `structural_understanding` = solid drawing), and nothing in the video contradicts a claim any existing card makes. Specific confirmations worth naming: squash & stretch's volume-conservation rule ("as the ball gets longer, it also gets narrower") matches the existing card's `physical_interpretation` exactly; the slow-in/slow-out section literally shows a motion-vs-time S-curve graph (frame at t=12:31) that is the same curve `ai/motion.js`'s velocity/acceleration measurement is built to detect; follow-through's "elbow leads forearm leads hand" ordering is precisely what `analyseChain`'s lead/lag measurement already reports.

**Three genuinely new, specific techniques the existing cards don't name — filed as new inbox entries:**
1. **Layered/nested anticipation** (`W01-1-layered-anticipation.json`) — the video shows a punch with a SECOND, earlier wind-up before the ordinary anticipation phase (step forward → wind up → throw the other arm back → punch, likened to a baseball pitcher), contrasted against the same punch with one anticipation phase. The existing `anticipation` card treats anticipation as a single phase; this is a distinct, nameable specialization with its own failure modes (video @ 3:47–4:13).
2. **Pose hold density** (`W01-1-pose-hold-density.json`) — "drawing on ones/twos/threes": how many frames a single pose is held before the next distinct pose appears, shown concretely as one head-lean redrawn at 0 through 10 in-between counts, each count reading as a genuinely different action (a snap-hit vs. a friendly wave vs. a thoughtful appraisal). This is orthogonal to `slow_in_slow_out` (which shapes the curve BETWEEN two poses) — this decides how densely poses exist per unit time in the first place (video @ 16:11–18:20; the 10-inbetween frame at t=17:20 was checked directly and shows exactly 10 dots between begin/end).
3. **Twinning** (`W01-1-twinning.json`) — a named, specific failure mode: posing paired limbs identically/symmetrically (both arms at the same angle, even weight on both legs) reads as flat and lifeless; the fix is breaking symmetry (weight on one hip, a hand resting there, a slouch). Neither `structural_understanding` nor `appeal` names this specifically, though both are adjacent. I did not personally see the corrected-pose illustration frame (efficient-detail sampling landed on the section's title card instead, t=21:38) — the entry says so plainly in `evidence_status` rather than claiming a frame I didn't see (video @ 21:19–21:37).

**Other specific, useful material that did NOT get its own entry** (judged as either 2D-drawing-specific with no honest Cadence angle, or as an illustration of an existing card rather than a new concept — kept here instead of inflating the inbox):
- The "keys → extremes → breakdowns" pose-to-pose vocabulary hierarchy (video @ 8:39–9:13) — a specific naming convention for pose-to-pose sub-stages; `pose_workflow`'s existing card already states plainly that Cadence has no representation of the workflow choice at all, and this doesn't change that.
- "Push the exaggeration level until it's actually too much, then wind it back" (video @ 19:44–19:53) — a calibration METHOD rather than a new visual principle; conceptually close to what `ai/experiment.js`'s bounded-alternatives comparison could support (generate a range, compare), but that's a workflow observation, not a knowledge-entry candidate.
- Appeal's three concrete design levers — shape variety, exaggerating the one proportion that carries the character's personality, simplifying detail count (video @ 22:08–22:56) — specific and well stated, but the existing `appeal` card already and deliberately claims zero measurement for the whole principle ("this build states that plainly rather than approximating it"); a new entry here would just restate that same honest gap under a different name.
- The "hold readable text on screen for as long as it takes to read it aloud three times" staging convention (video @ 5:42–5:48) — precise and quotable, but it is about on-screen TEXT, which is outside Cadence's domain entirely (a rig/VFX/camera animation tool, not a UI-text tool). Generalized into a check below instead of a knowledge entry, since the underlying idea (hold a key beat long enough to register) does apply beyond text.
- The "motion smear" technique for very fast arcs — a translucent/fragmented shape filling the gap between start and end pose (video @ 13:56–14:38) — a hand-drawn substitute for in-between frames; closest Cadence analogue would be a VFX trail/streak emitter, but that is a stretch from what the video actually shows, so left as a note rather than forced into a `vfxspec`-flavored entry.

**Capture candidates:** none. Every demonstration in this video is a 2D stick-figure/scribble illustration, not a real performed motion — nothing here is a reference clip Roblox Studio's Animation Capture could take.

**Checks for a later session to implement:**
- `check: layered_anticipation_present — count of distinct direction-reversal sub-phases before an action's main onset — ≥2 sub-phases expected only for declared "heavy"/"finisher" actions, 1 otherwise — video 1 @ 3:47–4:13`
- `check: pose_hold_density_matches_style — average frames-per-distinct-key-pose within a phase (derivable from existing track key timestamps) — anime/limited style: roughly 2–3 frames per pose (or an irregular stepped pattern); realistic/full style: near-continuous — video 1 @ 16:11–18:20`
- `check: twinning_avoidance — angular difference between each declared mirror joint pair's rotation at a sampled frame — flag when the difference is small (e.g. <5°) across multiple paired joints simultaneously on a held, non-locomotion pose — video 1 @ 21:19–21:37`
- `check: readable_hold_duration — duration a key story-beat pose is held with no significant motion before the next phase begins (via existing phase/marker timing) — should be long enough for the pose's content to register; the video's own convention for on-screen text (hold for 3× the read-aloud time) generalizes to "long enough to read", not a literal Cadence-applicable number — video 1 @ 5:31–5:48`

**Entries written:** 3 (`W01-1-layered-anticipation.json`, `W01-1-pose-hold-density.json`, `W01-1-twinning.json`), all passed `validateProposedEntry` cleanly (checked directly against the live `ai/knowledge.js` module — 0 problems, no extra/missing fields on any of the three).

**Next video: 2** (TIMING - The 12 Principles of Animation in Games, `balanced` detail).
