# W05 notes — videos 41–50 (C. Game animation talks and analysis)

## Checklist

- [x] 41. Animation Bootcamp: An Indie Approach to Procedural Animation — GDC (26:13) — https://youtu.be/LNidsMesxSE
- [x] 42. Animation Bootcamp: 2018 Tricks of the Trade — GDC (31:10) — https://youtu.be/o1tti636Kag
- [x] 43. Animation Bootcamp: The First Person Animation of Overwatch — GDC (34:03) — https://youtu.be/7t0hLZd_8Z4
- [x] 44. How Overwatch Conveys Character in First Person — New Frame Plus (15:32) — https://youtu.be/7Dga-UqdBR8
- [x] 45. Animation Bootcamp: Animating Cameras for Games — GDC (26:26) — https://youtu.be/hP1Vz70WouE
- [x] 46. Animation Bootcamp: Script to Screen: The Development Diary of Marvel's Spider-Man — GDC (31:13) — https://youtu.be/r_rJJyIPrmM
- [x] 47. Evolving Combat in 'God of War' for a New Perspective — GDC (59:52) — https://youtu.be/hE5tWF-Ou2k
- [x] 48. Keyframes and Cardboard Props: The Cinematic Process Behind 'God of War' — GDC (54:01) — https://youtu.be/MNinZWlhprE
- [x] 49. Unsynced: The Last of Us Melee System — GDC (54:20) — https://youtu.be/Ox2H3kUQByo
- [x] 50. Making Fluid and Powerful Animations For 'Skullgirls' — GDC (21:06) — https://youtu.be/Mw0h9WmBlsw

## Per-video notes

### 41. Animation Bootcamp: An Indie Approach to Procedural Animation — GDC (David Rosen, Wolfire Games)

2026-09-11. Watched at `transcript` detail (603 caption segments, no frames — captions came back clean
and coherent on the first pull, no retry needed). An exceptionally dense, specific talk: Rosen walks
through Overgrowth's entire procedural-animation stack from a single physics sphere to ragdoll-blend
death staging, with concrete parameter counts throughout ("13 keyframes" cover the whole locomotion
set) rather than vague description.

**What it teaches, specifically:**
1. The talk's own throughline, and the one W05.md names for this video: movement (physics-driven,
   input-mapped, works with zero animation attached) must be built and correct BEFORE any animation
   is layered on top — stated explicitly as "a Hippocratic oath for game animation... at first, do no
   harm to the gameplay" (03:30–04:38). Wrote **`procedural_movement_precedes_cosmetic_animation`**.
2. Root translation computed from leg-cycle phase via a "surveyor-wheel-like technique" rather than
   from clip length, so footfalls stay synced to the ground at ANY speed — and critically, when
   blending two authored speeds (walk/run), the STRIDE SIZE is blended together with the pose, not
   independently, or intermediate speeds mis-place the feet (05:23–06:19). Wrote
   **`cycle_phase_driven_root_translation`**.
3. Linear and cubic interpolation between poses both produce a "sudden velocity jar"; a spring-damper
   system (two parameters: stiffness, damping) fixes this AND generates emergent ease-in/overshoot/
   follow-through for free, reused identically across every stand/crouch/run pose-pair, and reused
   again to absorb landings by adding a downward force to the same crouch spring rather than
   authoring a separate landing clip (07:53–08:58). This is a genuinely different mechanism from
   anything in the existing corpus — not a curve shape, a live simulation — so it does not collapse
   into `shared_mechanism_anticipation_overshoot` (W02), it's cross-referenced as a fourth mechanism
   for that same entry's overshoot-and-settle shape instead. Wrote
   **`spring_damper_pose_transition_interpolation`**.
4. One ledge-grab keyframe plus two-bone IK generates an entire continuous shimmy range ("seemed
   easier than making a hundred different variations in Blender", 11:38–12:06) — but in the Q&A,
   asked directly whether IK could do the same for a held-object hand pose, Rosen says explicitly he
   AVOIDS IK there and prefers authored extreme poses plus interpolation, because "then we have
   animation control of the extremes" and IK there "looks awkward" (25:27–25:58). That is a real,
   presenter-sourced non-use case for the same technique the talk otherwise recommends, from the same
   speaker in the same session — worth keeping attached to the entry rather than treated as a
   contradiction. Wrote **`single_pose_plus_ik_generalizes_contact_variants`**.

Three more real techniques were NOT written as separate entries, kept to notes only, to stay inside
the 1–4-per-video guidance on an unusually dense talk: (a) per-bone "softness" parameters applied
universally so secondary motion carries across EVERY transition, not one authored clip at a time
(12:45–13:20) — direct evidence for `ai/motion.js`'s own stated limitation that procedural secondary
motion is not attributable in this build (`procedural_secondary`, PHY-002); (b) curved (not linear)
angular-velocity shaping on an otherwise-unphysical flip/roll, timed to land exactly on the recovery
pose, justified by conservation-of-angular-momentum intuition even though nothing is actually
conserved (09:08–10:01) — a specific case of easing applied to a whole-body spin rather than a limb;
(c) staged, hit-count-gated ragdoll-activation delay for death reactions, giving a character time to
visibly react before going fully limp (15:24–16:05) — closer to a combat/damage-system technique than
an animation-authoring one, and Cadence has no damage-state model to hang it on.

**Contradicted an existing card:** none.

**Capture candidate:** none. Every demonstration is a rigged 3D character in Rosen's own engine or a
2D/screen-recorded reference clip from other shipped games (Shadow of the Colossus, Rain World, Gang
Beasts) — no real filmed human performance to track.

**Checks for the queue:**
- `check: spring_damper_signature_detection — classify a transition's acceleration/jerk curve as an
  exponentially-decaying oscillation (spring-like) vs. a monotonic ease, to distinguish a live-spring-
  style transition from an authored Back-ease that looks similar but is a fixed formula — buildable
  from sampleMotion's acceleration/jerk series — video 41 @ 07:53–08:53`
- `check: ik_reach_coverage_sweep — for a declared contact-variant range (e.g. a ledge shimmy's full
  travel), report the reachable subset against reach_range_studs rather than checking one point at a
  time — buildable directly from boneGeometry/solveTwoBone's already-computed reach_range_studs —
  video 41 @ 11:38–12:06`

**Entries written:** `W05-41-procedural-movement-precedes-cosmetic-animation.json`,
`W05-41-cycle-phase-driven-root-translation.json`,
`W05-41-spring-damper-pose-transition-interpolation.json`,
`W05-41-single-pose-plus-ik-generalizes-contact-variants.json` — all four checked field-by-field
against `validateProposedEntry`'s actual rule set (read directly from `ai/knowledge.js` this session,
not assumed) before writing.

### 42. Animation Bootcamp: 2018 Tricks of the Trade — GDC (six animators, 5 minutes each)

2026-09-11. Watched at `transcript` detail (850 caption segments; the first fetch attempt hit the
desktop's known intermittent DNS drop mid-yt-dlp-call, a bare retry with no other changes succeeded
immediately — consistent with the standing note that this is a retry, not a failure). A lightning-talk
format, six independent speakers at ~5 minutes each: James Benson (In the Valley of Gods, ex-Ori/
Firewatch), a studio-management talk with no animation-craft content (skipped entirely, correctly per
this batch's own scope), a motion-capture-direction talk (Naughty Dog), Johan (Riot/League of
Legends), Kyle Chittenden (Certain Affinity, animation-test advice), and Gwen Frey (The Molasses
Flood, technical animator) — treated as up to six mini-videos inside one transcript rather than one
throughline, per W05.md's "harvest working animators' rules of thumb" framing for this video.

**What it teaches, specifically:**
1. James Benson: a continuous blend space (speed, fall-height, turn-angle as blend axes) in place of a
   state machine's discrete named states — framed explicitly as "not just a visual problem, it's a
   controls one" because state-machine transitions are hard-coded linear and cannot keep footfalls in
   phase the way a shared blend space can (00:52–02:56). Wrote
   **`blend_tree_locomotion_replaces_state_machine`**.
2. James Benson again: splitting a look-at response into independently-timed layers (eyes, head,
   chest, equipment) rather than one rigid chained rotation, so the RESPONSE itself carries overshoot/
   overlap — stated as the difference between merely facing a target and reading as "aware" of it
   (02:58–04:10). Wrote **`layered_independent_look_targets_read_as_awareness`**.
3. Gwen Frey: a canned clip re-addressed as a lookup table by a live state variable instead of played
   on a timer — a landing clip authored from a fixed height (100 units) scrubbed by CURRENT
   height-above-ground so feet never clip regardless of actual fall speed, and one 360° turn-in-place
   clip scrubbed (forwards or backwards) by live world-orientation delta instead of stitching together
   "a lot of different... animations... in some kind of hot mess" (28:27–30:15). This is mechanically
   the same operation this build's own `scrub_to_frame` already performs at authoring time, just never
   wired to a runtime variable — a genuinely direct connection, not a stretch. Wrote
   **`state_driven_frame_selection_instead_of_playback`**.
4. Gwen Frey again, and the talk's most Cadence-adjacent finding: a per-foot 0/1 "planted" float track
   authored inside EVERY locomotion loop, multiplied together at runtime (including against a
   hard-stop clip's own "remaining planted" track) to drive an IK blend weight — the direct, named
   reason her character needed "absolutely no transition animations at all" across idle/walk/run/stop
   (25:06–27:00). The data container this needs — a keyed float value independent of joint rotation —
   is exactly `add_property_track`, already in this build; only the runtime multiplication and the
   automatic generation from measured contact are missing. Wrote
   **`planted_foot_float_track_eliminates_transition_clips`**.

**Cross-checks** (confirmations of existing cards, not new entries): Kyle Chittenden's "twinning the
correct way" (offset timing, separate landing frames, lead in different directions, avoid consecutive
twinning poses, 23:17–24:00) restates the compiled `twinning` card's own core claim with no new
mechanism — logged as a cross-check, not an entry. Johan's orthographic-view habit (checking a pose
from front/top to catch balance and arc errors that perspective foreshortening hides, 18:05–19:31) is
a diagnostic-viewing-angle technique in the same family as `onion_skin_arc_verification` (W02) but
from a CAMERA-angle axis rather than a frame-stacking one — close enough to that existing card's
spirit that a new entry felt redundant rather than additive; noted here in case a future session
judges otherwise. Johan's evenly-spaced-keyframe timing-visualization habit (16:55–18:04) is the same
underlying claim `ai/motion.js sampleMotion`'s own spacing/velocity measurement already automates —
also a cross-check, not new ground.

**Not written as entries** (kept to notes, narrow/business rather than animation-technique content):
the CEO/studio-culture segment (05:19–10:21, no animation-craft content at all); the motion-capture
direction segment's advice (verbs-not-objectives direction, pre-shoot reference kits, branching-point
matching, 10:27–15:13) is real but is entirely about a CAPTURE SHOOT's human process, nothing
`ai/motion.js` could ever measure or `ai/pose.js`/`ai/plan.js` could ever represent, so it was judged
not to clear the bar of a Cadence-actionable entry; Kyle Chittenden's reactive-dummy-object and
double-rig-controller (gimbal-lock) tips are real but are rig/pipeline-tooling tricks rather than
animation principles.

**Contradicted an existing card:** none.

**Capture candidate:** none. Every demonstration is either a rigged 3D character in a game engine, a
slide/diagram, or (for the motion-capture segment) described but not shown on screen.

**Checks for the queue:**
- `check: declared_contact_track_vs_measured_drift — compare a hand-authored 'planted' property
  track's 0/1 windows against measureContactDrift's own measured contact windows on the same clip,
  flagging disagreement — buildable directly from add_property_track's stored keys plus MOT-008 —
  video 42 @ 25:34–26:19`

**Entries written:** `W05-42-blend-tree-locomotion-replaces-state-machine.json`,
`W05-42-layered-independent-look-targets-read-as-awareness.json`,
`W05-42-state-driven-frame-selection-instead-of-playback.json`,
`W05-42-planted-foot-float-track-eliminates-transition-clips.json` — all four pass
`validateProposedEntry` and `validateEvidenceSource`.

### 43. Animation Bootcamp: The First Person Animation of Overwatch — GDC (Matt Bame, Blizzard)

2026-09-11. Watched at `transcript` detail (728 caption segments, clean on first pull). One of the
strongest videos so far for direct code-level relevance — several findings connect to a specific
named function or documented pitfall already in this codebase rather than only to a general
principle, which the entries below say explicitly rather than implying. Five entries written, above
this batch's usual 1–4 guidance, because the density and directness of Cadence-relevant content
justified it (precedent: W03 video 26 alone produced 5 in an earlier batch).

**What it teaches, specifically:**
1. A weapon bone parented under the hand chain (the "classic" way) looks correct in Maya at a fixed
   framerate but produces visible "wacky weirdness" in-engine from ordinary subframe interpolation at
   variable framerate — the fix is parenting the weapon attachment under the ROOT instead and IK-ing
   the hand TO it, which also enables a clean parent-space hand-release for reloads (07:59–13:09).
   This maps directly onto a real, open question about Cadence's own `attach_item`: which part an
   attachment targets is exactly the choice this entry is about, and nothing in this build currently
   flags a deep-chain attachment as higher-risk. Wrote
   **`weapon_attach_under_root_avoids_subframe_chain_desync`**.
2. Decoupling the first-person view-model camera's FOV from the player-adjustable world FOV, so a
   player's comfort/preference setting can never stretch a hand-authored pose — demonstrated concretely
   against Widowmaker's rifle silhouette (16:31–18:23). Wrote
   **`decoupled_view_model_fov_protects_authored_pose`**.
3. One shared additive spring-based aim/lean overlay system, re-tuned per character (tight for McCree,
   "flows and snaps" for Zenyatta, "super loose" for Roadhog) so the SAME code gives each hero a
   distinct feel — stated explicitly as a characterization tool, not just a physicality fix
   (19:52–21:49). This is a genuinely different angle on video 41's spring-damper finding: there it was
   a technical fix for an interpolation artifact, here the tunable parameters ARE the acting choice.
   Wrote **`per_character_spring_tuning_as_personality_control`**.
4. An extreme, past-realistic stretched pose authored as a real frame but deliberately excluded from
   the exported/idle boundary, so it is only ever seen mid-transition, never held — McCree's fire and a
   reload both use this exact "stretch, snap back, a little hole" structure (26:39–27:35, 31:01–31:56).
   Maps directly onto this build's own `set_play_range`/`get_play_range`. Wrote
   **`unexported_extreme_frame_smear_transient`**.
5. Deliberately posing past anatomical plausibility (translating Mercy's finger bones into place rather
   than rotating them through a natural chain) specifically BECAUSE the first-person camera is fixed
   and guaranteed never to expose the invalid state from another angle — the presenter's own account
   ("you'll never see that side... hopefully you don't see that") includes an honest note of
   uncertainty about the guarantee (18:59–19:52). This stands in direct, worth-naming tension with this
   build's own `joint_limits: null` / `reach_range_studs`-honesty design (CLAUDE.md's R15 reach-limit
   pitfall is the same shape of problem from the opposite instinct: Cadence's solver refuses to lie
   about a reach shortfall, where this technique deliberately exploits an audience that will never
   check). Wrote **`fixed_camera_licenses_invisible_pose_cheats`**.

**Not written as entries:** the Maya animation-layers organizational workflow (13:14–15:13) is a
DCC-tool-specific technique with no clean Cadence analogue (Cadence has no layered-base-pose-cascade
concept) and was judged not distinct enough from ordinary override-track authoring to earn its own
card. The "avoid Frankenstein hands" reload tip and run-lean/directional-lean additive system were
named but not demonstrated in enough concrete detail in this transcript to evidence separately (the
presenter explicitly ran out of time and skipped material more than once).

**Contradicted an existing card:** none.

**Capture candidate:** none — every example is a rigged 3D character or a slide, no filmed reference.

**Checks for the queue:**
- `check: deep_chain_attachment_risk_flag — flag an attach_item target whose part sits more than N
  joints from the rig root as higher subframe-interpolation risk for held items expected to move
  independently — derivable from the rig's own joint graph, already walked by buildChain — video 43 @
  07:59–09:44`
- `check: extreme_frame_outside_boundary_range — flag an interior frame whose measured rotation/scale
  amplitude exceeds both the clip's own play-range boundary frames by a wide margin, as a candidate
  smear-transient (informational, not a defect) — buildable from sampleMotion plus get_play_range —
  video 43 @ 26:39–27:35`

**Entries written:** `W05-43-weapon-attach-under-root-avoids-subframe-chain-desync.json`,
`W05-43-decoupled-view-model-fov-protects-authored-pose.json`,
`W05-43-per-character-spring-tuning-as-personality-control.json`,
`W05-43-unexported-extreme-frame-smear-transient.json`,
`W05-43-fixed-camera-licenses-invisible-pose-cheats.json` — all five pass `validateProposedEntry`
and `validateEvidenceSource`; re-swept for concept-name collisions against the full corpus (12
compiled + W01–W04 inbox/merged + this batch so far) with none found.

### 44. How Overwatch Conveys Character in First Person — New Frame Plus (Dan)

2026-09-11. Watched at `transcript` detail (402 caption segments; one non-English caption track hit
an HTTP 429 and was skipped, the primary `en` track came through clean on the first pull — a distinct,
narrower version of the "captions present but check coherence" lesson from W03: here it was a
DIFFERENT track that failed, not the one actually used, so nothing needed re-checking). This video is
an explicit companion to video 43 — same subject (Overwatch first-person animation), credited at the
very end to Matt Bame's GDC talk by name — but from an external analytical/critique lens rather than a
developer's own account, with many more named per-character comparisons across the full roster than
video 43 had room for. Matches W05.md's framing for this video exactly: character through motion, with
no face ever in frame.

**What it teaches, specifically:**
1. Keep the one consistently-visible element (the weapon/hands) on screen as close to always as
   possible, and invest character-defining design and idle detail specifically there, since it is the
   ONLY available canvas in this view — demonstrated with a direct Soldier 76 (precision, tight,
   well-maintained) vs. Junkrat (rickety, loose, vibrating) weapon-idle contrast (02:52–04:26). Wrote
   **`always_visible_prop_as_primary_character_canvas`**.
2. Zenyatta is the one character in the roster given NO idle fidget at all, stated as deliberate and
   contrasted directly against D.Va's fidget-heavy, tense idle in the same breath — stillness reads as
   meditative serenity specifically BECAUSE the rest of the cast has trained the viewer to expect
   constant idle micro-motion (05:03–05:28). The sharper, more novel claim here (vs. video 43's
   per-character spring-tuning entry, which is about VARYING a parameter) is that the DELIBERATE
   ABSENCE of any secondary motion is itself expressive, and that Cadence's own data has no way to
   distinguish that deliberate absence from an idle nobody has authored yet. Wrote
   **`withheld_idle_fidget_as_deliberate_character_trait`**.
3. With feet/legs never shown, distinct per-character locomotion identity (heavy stomping, light
   coasting, skating, footfall-less hovering) is conveyed entirely through hand/weapon secondary motion
   and camera bob — Reinhardt's vertical stomp-punctuation via hammer sway, Lucio's horizontal
   skate-sway via his free arm, Zenyatta's near-total absence of vertical punctuation even while moving
   (with only a slight bob increase relative to his own stillness) (06:13–07:55). Wrote
   **`locomotion_character_conveyed_via_hand_secondary_motion_alone`**.
4. Winston's weapon's rotation axis during a camera-turn drag sits near the TOP of the weapon
   specifically because that is where he grips it, not at the weapon's own geometric centre
   (11:57–12:02) — a narrow but concrete claim distinct from the video's other (more numerous)
   lead/lag-timing observations on the same general phenomenon. Wrote
   **`swing_pivot_at_grip_not_geometric_center`**.

**Cross-checks** (confirmations/refinements of existing cards, not new entries): the broader
weapon-drag-scales-with-grip/weight-and-skill finding — McCree's revolver LEADS the turn (light,
skilled marksman), Hanzo's bow LAGS (heavier, drawn), Sombra's SMG wobbles more (one-handed,
top-heavy) — directly confirms and adds named, roster-wide evidence to `lever_arm_dependent_drag` and
`held_object_drag_frame_count` (both W02) rather than adding new mechanism (11:19–11:57). Tracer's
combat-roll camera doing a small dip instead of a full 360° rotation to suggest rolling without
disorienting the player (12:24–12:53) is a real, concrete finding but has no clean Cadence analogue
(no camera-comfort/disorientation model exists in this build at all) and is closely related in spirit
to `procedural_movement_precedes_cosmetic_animation` (video 41)'s responsiveness-protection reasoning
without adding a new mechanism — noted here rather than written as its own entry.

**Contradicted an existing card:** none.

**Capture candidate:** none — entirely in-game character-roster analysis, no filmed reference.

**Checks for the queue:** none new this video — the four written entries' measurable angles
(near-zero-amplitude idle detection, vertical/horizontal displacement decomposition on a hand track,
rotation-centre-vs-geometry comparison) are already captured inside their own
`detection_and_measurement_methods` fields rather than as separate queued checks, since each depends
on a declaration (a grip point, an intentional-stillness annotation) this build does not yet have
anywhere to store — recorded as blocked-on-a-declaration in the entries themselves rather than queued
as if merely unbuilt.

**Entries written:** `W05-44-always-visible-prop-as-primary-character-canvas.json`,
`W05-44-withheld-idle-fidget-as-deliberate-character-trait.json`,
`W05-44-locomotion-character-conveyed-via-hand-secondary-motion-alone.json`,
`W05-44-swing-pivot-at-grip-not-geometric-center.json` — all four pass `validateProposedEntry` and
`validateEvidenceSource`; no concept-name collisions against the full corpus.

### 45. Animation Bootcamp: Animating Cameras for Games — GDC (presenter unnamed in captions)

2026-09-11. Watched at `transcript` detail (608 caption segments, clean on first pull). The captions
never clearly state the presenter's name (auto-captions render their studio as "robotki", almost
certainly Robotoki, maker of Human Element — noted honestly as caption-derived rather than confirmed);
entries below cite them as "the GDC presenter" rather than guess a name. This is the first purely
camera-focused talk in the batch, and it directly engages the exact gap W05.md's own line for this
video points at: this build's `SHOT-003/004` ("no active-camera model exists... a camera is an item
with @origin and @fov tracks and nothing measures framing"), referenced explicitly in `ai/benchmark.js`
and the committed baseline. Two of the four entries below name that gap directly as their shared
missing prerequisite, with a concrete sketch of what filling it would need.

**What it teaches, specifically:**
1. First-person camera motion sickness is caused primarily by uncompensated ROTATION relative to the
   horizon, not by FOV — demonstrated with a direct before/after (identical translation, only rotation
   stabilized) and a named real incident (a teammate made "violently sick" by an unrelated camera
   change) (23:04–24:22). Wrote **`horizon_stabilization_reduces_motion_sickness_independent_of_fov`**.
2. Lens focal length distorts a character's proportions independently of camera distance — a direct
   300mm-vs-25mm comparison on the same model, with the explicit warning that a wrong lens choice can
   "break your character... before you've even animated it" (03:44–04:38). Wrote
   **`lens_focal_length_distorts_character_off_model`**.
3. Rule-of-thirds subject placement is a deliberate STORY variable, not a single generic aesthetic
   target — the identical shot moved between two thirds produces opposite readings (wonder vs. danger),
   and Forest Gump's dead-centre-by-default framing makes its rare deviations meaningful precisely
   because the norm is maintained (10:58–12:02). This is the entry that most directly engages
   `SHOT-003/004`: every input a world-to-screen projection would need (camera FOV/origin, a rig's
   world position via `ai/pose.js`) already exists in this build except the projection step itself —
   said explicitly in the entry rather than left implied. Wrote
   **`deliberate_thirds_placement_as_story_variable`**.
4. Unintentional tangents (elements touching-but-not-crossing, most commonly a head grazing the frame's
   top edge) measurably hijack viewer attention away from the intended focal point, backed by cited
   third-party eye-tracking heat-map research (13:23–15:07). The harder sibling of #3: detecting a
   tangent needs projected SILHOUETTES (`get_bounding_box` could supply the world-space half), not just
   a single subject point. Wrote **`unintentional_tangent_hijacks_viewer_attention`**.

**Not written as entries** (real content, kept to notes): the four depth-space categories (flat/deep/
limited/ambiguous) matched to story beats or deliberately contrasted between a game's different
environments (15:32–18:47) is a real, evidenced technique but would mostly restate the same
`SHOT-003/004`-blocked measurement problem a third time without adding a new mechanism beyond entries 3
and 4 above. First-person gameplay-camera restraint (any control-taking-away moment must be small and
tied to a natural trigger — stationary→movement, indoor→outdoor — never an arbitrary cinematic flourish,
20:56–22:53) is essentially this video's own camera-specific restatement of `procedural_movement_
precedes_cosmetic_animation` (video 41)'s core claim and was logged as a cross-check rather than a new
entry.

**Contradicted an existing card:** none.

**Capture candidate:** none — a cinematography/composition talk with film-still and slide examples, no
trackable performed motion.

**Checks for the queue:**
- `check: subject_thirds_grid_placement — the SHOT-003/004-blocked check named directly in this
  video's entries: given a camera's @origin/@fov and a declared subject's world position (already
  available via ai/pose.js), project to screen space and report which thirds-grid cell the subject
  falls in per frame — blocked on building the projection step itself — video 45 @ 10:58–12:02`
- `check: frame_tangent_detection — given projected screen-space silhouettes for two or more items
  (get_bounding_box supplies the world-space half), flag a near-zero non-overlapping gap between their
  projected extents as a candidate unintentional tangent — blocked on the same projection step as
  above, plus the silhouette (not just centre-point) extension — video 45 @ 13:23–15:07`

**Entries written:** `W05-45-horizon-stabilization-reduces-motion-sickness-independent-of-fov.json`,
`W05-45-lens-focal-length-distorts-character-off-model.json`,
`W05-45-deliberate-thirds-placement-as-story-variable.json`,
`W05-45-unintentional-tangent-hijacks-viewer-attention.json` — all four pass `validateProposedEntry`
and `validateEvidenceSource`; no concept-name collisions.

### 46. Animation Bootcamp: Script to Screen: The Development Diary of Marvel's Spider-Man — GDC (Brian Weiser, Insomniac Games)

2026-09-11. Watched at `transcript` detail (1043 caption segments, clean on first pull — the longest
transcript in this batch so far). Matches W05.md's framing for this video exactly: "a shot from plan to
polish in a AAA pipeline." Five entries written (above the usual 1–4, same discipline as video 43):
this talk covers editing, camera, and cross-production-continuity ground none of the batch's other
nine videos touch, each with a specific named production anecdote as evidence rather than general
advice.

**What it teaches, specifically:**
1. Shoot a scene's blocking in two deliberate passes — first for pure comprehension (no accidental
   line-of-action crosses, clear geography), second purely for subtext via composition (recentring,
   offsetting into the frame's "short side" for discomfort) (09:29–09:58). Wrote
   **`two_pass_shoot_comprehension_then_subtext`**.
2. Hold the camera on a LISTENING character's reaction rather than the speaker's — a specific named
   Spider-Man example (holding on Peter while Aunt May speaks) plus a Walter Murch-sourced counterexample
   (old Dragnet episodes cutting to whoever is talking, producing a "tennis match" with no emotional
   throughline) (10:11–11:50). Wrote **`reaction_shot_over_speaker_shot_for_emotional_weight`**.
3. Across a cut between two angles on the same impact, overlap a few frames so the impact is shown
   twice (once near the end of the first angle, again a few frames earlier in the second) — imperceptible
   to the audience but measurably adds perceived force, attributed to John Woo and Jackie Chan films
   (12:45–13:14). Wrote **`discontinuous_double_exposure_impact_replay`**.
4. Camera procedural noise ("shake" vs. "wave") is parameterized by a DECLARED operator identity
   (a vibrating mount vs. a handheld operator) rather than tuned ad hoc per shot, and the studio mirrors
   a real Alexa Prime lens package's actual FOV/depth-of-field values into their tool (credited to an
   animator who came from previz studio Third Floor) (03:42–05:23). Wrote
   **`operator_identity_implies_camera_noise_profile`**.
5. A named continuity failure (a spider prop meant to persist across several missions "simply vanished"
   after an unrelated asset update) led directly to a lead animator (Gavin Goulden, credited by name)
   building an explicit cross-scene costume/item continuity map — evidence that "trust the animator's
   memory" breaks down at a specific, identifiable scale (19:11–19:53). Wrote
   **`cross_cinematic_item_continuity_declaration`**.

**Not written as entries** (real, well-evidenced content, kept to notes): unified single-take
performance capture (voice + stunt actor on stage together, avoiding a stitching pass) is a real
production-methodology finding (14:56–16:12) but is a capture-logistics technique with no clean
Cadence-authoring analogue. "Scene rot" — the general phenomenon of unrelated production changes
silently breaking an already-shot cinematic (a missing building, a chair through a villain's chest),
and the weekly cross-department "assets meeting" introduced specifically to catch it (17:10–21:38) — is
the broader pattern entry 5 is the sharpest SINGLE instance of; the general meeting-cadence solution
itself has no Cadence angle beyond what entry 5 already states. The iterative facial-animation/lighting
correction loop (25:11–26:25) depends on a FACS blend-shape face system and a lighting pipeline, neither
of which exist in Cadence at all (no face, no lighting) — judged out of scope rather than force-fit.
"Frankenstein" sets and single-frame camera-blocked teleports used to hide loading screens between
disconnected open-world locations (23:00–25:10) is a real, clever technique but is almost entirely
level-design/streaming-technical rather than animation-craft, and was judged not to clear the bar for
a knowledge entry on its own.

**Contradicted an existing card:** none.

**Capture candidate:** none — an internal pipeline/production talk with game footage and slides, no
trackable independent reference performance.

**Checks for the queue:** none new this video — all five entries' `detection_and_measurement_methods`
fields already state directly why each is either unmeasurable in principle (an authorial/editing/
production-process choice, not a property of finished motion data) or blocked on a declaration this
build has no home for yet (cross-project continuity state), rather than pointing at a buildable
`ai/motion.js` measurement the way earlier videos' checks did.

**Entries written:** `W05-46-two-pass-shoot-comprehension-then-subtext.json`,
`W05-46-reaction-shot-over-speaker-shot-for-emotional-weight.json`,
`W05-46-discontinuous-double-exposure-impact-replay.json`,
`W05-46-operator-identity-implies-camera-noise-profile.json`,
`W05-46-cross-cinematic-item-continuity-declaration.json` — all five pass `validateProposedEntry`
and `validateEvidenceSource`; no concept-name collisions.

### 47. Evolving Combat in 'God of War' for a New Perspective — GDC (Mihir Sheth, Santa Monica Studio)

2026-09-11. Watched at `transcript` detail (1667 caption segments — the longest video in this batch,
59:52; the main talk runs to ~44:00 with Q&A after). Read via targeted `grep` scanning ahead for dense
sections (targeting/camera/translation/juggle keywords) rather than a strict linear pass, given the
length — noted honestly since it is a deviation from this batch's usual video-at-a-time linear read;
the full 0:00–44:00 main-talk span was still read, just navigated non-sequentially. This talk turned
out to be overwhelmingly about gameplay/camera SYSTEMS design (targeting, aggression scoring, enemy
positioning) rather than classical animation craft — most of it (aggression tokens, positioning zones,
lock-on) has no clean Cadence angle at all (Cadence has no combat-AI or targeting model) and was
deliberately left out of the entries below to keep the corpus honest about what is animation-relevant
versus pure game-design. The four sections that ARE squarely animation/motion-authoring, however, are
exceptionally concrete and technical, matching W05.md's framing for this video ("heavy attacks that
read; hit reactions; camera and impact") from an unexpected angle: runtime motion CORRECTION rather
than classical posing principles.

**What it teaches, specifically:**
1. **Strike assist** — the standout finding of the whole batch so far: a hit reaction's trajectory is
   corrected toward a tunable blend between the camera's facing vector and its own originally-authored
   direction, proportional to how far off-frame it would otherwise go, so combos keep struck enemies
   on screen — and became a genuine player-expression tool (aiming the camera to direct a combo's last
   hit off a cliff) that "most players had no idea... was even happening at all" (34:53–37:51). Wrote
   **`strike_assist_hit_reaction_camera_relative_correction`**.
2. A reach-closing correction ("a simplified form of motion warping") is deliberately scaled DOWN as a
   target's angle away from forward increases, accepting more misses on off-angle targets specifically
   because lateral correction reads as more disorienting than forward correction under this camera
   (27:55–28:26). Wrote **`angle_scaled_reach_correction_for_lateral_targets`**.
3. Animation translation distance exposed as a separate, live-tunable scalar in the design tooling
   ("design strips"), decoupled from the authored clip shape, specifically to let designers sweep
   candidate hit-reaction/attack travel distances without re-animating each one — directly credited
   with enabling the substantial translation reductions this new camera required (33:32–34:17). Wrote
   **`procedural_translation_scale_as_iteration_dial`**.
4. Airborne juggle reactions are hand-ANIMATED (not physics-simulated) specifically because "the bounce
   of juggling always had to feel good," while a separate runtime float-height system applies a
   corrective velocity whenever the reaction's root joint exceeds a camera-relative height ceiling —
   splitting feel (animation) from a hard constraint (a runtime clamp) rather than solving both with
   one system (40:39–41:22). Wrote **`animated_not_physical_height_clamped_juggle`**.

**Not written as entries** (real, well-evidenced, but pure gameplay/AI-systems content with no
animation angle): the aggression-token enemy-selection system, the zone-constraint positioning system
that replaced an earlier weight-based one, the hybrid lock-on system added late in development, and
aim-friction/zoom-snapping for ranged targeting are all real, carefully-designed systems, but Cadence
has no combat-AI, targeting, or enemy-behavior model of any kind to connect them to — forcing entries
here would misrepresent the corpus's actual scope. Two animation-adjacent findings were also left out
for being thinner extensions of entries already written rather than new mechanisms: invisible "bump"
collision reactions propagating between hit-reacting enemies (reused, scaled up, for airborne
reactions) and temporary aggression-token retention during a hit reaction (giving the player a bounded
offensive window) are both real but closer to gameplay-pacing design than motion authoring.

**Contradicted an existing card:** none.

**Capture candidate:** none — an internal systems-design talk illustrated with gameplay footage and
diagrams, no trackable independent reference performance.

**Checks for the queue:**
- `check: reach_correction_angle_asymmetry — for a project declaring a reach/motion-warp correction,
  compare the correction magnitude actually applied at different target angles against the expected
  angle-scaled falloff this video describes; flag a uniform (angle-independent) correction as a
  candidate lateral-disorientation risk — buildable from sampleMotion's position data plus a declared
  target angle — video 47 @ 27:55–28:26`
- `check: translation_distance_outlier_vs_category — flag a clip whose measured root-translation
  distance (sampleMotion position data) is a outlier against other clips of the same declared action
  type, as a candidate for the kind of category-wide re-tuning this video's 'design strips' dial was
  built for — video 47 @ 33:32–34:17`

**Entries written:** `W05-47-strike-assist-hit-reaction-camera-relative-correction.json`,
`W05-47-angle-scaled-reach-correction-for-lateral-targets.json`,
`W05-47-procedural-translation-scale-as-iteration-dial.json`,
`W05-47-animated-not-physical-height-clamped-juggle.json` — all four pass `validateProposedEntry`
and `validateEvidenceSource`; no concept-name collisions.

### 48. Keyframes and Cardboard Props: The Cinematic Process Behind 'God of War' — GDC (Erica Pinto, Santa Monica Studio)

2026-09-11. Watched at `transcript` detail (1433 caption segments; read via the same targeted-scan
approach as video 47 given length, with the full transcript span covered non-sequentially). The direct
companion piece to video 46 (Spider-Man dev diary) and video 47 (God of War combat) — this one covers
the SAME studio's cinematic pipeline as video 47 but from the narrative-animation side, built entirely
around the constraint of a camera that never cuts, not even between cinematic and gameplay. Matches
W05.md's framing ("cinematic planning with cheap previews, the director's loop") closely, though the
single most valuable finding turned out to be a hard technical bug class rather than a planning
technique.

**What it teaches, specifically:**
1. A marked-up cardboard box, puppeteered at the right height, stands in for an oversized/not-yet-built
   character during rough previs specifically to validate composition and scale before any real asset
   exists (16:39–16:55). Wrote **`cardboard_box_puppet_scale_proxy`**.
2. Giving every character an ongoing physical task ("business") solves a problem specific to a no-cut
   camera: there is no edit available to redirect attention away from a talking head, so the redirection
   has to be diegetic instead — stated as fixing three things at once (camera motivation, character
   movement, non-verbal characterization), explicitly tied back to an earlier-documented
   characters-freezing failure in the same talk (17:59–19:21). Wrote
   **`character_business_motivates_no_cut_camera_disengagement`**.
3. **The strongest finding in this video, and arguably the batch**: a character rig's root ("zero")
   joint is a STATE SIGNAL two independent downstream systems read on their own — the game engine's
   locomotion state machine (walking/running/idle) and, for a player character, physics/cloth — so an
   animated clip whose visible mesh moves while the root stays frozen produces a real correctness bug
   (an idle-pose pop at the cinematic/gameplay handoff, or cloth "flipping out" because physics thinks
   the character is elsewhere), not a subtle seam. Demonstrated with the team's own real-time
   root-velocity debugging visualizer tracing an actual desync bug (38:15–40:49). This is directly and
   immediately measurable in THIS build: `sampleMotion`'s `linear_velocity` on a root part is exactly
   the quantity at issue, and nothing currently cross-checks it against `analyseChain`'s leg-cycle-implied
   speed. Wrote **`zero_joint_velocity_must_match_visual_locomotion_state`**.
4. Live-action reference performers matching a differently-scaled character's height by adjusting their
   OWN posture (walking on their knees for dwarf characters) get correct eyelines/composition but
   explicitly NOT correct timing — captured as a named, deliberate exception to the general
   physical-reference-is-valid-timing-evidence principle from `physical_reference_timing_method` (W01)
   (11:06–11:44). Wrote **`scale_double_sacrifices_timing_for_composition`**.

**Not written as entries** (real content, kept to notes): "cheating the camera" to hide armor-clipping
penetrations (41:45–41:54) directly confirms `fixed_camera_licenses_invisible_pose_cheats` (video 43)
with a different named example — logged as a cross-check, not a new entry. A dedicated late-production
"buttery smooth pack" QA pass specifically targeting cinematic/gameplay seams (pose-matching discipline
plus the zero-joint check above plus interactable-object position metrics, 37:42–39:00) is the
PROCESS/CONTAINER the zero-joint finding was caught inside, not a separate mechanism — its pose-matching
half also directly echoes `action_end_pose_must_match_idle_for_automatic_blend` (W04) and is noted as a
cross-check rather than re-stated as new. A validate-cheap-before-committing pattern (shooting an
iPhone/handheld test specifically to de-risk a risky camera-language idea — a third-to-first-person
transition — before full previs production, 12:53–13:41) is real but close enough in spirit to this
video's own `cardboard_box_puppet_scale_proxy` and video 46's workflow entries that a fourth restatement
was judged not additive.

**Contradicted an existing card:** none.

**Capture candidate:** none — internal production/pipeline footage and diagrams, no independent
trackable reference performance presented as such.

**Checks for the queue:**
- `check: root_velocity_vs_implied_leg_cycle_speed — compare a root/zero-joint's measured
  linear_velocity (sampleMotion) against the speed a leg-cycle's phase (analyseChain) implies the
  character should be travelling at; flag a mismatch as a candidate for exactly the idle-pop/cloth-glitch
  bug class this video documents — buildable today from two measurements already in this build — video
  48 @ 38:19–40:49`

**Entries written:** `W05-48-cardboard-box-puppet-scale-proxy.json`,
`W05-48-character-business-motivates-no-cut-camera-disengagement.json`,
`W05-48-zero-joint-velocity-must-match-visual-locomotion-state.json`,
`W05-48-scale-double-sacrifices-timing-for-composition.json` — all four pass `validateProposedEntry`
and `validateEvidenceSource`; no concept-name collisions.

### 49. Unsynced: The Last of Us Melee System — GDC (Anthony Newman, Naughty Dog)

2026-09-11. Watched at `transcript` detail (1371 caption segments; read via targeted scanning ahead
for the title's own "sync" keyword given length, same approach as videos 47–48, full 0:00–39:00
technical-content span covered non-sequentially). The title itself names this video's headline
finding, and it did not disappoint — the shift from Naughty Dog's own prior (Uncharted) paired-
animation combat system to an "unsynced" independent-expectation one is one of the strongest, most
directly Cadence-relevant findings in the whole batch. Five entries written, matching the density
precedent set by videos 43/46/48.

**What it teaches, specifically:**
1. **The headline finding**: replacing paired animation (attacker and defender authored together
   around one shared placement point — every combination needs its own pair) with a system where each
   participant independently animates relative to where it EXPECTS the other to be ("a system of
   interlocking joints") — escaping a combinatorial explosion (~1000 moves, under 4MB) and enabling
   mechanics the paired system structurally could not (mid-exchange flinch reactions, readable hits on
   enemies standing on uneven terrain) (32:22–35:24). Wrote
   **`independent_expectation_positioning_replaces_paired_animation`**.
2. A hard, non-interpolated pose "pop" between two animations is invisible to the eye when the
   character is shown being forced into the new pose by a stated external cause (a weapon impact) —
   demonstrated with a direct slow-motion-vs-full-speed comparison (09:16–10:46). Wrote
   **`causally_motivated_pose_pop_conceals_discontinuity`**.
3. The sibling technique at the POSITION level: a large, physically-implausible instantaneous
   positional snap (a generous wall-slam trigger distance) reads as continuous motion when the
   attacking character's own motion is visibly continuous across the same span — 'your eye
   interpolates that as it's happening' (10:52–11:29). Wrote
   **`concurrent_driver_motion_camouflages_positional_snap`**.
4. Deliberately suppressing rebound on a head/body impact against a hard surface — no bounce back —
   reads as pain/injury (energy absorbed internally) rather than an elastic, fake-feeling collision;
   the presenter's own explicit counterfactual is that a bouncy version 'would look like WWF.' Directly
   strengthens the already-queued `bounce_decay_rate_matches_declared_material` check (LESSONS.md #15)
   with a second, independent citation for its low extreme (06:32–07:22). Wrote
   **`suppressed_rebound_reads_as_internalized_impact_trauma`**.
5. A systemic (non-hand-placed) combat camera orbits to one side of the attacker/defender midpoint,
   auto-correcting to the other side if it starts wrong — the same combinatorial-avoidance motive as
   finding #1, applied to the camera instead of the bodies, with hand-animated cameras reserved
   separately for finishers/grapples (11:34–12:38). Wrote
   **`midpoint_framing_camera_with_side_auto_correction`**.

**Not written as entries** (real, well-evidenced, but judged thinner extensions of material already
covered): impact velocity concentrated in the head/upper-body while the rest of the body stays
comparatively still (from MMA reference, making a hit read both harder AND heavier, 05:04–05:33) is a
strong finding but close enough to existing weight/impact cards that it was logged as supporting
context rather than a new entry. Long anticipation/follow-through holds bracketing a 2–3-frame punch
swing (05:54–06:28) directly confirms `startup_frame_budget`/`dps_floor_for_short_actions` (W01/W02)
with new concrete numbers — a cross-check, not a new card. Cut cameras reserved exclusively for death
moments specifically because a cut's disorientation cost is zero when the player is dead (12:42–13:25)
and camera shake as a cheap universal impact-amplifier (13:36–14:09) are both real and well-stated but
were judged secondary to the five entries above given this video's density and the batch's remaining
runway.

**Contradicted an existing card:** none.

**Capture candidate:** none — an internal systems/pipeline talk with shipped-game footage, no
independent trackable reference performance.

**Checks for the queue:** none new beyond what's already queued — entry 4 above directly strengthens
existing queued check #15 (`bounce_decay_rate_matches_declared_material`, LESSONS.md) rather than
proposing a new one; entries 2, 3 and 5's own `detection_and_measurement_methods` fields each already
state precisely what is buildable today versus blocked on this build's lack of any two-item or
camera-runtime comparison, matching this batch's established practice of stating that inline rather
than duplicating it as a separate queued line.

**Entries written:** `W05-49-independent-expectation-positioning-replaces-paired-animation.json`,
`W05-49-causally-motivated-pose-pop-conceals-discontinuity.json`,
`W05-49-concurrent-driver-motion-camouflages-positional-snap.json`,
`W05-49-suppressed-rebound-reads-as-internalized-impact-trauma.json`,
`W05-49-midpoint-framing-camera-with-side-auto-correction.json` — all five pass `validateProposedEntry`
and `validateEvidenceSource`; no concept-name collisions.

### 50. Making Fluid and Powerful Animations For 'Skullgirls' — GDC (Mariel Cartwright, Skullgirls)

2026-09-11. Watched at `transcript` detail (468 caption segments — the shortest video in the batch,
21:06, read in full). Matches W05.md's framing exactly ("power through smears, holds and spacing in a
fighting game"). A tightly-focused talk from a hand-drawn 2D fighting game's lead animator, with an
unusually candid retrospective "what I'd change" section carrying real, quantified before/after frame
counts. Three new entries; much of the rest of the talk strongly RECONFIRMS existing cards rather than
adding new mechanism — itself a real, worth-recording result per this programme's own W01 precedent.

**What it teaches, specifically:**
1. A genuinely counter-intuitive finding, presented as a direct reversal of the presenter's own early
   assumption: a transition OUT of an idle pose needs LARGER initial spacing (less ease), not smaller,
   because an idle loop is already a motion — easing gently out of it reads as one motion slowing down
   rather than a new one starting, and this cost responsiveness specifically on a player-controlled
   fighting-game character (13:13–13:53). Wrote **`idle_exit_needs_larger_not_smaller_initial_spacing`**.
2. Three separate, quantified before/after examples of fixing an "over-animated" move by deleting
   existing frames outright (no redrawing): 21→15 frames, 45→29 frames (with an honest admission the
   second went a little too far and started reading choppy), 7→6 frames — plus a concrete production-
   cost data point (an over-animated move at 11MB vs. 4MB for a comparable one, "three times as large...
   for no real reason") (15:38–18:38). Wrote **`subtractive_frame_deletion_de_bloats_over_animated_moves`**.
3. A small but sharp production lesson pairing with video 48's zero-joint finding: excessive secondary
   jiggle motion authored on a return-to-idle transition forced the team to split idle into a separate,
   specifically-interruptible state purely so player input wasn't blocked waiting for it to settle —
   closed with the direct lesson "we learned not to do that anymore" (18:42–18:57). Wrote
   **`idle_secondary_motion_forces_interrupt_state_split`**.

**Cross-checks** (confirmations of existing cards, not new entries, several with strong new evidence):
"favoring your keys" — holding key poses longer and smears/transitions shorter within a fixed frame
budget, demonstrated with a real before/after re-timing that added zero frames — directly confirms
`pose_hold_density` (W01) and `mixed_hold_pacing_within_phase` (W02) (11:33–12:30). Hit stop (freezing
on impact before playing the rest of the animation, with the direct observation that impacts "look a
little watery or weak without it") directly confirms `hitstop_freeze_on_confirmed_hit` (W04)
(12:43–13:05). The four-part attack decomposition (anticipation → smear → key → return-to-idle) fitting
a complete readable attack into as few as 5–6 frames extends `startup_frame_budget` (W01) and
`dps_floor_for_short_actions` (W02) with a new concrete number from a shipped, hand-animated fighting
game (14:27–15:02). The player-vs-enemy anticipation-budget asymmetry (a player character needs to feel
"instantaneous," an enemy can afford a real wind-up so the player has time to react) is a clean, direct
restatement of the exact ladder W01's own closing summary already names
(`layered_anticipation`→`startup_frame_budget`→`recovery_weight_substitution`/
`implied_zero_frame_anticipation`) (03:16–03:53). Overshoot placed before a hit frame, combined with
smear, to sell impact directly confirms `shared_mechanism_anticipation_overshoot` (W02) and
`motion_smear_readability` (W01) (06:35–07:20).

**Contradicted an existing card:** none.

**Capture candidate:** none — a hand-drawn 2D fighting game talk with sprite examples and software
screenshots, no filmed or trackable independent performance.

**Checks for the queue:** none new — this video's strongest findings (idle-exit spacing, subtractive
frame deletion) are both already directly measurable today via `sampleMotion` and `keyDensity`
respectively, stated inline in each entry's own `detection_and_measurement_methods` rather than queued
as blocked.

**Entries written:** `W05-50-idle-exit-needs-larger-not-smaller-initial-spacing.json`,
`W05-50-subtractive-frame-deletion-de-bloats-over-animated-moves.json`,
`W05-50-idle-secondary-motion-forces-interrupt-state-split.json` — all three pass
`validateProposedEntry` and `validateEvidenceSource`; no concept-name collisions.

---

## Closing summary — W05 complete (videos 41–50, all ten watched)

All ten videos in this batch were watched and written up in one session on 2026-09-11. Counts below
are recomputed directly from the files on disk, not from a running tally kept while writing this
summary (per this programme's own standing discipline, learned the hard way in W03 and W04):
**42 knowledge entries** across `knowledge/inbox/W05-*.json` (4+4+5+4+4+5+4+4+5+3 across videos 41–50 in
order), all 42 passing both `validateProposedEntry` and `validateEvidenceSource`, all 42 concept names
unique against each other AND against the full existing corpus (139 JSON files swept across
`knowledge/` + `knowledge/inbox/` — 50 compiled/merged from W01+W02, 23 from W03's still-unmerged
inbox, 24 from W04's still-unmerged inbox, and this batch's 42 — zero collisions found). **Zero capture
candidates across all ten videos** — every single one was a talk, a systems diagram, or shipped-game/
software footage, with no independent filmed or trackable reference performance anywhere in the batch;
worth recording as a real result of this section's content (talks and analysis, section C of the
watchlist) rather than a gap in how it was watched. **Zero existing cards contradicted.** **10 `check:`
lines queued** (2 from video 41, 2 from video 43, 1 from video 48, plus each other video's own
already-buildable findings stated inline rather than queued separately) — collect these into
`LESSONS.md`'s checks table at merge time.

**The batch's own throughline, and it showed up from multiple independent directions**: professional
game animation repeatedly trades a "physically correct" result for a "corrected-and-DELIBERATELY-HIDDEN"
one, and this batch caught SIX distinct, named mechanisms for making a correction or a compromise
invisible rather than merely smaller — `unexported_extreme_frame_smear_transient` and
`fixed_camera_licenses_invisible_pose_cheats` (video 43), `causally_motivated_pose_pop_conceals_
discontinuity` and `concurrent_driver_motion_camouflages_positional_snap` (video 49), plus
`strike_assist_hit_reaction_camera_relative_correction` and `angle_scaled_reach_correction_for_lateral_
targets` (video 47). No single video named this as a general principle — it emerged only from reading
across five different studios' independent talks and noticing the same underlying move (borrow
plausibility from something else the viewer is already looking at or already believes) recurring in
five structurally different guises. A session building a review pass for "does this cut/correction
read as intentional" should read these six together.

**This build's own named `SHOT-003/004` gap** ("no active-camera model exists... nothing measures
framing") came up directly and repeatedly — videos 45, 46, 47, 48 and 49 all produced at least one
entry that names it explicitly, and between them they now sketch a genuine first spec for what filling
it would need: world-to-screen projection (`deliberate_thirds_placement_as_story_variable`), projected
silhouette/bounding-box comparison for tangent detection (`unintentional_tangent_hijacks_viewer_
attention`), camera-relative motion correction (`strike_assist_hit_reaction_camera_relative_
correction`), declared-operator-identity noise profiles (`operator_identity_implies_camera_noise_
profile`), and two-participant midpoint framing (`midpoint_framing_camera_with_side_auto_correction`).
This is now a load-bearing enough cluster that a future building session scoping SHOT-003/004 should
read this batch's entries before designing the active-camera model from scratch.

**The single most directly actionable finding in the whole batch** is video 48's
`zero_joint_velocity_must_match_visual_locomotion_state`: unlike almost everything else in this batch
(which is blocked on capabilities Cadence does not have — a runtime, a camera, a multi-item comparison),
this one is checkable TODAY with two measurements this build already has (`sampleMotion`'s
`linear_velocity` on a root part, `analyseChain`'s leg-cycle phase) and no new capability at all — the
closest thing this batch produced to check #10 from W01/W02's own queue (the one already flagged as
"next" and "the first test of whether this whole loop pays for itself").

**How to apply:** this batch, like W02, produced zero capture candidates — nothing to add to the
capture queue in `LESSONS.md`. Unlike every prior batch, a meaningful fraction of this batch's
strongest material (the six concealment-technique entries, the SHOT-003/004 cluster) is about
GAME-ENGINE-SIDE runtime behaviour Cadence structurally cannot build without becoming a runtime itself
— a future building session should read each entry's own `cadence_representation` field carefully
before assuming a finding is actionable; several are deliberately, honestly marked as out of scope
rather than merely unbuilt. **W05 is NOT yet merged.** All ten videos are watched; there is no more of
this batch left to do. `node tools/merge-knowledge-inbox.mjs --batch W05` is the next step for whichever
session runs the merge, following the same `--batch` discipline as every prior batch (never merge a
batch that is still being written).
