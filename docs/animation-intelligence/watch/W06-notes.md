# W06 notes — videos 51–60 (C. Game animation talks and analysis · D. Anime and stylised action)

## Checklist

- [x] 51. GuiltyGearXrd's Art Style : The X Factor Between 2D and 3D — GDC (58:59) — https://youtu.be/yhGjCzxJV3E
- [x] 52. The Animation of Guilty Gear Xrd & Dragon Ball FighterZ — New Frame Plus (17:21) — https://youtu.be/kZsboyfs-L4
- [ ] 53. How to Animate a Smash Bros Character // MARIO — New Frame Plus (12:59) — https://youtu.be/NHwnTm5o1kc
- [ ] 54. The Overanimation of Zenless Zone Zero — New Frame Plus (24:03) — https://youtu.be/1yH4Qz23FqM
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
