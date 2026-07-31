// Packaged-build check for the procedural node editor. Logs only — it writes no files and takes no
// screenshots, which is what makes it safe to run against an INSTALLED build:
//
//   "…/win-unpacked/Cadence Animator.exe" --user-data-dir=<tmp> --demo-js-file=test/pnx-editor-check.js
//
// test/pnx-editor-shot.js is the richer sibling and is DEV-MODE ONLY, because its resolveProjectPath()
// resolves against window.location.href — inside a packaged app that is a path inside app.asar, which
// is not writable, so the first writeFile kills the renderer. That failure looks exactly like the app
// crashing on boot, and cost real time to tell apart; hence this file.
(async () => {
  const t0 = Date.now();
  while (!window.__cadenceDebug) {
    if (Date.now() - t0 > 20000) { console.log('[check] FAIL boot: __cadenceDebug never appeared'); return 'fail'; }
    await new Promise((r) => setTimeout(r, 100));
  }

  async function call(type, payload) {
    const res = await window.cadence.debugCallMcp(type, payload || {});
    if (!res.ok) throw new Error(`${type}: ${res.error}`);
    return res.data;
  }

  const ob = document.getElementById('onboarding');
  if (ob && ob.classList.contains('show')) document.getElementById('onboardStart').click();

  for (let i = 0; i < 40; i++) {
    const r = await window.cadence.debugCallMcp('vfx_get_state', {});
    if (r.ok) break;
    await new Promise((r2) => setTimeout(r2, 500));
  }

  const fails = [];
  const want = (cond, msg) => { if (!cond) fails.push(msg); };

  try {
    await call('pnx_new', { name: 'Packaged Check' });
    const v = await call('pnx_test_open_editor');
    console.log('[check] editor:', JSON.stringify({
      open: v.open, boxes: v.boxes, sockets: v.sockets, controls: v.controls,
      colours: v.distinctSocketColours, previews: v.previews, metrics: v.metrics,
    }));
    want(v.open, 'editor did not open');
    want(v.boxes === 10, `expected the 10 starter nodes, got ${v.boxes}`);
    want(v.sockets > 40, `expected many typed sockets, got ${v.sockets}`);
    want(v.controls > 20, `expected inline controls, got ${v.controls}`);
    want(v.distinctSocketColours > 2, 'sockets not coloured by type');
    want(v.clipped.length === 0, `clipped labels: ${v.clipped.join(', ')}`);
    want(v.clippedValues.length === 0, `clipped values: ${v.clippedValues.join(', ')}`);
    want(v.metrics.box === 268, `node width is ${v.metrics.box}, expected 268`);
    want(v.metrics.headerH === 28, `header is ${v.metrics.headerH}px, expected 28`);
    want(v.metrics.num === 62 && v.metrics.slider === 62,
      `number box / slider are ${v.metrics.num}/${v.metrics.slider}px — a CSS rule lost its specificity fight`);

    const pal = await call('pnx_test_palette', { query: 'swirl' });
    console.log('[check] palette:', JSON.stringify({ opened: pal.opened, results: pal.results, top: pal.labels.slice(0, 3) }));
    want(pal.opened && pal.results > 0, 'the add palette did not open with results');
    want(pal.labels.some((l) => /curl|vortex/i.test(l)), `"swirl" did not surface swirling motion: ${pal.labels.join(', ')}`);

    const parity = await call('pnx_test_registry_parity');
    console.log('[check] parity:', JSON.stringify({ same: parity.same, count: parity.count, missingMetadata: parity.missingMetadata }));
    want(parity.same, `palette and MCP catalogue differ: ${parity.detail}`);
    want(parity.count > 300, `only ${parity.count} node types registered in the packaged build`);
    want(parity.missingMetadata === 0, `${parity.missingMetadata} types lack editor metadata`);

    await call('pnx_test_close_editor');
    await call('pnx_scrub', { frame: 24 });
    const st = await call('pnx_get_state');
    console.log('[check] render:', JSON.stringify({ drawn: st.stats.drawnElements }));
    want((st.stats.drawnElements || 0) > 0, 'the starter effect drew nothing at frame 24');
  } catch (e) {
    fails.push(`threw: ${e.message}`);
  }

  console.log(fails.length ? '[check] FAIL — ' + fails.join(' | ') : '[check] PASS');
  return fails.length ? 'fail' : 'pass';
})()
