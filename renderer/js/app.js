// App shell: wires everything together — commands, shortcuts, panels, playback, import/export flows.
import * as S from './state.js';
import * as CF from './cf.js';
import { initViewport, updateScene, render, setGizmoMode, toggleGizmoSpace, focusSelected, frameAll, debugFrame, commitOverlays, getInstance, syncItems, refreshInstance, setHandlesVisible, setHandleSize, setRotationSnap } from './viewport.js';
import { initTimeline, requestDraw, copySelectedKeys, cutSelectedKeys, pasteKeys, pasteKeysIntoItem, duplicateAtPlayhead, zoomToFit, openSelectedKeyMenu, toggleItemCollapse, toggleCollapseAll } from './timeline.js';
import { initCurveEditor, toggleCurveEditor, openCurveEditor } from './curves.js';
import { initAudio, loadAudioFromPath, removeAudio, setAudioVolume, setAudioOffset, restoreAudio } from './audio.js';
import { toast, toastProgress, modal, promptModal, chooseModal, copyableRow } from './ui.js';
import { registerCommand, initPalette, showShortcuts, hideShortcuts } from './palette.js';
import { STYLES, DIRECTIONS } from './easing.js';
import * as IO from './io.js';
import { validateAnimation } from './validate.js';
import { initPanels } from './panels.js';

let builtinRigs = null;
let settings = {};

// ================================================================ boot
async function boot() {
  try {
    settings = await window.cadence.getSettings() || {};
    S.state.autoKey = settings.autoKey ?? true;
    S.state.snapping = settings.snapping ?? true;
    S.state.handlesVisible = settings.handlesVisible ?? true;
    S.state.handleSize = settings.handleSize ?? 'normal';
    S.state.showSeconds = settings.showSeconds ?? false;

    initPanels(settings, (sizes) => { Object.assign(settings, sizes); window.cadence.setSettings(settings); });

    initViewport(document.getElementById('viewport'));
    initTimeline({
      listEl: document.getElementById('trackList'),
      canvasEl: document.getElementById('tlCanvas'),
      wrapEl: document.getElementById('tlCanvasWrap'),
    });
    initCurveEditor();
    initAudio();
    initPalette();
    registerAllCommands();
    wireTopBar();
    wireTransport();
    wireExplorer();
    wireInspector();
    wireDragDrop();
    wireKeyboard();
    wireBridge();
    initMcp();

    builtinRigs = await window.cadence.builtinRigs().catch(() => null);

    S.newProject();
    await offerRecovery();
    if (!settings.onboarded) showOnboarding();

    requestAnimationFrame(loop);

    // Internal QA hook — drives the app from the main process for automated smoke tests/screenshots.
    window.__cadenceDebug = {
      S, CF, IO,
      addBuiltinRig, addCamera, keyCurrentPose, setGizmoMode,
      getInstance, updateScene, render, focusSelected, frameAll, debugFrame, setHandlesVisible,
    };
  } catch (e) {
    console.error('[boot] failed:', e && e.stack || e);
  }
}

// ================================================================ playback loop
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  if (S.state.playing && S.state.project) {
    let ph = S.state.playhead + dt * S.state.project.fps;
    if (ph >= S.state.project.length) {
      if (S.state.loopPlayback) {
        ph = 0;
        S.setPlayhead(0, false);
        S.emit('playing', true); // resync audio
      } else {
        S.setPlaying(false);
        ph = S.state.project.length;
      }
    }
    S.setPlayhead(ph, false);
  }
  updateScene();
  render();
  requestAnimationFrame(loop);
}

// ================================================================ commands & shortcuts
function registerAllCommands() {
  const C = registerCommand;
  C({ title: 'Play / Pause', shortcut: 'Space', section: 'Playback', run: togglePlay });
  C({ title: 'Step forward 1 frame', shortcut: '→ / Numpad 6', section: 'Playback', run: () => S.setPlayhead(Math.round(S.state.playhead) + 1) });
  C({ title: 'Step back 1 frame', shortcut: '← / Numpad 4', section: 'Playback', run: () => S.setPlayhead(Math.round(S.state.playhead) - 1) });
  C({ title: 'Jump to start', shortcut: 'Home / Numpad 1', section: 'Playback', run: () => S.setPlayhead(0) });
  C({ title: 'Jump to end', shortcut: 'End', section: 'Playback', run: () => S.setPlayhead(S.state.project.length) });
  C({ title: 'Previous keyframe', shortcut: 'J', section: 'Playback', run: () => jumpToKeyframe(-1) });
  C({ title: 'Next keyframe', shortcut: 'K', section: 'Playback', run: () => jumpToKeyframe(1) });
  C({ title: 'Toggle looping', shortcut: 'Tab', section: 'Playback', run: () => { S.state.loopPlayback = !S.state.loopPlayback; toast(`Loop ${S.state.loopPlayback ? 'on' : 'off'}`); } });
  C({ title: 'Look through camera / exit camera', section: 'Playback', run: toggleCameraView });
  C({ title: 'Toggle camera tracks in timeline', shortcut: 'Ctrl+Space', section: 'Playback', run: toggleCameraTracks });
  C({ title: 'Display time in seconds', shortcut: 'Shift+T', section: 'Playback', run: toggleSecondsDisplay });

  C({ title: 'Add keyframe (key current pose)', shortcut: 'S', section: 'Animating', run: keyCurrentPose });
  C({ title: 'Key selected track only', shortcut: 'Numpad +', section: 'Animating', run: keySelectedTrack });
  C({ title: 'Key rest pose on selected track', shortcut: 'G', section: 'Animating', run: keyRestPose });
  C({ title: 'Toggle auto-key', shortcut: 'A', section: 'Animating', hint: 'record keys automatically when you move parts', run: toggleAutoKey });
  C({ title: 'Cycle tool (move / rotate)', shortcut: 'R', section: 'Animating', run: toolCycle });
  C({ title: 'Move tool', shortcut: 'W', section: 'Animating', run: () => setGizmoMode('translate') });
  C({ title: 'Rotate tool', shortcut: 'E', section: 'Animating', run: () => setGizmoMode('rotate') });
  C({ title: 'Toggle local / world space', shortcut: 'Y', section: 'Animating', run: () => toast(`Gizmo space: ${toggleGizmoSpace()}`) });
  C({ title: 'Toggle rotation grid snap', shortcut: 'C', section: 'Animating', run: toggleRotGrid });
  C({ title: 'Curve editor', hint: 'interactive bezier easing curves — now on the toolbar/right-click, C is taken by rotation grid', section: 'Animating', run: toggleCurveEditor });
  C({ title: 'Focus selected part', shortcut: 'F', section: 'Animating', run: focusSelected });
  C({ title: 'Fit animation length to last keyframe', shortcut: 'Shift+F', section: 'Animating', run: fitLengthToLastKeyframe });
  C({ title: 'Select all keyframes', shortcut: 'Alt+F', section: 'Animating', run: () => S.selectAllKeys(S.state.selection.itemId) });
  C({ title: 'Delete selected keyframes', shortcut: 'Del', section: 'Animating', run: () => S.deleteKeys(S.state.selection.keys) });
  C({ title: 'Cut keyframes', shortcut: 'Ctrl+X', section: 'Animating', run: cutSelectedKeys });
  C({ title: 'Copy keyframes', shortcut: 'Ctrl+C', section: 'Animating', run: copySelectedKeys });
  C({ title: 'Paste keyframes at playhead', shortcut: 'Ctrl+V', section: 'Animating', run: pasteKeys });
  C({ title: 'Paste into selected item', shortcut: 'Shift+Ctrl+V', section: 'Animating', hint: 'retarget copied keys onto a different rig by track name', run: () => pasteKeysIntoItem(S.state.selection.itemId) });
  C({ title: 'Duplicate keyframes at playhead', shortcut: 'Ctrl+D', section: 'Animating', run: duplicateAtPlayhead });
  C({ title: 'Group selected keyframes', shortcut: 'Ctrl+G', section: 'Animating', hint: 'move them together as one unit', run: groupSelectedKeys });
  C({ title: 'Ungroup keyframes', shortcut: 'Ctrl+U', section: 'Animating', run: () => ungroupSelectedKeys(false) });
  C({ title: 'Ungroup keyframes instantly', shortcut: 'Shift+Ctrl+U', section: 'Animating', run: () => ungroupSelectedKeys(true) });
  C({ title: 'Split keyframe (smooth)', shortcut: 'M', section: 'Animating', run: splitSelectedKeyframes });
  C({ title: 'Split at stride…', shortcut: 'Shift+M', section: 'Animating', run: splitStrideFlow });
  C({ title: 'Fill frames…', shortcut: 'Shift+K', hint: 'bake explicit keys across a range', section: 'Animating', run: fillFramesFlow });
  C({ title: 'Repeat frames…', shortcut: 'Shift+L', section: 'Animating', run: repeatFramesFlow });
  C({ title: 'Stretch frames…', shortcut: 'Numpad 3', section: 'Animating', run: stretchFramesFlow });
  C({ title: 'Reflect rig (mirror left/right)', shortcut: 'Ctrl+R', section: 'Animating', run: mirrorSelectedItem });
  C({ title: 'Undo', shortcut: 'Ctrl+Z', section: 'General', run: () => S.undo() });
  C({ title: 'Redo', shortcut: 'Ctrl+Y', section: 'General', run: () => S.redo() });
  C({ title: 'Toggle snapping', hint: 'snap keys & playhead to whole frames', section: 'Animating', run: () => { S.state.snapping = !S.state.snapping; persistPrefs(); toast(`Snapping ${S.state.snapping ? 'on' : 'off'}`); } });
  C({ title: 'Zoom timeline to fit', section: 'Timeline', run: zoomToFit });
  C({ title: 'Toggle selected item’s tracks', shortcut: 'Shift+Space', section: 'Timeline', run: () => toggleItemCollapse(S.state.selection.itemId) });
  C({ title: 'Collapse / expand all tracks', shortcut: 'Numpad 2', section: 'Timeline', run: toggleCollapseAll });
  C({ title: 'Jump to item…', shortcut: 'Shift+P', section: 'Timeline', run: jumpToItemFlow });

  C({ title: 'Apply onion skin', shortcut: 'N', section: 'Onion skin', run: () => toggleOnionForSelected(true) });
  C({ title: 'Toggle onion skin', shortcut: 'B', section: 'Onion skin', run: () => toggleOnionForSelected(false) });
  C({ title: 'Clear all onion skins', shortcut: 'Alt+B', section: 'Onion skin', run: clearOnionSkins });
  C({ title: 'Toggle joint handles', shortcut: 'Ctrl+B', section: 'Onion skin', run: toggleHandles });
  C({ title: 'Small handles', shortcut: 'Shift+B', section: 'Onion skin', run: smallHandles });
  C({ title: 'Hide handles', shortcut: 'Shift+H', section: 'Onion skin', run: hideHandlesForce });

  C({ title: 'Add rig: R6', section: 'Add', run: () => addBuiltinRig('r6') });
  C({ title: 'Add rig: R15', section: 'Add', run: () => addBuiltinRig('r15') });
  C({ title: 'Add rig: Rthro', section: 'Add', run: () => addBuiltinRig('rthro') });
  C({ title: 'Add rig: Rthro Slender', section: 'Add', run: () => addBuiltinRig('rthroSlender') });
  C({ title: 'Add rig: your Roblox avatar…', section: 'Add', hint: 'by username, needs Studio bridge', run: addAvatarFlow });
  C({ title: 'Add rig from Studio selection', section: 'Add', hint: 'select a rig in Studio Explorer first', run: addFromStudioSelection });
  C({ title: 'Add from Roblox asset ID…', section: 'Add', run: addByAssetIdFlow });
  C({ title: 'Add from file (.rbxm / .rbxmx)…', section: 'Add', run: addFromFileFlow });
  C({ title: 'Add camera', section: 'Add', run: addCamera });
  C({ title: 'Add audio track…', section: 'Add', hint: 'mp3 / wav / ogg with waveform', run: addAudioFlow });
  C({ title: 'Add items…', shortcut: 'Numpad 9', section: 'Add', run: addMenuFlow });
  C({ title: 'Rotate camera…', shortcut: 'Shift+O', section: 'Add', run: cameraRotateFlow });

  C({ title: 'Import animation from file…', section: 'Import', hint: 'KeyframeSequence / AnimSaves exports', run: importAnimFileFlow });
  C({ title: 'Import animation by Roblox ID…', section: 'Import', run: importAnimByIdFlow });
  C({ title: 'Import from a rig’s AnimSaves (Studio)…', section: 'Import', run: importAnimSavesFlow });
  C({ title: 'Import menu…', shortcut: 'Shift+I', section: 'Import', run: importMenuFlow });

  C({ title: 'Export to Roblox Studio', shortcut: 'Numpad 5', section: 'Export', hint: 'creates the KeyframeSequence directly in Studio', run: () => exportFlow('studio') });
  C({ title: 'Export .rbxmx animation file', section: 'Export', hint: 'drop it into Studio later', run: () => exportFlow('file') });
  C({ title: 'Export rig + animation as one file', section: 'Export', run: () => exportFlow('rigfile') });
  C({ title: 'Publish to Roblox (get asset ID)…', section: 'Export', run: () => exportFlow('publish') });

  C({ title: 'Animation settings…', shortcut: 'Numpad 8', section: 'Project', run: animationSettingsFlow });
  C({ title: 'New project', shortcut: 'Ctrl+N', section: 'Project', run: newProjectFlow });
  C({ title: 'Open project…', shortcut: 'Ctrl+O', section: 'Project', run: openProjectFlow });
  C({ title: 'Save project', shortcut: 'Ctrl+S / Numpad 0', section: 'Project', run: () => saveProjectFlow(false) });
  C({ title: 'Save project as…', shortcut: 'Ctrl+Shift+S', section: 'Project', run: () => saveProjectFlow(true) });
  C({ title: 'Save and close', shortcut: 'Numpad /', section: 'Project', run: quickSaveAndClose });
  C({ title: 'Close file', shortcut: 'Backslash', section: 'Project', run: closeFileFlow });
  C({ title: 'Restore an autosave…', section: 'Project', hint: 'every change is autosaved — nothing is ever lost', run: () => offerRecovery(true) });
  C({ title: 'Hide UI (focus mode)', shortcut: 'Ctrl+H', section: 'Project', run: toggleHideUI });

  C({ title: 'Install / repair Studio plugin', section: 'Studio', hint: 'copies Cadence Bridge into your Plugins folder', run: installPluginFlow });
  C({ title: 'Enable Claude Control (MCP)', section: 'Studio', hint: 'let Claude drive this app directly — add rigs, key exact poses, verify frames', run: enableClaudeControlFlow });
  C({ title: 'Check for updates', section: 'General', run: checkForUpdatesFlow });
  C({ title: 'Keyboard shortcuts', shortcut: '?', section: 'General', run: showShortcuts });
}

// True if the physical key is Numpad<d> (regardless of NumLock, via e.code) or the digit-row d.
function isDigit(e, d) { return e.code === 'Numpad' + d || e.key === String(d); }
let currentGizmoMode = 'translate';
S.on('gizmo-mode', (m) => { currentGizmoMode = m; });
function toolCycle() {
  setGizmoMode(currentGizmoMode === 'translate' ? 'rotate' : 'translate');
}

function wireKeyboard() {
  window.addEventListener('keydown', (e) => {
    const inField = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]');
    if (inField) return;
    const k = e.key;
    const kl = k.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const alt = e.altKey;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };

    // ---- undo/redo/cut/copy/paste (order matters: check the Shift+Ctrl combo before the plainer ones)
    if (kl === 'z' && ctrl && shift) { stop(); S.redo(); }
    else if (kl === 'z' && ctrl) { stop(); S.undo(); }
    else if (kl === 'z' && shift) { stop(); S.undo(); }
    else if (kl === 'y' && ctrl) { stop(); S.redo(); }
    else if (kl === 'y' && shift) { stop(); S.redo(); }
    else if (kl === 'v' && ctrl && shift) { stop(); pasteKeysIntoItem(S.state.selection.itemId); }
    else if (kl === 'x' && ctrl) { stop(); cutSelectedKeys(); }
    else if (kl === 'x' && shift) { stop(); cutSelectedKeys(); }
    else if (kl === 'c' && ctrl) { stop(); copySelectedKeys(); }
    else if (kl === 'c' && shift) { stop(); copySelectedKeys(); }
    else if (kl === 'v' && ctrl) { stop(); pasteKeys(); }
    else if (kl === 'v' && shift) { stop(); pasteKeys(); }
    else if (kl === 'd' && ctrl) { stop(); duplicateAtPlayhead(); }

    // ---- grouping
    else if (kl === 'g' && ctrl) { stop(); groupSelectedKeys(); }
    else if (kl === 'u' && shift && ctrl) { stop(); ungroupSelectedKeys(true); }
    else if (kl === 'u' && ctrl) { stop(); ungroupSelectedKeys(false); }

    // ---- project file ops
    else if (kl === 's' && ctrl) { stop(); saveProjectFlow(shift); }
    else if (kl === 'o' && ctrl) { stop(); openProjectFlow(); }
    else if (kl === 'n' && ctrl) { stop(); newProjectFlow(); }
    else if (kl === 'r' && ctrl) { stop(); mirrorSelectedItem(); }
    else if (kl === 'h' && ctrl) { stop(); toggleHideUI(); }
    else if (kl === 'b' && ctrl) { stop(); toggleHandles(); }
    else if (k === ' ' && ctrl) { stop(); toggleCameraTracks(); }

    // ---- deletion / navigation
    else if (k === 'Delete' || k === 'Backspace') {
      if (k === 'Backspace' && !shift && !ctrl && !alt) { stop(); closeFileFlow(); }
      else { stop(); S.deleteKeys(S.state.selection.keys); }
    }
    else if (k === ' ' && shift) { stop(); toggleItemCollapse(S.state.selection.itemId); }
    else if (k === ' ') { stop(); togglePlay(); }
    else if (e.code === 'NumpadEnter') { stop(); togglePlay(); }
    else if (k === 'ArrowRight') { stop(); S.setPlayhead(Math.round(S.state.playhead) + (shift ? 5 : 1)); }
    else if (k === 'ArrowLeft') { stop(); S.setPlayhead(Math.round(S.state.playhead) - (shift ? 5 : 1)); }
    else if (k === 'Home') { stop(); S.setPlayhead(0); }
    else if (k === 'End') { stop(); S.setPlayhead(S.state.project.length); }
    else if (kl === 'j' && !shift) { stop(); jumpToKeyframe(-1); }
    else if (kl === 'k' && !ctrl && !shift) { stop(); jumpToKeyframe(1); }
    else if (kl === 'tab') { stop(); S.state.loopPlayback = !S.state.loopPlayback; document.getElementById('loopBtn')?.classList.toggle('active', S.state.loopPlayback); }

    // ---- numpad navigation / transport (both Numpad<d> and top-row d trigger, per Moon convention)
    else if (isDigit(e, 1)) { stop(); S.setPlayhead(0); }
    else if (isDigit(e, 4)) { stop(); S.setPlayhead(Math.round(S.state.playhead) - 1); }
    else if (isDigit(e, 6)) { stop(); S.setPlayhead(Math.round(S.state.playhead) + 1); }
    else if (isDigit(e, 5)) { stop(); exportFlow('studio'); }
    else if (isDigit(e, 0)) { stop(); saveProjectFlow(false); }
    else if (isDigit(e, 8)) { stop(); animationSettingsFlow(); }
    else if (isDigit(e, 7)) { stop(); if (!openSelectedKeyMenu()) toast('Select a keyframe first', 'warn'); }
    else if (isDigit(e, 9)) { stop(); addMenuFlow(); }
    else if (isDigit(e, 2)) { stop(); toggleCollapseAll(); }
    else if (isDigit(e, 3)) { stop(); stretchFramesFlow(); }
    else if (e.code === 'NumpadDivide' || k === '/') { stop(); quickSaveAndClose(); }
    else if (e.code === 'NumpadAdd' || k === '+' || k === '=') { stop(); keySelectedTrack(); }
    else if (k === '\\') { stop(); closeFileFlow(); }

    // ---- tools / space / selection
    else if (kl === 'r') { stop(); toolCycle(); }
    else if (kl === 'w') setGizmoMode('translate');
    else if (kl === 'e') setGizmoMode('rotate');
    else if (kl === 'y') toast(`Gizmo space: ${toggleGizmoSpace()}`);
    else if (kl === 'x') toast(`Gizmo space: ${toggleGizmoSpace()}`);
    else if (kl === 'f' && shift) { stop(); fitLengthToLastKeyframe(); }
    else if (kl === 'f' && alt) { stop(); S.selectAllKeys(S.state.selection.itemId); toast('Selected all keyframes'); }
    else if (kl === 'f') focusSelected();
    else if (kl === 's' && !ctrl) { stop(); keyCurrentPose(); }
    else if (kl === 'g' && !ctrl) { stop(); keyRestPose(); }
    else if (kl === 'a' && !ctrl) toggleAutoKey();
    else if (kl === 'm' && shift) { stop(); splitStrideFlow(); }
    else if (kl === 'm') { stop(); splitSelectedKeyframes(); }
    else if (kl === 'n') { stop(); toggleOnionForSelected(true); }
    else if (kl === 'b' && alt) { stop(); clearOnionSkins(); }
    else if (kl === 'b' && shift) { stop(); smallHandles(); }
    else if (kl === 'b') { stop(); toggleOnionForSelected(false); }
    else if (kl === 'h' && shift) { stop(); hideHandlesForce(); }
    else if (kl === 'c') { stop(); toggleRotGrid(); }
    else if (kl === 'i' && shift) { stop(); importMenuFlow(); }
    else if (kl === 'k' && shift) { stop(); fillFramesFlow(); }
    else if (kl === 'l' && shift) { stop(); repeatFramesFlow(); }
    else if (kl === 'o' && shift) { stop(); cameraRotateFlow(); }
    else if (kl === 'p' && shift) { stop(); jumpToItemFlow(); }
    else if (kl === 't' && shift) { stop(); toggleSecondsDisplay(); }
    else if (k === '?') showShortcuts();
    else if (k === 'Escape') { hideShortcuts(); if (S.state.cameraView) toggleCameraView(); }
  });
}

function togglePlay() {
  if (S.state.playhead >= S.state.project.length - 0.001 && !S.state.playing) S.setPlayhead(0, false);
  S.setPlaying(!S.state.playing);
}

function toggleAutoKey() {
  S.state.autoKey = !S.state.autoKey;
  persistPrefs();
  document.getElementById('autoKeyBtn')?.classList.toggle('active', S.state.autoKey);
  toast(`Auto-key ${S.state.autoKey ? 'on — moving parts records keyframes' : 'off — press S to key a pose'}`);
}

function keyCurrentPose() {
  if (commitOverlays()) { toast('Pose keyed'); return; }
  // no pending edits: key the selected joint (or all joints of selected item) at playhead
  const { itemId, partId } = S.state.selection;
  if (!itemId) { toast('Select a rig or part first', 'warn'); return; }
  const item = S.getItem(itemId);
  const t = Math.round(S.state.playhead);
  if (partId && partId !== '@origin' && partId !== '@camera' && item.rig) {
    const j = (item.rig.joints || []).find((j) => j.part1 === partId && j.kind !== 'weld');
    if (j) {
      S.setKey(itemId, j.name, t, S.evalTrackCF(itemId, j.name, t));
      toast(`Keyed ${j.name} @ ${t}`);
      return;
    }
  }
  // whole item: key every joint that already has a track + origin if animated
  S.pushUndo();
  let n = 0;
  const tracks = S.getTracks(itemId);
  for (const tn of Object.keys(tracks)) {
    if (!tracks[tn].keys.length) continue;
    if (tn === '@fov') S.setKey(itemId, tn, t, S.evalTrackNum(itemId, tn, t, item.fov || 70), { noUndo: true });
    else S.setKey(itemId, tn, t, S.evalTrackCF(itemId, tn, t, tn === '@origin' ? (item.origin || CF.IDENTITY) : CF.IDENTITY), { noUndo: true });
    n++;
  }
  toast(n ? `Keyed ${n} tracks @ ${t}` : 'Nothing to key yet — move a part first');
}

function toggleCameraView() {
  if (S.state.cameraView) {
    S.state.cameraView = null;
    document.getElementById('camChip').classList.remove('show');
    S.emit('selection');
    return;
  }
  const cams = S.state.project.items.filter((i) => i.kind === 'camera');
  if (!cams.length) { toast('Add a camera first (press + )', 'warn'); return; }
  const sel = S.getItem(S.state.selection.itemId);
  S.state.cameraView = (sel && sel.kind === 'camera') ? sel.id : cams[0].id;
  document.getElementById('camChip').classList.add('show');
  S.emit('selection');
}

function persistPrefs() {
  settings.autoKey = S.state.autoKey;
  settings.snapping = S.state.snapping;
  settings.handlesVisible = S.state.handlesVisible;
  settings.handleSize = S.state.handleSize;
  settings.showSeconds = S.state.showSeconds;
  window.cadence.setSettings(settings);
}

// ================================================================ Moon-parity keybind flows
function selectedTrackName() {
  const { itemId, partId } = S.state.selection;
  if (!itemId || !partId) return null;
  if (partId === '@origin' || partId === '@camera') return '@origin';
  const item = S.getItem(itemId);
  const j = (item?.rig?.joints || []).find((j) => j.part1 === partId && j.kind !== 'weld');
  return j ? j.name : null;
}

function keySelectedTrack() { // Keypad +/=
  const { itemId } = S.state.selection;
  const track = selectedTrackName();
  if (!itemId || !track) { toast('Select a joint or origin first', 'warn'); return; }
  const t = Math.round(S.state.playhead);
  const item = S.getItem(itemId);
  if (track === '@fov') S.setKey(itemId, track, t, S.evalTrackNum(itemId, track, t, item.fov || 70));
  else S.setKey(itemId, track, t, S.evalTrackCF(itemId, track, t, track === '@origin' ? (item.origin || CF.IDENTITY) : CF.IDENTITY));
  toast(`Keyed ${track} @ ${t}`);
}

function keyRestPose() { // G
  const { itemId } = S.state.selection;
  const track = selectedTrackName();
  if (!itemId || !track || track === '@origin' || track === '@fov') { toast('Select a joint first', 'warn'); return; }
  S.setKey(itemId, track, Math.round(S.state.playhead), CF.IDENTITY.slice());
  toast(`Keyed ${track} to rest pose`);
}

function fitLengthToLastKeyframe() { // Shift+F
  let maxT = 0;
  for (const itemId of Object.keys(S.state.project.tracks)) {
    for (const tn of Object.keys(S.getTracks(itemId))) {
      for (const k of S.getTrack(itemId, tn).keys) if (k.t > maxT) maxT = k.t;
    }
  }
  if (maxT <= 0) { toast('No keyframes yet', 'warn'); return; }
  S.setProjectProp('length', Math.ceil(maxT));
  toast(`Length set to ${Math.ceil(maxT)}`);
}

function groupSelectedKeys() { // Ctrl+G
  const sel = S.state.selection.keys;
  if (sel.length < 2) { toast('Select 2+ keyframes to group', 'warn'); return; }
  S.groupKeys(sel);
  toast(`Grouped ${sel.length} keyframes`);
}
function ungroupSelectedKeys(instant) { // Shift+Ctrl+U instant, Ctrl+U confirms
  const sel = S.state.selection.keys;
  if (!sel.length) { toast('Select grouped keyframes first', 'warn'); return; }
  if (instant) { if (S.ungroupKeys(sel)) toast('Ungrouped'); return; }
  modal({
    title: 'Ungroup keyframes?',
    body: `<p>This removes the group link for the selected keyframe${sel.length > 1 ? 's' : ''} — they'll move independently again.</p>`,
    actions: [
      { label: 'Cancel', run: () => { } },
      { label: 'Ungroup', primary: true, run: () => { if (S.ungroupKeys(sel)) toast('Ungrouped'); } },
    ],
  });
}

function jumpToKeyframe(dir) { // J (-1) / K (+1)
  const t = dir < 0 ? S.prevKeyframeTime(S.state.selection.itemId, S.state.playhead) : S.nextKeyframeTime(S.state.selection.itemId, S.state.playhead);
  if (t === null) { toast(dir < 0 ? 'No earlier keyframe' : 'No later keyframe', 'warn'); return; }
  S.setPlayhead(t);
}

function splitSelectedKeyframes() { // M — insert an interpolated key between each selected key and its next neighbour
  const sel = S.state.selection.keys;
  if (!sel.length) { toast('Select a keyframe first', 'warn'); return; }
  S.pushUndo();
  let n = 0;
  for (const ref of sel) {
    const tr = S.getTrack(ref.itemId, ref.track);
    if (!tr) continue;
    const idx = tr.keys.findIndex((k) => Math.abs(k.t - ref.t) < 1e-6);
    const next = idx >= 0 ? tr.keys[idx + 1] : null;
    if (!next) continue;
    const mid = S.state.playhead > ref.t && S.state.playhead < next.t ? S.state.playhead : (ref.t + next.t) / 2;
    S.splitKeyframe(ref.itemId, ref.track, Math.round(mid));
    n++;
  }
  toast(n ? `Split ${n} segment${n > 1 ? 's' : ''}` : 'Nothing to split (need a following keyframe)', n ? 'success' : 'warn');
}

async function splitStrideFlow() { // Shift+M
  const sel = S.state.selection.keys;
  if (sel.length < 2) { toast('Select the start and end keyframes of a range first', 'warn'); return; }
  const stride = await promptModal({ title: 'Split stride', label: 'Insert a keyframe every N frames', placeholder: '5', initial: '5', okLabel: 'Split' });
  const n = parseInt(stride, 10);
  if (!n || n <= 0) return;
  const times = sel.map((k) => k.t);
  const tStart = Math.min(...times), tEnd = Math.max(...times);
  const byTrack = new Map();
  for (const k of sel) byTrack.set(`${k.itemId}|${k.track}`, k);
  for (const key of byTrack.keys()) {
    const [itemId, track] = key.split('|');
    S.splitStride(itemId, track, tStart, tEnd, n);
  }
  toast('Split stride applied');
}

async function fillFramesFlow() { // Shift+K
  const { itemId } = S.state.selection;
  const track = selectedTrackName();
  if (!itemId || !track) { toast('Select a joint or origin track first', 'warn'); return; }
  const tr = S.getTrack(itemId, track);
  if (!tr || tr.keys.length < 2) { toast('That track needs at least 2 keyframes', 'warn'); return; }
  const step = await promptModal({ title: 'Fill frames', label: 'Bake an explicit keyframe every N frames', placeholder: '1', initial: '1', okLabel: 'Fill' });
  const n = parseInt(step, 10);
  if (!n || n <= 0) return;
  S.fillFrames(itemId, track, tr.keys[0].t, tr.keys[tr.keys.length - 1].t, n);
  toast('Filled');
}

async function repeatFramesFlow() { // Shift+L
  const sel = S.state.selection.keys;
  if (sel.length < 2) { toast('Select the keyframe range to repeat first', 'warn'); return; }
  const times = await promptModal({ title: 'Repeat frames', label: 'Repeat this range how many extra times?', placeholder: '1', initial: '1', okLabel: 'Repeat' });
  const n = parseInt(times, 10);
  if (!n || n <= 0) return;
  S.repeatFrames(sel, n);
  toast('Repeated');
}

async function stretchFramesFlow() { // Keypad 3
  const sel = S.state.selection.keys;
  if (sel.length < 2) { toast('Select the keyframe range to stretch first', 'warn'); return; }
  const factor = await promptModal({ title: 'Stretch frames', label: 'Time scale factor (2 = twice as slow, 0.5 = twice as fast)', placeholder: '1.5', initial: '1', okLabel: 'Stretch' });
  const f = parseFloat(factor);
  if (!f || f <= 0) return;
  const moved = S.stretchFrames(sel, f);
  if (moved) S.setSelectedKeys(moved);
  toast('Stretched');
}

function mirrorSelectedItem() { // Ctrl+R
  const { itemId } = S.state.selection;
  const item = itemId ? S.getItem(itemId) : null;
  if (!item || item.kind !== 'rig') { toast('Select a rig first', 'warn'); return; }
  S.mirrorItem(itemId);
  toast(`${item.name} reflected`);
}

function toggleHandles() { // Ctrl+B
  setHandlesVisible(!S.state.handlesVisible);
  persistPrefs();
  toast(`Joint handles ${S.state.handlesVisible ? 'shown' : 'hidden'}`);
}
function smallHandles() { // Shift+B
  setHandleSize(S.state.handleSize === 'small' ? 'normal' : 'small');
  persistPrefs();
  toast(`Handle size: ${S.state.handleSize}`);
}
function hideHandlesForce() { // Shift+H
  setHandlesVisible(false);
  persistPrefs();
  toast('Handles hidden');
}
function toggleRotGrid() { // C
  setRotationSnap(!S.state.rotGridSnap);
  toast(`Rotation grid snap ${S.state.rotGridSnap ? `on (${S.state.rotGridDegrees}°)` : 'off'}`);
}

function toggleOnionForSelected(forceOn) { // N (force on) / B (toggle)
  const { itemId } = S.state.selection;
  if (!itemId || S.getItem(itemId)?.kind !== 'rig') { toast('Select a rig first', 'warn'); return; }
  if (forceOn) { S.setOnionSkin(itemId, true); toast('Onion skin on'); }
  else { const on = S.toggleOnionSkin(itemId); toast(`Onion skin ${on ? 'on' : 'off'}`); }
}
function clearOnionSkins() { // Alt+B
  S.clearAllOnionSkins();
  toast('Onion skins cleared');
}

async function animationSettingsFlow() { // Keypad 8
  const p = S.state.project;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <label class="fld-label">Priority</label>
    <select class="fld" id="asPriority" style="width:100%;margin-bottom:10px;"></select>
    <label class="fld-label">FPS</label>
    <input class="fld" id="asFps" type="number" min="1" max="120" style="width:100%;margin-bottom:10px;">
    <label class="fld-label">Length (frames)</label>
    <input class="fld" id="asLength" type="number" min="1" style="width:100%;margin-bottom:10px;">
    <label class="fld-label" style="display:flex;align-items:center;gap:8px;"><input type="checkbox" class="switch" id="asLoop"> Loop</label>
  `;
  const sel = wrap.querySelector('#asPriority');
  for (const opt of ['Idle', 'Movement', 'Action', 'Action2', 'Action3', 'Action4', 'Core']) sel.add(new Option(opt, opt));
  sel.value = p.priority;
  wrap.querySelector('#asFps').value = p.fps;
  wrap.querySelector('#asLength').value = p.length;
  wrap.querySelector('#asLoop').checked = p.loop;
  modal({
    title: 'Animation Settings',
    body: wrap,
    actions: [
      { label: 'Cancel', run: () => { } },
      {
        label: 'Apply', primary: true, run: () => {
          S.setProjectProp('priority', sel.value);
          S.setProjectProp('fps', Math.max(1, Math.min(120, parseInt(wrap.querySelector('#asFps').value) || p.fps)));
          S.setProjectProp('length', Math.max(1, parseInt(wrap.querySelector('#asLength').value) || p.length));
          S.setProjectProp('loop', wrap.querySelector('#asLoop').checked);
        },
      },
    ],
  });
}

async function cameraRotateFlow() { // Shift+O
  const { itemId } = S.state.selection;
  const item = itemId ? S.getItem(itemId) : null;
  if (!item || item.kind !== 'camera') { toast('Select a camera first', 'warn'); return; }
  const origin = S.evalTrackCF(itemId, '@origin', S.state.playhead, item.origin);
  const [rx, ry, rz] = CF.toEuler(origin).map((r) => Math.round((r * 180) / Math.PI));
  const wrap = document.createElement('div');
  wrap.className = 'vec3';
  wrap.innerHTML = `<input class="fld xyz x" type="number" value="${rx}"><input class="fld xyz y" type="number" value="${ry}"><input class="fld xyz z" type="number" value="${rz}">`;
  modal({
    title: 'Rotate camera (pitch / yaw / roll, degrees)',
    body: wrap,
    actions: [
      { label: 'Cancel', run: () => { } },
      {
        label: 'Apply', primary: true, run: () => {
          const [ix, iy, iz] = wrap.querySelectorAll('input');
          const toRad = (v) => (parseFloat(v.value) || 0) * Math.PI / 180;
          const next = CF.fromEuler(toRad(ix), toRad(iy), toRad(iz), origin[0], origin[1], origin[2]);
          S.setKey(itemId, '@origin', Math.round(S.state.playhead), next);
        },
      },
    ],
  });
}

async function jumpToItemFlow() { // Shift+P
  const items = S.state.project.items;
  if (!items.length) { toast('No items yet', 'warn'); return; }
  const pick = await chooseModal({
    title: 'Jump to item',
    options: items.map((i) => ({ id: i.id, label: i.name, icon: i.kind === 'camera' ? '🎥' : '🧍' })),
  });
  if (!pick) return;
  const item = S.getItem(pick);
  S.setSelection(pick, item.kind === 'camera' ? '@camera' : null);
  focusSelected();
}

function toggleHideUI() { // Ctrl+H
  S.state.uiHidden = !S.state.uiHidden;
  document.body.classList.toggle('ui-hidden', S.state.uiHidden);
}

function toggleCameraTracks() { // Ctrl+Space
  S.state.cameraTracksVisible = !S.state.cameraTracksVisible;
  S.emit('items');
  toast(`Camera tracks ${S.state.cameraTracksVisible ? 'shown' : 'hidden'}`);
}

function toggleSecondsDisplay() { // Shift+T
  S.state.showSeconds = !S.state.showSeconds;
  persistPrefs();
  S.emit('playhead', S.state.playhead);
}

async function quickSaveAndClose() { // Keypad /
  await saveProjectFlow(false);
  newProjectFlow();
}
function closeFileFlow() { // Backslash
  if (S.state.dirty) {
    modal({
      title: 'Close without saving?',
      body: '<p>This project has unsaved changes. Autosave already has a copy, but Save writes to your chosen file too.</p>',
      actions: [
        { label: 'Cancel', run: () => { } },
        { label: 'Close without saving', run: () => newProjectFlow() },
        { label: 'Save & close', primary: true, run: async () => { await saveProjectFlow(false); newProjectFlow(); } },
      ],
    });
  } else {
    newProjectFlow();
  }
}

// ================================================================ add items
function groundOriginFor(rig, index) {
  let minBottom = 0;
  for (const p of rig.parts) minBottom = Math.min(minBottom, p.cf[1] - p.size[1] / 2);
  const x = (index % 5) * 4 - 4;
  const z = Math.floor(index / 5) * -4;
  return CF.cfNew(x, -minBottom + 0.05, z);
}

function addRigItem(rig, name, studioId) {
  const idx = S.state.project.items.length;
  const item = {
    id: crypto.randomUUID(),
    kind: 'rig',
    name: name || rig.name,
    rig: structuredClone(rig),
    origin: groundOriginFor(rig, idx),
    visible: true,
    studioId: studioId || null, // links back to the exact Studio instance (via its CadenceId attribute) so exports never rely on name-matching — fixes Moon's rig-name-collision corruption
  };
  S.addItem(item);
  S.setSelection(item.id, null);
  toast(`Added ${item.name}`);
  return item;
}

async function addBuiltinRig(key) {
  if (!builtinRigs) builtinRigs = await window.cadence.builtinRigs();
  const rig = builtinRigs[key];
  if (!rig) { toast('Rig preset missing', 'error'); return null; }
  return addRigItem(rig, rig.name);
}

async function addAvatarFlow() {
  const username = await promptModal({ title: 'Add your avatar', label: 'Roblox username', placeholder: 'e.g. builderman' });
  if (!username) return;
  const prog = toastProgress(`Looking up ${username}…`);
  try {
    const user = await window.cadence.lookupUser(username);
    prog.update(`Building ${user.displayName}'s avatar in Studio…`);
    const res = await window.cadence.bridgeSend('buildAvatar', { userId: user.id }, 90000);
    addRigItem(res.rig, user.displayName, res.studioId);
    prog.done(`${user.displayName} added`);
  } catch (e) {
    prog.done(friendlyBridgeError(e), 'error');
  }
}

async function addFromStudioSelection() {
  const prog = toastProgress('Fetching selected rig from Studio…');
  try {
    const res = await window.cadence.bridgeSend('getSelectedRig', {}, 60000);
    addRigItem(res.rig, null, res.studioId);
    prog.done(`${res.rig.name} added from Studio`);
  } catch (e) {
    prog.done(friendlyBridgeError(e), 'error');
  }
}

async function addByAssetIdFlow() {
  const id = await promptModal({ title: 'Import from Roblox', label: 'Asset ID (model or rig)', placeholder: 'e.g. 1234567890' });
  if (!id) return;
  const prog = toastProgress('Importing asset…');
  // Prefer the Studio bridge (InsertService handles every asset type); fall back to direct download
  try {
    const res = await window.cadence.bridgeSend('insertAsset', { assetId: id }, 90000);
    addRigItem(res.rig, null, res.studioId);
    prog.done(`${res.rig.name} imported`);
    return;
  } catch (_) { /* fall through to web */ }
  try {
    const asset = await window.cadence.fetchAsset(id);
    const bytes = Uint8Array.from(atob(asset.base64), (c) => c.charCodeAt(0));
    await importModelBuffer(bytes.buffer, `asset ${id}`);
    prog.done('Imported');
  } catch (e) {
    prog.done('Import failed: ' + e.message, 'error');
  }
}

async function addFromFileFlow() {
  const paths = await window.cadence.openDialog({
    title: 'Import Roblox model',
    filters: [{ name: 'Roblox models', extensions: ['rbxm', 'rbxmx'] }],
    properties: ['openFile'],
  });
  if (!paths) return;
  const data = await window.cadence.readFileBinary(paths[0]);
  const arr = data instanceof ArrayBuffer ? data : new Uint8Array(data.data || data).buffer;
  await importModelBuffer(arr, paths[0].split(/[\\/]/).pop());
}

function treeRootsFromParse(parsed) {
  if (parsed.kind === 'xml') return IO.parseRbxmx(parsed.text);
  return parsed.roots;
}

async function importModelBuffer(arrayBuffer, label) {
  const parsed = await window.cadence.parseRbx(arrayBuffer, label);
  const roots = treeRootsFromParse(parsed);

  // What's inside? Rigs and/or KeyframeSequences (AnimSaves exports)
  const sequences = IO.findByClass(roots, 'KeyframeSequence');
  const hasParts = (() => { let found = false; IO.walkTree(roots, (n) => { if (n.className === 'Part' || n.className === 'MeshPart') found = true; }); return found; })();

  if (sequences.length && !hasParts) {
    return importSequencesFlow(sequences);
  }
  if (hasParts) {
    // pick the model node to rig-ify: root Model, or wrap all roots
    let modelNode = roots.find((r) => r.className === 'Model') || roots[0];
    if (roots.length > 1 && !roots.every((r) => r === modelNode)) {
      modelNode = { className: 'Model', name: label.replace(/\.\w+$/, ''), props: {}, children: roots };
    }
    const rig = IO.rigFromModelTree(modelNode);
    const item = addRigItem(rig);
    // bonus: if the rig carries AnimSaves, offer to import them onto it
    if (sequences.length) {
      const pick = await chooseModal({
        title: `${label} also contains ${sequences.length} animation${sequences.length > 1 ? 's' : ''}`,
        options: [
          ...sequences.map((sq, i) => ({ id: String(i), label: sq.name, desc: 'Import onto the new rig', icon: '🎞' })),
          { id: 'skip', label: 'Skip animations', icon: '✕' },
        ],
      });
      if (pick && pick !== 'skip') {
        const anim = IO.neutralAnimFromTree(sequences[Number(pick)]);
        const res = IO.applyAnimationToItem(item, anim);
        toast(`Imported "${anim.name}" — ${res.added} keys on ${res.tracks} joints`);
      }
    }
    return;
  }
  toast('No rig or animation found in that file', 'warn');
}

async function importSequencesFlow(sequences) {
  const rigItems = S.state.project.items.filter((i) => i.kind === 'rig');
  if (!rigItems.length) { toast('Add a rig first, then import the animation onto it', 'warn'); return; }
  let seq = sequences[0];
  if (sequences.length > 1) {
    const pick = await chooseModal({
      title: 'Choose an animation to import',
      options: sequences.map((sq, i) => ({ id: String(i), label: sq.name, icon: '🎞' })),
    });
    if (pick === null) return;
    seq = sequences[Number(pick)];
  }
  let target = S.getItem(S.state.selection.itemId);
  if (!target || target.kind !== 'rig') {
    if (rigItems.length === 1) target = rigItems[0];
    else {
      const pick = await chooseModal({
        title: 'Import onto which rig?',
        options: rigItems.map((i) => ({ id: i.id, label: i.name, icon: '🧍' })),
      });
      if (!pick) return;
      target = S.getItem(pick);
    }
  }
  const anim = IO.neutralAnimFromTree(seq);
  const res = IO.applyAnimationToItem(target, anim);
  toast(`Imported "${anim.name}" onto ${target.name} — ${res.added} keys${res.skipped ? `, ${res.skipped} poses skipped (no matching part)` : ''}`);
}

async function importAnimFileFlow() {
  const paths = await window.cadence.openDialog({
    title: 'Import animation',
    filters: [{ name: 'Roblox files', extensions: ['rbxm', 'rbxmx'] }],
    properties: ['openFile'],
  });
  if (!paths) return;
  const data = await window.cadence.readFileBinary(paths[0]);
  const arr = data instanceof ArrayBuffer ? data : new Uint8Array(data.data || data).buffer;
  const parsed = await window.cadence.parseRbx(arr, paths[0]);
  const roots = treeRootsFromParse(parsed);
  const sequences = IO.findByClass(roots, 'KeyframeSequence');
  if (!sequences.length) { toast('No KeyframeSequence in that file — use "Add from file" for rigs', 'warn'); return; }
  await importSequencesFlow(sequences);
}

async function importAnimByIdFlow() {
  const id = await promptModal({ title: 'Import animation', label: 'Animation asset ID', placeholder: 'e.g. 507766388' });
  if (!id) return;
  const rigItems = S.state.project.items.filter((i) => i.kind === 'rig');
  if (!rigItems.length) { toast('Add a rig first', 'warn'); return; }
  const prog = toastProgress('Fetching animation…');
  try {
    const res = await window.cadence.bridgeSend('getAnimationById', { assetId: id }, 60000);
    let target = S.getItem(S.state.selection.itemId);
    if (!target || target.kind !== 'rig') target = rigItems[0];
    const r = IO.applyAnimationToItem(target, res.anim);
    prog.done(`Imported onto ${target.name} — ${r.added} keys`);
  } catch (e) {
    prog.done(friendlyBridgeError(e), 'error');
  }
}

async function importAnimSavesFlow() {
  const prog = toastProgress('Reading AnimSaves from Studio…');
  try {
    const res = await window.cadence.bridgeSend('listAnimSaves', {}, 30000);
    prog.done(`Found ${res.rigs.length} rig(s) with saves`);
    const flat = [];
    for (const r of res.rigs) for (const a of r.anims) flat.push({ rig: r.name, anim: a });
    if (!flat.length) { toast('No AnimSaves found in the open place', 'warn'); return; }
    const pick = await chooseModal({
      title: 'Import which animation?',
      options: flat.map((f, i) => ({ id: String(i), label: f.anim, desc: `from ${f.rig}`, icon: '🎞' })),
    });
    if (pick === null) return;
    const chosen = flat[Number(pick)];
    const res2 = await window.cadence.bridgeSend('getAnimSave', { rigName: chosen.rig, animName: chosen.anim }, 60000);
    const rigItems = S.state.project.items.filter((i) => i.kind === 'rig');
    if (!rigItems.length) { toast('Add a rig first', 'warn'); return; }
    let target = S.getItem(S.state.selection.itemId);
    if (!target || target.kind !== 'rig') target = rigItems[0];
    const r = IO.applyAnimationToItem(target, res2.anim);
    toast(`Imported "${chosen.anim}" onto ${target.name} — ${r.added} keys`);
  } catch (e) {
    prog.done(friendlyBridgeError(e), 'error');
  }
}

function addCamera() {
  const item = {
    id: crypto.randomUUID(),
    kind: 'camera',
    name: `Camera ${S.state.project.items.filter((i) => i.kind === 'camera').length + 1}`,
    fov: 70,
    origin: [0, 5, 14, 1, 0, 0, 0, 1, 0, 0, 0, 1],
    visible: true,
  };
  S.addItem(item);
  S.setSelection(item.id, '@camera');
  toast('Camera added — press 0 to look through it');
}

async function addAudioFlow() {
  const paths = await window.cadence.openDialog({
    title: 'Add audio',
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }],
    properties: ['openFile'],
  });
  if (!paths) return;
  const prog = toastProgress('Decoding audio…');
  try {
    await loadAudioFromPath(paths[0], paths[0].split(/[\\/]/).pop());
    prog.done('Audio added — drag the waveform to offset it');
  } catch (e) {
    prog.done('Could not decode that audio file', 'error');
  }
}

// ================================================================ export
async function exportFlow(mode) {
  const rigItems = S.state.project.items.filter((i) => i.kind === 'rig');
  if (!rigItems.length) { toast('Nothing to export — add a rig and animate it', 'warn'); return; }
  let item = S.getItem(S.state.selection.itemId);
  if (!item || item.kind !== 'rig') {
    if (rigItems.length === 1) item = rigItems[0];
    else {
      const pick = await chooseModal({
        title: 'Export which rig’s animation?',
        options: rigItems.map((i) => ({ id: i.id, label: i.name, icon: '🧍' })),
      });
      if (!pick) return;
      item = S.getItem(pick);
    }
  }
  const name = await promptModal({ title: 'Animation name', label: 'Name', initial: S.state.project.name, okLabel: 'Export' });
  if (!name) return;
  const data = IO.buildExportData(item, { name });
  if (!data.keyframes.length) { toast(`${item.name} has no keyframes yet`, 'warn'); return; }

  if (mode === 'studio' || mode === 'publish') {
    const prog = toastProgress(mode === 'publish' ? 'Sending to Studio for publishing…' : 'Building KeyframeSequence in Studio…');
    try {
      const res = await window.cadence.bridgeSend('buildAnimation', { data, rigName: item.name, studioId: item.studioId, publish: mode === 'publish' }, 120000);
      if (mode === 'publish') {
        prog.done(res.publishHint || 'Sent! Open the Animation Editor in Studio to publish and get an asset ID.', 'success');
      } else {
        prog.done(`KeyframeSequence created in Studio (${res.path})`);
      }
    } catch (e) {
      prog.done(friendlyBridgeError(e), 'error');
    }
    return;
  }

  const xml = IO.buildKeyframeSequenceXML(data);
  if (mode === 'file') {
    const p = await window.cadence.saveDialog({
      title: 'Save animation',
      defaultPath: `${name}.rbxmx`,
      filters: [{ name: 'Roblox XML model', extensions: ['rbxmx'] }],
    });
    if (!p) return;
    await window.cadence.writeFile(p, xml);
    toast('Saved — drag the file into Roblox Studio to import');
    window.cadence.showItemInFolder(p);
  } else if (mode === 'rigfile') {
    const p = await window.cadence.saveDialog({
      title: 'Save rig + animation',
      defaultPath: `${item.name}.rbxmx`,
      filters: [{ name: 'Roblox XML model', extensions: ['rbxmx'] }],
    });
    if (!p) return;
    await window.cadence.writeFile(p, IO.buildRigModelXML(item, IO.innerXml(xml)));
    toast('Saved — drop it into Studio: rig, joints and AnimSaves included');
    window.cadence.showItemInFolder(p);
  }
}

function friendlyBridgeError(e) {
  const msg = String(e.message || e);
  if (msg.includes('not connected')) {
    return 'Studio bridge offline — open Roblox Studio (with the Cadence plugin installed) and click Connect on its toolbar.';
  }
  return msg.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

// ================================================================ project files
async function newProjectFlow() {
  S.newProject();
  toast('New project');
}

async function openProjectFlow() {
  const paths = await window.cadence.openDialog({
    title: 'Open project',
    filters: [{ name: 'Cadence project', extensions: ['cadence', 'json'] }],
    properties: ['openFile'],
  });
  if (!paths) return;
  try {
    const text = await window.cadence.readFile(paths[0]);
    S.loadProject(text, paths[0]);
    await restoreAudio();
    toast(`Opened ${S.state.project.name}`);
  } catch (e) {
    toast('Could not open project: ' + e.message, 'error');
  }
}

async function saveProjectFlow(saveAs) {
  let p = S.state.projectPath;
  if (saveAs || !p) {
    p = await window.cadence.saveDialog({
      title: 'Save project',
      defaultPath: `${S.state.project.name}.cadence`,
      filters: [{ name: 'Cadence project', extensions: ['cadence'] }],
    });
    if (!p) return;
    S.state.projectPath = p;
  }
  await window.cadence.writeFile(p, S.serialize());
  S.state.dirty = false;
  S.emit('dirty');
  toast('Project saved');
}

async function offerRecovery(always = false) {
  const saves = await window.cadence.autosaveList().catch(() => []);
  if (!saves.length) { if (always) toast('No autosaves yet'); return; }
  if (!always && Date.now() - saves[0].mtime > 1000 * 60 * 60 * 24 * 7) return;
  if (!always && saves[0].id === S.state.project.id) return;
  const opts = [];
  for (const sv of saves.slice(0, 6)) {
    try {
      const text = await window.cadence.autosaveRead(sv.id);
      const proj = JSON.parse(text);
      // Every launch autosaves the fresh empty project — don't nag "restore?" for sessions
      // that never actually had anything in them (they're still reachable via the explicit command).
      if (!always && (!proj.items || proj.items.length === 0) && !proj.audio) continue;
      const when = new Date(sv.mtime);
      opts.push({ id: sv.id, label: proj.name || 'Untitled', desc: `${when.toLocaleString()} · ${proj.items?.length || 0} items`, icon: '🕘', __text: text });
    } catch (_) { }
  }
  if (!opts.length) return;
  const pick = await chooseModal({
    title: always ? 'Restore an autosave' : 'Welcome back — restore where you left off?',
    options: [...opts, { id: 'fresh', label: 'Start fresh', desc: 'keep autosaves for later', icon: '✨' }],
  });
  if (pick && pick !== 'fresh') {
    const chosen = opts.find((o) => o.id === pick);
    S.loadProject(chosen.__text);
    await restoreAudio();
    toast(`Restored "${S.state.project.name}"`);
  }
}

// ================================================================ top bar / transport / explorer / inspector
function wireTopBar() {
  const nameEl = document.getElementById('projectName');
  nameEl.addEventListener('blur', () => {
    const v = nameEl.textContent.trim() || 'Untitled';
    if (v !== S.state.project.name) { S.state.project.name = v; S.markDirty(); }
  });
  nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } });
  S.on('project', () => { nameEl.textContent = S.state.project.name; });

  const dot = document.getElementById('saveDot');
  S.on('dirty', () => dot.classList.add('dirty'));
  S.on('autosaved', () => { dot.classList.remove('dirty'); dot.classList.add('pulse'); setTimeout(() => dot.classList.remove('pulse'), 600); });

  document.getElementById('addBtn').addEventListener('click', addMenuFlow);
  document.getElementById('importBtn').addEventListener('click', importMenuFlow);
  document.getElementById('exportBtn').addEventListener('click', () => exportMenuFlow());
  document.getElementById('camChip').addEventListener('click', toggleCameraView);
  document.getElementById('mcpBtn').addEventListener('click', enableClaudeControlFlow);
  document.getElementById('shortcutsBtn').addEventListener('click', showShortcuts);

  wireUpdateChip();
}

// ================================================================ auto-update
function wireUpdateChip() {
  const chip = document.getElementById('updateChip');
  const txt = chip.querySelector('.txt');

  const render = (s) => {
    chip.classList.remove('downloading', 'ready');
    if (s.status === 'available') {
      chip.classList.add('show');
      txt.textContent = `Update available (${s.info?.version || ''}) — click to download`;
    } else if (s.status === 'downloading') {
      chip.classList.add('show', 'downloading');
      const pct = s.progress ? Math.round(s.progress.percent) : 0;
      txt.textContent = `Downloading update… ${pct}%`;
    } else if (s.status === 'ready') {
      chip.classList.add('show', 'ready');
      txt.textContent = `Restart to update to ${s.info?.version || ''}`;
    } else if (s.status === 'error') {
      chip.classList.remove('show'); // a failed background check shouldn't alarm the user
    } else {
      chip.classList.remove('show');
    }
  };

  window.cadence.getUpdateState().then(render);
  window.cadence.onUpdateState(render);

  chip.addEventListener('click', async () => {
    const s = await window.cadence.getUpdateState();
    if (s.status === 'available') {
      await window.cadence.downloadUpdate();
    } else if (s.status === 'ready') {
      modal({
        title: 'Restart to finish updating?',
        body: `<p>Cadence will close and reopen on v${s.info?.version || 'the new version'}. Everything autosaves, so nothing will be lost.</p>`,
        actions: [
          { label: 'Not now', run: () => { } },
          { label: 'Restart now', primary: true, run: () => window.cadence.installUpdate() },
        ],
      });
    }
  });
}

async function checkForUpdatesFlow() {
  const prog = toastProgress('Checking for updates…');
  const s = await window.cadence.checkForUpdate();
  if (s.status === 'available') prog.done(`Update available: v${s.info?.version} — click the chip in the title bar to download`, 'success');
  else if (s.status === 'not-available') prog.done(s.error || 'You’re on the latest version', s.error ? 'warn' : 'success');
  else if (s.status === 'error') prog.done('Could not check for updates: ' + s.error, 'error');
  else prog.done('Checked');
}

async function enableClaudeControlFlow() {
  const prog = toastProgress('Registering with Claude Code…');
  try {
    const res = await window.cadence.registerMcpServer();
    if (res.ok) {
      prog.done('Done — ask Claude to work on your animation. Restart Claude Code if it was already running.', 'success');
      return;
    }
    prog.done(
      res.reason === 'claude-not-found' ? 'Claude Code CLI not found — copy the command below' : 'Automatic setup failed — copy the command below',
      'warn',
    );
    const wrap = document.createElement('div');
    const intro = document.createElement('p');
    intro.textContent = 'Run this in a terminal (Claude Code must be installed):';
    const outro = document.createElement('p');
    outro.textContent = 'Then launch this app and ask Claude to work on your animation.';
    wrap.appendChild(intro);
    wrap.appendChild(copyableRow(res.manualCommand));
    wrap.appendChild(outro);
    modal({
      title: 'Set up Claude Control manually',
      body: wrap,
      actions: [{ label: 'Got it', primary: true, run: () => { } }],
    });
  } catch (e) {
    prog.done('Could not register: ' + e.message, 'error');
  }
}

async function addMenuFlow() {
  const pick = await chooseModal({
    title: 'Add to scene',
    options: [
      { id: 'r6', label: 'R6 rig', desc: 'classic blocky', icon: '🧍' },
      { id: 'r15', label: 'R15 rig', desc: 'standard 15-part', icon: '🧍' },
      { id: 'rthro', label: 'Rthro rig', desc: 'realistic proportions', icon: '🧍' },
      { id: 'rthroSlender', label: 'Rthro Slender', desc: 'slim proportions', icon: '🧍' },
      { id: 'avatar', label: 'Your Roblox avatar…', desc: 'type any username', icon: '👤' },
      { id: 'studio', label: 'From Studio selection', desc: 'select a rig in Studio first', icon: '🔗' },
      { id: 'asset', label: 'From asset ID…', desc: 'any model on Roblox', icon: '🌐' },
      { id: 'file', label: 'From file…', desc: '.rbxm / .rbxmx — or just drop it here', icon: '📄' },
      { id: 'camera', label: 'Camera', desc: 'animatable, with FOV track', icon: '🎥' },
      { id: 'audio', label: 'Audio track…', desc: 'waveform + scrubbing', icon: '🔊' },
    ],
  });
  if (!pick) return;
  if (pick === 'avatar') addAvatarFlow();
  else if (pick === 'studio') addFromStudioSelection();
  else if (pick === 'asset') addByAssetIdFlow();
  else if (pick === 'file') addFromFileFlow();
  else if (pick === 'camera') addCamera();
  else if (pick === 'audio') addAudioFlow();
  else addBuiltinRig(pick);
}

async function importMenuFlow() {
  const pick = await chooseModal({
    title: 'Import animation',
    options: [
      { id: 'file', label: 'From file', desc: 'AnimSaves / KeyframeSequence .rbxm(x)', icon: '📄' },
      { id: 'id', label: 'By Roblox animation ID', desc: 'via the Studio bridge', icon: '🌐' },
      { id: 'animsaves', label: 'From a rig in Studio', desc: 'reads AnimSaves (incl. Moon exports)', icon: '🔗' },
    ],
  });
  if (pick === 'file') importAnimFileFlow();
  else if (pick === 'id') importAnimByIdFlow();
  else if (pick === 'animsaves') importAnimSavesFlow();
}

async function exportMenuFlow() {
  const pick = await chooseModal({
    title: 'Export animation',
    options: [
      { id: 'studio', label: 'Straight into Studio', desc: 'KeyframeSequence appears in the rig’s AnimSaves', icon: '🔗' },
      { id: 'publish', label: 'Publish to Roblox', desc: 'opens Studio’s upload dialog → asset ID', icon: '🚀' },
      { id: 'file', label: 'Animation file (.rbxmx)', desc: 'drop into Studio anytime', icon: '📄' },
      { id: 'rigfile', label: 'Rig + animation file', desc: 'one file with rig, joints, AnimSaves', icon: '📦' },
    ],
  });
  if (pick) exportFlow(pick);
}

function wireTransport() {
  const playBtn = document.getElementById('playBtn');
  playBtn.addEventListener('click', togglePlay);
  S.on('playing', (v) => { playBtn.textContent = v ? '⏸' : '▶'; playBtn.classList.toggle('active', v); });
  document.getElementById('stopBtn').addEventListener('click', () => { S.setPlaying(false); S.setPlayhead(0); });
  document.getElementById('stepBackBtn').addEventListener('click', () => S.setPlayhead(Math.round(S.state.playhead) - 1));
  document.getElementById('stepFwdBtn').addEventListener('click', () => S.setPlayhead(Math.round(S.state.playhead) + 1));

  const frameBox = document.getElementById('frameBox');
  const renderFrameBox = (t) => {
    if (S.state.showSeconds && S.state.project) {
      frameBox.textContent = `${(t / S.state.project.fps).toFixed(2)}s`;
    } else {
      frameBox.textContent = `${Math.round(t * 10) / 10}`;
    }
  };
  S.on('playhead', renderFrameBox);
  const fpsInput = document.getElementById('fpsInput');
  const lenInput = document.getElementById('lenInput');
  S.on('project', () => { fpsInput.value = S.state.project.fps; lenInput.value = S.state.project.length; });
  S.on('project-props', () => { fpsInput.value = S.state.project.fps; lenInput.value = S.state.project.length; });
  fpsInput.addEventListener('change', () => {
    const v = Math.max(1, Math.min(120, parseInt(fpsInput.value) || 30));
    S.setProjectProp('fps', v);
  });
  lenInput.addEventListener('change', () => {
    const v = Math.max(1, Math.min(36000, parseInt(lenInput.value) || 90));
    S.setProjectProp('length', v);
  });

  const loopBtn = document.getElementById('loopBtn');
  loopBtn.classList.toggle('active', S.state.loopPlayback);
  loopBtn.addEventListener('click', () => {
    S.state.loopPlayback = !S.state.loopPlayback;
    loopBtn.classList.toggle('active', S.state.loopPlayback);
  });

  const autoKeyBtn = document.getElementById('autoKeyBtn');
  autoKeyBtn.classList.toggle('active', S.state.autoKey);
  autoKeyBtn.addEventListener('click', toggleAutoKey);
  S.on('any', () => autoKeyBtn.classList.toggle('active', S.state.autoKey));

  document.getElementById('keyBtn').addEventListener('click', keyCurrentPose);
  document.getElementById('curveBtn').addEventListener('click', toggleCurveEditor);
  document.getElementById('fitBtn').addEventListener('click', zoomToFit);

  // gizmo chips
  document.getElementById('moveBtn').addEventListener('click', () => setGizmoMode('translate'));
  document.getElementById('rotateBtn').addEventListener('click', () => setGizmoMode('rotate'));
  S.on('gizmo-mode', (m) => {
    document.getElementById('moveBtn').classList.toggle('active', m === 'translate');
    document.getElementById('rotateBtn').classList.toggle('active', m === 'rotate');
  });
  document.getElementById('moveBtn').classList.add('active');
}

function wireExplorer() {
  const listEl = document.getElementById('itemList');
  const rebuild = () => {
    listEl.innerHTML = '';
    for (const item of S.state.project.items) {
      const row = document.createElement('div');
      row.className = 'item-row' + (S.state.selection.itemId === item.id ? ' selected' : '');
      row.innerHTML = `<span class="ic"></span><span class="nm"></span><button class="eye" title="Show / hide">${item.visible !== false ? '👁' : '·'}</button><button class="del" title="Remove">✕</button>`;
      row.querySelector('.ic').textContent = item.kind === 'camera' ? '🎥' : '🧍';
      row.querySelector('.nm').textContent = item.name;
      row.addEventListener('click', () => S.setSelection(item.id, item.kind === 'camera' ? '@camera' : null));
      row.querySelector('.nm').addEventListener('dblclick', async (e) => {
        e.stopPropagation();
        const name = await promptModal({ title: 'Rename', label: 'Name', initial: item.name });
        if (name) S.renameItem(item.id, name);
      });
      row.querySelector('.eye').addEventListener('click', (e) => {
        e.stopPropagation();
        item.visible = item.visible === false;
        const inst = getInstance(item.id);
        if (inst?.group) inst.group.visible = item.visible;
        S.emit('items');
        S.markDirty();
      });
      row.querySelector('.del').addEventListener('click', (e) => {
        e.stopPropagation();
        S.removeItem(item.id);
        toast(`Removed ${item.name}`);
      });
      listEl.appendChild(row);
    }
    if (!S.state.project.items.length) {
      listEl.innerHTML = `<div class="empty-hint">Press <b>+</b> to add a rig,<br>or drop a .rbxm file anywhere.</div>`;
    }
  };
  S.on('items', rebuild);
  S.on('project', rebuild);
  S.on('selection', rebuild);
  document.getElementById('addItemBtn').addEventListener('click', addMenuFlow);
}

function wireInspector() {
  const el = document.getElementById('inspectorBody');
  const rebuild = () => {
    el.innerHTML = '';
    if (!S.state.project) return;
    const { itemId, partId, keys } = S.state.selection;
    const item = itemId ? S.getItem(itemId) : null;

    // keyframes section
    if (keys.length) {
      const sec = section('Keyframes');
      sec.appendChild(fieldRow('Selected', `${keys.length} key${keys.length > 1 ? 's' : ''}`));
      const k0 = S.getKey(keys[0].itemId, keys[0].track, keys[0].t);
      if (k0) {
        const styleSel = selectField('Easing style', STYLES, k0.bez ? 'Cubic' : (k0.es || 'Cubic'), (v) => S.setEasing(keys, v, null, null));
        const dirSel = selectField('Direction', DIRECTIONS, k0.ed || 'Out', (v) => S.setEasing(keys, null, v, null));
        sec.appendChild(styleSel);
        sec.appendChild(dirSel);
        const btn = button(k0.bez ? 'Edit bezier curve' : 'Open curve editor', () => openCurveEditor());
        sec.appendChild(btn);
      }
      el.appendChild(sec);
    }

    if (item && partId && partId !== '@origin' && partId !== '@camera' && item.rig) {
      const j = (item.rig.joints || []).find((j) => j.part1 === partId && j.kind !== 'weld');
      const partDef = item.rig.parts.find((p) => p.id === partId);
      const sec = section(partDef ? partDef.name : 'Part');
      if (j) {
        sec.appendChild(fieldRow('Joint', j.name));
        const cur = S.evalTrackCF(itemId, j.name, S.state.playhead);
        const [rx, ry, rz] = CF.toEuler(cur).map((r) => Math.round((r * 180) / Math.PI * 100) / 100);
        sec.appendChild(vecField('Position', [cur[0], cur[1], cur[2]], (vals) => {
          const next = CF.setPosition(cur, vals[0], vals[1], vals[2]);
          S.setKey(itemId, j.name, Math.round(S.state.playhead), next);
        }));
        sec.appendChild(vecField('Rotation °', [rx, ry, rz], (vals) => {
          const next = CF.fromEuler(vals[0] * Math.PI / 180, vals[1] * Math.PI / 180, vals[2] * Math.PI / 180, cur[0], cur[1], cur[2]);
          S.setKey(itemId, j.name, Math.round(S.state.playhead), next);
        }));
        sec.appendChild(button('Reset joint to rest pose', () => {
          S.setKey(itemId, j.name, Math.round(S.state.playhead), CF.IDENTITY.slice());
        }));
      } else {
        sec.appendChild(fieldRow('Joint', 'none (root or welded)'));
      }
      el.appendChild(sec);
    }

    if (item) {
      const sec = section(item.kind === 'camera' ? 'Camera' : 'Rig');
      sec.appendChild(fieldRow('Name', item.name));
      if (item.kind === 'camera') {
        const fov = S.evalTrackNum(item.id, '@fov', S.state.playhead, item.fov || 70);
        sec.appendChild(numField('Field of view', Math.round(fov * 10) / 10, (v) => {
          S.setKey(item.id, '@fov', Math.round(S.state.playhead), Math.max(5, Math.min(120, v)));
        }));
        sec.appendChild(button(S.state.cameraView === item.id ? 'Exit camera view' : 'Look through camera', toggleCameraView));
      } else {
        sec.appendChild(fieldRow('Joints', String((item.rig.joints || []).filter((j) => j.kind !== 'weld').length)));
        sec.appendChild(fieldRow('Parts', String(item.rig.parts.length)));
      }
      el.appendChild(sec);
    }

    // animation section (always)
    const sec = section('Animation');
    const p = S.state.project;
    sec.appendChild(selectField('Priority', ['Idle', 'Movement', 'Action', 'Action2', 'Action3', 'Action4', 'Core'], p.priority, (v) => S.setProjectProp('priority', v)));
    sec.appendChild(checkField('Loop', p.loop, (v) => S.setProjectProp('loop', v)));
    if (p.audio) {
      sec.appendChild(fieldRow('Audio', p.audio.name));
      sec.appendChild(numField('Audio offset (frames)', p.audio.offset || 0, (v) => setAudioOffset(v)));
      sec.appendChild(rangeField('Audio volume', p.audio.volume ?? 1, (v) => setAudioVolume(v)));
      sec.appendChild(button('Remove audio', removeAudio));
    }
    el.appendChild(sec);
  };
  ['selection', 'items', 'project', 'project-props', 'tracks', 'audio', 'playhead'].forEach((ev) => S.on(ev, rebuild));
  rebuild();
}

// small field builders
function section(title) {
  const d = document.createElement('div');
  d.className = 'insp-section';
  d.innerHTML = `<div class="insp-title">${title}</div>`;
  return d;
}
function fieldRow(label, value) {
  const d = document.createElement('div');
  d.className = 'insp-row';
  d.innerHTML = `<span class="l"></span><span class="v"></span>`;
  d.querySelector('.l').textContent = label;
  d.querySelector('.v').textContent = value;
  return d;
}
function selectField(label, options, value, onChange) {
  const d = document.createElement('div');
  d.className = 'insp-row';
  const sel = document.createElement('select');
  sel.className = 'fld';
  for (const o of options) sel.add(new Option(o, o));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  d.innerHTML = `<span class="l">${label}</span>`;
  d.appendChild(sel);
  return d;
}
function numField(label, value, onChange) {
  const d = document.createElement('div');
  d.className = 'insp-row';
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'fld';
  input.value = value;
  input.addEventListener('change', () => onChange(parseFloat(input.value) || 0));
  d.innerHTML = `<span class="l">${label}</span>`;
  d.appendChild(input);
  return d;
}
function vecField(label, vals, onChange) {
  const d = document.createElement('div');
  d.className = 'insp-row vec';
  d.innerHTML = `<span class="l">${label}</span><div class="vec3"></div>`;
  const wrap = d.querySelector('.vec3');
  const inputs = vals.map((v, i) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.1';
    input.className = 'fld xyz ' + 'xyz'[i];
    input.value = Math.round(v * 1000) / 1000;
    input.addEventListener('change', () => onChange(inputs.map((inp) => parseFloat(inp.value) || 0)));
    wrap.appendChild(input);
    return input;
  });
  return d;
}
function checkField(label, value, onChange) {
  const d = document.createElement('div');
  d.className = 'insp-row';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'switch';
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  d.innerHTML = `<span class="l">${label}</span>`;
  d.appendChild(input);
  return d;
}
function rangeField(label, value, onChange) {
  const d = document.createElement('div');
  d.className = 'insp-row';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = 0; input.max = 1; input.step = 0.01;
  input.value = value;
  input.addEventListener('input', () => onChange(parseFloat(input.value)));
  d.innerHTML = `<span class="l">${label}</span>`;
  d.appendChild(input);
  return d;
}
function button(label, onClick) {
  const b = document.createElement('button');
  b.className = 'btn small';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// ================================================================ drag & drop
function wireDragDrop() {
  const overlay = document.getElementById('dropOverlay');
  window.addEventListener('dragover', (e) => { e.preventDefault(); overlay.classList.add('show'); });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) overlay.classList.remove('show'); });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    overlay.classList.remove('show');
    for (const file of e.dataTransfer.files) {
      const name = file.name.toLowerCase();
      try {
        if (name.endsWith('.cadence') || name.endsWith('.json')) {
          const text = await file.text();
          S.loadProject(text);
          await restoreAudio();
          toast(`Opened ${S.state.project.name}`);
        } else if (name.endsWith('.rbxm') || name.endsWith('.rbxmx')) {
          await importModelBuffer(await file.arrayBuffer(), file.name);
        } else if (/\.(mp3|wav|ogg|m4a|flac)$/.test(name)) {
          const path = await window.cadence.storeAudio(file.name, await file.arrayBuffer());
          await loadAudioFromPath(path, file.name);
          toast('Audio added');
        } else {
          toast(`Don’t know what to do with ${file.name}`, 'warn');
        }
      } catch (err) {
        console.error(err);
        toast(`${file.name}: ${err.message}`, 'error');
      }
    }
  });
}

// ================================================================ bridge status
let lastBridgeStatus = { connected: false, placeName: null, port: null, lastSeen: 0, bindError: null };
function wireBridge() {
  const chip = document.getElementById('bridgeChip');
  const set = (s) => {
    lastBridgeStatus = s;
    chip.classList.toggle('on', !!s.connected);
    chip.classList.toggle('error', !!s.bindError);
    chip.querySelector('.txt').textContent = s.bindError ? 'Bridge error'
      : s.connected ? (s.placeName || 'Studio connected') : 'Studio offline';
  };
  window.cadence.bridgeStatus().then(set);
  window.cadence.onBridgeStatus(set);
  window.cadence.onBridgeEvent(async (ev) => {
    if (ev.type === 'rigPushed' && ev.data?.rig) {
      addRigItem(ev.data.rig, null, ev.data.studioId);
      toast(`${ev.data.rig.name} sent from Studio`);
    } else if (ev.type === 'animPushed' && ev.data?.anim) {
      const rigItems = S.state.project.items.filter((i) => i.kind === 'rig');
      if (!rigItems.length) { toast('Received animation, but there’s no rig to put it on', 'warn'); return; }
      let target = S.getItem(S.state.selection.itemId);
      if (!target || target.kind !== 'rig') target = rigItems[0];
      const r = IO.applyAnimationToItem(target, ev.data.anim);
      toast(`Animation from Studio → ${target.name} (${r.added} keys)`);
    } else if (ev.type === 'rigResynced' && ev.data?.rig) {
      // "Sync Pose" in Studio: someone used the native Move/Rotate tools on the live rig,
      // so its rest geometry drifted from what Cadence has. Re-anchor to the corrected bind pose
      // without touching existing keyframes — this is the fix for Moon's "outside-tool breakage" bug.
      const target = S.state.project.items.find((i) => i.studioId && i.studioId === ev.data.studioId);
      if (!target) { toast('Synced a rig Cadence doesn’t have open', 'warn'); return; }
      S.pushUndo();
      target.rig = ev.data.rig;
      S.emit('items');
      refreshInstance(target.id);
      S.markDirty();
      toast(`${target.name} re-synced from Studio’s current pose`);
    }
  });
  chip.addEventListener('click', showBridgeStatusModal);
}

function timeAgo(ms) {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 2) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// Full status — port, place, connection state, and (if the bridge server itself failed to
// start) exactly why — instead of just an on/off dot. Reachable any time by clicking the chip,
// not just when disconnected, so it never gets in the way of just checking on things.
function showBridgeStatusModal() {
  const s = lastBridgeStatus;
  const wrap = document.createElement('div');

  if (s.bindError) {
    const warn = document.createElement('p');
    warn.className = 'bridge-warn';
    warn.textContent = s.bindError;
    wrap.appendChild(warn);
  }

  wrap.appendChild(fieldRow('Status', s.bindError ? 'Failed to start' : s.connected ? 'Connected' : 'Waiting for Studio'));
  wrap.appendChild(fieldRow('Port', String(s.port || 35747)));
  wrap.appendChild(fieldRow('Place', s.connected ? (s.placeName || 'Roblox Studio') : '—'));
  wrap.appendChild(fieldRow('Last contact', s.connected || s.lastSeen ? timeAgo(s.lastSeen) : 'never'));

  const howTo = document.createElement('p');
  howTo.className = 'bridge-help';
  howTo.innerHTML = s.connected
    ? 'Connected — Studio is talking to this app on <b>127.0.0.1</b>. Use the <b>Send Selection</b> / <b>Sync Pose</b> buttons on the Cadence toolbar in Studio any time.'
    : 'This app only listens — the connection is made from Studio\'s side. In Studio: open the <b>Cadence Animator</b> toolbar tab and click <b>Connect</b>. If it still won\'t connect, check Game Settings → Security → <b>Allow HTTP Requests</b> is on.';
  wrap.appendChild(howTo);

  modal({
    title: 'Roblox Studio bridge',
    body: wrap,
    actions: [
      { label: 'Install / reinstall plugin', run: () => installPluginFlow() },
      { label: 'Close', primary: true, run: () => { } },
    ],
  });
}

async function installPluginFlow() {
  try {
    const dest = await window.cadence.installPlugin();
    const wrap = document.createElement('div');
    const intro = document.createElement('p');
    intro.textContent = 'Cadence Bridge was copied to:';
    const outro = document.createElement('p');
    outro.innerHTML = '1. Restart Roblox Studio (or right-click the Plugins folder → reload).<br>2. Click <b>Connect</b> on the Cadence toolbar in Studio.<br>3. Allow HTTP requests to <b>127.0.0.1</b> when Studio asks.';
    wrap.appendChild(intro);
    wrap.appendChild(copyableRow(dest));
    wrap.appendChild(outro);
    modal({
      title: 'Studio plugin installed',
      body: wrap,
      actions: [{ label: 'Got it', primary: true, run: () => { } }],
    });
  } catch (e) {
    toast('Could not install plugin: ' + e.message, 'error');
  }
}

// ================================================================ MCP (Claude control)
// Every handler here is designed to never show a blocking modal — Claude drives these
// unattended, so anything that would normally prompt a human takes its parameters directly.
const MCP_HANDLERS = {
  get_state: () => JSON.parse(S.serialize()),

  list_items: () => S.state.project.items.map((i) => ({
    id: i.id, name: i.name, kind: i.kind,
    joints: i.rig ? (i.rig.joints || []).filter((j) => j.kind !== 'weld').map((j) => j.name) : undefined,
    tracks: Object.keys(S.getTracks(i.id)),
    studioId: i.studioId || null,
  })),

  list_builtin_rigs: () => Object.keys(builtinRigs || {}),

  // Clears a "Welcome back?" recovery prompt or onboarding card blocking the view — lets Claude
  // recover from a stale modal without a human needing to click through it first.
  dismiss_blocking_modal: () => {
    let dismissed = false;
    const freshCard = [...document.querySelectorAll('.choose-card')].find((c) => c.querySelector('.t')?.textContent.includes('Start fresh'));
    if (freshCard) { freshCard.click(); dismissed = true; }
    const onboardBtn = document.getElementById('onboardStart');
    if (onboardBtn && document.getElementById('onboarding').classList.contains('show')) { onboardBtn.click(); dismissed = true; }
    const cancelBtn = [...document.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent.trim() === 'Cancel');
    if (cancelBtn) { cancelBtn.click(); dismissed = true; }
    return { dismissed };
  },

  add_rig: async ({ rigType }) => {
    const item = await addBuiltinRig(rigType);
    if (!item) throw new Error(`Unknown rig type "${rigType}" — try r6, r15, rthro, or rthroSlender`);
    return { itemId: item.id, name: item.name, rootPart: item.rig.rootPart, joints: (item.rig.joints || []).filter((j) => j.kind !== 'weld').map((j) => j.name) };
  },
  add_camera: () => {
    addCamera();
    const item = S.state.project.items[S.state.project.items.length - 1];
    return { itemId: item.id, name: item.name };
  },
  remove_item: ({ itemId }) => { S.removeItem(itemId); return { ok: true }; },

  select: ({ itemId, partId }) => { S.setSelection(itemId ?? null, partId ?? null); return { ok: true }; },

  set_keyframe: ({ itemId, track, t, value, es, ed, bez }) => {
    if (!S.getItem(itemId)) throw new Error(`No item with id ${itemId}`);
    S.setKey(itemId, track, t, value, { es, ed, bez });
    return { itemId, track, t };
  },
  get_track: ({ itemId, track }) => S.getTrack(itemId, track) || { keys: [] },
  delete_keyframes: ({ keys }) => { S.deleteKeys(keys); return { ok: true }; },
  move_keyframes: ({ keys, dt }) => ({ moved: S.moveKeys(keys, dt) }),
  group_keys: ({ keys }) => ({ group: S.groupKeys(keys) }),
  ungroup_keys: ({ keys }) => ({ ok: S.ungroupKeys(keys) }),
  mirror_item: ({ itemId }) => { S.mirrorItem(itemId); return { ok: true }; },
  fill_frames: ({ itemId, track, tStart, tEnd, step }) => { S.fillFrames(itemId, track, tStart, tEnd, step || 1); return { ok: true }; },
  repeat_frames: ({ keys, times }) => { S.repeatFrames(keys, times); return { ok: true }; },
  stretch_frames: ({ keys, factor }) => ({ moved: S.stretchFrames(keys, factor) }),

  // Pure query — world CFrame per part for an arbitrary frame, without touching the display.
  // This is the ground-truth numeric alternative to eyeballing a screenshot.
  get_pose: ({ itemId, frame }) => {
    const item = S.getItem(itemId);
    if (!item) throw new Error(`No item with id ${itemId}`);
    const inst = getInstance(itemId);
    if (!inst || !inst.solvePoseWorlds) throw new Error('That item has no posable rig');
    const pose = S.evalPose(item, frame);
    const origin = S.evalTrackCF(itemId, '@origin', frame, item.origin);
    const worlds = inst.solvePoseWorlds(pose, origin);
    const out = {};
    for (const [partId, cf] of worlds) out[partId] = cf;
    return { pose, worlds: out };
  },

  validate_animation: ({ itemId }) => validateAnimation(itemId),

  // Resolves only after the new pose has actually been computed AND painted at least once
  // (double-rAF), not just after the state changed — screenshots taken right after this ack
  // must not race three.js's own render loop.
  scrub_to_frame: ({ frame }) => {
    S.setPlayhead(frame, false);
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({ frame: S.state.playhead })));
    });
  },

  set_project_props: ({ fps, length, loop, priority, name }) => {
    if (fps !== undefined) S.setProjectProp('fps', fps);
    if (length !== undefined) S.setProjectProp('length', length);
    if (loop !== undefined) S.setProjectProp('loop', loop);
    if (priority !== undefined) S.setProjectProp('priority', priority);
    if (name !== undefined) S.setProjectProp('name', name);
    return { ok: true };
  },

  undo: () => ({ ok: S.undo() }),
  redo: () => ({ ok: S.redo() }),

  save_project: async () => {
    if (S.state.projectPath) {
      await window.cadence.writeFile(S.state.projectPath, S.serialize());
      S.state.dirty = false;
      S.emit('dirty');
      return { savedTo: S.state.projectPath };
    }
    return { savedTo: null, note: 'No file path chosen yet (use Save As in the app once) — autosave already has every change.' };
  },

  export_to_studio: async ({ itemId, name, publish }) => {
    const item = S.getItem(itemId);
    if (!item || item.kind !== 'rig') throw new Error(`No rig item with id ${itemId}`);
    const data = IO.buildExportData(item, { name: name || item.name });
    if (!data.keyframes.length) throw new Error(`${item.name} has no keyframes yet`);
    const res = await window.cadence.bridgeSend('buildAnimation', { data, rigName: item.name, studioId: item.studioId, publish: !!publish }, 120000);
    return res;
  },
};

function initMcp() {
  window.cadence.onMcpCommand(async ({ id, type, payload }) => {
    const handler = MCP_HANDLERS[type];
    if (!handler) { window.cadence.mcpRespond(id, false, null, `Unknown MCP command: ${type}`); return; }
    try {
      const data = await handler(payload || {});
      window.cadence.mcpRespond(id, true, data ?? null, null);
    } catch (e) {
      window.cadence.mcpRespond(id, false, null, e.message || String(e));
    }
  });
}

// ================================================================ onboarding
function showOnboarding() {
  const back = document.getElementById('onboarding');
  back.classList.add('show');
  document.getElementById('onboardStart').addEventListener('click', () => {
    back.classList.remove('show');
    settings.onboarded = true;
    window.cadence.setSettings(settings);
  });
  document.getElementById('onboardPlugin').addEventListener('click', installPluginFlow);
}

boot();
