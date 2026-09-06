// Cadence Animator Pro — the licence service.
//
// Three GET endpoints, no database, no dependencies beyond Node 18+:
//
//   /stats                      { founding: { sold, limit } }        the founding counter on the site
//   /license?session_id=cs_…    { key, email }                       the thanks page, after Stripe Checkout
//   /verify?email=&key=         { valid, tier, since, checked }      the account page and the desktop app
//
// A key is HMAC-SHA256(LICENSE_SECRET, normalised email), rendered as 20 base-32 characters in groups
// of four. There is nothing to store: a key is valid exactly when it is the HMAC of its email, and it
// is only ever ISSUED after Stripe confirms the Checkout Session it came from was paid on one of our
// payment links. Verification re-checks Stripe for a paid, unrefunded session under that email so a
// refunded purchase stops verifying; if Stripe is unreachable the HMAC alone answers and `checked`
// says "offline" so the caller knows what it got.
//
// Every response is JSON. Nothing personal is logged — request lines carry the path only.

'use strict';
const http = require('http');
const crypto = require('crypto');

const env = (k, d = '') => (process.env[k] === undefined ? d : process.env[k]);
const PORT = Number(env('PORT', 8787));
const STRIPE_KEY = env('STRIPE_SECRET_KEY');
const SECRET = env('LICENSE_SECRET');
const FOUNDING_LINK = env('FOUNDING_PAYMENT_LINK');   // plink_… for the founding price
const PRO_LINK = env('PRO_PAYMENT_LINK');             // plink_… for the regular price
const FOUNDING_LIMIT = Math.max(1, Number(env('FOUNDING_LIMIT', 100)) || 100);
const ORIGINS = env('ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean);

if (!SECRET || SECRET.length < 16) { console.error('LICENSE_SECRET (16+ chars) is required'); process.exit(1); }
// Without the Stripe key the service still starts (so a deploy is green and /health answers) but
// says plainly that it is not connected: /stats hides the counter, /license and /verify answer 503.
const CONFIGURED = !!STRIPE_KEY && !!(FOUNDING_LINK || PRO_LINK);
if (!STRIPE_KEY) console.warn('STRIPE_SECRET_KEY is not set: running UNCONFIGURED — /license and /verify answer 503 until it is');
if (!FOUNDING_LINK && !PRO_LINK) console.warn('No payment link ids set: /license will refuse every session');
const NOT_READY = { error: 'The licence service is not connected to Stripe yet. Keep your receipt and this page; write to support if a key does not arrive.', configured: false };

// ---------------------------------------------------------------- keys
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols, no 0/O/1/I
function normaliseEmail(email) { return String(email || '').trim().toLowerCase(); }
function normaliseKey(key) { return String(key || '').toUpperCase().replace(/[^A-Z2-9]/g, ''); }
function keyFor(email) {
  const mac = crypto.createHmac('sha256', SECRET).update(normaliseEmail(email)).digest();
  let bits = 0, val = 0, out = '';
  for (const b of mac) {
    val = ((val << 8) | b) >>> 0; bits += 8;
    while (bits >= 5 && out.length < 20) { out += ALPHABET[(val >>> (bits - 5)) & 31]; bits -= 5; }
    if (out.length >= 20) break;
  }
  return out.match(/.{4}/g).join('-');
}
function keyMatches(email, key) {
  const a = Buffer.from(normaliseKey(keyFor(email))), b = Buffer.from(normaliseKey(key));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- Stripe (raw REST, no SDK)
async function stripeGet(path, params = {}) {
  const url = new URL('https://api.stripe.com' + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${STRIPE_KEY}` }, signal: ctrl.signal });
    const j = await r.json();
    if (!r.ok) { const e = new Error(j?.error?.message || `Stripe ${r.status}`); e.status = r.status; throw e; }
    return j;
  } finally { clearTimeout(t); }
}
const ourLinks = () => [FOUNDING_LINK, PRO_LINK].filter(Boolean);
const isOurs = (session) => !!session && session.payment_status === 'paid' && ourLinks().includes(session.payment_link);

// A session is "good" when paid on one of our links and its charge has not been refunded.
async function sessionIsGood(session) {
  if (!isOurs(session)) return false;
  if (!session.payment_intent) return true;
  try {
    const pi = await stripeGet(`/v1/payment_intents/${session.payment_intent}`, { 'expand[]': 'latest_charge' });
    const ch = pi.latest_charge;
    if (ch && typeof ch === 'object' && (ch.refunded || (ch.amount_refunded || 0) >= (ch.amount || 1))) return false;
  } catch (_) { /* a failed refund check does not un-license a paid session */ }
  return true;
}

// ---------------------------------------------------------------- caches
const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.promise;
  const promise = fn().catch((e) => { cache.delete(key); throw e; });
  cache.set(key, { until: Date.now() + ttlMs, promise });
  return promise;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of cache) if (v.until < now) cache.delete(k); }, 60000).unref();

async function foundingSold() {
  if (!FOUNDING_LINK) return 0;
  let sold = 0, starting_after;
  for (let page = 0; page < 20; page++) {
    const r = await stripeGet('/v1/checkout/sessions', { payment_link: FOUNDING_LINK, status: 'complete', limit: 100, starting_after });
    for (const s of r.data || []) if (s.payment_status === 'paid') sold++;
    if (!r.has_more || !r.data?.length) break;
    starting_after = r.data[r.data.length - 1].id;
  }
  return sold;
}

async function paidSessionFor(email) {
  const norm = normaliseEmail(email);
  const r = await stripeGet('/v1/checkout/sessions', { 'customer_details[email]': norm, status: 'complete', limit: 20 });
  let best = null;
  for (const s of r.data || []) {
    if (!isOurs(s)) continue;
    if (!(await sessionIsGood(s))) continue;
    if (!best || s.created < best.created) best = s;
  }
  return best;
}

// ---------------------------------------------------------------- rate limiting (per IP, in memory)
const buckets = new Map();
function allow(ip) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now - b.start > 60000) { b = { start: now, n: 0 }; buckets.set(ip, b); }
  b.n++;
  return b.n <= 60;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (now - v.start > 120000) buckets.delete(k); }, 60000).unref();

// ---------------------------------------------------------------- HTTP
function send(res, status, body, origin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (origin) { headers['Access-Control-Allow-Origin'] = origin; headers.Vary = 'Origin'; headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'; headers['Access-Control-Max-Age'] = '600'; }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}
function corsOrigin(req) {
  const o = req.headers.origin;
  if (!o) return null;
  if (!ORIGINS.length) return o;               // no allow-list configured: reflect (dev only; set ALLOWED_ORIGINS in production)
  return ORIGINS.includes(o) ? o : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const origin = corsOrigin(req);
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  console.log(`${new Date().toISOString()} ${req.method} ${url.pathname}`);
  if (req.method === 'OPTIONS') { res.writeHead(origin ? 204 : 403, origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '600', Vary: 'Origin' } : {}); return res.end(); }
  if (req.method !== 'GET') return send(res, 405, { error: 'GET only' }, origin);
  if (req.headers.origin && !origin) return send(res, 403, { error: 'origin not allowed' }, null);
  if (!allow(ip)) return send(res, 429, { error: 'slow down' }, origin);
  try {
    switch (url.pathname) {
      case '/health': return send(res, 200, { ok: true, configured: CONFIGURED }, origin);
      case '/stats': case '/license': case '/verify':
        if (!CONFIGURED) return send(res, 503, NOT_READY, origin);
        break;
      default: break;
    }
    switch (url.pathname) {
      case '/stats': {
        const sold = await cached('founding', 60000, foundingSold);
        return send(res, 200, { founding: { sold: Math.min(sold, FOUNDING_LIMIT), limit: FOUNDING_LIMIT } }, origin);
      }
      case '/license': {
        const id = url.searchParams.get('session_id') || '';
        if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return send(res, 400, { error: 'session_id missing' }, origin);
        const session = await cached(`s:${id}`, 300000, () => stripeGet(`/v1/checkout/sessions/${id}`));
        if (!isOurs(session)) return send(res, 402, { error: 'This checkout is not a paid Cadence Pro purchase.' }, origin);
        const email = session.customer_details?.email || session.customer_email || '';
        if (!email) return send(res, 500, { error: 'The checkout has no email; write to support with your receipt.' }, origin);
        return send(res, 200, { key: keyFor(email), email: normaliseEmail(email) }, origin);
      }
      case '/verify': {
        const email = url.searchParams.get('email') || '', key = url.searchParams.get('key') || '';
        if (!email || !key) return send(res, 400, { error: 'email and key are required' }, origin);
        if (!keyMatches(email, key)) return send(res, 200, { valid: false }, origin);
        let checked = 'stripe', since = null;
        try {
          const s = await cached(`e:${normaliseEmail(email)}`, 600000, () => paidSessionFor(email));
          if (!s) return send(res, 200, { valid: false, reason: 'no paid purchase under this email (refunded, or a different email)', checked }, origin);
          since = new Date(s.created * 1000).toISOString().slice(0, 10);
        } catch (_) { checked = 'offline'; }
        return send(res, 200, { valid: true, tier: 'pro', since, checked }, origin);
      }
      default: return send(res, 404, { error: 'not found' }, origin);
    }
  } catch (e) {
    console.error('request failed:', e.status || '', e.message);
    return send(res, e.status === 404 ? 404 : 502, { error: e.status === 404 ? 'no such checkout session' : 'Stripe is not answering; try again in a minute' }, origin);
  }
});

server.listen(PORT, () => console.log(`cadence licence service on :${PORT} (founding limit ${FOUNDING_LIMIT}, origins ${ORIGINS.length ? ORIGINS.join(' ') : 'ANY — set ALLOWED_ORIGINS'})`));

module.exports = { keyFor, keyMatches, normaliseEmail, normaliseKey };
