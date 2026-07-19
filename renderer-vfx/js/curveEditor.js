// The curve drawer: a value-over-frames graph for one (layer, track) — multi-key editing with
// draggable keys, per-segment easing, bezier presets, ghosted out-of-window keys, and the shared
// playhead. Opens over the timeline (ST.curveTarget) from a prop's 📈 button, a key dblclick, or
// the easing menu. Its ruler shows DOC frames (clip-local + clip.start) so "frame 45" means the
// same thing here and in the timeline.

import * as ST from './studioState.js';
import { getLayer, setCurveKey, deleteCurveKey, evalCurve } from '../../renderer/js/effectModel.js';
import { STYLES, DIRECTIONS, BEZIER_PRESETS } from '../../renderer/js/easing.js';
import { showContextMenu } from '../../renderer/js/ui.js';

const PAD = { l: 46, r: 14, t: 18, b: 22 };

let drawer, canvas, ctx, titleEl, styleSel, dirSel, presetWrap;
let selectedT = null; // selected key's t (clip-local)
let drag = null;

export function initCurveEditor() {
  drawer = document.getElementById('vfxCurveDrawer');
  canvas = document.getElementById('vfxCurveCanvas');
  ctx = canvas.getContext('2d');
  titleEl = document.getElementById('vfxCurveTitle');
  styleSel = document.getElementById('vfxCurveStyle');
  dirSel = document.getElementById('vfxCurveDir');
  presetWrap = document.getElementById('vfxCurvePresets');

  for (const s of STYLES) styleSel.add(new Option(s, s));
  for (const d of DIRECTIONS) dirSel.add(new Option(d, d));
  styleSel.addEventListener('change', () => applyEasing({ es: styleSel.value, bez: undefined }));
  dirSel.addEventListener('change', () => applyEasing({ ed: dirSel.value }));
  for (const p of BEZIER_PRESETS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = p.name;
    b.addEventListener('click', () => applyEasing({ bez: p.v.slice() }));
    presetWrap.appendChild(b);
  }
  document.getElementById('vfxCurveClose').addEventListener('click', () => ST.closeCurveEditor());

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('contextmenu', onContext);

  new ResizeObserver(draw).observe(drawer);
  ST.on('curveTarget', onTarget);
  ST.on('effect', draw);
  ST.on('playhead', draw);
}

function target() {
  const t = ST.state.curveTarget;
  if (!t) return null;
  const layer = getLayer(ST.state.doc, t.layerId);
  if (!layer) return null;
  return { layer, prop: t.prop, keys: layer.curves[t.prop] || [] };
}

function onTarget() {
  const t = target();
  drawer.classList.toggle('open', !!t);
  selectedT = null;
  if (t) {
    titleEl.textContent = `${t.layer.name} · ${t.prop}`;
    draw();
  }
}

// ---------------------------------------------------------------- coordinates
function ranges(t) {
  const len = Math.max(1, t.layer.clip.len);
  let maxT = len;
  let lo = 0, hi = 1;
  const vals = t.keys.filter((k) => typeof k.v === 'number').map((k) => k.v);
  if (vals.length) {
    lo = Math.min(...vals);
    hi = Math.max(...vals);
    maxT = Math.max(maxT, ...t.keys.map((k) => k.t));
  }
  if (hi - lo < 1e-9) { hi = lo + 1; }
  const pad = (hi - lo) * 0.18;
  return { maxT: maxT + Math.max(2, maxT * 0.05), lo: lo - pad, hi: hi + pad };
}
const X = (f, r, w) => PAD.l + (f / r.maxT) * (w - PAD.l - PAD.r);
const Y = (v, r, h) => PAD.t + (1 - (v - r.lo) / (r.hi - r.lo)) * (h - PAD.t - PAD.b);
const invX = (x, r, w) => ((x - PAD.l) / (w - PAD.l - PAD.r)) * r.maxT;
const invY = (y, r, h) => r.lo + (1 - (y - PAD.t) / (h - PAD.t - PAD.b)) * (r.hi - r.lo);

// ---------------------------------------------------------------- drawing
function draw() {
  if (!drawer.classList.contains('open')) return;
  const t = target();
  if (!t) return;
  const w = canvas.parentElement.clientWidth, h = canvas.parentElement.clientHeight - 40;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const s = getComputedStyle(document.documentElement);
  const ink = s.getPropertyValue('--text-1').trim() || '#c9cbe0';
  const dim = s.getPropertyValue('--text-3').trim() || '#6a6a78';
  const accent = s.getPropertyValue('--accent').trim() || '#7c8cff';
  const r = ranges(t);
  const len = t.layer.clip.len;

  ctx.font = '10px Inter, system-ui, sans-serif';

  // clip window shading: beyond `len` is the ghost zone (keys there never evaluate)
  const xLen = X(len, r, w);
  ctx.fillStyle = dim;
  ctx.globalAlpha = 0.08;
  ctx.fillRect(xLen, PAD.t, w - PAD.r - xLen, h - PAD.t - PAD.b);
  ctx.globalAlpha = 1;

  // grid + doc-frame ruler labels (clip-local + clip.start)
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i++) {
    const y = PAD.t + (i / 4) * (h - PAD.t - PAD.b);
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(w - PAD.r, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = dim;
  const stride = Math.max(1, Math.round(r.maxT / 8));
  for (let f = 0; f <= r.maxT; f += stride) {
    ctx.fillText(String(f + t.layer.clip.start), X(f, r, w) - 4, h - 8);
  }
  ctx.textAlign = 'right';
  ctx.fillText(String(Math.round(r.hi * 100) / 100), PAD.l - 6, PAD.t + 4);
  ctx.fillText(String(Math.round(r.lo * 100) / 100), PAD.l - 6, h - PAD.b + 4);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;

  // playhead (shared with the timeline, converted into this clip's local space)
  const localPlayhead = Math.floor(ST.state.playhead) - t.layer.clip.start;
  if (localPlayhead >= 0 && localPlayhead <= r.maxT) {
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(X(localPlayhead, r, w), PAD.t);
    ctx.lineTo(X(localPlayhead, r, w), h - PAD.b);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (!t.keys.length) {
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.5;
    ctx.fillText('Double-click to add a key', w / 2 - 60, h / 2);
    ctx.globalAlpha = 1;
    return;
  }

  // curve
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const steps = 160;
  for (let i = 0; i <= steps; i++) {
    const f = (i / steps) * r.maxT;
    const v = evalCurve(t.keys, f, t.keys[0].v);
    if (typeof v !== 'number') continue;
    const x = X(f, r, w), y = Y(v, r, h);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.lineWidth = 1;

  // keys
  for (const k of t.keys) {
    if (typeof k.v !== 'number') continue;
    const out = k.t >= len;
    ctx.beginPath();
    ctx.arc(X(k.t, r, w), Y(k.v, r, h), k.t === selectedT ? 6 : 4.5, 0, Math.PI * 2);
    ctx.fillStyle = out ? dim : (k.t === selectedT ? (s.getPropertyValue('--text-0').trim() || '#fff') : accent);
    ctx.globalAlpha = out ? 0.45 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // easing controls reflect the selected key
  const sel = t.keys.find((k) => k.t === selectedT);
  styleSel.disabled = dirSel.disabled = !sel;
  if (sel) {
    styleSel.value = sel.es || 'Linear';
    dirSel.value = sel.ed || 'Out';
  }
}

// ---------------------------------------------------------------- interaction
function keyAtPointer(e, t) {
  const rect = canvas.getBoundingClientRect();
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const r = ranges(t);
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  for (const k of t.keys) {
    if (typeof k.v !== 'number') continue;
    if (Math.hypot(X(k.t, r, w) - x, Y(k.v, r, h) - y) < 9) return k;
  }
  return null;
}

function onDown(e) {
  if (e.button !== 0) return;
  const t = target();
  if (!t) return;
  const k = keyAtPointer(e, t);
  if (k) {
    selectedT = k.t;
    ST.beginGesture();
    drag = { fromT: k.t };
    canvas.setPointerCapture(e.pointerId);
  } else {
    selectedT = null;
  }
  draw();
}

function onMove(e) {
  const t = target();
  if (!t) return;
  if (!drag) {
    canvas.style.cursor = keyAtPointer(e, t) ? 'grab' : 'default';
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const r = ranges(t);
  const keys = t.keys;
  const k = keys.find((kk) => kk.t === drag.fromT);
  if (!k) return;
  const newT = Math.max(0, Math.round(invX(e.clientX - rect.left, r, w)));
  const newV = Math.round(invY(e.clientY - rect.top, r, h) * 1000) / 1000;
  if (!keys.some((kk) => kk !== k && kk.t === newT)) {
    k.t = newT;
    drag.fromT = newT;
    selectedT = newT;
  }
  k.v = newV;
  keys.sort((a, b) => a.t - b.t);
  ST.touch();
  draw();
}

function onUp() {
  if (!drag) return;
  drag = null;
  ST.endGesture();
}

function onDblClick(e) {
  const t = target();
  if (!t) return;
  if (keyAtPointer(e, t)) return;
  const rect = canvas.getBoundingClientRect();
  const r = ranges(t);
  const f = Math.max(0, Math.round(invX(e.clientX - rect.left, r, canvas.clientWidth)));
  const v = Math.round(invY(e.clientY - rect.top, r, canvas.clientHeight) * 1000) / 1000;
  ST.mutate((doc) => setCurveKey(getLayer(doc, t.layer.id), t.prop, f, v));
  selectedT = f;
}

function onContext(e) {
  e.preventDefault();
  const t = target();
  if (!t) return;
  const k = keyAtPointer(e, t);
  if (!k) return;
  selectedT = k.t;
  showContextMenu(e.clientX, e.clientY, [
    { label: 'Delete key', run: () => ST.mutate((doc) => deleteCurveKey(getLayer(doc, t.layer.id), t.prop, k.t)) },
  ]);
  draw();
}

function applyEasing(patch) {
  const t = target();
  if (!t || selectedT == null) return;
  ST.mutate((doc) => {
    const layer = getLayer(doc, t.layer.id);
    const k = (layer.curves[t.prop] || []).find((kk) => kk.t === selectedT);
    if (!k) return;
    if (patch.es !== undefined) { k.es = patch.es; delete k.bez; }
    if (patch.ed !== undefined) k.ed = patch.ed;
    if (patch.bez !== undefined) k.bez = patch.bez;
  });
}
