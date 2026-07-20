// The rest of the SKETCH IT pipeline after the sketch itself: Geometry Analysis -> Candidate
// Generator -> Ranking -> Preview Renderer -> User Selection -> Editable Effect (see
// sketchCandidates.js's header for the full diagram). Everything here is genuinely, immediately
// editable once committed — "Use Effect" and "Edit Before Import" both land on the exact same
// ST.setDoc() path the Presets browser's "Open" already uses (presetsPanel.js's applyDoc), so a
// generated effect is indistinguishable from a hand-picked preset the moment it lands in the
// editor. Nothing here is a black box and nothing is baked.

import { analyzeSketchStrokes } from '../../renderer/js/sketchGeometry.js';
import { planCompositions, rankCandidates } from '../../renderer/js/sketchCandidates.js';
import { captureSketchIntent } from '../../renderer/js/sketchIntent.js';
import { LAYER_TYPES } from '../../renderer/js/effectModel.js';
import { registerPreview, unregisterPreview, pauseAll, resumeAll } from './sketchPreviewRenderer.js';
import * as ST from './studioState.js';
import { modal, toast } from '../../renderer/js/ui.js';

let activeResults = null; // guards against two results sessions stacking

// A "back to sketch results" chip lives in the titlebar after "Edit Before Import" — non-terminal
// by design (see sketchCandidates.js/sketchWorkspace.js headers: Use Effect ends the session,
// Edit Before Import keeps a way back). Auto-invalidates the moment the open doc changes to
// something else, so it can never point at stale results.
let backChip = null;
let backChipDocId = null;
ST.on('effect', () => {
  if (backChip && ST.state.doc.id !== backChipDocId) removeBackChip();
});
function removeBackChip() {
  if (backChip) { backChip.remove(); backChip = null; backChipDocId = null; }
}
function showBackToResultsChip(strokes, allCandidates, onEditSketch, committedDocId) {
  removeBackChip();
  backChipDocId = committedDocId;
  backChip = document.createElement('button');
  backChip.className = 'tb-btn sketch-back-chip';
  backChip.textContent = '↩ Back to sketch results';
  backChip.title = 'Reopen the suggestions this effect came from';
  backChip.addEventListener('click', () => {
    removeBackChip();
    openSketchResults(strokes, { onEditSketch, precomputed: allCandidates });
  });
  const titlebar = document.getElementById('titlebar');
  const spacer = titlebar.querySelector('.spacer');
  titlebar.insertBefore(backChip, spacer);
}

function buildSection(title, key) {
  const root = document.createElement('div');
  root.className = `sketch-section sketch-section-${key} hidden`;
  const head = document.createElement('div');
  head.className = 'sketch-section-head';
  head.textContent = title;
  const grid = document.createElement('div');
  grid.className = 'sketch-section-grid';
  root.append(head, grid);
  return { root, grid };
}

function commitDoc(doc) {
  ST.pushUndo();
  ST.setDoc(doc);
  return doc.id;
}

export function openSketchResults(strokes, { onEditSketch, precomputed, energyLevel, colorDabs } = {}) {
  if (activeResults) return;
  removeBackChip();
  const features = analyzeSketchStrokes(strokes);
  const intent = captureSketchIntent({ shapeStrokes: strokes, energyLevel, colorDabs });
  const controller = new AbortController();
  const cardsById = new Map(); // candidate.id -> { el, handle }
  let allCandidates = [];

  const wrap = document.createElement('div');
  wrap.className = 'sketch-results';

  const header = document.createElement('div');
  header.className = 'sketch-results-header';
  const backBtn = document.createElement('button');
  backBtn.className = 'tb-btn';
  backBtn.textContent = '← Edit sketch';
  backBtn.title = 'Go back and change the sketch (nothing generated is lost from the drawing)';
  const status = document.createElement('div');
  status.className = 'sketch-status';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'tb-btn';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close';
  header.append(backBtn, status, closeBtn);

  const scroll = document.createElement('div');
  scroll.className = 'sketch-results-scroll';
  const sectionFlat = buildSection('Imagining…', 'flat');
  const sectionBest = buildSection('Best Match', 'best');
  const sectionGood = buildSection('Good Matches', 'good');
  const sectionMore = buildSection('More Ideas', 'more');
  scroll.append(sectionFlat.root, sectionBest.root, sectionGood.root, sectionMore.root);
  sectionFlat.root.classList.remove('hidden');

  wrap.append(header, scroll);

  const m = modal({
    title: '✨ Suggestions',
    body: wrap,
    actions: [],
    onClose: () => {
      controller.abort();
      for (const { handle } of cardsById.values()) unregisterPreview(handle);
      activeResults = null;
    },
  });
  activeResults = m;
  const resultsBackdrop = m.box.closest('.modal-back');
  function close() { m.close(); }

  backBtn.addEventListener('click', () => { close(); if (onEditSketch) onEditSketch(); });
  closeBtn.addEventListener('click', close);

  function buildCard(candidate) {
    const card = document.createElement('div');
    card.className = 'sketch-card sketch-card-size-flat';
    const canvasEl = document.createElement('canvas');
    canvasEl.className = 'sketch-card-canvas';
    const play = document.createElement('div');
    play.className = 'sketch-card-play';
    play.textContent = '▶';
    const label = document.createElement('div');
    label.className = 'sketch-card-label';
    label.textContent = candidate.name;
    card.append(canvasEl, play, label);
    card.addEventListener('click', () => openFocus(candidate));
    const handle = registerPreview(canvasEl, candidate.doc, { quality: 0.6, shake: false });
    cardsById.set(candidate.id, { el: card, handle });
    sectionFlat.grid.appendChild(card);
    return card;
  }

  function reflowIntoTiers(all) {
    sectionFlat.root.classList.add('hidden');
    const { best, good, more } = rankCandidates(all);
    const place = (candidate, section, sizeClass) => {
      const entry = cardsById.get(candidate.id);
      if (!entry) return;
      entry.el.classList.remove('sketch-card-size-flat');
      entry.el.classList.add(sizeClass);
      section.grid.appendChild(entry.el);
    };
    if (best) { place(best, sectionBest, 'sketch-card-size-best'); sectionBest.root.classList.remove('hidden'); }
    good.forEach((c) => place(c, sectionGood, 'sketch-card-size-good'));
    if (good.length) sectionGood.root.classList.remove('hidden');
    more.forEach((c) => place(c, sectionMore, 'sketch-card-size-more'));
    if (more.length) sectionMore.root.classList.remove('hidden');
  }

  function openFocus(candidate) {
    if (resultsBackdrop) resultsBackdrop.style.visibility = 'hidden';
    pauseAll();
    const workingDoc = structuredClone(candidate.doc);

    const focusWrap = document.createElement('div');
    focusWrap.className = 'sketch-focus';
    const stage = document.createElement('div');
    stage.className = 'sketch-focus-stage';
    const canvasEl = document.createElement('canvas');
    canvasEl.className = 'sketch-focus-canvas';
    stage.appendChild(canvasEl);

    const sidebar = document.createElement('div');
    sidebar.className = 'sketch-focus-sidebar';
    const sideHead = document.createElement('div');
    sideHead.className = 'sketch-focus-title';
    sideHead.textContent = `${candidate.icon} ${candidate.name}`;
    const sideSub = document.createElement('div');
    sideSub.className = 'sketch-focus-sub';
    sideSub.textContent = 'Effect Breakdown';
    const list = document.createElement('div');
    list.className = 'sketch-breakdown-list';
    // Checkbox = toggle (mute/unmute one component independently, others unaffected).
    // Clicking the row itself = solo (isolate exactly one component). Solo remembers the
    // toggle state from right before it started, so leaving solo — click the soloed row
    // again, or toggle any checkbox directly — restores exactly what was on/off before.
    const rows = [];
    let soloId = null;
    let preSoloEnabled = null;
    const syncRow = ({ layer, row, cb }) => {
      cb.checked = layer.enabled;
      row.classList.toggle('soloed', layer.id === soloId);
    };
    const syncAll = () => rows.forEach(syncRow);
    const exitSolo = () => {
      if (!preSoloEnabled) return;
      for (const { layer } of rows) layer.enabled = preSoloEnabled.get(layer.id);
      soloId = null;
      preSoloEnabled = null;
      syncAll();
    };
    const toggleSolo = (layer) => {
      if (soloId === layer.id) { exitSolo(); return; }
      if (!preSoloEnabled) preSoloEnabled = new Map(rows.map((r) => [r.layer.id, r.layer.enabled]));
      for (const { layer: l } of rows) l.enabled = (l.id === layer.id);
      soloId = layer.id;
      syncAll();
    };
    for (const layer of workingDoc.layers) {
      const row = document.createElement('div');
      row.className = 'sketch-breakdown-row';
      row.title = `Click to preview ${layer.name} alone — click again to go back`;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = layer.enabled;
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        const newVal = cb.checked;
        exitSolo();
        layer.enabled = newVal;
        cb.checked = newVal;
      });
      const name = document.createElement('span');
      name.className = 'sketch-breakdown-name';
      name.textContent = `${(LAYER_TYPES[layer.type] && LAYER_TYPES[layer.type].icon) || '·'} ${layer.name}`;
      const hint = document.createElement('span');
      hint.className = 'sketch-breakdown-hint';
      hint.textContent = 'solo';
      row.append(cb, name, hint);
      row.addEventListener('click', () => toggleSolo(layer));
      rows.push({ layer, row, cb });
      list.appendChild(row);
    }
    sidebar.append(sideHead, sideSub, list);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'sketch-focus-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'tb-btn sketch-focus-edit';
    editBtn.textContent = '✏ Edit Before Import';
    editBtn.title = 'Open this in the editor and keep a way back to these suggestions';
    const useBtn = document.createElement('button');
    useBtn.className = 'tb-btn primary sketch-focus-use';
    useBtn.textContent = '✓ Use Effect';
    useBtn.title = 'Open this in the editor — fully done with sketching';
    actionsRow.append(editBtn, useBtn);
    sidebar.appendChild(actionsRow);

    focusWrap.append(stage, sidebar);
    const handle = registerPreview(canvasEl, workingDoc, { quality: 1, shake: true });

    const fm = modal({
      title: '',
      body: focusWrap,
      actions: [],
      onClose: () => {
        unregisterPreview(handle);
        resumeAll();
        if (resultsBackdrop) resultsBackdrop.style.visibility = '';
      },
    });
    function closeFocus() { fm.close(); }

    useBtn.addEventListener('click', () => {
      exitSolo(); // never commit a transient "solo" view — only the real toggle state
      commitDoc(workingDoc);
      toast(`"${candidate.name}" is ready to edit — Ctrl+Z restores what you had`);
      removeBackChip();
      closeFocus();
      close();
    });
    editBtn.addEventListener('click', () => {
      exitSolo();
      const docId = commitDoc(workingDoc);
      toast(`Editing "${candidate.name}" — pick up your sketch results anytime from the titlebar`);
      closeFocus();
      close();
      showBackToResultsChip(strokes, allCandidates, onEditSketch, docId);
    });
  }

  if (precomputed && precomputed.length) {
    allCandidates = precomputed;
    precomputed.forEach(buildCard);
    status.textContent = `${precomputed.length} suggestions`;
    reflowIntoTiers(precomputed);
    return;
  }

  status.textContent = 'Imagining possibilities…';
  planCompositions(features, {
    count: 30,
    intent,
    signal: controller.signal,
    onCandidate: (candidate, n) => {
      status.textContent = `${n} preview${n === 1 ? '' : 's'}…`;
      buildCard(candidate);
    },
  }).then((all) => {
    if (controller.signal.aborted) return; // results closed mid-generation — nothing left to update
    allCandidates = all;
    status.textContent = `${all.length} suggestions — click one to look closer`;
    reflowIntoTiers(all);
  });
}
