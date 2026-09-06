// Cadence Pro — the licence, held in the main process.
//
// A key is issued by services/license after a paid Stripe checkout and is the HMAC of the buyer's
// email; the app never derives keys, it only asks the licence service whether a pair is valid. What
// is stored (settings.json → pro): the email, the key, when it last verified, and what the server
// said. Re-verification happens quietly on launch when the last check is older than REVERIFY_DAYS;
// if the network is down the licence stays active for OFFLINE_GRACE_DAYS after the last good check,
// then lapses until a check succeeds. Nothing here phones home otherwise.
//
// Honesty: Cadence Animator is MIT-licensed; this gate lives in the shipped build's export path and
// anyone building from source can remove it. Pro is "pay the maker for the finished thing".

'use strict';

// Set when the licence service is deployed (services/license/README.md step 4). Empty = Pro is not
// open yet: the dialog says so and activation is refused with that reason. Can be overridden per
// machine through settings.json → pro.api (used by tests and by anyone self-hosting the service).
const DEFAULT_LICENSE_API = '';
const REVERIFY_DAYS = 7;
const OFFLINE_GRACE_DAYS = 30;
const TIMEOUT_MS = 20000;

const DAY = 86400000;
const normEmail = (e) => String(e || '').trim().toLowerCase();
const normKey = (k) => String(k || '').toUpperCase().replace(/[^A-Z2-9]/g, '').replace(/(.{4})(?=.)/g, '$1-');

function install({ ipcMain, readSettings, writeSettings, onChange = () => {}, testMode = false }) {
  const api = () => {
    const s = readSettings();
    return String((s.pro && s.pro.api) || DEFAULT_LICENSE_API || '').replace(/\/+$/, '');
  };

  function status() {
    const s = readSettings();
    const p = s.pro || {};
    const open = !!api();
    const now = Date.now();
    let active = false, reason = null;
    if (p.key && p.email && p.verifiedAt) {
      const age = (now - p.verifiedAt) / DAY;
      if (p.valid === false) { active = false; reason = p.reason || 'The licence server said this key is no longer valid.'; }
      else if (age <= OFFLINE_GRACE_DAYS) active = true;
      else { active = false; reason = `This key was last verified ${Math.floor(age)} days ago and the licence server could not be reached since. Connect once and open the Pro dialog to re-verify.`; }
    }
    return {
      open, active, reason,
      email: p.email || null,
      keyHint: p.key ? `…${p.key.slice(-4)}` : null,
      since: p.since || null,
      tier: active ? (p.tier || 'pro') : null,
      verifiedAt: p.verifiedAt || null,
      checked: p.checked || null,
      api: open ? api() : null,
    };
  }

  async function verifyRemote(email, key) {
    const base = api();
    if (!base) return { ok: false, error: 'Cadence Pro is not open yet. When it is, the download page will say so.' };
    const url = `${base}/verify?email=${encodeURIComponent(normEmail(email))}&key=${encodeURIComponent(normKey(key))}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) return { ok: false, error: j?.error || `The licence server answered ${r.status}.`, transient: r.status >= 500 };
      return { ok: true, valid: !!j.valid, tier: j.tier || 'pro', since: j.since || null, checked: j.checked || 'stripe', reason: j.reason || null };
    } catch (e) {
      const waking = /abort/i.test(String(e && e.name));
      return { ok: false, transient: true, error: waking ? 'The licence server is waking up (it sleeps when idle). Try again in half a minute.' : 'Could not reach the licence server. Check the connection and try again.' };
    } finally { clearTimeout(t); }
  }

  async function activate(email, key) {
    const e = normEmail(email), k = normKey(key);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, error: 'That does not look like an email address.' };
    if (k.replace(/-/g, '').length !== 20) return { ok: false, error: 'A key is 20 characters in five groups, like ABCD-EFGH-JKLM-NPQR-STUV.' };
    if (testMode && k === 'TEST-TEST-TEST-TEST-TEST' && e === 'smoketest@cadence.local') {
      save({ email: e, key: k, valid: true, tier: 'pro', since: '2026-09-06', checked: 'test', verifiedAt: Date.now() });
      return { ok: true, status: status() };
    }
    const r = await verifyRemote(e, k);
    if (!r.ok) return { ok: false, error: r.error, transient: !!r.transient };
    if (!r.valid) return { ok: false, error: r.reason ? `This key did not verify: ${r.reason}.` : 'This key and email do not match. Keys are tied to the email used at checkout.' };
    save({ email: e, key: k, valid: true, tier: r.tier, since: r.since, checked: r.checked, verifiedAt: Date.now(), reason: null });
    return { ok: true, status: status() };
  }

  function save(pro) {
    const s = readSettings();
    s.pro = { ...(s.pro || {}), ...pro };
    writeSettings(s);
    onChange(status());
  }

  function deactivate() {
    const s = readSettings();
    const keep = s.pro && s.pro.api ? { api: s.pro.api } : {};
    s.pro = keep;
    writeSettings(s);
    onChange(status());
    return status();
  }

  // Quiet re-verification on launch: only when due, never blocking, never nagging.
  async function reverifyIfDue() {
    const s = readSettings();
    const p = s.pro || {};
    if (!p.key || !p.email || !api()) return;
    if (p.verifiedAt && Date.now() - p.verifiedAt < REVERIFY_DAYS * DAY) return;
    const r = await verifyRemote(p.email, p.key);
    if (!r.ok) return;                     // offline: the grace period handles it
    if (r.valid) save({ valid: true, tier: r.tier, since: r.since || p.since, checked: r.checked, verifiedAt: Date.now(), reason: null });
    else save({ valid: false, reason: r.reason || 'the licence server no longer accepts this key', checked: r.checked });
  }

  ipcMain.handle('pro:status', () => status());
  ipcMain.handle('pro:activate', (_e, email, key) => activate(email, key));
  ipcMain.handle('pro:deactivate', () => deactivate());

  return { status, activate, deactivate, reverifyIfDue };
}

module.exports = { install, normKey, normEmail, DEFAULT_LICENSE_API };
