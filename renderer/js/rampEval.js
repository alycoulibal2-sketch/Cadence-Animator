// Life-fraction-keyed twin of effectModel.js's evalCurve, for the colorRamp/densityRamp emitter
// props. Kept as its own leaf module (deps: easing.js only) rather than living in
// effectModel.js or vfx.js: effectModel.js already imports VFX_DEFAULTS from vfx.js, so either of
// those two importing this module back would create a cycle. lerpHex is duplicated (not imported
// from effectModel.js) for the same reason — it's ~8 lines, cheap to keep leaf-only.
import { evalSegment } from './easing.js';

const hexRe = /^#([0-9a-f]{6})$/i;
function lerpHex(a, b, t) {
  const ma = hexRe.exec(a), mb = hexRe.exec(b);
  if (!ma || !mb) return t < 1 ? a : b;
  const va = parseInt(ma[1], 16), vb = parseInt(mb[1], 16);
  const ch = (v, s) => (v >> s) & 255;
  const mix = (s) => Math.round(ch(va, s) + (ch(vb, s) - ch(va, s)) * t);
  return `#${((mix(16) << 16) | (mix(8) << 8) | mix(0)).toString(16).padStart(6, '0')}`;
}

// Stops: [{u:0..1, v: number|'#rrggbb', es?, ed?, bez?}], sorted by u. Same hold-flat-outside /
// left-key-easing-shapes-the-segment convention as evalCurve, just keyed by a continuous 0..1
// life-fraction `u` instead of a clip-local frame `t` — each particle ages independently of the
// clip's own frame count, so there is no frame to key against here.
export function evalRamp(stops, u, fallback) {
  if (!Array.isArray(stops) || stops.length < 2) return fallback;
  if (u <= stops[0].u) return stops[0].v;
  const last = stops[stops.length - 1];
  if (u >= last.u) return last.v;
  let i = 0;
  while (i < stops.length - 1 && stops[i + 1].u <= u) i++;
  const a = stops[i], b = stops[i + 1];
  const span = b.u - a.u;
  const progress = span > 0 ? (u - a.u) / span : 1;
  const e = evalSegment(a, progress);
  if (typeof a.v === 'number' && typeof b.v === 'number') return a.v + (b.v - a.v) * e;
  if (typeof a.v === 'string' && typeof b.v === 'string') return lerpHex(a.v, b.v, e);
  return e < 1 ? a.v : b.v;
}

// Sorts by u, dedupes exact-u collisions (last write wins), clamps u to [0,1] and endpoints to
// u=0/u=1 (exporter code assumes the first/last stop cover the whole range), type-checks v against
// `kind` ('color' -> '#rrggbb' string, 'number' -> finite number). Drops invalid stops rather than
// throwing — malformed ramp data should degrade to "no ramp", never break the whole doc parse.
export function sanitizeRamp(stops, kind) {
  if (!Array.isArray(stops)) return [];
  const isValidV = kind === 'color' ? (v) => typeof v === 'string' && hexRe.test(v) : (v) => Number.isFinite(v);
  const seen = new Map();
  for (const s of stops) {
    if (!s || !Number.isFinite(s.u) || !isValidV(s.v)) continue;
    const u = Math.max(0, Math.min(1, s.u));
    const clean = { u, v: s.v };
    if (s.es) clean.es = s.es;
    if (s.ed) clean.ed = s.ed;
    if (Array.isArray(s.bez) && s.bez.length === 4) clean.bez = s.bez;
    seen.set(u, clean);
  }
  const sorted = [...seen.values()].sort((a, b) => a.u - b.u);
  if (sorted.length) {
    sorted[0].u = 0;
    sorted[sorted.length - 1].u = 1;
  }
  return sorted;
}
