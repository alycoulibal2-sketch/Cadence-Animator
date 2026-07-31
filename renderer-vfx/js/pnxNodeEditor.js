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
import { pickColor } from '../../renderer/js/colorPicker.js';
import '../../renderer/js/pnx/nodes/index.js';

// Wide enough for the longest input label the registry actually uses alongside its control. Measured,
// not guessed: at 210px "Particle limit", "Flipbook columns" and "Initial attributes" all ellipsised
// to "Particle …", which makes two different sockets look like the same one.
const NODE_W = 268;
// Every socket dot is positioned from this, so it must equal the header's real rendered height or
// each dot sits a few pixels off its own row. The header is given this height explicitly below rather
// than inheriting .node-box-header's, so the two cannot drift apart.
const HEADER_H = 28;
const ROW_H = 22;
const SOCKET_R = 5;

let isOpen = false;
let root, viewportEl, worldEl, wiresEl, nodesEl, commentsEl, rubberEl, breadcrumbEl, statusEl;
let closeModal = null;
let view = { x: 0, y: 0, k: 1 };
let scope = PGRAPH.ROOT_SCOPE;          // which group's interior is being shown
const selected = new Set();
const selectedLinks = new Set();
let clipboard = null;
let cachedRect = null;

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
  root.appendChild(viewportEl);

  wireViewportEvents();
  root.addEventListener('keydown', onKeyDown);

  // Re-render on any document change, whoever made it. This is the whole of the "Claude adds a node,
  // the human sees it" requirement — MCP mutations go through ST.mutatePnx, which emits 'effect'.
  const onChange = () => render();
  ST.on('effect', onChange);
  ST.on('pnx', onChange);

  const m = modal({
    title: '', body: root,
    onClose: () => { isOpen = false; ST.off('effect', onChange); ST.off('pnx', onChange); },
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
  for (const node of PGRAPH.nodesInScope(graph(), scope)) nodesEl.appendChild(buildNodeEl(node));
  renderWires();
  renderBreadcrumb();
  renderStatus();
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
function renderStatus() {
  const rep = PNX.report();
  const errors = rep.diagnostics.filter((d) => d.severity === 'error');
  const warnings = rep.diagnostics.filter((d) => d.severity === 'warning');
  if (errors.length) {
    statusEl.textContent = `✕ ${errors[0].message}`;
    statusEl.title = errors.map((d) => `• ${d.message}`).join('\n');
    statusEl.className = 'node-editor-errors has-error';
  } else if (warnings.length) {
    statusEl.textContent = `⚠ ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`;
    statusEl.title = warnings.map((d) => `• ${d.message}`).join('\n');
    statusEl.className = 'node-editor-errors has-warning';
  } else {
    // An info diagnostic is worth showing where the work happens — the commonest one explains why a
    // brand-new effect draws nothing at frame 0, which is otherwise a puzzle with no message.
    const info = rep.diagnostics.find((d) => d.severity === 'info');
    const st = rep.stats || {};
    const counts = `${st.nodes || 0} nodes · ${st.drawnElements || 0} drawn`;
    statusEl.textContent = info ? info.message : counts;
    statusEl.title = info ? `${info.message}\n\n${counts}` : 'The graph evaluates without errors.';
    statusEl.className = 'node-editor-errors ' + (info ? 'is-info' : 'is-clean');
  }
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
function buildControl(node, socket) {
  const type = socket.type;
  const inner = T.isFieldType(type) ? type.param : type;   // a field input still accepts a constant
  const name = inner?.name;
  const cur = node.values?.[socket.key] !== undefined ? node.values[socket.key]
    : (socket.default !== undefined ? socket.default : T.defaultValue(inner));
  const commit = (v) => mutate((g) => PGRAPH.setNodeValue(g, node.id, socket.key, v), { nodeId: node.id });
  const stop = (e) => e.stopPropagation();   // a control must never start a node drag

  // An explicit option list is a dropdown whatever the underlying type.
  if (socket.options) {
    const sel = el('select', 'fld pnx-ctrl');
    for (const o of socket.options) sel.add(new Option(String(o), String(o)));
    sel.value = String(cur);
    sel.addEventListener('pointerdown', stop);
    sel.addEventListener('change', () => commit(sel.value));
    return sel;
  }

  switch (name) {
    case 'bool': {
      const c = el('input', 'pnx-ctrl-check');
      c.type = 'checkbox';
      c.checked = !!cur;
      c.addEventListener('pointerdown', stop);
      c.addEventListener('change', () => commit(c.checked));
      return c;
    }
    case 'string': {
      const i = el('input', 'fld pnx-ctrl');
      i.type = 'text';
      i.value = cur ?? '';
      i.addEventListener('pointerdown', stop);
      i.addEventListener('change', () => commit(i.value));
      return i;
    }
    case 'float': case 'int': {
      const wrap = el('div', 'pnx-num');
      const i = el('input', 'fld pnx-ctrl');
      i.type = 'number';
      i.step = name === 'int' ? 1 : 0.01;
      if (socket.min !== undefined) i.min = socket.min;
      if (socket.max !== undefined) i.max = socket.max;
      i.value = Number(cur) || 0;
      i.addEventListener('pointerdown', stop);
      i.addEventListener('change', () => commit(name === 'int' ? Math.round(+i.value || 0) : (+i.value || 0)));
      wrap.appendChild(i);
      // A slider only where the metadata gives a real bounded range — inventing one for an unbounded
      // value would imply a limit the engine does not have.
      if (socket.min !== undefined && socket.max !== undefined && socket.max > socket.min) {
        const s = el('input', 'pnx-slider');
        s.type = 'range';
        s.min = socket.min; s.max = socket.max;
        s.step = (socket.max - socket.min) / 200;
        s.value = Number(cur) || 0;
        s.addEventListener('pointerdown', stop);
        s.addEventListener('input', () => { i.value = s.value; });
        s.addEventListener('change', () => commit(name === 'int' ? Math.round(+s.value) : (+s.value)));
        wrap.appendChild(s);
      }
      return wrap;
    }
    case 'vector2': case 'vector3': case 'vector4': case 'quaternion': {
      const n = { vector2: 2, vector3: 3, vector4: 4, quaternion: 4 }[name];
      const wrap = el('div', 'pnx-vec');
      const axes = ['x', 'y', 'z', 'w'];
      const v = Array.isArray(cur) ? cur : new Array(n).fill(0);
      for (let k = 0; k < n; k++) {
        const i = el('input', 'fld');
        i.type = 'number'; i.step = 0.1; i.value = v[k] ?? 0; i.title = axes[k];
        i.addEventListener('pointerdown', stop);
        i.addEventListener('change', () => {
          const next = [...(Array.isArray(node.values?.[socket.key]) ? node.values[socket.key] : v)];
          next[k] = +i.value || 0;
          commit(next);
        });
        wrap.appendChild(i);
      }
      return wrap;
    }
    case 'color': {
      const sw = el('button', 'pnx-swatch');
      const rgba = Array.isArray(cur) ? cur : [1, 1, 1, 1];
      const css = (c) => `rgb(${Math.round(Math.min(1, c[0]) * 255)},${Math.round(Math.min(1, c[1]) * 255)},${Math.round(Math.min(1, c[2]) * 255)})`;
      sw.style.background = css(rgba);
      sw.title = 'Click to choose a colour';
      sw.addEventListener('pointerdown', stop);
      sw.addEventListener('click', () => {
        pickColor({
          title: socket.label,
          initial: [rgba[0], rgba[1], rgba[2]],
          onLive: (c) => { sw.style.background = css(c); },
        }).then((c) => { if (c) commit([c[0], c[1], c[2], rgba[3] ?? 1]); });
      });
      return sw;
    }
    case 'curve': {
      const b = el('button', 'pnx-mini', 'Edit curve');
      b.addEventListener('pointerdown', stop);
      b.addEventListener('click', () => openCurveDialog(node, socket, cur));
      return b;
    }
    case 'gradient': {
      const b = el('button', 'pnx-mini pnx-gradient-btn', '');
      b.style.background = gradientCss(cur);
      b.title = 'Edit the gradient';
      b.addEventListener('pointerdown', stop);
      b.addEventListener('click', () => openGradientDialog(node, socket, cur));
      return b;
    }
    default:
      // geometry, material, texture2d, renderCommand, emitter, collider, instanceSet, volumeGrid,
      // transform, matrix4 — values that only ever arrive down a wire. Say so rather than showing a
      // box that cannot represent them.
      return null;
  }
}

function gradientCss(g) {
  const stops = Array.isArray(g?.stops) ? g.stops : [];
  if (!stops.length) return 'linear-gradient(90deg,#000,#fff)';
  const parts = stops.slice().sort((a, b) => (a.u ?? 0) - (b.u ?? 0))
    .map((s) => `${s.v || '#ffffff'} ${Math.round((s.u ?? 0) * 100)}%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

// ---------------------------------------------------------------- curve / gradient dialogs
// Small dedicated editors. A curve and a gradient are the two value kinds where a numeric field is
// genuinely the wrong tool — you need to see the shape.
function openCurveDialog(node, socket, cur) {
  const keys = (Array.isArray(cur?.keys) ? cur.keys : [{ t: 0, v: 0 }, { t: 1, v: 1 }]).map((k) => ({ ...k }));
  const wrap = el('div', 'pnx-curve-dialog');
  const cv = el('canvas', 'pnx-curve-canvas');
  cv.width = 420; cv.height = 220;
  wrap.appendChild(cv);
  const hint = el('p', 'muted', 'Click to add a point, drag to move one, right-click a point to remove it.');
  hint.style.cssText = 'font-size:11px;margin-top:8px;opacity:.7';
  wrap.appendChild(hint);

  const pad = 18;
  const bounds = () => {
    const vs = keys.map((k) => k.v);
    const lo = Math.min(0, ...vs), hi = Math.max(1, ...vs);
    return { lo, hi: hi === lo ? lo + 1 : hi };
  };
  const toPx = (k) => {
    const { lo, hi } = bounds();
    return { x: pad + k.t * (cv.width - pad * 2), y: cv.height - pad - ((k.v - lo) / (hi - lo)) * (cv.height - pad * 2) };
  };
  const fromPx = (x, y) => {
    const { lo, hi } = bounds();
    return {
      t: Math.max(0, Math.min(1, (x - pad) / (cv.width - pad * 2))),
      v: lo + (1 - (y - pad) / (cv.height - pad * 2)) * (hi - lo),
    };
  };
  const draw = () => {
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#15151c'; c.fillRect(0, 0, cv.width, cv.height);
    c.strokeStyle = '#2a2a36'; c.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad + (i / 4) * (cv.height - pad * 2);
      c.beginPath(); c.moveTo(pad, y); c.lineTo(cv.width - pad, y); c.stroke();
    }
    keys.sort((a, b) => a.t - b.t);
    c.strokeStyle = '#7c8cff'; c.lineWidth = 2;
    c.beginPath();
    keys.forEach((k, i) => { const p = toPx(k); i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); });
    c.stroke();
    c.fillStyle = '#fff';
    for (const k of keys) { const p = toPx(k); c.beginPath(); c.arc(p.x, p.y, 4, 0, Math.PI * 2); c.fill(); }
  };
  let drag = null;
  cv.addEventListener('pointerdown', (e) => {
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = keys.findIndex((k) => { const p = toPx(k); return Math.hypot(p.x - x, p.y - y) < 8; });
    if (e.button === 2) {
      e.preventDefault();
      if (hit >= 0 && keys.length > 2) { keys.splice(hit, 1); draw(); }
      return;
    }
    if (hit >= 0) { drag = hit; cv.setPointerCapture(e.pointerId); return; }
    keys.push(fromPx(x, y));
    draw();
  });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointermove', (e) => {
    if (drag === null) return;
    const r = cv.getBoundingClientRect();
    const p = fromPx(e.clientX - r.left, e.clientY - r.top);
    keys[drag].t = p.t; keys[drag].v = p.v;
    draw();
  });
  cv.addEventListener('pointerup', () => { drag = null; });
  draw();

  modal({
    title: `Curve — ${socket.label}`,
    body: wrap,
    actions: [
      { label: 'Apply', icon: 'save', run: () => mutate((g) => PGRAPH.setNodeValue(g, node.id, socket.key, { kind: 'float', keys: keys.map((k) => ({ t: k.t, v: k.v })) }), { nodeId: node.id }) },
      { label: 'Cancel', run: () => {} },
    ],
  });
}

function openGradientDialog(node, socket, cur) {
  const stops = (Array.isArray(cur?.stops) ? cur.stops : [{ u: 0, v: '#000000' }, { u: 1, v: '#ffffff' }]).map((s) => ({ ...s }));
  const wrap = el('div', 'pnx-gradient-dialog');
  const bar = el('div', 'pnx-gradient-bar');
  const list = el('div', 'pnx-gradient-stops');
  const redraw = () => {
    stops.sort((a, b) => a.u - b.u);
    bar.style.background = gradientCss({ stops });
    list.innerHTML = '';
    stops.forEach((s, i) => {
      const row = el('div', 'pnx-gradient-row');
      const pos = el('input', 'fld');
      pos.type = 'number'; pos.step = 0.01; pos.min = 0; pos.max = 1; pos.value = s.u;
      pos.addEventListener('change', () => { s.u = Math.max(0, Math.min(1, +pos.value || 0)); redraw(); });
      const col = el('input');
      col.type = 'color'; col.value = s.v || '#ffffff';
      col.addEventListener('input', () => { s.v = col.value; redraw(); });
      const del = el('button', 'tb-btn', '✕');
      del.title = 'Remove this stop';
      del.addEventListener('click', () => { if (stops.length > 2) { stops.splice(i, 1); redraw(); } });
      row.append(pos, col, del);
      list.appendChild(row);
    });
  };
  const add = el('button', 'tb-btn', '＋ Add stop');
  add.addEventListener('click', () => { stops.push({ u: 0.5, v: '#ffffff' }); redraw(); });
  wrap.append(bar, list, add);
  redraw();

  modal({
    title: `Gradient — ${socket.label}`,
    body: wrap,
    actions: [
      { label: 'Apply', icon: 'save', run: () => mutate((g) => PGRAPH.setNodeValue(g, node.id, socket.key, { kind: 'color', stops: stops.map((s) => ({ u: s.u, v: s.v })) }), { nodeId: node.id }) },
      { label: 'Cancel', run: () => {} },
    ],
  });
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

function openAddPalette(screenX, screenY, worldPos) {
  closeAddPalette();
  const p = el('div', 'pnx-palette');
  paletteEl = p;
  p.style.left = Math.min(screenX, window.innerWidth - 380) + 'px';
  p.style.top = Math.min(screenY, window.innerHeight - 420) + 'px';

  const input = el('input', 'fld pnx-palette-search');
  input.type = 'text';
  input.placeholder = 'Search 354 nodes…  (try "swirl", "fade", "bounce")';
  const results = el('div', 'pnx-palette-results');
  p.append(input, results);
  document.body.appendChild(p);

  let items = [];
  let active = 0;

  const renderResults = () => {
    const q = input.value.trim();
    items = q
      ? REG.searchNodes(q, { limit: 60 })
      : REG.currentNodes().slice().sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
    results.innerHTML = '';
    if (!items.length) {
      results.appendChild(el('div', 'pnx-palette-empty', `Nothing matches "${q}".`));
      return;
    }
    let lastCat = null;
    items.forEach((n, i) => {
      if (!q && n.category !== lastCat) {
        lastCat = n.category;
        results.appendChild(el('div', 'pnx-palette-cat', n.category));
      }
      const row = el('div', 'pnx-palette-row' + (i === active ? ' active' : ''));
      row.dataset.index = i;
      const main = el('div', 'pnx-palette-main');
      main.appendChild(el('span', 'pnx-palette-label', n.label));
      main.appendChild(el('span', 'pnx-palette-badge', n.category));
      row.appendChild(main);
      row.appendChild(el('div', 'pnx-palette-desc', n.summary));
      row.addEventListener('pointerdown', (e) => { e.preventDefault(); addNode(n.id, worldPos); closeAddPalette(); });
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
    else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) { addNode(items[active].id, worldPos); closeAddPalette(); } }
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
  if (!dot || !box) { render(); return; }

  const otherId = box.dataset.nodeId;
  const otherIo = dot.dataset.socketIo;
  const otherKey = dot.dataset.socketKey;
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
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
  if (e.key.toLowerCase() === 'a' && !ctrl) {
    e.preventDefault();
    const r = viewportEl.getBoundingClientRect();
    openAddPalette(r.left + r.width / 2 - 180, r.top + 80, viewportCenterWorld());
    return;
  }
  if (e.key.toLowerCase() === 'm' && !ctrl) { e.preventDefault(); for (const id of selected) toggleFlag(id, 'muted'); return; }
  if (e.key.toLowerCase() === 'b' && !ctrl) { e.preventDefault(); for (const id of selected) toggleFlag(id, 'bypassed'); return; }
  if (e.key.toLowerCase() === 'f' && !ctrl) { e.preventDefault(); frameAll(); return; }
  if (e.key === 'Escape') { e.preventDefault(); closeAddPalette(); }
}

function deleteSelection() {
  if (!selected.size && !selectedLinks.size) return;
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
