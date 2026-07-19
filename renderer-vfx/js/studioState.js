// The studio window's document owner: the open effect doc, selection, playhead, view state
// (solo/expanded — deliberately NOT in the document), snapshot undo/redo, debounced autosave,
// and continuous validation. Everything else in this window mutates the doc exclusively through
// mutate()/beginGesture() here, so undo, autosave, validation, and the 'effect' event can never
// drift apart.
//
// Two traps this file is shaped around (both documented in the animator's history):
// - Snapshot undo replaces objects wholesale: panels must RE-RESOLVE layers/modifiers by id on
//   every 'effect' event, never hold object references across mutations.
// - The autosave debounce closes over THE DOC REFERENCE at schedule time, so a New/Open inside
//   the debounce window can't redirect the outgoing doc's pending write onto the incoming one.

import { newEffect, newLayer, addLayer, parseEffect, serializeEffect, getLayer } from '../../renderer/js/effectModel.js';
import { runValidation } from '../../renderer/js/diagnostics.js';
import '../../renderer/js/effectValidators.js'; // side effect: registers the shared validator pack

const listeners = new Map(); // event -> Set<fn>
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
}
export function emit(event, payload) {
  for (const fn of listeners.get(event) || []) {
    try { fn(payload); } catch (e) { console.error(`[studio] listener for "${event}" threw`, e); }
  }
}

export const state = {
  doc: newEffect(),
  selection: { layerId: null },
  playhead: 0,
  playing: false,
  advanced: false,
  solo: new Set(),          // view state — never serialized (docs/vfx-studio.md)
  expanded: new Set(),      // layer ids with per-prop key rows expanded in the timeline
  curveTarget: null,        // { layerId, prop } the curve drawer is editing, or null
  lastReport: null,         // latest runValidation('effect') result
  dirty: false,
};

// ---------------------------------------------------------------- undo/redo
const undoStack = [];
const redoStack = [];
const MAX_UNDO = 100;

function snapshot() {
  return { doc: structuredClone(state.doc), selection: { ...state.selection } };
}
export function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
}
function applySnapshot(s) {
  state.doc = structuredClone(s.doc);
  state.selection = { ...s.selection };
  if (state.selection.layerId && !getLayer(state.doc, state.selection.layerId)) state.selection = { layerId: null };
  afterDocChange();
  emit('selection', {});
}
export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(snapshot());
  applySnapshot(undoStack.pop());
  return true;
}
export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(snapshot());
  applySnapshot(redoStack.pop());
  return true;
}
export function undoDepths() { return { undo: undoStack.length, redo: redoStack.length }; }

// ---------------------------------------------------------------- mutation entry points
// mutate(fn): one undoable step. For pointer gestures (clip drags, key drags) use
// beginGesture() at pointerdown — it pushes the undo snapshot BEFORE the live mutation starts
// (the curves.js pattern: push-on-release would snapshot the already-mutated state and make
// Ctrl+Z a no-op) — then call touch() while dragging and endGesture() on release.
export function mutate(fn, { undoable = true } = {}) {
  if (undoable) pushUndo();
  const result = fn(state.doc);
  afterDocChange();
  return result;
}

let gestureActive = false;
export function beginGesture() {
  if (gestureActive) return;
  gestureActive = true;
  pushUndo();
}
export function touch() { afterDocChange({ light: true }); }
export function endGesture() {
  if (!gestureActive) return;
  gestureActive = false;
  afterDocChange();
}

function afterDocChange({ light = false } = {}) {
  state.dirty = true;
  clampPlayhead();
  emit('effect', {});
  scheduleAutosave();
  if (!light) scheduleValidation();
}

// ---------------------------------------------------------------- selection / playhead
export function select(layerId) {
  state.selection = { layerId };
  emit('selection', {});
}
export function selectedLayer() {
  return state.selection.layerId ? getLayer(state.doc, state.selection.layerId) : null;
}
function clampPlayhead() {
  state.playhead = Math.max(0, Math.min(state.doc.duration - 1, state.playhead));
}
export function setPlayhead(frame, { fromPlayback = false } = {}) {
  state.playhead = Math.max(0, Math.min(state.doc.duration - 1, frame));
  emit('playhead', { fromPlayback });
}
export function setPlaying(playing) {
  state.playing = playing;
  emit('playing', {});
}
export function toggleSolo(layerId) {
  if (state.solo.has(layerId)) state.solo.delete(layerId);
  else state.solo.add(layerId);
  emit('effect', {}); // re-render without a doc change (no autosave/undo — view state only)
}
export function setAdvanced(v) {
  state.advanced = v;
  emit('advanced', {});
  emit('selection', {}); // inspector rebuilds to show/hide expression rows
}
export function openCurveEditor(layerId, prop) {
  state.curveTarget = { layerId, prop };
  emit('curveTarget', {});
}
export function closeCurveEditor() {
  state.curveTarget = null;
  emit('curveTarget', {});
}

// ---------------------------------------------------------------- document lifecycle
export function setDoc(doc, { select: sel = true } = {}) {
  state.doc = doc;
  state.solo.clear();
  state.expanded.clear();
  state.curveTarget = null;
  state.playhead = 0;
  state.selection = { layerId: sel && doc.layers[0] ? doc.layers[0].id : null };
  afterDocChange();
  emit('selection', {});
  emit('curveTarget', {});
}

export function newBlankDoc() {
  pushUndo();
  const doc = newEffect('Untitled Effect');
  addLayer(doc, newLayer('emitter', 'Particles')).clip.len = doc.duration;
  setDoc(doc);
}

// ---------------------------------------------------------------- autosave (studio-local)
let autosaveTimer = null;
function scheduleAutosave() {
  const doc = state.doc; // close over the reference AT SCHEDULE TIME
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    if (doc !== state.doc) return; // a New/Open landed inside the window — this write is stale
    window.vfxStudio.autosaveEffect(serializeEffect(doc)).catch(() => { });
  }, 800);
}

export async function restoreAutosave() {
  try {
    const json = await window.vfxStudio.loadAutosavedEffect();
    if (!json) return false;
    const parsed = parseEffect(json);
    if (!parsed.ok) return false;
    setDoc(parsed.doc);
    state.dirty = false;
    return true;
  } catch (_) {
    return false;
  }
}

// ---------------------------------------------------------------- continuous validation
let validateTimer = null;
function scheduleValidation() {
  clearTimeout(validateTimer);
  validateTimer = setTimeout(() => {
    state.lastReport = runValidation('effect', { effect: state.doc });
    emit('diagnostics', {});
  }, 350);
}
export function validateNow(scope = 'effect') {
  const report = runValidation(scope, { effect: state.doc });
  if (scope === 'effect') {
    state.lastReport = report;
    emit('diagnostics', {});
  }
  return report;
}
