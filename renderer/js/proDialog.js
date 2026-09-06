// The Cadence Pro dialog: status, email + key entry, activation through the main process, and the
// same words everywhere it is opened from (the command palette, the VFX Studio export gate, a Pro
// node's diagnostic). Shared by both renderers, so it takes the bridge (`window.cadence` in the
// animator, `window.vfxStudio` in the VFX Studio) as a parameter rather than assuming one.

// ui.js touches `window` at import time; loading it lazily keeps this module importable from Node
// (the PNX test suite imports the studio modules that import this one).
const ui = () => import('./ui.js');

export const PRICING_URL = 'https://alycoulibal2-sketch.github.io/Cadence-Animator/#pricing';
export const ACCOUNT_URL = 'https://alycoulibal2-sketch.github.io/Cadence-Animator/account.html';

// What the key switches on, in the words the site uses. Kept in one place so the app and the site
// cannot drift apart about what Pro is.
export const PRO_UNLOCKS = [
  'The procedural simulation pack: flocking, keep apart, liquid pressure, particle events and sub-emission, fire and smoke, clouds, the volume renderer',
  'Roblox export of any procedural effect, including baked recordings and flipbook sheets',
  'The Pro badge, and priority updates',
];

const state = { status: null, bridge: null, listeners: new Set() };

export function initPro(bridge) {
  state.bridge = bridge;
  bridge.proStatus().then((s) => set(s)).catch(() => {});
  if (bridge.onProChanged) bridge.onProChanged((s) => set(s));
  return { isActive, status: () => state.status, onChange };
}

function set(s) { state.status = s; for (const fn of state.listeners) { try { fn(s); } catch (_) { /* a listener must not break the others */ } } }
export function onChange(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }
export function isActive() { return !!(state.status && state.status.active); }
export function proStatus() { return state.status; }
export async function refreshStatus() { if (!state.bridge) return null; const s = await state.bridge.proStatus(); set(s); return s; }

// The dialog's own styles, injected once per window so neither renderer's stylesheet needs editing.
function ensureStyles() {
  if (document.getElementById('pro-dialog-styles')) return;
  const st = document.createElement('style');
  st.id = 'pro-dialog-styles';
  st.textContent = `
    .pro-dialog { display: flex; flex-direction: column; gap: 10px; max-width: 460px; }
    .pro-dialog p { margin: 0; line-height: 1.45; }
    .pro-dialog .muted { opacity: 0.7; font-size: 12px; }
    .pro-dialog .pro-reason { font-weight: 600; }
    .pro-dialog .pro-active { font-weight: 600; color: var(--accent, #7c8cff); }
    .pro-dialog .pro-warn { color: #e0a060; }
    .pro-dialog ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: 13px; }
    .pro-dialog .pro-form { display: grid; gap: 8px; margin-top: 4px; }
    .pro-dialog .pro-field { display: grid; gap: 4px; font-size: 12px; opacity: 0.9; }
    .pro-dialog .pro-field input { font: inherit; font-family: ui-monospace, Consolas, monospace; letter-spacing: 0.04em; padding: 7px 9px; border-radius: 6px; border: 1px solid rgba(128,128,160,0.35); background: rgba(0,0,0,0.18); color: inherit; }
    .pro-dialog .pro-field input:focus { outline: 2px solid var(--accent, #7c8cff); outline-offset: 1px; }
    .pro-dialog .pro-msg { min-height: 1.2em; font-size: 12px; }
    .pnx-badge-pro { background: var(--accent, #7c8cff); color: #0a0a0e; font-weight: 700; }
  `;
  document.head.appendChild(st);
}

// `reason` names what the person was trying to do, so the dialog opens on why it stopped them.
export async function openProDialog({ reason = null } = {}) {
  ensureStyles();
  const { modal, toast } = await ui();
  const bridge = state.bridge;
  const body = document.createElement('div');
  body.className = 'pro-dialog';
  const st = state.status || { open: false, active: false };

  const p = (text, cls = '') => { const d = document.createElement('p'); if (cls) d.className = cls; d.textContent = text; body.appendChild(d); return d; };
  if (reason === 'export') p('Exporting a procedural effect to Roblox is a Cadence Pro feature.', 'pro-reason');
  else if (reason === 'node') p('That node is part of the Cadence Pro simulation pack.', 'pro-reason');

  if (st.active) {
    p(`Pro is active for ${st.email}${st.since ? ` (since ${st.since})` : ''}. Thank you for paying the maker.`, 'pro-active');
    p(`Key ${st.keyHint}. Last verified ${st.verifiedAt ? new Date(st.verifiedAt).toLocaleDateString() : 'now'}; it re-checks quietly every 7 days and keeps working for 30 days offline.`, 'muted');
  } else {
    const ul = document.createElement('ul');
    for (const u of PRO_UNLOCKS) { const li = document.createElement('li'); li.textContent = u; ul.appendChild(li); }
    body.appendChild(ul);
    p('One-time key: $9 for the first 100 (founding), $12 after. The core stays free and MIT; Pro adds, it never removes.', 'muted');
    if (st.reason) p(st.reason, 'pro-warn');
    if (!st.open) p('Pro is not open yet. The download page says when it is; nothing here needs a key today.', 'muted');
  }

  // entry
  const form = document.createElement('div');
  form.className = 'pro-form';
  const mk = (label, type, value, placeholder) => {
    const w = document.createElement('label'); w.className = 'pro-field';
    const t = document.createElement('span'); t.textContent = label; w.appendChild(t);
    const i = document.createElement('input'); i.type = type; i.value = value || ''; i.placeholder = placeholder; i.spellcheck = false; i.autocomplete = 'off';
    w.appendChild(i); form.appendChild(w); return i;
  };
  const email = mk('Email used at checkout', 'email', st.email || '', 'you@example.com');
  const key = mk('Licence key', 'text', '', 'ABCD-EFGH-JKLM-NPQR-STUV');
  key.addEventListener('input', () => { key.value = key.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 20).replace(/(.{4})(?=.)/g, '$1-'); });
  body.appendChild(form);
  const msg = document.createElement('p'); msg.className = 'pro-msg'; body.appendChild(msg);

  const actions = [];
  actions.push({
    label: st.active ? 'Re-verify' : 'Activate', primary: true, icon: 'check',
    run: async () => {
      msg.textContent = 'Checking with the licence server…';
      msg.className = 'pro-msg';
      const r = await bridge.proActivate(email.value, key.value || (st.active ? '' : ''));
      if (r.ok) { set(r.status); toast('Cadence Pro is active. Thank you.'); return false; }
      msg.textContent = r.error || 'Could not activate.';
      msg.className = 'pro-msg pro-warn';
      return true;   // keep the dialog open
    },
  });
  if (!st.active) actions.push({ label: st.open ? 'Get a key' : 'See the pricing page', run: () => { bridge.openExternal(PRICING_URL); return true; } });
  else actions.push({ label: 'Remove key from this PC', run: async () => { const s = await bridge.proDeactivate(); set(s); toast('Pro key removed from this PC'); return false; } });
  actions.push({ label: 'Close', run: () => false });

  return modal({ title: st.active ? 'Cadence Pro' : 'Cadence Pro — enter your key', body, actions });
}

// The one-line explanation a Pro node's diagnostic carries, so the words match the dialog.
export const PRO_NODE_MESSAGE = 'This node is part of the Cadence Pro simulation pack. Enter your key (command palette → "Cadence Pro") or build from source — the code is MIT.';
