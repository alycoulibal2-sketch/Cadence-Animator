// SKETCH IT 2.0's paint-signal capture + graceful-degradation interpreters. Two separate
// responsibilities kept in one small module (pure, state-free — no window/DOM, importable bare
// like sketchGeometry.js/effectModel.js):
//
//   CAPTURE (captureSketchIntent): normalizes the raw workspace session (shape strokes + whatever
//   paint layers the user touched) into a SketchIntent. Deliberately does the MINIMUM processing —
//   no archetype or engine knowledge here at all. This is the exact shape persisted verbatim onto
//   doc.sketchOrigin (see effectModel.js) so painted intent is never thrown away, only degraded at
//   render/export time.
//
//   INTERPRET (interpretEnergy, and interpretColor/interpretDensity/interpretMotion in later
//   phases): each takes a materialized candidate doc + one field of the intent and mutates the doc
//   to approximate that signal using ONLY existing engine primitives — no new schema, no new
//   sampler code. Each is a no-op when its field is absent, and every numeric write goes through
//   the existing exported clampProp()/modifier-param clamp, so a candidate can never leave an
//   interpreter invalid.
//
// SketchIntent = {
//   shapeGuides: Guide[],                                          // the raw Shape-layer strokes
//   colorField:   null | { dabs: [{x,y,radius,hex}] },              // Phase 4
//   densityField: null | { dabs: [{x,y,radius,intensity}] },        // Phase 5
//   motionField:  null | { arrows: [{origin:{x,y},dir:{x,y},magnitude}] }, // Phase 6
//   energyLevel: 'calm'|'normal'|'strong'|'extreme',
// }

import { MODIFIER_TYPES, clampProp } from './effectModel.js';
import { analyzePrimaryStroke, dist } from './sketchGeometry.js';
import { sanitizeRamp } from './rampEval.js';

export const NEUTRAL_INTENT = {
  shapeGuides: [], colorField: null, densityField: null, motionField: null, energyLevel: 'normal',
};

// session: { shapeStrokes, colorDabs, densityDabs, motionArrows, energyLevel } — the raw workspace
// state (sketchWorkspace.js), whichever of these the user actually touched. Anything absent/empty
// degrades to NEUTRAL_INTENT's value for that field, never throws.
export function captureSketchIntent(session = {}) {
  return {
    shapeGuides: Array.isArray(session.shapeStrokes) ? session.shapeStrokes : [],
    colorField: session.colorDabs && session.colorDabs.length ? { dabs: session.colorDabs.map((d) => ({ ...d })) } : null,
    densityField: session.densityDabs && session.densityDabs.length ? { dabs: session.densityDabs.map((d) => ({ ...d })) } : null,
    motionField: session.motionArrows && session.motionArrows.length ? { arrows: session.motionArrows.map((a) => ({ ...a })) } : null,
    energyLevel: ['calm', 'normal', 'strong', 'extreme'].includes(session.energyLevel) ? session.energyLevel : 'normal',
  };
}

// ---------------------------------------------------------------- Energy interpreter
const ENERGY_MULTIPLIERS = { calm: 0.6, normal: 1, strong: 1.35, extreme: 1.8 };
const ENERGY_MOD_TYPES = ['noise', 'pulse', 'flicker', 'glowBoost']; // every MODIFIER_TYPES entry with an `amount` param

function clampModParam(type, key, v) {
  const meta = MODIFIER_TYPES[type]?.params.find((p) => p.key === key);
  if (!meta || typeof v !== 'number') return v;
  let out = v;
  if (typeof meta.min === 'number') out = Math.max(meta.min, out);
  if (typeof meta.max === 'number') out = Math.min(meta.max, out);
  return out;
}

// calm/normal/strong/extreme -> brightness/glow/emission/particle-size/shake intensity, via the
// same flat multiplier table across every layer type that has a relevant prop — never expose the
// raw Roblox properties to the user (spec's explicit instruction), only the 4-word energy chip.
export function interpretEnergy(doc, energyLevel) {
  const mul = ENERGY_MULTIPLIERS[energyLevel];
  if (!mul || Math.abs(mul - 1) < 1e-6) return; // 'normal' or unrecognized -> exact no-op
  for (const layer of doc.layers) {
    if (layer.type === 'emitter') {
      if (typeof layer.props.sizeStart === 'number') layer.props.sizeStart = clampProp('emitter', 'sizeStart', layer.props.sizeStart * mul);
      if (typeof layer.props.sizeEnd === 'number') layer.props.sizeEnd = clampProp('emitter', 'sizeEnd', layer.props.sizeEnd * mul);
    } else if (layer.type === 'light') {
      if (typeof layer.props.intensity === 'number') layer.props.intensity = clampProp('light', 'intensity', layer.props.intensity * mul);
    } else if (layer.type === 'shake') {
      if (typeof layer.props.amplitude === 'number') layer.props.amplitude = clampProp('shake', 'amplitude', layer.props.amplitude * mul);
    }
    for (const mod of layer.modifiers) {
      if (ENERGY_MOD_TYPES.includes(mod.type) && typeof mod.props.amount === 'number') {
        mod.props.amount = clampModParam(mod.type, 'amount', mod.props.amount * mul);
      }
    }
  }
}

// ---------------------------------------------------------------- Color interpreter
const hexRe = /^#([0-9a-f]{6})$/i;
function hexToRgb(hex) {
  const m = hexRe.exec(hex);
  if (!m) return [255, 255, 255];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function rgbToHex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function averageRgb(rgbs) {
  const sum = rgbs.reduce((s, c) => [s[0] + c[0], s[1] + c[1], s[2] + c[2]], [0, 0, 0]);
  return [sum[0] / rgbs.length, sum[1] / rgbs.length, sum[2] / rgbs.length];
}

// The longest guide by path length — same "one decisive gesture carries the intent" convention
// sketchGeometry.js's analyzeSketchStrokes() already uses for its own primary-stroke features.
function primaryGuideOf(shapeGuides) {
  let best = null, bestLen = -1;
  for (const g of shapeGuides || []) {
    if (!g.points || g.points.length < 2) continue;
    let len = 0;
    for (let i = 1; i < g.points.length; i++) len += dist(g.points[i - 1], g.points[i]);
    if (len > bestLen) { bestLen = len; best = g; }
  }
  return best;
}

// Nearest point on the polyline to `pt`, returned as that point's cumulative arc-length fraction
// (0..1) along the path — the sampling axis for an open/elongated primary guide.
function projectOntoPolyline(pt, points) {
  const segLens = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) { const l = dist(points[i - 1], points[i]); segLens.push(l); total += l; }
  if (total < 1e-6) return 0;
  let bestDist = Infinity, bestFrac = 0, cum = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], segLen = segLens[i - 1];
    const abx = b.x - a.x, aby = b.y - a.y;
    const segLenSq = abx * abx + aby * aby;
    const t = segLenSq > 1e-9 ? Math.max(0, Math.min(1, ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / segLenSq)) : 0;
    const d = Math.hypot(pt.x - (a.x + abx * t), pt.y - (a.y + aby * t));
    if (d < bestDist) { bestDist = d; bestFrac = (cum + segLen * t) / total; }
    cum += segLen;
  }
  return bestFrac;
}

// Resamples arbitrary (u, value) samples down to `stopCount` evenly-spaced stops via `avg` — a
// real bucket-average where samples exist nearby, falling back to the nearest sample where a
// bucket is empty (never interpolates a hallucinated value no dab actually produced). Shared by
// the Color and Density interpreters — only the value type (rgb triple vs plain number) and its
// averaging function differ.
function bucketAverage(samples, stopCount, avg) {
  const stops = [];
  for (let i = 0; i < stopCount; i++) {
    const u = i / (stopCount - 1);
    const halfWidth = 0.5 / (stopCount - 1);
    const near = samples.filter((s) => Math.abs(s.u - u) <= halfWidth);
    if (near.length) {
      stops.push({ u, value: avg(near.map((s) => s.value)) });
    } else {
      let nearest = samples[0];
      for (const s of samples) if (Math.abs(s.u - u) < Math.abs(nearest.u - u)) nearest = s;
      stops.push({ u, value: nearest.value });
    }
  }
  return stops;
}

// Picks a sampling axis from the primary shape guide's own geometry — radial distance-from-
// centroid on a closed/circular guide, arc-length position along an open/elongated one — and
// returns each dab's position along it as u:0..1. Returns null when neither condition is met (an
// honest "no confident axis", not a guess): the caller must degrade gracefully, never invent one.
// Shared by Color (ramps a hex value) and Density (ramps a plain intensity number).
function axisPositionsOf(dabs, shapeGuides) {
  const primary = primaryGuideOf(shapeGuides);
  if (!primary || primary.points.length < 3) return null;
  const shape = analyzePrimaryStroke(primary);
  if (shape.closed && shape.circularity > 0.5) {
    let cx = 0, cy = 0;
    for (const p of primary.points) { cx += p.x; cy += p.y; }
    cx /= primary.points.length; cy /= primary.points.length;
    const dabDists = dabs.map((d) => Math.hypot(d.x - cx, d.y - cy));
    const maxDist = Math.max(1e-6, ...dabDists);
    return dabs.map((d, i) => Math.max(0, Math.min(1, dabDists[i] / maxDist)));
  }
  if (!shape.closed && shape.straightness > 0.5) {
    return dabs.map((d) => projectOntoPolyline(d, primary.points));
  }
  return null;
}

// Paint dabs -> an editable color-over-life ramp, or (when no confident sampling axis exists) a
// simple core/edge colorStart/colorEnd override with no ramp — an honest degrade, never a
// hallucinated axis.
export function interpretColor(doc, colorField, shapeGuides) {
  if (!colorField || !Array.isArray(colorField.dabs) || !colorField.dabs.length) return;
  const dabs = colorField.dabs;
  const us = axisPositionsOf(dabs, shapeGuides);
  const samples = us ? dabs.map((d, i) => ({ u: us[i], value: hexToRgb(d.hex) })) : null;

  if (!samples) {
    // No confident axis: split dabs by distance from their own centroid (near half = core, far
    // half = edge) into a plain 2-color override, no ramp — the honest degrade for "I don't know
    // which direction the gradient runs," not a guess dressed up as one.
    let cx = 0, cy = 0;
    for (const d of dabs) { cx += d.x; cy += d.y; }
    cx /= dabs.length; cy /= dabs.length;
    const byDist = dabs.map((d) => ({ d, dist: Math.hypot(d.x - cx, d.y - cy) })).sort((a, b) => a.dist - b.dist);
    const mid = Math.max(1, Math.floor(byDist.length / 2));
    const coreHex = rgbToHex(averageRgb(byDist.slice(0, mid).map((w) => hexToRgb(w.d.hex))));
    const farHalf = byDist.slice(mid);
    const edgeHex = rgbToHex(averageRgb((farHalf.length ? farHalf : byDist).map((w) => hexToRgb(w.d.hex))));
    for (const layer of doc.layers) {
      if (layer.type !== 'emitter') continue;
      layer.props.colorStart = coreHex;
      layer.props.colorEnd = edgeHex;
      layer.props.colorRamp = [];
    }
    return;
  }

  samples.sort((a, b) => a.u - b.u);
  const stopCount = Math.max(3, Math.min(6, new Set(dabs.map((d) => d.hex)).size + 1));
  const rampStops = sanitizeRamp(bucketAverage(samples, stopCount, averageRgb).map((s) => ({ u: s.u, v: rgbToHex(s.value) })), 'color');
  for (const layer of doc.layers) {
    if (layer.type !== 'emitter') continue;
    layer.props.colorRamp = rampStops.map((s) => ({ ...s }));
    layer.props.colorStart = rampStops[0].v;
    layer.props.colorEnd = rampStops[rampStops.length - 1].v;
  }
}

// ---------------------------------------------------------------- Density interpreter
function averageNumber(nums) { return nums.reduce((s, n) => s + n, 0) / nums.length; }

// Inverse-distance-weighted average of dab intensities at (px, py), both dab and query positions
// already normalized into the same 0..1 space — a simple, well-understood spatial interpolation
// that degrades gracefully (uniform painting -> uniform weight everywhere) without needing a real
// spawn-mask engine primitive.
function idwIntensityAt(px, py, normDabs) {
  let wSum = 0, valSum = 0;
  for (const d of normDabs) {
    const dd = Math.hypot(px - d.nx, py - d.ny);
    const w = 1 / (dd * dd + 0.01);
    wSum += w;
    valSum += w * d.intensity;
  }
  return wSum > 1e-9 ? valSum / wSum : 0.5;
}

// Sublinear growth, same idiom effectLibrary.js's applyScaleToDoc already uses for its own rate
// multiplier: painting twice as dark/dense should not literally double particle count.
function densityToRateMul(density01) { return 0.5 + density01; }

function applyRateMul(layer, mul) {
  if (typeof layer.props.rate === 'number') layer.props.rate = clampProp('emitter', 'rate', layer.props.rate * mul);
  if (typeof layer.props.maxParticles === 'number') layer.props.maxParticles = clampProp('emitter', 'maxParticles', layer.props.maxParticles * mul);
}

// Painted density -> a real spawn-position weighting when the doc has multiple emitters (sample
// the field AT EACH EMITTER'S OWN OFFSET, weight its rate/maxParticles relative to the others —
// the "multiple emitters" degradation path), else a single global density scalar + an optional
// life-fraction densityRamp on the lone emitter. Both paths are graceful degrades of the SAME
// painted intent, chosen by what the doc's own structure can actually support spatially.
export function interpretDensity(doc, densityField, shapeGuides) {
  if (!densityField || !Array.isArray(densityField.dabs) || !densityField.dabs.length) return;
  const dabs = densityField.dabs;
  const emitters = doc.layers.filter((l) => l.type === 'emitter');
  if (!emitters.length) return;

  const overallDensity = Math.max(0, Math.min(1, averageNumber(dabs.map((d) => d.intensity ?? 0.5))));
  const overallMul = densityToRateMul(overallDensity);

  if (emitters.length > 1) {
    // Project both the dabs (canvas space) and each emitter's offset (effect-local space, X/Z as
    // the "flat" plane — same convention the shape-tool guides already use) into their own 0..1
    // spans, so positions are comparable despite living in two unrelated coordinate systems.
    const dabBbox = { minX: Math.min(...dabs.map((d) => d.x)), maxX: Math.max(...dabs.map((d) => d.x)), minY: Math.min(...dabs.map((d) => d.y)), maxY: Math.max(...dabs.map((d) => d.y)) };
    const dabSpanX = Math.max(1e-6, dabBbox.maxX - dabBbox.minX), dabSpanY = Math.max(1e-6, dabBbox.maxY - dabBbox.minY);
    const normDabs = dabs.map((d) => ({ nx: (d.x - dabBbox.minX) / dabSpanX, ny: (d.y - dabBbox.minY) / dabSpanY, intensity: d.intensity ?? 0.5 }));

    const offsets = emitters.map((em) => em.props.offset || [0, 0, 0]);
    const exs = offsets.map((o) => o[0]), ezs = offsets.map((o) => o[2]);
    const spanX = Math.max(1e-6, Math.max(...exs) - Math.min(...exs));
    const spanZ = Math.max(1e-6, Math.max(...ezs) - Math.min(...ezs));
    const minEx = Math.min(...exs), minEz = Math.min(...ezs);

    const weights = emitters.map((em, i) => idwIntensityAt((exs[i] - minEx) / spanX, (ezs[i] - minEz) / spanZ, normDabs));
    const avgWeight = Math.max(1e-6, averageNumber(weights));
    emitters.forEach((em, i) => {
      const relative = weights[i] / avgWeight; // 1.0 = "average" for this doc, not an absolute scale
      applyRateMul(em, overallMul * Math.max(0.4, Math.min(2.5, relative)));
    });
    return;
  }

  const lone = emitters[0];
  applyRateMul(lone, overallMul);

  const us = axisPositionsOf(dabs, shapeGuides);
  if (!us) return; // no confident axis -> the global scalar above is the whole story, no ramp
  const samples = dabs.map((d, i) => ({ u: us[i], value: d.intensity ?? 0.5 }));
  samples.sort((a, b) => a.u - b.u);
  const stopCount = Math.max(3, Math.min(6, dabs.length));
  const rampStops = sanitizeRamp(bucketAverage(samples, stopCount, averageNumber).map((s) => ({ u: s.u, v: Math.max(0, Math.min(1, s.value)) })), 'number');
  if (rampStops.length >= 2) lone.props.densityRamp = rampStops;
}
