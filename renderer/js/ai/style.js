// Part 35 — style-aware reasoning. STY-001's success text names the gap this file closes: "Style
// profiles change thresholds, not just labels."
//
// Before this file, a style profile was already wired end to end architecturally and did nothing
// numerically. `ai/cal.js` declares the ten-value `STYLE_PROFILES` enum and `IntentSpec` carries
// `style_profile`; `ai/intent.js` detects a style word in a request or accepts one explicitly and
// passes it to `ai/vocabulary.js interpret()`; `vocabulary.js` even carries a `style_dependencies`
// prose note on several terms ("mechanical: elegance means geometric precision, not organic arcs —
// the arc pull inverts"). None of that prose was ever read by code — a style was a LABEL that
// travelled the whole pipeline and was never consulted. That is exactly what the directive's
// success condition calls out.
//
// This module is the numeric table `style_dependencies` was gesturing at. `dimensionModifier`
// returns a real multiplier that `vocabulary.js interpret()` now applies to every dimension pull
// BEFORE combining terms — so the same word, "heavy", produces a measurably different amplitude
// pull for a `mechanical` project than for a `cartoon` one. That is a threshold changing, not a
// label being attached.
//
// Two decisions worth stating before the table, because both were live choices:
//
//   * **A style is declared, never inferred as a default.** `resolveStyle` returns `null` for a
//     project that never called `setStyle` — the same "no default" shape `ai/modes.js` uses for
//     `DEFAULT_MODE`, and for the same reason: an unstated style getting a default treatment would
//     make the safest reading the one nobody chose. `'unspecified'` is a DIFFERENT thing from
//     `null` — it is an explicit declaration that no style bias should apply, which is itself an
//     approved decision Part 62 asks for, not silence.
//   * **The table only touches vocabulary dimensions.** Part 35 also lists camera, VFX, lighting
//     and "evaluation thresholds" as things style should influence. Cadence's acceptance checks
//     (`ai/cal.js ACCEPTANCE_CHECKS`) already take their tolerances as explicit per-call arguments
//     rather than a hard-coded default, so there is no default threshold left for a style to shift
//     there — parameterising something that is already a caller-supplied number would be
//     decoration. VFX dimensions and camera/staging are named absent below rather than given
//     numbers with no textual basis in Part 35 to justify them.
//
// Pure at load like the rest of `ai/`.

import { STYLE_PROFILES } from './cal.js';

export { STYLE_PROFILES };

/**
 * Per-style multipliers on `ai/vocabulary.js DIMENSIONS`. A value above 1 amplifies the pull a
 * term already has on that dimension; below 1 dampens it; omission means "no stated bias" (1×) —
 * silence here means the directive gave no basis for a number, not that the style has no opinion.
 *
 * Every multiplier below traces to a sentence in Part 35's own description of that style, cited in
 * `why`, so a reader can check the number against the text rather than trusting it verbatim.
 */
export const STYLE_MODIFIERS = Object.freeze({
  realistic: {
    why: 'Part 35: "plausible mechanics, subtlety, physical continuity, restrained timing, and performance truth."',
    modifiers: {
      motion_amplitude: 0.8, overshoot: 0.55, hold_length: 0.7, acceleration_contrast: 0.85,
    },
  },
  anime: {
    why: 'Part 35: "stronger posing, exaggerated spacing, dramatic timing contrast, impact freezes, stylized camera movement, and larger visual hierarchy shifts."',
    modifiers: {
      acceleration_contrast: 1.4, hold_length: 1.6, motion_amplitude: 1.3, overshoot: 1.2, settle_duration: 0.75,
    },
  },
  cartoon: {
    why: 'Part 35: "broader shape changes, squash/stretch, rhythmic timing, elastic recovery, clear graphic silhouettes, and deliberate nonphysicality."',
    modifiers: {
      overshoot: 1.6, motion_amplitude: 1.4, recovery_speed: 1.3, spacing_evenness: 1.2,
    },
  },
  game_combat: {
    why: 'Part 35: "readability, responsiveness, hit clarity, input timing, target awareness, camera compatibility, and controlled anticipation."',
    modifiers: {
      anticipation_depth: 0.6, acceleration_contrast: 1.2, settle_duration: 0.55, recovery_speed: 1.3,
    },
  },
  cinematic: {
    why: 'Part 35: "composition, emotional performance, staging, shot continuity, camera language, and mood." Cinematic style is mostly about camera and staging, which this build cannot measure (no active-camera model — see EXPT-blocked reasons elsewhere); the body-motion bias is intentionally small.',
    modifiers: {
      settle_duration: 1.2, secondary_delay: 1.1,
    },
  },
  mechanical: {
    why: 'Part 35: "intentional axis logic, geometric paths, constrained motion, repeatability, and purposeful lack of organic overlap."',
    modifiers: {
      secondary_delay: 0.1, spacing_evenness: 1.4, overshoot: 0.2, asymmetry: 0.2, noise: 0.3,
    },
  },
  horror: {
    why: 'Part 35: "altered biomechanics, unexpected timing, impossible trajectories, or unusual VFX behavior when they support the genre."',
    modifiers: {
      arc_smoothness: 0.4, spacing_evenness: 0.5, noise: 1.5,
    },
  },
  fantasy: {
    why: 'Part 35: "impossible trajectories... when they support the genre" — read here as licence for ungrounded, lingering motion rather than horror\'s abruptness.',
    modifiers: {
      contact_firmness: 0.6, settle_duration: 1.3, overshoot: 1.2,
    },
  },
  abstract: {
    why: 'Part 35 groups abstract with horror/fantasy as "permit... when they support the genre" but gives no dimension-specific text for it the way it does for every other profile. Rather than invent a number with nothing to check it against, abstract applies no bias — declaring it still records that the shot is explicitly exempt from every OTHER style\'s assumptions.',
    modifiers: {},
  },
  unspecified: {
    why: 'An explicit declaration that no style bias should apply — different from no declaration at all (see resolveStyle).',
    modifiers: {},
  },
});

const VOCAB_STYLE_NOT_APPLIED = [
  'VFX dimensions (vfx_energy, vfx_density, vfx_persistence, vfx_directionality, vfx_contrast) carry no style modifier — Part 35 asks style to influence VFX, but none of vocabulary.js\'s VFX_DIMENSIONS compile to anything yet (the VFX compiler targets a declarative VFXSpec, Part 37-39, not a vocabulary pull), so a modifier on a number nothing consumes would be decoration.',
  'Camera and lighting bias (cinematic\'s real subject) is not modelled: there is no active-camera IntentSpec field and no lighting in Cadence at all.',
  '`ai/cal.js` ACCEPTANCE_CHECKS take their tolerances as explicit per-call arguments rather than a hard-coded default, so there is no default threshold for a style to shift there.',
  '`ai/review.js` suggestions are not annotated against a style\'s acceptable-imperfection text. `acceptableImperfection()` below is real prose grounded in Part 35, but nothing yet cross-references a review finding against it.',
];

/** True for any of cal.js's ten declared profiles. */
export function isStyle(name) {
  return typeof name === 'string' && STYLE_PROFILES.includes(name);
}

/** The multiplier a style applies to one vocabulary dimension's pull. 1 (no bias) for an
 *  unrecognised style/dimension pair or for `null` — never a throw, since a caller building a
 *  report for every dimension should not have to special-case the ones a style has no opinion on. */
export function dimensionModifier(styleName, dimensionId) {
  if (!styleName || !STYLE_MODIFIERS[styleName]) return 1;
  const m = STYLE_MODIFIERS[styleName].modifiers[dimensionId];
  return typeof m === 'number' ? m : 1;
}

/** Part 35's "acceptable imperfection" for a style, as prose. Not consumed by `ai/review.js` yet —
 *  see `styleLimitations()`. */
export function acceptableImperfection(styleName) {
  if (!styleName || !STYLE_MODIFIERS[styleName]) return null;
  return STYLE_MODIFIERS[styleName].why;
}

// ---------------------------------------------------------------- declared project style

function store(project, { create = false } = {}) {
  if (!project.semantics) {
    if (!create) return null;
    project.semantics = {};
  }
  return project.semantics;
}

/** The project's declared style, or `null` if none was ever set — see the header for why `null`
 *  and `'unspecified'` are different states, both legitimate. */
export function resolveStyle(project) {
  return project?.semantics?.style?.name ?? null;
}

/**
 * Declare (or change) the project's approved style. Part 62's success condition is "adapt a new
 * animation using APPROVED project style" — this is the one place that approval is recorded, and
 * every other caller (`ai/vocabulary.js interpret()`, chiefly) reads it rather than re-deciding it.
 */
export function setStyle(project, name, { note = null, author = 'user', createdAt = null } = {}) {
  if (!isStyle(name)) throw new TypeError(`setStyle: "${name}" is not one of cal.js's STYLE_PROFILES (${STYLE_PROFILES.join(', ')})`);
  const s = store(project, { create: true });
  s.style = { name, note, author, set_at: createdAt };
  return { ...s.style };
}

/** Withdraw the declared style. After this, `resolveStyle` returns `null` again — back to "no
 *  style was ever approved", not `'unspecified'`, because clearing a declaration is not the same
 *  act as declaring "no bias on purpose". */
export function clearStyle(project) {
  const s = store(project);
  if (!s || !s.style) return false;
  delete s.style;
  if (!Object.keys(s).length) delete project.semantics;
  return true;
}

/** The whole table, for the `style_profile` MCP tool. */
export function styleCatalogue(project = null) {
  return {
    profiles: STYLE_PROFILES.map((name) => ({
      name,
      why: STYLE_MODIFIERS[name]?.why ?? null,
      dimension_modifiers: { ...(STYLE_MODIFIERS[name]?.modifiers ?? {}) },
    })),
    active: project ? resolveStyle(project) : null,
    active_declaration: project?.semantics?.style ? { ...project.semantics.style } : null,
    editing: 'set_project_style declares or changes the approved style; there is no default. Every declaration is a project-state edit like any other and is undoable.',
  };
}

export function styleLimitations() {
  return [...VOCAB_STYLE_NOT_APPLIED];
}
