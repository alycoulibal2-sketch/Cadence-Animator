// Pure helpers behind the procedural node editor (build plan phase 7): the box geometry the canvas
// draws with, a layered auto-layout, directional keyboard navigation, and "which socket on this node
// type fits the wire I am holding". No DOM in here, on purpose — pnxNodeEditor.js and pnxMcp.js call
// these, and test/pnxtest.mjs proves them without a window.

import * as PGRAPH from './graph.js';
import { getNode as getNodeType } from './registry.js';
import * as T from './types.js';

// ---------------------------------------------------------------- box geometry
// Wide enough for the longest input label the registry actually uses alongside its control. Measured,
// not guessed: at 210px "Particle limit", "Flipbook columns" and "Initial attributes" all ellipsised
// to "Particle …", which makes two different sockets look like the same one.
export const NODE_W = 268;
// Every socket dot is positioned from this, so it must equal the header's real rendered height or
// each dot sits a few pixels off its own row. The canvas gives the header this height explicitly
// rather than inheriting .node-box-header's, so the two cannot drift apart.
export const HEADER_H = 28;
export const ROW_H = 22;
export const SOCKET_R = 5;
// The preview strip: a 44px canvas plus its 4+2px margins and 1px borders (.pnx-preview).
export const PREVIEW_H = 52;
// .pnx-node's padding-bottom plus the box border.
const BOX_PAD = 6;

// A node's rows in the order they are drawn: outputs above inputs, so wires leave the right edge near
// the top and arrive at the left edge below.
export function rowsOf(graph, node) {
  const { inputs, outputs } = PGRAPH.socketsOf(graph, node);
  const rows = [];
  for (const s of outputs) rows.push({ io: 'out', socket: s });
  for (const s of inputs) rows.push({ io: 'in', socket: s });
  return rows;
}

export function boxHeight(graph, node) {
  const def = getNodeType(node.type);
  const preview = def?.preview && !node.collapsed ? PREVIEW_H : 0;
  return HEADER_H + rowsOf(graph, node).length * ROW_H + preview + BOX_PAD;
}

export function boxSize(graph, node) {
  return { w: NODE_W, h: boxHeight(graph, node) };
}

// ---------------------------------------------------------------- auto-layout
// A layered left-to-right layout: a node's column is its depth (the longest chain of wires from any
// source), rows inside a column are ordered by the average row of what feeds them and packed with the
// node's REAL height, so nothing overlaps. A chain with one input per node stays on one horizontal
// line, which is what makes the result readable rather than merely non-overlapping.
//
// One scope at a time: a group's interior is laid out in its own coordinate space, exactly as the
// editor shows it, and never mixed with the root's nodes.
export function autoLayout(graph, scope = PGRAPH.ROOT_SCOPE, { gapX = 90, gapY = 28, originX = null, originY = null } = {}) {
  const nodes = PGRAPH.nodesInScope(graph, scope);
  const positions = new Map();
  if (!nodes.length) return { positions, columns: 0, moved: 0 };

  const ids = new Set(nodes.map((n) => n.id));
  const links = Object.values(graph.links).filter((l) => ids.has(l.fromNode) && ids.has(l.toNode));
  const indeg = new Map(), outs = new Map(), ins = new Map();
  for (const n of nodes) { indeg.set(n.id, 0); outs.set(n.id, []); ins.set(n.id, []); }
  for (const l of links) {
    indeg.set(l.toNode, indeg.get(l.toNode) + 1);
    outs.get(l.fromNode).push(l.toNode);
    ins.get(l.toNode).push(l.fromNode);
  }

  // Longest-path depth by Kahn's algorithm. connect() refuses loops, so every node is reached; if a
  // loaded document somehow carries one, the nodes it traps go in a final column rather than vanishing.
  const depth = new Map();
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id).sort();
  for (const id of queue) depth.set(id, 0);
  const seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    seen.add(id);
    for (const t of outs.get(id)) {
      depth.set(t, Math.max(depth.get(t) ?? 0, depth.get(id) + 1));
      indeg.set(t, indeg.get(t) - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  for (const n of nodes) if (!seen.has(n.id)) depth.set(n.id, maxDepth + 1);

  const cols = [];
  for (const n of nodes) { const d = depth.get(n.id); (cols[d] || (cols[d] = [])).push(n); }

  // Keep the graph where it was: the layout's top-left is the current bounding box's top-left.
  const x0 = originX ?? Math.min(...nodes.map((n) => n.x));
  const y0 = originY ?? Math.min(...nodes.map((n) => n.y));
  const centre = new Map(); // id -> centre y once placed
  let x = 0, columns = 0;
  for (const col of cols) {
    if (!col || !col.length) continue;
    columns++;
    const bary = (n) => {
      const srcs = ins.get(n.id).filter((s) => centre.has(s));
      return srcs.length ? srcs.reduce((a, s) => a + centre.get(s), 0) / srcs.length : null;
    };
    // Order by the barycentre of the inputs (fewer crossings); sources keep their current order.
    // Ties break on the old position and then the id, so the same graph always lays out the same way.
    col.sort((a, b) => {
      const ba = bary(a), bb = bary(b);
      if (ba !== null && bb !== null && ba !== bb) return ba - bb;
      if ((ba === null) !== (bb === null)) return ba === null ? 1 : -1;
      return a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
    });
    // The first node of a column sits exactly at its barycentre — above the origin if need be, the
    // whole layout is normalised below — so a straight chain stays straight; the rest pack under it.
    let y = -Infinity;
    for (const n of col) {
      const h = boxHeight(graph, n);
      const want = bary(n);
      if (want !== null) y = Math.max(y, want - h / 2);
      else if (y === -Infinity) y = 0;
      positions.set(n.id, { x, y });
      centre.set(n.id, y + h / 2);
      y += h + gapY;
    }
    x += NODE_W + gapX;
  }
  let top = Infinity;
  for (const p of positions.values()) top = Math.min(top, p.y);
  for (const p of positions.values()) { p.x = Math.round(p.x + x0); p.y = Math.round(p.y - top + y0); }

  let moved = 0;
  for (const n of nodes) { const p = positions.get(n.id); if (p && (p.x !== n.x || p.y !== n.y)) moved++; }
  return { positions, columns, moved };
}

// Write the layout into the graph. Position is presentation, so callers wrap this in a layout-only
// mutation (no evaluator invalidation) exactly as a drag is.
export function applyAutoLayout(graph, scope = PGRAPH.ROOT_SCOPE, opts = {}) {
  const res = autoLayout(graph, scope, opts);
  for (const [id, p] of res.positions) { const n = graph.nodes[id]; if (n) { n.x = p.x; n.y = p.y; } }
  return { scope, moved: res.moved, columns: res.columns, positions: [...res.positions].map(([nodeId, p]) => ({ nodeId, x: p.x, y: p.y })) };
}

// Every scope: the root and each group's interior, each in its own space.
export function applyAutoLayoutAll(graph, opts = {}) {
  const scopes = [PGRAPH.ROOT_SCOPE, ...Object.keys(graph.groups || {})];
  const parts = scopes.map((s) => applyAutoLayout(graph, s, opts));
  return {
    scopes: parts.length,
    moved: parts.reduce((a, p) => a + p.moved, 0),
    columns: Math.max(0, ...parts.map((p) => p.columns)),
    positions: parts.flatMap((p) => p.positions),
  };
}

// Do any two boxes in a scope overlap? What the tests (and a status line) ask after a layout.
export function overlappingPairs(graph, scope = PGRAPH.ROOT_SCOPE) {
  const nodes = PGRAPH.nodesInScope(graph, scope);
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const ah = boxHeight(graph, a), bh = boxHeight(graph, b);
      if (a.x < b.x + NODE_W && b.x < a.x + NODE_W && a.y < b.y + bh && b.y < a.y + ah) out.push([a.id, b.id]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- keyboard navigation
// The nearest node in a direction from `from`, judged by box centres. Nodes inside a 90° cone ahead
// score by distance with a mild penalty for sideways offset; nodes outside the cone pay a heavy one,
// so the node straight ahead wins over a closer one off to the side, and a lone node far off-axis is
// still reachable when nothing is ahead.
export function nearestInDirection(nodes, from, dir, sizeOf) {
  const vec = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir];
  if (!vec) return null;
  const centreOf = (n) => { const s = sizeOf(n); return [n.x + s.w / 2, n.y + s.h / 2]; };
  const [fx, fy] = centreOf(from);
  let best = null, bestScore = Infinity;
  for (const n of nodes) {
    if (n.id === from.id) continue;
    const [x, y] = centreOf(n);
    const dx = x - fx, dy = y - fy;
    const along = dx * vec[0] + dy * vec[1];
    if (along <= 1) continue;
    const across = Math.abs(dx * vec[1] - dy * vec[0]);
    const score = along + across * (across > along ? 6 : 1.5);
    if (score < bestScore) { bestScore = score; best = n; }
  }
  return best;
}

// ---------------------------------------------------------------- socket fit
// Given a wire held from a socket of direction `heldIo` and type `heldType`, the best socket on node
// type `def` it could land on: an identical type first, then anything the type system will convert,
// then a generic whose declared kinds admit it. Uses the same rule connect() applies, so a type the
// palette offers is one the wire will actually accept.
export function fittingSocket(def, heldIo, heldType) {
  if (!def) return null;
  const list = (heldIo === 'out' ? def.inputs : def.outputs) || [];
  const held = T.parseType(heldType) || heldType;
  let best = null, bestRank = 0;
  for (const s of list) {
    if (s.socket === false) continue;
    const st = T.parseType(s.type) || s.type;
    const a = heldIo === 'out' ? held : st;
    const b = heldIo === 'out' ? st : held;
    let rank = 0;
    if (T.sameType(a, b)) rank = 3;
    else if (!T.containsGeneric(a) && !T.containsGeneric(b) && T.canConnect(a, b)) rank = 2;
    else if ((T.containsGeneric(a) || T.containsGeneric(b)) && genericAdmits(def, st, held)) rank = 1;
    if (rank > bestRank) { bestRank = rank; best = s; }
  }
  return best ? { key: best.key, label: best.label || best.key, rank: bestRank } : null;
}

// A generic socket declares which kinds its variable may take (`generics.T.kinds`); a wire whose
// base type is outside that list would only produce a type diagnostic after connecting, so it is not
// offered. A generic without a kinds list admits anything.
function genericAdmits(def, socketType, heldType) {
  const variable = firstGeneric(socketType);
  if (!variable) return true;
  const kinds = def.generics?.[variable.name]?.kinds;
  if (!Array.isArray(kinds) || !kinds.length) return true;
  let base = T.parseType(heldType) || heldType;
  while (base && (base.name === 'field' || base.name === 'array') && base.param) base = base.param;
  return !!base && kinds.includes(base.name);
}

function firstGeneric(t) {
  const r = T.parseType(t) || t;
  if (!r) return null;
  if (T.isGeneric(r)) return r;
  return r.param ? firstGeneric(r.param) : null;
}
