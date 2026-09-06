// The Effect Sheet — the human-facing surface of a procedural effect (docs/effect-sheet.md).
//
//   things you can see  →  properties  →  a value, or the phrase of what feeds it
//
// with every value carrying a ▾ menu: "how does this vary?" Choosing an entry builds the same nodes a
// person would place on the canvas and wires them in, through ST.mutatePnx — one object, one undo
// history, one write path shared with the node editor and with Claude's MCP tools. "Show as nodes"
// opens the canvas on the same graph.
//
// NOTHING HERE IS HAND-MAINTAINED PER NODE. Rows come from sheet.js's projection (registry metadata +
// the graph's values), controls from pnxControls.js (generated from socket metadata), menus from
// menus.js (compositions of registry nodes). Thumbnails are the real evaluator on a scratch copy.
//
// The DOM is rebuilt on every document change — it is cheap for the graphs a sheet describes — except
// while the user is typing in or scrubbing a control, when a rebuild would pull the control out from
// under the pointer; those rebuilds are deferred to the commit.

import * as ST from './studioState.js';
import * as PNX from './pnxStudio.js';
import * as PGRAPH from '../../renderer/js/pnx/graph.js';
import * as SHEET from '../../renderer/js/pnx/sheet.js';
import * as MENUS from '../../renderer/js/pnx/menus.js';
import * as REG from '../../renderer/js/pnx/registry.js';
import * as T from '../../renderer/js/pnx/types.js';
import { buildControl, el, gradientCss, rgbCss, curveSparkline } from './pnxControls.js';
import { renderQueue } from './pnxThumbs.js';
import { toast, showContextMenu, modal, promptModal } from '../../renderer/js/ui.js';
import { openPnxNodeEditor } from './pnxNodeEditor.js';

const graph = () => ST.state.pnx;
const BADGE = { native: ['native', 'Plays natively in Roblox'], converted: ['converted', 'Becomes a different Roblox instance with the same intent'], approximated: ['approx.', 'Roblox plays something close to it'], baked: ['baked', 'Exported as a frame-by-frame recording'], unsupported: ['no export', 'Roblox cannot play this'], sequence: ['native', 'Becomes a Roblox NumberSequence / ColorSequence'], range: ['native', 'Becomes a Roblox random range'], scheduled: ['scripted', 'Becomes scheduled property writes in the exported script'] };

let host = null, rootEl = null;
let expanded = new Set();        // node ids whose "more…" rows are shown
let opened = new Set();          // source entries shown expanded (nodeId)
let holdRebuild = 0;             // > 0 while a control is mid-gesture
let pendingRebuild = false;
let menuEl = null, cancelThumbs = null;
let hot = null;                  // { nodeId, key } the pointer is over — mirrored by stage handles

export function mountEffectSheet(container) {
  host = container;
  rootEl = el('div', 'sheet');
  host.appendChild(rootEl);
  const onChange = () => scheduleRebuild();
  ST.on('effect', onChange);
  ST.on('pnx', onChange);
  const onPlayhead = () => refreshLive();
  ST.on('playhead', onPlayhead);
  // A handle hovered on the stage lights its row here, the mirror of the row lighting the handle.
  const onStageHot = (h) => { for (const row of rootEl.querySelectorAll('.sheet-row.hot')) row.classList.remove('hot'); if (h) rootEl.querySelector(`.sheet-row[data-node-id="${h.nodeId}"][data-key="${h.key}"]`)?.classList.add('hot'); };
  ST.on('stageHot', onStageHot);
  rebuild();
  return {
    rebuild,
    destroy() {
      ST.off('effect', onChange); ST.off('pnx', onChange); ST.off('playhead', onPlayhead); ST.off('stageHot', onStageHot);
      closeMenu();
      rootEl.remove(); rootEl = null; host = null;
    },
  };
}

export function sheetHot() { return hot; }
function setHot(next) {
  hot = next;
  ST.emit('sheetHot', hot);
}

let rebuildQueued = false;
function scheduleRebuild() {
  if (holdRebuild > 0 || (rootEl && rootEl.contains(document.activeElement))) { pendingRebuild = true; return; }
  if (rebuildQueued) return;
  rebuildQueued = true;
  requestAnimationFrame(() => { rebuildQueued = false; rebuild(); });
}
function withHold(fn) {
  holdRebuild++;
  try { return fn(); } finally { holdRebuild--; if (pendingRebuild && holdRebuild === 0) { pendingRebuild = false; rebuild(); } }
}

// Every write goes through here — the same mutator the node editor and MCP use.
function commitValue(nodeId, key, value) {
  ST.mutatePnx((g) => PGRAPH.setNodeValue(g, nodeId, key, value), { nodeId });
}
function liveValue(nodeId, key, value) {
  ST.mutatePnx((g) => PGRAPH.setNodeValue(g, nodeId, key, value), { nodeId, undoable: false });
}
function structural(fn) {
  return ST.mutatePnx(fn, { structural: true });
}

// ---------------------------------------------------------------- rendering
function rebuild() {
  if (!rootEl || !graph()) return;
  pendingRebuild = false;
  const scrollTop = host.scrollTop;
  rootEl.innerHTML = '';
  const g = graph();
  const p = SHEET.projectGraph(g);
  const owners = new Map();   // nodeId -> thing nodeId, for placing warnings
  const claim = (entry, thingId) => { owners.set(entry.nodeId, thingId); for (const r of entry.rows || []) for (const s of r.sources || []) claim(s, thingId); };
  for (const t of p.things) claim(t, t.nodeId);

  // header: the effect's name lives on the title bar; here, one line about export
  const head = el('div', 'sheet-head');
  head.appendChild(el('span', 'sheet-head-title', 'Effect Sheet'));
  const rb = robloxBadge();
  if (rb) head.appendChild(rb);
  const nodesBtn = el('button', 'tb-btn sheet-nodes-btn', 'Show as nodes');
  nodesBtn.type = 'button';
  nodesBtn.title = 'The same effect, drawn as a node graph. Edit either; it is one object.';
  nodesBtn.addEventListener('click', () => openPnxNodeEditor());
  head.appendChild(nodesBtn);
  rootEl.appendChild(head);

  if (!p.things.length) {
    const empty = el('div', 'sheet-empty');
    empty.appendChild(el('div', 'sheet-empty-title', 'Nothing is drawn yet.'));
    empty.appendChild(el('div', 'sheet-empty-hint', 'Add a thing you can see — particles, a ring, a trail, a beam, a light — and change it from there.'));
    rootEl.appendChild(empty);
  }
  for (const thing of p.things) rootEl.appendChild(thingCard(thing, p));

  rootEl.appendChild(addThingButton());

  if (p.named.length) {
    const sec = el('div', 'sheet-named');
    sec.appendChild(el('div', 'sheet-section-title', 'Values used in several places'));
    for (const n of p.named) {
      const card = el('div', 'sheet-named-card');
      const h = el('div', 'sheet-named-head');
      h.appendChild(el('span', 'sheet-name', `«${n.name}»`));
      h.appendChild(el('span', 'sheet-named-label', n.label));
      h.appendChild(el('span', 'sheet-usedby', `used by ${n.usedBy.map((u) => u.label.toLowerCase()).join(', ')}`));
      const rename = el('button', 'sheet-icon-btn', '✎');
      rename.type = 'button'; rename.title = 'Rename this value';
      rename.addEventListener('click', async () => {
        const name = await promptModal({ title: 'Name this value', label: 'Name', initial: n.name, okLabel: 'Rename' });
        if (name) ST.mutatePnx((gg) => { gg.nodes[n.nodeId].label = name.trim(); }, { nodeId: n.nodeId });
      });
      h.appendChild(rename);
      card.appendChild(h);
      if (n.teach) card.appendChild(el('div', 'sheet-teach', n.teach));
      for (const r of n.rows || []) card.appendChild(rowEl(r, 1, p));
      sec.appendChild(card);
    }
    rootEl.appendChild(sec);
  }

  if (p.unused.length) {
    const sec = el('div', 'sheet-unused');
    sec.appendChild(el('div', 'sheet-section-title', 'Not used by anything drawn'));
    for (const u of p.unused) {
      const row = el('div', 'sheet-unused-row');
      row.appendChild(el('span', '', u.label));
      const del = el('button', 'sheet-icon-btn', '✕'); del.type = 'button'; del.title = 'Delete this node';
      del.addEventListener('click', () => { structural((gg) => PGRAPH.removeNode(gg, u.nodeId)); toast(`Deleted ${u.label} — Ctrl+Z restores it`); });
      const open = el('button', 'sheet-icon-btn', '⋯'); open.type = 'button'; open.title = 'Find it on the node canvas';
      open.addEventListener('click', () => openPnxNodeEditor());
      row.append(del, open);
      sec.appendChild(row);
    }
    rootEl.appendChild(sec);
  }

  const foot = el('div', 'sheet-foot');
  foot.dataset.role = 'stats';
  rootEl.appendChild(foot);
  refreshLive();
  host.scrollTop = scrollTop;
  attachWarnings(owners);
}

function robloxBadge() {
  let a = null;
  try { a = PNX.robloxAnalysis(); } catch (_) { return null; }
  if (!a || !a.rows) return null;
  const level = a.lossless ? 'native' : a.exportable ? (a.counts.baked ? 'baked' : 'converted') : 'unsupported';
  const [txt, title] = BADGE[level] || BADGE.unsupported;
  const b = el('span', `sheet-badge sheet-badge-${level}`, `Roblox: ${txt}`);
  b.title = title + (a.rows.length ? '\n' + a.rows.map((r) => `pass ${r.index + 1} (${r.kind}): ${r.level}`).join('\n') : '');
  return b;
}

function badgeFor(level) {
  if (!level) return null;
  const [txt, title] = BADGE[level] || [level, ''];
  const b = el('span', `sheet-badge sheet-badge-${level}`, txt);
  b.title = title;
  return b;
}

function thingCard(thing, p) {
  const card = el('div', 'sheet-card');
  card.dataset.nodeId = thing.nodeId;
  const head = el('div', 'sheet-card-head');
  const title = el('div', 'sheet-card-title');
  title.appendChild(el('b', '', thing.label));
  if (thing.teach) { const i = el('span', 'sheet-card-teach', thing.teach); title.appendChild(i); }
  head.appendChild(title);
  const right = el('div', 'sheet-card-right');
  if (!thing.drawn && !thing.result) {
    const nd = el('button', 'sheet-badge sheet-badge-unsupported', 'not drawn — connect');
    nd.type = 'button'; nd.title = 'This is not wired to the Effect Output, so it is not drawn. Click to connect it.';
    nd.addEventListener('click', () => {
      structural((gg) => {
        let out = Object.values(gg.nodes).find((n) => n.type.startsWith('cadence.render.output'));
        if (!out) out = PGRAPH.newNode(gg, 'cadence.render.output', 1000, 0);
        PGRAPH.connect(gg, thing.nodeId, 'out', out.id, 'passes');
      });
    });
    right.appendChild(nd);
  } else {
    const b = badgeFor(thing.exportSupport); if (b) right.appendChild(b);
  }
  const menuBtn = el('button', 'sheet-icon-btn', '⋯');
  menuBtn.type = 'button'; menuBtn.title = 'Rename, duplicate or remove';
  menuBtn.addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showContextMenu(r.left, r.bottom + 4, [
      { label: 'Rename…', run: async () => { const name = await promptModal({ title: 'Rename', label: 'Name', initial: thing.label, okLabel: 'Rename' }); if (name) ST.mutatePnx((gg) => { gg.nodes[thing.nodeId].label = name.trim(); }, { nodeId: thing.nodeId }); } },
      { label: 'Open on the node canvas', run: () => openPnxNodeEditor() },
      { label: 'Remove this thing', run: () => { structural((gg) => MENUS.removeThing(gg, thing.nodeId)); toast(`Removed ${thing.label} — Ctrl+Z restores it`); } },
    ]);
  });
  right.appendChild(menuBtn);
  head.appendChild(right);
  card.appendChild(head);

  const primary = thing.rows.filter((r) => r.primary || r.kind === 'source');
  const rest = thing.rows.filter((r) => !(r.primary || r.kind === 'source'));
  for (const r of primary) card.appendChild(rowEl(r, 0, p));
  if (rest.length) {
    const more = el('button', 'sheet-more', expanded.has(thing.nodeId) ? 'fewer settings' : `more settings (${rest.length})`);
    more.type = 'button';
    more.addEventListener('click', () => { if (expanded.has(thing.nodeId)) expanded.delete(thing.nodeId); else expanded.add(thing.nodeId); rebuild(); });
    card.appendChild(more);
    if (expanded.has(thing.nodeId)) for (const r of rest) card.appendChild(rowEl(r, 0, p));
  }
  card.appendChild(el('div', 'sheet-warnings'));
  return card;
}

function addThingButton() {
  const b = el('button', 'sheet-add', '+ Add a thing');
  b.type = 'button';
  b.title = 'Particles · a ring · a trail · a beam · a light · copies of a shape';
  b.addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showContextMenu(r.left, r.bottom + 4, MENUS.THINGS.map((t) => ({
      label: `${t.label} — ${t.teach}`,
      run: () => { structural((gg) => MENUS.addThing(gg, t.id)); toast(`Added ${t.label} — it is drawn already; change it from its card`); },
    })));
  });
  return b;
}

// ---------------------------------------------------------------- rows
function rowEl(r, depth, p) {
  const row = el('div', `sheet-row depth-${Math.min(depth, 3)}`);
  row.dataset.nodeId = r.nodeId; row.dataset.key = r.key;
  const label = el('span', 'sheet-k', r.label);
  if (r.description) label.title = r.description;
  row.appendChild(label);
  const val = el('div', 'sheet-v');
  row.appendChild(val);
  row.addEventListener('pointerenter', () => setHot({ nodeId: r.nodeId, key: r.key }));
  row.addEventListener('pointerleave', () => setHot(null));

  const node = graph().nodes[r.nodeId];
  const socket = node ? PGRAPH.socketsOf(graph(), node).inputs.find((s) => s.key === r.key) : null;

  if (r.kind === 'mode') {
    val.appendChild(buildControl(socket, r.value, (v) => commitValue(r.nodeId, r.key, v), { compact: true }));
    return row;
  }
  if (r.kind === 'value') {
    const ctrl = buildControl(socket, r.value, (v) => commitValue(r.nodeId, r.key, v), {
      compact: true,
      live: (v) => withHold(() => liveValue(r.nodeId, r.key, v)),
    });
    if (ctrl) val.appendChild(ctrl);
    if (r.unit) val.appendChild(el('span', 'sheet-unit', r.unit));
    if (r.connectable && MENUS.slotKindOf(socket) !== 'mode') val.appendChild(varyButton(r, node, socket, false));
    return row;
  }
  if (r.kind === 'empty') {
    val.appendChild(el('span', 'sheet-nothing', r.defaultFrom ? `each particle's own ${r.defaultFrom}` : 'nothing'));
    if (r.connectable) val.appendChild(varyButton(r, node, socket, false));
    return row;
  }
  // source(s)
  const list = el('div', 'sheet-sources');
  for (const s of r.sources) {
    const chip = el('div', 'sheet-source');
    if (s.name) {
      const n = el('button', 'sheet-name-chip', `«${s.name}»`);
      n.type = 'button'; n.title = 'A value used in several places — defined once at the bottom of the sheet';
      n.addEventListener('click', () => { document.querySelector('.sheet-named')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      chip.appendChild(n);
    } else if (s.thing) {
      chip.appendChild(el('span', 'sheet-phrase', `[${s.label}]`));
    } else {
      const ph = el('button', 'sheet-phrase-btn');
      ph.type = 'button';
      ph.appendChild(el('span', '', s.phrase || s.label));
      if (s.via) ph.appendChild(el('span', 'sheet-via', ` (its ${s.via})`));
      ph.title = s.teach || 'Click to fold or unfold its own settings';
      ph.addEventListener('click', () => { if (opened.has(s.nodeId)) opened.delete(s.nodeId); else opened.add(s.nodeId); rebuild(); });
      chip.appendChild(ph);
      const b = badgeFor(s.exportSupport); if (b) chip.appendChild(b);
    }
    list.appendChild(chip);
  }
  val.appendChild(list);
  if (r.variesWith.length) val.appendChild(el('span', 'sheet-varies', `varies with ${r.variesWith.join(', ')}`));
  val.appendChild(varyButton(r, node, socket, true));
  if (r.multi) {
    const addMore = el('button', 'sheet-mini', '+ another'); addMore.type = 'button';
    addMore.addEventListener('click', (e) => openMenu(e.currentTarget, r, node, socket, { append: true }));
    val.appendChild(addMore);
  }
  // nested rows of each source, unfolded by default one level deep
  for (const s of r.sources) {
    if (s.name || s.thing || !s.rows.length) continue;
    const show = depth < 1 || opened.has(s.nodeId);
    if (!show) continue;
    const nested = el('div', 'sheet-nested');
    const prim = s.rows.filter((x) => x.primary || x.kind === 'source');
    const rest = s.rows.filter((x) => !(x.primary || x.kind === 'source'));
    for (const x of prim) nested.appendChild(rowEl(x, depth + 1, p));
    if (rest.length) {
      const key = s.nodeId + ':more';
      const more = el('button', 'sheet-more', expanded.has(key) ? 'fewer' : `more (${rest.length})`);
      more.type = 'button';
      more.addEventListener('click', () => { if (expanded.has(key)) expanded.delete(key); else expanded.add(key); rebuild(); });
      nested.appendChild(more);
      if (expanded.has(key)) for (const x of rest) nested.appendChild(rowEl(x, depth + 1, p));
    }
    row.appendChild(nested);
  }
  return row;
}

function varyButton(r, node, socket, wired) {
  const b = el('button', 'sheet-vary' + (wired ? ' wired' : ''), '▾');
  b.type = 'button';
  b.title = wired ? 'Change how this varies' : 'How does this vary?';
  b.addEventListener('click', (e) => openMenu(e.currentTarget, r, node, socket));
  return b;
}

// ---------------------------------------------------------------- the source menu
function closeMenu() {
  if (cancelThumbs) { cancelThumbs(); cancelThumbs = null; }
  if (menuEl) { menuEl.remove(); menuEl = null; }
  document.removeEventListener('pointerdown', onAway, true);
  document.removeEventListener('keydown', onEsc, true);
}
function onAway(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }
function onEsc(e) { if (e.key === 'Escape') { e.preventDefault(); closeMenu(); } }

function openMenu(anchor, r, node, socket, { append = false } = {}) {
  closeMenu();
  const g = graph();
  const menu = MENUS.menuFor(g, node, socket);
  const m = el('div', 'sheet-menu');
  menuEl = m;
  const head = el('div', 'sheet-menu-head');
  head.appendChild(el('b', '', titleFor(menu.kind, r.label)));
  head.appendChild(el('span', '', 'hover to look · click to choose · Ctrl+Z undoes'));
  m.appendChild(head);

  const frame = Math.max(12, Math.min(Math.floor(ST.state.playhead) || 0, 48));
  const fps = ST.state.doc.fps || 30, duration = ST.state.doc.duration || 60;
  const thumbs = [];
  const grid = el('div', 'sheet-menu-grid');
  for (const entry of menu.curated) {
    const item = el('button', 'sheet-mi' + (entry.current ? ' current' : ''));
    item.type = 'button';
    const cv = el('canvas', 'sheet-mi-thumb'); cv.width = 240; cv.height = 150;
    item.appendChild(cv);
    const l = el('div', 'sheet-mi-label'); l.appendChild(el('span', '', entry.label));
    const b = badgeFor(entry.roblox); if (b) l.appendChild(b);
    item.appendChild(l);
    item.title = entry.teach || '';
    // The thumbnail: this graph, with this entry applied, on a scratch copy.
    const scratch = structuredClone(g);
    try {
      const sn = scratch.nodes[node.id];
      const ss = PGRAPH.socketsOf(scratch, sn).inputs.find((x) => x.key === socket.key);
      if (!append) MENUS.applyEntry(scratch, sn, ss, entry); else entry.apply(scratch, sn, ss);
      thumbs.push({ graph: scratch, frame, canvas: cv });
    } catch (e) {
      thumbs.push({ graph: g, frame, canvas: cv, done: () => {} });
    }
    item.addEventListener('click', () => {
      try {
        let made = null;
        structural((gg) => {
          const nn = gg.nodes[node.id];
          const s2 = PGRAPH.socketsOf(gg, nn).inputs.find((x) => x.key === socket.key);
          made = append ? entry.apply(gg, nn, s2) : MENUS.applyEntry(gg, nn, s2, entry);
        });
        if (made && made.focus) opened.add(made.focus);
        toast(`${r.label}: ${entry.label}${entry.teach ? ' — ' + entry.teach : ''}`);
      } catch (e) {
        toast(`Could not apply "${entry.label}": ${e.message}`, 'error');
      }
      closeMenu();
    });
    grid.appendChild(item);
  }
  m.appendChild(grid);

  if (menu.existing.length) {
    const sec = el('div', 'sheet-menu-sec');
    sec.appendChild(el('div', 'sheet-menu-sectitle', 'A value this effect already has'));
    for (const src of menu.existing.slice(0, 24)) {
      const b = el('button', 'sheet-menu-line', src.label); b.type = 'button'; b.title = src.type;
      b.addEventListener('click', () => {
        try { structural((gg) => MENUS.applyExisting(gg, gg.nodes[node.id], socket, src)); toast(`${r.label} now reads ${src.label}`); }
        catch (e) { toast(e.message, 'error'); }
        closeMenu();
      });
      sec.appendChild(b);
    }
    m.appendChild(sec);
  }

  // anything else: the ranked search over every node that fits this slot
  const sec = el('div', 'sheet-menu-sec');
  sec.appendChild(el('div', 'sheet-menu-sectitle', `Anything else… (${menu.searchable} nodes fit here)`));
  const search = el('input', 'fld sheet-menu-search'); search.type = 'text'; search.placeholder = 'Search — try "swirl", "fade", "bounce"';
  const results = el('div', 'sheet-menu-results');
  const fits = new Set(SHEET.feedersFor(socket.type).map((n) => n.id));
  const renderResults = () => {
    results.innerHTML = '';
    const q = search.value.trim();
    if (!q) return;
    const items = REG.searchNodes(q, { limit: 40 }).filter((n) => fits.has(n.id)).slice(0, 12);
    if (!items.length) { results.appendChild(el('div', 'sheet-menu-empty', 'Nothing that fits this slot matches.')); return; }
    for (const n of items) {
      const b = el('button', 'sheet-menu-line'); b.type = 'button';
      b.appendChild(el('span', '', n.label)); b.appendChild(el('span', 'sheet-menu-desc', n.summary));
      const bd = badgeFor(n.exportSupport); if (bd) b.appendChild(bd);
      b.addEventListener('click', () => {
        try { let made = null; structural((gg) => { made = MENUS.applyNodeType(gg, gg.nodes[node.id], socket, n.id); }); if (made?.focus) opened.add(made.focus); toast(`${r.label}: ${n.label}`); }
        catch (e) { toast(e.message, 'error'); }
        closeMenu();
      });
      results.appendChild(b);
    }
  };
  search.addEventListener('input', renderResults);
  search.addEventListener('keydown', (e) => e.stopPropagation());
  sec.append(search, results);
  m.appendChild(sec);

  m.appendChild(el('div', 'sheet-menu-foot', 'Each picture is this effect, at this frame, with that choice applied. native = a Roblox instance plays it as is · baked = exported as a recording.'));

  document.body.appendChild(m);
  const a = anchor.getBoundingClientRect();
  const w = Math.min(420, window.innerWidth - 24);
  m.style.width = w + 'px';
  m.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, a.right - w)) + 'px';
  m.style.top = Math.max(12, Math.min(window.innerHeight - Math.min(window.innerHeight * 0.8, 640) - 12, a.bottom + 6)) + 'px';
  setTimeout(() => { document.addEventListener('pointerdown', onAway, true); document.addEventListener('keydown', onEsc, true); }, 0);
  cancelThumbs = renderQueue(thumbs, { fps, duration, perFrame: 3 });
}

function titleFor(kind, label) {
  return {
    number: `${label} — how does it vary?`, direction: `${label} — which way?`, position: `${label} — where?`, force: 'What pushes them?',
    collider: 'What do they bounce off?', shape: 'Born from what shape?', texture: 'What picture?', material: 'What does it look like?',
    colour: `${label} — how does it vary?`, events: 'Born from which events?', emitter: 'How are they born?', instances: 'Copies of what?',
  }[kind] || `${label} — from what?`;
}

// ---------------------------------------------------------------- live numbers and warnings
function refreshLive() {
  if (!rootEl) return;
  const foot = rootEl.querySelector('[data-role="stats"]');
  if (!foot) return;
  let rep = null;
  try { rep = PNX.report(); } catch (_) { return; }
  const st = rep.stats || {};
  foot.textContent = `${st.nodes ?? 0} nodes · ${st.links ?? 0} connections · ${st.drawnElements ?? 0} drawn this frame` + (st.simulations ? ` · ${st.simulations} simulation${st.simulations === 1 ? '' : 's'}` : '');
  const errors = rep.diagnostics.filter((d) => d.severity === 'error' || d.severity === 'warning');
  for (const w of rootEl.querySelectorAll('.sheet-warnings')) w.innerHTML = '';
  for (const d of errors.slice(0, 12)) {
    const thingId = ownerOf(d.nodeId);
    const card = thingId ? rootEl.querySelector(`.sheet-card[data-node-id="${thingId}"] .sheet-warnings`) : rootEl.querySelector('.sheet-card .sheet-warnings');
    if (!card) continue;
    const line = el('div', `sheet-warn sheet-warn-${d.severity}`, d.message);
    card.appendChild(line);
  }
}
let ownerMap = new Map();
function attachWarnings(owners) { ownerMap = owners; refreshLive(); }
function ownerOf(nodeId) { return ownerMap.get(nodeId) || null; }

// For the smoketest and MCP: the projection this panel is showing, as text.
export function sheetTextNow() {
  return graph() ? SHEET.sheetText(SHEET.projectGraph(graph())) : '';
}
