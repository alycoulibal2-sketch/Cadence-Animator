// PNX graph document: nodes, links, node groups, serialization, migration, and the structural
// queries the evaluator and the MCP layer both need (topological order, upstream/downstream sets,
// cycle detection).
//
// Schema:
//   { version, id, name,
//     nodes:    { [nodeId]: Node },
//     links:    { [linkId]: Link },
//     groups:   { [groupId]: GroupDef },
//     comments: [Comment],
//     meta:     {} }
//
//   Node  = { id, type, x, y, values:{socketKey:value}, label?, seed?,
//             scope,            // '' for the root graph, or a groupId — see below
//             muted?, bypassed?, collapsed? }
//   Link  = { id, fromNode, fromSocket, toNode, toSocket }
//   Group = { id, name, icon?, description?, version, inputs:[Socket], outputs:[Socket] }
//
// NESTING IS FLAT, DELIBERATELY. Every node lives in a single flat map and names its `scope`: the
// empty string for the root graph, or the id of the group whose interior it belongs to. A nested
// group is then just a group-instance node (`type: 'group:<id>'`) sitting inside another group's
// interior. The alternative — recursive per-group node lists — makes serialization, snapshot undo
// and MCP addressing all harder for no expressive gain, since arbitrary nesting depth already
// works.
//
// Nodes are a MAP not an array: link integrity checks and dirty propagation are both O(1) lookups
// against it, and a graph with thousands of nodes is an explicit design target (Part 53).

import { getNode as getNodeType, latestVersionOf } from './registry.js';
import { canConnect, containsGeneric, parseType, formatType } from './types.js';

export const GRAPH_FORMAT_VERSION = 1;
export const ROOT_SCOPE = '';

const uid = (prefix) => `${prefix}${(globalThis.crypto?.randomUUID
  ? crypto.randomUUID().slice(0, 8)
  : Math.random().toString(36).slice(2, 10))}`;

// Group instance types are spelled `group:<groupId>` so a single string field distinguishes them
// from registered node types without a second discriminator to keep in sync.
export const GROUP_TYPE_PREFIX = 'group:';
export const isGroupInstanceType = (type) => typeof type === 'string' && type.startsWith(GROUP_TYPE_PREFIX);
export const groupIdOfType = (type) => (isGroupInstanceType(type) ? type.slice(GROUP_TYPE_PREFIX.length) : null);

// The two built-in types that form a group's interior boundary. Their sockets are DYNAMIC —
// derived from the owning group's declared interface rather than fixed at registration — which is
// why they are resolved here instead of in the registry.
export const GROUP_INPUT_TYPE = 'cadence.group.input@1';
export const GROUP_OUTPUT_TYPE = 'cadence.group.output@1';
export const isGroupBoundaryType = (t) => t === GROUP_INPUT_TYPE || t === GROUP_OUTPUT_TYPE;

// ---------------------------------------------------------------- construction
export function newGraph(name = 'Untitled Graph') {
  return {
    version: GRAPH_FORMAT_VERSION,
    id: uid('g_'),
    name,
    nodes: {},
    links: {},
    groups: {},
    comments: [],
    meta: {},
  };
}

// Create a node. `type` may be a bare id ('cadence.math.add') — it is resolved to the newest
// registered version and STORED versioned, so a graph saved today keeps meaning the same thing
// after a node gains a version 2.
export function newNode(graph, type, x = 0, y = 0, { scope = ROOT_SCOPE, values = {}, id = null } = {}) {
  let storedType = type;
  if (!isGroupInstanceType(type) && !isGroupBoundaryType(type) && !type.includes('@')) {
    const v = latestVersionOf(type);
    if (v === null) throw new Error(`unknown node type "${type}"`);
    storedType = `${type}@${v}`;
  }
  if (isGroupInstanceType(type) && !graph.groups[groupIdOfType(type)]) {
    throw new Error(`unknown group "${groupIdOfType(type)}"`);
  }
  if (!isGroupInstanceType(storedType) && !isGroupBoundaryType(storedType) && !getNodeType(storedType)) {
    throw new Error(`unknown node type "${storedType}"`);
  }
  const node = {
    id: id || uid('n_'),
    type: storedType,
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    values: { ...values },
    scope,
  };
  graph.nodes[node.id] = node;
  return node;
}

export function getNode(graph, nodeId) {
  return graph.nodes[nodeId] || null;
}

// Removing a node cascades to every link touching it — a graph can never hold a dangling link.
// Same invariant the v1 graph model established and the effect model's removeModifier follows.
export function removeNode(graph, nodeId) {
  if (!graph.nodes[nodeId]) return false;
  delete graph.nodes[nodeId];
  for (const [lid, l] of Object.entries(graph.links)) {
    if (l.fromNode === nodeId || l.toNode === nodeId) delete graph.links[lid];
  }
  return true;
}

export function setNodeValue(graph, nodeId, socketKey, value) {
  const node = getNode(graph, nodeId);
  if (!node) return false;
  node.values[socketKey] = value;
  return true;
}

// ---------------------------------------------------------------- socket resolution
// The socket list for a node, resolving the two dynamic cases (group instances mirror their group
// definition; a group's interior boundary nodes mirror it inside-out — the group's declared INPUTS
// appear as the Group Input node's OUTPUTS, because that is the direction data flows once you are
// standing inside the group).
export function socketsOf(graph, node) {
  if (!node) return { inputs: [], outputs: [] };
  if (isGroupInstanceType(node.type)) {
    const g = graph.groups[groupIdOfType(node.type)];
    if (!g) return { inputs: [], outputs: [] };
    return { inputs: g.inputs.map(normalizeSocket), outputs: g.outputs.map(normalizeSocket) };
  }
  if (isGroupBoundaryType(node.type)) {
    const g = graph.groups[node.scope];
    if (!g) return { inputs: [], outputs: [] };
    return node.type === GROUP_INPUT_TYPE
      ? { inputs: [], outputs: g.inputs.map(normalizeSocket) }
      : { inputs: g.outputs.map(normalizeSocket), outputs: [] };
  }
  const def = getNodeType(node.type);
  return def ? { inputs: def.inputs, outputs: def.outputs } : { inputs: [], outputs: [] };
}

function normalizeSocket(s) {
  return { ...s, type: parseType(s.type) || parseType('any'), label: s.label || s.key };
}

export function findSocket(graph, node, key, dir) {
  const { inputs, outputs } = socketsOf(graph, node);
  return (dir === 'in' ? inputs : outputs).find((s) => s.key === key) || null;
}

// ---------------------------------------------------------------- links
// connect() returns { ok, link } or { ok:false, reason } — a REASON string, not a bare null, so
// the UI and MCP can both tell the user why a wire was refused instead of it just not appearing.
export function connect(graph, fromNode, fromSocket, toNode, toSocket) {
  if (fromNode === toNode) return { ok: false, reason: 'a node cannot connect to itself' };
  const a = getNode(graph, fromNode), b = getNode(graph, toNode);
  if (!a || !b) return { ok: false, reason: 'one of the nodes does not exist' };
  if (a.scope !== b.scope) return { ok: false, reason: 'nodes in different groups cannot be wired directly — use the group\'s inputs and outputs' };

  const outS = findSocket(graph, a, fromSocket, 'out');
  const inS = findSocket(graph, b, toSocket, 'in');
  if (!outS) return { ok: false, reason: `"${fromSocket}" is not an output of that node` };
  if (!inS) return { ok: false, reason: `"${toSocket}" is not an input of that node` };
  if (inS.socket === false) return { ok: false, reason: `"${inS.label}" is a mode setting, not something a wire can drive` };

  // Generic sockets defer to evaluation-time unification; concrete pairs are checked now. A wire
  // refused here is refused for a reason the user can act on; one that passes may still produce a
  // type diagnostic once generics resolve, which is the evaluator's job to report.
  if (!containsGeneric(outS.type) && !containsGeneric(inS.type) && !canConnect(outS.type, inS.type)) {
    return { ok: false, reason: `${formatType(outS.type)} does not fit into ${formatType(inS.type)}` };
  }

  if (wouldCycle(graph, fromNode, toNode)) return { ok: false, reason: 'that would create a loop' };

  // A single-input socket holds one wire: connecting a new one replaces the old, the way pulling a
  // cable out and plugging another in behaves physically.
  if (!inS.multi) {
    for (const [lid, l] of Object.entries(graph.links)) {
      if (l.toNode === toNode && l.toSocket === toSocket) delete graph.links[lid];
    }
  } else {
    // Even a multi-input refuses an exact duplicate — two identical wires are never meaningful.
    for (const l of Object.values(graph.links)) {
      if (l.toNode === toNode && l.toSocket === toSocket && l.fromNode === fromNode && l.fromSocket === fromSocket) {
        return { ok: false, reason: 'those sockets are already connected' };
      }
    }
  }

  const link = { id: uid('l_'), fromNode, fromSocket, toNode, toSocket };
  graph.links[link.id] = link;
  return { ok: true, link };
}

export function disconnect(graph, linkId) {
  if (!graph.links[linkId]) return false;
  delete graph.links[linkId];
  return true;
}

export function linksInto(graph, nodeId, socketKey = null) {
  return Object.values(graph.links).filter((l) => l.toNode === nodeId && (socketKey === null || l.toSocket === socketKey));
}

export function linksOutOf(graph, nodeId, socketKey = null) {
  return Object.values(graph.links).filter((l) => l.fromNode === nodeId && (socketKey === null || l.fromSocket === socketKey));
}

// ---------------------------------------------------------------- cycles and ordering
// Would adding from -> to close a cycle? True iff `to` can already reach `from`.
export function wouldCycle(graph, fromNode, toNode) {
  return reaches(graph, toNode, fromNode);
}

function reaches(graph, startId, targetId) {
  const seen = new Set();
  const stack = [startId];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === targetId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const l of Object.values(graph.links)) if (l.fromNode === cur) stack.push(l.toNode);
  }
  return false;
}

// Every node that feeds `nodeId`, transitively. Used for evaluation, and exposed over MCP so a
// caller can reason about a graph without downloading and re-deriving the whole thing (Part 60).
export function upstreamOf(graph, nodeId) {
  const out = new Set();
  const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop();
    for (const l of Object.values(graph.links)) {
      if (l.toNode !== cur || out.has(l.fromNode)) continue;
      out.add(l.fromNode);
      stack.push(l.fromNode);
    }
  }
  return out;
}

export function downstreamOf(graph, nodeId) {
  const out = new Set();
  const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop();
    for (const l of Object.values(graph.links)) {
      if (l.fromNode !== cur || out.has(l.toNode)) continue;
      out.add(l.toNode);
      stack.push(l.toNode);
    }
  }
  return out;
}

// Kahn's algorithm over one scope. Returns { ok, order } or { ok:false, cycle:[nodeIds] } — the
// actual node ids in the cycle, so a diagnostic can point at them instead of saying "there is a
// loop somewhere". Cycles are impossible through connect(), but a hand-written or MCP-supplied
// graph can contain one, and it must be reported rather than hang the evaluator.
export function topoOrder(graph, scope = ROOT_SCOPE) {
  const nodes = Object.values(graph.nodes).filter((n) => n.scope === scope);
  const ids = new Set(nodes.map((n) => n.id));
  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  const edges = [];
  for (const l of Object.values(graph.links)) {
    if (!ids.has(l.fromNode) || !ids.has(l.toNode)) continue;
    edges.push(l);
    indegree.set(l.toNode, indegree.get(l.toNode) + 1);
  }
  // Sort the ready set by id so the order is deterministic across runs — evaluation order must
  // never be able to affect a result, but a stable order also makes profiling output comparable
  // between runs, which matters when hunting a regression.
  const ready = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id).sort();
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    const newlyReady = [];
    for (const l of edges) {
      if (l.fromNode !== id) continue;
      const d = indegree.get(l.toNode) - 1;
      indegree.set(l.toNode, d);
      if (d === 0) newlyReady.push(l.toNode);
    }
    newlyReady.sort();
    ready.push(...newlyReady);
  }
  if (order.length !== nodes.length) {
    const cycle = nodes.map((n) => n.id).filter((id) => !order.includes(id));
    return { ok: false, cycle, order };
  }
  return { ok: true, order };
}

// ---------------------------------------------------------------- node groups (Part 46)
export function newGroupDef(graph, name = 'Group', { inputs = [], outputs = [], icon = null, description = '' } = {}) {
  const g = {
    id: uid('grp_'),
    name, icon, description,
    version: 1,
    inputs: inputs.map((s) => ({ ...s, type: formatType(parseType(s.type) || parseType('float')) })),
    outputs: outputs.map((s) => ({ ...s, type: formatType(parseType(s.type) || parseType('float')) })),
  };
  graph.groups[g.id] = g;
  // A group's interior always has its boundary nodes, so entering a brand-new group is never a
  // blank canvas with no way back out to its own interface.
  newNode(graph, GROUP_INPUT_TYPE, -260, 0, { scope: g.id });
  newNode(graph, GROUP_OUTPUT_TYPE, 260, 0, { scope: g.id });
  return g;
}

// Would making `innerGroupId` a member of `outerGroupId`'s interior create infinite recursion?
// Group A containing group B containing group A has no finite expansion and must be refused at the
// moment of nesting, not discovered as a stack overflow during evaluation.
export function wouldRecurse(graph, outerGroupId, innerGroupId) {
  if (outerGroupId === innerGroupId) return true;
  const stack = [innerGroupId];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === outerGroupId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const n of Object.values(graph.nodes)) {
      if (n.scope === cur && isGroupInstanceType(n.type)) stack.push(groupIdOfType(n.type));
    }
  }
  return false;
}

export function removeGroupDef(graph, groupId) {
  if (!graph.groups[groupId]) return false;
  for (const n of Object.values(graph.nodes)) {
    if (n.scope === groupId || (isGroupInstanceType(n.type) && groupIdOfType(n.type) === groupId)) {
      removeNode(graph, n.id);
    }
  }
  delete graph.groups[groupId];
  return true;
}

export function nodesInScope(graph, scope) {
  return Object.values(graph.nodes).filter((n) => n.scope === scope);
}

// ---------------------------------------------------------------- comments (Part 70)
export function addComment(graph, x = 0, y = 0, text = '', { scope = ROOT_SCOPE, w = 240, h = 140, color = '#3a3550' } = {}) {
  const c = { id: uid('c_'), x, y, w, h, text, color, scope };
  graph.comments.push(c);
  return c;
}

export function removeComment(graph, commentId) {
  const i = graph.comments.findIndex((c) => c.id === commentId);
  if (i < 0) return false;
  graph.comments.splice(i, 1);
  return true;
}

// ---------------------------------------------------------------- serialization + migration
export function serializeGraph(graph) {
  return JSON.stringify(graph, null, 2);
}

// Parse a graph from untrusted JSON. Returns { ok, graph, warnings } or { ok:false, error }.
//
// Failure policy, matching the effect model's established convention: a node whose TYPE this build
// does not know is a hard failure (the graph cannot be faithfully edited or evaluated, and
// silently dropping it would silently change the effect). Everything recoverable — a dangling
// link, an unknown socket, a stale group reference — is dropped with a warning, because those are
// re-creatable and refusing the whole file over one of them would lose real work.
export function parseGraph(input) {
  let raw;
  try {
    raw = typeof input === 'string' ? JSON.parse(input) : structuredClone(input);
  } catch (e) {
    return { ok: false, error: `not valid JSON: ${e.message}` };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };
  if (!raw.nodes || typeof raw.nodes !== 'object') return { ok: false, error: 'missing nodes' };

  const warnings = [];
  const graph = newGraph(typeof raw.name === 'string' ? raw.name : 'Untitled Graph');
  if (typeof raw.id === 'string') graph.id = raw.id;
  if (raw.meta && typeof raw.meta === 'object') graph.meta = raw.meta;

  // Groups first: a node may name one as its scope or its type.
  for (const [gid, rg] of Object.entries(raw.groups || {})) {
    if (!rg || typeof rg !== 'object') continue;
    graph.groups[gid] = {
      id: gid,
      name: typeof rg.name === 'string' ? rg.name : 'Group',
      icon: rg.icon || null,
      description: typeof rg.description === 'string' ? rg.description : '',
      version: Number.isInteger(rg.version) ? rg.version : 1,
      inputs: (Array.isArray(rg.inputs) ? rg.inputs : []).filter((s) => s && s.key).map((s) => ({
        key: s.key, label: s.label || s.key,
        type: formatType(parseType(s.type) || parseType('float')),
        ...(s.default !== undefined ? { default: s.default } : {}),
        ...(s.multi ? { multi: true } : {}),
      })),
      outputs: (Array.isArray(rg.outputs) ? rg.outputs : []).filter((s) => s && s.key).map((s) => ({
        key: s.key, label: s.label || s.key,
        type: formatType(parseType(s.type) || parseType('float')),
      })),
    };
  }

  const nodeEntries = Array.isArray(raw.nodes) ? raw.nodes.map((n) => [n?.id, n]) : Object.entries(raw.nodes);
  for (const [nid, rn] of nodeEntries) {
    if (!rn || typeof rn !== 'object' || typeof rn.type !== 'string') {
      return { ok: false, error: `node "${nid}" is malformed` };
    }
    const scope = typeof rn.scope === 'string' ? rn.scope : ROOT_SCOPE;
    if (scope !== ROOT_SCOPE && !graph.groups[scope]) {
      warnings.push(`node "${nid}" referenced missing group "${scope}" — moved to the top level`);
    }
    const resolved = resolveStoredType(graph, rn.type);
    if (!resolved.ok) return { ok: false, error: `node "${nid}": ${resolved.error}` };

    const node = {
      id: typeof nid === 'string' ? nid : uid('n_'),
      type: resolved.type,
      x: Number.isFinite(rn.x) ? rn.x : 0,
      y: Number.isFinite(rn.y) ? rn.y : 0,
      values: rn.values && typeof rn.values === 'object' ? { ...rn.values } : {},
      scope: graph.groups[scope] ? scope : ROOT_SCOPE,
    };
    if (typeof rn.label === 'string') node.label = rn.label;
    if (Number.isFinite(rn.seed)) node.seed = rn.seed;
    if (rn.muted) node.muted = true;
    if (rn.bypassed) node.bypassed = true;
    if (rn.collapsed) node.collapsed = true;

    // Per-node-type migration: a def may declare migrate[targetVersion](node) to bring an older
    // serialized node forward. Run in ascending order so a v1 -> v3 jump applies both steps.
    const def = getNodeType(node.type);
    if (def && resolved.fromVersion !== null && resolved.fromVersion < def.version && def.migrate) {
      for (let v = resolved.fromVersion + 1; v <= def.version; v++) {
        if (typeof def.migrate[v] === 'function') {
          try {
            def.migrate[v](node);
          } catch (e) {
            warnings.push(`migrating "${nid}" to version ${v} failed: ${e.message}`);
          }
        }
      }
    }
    graph.nodes[node.id] = node;
  }

  const linkEntries = Array.isArray(raw.links) ? raw.links.map((l) => [l?.id, l]) : Object.entries(raw.links || {});
  for (const [lid, rl] of linkEntries) {
    if (!rl || !graph.nodes[rl.fromNode] || !graph.nodes[rl.toNode]) {
      warnings.push(`dropped a link referencing a node that is not in this graph`);
      continue;
    }
    const from = graph.nodes[rl.fromNode], to = graph.nodes[rl.toNode];
    if (from.scope !== to.scope) {
      warnings.push(`dropped a link crossing a group boundary (${rl.fromNode} -> ${rl.toNode})`);
      continue;
    }
    if (!findSocket(graph, from, rl.fromSocket, 'out') || !findSocket(graph, to, rl.toSocket, 'in')) {
      warnings.push(`dropped a link to a socket that no longer exists (${rl.fromSocket} -> ${rl.toSocket})`);
      continue;
    }
    const id = typeof lid === 'string' ? lid : uid('l_');
    graph.links[id] = { id, fromNode: rl.fromNode, fromSocket: rl.fromSocket, toNode: rl.toNode, toSocket: rl.toSocket };
  }

  for (const rc of raw.comments || []) {
    if (!rc) continue;
    graph.comments.push({
      id: typeof rc.id === 'string' ? rc.id : uid('c_'),
      x: Number.isFinite(rc.x) ? rc.x : 0, y: Number.isFinite(rc.y) ? rc.y : 0,
      w: Number.isFinite(rc.w) ? rc.w : 240, h: Number.isFinite(rc.h) ? rc.h : 140,
      text: typeof rc.text === 'string' ? rc.text : '',
      color: typeof rc.color === 'string' ? rc.color : '#3a3550',
      scope: typeof rc.scope === 'string' && graph.groups[rc.scope] ? rc.scope : ROOT_SCOPE,
    });
  }

  // A cycle in loaded data is reported, not repaired: which link to cut is a decision only the
  // author can make, and guessing would silently change their effect.
  for (const scope of [ROOT_SCOPE, ...Object.keys(graph.groups)]) {
    const t = topoOrder(graph, scope);
    if (!t.ok) warnings.push(`the ${scope === ROOT_SCOPE ? 'top level' : `group "${graph.groups[scope]?.name}"`} contains a loop through ${t.cycle.length} node(s) — it will not evaluate until a link is removed`);
  }

  return { ok: true, graph, warnings };
}

// Resolve a serialized type string against this build. An unversioned id resolves to the newest
// version (tolerating hand-written graphs); a versioned id resolves exactly, falling FORWARD to a
// newer version when the exact one is gone, since migrations exist precisely to make that safe.
function resolveStoredType(graph, type) {
  if (isGroupInstanceType(type)) {
    return graph.groups[groupIdOfType(type)]
      ? { ok: true, type, fromVersion: null }
      : { ok: false, error: `references unknown group "${groupIdOfType(type)}"` };
  }
  if (isGroupBoundaryType(type)) return { ok: true, type, fromVersion: null };
  const def = getNodeType(type);
  if (def) {
    // Always store the EXACT versioned id, even when the file gave an unversioned one. A node
    // carrying a bare `cadence.math.add` would silently change meaning the day add@2 is registered;
    // pinning it at load time means an old project keeps evaluating the way it did when it was saved,
    // and a later migration has a concrete version to migrate FROM.
    const at = type.indexOf('@');
    return { ok: true, type: def.fullId, fromVersion: at < 0 ? null : Number(type.slice(at + 1)) };
  }
  const at = type.indexOf('@');
  const baseId = at < 0 ? type : type.slice(0, at);
  const newest = latestVersionOf(baseId);
  if (newest === null) return { ok: false, error: `unknown node type "${type}"` };
  return { ok: true, type: `${baseId}@${newest}`, fromVersion: at < 0 ? null : Number(type.slice(at + 1)) };
}

// ---------------------------------------------------------------- structural summary
// A compact overview for MCP get-graph responses and diagnostics: enough to reason about the graph
// without transferring every inline value.
export function graphSummary(graph) {
  const byScope = {};
  for (const n of Object.values(graph.nodes)) {
    const key = n.scope || 'root';
    (byScope[key] || (byScope[key] = [])).push(n);
  }
  return {
    id: graph.id,
    name: graph.name,
    version: graph.version,
    nodeCount: Object.keys(graph.nodes).length,
    linkCount: Object.keys(graph.links).length,
    groups: Object.values(graph.groups).map((g) => ({
      id: g.id, name: g.name, version: g.version,
      inputs: g.inputs.map((s) => `${s.key}:${s.type}`),
      outputs: g.outputs.map((s) => `${s.key}:${s.type}`),
      nodeCount: (byScope[g.id] || []).length,
    })),
    scopes: Object.fromEntries(Object.entries(byScope).map(([k, ns]) => [k, ns.map((n) => ({
      id: n.id, type: n.type, label: n.label || null, x: n.x, y: n.y,
      ...(n.muted ? { muted: true } : {}),
      ...(n.bypassed ? { bypassed: true } : {}),
    }))])),
    links: Object.values(graph.links).map((l) => ({
      id: l.id, from: `${l.fromNode}.${l.fromSocket}`, to: `${l.toNode}.${l.toSocket}`,
    })),
  };
}
