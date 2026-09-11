# Watch list — 100 videos Claude learns animation from

Seeded 2026-09-11 from YouTube search (every entry is a real video found with `yt-dlp`; titles,
channels and durations are as published). This is the working checklist for the watch-and-learn
skill (`LEARNING_LOOP_PROMPT.md` §3C): watch in the order below, tick each one, and record next to
it the date and the knowledge entries or library clips it produced. The user adds links at the end.

**How to watch without burning the context.** A video costs frames, and frames are images in the
context. Use `/watch <url>` with the `transcript` detail for talks and analyses (sections C, D, F, G
are mostly words), and `balanced` only for tutorials that SHOW motion the transcript cannot carry
(sections A, B, E). Watch five to ten per session, write the entries as you go, and stop before the
context is heavy — the list is here so no session has to hold it in memory.

**What each section feeds.** A → the knowledge cards (`KNW`) and the planner's phase and easing
rules; B → pose, weight, contact and locomotion measurements (`MOT`, `PLAN`); C → what game
animation must do that film animation need not (readability, responsiveness, hit clarity); D → the
anime style profile (impact frames, smears, holds) and the review's stylisation rules; E → the
Roblox specifics: Moon Animator habits, rig limits, VFX and cutscene practice this tool replaces;
F → VFX timing, camera and curve craft (`VFX`, `SHOT`, easing); G → workflow, reference use and
critique — how a professional plans, blocks, splines and polishes, which is the shape of the
director's loop.

**Progress: 20 of 100 watched** (W01 + W02, both merged 2026-09-11 — 38 knowledge entries in
`knowledge/`, 30 `check:` lines and 7 capture candidates in [`LESSONS.md`](LESSONS.md)). W02
produced no capture candidates at all: every video in it was 2D hand-drawn or a screen
recording, with no performed 3D motion to track. A ticked line records the date, the batch, and
what that video produced.

Legend: `- [ ] n. Title — Channel (mm:ss) — url — what it should teach`

## A. Fundamentals — the twelve principles (16)

- [x] 1. 12 Principles of Animation (Official Full Series) — AlanBeckerTutorials (24:03) — https://youtu.be/uDqjIdI4bF4 — the canonical statement of all twelve; check every `ai/knowledge.js` card against it — **watched 2026-09-11 (W01)**: layered_anticipation, pose_hold_density, twinning
- [x] 2. TIMING - The 12 Principles of Animation in Games — New Frame Plus (9:38) — https://youtu.be/rHEJZXvFc5I — timing as meaning; what changes when a player is waiting on the frame — **watched 2026-09-11 (W01)**: startup_frame_budget, global_timing_register; 3 capture candidates
- [x] 3. ANTICIPATION - The 12 Principles of Animation in Games — New Frame Plus (7:52) — https://youtu.be/28s1Hv3Zqlo — anticipation versus responsiveness; when it must be short or hidden — **watched 2026-09-11 (W01)**: recovery_weight_substitution, implied_zero_frame_anticipation
- [x] 4. SQUASH & STRETCH - The 12 Principles of Animation in Games — New Frame Plus (8:19) — https://youtu.be/1kFRU_xBZnE — deformation as force on rigid game characters; pose-based equivalents — **watched 2026-09-11 (W01)**: motion_smear_readability; 2 capture candidates
- [x] 5. SLOW IN & SLOW OUT - The 12 Principles of Animation in Games — New Frame Plus (7:24) — https://youtu.be/3jNiNctcQ4c — easing as spacing, and when a sharp stop is right — **watched 2026-09-11 (W01)**: external_force_easing_override
- [x] 6. ARCS - The 12 Principles of Animation in Games — New Frame Plus (7:47) — https://youtu.be/lOzgxMgAnxQ — arcs on hands, weapons and cameras; when a straight path is intended — **watched 2026-09-11 (W01)**: arc_camera_angle_robustness, arc_trail_vfx_readability, cross_clip_arc_continuity; 1 capture candidate
- [x] 7. FOLLOW THROUGH & OVERLAPPING ACTION - The 12 Principles of Animation in Games — New Frame Plus (16:53) — https://youtu.be/rYtrV1lChsA — stop-time offsets across a chain; the `lead_lag` strategy's reference — **watched 2026-09-11 (W01)**: follow_through_backfill_hold, physics_sim_blend_seam_mitigation; 1 capture candidate
- [x] 8. The most important animation principle: An introduction on animation spacing and timing — Dong Chang (11:04) — https://youtu.be/vSJ5lT_ma-E — spacing charts; the `spacing_contrast` strategy's reference — **watched 2026-09-11 (W01)**: asymmetric_spacing_preference, mixed_hold_pacing_within_phase
- [x] 9. 3 Easy Ways to Master Animation Timing — Dong Chang (13:58) — https://youtu.be/13QIh7vsCpQ — practical timing rules a planner can encode as phase durations — **watched 2026-09-11 (W01)**: physical_reference_timing_method, vibe_timing_anti_pattern
- [x] 10. Animation basics: The art of timing and spacing - TED-Ed — TED-Ed (6:42) — https://youtu.be/KRVhtMxQWRs — the shortest correct explanation, for the knowledge card's definition — **watched 2026-09-11 (W01)**: material_properties_via_spacing_alone
- [x] 11. The #1 Animation Principle (How To In-Between) — NobleFrugal Studio (12:41) — https://youtu.be/6UXjRCORV44 — breakdowns and in-betweens; where a breakdown key belongs — **watched 2026-09-11 (W02)**: dps_floor_for_short_actions, spacing_subdivision_method_ladder
- [x] 12. Animation Principles / Everything Moves in Arcs / Animating Classic Motion — Russ Edmonds Animation (10:31) — https://youtu.be/thDT-4RjAeo — a Disney animator on arcs in practice — **watched 2026-09-11 (W02)**: discontinuity_concealment_via_visibility_gap, float_to_stop_settle, obscure_arcs
- [x] 13. Animating with Arcs — The Art of Aaron Blaise (6:03) — https://youtu.be/GHf8ie4Nq9Y — arc tracking on a real shot; the `bow_studs` measurement's meaning — **watched 2026-09-11 (W02)**: onion_skin_arc_verification
- [x] 14. 12 Principles of Animation - Follow Through and Overlapping Action Tutorial — Arree Chung (19:54) — https://youtu.be/t_gH-OADlSw — overlap on hair, cloth, props: the secondary-motion rules — **watched 2026-09-11 (W02)**: drag_overlap_follow_through_sequence, drag_stretch_coupling
- [x] 15. Should you PLAN your animation? — Alex Grigg // Animation for Anyone (5:01) — https://youtu.be/ABCUjauQBI4 — pose-to-pose planning; why the plan comes before the keys — **watched 2026-09-11 (W02)**: staged_keyframe_then_straight_ahead_workflow
- [x] 16. Easy animation with overshoot and anticipation - Blender Tutorial — Joey Carlino (10:27) — https://youtu.be/DLzcSSzVjeI — overshoot and settle as curve shapes; the `overshoot` strategy's reference — **watched 2026-09-11 (W02)**: chain_depth_proportional_secondary_delay, shared_mechanism_anticipation_overshoot

## B. Body mechanics, weight, posing, locomotion, combat (24)

- [x] 17. Body Mechanics - Maya Beginner's Animation Tutorial | In 5 simple steps — Learn CGI with Yawyee (23:22) — https://youtu.be/7CBcvu8HLEQ — the body-driven order: hips, torso, then limbs — **watched 2026-09-11 (W02)**: hip_rotation_balance_correction
- [x] 18. 3 Coco Animation Tips [On Body Mechanics] — Rusty Animator (10:26) — https://youtu.be/fFf8EsPC_ws — weight shift and counter-rotation on a feature character — **watched 2026-09-11 (W02)**: combined_hip_weight_bearing_posing, deliberate_lead_choice_for_acting, spine_curve_letter_shapes
- [x] 19. Animating HEAVY Weight (Objects, Punches, Throwing) — Sir Wade Neistadt (10:16) — https://youtu.be/ZYKAMCZq2UI — what "heavy" is made of: preparation, commitment, contrast, aftermath — **watched 2026-09-11 (W02)**: held_object_drag_frame_count, weight_then_strength_formula
- [x] 20. Weight in Animation (Tutorial) — Alessandro Camporota (12:39) — https://youtu.be/b3oIxjzdMqY — weight through timing and spacing, not through slowness — **watched 2026-09-11 (W02)**: differential_timing_not_uniform_slowness, lever_arm_dependent_drag
- [ ] 21. James Baxter on Weight and Balance — The SPA Studios (3:07) — https://youtu.be/EASbvJNQz0U — balance and centre of mass from a master animator
- [ ] 22. How to Animate Weight — AnimSchool (8:32) — https://youtu.be/0x9f21vFqcE — weight in a lift; contact and support relationships
- [ ] 23. How to use Line of Action for Better Poses — Character Design 360 (6:06) — https://youtu.be/P_BY38z-n4M — line of action as a measurable curve through the pose
- [ ] 24. Improve Your Animation! Good Posing vs Bad Posing | Animation Techniques — Foxy Fern Animation (9:07) — https://youtu.be/QCHSPSBmSHk — pose readability; what the review's pose layer should flag
- [ ] 25. Create BETTER animations using SILHOUETTES — Start Animating (10:12) — https://youtu.be/uwK0DFEbcCk — silhouette readability; the `MOT-012` measurement's target
- [ ] 26. Animating LEGS (Walk Cycles and Weight) — Doodley (11:25) — https://youtu.be/6lGPvMLE8Oo — contact, passing, up and down positions; planted-foot logic
- [ ] 27. how to animate a walk cycle (100% polish) — Alessandro Camporota (32:40) — https://youtu.be/ynXadXE9UjU — a full walk from blocking to polish; what polish adds
- [ ] 28. ALAN BECKER - Animating Walk Cycles — AlanBeckerTutorials (3:53) — https://youtu.be/2y6aVz0Acx0 — the four key positions, in three minutes
- [ ] 29. The COMPLETE Guide to Run Cycle Animation — owenferny (49:04) — https://youtu.be/7NkvAP3aqeo — run mechanics: flight phase, stride, pelvis and shoulder counter-motion
- [ ] 30. How to Animate Run Cycles — moderndayjames (11:41) — https://youtu.be/nKvBYXzRszw — run poses and spacing, compact
- [ ] 31. Jump Animation: The Complete Beginner's Guide — Plainly Simple (16:15) — https://youtu.be/n29cFugfM_c — anticipation, launch, flight, landing compression, recovery
- [ ] 32. Body Mechanics: Jumping and Landing — Animation Mentor (11:02) — https://youtu.be/VjRCxm8nrNE — landing weight and settle; the jump-and-landing benchmark category
- [ ] 33. How To Improve Idle Animations In Games — Libby Pete (6:11) — https://youtu.be/tYwNSm8Q3l8 — idle breathing and weight shift without noise; the idle category
- [ ] 34. Punch Tutorial — Greg Marlow Learning (11:45) — https://youtu.be/tcBT-6wdSC8 — a punch as body mechanics: hips first, wrist last
- [ ] 35. How to Animate Fight Scenes (Part 1): Punches — Besty Animates (6:02) — https://youtu.be/4uvQytZ3DmA — fight timing and readability
- [ ] 36. Fisticuffs: Tips for animating action and fight scenes — Dong Chang (6:07) — https://youtu.be/-HXx1fK415I — action clarity: fewer, stronger poses
- [ ] 37. How to ANIMATE SWORD COMBAT Part 1 — Gogan (77:15) — https://youtu.be/sBNDzqO8ZT8 — sword swings end to end: windup, slash, recovery; watch at `transcript` first
- [ ] 38. How to Animate a Sword Fight: Full Creative Process — Winged Canvas (15:40) — https://youtu.be/ZTH3meW3o4E — choreography, staging and camera of a fight
- [ ] 39. Breaking Down Attack Animations [Animation] — Masahiro Sakurai on Creating Games (3:35) — https://youtu.be/LewXWM7HDd8 — startup, active and recovery frames; the game-combat phase template
- [ ] 40. Animation vs Choreography — Honored Clarity (8:03) — https://youtu.be/xlfcZ2B8Vvs — what choreography adds that animation alone cannot

## C. Game animation talks and analysis (18)

- [ ] 41. Animation Bootcamp: An Indie Approach to Procedural Animation — GDC (26:13) — https://youtu.be/LNidsMesxSE — procedural assistance subordinate to intent (Part 67)
- [ ] 42. Animation Bootcamp: 2018 Tricks of the Trade — GDC (31:10) — https://youtu.be/o1tti636Kag — working animators' rules of thumb; harvest them as knowledge entries
- [ ] 43. Animation Bootcamp: The First Person Animation of Overwatch — GDC (34:03) — https://youtu.be/7t0hLZd_8Z4 — readability at 60 fps; anticipation under responsiveness limits
- [ ] 44. How Overwatch Conveys Character in First Person — New Frame Plus (15:32) — https://youtu.be/7Dga-UqdBR8 — character through motion, with no face in frame
- [ ] 45. Animation Bootcamp: Animating Cameras for Games — GDC (26:26) — https://youtu.be/hP1Vz70WouE — camera as a character; the `SHOT-003`/`004` model's reference
- [ ] 46. Animation Bootcamp: Script to Screen: The Development Diary of Marvel's Spider-Man — GDC (31:13) — https://youtu.be/r_rJJyIPrmM — a shot from plan to polish in a AAA pipeline
- [ ] 47. Evolving Combat in 'God of War' for a New Perspective — GDC (59:52) — https://youtu.be/hE5tWF-Ou2k — heavy attacks that read; hit reactions; camera and impact
- [ ] 48. Keyframes and Cardboard Props: The Cinematic Process Behind 'God of War' — GDC (54:01) — https://youtu.be/MNinZWlhprE — cinematic planning with cheap previews (the director's loop)
- [ ] 49. Unsynced: The Last of Us Melee System — GDC (54:20) — https://youtu.be/Ox2H3kUQByo — melee contacts and reactions between two characters
- [ ] 50. Making Fluid and Powerful Animations For 'Skullgirls' — GDC (21:06) — https://youtu.be/Mw0h9WmBlsw — power through smears, holds and spacing in a fighting game
- [ ] 51. GuiltyGearXrd's Art Style : The X Factor Between 2D and 3D — GDC (58:59) — https://youtu.be/yhGjCzxJV3E — 3D that reads as anime: stepped motion, per-frame posing, camera tricks
- [ ] 52. The Animation of Guilty Gear Xrd & Dragon Ball FighterZ — New Frame Plus (17:21) — https://youtu.be/kZsboyfs-L4 — the same idea analysed from outside; the anime style profile's numbers
- [ ] 53. How to Animate a Smash Bros Character // MARIO — New Frame Plus (12:59) — https://youtu.be/NHwnTm5o1kc — designing a moveset: anticipation, active frames, recovery per move
- [ ] 54. The Overanimation of Zenless Zone Zero — New Frame Plus (24:03) — https://youtu.be/1yH4Qz23FqM — when more animation hurts readability (Part 14's hierarchy)
- [ ] 55. The Brilliant Animation in Metroid Dread — Video Game Animation Study (38:26) — https://youtu.be/1B1beXTnvEI — locomotion and transitions in a modern action game
- [ ] 56. The Animation of Cuphead — Video Game Animation Study (10:57) — https://youtu.be/pOBKGcehi8U — hand-drawn timing inside a game loop
- [ ] 57. How 2D Fighter Games are Animated — Video Game Animation Study (7:13) — https://youtu.be/WYCjmVhiLaM — frame counts as game design
- [ ] 58. The Effects Animation of Hollow Knight — New Frame Plus (7:19) — https://youtu.be/SIJtfr-PO4Y — effects that support the action instead of hiding it (Part 39)

## D. Anime and stylised action (8)

- [ ] 59. How to add IMPACT frames to your animation — Howard Wimshurst Animation (18:42) — https://youtu.be/6UaUi5fBmJc — impact frames: when, how long, what they replace
- [ ] 60. Animate action with SMEAR FRAMES — Kuzillon (6:37) — https://youtu.be/5v0IZSr9-j0 — smears as spacing devices, and their 3D equivalents
- [ ] 61. Types of Frames in Animation — NobleFrugal Studio (9:53) — https://youtu.be/EMXSFQ4pdUM — keys, extremes, breakdowns, in-betweens, smears, holds — the pose roles of Part 28
- [ ] 62. Every (Anime) Animation Technique Explained in 12 Minutes — SinChi (13:01) — https://youtu.be/iMV9Tlpo1wY — the anime vocabulary in one pass
- [ ] 63. The Art of Animators (or Sakuga) — RCAnime (7:44) — https://youtu.be/-aChpK2jcnQ — what sakuga values: timing contrast, weight, spacing
- [ ] 64. Sakuga OVERKILL! | Animation Analysis: Stark vs Dragon — MankoMan (25:12) — https://youtu.be/ibavOZYfsnQ — a shot-by-shot analysis of a heavy attack sequence
- [ ] 65. I Spent 30 Days ANIMATING this FIGHT SCENE!! — Shrimpy (16:31) — https://youtu.be/OVPfRoIP69Q — a fight scene's planning, blocking and polish over time
- [ ] 66. PWOW Workshop - Introduction to Animation Breakdowns — Toniko Pantoja (16:25) — https://youtu.be/wdPbiy-8BRo — breakdown drawings as the route between keys

## E. Roblox and Moon Animator (18)

- [ ] 67. Moon Animator 2 Basics - Official Tutorial — six (4:41) — https://youtu.be/q8tGNMo_jHg — the tool Cadence replaces, from its author
- [ ] 68. Roblox ANIMATION Guide #1 - Moon Animator (2026) — Nisky (12:07) — https://youtu.be/267aFypaeWU — how Roblox animators actually work today
- [ ] 69. Roblox Animation in Blender: Full Beginner Guide [2026] — Nisky (7:46) — https://youtu.be/eg6COxaPCyo — the Blender route and its export shape
- [ ] 70. Roblox Animation in Blender: Advanced Guide (2026) — Nisky (31:26) — https://youtu.be/EM9u4gIHoRg — advanced Roblox animation habits worth measuring against
- [ ] 71. How I Animate: An Unofficial Moon Animator 2 Tutorial — Tycoon (45:46) — https://youtu.be/Yzf3iGZis7A — a full Moon workflow; the keybind and easing habits Cadence mirrors
- [ ] 72. How to Animate in ROBLOX the RIGHT way [NEW] {Tutorial} — DatBoiEle (10:47) — https://youtu.be/dqAAa9aubM8 — common Roblox mistakes and their fixes
- [ ] 73. How to Make SUPER SMOOTH Roblox Animations with Moon Animator 2! | Beginner to Pro Tutorial — TnxBlox (16:56) — https://youtu.be/EAW6F6PnW0w — easing choices on R15; what "smooth" costs in weight
- [ ] 74. 3 Must-Know Moon Animator 2 TIPS for Better Roblox Animations — TnxBlox (2:41) — https://youtu.be/xQHlThYcgz4 — three habits to check against the review's rules
- [ ] 75. Make Your Roblox Animations Feel REAL | Roblox Animation Tips 2026 — Devgrams and Draco (8:53) — https://youtu.be/AH30avEEC9A — weight and overlap on a Roblox rig
- [ ] 76. How to Animate a Sword Slash [Moon Animator] — Thundey (24:36) — https://youtu.be/KneO6y3FebM — the heavy-attack benchmark's own subject, done by hand in Moon
- [ ] 77. How to ANIMATE a Perfect Sword Swing in Roblox Studio! (EASY) — Nobel Courses (8:01) — https://youtu.be/I1T5Rcm9g3E — a second sword swing to compare timings against
- [ ] 78. How to make WEAPON animations in ROBLOX STUDIO! [Moon Animator Tutorial] — MonkeyDev (11:29) — https://youtu.be/UURYhAVph5g — weapon attachment and grip poses
- [ ] 79. How to ANIMATE Tools In Roblox Studio! — Rustysillyband (11:24) — https://youtu.be/nKC3-pAtN5g — tools, welds and the hand: the attachment rules `attach_item` mirrors
- [ ] 80. ROBLOX VFX Guide #1 - Particles — TrendyV2 (7:14) — https://youtu.be/xzZeP65SSlA — ParticleEmitter craft; what a VFXSpec compiles to
- [ ] 81. How to ACTUALLY Use VFX in Roblox — Develuper (9:24) — https://youtu.be/TkNZETIu0CM — VFX that supports a hit instead of hiding it
- [ ] 82. How to Learn Roblox Aura VFX in 1 Hour — Twist VFX (41:47) — https://youtu.be/u2o-wHKDlpw — layered effects and hierarchy (Part 38); watch at `transcript` first
- [ ] 83. How to make Cutscenes in Roblox Studio (Camera-Movement/Animations/VFX/Subtitles) — Jayyy (3:49) — https://youtu.be/APfRtdLkcYc — camera moves in Roblox cutscenes
- [ ] 84. How To Make Animated Character Cutscenes in Roblox Studio — RKGAM3ZS (15:42) — https://youtu.be/cd3fnYN2BQs — animation, camera and events in one shot — the shot model's reference

## F. VFX, camera and curves (9)

- [ ] 85. The BEST way to learn FX Animation? — Alex Grigg // Animation for Anyone (15:51) — https://youtu.be/VjAbB9492VA — effects as motion: source, energy, dissipation
- [ ] 86. #5: Timing | Artistic Principles of VFX — VFX Apprentice (23:10) — https://youtu.be/WLMVpcK0WvA — VFX timing: lead, peak, decay (Part 39's fields)
- [ ] 87. Ultimate Guide to Camera Movement — Every Camera Movement Technique Explained — StudioBinder (29:09) — https://youtu.be/IiyBo-qLDeM — the camera vocabulary of Part 40
- [ ] 88. 7 Rules of Cinematic Framing and Composition — Kellan Reck (9:29) — https://youtu.be/MYlgj1hwcYw — framing rules a readability measure can encode
- [ ] 89. Animate Cameras like a Pro (Blender Tutorial) — CG Boost (23:10) — https://youtu.be/COwENnPwWJ8 — camera animation as animation: arcs, easing, anticipation
- [ ] 90. How to Animate with the Graph Editor — Sir Wade Neistadt (21:04) — https://youtu.be/RQ31vjgJM2c — curves as the expressive object (Part 31)
- [ ] 91. How to use Blender's Graph Editor like a Professional Animator — BrianKouhi (15:53) — https://youtu.be/vKgO3NsYORo — reading velocity from a curve; what the easing ladder approximates
- [ ] 92. Animating ARMS (FK vs. IK) - Doodley — Doodley (11:28) — https://youtu.be/JnkAlwMjalc — when IK, when FK (Part 32); the pose compiler's choice
- [ ] 93. FK and IK Explained - Which One to Use and When? — Miloš Černý Animation (7:47) — https://youtu.be/0a9qIj7kwiA — the same choice, from a second teacher

## G. Workflow, reference and critique (7)

- [ ] 94. The Ultimate Animation Workflow for Beginners — Chester Sampson (12:59) — https://youtu.be/v71G6TCw_0M — plan, block, spline, polish: the loop the director's loop automates
- [ ] 95. Animation Power Tips - When to go from BLOCKING to SPLINE — Harvey Newman (20:24) — https://youtu.be/TIBzcsOt2FU — the blocking-to-spline decision; what must be true first
- [ ] 96. Why Your Stepped Animation Sucks in Spline — Sir Wade Neistadt (8:59) — https://youtu.be/KSRZg7PwgyU — the failures that appear when stepped keys become curves
- [ ] 97. Tips for Polishing Animation from a Disney Animator — Sir Wade Neistadt (22:09) — https://youtu.be/ujo7aHa7DGQ — polish as the last layer (Part 14: never first)
- [ ] 98. Animation Critique: How To Instantly Improve Your Blender Animation With Easy Tricks — CG Cookie (35:55) — https://youtu.be/r_wQmGKUdZ4 — how a reviewer talks; the review tool's tone and order
- [ ] 99. How to use video reference for Animation — Chester Sampson (11:40) — https://youtu.be/UkWnwHwMapQ — reference as profile, not copy (Part 36)
- [ ] 100. The COMPLETE Guide to Reference for Feature Animation — owenferny (38:06) — https://youtu.be/TaiJauNiKH4 — shooting, choosing and adapting reference; what the library must record

## Added by the user

(paste links here; the next session watches them first)
