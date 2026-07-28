// Colour space conversions — a pure leaf module with no imports, deliberately.
//
// These live apart from colorPicker.js (which owns the UI) for the same reason rampEval.js lives
// apart from the modules that use it: anything importing ui.js touches `window` at load time and
// so cannot be unit-tested with plain `node`. Keeping the maths dependency-free means it can be.
//
// Cadence stores Color3 track values as [r, g, b] floats in 0..1, matching Roblox's Color3.new,
// so nothing here ever holds 0-255 except at the display boundary.

export function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((n) => n + m);
}

export function rgbToHex(r, g, b) {
  const to = (n) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');
  return to(r) + to(g) + to(b);
}

// Returns null for anything that is not a full 6-digit hex — a half-typed value is not an
// error, it just is not applicable yet, and callers rely on that to avoid fighting typing.
export function hexToRgb(hex) {
  const s = String(hex).replace(/^#/, '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
}

// CSS `rgb(...)` string from a 0..1 triple, for swatches and canvas fills.
export function cssRgb(v) {
  return `rgb(${(v || [0, 0, 0]).map((n) => Math.round(Math.max(0, Math.min(1, n)) * 255)).join(',')})`;
}
