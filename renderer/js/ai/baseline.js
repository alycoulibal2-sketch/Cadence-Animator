// Baselines (directive Part 44).
//
// "Every accepted shot or animation version may become a baseline. Baselines are production
// assets, not disposable screenshots."
//
// Two consequences follow from that sentence, and this module is shaped by both.
//
// FIRST: a baseline lives INSIDE the project (`project.semantics.baselines`), so it survives save,
// load and being handed to somebody else. The in-memory snapshot store does not survive an app
// restart, and a "production asset" that evaporates on restart is a screenshot with extra steps.
//
// SECOND: it therefore cannot hold pixels. A 192x192 RGBA pass is 147 KB per frame per pass; ten
// frames of two passes would add three megabytes to a .cadence file. What goes in the file is, per
// observed frame and pass, the exact digest plus a 16x16 signature — enough to prove a difference
// and to say roughly where, never enough to say "displaced by 14 pixels". Full rasters stay in the
// session's raster store, and a comparison that has them says so; one that does not degrades to
// block granularity and says THAT. The degradation is visible in the result rather than silent.
//
// Part 44's field list is reproduced in full. Four of its seventeen fields have nothing behind them
// in Cadence — there are no lights, no colour-management configuration, no render settings beyond
// a viewport size. Those are present, null, and carried in `unavailable` with the reason, because
// a baseline that quietly omitted "lighting state" would let a later comparison claim it had
// verified lighting did not change.

import { contentHash, shortHash } from './hash.js';

const DEFAULT_CAP = 16;

function store(project, { create = false } = {}) {
  if (!project.semantics) {
    if (!create) return null;
    project.semantics = {};
  }
  if (!project.semantics.baselines) {
    if (!create) return null;
    project.semantics.baselines = { version: 1, seq: 0, entries: [], cap: DEFAULT_CAP, evicted: 0 };
  }
  const b = project.semantics.baselines;
  if (typeof b.seq !== 'number') b.seq = b.entries.length + (b.evicted || 0);
  return b;
}

/**
 * The three revisions Part 44 asks a baseline to pin, computed from project data.
 *
 * They are separate on purpose: an edit that changes `animation` but not `camera` is a different
 * kind of event from one that moves the camera, and a single project-wide hash could not tell a
 * reader which happened.
 */
export function revisionsOf(project) {
  const items = project.items || [];
  const tracks = project.tracks || {};
  const cameraIds = new Set(items.filter((i) => i.kind === 'camera').map((i) => i.id));
  const effectIds = new Set(items.filter((i) => i.kind === 'effect' || i.kind === 'vfx').map((i) => i.id));

  const pick = (ids, want) => Object.fromEntries(Object.entries(tracks).filter(([id]) => ids.has(id) === want));

  return {
    animation: contentHash(pick(new Set([...cameraIds, ...effectIds]), false)),
    camera: cameraIds.size
      ? contentHash({ tracks: pick(cameraIds, true), items: items.filter((i) => cameraIds.has(i.id)) })
      : null,
    vfx: effectIds.size
      ? contentHash({ tracks: pick(effectIds, true), items: items.filter((i) => effectIds.has(i.id)) })
      : null,
  };
}

/**
 * Create a baseline and append it to the project.
 *
 * @param opts.snapshot     `{ id, hash }` of the scene snapshot this baseline pins. The snapshot
 *                          itself lives in the session store; the baseline records only its
 *                          address, and `snapshotAvailable` below is how a caller asks whether it
 *                          is still there.
 * @param opts.observations `[{ frame, pass, digest, signature, stats, camera }]` — already
 *                          measured by the caller. This module never renders.
 * @param opts.acceptance   an AcceptanceSpec (ai/cal.js) that this baseline is the accepted result of.
 * @param opts.timestamp    caller-supplied ISO string. The semantic layer does not read the clock.
 */
export function createBaseline(project, {
  name = null, snapshot = null, observations = [], frameRange = null, resolution = null,
  passes = null, acceptance = null, author = null, timestamp = null, reason = null, camera = null,
} = {}) {
  const b = store(project, { create: true });
  const rev = revisionsOf(project);
  const n = ++b.seq;

  const unavailable = [];
  const nullWith = (field, why, unblocked) => { unavailable.push({ field, reason: why, unblocked_by: unblocked }); return null; };

  const record = {
    id: null, // filled below, from the content hash of everything above it
    name: name || `baseline ${n}`,
    sequence: n,

    // --- Part 44's field list, in Part 44's order ---
    scene_snapshot: snapshot ? { id: snapshot.id, hash: snapshot.hash, short: shortHash(snapshot.hash) } : null,
    animation_revision: rev.animation,
    vfx_revision: rev.vfx,
    camera_revision: rev.camera,
    lighting_and_environment_state: nullWith(
      'lighting_and_environment_state',
      'Cadence has no light or environment entities — the viewport lighting is a fixed rig defined in viewport.js, not project data, so there is nothing to record and nothing that could differ between two baselines of the same project',
      'RND-001',
    ),
    render_settings: {
      renderer: 'three.js WebGL, rendered offscreen to a render target',
      antialias: false,
      note: 'antialiasing is off so that exact pixel comparison is exact; it costs sub-pixel precision at silhouette edges',
      resolution: resolution || null,
      passes: passes || [...new Set(observations.map((o) => o.pass))],
    },
    frame_rate: project.fps ?? null,
    resolution: resolution || null,
    frame_range: frameRange || rangeOf(observations),
    color_management: nullWith(
      'color_management',
      'no colour-management configuration exists in this build; every pass is rendered to a linear render target with tone mapping disabled, which is a fixed property of the code rather than a setting a baseline could pin',
      'RND-001',
    ),
    simulation_seeds: nullWith(
      'simulation_seeds',
      'the only seeded simulation in Cadence is the PNX solver, which belongs to the VFX studio document and is not part of the animation project (PHY-003 covers its own determinism)',
      'VFX-002',
    ),
    cache_hashes: nullWith(
      'cache_hashes',
      'the animator has no render or simulation cache to hash — every pass is rendered fresh',
      null,
    ),
    diagnostic_passes_available: [...new Set(observations.map((o) => o.pass))],
    acceptance_criteria: acceptance || null,
    approved_differences: [],
    author: author || null,
    timestamp: timestamp || null,

    // --- beyond the list, because a comparison needs them ---
    camera: camera || observations[0]?.camera || null,
    observations: observations.map((o) => ({
      frame: o.frame,
      pass: o.pass,
      digest: o.digest,
      signature: o.signature ?? null,
      stats: o.stats ?? null,
      camera: o.camera ?? null,
    })),
    reason: reason || null,
    unavailable,
  };

  record.id = `baseline:${n}:${contentHash(record).slice(0, 10)}`;
  b.entries.push(record);
  trim(b);
  return record;
}

function rangeOf(observations) {
  const fs = observations.map((o) => o.frame).filter((f) => Number.isFinite(f));
  return fs.length ? { start: Math.min(...fs), end: Math.max(...fs) } : null;
}

function trim(b) {
  const cap = b.cap || DEFAULT_CAP;
  if (b.entries.length <= cap) return;
  const drop = b.entries.length - cap;
  b.entries = b.entries.slice(drop);
  b.evicted = (b.evicted || 0) + drop;
}

export function listBaselines(project) {
  const b = store(project);
  if (!b) return { baselines: [], evicted: 0, cap: DEFAULT_CAP };
  return {
    baselines: b.entries.map((e) => ({
      id: e.id,
      name: e.name,
      frame_range: e.frame_range,
      passes: e.diagnostic_passes_available,
      observations: e.observations.length,
      animation_revision: shortHash(e.animation_revision),
      snapshot: e.scene_snapshot,
      approved_differences: e.approved_differences.length,
      author: e.author,
      timestamp: e.timestamp,
    })),
    evicted: b.evicted || 0,
    cap: b.cap || DEFAULT_CAP,
    note: b.evicted ? `${b.evicted} older baseline(s) were dropped when the cap of ${b.cap || DEFAULT_CAP} was reached` : null,
  };
}

export function getBaseline(project, id) {
  const b = store(project);
  if (!b) return null;
  if (!id) return b.entries[b.entries.length - 1] || null;
  return b.entries.find((e) => e.id === id || e.name === id) || null;
}

export function deleteBaseline(project, id) {
  const b = store(project);
  if (!b) return false;
  const i = b.entries.findIndex((e) => e.id === id);
  if (i < 0) return false;
  b.entries.splice(i, 1);
  return true;
}

/**
 * Record that a difference against this baseline is expected and accepted (Part 44's "approved
 * differences" field, and the fourth value of its difference classification).
 *
 * An approval is scoped to a target rather than blanket, and carries who approved it and why — an
 * unattributed "this is fine" is how a regression engine becomes decorative.
 */
export function approveDifference(project, baselineId, { target, kind, reason, author = null, timestamp = null } = {}) {
  const bl = getBaseline(project, baselineId);
  if (!bl) throw new Error(`No baseline "${baselineId}"`);
  if (!target) throw new TypeError('approveDifference: an approval needs a target — an entity id, a track entity id, or "<pass>@<frame>"');
  if (!reason) throw new TypeError('approveDifference: an approval needs a reason. An unexplained approval cannot be reviewed later, which defeats the point of recording it');
  const entry = {
    id: `approved:${contentHash({ target, kind, reason, n: bl.approved_differences.length }).slice(0, 8)}`,
    target,
    kind: kind || 'any',
    reason,
    author,
    timestamp,
  };
  bl.approved_differences.push(entry);
  return entry;
}

/** Is a specific difference covered by an approval on this baseline? Returns the approval, or null. */
export function findApproval(baseline, { target, kind }) {
  if (!baseline) return null;
  return (baseline.approved_differences || []).find((a) => a.target === target && (a.kind === 'any' || a.kind === kind)) || null;
}

/** Whether the snapshot a baseline pins is still held. A baseline whose snapshot is gone can still
 *  prove THAT something changed (digests and revisions are in the file) but not WHAT changed in the
 *  data — and the explanation has to say which of those two it is doing. */
export function snapshotAvailable(baseline, snapshotStore) {
  if (!baseline?.scene_snapshot) return { available: false, reason: 'this baseline pins no scene snapshot' };
  if (!snapshotStore) return { available: false, reason: 'no snapshot store was supplied' };
  const s = snapshotStore.get(baseline.scene_snapshot.id);
  if (!s) {
    return {
      available: false,
      reason: 'the snapshot this baseline pins is no longer held — the store is in memory and does not survive an app restart, and an unpinned snapshot can be evicted. The baseline\'s digests and revisions still prove whether something changed; the data-level diff of WHAT changed is not available',
    };
  }
  return { available: true, reason: null };
}

export function baselineLimitations() {
  return {
    cannot: [
      'store pixels. A baseline holds a digest and a 16x16 signature per observed frame and pass; the full rasters live in the session raster store and are gone after a restart',
      'record lighting, colour management, simulation seeds or cache hashes — 4 of Part 44\'s 17 fields have nothing behind them in Cadence, and each is null with its reason in `unavailable`',
      'restore itself. TXN-005 ("restore an approved baseline") needs the pinned snapshot to still be held; `snapshotAvailable` reports whether it is',
      'approve a difference automatically. Every approval is an explicit, attributed, reasoned entry',
    ],
    assumptions: [
      'a baseline is only comparable against a render from the same viewpoint and resolution. The camera fingerprint is recorded for exactly that check, and the comparison refuses rather than resampling',
    ],
  };
}
