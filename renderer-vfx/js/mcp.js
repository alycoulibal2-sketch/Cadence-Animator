// Studio-side MCP command handlers. Claude drives this window through the same pipe pattern the
// animator uses (main process relays vfx_* commands over IPC; see src/main.js). The design rule
// every handler follows: a WRITE returns the read-back — the new effect summary plus a fresh
// validation pass — so a caller never has to assume a mutation landed or guess what it broke.

import * as ST from './studioState.js';
import {
  getLayer, getModifier, newLayer, addLayer, removeLayer, duplicateLayer, moveLayer, setClip,
  setLayerProps, setCurveKey, clearCurve, addModifier, removeModifier,
  parseEffect, serializeEffect, effectSummary, newEffect,
  LAYER_TYPES, MODIFIER_TYPES,
} from '../../renderer/js/effectModel.js';
import { runValidation, applyAutoFixes } from '../../renderer/js/diagnostics.js';
import { performanceReport, layerExportFidelity } from '../../renderer/js/effectValidators.js';
import { buildEffectLua } from '../../renderer/js/effectExport.js';
import { buildArchetypeDoc, searchEffectArchetypes, EFFECT_THEMES, EFFECT_SCALES } from '../../renderer/js/effectLibrary.js';
import { searchPresets } from '../../renderer/js/particleLibrary.js';
import { checkExpr } from '../../renderer/js/expr.js';
import { scrubAndSettle } from './preview.js';
import { analyzeSketchStrokes } from '../../renderer/js/sketchGeometry.js';
import { generateCandidatesProgressive, rankCandidates } from '../../renderer/js/sketchCandidates.js';

// The uniform write-result: what changed + whether the doc is still healthy. `diagnostics`
// carries errors/warnings only (info noise stays out of tool results; vfx_validate returns all).
function writeResult(extra = {}) {
  const report = ST.validateNow('effect');
  return {
    ok: true,
    effect: effectSummary(ST.state.doc),
    diagnostics: report.diagnostics.filter((d) => d.severity === 'error' || d.severity === 'warning'),
    counts: report.counts,
    blockedForExport: report.blockedForExport,
    ...extra,
  };
}

function requireLayer(layerId) {
  const layer = getLayer(ST.state.doc, layerId);
  if (!layer) throw new Error(`No layer with id ${layerId}. Call vfx_get_effect to see the current layers — the document may have changed since you last read it.`);
  return layer;
}

const HANDLERS = {
  vfx_get_state() {
    const report = ST.state.lastReport;
    return {
      effect: effectSummary(ST.state.doc),
      playhead: Math.floor(ST.state.playhead),
      playing: ST.state.playing,
      selectedLayerId: ST.state.selection.layerId,
      advancedMode: ST.state.advanced,
      soloLayerIds: [...ST.state.solo],
      undo: ST.undoDepths(),
      diagnosticCounts: report?.counts || null,
      layerTypes: Object.fromEntries(Object.entries(LAYER_TYPES).map(([k, v]) => [k, v.label])),
      modifierTypes: Object.fromEntries(Object.entries(MODIFIER_TYPES).map(([k, v]) => [k, { label: v.label, appliesTo: v.appliesTo, exportMode: v.exportMode }])),
    };
  },
  vfx_get_effect() {
    return { effect: JSON.parse(serializeEffect(ST.state.doc)) };
  },
  vfx_set_effect({ effect }) {
    const parsed = parseEffect(effect);
    if (!parsed.ok) throw new Error(`Effect rejected: ${parsed.error}`);
    ST.pushUndo();
    ST.setDoc(parsed.doc);
    return writeResult();
  },
  vfx_new_effect({ name, duration, fps } = {}) {
    ST.pushUndo();
    const doc = newEffect(name || 'Untitled Effect');
    if (Number.isFinite(duration)) doc.duration = Math.max(1, Math.round(duration));
    if (Number.isFinite(fps)) doc.fps = Math.max(1, Math.min(120, Math.round(fps)));
    const layer = addLayer(doc, newLayer('emitter', 'Particles'));
    layer.clip.len = doc.duration;
    ST.setDoc(doc);
    return writeResult({ createdLayerId: layer.id });
  },
  vfx_set_effect_props({ name, duration, fps, loop } = {}) {
    return ST.mutate((doc) => {
      if (typeof name === 'string' && name.trim()) doc.name = name.trim();
      if (Number.isFinite(duration)) {
        doc.duration = Math.max(1, Math.min(100000, Math.round(duration)));
        for (const l of doc.layers) setClip(l, {}, doc.duration);
      }
      if (Number.isFinite(fps)) doc.fps = Math.max(1, Math.min(120, Math.round(fps)));
      if (typeof loop === 'boolean') doc.loop = loop;
      return writeResult();
    });
  },
  vfx_add_layer({ type, name, clip, props } = {}) {
    if (!LAYER_TYPES[type]) throw new Error(`Unknown layer type "${type}". Valid: ${Object.keys(LAYER_TYPES).join(', ')}`);
    return ST.mutate((doc) => {
      const layer = addLayer(doc, newLayer(type, name));
      layer.clip.len = doc.duration;
      if (clip) setClip(layer, clip, doc.duration);
      if (props) setLayerProps(layer, props);
      ST.select(layer.id);
      return writeResult({ createdLayerId: layer.id });
    });
  },
  vfx_update_layer({ layerId, name, enabled, props } = {}) {
    return ST.mutate(() => {
      const layer = requireLayer(layerId);
      if (typeof name === 'string' && name.trim()) layer.name = name.trim();
      if (typeof enabled === 'boolean') layer.enabled = enabled;
      if (props) setLayerProps(layer, props);
      return writeResult({ exportFidelity: layerExportFidelity(layer) });
    });
  },
  vfx_remove_layer({ layerId }) {
    return ST.mutate((doc) => {
      requireLayer(layerId);
      removeLayer(doc, layerId);
      return writeResult();
    });
  },
  vfx_duplicate_layer({ layerId }) {
    return ST.mutate((doc) => {
      requireLayer(layerId);
      const copy = duplicateLayer(doc, layerId);
      return writeResult({ createdLayerId: copy.id });
    });
  },
  vfx_reorder_layer({ layerId, index }) {
    return ST.mutate((doc) => {
      requireLayer(layerId);
      moveLayer(doc, layerId, Math.round(index));
      return writeResult();
    });
  },
  vfx_set_clip({ layerId, start, len, loop } = {}) {
    return ST.mutate((doc) => {
      const layer = requireLayer(layerId);
      const patch = {};
      if (Number.isFinite(start)) patch.start = start;
      if (Number.isFinite(len)) patch.len = len;
      setClip(layer, patch, doc.duration);
      if (typeof loop === 'boolean') layer.clip.loop = loop;
      return writeResult({ clip: { ...layer.clip } });
    });
  },
  vfx_get_curve({ layerId, prop }) {
    const layer = requireLayer(layerId);
    return { prop, keys: layer.curves[prop] || [], expression: layer.exprs?.[prop] || null, baseValue: layer.props[prop] ?? null };
  },
  vfx_set_curve({ layerId, prop, keys }) {
    if (!Array.isArray(keys)) throw new Error('keys must be an array of { t, v, es?, ed?, bez? }');
    return ST.mutate(() => {
      const layer = requireLayer(layerId);
      clearCurve(layer, prop);
      for (const k of keys) {
        if (!Number.isFinite(k.t) || !(Number.isFinite(k.v) || typeof k.v === 'string')) continue;
        setCurveKey(layer, prop, k.t, k.v, { es: k.es, ed: k.ed, bez: Array.isArray(k.bez) && k.bez.length === 4 ? k.bez : undefined });
      }
      return writeResult({ keyCount: (layer.curves[prop] || []).length });
    });
  },
  vfx_delete_curve({ layerId, prop }) {
    return ST.mutate(() => {
      const layer = requireLayer(layerId);
      const had = clearCurve(layer, prop);
      return writeResult({ removed: had });
    });
  },
  vfx_set_expression({ layerId, prop, expression }) {
    if (expression) {
      const problem = checkExpr(expression);
      if (problem) throw new Error(`Expression rejected: ${problem}. Nothing was changed.`);
    }
    return ST.mutate(() => {
      const layer = requireLayer(layerId);
      if (expression) layer.exprs[prop] = expression;
      else delete layer.exprs[prop];
      return writeResult();
    });
  },
  vfx_add_modifier({ layerId, type, props } = {}) {
    return ST.mutate(() => {
      const layer = requireLayer(layerId);
      const mod = addModifier(layer, type);
      if (props) Object.assign(mod.props, props);
      return writeResult({ createdModifierId: mod.id, exportMode: MODIFIER_TYPES[type].exportMode });
    });
  },
  vfx_update_modifier({ layerId, modifierId, enabled, props } = {}) {
    return ST.mutate(() => {
      const layer = requireLayer(layerId);
      const mod = getModifier(layer, modifierId);
      if (!mod) throw new Error(`No modifier ${modifierId} on that layer`);
      if (typeof enabled === 'boolean') mod.enabled = enabled;
      if (props) Object.assign(mod.props, props);
      return writeResult();
    });
  },
  vfx_remove_modifier({ layerId, modifierId }) {
    return ST.mutate(() => {
      const layer = requireLayer(layerId);
      if (!removeModifier(layer, modifierId)) throw new Error(`No modifier ${modifierId} on that layer`);
      return writeResult();
    });
  },
  vfx_list_presets({ query, category, kind } = {}) {
    if (kind === 'particles') {
      return { presets: searchPresets(query, category).slice(0, 60).map((p) => ({ id: p.id, name: p.name, category: p.category })) };
    }
    return {
      archetypes: searchEffectArchetypes(query, category).map((a) => ({ key: a.key, name: a.name, category: a.category, description: a.description })),
      themes: EFFECT_THEMES.map((t) => t.key),
      scales: EFFECT_SCALES.map((s) => ({ key: s.key, factor: s.factor })),
    };
  },
  vfx_apply_preset({ key, theme, scale, mode } = {}) {
    const doc = buildArchetypeDoc(key, { theme: theme || 'classic', scale: scale ?? 1 });
    if (!doc) throw new Error(`Unknown archetype "${key}" — call vfx_list_presets first.`);
    if (mode === 'add') {
      return ST.mutate((cur) => {
        for (const layer of doc.layers) {
          setClip(layer, {}, cur.duration);
          cur.layers.push(layer);
        }
        return writeResult({ addedLayers: doc.layers.length });
      });
    }
    ST.pushUndo();
    ST.setDoc(doc);
    return writeResult({ applied: key });
  },
  async vfx_scrub({ frame }) {
    const settled = await scrubAndSettle(Math.max(0, Math.round(frame)));
    return { ok: true, frame: settled.frame };
  },
  // The main process calls this before capturePage for vfx_render_frame — the double-rAF settle
  // keeps the screenshot from racing three.js's paint (the animator's documented race).
  async vfx_scrub_settle({ frame }) {
    return scrubAndSettle(Math.max(0, Math.round(frame)));
  },
  vfx_validate({ scope } = {}) {
    return runValidation(scope === 'export' ? 'export' : 'effect', { effect: ST.state.doc });
  },
  vfx_auto_fix({ ids, includeUnsafe } = {}) {
    return ST.mutate((doc) => {
      const before = runValidation('effect', { effect: doc });
      const { applied, skipped } = applyAutoFixes({ effect: doc }, before.diagnostics, {
        onlyIds: Array.isArray(ids) && ids.length ? ids : null,
        includeUnsafe: !!includeUnsafe,
      });
      const after = runValidation('effect', { effect: doc });
      return { ok: true, applied, skipped, before: before.counts, after: after.counts, effect: effectSummary(doc) };
    });
  },
  vfx_performance_report() {
    return performanceReport(ST.state.doc);
  },
  vfx_export_luau() {
    const report = runValidation('effect', { effect: ST.state.doc });
    if (report.blockedForExport) {
      throw new Error(`Export blocked by ${report.counts.error} error(s): ${report.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.id} ${d.message}`).join(' | ')} — fix them (vfx_auto_fix handles most) and retry.`);
    }
    const { lua, notes } = buildEffectLua(ST.state.doc);
    const exportReport = runValidation('export', { effect: ST.state.doc });
    return { lua, notes, fidelityDiagnostics: exportReport.diagnostics };
  },
  vfx_send_to_animator() {
    const report = runValidation('effect', { effect: ST.state.doc });
    if (report.blockedForExport) {
      throw new Error(`Send blocked by ${report.counts.error} error(s) — run vfx_validate for details, vfx_auto_fix to repair.`);
    }
    window.vfxStudio.sendToAnimator({ effect: JSON.parse(serializeEffect(ST.state.doc)) });
    return { ok: true, sent: ST.state.doc.name };
  },
  vfx_select_layer({ layerId }) {
    requireLayer(layerId);
    ST.select(layerId);
    return { ok: true };
  },
  // Test-only hook for the smoketest, deliberately NOT registered as a real tool in
  // mcp-server/index.js's zod schemas — SKETCH IT is a human drawing workflow, not something an
  // MCP client should invoke, but the pipeline underneath it (analyze -> generate -> validate)
  // is exactly the kind of pure logic this codebase always gets scripted regression coverage
  // for. Runs the real provider against real strokes and checks every candidate it produces
  // against the SAME validator the studio itself gates export/send on.
  async vfx_sketch_test_pipeline({ strokes } = {}) {
    if (!Array.isArray(strokes) || !strokes.length) throw new Error('strokes must be a non-empty array of { points: [{x,y,p,t}] }');
    const features = analyzeSketchStrokes(strokes);
    const candidates = await generateCandidatesProgressive(features, { count: 30 });
    const invalid = [];
    for (const c of candidates) {
      const parsed = parseEffect(c.doc);
      if (!parsed.ok) { invalid.push({ id: c.id, reason: parsed.error }); continue; }
      const report = runValidation('effect', { effect: parsed.doc });
      if (report.counts.error > 0) invalid.push({ id: c.id, reason: report.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message).join('; ') });
    }
    const ranked = rankCandidates(candidates);
    return {
      ok: true,
      features,
      candidateCount: candidates.length,
      invalidCount: invalid.length,
      invalid: invalid.slice(0, 5),
      bestMatch: ranked.best ? { name: ranked.best.name, archetypeKey: ranked.best.archetypeKey, confidence: ranked.best.confidence } : null,
      goodCount: ranked.good.length,
      moreCount: ranked.more.length,
    };
  },
  vfx_undo() {
    if (!ST.undo()) throw new Error('Nothing to undo');
    return writeResult();
  },
  vfx_redo() {
    if (!ST.redo()) throw new Error('Nothing to redo');
    return writeResult();
  },
};

export function initStudioMcp() {
  window.vfxStudio.onMcpCommand(async ({ id, type, payload }) => {
    const handler = HANDLERS[type];
    try {
      if (!handler) throw new Error(`Unknown VFX Studio command "${type}"`);
      const data = await handler(payload || {});
      window.vfxStudio.mcpResponse({ id, ok: true, data });
    } catch (e) {
      window.vfxStudio.mcpResponse({ id, ok: false, error: e.message });
    }
  });
}
