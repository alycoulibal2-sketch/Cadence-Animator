// Cadence Mobile — a thin phone-facing viewer/remote for the desktop app. Reuses the desktop's
// own state/cf/viewport/easing modules unmodified (served from /shared/renderer/js/, see
// mobileServer.js) so the phone renders with the real three.js viewport instead of a screenshot
// stream or a second re-implementation. This page never owns project data: the desktop is the
// only source of truth, this page mirrors it live over a WebSocket and sends a small allowlisted
// set of commands back through the same pipe Claude's MCP tools already use.
import * as S from '/shared/renderer/js/state.js';
import * as CF from '/shared/renderer/js/cf.js';
import { initViewport, updateScene, render, viewport } from '/shared/renderer/js/viewport.js';
import { STYLES } from '/shared/renderer/js/easing.js';

// ---------------------------------------------------------------- window.cadence shim
// state.js/rigbuild.js call window.cadence.* expecting the desktop's Electron-IPC-backed preload
// surface. Here it's backed by fetch() against the mobile server's Roblox asset proxy routes
// instead — same shape, different transport, so those shared modules don't need to change at all.
window.cadence = {
  fetchMesh: (id) => fetch(`/api/mesh/${id}`).then((r) => r.json()),
  fetchTexture: (id) => fetch(`/api/texture/${id}`).then((r) => r.json()).then((d) => d.dataUri),
  classicFace: () => fetch('/api/classicFace').then((r) => r.json()).then((d) => d.dataUri),
  autosaveWrite: async () => { }, // no-op — the desktop app owns persistence, this page is a mirror
};

// ---------------------------------------------------------------- toast
let toastTimer = null;
function flash(message, kind = 'info') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast show' + (kind === 'error' ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------------------------------------------------------------- connection
const token = new URLSearchParams(location.hash.slice(1)).get('token');
const connStatusEl = document.getElementById('connStatus');
let ws = null;
let nextCmdId = 1;
const pendingCmds = new Map();
let editingAllowed = true;

function setConnStatus(text, live) {
  connStatusEl.textContent = text;
  connStatusEl.classList.toggle('live', !!live);
}

function connect() {
  if (!token) { setConnStatus('No pairing token in link'); return; }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(token)}`);
  ws.addEventListener('open', () => setConnStatus('Live', true));
  ws.addEventListener('close', () => { setConnStatus('Disconnected — retrying…'); setTimeout(connect, 2000); });
  ws.addEventListener('error', () => { });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    if (msg.kind === 'state') applyRemoteState(msg.payload);
    else if (msg.kind === 'result') {
      const p = pendingCmds.get(msg.id);
      if (!p) return;
      pendingCmds.delete(msg.id);
      if (msg.ok) p.resolve(msg.data); else p.reject(new Error(msg.error || 'Command failed'));
    }
  });
}

function sendCommand(type, payload) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) { reject(new Error('Not connected to the desktop app')); return; }
    const id = nextCmdId++;
    pendingCmds.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, type, payload }));
  });
}

// ---------------------------------------------------------------- remote state application
// scrubbingLocally/localPlaying guard against an incoming broadcast (which may carry a slightly
// different playhead than what the phone is actively doing) yanking the slider/preview out from
// under the user's thumb mid-interaction.
let scrubbingLocally = false;
let localPlaying = false;

function applyRemoteState(payload) {
  const { project, playhead, selection, editingAllowed: ea } = payload;
  if (typeof ea === 'boolean' && ea !== editingAllowed) setEditingAllowed(ea);

  // Apply all the raw fields first, then run rendering side effects once at the end — so item
  // chips/joint list reflect the *final* selection for this update instead of an in-between one.
  let projectChanged = false, playheadChanged = false;
  if (project) {
    S.state.project = project;
    S.emit('project'); // triggers viewport.js's own syncItems() automatically
    document.getElementById('projectName').textContent = project.name || 'Untitled';
    document.getElementById('scrubSlider').max = String(project.length || 90);
    projectChanged = true;
  }
  if (selection) {
    S.state.selection = selection;
    S.emit('selection'); // picked up by the generic listener below (also covers viewport taps)
  }
  if (typeof playhead === 'number' && !scrubbingLocally && !localPlaying) {
    S.state.playhead = playhead;
    S.emit('playhead');
    playheadChanged = true;
  }

  if (projectChanged && !selection) renderItems(); // selection's own listener already covers this case
  if (playheadChanged) { updateFrameReadout(); refreshKeyInfoDebounced(); }
}

function setEditingAllowed(ea) {
  editingAllowed = ea;
  document.getElementById('editLockLabel').hidden = ea;
  for (const id of ['undoBtn', 'redoBtn', 'deleteKeyBtn', 'easingStyle', 'easingDir']) {
    document.getElementById(id).disabled = !ea;
  }
  document.querySelectorAll('.nudge-btn[data-axis]').forEach((b) => { b.disabled = !ea; });
}

// ---------------------------------------------------------------- item list + selection
function renderItems() {
  const list = document.getElementById('itemList');
  list.innerHTML = '';
  const items = S.state.project ? S.state.project.items : [];
  for (const item of items) {
    const chip = document.createElement('button');
    chip.className = 'item-chip' + (S.state.selection.itemId === item.id ? ' selected' : '');
    chip.textContent = item.name || item.kind;
    chip.addEventListener('click', () => selectItem(item.id));
    list.appendChild(chip);
  }
}

function selectItem(itemId) {
  S.setSelection(itemId, null); // UI refresh happens via the generic S.on('selection', ...) listener
  sendCommand('select', { itemId, partId: null }).catch(() => { });
}

function populateJointSelect() {
  const sel = document.getElementById('jointSelect');
  sel.innerHTML = '<option value="">Select a joint…</option>';
  const item = S.state.project?.items.find((i) => i.id === S.state.selection.itemId);
  if (item && item.rig && item.rig.joints) {
    for (const j of item.rig.joints) {
      if (j.kind === 'weld') continue;
      const opt = document.createElement('option');
      opt.value = j.name;
      opt.textContent = j.name;
      sel.appendChild(opt);
    }
  }
  refreshKeyInfo();
}

// ---------------------------------------------------------------- keyframe inspector
let currentKey = null; // the key at the exact current frame for the selected item+joint, or null
let keyInfoDebounce = null;

function refreshKeyInfoDebounced() {
  clearTimeout(keyInfoDebounce);
  keyInfoDebounce = setTimeout(refreshKeyInfo, 150);
}

async function refreshKeyInfo() {
  const itemId = S.state.selection.itemId;
  const track = document.getElementById('jointSelect').value;
  const keyInfoEl = document.getElementById('keyInfo');
  const nudgeGrid = document.getElementById('nudgeGrid');
  currentKey = null;
  if (!itemId || !track) {
    keyInfoEl.hidden = false; keyInfoEl.textContent = 'Select a joint to inspect its keyframes.';
    nudgeGrid.hidden = true;
    return;
  }
  try {
    const { keys } = await sendCommand('get_track', { itemId, track });
    const frame = Math.round(S.state.playhead);
    const key = (keys || []).find((k) => Math.round(k.t) === frame);
    if (!key || !Array.isArray(key.v) || key.v.length !== 12) {
      currentKey = null;
      keyInfoEl.hidden = false; keyInfoEl.textContent = 'No keyframe at this frame for the selected joint.';
      nudgeGrid.hidden = true;
      return;
    }
    currentKey = { itemId, track, t: key.t, v: key.v, es: key.es || 'Linear', ed: key.ed || 'Out', bez: key.bez || null };
    keyInfoEl.hidden = true;
    nudgeGrid.hidden = false;
    document.getElementById('easingStyle').value = currentKey.es;
    document.getElementById('easingDir').value = currentKey.ed;
  } catch (e) {
    keyInfoEl.hidden = false; keyInfoEl.textContent = 'Could not load this keyframe.';
    nudgeGrid.hidden = true;
  }
}

async function applyEasing() {
  if (!currentKey) return;
  const es = document.getElementById('easingStyle').value;
  const ed = document.getElementById('easingDir').value;
  try {
    await sendCommand('set_easing', { keys: [{ itemId: currentKey.itemId, track: currentKey.track, t: currentKey.t }], es, ed, bez: null });
    currentKey.es = es; currentKey.ed = ed;
  } catch (e) { flash(e.message, 'error'); }
}

async function nudgeRotation(axis, deg) {
  if (!currentKey) return;
  const rad = (deg * Math.PI) / 180;
  const delta = axis === 'x' ? CF.fromEuler(rad, 0, 0) : axis === 'y' ? CF.fromEuler(0, rad, 0) : CF.fromEuler(0, 0, rad);
  const newValue = CF.mul(currentKey.v, delta);
  try {
    await sendCommand('set_keyframe', { itemId: currentKey.itemId, track: currentKey.track, t: currentKey.t, value: newValue, es: currentKey.es, ed: currentKey.ed, bez: currentKey.bez });
    currentKey.v = newValue;
  } catch (e) { flash(e.message, 'error'); }
}

async function deleteCurrentKey() {
  if (!currentKey) return;
  try {
    await sendCommand('delete_keyframes', { keys: [{ itemId: currentKey.itemId, track: currentKey.track, t: currentKey.t }] });
    currentKey = null;
    refreshKeyInfo();
  } catch (e) { flash(e.message, 'error'); }
}

// ---------------------------------------------------------------- transport / local playback
// Local playback previews entirely client-side (the mirrored project already carries full track
// data, so evalPose/interpolation needs no round-trip) — the network is only used to sync the
// *shared* playhead back to the desktop, throttled, not per rendered frame.
let lastSyncSent = 0;
function maybeSyncPlayhead(force) {
  const now = performance.now();
  if (!force && now - lastSyncSent < 300) return;
  lastSyncSent = now;
  sendCommand('scrub_to_frame', { frame: Math.round(S.state.playhead) }).catch(() => { });
}

function updateFrameReadout() {
  document.getElementById('frameReadout').textContent = String(Math.round(S.state.playhead));
  document.getElementById('scrubSlider').value = String(Math.round(S.state.playhead));
}

let lastFrameTime = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  if (localPlaying && S.state.project) {
    let ph = S.state.playhead + dt * S.state.project.fps;
    if (ph >= S.state.project.length) {
      ph = S.state.project.loop ? 0 : S.state.project.length;
      if (!S.state.project.loop) { localPlaying = false; document.getElementById('playBtn').textContent = '▶'; }
    }
    S.state.playhead = ph;
    S.emit('playhead');
    updateFrameReadout();
    maybeSyncPlayhead(false);
    // Onion-skin state (if toggled locally, see wireOnionToggle below) lives on the mirrored
    // project object directly — updateScene() below reads it fresh every frame, no event needed.
    refreshKeyInfoDebounced();
  }
  updateScene();
  render();
  requestAnimationFrame(loop);
}

function wireTransport() {
  const slider = document.getElementById('scrubSlider');
  slider.addEventListener('pointerdown', () => { scrubbingLocally = true; });
  slider.addEventListener('input', () => {
    S.state.playhead = Number(slider.value);
    S.emit('playhead');
    updateFrameReadout();
    refreshKeyInfoDebounced();
    maybeSyncPlayhead(false);
  });
  slider.addEventListener('pointerup', () => { scrubbingLocally = false; maybeSyncPlayhead(true); });

  document.getElementById('playBtn').addEventListener('click', (e) => {
    localPlaying = !localPlaying;
    e.target.textContent = localPlaying ? '⏸' : '▶';
    maybeSyncPlayhead(true);
  });
  document.getElementById('stepBackBtn').addEventListener('click', () => {
    S.state.playhead = Math.max(0, Math.round(S.state.playhead) - 1);
    S.emit('playhead');
    updateFrameReadout();
    refreshKeyInfoDebounced();
    maybeSyncPlayhead(true);
  });
  document.getElementById('stepFwdBtn').addEventListener('click', () => {
    const max = S.state.project ? S.state.project.length : 0;
    S.state.playhead = Math.min(max, Math.round(S.state.playhead) + 1);
    S.emit('playhead');
    updateFrameReadout();
    refreshKeyInfoDebounced();
    maybeSyncPlayhead(true);
  });
}

function wireInspector() {
  document.getElementById('jointSelect').addEventListener('change', refreshKeyInfo);
  document.getElementById('easingStyle').addEventListener('change', applyEasing);
  document.getElementById('easingDir').addEventListener('change', applyEasing);
  document.getElementById('deleteKeyBtn').addEventListener('click', deleteCurrentKey);
  document.querySelectorAll('.nudge-btn[data-axis]').forEach((btn) => {
    btn.addEventListener('click', () => nudgeRotation(btn.dataset.axis, Number(btn.dataset.deg)));
  });
  document.getElementById('undoBtn').addEventListener('click', () => sendCommand('undo', {}).then(refreshKeyInfo).catch((e) => flash(e.message, 'error')));
  document.getElementById('redoBtn').addEventListener('click', () => sendCommand('redo', {}).then(refreshKeyInfo).catch((e) => flash(e.message, 'error')));

  const easingStyleEl = document.getElementById('easingStyle');
  for (const s of STYLES) {
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    easingStyleEl.appendChild(opt);
  }
}

// Local-only visual preview: mutates the mirrored project's onionSkin list directly rather than
// through a server command (no MCP handler exists for this — it's cosmetic and view-side only).
// updateScene() in viewport.js reads project.onionSkin.enabledItemIds fresh every rendered frame,
// so no re-sync/emit is needed for this to take effect; it does mean the next real snapshot from
// the desktop (its own onionSkin state) will override it, which is fine for a quick local look.
function wireOnionToggle() {
  document.getElementById('onionToggle').addEventListener('change', (e) => {
    const itemId = S.state.selection.itemId;
    if (!itemId || !S.state.project) { e.target.checked = false; return; }
    const ids = S.state.project.onionSkin.enabledItemIds;
    const i = ids.indexOf(itemId);
    if (e.target.checked && i === -1) ids.push(itemId);
    else if (!e.target.checked && i !== -1) ids.splice(i, 1);
  });
}

// ---------------------------------------------------------------- boot
initViewport(document.getElementById('viewport'));
// This page is view/orbit + explicit UI controls only — no move/rotate/scale gizmo authoring
// (that's the whole point of "can't really animate" on mobile). Tapping a part in the viewport
// still selects it (nice on a touchscreen, harmless — purely local UI state), but disabling and
// hiding the gizmo means there's nothing draggable left for that selection to attach to.
viewport.gizmo.enabled = false;
viewport.gizmo.visible = false;
// Single place that reacts to a selection change no matter what caused it — one of our own item
// chip taps, a direct tap on the 3D viewport, or an incoming broadcast from the desktop.
S.on('selection', () => { renderItems(); populateJointSelect(); });
wireTransport();
wireInspector();
wireOnionToggle();
connect();
requestAnimationFrame(loop);
