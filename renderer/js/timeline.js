// Timeline: track list + dope sheet canvas + scrubber + audio waveform lane.
import * as S from './state.js';
import { STYLES, DIRECTIONS } from './easing.js';
import { getWaveformSlice, hasAudio, setAudioOffset } from './audio.js';
import { showContextMenu } from './ui.js';
import { openCurveEditor } from './curves.js';

const ROW_H = 26;
const RULER_H = 30;
const AUDIO_ROW_H = 44;
const PAD_LEFT = 14; // breathing room so frame-0 keyframes aren't flush against the canvas edge

export const tl = {
  listEl: null,
  canvas: null,
  ctx: null,
  wrap: null,
  pxPerFrame: 14,
  scrollX: 0,       // in frames
  scrollY: 0,       // px, synced with track list scroll
  rows: [],         // visual rows: {kind:'item'|'track'|'audio', itemId, track, label, depth}
  collapsed: new Set(),
  drag: null,
  hoverRow: -1,
  needsDraw: true,
};

export function initTimeline({ listEl, canvasEl, wrapEl }) {
  tl.listEl = listEl;
  tl.canvas = canvasEl;
  tl.wrap = wrapEl;
  tl.ctx = canvasEl.getContext('2d');

  const ro = new ResizeObserver(() => { fitCanvas(); tl.needsDraw = true; });
  ro.observe(wrapEl);
  fitCanvas();

  canvasEl.addEventListener('pointerdown', onPointerDown);
  canvasEl.addEventListener('pointermove', onPointerMove);
  canvasEl.addEventListener('wheel', onWheel, { passive: false });
  canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
  canvasEl.addEventListener('dblclick', onDblClick);

  listEl.addEventListener('scroll', () => {
    tl.scrollY = listEl.scrollTop;
    tl.needsDraw = true;
  });

  ['tracks', 'items', 'selection', 'project', 'overlay', 'project-props', 'audio', 'groups'].forEach((ev) =>
    S.on(ev, () => { rebuildRows(); tl.needsDraw = true; }));
  S.on('playhead', () => { tl.needsDraw = true; ensurePlayheadVisible(); });

  rebuildRows();
  requestAnimationFrame(drawLoop);
}

function fitCanvas() {
  const r = tl.wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio, 2);
  tl.canvas.width = Math.max(1, Math.floor(r.width * dpr));
  tl.canvas.height = Math.max(1, Math.floor(r.height * dpr));
  tl.canvas.style.width = r.width + 'px';
  tl.canvas.style.height = r.height + 'px';
  tl.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ---------------------------------------------------------------- rows
function rebuildRows() {
  const p = S.state.project;
  tl.rows = [];
  if (!p) { renderList(); return; }
  if (p.audio) tl.rows.push({ kind: 'audio', label: p.audio.name });
  for (const item of p.items) {
    if (item.kind === 'camera' && !S.state.cameraTracksVisible) continue;
    tl.rows.push({ kind: 'item', itemId: item.id, label: item.name });
    if (tl.collapsed.has(item.id)) continue;
    tl.rows.push({ kind: 'track', itemId: item.id, track: '@origin', label: item.kind === 'camera' ? 'Camera Position' : 'Rig Origin', depth: 1 });
    if (item.kind === 'camera') {
      tl.rows.push({ kind: 'track', itemId: item.id, track: '@fov', label: 'Field of View', depth: 1 });
    } else if (item.rig) {
      for (const j of item.rig.joints || []) {
        if (j.kind === 'weld') continue;
        tl.rows.push({ kind: 'track', itemId: item.id, track: j.name, label: j.name, depth: 1, part1: j.part1 });
      }
    }
  }
  renderList();
}

function renderList() {
  const el = tl.listEl;
  el.innerHTML = '';
  const sel = S.state.selection;
  for (let i = 0; i < tl.rows.length; i++) {
    const row = tl.rows[i];
    const div = document.createElement('div');
    div.className = 'tl-row ' + row.kind;
    div.style.height = (row.kind === 'audio' ? AUDIO_ROW_H : ROW_H) + 'px';
    if (row.kind === 'item') {
      const item = S.getItem(row.itemId);
      const caret = document.createElement('span');
      caret.className = 'caret' + (tl.collapsed.has(row.itemId) ? ' closed' : '');
      caret.textContent = '▾';
      div.appendChild(caret);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = row.label;
      div.appendChild(name);
      const icon = document.createElement('span');
      icon.className = 'kind-icon';
      icon.textContent = item?.kind === 'camera' ? '🎥' : '🧍';
      div.prepend(icon);
      div.addEventListener('click', () => {
        S.setSelection(row.itemId, null);
      });
      caret.addEventListener('click', (e) => {
        e.stopPropagation();
        if (tl.collapsed.has(row.itemId)) tl.collapsed.delete(row.itemId);
        else tl.collapsed.add(row.itemId);
        rebuildRows();
        tl.needsDraw = true;
      });
      if (sel.itemId === row.itemId && !sel.partId) div.classList.add('selected');
    } else if (row.kind === 'track') {
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = row.label;
      div.appendChild(name);
      div.style.paddingLeft = '26px';
      div.addEventListener('click', () => {
        const item = S.getItem(row.itemId);
        if (row.track === '@origin' || row.track === '@fov') S.setSelection(row.itemId, item?.kind === 'camera' ? '@camera' : '@origin');
        else S.setSelection(row.itemId, row.part1 || null);
      });
      const isSelTrack = sel.itemId === row.itemId && trackForSelection() === row.track;
      if (isSelTrack) div.classList.add('selected');
    } else if (row.kind === 'audio') {
      div.innerHTML = `<span class="kind-icon">🔊</span><span class="name">${row.label}</span>`;
    }
    el.appendChild(div);
  }
  const spacer = document.createElement('div');
  spacer.style.height = '60px';
  el.appendChild(spacer);
}

function trackForSelection() {
  const { itemId, partId } = S.state.selection;
  if (!itemId || !partId) return null;
  const item = S.getItem(itemId);
  if (partId === '@origin' || partId === '@camera') return '@origin';
  const j = (item?.rig?.joints || []).find((j) => j.part1 === partId && j.kind !== 'weld');
  return j ? j.name : null;
}

// ---------------------------------------------------------------- coords
const frameToX = (f) => (f - tl.scrollX) * tl.pxPerFrame + PAD_LEFT;
const xToFrame = (x) => (x - PAD_LEFT) / tl.pxPerFrame + tl.scrollX;
// "Logical" = content-space Y, independent of the current scroll position (scrollY subtracted
// back out to get an actual on-screen pixel). Box-select needs the logical form so a drag that
// spans more rows than fit on screen at once keeps working correctly through an auto-scroll.
function rowTopLogical(i) {
  let y = RULER_H;
  for (let k = 0; k < i; k++) y += tl.rows[k].kind === 'audio' ? AUDIO_ROW_H : ROW_H;
  return y;
}
function rowTop(i) { return rowTopLogical(i) - tl.scrollY; }
function rowAtY(y) {
  const logicalY = y + tl.scrollY;
  let acc = RULER_H;
  for (let i = 0; i < tl.rows.length; i++) {
    const h = tl.rows[i].kind === 'audio' ? AUDIO_ROW_H : ROW_H;
    if (logicalY >= acc && logicalY < acc + h) return i;
    acc += h;
  }
  return -1;
}
function trackListContentHeight() {
  let h = RULER_H;
  for (const row of tl.rows) h += row.kind === 'audio' ? AUDIO_ROW_H : ROW_H;
  return h + 60; // matches renderList()'s trailing spacer
}

function ensurePlayheadVisible() {
  if (!S.state.playing) return;
  const w = tl.canvas.clientWidth;
  const x = frameToX(S.state.playhead);
  if (x > w - 40) tl.scrollX = S.state.playhead - 40 / tl.pxPerFrame;
  if (x < 0) tl.scrollX = Math.max(0, S.state.playhead - 2);
}

// A box-select drag can only cover whatever's currently visible unless the list scrolls to
// reveal more rows while you're still holding the drag — this is what makes that possible:
// runs every frame (not just on pointermove, since the mouse can sit still near an edge).
const AUTOSCROLL_EDGE = 30;    // px from the top/bottom edge that starts auto-scrolling
const AUTOSCROLL_MAX_SPEED = 18; // px/frame at full depth into the edge zone
function autoScrollTick() {
  const d = tl.drag;
  if (d?.kind !== 'box') return;
  const h = tl.canvas.clientHeight;
  const y = d.lastRawY;
  let dy = 0;
  if (y < RULER_H + AUTOSCROLL_EDGE) dy = -Math.min(AUTOSCROLL_MAX_SPEED, (RULER_H + AUTOSCROLL_EDGE - y) * 0.6);
  else if (y > h - AUTOSCROLL_EDGE) dy = Math.min(AUTOSCROLL_MAX_SPEED, (y - (h - AUTOSCROLL_EDGE)) * 0.6);
  if (dy === 0) return;
  const maxScroll = Math.max(0, trackListContentHeight() - tl.listEl.clientHeight);
  const next = Math.max(0, Math.min(maxScroll, tl.listEl.scrollTop + dy));
  if (next === tl.scrollY) return;
  tl.scrollY = next;           // set directly rather than waiting on the 'scroll' event's async
  tl.listEl.scrollTop = next;  // round-trip, so rowY1 below always reflects the true new offset
  d.rowY1 = d.lastRawY + tl.scrollY; // extend the logical selection to include newly-revealed rows
  tl.needsDraw = true;
}

// ---------------------------------------------------------------- draw
function drawLoop() {
  autoScrollTick();
  if (tl.needsDraw) { draw(); tl.needsDraw = false; }
  requestAnimationFrame(drawLoop);
}

export function requestDraw() { tl.needsDraw = true; }

function draw() {
  const ctx = tl.ctx;
  const w = tl.canvas.clientWidth, h = tl.canvas.clientHeight;
  const p = S.state.project;
  ctx.clearRect(0, 0, w, h);
  if (!p) return;

  const styles = getComputedStyle(document.documentElement);
  const cAccent = styles.getPropertyValue('--accent').trim() || '#7c8cff';
  const cKey = '#c9cbe0';
  const cKeySel = cAccent;

  // out-of-range shading
  const endX = frameToX(p.length);
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  if (endX < w) ctx.fillRect(endX, 0, w - endX, h);

  // row stripes + per-row keys
  for (let i = 0; i < tl.rows.length; i++) {
    const row = tl.rows[i];
    const y = rowTop(i);
    const rh = row.kind === 'audio' ? AUDIO_ROW_H : ROW_H;
    if (y + rh < RULER_H || y > h) continue;
    if (row.kind === 'item') {
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.fillRect(0, y, w, rh);
    } else if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.014)';
      ctx.fillRect(0, y, w, rh);
    }
    if (row.kind === 'audio') drawAudioRow(ctx, y, rh, w);
  }

  // grid lines
  const step = niceStep(tl.pxPerFrame);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  const first = Math.floor(tl.scrollX / step) * step;
  for (let f = first; f <= tl.scrollX + w / tl.pxPerFrame; f += step) {
    const x = Math.round(frameToX(f)) + 0.5;
    ctx.moveTo(x, RULER_H);
    ctx.lineTo(x, h);
  }
  ctx.stroke();

  // keys
  const selSet = new Set(S.state.selection.keys.map((k) => `${k.itemId}|${k.track}|${k.t}`));
  for (let i = 0; i < tl.rows.length; i++) {
    const row = tl.rows[i];
    if (row.kind === 'audio') continue;
    const y = rowTop(i);
    const rh = ROW_H;
    if (y + rh < RULER_H || y > h) continue;
    const cy = y + rh / 2;
    if (row.kind === 'item') {
      // aggregated dope-sheet markers
      const times = new Set();
      const tracks = S.getTracks(row.itemId);
      for (const tn of Object.keys(tracks)) for (const k of tracks[tn].keys) times.add(k.t);
      ctx.fillStyle = 'rgba(201,203,224,0.55)';
      for (const t of times) {
        const x = frameToX(t);
        if (x < -6 || x > w + 6) continue;
        drawDiamond(ctx, x, cy, 3.4);
      }
    } else {
      const tr = S.getTrack(row.itemId, row.track);
      if (!tr) continue;
      for (const k of tr.keys) {
        const x = frameToX(k.t);
        if (x < -8 || x > w + 8) continue;
        const isSel = selSet.has(`${row.itemId}|${row.track}|${k.t}`);
        const dragging = tl.drag?.kind === 'move' && isSel;
        const grouped = !!S.findGroup(row.itemId, row.track, k.t);
        if (grouped) {
          ctx.strokeStyle = 'rgba(240,185,92,0.85)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, cy, 7.5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.lineWidth = 1;
        }
        ctx.fillStyle = isSel ? cKeySel : cKey;
        if (dragging) {
          // ghost at destination
          ctx.globalAlpha = 0.35;
          drawDiamond(ctx, x, cy, 5);
          ctx.globalAlpha = 1;
          drawDiamond(ctx, x + tl.drag.dt * tl.pxPerFrame, cy, 5);
        } else {
          drawDiamond(ctx, x, cy, isSel ? 5.5 : 4.5);
        }
        if (k.bez || (k.es && k.es !== 'Linear' && k.es !== 'Cubic')) {
          ctx.fillStyle = 'rgba(124,140,255,0.8)';
          ctx.fillRect(x - 1, cy + 8, 2, 2);
        }
      }
    }
  }

  // box select — f0/f1 (frames) and rowY0/rowY1 (logical/scroll-invariant Y) are converted back
  // to the CURRENT on-screen position here, so the box always draws correctly relative to
  // whatever's scrolled into view right now, even mid-auto-scroll.
  if (tl.drag?.kind === 'box') {
    const { f0, f1, rowY0, rowY1 } = tl.drag;
    const x0 = frameToX(f0), x1 = frameToX(f1);
    const y0 = rowY0 - tl.scrollY, y1 = rowY1 - tl.scrollY;
    ctx.fillStyle = 'rgba(124,140,255,0.12)';
    ctx.strokeStyle = 'rgba(124,140,255,0.7)';
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
  }

  // ruler
  ctx.fillStyle = '#14141b';
  ctx.fillRect(0, 0, w, RULER_H);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath(); ctx.moveTo(0, RULER_H + 0.5); ctx.lineTo(w, RULER_H + 0.5); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let f = first; f <= tl.scrollX + w / tl.pxPerFrame; f += step) {
    const x = frameToX(f);
    ctx.fillText(String(Math.round(f)), x, 12);
    ctx.fillRect(x, RULER_H - 7, 1, 7);
  }
  // end marker
  ctx.fillStyle = 'rgba(255,120,120,0.5)';
  ctx.fillRect(endX, 0, 2, h);

  // playhead
  const px = frameToX(S.state.playhead);
  ctx.fillStyle = cAccent;
  ctx.fillRect(px - 0.5, RULER_H - 6, 1.5, h);
  ctx.beginPath();
  ctx.moveTo(px - 6, 14); ctx.lineTo(px + 6, 14); ctx.lineTo(px, 26); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#0d0d12';
  ctx.font = 'bold 10px Inter, system-ui, sans-serif';
  const label = String(Math.round(S.state.playhead * 10) / 10);
  const lw = ctx.measureText(label).width + 10;
  ctx.fillStyle = cAccent;
  roundRect(ctx, px - lw / 2, 0, lw, 13, 4);
  ctx.fill();
  ctx.fillStyle = '#101016';
  ctx.fillText(label, px, 9.5);
}

function drawAudioRow(ctx, y, rh, w) {
  if (!hasAudio()) return;
  const p = S.state.project;
  const fps = p.fps;
  const startF = tl.scrollX;
  const endF = tl.scrollX + w / tl.pxPerFrame;
  const offset = p.audio?.offset || 0;
  const slice = getWaveformSlice((startF - offset) / fps, (endF - offset) / fps, Math.floor(w / 2));
  if (!slice) return;
  ctx.save();
  ctx.fillStyle = 'rgba(114,200,180,0.06)';
  ctx.fillRect(0, y, w, rh);
  ctx.strokeStyle = 'rgba(114,220,190,0.75)';
  ctx.beginPath();
  const mid = y + rh / 2;
  for (let i = 0; i < slice.mins.length; i++) {
    const x = i * 2 + 0.5;
    const a = slice.maxs[i] * (rh / 2 - 3);
    const b = slice.mins[i] * (rh / 2 - 3);
    ctx.moveTo(x, mid - a);
    ctx.lineTo(x, mid - b + 1);
  }
  ctx.stroke();
  ctx.restore();
}

function drawDiamond(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
function niceStep(ppf) {
  const target = 60 / ppf; // ~60px between labels
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300];
  for (const s of steps) if (s >= target) return s;
  return 600;
}

// ---------------------------------------------------------------- interaction
function keyAt(x, y) {
  const i = rowAtY(y);
  if (i < 0) return null;
  const row = tl.rows[i];
  if (!row || row.kind === 'audio') return null;
  const hitR = 7;
  if (row.kind === 'track') {
    const tr = S.getTrack(row.itemId, row.track);
    if (!tr) return null;
    for (const k of tr.keys) {
      if (Math.abs(frameToX(k.t) - x) <= hitR) return { itemId: row.itemId, track: row.track, t: k.t, row: i };
    }
  } else if (row.kind === 'item') {
    const tracks = S.getTracks(row.itemId);
    for (const tn of Object.keys(tracks)) {
      for (const k of tracks[tn].keys) {
        if (Math.abs(frameToX(k.t) - x) <= hitR) return { itemId: row.itemId, track: '*', t: k.t, row: i };
      }
    }
  }
  return null;
}

function expandItemKeys(itemId, t) {
  // '*' pseudo-track: all keys of the item at time t
  const out = [];
  const tracks = S.getTracks(itemId);
  for (const tn of Object.keys(tracks)) {
    if (tracks[tn].keys.some((k) => Math.abs(k.t - t) < 1e-6)) out.push({ itemId, track: tn, t });
  }
  return out;
}

function onPointerDown(e) {
  const rect = tl.canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  tl.canvas.setPointerCapture(e.pointerId);

  if (e.button === 1) {
    tl.drag = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
    return;
  }

  if (e.button === 2) {
    const hit = keyAt(x, y);
    if (hit) {
      const keys = hit.track === '*' ? expandItemKeys(hit.itemId, hit.t) : [hit];
      const already = S.state.selection.keys.some((k) => k.itemId === hit.itemId && k.track === hit.track && Math.abs(k.t - hit.t) < 1e-6);
      if (!already) S.setSelectedKeys(keys);
      openKeyContextMenu(e.clientX, e.clientY);
    }
    return;
  }

  if (e.button !== 0) return;

  // ruler → scrub
  if (y < RULER_H) {
    tl.drag = { kind: 'scrub' };
    S.setPlayhead(xToFrame(x));
    return;
  }

  const rowIdx = rowAtY(y);
  const row = rowIdx >= 0 ? tl.rows[rowIdx] : null;

  // audio row → drag offset
  if (row && row.kind === 'audio') {
    tl.drag = { kind: 'audio', startX: x, startOffset: S.state.project.audio.offset || 0 };
    return;
  }

  const hit = keyAt(x, y);
  if (hit) {
    const keys = hit.track === '*' ? expandItemKeys(hit.itemId, hit.t) : [{ itemId: hit.itemId, track: hit.track, t: hit.t }];
    const cur = S.state.selection.keys;
    const isSelected = cur.some((k) => keys.some((n) => n.itemId === k.itemId && n.track === k.track && Math.abs(n.t - k.t) < 1e-6));
    if (e.shiftKey) {
      S.setSelectedKeys(isSelected ? cur.filter((k) => !keys.some((n) => n.itemId === k.itemId && n.track === k.track && Math.abs(n.t - k.t) < 1e-6)) : [...cur, ...keys]);
    } else if (!isSelected) {
      S.setSelectedKeys(keys);
    }
    tl.drag = { kind: 'move', startX: x, dt: 0 };
  } else {
    // f0/f1 (frame numbers) and rowY0/rowY1 (logical row-space Y) are scroll-invariant — the
    // drag stays correct through horizontal AND vertical scrolling/auto-scrolling mid-select,
    // unlike raw canvas pixels which silently go stale the moment the view scrolls.
    const f = xToFrame(x), ly = y + tl.scrollY;
    tl.drag = { kind: 'box', f0: f, f1: f, rowY0: ly, rowY1: ly, lastRawY: y, additive: e.shiftKey };
    if (!e.shiftKey) S.setSelectedKeys([]);
  }
  tl.needsDraw = true;
}

function onPointerMove(e) {
  const rect = tl.canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  if (!tl.drag) return;
  const d = tl.drag;
  if (d.kind === 'scrub') {
    S.setPlayhead(xToFrame(x));
  } else if (d.kind === 'pan') {
    tl.scrollX = Math.max(0, tl.scrollX - (e.clientX - d.lastX) / tl.pxPerFrame);
    tl.listEl.scrollTop -= (e.clientY - d.lastY);
    d.lastX = e.clientX; d.lastY = e.clientY;
    tl.needsDraw = true;
  } else if (d.kind === 'move') {
    let dt = (x - d.startX) / tl.pxPerFrame;
    if (S.state.snapping && !e.altKey) dt = Math.round(dt);
    d.dt = dt;
    tl.needsDraw = true;
  } else if (d.kind === 'box') {
    d.f1 = xToFrame(x);
    d.rowY1 = y + tl.scrollY;
    d.lastRawY = y; // raw (non-logical) canvas Y, used by the auto-scroll edge check below
    tl.needsDraw = true;
  } else if (d.kind === 'audio') {
    let off = d.startOffset + (x - d.startX) / tl.pxPerFrame;
    if (S.state.snapping && !e.altKey) off = Math.round(off);
    setAudioOffset(off);
    tl.needsDraw = true;
  }
}

tl.onPointerUp = null;
window.addEventListener('pointerup', () => {
  const d = tl.drag;
  if (!d) return;
  tl.drag = null;
  if (d.kind === 'move' && d.dt !== 0) {
    const moved = S.moveKeys(S.state.selection.keys, d.dt);
    S.setSelectedKeys(moved);
  } else if (d.kind === 'box') {
    // Compare against frame numbers / logical row positions, not stale on-screen pixels — a
    // drag that auto-scrolled (or was scrolled manually) mid-select still resolves correctly,
    // since neither coordinate space depends on where the view happened to be at release time.
    const fMin = Math.min(d.f0, d.f1), fMax = Math.max(d.f0, d.f1);
    const slopFrames = 4 / tl.pxPerFrame;
    const rowY0 = Math.min(d.rowY0, d.rowY1), rowY1 = Math.max(d.rowY0, d.rowY1);
    const picked = d.additive ? [...S.state.selection.keys] : [];
    for (let i = 0; i < tl.rows.length; i++) {
      const row = tl.rows[i];
      if (row.kind !== 'track') continue;
      const top = rowTopLogical(i);
      if (top + ROW_H < rowY0 || top > rowY1) continue;
      const tr = S.getTrack(row.itemId, row.track);
      if (!tr) continue;
      for (const k of tr.keys) {
        if (k.t >= fMin - slopFrames && k.t <= fMax + slopFrames) picked.push({ itemId: row.itemId, track: row.track, t: k.t });
      }
    }
    S.setSelectedKeys(picked);
  }
  tl.needsDraw = true;
});

function onDblClick(e) {
  const rect = tl.canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const i = rowAtY(y);
  if (i < 0) return;
  const row = tl.rows[i];
  if (row.kind !== 'track') return;
  let f = xToFrame(x);
  if (S.state.snapping) f = Math.round(f);
  // key the current evaluated value at that frame (so the pose holds)
  if (row.track === '@fov') {
    const item = S.getItem(row.itemId);
    S.setKey(row.itemId, row.track, f, S.evalTrackNum(row.itemId, '@fov', f, item.fov || 70));
  } else if (row.track === '@origin') {
    const item = S.getItem(row.itemId);
    S.setKey(row.itemId, row.track, f, S.evalTrackCF(row.itemId, '@origin', f, item.origin || [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]));
  } else {
    S.setKey(row.itemId, row.track, f, S.evalTrackCF(row.itemId, row.track, f));
  }
  S.setSelectedKeys([{ itemId: row.itemId, track: row.track, t: f }]);
}

function onWheel(e) {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const rect = tl.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const fAtMouse = xToFrame(mx);
    const factor = e.deltaY > 0 ? 0.85 : 1.18;
    tl.pxPerFrame = Math.max(1.5, Math.min(80, tl.pxPerFrame * factor));
    tl.scrollX = Math.max(0, fAtMouse - mx / tl.pxPerFrame);
  } else if (e.shiftKey) {
    tl.scrollX = Math.max(0, tl.scrollX + e.deltaY / tl.pxPerFrame);
  } else {
    tl.listEl.scrollTop += e.deltaY;
  }
  tl.needsDraw = true;
}

// ---------------------------------------------------------------- context menu
function openKeyContextMenu(cx, cy) {
  const sel = S.state.selection.keys;
  if (!sel.length) return;
  const styleItems = STYLES.map((s) => ({
    label: s,
    run: () => S.setEasing(sel, s, null, null),
  }));
  const dirItems = DIRECTIONS.map((d) => ({
    label: d,
    run: () => S.setEasing(sel, null, d, null),
  }));
  const isGrouped = sel.some((k) => S.findGroup(k.itemId, k.track, k.t));
  showContextMenu(cx, cy, [
    { label: `${sel.length} keyframe${sel.length > 1 ? 's' : ''}`, header: true },
    { label: 'Easing style', children: styleItems },
    { label: 'Easing direction', children: dirItems },
    { label: 'Edit curve…', run: () => openCurveEditor() },
    { sep: true },
    { label: 'Cut', shortcut: 'Ctrl+X', run: () => cutSelectedKeys() },
    { label: 'Copy', shortcut: 'Ctrl+C', run: () => copySelectedKeys() },
    { label: 'Duplicate at playhead', shortcut: 'Ctrl+D', run: () => duplicateAtPlayhead() },
    { sep: true },
    sel.length >= 2
      ? { label: 'Group', shortcut: 'Ctrl+G', run: () => S.groupKeys(sel) }
      : { label: 'Group', shortcut: 'Ctrl+G', run: () => { } },
    ...(isGrouped ? [{ label: 'Ungroup', shortcut: 'Shift+Ctrl+U', run: () => S.ungroupKeys(sel) }] : []),
    { sep: true },
    { label: 'Delete', shortcut: 'Del', danger: true, run: () => S.deleteKeys(sel) },
  ]);
}
// Keyboard-triggered version (Keypad 7) — anchors near the playhead/selection instead of the cursor.
export function openSelectedKeyMenu() {
  const sel = S.state.selection.keys;
  if (!sel.length) { return false; }
  const x = frameToX(sel[0].t) + (tl.canvas.getBoundingClientRect?.().left || 0);
  const y = (tl.canvas.getBoundingClientRect?.().top || 0) + 80;
  openKeyContextMenu(Math.max(20, x), Math.max(20, y));
  return true;
}

export function copySelectedKeys() {
  const sel = S.state.selection.keys;
  if (!sel.length) return;
  const minT = Math.min(...sel.map((k) => k.t));
  const entries = [];
  for (const ref of sel) {
    const k = S.getKey(ref.itemId, ref.track, ref.t);
    if (k) entries.push({ itemId: ref.itemId, track: ref.track, dt: ref.t - minT, key: structuredClone(k) });
  }
  S.state.clipboard = { kind: 'keys', entries };
}

export function cutSelectedKeys() {
  copySelectedKeys();
  S.deleteKeys(S.state.selection.keys);
}

export function pasteKeys() {
  const clip = S.state.clipboard;
  if (!clip || clip.kind !== 'keys' || !clip.entries.length) return;
  const t0 = Math.round(S.state.playhead);
  S.pushUndo();
  const sel = [];
  for (const en of clip.entries) {
    S.setKey(en.itemId, en.track, t0 + en.dt, structuredClone(en.key.v), { noUndo: true, es: en.key.es, ed: en.key.ed, bez: en.key.bez });
    sel.push({ itemId: en.itemId, track: en.track, t: t0 + en.dt });
  }
  S.setSelectedKeys(sel);
}

// "Paste Into Item": re-target copied keys onto the currently-selected item, matching by
// track name, instead of the item they were originally copied from — for copying a pose
// across rigs that share joint names.
export function pasteKeysIntoItem(targetItemId) {
  const clip = S.state.clipboard;
  if (!clip || clip.kind !== 'keys' || !clip.entries.length) return;
  if (!targetItemId) { return; }
  const t0 = Math.round(S.state.playhead);
  S.pushUndo();
  const sel = [];
  for (const en of clip.entries) {
    S.setKey(targetItemId, en.track, t0 + en.dt, structuredClone(en.key.v), { noUndo: true, es: en.key.es, ed: en.key.ed, bez: en.key.bez });
    sel.push({ itemId: targetItemId, track: en.track, t: t0 + en.dt });
  }
  S.setSelectedKeys(sel);
}

export function duplicateAtPlayhead() {
  copySelectedKeys();
  pasteKeys();
}

export function zoomToFit() {
  const p = S.state.project;
  if (!p) return;
  const w = tl.canvas.clientWidth - 60;
  tl.pxPerFrame = Math.max(1.5, Math.min(80, w / Math.max(30, p.length)));
  tl.scrollX = 0;
  tl.needsDraw = true;
}

// Toggle the selected item's own track-list collapse state (Shift+Space).
export function toggleItemCollapse(itemId) {
  if (!itemId) return;
  if (tl.collapsed.has(itemId)) tl.collapsed.delete(itemId);
  else tl.collapsed.add(itemId);
  rebuildRows();
  tl.needsDraw = true;
}

// Collapse-all / expand-all across every item at once (Keypad 2).
export function toggleCollapseAll() {
  const p = S.state.project;
  if (!p || !p.items.length) return;
  const allCollapsed = p.items.every((i) => tl.collapsed.has(i.id));
  if (allCollapsed) tl.collapsed.clear();
  else for (const i of p.items) tl.collapsed.add(i.id);
  rebuildRows();
  tl.needsDraw = true;
}
