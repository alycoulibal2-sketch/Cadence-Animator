// The preset browser: a modal (never a resident panel — "choose base" is a moment) with three
// tabs: Effects (hand-tuned multi-layer archetypes with theme/scale dropdowns), Particles (the
// 396 single-emitter presets, applied as an added layer), and Mine (user-saved effect docs).
// Applying always goes through one undo step — "Ctrl+Z to restore" is the contract, never a
// confirm dialog. "Add as layers" is the non-destructive pro path.

import * as ST from './studioState.js';
import {
  EFFECT_ARCHETYPES, EFFECT_THEMES, EFFECT_SCALES, EFFECT_CATEGORIES,
  buildArchetypeDoc, searchEffectArchetypes,
} from '../../renderer/js/effectLibrary.js';
import { PARTICLE_PRESETS, CATEGORIES as PARTICLE_CATEGORIES, searchPresets } from '../../renderer/js/particleLibrary.js';
import { parseEffect, newLayer, addLayer, emitterToEffect, setClip } from '../../renderer/js/effectModel.js';
import { modal, toast } from '../../renderer/js/ui.js';
import { openSketchWorkspace } from './sketchWorkspace.js';

let activeModal = null;

export function openPresetBrowser({ blankState = false } = {}) {
  if (activeModal) return;
  const wrap = document.createElement('div');
  wrap.className = 'vfx-preset-browser';

  // SKETCH IT: an equally-large, equally-first-class alternative to picking/starting-from-scratch
  // below — never a replacement for it. Closes this browser and opens the drawing workspace;
  // the manual tabs/search/theme/scale controls beneath are completely untouched either way.
  const sketchCta = document.createElement('button');
  sketchCta.className = 'sketch-cta';
  const ctaIcon = document.createElement('span');
  ctaIcon.className = 'sketch-cta-icon';
  ctaIcon.textContent = '✏';
  const ctaText = document.createElement('span');
  ctaText.className = 'sketch-cta-text';
  const ctaTitle = document.createElement('strong');
  ctaTitle.textContent = 'SKETCH IT';
  const ctaSub = document.createElement('div');
  ctaSub.className = 'sketch-cta-sub';
  ctaSub.textContent = "Draw the rough shape of an idea — Cadence imagines the rest";
  ctaText.append(ctaTitle, ctaSub);
  sketchCta.append(ctaIcon, ctaText);
  sketchCta.addEventListener('click', () => {
    close();
    openSketchWorkspace();
  });
  const orDivider = document.createElement('div');
  orDivider.className = 'sketch-cta-divider';
  orDivider.textContent = blankState ? 'or start manually' : 'or browse manually';

  // tabs
  const tabs = document.createElement('div');
  tabs.className = 'vfx-preset-tabs';
  const content = document.createElement('div');
  content.className = 'vfx-preset-content';
  const tabDefs = [
    ['effects', `Effects (${EFFECT_ARCHETYPES.length})`],
    ['particles', `Particles (${PARTICLE_PRESETS.length})`],
    ['mine', 'My presets'],
  ];
  let active = 'effects';
  const tabBtns = new Map();
  for (const [key, label] of tabDefs) {
    const b = document.createElement('button');
    b.className = 'chip vfx-preset-tab';
    b.textContent = label;
    b.addEventListener('click', () => { active = key; render(); });
    tabs.appendChild(b);
    tabBtns.set(key, b);
  }

  // shared controls
  const controls = document.createElement('div');
  controls.className = 'vfx-preset-controls';
  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'fld';
  search.placeholder = 'Search…';
  const catSel = document.createElement('select');
  catSel.className = 'fld';
  const themeSel = document.createElement('select');
  themeSel.className = 'fld';
  themeSel.title = 'Color theme applied to the preset';
  for (const t of EFFECT_THEMES) themeSel.add(new Option(`Theme: ${t.label}`, t.key));
  const scaleSel = document.createElement('select');
  scaleSel.className = 'fld';
  scaleSel.title = 'Physical scale applied to the preset';
  for (const s of EFFECT_SCALES) scaleSel.add(new Option(`Scale: ${s.label}`, s.key));
  scaleSel.value = 'standard';
  controls.append(search, catSel, themeSel, scaleSel);
  search.addEventListener('input', () => renderGrid());
  catSel.addEventListener('change', () => renderGrid());

  const grid = document.createElement('div');
  grid.className = 'choose-grid vfx-browser-grid';

  const hint = document.createElement('div');
  hint.className = 'vfx-dim vfx-browser-hint';

  wrap.append(sketchCta, orDivider, tabs, controls, grid, hint);

  function currentTransforms() {
    return {
      theme: themeSel.value,
      scale: EFFECT_SCALES.find((s) => s.key === scaleSel.value)?.factor ?? 1,
    };
  }

  function card({ icon, title, sub, onApply, onAdd, onDelete }) {
    const c = document.createElement('div');
    c.className = 'choose-card vfx-browser-card';
    const ic = document.createElement('span');
    ic.className = 'ic';
    ic.textContent = icon;
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = title;
    const d = document.createElement('span');
    d.className = 'd';
    d.textContent = sub;
    c.append(ic, t, d);
    const actions = document.createElement('div');
    actions.className = 'vfx-card-actions';
    const openBtn = document.createElement('button');
    openBtn.className = 'tb-btn primary';
    openBtn.textContent = 'Open';
    openBtn.title = 'Replace the current effect (one undo step)';
    openBtn.addEventListener('click', onApply);
    actions.appendChild(openBtn);
    if (onAdd) {
      const addBtn = document.createElement('button');
      addBtn.className = 'tb-btn';
      addBtn.textContent = '＋ Add as layers';
      addBtn.title = 'Merge into the current effect instead of replacing it';
      addBtn.addEventListener('click', onAdd);
      actions.appendChild(addBtn);
    }
    if (onDelete) {
      const delBtn = document.createElement('button');
      delBtn.className = 'tb-btn';
      delBtn.textContent = '🗑';
      delBtn.title = 'Delete this saved preset';
      delBtn.addEventListener('click', onDelete);
      actions.appendChild(delBtn);
    }
    c.appendChild(actions);
    return c;
  }

  function applyDoc(doc, label) {
    ST.pushUndo();
    ST.setDoc(doc);
    toast(`Applied "${label}" — Ctrl+Z restores what you had`);
    close();
  }
  function addLayersFrom(doc, label) {
    ST.mutate((cur) => {
      for (const layer of doc.layers) {
        layer.clip.start = Math.min(layer.clip.start, Math.max(0, cur.duration - 1));
        setClip(layer, {}, cur.duration);
        cur.layers.push(layer);
      }
    });
    toast(`Added ${doc.layers.length} layer(s) from "${label}"`);
    close();
  }

  async function renderGrid() {
    grid.innerHTML = '';
    const tx = currentTransforms();
    if (active === 'effects') {
      hint.textContent = 'Open replaces your effect (one undo step). “Add as layers” merges it into what you have.';
      for (const a of searchEffectArchetypes(search.value, catSel.value)) {
        grid.appendChild(card({
          icon: a.icon, title: a.name, sub: a.description,
          onApply: () => applyDoc(buildArchetypeDoc(a.key, tx), a.name),
          onAdd: () => addLayersFrom(buildArchetypeDoc(a.key, tx), a.name),
        }));
      }
    } else if (active === 'particles') {
      hint.textContent = 'Particle presets add a single emitter layer — ingredients, not whole effects.';
      for (const p of searchPresets(search.value, catSel.value).slice(0, 150)) {
        grid.appendChild(card({
          icon: '✨', title: p.name, sub: p.category,
          onApply: () => applyDoc(emitterToEffect(p.name, p.emitter), p.name),
          onAdd: () => {
            ST.mutate((cur) => {
              const layer = addLayer(cur, newLayer('emitter', p.name));
              Object.assign(layer.props, p.emitter);
              layer.clip.len = cur.duration;
              ST.select(layer.id);
            });
            toast(`Added "${p.name}" as a layer`);
            close();
          },
        }));
      }
    } else {
      hint.textContent = 'Effects you saved with 💾 Save preset. Stored on this machine.';
      const list = await window.vfxStudio.listUserPresets();
      if (!list.length) grid.appendChild(Object.assign(document.createElement('div'), { className: 'vfx-preset-empty', textContent: 'Nothing saved yet — build something and hit 💾 Save preset.' }));
      for (const p of list) {
        grid.appendChild(card({
          icon: '💾', title: p.name, sub: p.category || 'My preset',
          onApply: () => {
            const parsed = parseEffect(p.effect || p);
            if (parsed.ok) applyDoc(parsed.doc, p.name);
            else toast(`Could not load "${p.name}": ${parsed.error}`, 'error');
          },
          onDelete: async () => {
            await window.vfxStudio.deleteUserPreset(p.id);
            renderGrid();
          },
        }));
      }
    }
    if (!grid.children.length && active !== 'mine') {
      grid.appendChild(Object.assign(document.createElement('div'), { className: 'vfx-preset-empty', textContent: 'No presets match.' }));
    }
  }

  function render() {
    for (const [key, b] of tabBtns) b.classList.toggle('active', key === active);
    catSel.innerHTML = '';
    const cats = active === 'effects' ? EFFECT_CATEGORIES : active === 'particles' ? PARTICLE_CATEGORIES : ['All'];
    for (const c of cats) catSel.add(new Option(c, c));
    const showTransforms = active === 'effects';
    themeSel.classList.toggle('hidden', !showTransforms);
    scaleSel.classList.toggle('hidden', !showTransforms);
    renderGrid();
  }

  const actions = [{ label: 'Close', run: () => { } }];
  if (blankState) {
    actions.unshift({
      label: '⬜ Start from scratch',
      run: () => ST.newBlankDoc(),
    });
  }
  const m = modal({
    title: blankState ? '🎬 Pick a starting point' : '🎬 Preset library',
    body: wrap,
    actions,
    onClose: () => { activeModal = null; },
  });
  activeModal = m;
  function close() { m.close(); activeModal = null; }
  render();
  setTimeout(() => search.focus(), 60);
}
