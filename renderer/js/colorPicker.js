// Colour picker — a port of Moon Animator 2's Windows/ColorPicker.module.lua.
// Moon exposes the same three linked representations (H/S/V, R/G/B, hex) over a saturation-value
// square with a hue slider; editing any of them updates the others live. Needed here because
// Color3 property tracks (Lighting.Ambient, a Fire's Color, a GUI's BackgroundColor3…) are
// miserable to author as three raw 0..1 numbers.
//
// The conversions themselves live in color.js, a pure leaf module with no imports, so they can
// be unit-tested with plain node -- importing ui.js touches `window` at load time.

import { modal } from './ui.js';
import { rgbToHsv, hsvToRgb, rgbToHex, hexToRgb, cssRgb } from './color.js';

/**
 * Open the picker. Resolves to the chosen [r, g, b] (0..1 floats), or null if cancelled.
 * `onLive` is called with the working colour as it changes, for previewing before commit.
 */
export function pickColor({ title = 'Colour', initial = [1, 0, 0], onLive } = {}) {
  return new Promise((resolve) => {
    let [r, g, b] = initial.map((n) => Math.max(0, Math.min(1, Number(n) || 0)));
    let [h, s, v] = rgbToHsv(r, g, b);
    let settled = false;

    const wrap = document.createElement('div');
    wrap.className = 'color-picker';

    // saturation/value square + hue slider
    const svBox = document.createElement('div');
    svBox.className = 'cp-sv';
    const svCursor = document.createElement('div');
    svCursor.className = 'cp-cursor';
    svBox.appendChild(svCursor);

    const hueBox = document.createElement('div');
    hueBox.className = 'cp-hue';
    const hueCursor = document.createElement('div');
    hueCursor.className = 'cp-hue-cursor';
    hueBox.appendChild(hueCursor);

    const row = document.createElement('div');
    row.className = 'cp-row';
    row.append(svBox, hueBox);
    wrap.appendChild(row);

    const swatch = document.createElement('div');
    swatch.className = 'cp-swatch';
    wrap.appendChild(swatch);

    const num = (label, max) => {
      const l = document.createElement('label');
      l.className = 'cp-field';
      const sp = document.createElement('span');
      sp.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 'fld slim';
      inp.min = '0';
      inp.max = String(max);
      inp.step = '1';
      l.append(sp, inp);
      return { l, inp };
    };
    const H = num('H', 359), Sx = num('S', 255), V = num('V', 255);
    const R = num('R', 255), G = num('G', 255), B = num('B', 255);
    const hsvRow = document.createElement('div');
    hsvRow.className = 'cp-fields';
    hsvRow.append(H.l, Sx.l, V.l);
    const rgbRow = document.createElement('div');
    rgbRow.className = 'cp-fields';
    rgbRow.append(R.l, G.l, B.l);
    wrap.append(hsvRow, rgbRow);

    const hexL = document.createElement('label');
    hexL.className = 'cp-field wide';
    const hexSpan = document.createElement('span');
    hexSpan.textContent = 'Hex';
    const hexInp = document.createElement('input');
    hexInp.type = 'text';
    hexInp.className = 'fld slim';
    hexInp.maxLength = 7;
    hexL.append(hexSpan, hexInp);
    wrap.appendChild(hexL);

    // `origin` names which control the user just touched, so we never fight their own typing
    // by rewriting the field they are mid-edit in.
    function sync(origin) {
      if (origin !== 'hsv') [h, s, v] = rgbToHsv(r, g, b);
      if (origin === 'hsv') [r, g, b] = hsvToRgb(h, s, v);
      swatch.style.background = cssRgb([r, g, b]);
      svBox.style.background =
        `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h}, 100%, 50%))`;
      svCursor.style.left = s * 100 + '%';
      svCursor.style.top = (1 - v) * 100 + '%';
      hueCursor.style.top = (h / 360) * 100 + '%';
      if (origin !== 'hsvFields') {
        H.inp.value = String(Math.round(h));
        Sx.inp.value = String(Math.round(s * 255));
        V.inp.value = String(Math.round(v * 255));
      }
      if (origin !== 'rgbFields') {
        R.inp.value = String(Math.round(r * 255));
        G.inp.value = String(Math.round(g * 255));
        B.inp.value = String(Math.round(b * 255));
      }
      if (origin !== 'hex') hexInp.value = '#' + rgbToHex(r, g, b);
      onLive?.([r, g, b]);
    }

    // dragging the SV square / hue strip
    const dragOn = (el, handler) => {
      const move = (e) => {
        const rect = el.getBoundingClientRect();
        handler(
          Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
          Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
        );
      };
      el.addEventListener('pointerdown', (e) => {
        el.setPointerCapture(e.pointerId);
        move(e);
        const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      });
    };
    dragOn(svBox, (x, y) => { s = x; v = 1 - y; sync('hsv'); });
    dragOn(hueBox, (_x, y) => { h = y * 360; sync('hsv'); });

    const numChange = (inp, set, origin) => inp.addEventListener('input', () => {
      const n = parseFloat(inp.value);
      if (!Number.isFinite(n)) return;
      set(n);
      sync(origin);
    });
    numChange(H.inp, (n) => { h = Math.max(0, Math.min(359, n)); }, 'hsvFields');
    numChange(Sx.inp, (n) => { s = Math.max(0, Math.min(255, n)) / 255; }, 'hsvFields');
    numChange(V.inp, (n) => { v = Math.max(0, Math.min(255, n)) / 255; }, 'hsvFields');
    // the HSV fields set h/s/v directly, so they need the 'hsv' recompute path too
    [H.inp, Sx.inp, V.inp].forEach((i) => i.addEventListener('input', () => { [r, g, b] = hsvToRgb(h, s, v); }));
    numChange(R.inp, (n) => { r = Math.max(0, Math.min(255, n)) / 255; }, 'rgbFields');
    numChange(G.inp, (n) => { g = Math.max(0, Math.min(255, n)) / 255; }, 'rgbFields');
    numChange(B.inp, (n) => { b = Math.max(0, Math.min(255, n)) / 255; }, 'rgbFields');
    hexInp.addEventListener('input', () => {
      const parsed = hexToRgb(hexInp.value);
      if (!parsed) return; // half-typed hex is not an error, just not applied yet
      [r, g, b] = parsed;
      sync('hex');
    });

    sync('init');

    modal({
      title,
      body: wrap,
      onClose: () => { if (!settled) { settled = true; onLive?.(initial); resolve(null); } },
      actions: [
        { label: 'Cancel' },
        { label: 'OK', primary: true, run: () => { settled = true; resolve([r, g, b]); } },
      ],
    });
  });
}
