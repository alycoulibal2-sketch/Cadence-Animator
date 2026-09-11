// The cross-project motion library (directive Part 70). LIB-001.
//
// Everything in `ai/` before this file lived inside one `.cadence` project. `ai/memory.js`,
// `ai/style.js` and `ai/reference.js` each close with the same sentence — "there is no
// cross-project store" — and that one missing thing is what "Cadence gets better at animation over
// time" was blocked on: a lesson learned on Monday's shot could not reach Tuesday's file. This is
// the store. What it holds is MOTION plus the measurements taken from it, so a later session can
// ask for "the closest thing we already have to a heavy attack" and get an answer backed by
// numbers rather than by a filename.
//
// Three decisions are load-bearing, and are enforced below rather than documented:
//
//   1. **Pure at load, and it reads no files.** The index is passed in as data, exactly like a
//      project. `src/main.js` owns the folder through IPC, the same way it owns autosaves — which
//      is what lets `aitest` exercise the whole search against a synthetic index, and what lets
//      the `library_search` benchmark run without touching the user's own library.
//
//   2. **The library lives OUTSIDE the repo, in the app's user-data folder.** Two separate
//      reasons, either of which alone would be enough: Mixamo's licence permits use inside a
//      project and forbids redistributing the clips as files, and the user's own captures are the
//      user's. A library committed to a product repo would ship both.
//
//   3. **Nothing infers a licence, and an estimate is labelled an estimate.** `provenance.kind`
//      is one of four, declared by the caller; `captured` (Roblox Studio's Animation Capture) is
//      a pose ESTIMATE from video and `validateEntry` REFUSES an entry that claims otherwise, the
//      way `ai/certainty.js` refuses an unlabelled finding. Part 36 already makes every reference
//      profile advisory; an estimated one is advisory twice over and says so in its own record.
//
// Pure at load like the rest of `ai/`.

import { contentHash, shortHash } from './hash.js';
import { numericProfile, relativeDistance } from './reference.js';

// ---------------------------------------------------------------- Part 70's field list

/** Part 70 verbatim, in its own order. An entry carries all sixteen or it is not an entry. */
export const LIBRARY_FIELDS = Object.freeze([
  'library_id', 'semantic_description', 'intent_tags', 'style_tags', 'compatible_rigs',
  'technical_implementation', 'parameters', 'dependencies', 'performance_cost', 'preview_media',
  'acceptance_tests', 'baseline_examples', 'known_failure_cases', 'version', 'provenance',
  'license_or_ownership',
]);

/** The three fields Part 70 does not name and this build needs to make an entry FINDABLE: what
 *  kind of action it is, a pointer to the Part 36 profile built from it, and the numeric slice of
 *  that profile search subtracts. Kept separate from LIBRARY_FIELDS so a reader can see which
 *  came from the directive and which came from this implementation. */
export const SEARCH_FIELDS = Object.freeze(['action_type', 'characteristics', 'profile_ref']);

/** Present-but-empty is a legitimate answer for most of Part 70's fields — a captured clip really
 *  does have no parameters and no dependencies, and saying `[]` is a declaration that somebody
 *  looked. These are the ones where empty would be a lie rather than an answer. */
const REQUIRED_NONEMPTY = Object.freeze([
  'library_id', 'semantic_description', 'compatible_rigs', 'technical_implementation',
  'version', 'provenance', 'license_or_ownership',
]);

/** Where the motion came from. The kind decides what else the entry must carry, because the four
 *  differ in exactly the way that matters — who owns it, and whether its poses are measured or
 *  estimated. */
export const PROVENANCE_KINDS = Object.freeze({
  captured: {
    means: 'Roblox Studio\'s own Animation Capture (Body or Face) tracked a video and generated R15 keyframes',
    estimated: true,
    requires: ['source_video_url', 'estimated_by'],
    note: 'a pose ESTIMATE, not a measurement of the performer — every number derived from it is advisory twice over (Part 36 already makes a reference profile advisory once)',
  },
  mocap: {
    means: 'a motion-capture library clip (Mixamo and the like) retargeted onto an R15 rig by Studio\'s Animation Importer',
    estimated: false,
    requires: ['source'],
    note: 'a retarget from human proportions onto R15 is still a retarget — profile it, do not assume its contacts are clean',
  },
  authored: {
    means: 'a shot the user made and accepted in Cadence',
    estimated: false,
    requires: [],
    note: 'the only kind whose poses are exactly what somebody intended',
  },
  imported: {
    means: 'a KeyframeSequence or AnimSaves file loaded from disk',
    estimated: false,
    requires: ['source_file'],
    note: 'the file says nothing about how the motion was made — whoever imports it declares the licence',
  },
});

export const INDEX_VERSION = 1;

export function emptyIndex() {
  return { index_version: INDEX_VERSION, entries: [] };
}

// ---------------------------------------------------------------- action types

/**
 * Normalise an action type to a stable search key: lowercase, non-alphanumerics collapsed to one
 * underscore. "Heavy Attack", "heavy attack" and "heavy-attack" are the same shelf.
 *
 * This deliberately does NOT validate against a closed list. Part 59's 25 benchmark categories are
 * the vocabulary the first corpus is built to (and `coverageAgainst` reports against them), but
 * refusing an action nobody anticipated would be a fabricated constraint — the same reason
 * `ai/pose.js` lets a knee bend backwards when a caller declares it.
 */
export function normaliseActionType(s) {
  if (s === null || s === undefined) return null;
  const out = String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return out || null;
}

function normTag(s) { return String(s).trim().toLowerCase(); }

// ---------------------------------------------------------------- building and validating

/**
 * Build a library entry from a Part 36 profile plus the caller's own declarations.
 *
 * Everything this function decides for itself is derived and reproducible: the id (hashed from
 * what makes an entry the same entry, so adding one clip twice collides instead of duplicating)
 * and `characteristics` (the numeric slice of the profile, the exact values search subtracts).
 * Everything else — the description, the tags, the provenance, the licence — is passed in, because
 * none of it is inferable from motion data and a guess here would be recorded as a fact forever.
 */
export function makeEntry({
  profile, semanticDescription, actionType,
  intentTags = [], styleTags = [], compatibleRigs = [],
  technicalImplementation = null, parameters = [], dependencies = [],
  performanceCost = null, previewMedia = [], acceptanceTests = [], baselineExamples = [],
  knownFailureCases = [], version = '1.0.0', provenance = null, licenseOrOwnership = null,
  addedAt = null,
} = {}) {
  const action = normaliseActionType(actionType);
  const prov = provenance ? { ...provenance, added_at: provenance.added_at ?? addedAt ?? null } : null;
  // The id is DERIVED from what makes two entries the same entry: the same action, described the
  // same way, from the same source. Minting a random one would let one Mixamo clip be added five
  // times and then found five times.
  const id = `lib:${shortHash(contentHash({
    action_type: action,
    semantic_description: semanticDescription ?? null,
    provenance_kind: prov?.kind ?? null,
    provenance_source: prov?.source_video_url ?? prov?.source_file ?? prov?.source ?? null,
    provenance_range: prov?.source_timestamps ?? null,
  }))}`;
  return {
    library_id: id,
    semantic_description: semanticDescription ?? null,
    intent_tags: intentTags.map(normTag),
    style_tags: styleTags.map(normTag),
    compatible_rigs: [...compatibleRigs],
    technical_implementation: technicalImplementation,
    parameters: [...parameters],
    dependencies: [...dependencies],
    performance_cost: performanceCost,
    preview_media: [...previewMedia],
    acceptance_tests: [...acceptanceTests],
    baseline_examples: [...baselineExamples],
    known_failure_cases: [...knownFailureCases],
    version,
    provenance: prov,
    license_or_ownership: licenseOrOwnership,
    action_type: action,
    characteristics: profile ? numericProfile(profile) : {},
    profile_ref: profile ? `${id.replace(/^lib:/, '')}.profile.json` : null,
  };
}

/**
 * The shape gate — the same mechanical discipline `ai/knowledge.js validateProposedEntry` applies
 * to a knowledge card: every field answered, nothing placeholdered, and the two things that would
 * be a lie rather than a gap refused outright: an unlabelled estimate and an unstated licence.
 */
export function validateEntry(entry) {
  const problems = [];
  for (const f of LIBRARY_FIELDS) {
    if (!entry || !(f in entry)) { problems.push(`missing field: ${f} — an absent key means nobody answered; an empty array or null is a declared "none"`); continue; }
    if (!REQUIRED_NONEMPTY.includes(f)) continue;
    const v = entry[f];
    const empty = v === null || v === undefined || v === ''
      || (Array.isArray(v) && v.length === 0)
      || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
    if (empty) problems.push(`empty field: ${f} — this one cannot honestly be "none"`);
  }
  for (const f of SEARCH_FIELDS) if (!entry || !(f in entry)) problems.push(`missing field: ${f} — an entry nothing can search for is not in a library, it is in a folder`);

  if (!entry?.action_type) {
    problems.push('action_type is required: it is the one field every search filters on first');
  } else if (normaliseActionType(entry.action_type) !== entry.action_type) {
    problems.push(`action_type "${entry.action_type}" is not normalised — store normaliseActionType(x), or a search will never find it`);
  }

  const prov = entry?.provenance;
  if (prov && !PROVENANCE_KINDS[prov.kind]) {
    problems.push(`provenance.kind "${prov?.kind}" is not one of ${Object.keys(PROVENANCE_KINDS).join(', ')}`);
  } else if (prov) {
    const spec = PROVENANCE_KINDS[prov.kind];
    for (const r of spec.requires) if (!prov[r]) problems.push(`provenance.${r} is required for a "${prov.kind}" entry — ${spec.note}`);
    if (!prov.added_at) problems.push('provenance.added_at is required: an entry with no date cannot be reconciled against the video or the download it came from');
    // The one refusal here that is not about completeness. An Animation Capture result is a pose
    // estimate; an entry claiming it is exact would make every later measurement built on it read
    // as a measurement of the performer.
    if (spec.estimated && prov.estimated !== true) {
      problems.push('provenance.estimated must be true for a "captured" entry — Roblox Animation Capture produces a pose ESTIMATE from video, and labelling it exact would make every number derived from it a false measurement');
    }
    if (!spec.estimated && prov.estimated === true) {
      problems.push(`provenance.estimated is true on a "${prov.kind}" entry — if the poses really are estimated, the kind is "captured"`);
    }
  }

  const lic = entry?.license_or_ownership;
  if (lic && typeof lic === 'object') {
    if (!lic.terms) problems.push('license_or_ownership.terms is required — nothing in this build infers a licence from a file, a URL or a provenance kind');
    if (typeof lic.redistributable !== 'boolean') problems.push('license_or_ownership.redistributable must be stated true or false — "unknown" here is how a non-redistributable clip ends up inside a product build');
  }

  const impl = entry?.technical_implementation;
  if (impl && typeof impl === 'object' && impl.kind !== 'keyframe_animation') {
    problems.push(`technical_implementation.kind "${impl.kind}" is not supported — this store holds keyframe_animation entries only (see libraryLimitations())`);
  }
  if (impl && typeof impl === 'object' && impl.kind === 'keyframe_animation' && !impl.file) {
    problems.push('technical_implementation.file is required: the .cadence file beside the index that holds the motion itself');
  }

  return { ok: problems.length === 0, problems, checked_fields: LIBRARY_FIELDS.length + SEARCH_FIELDS.length };
}

/** Validate the index itself, and every entry in it, naming each bad entry by id rather than
 *  refusing the whole library — one malformed file must not cost the user the other ninety-nine. */
export function validateIndex(index) {
  const problems = [];
  if (!index || typeof index !== 'object') return { ok: false, problems: ['the index is not an object'], entries: [], rejected: [] };
  if (index.index_version !== INDEX_VERSION) problems.push(`index_version ${index.index_version} is not ${INDEX_VERSION} — this build cannot read it, and guessing at the shape would corrupt it`);
  if (!Array.isArray(index.entries)) return { ok: false, problems: [...problems, 'index.entries is not an array'], entries: [], rejected: [] };
  const entries = [], rejected = [];
  const seen = new Set();
  for (const e of index.entries) {
    const v = validateEntry(e);
    if (!v.ok) { rejected.push({ library_id: e?.library_id ?? null, problems: v.problems }); continue; }
    if (seen.has(e.library_id)) { rejected.push({ library_id: e.library_id, problems: ['duplicate library_id — ids are derived, so two identical ids mean the same clip was written twice'] }); continue; }
    seen.add(e.library_id);
    entries.push(e);
  }
  return { ok: problems.length === 0 && rejected.length === 0, problems, entries, rejected };
}

/** Insert or replace by id. Returns a NEW index — the caller writes it; this module never does. */
export function upsertEntry(index, entry) {
  const v = validateEntry(entry);
  if (!v.ok) throw new TypeError(`library entry refused: ${v.problems.join('; ')}`);
  const entries = (index?.entries || []).filter((e) => e.library_id !== entry.library_id);
  const replaced = (index?.entries || []).length !== entries.length;
  return { index: { index_version: INDEX_VERSION, entries: [...entries, entry] }, replaced };
}

export function removeEntry(index, libraryId) {
  const entries = (index?.entries || []).filter((e) => e.library_id !== libraryId);
  return { index: { index_version: INDEX_VERSION, entries }, removed: entries.length !== (index?.entries || []).length };
}

export function getEntry(index, libraryId) {
  return (index?.entries || []).find((e) => e.library_id === libraryId) ?? null;
}

// ---------------------------------------------------------------- search

function overlap(a, b) {
  const set = new Set((b || []).map(normTag));
  return (a || []).map(normTag).filter((t) => set.has(t));
}

/**
 * Find entries. Filters EXCLUDE and say why; everything that survives is ranked and nothing is
 * silently dropped, because "no results" and "results you were not shown" are different answers.
 *
 * The ranking rule is stated in the result rather than tuned, and it is lexicographic, never a
 * weighted score: matched tags first, then profile distance when the caller supplied something to
 * be near, then the id so the order is stable. A weighted blend of "two tags matched" against
 * "0.3 relative distance" would need an exchange rate between them that nothing in this build can
 * justify — the same reason `compareRuns` has no overall score.
 */
export function searchLibrary(index, {
  actionType = null, intentTags = [], styleTags = [], rig = null,
  provenanceKinds = null, profile = null, characteristics = null, limit = 10,
} = {}) {
  const all = index?.entries || [];
  const wantAction = normaliseActionType(actionType);
  const wantChars = characteristics || (profile ? numericProfile(profile) : null);
  const excluded = [], scored = [];

  for (const e of all) {
    if (wantAction && e.action_type !== wantAction) { excluded.push({ library_id: e.library_id, reason: `action_type is "${e.action_type}", not "${wantAction}"` }); continue; }
    if (provenanceKinds && !provenanceKinds.includes(e.provenance?.kind)) { excluded.push({ library_id: e.library_id, reason: `provenance kind "${e.provenance?.kind}" was not asked for` }); continue; }
    if (rig && Array.isArray(e.compatible_rigs) && e.compatible_rigs.length && !e.compatible_rigs.includes(rig)) {
      excluded.push({ library_id: e.library_id, reason: `built for ${e.compatible_rigs.join('/')}, not ${rig} — Part 70: a validated asset must not be forced into an incompatible context` });
      continue;
    }
    const gotIntent = overlap(intentTags, e.intent_tags);
    const gotStyle = overlap(styleTags, e.style_tags);
    const d = wantChars ? relativeDistance(wantChars, e.characteristics || {}) : null;
    scored.push({
      library_id: e.library_id,
      semantic_description: e.semantic_description,
      action_type: e.action_type,
      provenance_kind: e.provenance?.kind ?? null,
      estimated: e.provenance?.estimated === true,
      compatible_rigs: e.compatible_rigs,
      matched_intent_tags: gotIntent,
      matched_style_tags: gotStyle,
      tag_overlap: gotIntent.length + gotStyle.length,
      profile_distance: d ? d.value : null,
      profile_values_compared: d ? d.keys : 0,
      distance_unavailable_because: wantChars
        ? (d ? null : 'this entry and the query share no numeric profile value — usually a different rig, whose part names do not correspond')
        : 'no profile or characteristics were supplied to measure against',
    });
  }

  scored.sort((a, b) => (
    (b.tag_overlap - a.tag_overlap)
    // A null distance sorts AFTER every comparable one rather than as zero: "we could not compare
    // this" must never read as "this is identical".
    || ((a.profile_distance === null) - (b.profile_distance === null))
    || ((a.profile_distance ?? 0) - (b.profile_distance ?? 0))
    || a.library_id.localeCompare(b.library_id)
  ));

  return {
    query: {
      action_type: wantAction, intent_tags: intentTags.map(normTag), style_tags: styleTags.map(normTag),
      rig, provenance_kinds: provenanceKinds, compared_against_a_profile: !!wantChars,
    },
    total_entries: all.length,
    considered: scored.length,
    matches: scored.slice(0, limit),
    truncated: Math.max(0, scored.length - limit),
    excluded,
    ranking: 'lexicographic, never a weighted score: matched tags descending, then profile distance ascending (null last), then library_id. No exchange rate between a tag and a distance exists, so none is invented.',
    limitations: libraryLimitations(),
  };
}

/**
 * The nearest entries to a profile, by distance alone.
 *
 * Separate from `searchLibrary` on purpose: "which of these is most like this motion" is a
 * different question from "which of these am I looking for", and answering both with one ranking
 * would let tags quietly outvote the measurement.
 */
export function nearest(index, profileOrCharacteristics, { actionType = null, rig = null, limit = 5 } = {}) {
  const chars = profileOrCharacteristics?.dimensions ? numericProfile(profileOrCharacteristics) : (profileOrCharacteristics || {});
  const wantAction = normaliseActionType(actionType);
  const comparable = [], notComparable = [], excluded = [];
  for (const e of index?.entries || []) {
    if (wantAction && e.action_type !== wantAction) continue;
    // The rig filter is here and not only in searchLibrary because the benchmark caught it: an
    // entry built for another rig can measure IDENTICALLY to one built for this one (the same
    // motion, profiled on both), and "the nearest thing" that cannot be used on your rig is the
    // wrong answer to the question. Part 70: a validated asset must not be forced into an
    // incompatible context. It EXCLUDES and says so, rather than ranking the entry last.
    if (rig && Array.isArray(e.compatible_rigs) && e.compatible_rigs.length && !e.compatible_rigs.includes(rig)) {
      excluded.push({ library_id: e.library_id, reason: `built for ${e.compatible_rigs.join('/')}, not ${rig}` });
      continue;
    }
    const d = relativeDistance(chars, e.characteristics || {});
    const row = { library_id: e.library_id, semantic_description: e.semantic_description, action_type: e.action_type, estimated: e.provenance?.estimated === true };
    if (d) comparable.push({ ...row, distance: d.value, values_compared: d.keys });
    else notComparable.push({ ...row, reason: 'no numeric profile value in common — the two were measured on rigs whose part names do not correspond' });
  }
  // Two entries CAN be exactly equidistant — the same motion profiled twice is the ordinary case —
  // so the tie-break is the id, which makes the order stable across runs and machines rather than
  // dependent on insertion order. A tie is reported, because "these two are equally close" is a
  // different answer from "this one is closest".
  comparable.sort((a, b) => (a.distance - b.distance) || a.library_id.localeCompare(b.library_id));
  const tied = comparable.length > 1 && comparable[0].distance === comparable[1].distance
    ? comparable.filter((c) => c.distance === comparable[0].distance).map((c) => c.library_id)
    : [];
  return {
    nearest: comparable.slice(0, limit),
    tied_for_first: tied,
    not_comparable: notComparable,
    excluded,
    method: 'mean relative difference over the numeric profile values the two share (spacing variability, peak speed, peak angular speed, per part) — ai/reference.js relativeDistance, the same number the reference_adaptation benchmark reports',
    query_values: Object.keys(chars).length,
    caveat: 'three numeric dimensions out of Part 36\'s fifteen. A small distance means those three agree, not that the two motions look alike.',
  };
}

/** Which of a supplied category list the library actually covers. The caller passes the list —
 *  Part 59's `BENCHMARK_CATEGORIES` in practice — so this module needs no copy of it to drift. */
export function coverageAgainst(index, categories) {
  const have = new Set((index?.entries || []).map((e) => e.action_type));
  const covered = [], missing = [];
  for (const c of categories) (have.has(normaliseActionType(c)) ? covered : missing).push(c);
  const extra = [...have].filter((a) => !categories.some((c) => normaliseActionType(c) === a));
  return { covered, missing, outside_the_list: extra, entries: (index?.entries || []).length };
}

export function librarySummary(index) {
  const entries = index?.entries || [];
  const byAction = {}, byKind = {}, byLicence = { redistributable: 0, not_redistributable: 0, unstated: 0 };
  for (const e of entries) {
    byAction[e.action_type] = (byAction[e.action_type] || 0) + 1;
    const k = e.provenance?.kind ?? 'unknown';
    byKind[k] = (byKind[k] || 0) + 1;
    const r = e.license_or_ownership?.redistributable;
    byLicence[r === true ? 'redistributable' : r === false ? 'not_redistributable' : 'unstated']++;
  }
  return {
    index_version: index?.index_version ?? null,
    entries: entries.length,
    by_action_type: byAction,
    by_provenance_kind: byKind,
    by_licence: byLicence,
    estimated_entries: entries.filter((e) => e.provenance?.estimated === true).length,
  };
}

export function libraryLimitations() {
  return [
    'This module reads and writes nothing. The index is data a caller supplies; src/main.js owns the folder under the app\'s user-data directory through IPC, the same way it owns autosaves — which is also why the library never appears inside a project file, a save, or the repo.',
    'An entry holds a keyframe animation and the measurements taken from it. No effect, no camera move, no pose library and no PNX graph — `pnx/library.js` holds effect recipes and is a different store with a different shape (LIB-001 covers both halves; this is the motion half).',
    'Search compares 3 of Part 36\'s 15 profile dimensions (spacing variability, peak speed, peak angular speed, per part), because those are the only ones ai/reference.js produces as numbers. "Nearest" means nearest on those three — it is not a claim that two motions look alike.',
    'Two entries built on different rigs share no part names, so their distance is null rather than large. A cross-rig "which is closest" question cannot be answered by this measurement at all, and the result says so per row instead of ranking them last behind a plausible number.',
    'Nothing here adapts, retargets or applies an entry. `load_from_library` brings a clip in as a reference item beside the user\'s work; every edit to the user\'s own rig still goes through apply_animation_patch.',
    'A `captured` entry\'s poses are estimated by Roblox Animation Capture from video. Its profile is advisory twice over, and no comparison against it is evidence about the real performer.',
    'Nothing infers a licence. An entry whose licence terms are unstated is refused at the gate rather than stored with a guess, and `redistributable` must be an explicit boolean.',
  ];
}
