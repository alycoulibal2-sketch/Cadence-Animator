// The Scene Graph (directive Part 17) and the Dependency Graph (Part 66).
//
// Part 17 lists 22 fields per object. Cadence can answer about half of them directly; the rest are
// either derivable (semantic role, dependency ids, world transform) or genuinely absent
// (materials, lights). The projection reports all 22, with `null` and a stated reason for the
// absent ones — a caller must be able to tell "this scene has no key light" from "nobody asked".
//
// The Dependency Graph is the part that earns its keep. Part 66's example is a wrist rotation
// propagating to a weapon transform, a trail path, particle spawn positions, camera framing and a
// regression frame range. Cadence can honestly supply the first several of those today:
// hierarchy, transform inheritance, animation binding, and item attachment. Render, cache and
// export edges need the observation layer and are marked absent rather than sketched in.

import * as CF from '../cf.js';
import * as ids from './ids.js';
import * as roles from './roles.js';
import * as constraints from './constraints.js';
import { contentHash } from './hash.js';
import { rigGraph } from './riggraph.js';
import { timelineGraph } from './timelinegraph.js';
import { solveItemWorlds, itemOriginAt, tracksOf } from './kinematics.js';

/**
 * Project the whole project into a Scene Graph.
 *
 * @param opts.frame        frame at which to resolve world transforms (default 0)
 * @param opts.includeRig   include the full Rig Graph per rig item (default true)
 * @param opts.includeTimeline include the full Timeline Graph per item (default false — it is the
 *                          largest part of the payload and `inspect_timeline` fetches it per item)
 * @param opts.includeKeys  when including timelines, include every keyframe (default false)
 */
export function sceneGraph(project, { frame = 0, includeRig = true, includeTimeline = false, includeKeys = false } = {}) {
  const items = project.items || [];
  const byId = new Map(items.map((i) => [i.id, i]));

  // Attachment is the only real parent/child relationship between ITEMS (a prop attached to a
  // hand). Everything else in Cadence is flat at the item level; hierarchy lives inside a rig.
  const childrenOf = new Map();
  for (const it of items) {
    const p = it.attachedTo?.itemId;
    if (p) {
      if (!childrenOf.has(p)) childrenOf.set(p, []);
      childrenOf.get(p).push(it.id);
    }
  }

  const nodes = items.map((item) => {
    const r = roles.itemRole(project, item);
    const tracks = tracksOf(project, item.id);
    const worlds = item.rig ? solveItemWorlds(project, item, frame) : null;
    const origin = safeOrigin(project, item, frame);
    const locks = constraints.lockStateOf(project, item.id);

    const node = {
      id: ids.itemId(item),
      name: item.name,
      type: item.kind,
      parent_id: item.attachedTo ? ids.itemId(item.attachedTo.itemId) : null,
      children_ids: (childrenOf.get(item.id) || []).map((id) => ids.itemId(id)),
      source_asset: sourceAsset(item),
      semantic_role: r.role,
      role_source: r.source,
      role_certainty: r.certainty,
      role_evidence: r.evidence,

      // A CFrame, not a matrix — same 12-array convention as everything else in the app.
      world_transform: origin,
      // For an unattached item local == world. For an attached one, the local transform is the
      // attachment offset, which is what the user actually authored.
      local_transform: item.attachedTo ? item.attachedTo.offset : origin,
      transform_frame: frame,

      visibility: item.hidden === true ? false : true,
      render_visibility: item.hidden === true ? false : true,
      selection_state: selectionOf(project, item.id),
      lock_state: locks,

      // Cadence has no material or light entities at all. Not "none found" — the concept does not
      // exist in the scene model, so a lighting-related acceptance criterion (Part 68) cannot be
      // evaluated and must not be claimed.
      material_ids: null,
      light_relationships: null,

      effect_ids: effectIdsOf(item),
      animation_track_ids: Object.keys(tracks).map((n) => ids.trackId(item.id, n)),
      // Persisted locks covering this item (CON-005). Per-request constraints are not here on
      // purpose: they exist for the length of one patch and are not project state.
      constraint_ids: locks.constraints.map((c) => c.id),
      camera_relationships: cameraRelationshipsOf(project, item),
      dependency_ids: [], // filled in below, once every node exists
      tags: item.tags || [],
      lifecycle: item.attachedTo ? 'attached' : 'active',
      revision: contentHash(stripHeavy(item)),
    };

    if (item.kind === 'camera') {
      node.camera = {
        fov: tracks['@fov']?.keys?.length ? 'animated' : (item.fov ?? null),
        looked_through: project.__cameraView === item.id || null,
      };
    }
    if (item.rig) {
      node.rig_summary = {
        rig_type: item.rig.rigType || null,
        root_part: item.rig.rootPart || null,
        parts: (item.rig.parts || []).length,
        joints: (item.rig.joints || []).length,
      };
      if (includeRig) node.rig = rigGraph(project, item);
      if (worlds) {
        node.part_world_transforms = Object.fromEntries(
          (item.rig.parts || []).map((p) => [p.id, worlds.get(p.id) || null]),
        );
      }
    }
    if (includeTimeline) node.timeline = timelineGraph(project, item, { includeKeys });
    return node;
  });

  const nodeByItemId = new Map(nodes.map((n, i) => [items[i].id, n]));
  const edges = dependencyEdges(project, items, nodeByItemId);
  for (const e of edges) {
    const n = nodeByItemId.get(e.__sourceItem);
    if (n && !n.dependency_ids.includes(e.target)) n.dependency_ids.push(e.target);
  }
  for (const e of edges) delete e.__sourceItem;

  return {
    id: ids.projectId(project),
    name: project.name,
    frame,
    fps: project.fps || 30,
    length: project.length ?? null,
    objects: nodes,
    counts: {
      items: nodes.length,
      rigs: nodes.filter((n) => n.type === 'rig').length,
      cameras: nodes.filter((n) => n.type === 'camera').length,
      props: nodes.filter((n) => n.type === 'prop').length,
      effects: nodes.filter((n) => n.type === 'effect' || n.type === 'vfx').length,
    },
    dependency_graph: {
      edges,
      types_present: [...new Set(edges.map((e) => e.dependency_type))].sort(),
      types_absent: ABSENT_EDGE_TYPES,
    },
    semantics: {
      role_overrides: roles.listOverrides(project),
      annotation_count: countAnnotations(project),
      has_provenance: !!project.semantics?.provenance?.nodes?.length,
    },
    id_durability: { item: ids.idDurability('item'), part: ids.idDurability('part') },
    limitations: sceneLimitations(project, nodes),
    revision: contentHash({ items: (project.items || []).map(stripHeavy), tracks: project.tracks }),
  };
}

// ---------------------------------------------------------------- dependency edges (Part 66)

const ABSENT_EDGE_TYPES = [
  { type: 'material_dependency', reason: 'Cadence has no material entities' },
  { type: 'lighting_relationship', reason: 'Cadence has no light entities' },
  { type: 'cache_dependency', reason: 'no simulation cache exists on the animation side (the PNX solver has one, and it is not modelled here)' },
  { type: 'render_impact', reason: 'the observation layer can now MEASURE which objects changed on screen after an edit (Part 43/44), but that is a measurement, not a modelled edge — nothing derives statically that this property affects that region' },
  { type: 'export_dependency', reason: 'export is a whole-item bake; nothing tracks per-property export dependence' },
  { type: 'rig_constraint', reason: 'Cadence has no rig constraints beyond joints themselves' },
];

function edge(sourceItem, source, target, dependency_type, extra = {}) {
  return {
    __sourceItem: sourceItem,
    source,
    target,
    dependency_type,
    direction: 'source_affects_target',
    time_relationship: extra.time_relationship ?? 'same_frame',
    strength: extra.strength ?? 'strict',
    invalidation: extra.invalidation ?? 'recompute_target',
    validation_requirement: extra.validation_requirement ?? null,
    reason: extra.reason,
  };
}

function dependencyEdges(project, items, nodeByItemId) {
  const out = [];
  for (const item of items) {
    const itemEntity = ids.itemId(item);

    // structural hierarchy + transform inheritance, inside a rig
    for (const j of (item.rig?.joints || [])) {
      out.push(edge(item.id, ids.partId(item.id, j.part0), ids.partId(item.id, j.part1), 'transform_inheritance', {
        reason: `"${j.name}" places ${j.part1} relative to ${j.part0}`,
      }));
      if (j.kind !== 'weld') {
        out.push(edge(item.id, ids.trackId(item.id, j.name), ids.jointId(item.id, j), 'animation_binding', {
          reason: `track "${j.name}" drives that Motor6D's Transform`,
        }));
      }
    }

    // the item's own placement drives every part it owns
    if (item.rig) {
      out.push(edge(item.id, ids.trackId(item.id, '@origin'), ids.partId(item.id, item.rig.rootPart), 'transform_inheritance', {
        reason: 'the @origin track places the root part, and therefore the whole rig',
        strength: 'strict',
      }));
    }

    // attachment between items
    if (item.attachedTo) {
      const parent = nodeByItemId.get(item.attachedTo.itemId);
      out.push(edge(item.attachedTo.itemId, ids.partId(item.attachedTo.itemId, item.attachedTo.partId), itemEntity, 'attachment', {
        reason: `"${item.name}" is attached to that part${parent ? ` of "${parent.name}"` : ''}, so it inherits every motion of it`,
        validation_requirement: 'any edit to the parent part propagates to this item and to anything attached below it',
      }));
    }

    // an effect item placed on the animator timeline depends on its own start frame
    if (item.kind === 'effect') {
      out.push(edge(item.id, itemEntity, `effectdoc:${item.id}`, 'effect_binding', {
        reason: 'the effect document is evaluated relative to this item\'s effectStart',
        time_relationship: 'offset',
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------- small readers

function safeOrigin(project, item, frame) {
  try {
    return itemOriginAt(project, item, frame);
  } catch {
    // A corrupted attachment (a cycle the UI would not allow, but a hand-edited file can carry)
    // must not take the whole projection down — report the fallback rather than throwing.
    return item.origin || CF.IDENTITY.slice();
  }
}

function sourceAsset(item) {
  if (item.rig?.rigType) return { kind: 'builtin_rig', value: item.rig.rigType };
  if (item.studioId) return { kind: 'studio', value: item.studioId };
  if (item.className) return { kind: 'roblox_class', value: item.className };
  return null;
}

function selectionOf(project, itemId) {
  const sel = project.__selection;
  if (!sel) return null; // selection is session state, not project data — absent unless supplied
  return {
    item: sel.itemId === itemId,
    parts: (sel.parts || []).filter((p) => p.itemId === itemId).map((p) => p.partId),
  };
}

// Locks are ConstraintSpecs held at `project.semantics.locks.entries` and are ENFORCED as of
// Phase 2 (CON-005) — `ai/constraints.js` owns the shape, so reading it here rather than
// re-deriving it is what keeps the report and the enforcement from drifting apart.

function effectIdsOf(item) {
  if (item.kind === 'effect' && item.effect) return [`effectdoc:${item.id}`];
  if (item.kind === 'vfx') return [`emitter:${item.id}`];
  return [];
}

function cameraRelationshipsOf(project, item) {
  if (item.kind === 'camera') return [{ role: 'is_camera', target: ids.itemId(item) }];
  // Cadence has no camera targeting, look-at, or focus model. An empty list here is the true
  // answer for a non-camera item, not a placeholder.
  return [];
}

function countAnnotations(project) {
  const a = project?.semantics?.annotations || {};
  let n = 0;
  for (const perItem of Object.values(a)) for (const perTrack of Object.values(perItem)) n += Object.keys(perTrack).length;
  return n;
}

// Baked textures and mesh payloads are megabytes each and never affect the semantic identity of
// an item, so they are excluded from the revision hash. That keeps `revision` cheap and keeps a
// texture re-bake from reading as a semantic change.
function stripHeavy(item) {
  if (!item.rig?.parts) return item;
  return {
    ...item,
    rig: {
      ...item.rig,
      parts: item.rig.parts.map(({ customTexture, ...rest }) => rest),
      clothing: item.rig.clothing ? { shirt: !!item.rig.clothing.shirt, pants: !!item.rig.clothing.pants } : null,
    },
  };
}

function sceneLimitations(project, nodes) {
  const out = [
    'material_ids and light_relationships are null on every object: Cadence has no material or light entities, so lighting-related acceptance criteria (Part 68) cannot be evaluated at all',
    'camera_relationships only records that a camera is a camera — there is no look-at, focus or framing model yet (Part 40)',
    'selection_state is null unless the caller supplied live session state; selection is not project data',
  ];
  if (!nodes.some((n) => n.type === 'camera')) out.push('no camera exists in this project, so nothing screen-space (framing, staging, screen-space velocity) can be measured');
  if (project.__selection === undefined) out.push('this projection was taken from project data alone, so it is valid for a snapshot or a baseline as well as for the live scene');
  return out;
}

/**
 * Resolve any entity id produced by this layer back to the live data it names.
 * Returns `{ kind, item, part?, joint?, track?, key? }` or null.
 *
 * This is the inverse of the projection, and the reason the graphs can be used as an addressing
 * scheme rather than only as a report.
 */
export function resolveEntity(project, entityId) {
  const p = ids.parseId(entityId);
  if (!p) return null;
  const item = (project.items || []).find((i) => i.id === p.itemId) || null;
  if (p.type === 'project') return { kind: 'project', project };
  if (!item) return null;
  switch (p.type) {
    case 'item': return { kind: 'item', item };
    case 'part': {
      const part = (item.rig?.parts || []).find((q) => q.id === p.partId) || null;
      return part ? { kind: 'part', item, part } : null;
    }
    case 'joint': {
      const joint = (item.rig?.joints || []).find((j) => j.part0 === p.part0 && j.part1 === p.part1
        && ((j.kind === 'weld') === (p.kind === 'weld'))) || null;
      return joint ? { kind: 'joint', item, joint } : null;
    }
    case 'track': {
      const track = project.tracks?.[p.itemId]?.[p.track] || null;
      return track ? { kind: 'track', item, trackName: p.track, track } : null;
    }
    case 'key': {
      const track = project.tracks?.[p.itemId]?.[p.track] || null;
      const key = track ? (track.keys || []).find((k) => Math.abs(k.t - p.t) < 1e-6) : null;
      return key ? { kind: 'key', item, trackName: p.track, track, key } : null;
    }
    case 'marker': {
      const m = (project.markers?.[p.itemId] || []).find((x) => Math.abs(x.t - p.t) < 1e-6) || null;
      return m ? { kind: 'marker', item, marker: m } : null;
    }
    default: return null;
  }
}
