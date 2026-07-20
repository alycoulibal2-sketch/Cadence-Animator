// The Candidate Generator + Ranking stages of the SKETCH IT pipeline:
//   Sketch -> Geometry Analysis (sketchGeometry.js) -> Candidate Generator -> Ranking ->
//   Preview Renderer (sketchPreviewRenderer.js) -> User Selection -> Editable Effect.
//
// Deliberately built on the EXISTING hand-tuned archetype library (effectLibrary.js) rather than
// hand-authoring new layer documents: every candidate is a real archetype run through its own
// theme/scale transforms plus small, clamped, geometry-driven nudges — so every candidate is
// exactly as valid, exportable, and editable as anything a human picks from the Presets browser.
// No AI dependency: this file IS the "local procedural" provider. It registers itself behind a
// small provider seam (registerCandidateProvider/getCandidateProvider) so a future Claude/GPT/
// Gemini-backed provider can be added later without the UI (sketchResults.js) ever changing —
// the UI only ever calls generateCandidatesProgressive() and gets candidates back through a
// callback, never caring which provider produced them.
//
// Fully deterministic on purpose (no Math.random anywhere) — same sketch always yields the same
// 30 candidates in the same order, matching this codebase's existing preference for determinism
// (particle spawn jitter and shape jaggedness are both stateless hashes, never Math.random()).

import { EFFECT_ARCHETYPES, EFFECT_SCALES, buildArchetypeDoc } from './effectLibrary.js';
import { clampProp, setClip } from './effectModel.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const bump = (x, center, width) => clamp01(1 - Math.abs(x - center) / width);

// ---------------------------------------------------------------- feature -> archetype scoring
// Small set of derived signals shared across every archetype's scorer, computed once per
// analysis rather than recomputed 25 times.
function deriveSignals(f) {
  return {
    fastness: clamp01(f.maxSpeed / 1200),
    shortness: clamp01(1 - f.totalLength / 500),
    bigness: clamp01(f.bbox.diagonal / 900),
    elongation: clamp01(Math.abs(Math.log(Math.max(0.1, f.aspectRatio || 1))) / Math.log(4)),
    multiStroke: clamp01((f.strokeCount - 1) / 4),
    verticalish: clamp01(1 - Math.abs(f.dominantAngleDeg - 90) / 45),
    aggression: clamp01(0.5 * clamp01(f.maxSpeed / 1200) + 0.3 * f.zigzagScore + 0.2 * clamp01(f.crossingCount / 4)),
  };
}

// Each entry is a heuristic, not a classifier — the point (per the design spec) is "a lot of
// information for free from geometry alone," not a precise recognizer. Every candidate stays
// browsable regardless of score; this only decides ranking, never inclusion.
const SCORERS = {
  'sword-slash': (f, s) => bump(f.curvature, 0.22, 0.28) * (0.4 + 0.6 * s.elongation) * (0.5 + 0.5 * s.fastness) * (f.openPath ? 1 : 0.6) * (1 - 0.6 * f.zigzagScore),
  explosion: (f, s) => (0.5 * s.shortness + 0.5 * clamp01(f.crossingCount / 4)) * (0.4 + 0.6 * f.complexity) * (0.5 + 0.5 * s.bigness),
  'muzzle-flash': (f, s) => s.shortness * (0.4 + 0.6 * s.fastness) * clamp01(1 - s.bigness * 0.7),
  'ground-slam': (f, s) => (0.3 + 0.7 * (f.closed ? 1 : 0.4)) * (1 - s.elongation) * (0.4 + 0.6 * s.bigness) * (1 - 0.4 * s.fastness),
  'hit-spark': (f, s) => s.shortness * clamp01(1 - s.bigness * 0.8) * (1 - 0.3 * f.complexity),
  fireball: (f, s) => bump(f.circularity, 0.5, 0.35) * clamp01(1 - s.bigness * 0.4),
  portal: (f, s) => f.circularity * (f.closed ? 1 : 0.5) * (1 - 0.5 * s.elongation),
  'heal-burst': (f, s) => (0.4 + 0.6 * bump(f.circularity, 0.35, 0.4)) * (1 - 0.5 * s.fastness) * (1 - 0.4 * f.zigzagScore),
  'lightning-strike': (f, s) => f.zigzagScore * (f.openPath ? 1 : 0.5) * (0.6 + 0.4 * clamp01(f.branchCount / 2)) * (0.5 + 0.5 * s.elongation),
  'arcane-aura': (f, s) => (1 - s.fastness) * (1 - f.zigzagScore) * bump(f.circularity, 0.4, 0.45) * 0.9,
  campfire: (f, s) => (1 - s.fastness) * bump(f.circularity, 0.45, 0.4) * clamp01(1 - s.bigness * 0.3) * 0.85,
  'water-splash': (f, s) => s.multiStroke * s.shortness * clamp01(1 - s.bigness * 0.5) * (0.5 + 0.5 * clamp01(f.crossingCount / 3)),
  'poison-cloud': (f, s) => (1 - s.fastness) * bump(f.circularity, 0.4, 0.45) * (0.5 + 0.5 * s.bigness) * 0.8,
  'ice-burst': (f, s) => s.shortness * clamp01(f.crossingCount / 4) * clamp01(1 - s.bigness * 0.6) * 0.9,
  tornado: (f, s) => f.spiralness * (0.5 + 0.5 * s.bigness),
  rain: (f, s) => s.multiStroke * f.straightness * (1 - f.zigzagScore) * 0.85,
  snowfall: (f, s) => s.multiStroke * f.straightness * (1 - s.fastness) * 0.8,
  fireflies: (f, s) => (1 - s.fastness) * s.multiStroke * s.shortness * 0.7,
  'confetti-burst': (f, s) => s.multiStroke * f.complexity * clamp01(1 - s.bigness * 0.4) * 0.9,
  'level-up': (f, s) => (0.4 + 0.6 * bump(f.circularity, 0.35, 0.4)) * (0.5 + 0.5 * s.verticalish) * (1 - 0.3 * s.fastness) * 0.85,
  'energy-shield': (f, s) => f.circularity * (1 - 0.4 * s.fastness) * (f.closed ? 1 : 0.6) * 0.95,
  teleport: (f, s) => Math.max(f.straightness * s.verticalish, f.circularity * 0.7) * 0.9,
  'black-hole': (f, s) => f.circularity * (f.closed ? 1 : 0.5) * (1 - 0.3 * s.fastness) * 0.8,
  'speed-dash': (f, s) => s.fastness * f.straightness * s.elongation * (1 - 0.6 * f.curvature),
  'sparkle-trail': (f, s) => (1 - s.fastness) * bump(f.curvature, 0.15, 0.25) * (1 - f.zigzagScore) * (f.openPath ? 1 : 0.6) * 0.85,
};

export function scoreArchetype(features, key, signals) {
  const sig = signals || deriveSignals(features);
  const fn = SCORERS[key];
  return fn ? clamp01(fn(features, sig)) : 0.3; // unknown key: modest neutral score, never excluded
}

// ---------------------------------------------------------------- theme / scale bias
// Not random — a fast, jagged, crossing-heavy sketch reads as more "aggressive," biasing the
// bonus variant toward hotter/sharper themes; a slow, smooth sketch biases toward calmer ones.
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
// One "classic" variant per archetype (every archetype always gets one shot, so More Ideas is
// never suspiciously thin) plus a themed/scaled bonus variant for the top matches, sized so the
// total lands at `count` for today's 25-archetype library. If the library grows past `count`,
// this degrades to "just the top `count` archetypes, one each" instead of overflowing.
export function buildGenerationPlan(features, count = 30) {
  const sig = deriveSignals(features);
  const scored = EFFECT_ARCHETYPES.map((a) => ({ key: a.key, score: scoreArchetype(features, a.key, sig) }))
    .sort((a, b) => b.score - a.score);

  const ranked = scored.length > count ? scored.slice(0, count) : scored;
  const bonusBudget = Math.max(0, count - ranked.length);
  const bonusKeys = new Set(ranked.slice(0, Math.min(bonusBudget, ranked.length)).map((r) => r.key));

  const aggroTheme = pickAggressiveTheme(sig.aggression);
  const sizeScale = pickScaleKey(sig.bigness);

  const plan = [];
  for (const r of ranked) {
    plan.push({ archetypeKey: r.key, theme: 'classic', scaleKey: 'standard', confidence: r.score });
    if (bonusKeys.has(r.key)) {
      plan.push({ archetypeKey: r.key, theme: aggroTheme, scaleKey: sizeScale, confidence: r.score - 0.001 });
    }
  }
  return plan;
}

// ---------------------------------------------------------------- geometry-driven nudges
// Rescales doc.duration, every layer's clip window, AND every curve key's clip-local `t` by the
// SAME factor — preserving each archetype's hand-tuned relative timing/easing exactly (a key at
// 93% of a clip's progress stays at 93% after the stretch) while letting a long, elaborate
// gesture play out a little slower than a quick tap.
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

// Subtle, always-clamped personalization on top of the archetype+theme+scale base: direction
// (only when the sketch actually had a clear one), particle speed/spread from how fast/jagged the
// gesture was, and overall pacing from how much ink/time it took. Never touches which layers
// exist or what they fundamentally are — SKETCH IT interprets, it doesn't invent.
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

function materializeCandidate(spec, features, index) {
  const scaleFactor = EFFECT_SCALES.find((s) => s.key === spec.scaleKey)?.factor ?? 1;
  const doc = buildArchetypeDoc(spec.archetypeKey, { theme: spec.theme, scale: scaleFactor });
  if (!doc) return null;
  applyGeometryNudges(doc, features);
  const arch = EFFECT_ARCHETYPES.find((a) => a.key === spec.archetypeKey);
  return {
    id: `sketch-${spec.archetypeKey}-${spec.theme}-${spec.scaleKey}-${index}`,
    archetypeKey: spec.archetypeKey,
    name: doc.name,
    icon: arch ? arch.icon : '✨',
    category: arch ? arch.category : 'Effect',
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

// ---------------------------------------------------------------- provider seam
// The UI (sketchResults.js) only ever talks to THIS seam, never to localProceduralGenerate
// directly — a future Claude/GPT/Gemini provider registers under a new id and the UI is
// unchanged. generate(features, opts, emit): call `emit(candidate)` as each one becomes ready;
// opts.signal is an AbortSignal the provider should check between candidates.
const providers = new Map();
export function registerCandidateProvider(id, generate) {
  providers.set(id, { id, generate });
}
export function getCandidateProvider(id) {
  return providers.get(id) || null;
}
export const DEFAULT_PROVIDER_ID = 'local-procedural';

async function localProceduralGenerate(features, opts, emit) {
  const count = opts?.count ?? 30;
  const plan = buildGenerationPlan(features, count);
  const BATCH = 3; // small batches + a real event-loop yield = genuine progressive reveal, not a
  // fake delay — a slow networked provider drops into this exact same emit-as-you-go contract.
  for (let i = 0; i < plan.length; i += BATCH) {
    if (opts?.signal?.aborted) return;
    const batch = plan.slice(i, i + BATCH);
    batch.forEach((spec, j) => {
      const candidate = materializeCandidate(spec, features, i + j);
      if (candidate) emit(candidate);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
registerCandidateProvider(DEFAULT_PROVIDER_ID, localProceduralGenerate);

// The one entry point sketchResults.js calls. Returns the full collected array (also delivered
// incrementally via onCandidate) so a caller that doesn't care about progressiveness can just
// await it.
export async function generateCandidatesProgressive(features, { count = 30, onCandidate, signal, providerId = DEFAULT_PROVIDER_ID } = {}) {
  const provider = getCandidateProvider(providerId) || getCandidateProvider(DEFAULT_PROVIDER_ID);
  if (!provider) return [];
  const collected = [];
  await provider.generate(features, { count, signal }, (candidate) => {
    collected.push(candidate);
    if (onCandidate) onCandidate(candidate, collected.length);
  });
  return collected;
}
