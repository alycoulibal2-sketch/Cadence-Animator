// Scope analysis before a patch (directive Part 54).
//
// "Before applying a patch, calculate: direct target objects; direct property paths; target time
// range; dependent objects; dependent effect emitters; event implications; camera implications;
// expected visual region; protected-state conflict risk; regression-test requirement. For a local
// correction, the default must be minimal scope. A broad rewrite requires an explicit reason and
// user visibility."
//
// Two of those ten cannot be answered from project data. `expected visual region` needs a render
// (Part 43, Phase 4) and a meaningful `camera implications` answer needs a framing model (Part 40,
// Phase 6). Both are returned as `null` WITH the reason and the requirement that unblocks them,
// because a scope report that quietly omits a row reads as "nothing to worry about there".
//
// The eight that CAN be answered are answered from the Dependency Graph rather than from
// guesswork. That is the point of Part 66: an edit to a shoulder track propagates down the rig to
// the wrist, on to whatever is attached to the hand, and on to any effect bound to that item —
// and the analysis has to find that chain without being told about it, or the "minimal scope"
// default is a fiction.

import * as ids from './ids.js';
import * as roles from './roles.js';
import { coverage, evidence, finding, CERTAINTY } from './certainty.js';
import { checkPatch } from './constraints.js';
import { describeOp } from './patch.js';

const EPS = 1e-6;

/**
 * What a patch reaches.
 *
 * @param plan     the output of `patch.planPatch` — the operations AND what they resolved to
 * @param opts.constraints  constraints to check the scope against (persisted locks are always
 *                          included; see `constraints.checkPatch`)
 * @param opts.frame        the frame semantic targets are resolved at
 */
export function analyseScope(project, plan, { constraints = [], frame = 0 } = {}) {
  const ops = (plan.ops || []).map((r) => r.op);
  const acting = (plan.ops || []).filter((r) => r.effect !== 'no_op');

  const directItems = new Set();
  const directTracks = new Set();
  const directFields = new Set();
  const directMarkers = new Set();
  for (const rec of acting) {
    const op = rec.op;
    if (op.itemId) directItems.add(op.itemId);
    if (op.track) directTracks.add(ids.trackId(op.itemId, op.track));
    if (op.op === 'set_item_field') directFields.add(`${ids.itemId(op.itemId)}#${op.path}`);
    if (op.op === 'set_project_field') directFields.add(`${ids.projectId(project)}#${op.path}`);
    if (op.op === 'set_marker' || op.op === 'delete_marker') directMarkers.add(ids.markerId(op.itemId, Math.max(0, Math.round(op.t))));
  }

  const timeRange = plan.changed_frame_range;
  const dependents = propagate(project, directItems, directTracks);
  const events = eventImplications(project, timeRange, directItems);
  const conflict = checkPatch(project, { ops }, constraints, { frame, result: plan.result });
  const breadth = classifyBreadth(project, directItems, directTracks, timeRange, acting.length);

  return {
    // --- the eight Part 54 rows that project data can answer
    direct_target_objects: [...directItems].map((id) => describeItem(project, id)),
    direct_property_paths: [...directTracks].sort(),
    direct_fields: [...directFields].sort(),
    direct_markers: [...directMarkers].sort(),
    target_time_range: timeRange,
    dependent_objects: dependents.items,
    dependent_parts: dependents.parts,
    dependent_effect_emitters: dependents.effects,
    event_implications: events,
    protected_state_conflict_risk: {
      constraints_checked: conflict.checked,
      violations: conflict.violations.length,
      highest_priority_violated: conflict.violations.length ? conflict.violations[0].priority : null,
      allowed: conflict.allowed,
      recommendation: conflict.recommendation,
      conflicts: conflict.conflicts,
      unresolved_targets: conflict.unresolved_targets,
      detail: conflict.violations,
    },
    regression_test_requirement: regressionRequirement(project, timeRange, dependents, events),

    // --- the two rows that need layers that do not exist, said plainly
    camera_implications: cameraImplications(project, directItems, dependents),
    expected_visual_region: {
      region: null,
      reason: 'a screen-space region needs a render and a camera projection; the observation layer has only a beauty pass today',
      blocked_on: 'OBS-002/OBS-003 (silhouette and object-ID passes, directive Part 43, Phase 4)',
    },

    breadth,
    summary: summarise(breadth, directTracks, dependents, timeRange, conflict),
    operations: acting.map((r) => ({ effect: r.effect, description: describeOp(r.op) })),
    coverage: coverage({
      scope: `${acting.length} acting operation(s) of ${ops.length}, traced through the dependency graph`,
      frames: timeRange ? [timeRange.start, timeRange.end] : null,
      loop: 'fast',
      notRun: [
        'no render was produced, so nothing about the visible result was measured (Part 43, Phase 4)',
        'no baseline comparison was made, so "was this change expected?" is unanswered (Part 44, Phase 4)',
        'camera framing, occlusion and readability were not evaluated — Cadence has no framing model (Part 40, Phase 6)',
        'motion consequences (velocity, arc, contact drift) were not measured (Part 23, Phase 5)',
      ],
    }),
  };
}

// ---------------------------------------------------------------- propagation

/**
 * Follow the consequences of touching these tracks.
 *
 * A joint track drives one part; that part's children move with it; anything attached to any of
 * those parts moves too, recursively, and an effect item carried by an attached prop moves with
 * it. This walks the same relationships `ai/scenegraph.js` publishes as dependency edges, so the
 * two cannot disagree about what depends on what.
 */
function propagate(project, directItems, directTracks) {
  const items = new Map();     // itemId -> reason
  const parts = [];            // { entityId, itemId, partId, name, role, reason }
  const effects = [];

  for (const trackIdent of directTracks) {
    const p = ids.parseId(trackIdent);
    if (!p) continue;
    const item = (project.items || []).find((i) => i.id === p.itemId);
    if (!item) continue;

    if (!item.rig) continue;
    const driven = p.track === '@origin'
      ? item.rig.rootPart
      : (item.rig.joints || []).find((j) => j.name === p.track)?.part1 || null;
    if (!driven) continue;

    for (const partId of descendants(item.rig, driven)) {
      const part = (item.rig.parts || []).find((q) => q.id === partId);
      const r = part ? roles.partRole(project, item, part) : null;
      parts.push({
        entityId: ids.partId(item.id, partId),
        itemId: item.id,
        partId,
        name: part?.name || partId,
        role: r?.role ?? null,
        reason: partId === driven
          ? `"${p.track}" places it directly`
          : `it hangs below ${driven}, which "${p.track}" moves`,
      });
    }
  }

  // Attachment: anything attached to a moved part follows it, and so does anything attached to
  // THAT. A prop in a hand carrying a trail effect is two hops, and both hops matter.
  const movedParts = new Set(parts.map((x) => `${x.itemId}/${x.partId}`));
  let grew = true;
  while (grew) {
    grew = false;
    for (const it of project.items || []) {
      if (!it.attachedTo || items.has(it.id)) continue;
      const key = `${it.attachedTo.itemId}/${it.attachedTo.partId}`;
      const parentMoved = movedParts.has(key) || items.has(it.attachedTo.itemId) || directItems.has(it.attachedTo.itemId);
      if (!parentMoved) continue;
      items.set(it.id, `attached to ${it.attachedTo.partId} of ${describeItem(project, it.attachedTo.itemId).name}, so it inherits that motion`);
      for (const q of it.rig?.parts || []) movedParts.add(`${it.id}/${q.id}`);
      grew = true;
    }
  }

  for (const it of project.items || []) {
    const affected = items.has(it.id) || directItems.has(it.id);
    if (!affected) continue;
    if (it.kind === 'effect' && it.effect) {
      effects.push({ entityId: `effectdoc:${it.id}`, itemId: it.id, name: it.name, reason: 'the effect document is evaluated relative to this item, which the patch moves' });
    }
    if (it.kind === 'vfx') {
      effects.push({ entityId: `emitter:${it.id}`, itemId: it.id, name: it.name, reason: 'a legacy emitter attached to this item' });
    }
  }

  return {
    items: [...items].map(([id, reason]) => ({ ...describeItem(project, id), reason })),
    parts,
    effects,
  };
}

/** Every part at or below `rootId` in a rig's joint tree. Welds count: a welded part moves too. */
function descendants(rig, rootId) {
  const children = new Map();
  for (const j of rig.joints || []) {
    if (!children.has(j.part0)) children.set(j.part0, []);
    children.get(j.part0).push(j.part1);
  }
  const out = [];
  const seen = new Set();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue; // a hand-edited cycle must not spin here
    seen.add(id);
    out.push(id);
    for (const c of children.get(id) || []) stack.push(c);
  }
  return out;
}

function describeItem(project, itemId) {
  const it = (project.items || []).find((i) => i.id === itemId);
  return { entityId: ids.itemId(itemId), itemId, name: it?.name ?? '(missing)', kind: it?.kind ?? null };
}

// ---------------------------------------------------------------- events, cameras, regression

/**
 * Markers whose span overlaps the changed frames (Part 41's shot events). A retime that walks over
 * an impact marker is the single most common way an edit breaks a shot without breaking any data,
 * so it is reported even when no constraint protects the marker.
 */
function eventImplications(project, timeRange, directItems) {
  if (!timeRange) return { overlapping: [], note: 'the patch changes nothing time-based, so no event can be affected' };
  const overlapping = [];
  for (const [itemId, list] of Object.entries(project.markers || {})) {
    for (const m of list || []) {
      const start = m.t, end = m.t + (m.width || 0);
      if (end < timeRange.start - EPS || start > timeRange.end + EPS) continue;
      overlapping.push({
        entityId: ids.markerId(itemId, m.t),
        itemId,
        name: m.name || '(unnamed)',
        span: [start, end],
        has_code: !!(m.codeBegin || m.codeEnd),
        on_a_directly_edited_item: directItems.has(itemId),
        implication: m.codeBegin || m.codeEnd
          ? 'this marker carries Luau that fires when playback crosses it, so a retime moves a gameplay event, not only a visual one'
          : 'a named event sits inside the changed range',
      });
    }
  }
  return {
    overlapping,
    note: overlapping.length
      ? `${overlapping.length} event(s) sit inside frames ${timeRange.start}–${timeRange.end}`
      : `no event marker sits inside frames ${timeRange.start}–${timeRange.end}`,
  };
}

function cameraImplications(project, directItems, dependents) {
  const cameras = (project.items || []).filter((i) => i.kind === 'camera');
  const touched = cameras.filter((c) => directItems.has(c.id) || dependents.items.some((d) => d.itemId === c.id));
  const looked = project.__cameraView || null;
  return {
    cameras_in_project: cameras.map((c) => ({ entityId: ids.itemId(c), name: c.name, looked_through: looked === c.id })),
    cameras_touched: touched.map((c) => ({ entityId: ids.itemId(c), name: c.name })),
    // The honest half. Whether an edit is VISIBLE from a camera needs projection and occlusion.
    framing_effect: null,
    framing_reason: cameras.length
      ? 'whether this edit changes what the camera sees needs a projection and occlusion model; Cadence has no framing model, and `camera_relationships` in the Scene Graph records only that a camera is a camera'
      : 'there is no camera in this project, so nothing screen-space can be reasoned about at all',
    blocked_on: 'SHOT-003/SHOT-004 (CameraSpec and camera reasoning, directive Part 40, Phase 6)',
  };
}

/**
 * What would have to be re-validated to trust this patch — and which of those checks exist.
 *
 * Part 15's rule applies here more than anywhere: this is the place a system is most tempted to
 * imply that a fast check stood in for a full one. The `available` / `unavailable` split is
 * therefore explicit, and `can_fully_validate` is false whenever anything is unavailable.
 */
function regressionRequirement(project, timeRange, dependents, events) {
  const frames = timeRange
    ? { start: Math.max(0, Math.floor(timeRange.start) - 1), end: Math.min(project.length ?? Infinity, Math.ceil(timeRange.end) + 1) }
    : null;
  const available = [
    'validate_animation — per-frame rotation/position pops, hinge-axis misalignment, degenerate CFrames (validate.js)',
    'diff_snapshots — exact scene-graph and keyframe difference against any held snapshot',
    'inspect_timeline — key times, easing and annotations after the edit',
  ];
  const unavailable = [
    'a rendered comparison of the affected frames (needs OBS-001 plus a pixel/perceptual method — REG-003, Phase 4)',
    'a baseline to compare against at all (REG-001, Phase 4): a snapshot is not yet an APPROVED baseline',
    'contact and foot-drift validation over the changed range (MOT-008, Phase 5)',
  ];
  if (events.overlapping?.some((e) => e.has_code)) {
    unavailable.push('verification that the Luau on the overlapped marker still fires where the shot expects it (no Luau runtime here — markers are exported to Studio and run there)');
  }
  return {
    frames_to_revalidate: frames,
    // A wider net than the edited frames: an eased key before the range changes the shape of the
    // segment leading into it, and an attached prop can lag.
    reason: frames ? 'one frame either side of the edit, because a key participates in the segments on both sides of it' : 'nothing time-based changed',
    also_revalidate: [
      ...dependents.items.map((d) => `${d.name} — ${d.reason}`),
      ...dependents.effects.map((d) => `${d.name} — ${d.reason}`),
    ],
    available,
    unavailable,
    can_fully_validate: false,
    note: 'can_fully_validate is false and will stay false until Phase 4 lands baselines and image comparison. A pass from the available checks means "no data-side defect found", not "the shot still looks right".',
  };
}

// ---------------------------------------------------------------- breadth

/**
 * Is this a local correction or a broad rewrite? Part 54: "For a local correction, the default
 * must be minimal scope. A broad rewrite requires an explicit reason and user visibility."
 *
 * The thresholds are declared here rather than hidden in a condition, and are reported with the
 * verdict, so a caller can disagree with them explicitly instead of being surprised by them.
 */
const BREADTH_THRESHOLDS = Object.freeze({
  local_max_tracks: 3,
  local_max_items: 1,
  local_max_frame_span: 12,
  broad_min_track_fraction: 0.5,
});

function classifyBreadth(project, directItems, directTracks, timeRange, opCount) {
  let totalTracks = 0;
  for (const perItem of Object.values(project.tracks || {})) totalTracks += Object.keys(perItem).length;
  const span = timeRange ? timeRange.end - timeRange.start : 0;
  const fraction = totalTracks ? directTracks.size / totalTracks : 0;

  const local = directTracks.size <= BREADTH_THRESHOLDS.local_max_tracks
    && directItems.size <= BREADTH_THRESHOLDS.local_max_items
    && span <= BREADTH_THRESHOLDS.local_max_frame_span;
  const broad = fraction >= BREADTH_THRESHOLDS.broad_min_track_fraction || directItems.size > 2;

  const verdict = local ? 'local' : broad ? 'broad' : 'moderate';
  return {
    verdict,
    operations: opCount,
    items: directItems.size,
    tracks: directTracks.size,
    tracks_in_project: totalTracks,
    track_fraction: Number(fraction.toFixed(3)),
    frame_span: span,
    thresholds: BREADTH_THRESHOLDS,
    requires_explicit_reason: verdict === 'broad',
    finding: finding({
      id: `SCOPE-${verdict.toUpperCase()}`,
      certainty: CERTAINTY.CERTAIN,
      statement: verdict === 'broad'
        ? `this patch touches ${directTracks.size} of ${totalTracks} track(s) across ${directItems.size} item(s) — Part 54 calls that a broad rewrite, which needs an explicit reason and user visibility`
        : verdict === 'local'
          ? `this patch is a local correction: ${directTracks.size} track(s) on ${directItems.size} item(s) over ${span} frame(s)`
          : `this patch is neither minimal nor a rewrite: ${directTracks.size} of ${totalTracks} track(s), ${directItems.size} item(s), ${span} frame(s)`,
      evidence: [
        evidence('measurement', 'scope counted from the planned operations', { items: directItems.size, tracks: directTracks.size, totalTracks, span }),
        evidence('assumption', 'the local/broad thresholds are a declared convention, not a measured one', BREADTH_THRESHOLDS),
      ],
    }),
  };
}

function summarise(breadth, directTracks, dependents, timeRange, conflict) {
  const bits = [`${breadth.verdict} scope: ${directTracks.size} track(s) on ${breadth.items} item(s)`];
  if (timeRange) bits.push(`frames ${timeRange.start}–${timeRange.end}`);
  if (dependents.parts.length) bits.push(`${dependents.parts.length} part(s) move as a consequence`);
  if (dependents.items.length) bits.push(`${dependents.items.length} attached item(s) follow`);
  if (dependents.effects.length) bits.push(`${dependents.effects.length} effect(s) affected`);
  bits.push(conflict.violations.length ? `${conflict.violations.length} constraint violation(s)` : 'no constraint violated');
  return bits.join('; ');
}
