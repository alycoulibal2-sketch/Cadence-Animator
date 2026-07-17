'use strict';
// Local HTTP+WS server backing the mobile companion viewer/remote. Loopback-only by itself —
// internet reachability comes from mobileTunnel.js pointing a Cloudflare Quick Tunnel at this
// port, this file has no idea whether a tunnel is in front of it or not.
//
// Serves two things over one plain http.Server (kept consistent with main.js's existing
// no-framework style — this app has no express anywhere):
//   1. Static files: the mobile-specific page (renderer-mobile/) plus the *same* renderer/js
//      modules (state.js, cf.js, rigbuild.js, viewport.js) the desktop app already uses, so the
//      phone renders with the real three.js viewport instead of a second re-implementation or a
//      screenshot stream. Only three subtrees are exposed (see SHARED_ROOTS) — never the whole
//      app source.
//   2. A WebSocket channel (one connection per phone) carrying: state broadcasts (desktop -> all
//      phones, whenever the project changes) and a small allowlisted command surface (phone ->
//      desktop, forwarded into the same sendToRenderer()/mcp:command pipe Claude's MCP tools
//      already use — so "small edits" from a phone get undo + autosave for free).
//
// Auth: a random per-session token, required only on the WS connection (never on plain static
// GETs, which carry no project data) — see mobilePanel.js/app.js for how the token is embedded
// in the QR code as a URL *fragment* (never sent to any server or logged) rather than a query
// string.
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');
const { app } = require('electron');
const { WebSocketServer } = require('ws');

const MOBILE_PORT = 35749;

// Read-only, and only this list — nothing else under the app root is ever served. Each entry is
// checked with a real path-resolution containment check below, not just a string prefix match,
// so a crafted "../" can't escape it.
const SHARED_ROOTS = [
  { urlPrefix: '/shared/renderer/js/', diskDir: () => path.join(app.getAppPath(), 'renderer', 'js') },
  { urlPrefix: '/shared/renderer/vendor/', diskDir: () => path.join(app.getAppPath(), 'renderer', 'vendor') },
  { urlPrefix: '/shared/node_modules/three/', diskDir: () => path.join(app.getAppPath(), 'node_modules', 'three') },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Only these MCP command types are reachable from a phone — everything else (add_rig,
// remove_item, export_to_studio, save_project, attach/detach, bulk frame ops, face presets,
// etc.) is rejected here before it ever reaches sendToRenderer. This is the actual enforcement
// point for "can view + scrub + make small edits, can't really animate."
const READ_COMMANDS = new Set(['get_state', 'list_items', 'get_track', 'get_pose', 'get_facing', 'validate_animation', 'select']);
const EDIT_COMMANDS = new Set(['scrub_to_frame', 'set_keyframe', 'delete_keyframes', 'set_easing', 'undo', 'redo']);
const ALLOWED_COMMANDS = new Set([...READ_COMMANDS, ...EDIT_COMMANDS]);

function resolveWithin(baseDir, urlRest) {
  const resolved = path.normalize(path.join(baseDir, urlRest));
  const baseWithSep = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
  if (resolved !== baseDir && !resolved.startsWith(baseWithSep)) return null; // traversal attempt
  return resolved;
}

function acceptsGzip(req) {
  return (req.headers['accept-encoding'] || '').includes('gzip');
}

// Everything served here (the shared renderer modules, three.js, the mobile page itself) is
// plain text/JS/JSON — compresses very well, and this app was shipping it completely
// uncompressed and with `Cache-Control: no-cache` (a full ~1.5MB re-download, three.js alone
// being 1.3MB uncompressed, on *every single page load*). Over a phone on cellular through a
// free Cloudflare quick tunnel that's plausibly the entire "takes forever to load" experience.
// Compress once per file (cached by mtime) and reuse the compressed bytes for every request.
const gzipCache = new Map(); // filePath -> { mtimeMs, buf, gz }

function sendFile(req, res, filePath) {
  fs.stat(filePath, (statErr, st) => {
    if (statErr) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    const cached = gzipCache.get(filePath);
    if (cached && cached.mtimeMs === st.mtimeMs) {
      sendWithEncoding(req, res, contentType, cached);
      return;
    }
    fs.readFile(filePath, (err, buf) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const entry = { mtimeMs: st.mtimeMs, buf, gz: zlib.gzipSync(buf) };
      gzipCache.set(filePath, entry);
      sendWithEncoding(req, res, contentType, entry);
    });
  });
}

function sendWithEncoding(req, res, contentType, entry) {
  // These files only change if the app itself is rebuilt/restarted — and a restart always gets
  // a brand-new tunnel origin anyway (see mobileTunnel.js), so there's no stale-cache-across-an-
  // update risk in caching them aggressively for the life of one session.
  const headers = { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' };
  if (acceptsGzip(req)) {
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
    res.end(entry.gz);
  } else {
    res.writeHead(200, headers);
    res.end(entry.buf);
  }
}

function sendJson(req, res, status, obj, cacheable = false) {
  const body = Buffer.from(JSON.stringify(obj));
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  // Roblox mesh/texture content for a given asset id never changes — safe to cache hard, unlike
  // the default (uncacheable) case used for command results/errors.
  if (cacheable) headers['Cache-Control'] = 'public, max-age=86400';
  if (acceptsGzip(req) && body.length > 512) {
    res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip' });
    res.end(zlib.gzipSync(body));
  } else {
    res.writeHead(status, headers);
    res.end(body);
  }
}

// deps: { sendToRenderer(type, payload, timeoutMs) -> Promise, robloxAssets, notifyClientConnected }
function createMobileServer({ sendToRenderer, robloxAssets, notifyClientConnected }) {
  let httpServer = null;
  let wss = null;
  let token = null;
  let editingAllowed = true; // "view only" vs "allow small edits" toggle, set from the desktop modal
  const clients = new Set(); // connected phone WebSockets
  let bindError = null;

  function status() {
    return {
      running: !!httpServer,
      port: MOBILE_PORT,
      token,
      editingAllowed,
      connectedCount: clients.size,
      bindError,
    };
  }

  function setEditingAllowed(v) {
    editingAllowed = !!v;
  }

  // Called by the renderer whenever project/tracks/items/selection/playhead changes (throttled
  // renderer-side — see app.js's S.on('any'/'playhead', ...) hook). Fanned out to every
  // connected phone as-is; full-snapshot-per-update, not a diff — simplest thing that works,
  // revisit only if bandwidth is ever actually a problem (see plan). editingAllowed is stamped
  // in here (not known renderer-side) so phones can gray out edit controls proactively instead
  // of only finding out when a command bounces.
  function broadcastState(payload) {
    if (!clients.size) return;
    const msg = JSON.stringify({ kind: 'state', payload: { ...payload, editingAllowed } });
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  }

  async function handleApi(req, res, url) {
    // Roblox asset proxy: mirrors the shape of the existing roblox:mesh/roblox:texture IPC
    // handlers exactly, just reachable over HTTP for a browser tab instead of Electron IPC.
    const meshMatch = url.pathname.match(/^\/api\/mesh\/([^/]+)$/);
    const texMatch = url.pathname.match(/^\/api\/texture\/([^/]+)$/);
    if (meshMatch) {
      try { sendJson(req, res, 200, await robloxAssets.fetchMeshData(decodeURIComponent(meshMatch[1])), true); }
      catch (e) { sendJson(req, res, 502, { error: e.message }); }
      return true;
    }
    if (texMatch) {
      try {
        const dataUri = await robloxAssets.fetchTextureDataUri(decodeURIComponent(texMatch[1]));
        sendJson(req, res, 200, { dataUri }, true);
      } catch (e) { sendJson(req, res, 502, { error: e.message }); }
      return true;
    }
    if (url.pathname === '/api/classicFace') {
      sendJson(req, res, 200, { dataUri: robloxAssets.getClassicFaceDataUri() }, true);
      return true;
    }
    return false;
  }

  function handleStatic(req, res, url) {
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }

    for (const root of SHARED_ROOTS) {
      if (url.pathname.startsWith(root.urlPrefix)) {
        const rest = url.pathname.slice(root.urlPrefix.length);
        const filePath = resolveWithin(root.diskDir(), rest);
        if (!filePath) { res.writeHead(400); res.end(); return; }
        sendFile(req, res, filePath);
        return;
      }
    }

    // Everything else maps 1:1 onto renderer-mobile/ — "/" -> index.html, "/js/x.js" -> js/x.js.
    const mobileRoot = path.join(app.getAppPath(), 'renderer-mobile');
    const rest = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const filePath = resolveWithin(mobileRoot, rest);
    if (!filePath) { res.writeHead(400); res.end(); return; }
    sendFile(req, res, filePath);
  }

  function handleWsMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    const { id, type, payload } = msg;
    if (!ALLOWED_COMMANDS.has(type)) {
      ws.send(JSON.stringify({ kind: 'result', id, ok: false, error: `Command "${type}" is not available from a phone.` }));
      return;
    }
    if (EDIT_COMMANDS.has(type) && type !== 'scrub_to_frame' && !editingAllowed) {
      ws.send(JSON.stringify({ kind: 'result', id, ok: false, error: 'Edits from the phone are currently turned off (view-only mode).' }));
      return;
    }
    sendToRenderer(type, payload || {})
      .then((data) => ws.send(JSON.stringify({ kind: 'result', id, ok: true, data })))
      .catch((e) => ws.send(JSON.stringify({ kind: 'result', id, ok: false, error: e.message })));
  }

  // Returns a Promise so the caller (main.js's mobile:enable handler) knows for certain whether
  // the port actually bound before it goes on to point a tunnel at it — unlike the older
  // bridge/MCP servers (which bind once at app startup and surface bind errors asynchronously
  // later), this one is started on-demand from a user click and can afford to wait properly.
  function start() {
    if (httpServer) return Promise.resolve(status());
    token = crypto.randomBytes(24).toString('base64url');
    bindError = null;

    httpServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${MOBILE_PORT}`);
      handleApi(req, res, url).then((handled) => {
        if (!handled) handleStatic(req, res, url);
      });
    });

    wss = new WebSocketServer({ noServer: true });
    httpServer.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, `http://127.0.0.1:${MOBILE_PORT}`);
      if (url.pathname !== '/ws' || url.searchParams.get('token') !== token) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        clients.add(ws);
        ws.on('message', (raw) => handleWsMessage(ws, raw));
        ws.on('close', () => clients.delete(ws));
        // Ask the renderer for a fresh full snapshot right away — otherwise a phone connecting
        // while the desktop is sitting idle (nothing changing, so nothing would otherwise ever
        // broadcast) would see a blank viewer until the next real edit happens.
        notifyClientConnected?.();
      });
    });

    return new Promise((resolve) => {
      let settled = false;
      httpServer.on('error', (e) => {
        console.error('Mobile server error:', e.message);
        bindError = e.code === 'EADDRINUSE'
          ? `Port ${MOBILE_PORT} is already in use — another Cadence Animator process is probably already running.`
          : `Could not start the mobile server: ${e.message}`;
        if (!settled) { settled = true; resolve(status()); }
      });
      httpServer.once('listening', () => {
        if (!settled) { settled = true; resolve(status()); }
      });
      httpServer.listen(MOBILE_PORT, '127.0.0.1');
    });
  }

  function stop() {
    for (const ws of clients) { try { ws.close(); } catch (_) { } }
    clients.clear();
    if (wss) { wss.close(); wss = null; }
    if (httpServer) { httpServer.close(); httpServer = null; }
    token = null;
  }

  return { start, stop, status, broadcastState, setEditingAllowed, MOBILE_PORT };
}

module.exports = { createMobileServer, MOBILE_PORT };
