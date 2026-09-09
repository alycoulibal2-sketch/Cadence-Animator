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
  // Wait for a condition instead of guessing how long something takes. A fixed sleep is either too
  // short on a loaded machine (a false failure that looks like a real one) or wasted time on an idle
  // one; this is both faster and honest. Times out well inside the per-step timeout so a genuine
  // hang still reports as this check rather than as the step timing out.
  async function waitFor(cond, what, { timeoutMs = 20000, everyMs = 100 } = {}) {
    const t0 = performance.now();
    for (;;) {
      let ok = false;
      try { ok = !!cond(); } catch (_) { ok = false; }
      if (ok) return performance.now() - t0;
      if (performance.now() - t0 > timeoutMs) {
        throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${what}`);
      }
      await new Promise((r) => setTimeout(r, everyMs));
    }
  }
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

  await step('Cadence Pro: procedural export and the simulation pack are gated by the key, and the key switches them on', async () => {
    const before = await window.cadence.proStatus();
    assert(!before.active, 'a fresh user-data dir has no key');
    await vfxCall('pnx_new', { name: 'Pro gate' });
    let refused = null;
    try { await vfxCall('pnx_export_lua', {}); } catch (e) { refused = e; }
    assert(refused && /Cadence Pro/.test(String(refused.message || refused)), `export without a key must be refused: ${refused && refused.message}`);
    // A Pro node yields its type's default without a key and a real value with one. Cloud makes a
    // volume grid; Volume Info counts its voxels, so the gate is visible as 0 versus 12³.
    const cloud = await vfxCall('pnx_add_node', { type: 'cadence.volume.cloud', x: 0, y: 0, values: { resolution: 12 } });
    const info = await vfxCall('pnx_add_node', { type: 'cadence.volume.info', x: 200, y: 0 });
    await vfxCall('pnx_connect', { fromNode: cloud.nodeId, fromSocket: 'out', toNode: info.nodeId, toSocket: 'volume' });
    const voxelsGated = (await vfxCall('pnx_inspect', { nodeId: info.nodeId, frame: 0 })).outputs.voxels.value;
    assert(voxelsGated === 0, `without a key the Cloud node yields nothing, got ${voxelsGated} voxels`);
    const bad = await window.cadence.proActivate('smoketest@cadence.local', 'AAAA-AAAA-AAAA-AAAA-AAAA');
    assert(!bad.ok, 'a wrong key does not activate');
    const r = await window.cadence.proActivate('smoketest@cadence.local', 'TEST-TEST-TEST-TEST-TEST');
    assert(r.ok && r.status.active, `the test key activates in a smoketest run: ${JSON.stringify(r)}`);
    await new Promise((res) => setTimeout(res, 200));
    const st = await window.cadence.proStatus();
    assert(st.active && st.keyHint === '…TEST', `status reflects the key: ${JSON.stringify(st)}`);
    const voxelsOpen = (await vfxCall('pnx_inspect', { nodeId: info.nodeId, frame: 0 })).outputs.voxels.value;
    assert(voxelsOpen === 12 * 12 * 12, `with the key the same node makes a real 12³ volume, got ${voxelsOpen}`);
    await vfxCall('pnx_remove_node', { nodeId: info.nodeId });
    await vfxCall('pnx_remove_node', { nodeId: cloud.nodeId });
    const again = await vfxCall('pnx_export_lua', {});
    assert(again.lua && again.lua.length > 100, 'with the key, the same export succeeds');
    return { ok: true, keyHint: r.status.keyHint };
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

  await step('PNX: a procedurally-built texture reaches the real renderer', async () => {
    // The whole point of the Textures family: an effect supplies its own image rather than choosing from
    // a list. This builds one from noise through the structured API and checks it actually draws.
    await vfxCall('pnx_new', { name: 'Texture Smoketest', blank: true });
    const add = async (type, values) => (await vfxCall('pnx_add_node', { type, x: 0, y: 0, values })).nodeId;
    const link = (a, sa, b, sb) => vfxCall('pnx_connect', { fromNode: a, fromSocket: sa, toNode: b, toSocket: sb });

    const noise = await add('cadence.noise.fbm', { scale: 4, octaves: 4 });
    const ras = await add('cadence.texture.rasterize', { resolution: 64, extent: 1 });
    const levels = await add('cadence.texture.levels', { inputBlack: 0.35, inputWhite: 0.65 });
    const grad = await add('cadence.texture.gradientMap', {
      gradient: { kind: 'color', stops: [{ u: 0, v: '#000000' }, { u: 0.5, v: '#ff6020' }, { u: 1, v: '#fff0c0' }] },
    });
    const glow = await add('cadence.compositing.glow', { threshold: 0.5, radius: 4, intensity: 1 });
    const mat = await add('cadence.material.surface', { blend: 'additive' });
    const pts = await add('cadence.geometry.pointGrid', { size: [6, 0, 6], countX: 4, countY: 1, countZ: 4 });
    const spr = await add('cadence.render.sprite', { size: 1.2 });
    const out = await add('cadence.render.output', {});

    await link(noise, 'out', ras, 'field');
    await link(ras, 'out', levels, 'texture');
    await link(levels, 'out', grad, 'texture');
    await link(grad, 'out', glow, 'texture');
    await link(glow, 'out', mat, 'texture');
    await link(pts, 'out', spr, 'source');
    await link(mat, 'out', spr, 'material');
    await link(spr, 'out', out, 'passes');

    // The texture chain must produce a real image, not an empty one.
    const info = await add('cadence.texture.info', {});
    await link(glow, 'out', info, 'texture');
    await vfxCall('pnx_scrub', { frame: 10 });
    await new Promise((r) => setTimeout(r, 250));
    const state = await vfxCall('pnx_get_state');
    assert(state.stats.drawnElements === 16, `expected 16 textured sprites, got ${state.stats.drawnElements}`);
    assert(state.drawn && state.drawn.sprites === 16, `the backend must draw them: ${JSON.stringify(state.drawn)}`);

    const v = await vfxCall('pnx_verify', { frame: 10 });
    const errors = v.diagnostics.filter((d) => d.severity === 'error');
    assert(!errors.length, `a texture chain must not error: ${JSON.stringify(errors)}`);
    return { ok: true, drawn: state.drawn.sprites };
  });

  await step('PNX: Texture Info reports a real image rather than an empty one', async () => {
    const graph = await vfxCall('pnx_get_graph');
    const info = graph.nodes.find((n) => n.type.startsWith('cadence.texture.info'));
    assert(info, 'the texture chain should still have its info node');
    const ins = await vfxCall('pnx_inspect', { nodeId: info.id, frame: 10 });
    // A range of 0..0 means the chain produced nothing; an average alpha of 0 means it is transparent,
    // which looks identical to "not drawn" and is a completely different problem.
    const max = ins.outputs.max.value;
    const avgA = ins.outputs.averageAlpha.value;
    assert(max > 0.05, `the texture should have bright pixels, got max ${max}`);
    assert(avgA > 0.5, `the texture should be opaque, got average alpha ${avgA}`);
    assert(ins.outputs.width.value === 64, `resolution should be 64, got ${ins.outputs.width.value}`);
    return { ok: true, max, avgA };
  });

  await step('PNX: a library recipe builds, draws, and can be taken apart', async () => {
    // Part 47's philosophy in one check: a recipe is a composition of primitives, so adding one must
    // produce a group whose interior is ordinary nodes and which actually drives a visible effect.
    await vfxCall('pnx_new', { name: 'Library Smoketest', blank: true });
    const listed = await vfxCall('pnx_list_recipes');
    assert(listed.recipes.length >= 8, `expected a real library, got ${listed.recipes.length}`);
    assert(listed.recipes.every((r) => r.available), 'every listed recipe must be buildable in this build');
    assert(listed.unavailable.length >= 1 && listed.unavailable.every((u) => u.why),
      'what the library cannot build must be named with a reason');

    const added = await vfxCall('pnx_add_recipe', { recipe: 'curlMotion', x: -400, y: 300 });
    assert(added.groupId && added.nodeId, 'adding a recipe must create a group and an instance');
    assert(added.teaches, 'a recipe must say what it demonstrates');

    // The group's interior must be inspectable — Part 46's "no black boxes".
    const inside = await vfxCall('pnx_get_graph', { scope: added.groupId });
    assert(inside.nodes.length >= 3, `the group interior must be visible, got ${inside.nodes.length} nodes`);
    assert(inside.nodes.some((n) => n.type.startsWith('cadence.noise.curl')),
      'Curl Motion must really be built out of Curl Noise');

    // ...and it must drive a real effect.
    const add = async (type, values) => (await vfxCall('pnx_add_node', { type, x: 0, y: 0, values })).nodeId;
    const link = (a, sa, b, sb) => vfxCall('pnx_connect', { fromNode: a, fromSocket: sa, toNode: b, toSocket: sb });
    const em = await add('cadence.particles.emitter', { rate: 60, lifetime: 2 });
    const sim = await add('cadence.particles.simulate', { maxParticles: 500 });
    const spr = await add('cadence.render.sprite', { size: 0.3 });
    const out = await add('cadence.render.output', {});
    await link(em, 'out', sim, 'emitter');
    await link(added.nodeId, 'force', sim, 'force');
    await link(sim, 'out', spr, 'source');
    await link(spr, 'out', out, 'passes');

    await vfxCall('pnx_scrub', { frame: 25 });
    await new Promise((r) => setTimeout(r, 200));
    const state = await vfxCall('pnx_get_state');
    assert(state.stats.drawnElements > 10, `a recipe-driven effect must draw, got ${state.stats.drawnElements}`);
    return { ok: true, recipes: listed.recipes.length, drawn: state.stats.drawnElements };
  });

  await step('PNX: collapsing a selection into a group does not change the result', async () => {
    // The property that makes grouping safe: it is bookkeeping, so what the graph draws must be identical
    // before and after.
    const before = (await vfxCall('pnx_get_state')).stats.drawnElements;
    const graph = await vfxCall('pnx_get_graph');
    // ROOT_SCOPE is the empty string, so a top-level node is one with a falsy scope.
    const em = graph.nodes.find((n) => n.type.startsWith('cadence.particles.emitter') && !n.scope);
    const sim = graph.nodes.find((n) => n.type.startsWith('cadence.particles.simulate'));
    assert(em && sim, 'the effect should have an emitter and a simulation at the top level');

    const res = await vfxCall('pnx_collapse_to_group', { nodeIds: [em.id, sim.id], name: 'Swirling Particles' });
    assert(res.groupId, 'collapsing must create a group');
    assert(res.enclosed === 2);
    assert(res.outputs.length >= 1, 'the particles crossing out must become an output');

    await vfxCall('pnx_scrub', { frame: 25 });
    await new Promise((r) => setTimeout(r, 200));
    const after = (await vfxCall('pnx_get_state')).stats.drawnElements;
    assert(after === before, `collapsing changed what is drawn: ${before} -> ${after}`);

    // Export and re-import it, which is how a group travels between projects.
    const payload = await vfxCall('pnx_export_group', { groupId: res.groupId });
    assert(payload.nodes >= 2, 'an exported group must carry its interior');
    const back = await vfxCall('pnx_import_group', { group: payload.group, name: 'Imported Copy' });
    assert(back.groupId !== res.groupId, 'an imported group must get its own id');
    return { ok: true, drawn: after };
  });

  await step('PNX: volume grids cache a field, and say plainly what is not built', async () => {
    await vfxCall('pnx_new', { name: 'Volume Smoketest', blank: true });
    const add = async (type, values) => (await vfxCall('pnx_add_node', { type, x: 0, y: 0, values })).nodeId;
    const link = (a, sa, b, sb) => vfxCall('pnx_connect', { fromNode: a, fromSocket: sa, toNode: b, toSocket: sb });

    const noise = await add('cadence.noise.fbm', { scale: 2, octaves: 3 });
    const bake = await add('cadence.volume.rasterize', { resolution: 24, size: [4, 4, 4] });
    const blur = await add('cadence.volume.blur', { radius: 1, passes: 1 });
    const info = await add('cadence.volume.info', {});
    await link(noise, 'out', bake, 'field');
    await link(bake, 'out', blur, 'volume');
    await link(blur, 'out', info, 'volume');

    const ins = await vfxCall('pnx_inspect', { nodeId: info, frame: 0 });
    assert(ins.outputs.voxels.value === 24 ** 3, `expected 13824 voxels, got ${ins.outputs.voxels.value}`);
    assert(ins.outputs.max.value > ins.outputs.min.value, 'a baked noise volume must contain a range of values');
    assert(ins.outputs.megabytes.value > 0);

    // The honest statement has to be reachable from inside the graph, not only from documentation.
    const caps = await add('cadence.volume.capabilities', {});
    const c = await vfxCall('pnx_inspect', { nodeId: caps, frame: 0 });
    assert(c.outputs.hasFluidSolver.value === true, 'the fluid solver is built (2026-09-06) and the engine must say so');
    assert(c.outputs.hasVolumeRendering.value === true);
    assert(/FLIP|level.set|GPU/i.test(c.outputs.missing.value), 'and it must name what is still missing (liquids, GPU compute)');
    assert(/advection|raymarch/i.test(c.outputs.built.value), 'and what is built');
    return { ok: true, voxels: ins.outputs.voxels.value, mb: ins.outputs.megabytes.value };
  });

  // ---------------------------------------------------------------- acceptance: one graph, two clients
  // The architectural claim is that the node editor and MCP are two clients of ONE graph, not two
  // systems that synchronise. The test alternates between the paths and demands exact agreement at each
  // step — if a "human graph" and an "AI graph" existed, they would drift on the first alternation.
  //
  // pnx_test_human_edit goes through ST.mutatePnx + PGRAPH.*, which is what the canvas's own pointer
  // handlers call. The canvas itself is checked separately, below.
  await step('PNX acceptance: human edits and Claude edits are the same graph', async () => {
    await vfxCall('pnx_new', { name: 'Round Trip', blank: true });

    // --- 1/2. A human adds and wires nodes; Claude must see exactly that.
    const made = (await vfxCall('pnx_test_human_edit', {
      ops: [
        { op: 'add', as: 'em', type: 'cadence.particles.emitter', x: -300, y: 0, values: { rate: 42, lifetime: 1.25 } },
        { op: 'add', as: 'sim', type: 'cadence.particles.simulate', x: 0, y: 0, values: { maxParticles: 777 } },
        { op: 'connect', from: 'em', fromSocket: 'out', to: 'sim', toSocket: 'emitter' },
      ],
    })).ids;

    const seen = await vfxCall('pnx_get_graph');
    const em = seen.nodes.find((n) => n.id === made.em);
    const sim = seen.nodes.find((n) => n.id === made.sim);
    assert(em && sim, 'MCP must see the nodes a human just created');
    assert(em.values.rate === 42, `MCP must see the human's value, got ${em.values.rate}`);
    assert(sim.values.maxParticles === 777, 'and values on the other node');
    assert(seen.links.some((l) => l.from === `${made.em}.out` && l.to === `${made.sim}.emitter`),
      `MCP must see the human's connection: ${JSON.stringify(seen.links)}`);

    // --- 3. Claude adds nodes and wires into the human's work.
    const sprId = (await vfxCall('pnx_add_node', { type: 'cadence.render.sprite', x: 300, y: 0, values: { size: 0.55 } })).nodeId;
    const outId = (await vfxCall('pnx_add_node', { type: 'cadence.render.output', x: 560, y: 0 })).nodeId;
    await vfxCall('pnx_connect', { fromNode: made.sim, fromSocket: 'out', toNode: sprId, toSocket: 'source' });
    await vfxCall('pnx_connect', { fromNode: sprId, fromSocket: 'out', toNode: outId, toSocket: 'passes' });

    // --- 5/6. The human edits Claude's node; Claude reads the modification back.
    await vfxCall('pnx_test_human_edit', { ops: [{ op: 'setValue', node: sprId, socket: 'size', value: 1.75 }] });
    const after = await vfxCall('pnx_get_graph');
    const sprAfter = after.nodes.find((n) => n.id === sprId);
    assert(sprAfter, 'the node Claude added must still be there after a human edit');
    assert(sprAfter.values.size === 1.75, `Claude must see the human's edit to its own node, got ${sprAfter.values.size}`);

    // --- 7. And the collaboratively-built graph must actually render.
    await vfxCall('pnx_scrub', { frame: 20 });
    await new Promise((r) => setTimeout(r, 250));
    const drawn = (await vfxCall('pnx_get_state')).stats.drawnElements;
    assert(drawn > 0, `the graph both sides built must draw something, got ${drawn}`);
    return { ok: true, nodes: after.nodes.length, drawn };
  });

  await step('PNX acceptance: save and reload gives both sides the identical graph', async () => {
    // Step 8. Serialisation is where a two-graph architecture would finally show itself, because only
    // one of them would be written to disk.
    const before = await vfxCall('pnx_get_graph');
    const saved = await vfxCall('pnx_test_save_reload');
    assert(saved.ok, `the graph must survive a save/reload: ${saved.error || ''}`);

    const after = await vfxCall('pnx_get_graph');
    const norm = (g) => JSON.stringify({
      nodes: g.nodes.map((n) => [n.id, n.type, JSON.stringify(n.values || {})]).sort(),
      links: g.links.map((l) => `${l.from}->${l.to}`).sort(),
    });
    assert(after.nodes.length === before.nodes.length,
      `node count changed across save/reload: ${before.nodes.length} -> ${after.nodes.length}`);
    assert(norm(before) === norm(after), 'the reloaded graph differs from the saved one');

    await vfxCall('pnx_scrub', { frame: 20 });
    await new Promise((r) => setTimeout(r, 250));
    assert((await vfxCall('pnx_get_state')).stats.drawnElements > 0, 'the reloaded graph must still draw');
    return { ok: true, nodes: after.nodes.length, links: after.links.length };
  });

  await step('PNX acceptance: no capability is reachable only through Claude', async () => {
    // The second acceptance test as a structural claim: the palette and the MCP catalogue are served
    // from the same registry, so there cannot be a node Claude can place that a person cannot find.
    // Comparing the two lists IS the test — a divergence means someone introduced a second list.
    const parity = await vfxCall('pnx_test_registry_parity');
    assert(parity.same, `the palette and the MCP catalogue must be one list: ${parity.detail}`);
    assert(parity.count > 300, `expected the full catalogue, got ${parity.count}`);
    assert(parity.missingMetadata === 0,
      `${parity.missingMetadata} node types lack the metadata the editor builds controls from`);

    // The spec's own search examples, run against the registry the palette uses.
    assert(parity.swirlFindsCurl, `a human searching "swirl" must find Curl Noise, got ${parity.swirl}`);
    assert(parity.fadeFindsFading, `"fade" must surface fading tools, got ${parity.fade}`);
    return { ok: true, nodeTypes: parity.count };
  });

  await step('PNX acceptance: opening a Claude-built effect shows the real graph, editable', async () => {
    // The third acceptance test. Claude builds a non-trivial effect; the canvas must then show the
    // actual nodes that produced it — with typed sockets and working controls — not a placeholder.
    await vfxCall('pnx_new', { name: 'Claude Built', blank: true });
    const add = async (type, values) => (await vfxCall('pnx_add_node', { type, x: 0, y: 0, values })).nodeId;
    const link = (a, sa, b, sb) => vfxCall('pnx_connect', { fromNode: a, fromSocket: sa, toNode: b, toSocket: sb });

    // generation -> fields -> simulation -> material -> renderer, the exact chain the spec asks to trace.
    const sphere = await add('cadence.geometry.sphere', { radius: 1.2 });
    const em = await add('cadence.particles.emitter', { emitFrom: 'surface', rate: 80, lifetime: 1.8 });
    const curl = await add('cadence.noise.curl', { scale: 0.5 });
    const sim = await add('cadence.particles.simulate', { maxParticles: 2000, drag: 0.5 });
    const life = await add('cadence.time.normalizedAge', {});
    const grad = await add('cadence.color.sampleGradient', { gradient: { kind: 'color', stops: [{ u: 0, v: '#ffffff' }, { u: 1, v: '#203080' }] } });
    const mat = await add('cadence.material.surface', { blend: 'additive' });
    const spr = await add('cadence.render.sprite', { size: 0.4 });
    const out = await add('cadence.render.output', {});
    await link(sphere, 'out', em, 'shape');
    await link(em, 'out', sim, 'emitter');
    await link(curl, 'out', sim, 'force');
    await link(life, 'out', grad, 'position');
    await link(grad, 'out', mat, 'baseColor');
    await link(sim, 'out', spr, 'source');
    await link(mat, 'out', spr, 'material');
    await link(spr, 'out', out, 'passes');

    const view = await vfxCall('pnx_test_open_editor');
    assert(view.open, 'the procedural editor should open');
    assert(view.boxes === 9, `the canvas must draw the real nodes, expected 9 boxes got ${view.boxes}`);
    // The whole chain must be visible by name — not an "AI Effect" placeholder.
    const titles = view.titles.join(' | ');
    for (const expected of ['Sphere', 'Emitter', 'Curl Noise', 'Simulate Particles', 'Material', 'Sprite Renderer', 'Effect Output']) {
      assert(titles.includes(expected), `the graph must show "${expected}" — got: ${titles}`);
    }
    // Typed sockets, colour-coded, with editable controls.
    assert(view.sockets > 20, `expected many typed sockets, got ${view.sockets}`);
    assert(view.distinctSocketColours > 2, `sockets must be coloured by type, got ${view.distinctSocketColours}`);
    assert(view.controls > 5, `nodes must expose editable controls, got ${view.controls}`);
    assert(view.previews > 0, 'nodes that declare a preview should render one');

    // A human edit made while looking at Claude's graph must reach the render.
    await vfxCall('pnx_test_human_edit', { ops: [{ op: 'setValue', node: spr, socket: 'size', value: 0.9 }] });
    const back = await vfxCall('pnx_get_graph');
    assert(back.nodes.find((n) => n.id === spr).values.size === 0.9, 'the human edit to Claude\'s node must stick');

    await vfxCall('pnx_test_close_editor');
    return { ok: true, boxes: view.boxes, sockets: view.sockets, controls: view.controls };
  });

  await step('PNX: the starter graph a new user sees is laid out legibly', async () => {
    // The first procedural graph anyone opens, checked as a picture rather than as data. Every one of
    // these failed on the canvas's first real run: the authored coordinates predated the boxes having
    // one row per socket, so Normalized Age sat on top of Simulate Particles, and at the old node
    // width "Particle limit" and "Particle lifetime" both rendered as "Particle …".
    await vfxCall('pnx_new', { name: 'Layout Check' });
    const v = await vfxCall('pnx_test_open_editor');

    const overlaps = [];
    for (let i = 0; i < v.rects.length; i++) {
      for (let j = i + 1; j < v.rects.length; j++) {
        const a = v.rects[i], b = v.rects[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          overlaps.push(`${a.title} over ${b.title}`);
        }
      }
    }
    assert(overlaps.length === 0, `node boxes must not overlap: ${overlaps.join('; ')}`);
    assert(v.clipped.length === 0, `these socket labels are cut off and unreadable: ${v.clipped.join(', ')}`);
    assert(v.clippedValues.length === 0, `these values are cut off, so the number on screen is wrong: ${v.clippedValues.join(', ')}`);

    const closed = await vfxCall('pnx_test_close_editor');
    assert(closed.stale === 0, `closing the editor must remove it from the DOM, ${closed.stale} left`);
    return { ok: true, nodes: v.rects.length, labelsChecked: v.sockets };
  });

  await step('PNX: the editor status line tracks the frame, not just the last edit', async () => {
    // A brand-new procedural effect is built node-then-wire, so for an instant it is a graph whose
    // Effect Output has no passes. renderStatus() used to run only inside render() — a full DOM
    // rebuild — so the warning raised at that instant stayed in the header indefinitely, while the
    // effect drew hundreds of sprites and pnx_verify reported nothing at all wrong.
    //
    // Read from the DOM (pnx_test_open_editor.status), never by asking report() again: the bug was
    // never that the report was wrong, only that nothing had told the header to ask for it.
    await vfxCall('pnx_new', { name: 'Status Check' });

    await vfxCall('pnx_scrub', { frame: 0 });
    const atStart = await vfxCall('pnx_test_open_editor');
    assert(atStart.status, 'the editor must show a status line');
    assert(!/has-error/.test(atStart.status.className),
      `a fresh starter graph must not report an error: "${atStart.status.text}"`);

    // Forward to where the emitter has actually produced particles. The editor stays open, so nothing
    // rebuilds its DOM — only evaluation happens, which is exactly the path that used to update nothing.
    await vfxCall('pnx_scrub', { frame: 20 });
    const drawing = await vfxCall('pnx_test_open_editor');

    assert(drawing.status.text !== atStart.status.text,
      `the status line is frozen: it still reads "${atStart.status.text}" at frame 20, where the effect is drawing`);
    assert(!/has-warning|has-error/.test(drawing.status.className),
      `a working graph must not sit on a warning badge: "${drawing.status.text}" (${drawing.status.className})`);
    assert(/\d+\s*drawn/.test(drawing.status.text),
      `the status line should report what was drawn, got "${drawing.status.text}"`);

    // And the header must agree with the engine rather than with its own history.
    const verdict = await vfxCall('pnx_verify', {});
    const real = (verdict.diagnostics || []).filter((d) => d.severity !== 'info').length;
    const badged = /has-warning|has-error/.test(drawing.status.className);
    assert(real > 0 === badged,
      `the header and pnx_verify disagree: header "${drawing.status.text}" vs ${real} real diagnostics`);

    await vfxCall('pnx_test_close_editor');
    return { ok: true, atFrame0: atStart.status.text, atFrame20: drawing.status.text };
  });

  await step('PNX acceptance: the add palette searches the real registry', async () => {
    await vfxCall('pnx_new', { name: 'Palette Check' });
    const all = await vfxCall('pnx_test_palette', {});
    assert(all.opened, 'the add palette should open');
    assert(all.results > 20, `the palette should list the catalogue, got ${all.results}`);
    assert(all.hasDescriptions, 'every result needs a description');
    assert(all.hasCategories, 'every result needs its category');

    const swirl = await vfxCall('pnx_test_palette', { query: 'swirl' });
    assert(swirl.labels.some((l) => /curl|vortex/i.test(l)),
      `searching "swirl" in the palette must surface swirling motion, got ${swirl.labels.join(', ')}`);

    const bounce = await vfxCall('pnx_test_palette', { query: 'bounce' });
    assert(bounce.results > 0, 'searching "bounce" should find something');

    await vfxCall('pnx_test_close_editor');
    return { ok: true, total: all.results, swirl: swirl.labels.slice(0, 3) };
  });

  await step('Node editor: dragging a wire onto empty canvas opens the palette filtered to what fits, and choosing wires the node', async () => {
    await vfxCall('pnx_new', { name: 'Wire To Space' });
    const g0 = await vfxCall('pnx_get_graph');
    const sim = g0.nodes.find((n) => n.type.startsWith('cadence.particles.simulate'));
    assert(sim, 'the starter graph has a Simulate Particles node');
    await vfxCall('pnx_test_open_editor');
    const drop = await vfxCall('pnx_test_editor', { action: 'dragToSpace', nodeId: sim.id, io: 'out', socket: 'out' });
    assert(drop.ok, `releasing the wire on empty canvas opens the palette: ${JSON.stringify(drop)}`);
    assert(drop.rows > 5 && drop.rows < drop.total, `the palette is filtered to node types with a fitting socket (${drop.rows} of ${drop.total})`);
    assert(/fit/i.test(drop.placeholder), `the search box says what it is filtered to: ${drop.placeholder}`);
    assert(drop.fitBadges === drop.rows, 'every row names the socket the wire would land on');
    const linksBefore = g0.links.length;
    const chosen = await vfxCall('pnx_test_editor', { action: 'paletteChoose', query: 'Point Renderer' });
    assert(chosen.ok && /Point Renderer/.test(chosen.chosen), `Point Renderer is offered for a geometry wire: ${JSON.stringify(chosen.labels)}`);
    const g1 = await vfxCall('pnx_get_graph');
    const added = g1.nodes.find((n) => n.type.startsWith('cadence.render.point'));
    assert(added, 'the chosen node was created');
    assert(g1.links.length === linksBefore + 1 && g1.links.some((l) => l.from === `${sim.id}.out` && l.to === `${added.id}.source`), `and it is wired from the dragged socket: ${JSON.stringify(g1.links.slice(-1))}`);
    assert(chosen.selected.length === 1 && chosen.selected[0] === added.id, 'the new node is selected');
    assert(!chosen.paletteOpen, 'the palette closed');
    await vfxCall('vfx_undo');
    const g2 = await vfxCall('pnx_get_graph');
    assert(g2.nodes.length === g0.nodes.length && g2.links.length === linksBefore, 'one undo step removes the node and its wire together');
    await vfxCall('pnx_test_close_editor');
    return { ok: true, offered: drop.rows, of: drop.total };
  });

  await step('Node editor: auto-layout puts every node in a column by depth with no overlaps, and one undo restores the old positions', async () => {
    await vfxCall('pnx_new', { name: 'Layout' });
    const g0 = await vfxCall('pnx_get_graph');
    // scramble: pile three nodes on top of each other
    for (const n of g0.nodes.slice(0, 3)) await vfxCall('pnx_move_node', { nodeId: n.id, x: 100, y: 100 });
    const scrambled = await vfxCall('pnx_get_graph');
    const res = await vfxCall('pnx_auto_layout', {});
    assert(res.ok && res.overlaps.length === 0, `no overlaps after the layout: ${JSON.stringify(res.overlaps)}`);
    assert(res.columns >= 4, `the starter graph spans several columns, got ${res.columns}`);
    const g1 = await vfxCall('pnx_get_graph');
    const pos = new Map(g1.nodes.map((n) => [n.id, n]));
    const endOf = (ref) => pos.get(ref.slice(0, ref.lastIndexOf('.')));
    for (const l of g1.links) assert(endOf(l.from).x < endOf(l.to).x, `every wire runs left to right: ${l.from} → ${l.to}`);
    // the real boxes on the canvas agree: no two overlap
    const v = await vfxCall('pnx_test_open_editor');
    const overlaps = [];
    for (let i = 0; i < v.rects.length; i++) for (let j = i + 1; j < v.rects.length; j++) {
      const a = v.rects[i], b = v.rects[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps.push(`${a.title} over ${b.title}`);
    }
    assert(overlaps.length === 0, `the drawn boxes must not overlap: ${overlaps.join('; ')}`);
    // the toolbar button and Ctrl+L are the same command, and the palette finds it by name
    const pal = await vfxCall('pnx_test_palette', { query: 'arrange', keepOpen: false });
    assert(pal.labels[0] === 'Auto-layout', `the palette offers the command for "arrange": ${pal.labels.join(', ')}`);
    await vfxCall('pnx_test_close_editor');
    await vfxCall('vfx_undo');
    const g2 = await vfxCall('pnx_get_graph');
    const back = g2.nodes.every((n) => { const o = scrambled.nodes.find((m) => m.id === n.id); return o && o.x === n.x && o.y === n.y; });
    assert(back, 'one undo step restores every old position');
    return { ok: true, columns: res.columns, moved: res.moved };
  });

  await step('Node editor: the minimap shows every node and the view, and clicking it pans the canvas', async () => {
    await vfxCall('pnx_new', { name: 'Minimap' });
    const g = await vfxCall('pnx_get_graph');
    await vfxCall('pnx_test_open_editor');
    const m = await vfxCall('pnx_test_editor', { action: 'minimap' });
    assert(m.present && m.width > 100 && m.height > 60, `the minimap canvas is in the corner: ${JSON.stringify(m)}`);
    assert(m.rects === g.nodes.length, `it holds a rectangle per node (${m.rects} of ${g.nodes.length})`);
    assert(m.scale > 0, 'it has a world-to-map scale');
    const clicked = await vfxCall('pnx_test_editor', { action: 'minimap', clickAt: [0.05, 0.05] });
    assert(clicked.before.x !== clicked.after.x || clicked.before.y !== clicked.after.y, `clicking the top-left of the map pans the view: ${JSON.stringify([clicked.before, clicked.after])}`);
    assert(clicked.after.k === clicked.before.k, 'panning by the minimap keeps the zoom');
    await vfxCall('pnx_test_close_editor');
    return { ok: true, rects: m.rects };
  });

  await step('Node editor: selecting a node shows its help, and a Pro node carries the badge', async () => {
    await vfxCall('pnx_new', { name: 'Help Panel' });
    const g = await vfxCall('pnx_get_graph');
    const sim = g.nodes.find((n) => n.type.startsWith('cadence.particles.simulate'));
    const doc = await vfxCall('pnx_describe_node', { type: 'cadence.particles.simulate' });
    await vfxCall('pnx_test_open_editor');
    const idle = await vfxCall('pnx_test_editor', { action: 'help' });
    assert(idle.present && idle.visible && /Select a node/.test(idle.text) && /Ctrl\+L/.test(idle.text), `with nothing selected the panel teaches the keys: ${idle.text.slice(0, 80)}`);
    await vfxCall('pnx_test_editor', { action: 'select', nodeId: sim.id });
    const h = await vfxCall('pnx_test_editor', { action: 'help' });
    assert(h.title === doc.label, `the panel is titled by the node: ${h.title}`);
    assert(h.text.includes(doc.summary), 'it shows the summary');
    if (doc.teach) assert(h.text.includes(doc.teach), 'and the teach line');
    if (doc.explain) assert(h.text.includes(doc.explain.slice(0, 60)), 'and the explanation');
    assert(h.sections.includes('Common uses') && h.sections.includes('Inputs') && h.sections.includes('Outputs'), `sections: ${h.sections}`);
    assert(new RegExp(`Roblox: ${doc.exportSupport}`).test(h.exportLevel), `the export level is stated: ${h.exportLevel}`);
    assert(!h.pro, 'Simulate Particles is not a Pro node');
    const cloud = await vfxCall('pnx_add_node', { type: 'cadence.volume.cloud', x: 900, y: 600 });
    await vfxCall('pnx_test_editor', { action: 'select', nodeId: cloud.nodeId });
    const hp = await vfxCall('pnx_test_editor', { action: 'help' });
    assert(hp.pro && hp.title === 'Cloud', `a Pro node shows the badge: ${JSON.stringify([hp.title, hp.pro])}`);
    const hidden = await vfxCall('pnx_test_editor', { action: 'keys', keys: ['h'] });
    assert(hidden.helpVisible === false && !(await vfxCall('pnx_test_editor', { action: 'help' })).visible, 'H hides the panel');
    await vfxCall('pnx_test_editor', { action: 'keys', keys: ['h'] });
    await vfxCall('pnx_remove_node', { nodeId: cloud.nodeId });
    await vfxCall('pnx_test_close_editor');
    return { ok: true, title: h.title };
  });

  await step('Node editor: arrows walk the graph, Tab walks sockets, Enter wires by keyboard, Ctrl+D duplicates and Delete removes', async () => {
    await vfxCall('pnx_new', { name: 'Keyboard', blank: true });
    const a = await vfxCall('pnx_add_node', { type: 'cadence.geometry.sphere', x: 0, y: 0 });
    const b = await vfxCall('pnx_add_node', { type: 'cadence.render.mesh', x: 420, y: 0 });
    const c = await vfxCall('pnx_add_node', { type: 'cadence.render.output', x: 840, y: 0 });
    await vfxCall('pnx_test_open_editor');
    let st = await vfxCall('pnx_test_editor', { action: 'select', nodeId: a.nodeId });
    st = await vfxCall('pnx_test_editor', { action: 'keys', keys: ['ArrowRight'] });
    assert(st.selected.length === 1 && st.selected[0] === b.nodeId, `ArrowRight from the sphere selects the mesh renderer: ${JSON.stringify(st.selected)}`);
    st = await vfxCall('pnx_test_editor', { action: 'keys', keys: ['ArrowRight'] });
    assert(st.selected[0] === c.nodeId, 'and again reaches the output');
    st = await vfxCall('pnx_test_editor', { action: 'keys', keys: ['ArrowLeft', 'ArrowLeft'] });
    assert(st.selected[0] === a.nodeId, 'ArrowLeft twice is back at the sphere');
    st = await vfxCall('pnx_test_editor', { action: 'keys', keys: ['Tab'] });
    assert(st.focusSocket && st.focusSocket.nodeId === a.nodeId && st.focusSocket.io === 'out', `Tab focuses the sphere's output first: ${JSON.stringify(st.focusSocket)}`);
    const first = st.focusSocket.key;
    st = await vfxCall('pnx_test_editor', { action: 'keys', keys: ['Tab'] });
    assert(st.focusSocket.key !== first || st.focusSocket.io !== 'out', 'Tab again moves to the next socket');
    st = await vfxCall('pnx_test_editor', { action: 'keys', keys: [{ key: 'Tab', shift: true }] });
    assert(st.focusSocket.key === first && st.focusSocket.io === 'out', 'Shift+Tab steps back');
    st = await vfxCall('pnx_test_editor', { action: 'keys', keys: ['Enter'] });
    assert(st.kbWire && st.kbWire.nodeId === a.nodeId && st.kbWire.key === first, `Enter starts a wire from the focused socket: ${JSON.stringify(st.kbWire)}`);
    st = await vfxCall('pnx_test_editor', { action: 'keys', keys: ['ArrowRight'] });
    assert(st.selected[0] === b.nodeId && st.focusSocket && st.focusSocket.nodeId === b.nodeId && st.focusSocket.io === 'in', `arrowing to a node with a wire held focuses a socket that fits: ${JSON.stringify(st.focusSocket)}`);
    assert(st.focusSocket.key === 'source', `the geometry lands on the renderer's Geometry input: ${st.focusSocket.key}`);
    st = await vfxCall('pnx_test_editor', { action: 'keys', keys: ['Enter'] });
    assert(!st.kbWire, 'Enter completes the wire');
    let g = await vfxCall('pnx_get_graph');
    assert(g.links.some((l) => l.from === `${a.nodeId}.out` && l.to === `${b.nodeId}.source`), `the link exists in the graph: ${JSON.stringify(g.links)}`);
    st = await vfxCall('pnx_test_editor', { action: 'keys', keys: [{ key: 'd', ctrl: true }] });
    g = await vfxCall('pnx_get_graph');
    assert(g.nodes.length === 4 && st.selected.length === 1 && st.selected[0] !== b.nodeId, 'Ctrl+D duplicates the selected node and selects the copy');
    st = await vfxCall('pnx_test_editor', { action: 'keys', keys: ['Delete'] });
    g = await vfxCall('pnx_get_graph');
    assert(g.nodes.length === 3 && st.selected.length === 0, 'Delete removes it again');
    st = await vfxCall('pnx_test_editor', { action: 'keys', keys: ['ArrowDown'] });
    assert(st.selected.length === 1, 'an arrow with nothing selected picks the first node');
    await vfxCall('pnx_test_close_editor');
    return { ok: true };
  });

  // ---------------------------------------------------------------- the Effect Sheet (docs/effect-sheet.md)
  await step('Effect Sheet: the procedural inspector shows things, properties and vary menus', async () => {
    await vfxCall('pnx_new', { name: 'Sheet Smoketest' });
    await new Promise((r) => setTimeout(r, 400));
    const dom = await vfxCall('pnx_test_sheet_dom');
    assert(dom.mounted, 'the sheet is mounted in the inspector in procedural mode');
    assert(dom.cards === 1, `the starter draws one thing, got ${dom.cards}: ${dom.cardTitles}`);
    assert(/Sprite/.test(dom.cardTitles[0]), `the thing is the sprite renderer: ${dom.cardTitles[0]}`);
    assert(dom.rows >= 8, `rows for its properties, got ${dom.rows}`);
    assert(dom.varyButtons >= 6, `every value carries a vary menu, got ${dom.varyButtons}`);
    assert(dom.wiredVary >= 2, `wired slots (size, colour) are marked, got ${dom.wiredVary}`);
    assert(dom.named === 1, `Normalized Age is named once, got ${dom.named}`);
    assert(dom.clipped.length === 0, `labels must not clip: ${dom.clipped}`);
    assert(dom.overflow === 0, `${dom.overflow} elements overflow the panel width`);
    assert(/nodes/.test(dom.foot), `the foot line reports counts: ${dom.foot}`);
    // the same projection is what Claude reads
    const sheet = await vfxCall('pnx_sheet');
    assert(sheet.things.length === 1 && sheet.stats.reached === sheet.stats.nodes, `pnx_sheet reaches every node: ${JSON.stringify(sheet.stats)}`);
    assert(typeof sheet.text === 'string' && sheet.text.includes('«Normalized Age»'), 'the text view names the shared value');
    return { ok: true, rows: dom.rows, vary: dom.varyButtons };
  });

  await step('Effect Sheet: a menu choice builds real nodes, shows live thumbnails, and undoes', async () => {
    const sheet = await vfxCall('pnx_sheet', { text: false });
    const spr = sheet.things[0];
    const size = spr.rows.find((r) => r.key === 'size');
    assert(size && size.kind === 'source', 'the starter size is driven over life');
    const menu = await vfxCall('pnx_sheet_menu', { nodeId: spr.nodeId, socket: 'size' });
    assert(menu.kind === 'number', `size is a number slot: ${menu.kind}`);
    assert(menu.curated.length >= 8, `a number slot has a wide menu, got ${menu.curated.length}`);
    assert(menu.curated.some((e) => e.id === 'random') && menu.curated.some((e) => e.id === 'bySpeed'), 'random and by-speed are offered');
    assert(menu.curated.every((e) => e.roblox === null || typeof e.roblox === 'string'), 'every entry states its Roblox level');
    assert(menu.existing.some((x) => /Normalized Age/.test(x.label)), 'values already in the effect are offered');
    const before = (await vfxCall('pnx_get_graph')).nodes.length;
    const applied = await vfxCall('pnx_sheet_apply', { nodeId: spr.nodeId, socket: 'size', entry: 'random' });
    assert(applied.ok, `applying failed: ${JSON.stringify(applied.diagnostics)}`);
    const after = await vfxCall('pnx_get_graph');
    assert(after.nodes.length === before + 1 - 2 || after.nodes.length === before + 1, `random replaces the two life nodes with one random node (before ${before}, after ${after.nodes.length})`);
    const sheet2 = await vfxCall('pnx_sheet', { text: false });
    const size2 = sheet2.things[0].rows.find((r) => r.key === 'size');
    assert(size2.kind === 'source' && size2.variesWith.includes('random per particle'), `size now varies randomly: ${JSON.stringify(size2.variesWith)}`);
    // the menu a person sees: thumbnails are real renders of this effect with each choice applied
    await new Promise((r) => setTimeout(r, 300));
    const dom = await vfxCall('pnx_test_sheet_dom', { openMenu: true, waitMs: 900 });
    assert(dom.menu, 'clicking a vary button opens the source menu');
    assert(dom.menu.entries >= 6, `the menu has entries, got ${dom.menu.entries}`);
    assert(dom.menu.thumbs === dom.menu.entries, 'every entry has a thumbnail canvas');
    assert(dom.menu.lit >= Math.floor(dom.menu.entries / 2), `thumbnails must actually render (lit ${dom.menu.lit} of ${dom.menu.thumbs})`);
    assert(dom.menu.hasSearch, 'the anything-else search is present');
    assert(dom.menu.badges.length >= 4, 'entries carry Roblox badges');
    // one undo step
    await vfxCall('vfx_undo');
    const sheet3 = await vfxCall('pnx_sheet', { text: false });
    const size3 = sheet3.things[0].rows.find((r) => r.key === 'size');
    assert(size3.variesWith.includes('Normalized Age'), 'Ctrl+Z restores the over-life size');
    return { ok: true, entries: dom.menu.entries, lit: dom.menu.lit };
  });

  await step('Effect Sheet: adding a thing puts a second drawn thing on the sheet and on screen', async () => {
    const added = await vfxCall('pnx_sheet_add_thing', { thing: 'ring' });
    assert(added.ok && added.made && added.made.thing, `add thing failed: ${JSON.stringify(added.diagnostics)}`);
    const sheet = await vfxCall('pnx_sheet', { text: false });
    assert(sheet.things.length === 2, `two things now, got ${sheet.things.length}`);
    assert(sheet.things.every((t) => t.drawn), 'both are wired to the output');
    assert(sheet.stats.reached === sheet.stats.nodes, `every node reached: ${JSON.stringify(sheet.stats)}`);
    await vfxCall('pnx_scrub', { frame: 30 });
    await new Promise((r) => setTimeout(r, 250));
    const st = await vfxCall('pnx_get_state');
    assert(st.drawn && st.drawn.triangles > 0, `the ring draws triangles: ${JSON.stringify(st.drawn)}`);
    await new Promise((r) => setTimeout(r, 300));
    const dom = await vfxCall('pnx_test_sheet_dom');
    assert(dom.cards === 2, `two cards on the sheet, got ${dom.cards}`);
    await vfxCall('vfx_undo');
    return { ok: true, triangles: st.drawn.triangles };
  });
  await step('Fire & smoke: the sheet adds a real gas simulation, the raymarcher paints it, and the export bakes a flipbook', async () => {
    const added = await vfxCall('pnx_sheet_add_thing', { thing: 'fire' });
    assert(added.ok && added.made && added.made.thing, `add fire failed: ${JSON.stringify(added.diagnostics)}`);
    const sheet = await vfxCall('pnx_sheet', { text: false });
    const fire = sheet.things.find((t) => t.type.startsWith('cadence.render.volume'));
    assert(fire && fire.drawn, 'the Volume Renderer is a drawn thing on the sheet');
    assert(fire.exportSupport === 'baked', `its badge says baked, got ${fire.exportSupport}`);
    await vfxCall('pnx_scrub', { frame: 30 });
    await new Promise((r) => setTimeout(r, 400));
    const st = await vfxCall('pnx_get_state');
    assert(st.drawn && st.drawn.volumes === 1, `the backend drew one volume pass: ${JSON.stringify(st.drawn)}`);
    // pixels, not passes: the raymarch shader must compile and paint something in the box
    const probe = await vfxCall('pnx_test_volume_probe', { frame: 30, only: 'volume' });
    assert(probe.ok && probe.draws === 1, `probe drew the volume alone: ${JSON.stringify(probe)}`);
    assert(probe.programErrors.length === 0, `shader diagnostics: ${JSON.stringify(probe.programErrors)}`);
    assert(probe.lit > 150, `the fire lights pixels on a 240x150 canvas, got ${probe.lit}`);
    // the export classifies it as a flipbook bake and actually bakes the sheet
    const rep = await vfxCall('pnx_export_report');
    const row = rep.rows.find((r) => r.kind === 'volume');
    assert(row && row.level === 'baked' && /flipbook/i.test(row.how), `volume row: ${JSON.stringify(row)}`);
    const t0 = Date.now();
    const lua = await vfxCall('pnx_export_lua', { bakeStride: 2, maxBakedParticles: 100 });
    const ms = Date.now() - t0;
    assert(/PASTE_FLIPBOOK_ID/.test(lua.lua) && /Grid8x8/.test(lua.lua), 'the script carries the flipbook emitter');
    assert(lua.notes.some((n) => /flipbook/i.test(n)), 'and a note telling the user to save the PNG');
    assert(ms < 30000, `the bake finished in a reasonable time (${ms} ms)`);
    await vfxCall('vfx_undo');
    const after = await vfxCall('pnx_sheet', { text: false });
    assert(!after.things.some((t) => t.type.startsWith('cadence.render.volume')), 'undo removed the fire');
    return { ok: true, lit: probe.lit, bakeMs: ms };
  });
  await step('Effect Look: the sheet adds bloom & grade, the post pipeline switches on, undo switches it off, and a mesh thing exports as .obj', async () => {
    const added = await vfxCall('pnx_sheet_add_thing', { thing: 'look' });
    assert(added.ok && added.made && added.made.thing, `add look failed: ${JSON.stringify(added.diagnostics)}`);
    const sheet = await vfxCall('pnx_sheet', { text: false });
    const look = sheet.things.find((t) => t.type.startsWith('cadence.render.look'));
    assert(look && look.drawn && look.exportSupport === 'approximated', `the look is a drawn thing with an approximated badge: ${JSON.stringify(look && [look.drawn, look.exportSupport])}`);
    await vfxCall('pnx_scrub', { frame: 20 });
    await new Promise((r) => setTimeout(r, 300));
    const post = await vfxCall('pnx_test_post_state');
    assert(post.active === true, `the post pipeline is active: ${JSON.stringify(post)}`);
    assert(post.bloomEnabled === true, `bloom is on: ${JSON.stringify(post)}`);
    assert(post.passes === 4, `render → bloom → grade → output, got ${post.passes}`);
    // the composed frame still paints
    const shot = await vfxCall('vfx_render_frame', { frame: 20 });
    assert(typeof shot.image === 'string' && shot.image.length > 5000, 'the composed frame renders');
    // the export classifies the look and maps it to Lighting effects
    const rep = await vfxCall('pnx_export_report');
    const row = rep.rows.find((r) => r.kind === 'look');
    assert(row && row.level === 'approximated' && /Bloom/.test(row.how), `look row: ${JSON.stringify(row)}`);
    await vfxCall('vfx_undo');
    await vfxCall('pnx_scrub', { frame: 21 });
    await new Promise((r) => setTimeout(r, 300));
    const off = await vfxCall('pnx_test_post_state');
    assert(off.active === false, `undo removes the look and the plain path is back: ${JSON.stringify(off)}`);
    // a mesh thing exports as an .obj plus a mover script (the Pro key from the earlier step is active)
    const copies = await vfxCall('pnx_sheet_add_thing', { thing: 'copies' });
    assert(copies.ok && copies.made && copies.made.thing, `add copies failed: ${JSON.stringify(copies.diagnostics)}`);
    const lua = await vfxCall('pnx_export_lua', { bakeStride: 2 });
    assert(Array.isArray(lua.meshes) && lua.meshes.length >= 1, `the export carries an .obj: ${JSON.stringify(lua.meshes)}`);
    assert(lua.meshes[0].triangles > 0 && lua.meshes[0].bytes > 100, `the .obj has content: ${JSON.stringify(lua.meshes[0])}`);
    assert(/MeshPart/.test(lua.lua) && lua.lua.includes(lua.meshes[0].name), 'and the mover script asks for the MeshPart by name');
    await vfxCall('vfx_undo');
    return { ok: true, passes: post.passes, meshes: lua.meshes.length, triangles: lua.meshes[0].triangles };
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
    // Poll for the composite rather than sleeping a fixed 6s. Compositing downloads Roblox's own
    // templates and rasterises several canvases, so on a loaded machine it overruns any fixed wait —
    // this step failed on timing alone during a release run, which makes the gate untrustworthy
    // exactly when it is being relied on. Waiting for the CONDITION is also faster when idle.
    await waitFor(() => D.getInstance(item.id)?.parts.get('Left Arm')?.mesh.material.map?.image,
      'the R6 clothing composite');
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
    const expect = {
      UpperTorso: [388, 264], LowerTorso: [388, 264],
      LeftUpperArm: [264, 284], LeftHand: [264, 284],
      RightUpperLeg: [264, 284], RightFoot: [264, 284],
    };
    // R15 composites one canvas per body GROUP, and the groups finish independently — so the wait has
    // to cover every part the assertions below touch, not a representative few. Waiting on three of
    // them let the check run while LeftUpperLeg still had a null map, which reported as a null
    // dereference rather than as the timing problem it was.
    const inspected = [...Object.keys(expect), 'LeftUpperLeg'];
    await waitFor(() => {
      const i = D.getInstance(item15.id);
      return i && inspected.every((n) => i.parts.get(n)?.mesh.material.map?.image);
    }, 'the R15 per-group clothing composites');
    const inst15 = D.getInstance(item15.id);
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

  // ---------------------------------------------------------------- no part markers
  await step('rig parts carry no pale-blue marker; the whole part is the click target', async () => {
    // The Moon-style patches were removed on 2026-09-06 at the user's request. Selection must still
    // work through each part's invisible whole-part click box.
    const item = await D.addBuiltinRig('r6');
    await new Promise((r) => setTimeout(r, 1200));
    D.updateScene();
    const inst = D.getInstance(item.id);
    for (const [name, p] of inst.parts) {
      assert(!p.marker, `${name} still has a marker`);
      assert(p.selBox && p.selBox.userData.isSelBox && p.selBox.userData.partId === p.def.id, `${name} has no click box`);
    }
    let stray = 0;
    inst.group.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.type === 'PlaneGeometry' && o.material && o.material.color && o.material.color.getHex() === 0x8ed0e8) stray++; });
    assert(stray === 0, `${stray} pale-blue quads remain in the rig`);
    S.removeItem(item.id);
    return { ok: true, parts: inst.parts.size };
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

  // ---------------------------------------------------------------- semantic layer (ai/**)
  //
  // The layer itself is unit-tested in plain Node (`node test/aitest.mjs`, 99 checks). What can
  // ONLY be checked in the app is the boundary: `ai/kinematics.js` reimplements track evaluation
  // and the FK solve purely, because the originals live in modules that cannot be imported
  // outside Electron. Two implementations of the same maths drift. These steps are the gate that
  // catches it — see the header of renderer/js/ai/kinematics.js.

  await step('semantic layer: pure track evaluation agrees with state.js exactly', async () => {
    const AI = D.AI;
    S.newProject('cross-check');
    const item = await D.addBuiltinRig('r15');
    // Deliberately awkward: several easing styles, a bezier override, uneven spacing, and a
    // fractional key time — the cases where two evaluators are most likely to disagree.
    const keys = [
      { t: 0, v: CF.IDENTITY.slice(), es: 'Cubic', ed: 'Out' },
      { t: 3.5, v: CF.fromEuler(0.4, 0, 0), es: 'Elastic', ed: 'InOut', ep: { Period: 4 } },
      { t: 11, v: CF.fromEuler(0, 0.9, 0), es: 'Bounce', ed: 'Out' },
      { t: 12, v: CF.fromEuler(0.1, -0.3, 0.2), es: 'Linear', ed: 'Out', bez: [0.25, 0.1, 0.25, 1] },
      { t: 24, v: CF.fromEuler(-0.6, 0, 0.5), es: 'Back', ed: 'In' },
    ];
    for (const k of keys) S.setKey(item.id, 'RightShoulder', k.t, k.v, { es: k.es, ed: k.ed, bez: k.bez, ep: k.ep, noUndo: true });
    S.setKey(item.id, '@fov', 0, 70, { noUndo: true });

    const tracks = S.getTracks(item.id);
    let worstCF = 0, worstNum = 0, samples = 0;
    // Fractional steps as well as whole frames: state.js memoises only integer times, so the two
    // paths are genuinely different code between frames.
    for (let f = -3; f <= 30; f += 0.25) {
      const mine = AI.kinematics.evalTrackCF(tracks.RightShoulder, f);
      const theirs = S.evalTrackCF(item.id, 'RightShoulder', f);
      for (let i = 0; i < 12; i++) worstCF = Math.max(worstCF, Math.abs(mine[i] - theirs[i]));
      samples++;
    }
    for (let f = -2; f <= 5; f += 0.5) {
      worstNum = Math.max(worstNum, Math.abs(AI.kinematics.evalTrackNum(tracks['@fov'], f, 0) - S.evalTrackNum(item.id, '@fov', f, 0)));
    }
    assert(samples > 100, `expected a real sample grid, got ${samples}`);
    assert(worstCF === 0, `pure evalTrackCF drifted from state.js by ${worstCF} — ai/kinematics.js and state.js must stay identical`);
    assert(worstNum === 0, `pure evalTrackNum drifted from state.js by ${worstNum}`);
    return { samples, worstCF, worstNum };
  });

  await step('semantic layer: pure forward kinematics agrees with rigbuild.js solvePoseWorlds on every rig', async () => {
    const AI = D.AI;
    const results = {};
    for (const rigType of ['r6', 'r15', 'rthro', 'rthroSlender']) {
      S.newProject('fk-' + rigType);
      const item = await D.addBuiltinRig(rigType);
      const inst = D.getInstance(item.id);
      assert(inst && inst.solvePoseWorlds, `${rigType}: no instance to compare against`);

      // Pose several joints at once, including a world-space ("unparented") track, so the
      // comparison covers the branch that bypasses the parent chain rather than only the easy path.
      const motors = item.rig.joints.filter((j) => j.kind !== 'weld');
      for (let i = 0; i < motors.length; i += 3) {
        S.setKey(item.id, motors[i].name, 0, CF.IDENTITY.slice(), { noUndo: true });
        S.setKey(item.id, motors[i].name, 12, CF.fromEuler(0.3 + i * 0.05, -0.2, 0.15), { noUndo: true });
      }
      S.setKey(item.id, '@origin', 0, CF.setPosition(CF.IDENTITY.slice(), 2, 1, -3), { noUndo: true });

      let worst = 0, worstPart = null, compared = 0;
      for (const f of [0, 4, 7.5, 12, 20]) {
        const pose = S.evalPose(item, f);
        const origin = S.evalTrackCF(item.id, '@origin', f, item.origin);
        const theirs = inst.solvePoseWorlds(pose, origin, S.unparentedSet(item.id));

        const plan = AI.kinematics.buildSolvePlan(item.rig);
        const mine = AI.kinematics.solveWorlds(plan, AI.kinematics.evalPose(S.getTracks(item.id), f), origin, AI.kinematics.unparentedSet(S.getTracks(item.id)));

        for (const p of item.rig.parts) {
          const a = mine.get(p.id), b = theirs.get(p.id);
          assert(a && b, `${rigType}: ${p.id} missing from one solver at frame ${f}`);
          for (let i = 0; i < 12; i++) {
            const d = Math.abs(a[i] - b[i]);
            if (d > worst) { worst = d; worstPart = `${p.id}@${f}`; }
          }
          compared++;
        }
      }
      // Both solvers run the identical sequence of CF.mul calls on identical inputs, so this is an
      // exact-equality check, not a tolerance. A non-zero result means the two have genuinely
      // diverged in ORDER or in which joint drives which part — not that floating point drifted.
      assert(worst === 0, `${rigType}: pure FK drifted from rigbuild.js by ${worst} (worst at ${worstPart})`);
      results[rigType] = { compared, worst };
    }
    return results;
  });

  await step('semantic layer: the pure evaluator handles a world-space (unparented) track the same way', async () => {
    const AI = D.AI;
    S.newProject('unparented-cross-check');
    const item = await D.addBuiltinRig('r15');
    const inst = D.getInstance(item.id);
    S.setKey(item.id, 'RightWrist', 0, CF.IDENTITY.slice(), { noUndo: true });
    S.setKey(item.id, 'RightWrist', 10, CF.fromEuler(0.5, 0, 0), { noUndo: true });
    D.setUnparented(item.id, 'RightWrist', true);
    assert(S.trackSpace(item.id, 'RightWrist') === 'world', 'the track should now be in world space');

    let worst = 0;
    for (const f of [0, 5, 10]) {
      const theirs = inst.solvePoseWorlds(S.evalPose(item, f), S.evalTrackCF(item.id, '@origin', f, item.origin), S.unparentedSet(item.id));
      const tracks = S.getTracks(item.id);
      const mine = AI.kinematics.solveWorlds(
        AI.kinematics.buildSolvePlan(item.rig),
        AI.kinematics.evalPose(tracks, f),
        S.evalTrackCF(item.id, '@origin', f, item.origin),
        AI.kinematics.unparentedSet(tracks),
      );
      for (const p of item.rig.parts) {
        for (let i = 0; i < 12; i++) worst = Math.max(worst, Math.abs(mine.get(p.id)[i] - theirs.get(p.id)[i]));
      }
    }
    assert(worst === 0, `unparented solve drifted by ${worst}`);
    return { worst };
  });

  await step('semantic layer: every new MCP handler runs against the live project and returns its documented shape', async () => {
    S.newProject('mcp-semantic');
    const item = await D.addBuiltinRig('r15');
    S.setKey(item.id, 'RightHip', 0, CF.IDENTITY.slice(), { noUndo: true });
    S.setKey(item.id, 'RightHip', 10, CF.fromEuler(0.9, 0, 0), { noUndo: true });
    S.setKey(item.id, 'RightHip', 20, CF.IDENTITY.slice(), { noUndo: true });
    D.addCamera();

    const out = {};
    const scene = D.mcp('inspect_scene', { frame: 10 });
    assert(scene.objects.length === 2, `expected 2 objects, got ${scene.objects.length}`);
    assert(scene.capabilities.cannot.length >= 5, 'inspect_scene must report what the layer cannot do');
    assert(scene.objects[0].semantic_role === 'character', 'a rig should read as a character');
    out.scene = { objects: scene.objects.length, edges: scene.dependency_graph.edges.length };

    const rig = D.mcp('inspect_rig', {});
    assert(rig.counts.motors === 15, `expected 15 motors, got ${rig.counts.motors}`);
    assert(rig.validation.findings.length === 0, `r15 should validate clean, got: ${rig.validation.findings.map((f) => f.id).join(', ')}`);
    assert(rig.components.every((c) => c.joint_limits === null), 'joint_limits must be null (unknown), never a default');
    out.rig = { motors: rig.counts.motors, ikChains: rig.ik_chains.length };

    const tl = D.mcp('inspect_timeline', { itemId: item.id });
    assert(tl.time.fps === S.state.project.fps, 'the timeline must report the fps its seconds were derived with');
    assert(tl.counts.keys === 3, `expected 3 keys, got ${tl.counts.keys}`);
    out.timeline = tl.counts;

    const planted = D.mcp('resolve_semantic', { query: 'the planted foot', frame: 10 });
    assert(planted.matches.length === 1, 'the planted foot should resolve to exactly one part');
    assert(planted.matches[0].entityId === `part:${item.id}/LeftFoot`, `expected the left foot, got ${planted.matches[0].entityId}`);
    assert(planted.matches[0].certainty === 'highly_likely', 'a measured contact inference must never be reported as certain');
    out.planted = planted.matches[0].entityId;

    const weapon = D.mcp('resolve_semantic', { query: 'the weapon hand' });
    assert(weapon.resolved === false && weapon.question, 'with nothing held, the weapon hand must ask rather than guess');

    D.mcp('set_semantic_role', { itemId: item.id, kind: 'parts', key: 'RightHand', role: 'weapon', reason: 'smoketest' });
    const pinned = D.mcp('resolve_semantic', { query: 'the weapon' });
    assert(pinned.matches.length === 1 && pinned.matches[0].certainty === 'certain', 'a pinned role must resolve as certain');

    // snapshot → edit → diff → restore, the whole recoverable loop
    const snap = D.mcp('snapshot_scene', { reason: 'smoketest baseline', pinned: true });
    assert(D.mcp('snapshot_scene', { reason: 'again' }).deduplicated === true, 'an unchanged project must deduplicate');
    S.setKey(item.id, 'RightHip', 10, CF.fromEuler(0.2, 0, 0));
    const diff = D.mcp('diff_snapshots', { from: snap.id });
    assert(diff.tracks.length === 1 && diff.tracks[0].keys_modified.length === 1, `expected exactly one modified key, got ${JSON.stringify(diff.tracks)}`);
    assert(diff.changed_frame_range.start === 10 && diff.changed_frame_range.end === 10, 'the changed frame range must be exactly frame 10');
    const restored = D.mcp('restore_snapshot', { id: snap.id });
    assert(D.mcp('diff_snapshots', { from: snap.id }).identical, 'the project must match the snapshot exactly after a restore');
    assert(S.getItem(item.id), 'the restored project must still hold the rig');
    out.restore = { changes: restored.changes };

    // provenance survives the restore, because it lives inside the project
    const prov = D.mcp('inspect_provenance', {});
    assert(prov.nodes.length > 0, 'snapshot_scene and set_semantic_role should both have recorded provenance');
    const req = D.mcp('record_provenance', { type: 'request', summary: 'smoketest request' });
    const patch = D.mcp('record_provenance', { type: 'patch', summary: 'smoketest patch', parents: [req.id], entities: [`track:${item.id}/RightHip`] });
    const why = D.mcp('inspect_provenance', { nodeId: patch.id });
    assert(why.caused_by.some((n) => n.summary === 'smoketest request'), 'a patch must trace back to its request');
    const hist = D.mcp('inspect_provenance', { entity: `track:${item.id}/RightHip` });
    assert(hist.origins[0].request === 'smoketest request', 'historyOf must name the originating request');
    out.provenance = { nodes: prov.nodes.length };

    return out;
  });

  await step('semantic layer: project.semantics is undoable, but the provenance log inside it is not', async () => {
    // Regression guard for a real bug found while wiring set_semantic_role: state.js's snapshot()
    // clones an explicit field ALLOWLIST, `semantics` was not in it, and applySnapshot uses
    // Object.assign (which never deletes) -- so pushUndo() ran, changed nothing, and `undo` left
    // the role pin in place. The fix also has to get the OPPOSITE case right: provenance is
    // append-only history and must survive an undo, or undoing a change erases the record of the
    // change being undone.
    S.newProject('undo-semantics');
    const item = await D.addBuiltinRig('r15');
    const out = {};

    assert(!S.state.project.semantics || !S.state.project.semantics.roles, 'a fresh project should carry no role pins');
    D.mcp('set_semantic_role', { itemId: item.id, kind: 'parts', key: 'RightHand', role: 'weapon', reason: 'smoketest' });
    assert(D.mcp('resolve_semantic', { query: 'the weapon' }).matches[0].certainty === 'certain', 'the pin should resolve as certain');
    S.undo();
    assert(D.mcp('resolve_semantic', { query: 'the weapon' }).resolved === false,
      `undo must remove the pinned role, still saw ${JSON.stringify(S.state.project.semantics?.roles ?? null)}`);
    S.redo();
    assert(D.mcp('resolve_semantic', { query: 'the weapon' }).matches.length === 1, 'redo must restore the pinned role');

    // Undo must step back to the PREVIOUS pin, not clear everything.
    D.mcp('set_semantic_role', { itemId: item.id, kind: 'parts', key: 'LeftFoot', role: 'target' });
    assert(D.AI.roles.listOverrides(S.state.project).length === 2, 'two pins should be held');
    S.undo();
    const after = D.AI.roles.listOverrides(S.state.project);
    assert(after.length === 1 && after[0].key === 'RightHand', `undo should drop only the second pin, got ${JSON.stringify(after)}`);

    // Provenance survives an undo; the keyframe edit does not.
    const before = D.mcp('inspect_provenance', {}).stats.nodes;
    D.mcp('record_provenance', { type: 'note', summary: 'must survive an undo' });
    S.setKey(item.id, 'RightElbow', 5, CF.fromEuler(0.2, 0, 0));
    S.undo();
    assert(D.mcp('inspect_provenance', {}).stats.nodes >= before + 1, 'provenance must not be rewound by undo');
    assert(D.mcp('inspect_provenance', { contains: 'must survive' }).nodes.length === 1, 'the recorded node must still be findable');
    assert((S.getTrack(item.id, 'RightElbow')?.keys ?? []).every((k) => k.t !== 5), 'the keyframe edit itself must still be undone');
    out.provenance = { before, after: D.mcp('inspect_provenance', {}).stats.nodes };

    // Key annotations live under semantics too, and must undo the same way.
    S.pushUndo();
    S.state.project.semantics = S.state.project.semantics || {};
    S.state.project.semantics.annotations = { [item.id]: { RightElbow: { 5: { phase: 'impact' } } } };
    S.undo();
    assert(!S.state.project.semantics?.annotations, 'undo must remove a key annotation');
    assert(!!S.state.project.semantics?.provenance, 'that same undo must leave provenance intact');

    // A cleared pin must not come back on a later, unrelated undo.
    D.mcp('set_semantic_role', { itemId: item.id, kind: 'parts', key: 'RightHand', role: null });
    S.setKey(item.id, 'RightElbow', 9, CF.fromEuler(0.3, 0, 0));
    S.undo();
    assert(!D.AI.roles.listOverrides(S.state.project).some((o) => o.key === 'RightHand'),
      'an unrelated undo must not resurrect a cleared pin');
    return out;
  });

  await step('semantic layer: entity ids round-trip back to the live objects they name', async () => {
    const AI = D.AI;
    S.newProject('id-roundtrip');
    const item = await D.addBuiltinRig('r15');
    S.setKey(item.id, 'LeftElbow', 5, CF.fromEuler(0.3, 0, 0), { noUndo: true });
    const p = D.liveProject();
    const rig = D.mcp('inspect_rig', {});

    for (const node of rig.parts) {
      const back = AI.resolveEntity(p, node.id);
      assert(back && back.part.id === node.roblox_mapping.partId, `part id ${node.id} did not resolve back`);
    }
    for (const node of rig.components) {
      const back = AI.resolveEntity(p, node.id);
      assert(back && back.joint.name === node.roblox_mapping.jointName, `joint id ${node.id} did not resolve back`);
    }
    const keyBack = AI.resolveEntity(p, AI.ids.keyId(item.id, 'LeftElbow', 5));
    assert(keyBack && keyBack.key.t === 5, 'a key id must resolve back to the key');

    // The point of a derived joint id: it survives a rename, where a name-based id would not.
    const before = rig.components.find((c) => c.name === 'LeftElbow').id;
    const joint = item.rig.joints.find((j) => j.name === 'LeftElbow');
    joint.name = 'ElbowL_renamed';
    const after = D.mcp('inspect_rig', {}).components.find((c) => c.roblox_mapping.jointName === 'ElbowL_renamed').id;
    assert(before === after, `a joint id must survive a rename: ${before} became ${after}`);
    joint.name = 'LeftElbow';
    return { parts: rig.parts.length, joints: rig.components.length };
  });

  // ---------------------------------------------------------------- safe patch and rollback
  //
  // `ai/patch.js` writes into `project.tracks` itself, because `state.js` cannot be imported
  // outside Electron. That is the same duplication `ai/kinematics.js` carries and the same risk:
  // two implementations of the same mutation drift. This step is the gate — it makes the same
  // edits through both paths and compares the resulting project byte for byte.

  await step('semantic layer: the patch applier and state.js produce byte-identical project data', async () => {
    const AI = D.AI;
    const results = {};

    // Each case: a description, the state.js calls, and the equivalent patch ops. `noAutoZero` is
    // passed to state.js wherever a case keys at frame >= 1 on a fresh track, because the patch
    // layer deliberately does NOT reproduce that affordance and warns instead (see UI_AFFORDANCES).
    const cases = [
      {
        name: 'create keys with explicit easing',
        viaState: (id) => {
          S.setKey(id, 'RightShoulder', 0, CF.IDENTITY.slice(), { es: 'Cubic', ed: 'Out', noUndo: true, noAutoZero: true });
          S.setKey(id, 'RightShoulder', 8, CF.fromEuler(0, 0, 1.2), { es: 'Back', ed: 'In', ep: { Overshoot: 2 }, noUndo: true, noAutoZero: true });
          S.setKey(id, 'RightShoulder', 16, CF.fromEuler(0, 0, -0.9), { es: 'Elastic', ed: 'InOut', ep: { Period: 4, Amplitude: 1.2 }, noUndo: true, noAutoZero: true });
        },
        ops: (id) => [
          { op: 'set_key', itemId: id, track: 'RightShoulder', t: 0, value: CF.IDENTITY.slice(), es: 'Cubic', ed: 'Out' },
          { op: 'set_key', itemId: id, track: 'RightShoulder', t: 8, value: CF.fromEuler(0, 0, 1.2), es: 'Back', ed: 'In', ep: { Overshoot: 2 } },
          { op: 'set_key', itemId: id, track: 'RightShoulder', t: 16, value: CF.fromEuler(0, 0, -0.9), es: 'Elastic', ed: 'InOut', ep: { Period: 4, Amplitude: 1.2 } },
        ],
      },
      {
        name: 'modify an existing key, value only',
        setup: (id) => { S.setKey(id, 'RightHip', 0, CF.IDENTITY.slice(), { noUndo: true }); S.setKey(id, 'RightHip', 10, CF.fromEuler(0.9, 0, 0), { noUndo: true, noAutoZero: true }); },
        viaState: (id) => S.setKey(id, 'RightHip', 10, CF.fromEuler(0.2, 0, 0), { noUndo: true, noAutoZero: true }),
        ops: (id) => [{ op: 'set_key', itemId: id, track: 'RightHip', t: 10, value: CF.fromEuler(0.2, 0, 0) }],
      },
      {
        name: 'set easing, including the style-parameter pruning',
        setup: (id) => { S.setKey(id, 'RightHip', 0, CF.IDENTITY.slice(), { noUndo: true }); S.setKey(id, 'RightHip', 10, CF.fromEuler(0.9, 0, 0), { es: 'Back', ed: 'In', ep: { Overshoot: 3 }, noUndo: true, noAutoZero: true }); },
        viaState: (id) => S.setEasing([{ itemId: id, track: 'RightHip', t: 10 }], 'Quad', 'Out', undefined, { noUndo: true }),
        ops: (id) => [{ op: 'set_easing', itemId: id, track: 'RightHip', t: 10, es: 'Quad', ed: 'Out' }],
      },
      {
        name: 'delete a key',
        setup: (id) => { S.setKey(id, 'RightHip', 0, CF.IDENTITY.slice(), { noUndo: true }); S.setKey(id, 'RightHip', 10, CF.fromEuler(0.9, 0, 0), { noUndo: true, noAutoZero: true }); },
        viaState: (id) => S.deleteKeys([{ itemId: id, track: 'RightHip', t: 10 }]),
        ops: (id) => [{ op: 'delete_key', itemId: id, track: 'RightHip', t: 10 }],
      },
      {
        name: 'move a key onto empty space',
        setup: (id) => { S.setKey(id, 'RightHip', 0, CF.IDENTITY.slice(), { noUndo: true }); S.setKey(id, 'RightHip', 10, CF.fromEuler(0.9, 0, 0), { noUndo: true, noAutoZero: true }); },
        viaState: (id) => S.moveKeys([{ itemId: id, track: 'RightHip', t: 10 }], 4, { noUndo: true }),
        ops: (id) => [{ op: 'move_key', itemId: id, track: 'RightHip', t: 10, to: 14 }],
      },
      {
        name: 'move a key onto an occupied frame',
        setup: (id) => {
          S.setKey(id, 'RightHip', 0, CF.IDENTITY.slice(), { noUndo: true });
          S.setKey(id, 'RightHip', 10, CF.fromEuler(0.9, 0, 0), { noUndo: true, noAutoZero: true });
          S.setKey(id, 'RightHip', 14, CF.fromEuler(0.1, 0, 0), { noUndo: true, noAutoZero: true });
        },
        viaState: (id) => S.moveKeys([{ itemId: id, track: 'RightHip', t: 10 }], 4, { noUndo: true }),
        ops: (id) => [{ op: 'move_key', itemId: id, track: 'RightHip', t: 10, to: 14 }],
      },
      {
        name: 'move a key past the end of the timeline (both must clamp)',
        setup: (id) => { S.setKey(id, 'RightHip', 0, CF.IDENTITY.slice(), { noUndo: true }); S.setKey(id, 'RightHip', 10, CF.fromEuler(0.9, 0, 0), { noUndo: true, noAutoZero: true }); },
        viaState: (id) => S.moveKeys([{ itemId: id, track: 'RightHip', t: 10 }], 5000, { noUndo: true }),
        ops: (id) => [{ op: 'move_key', itemId: id, track: 'RightHip', t: 10, to: 5010 }],
      },
      {
        name: 'move a grouped key (both must retarget the group entry)',
        setup: (id) => {
          S.setKey(id, 'RightHip', 0, CF.IDENTITY.slice(), { noUndo: true });
          S.setKey(id, 'RightHip', 10, CF.fromEuler(0.9, 0, 0), { noUndo: true, noAutoZero: true });
          S.setKey(id, 'RightElbow', 0, CF.IDENTITY.slice(), { noUndo: true });
          S.setKey(id, 'RightElbow', 10, CF.fromEuler(0.4, 0, 0), { noUndo: true, noAutoZero: true });
          // Grouped so that state.js's own moveKeys pulls in the sibling — the patch layer moves
          // only what it names, so this case moves BOTH explicitly to compare like with like.
          S.groupKeys([{ itemId: id, track: 'RightHip', t: 10 }, { itemId: id, track: 'RightElbow', t: 10 }]);
        },
        viaState: (id) => S.moveKeys([{ itemId: id, track: 'RightHip', t: 10 }], 3, { noUndo: true }),
        ops: (id) => [
          { op: 'move_key', itemId: id, track: 'RightHip', t: 10, to: 13 },
          { op: 'move_key', itemId: id, track: 'RightElbow', t: 10, to: 13 },
        ],
      },
      {
        name: 'remove a track',
        setup: (id) => { S.setKey(id, 'RightHip', 0, CF.IDENTITY.slice(), { noUndo: true }); S.setKey(id, 'RightHip', 10, CF.fromEuler(0.9, 0, 0), { noUndo: true, noAutoZero: true }); },
        viaState: (id) => S.removeTrack(id, 'RightHip'),
        ops: (id) => [{ op: 'remove_track', itemId: id, track: 'RightHip' }],
      },
      {
        name: 'add and edit an event marker',
        viaState: (id) => { S.addMarker(id, 16, { name: 'impact', width: 2, codeBegin: 'print("hit")' }); S.setMarker(id, 16, { width: 5 }); },
        ops: (id) => [
          { op: 'set_marker', itemId: id, t: 16, patch: { name: 'impact', width: 2, codeBegin: 'print("hit")' } },
          { op: 'set_marker', itemId: id, t: 16, patch: { width: 5 } },
        ],
      },
      {
        name: 'unparent a track (the flag only — state.js converts values, so none are compared)',
        setup: (id) => { S.setKey(id, 'RightWrist', 0, CF.IDENTITY.slice(), { noUndo: true }); },
        viaState: (id) => S.setTrackSpace(id, 'RightWrist', 'world', null),
        ops: (id) => [{ op: 'set_track_space', itemId: id, track: 'RightWrist', space: 'world' }],
      },
    ];

    // Only the animation data is compared, and item UUIDs are replaced by their INDEX first --
    // every project gets fresh `crypto.randomUUID()` item ids, and the track/marker tables are
    // keyed by them, so comparing raw would fail on identity rather than on behaviour.
    const animationData = (p) => {
      const index = new Map(p.items.map((i, n) => [i.id, `item${n}`]));
      const rekey = (table) => Object.fromEntries(Object.entries(table || {}).map(([id, v]) => [index.get(id) ?? id, v]));
      return {
        tracks: rekey(p.tracks),
        markers: rekey(p.markers),
        groups: (p.groups || []).map((g) => ({ keys: (g.keys || []).map((k) => ({ ...k, itemId: index.get(k.itemId) ?? k.itemId })) })),
        items: p.items.map((i) => ({ name: i.name, kind: i.kind, origin: i.origin, hidden: i.hidden ?? null })),
        length: p.length, fps: p.fps, loop: p.loop, priority: p.priority,
      };
    };

    for (const c of cases) {
      // Path A: state.js's own mutators.
      S.newProject('drift-state-' + c.name);
      const a = await D.addBuiltinRig('r15');
      if (c.setup) c.setup(a.id);
      c.viaState(a.id);
      const viaState = AI.hash.contentHash(animationData(S.state.project));

      // Path B: the same edits as a patch, through plan + commit.
      S.newProject('drift-patch-' + c.name);
      const b = await D.addBuiltinRig('r15');
      if (c.setup) c.setup(b.id);
      const patch = AI.makePatch({ ops: c.ops(b.id), intent: c.name });
      const plan = AI.planPatch(S.state.project, patch);
      assert(plan.applicable, `${c.name}: the patch was refused — ${plan.summary}`);
      AI.commitPatch(S.state.project, patch, plan);
      const viaPatch = AI.hash.contentHash(animationData(S.state.project));

      assert(viaState === viaPatch, `${c.name}: ai/patch.js and state.js produced DIFFERENT project data (${viaState} vs ${viaPatch}) — the two implementations of the same mutation have drifted`);

      // …and the inverse must apply cleanly on top of the committed state. (That it restores the
      // project EXACTLY is asserted by the next step, on a project with more in it.)
      const invPlan = AI.planPatch(S.state.project, plan.inverse);
      assert(invPlan.applicable, `${c.name}: the inverse patch does not apply — ${invPlan.summary}`);
      AI.commitPatch(S.state.project, plan.inverse, invPlan);
      results[c.name] = { identical: true, inverseApplies: true };
    }
    return { cases: Object.keys(results).length };
  });

  await step('semantic layer: the inverse of a patch restores the project exactly, in the live app', async () => {
    const AI = D.AI;
    S.newProject('inverse-roundtrip');
    const item = await D.addBuiltinRig('r15');
    D.addCamera();
    S.setKey(item.id, 'RightShoulder', 0, CF.IDENTITY.slice(), { noUndo: true });
    S.setKey(item.id, 'RightShoulder', 16, CF.fromEuler(0, 0, 1.2), { es: 'Back', ed: 'In', ep: { Overshoot: 2 }, noUndo: true });
    S.addMarker(item.id, 16, { name: 'impact', width: 2 });

    const originalName = S.getItem(item.id).name;
    const origin = AI.hash.contentHash(D.AI.snapshot.withoutHistory(S.state.project));
    const patch = AI.makePatch({ intent: 'a bit of everything', ops: [
      { op: 'set_key', itemId: item.id, track: 'RightShoulder', t: 6, value: CF.fromEuler(0, 0, -0.4) },
      { op: 'set_easing', itemId: item.id, track: 'RightShoulder', t: 16, es: 'Quad', ed: 'Out' },
      { op: 'move_key', itemId: item.id, track: 'RightShoulder', t: 16, to: 18 },
      { op: 'set_marker', itemId: item.id, t: 16, patch: { name: 'IMPACT' } },
      { op: 'set_item_field', itemId: item.id, path: 'name', value: 'Hero (heavy)' },
      { op: 'set_project_field', path: 'length', value: 120 },
    ] });
    const plan = AI.planPatch(S.state.project, patch);
    assert(plan.applicable, plan.summary);
    AI.commitPatch(S.state.project, patch, plan);
    assert(AI.hash.contentHash(D.AI.snapshot.withoutHistory(S.state.project)) === plan.result_hash, 'the committed state must match the planned hash exactly');
    assert(S.getItem(item.id).name === 'Hero (heavy)', 'the item field must actually have changed');

    const invPlan = AI.planPatch(S.state.project, plan.inverse);
    AI.commitPatch(S.state.project, plan.inverse, invPlan);
    const back = AI.hash.contentHash(D.AI.snapshot.withoutHistory(S.state.project));
    assert(back === origin, `the inverse did not restore the project exactly (${back} vs ${origin})`);
    assert(S.getItem(item.id).name === originalName, `the item name must be back (expected "${originalName}", got "${S.getItem(item.id).name}")`);
    assert(S.state.project.length === 90, 'the timeline length must be back');
    assert(S.getMarker(item.id, 16).name === 'impact', 'the marker name must be back');
    assert(S.getKey(item.id, 'RightShoulder', 16).ep.Overshoot === 2, 'the pruned easing parameter must be back');
    return { operations: patch.ops.length, inverseOperations: plan.inverse.ops.length };
  });

  await step('semantic layer: preview → refusal → apply → scoped rollback, through the real MCP tools', async () => {
    S.newProject('phase2-loop');
    const item = await D.addBuiltinRig('r15');
    D.addCamera(); // returns nothing; the item is the only camera in this project
    const cam = S.state.project.items.find((i) => i.kind === 'camera');
    S.setKey(item.id, 'RightShoulder', 0, CF.IDENTITY.slice(), { noUndo: true });
    S.setKey(item.id, 'RightShoulder', 16, CF.fromEuler(0, 0, 1.2), { noUndo: true });
    S.setKey(item.id, 'RightHip', 0, CF.IDENTITY.slice(), { noUndo: true });
    S.setKey(item.id, 'RightHip', 16, CF.fromEuler(0.6, 0, 0), { noUndo: true });
    S.addMarker(item.id, 16, { name: 'impact', width: 2, codeBegin: 'print("hit")' });
    const out = {};

    // 1. A dry run changes nothing, and proves it.
    const before = D.AI.hash.contentHash(D.AI.snapshot.withoutHistory(S.state.project));
    const constrain = {
      allow: ['the hips', 'the right shoulder'],
      protect_frames: [{ frame: 16, tolerance: 1, reason: 'the impact' }],
      contacts: [{ effector: 'the left foot', from: 12, to: 23, tolerance_studs: 0.07 }],
      text: 'do not change the camera; make it feel heavier',
    };
    const ops = [
      { op: 'set_key', itemId: item.id, track: 'RightHip', t: 6, value: CF.fromEuler(0.3, 0, 0) },
      { op: 'set_key', itemId: item.id, track: 'RightShoulder', t: 6, value: CF.fromEuler(0, 0, -0.4) },
    ];
    const pv = D.mcp('preview_animation_patch', { ops, intent: 'heavier windup', request: 'make the windup heavier', constrain });
    assert(pv.state_unchanged === true, 'a preview must not change the project');
    assert(D.AI.hash.contentHash(D.AI.snapshot.withoutHistory(S.state.project)) === before, 'the project hash changed during a preview');
    assert(pv.blocked === false, `the preview should be allowed: ${pv.summary}`);
    assert(pv.scope.breadth.verdict === 'local', `expected a local scope, got ${pv.scope.breadth.verdict}`);
    assert(pv.scope.dependent_parts.length > 0, 'the scope must name the parts that move as a consequence');
    assert(pv.constraint_compilation.unparsed.length === 1, 'the unrecognised constraint line must be reported, not swallowed');
    // Before MOT-008 this asserted the contact landed in `not_checked`. It is measured now, so the
    // assertion inverts: a declared contact must NOT be reported as unchecked, and a right-side
    // edit must not be reported as breaking a left-foot contact it never touched.
    assert(!pv.constraints_checked.not_checked.some((s) => /contact_drift/.test(s)), 'contact drift is implemented — it may no longer be reported as unchecked');
    assert(pv.constraints_checked.violations.length === 0, 'the left foot does not move in this edit, so the contact must be clean');
    out.preview = { txn: pv.transaction_id, scope: pv.scope.summary };

    // 2. A patch that breaks a compiled constraint is refused, and nothing changes.
    const badOps = [{ op: 'set_key', itemId: cam.id, track: '@fov', t: 6, value: 40 }];
    const refused = D.mcp('apply_animation_patch', { ops: badOps, intent: 'push in', constrain });
    assert(refused.applied === false && refused.refused === true, 'a camera edit must be refused under "do not change the camera"');
    assert(refused.failure_behaviour.state_preserved === true && refused.failure_behaviour.partial_result_applied === false);
    assert(D.AI.hash.contentHash(D.AI.snapshot.withoutHistory(S.state.project)) === before, 'a refused apply must leave the project untouched');
    out.refused = refused.reason;

    // 3. The allowed patch applies, transactionally.
    const applied = D.mcp('apply_animation_patch', { ops, intent: 'heavier windup', request: 'make the windup heavier', constrain });
    assert(applied.applied === true, `the apply should have succeeded: ${applied.summary}`);
    assert(applied.validation.committed_hash_matches_plan === true, 'the committed state must match the plan');
    assert(applied.rollback.available === true && applied.rollback.tool.includes(applied.transaction_id));
    assert(S.getKey(item.id, 'RightHip', 6), 'the hip key must exist after the apply');
    assert(S.getKey(item.id, 'RightShoulder', 6), 'the shoulder key must exist after the apply');
    assert(applied.before_snapshot, 'the before-state must have been snapshotted');
    out.applied = { txn: applied.transaction_id, frames: applied.changed_frame_range };

    // 4. Provenance recorded it, and the transaction is inspectable.
    const prov = D.mcp('inspect_provenance', { type: 'patch' });
    assert(prov.nodes.some((n) => n.summary.includes(applied.transaction_id)), 'the apply must be recorded in provenance');
    const insp = D.mcp('inspect_transaction', { transactionId: applied.transaction_id, compareSnapshots: true });
    assert(insp.inverse_operations.length === 2, `expected 2 inverse operations, got ${insp.inverse_operations.length}`);
    assert(insp.baseline_comparison.compared === false && /create_baseline/.test(insp.baseline_comparison.reason),
      'an uncompared transaction must say how a comparison would be made — "not compared" and "compared, and clean" are different claims');
    assert(insp.comparison.tracks.length === 2, 'the before/after snapshots must differ on both tracks');
    assert(insp.comparison.methods_unavailable.length >= 3, 'the comparison must name the methods it could not use');

    // 5. Scoped rollback: the hip only.
    const partial = D.mcp('rollback_transaction', { transactionId: applied.transaction_id, track: 'RightHip' });
    assert(partial.rolled_back === true && partial.complete === false, 'a scoped rollback must report itself as incomplete');
    assert(!S.getKey(item.id, 'RightHip', 6), 'the hip key must be gone');
    assert(S.getKey(item.id, 'RightShoulder', 6), 'the shoulder key must remain');
    assert(partial.still_applied.length === 1, 'the report must name what is still applied');
    out.scopedRollback = { undone: partial.undone, stillApplied: partial.still_applied };

    // 6. Roll back the rest, and land exactly where we started.
    const rest = D.mcp('rollback_transaction', { transactionId: applied.transaction_id });
    assert(rest.rolled_back === true && rest.complete === true, 'the remainder must roll back');
    assert(D.AI.hash.contentHash(D.AI.snapshot.withoutHistory(S.state.project)) === before, 'after a full rollback the project must be byte-identical to its pre-patch state');
    assert(D.mcp('list_transactions', {}).transactions.some((t) => t.transaction_id === applied.transaction_id && t.status === 'rolled_back'));

    // 7. …and Ctrl+Z still works on top of all of it, coarsely.
    // The last operation was the remainder-rollback, which removed the SHOULDER key (the hip one
    // was already gone from the scoped rollback before it). Undo steps back exactly one operation.
    S.undo();
    assert(S.getKey(item.id, 'RightShoulder', 6), 'whole-project undo must reverse the last rollback');
    assert(!S.getKey(item.id, 'RightHip', 6), 'undo steps back one operation, not two');
    S.redo();
    assert(!S.getKey(item.id, 'RightShoulder', 6), 'redo must re-apply the rollback');
    return out;
  });

  // The Phase 4 success condition (directive Part 62): "Cadence can explain what changed after a
  // scoped edit." This is the only place the observation layer runs against a real GPU — the
  // module tests in test/aitest.mjs feed it hand-drawn byte buffers, which proves the comparison
  // maths and proves nothing whatsoever about whether three.js hands back the pixels this code
  // thinks it does. Specifically at risk here and nowhere else: that the object-ID pass round-trips
  // its indices through a render target without colour management corrupting them, that the
  // silhouette excludes the ground, grid, handles and (crucially) the invisible-but-`visible: true`
  // selection boxes, and that a pass reads the pose it was asked for rather than the previous one.
  await step('observation: baseline → scoped edit → explain → roll back, against real rendered passes', async () => {
    S.newProject('phase4-loop');
    const item = await D.addBuiltinRig('r15');
    S.setKey(item.id, 'RightShoulder', 0, CF.IDENTITY.slice(), { noUndo: true });
    S.setKey(item.id, 'RightShoulder', 16, CF.fromEuler(0, 0, 0.9), { noUndo: true });
    S.setKey(item.id, 'RightHip', 0, CF.IDENTITY.slice(), { noUndo: true });
    S.setKey(item.id, 'RightHip', 16, CF.fromEuler(0.5, 0, 0), { noUndo: true });
    const out = {};

    // 1. The policy answers before anything is rendered: an identical pair needs no render at all.
    const quiet = D.mcp('plan_observation', {});
    assert(quiet.recommended.passes.length === 0, 'an unchanged project must not be worth a render');
    assert(quiet.passes_unavailable.length >= 15 && quiet.passes_unavailable.every((p) => p.unblocked_by),
      'every Part 43 pass this build lacks must be named with what blocks it');

    // 2. A baseline: a pinned snapshot plus two real rendered passes at frame 16.
    const made = await D.mcp('create_baseline', { name: 'before the wind-up', frames: [16], reason: 'phase 4 smoketest' });
    const bl = made.baseline;
    assert(bl.observations.length === 2, `expected a silhouette and an object-ID observation, got ${bl.observations.length}`);
    assert(made.subjects_rendered >= 15, `an R15 rig should put 15+ part meshes in the pass, got ${made.subjects_rendered}`);
    assert(bl.camera && bl.camera.source === 'viewport', 'a baseline must record the viewpoint it was rendered from');
    assert(bl.unavailable.length === 4 && bl.unavailable.every((u) => u.reason.length > 40),
      'the Part 44 fields Cadence cannot fill must each carry a real reason');
    assert(bl.frame_rate === S.state.project.fps, 'the baseline must pin the frame rate it was taken at');
    out.baseline = { id: bl.id, observations: bl.observations.length, subjects: made.subjects_rendered };

    // The silhouette must contain the rig and NOT the ground plane, the grid or the per-part
    // selection boxes — those are all in the scene and all would render solid under a flat
    // override material. A full-frame silhouette is the failure this catches.
    const sil = bl.observations.find((o) => o.pass === 'silhouette');
    const lit = sil.signature.cells.filter((c) => c > 8).length;
    assert(lit > 0, 'the silhouette pass drew nothing at all — the subject set or the render target is wrong');
    assert(lit < sil.signature.cells.length, `the silhouette covers the whole frame (${lit}/${sil.signature.cells.length} blocks) — the ground, grid or selection boxes leaked into the pass`);
    // `lit < 256` only catches a leak that fills the ENTIRE frame. The ground plane is the likely
    // leak and it covers roughly the lower half, so bound this properly: an R15 rig framed by the
    // default camera lights 19 of 256 blocks on this machine. The window is wide enough to absorb
    // GPU and framing variation and still far below anything that has the ground or grid in it.
    assert(lit >= 8 && lit <= 64,
      `the silhouette lit ${lit}/${sil.signature.cells.length} blocks; expected 8..64 for a lone R15 rig — above that something (ground, grid, gizmo, or the opacity-0 selection boxes) is rendering into the pass, below it the rig is barely in frame`);
    out.silhouetteBlocks = `${lit}/${sil.signature.cells.length}`;

    // Taking a baseline must not itself register as an edit (ai/snapshot.js NOT_STATE).
    const selfCheck = await D.mcp('explain_change', { baselineId: bl.id, request: 'did taking the baseline change anything?' });
    assert(selfCheck.differences.length === 0, `a baseline compared against its own state must find nothing, found: ${selfCheck.header}`);
    assert(selfCheck.visual_difference.comparisons.every((c) => c.method === 'digest' && !c.changed),
      'two renders of the same pose must be byte-identical — if they are not, no comparison in this system means anything');

    // 3. A scoped edit, through the real transactional path.
    const applied = D.mcp('apply_animation_patch', {
      ops: [{ op: 'set_key', itemId: item.id, track: 'RightShoulder', t: 16, value: CF.fromEuler(0, 0, 1.9) }],
      intent: 'wind up further', request: 'push the wind-up further',
    });
    assert(applied.applied === true, `the edit should have applied: ${applied.summary}`);

    // 4. Explain it. This is the success condition.
    const ex = await D.mcp('explain_change', { baselineId: bl.id, request: 'what did that change?' });
    out.explanation = { header: ex.header, counts: ex.classification_counts };

    assert(ex.snapshot_availability.available === true, 'the pinned baseline snapshot must still be held');
    assert(ex.classification_counts.unexpected === 0, `nothing should be unexpected: ${JSON.stringify(ex.classification_counts)}`);
    assert(ex.classification_counts.expected >= 2, 'both the curve change and the visual change should be explained');

    const curve = ex.differences.find((d) => d.kind === 'curve');
    assert(curve, 'the keyframe change must be reported as a difference');
    assert(curve.explained_by_transaction[0].transaction_id === applied.transaction_id,
      'the curve difference must name the transaction that made it');
    assert(curve.when_did_it_change.frames[0] === 16, 'it must say WHEN');

    // The silhouette moved, and by a measured amount rather than a boolean.
    const silDiff = ex.visual_difference.comparisons.find((c) => c.pass === 'silhouette');
    assert(silDiff.changed === true, 'rotating a shoulder by a radian must move the silhouette');
    assert(!silDiff.degraded, 'the baseline rasters are still in memory, so this must be a full-resolution comparison');
    assert(silDiff.displacement_px > 1, `the outline should have measurably moved, got ${silDiff.displacement_px}px`);
    assert(silDiff.region && silDiff.region.width < 192 && silDiff.region.height < 192,
      'a shoulder edit must localise to part of the frame, not all of it');
    out.silhouette = { displacement: silDiff.displacement_px, region: silDiff.region };

    // The object-ID pass names WHICH parts moved, and they are the ones below the edited joint.
    const idDiff = ex.visual_difference.comparisons.find((c) => c.pass === 'object_id');
    assert(idDiff.trustworthy === true, 'every pixel in the ID pass must be attributable — colour management is corrupting the indices if not');
    assert(idDiff.objects_moved.length > 0, 'the ID pass must name the parts that moved');
    // The palette must mint the SAME ids ai/ids.js does, or nothing in the ID pass can be joined
    // to anything else in the system — parseId returning null is that failure, not a formatting nit.
    const movedNames = idDiff.objects_moved.map((m) => {
      const parsed = D.AI.ids.parseId(m.entity);
      assert(parsed && parsed.type === 'part', `the ID palette minted "${m.entity}", which ai/ids.js cannot parse back to a part`);
      return parsed.partId;
    });
    assert(movedNames.some((n) => /RightLowerArm|RightHand|RightUpperArm/.test(n)),
      `the arm below the edited shoulder must be among the movers, got: ${movedNames.join(', ')}`);
    assert(!movedNames.some((n) => /LeftFoot|LeftLowerLeg/.test(n)),
      `nothing on the far side of the body should move for a right-shoulder edit, got: ${movedNames.join(', ')}`);
    out.movedParts = movedNames;

    // Each moved object is classified on its own. A part below the edited joint is EXPECTED, but
    // only highly likely — propagation is structural inference and must never be reported as
    // certain. A part the arm swings ACROSS changes its visible pixels without moving, and that
    // occlusion case must come back uncertain-with-a-reason rather than as a regression: an R15
    // arm sweeping a radian crosses the torso, so this is not hypothetical.
    const perObject = ex.differences.filter((d) => d.kind === 'object_id_shift');
    assert(perObject.length === idDiff.objects_moved.length, 'each moved object must be its own difference');
    const armDiff = perObject.find((d) => /RightUpperArm|RightLowerArm|RightHand/.test(d.where_did_it_change.entity));
    assert(armDiff.classification === 'expected' && armDiff.classification_certainty === 'highly_likely',
      `a propagated mover must be expected-but-inferred, got ${armDiff.classification}/${armDiff.classification_certainty}`);
    const occluded = perObject.filter((d) => d.classification === 'uncertain');
    for (const d of occluded) {
      assert(/partly hidden by one that moved/.test(d.classification_reason), 'an unattributed on-screen change must offer the occlusion explanation');
    }
    if (occluded.length) {
      const cause = ex.ranked_causes.find((c) => c.kind === 'occlusion');
      assert(cause && cause.distinguishing_evidence.some((s) => /depth pass/.test(s)),
        'occlusion must be a ranked cause naming the pass that would settle it');
    }
    out.occlusionSuspects = occluded.map((d) => D.AI.ids.parseId(d.where_did_it_change.entity)?.partId);

    // Part 55's baseline_comparison is no longer a placeholder.
    const insp = D.mcp('inspect_transaction', { transactionId: applied.transaction_id });
    assert(insp.baseline_comparison.compared === true, 'the comparison must be written back onto the transaction');
    assert(insp.baseline_comparison.differences_explained_by_this_transaction >= 1);
    assert(insp.approval_status === 'not_requested', 'a comparison is not an approval');

    // 5. Approving a difference retires it as a finding.
    D.mcp('approve_difference', { baselineId: bl.id, target: curve.where_did_it_change.entity, kind: 'curve', reason: 'the bigger wind-up is the point of the edit', author: 'user' });
    const after = await D.mcp('explain_change', { baselineId: bl.id });
    assert(after.differences.find((d) => d.kind === 'curve').classification === 'approved', 'an approved difference must stop being reported as expected');

    // 6. Roll it back, and the renders come back byte-identical to the baseline's.
    const rb = D.mcp('rollback_transaction', { transactionId: applied.transaction_id });
    assert(rb.rolled_back === true && rb.complete === true);
    const back = await D.mcp('explain_change', { baselineId: bl.id, request: 'is it back?' });
    assert(back.differences.length === 0, `after the rollback nothing should differ, got: ${back.header}`);
    assert(back.visual_difference.comparisons.every((c) => c.method === 'digest' && !c.changed),
      'a rolled-back edit must render pixel-identically to the baseline — a rendered pass that does not reproduce is not evidence');
    out.afterRollback = back.header;

    // 7. And the baseline itself survived every one of those, including the whole-project undo.
    S.undo();
    assert(D.mcp('list_baselines', {}).baselines.length === 1, 'undo must not delete a baseline');
    S.redo();
    S.loadProject(S.serialize());
    const reloaded = D.mcp('list_baselines', {}).baselines;
    assert(reloaded.length === 1 && reloaded[0].approved_differences === 1,
      'a baseline and its approvals must survive save/load — that is what makes it a production asset rather than a screenshot');
    return out;
  });

  // The Phase 5 success condition (directive Part 62): "Cadence can identify a known contact error
  // or motion-propagation problem with evidence." Run against the LIVE app, because what only this
  // can reach is the handler boundary: the three new tools going through liveProject(), the
  // contact constraint being compiled and measured inside apply_animation_patch's own check, the
  // diagnosis landing in provenance, and the measurement returning to zero after a rollback the
  // Phase 2 machinery performed rather than a fixture edit.
  await step('motion: a planted foot is broken, measured, attributed to the joint that did it, and undone', async () => {
    S.newProject('phase5-contact');
    const item = await D.addBuiltinRig('r15');
    const key = (track, t, v) => S.setKey(item.id, track, t, v, { es: 'Sine', ed: 'InOut', noUndo: true });
    // A right-arm swing, and a left leg that is keyed but does not move — which is what a planted
    // foot looks like in project data.
    key('RightShoulder', 0, CF.IDENTITY.slice());
    key('RightShoulder', 8, CF.fromEuler(0, 0, 1.2));
    key('RightShoulder', 16, CF.fromEuler(0, 0, -0.9));
    key('LeftHip', 0, CF.IDENTITY.slice());
    key('LeftAnkle', 0, CF.IDENTITY.slice());
    key('LeftAnkle', 16, CF.IDENTITY.slice());
    const out = {};
    const before = D.AI.hash.contentHash(D.AI.snapshot.withoutHistory(S.state.project));
    const contact = { text: 'keep the left foot within 0.05 studs from frame 0 to 16' };

    // 1. MEASURE. The arm moves, the foot does not, and the difference is a number.
    const mot = D.mcp('analyze_motion', { itemId: item.id, from: 0, to: 16 });
    const hand = mot.subjects.find((s) => s.part_id === 'RightHand');
    const foot = mot.subjects.find((s) => s.part_id === 'LeftFoot');
    assert(hand && foot, 'the default subject set must include the contact-capable extremities');
    assert(hand.summary.path_length_studs > 1, `the swinging hand should travel: ${hand.summary.path_length_studs}`);
    assert(foot.summary.still === true, `the planted foot should not: ${foot.summary.path_length_studs}`);
    assert(hand.samples.length === 17 && hand.samples[8].jerk !== null, 'an interior sample must carry all three derivatives');
    assert(mot.chain.links.length >= 2 && mot.chain.inversions.length === 0, 'the shoulder leads the elbow, so nothing is inverted');
    out.motion = { hand_travel: hand.summary.path_length_studs, hand_peak: hand.summary.peak_speed, foot_still: foot.summary.still };

    // 2. The declared contact holds — and a clean contact is an answer, not a silence.
    const clean = D.mcp('analyze_contacts', { itemId: item.id, constrain: contact });
    assert(clean.contacts_declared === 1, 'the closed grammar must compile the contact');
    assert(clean.results[0].within_tolerance === true, `the contact should be clean: ${clean.summary}`);
    assert(clean.results[0].effector.part_id === 'LeftFoot', '"the left foot" must resolve to the foot');
    // Nothing is INFERRED: with no contact declared, none is measured.
    const none = D.mcp('analyze_contacts', { itemId: item.id });
    assert(none.contacts_declared === 0 && /nothing here infers a contact/.test(none.summary));

    // 3. BREAK IT — through the real transaction machinery, with the contact supplied as the
    //    constraint set, so the checker measures the PLANNED result before anything is committed.
    const applied = D.mcp('apply_animation_patch', {
      ops: [{ op: 'set_key', itemId: item.id, track: 'LeftHip', t: 16, value: CF.fromEuler(0.5, 0, 0) }],
      intent: 'swing the left leg through', request: 'step forward', constrain: contact,
    });
    assert(applied.applied === true, 'a contact constraint compiles to `warn`, so it reports rather than refusing');
    const cv = applied.constraints_checked.violations;
    assert(cv.length === 1 && /would drift/.test(cv[0].reason), `the constraint must catch the break: ${JSON.stringify(applied.constraints_checked.violations)}`);
    const ev = cv[0].finding.evidence.find((e) => e.kind === 'measurement').detail;
    // The exact frame depends on the easing (a Sine/InOut leg crosses 0.05 studs later than a
    // linear one), so what is asserted is the CLAIM rather than a number: the finding points at
    // where the contact first went out of tolerance, which is earlier than where it was worst.
    assert(cv[0].finding.frame === ev.first_breach_frame && ev.first_breach_frame > 0,
      `the finding must point at the first breach: frame ${cv[0].finding.frame} vs breach ${ev.first_breach_frame}`);
    assert(ev.first_breach_frame < ev.at_frame, `the first breach (${ev.first_breach_frame}) must precede the worst frame (${ev.at_frame})`);
    out.violation = { reason: cv[0].reason, first_breach: ev.first_breach_frame, worst: ev.at_frame, drift: ev.max_drift_studs };

    // 4. IDENTIFY, with evidence — the joint that owns the drift, proved by freezing it.
    const why = D.mcp('explain_motion_problem', {
      question: 'why_is_this_contact_unstable', itemId: item.id,
      effector: 'the left foot', start: 0, end: 16, tolerance_studs: 0.05,
    });
    assert(why.likely_causes[0].cause === '"LeftHip"', `expected the hip to own the drift, got ${why.likely_causes[0]?.cause}`);
    assert(why.likely_causes[0].share_of_drift > 0.7, 'and to own most of it');
    assert(why.findings[0].id === 'CONTACT-UNSTABLE' && why.findings[0].certainty === 'certain');
    assert(why.recommended_action.requires_user_approval === true, 'a recommendation is not an instruction to act');
    assert(why.coverage.notRun.some((s) => /nothing visual was checked/.test(s)), 'a kinematic answer must say it did not look');
    assert(why.workflows.why_does_the_camera_hide_the_impact.implemented === false, 'the unbuilt workflows must still be listed');
    out.cause = { cause: why.likely_causes[0].cause, share: why.likely_causes[0].share_of_drift };

    // The diagnosis is in provenance, so the conclusion is traceable rather than transient.
    const prov = D.mcp('inspect_provenance', { type: 'analysis' });
    assert(prov.nodes.some((n) => /why_is_this_contact_unstable/.test(n.summary)), 'a diagnosis must be recorded');

    // 5. UNDO — and the measurement comes back to exactly where it started.
    const rb = D.mcp('rollback_transaction', { transactionId: applied.transaction_id });
    assert(rb.complete === true, 'the contact-breaking patch must be as reversible as any other');
    assert(D.AI.hash.contentHash(D.AI.snapshot.withoutHistory(S.state.project)) === before,
      'after the rollback the project must be byte-identical to its pre-patch state');
    const after = D.mcp('analyze_contacts', { itemId: item.id, constrain: contact });
    assert(after.results[0].within_tolerance === true && after.results[0].max_drift_studs === 0,
      'and the drift must measure zero again, not merely "small"');

    // 6. Part 23's noise policy, on the real app: an authored stepped key is NOT a defect.
    S.setKey(item.id, 'RightShoulder', 8, CF.fromEuler(0, 0, 1.2), { es: 'Constant', ed: 'Out', noUndo: true });
    const stepped = D.mcp('explain_motion_problem', { question: 'why_is_this_motion_bad', itemId: item.id, joint: 'RightShoulder', frame: 8 });
    assert(/deliberate stepped/.test(stepped.header), `a stepped key must not be reported as a defect: ${stepped.header}`);
    assert(stepped.findings[0].id === 'MOTION-AUTHORED-VARIATION');
    out.noisePolicy = stepped.header;

    return out;
  });

  // The Phase 6 success condition (directive Part 62): "Cadence can generate a parameterized
  // impact effect that remains attached, timed, and reversible." Run against the LIVE app, because
  // what only this can reach is the handler boundary: a spec arriving as MCP arguments, the anchor
  // part name resolving against the real selection, the new item going through
  // apply_animation_patch's own constraint check and transaction, the emitter actually SAMPLING
  // particles at the frames the envelope says, and the whole effect coming back out on a rollback
  // the Phase 2 machinery performs rather than a fixture edit.
  await step('effects: a parameterized impact effect is attached to a hand, timed to an event, and undone', async () => {
    const { sampleParticles } = await import('../renderer/js/vfx.js');
    S.newProject('phase6-impact');
    const item = await D.addBuiltinRig('r15');
    const key = (track, t, v) => S.setKey(item.id, track, t, v, { es: 'Sine', ed: 'InOut', noUndo: true });
    // A swing that ends in a hit, so there is a real motion for the effect to be timed against.
    key('RightShoulder', 0, CF.IDENTITY.slice());
    key('RightShoulder', 16, CF.fromEuler(0, 0, -1.4));
    key('RightElbow', 0, CF.IDENTITY.slice());
    key('RightElbow', 16, CF.fromEuler(0.6, 0, 0));
    // The event the effect must hit. A width makes it a span, which is what `overlaps` reads.
    D.mcp('add_marker', { itemId: item.id, t: 16, name: 'impact', width: 2, codeBegin: 'print("hit")' });
    const out = {};
    const before = D.AI.hash.contentHash(D.AI.snapshot.withoutHistory(S.state.project));

    // 1. The shared timeline sees the event, across items rather than per item.
    const tl = D.mcp('list_shot_events', {});
    assert(tl.count === 1 && tl.events[0].name === 'impact', `the shot timeline must carry the event: ${JSON.stringify(tl.events)}`);
    assert(tl.events[0].hasCode === true, 'a marker carrying Luau is a gameplay hook, not only a visual cue');
    assert(tl.events[0].span[0] === 16 && tl.events[0].span[1] === 18, 'a widthed event occupies a span');
    out.events = { count: tl.count, name: tl.events[0].name, span: tl.events[0].span };

    // The shot report names what Cadence cannot hold, rather than implying it can.
    const shot = D.mcp('describe_shot', {});
    assert(shot.events === 1 && shot.characters.length === 1);
    assert(/no Shot record/.test(shot.absent.shot_entity), 'the absent Shot entity must be stated');

    // 2. Nothing is timed to anything yet, and the tool says so rather than reporting nothing.
    const bare = D.mcp('validate_effect_timing', {});
    assert(bare.emitters === 0 && bare.findings.length === 0, 'with no emitter there is nothing to judge');

    // 3. COMPILE — a spec in the vocabulary of what the effect IS, with the anchor as a bare part
    //    name resolved against the current selection.
    S.setSelection(item.id, null);
    const SPEC = {
      primitive: 'explosion-debris', theme: 'ember', scale: 'large', role: 'primary',
      anchor: 'RightHand', offset: [0, -0.5, 0],
      timing: { event: 'impact', lead: 0, attack: 2, decay: 8 },
      intent: 'a heavy impact on the sword hand',
    };
    const preview = D.mcp('compile_effect', { ...SPEC, preview: true });
    assert(preview.compiled === true && preview.applied === false, 'a preview must compile without applying');
    // `preview_animation_patch` returns a transaction record, not a plan: "nothing was changed" IS
    // its success summary, so what says the patch is sound is status/blocked/problems.
    assert(preview.preview.status === 'previewed' && preview.preview.blocked === false,
      `the previewed patch must be sound: ${preview.preview.summary} ${JSON.stringify(preview.preview.problems)}`);
    assert(preview.preview.operations.length === 4, `add_item + a 3-key envelope: ${preview.preview.operations.length}`);
    assert(S.state.project.items.filter((i) => i.kind === 'vfx').length === 0, 'a dry run must leave the project alone');

    const made = D.mcp('compile_effect', SPEC);
    assert(made.applied === true, `the effect must apply: ${made.reason || made.summary}`);
    assert(made.preset.id === 'explosion-debris-ember-large', `the spec must resolve to a real preset: ${made.preset?.id}`);
    out.compiled = { item: made.item.name, preset: made.preset.id, envelope: made.envelope, hash: made.spec_hash };

    // 4. ATTACHED — the emitter rides the hand, so it follows the swing instead of sitting still.
    const vfx = S.state.project.items.find((i) => i.kind === 'vfx');
    assert(vfx && vfx.attachedTo.itemId === item.id && vfx.attachedTo.partId === 'RightHand',
      `the effect must be attached to the hand: ${JSON.stringify(vfx?.attachedTo)}`);
    // Proof it MOVES with the arm: resolve its world origin the way viewport.js does, at two
    // frames of the swing. This is the check a data-only test cannot make — it needs the solved rig.
    const emitterWorldAt = (f) => {
      S.setPlayhead(f, false);
      D.updateScene();
      const parentWorld = D.getInstance(item.id).partWorld(vfx.attachedTo.partId);
      return CF.mul(parentWorld, vfx.attachedTo.offset);
    };
    const w0 = emitterWorldAt(0), w16 = emitterWorldAt(16);
    const moved = Math.hypot(w16[0] - w0[0], w16[1] - w0[1], w16[2] - w0[2]);
    assert(moved > 0.5, `an attached emitter must travel with its anchor part, moved ${moved.toFixed(3)} studs`);
    out.attachment = { partId: vfx.attachedTo.partId, travel_studs: Number(moved.toFixed(3)) };

    // 5. TIMED — the envelope peaks on the event, and the emitter really emits there and not before.
    const timed = D.mcp('validate_effect_timing', {});
    const peak = timed.findings.find((f) => f.id === 'VFX-PEAK-ON-EVENT');
    assert(peak, `the envelope must land on the event: ${JSON.stringify(timed.findings.map((f) => f.id))}`);
    assert(/frame 16/.test(peak.statement), peak.statement);
    // The sampler is the ground truth: at the envelope's start nothing has spawned, at the peak
    // something has. A rate envelope that no particle ever responds to would pass every check above.
    const countAt = (f) => {
      const resolveOriginAt = () => CF.mul(D.getInstance(item.id).partWorld(vfx.attachedTo.partId), vfx.attachedTo.offset);
      S.setPlayhead(f, false);
      D.updateScene();
      return sampleParticles(vfx, f, S.state.project.fps, resolveOriginAt, S.evalTrackNum).length;
    };
    const atStart = countAt(14), atPeak = countAt(18);
    assert(atStart === 0, `nothing should have spawned at the envelope's start, got ${atStart}`);
    assert(atPeak > 0, `the peak must actually emit particles, got ${atPeak}`);
    out.timing = { peak: peak.statement, particles_at_start: atStart, particles_at_peak: atPeak };

    // Compiling the same spec again is refused as a duplicate rather than stacking two emitters.
    const again = D.mcp('compile_effect', SPEC);
    assert(again.applied !== true, 'the same spec twice must not silently create a second emitter');
    assert(S.state.project.items.filter((i) => i.kind === 'vfx').length === 1);

    // An unknown primitive is refused with the nearest match, not silently defaulted.
    const wrong = D.mcp('compile_effect', { primitive: 'explosion', anchor: 'RightHand', timing: { event: 'impact' } });
    assert(wrong.compiled === false && /did you mean explosion-debris/.test(JSON.stringify(wrong.findings)),
      `a wrong primitive must be refused with a suggestion: ${wrong.reason}`);

    // 6. REVERSIBLE — the item and its envelope come back out together, byte-identically.
    const rb = D.mcp('rollback_transaction', { transactionId: made.transaction_id });
    assert(rb.complete === true, 'a compiled effect must be as reversible as any other edit');
    assert(S.state.project.items.some((i) => i.kind === 'vfx') === false, 'the emitter must be gone');
    assert(S.state.project.tracks[vfx.id] === undefined, 'and so must its @rate track');
    assert(D.AI.hash.contentHash(D.AI.snapshot.withoutHistory(S.state.project)) === before,
      'after the rollback the project must be byte-identical to its pre-effect state');

    return out;
  });

  // The Phase 7 success condition (directive Part 62): "Cadence can compare bounded alternatives
  // and justify a recommendation." Run against the LIVE app, because two things only exist at the
  // handler boundary: the operating mode actually GATING a mutation (Part 11 / OPS-001, enforced in
  // apply_animation_patch, which every mutating semantic tool goes through), and a comparison
  // leaving the real singleton project untouched rather than a fixture object.
  await step('experiments: bounded alternatives are compared, a recommendation is justified, and analyze mode refuses to mutate', async () => {
    S.newProject('phase7-experiments');
    const item = await D.addBuiltinRig('r15');
    const key = (track, t, v) => S.setKey(item.id, track, t, v, { es: 'Sine', ed: 'InOut', noUndo: true });
    // A swing over a planted left foot: the arm moves, the ankle is keyed and does not.
    key('RightShoulder', 0, CF.IDENTITY.slice());
    key('RightShoulder', 8, CF.fromEuler(0, 0, 1.2));
    key('RightShoulder', 16, CF.fromEuler(0, 0, -0.9));
    key('RightShoulder', 28, CF.IDENTITY.slice());
    key('LeftHip', 0, CF.IDENTITY.slice());
    for (const t of [0, 8, 16, 28]) key('LeftAnkle', t, CF.IDENTITY.slice());
    const out = {};
    const before = D.AI.hash.contentHash(D.AI.snapshot.withoutHistory(S.state.project));

    // 1. Part 11 / OPS-001: the mode field now governs something. `analyze` must not mutate, and
    //    the refusal must not be forceable — leaving a read-only mode is the user's decision.
    const refused = D.mcp('apply_animation_patch', {
      ops: [{ op: 'set_key', itemId: item.id, track: 'RightShoulder', t: 8, value: CF.fromEuler(0, 0, 1.4) }],
      intent: 'this must not land', mode: 'analyze',
    });
    assert(refused.applied === false && refused.blocked === true, 'analyze mode must refuse a mutation');
    assert(refused.forceable === false, 'and the refusal must not be forceable');
    assert(/does not modify anything/.test(refused.refused_because), refused.refused_because);
    const stillClean = D.AI.hash.contentHash(D.AI.snapshot.withoutHistory(S.state.project));
    assert(stillClean === before, 'a refused mutation must not have touched the project');
    const forced = D.mcp('apply_animation_patch', {
      ops: [{ op: 'set_key', itemId: item.id, track: 'RightShoulder', t: 8, value: CF.fromEuler(0, 0, 1.4) }],
      mode: 'analyze', force: true,
    });
    assert(forced.applied === false, 'force must not buy a way out of a read-only mode');
    out.modeGate = { refused_because: refused.refused_because, forceable: refused.forceable };

    // The mode policy is inspectable, and an unstated mode is reported rather than guessed.
    const modeInfo = D.mcp('operating_modes', { mode: 'polish' });
    assert(modeInfo.resolved.policy.mutates === true);
    assert(modeInfo.resolved.policy.obligations.some((o) => /diagnosis/.test(o)), 'polish owes a diagnosis first');
    assert(D.mcp('operating_modes', {}).resolved.findings.some((f) => f.id === 'MODE-UNDECLARED'));

    // 2. Part 48: four bounded candidates, each demonstrating one thing.
    const cmp = D.mcp('compare_experiments', {
      name: 'Give the slash more weight',
      intent: 'heavier without dragging the planted foot',
      itemId: item.id,
      frame: 8,
      protect: 'keep the left foot within 0.05 studs from frame 0 to 16',
      acceptance: { checks: [{ check: 'contact_drift_within', itemId: item.id, effector: 'the left foot', start: 0, end: 28, tolerance: 0.05 }] },
      candidates: [
        { name: 'A: deeper anticipation', hypothesis: 'a bigger wind-up reads as more effort, and the arm never touches the foot', ops: [{ op: 'set_key', itemId: item.id, track: 'RightShoulder', t: 8, value: CF.fromEuler(0, 0, 1.4) }], expected_effect: 'the arm travels further before the strike' },
        { name: 'B: drive it from the hips', hypothesis: 'weight comes from the body, not the arm', ops: [{ op: 'set_key', itemId: item.id, track: 'LeftHip', t: 16, value: CF.fromEuler(0.5, 0, 0) }] },
        { name: 'C: lift the foot late', hypothesis: 'releasing the foot after the strike adds recoil', ops: [{ op: 'set_key', itemId: item.id, track: 'LeftAnkle', t: 28, value: CF.fromEuler(0.6, 0, 0) }] },
        { name: 'D: no hypothesis', ops: [{ op: 'set_key', itemId: item.id, track: 'RightElbow', t: 8, value: CF.fromEuler(0.3, 0, 0) }] },
      ],
    });
    assert(cmp.ok === true, `the comparison must run: ${cmp.reason}`);
    assert(cmp.active_mode === 'experiment / production', `the active mode must be reported: ${cmp.active_mode}`);

    // BOUNDED: the candidate with no hypothesis never entered the comparison.
    assert(cmp.candidates.length === 3, `3 of 4 candidates should be compared, got ${cmp.candidates.length}`);
    assert(cmp.rejected.length === 1 && cmp.rejected[0].findings[0].id === 'EXPT-HYPOTHESIS-MISSING',
      'Part 48 forbids a variant with no stated claim');

    // The declared protection is enforced by measurement, not annotation.
    const hips = cmp.candidates.find((c) => c.name === 'B: drive it from the hips');
    assert(hips.measurements.constraint_compliance.violations > 0, 'the hip rotation drags the protected foot');
    const blocked = cmp.findings.find((f) => f.id === 'EXPT-CANDIDATE-BLOCKED');
    assert(blocked && /would drift/.test(blocked.statement), `the exclusion must carry its measurement: ${blocked?.statement}`);

    // JUSTIFIED: a winner, the dimension that chose it, and the ones that could not.
    assert(cmp.recommendation.candidate === 'A: deeper anticipation', `expected A to win, got ${cmp.recommendation.candidate}`);
    assert(cmp.recommendation.decided_by.some((d) => /intent_alignment/.test(d)), 'the acceptance criteria are what decided it');
    assert(cmp.recommendation.requires_user_approval === true);
    assert(cmp.coverage.notRun.length === 4, 'the 4 unmeasurable dimensions must each be named');
    out.comparison = {
      winner: cmp.recommendation.candidate,
      justification: cmp.recommendation.justification,
      decided_by: cmp.recommendation.decided_by,
      not_decided_by: cmp.recommendation.not_decided_by,
      excluded: blocked.statement,
    };

    // 3. NOTHING WAS APPLIED. Comparing four candidates on the real singleton project must leave
    //    it byte-identical — this is the property a fixture-based test cannot prove.
    assert(cmp.applied === false);
    assert(D.AI.hash.contentHash(D.AI.snapshot.withoutHistory(S.state.project)) === before,
      'comparing candidates must leave the live project byte-identical');
    assert(S.state.project.tracks[item.id].RightShoulder.keys.find((k) => k.t === 8).v
      .every((n, i) => Math.abs(n - CF.fromEuler(0, 0, 1.2)[i]) < 1e-9), 'the original key must be untouched');

    // The comparison IS recorded, so the reasoning survives the session.
    const prov = D.mcp('inspect_provenance', { type: 'analysis' });
    assert(prov.nodes.some((n) => /recommended "A: deeper anticipation"/.test(n.summary)),
      'a recommendation somebody may act on must be traceable');

    // 4. And the winner applies like any ordinary patch, in a mode that permits it.
    const applied = D.mcp('apply_animation_patch', {
      ops: cmp.candidates.find((c) => c.name === cmp.recommendation.candidate).changed_variables.length
        ? [{ op: 'set_key', itemId: item.id, track: 'RightShoulder', t: 8, value: CF.fromEuler(0, 0, 1.4) }]
        : [],
      intent: 'take experiment A', mode: 'experiment',
    });
    assert(applied.applied === true, `the chosen candidate must apply: ${applied.refused_because || applied.summary}`);
    assert(applied.operating_mode.active === 'experiment / production', 'Part 11: the active mode is reported on every apply');
    const rb = D.mcp('rollback_transaction', { transactionId: applied.transaction_id });
    assert(rb.complete === true);
    assert(D.AI.hash.contentHash(D.AI.snapshot.withoutHistory(S.state.project)) === before,
      'and taking a candidate is as reversible as any other edit');

    return out;
  });

  await step('semantic layer: a persisted lock survives save/load, blocks a patch, and is undoable', async () => {
    S.newProject('locks');
    await D.addBuiltinRig('r15');
    D.addCamera();
    const cam = S.state.project.items.find((i) => i.kind === 'camera');
    S.setKey(cam.id, '@fov', 0, 70, { noUndo: true });
    const out = {};

    const locked = D.mcp('lock_constraint', { query: 'the camera', reason: 'framing approved' });
    assert(locked.created === true, 'the lock should have been created');
    assert(locked.resolves_to.tracks.length > 0, 'a lock must resolve to something concrete or be refused');
    out.lock = locked.constraint.id;

    // It shows up on the Scene Graph, so a caller inspecting the scene sees it without asking.
    const node = D.mcp('inspect_scene', {}).objects.find((o) => o.id === `item:${cam.id}`);
    assert(node.lock_state.locked === true && node.lock_state.reason === 'framing approved', 'the Scene Graph must report the lock');
    assert(node.constraint_ids.includes(locked.constraint.id), 'the Scene Graph must name the constraint');

    // Enforced with NO constraint set passed in — that is the point of persisting it.
    const blocked = D.mcp('apply_animation_patch', { ops: [{ op: 'set_key', itemId: cam.id, track: '@fov', t: 8, value: 40 }], intent: 'push in' });
    assert(blocked.applied === false, 'the persisted lock must block the patch on its own');
    assert(blocked.constraints_checked.violations[0].constraint_type === 'lock');
    assert(blocked.constraints_checked.violations[0].priority === D.AI.constraints.PRIORITY.USER_LOCK);

    // force records the override rather than hiding the violation.
    const forced = D.mcp('apply_animation_patch', { ops: [{ op: 'set_key', itemId: cam.id, track: '@fov', t: 8, value: 40 }], intent: 'push in', force: true });
    assert(forced.applied === true && forced.validation.overridden.length === 1, 'a forced apply must record the override');
    D.mcp('rollback_transaction', { transactionId: forced.transaction_id });

    // The lock survives a save/load round trip, because it lives inside the project.
    const json = S.serialize();
    S.loadProject(json);
    assert(D.mcp('inspect_constraints', {}).persisted_locks.length === 1, 'the lock must survive save/load');
    assert(D.mcp('apply_animation_patch', { ops: [{ op: 'set_key', itemId: cam.id, track: '@fov', t: 9, value: 30 }] }).applied === false,
      'the reloaded lock must still be enforced');

    // Unlocking is explicit and undoable.
    const removed = D.mcp('unlock_constraint', { id: locked.constraint.id });
    assert(removed.locks_held === 0);
    assert(D.mcp('apply_animation_patch', { ops: [{ op: 'set_key', itemId: cam.id, track: '@fov', t: 9, value: 30 }] }).applied === true,
      'with the lock gone the same patch must go through');
    S.undo(); // undo the patch
    S.undo(); // undo the unlock
    assert(D.mcp('inspect_constraints', {}).persisted_locks.length === 1, 'undo must bring the lock back');
    let threw = false;
    try { D.mcp('unlock_constraint', { id: 'constraint:nope' }); } catch { threw = true; }
    assert(threw, 'unlocking something that is not locked must fail loudly');
    return out;
  });

  await step('animation language: "heavier without changing timing" through the real MCP tools, end to end', async () => {
    // Part 62's success condition for Phase 3, run against the LIVE app rather than a fixture.
    // aitest already exercises every module in plain Node; what only this can reach is the handler
    // boundary itself — liveProject(), the shared intent resolver, apply_motion_plan re-entering
    // apply_animation_patch, the before-snapshot becoming the acceptance baseline, and the plan
    // node landing in provenance. Every one of those is code aitest never touches.
    S.newProject('animation-language');
    const item = await D.addBuiltinRig('r15');
    const key = (track, t, v, es, ed) => S.setKey(item.id, track, t, v, { es, ed, noUndo: true });
    for (const [track, a, b] of [
      ['Root', CF.fromEuler(0, 0.3, 0), CF.fromEuler(0, -0.4, 0)],
      ['Waist', CF.fromEuler(0, 0.4, 0), CF.fromEuler(0, -0.5, 0)],
      ['RightShoulder', CF.fromEuler(0, 0, 1.2), CF.fromEuler(0, 0, -0.9)],
      ['RightElbow', CF.fromEuler(0.6, 0, 0), CF.fromEuler(0.1, 0, 0)],
    ]) {
      key(track, 0, CF.IDENTITY.slice(), 'Sine', 'Out');
      key(track, 8, a, 'Sine', 'InOut');
      key(track, 16, b, 'Sine', 'Out');
      key(track, 28, CF.IDENTITY.slice(), 'Sine', 'Out');
    }
    S.addMarker(item.id, 16, { name: 'impact', width: 2 });
    const out = {};

    // EXPRESS — and say back what was understood, including what was not.
    const i = D.mcp('interpret_intent', { request: 'make the slash heavier without changing timing', itemId: item.id });
    assert(i.intent.action_type === 'attack', '"slash" must name the motion, not scope the edit to a third of it');
    assert(i.intent.preserve.includes('aspect:timing'), 'the preserve clause must reach the intent');
    assert(i.interpretation.preserves.some((s) => /timing/.test(s)), 'the interpretation must state what is protected, not only what changes');
    assert(i.unrecognised.length === 0, `nothing should have been left over: ${i.unrecognised.join(', ')}`);
    assert(i.constraints.constraints.length === 1 && i.constraints.constraints[0].aspect[0] === 'timing');
    out.intent = { id: i.intent.id, terms: i.intent.terms.map((t) => t.term), confidence: i.intent.confidence };

    // PLAN — a dry run that changes nothing.
    const before = D.mcp('inspect_timeline', { itemId: item.id }).counts.keys;
    const planned = D.mcp('plan_motion', { request: 'make the slash heavier without changing timing', itemId: item.id });
    assert(D.mcp('inspect_timeline', { itemId: item.id }).counts.keys === before, 'plan_motion must not touch the project');
    assert(planned.plan.phases.length === 3, `expected 3 spans, got ${planned.plan.phases.length}`);
    const impact = planned.plan.phases.find((p) => p.name === 'impact');
    assert(impact && impact.certainty === 'highly_likely', 'the marker names the impact, and a marker is not certainty');
    assert(planned.plan.phases.some((p) => p.certainty === 'possible'), 'an inferred phase name must never claim better than possible');
    assert(planned.operations > 0, 'something must survive the timing protection');
    out.plan = { operations: planned.operations, strategies: planned.applied_strategies.map((s) => s.strategy) };

    // ENFORCE — the one key-moving strategy is refused, by name, with what the motion loses.
    const lead = planned.blocked.find((b) => b.strategy === 'lead_lag');
    assert(lead, 'body lead moves keys and must be blocked by the timing protection');
    assert(lead.blocked_by === 'constraint' && lead.constraints[0].rule === 'no key changes time');
    assert(lead.operations_dropped > 0 && /body-driven/.test(lead.contributes), 'a blocked strategy must say what was lost');
    // A dimension nothing can compile must be reported, not dropped — and its reason must name its
    // own obstacle. Asserting a directive part number here rotted the moment MOT-008 shipped: every
    // "Part 23" reason became a lie about a capability that now exists.
    const cap = planned.blocked.filter((b) => b.blocked_by === 'capability');
    assert(cap.length > 0, 'a dimension nothing can compile must be reported, not dropped');
    assert(cap.every((b) => b.reason && !/\(Phase [0-5]\)|until Part 23|until Phase [0-5]/.test(b.reason)),
      `a blocked dimension may not defer to a phase that has shipped: ${cap.map((b) => b.reason).join(' | ')}`);
    out.blocked = planned.blocked.map((b) => b.dimension);

    // APPLY — through the same transaction machinery as a hand-written patch.
    const applied = D.mcp('apply_motion_plan', { request: 'make the slash heavier without changing timing', itemId: item.id });
    assert(applied.applied === true, `the plan should have applied: ${applied.reason || applied.summary}`);
    assert(applied.transaction_id, 'apply_motion_plan must be a transaction, not a bare mutation');
    assert(!applied.applied_strategies.some((s) => s.strategy === 'lead_lag'), 'the key-moving strategy must not have run');
    out.transaction = applied.transaction_id;

    // MEASURE — against the before-snapshot the apply took for itself.
    const acc = applied.acceptance;
    assert(acc, 'apply_motion_plan must evaluate its own acceptance criteria');
    assert(acc.accepted === true, `acceptance failed: ${acc.summary}`);
    assert(acc.fully_validated === false, 'nothing rendered, so this must NOT read as fully validated');
    const by = Object.fromEntries(acc.results.map((r) => [r.check, r]));
    assert(by.key_times_unchanged.status === 'pass', 'the timing promise has to be measured, not asserted');
    assert(by.amplitude_increased.status === 'pass', 'and the change has to have actually happened');
    assert(by.no_visual_regression.status === 'not_run', 'the visual check must always come back NOT RUN in this build');
    out.acceptance = acc.summary;

    // The plan is in provenance, so a keyframe traces back to the words that produced it.
    const prov = D.mcp('inspect_provenance', { type: 'plan' });
    assert(prov.nodes.length === 1 && prov.nodes[0].detail.intent.request === 'make the slash heavier without changing timing',
      'the applied plan must be findable in provenance by its request');

    // ROLL BACK — the whole thing, through the Phase 2 tool, with no special case for plans.
    const rb = D.mcp('rollback_transaction', { transactionId: applied.transaction_id });
    assert(rb.complete === true, 'a motion plan must be as reversible as any other patch');
    assert(D.mcp('inspect_timeline', { itemId: item.id }).counts.keys === before, 'the key count must be back where it started');

    // A vocabulary override is scoped and evidenced, and survives save/load.
    let threw = false;
    try { D.mcp('set_vocabulary_term', { term: 'heavy', dimensions: { motion_amplitude: -0.3 } }); } catch { threw = true; }
    assert(threw, 'an override without evidence must be refused');
    D.mcp('set_vocabulary_term', {
      term: 'heavy', dimensions: { motion_amplitude: -0.3 }, scope: 'character', scopeId: item.id,
      evidence: ['the user scaled it back twice'],
    });
    S.loadProject(S.serialize());
    const vocab = D.mcp('animation_vocabulary', { itemId: item.id });
    const heavy = vocab.terms.find((t) => t.term === 'heavy');
    assert(heavy.overrides.length === 1, 'a scoped override must survive save/load');
    assert(heavy.dimensions.motion_amplitude === 0.2, 'the SHARED definition must be untouched');
    assert(vocab.language.acceptance_checks.some((c) => !c.implemented && c.blocked_by),
      'an unimplemented acceptance check must name what blocks it');
    out.vocabulary = { overrides: heavy.overrides.length };

    return out;
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
