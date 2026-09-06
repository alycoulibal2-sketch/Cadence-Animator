// The one control factory for PNX socket values — shared by the node editor and the Effect Sheet.
//
// THE RULE (Part 79 on the UI side): a control is GENERATED from a socket's registry metadata — a
// dropdown for an enumeration, a slider only where the metadata gives a real bounded range, a colour
// swatch, a curve or gradient dialog — so 366 node types never become 366 hand-written panels, and a
// value edited on the sheet and a value edited on the canvas go through the same code and therefore
// the same write path (`commit(value)`, which the caller routes through ST.mutatePnx).
//
// This module owns no state and knows nothing about which surface asked. `commit` is the only exit.

import * as T from '../../renderer/js/pnx/types.js';
import { modal } from '../../renderer/js/ui.js';
import { pickColor } from '../../renderer/js/colorPicker.js';

export function el(tag, className, text) {
  const d = document.createElement(tag);
  if (className) d.className = className;
  if (text !== undefined) d.textContent = text;
  return d;
}

export function gradientCss(g) {
  const stops = Array.isArray(g?.stops) ? g.stops : [];
  if (!stops.length) return 'linear-gradient(90deg,#000,#fff)';
  const sorted = [...stops].sort((a, b) => a.u - b.u);
  return `linear-gradient(90deg, ${sorted.map((s) => `${s.v || '#fff'} ${Math.round((s.u || 0) * 100)}%`).join(', ')})`;
}

export const rgbCss = (c) => `rgb(${Math.round(Math.min(1, Math.max(0, c[0] ?? 1)) * 255)},${Math.round(Math.min(1, Math.max(0, c[1] ?? 1)) * 255)},${Math.round(Math.min(1, Math.max(0, c[2] ?? 1)) * 255)})`;

// Build a control for `socket` showing `cur`, calling `commit(next)` on every committed change.
// `opts.live(next)` (optional) is called during a slider drag so a preview can follow the pointer
// without committing an undo step per pixel; `opts.compact` renders the shortest form for a sheet row.
export function buildControl(socket, cur, commit, opts = {}) {
  const type = socket.type;
  const inner = T.isFieldType(type) ? type.param : type;   // a field input still accepts a constant
  const name = inner?.name;
  const stop = (e) => e.stopPropagation();   // a control must never start a drag of its container

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
      const wrap = el('div', 'pnx-num' + (opts.compact ? ' compact' : ''));
      const i = el('input', 'fld pnx-ctrl');
      i.type = 'number';
      i.step = name === 'int' ? 1 : 0.01;
      if (socket.min !== undefined) i.min = socket.min;
      if (socket.max !== undefined) i.max = socket.max;
      i.value = Number(cur) || 0;
      i.addEventListener('pointerdown', stop);
      i.addEventListener('change', () => commit(name === 'int' ? Math.round(+i.value || 0) : (+i.value || 0)));
      // Scrub: drag left/right on the box to change the value, the way a Blender or Studio number
      // field behaves. Committed once on release.
      wireScrub(i, name === 'int' ? 1 : (socket.max !== undefined && socket.min !== undefined ? (socket.max - socket.min) / 200 : 0.05), (v) => {
        i.value = name === 'int' ? Math.round(v) : Math.round(v * 1000) / 1000;
        if (opts.live) opts.live(+i.value);
      }, () => commit(name === 'int' ? Math.round(+i.value || 0) : (+i.value || 0)), socket);
      wrap.appendChild(i);
      // A slider only where the metadata gives a real bounded range — inventing one for an unbounded
      // value would imply a limit the engine does not have.
      if (!opts.compact && socket.min !== undefined && socket.max !== undefined && socket.max > socket.min) {
        const s = el('input', 'pnx-slider');
        s.type = 'range';
        s.min = socket.min; s.max = socket.max;
        s.step = (socket.max - socket.min) / 200;
        s.value = Number(cur) || 0;
        s.addEventListener('pointerdown', stop);
        s.addEventListener('input', () => { i.value = s.value; if (opts.live) opts.live(+s.value); });
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
        i.type = 'number'; i.step = 0.1; i.value = v[k] ?? 0; i.title = axes[k]; i.placeholder = axes[k];
        i.addEventListener('pointerdown', stop);
        const read = () => { const out = [...v]; for (let j = 0; j < n; j++) out[j] = +wrap.children[j].value || 0; return out; };
        i.addEventListener('change', () => commit(read()));
        wireScrub(i, 0.05, (val) => { i.value = Math.round(val * 1000) / 1000; if (opts.live) opts.live(read()); }, () => commit(read()), {});
        wrap.appendChild(i);
      }
      return wrap;
    }
    case 'color': {
      const sw = el('button', 'pnx-swatch');
      sw.type = 'button';
      const rgba = Array.isArray(cur) ? cur : [1, 1, 1, 1];
      sw.style.background = rgbCss(rgba);
      sw.title = 'Click to choose a colour';
      sw.addEventListener('pointerdown', stop);
      sw.addEventListener('click', () => {
        pickColor({
          title: socket.label,
          initial: [rgba[0], rgba[1], rgba[2]],
          onLive: (c) => { sw.style.background = rgbCss(c); if (opts.live) opts.live([c[0], c[1], c[2], rgba[3] ?? 1]); },
        }).then((c) => { if (c) commit([c[0], c[1], c[2], rgba[3] ?? 1]); });
      });
      return sw;
    }
    case 'curve': {
      const b = el('button', 'pnx-mini pnx-curve-btn', '');
      b.type = 'button';
      b.appendChild(curveSparkline(cur));
      b.appendChild(el('span', '', 'Edit curve'));
      b.title = 'Edit the curve';
      b.addEventListener('pointerdown', stop);
      b.addEventListener('click', () => openCurveDialog(socket, cur, commit));
      return b;
    }
    case 'gradient': {
      const b = el('button', 'pnx-mini pnx-gradient-btn', '');
      b.type = 'button';
      b.style.background = gradientCss(cur);
      b.title = 'Edit the gradient';
      b.addEventListener('pointerdown', stop);
      b.addEventListener('click', () => openGradientDialog(socket, cur, commit));
      return b;
    }
    default:
      // geometry, material, texture2d, renderCommand, emitter, collider, instanceSet, volumeGrid,
      // transform, matrix4, event — values that only ever arrive down a wire. Say so rather than
      // showing a box that cannot represent them.
      return null;
  }
}

// Drag-to-scrub on a number input: horizontal pointer movement changes the value by `step` per
// pixel (Shift ×10, Alt ÷10). A plain click still focuses the box for typing, because scrubbing
// only starts after the pointer has moved a few pixels.
function wireScrub(input, step, onLive, onCommit, socket) {
  let start = null;
  input.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    start = { x: e.clientX, v: +input.value || 0, moved: false, id: e.pointerId };
  });
  input.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    if (!start.moved && Math.abs(dx) < 4) return;
    if (!start.moved) { start.moved = true; input.setPointerCapture(e.pointerId); input.blur(); }
    const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    let v = start.v + dx * step * k;
    if (socket.min !== undefined) v = Math.max(socket.min, v);
    if (socket.max !== undefined) v = Math.min(socket.max, v);
    onLive(v);
  });
  const end = (e) => {
    if (!start) return;
    const moved = start.moved;
    start = null;
    if (moved) { try { input.releasePointerCapture(e.pointerId); } catch (_) { /* not captured */ } onCommit(); }
  };
  input.addEventListener('pointerup', end);
  input.addEventListener('pointercancel', end);
}

export function curveSparkline(cur, w = 44, h = 16) {
  const cv = el('canvas', 'pnx-sparkline');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  const keys = (Array.isArray(cur?.keys) ? [...cur.keys] : [{ t: 0, v: 0 }, { t: 1, v: 1 }]).sort((a, b) => a.t - b.t);
  const vs = keys.map((k) => k.v);
  const lo = Math.min(0, ...vs), hi0 = Math.max(1, ...vs), hi = hi0 === lo ? lo + 1 : hi0;
  c.strokeStyle = '#7c8cff'; c.lineWidth = 1.5;
  c.beginPath();
  keys.forEach((k, i) => {
    const x = 2 + k.t * (w - 4), y = h - 2 - ((k.v - lo) / (hi - lo)) * (h - 4);
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  });
  c.stroke();
  return cv;
}

// ---------------------------------------------------------------- dialogs
export function openCurveDialog(socket, cur, commit, { title = null } = {}) {
  const keys = (Array.isArray(cur?.keys) ? cur.keys : [{ t: 0, v: 0 }, { t: 1, v: 1 }]).map((k) => ({ ...k }));
  const wrap = el('div', 'pnx-curve-dialog');
  const cv = el('canvas', 'pnx-curve-canvas');
  cv.width = 420; cv.height = 220;
  wrap.appendChild(cv);
  const hint = el('p', 'muted', 'Click to add a point, drag to move one, right-click a point to remove it. Left is the start, right is the end.');
  hint.style.cssText = 'font-size:11px;margin-top:8px;opacity:.7';
  wrap.appendChild(hint);
  const presets = el('div', 'pnx-curve-presets');
  const preset = (label, ks) => { const b = el('button', 'tb-btn', label); b.type = 'button'; b.addEventListener('click', () => { keys.length = 0; keys.push(...ks.map((k) => ({ ...k }))); draw(); }); presets.appendChild(b); };
  preset('Fade out', [{ t: 0, v: 1 }, { t: 1, v: 0 }]);
  preset('Fade in', [{ t: 0, v: 0 }, { t: 1, v: 1 }]);
  preset('Pop', [{ t: 0, v: 0 }, { t: 0.15, v: 1 }, { t: 1, v: 0 }]);
  preset('Grow', [{ t: 0, v: 0.2 }, { t: 1, v: 1 }]);
  preset('Flat', [{ t: 0, v: 1 }, { t: 1, v: 1 }]);
  wrap.appendChild(presets);

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
    title: title || `Curve — ${socket.label}`,
    body: wrap,
    actions: [
      { label: 'Apply', icon: 'save', run: () => commit({ kind: 'float', keys: keys.map((k) => ({ t: k.t, v: k.v })) }) },
      { label: 'Cancel', run: () => {} },
    ],
  });
}

export function openGradientDialog(socket, cur, commit, { title = null } = {}) {
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
      del.type = 'button';
      del.title = 'Remove this stop';
      del.addEventListener('click', () => { if (stops.length > 2) { stops.splice(i, 1); redraw(); } });
      row.append(pos, col, del);
      list.appendChild(row);
    });
  };
  const presets = el('div', 'pnx-curve-presets');
  const preset = (label, ss) => { const b = el('button', 'tb-btn', label); b.type = 'button'; b.style.background = gradientCss({ stops: ss }); b.style.color = '#fff'; b.style.textShadow = '0 1px 2px #000'; b.addEventListener('click', () => { stops.length = 0; stops.push(...ss.map((s) => ({ ...s }))); redraw(); }); presets.appendChild(b); };
  preset('Ember', [{ u: 0, v: '#fff6e0' }, { u: 0.25, v: '#ffb040' }, { u: 0.7, v: '#c02808' }, { u: 1, v: '#200400' }]);
  preset('Ice', [{ u: 0, v: '#ffffff' }, { u: 0.4, v: '#7cc4ff' }, { u: 1, v: '#0a1040' }]);
  preset('Magic', [{ u: 0, v: '#ffffff' }, { u: 0.4, v: '#c07cff' }, { u: 1, v: '#200840' }]);
  preset('Toxic', [{ u: 0, v: '#f6ffd8' }, { u: 0.5, v: '#5ad63c' }, { u: 1, v: '#022010' }]);
  preset('Smoke', [{ u: 0, v: '#ffffff' }, { u: 0.5, v: '#909098' }, { u: 1, v: '#101014' }]);
  const add = el('button', 'tb-btn', '＋ Add stop');
  add.type = 'button';
  add.addEventListener('click', () => { stops.push({ u: 0.5, v: '#ffffff' }); redraw(); });
  wrap.append(bar, presets, list, add);
  redraw();

  modal({
    title: title || `Gradient — ${socket.label}`,
    body: wrap,
    actions: [
      { label: 'Apply', icon: 'save', run: () => commit({ kind: 'color', stops: stops.map((s) => ({ u: s.u, v: s.v })) }) },
      { label: 'Cancel', run: () => {} },
    ],
  });
}
