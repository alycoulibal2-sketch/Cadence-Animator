# W08 notes — videos 71–80 (E. Roblox and Moon Animator)

- [x] 71. How I Animate: An Unofficial Moon Animator 2 Tutorial — Tycoon (45:46)
- [x] 72. How to Animate in ROBLOX the RIGHT way [NEW] {Tutorial} — DatBoiEle (10:47)
- [x] 73. How to Make SUPER SMOOTH Roblox Animations with Moon Animator 2! | Beginner to Pro Tutorial — TnxBlox (16:56)
- [ ] 74. 3 Must-Know Moon Animator 2 TIPS for Better Roblox Animations — TnxBlox (2:41)
- [ ] 75. Make Your Roblox Animations Feel REAL | Roblox Animation Tips 2026 — Devgrams and Draco (8:53)
- [ ] 76. How to Animate a Sword Slash [Moon Animator] — Thundey (24:36)
- [ ] 77. How to ANIMATE a Perfect Sword Swing in Roblox Studio! (EASY) — Nobel Courses (8:01)
- [ ] 78. How to make WEAPON animations in ROBLOX STUDIO! [Moon Animator Tutorial] — MonkeyDev (11:29)
- [ ] 79. How to ANIMATE Tools In Roblox Studio! — Rustysillyband (11:24)
- [ ] 80. ROBLOX VFX Guide #1 - Particles — TrendyV2 (7:14)

---

## Video 71 — How I Animate: An Unofficial Moon Animator 2 Tutorial — Tycoon (45:46)
https://youtu.be/Yzf3iGZis7A — watched 2026-09-12, `efficient` detail, 50 frames (keyframe pass, 190
near-duplicates dropped; a representative ~15 of the 50 read closely against the transcript rather
than all 50 mechanically, since this is a 45-minute screen-recording tutorial where the transcript
already carries the substance precisely and the frames mainly confirm UI state — consistent with why
this video is marked `efficient` rather than `balanced` in the batch list), captions transcript (1467
segments). A general-purpose, very dense Moon Animator 2 walkthrough (a hobbyist's full personal
workflow, not a single-technique tutorial) — five entries written, more than the usual one-to-four,
justified by the content's density the same way W03/W04/W05 batches did on their densest videos.

**`easyweld_join_in_place_preserves_relative_transform`** — Moon Animator's EasyWeld tool has two
attach operations, 'Join' (snaps, loses the hand-placed offset) and 'Join in Place' (preserves the
exact relative transform at the moment of attaching), demonstrated three times (a held cup, a box
lid, a torso-mounted light @ 13:05–17:19, 39:17–39:41). Directly maps onto Cadence's own
`attach_item` — worth a future session actually reading `attach_item`'s implementation to settle
which behaviour it has, since this entry could not determine that from the video alone.

**`r7_custom_rig_lower_torso_decouples_torso_from_legs`** — a community (not Roblox-default) R6
extension adding a lower-torso joint so the torso/arms/head can move independently of the legs,
demonstrated with a real side-by-side walk-cycle comparison showing the R6 legs visibly swaying more
(@ 21:11–23:07). Checked directly against what Cadence targets: R15's own UpperTorso/LowerTorso/Waist
structure already has this independence built in, so this specific pain point is an R6-community
problem Cadence's own R15 target does not share — recorded as useful comparative context (community
reference clips are often R6/R7, not R15) rather than a gap.

**`keyed_decal_property_track_animates_facial_expression_over_time`** — the video builds a full DIY
face rig (four welded, scaled, transparent decal-holding parts on the head @ 23:08–26:06) and then
keys the Decal `Texture` property over the timeline so the expression changes DURING a clip (@
27:11–29:24), not just once per shot. Checked directly against Cadence's own code before writing
this up (not assumed): `rigbuild.js #buildFacePlane` shows `add_face_layer`/`faceLayers` already
gives Cadence a good analogue for the RIG-BUILDING half of this technique (a rendered face-plate
plane with no Parts required), but `state.js setItemFace`'s own comment states `faceLayers` is kept
'separate from the item's animated pose/keyframes' — so today a Cadence face is a static per-item
state (swappable between takes via `apply_face_preset`), not something that can be keyed to change
mid-clip the way this video's Texture track does. That is a real, narrow, in-scope gap (animating an
already-built face, not building one — building one stays out of Cadence's animate-not-model scope
per [[feedback_cadence_scope_modeling_vs_animating]]).

**`single_frame_ghost_marker_for_spacing_reference`** — the 'B' keybind drops one fixed silhouette at
the current pose as a spacing reference (named directly for checking walk-cycle stride length, @
12:36–13:00, confirmed in this session's own frame at t=12:50). Distinct from the existing
`onion_skin_arc_verification` card (many frames, continuous path/arc shape) — this is one frozen
frame, used for absolute distance/spacing rather than path shape. Same family of result as that
card, though: Cadence's stored pose data already contains the exact number a human needs this tool
to eyeball. **New check queued**: `check: stride_distance_between_named_contact_frames — the plain
world-space distance between a named contact effector's position at two specified frames (e.g. two
successive foot-plant frames in a locomotion cycle) — derivable today from existing pose/track data,
no new capability — source: video 71 @ 12:36–13:00`.

**`boundary_key_pair_isolates_constant_velocity_middle_segment`** — a concrete four-key recipe (two
extra boundary keys, `out` leaving the start, `in` arriving at the end, unchanged between the two
inner keys) for getting a genuine accelerate/cruise/decelerate shape rather than one continuous ease
(@ 33:04–34:15, confirmed in this session's own frame at t=34:25 showing the position-time graph).
Directly cross-referenced to the already-queued `check: multi_segment_pacing_signature` (#14 in
LESSONS.md) as a natural positive test case for that check once built, rather than a new check of
its own.

The video also independently confirmed the existing `low_field_of_view_reads_cinematic` card
(W07-67) a third time — FOV 35 for "a cinematic look" (@ 11:14–11:36) — but with a notable nuance
worth flagging for the merge session rather than folding in myself (W07's own files are not mine to
edit per the batch protocol): this presenter explicitly says "I forgot where I got this from, but I
know this was from another animation tutorial," meaning the 35-FOV convention looks like it is being
COPIED between Roblox tutorial creators rather than independently re-derived each time — worth noting
as a cross-check, not a third independent data point, when W07-67 is next touched.

No capture candidate — a screen-recording software tutorial throughout, no filmed human motion.

## Video 72 — How to Animate in ROBLOX the RIGHT way [NEW] {Tutorial} — DatBoiEle (10:47)
https://youtu.be/dqAAa9aubM8 — watched 2026-09-12, `balanced` detail, 92 frames (scene-aware, all 92
candidates kept), captions transcript (355 segments). A comedic, fast-paced personal-workflow recap
covering the same ground as video 71 (blockout poses, M-key smoothing, face decals, camera, export)
in a fifth of the time — mostly confirmations and one genuinely new technique.

**`camera_slaved_to_animated_proxy_part`** (new entry) — rather than keying the camera's own CFrame
directly, attach it to a separate part via an 'Attach to Part' toggle, switch the toggle off to pose
the now-freed part with ordinary move/rotate/keyframe controls (rotation named directly as the main
reason for the indirection), then switch it back on so the camera slaves to the part's keyed motion
on playback (@ 06:56–08:01, confirmed in this session's own frame at t=07:20). Cadence's `add_camera`
already exposes CFrame/FOV as directly keyable tracks, so the specific problem this works around may
not apply — but the video's own emphasis on ROTATION specifically as the reason for the indirection
is worth checking against `add_camera`'s actual rotation support directly rather than assumed.

**Enriched `W08-71-keyed-decal-property-track-animates-face.json`** (my own file from this same
batch, not a W07/earlier-batch file) rather than writing a duplicate: this video confirms the same
keyed-`Decal.Texture` face technique from video 71, but applied directly to R6's own BUILT-IN face
decal with no custom welded parts needed at all (@ 05:20–06:26) — a simpler variant of the same
mechanism, not a different one. Updated that entry's `definition`/`use_cases`/`examples`/
`evidence_status` to cover both variants; the `cadence_representation` finding (today's `faceLayers`
is a static per-item property, not a keyable mid-clip track) is unchanged by this addition.

Cross-checks, not new entries: (1) a third/fourth confirmation of the `low_field_of_view_reads_
cinematic` card's 35-FOV-for-cinematic convention (@ 02:10) — noted, not folded in (W07's file is
not mine to edit); (2) the same 'select all, press M to smooth, then select all again and try quad
in-out, selectively reverting areas that "look clunky" back to linear' workflow already implicit in
video 71's easing content — supporting evidence for the existing spacing/pacing cards, not a new
entry; (3) the full save → export rigs → upload to Roblox → copy animation id → paste into a
play-animation script pipeline (@ 09:06–10:26) — confirms Cadence's own `export_to_studio` already
collapses this entire multi-step manual pipeline into one MCP call, another case (like W07's) of
Cadence's own tooling already being ahead of the manual technique being taught.

No capture candidate — a screen-recording tutorial throughout (the presenter's own on-camera intro
segment is a real person, but shows no motion worth capturing as a reference).

## Video 73 — How to Make SUPER SMOOTH Roblox Animations with Moon Animator 2! — TnxBlox (16:56)
https://youtu.be/EAW6F6PnW0w — watched 2026-09-12, `balanced` detail, 17 frames (scene-aware, 1
near-duplicate dropped — very sparse for 17 minutes, since the screen barely changes from one
continuous Moon Animator panel view throughout), captions transcript (396 segments, noticeably
noisier auto-captions than the previous two videos — several numeric values read off Roblox's move
tool come through garbled, e.g. "six negative 8.14", not treated as reliable evidence below).
Mismatch worth flagging (same discipline as W07): the batch list's one-line gloss for this video says
"easing choices on R15; what 'smooth' costs in weight," but the video is actually an R6 walk-cycle
built from scratch, key spacing (10/5/15-frame cadences), the same keyframe-bisection technique as
videos 71–72, and a torso/head lag offset — no R15 content and no explicit weight discussion.

**`recursive_keyframe_bisection_increases_pose_density`** (new entry) — the clearest, fullest
description yet of the 'M' key technique already glimpsed in videos 71 and 72: selecting a keyframe
span and pressing M inserts an interpolated midpoint key, repeatable to keep halving the span
further ("the more times you press the button, the more times it cuts the frames," @ 13:37–14:13,
confirmed in this session's own frame at t=14:37). With three independent creators now converging on
the identical keybind and mechanism within this one batch, this crossed the bar for its own entry
rather than staying folded into general spacing/density cards — directly measurable today via
`ai/motion.js`'s existing `keyDensity` (the same measurement `dps_floor_for_short_actions`, W02,
already uses), with the gap being a convenience "bisect N times" helper, not a new measurement.

Cross-checks, not new entries: (1) staggering the torso/head's movement cadence a few frames behind
the legs/arms (@ 14:29–15:42) is the same "chain lead/lag" family already covered in depth by nine
W02 entries plus video 71's "keyframe offsetting" — confirmatory, not new; (2) the specific numeric
stud/frame values given for leg and arm offsets are not trusted as evidence here — the auto-captions
for this stretch are visibly garbled (mismatched or nonsensical numbers in several spots) and no
frame lands precisely enough on the property panel to cross-check them visually.

No capture candidate — a screen-recording tutorial throughout, no filmed human motion.

