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
  await step('builtin rigs: torso color, no facet-lines on round geometry, no NaN', async () => {
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
      const torsoPart = inst.parts.get(torsoDef.id);
      const armPart = inst.parts.get(armDef.id);
      const headPart = inst.parts.get(headDef.id);
      const torsoColor = torsoPart.mesh.material.color.getHexString();
      const armColor = armPart.mesh.material.color.getHexString();
      assert(torsoColor === '635f62', `${key} torso should be Dark stone grey, got #${torsoColor}`);
      assert(armColor === 'a3a2a5', `${key} arm should be Medium stone grey, got #${armColor}`);
      assert(!headPart.mesh.children.some((c) => c.userData.isEdgeOverlay), `${key} head must not have a facet-line edge overlay`);
      const worlds = inst.solvePoseWorlds(S.evalPose(item, 0), item.origin);
      let nan = 0;
      for (const [, cf] of worlds) if (cf.some((v) => !isFinite(v))) nan++;
      assert(nan === 0, `${key} has ${nan} NaN part world(s)`);
      results[key] = { torsoColor, armColor, parts: worlds.size };
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
    const a = sampleParticles(item, 20, fps, resolveOrigin);
    const b = sampleParticles(item, 20, fps, resolveOrigin);
    assert(a.length === b.length && a.length > 0, 'no particles sampled, or nondeterministic count');
    for (let i = 0; i < a.length; i++) assert(Math.abs(a[i].pos[1] - b[i].pos[1]) < 1e-9, 'nondeterministic particle position');
    const t = 20 / fps;
    const expectedY = item.origin[1] + 0.5 * -20 * t * t;
    const actualY = a[0].pos[1];
    assert(Math.abs(actualY - expectedY) < 0.01, `ballistic formula mismatch: expected ${expectedY}, got ${actualY}`);
    return { particleCount: a.length, expectedY, actualY };
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
