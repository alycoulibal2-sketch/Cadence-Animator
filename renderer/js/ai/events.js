// The shared shot-event timeline (directive Part 41), and the shot model it hangs off (Part 40).
//
// Cadence already has event markers: `project.markers[itemId] = [{t, width, name, codeBegin,
// codeEnd, kf}]`, Moon Animator's "Events" track, editable transactionally through
// `set_marker`/`delete_marker`. What it does NOT have is the thing Part 41 actually asks for — one
// timeline the whole shot agrees on, that animation, VFX, camera and gameplay all time against.
//
// Four decisions shape this file.
//
// 1. **The shared timeline is DERIVED, never migrated.** Markers stay stored per item. Re-keying
//    them into one project-level table would be a destructive migration across `state.js`,
//    `io.js`, the timeline UI and every saved project file, for no capability this layer cannot
//    get by projecting. `ai/ids.js` made exactly this call about the track table; the reasoning is
//    recorded in `docs/animation-intelligence/00-foundation-audit.md` §5. So `buildTimeline` reads
//    every per-item table and returns one ordered view, and every write still goes through the
//    marker patch ops against the owning item.
//
// 2. **A shared timeline earns its keep by showing what the per-item view hides.** Any one item's
//    marker list is already visible in the editor. What no existing surface shows is two events on
//    different items landing on the same frame, or a Luau hook firing inside another event's span.
//    That is what `concurrentEvents` and `overlaps` are for, and it is the honest answer to "why
//    build this at all".
//
// 3. **An event id does not survive a retime, and says so.** An event is addressed as
//    `ids.markerId(itemId, t)` — a marker has no identity beyond its time, exactly like a keyframe
//    (Part 16, and `ids.idDurability`). A caller holding an event id across a `move_markers` is
//    holding a stale reference, so `resolveEvent` reports how it matched and nothing pretends the
//    id is durable.
//
// 4. **Ambiguity is a question, not a guess.** Two items may each carry an event called "impact".
//    Resolving that name to a frame by picking the earlier one would silently time an effect to
//    the wrong character, so it returns `ambiguous` with the question a human has to answer —
//    the same convention `ai/select.js` uses.
//
// Pure at load like the rest of `ai/`: plain data in, plain data out, no renderer.

import * as ids from './ids.js';
import { CERTAINTY, evidence, finding } from './certainty.js';

/** Times are compared with the epsilon `state.js` uses everywhere, so "the event at 16" means the
 *  same event to both. */
const EPS = 1e-6;
const near = (a, b) => Math.abs(a - b) < EPS;

/**
 * The Part 41 event fields, against what a Cadence marker actually holds.
 *
 * Part 4.7 requires a missing capability to be named rather than hidden. A caller that discovers
 * an event has no `priority` should learn that Cadence has nowhere to keep one, not conclude the
 * timeline is unreliable.
 */
export const EVENT_FIELDS = Object.freeze({
  id: { present: true, from: 'derived from itemId + time', durable: false },
  frame: { present: true, from: 'marker.t' },
  width: { present: true, from: 'marker.width', note: 'an event may occupy a span, not only an instant' },
  name: { present: true, from: 'marker.name' },
  owner: { present: true, from: 'the item whose marker table holds it' },
  code: { present: true, from: 'marker.codeBegin / marker.codeEnd', note: 'Luau that runs at the span edges — a gameplay hook, not only a visual cue' },
  causal_parent: { present: false, why: 'no marker field records that one event was caused by another; the shape is designed (SHOT-006) but there is nowhere to store it' },
  priority: { present: false, why: 'nothing in Cadence ranks two simultaneous events' },
  dependent_systems: { present: false, why: 'which systems react to an event is not recorded; `concurrentEvents` reports co-timing, which is evidence of a relationship but not a declaration of one' },
  duration_semantics: { present: false, why: 'a marker width is a span, but nothing says whether the event is an impulse, a sustain or a window' },
});

/** What this module deliberately does not do. */
export const EVENT_LIMITATIONS = Object.freeze([
  'Events are stored per item and this timeline is a projection of those tables — an "event" is not a first-class project entity and cannot exist without an owning item.',
  'An event id is derived from its time and does not survive a retime; re-resolve after any patch that moves markers.',
  'There is no shot entity. `describeShot` reports the shot-shaped facts a project already carries (length, fps, play range, cameras, events); it does not invent a Shot record, and SHOT-001/SHOT-003 stay unplanned until there is somewhere to keep one.',
  'Nothing here decides an event is mistimed. It reports co-timing and spans; judging timing against an effect is `ai/vfxspec.js` (Part 39), and judging it against motion is `ai/diagnose.js`.',
]);

// ---------------------------------------------------------------- the shared timeline

/**
 * Project every per-item marker table into one ordered event list.
 *
 * @param project        a project object (live, snapshot, baseline or fixture)
 * @param opts.itemIds   restrict to these items; default every item that has markers
 * @returns { events, byId, count, items, warnings, limitations }
 */
export function buildTimeline(project, { itemIds = null } = {}) {
  const tables = project?.markers || {};
  const nameIndex = new Map();
  const events = [];
  const warnings = [];

  const itemName = (id) => (project?.items || []).find((i) => i.id === id)?.name ?? null;

  for (const ownerId of Object.keys(tables)) {
    if (itemIds && !itemIds.includes(ownerId)) continue;
    const arr = tables[ownerId];
    if (!Array.isArray(arr)) continue;
    // A marker table can outlive its item: `state.removeItem` deletes the item and its tracks but
    // leaves `project.markers[itemId]` in place. Reporting those as ordinary events would put an
    // event on the timeline that nothing owns, so they are surfaced as a warning instead.
    const owned = (project?.items || []).some((i) => i.id === ownerId);
    if (!owned) {
      if (arr.length) {
        warnings.push(finding({
          id: 'EVENTS-ORPHANED-TABLE',
          certainty: CERTAINTY.CERTAIN,
          statement: `${arr.length} event(s) are stored against item "${ownerId}", which no longer exists — they are not on the timeline`,
          evidence: [evidence('data', 'a marker table with no owning item', { itemId: ownerId, events: arr.length })],
          suggestion: { text: 'these are unreachable in the editor; a project save will keep carrying them', reversible: true },
        }));
      }
      continue;
    }

    for (const m of arr) {
      if (!m || !Number.isFinite(m.t)) continue;
      const width = Number.isFinite(m.width) && m.width > 0 ? m.width : 0;
      const ev = Object.freeze({
        id: ids.markerId(ownerId, m.t),
        frame: m.t,
        width,
        span: Object.freeze([m.t, m.t + width]),
        name: typeof m.name === 'string' && m.name ? m.name : null,
        itemId: ownerId,
        itemName: itemName(ownerId),
        code: Object.freeze({ begin: m.codeBegin || null, end: m.codeEnd || null }),
        hasCode: !!(m.codeBegin || m.codeEnd),
      });
      events.push(ev);
      if (ev.name) {
        const key = ev.name.toLowerCase();
        if (!nameIndex.has(key)) nameIndex.set(key, []);
        nameIndex.get(key).push(ev);
      }
    }
  }

  // Ordered by frame, then by owner, so the order is stable across calls and across saves rather
  // than depending on object key order.
  events.sort((a, b) => (a.frame - b.frame) || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));

  const byId = new Map(events.map((e) => [e.id, e]));
  return {
    events,
    byId,
    nameIndex,
    count: events.length,
    items: [...new Set(events.map((e) => e.itemId))],
    warnings,
    limitations: EVENT_LIMITATIONS,
  };
}

/**
 * Resolve an event reference to a frame.
 *
 * Accepted references, in the order they are tried:
 *   { frame: 24 }          an explicit frame — always exact, never ambiguous
 *   { id: 'marker:…' }     an event id from a previous `buildTimeline`
 *   { name: 'impact' }     an event name, case-insensitive
 *   'impact' | 24          the bare forms of the two above
 *
 * A name that matches events on more than one item is AMBIGUOUS and resolves to nothing — see
 * decision 4 in this file's header.
 */
export function resolveEvent(project, ref, { timeline = null, itemId = null } = {}) {
  const tl = timeline || buildTimeline(project);
  const out = (extra) => ({ ref, frame: null, event: null, ambiguous: false, question: null, matched: null, ...extra });

  if (ref === null || ref === undefined) {
    return out({ question: 'Which event? Pass a frame, an event id, or an event name.' });
  }
  if (typeof ref === 'number') return Number.isFinite(ref) ? out({ frame: ref, matched: 'frame' }) : out({ question: `"${ref}" is not a finite frame.` });
  if (typeof ref === 'string') return resolveEvent(project, /^-?\d+(\.\d+)?$/.test(ref.trim()) ? { frame: Number(ref) } : { name: ref }, { timeline: tl, itemId });

  if (typeof ref !== 'object') return out({ question: 'An event reference must be a frame, a string, or an object.' });

  if (ref.frame !== undefined) {
    return Number.isFinite(ref.frame) ? out({ frame: ref.frame, matched: 'frame' }) : out({ question: `"${ref.frame}" is not a finite frame.` });
  }

  if (ref.id !== undefined) {
    const ev = tl.byId.get(ref.id);
    if (ev) return out({ frame: ev.frame, event: ev, matched: 'id' });
    // An id that does not resolve is much more likely a retimed marker than a typo, because an id
    // encodes the time it was built at. Say which, rather than "not found".
    return out({
      question: `No event has id "${ref.id}". An event id encodes the frame it was read at, so a marker that has since been retimed will not match — rebuild the timeline and resolve by name.`,
      matched: null,
    });
  }

  if (ref.name !== undefined) {
    const key = String(ref.name).trim().toLowerCase();
    let hits = tl.nameIndex.get(key) || [];
    if (itemId) hits = hits.filter((e) => e.itemId === itemId);
    if (!hits.length) {
      const known = [...new Set(tl.events.map((e) => e.name).filter(Boolean))].sort();
      return out({
        question: `No event is called "${ref.name}"${itemId ? ` on item ${itemId}` : ''}. ${known.length ? `Known event names: ${known.join(', ')}.` : 'This project has no named events — add one with add_marker.'}`,
      });
    }
    if (hits.length > 1) {
      const owners = [...new Set(hits.map((e) => e.itemName || e.itemId))];
      return out({
        ambiguous: true,
        question: owners.length > 1
          ? `"${ref.name}" names an event on ${owners.length} different items (${owners.join(', ')}). Pass itemId to say which.`
          : `"${ref.name}" names ${hits.length} events on ${owners[0]} (frames ${hits.map((e) => e.frame).join(', ')}). Pass a frame or an id to say which.`,
        candidates: hits,
      });
    }
    return out({ frame: hits[0].frame, event: hits[0], matched: 'name' });
  }

  return out({ question: 'An event reference needs one of: frame, id, name.' });
}

/** Events whose frame lies in `[from, to]` inclusive. */
export function eventsInRange(timeline, from, to) {
  const a = Math.min(from, to), b = Math.max(from, to);
  return timeline.events.filter((e) => e.frame >= a - EPS && e.frame <= b + EPS);
}

/**
 * Events that land on the same frame across different items.
 *
 * This is the thing a per-item marker list cannot show. Co-timing is reported as a FACT, never as
 * a problem: two characters impacting on one frame is usually the point.
 */
export function concurrentEvents(timeline) {
  const byFrame = new Map();
  for (const e of timeline.events) {
    const k = e.frame.toFixed(6);
    if (!byFrame.has(k)) byFrame.set(k, []);
    byFrame.get(k).push(e);
  }
  const groups = [];
  for (const [, list] of byFrame) {
    if (list.length < 2) continue;
    const items = [...new Set(list.map((e) => e.itemId))];
    groups.push({
      frame: list[0].frame,
      events: list,
      items,
      crossItem: items.length > 1,
      withCode: list.filter((e) => e.hasCode).length,
    });
  }
  groups.sort((a, b) => a.frame - b.frame);
  return groups;
}

/**
 * Pairs of events whose spans overlap, across items.
 *
 * A zero-width event has no span and cannot overlap anything, so only widthed events participate.
 * Reported with the overlap extent so a caller can tell a one-frame clip from a total eclipse.
 */
export function overlaps(timeline) {
  const widthed = timeline.events.filter((e) => e.width > 0);
  const out = [];
  for (let i = 0; i < widthed.length; i++) {
    for (let j = i + 1; j < widthed.length; j++) {
      const a = widthed[i], b = widthed[j];
      const lo = Math.max(a.span[0], b.span[0]);
      const hi = Math.min(a.span[1], b.span[1]);
      if (hi - lo <= EPS) continue;
      out.push({ a, b, from: lo, to: hi, frames: hi - lo, sameItem: a.itemId === b.itemId });
    }
  }
  return out;
}

/**
 * The events a frame falls inside, by span.
 *
 * `state.markerSpanning` answers this for one item; this answers it for the whole shot, which is
 * what a caller timing an effect actually needs to know.
 */
export function eventsSpanning(timeline, frame) {
  return timeline.events.filter((e) => e.width > 0 && frame >= e.span[0] - EPS && frame <= e.span[1] + EPS);
}

// ---------------------------------------------------------------- the shot (Part 40)

/**
 * The shot-shaped facts a Cadence project already carries.
 *
 * Part 40 describes a Shot as an entity with its own record. Cadence has no such entity, and this
 * function does not invent one — inventing it would mean a `describeShot` whose fields cannot be
 * written, read back, or saved, which is exactly the "row of shells" Part 4.6 forbids. What it
 * does instead is report the facts that ARE recorded, and name the rest as absent, so a caller can
 * see the whole gap in one place.
 */
export function describeShot(project, { timeline = null } = {}) {
  const tl = timeline || buildTimeline(project);
  const items = project?.items || [];
  const cameras = items.filter((i) => i.kind === 'camera');
  const fps = Number.isFinite(project?.fps) ? project.fps : null;
  const length = Number.isFinite(project?.length) ? project.length : null;

  return {
    name: project?.name ?? null,
    fps,
    length_frames: length,
    duration_seconds: fps && length ? length / fps : null,
    play_range: project?.playRange || null,
    loops: !!project?.loop,
    priority: project?.priority ?? null,
    cameras: cameras.map((c) => ({ itemId: c.id, name: c.name, fov: c.fov ?? null })),
    active_camera: cameras.length === 1 ? cameras[0].id : null,
    characters: items.filter((i) => i.kind === 'rig').map((i) => ({ itemId: i.id, name: i.name })),
    effects: items.filter((i) => i.kind === 'vfx' || i.kind === 'effect').map((i) => ({ itemId: i.id, name: i.name, kind: i.kind })),
    events: tl.count,
    event_frames: tl.events.map((e) => e.frame),
    absent: Object.freeze({
      shot_entity: 'there is no Shot record — these fields are read off the project, and writing "the shot" means writing the project',
      active_camera: cameras.length > 1
        ? `${cameras.length} cameras exist and nothing in the project marks one as the shot camera; the editor tracks a view, which is UI state and is not saved as shot data`
        : cameras.length ? null : 'no camera exists',
      staging: 'no blocking, beat or coverage record exists (SHOT-001)',
      camera_spec: 'framing, lens intent and shake are not declared anywhere (SHOT-003, SHOT-005)',
    }),
    limitations: EVENT_LIMITATIONS,
  };
}
