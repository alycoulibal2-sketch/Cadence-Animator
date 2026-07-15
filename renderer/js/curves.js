// Interactive curve editor: named easings + draggable cubic-bezier handles.
import * as S from './state.js';
import { STYLES, DIRECTIONS, BEZIER_PRESETS, evalSegment } from './easing.js';

const cv = {
  panel: null, canvas: null, ctx: null,
  styleSel: null, dirSel: null, presetWrap: null,
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

export function initCurveEditor() {
  cv.panel = document.getElementById('curvePanel');
  cv.canvas = document.getElementById('curveCanvas');
  cv.ctx = cv.canvas.getContext('2d');
  cv.styleSel = document.getElementById('curveStyle');
  cv.dirSel = document.getElementById('curveDir');
  cv.presetWrap = document.getElementById('curvePresets');

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

function applyToSelection(es, ed, bez) {
  const sel = S.state.selection.keys;
  if (!sel.length) return;
  S.setEasing(sel, es, ed, bez);
  drawSoon();
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

  const found = firstSelectedKey();
  ctx.font = '11px Inter, system-ui, sans-serif';
  if (!found) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'center';
    ctx.fillText('Select a keyframe to edit its outgoing curve', w / 2, h / 2);
    return;
  }
  const { key } = found;
  cv.styleSel.value = key.es || 'Linear';
  cv.dirSel.value = key.ed || 'Out';

  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  for (let gy = 0; gy <= 1; gy += 0.25) {
    ctx.moveTo(X(0, w), Y(gy, h)); ctx.lineTo(X(1, w), Y(gy, h));
  }
  for (let gx = 0; gx <= 1; gx += 0.25) {
    ctx.moveTo(X(gx, w), Y(Y_MIN, h)); ctx.lineTo(X(gx, w), Y(Y_MAX, h));
  }
  ctx.stroke();
  // baseline 0 and 1
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.moveTo(X(0, w), Y(0, h)); ctx.lineTo(X(1, w), Y(0, h));
  ctx.moveTo(X(0, w), Y(1, h)); ctx.lineTo(X(1, w), Y(1, h));
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.textAlign = 'right';
  ctx.fillText('0', PAD.l - 8, Y(0, h) + 3);
  ctx.fillText('1', PAD.l - 8, Y(1, h) + 3);

  // curve
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7c8cff';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    const v = evalSegment(key, t);
    if (i === 0) ctx.moveTo(X(t, w), Y(v, h));
    else ctx.lineTo(X(t, w), Y(v, h));
  }
  ctx.stroke();
  ctx.lineWidth = 1;

  // bezier handles
  if (key.bez) {
    const [x1, y1, x2, y2] = key.bez;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.moveTo(X(0, w), Y(0, h)); ctx.lineTo(X(x1, w), Y(y1, h));
    ctx.moveTo(X(1, w), Y(1, h)); ctx.lineTo(X(x2, w), Y(y2, h));
    ctx.stroke();
    for (const [hx, hy, name] of [[x1, y1, 'p1'], [x2, y2, 'p2']]) {
      ctx.beginPath();
      ctx.arc(X(hx, w), Y(hy, h), 6, 0, Math.PI * 2);
      ctx.fillStyle = cv.drag === name ? '#ffffff' : accent;
      ctx.fill();
    }
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'left';
    ctx.fillText(`${key.es || 'Linear'} · ${key.ed || 'Out'} — click "Custom bezier" to sculpt freely`, PAD.l, 16);
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
