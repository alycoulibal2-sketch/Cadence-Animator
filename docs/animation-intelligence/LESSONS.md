# LESSONS — what Cadence has learned, and where it went

**Read this before starting any animation-intelligence work.** It is the running record of what
the watch batches taught, what the building sessions changed because of it, and what is queued.
`SHARED_TASK_NOTES.md` says what the CODE does; this says what the SYSTEM knows.

Two things live here and nowhere else:

- the **checks queue** — measurements a video showed are worth making that this build does not yet
  make. A building session picks from this list.
- the **capture queue** — motions worth having as reference clips, with the exact video timestamps.
  Each needs the USER to run Roblox Studio's Animation Capture; a session cannot.

Everything else is a dated paragraph, newest batch last.

---

## The checks queue — measurements worth building

Each line is a real, buildable measurement with its evidence. None is implemented. A `measurement`
that lands in `ai/motion.js MEASUREMENTS` should be wired to its knowledge entry's
`measurement_keys` in the same commit, which is what makes it show up in `review_shot`.

| # | Check | Derivable from | Evidence |
| --- | --- | --- | --- |
| 1 | `twinning_avoidance` — angular difference between each declared mirror joint pair at a sampled frame; flag a small difference across several pairs at once on a held, non-locomotion pose | the FK solve `ai/motion.js` already runs, plus `ai/riggraph.js`'s mirror pairing | video 1 @ 21:19–21:37 |
| 2 | `layered_anticipation_present` — count of distinct direction-reversal sub-phases before an action's main onset; ≥2 expected only for a declared heavy/finisher | per-joint velocity sign changes from `sampleMotion` | video 1 @ 3:47–4:13 |
| 3 | `pose_hold_density_matches_style` — average frames per distinct key pose within a phase | existing track key timestamps | video 1 @ 16:11–18:20 |
| 4 | `readable_hold_duration` — how long a key story-beat pose is held with no significant motion before the next phase | existing phase/marker timing | video 1 @ 5:31–5:48 |
| 5 | `startup_frame_budget_by_genre` — frames from an action's first key to its declared contact/impact marker, at a stated reference frame rate | existing key + marker timestamps | video 2 @ 7:14–8:24 |
| 6 | `global_timing_register_consistency` — variance of phase duration / startup frame count across a project's animations | needs the cross-project library to compare across shots — **this one is now partly unblocked** (`search_library` can find the sibling clips; the variance itself is unbuilt) | video 2 @ 5:32–6:59 |
| 7 | `recovery_duration_vs_startup_duration` — the ratio, for a player-controlled action | existing markers | video 3 @ 5:16–5:44 |
| 8 | `anticipation_pose_recognizability_at_snap` — whether a single held frame at an action's start matches a declared wind-up pose shape | **blocked**: needs a pose-similarity measure this build does not have (`ai/pose.js measurePose` measures a pose, it does not compare two) | video 3 @ 5:57–6:07 |
| 9 | `pose_based_squash_stretch_present_on_launch` — whether a jump/launch phase shows a compress-then-extend rotation pattern at all, at any amplitude | rotation over the phase, from `sampleMotion` | video 4 @ 5:24–5:46 |
| 10 | `external_force_easing_mismatch` — cross-reference a contact/impact marker against the easing style on the key at that same time; flag an eased-in key on an impact | `ai/events.js` markers + the keys themselves (`interpolation_type` is already measured) | video 5 @ 4:26–4:58 |
| 11 | `single_axis_attack_flag` — whether a declared attack's effector path stays close to one world axis for most of its duration | MOT-005 curvature / chord deviation, already measured as `bow_studs` | video 6 @ 4:19–4:39 |
| 12 | `backfill_hold_duration_vs_action_speed` — a follow-through hold's duration relative to the preceding action's | existing phase/marker timing | video 7 @ 13:59–14:17 |
| 13 | `spacing_curve_asymmetry` — the shape of the velocity/acceleration curve either side of a phase's midpoint; a large deliberate asymmetry is a signal, not a defect | `sampleMotion` | video 8 @ 3:55–7:09 |
| 14 | `multi_segment_pacing_signature` — local extrema in a phase's velocity curve; more than one means mixed hold pacing rather than a single ease | `sampleMotion` | video 8 @ 8:41–10:12 |
| 15 | `bounce_decay_rate_matches_declared_material` — successive bounce-height ratio across a decay sequence | position keys | video 10 @ 2:19–3:08 |

**Check 10 is the cheapest and most valuable**: both halves already exist and are measured, so it
is a join rather than a new measurement, and an eased-in key on a declared impact is a defect
`review_shot` could report with `certain` certainty today.

## The capture queue — motions worth having as reference clips

Each needs the user, once, in Roblox Studio: **Animation Editor → Capture → Body → the video →
save**, which writes a KeyframeSequence into the rig's `AnimSaves`. Then a session runs
`import_from_studio` and `add_to_library` with provenance `captured`, `estimated: true`, the source
URL and these timestamps. A captured clip is a pose ESTIMATE and stays labelled one.

| Motion | Source | Why it is worth having |
| --- | --- | --- |
| a readable heavy attack with telegraph and recovery | video 2 @ 8:09–8:24 | a longsword swing with a long, clearly-read wind-up and a long recovery — the "tactical/punishable" heavy attack reference |
| a near-instant competitive hit | video 2 @ 7:14–7:25 | a fast normal connecting in ~3 frames at 60fps with almost no wind-up — the fighting-game-style fast attack reference |
| a slow full-body weighted walk | video 2 @ 5:44–6:05 | a huge creature's unhurried full-body shift — the "heavy/majestic" locomotion reference |
| pose-based compress-then-extend on a jump launch | video 4 @ 5:24–5:46 | Anthem's javelin: crouch then sharp extend, with no mesh deformation at all — directly capturable, since nothing about it depends on the rig deforming |
| a full-body run-cycle squash/stretch rhythm | video 4 @ 5:55–6:08 | Jak's torso compressing each stride — capturable for the RHYTHM only; the source uses real mesh deformation Cadence's rigid rig cannot reproduce |
| a direct-thrust vs wide-swipe attack pair | video 6 @ 4:27–4:52 | the same design intent executed two ways — the reference pair for camera-angle robustness |
| a proper stop with offset-timing follow-through | video 7 @ 11:08–11:35 | Spiritfarer's Stella: foot plants, weight leans back, torso straightens, arms drift into place last — the "responsive but not robotic" stop |

Ten of these would cover Part 59's categories. See §3D of `LEARNING_LOOP_PROMPT.md` for the Mixamo
half, which needs no video at all.

---

## 2026-09-11 — batch W01 merged (videos 1–10, the twelve principles)

**19 entries accepted, 0 refused, 0 collisions.** Every one passed both Part 72 gates
(`validateProposedEntry` for shape, `validateEvidenceSource` for a named source) and every one
cites a video URL *and* a timestamp. They now live in `docs/animation-intelligence/knowledge/`
beside the twelve compiled classical principles, ship with the app, and load into every session
through `registerUserEntries`. `review_shot` counted 32 knowledge entries in the smoketest run
that followed the merge — 12 compiled + 19 merged + 1 the test wrote itself.

The nineteen: `layered_anticipation`, `pose_hold_density`, `twinning` (v1); `startup_frame_budget`,
`global_timing_register` (v2); `recovery_weight_substitution`, `implied_zero_frame_anticipation`
(v3); `motion_smear_readability` (v4); `external_force_easing_override` (v5);
`arc_camera_angle_robustness`, `arc_trail_vfx_readability`, `cross_clip_arc_continuity` (v6);
`follow_through_backfill_hold`, `physics_sim_blend_seam_mitigation` (v7);
`asymmetric_spacing_preference`, `mixed_hold_pacing_within_phase` (v8);
`physical_reference_timing_method`, `vibe_timing_anti_pattern` (v9);
`material_properties_via_spacing_alone` (v10).

**Nothing contradicted an existing card, in any of the ten videos** — and that is the result worth
recording, not a null one. The twelve compiled principles were written from the directive text
alone; ten independent, cross-genre professional sources confirmed every relevant one, several
with evidence the cards did not have (exact frame counts, named shipped games, archival footage).
Two confirmations were near-verbatim: video 2 restated `INTERACTION_GRAPH`'s own timing-versus-
spacing note, and video 3 restated `anticipation`'s `style_variations.game_combat` line about
compressing anticipation toward pose to protect responsiveness.

**The one structural thing the batch found**, and the reason four of the entries cross-reference
each other: there is a *ladder* of what to do when an action has no time for anticipation, and no
single card held it. `layered_anticipation` → `startup_frame_budget` →
`recovery_weight_substitution` / `implied_zero_frame_anticipation` → `follow_through_backfill_hold`
runs from "spend frames before the action" to "spend them after it instead", and the choice is
driven by a genre's startup budget. Any future planner that segments an attack should read those
four together.

**Also cross-linked:** `cross_clip_arc_continuity` (v6) is resolved, for loosely-attached elements,
by `physics_sim_blend_seam_mitigation` (v7). `motion_smear_readability` (v4) and
`arc_trail_vfx_readability` (v6) are siblings — the same fast-motion readability problem solved by
mesh deformation (which Cadence lacks) or by a VFX trail (which Cadence has, `ai/vfxspec.js`).
`pose_hold_density` (v1) is refined by `mixed_hold_pacing_within_phase` (v8).

**What changed in the code because of it:** nothing yet, deliberately — the batch produced
knowledge and a queue, and `check: external_force_easing_mismatch` (#10 above) is the one a
building session should take first. What DID change is that entries like these can now exist at
all: before this session the twelve were hard-coded and there was nowhere for a nineteen-entry
batch to go.

## 2026-09-11 — the learning loop shipped (the store these entries needed)

Built in the same session as the merge above, because the merge had nowhere to merge INTO.

- **`renderer/js/ai/library.js`** — Part 70's cross-project motion library. An entry carries all
  sixteen Part 70 fields plus a Part 36 profile, an action type and the numeric characteristics
  search subtracts. Searched by action, tags, rig compatibility, provenance kind and measured
  distance. The folder is the app's user-data directory, never the repo and never a project file.
- **Knowledge on disk** — `registerUserEntries` behind both Part 72 gates, the twelve exported to
  `knowledge/*.json` as the seed, `propose_knowledge_entry` to write a new one, and
  `knowledgeChecks` wired into `review_shot` so a merged entry that names a real `ai/motion.js`
  measurement becomes a check the review runs.
- **Seven MCP tools**, both halves: `import_from_studio`, `import_animation_file`,
  `add_to_library`, `search_library`, `load_from_library`, `accept_shot`,
  `propose_knowledge_entry`.

**Two things the work itself taught, both now pinned by a test:**

1. **Two entries profiled from the same motion measure exactly equidistant** — and if one of them
   was built for a different rig, "the nearest thing we have" came back as a clip that cannot be
   used. Found by the `library_search` benchmark, not by reading the code: the retrieval check
   failed on one of four queries, and the tie-break (the id) was silently deciding. `nearest()`
   now takes a `rig` filter and reports `tied_for_first` rather than hiding a tie.
2. **A named event marker crashed the timeline's marker lane.** `themeVar` was a `const` inside
   `draw()` and `drawMarkerLane()` is a sibling function that called it, so painting a marker
   LABEL threw `ReferenceError` mid-frame. Pre-existing, in `renderer/js/timeline.js` since the
   rig-rendering commit; surfaced by the new smoketest step, which is the first to put a named
   marker on a rig the timeline then draws. Hoisted to module scope.
