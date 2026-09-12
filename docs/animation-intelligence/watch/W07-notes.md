# W07 notes — videos 61–70 (D. Anime and stylised action · E. Roblox and Moon Animator)

- [x] 61. Types of Frames in Animation — NobleFrugal Studio (9:53)
- [x] 62. Every (Anime) Animation Technique Explained in 12 Minutes — SinChi (13:01)
- [x] 63. The Art of Animators (or Sakuga) — RCAnime (7:44)
- [x] 64. Sakuga OVERKILL! | Animation Analysis: Stark vs Dragon — MankoMan (25:12)
- [x] 65. I Spent 30 Days ANIMATING this FIGHT SCENE!! — Shrimpy (16:31)
- [x] 66. PWOW Workshop - Introduction to Animation Breakdowns — Toniko Pantoja (16:25)
- [x] 67. Moon Animator 2 Basics - Official Tutorial — six (4:41)
- [x] 68. Roblox ANIMATION Guide #1 - Moon Animator (2026) — Nisky (12:07)
- [x] 69. Roblox Animation in Blender: Full Beginner Guide [2026] — Nisky (7:46)
- [x] 70. Roblox Animation in Blender: Advanced Guide (2026) — Nisky (31:26)

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

## Video 63 — The Art of Animators (or Sakuga) — RCAnime (7:44)
https://youtu.be/-aChpK2jcnQ — watched 2026-09-12, `efficient` detail, 50 keyframes (spread across
the video's clip-montage format — mostly illustrative anime clips with no on-screen diagrams, so
frames added little beyond confirming the montage format itself; one frame at t=01:57 confirmed
"Panda and the Magic Serpent" (1958) as claimed), captions transcript (166 segments).

An appreciation/history essay on animator craft rather than a tutorial: defines **sakuga** directly
("the moment in anime in which animation quality improves drastically... otherwise known as the
money shot... shows today still have stilted moments for the less important scenes, but when
something big happens the quality bumps up"), credits Yasuo Otsuka as originating the concept
(Hols: Prince of the Sun, 1968), then surveys ~15 named animators along a realism-to-surrealism
spectrum (Hiroyuki Okiura, Katsuhiro Otomo/Akira, Mitsuo Iso, Koji Morimoto, Shinya Ohira, Masaaki
Yuasa, and others). Left the animator survey itself as historical context in these notes rather
than forcing it into entries — it's genuinely general ("different animators sit at different points
on a realism/surrealism spectrum") rather than a specific, actionable technique, which the "specific
beats general" rule argues against encoding.

Two entries did meet the bar:

- **`sakuga_localized_quality_spike_reserved_for_key_scenes`** — new. This is a PRODUCTION-level
  budget-allocation policy (spend disproportionately on specific money-shot scenes, hold everything
  else to a cheaper baseline) distinct from any single existing entry, which are all about budget
  WITHIN one action/shot rather than allocation ACROSS a whole show's scenes.
- **`hand_drawn_layer_hold_rate_convention_by_layer_type`** — new, but a close sibling of
  `differential_frame_rate_per_layer_for_performance_and_style` (W06-55): both are "different layers
  run at different effective rates" in shape, but this one is hand-drawn TV production's actual
  numbers (24fps deliverable, characters held at 8-12fps-equivalent, backgrounds at 6-8), a
  cost-driven PERMANENT convention traced historically to TV anime's schedule pressure (Astro Boy
  cited as the rough early result), not W06-55's real-time-rendering performance/style motive.
  Cross-referenced both directions rather than merged, per this batch's established practice for
  same-shape-different-domain findings.

No capture candidate (clip montage of existing anime, no original demonstrable motion). No new
check beyond what's queued — the layer-hold-rate entry's comparison (background vs. character key
density) is a straightforward extension of the already-existing `keyDensity` measurement.

Entries written: `W07-63-sakuga-localized-quality-spike-key-scenes.json`,
`W07-63-layer-hold-rate-convention-by-layer-type.json`. Both pass `validateProposedEntry` (20/20)
and `validateEvidenceSource`.

## Video 64 — Sakuga OVERKILL! | Animation Analysis: Stark vs Dragon — MankoMan (25:12)
https://youtu.be/ibavOZYfsnQ — watched 2026-09-12, `efficient` detail, 50 keyframes (a reaction-
video layout, webcam inset over the analyzed anime clip — frames mainly confirmed general moments
rather than showing diagrams), captions transcript (781 segments, read in full).

A shot-by-shot cut-analysis of one fight scene (Frieren: Stark vs. a dragon), heavy on industry
credits/connections trivia (which freelance animator did which cut, who's "uton-inspired", studio
politics about Jujutsu Kaisen "losing" animators to this show) that doesn't belong in the knowledge
base — general industry commentary, not technique, left out entirely rather than forced into
entries. Underneath the gossip, four genuinely specific and novel techniques surfaced, all from
close reading of exactly what the analyst says is happening in specific cuts:

- **`scale_ambiguity_resolved_via_rotation_parallax`** — a huge subject as flat stacked 2D layers
  is ambiguous between "big and far" / "big and close"; rotating it (with the camera) resolves this
  via parallax. Named explicitly as a hard 2D problem — and a case where Cadence's real 3D viewport
  is already AHEAD of the 2D source technique (real rotation gives real parallax for free); the gap
  is only in deliberately checking for it, which needs the still-unbuilt SHOT-003/004 camera model.
- **`cast_shadow_as_connective_tissue_between_separate_layers`** — a moving cast shadow from one
  separately-animated element sweeping across another is what makes two layers read as physically
  interacting. Same "Cadence's 3D pipeline gets this for free" situation as the scale-parallax entry
  — flagged an interesting tension with `kagenashi_shadowless_shading_tradeoff` (video 62): a
  shadowless style forfeits this specific compositing tool.
- **`relative_motion_implies_subject_movement_without_animating_subject`** — hold a complex primary
  subject nearly static (carrying forward the previous cut's momentum) and animate everything AROUND
  it instead (background, a nearby character's hair/clothing); the viewer infers the subject's
  violent motion from surrounding relative motion alone. Named directly by the analyst as "the idea
  of relative motion." A clean, cheap alternative to `hand_drawn_layer_hold_rate_convention_by_layer_
  type`'s general economy, taken to its logical extreme.
  - **`snappy_easeout_signals_energy_transfer_not_dissipation`** — an ease-out's SPEED carries a
  physical claim: gradual reads as energy dissipating in place, deliberately snappy/abrupt reads as
  energy transferred onward to another body. Direct sibling of check #10
  (`external_force_easing_mismatch`, not yet built) but on the departure side of a beat rather than
  the approach side — worth building together.

Cross-check, not a new entry: a single ultra-detailed drawing held for one frame amid a fast
sequence (~16:00) reconfirms `subliminal_single_frame_impact_pose` (W04-36).

No capture candidate (existing broadcast anime footage, reaction-video format). No new check beyond
what the four new entries' own `detection_and_measurement_methods` already specify (two of the four
are directly buildable today with existing measurements: the snappy-easeout entry via `sampleMotion`
+ `ai/events.js`, cross-referenced the same way check #10 already is).

Entries written: `W07-64-scale-ambiguity-resolved-via-rotation-parallax.json`,
`W07-64-cast-shadow-as-connective-tissue.json`, `W07-64-relative-motion-implies-subject-movement.json`,
`W07-64-snappy-easeout-signals-energy-transfer.json`. All four pass `validateProposedEntry` (20/20)
and `validateEvidenceSource`.

## Video 65 — I Spent 30 Days ANIMATING this FIGHT SCENE!! — Shrimpy (16:31)
https://youtu.be/OVPfRoIP69Q — watched 2026-09-12, `balanced` detail; the first pass hit the 100-frame
cap so re-ran with `--max-frames 60` per §1 of W07.md; all 60 frames read, captions transcript (479
segments, read in full).

A hobbyist creator's production-diary vlog (heavy sponsor content — Displate, XP-Pen — left out
entirely) covering a full 2D pipeline for one fight scene: storyboard day, rough sketch/in-betweens,
line work, coloring, backgrounds, After Effects compositing (pans, camera shakes, glows), sound
design. Genuinely new technique content was thin under the vlog narrative, so this video produced
one entry rather than forcing several:

- **`combat_choreography_cannot_loop_cost_multiplier`** — a concrete, QUANTIFIED production-cost
  data point, rare in this corpus: idle/cyclic beats (breathing, running) were built from 4-7 looped
  frames cheaply, but genuine hand-to-hand combat has no repeatable unit at all — every frame is a
  new drawing — and the creator's own on-screen counter confirms the resulting cost cliff (44 hours
  for just 4 seconds of finished combat animation, versus 7 hours for 5 cuts of the loopable-heavy
  first act). Distinct from `walk_cycle_looping_vs_full_sequence_tradeoff` (W03-28), which is about a
  CHOICE between looping and full animation for content that COULD loop; this is about a category of
  content (unique contact-driven combat) that structurally never can. Also flagged as a case where
  Cadence's rig-based keyframe model sidesteps this specific 2D-production cost by construction —
  worth noting as a real strength, not just a gap to fill.

Two things considered and left out rather than forced: a physical action figure used as a 3D
reference for a difficult 2D pose (too thin an account — one line, no elaboration — to write up
against this programme's evidence bar); and the video's own three-act/day-budget schedule (this
creator's own personal schedule, not a generalizable technique).

No capture candidate: 2D hand-drawn throughout, nothing filmed of a real person to capture. No new
check.

Entries written: `W07-65-combat-choreography-cannot-loop-cost-multiplier.json`. Passes
`validateProposedEntry` (20/20) and `validateEvidenceSource`.

## Video 66 — PWOW Workshop - Introduction to Animation Breakdowns — Toniko Pantoja (16:25)
https://youtu.be/wdPbiy-8BRo — watched 2026-09-12, `balanced` detail, 72 frames (all read; well-
labeled diagrams throughout — "Breakdown 1 - BLINK", "Power Fighter", "Evasive Fighter",
"Strategist Fighter", a numbered "6. Character Performance" title card), captions transcript (one
subtitle track hit `HTTP 429` but a fallback track (`en-orig`) succeeded automatically, no retry
needed — worth noting as a case where the script's own multi-track fallback absorbed a 429 without
intervention). One of the best single sources in this batch — a professional character animator
(Toniko Pantoja) giving a genuinely structured lesson, not trivia or a vlog.

The central, extremely well-evidenced thesis: **holding the two key poses AND the timing between
them completely fixed, the breakdown's own content is sufficient on its own to produce an entirely
different character read.** Demonstrated twice, at length: a two-breakdown reaction shot whose
MEANING flips depending only on breakdown ORDER (squash-then-stretch reads as "registers, then
reacts"; stretch-then-squash reads as "caught off guard, then processes"); and — the standout
example — one identical punch key-pair reinterpreted through SIX named, individually-diagrammed
fighter archetypes (dull baseline, tight "seasoned", wound-up "Power Fighter" with overshoot
explicitly "to show weight", head-led "Evasive Fighter", flailing "hooligan", measuring
"strategist", block-then-strike martial artist) — same keys, same timing, six completely different
personalities. Wrote this up as **`breakdown_choice_encodes_character_independent_of_keys`**, cross-
referencing `deliberate_lead_choice_for_acting` (W02, v18, directly confirmed by the head-lead vs.
torso-lead fighter contrast) and the anticipation/overshoot ladder (the "overshot it to show weight"
line is a direct, independent confirmation of overshoot-as-weight-signal).

Caught my own near-mistake here: first drafted this entry with `category: "essential"` since the
thesis felt foundational, then checked and found ALL twelve "essential"-category entries in the
merged corpus are exactly the twelve compiled classical principles — no watch-batch entry across
179 prior inbox files has ever used it. `validateProposedEntry` doesn't actually block a user entry
from claiming "essential" (it passed), so this is an unenforced convention, not a hard rule — but
worth calling out explicitly for the merge session or the user to decide whether it should become
an enforced boundary. Fixed to `"advanced"` before committing, to keep with the unbroken 179-entry
precedent rather than assume the convention doesn't apply.

Second entry: **`breakdown_authorship_checklist_measurement_map`** — the source's own explicit,
numbered 6-point checklist (weight distribution, leading/delayed action, anticipation/overshoot,
path of motion, "ups and downs", character) for what to consider when authoring any breakdown. Five
of the six map directly to measurements this build already has (balance, `analyseChain` lead/lag,
anticipation timing, MOT-005 curvature, a partial secondary-bounce match); only "character" itself
is acknowledged by the source as unmeasurable ("abstract"). Framed as a composition/reporting
opportunity rather than a new-capability gap — a future breakdown-review tool could run the five
existing measurements together under this checklist's own six headings with no new primitive
required.

No capture candidate (2D drawn examples throughout, no filmed motion). No new check beyond what the
second entry's own measurement-mapping already names — it's a composition of existing measurements,
not a new one.

Entries written: `W07-66-breakdown-choice-encodes-character-independent-of-keys.json`,
`W07-66-breakdown-authorship-checklist-measurement-map.json`. Both pass `validateProposedEntry`
(20/20) and `validateEvidenceSource`.

## Video 67 — Moon Animator 2 Basics - Official Tutorial — six (4:41)
https://youtu.be/q8tGNMo_jHg — watched 2026-09-12, `balanced` detail, 21 frames (all read; UI-heavy
screen-recording, confirmed the orange-themed per-part timeline panel and colored keyframe diamonds
but no diagram beyond that), captions transcript (110 segments, read in full). Moon Animator's OWN
official basics tutorial, from its author ("six") — exactly "the tool Cadence replaces, from its
author" per the batch list's own gloss.

Most of this video is software feature/keybind instruction (install flow, add-item window, R6 rig
insertion, EasyWeld prop attachment, export/import to Roblox via ServerStorage KeyframeSequences,
keyframe grouping, markers) rather than animation craft — genuinely useful for the SEPARATE Moon-
parity tracking effort, but not "techniques or rules" in the Part 25 sense the knowledge schema is
built for, so **written up here as parity notes rather than forced into knowledge entries**:

- **Direct-manipulation keying**: clicking a part selects its keyframe track; TRANSFORMING a part
  automatically adds a keyframe at the current playhead — no separate "add key" step for a normal
  transform edit. Worth comparing against Cadence's own keying model.
- Moon Animator's item model is broader than rigs: an arbitrary Roblox `Part` can be added to the
  file and keyed directly on `CFrame`/`Size`/color tracks, not just rig joints.
- The **camera is a first-class file item**: its own FOV and CFrame tracks, `Ctrl+H` hide/show the
  plugin UI, `Ctrl+Space` enable/disable camera tracks specifically (separate from other tracks).
- **Export/import round-trip**: "export all" writes `KeyframeSequence`s into `ServerStorage`;
  right-click → "save to Roblox" uploads one; a per-rig "import to rig" button pulls one back in.
  Exports default to grouped keyframes with an explicit "ungroup" action available.
  - A **marker track** uses the identical UI/interaction pattern as a keyframe track (add/edit the
  same way) but for named annotations / exported-frame renaming, not a pose value.
- Onion skin (`B`), reset-transform (`G`), and an edit-keyframe window (`7`) for easing are all
  bound to single keys with a preview-the-easing shortcut (`space` inside that window) — a low-
  friction, keyboard-first workflow throughout, worth keeping in mind for Cadence's own ergonomics
  work given the master directive's "no learning required" constraint cuts the other way (Moon's
  speed depends on a user having memorized these binds).

One genuine animation-craft technique DID meet the knowledge-entry bar:

- **`low_field_of_view_reads_cinematic`** — the author states directly: "set the field of view to
  35 — a low field of view creates a cinematic look." A concrete, numeric, directly-authorable
  camera rule, and the cheapest possible SHOT-003/004-adjacent finding in this whole programme so
  far (FOV is already a plain keyframeable scalar — no new capability needed, only the guidance
  connecting a target value to an intended register).

No capture candidate (screen recording of software, no performed motion). No new check — the FOV
entry is directly measurable today with no new primitive.

Entries written: `W07-67-low-field-of-view-reads-cinematic.json`. Passes `validateProposedEntry`
(20/20) and `validateEvidenceSource`.

## Video 68 — Roblox ANIMATION Guide #1 - Moon Animator (2026) — Nisky (12:07)
https://youtu.be/267aFypaeWU — watched 2026-09-12, `balanced` detail; first pass hit the 100-frame
cap so re-ran with `--max-frames 60` per §1 of W07.md; all 60 frames read (confirmed the per-part
timeline panel, a dense keyframe grid for the punch anticipation, and the camera's FieldOfView
track selected in the timeline), captions transcript (read in full).

A community Moon Animator tutorial covering much the same practical ground as video 67 (the tool's
own official basics), independently. Rather than write a near-duplicate entry, **enriched
`W07-67-low-field-of-view-reads-cinematic.json` in place** (both files are this same batch's own,
unmerged) with this video's independent confirmation and a fuller numeric range: "the smaller the
number, the closer it's going to be... the limit is 120, this is a very wide shot... around 80 to
50 is what I usually use the most, I'll say I probably use 50 the most" (@ 06:51–07:13) — the same
low-FOV-reads-cinematic relationship as video 67's FOV-35 example, now with a working range and an
explicit ceiling. Filed as a deliberate in-batch consolidation rather than two disconnected entries
citing the same underlying claim; noted here for the merge session since the file still carries the
`W07-67` name despite now citing both videos 67 and 68.

One new entry: **`lower_export_framerate_for_choppier_2d_style`** — Moon Animator's timeline FPS
default is 60; the source states directly that dropping it to 24 "is going to look pretty good" as
a deliberate choppy, 2D-anime-adjacent style choice, not a technical compromise. Distinct from
`differential_frame_rate_per_layer_for_performance_and_style` (W06-55, which mixes MULTIPLE
simultaneous rates across layers within one real-time scene) — this is a single, coarser, whole-clip
rate choice, and distinct from `hand_drawn_layer_hold_rate_convention_by_layer_type` (video 63,
actual hand-drawn TV anime conventions run character drawings far sparser, 8-12/sec) — 24fps is a
lighter step in that direction, not an attempt to literally match it.

Two things considered and left as parity notes rather than knowledge entries, since they're Moon-
Animator-workflow specifics rather than animation-craft principles: (1) "always animate the torso
first" (a stated best practice avoiding a named failure, "a goofy Superman position") — likely a
pitfall specific to Moon's flat per-part-track UI that Cadence's PoseSpec-based whole-pose authoring
(`compile_pose`/`author_motion`) avoids by construction, since it never lets a caller key one limb
in isolation before the rest of a pose exists; (2) the rig-to-rig animation retargeting workflow
(export one rig's AnimSaves, import onto a different rig, paste keyframes, fix a root-height offset,
mirror-flip with `Ctrl+R` for an asymmetric prop like a keyboard) — directly maps onto Cadence's own
`import_from_studio` + `mirror_item`, worth the Moon-parity effort reading this account.

No capture candidate (screen recording of software). No new check.

Entries written: `W07-68-lower-export-framerate-for-choppier-2d-style.json` (new), plus an in-place
enrichment of `W07-67-low-field-of-view-reads-cinematic.json`. Both pass `validateProposedEntry`
(20/20) and `validateEvidenceSource`.

## Video 69 — Roblox Animation in Blender: Full Beginner Guide [2026] — Nisky (7:46)
https://youtu.be/eg6COxaPCyo — watched 2026-09-12, `balanced` detail, 19 frames (all read; confirmed
the R6 rig's own labeled "FRONT"/"F" faces, a nice small orientation aid built into the tutorial's
rig, and the Blender pose-mode/dope-sheet/graph-editor UI), captions transcript (read in full). The
Blender route: install two add-ons (an RBX animation importer, a "lazy viewport" QoL tool), pose in
Blender, read the graph editor, export to Roblox.

Most of the craft content here restates what's already deeply covered: reading a flat vs. steep
F-curve as no-movement vs. fast-movement on an axis (basic curve literacy, not new); adding an
"in-between movement" partway through two extremes to read as smoother (a from-scratch rediscovery
of the classical breakdown concept video 66 covered in depth, from a THIRD independent context —
worth noting as a cross-batch confirmation that breakdowns matter even to someone with no formal
animation vocabulary, but not a new entry); and a "sway" where an arm "won't fully stop... extends
and goes back" (a graph-editor-visible instance of `overshoot_recoil_settle_pose_sequence`, W04-31
— cross-check, not new).

One genuinely new capability-relevant finding:

- **`procedural_curve_modifiers_for_loop_and_noise`** — Blender's graph editor can apply a non-
  destructive "Cycles" modifier (repeats a curve's keyed motion without duplicating keyframes) or a
  "Noise" modifier (procedural randomized perturbation with no hand-keyed jitter) directly to an
  existing curve. Flagged as a genuine, scoped capability gap rather than an out-of-scope rendering
  concern: Cadence's tracks are always explicit baked keyframes with no procedural-modifier concept
  at all, squarely inside `ai/**`'s own pose/motion domain rather than a 2D-drawing or compositing
  concern like most of this batch's other gaps. Directly in tension with `walk_cycle_looping_vs_
  full_sequence_tradeoff` (W03-28) when misused for content needing per-repeat variation — noted
  explicitly in the entry's own non_use_cases and failure_modes.

Parity note (not a knowledge entry): the Blender→Roblox pipeline itself (two Blender add-ons, an
"export animation"/copy-to-clipboard step, a matching Roblox Studio plugin "Blender Animations
Ultimate Edition" that pastes from clipboard and uploads, optional reimport into Moon Animator for
further editing) — a third distinct interop path alongside videos 67/68's AnimSaves-based flow,
worth the Moon-parity effort having on record. Also: "click Save As, not Save" to avoid overwriting
a reusable base rig file — pure file hygiene, not an animation technique, not recorded further.

No capture candidate (screen recording of software). No new check.

Entries written: `W07-69-procedural-curve-modifiers-for-loop-and-noise.json`. Passes
`validateProposedEntry` (20/20) and `validateEvidenceSource`.

## Video 70 — Roblox Animation in Blender: Advanced Guide (2026) — Nisky (31:26)
https://youtu.be/EM9u4gIHoRg — watched 2026-09-12, `efficient` detail, 50 keyframes (spread across
the full 31 minutes; confirmed the "ULTIMATE POSE PACK" asset browser with named thumbnails — A-Pose,
Idle A/B, Confident/Relaxed/T-Pose, Fight Stance, Hit Reaction, Kick A/B, Knockdown, Punch
Anticipation/Contact/Follow Through — and the graph-editor stepped-interpolation workflow), captions
transcript (891 segments, read in full). The longest video in this batch and, once the first ~8
minutes of pure rig-texturing/accessory-attachment software instruction and the final ~7 minutes of
troubleshooting (purple-rig-texture fix, animation-import anchoring) are set aside as out-of-scope
software mechanics, the single richest MIDDLE section of any video in W07.

Two strong new entries:

- **`reusable_pose_library_for_rapid_cycle_assembly`** — a library of individually-saved, NAMED,
  thumbnailed poses (not full motions) assembled into cycles in seconds ("I've literally made an
  idle cycle in like 4 seconds"). This is the single most direct, concrete, evidenced example this
  whole batch has found for the master directive's still-open starting-recipe question (§7.3) —
  complete with a working category taxonomy (defaults / action / cycles) that independently
  converges on the SAME phase vocabulary (anticipation, contact, follow-through) `authorMotion`
  already uses internally. Flagged as a distinct, smaller unit than `ai/library.js`'s existing
  full-motion entries: a reusable POSE, one level below a reusable MOTION.
- **`stepped_interpolation_bulk_apply_via_curve_modifier`** — the AUTHORING-MECHANISM companion to
  the already-existing `stepped_keyframes_replace_interpolation_for_2d_read` (W06-51): rather than
  baking `Constant` easing per key, apply a non-destructive "Stepped Interpolation" F-curve modifier
  to one curve and bulk-copy it to every curve at once, with a hold-length parameter directly named
  against "animating on twos/threes." This is real, external evidence for a solution shape to a gap
  W06-51 already names explicitly ("no tool currently applies it project-wide... a user must select
  every range by hand"). Also surfaced a genuinely NEW failure mode neither W06-51 nor any other
  card records: stepped interpolation looks good un-looped but "looks ridiculous" once looped — a
  step-phase/loop-boundary mismatch worth the merge session cross-linking into W06-51.

**Enriched `W07-68-lower-export-framerate-for-choppier-2d-style.json` in place** (written fresh in
video 68, untouched since) with this video's much stronger restatement of the same 24-vs-60fps claim
("60 is way too smooth... 99% of the time you want to keep this at 24... I probably haven't met
that many animators who even animate at 60"). Flagged
explicitly and honestly in the entry's own evidence_status that this is the SAME creator (Nisky)
restating the claim seven months later across two of this batch's videos, not independent
corroboration from a second source — worth being precise about, since the difference between "two
sources agree" and "one source said it twice" matters for how much confidence the merge session or
user should place in the specific "24fps, 99% of the time" framing.

Cross-check only, not a new entry: the pose-asset-library assembly workflow's own idle-polish step
(delaying the head+arms keyframes 2-3 frames after the base cycle is built) confirms the existing
chain-depth/secondary-delay family (W02 v16, LESSONS check #22) yet again, from a fourth independent
context — not written up separately since the underlying measurement claim is already thoroughly
covered; the news here is the WORKFLOW placement (a discrete polish pass after structural assembly),
not a new measurement.

No capture candidate (screen recording of software throughout). No new check beyond what the two new
entries' own fields already specify.

Entries written: `W07-70-reusable-pose-library-for-rapid-cycle-assembly.json`,
`W07-70-stepped-interpolation-bulk-apply-via-curve-modifier.json` (new), plus a second in-place
enrichment of `W07-68-lower-export-framerate-for-choppier-2d-style.json`. All pass
`validateProposedEntry` (20/20) and `validateEvidenceSource`.

---

## Closing summary — W07 complete (videos 61–70, all ten watched)

Counts below are recomputed directly from the files on disk, not carried forward from a running
tally (per the standing lesson from W03/W04): `ls docs/animation-intelligence/knowledge/inbox/W07-*.json | wc -l` → **21 files**, breaking down per video as 61:2, 62:5, 63:2, 64:4, 65:1, 66:2, 67:1,
68:1, 69:1, 70:2 (= 21). All 21 pass both Part 72 gates (`validateProposedEntry` 20/20 fields,
`validateEvidenceSource`) in one final sweep just run across the whole batch. A full corpus + inbox
scan (main `knowledge/` plus every unmerged `inbox/*.json` from W03 through W07) found **187 files
carrying a `concept` field, 187 unique concepts, zero collisions**.

Three of the 21 files are **in-batch enrichments rather than fresh video-61-through-70 write-ups**:
`W07-67-low-field-of-view-reads-cinematic.json` was written for video 67 and enriched once (video
68's fuller numeric FOV range); `W07-68-lower-export-framerate-for-choppier-2d-style.json` was
written for video 68 and enriched once (video 70's much stronger restatement of the same 24fps
convention — flagged explicitly as the SAME creator restating the claim, not independent
corroboration); `W07-69-procedural-curve-modifiers-for-loop-and-noise.json` was written for video 69
and would have been enriched by video 70's stepped-interpolation content, but that turned out
specific and novel enough (a genuinely new failure mode: looping breaks the stepped look) to warrant
its own companion entry (`W07-70-stepped-interpolation-bulk-apply-via-curve-modifier.json`) instead,
cross-referencing both `W06-51` and the video-69 entry rather than merging into either.

**No capture candidates** across all ten videos — the run was entirely 2D hand-drawn tutorials,
professional-analysis commentary over existing footage, hobbyist production vlogs, and Blender/Moon
Animator screen recordings; nothing showed a real filmed person performing a clean, trackable motion
the way earlier batches occasionally found (W01, W04).

**No new `check:` lines queued** beyond what individual entries' own `detection_and_measurement_
methods` fields already specify inline — this batch's findings skewed toward either (a) directly
buildable today with existing measurements (the snappy-easeout/energy-transfer entry, the Yutapon-
cubes timing distinction, the breakdown-checklist measurement map) or (b) genuinely new capability
gaps rather than unwired measurements of existing data (multi-projectile evasion choreography, the
procedural curve-modifier and stepped-interpolation-modifier gaps) — nothing fell into the
"measurable today but not yet wired to a knowledge entry" shape that produces a fresh checks-queue
line the way earlier batches' findings often did.

**Nothing contradicted an existing card outright.** The closest to friction: this video 61's
`smear_construction_doubles_streak_or_combined` notes an unreconciled terminology/framing overlap
with W06-57's `multiples_vs_smear_for_differently_weighted_fast_motion` (same underlying mechanism,
described as combinable sub-techniques by one source and as an either/or weight-reading choice by
the other) — flagged for the merge session, not resolved here, per this programme's own discipline
for exactly this situation.

**The batch's own throughline**, found only by reading across all ten videos together: three
independent capability GAPS surfaced this batch that are squarely inside `ai/**`'s own pose/motion
scope rather than this programme's more common "out-of-scope rendering/2D-drawing concern" verdict —
multi-projectile evasion choreography (a genuinely new measurement category: multiple simultaneous
independent paths relative to one evading target), and TWO curve-authoring capabilities from the
Blender videos (procedural loop/noise modifiers, and a non-destructive bulk-appliable stepped-
interpolation layer that directly answers a gap `W06-51` already named). Also notable: this batch
found the single most direct, concrete, evidenced candidate yet for the master directive's still-
open starting-recipe question (§7.3) — video 70's reusable named-pose library, whose own category
taxonomy independently converges on the same anticipation/contact/follow-through phase vocabulary
`authorMotion` already uses internally. And twice this batch, Cadence's own real 3D viewport turned
out to already be AHEAD of the 2D source technique being learned from (scale-via-rotation-parallax,
cast-shadow-as-connective-tissue, both video 64) — worth remembering that not every finding in this
programme is a gap to fill; some are confirmation that a rigid 3D pipeline already does something a
2D pipeline has to work hard for.

Also caught and corrected in-session (video 66): drafted an entry with `category: "essential"`
before checking that all twelve existing essential-category entries are exactly the compiled
classical principles with zero exceptions across every prior batch — fixed to `"advanced"` to keep
that unbroken precedent, and flagged explicitly for the user/merge session as an unenforced
convention (the gate does not actually block a user entry from claiming "essential") worth deciding
whether to make a hard rule.

**W07 is NOT yet merged.** All ten videos are ticked above. This session ran the full ten in one
sitting (the user handed the session `W07.md`'s path directly with effort set to max, the same
pattern as W05) with a commit after each video or pair of videos, eight commits total, all pushed to
`origin/animation-intelligence` with no conflicts (this desktop's usual dirty `site/` WIP from
another concurrent session was stashed before each rebase and restored after each push, every time,
never staged or lost). **W08–W10 are still unwatched.**
