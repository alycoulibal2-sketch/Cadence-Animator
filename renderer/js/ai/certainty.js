// The certainty taxonomy (directive Part 13) and the evidence shape every semantic-layer result
// must carry (Part 50: "Every analysis tool must return both a human-readable explanation and
// structured evidence. Avoid an API that only returns prose.").
//
// This module is deliberately tiny and has no dependencies. Its job is to make it awkward to
// return an unlabelled claim — a finding without a certainty level throws, so the failure shows
// up in a test rather than as a confident-sounding sentence in a report.

/**
 * Part 13, in the directive's own order of decreasing determinism.
 *
 *   certain              directly supported by deterministic data
 *   highly_likely        several signals agree, but interpretation is involved
 *   possible             plausible and underdetermined
 *   subjective           an artistic or stylistic opinion
 *   user_intent_required the system cannot safely decide
 *
 * Part 13 closes with a rule this module exists to make checkable: "Do not automatically modify
 * anything classified as subjective or user-intent-required."
 */
export const CERTAINTY = Object.freeze({
  CERTAIN: 'certain',
  HIGHLY_LIKELY: 'highly_likely',
  POSSIBLE: 'possible',
  SUBJECTIVE: 'subjective',
  USER_INTENT_REQUIRED: 'user_intent_required',
});

const LEVELS = Object.freeze(Object.values(CERTAINTY));
const RANK = Object.freeze(Object.fromEntries(LEVELS.map((l, i) => [l, i])));

/** True only for levels a system may act on without asking. */
export function isActionable(level) {
  return level === CERTAINTY.CERTAIN || level === CERTAINTY.HIGHLY_LIKELY || level === CERTAINTY.POSSIBLE;
}

/** True for the two levels Part 13 forbids acting on automatically. */
export function requiresUser(level) {
  return level === CERTAINTY.SUBJECTIVE || level === CERTAINTY.USER_INTENT_REQUIRED;
}

/** Rank for sorting: 0 = certain. Unknown levels sort last rather than throwing, so a report
 *  built from mixed sources still renders. Construction is where an unknown level is rejected. */
export function certaintyRank(level) {
  return RANK[level] ?? LEVELS.length;
}

export function isCertaintyLevel(level) {
  return Object.prototype.hasOwnProperty.call(RANK, level);
}

/**
 * One piece of evidence. `kind` says what sort of thing it is, which is how a reader can tell a
 * measured number from a naming convention from a guess:
 *
 *   measurement  a number this code computed from project data
 *   data         a value read directly out of the project
 *   convention   a naming or structural convention the code matched
 *   absence      something that is NOT present (a real and often decisive kind of evidence)
 *   inference    a conclusion drawn from other evidence
 *   assumption   something taken on faith, stated so it can be challenged
 */
export function evidence(kind, statement, detail = null) {
  if (!EVIDENCE_KINDS.has(kind)) {
    throw new TypeError(`evidence: unknown kind "${kind}" (expected one of ${[...EVIDENCE_KINDS].join(', ')})`);
  }
  const e = { kind, statement };
  if (detail !== null && detail !== undefined) e.detail = detail;
  return e;
}

const EVIDENCE_KINDS = new Set(['measurement', 'data', 'convention', 'absence', 'inference', 'assumption']);

/**
 * A finding: a labelled claim with its evidence. Every semantic-layer result that asserts
 * something about the project returns these rather than prose.
 *
 * `certainty` is required and validated. That is the whole point of the module — an unlabelled
 * claim cannot be constructed, so it cannot reach a report.
 */
export function finding({ id, certainty, statement, evidence: ev = [], target = null, frame = null, suggestion = null }) {
  if (!isCertaintyLevel(certainty)) {
    throw new TypeError(`finding "${id}": certainty must be one of ${LEVELS.join(', ')} (got ${JSON.stringify(certainty)})`);
  }
  if (!statement) throw new TypeError(`finding "${id}": a statement is required`);
  const f = { id, certainty, statement, evidence: ev };
  if (target) f.target = target;
  if (frame !== null && frame !== undefined) f.frame = frame;
  if (suggestion) {
    // Part 12: "distinguish fact, inference, heuristic, and preference" — a suggestion is not a
    // finding, and is never allowed to inherit the finding's certainty by proximity.
    f.suggestion = { text: suggestion.text ?? String(suggestion), reversible: suggestion.reversible ?? null };
  }
  return f;
}

/**
 * What a result actually examined (directive Part 15: never let a fast-loop check imply a full
 * validation). Attached to every semantic-layer result so a reader never has to infer coverage
 * from the absence of complaints.
 *
 *   scope     what was looked at, in words
 *   frames    the frames genuinely sampled, or null when the result is not frame-based
 *   loop      'fast' | 'full' — Part 15's two evaluation loops
 *   notRun    checks that were deliberately NOT performed, named. An empty array is a claim.
 */
export function coverage({ scope, frames = null, loop = 'fast', notRun = [] }) {
  if (loop !== 'fast' && loop !== 'full') throw new TypeError(`coverage: loop must be 'fast' or 'full' (got ${loop})`);
  return { scope, frames, loop, notRun };
}

/** Sort findings most-certain first, then by frame. Stable for equal keys. */
export function sortFindings(findings) {
  return findings
    .map((f, i) => [f, i])
    .sort((a, b) => (certaintyRank(a[0].certainty) - certaintyRank(b[0].certainty))
      || ((a[0].frame ?? Infinity) - (b[0].frame ?? Infinity))
      || (a[1] - b[1]))
    .map(([f]) => f);
}

/** A one-line count by level, for the `summary` field of a result. */
export function summarise(findings) {
  if (!findings.length) return 'No findings';
  const counts = {};
  for (const f of findings) counts[f.certainty] = (counts[f.certainty] || 0) + 1;
  return LEVELS.filter((l) => counts[l]).map((l) => `${counts[l]} ${l.replace(/_/g, ' ')}`).join(', ');
}
