# W08 notes — videos 71–80 (E. Roblox and Moon Animator)

- [x] 71. How I Animate: An Unofficial Moon Animator 2 Tutorial — Tycoon (45:46)
- [x] 72. How to Animate in ROBLOX the RIGHT way [NEW] {Tutorial} — DatBoiEle (10:47)
- [x] 73. How to Make SUPER SMOOTH Roblox Animations with Moon Animator 2! | Beginner to Pro Tutorial — TnxBlox (16:56)
- [x] 74. 3 Must-Know Moon Animator 2 TIPS for Better Roblox Animations — TnxBlox (2:41)
- [x] 75. Make Your Roblox Animations Feel REAL | Roblox Animation Tips 2026 — Devgrams and Draco (8:53)
- [x] 76. How to Animate a Sword Slash [Moon Animator] — Thundey (24:36)
- [x] 77. How to ANIMATE a Perfect Sword Swing in Roblox Studio! (EASY) — Nobel Courses (8:01)
- [x] 78. How to make WEAPON animations in ROBLOX STUDIO! [Moon Animator Tutorial] — MonkeyDev (11:29)
- [x] 79. How to ANIMATE Tools In Roblox Studio! — Rustysillyband (11:24)
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

## Video 74 — 3 Must-Know Moon Animator 2 TIPS for Better Roblox Animations — TnxBlox (2:41)
https://youtu.be/xQHlThYcgz4 — watched 2026-09-12, `balanced` detail, 22 frames (scene-aware, all 22
candidates kept), captions transcript (50 segments). Same creator as video 73. **Zero new knowledge
entries — an honest null result, not a gap in how it was watched.**

Tip 1 (M-key bisection, @ 00:27–00:59, confirmed in this session's own frame at t=00:53 showing a
before/after split-screen comparison) is the SAME creator (TnxBlox) restating the exact technique
already written up as `recursive_keyframe_bisection_increases_pose_density` from videos 71–73 —
per this programme's own convention (see W07-68's enrichment note), a same-creator restatement is
not independent corroboration and does not change or strengthen that entry further. Tip 2 ("face
movement... can pique the viewer's interest... increase views") and Tip 3 ("never change the topic
of what your animation is mainly about," an audience-retention/narrative-focus point) are both
generic content-creation/channel-growth advice with no demonstrated mechanism, measurement, or
Cadence-relevant hook — confirmed by checking the frames at both timestamps (t=01:17, t=02:14): a
plain character shot with no technique being shown, consistent with the transcript being the whole
content. Neither fits this knowledge base's mechanism-and-measurement shape, so neither was forced
into an entry.

No capture candidate — a screen-recording tutorial throughout, no filmed human motion.

## Video 75 — Make Your Roblox Animations Feel REAL — Devgrams and Draco (8:53)
https://youtu.be/AH30avEEC9A — watched 2026-09-12, `balanced` detail, 12 frames (scene-aware, 1
near-duplicate dropped — sparse, since much of the runtime is a two-person casual talking-head
discussion over screen capture rather than dense UI change), captions transcript (218 segments).
Two presenters (Devgrams live-editing, Draco narrating/discussing) walk through refining an arm
swing into a sword M1 combo hit, then close with personal-improvement advice.

**`calculate_motion_paths_overlays_computed_arc`** — Moon Animator's own 'Calculate Motion Paths'
command draws the exact traced path of a selected effector directly in the 3D viewport (scope:
full range, or the presenter's preferred narrower 'around frame' window, since full-range "gets a
little hectic"), used here to catch and hand-fix a fast sword swing's arc (@ 03:20–04:49, path line
confirmed — blurred by an in-video camera move — in this session's own frame at t=05:59). Distinct
from the existing `onion_skin_arc_verification` card in a way worth being precise about: THAT
technique is a human estimating a path from many overlaid 2D drawings; THIS one is the tool
computing and drawing the exact path from real keyed transform data, one step closer to what
Cadence's own `bow_studs` (MOT-005) already reports as a number rather than a line.

**`reference_clip_framerate_desync_needs_key_stretch`** — a specific, concrete rotoscoping-pipeline
pitfall distinct from the existing `rotoscoping_tracing_live_action_or_cg_reference` (W07-62, which
covers 2D hand-drawn tracing's own failure modes, not this): importing a downloaded reference clip
into Blender at a framerate that doesn't match the project's own desyncs the resulting keys' timing,
fixed by selecting the affected keys as a group and stretching them uniformly rather than by hand,
one by one (@ 07:49–08:01). Not applicable to Cadence today (no reference-video-import pipeline
exists), but worth remembering as a pitfall CLASS if one is ever built.

Cross-check, not a new entry: the M1 combo-swing build (anticipation lean-in, impact, overshoot,
settle, then a deliberate small arm/torso offset "so it's not exactly lined up... a little bit of
overlap," @ 04:52–06:18) restates principles already thoroughly covered (anticipation, overshoot,
chain lead/lag) — including the detail that a combo's next hit starts from the previous hit's end
pose, the same continuity idea `action_end_pose_must_match_idle_for_automatic_blend` (W04-37) already
names for idle blending specifically, just in a combo-chaining context here rather than a new finding.

No capture candidate — a screen-recording/talking-head tutorial throughout, no filmed human motion.

## Video 76 — How to Animate a Sword Slash [Moon Animator] — Thundey (24:36)
https://youtu.be/KneO6y3FebM — watched 2026-09-12, `efficient` detail, 50 frames (keyframe pass, 66
near-duplicates dropped), captions transcript (457 segments). This batch's own promised subject:
"the heavy-attack benchmark's own subject, done by hand in Moon." A full start-to-finish R6 sword
weld + one-handed then two-handed slash build, entirely hands-on with no filler.

**`per_limb_sequential_pass_workflow_with_ghost_reference`** — a genuinely different authoring
METHOD from videos 71/73's whole-body pose-to-pose blocking: animate one limb across the FULL
timeline before moving to the next (torso → head → primary arm → secondary arm → legs last, legs
explicitly last and hardest because Moon Animator has no IK to enforce ground contact), using the
ghost marker at each step to check a new key against its own immediately-prior one (a different role
for that tool than its original walk-cycle-spacing use in W08-71). Checked directly against
`authorMotion`: Cadence's own generation order is the INVERSE (phase-by-phase across all parts, not
limb-by-limb across all phases) — read as evidence this manual workflow is shaped by the absence of
what `authorMotion` already solves analytically, not a technique Cadence lacks.

**`combat_genre_context_raises_acceptable_foot_slide_tolerance`** — a directly-stated, explicit
genre-dependent quality threshold: "it's okay if you make it slide a bit, this isn't a cinematic
animation, it's more of a combat animation" (@ 17:21–17:29, confirmed in this session's own frame at
t=17:30 showing the exact lunging pose this was said over). Directly relevant to `measureContactDrift`
(MOT-008): the drift itself is already fully measurable, but nothing in this build varies the
ACCEPTABLE threshold by declared style/genre (`project.semantics.style`) the way this source's own
judgment does — a real, evidenced, narrow gap rather than a restatement of existing contact-drift
cards.

Cross-checks, not new entries: (1) a percentage-based whole-selection "Drop Time Stretch" tool used
to retime the finished result to 115% (@ 20:50–21:10) is the same operation as Cadence's own
`stretch_frames` — confirmatory; (2) tolerating an "abrupt/snappy" pre-slash inbetween because it's
too brief to be noticed (@ 07:48–07:58) restates the general fast-action tolerance already implicit
in `startup_frame_budget` and siblings; (3) R6-specific minor arm-into-torso clipping tolerance
("as long as it's on the chest, because this is roblox r6," @ 22:11–22:19) folded into the
per-limb-workflow entry's `failure_modes` rather than written up separately.

No capture candidate — a screen-recording tutorial throughout (a block R6 dummy, not a filmed
performer).

## Video 77 — How to ANIMATE a Perfect Sword Swing in Roblox Studio! (EASY) — Nobel Courses (8:01)
https://youtu.be/I1T5Rcm9g3E — watched 2026-09-12, `balanced` detail, 32 frames (scene-aware, all 32
candidates kept), captions transcript (168 segments). Another mismatch worth flagging (third in this
batch, after video 73): the batch list's one-line gloss calls this "a second sword swing to compare
timings against," but the presenter never hand-animates a swing at all — this video is actually about
BUILDING a holdable Tool from raw parts, then downloading and republishing someone else's premade
animation rather than authoring one. No comparable timing data to the sword-slash entries exists.

**`tool_handle_cancollide_massless_grip_editor_construction`** — the mechanical construction of a
holdable Roblox `Tool` (a part renamed 'Handle', `CanCollide=false`, `Massless=true`, then a 'Tool
Grip Editor' plugin sets the hand-grip offset and rotation, @ 02:15–03:48, confirmed in this
session's own frame at t=03:29 showing the Grip Editor panel). Distinct from this batch's earlier
weapon-attachment entries (an authoring-time weld inside an animator) — this is the prerequisite,
in-game-equippable ITEM construction step those assume already happened. Out of Cadence's
animate-not-model scope as a build step, consistent with this batch's video-71 verdict on the DIY
face-plate rig.

**`unlicensed_toolbox_animation_republish_anti_pattern`** — a real, demonstrated anti-pattern (same
category as the merged `vibe_timing_anti_pattern`, W01): downloading a free community toolbox model
purely to extract its bundled animation, then clicking "Publish to Roblox" to create a NEW asset
under the presenter's own account, with no licence check or attribution at any point — presented as
the recommended easy path, the chosen item's own majority thumbs-down ratio noted in passing but not
treated as disqualifying (@ 04:10–05:21, confirmed in this session's own frame at t=06:51 showing the
republished animation live in-game). Not a gap for Cadence — real evidence that this build's existing
`add_to_library` licence-declaration refusal (Part 70/72) guards against a genuinely real, casually-
practiced failure mode, not a hypothetical one.

No capture candidate — a screen-recording tutorial throughout; the swing motion itself is someone
else's uploaded animation, not a filmed performer, and not this presenter's own authored motion.

## Video 78 — How to make WEAPON animations in ROBLOX STUDIO! — MonkeyDev (11:29)
https://youtu.be/UURYhAVph5g — watched 2026-09-12, `balanced` detail, 35 frames (scene-aware, all 35
candidates kept), captions transcript (223 segments). Dense, genuinely hands-on: build a sword swing
in Moon Animator, export and publish it, then wire it into a real `Tool` with a full activation
script — including a live, unscripted debugging detour that turned out valuable in its own right.

**`animation_priority_determines_simultaneous_track_override`** — a genuinely new, structurally
important Roblox concept not previously in the corpus: every animation carries a Priority (Idle <
Movement < Action < Core, confirmed directly) that decides which of several simultaneously-playing
tracks visually wins — an action animation must be Action priority specifically to override a
concurrent Movement-priority locomotion track (@ 01:22–02:00). Checked directly against this build's
own export path: this session could not confirm whether `export_to_studio`/`buildAnimation` sets a
Priority at all, and flagged that as an open question for a future session rather than assumed either
way — a wrong or unset priority is exactly the class of defect invisible until tested against a
concurrent track, which this build's own export path does not do.

**`tool_activated_cooldown_gated_animation_playback`** — the complete runtime script pattern that
actually fires a published animation from a `Tool`: load the AnimationTrack once at `Equipped`, gate
`Activated` behind a boolean cooldown flag, tune the cooldown VALUE as a deliberate gameplay-feel
choice (0.7s, explicitly referenced against Bed Wars' faster spammable feel, not derived from the
clip's own length, @ 10:25–10:36). Outside Cadence's own scope by design (gameplay scripting, not
animating), but recorded as the concrete "what happens after `export_to_studio`" context a user needs.

**Enriched `W08-77-tool-handle-cancollide-massless-grip-editor.json`** (my own file from this same
batch): this video hits a THIRD required Handle property beyond video 77's CanCollide/Massless —
`Anchored` left true silently blocks pickup entirely, tracked down over several confused live minutes
before being identified and fixed (@ 08:06–09:52). Added as a new failure mode and example rather than
a separate entry, since it's the same underlying "Handle property checklist" concept, not a new
mechanism.

No capture candidate — a screen-recording tutorial throughout, a block R6 rig only.

## Video 79 — How to ANIMATE Tools In Roblox Studio! — Rustysillyband (11:24)
https://youtu.be/nKC3-pAtN5g — watched 2026-09-12, `balanced` detail, 59 frames (scene-aware, all 59
candidates kept), captions transcript (295 segments). This batch's own promised subject: "tools,
welds and the hand: the attachment rules `attach_item` mirrors" — and it delivered the single most
directly `attach_item`-relevant finding of the whole batch.

**`authoring_time_weld_and_runtime_grip_are_independent_systems`** (new entry, the batch's most
directly useful finding for `attach_item`) — two completely separate, unsynced attach mechanisms:
(1) a `WeldConstraint` added under a Rig Builder dummy purely so a tool is visible while posing in
the Animation Editor (@ 00:47–02:00), never exported and never referenced again; (2) the real `Tool`'s
own `Grip` CFrame, configured entirely separately, later, on a different instance, which is the ONLY
thing that determines the runtime hand grip. Nothing carries the first into the second — demonstrated
directly by the presenter's own surprise ("my sword grip is a little wonky") followed by five full
playtest cycles of pure trial-and-error CFrame guessing (wrong axis, wrong sign, wrong axis again,
wrong sign again) to find a correct Grip (@ 08:38–10:50, confirmed in this session's own frame at
t=10:39). This directly sharpens the still-open question in `weapon_attach_under_root_avoids_
subframe_chain_desync` (W05-43): in the real pipeline, an authoring attach offset is NOT
automatically a runtime Grip — if `attach_item`'s own exact, computed offset isn't already being
carried through `export_to_studio` into a derived Grip, that gap is exactly what this five-cycle
guessing process is real evidence would be worth closing.

**Enriched `W08-78-tool-activated-cooldown-gated-animation-playback.json`** (my own file from this
same batch): this video's own near-identical activation script adds a load-bearing detail the first
lacked entirely — whether the script is a LocalScript (animation visible only to the activating
player) or a server Script (visible to everyone) is a deliberate, stated choice with real gameplay
consequences, not an implementation detail. Folded in as a new failure mode, example, and
evidence_status entry rather than a separate concept.

Cross-check, not a new entry: the Creator-account-vs-group publishing distinction ("if you're making
a game within a group... otherwise the animation is not going to work for everybody," @ 03:22–03:54)
is a real, specific team-workflow gotcha but has no mechanism/measurement shape to write up — noted
here for the merge session's awareness rather than forced into an entry.

No capture candidate — a screen-recording tutorial throughout, a block R15 rig only.

