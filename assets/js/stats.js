/* ==========================================================================
   Cadence by Corvexsa — the anonymous visit counter

   Counts, for cadence.corvexsa.com only:
     - a visit, and each page it opens
     - how long the page is actually on screen (a hidden tab, or five minutes
       with no mouse, key, scroll or touch, stops the clock)
     - a click on a plan's buy button ([data-buy]) or a download ([data-dl])

   A visit is a random id kept in sessionStorage, so it ends with the tab.
   No cookies, no names, no IP addresses. The counter lives at
   services/stats/ on the main branch; privacy.html says the same thing.

   Visiting stats.html once with the key turns counting off in that browser
   (localStorage 'cadence-stats-me'), so Aly's own visits never count.
   ========================================================================== */
(function () {
  'use strict';
  var API = 'https://cadence-stats.alyc70755.workers.dev/e';
  var IDLE_MS = 5 * 60 * 1000;

  if (location.hostname !== 'cadence.corvexsa.com') return; // local previews don't count
  if (navigator.webdriver) return;
  try { if (localStorage.getItem('cadence-stats-me') === '1') return; } catch (e) { /* storage blocked: still count */ }

  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  var visit;
  try {
    visit = sessionStorage.getItem('cadence-visit');
    if (!visit) { visit = randomId(); sessionStorage.setItem('cadence-visit', visit); }
  } catch (e) { visit = randomId(); }

  var page = location.pathname.replace(/\/index\.html$/, '/') || '/';

  function send(ev) {
    ev.k = 'web';
    ev.v = visit;
    var body = JSON.stringify(ev);
    try { if (navigator.sendBeacon && navigator.sendBeacon(API, body)) return; } catch (e) { /* fall through */ }
    try { fetch(API, { method: 'POST', body: body, keepalive: true, mode: 'no-cors' }).catch(function () {}); } catch (e) { /* offline */ }
  }

  // ------------------------------------------------------------ the page view
  var ref = '';
  try { if (document.referrer && new URL(document.referrer).hostname !== location.hostname) ref = document.referrer; } catch (e) { /* bad referrer */ }
  send({ t: 'view', p: page, r: ref });

  // ------------------------------------------------------------ time on screen
  var shownMs = 0;          // on-screen time not yet reported
  var since = null;         // when the current on-screen stretch began
  var lastInput = Date.now();

  function counting() { return document.visibilityState === 'visible' && Date.now() - lastInput < IDLE_MS; }
  function settle() {
    if (since !== null) { shownMs += Math.min(Date.now(), lastInput + IDLE_MS) - since; since = null; }
    if (counting()) since = Date.now();
  }
  function flush() {
    settle();
    var s = Math.round(shownMs / 1000);
    if (s > 0) { shownMs -= s * 1000; send({ t: 'time', s: s }); }
  }
  ['mousemove', 'keydown', 'scroll', 'touchstart', 'pointerdown'].forEach(function (type) {
    window.addEventListener(type, function () {
      var wasIdle = Date.now() - lastInput >= IDLE_MS;
      if (wasIdle) settle();          // close the stretch at the moment it went idle
      lastInput = Date.now();
      if (wasIdle) settle();          // and open a new one now
    }, { passive: true, capture: true });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(); else settle();
  });
  window.addEventListener('pagehide', flush);
  setInterval(function () { if (document.visibilityState === 'visible') flush(); }, 60000);
  settle();

  // ------------------------------------------------------------ buy and download clicks
  function planOf(el) {
    var plan = el.getAttribute('data-buy');
    if (plan === 'request') {       // parents.html: the plan the child asked about
      var name = (document.getElementById('reqPlanName') || {}).textContent || '';
      plan = /studio/i.test(name) ? 'studio' : /founder/i.test(name) ? 'founders' : 'pro';
    }
    if (plan === 'pro' || plan === 'studio') {
      var monthly = document.getElementById('billMonthly');
      if (monthly) plan += monthly.checked ? '-monthly' : '-yearly';
    }
    return plan;
  }
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-buy], [data-dl]');
    if (!el) return;
    if (el.hasAttribute('data-buy')) send({ t: 'click', c: 'buy', d: planOf(el), p: page });
    else send({ t: 'click', c: 'download', d: el.getAttribute('data-dl'), p: page });
  }, true);
})();
