// Project state, undo/redo, autosave, track evaluation.
import * as CF from './cf.js';
import { evalSegment, paramsFor } from './easing.js';
import { propertyDef, defaultPropertiesFor, defaultValueFor, tweenValue, tweenOf, ACTIONS } from './propTracks.js';

// DISPLAY ONLY — never use this for a track/joint/part key, lookup, or export. Roblox's own
// R15 part/joint names have no spaces (UpperTorso, RightShoulder, LeftAnkle) and MUST stay that
// way everywhere they're actually used (set_keyframe, exported .rbxm data, Motor6D/joint lookups
// in rigbuild.js) or animations break when brought into Studio. This only inserts a space before
// each internal capital for readability in the timeline/inspector text — R6 names that already
// have spaces (Left Shoulder) are untouched since the regex only matches a missing boundary.
export function humanizeRigName(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

// ---------------------------------------------------------------- events
const listeners = new Map();
export function on(type, cb) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(cb);
  return () => listeners.get(type).delete(cb);
}
export function emit(type, data) {
  if (type === 'tracks') invalidateTrackCache(data);
  (listeners.get(type) || []).forEach((cb) => { try { cb(data); } catch (e) { console.error(e); } });
  if (type !== 'playhead' && type !== 'playing') (listeners.get('any') || []).forEach((cb) => cb(type));
}

// Every track mutator (setKey, deleteKeys, moveKeys, setEasing, mirrorItem, fillFrames, ...)
// already emits 'tracks' right after touching keys/easing/space — hooking invalidation here
// once, instead of in each of those functions, means a future mutator gets cache-safety for
// free just by following the existing emit convention. {itemId,track} clears just that track's
// cache (the common single-key-edit case); no payload (bulk ops, undo/redo project-swap) clears
// every track's cache.
function invalidateTrackCache(data) {
  const tracks = state.project && state.project.tracks;
  if (!tracks) return;
  if (data && data.itemId && data.track) {
    const tr = tracks[data.itemId] && tracks[data.itemId][data.track];
    if (tr) trackEvalCache.delete(tr);
    return;
  }
  for (const itemTracks of Object.values(tracks)) {
    for (const tr of Object.values(itemTracks)) trackEvalCache.delete(tr);
  }
}

// Evaluated-value cache for evalTrackCF/evalTrackNum, keyed by the track object's OWN IDENTITY —
// deliberately NOT a property on the track object itself. `serialize()` is a raw
// `JSON.stringify(state.project)` and undo/redo's snapshot()/applySnapshot() round-trip through
// `structuredClone` — a `Map` stored as an enumerable field on a serializable object survives
// structuredClone fine, but a save/load round trip (real JSON, no Map support) silently turns it
// into `{}`, which is truthy but not a Map — a subsequent `tr._cfCache.has(t)` would then throw
// "has is not a function" (hit exactly this crashing a real smoketest run before the WeakMap
// rewrite). Keeping the cache in a WeakMap outside `state.project` entirely means a
// loaded/cloned track is just a new object identity with no entry yet — cache miss, not corrupt
// data — so this failure mode can't recur regardless of what cloning mechanism touches tracks.
const trackEvalCache = new WeakMap(); // tr -> { cf: Map<t,cf>, num: Map<t,num> }
function trackCache(tr) {
  let c = trackEvalCache.get(tr);
  if (!c) { c = { cf: new Map(), num: new Map() }; trackEvalCache.set(tr, c); }
  return c;
}

// ---------------------------------------------------------------- state
export const state = {
  project: null,
  selection: { itemId: null, partId: null, keys: [], markers: [] }, // keys/markers: [{itemId, track, t}] / [{itemId, t}]
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
  trackpadMode: false, // Blender-style "emulate 3 button mouse": Alt+LMB orbits/pans/dollies
  showSeconds: false,
  uiHidden: false, // Ctrl+H focus mode
  cameraTracksVisible: true,
  // Moon's Options menu: "Use Last Ease" makes a new keyframe inherit the last applied easing,
  // "Easing Colors" tints keyframes in the dope sheet by their ease style.
  useLastEasing: false,
  easeColors: false,
  lastEasing: null, // {es, ed, bez, ep} — the most recent ease applied via setEasing
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
    markers: {}, // itemId -> [{t, width, name, codeBegin, codeEnd, kf}] — Moon's Events track
    playRange: null, // {start, end} — Moon's PlayArea; null means the whole animation
    onionSkin: { enabledItemIds: [], range: 3 },
    audio: null, // { name, path, offset, volume }
  };
  state.selection = { itemId: null, partId: null, keys: [], markers: [] };
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
  p.markers = p.markers || {}; // projects saved before markers existed simply have none
  p.playRange = p.playRange || null;
  p.onionSkin = p.onionSkin || { enabledItemIds: [], range: 3 };
  state.project = p;
  state.projectPath = filePath;
  state.selection = { itemId: null, partId: null, keys: [], markers: [] };
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

// A part's `customMesh` / `customTexture` is immutable while animating — posing,
// keyframing and timeline edits never touch it — but it dominates the project's
// size: an imported mesh rig with embedded textures runs to tens of MB (a real
// one measured 81.6 MB, because the same baked atlas is stored once per part).
// Deep-cloning that on EVERY setKey pushed multiple GB through the undo stack
// and OOM-crashed the renderer after a few dozen keyframes — hit both by MCP
// batches and by anyone hand-keying a mesh rig.
//
// So: clone everything undo can actually change, and carry the immutable
// geometry across by reference instead (strings are immutable, so sharing them
// between snapshots costs nothing). Keyed by item/part id so it still reattaches
// correctly after an undo that reorders or removes items.
const HEAVY_FIELDS = ['customMesh', 'customTexture'];

function partKey(pt, i) {
  return pt.id ?? pt.name ?? i;
}

function stashHeavy(items) {
  const stash = new Map();
  const lite = items.map((it) => {
    const parts = it.rig && it.rig.parts;
    if (!Array.isArray(parts) || !parts.length) return it;
    const perPart = new Map();
    let found = false;
    const litParts = parts.map((pt, i) => {
      let copy = pt;
      for (const f of HEAVY_FIELDS) {
        if (pt[f] === undefined) continue;
        if (!found) { found = true; }
        if (copy === pt) copy = { ...pt };
        const bag = perPart.get(partKey(pt, i)) || {};
        bag[f] = pt[f];
        perPart.set(partKey(pt, i), bag);
        delete copy[f];
      }
      return copy;
    });
    if (!found) return it;
    stash.set(it.id, perPart);
    return { ...it, rig: { ...it.rig, parts: litParts } };
  });
  return { lite, stash };
}

function restoreHeavy(items, stash) {
  if (!stash || !stash.size) return;
  for (const it of items || []) {
    const perPart = stash.get(it.id);
    const parts = it.rig && it.rig.parts;
    if (!perPart || !Array.isArray(parts)) continue;
    parts.forEach((pt, i) => {
      const bag = perPart.get(partKey(pt, i));
      if (!bag) return;
      for (const f of HEAVY_FIELDS) {
        if (bag[f] !== undefined) pt[f] = bag[f];
      }
    });
  }
}

function snapshot() {
  const p = state.project;
  const { lite, stash } = stashHeavy(p.items);
  const s = structuredClone({ items: lite, tracks: p.tracks, groups: p.groups, markers: p.markers || {}, playRange: p.playRange || null, onionSkin: p.onionSkin, length: p.length, fps: p.fps, loop: p.loop, priority: p.priority, name: p.name, audio: p.audio });
  s.__heavy = stash;               // attached AFTER the clone — never deep-copied
  return s;
}
function applySnapshot(s) {
  const { __heavy, ...rest } = s;
  const next = structuredClone(rest);
  restoreHeavy(next.items, __heavy);
  Object.assign(state.project, next);
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

// VFX emitter appearance (color/size/transparency-over-particle-life, spread, gravity, pool cap)
// — NOT keyframed, unlike @rate/@lifetime/@speed, since these describe a single particle's own
// look across ITS short life rather than something meaningful to animate across the timeline.
export function setVfxEmitter(itemId, patch) {
  const item = getItem(itemId);
  if (!item || item.kind !== 'vfx') return;
  pushUndo();
  item.emitter = { ...item.emitter, ...patch };
  emit('items');
  markDirty();
}

// A VFX Studio effect document replaces wholesale (edited as a unit in the studio window, not
// patched field-by-field the way a plain vfx item's emitter is) — item.effect, item.effectStart
// (the project frame where the doc's own frame 0 lands), item.effectLoop (loop the doc past its
// own duration, independent of any per-layer clip.loop inside it).
export function setEffectDoc(itemId, doc, { effectStart, effectLoop } = {}) {
  const item = getItem(itemId);
  if (!item || item.kind !== 'effect') return;
  pushUndo();
  item.effect = doc;
  if (typeof effectStart === 'number') item.effectStart = Math.max(0, Math.round(effectStart));
  if (typeof effectLoop === 'boolean') item.effectLoop = effectLoop;
  emit('items');
  markDirty();
}

// Doc-frame <-> project-frame mapping (docs/vfx-studio.md "Frame-space contract"): everything
// inside an effect document samples in its own frame/fps space; item.effectStart is where the
// document's frame 0 sits on the ANIMATOR's timeline, and effectLoop repeats the whole document
// (not just an individual layer's clip.loop) once its own duration elapses.
export function effectDocFrame(item, projectFrame) {
  const doc = item.effect;
  const rel = projectFrame - (item.effectStart || 0);
  if (rel < 0) return -1; // hasn't started yet — caller treats negative as "nothing to show"
  let f = Math.floor((rel * (doc.fps || 30)) / (state.project.fps || 30));
  if (item.effectLoop && doc.duration > 0) f = f % doc.duration;
  return f;
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
  if (!keepKeys) { state.selection.keys = []; state.selection.markers = []; }
  emit('selection');
}
export function setSelectedKeys(keys) {
  state.selection.markers = []; // keys and markers are separate selections, never mixed
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

// ---------------------------------------------------------------- play range (Moon's PlayArea)
// Playback is confined to [start, end] instead of the whole animation, so you can loop a few
// frames while polishing them. Stored on the project (it is an editing decision worth saving,
// and Moon persists it in its own save format too). A null range means "the whole animation".
export function playRange() {
  const p = state.project;
  const r = p && p.playRange;
  if (!r) return { start: 0, end: p ? p.length : 0, full: true };
  const start = Math.max(0, Math.min(r.start, p.length));
  const end = Math.max(start, Math.min(r.end, p.length));
  return { start, end, full: start === 0 && end === p.length };
}

export function setPlayRange(start, end, opts = {}) {
  const p = state.project;
  if (!p) return;
  if (start == null && end == null) {
    if (!opts.noUndo) pushUndo();
    p.playRange = null;
  } else {
    const cur = playRange();
    let s = Math.round(start ?? cur.start);
    let e = Math.round(end ?? cur.end);
    if (s > e) [s, e] = [e, s]; // dragging the start past the end swaps rather than inverting
    s = Math.max(0, Math.min(s, p.length));
    e = Math.max(s, Math.min(e, p.length));
    if (!opts.noUndo) pushUndo();
    p.playRange = { start: s, end: e };
  }
  emit('play-range');
  markDirty();
  return playRange();
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
    if (opts.ep !== undefined) existing.ep = opts.ep;
  } else {
    // Moon's "Use Last Ease" option: a newly created keyframe inherits whatever ease was last
    // applied, instead of always resetting to the default. `opts.es` still wins when given.
    const inherit = (!opts.es && state.useLastEasing) ? state.lastEasing : null;
    tr.keys.push({
      t,
      v: value,
      es: opts.es || inherit?.es || 'Cubic',
      ed: opts.ed || inherit?.ed || 'Out',
      bez: opts.bez ?? inherit?.bez ?? null,
      ep: opts.ep ?? (inherit?.ep ? { ...inherit.ep } : null),
    });
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

// `ep` carries the style's extra parameters (Back's Overshoot, Elastic's Amplitude/Period),
// matching Moon's Ease params table. Pass null to clear them back to the style defaults.
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
    if (opts.ep !== undefined) k.ep = opts.ep ? { ...opts.ep } : null;
    // Changing the style drops parameters that style does not accept, so a Back key that
    // becomes a Quad key cannot keep a stale Overshoot around to reappear later.
    if (es) {
      const allowed = paramsFor(es);
      if (!allowed.length) k.ep = null;
      else if (k.ep) {
        const next = {};
        for (const p of allowed) if (k.ep[p] != null) next[p] = k.ep[p];
        k.ep = Object.keys(next).length ? next : null;
      }
    }
  }
  // Remember the most recent ease for Moon's "Use Last Ease" behaviour on new keyframes.
  if (es || ed || bez !== undefined) {
    const first = getKey(list[0].itemId, list[0].track, list[0].t);
    if (first) state.lastEasing = { es: first.es, ed: first.ed, bez: first.bez, ep: first.ep ? { ...first.ep } : null };
  }
  emit('tracks', {});
  markDirty();
}

export function getKey(itemId, track, t) {
  const tr = trackObj(itemId, track);
  if (!tr) return null;
  return tr.keys.find((k) => Math.abs(k.t - t) < 1e-6) || null;
}

// ---------------------------------------------------------------- property & action tracks
// A `prop` item is a named Roblox instance whose properties are being animated — Moon's
// equivalent of adding a Lighting / ParticleEmitter / Sound / GUI object to the timeline.
// `target` is the instance path the generated Luau resolves at runtime (e.g.
// "Workspace.Campfire.Fire"); service-level targets like "Lighting" are just the service name.
//
// Track naming on a prop item:
//   "Transparency"        a property track  (its value type comes from the registry)
//   "@act:Sound.Play"     an action track   (one-shot calls, fired when playback crosses the key)
export const ACTION_PREFIX = '@act:';
export function isActionTrack(track) { return typeof track === 'string' && track.startsWith(ACTION_PREFIX); }
export function actionKeyOf(track) { return isActionTrack(track) ? track.slice(ACTION_PREFIX.length) : null; }

export function addPropItem({ name, className, target, withDefaults = true }) {
  const item = {
    id: crypto.randomUUID(),
    kind: 'prop',
    name: name || target || className,
    className,
    target: target || '',
  };
  addItem(item);
  if (withDefaults) {
    for (const p of defaultPropertiesFor(className)) addPropertyTrack(item.id, p, { noUndo: true });
  }
  emit('tracks', {});
  return item;
}

// The value type is recorded ON the track (`vtype`) rather than re-derived from the class each
// time: the item's className could be edited later, and an existing track's keys must keep
// being read as whatever they were authored as.
export function addPropertyTrack(itemId, prop, opts = {}) {
  const item = getItem(itemId);
  if (!item) return null;
  const def = propertyDef(item.className, prop);
  if (!def) return null;
  if (!opts.noUndo) pushUndo();
  const tr = trackObj(itemId, prop, true);
  tr.vtype = def.type;
  if (!opts.noUndo) { emit('tracks', { itemId, track: prop }); markDirty(); }
  return tr;
}

export function addActionTrack(itemId, actionKey, opts = {}) {
  if (!ACTIONS[actionKey]) return null;
  if (!opts.noUndo) pushUndo();
  const name = ACTION_PREFIX + actionKey;
  const tr = trackObj(itemId, name, true);
  tr.vtype = ACTIONS[actionKey].arg || 'boolean';
  tr.action = actionKey;
  if (!opts.noUndo) { emit('tracks', { itemId, track: name }); markDirty(); }
  return tr;
}

export function removeTrack(itemId, track) {
  const t = state.project.tracks[itemId];
  if (!t || !t[track]) return false;
  pushUndo();
  delete t[track];
  state.selection.keys = state.selection.keys.filter((k) => !(k.itemId === itemId && k.track === track));
  emit('tracks', {});
  emit('selection');
  markDirty();
  return true;
}

// The value type a track's keys hold. Falls back to the registry (for tracks written before
// vtype existed) and finally to CFrame, which is what every rig/origin track is.
export function trackValueType(itemId, track) {
  const tr = trackObj(itemId, track);
  if (tr && tr.vtype) return tr.vtype;
  if (isActionTrack(track)) return ACTIONS[actionKeyOf(track)]?.arg || 'boolean';
  const item = getItem(itemId);
  if (item && item.className) {
    const def = propertyDef(item.className, track);
    if (def) return def.type;
  }
  if (isNumericTrack(track)) return 'number';
  return 'CFrame';
}

// Generic typed evaluation, dispatching on the track's value type. CFrame and plain-number
// tracks keep using the existing dedicated (and cached) evaluators so nothing regresses.
export function evalTrackValue(itemId, track, t, fallback) {
  const type = trackValueType(itemId, track);
  if (type === 'CFrame') return evalTrackCF(itemId, track, t, fallback ?? CF.IDENTITY);
  if (tweenOf(type) === 'number') return evalTrackNum(itemId, track, t, fallback ?? 0);
  const tr = trackObj(itemId, track);
  if (!tr || !tr.keys.length) return fallback ?? defaultValueFor(type);
  const keys = tr.keys;
  if (t <= keys[0].t) return keys[0].v;
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
  let lo = 0;
  for (let i = 0; i < keys.length - 1; i++) {
    if (t >= keys[i].t && t <= keys[i + 1].t) { lo = i; break; }
  }
  const a = keys[lo], b = keys[lo + 1];
  const span = b.t - a.t || 1;
  const alpha = evalSegment(a, (t - a.t) / span, span);
  return tweenValue(type, a.v, b.v, alpha);
}

// Every action key strictly inside (t0, t1] — what a playhead crossing that span should fire.
// Used by the Luau exporter; Cadence itself never executes them (no Roblox runtime here).
export function actionEventsBetween(itemId, t0, t1) {
  const out = [];
  const tracks = getTracks(itemId);
  for (const name of Object.keys(tracks)) {
    if (!isActionTrack(name)) continue;
    for (const k of tracks[name].keys) {
      if (k.t > t0 && k.t <= t1) out.push({ track: name, action: actionKeyOf(name), t: k.t, v: k.v });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------- markers ("Events" track)
// A port of Moon's Marker / MarkerTrack. Unlike a keyframe, a marker spans a RANGE: it has a
// start frame plus a `width`, so it reads as a labelled bar on the item's Events lane.
//
//   name       display label on the bar
//   width      length in frames (0 = a single-frame marker)
//   codeBegin  Luau to run when playback reaches the marker's start
//   codeEnd    Luau to run when playback reaches its end
//   kf         {key: value} pairs exported as Roblox KeyframeMarkers on that frame
//
// codeBegin/codeEnd are STORED AND EXPORTED but never executed by Cadence. Moon can run them
// because it lives inside Studio with a real Luau VM; this app is an Electron renderer with no
// Luau runtime, and its CSP has no 'unsafe-eval' by design. They run in Studio after export.
export function getMarkers(itemId) {
  if (!state.project.markers) state.project.markers = {};
  return state.project.markers[itemId] || [];
}
function markerList(itemId, create = false) {
  if (!state.project.markers) state.project.markers = {};
  if (!state.project.markers[itemId] && create) state.project.markers[itemId] = [];
  return state.project.markers[itemId];
}
export function getMarker(itemId, t) {
  return getMarkers(itemId).find((m) => Math.abs(m.t - t) < 1e-6) || null;
}
// The marker whose [t, t+width] span contains `frame`, if any.
export function markerSpanning(itemId, frame) {
  return getMarkers(itemId).find((m) => frame >= m.t && frame <= m.t + (m.width || 0)) || null;
}

export function addMarker(itemId, t, patch = {}) {
  t = Math.max(0, Math.round(t));
  if (getMarker(itemId, t)) return null; // one marker per start frame, as in Moon
  pushUndo();
  const list = markerList(itemId, true);
  const m = {
    t,
    width: Math.max(0, Math.round(patch.width ?? 0)),
    name: patch.name ?? '',
    codeBegin: patch.codeBegin ?? '',
    codeEnd: patch.codeEnd ?? '',
    kf: patch.kf ? { ...patch.kf } : {},
  };
  list.push(m);
  list.sort((a, b) => a.t - b.t);
  emit('markers', { itemId });
  markDirty();
  return m;
}

// `opts.noUndo` is for live-mutating drags (the timeline's marker resize): those push a single
// undo entry at gesture START and then mutate freely, exactly like curves.js's bezier drag.
// Pushing per-move would both spam and OOM the undo stack.
export function setMarker(itemId, t, patch, opts = {}) {
  const m = getMarker(itemId, t);
  if (!m) return null;
  if (!opts.noUndo) pushUndo();
  if (patch.name !== undefined) m.name = patch.name;
  if (patch.codeBegin !== undefined) m.codeBegin = patch.codeBegin;
  if (patch.codeEnd !== undefined) m.codeEnd = patch.codeEnd;
  if (patch.kf !== undefined) m.kf = patch.kf ? { ...patch.kf } : {};
  if (patch.width !== undefined) m.width = clampMarkerWidth(itemId, m, patch.width);
  emit('markers', { itemId });
  markDirty();
  return m;
}

// Moon caps a marker's width at the next marker's start (EditMarkers computes exactly this
// maxWidth), so two markers on one lane can never overlap.
function clampMarkerWidth(itemId, m, want) {
  const list = getMarkers(itemId);
  const next = list.find((o) => o.t > m.t + 1e-6);
  const limit = next ? next.t - m.t - 1 : Math.max(0, state.project.length - m.t);
  return Math.max(0, Math.min(Math.round(want), limit));
}

export function deleteMarkers(list) {
  if (!list.length) return;
  pushUndo();
  for (const { itemId, t } of list) {
    const arr = markerList(itemId);
    if (!arr) continue;
    state.project.markers[itemId] = arr.filter((m) => Math.abs(m.t - t) > 1e-6);
  }
  state.selection.markers = [];
  emit('markers', {});
  emit('selection');
  markDirty();
}

export function moveMarkers(list, dt, opts = {}) {
  if (!list.length || !dt) return list;
  if (!opts.noUndo) pushUndo();
  const grabbed = [];
  for (const { itemId, t } of list) {
    const arr = markerList(itemId);
    if (!arr) continue;
    const m = arr.find((x) => Math.abs(x.t - t) < 1e-6);
    if (!m) continue;
    grabbed.push({ itemId, m });
    state.project.markers[itemId] = arr.filter((x) => x !== m);
  }
  const moved = [];
  for (const { itemId, m } of grabbed) {
    const arr = markerList(itemId, true);
    const nt = Math.max(0, Math.round(m.t + dt));
    // Landing on an occupied start frame drops the mover rather than silently merging two
    // markers into one — same "one marker per start frame" rule addMarker enforces.
    if (arr.some((x) => Math.abs(x.t - nt) < 1e-6)) { arr.push(m); arr.sort((a, b) => a.t - b.t); continue; }
    m.t = nt;
    arr.push(m);
    arr.sort((a, b) => a.t - b.t);
    moved.push({ itemId, t: nt });
  }
  // widths may now overlap a neighbour that moved, so re-clamp every touched lane
  for (const itemId of new Set(grabbed.map((g) => g.itemId))) {
    for (const m of getMarkers(itemId)) m.width = clampMarkerWidth(itemId, m, m.width);
  }
  state.selection.markers = moved;
  emit('markers', {});
  emit('selection');
  markDirty();
  return moved;
}

export function setSelectedMarkers(list) {
  state.selection.keys = [];
  state.selection.markers = list;
  emit('selection');
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
// Both evaluators memoize by exact `t`, via trackCache() (see above — NOT a property on the
// track object), but ONLY for whole-frame queries (Number.isInteger(t)) — every repeat-read call
// site (get_pose/render_frame/validate_animation, stepped nav, snapped scrub, export) always
// samples a literal integer frame, often the SAME one many times in a row (e.g. orbiting the
// camera while paused re-runs updateScene()->evalPose() every rAF tick at an unchanged playhead).
// Real-time Play, by contrast, advances the playhead continuously (see loop() in app.js:
// `playhead + dt*fps`) — every t during Play is essentially unique, so caching it would be
// all-miss and would grow the Map forever for as long as Play runs. Skipping the fractional case
// sidesteps that leak entirely rather than needing any eviction policy.
export function evalTrackCF(itemId, track, t, fallback = CF.IDENTITY) {
  const tr = trackObj(itemId, track);
  if (!tr || !tr.keys.length) return fallback;
  const useCache = Number.isInteger(t);
  const cache = useCache ? trackCache(tr).cf : null;
  if (cache && cache.has(t)) return cache.get(t);
  const keys = tr.keys;
  let result;
  if (t <= keys[0].t) result = keys[0].v;
  else if (t >= keys[keys.length - 1].t) result = keys[keys.length - 1].v;
  else {
    let lo = 0;
    for (let i = 0; i < keys.length - 1; i++) {
      if (t >= keys[i].t && t <= keys[i + 1].t) { lo = i; break; }
    }
    const a = keys[lo], b = keys[lo + 1];
    const span = b.t - a.t || 1;
    // `span` is also handed to evalSegment so Elastic's frame-relative Period reads the same
    // on a short and a long segment, exactly as Moon's frame_relative param does.
    const alpha = evalSegment(a, (t - a.t) / span, span);
    result = CF.lerp(a.v, b.v, alpha);
  }
  if (cache) cache.set(t, result);
  return result;
}

export function evalTrackNum(itemId, track, t, fallback = 0) {
  const tr = trackObj(itemId, track);
  if (!tr || !tr.keys.length) return fallback;
  const useCache = Number.isInteger(t);
  const cache = useCache ? trackCache(tr).num : null;
  if (cache && cache.has(t)) return cache.get(t);
  const keys = tr.keys;
  let result;
  if (t <= keys[0].t) result = keys[0].v;
  else if (t >= keys[keys.length - 1].t) result = keys[keys.length - 1].v;
  else {
    let lo = 0;
    for (let i = 0; i < keys.length - 1; i++) {
      if (t >= keys[i].t && t <= keys[i + 1].t) { lo = i; break; }
    }
    const a = keys[lo], b = keys[lo + 1];
    const span = b.t - a.t || 1;
    // `span` is also handed to evalSegment so Elastic's frame-relative Period reads the same
    // on a short and a long segment, exactly as Moon's frame_relative param does.
    const alpha = evalSegment(a, (t - a.t) / span, span);
    result = a.v + (b.v - a.v) * alpha;
  }
  if (cache) cache.set(t, result);
  return result;
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
// Every plain-number (non-CFrame) track name — @fov for cameras, @rate/@lifetime/@speed for VFX
// emitters — shares one predicate so a new numeric track never needs updating in more than one
// place (this was previously just `track === '@fov'`, repeated three times).
const NUMERIC_TRACKS = new Set(['@fov', '@rate', '@lifetime', '@speed']);
function isNumericTrack(track) { return NUMERIC_TRACKS.has(track); }

// Split: insert a keyframe at time t with the currently-interpolated value — a no-visual-change
// "refine the curve" operation you then nudge, matching Moon's M key.
export function splitKeyframe(itemId, track, t) {
  const value = isNumericTrack(track) ? evalTrackNum(itemId, track, t) : evalTrackCF(itemId, track, t);
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
  const value = isNumericTrack(track) ? evalTrackNum(itemId, track, t) : evalTrackCF(itemId, track, t);
  setKey(itemId, track, t, value, { noUndo: true });
}

// Fill: bake every intermediate frame in [tStart, tEnd] into an explicit keyframe holding
// the currently-interpolated value, at the given frame step — turns a smooth curve into
// an explicit per-frame one so each frame can be hand-tuned independently.
// `wiggle` is Moon's randomised fill (FillFrames' Wiggle checkbox): instead of baking the exact
// interpolated value, each generated key is nudged by a random amount, which is how you get
// cheap hand-drawn jitter/noise on a held pose. Magnitudes are per-channel:
//   { pos: [x,y,z], rot: [rx,ry,rz] (degrees), num: n, minZero: bool }
// `minZero` mirrors Moon's MinZero: nudge only upward (0..mag) rather than symmetrically.
export function fillFrames(itemId, track, tStart, tEnd, step = 1, opts = {}) {
  pushUndo();
  const isNumeric = isNumericTrack(track);
  const wiggle = opts.wiggle || null;
  // Sample the ORIGINAL curve for every target frame BEFORE writing any keys — this mirrors
  // Moon's precomputed BufferMap. Writing as we go would make each frame interpolate against
  // the keys just written, so a wiggle would compound frame over frame and blow well past the
  // requested magnitude instead of staying a bounded jitter around the original curve.
  const buffer = [];
  for (let t = Math.ceil(tStart); t <= Math.floor(tEnd); t += step) {
    buffer.push([t, isNumeric ? evalTrackNum(itemId, track, t) : evalTrackCF(itemId, track, t)]);
  }
  for (const [t, base] of buffer) {
    const value = wiggle ? (isNumeric ? wiggleNumber(base, wiggle) : wiggleCFrame(base, wiggle)) : base;
    setKey(itemId, track, t, value, { noUndo: true, es: opts.es, ed: opts.ed });
  }
  emit('tracks', {});
  markDirty();
}

// Moon's wiggleFuncs:number — value + random in [lower, upper].
function wiggleNumber(v, w) {
  const mag = Math.abs(w.num ?? 0);
  if (!mag) return v;
  const lower = w.minZero ? 0 : -mag;
  return v + lower + Math.random() * (mag - lower);
}
// Moon's wiggleFuncs:CFrame — (value * CFrame.Angles(rx,ry,rz)) + positionOffset, i.e. the
// rotation is applied in the value's OWN local space while the position offset is added in
// world space. Reproduced exactly here.
function wiggleCFrame(cf, w) {
  const pos = w.pos || [0, 0, 0];
  const rot = w.rot || [0, 0, 0];
  const r = (mag) => {
    const m = Math.abs(mag || 0);
    if (!m) return 0;
    const lower = w.minZero ? 0 : -m;
    return lower + Math.random() * (m - lower);
  };
  const angles = CF.fromEuler(
    (r(rot[0]) * Math.PI) / 180,
    (r(rot[1]) * Math.PI) / 180,
    (r(rot[2]) * Math.PI) / 180,
  );
  const rotated = CF.mul(cf, angles);
  return CF.setPosition(rotated, rotated[0] + r(pos[0]), rotated[1] + r(pos[1]), rotated[2] + r(pos[2]));
}

// Moon's FrameOffset: shift every keyframe (and every event marker) in the project by `dt`
// frames, so an animation can be nudged wholesale without reselecting everything.
export function offsetAllFrames(dt, opts = {}) {
  dt = Math.round(dt);
  if (!dt) return 0;
  pushUndo();
  let moved = 0;
  const itemIds = opts.itemId ? [opts.itemId] : Object.keys(state.project.tracks || {});
  for (const itemId of itemIds) {
    const tracks = state.project.tracks[itemId] || {};
    for (const tr of Object.values(tracks)) {
      for (const k of tr.keys) { k.t = Math.max(0, k.t + dt); moved++; }
      // clamping at 0 can collide two keys onto the same frame — keep the later one, as
      // setKey's overwrite semantics would
      const seen = new Map();
      for (const k of tr.keys) seen.set(k.t, k);
      tr.keys = [...seen.values()].sort((a, b) => a.t - b.t);
    }
    const list = state.project.markers?.[itemId];
    if (list) for (const m of list) m.t = Math.max(0, m.t + dt);
  }
  // groups track keys by time too, so they have to follow or grouping silently breaks
  for (const g of state.project.groups || []) {
    if (opts.itemId && !g.keys.some((k) => k.itemId === opts.itemId)) continue;
    for (const k of g.keys) if (!opts.itemId || k.itemId === opts.itemId) k.t = Math.max(0, k.t + dt);
  }
  state.selection.keys = [];
  state.selection.markers = [];
  emit('tracks', {});
  emit('markers', {});
  emit('selection');
  markDirty();
  return moved;
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
    // FBX/GLB/OBJ imports render straight from these raw local-space vertices (rigbuild.js's
    // customMeshGeometry), completely independent of `size` above — skipping this left imported
    // meshes visually snapping back to their original size the instant the gizmo was released.
    if (p.customMesh) {
      p.customMesh.positions = p.customMesh.positions.map((v) => v * factor);
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
