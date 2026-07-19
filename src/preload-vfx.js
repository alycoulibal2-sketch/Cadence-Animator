'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vfxStudio', {
  // studio -> animator (full effect documents; the receiving side parses + adds undoably)
  sendToAnimator: (config) => ipcRenderer.send('vfx:sendToAnimator', config),

  // personal preset library (persisted in settings.json)
  listUserPresets: () => ipcRenderer.invoke('vfx:userPresets:list'),
  saveUserPreset: (preset) => ipcRenderer.invoke('vfx:userPresets:save', preset),
  deleteUserPreset: (id) => ipcRenderer.invoke('vfx:userPresets:delete', id),

  // studio-local autosave (userData/vfx-studio-autosave.cfx — separate from animator projects)
  autosaveEffect: (json) => ipcRenderer.invoke('vfx:autosave:save', json),
  loadAutosavedEffect: () => ipcRenderer.invoke('vfx:autosave:load'),

  // .cfx files + Luau export (dialog-backed; return the chosen path or null on cancel)
  saveEffectFile: (json, suggestedName) => ipcRenderer.invoke('vfx:file:saveEffect', json, suggestedName),
  openEffectFile: () => ipcRenderer.invoke('vfx:file:openEffect'),
  saveTextFile: (text, suggestedName) => ipcRenderer.invoke('vfx:file:saveText', text, suggestedName),

  // MCP command pipe (main process relays Claude's vfx_* tool calls here)
  onMcpCommand: (cb) => ipcRenderer.on('vfxmcp:command', (_e, msg) => cb(msg)),
  mcpResponse: (msg) => ipcRenderer.send('vfxmcp:response', msg),
});
