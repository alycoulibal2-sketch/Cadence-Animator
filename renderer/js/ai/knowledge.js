// The animation knowledge system (directive Parts 25, 26, 71, 73). KNW-001 through KNW-007.
//
// Part 25 is explicit about what this must NOT be: "Do not interpret animation knowledge as a list
// of famous principles or a collection of predefined effects." So this file is not a glossary. Every
// entry carries the full field list Part 25 requires — including the two fields that make a
// knowledge base actionable rather than decorative: "Detection and measurement methods" (what
// Cadence can actually check) and "Cadence representation" (where the concept lives in this
// codebase, or the honest statement that it does not yet). An entry that cannot say either of those
// two things truthfully is not ready to exist.
//
// One decision settled before any entry was written, because SHARED_TASK_NOTES.md flagged it as a
// trap: KNW-003 must not credit the planner with knowledge it does not have. `ai/vocabulary.js`
// already moves `acceleration_contrast` for "anticipation depth" and `secondary_delay` for
// follow-through — but nothing before this file ever said WHEN those techniques are HARMFUL, and
// Part 25's own knowledge-entry structure exists specifically to carry that ("Non-use cases",
// "Failure modes"). A dimension that compiles is not the same claim as a knowledge entry that knows
// its own limits, so every entry below states both what already works AND when the technique should
// be withheld — the second half is the row `ai/vocabulary.js` alone could never have satisfied.
//
// A second decision: where the twelve entries live. Cadence has no cross-project store (no
// mechanism persists anything outside one `.cadence` file — see ai/memory.js's header for the full
// reasoning). The classical principles are not project data, learned preferences, or anything a
// save file should own: they are compiled reference knowledge, the same kind of thing
// `particleLibrary.js`'s 22 material archetypes already are for VFX. So `KNOWLEDGE_ENTRIES` is a
// frozen module-level table, like `ai/vocabulary.js TERMS` — not something `project.semantics`
// carries, and not something that needs a store this build does not have.
//
// Pure at load like the rest of `ai/`.

export const CATEGORIES = Object.freeze(['essential', 'advanced', 'optional', 'specialized', 'experimental']);

// ---------------------------------------------------------------- Part 25's field list

const FIELDS = Object.freeze([
  'concept', 'category', 'definition', 'purpose', 'visible_effect', 'psychological_or_gameplay_effect',
  'physical_interpretation', 'use_cases', 'non_use_cases', 'interactions', 'style_variations',
  'cadence_representation', 'control_surface', 'detection_and_measurement_methods',
  'generation_or_modification_methods', 'failure_modes', 'roblox_considerations',
  'performance_implications', 'examples', 'evidence_status',
]);

// ---------------------------------------------------------------- Part 26's twelve principles
//
// All twelve are `category: 'essential'` — Part 25's own essential examples name half of them
// verbatim ("timing, spacing, posing, arcs, contacts, weight") and Part 26 introduces the rest as
// the same kind of foundational tool, so splitting them into different categories would be a
// distinction the directive does not draw. `touches_aspects` reuses `ai/constraints.js ASPECTS` —
// the same vocabulary `ai/vocabulary.js dimensionAspects()` uses — so the relevance gate's
// constraint-conflict question (Part 71 #4/#7) can be answered by the SAME check the apply path
// already runs, not a second approximation.

const ENTRY_LIST = [
  {
    concept: 'squash_stretch',
    category: 'essential',
    definition: 'Deformation, pose compression/extension, trajectory change, or silhouette change that communicates elasticity, force, and material response.',
    purpose: 'Sell the force and material of an impact or motion without needing physically simulated deformation.',
    visible_effect: 'A compressed pose before or at contact, an extended pose leaving it, or — where mesh scale is unavailable — an equivalent shift in silhouette and trajectory.',
    psychological_or_gameplay_effect: 'Reads as energy and material response; its absence on a hard impact reads as stiffness or a missed hit.',
    physical_interpretation: 'An approximation of real deformation under force, volume-preserving by convention (wider becomes shorter) unless the style deliberately breaks that.',
    use_cases: ['a cartoon or anime impact wanting exaggerated force', 'a soft or organic character landing or colliding', 'a VFX emitter item wanting a pose-based equivalent via scale'],
    non_use_cases: ['a rigid, mechanical, or explicitly protected object (Part 26.1 names this directly)', 'realistic style, where it should be restrained to near-zero or omitted', 'any joint or item under a locked constraint on `value`'],
    interactions: ['Timing — compression usually lands ON the contact frame, not before it', 'Weight — see MEM/vocabulary `weight_transfer`, `contact_firmness`', 'Style — realistic and mechanical profiles dampen or forbid it (see ai/style.js STYLE_MODIFIERS)'],
    style_variations: { realistic: 'near-zero, or expressed as barely-visible weight shift', anime: 'can be extreme and held (impact freeze)', cartoon: 'the primary vocabulary of the style, may break volume', mechanical: 'excluded entirely — Part 26.1' },
    cadence_representation: 'No mesh deformation exists in Cadence at all — rigs are rigid Motor6D hierarchies. The pose-based equivalent is `ai/vocabulary.js`\'s `motion_amplitude` and `weight_transfer` dimensions, which is the "subtle pose-based equivalent when mesh scale is unavailable" Part 26.1 explicitly asks for.',
    control_surface: 'the `motion_amplitude` / `weight_transfer` vocabulary dimensions via `interpret_intent` / `plan_motion`; no direct squash/stretch control exists.',
    detection_and_measurement_methods: 'None. `ai/motion.js` measures no scale or volume signal because no track in Cadence stores mesh scale over time — this is a genuine capability gap, not an unmeasured-but-present quantity.',
    generation_or_modification_methods: 'Indirect only, through the pose-based dimensions above compiling to rotation amplitude, never a literal scale key.',
    failure_modes: ['using it to make a motion "more animated" rather than to communicate force (Part 26.1\'s own warning)', 'applying it to a locked or protected item, which a constraint should refuse', 'applying it under a realistic or mechanical style, which contradicts the style\'s own definition'],
    roblox_considerations: 'A literal scale key IS representable in Roblox (Motor6D parts can be scaled), so a future compiler could target it directly rather than only the pose-based approximation — named as a real, not merely theoretical, extension.',
    performance_implications: 'None beyond any other keyframe — no simulation cost.',
    examples: ['a heavy sword impact compressing the torso before recoiling outward', 'a cartoon character landing with a flattened pose held two frames'],
    evidence_status: 'directive text (Part 26.1); no in-app measurement exists to validate an applied instance',
  },
  {
    concept: 'anticipation',
    category: 'essential',
    definition: 'Preparatory motion, opposite or complementary to the coming action, that establishes direction, force, and balance before the action itself.',
    purpose: 'Make the following action readable and clarify its direction before it happens.',
    visible_effect: 'A wind-up phase: weight shift, rotation opposite the action\'s direction, or compression, before the main motion.',
    psychological_or_gameplay_effect: 'Increases perceived force and readability; too much costs responsiveness in an input-driven context.',
    physical_interpretation: 'Loading energy into the body before releasing it — analogous to a coiled spring, though Cadence models none of the physics, only the pose.',
    use_cases: ['a heavy or powerful attack wanting clarity and force', 'any action whose direction would otherwise be ambiguous from its start pose'],
    non_use_cases: ['a surprise reaction, which the directive says may have anticipation "nearly absent" by design', 'a fast game input where responsiveness cost is unacceptable — Part 26.2: "expressed through pose more than by frames"', 'an item whose `timing` aspect is locked, since anticipation with existing keys can only be a value/easing change, not a phase insertion'],
    interactions: ['Timing — Part 26.2 asks whether it is readable "relative to action duration"', 'Camera — whether anticipation is readable from the active camera (Cadence has no active-camera model to check this)', 'Style — game_combat compresses anticipation depth (ai/style.js)'],
    style_variations: { realistic: 'mechanical — weight transfer, counter-rotation, deceleration', anime: 'can be a long, still hold before a violent release', game_combat: 'compressed toward pose over frames, to protect responsiveness' },
    cadence_representation: 'This is the one technique the matrix already names as implicitly operationalized WITHOUT a knowledge entry behind it: `ai/cal.js PHASE_NAMES` declares an `anticipation` phase, `ai/plan.js` segments one from key/marker evidence, and `ai/vocabulary.js`\'s `anticipation_depth` dimension edits its amplitude. This entry is what was missing — the planner moves the dimension; nothing until now stated when NOT to.',
    control_surface: 'the `anticipation_depth` vocabulary dimension; `ai/plan.js segmentPhases` for locating an existing anticipation phase.',
    detection_and_measurement_methods: '`ai/motion.js` measures onset/peak timing per joint, which can locate a preparation phase\'s duration once segmented; it does not judge whether that duration is APPROPRIATE for the action — that judgement is not made anywhere in this build.',
    generation_or_modification_methods: '`anticipation_depth` scales the rotation amplitude across an already-segmented anticipation phase; it cannot insert a phase that does not exist (Phase 3\'s planner may not add or remove a key).',
    failure_modes: ['telegraphing an action so far in advance it reads as sluggish', 'applying uniform anticipation depth regardless of action type — a surprise reaction gets the same treatment as a heavy attack', 'lengthening anticipation on a gameplay-critical action past what responsiveness allows'],
    roblox_considerations: 'None specific — this is a pure keyframe-timing concept independent of the target engine.',
    performance_implications: 'None.',
    examples: ['a sword pulled back and torso rotated before a slash', 'a nearly-absent anticipation on a startled flinch'],
    evidence_status: 'directive text (Part 26.2) plus in-app measurement of phase duration; the appropriateness judgement itself is not validated by any test',
  },
  {
    concept: 'staging',
    category: 'essential',
    definition: 'Control of what the viewer sees first and what stays secondary — pose readability, camera framing, contrast, depth, silhouette, timing, VFX hierarchy, and environmental context.',
    purpose: 'Direct attention to the action that matters and keep everything else from competing with it.',
    visible_effect: 'A clear silhouette for the primary action; a VFX or secondary element that does not obscure it; a readable action direction.',
    psychological_or_gameplay_effect: 'Determines whether the audience understands what just happened at all, independent of how well the motion itself was executed.',
    physical_interpretation: 'Not physical — a composition and attention concept.',
    use_cases: ['any shot with a clear primary action', 'a VFX-heavy moment at risk of visually competing with the character'],
    non_use_cases: ['nothing — Part 26.3 treats this as universally applicable, unlike several other principles this build can name a non-use case for'],
    interactions: ['VFX — Part 38\'s hierarchy budget share (ai/vfxspec.js) is a real, if partial, staging mechanism: a secondary effect gets a smaller budget than the primary one', 'Camera — most of Part 26.3\'s questions ("is the action readable in the active camera") require a camera model Cadence does not have'],
    style_variations: { cinematic: 'staging is close to the whole discipline of the style, not one dimension among several' },
    cadence_representation: 'Partial and indirect. `ai/vfxspec.js`\'s Part 38 hierarchy (`primary`/`secondary` roles with a budget share) is the one real staging mechanism in this build. Silhouette itself IS measurable (`ai/observe.js` / `ai/raster.js` silhouette passes from Phase 4) but nothing connects a silhouette measurement to a staging judgement — Phase 4 measures pixels, not "is this readable".',
    control_surface: 'VFX hierarchy role via `compile_effect`; silhouette rendering via `create_baseline` / `explain_change`, read manually rather than judged automatically.',
    detection_and_measurement_methods: 'Silhouette pixel coverage exists (Phase 4). Screen-space region-of-interest, contrast, and occlusion-by-VFX (Part 26.3\'s own list) do not — no active-camera model, no compositing.',
    generation_or_modification_methods: 'None directly; a VFXSpec\'s `role` field is the only lever.',
    failure_modes: ['a VFX layer at full budget share obscuring the character it should support', 'no primary/secondary declaration at all on a multi-effect shot, leaving hierarchy to chance'],
    roblox_considerations: 'Roblox has no built-in compositing or attention system; staging is entirely an authoring discipline here.',
    performance_implications: 'None beyond the VFX budget mechanism, which already exists for a different reason (Part 38).',
    examples: ['a boss telegraph effect kept secondary so the boss\'s own wind-up reads first', 'a cluttered shot where three simultaneous effects compete for attention'],
    evidence_status: 'directive text (Part 26.3); partial measurement via existing silhouette passes, not connected to a staging verdict',
  },
  {
    concept: 'pose_workflow',
    category: 'essential',
    definition: 'The choice between pose-to-pose (plan key poses first, then fill) and straight-ahead (build sequentially, letting rhythm emerge) — Part 26.4.',
    purpose: 'Match the authoring method to what the motion needs: predictable timing and revision safety, or emergent, spontaneous rhythm.',
    visible_effect: 'Not visible in the result directly — this is a process choice, not a motion property — though pose-to-pose work tends to show clearer, more deliberate key poses.',
    psychological_or_gameplay_effect: 'Indirect, through the poses and rhythm the chosen workflow tends to produce.',
    physical_interpretation: 'None — a production-method concept, not a physical one.',
    use_cases: ['pose-to-pose: deliberate character performance, combat clarity, controlled production pipelines', 'straight-ahead: organic motion, effects, creature movement, expressive experimentation'],
    non_use_cases: ['forcing pose-to-pose onto every fluid effect, or straight-ahead onto every gameplay-critical action — Part 26.4\'s explicit warning'],
    interactions: ['Rig complexity and style both bear on the choice (Part 26.4)', 'Reference-driven motion (Part 36, REF-001) is closer to straight-ahead in spirit'],
    style_variations: {},
    cadence_representation: 'Not represented as a choice at all. Every tool in `ai/plan.js` edits EXISTING keys placed by pose-to-pose-style authoring; nothing in this build generates a sequential, straight-ahead motion from nothing (see `ai/index.js capabilities().cannot`: "generate a motion from nothing"). This is a genuine, named absence rather than an implicit default.',
    control_surface: 'none — there is no tool that lets a caller declare or act on this choice',
    detection_and_measurement_methods: 'None — this is a workflow property of how an animation was AUTHORED, not a property `ai/motion.js` can recover by measuring the result.',
    generation_or_modification_methods: 'None.',
    failure_modes: ['none observable from this build, since neither workflow is currently chosen or enforced by any tool'],
    roblox_considerations: 'None specific.',
    performance_implications: 'None.',
    examples: ['planning key poses for a combo before filling breakdowns', 'improvising a creature\'s idle sway frame by frame'],
    evidence_status: 'directive text only (Part 26.4); Cadence has no capability that reasons about this distinction, named here rather than implied',
  },
  {
    concept: 'follow_through_overlap',
    category: 'essential',
    definition: 'Follow-through: parts continue moving after the main action stops rather than halting uniformly. Overlap: linked parts (limbs, cloth, hair, weapon, VFX) trail the primary motion by different amounts.',
    purpose: 'Communicate inertia and prevent an unnaturally uniform stop across a whole body or chain.',
    visible_effect: 'Trailing parts arrive and settle later than the part that led them, with their own decay.',
    psychological_or_gameplay_effect: 'Its absence reads as robotic or weightless; excess reads as loose or unintentional.',
    physical_interpretation: 'An approximation of inertia propagating down a chain, without a physics solve behind it.',
    use_cases: ['a heavy attack with cloth, hair, or a weapon that should lag', 'any multi-joint chain stopping after a fast motion'],
    non_use_cases: ['a mechanical or robotic style — Part 26 groups "purposeful lack of organic overlap" as a deliberate style choice, not an oversight', 'an item whose `timing` aspect is locked, since this compiles to key-time OFFSETS'],
    interactions: ['Momentum (Part 71\'s own graph names this pair explicitly)', 'Contacts — a trailing effector must not be allowed to drift through a declared contact (MOT-008 measures exactly this)'],
    style_variations: { mechanical: 'near-zero — see ai/style.js `secondary_delay: 0.1`', cartoon: 'may exaggerate into a held wobble' },
    cadence_representation: 'Directly represented: `ai/vocabulary.js`\'s `secondary_delay` dimension (MOVES keys, one of the few dimensions that does) and `ai/motion.js analyseChain` (lead/lag measurement per chain, with inversion reported rather than judged wrong).',
    control_surface: '`secondary_delay` vocabulary dimension via `plan_motion`; `analyze_motion` / `analyze_contacts` for measurement.',
    detection_and_measurement_methods: '`ai/motion.js analyseChain` measures onset and peak per joint along a declared chain and reports lead/lag directly — this is one of the two principles in this table (with slow-in/slow-out) backed by a REAL per-frame measurement, not only a compile-time dimension.',
    generation_or_modification_methods: '`secondary_delay` offsets keys on parts with no contact role; this MOVES keys, which is why it needs the contact model (Phase 5) before it could touch anything with a declared plant.',
    failure_modes: ['excessive delay reading as looseness rather than weight', 'delaying a part that has a declared contact, breaking the plant it should not touch', 'a chain inversion mistaken for an error — Part 22 explicitly permits it for whip cracks and isolated gestures, and `ai/motion.js` reports rather than judges it'],
    roblox_considerations: 'None beyond the general Motor6D chain structure already modelled.',
    performance_implications: 'None.',
    examples: ['a cloak settling three frames after the torso stops', 'a weapon\'s tip arriving after the wrist that swung it'],
    evidence_status: 'directive text (Part 26.5) plus real per-frame chain measurement (MOT-009/010, `partial`)',
  },
  {
    concept: 'slow_in_slow_out',
    category: 'essential',
    definition: 'Spacing and curve behaviour — gradual acceleration/deceleration versus sharp, even, or abrupt spacing — treated as a deliberate choice, not a default smoothness setting.',
    purpose: 'Control perceived mass, impact sharpness, and whether a motion feels alive or merely smoothed.',
    visible_effect: 'Frame-to-frame spacing that clusters near the ends of a transition (ease) versus even spacing (linear) versus abrupt stops (stepped/sharp easing).',
    psychological_or_gameplay_effect: 'Smoothness applied everywhere reads as vague and can make combat weak — Part 26.6\'s own warning.',
    physical_interpretation: 'An approximation of acceleration under force; Cadence keys carry an easing style and direction, never literal tangent vectors (a repeated fact across this codebase — see `ai/timelinegraph.js`).',
    use_cases: ['most transitions benefit from SOME slow-in/slow-out', 'a sharp impact wants abrupt spacing at the contact, not an ease into it'],
    non_use_cases: ['using a smooth ease as a default "fix" for every timing complaint — the directive is explicit that this can make animation lifeless', 'an easing style already off the contrast ladder (a custom bezier), where a rate change would be a shape decision, not a spacing one — `ai/plan.js` already refuses this case explicitly'],
    interactions: ['Timing — this is the curve-level expression of a timing decision', 'Style — anime permits near-instant snaps with holds either side; realistic bounds snap by what a body can plausibly accelerate'],
    style_variations: { anime: 'snap can be near-instant', realistic: 'bounded by plausible acceleration', mechanical: 'very even spacing preferred (ai/style.js `spacing_evenness: 1.4`)' },
    cadence_representation: 'Directly represented: `ai/vocabulary.js`\'s `acceleration_contrast` and `spacing_evenness` dimensions compile to real easing-style/direction changes on the keys bounding a phase (`ai/plan.js`), and `ai/motion.js` measures the actual resulting velocity/acceleration curve.',
    control_surface: '`acceleration_contrast` / `spacing_evenness` vocabulary dimensions; `set_easing` for direct control.',
    detection_and_measurement_methods: '`ai/motion.js sampleMotion` measures per-frame velocity and acceleration directly from the FK solve — the other of the two principles in this table backed by a real per-frame measurement rather than only a compile-time dimension.',
    generation_or_modification_methods: '`acceleration_contrast` and `spacing_evenness` pick an easing style/direction on the keys bounding the affected phase(s); nothing inserts a new key to change spacing mid-phase.',
    failure_modes: ['applying a smooth ease as a generic fix, which Part 26.6 names as a real risk to combat weight and stylized life', 'an unintentional float where an abrupt stop was intended'],
    roblox_considerations: 'Roblox\'s own Animation Editor easing options map closely to what Cadence keys already store, so nothing here is Roblox-specific beyond ordinary export fidelity.',
    performance_implications: 'None.',
    examples: ['a punch accelerating sharply into contact and stopping dead', 'a slow, even drift with no acceleration contrast at all'],
    evidence_status: 'directive text (Part 26.6) plus real per-frame measurement (Part 23, MOT-003/004, `implemented`)',
  },
  {
    concept: 'arcs',
    category: 'essential',
    definition: 'The path a moving part traces through space — hands, heads, weapons, feet, projectiles, camera moves, VFX trails.',
    purpose: 'Make motion read as intentional and physically coherent, rather than mechanical or accidental, unless a broken path is the deliberate choice.',
    visible_effect: 'A smooth, continuous curve versus an angular, cornered, or wobbling path.',
    psychological_or_gameplay_effect: 'A clean arc reads as controlled and organic; corners and wobble read as unintentional, unless the style explicitly wants mechanical or broken paths.',
    physical_interpretation: 'The trajectory a mass would plausibly follow under continuous force, though nothing in Cadence solves for one — see the measurement/generation gap below.',
    use_cases: ['organic character motion, hand and weapon trajectories, projectile and camera paths'],
    non_use_cases: ['a robotic arm, a linear projectile, a teleport, or any deliberately broken motion — Part 26.7\'s own list of exceptions', 'mechanical style, where the arc pull inverts toward geometric precision (see `ai/vocabulary.js` "elegant" term\'s `style_dependencies`)'],
    interactions: ['Weight and timing both bear on whether an arc reads as intentional', 'Style is the dominant modifier here — an arc that is "good" in one style is wrong in another'],
    style_variations: { mechanical: 'geometric, deliberately non-organic paths are correct', horror: 'unusual or broken trajectories may be the intended effect (ai/style.js `arc_smoothness: 0.4`)' },
    cadence_representation: 'Split, and the split matters: MEASUREMENT exists (`ai/motion.js MOT-005` — per-frame path curvature and chord deviation) but GENERATION does not. `ai/vocabulary.js`\'s `arc_smoothness` dimension is explicitly `implemented: false` — smoothing an arc means changing where a part IS at an intermediate frame, and every strategy in `ai/plan.js` edits a joint ROTATION at an existing key, never a position.',
    control_surface: '`analyze_motion` reports curvature; there is no dimension or tool that edits it.',
    detection_and_measurement_methods: '`ai/motion.js` computes path curvature and chord-deviation per frame from the FK solve — a genuine, working measurement.',
    generation_or_modification_methods: 'None. This is one of the clearest cases in the whole knowledge system of a measured-but-not-actionable gap (see `ai/vocabulary.js DIMENSIONS.arc_smoothness.blocked_by`).',
    failure_modes: ['an unintentional corner or wobble in what should be a clean arc, currently only detectable by measurement, not correctable by this build', 'applying a "smooth the arc" request to a style that wants a broken or mechanical path'],
    roblox_considerations: 'None beyond the FK chain already modelled.',
    performance_implications: 'None.',
    examples: ['a hand tracing a clean sweep through a punch', 'a mechanical arm moving in straight, cornered segments by design'],
    evidence_status: 'directive text (Part 26.7) plus real curvature measurement (MOT-005, `partial` — measured, not editable)',
  },
  {
    concept: 'secondary_action',
    category: 'essential',
    definition: 'Motion that supports the primary action without competing with it — head movement, breathing, cloth, facial reaction, hand adjustment, dust, ambient particles, camera response.',
    purpose: 'Add richness and storytelling without distracting from what the shot is actually about.',
    visible_effect: 'A subordinate motion running alongside the primary one, timed so it reinforces rather than draws focus.',
    psychological_or_gameplay_effect: 'Done well, deepens the read of the primary action; done badly, becomes visual noise or a performance budget cost.',
    physical_interpretation: 'Whatever the secondary element itself represents — cloth, breath, a VFX puff — no single physical model applies.',
    use_cases: ['a character reacting with a head-turn while the body performs the primary action', 'ambient dust or particle response to a heavy footstep'],
    non_use_cases: ['adding secondary motion that competes with or obscures the primary action — precisely Part 26.8\'s central question', 'a performance-budget-constrained shot where the secondary element is not essential storytelling'],
    interactions: ['Staging — secondary action is staging\'s most common failure point when it grows too large', 'Timing — must not run at a moment that competes with the primary action\'s own key beats'],
    style_variations: {},
    cadence_representation: 'No dedicated representation. `ai/vfxspec.js`\'s `role: secondary` (Part 38 hierarchy) is the nearest existing mechanism, and it only covers VFX items, not character-side secondary motion (breathing, head reaction) — Cadence has no facial or breathing rig concept at all (see Part 34, out of scope for this Roblox-body-rig build).',
    control_surface: 'VFX `role` field via `compile_effect`; nothing for character-side secondary motion.',
    detection_and_measurement_methods: 'None — "does this reinforce or distract" is a judgement this build does not attempt to measure.',
    generation_or_modification_methods: 'None beyond the VFX hierarchy budget share already covered under staging.',
    failure_modes: ['secondary motion growing large enough to compete with the primary action', 'VFX clutter from too many simultaneous secondary effects'],
    roblox_considerations: 'None specific.',
    performance_implications: 'A secondary VFX layer does carry a real particle budget cost, which `ai/vfxspec.js` accounts for via its hierarchy share.',
    examples: ['dust kicked up by a heavy landing, timed just after the primary impact', 'a character\'s off-hand adjusting a grip while the main arm swings'],
    evidence_status: 'directive text (Part 26.8) only; no measurement exists for character-side secondary motion',
  },
  {
    concept: 'timing',
    category: 'essential',
    definition: 'The placement and duration of every phase, hold, and pause — controls meaning, not merely speed: mass, intention, emotion, surprise, hesitation, confidence, impact, rhythm, responsiveness.',
    purpose: 'Carry meaning through WHEN things happen, independent of how far they move.',
    visible_effect: 'Phase durations, held frames, pauses, and the relative timing between body regions, camera, VFX, and audio.',
    psychological_or_gameplay_effect: 'The most semantically loaded of the twelve principles — the same pose sequence reads completely differently at different timings.',
    physical_interpretation: 'Directly measurable as frame counts and durations; the MEANING attached to a given duration is not physical at all.',
    use_cases: ['every motion — Part 26.9 treats timing as universal, like staging'],
    non_use_cases: ['none stated — like staging, this is treated as always relevant, only its EXPRESSION varies by style'],
    interactions: ['Spacing — Part 26.9 explicitly separates timing (WHEN) from spacing (curve shape), which slow-in/slow-out covers', 'Camera, VFX, and audio relative timing are named in Part 26.9\'s list and are exactly what `ai/events.js`\'s shared shot-event timeline (Phase 6) exists to check for co-timing and overlap'],
    style_variations: { game_combat: 'timing is bounded by input responsiveness before anything else', anime: 'holds and freezes are legitimate timing choices, not gaps' },
    cadence_representation: 'The most thoroughly represented principle in this table: `ai/cal.js PHASE_NAMES` and `ai/plan.js segmentPhases` structure a motion into phases; `body_lead` and `secondary_delay` vocabulary dimensions edit relative timing; `ai/events.js` measures co-timing and overlap across items; `ai/motion.js` measures onset/peak per joint.',
    control_surface: '`body_lead`, `secondary_delay` vocabulary dimensions; `list_shot_events` / `describe_shot` for cross-item timing; `analyze_motion` for per-joint onset/peak.',
    detection_and_measurement_methods: 'Real, in several places: phase segmentation from key/marker evidence, per-joint onset/peak timing, and shot-event overlap/concurrency.',
    generation_or_modification_methods: '`body_lead` orders per-joint key offsets by chain depth (a MOVES-keys dimension); `secondary_delay` likewise.',
    failure_modes: ['uniform timing across a chain that should show lead/lag', 'timing decisions made without reference to the declared action type or emotional intent'],
    roblox_considerations: 'None beyond the fps/frame model already shared with the rest of Cadence.',
    performance_implications: 'None.',
    examples: ['a held beat before a reveal', 'staggered per-joint onset down a whip-crack chain'],
    evidence_status: 'directive text (Part 26.9) plus multiple real measurements across Phases 3, 5 and 6',
  },
  {
    concept: 'exaggeration',
    category: 'essential',
    definition: 'Selecting and amplifying the important visual facts of an action — never "increase every value."',
    purpose: 'Make the significant part of an action read clearly by amplifying it while keeping something else restrained for contrast.',
    visible_effect: 'One or a few dimensions (pose, timing, spacing, arc, silhouette, camera, VFX, or sound) amplified while others stay controlled.',
    psychological_or_gameplay_effect: 'Done selectively, increases clarity and impact; done uniformly, flattens the hierarchy and reads as generic "more animated."',
    physical_interpretation: 'Not physical — a selection-and-amplification discipline.',
    use_cases: ['a heavy or powerful action wanting a clearly readable peak', 'a stylized shot (anime, cartoon) where exaggeration is the dominant idiom'],
    non_use_cases: ['amplifying every dimension at once, which the directive explicitly calls the failure mode (Part 26.10) — "power is not \'make everything bigger\'" is stated almost verbatim in `ai/vocabulary.js`\'s "powerful" term', 'a realistic or mechanical style, where restraint is closer to the point'],
    interactions: ['Directly opposed to uniform amplitude scaling — the same warning appears independently in `ai/vocabulary.js`\'s "powerful" and "subtle" term cards, which is evidence this principle was already being informally applied before this entry existed to name it'],
    style_variations: { anime: 'exaggeration is close to the default idiom', realistic: 'restrained to near-zero outside a deliberately dramatic beat' },
    cadence_representation: 'Indirect: `ai/vocabulary.js`\'s `motion_amplitude` dimension is the literal lever, and several terms\' `pinned_zero` fields ("powerful" pins `amplitude_alone` with the exact Part 26.10 warning) already encode the non-use case — but nothing decides WHICH dimension to exaggerate versus hold restrained; that selection is left to the vocabulary\'s pre-authored term cards, not a general reasoning step.',
    control_surface: '`motion_amplitude` vocabulary dimension.',
    detection_and_measurement_methods: 'None dedicated — `ai/motion.js` measures amplitude-adjacent quantities (peak speed, acceleration) but nothing judges whether amplification was SELECTIVE versus uniform.',
    generation_or_modification_methods: '`motion_amplitude` scales every keyed rotation delta about the phase-entry pose uniformly across the whole target — which is itself a limitation worth naming: the compiler cannot yet exaggerate one joint while restraining another within a single request.',
    failure_modes: ['raising every amplitude at once, discarding the contrast that makes the exaggerated part legible (the exact failure `ai/vocabulary.js` "powerful" already warns about)', 'exaggerating a dimension the declared style restrains'],
    roblox_considerations: 'None specific.',
    performance_implications: 'None.',
    examples: ['a wide wind-up with a restrained follow-through, so the wind-up reads as the exaggerated beat', 'a single dramatic pose held while everything around it stays subdued'],
    evidence_status: 'directive text (Part 26.10); consistent with pre-existing `pinned_zero` warnings in `ai/vocabulary.js`, but no automated selectivity check exists',
  },
  {
    concept: 'structural_understanding',
    category: 'essential',
    definition: 'Body mechanics, volume, balance, and proportion — whether a pose is physically and structurally credible for the rig and style.',
    purpose: 'Keep a pose readable and physically coherent rather than merely visually interesting.',
    visible_effect: 'A pose with a clear silhouette, no confusingly merged limbs, and credible balance for the character\'s stance.',
    psychological_or_gameplay_effect: 'A structurally broken pose reads as wrong even to a viewer who cannot say why.',
    physical_interpretation: 'Balance (centre of mass over a base of support) and volume — Cadence models neither.',
    use_cases: ['any pose intended to read as physically grounded'],
    non_use_cases: ['abstract, magical, or nonhuman motion that deliberately breaks structural expectation (horror/fantasy styles)'],
    interactions: ['Contacts — a structurally credible stance usually implies a consistent contact (MOT-008 measures the contact side, not the balance side)', 'Rig validation (`ai/riggraph.js`) checks STRUCTURE of the rig itself, not the pose applied to it — a different, adjacent concern'],
    style_variations: { horror: 'altered biomechanics are an explicit, permitted exception' },
    cadence_representation: 'Rig-level structural validation exists and is real (`ai/riggraph.js validateRig` — root, cycles, duplicate motors, orphans, rest-pose consistency, mirror completeness). POSE-level structural judgement (does THIS pose have credible balance and volume) does not exist — `ai/index.js capabilities().cannot` already names "balance and centre of mass (part mass is unknown)" as absent.',
    control_surface: '`inspect_rig` for rig-structure validation; nothing for pose-level balance.',
    detection_and_measurement_methods: 'Rig structure: real, in `validateRig`. Pose balance: none — part mass is unknown, so a centre-of-mass computation cannot be built honestly.',
    generation_or_modification_methods: 'None for pose-level structural correction.',
    failure_modes: ['a pose that violates the rig\'s own limb lengths or joint limits — partially caught by `ai/constraints.js` where `joint_limits` are declared, `null` otherwise (never assumed unlimited)', 'silhouette-merging limbs, not currently detected'],
    roblox_considerations: 'None beyond the Motor6D rig model already shared across this codebase.',
    performance_implications: 'None.',
    examples: ['a stance whose weight visibly sits over the planted foot', 'a pose where the off-hand silhouette merges confusingly with the torso'],
    evidence_status: 'directive text (Part 26.11) plus real rig-structure validation; pose-level structural judgement is a named, unaddressed gap',
  },
  {
    concept: 'appeal',
    category: 'essential',
    definition: 'Clarity, personality, intentional design, rhythm, and a coherent relationship between pose and character — not a generic beauty score.',
    purpose: 'Make a character or action feel deliberately designed and expressive of who or what it is, rather than merely technically correct.',
    visible_effect: 'A pose with a readable line of action, purposeful asymmetry, and a clear relationship to the character\'s established personality.',
    psychological_or_gameplay_effect: 'Distinguishes animation that feels authored from animation that is merely mechanically valid.',
    physical_interpretation: 'None — a design and character-specific judgement, explicitly not physical.',
    use_cases: ['any character-driven pose or action'],
    non_use_cases: ['reducing this to a generic, character-independent "looks nice" metric — Part 26.11\'s own warning: "It is character- and style-specific"'],
    interactions: ['Structural understanding — the two halves of Part 26.11 are related but distinct: one is mechanical credibility, the other is design intent', 'Character-level memory (MEM-001\'s `character_rules` scope) is the natural place a specific character\'s appeal conventions would live, once observed and evidenced'],
    style_variations: {},
    cadence_representation: 'None. This is the single most subjective principle in the table and this build states that plainly rather than approximating it — there is no line-of-action measurement, no personality model, and no character-specific appeal record (MEM-001\'s `character_rules` scope exists structurally but nothing has populated one yet).',
    control_surface: 'None.',
    detection_and_measurement_methods: 'None, and none is claimed. Part 13\'s certainty taxonomy would label any attempted appeal judgement `subjective`, and Part 13 forbids automatically acting on a subjective finding — so this entry\'s honest position is that appeal should reach a human, not a verdict.',
    generation_or_modification_methods: 'None.',
    failure_modes: ['treating appeal as generically maximisable, rather than specific to the character being animated'],
    roblox_considerations: 'None.',
    performance_implications: 'None.',
    examples: ['a villain whose silhouette is deliberately asymmetric to read as unsettling', 'a mascot character whose poses stay rounded and open to read as friendly'],
    evidence_status: 'directive text only (Part 26.11); this build claims no measurement and none is planned without a character-specific evidence trail (see ai/memory.js character_rules)',
  },
];

// `touches_aspects` is derived rather than hand-listed per entry, to keep it honest against
// `ai/constraints.js ASPECTS` if that vocabulary ever changes: an entry's aspects are inferred from
// which vocabulary dimensions its Cadence representation actually names, via the same
// `dimensionAspects` mapping the constraint system itself uses. Entries with no live dimension
// (pose_workflow, secondary_action, structural_understanding, appeal) get an empty list, which is
// the honest answer — they touch nothing this build can check a lock against.
import { dimensionAspects } from './vocabulary.js';

const DIMENSION_BY_CONCEPT = Object.freeze({
  squash_stretch: ['motion_amplitude', 'weight_transfer'],
  anticipation: ['anticipation_depth'],
  follow_through_overlap: ['secondary_delay'],
  slow_in_slow_out: ['acceleration_contrast', 'spacing_evenness'],
  timing: ['body_lead', 'secondary_delay'],
  exaggeration: ['motion_amplitude'],
});

function touchesAspects(concept) {
  const dims = DIMENSION_BY_CONCEPT[concept] || [];
  const aspects = new Set();
  for (const d of dims) for (const a of dimensionAspects(d)) aspects.add(a);
  return [...aspects];
}

export const KNOWLEDGE_ENTRIES = Object.freeze(
  ENTRY_LIST.map((e) => Object.freeze({ ...e, touches_aspects: touchesAspects(e.concept) })),
);

export const KNOWLEDGE_BY_CONCEPT = Object.freeze(Object.fromEntries(KNOWLEDGE_ENTRIES.map((e) => [e.concept, e])));

/** The twelve, plus whatever the user has loaded from disk (see registerUserEntries below). Every
 *  entry carries `source`, because "this is one of the classical twelve" and "this is something a
 *  session wrote down after watching a video" are different claims about the same shape. */
export function listKnowledge({ category = null, includeUser = true } = {}) {
  const builtin = KNOWLEDGE_ENTRIES.map((e) => ({ ...e, source: 'builtin' }));
  const all = includeUser ? [...builtin, ...USER_ENTRIES] : builtin;
  return all.filter((e) => !category || e.category === category);
}

export function getKnowledge(concept) {
  if (KNOWLEDGE_BY_CONCEPT[concept]) return { ...KNOWLEDGE_BY_CONCEPT[concept], source: 'builtin' };
  const u = USER_ENTRIES.find((e) => e.concept === concept);
  return u ? { ...u } : null;
}

export function knowledgeFieldList() {
  return [...FIELDS];
}

// ---------------------------------------------------------------- KNW-004: Principle Interaction Graph (Part 71)

/** Exactly Part 71's own example list, each with a short note on how the pair actually shows up in
 *  this codebase where that is known. This is `partial`, not `implemented`: Part 71 asks for a
 *  graph that can be TRAVERSED to answer "does this conflict with that", and this is the pair list
 *  the graph would be built from, not a traversal engine — the relevance gate below answers a
 *  narrower, directly computable version of the same question instead of pretending to walk this
 *  graph. */
export const INTERACTION_GRAPH = Object.freeze([
  { a: 'timing', b: 'slow_in_slow_out', note: 'Part 26.9 draws the line between them explicitly: timing is WHEN, spacing/curve is the shape of getting there.' },
  { a: 'timing', b: 'squash_stretch', note: 'weight is expressed jointly through timing (contrast) and pose deformation; the vocabulary\'s `weight_transfer` and `acceleration_contrast` dimensions both serve "heavy".' },
  { a: 'anticipation', b: 'exaggeration', note: 'anticipation is one of the phases exaggeration most commonly amplifies, per `ai/vocabulary.js` "powerful"\'s pull on `anticipation_depth`.' },
  { a: 'anticipation', b: 'timing', note: 'Part 26.2: readability depends on anticipation duration relative to the action\'s own duration.' },
  { a: 'follow_through_overlap', b: 'timing', note: 'measured directly — `ai/motion.js analyseChain` reports lead/lag as a timing offset, not a separate quantity.' },
  { a: 'staging', b: 'follow_through_overlap', note: 'not modelled: whether secondary motion or VFX obscures the primary action is a staging question this build cannot answer (no camera/occlusion model for character-side motion).' },
  { a: 'secondary_action', b: 'staging', note: 'Part 26.8\'s central question IS a staging question — whether the secondary action competes with the primary one.' },
  { a: 'arcs', b: 'structural_understanding', note: 'an arc that passes through an anatomically implausible intermediate pose is both problems at once; neither check currently cross-references the other.' },
  { a: 'exaggeration', b: 'squash_stretch', note: 'squash/stretch is one of exaggeration\'s listed target aspects (Part 26.10\'s own list).' },
  { a: 'appeal', b: 'structural_understanding', note: 'Part 26.11 groups these as one section for exactly this reason — they are the two halves of the same classical principle.' },
]);

export function interactionsFor(concept) {
  return INTERACTION_GRAPH.filter((p) => p.a === concept || p.b === concept)
    .map((p) => ({ other: p.a === concept ? p.b : p.a, note: p.note }));
}

// ---------------------------------------------------------------- KNW-005: the relevance gate (Part 71)
//
// Part 71 lists nine questions to ask before applying an advanced or optional technique. This build
// can compute real answers to some of them and cannot honestly compute others — Part 4.7's rule
// ("a missing capability is named, not hidden") applies here as much as anywhere else in this
// layer. Each question below is `answerable: true` ONLY when a real signal backs it; the rest carry
// `answerable: false` and a stated reason, and the verdict is built ONLY from what was answered.

const QUESTIONS = Object.freeze([
  'Does it serve the stated intent?',
  'Does it improve readability?',
  'Does it improve physicality or style?',
  'Does it conflict with key poses, contacts, timing, camera, or VFX?',
  'Does it add visual noise?',
  'Does it create technical complexity or performance cost without value?',
  'Does it violate user constraints?',
  'Is there evidence that a simpler intervention would solve the issue?',
  'Can its result be evaluated and rolled back?',
]);

/**
 * Part 71's nine-question gate, run for one knowledge entry against a context.
 *
 * @param context.intent        free text or an IntentSpec-shaped object naming the action/purpose
 * @param context.style         a style profile name (ai/style.js STYLE_PROFILES)
 * @param context.lockedAspects aspects (`ai/constraints.js ASPECTS`) currently locked or otherwise
 *                               protected on the target — from `inspect_constraints`
 *
 * Every question the caller did not supply enough context to answer is marked `answerable: false`
 * rather than guessed. This mirrors `ai/certainty.js coverage.notRun` — a gate that silently
 * skipped a question would look like it cleared the technique.
 */
export function evaluateRelevance(concept, context = {}) {
  const entry = getKnowledge(concept);
  if (!entry) throw new TypeError(`evaluateRelevance: "${concept}" is not a known knowledge entry — see KNOWLEDGE_ENTRIES`);

  const q = (n, answerable, answer, why) => ({ n, question: QUESTIONS[n - 1], answerable, answer: answerable ? answer : null, why });
  const questions = [];

  // 1. serves the stated intent
  if (context.intent) {
    const text = String(context.intent).toLowerCase();
    const hitsUse = entry.use_cases.some((u) => text.includes(String(u).toLowerCase().split(' ')[0]));
    const hitsNonUse = entry.non_use_cases.some((u) => text.split(/\W+/).some((w) => w.length > 3 && String(u).toLowerCase().includes(w)));
    questions.push(q(1, true, hitsNonUse ? 'the stated intent resembles a declared non-use case' : (hitsUse ? 'the stated intent matches a declared use case' : 'no declared use or non-use case was matched; not evidence either way'),
      'matched against this entry\'s own use_cases/non_use_cases text'));
  } else {
    questions.push(q(1, false, null, 'no `context.intent` was supplied — this build does not guess an unstated intent'));
  }

  // 2. readability — not measurable in this build at all
  questions.push(q(2, false, null, 'no readability metric exists anywhere in ai/ — silhouette pixels are measured (Phase 4) but nothing judges "readable"'));

  // 3. physicality or style
  if (context.style) {
    const caution = entry.non_use_cases.find((u) => String(u).toLowerCase().includes(String(context.style).toLowerCase()));
    questions.push(q(3, true, caution ? `this entry names "${context.style}" as (or within) a non-use case: ${caution}` : `no stated conflict between this entry and "${context.style}"`,
      'matched against this entry\'s own style_variations/non_use_cases text'));
  } else {
    questions.push(q(3, false, null, 'no `context.style` was supplied'));
  }

  // 4 & 7. conflicts with a locked/protected aspect — the SAME underlying check for both questions
  // in this build, stated once rather than run twice and reported as if independent.
  if (Array.isArray(context.lockedAspects)) {
    const overlap = entry.touches_aspects.filter((a) => context.lockedAspects.includes(a));
    const conflictAnswer = overlap.length
      ? `touches locked aspect(s): ${overlap.join(', ')}`
      : 'no overlap between this entry\'s touched aspects and the locked/protected aspects supplied';
    questions.push(q(4, true, conflictAnswer, 'ai/constraints.js ASPECTS overlap between this entry\'s touched aspects and the caller-supplied locked aspects'));
    questions.push(q(7, true, conflictAnswer, 'the same aspect-overlap check as question 4 — Cadence has one mechanism (locks/constraints) for both questions, not two'));
  } else {
    questions.push(q(4, false, null, 'no `context.lockedAspects` was supplied — call inspect_constraints first'));
    questions.push(q(7, false, null, 'no `context.lockedAspects` was supplied — call inspect_constraints first'));
  }

  // 5. visual noise — no budget/noise model outside VFX, and this entry is not itself a VFX spec
  questions.push(q(5, false, null, 'no visual-noise or attention-budget model exists for non-VFX techniques in this build'));

  // 6. technical complexity / performance cost
  questions.push(q(6, false, null, 'no performance-cost model exists in ai/ — keyframe edits of this kind carry no measured cost, but nothing computes one either way'));

  // 8. a simpler intervention — Part 71 itself resolves uncertainty here by asking a human, not by
  // computing an answer, so this is always surfaced as a question rather than guessed.
  questions.push(q(8, false, null, 'Part 71 answers uncertainty here by requesting user judgment, not by computing one — this build does the same'));

  // 9. can it be evaluated and rolled back — ALWAYS true and ALWAYS answerable, because it is an
  // architectural guarantee, not a per-technique judgement: every mutating semantic tool commits
  // through ai/patch.js, verified against a predicted hash, with a transaction ledger behind it.
  questions.push(q(9, true, 'yes — every mutation in this build commits through the transactional patch system (ai/patch.js) and is rollback-capable by construction', 'architectural: apply_animation_patch / rollback_transaction'));

  // Looked up by question NUMBER, not array position — q4 and q7 are pushed adjacently above and
  // do not land at index 3/6, so indexing positionally here was a real bug caught before it shipped.
  const byN = (n) => questions.find((x) => x.n === n);
  const answered = questions.filter((x) => x.answerable);
  const q1 = byN(1), q3 = byN(3), q4 = byN(4), q7 = byN(7);
  const certainConflict = (q4.answerable && /touches locked/.test(q4.answer)) || (q7.answerable && /touches locked/.test(q7.answer));
  const styleCaution = q3.answerable && /non-use case/.test(q3.answer || '');
  const intentMismatch = q1.answerable && /resembles a declared non-use case/.test(q1.answer || '');

  let verdict;
  if (certainConflict) verdict = 'not_recommended';
  else if (styleCaution || intentMismatch) verdict = 'caution';
  else if (answered.length <= 1) verdict = 'insufficient_evidence'; // question 9 alone is never enough
  else if (q1.answerable) verdict = 'recommended';
  else verdict = 'insufficient_evidence';

  return {
    concept,
    verdict,
    questions,
    answered_count: answered.length,
    of_nine: 9,
    unanswerable: questions.filter((x) => !x.answerable).map((x) => ({ n: x.n, question: x.question, why: x.why })),
    note: 'the verdict is built only from ANSWERABLE questions; an unanswered question is never treated as a pass',
  };
}

// ---------------------------------------------------------------- KNW-006: controlled expansion (Part 72)

/** Part 72's ten steps, verbatim in structure. This is process documentation, not an automated
 *  pipeline — steps 1-4 (identify, categorise, research, compare) are judgement calls a session
 *  makes, not something code can perform. What CAN be enforced is the SHAPE a new entry must have
 *  before it is added (steps 5-9), which `validateProposedEntry` below does — the honest split
 *  between what this file automates and what it only documents. */
export const EXPANSION_PROCEDURE = Object.freeze([
  'identify the missing knowledge or missing representation',
  'determine whether the issue is fundamental, advanced, optional, specialized, or experimental',
  'research authoritative sources or inspect existing project examples',
  'compare practical approaches',
  'document the concept using the knowledge-entry structure',
  'create a minimal example',
  'create an evaluation method',
  'test it in an isolated setting',
  'add it to the relevant knowledge scope only when justified',
  'preserve evidence and a rollback path',
]);

/**
 * Enforce Part 72 steps 5-9's SHAPE requirement on a proposed entry: every Part 25 field present
 * and non-empty, a stated category, at least one example, and an evidence_status that is not a
 * placeholder. Does not judge whether the CONTENT is good — only that nothing was skipped, which is
 * exactly what "do not permanently add unverified claims... to project memory" (Part 72's own
 * closing line) needs as a first, mechanical gate.
 */
export function validateProposedEntry(entry) {
  const problems = [];
  for (const f of FIELDS) {
    // An empty `style_variations` is a legitimate answer — "this principle carries no
    // style-specific note" — the same way `pinned_zero` can be empty in ai/vocabulary.js.
    if (f === 'style_variations') continue;
    const v = entry?.[f];
    const empty = v === null || v === undefined || v === ''
      || (Array.isArray(v) && v.length === 0)
      || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
    if (empty) problems.push(`missing or empty field: ${f}`);
  }
  if (entry?.category && !CATEGORIES.includes(entry.category)) problems.push(`category "${entry.category}" is not one of ${CATEGORIES.join(', ')}`);
  if (entry?.detection_and_measurement_methods && /^(tbd|todo|none yet)$/i.test(String(entry.detection_and_measurement_methods).trim())) {
    problems.push('detection_and_measurement_methods is a placeholder, not an honest answer — say "none" and why, per Part 4.7, rather than deferring it');
  }
  return { ok: problems.length === 0, problems, checked_fields: FIELDS.length };
}

// ---------------------------------------------------------------- the user's own entries (on disk)
//
// The twelve above are compiled reference data and stay that way. What was missing is everywhere
// else knowledge comes from — a video a session watched, a technique the user proved on a shot —
// and it had nowhere to live: `ai/memory.js` is per-project, and a knowledge entry is not project
// data. These entries live in the app's user-data folder (`library/knowledge/*.json`), beside the
// motion library and outside any `.cadence` file, and `src/main.js` reads them at startup. They
// arrive here through `registerUserEntries`, which is the ONLY door: every file goes through Part
// 72's shape gate on the way in, and a refused file is named with the field that failed rather
// than loaded with a hole in it.
//
// Two rules that are enforced rather than documented:
//
//   * **A user entry may not shadow a classical principle.** The same concept name as one of the
//     twelve is refused, not overridden. A project-specific exception to "arcs" belongs in
//     `ai/memory.js`'s `project_conventions`, where it carries evidence and is scoped to the
//     project that earned it; silently replacing a compiled card would change what every other
//     session, in every other project, is told.
//   * **Nothing here is applied to any animation.** A knowledge entry is cited, never executed —
//     the same standing as the twelve. `knowledgeChecks` below is the only path from an entry to a
//     number, and it can only reach measurements `ai/motion.js` already makes.

let USER_ENTRIES = [];

/**
 * Load entries from disk through the Part 72 gate.
 *
 * @param files `[{ name, entry }]` — the filename is carried so a refusal can name the file.
 * @param opts.replace  true (the default) reloads the whole set, which is what startup does;
 *                      false appends, which is what `propose_knowledge_entry` does.
 */
export function registerUserEntries(files, { replace = true } = {}) {
  const accepted = [], refused = [], alreadyBuiltin = [];
  const next = replace ? [] : [...USER_ENTRIES];
  for (const f of files || []) {
    const entry = f?.entry ?? f;
    const name = f?.name ?? entry?.concept ?? '(unnamed)';
    const v = validateProposedEntry(entry);
    if (!v.ok) { refused.push({ file: name, concept: entry?.concept ?? null, problems: v.problems }); continue; }
    if (KNOWLEDGE_BY_CONCEPT[entry.concept]) {
      // The repo seed (docs/animation-intelligence/knowledge/*.json) carries the twelve as data,
      // so a startup load legitimately meets each of them again. That is a no-op, not a refusal:
      // reporting twelve "refused" files every launch would bury a real one. A user entry that
      // genuinely tried to REPLACE a principle lands in the same bucket — which is the point: the
      // compiled card wins, and the loader says which files it ignored rather than going quiet.
      alreadyBuiltin.push({ file: name, concept: entry.concept, note: 'already one of the twelve compiled classical principles — the compiled card wins; a project-specific exception belongs in ai/memory.js project_conventions, scoped and evidenced' });
      continue;
    }
    const clash = next.find((e) => e.concept === entry.concept);
    if (clash) { refused.push({ file: name, concept: entry.concept, problems: [`"${entry.concept}" was already loaded from ${clash.source_file ?? 'another file'}`] }); continue; }
    next.push({ ...entry, source: 'user', source_file: name });
    accepted.push({ file: name, concept: entry.concept, category: entry.category, evidence_status: entry.evidence_status });
  }
  USER_ENTRIES = next;
  return { accepted, refused, already_builtin: alreadyBuiltin, loaded: USER_ENTRIES.length };
}

export function userKnowledgeEntries() { return USER_ENTRIES.map((e) => ({ ...e })); }

export function clearUserKnowledge() { const n = USER_ENTRIES.length; USER_ENTRIES = []; return n; }

/**
 * Part 72's own closing requirement, applied to the CONTENT of the evidence rather than only its
 * presence: a new entry's `evidence_status` must name where the claim came from — a video URL with
 * a timestamp, a directive part, or a measurement this build made. "experimental" alone is a
 * status, not evidence, and Part 72 forbids permanently adding unverified claims.
 *
 * Separate from `validateProposedEntry` on purpose: the shape gate is what every entry must pass
 * to be LOADED, and this is the extra bar a NEW entry must clear to be written. The twelve
 * classical principles cite the directive and pass it too, which is the check that keeps this
 * honest rather than merely strict.
 */
export function validateEvidenceSource(entry) {
  const s = String(entry?.evidence_status ?? '');
  const sources = [];
  if (/https?:\/\/\S+/.test(s)) sources.push('a URL');
  if (/\b\d{1,2}:\d{2}\b/.test(s)) sources.push('a timestamp');
  if (/part\s*\d+/i.test(s)) sources.push('a directive part');
  if (/\b(measured|measurement|benchmark|smoketest|aitest)\b/i.test(s)) sources.push('a measurement in this build');
  const ok = sources.length > 0;
  return {
    ok,
    sources,
    problem: ok ? null : 'evidence_status names no source. Part 72 step 3 asks for authoritative sources or an inspected project example: cite a video URL with a timestamp, a directive part number, or a measurement this build made.',
  };
}

// ---------------------------------------------------------------- KNW-003: from an entry to a real measurement
//
// Every entry's `detection_and_measurement_methods` field is prose. This is the machine-readable
// half: which `ai/motion.js MEASUREMENTS` key, if any, actually backs it. A concept with no key is
// reported `not_measured` with its own reason — never a check that returns a number nothing
// computed. `implemented` is READ from `MEASUREMENTS` rather than asserted here, so a measurement
// that lands in a later phase flips this registry without anybody remembering to.
//
// A user entry declares its own keys in an optional `measurement_keys` field (not one of Part 25's
// twenty, so its absence never fails the shape gate) — an entry that names none is honest prose
// with no check behind it, which is the normal case and is reported as such.

export const DETECTION_MEASUREMENTS = Object.freeze({
  timing: ['key_density', 'linear_velocity'],
  anticipation: ['linear_velocity', 'angular_velocity'],
  slow_in_slow_out: ['acceleration', 'interpolation_type'],
  arcs: ['path_curvature'],
  follow_through_overlap: ['relation_to_motion_graph_parent'],
  secondary_action: ['relation_to_motion_graph_parent'],
  exaggeration: ['angular_velocity'],
  pose_workflow: ['key_density'],
  // Named with an empty list rather than omitted: these four have no measurement in this build at
  // all, and the empty array is the declaration that somebody checked.
  squash_stretch: [],
  staging: [],
  appeal: [],
  structural_understanding: [],
});

/**
 * The checks a review can actually run for a set of concepts, and the ones it cannot.
 *
 * `measurements` is `ai/motion.js MEASUREMENTS`, passed in rather than imported so this stays a
 * pure mapping a test can feed a hypothetical table. `sampled` is an optional `sampleMotion`
 * result; with one, each runnable check carries the value it measured, and without one the result
 * says what WOULD run.
 */
export function knowledgeChecks(measurements, { concepts = null, sampled = null } = {}) {
  const all = [...KNOWLEDGE_ENTRIES, ...USER_ENTRIES];
  const wanted = concepts ? all.filter((e) => concepts.includes(e.concept)) : all;
  const runnable = [], notMeasured = [];
  for (const e of wanted) {
    const keys = e.source === 'user' ? (e.measurement_keys || []) : (DETECTION_MEASUREMENTS[e.concept] || []);
    if (!keys.length) {
      notMeasured.push({
        concept: e.concept, source: e.source ?? 'builtin',
        why: e.source === 'user'
          ? 'the entry names no measurement_keys, so its detection method is prose only — add the ai/motion.js MEASUREMENTS keys that back it to make it runnable'
          : `no measurement in this build detects it: ${e.detection_and_measurement_methods}`,
      });
      continue;
    }
    const missing = keys.filter((k) => !measurements?.[k]?.implemented);
    if (missing.length) {
      notMeasured.push({
        concept: e.concept, source: e.source ?? 'builtin',
        why: `needs ${missing.join(', ')}, which ai/motion.js does not measure yet`,
        unblocked_by: missing.map((k) => measurements?.[k]?.unblocked_by ?? `${k} is not in MEASUREMENTS at all`),
      });
      continue;
    }
    const check = { concept: e.concept, source: e.source ?? 'builtin', measurements: keys, category: e.category };
    if (sampled) {
      // `key_density` describes the sampled RANGE, not a part, so it sits on the check rather
      // than being repeated identically on every row — a per-part field that is the same for
      // every part reads as a per-part measurement and is not one.
      if (keys.includes('key_density')) check.measured_over_range = { keys_per_frame: sampled.key_density?.keys_per_frame ?? null, total_keys: sampled.key_density?.total_keys ?? null, frames: sampled.range ?? null };
      check.measured = (sampled.subjects || []).map((s) => {
        const row = { part_id: s.part_id };
        if (keys.includes('linear_velocity')) row.peak_speed = s.summary?.peak_speed ?? null;
        if (keys.includes('angular_velocity')) row.peak_angular_speed_deg = s.summary?.peak_angular_speed_deg ?? null;
        if (keys.includes('path_curvature')) row.bow_studs = s.summary?.bow_studs ?? null;
        if (keys.includes('acceleration')) row.onset_frame = s.summary?.onset_frame ?? null;
        if (keys.includes('relation_to_motion_graph_parent')) row.peak_speed_frame = s.summary?.peak_speed_frame ?? null;
        return row;
      });
      // Part 4.5 again: this is what the principle POINTS AT, never a verdict on it.
      check.verdict = null;
      check.why_no_verdict = 'the measurement is reported; whether it satisfies the principle is a judgement no threshold in this build can make (Part 4.5 — and the entry\'s own style_variations is why there is no single right value)';
    }
    runnable.push(check);
  }
  return {
    runnable, not_measured: notMeasured,
    counts: { runnable: runnable.length, not_measured: notMeasured.length, total: wanted.length },
    note: 'a runnable check reports what the principle points at. Nothing here decides whether the principle is satisfied — there is no threshold for "enough anticipation", and each entry\'s style_variations is why.',
  };
}


// ---------------------------------------------------------------- KNW-007: the premium standard (Part 73)

/** Part 73's nineteen qualities, cross-referenced against what this build can actually check right
 *  now. `measured_by` names a real tool where one exists; `null` states plainly that nothing does.
 *  This reuses REV-001's own honest count rather than re-deriving a second, possibly disagreeing
 *  one — `review_shot`\'s Part 14 layers and these qualities overlap heavily but are not the same
 *  list, so each quality here is assessed independently against Cadence\'s real capability. */
export const PREMIUM_STANDARD = Object.freeze([
  { quality: 'clear intent', measured_by: 'interpret_intent (IntentSpec.confidence / unresolved_questions)', status: 'partial' },
  { quality: 'readable staging', measured_by: null, status: 'not_measured' },
  { quality: 'strong poses', measured_by: null, status: 'not_measured' },
  { quality: 'appropriate timing', measured_by: 'analyze_motion, review_shot (timing layer)', status: 'partial' },
  { quality: 'intentional spacing', measured_by: 'analyze_motion (acceleration/curvature)', status: 'partial' },
  { quality: 'convincing weight or purposeful nonphysicality', measured_by: 'analyze_contacts (contact drift), weight_transfer dimension', status: 'partial' },
  { quality: 'coherent mechanics', measured_by: 'inspect_rig (validateRig)', status: 'partial' },
  { quality: 'meaningful anticipation', measured_by: 'analyze_motion (phase onset/peak)', status: 'partial' },
  { quality: 'satisfying impact', measured_by: 'analyze_contacts, list_shot_events', status: 'partial' },
  { quality: 'controlled follow-through', measured_by: 'analyze_motion (analyseChain lead/lag)', status: 'partial' },
  { quality: 'relevant secondary motion', measured_by: null, status: 'not_measured' },
  { quality: 'camera support', measured_by: null, status: 'not_measured' },
  { quality: 'coherent VFX', measured_by: 'validate_effect_timing', status: 'partial' },
  { quality: 'appropriate lighting and compositing', measured_by: null, status: 'not_measured' },
  { quality: 'absence of distracting technical artifacts', measured_by: 'explain_motion_problem (unclassified discontinuities), review_shot', status: 'partial' },
  { quality: 'stylistic consistency', measured_by: 'style_profile (declared style) — no drift-over-time check exists yet', status: 'partial' },
  { quality: 'purposeful detail', measured_by: null, status: 'not_measured' },
  { quality: 'reliable reproducibility', measured_by: 'apply_animation_patch (hash-verified commit)', status: 'implemented' },
  { quality: 'respect for constraints and user ownership', measured_by: 'inspect_constraints, lock_constraint, operating_modes', status: 'implemented' },
]);

export function evaluatePremiumCoverage() {
  const counts = { implemented: 0, partial: 0, not_measured: 0 };
  for (const q of PREMIUM_STANDARD) counts[q.status]++;
  return {
    qualities: PREMIUM_STANDARD.map((q) => ({ ...q })),
    counts,
    total: PREMIUM_STANDARD.length,
    definition: 'Part 73: "Cadence must define premium animation as purposeful quality, not maximum complexity... Complexity is optional. Quality is mandatory."',
  };
}

export function knowledgeLimitations() {
  return [
    'KNW-004 (Principle Interaction Graph) is a pair LIST with notes, not a traversal engine — the relevance gate answers a narrower, directly computable question instead of walking this graph.',
    'KNW-005\'s gate answers only what the caller supplies context for; readability, visual noise, and performance cost are never computed (no model exists for any of the three) and always report as unanswerable rather than guessed.',
    'KNW-006\'s procedure is documented in full (EXPANSION_PROCEDURE) and its shape gate (validateProposedEntry) plus its evidence gate (validateEvidenceSource) are automated and are what every entry written from disk must pass. Steps 1-4 — identify, categorise, research, compare — are still judgement calls a session makes; this file checks the result, never performs them.',
    'KNW-007\'s premium standard is a cross-reference against EXISTING tools, not a new measurement: 2 of 19 qualities are fully implemented, 9 partial, 8 have no measurement at all.',
    'The twelve classical-principle entries are code-level reference data and stay that way: they cannot be edited per-project the way ai/vocabulary.js terms can, and a user entry may not shadow one. A project-specific exception to a principle belongs in ai/memory.js\'s project_conventions or character_rules scope, evidenced.',
    'User entries live in the app\'s user-data folder and are loaded through registerUserEntries; this module never reads a file. An entry only exists for a session once something has handed it here, so a malformed file on disk is absent rather than half-present, and the load result names it.',
    'A knowledge entry is cited, never executed. knowledgeChecks is the only path from an entry to a number, it can only reach measurements ai/motion.js already makes, and it returns a measured value with an explicit null verdict — nothing in this build decides whether a principle is satisfied, because each entry\'s own style_variations says the right value differs by style.',
    '9 of the twelve concepts map to a real ai/motion.js measurement; squash_stretch, staging, appeal and structural_understanding map to none and say so (no scale signal, no camera model, no readability model, no balance-over-time model). A user entry maps to a measurement only if it declares measurement_keys — prose alone is prose.',
  ];
}
