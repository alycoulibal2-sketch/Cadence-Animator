// Node groups: collapse, expand, and the import/export of reusable subgraphs (spec Part 46).
//
// PART 46 CALLS THIS ESSENTIAL, and the example it gives is the whole design:
//
//   [complex 80-node vortex implementation]   ->   [Vortex Motion]  with Strength / Radius / Speed / Noise
//
// plus one requirement that shapes everything here: "Users can enter the group and inspect every node.
// NO BLACK BOXES." So a group is not a new kind of node with hidden behaviour — it is a scope containing
// ordinary nodes, and its instance evaluates by running that scope (see evaluator.js's group frames).
// Nothing in this file compiles, flattens or specialises anything; collapsing is a bookkeeping operation
// on a graph document.
//
// COLLAPSE IS THE HARD PART, and the difficulty is entirely in the boundary. Given a set of nodes to
// enclose, the links fall into four cases:
//
//   inside  -> inside    unchanged; they move with the nodes
//   outside -> inside    becomes a group INPUT: the external source feeds the instance, and the interior
//                        reads it from the Group Input node
//   inside  -> outside   becomes a group OUTPUT
//   outside -> outside   untouched
//
// Two subtleties that are easy to get wrong and are handled explicitly below:
//
//   Several external sources feeding DIFFERENT internal sockets need one input each — but the same
//   external source feeding several internal sockets needs only ONE input, shared. Keying by the
//   external source rather than by the internal target is what gets that right, and getting it backwards
//   produces a group with four identical inputs where one belongs.
//
//   An internal output feeding several external targets needs one output, not one per target. Keying by
//   the internal source is the mirror of the same rule.

import { formatType, parseType } from './types.js';
import {
  ROOT_SCOPE, GROUP_INPUT_TYPE, GROUP_OUTPUT_TYPE, groupInstanceType,
  newGroupDef, newNode, connect, socketsOf, nodesInScope, removeNode,
  isGroupInstanceType, groupIdOfType, wouldRecurse,
} from './graph.js';
import { getNode as getNodeType } from './registry.js';

// The type a socket carries, as a string. Falls back to `any` rather than throwing: a graph loaded from
// a newer build can contain a socket this one does not know, and refusing to group around it would be a
// worse outcome than grouping it as untyped.
function socketTypeOf(graph, nodeId, socketKey, direction) {
  const node = graph.nodes[nodeId];
  if (!node) return 'any';
  const { inputs, outputs } = socketsOf(graph, node);
  const list = direction === 'in' ? inputs : outputs;
  const s = list.find((x) => x.key === socketKey);
  return s ? formatType(s.type) : 'any';
}

// A label for a generated boundary socket. Uses the node's own label and the socket's, because
// `strength` alone is meaningless on a group with three of them.
function boundaryLabel(graph, nodeId, socketKey, direction) {
  const node = graph.nodes[nodeId];
  const def = node ? getNodeType(node.type) : null;
  const { inputs, outputs } = node ? socketsOf(graph, node) : { inputs: [], outputs: [] };
  const s = (direction === 'in' ? inputs : outputs).find((x) => x.key === socketKey);
  const nodeName = node?.label || def?.label || 'Node';
  return s ? `${nodeName} ${s.label}` : `${nodeName} ${socketKey}`;
}

// ---------------------------------------------------------------- collapse
// Returns { ok, groupId, instanceId, inputs, outputs } or { ok: false, reason }.
export function collapseToGroup(graph, nodeIds, { name = 'Group', description = '' } = {}) {
  const ids = [...new Set(nodeIds)].filter((id) => graph.nodes[id]);
  if (!ids.length) return { ok: false, reason: 'nothing was selected' };

  // Every node must be in the same scope: a group spanning two scopes has no meaning, and allowing it
  // would silently pull nodes out of another group.
  const scope = graph.nodes[ids[0]].scope;
  if (ids.some((id) => graph.nodes[id].scope !== scope)) {
    return { ok: false, reason: 'all the selected nodes must be in the same group' };
  }
  // Boundary nodes belong to their scope and cannot be enclosed — a group whose interior contained
  // another group's input node would have two conflicting notions of "the boundary".
  if (ids.some((id) => graph.nodes[id].type === GROUP_INPUT_TYPE || graph.nodes[id].type === GROUP_OUTPUT_TYPE)) {
    return { ok: false, reason: 'a group\'s own input and output nodes cannot be put inside another group' };
  }

  const inside = new Set(ids);
  const links = Object.values(graph.links);

  // --- classify the boundary
  // Keyed by the EXTERNAL source, so one external value feeding several internal sockets becomes one
  // shared input rather than several identical ones.
  const inputMap = new Map();   // 'fromNode.fromSocket' -> { key, label, type, targets: [{node, socket}] }
  const outputMap = new Map();  // 'fromNode.fromSocket' -> { key, label, type, targets: [{node, socket}] }

  for (const l of links) {
    const fromIn = inside.has(l.fromNode);
    const toIn = inside.has(l.toNode);
    if (fromIn === toIn) continue;   // wholly inside or wholly outside

    if (!fromIn && toIn) {
      const k = `${l.fromNode}.${l.fromSocket}`;
      if (!inputMap.has(k)) {
        inputMap.set(k, {
          key: `in${inputMap.size + 1}`,
          label: boundaryLabel(graph, l.toNode, l.toSocket, 'in'),
          type: socketTypeOf(graph, l.toNode, l.toSocket, 'in'),
          source: { node: l.fromNode, socket: l.fromSocket },
          targets: [],
        });
      }
      inputMap.get(k).targets.push({ node: l.toNode, socket: l.toSocket });
    } else {
      const k = `${l.fromNode}.${l.fromSocket}`;
      if (!outputMap.has(k)) {
        outputMap.set(k, {
          key: `out${outputMap.size + 1}`,
          label: boundaryLabel(graph, l.fromNode, l.fromSocket, 'out'),
          type: socketTypeOf(graph, l.fromNode, l.fromSocket, 'out'),
          source: { node: l.fromNode, socket: l.fromSocket },
          targets: [],
        });
      }
      outputMap.get(k).targets.push({ node: l.toNode, socket: l.toSocket });
    }
  }

  // --- create the group and move the nodes in
  const group = newGroupDef(graph, name, {
    description,
    inputs: [...inputMap.values()].map((e) => ({ key: e.key, label: e.label, type: e.type })),
    outputs: [...outputMap.values()].map((e) => ({ key: e.key, label: e.label, type: e.type })),
  });

  // The instance goes where the selection was — at the centre of it, so the graph does not visibly
  // rearrange itself around the collapse.
  const cx = ids.reduce((s, id) => s + graph.nodes[id].x, 0) / ids.length;
  const cy = ids.reduce((s, id) => s + graph.nodes[id].y, 0) / ids.length;
  const instance = newNode(graph, groupInstanceType(group.id), cx, cy, { scope });

  for (const id of ids) graph.nodes[id].scope = group.id;

  // Lay the moved nodes out relative to their own centre, so the interior opens looking like what was
  // collapsed rather than like a pile at the origin.
  for (const id of ids) {
    graph.nodes[id].x -= cx;
    graph.nodes[id].y -= cy;
  }

  const gIn = nodesInScope(graph, group.id).find((n) => n.type === GROUP_INPUT_TYPE);
  const gOut = nodesInScope(graph, group.id).find((n) => n.type === GROUP_OUTPUT_TYPE);
  if (gIn) { gIn.x = Math.min(0, ...ids.map((id) => graph.nodes[id].x)) - 240; gIn.y = 0; }
  if (gOut) { gOut.x = Math.max(0, ...ids.map((id) => graph.nodes[id].x)) + 240; gOut.y = 0; }

  // --- rewire the boundary
  // Delete the crossing links first: they now reference nodes in two different scopes, which connect()
  // rightly refuses, and leaving them would make the graph unloadable.
  for (const [lid, l] of Object.entries(graph.links)) {
    const fromIn = inside.has(l.fromNode), toIn = inside.has(l.toNode);
    if (fromIn !== toIn) delete graph.links[lid];
  }

  for (const e of inputMap.values()) {
    connect(graph, e.source.node, e.source.socket, instance.id, e.key);
    for (const t of e.targets) connect(graph, gIn.id, e.key, t.node, t.socket);
  }
  for (const e of outputMap.values()) {
    connect(graph, e.source.node, e.source.socket, gOut.id, e.key);
    for (const t of e.targets) connect(graph, instance.id, e.key, t.node, t.socket);
  }

  return {
    ok: true,
    groupId: group.id,
    instanceId: instance.id,
    inputs: group.inputs.map((s) => s.key),
    outputs: group.outputs.map((s) => s.key),
    enclosed: ids.length,
  };
}

// ---------------------------------------------------------------- expand
// The inverse: dissolve an instance and put its interior back in the parent scope. Needed because a
// group is an editing convenience, and being unable to undo the grouping would make it a commitment.
export function expandGroup(graph, instanceId) {
  const instance = graph.nodes[instanceId];
  if (!instance || !isGroupInstanceType(instance.type)) return { ok: false, reason: 'that is not a group instance' };
  const groupId = groupIdOfType(instance.type);
  const group = graph.groups[groupId];
  if (!group) return { ok: false, reason: 'the group this refers to no longer exists' };

  // Every instance of the group has to keep working, so expanding one COPIES the interior rather than
  // moving it. Moving it would empty the group and break every other instance — which is the sort of
  // thing that only shows up once someone has used the same group twice.
  const interior = nodesInScope(graph, groupId);
  const idMap = new Map();
  const targetScope = instance.scope;

  for (const n of interior) {
    if (n.type === GROUP_INPUT_TYPE || n.type === GROUP_OUTPUT_TYPE) continue;
    const copy = newNode(graph, n.type, instance.x + n.x, instance.y + n.y, {
      scope: targetScope,
      values: structuredClone(n.values || {}),
    });
    if (n.label) copy.label = n.label;
    if (n.muted) copy.muted = true;
    if (n.bypassed) copy.bypassed = true;
    if (Number.isFinite(n.seed)) copy.seed = n.seed;
    idMap.set(n.id, copy.id);
  }

  const gIn = interior.find((n) => n.type === GROUP_INPUT_TYPE);
  const gOut = interior.find((n) => n.type === GROUP_OUTPUT_TYPE);

  // Interior links become links between the copies.
  for (const l of Object.values(graph.links)) {
    const from = graph.nodes[l.fromNode], to = graph.nodes[l.toNode];
    if (!from || !to || from.scope !== groupId || to.scope !== groupId) continue;
    const a = idMap.get(l.fromNode), b = idMap.get(l.toNode);
    if (a && b) connect(graph, a, l.fromSocket, b, l.toSocket);
  }

  // What fed the instance's inputs now feeds whatever the Group Input node fed.
  for (const l of Object.values(graph.links)) {
    if (l.toNode !== instanceId) continue;
    if (!gIn) continue;
    for (const inner of Object.values(graph.links)) {
      if (inner.fromNode !== gIn.id || inner.fromSocket !== l.toSocket) continue;
      const target = idMap.get(inner.toNode);
      if (target) connect(graph, l.fromNode, l.fromSocket, target, inner.toSocket);
    }
  }
  // ...and whatever the Group Output node was fed now feeds what the instance fed.
  for (const l of Object.values(graph.links)) {
    if (l.fromNode !== instanceId) continue;
    if (!gOut) continue;
    for (const inner of Object.values(graph.links)) {
      if (inner.toNode !== gOut.id || inner.toSocket !== l.fromSocket) continue;
      const source = idMap.get(inner.fromNode);
      if (source) connect(graph, source, inner.fromSocket, l.toNode, l.toSocket);
    }
  }

  removeNode(graph, instanceId);
  return { ok: true, expanded: idMap.size, groupId };
}

// ---------------------------------------------------------------- import / export (Part 46)
// A group as a portable document. Deliberately self-contained: it carries its nested groups too, so a
// group exported from one project drops into another without dangling references — which is the only
// version of "sharing" that is actually usable.
export function exportGroup(graph, groupId) {
  const group = graph.groups[groupId];
  if (!group) return null;

  const collected = {};
  const nodes = {};
  const links = {};

  const walk = (gid) => {
    if (collected[gid]) return;
    const g = graph.groups[gid];
    if (!g) return;
    collected[gid] = structuredClone(g);
    for (const n of nodesInScope(graph, gid)) {
      nodes[n.id] = structuredClone(n);
      if (isGroupInstanceType(n.type)) walk(groupIdOfType(n.type));
    }
  };
  walk(groupId);

  for (const [lid, l] of Object.entries(graph.links)) {
    const from = graph.nodes[l.fromNode], to = graph.nodes[l.toNode];
    if (from && to && nodes[l.fromNode] && nodes[l.toNode]) links[lid] = structuredClone(l);
  }

  return {
    cadenceNodeGroup: 1,
    rootGroup: groupId,
    name: group.name,
    description: group.description || '',
    icon: group.icon || null,
    groups: collected,
    nodes,
    links,
  };
}

// Bring an exported group into a graph. Ids are REMAPPED rather than reused, because importing the same
// group twice — or importing into a graph that happens to share an id — must not collide.
export function importGroup(graph, payload, { name = null } = {}) {
  if (!payload || payload.cadenceNodeGroup !== 1) return { ok: false, reason: 'that is not an exported node group' };

  const groupIdMap = new Map();
  for (const gid of Object.keys(payload.groups || {})) {
    const src = payload.groups[gid];
    const created = newGroupDef(graph, gid === payload.rootGroup ? (name || src.name) : src.name, {
      description: src.description || '',
      icon: src.icon || null,
      inputs: src.inputs || [],
      outputs: src.outputs || [],
    });
    groupIdMap.set(gid, created.id);
  }

  // The boundary nodes newGroupDef just made are the ones to keep; the payload's own copies are
  // discarded and their links redirected, or the interior would end up with two input nodes.
  const nodeIdMap = new Map();
  const boundaryOf = new Map();  // newGroupId -> { input, output }
  for (const [oldGid, newGid] of groupIdMap) {
    const made = nodesInScope(graph, newGid);
    boundaryOf.set(newGid, {
      input: made.find((n) => n.type === GROUP_INPUT_TYPE),
      output: made.find((n) => n.type === GROUP_OUTPUT_TYPE),
    });
  }

  for (const [oldId, n] of Object.entries(payload.nodes || {})) {
    const newScope = groupIdMap.get(n.scope);
    if (!newScope) continue;
    if (n.type === GROUP_INPUT_TYPE) { nodeIdMap.set(oldId, boundaryOf.get(newScope).input?.id); continue; }
    if (n.type === GROUP_OUTPUT_TYPE) { nodeIdMap.set(oldId, boundaryOf.get(newScope).output?.id); continue; }

    // A nested group instance's type has to be rewritten to the newly-created group's id.
    let type = n.type;
    if (isGroupInstanceType(type)) {
      const inner = groupIdMap.get(groupIdOfType(type));
      if (!inner) continue;
      type = groupInstanceType(inner);
    }
    if (!isGroupInstanceType(type) && !getNodeType(type)) {
      return { ok: false, reason: `this group needs the node type "${type}", which this build does not have` };
    }
    const copy = newNode(graph, type, n.x || 0, n.y || 0, { scope: newScope, values: structuredClone(n.values || {}) });
    if (n.label) copy.label = n.label;
    if (n.muted) copy.muted = true;
    if (n.bypassed) copy.bypassed = true;
    nodeIdMap.set(oldId, copy.id);
  }

  for (const l of Object.values(payload.links || {})) {
    const a = nodeIdMap.get(l.fromNode), b = nodeIdMap.get(l.toNode);
    if (a && b) connect(graph, a, l.fromSocket, b, l.toSocket);
  }

  const rootId = groupIdMap.get(payload.rootGroup);
  return { ok: true, groupId: rootId, name: graph.groups[rootId]?.name, nodes: nodeIdMap.size };
}

// Place an instance of an existing group. The recursion check is what stops a group containing itself,
// which would make evaluation infinite.
export function instantiateGroup(graph, groupId, x = 0, y = 0, { scope = ROOT_SCOPE } = {}) {
  if (!graph.groups[groupId]) return { ok: false, reason: 'no such group' };
  if (scope !== ROOT_SCOPE && wouldRecurse(graph, scope, groupId)) {
    return { ok: false, reason: 'that would make the group contain itself' };
  }
  const node = newNode(graph, groupInstanceType(groupId), x, y, { scope });
  return { ok: true, nodeId: node.id };
}
