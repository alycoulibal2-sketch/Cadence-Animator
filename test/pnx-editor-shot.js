// A visual check of the procedural node editor, kept out of the smoketest because it produces a
// picture rather than an assertion. Builds a graph the way Claude builds one, opens the editor the
// way a person opens it, and writes the studio window's own pixels to test-output/.
//
//   electron . --user-data-dir=test-output/userdata-shot --demo-js-file=test/pnx-editor-shot.js
//
// The point is that a passing test says the DOM contains 9 boxes and 58 sockets; it does not say the
// boxes are legible, positioned sanely, or not stacked on top of each other. Only a look says that.
(async () => {
  while (!window.__cadenceDebug) await new Promise((r) => setTimeout(r, 100));

  function resolveProjectPath(rel) {
    const url = new URL('../' + rel, window.location.href);
    let p = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
    return p;
  }
  async function call(type, payload) {
    const res = await window.cadence.debugCallMcp(type, payload || {});
    if (!res.ok) throw new Error(`${type}: ${res.error}`);
    return res.data;
  }
  async function shoot(name) {
    const shot = await call('pnx_render_frame', { frame: 12 });
    await window.cadence.writeFile(resolveProjectPath(`test-output/${name}.b64`), shot.image);
    console.log(`[shot] ${name}: ${shot.image.length} base64 chars`);
  }

  const ob = document.getElementById('onboarding');
  if (ob && ob.classList.contains('show')) document.getElementById('onboardStart').click();

  for (let i = 0; i < 30; i++) {
    const r = await window.cadence.debugCallMcp('vfx_get_state', {});
    if (r.ok) break;
    await new Promise((r2) => setTimeout(r2, 500));
  }

  // 1. The starter graph, which is what a new procedural effect actually opens on.
  await call('pnx_new', { name: 'Editor Screenshot' });
  const v = await call('pnx_test_open_editor');
  console.log('[shot] metrics:', JSON.stringify(v.metrics));
  console.log('[shot] clipped labels:', JSON.stringify(v.clipped), 'clipped values:', JSON.stringify(v.clippedValues));
  const diag = await call('pnx_verify', {});
  console.log('[shot] diagnostics:', JSON.stringify((diag.diagnostics || []).map((d) => `${d.severity}: ${d.message}`)));
  await new Promise((r) => setTimeout(r, 500));
  await shoot('pnx-editor-starter');

  // 2. A graph Claude built, opened by a human — generation through to renderer.
  await call('pnx_test_close_editor');
  await call('pnx_new', { name: 'Claude Built', blank: true });
  const add = async (type, x, y, values) => (await call('pnx_add_node', { type, x, y, values })).nodeId;
  const link = (a, sa, b, sb) => call('pnx_connect', { fromNode: a, fromSocket: sa, toNode: b, toSocket: sb });
  const sphere = await add('cadence.geometry.sphere', -880, -120, { radius: 1.2 });
  const em = await add('cadence.particles.emitter', -560, -160, { emitFrom: 'surface', rate: 90, lifetime: 1.8 });
  const curl = await add('cadence.noise.curl', -560, 260, { scale: 0.6 });
  const sim = await add('cadence.particles.simulate', -200, -60, { maxParticles: 3000, drag: 0.6 });
  const life = await add('cadence.time.normalizedAge', -200, 420, {});
  const grad = await add('cadence.color.sampleGradient', 120, 380, {
    gradient: { kind: 'color', stops: [{ u: 0, v: '#fff3c4' }, { u: 0.4, v: '#ff8a3d' }, { u: 1, v: '#2a1030' }] },
  });
  const mat = await add('cadence.material.surface', 460, 200, { blend: 'additive' });
  const spr = await add('cadence.render.sprite', 800, -20, { size: 0.45 });
  const out = await add('cadence.render.output', 1140, 0, {});
  await link(sphere, 'out', em, 'shape');
  await link(em, 'out', sim, 'emitter');
  await link(curl, 'out', sim, 'force');
  await link(life, 'out', grad, 'position');
  await link(grad, 'out', mat, 'baseColor');
  await link(sim, 'out', spr, 'source');
  await link(mat, 'out', spr, 'material');
  await link(spr, 'out', out, 'passes');

  await call('pnx_test_open_editor');
  await new Promise((r) => setTimeout(r, 600));
  await shoot('pnx-editor-claude-graph');

  // 3. The add palette, which is how a person finds one node among 354.
  await call('pnx_test_palette', { query: 'swirl', keepOpen: true });
  await new Promise((r) => setTimeout(r, 300));
  await shoot('pnx-editor-palette');

  console.log('[shot] done');
  return 'shots written';
})()
