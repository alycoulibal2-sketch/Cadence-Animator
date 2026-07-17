'use strict';
// Thin wrapper around the `cloudflared` npm package (JacobLinCool/node-cloudflared) — spawns a
// Cloudflare "quick tunnel" (cloudflared tunnel --url ...), no Cloudflare account or signup
// needed, resolving a random https://*.trycloudflare.com URL that proxies to our local mobile
// server. This is what makes "works from anywhere" possible without port-forwarding or hosting
// a relay ourselves. Trade-off (surfaced in the UI, not hidden): the URL is different every time
// a tunnel is started, so the phone re-pairs (rescans the QR) after a desktop restart.
const fs = require('fs');
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
