# W04 notes — videos 31–40 (B. Body mechanics, weight, posing, locomotion, combat)

## Checklist

- [x] 31. Jump Animation: The Complete Beginner's Guide — Plainly Simple (16:15) — https://youtu.be/n29cFugfM_c
- [x] 32. Body Mechanics: Jumping and Landing — Animation Mentor (11:02) — https://youtu.be/VjRCxm8nrNE
- [x] 33. How To Improve Idle Animations In Games — Libby Pete (6:11) — https://youtu.be/tYwNSm8Q3l8
- [x] 34. Punch Tutorial — Greg Marlow Learning (11:45) — https://youtu.be/tcBT-6wdSC8
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

### 33. How To Improve Idle Animations In Games — Libby Pete

2026-09-11. Watched at `balanced` detail (100 frames from a 211-candidate scene-change pass across
the full 6:11 run) plus a focused local re-extraction of 04:15–05:35 to check the before/after
pose-comparison demo. **Same structural surprise as video 31**: a large share of the full-video
frames are a rapid B-roll montage of unrelated games and film clips (Zelda, a Halloween-themed
indie game, a hand-drawn Ariel/Little Mermaid rough, a horror game, two different RPG combat
scenes) shown as generic illustration while the presenter talks over them in general terms — the
actual "Jack" character demo the whole video is building toward is concentrated in the last 90
seconds, which the full-range pass under-sampled. The video is entirely about POSING (not motion) —
despite the title, there is no discussion of idle breathing, sway, or looping motion at all.

**What it teaches, specifically:**
1. Posing improvements to an existing idle are authored as a separate ADDITIVE layer stacked on
   top of the base animation, never by re-keying it directly — "I'm not going to override it. I'm
   just going to do an additive layer and add a new pose on top" (04:15–04:29), demonstrated live by
   deleting the layer on screen for an exact A/B comparison (05:18–05:30, frames confirmed at
   t=04:37 and t=05:29 in a two-panel Unreal-Engine-style viewport). A genuine, confirmed gap in
   Cadence: a repo-wide search for "additive" finds it used only for VFX particle blend modes, never
   for a stackable pose layer over an existing animation track. Wrote
   **`additive_pose_layer_over_base_idle`**.
2. A games-specific reason an idle's pose must stay moderate and balanced, distinct from a film
   pose: it is the hub every other animation blends from and into, so "if you have some crazy pose
   that's going to be hard to flow in and out of... you're going to have a hard time creating nice
   fluid animations" (01:22–01:40). Names the DOWNSTREAM COST of an extreme idle explicitly, which
   no existing card states. Wrote **`idle_pose_as_blend_hub_constrains_extremity`**.
3. The same multi-source, non-copying reference pattern video 32 used for motion timing, now
   independently applied to POSE/silhouette design ("I usually find reference from real life and
   from other animated works... you don't want to plagiarize ever... you also want to come up with
   something new," 03:21–03:38, sources named as Bucky from Marvel Rivals and Green Beret photos,
   confirmed on screen at t=01:56–01:58). Seeing this pattern independently, twice, from two
   presenters for two different purposes in the same batch crossed the bar for its own entry. Wrote
   **`multi_source_reference_blend_not_measured`**, citing both videos 32 and 33.
4. The specific silhouette fix made to Jack's pose (elbows repositioned so they read clearly against
   the torso, "hands are much more easily visible," 04:44–04:51) is a direct, concrete application
   of the existing `silhouette_readability_diagnostic_pass` card's limb-separation technique — logged
   as a **cross-check**, not a new entry.
5. Glen Keane's "tilt, rhythm, and twist" posing framework is name-dropped (01:48–02:18) but the
   auto-captions garble the individual definitions badly enough (tilt and twist both described via
   near-identical "side to side... rotation" language) that I could not confidently state what
   distinguishes the three from the transcript alone — deliberately NOT written up as an entry to
   avoid guessing at a taxonomy the source itself didn't clearly render; worth another session
   picking up from a cleaner source on Glen Keane's own framework specifically.
6. Standard line-of-action and balance principles are restated and illustrated (a spine-to-head line
   traced through the Bucky reference at 04:02–04:08; balance/weight-support at 01:22–01:26) —
   consistent with existing `appeal`/`line_of_action_shape_and_scope` cards, not written up again.

**Contradicted an existing card:** none.

**Cross-checks:** `silhouette_readability_diagnostic_pass` (elbow/hand silhouette fix, video @
04:44–04:51).

**Capture candidate:** none — an Unreal-Engine-style viewport screen recording throughout, no
filmed human performance, and the actual pose change is a static hold rather than a motion.

**Checks for the queue:** none from this video — both new entries are authoring/workflow patterns
(where data lives, why a constraint exists) rather than a property of a finished motion
`ai/motion.js` could measure.

**Entries written:** `W04-33-additive-pose-layer-over-base-idle.json`,
`W04-33-idle-pose-as-blend-hub-constrains-extremity.json`,
`W04-33-multi-source-reference-blend-not-measured.json` — all three pass `validateProposedEntry`
and `validateEvidenceSource` cleanly.

### 34. Punch Tutorial — Greg Marlow Learning

2026-09-11. Watched at `balanced` detail — only 9 frames selected from a static Maya screen
recording across the full 11:44 run, so most of this video's very concrete, specific content rests
on the transcript rather than directly-viewed poses (flagged honestly in each entry's
evidence_status rather than glossed over). Despite the sparse frames, this was the single densest,
most concretely-evidenced video of the batch so far — a working animator narrating exact technique
while live-editing a punch in Maya with AnimBot and a motion-trail tool.

**What it teaches, specifically — exactly the "hips first, wrist last" the batch's own list line
promised:**
1. The core mechanic: at a breakdown frame, the torso/hips and the stepping foot are ALREADY posed
   at their final contact configuration while the arm/fist is deliberately posed still short of
   full extension — cross-domain-corroborated with a slow-motion baseball pitch ("that baseball is
   always one of the last things... all of that energy from his body moving forward... he is
   transferring into this arm and eventually out through that ball," 02:57–03:24, reference clip
   confirmed in this session's frame at t=03:42). This is structurally the SAME default `body_lead`
   already compiles (chain-depth-first, proximal before distal) — logged with that connection made
   explicit rather than hidden, since the genuinely new part is the PURPOSE (force/velocity
   amplification down the chain, not just organic feel) and the direct tie to the checks-queue's
   already-noted "declared lead joint" gap (#26). Also names the root cause of a weak punch
   directly: taking the idle pose and just extending the arm, with no body-mass sequencing behind
   it at all. Wrote **`proximal_to_distal_power_sequencing`**.
2. A concrete pose-calibration workflow: place a throwaway target object just out of reach, then
   push every available joint (spine twist, clavicle, arm stretch) toward it until the pose is
   close to breaking, rather than choosing a reach's extent by eye alone (04:58–05:33). Connects
   directly to Cadence's existing `solve_ik`, and to CLAUDE.md's own documented exact reach-limit
   numbers (a leg chain's 1.85-stud maximum, an arm's 1.6888-stud maximum) — the video's manual,
   iterative "how close to breaking can I get" process is exactly what a margin-to-limit report on
   top of the existing analytic solve would answer directly. Wrote
   **`reach_pose_calibrated_against_placeholder_target`**.
3. A specific, checkable spacing rule verified with a motion-trail tool showing per-frame position
   markers: the fist's WIDEST frame-to-frame gap must sit immediately BEFORE the contact frame, not
   earlier in the swing — "in the same way we have a bouncing ball we want that spacing right
   before the ball hits the floor to be the biggest distance it travels" (09:17–09:57), with the
   stated result: "now we get this big spacing right before the impact... that punch has much more
   force to it" (10:29–10:39). This is directly measurable today from `sampleMotion`'s existing
   `linear_velocity` series joined against a contact marker — nothing currently runs that specific
   join. It's the anticipation-side mirror of the existing `external_force_easing_override` card
   (that one says don't ease OUT of an impact; this says don't decelerate INTO one either). Wrote
   **`peak_spacing_immediately_before_impact`**.
4. A fist-path-straightening pass ("I want my arm... to be going kind of in a straight line,"
   09:15–09:24) is a second, independent source for checks-queue item #11
   (`single_axis_attack_flag`, originally from video 6) — noted as corroboration, not a new entry.
5. The counterbalancing arm used to fix an off-balance forward-leaning pose is explicitly credited
   with improving BOTH balance and silhouette in the same move (05:48–05:56) — a nice practical
   synthesis point, not distinct enough from existing balance/silhouette cards for its own entry.

**Contradicted an existing card:** none.

**Cross-checks:** none formally logged this video (the closest matches — `body_lead`,
`external_force_easing_override`, checks-queue #11 and #26 — are all cited as direct interactions
inside the three new entries above rather than as separate confirmations, since each new entry adds
real content beyond a restatement).

**Capture candidate:** none — a Maya viewport screen recording, no filmed human performance.

**Checks for the queue:**
- `check: proximal_distal_arrival_gap — given a declared strike chain, compare the frame each
  joint reaches its own peak completion (analyseChain onset/peak) between the proximal end (hip/
  torso) and the distal end (fist); the proximal end should peak measurably earlier — buildable
  directly from analyseChain's existing per-joint series — video 34 @ 07:28–07:49`
- `check: peak_velocity_frame_vs_contact_marker — locate the frame of maximum linear_velocity for
  a striking effector and compare its distance from a declared contact/impact marker; expect
  near-zero distance for a forceful strike — buildable from sampleMotion + ai/events.js markers,
  both already real — video 34 @ 09:17–10:39`

**Entries written:** `W04-34-proximal-to-distal-power-sequencing.json`,
`W04-34-reach-pose-calibrated-against-placeholder-target.json`,
`W04-34-peak-spacing-immediately-before-impact.json` — all three pass `validateProposedEntry` and
`validateEvidenceSource` cleanly.
