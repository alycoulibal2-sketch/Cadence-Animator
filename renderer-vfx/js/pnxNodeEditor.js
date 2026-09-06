// The procedural node editor — the human half of the engine.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: anything Claude can build through MCP, a person must be able
// to build here, on the same graph. Not an equivalent graph, not an export of one — the same object.
//
//   this editor  ─┐
//                 ├─→  ST.state.pnx  ←→  pnx/graph.js  ←→  the evaluator and the preview
//   pnxMcp.js    ─┘
//
// Both sides call the identical mutators (PGRAPH.newNode / connect / setNodeValue / removeNode) inside
// ST.mutatePnx, which is what gives one undo history, one invalidation path and one saved document. A
// node Claude adds appears here on the next render because there is nothing to synchronise; it is the
// same array.
//
// AND NOTHING HERE IS HAND-MAINTAINED PER NODE. Every box, socket, control, tooltip, colour, range and
// unit is generated from the node's registry definition. That is the second half of the rule: when a
// new engine node is registered it becomes available to a person and to Claude at the same moment,
// because neither side has a list of its own. There are 354 node types and no list of 354 anything in
// this file.
//
// WHAT MAKES A TYPED GRAPH DIFFERENT FROM THE V1 ONE, and why this is not a small edit to nodeEditor.js:
// the v1 canvas draws one input dot and one output dot per node, because its only socket kind is
// 'flow'. Here a node has named, typed, individually-connectable sockets, each of which may also hold
// an inline value when nothing is wired to it. That changes the layout model, the hit-testing, the drag
// logic and the property editing all at once.

import * as ST from './studioState.js';
import * as PNX from './pnxStudio.js';
import * as PGRAPH from '../../renderer/js/pnx/graph.js';
import * as PGROUPS from '../../renderer/js/pnx/groups.js';
import * as PLIB from '../../renderer/js/pnx/library.js';
import * as REG from '../../renderer/js/pnx/registry.js';
import * as T from '../../renderer/js/pnx/types.js';
import { modal, toast, showContextMenu } from '../../renderer/js/ui.js';
import { buildControl as sharedBuildControl, gradientCss } from './pnxControls.js';
import '../../renderer/js/pnx/nodes/index.js';
import * as TOOLS from '../../renderer/js/pnx/editorTools.js';

// Box geometry lives in editorTools.js so the auto-layout and the canvas cannot disagree about how
// tall a node is (the header is given HEADER_H explicitly below rather than inheriting
// .node-box-header's, so the two cannot drift apart).
const { NODE_W, HEADER_H, ROW_H, SOCKET_R } = TOOLS;

let isOpen = false;
let root, viewportEl, worldEl, wiresEl, nodesEl, commentsEl, rubberEl, breadcrumbEl, statusEl;
let closeModal = null;
let view = { x: 0, y: 0, k: 1 };
let scope = PGRAPH.ROOT_SCOPE;          // which group's interior is being shown
const selected = new Set();
const selectedLinks = new Set();
let clipboard = null;
let cachedRect = null;
// Phase 7: the help panel, the minimap, keyboard focus and a keyboard-driven wire.
let mainEl = null, helpEl = null, minimapEl = null, minimapCtx = null, accentColour = '#7c8cff';
let helpVisible = true;
let focusSocket = null;   // { nodeId, io, key } — the socket Tab has landed on
let kbWire = null;        // { nodeId, io, key, socket } — a wire started with Enter, waiting for its other end
// The minimap's model is rebuilt on a document change and only READ while drawing, so a pan, a zoom or
// a node drag redraws without allocating; draws are coalesced to one per animation frame.
const minimapModel = { rects: new Map(), minX: 0, minY: 0, maxX: 0, maxY: 0, scale: 0, ox: 0, oy: 0, bx: 0, by: 0 };
let minimapRaf = 0;

export function isPnxEditorOpen() { return isOpen; }
export function closePnxNodeEditor() { closeModal?.(); }
// The live editor's root, so callers that inspect the DOM scope to THIS editor. The modal fades out
// over 220ms before it is removed, so a document-wide query run just after a close can still see the
// previous editor's nodes alongside the new one's.
export function pnxEditorRoot() { return isOpen ? root : null; }

// ---------------------------------------------------------------- small helpers
function el(tag, className, text) {
  const d = document.createElement(tag);
  if (className) d.className = className;
  if (text !== undefined) d.textContent = text;
  return d;
}
const graph = () => ST.state.pnx;
function screenToWorld(cx, cy) {
  const r = cachedRect || (cachedRect = viewportEl.getBoundingClientRect());
  return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
}
function applyTransform() {
  worldEl.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  scheduleMinimap();
}
function viewportCenterWorld() {
  const r = viewportEl.getBoundingClientRect();
  return screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
}

// Every write goes through here, so the editor cannot accidentally take a path MCP does not also take.
// `structural` decides whether the evaluator drops a running simulation: a value change should not,
// a rewire must.
function mutate(fn, { structural = false, nodeId = null } = {}) {
  ST.mutatePnx(fn, { structural, nodeId });
}

// ---------------------------------------------------------------- socket geometry
// A node's rows, in the order they are drawn. Outputs sit above inputs so wires leave the right edge
// near the top and arrive at the left edge below, which keeps a left-to-right graph readable.
function rowsOf(node) {
  const { inputs, outputs } = PGRAPH.socketsOf(graph(), node);
  const rows = [];
  for (const s of outputs) rows.push({ io: 'out', socket: s });
  for (const s of inputs) rows.push({ io: 'in', socket: s });
  return rows;
}

function rowY(index) {
  return HEADER_H + index * ROW_H + ROW_H / 2;
}

// Where a socket's dot sits in world space — used to draw wires without reading the DOM, so wire
// geometry stays correct while a node is mid-drag.
function socketWorldPos(node, io, key) {
  const rows = rowsOf(node);
  const idx = rows.findIndex((r) => r.io === io && r.socket.key === key);
  const y = node.y + (idx < 0 ? HEADER_H / 2 : rowY(idx));
  return { x: node.x + (io === 'out' ? NODE_W : 0), y };
}

function wirePathD(a, b) {
  const dx = Math.max(30, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

const typeColor = (ref) => (T.typeMeta(ref?.name)?.color) || '#8f8f9a';

// ---------------------------------------------------------------- open / close
export function openPnxNodeEditor() {
  if (isOpen) { root.focus(); return; }
  if (!ST.state.pnx) { toast('No procedural effect is open.', 'error'); return; }
  isOpen = true;
  scope = PGRAPH.ROOT_SCOPE;
  selected.clear(); selectedLinks.clear();

  root = el('div', 'node-editor pnx-editor');
  root.tabIndex = -1;

  const toolbar = el('div', 'node-editor-toolbar');
  toolbar.appendChild(el('span', 'node-editor-title', '✨ Procedural graph'));

  const addBtn = el('button', 'tb-btn', '＋ Add node');
  addBtn.title = 'Add a node  (A, or double-click the canvas)';
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = addBtn.getBoundingClientRect();
    openAddPalette(r.left, r.bottom + 6, viewportCenterWorld());
  });
  toolbar.appendChild(addBtn);

  const groupBtn = el('button', 'tb-btn', 'Group');
  groupBtn.title = 'Collapse the selected nodes into a reusable group  (Ctrl+G)';
  groupBtn.addEventListener('click', () => groupSelection());
  toolbar.appendChild(groupBtn);

  const layoutBtn = el('button', 'tb-btn pnx-layout-btn', 'Auto-layout');
  layoutBtn.title = 'Arrange the nodes left to right by what feeds what  (Ctrl+L)';
  layoutBtn.addEventListener('click', () => autoLayout());
  toolbar.appendChild(layoutBtn);

  const helpBtn = el('button', 'tb-btn pnx-help-btn', '? Help');
  helpBtn.title = 'Show or hide the help panel for the selected node  (H)';
  helpBtn.addEventListener('click', () => { helpVisible = !helpVisible; renderHelp(); });
  toolbar.appendChild(helpBtn);

  breadcrumbEl = el('div', 'pnx-breadcrumb');
  toolbar.appendChild(breadcrumbEl);

  statusEl = el('span', 'node-editor-errors');
  toolbar.appendChild(statusEl);

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
  buildMinimap();
  mainEl = el('div', 'pnx-editor-main');
  helpEl = el('aside', 'pnx-help');
  mainEl.append(viewportEl, helpEl);
  root.appendChild(mainEl);

  wireViewportEvents();
  root.addEventListener('keydown', onKeyDown);

  // Re-render on any document change, whoever made it. This is the whole of the "Claude adds a node,
  // the human sees it" requirement — MCP mutations go through ST.mutatePnx, which emits 'effect'.
  const onChange = () => render();
  ST.on('effect', onChange);
  ST.on('pnx', onChange);

  // ...and refresh the status line on every evaluated frame. A document change is not the only thing
  // that changes what that line should say: scrubbing to a frame where the particles have finally
  // been emitted changes it too, with no edit involved. Cheap by construction — no revalidation, and
  // it only writes to the DOM when the text actually differs.
  const onEvaluated = () => { if (isOpen) renderStatus({ revalidate: false }); };
  const stopEvaluated = PNX.onEvaluated(onEvaluated);

  const m = modal({
    title: '', body: root,
    onClose: () => { isOpen = false; ST.off('effect', onChange); ST.off('pnx', onChange); stopEvaluated(); if (minimapRaf) cancelAnimationFrame(minimapRaf); minimapRaf = 0; focusSocket = null; kbWire = null; },
  });
  closeModal = m.close;
  applyTransform();
  frameAll();
  render();
  requestAnimationFrame(() => root.focus());
}

// Fit the current scope's nodes in view, so opening a Claude-built graph shows the whole thing rather
// than wherever the origin happens to be.
function frameAll() {
  const nodes = PGRAPH.nodesInScope(graph(), scope);
  if (!nodes.length) { view = { x: 60, y: 60, k: 1 }; applyTransform(); return; }
  const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs) - 60, maxX = Math.max(...xs) + NODE_W + 60;
  const minY = Math.min(...ys) - 60, maxY = Math.max(...ys) + 220;
  const r = viewportEl.getBoundingClientRect();
  const k = Math.max(0.25, Math.min(1.2, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))));
  view = { k, x: -minX * k + (r.width - (maxX - minX) * k) / 2, y: -minY * k + (r.height - (maxY - minY) * k) / 2 };
  applyTransform();
}

// ---------------------------------------------------------------- render
function render() {
  if (!isOpen || !graph()) return;
  cachedRect = null;
  // A group can be deleted from under us (by MCP, or by an undo), so never trust the stored scope.
  if (scope !== PGRAPH.ROOT_SCOPE && !graph().groups[scope]) scope = PGRAPH.ROOT_SCOPE;

  nodesEl.innerHTML = '';
  commentsEl.innerHTML = '';
  if (focusSocket && !graph().nodes[focusSocket.nodeId]) focusSocket = null;
  if (kbWire && !graph().nodes[kbWire.nodeId]) kbWire = null;
  for (const node of PGRAPH.nodesInScope(graph(), scope)) nodesEl.appendChild(buildNodeEl(node));
  renderWires();
  renderKbWire();
  renderBreadcrumb();
  renderStatus();
  renderHelp();
  rebuildMinimapModel();
}

function renderBreadcrumb() {
  breadcrumbEl.innerHTML = '';
  const crumb = (label, onClick, current) => {
    const b = el('button', 'pnx-crumb' + (current ? ' current' : ''), label);
    if (onClick) b.addEventListener('click', onClick);
    breadcrumbEl.appendChild(b);
  };
  crumb(ST.state.pnx.name || 'Effect', () => { scope = PGRAPH.ROOT_SCOPE; selected.clear(); frameAll(); render(); }, scope === PGRAPH.ROOT_SCOPE);
  if (scope !== PGRAPH.ROOT_SCOPE) {
    const g = graph().groups[scope];
    breadcrumbEl.appendChild(el('span', 'pnx-crumb-sep', '›'));
    crumb(g?.name || 'Group', null, true);
    const exit = el('button', 'tb-btn pnx-exit', 'Exit group');
    exit.addEventListener('click', () => { scope = PGRAPH.ROOT_SCOPE; selected.clear(); frameAll(); render(); });
    breadcrumbEl.appendChild(exit);
  }
}

// The graph's own diagnostics, surfaced where the work happens rather than only in a panel.
//
// Called from two places, and the distinction matters. `render()` calls it after a structural change
// and revalidates. The evaluation subscriber calls it after every frame WITHOUT revalidating, because
// most of what this line says — the draw count, whether anything reached the screen, the frame-0
// explanation — is a property of the last evaluated frame, not of the graph's shape.
//
// Before that subscription existed this ran only inside `render()`, a full DOM rebuild. A brand-new
// effect is built node-then-wire, so it is briefly a graph with no render passes; the warning raised
// at that instant then sat in the header indefinitely while the effect drew hundreds of sprites and
// `pnx_verify` reported nothing wrong. The status was not incorrect so much as frozen.
function renderStatus({ revalidate = true } = {}) {
  const rep = PNX.report({ revalidate });
  const errors = rep.diagnostics.filter((d) => d.severity === 'error');
  const warnings = rep.diagnostics.filter((d) => d.severity === 'warning');

  let text, title, cls;
  if (errors.length) {
    text = `✕ ${errors[0].message}`;
    title = errors.map((d) => `• ${d.message}`).join('\n');
    cls = 'node-editor-errors has-error';
  } else if (warnings.length) {
    text = `⚠ ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`;
    title = warnings.map((d) => `• ${d.message}`).join('\n');
    cls = 'node-editor-errors has-warning';
  } else {
    // An info diagnostic is worth showing where the work happens — the commonest one explains why a
    // brand-new effect draws nothing at frame 0, which is otherwise a puzzle with no message.
    const info = rep.diagnostics.find((d) => d.severity === 'info');
    const st = rep.stats || {};
    const counts = `${st.nodes || 0} nodes · ${st.drawnElements || 0} drawn`;
    text = info ? info.message : counts;
    title = info ? `${info.message}\n\n${counts}` : 'The graph evaluates without errors.';
    cls = 'node-editor-errors ' + (info ? 'is-info' : 'is-clean');
  }

  // Write only on change. This runs once per evaluated frame, and reassigning identical text would
  // otherwise invalidate layout on every frame of playback for no visible difference.
  if (statusEl.textContent !== text) statusEl.textContent = text;
  if (statusEl.title !== title) statusEl.title = title;
  if (statusEl.className !== cls) statusEl.className = cls;
}

function renderWires() {
  wiresEl.innerHTML = '';
  const g = graph();
  for (const link of Object.values(g.links)) {
    const from = g.nodes[link.fromNode], to = g.nodes[link.toNode];
    if (!from || !to || from.scope !== scope || to.scope !== scope) continue;
    const a = socketWorldPos(from, 'out', link.fromSocket);
    const b = socketWorldPos(to, 'in', link.toSocket);
    const path = document.createElementNS(wiresEl.namespaceURI, 'path');
    path.dataset.linkId = link.id;
    path.setAttribute('d', wirePathD(a, b));
    path.setAttribute('class', 'node-wire' + (selectedLinks.has(link.id) ? ' selected' : ''));
    // Wires are coloured by what flows along them, which is how you read a dense graph at a glance.
    const outS = PGRAPH.socketsOf(g, from).outputs.find((s) => s.key === link.fromSocket);
    path.setAttribute('stroke', typeColor(outS?.type));
    path.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (!e.shiftKey) { selected.clear(); selectedLinks.clear(); }
      selectedLinks.add(link.id);
      render();
    });
    wiresEl.appendChild(path);
  }
}

// ---------------------------------------------------------------- node box
function buildNodeEl(node) {
  const g = graph();
  const def = REG.getNode(node.type);
  const isGroup = PGRAPH.isGroupInstanceType(node.type);
  const isBoundary = PGRAPH.isGroupBoundaryType(node.type);
  const rows = rowsOf(node);

  const box = el('div', 'node-box pnx-node' + (selected.has(node.id) ? ' selected' : '')
    + (node.muted ? ' muted' : '') + (node.bypassed ? ' bypassed' : ''));
  box.dataset.nodeId = node.id;
  box.style.left = node.x + 'px';
  box.style.top = node.y + 'px';
  box.style.width = NODE_W + 'px';

  // --- header
  const header = el('div', 'node-box-header');
  header.style.height = HEADER_H + 'px';
  const groupDef = isGroup ? g.groups[PGRAPH.groupIdOfType(node.type)] : null;
  const title = node.label || groupDef?.name || def?.label || (isBoundary ? (node.type === PGRAPH.GROUP_INPUT_TYPE ? 'Group Input' : 'Group Output') : node.type);
  header.appendChild(el('span', 'node-box-title', title));
  if (def) {
    header.title = `${def.label} — ${def.summary}` + (def.explain ? `\n\n${def.explain}` : '')
      + `\n\nRoblox: ${def.exportSupport}${def.exportNote ? ` — ${def.exportNote}` : ''}`;
  }
  // A group instance opens; that is the "no black boxes" requirement made literal.
  if (isGroup) {
    const enter = el('span', 'pnx-enter', '⤢');
    enter.title = 'Open this group and edit the nodes inside it';
    enter.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      scope = PGRAPH.groupIdOfType(node.type);
      selected.clear();
      frameAll();
      render();
    });
    header.appendChild(enter);
  }
  header.addEventListener('pointerdown', (e) => onNodeHeaderDown(e, node));
  header.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openNodeMenu(e.clientX, e.clientY, node); });
  box.appendChild(header);

  // --- rows: one per socket, each with its dot and (for editable inputs) its control
  const body = el('div', 'pnx-rows');
  rows.forEach((row, idx) => {
    const r = el('div', 'pnx-row pnx-row-' + row.io);
    r.style.height = ROW_H + 'px';

    const connectable = row.socket.socket !== false;
    if (connectable) {
      const dot = el('div', `pnx-socket pnx-socket-${row.io}`);
      dot.style.background = typeColor(row.socket.type);
      dot.style.top = (rowY(idx) - SOCKET_R) + 'px';
      dot.dataset.socketKey = row.socket.key;
      dot.dataset.socketIo = row.io;
      if (focusSocket && focusSocket.nodeId === node.id && focusSocket.io === row.io && focusSocket.key === row.socket.key) dot.classList.add('focused');
      if (kbWire && kbWire.nodeId === node.id && kbWire.io === row.io && kbWire.key === row.socket.key) dot.classList.add('wiring');
      const tn = T.formatType(row.socket.type);
      dot.title = `${row.socket.label} — ${T.typeMeta(row.socket.type.name)?.label || tn} (${tn})`
        + (row.socket.unit ? `\nMeasured in ${row.socket.unit}` : '')
        + (row.socket.description ? `\n\n${row.socket.description}` : '')
        + (row.io === 'in' ? '\n\nDrag from another node\'s output to connect.' : '\n\nDrag to an input to connect.');
      dot.addEventListener('pointerdown', (e) => { e.stopPropagation(); onSocketDown(e, node, row.io, row.socket); });
      box.appendChild(dot);
    }

    // The full label always goes in the tooltip, not just the unit: a long one still ellipsises at
    // this width, and "Particle …" with no way to see the rest is how two sockets become one.
    const label = el('span', 'pnx-row-label', row.socket.label);
    label.title = row.socket.label
      + (row.socket.unit ? ` — in ${row.socket.unit}` : '')
      + (row.socket.description ? `\n\n${row.socket.description}` : '');

    if (row.io === 'out') {
      r.appendChild(el('span', 'pnx-row-spacer'));
      r.appendChild(label);
    } else {
      r.appendChild(label);
      const wired = PGRAPH.linksInto(g, node.id, row.socket.key).length > 0;
      if (wired) {
        // A wired input's value comes from upstream, so showing an editable box would be a control
        // that silently does nothing.
        r.appendChild(el('span', 'pnx-row-wired', 'connected'));
      } else {
        const ctrl = buildControl(node, row.socket);
        if (ctrl) r.appendChild(ctrl); else r.appendChild(el('span', 'pnx-row-wired', T.formatType(row.socket.type)));
      }
    }
    body.appendChild(r);
  });
  box.appendChild(body);

  // --- preview strip, for the node kinds that have something worth showing
  if (def?.preview && !node.collapsed) {
    const prev = buildPreview(node, def);
    if (prev) box.appendChild(prev);
  }
  return box;
}

// ---------------------------------------------------------------- property controls
// Generated from the socket's declared type and metadata. Nothing here is per-node: a new engine node
// gets working controls the moment it is registered, because its sockets already say what they are.
// One control factory for the whole app (pnxControls.js): a value edited here and a value edited on
// the Effect Sheet go through the same code and the same write path.
function buildControl(node, socket) {
  const type = socket.type;
  const inner = T.isFieldType(type) ? type.param : type;
  const cur = node.values?.[socket.key] !== undefined ? node.values[socket.key]
    : (socket.default !== undefined ? socket.default : T.defaultValue(inner));
  const commit = (v) => mutate((g) => PGRAPH.setNodeValue(g, node.id, socket.key, v), { nodeId: node.id });
  return sharedBuildControl(socket, cur, commit);
}
// ---------------------------------------------------------------- node previews
// Rendered by evaluating the node's own output through the live session, so a preview shows what the
// graph actually produces rather than an illustration of what the node type usually does.
function buildPreview(node, def) {
  const kind = def.preview;
  const out = def.outputs[0];
  if (!out) return null;
  let value;
  try { value = PNX.inspectSocket(node.id, out.key); } catch (e) { return null; }
  if (value === null || value === undefined) return null;

  const cv = el('canvas', 'pnx-preview');
  cv.width = NODE_W - 12; cv.height = 44;
  const c = cv.getContext('2d');
  const img = c.createImageData(cv.width, cv.height);
  const sample = (u, v) => {
    // Field previews are sampled over a small world window; the exact extent is arbitrary but must be
    // consistent, or two noise nodes at different scales would look identical.
    const ctx = { position: [(u - 0.5) * 4, (v - 0.5) * 4, 0], uv: [u, v], life: u, index: Math.round(u * 32) };
    try {
      if (value.__field === true) return value.sample({ ...blankSample(), ...ctx });
      if (typeof value === 'number') return value;
    } catch (e) { /* a half-wired graph is normal; draw what we can */ }
    return null;
  };

  for (let y = 0; y < cv.height; y++) {
    for (let x = 0; x < cv.width; x++) {
      const s = sample(x / cv.width, 1 - y / cv.height);
      let r = 20, g = 20, b = 26;
      if (typeof s === 'number' && Number.isFinite(s)) {
        if (kind === 'sdf') {
          // Inside/outside reads far better than a brightness ramp for a distance field.
          const inside = s < 0;
          const band = Math.exp(-Math.abs(s) * 16);
          r = Math.round(255 * (inside ? band * 0.3 : Math.min(1, Math.abs(s)) * 0.5 + band));
          g = Math.round(255 * (inside ? 0.5 + band : band));
          b = Math.round(255 * (inside ? 0.9 : band));
        } else {
          const t = Math.max(0, Math.min(1, s));
          r = g = b = Math.round(t * 255);
        }
      } else if (Array.isArray(s)) {
        r = Math.round(Math.min(1, Math.max(0, s[0] ?? 0)) * 255);
        g = Math.round(Math.min(1, Math.max(0, s[1] ?? 0)) * 255);
        b = Math.round(Math.min(1, Math.max(0, s[2] ?? 0)) * 255);
      }
      const i = (y * cv.width + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  cv.title = `Preview of ${out.label}`;
  return cv;
}

function blankSample() {
  return {
    position: [0, 0, 0], normal: [0, 1, 0], tangent: [0, 0, 0], uv: [0, 0],
    time: 0, frame: 0, age: 0, life: 0, velocity: [0, 0, 0], index: 0, seed: 0,
    attributes: null, space: 'world',
  };
}

// ---------------------------------------------------------------- add palette (search-first)
// With 354 node types a nested menu is the wrong shape, so this leads with search and falls back to
// categories. Ranking comes from the registry's own search, which understands aliases — "swirl" finds
// Curl Noise and Vortex Field because those nodes declare it, not because this file knows about swirl.
let paletteEl = null;
function closeAddPalette() {
  if (paletteEl) { paletteEl.remove(); paletteEl = null; }
}

// `forSocket` is the wire being held when the palette was opened by releasing a drag on empty canvas:
// only node types with a socket that wire can land on are listed, each row says which socket, and
// choosing one creates the node already connected.
function openAddPalette(screenX, screenY, worldPos, { forSocket = null } = {}) {
  closeAddPalette();
  const held = forSocket;
  const fits = held ? new Set(REG.currentNodes().filter((n) => TOOLS.fittingSocket(n, held.io, held.socket.type)).map((n) => n.id)) : null;
  const p = el('div', 'pnx-palette' + (held ? ' pnx-palette-for-socket' : ''));
  paletteEl = p;
  p.style.left = Math.min(screenX, window.innerWidth - 380) + 'px';
  p.style.top = Math.min(screenY, window.innerHeight - 420) + 'px';

  const input = el('input', 'fld pnx-palette-search');
  input.type = 'text';
  input.placeholder = held
    ? `Nodes that fit ${held.socket.label} (${T.formatType(held.socket.type)})…`
    : 'Search 354 nodes…  (try "swirl", "fade", "bounce")';
  const results = el('div', 'pnx-palette-results');
  if (held) p.appendChild(el('div', 'pnx-palette-hint', `Connect ${held.io === 'out' ? 'the' : 'something to'} ${held.socket.label} ${held.io === 'out' ? 'output' : 'input'} to…`));
  p.append(input, results);
  document.body.appendChild(p);

  let items = [];
  let active = 0;

  // Commands the palette also answers to, so "arrange" or "tidy" finds Auto-layout where a person
  // would look for it. A command row runs instead of adding a node.
  const COMMANDS = [
    { command: 'autoLayout', label: 'Auto-layout', category: 'Command', summary: 'Arrange the nodes left to right by what feeds what (Ctrl+L).', match: /^(auto|lay|arrange|tidy|clean|order|sort|align)/i, run: () => autoLayout() },
  ];
  const choose = (n) => {
    if (n.command) { closeAddPalette(); n.run(); return; }
    if (held) addNodeWired(n.id, worldPos, held); else addNode(n.id, worldPos);
    closeAddPalette();
  };
  const renderResults = () => {
    const q = input.value.trim();
    items = q
      ? REG.searchNodes(q, { limit: fits ? 400 : 60 })
      : REG.currentNodes().slice().sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
    if (fits) items = items.filter((n) => fits.has(n.id)).slice(0, 60);
    if (!held && q) items = [...COMMANDS.filter((c) => c.match.test(q)), ...items];
    results.innerHTML = '';
    if (!items.length) {
      results.appendChild(el('div', 'pnx-palette-empty', held ? `Nothing that fits ${held.socket.label} matches "${q}".` : `Nothing matches "${q}".`));
      return;
    }
    let lastCat = null;
    items.forEach((n, i) => {
      if (!q && !held && n.category !== lastCat) {
        lastCat = n.category;
        results.appendChild(el('div', 'pnx-palette-cat', n.category));
      }
      const row = el('div', 'pnx-palette-row' + (i === active ? ' active' : '') + (n.command ? ' pnx-palette-command' : ''));
      row.dataset.index = i;
      const main = el('div', 'pnx-palette-main');
      main.appendChild(el('span', 'pnx-palette-label', n.label));
      main.appendChild(el('span', 'pnx-palette-badge', n.category));
      if (n.pro) main.appendChild(el('span', 'pnx-palette-badge pnx-badge-pro', 'Pro'));
      if (held && !n.command) {
        const fit = TOOLS.fittingSocket(n, held.io, held.socket.type);
        if (fit) main.appendChild(el('span', 'pnx-palette-badge pnx-badge-fit', `${held.io === 'out' ? '→' : '←'} ${fit.label}`));
      }
      row.appendChild(main);
      row.appendChild(el('div', 'pnx-palette-desc', n.summary));
      row.addEventListener('pointerdown', (e) => { e.preventDefault(); choose(n); });
      results.appendChild(row);
    });
  };

  const move = (delta) => {
    if (!items.length) return;
    active = Math.max(0, Math.min(items.length - 1, active + delta));
    renderResults();
    results.querySelector('.pnx-palette-row.active')?.scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('input', () => { active = 0; renderResults(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) choose(items[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); closeAddPalette(); root.focus(); }
    e.stopPropagation();
  });

  // Clicking away dismisses, but not the click that opened it.
  setTimeout(() => {
    const away = (e) => {
      if (paletteEl && !paletteEl.contains(e.target)) { closeAddPalette(); document.removeEventListener('pointerdown', away, true); }
    };
    document.addEventListener('pointerdown', away, true);
  }, 0);

  renderResults();
  input.focus();
}

function addNode(type, pos) {
  let created = null;
  mutate((g) => {
    created = PGRAPH.newNode(g, type, Math.round(pos.x - NODE_W / 2), Math.round(pos.y - HEADER_H), { scope });
  }, { structural: true });
  selected.clear();
  if (created) selected.add(created.id);
  render();
}

// Add a node and wire it to the socket a drag was released from, in ONE undo step. The new node is
// placed so the socket that takes the wire sits where the pointer let go, which is where the eye is.
function addNodeWired(type, pos, held) {
  const def = REG.getNode(type);
  const fit = TOOLS.fittingSocket(def, held.io, held.socket.type);
  let created = null, res = null;
  mutate((g) => {
    created = PGRAPH.newNode(g, type, 0, 0, { scope });
    const rows = rowsOf(created);
    const idx = fit ? rows.findIndex((r) => r.io === (held.io === 'out' ? 'in' : 'out') && r.socket.key === fit.key) : -1;
    created.x = Math.round(held.io === 'out' ? pos.x : pos.x - NODE_W);
    created.y = Math.round(pos.y - (idx >= 0 ? rowY(idx) : HEADER_H / 2));
    if (fit) {
      res = held.io === 'out'
        ? PGRAPH.connect(g, held.nodeId, held.key, created.id, fit.key)
        : PGRAPH.connect(g, created.id, fit.key, held.nodeId, held.key);
    }
  }, { structural: true });
  if (res && !res.ok) toast(`Added ${def?.label || type}, but could not connect it: ${res.reason}`, 'error');
  selected.clear();
  if (created) selected.add(created.id);
  focusSocket = null;
  render();
}

// ---------------------------------------------------------------- auto-layout
// Position is presentation, so the write is layout-only (no evaluator invalidation, like a drag)
// and one undo step.
function autoLayout() {
  let res = null;
  mutate((g) => { res = TOOLS.applyAutoLayout(g, scope); }, { nodeId: '__layout__' });
  frameAll();
  render();
  if (res) toast(`Arranged ${res.moved} node${res.moved === 1 ? '' : 's'} in ${res.columns} column${res.columns === 1 ? '' : 's'}`);
  return res;
}

// ---------------------------------------------------------------- node context menu
function openNodeMenu(x, y, node) {
  const def = REG.getNode(node.type);
  const items = [
    { label: node.muted ? 'Unmute' : 'Mute', run: () => toggleFlag(node.id, 'muted') },
    { label: node.bypassed ? 'Stop bypassing' : 'Bypass', run: () => toggleFlag(node.id, 'bypassed') },
    { label: 'Duplicate', run: () => duplicateSelection() },
    { label: 'Delete', run: () => deleteSelection() },
  ];
  if (PGRAPH.isGroupInstanceType(node.type)) {
    items.unshift({ label: 'Open group', run: () => { scope = PGRAPH.groupIdOfType(node.type); selected.clear(); frameAll(); render(); } });
    items.push({ label: 'Expand group here', run: () => expandGroup(node.id) });
  }
  if (def) {
    items.push({
      label: 'What does this do?',
      run: () => showNodeDocs(def),
    });
  }
  showContextMenu(x, y, items);
}

function showNodeDocs(def) {
  const d = REG.describeNode(def.id);
  const wrap = el('div', 'pnx-docs');
  wrap.appendChild(el('h3', null, d.label));
  wrap.appendChild(el('p', null, d.summary));
  if (d.teach) wrap.appendChild(el('p', 'muted', d.teach));
  if (d.explain) wrap.appendChild(el('p', null, d.explain));
  const io = el('div', 'pnx-docs-io');
  const col = (title, list) => {
    const c = el('div');
    c.appendChild(el('h4', null, title));
    for (const s of list) {
      const line = el('div', 'pnx-docs-socket');
      line.appendChild(el('b', null, s.label));
      line.appendChild(el('span', 'muted', ` ${s.type}${s.unit ? ' · ' + s.unit : ''}`));
      if (s.description) line.appendChild(el('div', 'muted', s.description));
      c.appendChild(line);
    }
    return c;
  };
  io.append(col('Inputs', d.inputs), col('Outputs', d.outputs));
  wrap.appendChild(io);
  if (d.commonUses?.length) {
    wrap.appendChild(el('h4', null, 'Common uses'));
    for (const u of d.commonUses) wrap.appendChild(el('div', 'muted', `• ${u}`));
  }
  wrap.appendChild(el('p', 'muted', `Roblox export: ${d.exportSupport}${d.exportNote ? ` — ${d.exportNote}` : ''}`));
  modal({ title: d.label, body: wrap, actions: [{ label: 'Close', run: () => {} }] });
}

function toggleFlag(nodeId, flag) {
  mutate((g) => { const n = g.nodes[nodeId]; if (n) n[flag] = !n[flag]; }, { structural: true });
  render();
}

// ---------------------------------------------------------------- groups
function groupSelection() {
  const ids = [...selected];
  if (ids.length < 1) { toast('Select the nodes you want to group first', 'error'); return; }
  let res = null;
  mutate((g) => { res = PGROUPS.collapseToGroup(g, ids, { name: 'Group' }); }, { structural: true });
  if (!res?.ok) { toast(`Cannot group: ${res?.reason || 'unknown'}`, 'error'); return; }
  selected.clear();
  selected.add(res.instanceId);
  toast(`Grouped ${res.enclosed} nodes — ${res.inputs.length} in, ${res.outputs.length} out. Double-click to open it.`);
  render();
}

function expandGroup(nodeId) {
  let res = null;
  mutate((g) => { res = PGROUPS.expandGroup(g, nodeId); }, { structural: true });
  if (!res?.ok) { toast(`Cannot expand: ${res?.reason}`, 'error'); return; }
  selected.clear();
  render();
}

// ---------------------------------------------------------------- pan / zoom / selection
let panDrag = null, rubberDrag = null;
function wireViewportEvents() {
  viewportEl.addEventListener('pointerdown', (e) => {
    if (e.target !== viewportEl && e.target !== worldEl) return;
    root.focus();
    cachedRect = viewportEl.getBoundingClientRect();
    if (e.shiftKey) {
      rubberDrag = { x0: e.clientX, y0: e.clientY };
      rubberEl.style.display = 'block';
      window.addEventListener('pointermove', onRubberMove);
      window.addEventListener('pointerup', () => finishRubber(), { once: true });
    } else {
      if (!e.ctrlKey) { selected.clear(); selectedLinks.clear(); render(); }
      panDrag = { x: e.clientX - view.x, y: e.clientY - view.y };
      window.addEventListener('pointermove', onPanMove);
      window.addEventListener('pointerup', () => { panDrag = null; window.removeEventListener('pointermove', onPanMove); }, { once: true });
    }
  });

  viewportEl.addEventListener('dblclick', (e) => {
    if (e.target !== viewportEl && e.target !== worldEl) return;
    openAddPalette(e.clientX, e.clientY, screenToWorld(e.clientX, e.clientY));
  });

  viewportEl.addEventListener('contextmenu', (e) => {
    if (e.target !== viewportEl && e.target !== worldEl) return;
    e.preventDefault();
    openAddPalette(e.clientX, e.clientY, screenToWorld(e.clientX, e.clientY));
  });

  viewportEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    cachedRect = viewportEl.getBoundingClientRect();
    const before = screenToWorld(e.clientX, e.clientY);
    view.k = Math.max(0.2, Math.min(2.5, view.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    const after = screenToWorld(e.clientX, e.clientY);
    view.x += (after.x - before.x) * view.k;
    view.y += (after.y - before.y) * view.k;
    applyTransform();
  }, { passive: false });
}

function onPanMove(e) {
  if (!panDrag) return;
  view.x = e.clientX - panDrag.x;
  view.y = e.clientY - panDrag.y;
  applyTransform();
}

function onRubberMove(e) {
  if (!rubberDrag) return;
  const x = Math.min(rubberDrag.x0, e.clientX), y = Math.min(rubberDrag.y0, e.clientY);
  const w = Math.abs(e.clientX - rubberDrag.x0), h = Math.abs(e.clientY - rubberDrag.y0);
  const r = viewportEl.getBoundingClientRect();
  Object.assign(rubberEl.style, { left: (x - r.left) + 'px', top: (y - r.top) + 'px', width: w + 'px', height: h + 'px' });
  rubberDrag.rect = { x, y, w, h };
}

function finishRubber() {
  window.removeEventListener('pointermove', onRubberMove);
  rubberEl.style.display = 'none';
  const rect = rubberDrag?.rect;
  rubberDrag = null;
  if (!rect) return;
  const a = screenToWorld(rect.x, rect.y);
  const b = screenToWorld(rect.x + rect.w, rect.y + rect.h);
  for (const n of PGRAPH.nodesInScope(graph(), scope)) {
    if (n.x + NODE_W >= a.x && n.x <= b.x && n.y + HEADER_H >= a.y && n.y <= b.y) selected.add(n.id);
  }
  render();
}

// ---------------------------------------------------------------- node drag
let nodeDrag = null;
function onNodeHeaderDown(e, node) {
  e.stopPropagation();
  root.focus();
  cachedRect = viewportEl.getBoundingClientRect();
  if (!selected.has(node.id)) {
    if (!e.shiftKey && !e.ctrlKey) selected.clear();
    selected.add(node.id);
    selectedLinks.clear();
    render();
  }
  const start = screenToWorld(e.clientX, e.clientY);
  nodeDrag = {
    start,
    origins: new Map([...selected].map((id) => [id, { x: graph().nodes[id].x, y: graph().nodes[id].y }])),
    moved: false,
  };
  window.addEventListener('pointermove', onNodeDragMove);
  window.addEventListener('pointerup', finishNodeDrag, { once: true });
}

function onNodeDragMove(e) {
  if (!nodeDrag) return;
  const now = screenToWorld(e.clientX, e.clientY);
  const dx = now.x - nodeDrag.start.x, dy = now.y - nodeDrag.start.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) nodeDrag.moved = true;
  // Moved live in the DOM; the model is written once on release, so a drag is one undo step rather
  // than hundreds.
  for (const [id, o] of nodeDrag.origins) {
    const div = nodesEl.querySelector(`[data-node-id="${id}"]`);
    if (div) { div.style.left = Math.round(o.x + dx) + 'px'; div.style.top = Math.round(o.y + dy) + 'px'; }
  }
  updateWiresLive(nodeDrag, dx, dy);
  for (const [id, o] of nodeDrag.origins) { const rc = minimapModel.rects.get(id); if (rc) { rc.x = o.x + dx; rc.y = o.y + dy; } }
  scheduleMinimap();
}

function updateWiresLive(drag, dx, dy) {
  const g = graph();
  const posOf = (node, io, key) => {
    const p = socketWorldPos(node, io, key);
    if (drag.origins.has(node.id)) { p.x += dx; p.y += dy; }
    return p;
  };
  for (const path of wiresEl.querySelectorAll('path')) {
    const link = g.links[path.dataset.linkId];
    if (!link) continue;
    const from = g.nodes[link.fromNode], to = g.nodes[link.toNode];
    if (!from || !to) continue;
    path.setAttribute('d', wirePathD(posOf(from, 'out', link.fromSocket), posOf(to, 'in', link.toSocket)));
  }
}

function finishNodeDrag(e) {
  window.removeEventListener('pointermove', onNodeDragMove);
  if (!nodeDrag) return;
  const now = screenToWorld(e.clientX, e.clientY);
  const dx = now.x - nodeDrag.start.x, dy = now.y - nodeDrag.start.y;
  const origins = nodeDrag.origins;
  const moved = nodeDrag.moved;
  nodeDrag = null;
  if (!moved) return;
  // Position is presentation, so this must not invalidate the evaluator — dragging a node should
  // never restart a running simulation.
  mutate((g) => {
    for (const [id, o] of origins) {
      const n = g.nodes[id];
      if (n) { n.x = Math.round(o.x + dx); n.y = Math.round(o.y + dy); }
    }
  }, { nodeId: '__layout__' });
  render();
}

// ---------------------------------------------------------------- socket drag
let socketDrag = null;
function onSocketDown(e, node, io, socket) {
  root.focus();
  cachedRect = viewportEl.getBoundingClientRect();

  // Dragging from a connected INPUT picks the existing wire up rather than starting a second one —
  // the same gesture as unplugging a cable.
  if (io === 'in') {
    const existing = PGRAPH.linksInto(graph(), node.id, socket.key)[0];
    if (existing) {
      const src = graph().nodes[existing.fromNode];
      const srcSocket = PGRAPH.socketsOf(graph(), src).outputs.find((s) => s.key === existing.fromSocket);
      mutate((g) => { delete g.links[existing.id]; }, { structural: true });
      render();
      if (src && srcSocket) { beginSocketDrag(src, 'out', srcSocket, e); return; }
    }
  }
  beginSocketDrag(node, io, socket, e);
}

function beginSocketDrag(node, io, socket, e) {
  socketDrag = { node, io, socket, cur: screenToWorld(e.clientX, e.clientY) };
  const temp = document.createElementNS(wiresEl.namespaceURI, 'path');
  temp.setAttribute('class', 'node-wire-temp');
  temp.setAttribute('stroke', typeColor(socket.type));
  wiresEl.appendChild(temp);
  socketDrag.temp = temp;
  highlightCompatible(node, io, socket);
  window.addEventListener('pointermove', onSocketDragMove);
  window.addEventListener('pointerup', finishSocketDrag, { once: true });
  onSocketDragMove(e);
}

// Marks every socket this drag could legally land on. Uses the type system's own rule, so the
// highlighting can never disagree with what connect() will accept — including the field-lifting case,
// where a field output legitimately feeds a plain input.
function highlightCompatible(node, io, socket) {
  const g = graph();
  for (const div of nodesEl.querySelectorAll('.pnx-node')) {
    const other = g.nodes[div.dataset.nodeId];
    if (!other) continue;
    const { inputs, outputs } = PGRAPH.socketsOf(g, other);
    for (const dot of div.querySelectorAll('.pnx-socket')) {
      const dio = dot.dataset.socketIo;
      const key = dot.dataset.socketKey;
      if (dio === io) { dot.classList.add('dimmed'); continue; }   // in→in / out→out is never valid
      if (other.id === node.id) { dot.classList.add('dimmed'); continue; }
      const s = (dio === 'in' ? inputs : outputs).find((x) => x.key === key);
      if (!s) continue;
      const a = io === 'out' ? socket.type : s.type;
      const b = io === 'out' ? s.type : socket.type;
      const ok = T.containsGeneric(a) || T.containsGeneric(b) || T.canConnect(a, b);
      dot.classList.add(ok ? 'compatible' : 'dimmed');
      if (ok && !T.sameType(a, b) && !T.containsGeneric(a) && !T.containsGeneric(b)) {
        // A legal but non-identical pairing is a conversion. Saying so beats letting the value change
        // shape silently.
        dot.classList.add('converts');
        dot.title = `${dot.title}\n\nConverts ${T.formatType(a)} → ${T.formatType(b)} automatically.`;
      }
    }
  }
}

function clearHighlights() {
  for (const dot of nodesEl.querySelectorAll('.pnx-socket')) {
    dot.classList.remove('compatible', 'dimmed', 'converts');
  }
}

function onSocketDragMove(e) {
  if (!socketDrag) return;
  socketDrag.cur = screenToWorld(e.clientX, e.clientY);
  const from = socketWorldPos(socketDrag.node, socketDrag.io, socketDrag.socket.key);
  const d = socketDrag.io === 'out' ? wirePathD(from, socketDrag.cur) : wirePathD(socketDrag.cur, from);
  socketDrag.temp.setAttribute('d', d);
}

function finishSocketDrag(e) {
  window.removeEventListener('pointermove', onSocketDragMove);
  if (!socketDrag) return;
  const drag = socketDrag;
  socketDrag = null;
  drag.temp.remove();
  clearHighlights();

  const target = document.elementFromPoint(e.clientX, e.clientY);
  const dot = target?.closest?.('.pnx-socket');
  const box = target?.closest?.('.pnx-node');
  const heldSocket = { nodeId: drag.node.id, io: drag.io, key: drag.socket.key, socket: drag.socket };
  if (!dot || !box) {
    render();
    // Let go over empty canvas: offer the nodes this wire could plug into, wired on choosing.
    const onCanvas = !!target && target !== minimapEl && (target === viewportEl || target === worldEl || viewportEl.contains(target));
    if (onCanvas) openAddPalette(e.clientX, e.clientY, screenToWorld(e.clientX, e.clientY), { forSocket: heldSocket });
    return;
  }

  const otherId = box.dataset.nodeId;
  const otherIo = dot.dataset.socketIo;
  const otherKey = dot.dataset.socketKey;
  if (otherId === drag.node.id && otherIo === drag.io && otherKey === drag.socket.key) {
    // A click on a socket, not a drag: the same search, next to the socket.
    render();
    const wp = socketWorldPos(drag.node, drag.io, drag.socket.key);
    openAddPalette(e.clientX + 12, e.clientY, { x: wp.x + (drag.io === 'out' ? 60 : -60), y: wp.y }, { forSocket: heldSocket });
    return;
  }
  if (otherIo === drag.io) { toast(`Connect an output to an input`, 'error'); render(); return; }

  const a = drag.io === 'out'
    ? { node: drag.node.id, socket: drag.socket.key }
    : { node: otherId, socket: otherKey };
  const b = drag.io === 'out'
    ? { node: otherId, socket: otherKey }
    : { node: drag.node.id, socket: drag.socket.key };

  let res = null;
  mutate((g) => { res = PGRAPH.connect(g, a.node, a.socket, b.node, b.socket); }, { structural: true });
  if (!res?.ok) toast(`Cannot connect: ${res?.reason}`, 'error');
  render();
}

// ---------------------------------------------------------------- keyboard
function onKeyDown(e) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? ST.redo() : ST.undo(); render(); return; }
  if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); ST.redo(); render(); return; }
  if (ctrl && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); return; }
  if (ctrl && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteClipboard(); return; }
  if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
  if (ctrl && e.key.toLowerCase() === 'g') { e.preventDefault(); groupSelection(); return; }
  if (ctrl && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    for (const n of PGRAPH.nodesInScope(graph(), scope)) selected.add(n.id);
    render();
    return;
  }
  if (ctrl && e.key.toLowerCase() === 'l') { e.preventDefault(); autoLayout(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    navigate(e.key.slice(5).toLowerCase());
    return;
  }
  if (e.key === 'Tab') { e.preventDefault(); cycleSocket(e.shiftKey ? -1 : 1); return; }
  if (e.key === 'Enter') { e.preventDefault(); onEnterKey(); return; }
  if (e.key === 'Escape') {
    e.preventDefault();
    if (paletteEl) { const live = paletteEl.isConnected; closeAddPalette(); if (live) return; }
    if (kbWire) { kbWire = null; toast('Wire cancelled'); render(); return; }
    if (focusSocket) { focusSocket = null; render(); return; }
    return;
  }
  if (e.key.toLowerCase() === 'h' && !ctrl) { e.preventDefault(); helpVisible = !helpVisible; renderHelp(); return; }
  if (e.key.toLowerCase() === 'a' && !ctrl) {
    e.preventDefault();
    const r = viewportEl.getBoundingClientRect();
    openAddPalette(r.left + r.width / 2 - 180, r.top + 80, viewportCenterWorld());
    return;
  }
  if (e.key.toLowerCase() === 'm' && !ctrl) { e.preventDefault(); for (const id of selected) toggleFlag(id, 'muted'); return; }
  if (e.key.toLowerCase() === 'b' && !ctrl) { e.preventDefault(); for (const id of selected) toggleFlag(id, 'bypassed'); return; }
  if (e.key.toLowerCase() === 'f' && !ctrl) { e.preventDefault(); frameAll(); return; }
}

function deleteSelection() {
  if (!selected.size && !selectedLinks.size) return;
  focusSocket = null; kbWire = null;
  const ids = [...selected], links = [...selectedLinks];
  mutate((g) => {
    for (const id of links) delete g.links[id];
    for (const id of ids) PGRAPH.removeNode(g, id);
  }, { structural: true });
  selected.clear(); selectedLinks.clear();
  render();
}

function copySelection() {
  const g = graph();
  const ids = [...selected].filter((id) => g.nodes[id] && !PGRAPH.isGroupBoundaryType(g.nodes[id].type));
  if (!ids.length) return;
  clipboard = {
    nodes: ids.map((id) => ({ ...structuredClone(g.nodes[id]) })),
    links: Object.values(g.links)
      .filter((l) => ids.includes(l.fromNode) && ids.includes(l.toNode))
      .map((l) => ({ ...l })),
  };
  toast(`Copied ${ids.length} node${ids.length === 1 ? '' : 's'}`);
}

function pasteClipboard() {
  if (!clipboard?.nodes?.length) return;
  const idMap = new Map();
  mutate((g) => {
    for (const n of clipboard.nodes) {
      const copy = PGRAPH.newNode(g, n.type, n.x + 30, n.y + 30, { scope, values: structuredClone(n.values || {}) });
      if (n.label) copy.label = n.label;
      if (n.muted) copy.muted = true;
      if (n.bypassed) copy.bypassed = true;
      idMap.set(n.id, copy.id);
    }
    for (const l of clipboard.links) {
      const a = idMap.get(l.fromNode), b = idMap.get(l.toNode);
      if (a && b) PGRAPH.connect(g, a, l.fromSocket, b, l.toSocket);
    }
  }, { structural: true });
  selected.clear();
  for (const id of idMap.values()) selected.add(id);
  render();
}

function duplicateSelection() {
  copySelection();
  pasteClipboard();
}

// ---------------------------------------------------------------- keyboard navigation
// Arrows walk the graph, Tab walks a node's sockets, Enter starts a wire from the focused socket and
// completes it on another node's socket. The whole editor is usable without a mouse.
function singleSelected() {
  if (selected.size !== 1) return null;
  return graph().nodes[[...selected][0]] || null;
}

function navigate(dir) {
  const nodes = PGRAPH.nodesInScope(graph(), scope);
  if (!nodes.length) return;
  const cur = singleSelected();
  let next;
  if (!cur) {
    // Nothing selected: start at the top-left node.
    next = nodes.slice().sort((a, b) => a.x - b.x || a.y - b.y)[0];
  } else {
    next = TOOLS.nearestInDirection(nodes, cur, dir, (n) => TOOLS.boxSize(graph(), n));
    if (!next) return;
  }
  selected.clear(); selectedLinks.clear();
  selected.add(next.id);
  // While a wire is held, landing on a node focuses the first socket it could take.
  focusSocket = kbWire && next.id !== kbWire.nodeId ? firstFittingSocketOn(next) : null;
  ensureVisible(next);
  render();
}

function socketFits(row) {
  if (!kbWire || row.io === kbWire.io) return false;
  const a = kbWire.io === 'out' ? kbWire.socket.type : row.socket.type;
  const b = kbWire.io === 'out' ? row.socket.type : kbWire.socket.type;
  return T.containsGeneric(a) || T.containsGeneric(b) || T.canConnect(a, b);
}

function firstFittingSocketOn(node) {
  const row = rowsOf(node).find((r) => r.socket.socket !== false && socketFits(r));
  return row ? { nodeId: node.id, io: row.io, key: row.socket.key } : null;
}

function cycleSocket(delta) {
  const node = singleSelected();
  if (!node) { navigate('right'); return; }
  let list = rowsOf(node).filter((r) => r.socket.socket !== false);
  if (kbWire && node.id !== kbWire.nodeId) list = list.filter(socketFits);
  if (!list.length) { if (kbWire) toast('Nothing on this node takes that wire', 'error'); return; }
  let idx = list.findIndex((r) => focusSocket && focusSocket.nodeId === node.id && r.io === focusSocket.io && r.socket.key === focusSocket.key);
  idx = idx < 0 ? (delta > 0 ? 0 : list.length - 1) : (idx + delta + list.length) % list.length;
  focusSocket = { nodeId: node.id, io: list[idx].io, key: list[idx].socket.key };
  render();
}

function onEnterKey() {
  if (kbWire) {
    if (!focusSocket || focusSocket.nodeId === kbWire.nodeId) {
      toast('Arrow to another node, Tab to one of its sockets, then Enter to connect (Esc cancels)');
      return;
    }
    const a = kbWire.io === 'out' ? kbWire : focusSocket;
    const b = kbWire.io === 'out' ? focusSocket : kbWire;
    let res = null;
    mutate((g) => { res = PGRAPH.connect(g, a.nodeId, a.key, b.nodeId, b.key); }, { structural: true });
    if (!res?.ok) { toast(`Cannot connect: ${res?.reason}`, 'error'); return; }
    kbWire = null;
    render();
    return;
  }
  if (focusSocket) {
    const node = graph().nodes[focusSocket.nodeId];
    const socket = node && PGRAPH.findSocket(graph(), node, focusSocket.key, focusSocket.io);
    if (!socket) { focusSocket = null; render(); return; }
    kbWire = { nodeId: node.id, io: focusSocket.io, key: focusSocket.key, socket };
    toast(`Wire from ${socket.label}: arrow to a node, Tab to a socket, Enter to connect, Esc to cancel`);
    render();
    return;
  }
  if (singleSelected()) cycleSocket(1);
}

// The wire being built with the keyboard, drawn like a dragged one: from its socket to the focused
// socket on the node the arrows landed on, or a short stub while there is no target yet.
function renderKbWire() {
  if (!kbWire) return;
  const from = graph().nodes[kbWire.nodeId];
  if (!from) { kbWire = null; return; }
  const a = socketWorldPos(from, kbWire.io, kbWire.key);
  let b = { x: a.x + (kbWire.io === 'out' ? 70 : -70), y: a.y };
  if (focusSocket && focusSocket.nodeId !== kbWire.nodeId && graph().nodes[focusSocket.nodeId]) {
    b = socketWorldPos(graph().nodes[focusSocket.nodeId], focusSocket.io, focusSocket.key);
  }
  const path = document.createElementNS(wiresEl.namespaceURI, 'path');
  path.setAttribute('class', 'node-wire-temp');
  path.setAttribute('stroke', typeColor(kbWire.socket.type));
  path.setAttribute('d', kbWire.io === 'out' ? wirePathD(a, b) : wirePathD(b, a));
  wiresEl.appendChild(path);
}

// Pan just enough that the node is on screen, keeping the zoom.
function ensureVisible(node) {
  const W = viewportEl.clientWidth, H = viewportEl.clientHeight;
  if (!W || !H) return;
  const margin = 24;
  const sx = node.x * view.k + view.x, sy = node.y * view.k + view.y;
  const sw = NODE_W * view.k, sh = TOOLS.boxHeight(graph(), node) * view.k;
  let dx = 0, dy = 0;
  if (sx < margin) dx = margin - sx; else if (sx + sw > W - margin) dx = (W - margin) - (sx + sw);
  if (sy < margin) dy = margin - sy; else if (sy + sh > H - margin) dy = (H - margin) - (sy + sh);
  if (dx || dy) { view.x += dx; view.y += dy; applyTransform(); }
}

// ---------------------------------------------------------------- minimap
// A small canvas in the viewport's corner: every node box in the current scope and the rectangle the
// viewport shows. Click or drag on it to move the view. The model (node rects and their bounds) is
// rebuilt only when the document renders; a pan or zoom just redraws, and draws are coalesced to one
// per animation frame, so scrolling the canvas never allocates for the map.
const MINIMAP_W = 200, MINIMAP_H = 132, MINIMAP_PAD = 4;
function buildMinimap() {
  minimapEl = el('canvas', 'pnx-minimap');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  minimapEl.width = Math.round(MINIMAP_W * dpr);
  minimapEl.height = Math.round(MINIMAP_H * dpr);
  minimapEl.style.width = MINIMAP_W + 'px';
  minimapEl.style.height = MINIMAP_H + 'px';
  minimapEl.title = 'Overview — click or drag to move the view';
  minimapCtx = minimapEl.getContext('2d');
  try { accentColour = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || accentColour; } catch (e) { /* keep the default */ }
  let down = false;
  minimapEl.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); down = true; try { minimapEl.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no pointer */ } panToMinimap(e); });
  minimapEl.addEventListener('pointermove', (e) => { if (down) panToMinimap(e); });
  minimapEl.addEventListener('pointerup', () => { down = false; });
  minimapEl.addEventListener('pointercancel', () => { down = false; });
  minimapEl.addEventListener('dblclick', (e) => e.stopPropagation());
  minimapEl.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
  viewportEl.appendChild(minimapEl);
}

function rebuildMinimapModel() {
  const m = minimapModel;
  m.rects.clear();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of PGRAPH.nodesInScope(graph(), scope)) {
    const h = TOOLS.boxHeight(graph(), n);
    m.rects.set(n.id, { x: n.x, y: n.y, w: NODE_W, h, selected: selected.has(n.id) });
    if (n.x < minX) minX = n.x; if (n.y < minY) minY = n.y;
    if (n.x + NODE_W > maxX) maxX = n.x + NODE_W; if (n.y + h > maxY) maxY = n.y + h;
  }
  if (!m.rects.size) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
  m.minX = minX; m.minY = minY; m.maxX = maxX; m.maxY = maxY;
  scheduleMinimap();
}

function scheduleMinimap() {
  if (minimapRaf || !minimapCtx) return;
  minimapRaf = requestAnimationFrame(drawMinimap);
}

function drawMinimap() {
  minimapRaf = 0;
  if (!minimapCtx || !isOpen) return;
  const ctx = minimapCtx, m = minimapModel;
  const dpr = minimapEl.width / MINIMAP_W;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
  // The map covers the nodes AND the viewport, so the view rectangle is always on it.
  const vw = viewportEl.clientWidth / view.k, vh = viewportEl.clientHeight / view.k;
  const vx = -view.x / view.k, vy = -view.y / view.k;
  const minX = Math.min(m.minX, vx), minY = Math.min(m.minY, vy);
  const maxX = Math.max(m.maxX, vx + vw), maxY = Math.max(m.maxY, vy + vh);
  const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
  const scale = Math.min((MINIMAP_W - MINIMAP_PAD * 2) / spanX, (MINIMAP_H - MINIMAP_PAD * 2) / spanY);
  const ox = MINIMAP_PAD + ((MINIMAP_W - MINIMAP_PAD * 2) - spanX * scale) / 2;
  const oy = MINIMAP_PAD + ((MINIMAP_H - MINIMAP_PAD * 2) - spanY * scale) / 2;
  m.scale = scale; m.ox = ox; m.oy = oy; m.bx = minX; m.by = minY;
  for (const rc of m.rects.values()) {
    ctx.fillStyle = rc.selected ? accentColour : 'rgba(200, 200, 215, 0.55)';
    ctx.fillRect(ox + (rc.x - minX) * scale, oy + (rc.y - minY) * scale, Math.max(2, rc.w * scale), Math.max(2, rc.h * scale));
  }
  ctx.strokeStyle = accentColour;
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + (vx - minX) * scale + 0.5, oy + (vy - minY) * scale + 0.5, Math.max(2, vw * scale), Math.max(2, vh * scale));
}

function panToMinimap(e) {
  const m = minimapModel;
  if (!m.scale) return;
  const r = minimapEl.getBoundingClientRect();
  const wx = m.bx + (e.clientX - r.left - m.ox) / m.scale;
  const wy = m.by + (e.clientY - r.top - m.oy) / m.scale;
  view.x = viewportEl.clientWidth / 2 - wx * view.k;
  view.y = viewportEl.clientHeight / 2 - wy * view.k;
  applyTransform();
}

// ---------------------------------------------------------------- help panel
// The selected node's own documentation, read from the registry description every other surface
// (pnx_describe_node, the sheet, the tooltips) reads — nothing here is written per node.
function renderHelp() {
  if (!helpEl) return;
  helpEl.hidden = !helpVisible;
  if (!helpVisible) return;
  helpEl.innerHTML = '';
  const node = singleSelected();
  if (!node) { helpEl.appendChild(helpHint(selected.size)); return; }
  const def = REG.getNode(node.type);
  if (!def) {
    const isGroup = PGRAPH.isGroupInstanceType(node.type);
    const gd = isGroup ? graph().groups[PGRAPH.groupIdOfType(node.type)] : graph().groups[node.scope];
    helpEl.appendChild(el('h3', 'pnx-help-title', isGroup ? (gd?.name || 'Group') : (node.type === PGRAPH.GROUP_INPUT_TYPE ? 'Group Input' : 'Group Output')));
    helpEl.appendChild(el('p', 'pnx-help-summary', isGroup
      ? (gd?.description || 'A group: several nodes packaged as one. Open it to see how it is built.')
      : 'The boundary of the group you are inside: what comes in from outside, or what it hands back.'));
    if (gd) helpEl.appendChild(el('div', 'pnx-help-cat', `${gd.inputs?.length || 0} inputs · ${gd.outputs?.length || 0} outputs`));
    return;
  }
  const d = REG.describeNode(def.id);
  const head = el('div', 'pnx-help-head');
  head.appendChild(el('h3', 'pnx-help-title', d.label));
  if (d.pro) { const b = el('span', 'pnx-help-pro', 'Pro'); b.title = 'Part of the Cadence Pro simulation pack'; head.appendChild(b); }
  helpEl.appendChild(head);
  helpEl.appendChild(el('div', 'pnx-help-cat', `${d.category}${d.subcategory ? ' › ' + d.subcategory : ''}`));
  helpEl.appendChild(el('p', 'pnx-help-summary', d.summary));
  if (d.teach) helpEl.appendChild(el('p', 'pnx-help-teach', d.teach));
  if (d.explain) helpEl.appendChild(el('p', 'pnx-help-explain', d.explain));
  if (d.commonUses.length) {
    helpEl.appendChild(el('h4', null, 'Common uses'));
    const ul = el('ul', 'pnx-help-uses');
    for (const u of d.commonUses) ul.appendChild(el('li', null, u));
    helpEl.appendChild(ul);
  }
  const ex = el('div', 'pnx-help-export');
  ex.appendChild(el('span', `pnx-help-export-level is-${d.exportSupport}`, `Roblox: ${d.exportSupport}`));
  if (d.exportNote) ex.appendChild(el('span', 'muted', ` — ${d.exportNote}`));
  helpEl.appendChild(ex);
  if (d.performance) helpEl.appendChild(el('div', 'pnx-help-perf', `Cost: ${d.performance}`));
  const io = (title, list) => {
    if (!list.length) return;
    helpEl.appendChild(el('h4', null, title));
    for (const sk of list) {
      const line = el('div', 'pnx-help-socket');
      line.appendChild(el('b', null, sk.label));
      line.appendChild(el('span', 'muted', ` ${sk.type}${sk.unit ? ' · ' + sk.unit : ''}${sk.connectable === false ? ' · mode' : ''}`));
      if (sk.description) line.appendChild(el('div', 'muted', sk.description));
      helpEl.appendChild(line);
    }
  };
  io('Inputs', d.inputs);
  io('Outputs', d.outputs);
}

function helpHint(count) {
  const wrap = el('div', 'pnx-help-hint');
  wrap.appendChild(el('h3', 'pnx-help-title', count > 1 ? `${count} nodes selected` : 'Node help'));
  wrap.appendChild(el('p', 'pnx-help-summary', count > 1 ? 'Select one node to read what it does.' : 'Select a node to read what it does, what it takes and how it exports to Roblox.'));
  const keys = el('div', 'pnx-help-keys');
  const row = (k, what) => { const r = el('div'); const kb = el('kbd', null, k); r.append(kb, el('span', null, what)); keys.appendChild(r); };
  row('← ↑ → ↓', 'Move the selection to the nearest node');
  row('Tab', 'Step through the selected node\'s sockets');
  row('Enter', 'Start a wire from the socket, or finish it on another');
  row('Esc', 'Cancel the wire');
  row('Delete', 'Remove the selection');
  row('Ctrl+D', 'Duplicate');
  row('Ctrl+L', 'Auto-layout');
  row('A', 'Add a node');
  row('F', 'Frame everything');
  row('H', 'Hide this panel');
  row('Drag a wire to empty space', 'Search for a node that fits it');
  wrap.appendChild(keys);
  return wrap;
}

// ---------------------------------------------------------------- test hooks
// The smoketest drives the editor through these the way a person does: real DOM events on the real
// canvas, and reads back what the editor believes. Not part of the MCP-facing API.
export function editorTest() {
  const state = () => ({
    open: isOpen, scope, helpVisible,
    selected: [...selected],
    focusSocket: focusSocket ? { ...focusSocket } : null,
    kbWire: kbWire ? { nodeId: kbWire.nodeId, io: kbWire.io, key: kbWire.key } : null,
    view: { ...view },
    paletteOpen: !!paletteEl,
  });
  return {
    state,
    select(ids) { selected.clear(); selectedLinks.clear(); for (const id of ids) if (graph().nodes[id]) selected.add(id); focusSocket = null; render(); return state(); },
    key(key, { ctrl = false, shift = false } = {}) {
      root.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ctrlKey: ctrl, shiftKey: shift }));
      return state();
    },
    dragSocketToSpace(nodeId, io, key) {
      const dot = nodesEl.querySelector(`[data-node-id="${nodeId}"] .pnx-socket[data-socket-io="${io}"][data-socket-key="${key}"]`);
      if (!dot) return { ok: false, reason: 'no such socket on the canvas' };
      const dr = dot.getBoundingClientRect();
      const vr = viewportEl.getBoundingClientRect();
      let empty = null;
      for (const [fx, fy] of [[0.5, 0.9], [0.5, 0.1], [0.9, 0.5], [0.1, 0.5], [0.3, 0.9], [0.7, 0.1], [0.15, 0.85]]) {
        const px = vr.left + vr.width * fx, py = vr.top + vr.height * fy;
        const t = document.elementFromPoint(px, py);
        if (t === viewportEl || t === worldEl) { empty = [px, py]; break; }
      }
      if (!empty) return { ok: false, reason: 'no empty spot in view' };
      const opts = (x, y) => ({ clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true });
      dot.dispatchEvent(new PointerEvent('pointerdown', opts(dr.left + dr.width / 2, dr.top + dr.height / 2)));
      window.dispatchEvent(new PointerEvent('pointermove', opts(empty[0], empty[1])));
      window.dispatchEvent(new PointerEvent('pointerup', opts(empty[0], empty[1])));
      const rows = paletteEl ? [...paletteEl.querySelectorAll('.pnx-palette-row')] : [];
      return {
        ok: !!paletteEl, rows: rows.length, total: REG.currentNodes().length,
        placeholder: paletteEl?.querySelector('.pnx-palette-search')?.placeholder || '',
        hint: paletteEl?.querySelector('.pnx-palette-hint')?.textContent || '',
        labels: rows.slice(0, 8).map((r) => r.querySelector('.pnx-palette-label')?.textContent || ''),
        fitBadges: rows.filter((r) => r.querySelector('.pnx-badge-fit')).length,
      };
    },
    paletteChoose(query) {
      if (!paletteEl) return { ok: false, reason: 'the palette is not open' };
      const input = paletteEl.querySelector('.pnx-palette-search');
      if (query) { input.value = query; input.dispatchEvent(new Event('input', { bubbles: true })); }
      const rows = [...paletteEl.querySelectorAll('.pnx-palette-row')];
      const labels = rows.slice(0, 6).map((r) => r.querySelector('.pnx-palette-label')?.textContent || '');
      if (!rows.length) return { ok: false, rows: 0, labels };
      rows[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1 }));
      return { ok: true, chosen: labels[0], labels, rows: rows.length, selected: [...selected], paletteOpen: !!paletteEl };
    },
    minimap({ clickAt = null } = {}) {
      if (!minimapEl) return { present: false };
      drawMinimap();
      const before = { ...view };
      if (clickAt) {
        const r = minimapEl.getBoundingClientRect();
        minimapEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + r.width * clickAt[0], clientY: r.top + r.height * clickAt[1], bubbles: true, cancelable: true, pointerId: 1, button: 0 }));
        minimapEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0 }));
      }
      return { present: true, width: minimapEl.clientWidth, height: minimapEl.clientHeight, rects: minimapModel.rects.size, scale: minimapModel.scale, before, after: { ...view } };
    },
    help() {
      if (!helpEl) return { present: false };
      return {
        present: true, visible: helpVisible && !helpEl.hidden,
        title: helpEl.querySelector('.pnx-help-title')?.textContent || '',
        text: helpEl.textContent || '',
        pro: !!helpEl.querySelector('.pnx-help-pro'),
        sections: [...helpEl.querySelectorAll('h4')].map((h) => h.textContent),
        exportLevel: helpEl.querySelector('.pnx-help-export-level')?.textContent || '',
      };
    },
    autoLayout: () => autoLayout(),
  };
}

// ---------------------------------------------------------------- library
// The recipes are compositions of primitives, so inserting one is the same as a person wiring it by
// hand — and they can open it and see exactly that.
export function insertRecipe(recipeId, pos = null) {
  const target = pos || viewportCenterWorld();
  let built = null, inst = null;
  mutate((g) => {
    built = PLIB.buildRecipe(g, recipeId);
    if (built.ok) inst = PGROUPS.instantiateGroup(g, built.groupId, Math.round(target.x), Math.round(target.y), { scope });
  }, { structural: true });
  if (!built?.ok) { toast(built?.reason || 'Could not build that recipe', 'error'); return; }
  selected.clear();
  if (inst?.nodeId) selected.add(inst.nodeId);
  render();
  toast(`Added ${built.name} — open it to see how it is built`);
}
