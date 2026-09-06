// The Timeline Graph (directive Part 19).
//
// Part 19: "The Timeline Graph must represent more than a list of keyframes. It needs temporal
// semantics."
//
// What Cadence stores per track is `{ keys: [{t, v, es, ed, bez, ep}], space?, vtype?, action? }`.
// What Part 19 asks for is a track that also knows its layer, blend mode, weight, locked range,
// revision and dependencies, and keyframes that know their phase, intent, lock state and
// originating transaction.
//
// Several of those have nowhere to live yet. The rule this module follows is the one from Part
// 4.7: an unavailable field is present and `null`, with the reason stated once in `limitations`.
// It is never quietly omitted, and never given a plausible-looking default — a planner that reads
// `weight: 1` and acts on it has been lied to, whereas one that reads `weight: null` knows to ask.
//
// Annotations that Cadence has no room for (`intent_annotation`, `phase_annotation`, key locks)
// live in `project.semantics.annotations`, keyed the way every existing mutator already addresses
// a key — `(itemId, track, t)`. That is a real limitation and it is stated: a key moved by a
// direct timeline drag leaves its annotation behind, because `state.js`'s movers know nothing
// about this side table. Phase 2's transaction layer moves them; the UI does not.

import * as ids from './ids.js';
import { contentHash } from './hash.js';
import { evalTrackCF, evalTrackNum, keyTimesOf } from './kinematics.js';

const ACTION_PREFIX = '@act:';

/** Reserved track names are not joint transforms. Kept in one place so callers stop re-deriving
 *  "starts with @" and getting the action-track case wrong. */
export function classifyTrack(name, track) {
  if (name === '@origin') return { kind: 'origin', animatable: true, valueType: 'cframe' };
  if (name === '@fov') return { kind: 'camera_property', animatable: true, valueType: 'number' };
  if (name.startsWith(ACTION_PREFIX)) {
    return { kind: 'action', animatable: false, valueType: track?.vtype || 'boolean', actionKey: name.slice(ACTION_PREFIX.length) };
  }
  if (name.startsWith('@')) return { kind: 'reserved', animatable: true, valueType: track?.vtype || 'number' };
  if (track && track.vtype) return { kind: 'property', animatable: true, valueType: track.vtype };
  return { kind: 'joint', animatable: true, valueType: 'cframe' };
}

function annotationFor(project, itemId, track, t) {
  const table = project?.semantics?.annotations?.[itemId]?.[track];
  if (!table) return null;
  // Keys are addressed by exact time; a float time is stringified the same way it was written.
  return table[String(t)] || null;
}

function lockedRangeFor(project, itemId, track) {
  const locks = project?.semantics?.locks?.[itemId];
  if (!locks) return null;
  const forTrack = locks.tracks && locks.tracks[track];
  return forTrack ? { start: forTrack.start ?? null, end: forTrack.end ?? null, reason: forTrack.reason || null } : null;
}

/**
 * Project one item's tracks into the Timeline Graph.
 *
 * `opts.includeKeys` (default true) — set false for a shape-only listing of a very large project.
 */
export function timelineGraph(project, item, { includeKeys = true } = {}) {
  const tracks = (project.tracks && project.tracks[item.id]) || {};
  const fps = project.fps || 30;
  const names = Object.keys(tracks);
  // A joint track drives exactly one joint, addressed by name. Resolving it to the joint's stable
  // id here is what lets a dependency walk cross from the timeline into the rig graph.
  const jointByName = new Map(((item.rig && item.rig.joints) || []).map((j) => [j.name, j]));

  const trackNodes = names.map((name) => {
    const tr = tracks[name];
    const cls = classifyTrack(name, tr);
    const keys = tr.keys || [];
    const first = keys.length ? keys[0].t : null;
    const last = keys.length ? keys[keys.length - 1].t : null;

    const keyNodes = includeKeys ? keys.map((k, i) => {
      const ann = annotationFor(project, item.id, name, k.t);
      return {
        key_id: ids.keyId(item.id, name, k.t),
        time: k.t,
        seconds: +(k.t / fps).toFixed(6),
        value: k.v,
        // Cadence stores an easing STYLE and DIRECTION per key (plus an optional cubic-bezier
        // override and style parameters), not in/out tangent vectors. `in_tangent`/`out_tangent`
        // are therefore null, and `easing` carries what actually exists — reporting a fabricated
        // tangent pair would make curve analysis measure a number nobody authored.
        in_tangent: null,
        out_tangent: null,
        interpolation: k.bez ? 'bezier' : `${k.es || 'Cubic'}/${k.ed || 'Out'}`,
        easing: { style: k.es || 'Cubic', direction: k.ed || 'Out', bezier: k.bez || null, params: k.ep || null },
        intent_annotation: ann?.intent ?? null,
        phase_annotation: ann?.phase ?? null,
        lock_state: ann?.locked ? 'locked' : 'unlocked',
        transaction_origin: ann?.transaction ?? null,
        confidence: ann?.confidence ?? null,
        index: i,
      };
    }) : null;

    return {
      track_id: ids.trackId(item.id, name),
      owner_id: ids.itemId(item),
      name,
      property_path: cls.kind === 'joint' ? `rig.joints["${name}"].Transform` : name,
      kind: cls.kind,
      value_type: cls.valueType,
      action_key: cls.actionKey ?? null,

      // Cadence has no animation layers. All three are null rather than 0/'override'/1, because
      // "there is one implicit layer" and "this track is on layer 0 of several" are different
      // facts and a retarget or blend planner must be able to tell them apart.
      layer: null,
      blend_mode: null,
      weight: null,

      keyframes: keyNodes,
      key_count: keys.length,
      interpolation: summariseInterpolation(keys),
      curve_id: null, // curves are per-key easing here, not separate curve objects
      time_range: keys.length ? { start: first, end: last, frames: last - first, seconds: +((last - first) / fps).toFixed(6) } : null,
      event_markers: markersInRange(project, item.id, first, last),
      locked_range: lockedRangeFor(project, item.id, name),
      muted_state: false, // Cadence has no track mute; false is the actual behaviour, not a guess
      space: tr.space === 'world' ? 'origin' : 'parent',
      source: 'user', // nothing records authorship per track yet; Phase 2 transactions will
      dependencies: cls.kind === 'joint' && jointByName.has(name)
        ? [{ type: 'animation_binding', target: ids.jointId(item.id, jointByName.get(name)), note: 'this track drives that joint\'s Transform' }]
        : cls.kind === 'joint'
          // A joint track whose joint no longer exists: the keys are still stored and still
          // saved, but nothing consumes them. Worth surfacing rather than hiding as an empty list.
          ? [{ type: 'animation_binding', target: null, note: `no joint named "${name}" exists on this rig — the track is orphaned` }]
          : [],
      revision: contentHash(tr),
    };
  });

  const allTimes = keyTimesOf(tracks, { includeReserved: true });
  const animated = trackNodes.filter((t) => t.key_count > 0);

  return {
    id: `timeline:${item.id}`,
    itemId: item.id,
    entityId: ids.itemId(item),
    name: item.name,

    // Part 19 "Time units and sampling": the canonical unit is stated, the conversion is explicit,
    // and the fps used to derive every `seconds` field travels with the data. Nothing downstream
    // should ever compare frame indices without checking this.
    time: {
      canonical_unit: 'frame',
      fps,
      length_frames: project.length ?? null,
      length_seconds: project.length != null ? +(project.length / fps).toFixed(6) : null,
      play_range: project.playRange ? { ...project.playRange } : null,
      sampling: 'keys are stored at exact frame times; values between keys are interpolated, not sampled',
    },

    tracks: trackNodes,
    counts: {
      tracks: trackNodes.length,
      animated_tracks: animated.length,
      keys: trackNodes.reduce((n, t) => n + t.key_count, 0),
      distinct_key_times: allTimes.length,
    },
    key_times: allTimes,
    occupied_range: allTimes.length ? { start: allTimes[0], end: allTimes[allTimes.length - 1] } : null,
    markers: (project.markers?.[item.id] || []).map((m) => ({
      id: ids.markerId(item.id, m.t),
      time: m.t,
      seconds: +(m.t / fps).toFixed(6),
      width: m.width ?? 0,
      name: m.name || null,
      code_begin: m.codeBegin || null,
      code_end: m.codeEnd || null,
      // Part 41 wants causal parent, tolerance, priority, dependent systems. Cadence's marker has
      // none of them; the shot-event system that does is Phase 6.
      event_type: null,
      causal_parent: null,
      timing_tolerance: null,
      priority: null,
      dependent_systems: [],
    })),
    groups: (project.groups || [])
      .filter((g) => (g.keys || []).some((k) => k.itemId === item.id))
      .map((g) => ({
        id: `keygroup:${g.id}`,
        keys: (g.keys || []).filter((k) => k.itemId === item.id).map((k) => ids.keyId(k.itemId, k.track, k.t)),
      })),
    id_durability: { track: ids.idDurability('track'), key: ids.idDurability('key') },
    limitations: timelineLimitations(trackNodes),
    revision: contentHash(tracks),
  };
}

function summariseInterpolation(keys) {
  if (!keys.length) return null;
  const styles = new Set();
  for (const k of keys) styles.add(k.bez ? 'bezier' : `${k.es || 'Cubic'}/${k.ed || 'Out'}`);
  return styles.size === 1 ? [...styles][0] : { mixed: [...styles].sort() };
}

function markersInRange(project, itemId, start, end) {
  if (start === null || end === null) return [];
  return (project.markers?.[itemId] || [])
    .filter((m) => m.t >= start && m.t <= end)
    .map((m) => ids.markerId(itemId, m.t));
}

function timelineLimitations(trackNodes) {
  const out = [
    'layer, blend_mode and weight are null on every track: Cadence has no animation layers, so there is nothing to report rather than a default to invent',
    'in_tangent/out_tangent are null: keys carry an easing style and direction (plus an optional cubic bezier), not tangent vectors',
    'keyframes have no native id — key_id encodes (item, track, time) and does not survive the key being moved',
  ];
  if (trackNodes.some((t) => t.keyframes && t.keyframes.some((k) => k.phase_annotation || k.intent_annotation))) {
    out.push('key annotations live in project.semantics.annotations and are keyed by time; a key moved by a direct timeline drag leaves its annotation behind (state.js\'s movers do not know about the side table)');
  }
  return out;
}

/**
 * Value of a track at an arbitrary frame, with the interpolation actually used reported alongside
 * it. Separate from `kinematics.evalTrack*` because callers of the graph want the explanation as
 * well as the number.
 */
export function sampleTrack(project, itemId, trackName, t) {
  const tr = project.tracks?.[itemId]?.[trackName];
  if (!tr) return null;
  const cls = classifyTrack(trackName, tr);
  const keys = tr.keys || [];
  const isCF = cls.valueType === 'cframe';
  const value = isCF ? evalTrackCF(tr, t) : evalTrackNum(tr, t);

  let regime = 'no keys';
  let between = null;
  if (keys.length) {
    if (t <= keys[0].t) regime = 'held at the first key';
    else if (t >= keys[keys.length - 1].t) regime = 'held after the last key';
    else {
      for (let i = 0; i < keys.length - 1; i++) {
        if (t >= keys[i].t && t <= keys[i + 1].t) {
          regime = 'interpolated';
          between = {
            from: ids.keyId(itemId, trackName, keys[i].t),
            to: ids.keyId(itemId, trackName, keys[i + 1].t),
            easing: keys[i].bez ? `bezier ${keys[i].bez.join(',')}` : `${keys[i].es || 'Cubic'}/${keys[i].ed || 'Out'}`,
            alpha_position: +((t - keys[i].t) / ((keys[i + 1].t - keys[i].t) || 1)).toFixed(6),
          };
          break;
        }
      }
    }
  }
  return { track_id: ids.trackId(itemId, trackName), frame: t, value, value_type: cls.valueType, regime, between };
}
