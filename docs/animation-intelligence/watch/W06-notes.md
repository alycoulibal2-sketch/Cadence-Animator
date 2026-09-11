# W06 notes — videos 51–60 (C. Game animation talks and analysis · D. Anime and stylised action)

## Checklist

- [x] 51. GuiltyGearXrd's Art Style : The X Factor Between 2D and 3D — GDC (58:59) — https://youtu.be/yhGjCzxJV3E
- [x] 52. The Animation of Guilty Gear Xrd & Dragon Ball FighterZ — New Frame Plus (17:21) — https://youtu.be/kZsboyfs-L4
- [x] 53. How to Animate a Smash Bros Character // MARIO — New Frame Plus (12:59) — https://youtu.be/NHwnTm5o1kc
- [x] 54. The Overanimation of Zenless Zone Zero — New Frame Plus (24:03) — https://youtu.be/1yH4Qz23FqM
- [ ] 55. The Brilliant Animation in Metroid Dread — Video Game Animation Study (38:26) — https://youtu.be/1B1beXTnvEI
- [ ] 56. The Animation of Cuphead — Video Game Animation Study (10:57) — https://youtu.be/pOBKGcehi8U
- [ ] 57. How 2D Fighter Games are Animated — Video Game Animation Study (7:13) — https://youtu.be/WYCjmVhiLaM
- [ ] 58. The Effects Animation of Hollow Knight — New Frame Plus (7:19) — https://youtu.be/SIJtfr-PO4Y
- [ ] 59. How to add IMPACT frames to your animation — Howard Wimshurst Animation (18:42) — https://youtu.be/6UaUi5fBmJc
- [ ] 60. Animate action with SMEAR FRAMES — Kuzillon (6:37) — https://youtu.be/5v0IZSr9-j0

## Per-video notes

### 51. GuiltyGearXrd's Art Style : The X Factor Between 2D and 3D — GDC (Junior Christopher Motoa, Arc System Works)

2026-09-11. Watched at `transcript` detail (1249 caption segments, clean on first pull, full
58:59 read in full — no targeted-scan shortcut needed at this length). The developer's own
account of the studio's headline technique, and directly relevant to this build's own
capabilities more than almost any video watched in this programme so far: two of the four
entries below map onto features Cadence ALREADY SHIPS (`Constant` easing, the "Stop motion"
command, `ai/motion.js`'s `stepped` classification), read directly from the source rather than
assumed, before writing anything.

**What it teaches, specifically:**
1. **The headline technique**: turn off interpolation entirely — every rendered frame is its own
   hand-posed key, no blending — described by the presenter as literally imitating stop-motion
   ("you could imagine stop motion animation where dolls pose each frame"), with a direct on-screen
   A/B against a smoothly-interpolated version (29:53–30:26, 34:08–34:36). Checked this build's own
   easing module before writing the entry: Cadence already has a named `Constant` easing style, a
   one-click "Stop motion" command (`app.js stopMotionFlow`), and `ai/motion.js`'s
   `VARIATION_KINDS.stepped` already classifies exactly this kind of key with `CERTAIN` certainty as
   deliberate, not jitter. This is a shipped, professional AAA technique this build already fully
   supports at the single-key level — the gap is only that nothing currently applies it as a
   declared WHOLE-PERFORMANCE style. Also surfaced, from direct Q&A: the SAME studio tested
   lowering the CAMERA's frame rate to match and reverted it, because a stepped camera specifically
   "looks ugly" and "snappy" even though the identically-stepped character reads fine — logged as
   this entry's own non-use case rather than a separate finding. Wrote
   **`stepped_keyframes_replace_interpolation_for_2d_read`**.
2. A second, additional trick the presenter states is necessary ON TOP of #1: deliberately
   perturbing every key's pose away from anatomically clean — a joint bent slightly "wrong", a hand
   or foot not quite aligned, facial features off neutral — because a perfectly rigid transform is
   itself the cue the brain uses to detect "this is a 3D object." Explicit framing: "3D accuracy is
   not priority in this workflow... expressiveness over accuracy" (31:57–33:34). Wrote
   **`per_key_pose_imperfection_defeats_rigid_3d_read`**.
3. A custom, engine-level SCALE animation system — non-uniform per-bone scale as its own channel,
   built specifically because the target engine did not support it — used for perspective
   exaggeration on limbs/hands/feet and for making elements hide/appear, framed explicitly as this
   source's own equivalent of squash & stretch (31:15–31:43, 33:15–33:24). Directly strengthens this
   build's own compiled `squash_stretch` card, whose `roblox_considerations` already speculates that
   literal scale-keying is "a real, not merely theoretical, extension" since Roblox parts can be
   scaled — checked `propTracks.js` directly and confirmed `BasePart.Size`/`Model.Scale` already
   exist generically in this build's property-track system, just not confirmed wired to a rig's own
   limb parts through the pose path. Wrote **`nonuniform_scale_keys_drive_2d_exaggeration_tricks`**.
4. Each character gets its own fixed, non-moving, per-character light vector, with NO global scene
   lighting on characters at all — stated as deliberate specifically so a given action reads
   identically regardless of which stage it happens on (18:10–18:30). Directly confirmed and BOUNDED
   by the presenter himself under audience questioning: asked whether the same approach could work
   for a game with more open camera movement (an RPG), he says "That's true... we knew it was going
   to be a fighting game with a fixed camera... If we were going to do an RPG or action game, we
   would take a different route, obviously... probably not [applicable to wider games]" (52:52–
   53:55) — a rare case of the presenter naming his own technique's boundary explicitly and
   unprompted, rather than a session inferring it. Wrote
   **`fixed_per_character_key_light_assumes_locked_camera`**.

**Not written as entries** (real content, kept to notes): the inverted-hull outline method with
vertex-color-driven variable width, and the axis-aligned-UV technique for resolution-independent
inner lines (23:03–29:07), are real, clever, and demonstrated live on screen, but are pure
shading/texturing pipeline techniques with no animation-craft angle and no Cadence connection at
all (Cadence has no shading pipeline). The decision to use Unreal Engine 3 and Autodesk Softimage,
and the real-time shader preview workflow (09:35–10:41), are production-tooling choices rather than
animation techniques.

**Contradicted an existing card:** none — this video's findings EXTEND two existing cards
(`squash_stretch`'s Roblox-extension speculation, entry 3 above) rather than contradicting anything.

**Capture candidate:** none — every demonstration is a rigged 3D character in a modeling-software
viewport or in-game footage, no independent filmed reference performance.

**Checks for the queue:**
- `check: stepped_key_proportion_vs_declared_style — the proportion of `Constant`/`None`-eased keys
  across a project's tracks, compared against a declared anime/limited-animation style target;
  buildable today from `ai/motion.js`'s existing per-track easing tally (the `stepped` counter) —
  video 51 @ 29:53–30:26`
- `check: camera_track_stepped_mismatch_flag — flag a project where the CAMERA's own keys are
  stepped at a materially higher rate than usual while character tracks are also stepped, since this
  source directly tested and rejected exactly that combination — buildable from the same easing
  tally applied to a camera item's tracks — video 51 @ 43:37–44:37`

**Entries written:** `W06-51-stepped-keyframes-replace-interpolation-for-2d-read.json`,
`W06-51-per-key-pose-imperfection-defeats-rigid-3d-read.json`,
`W06-51-nonuniform-scale-keys-drive-2d-exaggeration-tricks.json`,
`W06-51-fixed-per-character-key-light-assumes-locked-camera.json` — all four checked directly
against `validateProposedEntry`/`validateEvidenceSource` (imported and run from
`renderer/js/ai/knowledge.js` directly, not assumed) before moving on; all pass.

### 52. The Animation of Guilty Gear Xrd & Dragon Ball FighterZ — New Frame Plus (Dan)

2026-09-11. Watched at `transcript` detail (458 caption segments; the initial yt-dlp call hit the
desktop's known intermittent DNS drop — `Failed to resolve 'www.youtube.com'` on the first several
retries — and succeeded on a later automatic retry with no other change, consistent with the
standing note that this is a retry, not a failure). An explicit companion to video 51: Dan states
directly and repeatedly that "much of what I'm about to say here comes directly from" the same GDC
talk just watched, and the transcript confirms this closely — the same "kill everything 3D" phrase,
the same stepped-keys mechanism, the same per-character independent lighting, and the same custom
500+-joint scale/deformation system are all restated from an external, analytical point of view
rather than the developer's own account. Matches W06.md's framing for this video exactly ("the same
idea analysed from outside; the anime style profile's numbers").

**What it teaches, specifically — genuinely new ground beyond video 51:**
1. A direct, same-studio, same-underlying-tech A/B: Dragon Ball FighterZ deliberately targets LOWER
   motion fidelity and longer pose holds than Guilty Gear Xrd, specifically to stay authentic to
   Dragon Ball's own more economical TV-anime production history — treated as a correctness question,
   not merely a budget one. The sharpest evidence is the counter-example: Guilty Gear's Sol Badguy
   gets visible idle breathing/cloth secondary motion that "you won't see... in Dragon Ball Fighters
   either, because it just wouldn't look right" (14:41–15:21). Checked this build's `ai/style.js`
   directly: its five style buckets would call BOTH games simply "anime," one level too coarse for
   what this comparison shows; the closer existing mechanism is Part 36's `ai/reference.js`
   profile/distance machinery, which already measures a project's timing against a stored reference
   numerically — just never seeded from an external franchise description. Wrote
   **`matching_own_fidelity_down_to_source_material_budget`**.
2. A specific, vivid effects-pipeline technique not mentioned in video 51's own (necessarily
   time-limited) talk: certain effects — the source's own example, dust clouds at a character's feet
   — were modeled as a completely new, hand-sculpted mesh for every single frame, rather than a
   particle system, specifically so the effect reads with the same hand-authored, stepped character
   as everything else on screen ("and that is bonkers", the presenter's own reaction) (11:54–12:14).
   Genuinely distinct from anything in the existing corpus: the same "hand-posed, not a computer's
   automated result" principle applied to VFX GEOMETRY rather than character bones. Wrote
   **`frame_by_frame_remodeled_mesh_for_stepped_vfx`**.

**Cross-checks** (confirmations of video 51 and existing cards from an independent source, not new
entries): the exact phrase "kill everything 3D" is restated independently (05:16 in this video vs.
11:13 in video 51), strong corroboration that this was the studio's own real internal framing rather
than one interviewer's paraphrase. The stepped-keys mechanism is restated with an accessible ball-
on-screen analogy (08:43–09:31) — confirms `stepped_keyframes_replace_interpolation_for_2d_read`
with no new mechanism. Per-key imperfection and the 500+-joint scale/deformation system are both
restated (10:19–11:52) — confirms `per_key_pose_imperfection_defeats_rigid_3d_read` and
`nonuniform_scale_keys_drive_2d_exaggeration_tricks`, adding the detail that when even 500+ joints of
deformation are insufficient for an extreme character transformation, the whole character MODEL is
swapped on the fly instead — close enough to the same video's own Q&A detail about Millia's hair
(a different granularity of the same "can't do it with one mesh, so swap meshes" idea) that a third
entry was judged not additive. The smears-vs-speed-lines comparison between the two games (14:23–
14:36) directly extends `motion_smear_readability` (W01) with a second named alternative
(old-school 2D speed lines) but adds no new mechanism on its own.

**Updated an existing entry in this same batch, based on new evidence:** this video reports that
LATER versions of Guilty Gear Xrd added an OPTIONAL, more dynamic scene-based lighting mode
(05:58–06:12) — meaning the studio itself partially walked back the fully-fixed-lighting approach
video 51's own entry 4 describes. Added this as a named failure-mode/caveat directly to
`W06-51-fixed-per-character-key-light-assumes-locked-camera.json` rather than treating it as a
contradiction — the original entry's evidence and boundary both still hold for the ORIGINAL release
this batch's sources describe, this is a real, worth-recording update to how permanently that
choice actually stuck.

**Contradicted an existing card:** none.

**Capture candidate:** none — entirely in-engine developer footage and stills, no independent
filmed reference performance.

**Checks for the queue:** none new — entry 1's own `detection_and_measurement_methods` already
states the closest real path (a reference-profile distance comparison) rather than a fully
buildable check in its own right, and entry 2 is honestly marked not measurable in this build at all.

**Entries written:** `W06-52-matching-own-fidelity-down-to-source-material-budget.json`,
`W06-52-frame-by-frame-remodeled-mesh-for-stepped-vfx.json` — both checked directly against
`validateProposedEntry`/`validateEvidenceSource`; both pass; re-swept together with all four of
video 51's entries for concept-name collisions, none found.

### 53. How to Animate a Smash Bros Character // MARIO — New Frame Plus (Dan)

2026-09-11. Watched at `transcript` detail (330 caption segments, clean on first pull, full 12:59
read in full). Matches W06.md's framing ("designing a moveset: anticipation, active frames, recovery
per move") closely, though the video's own most valuable content turned out to be a two-axis
adaptation framework rather than frame-data specifics.

**What it teaches, specifically:**
1. The video's own explicit organizing thesis: judge any adaptation of an existing character into a
   new game against TWO separate, independently-gradable goals — aesthetic fidelity (does it still
   look/feel like the character) and functional fidelity (does it play right for the new genre) —
   applied directly to Mario, judged a full success on BOTH, yet the source still identifies a real
   THIRD gap: jumping, Mario's single most identity-defining trait, plays almost no role in his
   moveset's actual CONTENT (04:22–04:37, 06:31–09:22, 09:58–10:23). Checked `ai/review.js`'s Part 14
   quality hierarchy directly before writing this entry: all thirteen existing layers judge a single
   shot's own internal consistency, and none references fidelity against a pre-existing EXTERNAL
   character's identity at all — a genuinely different, adaptation-specific axis this build's
   hierarchy does not cover. Wrote
   **`aesthetic_and_functional_fidelity_are_independent_adaptation_goals`**.
2. A concrete staging technique found by direct side-by-side comparison against the original source
   footage: Mario's Smash three-hit combo deliberately swaps to lead with the LEFT hand (the original
   Mario 64 combo leads right) specifically because it opens his body toward the fixed 2D-plane
   camera for the first hit, and sets up a stronger-reading torso twist on the second hit as a direct
   consequence (08:08–08:31). Wrote **`handedness_swap_for_camera_facing_pose_openness`**.

**Cross-checks** (strong new quantified evidence for existing cards, not new entries): the most
concrete number in the whole video is a direct frame-count comparison — Mario's first combo punch
takes "about 10 frames to land" in its original Mario 64 appearance versus "maybe two" in Smash, so
fast that "there's not even time for Mario to do a wind-up anticipation pose, so they've had to try
to build the feeling of a wind-up into the FIRST FRAME of the attack" (07:41–08:02). This is the same
mechanism W01's own closing summary already names as a ladder
(`layered_anticipation`→`startup_frame_budget`→`implied_zero_frame_anticipation`), now with a
concrete ~5x (10→2-3 frame) cross-game compression ratio attached as fresh evidence — logged here
for that ladder rather than restated as a new entry. The exaggerated fist/foot size and the layered
hit-effects (hit pause, screen shake, a stated six-frame hit-pause specifically on the OPPONENT)
selling every connected hit (08:39–09:03) directly confirms `hitstop_freeze_on_confirmed_hit` (W04)
with a new concrete frame count, and the fist/foot size effect is the same exaggeration vocabulary
`exaggeration`/`squash_stretch` already cover — not written as new entries.

**Not written as entries** (real content, kept to notes): the video's opening scene-setting about
Smash's general functional requirements (fast, clear, silhouette-readable against a chaotic screen,
03:01–03:11) restates `staging` and general genre-speed requirements with no new mechanism specific
enough to add. The critique that Mario's jump doesn't use his single most iconic pose, and that his
up-special missed an obvious reference opportunity (09:28–09:57), is real but is a moveset-CONTENT
design critique already folded into entry 1 above rather than split into its own entry.

**Contradicted an existing card:** none.

**Capture candidate:** none — entirely side-by-side in-game footage comparisons, no independent
filmed reference performance.

**Checks for the queue:** none new — entry 2's own `detection_and_measurement_methods` already states
the real blocker (no camera-relationship model, the same SHOT-003/004 gap this batch's other entries
document) rather than a fully buildable check in its own right.

**Entries written:** `W06-53-aesthetic-and-functional-fidelity-are-independent-adaptation-goals.json`,
`W06-53-handedness-swap-for-camera-facing-pose-openness.json` — both checked directly against
`validateProposedEntry`/`validateEvidenceSource`; both pass; re-swept against the full batch so far
(six prior entries) for concept-name collisions, none found.

### 54. The Overanimation of Zenless Zone Zero — New Frame Plus (Dan)

2026-09-11. Watched at `transcript` detail (628 caption segments, clean on first pull, full 24:02
read in full). Matches W06.md's framing exactly ("when more animation hurts readability, Part 14's
hierarchy") — and this is the densest, most directly build-relevant video in the batch so far,
engaging this build's OWN `ai/review.js` Part 14 hierarchy and anti-patterns closely enough that I
re-read that module's actual `QUALITY_LAYERS`/`HIERARCHY_ANTIPATTERNS` source directly before writing
either entry, rather than working from memory of what it covers.

**What it teaches, specifically:**
1. The video's own central, extensively-argued thesis: "over-animation" — correctly executing known
   principles (arcs, anticipation, exaggeration, overlap) but applying them INDISCRIMINATELY, at high
   intensity, on every movement regardless of whether that specific moment calls for it — is a
   describable defect distinct from a deliberate maximalist STYLE choice; a chosen exaggerated style
   can still be executed with judgment about where to hold back (01:23–10:50). Three concrete,
   evidenced instantiations are folded into this one entry rather than split further: (a) the SAME
   character reading with wildly different energy across different production contexts within one
   project with no story reason ("this guy's had a complete change of personality... it's happening
   all the time", 15:29–15:53); (b) uniform maximalist treatment flattening cross-CHARACTER contrast
   the same game's own other, less-animated modes already establish better (16:54–18:24); (c)
   mistaking more/bigger execution for better craft. Checked `ai/review.js` directly: its
   `HIERARCHY_ANTIPATTERNS` already encode a NARROWER special case (one layer's polish covering for
   another layer's defect); this video's broader claim — a technique needs no COMPETING defect to be
   misapplied, indiscriminate use is itself the failure — has no equivalent anywhere in the thirteen
   layers. Also connects directly to the already-queued check #6
   (`global_timing_register_consistency`, LESSONS.md, "now partly unblocked") — finding (a) above
   extends that queued check from pure TIMING variance to EXAGGERATION-AMPLITUDE variance across a
   project's clips, a related but distinct quantity worth noting at merge time. Wrote
   **`indiscriminate_technique_application_is_overanimation_not_style`**.
2. A second, orthogonal claim, argued separately and at length: technically precise execution of
   known techniques does not by itself produce "the illusion of life" — that depends on whether the
   underlying ACTING CHOICE is genuine and specific rather than a recognizable performance cliché tied
   to a character's archetype, a question sitting entirely above how well any individual pose is
   drawn (09:34–09:40, 19:33–20:16). Checked this against Cadence's own Part 14 layer 1 ("intent and
   purpose") directly: even that layer is scoped to a shot's own declared `AcceptanceSpec` — a
   functional goal — never to whether the depicted emotion itself is genuine versus clichéd, and
   Cadence has no face system and no representation of emotional intent as project data at all, so
   this is honestly out of scope rather than a wiring gap. Wrote
   **`technical_precision_does_not_substitute_for_genuine_acting_choice`**.

**Not written as entries** (real content, kept to notes): the opening praise for the game's combat
animation, exploration hub touches, and menu-navigation poses (00:04–06:06) is scene-setting rather
than a technique; the "floaty keep-alive" idle motion and heavy real-time secondary physics critique
(06:08–07:24) is a specific instance of finding 1's general principle (too much secondary motion
applied uniformly) rather than a separately distinct mechanism.

**Contradicted an existing card:** none — this video SHARPENS how this build's own existing Part 14
hierarchy is scoped (naming what it does and does not cover) rather than contradicting anything in
the knowledge corpus itself.

**Capture candidate:** none — entirely shipped game footage analysis, no independent filmed
reference performance.

**Checks for the queue:**
- `check: cross_context_amplitude_consistency — extends the already-queued
  global_timing_register_consistency (LESSONS.md #6) from phase-DURATION variance to per-phase
  velocity/acceleration AMPLITUDE variance across a project's clips, cross-referenced against each
  clip's own declared narrative/gameplay context — blocked on the same missing per-clip context
  declaration check #6 already needs, plus the cross-project comparison `search_library` now partly
  unblocks — video 54 @ 15:29–15:53`

**Entries written:** `W06-54-indiscriminate-technique-application-is-overanimation-not-style.json`,
`W06-54-technical-precision-does-not-substitute-for-genuine-acting-choice.json` — both checked
directly against `validateProposedEntry`/`validateEvidenceSource`; both pass; re-swept against the
full batch so far (eight prior entries) for concept-name collisions, none found.
