// Timeline: track list + dope sheet canvas + scrubber + audio waveform lane.
import * as S from './state.js';
import { STYLES, DIRECTIONS, easeColor } from './easing.js';
import { getWaveformSlice, hasAudio, setAudioOffset, renameAudio } from './audio.js';
import { showContextMenu, promptModal, modal, toast } from './ui.js';
import { openCurveEditor } from './curves.js';
import { iconSvg, itemIconSvg } from './icons.js';
import * as PROPS from './propTracks.js';

const ROW_H = 26;
const RULER_H = 30;
const AUDIO_ROW_H = 44;
const PAD_LEFT = 14; // breathing room so frame-0 keyframes aren't flush against the canvas edge
const PLAYRANGE_BAR_H = 5; // play-range grab strip along the bottom of the ruler
const PLAYRANGE_GRAB_PX = 6; // how close to an end handle counts as grabbing it rather than the middle

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

  // The canvas pushes every lane down by its RULER_H-tall frame ruler (see rowTopLogical), so the
  // DOM label list must carry the same top offset or every name renders a full row above its keys.
  // Set here from the same constant (not duplicated in styles.css) so the two can never drift —
  // trackListContentHeight() below already assumes this offset exists.
  listEl.style.paddingTop = RULER_H + 'px';

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

  ['tracks', 'items', 'selection', 'project', 'overlay', 'project-props', 'audio', 'groups', 'markers', 'play-range', 'theme'].forEach((ev) =>
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
    // Moon gives every item an "Events" lane (its MarkerTrack) above the property tracks.
    tl.rows.push({ kind: 'events', itemId: item.id, label: 'Events', depth: 1 });
    // A prop item is a Roblox instance being driven by property tracks — it has no position in
    // Cadence's own viewport, so it gets no origin row.
    if (item.kind !== 'prop') {
      tl.rows.push({ kind: 'track', itemId: item.id, track: '@origin', label: item.kind === 'camera' ? 'Camera Position' : item.kind === 'vfx' ? 'Emitter Position' : item.kind === 'effect' ? 'Effect Position' : 'Rig Origin', depth: 1 });
    }
    if (item.kind === 'camera') {
      tl.rows.push({ kind: 'track', itemId: item.id, track: '@fov', label: 'Field of View', depth: 1 });
    } else if (item.kind === 'vfx') {
      tl.rows.push({ kind: 'track', itemId: item.id, track: '@rate', label: 'Emission Rate', depth: 1 });
      tl.rows.push({ kind: 'track', itemId: item.id, track: '@lifetime', label: 'Particle Lifetime', depth: 1 });
      tl.rows.push({ kind: 'track', itemId: item.id, track: '@speed', label: 'Particle Speed', depth: 1 });
    } else if (item.kind === 'effect') {
      // No per-track numeric keyframes — an effect document's own curves live inside item.effect,
      // not as animator timeline tracks (docs/vfx-studio.md). Only its placement is keyable here.
    } else if (item.kind === 'prop') {
      // One row per animated property / action on the targeted Roblox instance, in the order
      // they were added (Object.keys preserves insertion order for string keys).
      for (const name of Object.keys(S.getTracks(item.id))) {
        if (name === '@origin') continue; // already emitted above
        const isAct = S.isActionTrack(name);
        tl.rows.push({
          kind: 'track', itemId: item.id, track: name, depth: 1,
          label: isAct ? (PROPS.ACTIONS[S.actionKeyOf(name)]?.label || S.actionKeyOf(name)) : S.humanizeRigName(name),
          action: isAct,
        });
      }
    } else if (item.rig) {
      for (const j of item.rig.joints || []) {
        if (j.kind === 'weld') continue;
        // track stays the REAL joint name (used for every lookup); label is display-only — shows
        // the PART it moves (e.g. "Right Upper Arm") rather than the joint driving it, swapped
        // with the Inspector's title (which shows the joint) per the user's explicit request.
        const partDef = item.rig.parts.find((p) => p.id === j.part1);
        tl.rows.push({ kind: 'track', itemId: item.id, track: j.name, label: S.humanizeRigName(partDef ? partDef.name : j.name), depth: 1, part1: j.part1 });
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
      caret.innerHTML = iconSvg('caret', { size: 11 });
      div.appendChild(caret);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = row.label;
      div.appendChild(name);
      const icon = document.createElement('span');
      icon.className = 'kind-icon';
      icon.innerHTML = itemIconSvg(item?.kind, { size: 12 });
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
        if (row.track.startsWith('@')) S.setSelection(row.itemId, item?.kind === 'camera' ? '@camera' : item?.kind === 'vfx' ? '@vfx' : '@origin');
        else S.setSelection(row.itemId, row.part1 || null);
      });
      const isSelTrack = sel.itemId === row.itemId && trackForSelection() === row.track;
      if (isSelTrack) div.classList.add('selected');
    } else if (row.kind === 'events') {
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = row.label;
      div.appendChild(name);
      div.style.paddingLeft = '26px';
      div.title = 'Double-click the lane to add an event marker';
      const add = document.createElement('button');
      add.className = 'tl-row-btn';
      add.textContent = '+';
      add.title = 'Add an event marker at the playhead';
      add.addEventListener('click', (e) => {
        e.stopPropagation();
        const m = S.addMarker(row.itemId, Math.round(S.state.playhead));
        if (m) { S.setSelectedMarkers([{ itemId: row.itemId, t: m.t }]); openMarkerEditor(row.itemId, m.t); }
        else toast('There is already an event at this frame', 'warn');
      });
      div.appendChild(add);
    } else if (row.kind === 'audio') {
      div.innerHTML = `<span class="kind-icon">${iconSvg('speaker', { size: 12 })}</span><span class="name"></span>`;
      const nameEl = div.querySelector('.name');
      nameEl.textContent = row.label;
      nameEl.title = 'Double-click to rename';
      nameEl.addEventListener('dblclick', async (e) => {
        e.stopPropagation();
        const v = await promptModal({ title: 'Rename audio', label: 'Name', initial: row.label });
        if (v) renameAudio(v);
      });
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
  if (partId === '@origin' || partId === '@camera' || partId === '@vfx') return '@origin';
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

  // Canvas can't inherit CSS vars — read the theme's palette per draw (cheap: draws only happen
  // on needsDraw, and getComputedStyle here was already the established pattern for --accent).
  const styles = getComputedStyle(document.documentElement);
  const themeVar = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  const cAccent = themeVar('--accent', '#7c8cff');
  const cKey = themeVar('--text-1', '#c9cbe0');
  const cKeySel = cAccent;

  // out-of-range shading
  const endX = frameToX(p.length);
  ctx.fillStyle = themeVar('--tl-shade', 'rgba(255,255,255,0.025)');
  if (endX < w) ctx.fillRect(endX, 0, w - endX, h);

  // row stripes + per-row keys
  for (let i = 0; i < tl.rows.length; i++) {
    const row = tl.rows[i];
    const y = rowTop(i);
    const rh = row.kind === 'audio' ? AUDIO_ROW_H : ROW_H;
    if (y + rh < RULER_H || y > h) continue;
    if (row.kind === 'item') {
      ctx.fillStyle = themeVar('--tl-stripe-item', 'rgba(255,255,255,0.045)');
      ctx.fillRect(0, y, w, rh);
    } else if (i % 2 === 0) {
      ctx.fillStyle = themeVar('--tl-stripe-alt', 'rgba(255,255,255,0.014)');
      ctx.fillRect(0, y, w, rh);
    }
    if (row.kind === 'audio') drawAudioRow(ctx, y, rh, w);
  }

  // grid lines
  const step = niceStep(tl.pxPerFrame);
  ctx.strokeStyle = themeVar('--tl-grid', 'rgba(255,255,255,0.05)');
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
    if (row.kind === 'events') {
      drawMarkerLane(ctx, row, y, rh, w);
    } else if (row.kind === 'item') {
      // aggregated dope-sheet markers
      const times = new Set();
      const tracks = S.getTracks(row.itemId);
      for (const tn of Object.keys(tracks)) for (const k of tracks[tn].keys) times.add(k.t);
      ctx.fillStyle = cKey;
      ctx.globalAlpha = 0.55;
      for (const t of times) {
        const x = frameToX(t);
        if (x < -6 || x > w + 6) continue;
        drawDiamond(ctx, x, cy, 3.4);
      }
      ctx.globalAlpha = 1;
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
        // Moon's "Easing Colors" option: tint each keyframe by its ease style so a dope sheet
        // reads at a glance. Selection still wins — it has to stay unambiguous.
        ctx.fillStyle = isSel ? cKeySel
          : (S.state.easeColors && !k.bez) ? easeColor(k.es || 'Linear')
          : cKey;
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
          ctx.fillStyle = cAccent;
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
    ctx.fillStyle = themeVar('--accent-glow', 'rgba(124,140,255,0.35)');
    ctx.strokeStyle = cAccent;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.globalAlpha = 1;
    ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
  }

  // ruler
  ctx.fillStyle = themeVar('--tl-ruler-bg', '#14141b');
  ctx.fillRect(0, 0, w, RULER_H);
  ctx.strokeStyle = themeVar('--border', 'rgba(255,255,255,0.08)');
  ctx.beginPath(); ctx.moveTo(0, RULER_H + 0.5); ctx.lineTo(w, RULER_H + 0.5); ctx.stroke();
  ctx.fillStyle = themeVar('--tl-ruler-text', 'rgba(255,255,255,0.45)');
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

  // play range (Moon's PlayArea) — dim everything outside it and draw grab handles in the ruler
  const pr = S.playRange();
  if (!pr.full) {
    const rx0 = frameToX(pr.start), rx1 = frameToX(pr.end);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    if (rx0 > 0) ctx.fillRect(0, RULER_H, rx0, h - RULER_H);
    if (rx1 < w) ctx.fillRect(rx1, RULER_H, w - rx1, h - RULER_H);
  }
  {
    const rx0 = frameToX(pr.start), rx1 = frameToX(pr.end);
    const barY = RULER_H - PLAYRANGE_BAR_H;
    ctx.fillStyle = pr.full ? 'rgba(124,140,255,0.20)' : 'rgba(124,140,255,0.55)';
    ctx.fillRect(rx0, barY, Math.max(2, rx1 - rx0), PLAYRANGE_BAR_H);
    ctx.fillStyle = pr.full ? 'rgba(124,140,255,0.45)' : 'rgba(160,175,255,0.95)';
    ctx.fillRect(rx0 - 1, barY, 3, PLAYRANGE_BAR_H);
    ctx.fillRect(rx1 - 2, barY, 3, PLAYRANGE_BAR_H);
  }

  // playhead
  const px = frameToX(S.state.playhead);
  ctx.fillStyle = cAccent;
  ctx.fillRect(px - 0.5, RULER_H - 6, 1.5, h);
  ctx.beginPath();
  ctx.moveTo(px - 6, 14); ctx.lineTo(px + 6, 14); ctx.lineTo(px, 26); ctx.closePath();
  ctx.fill();
  ctx.font = 'bold 10px Inter, system-ui, sans-serif';
  const label = String(Math.round(S.state.playhead * 10) / 10);
  const lw = ctx.measureText(label).width + 10;
  ctx.fillStyle = cAccent;
  roundRect(ctx, px - lw / 2, 0, lw, 13, 4);
  ctx.fill();
  ctx.fillStyle = themeVar('--tl-label-text', '#101016');
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

// Moon's markers render as a labelled bar spanning [t, t+width] with end caps, not a point —
// a zero-width marker still gets a minimum visual width so it stays clickable.
const MARKER_MIN_PX = 10;
function markerRect(m) {
  const x0 = frameToX(m.t);
  const x1 = frameToX(m.t + (m.width || 0));
  return { x0, x1: Math.max(x1, x0 + MARKER_MIN_PX) };
}
function drawMarkerLane(ctx, row, y, rh, w) {
  const list = S.getMarkers(row.itemId);
  if (!list.length) return;
  const selSet = new Set((S.state.selection.markers || []).map((m) => `${m.itemId}|${m.t}`));
  const barH = Math.min(rh - 8, 13);
  const by = y + (rh - barH) / 2;
  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const m of list) {
    const { x0, x1 } = markerRect(m);
    if (x1 < -4 || x0 > w + 4) continue;
    const isSel = selSet.has(`${row.itemId}|${m.t}`);
    const dragging = tl.drag?.kind === 'marker-move' && isSel;
    const dx = dragging ? tl.drag.dt * tl.pxPerFrame : 0;
    ctx.globalAlpha = dragging ? 0.9 : 1;
    ctx.fillStyle = isSel ? 'rgba(240,185,92,0.55)' : 'rgba(114,200,180,0.30)';
    roundRect(ctx, x0 + dx, by, x1 - x0, barH, 3);
    ctx.fill();
    ctx.strokeStyle = isSel ? 'rgba(240,185,92,0.95)' : 'rgba(114,200,180,0.75)';
    ctx.lineWidth = 1;
    roundRect(ctx, x0 + dx + 0.5, by + 0.5, x1 - x0 - 1, barH - 1, 3);
    ctx.stroke();
    if (m.name) {
      // clip the label to the bar so a long name can't bleed across the whole lane
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 + dx + 3, by, Math.max(0, x1 - x0 - 6), barH);
      ctx.clip();
      ctx.fillStyle = themeVar('--tl-ruler-text', 'rgba(255,255,255,0.8)');
      ctx.textAlign = 'left';
      ctx.fillText(m.name, x0 + dx + 4, by + barH / 2);
      ctx.restore();
    }
    // a marker carrying exported KeyframeMarkers or Luau gets a dot so it reads as "has data"
    if ((m.kf && Object.keys(m.kf).length) || m.codeBegin || m.codeEnd) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(x1 + dx - 4, by + 2, 2, 2);
    }
    ctx.globalAlpha = 1;
  }
  ctx.textBaseline = 'alphabetic';
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
// Marker hit test on an Events lane. `onEndCap` means the cursor is within the right-edge
// grab zone, which starts a resize rather than a move.
const MARKER_CAP_PX = 5;
function markerAt(x, itemId) {
  for (const m of S.getMarkers(itemId)) {
    const { x0, x1 } = markerRect(m);
    if (x >= x0 - 2 && x <= x1 + 2) return { m, onEndCap: x >= x1 - MARKER_CAP_PX };
  }
  return null;
}

function keyAt(x, y) {
  const i = rowAtY(y);
  if (i < 0) return null;
  const row = tl.rows[i];
  if (!row || row.kind === 'audio' || row.kind === 'events') return null;
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
    const rIdx = rowAtY(y);
    const r = rIdx >= 0 ? tl.rows[rIdx] : null;
    if (r && r.kind === 'events') {
      const mk = markerAt(x, r.itemId);
      if (mk) {
        S.setSelectedMarkers([{ itemId: r.itemId, t: mk.m.t }]);
        openMarkerContextMenu(e.clientX, e.clientY, r.itemId, mk.m.t);
      } else {
        const f = Math.round(xToFrame(x));
        showContextMenu(e.clientX, e.clientY, [
          { label: `Frame ${f}`, header: true },
          { label: 'Add event marker', run: () => { const m = S.addMarker(r.itemId, f); if (m) openMarkerEditor(r.itemId, m.t); } },
        ]);
      }
      return;
    }
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

  // play-range strip along the bottom of the ruler → drag its ends, or the whole window
  if (y >= RULER_H - PLAYRANGE_BAR_H && y < RULER_H) {
    const pr = S.playRange();
    const rx0 = frameToX(pr.start), rx1 = frameToX(pr.end);
    let handle = 'middle';
    if (Math.abs(x - rx0) <= PLAYRANGE_GRAB_PX) handle = 'start';
    else if (Math.abs(x - rx1) <= PLAYRANGE_GRAB_PX) handle = 'end';
    else if (x < rx0 || x > rx1) handle = 'start'; // clicking outside starts a fresh range here
    S.pushUndo(); // once, at gesture start — the drag then mutates with noUndo
    if (handle === 'start' && (x < rx0 - PLAYRANGE_GRAB_PX || x > rx1 + PLAYRANGE_GRAB_PX)) {
      const f = Math.round(xToFrame(x));
      S.setPlayRange(f, f, { noUndo: true });
      tl.drag = { kind: 'playrange', handle: 'end', anchor: f };
    } else {
      tl.drag = { kind: 'playrange', handle, startX: x, start0: pr.start, end0: pr.end };
    }
    tl.needsDraw = true;
    return;
  }

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

  // Events lane → select / move / resize a marker, or drop a new one on empty space
  if (row && row.kind === 'events') {
    const mk = markerAt(x, row.itemId);
    if (mk) {
      const already = (S.state.selection.markers || []).some((s) => s.itemId === row.itemId && Math.abs(s.t - mk.m.t) < 1e-6);
      if (!already) S.setSelectedMarkers([{ itemId: row.itemId, t: mk.m.t }]);
      // grabbing within a few px of the right cap resizes instead of moving, like Moon's
      // end-handle — resize is per-marker, so it never applies to a multi-selection.
      if (mk.onEndCap) {
        S.pushUndo(); // once, at gesture start — the resize itself then mutates with noUndo
        tl.drag = { kind: 'marker-resize', itemId: row.itemId, t: mk.m.t, startX: x, startWidth: mk.m.width || 0 };
      } else {
        tl.drag = { kind: 'marker-move', startX: x, dt: 0 };
      }
    } else {
      S.setSelectedMarkers([]);
    }
    tl.needsDraw = true;
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
  } else if (d.kind === 'playrange') {
    const f = Math.round(xToFrame(x));
    if (d.handle === 'start') S.setPlayRange(f, null, { noUndo: true });
    else if (d.handle === 'end') {
      // a fresh range drags out from its anchor, so pulling left of it still reads correctly
      if (d.anchor != null) S.setPlayRange(Math.min(d.anchor, f), Math.max(d.anchor, f), { noUndo: true });
      else S.setPlayRange(null, f, { noUndo: true });
    } else {
      // middle: slide the whole window, keeping its length
      let dt = Math.round((x - d.startX) / tl.pxPerFrame);
      const len = d.end0 - d.start0;
      const maxStart = Math.max(0, S.state.project.length - len);
      const s = Math.max(0, Math.min(d.start0 + dt, maxStart));
      S.setPlayRange(s, s + len, { noUndo: true });
    }
    tl.needsDraw = true;
  } else if (d.kind === 'marker-move') {
    let dt = (x - d.startX) / tl.pxPerFrame;
    if (S.state.snapping && !e.altKey) dt = Math.round(dt);
    d.dt = dt;
    tl.needsDraw = true;
  } else if (d.kind === 'marker-resize') {
    let dw = (x - d.startX) / tl.pxPerFrame;
    if (S.state.snapping && !e.altKey) dw = Math.round(dw);
    // live-applied so the bar tracks the cursor; setMarker clamps against the next marker
    S.setMarker(d.itemId, d.t, { width: Math.max(0, d.startWidth + dw) }, { noUndo: true });
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
  } else if (d.kind === 'marker-move' && d.dt !== 0) {
    S.moveMarkers(S.state.selection.markers, d.dt);
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
  // Events lane: double-click adds a marker on empty space, or opens the editor on an existing one
  if (row.kind === 'events') {
    let f = Math.round(xToFrame(x));
    const mk = markerAt(x, row.itemId);
    if (mk) { openMarkerEditor(row.itemId, mk.m.t); return; }
    const m = S.addMarker(row.itemId, f);
    if (m) { S.setSelectedMarkers([{ itemId: row.itemId, t: m.t }]); openMarkerEditor(row.itemId, m.t); }
    return;
  }
  if (row.kind !== 'track') return;
  let f = xToFrame(x);
  if (S.state.snapping) f = Math.round(f);
  // key the current evaluated value at that frame (so the pose holds)
  if (row.track === '@fov') {
    const item = S.getItem(row.itemId);
    S.setKey(row.itemId, row.track, f, S.evalTrackNum(row.itemId, '@fov', f, item.fov || 70));
  } else if (row.track === '@rate' || row.track === '@lifetime' || row.track === '@speed') {
    const item = S.getItem(row.itemId);
    const key = row.track.slice(1);
    S.setKey(row.itemId, row.track, f, S.evalTrackNum(row.itemId, row.track, f, item.emitter?.[key] ?? 1));
  } else if (row.track === '@origin') {
    const item = S.getItem(row.itemId);
    S.setKey(row.itemId, row.track, f, S.evalTrackCF(row.itemId, '@origin', f, item.origin || [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]));
  } else if (S.getItem(row.itemId)?.kind === 'prop') {
    // A property/action track holds a typed value, so key whatever it currently evaluates to
    // rather than assuming a CFrame.
    S.setKey(row.itemId, row.track, f, S.evalTrackValue(row.itemId, row.track, f));
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

// ---------------------------------------------------------------- markers
function openMarkerContextMenu(cx, cy, itemId, t) {
  const m = S.getMarker(itemId, t);
  if (!m) return;
  showContextMenu(cx, cy, [
    { label: m.name || `Event @ ${m.t}`, header: true },
    { label: 'Edit event…', run: () => openMarkerEditor(itemId, t) },
    { label: 'Move to playhead', run: () => S.moveMarkers([{ itemId, t }], Math.round(S.state.playhead) - t) },
    { sep: true },
    { label: 'Delete', danger: true, run: () => S.deleteMarkers([{ itemId, t }]) },
  ]);
}

// Port of Moon's EditMarkers window. `kf` is its KFMarkers key/value list — those become real
// Roblox KeyframeMarker instances on export. codeBegin/codeEnd are stored and exported but not
// executed here (see the note on state.js's marker section for why).
export function openMarkerEditor(itemId, t) {
  const m = S.getMarker(itemId, t);
  if (!m) return;
  const wrap = document.createElement('div');
  wrap.className = 'marker-editor';

  const mk = (label, el) => {
    const l = document.createElement('label');
    l.className = 'fld-label';
    l.textContent = label;
    wrap.append(l, el);
    return el;
  };
  const nameInp = mk('Name', Object.assign(document.createElement('input'), { className: 'fld', type: 'text', value: m.name || '' }));
  const widthInp = mk('Length (frames)', Object.assign(document.createElement('input'), { className: 'fld', type: 'number', min: '0', step: '1', value: String(m.width || 0) }));
  const beginInp = mk('Run at start (Luau)', Object.assign(document.createElement('textarea'), { className: 'fld mono', rows: 3, value: m.codeBegin || '' }));
  const endInp = mk('Run at end (Luau)', Object.assign(document.createElement('textarea'), { className: 'fld mono', rows: 3, value: m.codeEnd || '' }));

  const note = document.createElement('p');
  note.className = 'fld-note';
  note.textContent = 'Luau runs in Roblox Studio after export — Cadence stores it but does not execute it.';
  wrap.appendChild(note);

  // KeyframeMarker key/value rows
  const kfLabel = document.createElement('label');
  kfLabel.className = 'fld-label';
  kfLabel.textContent = 'Keyframe markers (exported to Roblox)';
  wrap.appendChild(kfLabel);
  const kfWrap = document.createElement('div');
  kfWrap.className = 'kv-list';
  wrap.appendChild(kfWrap);
  let kfRows = Object.entries(m.kf || {}).map(([k, v]) => ({ k, v }));
  function renderKf() {
    kfWrap.replaceChildren();
    kfRows.forEach((row, i) => {
      const line = document.createElement('div');
      line.className = 'kv-row';
      const kIn = Object.assign(document.createElement('input'), { className: 'fld slim', type: 'text', placeholder: 'name', value: row.k });
      const vIn = Object.assign(document.createElement('input'), { className: 'fld slim', type: 'text', placeholder: 'value', value: row.v });
      kIn.addEventListener('input', () => { row.k = kIn.value; });
      vIn.addEventListener('input', () => { row.v = vIn.value; });
      const del = Object.assign(document.createElement('button'), { className: 'btn slim', textContent: '✕' });
      del.addEventListener('click', () => { kfRows.splice(i, 1); renderKf(); });
      line.append(kIn, vIn, del);
      kfWrap.appendChild(line);
    });
    const add = Object.assign(document.createElement('button'), { className: 'btn slim', textContent: '+ Add marker' });
    add.addEventListener('click', () => { kfRows.push({ k: '', v: '' }); renderKf(); });
    kfWrap.appendChild(add);
  }
  renderKf();

  modal({
    title: `Event @ frame ${m.t}`,
    body: wrap,
    actions: [
      { label: 'Delete', run: () => { S.deleteMarkers([{ itemId, t }]); } },
      { label: 'Cancel' },
      {
        label: 'Save', primary: true, run: () => {
          const kf = {};
          for (const r of kfRows) if (r.k.trim()) kf[r.k.trim()] = r.v;
          S.setMarker(itemId, t, {
            name: nameInp.value,
            width: Math.max(0, Math.round(parseFloat(widthInp.value) || 0)),
            codeBegin: beginInp.value,
            codeEnd: endInp.value,
            kf,
          });
        },
      },
    ],
  });
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
    S.setKey(en.itemId, en.track, t0 + en.dt, structuredClone(en.key.v), { noUndo: true, noAutoZero: true, es: en.key.es, ed: en.key.ed, bez: en.key.bez });
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
    S.setKey(targetItemId, en.track, t0 + en.dt, structuredClone(en.key.v), { noUndo: true, noAutoZero: true, es: en.key.es, ed: en.key.ed, bez: en.key.bez });
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
