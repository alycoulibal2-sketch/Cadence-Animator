'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vfxStudio', {
  sendToAnimator: (config) => ipcRenderer.send('vfx:sendToAnimator', config),
  listUserPresets: () => ipcRenderer.invoke('vfx:userPresets:list'),
  saveUserPreset: (preset) => ipcRenderer.invoke('vfx:userPresets:save', preset),
  deleteUserPreset: (id) => ipcRenderer.invoke('vfx:userPresets:delete', id),
});
