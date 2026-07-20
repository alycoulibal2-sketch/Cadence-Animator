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
