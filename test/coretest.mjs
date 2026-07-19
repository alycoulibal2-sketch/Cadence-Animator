// Fast Node-level tests for the pure (state-free, DOM-free) effect core:
// effectModel / effectEngine / effectShapes / expr / vfx / diagnostics / effectValidators.
// Runs in plain Node (24+ auto-detects the renderer files' ESM syntax) — no Electron needed, so
// this is the tight iteration loop; test/smoketest.js remains the in-app integration pass.
// Run: node test/coretest.mjs
//
// This file doubles as the shared-module-safety gate (docs/vfx-studio.md): importing these
// modules here proves none of them reaches for window.*, state.js, or three.js at load time.

import assert from 'node:assert/strict';

const M = await import('../renderer/js/effectModel.js');
const E = await import('../renderer/js/effectEngine.js');
const S = await import('../renderer/js/effectShapes.js');
const X = await import('../renderer/js/expr.js');
const V = await import('../renderer/js/vfx.js');
const D = await import('../renderer/js/diagnostics.js');
const EV = await import('../renderer/js/effectValidators.js'); // registers validators on load

let passed = 0, failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL  ${name}: ${e.message}`);
  }
}

const IDENT = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

// ---------------------------------------------------------------- expressions
check('expr: arithmetic + precedence', () => {
  assert.equal(X.evalExpr('2 + 3 * 4', {}), 14);
  assert.equal(X.evalExpr('(2 + 3) * 4', {}), 20);
  assert.equal(X.evalExpr('2 ^ 3 ^ 2', {}), 512); // right-assoc
  assert.equal(X.evalExpr('-3 + 5', {}), 2);
});
check('expr: variables, functions, ternary, comparisons', () => {
  assert.equal(X.evalExpr('t * 2', { t: 3 }), 6);
  assert.ok(Math.abs(X.evalExpr('sin(pi / 2)', {}) - 1) < 1e-12);
  assert.equal(X.evalExpr('clamp(5, 0, 2)', {}), 2);
  assert.equal(X.evalExpr('t > 0.5 ? 10 : 20', { t: 0.7 }), 10);
  assert.equal(X.evalExpr('lerp(0, 10, 0.3)', {}), 3);
  assert.equal(X.evalExpr('value * 2', { value: 21 }), 42);
});
check('expr: determinism of noise/rand', () => {
  const a = X.evalExpr('noise(3.7) + rand(12)', {});
  const b = X.evalExpr('noise(3.7) + rand(12)', {});
  assert.equal(a, b);
});
check('expr: broken input falls back, never throws', () => {
  assert.equal(X.evalExpr('rate * (', {}, 7), 7);
  assert.equal(X.evalExpr('unknownvar + 1', {}, 7), 7);
  assert.equal(X.evalExpr('1/0 * 0 + sqrt(-1)', {}, 7), 0); // sqrt clamps, division guard → finite 0
  assert.equal(X.evalExpr('', {}, 7), 7);
  assert.ok(X.checkExpr('sin(t') !== null);
  assert.equal(X.checkExpr('sin(t)'), null);
});

// ---------------------------------------------------------------- shapes
check('shapes: every kind samples finite points across u/v', () => {
  for (const kind of S.SHAPE_KIND_KEYS) {
    const def = S.defaultShape(kind);
    for (let i = 0; i <= 10; i++) {
      const p = S.shapePoint(def, i / 10, (i % 3) / 2);
      assert.ok(p.every(Number.isFinite), `${kind} produced non-finite point`);
    }
  }
});
check('shapes: determinism + circle geometry sanity', () => {
  const ring = S.defaultShape('circle');
  const a = S.shapePoint(ring, 0.25), b = S.shapePoint(ring, 0.25);
  assert.deepEqual(a, b);
  const r = Math.hypot(a[0], a[2]);
  assert.ok(Math.abs(r - ring.radius) < 1e-9, 'circle point not on radius');
});
check('shapes: lightning endpoints pinned, jag deterministic by seed', () => {
  const bolt = S.defaultShape('lightning');
  const top = S.shapePoint(bolt, 0), bottom = S.shapePoint(bolt, 1);
  assert.deepEqual([top[0], top[2]], [0, 0]);
  assert.deepEqual([bottom[0], bottom[2]], [0, 0]);
  assert.ok(Math.abs(top[1] - bolt.length) < 1e-9);
  const mid1 = S.shapePoint({ ...bolt, seed: 1 }, 0.5);
  const mid2 = S.shapePoint({ ...bolt, seed: 2 }, 0.5);
  assert.notDeepEqual(mid1, mid2, 'different seeds should give different bolts');
});
check('shapes: polyline has segments+1 points', () => {
  assert.equal(S.shapePolyline(S.defaultShape('arc'), 16).length, 17);
});

// ---------------------------------------------------------------- model
check('model: new effect + layer defaults are valid', () => {
  const doc = M.newEffect('Test');
  const layer = M.newLayer('emitter');
  M.addLayer(doc, layer);
  assert.equal(doc.layers.length, 1);
  assert.equal(layer.enabled, true);
  assert.ok(!('solo' in layer), 'solo must not be document state');
});
check('model: curve eval — hold ends, easing between, left-key convention', () => {
  const layer = M.newLayer('shape');
  M.setCurveKey(layer, 'opacity', 0, 0);
  M.setCurveKey(layer, 'opacity', 10, 1);
  assert.equal(M.evalCurve(layer.curves.opacity, -5, 0.5), 0);
  assert.equal(M.evalCurve(layer.curves.opacity, 15, 0.5), 1);
  assert.ok(Math.abs(M.evalCurve(layer.curves.opacity, 5, 0.5) - 0.5) < 1e-9); // linear default
  assert.equal(M.evalCurve(null, 3, 0.42), 0.42);
});
check('model: resolveProp order — expr over curve over base, value composition', () => {
  const layer = M.newLayer('emitter');
  layer.props.rate = 10;
  assert.equal(M.resolveProp(layer, 'rate', 0, 30), 10);
  M.setCurveKey(layer, 'rate', 0, 50);
  assert.equal(M.resolveProp(layer, 'rate', 0, 30), 50);
  layer.exprs.rate = 'value * 2';
  assert.equal(M.resolveProp(layer, 'rate', 0, 30), 100);
  layer.exprs.rate = 'broken(((';
  assert.equal(M.resolveProp(layer, 'rate', 0, 30), 50, 'broken expr must fall back to curve');
});
check('model: removeModifier cascades mod:* curves and exprs', () => {
  const layer = M.newLayer('emitter');
  const mod = M.addModifier(layer, 'noise');
  M.setCurveKey(layer, `mod:${mod.id}:amount`, 0, 0.5);
  layer.exprs[`mod:${mod.id}:amount`] = 'value';
  assert.ok(M.removeModifier(layer, mod.id));
  assert.equal(Object.keys(layer.curves).length, 0);
  assert.equal(Object.keys(layer.exprs).length, 0);
});
check('model: duplicateLayer rewrites mod curve/expr namespaces', () => {
  const doc = M.newEffect('t');
  const layer = M.addLayer(doc, M.newLayer('emitter'));
  const mod = M.addModifier(layer, 'pulse');
  M.setCurveKey(layer, `mod:${mod.id}:amount`, 3, 0.7);
  const copy = M.duplicateLayer(doc, layer.id);
  const newMod = copy.modifiers[0];
  assert.notEqual(newMod.id, mod.id);
  assert.ok(copy.curves[`mod:${newMod.id}:amount`], 'copied curve must follow the new modifier id');
  assert.ok(!copy.curves[`mod:${mod.id}:amount`], 'no orphan under the old id');
  assert.ok(layer.curves[`mod:${mod.id}:amount`], 'original untouched');
});
check('model: serialize/parse round-trip preserves structure', () => {
  const doc = M.newEffect('Round Trip');
  const em = M.addLayer(doc, M.newLayer('emitter', 'Sparks'));
  em.clip = { start: 5, len: 30, loop: true };
  M.setCurveKey(em, 'rate', 0, 10, { es: 'Sine', ed: 'Out' });
  M.setCurveKey(em, 'rate', 20, 80, { bez: [0.3, 0, 0.7, 1] });
  em.exprs.speed = 'value * (1 + 0.2*sin(t*4))';
  M.addModifier(em, 'wind');
  M.addLayer(doc, M.newLayer('shake'));
  const parsed = M.parseEffect(M.serializeEffect(doc));
  assert.ok(parsed.ok, parsed.error);
  assert.equal(M.serializeEffect(parsed.doc), M.serializeEffect(doc));
});
check('model: parse rejects unknown types, accepts v1 emitter payloads', () => {
  assert.equal(M.parseEffect({ layers: [{ type: 'wormhole' }] }).ok, false);
  assert.equal(M.parseEffect('not json at all {{{').ok, false);
  const v1 = M.parseEffect({ name: 'Old', emitter: { rate: 42, lifetime: 2 } });
  assert.ok(v1.ok);
  assert.equal(v1.doc.layers[0].type, 'emitter');
  assert.equal(v1.doc.layers[0].props.rate, 42);
});

// ---------------------------------------------------------------- engine
function testDoc() {
  const doc = M.newEffect('Engine Test');
  doc.duration = 90;
  const em = M.addLayer(doc, M.newLayer('emitter', 'Main'));
  em.clip = { start: 10, len: 30, loop: false };
  em.props.rate = 30;
  em.props.lifetime = 1;
  return { doc, em };
}
check('engine: determinism — same frame twice is deep-equal', () => {
  const { doc } = testDoc();
  const a = E.sampleEffect(doc, 25);
  const b = E.sampleEffect(doc, 25);
  assert.deepEqual(a, b);
});
check('engine: clip windowing — nothing before start, particles OUTLIVE clip end', () => {
  const { doc } = testDoc();
  assert.equal(E.sampleEffect(doc, 5).particles.length, 0, 'no particles before clip start');
  assert.ok(E.sampleEffect(doc, 25).particles.length > 0, 'emitting inside the clip');
  // clip ends at frame 40; lifetime 1s = 30 frames → particles alive until ~frame 70
  const after = E.sampleEffect(doc, 50).particles;
  assert.ok(after.length > 0, 'particles spawned late in the clip must live past clip end');
  assert.ok(after.every((p) => p.spawnFrame < 40), 'but nothing SPAWNS after clip end');
  assert.equal(E.sampleEffect(doc, 85).particles.length, 0, 'all dead once lifetime fully elapses');
});
check('engine: burst deposits exactly burst extra particles at clip start', () => {
  const { doc, em } = testDoc();
  em.props.rate = 0;
  em.props.burst = 25;
  em.props.maxParticles = 200;
  const s = E.sampleEffect(doc, 11);
  assert.equal(s.particles.length, 25);
  assert.ok(s.particles.every((p) => p.spawnFrame === 10));
});
check('engine: looping clip emits continuously across the seam (no pool reset)', () => {
  const { doc, em } = testDoc();
  em.clip = { start: 0, len: 20, loop: true };
  em.props.rate = 30; em.props.lifetime = 0.5; em.props.maxParticles = 100;
  // At frame 22 (just past a seam at 20) particles spawned before the seam must still exist.
  const s = E.sampleEffect(doc, 22);
  assert.ok(s.particles.some((p) => p.spawnFrame < 20), 'pre-seam particles survive the seam');
  assert.ok(s.particles.some((p) => p.spawnFrame >= 20), 'post-seam emission continues');
});
check('engine: burst re-fires at every loop iteration start', () => {
  const { doc, em } = testDoc();
  em.clip = { start: 0, len: 20, loop: true };
  em.props.rate = 0; em.props.burst = 5; em.props.lifetime = 0.4; em.props.maxParticles = 100;
  const s = E.sampleEffect(doc, 21);
  assert.ok(s.particles.some((p) => p.spawnFrame === 20), 'second-iteration burst fired');
});
check('engine: per-spawn animatables — keyed gravity affects only new spawns', () => {
  const { doc, em } = testDoc();
  em.clip = { start: 0, len: 60, loop: false };
  em.props.rate = 10; em.props.lifetime = 2; em.props.speed = 0; em.props.spreadDegrees = 0;
  M.setCurveKey(em, 'gravity', 0, 0, { es: 'Constant' });
  M.setCurveKey(em, 'gravity', 30, -50, { es: 'Constant' });
  const s = E.sampleEffect(doc, 45);
  const early = s.particles.filter((p) => p.spawnFrame < 30);
  const late = s.particles.filter((p) => p.spawnFrame >= 30);
  assert.ok(early.length && late.length, 'need both populations');
  // gravity 0 spawns never fall; gravity -50 spawns must be visibly below their spawn height
  assert.ok(early.every((p) => Math.abs(p.pos[1] - 0) < 1.5), 'gravity-0 particles stay near origin height');
  assert.ok(late.some((p) => p.pos[1] < -0.2), 'gravity -50 particles fall');
});
check('engine: quality decimation is a strict subset', () => {
  const { doc } = testDoc();
  const full = E.sampleEffect(doc, 30);
  const half = E.sampleEffect(doc, 30, { quality: 0.5 });
  const fullSeeds = new Set(full.particles.map((p) => p.seed));
  assert.ok(half.particles.length < full.particles.length);
  assert.ok(half.particles.every((p) => fullSeeds.has(p.seed)), 'quality subset must come from the full set');
});
check('engine: solo filtering via opts (view state, not document)', () => {
  const { doc, em } = testDoc();
  const em2 = M.addLayer(doc, M.newLayer('emitter', 'Second'));
  em2.clip = { start: 10, len: 30, loop: false };
  const only2 = E.sampleEffect(doc, 25, { soloIds: new Set([em2.id]) });
  assert.ok(only2.particles.length > 0);
  assert.ok(only2.particles.every((p) => p.layerId === em2.id));
  assert.ok(E.sampleEffect(doc, 25).particles.some((p) => p.layerId === em.id), 'no solo → all layers');
});
check('engine: scalar layers — shape/light/screen/shake/sound sample & window', () => {
  const doc = M.newEffect('Scalars');
  doc.duration = 60;
  const sh = M.addLayer(doc, M.newLayer('shape', 'Slash'));
  sh.clip = { start: 0, len: 30, loop: false };
  M.setCurveKey(sh, 'opacity', 0, 0);
  M.setCurveKey(sh, 'opacity', 10, 1);
  const li = M.addLayer(doc, M.newLayer('light'));
  li.clip = { start: 0, len: 60, loop: false };
  const sc = M.addLayer(doc, M.newLayer('screen'));
  sc.clip = { start: 5, len: 10, loop: false };
  const sk = M.addLayer(doc, M.newLayer('shake'));
  sk.clip = { start: 0, len: 60, loop: false };
  const so = M.addLayer(doc, M.newLayer('sound'));
  so.clip = { start: 10, len: 20, loop: false };
  so.props.soundId = 'rbxassetid://123';

  const at8 = E.sampleEffect(doc, 8);
  assert.equal(at8.shapes.length, 1);
  assert.ok(Math.abs(at8.shapes[0].opacity - 0.8) < 1e-9, 'opacity curve resolved at clip-local frame');
  assert.equal(at8.lights.length, 1);
  assert.equal(at8.screen.length, 1);
  assert.ok(Math.abs(at8.shake.dx) + Math.abs(at8.shake.dy) > 0, 'shake active');
  assert.equal(at8.sounds.length, 0, 'sound clip not started yet');
  const at15 = E.sampleEffect(doc, 15);
  assert.equal(at15.sounds.length, 1);
  assert.ok(at15.sounds[0].shouldBePlaying);
  assert.ok(Math.abs(at15.sounds[0].tOffset - 5 / 30) < 1e-9);
  const at45 = E.sampleEffect(doc, 45);
  assert.equal(at45.shapes.length, 0, 'shape clip over — scalar layers do not outlive their clip');
});
check('engine: modifiers are deterministic and keyed on particle seed', () => {
  const { doc, em } = testDoc();
  M.addModifier(em, 'noise');
  M.addModifier(em, 'flicker');
  const a = E.sampleEffect(doc, 30);
  const b = E.sampleEffect(doc, 30);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------- diagnostics + validators
check('diagnostics: clean default effect validates with zero errors', () => {
  const doc = M.newEffect('Clean');
  M.addLayer(doc, M.newLayer('emitter'));
  const report = D.runValidation('effect', { effect: doc });
  assert.equal(report.counts.error, 0, JSON.stringify(report.diagnostics, null, 1));
  assert.equal(report.blockedForExport, false);
});
check('diagnostics: seeded defects are caught with the right stable ids', () => {
  const doc = M.newEffect('Broken');
  doc.duration = 60;
  const em = M.addLayer(doc, M.newLayer('emitter', 'Ghost'));
  em.props.transparencyStart = 1;
  em.props.transparencyEnd = 1;
  em.props.lifetime = 0.01;
  const late = M.addLayer(doc, M.newLayer('shape', 'Too Late'));
  late.clip = { start: 100, len: 10, loop: false };
  const orphan = M.addLayer(doc, M.newLayer('emitter', 'Orphan'));
  orphan.curves['mod:dead-id:amount'] = [{ t: 0, v: 1 }];
  const badexpr = M.addLayer(doc, M.newLayer('light', 'BadExpr'));
  badexpr.exprs.intensity = 'sin(';
  const report = D.runValidation('effect', { effect: doc });
  const ids = new Set(report.diagnostics.map((d) => d.id));
  for (const want of ['VFX-E004', 'VFX-E003', 'VFX-E002', 'VFX-W010', 'VFX-E020']) {
    assert.ok(ids.has(want), `expected ${want} in ${[...ids].join(',')}`);
  }
  assert.ok(report.blockedForExport);
});
check('diagnostics: auto-fix clears the fixable errors, report goes clean', () => {
  const doc = M.newEffect('Fixable');
  doc.duration = 60;
  const em = M.addLayer(doc, M.newLayer('emitter', 'Ghost'));
  em.props.transparencyStart = 1;
  em.props.transparencyEnd = 1;
  em.props.lifetime = 0.01;
  const late = M.addLayer(doc, M.newLayer('shape', 'Late'));
  late.clip = { start: 100, len: 10, loop: false };
  const first = D.runValidation('effect', { effect: doc });
  assert.ok(first.counts.error >= 3);
  const { applied } = D.applyAutoFixes({ effect: doc }, first.diagnostics);
  assert.ok(applied.length >= 3, `only applied: ${JSON.stringify(applied)}`);
  const second = D.runValidation('effect', { effect: doc });
  assert.equal(second.counts.error, 0, JSON.stringify(second.diagnostics, null, 1));
});
check('diagnostics: export scope flags Roblox clamps and preview-only features', () => {
  const doc = M.newEffect('Exporty');
  const em = M.addLayer(doc, M.newLayer('emitter'));
  em.props.rate = 900;           // > Roblox 500 clamp
  em.props.motion = 'orbit';     // approximated motion
  M.addModifier(em, 'noise');    // dropped modifier
  const report = D.runValidation('export', { effect: doc });
  const ids = new Set(report.diagnostics.map((d) => d.id));
  assert.ok(ids.has('EXP-W002'), 'rate clamp warning');
  assert.ok(ids.has('EXP-W001') || ids.has('EXP-I001'), 'fidelity notes');
  assert.equal(report.counts.error, 0, 'fidelity findings are warnings/notes, never blockers');
});
check('validators: export fidelity levels', () => {
  const clean = M.newLayer('emitter');
  assert.equal(EV.layerExportFidelity(clean).level, 'faithful');
  const orbit = M.newLayer('emitter');
  orbit.props.motion = 'orbit';
  assert.equal(EV.layerExportFidelity(orbit).level, 'approximated');
  const noisy = M.newLayer('emitter');
  M.addModifier(noisy, 'noise');
  assert.equal(EV.layerExportFidelity(noisy).level, 'preview-only');
});
check('validators: performance report shape', () => {
  const doc = M.newEffect('Perf');
  const em = M.addLayer(doc, M.newLayer('emitter'));
  em.props.rate = 100; em.props.lifetime = 2;
  const rep = EV.performanceReport(doc);
  assert.ok(rep.estimatedInGameParticles >= 200);
  assert.ok(rep.platforms.pc.score >= 0 && rep.platforms.pc.score <= 100);
  assert.ok(['A', 'B', 'C', 'D'].includes(rep.platforms.mobile.grade));
});

// ---------------------------------------------------------------- effect preset library
const LIB = await import('../renderer/js/effectLibrary.js');

check('library: every archetype x theme x scale validates with zero errors', () => {
  let combos = 0;
  for (const arch of LIB.EFFECT_ARCHETYPES) {
    for (const theme of LIB.EFFECT_THEMES) {
      for (const scale of LIB.EFFECT_SCALES) {
        const doc = LIB.buildArchetypeDoc(arch.key, { theme: theme.key, scale: scale.factor });
        assert.ok(doc, `${arch.key} failed to build`);
        const report = D.runValidation('effect', { effect: doc });
        assert.equal(report.counts.error, 0,
          `${arch.key}/${theme.key}/${scale.key}: ${JSON.stringify(report.diagnostics.filter((d) => d.severity === 'error'), null, 1)}`);
        combos++;
      }
    }
  }
  assert.ok(combos >= LIB.EFFECT_ARCHETYPES.length * 18, `only ${combos} combos checked`);
});
check('library: every archetype actually renders particles or shapes at its peak', () => {
  for (const arch of LIB.EFFECT_ARCHETYPES) {
    const doc = LIB.buildArchetypeDoc(arch.key);
    let anyVisible = false;
    for (let f = 0; f < doc.duration && !anyVisible; f += 2) {
      const s = E.sampleEffect(doc, f);
      if (s.particles.length || s.shapes.some((sh) => sh.opacity > 0.05) || s.lights.some((l) => l.intensity > 0.05)) anyVisible = true;
    }
    assert.ok(anyVisible, `${arch.key} never shows anything`);
  }
});
check('library: theme remap changes colors, classic does not', () => {
  const classic = LIB.buildArchetypeDoc('fireball');
  const ice = LIB.buildArchetypeDoc('fireball', { theme: 'ice' });
  const c1 = classic.layers.find((l) => l.type === 'emitter').props.colorStart;
  const c2 = ice.layers.find((l) => l.type === 'emitter').props.colorStart;
  assert.notEqual(c1, c2, 'ice theme should recolor');
  assert.ok(ice.name.startsWith('Ice '));
});
check('library: scale transform scales sizes AND curve values', () => {
  const big = LIB.buildArchetypeDoc('sword-slash', { scale: 1.6 });
  const std = LIB.buildArchetypeDoc('sword-slash');
  const bigShape = big.layers.find((l) => l.type === 'shape');
  const stdShape = std.layers.find((l) => l.type === 'shape');
  assert.ok(Math.abs(bigShape.curves.scale[1].v - stdShape.curves.scale[1].v * 1.6) < 1e-6);
});
const PL = await import('../renderer/js/particleLibrary.js');
check('library: total preset count (particles + archetypes) exceeds 400', () => {
  const total = PL.PARTICLE_PRESETS.length + LIB.EFFECT_ARCHETYPES.length;
  assert.ok(total >= 400, `only ${total}`);
});

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nAll ${passed} core checks passed`);
process.exit(failed ? 1 : 0);
