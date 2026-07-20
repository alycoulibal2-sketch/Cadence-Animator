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
import { newGraph, parseGraph } from '../../renderer/js/nodeGraphModel.js';
import { compileGraph } from '../../renderer/js/graphCompiler.js';
import '../../renderer/js/nodeTypes.js'; // side effect: registers the v1 node catalog

const listeners = new Map(); // event -> Set<fn>
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
}
export function off(event, fn) {
  listeners.get(event)?.delete(fn);
}
export function emit(event, payload) {
  for (const fn of listeners.get(event) || []) {
    try { fn(payload); } catch (e) { console.error(`[studio] listener for "${event}" threw`, e); }
  }
}

export const state = {
  doc: newEffect(),
  graph: null,              // the authoring NodeGraph, or null for a hand-edited/preset doc —
                             // when present, `doc` is DERIVED from it (compileGraph), never the
                             // other way around; see recompileFromGraph().
  graphErrors: [],          // latest compileGraph() errors (cycles, a node that threw) — an
                             // incomplete/unwired chain is never an error, see graphCompiler.js
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

// doc is a pure function of graph (same discipline as sampleEffect being a pure function of
// frame) — this is the ONLY place state.doc is assigned when state.graph is non-null. On a
// compile error, the previous doc is kept (never blanked); errors surface via state.graphErrors
// for the node editor to display, separately from the effect validator's own diagnostics panel.
function recompileFromGraph() {
  if (!state.graph) { state.graphErrors = []; return; }
  const result = compileGraph(state.graph);
  state.graphErrors = result.errors;
  if (result.ok) state.doc = result.doc;
}

// ---------------------------------------------------------------- undo/redo
const undoStack = [];
const redoStack = [];
const MAX_UNDO = 100;

function snapshot() {
  return {
    doc: structuredClone(state.doc),
    graph: state.graph ? structuredClone(state.graph) : null,
    selection: { ...state.selection },
  };
}
export function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
}
function applySnapshot(s) {
  state.graph = s.graph ? structuredClone(s.graph) : null;
  // When a graph is present it's the source of truth — recompile rather than trust the
  // snapshotted doc, so undo/redo can never leave doc and graph out of sync with each other.
  if (state.graph) recompileFromGraph();
  else state.doc = structuredClone(s.doc);
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

// The graph-authoring twin of mutate(): runs `fn(state.graph)`, recompiles `state.doc` from the
// result, then goes through the exact same afterDocChange() (autosave/validation/'effect' event)
// as a direct doc mutation — one coherent undo history and one set of downstream effects
// regardless of whether the last edit came from the node editor or the inspector/timeline.
export function mutateGraph(fn, { undoable = true } = {}) {
  if (undoable) pushUndo();
  const result = fn(state.graph);
  recompileFromGraph();
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

// setGraph mirrors setDoc but for graph-authored effects: state.graph becomes the source of
// truth, state.doc is immediately (re)compiled from it. Selection/playhead/view-state reset the
// same way opening any new document does.
export function setGraph(graph, { select: sel = true } = {}) {
  state.graph = graph;
  recompileFromGraph();
  state.solo.clear();
  state.expanded.clear();
  state.curveTarget = null;
  state.playhead = 0;
  state.selection = { layerId: sel && state.doc.layers[0] ? state.doc.layers[0].id : null };
  afterDocChange();
  emit('selection', {});
  emit('curveTarget', {});
}

// A brand new, genuinely empty graph — no starter node. The node editor's own blank-canvas
// affordance (search/context-menu "add a node") is the entry point for populating it; a
// prefilled default graph is a UI/onboarding decision explicitly deferred, not this pass's call.
export function newBlankGraph() {
  pushUndo();
  setGraph(newGraph('Untitled Effect'));
}

// ---------------------------------------------------------------- autosave (studio-local)
// `window.vfxStudio.autosaveEffect`/`loadAutosavedEffect` (src/main.js's vfx:autosave:save/load)
// write/read a plain opaque string to disk — main.js never parses it, so this wrapper format is
// entirely a renderer-side concern. A graph-authored effect persists BOTH the graph (source of
// truth) and its last-compiled doc (a safety-net fallback, and what a build with no graph-editor
// support would still read); a hand-edited/preset doc with no graph serializes exactly as
// before — same bare Effect JSON, fully backward-compatible with every autosave written before
// the node editor existed.
function serializeStudioSave() {
  if (state.graph) return JSON.stringify({ cadenceStudioSave: 1, graph: state.graph, doc: state.doc });
  return serializeEffect(state.doc);
}
function parseStudioSave(json) {
  let raw;
  try { raw = JSON.parse(json); } catch (e) { return { ok: false, error: e.message }; }
  if (raw && raw.cadenceStudioSave === 1) {
    const parsedGraph = parseGraph(raw.graph);
    if (!parsedGraph.ok) return { ok: false, error: parsedGraph.error };
    return { ok: true, graph: parsedGraph.graph };
  }
  const parsedDoc = parseEffect(raw);
  return parsedDoc.ok ? { ok: true, graph: null, doc: parsedDoc.doc } : { ok: false, error: parsedDoc.error };
}

let autosaveTimer = null;
function scheduleAutosave() {
  const doc = state.doc, graph = state.graph; // close over the reference AT SCHEDULE TIME
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    if (doc !== state.doc || graph !== state.graph) return; // a New/Open landed inside the window — this write is stale
    window.vfxStudio.autosaveEffect(serializeStudioSave()).catch(() => { });
  }, 800);
}

export async function restoreAutosave() {
  try {
    const json = await window.vfxStudio.loadAutosavedEffect();
    if (!json) return false;
    const parsed = parseStudioSave(json);
    if (!parsed.ok) return false;
    if (parsed.graph) setGraph(parsed.graph);
    else setDoc(parsed.doc);
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
