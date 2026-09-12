# W10 notes — videos 91–100 (F. VFX, camera and curves · G. Workflow, reference and critique)

- [x] 91. How to use Blender's Graph Editor like a Professional Animator — BrianKouhi (15:53)
- [x] 92. Animating ARMS (FK vs. IK) - Doodley — Doodley (11:28)
- [x] 93. FK and IK Explained - Which One to Use and When? — Miloš Černý Animation (7:47)
- [x] 94. The Ultimate Animation Workflow for Beginners — Chester Sampson (12:59)
- [ ] 95. Animation Power Tips - When to go from BLOCKING to SPLINE — Harvey Newman (20:24)
- [ ] 96. Why Your Stepped Animation Sucks in Spline — Sir Wade Neistadt (8:59)
- [ ] 97. Tips for Polishing Animation from a Disney Animator — Sir Wade Neistadt (22:09)
- [ ] 98. Animation Critique: How To Instantly Improve Your Blender Animation With Easy Tricks — CG Cookie (35:55)
- [ ] 99. How to use video reference for Animation — Chester Sampson (11:40)
- [ ] 100. The COMPLETE Guide to Reference for Feature Animation — owenferny (38:06)

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
