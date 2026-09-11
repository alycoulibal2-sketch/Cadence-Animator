// Project and preference memory (directive Part 57), plus learning from accepted and failed work
// (Part 58). MEM-001, MEM-003, MEM-004. MEM-002 (vocabulary overrides) already exists in
// `ai/vocabulary.js` and is untouched by this file — see the note below on why it stays separate.
//
// Two decisions settled before writing a single function, because SHARED_TASK_NOTES.md flagged
// both as things a future session must not relitigate.
//
// **Where memory lives.** Cadence has no cross-project store — nothing persists outside one
// `.cadence` file, and building one (a new user-data store in `src/main.js`, outside the pure `ai/`
// layer) is a real architectural decision nobody has made. So every scope here lives in
// `project.semantics.memory`, exactly where `vocabulary.js` already keeps its overrides. This is an
// honest, named limitation, not an oversight: a "user preference" learned in one project cannot
// travel to another project in this build (see `memoryLimitations()`). Part 57 lists "user
// preferences" as if they might span projects; this build cannot make that claim and does not.
//
// **Why this is a NEW file and not an extension of `ai/vocabulary.js`.** MEM-002 already proves one
// instance of Part 57's shape — a preference candidate as a scoped delta with evidence and an
// observations count, never a global rule. It would have been tempting to bolt the other six scopes
// onto `vocabulary.js`'s existing store. That store is typed specifically for TERM REINTERPRETATION
// (`dimensions`, `scope: project|character|style`) — a fact, a project convention, or a rejected
// approach do not have dimensions to override, and forcing them through that shape would either
// invent fake dimensions or silently drop the fields Part 57 actually asks for (evidence_source,
// confidence, applicable/non_applicable contexts, expiration policy). Two honest, separate stores
// beat one store pretending to be general.
//
// **The preference-learning policy's central rule, stated once so every function here can be
// checked against it:** "Do not treat one correction as a global rule." Nothing in this file writes
// to `project.semantics.vocabulary`, a track, or any other project data. `reviewCandidate`'s
// `accept` decision changes ONE field — the memory entry's own `status` — and nothing else. A
// caller that wants an accepted preference to actually change future behaviour has to read it back
// and act on it explicitly; this file will not do that silently on the caller's behalf, because that
// silent step is exactly the "unapproved global assumption" Part 62's success condition forbids.
//
// Pure at load like the rest of `ai/`.

import { contentHash, shortHash } from './hash.js';

export const SCOPES = Object.freeze([
  'facts', 'heuristics', 'project_conventions', 'character_rules',
  'user_preferences', 'validated_solutions', 'failed_approaches',
]);

export const STATUSES = Object.freeze(['candidate', 'accepted', 'rejected', 'paused']);

/** Part 57's own example: "In three approved sword attacks, you increased..." A candidate is
 *  surfaced as actionable only at or above this many observed occurrences of the SAME pattern.
 *  Below it, the evidence exists and is kept, but is not yet presented as something to decide on —
 *  matching Part 57's "extract a candidate preference only when evidence is sufficient." */
export const SUFFICIENCY_THRESHOLD = 3;

function store(project, { create = false } = {}) {
  if (!project.semantics) {
    if (!create) return null;
    project.semantics = {};
  }
  if (!project.semantics.memory) {
    if (!create) return null;
    project.semantics.memory = { entries: [] };
  }
  return project.semantics.memory;
}

export function listMemory(project, { scope = null, status = null } = {}) {
  const entries = store(project)?.entries ?? [];
  return entries.filter((e) => (!scope || e.scope === scope) && (!status || e.status === status));
}

export function getMemory(project, id) {
  return (store(project)?.entries ?? []).find((e) => e.id === id) || null;
}

// ---------------------------------------------------------------- Part 57's general memory entry

/**
 * Record (or re-confirm) a memory entry.
 *
 * The id is derived from `{ scope, statement }` alone — recording the exact same statement twice
 * re-confirms the same entry (bumps `observations`, refreshes `last_confirmed_time`, and appends
 * new evidence) rather than duplicating it, the same dedupe rule `ai/vocabulary.js setTerm` uses.
 * A different statement, even on the same topic, is a different entry: this file does not judge
 * when two statements are "close enough" to merge, because that judgement is exactly the kind of
 * silent inference Part 62 forbids.
 *
 * `evidence` is required, mirroring `ai/vocabulary.js`'s rule — a memory nobody can justify later is
 * one nobody can safely retire later either.
 */
export function recordMemory(project, {
  scope, statement, evidenceSource = [], confidence = null,
  applicableContexts = [], nonApplicableContexts = [], userEditable = true,
  expirationPolicy = null, linkedProvenance = null, createdAt = null,
} = {}) {
  if (!SCOPES.includes(scope)) throw new TypeError(`recordMemory: scope must be one of ${SCOPES.join(', ')} (got ${JSON.stringify(scope)})`);
  if (!statement) throw new TypeError('recordMemory: a statement is required');
  if (!Array.isArray(evidenceSource) || !evidenceSource.length) {
    throw new TypeError('recordMemory: needs evidenceSource — at least one statement of what was observed that justifies recording this. Part 57 asks for evidence on every scope, not only user preferences.');
  }

  const s = store(project, { create: true });
  const id = `mem:${shortHash(contentHash({ scope, statement }))}`;
  const existing = s.entries.find((e) => e.id === id);
  if (existing) {
    existing.observations = (existing.observations || 1) + 1;
    existing.last_confirmed_time = createdAt;
    for (const ev of evidenceSource) if (!existing.evidence_source.includes(ev)) existing.evidence_source.push(ev);
    if (confidence !== null) existing.confidence = confidence;
    return { ...existing };
  }

  const entry = {
    id, scope, statement,
    evidence_source: [...evidenceSource],
    confidence,
    creation_time: createdAt,
    last_confirmed_time: createdAt,
    applicable_contexts: [...applicableContexts],
    non_applicable_contexts: [...nonApplicableContexts],
    user_editable: !!userEditable,
    expiration_or_review_policy: expirationPolicy,
    linked_provenance: linkedProvenance,
    status: 'accepted', // general memory (facts/heuristics/conventions) is recorded as standing,
    // unlike a preference candidate below, which starts life explicitly unconfirmed
    observations: 1,
  };
  s.entries.push(entry);
  return { ...entry };
}

/** A user-editable entry's statement or context can be revised in place. Throws on an entry marked
 *  `user_editable: false` — Part 57 requires that status to mean something. */
export function reviseMemory(project, id, { statement = undefined, applicableContexts = undefined, nonApplicableContexts = undefined, confidence = undefined } = {}) {
  const s = store(project);
  const entry = s?.entries.find((e) => e.id === id);
  if (!entry) return null;
  if (!entry.user_editable) throw new TypeError(`reviseMemory: "${id}" is marked user_editable: false and cannot be revised`);
  if (statement !== undefined) entry.statement = statement;
  if (applicableContexts !== undefined) entry.applicable_contexts = [...applicableContexts];
  if (nonApplicableContexts !== undefined) entry.non_applicable_contexts = [...nonApplicableContexts];
  if (confidence !== undefined) entry.confidence = confidence;
  return { ...entry };
}

/** Remove one entry outright — Part 57's "delete" verb. Drops the container when it empties, same
 *  reasoning as `ai/vocabulary.js clearTerm`: `{}` and an absent key must not hash differently. */
export function retireMemory(project, id) {
  const s = store(project);
  if (!s) return false;
  const i = s.entries.findIndex((e) => e.id === id);
  if (i < 0) return false;
  s.entries.splice(i, 1);
  if (!s.entries.length) {
    delete project.semantics.memory;
    if (!Object.keys(project.semantics).length) delete project.semantics;
  }
  return true;
}

// ---------------------------------------------------------------- Part 57's preference-learning policy

/**
 * Capture one correction — an edit the user made to the AI's work — as a scoped, evidenced
 * occurrence. Never applies anything; this only records.
 *
 * `patternKey` is the honest stand-in for "detect that this correction resembles earlier ones."
 * Nothing in this build can tell two corrections are "the same kind of thing" from project data
 * alone (see `memoryLimitations()`), so the caller — the session that watched the correction happen
 * — states the pattern explicitly, the same way `ai/vocabulary.js setTerm` requires an explicit
 * `term` rather than inferring one from free text. A wrong or too-broad `patternKey` produces a
 * wrong candidate; that is a real limitation, named rather than hidden behind an inference that
 * would look smarter and be less trustworthy.
 *
 * Fields mirror Part 57's "Preference learning policy" list exactly: before/after state, changed
 * objects and properties, changed frame range, the semantic interpretation that likely failed, an
 * optional rationale, and style/character context.
 */
export function recordCorrection(project, {
  patternKey, before, after, changedObjectsAndProperties = [], changedFrameRange = null,
  semanticInterpretationThatFailed = null, rationale = null, styleContext = null, characterContext = null,
  evidence = [], createdAt = null,
} = {}) {
  if (!patternKey) throw new TypeError('recordCorrection: needs a `patternKey` naming the kind of correction this is (e.g. "sword_attack.torso_contribution") — this build does not infer one from the before/after diff');
  if (before === undefined || after === undefined) throw new TypeError('recordCorrection: needs both `before` and `after` state (Part 57\'s "before state" / "after state")');
  if (!Array.isArray(evidence) || !evidence.length) {
    throw new TypeError('recordCorrection: needs `evidence` — what was observed that justifies treating this as a correction rather than an unrelated edit');
  }

  const s = store(project, { create: true });
  const id = `mem:correction:${shortHash(contentHash({ patternKey }))}`;
  const occurrence = {
    before_state: before, after_state: after,
    changed_objects_and_properties: [...changedObjectsAndProperties],
    changed_frame_range: changedFrameRange,
    semantic_interpretation_that_likely_failed: semanticInterpretationThatFailed,
    rationale, style_and_character_context: { style: styleContext, character: characterContext },
    recorded_at: createdAt,
  };

  let entry = s.entries.find((e) => e.id === id);
  if (!entry) {
    entry = {
      id, scope: 'user_preferences', pattern_key: patternKey,
      statement: rationale || `a repeated correction pattern: ${patternKey}`,
      evidence_source: [], confidence: null,
      creation_time: createdAt, last_confirmed_time: createdAt,
      applicable_contexts: styleContext ? [styleContext] : [], non_applicable_contexts: [],
      user_editable: true, expiration_or_review_policy: null, linked_provenance: null,
      status: 'candidate', observations: 0, occurrences: [],
    };
    s.entries.push(entry);
  }
  entry.observations += 1;
  entry.last_confirmed_time = createdAt;
  entry.occurrences.push(occurrence);
  for (const ev of evidence) if (!entry.evidence_source.includes(ev)) entry.evidence_source.push(ev);

  const sufficient = entry.status === 'candidate' && entry.observations >= SUFFICIENCY_THRESHOLD;
  return {
    entry: { ...entry },
    observations: entry.observations,
    sufficient_evidence: sufficient,
    // Part 57's own worked example, reproduced with this occurrence's real numbers rather than a
    // hard-coded sentence — the candidate text a caller would actually show the user.
    surfaced_candidate: sufficient
      ? `Possible preference detected: In ${entry.observations} corrected instances of "${patternKey}", the same change was made${rationale ? ` (${rationale})` : ''}. Apply this as a project preference for future "${patternKey}" cases?`
      : null,
  };
}

/**
 * Part 57's five verbs on a learned preference candidate: accept, reject, edit, pause, delete.
 *
 * `accept` changes exactly one thing — the entry's own `status` — and nothing about how future
 * requests are interpreted. That is deliberate: promoting acceptance into an actual behaviour
 * change would be this file deciding a global rule is now in force, which is precisely what Part 57
 * forbids doing silently. A caller that wants acceptance to matter has to read `status: 'accepted'`
 * back and act on it — e.g. by recording a corresponding `ai/vocabulary.js setTerm` override with
 * this entry's id as its evidence, which keeps the two systems honestly separate rather than one
 * silently triggering the other.
 */
export function reviewCandidate(project, id, { decision, editedStatement = null, note = null } = {}) {
  if (!['accept', 'reject', 'edit', 'pause', 'delete'].includes(decision)) {
    throw new TypeError(`reviewCandidate: decision must be one of accept, reject, edit, pause, delete (got ${JSON.stringify(decision)})`);
  }
  if (decision === 'delete') {
    const ok = retireMemory(project, id);
    return { id, decision, ok };
  }
  const s = store(project);
  const entry = s?.entries.find((e) => e.id === id);
  if (!entry) return { id, decision, ok: false, reason: 'no such memory entry' };

  if (decision === 'edit') {
    if (!editedStatement) throw new TypeError('reviewCandidate: decision "edit" needs `editedStatement`');
    entry.statement = editedStatement;
    if (note) entry.review_note = note;
    return { id, decision, ok: true, entry: { ...entry } };
  }
  entry.status = decision === 'accept' ? 'accepted' : decision === 'reject' ? 'rejected' : 'paused';
  if (note) entry.review_note = note;
  return { id, decision, ok: true, entry: { ...entry } };
}

// ---------------------------------------------------------------- Part 58: learning from success and failure

/** MEM-003. Part 58's "accepted result" shape. `partial`: the fields exist and are captured exactly
 *  as Part 58 asks, but nothing extracts them automatically from a session — the caller states
 *  which motion-plan features, experiments and constraints mattered, the same honest-capture
 *  pattern as `recordCorrection`. */
export function recordAcceptedWork(project, {
  statement, retainedFeatures = [], selectedExperiments = [], matteredConstraints = [],
  correlatedSignals = [], styleOrProjectContext = null, confidence = null, evidenceSource = [], createdAt = null,
} = {}) {
  const entry = recordMemory(project, {
    scope: 'validated_solutions', statement, confidence, createdAt,
    evidenceSource: evidenceSource.length ? evidenceSource : ['accepted result'],
    applicableContexts: styleOrProjectContext ? [styleOrProjectContext] : [],
  });
  // recordMemory's return is a copy; attach Part 58's accepted-work fields to the STORED entry so
  // a later listMemory sees the whole shape, the same two-step pattern recordFailedApproach uses.
  const stored = getMemory(project, entry.id);
  if (stored) {
    stored.retained_features = retainedFeatures;
    stored.selected_experiments = selectedExperiments;
    stored.mattered_constraints = matteredConstraints;
    stored.correlated_signals = correlatedSignals;
  }
  return { ...(stored || entry) };
}

/** MEM-004. Part 58's "failed approach" shape: what was attempted, why it seemed reasonable, what
 *  happened, and what corrected it. Failures are evidence too, and are kept, never discarded —
 *  `ai/style.js` and `ai/vocabulary.js` already show this pattern for "weary vs heavy" being the
 *  commonest way "heavy" goes wrong; this is the general home for that kind of lesson. */
export function recordFailedApproach(project, {
  statement, attempted, whyItSeemedReasonable = null, observedResult, failureKind = 'objective',
  correctedBy = null, generalized = null, evidenceSource = [], createdAt = null,
} = {}) {
  if (!['objective', 'likely', 'subjective'].includes(failureKind)) {
    throw new TypeError('recordFailedApproach: failureKind must be objective, likely, or subjective (Part 58)');
  }
  const entry = recordMemory(project, {
    scope: 'failed_approaches',
    statement: statement || `attempted: ${attempted}`,
    confidence: null, createdAt,
    evidenceSource: evidenceSource.length ? evidenceSource : ['failed approach observed directly'],
  });
  // recordMemory doesn't carry Part 58's failure-specific fields; attach them directly on the
  // stored entry so a caller reading listMemory sees the whole shape, not a truncated one.
  const stored = getMemory(project, entry.id);
  if (stored) {
    stored.attempted = attempted;
    stored.why_it_seemed_reasonable = whyItSeemedReasonable;
    stored.observed_result = observedResult;
    stored.failure_kind = failureKind;
    stored.corrected_by = correctedBy;
    stored.generalized = generalized;
  }
  return { ...(stored || entry) };
}

export function memoryLimitations() {
  return [
    'Memory itself is per-project, by design rather than by omission: every scope lives in project.semantics.memory and travels with one .cadence file, because generalising a captured correction into a rule for every project is a decision Part 57 gives a person, not a folder. What DOES cross a project now is motion (ai/library.js, Part 70 — accept_shot offers an accepted shot to it) and knowledge (the on-disk half of ai/knowledge.js, Part 72). A preference still cannot: there is no export/import step for one, and adding a silent one would be the unapproved global assumption Part 62 forbids.',
    '"Similar correction" is never inferred. recordCorrection requires an explicit patternKey from the caller; nothing in this build clusters two corrections as the same kind of thing from project data alone.',
    'Accepting a preference candidate changes only its own status field. It never writes to ai/vocabulary.js or any track — promoting an accepted preference into actual behaviour is a separate, explicit step a caller must take.',
    'recordAcceptedWork / recordFailedApproach capture Part 58\'s fields exactly as stated, but extracting WHICH features, experiments or constraints mattered is the caller\'s judgement, not something derived from project data here.',
    'No expiration or review policy is enforced. expirationOrReviewPolicy is stored as stated text and read by nobody — an entry does not expire on its own.',
  ];
}
