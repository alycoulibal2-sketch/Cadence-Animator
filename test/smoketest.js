// Persistent pre-release smoke test. Run via `npm run smoketest` before every release — it's the
// same technique used to verify every feature built this session (electron's --screenshot +
// --demo-js-file mechanism), just checked into the repo instead of thrown away after one use, so
// a regression gets caught THE NEXT TIME THIS RUNS instead of being rediscovered by hand weeks
// later. Writes test-output/smoketest-report.json (full detail), test-output/PASS or
// test-output/FAIL (an empty marker file, trivial to check from a shell script), and a few key
// screenshots for a quick visual look without re-running the app yourself.
//
// This is NOT a substitute for actually clicking through the packaged build (see `npm run dist`
// + README's release checklist) — it catches crashes, wrong numbers, and silent regressions in
// the things that are easy to assert on (colors, geometry, determinism, no-NaN). Anything about
// how something LOOKS/FEELS still needs a human glance.
//
// Expected console noise, not a bug: the scale-tool and trackpad-mode checks below dispatch
// synthetic PointerEvents directly at the canvas to exercise the real capture-phase listeners —
// OrbitControls/TransformControls also react to that same event (there's no way to notify one
// listener on an element without notifying all of them) and throw a harmless
// "No active pointer with the given id is found" / null-read since no genuine OS-level pointer
// is actually down. This doesn't affect either check's real assertions or PASS/FAIL result.
(async () => {
  // boot() completes async work (settings, viewport, builtin rig data) before setting
  // window.__cadenceDebug — main.js's screenshot mechanism fires this script after a FIXED delay
  // from did-finish-load, which occasionally races ahead of boot() under load. Poll rather than
  // assume it's ready, so a slow-but-otherwise-fine boot doesn't read as a false failure.
  const bootDeadline = Date.now ? Date.now() + 8000 : null; // Date.now unavailable only inside Workflow scripts, fine here
  while (!window.__cadenceDebug) {
    if (bootDeadline && Date.now() > bootDeadline) throw new Error('window.__cadenceDebug never appeared — boot() likely failed; check debug.log');
    await new Promise((r) => setTimeout(r, 100));
  }
  const D = window.__cadenceDebug;
  const S = D.S, CF = D.CF, IO = D.IO;
  const report = { startedAt: 'n/a (Date.now() unavailable in this harness)', steps: [], consoleErrors: [] };

  const origError = console.error;
  console.error = (...a) => { report.consoleErrors.push(a.map(String).join(' ')); origError(...a); };

  // A step that waits on requestAnimationFrame never resolves if Chromium decides to throttle the
  // window (which it does whenever another app covers it — the run then stalls forever with no
  // report, looking exactly like a code hang; it cost real debugging time). npm run smoketest
  // passes --disable-backgrounding-occluded-windows so that cannot happen, but this bounds the
  // damage for any run launched without those switches: a stuck step fails loudly and the
  // remaining checks still run.
  const STEP_TIMEOUT_MS = 30000;
  async function step(name, fn) {
    // Logged BEFORE running: a step that hangs never reaches its own result, and the report is
    // only written at the very end, so without this a stall looks identical to a slow machine and
    // gives no clue which check is stuck. This has already been needed twice.
    console.log('[smoketest] > ' + name);
    const t0 = performance.now();
    let timer = null;
    try {
      const r = await Promise.race([
        fn(),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`step timed out after ${STEP_TIMEOUT_MS}ms`)), STEP_TIMEOUT_MS); }),
      ]);
      report.steps.push({ name, ok: true, ms: Math.round(performance.now() - t0), r });
    } catch (e) {
      report.steps.push({ name, ok: false, ms: Math.round(performance.now() - t0), error: e.message, stack: (e.stack || '').split('\n').slice(0, 4).join(' | ') });
    } finally {
      clearTimeout(timer);
    }
  }
  function assert(cond, msg) { if (!cond) throw new Error('assertion failed: ' + msg); }
  function resolveProjectPath(relFromRoot) {
    const url = new URL('../' + relFromRoot, window.location.href);
    let p = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
    return p;
  }

  const ob = document.getElementById('onboarding');
  if (ob && ob.classList.contains('show')) document.getElementById('onboardStart').click();
  await new Promise((r) => setTimeout(r, 300));
  D.setHandlesVisible(false);

  // ---------------------------------------------------------------- builtin rigs: colors + edges
  await step('builtin rigs: colors survive to the material, classic head is Roblox-exact, parts are outline-free, no NaN', async () => {
    const results = {};
    // Roblox's own head.mesh, read out of the local Studio install: every classic head (R6 AND
    // R15 — Studio's Rig Builder gives both a Part + SpecialMesh(Head) head, not a MeshPart) must
    // render at exactly this size. Guards the two bugs that made Cadence's heads look wrong:
    // a guessed lathe profile, and multiplying by SpecialMesh.Scale instead of dividing by it.
    const CLASSIC_HEAD = [1.19785, 1.20242, 1.19785];
    for (const key of ['r6', 'r15', 'rthro', 'rthroSlender']) {
      const item = await D.addBuiltinRig(key);
      await new Promise((r) => setTimeout(r, 800));
      D.updateScene();
      const inst = D.getInstance(item.id);
      const torsoName = key === 'r6' ? 'Torso' : 'UpperTorso';
      const torsoDef = item.rig.parts.find((p) => p.name === torsoName);
      const armDef = item.rig.parts.find((p) => /Arm$/.test(p.name));
      const headDef = item.rig.parts.find((p) => p.name === 'Head');
      const rootDef = item.rig.parts.find((p) => p.id === item.rig.rootPart);
      const torsoPart = inst.parts.get(torsoDef.id);
      const headPart = inst.parts.get(headDef.id);
      const torsoColor = torsoPart.mesh.material.color.getHexString();
      const armColor = inst.parts.get(armDef.id).mesh.material.color.getHexString();
      const rootColor = inst.parts.get(rootDef.id).mesh.material.color.getHexString();
      // Data-driven: whatever the preset declares must be what actually reaches the material.
      // (Deliberately not hard-coding the root's colour — R6/R15 come straight out of Studio,
      // where the HumanoidRootPart really is Medium stone grey, while Rthro's is still dark.)
      for (const [label, def, got] of [['torso', torsoDef, torsoColor], ['arm', armDef, armColor], ['root', rootDef, rootColor]]) {
        assert(got === def.color.slice(1).toLowerCase(), `${key} ${label} should render ${def.color}, got #${got}`);
      }
      assert(torsoColor === '635f62', `${key} torso should be Dark stone grey, got #${torsoColor}`);
      assert(armColor === 'a3a2a5', `${key} arm should be Medium stone grey, got #${armColor}`);

      if (headDef.specialMesh && headDef.specialMesh.meshType === 'Head') {
        const g = headPart.mesh.geometry;
        g.computeBoundingBox();
        const size = [
          g.boundingBox.max.x - g.boundingBox.min.x,
          g.boundingBox.max.y - g.boundingBox.min.y,
          g.boundingBox.max.z - g.boundingBox.min.z,
        ];
        size.forEach((v, i) => assert(Math.abs(v - CLASSIC_HEAD[i]) < 0.005,
          `${key} classic head axis ${i} is ${v.toFixed(4)}, Roblox renders ${CLASSIC_HEAD[i]}`));
        results[`${key}_head`] = size.map((v) => +v.toFixed(4));
      }

      // Roblox has no outline pass — nothing may add line geometry on top of a part. This used to
      // assert the opposite (that a dark edge overlay was present); measuring a real part in
      // Studio showed its edges are rounded highlights, not drawn lines.
      for (const [, p] of inst.parts) {
        assert(!p.mesh.children.some((c) => c.userData.isEdgeOverlay || c.isLineSegments2 || c.isLine),
          `${key} ${p.def.name} must not carry an outline overlay`);
      }

      const worlds = inst.solvePoseWorlds(S.evalPose(item, 0), item.origin);
      let nan = 0;
      for (const [, cf] of worlds) if (cf.some((v) => !isFinite(v))) nan++;
      assert(nan === 0, `${key} has ${nan} NaN part world(s)`);
      results[key] = { torsoColor, rootColor, armColor, parts: worlds.size };
    }
    return results;
  });

  // ---------------------------------------------------------------- scale tool: no pivot drift
  await step('scale tool: pivot does not drift (the exact bug reported in a screen recording)', () => {
    const item = S.state.project.items.find((i) => i.kind === 'rig');
    const inst = D.getInstance(item.id);
    S.setSelection(item.id, item.rig.rootPart);
    D.setGizmoMode('scale');
    D.updateScene();
    const pivotBefore = [D.viewport.dummy.position.x, D.viewport.dummy.position.y, D.viewport.dummy.position.z];
    D.viewport.editingDrag = true;
    D.viewport.dummy.scale.set(0.4, 0.4, 0.4);
    D.viewport.gizmo.dispatchEvent({ type: 'objectChange' });
    const gp = inst.group.position, gs = inst.group.scale;
    const predictedPivot = [gp.x + gs.x * pivotBefore[0], gp.y + gs.y * pivotBefore[1], gp.z + gs.z * pivotBefore[2]];
    const drift = Math.hypot(predictedPivot[0] - pivotBefore[0], predictedPivot[1] - pivotBefore[1], predictedPivot[2] - pivotBefore[2]);
    D.viewport.editingDrag = false;
    D.viewport.gizmo.dispatchEvent({ type: 'dragging-changed', value: false });
    assert(drift < 1e-6, `pivot drifted by ${drift} studs`);
    assert(Math.abs(inst.group.scale.x - 1) < 1e-6, 'group scale not reset after release');
    return { drift };
  });

  // ---------------------------------------------------------------- rotate tool: welded parts
  await step('rotate tool: a weld-driven part offset from root only rotates, never translates', () => {
    // "A" (root) at origin, "B" welded to A but offset 2 studs on X — a coincident-offset weld
    // (as in knife.obj's Handle+Blade fixture) can't catch this bug: transformForWorld returns
    // null for any weld-driven part (only motor joints are in jointByPart1), so onGizmoChange used
    // to fall back to treating the rotate as an origin move using B's own raw desired CFrame —
    // correct only when B sits exactly at the root's position. With a real offset it dragged the
    // whole rig sideways by that offset the instant you rotated B (confirmed live).
    const rig = {
      name: 'SmokeTestWeldOffset', rigType: 'Custom', rootPart: 'A',
      parts: [
        { id: 'A', name: 'A', className: 'Part', size: [1, 1, 1], cf: CF.IDENTITY.slice(), color: '#A3A2A5' },
        { id: 'B', name: 'B', className: 'Part', size: [1, 1, 1], cf: [2, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], color: '#A3A2A5' },
      ],
      joints: [{ name: 'BWeld', kind: 'weld', part0: 'A', part1: 'B', c0: [2, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], c1: CF.IDENTITY.slice() }],
    };
    const item = D.addRigItem(rig, rig.name);
    S.setSelection(item.id, 'B');
    D.setGizmoMode('rotate');
    D.updateScene();
    const inst = D.getInstance(item.id);
    const bBefore = inst.partWorld('B').slice();
    D.debugSimulateDrag((dummy) => {
      const q = new (Object.getPrototypeOf(dummy.quaternion).constructor)();
      q.setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 6);
      dummy.quaternion.multiply(q);
    });
    D.updateScene();
    const bAfter = inst.partWorld('B').slice();
    const posDelta = Math.hypot(bAfter[0] - bBefore[0], bAfter[1] - bBefore[1], bAfter[2] - bBefore[2]);
    assert(posDelta < 1e-6, `rotating a welded part translated it by ${posDelta} studs — should only rotate`);
    return { posDelta };
  });

  // ---------------------------------------------------------------- scale tool: customMesh parts
  await step('scale tool: FBX/GLB-imported (customMesh) parts actually resize, not just size/cf', async () => {
    const { importExternalMesh } = await import('../renderer/js/meshImport.js');
    const objText = await window.cadence.readFile(resolveProjectPath('test/fixtures/knife.obj'));
    const buf = new TextEncoder().encode(objText).buffer;
    const rig = await importExternalMesh(buf, 'knife.obj');
    const item = D.addRigItem(rig, rig.name);
    const before = item.rig.parts.find((p) => p.name === 'Blade').customMesh.positions.slice();
    S.resizeItem(item.id, 0.5);
    const after = item.rig.parts.find((p) => p.name === 'Blade').customMesh.positions;
    for (let i = 0; i < before.length; i++) {
      assert(Math.abs(after[i] - before[i] * 0.5) < 1e-6, `customMesh vertex ${i} did not scale: ${before[i]} -> ${after[i]}`);
    }
    return { ok: true };
  });

  // ---------------------------------------------------------------- IK
  await step('IK: converges on a reachable target', () => {
    const item = S.state.project.items.find((i) => i.kind === 'rig' && i.rig.rigType === 'R6');
    const inst = D.getInstance(item.id);
    D.updateScene();
    const worlds0 = inst.solvePoseWorlds(S.evalPose(item, 0), item.origin);
    const hand = worlds0.get(item.rig.parts.find((p) => p.name === 'Left Arm').id);
    const target = [hand[0] + 0.5, hand[1] + 0.5, hand[2] - 0.5];
    const res = D.solveIK(inst, item, item.rig.parts.find((p) => p.name === 'Left Arm').id, target, { basePose: S.evalPose(item, 0), origin: item.origin, chainLength: 2 });
    assert(res && res.error < 0.5, `IK error too high: ${res && res.error}`);
    return { error: res.error, chain: res.chain };
  });

  // ---------------------------------------------------------------- rigging tools
  await step('rigging tools: add/remove/convert a joint cleanly', () => {
    // A fresh two-part rig with NO joints at all — addJoint() correctly refuses to double-drive
    // a part that already has a motor (verified separately below), so testing against any of the
    // real builtin rigs' existing parts would always hit that guard. A clean fixture avoids it.
    const rig = {
      name: 'SmokeTestJointFixture', rigType: 'Custom', rootPart: 'A',
      parts: [
        { id: 'A', name: 'A', className: 'Part', size: [1, 1, 1], cf: CF.IDENTITY.slice(), color: '#A3A2A5' },
        { id: 'B', name: 'B', className: 'Part', size: [1, 1, 1], cf: CF.IDENTITY.slice(), color: '#A3A2A5' },
      ],
      joints: [],
    };
    const item = D.addRigItem(rig, rig.name);
    S.addJoint(item.id, { part0: 'A', part1: 'B', name: 'SmokeTestWeld', kind: 'weld' });
    S.convertJoint(item.id, 'SmokeTestWeld'); // weld -> motor
    S.convertJoint(item.id, 'SmokeTestWeld'); // motor -> weld
    S.removeJoint(item.id, 'SmokeTestWeld');
    D.refreshInstance(item.id);
    assert(item.rig.joints.length === 0, 'joint was not fully removed');
    // addJoint's own double-drive guard: re-add as a motor, then confirm a SECOND motor to the
    // same part1 is correctly refused rather than silently corrupting the rig.
    S.addJoint(item.id, { part0: 'A', part1: 'B', name: 'M1' });
    let refused = false;
    try { S.addJoint(item.id, { part0: 'A', part1: 'B', name: 'M2' }); } catch (_) { refused = true; }
    assert(refused, 'addJoint should refuse to double-drive an already-motored part');
    return { ok: true };
  });

  // ---------------------------------------------------------------- unparented animation
  await step('unparented animation: zero drift on space toggle', () => {
    const item = S.state.project.items.find((i) => i.kind === 'rig' && i.rig.rigType === 'R6');
    const inst = D.getInstance(item.id);
    const j = item.rig.joints.find((jj) => jj.name === 'Left Shoulder');
    S.setKey(item.id, 'Left Shoulder', 0, CF.fromEuler(0, 0, 0.7));
    const before = inst.solvePoseWorlds(S.evalPose(item, 0), item.origin, S.unparentedSet(item.id)).get(j.part1);
    D.setUnparented(item.id, 'Left Shoulder', true);
    D.refreshInstance(item.id);
    const inst2 = D.getInstance(item.id);
    const after = inst2.solvePoseWorlds(S.evalPose(item, 0), item.origin, S.unparentedSet(item.id)).get(j.part1);
    const drift = Math.hypot(...before.slice(0, 3).map((v, i) => v - after[i]));
    D.setUnparented(item.id, 'Left Shoulder', false);
    D.refreshInstance(item.id);
    assert(drift < 1e-4, `pose drifted ${drift} studs on space toggle`);
    return { drift };
  });

  // ---------------------------------------------------------------- VFX determinism
  await step('VFX: deterministic across repeated evaluation, matches ballistic formula', async () => {
    const { sampleParticles } = await import('../renderer/js/vfx.js');
    const item = D.addVfxItem();
    S.setKey(item.id, '@rate', 0, 1000);
    S.setKey(item.id, '@lifetime', 0, 10);
    S.setKey(item.id, '@speed', 0, 0);
    S.setVfxEmitter(item.id, { gravity: -20, maxParticles: 2000, spreadDegrees: 0 });
    const resolveOrigin = (f) => S.evalTrackCF(item.id, '@origin', f, item.origin);
    const fps = S.state.project.fps;
    const a = sampleParticles(item, 20, fps, resolveOrigin, S.evalTrackNum);
    const b = sampleParticles(item, 20, fps, resolveOrigin, S.evalTrackNum);
    assert(a.length === b.length && a.length > 0, 'no particles sampled, or nondeterministic count');
    for (let i = 0; i < a.length; i++) assert(Math.abs(a[i].pos[1] - b[i].pos[1]) < 1e-9, 'nondeterministic particle position');
    const t = 20 / fps;
    const expectedY = item.origin[1] + 0.5 * -20 * t * t;
    const actualY = a[0].pos[1];
    assert(Math.abs(actualY - expectedY) < 0.01, `ballistic formula mismatch: expected ${expectedY}, got ${actualY}`);
    return { particleCount: a.length, expectedY, actualY };
  });

  // ---------------------------------------------------------------- VFX preset library
  await step('VFX: every motion type samples deterministic, finite (no NaN) particles', async () => {
    const { sampleParticles } = await import('../renderer/js/vfx.js');
    const { MOTIONS, PARTICLE_PRESETS } = await import('../renderer/js/particleLibrary.js');
    const ORIGIN = [0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
    const counts = {};
    for (const motion of MOTIONS) {
      const preset = PARTICLE_PRESETS.find((p) => p.emitter.motion === motion);
      assert(preset, `no preset uses motion "${motion}"`);
      const item = { id: 'smoketest-' + motion, emitter: { ...preset.emitter, maxParticles: 500 } };
      let sampled = 0;
      for (const frame of [0, 5, 15, 30, 60]) {
        const particles = sampleParticles(item, frame, 30, () => ORIGIN);
        sampled += particles.length;
        for (const p of particles) {
          assert(isFinite(p.pos[0]) && isFinite(p.pos[1]) && isFinite(p.pos[2]), `${motion}: non-finite position`);
          assert(isFinite(p.size) && p.size > 0, `${motion}: non-finite/zero size`);
          assert(isFinite(p.opacity), `${motion}: non-finite opacity`);
        }
      }
      const a = sampleParticles(item, 20, 30, () => ORIGIN);
      const b = sampleParticles(item, 20, 30, () => ORIGIN);
      assert(a.length === b.length && a.every((p, i) => Math.abs(p.pos[0] - b[i].pos[0]) < 1e-9), `${motion}: nondeterministic`);
      counts[motion] = sampled;
    }
    assert(PARTICLE_PRESETS.length >= 300, `expected a few hundred generated presets, got ${PARTICLE_PRESETS.length}`);
    return { totalPresets: PARTICLE_PRESETS.length, sampledPerMotion: counts };
  });

  // ---------------------------------------------------------------- VFX preset apply + rebuild
  await step('VFX: applying a preset rebuilds the instance pool (shape/blend) and stays undoable', async () => {
    const { findPreset } = await import('../renderer/js/particleLibrary.js');
    const preset = findPreset('portal-swirl-arcane-large');
    assert(preset, 'expected preset "portal-swirl-arcane-large" to exist');
    const itemsBefore = S.state.project.items.length;

    const itemId = D.addVfxItem().id;
    D.applyVfxPreset(itemId, preset);
    const inst = D.getInstance(itemId);
    assert(inst.pool.length === preset.emitter.maxParticles, `pool size ${inst.pool.length} != preset maxParticles ${preset.emitter.maxParticles}`);
    assert(inst.pool[0].material.blending === 2, 'additive-blend preset should use THREE.AdditiveBlending (2)'); // THREE.AdditiveBlending === 2
    // Undo/redo replace state.project.items wholesale (structuredClone snapshot), so any
    // previously-held item object reference goes stale after S.undo()/S.redo() — always
    // re-fetch via S.getItem(id) after each call, never hold a reference across one.
    assert(S.getItem(itemId).emitter.shape === 'ring' && S.getItem(itemId).emitter.motion === 'orbit', 'preset fields did not apply to item.emitter');

    S.undo(); // reverts the setVfxEmitter (preset apply)
    assert(S.getItem(itemId).emitter.shape === 'glow', 'undo should revert the preset apply back to the default shape');
    S.undo(); // reverts the addItem
    assert(S.state.project.items.length === itemsBefore, 'undo should remove the added VFX item entirely');

    S.redo(); // re-adds the item
    S.redo(); // re-applies the preset
    assert(S.getItem(itemId).emitter.shape === 'ring', 'redo should reapply the preset');
    return { ok: true, itemsBefore, maxParticles: preset.emitter.maxParticles };
  });

  // ---------------------------------------------------------------- VFX + scale interleaved undo
  await step('VFX + scale: undo/redo stays correct when the two kinds of change are interleaved', () => {
    const rigId = S.state.project.items.find((i) => i.kind === 'rig').id;
    const partsBefore = JSON.stringify(S.getItem(rigId).rig.parts.map((p) => p.size));

    const vfxId = D.addVfxItem().id;
    S.resizeItem(rigId, 1.4);
    D.applyVfxPreset(vfxId, { emitter: { gravity: -3, rate: 12 } });

    // Undo/redo clone-replace state.project.items wholesale — always re-fetch S.getItem(id)
    // after each call rather than holding an item reference across the undo/redo boundary.
    S.undo(); // vfx emitter patch
    S.undo(); // resize
    assert(JSON.stringify(S.getItem(rigId).rig.parts.map((p) => p.size)) === partsBefore, 'rig scale did not fully revert after interleaved undo');
    S.undo(); // remove vfx item
    assert(!S.getItem(vfxId), 'vfx item should be gone after its add is undone');

    S.redo(); S.redo(); S.redo();
    assert(JSON.stringify(S.getItem(rigId).rig.parts.map((p) => p.size)) !== partsBefore, 'rig scale should be reapplied after redo');
    return { ok: true };
  });

  // ---------------------------------------------------------------- VFX Studio (separate window)
  await step('VFX Studio: opens as a separate window without disturbing the main project/undo state', async () => {
    const projectIdBefore = S.state.project.id;
    const itemCountBefore = S.state.project.items.length;
    const playheadBefore = S.state.playhead;
    const selectionBefore = JSON.stringify(S.state.selection);

    await window.cadence.openVfxStudio();
    await new Promise((r) => setTimeout(r, 1500)); // let the studio window's own boot script run

    assert(S.state.project.id === projectIdBefore, 'main project identity changed after opening VFX Studio');
    assert(S.state.project.items.length === itemCountBefore, 'main project item count changed after opening VFX Studio');
    assert(S.state.playhead === playheadBefore, 'main playhead changed after opening VFX Studio');
    assert(JSON.stringify(S.state.selection) === selectionBefore, 'main selection changed after opening VFX Studio');

    // main.js mirrors the studio window's console/crash output into the same debug.log, tagged
    // "vfxStudio" — this is how we detect the second window actually booted (rather than the IPC
    // call merely resolving) without needing to capture its own screen.
    let log = '';
    try { log = await window.cadence.readFile(resolveProjectPath('test-output/userdata/debug.log')); } catch (_) { /* path is this script's own npm-run-smoketest convention */ }
    const crashLine = log.split('\n').find((l) => l.includes('[vfxStudio') && (l.includes(':ERROR]') || l.includes('process gone') || l.includes('preload error')));
    assert(!crashLine, `VFX Studio window logged an error: ${crashLine}`);
    return { ok: true, sawVfxStudioLog: log.includes('[vfxStudio') };
  });

  // Drives the REAL MCP command dispatcher (handleMcpCommand) via window.cadence.debugCallMcp —
  // the exact code path Claude's MCP tools use, for both vfx_* studio tools and the animator's
  // own tools (add_effect_item, validate_project, ...) — so these checks verify real behavior,
  // not just "didn't crash".
  async function vfxCall(type, payload) {
    const res = await window.cadence.debugCallMcp(type, payload || {});
    assert(res.ok, `${type} failed: ${res.error}`);
    return res.data;
  }

  // The studio window is a second renderer with its own module graph to boot, and the fixed wait
  // above is a guess — on a slower/loaded machine the first vfx_* call can land before it is
  // listening and fail with a timeout that says nothing about the feature under test. Poll until
  // it answers instead, so this suite reports real VFX regressions rather than boot races.
  await (async () => {
    for (let i = 0; i < 20; i++) {
      const res = await window.cadence.debugCallMcp('vfx_get_state', {});
      if (res.ok) return;
      await new Promise((r) => setTimeout(r, 500));
    }
  })();

  await step('VFX Studio MCP: new effect, add layers, curve, modifier round-trip via get_effect', async () => {
    await vfxCall('vfx_new_effect', { name: 'Smoketest Effect', duration: 60, fps: 30 });
    const state1 = await vfxCall('vfx_get_state');
    assert(state1.effect.layerCount === 1, `expected 1 seed layer, got ${state1.effect.layerCount}`);

    const added = await vfxCall('vfx_add_layer', { type: 'shape', name: 'Test Shape' });
    assert(added.effect.layerCount === 2, 'layer count should be 2 after add_layer');
    const shapeLayerId = added.createdLayerId;

    await vfxCall('vfx_set_curve', { layerId: shapeLayerId, prop: 'opacity', keys: [{ t: 0, v: 0 }, { t: 10, v: 1, es: 'Quad', ed: 'Out' }] });
    await vfxCall('vfx_add_modifier', { layerId: shapeLayerId, type: 'pulse' });

    const full = await vfxCall('vfx_get_effect');
    const layer = full.effect.layers.find((l) => l.id === shapeLayerId);
    assert(layer, 'added layer missing from vfx_get_effect result');
    assert(layer.curves.opacity && layer.curves.opacity.length === 2, 'opacity curve did not round-trip');
    assert(layer.modifiers.length === 1 && layer.modifiers[0].type === 'pulse', 'modifier did not round-trip');
    return { ok: true };
  });

  await step('VFX Studio MCP: validation catches a seeded defect and auto-fix clears it', async () => {
    const em = await vfxCall('vfx_add_layer', { type: 'emitter', name: 'Broken Emitter', props: { transparencyStart: 1, transparencyEnd: 1 } });
    const before = await vfxCall('vfx_validate');
    assert(before.counts.error > 0, 'expected the fully-transparent emitter to be flagged as an error');
    const fixed = await vfxCall('vfx_auto_fix', {});
    assert(fixed.after.error === 0, `errors remained after auto-fix: ${JSON.stringify(fixed.after)}`);
    void em;
    return { ok: true };
  });

  await step('VFX Studio MCP: preset library applies and performance report is sane', async () => {
    const presets = await vfxCall('vfx_list_presets', {});
    assert(presets.archetypes.length >= 20, `expected >=20 archetypes, got ${presets.archetypes.length}`);
    const applied = await vfxCall('vfx_apply_preset', { key: 'explosion' });
    assert(applied.applied === 'explosion', 'explosion preset did not apply');
    const perf = await vfxCall('vfx_performance_report');
    assert(perf.estimatedInGameParticles > 0, 'explosion preset should estimate >0 in-game particles');
    assert(perf.platforms && perf.platforms.mobile && perf.platforms.pc, 'performance report missing platform scores');
    return { ok: true, estimatedInGameParticles: perf.estimatedInGameParticles };
  });

  await step('VFX Studio MCP: undo/redo round-trip', async () => {
    const before = await vfxCall('vfx_get_state');
    const countBefore = before.effect.layerCount;
    await vfxCall('vfx_add_layer', { type: 'light' });
    const afterAdd = await vfxCall('vfx_get_state');
    assert(afterAdd.effect.layerCount === countBefore + 1, 'layer count should increase after add');
    await vfxCall('vfx_undo');
    const afterUndo = await vfxCall('vfx_get_state');
    assert(afterUndo.effect.layerCount === countBefore, 'layer count should revert after undo');
    await vfxCall('vfx_redo');
    const afterRedo = await vfxCall('vfx_get_state');
    assert(afterRedo.effect.layerCount === countBefore + 1, 'layer count should restore after redo');
    return { ok: true };
  });

  await step('VFX Studio MCP: Luau export is blocked by errors, then succeeds once clean', async () => {
    await vfxCall('vfx_new_effect', { name: 'Export Test' });
    await vfxCall('vfx_update_layer', { layerId: (await vfxCall('vfx_get_effect')).effect.layers[0].id, props: { transparencyStart: 1, transparencyEnd: 1 } });
    let blocked = false;
    try { await vfxCall('vfx_export_luau'); } catch (_) { blocked = true; }
    assert(blocked, 'export should have been blocked by the transparency error');
    await vfxCall('vfx_auto_fix', {});
    const exported = await vfxCall('vfx_export_luau');
    assert(typeof exported.lua === 'string' && exported.lua.includes('ParticleEmitter'), 'exported Luau missing expected ParticleEmitter code');
    assert(exported.lua.includes('RunService.Heartbeat:Connect'), 'exported Luau missing the wall-clock Heartbeat driver');
    return { ok: true, luaLength: exported.lua.length };
  });

  await step('VFX Studio MCP: exported shake Luau undoes its offset instead of compounding it (regression)', async () => {
    await vfxCall('vfx_new_effect', { name: 'Shake Export Test' });
    await vfxCall('vfx_add_layer', { type: 'shake', name: 'Shake' });
    const exported = await vfxCall('vfx_export_luau');
    assert(exported.lua.includes(':Inverse()'), 'exported shake script should undo its previous offset via :Inverse() before applying a new one');
    assert(/_last = newOffset/.test(exported.lua), 'exported shake script should remember the last-applied offset');
    return { ok: true, luaLength: exported.lua.length };
  });

  await step('VFX Studio MCP: render_frame returns an actual screenshot', async () => {
    const shot = await vfxCall('vfx_render_frame', { frame: 5 });
    assert(typeof shot.image === 'string' && shot.image.length > 5000, 'render_frame image looks too small/missing');
    assert(shot.mimeType === 'image/png', 'render_frame should return a PNG');
    return { ok: true, imageBytes: shot.image.length };
  });

  // ---------------------------------------------------------------- PNX procedural engine
  // The in-app integration pass for the procedural engine. test/pnxtest.mjs covers the engine itself
  // in plain Node; these steps are the part that can only be checked in the real app: that the studio
  // window actually renders a procedural graph through three.js, that scrubbing it stays deterministic
  // with a live WebGL context, and that switching document modes does not leave the previous effect's
  // objects in the scene.
  await step('PNX: a new procedural effect draws through the real renderer', async () => {
    const created = await vfxCall('pnx_new', { name: 'Smoketest Procedural' });
    assert(created.ok, `pnx_new reported not-ok: ${JSON.stringify(created.diagnostics)}`);

    const state = await vfxCall('pnx_get_state');
    assert(state.active, 'the studio should be in procedural mode after pnx_new');
    assert(state.stats.nodes >= 8, `the starter graph should have nodes, got ${state.stats.nodes}`);

    // Let the render loop actually paint, then check what the BACKEND put on screen — not merely what
    // the graph computed. This is the assertion that proves the wiring, rather than the engine.
    await vfxCall('pnx_scrub', { frame: 25 });
    await new Promise((r) => setTimeout(r, 250));
    const drawn = await vfxCall('pnx_get_state');
    assert(drawn.stats.drawnElements > 0, `the graph resolved nothing to draw at frame 25: ${JSON.stringify(drawn.stats)}`);
    assert(drawn.drawn && drawn.drawn.sprites > 0,
      `the three.js backend drew no sprites: ${JSON.stringify(drawn.drawn)}`);
    return { ok: true, nodes: drawn.stats.nodes, sprites: drawn.drawn.sprites };
  });

  await step('PNX: verification reports technical validity and finds no errors in the starter graph', async () => {
    const v = await vfxCall('pnx_verify', { frame: 30 });
    const errors = v.diagnostics.filter((d) => d.severity === 'error');
    assert(!errors.length, `starter graph has errors: ${JSON.stringify(errors)}`);
    assert(v.technicallyValid, `starter graph is not technically valid: ${JSON.stringify(v)}`);

    // Across a range, so an effect that is valid at one frame and empty everywhere else cannot pass.
    const range = await vfxCall('pnx_verify_range', { from: 5, to: 55, samples: 6 });
    assert(range.drewSomething, 'nothing drew at any sampled frame');
    assert(range.drewEverywhere, `some frames drew nothing: ${JSON.stringify(range.emptyFrames)}`);
    return { ok: true, frames: range.frames.length };
  });

  await step('PNX: scrubbing is deterministic in the live app, not only in the pure engine', async () => {
    const at = async (frame) => {
      const r = await vfxCall('pnx_scrub', { frame });
      return r.stats.drawnElements;
    };
    const forwards = await at(40);
    await at(75);
    for (const f of [8, 62, 20]) await at(f);
    const scrubbed = await at(40);
    assert(scrubbed === forwards,
      `frame 40 drew ${forwards} elements played forwards but ${scrubbed} after scrubbing — the replay is not deterministic`);
    return { ok: true, elements: forwards };
  });

  await step('PNX: graph editing through MCP reaches the renderer', async () => {
    const graph = await vfxCall('pnx_get_graph');
    const sprite = graph.nodes.find((n) => n.type.startsWith('cadence.render.sprite'));
    assert(sprite, 'the starter graph should contain a sprite renderer');

    // Muting the renderer must empty the scene; unmuting must restore it. This is the round trip that
    // proves an MCP edit invalidates the evaluator and repaints, rather than only changing a document.
    await vfxCall('pnx_set_node_flags', { nodeId: sprite.id, muted: true });
    await vfxCall('pnx_scrub', { frame: 30 });
    const muted = await vfxCall('pnx_get_state');
    assert(muted.stats.drawnElements === 0, `muting the renderer still drew ${muted.stats.drawnElements} elements`);

    await vfxCall('pnx_set_node_flags', { nodeId: sprite.id, muted: false });
    await vfxCall('pnx_scrub', { frame: 30 });
    const restored = await vfxCall('pnx_get_state');
    assert(restored.stats.drawnElements > 0, 'unmuting the renderer did not bring the effect back');
    return { ok: true };
  });

  await step('PNX: introspection serves the real registry, and inspect probes a field', async () => {
    const cat = await vfxCall('pnx_catalogue');
    assert(cat.count > 250, `expected a large node catalogue, got ${cat.count}`);

    // Part 48's own acceptance example.
    const swirl = await vfxCall('pnx_search_nodes', { query: 'swirl', limit: 6 });
    const labels = swirl.results.map((r) => r.label);
    assert(labels.some((l) => /curl/i.test(l)), `"swirl" should reach Curl Noise, got ${labels.join(', ')}`);

    const desc = await vfxCall('pnx_describe_node', { type: 'cadence.particles.simulate' });
    assert(desc.inputs.some((i) => i.key === 'force'), 'Simulate Particles should document a force input');
    assert(desc.exportSupport, 'every node must declare its export support');

    // A field output must come back as probed samples, not as an opaque object.
    const graph = await vfxCall('pnx_get_graph');
    const lifeNode = graph.nodes.find((n) => n.type.startsWith('cadence.particles.life'));
    if (lifeNode) {
      const ins = await vfxCall('pnx_inspect', { nodeId: lifeNode.id, frame: 20 });
      assert(ins.outputs.out.kind === 'field', `expected a field, got ${JSON.stringify(ins.outputs.out)}`);
      assert(Array.isArray(ins.outputs.out.samples) && ins.outputs.out.samples.length > 1,
        'a field must be reported as probed samples');
    }
    return { ok: true, nodeTypes: cat.count };
  });

  await step('PNX: export compatibility is honest about what Roblox cannot do', async () => {
    const compat = await vfxCall('pnx_export_compatibility', { backend: 'roblox' });
    assert(Array.isArray(compat.rows) && compat.rows.length, 'compatibility should classify the passes');
    assert(compat.note && /no Roblox exporter/i.test(compat.note),
      'the report must say plainly that procedural export is not built yet');
    return { ok: true, counts: compat.counts };
  });

  await step('PNX: a simple effect exports as a real ParticleEmitter, and reports how', async () => {
    await vfxCall('pnx_new', { name: 'Export Smoketest' });

    // The classification first, which is the cheap call a caller should make before baking anything.
    const rep = await vfxCall('pnx_export_report');
    assert(rep.rows.length === 1, `expected one pass, got ${rep.rows.length}`);
    assert(rep.rows[0].level === 'native', `the starter graph should export natively, got ${rep.rows[0].level}: ${JSON.stringify(rep.rows[0].reasons)}`);

    const out = await vfxCall('pnx_export_lua', {});
    assert(out.lua.includes('Instance.new("ParticleEmitter")'), 'a native export must build a real ParticleEmitter');
    assert(out.lua.includes('ColorSequence.new({'), 'the colour gradient must survive as a ColorSequence');
    assert(out.lua.includes('NumberSequence.new({'), 'the size curve must survive as a NumberSequence');
    assert(out.counts.native === 1, `expected a native pass, got ${JSON.stringify(out.counts)}`);
    assert(out.withinBudget, `a native export should be small, got ${out.bytes} bytes`);
    // The classification must travel WITH the script, so a caller cannot report success without it.
    assert(Array.isArray(out.passes) && out.passes[0].how, 'the export must say what it did to each pass');
    return { ok: true, bytes: out.bytes, level: out.passes[0].level };
  });

  await step('PNX: an effect Roblox cannot run is baked, and says so rather than faking it', async () => {
    // Build a curl-noise-forced, colliding effect through the structured API — the exact case Roblox
    // has no way to reproduce.
    await vfxCall('pnx_new', { name: 'Bake Smoketest', blank: true });
    const add = async (type, values) => (await vfxCall('pnx_add_node', { type, x: 0, y: 0, values })).nodeId;
    const link = (a, sa, b, sb) => vfxCall('pnx_connect', { fromNode: a, fromSocket: sa, toNode: b, toSocket: sb });

    const em = await add('cadence.particles.emitter', { rate: 40, lifetime: 1.5, velocity: [0, 6, 0] });
    const curl = await add('cadence.noise.curl', { scale: 0.4 });
    const plane = await add('cadence.sdf.plane', {});
    const col = await add('cadence.particles.collider', { response: 'bounce' });
    const sim = await add('cadence.particles.simulate', { maxParticles: 200 });
    const spr = await add('cadence.render.sprite', { size: 0.3 });
    const out = await add('cadence.render.output', {});
    await link(em, 'out', sim, 'emitter');
    await link(curl, 'out', sim, 'force');
    await link(plane, 'out', col, 'shape');
    await link(col, 'out', sim, 'colliders');
    await link(sim, 'out', spr, 'source');
    await link(spr, 'out', out, 'passes');

    const rep = await vfxCall('pnx_export_report');
    assert(rep.rows[0].level === 'baked', `expected a baked pass, got ${rep.rows[0].level}`);
    const why = rep.rows[0].reasons.join(' | ');
    assert(/collide/i.test(why), `the collider must be named: ${why}`);
    assert(/force varies/i.test(why), `the spatial force must be named: ${why}`);

    const built = await vfxCall('pnx_export_lua', { bakeStride: 3, maxBakedParticles: 80 });
    assert(built.counts.baked === 1, `expected a baked count, got ${JSON.stringify(built.counts)}`);
    assert(/_FRAMES = \{/.test(built.lua), 'a baked pass must emit a recorded frame table');
    assert(built.notes.some((nt) => /recording rather than a simulation/i.test(nt)),
      'the user must be told a bake is a recording, not a simulation');
    assert(!built.lossless, 'a baked export is not lossless and must not claim to be');
    return { ok: true, bytes: built.bytes, notes: built.notes.length };
  });

  await step('PNX: exporting does not disturb the playhead or the live preview', async () => {
    // A bake walks the whole frame range through the SAME evaluator the preview uses, so it has to put
    // the playhead back — otherwise exporting silently scrubs the user's timeline to the last baked frame.
    await vfxCall('pnx_new', { name: 'Playhead Smoketest' });
    await vfxCall('pnx_scrub', { frame: 22 });
    const before = await vfxCall('pnx_get_state');
    await vfxCall('pnx_export_lua', {});
    const after = await vfxCall('pnx_get_state');
    assert(after.playhead === before.playhead,
      `exporting moved the playhead from ${before.playhead} to ${after.playhead}`);
    assert(after.stats.drawnElements === before.stats.drawnElements,
      `exporting changed what the preview draws: ${before.stats.drawnElements} -> ${after.stats.drawnElements}`);
    return { ok: true, playhead: after.playhead };
  });

  await step('PNX: switching back to a layer-based effect leaves no procedural objects behind', async () => {
    await vfxCall('pnx_close');
    const after = await vfxCall('pnx_get_state');
    assert(!after.active, 'pnx_close should leave procedural mode');

    // The layer-based path must still work afterwards — this is the regression that would show up as
    // the old effect being invisible, or the procedural sprites being stuck on screen.
    await vfxCall('vfx_new_effect', { name: 'Back To Layers', duration: 60, fps: 30 });
    const shot = await vfxCall('vfx_render_frame', { frame: 5 });
    assert(typeof shot.image === 'string' && shot.image.length > 5000, 'the layer-based renderer stopped working after PNX');
    return { ok: true };
  });

  // ---------------------------------------------------------------- effect items in the animator
  // (a VFX Studio document placed on the MAIN animator's own timeline, distinct from the
  // standalone studio window above — exercises state.js/viewport.js/rigbuild.js's EffectInstance,
  // not the studio's preview.js).
  await step('Effect item: add via MCP, renders real particles/lights in the main viewport, no NaN', async () => {
    const full = await vfxCall('vfx_get_effect');
    const before = S.state.project.items.length;
    const added = await vfxCall('add_effect_item', { effect: full.effect, effectStart: 0 });
    assert(S.state.project.items.length === before + 1, 'effect item was not added to the project');
    const item = S.getItem(added.itemId);
    assert(item && item.kind === 'effect' && item.effect, 'added item is missing kind/effect data');
    assert(item.effectStart === 0, 'effectStart did not round-trip');

    // Actually solve a frame through the real doc-frame<->project-frame mapping and confirm the
    // EffectInstance produced finite, sane world positions — not just "didn't throw".
    S.setPlayhead(5);
    D.updateScene();
    const inst = D.getInstance(item.id);
    assert(inst, 'no viewport instance was created for the effect item');
    assert(inst.world && inst.world.every(Number.isFinite), 'effect instance world CFrame has NaN/Infinity');

    const summary = (await vfxCall('get_effect_item', { itemId: item.id })).effect;
    assert(summary.layers.length > 0, 'get_effect_item lost the layers');
    return { ok: true, itemId: item.id, layerCount: summary.layers.length };
  });

  await step('Effect item: set_effect_item replaces the document, validate_effect_item + validate_project agree', async () => {
    const items = S.state.project.items.filter((i) => i.kind === 'effect');
    assert(items.length > 0, 'no effect item to test against (run after the add-effect-item check)');
    const itemId = items[items.length - 1].id;

    const broken = JSON.parse(JSON.stringify((await vfxCall('get_effect_item', { itemId })).effect));
    assert(broken.layers[0].type === 'emitter', 'test assumes layer 0 is the seed emitter layer');
    broken.layers[0].props.transparencyStart = 1;
    broken.layers[0].props.transparencyEnd = 1;
    await vfxCall('set_effect_item', { itemId, effect: broken });

    const itemReport = await vfxCall('validate_effect_item', { itemId });
    assert(itemReport.counts.error > 0, 'validate_effect_item should have flagged the fully-transparent emitter');

    const projectReport = await vfxCall('validate_project');
    const hit = projectReport.diagnostics.find((d) => d.target?.itemId === itemId && d.severity === 'error');
    assert(hit, 'validate_project did not surface the effect item\'s error');
    return { ok: true };
  });

  // ---------------------------------------------------------------- themes
  await step('themes: every theme + an accent applies without throwing', () => {
    const themes = Object.keys(D.THEMES || {});
    const list = themes.length ? themes : ['dark', 'midnight', 'slate', 'light'];
    for (const t of list) D.applyTheme(t, '#4fd6a0');
    D.applyTheme('dark', '#7c8cff');
    return { themesChecked: list };
  });

  // ---------------------------------------------------------------- trackpad mode
  await step('trackpad mode: LEFT mouse button only remaps when explicitly on + Alt held', () => {
    const canvas = D.viewport.renderer.domElement;
    const fire = (opts) => canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10, bubbles: true, cancelable: true, ...opts }));
    S.state.trackpadMode = false;
    fire({ altKey: true });
    assert(D.viewport.controls.mouseButtons.LEFT === null, 'trackpad mode off: Alt+LMB must stay null');
    S.state.trackpadMode = true;
    fire({});
    assert(D.viewport.controls.mouseButtons.LEFT === null, 'trackpad mode on, no Alt: must stay null (selection unaffected)');
    fire({ altKey: true });
    assert(D.viewport.controls.mouseButtons.LEFT === 0, 'trackpad mode on + Alt: should be ROTATE (0)');
    S.state.trackpadMode = false;
    fire({});
    return { ok: true };
  });

  // ---------------------------------------------------------------- trackpad mode: two-finger wheel gesture
  await step('trackpad mode: two-finger wheel gesture orbits/pans; pinch and mode-off still just zoom', () => {
    const canvas = D.viewport.renderer.domElement;
    const fireWheel = (opts) => canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 0, deltaY: 0, bubbles: true, cancelable: true, ...opts }));
    const resetCamera = () => { D.viewport.camera.position.set(9, 7, 12); D.viewport.controls.target.set(0, 2.5, 0); D.viewport.controls.update(); };

    S.state.trackpadMode = false;
    resetCamera();
    const distBeforeOff = D.viewport.camera.position.distanceTo(D.viewport.controls.target);
    fireWheel({ deltaY: -50 });
    const distAfterOff = D.viewport.camera.position.distanceTo(D.viewport.controls.target);
    assert(Math.abs(distAfterOff - distBeforeOff) > 1e-4, 'trackpad mode off: a wheel event should still zoom (dolly) as normal');

    S.state.trackpadMode = true;
    resetCamera();
    const targetBeforeOrbit = D.viewport.controls.target.clone();
    const distBeforeOrbit = D.viewport.camera.position.distanceTo(targetBeforeOrbit);
    fireWheel({ deltaX: 40, deltaY: 20 });
    const distAfterOrbit = D.viewport.camera.position.distanceTo(D.viewport.controls.target);
    assert(D.viewport.controls.target.equals(targetBeforeOrbit), 'two-finger drag (no Shift) must orbit, not pan — target moved');
    assert(Math.abs(distAfterOrbit - distBeforeOrbit) < 1e-4, `two-finger drag must orbit at a fixed radius, radius changed by ${Math.abs(distAfterOrbit - distBeforeOrbit)}`);

    resetCamera();
    const targetBeforePan = D.viewport.controls.target.clone();
    fireWheel({ deltaX: 40, deltaY: 20, shiftKey: true });
    assert(!D.viewport.controls.target.equals(targetBeforePan), 'Shift+two-finger drag must pan — target never moved');

    resetCamera();
    const targetBeforePinch = D.viewport.controls.target.clone();
    fireWheel({ deltaY: -50, ctrlKey: true });
    assert(D.viewport.controls.target.equals(targetBeforePinch), 'a pinch gesture (wheel+ctrlKey) must be left alone to zoom, not orbit/pan');

    S.state.trackpadMode = false;
    resetCamera();
    return { ok: true };
  });

  // ---------------------------------------------------------------- FBX/GLB/OBJ import
  await step('OBJ import: exact geometry, no decimation', async () => {
    const { importExternalMesh } = await import('../renderer/js/meshImport.js');
    const objText = await window.cadence.readFile(resolveProjectPath('test/fixtures/knife.obj'));
    const buf = new TextEncoder().encode(objText).buffer;
    const rig = await importExternalMesh(buf, 'knife.obj');
    assert(rig.parts.length === 2, `expected 2 parts, got ${rig.parts.length}`);
    const blade = rig.parts.find((p) => p.name === 'Blade');
    const found = [...Array(blade.customMesh.positions.length / 3)].some((_, i) => {
      const [x, y, z] = blade.customMesh.positions.slice(i * 3, i * 3 + 3);
      return Math.abs(x - 0) < 1e-4 && Math.abs(y - 3.5) < 1e-4 && Math.abs(z - 0.02) < 1e-4;
    });
    assert(found, 'authored apex vertex did not survive import exactly');
    return { partCount: rig.parts.length };
  });

  await step('GLB import: exact geometry + texture, real export/import round trip', async () => {
    const THREE = await import('../renderer/../node_modules/three/build/three.module.js');
    const { importExternalMesh } = await import('../renderer/js/meshImport.js');
    const { GLTFExporter } = await import('../test/vendor/three/exporters/GLTFExporter.js');
    const canvas = document.createElement('canvas');
    canvas.width = 8; canvas.height = 8;
    canvas.getContext('2d').fillStyle = '#ff0000';
    canvas.getContext('2d').fillRect(0, 0, 8, 8);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const geo = new THREE.ConeGeometry(0.4, 2, 8);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex }));
    mesh.name = 'Cone';
    const scene = new THREE.Scene();
    scene.add(mesh);
    const glbBuffer = await new Promise((resolve, reject) => new GLTFExporter().parse(scene, resolve, reject, { binary: true }));
    const rig = await importExternalMesh(glbBuffer, 'cone.glb');
    const part = rig.parts[0];
    assert(part.customMesh.positions.length / 3 === geo.attributes.position.count, 'vertex count mismatch after round trip');
    assert(!!part.customTexture, 'embedded GLB texture did not survive import (check the CSP/ImageBitmapLoader fix in vendored GLTFLoader.js)');
    return { vertCount: part.customMesh.positions.length / 3, hasTexture: !!part.customTexture };
  });

  // ---------------------------------------------------------------- Studio import: accessory attach
  await step('Studio import: unworn accessory attaches to the body by matching Attachment names', () => {
    // Mirrors a real never-equipped Roblox Accessory: Handle carries a Weld with no Part0/Part1
    // (Humanoid:AddAccessory never ran) plus an Attachment named "BodyFrontAttachment" — the body
    // part carries the matching Attachment, exactly like a real R15 rig. Without this fix the
    // Handle would import at its raw stored CFrame (here, deliberately far from the body) instead
    // of resolving to UpperTorso the way Roblox's own AddAccessory algorithm would.
    const modelNode = {
      className: 'Model', name: 'TestRig', props: {}, children: [
        {
          className: 'Part', name: 'UpperTorso', props: { Size: { x: 2, y: 2, z: 1 }, CFrame: { cf: [0, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] } }, children: [
            { className: 'Attachment', name: 'BodyFrontAttachment', props: { CFrame: { cf: [0, 0, 0.5, 1, 0, 0, 0, 1, 0, 0, 0, 1] } }, children: [] },
          ],
        },
        {
          className: 'Accessory', name: 'Accessory (Military Vest)', props: {}, children: [
            {
              className: 'MeshPart', name: 'Handle', props: { Size: { x: 2.2, y: 2.2, z: 1.2 }, CFrame: { cf: [50, 50, 50, 1, 0, 0, 0, 1, 0, 0, 0, 1] } }, children: [
                { className: 'Attachment', name: 'BodyFrontAttachment', props: { CFrame: { cf: [0, 0, -0.6, 1, 0, 0, 0, 1, 0, 0, 0, 1] } }, children: [] },
                { className: 'Weld', name: 'AccessoryWeld', props: {}, children: [] },
              ],
            },
          ],
        },
      ],
    };
    const rig = IO.rigFromModelTree(modelNode);
    const j = rig.joints.find((jj) => jj.part1 === 'Handle');
    assert(!!j, 'no joint synthesized for the unworn accessory — it would import floating, disconnected from the body');
    assert(j.part0 === 'UpperTorso', `accessory welded to the wrong part: ${j.part0}`);
    assert(j.kind === 'weld', 'accessory should attach via a weld, not a motor');
    return { joint: j };
  });

  // ---------------------------------------------------------------- mesh-error surfacing
  await step('mesh-error surfacing: a bad meshId toasts exactly once, does not throw', async () => {
    let events = [];
    const off = S.on('mesh-error', (d) => events.push(d));
    const rig = {
      name: 'SmokeTestBadMesh', rigType: 'Custom', rootPart: 'P',
      parts: [{ id: 'P', name: 'P', className: 'MeshPart', size: [1, 1, 1], cf: CF.IDENTITY.slice(), color: '#A3A2A5', meshId: 'no-digits-here', textureId: '' }],
      joints: [],
    };
    const item = D.addRigItem(rig, rig.name);
    await new Promise((r) => setTimeout(r, 400));
    off();
    assert(events.length === 1, `expected exactly 1 mesh-error event, got ${events.length}`);
    assert(events[0].kind === 'mesh', 'wrong error kind');
    return { events };
  });

  // ---------------------------------------------------------------- face decal
  await step('face decal: patch is flush on the head and maps the texture across the full head width', async () => {
    const item = await D.addBuiltinRig('r6');
    await new Promise((r) => setTimeout(r, 600));
    const headDef = item.rig.parts.find((p) => p.name === 'Head');
    const inst = D.getInstance(item.id);
    const headPart = inst.parts.get(headDef.id);
    const faceChild = headPart.mesh.children.find((c) => c.userData.isFaceLayer);
    assert(!!faceChild, 'no face decal found on R6 head');
    const g = faceChild.geometry;
    const pos = g.attributes.position, uv = g.attributes.uv;
    assert(!!uv, 'face patch has no UVs — it cannot be projecting the texture');
    let minU = Infinity, maxU = -Infinity, minX = Infinity, maxX = -Infinity;
    let minR = Infinity, maxR = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      assert(isFinite(x) && isFinite(y) && isFinite(z), 'NaN vertex in face patch');
      const u = uv.getX(i);
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (Math.abs(y) < 0.05) { // the head's straight wall, where its radius is exactly HEAD_R
        const r = Math.hypot(x, z);
        if (r < minR) minR = r; if (r > maxR) maxR = r;
      }
    }
    // Calibrated against Roblox: face.png's two eyes sit 0.1875 of the texture apart and render
    // 0.183 of the head's width apart in Studio, i.e. the texture spans the head ~1:1. Since the
    // patch maps u linearly to x, studs-per-unit-u must come out as the head's own width. The
    // previous cylinder-section patch spanned only ~0.58 of it, so the face rendered too small.
    const studsPerU = (maxX - minX) / (maxU - minU);
    assert(Math.abs(studsPerU - 1.202) < 0.04, `face texture should span the head's width (~1.202 studs), spans ${studsPerU.toFixed(3)}`);
    // Flush: sitting on the head's own surface, a hair proud of it — never floating or sunk.
    assert(minR > 0.601 && maxR < 0.601 + 0.02, `face patch is not flush on the head wall (radius ${minR.toFixed(4)}..${maxR.toFixed(4)}, wall is 0.601)`);
    return { studsPerU: +studsPerU.toFixed(4), patchRadius: [+minR.toFixed(4), +maxR.toFixed(4)] };
  });

  // ---------------------------------------------------------------- exact clothing composite
  await step('classic clothing uses Roblox’s own compositing meshes and body meshes', async () => {
    const local = await window.cadence.localContent();
    if (!local || !local.dir) return { skipped: 'no local Roblox install on this machine' };

    // Roblox's compositing meshes describe the engine's own bake: a vertex POSITION is a
    // destination pixel in the 1024x512 body atlas and its UV samples the template. Confirm the
    // correspondence that pins the conventions down, so a wrong flip can never creep back in:
    // CompositLeftArmBase's vertex (568,112) must land on template pixel (217,289) — the corner
    // of the right-limb UP region.
    const cm = await window.cadence.localMesh('avatar/compositing/CompositLeftArmBase.mesh');
    assert(cm, 'CompositLeftArmBase.mesh should be readable from the local install');
    let found = false;
    for (let i = 0; i < cm.positions.length / 3; i++) {
      if (Math.abs(cm.positions[i * 3] - 568) < 0.5 && Math.abs(cm.positions[i * 3 + 1] - 112) < 0.5) {
        const u = cm.uvs[i * 2] * 585;
        const v = (1 - cm.uvs[i * 2 + 1]) * 559; // raw file V — the parser flips it on read
        assert(Math.abs(u - 217) < 1.5 && Math.abs(v - 289) < 1.5,
          `composit UV convention drifted: (568,112) -> template (${u.toFixed(1)},${v.toFixed(1)}), expected (217,289)`);
        found = true;
        break;
      }
    }
    assert(found, 'the reference vertex (568,112) is missing from CompositLeftArmBase');

    // A clothed R6 rig must adopt Roblox's own body meshes, whose UVs address that atlas.
    const builtins = await window.cadence.builtinRigs();
    const rig = structuredClone(builtins.r6);
    rig.clothing = { shirt: 'rbxassetid://3670737337', pants: 'rbxassetid://129458425' };
    const item = D.addRigItem(rig, 'ClothingCheck');
    await new Promise((r) => setTimeout(r, 6000));
    const inst = D.getInstance(item.id);
    const arm = inst.parts.get('Left Arm');
    const tris = arm.mesh.geometry.index ? arm.mesh.geometry.index.count / 3 : 0;
    assert(tris === 44, `Left Arm should be Roblox's own 44-triangle mesh, got ${tris}`);
    const { ATLAS_SCALE } = await import('./js/clothing.js');
    const map = arm.mesh.material.map;
    assert(map && map.image && map.image.width === 1024 * ATLAS_SCALE && map.image.height === 512 * ATLAS_SCALE,
      `clothed parts should sample the body atlas at ${ATLAS_SCALE}x, got ${map && map.image && map.image.width}x${map && map.image && map.image.height}`);
    // Roblox filters avatar textures anisotropically; without it a body reads blurry at any angle.
    assert(map.anisotropy > 1, 'the composite should use anisotropic filtering');
    assert(map.generateMipmaps === true, 'the composite should have mipmaps');
    // The atlas is authored Y-down and the body meshes' UVs address it that way, so it must not
    // get the flip an ordinary uploaded texture gets.
    assert(map.flipY === false, 'the atlas must not be Y-flipped');
    S.removeItem(item.id);

    // R15 composites per body GROUP instead, each into its own canvas. Roblox ships no R15 leg
    // mesh — legs reuse their side's arm mesh with the pants template, which is only valid
    // because arms and legs are separate canvases (their UVs genuinely overlap).
    const rig15 = structuredClone(builtins.r15);
    rig15.clothing = rig.clothing;
    const item15 = D.addRigItem(rig15, 'ClothingCheck15');
    await new Promise((r) => setTimeout(r, 8000));
    const inst15 = D.getInstance(item15.id);
    const expect = {
      UpperTorso: [388, 264], LowerTorso: [388, 264],
      LeftUpperArm: [264, 284], LeftHand: [264, 284],
      RightUpperLeg: [264, 284], RightFoot: [264, 284],
    };
    for (const [name, base] of Object.entries(expect)) {
      const size = base.map((v) => v * ATLAS_SCALE);
      const m15 = inst15.parts.get(name).mesh.material.map;
      assert(m15 && m15.image, `${name} should carry its group's composite`);
      assert(m15.image.width === size[0] && m15.image.height === size[1],
        `${name} canvas should be ${size.join('x')}, got ${m15.image.width}x${m15.image.height}`);
      assert(m15.anisotropy > 1, `${name} should use anisotropic filtering`);
      assert(m15.flipY === false, `${name}'s composite must not be Y-flipped`);
    }
    // Parts of one group share a canvas; different groups must not.
    const torso = inst15.parts.get('UpperTorso').mesh.material.map.image;
    assert(inst15.parts.get('LowerTorso').mesh.material.map.image === torso,
      'a group’s parts should share one canvas');
    assert(inst15.parts.get('LeftUpperArm').mesh.material.map.image !== torso,
      'different groups must not share a canvas');
    assert(inst15.parts.get('LeftUpperArm').mesh.material.map.image
      !== inst15.parts.get('LeftUpperLeg').mesh.material.map.image,
      'arms and legs overlap in UV space, so they must be separate canvases');
    S.removeItem(item15.id);
    return { atlas: [map.image.width, map.image.height], armTris: tris, r15: 'per-group canvases verified' };
  });

  // ---------------------------------------------------------------- implicit frame-0 key
  await step('keying past frame 0 lays down the rest pose at frame 0, exactly once', async () => {
    const item = await D.addBuiltinRig('r15');
    const id = item.id;
    const REST = CF.IDENTITY;
    const POSED = [0, 0, 0, 1, 0, 0, 0, 0.7071, -0.7071, 0, 0.7071, 0.7071];

    S.setKey(id, 'LeftShoulder', 20, POSED.slice());
    let keys = S.getTrack(id, 'LeftShoulder').keys;
    assert(keys.length === 2 && keys[0].t === 0 && keys[1].t === 20, `expected keys at 0 and 20, got ${keys.map((k) => k.t)}`);
    assert(keys[0].v.every((v, i) => Math.abs(v - REST[i]) < 1e-9), 'the implicit frame-0 key must hold the rest pose');

    S.setKey(id, 'LeftShoulder', 30, REST.slice());
    keys = S.getTrack(id, 'LeftShoulder').keys;
    assert(keys.filter((k) => k.t === 0).length === 1, 'a second key must not add another frame-0 key');

    // A frame-0 key the user authored themselves is the start of the animation — never replaced.
    const mine = [0, 5, 0, ...REST.slice(3)];
    S.setKey(id, 'RightShoulder', 0, mine.slice());
    S.setKey(id, 'RightShoulder', 12, REST.slice());
    const rk = S.getTrack(id, 'RightShoulder').keys;
    assert(rk.length === 2 && Math.abs(rk[0].v[1] - 5) < 1e-9, 'a user-authored frame-0 key must be preserved as-is');

    // Bulk paths that reproduce existing keys (animation import, paste, fill) must not inject.
    S.setKey(id, 'Waist', 15, REST.slice(), { noAutoZero: true });
    assert(S.getTrack(id, 'Waist').keys.length === 1, 'noAutoZero must suppress the implicit key');

    // The implicit key belongs to the same undo step as the key that caused it.
    S.setKey(id, 'Neck', 10, POSED.slice());
    S.undo();
    const neck = S.getTrack(id, 'Neck');
    assert(!neck || neck.keys.length === 0, `undo must remove the implicit key too, left ${neck && neck.keys.length}`);

    S.removeItem(id);
    return { ok: true };
  });

  // ---------------------------------------------------------------- part markers
  await step('every drawable part carries a visible, clickable marker sitting on its surface', async () => {
    const THREE = await import('../renderer/../node_modules/three/build/three.module.js');
    const item = await D.addBuiltinRig('r6');
    await new Promise((r) => setTimeout(r, 1200));
    D.updateScene();
    const inst = D.getInstance(item.id);

    for (const [name, p] of inst.parts) {
      assert(p.marker, `${name} has no marker`);
      // The invisible HumanoidRootPart must not sprout one.
      const shouldShow = p.def.transparency < 0.99;
      assert(p.marker.visible === shouldShow, `${name} marker visibility should be ${shouldShow}`);
    }

    // Placement is derived from the RENDERED geometry, not Part.Size. A classic head is a 2x1x1
    // Part that draws as a ~1.2 lathe, so sizing off Part.Size buried its marker inside the head.
    const head = inst.parts.get('Head');
    const camera = D.viewport.camera;
    D.updateScene();
    const headCentre = new THREE.Vector3(head.world[0], head.world[1], head.world[2]);
    const markerPos = new THREE.Vector3().setFromMatrixPosition(head.marker.matrix);
    // The head is ROUND, so the distance must be its radius regardless of view angle. Treating it
    // as a box put the marker at 0.864 — out where the bounding box corner is, visibly hovering.
    const out = markerPos.distanceTo(headCentre);
    assert(out > 0.55 && out < 0.65,
      `the head marker should sit on the lathe's ~0.6 surface, got ${out.toFixed(3)} from centre`);
    // and it must be on the camera's side of the part, never buried behind it
    const toCam = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld).sub(headCentre).normalize();
    const toMarker = markerPos.clone().sub(headCentre).normalize();
    assert(toCam.dot(toMarker) > 0.9, 'the marker should face the camera side of the part');

    // Clicking the marker must select that part — it is its own raycast target.
    assert(head.marker.userData.partId === 'Head' && head.marker.userData.isSelBox,
      'the marker should identify its part to the picker');

    S.removeItem(item.id);
    return { parts: inst.parts.size };
  });

  // ---------------------------------------------------------------- part multi-select + keying
  await step('parts multi-select like keyframes; double-click keys one at the playhead', async () => {
    const item = await D.addBuiltinRig('r15');
    const id = item.id;

    S.setSelection(id, 'LeftUpperArm');
    S.toggleSelectedPart(id, 'RightUpperArm');
    S.toggleSelectedPart(id, 'Head');
    assert(S.selectedParts().length === 3, `expected 3 selected parts, got ${S.selectedParts().length}`);
    assert(S.state.selection.partId === 'Head', 'the primary should follow the most recent click');
    S.toggleSelectedPart(id, 'Head');
    assert(!S.isPartSelected(id, 'Head'), 'shift-clicking a selected part must deselect it');
    assert(S.state.selection.partId === 'RightUpperArm', 'the primary must fall back to a still-selected part');
    S.setSelection(id, 'LeftUpperArm');
    assert(S.selectedParts().length === 1, 'a plain click must reset to a single part');

    // Keying a multi-selection keys every member, not just the primary.
    S.setPlayhead(24, false);
    S.setSelection(id, 'LeftUpperLeg');
    S.toggleSelectedPart(id, 'RightUpperLeg');
    D.keyCurrentPose();
    for (const track of ['LeftHip', 'RightHip']) {
      const tr = S.getTrack(id, track);
      assert(tr && tr.keys.some((k) => k.t === 24), `${track} should have been keyed at 24`);
    }

    // Double-click: keys the clicked part where it is, at the current frame.
    S.setPlayhead(33, false);
    D.viewport.onKeyPartRequest(id, 'LeftLowerArm');
    const elbow = S.getTrack(id, 'LeftElbow');
    assert(elbow && elbow.keys.some((k) => k.t === 33), 'double-click should key that part at the playhead');

    // The root part has no joint above it — it animates through @origin instead.
    S.setPlayhead(40, false);
    D.viewport.onKeyPartRequest(id, 'HumanoidRootPart');
    const origin = S.getTrack(id, '@origin');
    assert(origin && origin.keys.some((k) => k.t === 40), 'double-clicking the root part should key @origin');

    // A multi-selected part must still read as selected while another is hovered.
    const inst = D.getInstance(id);
    S.setSelection(id, 'LeftUpperArm');
    S.toggleSelectedPart(id, 'RightUpperArm');
    inst.setHighlight(S.selectedParts().map((p) => p.partId), 2);
    for (const name of ['LeftUpperArm', 'RightUpperArm']) {
      assert(inst.parts.get(name).selBox.material.opacity > 0.3, `${name} should render as selected`);
    }
    assert(inst.parts.get('Head').selBox.material.opacity === 0, 'an unselected part must not render as selected');

    S.removeItem(id);
    return { ok: true };
  });

  // ---------------------------------------------------------------- save/load + undo/redo
  await step('save/load round trip preserves item count; undo/redo does not throw', () => {
    const before = S.state.project.items.length;
    const json = S.serialize();
    S.loadProject(json);
    const after = S.state.project.items.length;
    assert(before === after, `item count changed across save/load: ${before} -> ${after}`);
    S.undo(); S.redo();
    return { itemCount: after };
  });

  // ---------------------------------------------------------------- VFX Studio: camera shake
  await step('VFX Studio: camera shake layer does not drift the camera while paused (regression)', async () => {
    await vfxCall('vfx_new_effect', { name: 'Shake Pause Test', duration: 60, fps: 30 });
    await vfxCall('vfx_add_layer', { type: 'shake', name: 'Shake' }); // defaults: amplitude 0.3, roll 0.8, active [0,60)
    const result = await vfxCall('vfx_test_shake_pause_stability', { frame: 5, ticks: 45 });
    assert(result.drift < 1e-6, `camera position drifted by ${result.drift} studs across ${45} paused ticks — shake is leaking into the persisted camera pose`);
    assert(result.quatDrift < 1e-6, `camera rotation drifted by ${result.quatDrift} across ${45} paused ticks — shake is leaking into the persisted camera pose`);
    return result;
  });

  // ---------------------------------------------------------------- node editor: graph compiler
  await step('Node editor: a Create->Color->Output chain compiles to one valid, correctly-propped layer', async () => {
    const result = await vfxCall('vfx_graph_test_compile', {
      nodes: [
        { id: 'spawn', type: 'spawnParticles', params: { rate: 77, maxParticles: 300, shape: 'spark' } },
        { id: 'color', type: 'color', params: { colorStart: '#112233', colorEnd: '#445566' } },
        { id: 'out', type: 'preview' },
      ],
      connections: [
        { fromNode: 'spawn', fromSocket: 'flow', toNode: 'color', toSocket: 'flow' },
        { fromNode: 'color', fromSocket: 'flow', toNode: 'out', toSocket: 'flow' },
      ],
    });
    assert(result.ok, `chain should compile successfully, got errors: ${JSON.stringify(result.errors)}`);
    assert(result.errors.length === 0, `a valid chain should produce zero compile errors, got: ${JSON.stringify(result.errors)}`);
    assert(result.layerCount === 1, `expected exactly 1 layer, got ${result.layerCount}`);
    assert(result.layers[0].props.rate === 77, `spawnParticles node's rate should flow into the compiled layer, got ${result.layers[0].props.rate}`);
    assert(result.layers[0].props.colorStart === '#112233' && result.layers[0].props.colorEnd === '#445566', `color node's params should flow into the compiled layer, got ${result.layers[0].props.colorStart}/${result.layers[0].props.colorEnd}`);
    assert(result.validationErrorCount === 0, `compiled doc should validate with zero errors, got ${result.validationErrorCount}`);
    return result;
  });

  await step('Node editor: applying a graph through the real studioState integration renders actual particles', async () => {
    // Exercises ST.setGraph -> recompileFromGraph -> state.doc for real (not compileGraph in
    // isolation) and confirms the result reaches the live three.js preview via the exact same
    // vfx_render_frame path a human's own node graph would — the compile-to-existing-runtime
    // path this whole feature is built on, proven end-to-end, not just against test fixtures.
    const applied = await vfxCall('vfx_graph_test_apply', {
      nodes: [
        { id: 'spawn', type: 'spawnParticles', params: { rate: 60, maxParticles: 250, shape: 'spark' } },
        { id: 'out', type: 'preview' },
      ],
      connections: [{ fromNode: 'spawn', fromSocket: 'flow', toNode: 'out', toSocket: 'flow' }],
    });
    assert(applied.diagnostics.filter((d) => d.severity === 'error').length === 0, `applying a valid graph should leave the doc error-free, got: ${JSON.stringify(applied.diagnostics)}`);
    const state = await vfxCall('vfx_get_state');
    assert(state.effect.layers.length === 1, `state.doc should have exactly 1 layer compiled from the graph, got ${state.effect.layers.length}`);
    const shot = await vfxCall('vfx_render_frame', { frame: 10 });
    assert(typeof shot.image === 'string' && shot.image.length > 5000, 'render_frame image looks too small/missing for a graph-authored effect');
    assert(shot.mimeType === 'image/png', 'render_frame should return a PNG');
    return { layerCount: state.effect.layers.length, imageBytes: shot.image.length };
  });

  await step('Node editor: an unwired Create node contributes zero layers (not an error)', async () => {
    const result = await vfxCall('vfx_graph_test_compile', {
      nodes: [
        { id: 'spawn', type: 'spawnParticles' }, // never connected to anything
        { id: 'out', type: 'preview' }, // never connected to anything either
      ],
      connections: [],
    });
    assert(result.ok, 'compiling a graph with no complete chains should still succeed');
    assert(result.layerCount === 0, `an unwired Create node should contribute zero layers, got ${result.layerCount}`);
    assert(result.errors.length === 0, `an unwired graph is a normal mid-edit state, not an error, got: ${JSON.stringify(result.errors)}`);
  });

  await step('Node editor: two Create chains into one Output produce two layers', async () => {
    const result = await vfxCall('vfx_graph_test_compile', {
      nodes: [
        { id: 'spawnA', type: 'spawnParticles', params: { rate: 10 } },
        { id: 'spawnB', type: 'spawnParticles', params: { rate: 20 } },
        { id: 'out', type: 'preview' },
      ],
      connections: [
        { fromNode: 'spawnA', fromSocket: 'flow', toNode: 'out', toSocket: 'flow' },
        { fromNode: 'spawnB', fromSocket: 'flow', toNode: 'out', toSocket: 'flow' },
      ],
    });
    assert(result.ok, `two-chain compile should succeed, got: ${JSON.stringify(result.errors)}`);
    assert(result.layerCount === 2, `expected exactly 2 layers (one per Create chain), got ${result.layerCount}`);
    const rates = result.layers.map((l) => l.props.rate).sort((a, b) => a - b);
    assert(rates[0] === 10 && rates[1] === 20, `each chain's own rate should land on its own layer, got ${JSON.stringify(rates)}`);
  });

  await step('Node editor: a cyclic graph is rejected with a clear error, never a hang', async () => {
    const result = await vfxCall('vfx_graph_test_compile', {
      nodes: [
        { id: 'a', type: 'color' },
        { id: 'b', type: 'size' },
        { id: 'out', type: 'preview' },
      ],
      // Hand-crafted directly (bypassing the editor's own connect(), which would refuse this) —
      // exercises graphCompiler.js's OWN defensive cycle guard, since a hand-written/MCP-authored
      // graph can arrive with a cycle the editor itself could never produce.
      connections: [
        { fromNode: 'a', fromSocket: 'flow', toNode: 'b', toSocket: 'flow' },
        { fromNode: 'b', fromSocket: 'flow', toNode: 'a', toSocket: 'flow' },
        { fromNode: 'b', fromSocket: 'flow', toNode: 'out', toSocket: 'flow' },
      ],
    });
    assert(result.ok, 'a cyclic graph should still return ok (the cycle is reported, not a hard failure)');
    assert(result.layerCount === 0, `a cyclic chain should never compile into a layer, got ${result.layerCount}`);
    assert(result.errors.some((e) => /cycle/i.test(e)), `expected a cycle error to be reported, got: ${JSON.stringify(result.errors)}`);
  });

  // ---------------------------------------------------------------- ramps (colorRamp/densityRamp)
  await step('colorRamp/densityRamp render + export end-to-end, no regression for ramp-less docs', async () => {
    await vfxCall('vfx_new_effect', { name: 'Ramp Test' });
    const state1 = await vfxCall('vfx_get_state');
    const layerId = state1.effect.layers[0].id;
    const colorRamp = [{ u: 0, v: '#ff0000' }, { u: 0.33, v: '#00ff00' }, { u: 0.66, v: '#0000ff' }, { u: 1, v: '#ffff00' }];
    const densityRamp = [{ u: 0, v: 0 }, { u: 0.5, v: 1 }, { u: 1, v: 0 }];
    await vfxCall('vfx_update_layer', { layerId, props: { colorRamp, densityRamp } });

    const full = await vfxCall('vfx_get_effect');
    const layer = full.effect.layers.find((l) => l.id === layerId);
    assert(layer.props.colorRamp?.length === 4, `colorRamp should round-trip with 4 stops, got ${layer.props.colorRamp?.length}`);
    assert(layer.props.densityRamp?.length === 3, `densityRamp should round-trip with 3 stops, got ${layer.props.densityRamp?.length}`);

    await vfxCall('vfx_scrub', { frame: 10 }); // exercises vfx.js's sampleParticles ramp branch for real, must not throw

    const exported = await vfxCall('vfx_export_luau');
    assert(exported.lua.includes('ColorSequenceKeypoint.new'), 'exported Luau should contain real multi-keypoint ColorSequenceKeypoint.new calls when a colorRamp is active');
    assert(exported.lua.includes('NumberSequenceKeypoint.new'), 'exported Luau should contain real multi-keypoint NumberSequenceKeypoint.new calls when a densityRamp is active');

    // Regression: a doc with no ramp still exports the plain 2-stop form, byte-identical to
    // before this feature existed.
    await vfxCall('vfx_new_effect', { name: 'No Ramp Test' });
    const plainExport = await vfxCall('vfx_export_luau');
    assert(!plainExport.lua.includes('ColorSequenceKeypoint.new'), 'a doc with no colorRamp should still export the plain 2-stop ColorSequence.new(...) form');
    assert(plainExport.lua.includes('ColorSequence.new(Color3'), 'plain (no-ramp) export path should be unchanged');

    return { colorRampStops: layer.props.colorRamp.length, densityRampStops: layer.props.densityRamp.length };
  });

  await step('malformed colorRamp written outside the editor is caught by validation and auto-fixable', async () => {
    await vfxCall('vfx_new_effect', { name: 'Malformed Ramp Test' });
    const state1 = await vfxCall('vfx_get_state');
    const layerId = state1.effect.layers[0].id;
    // Out of order, duplicate u, endpoints not spanning 0..1 — the exact shape a raw MCP
    // set_property/update_layer call could produce, since setLayerProps doesn't sanitize ramps.
    const badRamp = [{ u: 0.5, v: '#ff0000' }, { u: 0.2, v: '#00ff00' }, { u: 0.5, v: '#0000ff' }];
    await vfxCall('vfx_update_layer', { layerId, props: { colorRamp: badRamp } });
    const validation = await vfxCall('vfx_validate', {});
    const found = validation.diagnostics.find((d) => d.id === 'VFX-E030');
    assert(found, `expected a VFX-E030 diagnostic for the malformed colorRamp, got: ${JSON.stringify(validation.diagnostics.map((d) => d.id))}`);
    const fixed = await vfxCall('vfx_auto_fix', {});
    assert(fixed.applied.some((a) => a.autoFixId === 'fix-ramp-sanitize'), `expected fix-ramp-sanitize to be applied, got: ${JSON.stringify(fixed.applied)}`);
    const after = await vfxCall('vfx_get_effect');
    const layer = after.effect.layers.find((l) => l.id === layerId);
    assert(layer.props.colorRamp.length === 2, `sanitize should dedupe the duplicate u=0.5 stop down to 2, got ${layer.props.colorRamp.length}`);
    assert(layer.props.colorRamp[0].u === 0 && layer.props.colorRamp[1].u === 1, 'sanitized stops should span exactly u=0..1');
    return fixed;
  });

  // ---------------------------------------------------------------- MCP registration coverage
  // Regression guard for a real bug found 2026-07-22: solve_ik/create_joint/remove_joint/
  // convert_joint/set_track_space/get_track_space were fully implemented in MCP_HANDLERS (built
  // 2026-07-18) but mcp-server/index.js never registered matching tools -- completely unreachable
  // from Claude despite being real, working, tested code. Nothing else could have caught this: the
  // module-level checks above call MCP_HANDLERS directly, bypassing exactly the boundary that was
  // broken. This step statically diffs the two files' name lists so a future feature can't ship
  // the same gap silently.
  await step('every app.js MCP_HANDLERS key has a matching mcp-server/index.js tool registration', async () => {
    const appSrc = await window.cadence.readFile(resolveProjectPath('renderer/js/app.js'));
    const mcpSrc = await window.cadence.readFile(resolveProjectPath('mcp-server/index.js'));

    const registered = new Set([...mcpSrc.matchAll(/server\.tool\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g)].map((m) => m[1]));

    const startMarker = 'const MCP_HANDLERS = {';
    const start = appSrc.indexOf(startMarker);
    const end = appSrc.indexOf('\nfunction initMcp', start);
    assert(start !== -1 && end !== -1, 'could not locate the MCP_HANDLERS block in app.js -- this check needs updating if that structure changed');
    const handlersBlock = appSrc.slice(start + startMarker.length, end);
    const handlerKeys = [...handlersBlock.matchAll(/^\s{2}([a-zA-Z_][a-zA-Z0-9_]*):/gm)].map((m) => m[1]);
    assert(handlerKeys.length > 20, `sanity check: expected dozens of top-level handler keys, only found ${handlerKeys.length} -- the extraction regex likely broke`);

    // Deliberately internal-only handlers that should NOT be MCP-reachable go here, by name, with
    // a reason -- an empty array would mean "every handler must be registered."
    const KNOWN_UNREGISTERED = [
      'add_vfx', // legacy single-emitter `vfx` item kind -- UI-only (command palette), superseded
      'set_vfx_emitter', // by the richer effect/vfx_* system; target `effect` for anything new.
    ];

    const missing = handlerKeys.filter((k) => !registered.has(k) && !KNOWN_UNREGISTERED.includes(k));
    assert(missing.length === 0, `MCP_HANDLERS has ${missing.length} handler(s) with no matching mcp-server/index.js tool registration -- implemented but unreachable from Claude: ${missing.join(', ')}`);
    return { handlerCount: handlerKeys.length, registeredCount: registered.size, excluded: KNOWN_UNREGISTERED };
  });

  // ---------------------------------------------------------------- Moon Animator parity
  // These cover the subsystems ported from Moon Animator 2 (see docs/moon-parity.md): the
  // easing engine, event markers, the play range, wiggle fill / frame offset, property and
  // action tracks, and the screen effects.

  await step('easing: Sextic/OutIn, Back overshoot and Elastic amplitude+period round-trip and evaluate', async () => {
    const EASE = await import('../renderer/js/easing.js');
    assert(EASE.STYLES.includes('Sextic'), 'Sextic style should exist (Moon has it, Roblox does not)');
    assert(EASE.DIRECTIONS.includes('OutIn'), 'OutIn direction should exist');
    // Every style/direction must start at 0 and be finite throughout. Exponential In/OutIn end at
    // 0.999/0.9995 -- that is Moon's own 0.001 fudge, reproduced deliberately, not a bug.
    const endpointExceptions = { ExponentialIn: 0.999, ExponentialOutIn: 0.9995 };
    for (const style of EASE.STYLES) {
      const dirs = EASE.EASE_DATA[style].directional ? EASE.DIRECTIONS : ['Out'];
      for (const dir of dirs) {
        assert(Math.abs(EASE.ease(style, dir, 0)) < 1e-9, `${style}${dir} should start at 0`);
        const want = endpointExceptions[style + dir] ?? 1;
        assert(Math.abs(EASE.ease(style, dir, 1) - want) < 1e-9, `${style}${dir} should end at ${want}`);
        for (let i = 0; i <= 20; i++) {
          assert(Number.isFinite(EASE.ease(style, dir, i / 20)), `${style}${dir} produced a non-finite value`);
        }
      }
    }
    // Parameters must actually change the curve, and Moon's Expo/Circ spellings must still resolve.
    const b1 = EASE.ease('Back', 'Out', 0.5, { Overshoot: 1.70158 });
    const b2 = EASE.ease('Back', 'Out', 0.5, { Overshoot: 6 });
    assert(Math.abs(b1 - b2) > 1e-6, 'Back Overshoot should change the curve');
    const e1 = EASE.ease('Elastic', 'Out', 0.4, { Amplitude: 1, Period: 0.3 });
    const e2 = EASE.ease('Elastic', 'Out', 0.4, { Amplitude: 1, Period: 0.8 });
    assert(Math.abs(e1 - e2) > 1e-6, 'Elastic Period should change the curve');
    assert(EASE.canonicalStyle('Expo') === 'Exponential' && EASE.canonicalStyle('Circ') === 'Circular',
      "Moon's Expo/Circ spellings should resolve to Roblox's Exponential/Circular");
    // Period is frame-relative: the same stored value must read differently on segments of
    // different lengths, and a key with no params must be unaffected by segment length.
    const key = { es: 'Elastic', ed: 'Out', ep: { Amplitude: 1, Period: 6 } };
    assert(Math.abs(EASE.evalSegment(key, 0.5, 6) - EASE.evalSegment(key, 0.5, 12)) > 1e-6,
      'a frame-relative Period should differ between a 6-frame and a 12-frame segment');
    const plain = { es: 'Quad', ed: 'Out' };
    assert(Math.abs(EASE.evalSegment(plain, 0.3, 4) - EASE.evalSegment(plain, 0.3, 40)) < 1e-15,
      'a key with no easing params must not depend on segment length');
    return { styles: EASE.STYLES.length, directions: EASE.DIRECTIONS.length };
  });

  await step('event markers: add/move/resize/export round-trip, and the undo snapshot includes them', async () => {
    await D.addBuiltinRig('r15');
    const item = S.state.project.items[S.state.project.items.length - 1];
    const m = S.addMarker(item.id, 12, { name: 'footstep', width: 3, kf: { Sound: 'step1' } });
    assert(m && m.t === 12, 'addMarker should return the new marker');
    assert(S.addMarker(item.id, 12) === null, 'two markers must not share a start frame');
    assert(!!S.markerSpanning(item.id, 14) && !S.markerSpanning(item.id, 16),
      'markerSpanning should respect the marker width');

    // Width clamps against the next marker (Moon's EditMarkers maxWidth rule).
    S.addMarker(item.id, 18);
    S.setMarker(item.id, 12, { width: 99 });
    assert(S.getMarker(item.id, 12).width === 5, `width should clamp to 5 (18-12-1), got ${S.getMarker(item.id, 12).width}`);

    // Moving onto an occupied frame must not merge two markers into one.
    S.moveMarkers([{ itemId: item.id, t: 12 }], 6);
    assert(S.getMarkers(item.id).length === 2, 'a colliding move must keep both markers');

    // Export: a named marker becomes a named Keyframe with KeyframeMarker children.
    const data = IO.buildExportData(item, {});
    const named = data.keyframes.find((kf) => kf.name === 'footstep');
    assert(named, 'the exported KeyframeSequence should carry the marker name on its Keyframe');
    assert(named.markers.some((x) => x.name === 'Sound' && x.value === 'step1'), 'KeyframeMarkers should export');
    const xml = IO.buildKeyframeSequenceXML(data);
    assert(xml.includes('class="KeyframeMarker"'), 'the XML should contain a real KeyframeMarker instance');

    // Regression: project.markers was originally missing from the undo snapshot, which made
    // every marker edit silently un-undoable.
    const before = S.getMarkers(item.id).length;
    S.addMarker(item.id, 40, { name: 'temp' });
    S.undo();
    assert(S.getMarkers(item.id).length === before, 'undo must restore markers');
    return { markers: S.getMarkers(item.id).length };
  });

  await step('play range confines playback, clamps, swaps inverted input, and survives undo', async () => {
    assert(S.playRange().full, 'a fresh project should have no play range');
    let r = S.setPlayRange(10, 40);
    assert(r.start === 10 && r.end === 40 && !r.full, 'setPlayRange should store the window');
    r = S.setPlayRange(50, 20);
    assert(r.start === 20 && r.end === 50, 'an inverted range should swap rather than invert');
    r = S.setPlayRange(-5, 99999);
    assert(r.start === 0 && r.end === S.state.project.length, 'the range should clamp to the project');
    S.setPlayRange(5, 15);
    S.undo();
    assert(S.playRange().full, 'undo must restore the previous play range');
    S.setPlayRange(null, null);
    return { cleared: S.playRange().full };
  });

  await step('wiggle fill stays within its magnitude (it must not compound frame over frame)', async () => {
    const item = S.state.project.items.find((i) => i.rig);
    const joint = item.rig.joints.find((j) => j.kind !== 'weld');
    S.state.project.tracks[item.id][joint.name] = { keys: [] };
    const I = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
    S.setKey(item.id, joint.name, 0, I.slice());
    S.setKey(item.id, joint.name, 8, I.slice());
    S.fillFrames(item.id, joint.name, 0, 8, 1, { wiggle: { pos: [0, 0, 0], rot: [10, 10, 10], minZero: false } });

    // The original implementation sampled the curve as it wrote, so each frame interpolated
    // against the keys just written and the jitter compounded well past the requested angle.
    // Moon reads from a precomputed BufferMap for exactly this reason.
    for (const k of S.getTrack(item.id, joint.name).keys) {
      const angs = CF.toEuler(k.v).map((a) => Math.abs((a * 180) / Math.PI));
      assert(angs.every((a) => a <= 10.001), `wiggle exceeded its 10 degree magnitude: ${angs.join(', ')}`);
      // and it must stay a valid rotation, or the pose solver corrupts downstream
      const m = k.v.slice(3);
      const col = (i) => [m[i], m[i + 3], m[i + 6]];
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      assert(Math.abs(dot(col(0), col(0)) - 1) < 1e-6 && Math.abs(dot(col(0), col(1))) < 1e-6,
        'a wiggled CFrame must stay orthonormal');
    }

    // Frame offset shifts keys and markers together.
    const marker0 = S.getMarkers(item.id)[0];
    const t0 = marker0 ? marker0.t : null;
    S.offsetAllFrames(4, { itemId: item.id });
    if (t0 !== null) assert(!!S.getMarker(item.id, t0 + 4), 'offsetAllFrames should move event markers too');
    return { keys: S.getTrack(item.id, joint.name).keys.length };
  });

  await step('property + action tracks: typed evaluation, discrete hold, and Luau export', async () => {
    const lighting = S.addPropItem({ name: 'Lighting', className: 'Lighting', target: 'Lighting' });
    assert(Object.keys(S.getTracks(lighting.id)).includes('ClockTime'), 'a prop item should get its class defaults');

    S.setKey(lighting.id, 'ClockTime', 0, 6, { es: 'Linear' });
    S.setKey(lighting.id, 'ClockTime', 10, 18, { es: 'Linear' });
    assert(Math.abs(S.evalTrackValue(lighting.id, 'ClockTime', 5) - 12) < 1e-9, 'a number track should lerp');

    S.setKey(lighting.id, 'Ambient', 0, [0, 0, 0], { es: 'Linear' });
    S.setKey(lighting.id, 'Ambient', 10, [1, 1, 1], { es: 'Linear' });
    const mid = S.evalTrackValue(lighting.id, 'Ambient', 5);
    assert(mid.every((c) => Math.abs(c - 0.5) < 1e-9), 'a Color3 track should lerp componentwise');

    // Discrete types hold the earlier value until the next key, then snap (Moon's Discrete tween).
    S.addPropertyTrack(lighting.id, 'GlobalShadows');
    S.setKey(lighting.id, 'GlobalShadows', 0, false, { es: 'Linear' });
    S.setKey(lighting.id, 'GlobalShadows', 10, true, { es: 'Linear' });
    assert(S.evalTrackValue(lighting.id, 'GlobalShadows', 9) === false, 'a discrete track must hold, not blend');
    assert(S.evalTrackValue(lighting.id, 'GlobalShadows', 10) === true, 'a discrete track must snap at the next key');

    // Class inheritance is honoured (SpotLight gets Light's properties).
    const spot = S.addPropItem({ name: 'Lamp', className: 'SpotLight', target: 'Workspace.Lamp.Light' });
    assert(!!S.addPropertyTrack(spot.id, 'Brightness'), 'SpotLight should inherit Brightness from Light');
    assert(S.addPropertyTrack(spot.id, 'NotAThing') === null, 'a bogus property must be rejected');

    // Action tracks fire once as playback crosses them.
    const sound = S.addPropItem({ name: 'Hit', className: 'Sound', target: 'Workspace.Hit', withDefaults: false });
    S.addActionTrack(sound.id, 'Sound.Play');
    S.setKey(sound.id, '@act:Sound.Play', 12, true);
    assert(S.actionEventsBetween(sound.id, 11, 13).length === 1, 'the action key should be found in its crossing window');
    assert(S.actionEventsBetween(sound.id, 12, 20).length === 0, 'the crossing window must be half-open at the start');

    const items = S.state.project.items.filter((i) => i.kind === 'prop');
    const lua = IO.buildPropertyScriptLua(IO.buildPropertyScriptData(items));
    assert(lua.includes('resolve("Lighting")'), 'the generated script should resolve the target path');
    assert(lua.includes('Color3.new('), 'Color3 values should emit a Color3 constructor');
    assert(/if fromFrame < 12 and toFrame >= 12 then target\d+:Play\(\) end/.test(lua), 'the action should emit a crossing guard');
    assert(!/undefined|NaN|\[object/.test(lua), 'generated Luau must never contain undefined/NaN/[object Object]');
    return { targets: items.length };
  });

  await step('screen effects render over the viewport and export as a real ScreenGui', async () => {
    const FX = await import('../renderer/js/screenFx.js');
    const vig = FX.addScreenEffect('vignette');
    assert(vig.kind === 'prop' && vig.className === 'ImageLabel', 'a screen effect should be an ordinary prop item');
    assert(FX.addScreenEffect('vignette').id === vig.id, 'adding the same effect twice should reuse it');
    FX.addScreenEffect('letterbox');
    FX.addScreenEffect('cover');
    const subs = FX.addScreenEffect('subtitles');

    S.setKey(subs.id, 'Text', 0, 'Hello world');
    S.setKey(subs.id, 'MaxVisibleGraphemes', 0, 5);
    S.setPlayhead(0);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const layer = document.getElementById('screenFx');
    assert(layer && layer.children.length >= 4, `the overlay should render every effect, got ${layer?.children.length}`);
    const sub = [...layer.children].find((c) => c.className === 'fx-subtitles');
    assert(sub && sub.textContent === 'Hello', `MaxVisibleGraphemes should type the line out, got "${sub?.textContent}"`);
    // The overlay sits above the 3D canvas -- if it ever caught pointer events, gizmo drags would die.
    assert(getComputedStyle(layer).pointerEvents === 'none', 'the screen-effect overlay must stay pointer-transparent');

    const lua = IO.buildPropertyScriptLua(IO.buildPropertyScriptData(S.state.project.items.filter((i) => i.kind === 'prop')));
    assert(lua.includes('Instance.new("ScreenGui")'), 'screen effects should build their own ScreenGui on export');
    assert(lua.includes('if _built[path] then return _built[path] end'),
      'instances the script builds live under PlayerGui, so resolve() must check them before walking from game');
    return { effects: S.state.project.items.filter((i) => i.screenEffect).length };
  });

  await step('colour conversions round-trip (the picker backing Color3 property tracks)', async () => {
    const C = await import('../renderer/js/color.js');
    for (let r = 0; r <= 1.001; r += 0.25) {
      for (let g = 0; g <= 1.001; g += 0.25) {
        for (let b = 0; b <= 1.001; b += 0.25) {
          const [h, s, v] = C.rgbToHsv(r, g, b);
          const back = C.hsvToRgb(h, s, v);
          assert(Math.abs(back[0] - r) < 1e-9 && Math.abs(back[1] - g) < 1e-9 && Math.abs(back[2] - b) < 1e-9,
            `rgb->hsv->rgb should round-trip, ${[r, g, b]} became ${back}`);
        }
      }
    }
    assert(C.rgbToHex(1, 0, 0) === 'ff0000' && C.rgbToHex(0.5, 0.5, 0.5) === '808080', 'rgbToHex');
    assert(Math.abs(C.hexToRgb('#00ff80')[1] - 1) < 1e-9, 'hexToRgb should parse a leading #');
    // A half-typed hex must read as "not applicable yet", not as an error or a wrong colour --
    // the picker relies on that to avoid fighting the user mid-keystroke.
    assert(C.hexToRgb('nope') === null && C.hexToRgb('#abc') === null, 'an incomplete hex should return null');
    assert(C.cssRgb([2, -1, 0.5]) === 'rgb(255,0,128)', 'cssRgb should clamp out-of-range channels');
    return { ok: true };
  });

  await step('welder joins every loose part once, and is idempotent', async () => {
    await D.addBuiltinRig('r15');
    const item = S.state.project.items[S.state.project.items.length - 1];
    item.rig.joints = [];
    const created = S.weldAllParts(item.id, { kind: 'weld' });
    assert(created.length === item.rig.parts.length - 1, `every part but the base should be welded, got ${created.length}`);
    assert(!item.rig.joints.some((j) => j.part0 === j.part1), 'nothing should be welded to itself');
    assert(S.weldAllParts(item.id, { kind: 'weld' }).length === 0, 'welding twice must be a no-op, never a duplicate');
    return { welded: created.length };
  });

  // ---------------------------------------------------------------- wrap up
  const failed = report.steps.filter((s) => !s.ok);
  report.ok = failed.length === 0 && report.consoleErrors.length === 0;
  report.failedSteps = failed.map((s) => s.name);
  report.summary = report.ok
    ? `PASS — ${report.steps.length} checks, 0 console errors`
    : `FAIL — ${failed.length}/${report.steps.length} checks failed, ${report.consoleErrors.length} console error(s)`;

  await window.cadence.writeFile(resolveProjectPath('test-output/smoketest-report.json'), JSON.stringify(report, null, 2));
  await window.cadence.writeFile(resolveProjectPath(report.ok ? 'test-output/PASS' : 'test-output/FAIL'), report.summary);

  S.setSelection(null, null);
  D.frameAll();
  console.log('[smoketest]', report.summary);
  return report.summary;
})()
