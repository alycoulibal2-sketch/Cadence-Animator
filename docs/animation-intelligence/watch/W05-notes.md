# W05 notes — videos 41–50 (C. Game animation talks and analysis)

## Checklist

- [x] 41. Animation Bootcamp: An Indie Approach to Procedural Animation — GDC (26:13) — https://youtu.be/LNidsMesxSE
- [x] 42. Animation Bootcamp: 2018 Tricks of the Trade — GDC (31:10) — https://youtu.be/o1tti636Kag
- [ ] 43. Animation Bootcamp: The First Person Animation of Overwatch — GDC (34:03) — https://youtu.be/7t0hLZd_8Z4
- [ ] 44. How Overwatch Conveys Character in First Person — New Frame Plus (15:32) — https://youtu.be/7Dga-UqdBR8
- [ ] 45. Animation Bootcamp: Animating Cameras for Games — GDC (26:26) — https://youtu.be/hP1Vz70WouE
- [ ] 46. Animation Bootcamp: Script to Screen: The Development Diary of Marvel's Spider-Man — GDC (31:13) — https://youtu.be/r_rJJyIPrmM
- [ ] 47. Evolving Combat in 'God of War' for a New Perspective — GDC (59:52) — https://youtu.be/hE5tWF-Ou2k
- [ ] 48. Keyframes and Cardboard Props: The Cinematic Process Behind 'God of War' — GDC (54:01) — https://youtu.be/MNinZWlhprE
- [ ] 49. Unsynced: The Last of Us Melee System — GDC (54:20) — https://youtu.be/Ox2H3kUQByo
- [ ] 50. Making Fluid and Powerful Animations For 'Skullgirls' — GDC (21:06) — https://youtu.be/Mw0h9WmBlsw

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
