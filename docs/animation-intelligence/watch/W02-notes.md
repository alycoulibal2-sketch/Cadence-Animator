# Watch session W02 notes — videos 11–20

## Checklist

- [x] 11. The #1 Animation Principle (How To In-Between) — NobleFrugal Studio (12:41) — https://youtu.be/6UXjRCORV44
- [x] 12. Animation Principles / Everything Moves in Arcs / Animating Classic Motion — Russ Edmonds Animation (10:31) — https://youtu.be/thDT-4RjAeo
- [x] 13. Animating with Arcs — The Art of Aaron Blaise (6:03) — https://youtu.be/GHf8ie4Nq9Y
- [x] 14. 12 Principles of Animation - Follow Through and Overlapping Action Tutorial — Arree Chung (19:54) — https://youtu.be/t_gH-OADlSw
- [x] 15. Should you PLAN your animation? — Alex Grigg // Animation for Anyone (5:01) — https://youtu.be/ABCUjauQBI4
- [ ] 16. Easy animation with overshoot and anticipation - Blender Tutorial — Joey Carlino (10:27) — https://youtu.be/DLzcSSzVjeI
- [ ] 17. Body Mechanics - Maya Beginner's Animation Tutorial | In 5 simple steps — Learn CGI with Yawyee (23:22) — https://youtu.be/7CBcvu8HLEQ
- [ ] 18. 3 Coco Animation Tips [On Body Mechanics] — Rusty Animator (10:26) — https://youtu.be/fFf8EsPC_ws
- [ ] 19. Animating HEAVY Weight (Objects, Punches, Throwing) — Sir Wade Neistadt (10:16) — https://youtu.be/ZYKAMCZq2UI
- [ ] 20. Weight in Animation (Tutorial) — Alessandro Camporota (12:39) — https://youtu.be/b3oIxjzdMqY

## Per-video notes

### 11. The #1 Animation Principle (How To In-Between) — 2026-09-11

Watched at `balanced` detail (22 scene-aware frames over 12:40, all 22 read) plus the full 321-segment
caption transcript. This is a screen-recorded Clip Studio Paint tutorial with a ~55-second sponsor
segment (Clip Studio Paint ad, t≈0:37–1:34) spliced in right after the intro — confirmed directly on
screen and excluded from evidence entirely, it teaches nothing. Coverage is honestly uneven: the tool's
own sparse-coverage warning fired for this 12:41 video, and in practice all 22 scene-change frames
landed in the first 1:32 (intro + the sponsor read) plus three more at 8:18, 12:18 and 12:21 — meaning
the ENTIRE substantive lesson (definitions, the halves/thirds/favors spacing methods, the stopwatch
timing method, the hammer-slam demo build) between roughly 1:36 and 12:10 has exactly one supporting
frame (8:18, a real multi-row Clip Studio exposure-sheet/timeline glimpse mid-lesson). Every entry below
rests on the transcript for its core claim; noted plainly in each `evidence_status` rather than implied.

**Cross-check:** confirms `timing`, `slow_in_slow_out`, and `pose_workflow` closely — the FPS-vs-DPS
distinction ("FPS sets the maximum DPS") is the same "drawing on ones/twos/threes" idea `pose_hold_density`
(W01 video 1) already names, restated with sharper, more exact vocabulary (FPS as a fixed ceiling, DPS as
the actual choice). The keys→extremes→breakdowns→timing-chart production vocabulary and a literal on-screen
"TIMING / SPACING" chart graphic (tick marks along a curved line between two labeled points, in the sponsor
segment's own branding art, frame at t≈1:25) is now confirmed from a THIRD independent source after videos
8 and 9 (Dong Chang) in W01 — good triple cross-confirmation, no new content, still a production-notation
convention outside what Cadence represents (per W01-8's existing reasoning). The stopwatch-to-frame-count
timing method ("time yourself...multiply by your FPS") is a third independent confirmation of
`physical_reference_timing_method` (W01 video 9) — same technique, no new entry. No contradictions of any
existing card.

**Two new entries:**
1. **Spacing subdivision method ladder** (`W02-11-spacing-subdivision-method-ladder.json`) — three named,
   explicitly defined methods for placing a new in-between: halves (bisect remaining space — needs many
   frames, reads smooth), thirds (take a third — snappier, for building/losing momentum quickly), and
   favors (an unmeasured small nudge toward one key, no fixed fraction — the snappiest, explicitly the
   rescue technique "in a pinch" with almost no frames, down to a worked 4-frame example). W01-8 already
   named "favor" as a preference for asymmetric spacing; this entry adds the two other rungs and the
   frame-budget-driven logic for choosing between all three, which W01-8 didn't cover (video @ 6:59–8:01,
   with the numeric halves walkthrough at 6:42–6:53 and the hammer-slam favor demo at 9:44–9:52 — both
   inside the uncaptured stretch, transcript-only).
2. **DPS floor for short actions** (`W02-11-dps-floor-for-short-actions.json`) — a concrete, quantified
   breaking case connecting `pose_hold_density` (W01 v1) to `startup_frame_budget` (W01 v2): a five-frame
   run cycle animated on twos yields poses only on frames 1/3/5 — three poses, "looks strange" — while the
   same five frames on ones yields five poses and reads naturally. States the general rule (a hold-density
   habit must shrink as an action's own frame budget shrinks) rather than just the one example (video @
   4:14–4:39, audio-only — no frame anywhere near this timestamp).

**Other observations, no new entry:** the "four types of motion" tease (constant vs. accelerating, refined
into four categories) is deferred to a linked video with zero content shown here — not usable. The visible
timeline/exposure-sheet panel at t=8:18 (multiple keyframe rows, a picture-in-picture of the artist's hands)
confirms a real production dope-sheet workflow consistent with W01-8/9's independent descriptions, but adds
nothing new; individual frame numbers on it are not legible at this resolution.

**Capture candidates:** none — the hammer-slam demonstration is a 2D hand-drawn cartoon mascot, not a
performed or 3D motion.

**Checks for a later session to implement:**
- `check: spacing_subdivision_signature — classify a measured velocity/acceleration curve (ai/motion.js sampleMotion) between two keys as halves-shaped (graduated, roughly symmetric), thirds-shaped, or favors-shaped (a sharp, late spike close to one key) — descriptive signature, not a pass/fail — video 11 @ 6:59–8:01`
- `check: dps_floor_vs_action_duration — compare existing key density (ai/motion.js keyDensity) against an action's own total frame count — flag when the resulting pose count falls below what the action's speed plausibly needs to read (the video's own example: 3 poses for a 5-frame run cycle is too few) — video 11 @ 4:14–4:39`

**Entries written:** 2 (`W02-11-spacing-subdivision-method-ladder.json`, `W02-11-dps-floor-for-short-actions.json`), both passed `validateProposedEntry` cleanly (checked directly against the live `ai/knowledge.js` module — 0 problems, 20/20 fields, on both).

### 12. Animation Principles / Everything Moves in Arcs / Animating Classic Motion — 2026-09-11

Watched at `balanced` detail (9 scene-aware frames over 10:31, all 9 read) plus the full 154-segment
caption transcript. A veteran Disney animator (end card confirms **Russ Edmonds**, correcting an
auto-caption mis-hearing of "Brett Edmonds" at 0:13 — resolved by reading the frame, not assumed) showing
an excerpt of a longer Patreon tutorial: drawing a full head-turn for an original character ("Carl the
Raccoon") live, narrating his own arc-tracking process throughout. Coverage is honest but thin for a
10:31 video under the tool's own sparse-coverage warning: only 9 frames total, with the two richest
teaching stretches (the numeric frame-charting revision at 3:41–4:28, and the "obscure arcs" explanation
at 8:36–9:18) both falling in unsampled gaps — every claim below is transcript-sourced and says so.

**Cross-check:** confirms the existing `arcs` card thoroughly — "I've yet to see a straight line in
nature," exaggerating even subtle arcs, and tracking multiple body points through a turn all match
directly. Confirms `structural_understanding`'s volume concern from a new angle: "make sure the volumes
are the same on the extremes — if they're wrong, all the in-betweens will be wrong" states a concrete
downstream-failure reason for extreme-pose volume consistency that card doesn't currently give; not filed
as its own entry since Cadence has no mesh volume at all (per `squash_stretch`'s own cadence_representation)
— a 2D-drawing-specific problem with no honest Cadence angle, kept here as a note rather than forced into
an entry. No contradictions.

**Three new entries:**
1. **Obscure arcs** (`W02-12-obscure-arcs.json`) — Edmonds' own named term for the arcs secondary tracked
   points (cheek tips, ear tips, eyebrows) trace during a 3D head turn, which do NOT match the main arc
   (nose/eyes) because those points are also subject to perspective foreshortening — explicitly described
   as looking "wrong" at first glance but necessary for 3D believability (video @ 8:36–9:18). Directly
   relevant to Cadence: since poses here are real 3D FK solves rather than drawn approximations, this
   "obscure arc" problem a 2D animator labors over by hand is already solved for free by the rig — but
   nothing in this build currently distinguishes an obscure arc's healthy divergence from a real defect.
2. **Float-to-stop settle** (`W02-12-float-to-stop-settle.json`) — a two-stage arrival distinct from both
   a plain ease and `overshoot`: reach a near-final pose fairly directly, then drift almost imperceptibly
   the rest of the way, rather than one continuous decelerating curve. Caught live as Edmonds revises his
   own numeric chart on screen — originally a straight ease from frame 5 to 15, changed mid-demonstration
   to hit the main pose at frame 11 and float to a stop by frame 19 (video @ 3:41–4:28). More specific than
   the nearest existing dimension (`settle_duration`, not implemented, and a single uniform lengthening
   even if it were) — this names a two-speed CURVE SHAPE that dimension doesn't cover.
3. **Discontinuity concealment via visibility gap** (`W02-12-discontinuity-concealment-via-visibility-gap.json`)
   — closing the raccoon's eyes at the start of the turn specifically so the eye-direction target can
   change without an awkward mid-turn redraw (video @ 5:09–5:12). Filed generalized beyond eyes (a prop
   swap or rig retarget hidden behind a blink/flash/occlusion is the same trick), since Cadence has no
   facial rig to apply the literal source example to at all.

**Other observations, no new entry:** the "red is behind, blue is ahead" in-betweening color convention
(4:55–4:58) is a production/authoring convention with no Cadence angle, same category as the spacing-chart
notation already flagged in W01. "Punch the timing" as a distinct pass AFTER in-betweening is finished
(8:06–8:16) is a workflow-sequencing observation (extremes → breakdowns → in-between → THEN retime), related
to but not the same claim as `pose_workflow`'s pose-to-pose/straight-ahead choice — interesting but not
independently measurable, kept as a note. "Main action arc," "secondary action arc," and "oblique arc" are
named up front (0:50–0:58) as three categories, but only "main action arc" and (later, separately named)
"obscure arc" are actually defined and demonstrated in this excerpt — "secondary action arc" and "oblique
arc" are presumably covered in the full 40-minute Patreon tutorial this clip is drawn from, not this one.

**Capture candidates:** none — the raccoon head-turn is a 2D hand-drawn demonstration, not a performed or
3D motion.

**Checks for a later session to implement:**
- `check: obscure_arc_vs_main_arc_divergence — compare per-frame curvature (ai/motion.js, MOT-005) of a declared secondary tracked part against the main tracked part's curvature during a turn — a moderate divergence is EXPECTED and healthy, not itself a defect — video 12 @ 8:36–9:18`
- `check: float_signature_detection — a measured velocity curve (ai/motion.js sampleMotion) showing two distinct low-speed regions rather than one smooth decay to zero — video 12 @ 3:41–4:28`
- `check: value_change_visibility_gap_coverage — cross-reference a property track's discontinuous change against a visibility/transparency track on the same or a related part, confirming the change lands entirely within a hidden span — video 12 @ 5:09–5:12`

**Entries written:** 3 (`W02-12-obscure-arcs.json`, `W02-12-float-to-stop-settle.json`, `W02-12-discontinuity-concealment-via-visibility-gap.json`), all passed `validateProposedEntry` cleanly (0 problems, 20/20 fields each).

### 13. Animating with Arcs — 2026-09-11

Watched at `balanced` detail (38 scene-aware frames over 6:03, all 38 read — good coverage for this
length) plus the full 141-segment caption transcript. Aaron Blaise (35 years in the industry, ex-Disney —
*Brother Bear*, *Lilo & Stitch*, *Beauty and the Beast* directing/animating credits) reviewing arcs on a
real shot in progress from his own 2D short *Snow Bear*, using onion skin to make the shot's arcs visible.

**Cross-check:** confirms the existing `arcs` card thoroughly and specifically — "everything we do is in
arcs," a straight punch still has "a bit of an arc" pulling back and pushing forward, and forgetting arcs
being what makes young animators' work read as "clunky" without an obvious cause, all match directly. No
contradictions.

**One new entry — the video's central technique, directly tied to a measurement already named in this
codebase (W02.md's own brief flagged this video for `bow_studs`):**
- **Onion-skin arc verification** (`W02-13-onion-skin-arc-verification.json`) — Blaise turns on onion skin
  (5 drawings ahead, 5 behind) specifically to VERIFY arcs across an already-posed shot, not to help draw
  it — confirmed directly on screen as a dense, clearly-curved tangle of overlaid lines around the bear's
  arm and head (video @ 2:47, 3:12, 4:00). This is the clearest case in the batch so far of an old manual
  technique that a real Cadence measurement already fully subsumes: `ai/motion.js`'s `bow_studs` (MOT-005)
  computes the exact same "how far does this path bow from a straight line" question directly from the FK
  solve, in studs, for any part, without needing a human eye to read an overlay image. The entry states the
  boundary honestly too: `bow_studs` describes a path, it doesn't judge whether the arc is the RIGHT amount
  (`distance_to_expected_arc` stays `implemented: false`), the same limit onion-skinning has when a human
  eye does the same judgement call.

**Other observations, no new entry:** the video's point about three-dimensional arcs — motion toward/away
from camera should still arc, not just travel a straight depth-axis line (video @ 2:59–3:11) — is folded
into the entry's `examples` rather than filed separately; worth flagging plainly here though: this is a
case where Cadence's full 3D pose data makes the concern largely moot for ROTATION-driven motion (a real 3D
FK solve doesn't have a "flatten to 2D" step to forget), but a pure linear POSITION interpolation between
two 3D points is still exactly as straight a line in 3D as in 2D — `bow_studs` would correctly report zero
bow on such a path, so the underlying principle still applies to position tracks specifically, just not to
rotation-driven arcs the way it constantly threatens a 2D drawing.

**Capture candidates:** none — *Snow Bear* is a 2D hand-drawn short; no 3D/performed reference here.

**Checks for a later session to implement:** none beyond what the existing `arcs` card's own
`detection_and_measurement_methods` already covers — this video confirms `bow_studs` is the right existing
measurement rather than pointing at a new one.

**Entries written:** 1 (`W02-13-onion-skin-arc-verification.json`), passed `validateProposedEntry` cleanly (0 problems, 20/20 fields).

### 14. 12 Principles of Animation - Follow Through and Overlapping Action Tutorial — 2026-09-11

Watched at `balanced` detail (38 scene-aware frames over 19:54, all 38 read) plus the full 349-segment
caption transcript. Arree Chung (children's-book illustrator/animator, *Ninja!* series) teaching kids/
beginners to animate a bunny character's ears and cape as secondary action, drawing directly on an iPad.
Coverage is reasonable for a video this long (well above the tool's 10-minute best-accuracy guidance) —
frames land in useful clusters near most of the key discussion points, including one frame that directly
captures the video's own labelled diagram.

**Cross-check:** confirms the existing `follow_through_overlap` card thoroughly — trailing parts continuing
after the main action stops, a mechanical style needing none of it, and cloth/hair/appendage examples all
match directly. No contradictions. Recurring cross-batch pattern worth flagging to the merge session: THIS
video (animate the primary pose fully, "then you add the follow-through... afterwards"), video 12 ("punch
the timing" as a distinct pass after in-betweening is done), and video 11 (extremes/breakdowns before timing
chart) all independently state some version of "finish stage N completely before starting stage N+1" as a
production-workflow rule — three independent sources, no single entry filed for it since it is a pure
authoring-ORDER convention with no Cadence state to represent (Cadence stores only the resulting keys, not
the order they were authored in), but worth the merge session knowing this is a strongly-recurring theme
across sources should a future workflow-guidance feature ever want it.

**Two new entries:**
1. **Drag → overlap → follow-through sequence** (`W02-14-drag-overlap-follow-through-sequence.json`) — a
   three-stage temporal decomposition of ONE lag event on a trailing part (ears, cape): drag (barely moves
   while the primary action begins), overlap (catches up while the primary is still travelling), follow-
   through (continues and settles, sometimes overshooting, after the primary stops). Directly confirmed on
   screen: a frame at t=4:13 shows the presenter's own diagram labelled "① DRAG", "① overlapping", and
   "② followthrough" across a sequence of bunny-head poses (video @ 2:08–4:04, diagram frame at 4:13). More
   precise than the existing card's single undifferentiated "trails behind" framing — maps onto three
   recognizable REGIONS of the one lead/lag curve `ai/motion.js analyseChain` already measures, rather than
   a single aggregate lag number.
2. **Drag-stretch coupling** (`W02-14-drag-stretch-coupling.json`) — the SAME drag moment on a flexible
   appendage is often authored as both a lag AND a stretch simultaneously ("chances are his ears are
   dragging, and you also want to follow that principle, squash and stretch — so this is a stretch"),
   confirmed again on the cape ("cape is dragging... starting to curve"). This is video evidence for an
   INTERACTION_GRAPH edge that does not currently exist: `follow_through_overlap` and `squash_stretch` have
   no paired entry in the existing graph at all, despite both individual cards existing — flagging this
   explicitly for the merge/build session rather than editing the graph myself (out of scope for this batch).

**Other observations, no new entry:** center-lines drawn to track facing direction, per-part color coding
(blue ears / red cape), and separate named layers are all production/authoring conventions with no Cadence
angle, same category as W01's dope-sheet and "red behind, blue ahead" notes. The "bounce back a bit" at the
end of a follow-through phase is the existing `overshoot` dimension, not new.

**Capture candidates:** none — a 2D hand-drawn iPad demonstration throughout.

**Checks for a later session to implement:**
- `check: drag_overlap_followthrough_staging — segment a measured chain lead/lag curve (ai/motion.js analyseChain) into three temporal regions (low relative motion / catching-up / post-primary continuation) and confirm all three are present rather than a single flat offset — video 14 @ 2:08–4:04`
- `check: drag_stretch_coupling_presence — for a trailing item under `secondary_delay`, confirm a corresponding `motion_amplitude`/`weight_transfer` pull exists on the same item during its drag window, rather than lag alone — video 14 @ 11:19–12:03`

**Entries written:** 2 (`W02-14-drag-overlap-follow-through-sequence.json`, `W02-14-drag-stretch-coupling.json`), both passed `validateProposedEntry` cleanly (0 problems, 20/20 fields each).

### 15. Should you PLAN your animation? — 2026-09-11

Watched at `balanced` detail (67 scene-aware frames over 5:01, all 67 read — good coverage) plus the full
156-segment caption transcript. Alex Grigg (Animation for Anyone) on straight-ahead vs. keyframing
(pose-to-pose), with a hike/route-planning analogy and specific genre-keyed rules of thumb, illustrated
with the presenter's own portfolio clips (a fire/explosion effects shot, TVPaint software, and a real
3D-rigged bird/chicken with a visible graph editor, credited to Ben Hubbard).

**Cross-check:** confirms and sharpens the existing `pose_workflow` card directly. That card already lists
"straight-ahead: organic motion, effects, creature movement" and "pose-to-pose: deliberate character
performance... controlled production pipelines" as use cases — this video independently arrives at the
same split (effects → straight-ahead; 3D character work → keyframing) from a working professional's own
practice, with a concrete MECHANICAL reason the existing card doesn't state: 3D keyframing is recommended
specifically because "it's almost impossible to keep your graph editor clean if you're creating new
keyframes for every frame" — directly confirmed on screen with a real Maya-style graph editor under a
rigged 3D character (video @ 3:51). Worth noting as a quiet validation of Cadence's own architecture: the
reason a working professional gives for preferring keyframing on 3D character rigs is exactly the
constraint Cadence's `ai/plan.js` already committed to structurally (edit existing keys, never add one).
No contradictions.

**One new entry:**
- **Staged keyframe-then-straight-ahead workflow** (`W02-15-staged-keyframe-then-straight-ahead-workflow.json`)
  — professionals commonly blend the two pure methods within one shot rather than choosing only one:
  plan/keyframe the trickiest or most structural sections, then animate the rest straight-ahead once a
  timing plan already exists. Named examples: stop-motion animators shooting a rough keyframe pass to test
  timing before committing to the required straight-ahead final shoot (video @ 3:38–3:49), and hair/cloth
  follow-through animated straight-ahead specifically AFTER the character body performance is finished
  (video @ 3:16–3:24) — a fourth independent confirmation of the "finish the primary pass before the
  secondary pass" pattern already flagged across videos 11, 12 and 14. Sharpens `pose_workflow`'s existing
  "not represented at all" gap into something more specific: Cadence's key-editing-only architecture could
  represent the KEYFRAME half of this hybrid but structurally has no way to reach the STRAIGHT-AHEAD half
  (progressive new-key insertion), since no strategy in this build may add a key.

**Other observations, no new entry:** the hike/route-planning analogy (video @ 2:01–2:45, illustrated with
a hand-drawn map/scroll graphic at t=2:03) is a clear teaching device but not itself a technique or rule —
kept as context, not filed. The homework prompt (animate the same 2-3 second action both ways and compare)
is a learning exercise, not a Cadence-representable property.

**Capture candidates:** none — illustrative clips only (2D cartoon explainer graphics, a portfolio reel
excerpt, and someone else's 3D demo reel), nothing that is this session's own reference motion to capture.

**Checks for a later session to implement:** none beyond what `pose_workflow`'s own existing (currently
empty) representation would need — this video sharpens the WHY of an existing gap rather than pointing at
a new measurable quantity.

**Entries written:** 1 (`W02-15-staged-keyframe-then-straight-ahead-workflow.json`), passed `validateProposedEntry` cleanly (0 problems, 20/20 fields).
