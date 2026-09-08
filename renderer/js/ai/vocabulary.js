// Part 21 — the semantic vocabulary: what words like "heavy" and "snappy" actually ask for.
//
// The directive is emphatic that this must NOT be a hard-coded slider per word: "The mapping must
// be probabilistic and contextual, not a hard-coded single slider." So a term does not map to a
// value; it maps to a set of DIMENSIONS, each with a signed pull, plus the things a single number
// can never carry — what else the word could have meant, when it is wrong, and how it commonly
// fails.
//
// Three rules hold this module together, and each exists because its opposite produces a specific
// bad animation:
//
//   * **A term is a vector, never a scalar.** "Heavy" that only slowed the clip down would produce
//     the exact result the directive warns about: "Heavy does not always mean slow." Every term
//     here therefore names several dimensions and, where it matters, explicitly pins one to zero.
//   * **Opposing pulls are reported, not averaged.** "Heavy but floaty" is a legitimate request and
//     a contradictory one. Silently averaging the two produces a motion with no character at all,
//     so `interpret()` returns a `tensions` list and lets the caller decide.
//   * **An override is scoped and carries evidence.** Part 21: "If the user repeatedly corrects a
//     term's interpretation, capture a scoped preference with evidence rather than silently
//     overwriting the global definition." The global table below is frozen; `setTerm` writes to
//     `project.semantics.vocabulary` and refuses without evidence.
//
// Nothing here decides how a dimension is achieved. That is `ai/plan.js`'s job, and the split is
// deliberate: the meaning of "heavy" should not change because the compiler learned a new trick.

import { CERTAINTY, evidence, finding } from './certainty.js';
import { contentHash, shortHash } from './hash.js';

// ---------------------------------------------------------------- dimensions
//
// The axes a term can pull on. Each is normalised to [-1, +1] as a DELTA against whatever the
// animation currently does — not an absolute target. That choice matters: "heavier" is a relative
// request, and an absolute scale would need a reference animation nobody has supplied.
//
// `compiles_to` is the honest column. A dimension no compiler can act on yet says so here, and
// `interpret()` carries that through to `coverage.notRun` rather than letting a caller assume a
// non-zero pull will produce a change.

export const DIMENSIONS = Object.freeze({
  acceleration_contrast: {
    id: 'acceleration_contrast',
    summary: 'how much speed varies within a transition — slow-in/fast-out against uniform travel',
    positive: 'concentrated acceleration, a clear fast part and a clear slow part',
    negative: 'even travel, little difference between the fastest and slowest moment',
    compiles_to: 'easing style and direction on the keys bounding a phase',
    aspects: ['easing'],
    implemented: true,
  },
  weight_transfer: {
    id: 'weight_transfer',
    summary: 'visible shift of the body mass into or out of the action',
    positive: 'the hips and torso commit before the limbs do; the stance carries the shift',
    negative: 'the body stays centred and the limbs act alone',
    compiles_to: 'rotation amplitude on the root, hips and waist during the preparation phase',
    aspects: ['value'],
    implemented: true,
  },
  body_lead: {
    id: 'body_lead',
    summary: 'proximal joints initiate before distal ones (Part 29 body-driven motion)',
    positive: 'hips lead, then torso, then shoulder, then wrist, then the weapon',
    negative: 'everything starts together, or the hand leads the body',
    compiles_to: 'per-joint key offsets ordered by chain depth — this MOVES keys',
    aspects: ['timing'],
    implemented: true,
  },
  anticipation_depth: {
    id: 'anticipation_depth',
    summary: 'how far the preparation travels against the direction of the action',
    positive: 'a deeper wind-up, more readable direction',
    negative: 'a compressed or absent wind-up; the action starts almost immediately',
    compiles_to: 'rotation amplitude across the anticipation phase',
    aspects: ['value'],
    implemented: true,
  },
  motion_amplitude: {
    id: 'motion_amplitude',
    summary: 'the overall size of the pose changes, without changing where they happen',
    positive: 'larger rotations, bigger silhouette change',
    negative: 'smaller, more contained movement',
    compiles_to: 'scaling every keyed rotation delta about the phase-entry pose',
    aspects: ['value'],
    implemented: true,
  },
  overshoot: {
    id: 'overshoot',
    summary: 'passing beyond the target before coming back to it',
    positive: 'inertia carries the part past its destination and it returns',
    negative: 'the part arrives and stops',
    compiles_to: 'Back easing on the arriving key (no new keys), or an added settle key',
    aspects: ['easing', 'existence'],
    implemented: true,
  },
  settle_duration: {
    id: 'settle_duration',
    summary: 'how long after the action ends before everything is still',
    positive: 'a longer, softer come-to-rest',
    negative: 'the motion stops dead',
    compiles_to: 'the time between the last action key and the final key — this MOVES keys',
    aspects: ['timing'],
    implemented: false,
    blocked_by: 'needs the phase segmenter to identify a recovery phase from motion, not only from key density (Part 23, Phase 5)',
  },
  secondary_delay: {
    id: 'secondary_delay',
    summary: 'how far behind the primary action the trailing parts run',
    positive: 'hair, cloth, weapon and free limbs lag further behind',
    negative: 'everything moves in lockstep with the body',
    compiles_to: 'key offsets on parts with no contact role — this MOVES keys',
    aspects: ['timing'],
    implemented: true,
  },
  hold_length: {
    id: 'hold_length',
    summary: 'frames spent holding a pose rather than travelling',
    positive: 'longer holds at the extremes, which makes the moves between them read faster',
    negative: 'continuous movement, few or no holds',
    compiles_to: 'inserting a duplicate key before a departure — this ADDS keys',
    aspects: ['existence', 'timing'],
    implemented: false,
    blocked_by: 'a hold needs a pose duplicated at a new time, which is an added key; safe insertion needs the contact model (Phase 5) to know it is not breaking a contact',
  },
  spacing_evenness: {
    id: 'spacing_evenness',
    summary: 'how uniform the frame-to-frame travel is across the WHOLE clip, as opposed to within one transition',
    positive: 'a steady, mechanical, even distribution',
    negative: 'clustered — some stretches dense, others sparse',
    compiles_to: 'easing selection across all phases at once',
    aspects: ['easing'],
    implemented: true,
  },
  asymmetry: {
    id: 'asymmetry',
    summary: 'how much the two sides of the body differ',
    positive: 'left and right diverge; the pose reads as a person, not a diagram',
    negative: 'the pose tends toward mirror symmetry',
    compiles_to: 'a per-side amplitude difference',
    aspects: ['value'],
    implemented: false,
    blocked_by: 'needs a mirror-aware pose editor; `mirror_partner` exists in the Rig Graph but nothing yet edits one side relative to the other',
  },
  noise: {
    id: 'noise',
    summary: 'small irregular variation that is not part of the plan',
    positive: 'more texture and imperfection',
    negative: 'cleaner, more deliberate motion',
    compiles_to: 'nothing yet — this dimension exists to be REPORTED, not applied',
    aspects: ['value'],
    implemented: false,
    blocked_by: 'Part 69 (micro-animation and intentional imperfection) is Phase 8; adding noise before the analyzer that can tell it from a defect would be irresponsible',
  },
  contact_firmness: {
    id: 'contact_firmness',
    summary: 'how planted a contact reads',
    positive: 'feet and hands stay put and take load',
    negative: 'contacts float, slide, or barely touch',
    compiles_to: 'contact constraints and effector locking',
    aspects: ['value'],
    implemented: false,
    blocked_by: 'contact drift cannot be measured until Part 23 (Phase 5), so a firmness change could not be verified — it is planned and declared, never silently applied',
  },
  arc_smoothness: {
    id: 'arc_smoothness',
    summary: 'how continuous the path of a hand, foot or weapon is',
    positive: 'clean arcs, no corners',
    negative: 'angular, mechanical or deliberately broken paths',
    compiles_to: 'nothing yet',
    aspects: ['value'],
    implemented: false,
    blocked_by: 'arcs are trajectories, and trajectory analysis is Part 23 (Phase 5)',
  },
  recovery_speed: {
    id: 'recovery_speed',
    summary: 'how quickly the character returns to a neutral or ready state',
    positive: 'snaps back',
    negative: 'takes its time',
    compiles_to: 'easing on the recovery phase; the timing half needs key moves',
    aspects: ['easing', 'timing'],
    implemented: true,
  },
});

/** Dimensions that belong to VFX rather than body motion (Part 21 asks every term to name its
 *  "related VFX dimensions"). None of these compile yet — the VFX compiler is Part 37, Phase 6 —
 *  so they are carried on the term cards and reported, never applied. */
export const VFX_DIMENSIONS = Object.freeze({
  vfx_energy: { id: 'vfx_energy', summary: 'brightness, speed and force of an effect', implemented: false },
  vfx_density: { id: 'vfx_density', summary: 'how much of the screen the effect occupies', implemented: false },
  vfx_persistence: { id: 'vfx_persistence', summary: 'how long the effect lingers after its cause', implemented: false },
  vfx_directionality: { id: 'vfx_directionality', summary: 'how clearly the effect points somewhere', implemented: false },
  vfx_contrast: { id: 'vfx_contrast', summary: 'energy hierarchy — one bright moment against a restrained rest', implemented: false },
});

const VFX_BLOCKED = 'the VFX compiler is Part 37 (Phase 6); a VFX pull is reported so the intent is not lost, and applied by nothing';

export function isDimension(id) {
  return Object.prototype.hasOwnProperty.call(DIMENSIONS, id) || Object.prototype.hasOwnProperty.call(VFX_DIMENSIONS, id);
}

/** The edit aspects (`ai/constraints.js` ASPECTS) a dimension would have to touch to be applied.
 *  This is what lets a plan say "you locked timing, so `body_lead` cannot contribute" BEFORE
 *  compiling anything — a refusal at plan time is far more useful than a violation at apply time. */
export function dimensionAspects(id) {
  return DIMENSIONS[id]?.aspects ?? [];
}

// ---------------------------------------------------------------- the terms
//
// Part 21's card, per term. `dimensions` is the default interpretation; `pinned_zero` is the
// dimension a naive reading would move and this word specifically does NOT — the field exists
// because that is where most of the directive's warnings live.

const TERM_LIST = [
  {
    term: 'heavy',
    surface_forms: ['heavy', 'heavier', 'heaviness', 'weighty', 'weightier', 'ponderous', 'massive'],
    summary: 'mass that has to be moved, and that resists being stopped',
    candidate_meanings: [
      'the character or object has real mass and the body must commit to move it',
      'the impact has consequences — recoil, dust, a camera response',
      'the motion is emotionally weighty rather than physically heavy',
    ],
    dimensions: {
      weight_transfer: 0.6,
      acceleration_contrast: 0.5,
      body_lead: 0.5,
      anticipation_depth: 0.4,
      contact_firmness: 0.5,
      overshoot: 0.3,
      settle_duration: 0.4,
      motion_amplitude: 0.2,
      noise: -0.3,
    },
    pinned_zero: {
      duration: 'Heavy does not mean slow. The directive is explicit: "A sword slash may be extremely fast at impact and still read as heavy because of preparation, force transfer, body commitment, and aftermath." Total duration is left alone unless the request asks for it separately.',
    },
    vfx_dimensions: { vfx_energy: 0.3, vfx_persistence: 0.4, vfx_contrast: 0.3 },
    style_dependencies: {
      realistic: 'weight comes from mechanics — contact, counter-rotation, deceleration',
      anime: 'weight comes from contrast — a still wind-up against a violent strike',
      cartoon: 'weight comes from compression and recovery, and may break volume to get it',
      game_combat: 'weight must not cost responsiveness; the wind-up is expressed by pose more than by frames',
    },
    counterexamples: [
      'a heavy character sprinting — fast throughout, heavy because of contact and body commitment',
      'a slow floaty drift — slow but weightless, which is the opposite reading',
    ],
    failure_modes: [
      'slowing everything down, which reads as tired rather than heavy',
      'raising every amplitude at once, which loses the contrast that makes weight legible',
      'adding overshoot to a contact, which breaks the plant that sells the weight',
    ],
    evidence_needed: 'which part carries the mass — a weapon, the character, or a prop. Without it, weight is applied to the body and the report says so.',
  },
  {
    term: 'light',
    surface_forms: ['light', 'lighter', 'lightness', 'weightless', 'nimble', 'delicate'],
    summary: 'little mass to move; the body does not have to commit',
    candidate_meanings: [
      'the object is physically light',
      'the character is agile and moves without effort',
      'the moment is emotionally light — playful rather than grave',
    ],
    dimensions: {
      weight_transfer: -0.5,
      body_lead: -0.3,
      anticipation_depth: -0.3,
      contact_firmness: -0.3,
      motion_amplitude: -0.2,
      settle_duration: -0.3,
      acceleration_contrast: 0.1,
    },
    pinned_zero: {
      duration: 'light does not mean fast, any more than heavy means slow — a light motion can dawdle',
    },
    vfx_dimensions: { vfx_energy: -0.2, vfx_density: -0.3 },
    style_dependencies: { cartoon: 'light often means elastic and bouncy rather than merely small' },
    counterexamples: ['a light object thrown hard — the throw is still forceful; only the object is light'],
    failure_modes: ['shrinking every rotation until the action stops reading at all'],
    evidence_needed: 'whether "light" describes the character, the prop, or the mood.',
  },
  {
    term: 'snappy',
    surface_forms: ['snappy', 'snappier', 'snap', 'punchy', 'crisp', 'sharp', 'sharper'],
    summary: 'the move happens in one concentrated burst with a clean decision either side of it',
    candidate_meanings: [
      'timing is concentrated — most of the travel happens in a few frames',
      'interpolation is sharp rather than soft',
      'the character is decisive; there is no hesitation between poses',
    ],
    dimensions: {
      acceleration_contrast: 0.7,
      spacing_evenness: -0.5,
      recovery_speed: 0.5,
      settle_duration: -0.4,
      anticipation_depth: -0.3,
      hold_length: 0.2,
      noise: -0.2,
    },
    pinned_zero: {
      follow_through: 'Snappy is not "delete the follow-through". The directive: "Snappy does not mean adding random discontinuities or deleting all follow-through." Existing overlap is preserved; only its spacing sharpens.',
    },
    vfx_dimensions: { vfx_contrast: 0.5, vfx_persistence: -0.3 },
    style_dependencies: {
      anime: 'snap can be near-instant, with holds either side doing the reading',
      realistic: 'snap is bounded by what a body can accelerate; past that it reads as a glitch',
    },
    counterexamples: ['a snappy idle — small, but still concentrated; snappiness is not size'],
    failure_modes: [
      'using Constant/stepped interpolation everywhere, which reads as broken rather than sharp',
      'removing the ease into a contact, which loses the plant',
    ],
    evidence_needed: 'which transition should snap. Applied to every transition at once, nothing stands out.',
  },
  {
    term: 'floaty',
    surface_forms: ['floaty', 'floatier', 'float', 'weightlessly', 'drifting', 'hanging', 'dreamlike'],
    summary: 'suspension — the motion is not fighting gravity or the ground',
    candidate_meanings: [
      'deliberate: magic, underwater, dream, low gravity, an airborne hang',
      'accidental: soft interpolation everywhere with no contrast, which reads as unfinished',
    ],
    dimensions: {
      acceleration_contrast: -0.6,
      contact_firmness: -0.5,
      settle_duration: 0.5,
      secondary_delay: 0.5,
      spacing_evenness: 0.4,
      arc_smoothness: 0.4,
      hold_length: 0.3,
    },
    pinned_zero: {
      quality: 'Floaty is not a defect by default. "It can be appropriate for magic, underwater, dreamlike, or airborne motion." A review must not flag floatiness without knowing the intent.',
    },
    vfx_dimensions: { vfx_persistence: 0.5, vfx_energy: -0.2 },
    style_dependencies: { game_combat: 'floaty conflicts with hit clarity; expect a tension with readability' },
    counterexamples: ['a heavy object falling slowly through water — floaty spacing, heavy mass'],
    failure_modes: ['applying it to a grounded contact, which turns a plant into a slide'],
    evidence_needed: 'whether the character is grounded during the range. Floating a planted foot is a contact break, not a style.',
  },
  {
    term: 'panicked',
    surface_forms: ['panicked', 'panicky', 'panic', 'frantic', 'desperate', 'terrified', 'flustered'],
    summary: 'the body acting faster than the decision behind it',
    candidate_meanings: [
      'reactive: the character is responding, not choosing',
      'unstable: balance is not being maintained deliberately',
      'self-protective: the pose closes in rather than opening out',
    ],
    dimensions: {
      spacing_evenness: -0.6,
      asymmetry: 0.5,
      acceleration_contrast: 0.5,
      anticipation_depth: -0.5,
      recovery_speed: 0.4,
      motion_amplitude: 0.3,
      arc_smoothness: -0.3,
      noise: 0.2,
    },
    pinned_zero: {
      randomness: 'Jitter is not panic. The directive: "Panicked must remain readable; random jitter alone is not panic." The `noise` pull is deliberately small and, in this build, applies to nothing.',
    },
    vfx_dimensions: { vfx_directionality: -0.3 },
    style_dependencies: { cinematic: 'panic reads through the head and eyes first, which this rig may not have' },
    counterexamples: ['a trained fighter under pressure — fast and irregular, but still deciding; that is urgency, not panic'],
    failure_modes: ['irregular timing with no readable pose, which is noise rather than performance'],
    evidence_needed: 'what the character is reacting to, so the direction of the recoil is not invented.',
  },
  {
    term: 'elegant',
    surface_forms: ['elegant', 'graceful', 'gracefully', 'refined', 'poised', 'flowing'],
    summary: 'nothing wasted, and the path of every part is intentional',
    candidate_meanings: [
      'clean arcs and continuous paths',
      'economy — no movement that is not doing work',
      'controlled secondary motion rather than absent secondary motion',
    ],
    dimensions: {
      arc_smoothness: 0.6,
      noise: -0.5,
      spacing_evenness: 0.3,
      secondary_delay: 0.2,
      motion_amplitude: -0.1,
      acceleration_contrast: 0.1,
      asymmetry: 0.1,
    },
    pinned_zero: {
      lifelessness: 'Elegant is not "smooth everything". Part 26.6: smoothness "can make combat weak, timing vague, and stylized animation lifeless." Acceleration contrast stays slightly positive on purpose.',
    },
    vfx_dimensions: { vfx_density: -0.3, vfx_contrast: 0.2 },
    style_dependencies: { mechanical: 'elegance in a machine means geometric precision, not organic arcs — the arc pull inverts' },
    counterexamples: ['a brutal but elegant strike — economy of motion with maximum force'],
    failure_modes: ['symmetry, which reads as a mannequin rather than as poise'],
    evidence_needed: 'the style profile — elegance in an organic character and in a machine want opposite arc treatment.',
  },
  {
    term: 'powerful',
    surface_forms: ['powerful', 'forceful', 'strong', 'stronger', 'explosive', 'violent'],
    summary: 'force delivered, and visibly transferred through the body into something',
    candidate_meanings: ['physical force at an impact', 'authority and presence without an impact at all'],
    dimensions: {
      acceleration_contrast: 0.6,
      body_lead: 0.5,
      weight_transfer: 0.4,
      motion_amplitude: 0.3,
      contact_firmness: 0.4,
      overshoot: 0.2,
    },
    pinned_zero: {
      amplitude_alone: 'Power is not "make everything bigger". Part 26.10: exaggeration "selects and amplifies important visual facts" — something must stay restrained for the force to read.',
    },
    vfx_dimensions: { vfx_energy: 0.5, vfx_contrast: 0.4, vfx_directionality: 0.4 },
    style_dependencies: { game_combat: 'power is read at the hit frame; anything that delays the hit costs more than it adds' },
    counterexamples: ['a small precise strike that is powerful because of what it does, not how big it is'],
    failure_modes: ['adding camera shake to stand in for force the body never generated'],
    evidence_needed: 'where the force lands. Without a target, power is applied to the body and nothing receives it.',
  },
  {
    term: 'aggressive',
    surface_forms: ['aggressive', 'aggressively', 'angry', 'brutal', 'savage', 'relentless'],
    summary: 'forward intent — the character is closing distance and committing',
    candidate_meanings: ['forward, target-directed motion', 'emotional aggression without physical advance'],
    dimensions: {
      acceleration_contrast: 0.5,
      motion_amplitude: 0.4,
      recovery_speed: 0.4,
      anticipation_depth: -0.2,
      settle_duration: -0.3,
      asymmetry: 0.2,
    },
    pinned_zero: {},
    vfx_dimensions: { vfx_energy: 0.4, vfx_directionality: 0.3 },
    style_dependencies: {},
    counterexamples: ['a patient, controlled aggression — held poses, no wasted motion'],
    failure_modes: ['speed without direction, which reads as flailing'],
    evidence_needed: 'the target, so "forward" has a meaning.',
  },
  {
    term: 'weary',
    surface_forms: ['weary', 'tired', 'exhausted', 'sluggish', 'drained', 'worn'],
    summary: 'the body is paying for every movement',
    candidate_meanings: ['physical fatigue', 'emotional defeat'],
    dimensions: {
      motion_amplitude: -0.3,
      acceleration_contrast: -0.4,
      settle_duration: 0.4,
      recovery_speed: -0.5,
      secondary_delay: 0.3,
      asymmetry: 0.3,
      body_lead: -0.2,
    },
    pinned_zero: {
      heaviness: 'Weary and heavy are different words. Weariness lowers acceleration contrast; heaviness raises it. Confusing them is the most common way "heavy" gets implemented wrongly.',
    },
    vfx_dimensions: { vfx_energy: -0.4 },
    style_dependencies: {},
    counterexamples: ['an exhausted fighter throwing one last full-force punch'],
    failure_modes: ['uniform slowness, which reads as a frame-rate problem rather than as fatigue'],
    evidence_needed: 'nothing beyond the range to apply it to.',
  },
  {
    term: 'subtle',
    surface_forms: ['subtle', 'subtler', 'understated', 'restrained', 'minimal', 'small'],
    summary: 'the same intent, expressed with less',
    candidate_meanings: ['smaller amplitude', 'fewer simultaneous ideas rather than smaller ones'],
    dimensions: {
      motion_amplitude: -0.5,
      noise: -0.2,
      acceleration_contrast: -0.1,
      anticipation_depth: -0.3,
    },
    pinned_zero: {
      readability: 'Subtlety is bounded by the camera. Part 26.3: if the action stops reading in frame, it is not subtle, it is missing.',
    },
    vfx_dimensions: { vfx_density: -0.5, vfx_energy: -0.3 },
    style_dependencies: {},
    counterexamples: ['a subtle change of weight before a huge action'],
    failure_modes: ['scaling down the key pose that carries the meaning'],
    evidence_needed: 'which part of the motion should stay full size.',
  },
  {
    term: 'dangerous',
    surface_forms: ['dangerous', 'menacing', 'threatening', 'ominous', 'lethal'],
    summary: 'mostly a VFX and staging word — the directive discusses it under "dangerous or powerful VFX"',
    candidate_meanings: ['the effect reads as capable of harm', 'the character reads as capable of harm'],
    dimensions: {
      acceleration_contrast: 0.3,
      motion_amplitude: -0.1,
      hold_length: 0.3,
      noise: -0.2,
    },
    pinned_zero: {
      glow: 'Part 21: "energy hierarchy rather than uniform glow". Making everything brighter is the failure, not the effect.',
    },
    vfx_dimensions: { vfx_contrast: 0.6, vfx_directionality: 0.5, vfx_energy: 0.4, vfx_density: -0.2 },
    style_dependencies: { horror: 'danger reads through restraint and timing, not through energy' },
    counterexamples: ['a still character who is dangerous because of what the scene has established'],
    failure_modes: ['adding energy everywhere, which flattens the hierarchy that makes one moment threatening'],
    evidence_needed: 'this term mostly moves VFX dimensions, and no VFX dimension compiles yet — expect it to be reported rather than applied.',
  },
];

export const TERMS = Object.freeze(Object.fromEntries(TERM_LIST.map((t) => [t.term, Object.freeze(t)])));

/** Surface form → term id. Built once; used by `ai/intent.js` to find terms in a request. */
const SURFACE = new Map();
for (const t of TERM_LIST) for (const f of t.surface_forms) SURFACE.set(f, t.term);

export function termFor(word) {
  return SURFACE.get(String(word).toLowerCase()) || null;
}

/** Every surface form the lexicon knows, longest first — so "less heavy" is matched before "heavy"
 *  by a caller scanning a phrase. */
export function surfaceForms() {
  return [...SURFACE.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

// ---------------------------------------------------------------- overrides
//
// Part 21 wants a term to be user-editable, and Part 4.8 forbids silently rewriting a definition.
// Both are satisfied the same way: the table above is frozen, and an override is a separate,
// scoped, evidenced record that `interpret()` layers on top and always names in its output.

const SCOPES = Object.freeze(['project', 'character', 'style']);

function store(project, { create = false } = {}) {
  if (!project.semantics) {
    if (!create) return null;
    project.semantics = {};
  }
  if (!project.semantics.vocabulary) {
    if (!create) return null;
    project.semantics.vocabulary = { entries: [] };
  }
  return project.semantics.vocabulary;
}

export function listOverrides(project) {
  return store(project)?.entries ?? [];
}

/**
 * Record a scoped reinterpretation of a term.
 *
 * `evidence` is required and is not decoration: Part 21 asks for the correction to be captured
 * *with* its evidence, and Part 58 turns repeated corrections into a lesson. An override nobody
 * can justify later is one nobody can safely remove later either.
 *
 * `dimensions` are DELTAS against the global default, not replacements — so a user who says "for
 * this character, heavy should not raise amplitude" writes `{ motion_amplitude: -0.2 }` and still
 * inherits every future improvement to the shared definition.
 */
export function setTerm(project, term, { dimensions = {}, scope = 'project', scopeId = null, note = null, evidence: ev = [], author = 'user', createdAt = null } = {}) {
  if (!TERMS[term]) throw new TypeError(`setTerm: "${term}" is not a known term — see TERMS in renderer/js/ai/vocabulary.js`);
  if (!SCOPES.includes(scope)) throw new TypeError(`setTerm: scope must be one of ${SCOPES.join(', ')} (got ${JSON.stringify(scope)})`);
  if (scope !== 'project' && !scopeId) throw new TypeError(`setTerm: a "${scope}" override needs a scopeId (the item id, or the style name)`);
  if (!Array.isArray(ev) || !ev.length) {
    throw new TypeError('setTerm: an override needs at least one piece of evidence — Part 21 asks for a scoped preference captured WITH its evidence, not a silent redefinition');
  }
  for (const [d, v] of Object.entries(dimensions)) {
    if (!isDimension(d)) throw new TypeError(`setTerm: "${d}" is not a known dimension — see DIMENSIONS in renderer/js/ai/vocabulary.js`);
    if (typeof v !== 'number' || !Number.isFinite(v) || v < -2 || v > 2) {
      throw new TypeError(`setTerm: dimension "${d}" must be a finite delta in [-2, 2] (got ${JSON.stringify(v)})`);
    }
  }
  if (!Object.keys(dimensions).length && !note) {
    throw new TypeError('setTerm: an override must change at least one dimension or carry a note');
  }

  const s = store(project, { create: true });
  const entry = {
    id: null, term, scope, scope_id: scopeId, dimensions: { ...dimensions }, note,
    evidence: ev, author, created_at: createdAt, observations: 1,
  };
  entry.id = `vocab:${shortHash(contentHash({ ...entry, id: null, created_at: null, observations: null }))}`;

  // The same correction made twice is one preference observed twice, not two preferences. The
  // count is what Part 58 needs to tell a one-off from a convention, so it is kept rather than
  // the duplicate being dropped silently.
  const existing = s.entries.find((e) => e.id === entry.id);
  if (existing) {
    existing.observations = (existing.observations || 1) + 1;
    return existing;
  }
  s.entries.push(entry);
  return entry;
}

/** Remove one override. Deletes the container when it empties — `{}` and absent hash differently,
 *  and an empty container would make the next save read as an edit. */
export function clearTerm(project, id) {
  const s = store(project);
  if (!s) return false;
  const i = s.entries.findIndex((e) => e.id === id);
  if (i < 0) return false;
  s.entries.splice(i, 1);
  if (!s.entries.length) {
    delete project.semantics.vocabulary;
    if (!Object.keys(project.semantics).length) delete project.semantics;
  }
  return true;
}

function applicableOverrides(project, term, { itemId = null, style = null } = {}) {
  return listOverrides(project).filter((e) => e.term === term
    && (e.scope === 'project'
      || (e.scope === 'character' && itemId && e.scope_id === itemId)
      || (e.scope === 'style' && style && e.scope_id === style)));
}

// ---------------------------------------------------------------- interpretation

/**
 * Combine two pulls on the same dimension.
 *
 * Same sign: a saturating (probabilistic-OR) combine, so "heavy and powerful" is more than either
 * alone but never runs away past 1. A plain sum would let three overlapping words demand double
 * the maximum amplitude the compiler can produce, and the clamp would then silently discard the
 * difference — the caller would never learn that a word did nothing.
 *
 * Opposite signs: a plain sum, because they genuinely cancel, and the cancellation is real
 * information ("heavy but floaty" mostly annihilates acceleration contrast, and should).
 */
function combine(a, b) {
  if (a === 0) return b;
  if (b === 0) return a;
  if ((a > 0) === (b > 0)) {
    const s = Math.sign(a), x = Math.abs(a), y = Math.abs(b);
    return s * (x + y - x * y);
  }
  return a + b;
}

/**
 * Combine any number of pulls on one dimension, with the same rule `interpret()` uses.
 *
 * Exported because the compiler needs it for a different reason and must not invent a second rule:
 * three separate amplitude edits landing on the same joint have to resolve to one scale factor, and
 * the alternatives are both wrong — multiplying them compounds past anything asked for, and letting
 * the last write win discards the largest pull in favour of whichever happened to be built last.
 */
export function combinePulls(pulls) {
  return round3(clamp1(pulls.reduce((acc, p) => combine(acc, p), 0)));
}

const clamp1 = (v) => Math.max(-1, Math.min(1, v));

/**
 * Interpret a set of weighted terms into a dimension vector, with the reasoning kept.
 *
 * @param terms  `[{ term, weight }]` — weight is the intensity modifier the request carried
 *               ("slightly" 0.5, plain 1, "much more" 1.5) and its sign is the polarity
 *               ("less heavy" is `{ term:'heavy', weight:-1 }`).
 * @param opts.itemId / opts.style  scope keys for overrides
 *
 * Returns `{ dimensions, vfx_dimensions, contributions, tensions, terms, overrides_applied,
 *            unknown_terms, notRun, findings }`.
 *
 * `dimensions` is the answer. `contributions` is why. `tensions` is what the caller has to decide,
 * because this function will not decide it for them.
 */
export function interpret(project, terms, { itemId = null, style = null } = {}) {
  const dims = {};
  const vfx = {};
  const contributions = {};
  const overridesApplied = [];
  const unknown = [];
  const used = [];

  for (const raw of terms || []) {
    const id = typeof raw === 'string' ? raw : raw.term;
    const weight = typeof raw === 'string' ? 1 : (raw.weight ?? 1);
    const card = TERMS[id] || (termFor(id) ? TERMS[termFor(id)] : null);
    if (!card) { unknown.push(id); continue; }
    used.push({ term: card.term, weight, summary: card.summary });

    const overrides = applicableOverrides(project, card.term, { itemId, style });
    const merged = { ...card.dimensions };
    for (const o of overrides) {
      for (const [d, v] of Object.entries(o.dimensions)) merged[d] = (merged[d] ?? 0) + v;
      overridesApplied.push({ id: o.id, term: o.term, scope: o.scope, scope_id: o.scope_id, note: o.note, observations: o.observations });
    }

    for (const [d, base] of Object.entries(merged)) {
      const pull = clamp1(base * weight);
      if (!pull) continue;
      dims[d] = combine(dims[d] ?? 0, pull);
      (contributions[d] = contributions[d] || []).push({ term: card.term, pull: round3(pull), weight });
    }
    for (const [d, base] of Object.entries(card.vfx_dimensions || {})) {
      const pull = clamp1(base * weight);
      if (!pull) continue;
      vfx[d] = combine(vfx[d] ?? 0, pull);
      (contributions[d] = contributions[d] || []).push({ term: card.term, pull: round3(pull), weight });
    }
  }

  for (const d of Object.keys(dims)) dims[d] = round3(clamp1(dims[d]));
  for (const d of Object.keys(vfx)) vfx[d] = round3(clamp1(vfx[d]));

  // A dimension pulled in both directions by different words. Reported, never resolved — the
  // combined number is still returned, but a caller that acts on it without reading this is
  // acting on an average of two contradictory instructions.
  const tensions = [];
  for (const [d, list] of Object.entries(contributions)) {
    const pos = list.filter((c) => c.pull > 0), neg = list.filter((c) => c.pull < 0);
    if (pos.length && neg.length) {
      tensions.push({
        dimension: d,
        net: dims[d] ?? vfx[d] ?? 0,
        pushing_up: pos.map((c) => c.term),
        pushing_down: neg.map((c) => c.term),
        question: `"${pos.map((c) => c.term).join('/')}" wants more ${d} and "${neg.map((c) => c.term).join('/')}" wants less. Which should win?`,
      });
    }
  }

  const notRun = [];
  const findings = [];
  for (const d of Object.keys(dims)) {
    const spec = DIMENSIONS[d];
    if (spec && !spec.implemented) {
      notRun.push(`dimension "${d}" (${spec.summary}): ${spec.blocked_by}`);
      findings.push(finding({
        id: 'VOCAB-DIMENSION-NOT-COMPILABLE',
        certainty: CERTAINTY.CERTAIN,
        statement: `"${d}" is part of what these words mean, and nothing in this build can apply it.`,
        evidence: [evidence('absence', spec.blocked_by, `requested pull ${dims[d]}`)],
      }));
    }
  }
  for (const d of Object.keys(vfx)) {
    notRun.push(`VFX dimension "${d}": ${VFX_BLOCKED}`);
  }

  for (const t of used) {
    const card = TERMS[t.term];
    for (const [k, why] of Object.entries(card.pinned_zero || {})) {
      findings.push(finding({
        id: 'VOCAB-PINNED-ZERO',
        certainty: CERTAINTY.CERTAIN,
        statement: `"${t.term}" deliberately does NOT change ${k}.`,
        evidence: [evidence('convention', why)],
      }));
    }
  }

  return {
    dimensions: dims,
    vfx_dimensions: vfx,
    contributions,
    tensions,
    terms: used,
    overrides_applied: overridesApplied,
    unknown_terms: unknown,
    notRun,
    findings,
  };
}

function round3(v) { return Math.round(v * 1000) / 1000; }

/**
 * The interpretation in prose, in the shape Part 20.1 asks for:
 *
 *     Interpretation of "extremely heavy but explosive":
 *     - preparation uses visible weight transfer rather than slow overall motion;
 *     - …
 *
 * Every line is generated from the dimension vector, so the prose and the plan cannot disagree —
 * which is the entire reason this is not a hand-written string somewhere in the UI.
 */
export function explain(interpretation, { phrase = null } = {}) {
  const lines = [];
  const entries = Object.entries(interpretation.dimensions)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  for (const [d, v] of entries) {
    const spec = DIMENSIONS[d];
    if (!spec) continue;
    const dir = v > 0 ? spec.positive : spec.negative;
    const strength = Math.abs(v) >= 0.6 ? 'strongly' : Math.abs(v) >= 0.3 ? '' : 'slightly';
    const applied = spec.implemented ? '' : ' — planned only, nothing in this build applies it';
    lines.push(`${[strength, dir].filter(Boolean).join(' ')} (${d} ${v > 0 ? '+' : ''}${v})${applied}`);
  }
  for (const [d, v] of Object.entries(interpretation.vfx_dimensions)) {
    lines.push(`${VFX_DIMENSIONS[d]?.summary ?? d} ${v > 0 ? 'up' : 'down'} (${d} ${v > 0 ? '+' : ''}${v}) — VFX, not applied by this build`);
  }
  for (const t of interpretation.terms) {
    for (const [k, why] of Object.entries(TERMS[t.term]?.pinned_zero || {})) {
      lines.push(`${k}: unchanged on purpose — ${why}`);
    }
  }
  const header = phrase ? `Interpretation of "${phrase}":` : 'Interpretation:';
  return { header, lines, text: [header, ...lines.map((l) => `- ${l};`)].join('\n') };
}

/** The whole table, with any project overrides marked — what `animation_vocabulary` returns. */
export function vocabulary(project = null, { itemId = null, style = null } = {}) {
  return {
    dimensions: Object.values(DIMENSIONS).map((d) => ({ ...d })),
    vfx_dimensions: Object.values(VFX_DIMENSIONS).map((d) => ({ ...d, blocked_by: VFX_BLOCKED })),
    terms: Object.values(TERMS).map((t) => ({
      ...t,
      overrides: project ? applicableOverrides(project, t.term, { itemId, style }) : [],
    })),
    scopes: SCOPES,
    how_terms_combine: 'same-sign pulls saturate (never past 1, so no word is silently discarded by a clamp); opposite-sign pulls sum and are additionally reported as a tension for the caller to resolve',
    editing: 'set_vocabulary_term writes a scoped DELTA against the shared definition and requires evidence. The definitions above are never overwritten.',
  };
}
