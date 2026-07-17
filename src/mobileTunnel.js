'use strict';
// Thin wrapper around the `cloudflared` npm package (JacobLinCool/node-cloudflared) — spawns a
// Cloudflare "quick tunnel" (cloudflared tunnel --url ...), no Cloudflare account or signup
// needed, resolving a random https://*.trycloudflare.com URL that proxies to our local mobile
// server. This is what makes "works from anywhere" possible without port-forwarding or hosting
// a relay ourselves. Trade-off (surfaced in the UI, not hidden): the URL is different every time
// a tunnel is started, so the phone re-pairs (rescans the QR) after a desktop restart.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// The `cloudflared` package computes its own binary path via `path.join(__dirname, '..', 'bin',
// ...)` relative to its OWN module location. In a packaged build that resolves to somewhere
// inside app.asar (e.g. `resources\app.asar\node_modules\cloudflared\bin\cloudflared.exe`) — a
// path that isn't a real file on disk, since asar is a single packed archive, not a directory.
// Electron's patched `fs` module transparently reads through to the `app.asar.unpacked` sibling
// for file *reads*, but `child_process.spawn()` (used to actually launch the exe) needs a real
// path and gets `ENOENT` — this shipped broken in 0.2.13/0.2.14 for exactly this reason (confirmed:
// `resources/app.asar.unpacked/node_modules/cloudflared/bin/cloudflared.exe` genuinely exists in
// the packaged build; only the *default path the library computes* is wrong). Same root cause as
// `buildMcpCommand()` in main.js needing `app.getAppPath() + '.unpacked'` for the MCP server path.
// Must happen *before* requiring 'cloudflared' — its bin path is computed once at module load
// from `process.env.CLOUDFLARED_BIN`.
if (app.isPackaged) {
  process.env.CLOUDFLARED_BIN = path.join(
    app.getAppPath() + '.unpacked', 'node_modules', 'cloudflared', 'bin',
    process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared',
  );
}

const { bin, install, Tunnel } = require('cloudflared');

const START_TIMEOUT_MS = 20000;

function createMobileTunnel() {
  let tunnel = null;
  let publicUrl = null;
  let lastError = null;

  async function ensureBinary() {
    if (fs.existsSync(bin)) return;
    await install(bin);
  }

  function start(localPort) {
    if (tunnel) return Promise.resolve({ url: publicUrl, error: null });
    lastError = null;
    return ensureBinary()
      .catch((e) => { throw new Error(`Could not install cloudflared: ${e.message}`); })
      .then(() => new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        };
        const timer = setTimeout(() => {
          finish({ url: null, error: 'Timed out waiting for the Cloudflare tunnel to start.' });
        }, START_TIMEOUT_MS);

        const t = Tunnel.quick(`http://127.0.0.1:${localPort}`);
        tunnel = t;
        t.on('url', (url) => {
          publicUrl = url;
          finish({ url, error: null });
        });
        t.on('error', (err) => {
          lastError = err.message;
          finish({ url: null, error: err.message });
        });
        t.on('exit', (code) => {
          publicUrl = null;
          tunnel = null;
          finish({ url: null, error: `cloudflared exited (code ${code}) before a URL was assigned.` });
        });
      }))
      .catch((e) => {
        tunnel = null;
        lastError = e.message;
        return { url: null, error: e.message };
      });
  }

  function stop() {
    if (tunnel) { try { tunnel.stop(); } catch (_) { /* already gone */ } }
    tunnel = null;
    publicUrl = null;
  }

  function status() {
    return { running: !!tunnel, url: publicUrl, error: lastError };
  }

  return { start, stop, status };
}

module.exports = { createMobileTunnel };
