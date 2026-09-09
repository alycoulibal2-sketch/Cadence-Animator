// Reversible patches (directive Part 55).
//
// "Every mutating operation must be represented as a transaction: INSPECT → PLAN → DRY RUN OR
// PREVIEW → APPLY TO TRANSACTIONAL STATE → VALIDATE → ACCEPT OR ROLLBACK."
//
// A patch is a list of typed operations on project data. Every operation knows how to undo
// itself, so the inverse of a patch is computed from the state it actually found — not guessed
// from the state it expected. That distinction is the whole point: `undo` in Cadence is a
// whole-project clone stack, which is safe but coarse. It cannot answer "roll back only the
// left arm" or "roll back only frames 12 to 23" (Part 55's required recovery actions), because a
// clone has no idea which parts of it were the change.
//
// Three properties this module is built to guarantee, each verified by a test rather than
// promised in prose:
//
//  1. **Nothing partial, ever.** `planPatch` runs the whole operation list against a CLONE and
//     touches the caller's project not at all. `commitPatch` re-runs the identical code over the
//     real project, then checks the result's content hash against the hash the plan predicted; a
//     mismatch restores the pre-commit state and throws. Part 55's failure behaviour — "preserve
//     the current accepted state; avoid applying an unvalidated partial result" — is therefore
//     enforced, not merely intended.
//
//  2. **The inverse is exact.** Where a key is modified, its inverse carries the previous key
//     VERBATIM (`restore_key`) rather than a field-by-field reconstruction. `state.js`'s `setKey`
//     writes easing fields conditionally (`if (opts.es) k.es = opts.es`), so a reconstructed
//     inverse cannot restore a key that was missing `es` altogether — as keys written by an older
//     Cadence version, or by an import, genuinely are. A verbatim restore has no such hole.
//
//  3. **It reproduces `state.js` exactly, or says where it does not.** This module writes into
//     `project.tracks` itself, because `state.js` cannot be imported outside Electron — the same
//     duplication `ai/kinematics.js` carries, with the same risk. The in-app smoketest applies
//     the same edits through both paths and compares the resulting project byte for byte. Where
//     the two DELIBERATELY differ, the difference is a planned warning on the operation, never a
//     silent divergence: see `UI_AFFORDANCES` below.

import { contentHash, contentFingerprint, shortHash } from './hash.js';
import { cloneProject, withoutHistory, diffProjects } from './snapshot.js';
import { paramsFor } from '../easing.js';
import * as ids from './ids.js';
import { CERTAINTY, evidence, finding } from './certainty.js';

/** Times are compared with the same epsilon `state.js` uses everywhere, so "the key at 16" means
 *  the same key to both. */
const EPS = 1e-6;
const near = (a, b) => Math.abs(a - b) < EPS;

export const OP_KINDS = Object.freeze([
  'set_key',           // create or modify a keyframe
  'restore_key',       // make the key at t be exactly this object (the inverse of a modification)
  'delete_key',
  'move_key',          // retime one key, retargeting its group entry as state.js does
  'set_easing',        // timing without touching pose — Part 27's independent dimensions
  'set_track_space',
  'remove_track',
  'set_item_field',
  'set_project_field',
  'set_marker',        // shot events (Part 41); a constraint can protect one
  'restore_marker',    // write a marker verbatim (the inverse of a modification or a delete)
  'delete_marker',
  'restore_group_entry', // put a key group's recorded time back (the inverse of a move's retarget)
  'add_item',          // bring a whole item into being (Part 37's effects have to be CREATED)
  'remove_item',       // take one back out; the exact inverse of add_item
]);

/**
 * Warnings that mean "the state was not what this operation expected", as distinct from warnings
 * about a CONSEQUENCE of an operation that did exactly what it was told.
 *
 * Only these are promoted to refusals in strict mode. The distinction matters because an inverse
 * patch is built strict — a rollback must not proceed when the key it meant to restore has moved
 * — but an inverse legitimately carries the same consequence warnings the forward patch did (a
 * group it does not expand, a space it does not convert). Promoting those would make every
 * rollback of a grouped or unparented track fail.
 */
const STATE_MISMATCH_WARNINGS = Object.freeze(new Set([
  'PATCH-KEY-ABSENT',
  'PATCH-TRACK-ABSENT',
  'PATCH-MARKER-ABSENT',
  'PATCH-MOVE-CLAMPED',
  'PATCH-GROUP-ENTRY-ABSENT',
]));

/**
 * Item and project fields a patch may write.
 *
 * Deliberately narrow. Everything excluded is excluded for a reason that is stated, because Part
 * 4.7 requires a missing capability to be named rather than hidden: a caller that discovers
 * `rig` is not patchable should learn why, not conclude patches are unreliable.
 */
const ITEM_FIELDS = Object.freeze({
  name: 'the display name',
  origin: 'the item\'s static placement (the @origin track overrides it wherever it has keys)',
  fov: 'a camera\'s field of view',
  hidden: 'viewport visibility',
  effectStart: 'the frame an effect item begins at',
  effectLoop: 'whether an effect item loops',
  tags: 'free-form tags',
});
const ITEM_FIELDS_REFUSED = Object.freeze({
  rig: 'rig topology is not animation data — parts and joints have their own tools (create_joint, remove_joint, convert_joint) and changing them invalidates every track keyed by joint name',
  attachedTo: 'attachment changes the transform space of everything below it — attach_item/detach_item exist because the offset has to be re-derived, which a blind field write would not do',
  effect: 'an effect document is a whole PNX graph with its own undo and its own validators',
  id: 'an item id is the addressing every track, group, marker and provenance record uses',
  kind: 'changing an item\'s kind would leave its tracks meaningless',
});
const PROJECT_FIELDS = Object.freeze({
  name: 'the project name',
  fps: 'frame rate',
  length: 'timeline length in frames',
  loop: 'whether the exported animation loops',
  priority: 'the Roblox AnimationPriority',
  playRange: 'the play range ({start,end} or null)',
});
const PROJECT_FIELDS_REFUSED = Object.freeze({
  items: 'items are added and removed by their own tools; a wholesale replacement would strand every track, group and marker keyed by item id',
  tracks: 'that is what the keyframe operations are for — a wholesale replacement has no computable inverse beyond "the whole previous table"',
  groups: 'key groups are edited by group_keys / ungroup_keys',
  markers: 'use set_marker / delete_marker',
  semantics: 'the semantic layer owns this: roles go through set_semantic_role, locks through lock_constraint, provenance is append-only',
  textureLib: 'a serialisation detail that only exists on disk',
});

/**
 * Where this module deliberately does NOT reproduce `state.js`, and what it does instead.
 *
 * Each of these is a UI affordance: something the editor does for a human that a patch must not
 * do behind a caller's back. Every one produces a planned warning naming the exact edit the UI
 * would have made, so the caller can ask for it explicitly.
 */
export const UI_AFFORDANCES = Object.freeze([
  {
    id: 'auto_zero_key',
    state_js: 'setKey() also writes a rest-pose key at frame 0 when keying at frame >= 1 on a track that has none, so the motion starts from where the part really is',
    here: 'not performed — the rest value of a track depends on the item kind, the property registry and the emitter defaults, and reimplementing that lookup is exactly the drift this layer avoids. The plan warns and names the gap so a caller can add the frame-0 key itself',
  },
  {
    id: 'group_expansion',
    state_js: 'moveKeys() pulls in every other key of a group so dragging one moves the whole group',
    here: 'only the named key moves. The plan warns and lists the sibling keys, because a patch that moves half a group is usually a mistake and silently moving keys nobody asked about is worse',
  },
  {
    id: 'use_last_easing',
    state_js: 'a new key inherits `state.lastEasing` when the "Use Last Ease" option is on',
    here: 'not performed — `lastEasing` is session state, not project data, and a patch must produce the same result on a snapshot as on the live scene',
  },
  {
    id: 'space_conversion',
    state_js: 'the unparent toggle converts every key value into the new space, using forward kinematics',
    here: 'set_track_space changes the space flag only. The plan warns that the poses will read differently. Converting values is a semantic operation and belongs with the motion compiler (Part 24)',
  },
  {
    id: 'group_cleanup_on_delete',
    state_js: 'deleteKeys() does NOT remove the deleted key from its group, leaving a group entry pointing at a key that no longer exists',
    here: 'matched exactly, quirk included. Diverging would make this layer and the editor produce different project data from the same edit, which is a worse problem than the quirk. The plan warns when a delete leaves a dangling group entry',
  },
]);

// ---------------------------------------------------------------- building a patch

/**
 * Normalise and identify a patch. A patch id is the content hash of its operations, so the same
 * operations always produce the same id — which is what lets `commitPatch` refuse a plan that
 * was computed for different work.
 */
export function makePatch({ ops, intent = null, request = null, strict = false, author = null }) {
  if (!Array.isArray(ops) || !ops.length) throw new TypeError('makePatch: a patch needs at least one operation');
  const normalised = ops.map((raw, i) => normaliseOp(raw, i));
  const p = { ops: normalised, intent, request, strict: !!strict, author };
  p.id = `patch:${shortHash(contentHash(normalised))}`;
  return p;
}

function normaliseOp(raw, i) {
  if (!raw || typeof raw !== 'object') throw new TypeError(`op ${i}: not an object`);
  const kind = raw.op;
  if (!OP_KINDS.includes(kind)) {
    throw new TypeError(`op ${i}: unknown operation "${kind}" (expected one of ${OP_KINDS.join(', ')})`);
  }
  const o = { op: kind };
  // Copy only the fields each op kind understands, so a typo ("frame" for "t") fails loudly at
  // build time instead of being ignored at apply time.
  const allowed = OP_FIELDS[kind];
  for (const f of allowed) if (raw[f] !== undefined) o[f] = raw[f];
  const unknown = Object.keys(raw).filter((k) => k !== 'op' && !allowed.includes(k));
  if (unknown.length) throw new TypeError(`op ${i} (${kind}): unknown field(s) ${unknown.join(', ')} — this op understands ${allowed.join(', ')}`);
  for (const f of OP_REQUIRED[kind]) {
    if (o[f] === undefined) throw new TypeError(`op ${i} (${kind}): "${f}" is required`);
  }
  return o;
}

const OP_FIELDS = Object.freeze({
  set_key: ['itemId', 'track', 't', 'value', 'es', 'ed', 'bez', 'ep'],
  restore_key: ['itemId', 'track', 't', 'key'],
  delete_key: ['itemId', 'track', 't'],
  move_key: ['itemId', 'track', 't', 'to', 'retargetGroups'],
  set_easing: ['itemId', 'track', 't', 'es', 'ed', 'bez', 'ep'],
  set_track_space: ['itemId', 'track', 'space'],
  remove_track: ['itemId', 'track'],
  set_item_field: ['itemId', 'path', 'value'],
  set_project_field: ['path', 'value'],
  set_marker: ['itemId', 't', 'patch'],
  restore_marker: ['itemId', 't', 'marker'],
  delete_marker: ['itemId', 't'],
  restore_group_entry: ['groupId', 'itemId', 'track', 't', 'to'],
  add_item: ['item', 'tracks', 'markers'],
  remove_item: ['itemId'],
});
const OP_REQUIRED = Object.freeze({
  set_key: ['itemId', 'track', 't'],
  restore_key: ['itemId', 'track', 't', 'key'],
  delete_key: ['itemId', 'track', 't'],
  move_key: ['itemId', 'track', 't', 'to'],
  set_easing: ['itemId', 'track', 't'],
  set_track_space: ['itemId', 'track', 'space'],
  remove_track: ['itemId', 'track'],
  set_item_field: ['itemId', 'path', 'value'],
  set_project_field: ['path', 'value'],
  set_marker: ['itemId', 't'],
  restore_marker: ['itemId', 't', 'marker'],
  delete_marker: ['itemId', 't'],
  restore_group_entry: ['groupId', 'itemId', 'track', 't', 'to'],
  add_item: ['item'],
  remove_item: ['itemId'],
});

// ---------------------------------------------------------------- planning and committing

/**
 * Dry run (Part 55, TXN-002). Runs the whole patch against a clone and reports what it WOULD do.
 * The caller's project is not touched — `planPatch` on a frozen snapshot is a legal call.
 *
 * Returns:
 *   applicable      every operation succeeded; false means nothing should be committed
 *   ops[]           per-operation effect, before/after, warnings and problems
 *   inverse         the patch that undoes this one, computed from the state actually found
 *   diff            the structural difference the patch produces (ai/snapshot.js diffProjects)
 *   result_hash     content hash of the resulting project, excluding provenance
 *   result          the resulting project — a real object a caller may render or measure
 */
export function planPatch(project, patch) {
  const work = cloneProject(project);
  const run = runOps(work, patch);
  const diff = diffProjects(project, work);
  return {
    patch_id: patch.id,
    applicable: run.applicable,
    ops: run.records,
    inverse: run.applicable ? makeInverse(patch, run) : null,
    problems: run.problems,
    warnings: run.warnings,
    diff,
    changed_entities: run.entities,
    changed_properties: run.properties,
    changed_frame_range: run.frames,
    result_hash: contentHash(withoutHistory(work)),
    result: work,
    ui_affordances_not_applied: run.affordances,
    summary: run.applicable
      ? `${run.records.filter((r) => r.effect !== 'no_op').length} of ${patch.ops.length} operation(s) would change something — ${diff.summary}`
      : `refused: ${run.problems.length} problem(s) — ${run.problems.map((p) => p.statement).join('; ')}`,
  };
}

/**
 * Apply a planned patch to a real project, in place.
 *
 * `plan` is required, and must be the plan for THIS patch — committing without a dry run is the
 * behaviour Part 55 exists to prevent, and passing a stale plan would apply operations whose
 * conflicts were never checked. The post-condition (`result_hash`) is verified rather than
 * assumed: if the live apply does not land exactly where the plan said it would, the pre-commit
 * state is restored and the call throws. That is the only place in this layer that both mutates
 * and can fail, so it is the only place that needs a guard copy.
 */
export function commitPatch(project, patch, plan) {
  if (!plan) throw new TypeError('commitPatch: a plan from planPatch() is required — a patch must be dry-run before it is applied');
  if (plan.patch_id !== patch.id) throw new TypeError(`commitPatch: this plan was computed for ${plan.patch_id}, not ${patch.id}`);
  if (!plan.applicable) throw new Error(`commitPatch: the plan was refused and must not be applied — ${plan.summary}`);

  const guard = cloneProject(project);
  const run = runOps(project, patch, { inPlace: true });
  const hash = contentHash(withoutHistory(project));
  if (!run.applicable || hash !== plan.result_hash) {
    restoreInto(project, guard);
    throw new Error(run.applicable
      ? `commitPatch: applying ${patch.id} did not reproduce the planned result (${shortHash(hash)} vs ${shortHash(plan.result_hash)}); the project was left exactly as it was`
      : `commitPatch: ${patch.id} failed during apply and the project was restored — ${run.problems.map((p) => p.statement).join('; ')}`);
  }
  return {
    patch_id: patch.id,
    applied: true,
    ops: run.records,
    inverse: makeInverse(patch, run),
    changed_entities: run.entities,
    changed_properties: run.properties,
    changed_frame_range: run.frames,
    result_hash: hash,
    warnings: run.warnings,
  };
}

/** Replace a project's contents in place. Used only as `commitPatch`'s last-resort rollback:
 *  callers hold references to `state.project` itself, so it must stay the same object. */
function restoreInto(project, from) {
  for (const k of Object.keys(project)) delete project[k];
  Object.assign(project, from);
}

/**
 * The inverse of a patch: every operation's own inverse, in reverse order.
 *
 * Reverse order matters. A patch that deletes the key at 8 and then moves the key at 16 to 8 must
 * be undone by moving 8 back to 16 first — undoing in forward order would put the restored key at
 * 8 and then have the move overwrite it.
 */
function makeInverse(patch, run) {
  const ops = [];
  for (let i = run.records.length - 1; i >= 0; i--) {
    for (const inv of run.records[i].inverse || []) ops.push(inv);
  }
  if (!ops.length) return null;
  return makePatch({
    ops,
    intent: `inverse of ${patch.id}${patch.intent ? ` (${patch.intent})` : ''}`,
    strict: true, // undoing is not a place to tolerate a surprise
    author: 'rollback',
  });
}

// ---------------------------------------------------------------- the engine

function runOps(project, patch, { inPlace = false } = {}) {
  const records = [];
  const problems = [];
  const warnings = [];
  const entities = new Set();
  const properties = new Set();
  const affordances = new Set();
  let minF = Infinity, maxF = -Infinity;

  for (let i = 0; i < patch.ops.length; i++) {
    const op = patch.ops[i];
    const rec = { index: i, op, effect: 'no_op', before: null, after: null, inverse: [], problems: [], warnings: [] };
    try {
      OPS[op.op](project, op, rec);
    } catch (e) {
      rec.problems.push(finding({
        id: 'PATCH-OP-FAILED',
        certainty: CERTAINTY.CERTAIN,
        statement: `operation ${i} (${op.op}) failed: ${e.message}`,
        evidence: [evidence('data', 'the operation threw while being applied', { op })],
      }));
    }
    // In strict mode a STATE-MISMATCH warning is a refusal. That is what a rollback patch uses:
    // undoing is not a place to accept "the key you meant to restore was not where the plan said
    // it was". Consequence warnings are left as warnings — see STATE_MISMATCH_WARNINGS.
    if (patch.strict) {
      for (const w of rec.warnings) {
        if (!STATE_MISMATCH_WARNINGS.has(w.id)) continue;
        rec.problems.push(finding({
          id: 'PATCH-STRICT',
          certainty: w.certainty,
          statement: `strict mode: ${w.statement}`,
          evidence: w.evidence,
        }));
      }
    }
    records.push(rec);
    problems.push(...rec.problems);
    warnings.push(...rec.warnings);
    for (const a of rec.affordances || []) affordances.add(a);
    // Only what genuinely changed. An op that resolved to `no_op` still names its target — that
    // is useful in the per-op report — but listing it as a changed entity would make a preview
    // look like it did more than it did, which is exactly the false promise Part 15 forbids.
    if (rec.effect !== 'no_op') {
      if (rec.entity) entities.add(rec.entity);
      if (rec.property) properties.add(rec.property);
      for (const f of rec.frames || []) { if (f < minF) minF = f; if (f > maxF) maxF = f; }
    }
    if (rec.problems.length) break; // stop at the first failure; the clone is discarded anyway
  }

  return {
    applicable: !problems.length,
    records,
    problems,
    warnings,
    entities: [...entities],
    properties: [...properties],
    frames: Number.isFinite(minF) ? { start: minF, end: maxF } : null,
    affordances: [...affordances].map((id) => UI_AFFORDANCES.find((a) => a.id === id)),
    inPlace,
  };
}

// ---------------------------------------------------------------- op implementations
//
// Each takes (project, op, rec) and either fills `rec` in or throws. Every one that changes
// something must set `rec.inverse` to the operation list that undoes it, and `rec.frames` to the
// frames it touched, because the transaction layer builds scoped rollback out of exactly those.

function needItem(project, itemId) {
  const item = (project.items || []).find((i) => i.id === itemId);
  if (!item) throw new Error(`no item with id "${itemId}"`);
  return item;
}

function trackOf(project, itemId, track, create = false) {
  project.tracks = project.tracks || {};
  if (!project.tracks[itemId]) {
    if (!create) return { track: null, createdTable: false };
    project.tracks[itemId] = {};
  }
  if (!project.tracks[itemId][track]) {
    if (!create) return { track: null, createdTable: false };
    project.tracks[itemId][track] = { keys: [] };
    return { track: project.tracks[itemId][track], createdTable: true };
  }
  return { track: project.tracks[itemId][track], createdTable: false };
}

function keyAt(tr, t) {
  return tr ? (tr.keys || []).find((k) => near(k.t, t)) || null : null;
}

/** A verbatim copy of a key, for a `restore_key` inverse. Not a normalised one: the point is to
 *  put back exactly what was there, including fields that were absent. */
function copyKey(k) {
  return cloneProject(k);
}

function groupsHolding(project, itemId, track, t) {
  return (project.groups || []).filter((g) => (g.keys || []).some((k) => k.itemId === itemId && k.track === track && near(k.t, t)));
}

const OPS = {
  set_key(project, op, rec) {
    needItem(project, op.itemId);
    rec.entity = ids.keyId(op.itemId, op.track, op.t);
    rec.property = ids.trackId(op.itemId, op.track);
    rec.frames = [op.t];

    const pre = trackOf(project, op.itemId, op.track, false).track;
    const existing = keyAt(pre, op.t);

    if (existing) {
      rec.before = copyKey(existing);
      // Exactly `state.js` setKey's conditional writes, so the same call produces the same key.
      if (op.value !== undefined) existing.v = op.value;
      if (op.es) existing.es = op.es;
      if (op.ed) existing.ed = op.ed;
      if (op.bez !== undefined) existing.bez = op.bez;
      if (op.ep !== undefined) existing.ep = op.ep;
      rec.after = copyKey(existing);
      rec.effect = contentHash(rec.before) === contentHash(rec.after) ? 'no_op' : 'modified';
      if (rec.effect === 'modified') {
        rec.inverse = [{ op: 'restore_key', itemId: op.itemId, track: op.track, t: op.t, key: rec.before }];
      }
      return;
    }

    if (op.value === undefined) {
      rec.problems.push(finding({
        id: 'PATCH-NO-VALUE',
        certainty: CERTAINTY.CERTAIN,
        statement: `set_key at frame ${op.t} on "${op.track}" would create a new key, but no value was given`,
        evidence: [evidence('absence', 'there is no key at that time to modify, and a key cannot be created without a value')],
        suggestion: { text: 'pass `value`, or use set_easing if the intent was to change timing only', reversible: true },
      }));
      return;
    }

    const { track: tr, createdTable } = trackOf(project, op.itemId, op.track, true);
    tr.keys.push({
      t: op.t,
      v: op.value,
      es: op.es || 'Cubic',
      ed: op.ed || 'Out',
      bez: op.bez ?? null,
      ep: op.ep ?? null,
    });
    tr.keys.sort((a, b) => a.t - b.t);
    rec.after = copyKey(keyAt(tr, op.t));
    rec.effect = 'created';
    rec.inverse = createdTable
      ? [{ op: 'remove_track', itemId: op.itemId, track: op.track }]
      : [{ op: 'delete_key', itemId: op.itemId, track: op.track, t: op.t }];

    // The affordance the editor would have applied and this layer does not.
    if (op.t >= 1 && !tr.keys.some((k) => near(k.t, 0))) {
      rec.affordances = ['auto_zero_key'];
      rec.warnings.push(finding({
        id: 'PATCH-NO-FRAME-ZERO-KEY',
        certainty: CERTAINTY.CERTAIN,
        statement: `"${op.track}" now has its first key at frame ${tr.keys[0].t} and none at frame 0, so playback holds that pose from frame 0 onwards`,
        evidence: [
          evidence('data', 'the track has no key at frame 0', { firstKey: tr.keys[0].t }),
          evidence('convention', 'the editor\'s own setKey writes a rest-pose key at frame 0 in this situation; a patch does not, because the rest value depends on item kind and property registry'),
        ],
        frame: 0,
        suggestion: { text: `add a set_key at frame 0 on "${op.track}" with the pose the motion should start from`, reversible: true },
      }));
    }
  },

  restore_key(project, op, rec) {
    needItem(project, op.itemId);
    rec.entity = ids.keyId(op.itemId, op.track, op.t);
    rec.property = ids.trackId(op.itemId, op.track);
    rec.frames = [op.t];

    const { track: tr, createdTable } = trackOf(project, op.itemId, op.track, true);
    const existing = keyAt(tr, op.t);
    const want = copyKey(op.key);
    if (!near(want.t ?? op.t, op.t)) throw new Error(`restore_key: the key object is stamped t=${want.t} but the op targets ${op.t}`);
    want.t = op.t;

    if (existing) {
      rec.before = copyKey(existing);
      // Replace the key's contents rather than the key object: nothing else holds a reference to
      // it, but replacing contents keeps the array order and avoids a re-sort.
      for (const k of Object.keys(existing)) delete existing[k];
      Object.assign(existing, want);
      rec.after = copyKey(existing);
      rec.effect = contentHash(rec.before) === contentHash(rec.after) ? 'no_op' : 'modified';
      if (rec.effect === 'modified') {
        rec.inverse = [{ op: 'restore_key', itemId: op.itemId, track: op.track, t: op.t, key: rec.before }];
      }
      return;
    }

    tr.keys.push(want);
    tr.keys.sort((a, b) => a.t - b.t);
    rec.after = copyKey(want);
    rec.effect = 'created';
    rec.inverse = createdTable
      ? [{ op: 'remove_track', itemId: op.itemId, track: op.track }]
      : [{ op: 'delete_key', itemId: op.itemId, track: op.track, t: op.t }];
  },

  delete_key(project, op, rec) {
    needItem(project, op.itemId);
    rec.entity = ids.keyId(op.itemId, op.track, op.t);
    rec.property = ids.trackId(op.itemId, op.track);
    rec.frames = [op.t];

    const tr = trackOf(project, op.itemId, op.track, false).track;
    const existing = keyAt(tr, op.t);
    if (!existing) {
      rec.warnings.push(finding({
        id: 'PATCH-KEY-ABSENT',
        certainty: CERTAINTY.CERTAIN,
        statement: `delete_key found no key at frame ${op.t} on "${op.track}" — nothing to delete`,
        evidence: [evidence('absence', 'the track has no key at that time', { keys: (tr?.keys || []).map((k) => k.t) })],
        frame: op.t,
      }));
      return;
    }
    rec.before = copyKey(existing);
    tr.keys = tr.keys.filter((k) => !near(k.t, op.t));
    rec.effect = 'deleted';
    rec.inverse = [{ op: 'restore_key', itemId: op.itemId, track: op.track, t: op.t, key: rec.before }];

    // state.js leaves the group entry behind; so does this, deliberately (see UI_AFFORDANCES).
    const held = groupsHolding(project, op.itemId, op.track, op.t);
    if (held.length) {
      rec.affordances = ['group_cleanup_on_delete'];
      rec.warnings.push(finding({
        id: 'PATCH-DANGLING-GROUP-ENTRY',
        certainty: CERTAINTY.CERTAIN,
        statement: `the deleted key at frame ${op.t} is still listed in ${held.length} key group(s), which now point at a key that does not exist`,
        evidence: [evidence('data', 'group membership survives a key delete in Cadence', { groups: held.map((g) => g.id) })],
        frame: op.t,
        suggestion: { text: 'ungroup those keys first if the group is meant to stay meaningful', reversible: true },
      }));
    }
  },

  move_key(project, op, rec) {
    needItem(project, op.itemId);
    rec.property = ids.trackId(op.itemId, op.track);

    const tr = trackOf(project, op.itemId, op.track, false).track;
    const existing = keyAt(tr, op.t);
    if (!existing) throw new Error(`move_key: no key at frame ${op.t} on "${op.track}"`);

    // state.js clamps a moved key into [0, project.length]. Reproduced, and reported when it bites
    // — a caller asking for frame 200 on a 90-frame timeline should know it landed on 90.
    const clamped = Math.max(0, Math.min(project.length ?? Infinity, op.to));
    rec.frames = [Math.min(op.t, clamped), Math.max(op.t, clamped)];
    rec.entity = ids.keyId(op.itemId, op.track, clamped);
    if (clamped !== op.to) {
      rec.warnings.push(finding({
        id: 'PATCH-MOVE-CLAMPED',
        certainty: CERTAINTY.CERTAIN,
        statement: `move_key asked for frame ${op.to}, which is outside the timeline, so the key landed on frame ${clamped}`,
        evidence: [evidence('data', 'keys are clamped to the timeline', { length: project.length ?? null })],
        frame: clamped,
      }));
    }
    if (near(clamped, op.t)) { rec.effect = 'no_op'; return; }

    // A key already sitting at the destination is replaced, as in state.js — so the inverse has to
    // put it back as well as moving this one home.
    const displaced = keyAt(tr, clamped);
    rec.before = { moved: copyKey(existing), displaced: displaced ? copyKey(displaced) : null };

    tr.keys = tr.keys.filter((k) => k !== existing && !near(k.t, clamped));
    existing.t = clamped;
    tr.keys.push(existing);
    tr.keys.sort((a, b) => a.t - b.t);

    // Group entries store the key's time, so a move that does not retarget them silently breaks
    // the group. state.js retargets; so does this, by default.
    //
    // The retarget is state-dependent — whether a group entry exists at the source frame is a
    // fact about the project, not about the operation — so the inverse cannot simply be "move
    // back and let it retarget again". It moves back with retargeting OFF and restores exactly
    // the entries this call changed. Without that, moving a grouped key and undoing it leaves the
    // group pointing somewhere it never pointed.
    const retarget = op.retargetGroups !== false;
    const retargeted = [];
    if (retarget) {
      for (const g of groupsHolding(project, op.itemId, op.track, op.t)) {
        for (const k of g.keys) {
          if (k.itemId === op.itemId && k.track === op.track && near(k.t, op.t)) {
            k.t = clamped;
            retargeted.push({ groupId: g.id, from: op.t, to: clamped });
          }
        }
      }
    }

    rec.after = copyKey(existing);
    rec.effect = 'moved';
    rec.before.groups = retargeted;
    rec.inverse = [{ op: 'move_key', itemId: op.itemId, track: op.track, t: clamped, to: op.t, retargetGroups: false }];
    for (const r of retargeted) {
      rec.inverse.push({ op: 'restore_group_entry', groupId: r.groupId, itemId: op.itemId, track: op.track, t: r.to, to: r.from });
    }
    if (displaced) rec.inverse.push({ op: 'restore_key', itemId: op.itemId, track: op.track, t: clamped, key: rec.before.displaced });

    const siblings = [];
    for (const g of groupsHolding(project, op.itemId, op.track, clamped)) {
      for (const k of g.keys) {
        if (!(k.itemId === op.itemId && k.track === op.track && near(k.t, clamped))) siblings.push(k);
      }
    }
    if (siblings.length) {
      rec.affordances = ['group_expansion'];
      rec.warnings.push(finding({
        id: 'PATCH-GROUP-NOT-EXPANDED',
        certainty: CERTAINTY.CERTAIN,
        statement: `the moved key belongs to a group with ${siblings.length} other key(s), which did NOT move — dragging it in the editor would have moved them all`,
        evidence: [evidence('data', 'group siblings that stayed put', { siblings })],
        frame: clamped,
        suggestion: { text: 'add a move_key for each sibling if the group should stay aligned', reversible: true },
      }));
    }
  },

  set_easing(project, op, rec) {
    needItem(project, op.itemId);
    rec.entity = ids.keyId(op.itemId, op.track, op.t);
    rec.property = ids.trackId(op.itemId, op.track);
    rec.frames = [op.t];

    const tr = trackOf(project, op.itemId, op.track, false).track;
    const k = keyAt(tr, op.t);
    if (!k) throw new Error(`set_easing: no key at frame ${op.t} on "${op.track}"`);
    rec.before = copyKey(k);

    // state.js setEasing, including its parameter pruning: a Back key that becomes a Quad key must
    // not keep a stale Overshoot that would reappear if it were made Back again.
    if (op.es !== undefined && op.es !== null) k.es = op.es;
    if (op.ed !== undefined && op.ed !== null) k.ed = op.ed;
    if (op.bez !== undefined) k.bez = op.bez;
    if (op.ep !== undefined) k.ep = op.ep ? { ...op.ep } : null;
    if (op.es) {
      const allowed = paramsFor(op.es);
      if (!allowed.length) k.ep = null;
      else if (k.ep) {
        const next = {};
        for (const p of allowed) if (k.ep[p] != null) next[p] = k.ep[p];
        k.ep = Object.keys(next).length ? next : null;
      }
    }
    rec.after = copyKey(k);
    rec.effect = contentHash(rec.before) === contentHash(rec.after) ? 'no_op' : 'modified';
    if (rec.effect === 'modified') {
      rec.inverse = [{ op: 'restore_key', itemId: op.itemId, track: op.track, t: op.t, key: rec.before }];
    }
  },

  set_track_space(project, op, rec) {
    needItem(project, op.itemId);
    if (op.space !== 'local' && op.space !== 'world') throw new Error(`set_track_space: space must be 'local' or 'world' (got ${JSON.stringify(op.space)})`);
    rec.entity = ids.trackId(op.itemId, op.track);
    rec.property = rec.entity;

    const { track: tr, createdTable } = trackOf(project, op.itemId, op.track, true);
    const from = tr.space === 'world' ? 'world' : 'local';
    rec.before = { space: from };
    if (from === op.space) {
      rec.effect = 'no_op';
      if (createdTable) delete project.tracks[op.itemId][op.track]; // do not leave an empty track behind
      return;
    }
    if (op.space === 'world') tr.space = 'world'; else delete tr.space;
    rec.after = { space: op.space };
    rec.effect = 'modified';
    rec.frames = (tr.keys || []).map((k) => k.t);
    // If the track did not exist a moment ago, putting the space back would leave an empty track
    // where there was none — a different project. Remove it instead.
    rec.inverse = [createdTable
      ? { op: 'remove_track', itemId: op.itemId, track: op.track }
      : { op: 'set_track_space', itemId: op.itemId, track: op.track, space: from }];
    rec.affordances = ['space_conversion'];
    rec.warnings.push(finding({
      id: 'PATCH-SPACE-NOT-CONVERTED',
      certainty: CERTAINTY.CERTAIN,
      statement: `"${op.track}" moved from ${from} to ${op.space} space, but its ${(tr.keys || []).length} key value(s) were NOT converted, so the poses will read differently`,
      evidence: [evidence('convention', 'the editor\'s unparent toggle converts every key value through forward kinematics; a patch changes the flag only')],
      suggestion: { text: 'convert the values, or re-key the track in the new space', reversible: true },
    }));
  },

  remove_track(project, op, rec) {
    needItem(project, op.itemId);
    rec.entity = ids.trackId(op.itemId, op.track);
    rec.property = rec.entity;

    const tr = trackOf(project, op.itemId, op.track, false).track;
    if (!tr) {
      rec.warnings.push(finding({
        id: 'PATCH-TRACK-ABSENT',
        certainty: CERTAINTY.CERTAIN,
        statement: `remove_track found no track "${op.track}" on that item — nothing to remove`,
        evidence: [evidence('absence', 'the track table has no such entry')],
      }));
      return;
    }
    rec.before = cloneProject(tr);
    rec.frames = (tr.keys || []).map((k) => k.t);
    delete project.tracks[op.itemId][op.track];
    rec.effect = 'deleted';
    // Restoring a whole track is the one place the inverse is not itself a normal edit, so it
    // rebuilds the track from its keys: space first, then every key verbatim.
    const inv = [];
    for (const k of rec.before.keys || []) inv.push({ op: 'restore_key', itemId: op.itemId, track: op.track, t: k.t, key: k });
    if (rec.before.space === 'world') inv.push({ op: 'set_track_space', itemId: op.itemId, track: op.track, space: 'world' });
    if (!inv.length) {
      // An empty track carries no information a restore could rebuild from, and re-creating an
      // empty track entry is not an edit any tool can express. Say so rather than claim a rollback.
      rec.warnings.push(finding({
        id: 'PATCH-EMPTY-TRACK-NOT-RESTORABLE',
        certainty: CERTAINTY.CERTAIN,
        statement: `"${op.track}" held no keys, so removing it cannot be undone by an inverse operation (there is nothing to rebuild it from)`,
        evidence: [evidence('absence', 'the removed track had zero keys')],
        suggestion: { text: 'whole-project undo still reverses this; scoped rollback does not', reversible: false },
      }));
    }
    rec.inverse = inv;
  },

  set_item_field(project, op, rec) {
    const item = needItem(project, op.itemId);
    if (ITEM_FIELDS_REFUSED[op.path]) throw new Error(`set_item_field: "${op.path}" is not patchable — ${ITEM_FIELDS_REFUSED[op.path]}`);
    if (!ITEM_FIELDS[op.path]) {
      throw new Error(`set_item_field: "${op.path}" is not a patchable item field (patchable: ${Object.keys(ITEM_FIELDS).join(', ')})`);
    }
    rec.entity = ids.itemId(item);
    rec.property = `${rec.entity}#${op.path}`;

    // "Present" means present with a value. A key holding `undefined` does not survive a save/load
    // round trip and hashes the same as an absent one (see hash.js), so treating it as present
    // would make the inverse try to write `undefined` and fail `makePatch`'s required-field check.
    const had = item[op.path] !== undefined;
    rec.before = had ? cloneProject(item[op.path]) : undefined;
    if (had && contentHash(rec.before) === contentHash(op.value ?? null)) { rec.effect = 'no_op'; return; }
    item[op.path] = cloneProject(op.value);
    rec.after = cloneProject(op.value);
    rec.effect = had ? 'modified' : 'created';
    // An absent field is restored by removing it again, not by writing `undefined` — the two hash
    // differently, and a project that grows an `origin: undefined` key is not the project we had.
    rec.inverse = [had
      ? { op: 'set_item_field', itemId: op.itemId, path: op.path, value: rec.before }
      : { op: 'set_item_field', itemId: op.itemId, path: op.path, value: ABSENT }];

    if (op.path === 'origin' && (project.tracks?.[op.itemId]?.['@origin']?.keys || []).length) {
      rec.warnings.push(finding({
        id: 'PATCH-ORIGIN-OVERRIDDEN',
        certainty: CERTAINTY.CERTAIN,
        statement: 'this item has an @origin track, which overrides item.origin wherever it has keys — changing the field will not move the item',
        evidence: [evidence('data', 'the @origin track has keys', { keys: project.tracks[op.itemId]['@origin'].keys.length })],
        suggestion: { text: 'set_key on the @origin track instead', reversible: true },
      }));
    }
  },

  set_project_field(project, op, rec) {
    if (PROJECT_FIELDS_REFUSED[op.path]) throw new Error(`set_project_field: "${op.path}" is not patchable — ${PROJECT_FIELDS_REFUSED[op.path]}`);
    if (!PROJECT_FIELDS[op.path]) {
      throw new Error(`set_project_field: "${op.path}" is not a patchable project field (patchable: ${Object.keys(PROJECT_FIELDS).join(', ')})`);
    }
    rec.entity = ids.projectId(project);
    rec.property = `${rec.entity}#${op.path}`;

    const had = project[op.path] !== undefined;
    rec.before = had ? cloneProject(project[op.path]) : undefined;
    if (had && contentHash(rec.before) === contentHash(op.value ?? null)) { rec.effect = 'no_op'; return; }
    project[op.path] = cloneProject(op.value);
    rec.after = cloneProject(op.value);
    rec.effect = had ? 'modified' : 'created';
    rec.inverse = [had
      ? { op: 'set_project_field', path: op.path, value: rec.before }
      : { op: 'set_project_field', path: op.path, value: ABSENT }];

    if (op.path === 'fps') {
      rec.warnings.push(finding({
        id: 'PATCH-FPS-RETIMES',
        certainty: CERTAINTY.CERTAIN,
        statement: `frame rate ${rec.before} → ${op.value}: keys are stored in FRAMES, so every key keeps its frame number and the animation's real duration changes`,
        evidence: [evidence('data', 'the canonical time unit is the frame (see ai/timelinegraph.js)', { from: rec.before, to: op.value })],
        suggestion: { text: 'to keep the duration, scale every key time by the fps ratio as well', reversible: true },
      }));
    }
    if (op.path === 'length' && Number(op.value) < Number(rec.before ?? 0)) {
      const beyond = keysBeyond(project, Number(op.value));
      if (beyond.length) {
        rec.warnings.push(finding({
          id: 'PATCH-LENGTH-ORPHANS-KEYS',
          certainty: CERTAINTY.CERTAIN,
          statement: `shortening the timeline to ${op.value} leaves ${beyond.length} key(s) past the end — they are kept, but never played`,
          evidence: [evidence('data', 'keys beyond the new length', { sample: beyond.slice(0, 8) })],
        }));
      }
    }
  },

  set_marker(project, op, rec) {
    needItem(project, op.itemId);
    const t = Math.max(0, Math.round(op.t));
    rec.entity = ids.markerId(op.itemId, t);
    rec.property = rec.entity;
    rec.frames = [t];

    project.markers = project.markers || {};
    const created = !project.markers[op.itemId];
    const list = project.markers[op.itemId] = project.markers[op.itemId] || [];
    const existing = list.find((m) => near(m.t, t)) || null;
    const p = op.patch || {};

    if (existing) {
      rec.before = cloneProject(existing);
      if (p.name !== undefined) existing.name = p.name;
      if (p.codeBegin !== undefined) existing.codeBegin = p.codeBegin;
      if (p.codeEnd !== undefined) existing.codeEnd = p.codeEnd;
      if (p.kf !== undefined) existing.kf = p.kf ? { ...p.kf } : {};
      if (p.width !== undefined) existing.width = clampWidth(project, list, existing, p.width);
      rec.after = cloneProject(existing);
      rec.effect = contentHash(rec.before) === contentHash(rec.after) ? 'no_op' : 'modified';
      // Verbatim, not a `set_marker` with the old fields: `set_marker`'s writes are conditional
      // (`if (p.kf !== undefined)`) and the fixture markers in real projects genuinely lack `kf`
      // and the code fields, so a field-by-field inverse could not put an absent field back.
      if (rec.effect === 'modified') rec.inverse = [{ op: 'restore_marker', itemId: op.itemId, t, marker: rec.before }];
      return;
    }

    const m = {
      t,
      width: Math.max(0, Math.round(p.width ?? 0)),
      name: p.name ?? '',
      codeBegin: p.codeBegin ?? '',
      codeEnd: p.codeEnd ?? '',
      kf: p.kf ? { ...p.kf } : {},
    };
    list.push(m);
    list.sort((a, b) => a.t - b.t);
    rec.after = cloneProject(m);
    rec.effect = 'created';
    rec.inverse = [{ op: 'delete_marker', itemId: op.itemId, t }];
    if (created) rec.warnings.push(finding({
      id: 'PATCH-MARKER-LANE-CREATED',
      certainty: CERTAINTY.CERTAIN,
      statement: `this is the first marker on "${op.itemId}", so an events lane was created for it`,
      evidence: [evidence('data', 'the markers table had no entry for this item')],
    }));
  },

  delete_marker(project, op, rec) {
    needItem(project, op.itemId);
    const t = Math.max(0, Math.round(op.t));
    rec.entity = ids.markerId(op.itemId, t);
    rec.property = rec.entity;
    rec.frames = [t];

    const list = project.markers?.[op.itemId];
    const existing = list ? list.find((m) => near(m.t, t)) : null;
    if (!existing) {
      rec.warnings.push(finding({
        id: 'PATCH-MARKER-ABSENT',
        certainty: CERTAINTY.CERTAIN,
        statement: `delete_marker found no marker at frame ${t} — nothing to delete`,
        evidence: [evidence('absence', 'no marker at that frame', { markers: (list || []).map((m) => m.t) })],
        frame: t,
      }));
      return;
    }
    rec.before = cloneProject(existing);
    project.markers[op.itemId] = list.filter((m) => !near(m.t, t));
    rec.effect = 'deleted';
    rec.inverse = [{ op: 'restore_marker', itemId: op.itemId, t, marker: rec.before }];
  },

  restore_marker(project, op, rec) {
    needItem(project, op.itemId);
    const t = Math.max(0, Math.round(op.t));
    rec.entity = ids.markerId(op.itemId, t);
    rec.property = rec.entity;
    rec.frames = [t];

    project.markers = project.markers || {};
    const list = project.markers[op.itemId] = project.markers[op.itemId] || [];
    const existing = list.find((m) => near(m.t, t)) || null;
    const want = cloneProject(op.marker);
    want.t = t;

    if (existing) {
      rec.before = cloneProject(existing);
      for (const k of Object.keys(existing)) delete existing[k];
      Object.assign(existing, want);
      rec.after = cloneProject(existing);
      rec.effect = contentHash(rec.before) === contentHash(rec.after) ? 'no_op' : 'modified';
      if (rec.effect === 'modified') rec.inverse = [{ op: 'restore_marker', itemId: op.itemId, t, marker: rec.before }];
      return;
    }
    list.push(want);
    list.sort((a, b) => a.t - b.t);
    rec.after = cloneProject(want);
    rec.effect = 'created';
    rec.inverse = [{ op: 'delete_marker', itemId: op.itemId, t }];
  },

  restore_group_entry(project, op, rec) {
    rec.entity = `group:${op.groupId}`;
    rec.property = ids.trackId(op.itemId, op.track);
    rec.frames = [op.t, op.to];
    const g = (project.groups || []).find((x) => x.id === op.groupId);
    const entry = g ? (g.keys || []).find((k) => k.itemId === op.itemId && k.track === op.track && near(k.t, op.t)) : null;
    if (!entry) {
      rec.warnings.push(finding({
        id: 'PATCH-GROUP-ENTRY-ABSENT',
        certainty: CERTAINTY.CERTAIN,
        statement: `group "${op.groupId}" has no entry for ${op.track} at frame ${op.t}, so its recorded time cannot be put back`,
        evidence: [evidence('absence', 'the group entry was not found', { group: op.groupId, track: op.track, t: op.t })],
        frame: op.t,
      }));
      return;
    }
    rec.before = { t: entry.t };
    entry.t = op.to;
    rec.after = { t: op.to };
    rec.effect = 'modified';
    rec.inverse = [{ op: 'restore_group_entry', groupId: op.groupId, itemId: op.itemId, track: op.track, t: op.to, to: op.t }];
  },

  /**
   * Bring a whole item into being.
   *
   * Everything else in this file edits an item that already exists. Part 37 breaks that
   * assumption: an impact effect has to be CREATED, and "reversible" is only true of a creation
   * if the creation itself is an operation with an inverse. Before this op the only way to add an
   * item was `state.addItem`, which lands outside the transaction and can only be undone by the
   * editor's own undo stack.
   *
   * The item's id is carried IN the op and never minted here. `commitPatch` re-runs the ops live
   * and compares the result against the hash the plan predicted, so an id from
   * `crypto.randomUUID()` would make every commit fail its own post-condition. A caller derives a
   * stable id instead (see `ai/vfxspec.js`, which hashes the spec) — which also makes compiling
   * the same spec twice idempotent rather than silently duplicating the effect.
   *
   * `tracks` and `markers` are optional and exist for the inverse of `remove_item`: a rollback has
   * to put back not just the item but everything that was keyed to it.
   */
  add_item(project, op, rec) {
    const item = op.item;
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('add_item: "item" must be an object');
    if (typeof item.id !== 'string' || !item.id) throw new Error('add_item: the item needs a string id — a patch never mints one, because commitPatch checks the result against the hash the plan predicted');
    if (typeof item.kind !== 'string' || !item.kind) throw new Error('add_item: the item needs a kind');
    if (ADDABLE_KINDS_REFUSED[item.kind]) throw new Error(`add_item: a "${item.kind}" item cannot be created by a patch — ${ADDABLE_KINDS_REFUSED[item.kind]}`);
    if (!ADDABLE_KINDS[item.kind]) throw new Error(`add_item: unknown item kind "${item.kind}" (a patch can create: ${Object.keys(ADDABLE_KINDS).join(', ')})`);

    rec.entity = ids.itemId(item);
    rec.property = rec.entity;

    project.items = project.items || [];
    if (project.items.some((i) => i.id === item.id)) {
      // Not a warning. Two items with one id would make every track, marker and provenance record
      // keyed by it ambiguous, and `needItem` would resolve to whichever came first.
      throw new Error(`add_item: an item with id "${item.id}" already exists — ids are the addressing every track, group, marker and provenance record uses`);
    }

    project.items.push(cloneProject(item));
    project.tracks = project.tracks || {};
    project.tracks[item.id] = cloneProject(op.tracks || {});
    if (op.markers !== undefined) {
      project.markers = project.markers || {};
      project.markers[item.id] = cloneProject(op.markers);
    }

    const trackNames = Object.keys(project.tracks[item.id]);
    rec.after = cloneProject(item);
    rec.effect = 'created';
    rec.frames = frameSpanOfTracks(project.tracks[item.id]);
    rec.inverse = [{ op: 'remove_item', itemId: item.id }];

    if (trackNames.length) {
      rec.warnings.push(finding({
        id: 'PATCH-ITEM-ARRIVED-KEYED',
        certainty: CERTAINTY.CERTAIN,
        statement: `this item arrives with ${trackNames.length} track(s) already keyed, so the keys were not checked by the keyframe operations that would normally have written them`,
        evidence: [evidence('data', 'tracks supplied with the item', { tracks: trackNames })],
        suggestion: { text: 'add the item bare and write its keys with set_key, unless this is a rollback putting back what was there', reversible: true },
      }));
    }
  },

  /**
   * Take an item back out, capturing enough to put it back.
   *
   * `state.removeItem` drops the item and its track table and leaves any group entries and
   * semantic records that referenced it pointing at nothing. Reproducing that would make this op
   * non-invertible and would quietly corrupt a key group, so instead it REFUSES when anything
   * outside the item's own tracks and markers still refers to it, and names what. Part 4.7: a
   * missing capability is stated, not hidden.
   */
  remove_item(project, op, rec) {
    const item = needItem(project, op.itemId);
    rec.entity = ids.itemId(item);
    rec.property = rec.entity;

    const groupRefs = [];
    for (const g of project.groups || []) {
      for (const k of g.keys || []) if (k.itemId === op.itemId) { groupRefs.push(g.id); break; }
    }
    if (groupRefs.length) {
      throw new Error(`remove_item: ${groupRefs.length} key group(s) still hold keys of this item (${groupRefs.join(', ')}) — removing it would leave them pointing at nothing; ungroup_keys first`);
    }
    const semanticRefs = semanticReferencesTo(project, op.itemId);
    if (semanticRefs.length) {
      throw new Error(`remove_item: the semantic layer still refers to this item (${semanticRefs.join(', ')}) — the semantic layer owns those records and a patch must not strand them`);
    }
    if ((project.items || []).some((i) => i.attachedTo?.itemId === op.itemId)) {
      throw new Error('remove_item: another item is attached to this one — its transform space would vanish; detach_item first');
    }

    const tracks = cloneProject(project.tracks?.[op.itemId] || {});
    const markers = project.markers?.[op.itemId] === undefined ? undefined : cloneProject(project.markers[op.itemId]);

    rec.before = cloneProject(item);
    rec.frames = frameSpanOfTracks(tracks);
    project.items = project.items.filter((i) => i.id !== op.itemId);
    if (project.tracks) delete project.tracks[op.itemId];
    if (project.markers) delete project.markers[op.itemId];
    rec.effect = 'deleted';

    const back = { op: 'add_item', item: rec.before, tracks };
    if (markers !== undefined) back.markers = markers;
    rec.inverse = [back];
  },
};

/** Item kinds a patch may create, and the reason each excluded one is excluded. The refusals are
 *  the same ones `ITEM_FIELDS_REFUSED` gives for writing these fields on an item that exists. */
const ADDABLE_KINDS = Object.freeze({
  vfx: 'a particle emitter item (its emitter fields are plain numbers this file can already write)',
  camera: 'a camera item',
});
const ADDABLE_KINDS_REFUSED = Object.freeze({
  rig: 'rig topology is not animation data — add_rig builds a rig from a validated definition, and a hand-supplied one could not be checked here',
  effect: 'an effect document is a whole PNX graph with its own undo and its own validators',
  prop: 'the attachment offset of a prop is derived from the live solved poses, which this layer does not have — attach_item exists for that reason',
});

/** The frame span of a track table, or `[]` for one with no keys. Reported so a created item's
 *  change range is the range its keys actually occupy rather than the whole timeline. */
function frameSpanOfTracks(tracks) {
  const ts = [];
  for (const tr of Object.values(tracks || {})) for (const k of tr?.keys || []) if (Number.isFinite(k.t)) ts.push(k.t);
  return ts.length ? [Math.min(...ts), Math.max(...ts)] : [];
}

/** Which semantic records name an item. `project.semantics` is owned by the semantic layer, so
 *  this only READS it — it is the check that stops `remove_item` stranding a role or a lock. */
function semanticReferencesTo(project, itemId) {
  const sem = project.semantics;
  if (!sem || typeof sem !== 'object') return [];
  const hits = [];
  for (const [table, val] of Object.entries(sem)) {
    if (val && typeof val === 'object' && !Array.isArray(val) && val[itemId] !== undefined) { hits.push(table); continue; }
    if (Array.isArray(val) && val.some((r) => r?.itemId === itemId || r?.target === itemId)) hits.push(table);
  }
  return hits;
}

/** The sentinel an inverse uses to mean "this field was not there before". A plain `undefined`
 *  cannot survive `makePatch`'s field copy, and writing `null` would be a different project. */
export const ABSENT = Object.freeze({ __absent: true });

// `set_item_field` / `set_project_field` recognise the sentinel and delete rather than assign.
for (const name of ['set_item_field', 'set_project_field']) {
  const inner = OPS[name];
  OPS[name] = (project, op, rec) => {
    if (op.value && typeof op.value === 'object' && op.value.__absent === true) {
      const holder = name === 'set_item_field' ? needItem(project, op.itemId) : project;
      const had = holder[op.path] !== undefined;
      rec.entity = name === 'set_item_field' ? ids.itemId(holder) : ids.projectId(project);
      rec.property = `${rec.entity}#${op.path}`;
      if (!had) { rec.effect = 'no_op'; return; }
      rec.before = cloneProject(holder[op.path]);
      delete holder[op.path];
      rec.effect = 'deleted';
      rec.inverse = [name === 'set_item_field'
        ? { op: 'set_item_field', itemId: op.itemId, path: op.path, value: rec.before }
        : { op: 'set_project_field', path: op.path, value: rec.before }];
      return;
    }
    inner(project, op, rec);
  };
}

function clampWidth(project, list, m, want) {
  const next = list.find((o) => o.t > m.t + EPS);
  const limit = next ? next.t - m.t - 1 : Math.max(0, (project.length ?? 0) - m.t);
  return Math.max(0, Math.min(Math.round(want), limit));
}

function keysBeyond(project, length) {
  const out = [];
  for (const [itemId, perItem] of Object.entries(project.tracks || {})) {
    for (const [name, tr] of Object.entries(perItem)) {
      for (const k of tr.keys || []) if (k.t > length) out.push({ itemId, track: name, t: k.t });
    }
  }
  return out;
}

// ---------------------------------------------------------------- helpers for callers

/**
 * Keep only the operations of a patch that fall inside a scope. This is what makes Part 55's
 * "rollback only an affected property" and "rollback only an affected time range" real rather
 * than aspirational — a scoped rollback is the inverse patch, filtered.
 *
 * Returns `{ ops, dropped }` so a caller can report what a scoped rollback will NOT undo. A
 * scoped rollback that silently skipped half its work would be worse than none.
 */
export function filterOps(ops, { property = null, track = null, itemId = null, timeRange = null } = {}) {
  const keep = [], dropped = [];
  for (const op of ops) {
    let ok = true;
    // `add_item` names its item as `op.item.id`; every other op uses `op.itemId`. Without this an
    // item-scoped rollback would silently drop the very op that created the item.
    if (itemId && opItemId(op) !== itemId) ok = false;
    if (ok && track && op.track !== track) ok = false;
    if (ok && property) {
      const p = op.track ? ids.trackId(op.itemId, op.track) : null;
      if (p !== property) ok = false;
    }
    if (ok && timeRange) {
      const [a, b] = timeRange;
      const times = opTimes(op);
      // An op with no time at all (a project field, an item field) is not inside any frame range,
      // so a time-scoped rollback leaves it alone rather than guessing.
      ok = times.length > 0 && times.every((t) => t >= a - EPS && t <= b + EPS);
    }
    (ok ? keep : dropped).push(op);
  }
  return { ops: keep, dropped };
}

/** The item an op addresses, wherever that op happens to keep it. */
function opItemId(op) {
  return op.op === 'add_item' ? op.item?.id : op.itemId;
}

function opTimes(op) {
  switch (op.op) {
    case 'set_key': case 'restore_key': case 'delete_key': case 'set_easing':
    case 'set_marker': case 'restore_marker': case 'delete_marker':
      return [op.t];
    case 'move_key': case 'restore_group_entry': return [op.t, op.to];
    default: return [];
  }
}

/** A one-line description of an op, for a change summary a human reads (Part 53). */
export function describeOp(op) {
  switch (op.op) {
    case 'set_key': return `key "${op.track}" @ ${op.t}${op.value !== undefined ? '' : ' (easing only)'}`;
    case 'restore_key': return `restore key "${op.track}" @ ${op.t}`;
    case 'delete_key': return `delete key "${op.track}" @ ${op.t}`;
    case 'move_key': return `move key "${op.track}" ${op.t} → ${op.to}`;
    case 'set_easing': return `easing "${op.track}" @ ${op.t} → ${[op.es, op.ed].filter(Boolean).join(' ') || 'bezier'}`;
    case 'set_track_space': return `"${op.track}" → ${op.space} space`;
    case 'remove_track': return `remove track "${op.track}"`;
    case 'set_item_field': return `item.${op.path}`;
    case 'set_project_field': return `project.${op.path}`;
    case 'set_marker': return `marker @ ${op.t}`;
    case 'restore_marker': return `restore marker @ ${op.t}`;
    case 'delete_marker': return `delete marker @ ${op.t}`;
    case 'restore_group_entry': return `group entry "${op.track}" ${op.t} → ${op.to}`;
    case 'add_item': return `add ${op.item?.kind || 'item'} "${op.item?.name || op.item?.id}"`;
    case 'remove_item': return `remove item ${op.itemId}`;
    default: return op.op;
  }
}

/** What a patch cannot express. Returned by `inspect_constraints` and by the layer's
 *  `capabilities()`, so a caller never has to infer the boundary from a failure. */
export function patchLimitations() {
  return {
    can_express: OP_KINDS.slice(),
    cannot_express: [
      { thing: 'adding or removing an item', reason: 'add_rig/add_camera/add_prop_item/remove_item exist and are undoable, but they are not transactional and have no computable inverse patch' },
      { thing: 'rig topology (parts, joints, welds)', reason: ITEM_FIELDS_REFUSED.rig },
      { thing: 'attachment', reason: ITEM_FIELDS_REFUSED.attachedTo },
      { thing: 'effect documents and PNX graphs', reason: ITEM_FIELDS_REFUSED.effect },
      { thing: 'key groups', reason: PROJECT_FIELDS_REFUSED.groups },
      { thing: 'face layers and presets', reason: 'face data is a layer list on the item, edited by its own tools' },
    ],
    item_fields: ITEM_FIELDS,
    project_fields: PROJECT_FIELDS,
    ui_affordances_not_reproduced: UI_AFFORDANCES,
  };
}

/** Content fingerprint of a project, provenance excluded — the same notion of "state" a snapshot
 *  uses, exposed so a caller can prove a preview did not change anything. */
export function stateFingerprint(project) {
  return contentFingerprint(withoutHistory(project));
}
