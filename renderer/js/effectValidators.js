// The shared effect validator pack: every structural, visual, curve, expression, performance,
// and Roblox-export check that can run on an effect document alone. State-free by design — both
// windows (and the smoketest) import and register it. Animation validators live elsewhere (they
// need state.js). Import this module for its side effect: it registers everything on load.
//
// Diagnostic id ranges (stable — tools and tests key on them):
//   VFX-Exxx  structural/visual errors (block export)
//   VFX-Wxxx  warnings                 EXP-Wxxx / EXP-Ixxx  Roblox export fidelity
//   VFX-Sxxx  suggestions              PERF-xxx  performance
//   VFX-Ixxx  notes

import { registerValidator, registerAutoFix, diag } from './diagnostics.js';
import { LAYER_TYPES, MODIFIER_TYPES, getLayer, evalCurve, setClip } from './effectModel.js';
import { scanEffect } from './effectEngine.js';
import { checkExpr } from './expr.js';
import { SHAPE_KINDS } from './effectShapes.js';
import { sanitizeRamp } from './rampEval.js';

const tgt = (layer, extra = {}) => ({ layerId: layer.id, layerName: layer.name, ...extra });

// Max numeric value a prop reaches over base + curve (ignores expressions — checkExpr covers
// those separately; an expression's range is unknowable statically).
function propMax(layer, prop) {
  const base = typeof layer.props[prop] === 'number' ? layer.props[prop] : 0;
  const keys = layer.curves[prop];
  if (!keys || !keys.length) return base;
  return Math.max(...keys.map((k) => (typeof k.v === 'number' ? k.v : base)));
}
function propAlwaysZero(layer, prop) {
  const keys = layer.curves[prop];
  if (keys && keys.length) return keys.every((k) => k.v === 0);
  return (layer.props[prop] ?? 0) === 0;
}

// ---------------------------------------------------------------- structural errors
registerValidator({
  id: 'vfx-structure', category: 'vfx', scopes: ['effect', 'export', 'project'],
  run({ effect }) {
    const out = [];
    if (!effect) return out;
    if (!effect.layers.length) {
      out.push(diag('VFX-I001', 'info', 'The effect has no layers yet.', { confidence: 1 }));
    }
    for (const layer of effect.layers) {
      if (layer.clip.len <= 0) {
        out.push(diag('VFX-E001', 'error', `Layer "${layer.name}" has a zero/negative clip length.`, {
          target: tgt(layer), frame: layer.clip.start,
          causes: ['a clip resized to nothing', 'a hand-edited or tool-written document'],
          fix: { autoFixId: 'fix-clip-length', label: 'Set clip length to 1 frame', safe: true },
        }));
      }
      if (layer.clip.start >= effect.duration) {
        out.push(diag('VFX-E002', 'error', `Layer "${layer.name}" starts at frame ${layer.clip.start}, past the effect's end (${effect.duration} frames) — it can never play.`, {
          target: tgt(layer), frame: effect.duration - 1,
          causes: ['the effect was shortened after this clip was placed'],
          fix: { autoFixId: 'fix-clip-pull-in', label: 'Pull the clip back inside the effect', safe: true },
        }));
      } else if (!layer.clip.loop && layer.clip.start + layer.clip.len > effect.duration) {
        out.push(diag('VFX-S001', 'suggestion', `Layer "${layer.name}"'s clip runs ${layer.clip.start + layer.clip.len - effect.duration} frame(s) past the effect's end — the tail is never previewed.`, {
          target: tgt(layer), frame: effect.duration - 1,
          fix: { autoFixId: 'fix-clip-pull-in', label: 'Trim the clip to the effect length', safe: true },
        }));
      }
      if (!layer.enabled) {
        out.push(diag('VFX-I002', 'info', `Layer "${layer.name}" is disabled — it is skipped by preview AND export.`, { target: tgt(layer), confidence: 1 }));
      }
    }
    return out;
  },
});

// ---------------------------------------------------------------- curve integrity
registerValidator({
  id: 'vfx-curves', category: 'curves', scopes: ['effect', 'export', 'project'],
  run({ effect }) {
    const out = [];
    if (!effect) return out;
    for (const layer of effect.layers) {
      const modIds = new Set(layer.modifiers.map((m) => m.id));
      for (const [prop, keys] of Object.entries(layer.curves)) {
        // Orphaned modifier tracks (only reachable via hand-edited/MCP-written docs — the UI
        // deletes them transactionally with the modifier).
        if (prop.startsWith('mod:')) {
          const modId = prop.split(':')[1];
          if (!modIds.has(modId)) {
            out.push(diag('VFX-W010', 'warning', `Layer "${layer.name}" has curve keys for a modifier that no longer exists (${prop}).`, {
              target: tgt(layer, { prop }),
              causes: ['a modifier deleted by an external tool without cleaning its curves'],
              fix: { autoFixId: 'fix-drop-curve', label: 'Delete the orphaned curve', safe: true },
            }));
            continue;
          }
        }
        const seen = new Set();
        for (const k of keys) {
          if (!Number.isFinite(k.t) || (typeof k.v === 'number' && !Number.isFinite(k.v))) {
            out.push(diag('VFX-E010', 'error', `Layer "${layer.name}" has a corrupted ${prop} key (non-finite time or value).`, {
              target: tgt(layer, { prop }), frame: layer.clip.start + (Number.isFinite(k.t) ? k.t : 0),
              fix: { autoFixId: 'fix-drop-bad-keys', label: 'Remove corrupted keys', safe: true },
            }));
          }
          if (seen.has(k.t)) {
            out.push(diag('VFX-E011', 'error', `Layer "${layer.name}" has two ${prop} keys at the same frame (${k.t}).`, {
              target: tgt(layer, { prop }), frame: layer.clip.start + k.t,
              fix: { autoFixId: 'fix-dedupe-keys', label: 'Keep the last key at each frame', safe: true },
            }));
          }
          seen.add(k.t);
          if (k.t >= layer.clip.len) {
            out.push(diag('VFX-W011', 'warning', `Layer "${layer.name}" has ${prop} keys past its clip end (frame ${k.t} ≥ length ${layer.clip.len}) — they never evaluate until the clip is lengthened.`, {
              target: tgt(layer, { prop }), frame: layer.clip.start + layer.clip.len - 1,
              causes: ['the clip was shortened after these keys were placed'],
              fix: { autoFixId: 'fix-drop-out-of-window-keys', label: 'Delete keys beyond the clip', safe: false },
            }));
            break; // one per curve is enough
          }
        }
      }
      for (const [prop, src] of Object.entries(layer.exprs || {})) {
        const problem = checkExpr(src);
        if (problem) {
          out.push(diag('VFX-E020', 'error', `Layer "${layer.name}"'s ${prop} expression is broken (${problem}) — the preview silently falls back to the curve/base value.`, {
            target: tgt(layer, { prop }),
            causes: ['a typo in the expression', 'an unknown variable or function name'],
            fix: { autoFixId: 'fix-drop-expr', label: 'Remove the broken expression', safe: false },
          }));
        }
      }
    }
    return out;
  },
});

// ---------------------------------------------------------------- ramps
// parseEffect() sanitizes colorRamp/densityRamp on the way in, but a generic prop write
// (setLayerProps/an MCP set_property call) doesn't run that sanitizer — this is the safety net
// for a ramp that reached a bad shape by some path other than the normal editor/parse flow.
registerValidator({
  id: 'vfx-ramps', category: 'vfx', scopes: ['effect', 'export', 'project'],
  run({ effect }) {
    const out = [];
    if (!effect) return out;
    for (const layer of effect.layers) {
      if (layer.type !== 'emitter') continue;
      for (const prop of ['colorRamp', 'densityRamp']) {
        const stops = layer.props[prop];
        if (!Array.isArray(stops) || !stops.length) continue;
        if (stops.length === 1) {
          out.push(diag('VFX-S010', 'suggestion', `Layer "${layer.name}"'s ${prop} has only one stop — it can never vary; add a second stop or clear it.`, {
            target: tgt(layer, { prop }), frame: layer.clip.start,
          }));
          continue;
        }
        const us = stops.map((s) => s.u);
        const sorted = us.every((u, i) => i === 0 || u >= us[i - 1]);
        const dupes = new Set(us).size !== us.length;
        const badRange = stops[0].u !== 0 || stops[stops.length - 1].u !== 1;
        if (!sorted || dupes || badRange) {
          out.push(diag('VFX-E030', 'error', `Layer "${layer.name}"'s ${prop} stops must be sorted, unique, and span exactly u=0..1 to export to Roblox — these were written outside the normal editor path.`, {
            target: tgt(layer, { prop }), frame: layer.clip.start,
            causes: ['a raw MCP set_property call bypassing the ramp editor'],
            fix: { autoFixId: 'fix-ramp-sanitize', label: 'Re-sort and clamp the ramp', safe: true },
          }));
        }
      }
    }
    return out;
  },
});

// ---------------------------------------------------------------- visibility / emptiness
registerValidator({
  id: 'vfx-visibility', category: 'vfx', scopes: ['effect', 'export', 'project'],
  run({ effect }) {
    const out = [];
    if (!effect) return out;
    for (const layer of effect.layers) {
      if (!layer.enabled) continue;
      if (layer.type === 'emitter') {
        const p = layer.props;
        if (propAlwaysZero(layer, 'rate') && !(p.burst > 0)) {
          out.push(diag('VFX-W001', 'warning', `Emitter "${layer.name}" never emits: rate is 0 everywhere and burst is 0.`, {
            target: tgt(layer), frame: layer.clip.start,
            causes: ['rate keyed to zero', 'a placeholder layer that was never filled in'],
          }));
        }
        if ((p.lifetime ?? 0) < 0.05 && !layer.curves.lifetime) {
          out.push(diag('VFX-E003', 'error', `Emitter "${layer.name}" has a ~zero lifetime — particles die the frame they spawn.`, {
            target: tgt(layer), frame: layer.clip.start,
            fix: { autoFixId: 'fix-min-lifetime', label: 'Raise lifetime to 0.3s', safe: true },
          }));
        }
        if ((p.transparencyStart ?? 0) >= 1 && (p.transparencyEnd ?? 1) >= 1) {
          out.push(diag('VFX-E004', 'error', `Emitter "${layer.name}" is fully transparent for its whole particle life — invisible by construction.`, {
            target: tgt(layer), frame: layer.clip.start,
            causes: ['both transparency sliders left at 1'],
            fix: { autoFixId: 'fix-visible-transparency', label: 'Reset start transparency to 0', safe: true },
          }));
        }
        const cap = p.maxParticles || 150;
        const needed = Math.round(propMax(layer, 'rate') * propMax(layer, 'lifetime') * 1.2 + (p.burst || 0));
        if (needed > cap * 1.5 && needed > 20) {
          out.push(diag('VFX-W002', 'warning', `Emitter "${layer.name}" wants ~${needed} live particles but its pool cap is ${cap} — the oldest particles will vanish early.`, {
            target: tgt(layer), frame: layer.clip.start,
            causes: ['rate × lifetime grew past the pool size'],
            fix: { autoFixId: 'fix-resize-pool', label: `Resize pool to ${Math.min(2000, needed)}`, safe: true },
          }));
        }
        if (p.emissionShape && !SHAPE_KINDS[p.emissionShape.kind]) {
          out.push(diag('VFX-E005', 'error', `Emitter "${layer.name}" references an unknown emission shape "${p.emissionShape.kind}".`, {
            target: tgt(layer),
            fix: { autoFixId: 'fix-drop-emission-shape', label: 'Emit from the origin point instead', safe: true },
          }));
        }
      } else if (layer.type === 'shape') {
        if (propAlwaysZero(layer, 'opacity')) {
          out.push(diag('VFX-W003', 'warning', `Shape "${layer.name}" has opacity 0 for its whole clip — it renders nothing.`, {
            target: tgt(layer), frame: layer.clip.start,
          }));
        }
        if (layer.props.shape && !SHAPE_KINDS[layer.props.shape.kind]) {
          out.push(diag('VFX-E006', 'error', `Shape "${layer.name}" references an unknown base shape "${layer.props.shape.kind}".`, { target: tgt(layer) }));
        }
      } else if (layer.type === 'light') {
        if (propAlwaysZero(layer, 'intensity')) {
          out.push(diag('VFX-W004', 'warning', `Light "${layer.name}" has intensity 0 for its whole clip.`, { target: tgt(layer), frame: layer.clip.start }));
        }
      } else if (layer.type === 'screen') {
        if (propAlwaysZero(layer, 'opacity')) {
          out.push(diag('VFX-W005', 'warning', `Screen effect "${layer.name}" has opacity 0 for its whole clip.`, { target: tgt(layer), frame: layer.clip.start }));
        }
        if (layer.props.kind === 'flash' && (layer.props.opacity ?? 0) > 0.85 && layer.clip.len / (effect.fps || 30) > 0.5 && !layer.curves.opacity) {
          out.push(diag('VFX-S002', 'suggestion', `Screen flash "${layer.name}" holds at near-full opacity for ${(layer.clip.len / (effect.fps || 30)).toFixed(1)}s — flashes read best under ~0.3s (and long bright flashes are hard on photosensitive players).`, {
            target: tgt(layer), frame: layer.clip.start, confidence: 0.7,
          }));
        }
      } else if (layer.type === 'sound') {
        if (!layer.props.soundId) {
          out.push(diag('VFX-W006', 'warning', `Sound "${layer.name}" has no Roblox sound id — it exports as silence.`, {
            target: tgt(layer), frame: layer.clip.start,
            causes: ['the sound id field was left empty'],
          }));
        }
        out.push(diag('VFX-I003', 'info', `Sound "${layer.name}" is export-only: the studio never plays audio (its sandbox cannot fetch Roblox assets).`, {
          target: tgt(layer), confidence: 1,
        }));
      } else if (layer.type === 'shake') {
        if (propMax(layer, 'amplitude') > 2) {
          out.push(diag('VFX-S003', 'suggestion', `Camera shake "${layer.name}" peaks at ${propMax(layer, 'amplitude').toFixed(1)} studs — above ~2 it reads as a glitch, not an impact.`, {
            target: tgt(layer), frame: layer.clip.start, confidence: 0.7,
          }));
        }
      }
      for (const mod of layer.modifiers) {
        if (!MODIFIER_TYPES[mod.type]) {
          out.push(diag('VFX-E007', 'error', `Layer "${layer.name}" carries an unknown modifier type "${mod.type}".`, {
            target: tgt(layer, { modifierId: mod.id }),
            fix: { autoFixId: 'fix-drop-modifier', label: 'Remove the unknown modifier', safe: true },
          }));
        }
      }
    }
    return out;
  },
});

// ---------------------------------------------------------------- performance
export const PLATFORM_BUDGETS = {
  pc: { particles: 1500, label: 'PC' },
  console: { particles: 800, label: 'Console' },
  mobile: { particles: 400, label: 'Mobile' },
};

// In-game live-particle estimate: Roblox has no maxParticles cap, so the honest density number
// is Σ per-emitter peak(rate) × peak(lifetime) (+ bursts), NOT the preview pool cap.
export function estimateInGameParticles(effect) {
  let total = 0;
  for (const layer of effect.layers) {
    if (!layer.enabled || layer.type !== 'emitter') continue;
    if (layer.clip.start >= effect.duration) continue; // can never play (flagged separately as VFX-E002)
    total += propMax(layer, 'rate') * propMax(layer, 'lifetime') + (layer.props.burst || 0);
  }
  return Math.round(total);
}

export function performanceReport(effect) {
  const scan = scanEffect(effect, { step: Math.max(1, Math.floor(effect.duration / 120)) });
  const inGame = estimateInGameParticles(effect);
  const emitterCount = effect.layers.filter((l) => l.enabled && l.type === 'emitter').length;
  // Export fan-out: polyline emission shapes clone the emitter across ≤12 attachments.
  let exportEmitterInstances = 0;
  for (const layer of effect.layers) {
    if (!layer.enabled || layer.type !== 'emitter') continue;
    const shape = layer.props.emissionShape;
    exportEmitterInstances += shape && !['sphere', 'rect', 'circle', 'ring', 'cylinder', 'point'].includes(shape.kind) ? 12 : 1;
  }
  const platforms = {};
  for (const [key, budget] of Object.entries(PLATFORM_BUDGETS)) {
    const score = Math.max(0, Math.min(100, Math.round(100 - (inGame / budget.particles) * 50)));
    platforms[key] = {
      label: budget.label, budget: budget.particles, score,
      grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D',
    };
  }
  const suggestions = [];
  if (inGame > PLATFORM_BUDGETS.mobile.particles) suggestions.push('Heavy for mobile — consider lower rates or shorter lifetimes for a mobile variant.');
  if (scan.peakLights > 3) suggestions.push(`${scan.peakLights} simultaneous lights — Roblox renders at most a few well; consider merging.`);
  if (exportEmitterInstances > emitterCount * 3) suggestions.push('Path emission shapes fan out into many emitter instances on export — simpler shapes cut instance count.');
  return {
    previewPeakParticles: scan.peakParticles,
    previewPeakFrame: scan.peakFrame,
    previewAvgParticles: scan.avgParticles,
    estimatedInGameParticles: inGame,
    peakLights: scan.peakLights,
    peakScreenLayers: scan.peakScreen,
    emitterCount,
    exportEmitterInstances,
    platforms,
    suggestions,
  };
}

registerValidator({
  id: 'vfx-performance', category: 'performance', scopes: ['effect', 'export', 'project'],
  run({ effect }) {
    const out = [];
    if (!effect || !effect.layers.some((l) => l.enabled && l.type === 'emitter')) return out;
    const inGame = estimateInGameParticles(effect);
    if (inGame > PLATFORM_BUDGETS.pc.particles) {
      out.push(diag('PERF-W001', 'warning', `~${inGame} simultaneous in-game particles at peak — beyond even the PC budget (${PLATFORM_BUDGETS.pc.particles}); Roblox will visibly throttle.`, {
        category: 'performance', confidence: 0.8,
        causes: ['high rate × long lifetime across several emitters'],
      }));
    } else if (inGame > PLATFORM_BUDGETS.mobile.particles) {
      out.push(diag('PERF-S001', 'suggestion', `~${inGame} in-game particles at peak — fine on PC, heavy on mobile (budget ~${PLATFORM_BUDGETS.mobile.particles}).`, {
        category: 'performance', confidence: 0.8,
      }));
    }
    return out;
  },
});

// ---------------------------------------------------------------- Roblox export fidelity
// One brain for "what happens to this feature in Roblox" — the validator, the exporter, and the
// UI badges all read THIS table, so they can never disagree (docs/vfx-studio.md degrade table).
export function layerExportFidelity(layer) {
  const notes = []; // { level: 'approximated' | 'preview-only', what, how }
  if (layer.type === 'emitter') {
    const motion = layer.props.motion || 'cone';
    if (motion === 'orbit' || motion === 'ambient') notes.push({ level: 'approximated', what: `motion "${motion}"`, how: 'exports as slow omnidirectional drift (Roblox particles cannot orbit/jitter per-particle)' });
    if (motion === 'rise' || motion === 'fall') notes.push({ level: 'approximated', what: `motion "${motion}"`, how: 'exports as straight vertical motion — the per-particle sway is dropped' });
    const shape = layer.props.emissionShape;
    if (shape && shape.kind !== 'point') {
      if (['sphere', 'rect', 'circle', 'ring', 'cylinder'].includes(shape.kind)) notes.push({ level: 'approximated', what: `emission shape "${shape.kind}"`, how: 'maps to the nearest Roblox emitter shape (Sphere/Box/Cylinder)' });
      else notes.push({ level: 'approximated', what: `emission shape "${shape.kind}"`, how: 'tessellates into up to 12 point emitters along the path' });
    }
    for (const prop of ['sizeStart', 'sizeEnd', 'gravity']) {
      if (layer.curves[prop]?.length) notes.push({ level: 'preview-only', what: `animated ${prop}`, how: 'exports as its value at clip start (Roblox rewrites would retroactively change live particles)' });
    }
    if (Object.keys(layer.exprs || {}).length) notes.push({ level: 'approximated', what: 'expressions', how: 'baked to per-frame values at export (the math itself is not translated)' });
  } else if (layer.type === 'shape') {
    const kind = layer.props.shape?.kind || 'slash';
    if (['sphere', 'cylinder', 'rect'].includes(kind)) notes.push({ level: 'approximated', what: `shape "${kind}"`, how: 'exports as a glowing Neon part' });
    else if (kind === 'cone') notes.push({ level: 'preview-only', what: 'shape "cone"', how: 'no Roblox equivalent — exports as a Neon ball placeholder' });
    else notes.push({ level: 'approximated', what: `shape "${kind}"`, how: 'exports as a chain of Beams along the path' });
    for (const prop of ['scale', 'rotation']) {
      if (layer.curves[prop]?.length) notes.push({ level: 'preview-only', what: `animated ${prop}`, how: 'exports static at its clip-start value' });
    }
  } else if (layer.type === 'screen') {
    if (layer.props.kind === 'vignette' || layer.props.kind === 'speedlines') notes.push({ level: 'approximated', what: layer.props.kind, how: 'approximated with UI frames in Roblox — the look will differ' });
  }
  for (const mod of layer.modifiers) {
    const meta = MODIFIER_TYPES[mod.type];
    if (!meta || !mod.enabled) continue;
    if (meta.exportMode === 'dropped') notes.push({ level: 'preview-only', what: `modifier "${meta.label}"`, how: 'has no Roblox equivalent — preview only' });
    else if (meta.exportMode === 'approximated') notes.push({ level: 'approximated', what: `modifier "${meta.label}"`, how: 'maps to a nearby Roblox property' });
  }
  const level = notes.some((n) => n.level === 'preview-only') ? 'preview-only'
    : notes.length ? 'approximated' : 'faithful';
  return { level, notes };
}

const ROBLOX_LIMITS = { rate: 500, lifetimeSec: 20, sizeStuds: 10, lightRange: 60 };

registerValidator({
  id: 'vfx-export-fidelity', category: 'export', scopes: ['export'],
  run({ effect }) {
    const out = [];
    if (!effect) return out;
    for (const layer of effect.layers) {
      if (!layer.enabled) continue;
      const fidelity = layerExportFidelity(layer);
      for (const note of fidelity.notes) {
        out.push(diag(note.level === 'preview-only' ? 'EXP-W001' : 'EXP-I001',
          note.level === 'preview-only' ? 'warning' : 'info',
          `"${layer.name}": ${note.what} — ${note.how}.`,
          { category: 'export', target: tgt(layer), confidence: 1 }));
      }
      if (layer.type === 'emitter') {
        if (propMax(layer, 'rate') > ROBLOX_LIMITS.rate) {
          out.push(diag('EXP-W002', 'warning', `"${layer.name}" peaks at ${Math.round(propMax(layer, 'rate'))} particles/sec — Roblox silently clamps Rate to ${ROBLOX_LIMITS.rate}; the in-game effect will be thinner than the preview.`, {
            category: 'export', target: tgt(layer),
          }));
        }
        if (propMax(layer, 'lifetime') > ROBLOX_LIMITS.lifetimeSec) {
          out.push(diag('EXP-W003', 'warning', `"${layer.name}" lifetime exceeds Roblox's ${ROBLOX_LIMITS.lifetimeSec}s clamp.`, { category: 'export', target: tgt(layer) }));
        }
        if (Math.max(propMax(layer, 'sizeStart'), propMax(layer, 'sizeEnd')) > ROBLOX_LIMITS.sizeStuds) {
          out.push(diag('EXP-W004', 'warning', `"${layer.name}" particle size exceeds Roblox's ${ROBLOX_LIMITS.sizeStuds}-stud sequence clamp.`, { category: 'export', target: tgt(layer) }));
        }
      }
      if (layer.type === 'light' && propMax(layer, 'range') > ROBLOX_LIMITS.lightRange) {
        out.push(diag('EXP-W005', 'warning', `"${layer.name}" range exceeds Roblox's ${ROBLOX_LIMITS.lightRange}-stud PointLight clamp.`, { category: 'export', target: tgt(layer) }));
      }
    }
    return out;
  },
});

// ---------------------------------------------------------------- auto-fixes
// Each receives ({ effect }, diagnostic) and mutates the doc; the caller owns undo snapshots.
registerAutoFix({
  id: 'fix-clip-length', label: 'Set clip length to 1 frame',
  apply({ effect }, d) {
    const layer = getLayer(effect, d.target.layerId);
    if (!layer) throw new Error('layer not found');
    setClip(layer, { len: Math.max(1, layer.clip.len) }, effect.duration);
    return `clip length now ${layer.clip.len}`;
  },
});
registerAutoFix({
  id: 'fix-clip-pull-in', label: 'Pull the clip inside the effect',
  apply({ effect }, d) {
    const layer = getLayer(effect, d.target.layerId);
    if (!layer) throw new Error('layer not found');
    setClip(layer, {}, effect.duration); // setClip re-clamps start+len against the duration
    return `clip now ${layer.clip.start}..${layer.clip.start + layer.clip.len}`;
  },
});
registerAutoFix({
  id: 'fix-min-lifetime', label: 'Raise lifetime to 0.3s',
  apply({ effect }, d) {
    const layer = getLayer(effect, d.target.layerId);
    if (!layer) throw new Error('layer not found');
    layer.props.lifetime = Math.max(0.3, layer.props.lifetime || 0);
    return `lifetime now ${layer.props.lifetime}s`;
  },
});
registerAutoFix({
  id: 'fix-visible-transparency', label: 'Reset start transparency to 0',
  apply({ effect }, d) {
    const layer = getLayer(effect, d.target.layerId);
    if (!layer) throw new Error('layer not found');
    layer.props.transparencyStart = 0;
    return 'start transparency now 0';
  },
});
registerAutoFix({
  id: 'fix-ramp-sanitize', label: 'Re-sort and clamp the ramp',
  apply({ effect }, d) {
    const layer = getLayer(effect, d.target.layerId);
    if (!layer) throw new Error('layer not found');
    const prop = d.target.prop;
    layer.props[prop] = sanitizeRamp(layer.props[prop], prop === 'colorRamp' ? 'color' : 'number');
    return `${prop} now ${layer.props[prop].length} clean stop(s)`;
  },
});
registerAutoFix({
  id: 'fix-resize-pool', label: 'Resize the particle pool to fit',
  apply({ effect }, d) {
    const layer = getLayer(effect, d.target.layerId);
    if (!layer) throw new Error('layer not found');
    const needed = Math.round(propMax(layer, 'rate') * propMax(layer, 'lifetime') * 1.2 + (layer.props.burst || 0));
    layer.props.maxParticles = Math.max(1, Math.min(2000, needed));
    return `pool now ${layer.props.maxParticles}`;
  },
});
registerAutoFix({
  id: 'fix-drop-emission-shape', label: 'Emit from the origin point',
  apply({ effect }, d) {
    const layer = getLayer(effect, d.target.layerId);
    if (!layer) throw new Error('layer not found');
    layer.props.emissionShape = null;
    return 'emission shape cleared';
  },
});
registerAutoFix({
  id: 'fix-drop-curve', label: 'Delete the orphaned curve',
  apply({ effect }, d) {
    const layer = getLayer(effect, d.target.layerId);
    if (!layer) throw new Error('layer not found');
    delete layer.curves[d.target.prop];
    delete layer.exprs?.[d.target.prop];
    return `curve "${d.target.prop}" removed`;
  },
});
registerAutoFix({
  id: 'fix-drop-bad-keys', label: 'Remove corrupted keys',
  apply({ effect }, d) {
    const layer = getLayer(effect, d.target.layerId);
    if (!layer) throw new Error('layer not found');
    const keys = layer.curves[d.target.prop] || [];
    const before = keys.length;
    layer.curves[d.target.prop] = keys.filter((k) => Number.isFinite(k.t) && (typeof k.v !== 'number' || Number.isFinite(k.v)));
    if (!layer.curves[d.target.prop].length) delete layer.curves[d.target.prop];
    return `${before - (layer.curves[d.target.prop]?.length || 0)} key(s) removed`;
  },
});
registerAutoFix({
  id: 'fix-dedupe-keys', label: 'Keep the last key at each frame',
  apply({ effect }, d) {
    const layer = getLayer(effect, d.target.layerId);
    if (!layer) throw new Error('layer not found');
    const keys = layer.curves[d.target.prop] || [];
    const byT = new Map();
    for (const k of keys) byT.set(k.t, k); // later wins
    layer.curves[d.target.prop] = [...byT.values()].sort((a, b) => a.t - b.t);
    return `curve now has ${layer.curves[d.target.prop].length} key(s)`;
  },
});
registerAutoFix({
  id: 'fix-drop-out-of-window-keys', label: 'Delete keys beyond the clip', safe: false,
  apply({ effect }, d) {
    const layer = getLayer(effect, d.target.layerId);
    if (!layer) throw new Error('layer not found');
    const keys = layer.curves[d.target.prop] || [];
    const before = keys.length;
    layer.curves[d.target.prop] = keys.filter((k) => k.t < layer.clip.len);
    if (!layer.curves[d.target.prop].length) delete layer.curves[d.target.prop];
    return `${before - (layer.curves[d.target.prop]?.length || 0)} key(s) removed`;
  },
});
registerAutoFix({
  id: 'fix-drop-expr', label: 'Remove the broken expression', safe: false,
  apply({ effect }, d) {
    const layer = getLayer(effect, d.target.layerId);
    if (!layer) throw new Error('layer not found');
    delete layer.exprs[d.target.prop];
    return `expression on "${d.target.prop}" removed`;
  },
});
registerAutoFix({
  id: 'fix-drop-modifier', label: 'Remove the unknown modifier',
  apply({ effect }, d) {
    const layer = getLayer(effect, d.target.layerId);
    if (!layer) throw new Error('layer not found');
    layer.modifiers = layer.modifiers.filter((m) => m.id !== d.target.modifierId);
    return 'modifier removed';
  },
});
