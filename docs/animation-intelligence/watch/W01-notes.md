# Watch session W01 notes — videos 1–10

## Checklist

- [x] 1. 12 Principles of Animation (Official Full Series) — AlanBeckerTutorials (24:03) — https://youtu.be/uDqjIdI4bF4
- [x] 2. TIMING - The 12 Principles of Animation in Games — New Frame Plus (9:38) — https://youtu.be/rHEJZXvFc5I
- [x] 3. ANTICIPATION - The 12 Principles of Animation in Games — New Frame Plus (7:52) — https://youtu.be/28s1Hv3Zqlo
- [x] 4. SQUASH & STRETCH - The 12 Principles of Animation in Games — New Frame Plus (8:19) — https://youtu.be/1kFRU_xBZnE
- [x] 5. SLOW IN & SLOW OUT - The 12 Principles of Animation in Games — New Frame Plus (7:24) — https://youtu.be/3jNiNctcQ4c
- [ ] 6. ARCS - The 12 Principles of Animation in Games — New Frame Plus (7:47) — https://youtu.be/lOzgxMgAnxQ
- [ ] 7. FOLLOW THROUGH & OVERLAPPING ACTION - The 12 Principles of Animation in Games — New Frame Plus (16:53) — https://youtu.be/rYtrV1lChsA
- [ ] 8. The most important animation principle: An introduction on animation spacing and timing — Dong Chang (11:04) — https://youtu.be/vSJ5lT_ma-E
- [ ] 9. 3 Easy Ways to Master Animation Timing — Dong Chang (13:58) — https://youtu.be/13QIh7vsCpQ
- [ ] 10. Animation basics: The art of timing and spacing - TED-Ed — TED-Ed (6:42) — https://youtu.be/KRVhtMxQWRs

## Per-video notes

### 1. 12 Principles of Animation (Official Full Series) — 2026-09-11

Watched at `efficient` detail (50 keyframes, sparse across 24:03 — the script's own warning flagged the length) plus the full 744-segment caption transcript, which turned out to be the stronger source here: Alan Becker narrates in a describe-what-you-see style ("here's a character with and without X"), so the transcript alone pins down almost everything, and I read ~10 frames spread across all twelve sections to ground that rather than reading all 50 (per the file's own guidance, `efficient` detail does not carry the "read every frame" obligation `balanced` does).

**Cross-check against `ai/knowledge.js`'s existing twelve essential cards: all twelve confirmed, none contradicted.** Frank Thomas/Ollie Johnston's canonical list maps 1:1 onto the twelve concepts already in the table (`pose_workflow` = straight-ahead/pose-to-pose, `structural_understanding` = solid drawing), and nothing in the video contradicts a claim any existing card makes. Specific confirmations worth naming: squash & stretch's volume-conservation rule ("as the ball gets longer, it also gets narrower") matches the existing card's `physical_interpretation` exactly; the slow-in/slow-out section literally shows a motion-vs-time S-curve graph (frame at t=12:31) that is the same curve `ai/motion.js`'s velocity/acceleration measurement is built to detect; follow-through's "elbow leads forearm leads hand" ordering is precisely what `analyseChain`'s lead/lag measurement already reports.

**Three genuinely new, specific techniques the existing cards don't name — filed as new inbox entries:**
1. **Layered/nested anticipation** (`W01-1-layered-anticipation.json`) — the video shows a punch with a SECOND, earlier wind-up before the ordinary anticipation phase (step forward → wind up → throw the other arm back → punch, likened to a baseball pitcher), contrasted against the same punch with one anticipation phase. The existing `anticipation` card treats anticipation as a single phase; this is a distinct, nameable specialization with its own failure modes (video @ 3:47–4:13).
2. **Pose hold density** (`W01-1-pose-hold-density.json`) — "drawing on ones/twos/threes": how many frames a single pose is held before the next distinct pose appears, shown concretely as one head-lean redrawn at 0 through 10 in-between counts, each count reading as a genuinely different action (a snap-hit vs. a friendly wave vs. a thoughtful appraisal). This is orthogonal to `slow_in_slow_out` (which shapes the curve BETWEEN two poses) — this decides how densely poses exist per unit time in the first place (video @ 16:11–18:20; the 10-inbetween frame at t=17:20 was checked directly and shows exactly 10 dots between begin/end).
3. **Twinning** (`W01-1-twinning.json`) — a named, specific failure mode: posing paired limbs identically/symmetrically (both arms at the same angle, even weight on both legs) reads as flat and lifeless; the fix is breaking symmetry (weight on one hip, a hand resting there, a slouch). Neither `structural_understanding` nor `appeal` names this specifically, though both are adjacent. I did not personally see the corrected-pose illustration frame (efficient-detail sampling landed on the section's title card instead, t=21:38) — the entry says so plainly in `evidence_status` rather than claiming a frame I didn't see (video @ 21:19–21:37).

**Other specific, useful material that did NOT get its own entry** (judged as either 2D-drawing-specific with no honest Cadence angle, or as an illustration of an existing card rather than a new concept — kept here instead of inflating the inbox):
- The "keys → extremes → breakdowns" pose-to-pose vocabulary hierarchy (video @ 8:39–9:13) — a specific naming convention for pose-to-pose sub-stages; `pose_workflow`'s existing card already states plainly that Cadence has no representation of the workflow choice at all, and this doesn't change that.
- "Push the exaggeration level until it's actually too much, then wind it back" (video @ 19:44–19:53) — a calibration METHOD rather than a new visual principle; conceptually close to what `ai/experiment.js`'s bounded-alternatives comparison could support (generate a range, compare), but that's a workflow observation, not a knowledge-entry candidate.
- Appeal's three concrete design levers — shape variety, exaggerating the one proportion that carries the character's personality, simplifying detail count (video @ 22:08–22:56) — specific and well stated, but the existing `appeal` card already and deliberately claims zero measurement for the whole principle ("this build states that plainly rather than approximating it"); a new entry here would just restate that same honest gap under a different name.
- The "hold readable text on screen for as long as it takes to read it aloud three times" staging convention (video @ 5:42–5:48) — precise and quotable, but it is about on-screen TEXT, which is outside Cadence's domain entirely (a rig/VFX/camera animation tool, not a UI-text tool). Generalized into a check below instead of a knowledge entry, since the underlying idea (hold a key beat long enough to register) does apply beyond text.
- The "motion smear" technique for very fast arcs — a translucent/fragmented shape filling the gap between start and end pose (video @ 13:56–14:38) — a hand-drawn substitute for in-between frames; closest Cadence analogue would be a VFX trail/streak emitter, but that is a stretch from what the video actually shows, so left as a note rather than forced into a `vfxspec`-flavored entry.

**Capture candidates:** none. Every demonstration in this video is a 2D stick-figure/scribble illustration, not a real performed motion — nothing here is a reference clip Roblox Studio's Animation Capture could take.

**Checks for a later session to implement:**
- `check: layered_anticipation_present — count of distinct direction-reversal sub-phases before an action's main onset — ≥2 sub-phases expected only for declared "heavy"/"finisher" actions, 1 otherwise — video 1 @ 3:47–4:13`
- `check: pose_hold_density_matches_style — average frames-per-distinct-key-pose within a phase (derivable from existing track key timestamps) — anime/limited style: roughly 2–3 frames per pose (or an irregular stepped pattern); realistic/full style: near-continuous — video 1 @ 16:11–18:20`
- `check: twinning_avoidance — angular difference between each declared mirror joint pair's rotation at a sampled frame — flag when the difference is small (e.g. <5°) across multiple paired joints simultaneously on a held, non-locomotion pose — video 1 @ 21:19–21:37`
- `check: readable_hold_duration — duration a key story-beat pose is held with no significant motion before the next phase begins (via existing phase/marker timing) — should be long enough for the pose's content to register; the video's own convention for on-screen text (hold for 3× the read-aloud time) generalizes to "long enough to read", not a literal Cadence-applicable number — video 1 @ 5:31–5:48`

**Entries written:** 3 (`W01-1-layered-anticipation.json`, `W01-1-pose-hold-density.json`, `W01-1-twinning.json`), all passed `validateProposedEntry` cleanly (checked directly against the live `ai/knowledge.js` module — 0 problems, no extra/missing fields on any of the three).

### 2. TIMING - The 12 Principles of Animation in Games — 2026-09-11

Watched at `balanced` detail (89 scene-aware frames over 9:38, all 89 read directly) plus the full 247-segment caption transcript. This is New Frame Plus's game-specific deep-dive on the single principle of timing, illustrated with a long montage across many real games (Shadow of the Colossus, Red Dead Redemption 2, Street Fighter III/IV/V, Dark Souls III, Sekiro, Guilty Gear, Persona 4 Arena, Dragon Ball FighterZ, Destiny, Spider-Man PS4, Breath of the Wild, Super Smash Bros., MGSV, The Witcher 3, Superhot) rather than original illustration, so the frames earned their keep here confirming which game each spoken example refers to.

**Cross-check:** confirms the existing `timing` card closely, including a near-verbatim restatement of the interaction graph's own line separating timing from spacing ("if timing describes when, spacing describes how") — direct textual confirmation of `INTERACTION_GRAPH`'s `{a: 'timing', b: 'slow_in_slow_out'}` note. No contradictions. The video's own framing — "it might be the most important principle of the 12" for games specifically — matches the existing card's `cadence_representation` note calling it "the most thoroughly represented principle in this table."

**Two new entries, both specific to GAME timing and grounded in the video's own numbers** (checked directly against the matching gameplay footage, not just the transcript):
1. **Startup frame budget** (`W01-2-startup-frame-budget.json`) — the video states concrete, contrasting frame counts for the same kind of decision: a fast fighting-game hit connects in ~3 frames at 60fps (one-twentieth of a second, explicitly "too fast to react to"), versus a Dark Souls longsword attack at ~30 frames ("10 times slower... a degree of risk to committing to an attack"). This is a genre-level design dial the existing `timing`/`anticipation` cards don't name explicitly, though `anticipation`'s `game_combat` style_variations gestures at the same tradeoff informally (video @ 7:14–8:24).
2. **Global timing register** (`W01-2-global-timing-register.json`) — Dan states directly that Shadow of the Colossus's sense of majesty comes from applying slightly-slower timing to *everything* in the game, not only the colossi, and separately names Red Dead Redemption 2's uniformly deliberate pace as a real source of player friction on frequently-repeated actions (shown on screen via the game's own "ARE THESE ANIMATIONS NECESSARY?" meme caption over a horse-mounting animation, frame at t=06:45). This is timing applied at the PROJECT scope, which the existing card only covers per-action; closest existing mechanism is `ai/style.js`'s per-style multipliers, which don't currently include an overall pace/duration axis (video @ 5:32–6:59).

**Other observations, no new entry:** the video's explicit convention of thinking in FRAMES at a fixed reference rate (even though real game frame rates are variable) rather than seconds/milliseconds — Cadence's own frame model already matches this professional convention, so this is confirmation, not a gap. A GDC 2014 slide on "smears" appears briefly as uncredited b-roll at t=00:12 with no matching narration in this video — corroborates video 1's "motion smear" observation from an independent source but adds nothing new to write down.

**Capture candidates:**
- `capture: readable heavy attack with telegraph + recovery — video 2 @ 8:09–8:24 — a longsword swing with a long, clearly-read wind-up and a long recovery afterward — reference for a "tactical/punishable" heavy attack`
- `capture: near-instant competitive hit — video 2 @ 7:14–7:25 — a fast normal connecting in ~3 frames at 60fps with almost no visible wind-up — reference for a "fighting-game-style" fast attack`
- `capture: slow full-body weighted walk — video 2 @ 5:44–6:05 — a huge creature's wind-affected, unhurried full-body shift while walking — reference for a "heavy/majestic" locomotion cycle`

**Checks for a later session to implement:**
- `check: startup_frame_budget_by_genre — frame distance from an action's first key to its declared contact/impact marker (existing key + marker timestamps) — competitive/fighting-style actions expected in the low tens of frames or fewer, tactical/souls-like actions in the several-tens-of-frames range, both stated at a fixed reference frame rate — video 2 @ 7:14–8:24`
- `check: global_timing_register_consistency — variance of phase duration / startup frame count across a project's animations — low variance expected once a slow/majestic or fast/snappy register is declared; a frequently-triggered player action sitting far outside that register should be flagged for friction review — video 2 @ 5:32–6:59`

**Entries written:** 2 (`W01-2-startup-frame-budget.json`, `W01-2-global-timing-register.json`), both passed `validateProposedEntry` cleanly.

### 3. ANTICIPATION - The 12 Principles of Animation in Games — 2026-09-11

Watched at `balanced` detail (92 scene-aware frames over 7:52, all 92 read) plus the full 208-segment caption transcript. Another New Frame Plus deep-dive, illustrated with a wide montage (God of War, Smash Ultimate, Bugs Bunny, Shadow of the Colossus, Horizon Zero Dawn, Hollow Knight, Sekiro, Dark Souls III, Monster Hunter World, XCOM 2, Animal Crossing, Anthem, Super Mario Odyssey, Celeste, Cuphead, Dragon Ball FighterZ, Sayonara Wild Hearts) confirming which example each spoken point refers to.

**Cross-check:** confirms the existing `anticipation` card fully — the "coiled spring" analogy, "the more powerful the action, the more exaggerated the anticipation needs to be," and the readability/cueing function are all restated near-verbatim. No contradictions. The video's `game_combat` framing (responsiveness competing with anticipation time) matches the existing card's own `style_variations.game_combat` note ("compressed toward pose over frames, to protect responsiveness") — direct confirmation, and this video is the evidentiary source that note was presumably drawing on.

**Two new entries — both specific to what happens when a player-controlled action CANNOT afford real anticipation time, which the existing card names as a pressure but doesn't resolve into named techniques:**
1. **Recovery-weight substitution** (`W01-3-recovery-weight-substitution.json`) — sell an action's power through its RECOVERY (the vulnerable window after the hit) instead of its wind-up, when responsiveness rules out a long startup. Named directly as a common strategy, and as a deliberate risk/reward design lever (a stronger move leaves the player exposed longer afterward) (video @ 5:16–5:44).
2. **Implied zero-frame anticipation** (`W01-3-implied-zero-frame-anticipation.json`) — two named fallback techniques for when even a short anticipation phase doesn't fit: snapping instantly to a held, recognizable wind-up pose with zero transition frames (still delivers anticipation's readability function, not its power-communication function), and — when there is truly zero frame budget — an exaggerated stretch on the departure pose itself that implies a crouch that was never actually drawn. The video's own words for the second case are worth keeping verbatim: "there isn't one but it sort of feels like there was" (video @ 5:47–6:53).

Both new entries interact directly with video 2's `startup_frame_budget` (they are what happens at the low end of that same dial) and with `recovery_weight_substitution`/`implied_zero_frame_anticipation` interacting with each other as adjacent fallback rungs on one ladder: layered anticipation (video 1, when there's extra time) → ordinary anticipation → recovery substitution or a pose-snap (when time is tight) → a departure-frame stretch (when there is none at all).

**Other observations, no new entry:** Sekiro's demand for a precisely-timed parry (not just a dodge) is a sharper version of the existing card's general readability use case, not a structurally new concept — kept as a confirming example. The turn-based/RTS/Animal Crossing point (responsiveness stops being the binding constraint, so anticipation gets "a lot more wiggle room") is the direct converse of `startup_frame_budget`'s genre axis, already covered by that entry from video 2's side.

**Capture candidates:** none beyond what videos 1–2 already named — this video's examples are either 2D/sprite games (no 3D rig to reference) or the same real-game footage already covered.

**Checks for a later session to implement:**
- `check: recovery_duration_vs_startup_duration — for a player-controlled action, the ratio of post-contact recovery duration to pre-contact startup duration (both already derivable from existing markers) — a "responsive" action is expected to show a startup budget near the low end of its genre convention (see startup_frame_budget) with recovery bearing more of the weight-communication load instead — video 3 @ 5:16–5:44`
- `check: anticipation_pose_recognizability_at_snap — whether a single held frame at an action's start matches a declared "wind-up" pose shape for that action (would need a pose-similarity measure this build does not have) — a snap-anticipation technique is only working if this holds — video 3 @ 5:57–6:07`

**Entries written:** 2 (`W01-3-recovery-weight-substitution.json`, `W01-3-implied-zero-frame-anticipation.json`), both passed `validateProposedEntry` cleanly.

### 4. SQUASH & STRETCH - The 12 Principles of Animation in Games — 2026-09-11

Watched at `balanced` detail (100 scene-aware frames over 8:19, ~75 read directly — a thorough spread across every named example, with the repetitive tail of one long single-action montage, Jak's beach run cycle, sampled rather than read exhaustively once the pattern it showed was already confirmed several times over) plus the full 227-segment caption transcript.

**Cross-check:** strongly confirms the existing `squash_stretch` card, almost to the point of restating its `cadence_representation` field's own reasoning: the video independently arrives at "3D game rigs can't easily deform, so the SAME principle gets applied through pose-based compression/extension instead" — exactly the distinction that card already draws between literal mesh deformation (absent in Cadence) and the pose-based equivalent (`motion_amplitude`/`weight_transfer`). Named, viewed examples of the pose-based route: Marvel's Spider-Man's zip-to-point swing (a coiled launch pose stretching into extended limbs mid-air, then bunching up against the landing wall — directly confirmed on screen at video @ 5:00–5:22, frames captured at t=4:52–5:34) and Anthem's javelin jump launch (compress then sharply extend, with the animators explicitly NOT touching the javelin suit's actual proportions). Jak & Daxter's torso visibly compressing and extending each running step is real mesh deformation, not the pose-based substitute — confirmed directly on screen across dozens of frames (video @ 5:55–6:49) — and the video's own aside that Daxter's head "stays perfectly round throughout" while his body stretches is a concrete, visible tell of exactly the rig-deformation-coverage limit the existing card's `roblox_considerations` gestures at generally.

**One new entry — a technique squash & stretch's own vocabulary gets borrowed for, but for a different purpose than the card already covers:**
- **Motion smear for readability** (`W01-4-motion-smear-readability.json`) — stretching a limb or weapon along its motion path to bridge large per-frame spacing gaps on a fast action, so the eye can track it — named directly for Overwatch and League of Legends (video @ 3:04–3:20), and independently confirmed visually in this same video's own closing 2D-game montage (a streaked, swirl-shaped silhouette during a fast spin move, t≈7:44–7:49). This is the SAME technique video 1 of this batch flagged as an uncredited GDC-talk citation with no narration to go on — three independent sources now point at the same real, named technique, which is why it earns an entry this time rather than staying a notes-only observation.

**Other observations, no new entry:** the point that realistic characters still benefit from subtle squash & stretch (facial expressions, landing absorption) is already fully covered by the existing card's `style_variations.realistic`. The specific recipe "compress then sharply extend at a jump launch" is a concrete, well-evidenced illustration of the existing card's general pose-based guidance, not a structurally new concept.

**Capture candidates:**
- `capture: pose-based compress-then-extend on a jump launch — video 4 @ 5:24–5:46 — Anthem's javelin: crouch/compress then sharp extend at the moment of launch, no mesh deformation — directly capturable as a pure-pose reference, nothing about it depends on the rig deforming`
- `capture: full-body run-cycle squash/stretch rhythm — video 4 @ 5:55–6:08 — Jak's torso compressing and extending each stride — capturable as a POSE reference for the rhythm/timing only; the source itself uses real mesh deformation Cadence's rigid rig cannot reproduce, so a captured version would need to express the same rhythm through rotation alone`

**Checks for a later session to implement:**
- `check: pose_based_squash_stretch_present_on_launch — whether a jump/launch/coil-and-release phase shows a compress-then-extend rotation pattern at all (any amplitude), independent of mesh scale — video 4 @ 5:24–5:46`

**Entries written:** 1 (`W01-4-motion-smear-readability.json`), passed `validateProposedEntry` cleanly.

### 5. SLOW IN & SLOW OUT - The 12 Principles of Animation in Games — 2026-09-11

Watched at `balanced` detail (100 scene-aware frames over 7:24, ~40 read directly, with a ~100-frame rapid-cut montage of classic Disney comedic shorts around t=5:01–5:45 sampled representatively rather than exhaustively) plus the full 230-segment caption transcript.

**Cross-check:** strongly confirms the existing `slow_in_slow_out` card — the bouncing-ball demo, the Overwatch Brigitte emote (lingering hard on held poses), the Kingdom Hearts III Sora example (subtler, naturalistic), and the mechanical/robotic style note all match directly, including a Tesla acceleration clip and a crash-test-dummy inertia demo as real-world physical groundings the existing card's `physical_interpretation` already describes abstractly. The video's closing point that game responsiveness sometimes forces animators to "find alternative ways to sell the weight of our player characters" is the same pressure `recovery_weight_substitution` and `startup_frame_budget` (videos 2–3) already name — direct cross-confirmation, not new.

**One new entry — a sharp, well-evidenced exception the existing card doesn't state precisely:**
- **External-force easing override** (`W01-5-external-force-easing-override.json`) — when a motion's start or stop is caused by an EXTERNAL force (hitting a wall, a spring launch, a trigger discharge) rather than the object's own effort, the transition should be abrupt, not eased — an eased version reads as self-generated and contradicts the external cause. Confirmed directly: Sonic's own running eases normally, but the video contrasts that against his instant stop on a wall and instant launch off a spring (video @ 4:26–4:48, Sonic and a spring/bumper object both visible on screen at t=4:34–4:44), and a gunshot's kick reading correctly specifically because nothing eases into it — "it's just instant kick" (video @ 4:48–4:58). This is a genuine physical-cause distinction, not merely a style choice, so it sits apart from the existing card's two style-driven non_use_cases.

**Other observations, no new entry:** the video's "comedic instant-snap" non-use case (illustrated with an extended, exaggerated Disney short montage) is a specific instance of the existing card's `style_variations.anime` note about near-instant snaps, not a structurally new concept. The "ease in/ease out" terminology aside is a naming note, not a technique.

**Capture candidates:** none beyond what earlier videos already named — no new distinctly-capturable 3D reference motion appeared in this video that videos 1–4 didn't already cover.

**Checks for a later session to implement:**
- `check: external_force_easing_mismatch — cross-reference an existing contact/impact marker (ai/events.js) against the easing style on the key at that same time — flag when a contact/impact-marked key uses an eased-in style rather than an abrupt one — video 5 @ 4:26–4:58`

**Entries written:** 1 (`W01-5-external-force-easing-override.json`), passed `validateProposedEntry` cleanly.

**Next video: 6** (ARCS - The 12 Principles of Animation in Games, `balanced` detail).
