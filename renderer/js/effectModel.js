// The effect document: what VFX Studio edits, what presets generate, what the animator's
// 'effect' items hold, what gets exported to Roblox. Pure data + pure helpers — no state.js, no
// window.*, no three.js — so it loads identically in the main window, the studio window, and the
// smoketest. Undo/autosave live with whoever owns a document (studioState.js in the studio,
// state.js in the animator), NOT here: these helpers mutate the doc they're handed and return
// facts about what changed; snapshotting around them is the caller's job.
//
// Schema (docs/vfx-studio.md is the narrative version):
//   { version: 2, id, name, fps, duration, loop, layers: [Layer] }
//   Layer = { id, type, name, enabled, clip: {start, len, loop},   (solo is studio VIEW state, never serialized)
//             props: {...}, curves: { prop: [ {t, v, es, ed, bez} ] },
//             exprs: { prop: 'src' }, modifiers: [ {id, type, enabled, props} ] }
// Curve key times are frames RELATIVE TO CLIP START; easing vocabulary (es/ed/bez) is exactly
// the animator's (easing.js evalSegment is imported, not reimplemented).

import { evalSegment } from './easing.js';
import { evalExpr } from './expr.js';
import { VFX_DEFAULTS } from './vfx.js';
import { defaultShape } from './effectShapes.js';

export const EFFECT_VERSION = 2;

const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);

// ---------------------------------------------------------------- layer type registry
// propMeta drives the inspector (auto-generated editors), clamping, and which props can carry
// curves/expressions. kinds: number | range | color | select | check | shape | vec3 | text.
// `animatable: true` props get the per-prop keyframe ⏺ + curve affordances in the UI and are
// resolved through resolveProp() by the engine each frame.
export const LAYER_TYPES = {
  emitter: {
    label: 'Particles', icon: '✨',
    defaults: () => ({
      ...VFX_DEFAULTS,
      rate: 25, lifetime: 1.2, speed: 3,
      burst: 0,
      emissionShape: null, // null = emit from the layer origin point; else a shapes-system def
      offset: [0, 0, 0],
    }),
    props: [
      { key: 'rate', label: 'Rate (particles/sec)', kind: 'number', min: 0, max: 2000, step: 1, animatable: true },
      { key: 'burst', label: 'Burst (at clip start)', kind: 'number', min: 0, max: 500, step: 1 },
      { key: 'lifetime', label: 'Lifetime (sec)', kind: 'number', min: 0.05, max: 30, step: 0.1, animatable: true },
      { key: 'speed', label: 'Speed (studs/sec)', kind: 'number', min: -100, max: 100, step: 0.1, animatable: true },
      { key: 'spreadDegrees', label: 'Spread°', kind: 'number', min: 0, max: 90, step: 1, animatable: true },
      { key: 'gravity', label: 'Gravity', kind: 'number', min: -100, max: 100, step: 0.1, animatable: true },
      { key: 'shape', label: 'Sprite', kind: 'select', options: ['glow', 'spark', 'ring', 'star', 'smoke', 'square', 'leaf'] },
      { key: 'motion', label: 'Motion', kind: 'select', options: ['cone', 'burst', 'rise', 'fall', 'orbit', 'ambient'] },
      { key: 'blendMode', label: 'Blend', kind: 'select', options: ['normal', 'additive'] },
      { key: 'emissionShape', label: 'Emit from shape', kind: 'shape', optional: true },
      { key: 'colorStart', label: 'Color (start)', kind: 'color' },
      { key: 'colorEnd', label: 'Color (end)', kind: 'color' },
      { key: 'sizeStart', label: 'Size (start)', kind: 'number', min: 0.005, max: 50, step: 0.01, animatable: true },
      { key: 'sizeEnd', label: 'Size (end)', kind: 'number', min: 0.005, max: 50, step: 0.01, animatable: true },
      { key: 'transparencyStart', label: 'Transparency (start)', kind: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'transparencyEnd', label: 'Transparency (end)', kind: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'maxParticles', label: 'Max particles', kind: 'number', min: 1, max: 2000, step: 1 },
      { key: 'offset', label: 'Offset (studs)', kind: 'vec3' },
      { key: 'textureId', label: 'Roblox texture override', kind: 'text', placeholder: 'rbxassetid://… (export)' },
    ],
  },
  shape: {
    label: 'Shape', icon: '◠',
    defaults: () => ({
      shape: defaultShape('slash'),
      color: '#8fd0ff', opacity: 0.85, scale: 1, rotation: 0, thickness: 0.12,
      emissive: true, offset: [0, 0, 0],
    }),
    props: [
      { key: 'shape', label: 'Base shape', kind: 'shape' },
      { key: 'color', label: 'Color', kind: 'color' },
      { key: 'opacity', label: 'Opacity', kind: 'range', min: 0, max: 1, step: 0.01, animatable: true },
      { key: 'scale', label: 'Scale', kind: 'number', min: 0.01, max: 100, step: 0.05, animatable: true },
      { key: 'rotation', label: 'Rotation°', kind: 'number', min: -3600, max: 3600, step: 1, animatable: true },
      { key: 'thickness', label: 'Thickness', kind: 'number', min: 0.005, max: 10, step: 0.01, animatable: true },
      { key: 'emissive', label: 'Additive glow', kind: 'check' },
      { key: 'offset', label: 'Offset (studs)', kind: 'vec3' },
    ],
  },
  light: {
    label: 'Light', icon: '💡',
    defaults: () => ({ color: '#ffd9a0', intensity: 1.4, range: 12, offset: [0, 0.5, 0] }),
    props: [
      { key: 'color', label: 'Color', kind: 'color' },
      { key: 'intensity', label: 'Intensity', kind: 'number', min: 0, max: 20, step: 0.1, animatable: true },
      { key: 'range', label: 'Range (studs)', kind: 'number', min: 0.5, max: 60, step: 0.5, animatable: true },
      { key: 'offset', label: 'Offset (studs)', kind: 'vec3' },
    ],
  },
  screen: {
    label: 'Screen FX', icon: '🖵',
    defaults: () => ({ kind: 'flash', color: '#ffffff', opacity: 0.5, density: 24 }),
    props: [
      { key: 'kind', label: 'Effect', kind: 'select', options: ['flash', 'vignette', 'speedlines', 'overlay'] },
      { key: 'color', label: 'Color', kind: 'color' },
      { key: 'opacity', label: 'Opacity', kind: 'range', min: 0, max: 1, step: 0.01, animatable: true },
      { key: 'density', label: 'Density (speedlines)', kind: 'number', min: 4, max: 120, step: 1, animatable: true },
    ],
  },
  shake: {
    label: 'Camera shake', icon: '📳',
    defaults: () => ({ amplitude: 0.3, frequency: 9, roll: 0.8 }),
    props: [
      { key: 'amplitude', label: 'Amplitude (studs)', kind: 'number', min: 0, max: 10, step: 0.05, animatable: true },
      { key: 'frequency', label: 'Frequency (Hz)', kind: 'number', min: 0.5, max: 40, step: 0.5 },
      { key: 'roll', label: 'Roll°', kind: 'number', min: 0, max: 30, step: 0.1, animatable: true },
    ],
  },
  sound: {
    label: 'Sound', icon: '🔊',
    defaults: () => ({ soundId: '', volume: 0.7, pitch: 1 }),
    props: [
      { key: 'soundId', label: 'Roblox sound id', kind: 'text', placeholder: 'rbxassetid://…' },
      { key: 'volume', label: 'Volume', kind: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'pitch', label: 'Pitch', kind: 'number', min: 0.1, max: 4, step: 0.05 },
    ],
  },
};
export const LAYER_TYPE_KEYS = Object.keys(LAYER_TYPES);

// ---------------------------------------------------------------- modifier registry
// Modifiers post-process a layer's sampled output in stack order (semantics in effectEngine.js).
// `appliesTo` gates which layer types offer them. Numeric params marked animatable are keyable
// through the owning layer's curves under the track name `mod:<modifierId>:<param>`.
// `exportMode` is the Roblox degrade contract (see docs/vfx-studio.md): 'baked' folds into
// over-life sequences, 'scheduled' becomes per-frame property writes, 'approximated' maps to a
// nearby Roblox property, 'dropped' is preview-only — the exporter and the export validator both
// read this column, so the fidelity badge, the diagnostic, and the actual export can never
// disagree about what happens to a given modifier.
export const MODIFIER_TYPES = {
  noise: {
    label: 'Noise', icon: '〰', appliesTo: ['emitter'], exportMode: 'dropped',
    defaults: () => ({ amount: 0.4, frequency: 1.5 }),
    params: [
      { key: 'amount', label: 'Amount (studs)', kind: 'number', min: 0, max: 20, step: 0.05, animatable: true },
      { key: 'frequency', label: 'Frequency', kind: 'number', min: 0.05, max: 20, step: 0.05 },
    ],
  },
  wind: {
    label: 'Wind', icon: '🌬', appliesTo: ['emitter'], exportMode: 'approximated',
    defaults: () => ({ direction: [1, 0, 0], strength: 1.5 }),
    params: [
      { key: 'direction', label: 'Direction', kind: 'vec3' },
      { key: 'strength', label: 'Strength (studs/sec)', kind: 'number', min: -50, max: 50, step: 0.1, animatable: true },
    ],
  },
  pulse: {
    label: 'Pulse', icon: '💓', appliesTo: ['emitter', 'shape', 'light'], exportMode: 'scheduled',
    defaults: () => ({ amount: 0.25, frequency: 2 }),
    params: [
      { key: 'amount', label: 'Amount', kind: 'range', min: 0, max: 1, step: 0.01, animatable: true },
      { key: 'frequency', label: 'Frequency (Hz)', kind: 'number', min: 0.1, max: 30, step: 0.1 },
    ],
  },
  flicker: {
    label: 'Flicker', icon: '✴', appliesTo: ['emitter', 'light', 'screen'], exportMode: 'dropped',
    defaults: () => ({ amount: 0.5 }),
    params: [{ key: 'amount', label: 'Amount', kind: 'range', min: 0, max: 1, step: 0.01, animatable: true }],
  },
  orbit: {
    label: 'Orbit swirl', icon: '🌀', appliesTo: ['emitter'], exportMode: 'dropped',
    defaults: () => ({ speed: 2, radius: 0.6 }),
    params: [
      { key: 'speed', label: 'Speed (rad/sec)', kind: 'number', min: -30, max: 30, step: 0.1, animatable: true },
      { key: 'radius', label: 'Radius (studs)', kind: 'number', min: 0, max: 20, step: 0.05, animatable: true },
    ],
  },
  fadeInOut: {
    label: 'Fade in/out', icon: '◐', appliesTo: ['emitter', 'shape', 'light', 'screen'], exportMode: 'baked',
    defaults: () => ({ fadeIn: 0.15, fadeOut: 0.3 }),
    params: [
      { key: 'fadeIn', label: 'Fade in (clip fraction)', kind: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'fadeOut', label: 'Fade out (clip fraction)', kind: 'range', min: 0, max: 1, step: 0.01 },
    ],
  },
  gradientShift: {
    label: 'Hue shift', icon: '🌈', appliesTo: ['emitter', 'shape', 'light'], exportMode: 'scheduled',
    defaults: () => ({ degrees: 120 }),
    params: [{ key: 'degrees', label: 'Degrees over clip', kind: 'number', min: -1080, max: 1080, step: 5, animatable: true }],
  },
  glowBoost: {
    label: 'Glow boost', icon: '🔆', appliesTo: ['emitter', 'shape'], exportMode: 'baked',
    defaults: () => ({ amount: 0.5 }),
    params: [{ key: 'amount', label: 'Amount', kind: 'range', min: 0, max: 2, step: 0.02, animatable: true }],
  },
};
export const MODIFIER_TYPE_KEYS = Object.keys(MODIFIER_TYPES);

// ---------------------------------------------------------------- construction
export function newEffect(name = 'Untitled Effect') {
  return { version: EFFECT_VERSION, id: uid(), name, fps: 30, duration: 60, loop: true, layers: [] };
}

export function newLayer(type, name) {
  const meta = LAYER_TYPES[type];
  if (!meta) throw new Error(`unknown layer type "${type}"`);
  return {
    id: uid(), type,
    name: name || meta.label,
    enabled: true,
    clip: { start: 0, len: 60, loop: false },
    props: meta.defaults(),
    curves: {}, exprs: {}, modifiers: [],
  };
}

export function addLayer(doc, layer, index = doc.layers.length) {
  layer.clip.len = Math.min(layer.clip.len, Math.max(1, doc.duration));
  doc.layers.splice(Math.max(0, Math.min(doc.layers.length, index)), 0, layer);
  return layer;
}

export function getLayer(doc, layerId) {
  return doc.layers.find((l) => l.id === layerId) || null;
}

export function removeLayer(doc, layerId) {
  const i = doc.layers.findIndex((l) => l.id === layerId);
  if (i < 0) return false;
  doc.layers.splice(i, 1);
  return true;
}

export function duplicateLayer(doc, layerId) {
  const src = getLayer(doc, layerId);
  if (!src) return null;
  const copy = structuredClone(src);
  copy.id = uid();
  copy.name = `${src.name} copy`;
  // Regenerating modifier ids MUST rewrite the matching mod:<id>:* curve/expr key names in the
  // same operation, or the copy's modifier animation silently detaches (and the orphaned keys
  // serialize into .cfx forever) — this is an op invariant, not something auto-fix mops up later.
  for (const m of copy.modifiers) {
    const oldId = m.id;
    m.id = uid();
    const oldPrefix = `mod:${oldId}:`, newPrefix = `mod:${m.id}:`;
    for (const store of [copy.curves, copy.exprs]) {
      if (!store) continue;
      for (const key of Object.keys(store)) {
        if (key.startsWith(oldPrefix)) {
          store[newPrefix + key.slice(oldPrefix.length)] = store[key];
          delete store[key];
        }
      }
    }
  }
  doc.layers.splice(doc.layers.indexOf(src) + 1, 0, copy);
  return copy;
}

export function moveLayer(doc, layerId, newIndex) {
  const i = doc.layers.findIndex((l) => l.id === layerId);
  if (i < 0) return false;
  const [l] = doc.layers.splice(i, 1);
  doc.layers.splice(Math.max(0, Math.min(doc.layers.length, newIndex)), 0, l);
  return true;
}

export function addModifier(layer, type) {
  const meta = MODIFIER_TYPES[type];
  if (!meta) throw new Error(`unknown modifier type "${type}"`);
  if (!meta.appliesTo.includes(layer.type)) throw new Error(`"${type}" does not apply to ${layer.type} layers`);
  const mod = { id: uid(), type, enabled: true, props: meta.defaults() };
  layer.modifiers.push(mod);
  return mod;
}

export function getModifier(layer, modifierId) {
  return layer.modifiers.find((m) => m.id === modifierId) || null;
}

// Deleting a modifier deletes its mod:<id>:* curves and expressions in the same operation —
// the UI can never strand an orphaned curve key (the orphan-key auto-fix exists only for
// hand-edited or MCP-written documents).
export function removeModifier(layer, modifierId) {
  const i = layer.modifiers.findIndex((m) => m.id === modifierId);
  if (i < 0) return false;
  layer.modifiers.splice(i, 1);
  const prefix = `mod:${modifierId}:`;
  for (const store of [layer.curves, layer.exprs]) {
    if (!store) continue;
    for (const key of Object.keys(store)) {
      if (key.startsWith(prefix)) delete store[key];
    }
  }
  return true;
}

export function moveModifier(layer, modifierId, newIndex) {
  const i = layer.modifiers.findIndex((m) => m.id === modifierId);
  if (i < 0) return false;
  const [m] = layer.modifiers.splice(i, 1);
  layer.modifiers.splice(Math.max(0, Math.min(layer.modifiers.length, newIndex)), 0, m);
  return true;
}

// ---------------------------------------------------------------- clamping
export function propMetaFor(layerType, prop) {
  return (LAYER_TYPES[layerType]?.props || []).find((p) => p.key === prop) || null;
}

export function clampProp(layerType, prop, v) {
  const meta = propMetaFor(layerType, prop);
  if (!meta || typeof v !== 'number') return v;
  let out = v;
  if (typeof meta.min === 'number') out = Math.max(meta.min, out);
  if (typeof meta.max === 'number') out = Math.min(meta.max, out);
  return out;
}

export function setLayerProps(layer, patch) {
  for (const [k, v] of Object.entries(patch)) {
    layer.props[k] = typeof v === 'number' ? clampProp(layer.type, k, v) : v;
  }
}

export function setClip(layer, patch, docDuration) {
  const c = { ...layer.clip, ...patch };
  c.start = Math.max(0, Math.round(c.start));
  c.len = Math.max(1, Math.round(c.len));
  if (typeof docDuration === 'number') {
    c.start = Math.min(c.start, Math.max(0, docDuration - 1));
    c.len = Math.min(c.len, Math.max(1, docDuration - c.start));
  }
  layer.clip = c;
}

// ---------------------------------------------------------------- curves
// Keys: { t (clip-local frame), v (number | '#rrggbb'), es?, ed?, bez? }. Sorted by t, unique t.
export function getCurve(layer, prop) {
  return layer.curves[prop] || null;
}

export function setCurveKey(layer, prop, t, v, easing = {}) {
  const keys = layer.curves[prop] || (layer.curves[prop] = []);
  t = Math.round(t);
  const existing = keys.find((k) => k.t === t);
  if (existing) {
    existing.v = v;
    if (easing.es !== undefined) existing.es = easing.es;
    if (easing.ed !== undefined) existing.ed = easing.ed;
    if (easing.bez !== undefined) existing.bez = easing.bez;
    return existing;
  }
  const key = { t, v };
  if (easing.es) key.es = easing.es;
  if (easing.ed) key.ed = easing.ed;
  if (easing.bez) key.bez = easing.bez;
  keys.push(key);
  keys.sort((a, b) => a.t - b.t);
  return key;
}

export function deleteCurveKey(layer, prop, t) {
  const keys = layer.curves[prop];
  if (!keys) return false;
  const i = keys.findIndex((k) => k.t === Math.round(t));
  if (i < 0) return false;
  keys.splice(i, 1);
  if (!keys.length) delete layer.curves[prop];
  return true;
}

export function clearCurve(layer, prop) {
  const had = !!layer.curves[prop];
  delete layer.curves[prop];
  return had;
}

const hexRe = /^#([0-9a-f]{6})$/i;
function lerpHex(a, b, t) {
  const ma = hexRe.exec(a), mb = hexRe.exec(b);
  if (!ma || !mb) return t < 1 ? a : b;
  const va = parseInt(ma[1], 16), vb = parseInt(mb[1], 16);
  const ch = (v, s) => (v >> s) & 255;
  const mix = (s) => Math.round(ch(va, s) + (ch(vb, s) - ch(va, s)) * t);
  return `#${((mix(16) << 16) | (mix(8) << 8) | mix(0)).toString(16).padStart(6, '0')}`;
}

// Hold before the first key and after the last; between keys, the LEFT key's easing shapes the
// segment (exactly the animator's track convention, so what you learn in one editor is true in
// the other).
export function evalCurve(keys, t, fallback) {
  if (!keys || !keys.length) return fallback;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1];
  const span = b.t - a.t;
  const progress = span > 0 ? (t - a.t) / span : 1;
  const e = evalSegment(a, progress);
  if (typeof a.v === 'number' && typeof b.v === 'number') return a.v + (b.v - a.v) * e;
  if (typeof a.v === 'string' && typeof b.v === 'string') return lerpHex(a.v, b.v, e);
  return e < 1 ? a.v : b.v;
}

// ---------------------------------------------------------------- property resolution
// The one true resolution order, used by the engine, the inspector's live readouts, export
// baking, and validation: expression (when present) → curve (when keys exist) → base prop.
// `lf` is the clip-local frame. Expressions see the curve/base result as `value`, so
// `value * (0.8 + 0.2*noise(t*4))` composes with, rather than replaces, hand-authored curves.
export function resolveProp(layer, prop, lf, fps) {
  const base = layer.props[prop];
  const curveVal = evalCurve(layer.curves[prop], lf, base);
  const expr = layer.exprs?.[prop];
  if (expr && typeof curveVal === 'number') {
    const durSec = layer.clip.len / fps;
    return evalExpr(expr, { t: lf / fps, f: lf, dur: durSec, value: curveVal }, curveVal);
  }
  return curveVal;
}

// Modifier params resolve through the same pipeline under `mod:<id>:<param>` curve names.
export function resolveModParam(layer, mod, param, lf, fps) {
  const base = mod.props[param];
  const track = `mod:${mod.id}:${param}`;
  const curveVal = evalCurve(layer.curves[track], lf, base);
  const expr = layer.exprs?.[track];
  if (expr && typeof curveVal === 'number') {
    return evalExpr(expr, { t: lf / fps, f: lf, dur: layer.clip.len / fps, value: curveVal }, curveVal);
  }
  return curveVal;
}

// ---------------------------------------------------------------- serialization
export function serializeEffect(doc) {
  return JSON.stringify(doc, null, 2);
}

// Parse + normalize an effect doc from untrusted JSON (a .cfx file, an MCP tool call, a preset).
// Returns { ok:true, doc } or { ok:false, error }. Unknown layer/modifier types are rejected
// rather than silently dropped — a doc referencing a type this build doesn't know is a doc this
// build cannot faithfully edit.
export function parseEffect(input) {
  let raw;
  try {
    raw = typeof input === 'string' ? JSON.parse(input) : structuredClone(input);
  } catch (e) {
    return { ok: false, error: `not valid JSON: ${e.message}` };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };
  if (raw.emitter && !raw.layers) return { ok: true, doc: emitterToEffect(raw.name || 'Imported Effect', raw.emitter) };
  if (!Array.isArray(raw.layers)) return { ok: false, error: 'missing layers array' };

  const doc = newEffect(typeof raw.name === 'string' ? raw.name : 'Untitled Effect');
  if (typeof raw.id === 'string') doc.id = raw.id;
  doc.fps = Number.isFinite(raw.fps) ? Math.max(1, Math.min(120, Math.round(raw.fps))) : 30;
  doc.duration = Number.isFinite(raw.duration) ? Math.max(1, Math.min(100000, Math.round(raw.duration))) : 60;
  doc.loop = raw.loop !== false;

  for (const rl of raw.layers) {
    if (!rl || !LAYER_TYPES[rl.type]) return { ok: false, error: `unknown layer type "${rl?.type}"` };
    const layer = newLayer(rl.type, typeof rl.name === 'string' ? rl.name : undefined);
    if (typeof rl.id === 'string') layer.id = rl.id;
    layer.enabled = rl.enabled !== false;
    if (rl.clip && typeof rl.clip === 'object') setClip(layer, rl.clip, doc.duration);
    if (rl.props && typeof rl.props === 'object') setLayerProps(layer, rl.props);
    if (rl.curves && typeof rl.curves === 'object') {
      for (const [prop, keys] of Object.entries(rl.curves)) {
        if (!Array.isArray(keys)) continue;
        for (const k of keys) {
          if (!k || !Number.isFinite(k.t)) continue;
          if (!(Number.isFinite(k.v) || typeof k.v === 'string')) continue;
          setCurveKey(layer, prop, k.t, k.v, { es: k.es, ed: k.ed, bez: Array.isArray(k.bez) && k.bez.length === 4 ? k.bez : undefined });
        }
      }
    }
    if (rl.exprs && typeof rl.exprs === 'object') {
      for (const [prop, src] of Object.entries(rl.exprs)) {
        if (typeof src === 'string' && src.trim()) layer.exprs[prop] = src;
      }
    }
    if (Array.isArray(rl.modifiers)) {
      for (const rm of rl.modifiers) {
        if (!rm || !MODIFIER_TYPES[rm.type]) return { ok: false, error: `unknown modifier type "${rm?.type}"` };
        if (!MODIFIER_TYPES[rm.type].appliesTo.includes(layer.type)) continue;
        const mod = addModifier(layer, rm.type);
        if (typeof rm.id === 'string') mod.id = rm.id;
        mod.enabled = rm.enabled !== false;
        if (rm.props && typeof rm.props === 'object') Object.assign(mod.props, rm.props);
      }
    }
    doc.layers.push(layer);
  }
  return { ok: true, doc };
}

// Upgrade path from the v1 studio's single-emitter payload ({ name, emitter }) — and the bridge
// for applying a plain particle preset inside the v2 studio.
export function emitterToEffect(name, emitter) {
  const doc = newEffect(name || 'Particle Effect');
  const layer = newLayer('emitter', 'Particles');
  Object.assign(layer.props, emitter || {});
  layer.clip = { start: 0, len: doc.duration, loop: false };
  doc.layers.push(layer);
  return doc;
}

// Compact structural overview for MCP get-state responses and validation reports — everything
// needed to reason about the doc without shipping every curve key across the wire.
export function effectSummary(doc) {
  return {
    id: doc.id, name: doc.name, fps: doc.fps, duration: doc.duration, loop: doc.loop,
    layerCount: doc.layers.length,
    layers: doc.layers.map((l, i) => ({
      index: i, id: l.id, name: l.name, type: l.type, enabled: l.enabled,
      clip: { ...l.clip },
      curves: Object.fromEntries(Object.entries(l.curves).map(([p, keys]) => [p, keys.length])),
      exprs: Object.keys(l.exprs || {}),
      modifiers: l.modifiers.map((m) => ({ id: m.id, type: m.type, enabled: m.enabled })),
    })),
  };
}
