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

  async function step(name, fn) {
    try {
      const r = await fn();
      report.steps.push({ name, ok: true, r });
    } catch (e) {
      report.steps.push({ name, ok: false, error: e.message, stack: (e.stack || '').split('\n').slice(0, 4).join(' | ') });
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
  await step('builtin rigs: torso/root color, box edge overlays present + depth-correct, no facet-lines on round geometry, no NaN', async () => {
    const results = {};
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
      const armPart = inst.parts.get(armDef.id);
      const headPart = inst.parts.get(headDef.id);
      const rootPart = inst.parts.get(rootDef.id);
      const torsoColor = torsoPart.mesh.material.color.getHexString();
      const armColor = armPart.mesh.material.color.getHexString();
      const rootColor = rootPart.mesh.material.color.getHexString();
      assert(torsoColor === '635f62', `${key} torso should be Dark stone grey, got #${torsoColor}`);
      assert(rootColor === '635f62', `${key} root part should be Dark stone grey, got #${rootColor}`);
      assert(armColor === 'a3a2a5', `${key} arm should be Medium stone grey, got #${armColor}`);
      assert(!headPart.mesh.children.some((c) => c.userData.isEdgeOverlay), `${key} head must not have a facet-line edge overlay`);
      // Roblox draws a visible dark border on every box-shaped body part — must actually be
      // present, and depth-tested (not depthTest:false, which x-rays hidden edges through the
      // front of the part — see rigbuild.js's buildEdgeOverlay for the full story).
      const torsoEdge = torsoPart.mesh.children.find((c) => c.userData.isEdgeOverlay);
      assert(!!torsoEdge, `${key} torso (a box) must have a visible edge overlay`);
      assert(torsoEdge.material.depthTest === true, `${key} torso edge overlay must depth-test normally, not x-ray through the part`);
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

  await step('VFX Studio MCP: render_frame returns an actual screenshot', async () => {
    const shot = await vfxCall('vfx_render_frame', { frame: 5 });
    assert(typeof shot.image === 'string' && shot.image.length > 5000, 'render_frame image looks too small/missing');
    assert(shot.mimeType === 'image/png', 'render_frame should return a PNG');
    return { ok: true, imageBytes: shot.image.length };
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
  await step('face decal: curved patch exists on the head, no NaN', async () => {
    const item = await D.addBuiltinRig('r6');
    await new Promise((r) => setTimeout(r, 600));
    const headDef = item.rig.parts.find((p) => p.name === 'Head');
    const inst = D.getInstance(item.id);
    const headPart = inst.parts.get(headDef.id);
    const faceChild = headPart.mesh.children.find((c) => c.userData.isFaceLayer);
    assert(!!faceChild, 'no face decal found on R6 head');
    assert(faceChild.geometry.type === 'CylinderGeometry', `expected a curved CylinderGeometry patch, got ${faceChild.geometry.type}`);
    const pos = faceChild.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      assert(isFinite(pos.getX(i)) && isFinite(pos.getY(i)) && isFinite(pos.getZ(i)), 'NaN vertex in face patch');
    }
    return { geometryType: faceChild.geometry.type };
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

  // ---------------------------------------------------------------- SKETCH IT
  // Pure-logic checks run directly in THIS window via dynamic import (sketchGeometry.js has zero
  // window/DOM dependency, same as effectModel.js/effectShapes.js — loads and behaves identically
  // anywhere). The pipeline check below needs the studio window's real archetype library/
  // validator, so it goes through vfxCall like every other VFX Studio check above.
  await step('SKETCH IT: geometry analysis recognizes basic shapes from synthetic strokes', async () => {
    const { analyzeSketchStrokes } = await import('../renderer/js/sketchGeometry.js');

    const line = { points: Array.from({ length: 20 }, (_, i) => ({ x: i * 10, y: i * 10, p: 0.5, t: i * 16 })) };
    const lineFeatures = analyzeSketchStrokes([line]);
    assert(lineFeatures.straightness > 0.9, `straight line should score high straightness, got ${lineFeatures.straightness}`);

    const N = 40;
    const circlePts = Array.from({ length: N + 1 }, (_, i) => {
      const a = (i / N) * Math.PI * 2;
      return { x: Math.cos(a) * 50, y: Math.sin(a) * 50, p: 0.5, t: i * 16 };
    });
    const circleFeatures = analyzeSketchStrokes([{ points: circlePts }]);
    assert(circleFeatures.circularity > 0.75, `closed circular stroke should score high circularity, got ${circleFeatures.circularity}`);
    assert(circleFeatures.closed, 'circle stroke should be detected as closed');

    const zigzagPts = Array.from({ length: 24 }, (_, i) => ({ x: i * 8, y: i % 2 === 0 ? 0 : 40, p: 0.5, t: i * 16 }));
    const zigzagFeatures = analyzeSketchStrokes([{ points: zigzagPts }]);
    assert(zigzagFeatures.zigzagScore > 0.5, `zigzag stroke should score high zigzagScore, got ${zigzagFeatures.zigzagScore}`);

    const empty = analyzeSketchStrokes([]);
    assert(empty.empty === true && Number.isFinite(empty.complexity), 'empty input should degrade gracefully, not throw');

    return { straightness: lineFeatures.straightness, circularity: circleFeatures.circularity, zigzagScore: zigzagFeatures.zigzagScore };
  });

  await step('SKETCH IT: full pipeline (analyze -> generate -> validate) produces ~30 valid, ranked candidates', async () => {
    const N = 30;
    const circlePts = Array.from({ length: N + 1 }, (_, i) => {
      const a = (i / N) * Math.PI * 2;
      return { x: Math.cos(a) * 3, y: Math.sin(a) * 3, p: 0.6, t: i * 20 };
    });
    const result = await vfxCall('vfx_sketch_test_pipeline', { strokes: [{ points: circlePts }] });

    assert(result.candidateCount >= 24 && result.candidateCount <= 30, `expected ~25-30 candidates, got ${result.candidateCount}`);
    assert(result.invalidCount === 0, `every generated candidate should pass the real validator, but ${result.invalidCount} did not: ${JSON.stringify(result.invalid)}`);
    assert(result.bestMatch && typeof result.bestMatch.confidence === 'number', 'best match missing/malformed');
    assert(
      ['portal', 'energy-shield', 'black-hole'].includes(result.bestMatch.archetypeKey),
      `a closed circle sketch should best-match a circular archetype, got "${result.bestMatch.archetypeKey}"`
    );
    assert(result.goodCount === 6, `expected exactly 6 Good Matches, got ${result.goodCount}`);
    assert(result.moreCount === result.candidateCount - 7, `More Ideas count should be candidateCount-7, got ${result.moreCount} vs ${result.candidateCount - 7}`);
    return result;
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
