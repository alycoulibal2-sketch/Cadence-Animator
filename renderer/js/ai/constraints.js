// Semantic constraints and safe change control (directive Parts 20.6 and 54).
//
// "Every change must be constrained by explicit scope. Do not rely on a natural-language
// instruction alone to protect user work."
//
// Part 54's worked example is the requirement in one paragraph:
//
//   Make the sword attack heavier, but do not change timing, camera, foot contacts, character
//   proportions, color grade, or weapon scale.
//     Allowed:   hips, torso, shoulders, arms, weapon follow-through, secondary impact effects.
//     Protected: camera transform, frame 16 impact time, left-foot contact frames 12–23,
//                colour configuration, character proportions, weapon scale.
//
// Four decisions make that implementable rather than decorative.
//
// 1. **An allow-list compiles to a protection.** `allow: ['the hips', 'the arms']` becomes one
//    constraint over the COMPLEMENT of that list, so anything not named is protected by default.
//    Without that, "do not change anything else" has to be enumerated, and the one thing nobody
//    remembers to enumerate is the thing that gets broken.
//
// 2. **Aspects, not just targets.** "Do not change timing" and "do not change poses" protect the
//    same keys against different edits. A constraint therefore names an aspect — timing, value,
//    easing, space, existence — and `move_key` violates a timing lock while `set_key` with a new
//    value does not. This is the mechanism Part 27's independent timing/spacing/pose edits need.
//
// 3. **A lock is a persisted constraint.** `project.semantics.locks.entries` holds ConstraintSpecs
//    with `constraint_type: 'lock'`. Locks and per-request constraints then flow through one
//    checker, so a lock cannot be enforced in one code path and forgotten in another.
//
// 4. **A constraint that cannot be checked says so, every time.** Part 54's own example includes
//    "keep the left foot within 2 cm from frame 12 through 23", which needs contact measurement
//    that does not exist until Phase 5. Such a constraint is recorded, reported, priced into the
//    result's `coverage.notRun`, and never counted as satisfied. Part 12: "do not claim that a
//    missing analyzer has checked something."
//
// What this module does NOT do: resolve a conflict. Part 54 — "When constraints conflict, do not
// silently choose. Explain the conflict and offer alternatives." Conflicts come back as data with
// the priority ladder attached so a human, or a model asking a human, decides.

import * as ids from './ids.js';
import { resolve as resolveSemantic } from './select.js';
import { CERTAINTY, evidence, finding, coverage, sortFindings } from './certainty.js';
import { contentHash, shortHash } from './hash.js';

const EPS = 1e-6;

/** Part 20.6's constraint types. */
export const CONSTRAINT_TYPES = Object.freeze(['preserve', 'lock', 'limit', 'match', 'synchronize', 'avoid', 'budget']);

/**
 * Part 54's priority ladder, verbatim and in order. Lower number wins.
 *
 * The ladder is not advisory decoration: when two constraints disagree, this is what the conflict
 * report ranks them by, and it is why "the user locked it" beats "the style prefers it" without
 * anyone having to argue the case each time.
 */
export const PRIORITY = Object.freeze({
  DATA_SAFETY: 1,
  USER_LOCK: 2,
  EXPORT_VALIDITY: 3,
  USER_PRESERVE: 4,
  SHOT_EVENT: 5,
  PROJECT_CONVENTION: 6,
  CHARACTER_CONVENTION: 7,
  STYLE_PREFERENCE: 8,
  AI_SUGGESTION: 9,
});
export const PRIORITY_NAMES = Object.freeze(Object.fromEntries(Object.entries(PRIORITY).map(([k, v]) => [v, k.toLowerCase().replace(/_/g, ' ')])));

/**
 * The aspects of an edit a constraint can protect independently.
 *
 *   timing     when a key happens
 *   value      what pose or number it holds
 *   easing     how it interpolates out of the previous key
 *   space      whether a track is parent- or world-relative
 *   existence  whether the key/track/marker is there at all
 *   all        every aspect (the default, and what "do not touch this" means)
 */
export const ASPECTS = Object.freeze(['timing', 'value', 'easing', 'space', 'existence']);

/** What each patch operation actually changes. This mapping is the whole reason an aspect-scoped
 *  constraint can be enforced, so it lives next to the aspects rather than inside the checker. */
export function opAspects(op) {
  switch (op.op) {
    case 'set_key':
      return op.value !== undefined ? ['value', 'existence', 'easing'] : ['easing'];
    case 'restore_key': return ['value', 'easing', 'existence'];
    case 'delete_key': return ['existence', 'value', 'timing', 'easing'];
    case 'move_key': return ['timing'];
    case 'set_easing': return ['easing'];
    case 'set_track_space': return ['space', 'value'];
    case 'remove_track': return ASPECTS.slice();
    case 'set_marker': case 'restore_marker': return ['existence', 'timing', 'value'];
    case 'delete_marker': return ['existence', 'timing', 'value'];
    // A group entry records WHEN a key is, so putting one back is a timing change.
    case 'restore_group_entry': return ['timing'];
    case 'set_project_field':
      // Frame rate does not move a single key, and changes every duration in the animation. A
      // constraint that protects timing must catch it.
      return op.path === 'fps' ? ['timing', 'value'] : ['value'];
    case 'set_item_field': return ['value'];
    default: return ASPECTS.slice();
  }
}

// ---------------------------------------------------------------- ConstraintSpec

/**
 * Part 20.6's ConstraintSpec. Every field is present; the ones Cadence cannot yet act on are
 * present and honest rather than omitted.
 *
 * @param c.target      a selector (see `resolveTarget`) or an array of them
 * @param c.aspect      one of ASPECTS, an array of them, or 'all' (default)
 * @param c.condition   for `limit`/`match`/`synchronize`/`budget`: `{ check, ... }` — see CHECKS
 * @param c.timeRange   `[from, to]` in frames, or null for the whole animation
 * @param c.priority    from PRIORITY. Defaults by source: a user lock is 2, an AI guess is 9.
 * @param c.source      'user' | 'project' | 'character' | 'style' | 'ai' | 'platform'
 * @param c.violationResponse 'refuse' | 'warn' | 'ask'
 */
export function constraintSpec(c) {
  if (!CONSTRAINT_TYPES.includes(c.constraint_type)) {
    throw new TypeError(`constraintSpec: constraint_type must be one of ${CONSTRAINT_TYPES.join(', ')} (got ${JSON.stringify(c.constraint_type)})`);
  }
  const aspect = normaliseAspect(c.aspect);
  const targets = (Array.isArray(c.target) ? c.target : [c.target]).filter(Boolean);
  if (!targets.length && c.constraint_type !== 'budget') {
    throw new TypeError('constraintSpec: a constraint needs at least one target (budget constraints may target the project)');
  }
  const source = c.source || 'ai';
  const spec = {
    id: null,
    target: targets,
    property_or_semantic_rule: c.rule || describeTargets(targets, aspect),
    aspect,
    constraint_type: c.constraint_type,
    condition: c.condition ?? null,
    time_range: c.timeRange ?? null,
    priority: c.priority ?? defaultPriority(c.constraint_type, source),
    source,
    violation_response: c.violationResponse || (c.constraint_type === 'lock' ? 'refuse' : 'refuse'),
    user_approval_required: c.userApprovalRequired ?? (c.constraint_type === 'lock'),
    reason: c.reason ?? null,
    author: c.author ?? null,
    created_at: c.createdAt ?? null,
  };
  spec.id = `constraint:${shortHash(contentHash({ ...spec, id: null, created_at: null }))}`;
  return spec;
}

function normaliseAspect(a) {
  if (a === undefined || a === null || a === 'all') return 'all';
  const list = Array.isArray(a) ? a : [a];
  for (const x of list) if (!ASPECTS.includes(x)) throw new TypeError(`constraintSpec: unknown aspect "${x}" (expected all, or any of ${ASPECTS.join(', ')})`);
  return list.length === ASPECTS.length ? 'all' : list;
}

function defaultPriority(type, source) {
  if (type === 'lock') return PRIORITY.USER_LOCK;
  switch (source) {
    case 'user': return PRIORITY.USER_PRESERVE;
    case 'platform': return PRIORITY.EXPORT_VALIDITY;
    case 'project': return PRIORITY.PROJECT_CONVENTION;
    case 'character': return PRIORITY.CHARACTER_CONVENTION;
    case 'style': return PRIORITY.STYLE_PREFERENCE;
    default: return PRIORITY.AI_SUGGESTION;
  }
}

function describeTargets(targets, aspect) {
  const a = aspect === 'all' ? '' : ` (${[].concat(aspect).join('/')} only)`;
  return targets.map(describeTarget).join(', ') + a;
}

function describeTarget(t) {
  if (!t) return 'nothing';
  switch (t.kind) {
    case 'everything': return 'the whole project';
    case 'complement': return `everything except ${(t.of || []).map(describeTarget).join(', ')}`;
    case 'semantic': return `"${t.query}"`;
    case 'item': return `item ${t.itemId}`;
    case 'track': return `${t.track} on ${t.itemId}`;
    case 'key': return `${t.track} @ ${t.t}`;
    case 'frame': return `frame ${t.t}${t.tolerance ? ` ±${t.tolerance}` : ''}`;
    case 'marker': return `marker @ ${t.t}`;
    case 'item_field': return `item.${t.path}`;
    case 'project_field': return `project.${t.path}`;
    default: return JSON.stringify(t);
  }
}

// ---------------------------------------------------------------- target resolution

/**
 * Turn a selector into the concrete things it covers.
 *
 * Selector kinds:
 *   { kind:'everything' }
 *   { kind:'complement', of:[selector,…] }        anything NOT covered by `of`
 *   { kind:'semantic', query:'the weapon hand' }  resolved through ai/select.js, with its certainty
 *   { kind:'item', itemId }
 *   { kind:'track', itemId, track }
 *   { kind:'key', itemId, track, t }
 *   { kind:'frame', t, tolerance? }               a protected moment in time
 *   { kind:'marker', itemId, t }
 *   { kind:'item_field', itemId, path }
 *   { kind:'project_field', path }
 *
 * Returns `{ items, tracks, keys, frames, fields, unresolved, question, certainty }`. A selector
 * that cannot be resolved lands in `unresolved` WITH a question — never silently as an empty set,
 * because an empty protection set silently protects nothing.
 */
export function resolveTarget(project, selector, { frame = 0 } = {}) {
  const out = {
    items: new Set(), tracks: new Set(), keys: new Set(), frames: [], fields: new Set(),
    complementOf: null, everything: false, unresolved: [], question: null,
    certainty: CERTAINTY.CERTAIN,
  };
  add(project, selector, out, frame);
  return {
    items: [...out.items], tracks: [...out.tracks], keys: [...out.keys], fields: [...out.fields],
    frames: out.frames, everything: out.everything, complementOf: out.complementOf,
    unresolved: out.unresolved, question: out.question, certainty: out.certainty,
  };
}

function add(project, sel, out, frame) {
  if (!sel) return;
  switch (sel.kind) {
    case 'everything':
      out.everything = true;
      return;
    case 'complement': {
      const inner = { items: new Set(), tracks: new Set(), keys: new Set(), frames: [], fields: new Set(), unresolved: [], question: null, certainty: CERTAINTY.CERTAIN };
      for (const s of sel.of || []) add(project, s, inner, frame);
      out.complementOf = {
        items: [...inner.items], tracks: [...inner.tracks], keys: [...inner.keys], fields: [...inner.fields],
      };
      out.unresolved.push(...inner.unresolved);
      if (inner.question && !out.question) out.question = inner.question;
      return;
    }
    case 'semantic': {
      const r = resolveSemantic(project, sel.query, { frame, itemId: sel.itemId });
      if (!r.resolved) {
        out.unresolved.push({ selector: sel, reason: r.interpretation, question: r.question });
        if (!out.question) out.question = r.question || `"${sel.query}" could not be resolved, so a constraint over it cannot be enforced.`;
        // A constraint whose target is unknown is not a constraint that permits everything.
        out.certainty = CERTAINTY.USER_INTENT_REQUIRED;
        return;
      }
      // The weakest match governs: a protection resting on a *highly likely* planted-foot
      // measurement is itself only highly likely, and must not be reported as certain.
      for (const m of r.matches) {
        expandEntity(project, m.entityId, out);
        if (rank(m.certainty) > rank(out.certainty)) out.certainty = m.certainty;
      }
      return;
    }
    case 'item':
      out.items.add(sel.itemId);
      for (const name of Object.keys(project.tracks?.[sel.itemId] || {})) out.tracks.add(ids.trackId(sel.itemId, name));
      return;
    case 'track':
      out.tracks.add(ids.trackId(sel.itemId, sel.track));
      return;
    case 'key':
      out.keys.add(ids.keyId(sel.itemId, sel.track, sel.t));
      out.tracks.add(ids.trackId(sel.itemId, sel.track));
      out.frames.push({ t: sel.t, tolerance: 0, source: 'key selector' });
      return;
    case 'frame':
      out.frames.push({ t: sel.t, tolerance: sel.tolerance ?? 0, source: 'frame selector' });
      return;
    case 'marker':
      out.fields.add(ids.markerId(sel.itemId, sel.t));
      out.frames.push({ t: sel.t, tolerance: sel.tolerance ?? 0, source: 'marker' });
      return;
    case 'item_field':
      out.fields.add(`${ids.itemId(sel.itemId)}#${sel.path}`);
      return;
    case 'project_field':
      out.fields.add(`${ids.projectId(project)}#${sel.path}`);
      return;
    default:
      out.unresolved.push({ selector: sel, reason: `unknown selector kind "${sel.kind}"`, question: `A constraint target of kind "${sel.kind}" is not understood. Known kinds: everything, complement, semantic, item, track, key, frame, marker, item_field, project_field.` });
      if (!out.question) out.question = out.unresolved[out.unresolved.length - 1].question;
      out.certainty = CERTAINTY.USER_INTENT_REQUIRED;
  }
}

/**
 * A resolved part or joint protects the TRACKS that drive it, because that is what a patch can
 * touch. Protecting "the left foot" has to mean protecting whatever animates it — the ankle
 * motor — or the constraint would be unenforceable in exactly the case it exists for.
 */
function expandEntity(project, entityId, out) {
  const p = ids.parseId(entityId);
  if (!p) return;
  if (p.type === 'item') { out.items.add(p.itemId); for (const n of Object.keys(project.tracks?.[p.itemId] || {})) out.tracks.add(ids.trackId(p.itemId, n)); return; }
  if (p.type === 'track') { out.tracks.add(entityId); return; }
  const item = (project.items || []).find((i) => i.id === p.itemId);
  if (!item) return;

  if (p.type === 'joint') {
    const j = (item.rig?.joints || []).find((q) => q.part0 === p.part0 && q.part1 === p.part1);
    if (j) out.tracks.add(ids.trackId(p.itemId, j.name));
    return;
  }
  if (p.type === 'part') {
    // The joint whose part1 is this part is the one that moves it.
    for (const j of item.rig?.joints || []) {
      if (j.part1 === p.partId && j.kind !== 'weld') out.tracks.add(ids.trackId(p.itemId, j.name));
    }
    // The root part is placed by @origin, so protecting the root protects the item's placement.
    if (item.rig && item.rig.rootPart === p.partId) out.tracks.add(ids.trackId(p.itemId, '@origin'));
  }
}

const CERT_RANK = { certain: 0, highly_likely: 1, possible: 2, subjective: 3, user_intent_required: 4 };
const rank = (c) => CERT_RANK[c] ?? 9;

// ---------------------------------------------------------------- checking a patch

/**
 * The checks a `limit` / `match` / `synchronize` / `budget` condition may ask for.
 *
 * `implemented: false` is the important column. A constraint using an unimplemented check is
 * carried, reported and named in `coverage.notRun` — it is never treated as satisfied. The
 * directive's own foot-contact example is one of these, and pretending otherwise would make the
 * whole mechanism untrustworthy for exactly the constraint animators care most about.
 */
export const CHECKS = Object.freeze({
  max_keys: { implemented: true, needs: 'the track', describe: (c) => `at most ${c.max} key(s)` },
  key_times_equal: { implemented: true, needs: 'two tracks', describe: () => 'the same key times on both targets' },
  key_count_equal: { implemented: true, needs: 'two tracks', describe: () => 'the same number of keys on both targets' },
  frame_within: { implemented: true, needs: 'a key on the target track', describe: (c) => `a key within ±${c.tolerance ?? 0} frame(s) of frame ${c.frame}` },
  value_range: { implemented: true, needs: 'a numeric track', describe: (c) => `values between ${c.min} and ${c.max}` },
  marker_sync: { implemented: true, needs: 'a marker and a track', describe: (c) => `a key within ±${c.tolerance ?? 0} frame(s) of the marker` },
  budget_keys: { implemented: true, needs: 'nothing', describe: (c) => `at most ${c.max} key(s) in total` },
  budget_markers: { implemented: true, needs: 'nothing', describe: (c) => `at most ${c.max} marker(s) in total` },
  contact_drift: {
    implemented: false,
    needs: 'world-space effector travel over a frame window',
    describe: (c) => `${c.effector || 'the effector'} staying within ${c.tolerance_studs} stud(s) of its contact point`,
    blocked_on: 'MOT-008 — contact drift measurement (directive Part 23, Phase 5). The FK solve exists (ai/kinematics.js); the contact model and the tolerance test do not.',
  },
  silhouette_unchanged: {
    implemented: false,
    needs: 'a silhouette render pass',
    describe: () => 'the silhouette staying readable',
    blocked_on: 'the silhouette pass exists (OBS-002) and explain_change compares it after an edit. What blocks this CONSTRAINT is that checkConstraints runs on project data before the patch, so no raster reaches it — it is reported, never verified here.',
  },
  no_visual_change: {
    implemented: false,
    needs: 'a render and a pixel comparison',
    describe: () => 'no unapproved visual difference',
    blocked_on: 'image comparison exists now (Part 44: exact-pixel, coverage, edge displacement, object-ID) and explain_change runs it after the edit. What blocks this CONSTRAINT is that checkConstraints sees only project data at check time; a PERCEPTUAL "is this difference visually meaningful" judgement does not exist at all (REG-003).',
  },
  performance_budget: {
    implemented: false,
    needs: 'a particle/emitter cost model on the animation side',
    describe: (c) => `staying inside a performance budget of ${c.max}`,
    blocked_on: 'the PNX profiler measures effect documents, not an animation project (VFX-006).',
  },
});

/**
 * Check a planned patch against a constraint set (Part 54).
 *
 * Returns violations, permitted operations, the checks that could NOT be run, and any conflicts
 * between the constraints themselves. Nothing is resolved: `refused` is a recommendation based on
 * the declared `violation_response`, and the caller decides.
 *
 * @param opts.result  the project as the patch would leave it — `planPatch(...).result`. Required
 *                     by any condition about the state AFTER the patch (`max_keys`, `frame_within`,
 *                     budgets). Without it those constraints report that they could not be
 *                     evaluated rather than being evaluated against the wrong state.
 */
export function checkPatch(project, patch, constraints, { frame = 0, includeProjectLocks = true, result = null } = {}) {
  const all = [...(includeProjectLocks ? listLocks(project) : []), ...(constraints || [])];
  const resolved = all.map((c) => ({ constraint: c, target: mergeTargets(project, c, frame) }));

  const violations = [];
  const notRun = [];
  const unresolvedTargets = [];

  for (const { constraint, target } of resolved) {
    if (target.unresolved.length) {
      unresolvedTargets.push({ constraint: constraint.id, rule: constraint.property_or_semantic_rule, unresolved: target.unresolved, question: target.question });
      notRun.push(`${constraint.id} (${constraint.property_or_semantic_rule}): its target could not be resolved, so it was NOT enforced — ${target.question}`);
      continue;
    }

    if (constraint.constraint_type === 'preserve' || constraint.constraint_type === 'lock' || constraint.constraint_type === 'avoid') {
      for (const op of patch.ops) {
        const hit = opHitsTarget(project, op, target, constraint);
        if (hit) violations.push(violation(constraint, op, hit, target));
      }
      continue;
    }

    // Condition-driven types. An unimplemented check is named, not skipped silently.
    const cond = constraint.condition || {};
    const meta = CHECKS[cond.check];
    if (!meta) {
      notRun.push(`${constraint.id} (${constraint.property_or_semantic_rule}): no check named "${cond.check}" exists, so it was NOT enforced. Available: ${Object.keys(CHECKS).join(', ')}`);
      continue;
    }
    if (!meta.implemented) {
      notRun.push(`${constraint.id}: "${cond.check}" — ${meta.describe(cond)} — cannot be verified yet. ${meta.blocked_on}`);
      continue;
    }
    const found = runCheck(project, patch, constraint, target, cond, result);
    if (found) violations.push(found);
  }

  const conflicts = findConflicts(project, resolved);
  const ranked = violations.slice().sort((a, b) => a.priority - b.priority);
  const refusing = ranked.filter((v) => v.response === 'refuse');

  return {
    checked: all.length,
    constraints: all.map((c) => ({ id: c.id, type: c.constraint_type, rule: c.property_or_semantic_rule, priority: c.priority, priority_name: PRIORITY_NAMES[c.priority], source: c.source, response: c.violation_response })),
    violations: ranked,
    findings: sortFindings(ranked.map((v) => v.finding)),
    conflicts,
    unresolved_targets: unresolvedTargets,
    allowed: !refusing.length,
    // Part 54 again: this is a recommendation with its reason attached, not a decision taken.
    recommendation: refusing.length
      ? `refuse — ${refusing.length} violation(s) of constraints whose declared response is "refuse", highest priority ${refusing[0].priority} (${PRIORITY_NAMES[refusing[0].priority]})`
      : violations.length
        ? `proceed with warnings — ${violations.length} violation(s), none marked refuse`
        : (notRun.length ? 'no violation among the checks that ran; see coverage.notRun for what was not checked' : 'no violation'),
    coverage: coverage({
      scope: `${all.length} constraint(s) against ${patch.ops.length} operation(s), on project data only`,
      frames: null,
      loop: 'fast',
      notRun: [
        ...notRun,
        'nothing visual was checked HERE: the silhouette and object-ID passes and their comparison now exist (Part 43/44), but a constraint check runs on project data before the patch — create_baseline then explain_change is what actually looks. Depth comparison and any perceptual judgement do not exist at all',
        'nothing physical was checked: contact drift, balance and arc deviation need Phase 5 (Part 23)',
      ],
    }),
  };
}

function mergeTargets(project, constraint, frame) {
  const merged = { items: [], tracks: [], keys: [], fields: [], frames: [], everything: false, complementOf: null, unresolved: [], question: null, certainty: CERTAINTY.CERTAIN };
  for (const sel of constraint.target) {
    const r = resolveTarget(project, sel, { frame });
    merged.items.push(...r.items);
    merged.tracks.push(...r.tracks);
    merged.keys.push(...r.keys);
    merged.fields.push(...r.fields);
    merged.frames.push(...r.frames);
    merged.everything = merged.everything || r.everything;
    if (r.complementOf) merged.complementOf = mergeComplement(merged.complementOf, r.complementOf);
    merged.unresolved.push(...r.unresolved);
    if (r.question && !merged.question) merged.question = r.question;
    if (rank(r.certainty) > rank(merged.certainty)) merged.certainty = r.certainty;
  }
  return merged;
}

function mergeComplement(a, b) {
  if (!a) return b;
  return {
    items: [...new Set([...a.items, ...b.items])],
    tracks: [...new Set([...a.tracks, ...b.tracks])],
    keys: [...new Set([...a.keys, ...b.keys])],
    fields: [...new Set([...a.fields, ...b.fields])],
  };
}

/**
 * Does this operation touch what the constraint protects, in an aspect the constraint covers?
 * Returns a reason string, or null.
 */
function opHitsTarget(project, op, target, constraint) {
  const aspects = opAspects(op);
  const covered = constraint.aspect === 'all' ? aspects : aspects.filter((a) => constraint.aspect.includes(a));
  if (!covered.length) return null;

  // A time-ranged constraint only bites inside its range.
  if (constraint.time_range) {
    const [a, b] = constraint.time_range;
    const times = opTimes(op);
    if (times.length && !times.some((t) => t >= a - EPS && t <= b + EPS)) return null;
  }

  const trackId = op.track ? ids.trackId(op.itemId, op.track) : null;
  const keyIdent = op.track && op.t !== undefined ? ids.keyId(op.itemId, op.track, op.t) : null;
  const fieldIdent = op.op === 'set_item_field' ? `${ids.itemId(op.itemId)}#${op.path}`
    : op.op === 'set_project_field' ? `${ids.projectId(project)}#${op.path}`
      : (op.op === 'set_marker' || op.op === 'delete_marker') ? ids.markerId(op.itemId, Math.max(0, Math.round(op.t))) : null;

  const why = (what) => `${op.op} touches ${what} (${covered.join('/')}) protected by ${constraint.constraint_type} "${constraint.property_or_semantic_rule}"`;

  if (target.everything) return why('the whole project');

  if (target.complementOf) {
    // The allow-list case: a hit is an op that falls OUTSIDE everything named as allowed.
    const inAllowed = (trackId && target.complementOf.tracks.includes(trackId))
      || (keyIdent && target.complementOf.keys.includes(keyIdent))
      || (fieldIdent && target.complementOf.fields.includes(fieldIdent))
      || (op.itemId && target.complementOf.items.includes(op.itemId) && !trackId);
    if (!inAllowed) return why(`${describeOpTarget(op)}, which is not in the allowed scope`);
  }

  if (target.keys.length && keyIdent && target.keys.includes(keyIdent)) return why(`the key ${op.track} @ ${op.t}`);
  if (target.tracks.length && trackId && target.tracks.includes(trackId)) return why(`the track ${op.track}`);
  if (target.fields.length && fieldIdent && target.fields.includes(fieldIdent)) return why(fieldIdent.split('#').pop());
  // An item-level protection covers a whole-item edit even when no track of it is named.
  if (target.items.length && op.itemId && target.items.includes(op.itemId) && !trackId && !fieldIdent) return why(`item ${op.itemId}`);

  // A protected moment in time: any op landing inside the tolerance window hits it, whatever
  // track it belongs to. That is what "keep the impact on frame 16" means.
  for (const f of target.frames) {
    const tol = f.tolerance ?? 0;
    for (const t of opTimes(op)) {
      if (Math.abs(t - f.t) <= tol + EPS) return why(`frame ${f.t}${tol ? ` ±${tol}` : ''}`);
    }
  }
  return null;
}

function describeOpTarget(op) {
  if (op.track) return `${op.track} on ${op.itemId}`;
  if (op.path) return `${op.itemId ? 'item' : 'project'}.${op.path}`;
  return op.itemId || 'the project';
}

function opTimes(op) {
  switch (op.op) {
    case 'set_key': case 'restore_key': case 'delete_key': case 'set_easing':
    case 'set_marker': case 'delete_marker':
      return [op.t];
    case 'move_key': return [op.t, op.to];
    default: return [];
  }
}

function violation(constraint, op, why, target) {
  return {
    constraint_id: constraint.id,
    constraint_type: constraint.constraint_type,
    rule: constraint.property_or_semantic_rule,
    priority: constraint.priority,
    priority_name: PRIORITY_NAMES[constraint.priority],
    source: constraint.source,
    response: constraint.violation_response,
    op,
    reason: why,
    finding: finding({
      id: `CONSTRAINT-${constraint.constraint_type.toUpperCase()}`,
      // A protection resting on a measured target is only as certain as the measurement was.
      certainty: target.certainty === CERTAINTY.CERTAIN ? CERTAINTY.CERTAIN : target.certainty,
      statement: why,
      evidence: [
        evidence('data', 'the operation as planned', { op }),
        evidence('data', 'the constraint it violates', { id: constraint.id, type: constraint.constraint_type, rule: constraint.property_or_semantic_rule, priority: constraint.priority, source: constraint.source }),
        ...(constraint.reason ? [evidence('data', 'why the constraint exists', constraint.reason)] : []),
      ],
      frame: opTimes(op)[0] ?? null,
      suggestion: constraint.constraint_type === 'lock'
        ? { text: 'unlock_constraint removes the lock if the user agrees it should not apply here', reversible: true }
        : { text: 'narrow the patch so it does not touch this target, or drop the constraint explicitly', reversible: true },
    }),
  };
}

// ---------------------------------------------------------------- condition checks

function runCheck(project, patch, constraint, target, cond, result) {
  // Conditions are evaluated against the PLANNED RESULT. Without it, a condition about the state
  // after the patch cannot be evaluated, and saying so beats evaluating the wrong state.
  const after = result || null;
  if (!after) {
    return {
      constraint_id: constraint.id, constraint_type: constraint.constraint_type, rule: constraint.property_or_semantic_rule,
      priority: constraint.priority, priority_name: PRIORITY_NAMES[constraint.priority], source: constraint.source,
      response: 'warn', op: null, reason: `"${cond.check}" describes the state after the patch, and no planned result was supplied`,
      finding: finding({
        id: 'CONSTRAINT-NO-RESULT', certainty: CERTAINTY.CERTAIN,
        statement: `${constraint.id} could not be evaluated: "${cond.check}" is a condition on the resulting state, and the checker was given no planned result to look at`,
        evidence: [evidence('absence', 'checkPatch was called without opts.result — pass planPatch(...).result')],
      }),
    };
  }

  const fail = (statement, ev) => ({
    constraint_id: constraint.id, constraint_type: constraint.constraint_type, rule: constraint.property_or_semantic_rule,
    priority: constraint.priority, priority_name: PRIORITY_NAMES[constraint.priority], source: constraint.source,
    response: constraint.violation_response, op: null, reason: statement,
    finding: finding({ id: `CONSTRAINT-${cond.check.toUpperCase()}`, certainty: CERTAINTY.CERTAIN, statement, evidence: ev }),
  });

  switch (cond.check) {
    case 'max_keys': {
      for (const trackIdent of target.tracks) {
        const p = ids.parseId(trackIdent);
        const n = (after.tracks?.[p.itemId]?.[p.track]?.keys || []).length;
        if (n > cond.max) return fail(`"${p.track}" would hold ${n} keys, over the limit of ${cond.max}`, [evidence('measurement', 'key count after the patch', { track: p.track, keys: n, max: cond.max })]);
      }
      return null;
    }
    case 'budget_keys': {
      let n = 0;
      for (const perItem of Object.values(after.tracks || {})) for (const tr of Object.values(perItem)) n += (tr.keys || []).length;
      if (n > cond.max) return fail(`the project would hold ${n} keys, over the budget of ${cond.max}`, [evidence('measurement', 'total key count after the patch', { keys: n, max: cond.max })]);
      return null;
    }
    case 'budget_markers': {
      let n = 0;
      for (const list of Object.values(after.markers || {})) n += list.length;
      if (n > cond.max) return fail(`the project would hold ${n} markers, over the budget of ${cond.max}`, [evidence('measurement', 'total marker count after the patch', { markers: n, max: cond.max })]);
      return null;
    }
    case 'frame_within': {
      const tol = cond.tolerance ?? 0;
      for (const trackIdent of target.tracks) {
        const p = ids.parseId(trackIdent);
        const times = (after.tracks?.[p.itemId]?.[p.track]?.keys || []).map((k) => k.t);
        if (!times.some((t) => Math.abs(t - cond.frame) <= tol + EPS)) {
          return fail(`"${p.track}" has no key within ±${tol} frame(s) of frame ${cond.frame} after the patch`, [evidence('measurement', 'key times after the patch', { track: p.track, times, want: cond.frame, tolerance: tol })]);
        }
      }
      return null;
    }
    case 'key_times_equal':
    case 'key_count_equal': {
      const other = resolveTarget(project, cond.other, {});
      const timesOf = (list) => list.map((tid) => {
        const p = ids.parseId(tid);
        return (after.tracks?.[p.itemId]?.[p.track]?.keys || []).map((k) => k.t);
      });
      const a = timesOf(target.tracks).flat().sort((x, y) => x - y);
      const b = timesOf(other.tracks).flat().sort((x, y) => x - y);
      if (cond.check === 'key_count_equal') {
        if (a.length !== b.length) return fail(`the two targets would hold ${a.length} and ${b.length} keys, which are not equal`, [evidence('measurement', 'key counts after the patch', { a: a.length, b: b.length })]);
        return null;
      }
      if (a.length !== b.length || a.some((t, i) => Math.abs(t - b[i]) > EPS)) {
        return fail('the two targets would not share the same key times', [evidence('measurement', 'key times after the patch', { a, b })]);
      }
      return null;
    }
    case 'value_range': {
      for (const trackIdent of target.tracks) {
        const p = ids.parseId(trackIdent);
        for (const k of after.tracks?.[p.itemId]?.[p.track]?.keys || []) {
          if (typeof k.v !== 'number') {
            return fail(`"${p.track}" holds ${Array.isArray(k.v) ? 'CFrame' : typeof k.v} values, so a numeric range cannot be applied to it`, [evidence('data', 'the value at the first non-numeric key', { t: k.t })]);
          }
          if (k.v < cond.min - EPS || k.v > cond.max + EPS) {
            return fail(`"${p.track}" would hold ${k.v} at frame ${k.t}, outside [${cond.min}, ${cond.max}]`, [evidence('measurement', 'the out-of-range value', { t: k.t, v: k.v, min: cond.min, max: cond.max })]);
          }
        }
      }
      return null;
    }
    case 'marker_sync': {
      const tol = cond.tolerance ?? 0;
      for (const f of target.frames) {
        let best = null;
        for (const trackIdent of (cond.tracks || target.tracks)) {
          const p = ids.parseId(trackIdent);
          for (const k of after.tracks?.[p.itemId]?.[p.track]?.keys || []) {
            const d = Math.abs(k.t - f.t);
            if (best === null || d < best.d) best = { d, t: k.t, track: p.track };
          }
        }
        if (!best || best.d > tol + EPS) {
          return fail(`no key lands within ±${tol} frame(s) of the event at frame ${f.t}${best ? ` (nearest is ${best.track} @ ${best.t})` : ''}`, [evidence('measurement', 'the nearest key to the event', { event: f.t, nearest: best, tolerance: tol })]);
        }
      }
      return null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------- conflicts (CON-004)

/**
 * Conflicts BETWEEN constraints — the ones that make a set unsatisfiable no matter what the patch
 * does. Reported with both priorities so the caller can see which would win by Part 54's ladder,
 * and told explicitly that nothing was resolved.
 */
export function findConflicts(project, resolved) {
  const out = [];

  // Two budgets on the same countable: the looser one can never bind, which usually means one of
  // them is a leftover nobody meant to keep.
  const budgets = resolved.filter((r) => r.constraint.constraint_type === 'budget' && r.constraint.condition?.check);
  for (let i = 0; i < budgets.length; i++) {
    for (let j = i + 1; j < budgets.length; j++) {
      const a = budgets[i].constraint, b = budgets[j].constraint;
      if (a.condition.check !== b.condition.check) continue;
      if (a.condition.max === b.condition.max) continue;
      const [tight, loose] = a.condition.max < b.condition.max ? [a, b] : [b, a];
      out.push(conflict('BUDGET-SHADOWED', [a, b],
        `two "${a.condition.check}" budgets are declared (${a.condition.max} and ${b.condition.max}); the tighter one (${tight.condition.max}, priority ${tight.priority}) is the only one that can ever bind`,
        ['drop the looser budget', 'raise the tighter budget if it was not intended']));
    }
  }

  // Two numeric ranges on the same target that do not overlap.
  const ranges = resolved.filter((r) => r.constraint.condition?.check === 'value_range');
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i], b = ranges[j];
      if (!a.target.tracks.some((t) => b.target.tracks.includes(t))) continue;
      const ac = a.constraint.condition, bc = b.constraint.condition;
      if (ac.max < bc.min - EPS || bc.max < ac.min - EPS) {
        out.push(conflict('RANGE-DISJOINT', [a.constraint, b.constraint],
          `[${ac.min}, ${ac.max}] and [${bc.min}, ${bc.max}] are required on the same track and do not overlap, so no value can satisfy both`,
          ['widen one range', 'drop the lower-priority constraint', 'ask which range the user meant']));
      }
    }
  }

  // A `match` whose two sides already differ, where one side is also locked or preserved: the
  // match can only be satisfied by changing something that must not change.
  for (const r of resolved) {
    const c = r.constraint;
    if (c.constraint_type !== 'match' || !c.condition?.other) continue;
    const other = resolveTarget(project, c.condition.other, {});
    for (const p of resolved) {
      if (p === r) continue;
      if (p.constraint.constraint_type !== 'lock' && p.constraint.constraint_type !== 'preserve') continue;
      const overlapsA = r.target.tracks.some((t) => p.target.tracks.includes(t));
      const overlapsB = other.tracks.some((t) => p.target.tracks.includes(t));
      if (!overlapsA && !overlapsB) continue;
      if (currentlyMatches(project, r.target, other, c.condition)) continue;
      out.push(conflict('MATCH-VS-PROTECTED', [c, p.constraint],
        `"${c.property_or_semantic_rule}" requires the two targets to agree, they currently do not, and ${p.constraint.constraint_type} "${p.constraint.property_or_semantic_rule}" forbids changing ${overlapsA ? 'the first' : 'the second'} of them`,
        ['relax the protection for this edit', 'drop the match requirement', 'change the unprotected side only, and accept the asymmetry']));
    }
  }

  // The same target protected twice with different priorities is not a conflict, but it is worth
  // reporting: the stricter response governs, and a caller comparing the two should know.
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i], b = resolved[j];
      if (!['lock', 'preserve'].includes(a.constraint.constraint_type) || !['lock', 'preserve'].includes(b.constraint.constraint_type)) continue;
      if (a.constraint.violation_response === b.constraint.violation_response) continue;
      if (!a.target.tracks.some((t) => b.target.tracks.includes(t))) continue;
      const strict = a.constraint.violation_response === 'refuse' ? a.constraint : b.constraint;
      out.push(conflict('RESPONSE-MISMATCH', [a.constraint, b.constraint],
        `the same target is protected twice with different responses ("${a.constraint.violation_response}" and "${b.constraint.violation_response}"); the stricter one (${strict.id}, ${strict.violation_response}) governs`,
        ['align the two responses', 'remove the redundant constraint'], 'informational'));
    }
  }
  return out;
}

function currentlyMatches(project, targetA, targetB, cond) {
  const timesOf = (list) => list.map((tid) => {
    const p = ids.parseId(tid);
    return (project.tracks?.[p.itemId]?.[p.track]?.keys || []).map((k) => k.t);
  }).flat().sort((x, y) => x - y);
  const a = timesOf(targetA.tracks), b = timesOf(targetB.tracks);
  if (cond.check === 'key_count_equal') return a.length === b.length;
  return a.length === b.length && a.every((t, i) => Math.abs(t - b[i]) < EPS);
}

function conflict(id, constraints, statement, alternatives, severity = 'blocking') {
  return {
    id,
    severity,
    constraints: constraints.map((c) => ({ id: c.id, type: c.constraint_type, rule: c.property_or_semantic_rule, priority: c.priority, priority_name: PRIORITY_NAMES[c.priority], source: c.source })),
    statement,
    // Part 54: explain the conflict and offer alternatives. Offering is the whole obligation —
    // choosing is not.
    alternatives,
    resolved_automatically: false,
    finding: finding({
      id: `CONSTRAINT-CONFLICT-${id}`,
      certainty: CERTAINTY.CERTAIN,
      statement,
      evidence: [evidence('data', 'the two constraints in conflict', constraints.map((c) => ({ id: c.id, rule: c.property_or_semantic_rule, priority: c.priority })))],
      suggestion: { text: `alternatives: ${alternatives.join('; ')}`, reversible: true },
    }),
  };
}

// ---------------------------------------------------------------- locks (CON-005, SEM-010)

function lockStore(project, { create = false } = {}) {
  if (!project.semantics) { if (!create) return null; project.semantics = {}; }
  if (!project.semantics.locks) { if (!create) return null; project.semantics.locks = { version: 1, entries: [] }; }
  const l = project.semantics.locks;
  if (!Array.isArray(l.entries)) l.entries = [];
  return l;
}

/** Every persisted lock, as ConstraintSpecs. */
export function listLocks(project) {
  const l = lockStore(project);
  return l ? l.entries.slice() : [];
}

/**
 * Persist a lock. Returns the ConstraintSpec that was stored, or the existing one if an identical
 * lock is already held — a lock id is the hash of its own content, so locking the same thing twice
 * is idempotent rather than a second entry nobody can tell apart from the first.
 */
export function lock(project, { target, aspect, timeRange, reason, author = 'user', createdAt = null, priority }) {
  const spec = constraintSpec({
    constraint_type: 'lock', target, aspect, timeRange, reason, author, createdAt,
    source: author === 'user' ? 'user' : 'ai',
    priority: priority ?? PRIORITY.USER_LOCK,
    violationResponse: 'refuse',
    userApprovalRequired: true,
  });
  const store = lockStore(project, { create: true });
  const existing = store.entries.find((e) => e.id === spec.id);
  if (existing) return { entry: existing, created: false };
  store.entries.push(spec);
  return { entry: spec, created: true };
}

/** Remove a lock by id. Returns the removed spec, or null. */
export function unlock(project, id) {
  const store = lockStore(project);
  if (!store) return null;
  const i = store.entries.findIndex((e) => e.id === id);
  if (i === -1) return null;
  const [gone] = store.entries.splice(i, 1);
  if (!store.entries.length) {
    delete project.semantics.locks;
    // …and if that was the only thing under `semantics`, remove the container too. A project that
    // has never been annotated has no `semantics` at all, and `{}` hashes differently from absent
    // (see hash.js) — leaving an empty object behind would make the next save/load look like an
    // edit, and would make "locking then unlocking returns to the previous state" false.
    if (!Object.keys(project.semantics).length) delete project.semantics;
  }
  return gone;
}

/**
 * The lock state of one item, for the Scene Graph's `lock_state` field (SEM-010).
 * Reports WHY, not just whether — a lock nobody can explain is a lock somebody will remove.
 *
 * Targets are RESOLVED rather than pattern-matched on `itemId`: a lock written as "the camera" or
 * "the weapon hand" has no literal item id in it, and a lock state that missed those would report
 * a locked item as free.
 */
export function lockStateOf(project, itemId) {
  const hits = [];
  for (const e of listLocks(project)) {
    const t = mergeTargets(project, e, 0);
    const covers = t.everything
      || t.items.includes(itemId)
      || t.tracks.some((tid) => ids.parseId(tid)?.itemId === itemId)
      || t.keys.some((kid) => ids.parseId(kid)?.itemId === itemId)
      || t.fields.some((f) => f.startsWith(`${ids.itemId(itemId)}#`) || ids.parseId(f)?.itemId === itemId);
    if (covers) hits.push({ entry: e, resolved: t });
  }
  if (!hits.length) return { locked: false, scope: null, reason: null, constraints: [] };
  const whole = hits.some((h) => h.resolved.everything || h.resolved.items.includes(itemId));
  return {
    locked: true,
    scope: whole ? 'item' : 'tracks',
    reason: hits.map((h) => h.entry.reason).filter(Boolean).join('; ') || null,
    constraints: hits.map((h) => ({
      id: h.entry.id,
      rule: h.entry.property_or_semantic_rule,
      aspect: h.entry.aspect,
      time_range: h.entry.time_range,
      tracks: h.resolved.tracks.filter((tid) => ids.parseId(tid)?.itemId === itemId),
    })),
  };
}

// ---------------------------------------------------------------- compilation (CON-001)

/**
 * Compile a change request into ConstraintSpecs.
 *
 * The structured form is the real interface; `text` is a convenience over a SMALL CLOSED grammar.
 * That is a deliberate limit: a constraint compiler that guesses at free prose would produce
 * protections the user never asked for and, worse, silently fail to produce ones they did. Every
 * line the grammar does not recognise comes back in `unparsed` with a question attached.
 *
 * @param req.preserve   selectors or phrases that must not change
 * @param req.lock       selectors or phrases to protect at lock priority (not persisted — use
 *                       `lock()` for that; this is per-request)
 * @param req.allow      the ONLY things the patch may touch; compiles to a complement protection
 * @param req.protect_frames `[{ frame, tolerance?, reason? }]`
 * @param req.contacts   `[{ effector, from, to, tolerance_studs }]` — recorded, NOT yet checkable
 * @param req.budgets    `[{ countable:'keys'|'markers', max }]`
 * @param req.avoid      selectors or phrases the patch must stay off
 * @param req.aspect     default aspect for `preserve`/`allow` (e.g. 'timing')
 * @param req.text       lines in the closed grammar below
 */
export function compileConstraints(req = {}, project = null, { source = 'user', author = null, createdAt = null } = {}) {
  const out = [];
  const unparsed = [];
  const questions = [];
  const notes = [];
  const mk = (o) => constraintSpec({ source, author, createdAt, ...o });

  for (const t of req.preserve || []) out.push(mk({ constraint_type: 'preserve', target: asSelector(t), aspect: req.aspect, reason: req.reason }));
  for (const t of req.lock || []) out.push(mk({ constraint_type: 'lock', target: asSelector(t), aspect: req.aspect, reason: req.reason, priority: PRIORITY.USER_LOCK }));
  for (const t of req.avoid || []) out.push(mk({ constraint_type: 'avoid', target: asSelector(t), aspect: req.aspect, reason: req.reason }));

  if (req.allow && req.allow.length) {
    out.push(mk({
      constraint_type: 'preserve',
      target: { kind: 'complement', of: req.allow.map(asSelector) },
      aspect: req.aspect,
      rule: `only ${req.allow.map((a) => (typeof a === 'string' ? `"${a}"` : describeTarget(asSelector(a)))).join(', ')} may change`,
      reason: req.reason || 'the request named an allowed scope, so everything outside it is protected by default',
    }));
    notes.push('an allowed scope was given, so it was compiled into a protection over everything else — Part 54\'s "for a local correction, the default must be minimal scope"');
  }

  for (const f of req.protect_frames || []) {
    out.push(mk({
      constraint_type: 'preserve',
      target: { kind: 'frame', t: f.frame, tolerance: f.tolerance ?? 0 },
      priority: PRIORITY.SHOT_EVENT,
      reason: f.reason || `frame ${f.frame} is a protected moment`,
      rule: `frame ${f.frame} stays put${f.tolerance ? ` within ±${f.tolerance} frame(s)` : ''}`,
    }));
  }

  for (const c of req.contacts || []) {
    out.push(mk({
      constraint_type: 'limit',
      target: asSelector(c.effector),
      timeRange: [c.from, c.to],
      priority: PRIORITY.SHOT_EVENT,
      condition: { check: 'contact_drift', effector: typeof c.effector === 'string' ? c.effector : describeTarget(asSelector(c.effector)), tolerance_studs: c.tolerance_studs },
      violationResponse: 'warn',
      reason: c.reason || 'a declared contact',
      rule: `${typeof c.effector === 'string' ? c.effector : 'the effector'} stays planted from frame ${c.from} to ${c.to}`,
    }));
    notes.push(`the contact constraint on frames ${c.from}–${c.to} is RECORDED but cannot be verified yet: ${CHECKS.contact_drift.blocked_on}`);
  }

  for (const b of req.budgets || []) {
    const check = b.countable === 'markers' ? 'budget_markers' : 'budget_keys';
    out.push(mk({
      constraint_type: 'budget',
      target: { kind: 'everything' },
      condition: { check, max: b.max },
      priority: b.priority ?? PRIORITY.PROJECT_CONVENTION,
      rule: `at most ${b.max} ${b.countable || 'keys'} in the project`,
    }));
  }

  if (req.text) {
    for (const raw of String(req.text).split(/[\n;]+/)) {
      const line = raw.trim();
      if (!line) continue;
      const parsed = parseLine(line, mk);
      if (parsed) { out.push(...parsed.constraints); if (parsed.note) notes.push(parsed.note); }
      else {
        unparsed.push(line);
        questions.push(`"${line}" was not understood, so nothing protects it. Restate it as one of the recognised forms (see \`grammar\`), or pass it structurally.`);
      }
    }
  }

  // Two identical constraints are one constraint — the id is a content hash, so dedup is exact.
  const seen = new Set();
  const deduped = out.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));

  return {
    constraints: deduped,
    unparsed,
    questions,
    notes,
    grammar: GRAMMAR.map((g) => g.example),
    by_priority: deduped.slice().sort((a, b) => a.priority - b.priority)
      .map((c) => ({ priority: c.priority, priority_name: PRIORITY_NAMES[c.priority], type: c.constraint_type, rule: c.property_or_semantic_rule })),
    summary: `${deduped.length} constraint(s)${unparsed.length ? `, ${unparsed.length} line(s) NOT understood and therefore NOT enforced` : ''}`,
  };
}

/** A bare string is a semantic phrase; anything else is already a selector. */
function asSelector(t) {
  if (typeof t === 'string') return { kind: 'semantic', query: t };
  return t;
}

/**
 * The closed grammar. Each entry is a pattern, what it compiles to, and an example that is also
 * the documentation returned to a caller. Adding a form means adding a row here; there is no
 * fallback that guesses.
 */
const GRAMMAR = [
  {
    example: 'do not change timing',
    re: /^(?:do not|don't|never) change (?:the )?timing$/i,
    build: (m, mk) => ({ constraints: [mk({ constraint_type: 'preserve', target: { kind: 'everything' }, aspect: ['timing'], rule: 'no key changes time' })] }),
  },
  {
    example: 'do not change poses',
    re: /^(?:do not|don't|never) change (?:the )?(?:poses|pose|values)$/i,
    build: (m, mk) => ({ constraints: [mk({ constraint_type: 'preserve', target: { kind: 'everything' }, aspect: ['value'], rule: 'no key changes value' })] }),
  },
  {
    example: 'do not change easing',
    re: /^(?:do not|don't|never) change (?:the )?(?:easing|eases|interpolation)$/i,
    build: (m, mk) => ({ constraints: [mk({ constraint_type: 'preserve', target: { kind: 'everything' }, aspect: ['easing'], rule: 'no key changes easing' })] }),
  },
  {
    example: 'keep frame 16 (within 1 frame)',
    re: /^keep (?:the [\w\s]+ (?:on|at) )?frame (-?\d+(?:\.\d+)?)(?:\s*(?:within|±)\s*(\d+(?:\.\d+)?)\s*frames?)?$/i,
    build: (m, mk) => ({ constraints: [mk({
      constraint_type: 'preserve',
      target: { kind: 'frame', t: Number(m[1]), tolerance: m[2] ? Number(m[2]) : 0 },
      priority: PRIORITY.SHOT_EVENT,
      rule: `frame ${m[1]} stays put${m[2] ? ` within ±${m[2]} frame(s)` : ''}`,
    })] }),
  },
  {
    example: 'keep the left foot within 2 studs from frame 12 to 23',
    re: /^keep (.+?) within ([\d.]+)\s*(studs?|cm|m)\s*from frame (-?[\d.]+) to (-?[\d.]+)$/i,
    build: (m, mk) => {
      const studs = m[3].toLowerCase().startsWith('cm') ? Number(m[2]) / 28 : m[3].toLowerCase() === 'm' ? Number(m[2]) * 3.5714 : Number(m[2]);
      return {
        constraints: [mk({
          constraint_type: 'limit',
          target: { kind: 'semantic', query: m[1] },
          timeRange: [Number(m[4]), Number(m[5])],
          priority: PRIORITY.SHOT_EVENT,
          violationResponse: 'warn',
          condition: { check: 'contact_drift', effector: m[1], tolerance_studs: studs },
          rule: `${m[1]} stays within ${m[2]} ${m[3]} from frame ${m[4]} to ${m[5]}`,
        })],
        note: `the contact constraint on "${m[1]}" is RECORDED but cannot be verified yet: ${CHECKS.contact_drift.blocked_on}`,
      };
    },
  },
  {
    example: 'lock the camera',
    re: /^lock (.+)$/i,
    build: (m, mk) => ({ constraints: [mk({ constraint_type: 'lock', target: { kind: 'semantic', query: m[1] }, priority: PRIORITY.USER_LOCK, rule: `${m[1]} is locked` })] }),
  },
  {
    example: 'do not change the camera',
    re: /^(?:do not|don't|never|avoid) (?:change|changing|touch|touching|move|moving) (.+)$/i,
    build: (m, mk) => ({ constraints: [mk({ constraint_type: 'preserve', target: { kind: 'semantic', query: m[1] }, rule: `${m[1]} does not change` })] }),
  },
  {
    example: 'preserve the left arm',
    re: /^(?:preserve|protect|keep) (.+)$/i,
    build: (m, mk) => ({ constraints: [mk({ constraint_type: 'preserve', target: { kind: 'semantic', query: m[1] }, rule: `${m[1]} is preserved` })] }),
  },
  {
    example: 'at most 200 keys',
    re: /^(?:at most|no more than|max) (\d+) (keys?|markers?)$/i,
    build: (m, mk) => ({ constraints: [mk({
      constraint_type: 'budget',
      target: { kind: 'everything' },
      condition: { check: /marker/i.test(m[2]) ? 'budget_markers' : 'budget_keys', max: Number(m[1]) },
      priority: PRIORITY.PROJECT_CONVENTION,
      rule: `at most ${m[1]} ${m[2]}`,
    })] }),
  },
];

function parseLine(line, mk) {
  for (const g of GRAMMAR) {
    const m = line.match(g.re);
    if (m) return g.build(m, mk);
  }
  return null;
}

/** Everything a caller needs to write a constraint, in one call — the closed vocabularies, the
 *  priority ladder, and which checks are real. */
export function constraintVocabulary() {
  return {
    types: CONSTRAINT_TYPES,
    aspects: ASPECTS,
    selector_kinds: ['everything', 'complement', 'semantic', 'item', 'track', 'key', 'frame', 'marker', 'item_field', 'project_field'],
    priorities: Object.entries(PRIORITY).map(([name, value]) => ({ value, name: name.toLowerCase().replace(/_/g, ' ') })),
    checks: Object.entries(CHECKS).map(([name, c]) => ({ name, implemented: c.implemented, needs: c.needs, blocked_on: c.blocked_on ?? null })),
    text_grammar: GRAMMAR.map((g) => g.example),
    responses: ['refuse', 'warn', 'ask'],
    note: 'a constraint whose check is not implemented is recorded, reported, and named in coverage.notRun — it is never counted as satisfied',
  };
}
