// The node canvas: a near-fullscreen modal (same technique the deleted SKETCH IT workspace used
// — override a generic .modal via `.modal:has(.node-editor)` in styles.css — never a change to
// the main window layout). Hand-rolled interactive canvas, same convention as clipTimeline.js/
// curveEditor.js (raw pointerdown/move/up, geometry computed from data + constants, never DOM
// measurement) but node BODIES are real DOM elements — nodes need real inputs/dropdowns/color
// pickers, which only DOM gives for free. Wires draw on a single SVG overlay.
//
// v1 scope (docs/vfx-studio.md): pan, zoom, node drag, select + rubber-band multi-select,
// connect/disconnect, delete, copy/paste, comments, undo/redo (via studioState's existing
// mutateGraph/undo — one coherent history shared with the rest of the studio), context menu,
// search. NOT built yet, deliberately: node grouping/frames, keyboard-shortcut customization,
// node presets, wiring individual node PARAMETERS together (only the 'flow' chain wires).

import * as ST from './studioState.js';
import { modal, showContextMenu, toast } from '../../renderer/js/ui.js';
import {
  newNode, addNode, removeNode, connect, disconnect, getNode,
  newComment, addComment, removeComment,
  nodeTypeKeys, nodeTypesByCategory, getNodeType,
} from '../../renderer/js/nodeGraphModel.js';
import '../../renderer/js/nodeTypes.js'; // side effect: registers the v1 node catalog

const NODE_W = 190;
const HEADER_H = 30;
const SOCKET_HIT_R = 14;

let isOpen = false;
export function isNodeEditorOpen() { return isOpen; }

// ---------------------------------------------------------------- view state (local to this
// editor instance, never serialized/undoable — same "solo/expanded are view state" convention
// studioState.js already uses for the layer stack).
let panX = 80, panY = 80, zoom = 1;
const selectedNodes = new Set();
const selectedConns = new Set();
const selectedComments = new Set();
let clipboard = null;

let root, viewportEl, worldEl, wiresEl, nodesEl, commentsEl, rubberEl, toolbarErrEl;
let closeModal = null;

function el(tag, className, text) {
  const d = document.createElement(tag);
  if (className) d.className = className;
  if (text !== undefined) d.textContent = text;
  return d;
}

// ---------------------------------------------------------------- coordinate math
// Cached for the duration of a single gesture (set at pointerdown, cleared at pointerup) — calling
// getBoundingClientRect() fresh on every rAF-batched move tick would force a synchronous layout
// flush if anything else queued a style change that frame (classic layout-thrashing), and the
// viewport's own box never changes mid-gesture anyway.
let cachedViewportRect = null;
function screenToWorld(clientX, clientY) {
  const r = cachedViewportRect || viewportEl.getBoundingClientRect();
  return { x: (clientX - r.left - panX) / zoom, y: (clientY - r.top - panY) / zoom };
}
function applyTransform() {
  worldEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
}
function socketPos(node, io) { // io: 'in' | 'out'
  return { x: node.x + (io === 'in' ? 0 : NODE_W), y: node.y + HEADER_H / 2 };
}

// ---------------------------------------------------------------- frame-batched pointer motion
// Every drag/pan below writes to the DOM only from inside this single rAF callback, using the
// LATEST pointermove event seen — not from the raw pointermove handler directly. Raw pointer
// event rate can exceed the display's paint rate (especially on high-poll-rate mice/trackpads);
// without this, every extra event beyond what can actually be painted is pure wasted layout/paint
// work, which is what "not smooth" concretely means here. Panning/zoom already only touch a CSS
// transform (compositor-only, cheap) but are batched too for consistency — one motion pipeline,
// not a special case per gesture.
let pendingMoveEvent = null, moveFrameScheduled = false;
function requestMoveFrame(e) {
  pendingMoveEvent = e;
  if (moveFrameScheduled) return;
  moveFrameScheduled = true;
  requestAnimationFrame(() => {
    moveFrameScheduled = false;
    const ev = pendingMoveEvent;
    pendingMoveEvent = null;
    if (!ev) return;
    if (panDrag) onPanMove(ev);
    else if (rubberDrag) onRubberMove(ev);
    else if (nodeDrag) onNodeDragMove(ev);
    else if (socketDrag) onSocketDragMove(ev);
    else if (commentDrag) onCommentDragMove(ev);
    else if (commentResize) onCommentResizeMove(ev);
  });
}

// ---------------------------------------------------------------- open/close
export function openNodeEditor() {
  if (isOpen) { root.focus(); return; }
  if (!ST.state.graph) {
    toast('This effect wasn’t made with the node editor — start a new one from the blank-state screen to use it.', 'error');
    return;
  }
  isOpen = true;
  selectedNodes.clear(); selectedConns.clear(); selectedComments.clear();

  root = el('div', 'node-editor');
  root.tabIndex = -1;

  const toolbar = el('div', 'node-editor-toolbar');
  toolbar.appendChild(el('span', 'node-editor-title', '🔗 Node Editor'));
  const addBtn = el('button', 'tb-btn', '＋ Add node');
  addBtn.addEventListener('click', (e) => { e.stopPropagation(); openAddMenu(addBtn.getBoundingClientRect().left, addBtn.getBoundingClientRect().bottom + 4); });
  toolbar.appendChild(addBtn);
  const search = el('input', 'fld node-editor-search');
  search.type = 'text';
  search.placeholder = 'Search nodes… (Enter to add)';
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = search.value.trim().toLowerCase();
    if (!q) return;
    const match = nodeTypeKeys().map(getNodeType).find((t) => t.label.toLowerCase().includes(q));
    if (match) { addNodeAt(match.id, viewportCenterWorld()); search.value = ''; }
  });
  toolbar.appendChild(search);
  toolbarErrEl = el('span', 'node-editor-errors');
  toolbar.appendChild(toolbarErrEl);
  const closeBtn = el('button', 'tb-btn', '✕ Close');
  closeBtn.addEventListener('click', () => closeModal?.());
  toolbar.appendChild(closeBtn);
  root.appendChild(toolbar);

  viewportEl = el('div', 'node-editor-viewport');
  worldEl = el('div', 'node-editor-world');
  wiresEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wiresEl.setAttribute('class', 'node-editor-wires');
  nodesEl = el('div', 'node-editor-nodes');
  commentsEl = el('div', 'node-editor-comments');
  worldEl.append(wiresEl, commentsEl, nodesEl);
  rubberEl = el('div', 'node-editor-rubberband');
  viewportEl.append(worldEl, rubberEl);
  root.appendChild(viewportEl);

  wireViewportEvents();
  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('contextmenu', onCanvasContextMenu);

  const onDocChange = () => render();
  ST.on('effect', onDocChange);

  const m = modal({
    title: '', body: root,
    onClose: () => {
      isOpen = false;
      ST.off('effect', onDocChange);
    },
  });
  closeModal = m.close;
  applyTransform();
  render();
  requestAnimationFrame(() => root.focus());
}

function viewportCenterWorld() {
  const r = viewportEl.getBoundingClientRect();
  return screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
}

function addNodeAt(type, pos) {
  const node = newNode(type, Math.round(pos.x - NODE_W / 2), Math.round(pos.y - HEADER_H / 2));
  ST.mutateGraph((g) => addNode(g, node));
  selectedNodes.clear(); selectedNodes.add(node.id); selectedConns.clear(); selectedComments.clear();
  render();
}

function openAddMenu(x, y, atWorld) {
  const target = atWorld || viewportCenterWorld();
  const byCat = nodeTypesByCategory();
  const items = Object.keys(byCat).map((cat) => ({
    label: cat,
    children: byCat[cat].map((t) => ({ label: t.label, run: () => addNodeAt(t.id, target) })),
  }));
  showContextMenu(x, y, items);
}

function onCanvasContextMenu(e) {
  e.preventDefault();
  if (e.target === viewportEl || e.target === worldEl) {
    openAddMenu(e.clientX, e.clientY, screenToWorld(e.clientX, e.clientY));
  }
}

// ---------------------------------------------------------------- render
function render() {
  const graph = ST.state.graph;
  if (!graph) return;
  nodesEl.innerHTML = '';
  commentsEl.innerHTML = '';
  for (const node of graph.nodes) nodesEl.appendChild(buildNodeEl(node));
  for (const comment of graph.comments) commentsEl.appendChild(buildCommentEl(comment));
  renderWires(graph);
  toolbarErrEl.textContent = ST.state.graphErrors.length ? `⚠ ${ST.state.graphErrors[0]}` : '';
  toolbarErrEl.title = ST.state.graphErrors.join('\n');
}

function renderWires(graph) {
  wiresEl.innerHTML = '';
  for (const conn of graph.connections) {
    const from = getNode(graph, conn.fromNode), to = getNode(graph, conn.toNode);
    if (!from || !to) continue;
    const path = document.createElementNS(wiresEl.namespaceURI, 'path');
    path.dataset.connId = conn.id;
    path.setAttribute('d', wirePathD(from, to));
    path.setAttribute('class', 'node-wire' + (selectedConns.has(conn.id) ? ' selected' : ''));
    path.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (!e.shiftKey) { selectedNodes.clear(); selectedConns.clear(); selectedComments.clear(); }
      selectedConns.add(conn.id);
      render();
    });
    wiresEl.appendChild(path);
  }
}

function buildNodeEl(node) {
  const meta = getNodeType(node.type);
  const box = el('div', 'node-box' + (selectedNodes.has(node.id) ? ' selected' : ''));
  box.dataset.nodeId = node.id;
  box.style.left = node.x + 'px';
  box.style.top = node.y + 'px';
  box.style.width = NODE_W + 'px';

  const header = el('div', 'node-box-header');
  header.appendChild(el('span', 'node-box-title', `${meta.icon} ${meta.label.replace(/^\S+\s/, '')}`));
  const collapseBtn = el('span', 'node-box-collapse', node.collapsed ? '▸' : '▾');
  collapseBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    ST.mutateGraph((g) => { getNode(g, node.id).collapsed = !getNode(g, node.id).collapsed; });
  });
  header.appendChild(collapseBtn);
  header.addEventListener('pointerdown', (e) => onNodeHeaderDown(e, node));
  box.appendChild(header);

  if (meta.inputs.length) box.appendChild(buildSocketDot('in', node));
  if (meta.outputs.length) box.appendChild(buildSocketDot('out', node));

  if (!node.collapsed) {
    const body = el('div', 'node-box-body');
    for (const pm of meta.params) body.appendChild(nodeParamField(node, pm));
    box.appendChild(body);
  }
  return box;
}

function buildSocketDot(io, node) {
  const dot = el('div', `node-socket node-socket-${io}`);
  dot.addEventListener('pointerdown', (e) => { e.stopPropagation(); onSocketDown(e, node, io); });
  return dot;
}

function buildCommentEl(comment) {
  const box = el('div', 'node-comment' + (selectedComments.has(comment.id) ? ' selected' : ''));
  box.dataset.commentId = comment.id;
  box.style.left = comment.x + 'px';
  box.style.top = comment.y + 'px';
  box.style.width = comment.w + 'px';
  box.style.height = comment.h + 'px';
  box.style.background = comment.color;
  const text = el('div', 'node-comment-text');
  text.contentEditable = 'plaintext-only';
  text.textContent = comment.text;
  text.addEventListener('pointerdown', (e) => e.stopPropagation());
  text.addEventListener('blur', () => {
    ST.mutateGraph((g) => { const c = g.comments.find((x) => x.id === comment.id); if (c) c.text = text.textContent; });
  });
  box.appendChild(text);
  box.addEventListener('pointerdown', (e) => { if (e.target === box) onCommentDown(e, comment); });
  const resize = el('div', 'node-comment-resize');
  resize.addEventListener('pointerdown', (e) => onCommentResizeDown(e, comment));
  box.appendChild(resize);
  return box;
}

// ---------------------------------------------------------------- node param fields
// A small per-kind field factory for node params — same kinds/CSS conventions as inspector.js's
// per-prop editors, but reading/writing node.params via ST.mutateGraph instead of layer.props via
// ST.mutate, so it can't be the exact same function (inspector.js's is hardwired to a layer id).
function nodeParamField(node, pm) {
  const row = el('div', 'node-param-row');
  row.appendChild(el('span', 'l', pm.label));
  const commit = (v) => ST.mutateGraph((g) => { getNode(g, node.id).params[pm.key] = v; });
  let input;
  switch (pm.kind) {
    case 'color':
      input = el('input', 'fld'); input.type = 'color'; input.value = node.params[pm.key] || '#ffffff';
      input.addEventListener('change', () => commit(input.value));
      break;
    case 'select':
      input = el('select', 'fld');
      for (const o of pm.options) input.add(new Option(o, o));
      input.value = node.params[pm.key];
      input.addEventListener('change', () => commit(input.value));
      break;
    case 'check':
      input = el('input'); input.type = 'checkbox'; input.checked = !!node.params[pm.key];
      input.addEventListener('change', () => commit(input.checked));
      break;
    case 'vec3': {
      const triple = el('div', 'node-vec3');
      const v = node.params[pm.key] || [0, 0, 0];
      ['x', 'y', 'z'].forEach((axis, i) => {
        const n = el('input', 'fld'); n.type = 'number'; n.step = 0.1; n.value = v[i] ?? 0; n.title = axis;
        n.addEventListener('pointerdown', (e) => e.stopPropagation());
        n.addEventListener('change', () => { const cur = [...(node.params[pm.key] || [0, 0, 0])]; cur[i] = parseFloat(n.value) || 0; commit(cur); });
        triple.appendChild(n);
      });
      row.appendChild(triple);
      return row;
    }
    default: // number, range, text
      input = el('input', 'fld');
      input.type = pm.kind === 'text' ? 'text' : 'number';
      if (pm.step) input.step = pm.step;
      if (typeof pm.min === 'number') input.min = pm.min;
      if (typeof pm.max === 'number') input.max = pm.max;
      input.value = node.params[pm.key];
      input.addEventListener('change', () => commit(pm.kind === 'text' ? input.value : (parseFloat(input.value) || 0)));
  }
  input.addEventListener('pointerdown', (e) => e.stopPropagation()); // never starts a node drag
  row.appendChild(input);
  return row;
}

// ---------------------------------------------------------------- pan / zoom / rubber-band
let panDrag = null, rubberDrag = null;
function wireViewportEvents() {
  viewportEl.addEventListener('pointerdown', (e) => {
    if (e.target !== viewportEl && e.target !== worldEl) return; // a node/socket/wire handled its own
    root.focus();
    cachedViewportRect = viewportEl.getBoundingClientRect();
    if (e.shiftKey) {
      rubberDrag = { startX: e.clientX, startY: e.clientY };
      rubberEl.style.display = 'block';
    } else {
      if (!e.shiftKey) { selectedNodes.clear(); selectedConns.clear(); selectedComments.clear(); render(); }
      panDrag = { startX: e.clientX, startY: e.clientY, panX0: panX, panY0: panY };
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (!isOpen) return;
    if (panDrag || rubberDrag || nodeDrag || socketDrag || commentDrag || commentResize) requestMoveFrame(e);
  });
  window.addEventListener('pointerup', (e) => {
    if (panDrag) panDrag = null;
    if (rubberDrag) { finishRubberBand(rubberDrag.rect); rubberDrag = null; rubberEl.style.display = 'none'; }
    if (nodeDrag) finishNodeDrag();
    if (socketDrag) finishSocketDrag(e);
    if (commentDrag) finishCommentDrag();
    if (commentResize) finishCommentResize();
    cachedViewportRect = null;
  });
  viewportEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const before = screenToWorld(e.clientX, e.clientY);
    zoom = Math.max(0.2, Math.min(2.5, zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    const r = viewportEl.getBoundingClientRect();
    panX = e.clientX - r.left - before.x * zoom;
    panY = e.clientY - r.top - before.y * zoom;
    applyTransform();
  }, { passive: false });
}

function onPanMove(e) {
  panX = panDrag.panX0 + (e.clientX - panDrag.startX);
  panY = panDrag.panY0 + (e.clientY - panDrag.startY);
  applyTransform();
}
function onRubberMove(e) {
  const x = Math.min(rubberDrag.startX, e.clientX), y = Math.min(rubberDrag.startY, e.clientY);
  const w = Math.abs(e.clientX - rubberDrag.startX), h = Math.abs(e.clientY - rubberDrag.startY);
  const r = cachedViewportRect || viewportEl.getBoundingClientRect();
  rubberEl.style.left = (x - r.left) + 'px'; rubberEl.style.top = (y - r.top) + 'px';
  rubberEl.style.width = w + 'px'; rubberEl.style.height = h + 'px';
  rubberDrag.rect = { x, y, w, h };
}
function finishRubberBand(rect) {
  if (!rect || (rect.w < 3 && rect.h < 3)) return;
  const a = screenToWorld(rect.x, rect.y), b = screenToWorld(rect.x + rect.w, rect.y + rect.h);
  for (const node of ST.state.graph.nodes) {
    if (node.x + NODE_W >= a.x && node.x <= b.x && node.y + HEADER_H >= a.y && node.y <= b.y) selectedNodes.add(node.id);
  }
  render();
}

// ---------------------------------------------------------------- node drag
// Live drag visuals move nodes via CSS `transform` (GPU-composited, no layout/reflow) rather than
// `left`/`top` (which forces a synchronous layout on every write) — the single biggest
// smoothness win available here. The commit at drag-end writes the real `left`/`top` via the
// data model, once; the very next render() rebuilds fresh divs with no leftover transform.
let nodeDrag = null; // { startWorld, starts: Map<id,{x,y}>, dx, dy }
function onNodeHeaderDown(e, node) {
  e.stopPropagation();
  root.focus();
  cachedViewportRect = viewportEl.getBoundingClientRect();
  if (e.shiftKey) {
    if (selectedNodes.has(node.id)) selectedNodes.delete(node.id); else selectedNodes.add(node.id);
  } else if (!selectedNodes.has(node.id)) {
    selectedNodes.clear(); selectedNodes.add(node.id);
  }
  selectedConns.clear(); selectedComments.clear();
  const starts = new Map();
  for (const id of selectedNodes) { const n = getNode(ST.state.graph, id); if (n) starts.set(id, { x: n.x, y: n.y }); }
  nodeDrag = { startWorld: screenToWorld(e.clientX, e.clientY), starts, dx: 0, dy: 0 };
  render();
}
function nodeDivFor(id) { return nodesEl.querySelector(`[data-node-id="${id}"]`); }
function onNodeDragMove(e) {
  const now = screenToWorld(e.clientX, e.clientY);
  nodeDrag.dx = now.x - nodeDrag.startWorld.x;
  nodeDrag.dy = now.y - nodeDrag.startWorld.y;
  for (const [id] of nodeDrag.starts) {
    const div = nodeDivFor(id);
    if (div) div.style.transform = `translate(${nodeDrag.dx}px, ${nodeDrag.dy}px)`;
  }
  updateWireGeometry();
}
function finishNodeDrag() {
  const d = nodeDrag; nodeDrag = null;
  if (!d) return;
  ST.mutateGraph((g) => {
    for (const [id, start] of d.starts) {
      const n = getNode(g, id);
      if (n) { n.x = Math.round(start.x + d.dx); n.y = Math.round(start.y + d.dy); }
    }
  });
}

// A node position or comment position/size never affects the compiled doc, so live-dragging
// never goes through mutateGraph() (which would recompile the whole graph every frame for a
// property the compiler doesn't even read) — wires update in place against these live positions
// instead of state.graph's (not-yet-committed) ones.
function liveNodePos(id) {
  if (nodeDrag && nodeDrag.starts.has(id)) {
    const s = nodeDrag.starts.get(id);
    return { x: s.x + nodeDrag.dx, y: s.y + nodeDrag.dy };
  }
  const n = getNode(ST.state.graph, id);
  return n ? { x: n.x, y: n.y } : null;
}
function wirePathD(fromPos, toPos) {
  const a = { x: fromPos.x + NODE_W, y: fromPos.y + HEADER_H / 2 }, b = { x: toPos.x, y: toPos.y + HEADER_H / 2 };
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}
// Updates EXISTING <path> elements' `d` attribute in place — never clears/rebuilds the SVG.
// Recreating every wire element on every pointermove (the original implementation) meant DOM
// churn on top of layout cost; an attribute update on an already-composited path is cheap.
function updateWireGeometry() {
  const graph = ST.state.graph;
  for (const path of wiresEl.querySelectorAll('path.node-wire')) {
    const conn = graph.connections.find((c) => c.id === path.dataset.connId);
    if (!conn) continue;
    const from = liveNodePos(conn.fromNode), to = liveNodePos(conn.toNode);
    if (from && to) path.setAttribute('d', wirePathD(from, to));
  }
}

// ---------------------------------------------------------------- connect (socket drag)
let socketDrag = null;
function onSocketDown(e, node, io) {
  root.focus();
  cachedViewportRect = viewportEl.getBoundingClientRect();
  selectedNodes.clear(); selectedConns.clear(); selectedComments.clear();
  socketDrag = { fromNode: node.id, io, start: socketPos(node, io) };
  render();
}
function onSocketDragMove(e) {
  const cursor = screenToWorld(e.clientX, e.clientY);
  const a = socketDrag.start;
  let path = wiresEl.querySelector('.node-wire-temp');
  if (!path) { path = document.createElementNS(wiresEl.namespaceURI, 'path'); path.setAttribute('class', 'node-wire node-wire-temp'); wiresEl.appendChild(path); }
  const dx = Math.max(40, Math.abs(cursor.x - a.x) * 0.5);
  const from = socketDrag.io === 'out' ? a : cursor, to = socketDrag.io === 'out' ? cursor : a;
  path.setAttribute('d', `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`);
}
function finishSocketDrag(e) {
  const d = socketDrag; socketDrag = null;
  wiresEl.querySelector('.node-wire-temp')?.remove();
  const cursorWorld = screenToWorld(e.clientX, e.clientY);
  const graph = ST.state.graph;
  let best = null, bestDist = SOCKET_HIT_R;
  for (const node of graph.nodes) {
    if (node.id === d.fromNode) continue;
    const meta = getNodeType(node.type);
    const wantIo = d.io === 'out' ? 'in' : 'out';
    const sockets = wantIo === 'in' ? meta.inputs : meta.outputs;
    if (!sockets.length) continue;
    const pos = socketPos(node, wantIo);
    const dist = Math.hypot(pos.x - cursorWorld.x, pos.y - cursorWorld.y);
    if (dist < bestDist) { bestDist = dist; best = { node, socket: sockets[0] }; }
  }
  if (!best) { render(); return; }
  const fromNode = d.io === 'out' ? d.fromNode : best.node.id;
  const fromSocket = d.io === 'out' ? getNodeType(getNode(graph, d.fromNode).type).outputs[0] : best.socket;
  const toNode = d.io === 'out' ? best.node.id : d.fromNode;
  const toSocket = d.io === 'out' ? best.socket : getNodeType(getNode(graph, d.fromNode).type).inputs[0];
  ST.mutateGraph((g) => {
    const made = connect(g, fromNode, fromSocket, toNode, toSocket);
    if (!made) toast('Could not connect — that would create a cycle or an invalid link', 'error');
  });
  render();
}

// ---------------------------------------------------------------- comments
// Same "visual-only during the drag, one committed mutateGraph at release" pattern as node
// drag — position/size don't affect the compiled doc, so there's no reason to recompile on
// every pointermove tick. Dragging moves via `transform` (no layout) same as node drag; resizing
// genuinely changes width/height (content reflow is inherent to a real resize, transform/scale
// would just distort the text) so it keeps direct style writes, still frame-batched.
function commentDivFor(id) { return commentsEl.querySelector(`[data-comment-id="${id}"]`); }
let commentDrag = null, commentResize = null;
function onCommentDown(e, comment) {
  e.stopPropagation();
  root.focus();
  cachedViewportRect = viewportEl.getBoundingClientRect();
  if (!e.shiftKey) { selectedNodes.clear(); selectedConns.clear(); selectedComments.clear(); }
  selectedComments.add(comment.id);
  commentDrag = { startWorld: screenToWorld(e.clientX, e.clientY), startX: comment.x, startY: comment.y, id: comment.id, dx: 0, dy: 0 };
  render();
}
function onCommentDragMove(e) {
  const now = screenToWorld(e.clientX, e.clientY);
  commentDrag.dx = now.x - commentDrag.startWorld.x;
  commentDrag.dy = now.y - commentDrag.startWorld.y;
  const div = commentDivFor(commentDrag.id);
  if (div) div.style.transform = `translate(${commentDrag.dx}px, ${commentDrag.dy}px)`;
}
function finishCommentDrag() {
  const d = commentDrag; commentDrag = null;
  if (!d) return;
  ST.mutateGraph((g) => {
    const c = g.comments.find((x) => x.id === d.id);
    if (c) { c.x = Math.round(d.startX + d.dx); c.y = Math.round(d.startY + d.dy); }
  });
}
function onCommentResizeDown(e, comment) {
  e.stopPropagation();
  cachedViewportRect = viewportEl.getBoundingClientRect();
  commentResize = { id: comment.id, startWorld: screenToWorld(e.clientX, e.clientY), startW: comment.w, startH: comment.h };
}
function onCommentResizeMove(e) {
  const now = screenToWorld(e.clientX, e.clientY);
  const dx = now.x - commentResize.startWorld.x, dy = now.y - commentResize.startWorld.y;
  const div = commentDivFor(commentResize.id);
  if (div) {
    div.style.width = Math.max(80, Math.round(commentResize.startW + dx)) + 'px';
    div.style.height = Math.max(60, Math.round(commentResize.startH + dy)) + 'px';
  }
}
function finishCommentResize() {
  const d = commentResize; commentResize = null;
  if (!d) return;
  const div = commentDivFor(d.id);
  if (!div) return;
  ST.mutateGraph((g) => {
    const c = g.comments.find((x) => x.id === d.id);
    if (c) { c.w = parseFloat(div.style.width); c.h = parseFloat(div.style.height); }
  });
}

// ---------------------------------------------------------------- keyboard: delete / copy / paste / escape
function onKeyDown(e) {
  if (document.activeElement?.isContentEditable) return; // editing a comment's text
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault(); e.stopPropagation();
    deleteSelection();
  } else if (ctrl && e.key.toLowerCase() === 'c') {
    e.preventDefault(); e.stopPropagation();
    copySelection();
  } else if (ctrl && e.key.toLowerCase() === 'v') {
    e.preventDefault(); e.stopPropagation();
    pasteClipboard();
  } else if (ctrl && e.key.toLowerCase() === 'z') {
    e.preventDefault(); e.stopPropagation();
    if (!ST.undo()) toast('Nothing to undo');
  } else if ((ctrl && e.key.toLowerCase() === 'y') || (ctrl && e.shiftKey && e.key.toLowerCase() === 'z')) {
    e.preventDefault(); e.stopPropagation();
    if (!ST.redo()) toast('Nothing to redo');
  } else if (e.key === 'Escape') {
    selectedNodes.clear(); selectedConns.clear(); selectedComments.clear();
    render();
  }
}

function deleteSelection() {
  if (!selectedNodes.size && !selectedConns.size && !selectedComments.size) return;
  ST.mutateGraph((g) => {
    for (const id of selectedNodes) removeNode(g, id);
    for (const id of selectedConns) disconnect(g, id);
    for (const id of selectedComments) removeComment(g, id);
  });
  selectedNodes.clear(); selectedConns.clear(); selectedComments.clear();
}

function copySelection() {
  if (!selectedNodes.size) return;
  const graph = ST.state.graph;
  const nodes = graph.nodes.filter((n) => selectedNodes.has(n.id));
  const connections = graph.connections.filter((c) => selectedNodes.has(c.fromNode) && selectedNodes.has(c.toNode));
  clipboard = { nodes: structuredClone(nodes), connections: structuredClone(connections) };
  toast(`Copied ${nodes.length} node(s)`);
}

function pasteClipboard() {
  if (!clipboard || !clipboard.nodes.length) return;
  const idMap = new Map();
  const newIds = [];
  ST.mutateGraph((g) => {
    for (const n of clipboard.nodes) {
      const fresh = newNode(n.type, n.x + 24, n.y + 24);
      Object.assign(fresh.params, n.params);
      fresh.collapsed = n.collapsed;
      addNode(g, fresh);
      idMap.set(n.id, fresh.id);
      newIds.push(fresh.id);
    }
    for (const c of clipboard.connections) {
      connect(g, idMap.get(c.fromNode), c.fromSocket, idMap.get(c.toNode), c.toSocket);
    }
  });
  selectedNodes.clear(); newIds.forEach((id) => selectedNodes.add(id));
  selectedConns.clear(); selectedComments.clear();
  render();
}
