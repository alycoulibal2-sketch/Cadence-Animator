// The node-graph document: what the node editor edits, what compiles into an effectModel.js
// Effect document via graphCompiler.js. Pure data + pure helpers — no state.js, no window.*, no
// DOM — same discipline as effectModel.js, so it loads identically in the main window, the
// studio window, and the smoketest.
//
// Schema:
//   { version: 1, id, name, nodes: [Node], connections: [Connection], comments: [Comment] }
//   Node = { id, type, x, y, params: {...}, collapsed }
//   Connection = { id, fromNode, fromSocket, toNode, toSocket }
//   Comment = { id, x, y, w, h, text, color }
//
// One socket/connection kind exists in v1: 'flow' — the implicit particle/effect stream that
// chains Create -> Appearance/Motion/Physics/Timing -> Output nodes. Wiring individual node
// PARAMETERS from other nodes (real dataflow, Niagara-style) is future work; v1 node params are
// plain inspector-style values, never fed by a connection.

export const GRAPH_VERSION = 1;

const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);

// ---------------------------------------------------------------- node type registry
// def = { label, icon, category, inputs: [socketName...], outputs: [socketName...],
//   multiInput: false, params: [propMeta...], defaults(), compile(ctx, params) }.
// `params` reuses the exact propMeta shape (kind: number|range|color|select|check|vec3|text)
// effectModel.js's LAYER_TYPES/MODIFIER_TYPES already use, so inspector.js's existing per-kind
// field factory can render a node's param panel with no new widget code. `multiInput` is a
// per-NODE-TYPE flag (not per-socket) since every v1 node type has at most one input socket —
// only Output-category nodes set it, to accept one incoming chain per upstream Create node.
const nodeTypes = new Map();
export function registerNodeType(id, def) {
  nodeTypes.set(id, { id, inputs: [], outputs: [], params: [], multiInput: false, ...def });
}
export function getNodeType(id) {
  return nodeTypes.get(id) || null;
}
export function nodeTypeKeys() {
  return [...nodeTypes.keys()];
}
export function nodeTypesByCategory() {
  const out = {};
  for (const t of nodeTypes.values()) {
    if (!out[t.category]) out[t.category] = [];
    out[t.category].push(t);
  }
  return out;
}

// ---------------------------------------------------------------- construction
export function newGraph(name = 'Untitled Graph') {
  return { version: GRAPH_VERSION, id: uid(), name, nodes: [], connections: [], comments: [] };
}

export function newNode(type, x = 0, y = 0) {
  const meta = getNodeType(type);
  if (!meta) throw new Error(`unknown node type "${type}"`);
  return { id: uid(), type, x, y, params: meta.defaults ? meta.defaults() : {}, collapsed: false };
}

export function addNode(graph, node) {
  graph.nodes.push(node);
  return node;
}

export function getNode(graph, nodeId) {
  return graph.nodes.find((n) => n.id === nodeId) || null;
}

// Removing a node cascades: drops every connection touching it, so a graph can never end up
// referencing a dangling node id (same "op invariant, not something auto-fix mops up later"
// convention as effectModel.js's removeModifier cascading its orphaned curve keys).
export function removeNode(graph, nodeId) {
  const i = graph.nodes.findIndex((n) => n.id === nodeId);
  if (i < 0) return false;
  graph.nodes.splice(i, 1);
  graph.connections = graph.connections.filter((c) => c.fromNode !== nodeId && c.toNode !== nodeId);
  return true;
}

export function setNodeParams(node, patch) {
  Object.assign(node.params, patch);
}

// ---------------------------------------------------------------- connections
// DFS forward from `fromId` along existing connections — true if `toId` is reachable. Used to
// reject a new edge that would close a cycle: connecting a->b is only safe if b cannot already
// reach a.
function canReach(graph, fromId, toId) {
  const seen = new Set();
  const stack = [fromId];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === toId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const c of graph.connections) {
      if (c.fromNode === cur) stack.push(c.toNode);
    }
  }
  return false;
}

// Connects two sockets. Returns the new Connection, or null if the edge is invalid: a
// self-connection, an unknown socket, or one that would close a cycle (the compiler walks a DAG,
// never a simulator). A single-input socket (multiInput: false on the target node type) drops
// any existing edge into that socket first — connecting a new wire in replaces the old one,
// mirroring how dragging a real cable out of a socket and into another just works.
export function connect(graph, fromNode, fromSocket, toNode, toSocket) {
  if (fromNode === toNode) return null;
  const fromN = getNode(graph, fromNode), toN = getNode(graph, toNode);
  const fromMeta = fromN && getNodeType(fromN.type);
  const toMeta = toN && getNodeType(toN.type);
  if (!fromMeta || !toMeta) return null;
  if (!fromMeta.outputs.includes(fromSocket) || !toMeta.inputs.includes(toSocket)) return null;
  if (canReach(graph, toNode, fromNode)) return null; // would close a cycle
  if (!toMeta.multiInput) {
    graph.connections = graph.connections.filter((c) => !(c.toNode === toNode && c.toSocket === toSocket));
  }
  const conn = { id: uid(), fromNode, fromSocket, toNode, toSocket };
  graph.connections.push(conn);
  return conn;
}

export function disconnect(graph, connectionId) {
  const i = graph.connections.findIndex((c) => c.id === connectionId);
  if (i < 0) return false;
  graph.connections.splice(i, 1);
  return true;
}

// ---------------------------------------------------------------- comments
export function newComment(x = 0, y = 0, text = '') {
  return { id: uid(), x, y, w: 220, h: 120, text, color: '#3a3550' };
}
export function addComment(graph, comment) {
  graph.comments.push(comment);
  return comment;
}
export function removeComment(graph, commentId) {
  const i = graph.comments.findIndex((c) => c.id === commentId);
  if (i < 0) return false;
  graph.comments.splice(i, 1);
  return true;
}

// ---------------------------------------------------------------- serialization
export function serializeGraph(graph) {
  return JSON.stringify(graph, null, 2);
}

// Parse + normalize a graph doc from untrusted JSON (a saved graph, an MCP call). Unknown node
// types are rejected rather than silently dropped — same convention as effectModel.js's
// parseEffect rejecting unknown layer types: a graph referencing a type this build doesn't know
// is a graph this build cannot faithfully edit or compile. Dangling connections (referencing a
// node id that didn't parse) are dropped silently rather than failing the whole parse — the same
// best-effort leniency parseEffect gives malformed sketchOrigin-style metadata, since a
// connection is recoverable/re-creatable, unlike a node's own identity.
export function parseGraph(input) {
  let raw;
  try {
    raw = typeof input === 'string' ? JSON.parse(input) : structuredClone(input);
  } catch (e) {
    return { ok: false, error: `not valid JSON: ${e.message}` };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };
  if (!Array.isArray(raw.nodes)) return { ok: false, error: 'missing nodes array' };

  const graph = newGraph(typeof raw.name === 'string' ? raw.name : 'Untitled Graph');
  if (typeof raw.id === 'string') graph.id = raw.id;

  const seenIds = new Set();
  for (const rn of raw.nodes) {
    if (!rn || !getNodeType(rn.type)) return { ok: false, error: `unknown node type "${rn?.type}"` };
    const node = newNode(rn.type, Number.isFinite(rn.x) ? rn.x : 0, Number.isFinite(rn.y) ? rn.y : 0);
    if (typeof rn.id === 'string') node.id = rn.id;
    if (rn.params && typeof rn.params === 'object') Object.assign(node.params, rn.params);
    node.collapsed = !!rn.collapsed;
    graph.nodes.push(node);
    seenIds.add(node.id);
  }
  for (const rc of raw.connections || []) {
    if (!rc || !seenIds.has(rc.fromNode) || !seenIds.has(rc.toNode)) continue;
    graph.connections.push({
      id: typeof rc.id === 'string' ? rc.id : uid(),
      fromNode: rc.fromNode, fromSocket: rc.fromSocket, toNode: rc.toNode, toSocket: rc.toSocket,
    });
  }
  for (const rm of raw.comments || []) {
    if (!rm) continue;
    graph.comments.push({
      id: typeof rm.id === 'string' ? rm.id : uid(),
      x: Number.isFinite(rm.x) ? rm.x : 0, y: Number.isFinite(rm.y) ? rm.y : 0,
      w: Number.isFinite(rm.w) ? rm.w : 220, h: Number.isFinite(rm.h) ? rm.h : 120,
      text: typeof rm.text === 'string' ? rm.text : '',
      color: typeof rm.color === 'string' ? rm.color : '#3a3550',
    });
  }
  return { ok: true, graph };
}
