# W04 notes — videos 31–40 (B. Body mechanics, weight, posing, locomotion, combat)

## Checklist

- [x] 31. Jump Animation: The Complete Beginner's Guide — Plainly Simple (16:15) — https://youtu.be/n29cFugfM_c
- [x] 32. Body Mechanics: Jumping and Landing — Animation Mentor (11:02) — https://youtu.be/VjRCxm8nrNE
- [x] 33. How To Improve Idle Animations In Games — Libby Pete (6:11) — https://youtu.be/tYwNSm8Q3l8
- [x] 34. Punch Tutorial — Greg Marlow Learning (11:45) — https://youtu.be/tcBT-6wdSC8
- [x] 35. How to Animate Fight Scenes (Part 1): Punches — Besty Animates (6:02) — https://youtu.be/4uvQytZ3DmA
- [x] 36. Fisticuffs: Tips for animating action and fight scenes — Dong Chang (6:07) — https://youtu.be/-HXx1fK415I
- [x] 37. How to ANIMATE SWORD COMBAT Part 1 — Gogan (77:15) — https://youtu.be/sBNDzqO8ZT8
- [x] 38. How to Animate a Sword Fight: Full Creative Process — Winged Canvas (15:40) — https://youtu.be/ZTH3meW3o4E
- [x] 39. Breaking Down Attack Animations [Animation] — Masahiro Sakurai on Creating Games (3:35) — https://youtu.be/LewXWM7HDd8
- [x] 40. Animation vs Choreography — Honored Clarity (8:03) — https://youtu.be/xlfcZ2B8Vvs

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

### 35. How to Animate Fight Scenes (Part 1): Punches — Besty Animates

2026-09-11. Watched at `balanced` detail (100 frames from a 305-candidate pass across the full
06:02 run). The lightest video of the batch so far — a beginner-level 2D (Clip Studio Paint)
tutorial that mostly restates anticipation/action/follow-through at a generic level, already deeply
covered by the compiled `anticipation` principle and the W01 anticipation-ladder cards. Two genuine,
specific production points stood out from the generic restatement.

**What it teaches, specifically:**
1. Block the initial key-pose pass at a deliberately LOW frame count, specifically so a wrong
   choice costs seconds to redo rather than hours: "animate in really low frame rates... mistakes
   are also really easy to fix when you have a low frame count. It wouldn't feel like wiping away
   5 hours of hard work" (02:56–03:10). A simple but genuinely distinct production-cost technique
   from the pose-to-pose/straight-ahead workflow choice or the staged-keyframe ordering question
   the corpus already covers — this is specifically about the FRAME COUNT of the first pass. Wrote
   **`low_frame_rate_draft_pass_for_fast_iteration`**.
2. A specific combo-structure claim: across a planned five-hit combo, the full anticipation-action-
   follow-through cycle is NOT repeated per hit — "anticipation, action, anticipation, action, and
   follow-through" (03:51–03:59), follow-through named only once, after two full anticipation-action
   pairs — with a full follow-through/reaction beat reserved for the combo's end, there escalated
   into a finishing move (a suplex) with its own dedicated anticipation (04:01–04:26). This is the
   multi-hit-SEQUENCE-level analogue of the W01 anticipation ladder's single-action frame-budget
   compression — a genuinely different scope than anything currently in the corpus. Wrote
   **`combo_chain_defers_follow_through_to_final_hit`**.
3. A closing-the-gap plausibility check before animating an attack: "there's a not-so-small gap
   between them, meaning if any of them were to throw a punch right now, it wouldn't land cuz the
   gap is too big... except for Monkey D. Luffy" (02:36–02:48), resolved by animating the attacker
   closing the distance first. A nice, concrete complement to this batch's own video-34 entry
   `reach_pose_calibrated_against_placeholder_target` — logged as a **cross-check** on that entry
   rather than a new one, since it's the same reach-vs-target-distance judgement approached from the
   opposite direction (a pre-check gate, not a pose-calibration technique).
4. Anticipation's definition (a wind-up pose, opposite the action's direction, giving the SECOND
   character "a chance to block or dodge the attack," 00:51–01:07) is a clean, entirely generic
   restatement of the compiled `anticipation` principle and the existing W01 anticipation-ladder
   cards — logged as a **cross-check**, not a new entry. Follow-through's definition ("tells us what
   happened after the action... whether the attack was successful or whether it was blocked,"
   01:31–01:40) is likewise a plain restatement of `follow_through_overlap` /
   `overshoot_recoil_settle_pose_sequence` (this batch) — also a **cross-check**.

**Contradicted an existing card:** none.

**Cross-checks:** `reach_pose_calibrated_against_placeholder_target` (this batch, video 34 — the
gap/reach plausibility check), `anticipation` (compiled principle, generic restatement),
`follow_through_overlap` (compiled principle, generic restatement).

**Capture candidate:** none — 2D drawn animation throughout, no filmed or rigged 3D performance.

**Checks for the queue:** none from this video — both new entries are combo/production-workflow
patterns (sequencing across multiple authored actions, or a draft-vs-final authoring stage) rather
than a property of one finished motion `ai/motion.js` could measure directly.

**Entries written:** `W04-35-low-frame-rate-draft-pass-for-fast-iteration.json`,
`W04-35-combo-chain-defers-follow-through-to-final-hit.json` — both pass `validateProposedEntry`
and `validateEvidenceSource` cleanly.

### 36. Fisticuffs: Tips for animating action and fight scenes — Dong Chang

2026-09-11. Watched at `balanced` detail (100 frames from a 199-candidate pass across the full
06:06 run). Dong Chang is already cited twice in this corpus from two OTHER videos
(`asymmetric_spacing_preference`, `physical_reference_timing_method`) — this is a third,
independent video from the same working Japanese-animation-industry animator, breaking down his
own professional work (Decadence, Dr. Stone) frame by frame. The densest, most professionally
evidenced video since video 36's neighbours — real boxing and taekwondo reference footage studied
on screen, then compared directly against the shipped anime frames it informed.

**What it teaches, specifically:**
1. A precise, named technique for a strike's connecting frame: held for a single frame's exposure,
   short enough to never be consciously registered, because "meant to be felt not seen"
   (04:50–04:59) — the impact's force comes from the DISRUPTION it causes to the surrounding
   motion, not from the connecting pose's own visibility. Directly confirmed in this session's
   frame at t=04:33: a fist filling the frame with visible motion-streak marks. A genuinely
   distinct idea from either `motion_smear_readability` (bridges a travel gap) or
   `implied_zero_frame_anticipation` (compresses the WIND-UP, not the impact) — and worth naming
   the tension with `dps_floor_for_short_actions` explicitly rather than hiding it: that card warns
   against under-posing a short action, and this technique deliberately does exactly that for ONE
   frame, on purpose. Wrote **`subliminal_single_frame_impact_pose`**.
2. The explicit design reasoning for why screen combat should depart from studied reference
   footage's own timing: "a slow powerful punch gets dodged easily in real life but looks great on
   the screen... we want to strive beyond reality" (01:53–02:03), stated immediately after a
   frame-by-frame study of real boxing footage (confirmed in this session's frames at t=00:56 and
   t=01:52). Names a specific SHAPE for the exaggeration (much longer wind-up, much faster connect)
   with a stated reason, which `startup_frame_budget` states as a genre dial but without this
   particular real-vs-screen justification. Wrote
   **`anti_realism_readability_tradeoff_for_screen_combat`**.
3. A specific, twice-repeated composition checklist item — independently for two different
   characters in two different productions in the same video: "I really like this drawing which
   assumes strong expression and her fist both in frame. It makes your intention crystal clear"
   (02:29–02:36), and again for Tsukasa: "his expression and his fists are both in frame... this
   makes his intention very clear" (05:24–05:33, confirmed directly in this session's frames at
   t=04:51 and t=05:15). Wrote **`expression_and_acting_limb_both_in_frame`**.
4. **A strong, independent third and fourth confirmation of this batch's own
   `proximal_to_distal_power_sequencing`** (video 34) — and it extends that entry's scope: "throughout
   all this his whole body is moving forward even though his left arm is still pulling backwards"
   (01:06–01:12) for the punch, and for a taekwondo spin kick specifically during the WIND-UP (not
   only the arrival at contact, which is all video 34's own entry covered): "he leads with the
   shoulder and head and the kicking leg follows... the kicking leg lags behind" (01:30–01:40).
   Logged as a **cross-check** with the scope extension noted explicitly for whoever merges this
   batch to consider folding in.
5. The smear-for-large-gaps rule is reinforced twice more: "the distance moved in that one draw is
   so huge that I will need to make it a smear drawing" (04:02–04:08), and earlier for the punch
   itself (02:57–02:59) — a third and fourth confirmation of `motion_smear_readability`. Logged as a
   **cross-check**.
6. A same-side counter-rotation detail (the non-striking arm swings backward as the body turns into
   the punch, 01:17–01:21) is a nice specific biomechanical note but not distinct enough from
   existing counterbalance content for its own entry — folded into this paragraph rather than a
   card.

**Contradicted an existing card:** none.

**Cross-checks:** `proximal_to_distal_power_sequencing` (this batch, video 34 — two independent
confirmations, scope extended to the anticipation/wind-up phase), `motion_smear_readability` (two
more confirmations).

**Capture candidate:** none — the video's own footage is either real boxing/taekwondo B-roll (not
this project's to capture, and not demonstrating a Cadence-relevant novel motion beyond what's
already in the queue) or finished 2D anime frames, neither of which Roblox Studio's Animation
Capture applies to.

**Checks for the queue:**
- `check: connecting_frame_exposure_vs_neighbours — compare a declared contact frame's own hold
  duration (key_density) against the hold durations of its immediately preceding and following
  poses; flag a connecting frame held as long as or longer than its neighbours on a fast strike —
  buildable directly from existing key_density data — video 36 @ 04:50–04:59`

**Entries written:** `W04-36-subliminal-single-frame-impact-pose.json`,
`W04-36-anti-realism-readability-tradeoff-for-screen-combat.json`,
`W04-36-expression-and-acting-limb-both-in-frame.json` — all three pass `validateProposedEntry` and
`validateEvidenceSource` cleanly.

### 37. How to ANIMATE SWORD COMBAT Part 1 — Gogan

2026-09-11. The batch's long video (1:17:15) — watched `transcript`-only first as instructed, read
through to roughly the 48-minute mark (a live, screen-recorded Maya blocking-then-spline session
building a four-hit Link sword combo, real-time narration with a lot of "okay, like this" filler
between the genuinely teachable moments), then pulled a focused `efficient`-detail frame sample over
20:00–27:15 (the jump-attack section) for visual confirmation. Did not read or sample the remaining
~29 minutes (spline polish and wrap-up on the combo's back half) — the already-covered ~48 minutes
yielded more than enough distinct, well-evidenced material, and the pattern strongly suggested
diminishing returns (repeated application of already-identified techniques to the 3rd/4th hits).
**If a future session picks up video 37 again, the unwatched back half (roughly 48:00–77:15) is
where to start** — not logged as a separate checklist item since this counts as one watched video,
but worth a note for whoever merges or extends this batch.

**What it teaches, specifically:**
1. A forward-momentum jump-attack launches off the LEADING foot (nearer the travel direction), not
   the trailing one — "it's physically impossible to jump up right off of the back foot" (20:06–
   20:19), confirmed visually in this session's own frames (a lunging, front-leg-forward stride at
   t=20:22 and t=23:00). Wrote **`jump_pushes_off_leading_foot_for_forward_momentum`**.
2. The companion rule for the rest of the same jump: horizontal momentum must stay continuous
   through the apex — "nobody can just jump up, stop at air, and then go straight down... keep that
   momentum and create this nice arc" (26:09–26:39) — a real, precisely measurable projectile-motion
   claim (constant horizontal velocity, reversing vertical velocity) that's directly checkable from
   `sampleMotion`'s existing per-axis series. Wrote **`continuous_horizontal_momentum_through_jump_apex`**.
3. A specific, well-reasoned rig-method choice: the sword arm is posed in IK rather than FK
   specifically so the blade's contact/aim point stays stable while the torso performs its own
   recoil/overlap around it — "I don't want that arm to follow completely with the chest... we want
   the sword to stick and stay there... if the chest is going and then coming back, the sword would
   end up rotating" (39:57–40:41). Connects directly to Cadence's own `solve_ik` and
   `measureContactDrift` (MOT-008) — the exact failure this technique prevents is already a real,
   named measurement in this build. Wrote **`weapon_ik_decoupled_from_torso_overlap`**.
4. A specific, non-obvious game-production requirement stated directly rather than assumed: an
   action's FINAL pose must closely match the declared idle pose, because the engine automatically
   blends back to idle with no dedicated transition — "you don't have a choice, otherwise it's going
   to go back to idle by itself and look like complete garbage" (32:50–33:29). A genuine gap in the
   corpus — distinct from, and the mirror-image companion to, this batch's own
   `idle_pose_as_blend_hub_constrains_extremity` (video 33). Wrote
   **`action_end_pose_must_match_idle_for_automatic_blend`**.
5. Easing INTO a fast strike was live-demonstrated (tried both ways on screen) to weaken it —
   "space equals speed equals power... if we ease into that it's going to completely diminish it...
   [tries it]... that just weakens it" (41:56–42:27) — a strong third confirmation of this batch's
   own `peak_spacing_immediately_before_impact` (video 34), this time with a direct A/B demonstration
   rather than just a stated rule. Logged as a **cross-check**.
6. "Something people miss a lot is the elbow" and a repeated insistence on full arm extension for a
   powerful stab (04:27–05:05, 17:41–17:44) reinforces `proximal_to_distal_power_sequencing` /
   `reach_pose_calibrated_against_placeholder_target` (video 34) — a fourth+ confirmation across the
   batch. Logged as a **cross-check**.
7. The classic "go opposite before you commit" anticipation principle, restated memorably for a
   weight shift ("before you can go back on a weight shift you have to go forward a little bit...
   turn right to go left," 45:19–46:14) — a clean confirmation of the compiled `anticipation`
   principle and this batch's own `overshoot_recoil_settle_pose_sequence`. Logged as a
   **cross-check**.
8. Two workflow-efficiency habits — reusing an already-working pose via copy/paste rather than
   rebuilding it ("that's like a pro tip... if you have a pose that is working, use it," 15:19–15:38)
   and trusting Maya's own default interpolation across a large cross-pose gap as a free rough
   breakdown to refine rather than reject (24:29–24:50) — are genuine, sensible production habits
   but close enough in spirit to this batch's own `low_frame_rate_draft_pass_for_fast_iteration`
   (video 35) that they're recorded here in prose rather than as separate entries.

**Contradicted an existing card:** none.

**Cross-checks:** `peak_spacing_immediately_before_impact` (video 34, live A/B-demonstrated),
`proximal_to_distal_power_sequencing` / `reach_pose_calibrated_against_placeholder_target` (video
34), `anticipation` (compiled) / `overshoot_recoil_settle_pose_sequence` (video 31).

**Capture candidate:** none — a Maya viewport screen recording throughout.

**Checks for the queue:**
- `check: horizontal_velocity_continuity_at_apex — find the frame where a tracked root's vertical
  linear_velocity crosses zero (the apex) and confirm horizontal linear_velocity at that frame is
  non-zero and sign-consistent with its neighbours — buildable directly from sampleMotion's
  existing per-axis series — video 37 @ 26:09–26:39`
- `check: launch_foot_matches_travel_direction — given a declared forward travel direction and two
  foot contacts, confirm the LATER-releasing foot (via measureContactDrift) is the leading one
  relative to that direction — buildable from existing contact-drift data — video 37 @ 20:06–20:19`
- `check: weapon_contact_drift_during_parent_overlap — for an IK-held weapon effector declared in
  contact, confirm measureContactDrift stays near zero across a span where the parent chain (torso)
  is itself in a recoil/overlap phase — buildable directly from existing MOT-008 data — video 37 @
  39:57–40:41`

**Entries written:** `W04-37-jump-pushes-off-leading-foot-for-forward-momentum.json`,
`W04-37-continuous-horizontal-momentum-through-jump-apex.json`,
`W04-37-weapon-ik-decoupled-from-torso-overlap.json`,
`W04-37-action-end-pose-must-match-idle-for-automatic-blend.json` — all four pass
`validateProposedEntry` and `validateEvidenceSource` cleanly.

### 38. How to Animate a Sword Fight: Full Creative Process — Winged Canvas

2026-09-11. Watched at `balanced` detail (39 frames from a 39-candidate pass across the full 15:39
run — a naturally sparse-scene 2D drawing screen recording, so effectively every scene change was
kept). A rotoscoping-and-adaptation tutorial: studying a real film fight scene (a Michelle Yeoh
sword sequence) for line of action and footwork, then hand-drawing an adapted version. Billed by
the batch list as covering "choreography, staging and camera," but the video itself (this appears
to be part of a series, ending right after cleanup with a "part 2" teased for refinement) doesn't
actually get to camera work — worth noting honestly rather than forcing a camera-related entry that
isn't really there.

**What it teaches, specifically:**
1. A genuinely distinct reference technique from anything already in the corpus: when filmed
   reference doesn't clearly show a body part (occlusion, motion blur, a bad angle), infer its
   likely position from what the VISIBLE, mechanically-connected parts imply, rather than leaving it
   undrawn or guessing with no grounding — "in this first image, I can't see where her leg is, but...
   in order for her leg to be like this, her left foot probably has to be in front" (03:45–04:04),
   and again for a fully motion-blurred pose: "I have to kind of infer and make decisions on my own
   as to what is exactly happening" (11:32–14:13). The rotoscoping process itself is directly
   confirmed in this session's frame at t=10:17 (reference film stills beside a red gesture/blue
   refined-figure drawing pair). Wrote **`reference_gap_inference_from_anatomical_plausibility`**,
   which also folds in a second, independent reason to adapt rather than copy a reference exactly
   (beyond gap-filling): a changed camera angle can make a literal copy geometrically impossible in
   the first place (03:19–03:29).
2. Two things tracked deliberately across every reference pose studied — line of action, and foot
   placement — directly confirmed in this session's frame at t=02:27 (a "1) Line of Action,
   2) Placement of feet" summary slide with drawn gesture marks per pose). A clean, well-illustrated
   restatement of existing line-of-action and foot-lock/no-slide content already in the corpus.
   Logged as a **cross-check**.
3. An exposure/timing chart with explicit, reasoned frame-gap counts per transition (a 3-frame hold
   before a slow first pose, 2-frame gaps for "a fast energetic sword swing," an extra hold on a
   major uppercut for "a little bit of slowing down in motion") — confirmed in this session's frame
   at t=13:51 (a visible exposure timeline). A clean, concrete restatement of
   `spacing_subdivision_method_ladder` / `pose_hold_density` / `mixed_hold_pacing_within_phase`.
   Logged as a **cross-check**.
4. Front-foot-plants-stay-put, back-foot-hovers-before-leading-off footwork to avoid a sliding read
   (04:29–05:03) is a clean restatement of the corpus's existing foot-lock/contact-drift content.
   Logged as a **cross-check**.
5. Figure-construction technique (building a gesture from a sphere-plus-limbs mannequin, treating
   shoulders "like spears but don't draw them as spears") is real, useful 2D drawing craft but has
   no Cadence-relevant analogue — Cadence manipulates an existing rig rather than constructing a
   figure from primitives — noted here as out of scope rather than forced into an entry, the same
   judgment call `silhouette_readability_diagnostic_pass` already made for a character-DESIGN
   example.

**Contradicted an existing card:** none.

**Cross-checks:** line-of-action + foot-placement tracking (existing `appeal`/foot-lock content),
`spacing_subdivision_method_ladder` / `pose_hold_density` / `mixed_hold_pacing_within_phase`
(exposure/timing chart), foot-lock/no-slide content (footwork).

**Capture candidate:** none — 2D drawn adaptation of existing film footage throughout; the
underlying film reference is copyrighted third-party material, not something to capture from even
if it showed a cleanly capturable performance.

**Checks for the queue:** none from this video — its genuinely new content
(`reference_gap_inference_from_anatomical_plausibility`) is a pre-authoring reasoning step over
external material, not a property of finished project data.

**Entries written:** `W04-38-reference-gap-inference-from-anatomical-plausibility.json` — passes
`validateProposedEntry` and `validateEvidenceSource` cleanly.

### 39. Breaking Down Attack Animations [Animation] — Masahiro Sakurai on Creating Games

2026-09-11. Watched at `balanced` detail (46 frames from a 46-candidate pass across the full 3:34
run — every scene change kept, real Super Smash Bros. Ultimate gameplay footage throughout with
matching on-screen captions). Short but exceptionally dense and authoritative: Masahiro Sakurai,
director of the Super Smash Bros. series, explaining the exact four-phase attack-animation model
and production parameters used in his own AAA fighting-game work. The single most professionally
authoritative source in this batch, and the best-matched to this batch's own "game-combat phase
template" framing.

**What it teaches, specifically:**
1. A four-phase template — Idle (Atmosphere) → Stance (wind-up/charge) → Attack → Follow-through —
   is a clean, authoritative, precisely-named version of the fighting-game startup/active/recovery
   framework this corpus's `startup_frame_budget` already covers generically, and a strong
   cross-domain confirmation of Cadence's own `TEMPLATES` phase-order concept in `ai/plan.js`. Logged
   as a **cross-check**.
2. The idle-to-stance transition is DELIBERATELY a sudden, large pose jump rather than a smooth
   ease — "a smoother transition between standby and lead-in would take too long" (00:55–01:14,
   confirmed directly on screen in this session's frame at t=01:02, captioned identically) — for two
   named reasons at once: instant input-feedback for the acting player, and the earliest possible
   telegraph for the opponent to react to. A more precisely-reasoned, dual-purpose version of
   `implied_zero_frame_anticipation`'s snap-pose variant. Wrote
   **`abrupt_windup_snap_for_input_feedback_and_telegraph`**.
3. "Hitstop" — a genre-standard mechanic not yet in this corpus: both characters' motion freezes
   briefly at the instant a hit connects, which is exactly why the ATTACK pose itself needs to be
   unusually sharp — "if that's not done well, you could say that everything else falls apart"
   (01:18–01:41, confirmed at t=01:31). Worth naming its relationship to this batch's own
   `subliminal_single_frame_impact_pose` (video 36) explicitly rather than treating them as
   conflicting: one holds an impact pose long enough to be SEEN (hitstop), the other holds it too
   briefly to be seen at all (felt not seen) — both legitimate, opposite choices for the same
   moment. Wrote **`hitstop_freeze_on_confirmed_hit`**.
4. A named, historically-dated mechanic: a declared "cancel frame" partway through follow-through
   lets the player regain control before the return-to-idle animation visually finishes — "this
   mechanism didn't exist until Super Smash Bros. Melee, so you couldn't control the character until
   they completely returned to the idle pose" (02:30–02:39, confirmed at t=02:31). The
   recovery-phase companion to this batch's own `action_end_pose_must_match_idle_for_automatic_
  blend` (video 37) — one is about the visual pose an automatic blend lands on, this is about when
   the PLAYER actually regains control, a separate, gameplay-logic event. Wrote
   **`cancel_frame_ends_forced_recovery_early`**.
5. The four numbers Sakurai states as sufficient to define any attack — idle pose, attack pose,
   attack start frame, total frames (until cancel) — are a striking, authoritative real-production
   match for `authorMotion`'s own declarative philosophy (`phases:[{name, from, to, pose}]`, "this
   compiler will not invent durations"). Logged as a **cross-check** worth flagging explicitly: this
   is independent confirmation from a major shipped game series that Cadence's phase-timing model's
   shape is right.

**Contradicted an existing card:** none.

**Cross-checks:** `startup_frame_budget` / Cadence's own `TEMPLATES` phase order (the four-phase
model), `authorMotion`'s declarative phase-timing philosophy (the four stated parameters).

**Capture candidate:** none — real gameplay footage from a shipped commercial game, not something
to capture from.

**Checks for the queue:**
- `check: attack_pose_sharpness_at_contact_marker — given a declared contact/impact marker, check
  that the pose held there is a genuine extreme (not mid-interpolation) rather than a transitional
  frame; buildable via existing key/marker alignment data — video 39 @ 01:18–01:41`

**Entries written:** `W04-39-abrupt-windup-snap-for-input-feedback-and-telegraph.json`,
`W04-39-hitstop-freeze-on-confirmed-hit.json`, `W04-39-cancel-frame-ends-forced-recovery-early.json`
— all three pass `validateProposedEntry` and `validateEvidenceSource` cleanly.

### 40. Animation vs Choreography — Honored Clarity

2026-09-11. Watched at `balanced` detail (100 frames from a 2597-candidate pass over the full 08:02
run — an extremely fast-cut video-essay montage of clips from many different shipped anime, so the
100-frame budget spreads very thin; only spot-checked a couple of frames against the transcript's
named examples, e.g. t=00:45 confirmed as the Demon Slayer sequence discussed at the video's start,
rather than individually verifying every cited example). **Structurally different from every other
video in this batch**: not a hands-on tutorial but a critique/analysis essay comparing "animation"
(execution quality - smoothness, polish, visual appeal) against "choreography" (why a sequence of
actions was chosen - tactics, emotion, story) as two separable axes of a fight scene's quality,
argued across five real, named, shipped examples on both sides of the split.

**What it teaches, specifically:**
1. The core framework: animation execution and choreographic intent do not predict each other, and
   across the video's own examples, strong intent consistently carries weak execution more
   successfully than strong execution carries weak intent does. The diagnostic question offered
   directly: "read the intent behind it and not just the pixels. If you can follow and see the goal
   behind every movement, then chances are choreography is winning" (06:40–06:52). **This maps with
   striking precision onto `ai/review.js`'s own existing `QUALITY_LAYERS`**: layer 1, "intent and
   purpose," already sits at the TOP of Part 14's thirteen-layer hierarchy, already stated as
   measurable only "partly... by the AcceptanceSpec, when one is supplied — otherwise nothing here
   knows what the shot is FOR" — exactly this video's "choreography" axis, independently arrived at
   from anime criticism rather than from the directive. The video's own repeated real examples (One
   Punch Man S2's budget-starved but tactically legible Garou fight, 2016 Berserk's "ugly frames but
   the choreography respects the characters fighting") are real-world evidence FOR the hierarchy's
   own ordering principle and its named anti-patterns (e.g. "do not add beautiful secondary motion
   to a weak pose") — the same asymmetry, independently confirmed. Wrote
   **`choreographic_intent_matches_quality_layer_one`**.
2. Everything else in the video (specific anime title commentary, production-budget history,
   opinions on individual shows) is film/anime criticism rather than animation TECHNIQUE, and isn't
   written up further — the one entry above is this video's real, substantial contribution to the
   corpus.

**Contradicted an existing card:** none. If anything, this is the strongest independent CONFIRMATION
in the whole batch of an existing piece of Cadence's own architecture (the quality-layer ordering),
arrived at completely independently from anime criticism rather than from reading the directive.

**Cross-checks:** none formally separate from the one entry above, since the entry's whole content
IS the cross-check (real-world evidence for `QUALITY_LAYERS`' existing layer-1 priority).

**Capture candidate:** none — clips from many different shipped, copyrighted anime, not something to
capture from.

**Checks for the queue:** none — this video's contribution is conceptual/architectural
(confirmation of an existing design decision), not a new measurable motion property.

**Entries written:** `W04-40-choreographic-intent-matches-quality-layer-one.json` — passes
`validateProposedEntry` and `validateEvidenceSource` cleanly.

---

## Batch summary (all ten videos watched, 2026-09-11)

**24 knowledge entries** written across all ten videos (2+2+3+3+2+3+4+1+3+1 for videos 31–40 in
order), all passing both `validateProposedEntry` and `validateEvidenceSource` cleanly (checked
individually per video as written, and this count re-verified by listing the actual inbox files
before writing this summary — the first draft of this paragraph said 30, caught only by re-running
the count rather than trusting the running mental tally, the same habit W03's own notes flagged).
Zero refused, zero placeholder fields. No existing knowledge-base card was contradicted by any of the ten videos —
every apparent overlap resolved to either a genuine cross-check (a confirmation, logged as such,
never rewritten as a new entry) or a distinct-enough claim to justify its own entry, with the
relationship stated explicitly in `interactions` either way.

**One capture candidate**: a real, filmed (not drawn or rendered) human jump-and-landing reference
at video 31 @ 08:26–08:33 and 11:28–11:34 — found only after a full-video pass's sparse sampling
missed it and a focused local re-extraction was run specifically to check a B-roll clip. Genuinely
more directly usable for Roblox Studio's Animation Capture → Body than most of the existing capture
queue, which is mostly 2D or rendered-game reference.

**11 buildable checks** queued (video 31 ×2, video 32 ×2, video 34 ×2, video 36 ×1, video 37 ×3,
video 39 ×1 — counted directly from the `check:` lines above rather than estimated; see each
video's own section for the exact list, not re-duplicated here).

**The throughline across this batch, the way W02's was "the chain" and W03's was "weight-transfer
gates locomotion"**: **a single named intermediate frame carries a disproportionate share of the
signal, across three unrelated angles.** Video 31's breakdown TIME placement (estimated from a
physical event, not the arithmetic midpoint) redistributes an ease-out-in split. Video 34's
breakdown POSE — the torso/foot already arrived while the fist still trails — is literally how a
punch gets its power, independently reconfirmed twice more in video 36 (a boxing wind-up, a
taekwondo kick) with its scope extended to the anticipation phase. Video 39's cancel frame decouples
the player's REGAINED CONTROL from the animation's own visual completion. Three different fields on
the same underlying object (a declared frame within a phase) turn out to be doing three genuinely
different kinds of work — timing, power delivery, and control-state — which is worth a future
session's attention if it ever tries to unify them into one concept rather than three. `ai/plan.js
authorMotion`'s existing breakdown mechanism (POSE BIAS at a declared TIME, per its own source
comment) already has the right SHAPE for the first two; the third (cancel frame) is gameplay-logic
scope this batch is careful to say Cadence has no business enforcing.

**Two smaller cross-cutting findings worth a future session's attention:**
- **Reference-gathering has (at least) three legitimate, distinct patterns now on record**, not one:
  measured self-performance (`physical_reference_timing_method`, W01), blended multi-source
  inspiration (`multi_source_reference_blend_not_measured`, this batch), and single-source gap-filling
  by anatomical inference (`reference_gap_inference_from_anatomical_plausibility`, this batch). A
  future session collecting reference-technique cards together would find all three worth reading as
  one family.
- **The idle/action blend seam is now covered from both directions, both within this same batch**:
  `idle_pose_as_blend_hub_constrains_extremity` (video 33, why the idle pose itself must stay
  moderate) and `action_end_pose_must_match_idle_for_automatic_blend` (video 37, why an action's
  FINAL pose must stay close to idle) are two halves of the same automatic-engine-blend problem,
  found in two unrelated videos four videos apart, neither one citing or aware of the other when
  written.

**What changed in the code because of this batch:** nothing yet, deliberately, matching every prior
batch's own discipline — this is a knowledge- and queue-producing pass, not a building one. The
`weapon_ik_decoupled_from_torso_overlap` entry (video 37) is the strongest immediate case FOR
building something (it names an existing measurement, `measureContactDrift`, that would catch
exactly the failure the entry describes, on a rig setup this corpus has never discussed before) —
worth a building session's attention alongside check #10 from the existing queue.

**One structural note for the merge session**: video 37 (77:15, the batch's long video) was watched
`transcript`-first per its own instruction and read to roughly the 48-minute mark before stopping —
the back half (~48:00–77:15) was never read. If a future session wants the rest of that video's
content, it should re-open `https://youtu.be/sBNDzqO8ZT8` at `--start 48:00` rather than assuming
video 37 is fully exhausted just because it is ticked here as watched.

**Next session should start from:** all ten W04 videos are watched — W05 (videos 41–50, "C. Game
animation talks and analysis," ~354 min) is the next unwatched batch.
