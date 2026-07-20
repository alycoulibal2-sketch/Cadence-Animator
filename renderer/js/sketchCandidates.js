// The Candidate Generator + Ranking stages of the SKETCH IT pipeline:
//   Sketch -> Geometry Analysis (sketchGeometry.js) -> Composition Planner -> Ranking ->
//   Preview Renderer (sketchPreviewRenderer.js) -> User Selection -> Editable Effect.
//
// Hard requirement: Cadence must never generate an effect by selecting or fusing an existing
// FINISHED effect — every candidate is assembled fresh from low-level primitives by
// compositionGenerator.js's synthesizeComposition(), planned from the sketch's own geometry. No
// stored, named effect ever gets copied wholesale. This file registers itself as the
// "procedural-planner-v1" Composition Planner behind a small, swappable seam
// (registerCompositionPlanner/getCompositionPlanner) — SKETCH IT 2.0's requirement that
// composition strategy stay replaceable (a future generative composer, or a Claude/GPT/Gemini-
// backed planner) without the UI (sketchResults.js) ever changing. The UI only ever calls
// planCompositions() and gets candidates back through a callback, never caring which planner
// produced them.
//
// Fully deterministic on purpose (no Math.random anywhere) — same sketch always yields the same
// 30 candidates in the same order, matching this codebase's existing preference for determinism
// (particle spawn jitter and shape jaggedness are both stateless hashes, never Math.random()).

import { EFFECT_SCALES, applyThemeToDoc, applyScaleToDoc } from './effectLibrary.js';
import { clampProp, setClip } from './effectModel.js';
import { NEUTRAL_INTENT, interpretEnergy, interpretColor, interpretDensity, interpretMotion } from './sketchIntent.js';
import { formFamilyOf, synthesizeComposition, scoreVariation, shapeChoicesFor, motionChoicesFor, nameFor, iconFor } from './compositionGenerator.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// ---------------------------------------------------------------- geometry -> derived signals
// Small set of derived signals shared across scoring/generation, computed once per analysis.
//
// `intent` biases `aggression` (feeds pickAggressiveTheme's theme choice AND
// compositionGenerator.js's scoreVariation, never a specific finished effect — no primitive
// builder reads intent directly). 'normal' — the value NEUTRAL_INTENT always carries, whether the
// user explicitly picked it or never touched the Energy control at all — contributes a bias of
// exactly 0, so this is byte-identical to the old geometry-only formula whenever intent is
// absent/default. Explicit calm/strong/extreme shift the read up or down from that same
// geometric baseline.
const ENERGY_AGGRESSION_BIAS = { calm: -0.35, normal: 0, strong: 0.25, extreme: 0.5 };
function deriveSignals(f, intent = NEUTRAL_INTENT) {
  const geometricAggression = clamp01(0.5 * clamp01(f.maxSpeed / 1200) + 0.3 * f.zigzagScore + 0.2 * clamp01(f.crossingCount / 4));
  const bias = ENERGY_AGGRESSION_BIAS[intent.energyLevel] ?? 0;
  return {
    fastness: clamp01(f.maxSpeed / 1200),
    shortness: clamp01(1 - f.totalLength / 500),
    bigness: clamp01(f.bbox.diagonal / 900),
    elongation: clamp01(Math.abs(Math.log(Math.max(0.1, f.aspectRatio || 1))) / Math.log(4)),
    multiStroke: clamp01((f.strokeCount - 1) / 4),
    verticalish: clamp01(1 - Math.abs(f.dominantAngleDeg - 90) / 45),
    aggression: clamp01(geometricAggression + bias),
  };
}

// ---------------------------------------------------------------- theme / scale bias
// Generic signal->key utilities (no finished-effect knowledge at all — just "a fast/jagged
// gesture biases toward hotter/sharper colors, a slow/smooth one toward calmer ones") reused by
// the primitive generator for color/size variety, exactly as they were reused for archetype
// dressing before this rewrite.
function pickAggressiveTheme(aggression) {
  if (aggression >= 0.7) return 'ember';
  if (aggression >= 0.45) return 'toxic';
  if (aggression >= 0.25) return 'arcane';
  if (aggression >= 0.1) return 'ice';
  return 'holy';
}
function pickScaleKey(bigness) {
  if (bigness > 0.62) return 'large';
  if (bigness < 0.3) return 'small';
  return 'standard';
}

// ---------------------------------------------------------------- generation plan
// Enumerates STRUCTURAL variations (shape choice x motion style x layer complexity, shortlisted
// per geometric form family by compositionGenerator.js) rather than picking from a fixed list of
// named effects. Scored by scoreVariation (plausibility of the structural choice against the read
// geometry — never "which archetype"), then topped up with theme/scale-only repeats of the
// top-scoring structural choice if a family's own shortlist doesn't reach `count` on its own
// (spiral/jagged have only 1 shape primitive each, so this fires often for them — real, if
// smaller, additional variety comes from cycling theme+scale across the repeats, not just hue).
export function buildGenerationPlan(features, intent = NEUTRAL_INTENT, count = 30) {
  const sig = deriveSignals(features, intent);
  const family = formFamilyOf(features);
  const shapeChoices = shapeChoicesFor(family);
  const motionChoices = motionChoicesFor(family);
  const complexities = [1, 2, 3, 4];

  const variations = [];
  for (const shapeChoice of shapeChoices) {
    for (const motionStyle of motionChoices) {
      for (const complexity of complexities) {
        variations.push({ shapeChoice, motionStyle, complexity, confidence: scoreVariation({ shapeChoice, motionStyle, complexity }, family, sig) });
      }
    }
  }
  variations.sort((a, b) => b.confidence - a.confidence);

  const baseTheme = pickAggressiveTheme(sig.aggression);
  const scaleKey = pickScaleKey(sig.bigness);
  const themeCycle = ['classic', baseTheme, 'ice', 'toxic', 'arcane'];
  const scaleCycle = [scaleKey, 'standard', 'large', 'small'];

  const plan = [];
  let hueSeed = 0;
  for (const v of variations) {
    if (plan.length >= count) break;
    plan.push({
      family, shapeChoice: v.shapeChoice, motionStyle: v.motionStyle, complexity: v.complexity,
      theme: plan.length === 0 ? baseTheme : 'classic', scaleKey, hueSeed: hueSeed++, confidence: v.confidence,
    });
  }
  // Top-up: repeat the top-scoring structural choice with cycling theme/scale for extra variety —
  // never adds a NEW structural pattern, just dresses the best-read one differently, same spirit
  // as the old "bonus variant" but on a synthesized doc instead of a picked archetype.
  const top = variations[0];
  let topUpIndex = 0;
  while (plan.length < count && top) {
    plan.push({
      family, shapeChoice: top.shapeChoice, motionStyle: top.motionStyle, complexity: top.complexity,
      theme: themeCycle[topUpIndex % themeCycle.length],
      scaleKey: scaleCycle[Math.floor(topUpIndex / themeCycle.length) % scaleCycle.length],
      hueSeed: hueSeed++,
      confidence: Math.max(0.05, top.confidence - 0.01 * (topUpIndex + 1)),
    });
    topUpIndex++;
  }
  return plan;
}

// ---------------------------------------------------------------- geometry-driven nudges
// Rescales doc.duration, every layer's clip window, AND every curve key's clip-local `t` by the
// SAME factor — a long, elaborate gesture plays out a little slower than a quick tap. Unchanged
// from before this rewrite; still the ONE place duration is length-driven (synthesizeComposition
// always returns a fixed default so this signal is never double-counted).
function rescaleTiming(doc, factor) {
  if (Math.abs(factor - 1) < 0.02) return;
  const newDuration = Math.max(4, Math.round(doc.duration * factor));
  for (const layer of doc.layers) {
    for (const keys of Object.values(layer.curves)) {
      for (const k of keys) k.t = Math.round(k.t * factor);
    }
    layer.clip.start = Math.round(layer.clip.start * factor);
    layer.clip.len = Math.max(1, Math.round(layer.clip.len * factor));
  }
  doc.duration = newDuration;
  for (const layer of doc.layers) setClip(layer, { start: layer.clip.start, len: layer.clip.len, loop: layer.clip.loop }, doc.duration);
}

// Subtle, always-clamped personalization on top of the synthesized base: direction (only when the
// sketch actually had a clear one), particle speed/spread from how fast/jagged the gesture was,
// and overall pacing from how much ink/time it took. Unchanged from before this rewrite — it
// operates on whatever layers exist, agnostic to whether they came from an archetype or (now) a
// fresh synthesis.
function applyGeometryNudges(doc, features) {
  if (features.empty) return;
  const speedFactor = 0.85 + 0.3 * clamp01(features.maxSpeed / 1000);
  const spreadFactor = 0.85 + 0.3 * features.zigzagScore;
  const timeFactor = 0.9 + 0.3 * clamp01(features.totalLength / 700);

  for (const layer of doc.layers) {
    if (layer.type !== 'emitter') continue;
    if (typeof layer.props.speed === 'number') layer.props.speed = clampProp('emitter', 'speed', layer.props.speed * speedFactor);
    if (typeof layer.props.spreadDegrees === 'number') layer.props.spreadDegrees = clampProp('emitter', 'spreadDegrees', layer.props.spreadDegrees * spreadFactor);
  }
  if (features.straightness > 0.35) {
    const shapeLayer = doc.layers.find((l) => l.type === 'shape' && l.enabled);
    if (shapeLayer) shapeLayer.props.rotation = clampProp('shape', 'rotation', features.dominantAngleDeg);
  }
  rescaleTiming(doc, timeFactor);
}

function materializeCandidate(spec, features, intent, index) {
  const sig = deriveSignals(features, intent);
  const doc = synthesizeComposition(features, sig, spec);
  if (!doc) return null;
  const scaleFactor = EFFECT_SCALES.find((s) => s.key === spec.scaleKey)?.factor ?? 1;
  applyThemeToDoc(doc, spec.theme);
  applyScaleToDoc(doc, scaleFactor);
  applyGeometryNudges(doc, features);
  interpretEnergy(doc, intent.energyLevel); // no-op for 'normal'/absent — see sketchIntent.js
  interpretColor(doc, intent.colorField, intent.shapeGuides); // no-op when colorField is null
  interpretDensity(doc, intent.densityField, intent.shapeGuides); // no-op when densityField is null
  interpretMotion(doc, intent.motionField); // no-op when motionField is null
  doc.sketchOrigin = {
    version: 1,
    plannerId: DEFAULT_PLANNER_ID,
    shapeGuides: intent.shapeGuides || [],
    colorField: intent.colorField || null,
    densityField: intent.densityField || null,
    motionField: intent.motionField || null,
    energyLevel: intent.energyLevel || 'normal',
  };
  doc.name = nameFor(spec.family, spec.motionStyle);
  return {
    id: `sketch-${spec.family}-${spec.shapeChoice || 'none'}-${spec.motionStyle}-c${spec.complexity}-${spec.theme}-${index}`,
    family: spec.family,
    shapeChoice: spec.shapeChoice,
    motionStyle: spec.motionStyle,
    complexity: spec.complexity,
    name: doc.name,
    icon: iconFor(spec.family),
    category: spec.family,
    theme: spec.theme,
    scaleKey: spec.scaleKey,
    confidence: clamp01(spec.confidence),
    doc,
  };
}

// ---------------------------------------------------------------- ranking
// Best Match (1) / Good Matches (next 6) / More Ideas (the rest) — the spec's three-tier layout.
export function rankCandidates(candidates) {
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  return { best: sorted[0] || null, good: sorted.slice(1, 7), more: sorted.slice(7) };
}

// ---------------------------------------------------------------- Composition Planner seam
// The UI (sketchResults.js) only ever talks to THIS seam, never to proceduralPlannerGenerate
// directly — a future planner registers under a new id and the UI is unchanged. generate(features,
// opts, emit): call `emit(candidate)` as each one becomes ready; opts.signal is an AbortSignal the
// planner should check between candidates.
const planners = new Map();
export function registerCompositionPlanner(id, generate) {
  planners.set(id, { id, generate });
}
export function getCompositionPlanner(id) {
  return planners.get(id) || null;
}
export const DEFAULT_PLANNER_ID = 'procedural-planner-v1';

async function proceduralPlannerGenerate(features, opts, emit) {
  const count = opts?.count ?? 30;
  const intent = opts?.intent ?? NEUTRAL_INTENT;
  const plan = buildGenerationPlan(features, intent, count);
  const BATCH = 3; // small batches + a real event-loop yield = genuine progressive reveal, not a
  // fake delay — a slow networked planner drops into this exact same emit-as-you-go contract.
  for (let i = 0; i < plan.length; i += BATCH) {
    if (opts?.signal?.aborted) return;
    const batch = plan.slice(i, i + BATCH);
    batch.forEach((spec, j) => {
      const candidate = materializeCandidate(spec, features, intent, i + j);
      if (candidate) emit(candidate);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
registerCompositionPlanner(DEFAULT_PLANNER_ID, proceduralPlannerGenerate);

// The one entry point sketchResults.js calls. Returns the full collected array (also delivered
// incrementally via onCandidate) so a caller that doesn't care about progressiveness can just
// await it.
export async function planCompositions(features, { count = 30, onCandidate, signal, plannerId = DEFAULT_PLANNER_ID, intent = NEUTRAL_INTENT } = {}) {
  const planner = getCompositionPlanner(plannerId) || getCompositionPlanner(DEFAULT_PLANNER_ID);
  if (!planner) return [];
  const collected = [];
  await planner.generate(features, { count, signal, intent }, (candidate) => {
    collected.push(candidate);
    if (onCandidate) onCandidate(candidate, collected.length);
  });
  return collected;
}
