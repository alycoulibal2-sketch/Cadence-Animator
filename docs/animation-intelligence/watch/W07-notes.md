# W07 notes — videos 61–70 (D. Anime and stylised action · E. Roblox and Moon Animator)

- [x] 61. Types of Frames in Animation — NobleFrugal Studio (9:53)
- [x] 62. Every (Anime) Animation Technique Explained in 12 Minutes — SinChi (13:01)
- [ ] 63. The Art of Animators (or Sakuga) — RCAnime (7:44)
- [ ] 64. Sakuga OVERKILL! | Animation Analysis: Stark vs Dragon — MankoMan (25:12)
- [ ] 65. I Spent 30 Days ANIMATING this FIGHT SCENE!! — Shrimpy (16:31)
- [ ] 66. PWOW Workshop - Introduction to Animation Breakdowns — Toniko Pantoja (16:25)
- [ ] 67. Moon Animator 2 Basics - Official Tutorial — six (4:41)
- [ ] 68. Roblox ANIMATION Guide #1 - Moon Animator (2026) — Nisky (12:07)
- [ ] 69. Roblox Animation in Blender: Full Beginner Guide [2026] — Nisky (7:46)
- [ ] 70. Roblox Animation in Blender: Advanced Guide (2026) — Nisky (31:26)

---

## Video 61 — Types of Frames in Animation — NobleFrugal Studio (9:53)
https://youtu.be/EMXSFQ4pdUM — watched 2026-09-12, `balanced` detail, 41 frames (all read), captions transcript.

Despite the batch list's one-line gloss ("keys, extremes, breakdowns, in-betweens, smears, holds —
the pose roles of Part 28"), the video actually teaches three specific advanced techniques by name —
**smears, impact frames, and stutter frames** — not the general Part 28 vocabulary; noting the
mismatch rather than silently substituting what was expected for what was shown.

**Smears** are grounded explicitly in a long-exposure-photography analogy (camera shutter/sensor,
diagrammed on screen at t=00:53) and built by one of three named methods: **doubles** (discrete
duplicate silhouettes of the object at successive past instants, like a visible timing chart),
**streak/blur** (a single flowing line shape tracing the motion path), or **both together**, which
the source states is the most natural-looking of the three (all three labelled on-screen at
t=01:45–02:44: "DOUBLES", "BLURS", "BOTH"). Two other rules: blur/double density increases toward
the impact (informed by the presenter's own filmed reference footage, not invented), and smears
should be animated on ones, not twos. Wrote this up as **`smear_construction_doubles_streak_or_
combined`** — new relative to the existing `motion_smear_readability` (W01) and `prep_smear_
slowdown_three_phase_smear_structure` (W06-60) cards, which cover WHETHER/WHY to smear and its
surrounding phase timing but not these specific construction methods. Flagged, not resolved: this
video's "doubles" looks like the same underlying mechanism as W06-57's "multiples" (Captain
America's shield), but the two sources frame it differently — W06-57 treats multiples vs. smear as
an either/or weight-reading choice, this video treats doubles and streak as freely combinable with
no weight claim. Worth reconciling at merge time.

**Impact frames** — a **cross-check, not a new entry**: this is the same technique as the already-
queued `high_contrast_monochrome_burst_as_named_impact_frame_technique` (W06-59, high-contrast
black-and-white radiating-line burst at a hit). W06-59's own evidence_status says its source video
had no transcript, so it could not capture any stated rationale. This video supplies exactly that
missing rationale, independently: impact frames are described directly as "an artificially drawn
camera shake" (t=03:31–03:39, "IMPACT"/"CAMERA SHAKE" labelled on-canvas), the radiating jagged
lines are stated to deliberately all point toward the impact point (not random), the palette is
deliberately reserved as black-and-white for contrast, and — notably — the presenter states this
exaggerates BEYOND what his own filmed hammer-impact reference actually showed ("something that
doesn't happen in the reference"), confirming the technique is a deliberate stylization rather than
a faithful copy. Also new: an explicit rhythm/beat framing — the presenter describes the whole
animation as a beat pattern and says the impact frame's placement IS the beat. Worth folding into
W06-59 at merge/edit time rather than duplicating the concept here.

**Stutter frames** — genuinely new, not covered by any existing card. A second pass laid over an
already-animated slow-down: after each normal (black) frame, an extra (red, in the demo) "stutter"
frame is inserted showing the same pose pushed backward against the direction of travel, with the
backward displacement shrinking on each successive stutter frame across the sequence (labelled
"(DIMINISHING)" on-canvas at t=08:03/08:48/08:54, red color-picker mid-selection at t=06:11
confirming the black/red frame distinction stated in the transcript). The presenter's own read of
the result: "it almost looks like he's loading up a strike" — a shake that decays to nothing as the
base motion settles, distinct from constant or random jitter. Wrote this up as
**`stutter_frame_diminishing_counter_motion`**.

No capture candidate: the whole video is 2D hand-drawn tablet demonstration plus a live-action
reference clip of the presenter swinging a foam/toy hammer at a cardboard box (visible at
t=00:00–00:53 and again t=03:43, used only as drawing reference, not as a clean 3D-trackable
motion — a full-body swing-and-strike into a static object, filmed at an angle and partly out of
frame, not the kind of clean single-subject clip Roblox Studio's Animation Capture wants).

check: none new — the closest measurable idea (blur/spacing density increasing into an impact) is
already queued as check #10-adjacent territory via `peak_spacing_immediately_before_impact`
(W04-34); this video adds drawing-density evidence for the same proximity gradient rather than a
new measurable quantity.

Entries written: `W07-61-smear-construction-doubles-streak-or-combined.json`,
`W07-61-stutter-frame-diminishing-counter-motion.json`. Both pass `validateProposedEntry` (20/20
fields) and `validateEvidenceSource`.

## Video 62 — Every (Anime) Animation Technique Explained in 12 Minutes — SinChi (13:01)
https://youtu.be/iMV9Tlpo1wY — watched 2026-09-12, `efficient` detail, 50 keyframes (all read),
captions transcript (367 segments). A rapid-fire glossary of ~15 named techniques, each with an
on-screen corner label — the labels repeatedly CORRECTED the auto-caption transcript's mangled
proper nouns (Japanese animator names transliterate badly): "kutsuna lighting" not "ton katuna",
"yutapon cubes" not "uton cubes", "Densetsu Kyojin Ideon" not "Denu kyin eon". Worth a general
note: for any future video whose subject is named-technique trivia, the on-screen labels are more
trustworthy evidence than the caption track for proper nouns, and should be checked whenever a
name looks garbled.

Given the glossary format, most items are either restatements/light extensions of existing cards
(impact frames — again Yutaka Nakamura, cross-checking W06-59/video 61; smear "spiky vs. wobbly"
named-animator style variants, extending `motion_smear_readability`'s style_variations) or explicit
CATEGORIES/lineages the presenter himself flags as not techniques ("oh wait, this is not a
technique, it's a category" — character acting; kanada-style and noro-school are studio/animator
lineages, not isolated techniques, so left as notes rather than entries) or entirely out of this
tool's scope (background-animation production categories: drawn/illustrated/CG — a painted-2D-layer
concern Cadence has no analogue for at all). Wrote up five genuinely new, specific, well-evidenced
entries instead of forcing all ~15 into cards:

- **`yutapon_cubes_versus_cubic_debris_timing_distinction`** — two cube-shaped debris techniques
  that look alike but differ in exactly one way: cubic debris is decorative/untimed, Yutapon cubes
  (Yutaka Nakamura) are built around a deliberate hold-then-release beat. The timing half is
  measurable today via existing marker + velocity data (same shape as check #4, #27).
- **`rotoscoping_tracing_live_action_or_cg_reference`** — tracing filmed/CG reference frame-by-frame
  rather than just watching it for timing. Directly analogous to this programme's own Roblox Studio
  Animation Capture pipeline (same proportion-translation caveat REF-001 already carries).
- **`kagenashi_shadowless_shading_tradeoff`** — omitting all cast shadows, either as a flat style or
  to save the linework/coloring budget shadows cost, spending it on clearer motion instead (Naruto
  Shippuden named as the example). Out of `ai/**`'s scope (a renderer/material concern), but worth
  having as corpus vocabulary.
- **`itano_circus_multi_projectile_evasion_choreography`** — one target evading/pursued by many
  independently-curving homing projectiles (Ichiro Itano, originated in Densetsu Kyojin Ideon,
  popularized by Macross 1982). Flagged as a genuinely NEW capability gap, not an extension of an
  existing one: `ai/motion.js` has no multi-body/multi-projectile relative-motion measurement at
  all. Directly relevant to Roblox combat (a boss barrage/bullet-hell encounter is the same shape).
- **`obari_punch_camera_facing_pose_sequence`** — a named four-beat pose formula (Masami Obari,
  Fist of the North Star) whose defining trait is the final strike aiming AT THE CAMERA rather than
  across the frame. Directly relevant to the master directive's open starting-recipe question
  (§7.3) as a concrete, evidenced candidate recipe, and re-surfaces the SHOT-003/004 camera-model
  gap from a new angle (a pose's payoff depending on camera-relative direction, not just framing).

No capture candidate: every source clip is either existing anime footage or 2D/CG production
b-roll, none of it a clean single-subject 3D-trackable performance.

check: none new beyond what's already queued — the Yutapon-cubes timing distinction reuses check
#4/#27's existing measurement shape rather than needing a new one.

Entries written: `W07-62-yutapon-cubes-versus-cubic-debris-timing.json`,
`W07-62-rotoscoping-tracing-reference-footage.json`, `W07-62-kagenashi-shadowless-shading-tradeoff.json`,
`W07-62-itano-circus-multi-projectile-evasion.json`, `W07-62-obari-punch-camera-facing-pose-sequence.json`.
All five pass `validateProposedEntry` (20/20) and `validateEvidenceSource`. A full corpus + inbox
sweep after writing (173 concepts: main `knowledge/` + inbox W03–W07) found zero concept-name
collisions.
