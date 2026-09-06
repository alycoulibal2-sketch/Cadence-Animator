#!/usr/bin/env node
// Creates the Cadence Animator Pro product, its two prices and two payment links on the Stripe
// account behind STRIPE_SECRET_KEY, idempotently: a second run finds what the first made and prints
// the same ids. Nothing else is touched. --dry-run prints the plan and stops.
//
//   STRIPE_SECRET_KEY=sk_live_… SITE_URL=https://<user>.github.io/CadenceAnimator node tools/setup-stripe.mjs
//
// Prices are one-time, USD: 900 (founding, first 100 completed checkouts) and 1200 (regular). Change
// them with FOUNDING_CENTS / PRO_CENTS / FOUNDING_LIMIT. The payment links redirect the buyer to
// SITE_URL/thanks.html?session_id={CHECKOUT_SESSION_ID}, where the site calls /license.

const KEY = process.env.STRIPE_SECRET_KEY || '';
const SITE = (process.env.SITE_URL || '').replace(/\/+$/, '');
const FOUNDING_CENTS = Number(process.env.FOUNDING_CENTS || 900);
const PRO_CENTS = Number(process.env.PRO_CENTS || 1200);
const FOUNDING_LIMIT = Number(process.env.FOUNDING_LIMIT || 100);
const DRY = process.argv.includes('--dry-run');
const PRODUCT_NAME = 'Cadence Animator Pro';

if (!KEY.startsWith('sk_')) { console.error('STRIPE_SECRET_KEY must be the account secret key (sk_live_… or sk_test_…) for this one-off setup.'); process.exit(1); }
if (!SITE) { console.error('SITE_URL is required, e.g. https://<user>.github.io/CadenceAnimator'); process.exit(1); }

function form(obj, prefix = '') {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    const name = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) parts.push(form(v, name));
    else if (Array.isArray(v)) v.forEach((x, i) => parts.push(typeof x === 'object' ? form(x, `${name}[${i}]`) : `${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(x)}`));
    else parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(v)}`);
  }
  return parts.join('&');
}
async function stripe(method, path, body) {
  const r = await fetch('https://api.stripe.com' + path, {
    method, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? form(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${method} ${path}: ${j?.error?.message || r.status}`);
  return j;
}

const plan = [];
const say = (s) => { plan.push(s); console.log(s); };

(async () => {
  // product
  const found = await stripe('GET', `/v1/products/search?query=${encodeURIComponent(`name:'${PRODUCT_NAME}' AND active:'true'`)}`);
  let product = found.data?.[0];
  if (product) say(`product: found ${product.id} (${product.name})`);
  else {
    say(`product: will create "${PRODUCT_NAME}"`);
    if (!DRY) {
      product = await stripe('POST', '/v1/products', {
        name: PRODUCT_NAME,
        description: 'One-time purchase. Unlocks Roblox export of procedural (node) effects, flipbook baking of fire/smoke/clouds, and the Pro badge in Cadence Animator. Free updates for 1.x.',
        statement_descriptor: 'CADENCE PRO',
        metadata: { app: 'cadence-animator', kind: 'pro-license' },
      });
      say(`product: created ${product.id}`);
    }
  }
  const pid = product?.id || 'prod_DRYRUN';

  // prices
  const prices = product ? await stripe('GET', `/v1/prices?product=${pid}&active=true&limit=20`) : { data: [] };
  const byNick = (n) => prices.data.find((p) => p.nickname === n);
  const ensurePrice = async (nick, cents) => {
    let p = byNick(nick);
    if (p) { say(`price ${nick}: found ${p.id} (${p.unit_amount} ${p.currency})`); return p; }
    say(`price ${nick}: will create ${cents} usd one-time`);
    if (DRY) return { id: `price_${nick}_DRYRUN` };
    p = await stripe('POST', '/v1/prices', { product: pid, currency: 'usd', unit_amount: cents, nickname: nick, tax_behavior: 'unspecified' });
    say(`price ${nick}: created ${p.id}`);
    return p;
  };
  const founding = await ensurePrice('founding', FOUNDING_CENTS);
  const regular = await ensurePrice('regular', PRO_CENTS);

  // payment links
  const links = product ? await stripe('GET', '/v1/payment_links?active=true&limit=100') : { data: [] };
  const findLink = (tag) => links.data.find((l) => l.metadata?.cadence === tag);
  const ensureLink = async (tag, price, extra) => {
    let l = findLink(tag);
    if (l) { say(`payment link ${tag}: found ${l.id} ${l.url}`); return l; }
    say(`payment link ${tag}: will create for ${price.id}${extra.restrictions ? ` (limit ${FOUNDING_LIMIT} completed sessions)` : ''}`);
    if (DRY) return { id: `plink_${tag}_DRYRUN`, url: '(dry run)' };
    l = await stripe('POST', '/v1/payment_links', {
      line_items: [{ price: price.id, quantity: 1 }],
      after_completion: { type: 'redirect', redirect: { url: `${SITE}/thanks.html?session_id={CHECKOUT_SESSION_ID}` } },
      allow_promotion_codes: false,
      metadata: { cadence: tag },
      ...extra,
    });
    say(`payment link ${tag}: created ${l.id} ${l.url}`);
    return l;
  };
  const foundingLink = await ensureLink('founding', founding, { restrictions: { completed_sessions: { limit: FOUNDING_LIMIT } } });
  const proLink = await ensureLink('regular', regular, {});

  console.log('\n--- paste these ---');
  console.log(`site/assets/js/config.js:\n  PRO_FOUNDING_LINK: '${foundingLink.url}',\n  PRO_LINK: '${proLink.url}',`);
  console.log(`Render env:\n  FOUNDING_PAYMENT_LINK=${foundingLink.id}\n  PRO_PAYMENT_LINK=${proLink.id}\n  FOUNDING_LIMIT=${FOUNDING_LIMIT}`);
  if (DRY) console.log('\n(dry run — nothing was created)');
})().catch((e) => { console.error(e.message); process.exit(1); });
