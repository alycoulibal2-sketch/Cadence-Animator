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

**The whole 100-video watch list is watched and merged as of 2026-09-12.** 271 entries sit in
`knowledge/` beside the twelve compiled classical principles, `knowledge/inbox/` is empty, and the
two queues below are the standing output: 81 checks and 9 capture candidates. Read the merge entry
for W03–W10 at the bottom before adding to either — it records one convention that broke at scale and
now needs the user's decision.

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
| 31 | `weight_shift_onset_frame_count` — frames from a travel action's first key to the first frame where `linear_velocity` departs meaningfully from near-zero, cross-referenced against whether the balance at that first key is already unsupported toward the travel direction | `sampleMotion` plus `ai/pose.js measurePose` (needs a declared support polygon) | video 21 @ 1:45–3:00 |
| 32 | `turn_deceleration_scales_with_implied_weight` — peak deceleration in the frames immediately before a declared direction-change marker, compared across items with a declared relative weight | `sampleMotion` + `ai/events.js` markers; needs a declared relative weight | video 22 @ 4:26–5:00 |
| 33 | `line_of_action_extremity_scope` — extend `fitLine`'s input points to the hand and foot effectors alongside the spine, and report whether the fitted line's dominant direction shifts once limbs are included | `ai/pose.js fitLine` — a scope change to a measurement that already exists | video 23 @ 2:53–3:07 |
| 34 | `silhouette_limb_separation_metric` — whether each limb's connected silhouette region touches the torso's or is separated by background pixels, as a negative-space readability proxy | `observationPasses.js`'s existing silhouette pass (outside `ai/`, so the raster crosses as pixels) | video 25 @ 5:28–7:56 |
| 35 | `foot_lock_duration_vs_declared_weight` — consecutive near-zero-drift frames immediately before a jump's launch key, compared across items with a declared relative size | `measureContactDrift` (MOT-008); needs a declared relative weight | video 26 @ 1:17–1:24 |
| 36 | `walk_vertical_peak_drop_alignment` — locate the local maximum in root/hip height across one step and confirm the following local minimum lands within tolerance of the declared Contact key | `sampleMotion` position series + the declared key | video 26 @ 2:50–2:57 |
| 37 | `figure_eight_path_shape` — project a tracked part's path onto the side-view plane over one cycle and test for a self-crossing; expected for hips in a walk and a foot in a run, not for a foot in a walk | `sampleMotion` position series | video 26 @ 3:54–4:04, 7:38–7:49 |
| 38 | `ground_contact_state_per_frame` — whether ANY declared foot effector is within contact tolerance at a frame, rather than how far it has drifted given an assumed contact. More basic than MOT-008, and the prerequisite for several other checks in this batch | new, but built entirely on data `measureContactDrift` already reads | video 26 @ 9:16–9:32 |
| 39 | `main_pose_vs_subevent_key_density_split` — split the keys inside a declared walk phase into a main-pose tier and a faster sub-event tier (a heel snap), rather than treating them as one undifferentiated series | `keyDensity`'s raw per-frame spacing | video 27 @ 5:15–5:27, 9:12–9:34 |
| 40 | `identical_repeat_cycle_detection` — compare per-step position/velocity samples across consecutive repeats of a loop; near-identical repeats flag the "looped and translated" failure, distinct from an intentional idle loop | `sampleMotion` | video 28 @ 1:14–1:25 |
| 41 | `arm_leg_frame_offset_personality_signal` — `analyseChain`'s lead/lag between an arm chain and the matching leg chain, read as a personality signal (leading reads powerful, lagging relaxed) at the 1–2 frame magnitudes demonstrated | `analyseChain` | video 28 @ 2:52–3:08 |
| 42 | `extreme_pose_hold_concentration` — key density and velocity near a cycle's position extrema against its transitional phases; holds should concentrate at the extrema for a pushed cycle | `keyDensity` + `sampleMotion` | video 29 @ 7:17–7:31, 13:27–13:52 |
| 43 | `contact_to_contact_frame_count_speed_correlation` — the contact-to-contact frame span as a direct proxy for a run's declared speed, with 6–8 frames as the baseline range this video's own examples fall in | key timestamps / `keyDensity` | video 30 @ 2:20–2:31 |
| 44 | `overshoot_recoil_opposite_sides` — classify each of the two post-action peaks as same-side or opposite-side relative to a declared settle value; a complete six-keypose sequence shows exactly one of each | `sampleMotion` position/rotation series | video 31 @ 0:37–1:15 |
| 45 | `breakdown_split_asymmetry_matches_bias` — each side's key density against how far the breakdown's declared `bias` sits from 0.5; flag a near-symmetric frame split under a far-from-midpoint bias, or the reverse | `keyDensity` + the breakdown's own declared bias | video 31 @ 9:27–10:11 |
| 46 | `chain_direction_reversal_lag` — flag a span where a declared root and a distal joint on the same chain have OPPOSITE velocity signs, rather than merely being offset in time | `analyseChain`'s per-joint series | video 32 @ 5:18–5:33 |
| 47 | `settle_variant_classification` — classify a joint's arrival as no-overshoot / soft-overshoot / hard-overshoot from the measured peak's distance past a declared settle value | `sampleMotion` position series | video 32 @ 0:31–1:11 |
| 48 | `proximal_distal_arrival_gap` — compare the frame each joint on a declared strike chain reaches its own peak; the proximal end (hip, torso) should peak measurably earlier than the fist | `analyseChain` onset/peak | video 34 @ 7:28–7:49 |
| 49 | `peak_velocity_frame_vs_contact_marker` — the distance between the frame of maximum `linear_velocity` for a striking effector and a declared contact marker; near-zero for a forceful strike | `sampleMotion` + `ai/events.js` markers, both already real | video 34 @ 9:17–10:39 |
| 50 | `connecting_frame_exposure_vs_neighbours` — a declared contact frame's own hold duration against its immediate neighbours'; flag a connecting frame held as long as or longer than them on a fast strike | `keyDensity` | video 36 @ 4:50–4:59 |
| 51 | `horizontal_velocity_continuity_at_apex` — at the frame where a root's vertical velocity crosses zero, confirm the horizontal velocity is non-zero and sign-consistent with its neighbours | `sampleMotion`'s per-axis series | video 37 @ 26:09–26:39 |
| 52 | `launch_foot_matches_travel_direction` — given a declared forward direction and two foot contacts, confirm the LATER-releasing foot is the leading one | `measureContactDrift` | video 37 @ 20:06–20:19 |
| 53 | `weapon_contact_drift_during_parent_overlap` — for an IK-held weapon effector declared in contact, confirm drift stays near zero across a span where the parent torso chain is itself in recoil or overlap | `measureContactDrift` (MOT-008) | video 37 @ 39:57–40:41 |
| 54 | `attack_pose_sharpness_at_contact_marker` — whether the pose held at a declared contact marker is a genuine extreme rather than a mid-interpolation frame | existing key/marker alignment data | video 39 @ 1:18–1:41 |
| 55 | `spring_damper_signature_detection` — classify a transition's acceleration/jerk curve as an exponentially decaying oscillation (a live spring) versus a monotonic ease (an authored Back ease that looks similar but is a fixed formula) | `sampleMotion`'s acceleration/jerk series | video 41 @ 7:53–8:53 |
| 56 | `ik_reach_coverage_sweep` — for a declared contact-variant range (a ledge shimmy's whole travel), report the reachable SUBSET against `reach_range_studs` rather than testing one point at a time | `ai/pose.js boneGeometry`/`solveTwoBone`'s already-computed `reach_range_studs` | video 41 @ 11:38–12:06 |
| 57 | `declared_contact_track_vs_measured_drift` — a hand-authored "planted" property track's 0/1 windows against `measureContactDrift`'s own measured contact windows on the same clip, flagging disagreement | `add_property_track`'s stored keys + MOT-008 | video 42 @ 25:34–26:19 |
| 58 | `deep_chain_attachment_risk_flag` — flag an `attach_item` target whose part sits more than N joints from the rig root as higher subframe-interpolation risk, for a held item expected to move independently | the rig's own joint graph, already walked by `buildChain` | video 43 @ 7:59–9:44 |
| 59 | `extreme_frame_outside_boundary_range` — flag an interior frame whose amplitude exceeds BOTH of the clip's play-range boundary frames by a wide margin, as a candidate smear transient. Informational, never a defect | `sampleMotion` + `get_play_range` | video 43 @ 26:39–27:35 |
| 60 | `subject_thirds_grid_placement` — project a declared subject's world position through a camera's `@origin`/`@fov` to screen space and report which thirds-grid cell it falls in, per frame | **blocked**: the projection step itself (SHOT-003/004, MOT-006). The world-space half is already available | video 45 @ 10:58–12:02 |
| 61 | `frame_tangent_detection` — flag a near-zero, non-overlapping gap between two items' projected screen extents as a candidate unintentional tangent | **blocked**: the same projection step, plus a silhouette (not centre-point) extension; `get_bounding_box` supplies the world-space half | video 45 @ 13:23–15:07 |
| 62 | `reach_correction_angle_asymmetry` — a declared reach/motion-warp correction's magnitude at different target angles against the expected angle-scaled falloff; flag a uniform, angle-independent correction | `sampleMotion` position data + a declared target angle | video 47 @ 27:55–28:26 |
| 63 | `translation_distance_outlier_vs_category` — flag a clip whose measured root-translation distance is an outlier against other clips of the same declared action type | `sampleMotion`, plus the cross-clip comparison `search_library` now makes possible | video 47 @ 33:32–34:17 |
| 64 | `root_velocity_vs_implied_leg_cycle_speed` — a root's measured `linear_velocity` against the travel speed the leg cycle's own phase implies; a mismatch is the idle-pop / cloth-glitch bug class this talk documents | `sampleMotion` + `analyseChain` — **two measurements this build already has, and no new capability at all** | video 48 @ 38:19–40:49 |
| 65 | `stepped_key_proportion_vs_declared_style` — the proportion of `Constant`/`None`-eased keys across a project's tracks against a declared anime / limited-animation style target | `ai/motion.js`'s existing per-track easing tally (the `stepped` counter) | video 51 @ 29:53–30:26 |
| 66 | `camera_track_stepped_mismatch_flag` — flag a project where the CAMERA's own keys are stepped at a materially higher rate while character tracks are also stepped; this source tested that exact combination and rejected it | the same easing tally applied to a camera item's tracks | video 51 @ 43:37–44:37 |
| 67 | `cross_context_amplitude_consistency` — extends #6 from phase-DURATION variance to per-phase velocity/acceleration AMPLITUDE variance across a project's clips, against each clip's own declared context | **blocked**: the same missing per-clip context declaration #6 needs, plus the cross-project comparison `search_library` now partly unblocks | video 54 @ 15:29–15:53 |
| 68 | `per_item_key_density_variance_by_declared_layer` — key density compared across different ITEMS in one project (a character against an effect against a camera), as a proxy for a deliberate per-layer frame-rate mismatch | `keyDensity`, contingent only on comparing across items rather than within one | video 55 @ 20:08–20:42 |
| 69 | `cross_clip_key_density_comparison_within_moveset` — key density compared across a project's clips within one declared moveset, as a proxy for deliberate strength-signalling frame removal | `keyDensity`, contingent on a declared "these clips are one moveset" grouping this build does not store | video 57 @ 5:07–5:56 |
| 70 | `vfx_intensity_delta_across_declared_states` — for two effect declarations on the same underlying clip across two declared game states, confirm a measurable intensity or duration difference between them | `ai/vfxspec.js validateTiming`'s existing envelope checks, contingent on a declared state-pair grouping | video 58 @ 2:47–3:14 |
| 71 | `smear_phase_spacing_contrast` — for a declared smear-structured action, the spacing of the smear phase against its neighbouring prep and slow-down phases; insufficient contrast is the weak-result problem this source describes fixing | `sampleMotion` | video 60 @ 3:16–3:33 |
| 72 | `declared_arc_shape_vs_measured_path` — a clip's measured path curvature against a declared intended arc shape (straight, C-curve, S-curve), flagging the "breaks out of the path" failure this video names | MOT-005 curvature, contingent on a declared-arc-shape field this build does not yet store | video 60 @ 3:59–4:53 |
| 73 | `stride_distance_between_named_contact_frames` — the plain world-space distance between a named contact effector's position at two specified frames (two successive foot plants in a cycle) | existing pose/track data, no new capability — the number a human eyeballs with a ghost marker is already stored | video 71 @ 12:36–13:00 |
| 74 | `sticky_contact_hold_duration_vs_momentum_baseline` — a trailing effector's contact-hold duration against what an unconstrained momentum decay alone would predict; a longer hold is the measurable signature of the "sticky material" read | **blocked**: needs a counterfactual momentum-only simulation to compare against, which this build does not have | video 85 @ 11:22–11:36 |
| 75 | `effect_decay_phase_presence` — whether a compiled effect's `timing.decay` sits at or near the clamped minimum (no real dissipation authored) rather than meaningfully present; the skipped-outro signature | `validate_effect_timing` already has every value this needs; it just does not look for this pattern | video 86 @ 1:01 |
| 76 | `effect_pair_timing_distinguishability` — when two compiled effects share a primitive, theme and colour pair, compare their `timing` envelopes and flag envelopes too similar to serve as the distinguishing signal | existing compiled effect data; nothing cross-references two VFX items' envelopes against each other yet | video 86 @ 17:44–18:59 |
| 77 | `dolly_zoom_size_invariant` — project a target part's screen-space size through the camera's `@fov` and its distance at each frame across a range where both are keyed in opposition; flag drift beyond a small tolerance as a broken dolly zoom | **blocked**: the active-camera/projection model (MOT-006) | video 87 @ 13:00–15:23 |
| 78 | `static_camera_against_concurrent_high_motion_subject` — a camera item's own near-zero `@origin`/`@fov` motion cross-referenced against a concurrently HIGH motion-intensity rig in the same shot: deliberate withholding versus authorial inattention | both halves are already measured separately by `sampleMotion`; only the cross-reference is new | video 87 @ 2:29–3:11 |
| 79 | `subject_background_world_space_separation` — the minimum world-space distance between a declared subject and declared background geometry; near-zero separation defeats depth of field regardless of aperture | ordinary position data, already in any project — **no camera or lens model needed**, the one framing rule in the camera videos that is unblocked today | video 88 @ 6:15–7:35 |
| 80 | `rotation_channel_discontinuity_flag` — an isolated single adjacent-sample delta on a rotation channel far larger than that channel's typical local delta, with no corresponding declared pose change. No numeric threshold is established — Blender's own filter is a structural fix, not a magnitude test | `sampleMotion`'s rotation series | video 91 @ 12:53–13:42 |
| 81 | `max_gap_between_consecutive_motion_extrema` — the longest span on one tracked channel (typically root vertical position) between two consecutive local extrema; flag a span implausibly long for the action's own duration | `sampleMotion`'s existing position/velocity sampling, no new capability required | video 100 @ 34:00–34:50 |

**Rows 31–81 arrived with the W03–W10 merge (2026-09-12).** 51 new lines, and the split that
matters for triage is not which are interesting but which are CHEAP: **37 are buildable today** from
measurements already in this build, 5 need a declaration the project does not store yet (a relative
weight, a moveset grouping, an arc shape, a per-clip context), and **9 are blocked on a named missing
capability** — of which four (#60, #61, #77, and thirds/leading-lines behind #79's siblings) are
blocked on the SAME world-to-screen projection step. That is the single highest-leverage gap the
whole watch track found: one capability, four checks.

The four strongest unblocked candidates, each needing no new capability at all:

- **#64 `root_velocity_vs_implied_leg_cycle_speed`** — `sampleMotion` against `analyseChain`, the
  idle-pop bug class God of War's own animators documented. The closest thing in the 51 to check #10.
- **#79 `subject_background_world_space_separation`** — ordinary 3D distance; the ONE camera-framing
  rule out of a whole batch of them that needs no projection model.
- **#73 `stride_distance_between_named_contact_frames`** — the number a Roblox animator eyeballs with
  a ghost marker is already stored as pose data.
- **#38 `ground_contact_state_per_frame`** — more basic than MOT-008 and a prerequisite for several
  other rows; MOT-008 already reads everything it needs.

**Check 10 is still next, and it is still the user's decision (2026-09-11).** Both halves already exist and
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
| a filmed weight-shift into a first step | video 21 @ 1:51–2:16 | James Baxter performing the two-way comparison on himself — shift without committing and nothing happens, commit without stepping and you fall. An isolated ~25s demonstration of locomotion onset gated by weight transfer, which would let a session measure real velocity and balance-onset numbers against a reference rather than against a description (W03) |
| a filmed standing vertical jump, and its landing | video 31 @ 8:26–8:33 and 11:28–11:34 | crouch → explosive extension with an arm swing → airborne, then what appears to be the same performer's deep knee-bend catch. Static camera, plain tiled courtyard, single performer — the most directly trackable footage in the whole hundred for Animation Capture → Body, and found only by a focused local re-extraction after the full-video pass's sparse sampling missed both motion peaks (W04) |

Nine candidates, and the queue is now closed as far as this watch list can take it: **only six of
the hundred videos yielded one at all** (2, 4, 6, 7, 21, 31). Seven of the ten batches were 2D
hand-drawn work, conference talks, or screen recordings with no filmed human performance anywhere —
a real property of a tutorial-heavy list, not a gap in how it was watched, and the reason §3D's
Mixamo half (which needs no video at all) is the realistic route to Part 59's ten categories. Of the
nine, the two filmed-human ones (videos 21 and 31) are the most directly trackable; the W01 seven are
mostly rendered game footage or 2D.

Ten clips would cover Part 59's categories. See §3D of `LEARNING_LOOP_PROMPT.md` for the Mixamo
half.

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

## 2026-09-12 — batches W03–W10 merged (videos 21–100; the watch list is finished)

**233 entries accepted, 0 refused, 0 collisions, 0 shadowing a compiled card** — merged batch by
batch (`--batch W03` … `--batch W10`) after every watch session had closed. The corpus is now **271
merged entries** beside the twelve compiled classical principles, 283 files in
`docs/animation-intelligence/knowledge/`, and `knowledge/inbox/` is empty. The checks queue went
from 30 to 81 lines and the capture queue from 7 to 9. Every one of the hundred videos is ticked in
`WATCHLIST.md` with its date, batch and entries.

**Two entries were refused by the gate on the first pass and fixed rather than dropped**, both W09
and both the same field: `speed_floor_epsilon_avoids_zero_value_clipping` and
`temporary_visible_proxy_for_authoring_invisible_facing` had `interactions: []`. Neither was a thin
entry — both answered the other nineteen fields fully — so the field was completed from
cross-references the entries' own `definition` and `cadence_representation` already stated (the
orientation-mode coupling that makes a zero Speed degenerate in the first place; `get_facing`
already answering the question the temporary light is a workaround for), and nothing empirical was
added. Recorded here because a fix is a judgement and deserves to be visible: the alternative was
losing two evidenced entries to one blank array.

**Everything else passed first time.** Before merging, all 233 files were run through both Part 72
gates plus three checks the merge tool cannot make on its own — every file parses, every concept is
unique across the inbox AND the existing corpus, and no concept shadows one of the twelve. 233/233
clean. That sweep is worth keeping as a merge step: W09 found a real bracket mismatch
(`style_variations` closed with `]`) only because its last session validated all 43 of its own files
programmatically instead of reasoning about the gate, and W10's session independently caught the same
file from outside and flagged it rather than touching another batch's work.

**Nothing in the whole hundred videos contradicted an existing card.** Eighty videos across
professional film animation, five studios' GDC talks, anime technique, Roblox tutorials,
cinematography and curve craft, and not one claim conflicted with a card already in the corpus. Two
things did happen that "contradiction" undersells, and both are in the per-batch notes below: cards
were caught STALE against capabilities that had shipped since they were written (W03), and several
videos SHARPENED a system's scope by naming a boundary condition it does not express (W06, W10).

**One convention broke at scale, and it needs a decision rather than a silent fix.** W07's session
noticed that `category: "essential"` had, across every batch to that point, meant exactly the twelve
compiled classical principles — and changed one of its own drafts from `essential` to `advanced` to
keep that unbroken, while flagging that the gate does not actually enforce it. W09 then wrote **25
entries with `category: "essential"`** (the whole VFX-timing and camera-vocabulary cluster: marker-
triggered emits, the particle budget, the intensity archetypes, the framing rules, the curve-slope
dictionary). They are all legitimate entries and `essential` is a legal category, so the gate let
every one through, and they are merged as written. The consequence is concrete, not cosmetic:
`listKnowledge({ category: 'essential' })` now returns **37** entries instead of the twelve classical
principles, so any caller that used that filter to mean "the canon" silently gets Roblox particle
budgets mixed into it. Two honest ways out, and the choice is the user's:

1. **Make the convention a rule** — `validateProposedEntry` refuses `essential` from a user entry,
   and those 25 are re-categorised (most read as `advanced`; a few VFX ones as `specialized`). Costs
   one gate change plus 25 one-field edits, and makes "essential" mean the canon forever.
2. **Drop the convention** — `essential` means "essential to its own domain", the twelve stay
   reachable as the compiled set (`listKnowledge({ includeUser: false })` already returns exactly
   them), and any caller wanting the canon is pointed at that instead.

Nothing here re-categorises another session's 25 entries on its own judgement; that is a content
decision, and the merge's job is to surface it with the number attached.

**Two pieces of friction were flagged by the sessions themselves and are left unresolved on purpose,
because resolving either means deciding whose framing wins:**

- `smear_construction_doubles_streak_or_combined` (W07, video 61) and
  `multiples_vs_smear_for_differently_weighted_fast_motion` (W06, video 57) describe the same
  underlying mechanism from two incompatible angles — one source treats multiples and streaks as
  combinable sub-techniques, the other as an either/or choice that reads the subject's weight. Both
  are merged as written, with the overlap stated. A building session that needs one answer should
  read both and pick, rather than a merge quietly collapsing them.
- The 35-degree-FOV "cinematic" convention is now corroborated four times (videos 67, 68, 71, 72) —
  but video 71's presenter says outright that he copied it from another tutorial. Four citations, not
  four independent derivations. `low_field_of_view_reads_cinematic` keeps its
  `evidence_status: experimental` for exactly this reason.

**Three videos are honestly incomplete, and a future session should know before assuming otherwise:**
video 37 (77:15) was read to roughly the 48-minute mark and ticked — re-open it at `--start 48:00`
rather than treating it as exhausted; video 24's auto-captions downloaded with HTTP 200 and were
incoherent word-salad, so it produced nothing and is worth a re-watch if a Whisper key is ever
configured; video 59 was the only video in the hundred watched entirely frames-only with no
transcript at all, and its single entry is scoped strictly to what 100 frames could support, with
every audio-dependent field marked unconfirmed.

**What changed in the code because of this merge: nothing, deliberately**, the same discipline every
batch held. What changed is the queue: 51 new checks, of which **37 are buildable today from
measurements this build already has**, and 9 are blocked on a named missing capability rather than on
nobody having tried. The strongest candidates are in the note above the checks table.

---

### W03 — videos 21–30, body mechanics: weight, balance, posing, locomotion (23 entries, 13 checks, 1 capture candidate)

**The throughline: weight transfer GATES locomotion onset.** A character does not begin to travel
because its legs start moving; it begins because its centre of gravity has already left its support
base, and the legs catch up. James Baxter demonstrates it on himself as a two-way comparison —
shift without committing and "nothing happens", commit without stepping and you fall immediately —
and the same mechanism turns up run in reverse in video 22, where arresting a heavy object's
momentum needs a foot placed under where the momentum is heading. `weight_transfer_gates_locomotion_onset`
is the entry; check #31 is the measurement, and it is the first check in this whole programme that
wants `measurePose`'s balance verdict and `sampleMotion`'s velocity in the same breath.

Locomotion is where this batch spends most of its evidence, and it is unusually specific: the
vertical drop in a walk is an ARRESTED FALL rather than a sine wave (#36), hips trace a figure eight
in a walk and feet trace one in a run (#37), the hip lift is driven by the SUPPORT leg rather than
the swing leg, ground contact is continuous except during a flight phase — and video 30 immediately
qualifies that last one, since stylised convention often omits the flight-phase pose entirely.
That qualifier lives in `flight_phase_pose_often_omitted_in_stylized_convention` and should be read
together with `continuous_ground_contact_except_during_flight_phase` from four videos earlier; they
are a pair, not two independent cards.

**The batch caught two of the twelve compiled cards being fixed underneath it, mid-session.** W02
had flagged `structural_understanding` and `appeal` as stale against `ai/pose.js measurePose`; a
concurrent learning-loop session fixed both in commit `fcd475f` while this batch was on videos
21–23. The lesson is narrower and more useful than "things change": a card snapshot taken at the top
of a long session goes out of date under you, so re-read any card you are about to call stale before
you commit the claim.

**And caption presence is not caption trustworthiness.** Video 24's captions returned HTTP 200 and
coherent-looking English that was actually nonsense from the first cue; video 29's transcript was
real but mostly hedged, in-progress thinking that needed filtering before any of it was evidence.
Neither failure looks like "no transcript", so both are easy to miss if a session trusts text because
it downloaded. The same instinct as `feedback_look_at_the_frame_before_trusting_its_time`, applied to
words.

### W04 — videos 31–40, jumps, idles, punches, sword combat, attack design (24 entries, 11 checks, 1 capture candidate)

**The throughline: a single named intermediate frame carries a disproportionate share of the signal —
and three unrelated videos use that same frame for three genuinely different jobs.** Video 31's
breakdown, placed in TIME by a physical event rather than at the arithmetic midpoint, redistributes
the ease split either side of it. Video 34's breakdown, defined by its POSE — torso and foot already
arrived while the fist still trails — is literally how a punch gets its power, reconfirmed twice more
in video 36 on a boxing wind-up and a taekwondo kick. Video 39's cancel frame decouples the player's
regained CONTROL from the animation's visual completion. Timing, power delivery, and control state:
three fields on one declared object. `ai/plan.js authorMotion`'s breakdown mechanism (a pose bias at
a declared time) already has the right shape for the first two; the third is gameplay logic this
batch is careful to say Cadence has no business enforcing.

**Reference-gathering now has three distinct, legitimate patterns on record rather than one** —
measured self-performance (`physical_reference_timing_method`, W01), blended multi-source inspiration
(`multi_source_reference_blend_not_measured`), and single-source gap-filling by anatomical inference
(`reference_gap_inference_from_anatomical_plausibility`). A session that builds the director's
reference loop should read all three as one family, because they imply different provenance claims:
only the first can be called measured.

**The idle/action blend seam is now covered from both ends, by two videos four apart that never cite
each other**: `idle_pose_as_blend_hub_constrains_extremity` (the idle pose itself must stay moderate,
because everything blends through it) and `action_end_pose_must_match_idle_for_automatic_blend` (an
action's FINAL pose must land near idle). Same engine-blend problem, opposite directions.

The strongest immediate case for building something is `weapon_ik_decoupled_from_torso_overlap`: it
names an existing measurement (`measureContactDrift`) that would catch exactly the failure it
describes, on a rig setup this corpus had not discussed before — check #53.

### W05 — videos 41–50, five studios' GDC talks (42 entries, 10 checks, no capture candidates)

**The throughline emerged only from reading across five studios and was named by none of them:
professional game animation routinely trades a physically correct result for a corrected-and-
DELIBERATELY-HIDDEN one, and this batch caught six structurally different mechanisms for making a
correction invisible rather than merely small.** `unexported_extreme_frame_smear_transient` and
`fixed_camera_licenses_invisible_pose_cheats` (Overwatch), `causally_motivated_pose_pop_conceals_discontinuity`
and `concurrent_driver_motion_camouflages_positional_snap` (The Last of Us), plus
`strike_assist_hit_reaction_camera_relative_correction` and `angle_scaled_reach_correction_for_lateral_targets`
(God of War). The shared move underneath all six is the same: borrow plausibility from something the
viewer is already looking at or already believes. A review pass asking "does this correction read as
intentional" should read these six together.

**This build's own `SHOT-003/004` gap stopped being an abstraction.** Videos 45, 46, 47, 48 and 49
each produced at least one entry that names it, and between them they now sketch a real first spec
for filling it: world-to-screen projection, projected silhouette/bounding-box comparison for tangent
detection, camera-relative motion correction, declared-operator-identity noise profiles, and
two-participant midpoint framing. Anyone scoping an active-camera model should read this cluster
before designing one from scratch — and W09 then raised the same gap independently from the
cinematography side, which is what makes it the most-evidenced missing capability in the programme.

**The most directly actionable finding in the batch** is `zero_joint_velocity_must_match_visual_locomotion_state`
(check #64): unlike most of this batch — which is blocked on capabilities Cadence structurally does
not have, because it is not a runtime — this one is checkable today with `sampleMotion`'s
`linear_velocity` and `analyseChain`'s leg-cycle phase, and no new capability at all.

**The honest caveat the batch attached to itself**: a meaningful fraction of its strongest material
is about game-engine-side RUNTIME behaviour Cadence cannot build without becoming a runtime. Several
entries are deliberately marked out of scope in their own `cadence_representation` rather than merely
unbuilt, and a building session should read that field before assuming a finding is actionable.

### W06 — videos 51–60, game-animation analysis and stylised action (27 entries, 8 checks, no capture candidates)

**The throughline: some findings are blocked on nobody having pointed an existing measurement at the
right question yet.** Two videos from unrelated domains each produced a mechanism this build already
ships — Guilty Gear Xrd's stepped-key workflow maps onto `Constant` easing and
`VARIATION_KINDS.stepped` (checks #65, #66), and video 60's whole smear-structure entry is fully
buildable today from `ai/motion.js`'s existing spacing measurements (#71). Neither needed a new
capability. That is a different category from "blocked", and worth separating when triaging the
queue, because it is the cheap half.

**Three videos produced fresh, build-specific evidence about Cadence's OWN Part 14 quality
hierarchy** — two boundary conditions its current ordering does not express:
`indiscriminate_technique_application_is_overanimation_not_style` (over-animation as technique
applied without discrimination, regardless of competing defects) and
`effects_as_primary_readability_channel_for_small_fast_characters` (effects promoted from supporting
to primary when the character is too small and fast to read on its own). Reading a video against this
build's actual source, rather than only against the general animation corpus, keeps finding real gaps
instead of restating known principles — and W10 later made that its whole method.

**Video 59 is the only video in the hundred watched entirely frames-only.** No captions existed and
no Whisper key is configured (a prior setup decision this session correctly did not re-litigate
mid-batch). Rather than skip it or narrate over it, the single entry written from it is scoped
strictly to what 100 sampled frames support, with every audio-dependent field marked unconfirmed. A
Whisper-enabled re-watch, or a focused `--start/--end` pass on the clips it timestamped, would get
the timing claims this session could not responsibly claim.

### W07 — videos 61–70, anime technique and Blender/Roblox workflow (21 entries, no new checks, no capture candidates)

**The throughline: three capability gaps that sit squarely inside `ai/**`'s own pose and motion scope**,
rather than this programme's more usual "out-of-scope 2D or rendering concern" verdict — multi-
projectile evasion choreography (a genuinely new measurement category: many simultaneous independent
paths relative to one evading target), and two curve-authoring capabilities from the Blender videos
(procedural loop/noise modifiers, and a non-destructive bulk-appliable stepped-interpolation layer,
which directly answers a gap W06's Guilty Gear entry had already named).

**It also found the most concrete candidate yet for the master directive's still-open starting-recipe
question.** Video 70's reusable named-pose library organises its poses by a taxonomy that
independently converges on the same anticipation / contact / follow-through phase vocabulary
`authorMotion` already uses internally — evidence, from outside this project, that the phase
vocabulary is the natural unit a real animator assembles from.

**Twice, Cadence's real 3D viewport turned out to be AHEAD of the 2D technique being learned from**:
scale-via-rotation-parallax and cast-shadow-as-connective-tissue (both video 64) are things a 2D
pipeline works hard to fake and a rigid 3D pipeline gets for free. Not every finding in this
programme is a gap to fill; some are confirmation that the pipeline already does something.

No new checks, and the reason is specific rather than a shortfall: this batch's findings fell either
into "directly buildable today with an existing measurement" (already stated inline in each entry's
`detection_and_measurement_methods`) or into genuinely new capability gaps — neither of which is the
"measurable today but unwired" shape that produces a checks-queue line.

### W08 — videos 71–80, Roblox and Moon Animator, hands-on (17 entries, 1 check, no capture candidates)

**The throughline: Roblox-native, hands-on content answered open questions this programme was already
carrying, with code-checkable specifics rather than new abstractions.** W05's
`weapon_attach_under_root_avoids_subframe_chain_desync` had left open whether an authoring-time attach
offset survives into a runtime result; video 79's `authoring_time_weld_and_runtime_grip_are_independent_systems`
answers it with real evidence — in the vanilla Roblox pipeline it does NOT, unless something
deliberately carries it across. Three `export_to_studio`/`attach_item` questions are now concrete
enough to settle by reading code instead of speculating: does `attach_item` preserve a hand-placed
offset, does `export_to_studio` set an Animation Priority, and does it derive a Roblox Grip from
`attach_item`'s own offset.

**Twice, a video's technique mapped onto a gap between Cadence's TWO existing systems rather than a
missing capability** — the face entry (a static `faceLayers` list against a keyable `Decal.Texture`
property track) and the VFX entry (VFXSpec's single-emitter scope against the PNX engine's
already-existing multi-layer and flipbook support). In both cases the right tool already exists in
this build; it is just not the one the simpler path reaches for by default. That is a product
observation, not a knowledge gap, and it is the kind this section of the list was always most likely
to produce.

**One corroboration turned out not to be independent.** The 35-degree-FOV convention had been
confirmed four times across videos 67, 68, 71 and 72 — and video 71's presenter says outright that he
took it from another tutorial. Four citations of one claim is not four derivations of it.

### W09 — videos 81–90, Roblox VFX and cutscenes, VFX timing, camera vocabulary (43 entries, 6 checks, no capture candidates)

**The throughline, across six entries in three unrelated videos: naive linear or uniform
interpolation is specifically untrustworthy for anything that is really ENERGY OR PHASE moving
through a system, rather than one thing moving as a whole.** Phase-offset dual emitters for a
persistent glow (video 82), traveling energy as a phase offset rather than a midpoint interpolation
in hand-drawn FX (video 85), four archetype intensity curves where the explosion's is inverse to its
size (video 86), and a general curve-slope-as-velocity dictionary (video 90) are four independent
angles on one idea — from Roblox particle systems, 2D liquid animation, a real-time VFX course and a
Blender graph-editor tutorial respectively. It also echoes CLAUDE.md's own breakdown-bias rule, which
exists because the arithmetic midpoint is the wrong default there too. A building session should read
all four together.

**The second structural finding, five entries across two videos: an active-camera/projection model
(MOT-006) is the single highest-leverage capability gap this whole watch track has surfaced.** The
dolly-zoom invariant, thirds-grid placement, leading-lines convergence and looking-room balance are
all blocked on the same missing world-to-screen projection step — four checks unlocked by one
capability. Exactly one camera-framing finding in the batch is unblocked today:
`subject_background_world_space_separation` (check #79), because it depends on ordinary 3D distance
rather than a projection. Keep that gap separate from the SECOND camera gap video 89 found — no
decoupled path/progress/aim channels and no constraint-influence system — which a projection model
would not fix.

**And W09 is where a gate stopped being a thing to reason about and became a thing to run.** Its
final session validated all 43 of its own files programmatically before the closing commit and found
a real bracket mismatch (`style_variations` closed with `]` instead of `}`) that per-entry review had
missed in that batch and in every batch before it. W10's session, sweeping the whole corpus from
outside, found the same file independently and flagged it for W09 rather than touching another
batch's work. Both halves of that are the behaviour to keep: validate your own files mechanically,
and report someone else's rather than fixing it under them.

### W10 — videos 91–100, curves, FK/IK, workflow, critique and reference (36 entries, 2 checks, no capture candidates)

**The throughline: this was the first batch to spend real time cross-checking its findings against
Cadence's OWN source code rather than only against the knowledge corpus — and it went both ways about
as often as not.** Confirmed gaps, read rather than assumed: no animation layers at all (three
separate entries say so explicitly), `joint_limits: null` on every joint so no forearm-twist-style
DOF constraint can be expressed, no local-extrema/turning-point detector in `ai/motion.js` (which is
what check #81 would add), and the `polish_animation` workflow's own honest `implemented: false`.

**Confirmed STRENGTHS, found the same way, and this is the half a gap-hunting pass would have
missed.** `set_track_space`/`setUnparented` already perform a lossless, pop-free space switch that a
whole other tool (3ds Max CAT, video 93) needs a manual align-before-switch step to fake.
`ai/certainty.js`'s ranked levels plus `ai/review.js`'s `sortFindings`/`certaintyRank` already
implement, as real sorted data, exactly the certain-fixes-first feedback discipline a Disney-trained
reviewer describes doing by hand (video 98). And `ai/reference.js`'s `emulate`/`not_copied` fields
turned out to be a pre-existing, exact match for the acting-versus-mechanics reference-usage
distinction that three different reference-focused videos (94, 99, 100) converged on independently —
a field pair written for one reason that answers a question three professionals frame the same way.

Two checks queued, both unblocked and both about the same missing primitive from opposite ends:
`rotation_channel_discontinuity_flag` (#80) wants an isolated outlier delta on a rotation channel,
and `max_gap_between_consecutive_motion_extrema` (#81) wants the longest span between two consecutive
turning points. Neither needs a new capability; both need `sampleMotion`'s series read for shape
rather than for magnitude.
