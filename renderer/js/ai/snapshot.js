// Immutable, content-addressed scene snapshots (directive Part 17).
//
// "Support immutable scene snapshots. A snapshot should capture the required state to reproduce a
// result… Snapshots must be cheap enough for normal edit history where possible. Use
// content-addressed or delta-based storage if necessary, but keep the conceptual model simple:
// every accepted state must be recoverable."
//
// Cadence already has two things that look like this and are not:
//
//   * `state.js`'s undo stack — whole-project `structuredClone`s, but linear, capped, cleared on
//     load, and unaddressable. You cannot ask for "the state we agreed on before the retime".
//   * autosave `.cadence` files — durable, but keyed by project, not by content, and overwritten.
//
// A snapshot here is addressable by its content hash, immutable once taken, and comparable. That
// is what a baseline (Part 44) and a transaction's before-state (Part 55) both need underneath.
//
// Honest limits, stated once:
//   * The store is IN MEMORY and dies with the window. Persisting snapshots is a file-format
//     decision that has not been made; nothing here pretends otherwise.
//   * A snapshot is a full deep clone, deduplicated by hash. Two identical snapshots cost one.
//     Two snapshots differing by one keyframe cost two. Delta storage is a later optimisation and
//     the interface does not need to change for it.
//   * Textures are shared by reference, not cloned — see `cloneProject` below for why that is
//     safe and what it costs.

import { contentFingerprint, shortHash } from './hash.js';

// Enough to notice a runaway, small enough that a session cannot eat a gigabyte of clones. When
// full, the OLDEST unpinned snapshot is dropped; pinned ones (baselines, open transactions) are
// never dropped, and a store full of pinned snapshots refuses rather than evicting something a
// caller still depends on.
const DEFAULT_CAPACITY = 64;

/**
 * A deep clone that is deliberately NOT `structuredClone`.
 *
 * A real Cadence project carries baked texture atlases as data URIs — measured at 5.1 MB each on
 * a 16-part imported rig. `structuredClone` copies those strings for every snapshot; a dozen
 * snapshots of one rig would be ~60 MB of identical text.
 *
 * Strings are immutable in JavaScript, so sharing them between a snapshot and the live project is
 * safe by construction: nothing can mutate a shared string, only replace a reference to it. So
 * every non-object value is shared and only containers are copied. What this costs is that a
 * snapshot does not protect against a caller reaching into the LIVE project and swapping a
 * texture wholesale — but that is a different edit, and it produces a different hash.
 */
export function cloneProject(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    seen.set(value, out);
    for (let i = 0; i < value.length; i++) out[i] = cloneProject(value[i], seen);
    return out;
  }
  if (ArrayBuffer.isView(value)) return value.slice();
  const out = {};
  seen.set(value, out);
  for (const k of Object.keys(value)) out[k] = cloneProject(value[k], seen);
  return out;
}

/** Deep-freeze, so "immutable" is enforced rather than promised. Cycles are handled; already
 *  frozen subtrees are skipped, which also stops it recursing into a shared frozen snapshot. */
function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value) || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const k of Object.keys(value)) deepFreeze(value[k], seen);
  return value;
}

/**
 * What a snapshot deliberately does NOT capture: the provenance graph.
 *
 * Provenance is append-only history (Part 56), and history is not part of the state a snapshot
 * describes. Including it would break two things at once:
 *
 *   * Deduplication. `snapshot_scene` records "a snapshot was taken" in provenance, so two
 *     consecutive snapshots of an otherwise untouched project would differ by that record and
 *     never dedupe — which is exactly backwards, since nothing about the animation changed.
 *   * Restore. Rolling back to a baseline would erase the record of everything that happened
 *     since, INCLUDING the record of the restore itself. Part 55 requires history to be
 *     preserved through a recovery, not consumed by it.
 *
 * Role overrides, annotations and locks are NOT excluded: those are project state that an edit
 * can change and a restore should genuinely bring back.
 *
 * Exported because it defines what this layer means by "the state" — `ai/patch.js` verifies a
 * commit landed where the plan said by comparing the hash of exactly this projection, and a
 * provenance record written between plan and commit must not be able to invalidate that check.
 */
export function withoutHistory(project) {
  if (!project || !project.semantics || !project.semantics.provenance) return project;
  const { provenance, ...restSemantics } = project.semantics;
  // If provenance was the ONLY thing in `semantics`, drop the key entirely rather than leaving an
  // empty object: a project that has never been annotated has no `semantics` at all, and `{}` and
  // `undefined` hash differently — which would make the first recorded provenance node look like
  // a state change forever after.
  if (!Object.keys(restSemantics).length) {
    const { semantics, ...rest } = project;
    return rest;
  }
  return { ...project, semantics: restSemantics };
}

export class SnapshotStore {
  constructor({ capacity = DEFAULT_CAPACITY } = {}) {
    this.capacity = capacity;
    this.byHash = new Map();   // hash -> snapshot
    this.order = [];           // hashes, oldest first
    this.evicted = 0;
  }

  /**
   * Take a snapshot of `project`.
   *
   * Identical content returns the EXISTING snapshot rather than a second copy — that is what
   * content addressing buys, and it means "snapshot before every edit" is affordable even when
   * most edits are no-ops. The returned object always reports `deduplicated` so a caller writing
   * provenance can tell a genuinely new state from a repeat.
   *
   * @param meta.reason   why it was taken — free text, kept verbatim
   * @param meta.author   'user' | 'ai' | tool name
   * @param meta.pinned   never evict this one (baselines, transaction before-states)
   * @param meta.timestamp caller-supplied ISO time. The semantic layer is pure and does not read
   *                       the clock; a snapshot with no timestamp says `null` rather than lying.
   */
  take(project, meta = {}) {
    const clone = deepFreeze(cloneProject(withoutHistory(project)));
    const fp = contentFingerprint(clone);

    const existing = this.byHash.get(fp.hash);
    if (existing && existing.canonical_length === fp.length) {
      // Content-address hit. The length check is the collision guard promised in hash.js: two
      // different states would have to agree on a 128-bit hash AND on canonical byte length.
      if (meta.pinned) existing.pinned = true;
      existing.taken += 1;
      return { ...publicView(existing), deduplicated: true };
    }

    const snap = {
      id: `snapshot:${fp.hash}`,
      hash: fp.hash,
      short: shortHash(fp.hash),
      canonical_length: fp.length,
      project: clone,
      pinned: !!meta.pinned,
      taken: 1,
      created_at: meta.timestamp ?? null,
      author: meta.author ?? null,
      reason: meta.reason ?? null,
      // Part 17's snapshot field list, as far as Cadence can answer it. Anything the app does not
      // model is null with a reason, never a placeholder.
      captures: {
        scene_entities: (project.items || []).length,
        animation_revisions: countKeys(project),
        vfx_graph_revision: project.items?.some((i) => i.kind === 'effect') ? 'embedded in the effect items' : null,
        camera_and_lighting: (project.items || []).filter((i) => i.kind === 'camera').length
          ? 'cameras captured; Cadence has no lights to capture' : 'no cameras; Cadence has no lights',
        render_configuration: null,   // no render settings exist beyond viewport size
        simulation_seed_and_cache: null, // the PNX solver's cache is not part of the animator project
        preference_version: project.semantics?.preferences?.version ?? null,
        active_baseline: meta.baseline ?? null,
      },
      not_captured: [
        'the provenance graph — it is append-only history, not state; restoring must not erase the record of what happened (see withoutHistory)',
        'session state (selection, playhead, camera orbit) — not project data',
        'render output — a snapshot records the state that produces a render, not the render',
        'PNX solver caches — those belong to the VFX studio document, not the animation project',
      ],
    };
    this.byHash.set(snap.hash, snap);
    this.order.push(snap.hash);
    this.#evictIfNeeded();
    return { ...publicView(snap), deduplicated: false };
  }

  #evictIfNeeded() {
    while (this.byHash.size > this.capacity) {
      const victim = this.order.find((h) => !this.byHash.get(h)?.pinned);
      if (!victim) return; // every snapshot is pinned — refuse to drop something depended on
      this.byHash.delete(victim);
      this.order.splice(this.order.indexOf(victim), 1);
      this.evicted++;
    }
  }

  /** The snapshot itself, including its frozen project. Null if it was never taken or was evicted. */
  get(idOrHash) {
    const hash = String(idOrHash).replace(/^snapshot:/, '');
    return this.byHash.get(hash) || null;
  }

  /** A restorable deep copy of a snapshot's project. Separate from `get` on purpose: the stored
   *  project is frozen, and handing a frozen object to `state.loadProject` would make the whole
   *  live project silently immutable. */
  restore(idOrHash) {
    const snap = this.get(idOrHash);
    if (!snap) return null;
    return cloneProject(snap.project);
  }

  list() {
    return this.order.map((h) => publicView(this.byHash.get(h))).filter(Boolean);
  }

  /** Metadata only, in the order taken. */
  stats() {
    return {
      count: this.byHash.size,
      capacity: this.capacity,
      pinned: [...this.byHash.values()].filter((s) => s.pinned).length,
      evicted: this.evicted,
      approximate_bytes: [...this.byHash.values()].reduce((n, s) => n + s.canonical_length, 0),
      note: 'approximate_bytes is the canonical-stream length, which counts a shared texture string once per snapshot even though it is stored once in total — it is an upper bound on semantic size, not on memory',
    };
  }

  pin(idOrHash, pinned = true) {
    const s = this.get(idOrHash);
    if (!s) return false;
    s.pinned = !!pinned;
    return true;
  }
}

function publicView(s) {
  if (!s) return null;
  const { project, ...rest } = s;
  return rest;
}

function countKeys(project) {
  let n = 0;
  for (const perItem of Object.values(project.tracks || {})) {
    for (const tr of Object.values(perItem)) n += (tr.keys || []).length;
  }
  return n;
}

// ---------------------------------------------------------------- comparison
//
// Part 44 wants "scene-graph difference for property-level changes" and "curve difference for
// animation changes". Both are reachable from project data alone, with no renderer — so they are
// here rather than waiting for the observation layer.

/**
 * Structural difference between two projects (or two snapshots' projects).
 * Returns changed items, tracks and keys with enough detail to explain a change, not just count it.
 *
 * Deliberately NOT a generic deep diff: it understands that a track is a sorted key list and that
 * a key is addressed by time, so a key inserted in the middle reads as one added key rather than
 * as every later key having changed.
 */
export function diffProjects(beforeRaw, afterRaw) {
  // Provenance is excluded for the same reason snapshots exclude it: an append-only log growing
  // is not a change to the animation, and reporting it would drown every real difference.
  const before = withoutHistory(beforeRaw);
  const after = withoutHistory(afterRaw);
  const bItems = new Map((before.items || []).map((i) => [i.id, i]));
  const aItems = new Map((after.items || []).map((i) => [i.id, i]));

  const itemsAdded = [...aItems.keys()].filter((id) => !bItems.has(id));
  const itemsRemoved = [...bItems.keys()].filter((id) => !aItems.has(id));
  const itemsChanged = [];
  for (const [id, a] of aItems) {
    const b = bItems.get(id);
    if (!b) continue;
    const fb = contentFingerprint(b), fa = contentFingerprint(a);
    if (fb.hash !== fa.hash) itemsChanged.push({ itemId: id, name: a.name, before: shortHash(fb.hash), after: shortHash(fa.hash), fields: changedFields(b, a) });
  }

  const trackChanges = [];
  const itemIds = new Set([...Object.keys(before.tracks || {}), ...Object.keys(after.tracks || {})]);
  for (const itemId of itemIds) {
    const bT = (before.tracks || {})[itemId] || {};
    const aT = (after.tracks || {})[itemId] || {};
    for (const name of new Set([...Object.keys(bT), ...Object.keys(aT)])) {
      const b = bT[name], a = aT[name];
      if (!b && a) { trackChanges.push({ itemId, track: name, change: 'added', keys: (a.keys || []).length }); continue; }
      if (b && !a) { trackChanges.push({ itemId, track: name, change: 'removed', keys: (b.keys || []).length }); continue; }
      const d = diffTrack(b, a);
      if (d) trackChanges.push({ itemId, track: name, change: 'modified', ...d });
    }
  }

  const changedFrames = frameRangeOf(trackChanges);
  return {
    items: { added: itemsAdded, removed: itemsRemoved, changed: itemsChanged },
    tracks: trackChanges,
    project_fields: changedFields(stripVolatile(before), stripVolatile(after)),
    changed_frame_range: changedFrames,
    identical: !itemsAdded.length && !itemsRemoved.length && !itemsChanged.length && !trackChanges.length,
    summary: summariseDiff(itemsAdded, itemsRemoved, itemsChanged, trackChanges, changedFrames),
  };
}

function diffTrack(b, a) {
  const bk = new Map((b.keys || []).map((k) => [k.t, k]));
  const ak = new Map((a.keys || []).map((k) => [k.t, k]));
  const added = [], removed = [], modified = [];
  for (const [t, k] of ak) {
    const prev = bk.get(t);
    if (!prev) { added.push(t); continue; }
    const fb = contentFingerprint(prev), fa = contentFingerprint(k);
    if (fb.hash !== fa.hash) modified.push({ t, fields: changedFields(prev, k) });
  }
  for (const t of bk.keys()) if (!ak.has(t)) removed.push(t);
  const spaceChanged = (b.space || null) !== (a.space || null);
  if (!added.length && !removed.length && !modified.length && !spaceChanged) return null;
  return {
    keys_added: added.sort((x, y) => x - y),
    keys_removed: removed.sort((x, y) => x - y),
    keys_modified: modified.sort((x, y) => x.t - y.t),
    space_changed: spaceChanged ? { from: b.space || 'parent', to: a.space || 'parent' } : null,
  };
}

function changedFields(b, a) {
  const out = [];
  for (const k of new Set([...Object.keys(b || {}), ...Object.keys(a || {})])) {
    const fb = b ? contentFingerprint(b[k]) : null;
    const fa = a ? contentFingerprint(a[k]) : null;
    if ((fb?.hash ?? null) !== (fa?.hash ?? null)) out.push(k);
  }
  return out.sort();
}

// `tracks` and `items` are diffed structurally above; comparing them again as opaque fields would
// report every keyframe edit twice and drown the real answer.
function stripVolatile(p) {
  const { items, tracks, ...rest } = p || {};
  return rest;
}

// The frame range an edit actually touched — the input to Part 44's "calculate the likely affected
// frame range" and the reason a regression pass does not have to re-render a whole shot.
function frameRangeOf(trackChanges) {
  let min = Infinity, max = -Infinity;
  for (const c of trackChanges) {
    const times = [...(c.keys_added || []), ...(c.keys_removed || []), ...(c.keys_modified || []).map((m) => m.t)];
    for (const t of times) { if (t < min) min = t; if (t > max) max = t; }
  }
  return Number.isFinite(min) ? { start: min, end: max } : null;
}

function summariseDiff(added, removed, changed, tracks, range) {
  const bits = [];
  if (added.length) bits.push(`${added.length} item(s) added`);
  if (removed.length) bits.push(`${removed.length} item(s) removed`);
  if (changed.length) bits.push(`${changed.length} item(s) changed`);
  const k = tracks.reduce((n, t) => n + ((t.keys_added?.length || 0) + (t.keys_removed?.length || 0) + (t.keys_modified?.length || 0)), 0);
  if (tracks.length) bits.push(`${tracks.length} track(s) changed (${k} keyframe change(s))`);
  if (!bits.length) return 'Identical';
  return bits.join(', ') + (range ? ` across frames ${range.start}–${range.end}` : '');
}
