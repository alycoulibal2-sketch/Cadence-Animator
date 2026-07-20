// SKETCH IT 2.0's from-scratch primitive composer — replaces the earlier archetype-based
// generation. Hard requirement (explicit user instruction): Cadence must never generate an effect
// by selecting or fusing an existing FINISHED effect. Every composition is assembled fresh, every
// call, from low-level primitives (emitters/shapes/lights, sprite/blend/shape KINDS, motion/force
// enums) via formulas over the sketch's own analyzed geometry — nothing here ever reads a stored,
// named "this is what a portal looks like" document. Primitive *assets* (a shape kind, a motion
// enum value, a sprite choice) are the only things reused across calls; the composition itself —
// which layers, how many, with what parameter values — is computed fresh every time.
//
// Pure, state-free (no window/DOM), importable bare like effectModel.js/sketchGeometry.js.

import { newLayer, parseEffect } from './effectModel.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- geometric form family
// A purely structural read of the sketch — never a named effect's identity, just "does this read
// as radial/linear/spiral/jagged/amorphous." Same thresholds sketchCandidates.js's SCORERS used
// to feed archetype-matching now feed primitive/motion CHOICES instead.
export function formFamilyOf(features) {
  if (features.empty) return 'ambient';
  if (features.spiralness > 0.4) return 'spiral';
  if (features.closed && features.circularity > 0.45) return 'radial';
  if (features.zigzagScore > 0.45) return 'jagged';
  if (features.straightness > 0.5) return 'linear';
  return 'ambient';
}

// Per-family shortlists of PRIMITIVE assets (shape kinds, motion enum values) — small, reusable
// building blocks, never a finished composition. `null` shape choice = particles only, no shape
// layer at all.
const SHAPE_CHOICES_BY_FAMILY = {
  radial: ['ring', 'sphere', 'circle'],
  linear: ['slash', 'line', 'ribbon', 'arc'],
  spiral: ['spiral'],
  jagged: ['lightning'],
  ambient: [null, 'wave'],
};
const MOTION_CHOICES_BY_FAMILY = {
  radial: ['orbit', 'burst', 'ambient'],
  linear: ['cone', 'rise'],
  spiral: ['orbit', 'burst', 'ambient'],
  jagged: ['burst', 'cone', 'ambient'],
  ambient: ['ambient', 'rise', 'fall'],
};
export function shapeChoicesFor(family) { return SHAPE_CHOICES_BY_FAMILY[family] || SHAPE_CHOICES_BY_FAMILY.ambient; }
export function motionChoicesFor(family) { return MOTION_CHOICES_BY_FAMILY[family] || MOTION_CHOICES_BY_FAMILY.ambient; }

// ---------------------------------------------------------------- structural scoring
// Ranks a structural CHOICE's plausibility against the read geometry — the direct replacement for
// the old per-archetype SCORERS, but scoring "does orbit motion + a ring shape suit this gesture,"
// never "does this look like the Portal effect." The family's own first-listed shape/motion scores
// highest; alternates score lower but never zero — ranking only reorders, never excludes (same
// "unrecognized -> neutral, never confidently wrong" convention used throughout this codebase).
export function scoreVariation(style, family, sig) {
  const shapeChoices = shapeChoicesFor(family);
  const motionChoices = motionChoicesFor(family);
  const shapeIdx = Math.max(0, shapeChoices.indexOf(style.shapeChoice));
  const motionIdx = Math.max(0, motionChoices.indexOf(style.motionStyle));
  const shapeScore = 1 - (shapeIdx / Math.max(1, shapeChoices.length - 1)) * 0.5;
  const motionScore = 1 - (motionIdx / Math.max(1, motionChoices.length - 1)) * 0.5;
  // Complexity closer to what the sketch's own signals suggest (busier/bigger gestures -> more
  // layers) scores higher, but every level stays browsable.
  const idealComplexity = 2 + Math.round(clamp01(sig.bigness * 0.5 + (1 - sig.shortness) * 0.5) * 2);
  const complexityScore = 1 - Math.abs(style.complexity - idealComplexity) / 3;
  return clamp01(0.4 * shapeScore + 0.35 * motionScore + 0.25 * complexityScore);
}

// ---------------------------------------------------------------- primitive layer builders
function buildCoreEmitter(family, sig, style) {
  const layer = newLayer('emitter', 'Core');
  layer.props.motion = style.motionStyle;
  layer.props.rate = Math.round(clamp01(0.2 + sig.bigness * 0.4 + sig.fastness * 0.2) * 90 + 10);
  layer.props.lifetime = Math.round((0.6 + sig.bigness * 1.4) * 100) / 100;
  layer.props.speed = Math.round((1.2 + sig.fastness * 5) * 10) / 10;
  layer.props.spreadDegrees = Math.round(12 + sig.elongation * -8 + clamp01(sig.aggression) * 45);
  layer.props.gravity = family === 'radial' || family === 'spiral' ? 0 : -1.4;
  layer.props.sizeStart = Math.round((0.18 + sig.bigness * 0.45) * 100) / 100;
  layer.props.sizeEnd = Math.round(layer.props.sizeStart * 0.18 * 100) / 100;
  layer.props.maxParticles = Math.max(20, Math.round(layer.props.rate * layer.props.lifetime * 1.6));
  layer.props.shape = family === 'jagged' ? 'spark' : family === 'radial' ? 'ring' : 'glow';
  layer.props.blendMode = 'additive';
  if (family === 'radial') layer.props.emissionShape = { kind: 'ring', radius: 0.25 + sig.bigness * 0.35, width: 0.08 };
  return layer;
}

function buildAccentEmitter(family, sig, style, offset) {
  const layer = newLayer('emitter', 'Accent');
  layer.props.motion = family === 'jagged' ? 'burst' : 'ambient';
  layer.props.rate = Math.max(3, Math.round(10 + sig.bigness * 15));
  layer.props.lifetime = Math.round((0.9 + sig.bigness * 1.1) * 100) / 100;
  layer.props.speed = Math.round((0.6 + sig.fastness * 2) * 10) / 10;
  layer.props.spreadDegrees = Math.round(25 + clamp01(sig.aggression) * 40);
  layer.props.gravity = -0.5;
  layer.props.sizeStart = Math.round((0.04 + sig.bigness * 0.08) * 100) / 100;
  layer.props.sizeEnd = Math.round(layer.props.sizeStart * 0.15 * 100) / 100;
  layer.props.maxParticles = Math.max(15, Math.round(layer.props.rate * layer.props.lifetime * 1.6));
  layer.props.shape = 'spark';
  layer.props.blendMode = 'additive';
  layer.props.offset = offset;
  return layer;
}

function buildShapeLayer(family, sig, style) {
  if (!style.shapeChoice) return null;
  const layer = newLayer('shape', 'Core Shape');
  const shapeDef = { kind: style.shapeChoice };
  const size = 0.8 + sig.bigness * 1.6;
  switch (style.shapeChoice) {
    case 'ring': shapeDef.radius = size; shapeDef.width = size * 0.18; break;
    case 'sphere': case 'circle': shapeDef.radius = size * 0.7; break;
    case 'slash': shapeDef.radius = size; shapeDef.angleDeg = 100 + clamp01(sig.aggression) * 80; shapeDef.tiltDeg = 20; break;
    case 'line': shapeDef.length = size * 2.5; break;
    case 'ribbon': shapeDef.length = size * 2.5; shapeDef.waveAmp = 0.2 + sig.elongation * 0.3; shapeDef.cycles = 2; break;
    case 'arc': shapeDef.radius = size; shapeDef.angleDeg = 120; break;
    case 'spiral': shapeDef.radius = size * 0.7; shapeDef.turns = 2 + sig.bigness * 2; shapeDef.height = size * 0.6; break;
    case 'lightning': shapeDef.length = size * 2; shapeDef.jag = 0.6 + clamp01(sig.aggression) * 1.2; shapeDef.segments = 9; shapeDef.seed = style.hueSeed; break;
    case 'wave': shapeDef.length = size * 2.5; shapeDef.amplitude = 0.3 + sig.bigness * 0.3; shapeDef.cycles = 2; break;
    default: break;
  }
  layer.props.shape = shapeDef;
  layer.props.emissive = true;
  layer.props.opacity = 0.8;
  layer.props.scale = 1;
  layer.props.thickness = 0.1 + sig.bigness * 0.08;
  return layer;
}

function buildLightLayer(family, sig) {
  const layer = newLayer('light', 'Glow');
  layer.props.intensity = Math.round((1 + sig.bigness * 1.5) * 10) / 10;
  layer.props.range = Math.round((6 + sig.bigness * 10) * 10) / 10;
  return layer;
}

// ---------------------------------------------------------------- composition assembly
// The one function that actually builds a doc's layer array. Called fresh every time — nothing
// here is ever read from a stored, named table. `style = { shapeChoice, motionStyle, complexity,
// hueSeed }` (complexity 1..4: 1=core only, 2=+accent, 3=+shape, 4=+light).
export function synthesizeComposition(features, sig, style) {
  const family = formFamilyOf(features);
  const layers = [buildCoreEmitter(family, sig, style)];
  if (style.complexity >= 2) {
    // A small deterministic offset (not derived from real branch positions — synthesizeComposition
    // only sees the reduced `features`, not raw strokes) keeps interpretDensity's multi-emitter
    // spatial weighting meaningful rather than degenerate (two emitters at the exact same point).
    const spread = 0.4 + sig.bigness * 0.6;
    layers.push(buildAccentEmitter(family, sig, style, [spread, spread * 0.4, 0]));
  }
  if (style.complexity >= 3) {
    const shapeLayer = buildShapeLayer(family, sig, style);
    if (shapeLayer) layers.push(shapeLayer);
  }
  if (style.complexity >= 4) {
    layers.push(buildLightLayer(family, sig));
  }
  // Fixed default duration, matching the typical archetype default — sketchCandidates.js's
  // existing applyGeometryNudges()/rescaleTiming() already resizes the WHOLE doc (duration, every
  // clip, every curve key) from the sketch's own totalLength right after this returns; computing
  // a length-driven duration here too would double-count that exact signal.
  const duration = 60;
  // newLayer() defaults every clip to {start:0, len:60, loop:false} — already correct for this
  // fixed duration, but set explicitly (not left implicit) so every layer's clip.len is exactly
  // in sync with doc.duration before rescaleTiming ever multiplies both by the same factor.
  for (const layer of layers) layer.clip = { start: 0, len: duration, loop: true };
  const raw = { version: 2, name: 'Sketch Composition', fps: 30, duration, loop: true, layers };
  // Route through the canonical parse pass even though newLayer() already produced well-formed
  // layers — same "always validate through the one true path" convention buildArchetypeDoc uses,
  // and it's what mints a fresh top-level id.
  const parsed = parseEffect(raw);
  if (!parsed.ok) throw new Error(`synthesizeComposition produced an unparseable doc: ${parsed.error}`);
  return parsed.doc;
}

// Small procedural name/icon combinations — family + motion, never a borrowed finished-effect
// name. Purely cosmetic labeling for the gallery card.
const FAMILY_LABEL = { radial: 'Radial', linear: 'Linear', spiral: 'Spiral', jagged: 'Jagged', ambient: 'Ambient' };
const MOTION_LABEL = { orbit: 'Orbit', burst: 'Burst', cone: 'Cone', rise: 'Rise', fall: 'Fall', ambient: 'Drift' };
const FAMILY_ICON = { radial: '🌀', linear: '⚡', spiral: '🌪️', jagged: '⚡', ambient: '✨' };
export function nameFor(family, motionStyle) {
  return `${FAMILY_LABEL[family] || 'Sketch'} ${MOTION_LABEL[motionStyle] || 'Effect'}`;
}
export function iconFor(family) {
  return FAMILY_ICON[family] || '✨';
}
