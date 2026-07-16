'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { parse: parseRbxBin } = require('./lib/rbxbin');
const { parseMesh } = require('./lib/rbxmesh');
const { autoUpdater } = require('electron-updater');

const BRIDGE_PORT = 35747;
const MCP_PORT = 35748;
const isScreenshotRun = process.argv.some((a) => a.startsWith('--screenshot'));

let win = null;

// Only one Cadence window/process should ever be running at once: both the Studio bridge and the
// MCP control server below bind fixed local ports, and a second process launched for "a new
// project" would silently lose the race for those ports (whichever process bound first keeps
// answering Claude/Studio; the second just sits there looking dead, with no clue why). Bailing
// out here — before any port is touched — means opening the app again always reaches the same
// live process instead of spawning a competitor.
//
// app.quit() alone isn't enough to guarantee that: it only marks the app to quit once the event
// loop gets to it, and app.whenReady() can still resolve and run its callback (createWindow,
// startBridgeServer, startMcpServer — the exact port binds we're trying to avoid) in the
// meantime. gotSingleInstanceLock is checked again inside that callback below to actually skip
// them, not just rely on quit's timing — verified directly: without that check, a second launch
// still logged its own "port already in use" errors before quitting.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

// A renderer crash (this sandbox sees intermittent GPU/software-rendering crashes under load)
// can leave `win` alive but its webContents/frame gone — guard every push to the renderer
// through this instead of the bare `win && !win.isDestroyed()` check used before, which missed
// that case and threw "Render frame was disposed" from inside an event handler.
function safeSend(channel, payload) {
  if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

// ---------------------------------------------------------------- paths
const userData = () => app.getPath('userData');
const cacheDir = (sub) => {
  const d = path.join(userData(), 'cache', sub);
  try {
    fs.mkdirSync(d, { recursive: true });
  } catch (e) {
    // A locked/permission-denied cache folder shouldn't break asset fetching — every caller
    // below already treats "not on disk" as a cache miss and falls back to fetching fresh.
    console.error('cache dir unavailable, continuing without disk cache:', d, e.message);
  }
  return d;
};
const autosaveDir = () => {
  const d = path.join(userData(), 'autosaves');
  fs.mkdirSync(d, { recursive: true });
  return d;
};

// ---------------------------------------------------------------- settings
const settingsPath = () => path.join(userData(), 'settings.json');
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch (_) { return {}; }
}
function writeSettings(s) {
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
}

// ---------------------------------------------------------------- window
function createWindow() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: 1520,
    height: 920,
    minWidth: 980,
    minHeight: 600,
    backgroundColor: '#0d0d12',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0d0d12', symbolColor: '#8a8a96', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
    show: false,
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  const LEVELS = ['VERBOSE', 'INFO', 'WARNING', 'ERROR'];
  // Packaged Windows builds have no attached console, so stdout from console.log below is
  // invisible when launched normally — mirror everything to a file so it's debuggable either way.
  const logPath = path.join(app.getPath('userData'), 'debug.log');
  const logLine = (line) => {
    try { fs.appendFileSync(logPath, line + '\n'); } catch (_) { }
  };
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const tag = LEVELS[level] || 'LOG';
    const src = sourceId ? sourceId.split(/[\\/]/).pop() : '?';
    const out = `[renderer:${tag}] ${message} (${src}:${line})`;
    console.log(out);
    logLine(out);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    const out = `[renderer] process gone: ${details.reason}`;
    console.error(out);
    logLine(out);
    // Any in-flight MCP request (e.g. Claude mid-tool-call) would otherwise hang until its own
    // timeout — fail them immediately so the caller finds out right away, then bring the window
    // back so the user (or Claude) isn't left staring at a permanently blank/frozen app.
    for (const [id, p] of mcpPending) {
      clearTimeout(p.timer);
      p.reject(new Error('Renderer crashed mid-request'));
    }
    mcpPending.clear();
    if (win && !win.isDestroyed()) win.reload();
  });
  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    const out = `[preload error] ${preloadPath} ${error}`;
    console.error(out);
    logLine(out);
  });

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });

  if (process.argv.includes('--devtools')) {
    win.webContents.once('did-finish-load', () => {
      win.webContents.openDevTools({ mode: 'bottom' });
    });
  }

  if (isScreenshotRun) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const demoFileArg = process.argv.find((a) => a.startsWith('--demo-js-file='));
          const demoInlineArg = process.argv.find((a) => a.startsWith('--demo-js='));
          const code = demoFileArg ? fs.readFileSync(demoFileArg.slice('--demo-js-file='.length), 'utf8')
            : demoInlineArg ? demoInlineArg.slice('--demo-js='.length)
              : null;
          if (code) {
            await win.webContents.executeJavaScript(code);
            await new Promise((r) => setTimeout(r, 3500)); // let async mesh/texture fetches settle
          }
          const img = await win.webContents.capturePage();
          const arg = process.argv.find((a) => a.startsWith('--screenshot'));
          const out = arg.includes('=') ? arg.split('=')[1] : path.join(app.getAppPath(), 'cadence-shot.png');
          fs.writeFileSync(out, img.toPNG());
        } catch (e) { console.error('screenshot failed', e); }
        app.quit();
      }, 4000);
    });
  }
}

app.on('second-instance', () => {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  createWindow();
  startBridgeServer();
  startMcpServer();
  initAutoUpdater();
});
app.on('window-all-closed', () => app.quit());

// ---------------------------------------------------------------- auto-update
// Checks GitHub Releases (see package.json's build.publish) for a newer version. Never
// installs without the user choosing to — download and install-on-restart are both explicit,
// renderer-driven actions, never silent, since this replaces the running app's files.
let updateState = { status: 'idle', info: null, progress: null, error: null }; // idle | checking | available | downloading | ready | not-available | error

function sendUpdateState() {
  safeSend('update:state', updateState);
}

function initAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    updateState = { status: 'checking', info: null, progress: null, error: null };
    sendUpdateState();
  });
  autoUpdater.on('update-available', (info) => {
    updateState = { status: 'available', info: { version: info.version, releaseDate: info.releaseDate }, progress: null, error: null };
    sendUpdateState();
  });
  autoUpdater.on('update-not-available', () => {
    updateState = { status: 'not-available', info: null, progress: null, error: null };
    sendUpdateState();
  });
  autoUpdater.on('download-progress', (p) => {
    updateState = { ...updateState, status: 'downloading', progress: { percent: p.percent, bytesPerSecond: p.bytesPerSecond, transferred: p.transferred, total: p.total } };
    sendUpdateState();
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateState = { status: 'ready', info: { version: info.version }, progress: null, error: null };
    sendUpdateState();
  });
  autoUpdater.on('error', (err) => {
    updateState = { status: 'error', info: null, progress: null, error: err.message };
    sendUpdateState();
  });

  // Quiet check shortly after launch — doesn't interrupt anything, just populates the state
  // so the title bar can show a dot if an update is already known to be available.
  if (app.isPackaged) {
    setTimeout(() => { autoUpdater.checkForUpdates().catch(() => { /* surfaced via the 'error' event above */ }); }, 4000);
  }
}

ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return { status: 'not-available', info: null, progress: null, error: 'Updates only run in a packaged build, not in dev mode.' };
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    updateState = { status: 'error', info: null, progress: null, error: e.message };
  }
  return updateState;
});
ipcMain.handle('update:download', async () => {
  try {
    await autoUpdater.downloadUpdate();
  } catch (e) {
    updateState = { status: 'error', info: null, progress: null, error: e.message };
    sendUpdateState();
  }
  return updateState;
});
ipcMain.handle('update:install', () => {
  autoUpdater.quitAndInstall();
  return true;
});
ipcMain.handle('update:getState', () => updateState);

// ---------------------------------------------------------------- helpers
async function robloxFetch(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'CadenceAnimator/0.1' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function normalizeAssetId(idOrUrl) {
  if (typeof idOrUrl === 'number') return String(idOrUrl);
  const s = String(idOrUrl).trim();
  const m = s.match(/(\d{4,})/);
  return m ? m[1] : null;
}

function assetUrl(id) {
  return `https://assetdelivery.roblox.com/v1/asset/?id=${id}`;
}

// ---------------------------------------------------------------- IPC: settings & files
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_e, s) => { writeSettings(s); return true; });

ipcMain.handle('dialog:open', async (_e, opts) => {
  const r = await dialog.showOpenDialog(win, opts);
  return r.canceled ? null : r.filePaths;
});
ipcMain.handle('dialog:save', async (_e, opts) => {
  const r = await dialog.showSaveDialog(win, opts);
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('file:read', (_e, p) => fs.readFileSync(p, 'utf8'));
ipcMain.handle('file:readBinary', (_e, p) => fs.readFileSync(p));
ipcMain.handle('file:write', (_e, p, content) => {
  fs.writeFileSync(p, typeof content === 'string' ? content : Buffer.from(content));
  return true;
});
ipcMain.handle('shell:showItem', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));
ipcMain.handle('shell:copyText', (_e, text) => { clipboard.writeText(text); return true; });

// ---------------------------------------------------------------- IPC: autosave (data-loss protection)
ipcMain.handle('autosave:write', (_e, projectId, data) => {
  const dir = autosaveDir();
  const file = path.join(dir, `${projectId}.cadence`);
  // rotate: keep last 10 generations, snapshot every write
  try {
    if (fs.existsSync(file)) {
      for (let i = 9; i >= 1; i--) {
        const from = path.join(dir, `${projectId}.bak${i}`);
        const to = path.join(dir, `${projectId}.bak${i + 1}`);
        if (fs.existsSync(from)) fs.renameSync(from, to);
      }
      fs.copyFileSync(file, path.join(dir, `${projectId}.bak1`));
    }
  } catch (_) { /* rotation is best-effort */ }
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file); // atomic replace: a crash mid-write can never corrupt the autosave
  return file;
});
ipcMain.handle('autosave:list', () => {
  const dir = autosaveDir();
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.cadence'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { id: f.replace(/\.cadence$/, ''), mtime: st.mtimeMs, size: st.size, path: path.join(dir, f) };
    })
    .sort((a, b) => b.mtime - a.mtime);
});
ipcMain.handle('autosave:read', (_e, projectId) => {
  return fs.readFileSync(path.join(autosaveDir(), `${projectId}.cadence`), 'utf8');
});

// ---------------------------------------------------------------- IPC: audio store (for drag&dropped files)
ipcMain.handle('audio:store', (_e, name, arrayBuffer) => {
  const dir = path.join(userData(), 'audio');
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(name).replace(/[^\w.\- ]/g, '_');
  const p = path.join(dir, `${Date.now()}_${safe}`);
  fs.writeFileSync(p, Buffer.from(arrayBuffer));
  return p;
});

// ---------------------------------------------------------------- IPC: Studio plugin installer
ipcMain.handle('plugin:install', () => {
  const src = path.join(app.getAppPath(), 'plugin', 'CadenceBridge.lua');
  const dir = path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'Plugins');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'CadenceBridge.lua');
  fs.copyFileSync(src, dest);
  // clean up the pre-rename plugin file so Studio doesn't end up with two duplicate toolbar tabs
  try { fs.unlinkSync(path.join(dir, 'EclipseBridge.lua')); } catch (_) { }
  return dest;
});

// Finds a real system `node` binary the same way runClaudeCli finds `claude` — via the OS's own
// PATH search, not a bare execFileSync('node', ...) call that would miss anything installed as a
// non-.exe shim. Returns null (not a throw) if none is found, so callers can fall back cleanly.
function resolveSystemNode() {
  const { execFileSync } = require('child_process');
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    const out = execFileSync(finder, ['node'], { encoding: 'utf8' });
    const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return first || null;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------- IPC: MCP server registration
// npm installs register themselves via bin/register-mcp.js at postinstall (a plain system `node`
// process can run the loose mcp-server/index.js file directly, no asar involved at all).
//
// A packaged .exe has no separate Node.js runtime bundled, and the script normally lives inside
// app.asar which a vanilla system `node` can't read into — so historically this pointed Claude
// Code at the exe itself running in "act as Node" mode (Electron's ELECTRON_RUN_AS_NODE trick).
// That works, but the exe is the FULL ~85MB Electron/Chromium binary — measurably slow to cold-
// start as a throwaway "just run this one script" process, and materially worse when the user
// also has the real app open at the same time (the normal case, since they'd want to actually
// see what Claude is doing) — confirmed directly: over 20s to connect under that contention,
// long enough that Claude Code's own reconnect UI gave up and reported a failure even though the
// server would have come up fine given more time.
//
// mcp-server/**/* and node_modules/**/* are both asarUnpack'd (see package.json) specifically so
// a real system `node.exe` CAN read them directly with no asar involved — prefer that whenever
// one is actually installed (extremely common; anyone who installed this app via npm already has
// one), and only fall back to the heavier Electron-exe trick if truly no system Node exists.
function buildMcpCommand() {
  if (app.isPackaged) {
    const unpackedServerPath = path.join(app.getAppPath() + '.unpacked', 'mcp-server', 'index.js');
    const systemNode = resolveSystemNode();
    if (systemNode) {
      return { command: systemNode, args: [unpackedServerPath], env: null };
    }
    return { command: process.execPath, args: [path.join(app.getAppPath(), 'mcp-server', 'index.js')], env: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  const serverPath = path.join(app.getAppPath(), 'mcp-server', 'index.js');
  return { command: 'node', args: [serverPath], env: null };
}

// Runs `claude` reliably — this is the actual fix for "Claude Control can't detect the CLI" even
// on a machine where `claude` works fine in any terminal: a global npm install puts a
// `claude.cmd` shim on Windows (not a real .exe), and execFileSync('claude', ...) does a raw
// CreateProcess call that — unlike a real shell — never consults PATHEXT, so the bare word
// 'claude' silently never resolves. .cmd/.bat files also can't be launched directly by
// CreateProcess at all (a Node/Windows-documented limitation, not specific to this bug) — they
// need cmd.exe to interpret them. Routing through `cmd.exe /c` fixes both problems in one step:
// cmd.exe does its own real PATHEXT resolution, and Node's own argv-array escaping (NOT
// shell:true, which does naive unescaped string concatenation) keeps arguments containing spaces
// intact — verified directly, since this app's own install path ("...\Cadence Animator\...")
// contains one.
function runClaudeCli(args, opts) {
  const { execFileSync } = require('child_process');
  if (process.platform === 'win32') {
    return execFileSync('cmd.exe', ['/c', 'claude', ...args], opts);
  }
  return execFileSync('claude', args, opts);
}

ipcMain.handle('mcp:registerServer', () => {
  const { command, args, env } = buildMcpCommand();
  const manualCommand = `claude mcp add cadence-animator ${env ? Object.entries(env).map(([k, v]) => `--env ${k}=${v} `).join('') : ''}-- ${command} ${args.map((a) => `"${a}"`).join(' ')}`;

  try {
    runClaudeCli(['--version'], { stdio: 'ignore' });
  } catch (_) {
    return { ok: false, reason: 'claude-not-found', manualCommand };
  }
  // `mcp add` errors out if cadence-animator is already registered (e.g. from an earlier click,
  // or an earlier app version) — remove any existing entry first so this button always works
  // instead of failing with a confusing "setup failed" the second time it's ever pressed.
  try {
    runClaudeCli(['mcp', 'remove', 'cadence-animator', '-s', 'local'], { stdio: 'ignore' });
  } catch (_) { /* fine if it wasn't registered yet */ }
  try {
    const mcpArgs = ['mcp', 'add', 'cadence-animator'];
    if (env) for (const [k, v] of Object.entries(env)) mcpArgs.push('--env', `${k}=${v}`);
    mcpArgs.push('--', command, ...args);
    runClaudeCli(mcpArgs, { stdio: 'ignore' });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'register-failed', error: e.message, manualCommand };
  }
});

// ---------------------------------------------------------------- IPC: rigs
ipcMain.handle('rig:builtins', () => {
  const p = path.join(app.getAppPath(), 'rigs', 'builtin.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
});

// ---------------------------------------------------------------- IPC: Roblox web
ipcMain.handle('roblox:fetchAsset', async (_e, idOrUrl) => {
  const id = normalizeAssetId(idOrUrl);
  if (!id) throw new Error('Could not parse an asset id from: ' + idOrUrl);
  const buf = await robloxFetch(assetUrl(id));
  return { id, base64: buf.toString('base64') };
});

const meshMemCache = new Map();
ipcMain.handle('roblox:mesh', async (_e, meshIdOrUrl) => {
  const id = normalizeAssetId(meshIdOrUrl);
  if (!id) throw new Error('Bad mesh id: ' + meshIdOrUrl);
  if (meshMemCache.has(id)) return meshMemCache.get(id);
  const diskPath = path.join(cacheDir('mesh'), `${id}.json`);
  let result;
  if (fs.existsSync(diskPath)) {
    result = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
  } else {
    const buf = await robloxFetch(assetUrl(id));
    const geo = parseMesh(buf);
    result = {
      positions: Array.from(geo.positions),
      normals: Array.from(geo.normals),
      uvs: Array.from(geo.uvs),
      indices: Array.from(geo.indices),
    };
    try { fs.writeFileSync(diskPath, JSON.stringify(result)); } catch (_) { /* disk cache best-effort only */ }
  }
  meshMemCache.set(id, result);
  return result;
});

ipcMain.handle('roblox:texture', async (_e, texIdOrUrl) => {
  const id = normalizeAssetId(texIdOrUrl);
  if (!id) throw new Error('Bad texture id: ' + texIdOrUrl);
  const diskPath = path.join(cacheDir('tex'), `${id}.bin`);
  let buf;
  if (fs.existsSync(diskPath)) buf = fs.readFileSync(diskPath);
  else {
    buf = await robloxFetch(assetUrl(id));
    try { fs.writeFileSync(diskPath, buf); } catch (_) { /* disk cache best-effort only */ }
  }
  const mime = buf[0] === 0x89 ? 'image/png' : (buf[0] === 0xff ? 'image/jpeg' : 'application/octet-stream');
  return `data:${mime};base64,${buf.toString('base64')}`;
});

ipcMain.handle('roblox:userId', async (_e, username) => {
  const res = await fetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
  });
  const json = await res.json();
  const hit = json.data && json.data[0];
  if (!hit) throw new Error(`No Roblox user named "${username}"`);
  return { id: hit.id, name: hit.name, displayName: hit.displayName };
});

// Classic smiley face from the local Roblox Studio install (for R6 heads)
ipcMain.handle('roblox:classicFace', () => {
  try {
    const versionsDirs = [
      path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'Versions'),
      'C:/Program Files (x86)/Roblox/Versions',
      'C:/Program Files/Roblox/Versions',
    ];
    for (const vd of versionsDirs) {
      if (!fs.existsSync(vd)) continue;
      for (const v of fs.readdirSync(vd)) {
        const facePath = path.join(vd, v, 'content', 'textures', 'face.png');
        if (fs.existsSync(facePath)) {
          return 'data:image/png;base64,' + fs.readFileSync(facePath).toString('base64');
        }
      }
    }
  } catch (_) { }
  return null;
});

// Reads a user-picked local image file (for custom face layers) as a data URI — no Roblox
// asset/upload involved, so this works fully offline and needs no authenticated session.
ipcMain.handle('image:readAsDataUri', (_e, p) => {
  const buf = fs.readFileSync(p);
  const ext = path.extname(p).toLowerCase();
  const mime = ext === '.png' ? 'image/png'
    : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg'
    : ext === '.webp' ? 'image/webp'
    : buf[0] === 0x89 ? 'image/png' : (buf[0] === 0xff ? 'image/jpeg' : 'application/octet-stream');
  return `data:${mime};base64,${buf.toString('base64')}`;
});

// ---------------------------------------------------------------- IPC: rbxm parsing
ipcMain.handle('rbx:parseBuffer', (_e, arrayBuffer, filename) => {
  const buf = Buffer.from(arrayBuffer);
  const head = buf.toString('utf8', 0, Math.min(200, buf.length));
  if (head.startsWith('<roblox!')) {
    const tree = parseRbxBin(buf);
    return { kind: 'binary', roots: stripRefs(tree.roots) };
  }
  if (head.includes('<roblox')) {
    return { kind: 'xml', text: buf.toString('utf8') };
  }
  throw new Error(`"${filename}" is not a Roblox model file (.rbxm / .rbxmx)`);
});

// Referent-object props confuse structured clone consumers; resolve part refs into path strings
function stripRefs(roots) {
  const byRef = new Map();
  const walk = (node) => {
    if (node.referent !== undefined) byRef.set(node.referent, node);
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  const resolve = (node) => {
    for (const [k, v] of Object.entries(node.props)) {
      if (v && typeof v === 'object' && v.__ref !== undefined) {
        const target = byRef.get(v.__ref);
        node.props[k] = target ? { refName: target.name, refId: v.__ref } : null;
      }
    }
    // Keep this node's own referent (as a prop, so it survives IPC) so the renderer can resolve
    // Part0/Part1 refs by true instance identity instead of falling back to name matching — two
    // parts sharing a name (e.g. duplicate default "Part"s) would otherwise wire a Motor6D/Weld
    // to the wrong instance.
    if (node.referent !== undefined) node.props.__binref = node.referent;
    delete node.referent;
    node.children.forEach(resolve);
  };
  roots.forEach((r) => { walk(r); });
  roots.forEach(resolve);
  return roots;
}

// ---------------------------------------------------------------- Studio bridge server
// The companion Studio plugin long-polls GET /poll and pushes results/events back.
// POLL_HOLD_MS is how long an empty /poll is held open server-side before responding with
// nothing (the plugin immediately re-polls after that). DISCONNECT_TIMEOUT_MS is how long with
// NO request at all before we call it dropped — it MUST stay comfortably larger than
// POLL_HOLD_MS, or a perfectly healthy connection reads as repeatedly disconnecting/reconnecting
// right around every hold timeout (this was a real bug: 8s timeout vs a 15s hold flapped the
// status every ~15s even with nothing wrong — confirmed live by sampling /status against a real
// poll loop before this fix, and again after).
const POLL_HOLD_MS = 15000;
const DISCONNECT_TIMEOUT_MS = 30000;
const bridge = {
  connected: false,
  placeName: null,
  lastSeen: 0,
  bindError: null,   // set if the bridge server failed to start (e.g. port already in use)
  queue: [],          // pending commands for the plugin
  pending: new Map(), // commandId -> {resolve, reject, timer}
  waiters: [],        // held /poll responses
  nextId: 1,
};

function bridgeNotifyRenderer() {
  safeSend('bridge:status', {
    connected: bridge.connected,
    placeName: bridge.placeName,
    port: BRIDGE_PORT,
    lastSeen: bridge.lastSeen,
    bindError: bridge.bindError,
  });
}

setInterval(() => {
  if (bridge.connected && Date.now() - bridge.lastSeen > DISCONNECT_TIMEOUT_MS) {
    bridge.connected = false;
    bridge.placeName = null;
    bridgeNotifyRenderer();
  }
}, 2000);

function flushQueueToWaiter() {
  while (bridge.waiters.length && bridge.queue.length) {
    const res = bridge.waiters.shift();
    const commands = bridge.queue.splice(0, bridge.queue.length);
    try {
      clearTimeout(res.__timer);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ commands }));
    } catch (_) { }
  }
}

function startBridgeServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${BRIDGE_PORT}`);
    if (req.method === 'GET' && url.pathname === '/poll') {
      bridge.lastSeen = Date.now();
      if (!bridge.connected) {
        bridge.connected = true;
        bridgeNotifyRenderer();
      }
      if (bridge.queue.length) {
        const commands = bridge.queue.splice(0, bridge.queue.length);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ commands }));
      } else {
        // hold up to POLL_HOLD_MS (plugin uses a 30s HttpService timeout, so this must stay under that)
        bridge.waiters.push(res);
        res.__timer = setTimeout(() => {
          const i = bridge.waiters.indexOf(res);
          if (i >= 0) bridge.waiters.splice(i, 1);
          try {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ commands: [] }));
          } catch (_) { }
        }, POLL_HOLD_MS);
        req.on('close', () => {
          clearTimeout(res.__timer);
          const i = bridge.waiters.indexOf(res);
          if (i >= 0) bridge.waiters.splice(i, 1);
        });
      }
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let json = {};
        try { json = JSON.parse(body || '{}'); } catch (_) { }
        bridge.lastSeen = Date.now();

        if (url.pathname === '/hello') {
          bridge.connected = true;
          bridge.placeName = json.placeName || 'Roblox Studio';
          bridgeNotifyRenderer();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, app: 'CadenceAnimator' }));
          return;
        }
        if (url.pathname === '/result') {
          const p = bridge.pending.get(json.id);
          if (p) {
            bridge.pending.delete(json.id);
            clearTimeout(p.timer);
            if (json.ok) p.resolve(json.data);
            else p.reject(new Error(json.error || 'Studio plugin reported an error'));
          }
          res.writeHead(200); res.end('{}');
          return;
        }
        if (url.pathname === '/event') {
          safeSend('bridge:event', json);
          res.writeHead(200); res.end('{}');
          return;
        }
        res.writeHead(404); res.end();
      });
      return;
    }

    if (url.pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ app: 'CadenceAnimator', connected: bridge.connected, placeName: bridge.placeName, port: BRIDGE_PORT }));
      return;
    }
    res.writeHead(404); res.end();
  });
  server.on('error', (e) => {
    // Most commonly EADDRINUSE — another Cadence Animator window already owns this port, so
    // Studio can only ever talk to that one. Previously this just logged to a console the user
    // can't see in a packaged build, so the bridge chip looked "stuck offline" with no reason why.
    console.error('Bridge server error:', e.message);
    bridge.bindError = e.code === 'EADDRINUSE'
      ? `Port ${BRIDGE_PORT} is already in use — another Cadence Animator window is probably already running and connected to Studio.`
      : `Could not start the Studio bridge server: ${e.message}`;
    bridgeNotifyRenderer();
  });
  server.listen(BRIDGE_PORT, '127.0.0.1');
}

ipcMain.handle('bridge:status', () => ({
  connected: bridge.connected,
  placeName: bridge.placeName,
  port: BRIDGE_PORT,
  lastSeen: bridge.lastSeen,
  bindError: bridge.bindError,
}));
ipcMain.handle('bridge:send', (_e, type, payload, timeoutMs = 60000) => {
  return new Promise((resolve, reject) => {
    if (!bridge.connected) {
      reject(new Error('Roblox Studio is not connected. Open Studio with the Cadence Bridge plugin installed.'));
      return;
    }
    const id = bridge.nextId++;
    const timer = setTimeout(() => {
      bridge.pending.delete(id);
      reject(new Error(`Studio did not answer "${type}" in time`));
    }, timeoutMs);
    bridge.pending.set(id, { resolve, reject, timer });
    bridge.queue.push({ id, type, payload });
    flushQueueToWaiter();
  });
});

// ---------------------------------------------------------------- MCP control server
// A separate, simpler channel than the Roblox bridge above: this is for the MCP server
// (a sibling Node process spawned by Claude) to drive the app directly — add rigs, set exact
// keyframe values, scrub to a frame and get a screenshot back, and run quality checks —
// rather than a human manually clicking around. Both ends are part of the same app, so this
// is a direct push+response over IPC instead of the Studio bridge's long-poll queue.
const mcpPending = new Map(); // id -> {resolve, reject, timer}
let mcpNextId = 1;
let mcpBindError = null; // set if the MCP control server failed to start (e.g. port already in use)

function sendToRenderer(type, payload, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) {
      reject(new Error('App window is not ready'));
      return;
    }
    const id = mcpNextId++;
    const timer = setTimeout(() => {
      mcpPending.delete(id);
      reject(new Error(`Renderer did not answer "${type}" in time`));
    }, timeoutMs);
    mcpPending.set(id, { resolve, reject, timer });
    win.webContents.send('mcp:command', { id, type, payload });
  });
}

ipcMain.on('mcp:response', (_e, { id, ok, data, error }) => {
  const p = mcpPending.get(id);
  if (!p) return;
  mcpPending.delete(id);
  clearTimeout(p.timer);
  if (ok) p.resolve(data);
  else p.reject(new Error(error || 'Unknown renderer error'));
});

async function handleMcpCommand(type, payload) {
  if (type === 'render_frame') {
    await sendToRenderer('scrub_to_frame', { frame: payload.frame });
    await new Promise((r) => setTimeout(r, 140)); // let three.js actually paint the new pose
    const img = await win.webContents.capturePage();
    return { frame: payload.frame, image: img.toPNG().toString('base64'), mimeType: 'image/png' };
  }
  return sendToRenderer(type, payload);
}

function startMcpServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${MCP_PORT}`);
    if (req.method === 'GET' && url.pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ app: 'CadenceAnimator', ready: !!(win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/call') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        let json = {};
        try { json = JSON.parse(body || '{}'); } catch (_) { }
        try {
          const data = await handleMcpCommand(json.type, json.payload || {});
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, data }));
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  server.on('error', (e) => {
    // Previously just console.error'd — invisible in a packaged build, so "Claude builds but
    // the app never reacts" had no visible cause at all. Most commonly EADDRINUSE: another
    // Cadence process (a leftover from before the single-instance lock above, or a genuine
    // zombie left behind by a crash) already owns this port and answers Claude's calls instead —
    // against whatever window IT has, not the one actually on screen.
    console.error('MCP server error:', e.message);
    mcpBindError = e.code === 'EADDRINUSE'
      ? `Port ${MCP_PORT} is already in use — another Cadence Animator process is running and is the one actually talking to Claude. Close it (Task Manager, if closing the window alone doesn't) and reopen this app.`
      : `Could not start the Claude control server: ${e.message}`;
  });
  server.listen(MCP_PORT, '127.0.0.1');
}

ipcMain.handle('mcp:bindStatus', () => ({ error: mcpBindError }));
