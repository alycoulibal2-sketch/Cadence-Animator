# W10 notes — videos 91–100 (F. VFX, camera and curves · G. Workflow, reference and critique)

- [x] 91. How to use Blender's Graph Editor like a Professional Animator — BrianKouhi (15:53)
- [x] 92. Animating ARMS (FK vs. IK) - Doodley — Doodley (11:28)
- [x] 93. FK and IK Explained - Which One to Use and When? — Miloš Černý Animation (7:47)
- [x] 94. The Ultimate Animation Workflow for Beginners — Chester Sampson (12:59)
- [x] 95. Animation Power Tips - When to go from BLOCKING to SPLINE — Harvey Newman (20:24)
- [x] 96. Why Your Stepped Animation Sucks in Spline — Sir Wade Neistadt (8:59)
- [x] 97. Tips for Polishing Animation from a Disney Animator — Sir Wade Neistadt (22:09)
- [x] 98. Animation Critique: How To Instantly Improve Your Blender Animation With Easy Tricks — CG Cookie (35:55)
- [x] 99. How to use video reference for Animation — Chester Sampson (11:40)
- [x] 100. The COMPLETE Guide to Reference for Feature Animation — owenferny (38:06)

---

## Video 91 — How to use Blender's Graph Editor like a Professional Animator — BrianKouhi (15:53)
https://youtu.be/vKgO3NsYORo — watched 2026-09-12, `balanced` detail, full-video pass got 38 frames
(scene-aware) but left an 11-minute BLIND SPOT (04:07→15:18, one continuous screen recording with no
detected scene cuts) covering exactly the densest curve-editing content, so a second, focused pass was
run on the already-downloaded local file (`--start 6:59 --end 13:44`, 17 uniform frames, no
re-download) per the pattern the W04 batch established for exactly this situation. Captions transcript
(397 segments, full-video pass only — the local-file focused pass has no captions attached, so its
frames are read against the full-video pass's transcript by timestamp). Four entries written.

**`normalized_curve_view_for_cross_channel_comparison`** — Blender's graph-editor 'Normalize' toggle
force-fits every visible curve to the same +-1 range regardless of native unit (studs vs degrees vs a
bare scale factor), trading absolute readability for the ability to compare several channels' relative
shape at a glance (@ 2:57–3:31, confirmed in this session's own frames at t=03:38–04:07 showing the
resulting multi-colour overlay). Cadence has no per-channel curve-graph view for pose tracks at all
today, so this is recorded as a technique with no current home rather than a gap — worth remembering
if a curve view is ever built on the VFX side (`vfx_get_curve`/`vfx_set_curve` already exist).

**`named_easing_curve_family_vocabulary`** — the single best find in this video, and FRAME-only
evidence the transcript alone would have missed entirely: Blender's 'Set Keyframe Interpolation' menu
(frame at t=08:10, from the focused re-extraction) names the full Penner easing taxonomy directly on
screen — Sinusoidal/Quadratic/Cubic/Quartic/Quintic/Exponential/Circular as an easing-strength ladder,
plus Back/Bounce/Elastic as named overshoot/oscillation effects — while the transcript at that same
span only says 'constant, linear, and basier... basier is essentially spine'. Cadence's own
`ai/plan.js` overshoot step is already a Back-easing formula (CLAUDE.md's own words) — this is the
first evidence this project's one borrowed curve is part of a standard, cross-tool, cross-engine
naming convention (Roblox's own `TweenService` EasingStyle enum is the exact same family end to end)
rather than a bespoke choice, which I did not expect going in.

**`stepped_modifier_vs_constant_key_interpolation_distinct_mechanisms`** — confirms, from a THIRD
independent source, capability gaps two other still-unmerged batches already flagged
(`stepped_keyframes_replace_interpolation_for_2d_read` from W06; `procedural_curve_modifiers_for_loop_
and_noise` / a stepped-interpolation bulk-apply from W07) but is the first of the three to show the
per-key Constant-interpolation mechanism (frame t=08:20, a literal square wave) and the non-destructive
Stepped-Interpolation MODIFIER (frame t=12:03, in the 'Add Modifier' menu next to Noise/Cycles/
Envelope/Limits) side by side as two genuinely different mechanisms, not one.

**`euler_discontinuity_filter_unwraps_rotation_jumps`** — Blender's 'Discontinuity (Euler) Filter'
(frame t=13:04, its own on-screen tooltip: 'for large jumps and flips in the selected Rotation
F-Curves... rotation values being clipped when baking physics') rewrites an accumulated rotation
(the presenter's own example: 700° → 60°, same physical orientation) to a continuous small range
without changing the posed orientation at any key. CLAUDE.md's pitfall list already documents Cadence
storing rotation as raw 'degrees about named axes', which is exactly the representation this filter
exists to repair — genuinely surprised to find no existing card had asked whether Cadence's own
`import_from_studio`/library-capture pipeline could ever ingest a rotation channel carrying this same
discontinuity. Recorded as an open question, not a confirmed gap, since nothing this session checked
proves it either way.

**Nothing in this video contradicted an existing knowledge card** — all four entries are new ground
(the corpus had no prior curve-editor-reading or rotation-representation entries at all).

**Capture candidates: none** — a Blender screen recording with a simple 3D ball rig, no filmed human
performance.

**Check queued**: `check: rotation_channel_discontinuity_flag — an isolated single adjacent-sample
delta on a rotation channel far larger than the channel's typical local delta, with no corresponding
declared pose change — no fixed numeric threshold established (Blender's own filter is a structural
fix, not a magnitude test either) — source: video 91 @ 12:53–13:42`.

## Video 92 — Animating ARMS (FK vs. IK) - Doodley — Doodley (11:28)
https://youtu.be/JnkAlwMjalc — watched 2026-09-12, `balanced` detail, 41 frames (scene-aware, full
video, no blind spots this time), captions transcript (360 segments). An unusually dense, directly
on-topic video — five entries written (density-justified, same as W03/W04/W05's densest videos), three
of which this session cross-checked directly against Cadence's own source rather than assuming a gap
existed.

**`fk_ik_deliberate_mid_action_switch`** — FK and IK are not a per-shot either/or: wind up a punch in
FK (precise curves), throw it in IK (a straight line, and the landing point holds itself with no extra
keys) (@ 0:31–1:36, frame t=01:09 shows the labelled FK demo pose). Checked against CLAUDE.md's own
description of `ai/pose.js` (Part 32): both FK and IK compile into the SAME kind of stored keys, so
Cadence structurally avoids the persistent FK/IK-mode-ownership problem some rigged tools have —
nothing here needed a blend weight, just calling `solve_ik` for the IK frames and ordinary keys for
the FK frames on the same chain.

**`track_space_switching_matches_cadence_unparented_toggle`** — the video's 'space switching' (an FK
or IK limb re-expressed relative to the rig's root instead of its immediate parent, so it keeps
following the body's overall movement without inheriting an unwanted intermediate rotation) turned out
to be a mechanism Cadence ALREADY HAS, not a gap — I read `state.js setTrackSpace` and
`app.js setUnparented` directly rather than assuming from the MCP tool's name, and confirmed the
conversion is exact and lossless in both directions (it re-derives every existing key from the rig's
actual solved pose at the moment of the switch, so switching back and forth never drifts the pose).
This is the kind of "Cadence is already ahead" result W07 found twice and I did not expect to find
again this late in the corpus.

**`staged_fk_space_switch_ik_handoff_for_contact_action`** — a named three-joint recipe for a fist
slam (raise in FK leading with the elbow → switch the elbow to world space at contact so it sticks →
forearm/fist down and switched to IK) citing Richard Williams' Animator's Survival Kit directly (frame
t=09:39 shows the actual book page, annotated 'ELBOW LEADS GOING UP', @ 9:37–10:22). Achievable today
as a manual sequence of Cadence's existing tools; no declared `ai/workflows.js` workflow currently
names this sequence (checked — none of the 16 matched 'ik'/'fk'/'switch').

**`weight_determines_emotion_vs_mechanics_authorship_ratio`** — weight sets a RATIO, not just a
struggle sequence: a light object (a pencil) is animated almost entirely from the character's feelings
about it, a heavy one blends physical strain with whatever emotional anticipation the character
brought to the lift (@ 7:14–8:00). Distinct from the existing `weight_then_strength_formula` card
(W02) — that one is about ORDER (struggle before release), this is about the MIX of two authoring
sources for the same motion.

**`forearm_twist_constraint_realism_vs_cartoon_convention`** — a real forearm only flexes at the
elbow; twisting originates at the shoulder, not the forearm, and cartoon convention breaks this
constraint on purpose for a springy look, which the presenter names directly as a real cause of mocap
looking stiff on cartoon characters ('Mars Needs Moms' cited by name, @ 5:55–6:51). Checked directly
against `renderer/js/ai/riggraph.js`: `joint_limits: null` on every joint is confirmed, so Cadence has
no way today to declare an elbow's rotational freedom differently from a shoulder's — confirmed as a
real absence, not a guess, though whether it has ever actually mattered in practice is still an open
question this session could not answer.

**One near-miss on redundancy, deliberately NOT written up**: the video's 'farther from the brain,
slower to react' cascading-reaction framing (@ 3:04–3:47, with the Rango example) restates ground the
existing `deliberate_lead_choice_for_acting` / chain-depth cards (W02) already cover well enough that a
new entry would have been repetition rather than new evidence — recorded here instead of as a file, per
the batch's own 'specific beats general' rule cutting the other way when the specific claim already
exists.

**Capture candidates: none** — a 2D-cutout-style demo character and film-clip B-roll (Kung Fu Panda,
Delgo, The Incredibles, Turning Red cited as reference stills), no filmed human performance.

**No new checks queued from this video** — every finding was either a generation-time authoring choice
(not a measurement) or already resolved by reading the actual code.

## Video 93 — FK and IK Explained - Which One to Use and When? — Miloš Černý Animation (7:47)
https://youtu.be/0a9qIj7kwiA — watched 2026-09-12, `balanced` detail, 56 frames (uniform sampling — a
talking-head-over-3ds-Max-CAT-rig video with only 7 real scene-change candidates in the whole length,
so the fallback uniform pass covers it evenly), captions transcript (186 segments). A second,
independent teacher and a different tool (3ds Max CAT) covering the same FK/IK ground as video 92 —
two entries written for what is genuinely NEW here rather than restating video 92's own findings.

**`ik_fk_blend_switch_requires_instantaneous_adjacent_frame_keying`** — this rig stores IK/FK as a
continuous 0–1 blend slider per limb, but the presenter is explicit that it must only ever be KEYED at
0 or 1 on adjacent frames (frame 20 → frame 21 in the demo), never animated through an intermediate
value, which he states directly 'can create some unwanted results' (@ 6:12–6:32, frames t=05:56–06:13
show the box-push demo this rule comes from). The rig's own workaround for the pop this switch risks —
explicit 'move IK to palm' / 'match FK to IK' align buttons that must run BEFORE keying the switch — is
the interesting contrast: Cadence's OWN space-switch mechanism (`setTrackSpace`/`setUnparented`, found
in video 92) has no such pop to align away in the first place, because it re-derives the value from the
solved pose automatically. Whether that same freedom extends to an FK-keys-to-`solve_ik` switch
specifically is still open — flagged honestly rather than assumed.

**`default_ik_fk_body_part_convention_legs_ik_arms_fk`** — legs default to IK, arms to FK, because
gravity makes a leg's job a POSITION problem (staying on the ground) while an arm's job is usually a
ROTATION problem (gesture, reach) — with named exceptions (free legs for underwater/roundhouse-kick
work; arms switched to IK to hold or place a hand) (@ 4:31–4:55, 6:53–7:04). This generalizes video
92's situational punch example into a stated DEFAULT for an entire rig, independently, from a second
teacher and tool — exactly the kind of cross-source confirmation this programme values most.

**Confirmed, not written up separately**: this video restates video 92's rotation-produces-arcs /
position-produces-lines distinction almost exactly ('with FK you get [arcs] by default... IK[,] joints
move in line trajectories unless you create the arc manually', @ 1:53–2:25) — a genuine independent
confirmation, but not new evidence beyond what `fk_ik_deliberate_mid_action_switch` already states.

**Capture candidates: none** — a 3ds Max viewport screen recording of a rigged CG character, no filmed
human performance.

**No new checks queued** — both findings are generation-time/rig-setup authoring disciplines, not
measurements.

## Video 94 — The Ultimate Animation Workflow for Beginners — Chester Sampson (12:59)
https://youtu.be/v71G6TCw_0M — watched 2026-09-12, `transcript` detail (a talk demonstrated over a
timelapse, per the batch list), captions transcript (426 segments). The densest, most directly
Cadence-relevant video in the batch so far: a fully-named six-step workflow (golden poses → breakdown
1 → breakdown 2 → midpoint → ease-in/ease-out → moving hold) that is, concept-for-concept, an
independent professional confirmation of how `ai/plan.js authorMotion` already works. Four entries.

**`progressive_spacing_via_pose_density_before_curve_interpolation`** — the workflow's whole point,
stated directly: spacing must get 'bigger and bigger... and then slower and slower' between poses, and
every added pose exists to encode that shape into pose density BEFORE any curve interpolation runs (@
8:07–8:38). This is independent confirmation of a CLAUDE.md pitfall I had read before this session but
did not expect to see restated almost verbatim by an unrelated professional source: `ai/plan.js`'s
breakdown step already requires bias as a POSE fraction (not a time fraction) for exactly this reason,
and throws if a caller omits it rather than defaulting silently.

**`breakdown_bias_symmetry_default_convention`** — a smaller, specific rule of thumb: use a similar
bias percentage on both breakdowns of one transition by default, and only mismatch them deliberately (@
5:56–6:04). Cadence enforces THAT a bias must be stated but has no notion of keeping two breakdowns
symmetric — purely a caller-side convention today.

**`lead_drag_decision_compounded_across_breakdowns`** — lead and drag are decided ONCE (at the first
two breakdowns) and then deliberately pushed further at every later pose, never re-decided (@ 4:16–4:24,
6:09–6:25, 7:27–7:39). Distinct from the existing lead/lag corpus entries (W02), which describe the
measurable phenomenon — this is the AUTHORING-ORDER discipline behind it, which nothing in `analyseChain`
or `authorMotion` currently persists across separate calls.

**`moving_hold_via_retimed_ease_key`** — a moving hold is not a new pose; it is the LAST ease-in pose's
key pushed later in time, so its own natural drift becomes the hold's residual motion (@ 10:26–10:53).
Directly buildable today with `move_keyframes` — no new capability needed, just naming the recipe.

**Not written up separately**: anticipation poses are treated identically to any other golden pose
('there's no need to overcomplicate this', @ 2:16–2:26) — a simplification point rather than new
evidence; and the arc-tracking-by-a-different-mesh-point technique (@ 4:57–5:22, tracking the nose or
elbow rather than the controller itself) is a minor variant of the existing `onion_skin_arc_verification`
card (W02), not a new mechanism.

**Capture candidates: none** — a rigged CG demo character (Link) and screen-recorded timelapses, no
filmed human performance.

**No new checks queued** — all four findings are generation-time authoring disciplines already
matched by existing Cadence code or tools, not new measurements.

## Video 95 — Animation Power Tips - When to go from BLOCKING to SPLINE — Harvey Newman (20:24)
https://youtu.be/TIBzcsOt2FU — watched 2026-09-12, `transcript` detail (a Maya screen-recorded talk),
captions transcript (569 segments). Answers exactly the question its title asks, with a live A/B
demonstration on the same shot — three entries, one of which is the best concrete confirmation this
whole batch has produced for an already-queued LESSONS.md check.

**`key_density_gates_spline_readiness_not_a_fixed_rule`** — splining a sparsely-keyed hip section live
on screen produces 'a mush of information' and the character 'looks super bad'; splining a densely
(near-ones) keyed kick-up section on the SAME shot looks 'pretty much getting there... moving with
intent' (@ 4:54–9:23). This is a vivid, visual, independently-sourced demonstration of exactly
LESSONS.md's already-queued `check: dps_floor_vs_action_duration` (#17) — I did not expect to find a
check already sitting in the queue get this directly confirmed mid-batch.

**`spline_should_refine_not_fix_posing_defects`** — spline should only make working animation better,
never be where a posing problem gets solved for the first time, learned the hard way by the presenter
himself ('I did it that way', @ 17:26–17:42). Checked directly against `ai/workflows.js`: `polish_
animation` is declared but `implemented: false` for exactly this reason — Part 14's top three
unmeasurable quality layers (intent, readability, pose design) are precisely what a polish pass would
need to judge, so Cadence already refuses to guess at the same boundary this video states for humans.

**`correlated_controller_keys_reviewed_and_moved_together_before_offsetting`** — three correlated spine
controllers reviewed and adjusted TOGETHER first (catching one unintended stray rotation as 'dirt' in
the process), with offsetting them for overlap treated as a deliberate later step, never the default (@
14:52–17:10). Maps almost by name onto Cadence's own `group_keys`/`ungroup_keys` tool pair — group for
the together pass, ungroup immediately before the deliberate offset pass.

**Not written up separately**: 'you don't want to actually be flat[,] you want to add a little
something to your tangent... so it's not a hundred percent flat' (@ 10:54–11:05) restates video 94's
moving-hold drift principle in tangent-shaping vocabulary rather than adding a new mechanism.

**Capture candidates: none** — a Maya viewport screen recording, no filmed human performance.

**No new checks queued** — the batch's existing check #17 already covers the strongest finding here;
the other two are workflow disciplines already matched by existing Cadence code/tools.

## Video 96 — Why Your Stepped Animation Sucks in Spline — Sir Wade Neistadt (8:59)
https://youtu.be/KSRZg7PwgyU — watched 2026-09-12, `transcript` detail, captions transcript (306
segments). A THIRD independent source (after videos 94 and 95) confirming the same underlying
blocking-density principle, but this time with a named technique and a concrete diagnostic procedure
neither earlier source stated — two entries.

**`blocking_plus_per_body_part_timing_contrast`** — a named technique ('Blocking Plus'): stagger
DIFFERENT BODY PARTS to different timing deliberately (favor one arm longer then arrive quicker, plant
a leg early so there's somewhere for the hips to shift weight into later), with the blunt framing that
a 200-frame shot blocked with only 20 keys hands the computer 90% of the shot (@ 2:24–2:57, 5:24–6:22).
More specific than video 95's 'add more keys' — this names WHAT the extra keys should actually
accomplish (body-mechanics-driven staggering), not just how many.

**`random_frame_authorial_accountability_check`** — an actual repeatable self-test: pause on a RANDOM
frame and ask whether you can account for it (did you set that pose, do you know which controls
produced that line of action) — a 'no' is the specific, checkable symptom of insufficient blocking
information (@ 7:37–8:09). Distinct in kind from Cadence's own `diagnose_frame` workflow, which answers
'why does this frame look wrong' from measurements — this checks 'did a human decide this frame' at
all, a question about authorial review that project data cannot answer on its own.

**Capture candidates: none** — a screen-recorded 3D backflip demo, no filmed human performance.

**No new checks queued** — both findings are human self-review disciplines, not measurements.

## Video 97 — Tips for Polishing Animation from a Disney Animator — Sir Wade Neistadt (22:09)
https://youtu.be/ujo7aHa7DGQ — watched 2026-09-12, `transcript` detail (an interview with Alan
Ostagar, a Disney character animator — Zootopia, Moana, Frozen), captions transcript (600 segments).
The single best source in the whole batch: a real feature-animation professional's actual polish
workflow, interviewed rather than tutorialized. Five entries — density-justified, matching W03/W04/W05
precedent for an unusually rich source.

**`polish_root_to_leaf_ordering_avoids_orphaned_counter_animation`** — polish the driver (usually hips,
sometimes torso/head) before its dependents, because polishing a child first and changing the parent
afterward orphans the child's counter-animation (@ 5:07–5:56). A sharp, general, well-evidenced
mechanism directly applicable to Cadence's own FK joint hierarchy.

**`steal_frame_reallocation_before_curve_work`** — reallocate frame budget BETWEEN adjacent actions
(steal a frame from one, give it to another) as the very first polish step, before any curve work,
because timing changes get more expensive to make the longer curve work has already been built around
them (@ 2:44–3:39). Directly buildable today with `move_keyframes`.

**`resample_to_whole_frames_preserving_curve_shape_via_insert_delete`** — a specific technical fix for
keys left on non-integer frames after a time-scale: insert new keys at the target whole frames using
the curve's OWN current value there, then delete the fractional-frame originals — never snap, which
distorts the shape (@ 8:30–9:24). Traced to a genuinely open, well-grounded question rather than a
guess: `stretch_frames` can produce fractional frame times, `state.js`'s own cache comment confirms the
evaluator tolerates them internally, but whether any Roblox-bound export re-quantizes them (and how) was
not checked.

**`isolate_by_disabling_risks_losing_causal_context`** — turning off a limb to judge a torso in
isolation is useful during blocking but risky during polish, because it hides the very influence (the
arm's weight pulling on the torso) that explains why the torso moves the way it does (@ 5:56–7:10). A
technique and its own explicit caveat from the same source.

**`cross_channel_curve_copy_via_layer_for_correlated_secondary_motion`** — copying a jaw's rotation
curve onto a cheek/mouth-corner/eyebrow channel on a SEPARATE LAYER, non-destructively, for automatic
correlated secondary facial motion (@ 13:37–14:32). Confirmed absent in Cadence by the code's own
repeated statements ('Cadence has no animation layers or blend weights', found in three separate
files), and directly compounds the existing W08 finding that Cadence's face isn't keyframeable over
time at all — two independent reasons now point at the same missing capability.

**Not written up separately**: the 'know exactly why you're doing what you're doing' graph-editor
discipline (@ 9:24–9:53) restates video 95's spline-should-refine-not-fix principle rather than adding
a new mechanism; the face-polish ORDER (jaw → cheeks/eyes → blinks, @ 13:12–14:59) and the line-of-action
reversal-for-impact technique (@ 15:10–16:04) are both genuine but lower-confidence restatements/variants
of already-covered ground (facial polish is out of scope per the existing W08 gap; line-of-action
reversal is a specific case of anticipation/overshoot already in the corpus).

**Capture candidates: none** — a talking-head interview with screen-recorded Maya examples, no filmed
human reference performance shown on screen.

**No new checks queued** — all five findings are workflow disciplines or a code-verification question,
not new runtime measurements.

## Video 98 — Animation Critique: How To Instantly Improve Your Blender Animation With Easy Tricks — CG Cookie (35:55)
https://youtu.be/r_wQmGKUdZ4 — watched 2026-09-12, `efficient` detail, 50 frames (keyframe pass, 249
near-duplicates dropped — a talking-head-plus-viewport critique of a student's bouncing-ball exercise),
captions transcript (838 segments). Per W10.md's own hint ('how a reviewer talks; the review tool's
tone and order'), most of the specific animation notes (arcs, spacing, squash/stretch-before-contact,
anticipation-matching-the-move) restate ground this corpus already covers well — the real find is in
the STRUCTURE of the critique itself. Three entries.

**`certainty_ordered_feedback_matches_cadence_review_sorting`** — the single cleanest correspondence in
this whole batch between an external practice and an already-built Cadence mechanism: the reviewer
explicitly separates 'stuff I'm certain on' from 'stuff to try' and says to fix the certain items first
(@ 16:12–17:13). Checked directly against the actual code rather than assumed: `ai/certainty.js`'s five
ranked `CERTAINTY` levels and `ai/review.js`'s `sortFindings`/`certaintyRank` already do EXACTLY
this — certain findings sorted first, artistic suggestions kept in a fully separate array, with a
`confidence_summary` counting each level. Cadence isn't just representable here; it's already ahead of
what the human reviewer does by hand.

**`recurring_pattern_flagged_once_with_repeated_instances_named`** — the same mistake (squashing
instead of stretching before ground contact) is flagged at three separate points in one submission,
with the second occurrence explicitly named as a pattern ('this is what I've noticed in a lot of the
bounces') rather than three unrelated notes (@ 7:00–7:28, 11:46–12:10, 15:13–15:18). Cadence's
`orderedDefects` sorts by certainty but this session found no evidence it GROUPS repeated instances of
the same root cause into one pattern-level finding.

**`specific_praise_interspersed_not_only_front_loaded`** — specific, located praise ('I really like how
you've pushed this platform down') given throughout, not just as an opening formality, naming exactly
what to preserve while fixing nearby problems. A genuine third category this session found no Cadence
equivalent for: `review_shot` reports defects and artistic suggestions, but nothing surfaces a
passing/already-correct measurement as its own located 'preserve this' finding.

**Not written up separately**: the recurring scribble technique (drawing both the observed arc and the
intended one directly over the viewport, confirmed in frames at t=06:42 and t=14:06) is a genuine
communication technique loosely resonant with `ai/simulate.js`'s before/after diffed-by-quality-layer
report, but this session judged the connection too speculative to write up as a grounded finding rather
than a guess.

**Capture candidates: none** — a Blender viewport screen recording with a talking-head overlay, no
filmed human performance.

**No new checks queued** — all three findings are about review-OUTPUT structure and communication, not
new runtime measurements.

## Video 99 — How to use video reference for Animation — Chester Sampson (11:40)
https://youtu.be/UkWnwHwMapQ — watched 2026-09-12, `transcript` detail, captions transcript (368
segments). A worked, end-to-end demonstration of turning a reference clip into a blocking pass, with a
genuinely algorithmic key-pose criterion. Three entries.

**`cog_extrema_and_contacts_define_reference_key_poses`** — track the character's center of gravity as
a line across the reference; every LOCAL EXTREME of that line (a real turning point) plus every contact
is a key pose (@ 0:44–2:46). Checked directly against `ai/motion.js`: `sampleMotion` already samples an
arbitrary part's trajectory (a COG proxy could be passed today), but no local-extrema/turning-point
detector exists as a named measurement — the raw data is there, the specific 'find the turning points'
step is not built.

**`contact_poses_derived_as_breakdowns_between_extremes_not_posed_independently`** — pose only the
extremes; generate every contact between them as a BIASED BREAKDOWN, then adjust only the feet/roll —
'you don't have to make a pose from scratch[,] you get a lot for free' (@ 3:48–5:35). Exactly what
`ai/plan.js authorMotion`'s breakdown step already does, per the video 92/94 findings this same batch —
a fourth independent confirmation of the same mechanism, this time applied specifically to deriving
contacts.

**`reference_fidelity_then_deliberate_retiming_departure`** — get a faithful blocking pass matching the
reference's own timing FIRST, then a separate, explicit stage to retime deliberately toward a style
(hold longer here, snap faster there) — with a clean side-by-side comparison at the end proving the
retime alone (no re-posing) already reads more cartoony (@ 8:20–10:15). Directly buildable with
`move_keyframes`.

**Not written up separately**: exaggerating lead/follow elements 'that aren't as much in the reference'
restates existing lead/follow corpus ground; three-quarter angles reading better than front-on for CG
characters is a real but generic CG-modeling observation with no Cadence-specific hook.

**Capture candidates: none** — a Maya viewport screen recording synced to a reference clip via
Keyframe Pro, no filmed human performance directly usable (the reference clip itself is third-party
stock footage, not something this session could capture).

**No new checks queued** — the strongest finding (COG-extrema detection) is flagged as buildable-today
in its own entry rather than queued separately, since it names the exact missing measurement already.

## Video 100 — The COMPLETE Guide to Reference for Feature Animation — owenferny (38:06)
https://youtu.be/TaiJauNiKH4 — watched 2026-09-12, `transcript` detail, captions transcript (811
segments). The final video of the entire 100-video list. A specialist reference-workflow deep dive,
independently confirming and sharpening several video-99 findings while adding genuinely new ones. Five
entries.

**`acting_vs_mechanics_reference_usage_ratio_decided_per_section`** — how closely to copy reference
depends on content type (acting: take only the beats, invent breakdowns yourself; mechanics: copy
closely including breakdowns) and the split can happen MID-SHOT, not just per shot (@ 11:05–13:29,
32:06–32:33). Matches `ai/reference.js`'s existing `emulate`/`not_copied` caller-declared fields almost
exactly — Cadence already has the mechanism to RECORD this distinction, correctly leaving the judgment
itself to the caller (Part 13).

**`channel_priority_order_for_extracting_reference_extremes`** — a stated extraction order: translate Y
extremes first (weight/momentum), then X/Z (silhouette/overlap), then secondary parts (chest, arms) (@
9:16–10:20). A more granular refinement of video 99's COG-extrema finding — WHICH channel to check
first when more than one matters.

**`eye_focus_change_as_acting_key_signal`** — a focus/gaze change is physical evidence of a thought
change and is usually a key; eye motion NOT tied to a focus change is optional breakdown texture, an
explicit judgment call (@ 29:07–30:19). The acting-content counterpart to video 99's COG-extrema
criterion for mechanics content.

**`micro_motion_prevents_spliney_gap_between_extrema`** — a long gap with no direction-change in a
tracked channel reads as 'spliney, floaty' even in an otherwise well-keyed shot; a tiny, barely-visible
reversal fixes it disproportionately (@ 34:00–34:50). A genuinely new, complementary failure mode to
the existing `dps_floor_vs_action_duration` check (#17) — not overall key density, but the longest GAP
between consecutive extrema in one specific channel. **New check queued** below.

**`spliced_multi_take_reference_editing`** — building one composite reference from the best parts of
multiple takes (including different performers), cut together and matched by audio waveform (@
18:15–18:24, 19:34–19:36). Not a Cadence-authoring technique — a pre-production note about reference
provenance worth remembering if `ai/library.js`'s captured-entry fields are ever extended past
Roblox-capture sources.

**Not written up separately**: the explicit 'I don't retime reference, I reshoot it' account (@
37:17–37:28) is about retiming raw SOURCE FOOTAGE, a different question from video 99's finding (which
retimes the ANIMATOR'S OWN authored keys) — a useful clarifying distinction, not a contradiction, but
too narrow on its own for a full entry; the quadruped human-self-performance-then-real-reference
technique (@ 32:36–32:55, briefly touched again at 36:11–36:52) is folded into the acting-vs-mechanics
entry above as a supporting example rather than written up on its own.

**Capture candidates: none** — the video is itself a reference-production tutorial (webcam self-footage
edited in DaVinci Resolve), not source material Cadence's own capture pipeline would ingest.

**New check queued**: `check: max_gap_between_consecutive_motion_extrema — the longest span, on one
tracked channel (typically a root/hip's vertical position), between two consecutive local extrema
(velocity sign changes); flag a span implausibly long relative to the action's own duration — derivable
today from `sampleMotion`'s existing position/velocity sampling, no new capability required — source:
video 100 @ 34:00–34:50`.

---

## Batch closing summary (all ten videos complete)

All ten watched in one long session (2026-09-12, the user handed the session `W10.md`'s path directly
with effort set to max — the same pattern as W05/W07/W08). **36 new knowledge entries** written to
`knowledge/inbox/W10-*.json` (4+5+2+4+3+2+5+3+3+5 across videos 91–100 in order — recomputed by actually
listing the files just now, not trusted from a running tally, per the standing discipline this
programme has needed twice before). All 36 pass both Part 72 gates (`validateProposedEntry` and
`validateEvidenceSource`, run via a small Node script that imports `ai/knowledge.js` directly rather
than assumed from examples) — checked per-video as each was written, then again as one final sweep
across the full corpus (compiled knowledge plus every batch's inbox, 277 files, 276 with a `concept`
field, 276 unique concepts, **zero collisions**). One pre-existing, unrelated problem surfaced by that
sweep: `knowledge/inbox/W09-85-legible-vs-ambiguous-energy-source-as-authorial-choice.json` (the
concurrently-running W09 session's own file, not this batch's) fails to parse as JSON — confirmed with
a second, independent read a few minutes later, so not a mid-write race; flagged here for whoever merges
or continues W09, not fixed by this session since it is outside W10's own files.

**Two capture candidates across all ten videos: zero** — every video was a screen recording (Blender,
3ds Max, Maya) or a reference-production tutorial, never a filmed human performance Cadence's own
pipeline could capture from.

**Checks queued: two**, both buildable today from `ai/motion.js sampleMotion`'s existing data with no
new capability required — `rotation_channel_discontinuity_flag` (video 91) and
`max_gap_between_consecutive_motion_extrema` (video 100).

**Nothing in this batch contradicted an existing knowledge card.** The batch's own throughline: this was
the first batch to spend real time cross-checking its findings against Cadence's OWN source code rather
than only against the existing knowledge corpus, and it went both ways about as often as not. Confirmed
gaps: no animation layers at all (three separate files say so explicitly), `joint_limits: null` on every
joint (no forearm-twist-style DOF constraint), no local-extrema/turning-point detector in `ai/motion.js`,
and the `polish_animation` workflow's own honest `implemented: false`. Confirmed strengths, found rather
than assumed: `set_track_space`/`setUnparented` already do a lossless, pop-free space-switch that a
whole OTHER tool (3ds Max CAT, video 93) needs a manual align-before-switch step to fake; and
`ai/certainty.js`'s ranked `CERTAINTY` levels plus `ai/review.js`'s `sortFindings`/`certaintyRank`
already implement, as real sorted data, exactly the certain-fixes-first feedback discipline a Disney-
trained reviewer (video 98) described doing by hand. `ai/reference.js`'s `emulate`/`not_copied` fields
turned out to be an exact, pre-existing match for the acting-vs-mechanics reference-usage distinction
three different reference-focused videos (94, 99, 100) converged on independently. This is the LAST of
the ten watch batches (W01–W10) to be watched; W01–W02 are merged, **W03–W10 all sit finished and
unmerged in `knowledge/inbox/`, waiting for a learning-loop session** to run
`node tools/merge-knowledge-inbox.mjs` batch by batch.
