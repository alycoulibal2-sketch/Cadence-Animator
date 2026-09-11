# Watch session W03 — videos 21–30 (B. Body mechanics, weight, posing, locomotion, combat)

- [x] 21. James Baxter on Weight and Balance — The SPA Studios (3:07) — https://youtu.be/EASbvJNQz0U
- [x] 22. How to Animate Weight — AnimSchool (8:32) — https://youtu.be/0x9f21vFqcE
- [x] 23. How to use Line of Action for Better Poses — Character Design 360 (6:06) — https://youtu.be/P_BY38z-n4M
- [x] 24. Improve Your Animation! Good Posing vs Bad Posing | Animation Techniques — Foxy Fern Animation (9:07) — https://youtu.be/QCHSPSBmSHk (watched, 0 entries — see note: no reliable transcript)
- [x] 25. Create BETTER animations using SILHOUETTES — Start Animating (10:12) — https://youtu.be/uwK0DFEbcCk
- [x] 26. Animating LEGS (Walk Cycles and Weight) — Doodley (11:25) — https://youtu.be/6lGPvMLE8Oo
- [ ] 27. how to animate a walk cycle (100% polish) — Alessandro Camporota (32:40) — https://youtu.be/ynXadXE9UjU
- [ ] 28. ALAN BECKER - Animating Walk Cycles — AlanBeckerTutorials (3:53) — https://youtu.be/2y6aVz0Acx0
- [ ] 29. The COMPLETE Guide to Run Cycle Animation — owenferny (49:04) — https://youtu.be/7NkvAP3aqeo
- [ ] 30. How to Animate Run Cycles — moderndayjames (11:41) — https://youtu.be/nKvBYXzRszw

---

## Video 21 — James Baxter on Weight and Balance (2026-09-11)

Short (18-frame) SPA Studios masterclass clip: mostly Baxter talking to camera plus a rough
stick-figure playblast, then a live physical demo. The teaching is entirely about a mechanism, not
a style: a character does not translate in a direction until its centre of mass has left its base
of support in that direction. Demonstrated twice, cleanly: standing with weight fully on one foot
and lifting the OTHER foot produces "pretty much nothing... a little bit of a shift... but not
much" (@ 01:51–02:03); switching weight off the support foot fast produces immediate falling
motion in that direction (@ 02:04–02:16). Baxter then states the production consequence directly:
a character that must start moving fast should be POSED with weight already shifted toward the
direction of travel, because a centred/neutral starting pose costs extra frames of lean-and-shift
before the first real step (@ 02:19–03:00) — "if you don't have much time, think about how you're
going to pose that character." No exact frame counts are given (his own words are "quite a few
frames" vs "get going right away" — qualitative, not measured), so the entry does not claim one.

**Cross-check, not a contradiction — I want to flag this precisely because I almost got it wrong.**
This video sits right on top of `structural_understanding` and `appeal`'s balance/line-of-action
claims. My knowledge-folder snapshot at the START of this session (before I re-checked) still had
the OLD text ("Cadence models neither" balance nor volume) — that was W02's finding, not mine, and
the concurrent learning-loop session fixed both cards (commit `fcd475f`) WHILE I was mid-frame-read
on this very video. I re-read both files after noticing my own memory index had changed on disk
and confirmed the fix is real and correct: `ai/pose.js measurePose` (MOT-011) now computes line of
action, a volume-proxy centre of mass, and balance against a DECLARED support polygon. Baxter's
video does not contradict the now-corrected cards — it extends them: `measurePose` reports balance
at ONE frame, and what Baxter is teaching is the FRAME-COST of the transition from supported to
unsupported at the start of a travel action, which nothing samples across a range yet. Session
takeaway for whoever reads this next: if you started a batch before a concurrent merge landed,
re-read the cards you're about to write about before you commit anything that calls them stale —
don't trust a snapshot read at the top of a long session.

**Entry written:** `W03-21-weight-transfer-gates-locomotion-onset.json` (category: advanced) — the
mechanism above, plus the posing-for-timing consequence. Both Part 72 gates pass
(`validateProposedEntry` 20/20, `validateEvidenceSource`: URL + timestamp).

**Capture candidate:**
`capture: weight-shift-into-first-step (the "nothing happens" vs "falling immediately" comparison) — video 21 @ 01:51–02:16 — a clean, isolated, ~25s demonstration of locomotion onset gated by weight transfer, performed by an animation supervisor on himself; would let a future session measure real linear_velocity/balance-onset numbers against an actual reference instead of only a description`

**Check:**
`check: weight_shift_onset_frame_count — frames from a travel action's first key to the first frame where linear_velocity (ai/motion.js sampleMotion) departs meaningfully from near-zero, cross-referenced against whether measurePose's balance at the first key is already unsupported toward the travel direction — video 21 @ 01:45–03:00`

## Video 22 — How to Animate Weight (AnimSchool) (2026-09-11)

An AnimSchool class lecture (8:32, only 8 scene-change frames — mostly a screen-shared desktop with
reference clips and a CG lifting demo playing in small windows; the transcript carries almost all
the content, the frames mainly confirm a heavy-box lift demo and a push/pull reference video are on
screen at the right times). Unusually dense for its length — six distinct, independently checkable
claims, of which four were specific and distinct enough to write up as their own entries and two
went to the checks queue instead of duplicating existing spacing/timing cards:

1. **Effort vs. effect** — the instructor's own named system: weight reads from the RATIO of
   visible exerted effort to the resulting displacement (5% effort → 100% effect reads light; 80%
   effort → 5% effect reads heavy), independent of the object's stated size. He also states a
   retry rule I filed under the same entry: a character should not repeat an identical failed
   effort level — the next attempt must visibly escalate.
2. **Leverage requires off-centre gravity** — standing with centre of gravity over your own feet
   gives "no leverage to really push something heavy"; leverage exists only once you shift your
   own centre of gravity off that base (leaning in, a straightening back leg). This is the SAME
   geometric relationship as video 21's mechanism and `structural_understanding`'s now-real balance
   measurement, applied to a different question (can this pose credibly push an external object,
   not when does the character itself start moving) — I wrote it as a separate, cross-referenced
   entry rather than folding it into video 21's, because the diagnostic and the failure mode are
   different even though the physics is the same relationship.
3. **Object centre-of-gravity alignment with support** — a held object reads as heavy only when
   its own implied centre of gravity sits close to the character's AND over the character's feet;
   held with nothing visibly underneath it and far from the character's own centre, it reads as
   weightless no matter how large the prop is. This names a SECOND point (the object's own centre
   of gravity) that nothing in Cadence currently tracks at all — worth stating plainly since it's a
   real, named gap, not just an unimplemented measurement of something already represented.
4. **Straight limb reads heavier than bent limb when holding** — a bent arm implies the bicep alone
   is holding the load (reads light); a straight arm implies the skeleton is bearing it (reads
   heavy) — "if your bicep is strong enough [to hold it bent], then it's not heavy." A single-joint
   posing lever, independent of the other three.

**Not written up as entries (checks queue instead, to avoid duplicating existing cards):**
- Heavier objects decelerate more before a change of direction (his truck-vs-bicycle example) —
  adjacent to `asymmetric_spacing_preference`/`slow_in_slow_out` territory already in the corpus,
  but nothing there measures deceleration MAGNITUDE scaled to implied mass specifically going into
  a turn, so it goes to the checks queue rather than a fifth entry:
  `check: turn_deceleration_scales_with_implied_weight — peak deceleration (from linear_velocity, ai/motion.js sampleMotion) in the N frames immediately before a declared direction-change marker, compared across items with a declared relative weight — video 22 @ 04:26–05:00`
- Momentum-arrest-requires-a-step (lowering a lifted heavy object, its backward momentum has to be
  caught with a foot step or the character would keep travelling) — this is really the SAME
  mechanism as `weight_transfer_gates_locomotion_onset` (video 21) run in reverse — arresting motion
  needs a support base under where the momentum is heading, same as INITIATING motion needs the
  centre of mass to leave one. Noted here rather than as its own card. — video 22 @ 05:52–06:13

**Entries written:** `W03-22-effort-vs-effect-weight-signal.json`,
`W03-22-leverage-requires-off-center-gravity.json`,
`W03-22-object-center-of-gravity-alignment-with-support.json`,
`W03-22-straight-limb-reads-heavier-than-bent-limb.json` (all category: advanced). All four pass
both Part 72 gates (20/20 fields, URL + timestamp evidence).

## Video 23 — How to use Line of Action for Better Poses (Character Design 360) (2026-09-11)

Short (6:06) but hit a real network gap: `--detail balanced` on the URL failed twice with a DNS
resolution error on the googlevideo.com CDN edge host (`getaddrinfo failed`) — the known
intermittent-DNS issue the batch prompt warns about. Third attempt succeeded. That run also came
back with 104 candidate frames for a 6-minute video, well over the "if more than 80, re-run with
--max-frames 60" rule in §1 — I re-ran frame extraction only, pointed at the already-downloaded
local file (`--detail balanced --max-frames 60`) rather than re-hitting the flaky network a third
time, which produced a clean 60-frame set but no transcript (no captions embedded in the raw file,
no Whisper key configured). I read the full transcript straight from the first successful run's
cached `.vtt` file instead of re-downloading. Read 12 of the 60 frames, spread across the timeline,
rather than all 60: this video is a talking-head-plus-static-reference-image slideshow (real
photos, anime art, one hand-drawn diagram), not a performed-motion demo, so a spread sample was
enough to confirm what the transcript describes rather than needing every frame the way a motion
tutorial does.

The content itself is precise and worth having exactly for what it clarifies about an existing
card. `appeal.json` (fixed this session by the concurrent merge, see video 21's note) already
credits `ai/pose.js measurePose` with a real line-of-action measurement (MOT-011). This video's
definition is the classical FULL scope of that concept: a line of action can be straight or curved
(convex — force/movement runs away from the body's centre mass; concave — runs inward; S-curve —
both), and it can run through ANY two extremities of a pose (head to toe, hand to hand), not only
the spine. I read `ai/pose.js`'s actual `fitLine` (lines 360–389) and `measurePose` (lines
496–525) to check this against the real implementation rather than trusting the corrected card's
prose at face value: `fitLine` is a straight-line principal-axis fit (power iteration on the
covariance matrix) fed ONLY spine-role parts (root, hips, torso, chest, head) — never hand or foot
effectors. So the now-correct claim "a line of action is measured" is real but narrower than what
this source calls a line of action: it cannot carry a concave/convex/S-curve distinction (only an
unsigned `max_deviation_studs`), and it never sees a hand-to-hand or head-to-toe line at all. The
frames confirm this matters in practice, not just in theory — the anime/superhero reference images
on screen (My Hero Academia's Deku mid-punch, Demon Slayer's Tanjiro mid-draw, Spider-Verse
characters mid-leap) are exactly the extended-limb poses where the dominant curve runs through an
arm or leg, not the spine.

**Entry written:** `W03-23-line-of-action-shape-and-scope.json` (category: advanced) — the shape
taxonomy, the extremity scope, and the 1–2-lines/no-crossing composition rule, all cross-referenced
against `appeal` and the real `fitLine` source. Passes both Part 72 gates (20/20 fields, URL +
timestamp evidence).

**Capture candidate:** none. Every visual in this video is a still reference image (real photos,
anime/comic art) or a hand-drawn diagram — no performed 3D motion exists to track.

**Check:**
`check: line_of_action_extremity_scope — extend fitLine's input point set to include hand and foot effector positions (already available as IK targets elsewhere in ai/pose.js) alongside the spine, and report whether the fitted line's dominant direction shifts once limbs are included — video 23 @ 02:53–03:07`

## Video 24 — Good Posing vs Bad Posing (Foxy Fern Animation) (2026-09-11)

**Zero knowledge entries from this video, deliberately — the honest result, not a skipped one.** Full
account of why, because the reason matters more than the outcome:

- First pass (`--detail balanced`, URL): 81 frames, no transcript — captions returned
  `HTTP Error 429: Too Many Requests` and no Whisper key is configured (forbidden to add one for
  this batch by §Rules: no API keys). Re-extracted from the already-downloaded local file at
  `--max-frames 60` per §1's >80 rule, still no transcript. Read all 60 frames.
- The frames show a fast-cut montage of professional reference clips (Tarzan, God of War, RDR2,
  Overwatch gameplay, Ori and the Blind Forest, Cuphead, Tangled, a Kung Fu Panda snake character,
  hand-drawn model/turnaround sheets for a 1930s-style pin-up dance cycle, a female figure, Mario,
  a "Faceless" creature) intercut with a Maya viewport showing a rigged character being posed, and
  a Getty Images / YouTube reference search for "soccer player kicking ball." One frame
  (`frame_0057`, t≈07:37) shows what LOOKS LIKE a side-by-side same-rig comparison of a soccer-kick
  pose with the arm in two different positions — exactly the shape of content the title promises —
  but I do not know, from a still frame alone, whether that was a deliberate good/bad comparison,
  two points in one continuous animation, or something else entirely.
- I did not want to guess, so I tried once more: re-ran `--detail transcript` on the same URL after
  enough time had passed that the 429 might have cleared. It had — captions came back — but they
  are INCOHERENT: `"Heels strange box weekdays 7 has a hole too Blue House Park every aspect
  waist"` is the literal first line, and it stays word-salad for the full 9 minutes (stray Korean
  names and phrases bleeding into nonsense English throughout). This is not "captions missing," it
  is captions PRESENT and UNUSABLE — a meaningfully different failure than the one the batch prompt
  and the /watch skill's own failure-mode table describe, and worth naming for whoever reads this
  next: a caption fetch returning HTTP 200 is not the same claim as the caption text being
  trustworthy. I read the raw `.vtt` directly to confirm this wasn't a formatting artefact — it is
  genuinely incoherent from the first cue.
- Writing an entry that puts specific posing criteria in this presenter's mouth, sourced only from
  guessing at silent frames, would be exactly the kind of claim Part 72's evidence gate and this
  whole programme's ethos exist to refuse. So: no entry. The video is ticked as watched (I did
  genuinely watch it, twice, at two detail levels) so a future session does not repeat the same two
  failed caption attempts, but it is flagged here as a good candidate for a re-watch once/if a
  Whisper key is ever configured — the visual content (especially the soccer-kick Maya comparison)
  looks like it would be worth real entries with narration to ground it.

**Entries written:** none. **Capture candidate:** none — every clip is pre-existing third-party
film/game footage or a hand-drawn sheet, nothing a Roblox Studio capture could use as source video.
**Lesson for LESSONS.md:** caption presence ≠ caption trustworthiness; sanity-check auto-caption
text for coherence (a quick skim of the first few lines) before treating it as evidence, the same
way a frame gets looked at before its timing is trusted.

## Video 25 — Create BETTER animations using SILHOUETTES (Start Animating) (2026-09-11)

Sparse (17 frames over 10:12 — the /watch tool itself warned coverage would be thin at this
length under `balanced`) but the transcript is clean, coherent English and carries almost the
whole video — a good contrast with video 24's unusable captions right before it, and reassuring
that that failure was specific to that video rather than a systemic problem. Two distinct
applications, only one in Cadence's scope:

1. **Character-design silhouette uniqueness** (@ 01:56–03:04): four instantly-recognisable
   character silhouettes (Bart Simpson, SpongeBob, Mickey Mouse, Fred Flintstone) with zero
   interior detail, as evidence that a well-designed SHAPE is identifiable on its own. I did not
   write this up as an entry — it's a character-DESIGN technique (making a cast visually distinct
   from each other), and Cadence animates rigs, it does not design them (the modeling/animating
   scope line is one this project already draws deliberately elsewhere). Noting it here rather
   than silently dropping it, since it's real content from the video, just outside what a Cadence
   knowledge entry could ever act on.
2. **Silhouette as a pose-readability diagnostic** (@ 03:39–08:02) — the one that matters here,
   and it lines up almost exactly with an existing named gap. The presenter poses a 2D rig
   (Cartoon Animator) so the character reads as "looking to his right, searching for something,"
   then toggles the software's brightness to -100 to view it as a flat black silhouette: the pose
   is suddenly illegible — "you have no idea what this character is doing" — even though the full
   colour render read fine. He then fixes it entirely through shape (weight onto the forward leg,
   the searching arm separated from the torso with real negative space under it, the head angled)
   with no change to colour or expression, and the silhouette starts reading the same action. He
   also catches a structural problem this way that the full render was hiding (an overextended
   neck). I captured the frame at t=05:26 (the flat, unreadable "before" silhouette) and t=07:58
   (the corrected, clearly directional "after") directly, so the entry's evidence isn't only the
   transcript's word.
   This is, almost verbatim, `structural_understanding`'s own named gap: "silhouette readability:
   limb separation and negative space need a rendered pass (MOT-012, OBS-002)". I checked what
   OBS-002 actually is before writing the entry, rather than assuming: `renderer/js/
   observationPasses.js` already has a real `'silhouette'` render pass (subject-only, flat white
   material, no antialiasing, camera-fingerprinted) — but it exists to detect whether a silhouette
   MOVED between two rasters (a regression signal for `ai/observe.js`), never to judge whether a
   SINGLE silhouette's shape reads as anything. The rendering half of this video's technique is
   real and already built; the judging half (limb separation, negative-space, directional
   asymmetry) is the actual MOT-012 gap, and is a genuinely different question from the motion-
   regression thing the existing pass answers today.

**Entry written:** `W03-25-silhouette-readability-diagnostic-pass.json` (category: advanced).
Passes both Part 72 gates (20/20 fields, URL + timestamp evidence).

**Capture candidate:** none — a 2D rigged-puppet software demo (Cartoon Animator), not a performed
motion a Roblox Studio capture could source.

**Check:**
`check: silhouette_limb_separation_metric — from a rendered silhouette raster (observationPasses.js 'silhouette' pass, already built), measure whether each limb's connected pixel region touches the torso's region or is separated by background pixels, as a proxy for negative-space readability — video 25 @ 05:28-07:56`

## Video 26 — Animating LEGS (Walk Cycles and Weight) (Doodley) (2026-09-11)

The densest, sharpest video in this batch so far — 17 frames only (mostly cited-clip title cards:
Sisyphus 1974, Trigun Stampede 2023, Toy Story 1995, The Last Belle 2011, plus Doodley's own
colour-coded 3D walk-cycle demo rig at t=05:19/06:45) but a clean, fully coherent 386-segment
transcript that is essentially a tightly-structured lecture: feet/weight, walk-cycle poses,
hips/upper body, personality, running, standing/idle, balance loss — in that order, each section
short and specific. This is squarely the video I'd point at first if someone asked "what should
this batch have found" — it lines up with an unusual number of things Cadence already half-builds.

Five entries, and I want to name why five (more than the "usually one to four" guideline) rather
than just write them: this video is not five loosely related tips, it is five INDEPENDENT,
individually falsifiable, individually measurable claims, several of which connect to a DIFFERENT
existing Cadence gap each — collapsing them into fewer, broader entries would have hidden which
specific measurement each one needs.

1. **Foot lock duration scales with weight before a jump launch** (@ 00:26–01:59) — feet must show
   zero drift right up to liftoff, longer for bigger/heavier characters, pushed even further for
   "meaty" cartoony jumps. The best-grounded entry in the whole batch so far: `measureContactDrift`
   (MOT-008) already measures exactly the quantity this technique needs — this is a claim that is
   MEASURABLE TODAY, not merely buildable. Also captured the off-screen-feet cheat (hiding feet lets
   the brain assume they stayed planted) as a companion note, with its own Toy Story example
   matching a frame I captured directly at t=01:23.
2. **The walk cycle's vertical drop is an arrested fall** (@ 02:09–03:07) — the classic
   Contact/Down/Pass/Up/Contact vocabulary, but with ONE stated mechanism tying it together:
   walking is a controlled forward fall, the body must peak at Up and drop exactly at the next
   Contact. That's a literal position-curve shape claim, not just a naming exercise.
3. **A figure-eight trajectory signature** (@ 03:54–04:04, @ 07:38–07:49) — the hips (walk) or a
   tracked foot (run, explicitly NOT walk) trace a figure eight from a side view. Specific enough
   that I could state exactly why it differs by gait (a walking foot never gets enough uninterrupted
   air time; a run's flight phase gives it that time) rather than just asserting the shape.
4. **A named centre-of-gravity-to-personality taxonomy** (@ 05:10–06:02, @ 08:29–08:52) — forward
   lean = aggressive, backward = proud/happy, side-wobble = drunk/sick, locked-centre = uptight,
   turned-away = cautious — plus the SAME mechanism applied to idle loops (small weight shifts
   between feet is what "keep alive" actually is, mechanically). I flagged this as a natural,
   ready-made dimension set for `ai/style.js` if anyone ever wants to author a character's habitual
   posture as a style trait.
5. **Continuous ground contact except during a run's flight phase** (@ 06:41–07:13, @ 08:58–09:32)
   — at least one foot down at all times, ALWAYS, except a run's brief both-feet-airborne moment,
   which the video ties to Muybridge's galloping-horse photography (one of the reasons motion
   pictures exist at all). Losing balance is characterised by RAPID single-foot changes, never a
   zero-contact scramble. This is the one entry of the five where I had to say plainly that nothing
   in this build currently even measures "is any foot in contact at frame N" as a per-frame boolean
   — `measureContactDrift` measures drift GIVEN an assumed contact, not whether one exists — so this
   is a real, not just unwired, gap.

**Not written up separately (confirmed, cross-check only):** upper-body counter-rotation (arms
opposite legs, chest opposite hips, for balance) @ 04:44–05:09 — this is about as close to
foundational twelve-principles knowledge as this batch gets, and I judged re-evidencing it as its
own card would be padding rather than new information; noting the confirmation here instead, since
a confirmation is still worth recording per the loop's own rules.

**Entries written:** `W03-26-foot-lock-duration-scales-with-weight.json`,
`W03-26-walk-cycle-vertical-drop-arrested-fall.json`, `W03-26-figure-eight-trajectory-signature.json`,
`W03-26-center-of-gravity-personality-mapping.json`,
`W03-26-continuous-ground-contact-except-flight-phase.json` (all category: advanced). All five pass
both Part 72 gates.

**Capture candidate:** none — every visual is a hand-drawn diagram, a cited third-party film/game
clip, or Doodley's own pre-existing rigged demo character; no real human performer to source from.

**Checks:**
`check: foot_lock_duration_vs_declared_weight — consecutive near-zero-drift frames (measureContactDrift, MOT-008) immediately before a jump's launch key, compared across items with a declared relative size/weight — video 26 @ 01:17-01:24`
`check: walk_vertical_peak_drop_alignment — locate the single local maximum in root/hip vertical position across one step and confirm the following local minimum lands within a small tolerance of the declared Contact key — video 26 @ 02:50-02:57`
`check: figure_eight_path_shape — project a tracked part's sampled position onto the side-view plane over one cycle and test for a self-crossing (figure-eight) path, expected for hips in a walk and a foot in a run, not for a foot in a walk — video 26 @ 03:54-04:04, 07:38-07:49`
`check: ground_contact_state_per_frame — a new, more basic measurement than MOT-008: whether ANY declared foot effector is within contact tolerance of its target at a given frame (not how far it has drifted given an assumed contact) — the prerequisite for checking continuous_ground_contact_except_during_flight_phase and several other checks in this batch — video 26 @ 09:16-09:32`
