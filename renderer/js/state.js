// Project state, undo/redo, autosave, track evaluation.
import * as CF from './cf.js';
import { evalSegment } from './easing.js';

// ---------------------------------------------------------------- events
const listeners = new Map();
export function on(type, cb) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(cb);
  return () => listeners.get(type).delete(cb);
}
export function emit(type, data) {
  (listeners.get(type) || []).forEach((cb) => { try { cb(data); } catch (e) { console.error(e); } });
  if (type !== 'playhead' && type !== 'playing') (listeners.get('any') || []).forEach((cb) => cb(type));
}

// ---------------------------------------------------------------- state
export const state = {
  project: null,
  selection: { itemId: null, partId: null, keys: [] }, // keys: [{itemId, track, t}]
  playhead: 0,
  playing: false,
  autoKey: true,
  snapping: true,
  loopPlayback: true,
  cameraView: null, // itemId of camera being looked through, or null
  clipboard: null,
  dirty: false,
  projectPath: null, // where Save writes; autosave is separate & automatic
  // UI/session preferences (not project data — persisted via settings.json like autoKey/snapping)
  handlesVisible: true,
  handleSize: 'normal', // 'normal' | 'small'
  rotGridSnap: false,
  rotGridDegrees: 15,
  posGridSnap: false,
  posGridDistance: 1,
  ikChainLength: 3, // how many joints up the chain the IK tool adjusts
  showSeconds: false,
  uiHidden: false, // Ctrl+H focus mode
  cameraTracksVisible: true,
};

export function newProject(name = 'Untitled') {
  state.project = {
    version: 1,
    id: crypto.randomUUID(),
    name,
    fps: 30,
    length: 90,
    loop: false,
    priority: 'Action',
    items: [],
    tracks: {},
    groups: [], // [{ id, keys: [{itemId, track, t}] }] — keys that move together (Ctrl+G)
    onionSkin: { enabledItemIds: [], range: 3 },
    audio: null, // { name, path, offset, volume }
  };
  state.selection = { itemId: null, partId: null, keys: [] };
  state.playhead = 0;
  state.projectPath = null;
  undoStack.length = 0;
  redoStack.length = 0;
  emit('project');
  scheduleAutosave();
}

export function loadProject(json, filePath = null) {
  const p = typeof json === 'string' ? JSON.parse(json) : json;
  if (!p || !Array.isArray(p.items)) throw new Error('Not a valid Cadence project file');
  p.id = p.id || crypto.randomUUID();
  p.groups = p.groups || [];
  p.onionSkin = p.onionSkin || { enabledItemIds: [], range: 3 };
  state.project = p;
  state.projectPath = filePath;
  state.selection = { itemId: null, partId: null, keys: [] };
  state.playhead = 0;
  undoStack.length = 0;
  redoStack.length = 0;
  emit('project');
}

export function serialize() {
  return JSON.stringify(state.project);
}

// ---------------------------------------------------------------- undo/redo
const undoStack = [];
const redoStack = [];
const UNDO_CAP = 120;

function snapshot() {
  const p = state.project;
  return structuredClone({ items: p.items, tracks: p.tracks, groups: p.groups, onionSkin: p.onionSkin, length: p.length, fps: p.fps, loop: p.loop, priority: p.priority, name: p.name, audio: p.audio });
}
function applySnapshot(s) {
  Object.assign(state.project, structuredClone(s));
  emit('project');
}
export function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > UNDO_CAP) undoStack.shift();
  redoStack.length = 0;
}
export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(snapshot());
  applySnapshot(undoStack.pop());
  markDirty();
  return true;
}
export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(snapshot());
  applySnapshot(redoStack.pop());
  markDirty();
  return true;
}

// ---------------------------------------------------------------- autosave
let autosaveTimer = null;
let lastAutosave = 0;
export function markDirty() {
  state.dirty = true;
  emit('dirty');
  scheduleAutosave();
}
function scheduleAutosave() {
  // Capture *this* project object now, not just "whatever state.project is" — newProject()/
  // loadProject() reassign state.project to a brand-new object rather than mutating the old one
  // in place, so without this capture a project-switch inside the 600ms debounce window (e.g. a
  // rapid edit immediately followed by Ctrl+N) would cancel the pending write for the outgoing
  // project and silently redirect it onto the incoming blank one, losing the last edit(s) for
  // good. Ongoing edits to the *same* project are unaffected: each edit re-captures the (still
  // current) object reference, and its in-place mutations are naturally visible when the timer
  // fires and serializes it.
  const project = state.project;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => doAutosave(project), 600);
}
async function doAutosave(project) {
  if (!project) return;
  try {
    await window.cadence.autosaveWrite(project.id, JSON.stringify(project));
    lastAutosave = Date.now();
    emit('autosaved', lastAutosave);
  } catch (e) {
    console.error('autosave failed', e);
  }
}
// Emergency flush on window close — main.js's win.on('close', ...) intercepts the real close,
// asks for this, and actually waits for flushComplete() before letting the window close for
// real (bounded by its own safety timeout), instead of the old beforeunload-based flush which
// fired the write and returned immediately with no guarantee it ever finished in time.
window.cadence.onFlushBeforeClose(async () => {
  if (state.project) {
    try { await window.cadence.autosaveWrite(state.project.id, serialize()); } catch (_) { }
  }
  window.cadence.flushComplete();
});

// ---------------------------------------------------------------- items
export function addItem(item) {
  pushUndo();
  state.project.items.push(item);
  state.project.tracks[item.id] = state.project.tracks[item.id] || {};
  emit('items');
  markDirty();
  return item;
}
export function removeItem(itemId) {
  pushUndo();
  state.project.items = state.project.items.filter((i) => i.id !== itemId);
  delete state.project.tracks[itemId];
  if (state.selection.itemId === itemId) setSelection(null, null);
  if (state.cameraView === itemId) state.cameraView = null;
  emit('items');
  markDirty();
}
export function getItem(itemId) {
  return state.project.items.find((i) => i.id === itemId) || null;
}
export function renameItem(itemId, name) {
  const it = getItem(itemId);
  if (!it) return;
  pushUndo();
  it.name = name;
  emit('items');
  markDirty();
}

// ---------------------------------------------------------------- attach & detach
// A prop (weapon, tool, held item) rigidly follows another item's part every frame instead of
// being independently keyed. `offset` is captured once at attach-time (by the caller, which has
// access to the live solved poses state.js doesn't) so the prop keeps its exact current visual
// position/orientation relative to the target part — no manual nudging to line it up.
export function attachItem(itemId, targetItemId, targetPartId, offset) {
  const item = getItem(itemId);
  if (!item) return;
  pushUndo();
  item.attachedTo = { itemId: targetItemId, partId: targetPartId, offset };
  emit('items');
  markDirty();
}
// currentWorldOrigin: the item's live world origin at the moment of detaching (also supplied by
// the caller), written back as its new static origin so it doesn't jump back to wherever it was
// before it got attached.
export function detachItem(itemId, currentWorldOrigin) {
  const item = getItem(itemId);
  if (!item || !item.attachedTo) return;
  pushUndo();
  item.attachedTo = null;
  if (currentWorldOrigin) item.origin = currentWorldOrigin;
  emit('items');
  markDirty();
}

// A rig's current face is a stack of decal layers { dataUri, opacity } rendered on its Head part
// — separate from the item's animated pose/keyframes, so swapping faces never touches animation.
// The saved-preset LIBRARY itself is app-wide (in settings, not project state) since face presets
// are meant to be reused across rigs and projects, not tied to one project file.
export function setItemFace(itemId, layers) {
  const item = getItem(itemId);
  if (!item) return;
  pushUndo();
  item.faceLayers = layers && layers.length ? layers : null;
  emit('items');
  markDirty();
}

// ---------------------------------------------------------------- selection / playhead
export function setSelection(itemId, partId, keepKeys = false) {
  state.selection.itemId = itemId;
  state.selection.partId = partId;
  if (!keepKeys) state.selection.keys = [];
  emit('selection');
}
export function setSelectedKeys(keys) {
  state.selection.keys = keys;
  emit('selection');
}
export function setPlayhead(t, snap = null) {
  const doSnap = snap === null ? state.snapping && !state.playing : snap;
  t = Math.max(0, Math.min(state.project.length, t));
  state.playhead = doSnap ? Math.round(t) : t;
  emit('playhead', state.playhead);
}
export function setPlaying(v) {
  state.playing = v;
  emit('playing', v);
}

// ---------------------------------------------------------------- tracks & keys
function trackObj(itemId, track, create = false) {
  const t = state.project.tracks;
  if (!t[itemId]) { if (!create) return null; t[itemId] = {}; }
  if (!t[itemId][track]) {
    if (!create) return null;
    t[itemId][track] = { keys: [] };
  }
  return t[itemId][track];
}
export function getTrack(itemId, track) { return trackObj(itemId, track, false); }
export function getTracks(itemId) { return state.project.tracks[itemId] || {}; }

export function setKey(itemId, track, t, value, opts = {}) {
  if (!opts.noUndo) pushUndo();
  const tr = trackObj(itemId, track, true);
  const existing = tr.keys.find((k) => Math.abs(k.t - t) < 1e-6);
  if (existing) {
    if (value !== undefined) existing.v = value;
    if (opts.es) existing.es = opts.es;
    if (opts.ed) existing.ed = opts.ed;
    if (opts.bez !== undefined) existing.bez = opts.bez;
  } else {
    tr.keys.push({ t, v: value, es: opts.es || 'Cubic', ed: opts.ed || 'Out', bez: opts.bez ?? null });
    tr.keys.sort((a, b) => a.t - b.t);
  }
  emit('tracks', { itemId, track });
  markDirty();
}

export function deleteKeys(list) {
  if (!list.length) return;
  pushUndo();
  for (const { itemId, track, t } of list) {
    const tr = trackObj(itemId, track);
    if (!tr) continue;
    tr.keys = tr.keys.filter((k) => Math.abs(k.t - t) > 1e-6);
  }
  state.selection.keys = [];
  emit('tracks', {});
  emit('selection');
  markDirty();
}

export function moveKeys(list, dt, opts = {}) {
  if (!list.length || dt === 0) return list;
  if (!opts.noUndo) pushUndo();
  // Grouped keys move together: if any key in `list` belongs to a group, pull in every
  // other key of that group too (deduped) so dragging one moves the whole group.
  const expanded = [...list];
  const seen = new Set(list.map((k) => `${k.itemId}|${k.track}|${k.t}`));
  for (const ref of list) {
    const grp = findGroup(ref.itemId, ref.track, ref.t);
    if (!grp) continue;
    for (const k of grp.keys) {
      const key = `${k.itemId}|${k.track}|${k.t}`;
      if (!seen.has(key)) { seen.add(key); expanded.push(k); }
    }
  }
  const moved = [];
  // collect refs first (deleting/re-adding avoids collision weirdness)
  const grabbed = [];
  for (const { itemId, track, t } of expanded) {
    const tr = trackObj(itemId, track);
    if (!tr) continue;
    const idx = tr.keys.findIndex((k) => Math.abs(k.t - t) < 1e-6);
    if (idx < 0) continue;
    grabbed.push({ itemId, track, origT: t, key: tr.keys[idx] });
    tr.keys.splice(idx, 1);
  }
  for (const g of grabbed) {
    const tr = trackObj(g.itemId, g.track, true);
    let nt = Math.max(0, Math.min(state.project.length, g.key.t + dt));
    // replace any key already at destination
    tr.keys = tr.keys.filter((k) => Math.abs(k.t - nt) > 1e-6);
    g.key.t = nt;
    tr.keys.push(g.key);
    tr.keys.sort((a, b) => a.t - b.t);
    moved.push({ itemId: g.itemId, track: g.track, t: nt });
    retargetGroupKey(g.itemId, g.track, g.origT, nt);
  }
  emit('tracks', {});
  emit('groups');
  markDirty();
  return moved;
}

// ---------------------------------------------------------------- keyframe groups (Ctrl+G)
function keyRefEq(a, b) {
  return a.itemId === b.itemId && a.track === b.track && Math.abs(a.t - b.t) < 1e-6;
}
export function findGroup(itemId, track, t) {
  const groups = state.project.groups || [];
  return groups.find((g) => g.keys.some((k) => keyRefEq(k, { itemId, track, t }))) || null;
}
function retargetGroupKey(itemId, track, oldT, newT) {
  const grp = findGroup(itemId, track, oldT);
  if (!grp) return;
  const k = grp.keys.find((k) => keyRefEq(k, { itemId, track, t: oldT }));
  if (k) k.t = newT;
}
export function groupKeys(list) {
  if (list.length < 2) return null;
  pushUndo();
  state.project.groups = state.project.groups || [];
  // merge with any groups already touching these keys, and dedupe
  const merged = [...list];
  const seen = new Set(list.map((k) => `${k.itemId}|${k.track}|${k.t}`));
  const survivors = [];
  for (const g of state.project.groups) {
    if (g.keys.some((k) => seen.has(`${k.itemId}|${k.track}|${k.t}`))) {
      for (const k of g.keys) {
        const key = `${k.itemId}|${k.track}|${k.t}`;
        if (!seen.has(key)) { seen.add(key); merged.push(k); }
      }
    } else {
      survivors.push(g);
    }
  }
  survivors.push({ id: crypto.randomUUID(), keys: merged.map(({ itemId, track, t }) => ({ itemId, track, t })) });
  state.project.groups = survivors;
  emit('groups');
  markDirty();
  return survivors[survivors.length - 1];
}
export function ungroupKeys(list) {
  if (!list.length) return false;
  const groups = state.project.groups || [];
  const targets = new Set(list.map((k) => `${k.itemId}|${k.track}|${k.t}`));
  const remaining = groups.filter((g) => !g.keys.some((k) => targets.has(`${k.itemId}|${k.track}|${k.t}`)));
  if (remaining.length === groups.length) return false;
  pushUndo();
  state.project.groups = remaining;
  emit('groups');
  markDirty();
  return true;
}

export function setEasing(list, es, ed, bez, opts = {}) {
  if (!list.length) return;
  if (!opts.noUndo) pushUndo();
  for (const { itemId, track, t } of list) {
    const tr = trackObj(itemId, track);
    if (!tr) continue;
    const k = tr.keys.find((k) => Math.abs(k.t - t) < 1e-6);
    if (!k) continue;
    if (es !== undefined && es !== null) k.es = es;
    if (ed !== undefined && ed !== null) k.ed = ed;
    if (bez !== undefined) k.bez = bez;
  }
  emit('tracks', {});
  markDirty();
}

export function getKey(itemId, track, t) {
  const tr = trackObj(itemId, track);
  if (!tr) return null;
  return tr.keys.find((k) => Math.abs(k.t - t) < 1e-6) || null;
}

// ---------------------------------------------------------------- unparented (world-space) tracks
// A track with space:'world' stores its keys as ORIGIN-relative part CFrames instead of
// parent-relative joint Transforms — the limb animates independently of its parent hierarchy, so
// the motion pastes onto rigs with different proportions and reproduces the same path in space.
export function trackSpace(itemId, track) {
  return getTrack(itemId, track)?.space === 'world' ? 'world' : 'local';
}
export function unparentedSet(itemId) {
  const out = new Set();
  const tracks = getTracks(itemId);
  for (const [name, tr] of Object.entries(tracks)) {
    if (tr.space === 'world' && !name.startsWith('@')) out.add(name);
  }
  return out;
}
// `convertValue(t, v)` is supplied by the caller (it needs FK the state layer doesn't have) and
// is called with the track still in its OLD space, so evaluation during conversion is consistent.
export function setTrackSpace(itemId, track, space, convertValue) {
  const tr = trackObj(itemId, track, true);
  const from = tr.space === 'world' ? 'world' : 'local';
  if (from === space) return false;
  pushUndo();
  if (convertValue) for (const k of tr.keys) k.v = convertValue(k.t, k.v);
  if (space === 'world') tr.space = 'world';
  else delete tr.space;
  emit('tracks', { itemId, track });
  markDirty();
  return true;
}

// ---------------------------------------------------------------- evaluation
// CFrame track evaluation with per-segment easing (left key's easing shapes the segment)
export function evalTrackCF(itemId, track, t, fallback = CF.IDENTITY) {
  const tr = trackObj(itemId, track);
  if (!tr || !tr.keys.length) return fallback;
  const keys = tr.keys;
  if (t <= keys[0].t) return keys[0].v;
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
  let lo = 0;
  for (let i = 0; i < keys.length - 1; i++) {
    if (t >= keys[i].t && t <= keys[i + 1].t) { lo = i; break; }
  }
  const a = keys[lo], b = keys[lo + 1];
  const span = b.t - a.t || 1;
  const alpha = evalSegment(a, (t - a.t) / span);
  return CF.lerp(a.v, b.v, alpha);
}

export function evalTrackNum(itemId, track, t, fallback = 0) {
  const tr = trackObj(itemId, track);
  if (!tr || !tr.keys.length) return fallback;
  const keys = tr.keys;
  if (t <= keys[0].t) return keys[0].v;
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
  let lo = 0;
  for (let i = 0; i < keys.length - 1; i++) {
    if (t >= keys[i].t && t <= keys[i + 1].t) { lo = i; break; }
  }
  const a = keys[lo], b = keys[lo + 1];
  const span = b.t - a.t || 1;
  const alpha = evalSegment(a, (t - a.t) / span);
  return a.v + (b.v - a.v) * alpha;
}

// ---------------------------------------------------------------- keyframe navigation (J/K)
function allTimesForItem(itemId) {
  const times = new Set();
  const tracks = getTracks(itemId);
  for (const tn of Object.keys(tracks)) for (const k of tracks[tn].keys) times.add(k.t);
  return [...times].sort((a, b) => a - b);
}
export function prevKeyframeTime(itemId, t) {
  const times = itemId ? allTimesForItem(itemId) : allProjectTimes();
  let best = null;
  for (const time of times) if (time < t - 1e-6 && (best === null || time > best)) best = time;
  return best;
}
export function nextKeyframeTime(itemId, t) {
  const times = itemId ? allTimesForItem(itemId) : allProjectTimes();
  let best = null;
  for (const time of times) if (time > t + 1e-6 && (best === null || time < best)) best = time;
  return best;
}
function allProjectTimes() {
  const times = new Set();
  for (const itemId of Object.keys(state.project.tracks)) for (const t of allTimesForItem(itemId)) times.add(t);
  return [...times];
}

export function selectAllKeys(itemId) {
  const out = [];
  const ids = itemId ? [itemId] : state.project.items.map((i) => i.id);
  for (const id of ids) {
    const tracks = getTracks(id);
    for (const tn of Object.keys(tracks)) for (const k of tracks[tn].keys) out.push({ itemId: id, track: tn, t: k.t });
  }
  setSelectedKeys(out);
  return out;
}

// ---------------------------------------------------------------- frame range tools
// Split: insert a keyframe at time t with the currently-interpolated value — a no-visual-change
// "refine the curve" operation you then nudge, matching Moon's M key.
export function splitKeyframe(itemId, track, t) {
  const isNumeric = track === '@fov';
  const value = isNumeric ? evalTrackNum(itemId, track, t) : evalTrackCF(itemId, track, t);
  setKey(itemId, track, t, value);
}
export function splitStride(itemId, track, tStart, tEnd, stride) {
  if (stride <= 0) return;
  pushUndo();
  for (let t = tStart + stride; t < tEnd - 1e-6; t += stride) {
    splitKeyframeNoUndo(itemId, track, t);
  }
  emit('tracks', {});
  markDirty();
}
function splitKeyframeNoUndo(itemId, track, t) {
  const isNumeric = track === '@fov';
  const value = isNumeric ? evalTrackNum(itemId, track, t) : evalTrackCF(itemId, track, t);
  setKey(itemId, track, t, value, { noUndo: true });
}

// Fill: bake every intermediate frame in [tStart, tEnd] into an explicit keyframe holding
// the currently-interpolated value, at the given frame step — turns a smooth curve into
// an explicit per-frame one so each frame can be hand-tuned independently.
export function fillFrames(itemId, track, tStart, tEnd, step = 1) {
  pushUndo();
  const isNumeric = track === '@fov';
  for (let t = Math.ceil(tStart); t <= Math.floor(tEnd); t += step) {
    const value = isNumeric ? evalTrackNum(itemId, track, t) : evalTrackCF(itemId, track, t);
    setKey(itemId, track, t, value, { noUndo: true });
  }
  emit('tracks', {});
  markDirty();
}

// Repeat: duplicate the keyframe range spanned by `list` forward `times` more times back-to-back.
export function repeatFrames(list, times) {
  if (!list.length || times < 1) return;
  const byRef = list.map((r) => ({ ref: r, key: getKey(r.itemId, r.track, r.t) })).filter((x) => x.key);
  if (!byRef.length) return;
  const minT = Math.min(...byRef.map((x) => x.ref.t));
  const maxT = Math.max(...byRef.map((x) => x.ref.t));
  const span = maxT - minT;
  if (span <= 0) return;
  pushUndo();
  for (let rep = 1; rep <= times; rep++) {
    const offset = (span + 1) * rep;
    for (const { ref, key } of byRef) {
      setKey(ref.itemId, ref.track, ref.t + offset, structuredClone(key.v), { noUndo: true, es: key.es, ed: key.ed, bez: key.bez });
    }
  }
  const newEnd = maxT + (span + 1) * times;
  if (newEnd > state.project.length) state.project.length = Math.ceil(newEnd);
  emit('tracks', {});
  emit('project-props');
  markDirty();
}

// Stretch: scale the time-spacing of the selected keys by `factor`, anchored at the range start.
export function stretchFrames(list, factor) {
  if (!list.length || factor <= 0) return;
  const byRef = list.map((r) => ({ ref: r, key: getKey(r.itemId, r.track, r.t) })).filter((x) => x.key);
  if (!byRef.length) return;
  const minT = Math.min(...byRef.map((x) => x.ref.t));
  pushUndo();
  // grab first (removes so we don't collide with ourselves while rewriting times)
  const grabbed = byRef.map(({ ref, key }) => ({ itemId: ref.itemId, track: ref.track, key }));
  for (const g of grabbed) {
    const tr = trackObj(g.itemId, g.track);
    if (!tr) continue;
    tr.keys = tr.keys.filter((k) => k !== g.key);
  }
  const moved = [];
  for (const g of grabbed) {
    const tr = trackObj(g.itemId, g.track, true);
    const nt = Math.max(0, Math.round(minT + (g.key.t - minT) * factor));
    tr.keys = tr.keys.filter((k) => Math.abs(k.t - nt) > 1e-6);
    g.key.t = nt;
    tr.keys.push(g.key);
    tr.keys.sort((a, b) => a.t - b.t);
    moved.push({ itemId: g.itemId, track: g.track, t: nt });
  }
  emit('tracks', {});
  markDirty();
  return moved;
}

// Reverse: mirrors the selected keys' time order within their bounding range (same anchor
// convention as stretchFrames). Each key keeps its own value + easing traveling with it to its
// new slot — a simple, honest approximation rather than deriving mathematically exact reversed
// curve shapes, which fits "reverse time" being a quick stylistic effect, not precision curve
// editing (this is the same level of rigor stretchFrames already uses).
export function reverseFrames(list) {
  if (!list.length) return;
  const byRef = list.map((r) => ({ ref: r, key: getKey(r.itemId, r.track, r.t) })).filter((x) => x.key);
  if (!byRef.length) return;
  const minT = Math.min(...byRef.map((x) => x.ref.t));
  const maxT = Math.max(...byRef.map((x) => x.ref.t));
  pushUndo();
  const grabbed = byRef.map(({ ref, key }) => ({ itemId: ref.itemId, track: ref.track, key }));
  for (const g of grabbed) {
    const tr = trackObj(g.itemId, g.track);
    if (!tr) continue;
    tr.keys = tr.keys.filter((k) => k !== g.key);
  }
  const moved = [];
  for (const g of grabbed) {
    const tr = trackObj(g.itemId, g.track, true);
    const nt = Math.round(minT + (maxT - g.key.t));
    tr.keys = tr.keys.filter((k) => Math.abs(k.t - nt) > 1e-6);
    g.key.t = nt;
    tr.keys.push(g.key);
    tr.keys.sort((a, b) => a.t - b.t);
    moved.push({ itemId: g.itemId, track: g.track, t: nt });
  }
  emit('tracks', {});
  markDirty();
  return moved;
}

// ---------------------------------------------------------------- resize (Scale gizmo)
// A resize is baked directly into the rig's REST definition (part sizes, joint offsets, mesh
// scale) rather than being an animatable keyframed property — CFrames in this app are pure
// position+rotation with no scale slot, and a real Roblox rig resize genuinely needs its part
// sizes changed, not just a cosmetic render-time stretch, so the joint solver and every other
// pose/animation code path never need to know scale exists at all.
export function resizeItem(itemId, factor) {
  const item = getItem(itemId);
  if (!item || !item.rig || !(factor > 0) || Math.abs(factor - 1) < 1e-4) return;
  pushUndo();
  for (const p of item.rig.parts) {
    p.size = p.size.map((s) => s * factor);
    p.cf = p.cf.map((v, i) => (i < 3 ? v * factor : v)); // only the position components (0-2)
    if (p.specialMesh) {
      p.specialMesh.scale = (p.specialMesh.scale || [1, 1, 1]).map((s) => s * factor);
      p.specialMesh.offset = (p.specialMesh.offset || [0, 0, 0]).map((o) => o * factor);
    }
  }
  for (const j of item.rig.joints || []) {
    j.c0 = j.c0.map((v, i) => (i < 3 ? v * factor : v));
    j.c1 = j.c1.map((v, i) => (i < 3 ? v * factor : v));
  }
  emit('items');
  markDirty();
}

// ---------------------------------------------------------------- rigging tools
// In-app joint editing: build an animatable rig out of loose parts (or fix a broken one) without
// round-tripping through Studio. Joints live in item.rig.joints — the same definitions imports
// produce — so everything downstream (solver, timeline, export) picks them up with no special
// casing. Callers must refreshInstance(itemId) afterward to rebuild the three.js instance.

// Walks the joint graph upward from `partId` (part1 → part0). Used to reject cycles: a new joint
// part0→part1 is invalid if part1 is already an ancestor of part0.
function jointAncestors(rig, partId) {
  const out = new Set();
  let cur = partId;
  for (let i = 0; i < (rig.joints || []).length + 1; i++) {
    const j = (rig.joints || []).find((jj) => jj.part1 === cur);
    if (!j || out.has(j.part0)) break;
    out.add(j.part0);
    cur = j.part0;
  }
  return out;
}

export function addJoint(itemId, { name, kind, part0, part1 }) {
  const item = getItem(itemId);
  if (!item || !item.rig) throw new Error('No rig on that item');
  const rig = item.rig;
  const p0 = rig.parts.find((p) => p.id === part0 || p.name === part0);
  const p1 = rig.parts.find((p) => p.id === part1 || p.name === part1);
  if (!p0) throw new Error(`No part "${part0}" on ${item.name}`);
  if (!p1) throw new Error(`No part "${part1}" on ${item.name}`);
  if (p0.id === p1.id) throw new Error('Part0 and Part1 must be different parts');
  const isMotor = kind !== 'weld';
  if (isMotor && p1.id === rig.rootPart) throw new Error('The root part cannot be driven by a joint — pick it as Part0 instead');
  if (isMotor && (rig.joints || []).some((j) => j.kind !== 'weld' && j.part1 === p1.id)) {
    throw new Error(`${p1.name} is already driven by another Motor6D — delete that joint first`);
  }
  if (jointAncestors(rig, p0.id).has(p1.id)) throw new Error('That would create a joint cycle');

  // Unique joint name (motor track names ARE joint names — a duplicate would merge tracks).
  let jointName = name || `${p1.name}Joint`;
  const taken = new Set((rig.joints || []).map((j) => j.name));
  let i = 2;
  while (taken.has(jointName)) jointName = `${name || `${p1.name}Joint`}#${i++}`;

  // C0/C1 from the REST definition (parts' root-relative bind CFrames), not the current animated
  // pose — creating a joint mid-animation must not bake today's pose into the rig's geometry.
  // Pivot at Part1's rest origin (Studio's own convention when scripting a Motor6D), so
  // C0 = P0rest⁻¹ · P1rest and C1 = identity.
  const c0 = CF.mul(CF.inverse(p0.cf), p1.cf);
  const c1 = CF.IDENTITY.slice();

  pushUndo();
  rig.joints = rig.joints || [];
  const joint = { name: jointName, part0: p0.id, part1: p1.id, c0, c1 };
  if (!isMotor) joint.kind = 'weld';
  rig.joints.push(joint);
  emit('items');
  markDirty();
  return joint;
}

export function removeJoint(itemId, jointName) {
  const item = getItem(itemId);
  if (!item || !item.rig) throw new Error('No rig on that item');
  const j = (item.rig.joints || []).find((jj) => jj.name === jointName);
  if (!j) throw new Error(`No joint named "${jointName}" on ${item.name}`);
  pushUndo();
  item.rig.joints = item.rig.joints.filter((jj) => jj !== j);
  // A motor's animation track dies with it — orphan tracks would silently re-merge if a
  // same-named joint is ever recreated.
  if (j.kind !== 'weld' && state.project.tracks[itemId]) delete state.project.tracks[itemId][jointName];
  emit('items');
  emit('tracks', {});
  markDirty();
  return true;
}

// Weld → Motor6D makes a rigid attachment animatable; Motor6D → Weld freezes it (and drops its
// track, same reasoning as removeJoint).
export function convertJoint(itemId, jointName) {
  const item = getItem(itemId);
  if (!item || !item.rig) throw new Error('No rig on that item');
  const j = (item.rig.joints || []).find((jj) => jj.name === jointName);
  if (!j) throw new Error(`No joint named "${jointName}" on ${item.name}`);
  if (j.kind === 'weld') {
    const p1 = item.rig.parts.find((p) => p.id === j.part1);
    if (p1 && j.part1 === item.rig.rootPart) throw new Error('The root part cannot be driven by a motor');
    if ((item.rig.joints || []).some((jj) => jj !== j && jj.kind !== 'weld' && jj.part1 === j.part1)) {
      throw new Error(`${p1?.name || j.part1} is already driven by a Motor6D`);
    }
    pushUndo();
    delete j.kind;
  } else {
    pushUndo();
    j.kind = 'weld';
    if (state.project.tracks[itemId]) delete state.project.tracks[itemId][jointName];
  }
  emit('items');
  emit('tracks', {});
  markDirty();
  return j;
}

// ---------------------------------------------------------------- mirror / reflect (Ctrl+R)
function mirrorPartnerName(name) {
  if (/left/i.test(name)) return name.replace(/Left/g, 'Right').replace(/left/g, 'right');
  if (/right/i.test(name)) return name.replace(/Right/g, 'Left').replace(/right/g, 'left');
  return null;
}
// Swaps Left*/Right* joint tracks (mirroring each CFrame) and mirrors symmetric joints in place.
export function mirrorItem(itemId) {
  const tracks = getTracks(itemId);
  const names = Object.keys(tracks).filter((n) => !n.startsWith('@'));
  if (!names.length) return;
  pushUndo();
  const handled = new Set();
  for (const name of names) {
    if (handled.has(name)) continue;
    const partner = mirrorPartnerName(name);
    if (partner && tracks[partner] && !handled.has(partner)) {
      const a = structuredClone(tracks[name].keys);
      const b = structuredClone(tracks[partner].keys);
      tracks[name].keys = b.map((k) => ({ ...k, v: CF.mirror(k.v) }));
      tracks[partner].keys = a.map((k) => ({ ...k, v: CF.mirror(k.v) }));
      handled.add(name); handled.add(partner);
    } else if (!partner) {
      tracks[name].keys = tracks[name].keys.map((k) => ({ ...k, v: CF.mirror(k.v) }));
      handled.add(name);
    }
  }
  emit('tracks', {});
  markDirty();
}

// ---------------------------------------------------------------- onion skin (N/B/Alt+B)
export function toggleOnionSkin(itemId) {
  const os = state.project.onionSkin;
  const i = os.enabledItemIds.indexOf(itemId);
  if (i >= 0) os.enabledItemIds.splice(i, 1);
  else os.enabledItemIds.push(itemId);
  emit('onion');
  markDirty();
  return os.enabledItemIds.includes(itemId);
}
export function setOnionSkin(itemId, on) {
  const os = state.project.onionSkin;
  const has = os.enabledItemIds.includes(itemId);
  if (on && !has) os.enabledItemIds.push(itemId);
  else if (!on && has) os.enabledItemIds = os.enabledItemIds.filter((id) => id !== itemId);
  else return;
  emit('onion');
  markDirty();
}
export function clearAllOnionSkins() {
  state.project.onionSkin.enabledItemIds = [];
  emit('onion');
  markDirty();
}

// The pose of every joint of an item at time t: { [jointName]: cf }
export function evalPose(item, t) {
  const pose = {};
  const tracks = getTracks(item.id);
  for (const trackName of Object.keys(tracks)) {
    if (trackName.startsWith('@')) continue;
    pose[trackName] = evalTrackCF(item.id, trackName, t, CF.IDENTITY);
  }
  return pose;
}

export function setProjectProp(prop, value) {
  pushUndo();
  state.project[prop] = value;
  emit('project-props');
  markDirty();
}
