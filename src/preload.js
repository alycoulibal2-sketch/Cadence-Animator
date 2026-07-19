'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cadence', {
  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),

  // dialogs / files
  openDialog: (opts) => ipcRenderer.invoke('dialog:open', opts),
  saveDialog: (opts) => ipcRenderer.invoke('dialog:save', opts),
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  readFileBinary: (p) => ipcRenderer.invoke('file:readBinary', p),
  writeFile: (p, content) => ipcRenderer.invoke('file:write', p, content),
  showItemInFolder: (p) => ipcRenderer.invoke('shell:showItem', p),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  copyText: (text) => ipcRenderer.invoke('shell:copyText', text),

  // autosave
  autosaveWrite: (id, data) => ipcRenderer.invoke('autosave:write', id, data),
  autosaveList: () => ipcRenderer.invoke('autosave:list'),
  autosaveRead: (id) => ipcRenderer.invoke('autosave:read', id),
  autosaveDelete: (id) => ipcRenderer.invoke('autosave:delete', id),

  // close-time flush handshake (see main.js's win.on('close', ...))
  onFlushBeforeClose: (cb) => ipcRenderer.on('app:flushBeforeClose', () => cb()),
  flushComplete: () => ipcRenderer.send('app:flushComplete'),

  // rigs
  builtinRigs: () => ipcRenderer.invoke('rig:builtins'),

  // audio + plugin
  storeAudio: (name, arrayBuffer) => ipcRenderer.invoke('audio:store', name, arrayBuffer),
  installPlugin: () => ipcRenderer.invoke('plugin:install'),

  // roblox web
  fetchAsset: (id) => ipcRenderer.invoke('roblox:fetchAsset', id),
  fetchMesh: (id) => ipcRenderer.invoke('roblox:mesh', id),
  fetchTexture: (id) => ipcRenderer.invoke('roblox:texture', id),
  lookupUser: (username) => ipcRenderer.invoke('roblox:userId', username),
  classicFace: () => ipcRenderer.invoke('roblox:classicFace'),

  // roblox files
  parseRbx: (arrayBuffer, filename) => ipcRenderer.invoke('rbx:parseBuffer', arrayBuffer, filename),

  // local images (face preset layers)
  readImageAsDataUri: (p) => ipcRenderer.invoke('image:readAsDataUri', p),

  // studio bridge
  bridgeStatus: () => ipcRenderer.invoke('bridge:status'),
  bridgeSend: (type, payload, timeoutMs) => ipcRenderer.invoke('bridge:send', type, payload, timeoutMs),
  onBridgeStatus: (cb) => ipcRenderer.on('bridge:status', (_e, s) => cb(s)),
  onBridgeEvent: (cb) => ipcRenderer.on('bridge:event', (_e, ev) => cb(ev)),

  // MCP control channel (Claude driving the app directly)
  onMcpCommand: (cb) => ipcRenderer.on('mcp:command', (_e, cmd) => cb(cmd)),
  mcpRespond: (id, ok, data, error) => ipcRenderer.send('mcp:response', { id, ok, data, error }),
  registerMcpServer: () => ipcRenderer.invoke('mcp:registerServer'),
  mcpBindStatus: () => ipcRenderer.invoke('mcp:bindStatus'),

  // mobile companion (phone viewer/remote)
  mobileEnable: () => ipcRenderer.invoke('mobile:enable'),
  mobileDisable: () => ipcRenderer.invoke('mobile:disable'),
  mobileStatus: () => ipcRenderer.invoke('mobile:status'),
  mobileSetEditingAllowed: (allowed) => ipcRenderer.invoke('mobile:setEditingAllowed', allowed),
  mobileBroadcastState: (payload) => ipcRenderer.send('mobile:broadcastState', payload),
  onMobileClientConnected: (cb) => ipcRenderer.on('mobile:clientConnected', () => cb()),

  // VFX Studio (standalone particle-effect creation window)
  openVfxStudio: () => ipcRenderer.invoke('vfx:openStudio'),
  onReceiveVfxFromStudio: (cb) => ipcRenderer.on('vfx:receiveFromStudio', (_e, config) => cb(config)),
  // "Edit a copy in VFX Studio…": opens/focuses the studio and loads this document as its
  // current effect (replacing whatever was open there) — a one-way copy, not a live link;
  // sending it back from the studio creates a new item, same as any other studio-authored effect.
  sendEffectToStudio: (effectDoc) => ipcRenderer.invoke('vfx:loadEffectIntoStudio', effectDoc),
  // Test/debug only: drives the real MCP command dispatcher (handleMcpCommand — the exact same
  // function both the animator's own tools AND the vfx_* studio tools go through) from the main
  // renderer, so the smoketest can assert on actual behavior instead of just "it didn't crash".
  // Not a new privilege boundary — the same command set is already reachable unauthenticated
  // over the localhost MCP HTTP port.
  debugCallMcp: (type, payload) => ipcRenderer.invoke('debug:callMcp', type, payload),

  // auto-update
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getUpdateState: () => ipcRenderer.invoke('update:getState'),
  onUpdateState: (cb) => ipcRenderer.on('update:state', (_e, s) => cb(s)),
});
