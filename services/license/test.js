// Tests for the licence service: the key maths, and the three endpoints against a fake Stripe.
// Run: node test.js   (no network — global fetch is replaced before the server loads)
'use strict';
const assert = require('node:assert/strict');

process.env.LICENSE_SECRET = 'test-secret-for-the-suite-only';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.FOUNDING_PAYMENT_LINK = 'plink_founding';
process.env.PRO_PAYMENT_LINK = 'plink_pro';
process.env.FOUNDING_LIMIT = '100';
process.env.ALLOWED_ORIGINS = 'https://example.github.io';
process.env.PORT = '8790';

// ---- a fake Stripe: two paid sessions (one refunded), one unpaid, one on someone else's link
const SESSIONS = {
  cs_paid: { id: 'cs_paid', payment_status: 'paid', payment_link: 'plink_founding', payment_intent: 'pi_ok', created: 1788681600, customer_details: { email: 'Buyer@Example.com' } },
  cs_refunded: { id: 'cs_refunded', payment_status: 'paid', payment_link: 'plink_pro', payment_intent: 'pi_refunded', created: 1757145700, customer_details: { email: 'refund@example.com' } },
  cs_unpaid: { id: 'cs_unpaid', payment_status: 'unpaid', payment_link: 'plink_pro', created: 1757145800, customer_details: { email: 'nope@example.com' } },
  cs_other: { id: 'cs_other', payment_status: 'paid', payment_link: 'plink_someone_else', created: 1757145900, customer_details: { email: 'other@example.com' } },
};
global.fetch = async (url) => {
  const u = new URL(url);
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const m = /^\/v1\/checkout\/sessions\/(cs_\w+)$/.exec(u.pathname);
  if (m) return SESSIONS[m[1]] ? json(200, SESSIONS[m[1]]) : json(404, { error: { message: 'No such checkout.session' } });
  if (u.pathname === '/v1/checkout/sessions') {
    const link = u.searchParams.get('payment_link'), email = u.searchParams.get('customer_details[email]');
    let data = Object.values(SESSIONS);
    if (link) data = data.filter((s) => s.payment_link === link);
    if (email) data = data.filter((s) => s.customer_details.email.toLowerCase() === email);
    return json(200, { data, has_more: false });
  }
  const pi = /^\/v1\/payment_intents\/(pi_\w+)$/.exec(u.pathname);
  if (pi) return json(200, { id: pi[1], latest_charge: { amount: 900, amount_refunded: pi[1] === 'pi_refunded' ? 900 : 0, refunded: pi[1] === 'pi_refunded' } });
  return json(404, { error: { message: 'unknown ' + u.pathname } });
};

const S = require('./server.js');

(async () => {
  // keys
  const k = S.keyFor('buyer@example.com');
  assert.match(k, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/, 'a key is five groups of four unambiguous characters: ' + k);
  assert.equal(S.keyFor(' Buyer@Example.COM '), k, 'email case and spacing do not change the key');
  assert.ok(S.keyMatches('buyer@example.com', k.toLowerCase().replace(/-/g, ' ')), 'a key pasted in lower case with spaces still matches');
  assert.ok(!S.keyMatches('someone@else.com', k), 'a key does not transfer to another email');
  assert.ok(!S.keyMatches('buyer@example.com', k.slice(0, -1) + (k.endsWith('A') ? 'B' : 'A')), 'one wrong character fails');

  const base = 'http://127.0.0.1:8790';
  const get = async (path, headers = {}) => { const r = await realFetch(base + path, { headers }); return { status: r.status, body: await r.json(), headers: r.headers }; };
  await new Promise((r) => setTimeout(r, 150));

  // stats
  let r = await get('/stats');
  assert.equal(r.status, 200); assert.deepEqual(r.body, { founding: { sold: 1, limit: 100 } });

  // license issue
  r = await get('/license?session_id=cs_paid');
  assert.equal(r.status, 200); assert.equal(r.body.email, 'buyer@example.com'); assert.equal(r.body.key, k);
  r = await get('/license?session_id=cs_unpaid'); assert.equal(r.status, 402);
  r = await get('/license?session_id=cs_other'); assert.equal(r.status, 402, 'a session on a foreign payment link is refused');
  r = await get('/license?session_id=cs_missing'); assert.equal(r.status, 404);
  r = await get('/license?session_id=%3Cscript%3E'); assert.equal(r.status, 400);

  // verify
  r = await get(`/verify?email=buyer@example.com&key=${k}`);
  assert.equal(r.status, 200); assert.equal(r.body.valid, true); assert.equal(r.body.tier, 'pro'); assert.equal(r.body.since, '2026-09-06'); assert.equal(r.body.checked, 'stripe');
  r = await get(`/verify?email=buyer@example.com&key=AAAA-AAAA-AAAA-AAAA-AAAA`); assert.equal(r.body.valid, false);
  const rk = S.keyFor('refund@example.com');
  r = await get(`/verify?email=refund@example.com&key=${rk}`);
  assert.equal(r.body.valid, false, 'a refunded purchase no longer verifies'); assert.match(r.body.reason, /refunded/);

  // CORS
  r = await get('/stats', { Origin: 'https://example.github.io' });
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://example.github.io');
  r = await get('/stats', { Origin: 'https://evil.example' });
  assert.equal(r.status, 403, 'an unlisted origin is refused');

  console.log('licence service: all tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

// the server replaced global fetch for Stripe; keep a real one for hitting the server itself
const realFetch = (function () {
  const http = require('http');
  return (url, { headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: { get: (h) => res.headers[h.toLowerCase()] }, json: async () => JSON.parse(data || 'null') }));
    });
    req.on('error', reject);
  });
})();
