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
| 16 | `spacing_subdivision_signature` — classify the velocity curve between two keys as halves-, thirds- or favors-shaped. Descriptive, never pass/fail | `sampleMotion` | video 11 @ 6:59–8:01 |
| 17 | `dps_floor_vs_action_duration` — key density against the action's own frame count; flag a pose count below what its speed plausibly needs to read | `keyDensity` | video 11 @ 4:14–4:39 |
| 18 | `obscure_arc_vs_main_arc_divergence` — curvature of a declared secondary tracked part against the main one during a turn. Divergence is EXPECTED and healthy, not a defect | MOT-005 curvature | video 12 @ 8:36–9:18 |
| 19 | `float_signature_detection` — a velocity curve with two distinct low-speed regions rather than one smooth decay to zero | `sampleMotion` | video 12 @ 3:41–4:28 |
| 20 | `value_change_visibility_gap_coverage` — a property track's discontinuous change lands entirely inside a hidden span on a visibility/transparency track | property tracks | video 12 @ 5:09–5:12 |
| 21 | `drag_overlap_followthrough_staging` — segment a chain lead/lag curve into three regions (low relative motion / catching up / post-primary continuation) and confirm all three exist rather than one flat offset | `analyseChain` | video 14 @ 2:08–4:04 |
| 22 | `secondary_delay_chain_depth_gradient` — each joint's lag against its chain depth; flag a lag that does not increase monotonically with depth | `analyseChain` | video 16 @ 6:23–8:03 |
| 23 | `hip_balance_vs_limb_extension` — the declared support polygon's balance verdict against hip rotation at frames where an effector is furthest from the centreline | `ai/pose.js measurePose` (MOT-011) | video 17 @ 20:31–20:48 |
| 24 | `hip_weight_split_asymmetry` — flag a support pose sitting at or near an even 50/50 weight split | **blocked**: needs a per-leg weight-bearing declaration that does not exist | video 18 @ 2:59–3:32 |
| 25 | `spine_curve_contrast_at_extremes` — spine-chain curvature at each extreme of an impact-recovery beat; flag two extremes with near-identical shape | MOT-005's chord deviation, applied along the spine chain | video 18 @ 4:59–5:34 |
| 26 | `lead_joint_matches_declared_intent` — which joint's onset is earliest, against a declared intended lead. A mismatch is worth a look, never an automatic error | `analyseChain` | video 18 @ 7:04–7:49 |
| 27 | `weight_strength_beat_sequence` — a near-zero-velocity struggle stretch must precede any declared powerful lift or throw, and the release itself must span few frames | `sampleMotion` | video 19 @ 1:49–8:33 |
| 28 | `held_prop_drag_frame_count` — a held prop's lag read straight off the chain and reported as a literal weight indicator, not only a lead/lag curiosity | `analyseChain` | video 19 @ 5:52–6:28 |
| 29 | `rigid_unit_motion_flag` — a declared body-plus-prop system with near-zero lag between parts across a whole action, at any speed. The differential-timing anti-pattern, named directly | `analyseChain` | video 20 @ 0:27–1:04 |
| 30 | `drag_amount_vs_declared_leverage` — measured drag against an expectation scaled by declared lever-arm distance, not weight alone | **blocked**: needs a per-item mass-distribution declaration | video 20 @ 3:54–4:11 |

**Check 10 is next, and it is the user's decision (2026-09-11).** Both halves already exist and
are measured, so it is a join rather than a new measurement, and an eased-in key on a frame
carrying a declared impact marker is a defect `review_shot` can report with `certain` certainty —
the evidence is the marker and the key's own easing style, both already in project data. Build it
BEFORE Slice F. It is also the first test of whether this whole loop pays for itself: a technique
seen in a video on Monday becoming a check the product runs on Wednesday, with the video timestamp
still attached as its evidence.

When it lands, wire it to its knowledge entry: `external_force_easing_override` in
`knowledge/external_force_easing_override.json` gets the `measurement_keys` that back it, and
`review_shot`'s `knowledge_checks` picks it up with no further work.

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

## 2026-09-11 — batch W02 merged (videos 11–20, fundamentals into body mechanics)

**19 entries accepted, 0 refused, 0 collisions**, merged the same day, minutes after the batch
finished. The corpus is now **50 entries**: 12 compiled classical principles + 19 from W01 + 19
from W02. **No capture candidates at all** — every video in this batch was 2D hand-drawn or a
screen recording, with no performed 3D motion to track. That is a real result for the capture
queue, not a gap: two-thirds of a tutorial-heavy watch list will produce no reference clips, and
the seven from W01 remain the whole queue.

The nineteen: `dps_floor_for_short_actions`, `spacing_subdivision_method_ladder` (v11);
`discontinuity_concealment_via_visibility_gap`, `float_to_stop_settle`, `obscure_arcs` (v12);
`onion_skin_arc_verification` (v13); `drag_overlap_follow_through_sequence`,
`drag_stretch_coupling` (v14); `staged_keyframe_then_straight_ahead_workflow` (v15);
`chain_depth_proportional_secondary_delay`, `shared_mechanism_anticipation_overshoot` (v16);
`hip_rotation_balance_correction` (v17); `combined_hip_weight_bearing_posing`,
`deliberate_lead_choice_for_acting`, `spine_curve_letter_shapes` (v18);
`held_object_drag_frame_count`, `weight_then_strength_formula` (v19);
`differential_timing_not_uniform_slowness`, `lever_arm_dependent_drag` (v20).

**What this batch is really about, and it is one thing: the chain.** Nine of the nineteen are
about how a trailing part relates to the part that leads it, from five independent directions —
delay proportional to chain depth (v16), drag coupled to stretch (v14), drag proportional to the
lever arm rather than to weight (v20), a prop's lag read as a literal weight reading (v19), and a
deliberately CHOSEN lead that is not the root (v18). `ai/motion.js analyseChain` already measures
lead and lag and refuses to call an inversion wrong; what none of these can use yet is the single
fixed-root assumption underneath it. **That is the structural note for whoever builds next**: a
declared lead joint, and a lag expectation that scales with depth and leverage, would turn eight
of these checks from "derivable" into "written".

Hip-as-balance-lever appears three times from independent angles (v17 corrective rotation against
an extended limb, v18 as a default weight-bearing posing choice, v20 the same counterbalance on
the head) and the batch deliberately did not collapse them, because each names a separately
useful facet. Two of the new checks (#24, #30) are **blocked on a declaration that does not
exist** — per-leg weight bearing, and per-item mass distribution — and are queued as blocked
rather than as derivable, which is the distinction that keeps the queue honest.

## 2026-09-11 — the loop caught its first stale card

Not from a video: from the W02 session READING the twelve compiled cards against what the code
now does. `structural_understanding` said "pose balance: none — part mass is unknown, so a
centre-of-mass computation cannot be built honestly" and `appeal` said "there is no line-of-action
measurement". Both predate `ai/pose.js measurePose` (Slice A, the same day), which computes a
least-squares line of action through the spine parts, a part-VOLUME-proxy centre of mass, and
balance against a DECLARED support polygon. Both cards are corrected, with the two caveats that
travel with those numbers kept attached: the mass is a proxy because Cadence stores no density,
and with no declared support `balance.supported` is null rather than a verdict.

Neither is wired into `knowledgeChecks`, and the reason is now written down instead of implied:
that function maps a concept onto `ai/motion.js MEASUREMENTS` keys and is handed a
`sampleMotion` result, which carries neither a posed frame nor a declared support polygon. A
pose measurement needs both. That is a wiring gap with a known shape — worth doing when something
needs it, and dishonest to describe as a missing capability.

**This is the stale-blocker class the Phase 4 review pass named, in the knowledge cards rather
than in the code**, and it will happen again every time a capability ships. A watch session
reading the cards against the build is a cheap way to catch it, and is worth repeating.

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
