// VFX Studio v2 — boot + wiring only. The real machinery lives in the sibling modules:
// studioState (doc/undo/autosave/validation), preview (three.js + screen fx + shake),
// clipTimeline (layers column + clips + key rows), inspector, curveEditor (drawer),
// presetsPanel (modal browser), diagnosticsPanel (chip + list). Everything document-shaped is
// shared with the main window via renderer/js/effect*.js — this window renders the same pure
// engine the animator and the exporter consume.

import * as ST from './studioState.js';
import { initPreview } from './preview.js';
import { initClipTimeline } from './clipTimeline.js';
import { initInspector } from './inspector.js';
import { initCurveEditor } from './curveEditor.js';
import { openPresetBrowser } from './presetsPanel.js';
import { initDiagnosticsPanel } from './diagnosticsPanel.js';
import { serializeEffect, parseEffect } from '../../renderer/js/effectModel.js';
import { buildEffectLua } from '../../renderer/js/effectExport.js';
import { toast, modal } from '../../renderer/js/ui.js';
import { isNodeEditorOpen, openNodeEditor } from './nodeEditor.js';

// ---------------------------------------------------------------- transport
function initTransport() {
  const playBtn = document.getElementById('vfxPlayBtn');
  const stopBtn = document.getElementById('vfxStopBtn');
  const frameLabel = document.getElementById('vfxFrameLabel');

  playBtn.addEventListener('click', () => ST.setPlaying(!ST.state.playing));
  stopBtn.addEventListener('click', () => { ST.setPlaying(false); ST.setPlayhead(0); });
  ST.on('playing', () => { playBtn.textContent = ST.state.playing ? '⏸' : '▶'; });
  const updateFrame = () => {
    frameLabel.textContent = `frame ${Math.floor(ST.state.playhead)} / ${ST.state.doc.duration}`;
  };
  ST.on('playhead', updateFrame);
  ST.on('effect', updateFrame);
  updateFrame();
}

// ---------------------------------------------------------------- new / start over
// The ONLY other way to reach this choice was the preset browser's one-time blank-state flow on
// first boot — once past that, there was no button anywhere to get back to it. Reopens the exact
// same "choose a preset, or ⬜ Start from scratch" browser rather than silently forcing a blank
// canvas — either action inside it is already one undoable step with its own "Open replaces your
// effect" hint, so no separate confirm dialog is needed here.
function newEffectFlow() {
  openPresetBrowser({ blankState: true });
}

// ---------------------------------------------------------------- gate: errors block send/export
function gateOnErrors(actionLabel) {
  const report = ST.validateNow('effect');
  if (report.counts.error > 0) {
    toast(`${report.counts.error} error(s) block ${actionLabel} — open the diagnostics chip to fix them`, 'error');
    document.getElementById('vfxDiagChip').click();
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- titlebar actions
function initTitlebar() {
  const nameInput = document.getElementById('vfxNameInput');
  const syncName = () => {
    if (document.activeElement !== nameInput) nameInput.value = ST.state.doc.name;
  };
  ST.on('effect', syncName);
  syncName();
  nameInput.addEventListener('change', () => {
    ST.mutate((doc) => { doc.name = nameInput.value.trim() || 'Untitled Effect'; });
  });

  document.getElementById('newBtn').addEventListener('click', () => newEffectFlow());
  document.getElementById('presetsBtn').addEventListener('click', () => openPresetBrowser());

  // Reopens the SAME graph if this effect already has one (closing the node editor modal never
  // discards ST.state.graph — only replacing the whole doc does). If this effect wasn't
  // node-authored, starts a fresh graph first — same "replaces the doc as one undo step" contract
  // every other doc-replacing action here already uses (newBlankDoc/Open/apply preset), so
  // Ctrl+Z still restores whatever was open, no separate confirm dialog needed.
  document.getElementById('nodesBtn').addEventListener('click', () => {
    if (!ST.state.graph) {
      ST.newBlankGraph();
      toast('Started a new node graph — Ctrl+Z restores what was open');
    }
    openNodeEditor();
  });

  document.getElementById('openBtn').addEventListener('click', async () => {
    const file = await window.vfxStudio.openEffectFile();
    if (!file) return;
    const parsed = parseEffect(file.json);
    if (!parsed.ok) { toast(`Could not open: ${parsed.error}`, 'error'); return; }
    ST.pushUndo();
    ST.setDoc(parsed.doc);
    toast(`Opened "${parsed.doc.name}"`);
  });

  document.getElementById('saveBtn').addEventListener('click', saveToFile);

  document.getElementById('savePresetBtn').addEventListener('click', async () => {
    const doc = ST.state.doc;
    await window.vfxStudio.saveUserPreset({
      id: `user-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      name: doc.name,
      category: 'My Presets',
      effect: JSON.parse(serializeEffect(doc)),
    });
    toast(`Saved "${doc.name}" to your presets`);
  });

  const advBtn = document.getElementById('advancedBtn');
  advBtn.addEventListener('click', () => {
    ST.setAdvanced(!ST.state.advanced);
    advBtn.classList.toggle('active', ST.state.advanced);
    toast(ST.state.advanced
      ? 'Advanced mode: expression fields (ƒ) are editable per property'
      : 'Advanced mode off');
  });

  document.getElementById('exportLuaBtn').addEventListener('click', async () => {
    if (!gateOnErrors('export')) return;
    const exportReport = ST.validateNow('export');
    const { lua, notes } = buildEffectLua(ST.state.doc);
    const body = document.createElement('div');
    body.className = 'vfx-export-summary';
    const p = document.createElement('div');
    p.textContent = 'A self-contained LocalScript that rebuilds this effect with real Roblox instances (emitters, beams, lights, UI, shake, sound). Parent it anywhere client-side and it plays on a PlayEffect BindableEvent (or immediately, if you enable autoplay in the script header).';
    body.appendChild(p);
    if (exportReport.diagnostics.length) {
      const h = document.createElement('div');
      h.className = 'vfx-export-notes-head';
      h.textContent = `Export fidelity notes (${exportReport.diagnostics.length}):`;
      body.appendChild(h);
      for (const d of exportReport.diagnostics.slice(0, 12)) {
        const row = document.createElement('div');
        row.className = 'vfx-diag-causes';
        row.textContent = `• ${d.message}`;
        body.appendChild(row);
      }
    }
    modal({
      title: '📜 Export to Roblox (Luau)',
      body,
      actions: [
        {
          label: '💾 Save .lua file', run: async () => {
            const saved = await window.vfxStudio.saveTextFile(lua, `${ST.state.doc.name.replace(/[^\w\- ]+/g, '').trim() || 'effect'}.lua`);
            if (saved) toast(`Saved ${saved}`);
          },
        },
        {
          label: '📋 Copy to clipboard', run: async () => {
            await navigator.clipboard.writeText(lua);
            toast('Luau script copied');
          },
        },
        { label: 'Cancel', run: () => { } },
      ],
    });
    void notes;
  });

  document.getElementById('sendBtn').addEventListener('click', () => {
    if (!gateOnErrors('sending to the animator')) return;
    window.vfxStudio.sendToAnimator({ effect: JSON.parse(serializeEffect(ST.state.doc)) });
    toast(`Sent "${ST.state.doc.name}" to the animator`);
  });
}

async function saveToFile() {
  const saved = await window.vfxStudio.saveEffectFile(serializeEffect(ST.state.doc), `${ST.state.doc.name.replace(/[^\w\- ]+/g, '').trim() || 'effect'}.cfx`);
  if (saved) {
    ST.state.dirty = false;
    toast(`Saved ${saved}`);
  }
}

// ---------------------------------------------------------------- keyboard
function isTyping() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
}
function initKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (isTyping()) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.code === 'Space') {
      e.preventDefault();
      ST.setPlaying(!ST.state.playing);
    } else if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (!ST.undo()) toast('Nothing to undo');
    } else if ((ctrl && e.key.toLowerCase() === 'y') || (ctrl && e.shiftKey && e.key.toLowerCase() === 'z')) {
      e.preventDefault();
      if (!ST.redo()) toast('Nothing to redo');
    } else if (ctrl && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveToFile();
    } else if (ctrl && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      newEffectFlow();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      // The node editor is a modal with its own keydown handler + stopPropagation for the keys
      // it owns — this global fallback should never ALSO fire and delete an unrelated layer
      // selection while the editor's open (belt-and-suspenders on top of stopPropagation).
      if (isNodeEditorOpen()) return;
      const layer = ST.selectedLayer();
      if (layer) {
        e.preventDefault();
        ST.mutate((doc) => { doc.layers = doc.layers.filter((l) => l.id !== layer.id); });
        toast(`Deleted "${layer.name}" — Ctrl+Z restores it`);
      }
    } else if (e.key === 'Home') {
      ST.setPlayhead(0);
    } else if (e.key === 'ArrowLeft') {
      ST.setPlayhead(Math.floor(ST.state.playhead) - (e.shiftKey ? 5 : 1));
    } else if (e.key === 'ArrowRight') {
      ST.setPlayhead(Math.floor(ST.state.playhead) + (e.shiftKey ? 5 : 1));
    }
  });
}

// ---------------------------------------------------------------- MCP bridge (registered late,
// after every panel exists — handlers reach into all of them)
import { initStudioMcp } from './mcp.js';

// ---------------------------------------------------------------- boot
async function boot() {
  initPreview();
  initClipTimeline();
  initInspector();
  initCurveEditor();
  initDiagnosticsPanel();
  initTransport();
  initTitlebar();
  initKeyboard();
  initStudioMcp();

  // Animator -> studio: "Edit a copy in VFX Studio…" loads an existing item's document here,
  // replacing whatever was open (one undo step) — see docs/vfx-studio.md's edit-in-studio scope.
  window.vfxStudio.onLoadEffect((doc) => {
    const parsed = parseEffect(doc);
    if (!parsed.ok) { toast(`Could not load effect: ${parsed.error}`, 'error'); return; }
    ST.pushUndo();
    ST.setDoc(parsed.doc);
    toast(`Loaded "${parsed.doc.name}" for editing — Ctrl+Z restores what was open`);
  });

  const restored = await ST.restoreAutosave();
  if (!restored) {
    // Blank-state flow: the first thing a beginner sees is the preset browser, never an empty
    // panel arrangement. "Start from scratch" gives one live emitter layer, already selected.
    ST.newBlankDoc();
    openPresetBrowser({ blankState: true });
  }
}
boot().catch((e) => {
  console.error('[vfxStudio] boot failed', e);
  toast(`VFX Studio failed to start: ${e.message}`, 'error', 10000);
});
