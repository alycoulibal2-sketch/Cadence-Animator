// Builds a real, populated animation scene and leaves the app on a good-looking frame, so the
// screenshot harness captures the actual product rather than an empty startup state.
(async () => {
  const deadline = Date.now() + 15000;
  while (!window.__cadenceDebug) {
    if (Date.now() > deadline) throw new Error('__cadenceDebug never appeared');
    await new Promise((r) => setTimeout(r, 100));
  }
  const D = window.__cadenceDebug;
  const S = D.S, CF = D.CF;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Clear any onboarding / recovery modal so it isn't in the shot.
  const ob = document.getElementById('onboarding');
  if (ob && ob.classList.contains('show')) {
    const b = document.getElementById('onboardStart');
    if (b) b.click();
  }
  document.querySelectorAll('.modal-backdrop.show, .modal.show').forEach((m) => m.classList.remove('show'));

  // This capture runs while the user's real installed Cadence owns ports 35747/35748, so the
  // bridge chip shows a red EADDRINUSE error that has nothing to do with the product. Hide it
  // rather than fake a "connected" state we didn't actually achieve.
  const chip = document.getElementById('bridgeChip');
  if (chip) chip.style.display = 'none';

  // Give the 3D viewport more of the frame than the default 300px-tall timeline allows, while
  // still showing enough dope-sheet rows to read as a real timeline.
  const tl = document.getElementById('timelinePanel');
  if (tl) tl.style.height = '250px';
  window.dispatchEvent(new Event('resize'));
  await sleep(400);

  S.newProject('Sprint Cycle');
  S.state.project.fps = 30;
  await sleep(200);

  const item = await D.addBuiltinRig('r15');
  if (!item) throw new Error('rig add failed');
  await sleep(2500); // meshes/textures

  const id = item.id;
  const X = (a) => CF.axisAngle([1, 0, 0], a);   // limb swing — pure swing, never a twist
  const Y = (a) => CF.axisAngle([0, 1, 0], a);
  const Z = (a) => CF.axisAngle([0, 0, 1], a);
  const mul = CF.mul;

  // A 32-frame run cycle: contact / passing / opposite contact / passing / loop back.
  const F = [0, 8, 16, 24, 32];
  const curves = {
    RightHip:      [ 0.75,  0.05, -0.55, -0.10,  0.75],
    LeftHip:       [-0.55, -0.10,  0.75,  0.05, -0.55],
    RightKnee:     [-0.35, -1.25, -0.55, -0.30, -0.35],
    LeftKnee:      [-0.55, -0.30, -0.35, -1.25, -0.55],
    RightShoulder: [-0.85, -0.10,  0.70,  0.05, -0.85],
    LeftShoulder:  [ 0.70,  0.05, -0.85, -0.10,  0.70],
    RightElbow:    [-1.10, -0.75, -0.60, -0.80, -1.10],
    LeftElbow:     [-0.60, -0.80, -1.10, -0.75, -0.60],
    RightAnkle:    [ 0.25,  0.40,  0.10,  0.20,  0.25],
    LeftAnkle:     [ 0.10,  0.20,  0.25,  0.40,  0.10],
  };
  // Scaled well down from a full sprint: this is a hero still, and a subtle walk-cycle amplitude
  // is guaranteed to read as a correct pose from any camera angle, where a 43-degree hip swing
  // photographs as a crouch.
  const AMP = 0.34;
  for (const [joint, vals] of Object.entries(curves)) {
    F.forEach((t, i) => S.setKey(id, joint, t, X(vals[i] * AMP), { noUndo: true, es: 'Cubic', ed: 'InOut' }));
  }
  // Torso lean + counter-rotation, and a head that stays level.
  F.forEach((t, i) => {
    const swing = [1, 0, -1, 0, 1][i];
    S.setKey(id, 'Waist', t, mul(X(0.05), Y(swing * 0.10)), { noUndo: true, es: 'Cubic', ed: 'InOut' });
    S.setKey(id, 'Neck', t, mul(X(-0.14), Y(-swing * 0.10)), { noUndo: true, es: 'Cubic', ed: 'InOut' });
  });

  // Expand the rig's tracks so the dope sheet actually shows rows.
  item.collapsed = false;
  S.emit('items');
  S.emit('tracks', { itemId: id });

  // Select a limb so the Inspector shows a joint (not just the rig summary) and the gizmo reads
  // as "mid-pose", which is what the app actually looks like in use.
  S.setSelection(id, 'RightLowerArm');
  S.setPlayRange(0, 32, {});
  // Per-part markers sit on every part by default and visually crowd the figure at this zoom;
  // the joint handles are the ones that communicate "this is a rig you pose". Both are real
  // user-facing toggles, so turning one off is a valid app state, not a doctored image.
  // (not on the debug hook — reach the instance's own toggle, same call the app's own setter makes)
  for (const [, inst] of D.viewport.instances) inst.setPartMarkersVisible?.(false);
  await sleep(300);

  S.setPlayhead(16, false);
  D.updateScene();
  D.render();
  await sleep(200);

  // Start from frameAll() — the app's own known-good target and view direction — then pull the
  // camera in along that exact axis. Keeping the direction means the framing can't come out at a
  // weird angle; only the distance changes.
  D.frameAll();
  const cam = D.viewport.camera, tgt = D.viewport.controls.target;
  const ZOOM = 0.50;
  cam.position.set(
    tgt.x + (cam.position.x - tgt.x) * ZOOM,
    tgt.y + (cam.position.y - tgt.y) * ZOOM,
    tgt.z + (cam.position.z - tgt.z) * ZOOM,
  );
  D.viewport.controls.update();
  D.render();
  await sleep(600);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  window.__shotReady = true;
  console.log('[shot] scene ready: ' + Object.keys(S.getTracks(id)).length + ' tracks');
})();
