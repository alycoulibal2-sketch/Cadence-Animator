// The inspector: typed property editors generated from LAYER_TYPES/MODIFIER_TYPES metadata.
// Animatable fields show the EVALUATED value at the playhead with a static/curved/expression
// badge; typing into a curved field keys the value at the playhead (never a dead base-value
// write). The DOM is built once per selection/structure change and values update IN PLACE on
// playhead ticks, guarded by document.activeElement — rebuilding per tick would destroy input
// focus mid-typing (both rules from the design review).

import * as ST from './studioState.js';
import {
  getLayer, getModifier, setLayerProps, setClip, setCurveKey, clearCurve, addModifier,
  removeModifier, resolveProp, resolveModParam, propMetaFor,
  LAYER_TYPES, MODIFIER_TYPES, MODIFIER_TYPE_KEYS,
} from '../../renderer/js/effectModel.js';
import { SHAPE_KINDS, SHAPE_KIND_KEYS, defaultShape } from '../../renderer/js/effectShapes.js';
import { layerExportFidelity, performanceReport } from '../../renderer/js/effectValidators.js';
import { showContextMenu, modal } from '../../renderer/js/ui.js';

let body;
let updaters = [];      // per-field in-place refreshers, run on playhead/effect events
let builtSignature = null;

export function initInspector() {
  body = document.getElementById('vfxInspectorBody');
  ST.on('selection', rebuild);
  ST.on('advanced', rebuild);
  ST.on('effect', onEffectChanged);
  ST.on('playhead', refreshValues);
  rebuild();
}

// Structure signature: when it changes (layer swapped, modifier added, curve created...) the DOM
// must rebuild; when only VALUES changed, refresh in place.
function signature() {
  const layer = ST.selectedLayer();
  if (!layer) return `doc|${ST.state.advanced}`;
  return JSON.stringify([
    layer.id, layer.type, ST.state.advanced,
    layer.modifiers.map((m) => m.id + m.type + m.enabled),
    Object.keys(layer.curves).sort(),
    Object.keys(layer.exprs || {}).sort(),
    layer.props.shape?.kind, layer.props.emissionShape?.kind,
    layer.enabled, layer.name,
  ]);
}
function onEffectChanged() {
  if (signature() !== builtSignature) rebuild();
  else refreshValues();
}
function refreshValues() {
  for (const u of updaters) u();
}

function localFrame(layer) {
  const f = Math.floor(ST.state.playhead) - layer.clip.start;
  const { len, loop } = layer.clip;
  if (loop && len > 0) return ((f % len) + len) % len;
  return Math.max(0, Math.min(len, f));
}

// ---------------------------------------------------------------- small DOM helpers (CSP-safe)
function el(tag, className, text) {
  const d = document.createElement(tag);
  if (className) d.className = className;
  if (text !== undefined) d.textContent = text;
  return d;
}
function section(title) {
  const d = el('div', 'insp-section');
  d.appendChild(el('div', 'insp-title', title));
  return d;
}
function row(label, ...inputs) {
  const d = el('div', 'insp-row');
  const l = el('span', 'l', label);
  d.append(l, ...inputs);
  return d;
}
function numInput(value, onCommit, meta = {}) {
  const input = el('input', 'fld');
  input.type = 'number';
  if (meta.step) input.step = meta.step;
  if (meta.min !== undefined) input.min = meta.min;
  if (meta.max !== undefined) input.max = meta.max;
  input.value = round3(value);
  input.addEventListener('change', () => onCommit(parseFloat(input.value) || 0));
  return input;
}
function round3(v) { return typeof v === 'number' ? Math.round(v * 1000) / 1000 : v; }

// ---------------------------------------------------------------- rebuild
function rebuild() {
  builtSignature = signature();
  updaters = [];
  body.innerHTML = '';
  const layer = ST.selectedLayer();
  if (!layer) { buildEffectPanel(); return; }

  // header: type + fidelity
  const meta = LAYER_TYPES[layer.type];
  const head = el('div', 'vfx-insp-head');
  head.appendChild(el('span', 'vfx-insp-headname', `${meta.icon} ${layer.name}`));
  const fid = layerExportFidelity(layer);
  const badge = el('span', `vfx-fid vfx-fid-${fid.level}`, fid.level === 'faithful' ? 'exports faithfully' : fid.level);
  badge.title = fid.notes.map((n) => `• ${n.what}: ${n.how}`).join('\n') || 'Exports to Roblox faithfully';
  head.appendChild(badge);
  body.appendChild(head);

  // clip
  const clip = section('Clip');
  clip.appendChild(row('Start (frame)', numInput(layer.clip.start, (v) => ST.mutate((doc) => setClip(getLayer(doc, layer.id), { start: v }, doc.duration)), { step: 1, min: 0 })));
  clip.appendChild(row('Length (frames)', numInput(layer.clip.len, (v) => ST.mutate((doc) => setClip(getLayer(doc, layer.id), { len: v }, doc.duration)), { step: 1, min: 1 })));
  const loopChk = el('input');
  loopChk.type = 'checkbox';
  loopChk.checked = layer.clip.loop;
  loopChk.addEventListener('change', () => ST.mutate((doc) => { getLayer(doc, layer.id).clip.loop = loopChk.checked; }));
  clip.appendChild(row('Loop to effect end', loopChk));
  body.appendChild(clip);

  // typed props
  const props = section('Properties');
  for (const pm of meta.props) props.appendChild(propRow(layer.id, pm));
  body.appendChild(props);

  // modifiers
  const mods = section('Modifiers');
  for (const mod of layer.modifiers) mods.appendChild(modifierBlock(layer.id, mod.id));
  const addMod = el('button', 'tb-btn vfx-add-mod', '＋ Add modifier');
  addMod.addEventListener('click', (e) => {
    const r = e.target.getBoundingClientRect();
    const options = MODIFIER_TYPE_KEYS.filter((t) => MODIFIER_TYPES[t].appliesTo.includes(layer.type));
    showContextMenu(r.left, r.bottom + 4, options.map((t) => ({
      label: `${MODIFIER_TYPES[t].icon} ${MODIFIER_TYPES[t].label}`,
      run: () => ST.mutate((doc) => addModifier(getLayer(doc, layer.id), t)),
    })));
  });
  mods.appendChild(addMod);
  body.appendChild(mods);
}

// ---------------------------------------------------------------- animatable field machinery
// One factory used by both layer props and modifier params: `track` is the curve/expr key
// ('rate' or 'mod:<id>:amount'), `readEval` gives the playhead-evaluated value, `writeBase`
// writes the static value when the track has no curve.
function animatableField(layerId, track, pm, { readEval, readBase, writeBase }) {
  const wrap = el('div', 'insp-row vfx-anim-row');
  wrap.appendChild(el('span', 'l', pm.label));

  const layerNow = () => getLayer(ST.state.doc, layerId);
  const hasCurve = () => !!(layerNow()?.curves[track]?.length);
  const hasExpr = () => !!(layerNow()?.exprs?.[track]);

  const input = numInput(readEval(), (v) => {
    const layer = layerNow();
    if (!layer) return;
    const clamped = typeof pm.min === 'number' || typeof pm.max === 'number'
      ? Math.min(pm.max ?? Infinity, Math.max(pm.min ?? -Infinity, v)) : v;
    if (hasCurve()) {
      // typing into a curved field keys the value AT THE PLAYHEAD — never a dead base write
      ST.mutate((doc) => setCurveKey(getLayer(doc, layerId), track, localFrame(getLayer(doc, layerId)), clamped));
    } else {
      ST.mutate(() => writeBase(clamped));
    }
  }, pm);

  const badge = el('span', 'vfx-anim-badge');
  const keyBtn = el('button', 'vfx-row-btn', '⏺');
  keyBtn.title = 'Key this value at the playhead';
  keyBtn.addEventListener('click', () => {
    const v = readEval();
    if (typeof v !== 'number') return;
    ST.mutate((doc) => setCurveKey(getLayer(doc, layerId), track, localFrame(getLayer(doc, layerId)), round3(v)));
  });
  const curveBtn = el('button', 'vfx-row-btn', '📈');
  curveBtn.title = 'Open in the curve editor';
  curveBtn.addEventListener('click', () => ST.openCurveEditor(layerId, track));
  const clearBtn = el('button', 'vfx-row-btn', '✕');
  clearBtn.title = 'Remove the curve (back to a static value)';
  clearBtn.addEventListener('click', () => ST.mutate((doc) => clearCurve(getLayer(doc, layerId), track)));

  wrap.append(input, badge, keyBtn, curveBtn, clearBtn);

  let exprInput = null;
  if (ST.state.advanced) {
    const exprRow = el('div', 'insp-row vfx-expr-row');
    exprRow.appendChild(el('span', 'l', 'ƒ'));
    exprInput = el('input', 'fld vfx-expr-input');
    exprInput.type = 'text';
    exprInput.placeholder = 'expression — e.g. value * (1 + 0.3*sin(t*6))';
    exprInput.value = layerNow()?.exprs?.[track] || '';
    exprInput.addEventListener('change', () => {
      const src = exprInput.value.trim();
      ST.mutate((doc) => {
        const l = getLayer(doc, layerId);
        if (!l) return;
        if (src) l.exprs[track] = src;
        else delete l.exprs[track];
      });
    });
    exprRow.appendChild(exprInput);
    const holder = el('div');
    holder.append(wrap, exprRow);
    attachUpdater();
    return holder;
  }
  attachUpdater();
  return wrap;

  function attachUpdater() {
    const update = () => {
      if (!layerNow()) return;
      badge.textContent = hasExpr() ? 'ƒ' : hasCurve() ? '◆' : '—';
      badge.title = hasExpr() ? 'Driven by an expression (advanced mode edits it)'
        : hasCurve() ? 'Animated by a curve — typing keys the value at the playhead'
          : 'Static value';
      badge.className = 'vfx-anim-badge' + (hasExpr() ? ' expr' : hasCurve() ? ' curved' : '');
      clearBtn.classList.toggle('hidden', !hasCurve());
      if (document.activeElement !== input) input.value = round3(readEval());
      if (exprInput && document.activeElement !== exprInput) exprInput.value = layerNow()?.exprs?.[track] || '';
    };
    update();
    updaters.push(update);
  }
}

// ---------------------------------------------------------------- per-kind prop rows
function propRow(layerId, pm) {
  const layerNow = () => getLayer(ST.state.doc, layerId);
  const layer = layerNow();
  const commit = (patch) => ST.mutate((doc) => setLayerProps(getLayer(doc, layerId), patch));

  if (pm.animatable) {
    return animatableField(layerId, pm.key, pm, {
      readEval: () => {
        const l = layerNow();
        return l ? round3(resolveProp(l, pm.key, localFrame(l), ST.state.doc.fps)) : 0;
      },
      writeBase: (v) => setLayerProps(getLayer(ST.state.doc, layerId), { [pm.key]: v }),
    });
  }

  switch (pm.kind) {
    case 'number':
      return withUpdater(row(pm.label, numInput(layer.props[pm.key], (v) => commit({ [pm.key]: v }), pm)),
        (r) => { const i = r.querySelector('input'); if (document.activeElement !== i) i.value = round3(layerNow()?.props[pm.key] ?? 0); });
    case 'range': {
      const input = el('input');
      input.type = 'range';
      input.min = pm.min ?? 0; input.max = pm.max ?? 1; input.step = pm.step ?? 0.01;
      input.value = layer.props[pm.key];
      input.addEventListener('change', () => commit({ [pm.key]: parseFloat(input.value) }));
      return row(pm.label, input);
    }
    case 'color': {
      const input = el('input', 'fld');
      input.type = 'color';
      input.value = layer.props[pm.key] || '#ffffff';
      input.addEventListener('change', () => commit({ [pm.key]: input.value }));
      return row(pm.label, input);
    }
    case 'select': {
      const sel = el('select', 'fld');
      for (const o of pm.options) sel.add(new Option(o, o));
      sel.value = layer.props[pm.key];
      sel.addEventListener('change', () => commit({ [pm.key]: sel.value }));
      return row(pm.label, sel);
    }
    case 'check': {
      const input = el('input');
      input.type = 'checkbox';
      input.checked = !!layer.props[pm.key];
      input.addEventListener('change', () => commit({ [pm.key]: input.checked }));
      return row(pm.label, input);
    }
    case 'text': {
      const input = el('input', 'fld');
      input.type = 'text';
      if (pm.placeholder) input.placeholder = pm.placeholder;
      input.value = layer.props[pm.key] || '';
      input.addEventListener('change', () => commit({ [pm.key]: input.value }));
      return row(pm.label, input);
    }
    case 'vec3': {
      const holder = el('div', 'insp-row');
      holder.appendChild(el('span', 'l', pm.label));
      const triple = el('div', 'vfx-vec3');
      ['x', 'y', 'z'].forEach((axis, i) => {
        const input = numInput(layer.props[pm.key]?.[i] ?? 0, (v) => {
          const cur = [...(layerNow()?.props[pm.key] || [0, 0, 0])];
          cur[i] = v;
          commit({ [pm.key]: cur });
        }, { step: 0.1 });
        input.title = axis;
        triple.appendChild(input);
      });
      holder.appendChild(triple);
      return holder;
    }
    case 'shape':
      return shapeEditor(layerId, pm);
    default:
      return row(pm.label, el('span', 'vfx-dim', String(layer.props[pm.key])));
  }
}

function withUpdater(node, update) {
  updaters.push(() => update(node));
  return node;
}

// Parametric shape editor: kind dropdown + one slider-ish number per param. Custom splines are
// deliberately not offered here (v2 gets a viewport gizmo; a JSON textarea would be worse than
// nothing) — MCP tools may still write spline defs and this editor shows them read-only.
function shapeEditor(layerId, pm) {
  const holder = el('div', 'vfx-shape-editor');
  const layerNow = () => getLayer(ST.state.doc, layerId);
  const current = () => layerNow()?.props[pm.key];

  const kindSel = el('select', 'fld');
  if (pm.optional) kindSel.add(new Option('— none (origin point) —', ''));
  for (const k of SHAPE_KIND_KEYS.filter((k) => k !== 'spline')) kindSel.add(new Option(SHAPE_KINDS[k].label, k));
  const cur = current();
  if (cur?.kind === 'spline') kindSel.add(new Option('Custom spline (via MCP)', 'spline'));
  kindSel.value = cur?.kind || '';
  kindSel.addEventListener('change', () => {
    ST.mutate((doc) => {
      const l = getLayer(doc, layerId);
      l.props[pm.key] = kindSel.value ? defaultShape(kindSel.value) : null;
    });
  });
  holder.appendChild(row(pm.label, kindSel));

  const def = current();
  if (def && SHAPE_KINDS[def.kind]) {
    for (const param of SHAPE_KINDS[def.kind].params) {
      holder.appendChild(row(`· ${param.label}`, numInput(def[param.key] ?? param.def, (v) => {
        ST.mutate((doc) => {
          const l = getLayer(doc, layerId);
          const d = l.props[pm.key];
          if (d) d[param.key] = Math.max(param.min ?? -Infinity, Math.min(param.max ?? Infinity, v));
        });
      }, param)));
    }
  }
  return holder;
}

// ---------------------------------------------------------------- modifiers
function modifierBlock(layerId, modId) {
  const layer = getLayer(ST.state.doc, layerId);
  const mod = getModifier(layer, modId);
  const meta = MODIFIER_TYPES[mod.type];
  const block = el('div', 'vfx-mod-block');

  const head = el('div', 'vfx-mod-head');
  const chk = el('input');
  chk.type = 'checkbox';
  chk.checked = mod.enabled;
  chk.title = 'Enable/disable this modifier';
  chk.addEventListener('change', () => ST.mutate((doc) => {
    const m = getModifier(getLayer(doc, layerId), modId);
    if (m) m.enabled = chk.checked;
  }));
  head.appendChild(chk);
  head.appendChild(el('span', 'vfx-mod-name', `${meta.icon} ${meta.label}`));
  if (meta.exportMode === 'dropped') {
    const tag = el('span', 'vfx-fid vfx-fid-preview-only', 'preview only');
    tag.title = 'This modifier has no Roblox equivalent — it will not export.';
    head.appendChild(tag);
  }
  const del = el('button', 'vfx-row-btn', '🗑');
  del.title = 'Remove modifier (its curves go with it)';
  del.addEventListener('click', () => ST.mutate((doc) => removeModifier(getLayer(doc, layerId), modId)));
  head.appendChild(del);
  block.appendChild(head);

  for (const param of meta.params) {
    if (param.animatable) {
      block.appendChild(animatableField(layerId, `mod:${modId}:${param.key}`, param, {
        readEval: () => {
          const l = getLayer(ST.state.doc, layerId);
          const m = l && getModifier(l, modId);
          return m ? round3(resolveModParam(l, m, param.key, localFrame(l), ST.state.doc.fps)) : 0;
        },
        writeBase: (v) => {
          const m = getModifier(getLayer(ST.state.doc, layerId), modId);
          if (m) m.props[param.key] = v;
        },
      }));
    } else if (param.kind === 'vec3') {
      const triple = el('div', 'vfx-vec3');
      ['x', 'y', 'z'].forEach((axis, i) => {
        const input = numInput(mod.props[param.key]?.[i] ?? 0, (v) => ST.mutate((doc) => {
          const m = getModifier(getLayer(doc, layerId), modId);
          if (m) {
            const cur = [...(m.props[param.key] || [0, 0, 0])];
            cur[i] = v;
            m.props[param.key] = cur;
          }
        }), { step: 0.1 });
        input.title = axis;
        triple.appendChild(input);
      });
      const r = el('div', 'insp-row');
      r.append(el('span', 'l', param.label), triple);
      block.appendChild(r);
    } else {
      block.appendChild(row(param.label, numInput(mod.props[param.key], (v) => ST.mutate((doc) => {
        const m = getModifier(getLayer(doc, layerId), modId);
        if (m) m.props[param.key] = Math.max(param.min ?? -Infinity, Math.min(param.max ?? Infinity, v));
      }), param)));
    }
  }
  return block;
}

// ---------------------------------------------------------------- effect-level panel
function buildEffectPanel() {
  const doc = ST.state.doc;
  const sec = section('Effect');
  const nameIn = el('input', 'fld');
  nameIn.type = 'text';
  nameIn.value = doc.name;
  nameIn.addEventListener('change', () => ST.mutate((d) => { d.name = nameIn.value.trim() || 'Untitled Effect'; }));
  sec.appendChild(row('Name', nameIn));
  sec.appendChild(row('Duration (frames)', numInput(doc.duration, (v) => ST.mutate((d) => {
    d.duration = Math.max(1, Math.min(100000, Math.round(v)));
    for (const l of d.layers) setClip(l, {}, d.duration);
  }), { step: 1, min: 1 })));
  sec.appendChild(row('FPS', numInput(doc.fps, (v) => ST.mutate((d) => { d.fps = Math.max(1, Math.min(120, Math.round(v))); }), { step: 1, min: 1, max: 120 })));
  const loopChk = el('input');
  loopChk.type = 'checkbox';
  loopChk.checked = doc.loop;
  loopChk.addEventListener('change', () => ST.mutate((d) => { d.loop = loopChk.checked; }));
  sec.appendChild(row('Loop preview', loopChk));
  body.appendChild(sec);

  const perfBtn = el('button', 'tb-btn', '📊 Performance report');
  perfBtn.addEventListener('click', () => {
    const rep = performanceReport(ST.state.doc);
    const wrapEl = el('div', 'vfx-perf-report');
    const line = (k, v) => {
      const r = el('div', 'insp-row');
      r.append(el('span', 'l', k), el('span', '', String(v)));
      return r;
    };
    wrapEl.append(
      line('Preview peak particles', `${rep.previewPeakParticles} (frame ${rep.previewPeakFrame})`),
      line('Estimated in-game particles', rep.estimatedInGameParticles),
      line('Peak lights', rep.peakLights),
      line('Emitter instances on export', rep.exportEmitterInstances),
      ...Object.values(rep.platforms).map((p) => line(`${p.label} score`, `${p.score}/100 (${p.grade})`)),
    );
    for (const s of rep.suggestions) wrapEl.appendChild(el('div', 'vfx-perf-suggestion', `→ ${s}`));
    modal({ title: '📊 Performance report', body: wrapEl, actions: [{ label: 'Close', run: () => { } }] });
  });
  body.appendChild(perfBtn);
  body.appendChild(el('div', 'vfx-dim vfx-insp-hint', 'Select a layer in the timeline to edit its properties. Double-click a layer name to rename it; the ▸ caret shows its animated tracks.'));
}
