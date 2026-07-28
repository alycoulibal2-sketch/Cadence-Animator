// Interactive curve editor: named easings + draggable cubic-bezier handles.
import * as S from './state.js';
import { STYLES, DIRECTIONS, BEZIER_PRESETS, evalSegment, paramsFor, PARAM_DATA, isDirectional } from './easing.js';

const cv = {
  panel: null, canvas: null, ctx: null,
  styleSel: null, dirSel: null, presetWrap: null, paramWrap: null,
  drag: null, // 'p1' | 'p2'
};

const PAD = { l: 44, r: 20, t: 26, b: 30 };
const Y_MIN = -0.6, Y_MAX = 1.6;

function firstSelectedKey() {
  const sel = S.state.selection.keys;
  if (!sel.length) return null;
  const ref = sel[0];
  const k = S.getKey(ref.itemId, ref.track, ref.t);
  return k ? { ref, key: k } : null;
}

// How many frames the selected key's outgoing segment spans. Elastic's Period is
// frame-relative (Moon marks it frame_relative), so the preview has to be drawn against the
// real segment length or it would not match what playback actually does.
function segmentFrames(ref) {
  if (!ref) return 1;
  const tr = S.getTrack(ref.itemId, ref.track);
  if (!tr) return 1;
  const next = tr.keys.find((k) => k.t > ref.t + 1e-6);
  return next ? next.t - ref.t : 1;
}

export function initCurveEditor() {
  cv.panel = document.getElementById('curvePanel');
  cv.canvas = document.getElementById('curveCanvas');
  cv.ctx = cv.canvas.getContext('2d');
  cv.styleSel = document.getElementById('curveStyle');
  cv.dirSel = document.getElementById('curveDir');
  cv.presetWrap = document.getElementById('curvePresets');
  cv.paramWrap = document.getElementById('curveParams');

  for (const s of STYLES) cv.styleSel.add(new Option(s, s));
  for (const d of DIRECTIONS) cv.dirSel.add(new Option(d, d));
  for (const p of BEZIER_PRESETS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = p.name;
    b.addEventListener('click', () => applyToSelection(null, null, p.v.slice()));
    cv.presetWrap.appendChild(b);
  }

  cv.styleSel.addEventListener('change', () => applyToSelection(cv.styleSel.value, null, null));
  cv.dirSel.addEventListener('change', () => applyToSelection(null, cv.dirSel.value, null));
  document.getElementById('curveToBezier').addEventListener('click', () => {
    applyToSelection(null, null, [0.33, 0.0, 0.66, 1.0]);
  });
  document.getElementById('curveClose').addEventListener('click', closeCurveEditor);

  cv.canvas.addEventListener('pointerdown', onDown);
  cv.canvas.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', () => {
    if (cv.drag) { cv.drag = null; commitBezier(); }
  });

  const ro = new ResizeObserver(fit);
  ro.observe(cv.panel);
  ['selection', 'tracks'].forEach((ev) => S.on(ev, drawSoon));
}

function applyToSelection(es, ed, bez, ep) {
  const sel = S.state.selection.keys;
  if (!sel.length) return;
  S.setEasing(sel, es, ed, bez, ep === undefined ? {} : { ep });
  syncParamInputs();
  drawSoon();
}

// Rebuild the extra numeric inputs a style exposes (Back → Overshoot, Elastic → Amplitude +
// Period). Built via the CSSOM rather than an innerHTML string with inline style/onclick
// attributes — the app's CSP silently drops those, which has bitten this codebase repeatedly.
function syncParamInputs() {
  if (!cv.paramWrap) return;
  cv.paramWrap.replaceChildren();
  const found = firstSelectedKey();
  if (!found) return;
  const { key } = found;
  if (key.bez) return; // a custom bezier has no named-style parameters
  const names = paramsFor(key.es);
  for (const name of names) {
    const meta = PARAM_DATA[name];
    const wrap = document.createElement('label');
    wrap.className = 'curve-param';
    const span = document.createElement('span');
    span.textContent = name;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'fld slim';
    inp.step = String(meta.inc);
    inp.value = String(key.ep?.[name] ?? meta.default);
    inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      if (!Number.isFinite(v)) { inp.value = String(key.ep?.[name] ?? meta.default); return; }
      const cur = firstSelectedKey();
      const next = { ...(cur?.key.ep || {}) };
      next[name] = v;
      applyToSelection(null, null, undefined, next);
    });
    wrap.append(span, inp);
    cv.paramWrap.appendChild(wrap);
  }
}

export function openCurveEditor() {
  cv.panel.classList.add('open');
  fit();
  drawSoon();
}
export function closeCurveEditor() {
  cv.panel.classList.remove('open');
}
export function toggleCurveEditor() {
  if (cv.panel.classList.contains('open')) closeCurveEditor();
  else openCurveEditor();
}

function fit() {
  const r = cv.canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio, 2);
  cv.canvas.width = Math.floor(r.width * dpr);
  cv.canvas.height = Math.floor(r.height * dpr);
  cv.canvas.style.width = r.width + 'px';
  cv.canvas.style.height = r.height + 'px';
  cv.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawSoon();
}

const X = (t, w) => PAD.l + t * (w - PAD.l - PAD.r);
const Y = (v, h) => {
  const usable = h - PAD.t - PAD.b;
  return PAD.t + (1 - (v - Y_MIN) / (Y_MAX - Y_MIN)) * usable;
};
const invX = (x, w) => (x - PAD.l) / (w - PAD.l - PAD.r);
const invY = (y, h) => Y_MIN + (1 - (y - PAD.t) / (h - PAD.t - PAD.b)) * (Y_MAX - Y_MIN);

let drawPending = false;
function drawSoon() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => { drawPending = false; draw(); });
}

function draw() {
  if (!cv.panel.classList.contains('open')) return;
  const ctx = cv.ctx;
  const w = cv.canvas.clientWidth, h = cv.canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);

  // Ink color from the active theme (the old fixed white-alpha was invisible on Light).
  const styles = getComputedStyle(document.documentElement);
  const ink = styles.getPropertyValue('--text-1').trim() || '#c9cbe0';

  const found = firstSelectedKey();
  ctx.font = '11px Inter, system-ui, sans-serif';
  if (!found) {
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.5;
    ctx.textAlign = 'center';
    ctx.fillText('Select a keyframe to edit its outgoing curve', w / 2, h / 2);
    ctx.globalAlpha = 1;
    return;
  }
  const { key, ref } = found;
  cv.styleSel.value = key.es || 'Linear';
  cv.dirSel.value = key.ed || 'Out';
  // Linear/Constant take no direction — Moon greys the control out rather than implying one.
  cv.dirSel.disabled = !isDirectional(key.es);
  syncParamInputs();
  const segFrames = segmentFrames(ref);

  // grid
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.12;
  ctx.beginPath();
  for (let gy = 0; gy <= 1; gy += 0.25) {
    ctx.moveTo(X(0, w), Y(gy, h)); ctx.lineTo(X(1, w), Y(gy, h));
  }
  for (let gx = 0; gx <= 1; gx += 0.25) {
    ctx.moveTo(X(gx, w), Y(Y_MIN, h)); ctx.lineTo(X(gx, w), Y(Y_MAX, h));
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  // baseline 0 and 1
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.moveTo(X(0, w), Y(0, h)); ctx.lineTo(X(1, w), Y(0, h));
  ctx.moveTo(X(0, w), Y(1, h)); ctx.lineTo(X(1, w), Y(1, h));
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.6;
  ctx.textAlign = 'right';
  ctx.fillText('0', PAD.l - 8, Y(0, h) + 3);
  ctx.fillText('1', PAD.l - 8, Y(1, h) + 3);
  ctx.globalAlpha = 1;

  // curve
  const accent = styles.getPropertyValue('--accent').trim() || '#7c8cff';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    const v = evalSegment(key, t, segFrames);
    if (i === 0) ctx.moveTo(X(t, w), Y(v, h));
    else ctx.lineTo(X(t, w), Y(v, h));
  }
  ctx.stroke();
  ctx.lineWidth = 1;

  // bezier handles
  if (key.bez) {
    const [x1, y1, x2, y2] = key.bez;
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(X(0, w), Y(0, h)); ctx.lineTo(X(x1, w), Y(y1, h));
    ctx.moveTo(X(1, w), Y(1, h)); ctx.lineTo(X(x2, w), Y(y2, h));
    ctx.stroke();
    ctx.globalAlpha = 1;
    for (const [hx, hy, name] of [[x1, y1, 'p1'], [x2, y2, 'p2']]) {
      ctx.beginPath();
      ctx.arc(X(hx, w), Y(hy, h), 6, 0, Math.PI * 2);
      ctx.fillStyle = cv.drag === name ? (styles.getPropertyValue('--text-0').trim() || '#ffffff') : accent;
      ctx.fill();
    }
  } else {
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.5;
    ctx.textAlign = 'left';
    ctx.fillText(`${key.es || 'Linear'} · ${key.ed || 'Out'} — click "Custom bezier" to sculpt freely`, PAD.l, 16);
    ctx.globalAlpha = 1;
  }
}

function handleHit(e) {
  const found = firstSelectedKey();
  if (!found || !found.key.bez) return null;
  const rect = cv.canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const w = cv.canvas.clientWidth, h = cv.canvas.clientHeight;
  const [x1, y1, x2, y2] = found.key.bez;
  if (Math.hypot(X(x1, w) - x, Y(y1, h) - y) < 12) return 'p1';
  if (Math.hypot(X(x2, w) - x, Y(y2, h) - y) < 12) return 'p2';
  return null;
}

function onDown(e) {
  const hit = handleHit(e);
  if (hit) {
    S.pushUndo(); // snapshot BEFORE the live-mutating drag starts, so one Ctrl+Z reverts the whole gesture
    cv.drag = hit;
    cv.canvas.setPointerCapture(e.pointerId);
  }
}

function onMove(e) {
  const found = firstSelectedKey();
  if (!found) return;
  if (!cv.drag) {
    cv.canvas.style.cursor = handleHit(e) ? 'grab' : 'default';
    return;
  }
  const rect = cv.canvas.getBoundingClientRect();
  const w = cv.canvas.clientWidth, h = cv.canvas.clientHeight;
  let bx = Math.max(0, Math.min(1, invX(e.clientX - rect.left, w)));
  let by = Math.max(Y_MIN, Math.min(Y_MAX, invY(e.clientY - rect.top, h)));
  bx = Math.round(bx * 100) / 100;
  by = Math.round(by * 100) / 100;
  const bez = found.key.bez.slice();
  if (cv.drag === 'p1') { bez[0] = bx; bez[1] = by; }
  else { bez[2] = bx; bez[3] = by; }
  // live update without undo spam; commit pushes undo on release
  found.key.bez = bez;
  S.emit('tracks', {});
  drawSoon();
}

function commitBezier() {
  const found = firstSelectedKey();
  if (!found || !found.key.bez) return;
  // undo was already pushed in onDown, before the drag's live mutation — don't push a second,
  // already-mutated "before" state here, or Ctrl+Z after a bezier edit would be a no-op.
  S.setEasing(S.state.selection.keys, null, null, found.key.bez.slice(), { noUndo: true });
  drawSoon();
}
