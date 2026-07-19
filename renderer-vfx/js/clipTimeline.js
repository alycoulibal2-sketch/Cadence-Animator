// The clip timeline — and its left column IS the layers panel (one module so the row math can
// never drift between the two, the lesson from the animator's timeline label/lane bug). Layer
// rows show a draggable/resizable clip bar; a caret expands per-animated-property sub-rows with
// key diamonds (dblclick = key the evaluated value, drag = move, right-click = easing/delete —
// the animator's idioms). Every pointer gesture snapshots undo at pointerdown (curves.js rule).

import * as ST from './studioState.js';
import {
  getLayer, newLayer, addLayer, removeLayer, duplicateLayer, moveLayer, setClip,
  setCurveKey, deleteCurveKey, resolveProp, resolveModParam, getModifier,
  LAYER_TYPES, LAYER_TYPE_KEYS,
} from '../../renderer/js/effectModel.js';
import { layerExportFidelity } from '../../renderer/js/effectValidators.js';
import { showContextMenu, promptModal } from '../../renderer/js/ui.js';

const ROW_H = 26;
const RULER_H = 22;
const EDGE_PX = 6;

let listEl, canvas, ctx, wrap;
let rows = []; // { kind: 'layer'|'prop', layer(id-resolved per build), prop? }
let drag = null;

export function initClipTimeline() {
  listEl = document.getElementById('vfxTrackList');
  canvas = document.getElementById('vfxTimelineCanvas');
  wrap = document.getElementById('vfxTimelineScroll');
  ctx = canvas.getContext('2d');

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('contextmenu', onContext);

  new ResizeObserver(draw).observe(wrap);
  ST.on('effect', rebuild);
  ST.on('selection', draw);
  ST.on('playhead', draw);
  rebuild();
}

// ---------------------------------------------------------------- row model
// Animated props = props with curve keys, plus animatable modifier params with keys.
function animatedTracks(layer) {
  return Object.keys(layer.curves).filter((p) => (layer.curves[p] || []).length);
}
function trackLabel(layer, track) {
  if (track.startsWith('mod:')) {
    const [, modId, param] = track.split(':');
    const mod = getModifier(layer, modId);
    return `${mod ? mod.type : '?'} · ${param}`;
  }
  return track;
}
function trackValueAt(layer, track, lf, fps) {
  if (track.startsWith('mod:')) {
    const [, modId, param] = track.split(':');
    const mod = getModifier(layer, modId);
    return mod ? resolveModParam(layer, mod, param, lf, fps) : 0;
  }
  return resolveProp(layer, track, lf, fps);
}

function buildRows() {
  rows = [];
  for (const layer of ST.state.doc.layers) {
    rows.push({ kind: 'layer', layerId: layer.id });
    if (ST.state.expanded.has(layer.id)) {
      for (const track of animatedTracks(layer)) rows.push({ kind: 'prop', layerId: layer.id, prop: track });
    }
  }
}

function pxPerFrame() {
  return Math.max(2, (canvas.clientWidth - 8) / Math.max(1, ST.state.doc.duration));
}
const xOf = (f) => 4 + f * pxPerFrame();
const fOf = (x) => Math.round((x - 4) / pxPerFrame());

// ---------------------------------------------------------------- track list (DOM)
function rebuild() {
  buildRows();
  listEl.innerHTML = '';
  listEl.style.paddingTop = RULER_H + 'px';

  const header = document.createElement('div');
  header.className = 'vfx-track-header';
  const addBtn = document.createElement('button');
  addBtn.className = 'tb-btn vfx-add-layer';
  addBtn.textContent = '＋ Add layer';
  addBtn.addEventListener('click', (e) => {
    const r = e.target.getBoundingClientRect();
    showContextMenu(r.left, r.bottom + 4, LAYER_TYPE_KEYS.map((t) => ({
      label: `${LAYER_TYPES[t].icon} ${LAYER_TYPES[t].label}`,
      run: () => ST.mutate((doc) => {
        const layer = addLayer(doc, newLayer(t));
        layer.clip.len = doc.duration - layer.clip.start;
        ST.select(layer.id);
      }),
    })));
  });
  header.appendChild(addBtn);
  listEl.appendChild(header);

  for (const row of rows) {
    const layer = getLayer(ST.state.doc, row.layerId);
    if (!layer) continue;
    const el = document.createElement('div');
    el.style.height = ROW_H + 'px';

    if (row.kind === 'prop') {
      el.className = 'vfx-prop-row';
      const label = document.createElement('span');
      label.className = 'vfx-prop-label';
      label.textContent = trackLabel(layer, row.prop);
      label.title = 'Double-click to open the curve editor';
      label.addEventListener('dblclick', () => ST.openCurveEditor(layer.id, row.prop));
      el.appendChild(label);
      listEl.appendChild(el);
      continue;
    }

    el.className = 'vfx-layer-row' + (ST.state.selection.layerId === layer.id ? ' selected' : '');
    el.draggable = true;
    el.addEventListener('click', () => ST.select(layer.id));
    el.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/vfx-layer', layer.id));
    el.addEventListener('dragover', (e) => e.preventDefault());
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('text/vfx-layer');
      if (!draggedId || draggedId === layer.id) return;
      ST.mutate((doc) => moveLayer(doc, draggedId, doc.layers.findIndex((l) => l.id === layer.id)));
    });

    const caret = document.createElement('span');
    caret.className = 'vfx-caret';
    const hasTracks = animatedTracks(layer).length > 0;
    caret.textContent = hasTracks ? (ST.state.expanded.has(layer.id) ? '▾' : '▸') : '·';
    caret.title = hasTracks ? 'Show animated properties' : 'No animated properties yet';
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!hasTracks) return;
      if (ST.state.expanded.has(layer.id)) ST.state.expanded.delete(layer.id);
      else ST.state.expanded.add(layer.id);
      rebuild();
    });

    const icon = document.createElement('span');
    icon.className = 'vfx-layer-icon';
    icon.textContent = LAYER_TYPES[layer.type]?.icon || '·';

    const name = document.createElement('span');
    name.className = 'vfx-layer-name';
    name.textContent = layer.name;
    name.title = 'Double-click to rename';
    name.addEventListener('dblclick', async (e) => {
      e.stopPropagation();
      const v = await promptModal({ title: 'Rename layer', label: 'Name', initial: layer.name });
      if (v) ST.mutate((doc) => { const l = getLayer(doc, layer.id); if (l) l.name = v; });
    });

    // Export-fidelity badge (faithful / approximated / preview-only) — divergence visible while
    // editing, not after export (docs/vfx-studio.md).
    const fid = layerExportFidelity(layer);
    const badge = document.createElement('span');
    badge.className = `vfx-fid vfx-fid-${fid.level}`;
    badge.title = fid.level === 'faithful'
      ? 'Exports to Roblox faithfully'
      : `Roblox export notes:\n${fid.notes.map((n) => `• ${n.what}: ${n.how}`).join('\n')}`;

    const eye = rowBtn(layer.enabled ? '👁' : '🚫', layer.enabled ? 'Disable layer' : 'Enable layer', (e) => {
      e.stopPropagation();
      ST.mutate((doc) => { const l = getLayer(doc, layer.id); if (l) l.enabled = !l.enabled; });
    });
    const solo = rowBtn('S', ST.state.solo.has(layer.id) ? 'Un-solo' : 'Solo (preview only this layer)', (e) => {
      e.stopPropagation();
      ST.toggleSolo(layer.id);
    });
    if (ST.state.solo.has(layer.id)) solo.classList.add('active');
    const del = rowBtn('🗑', 'Delete layer', (e) => {
      e.stopPropagation();
      ST.mutate((doc) => removeLayer(doc, layer.id));
    });

    el.append(caret, icon, name, badge, eye, solo, del);
    if (layer.type === 'sound') {
      const tag = document.createElement('span');
      tag.className = 'vfx-export-only';
      tag.textContent = 'export only';
      tag.title = 'Audio never plays in the studio preview — it exports to Roblox.';
      name.after(tag);
    }
    listEl.appendChild(el);
  }
  draw();
}

function rowBtn(text, title, onClick) {
  const b = document.createElement('button');
  b.className = 'vfx-row-btn';
  b.textContent = text;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

// ---------------------------------------------------------------- canvas
function palette() {
  const s = getComputedStyle(document.documentElement);
  return {
    ink: s.getPropertyValue('--text-1').trim() || '#c9cbe0',
    dim: s.getPropertyValue('--text-3').trim() || '#6a6a78',
    accent: s.getPropertyValue('--accent').trim() || '#7c8cff',
    bg: s.getPropertyValue('--bg-2').trim() || '#17171d',
    clip: s.getPropertyValue('--bg-4').trim() || '#2c2c38',
  };
}

function draw() {
  const w = wrap.clientWidth - listEl.offsetWidth;
  const h = RULER_H + rows.length * ROW_H + 6;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.max(1, Math.floor(h * dpr));
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const P = palette();
  const doc = ST.state.doc;
  ctx.clearRect(0, 0, w, h);

  // ruler
  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.fillStyle = P.dim;
  ctx.strokeStyle = P.dim;
  ctx.globalAlpha = 0.7;
  const stride = Math.max(1, Math.ceil(30 / pxPerFrame() / 5) * 5);
  for (let f = 0; f <= doc.duration; f += stride) {
    const x = xOf(f);
    ctx.fillText(String(f), x + 2, 12);
    ctx.beginPath();
    ctx.moveTo(x, RULER_H - 5);
    ctx.lineTo(x, RULER_H);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  rows.forEach((row, i) => {
    const y = RULER_H + i * ROW_H;
    const layer = getLayer(doc, row.layerId);
    if (!layer) return;
    ctx.globalAlpha = layer.enabled ? 1 : 0.35;

    if (row.kind === 'layer') {
      const x0 = xOf(layer.clip.start);
      const x1 = xOf(layer.clip.start + layer.clip.len);
      const selected = ST.state.selection.layerId === layer.id;
      ctx.fillStyle = selected ? P.accent : P.clip;
      ctx.globalAlpha *= selected ? 0.75 : 0.9;
      roundRect(ctx, x0, y + 4, Math.max(3, x1 - x0), ROW_H - 8, 4);
      ctx.fill();
      ctx.globalAlpha = layer.enabled ? 1 : 0.35;
      // loop ticks: repeat marks from clip end to effect end
      if (layer.clip.loop) {
        ctx.strokeStyle = selected ? P.accent : P.dim;
        ctx.globalAlpha *= 0.55;
        for (let f = layer.clip.start + layer.clip.len; f < doc.duration; f += layer.clip.len) {
          const x = xOf(f);
          ctx.beginPath();
          ctx.moveTo(x, y + 7);
          ctx.lineTo(x, y + ROW_H - 7);
          ctx.stroke();
        }
        ctx.globalAlpha = layer.enabled ? 1 : 0.35;
      }
      // edge handles
      ctx.fillStyle = P.ink;
      ctx.globalAlpha *= 0.5;
      ctx.fillRect(x0 + 1, y + 7, 2, ROW_H - 14);
      ctx.fillRect(x1 - 3, y + 7, 2, ROW_H - 14);
      ctx.globalAlpha = layer.enabled ? 1 : 0.35;
    } else {
      // prop sub-row: key diamonds (dimmed when beyond the clip window — visible, never hidden)
      const keys = layer.curves[row.prop] || [];
      for (const k of keys) {
        const x = xOf(layer.clip.start + k.t);
        const out = k.t >= layer.clip.len;
        ctx.fillStyle = out ? P.dim : P.accent;
        ctx.globalAlpha = out ? 0.4 : 1;
        diamond(ctx, x, y + ROW_H / 2, 4.5);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  });
  ctx.globalAlpha = 1;

  // playhead
  const px = xOf(Math.floor(ST.state.playhead));
  ctx.strokeStyle = P.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px, 0);
  ctx.lineTo(px, h);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function diamond(c, x, y, r) {
  c.beginPath();
  c.moveTo(x, y - r);
  c.lineTo(x + r, y);
  c.lineTo(x, y + r);
  c.lineTo(x - r, y);
  c.closePath();
}

// ---------------------------------------------------------------- hit testing + gestures
function rowAt(e) {
  const rect = canvas.getBoundingClientRect();
  const y = e.clientY - rect.top;
  if (y < RULER_H) return { kind: 'ruler' };
  const i = Math.floor((y - RULER_H) / ROW_H);
  return rows[i] ? { ...rows[i], index: i } : null;
}
function keyAt(e, row) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const layer = getLayer(ST.state.doc, row.layerId);
  for (const k of layer.curves[row.prop] || []) {
    if (Math.abs(xOf(layer.clip.start + k.t) - x) < 6) return k;
  }
  return null;
}

function onDown(e) {
  if (e.button !== 0) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const hit = rowAt(e);
  if (!hit) return;
  canvas.setPointerCapture(e.pointerId);

  if (hit.kind === 'ruler') {
    drag = { mode: 'scrub' };
    ST.setPlayhead(fOf(x));
    return;
  }
  const layer = getLayer(ST.state.doc, hit.layerId);
  if (hit.kind === 'layer') {
    ST.select(layer.id);
    const x0 = xOf(layer.clip.start), x1 = xOf(layer.clip.start + layer.clip.len);
    if (x < x0 - EDGE_PX || x > x1 + EDGE_PX) { drag = { mode: 'scrub' }; ST.setPlayhead(fOf(x)); return; }
    ST.beginGesture();
    if (Math.abs(x - x0) <= EDGE_PX) drag = { mode: 'clip-start', layerId: layer.id, orig: { ...layer.clip } };
    else if (Math.abs(x - x1) <= EDGE_PX) drag = { mode: 'clip-end', layerId: layer.id, orig: { ...layer.clip } };
    else drag = { mode: 'clip-move', layerId: layer.id, orig: { ...layer.clip }, grabF: fOf(x) };
    return;
  }
  if (hit.kind === 'prop') {
    const k = keyAt(e, hit);
    if (k) {
      ST.beginGesture();
      drag = { mode: 'key-move', layerId: hit.layerId, prop: hit.prop, origT: k.t };
    }
  }
}

function onMove(e) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  if (!drag) {
    // hover cursors: resize at clip edges, grab on bodies
    const hit = rowAt(e);
    let cursor = 'default';
    if (hit?.kind === 'layer') {
      const layer = getLayer(ST.state.doc, hit.layerId);
      const x0 = xOf(layer.clip.start), x1 = xOf(layer.clip.start + layer.clip.len);
      if (Math.abs(x - x0) <= EDGE_PX || Math.abs(x - x1) <= EDGE_PX) cursor = 'ew-resize';
      else if (x > x0 && x < x1) cursor = 'grab';
    } else if (hit?.kind === 'prop' && keyAt(e, hit)) cursor = 'grab';
    canvas.style.cursor = cursor;
    return;
  }
  const doc = ST.state.doc;
  if (drag.mode === 'scrub') { ST.setPlayhead(fOf(x)); return; }
  const layer = getLayer(doc, drag.layerId);
  if (!layer) return;
  if (drag.mode === 'clip-move') {
    const df = fOf(x) - drag.grabF;
    setClip(layer, { start: drag.orig.start + df, len: drag.orig.len }, doc.duration);
    ST.touch();
  } else if (drag.mode === 'clip-start') {
    const f = Math.min(fOf(x), drag.orig.start + drag.orig.len - 1);
    setClip(layer, { start: f, len: drag.orig.len + (drag.orig.start - f) }, doc.duration);
    ST.touch();
  } else if (drag.mode === 'clip-end') {
    setClip(layer, { start: drag.orig.start, len: fOf(x) - drag.orig.start }, doc.duration);
    ST.touch();
  } else if (drag.mode === 'key-move') {
    const keys = layer.curves[drag.prop] || [];
    const k = keys.find((kk) => kk.t === drag.origT);
    if (k) {
      const newT = Math.max(0, fOf(x) - layer.clip.start);
      if (!keys.some((kk) => kk !== k && kk.t === newT)) {
        k.t = newT;
        drag.origT = newT;
        keys.sort((a, b) => a.t - b.t);
        ST.touch();
      }
    }
  }
}

function onUp() {
  if (!drag) return;
  const wasGesture = drag.mode !== 'scrub';
  drag = null;
  if (wasGesture) ST.endGesture();
}

function onDblClick(e) {
  const hit = rowAt(e);
  if (!hit) return;
  if (hit.kind === 'prop') {
    const layer = getLayer(ST.state.doc, hit.layerId);
    const k = keyAt(e, hit);
    if (k) { ST.openCurveEditor(layer.id, hit.prop); return; }
    // dblclick empty track = key the EVALUATED value at that frame (the house idiom)
    const rect = canvas.getBoundingClientRect();
    const f = Math.max(0, fOf(e.clientX - rect.left) - layer.clip.start);
    const v = trackValueAt(layer, hit.prop, f, ST.state.doc.fps);
    if (typeof v === 'number') {
      ST.mutate((doc) => setCurveKey(getLayer(doc, layer.id), hit.prop, f, Math.round(v * 1000) / 1000));
    }
  }
}

const EASING_CHOICES = [
  ['Linear', 'Linear', 'Out'], ['Sine out', 'Sine', 'Out'], ['Quad out', 'Quad', 'Out'],
  ['Quad in', 'Quad', 'In'], ['Exponential out', 'Exponential', 'Out'], ['Back out', 'Back', 'Out'],
  ['Elastic out', 'Elastic', 'Out'], ['Bounce out', 'Bounce', 'Out'], ['Constant (step)', 'Constant', 'Out'],
];

function onContext(e) {
  e.preventDefault();
  const hit = rowAt(e);
  if (!hit) return;
  const layer = getLayer(ST.state.doc, hit.layerId);
  if (hit.kind === 'layer' && layer) {
    showContextMenu(e.clientX, e.clientY, [
      { label: layer.clip.loop ? 'Un-loop clip' : 'Loop clip to effect end', run: () => ST.mutate((doc) => { const l = getLayer(doc, layer.id); if (l) l.clip.loop = !l.clip.loop; }) },
      { label: 'Duplicate layer', run: () => ST.mutate((doc) => { const copy = duplicateLayer(doc, layer.id); if (copy) ST.select(copy.id); }) },
      { label: 'Delete layer', run: () => ST.mutate((doc) => removeLayer(doc, layer.id)) },
    ]);
    return;
  }
  if (hit.kind === 'prop' && layer) {
    const k = keyAt(e, hit);
    if (!k) return;
    showContextMenu(e.clientX, e.clientY, [
      ...EASING_CHOICES.map(([label, es, ed]) => ({
        label,
        run: () => ST.mutate((doc) => {
          const l = getLayer(doc, layer.id);
          const kk = (l.curves[hit.prop] || []).find((x) => x.t === k.t);
          if (kk) { kk.es = es; kk.ed = ed; delete kk.bez; }
        }),
      })),
      { label: 'Custom bezier (curve editor)…', run: () => ST.openCurveEditor(layer.id, hit.prop) },
      { label: 'Delete key', run: () => ST.mutate((doc) => deleteCurveKey(getLayer(doc, layer.id), hit.prop, k.t)) },
    ]);
  }
}
