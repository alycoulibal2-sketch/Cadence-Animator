// Perf benchmark: loads a real project, then measures steady-state frame cost.
// Run via:  electron . --user-data-dir=... --screenshot=... --demo-js-file=test/perfbench.js
// Results land in console (mirrored to the app's debug.log by main.js's console mirror).
(async () => {
  const log = (...a) => console.log('[PERF]', ...a);
  const PROJ = window.__PERF_PROJECT || 'C:/Users/alyco/Documents/Defend or Die Heavy Animations/Heavy_HMG_BASE.cadence';
  const D = window.__cadenceDebug;

  const t0 = performance.now();
  const text = await window.cadence.readFile(PROJ);
  const tRead = performance.now() - t0;

  const t1 = performance.now();
  D.S.loadProject(text);
  const tLoad = performance.now() - t1;

  // Let async texture decodes / mesh builds settle.
  await new Promise((r) => setTimeout(r, 6000));

  const info = window.performance.memory
    ? `jsHeap=${(performance.memory.usedJSHeapSize / 1e6).toFixed(0)}MB`
    : 'jsHeap=n/a';

  // Count what actually ends up on the GPU.
  let meshes = 0, tris = 0, texels = 0, mats = 0;
  const seenTex = new Set(), seenGeo = new Set(), texObjs = [];
  D.viewport.scene.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    if (g && !seenGeo.has(g.uuid)) {
      seenGeo.add(g.uuid);
      tris += (g.index ? g.index.count : g.attributes.position?.count || 0) / 3;
    }
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) {
      if (!m) continue;
      mats++;
      if (m.map && !seenTex.has(m.map.uuid)) {
        seenTex.add(m.map.uuid);
        const im = m.map.image;
        if (im?.width) { texels += im.width * im.height; texObjs.push(`${im.width}x${im.height}`); }
      }
    }
  });

  // Steady-state frame timing: the app's own rAF loop is already running, so just sample it.
  const sample = (label, n = 180) => new Promise((res) => {
    const ts = [];
    let last = performance.now();
    let i = 0;
    const tick = () => {
      const now = performance.now();
      ts.push(now - last);
      last = now;
      if (++i < n) requestAnimationFrame(tick);
      else {
        ts.sort((a, b) => a - b);
        const med = ts[ts.length >> 1];
        const p95 = ts[Math.floor(ts.length * 0.95)];
        log(`${label}: median ${med.toFixed(1)}ms (${(1000 / med).toFixed(0)} fps)  p95 ${p95.toFixed(1)}ms (${(1000 / p95).toFixed(0)} fps)`);
        res();
      }
    };
    requestAnimationFrame(tick);
  });

  // Isolate the CPU-side scene solve from the GPU draw.
  const timeFn = (label, fn, n = 120) => {
    const s = performance.now();
    for (let i = 0; i < n; i++) fn();
    const per = (performance.now() - s) / n;
    log(`${label}: ${per.toFixed(2)}ms/call`);
    return per;
  };

  log('=========== CADENCE PERF BENCH ===========');
  log(`file read: ${tRead.toFixed(0)}ms   loadProject(parse+build): ${tLoad.toFixed(0)}ms   ${info}`);
  log(`scene: ${meshes} meshes, ${mats} materials, ${Math.round(tris)} unique tris`);
  log(`textures: ${seenTex.size} distinct GPU textures, ${(texels * 4 * 1.33 / 1e6).toFixed(0)}MB VRAM  [${texObjs.join(', ')}]`);
  log(`renderer.info: ${JSON.stringify(D.viewport.renderer.info.render)} | memory ${JSON.stringify(D.viewport.renderer.info.memory)}`);

  timeFn('updateScene() CPU solve', () => D.updateScene());
  timeFn('render() draw', () => D.render());

  await sample('idle (no interaction)');

  // Simulate the hover raycast that fires on every pointermove.
  const el = D.viewport.renderer.domElement;
  const r = el.getBoundingClientRect();
  timeFn('pick() hover raycast', () => {
    D.debugPick({ clientX: r.left + r.width * (0.4 + Math.random() * 0.2), clientY: r.top + r.height * (0.4 + Math.random() * 0.2) });
  }, 40);

  // Playback FPS.
  D.S.setPlaying(true);
  await sample('during playback');
  D.S.setPlaying(false);

  const t2 = performance.now();
  const json = D.S.serialize();
  log(`serializeProject (JSON.stringify): ${(performance.now() - t2).toFixed(0)}ms  ->  ${(json.length / 1e6).toFixed(1)}MB`);
  log('=========== END ===========');
})();
