# W04 notes — videos 31–40 (B. Body mechanics, weight, posing, locomotion, combat)

## Checklist

- [x] 31. Jump Animation: The Complete Beginner's Guide — Plainly Simple (16:15) — https://youtu.be/n29cFugfM_c
- [x] 32. Body Mechanics: Jumping and Landing — Animation Mentor (11:02) — https://youtu.be/VjRCxm8nrNE
- [ ] 33. How To Improve Idle Animations In Games — Libby Pete (6:11) — https://youtu.be/tYwNSm8Q3l8
- [ ] 34. Punch Tutorial — Greg Marlow Learning (11:45) — https://youtu.be/tcBT-6wdSC8
- [ ] 35. How to Animate Fight Scenes (Part 1): Punches — Besty Animates (6:02) — https://youtu.be/4uvQytZ3DmA
- [ ] 36. Fisticuffs: Tips for animating action and fight scenes — Dong Chang (6:07) — https://youtu.be/-HXx1fK415I
- [ ] 37. How to ANIMATE SWORD COMBAT Part 1 — Gogan (77:15) — https://youtu.be/sBNDzqO8ZT8
- [ ] 38. How to Animate a Sword Fight: Full Creative Process — Winged Canvas (15:40) — https://youtu.be/ZTH3meW3o4E
- [ ] 39. Breaking Down Attack Animations [Animation] — Masahiro Sakurai on Creating Games (3:35) — https://youtu.be/LewXWM7HDd8
- [ ] 40. Animation vs Choreography — Honored Clarity (8:03) — https://youtu.be/xlfcZ2B8Vvs

## Per-video notes

### 31. Jump Animation: The Complete Beginner's Guide — Plainly Simple

2026-09-11. Watched at `balanced` detail (32 frames from the full 16:15 run) plus two follow-up
focused local re-extractions (08:16–08:34 and 11:22–11:40) to check a B-roll clip that turned out
to matter. **Surprise #1**: roughly half the scene-change frames a full-video `balanced` pass
picked (everything between 02:14–11:32 and 15:23–16:04) are NOT the jump being built — they're a
promotional montage of clips from the channel's separate paid "Frame By Frame Animation" course
(Halves Method, Mouth Animation, Push-Up Drill, Squash and Stretch, Timing and Spacing lessons),
cut in rapidly while the presenter narrates over them. The scene-change detector loves a fast
montage and mostly skipped the actual jump-specific screen recording, which is comparatively
static. The transcript carried almost all the real teaching value here; the frames mostly
confirmed structure rather than adding new evidence, except for one real find (below).

**What it teaches, specifically:**
1. A six-keypose taxonomy — starting, anticipation, action, overshoot, recoil, settle — each with
   a one-line definition given directly on screen at 00:14–01:15 (a frame at t=15:02 shows the
   finished six-pose colour-coded timeline). Overshoot and recoil are explicitly DIRECTIONAL:
   overshoot goes "a little bit further" than the settle target, recoil goes "a little bit
   backwards" compared to it — i.e. opposite sides of the same final value, not two words for the
   same bounce. This maps closely onto Cadence's own `ai/plan.js TEMPLATES` phase order
   (`preparation, anticipation, action, follow_through, recovery, settle`), which names
   `follow_through` and `recovery` as separate phases but never states which side of the eventual
   settle value each should land on — this video is direct evidence for exactly that missing rule.
   Wrote **`overshoot_recoil_settle_pose_sequence`**.
2. The halves method (recursive bisection) for ease-in, ease-out, and combined ease-out-in, walked
   through with a worked two-keypose numeric example (02:04–04:21). This directly confirms the
   existing `spacing_subdivision_method_ladder` card's halves-method claim — logged as a
   **cross-check**, not a new entry, since that card already names the same technique; this video's
   demonstration is clearer and more explicit than the evidence that card currently cites (that
   card's own evidence_status admits its halves demonstration fell in an uncaptured stretch).
3. **The most interesting find**: a breakdown pose's frame is chosen by *estimating* a physical
   event (09:27: "let's estimate when that last point of contact would happen, it's probably here
   where we'll have the knees straighten up"), and that estimated frame — not the arithmetic
   midpoint of the phase — becomes the anchor the halves method's ease-out/ease-in split is built
   from, so the two sides end up with visibly different inbetween counts (09:37–10:11: the
   anticipation-side ease-out shrank to one inbetween while the action-side ease-in kept the rest).
   The same logic places the action→overshoot breakdown "at the end, not the middle" because that
   span's physics only support a pure ease-out (11:48–11:58). This is independent, concrete
   real-world confirmation of `ai/plan.js`'s own `authorMotion` breakdown mechanism (source comment:
   "A breakdown is a POSE BIAS, not a time fraction") — the video shows the analogous thing is true
   of the breakdown's TIME placement too. Wrote **`breakdown_placement_shifts_ease_split`**.
4. Smears added retroactively wherever the finished spacing chart shows an unusually large
   frame-to-frame gap (14:12–14:39: "take a look at these frames, the spacing... is a bit big, so
   it's fast... let's add smears... to all of the fast parts"). This is a near-verbatim match for
   `motion_smear_readability`'s own `detection_and_measurement_methods` field, which already
   describes flagging large positional gaps as smear candidates — logged as a **cross-check**.
5. Pose-to-pose workflow (plan six keyposes, then spacing chart, then breakdowns, then halves
   method, then smears) is a full worked example of the compiled `pose_workflow` principle, whose
   evidence_status was "directive text only" before this — logged as a **cross-check** that
   upgrades its evidence from text-only to a concrete video demonstration.

**Contradicted an existing card:** none.

**Cross-checks** (confirmations of existing cards, not new entries — see `LESSONS.md` merge note):
`spacing_subdivision_method_ladder` (halves method, video @ 02:04–04:21), `motion_smear_readability`
(smear-placement-by-gap rule, video @ 14:12–14:39), `pose_workflow` (a full worked pose-to-pose
example, video @ throughout, upgrading its evidence from directive-text-only).

**Capture candidate:** a real, filmed (not drawn/rendered) human standing vertical jump —
crouch → explosive extension with an arm swing → airborne — at **video 31 @ 08:26–08:33**, and
what appears to be the same performer/setting's landing absorption (deep knee-bend catch) at
**11:28–11:34** (found only after a focused local re-extraction; the full-video pass's sparse
sampling missed the motion peaks). Static camera, plain tiled-courtyard background, single
performer — about as directly trackable as real-world footage gets for Roblox Studio's
Animation Capture → Body, more so than most of the existing capture queue (which is mostly 2D or
rendered-game reference). Used in the source video itself as the physical justification for both
breakdown placements above.

**Checks for the queue:**
- `check: overshoot_recoil_opposite_sides — given a declared settle value for a tracked
  joint/effector, classify each of the two post-action peaks (if present) as same-side or
  opposite-side relative to it; a complete six-keypose sequence should show exactly one of each —
  buildable directly from sampleMotion's position/rotation series — video 31 @ 00:37–01:15`
- `check: breakdown_split_asymmetry_matches_bias — compare each side's key_density (already
  measured) against how far the breakdown's declared bias sits from 0.5; flag a near-symmetric
  frame split when the bias is far from the midpoint, or vice versa — video 31 @ 09:27–10:11`

**Entries written:** `W04-31-overshoot-recoil-settle-pose-sequence.json`,
`W04-31-breakdown-placement-shifts-ease-split.json` — both pass `validateProposedEntry` and
`validateEvidenceSource` cleanly.

### 32. Body Mechanics: Jumping and Landing — Animation Mentor (Jason Martinson)

2026-09-11. Watched at `balanced` detail (18 frames across the full 11:02 run). Real professional
production commentary (films/games/VFX credits, ex-pre-production on an animated Monkey King
feature) narrating his own 3ds Max jump-and-land shot pose by pose. Several of the graph-editor
frames in the sample are badly overexposed (blown out to white, e.g. t=06:13–06:48) so the spline
section rests more on the transcript than on directly-viewed curves — noted honestly in both
entries' evidence_status rather than glossed over.

**What it teaches, specifically:**
1. A landing's secondary motion has real internal choreography, not just "head lags hips": the
   hips hit bottom and start rising again WHILE the head is still sinking (05:18–05:33, "as his
   butt is going up, his head's still going down"), then the head performs its own smaller,
   separately-timed ricochet before the whole body holds. A brief span where two ends of the same
   chain move in OPPOSITE directions is a sharper claim than the existing chain-lag cards state.
   Wrote **`chain_reversal_lag_on_landing_recovery`**, which also folds in a smaller texture detail
   from the same shot: whichever leg leads the launch (up earlier/higher) also leads the landing
   (down and contacts first) — a lead-consistency detail, not treated as its own entry.
2. A reference chart by animator Lerm Arthurnal, presented and endorsed on screen (00:31–01:11,
   frame confirmed at t=00:28), names FOUR distinct settle-curve variants — soft overshoot, hard
   overshoot, overshoot+slow-in, and slow-in only — applied independently per body part ("offset
   everything: stomach, chest, shoulders, head"). This is a small, useful, previously-unnamed
   taxonomy connecting several existing single-shape cards (`float_to_stop_settle` ≈ the slow-in
   variant; `shared_mechanism_anticipation_overshoot`'s mechanism can produce the two overshoot
   variants) as points on one spectrum, and maps directly onto `authorMotion`'s existing
   `settle.ratio` parameter (small ratio = soft, larger = hard) — which is not currently exposed
   per-joint the way this chart's own instruction calls for. Wrote
   **`named_landing_settle_curve_variants`**.
3. An arc verification technique: a small ghosted proxy object parented to the hips, visualized in
   real time in the viewport to reveal and interactively adjust the arc of the jump (08:45–09:37,
   frame confirmed at t=06:06 showing the green circular gizmo around the hip). This is the same
   underlying principle as the existing `onion_skin_arc_verification` card (visualize the
   accumulated path to catch irregularities) applied in 3D via a parented+ghosted object instead of
   2D onion-skinned drawings, with one elaboration that card didn't have: it's used INTERACTIVELY
   to fix a spacing problem the moment it's spotted ("if I wanted to change the spacing of
   something... now you can see there's a blip in the arc"), not only to diagnose one. Logged as a
   **cross-check**, not a new entry, since the underlying measurement (`bow_studs`, MOT-005) that
   card already documents fully subsumes this too.
4. Reference-gathering as multi-source inspiration rather than a single measured performance:
   "I didn't do a jump myself... I found some references of people jumping high... I'm not going to
   copy any of these exactly... using them all as a bit of inspiration... because I do understand
   the basics of the physics" (01:14–01:39, a real basketball jump-shot reference clip confirmed in
   this session's frame at t=05:54). A legitimate, distinct pattern from `physical_reference_timing_
  method`'s single-source measured/filmed approach — noted here rather than written up as its own
   entry, since it's a workflow-judgment call more than a measurable technique.
5. A concrete data point: the finished shot is "a pretty simple 34 frame step, jump, and land"
   (10:39–10:42) — logged as a number worth having if `startup_frame_budget_by_genre` (checks queue
   #5) is ever built out with more reference durations, not written up on its own.

**Contradicted an existing card:** none. One legs-kept-straight vs legs-offset-and-bent variation
was explicitly named by the presenter as a case where his own shot differed from the reference he
was inspired by ("somewhere where we differed between the two") — presented as a legitimate style
choice, not a correction of either.

**Cross-checks:** `onion_skin_arc_verification` (parented+ghosted arc-tracking proxy, video @
08:45–09:37, adds an interactive-adjustment angle).

**Capture candidate:** none — a 3ds Max viewport screen recording, no filmed human performance.

**Checks for the queue:**
- `check: chain_direction_reversal_lag — given a declared root and a distal joint on the same
  chain, flag a span where their velocity signs are opposite (one rising, one still falling) rather
  than merely offset in time; buildable directly from analyseChain's existing per-joint series —
  video 32 @ 05:18–05:33`
- `check: settle_variant_classification — given a declared settle value, classify a joint's arrival
  as no-overshoot / soft-overshoot / hard-overshoot from the measured peak's distance past the
  rest value; buildable from sampleMotion's position series — video 32 @ 00:31–01:11`

**Entries written:** `W04-32-chain-reversal-lag-on-landing-recovery.json`,
`W04-32-named-landing-settle-curve-variants.json` — both pass `validateProposedEntry` and
`validateEvidenceSource` cleanly.
