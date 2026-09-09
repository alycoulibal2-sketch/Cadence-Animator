// Node-level tests for the semantic layer (renderer/js/ai/**).
//
// Run: node test/aitest.mjs
//
// This file doubles as the PURITY GATE for the layer: importing every module here in plain Node
// proves none of them reaches for window.*, the DOM, three.js or state.js at load time. That is
// the property that lets the same code run against a snapshot, a baseline or a fixture, and it is
// easy to break by accident — so it is checked first, before anything else.
//
// Same shape as test/coretest.mjs and test/pnxtest.mjs: no framework, `check()` counts, non-zero
// exit on failure.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const AI = await import('../renderer/js/ai/index.js');
const H = await import('../renderer/js/ai/hash.js');
const C = await import('../renderer/js/ai/certainty.js');
const IDS = await import('../renderer/js/ai/ids.js');
const K = await import('../renderer/js/ai/kinematics.js');
const R = await import('../renderer/js/ai/roles.js');
const RG = await import('../renderer/js/ai/riggraph.js');
const TG = await import('../renderer/js/ai/timelinegraph.js');
const SG = await import('../renderer/js/ai/scenegraph.js');
const SEL = await import('../renderer/js/ai/select.js');
const SNAP = await import('../renderer/js/ai/snapshot.js');
const PRV = await import('../renderer/js/ai/provenance.js');
const PATCH = await import('../renderer/js/ai/patch.js');
const CON = await import('../renderer/js/ai/constraints.js');
const SCOPE = await import('../renderer/js/ai/scope.js');
const TXN = await import('../renderer/js/ai/transaction.js');
const VOC = await import('../renderer/js/ai/vocabulary.js');
const CAL = await import('../renderer/js/ai/cal.js');
const INT = await import('../renderer/js/ai/intent.js');
const PLAN = await import('../renderer/js/ai/plan.js');
const RAS = await import('../renderer/js/ai/raster.js');
const OBS = await import('../renderer/js/ai/observe.js');
const BASE = await import('../renderer/js/ai/baseline.js');
const EXP = await import('../renderer/js/ai/explain.js');
const MOT = await import('../renderer/js/ai/motion.js');
const DIAG = await import('../renderer/js/ai/diagnose.js');
const EV = await import('../renderer/js/ai/events.js');
const VS = await import('../renderer/js/ai/vfxspec.js');
const CF = await import('../renderer/js/cf.js');
const PARTICLES = await import('../renderer/js/particleLibrary.js');

let passed = 0, failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL  ${name}: ${e.message}`);
    if (process.env.AITEST_STACK) console.error(e.stack);
  }
}

const RIGS = JSON.parse(fs.readFileSync(path.join(ROOT, 'rigs/builtin.json'), 'utf8'));
const I = () => CF.IDENTITY.slice();

// A small, deliberately awkward project: a rig, a prop attached to its right hand, a camera,
// a joint track for a joint that does not exist, and an event marker.
function fixture({ rig = 'r15' } = {}) {
  const hero = { id: 'hero', kind: 'rig', name: 'Hero', rig: RIGS[rig], origin: I() };
  const sword = { id: 'sword', kind: 'prop', name: 'Sword', className: 'Part', attachedTo: { itemId: 'hero', partId: 'RightHand', offset: I() } };
  const cam = { id: 'cam', kind: 'camera', name: 'Camera 1', origin: I() };
  return {
    id: 'proj-1', name: 'Slash', version: 1, fps: 30, length: 60, loop: false, priority: 'Action',
    items: [hero, sword, cam],
    tracks: {
      hero: {
        RightShoulder: { keys: [
          { t: 0, v: I(), es: 'Cubic', ed: 'Out' },
          { t: 8, v: CF.fromEuler(0, 0, 1.2), es: 'Quad', ed: 'InOut' },
          { t: 16, v: CF.fromEuler(0, 0, -0.9), es: 'Cubic', ed: 'Out' },
        ] },
        RightElbow: { keys: [{ t: 0, v: I() }, { t: 16, v: CF.fromEuler(0.4, 0, 0) }] },
        RightHip: { keys: [{ t: 0, v: I() }, { t: 10, v: CF.fromEuler(0.9, 0, 0) }, { t: 20, v: I() }] },
        '@origin': { keys: [{ t: 0, v: I() }] },
        GhostJoint: { keys: [{ t: 0, v: I() }] },
      },
      cam: { '@fov': { keys: [{ t: 0, v: 70 }, { t: 16, v: 50 }] } },
      sword: {},
    },
    groups: [], markers: { hero: [{ t: 16, width: 2, name: 'impact' }] },
    playRange: null, onionSkin: { enabledItemIds: [], range: 3 }, audio: null,
  };
}

// A rig standing on a planted left foot while its right arm swings. The left leg carries a base
// key so a patch that adds a second one produces REAL motion — a single key holds everywhere, and
// a foot that never moves is not a contact test.
function plantFixture() {
  const hero = { id: 'hero', kind: 'rig', name: 'Hero', rig: RIGS.r15, origin: I() };
  return {
    id: 'plant', name: 'Plant', version: 1, fps: 30, length: 60, loop: false, priority: 'Action',
    items: [hero],
    tracks: {
      hero: {
        RightShoulder: { keys: [{ t: 0, v: I(), es: 'Sine', ed: 'Out' }, { t: 8, v: CF.fromEuler(0, 0, 1.2), es: 'Sine', ed: 'InOut' }, { t: 16, v: CF.fromEuler(0, 0, -0.9), es: 'Sine', ed: 'Out' }, { t: 28, v: I(), es: 'Sine', ed: 'Out' }] },
        RightElbow: { keys: [{ t: 0, v: I() }, { t: 8, v: CF.fromEuler(0.6, 0, 0) }, { t: 16, v: CF.fromEuler(0.1, 0, 0) }, { t: 28, v: I() }] },
        LeftHip: { keys: [{ t: 0, v: I() }] },
        // Keyed but never moving: the ankle is what a planted foot looks like in project data.
        LeftAnkle: { keys: [{ t: 0, v: I() }, { t: 8, v: I() }, { t: 16, v: I() }, { t: 28, v: I() }] },
      },
    },
    groups: [], markers: { hero: [{ t: 16, width: 2, name: 'impact' }] },
    playRange: null, onionSkin: { enabledItemIds: [], range: 3 }, audio: null,
  };
}

console.log('\n— purity —');

check('purity: every ai/ module imports in plain Node with no renderer globals', () => {
  // Reaching this line at all means all 12 imports at the top of this file succeeded. Asserting a
  // symbol from each one keeps a future tree-shaking or re-export mistake from making that vacuous.
  for (const [name, mod] of Object.entries({ H, C, IDS, K, R, RG, TG, SG, SEL, SNAP, PRV, PATCH, CON, SCOPE, TXN, VOC, CAL, INT, PLAN, RAS, OBS, BASE, EXP, MOT, DIAG })) {
    assert.ok(Object.keys(mod).length > 0, `${name} exported nothing`);
  }
  assert.equal(typeof AI.SEMANTIC_LAYER_VERSION, 'string');
});

check('purity: every ai/ module on disk is imported by this file', () => {
  // The purity gate is only a gate if it covers everything. A new module that nobody imports here
  // could reach for `window` freely, and the check below that greps the sources would catch the
  // obvious cases but not a lazy `await import('three')`.
  const onDisk = fs.readdirSync(path.join(ROOT, 'renderer/js/ai')).filter((n) => n.endsWith('.js') && n !== 'index.js').sort();
  const imported = ['baseline.js', 'cal.js', 'certainty.js', 'constraints.js', 'diagnose.js', 'events.js', 'explain.js', 'hash.js', 'ids.js', 'intent.js', 'kinematics.js', 'motion.js', 'observe.js', 'patch.js', 'plan.js', 'provenance.js', 'raster.js', 'riggraph.js', 'roles.js', 'scenegraph.js', 'scope.js', 'select.js', 'snapshot.js', 'timelinegraph.js', 'transaction.js', 'vfxspec.js', 'vocabulary.js'];
  assert.deepEqual(onDisk, imported, 'a module was added to renderer/js/ai without being imported at the top of test/aitest.mjs');
});

check('mcp: every semantic-layer tool declares its effect before it is called', () => {
  // Directive Part 50: a tool must state whether it is read-only, preview-only,
  // transaction-creating or destructive. The 140 pre-existing tools predate that convention and
  // are excluded by name; these twelve are the ones that carry it, and this check is what stops
  // a thirteenth from shipping without it.
  const SEMANTIC_TOOLS = [
    'inspect_scene', 'inspect_rig', 'inspect_timeline', 'resolve_semantic', 'selection_vocabulary',
    'set_semantic_role', 'snapshot_scene', 'list_snapshots', 'restore_snapshot', 'diff_snapshots',
    'record_provenance', 'inspect_provenance',
    // Phase 2
    'preview_animation_patch', 'apply_animation_patch', 'rollback_transaction', 'list_transactions',
    'inspect_transaction', 'inspect_constraints', 'lock_constraint', 'unlock_constraint',
    // Phase 3
    'animation_vocabulary', 'set_vocabulary_term', 'interpret_intent', 'plan_motion',
    'apply_motion_plan', 'evaluate_acceptance',
    // Phase 4
    'plan_observation', 'create_baseline', 'list_baselines', 'explain_change', 'approve_difference',
    // Phase 5
    'analyze_motion', 'analyze_contacts', 'explain_motion_problem',
    // Phase 6
    'list_shot_events', 'describe_shot', 'validate_effect_timing', 'compile_effect',
  ];
  const src = fs.readFileSync(path.join(ROOT, 'mcp-server/index.js'), 'utf8');
  const found = new Map();
  for (const m of src.matchAll(/server\.tool\(\s*'([a-z_0-9]+)',\s*\n?\s*'((?:[^'\\]|\\.)*)'/g)) {
    found.set(m[1], m[2]);
  }
  const missing = SEMANTIC_TOOLS.filter((t) => !found.has(t));
  assert.deepEqual(missing, [], `these tools are not registered in mcp-server/index.js: ${missing.join(', ')}`);
  const undeclared = SEMANTIC_TOOLS.filter((t) => !/^(READ-ONLY|MUTATING|DESTRUCTIVE)\b/.test(found.get(t)));
  assert.deepEqual(undeclared, [], `these tools do not open with READ-ONLY / MUTATING / DESTRUCTIVE: ${undeclared.join(', ')}`);

  // The three that change something must say so, and the read-only ones must not claim to.
  assert.ok(found.get('restore_snapshot').startsWith('DESTRUCTIVE'), 'restore_snapshot replaces the whole project and must say DESTRUCTIVE');
  assert.ok(found.get('set_semantic_role').startsWith('MUTATING'), 'set_semantic_role writes to the project');
  assert.ok(found.get('record_provenance').startsWith('MUTATING'), 'record_provenance appends to the project');
  for (const t of ['inspect_scene', 'inspect_rig', 'inspect_timeline', 'resolve_semantic', 'selection_vocabulary', 'list_snapshots', 'diff_snapshots', 'inspect_provenance',
    // A dry run is read-only, and saying so is the point of preview existing at all.
    'preview_animation_patch', 'list_transactions', 'inspect_transaction', 'inspect_constraints',
    'animation_vocabulary', 'interpret_intent', 'plan_motion', 'evaluate_acceptance',
    // explain_change appends an analysis node to provenance and nothing else. That is the same
    // bargain inspect_provenance and evaluate_acceptance already make, and calling it MUTATING
    // would tell a caller to hesitate before asking what changed — exactly backwards.
    'plan_observation', 'list_baselines', 'explain_change',
    // Same bargain again for explain_motion_problem: it records the diagnosis it reached and
    // nothing else. The two measurement tools write nothing at all.
    'analyze_motion', 'analyze_contacts', 'explain_motion_problem',
    // Phase 6's three read tools write nothing at all — not even a provenance record.
    'list_shot_events', 'describe_shot', 'validate_effect_timing']) {
    assert.ok(found.get(t).startsWith('READ-ONLY'), `${t} must be declared READ-ONLY`);
  }
  for (const t of ['apply_animation_patch', 'rollback_transaction', 'lock_constraint', 'unlock_constraint',
    'set_vocabulary_term', 'apply_motion_plan', 'create_baseline', 'approve_difference',
    'compile_effect']) {
    assert.ok(found.get(t).startsWith('MUTATING'), `${t} changes the project and must say MUTATING`);
  }
  // Part 50 also wants rollback capability declared. For the mutating patch tools that is the
  // whole promise, so the word has to be in the description a caller reads before calling.
  assert.ok(/rollback/i.test(found.get('apply_animation_patch')), 'apply_animation_patch must state that it is rollback-capable');
  assert.ok(/rollback/i.test(found.get('apply_motion_plan')), 'apply_motion_plan goes through the same transaction and must say so');
});

check('purity: no ai/ source mentions window, document or three.js', () => {
  const dir = path.join(ROOT, 'renderer/js/ai');
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    // Comments legitimately discuss these; only real code references matter, so lines that are
    // wholly a comment are skipped rather than the words being banned outright.
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    // `window` and `document` must be the GLOBALS, not a property or a local — select.js has an
    // `opts.window` frame range and a `windowFor()` helper, and banning those would be nonsense.
    const patterns = [
      [/(^|[^\w.$])window\s*\./, 'the window global'],
      [/(^|[^\w.$])document\s*\./, 'the document global'],
      [/from\s+['"]three/, 'three.js'],
      [/from\s+['"]\.\.?\/state\.js['"]/, 'state.js'],
    ];
    for (const [re, label] of patterns) if (re.test(code)) offenders.push(`${f}: ${label}`);
  }
  assert.deepEqual(offenders, [], `renderer-only references leaked into the pure layer: ${offenders.join(', ')}`);
});

console.log('\n— hash —');

check('hash: key order does not change the hash', () => {
  assert.equal(H.contentHash({ a: 1, b: [2, 3], c: { d: 4 } }), H.contentHash({ c: { d: 4 }, b: [2, 3], a: 1 }));
});
check('hash: type is part of identity', () => {
  assert.notEqual(H.contentHash({ a: 1 }), H.contentHash({ a: '1' }));
  assert.notEqual(H.contentHash([1, 2]), H.contentHash({ 0: 1, 1: 2 }));
  assert.notEqual(H.contentHash(null), H.contentHash(0));
  assert.notEqual(H.contentHash(false), H.contentHash(0));
});
check('hash: string values cannot impersonate structure', () => {
  // The failure this guards against: a naive concatenating serialiser makes {a:'1,b:2'} and
  // {a:1,b:2} produce the same stream. Length-prefixing every string is what prevents it.
  assert.notEqual(H.contentHash({ a: '1,b:2' }), H.contentHash({ a: 1, b: 2 }));
  assert.notEqual(H.contentHash({ ab: 1 }), H.contentHash({ a: 'b1' }));
});
check('hash: undefined-valued keys are dropped, matching JSON round-trip', () => {
  assert.equal(H.contentHash({ a: 1, b: undefined }), H.contentHash({ a: 1 }));
});
check('hash: -0 normalises to 0 so a save/load is not read as an edit', () => {
  assert.equal(H.contentHash({ x: -0 }), H.contentHash({ x: 0 }));
});
check('hash: floats are compared by their real bits', () => {
  assert.notEqual(H.contentHash(0.1 + 0.2), H.contentHash(0.3));
  assert.equal(H.contentHash(1), H.contentHash(1.0));
});
check('hash: cycles and functions are refused, not silently mangled', () => {
  const a = { x: 1 }; a.self = a;
  assert.throws(() => H.contentHash(a), /cycle/);
  assert.throws(() => H.contentHash({ f: () => 1 }), /function/);
});
check('hash: distribution — 4096 near-identical values give 4096 distinct hashes', () => {
  const seen = new Set();
  for (let i = 0; i < 4096; i++) seen.add(H.contentHash({ t: i, v: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] }));
  assert.equal(seen.size, 4096);
});
check('hash: fingerprint reports canonical length as a collision guard', () => {
  const fp = H.contentFingerprint({ a: 1 });
  assert.ok(fp.length > 0 && typeof fp.hash === 'string' && fp.hash.length === 32);
});
check('hash: canonicalJSON sorts keys', () => {
  assert.equal(H.canonicalJSON({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

console.log('\n— certainty —');

check('certainty: a finding without a valid level cannot be constructed', () => {
  assert.throws(() => C.finding({ id: 'X', certainty: 'pretty sure', statement: 'hi' }), /certainty must be one of/);
  assert.throws(() => C.finding({ id: 'X', certainty: C.CERTAINTY.CERTAIN }), /statement is required/);
});
check('certainty: evidence kinds are closed', () => {
  assert.throws(() => C.evidence('vibes', 'x'), /unknown kind/);
  assert.equal(C.evidence('measurement', 'x', { n: 1 }).detail.n, 1);
});
check('certainty: subjective and user-intent are not actionable', () => {
  assert.equal(C.isActionable(C.CERTAINTY.CERTAIN), true);
  assert.equal(C.isActionable(C.CERTAINTY.SUBJECTIVE), false);
  assert.equal(C.requiresUser(C.CERTAINTY.USER_INTENT_REQUIRED), true);
  assert.equal(C.requiresUser(C.CERTAINTY.POSSIBLE), false);
});
check('certainty: findings sort most-certain first, then by frame, stably', () => {
  const f = (id, c, frame) => C.finding({ id, certainty: c, statement: id, frame });
  const out = C.sortFindings([
    f('a', C.CERTAINTY.POSSIBLE, 5), f('b', C.CERTAINTY.CERTAIN, 9),
    f('c', C.CERTAINTY.CERTAIN, 2), f('d', C.CERTAINTY.SUBJECTIVE, 1),
  ]).map((x) => x.id);
  assert.deepEqual(out, ['c', 'b', 'a', 'd']);
});
check('certainty: coverage refuses an unknown loop and keeps notRun verbatim', () => {
  assert.throws(() => C.coverage({ scope: 'x', loop: 'medium' }), /fast.*full/);
  assert.deepEqual(C.coverage({ scope: 'x', notRun: ['y'] }).notRun, ['y']);
});

console.log('\n— ids —');

check('ids: a joint id survives a rename because it is derived from topology', () => {
  const j = { name: 'LeftShoulder', part0: 'UpperTorso', part1: 'LeftUpperArm' };
  const renamed = { ...j, name: 'ShoulderL_v2' };
  assert.equal(IDS.jointId('hero', j), IDS.jointId('hero', renamed));
});
check('ids: a weld and a motor into the same part get different ids', () => {
  const a = { name: 'x', part0: 'A', part1: 'B' };
  assert.notEqual(IDS.jointId('h', a), IDS.jointId('h', { ...a, kind: 'weld' }));
});
check('ids: separators in a name cannot forge another entity', () => {
  const weird = IDS.partId('hero', 'Left/Right:Split');
  assert.deepEqual(IDS.parseId(weird), { type: 'part', itemId: 'hero', partId: 'Left/Right:Split' });
});
check('ids: every id type round-trips through parseId', () => {
  assert.deepEqual(IDS.parseId(IDS.itemId({ id: 'a' })), { type: 'item', itemId: 'a' });
  assert.deepEqual(IDS.parseId(IDS.trackId('a', '@origin')), { type: 'track', itemId: 'a', track: '@origin' });
  assert.deepEqual(IDS.parseId(IDS.keyId('a', 'RightWrist', 12.5)), { type: 'key', itemId: 'a', track: 'RightWrist', t: 12.5 });
  assert.deepEqual(IDS.parseId(IDS.markerId('a', 3)), { type: 'marker', itemId: 'a', t: 3 });
  assert.equal(IDS.parseId('nonsense'), null);
});
check('ids: durability is reported honestly per type', () => {
  assert.equal(IDS.idDurability('item').native, true);
  assert.equal(IDS.idDurability('joint').native, false);
  assert.ok(IDS.idDurability('key').survivesNot.some((s) => /moving the key/.test(s)));
});

console.log('\n— kinematics —');

check('kinematics: a track holds before the first and after the last key', () => {
  const tr = { keys: [{ t: 5, v: 10 }, { t: 10, v: 20 }] };
  assert.equal(K.evalTrackNum(tr, 0), 10);
  assert.equal(K.evalTrackNum(tr, 99), 20);
  assert.equal(K.evalTrackNum(tr, 5), 10);
  assert.equal(K.evalTrackNum(tr, 10), 20);
});
check('kinematics: linear easing interpolates exactly', () => {
  const tr = { keys: [{ t: 0, v: 0, es: 'Linear', ed: 'Out' }, { t: 10, v: 100, es: 'Linear', ed: 'Out' }] };
  assert.ok(Math.abs(K.evalTrackNum(tr, 5) - 50) < 1e-9);
});
check('kinematics: an empty or missing track returns the fallback, not a throw', () => {
  assert.equal(K.evalTrackNum(null, 3, 7), 7);
  assert.equal(K.evalTrackNum({ keys: [] }, 3, 7), 7);
  assert.deepEqual(K.evalTrackCF(undefined, 3), CF.IDENTITY);
});
check('kinematics: a held CFrame is a copy, so a caller cannot mutate project data through it', () => {
  const key = { t: 0, v: I() };
  const tr = { keys: [key] };
  const out = K.evalTrackCF(tr, 99);
  out[0] = 999;
  assert.equal(key.v[0], 0);
});
check('kinematics: FK with an identity pose reproduces r6/r15 rest poses exactly', () => {
  for (const name of ['r6', 'r15']) {
    const rig = RIGS[name];
    const plan = K.buildSolvePlan(rig);
    const worlds = K.solveWorlds(plan, {}, CF.IDENTITY, null);
    for (const p of rig.parts) {
      const w = worlds.get(p.id);
      assert.ok(w, `${name}: ${p.id} was not solved`);
      const d = Math.max(...w.map((v, i) => Math.abs(v - p.cf[i])));
      assert.ok(d < 1e-4, `${name}: ${p.id} deviates ${d} from its rest CFrame`);
    }
  }
});
check('kinematics: rthro rest data is INCONSISTENT — this is a real defect, pinned so it cannot regress silently', () => {
  // rthro/rthroSlender carry Rthro-proportioned joint offsets but partly R15-proportioned part
  // rest CFrames. The rig renders correctly (the viewport solves from the joint chain) but
  // anything reading part.cf — notably state.js addJoint, which derives C0 as P0rest⁻¹·P1rest —
  // works from stale numbers. If this test starts failing because the deviation vanished, the rig
  // data was fixed and this test should become the r6/r15 one above.
  for (const name of ['rthro', 'rthroSlender']) {
    const rig = RIGS[name];
    const plan = K.buildSolvePlan(rig);
    const worlds = K.solveWorlds(plan, {}, CF.IDENTITY, null);
    const worst = Math.max(...rig.parts.map((p) => K.distance(worlds.get(p.id), p.cf)));
    assert.ok(worst > 0.5, `${name}: expected the known rest-pose inconsistency (>0.5 studs), measured ${worst}`);
  }
});
check('kinematics: solve order matches the renderer — first motor per part1 drives it', () => {
  const rig = {
    rootPart: 'A',
    parts: [{ id: 'A', cf: I() }, { id: 'B', cf: I() }],
    joints: [
      { name: 'first', part0: 'A', part1: 'B', c0: I(), c1: I() },
      { name: 'second', part0: 'A', part1: 'B', c0: I(), c1: I() },
    ],
  };
  const plan = K.buildSolvePlan(rig);
  assert.equal(plan.steps.filter((s) => s.isMotor).length, 1);
  assert.equal(plan.steps.find((s) => s.isMotor).j.name, 'first');
});
check('kinematics: a part no joint reaches rides the root rigidly', () => {
  const rig = {
    rootPart: 'A',
    parts: [{ id: 'A', cf: I() }, { id: 'Loose', cf: CF.setPosition(I(), 3, 0, 0) }],
    joints: [],
  };
  const plan = K.buildSolvePlan(rig);
  assert.deepEqual(plan.staticParts.map((s) => s.id), ['Loose']);
  const worlds = K.solveWorlds(plan, {}, CF.setPosition(I(), 0, 5, 0));
  assert.deepEqual(worlds.get('Loose').slice(0, 3), [3, 5, 0]);
});
check('kinematics: an attached item follows its parent part at an arbitrary frame', () => {
  const p = fixture();
  const sword = p.items.find((i) => i.id === 'sword');
  const at0 = K.itemOriginAt(p, sword, 0);
  const at16 = K.itemOriginAt(p, sword, 16);
  const hand16 = K.solveItemWorlds(p, p.items[0], 16).get('RightHand');
  assert.deepEqual(at16, hand16);
  assert.ok(K.distance(at0, at16) > 0.1, 'the sword should have moved with the animated arm');
});
check('kinematics: an attachment cycle terminates instead of hanging', () => {
  const a = { id: 'a', kind: 'rig', name: 'A', rig: RIGS.r6, origin: I(), attachedTo: { itemId: 'b', partId: 'Torso', offset: I() } };
  const b = { id: 'b', kind: 'rig', name: 'B', rig: RIGS.r6, origin: I(), attachedTo: { itemId: 'a', partId: 'Torso', offset: I() } };
  const p = { id: 'x', items: [a, b], tracks: {} };
  assert.ok(Array.isArray(K.itemOriginAt(p, a, 0)));
});
check('kinematics: keyTimesOf excludes reserved tracks by default', () => {
  const p = fixture();
  assert.deepEqual(K.keyTimesOf(p.tracks.hero), [0, 8, 10, 16, 20]);
  assert.deepEqual(K.keyTimesOf(p.tracks.hero, { includeReserved: true }), [0, 8, 10, 16, 20]);
});

console.log('\n— roles —');

check('roles: every part and joint of all four builtin rigs maps exactly', () => {
  const p = { id: 'x', items: [], tracks: {} };
  for (const name of Object.keys(RIGS)) {
    const item = { id: 'i', kind: 'rig', name, rig: RIGS[name] };
    for (const part of RIGS[name].parts) {
      const r = R.partRole(p, item, part);
      assert.equal(r.source, 'exact', `${name}/${part.id} was not an exact match (got ${r.source})`);
      assert.equal(r.certainty, C.CERTAINTY.CERTAIN);
    }
    for (const j of RIGS[name].joints) {
      const r = R.jointRole(p, item, j);
      assert.equal(r.source, 'exact', `${name}/${j.name} was not an exact match (got ${r.source})`);
    }
  }
});
check('roles: R15 splits the torso correctly — LowerTorso is the hips, UpperTorso the chest', () => {
  const p = { id: 'x', items: [], tracks: {} };
  const item = { id: 'i', kind: 'rig', name: 'r15', rig: RIGS.r15 };
  const role = (id) => R.partRole(p, item, RIGS.r15.parts.find((q) => q.id === id)).role;
  assert.equal(role('LowerTorso'), R.ROLE.HIPS);
  assert.equal(role('UpperTorso'), R.ROLE.CHEST);
});
check('roles: Mixamo and Blender names fall back to a token match at lower certainty', () => {
  const p = { id: 'x', items: [], tracks: {} };
  const item = { id: 'i', kind: 'rig', name: 'custom', rig: { rigType: null, rootPart: 'Hips', parts: [], joints: [] } };
  const t = (n) => R.partRole(p, item, { id: n, name: n });
  assert.equal(t('mixamorig:LeftForeArm').role, R.ROLE.LOWER_ARM);
  assert.equal(t('mixamorig:LeftForeArm').side, R.SIDE.LEFT);
  assert.equal(t('mixamorig:LeftForeArm').certainty, C.CERTAINTY.POSSIBLE);
  assert.equal(t('arm_lower.L').role, R.ROLE.LOWER_ARM);
  assert.equal(t('RightUpLeg').role, R.ROLE.UPPER_LEG);
  assert.equal(t('Bone_047').role, R.ROLE.UNKNOWN);
  assert.equal(t('Bone_047').certainty, C.CERTAINTY.USER_INTENT_REQUIRED);
});
check('roles: a specific token beats a general one', () => {
  const p = { id: 'x', items: [], tracks: {} };
  const item = { id: 'i', kind: 'rig', name: 'c', rig: { parts: [], joints: [] } };
  assert.equal(R.partRole(p, item, { id: 'a', name: 'LowerArm' }).role, R.ROLE.LOWER_ARM);
  assert.equal(R.partRole(p, item, { id: 'a', name: 'UpperTorso_ref' }).role, R.ROLE.CHEST);
  assert.equal(R.partRole(p, item, { id: 'a', name: 'ToeBase' }).role, R.ROLE.TOE);
});
check('roles: an unnamed joint is inferred from the part it drives, at lower confidence', () => {
  const p = { id: 'x', items: [], tracks: {} };
  const item = { id: 'i', kind: 'rig', name: 'c', rig: { rigType: 'R15', rootPart: 'HumanoidRootPart', parts: RIGS.r15.parts, joints: [] } };
  const r = R.jointRole(p, item, { name: 'J_0042', part0: 'LeftLowerArm', part1: 'LeftHand', c0: I(), c1: I() });
  assert.equal(r.role, R.ROLE.WRIST);
  assert.equal(r.certainty, C.CERTAINTY.POSSIBLE);
  assert.ok(r.evidence.some((e) => e.kind === 'inference'));
});
check('roles: a pinned role wins and is marked certain', () => {
  const p = fixture();
  R.setRole(p, 'hero', 'parts', 'LeftHand', R.ROLE.WEAPON, { reason: 'holds the blade' });
  const item = p.items[0];
  const r = R.partRole(p, item, item.rig.parts.find((q) => q.id === 'LeftHand'));
  assert.equal(r.role, R.ROLE.WEAPON);
  assert.equal(r.source, 'override');
  assert.equal(r.certainty, C.CERTAINTY.CERTAIN);
  assert.equal(R.listOverrides(p).length, 1);
  R.setRole(p, 'hero', 'parts', 'LeftHand', null);
  assert.equal(R.listOverrides(p).length, 0);
});
check('roles: setRole refuses an unknown role or kind', () => {
  const p = fixture();
  assert.throws(() => R.setRole(p, 'hero', 'parts', 'Head', 'elbow_ish'), /not a known role/);
  assert.throws(() => R.setRole(p, 'hero', 'bones', 'Head', R.ROLE.HEAD), /items\|parts\|joints/);
});
check('roles: mirrorName swaps once, never back to itself', () => {
  assert.equal(R.mirrorName('LeftUpperArm'), 'RightUpperArm');
  assert.equal(R.mirrorName('RightUpperArm'), 'LeftUpperArm');
  assert.equal(R.mirrorName('Right Shoulder'), 'Left Shoulder');
  assert.equal(R.mirrorName('arm_lower.L'), 'arm_lower.R');
  assert.equal(R.mirrorName('Head'), null);
});
check('roles: contact capability and midline classification', () => {
  assert.equal(R.isContactCapable(R.ROLE.FOOT), true);
  assert.equal(R.isContactCapable(R.ROLE.HEAD), false);
  assert.equal(R.isMidline(R.ROLE.HIPS), true);
  assert.equal(R.isMidline(R.ROLE.HAND), false);
  assert.ok(R.chainDepth(R.ROLE.HAND) > R.chainDepth(R.ROLE.SHOULDER));
});

console.log('\n— rig graph —');

check('rig graph: R15 produces the expected chains and clean validation', () => {
  const p = fixture();
  const g = RG.rigGraph(p, p.items[0]);
  assert.equal(g.counts.parts, 16);
  assert.equal(g.counts.motors, 15);
  assert.equal(g.validation.findings.length, 0, `unexpected findings: ${g.validation.findings.map((f) => f.id).join(', ')}`);
  const hand = g.ik_chains.find((c) => c.tip_role === R.ROLE.HAND && c.side === R.SIDE.RIGHT);
  assert.deepEqual(hand.joint_names, ['RightWrist', 'RightElbow', 'RightShoulder']);
});
check('rig graph: joint_limits is null everywhere, and that is stated as unknown', () => {
  const p = fixture();
  const g = RG.rigGraph(p, p.items[0]);
  assert.ok(g.components.every((c) => c.joint_limits === null));
  assert.ok(g.limitations.some((l) => /joint_limits is null/.test(l) && /unlimited/.test(l)));
});
check('rig graph: mirror partners resolve both ways on R15', () => {
  const p = fixture();
  const g = RG.rigGraph(p, p.items[0]);
  const l = g.components.find((c) => c.name === 'LeftElbow');
  const r = g.components.find((c) => c.name === 'RightElbow');
  assert.equal(l.mirror_partner, r.id);
  assert.equal(r.mirror_partner, l.id);
  assert.equal(g.components.find((c) => c.name === 'Neck').mirror_partner, null);
});
check('rig graph: R6 is flagged as rotated-bind, which is true and matters for axis heuristics', () => {
  const p = fixture({ rig: 'r6' });
  const g = RG.rigGraph(p, p.items[0]);
  const f = g.validation.findings.find((x) => x.id === 'RIG-ROTATED-BIND');
  assert.ok(f, 'R6 C0/C1 carry real 90-degree rotations and must be reported');
  assert.equal(f.certainty, C.CERTAINTY.CERTAIN);
  assert.ok(g.components.filter((c) => c.local_axis_convention === 'rotated-bind').length === 6);
});
check('rig graph: rthro rest inconsistency is caught by validation', () => {
  const p = fixture({ rig: 'rthro' });
  const f = RG.rigGraph(p, p.items[0]).validation.findings.find((x) => x.id === 'RIG-REST-INCONSISTENT');
  assert.ok(f, 'the rthro rest-pose inconsistency must be reported');
  assert.equal(f.certainty, C.CERTAINTY.CERTAIN);
  assert.ok(f.evidence.some((e) => e.kind === 'measurement'));
  assert.ok(/addJoint/.test(f.evidence.map((e) => e.statement).join(' ')), 'the impact on addJoint must be spelled out');
});
check('rig graph: a duplicate motor and a joint-name clash are both caught', () => {
  const rig = {
    rigType: 'R15', rootPart: 'A',
    parts: [{ id: 'A', name: 'A', cf: I() }, { id: 'B', name: 'B', cf: I() }],
    joints: [
      { name: 'Dup', part0: 'A', part1: 'B', c0: I(), c1: I() },
      { name: 'Dup', part0: 'A', part1: 'B', c0: I(), c1: I() },
    ],
  };
  const item = { id: 'i', kind: 'rig', name: 'bad', rig };
  const v = RG.validateRig({ id: 'x', items: [item], tracks: {} }, item);
  const idsFound = v.findings.map((f) => f.id);
  assert.ok(idsFound.includes('RIG-DOUBLE-MOTOR'), idsFound.join(','));
  assert.ok(idsFound.includes('RIG-JOINT-NAME-CLASH'), idsFound.join(','));
});
check('rig graph: validation coverage names what it did NOT check', () => {
  const p = fixture();
  const v = RG.validateRig(p, p.items[0]);
  assert.equal(v.coverage.loop, 'full');
  assert.ok(v.coverage.notRun.length >= 4);
  assert.ok(v.coverage.notRun.some((s) => /pose validity/.test(s)));
});
check('rig graph: revision changes when the rig changes and not when a track does', () => {
  const p = fixture();
  const before = RG.rigGraph(p, p.items[0]).revision;
  p.tracks.hero.RightElbow.keys.push({ t: 20, v: I() });
  assert.equal(RG.rigGraph(p, p.items[0]).revision, before);
  p.items[0].rig = { ...p.items[0].rig, rootPart: 'UpperTorso' };
  assert.notEqual(RG.rigGraph(p, p.items[0]).revision, before);
});

console.log('\n— timeline graph —');

check('timeline graph: counts, key times and the occupied range', () => {
  const p = fixture();
  const t = TG.timelineGraph(p, p.items[0], { includeKeys: true });
  assert.equal(t.counts.tracks, 5);
  assert.equal(t.counts.keys, 3 + 2 + 3 + 1 + 1);
  assert.deepEqual(t.key_times, [0, 8, 10, 16, 20]);
  assert.deepEqual(t.occupied_range, { start: 0, end: 20 });
});
check('timeline graph: fps travels with every derived seconds value', () => {
  const p = fixture();
  const t = TG.timelineGraph(p, p.items[0], { includeKeys: true });
  assert.equal(t.time.canonical_unit, 'frame');
  assert.equal(t.time.fps, 30);
  assert.equal(t.time.length_seconds, 2);
  const k = t.tracks.find((x) => x.name === 'RightShoulder').keyframes.find((x) => x.time === 16);
  // `seconds` is rounded to 6 dp — sub-microsecond at any sane frame rate, and readable. `time`
  // stays exact, which is what matters: frames are the canonical unit and seconds are derived.
  assert.equal(k.seconds, +(16 / 30).toFixed(6));
  assert.equal(k.time, 16);
});
check('timeline graph: layer, blend_mode, weight and tangents are null, not invented', () => {
  const p = fixture();
  const t = TG.timelineGraph(p, p.items[0], { includeKeys: true });
  for (const tr of t.tracks) {
    assert.equal(tr.layer, null);
    assert.equal(tr.blend_mode, null);
    assert.equal(tr.weight, null);
    for (const k of tr.keyframes) { assert.equal(k.in_tangent, null); assert.equal(k.out_tangent, null); }
  }
  assert.ok(t.limitations.some((l) => /no animation layers/.test(l)));
});
check('timeline graph: an orphaned joint track is reported, not hidden', () => {
  const p = fixture();
  const t = TG.timelineGraph(p, p.items[0]);
  const ghost = t.tracks.find((x) => x.name === 'GhostJoint');
  assert.equal(ghost.dependencies[0].target, null);
  assert.ok(/orphaned/.test(ghost.dependencies[0].note));
  const real = t.tracks.find((x) => x.name === 'RightElbow');
  assert.ok(real.dependencies[0].target.startsWith('joint:hero/'));
});
check('timeline graph: mixed interpolation is reported as mixed', () => {
  const p = fixture();
  const t = TG.timelineGraph(p, p.items[0], { includeKeys: true });
  assert.deepEqual(t.tracks.find((x) => x.name === 'RightShoulder').interpolation, { mixed: ['Cubic/Out', 'Quad/InOut'] });
  assert.equal(t.tracks.find((x) => x.name === 'RightElbow').interpolation, 'Cubic/Out');
});
check('timeline graph: track kinds are classified, including action tracks', () => {
  const p = fixture();
  p.tracks.hero['@act:PlaySound'] = { keys: [{ t: 4, v: true }], vtype: 'boolean', action: 'PlaySound' };
  const t = TG.timelineGraph(p, p.items[0]);
  const kinds = Object.fromEntries(t.tracks.map((x) => [x.name, x.kind]));
  assert.equal(kinds.RightShoulder, 'joint');
  assert.equal(kinds['@origin'], 'origin');
  assert.equal(kinds['@act:PlaySound'], 'action');
  assert.equal(t.tracks.find((x) => x.name === '@act:PlaySound').action_key, 'PlaySound');
});
check('timeline graph: sampleTrack explains which segment and easing produced the value', () => {
  const p = fixture();
  const s = TG.sampleTrack(p, 'hero', 'RightShoulder', 6);
  assert.equal(s.regime, 'interpolated');
  assert.equal(s.between.from, 'key:hero/RightShoulder@0');
  assert.equal(s.between.to, 'key:hero/RightShoulder@8');
  assert.equal(s.between.easing, 'Cubic/Out');
  assert.equal(s.between.alpha_position, 0.75);
  assert.equal(TG.sampleTrack(p, 'hero', 'RightShoulder', 99).regime, 'held after the last key');
});
check('timeline graph: key annotations round-trip through project.semantics', () => {
  const p = fixture();
  p.semantics = { annotations: { hero: { RightShoulder: { 8: { phase: 'anticipation', intent: 'wind-up', locked: true, transaction: 'txn:1' } } } } };
  const k = TG.timelineGraph(p, p.items[0], { includeKeys: true })
    .tracks.find((x) => x.name === 'RightShoulder').keyframes.find((x) => x.time === 8);
  assert.equal(k.phase_annotation, 'anticipation');
  assert.equal(k.lock_state, 'locked');
  assert.equal(k.transaction_origin, 'txn:1');
});

console.log('\n— scene graph —');

check('scene graph: items, roles, counts and attachment parentage', () => {
  const p = fixture();
  const g = SG.sceneGraph(p, { frame: 16 });
  assert.deepEqual(g.counts, { items: 3, rigs: 1, cameras: 1, props: 1, effects: 0 });
  const sword = g.objects.find((o) => o.name === 'Sword');
  assert.equal(sword.parent_id, 'item:hero');
  assert.equal(sword.semantic_role, R.ROLE.PROP);
  assert.deepEqual(g.objects.find((o) => o.name === 'Hero').children_ids, ['item:sword']);
});
check('scene graph: an attached item is placed at its parent part, at the requested frame', () => {
  const p = fixture();
  const at16 = SG.sceneGraph(p, { frame: 16 }).objects.find((o) => o.name === 'Sword').world_transform;
  const at0 = SG.sceneGraph(p, { frame: 0 }).objects.find((o) => o.name === 'Sword').world_transform;
  assert.deepEqual(at16, K.solveItemWorlds(p, p.items[0], 16).get('RightHand'));
  assert.ok(K.distance(at0, at16) > 0.1);
});
check('scene graph: dependency edges cover hierarchy, animation binding and attachment', () => {
  const p = fixture();
  const g = SG.sceneGraph(p, { frame: 0 });
  assert.deepEqual(g.dependency_graph.types_present, ['animation_binding', 'attachment', 'transform_inheritance']);
  const att = g.dependency_graph.edges.find((e) => e.dependency_type === 'attachment');
  assert.equal(att.source, 'part:hero/RightHand');
  assert.equal(att.target, 'item:sword');
  assert.ok(g.dependency_graph.types_absent.every((t) => t.reason));
});
check('scene graph: materials and lights are null with a reason, not omitted', () => {
  const p = fixture();
  const g = SG.sceneGraph(p, { frame: 0 });
  assert.ok(g.objects.every((o) => o.material_ids === null && o.light_relationships === null));
  assert.ok(g.limitations.some((l) => /no material or light entities/.test(l)));
});
check('scene graph: the projection works on a project with no camera and says what that costs', () => {
  const p = fixture();
  p.items = p.items.filter((i) => i.kind !== 'camera');
  delete p.tracks.cam;
  const g = SG.sceneGraph(p, { frame: 0 });
  assert.ok(g.limitations.some((l) => /no camera exists/.test(l) && /screen-space/.test(l)));
});
check('scene graph: revision ignores baked textures', () => {
  const p = fixture();
  const before = SG.sceneGraph(p, { frame: 0 }).revision;
  p.items[0].rig = { ...p.items[0].rig, parts: p.items[0].rig.parts.map((q) => ({ ...q, customTexture: 'data:image/png;base64,AAAA' })) };
  assert.equal(SG.sceneGraph(p, { frame: 0 }).revision, before);
});
check('scene graph: resolveEntity is the exact inverse of the id scheme', () => {
  const p = fixture();
  assert.equal(SG.resolveEntity(p, 'item:hero').item.name, 'Hero');
  assert.equal(SG.resolveEntity(p, 'part:hero/RightHand').part.id, 'RightHand');
  assert.equal(SG.resolveEntity(p, 'joint:hero/RightLowerArm->RightHand/motor').joint.name, 'RightWrist');
  assert.equal(SG.resolveEntity(p, 'track:hero/RightElbow').trackName, 'RightElbow');
  assert.equal(SG.resolveEntity(p, 'key:hero/RightElbow@16').key.t, 16);
  assert.equal(SG.resolveEntity(p, 'marker:hero@16').marker.name, 'impact');
  assert.equal(SG.resolveEntity(p, 'part:hero/NoSuchPart'), null);
});

console.log('\n— semantic selection —');

check('select: a plain role query resolves with certainty on a standard rig', () => {
  const p = fixture();
  const r = SEL.resolve(p, 'the left foot');
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].entityId, 'part:hero/LeftFoot');
  assert.equal(r.matches[0].certainty, C.CERTAINTY.CERTAIN);
});
check('select: "the torso" falls back to the chest on R15 and says so', () => {
  const p = fixture();
  const r = SEL.resolve(p, 'the torso');
  assert.equal(r.matches[0].entityId, 'part:hero/UpperTorso');
  assert.ok(/nearest equivalent/.test(r.interpretation));
  assert.ok(r.alternatives.some((a) => a.entityId === 'part:hero/LowerTorso'));
});
check('select: a singular query with two equal matches is ambiguous and asks', () => {
  const p = fixture();
  const r = SEL.resolve(p, 'the hand');
  assert.equal(r.matches.length, 2);
  assert.equal(r.ambiguous, true);
  assert.ok(r.question);
});
check('select: a plural query returns both without asking', () => {
  const p = fixture();
  const r = SEL.resolve(p, 'the hands');
  assert.equal(r.matches.length, 2);
  assert.equal(r.ambiguous, false);
  assert.equal(r.question, null);
});
check('select: the planted foot is measured, and is never reported as certain', () => {
  const p = fixture();
  const r = SEL.resolve(p, 'the planted foot', { frame: 10 });
  assert.equal(r.matches[0].entityId, 'part:hero/LeftFoot');
  assert.equal(r.matches[0].certainty, C.CERTAINTY.HIGHLY_LIKELY);
  assert.ok(r.matches[0].evidence.some((e) => e.kind === 'measurement'));
  assert.deepEqual(r.coverage.frames, [7, 8, 9, 10, 11, 12, 13]);
  assert.ok(r.coverage.notRun.some((s) => /ContactSpec/.test(s)));
});
check('select: the free foot is the other one', () => {
  const p = fixture();
  assert.equal(SEL.resolve(p, 'the free foot', { frame: 10 }).matches[0].entityId, 'part:hero/RightFoot');
});
check('select: with two rigs it asks which character rather than measuring the first', () => {
  const p = fixture();
  p.items.push({ id: 'hero2', kind: 'rig', name: 'Hero 2', rig: RIGS.r15, origin: I() });
  const r = SEL.resolve(p, 'the planted foot', { frame: 10 });
  assert.equal(r.resolved, false);
  assert.equal(r.ambiguous, true);
  assert.ok(/Which character/.test(r.question));
  // …and naming one resolves it.
  assert.equal(SEL.resolve(p, 'the planted foot', { frame: 10, itemId: 'hero' }).matches[0].entityId, 'part:hero/LeftFoot');
});
check('select: with no motion at all it refuses rather than guessing', () => {
  const p = fixture();
  delete p.tracks.hero.RightHip;
  const r = SEL.resolve(p, 'the planted foot', { frame: 10 });
  assert.equal(r.resolved, false);
  assert.ok(/Neither foot moves/.test(r.question));
});
check('select: the weapon hand resolves from an attachment', () => {
  const p = fixture();
  const r = SEL.resolve(p, 'the weapon hand');
  assert.equal(r.matches[0].entityId, 'part:hero/RightHand');
  assert.equal(r.matches[0].certainty, C.CERTAINTY.HIGHLY_LIKELY);
  R.setRole(p, 'sword', 'items', 'sword', R.ROLE.WEAPON);
  assert.equal(SEL.resolve(p, 'the weapon hand').matches[0].certainty, C.CERTAINTY.CERTAIN);
});
check('select: with nothing held it asks instead of picking the right hand', () => {
  const p = fixture();
  p.items = p.items.filter((i) => i.id !== 'sword');
  const r = SEL.resolve(p, 'the weapon hand');
  assert.equal(r.resolved, false);
  assert.equal(r.matches.length, 0);
  assert.ok(/Which of these/.test(r.question));
  assert.equal(r.alternatives.length, 2);
});
check('select: the impact target is refused honestly, naming the missing system', () => {
  const p = fixture();
  const r = SEL.resolve(p, 'the impact target');
  assert.equal(r.resolved, false);
  assert.ok(/shot-event system/.test(r.question));
});
check('select: an unknown phrase lists what is understood', () => {
  const p = fixture();
  const r = SEL.resolve(p, 'the flux capacitor');
  assert.equal(r.resolved, false);
  assert.ok(/does not name a role/.test(r.question));
  assert.ok(SEL.vocabulary().roles.includes('elbow'));
  assert.ok(SEL.vocabulary().special.includes('planted foot'));
});
check('select: a structured selector works without any parsing', () => {
  const p = fixture();
  const r = SEL.resolve(p, { role: R.ROLE.ELBOW, side: R.SIDE.RIGHT, kind: 'joint' });
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].name, 'RightElbow');
});

console.log('\n— snapshots —');

check('snapshot: identical content is deduplicated', () => {
  const store = new SNAP.SnapshotStore();
  const p = fixture();
  const a = store.take(p, { reason: 'first' });
  const b = store.take(p, { reason: 'again' });
  assert.equal(a.hash, b.hash);
  assert.equal(b.deduplicated, true);
  assert.equal(store.stats().count, 1);
});
check('snapshot: a snapshot is frozen and does not follow later edits', () => {
  const store = new SNAP.SnapshotStore();
  const p = fixture();
  const s = store.take(p);
  p.tracks.hero.RightElbow.keys.push({ t: 30, v: I() });
  assert.equal(store.get(s.id).project.tracks.hero.RightElbow.keys.length, 2);
  assert.throws(() => { store.get(s.id).project.tracks.hero.RightElbow.keys.push({ t: 40, v: I() }); });
});
check('snapshot: restore hands back a mutable copy', () => {
  const store = new SNAP.SnapshotStore();
  const s = store.take(fixture());
  const back = store.restore(s.id);
  back.name = 'edited';
  assert.equal(store.get(s.id).project.name, 'Slash');
});
check('snapshot: a pinned snapshot is never evicted', () => {
  const store = new SNAP.SnapshotStore({ capacity: 3 });
  const base = fixture();
  const pinned = store.take(base, { pinned: true, reason: 'baseline' });
  for (let i = 0; i < 10; i++) {
    const p = fixture();
    p.length = 100 + i;
    store.take(p);
  }
  assert.ok(store.get(pinned.id), 'the pinned baseline was evicted');
  assert.ok(store.stats().evicted > 0);
  assert.ok(store.stats().count <= 3);
});
check('snapshot: cloneProject shares strings but copies containers', () => {
  const big = 'data:image/png;base64,' + 'A'.repeat(1000);
  const src = { a: { tex: big }, arr: [1, 2] };
  const out = SNAP.cloneProject(src);
  assert.equal(out.a.tex, big);
  assert.notEqual(out.a, src.a);
  assert.notEqual(out.arr, src.arr);
  out.arr.push(3);
  assert.equal(src.arr.length, 2);
});
check('snapshot: cloneProject survives a cycle', () => {
  const a = { n: 1 }; a.self = a;
  const out = SNAP.cloneProject(a);
  assert.equal(out.self, out);
});
check('snapshot: provenance is excluded, so taking a snapshot cannot change what it snapshots', () => {
  // The bug this pins: snapshot_scene records "a snapshot was taken" into provenance, which lives
  // inside the project. If a snapshot captured provenance, every consecutive snapshot would
  // differ by that record and deduplication would never fire.
  const store = new SNAP.SnapshotStore();
  const p = fixture();
  const first = store.take(p, { reason: 'first' });
  PRV.record(p, { type: 'snapshot', summary: 'a snapshot was taken' });
  const second = store.take(p, { reason: 'second' });
  assert.equal(second.hash, first.hash);
  assert.equal(second.deduplicated, true);
  assert.equal(store.get(first.id).project.semantics?.provenance, undefined);
  assert.ok(second.not_captured.some((s) => /provenance/.test(s)));
});
check('snapshot: role overrides ARE captured, because they are state and not history', () => {
  const store = new SNAP.SnapshotStore();
  const p = fixture();
  const before = store.take(p);
  R.setRole(p, 'hero', 'parts', 'RightHand', R.ROLE.WEAPON);
  assert.notEqual(store.take(p).hash, before.hash);
  assert.equal(store.get(before.id).project.semantics?.roles, undefined);
});
check('diff: a growing provenance log is not reported as a change to the animation', () => {
  const a = fixture(), b = fixture();
  PRV.record(b, { type: 'note', summary: 'something happened' });
  assert.equal(SNAP.diffProjects(a, b).identical, true);
});

console.log('\n— diff —');

check('diff: identical projects report identical', () => {
  const d = SNAP.diffProjects(fixture(), fixture());
  assert.equal(d.identical, true);
  assert.equal(d.summary, 'Identical');
});
check('diff: one added keyframe reads as one added key, not a whole-track change', () => {
  const a = fixture(), b = fixture();
  b.tracks.hero.RightShoulder.keys.splice(1, 0, { t: 4, v: I() });
  b.tracks.hero.RightShoulder.keys.sort((x, y) => x.t - y.t);
  const d = SNAP.diffProjects(a, b);
  assert.equal(d.tracks.length, 1);
  assert.deepEqual(d.tracks[0].keys_added, [4]);
  assert.deepEqual(d.tracks[0].keys_removed, []);
  assert.deepEqual(d.tracks[0].keys_modified, []);
});
check('diff: a changed value reports the field that changed and the frame range', () => {
  const a = fixture(), b = fixture();
  b.tracks.hero.RightElbow.keys[1].v = CF.fromEuler(0.9, 0, 0);
  b.tracks.hero.RightElbow.keys[1].es = 'Elastic';
  const d = SNAP.diffProjects(a, b);
  assert.deepEqual(d.tracks[0].keys_modified[0].fields, ['es', 'v']);
  assert.deepEqual(d.changed_frame_range, { start: 16, end: 16 });
});
check('diff: added, removed and changed items are all reported', () => {
  const a = fixture(), b = fixture();
  b.items = b.items.filter((i) => i.id !== 'cam');
  b.items.push({ id: 'new', kind: 'camera', name: 'Camera 2' });
  b.items[0].name = 'Hero (renamed)';
  const d = SNAP.diffProjects(a, b);
  assert.deepEqual(d.items.added, ['new']);
  assert.deepEqual(d.items.removed, ['cam']);
  assert.deepEqual(d.items.changed[0].fields, ['name']);
});
check('diff: a track space change is caught', () => {
  const a = fixture(), b = fixture();
  b.tracks.hero.RightElbow.space = 'world';
  const d = SNAP.diffProjects(a, b);
  assert.deepEqual(d.tracks[0].space_changed, { from: 'parent', to: 'world' });
});
check('diff: project-level fields are diffed without re-reporting every key', () => {
  const a = fixture(), b = fixture();
  b.fps = 60;
  b.tracks.hero.RightElbow.keys[0].v = CF.fromEuler(0.1, 0, 0);
  const d = SNAP.diffProjects(a, b);
  assert.deepEqual(d.project_fields, ['fps']);
  assert.equal(d.tracks.length, 1);
});

console.log('\n— provenance —');

check('provenance: a chain of records can be traced back to the request', () => {
  const p = fixture();
  const req = PRV.record(p, { type: 'request', summary: 'make the slash heavier', author: 'user' });
  const plan = PRV.record(p, { type: 'plan', summary: 'delay torso settle by 3 frames', parents: [req] });
  const patch = PRV.record(p, {
    type: 'patch', summary: 'moved 2 keys on RightShoulder', parents: [plan],
    entities: ['track:hero/RightShoulder'], links: [{ type: 'implements', target: plan }],
  });
  const ex = PRV.explain(p, patch);
  assert.equal(ex.node.id, patch);
  assert.deepEqual(ex.caused_by.map((n) => n.type).sort(), ['plan', 'request']);
  assert.deepEqual(ex.affected_entities, ['track:hero/RightShoulder']);
});
check('provenance: historyOf answers "which request caused this track"', () => {
  const p = fixture();
  const req = PRV.record(p, { type: 'request', summary: 'raise the arm', author: 'user' });
  PRV.record(p, { type: 'patch', summary: 'set 1 key', parents: [req], entities: ['track:hero/RightElbow'] });
  const h = PRV.historyOf(p, 'track:hero/RightElbow');
  assert.equal(h.records.length, 1);
  assert.equal(h.origins[0].request, 'raise the arm');
});
check('provenance: it survives a JSON save/load round trip because it lives in the project', () => {
  const p = fixture();
  PRV.record(p, { type: 'request', summary: 'persisted', author: 'user' });
  const back = JSON.parse(JSON.stringify(p));
  assert.equal(PRV.query(back, { type: 'request' }).nodes[0].summary, 'persisted');
});
check('provenance: the cap truncates oldest-first and announces the gap', () => {
  const p = fixture();
  p.semantics = { provenance: { version: 1, seq: 0, nodes: [], edges: [], truncated: 0, cap: 10 } };
  for (let i = 0; i < 25; i++) PRV.record(p, { type: 'note', summary: `n${i}` });
  const g = PRV.getGraph(p);
  assert.equal(g.nodes.length, 10);
  assert.equal(g.truncated, 15);
  assert.equal(g.nodes[0].summary, 'n15');
  assert.ok(PRV.stats(p).truncated === 15);
});
check('provenance: ids are never reused after truncation', () => {
  const p = fixture();
  p.semantics = { provenance: { version: 1, seq: 0, nodes: [], edges: [], truncated: 0, cap: 5 } };
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(PRV.record(p, { type: 'note', summary: `n${i}` }));
  assert.equal(seen.size, 40);
});
check('provenance: unknown node and edge types are refused', () => {
  const p = fixture();
  assert.throws(() => PRV.record(p, { type: 'vibes', summary: 'x' }), /unknown node type/);
  assert.throws(() => PRV.record(p, { type: 'note', summary: 'x', links: [{ type: 'sorta', target: 'y' }] }), /unknown edge type/);
  assert.throws(() => PRV.record(p, { type: 'note' }), /one-line summary/);
});
check('provenance: query filters by type, entity and text', () => {
  const p = fixture();
  PRV.record(p, { type: 'request', summary: 'alpha', entities: ['item:hero'] });
  PRV.record(p, { type: 'analysis', summary: 'beta', entities: ['item:cam'] });
  assert.equal(PRV.query(p, { type: 'request' }).nodes.length, 1);
  assert.equal(PRV.query(p, { entity: 'item:cam' }).nodes[0].summary, 'beta');
  assert.equal(PRV.query(p, { contains: 'ALPH' }).nodes.length, 1);
});
check('provenance: an empty project reports an empty graph rather than throwing', () => {
  assert.equal(PRV.getGraph({ id: 'x' }).nodes.length, 0);
  assert.equal(PRV.query({ id: 'x' }, {}).nodes.length, 0);
  assert.equal(PRV.explain({ id: 'x' }, 'prov:note:1:abc'), null);
});

console.log('\n— layer surface —');

console.log('\n— patch —');

// A fixture with the awkward cases a patch has to survive: a key with no easing fields at all
// (as an imported animation genuinely has), a Back key carrying style parameters, and a group.
function patchFixture() {
  const p = fixture();
  p.tracks.hero.RightShoulder.keys[2] = { t: 16, v: CF.fromEuler(0, 0, -0.9), es: 'Back', ed: 'In', bez: null, ep: { Overshoot: 2 } };
  p.tracks.hero.Bare = { keys: [{ t: 0, v: I() }, { t: 12, v: CF.fromEuler(0.5, 0, 0) }] };
  p.groups = [{ id: 'g1', keys: [{ itemId: 'hero', track: 'RightShoulder', t: 8 }, { itemId: 'hero', track: 'RightElbow', t: 16 }] }];
  return p;
}
const opsOf = (patch) => patch.ops.map((o) => o.op);

check('patch: an unknown op, an unknown field or a missing required field fails at build time', () => {
  assert.throws(() => PATCH.makePatch({ ops: [{ op: 'nope' }] }), /unknown operation/);
  assert.throws(() => PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'X', frame: 3 }] }), /unknown field/);
  assert.throws(() => PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'X' }] }), /"t" is required/);
  assert.throws(() => PATCH.makePatch({ ops: [] }), /at least one operation/);
});

check('patch: the id is the content hash of the operations, so the same work has the same id', () => {
  const a = PATCH.makePatch({ ops: [{ op: 'delete_key', itemId: 'hero', track: 'RightHip', t: 10 }] });
  const b = PATCH.makePatch({ ops: [{ op: 'delete_key', itemId: 'hero', track: 'RightHip', t: 10 }], intent: 'different intent' });
  const c = PATCH.makePatch({ ops: [{ op: 'delete_key', itemId: 'hero', track: 'RightHip', t: 11 }] });
  assert.equal(a.id, b.id, 'the intent is metadata, not work');
  assert.notEqual(a.id, c.id);
});

check('patch: planPatch does not touch the project it is planning against', () => {
  const p = patchFixture();
  const before = H.contentHash(p);
  const plan = PATCH.planPatch(p, PATCH.makePatch({ ops: [
    { op: 'set_key', itemId: 'hero', track: 'RightShoulder', t: 4, value: CF.fromEuler(0, 0, 0.2) },
    { op: 'delete_key', itemId: 'hero', track: 'RightHip', t: 10 },
  ] }));
  assert.ok(plan.applicable);
  assert.equal(H.contentHash(p), before, 'planning mutated the source project');
  // …and the plan's result really is the changed state, not another copy of the source.
  assert.notEqual(H.contentHash(plan.result), before);
  assert.equal(plan.result_hash, H.contentHash(plan.result));
});

check('patch: planning works against a deep-frozen snapshot', () => {
  // The property that makes a snapshot usable as a baseline: you can ask "what would this patch do
  // to the approved state?" without unfreezing it.
  const store = new SNAP.SnapshotStore();
  const taken = store.take(patchFixture(), { reason: 'frozen' });
  const frozen = store.get(taken.id).project;
  assert.ok(Object.isFrozen(frozen));
  const plan = PATCH.planPatch(frozen, PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 4, value: I() }] }));
  assert.ok(plan.applicable, `planning against a frozen snapshot failed: ${plan.summary}`);
});

check('patch: commitPatch refuses a plan that is missing, stale, or for another patch', () => {
  const p = patchFixture();
  const a = PATCH.makePatch({ ops: [{ op: 'delete_key', itemId: 'hero', track: 'RightHip', t: 10 }] });
  const b = PATCH.makePatch({ ops: [{ op: 'delete_key', itemId: 'hero', track: 'RightHip', t: 20 }] });
  const planA = PATCH.planPatch(p, a);
  assert.throws(() => PATCH.commitPatch(p, a, null), /plan from planPatch\(\) is required/);
  assert.throws(() => PATCH.commitPatch(p, b, planA), /computed for/);
  const refused = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'move_key', itemId: 'hero', track: 'RightHip', t: 99, to: 5 }] }));
  assert.equal(refused.applicable, false);
  assert.throws(() => PATCH.commitPatch(p, PATCH.makePatch({ ops: [{ op: 'move_key', itemId: 'hero', track: 'RightHip', t: 99, to: 5 }] }), refused), /refused and must not be applied/);
});

check('patch: a refused patch leaves the project exactly as it was', () => {
  const p = patchFixture();
  const before = H.contentHash(p);
  // Operation 1 is fine, operation 2 is impossible. Atomicity means neither lands.
  const plan = PATCH.planPatch(p, PATCH.makePatch({ ops: [
    { op: 'set_key', itemId: 'hero', track: 'RightHip', t: 4, value: I() },
    { op: 'move_key', itemId: 'hero', track: 'RightHip', t: 77, to: 5 },
  ] }));
  assert.equal(plan.applicable, false);
  assert.equal(plan.problems.length, 1);
  assert.equal(H.contentHash(p), before);
  // The first op DID run on the clone before the second failed — proving the clone is what
  // absorbs a partial application, which is the whole design.
  assert.equal(plan.ops[0].effect, 'created');
});

check('patch: a modified key is restored verbatim, including absent easing fields', () => {
  // The hole a field-by-field inverse would have: `state.js` setKey writes easing conditionally,
  // so a key that never had `es` cannot be put back by setting `es` to undefined.
  const p = patchFixture();
  p.tracks.hero.Bare.keys[1] = { t: 12, v: CF.fromEuler(0.5, 0, 0) }; // no es/ed/bez/ep at all
  const before = H.contentHash(p);
  const patch = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'Bare', t: 12, value: I(), es: 'Bounce', ed: 'Out' }] });
  const plan = PATCH.planPatch(p, patch);
  PATCH.commitPatch(p, patch, plan);
  assert.equal(p.tracks.hero.Bare.keys[1].es, 'Bounce');
  const inv = PATCH.planPatch(p, plan.inverse);
  PATCH.commitPatch(p, plan.inverse, inv);
  assert.equal(H.contentHash(p), before, 'the inverse did not restore the key exactly');
  assert.equal('es' in p.tracks.hero.Bare.keys[1], false, 'the restored key grew an easing field it never had');
});

check('patch: set_key + set_easing + move_key round-trips exactly', () => {
  const p = patchFixture();
  const before = H.contentHash(p);
  const patch = PATCH.makePatch({ intent: 'heavier', ops: [
    { op: 'set_key', itemId: 'hero', track: 'RightShoulder', t: 6, value: CF.fromEuler(0, 0, -0.4) },
    { op: 'set_easing', itemId: 'hero', track: 'RightShoulder', t: 16, es: 'Quad', ed: 'Out' },
    { op: 'move_key', itemId: 'hero', track: 'RightShoulder', t: 16, to: 18 },
  ] });
  const plan = PATCH.planPatch(p, patch);
  PATCH.commitPatch(p, patch, plan);
  assert.deepEqual(p.tracks.hero.RightShoulder.keys.map((k) => k.t), [0, 6, 8, 18]);
  assert.equal(p.tracks.hero.RightShoulder.keys.find((k) => k.t === 18).ep, null, 'switching Back→Quad must drop the Overshoot parameter');
  const inv = PATCH.planPatch(p, plan.inverse);
  PATCH.commitPatch(p, plan.inverse, inv);
  assert.equal(H.contentHash(p), before);
  assert.equal(p.tracks.hero.RightShoulder.keys.find((k) => k.t === 16).ep.Overshoot, 2, 'the pruned Overshoot must come back');
});

check('patch: the inverse runs in reverse order, so a move over a deleted key round-trips', () => {
  const p = patchFixture();
  const before = H.contentHash(p);
  // Delete the key at 8, then move 16 onto 8. Undoing forwards would restore 8 and then have the
  // move-back overwrite it; undoing in reverse gets it right.
  const patch = PATCH.makePatch({ ops: [
    { op: 'delete_key', itemId: 'hero', track: 'RightShoulder', t: 8 },
    { op: 'move_key', itemId: 'hero', track: 'RightShoulder', t: 16, to: 8 },
  ] });
  const plan = PATCH.planPatch(p, patch);
  PATCH.commitPatch(p, patch, plan);
  assert.deepEqual(p.tracks.hero.RightShoulder.keys.map((k) => k.t), [0, 8]);
  const inv = PATCH.planPatch(p, plan.inverse);
  PATCH.commitPatch(p, plan.inverse, inv);
  assert.equal(H.contentHash(p), before);
});

check('patch: a move onto an occupied frame restores the displaced key', () => {
  const p = patchFixture();
  const before = H.contentHash(p);
  const patch = PATCH.makePatch({ ops: [{ op: 'move_key', itemId: 'hero', track: 'RightShoulder', t: 16, to: 8 }] });
  const plan = PATCH.planPatch(p, patch);
  assert.equal(plan.ops[0].before.displaced.t, 8, 'the displaced key must be captured');
  PATCH.commitPatch(p, patch, plan);
  assert.deepEqual(p.tracks.hero.RightShoulder.keys.map((k) => k.t), [0, 8]);
  PATCH.commitPatch(p, plan.inverse, PATCH.planPatch(p, plan.inverse));
  assert.equal(H.contentHash(p), before);
});

check('patch: a move retargets the key group, and warns about siblings it did not move', () => {
  const p = patchFixture();
  const plan = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'move_key', itemId: 'hero', track: 'RightShoulder', t: 8, to: 9 }] }));
  const warn = plan.warnings.find((w) => w.id === 'PATCH-GROUP-NOT-EXPANDED');
  assert.ok(warn, `expected a group warning, got ${plan.warnings.map((w) => w.id).join(', ')}`);
  assert.equal(plan.result.groups[0].keys.find((k) => k.track === 'RightShoulder').t, 9, 'the group entry must follow the key');
  assert.equal(plan.result.groups[0].keys.find((k) => k.track === 'RightElbow').t, 16, 'the sibling must not have moved');
});

check('patch: undoing a move puts the group entry back where it was, not where a re-move would put it', () => {
  // A real defect the round-trip tests caught: `move_key`'s group retarget is STATE-dependent, so
  // "move back and let it retarget again" is not the inverse. The inverse moves back with
  // retargeting off and restores exactly the entries the forward move changed.
  const p = patchFixture();
  const before = H.contentHash(p);
  const patch = PATCH.makePatch({ ops: [{ op: 'move_key', itemId: 'hero', track: 'RightShoulder', t: 8, to: 9 }] });
  const plan = PATCH.planPatch(p, patch);
  assert.deepEqual(opsOf(plan.inverse), ['move_key', 'restore_group_entry']);
  assert.equal(plan.inverse.ops[0].retargetGroups, false);
  PATCH.commitPatch(p, patch, plan);
  PATCH.commitPatch(p, plan.inverse, PATCH.planPatch(p, plan.inverse));
  assert.equal(H.contentHash(p), before);
  assert.equal(p.groups[0].keys.find((k) => k.track === 'RightShoulder').t, 8);
});

check('patch: a delete leaves the group entry alone, exactly as the editor does, and says so', () => {
  const p = patchFixture();
  const plan = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'delete_key', itemId: 'hero', track: 'RightShoulder', t: 8 }] }));
  assert.ok(plan.warnings.some((w) => w.id === 'PATCH-DANGLING-GROUP-ENTRY'));
  assert.equal(plan.result.groups[0].keys.length, 2, 'matching state.js means the group entry survives — the warning is the honesty');
  assert.ok(plan.ui_affordances_not_applied.some((a) => a.id === 'group_cleanup_on_delete'));
});

check('patch: creating a key on a track with no frame-0 key warns instead of inventing a rest pose', () => {
  const p = patchFixture();
  delete p.tracks.hero.RightHip;
  const plan = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 12, value: CF.fromEuler(0.4, 0, 0) }] }));
  assert.ok(plan.applicable);
  assert.ok(plan.warnings.some((w) => w.id === 'PATCH-NO-FRAME-ZERO-KEY'));
  assert.ok(plan.ui_affordances_not_applied.some((a) => a.id === 'auto_zero_key'));
  // A brand-new track's inverse removes the track, not just the key — otherwise the round trip
  // would leave an empty track behind, which is a different project.
  assert.deepEqual(opsOf(plan.inverse), ['remove_track']);
  const p2 = patchFixture();
  delete p2.tracks.hero.RightHip;
  const b = H.contentHash(p2);
  const patch = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 12, value: CF.fromEuler(0.4, 0, 0) }] });
  const pl = PATCH.planPatch(p2, patch);
  PATCH.commitPatch(p2, patch, pl);
  PATCH.commitPatch(p2, pl.inverse, PATCH.planPatch(p2, pl.inverse));
  assert.equal(H.contentHash(p2), b);
});

check('patch: set_key without a value refuses to create a key, and says why', () => {
  const p = patchFixture();
  const plan = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 7, es: 'Linear' }] }));
  assert.equal(plan.applicable, false);
  assert.equal(plan.problems[0].id, 'PATCH-NO-VALUE');
  assert.ok(/set_easing/.test(plan.problems[0].suggestion.text));
});

check('patch: an op that changes nothing is reported as a no_op and not counted as a change', () => {
  const p = patchFixture();
  const k = p.tracks.hero.RightHip.keys[1];
  const plan = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: k.t, value: k.v }] }));
  assert.equal(plan.ops[0].effect, 'no_op');
  assert.deepEqual(plan.changed_entities, []);
  assert.equal(plan.changed_frame_range, null);
  assert.equal(plan.inverse, null);
  assert.ok(plan.diff.identical);
});

check('patch: strict mode turns a warning into a refusal', () => {
  const p = patchFixture();
  const ops = [{ op: 'delete_key', itemId: 'hero', track: 'RightHip', t: 999 }];
  assert.equal(PATCH.planPatch(p, PATCH.makePatch({ ops })).applicable, true, 'deleting an absent key is idempotent, not an error');
  const strict = PATCH.planPatch(p, PATCH.makePatch({ ops, strict: true }));
  assert.equal(strict.applicable, false);
  assert.ok(/strict mode/.test(strict.problems[0].statement));
});

check('patch: a clamped move is reported rather than silently relocated', () => {
  const p = patchFixture();
  const plan = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'move_key', itemId: 'hero', track: 'RightHip', t: 10, to: 500 }] }));
  const w = plan.warnings.find((x) => x.id === 'PATCH-MOVE-CLAMPED');
  assert.ok(w && /frame 60/.test(w.statement), `expected a clamp to the 60-frame timeline, got ${w && w.statement}`);
});

check('patch: item and project fields are allow-listed, and a refusal explains itself', () => {
  const p = patchFixture();
  const bad = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'set_item_field', itemId: 'hero', path: 'rig', value: {} }] }));
  assert.equal(bad.applicable, false);
  assert.ok(/rig topology/.test(bad.problems[0].statement));
  const bad2 = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'set_project_field', path: 'tracks', value: {} }] }));
  assert.equal(bad2.applicable, false);
  assert.ok(/keyframe operations/.test(bad2.problems[0].statement));
});

check('patch: an absent field is restored by removal, not by writing undefined', () => {
  const p = patchFixture();
  delete p.items[0].tags;
  const before = H.contentHash(p);
  const patch = PATCH.makePatch({ ops: [{ op: 'set_item_field', itemId: 'hero', path: 'tags', value: ['hero'] }] });
  const plan = PATCH.planPatch(p, patch);
  assert.equal(plan.ops[0].effect, 'created');
  PATCH.commitPatch(p, patch, plan);
  assert.deepEqual(p.items[0].tags, ['hero']);
  PATCH.commitPatch(p, plan.inverse, PATCH.planPatch(p, plan.inverse));
  assert.equal('tags' in p.items[0], false);
  assert.equal(H.contentHash(p), before);
});

check('patch: changing fps warns that the animation retimes, and shortening warns about orphans', () => {
  const p = patchFixture();
  const fps = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'set_project_field', path: 'fps', value: 60 }] }));
  assert.ok(fps.warnings.some((w) => w.id === 'PATCH-FPS-RETIMES'));
  const len = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'set_project_field', path: 'length', value: 10 }] }));
  const w = len.warnings.find((x) => x.id === 'PATCH-LENGTH-ORPHANS-KEYS');
  assert.ok(w && /never played/.test(w.statement));
});

check('patch: set_track_space changes the flag, warns that values were not converted, and round-trips', () => {
  const p = patchFixture();
  const before = H.contentHash(p);
  const patch = PATCH.makePatch({ ops: [{ op: 'set_track_space', itemId: 'hero', track: 'RightShoulder', space: 'world' }] });
  const plan = PATCH.planPatch(p, patch);
  assert.ok(plan.warnings.some((w) => w.id === 'PATCH-SPACE-NOT-CONVERTED'));
  PATCH.commitPatch(p, patch, plan);
  assert.equal(p.tracks.hero.RightShoulder.space, 'world');
  PATCH.commitPatch(p, plan.inverse, PATCH.planPatch(p, plan.inverse));
  assert.equal(H.contentHash(p), before);
  assert.equal('space' in p.tracks.hero.RightShoulder, false, "'local' must be the absence of the flag, as in state.js");
});

check('patch: removing a track rebuilds it key-for-key, and an EMPTY track admits it cannot', () => {
  const p = patchFixture();
  const before = H.contentHash(p);
  const patch = PATCH.makePatch({ ops: [{ op: 'remove_track', itemId: 'hero', track: 'Bare' }] });
  const plan = PATCH.planPatch(p, patch);
  assert.deepEqual(opsOf(plan.inverse), ['restore_key', 'restore_key']);
  PATCH.commitPatch(p, patch, plan);
  assert.equal(p.tracks.hero.Bare, undefined);
  PATCH.commitPatch(p, plan.inverse, PATCH.planPatch(p, plan.inverse));
  assert.equal(H.contentHash(p), before);

  p.tracks.hero.Empty = { keys: [] };
  const empty = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'remove_track', itemId: 'hero', track: 'Empty' }] }));
  const w = empty.warnings.find((x) => x.id === 'PATCH-EMPTY-TRACK-NOT-RESTORABLE');
  assert.ok(w && w.suggestion.reversible === false, 'an unreversible operation must say so rather than imply a rollback');
  assert.equal(empty.inverse, null);
});

check('patch: markers are patchable, and both directions round-trip', () => {
  const p = patchFixture();
  const before = H.contentHash(p);
  const patch = PATCH.makePatch({ ops: [
    { op: 'set_marker', itemId: 'hero', t: 30, patch: { name: 'recover', width: 4 } },
    { op: 'set_marker', itemId: 'hero', t: 16, patch: { name: 'IMPACT' } },
    { op: 'delete_marker', itemId: 'hero', t: 16 },
  ] });
  const plan = PATCH.planPatch(p, patch);
  assert.ok(plan.applicable, plan.summary);
  assert.equal(plan.result.markers.hero.length, 1);
  PATCH.commitPatch(p, patch, plan);
  PATCH.commitPatch(p, plan.inverse, PATCH.planPatch(p, plan.inverse));
  assert.equal(H.contentHash(p), before);
  assert.equal(p.markers.hero[0].name, 'impact', 'the renamed-then-deleted marker must come back with its original name');
});

check('patch: marker width clamps on a MODIFY exactly as the editor does, and not on a create', () => {
  // Reproducing state.js faithfully includes reproducing where it does not clamp: `addMarker`
  // takes the requested width as given, and only `setMarker` caps it at the next marker's start.
  const p = patchFixture();
  const created = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'set_marker', itemId: 'hero', t: 30, patch: { width: 400 } }] }));
  assert.equal(created.result.markers.hero.find((m) => m.t === 30).width, 400, 'creating a marker does not clamp — state.js addMarker does not either');

  const widened = PATCH.planPatch(p, PATCH.makePatch({ ops: [
    { op: 'set_marker', itemId: 'hero', t: 30, patch: { width: 0 } },
    { op: 'set_marker', itemId: 'hero', t: 30, patch: { width: 400 } },
  ] }));
  assert.equal(widened.result.markers.hero.find((m) => m.t === 30).width, 30, 'modifying clamps to the timeline end (60 - 30)');
  const squeezed = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'set_marker', itemId: 'hero', t: 16, patch: { width: 400 } }] }));
  assert.equal(squeezed.result.markers.hero.find((m) => m.t === 16).width, 44, 'with no marker after it, the cap is the timeline end (60 - 16)');
  const blocked = PATCH.planPatch(p, PATCH.makePatch({ ops: [
    { op: 'set_marker', itemId: 'hero', t: 30, patch: { name: 'recover' } },
    { op: 'set_marker', itemId: 'hero', t: 16, patch: { width: 400 } },
  ] }));
  assert.equal(blocked.result.markers.hero.find((m) => m.t === 16).width, 13, "Moon's rule: a marker's width stops one frame short of the next marker's start (30 - 16 - 1)");
});

check('patch: filterOps keeps order and reports what a scope drops', () => {
  const ops = [
    { op: 'delete_key', itemId: 'hero', track: 'RightHip', t: 4 },
    { op: 'delete_key', itemId: 'hero', track: 'RightShoulder', t: 6 },
    { op: 'set_project_field', path: 'length', value: 60 },
  ];
  const byTrack = PATCH.filterOps(ops, { track: 'RightHip' });
  assert.equal(byTrack.ops.length, 1);
  assert.equal(byTrack.dropped.length, 2);
  const byTime = PATCH.filterOps(ops, { timeRange: [0, 5] });
  assert.deepEqual(byTime.ops.map((o) => o.t), [4]);
  // A timeless op is not inside any frame range, so a time-scoped rollback leaves it alone.
  assert.ok(byTime.dropped.some((o) => o.op === 'set_project_field'));
  const byProperty = PATCH.filterOps(ops, { property: IDS.trackId('hero', 'RightShoulder') });
  assert.deepEqual(byProperty.ops.map((o) => o.track), ['RightShoulder']);
});

check('patch: patchLimitations names what a patch cannot express, with a reason each', () => {
  const l = PATCH.patchLimitations();
  assert.ok(l.can_express.includes('set_key'));
  assert.ok(l.cannot_express.length >= 5);
  assert.ok(l.cannot_express.every((c) => c.thing && c.reason), 'every limitation needs a reason, not just a name');
  assert.ok(l.ui_affordances_not_reproduced.every((a) => a.state_js && a.here));
});

console.log('\n— constraints —');

check('constraints: an unknown type or aspect cannot be constructed', () => {
  assert.throws(() => CON.constraintSpec({ constraint_type: 'vibes', target: { kind: 'everything' } }), /constraint_type must be one of/);
  assert.throws(() => CON.constraintSpec({ constraint_type: 'preserve', target: { kind: 'everything' }, aspect: 'mood' }), /unknown aspect/);
  assert.throws(() => CON.constraintSpec({ constraint_type: 'preserve' }), /at least one target/);
});

check('constraints: the priority ladder is Part 54\'s, in order', () => {
  assert.deepEqual(Object.values(CON.PRIORITY), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(CON.PRIORITY.DATA_SAFETY, 1);
  assert.equal(CON.PRIORITY.USER_LOCK, 2);
  assert.equal(CON.PRIORITY.AI_SUGGESTION, 9);
  // A lock outranks a style preference without anyone having to argue it each time.
  assert.ok(CON.constraintSpec({ constraint_type: 'lock', target: { kind: 'everything' } }).priority
    < CON.constraintSpec({ constraint_type: 'preserve', target: { kind: 'everything' }, source: 'style' }).priority);
});

check('constraints: a protected part protects the track that MOVES it', () => {
  // Protecting "the left foot" has to mean protecting the ankle motor, or the constraint is
  // unenforceable in exactly the case it exists for.
  const p = fixture();
  const r = CON.resolveTarget(p, { kind: 'semantic', query: 'the left foot' });
  assert.ok(r.tracks.includes(IDS.trackId('hero', 'LeftAnkle')), `expected the LeftAnkle track, got ${r.tracks.join(', ')}`);
  assert.equal(r.unresolved.length, 0);
});

check('constraints: an unresolvable target does NOT silently permit everything', () => {
  const p = fixture();
  const r = CON.resolveTarget(p, { kind: 'semantic', query: 'the impact target' });
  assert.equal(r.tracks.length, 0);
  assert.equal(r.unresolved.length, 1);
  assert.ok(r.question);
  assert.equal(r.certainty, C.CERTAINTY.USER_INTENT_REQUIRED);

  const spec = CON.constraintSpec({ constraint_type: 'preserve', target: { kind: 'semantic', query: 'the impact target' } });
  const patch = PATCH.makePatch({ ops: [{ op: 'delete_key', itemId: 'hero', track: 'RightHip', t: 10 }] });
  const chk = CON.checkPatch(p, patch, [spec]);
  assert.equal(chk.violations.length, 0, 'it cannot report a violation of a target it never resolved');
  assert.equal(chk.unresolved_targets.length, 1);
  assert.ok(chk.coverage.notRun.some((s) => /NOT enforced/.test(s)), 'the un-enforced constraint must be named in notRun');
});

check('constraints: a measured target caps the violation\'s certainty', () => {
  const p = fixture();
  const spec = CON.constraintSpec({ constraint_type: 'preserve', target: { kind: 'semantic', query: 'the planted foot' } });
  const r = CON.resolveTarget(p, spec.target[0], { frame: 10 });
  assert.equal(r.certainty, C.CERTAINTY.HIGHLY_LIKELY, 'planting is measured, never certain');
  const track = IDS.parseId(r.tracks[0]).track;
  const chk = CON.checkPatch(p, PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track, t: 10, value: I() }] }), [spec], { frame: 10 });
  assert.equal(chk.violations.length, 1);
  assert.equal(chk.violations[0].finding.certainty, C.CERTAINTY.HIGHLY_LIKELY);
});

check('constraints: aspects separate "do not change timing" from "do not change poses"', () => {
  const p = fixture();
  const timing = CON.compileConstraints({ text: 'do not change timing' }, p).constraints;
  const poses = CON.compileConstraints({ text: 'do not change poses' }, p).constraints;
  const move = PATCH.makePatch({ ops: [{ op: 'move_key', itemId: 'hero', track: 'RightHip', t: 10, to: 12 }] });
  const repose = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 10, value: CF.fromEuler(0.2, 0, 0) }] });

  assert.equal(CON.checkPatch(p, move, timing).violations.length, 1, 'a retime must violate a timing lock');
  assert.equal(CON.checkPatch(p, repose, timing).violations.length, 0, 'a repose must NOT violate a timing lock');
  assert.equal(CON.checkPatch(p, repose, poses).violations.length, 1, 'a repose must violate a pose lock');
  assert.equal(CON.checkPatch(p, move, poses).violations.length, 0, 'a retime must NOT violate a pose lock');
});

check('constraints: opAspects covers every patch op kind', () => {
  for (const op of PATCH.OP_KINDS) {
    const a = CON.opAspects({ op, value: 1, path: 'name' });
    assert.ok(Array.isArray(a) && a.length, `${op} has no declared aspects`);
    assert.ok(a.every((x) => CON.ASPECTS.includes(x)), `${op} declares an unknown aspect: ${a.join(', ')}`);
  }
});

check('constraints: an allow-list protects everything it does not name', () => {
  const p = fixture();
  const c = CON.compileConstraints({ allow: ['the hips', 'the right shoulder'] }, p).constraints;
  const inside = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 5, value: I() }] });
  const outside = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'cam', track: '@fov', t: 5, value: 40 }] });
  assert.equal(CON.checkPatch(p, inside, c).violations.length, 0, 'an allowed track must pass');
  const out = CON.checkPatch(p, outside, c);
  assert.equal(out.violations.length, 1);
  assert.ok(/not in the allowed scope/.test(out.violations[0].reason));
});

check('constraints: a protected frame catches an edit landing on it from any track', () => {
  const p = fixture();
  const c = CON.compileConstraints({ text: 'keep frame 16 within 1 frame' }, p).constraints;
  assert.equal(c[0].priority, CON.PRIORITY.SHOT_EVENT);
  const onIt = PATCH.makePatch({ ops: [{ op: 'move_key', itemId: 'hero', track: 'RightElbow', t: 16, to: 20 }] });
  const nearIt = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 17, value: I() }] });
  const farFrom = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 3, value: I() }] });
  assert.equal(CON.checkPatch(p, onIt, c).violations.length, 1);
  assert.equal(CON.checkPatch(p, nearIt, c).violations.length, 1, 'the ±1 tolerance window must bite at 17');
  assert.equal(CON.checkPatch(p, farFrom, c).violations.length, 0);
});

check('constraints: a time-ranged constraint only bites inside its range', () => {
  const p = fixture();
  const spec = CON.constraintSpec({ constraint_type: 'preserve', target: { kind: 'track', itemId: 'hero', track: 'RightHip' }, timeRange: [8, 12] });
  const inside = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 10, value: I() }] });
  const outside = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 30, value: I() }] });
  assert.equal(CON.checkPatch(p, inside, [spec]).violations.length, 1);
  assert.equal(CON.checkPatch(p, outside, [spec]).violations.length, 0);
});

check('constraints: an unimplemented check is reported as not run, never as satisfied', () => {
  // `contact_drift` used to be the exemplar here. MOT-008 implemented it, which is exactly the
  // moment a test like this stops testing anything — so it now uses a check that is genuinely
  // still unbuilt, and asserts the general property over the whole registry instead of one entry.
  const p = fixture();
  const unbuilt = Object.entries(CON.CHECKS).filter(([, c]) => !c.implemented);
  assert.ok(unbuilt.length, 'if every check is implemented this test needs rewriting, not deleting');
  for (const [name, c] of unbuilt) {
    assert.ok(c.blocked_on, `${name} is unimplemented and must say what blocks it`);
    // The Phase 4 review pass found eight strings that deferred to a phase that had already
    // shipped. A reason must name its own obstacle, not a milestone.
    assert.ok(!/blocked on Phase|until Phase \d/.test(c.blocked_on), `${name} defers to a phase rather than naming its obstacle: ${c.blocked_on}`);
  }
  const spec = CON.constraintSpec({
    constraint_type: 'limit',
    target: { kind: 'track', itemId: 'hero', track: 'RightShoulder' },
    condition: { check: 'silhouette_unchanged' },
  });
  const patch = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightShoulder', t: 8, value: CF.fromEuler(0.5, 0, 0) }] });
  const chk = CON.checkPatch(p, patch, [spec], { result: PATCH.planPatch(p, patch).result });
  assert.equal(chk.violations.length, 0);
  assert.ok(chk.coverage.notRun.some((s) => /silhouette_unchanged/.test(s)));
  assert.ok(/see coverage.notRun/.test(chk.recommendation), 'the recommendation must not read as a clean pass');
});

check('constraints: contact drift is MEASURED against the planned result, not recorded and forgotten', () => {
  // Part 54's worked example, in full: "keep the left foot within 2 cm from frame 12 through 23".
  // It was the flagship not-checked entry for three phases. This is what closing MOT-008 bought.
  const p = plantFixture();
  const comp = CON.compileConstraints({ contacts: [{ effector: 'the left foot', from: 0, to: 16, tolerance_studs: 0.05 }] }, p);
  assert.equal(comp.constraints.length, 1);
  assert.equal(CON.CHECKS.contact_drift.implemented, true);
  assert.ok(comp.notes.some((n) => /MEASURED/.test(n) && /no ground plane/.test(n)),
    'the note must say the contact is checked AND what the reference is');

  // A hip rotation swings the whole leg, so the planted foot travels nearly a stud.
  const breaks = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'LeftHip', t: 16, value: CF.fromEuler(0.5, 0, 0) }] });
  const bad = CON.checkPatch(p, breaks, comp.constraints, { result: PATCH.planPatch(p, breaks).result });
  assert.equal(bad.violations.length, 1);
  assert.ok(/LeftFoot/.test(bad.violations[0].reason) && /0\.05-stud tolerance/.test(bad.violations[0].reason));
  assert.equal(bad.violations[0].finding.frame, 1, 'the finding points at the first breach, not the worst frame');
  const ev = bad.violations[0].finding.evidence.find((e) => e.kind === 'measurement');
  assert.ok(ev.detail.max_drift_studs > 0.5 && ev.detail.first_breach_frame !== null);

  // An edit that does not touch the leg leaves the contact alone, and the checker says so rather
  // than warning about everything near a contact.
  const clean = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightShoulder', t: 8, value: CF.fromEuler(0, 0, 0.5) }] });
  assert.equal(CON.checkPatch(p, clean, comp.constraints, { result: PATCH.planPatch(p, clean).result }).violations.length, 0);
});

check('constraints: a contact with no range or no tolerance is UNEVALUATED, never passed', () => {
  // "No tolerance declared" is not "any drift is acceptable", and a contact with no frame range is
  // not a contact. Both come back as warnings that name themselves, not as silence.
  const p = plantFixture();
  const noRange = CON.constraintSpec({
    constraint_type: 'limit',
    target: { kind: 'semantic', query: 'the left foot' },
    condition: { check: 'contact_drift', effector: 'the left foot', tolerance_studs: 0.05 },
  });
  const noTol = CON.constraintSpec({
    constraint_type: 'limit',
    target: { kind: 'semantic', query: 'the left foot' },
    timeRange: [0, 16],
    condition: { check: 'contact_drift', effector: 'the left foot' },
  });
  const patch = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'LeftHip', t: 16, value: CF.fromEuler(0.5, 0, 0) }] });
  const result = PATCH.planPatch(p, patch).result;
  for (const [label, spec, why] of [['no range', noRange, /frame range/], ['no tolerance', noTol, /tolerance/]]) {
    const r = CON.checkPatch(p, patch, [spec], { result });
    assert.equal(r.violations.length, 1, `${label} must report, not stay silent`);
    assert.equal(r.violations[0].response, 'warn', `${label} is unevaluated, so it cannot refuse`);
    assert.ok(why.test(r.violations[0].reason), `${label}: ${r.violations[0].reason}`);
    assert.ok(/UNEVALUATED/.test(r.violations[0].finding.id));
  }
});

check('constraints: a sliding contact is measured and NOT judged', () => {
  // Part 20.5's modes are not decoration. A sliding contact that moves is doing its job, and
  // reporting the animator's own plan back as a violation is how a checker gets switched off.
  const p = plantFixture();
  const spec = CON.constraintSpec({
    constraint_type: 'limit',
    target: { kind: 'semantic', query: 'the left foot' },
    timeRange: [0, 16],
    condition: { check: 'contact_drift', effector: 'the left foot', tolerance_studs: 0.05, mode: 'sliding' },
  });
  const patch = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'LeftHip', t: 16, value: CF.fromEuler(0.5, 0, 0) }] });
  const r = CON.checkPatch(p, patch, [spec], { result: PATCH.planPatch(p, patch).result });
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].response, 'warn');
  assert.ok(/expected to move/.test(r.violations[0].reason) && /NOT judged/.test(r.violations[0].reason));
});

check('constraints: implemented conditions really evaluate the planned result', () => {
  const p = fixture();
  const budget = CON.compileConstraints({ text: 'at most 8 keys' }, p).constraints;
  const patch = PATCH.makePatch({ ops: [
    { op: 'set_key', itemId: 'hero', track: 'RightHip', t: 3, value: I() },
    { op: 'set_key', itemId: 'hero', track: 'RightHip', t: 5, value: I() },
  ] });
  const plan = PATCH.planPatch(p, patch);
  const withResult = CON.checkPatch(p, patch, budget, { result: plan.result });
  assert.equal(withResult.violations.length, 1, 'the project has 9 keys before the patch and 11 after, over the budget of 8');
  assert.ok(/over the budget/.test(withResult.violations[0].reason));
  // Without the planned result it says it could not evaluate, instead of guessing.
  const noResult = CON.checkPatch(p, patch, budget);
  assert.equal(noResult.violations[0].finding.id, 'CONSTRAINT-NO-RESULT');
});

check('constraints: frame_within and max_keys read the post-patch state', () => {
  const p = fixture();
  const keep = CON.constraintSpec({
    constraint_type: 'limit', target: { kind: 'track', itemId: 'hero', track: 'RightElbow' },
    condition: { check: 'frame_within', frame: 16, tolerance: 0 },
  });
  const move = PATCH.makePatch({ ops: [{ op: 'move_key', itemId: 'hero', track: 'RightElbow', t: 16, to: 18 }] });
  const plan = PATCH.planPatch(p, move);
  assert.equal(CON.checkPatch(p, move, [keep], { result: plan.result }).violations.length, 1);

  const cap = CON.constraintSpec({
    constraint_type: 'limit', target: { kind: 'track', itemId: 'hero', track: 'RightHip' },
    condition: { check: 'max_keys', max: 3 },
  });
  const add = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 5, value: I() }] });
  const addPlan = PATCH.planPatch(p, add);
  assert.equal(CON.checkPatch(p, add, [cap], { result: addPlan.result }).violations.length, 1, 'RightHip would hold 4 keys');
});

check('constraints: a conflict is reported with both priorities and never resolved', () => {
  const p = fixture();
  const a = CON.constraintSpec({ constraint_type: 'budget', target: { kind: 'everything' }, condition: { check: 'budget_keys', max: 100 } });
  const b = CON.constraintSpec({ constraint_type: 'budget', target: { kind: 'everything' }, condition: { check: 'budget_keys', max: 40 }, source: 'style' });
  const chk = CON.checkPatch(p, PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 5, value: I() }] }), [a, b]);
  const c = chk.conflicts.find((x) => x.id === 'BUDGET-SHADOWED');
  assert.ok(c, `expected a shadowed-budget conflict, got ${chk.conflicts.map((x) => x.id).join(', ')}`);
  assert.equal(c.resolved_automatically, false);
  assert.ok(c.alternatives.length >= 2, 'Part 54 requires alternatives to be offered');
  assert.equal(c.constraints.length, 2);
  assert.ok(c.constraints.every((x) => typeof x.priority === 'number'));
});

check('constraints: disjoint numeric ranges on one track are unsatisfiable and say so', () => {
  const p = fixture();
  const t = { kind: 'track', itemId: 'cam', track: '@fov' };
  const a = CON.constraintSpec({ constraint_type: 'limit', target: t, condition: { check: 'value_range', min: 20, max: 40 } });
  const b = CON.constraintSpec({ constraint_type: 'limit', target: t, condition: { check: 'value_range', min: 60, max: 90 } });
  const chk = CON.checkPatch(p, PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'cam', track: '@fov', t: 8, value: 50 }] }), [a, b]);
  assert.ok(chk.conflicts.some((x) => x.id === 'RANGE-DISJOINT'));
});

check('constraints: the text grammar is closed, and an unparsed line is not enforced', () => {
  const p = fixture();
  const comp = CON.compileConstraints({ text: 'do not change timing; make it feel heavier; lock the camera' }, p);
  assert.equal(comp.constraints.length, 2);
  assert.deepEqual(comp.unparsed, ['make it feel heavier']);
  assert.equal(comp.questions.length, 1);
  assert.ok(/NOT enforced/.test(comp.summary), 'the summary must say a line went unenforced');
  assert.ok(comp.grammar.length >= 8, 'the recognised forms are returned as documentation');
});

check('constraints: identical constraints collapse to one, and differently-worded ones do not', () => {
  const p = fixture();
  assert.equal(CON.compileConstraints({ preserve: ['the camera', 'the camera'] }, p).constraints.length, 1,
    'the same protection listed twice is one constraint — the id is a content hash');
  // Two DIFFERENT phrasings stay two constraints, on purpose: they carry different rule text, and
  // collapsing them would lose the wording a human would recognise in a violation report.
  const both = CON.compileConstraints({ preserve: ['the camera'], text: 'do not change the camera' }, p);
  assert.equal(both.constraints.length, 2);
  assert.equal(new Set(both.constraints.map((c) => c.property_or_semantic_rule)).size, 2);
});

check('constraints: cm and m in the grammar convert to studs', () => {
  const p = fixture();
  const cm = CON.compileConstraints({ text: 'keep the left foot within 2 cm from frame 12 to 23' }, p).constraints[0];
  assert.ok(Math.abs(cm.condition.tolerance_studs - 2 / 28) < 1e-9, `2 cm should be ~0.0714 studs, got ${cm.condition.tolerance_studs}`);
  assert.deepEqual(cm.time_range, [12, 23]);
});

check('constraints: a lock persists inside the project, is idempotent, and is enforced', () => {
  const p = fixture();
  const first = CON.lock(p, { target: { kind: 'semantic', query: 'the camera' }, reason: 'shot approved' });
  assert.equal(first.created, true);
  assert.equal(CON.lock(p, { target: { kind: 'semantic', query: 'the camera' }, reason: 'shot approved' }).created, false);
  assert.equal(CON.listLocks(p).length, 1);
  assert.equal(p.semantics.locks.entries.length, 1, 'a lock lives under project.semantics so it survives save/load');

  // Enforced with NO constraint set supplied — that is the point of persisting it.
  const chk = CON.checkPatch(p, PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'cam', track: '@fov', t: 5, value: 40 }] }), []);
  assert.equal(chk.violations.length, 1);
  assert.equal(chk.violations[0].constraint_type, 'lock');
  assert.equal(chk.violations[0].priority, CON.PRIORITY.USER_LOCK);
  assert.ok(/unlock_constraint/.test(chk.violations[0].finding.suggestion.text));

  assert.ok(CON.unlock(p, first.entry.id));
  assert.equal(CON.listLocks(p).length, 0);
  // Removing the last lock must leave NO empty container: `{}` and absent hash differently, so an
  // empty `semantics` would make the next save/load read as an edit.
  assert.equal(p.semantics, undefined, 'the last lock removed should leave no empty container behind');
  assert.equal(CON.unlock(p, first.entry.id), null);
});

check('constraints: a lock round-trips through JSON, ids and all', () => {
  const p = fixture();
  const { entry } = CON.lock(p, { target: { kind: 'track', itemId: 'hero', track: 'RightHip' }, aspect: ['timing'], reason: 'retimed already' });
  const back = JSON.parse(JSON.stringify(p));
  assert.deepEqual(CON.listLocks(back)[0], entry);
  const chk = CON.checkPatch(back, PATCH.makePatch({ ops: [{ op: 'move_key', itemId: 'hero', track: 'RightHip', t: 10, to: 12 }] }), []);
  assert.equal(chk.violations.length, 1);
  const pose = CON.checkPatch(back, PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 10, value: I() }] }), []);
  assert.equal(pose.violations.length, 0, 'a timing-only lock must leave a repose alone');
});

check('constraints: lockStateOf resolves a phrase-based lock back to the item it covers', () => {
  const p = fixture();
  CON.lock(p, { target: { kind: 'semantic', query: 'the camera' }, reason: 'shot approved' });
  const cam = CON.lockStateOf(p, 'cam');
  assert.equal(cam.locked, true);
  assert.equal(cam.scope, 'item');
  assert.equal(cam.reason, 'shot approved');
  assert.ok(cam.constraints[0].tracks.length > 0, 'the report must name the tracks the lock covers on this item');
  assert.equal(CON.lockStateOf(p, 'hero').locked, false);
  // …and the Scene Graph reads the same store, so a report and an enforcement cannot disagree.
  const node = SG.sceneGraph(p, { frame: 0 }).objects.find((o) => o.name === 'Camera 1');
  assert.equal(node.lock_state.locked, true);
  assert.deepEqual(node.constraint_ids, cam.constraints.map((c) => c.id));
});

check('constraints: the vocabulary says which checks are real', () => {
  const v = CON.constraintVocabulary();
  assert.deepEqual(v.types, CON.CONSTRAINT_TYPES);
  const unimplemented = v.checks.filter((c) => !c.implemented);
  assert.ok(unimplemented.length >= 3);
  assert.ok(unimplemented.every((c) => c.blocked_on), 'an unimplemented check must name what unblocks it');
  assert.ok(v.checks.filter((c) => c.implemented).length >= 6);
});

console.log('\n— scope —');

check('scope: a local edit is classified local, with its thresholds declared', () => {
  const p = fixture();
  const plan = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 5, value: I() }] }));
  const s = SCOPE.analyseScope(p, plan);
  assert.equal(s.breadth.verdict, 'local');
  assert.equal(s.breadth.requires_explicit_reason, false);
  assert.ok(s.breadth.thresholds.local_max_tracks > 0, 'the thresholds must be reported, not hidden in a condition');
  assert.equal(s.breadth.finding.evidence.some((e) => e.kind === 'assumption'), true, 'a declared convention must be labelled as an assumption');
});

check('scope: a wide edit is classified broad and demands an explicit reason', () => {
  const p = fixture();
  const ops = Object.keys(p.tracks.hero).map((track) => ({ op: 'set_key', itemId: 'hero', track, t: 5, value: track === '@origin' ? I() : I() }));
  ops.push({ op: 'set_key', itemId: 'cam', track: '@fov', t: 5, value: 44 });
  const plan = PATCH.planPatch(p, PATCH.makePatch({ ops }));
  const s = SCOPE.analyseScope(p, plan);
  assert.equal(s.breadth.verdict, 'broad');
  assert.equal(s.breadth.requires_explicit_reason, true);
  assert.ok(/broad rewrite/.test(s.breadth.finding.statement));
});

check('scope: consequences propagate down the rig and through attachment', () => {
  const p = fixture();
  const plan = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightShoulder', t: 5, value: CF.fromEuler(0, 0, 0.4) }] }));
  const s = SCOPE.analyseScope(p, plan);
  const parts = s.dependent_parts.map((x) => x.partId);
  assert.ok(parts.includes('RightUpperArm') && parts.includes('RightHand'), `expected the arm chain, got ${parts.join(', ')}`);
  assert.ok(s.dependent_objects.some((d) => d.itemId === 'sword'), 'the sword is attached to the right hand and must be listed');
  assert.ok(/attached to RightHand/.test(s.dependent_objects.find((d) => d.itemId === 'sword').reason));
});

check('scope: touching @origin propagates to the whole rig', () => {
  const p = fixture();
  const plan = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: '@origin', t: 5, value: CF.setPosition(I(), 3, 0, 0) }] }));
  const s = SCOPE.analyseScope(p, plan);
  assert.equal(s.dependent_parts.length, p.items[0].rig.parts.length, 'the @origin track places the root, and therefore every part');
});

check('scope: an event marker inside the changed range is reported, and code on it escalates', () => {
  const p = fixture();
  p.markers.hero[0].codeBegin = 'print("hit")';
  const plan = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'move_key', itemId: 'hero', track: 'RightElbow', t: 16, to: 17 }] }));
  const s = SCOPE.analyseScope(p, plan);
  assert.equal(s.event_implications.overlapping.length, 1);
  const e = s.event_implications.overlapping[0];
  assert.equal(e.name, 'impact');
  assert.equal(e.has_code, true);
  assert.ok(/gameplay event/.test(e.implication));
  assert.ok(s.regression_test_requirement.unavailable.some((u) => /Luau/.test(u)));
});

check('scope: an edit away from every marker reports no event implication', () => {
  const p = fixture();
  const plan = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 3, value: I() }] }));
  const s = SCOPE.analyseScope(p, plan);
  assert.equal(s.event_implications.overlapping.length, 0);
  assert.ok(/no event marker/.test(s.event_implications.note));
});

check('scope: the two rows that need later phases are null WITH a reason', () => {
  const p = fixture();
  const plan = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 5, value: I() }] }));
  const s = SCOPE.analyseScope(p, plan);
  // Still null, but for a DIFFERENT reason since Phase 4: the passes exist, and a scope report
  // runs before the patch, so the region could only be predicted rather than measured. The row
  // has to keep saying which of those two it is, or a reader would assume the passes are missing.
  assert.equal(s.expected_visual_region.region, null);
  assert.ok(/predict/i.test(s.expected_visual_region.blocked_on), 'the reason must say the measurement exists and the PREDICTION does not');
  assert.ok(/explain_change/.test(s.expected_visual_region.measured_by), 'it must point at the tool that does measure it');
  assert.equal(s.camera_implications.framing_effect, null);
  assert.ok(/SHOT-00/.test(s.camera_implications.blocked_on));
  assert.equal(s.camera_implications.cameras_in_project.length, 1, 'the camera that DOES exist is still reported');
  assert.equal(s.regression_test_requirement.can_fully_validate, false);
  assert.ok(s.regression_test_requirement.available.length >= 3);
  assert.ok(s.regression_test_requirement.unavailable.length >= 3);
  assert.ok(s.coverage.notRun.length >= 4);
});

check('scope: the frames to re-validate reach one frame either side of the edit', () => {
  const p = fixture();
  const plan = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 12, value: I() }] }));
  const s = SCOPE.analyseScope(p, plan);
  assert.deepEqual(s.regression_test_requirement.frames_to_revalidate, { start: 11, end: 13 });
});

check('scope: a constraint violation surfaces as protected-state conflict risk', () => {
  const p = fixture();
  const c = CON.compileConstraints({ text: 'do not change the camera' }, p).constraints;
  const plan = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'cam', track: '@fov', t: 5, value: 40 }] }));
  const s = SCOPE.analyseScope(p, plan, { constraints: c });
  assert.equal(s.protected_state_conflict_risk.violations, 1);
  assert.equal(s.protected_state_conflict_risk.allowed, false);
  assert.equal(s.protected_state_conflict_risk.highest_priority_violated, CON.PRIORITY.USER_PRESERVE);
});

console.log('\n— transaction —');

check('transaction: a record carries Part 55\'s field list, with honest nulls', () => {
  const ledger = new TXN.TransactionLedger();
  const txn = ledger.open({ request: 'make it heavier', tool: 'test', timestamp: '2026-09-07T00:00:00Z' });
  for (const f of ['transaction_id', 'parent_transaction_id', 'user_request', 'interpreted_intent', 'tool',
    'plan_reference', 'constraint_set', 'before_snapshot', 'after_snapshot', 'changed_entities',
    'changed_properties', 'changed_frame_range', 'expected_visual_effect', 'validation_results',
    'baseline_comparison', 'approval_status', 'rollback_method', 'author', 'timestamp']) {
    assert.ok(f in txn, `the transaction record is missing Part 55's "${f}"`);
  }
  assert.equal(txn.baseline_comparison.compared, false);
  assert.ok(/create_baseline/.test(txn.baseline_comparison.reason), 'an uncompared transaction must say how a comparison would be made');
  // "not compared" and "compared, and clean" are different claims, and the field exists to keep
  // them apart. Once a comparison runs, `compared` flips and carries what it attributed.
  TXN.recordBaselineComparison(ledger, txn.transaction_id, {
    baseline_id: 'baseline:1:abc', baseline_name: 'before the swing', explanation_id: 'explain:xyz',
    explained: 2, unexpected: 0, timestamp: '2026-09-08T00:00:00Z',
  });
  assert.equal(ledger.get(txn.transaction_id).baseline_comparison.compared, true);
  assert.equal(ledger.get(txn.transaction_id).baseline_comparison.differences_explained_by_this_transaction, 2);
  assert.equal(ledger.get(txn.transaction_id).approval_status, 'not_requested', 'a comparison is not an approval');
  assert.ok(/render/.test(txn.expected_visual_effect.reason));
  assert.equal(txn.approval_status, 'not_requested', 'applying is not accepting');
});

check('transaction: preview changes nothing and proves it', () => {
  const p = fixture();
  const before = H.contentHash(p);
  const ledger = new TXN.TransactionLedger();
  const patch = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 5, value: I() }] });
  const out = TXN.preview(p, patch, {
    ledger, request: 'r', tool: 'preview_animation_patch',
    check: (proj, pt, plan) => CON.checkPatch(proj, pt, [], { result: plan.result }),
    scope: (proj, plan) => SCOPE.analyseScope(proj, plan),
  });
  assert.equal(out.state_unchanged, true);
  assert.equal(H.contentHash(p), before);
  assert.equal(out.applied, false);
  assert.equal(out.status, 'previewed');
  assert.ok(out.diff_if_applied.tracks.length === 1);
  assert.ok(out.scope.breadth.verdict);
  assert.ok(out.rollback.available, 'a preview can always be discarded, which is the trivial rollback');
});

check('transaction: a mutating result carries every field Part 50 requires', () => {
  const p = fixture();
  const ledger = new TXN.TransactionLedger();
  const patch = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 5, value: I() }] });
  const plan = PATCH.planPatch(p, patch);
  const out = TXN.apply(p, patch, plan, { ledger, constraintReport: CON.checkPatch(p, patch, [], { result: plan.result }), timestamp: 'T' });
  for (const f of ['transaction_id', 'changed_entities', 'changed_properties', 'changed_frame_range',
    'constraints_checked', 'baseline_relationship', 'validation', 'rollback', 'warnings']) {
    assert.ok(f in out, `a mutating result is missing Part 50's "${f}"`);
  }
  assert.equal(out.applied, true);
  assert.equal(out.rollback.available, true);
  assert.ok(out.rollback.tool.includes(out.transaction_id));
  assert.equal(out.validation.committed_hash_matches_plan, true);
});

check('transaction: a refusing constraint blocks the apply and preserves the state', () => {
  const p = fixture();
  const before = H.contentHash(p);
  const ledger = new TXN.TransactionLedger();
  const c = CON.compileConstraints({ text: 'do not change the camera' }, p).constraints;
  const patch = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'cam', track: '@fov', t: 5, value: 40 }] });
  const plan = PATCH.planPatch(p, patch);
  const report = CON.checkPatch(p, patch, c, { result: plan.result });
  const out = TXN.apply(p, patch, plan, { ledger, constraintReport: report, timestamp: 'T' });
  assert.equal(out.applied, false);
  assert.equal(out.refused, true);
  assert.equal(H.contentHash(p), before);
  assert.equal(out.failure_behaviour.partial_result_applied, false);
  assert.equal(out.failure_behaviour.state_preserved, true);
  assert.ok(out.failure_behaviour.safe_recovery_actions.length >= 3, 'Part 55 requires safe recovery actions to be offered');
  assert.equal(ledger.get(out.transaction_id).status, 'failed');
  // A refusal has to say WHICH constraint refused it. This was genuinely missing at first: `fail`
  // built its result without the constraint report, so a blocked apply came back claiming zero
  // constraints were checked — the least useful possible answer.
  assert.equal(out.constraints_checked.count, 1);
  assert.equal(out.constraints_checked.violations.length, 1);
  assert.equal(out.constraints_checked.violations[0].constraint_type, 'preserve');
  assert.ok(/camera/.test(out.constraints_checked.violations[0].rule));
});

check('transaction: force records the override instead of hiding the violation', () => {
  const p = fixture();
  const ledger = new TXN.TransactionLedger();
  const c = CON.compileConstraints({ text: 'do not change the camera' }, p).constraints;
  const patch = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'cam', track: '@fov', t: 5, value: 40 }] });
  const plan = PATCH.planPatch(p, patch);
  const report = CON.checkPatch(p, patch, c, { result: plan.result });
  const out = TXN.apply(p, patch, plan, { ledger, constraintReport: report, force: true, timestamp: 'T' });
  assert.equal(out.applied, true);
  assert.equal(out.validation.overridden.length, 1);
  assert.equal(ledger.get(out.transaction_id).approval_status, 'user_override');
  assert.equal(out.constraints_checked.violations.length, 1, 'the violation is still reported, not erased by the override');
});

check('transaction: a whole rollback returns the project to its exact prior state', () => {
  const p = fixture();
  const before = H.contentHash(p);
  const ledger = new TXN.TransactionLedger();
  const patch = PATCH.makePatch({ ops: [
    { op: 'set_key', itemId: 'hero', track: 'RightHip', t: 5, value: CF.fromEuler(0.2, 0, 0) },
    { op: 'set_easing', itemId: 'hero', track: 'RightShoulder', t: 8, es: 'Linear', ed: 'Out' },
  ] });
  const plan = PATCH.planPatch(p, patch);
  const applied = TXN.apply(p, patch, plan, { ledger, timestamp: 'T' });
  assert.notEqual(H.contentHash(p), before);
  const rb = TXN.rollback(p, ledger, applied.transaction_id, { timestamp: 'T2' });
  assert.equal(rb.rolled_back, true);
  assert.equal(rb.complete, true);
  assert.equal(H.contentHash(p), before);
  assert.equal(ledger.get(applied.transaction_id).status, 'rolled_back');
  // A rollback is itself a transaction, so it can be rolled back in turn (Part 55).
  assert.notEqual(rb.rollback_transaction_id, applied.transaction_id);
  const redo = TXN.rollback(p, ledger, rb.rollback_transaction_id, { timestamp: 'T3' });
  assert.equal(redo.rolled_back, true);
  assert.equal(H.contentHash(p), plan.result_hash);
});

check('transaction: a scoped rollback undoes one property and reports the rest', () => {
  const p = fixture();
  const before = H.contentHash(p);
  const ledger = new TXN.TransactionLedger();
  const patch = PATCH.makePatch({ ops: [
    { op: 'set_key', itemId: 'hero', track: 'RightHip', t: 5, value: CF.fromEuler(0.2, 0, 0) },
    { op: 'set_key', itemId: 'hero', track: 'RightShoulder', t: 5, value: CF.fromEuler(0, 0, 0.3) },
  ] });
  const plan = PATCH.planPatch(p, patch);
  const applied = TXN.apply(p, patch, plan, { ledger, timestamp: 'T' });

  const partial = TXN.rollback(p, ledger, applied.transaction_id, { scope: { track: 'RightHip' }, timestamp: 'T2' });
  assert.equal(partial.rolled_back, true);
  assert.equal(partial.complete, false);
  assert.equal(partial.undone.length, 1);
  assert.equal(partial.still_applied.length, 1);
  assert.ok(/RightShoulder/.test(partial.still_applied[0]));
  assert.ok(!p.tracks.hero.RightHip.keys.some((k) => k.t === 5), 'the hip key must be gone');
  assert.ok(p.tracks.hero.RightShoulder.keys.some((k) => k.t === 5), 'the shoulder key must remain');

  // "Roll back the rest" then works, because the ledger tracks what has already been reversed.
  const rest = TXN.rollback(p, ledger, applied.transaction_id, { timestamp: 'T3' });
  assert.equal(rest.rolled_back, true);
  assert.equal(rest.complete, true);
  assert.equal(H.contentHash(p), before);
  assert.equal(TXN.rollback(p, ledger, applied.transaction_id, { timestamp: 'T4' }).reason, 'every operation of this transaction has already been rolled back');
});

check('transaction: a time-scoped rollback reverses only the frames asked for', () => {
  const p = fixture();
  const ledger = new TXN.TransactionLedger();
  const patch = PATCH.makePatch({ ops: [
    { op: 'set_key', itemId: 'hero', track: 'RightHip', t: 4, value: I() },
    { op: 'set_key', itemId: 'hero', track: 'RightHip', t: 30, value: I() },
  ] });
  const plan = PATCH.planPatch(p, patch);
  const applied = TXN.apply(p, patch, plan, { ledger, timestamp: 'T' });
  const rb = TXN.rollback(p, ledger, applied.transaction_id, { scope: { timeRange: [0, 10] }, timestamp: 'T2' });
  assert.equal(rb.rolled_back, true);
  assert.equal(rb.complete, false);
  const times = p.tracks.hero.RightHip.keys.map((k) => k.t);
  assert.ok(!times.includes(4) && times.includes(30), `expected frame 4 gone and 30 kept, got ${times.join(', ')}`);
});

check('transaction: a scope that matches nothing rolls nothing back and says what it could have', () => {
  const p = fixture();
  const ledger = new TXN.TransactionLedger();
  const patch = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 5, value: I() }] });
  const plan = PATCH.planPatch(p, patch);
  const applied = TXN.apply(p, patch, plan, { ledger, timestamp: 'T' });
  const rb = TXN.rollback(p, ledger, applied.transaction_id, { scope: { track: 'LeftAnkle' } });
  assert.equal(rb.rolled_back, false);
  assert.ok(/matched none/.test(rb.reason));
  assert.ok(rb.available_properties.some((s) => /RightHip/.test(s)));
  assert.ok(p.tracks.hero.RightHip.keys.some((k) => k.t === 5), 'nothing may change when a scope matches nothing');
});

check('transaction: a rollback whose inverse no longer applies refuses instead of half-working', () => {
  const p = fixture();
  const ledger = new TXN.TransactionLedger();
  const patch = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 5, value: I() }] });
  const plan = PATCH.planPatch(p, patch);
  const applied = TXN.apply(p, patch, plan, { ledger, timestamp: 'T' });
  // Somebody else removes the key the rollback intended to remove.
  p.tracks.hero.RightHip.keys = p.tracks.hero.RightHip.keys.filter((k) => k.t !== 5);
  const after = H.contentHash(p);
  const rb = TXN.rollback(p, ledger, applied.transaction_id, { timestamp: 'T2' });
  assert.equal(rb.rolled_back, false);
  assert.equal(H.contentHash(p), after, 'a refused rollback must change nothing');
  assert.ok(/no longer applies/.test(rb.reason));
  assert.ok(/whole-project undo/.test(rb.hint), 'it must point at a recovery that does still work');
});

check('transaction: rolling back a previewed or already-rolled-back transaction is refused', () => {
  const p = fixture();
  const ledger = new TXN.TransactionLedger();
  const patch = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 5, value: I() }] });
  const pv = TXN.preview(p, patch, { ledger, tool: 't' });
  assert.throws(() => TXN.rollback(p, ledger, pv.transaction_id), /not applied/);
  assert.throws(() => TXN.rollback(p, ledger, 'txn:nope'), /no transaction/);
});

check('transaction: a decision is explicit, and applying is never accepting', () => {
  const p = fixture();
  const ledger = new TXN.TransactionLedger();
  const patch = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 5, value: I() }] });
  const applied = TXN.apply(p, patch, PATCH.planPatch(p, patch), { ledger, timestamp: 'T' });
  assert.equal(ledger.get(applied.transaction_id).status, 'applied');
  assert.equal(ledger.get(applied.transaction_id).approval_status, 'not_requested');
  const d = TXN.decide(ledger, applied.transaction_id, 'accepted', { author: 'user', reason: 'looks right' });
  assert.equal(d.status, 'accepted');
  assert.equal(d.approval_status, 'accepted');
  assert.throws(() => TXN.decide(ledger, applied.transaction_id, 'maybe'), /must be 'accepted' or 'rejected'/);
});

check('transaction: the ledger never evicts something still rollback-able', () => {
  const p = fixture();
  const ledger = new TXN.TransactionLedger({ capacity: 3 });
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const patch = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 20 + i, value: I() }] });
    ids.push(TXN.apply(p, patch, PATCH.planPatch(p, patch), { ledger, timestamp: 'T' }).transaction_id);
  }
  for (let i = 0; i < 5; i++) TXN.preview(p, PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightHip', t: 40 + i, value: I() }] }), { ledger, tool: 't' });
  assert.ok(ledger.dropped > 0, 'the capacity should have bitten');
  for (const id of ids) assert.ok(ledger.get(id), `applied transaction ${id} was evicted despite being rollback-able`);
});

check('transaction: compareStates names the comparison methods it did NOT use', () => {
  const p = fixture();
  const q = SNAP.cloneProject(p);
  q.tracks.hero.RightHip.keys[1].v = CF.fromEuler(0.1, 0, 0);
  const c = TXN.compareStates(p, q);
  assert.equal(c.tracks.length, 1);
  assert.ok(c.methods_used.length === 2);
  assert.ok(c.methods_unavailable.length >= 3);
  // This used to assert every entry mentioned "Phase 4", which is why it kept passing after
  // Phase 4 shipped and left compareStates claiming that pixel and object-ID comparison did not
  // exist. What matters is that each entry distinguishes "does not exist" from "not reachable
  // from here", so assert that instead of a phase number.
  assert.ok(!c.methods_unavailable.some((s) => /Phase 4/.test(s)),
    'Phase 4 shipped: an unavailable-method note that still defers to it denies a capability the build has');
  assert.ok(c.methods_unavailable.some((s) => /EXIST/.test(s) && /explain_change/.test(s)),
    'the methods that exist but need rasters must name the tool that runs them');
  assert.ok(c.methods_unavailable.some((s) => /do not exist/.test(s)),
    'the passes that genuinely do not exist must still be named');
});

check('transaction: the full Phase 2 loop runs end to end on one project', () => {
  // Part 62's success condition for this phase, as a single test: "a local animation edit can be
  // previewed, validated, and fully reversed."
  const p = fixture();
  const origin = H.contentHash(p);
  const ledger = new TXN.TransactionLedger();
  CON.lock(p, { target: { kind: 'semantic', query: 'the camera' }, reason: 'framing approved' });

  const comp = CON.compileConstraints({
    allow: ['the hips', 'the right shoulder'],
    protect_frames: [{ frame: 16, tolerance: 1, reason: 'the impact' }],
    contacts: [{ effector: 'the left foot', from: 12, to: 23, tolerance_studs: 0.07 }],
  }, p);
  const patch = PATCH.makePatch({ intent: 'heavier windup', ops: [
    { op: 'set_key', itemId: 'hero', track: 'RightHip', t: 6, value: CF.fromEuler(0.3, 0, 0) },
    { op: 'set_key', itemId: 'hero', track: 'RightShoulder', t: 6, value: CF.fromEuler(0, 0, -0.4) },
  ] });

  const pv = TXN.preview(p, patch, {
    ledger, request: 'make the windup heavier', intent: 'heavier windup', tool: 'preview_animation_patch',
    constraints: comp.constraints, timestamp: 'T0',
    check: (proj, pt, plan) => CON.checkPatch(proj, pt, comp.constraints, { result: plan.result }),
    scope: (proj, plan) => SCOPE.analyseScope(proj, plan, { constraints: comp.constraints }),
  });
  assert.equal(pv.state_unchanged, true);
  assert.equal(pv.blocked, false);
  assert.equal(pv.scope.breadth.verdict, 'local');
  // Before MOT-008 this asserted that the foot contact landed in `not_checked`. It is checked now,
  // so the assertion inverts: the declared contact must NOT be in the unchecked list, and the
  // right-side edit must not be reported as breaking a left-foot contact it never touched.
  assert.ok(!pv.constraints_checked.not_checked.some((s) => /contact_drift/.test(s)),
    'contact drift is implemented — a contact constraint may no longer be reported as unchecked');
  assert.equal(pv.constraints_checked.violations.length, 0);

  const plan = PATCH.planPatch(p, patch);
  const report = CON.checkPatch(p, patch, comp.constraints, { result: plan.result });
  const applied = TXN.apply(p, patch, plan, { ledger, constraintReport: report, timestamp: 'T1' });
  assert.equal(applied.applied, true);
  assert.deepEqual(applied.changed_frame_range, { start: 6, end: 6 });

  // …and a patch that breaks the lock is refused even though the same request compiled fine.
  const bad = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'cam', track: '@fov', t: 6, value: 40 }] });
  const badPlan = PATCH.planPatch(p, bad);
  const badReport = CON.checkPatch(p, bad, comp.constraints, { result: badPlan.result });
  assert.equal(badReport.violations.length, 2, 'the persisted lock AND the allow-list both catch it');
  assert.equal(TXN.apply(p, bad, badPlan, { ledger, constraintReport: badReport, timestamp: 'T2' }).applied, false);

  const rb = TXN.rollback(p, ledger, applied.transaction_id, { timestamp: 'T3' });
  assert.equal(rb.complete, true);
  // The lock is project state and legitimately survives the rollback of an unrelated patch.
  assert.equal(CON.listLocks(p).length, 1);
  CON.unlock(p, CON.listLocks(p)[0].id);
  assert.equal(H.contentHash(p), origin, 'the project must be exactly where it started');
});

// ---------------------------------------------------------------- Phase 3: the animation language

console.log('\n— vocabulary (Part 21) —');

// An attack shaped like a real one: a wind-up, a fast strike arriving on a marked impact, and a
// recovery. Five joints spanning the kinetic chain, so chain depth actually varies.
function slashFixture() {
  const hero = { id: 'hero', kind: 'rig', name: 'Hero', rig: RIGS.r15, origin: I() };
  const key = (t, v, es = 'Sine', ed = 'Out') => ({ t, v, es, ed });
  const arc = (a, b, c) => ({ keys: [key(0, I()), key(8, a, 'Sine', 'InOut'), key(16, b), key(28, c ?? I())] });
  return {
    id: 'slash', name: 'Slash', version: 1, fps: 30, length: 60, loop: false, priority: 'Action',
    items: [hero],
    tracks: {
      hero: {
        Root: arc(CF.fromEuler(0, 0.3, 0), CF.fromEuler(0, -0.4, 0)),
        Waist: arc(CF.fromEuler(0, 0.4, 0), CF.fromEuler(0, -0.5, 0)),
        RightShoulder: arc(CF.fromEuler(0, 0, 1.2), CF.fromEuler(0, 0, -0.9)),
        RightElbow: arc(CF.fromEuler(0.6, 0, 0), CF.fromEuler(0.1, 0, 0)),
        LeftHip: arc(CF.fromEuler(0.2, 0, 0), CF.fromEuler(-0.2, 0, 0)),
      },
    },
    groups: [], markers: { hero: [{ t: 16, width: 2, name: 'impact' }] },
    playRange: null, onionSkin: { enabledItemIds: [], range: 3 }, audio: null,
  };
}

check('vocabulary: a term is a vector of dimensions, not a slider', () => {
  const r = VOC.interpret({}, ['heavy']);
  assert.ok(Object.keys(r.dimensions).length >= 6, 'heavy must move several dimensions, not one');
  assert.ok(r.dimensions.weight_transfer > 0 && r.dimensions.acceleration_contrast > 0);
  // The directive's own warning, as an assertion: "Heavy does not always mean slow."
  assert.ok(!('duration' in r.dimensions), 'heavy must not touch duration');
  assert.ok(r.findings.some((f) => f.id === 'VOCAB-PINNED-ZERO' && /slow/i.test(f.evidence[0].statement)));
});

check('vocabulary: weary and heavy pull acceleration contrast in OPPOSITE directions', () => {
  // The single most common way "heavy" gets implemented wrongly is by implementing "weary".
  const heavy = VOC.interpret({}, ['heavy']).dimensions;
  const weary = VOC.interpret({}, ['weary']).dimensions;
  assert.ok(heavy.acceleration_contrast > 0, 'heavy concentrates the travel');
  assert.ok(weary.acceleration_contrast < 0, 'weary flattens it');
});

check('vocabulary: same-sign pulls saturate and never exceed 1', () => {
  const r = VOC.interpret({}, ['heavy', 'powerful', 'aggressive']);
  for (const v of Object.values(r.dimensions)) assert.ok(Math.abs(v) <= 1, `dimension ran past 1: ${v}`);
  // …and no word is discarded by the clamp: three positive pulls beat two.
  const two = VOC.interpret({}, ['heavy', 'powerful']).dimensions.acceleration_contrast;
  assert.ok(r.dimensions.acceleration_contrast > two);
});

check('vocabulary: opposing words are reported as a tension, not averaged away', () => {
  const r = VOC.interpret({}, ['heavy', 'floaty']);
  const t = r.tensions.find((x) => x.dimension === 'acceleration_contrast');
  assert.ok(t, 'heavy wants contrast and floaty wants none — that must surface');
  assert.deepEqual(t.pushing_up, ['heavy']);
  assert.deepEqual(t.pushing_down, ['floaty']);
  assert.ok(/Which should win/.test(t.question));
});

check('vocabulary: a modifier scales, and "too" inverts', () => {
  const plain = VOC.interpret({}, [{ term: 'heavy', weight: 1 }]).dimensions.weight_transfer;
  const lots = VOC.interpret({}, [{ term: 'heavy', weight: 1.4 }]).dimensions.weight_transfer;
  const less = VOC.interpret({}, [{ term: 'heavy', weight: -1 }]).dimensions.weight_transfer;
  assert.ok(lots > plain && plain > 0);
  assert.ok(less < 0, '"less heavy" must reduce weight transfer, not increase it');
});

check('vocabulary: an unimplemented dimension is named, never silently ignored', () => {
  const r = VOC.interpret({}, ['heavy']);
  assert.ok(r.dimensions.contact_firmness > 0);
  assert.ok(r.notRun.some((s) => /contact_firmness/.test(s)));
  assert.ok(r.findings.some((f) => f.id === 'VOCAB-DIMENSION-NOT-COMPILABLE'));
});

check('vocabulary: an override is scoped, evidenced, and never rewrites the shared definition', () => {
  const p = slashFixture();
  assert.throws(() => VOC.setTerm(p, 'heavy', { dimensions: { motion_amplitude: -0.2 } }),
    /evidence/, 'an override without evidence must be refused');
  assert.throws(() => VOC.setTerm(p, 'ponderously-massive', { dimensions: {}, evidence: ['x'] }), /not a known term/);
  assert.throws(() => VOC.setTerm(p, 'heavy', { dimensions: { nonsense: 1 }, evidence: ['x'] }), /not a known dimension/);

  const entry = VOC.setTerm(p, 'heavy', {
    dimensions: { motion_amplitude: -0.4 }, scope: 'character', scopeId: 'hero',
    evidence: [{ kind: 'data', statement: 'the user scaled the amplitude back down twice' }],
  });
  const global = VOC.interpret({}, ['heavy']).dimensions.motion_amplitude;
  const scoped = VOC.interpret(p, ['heavy'], { itemId: 'hero' }).dimensions.motion_amplitude;
  const other = VOC.interpret(p, ['heavy'], { itemId: 'someone-else' }).dimensions.motion_amplitude;
  assert.ok(scoped < global, 'the override must bite for the character it names');
  assert.equal(other, global, 'and must NOT bite for anyone else');
  assert.equal(VOC.TERMS.heavy.dimensions.motion_amplitude, 0.2, 'the shared definition is untouched');

  // The same correction twice is one preference observed twice — that count is what tells a
  // one-off from a convention later (Part 58).
  const again = VOC.setTerm(p, 'heavy', {
    dimensions: { motion_amplitude: -0.4 }, scope: 'character', scopeId: 'hero',
    evidence: [{ kind: 'data', statement: 'the user scaled the amplitude back down twice' }],
  });
  assert.equal(again.id, entry.id);
  assert.equal(again.observations, 2);
  assert.equal(VOC.listOverrides(p).length, 1);

  VOC.clearTerm(p, entry.id);
  assert.equal(p.semantics, undefined, 'emptying the store must delete the container, not leave {}');
});

check('vocabulary: the explanation is generated from the vector, so the two cannot disagree', () => {
  const r = VOC.interpret({}, ['snappy']);
  const e = VOC.explain(r, { phrase: 'snappier' });
  assert.ok(/snappier/.test(e.header));
  for (const d of Object.keys(r.dimensions)) assert.ok(e.text.includes(d), `${d} is in the vector but not in the prose`);
  assert.ok(/follow_through: unchanged on purpose/.test(e.text), 'snappy must state what it does not delete');
});

console.log('\n— CAL (Part 20) —');

check('cal: every spec carries the directive\'s full field list, with null for unknown', () => {
  const i = CAL.intentSpec({ actionType: 'attack' });
  for (const f of ['action_type', 'narrative_purpose', 'emotional_intent', 'style_profile', 'energy',
    'weight', 'readability_priority', 'realism_level', 'audience_focus', 'requested_duration',
    'critical_events', 'preserve', 'avoid', 'evidence_source', 'confidence', 'unresolved_questions']) {
    assert.ok(f in i, `IntentSpec is missing ${f}`);
  }
  const pose = CAL.poseSpec({ role: 'extreme' });
  for (const f of ['line_of_action', 'silhouette_goals', 'balance_state', 'center_of_mass_target',
    'support_polygon', 'mirror_policy', 'camera_readability_notes']) {
    assert.ok(f in pose, `PoseSpec is missing ${f}`);
    // Unknown is null, never a default — a planner that read `balance_state: 'balanced'` here
    // would be reading an invention.
  }
  assert.equal(pose.line_of_action, null);
  assert.equal(CAL.spacingSpec({}).tangent_policy, null);
});

check('cal: an unknown enum value throws at construction', () => {
  assert.throws(() => CAL.intentSpec({ actionType: 'atack' }), /action_type/);
  assert.throws(() => CAL.phaseSpec({ name: 'windup' }), /phaseSpec.name/);
  assert.throws(() => CAL.poseSpec({ role: 'keyframe' }), /poseSpec.role/);
  assert.throws(() => CAL.contactSpec({ mode: 'stuck' }), /contactSpec.mode/);
  assert.throws(() => CAL.acceptanceSpec({ checks: [{ check: 'looks_good' }] }), /unknown check/);
  assert.throws(() => CAL.scalar(1.5), /\[0,1\]/);
});

check('cal: ids are content hashes, so the same spec is the same spec', () => {
  const a = CAL.intentSpec({ actionType: 'attack', narrativePurpose: 'x' });
  const b = CAL.intentSpec({ actionType: 'attack', narrativePurpose: 'x' });
  const c = CAL.intentSpec({ actionType: 'attack', narrativePurpose: 'y' });
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
  assert.ok(a.id.startsWith('intent:'));
});

check('cal: an already-built phase survives being put in a plan', () => {
  // The constructor reads camelCase input and writes snake_case output, so sending a built spec
  // back through it would null every field. An unnamed phase is a legitimate result, so the
  // "is this already built" test cannot be "does it have a name".
  const ph = CAL.phaseSpec({ name: null, timeRange: [0, 8], derivation: 'nothing names it' });
  const plan = CAL.motionPlan({ phases: [ph] });
  assert.deepEqual(plan.phases[0].time_range, [0, 8]);
  assert.equal(plan.phases[0].derivation, 'nothing names it');
});

check('cal: a contact this build makes is declared, never verified', () => {
  const c = CAL.contactSpec({ effector: 'the left foot', mode: 'planted', start: 12, end: 23 });
  assert.equal(c.validation_method, 'declared');
  assert.equal(c.certainty, C.CERTAINTY.USER_INTENT_REQUIRED);
  assert.throws(() => CAL.contactSpec({ mode: 'planted', validationMethod: 'proven' }), /validation_method/);
});

check('cal: acceptance never counts an unrunnable check as a pass', () => {
  const spec = CAL.acceptanceSpec({ checks: [
    { check: 'key_times_unchanged', itemId: 'hero' },
    { check: 'no_visual_regression' },
    { check: 'silhouette_readable' },
  ] });
  assert.equal(spec.not_runnable.length, 2);
  const p = slashFixture();
  const r = CAL.evaluateAcceptance(p, p, spec, { itemId: 'hero' });
  assert.equal(r.accepted, true, 'the one runnable check passes on an unchanged project');
  assert.equal(r.fully_validated, false, 'but two checks did not run, so this is NOT fully validated');
  assert.equal(r.results.filter((x) => x.status === 'not_run').length, 2);
  // Each unrunnable check must say what actually blocks IT. Asserting on a phase number was the
  // old form of this check and it rotted the moment Phase 4 shipped: the reason still read "no
  // renderer or baseline in the semantic layer" after both had been built. So assert the two
  // reasons name their own real obstacle instead — and assert it over the whole registry, because
  // the entry that rots is always the one nobody wrote a case for.
  const reasons = Object.fromEntries(r.results.filter((x) => x.status === 'not_run').map((x) => [x.check, x.reason]));
  assert.ok(/only project data|nothing else|no raster/.test(reasons.no_visual_regression),
    `no_visual_regression must say that the check gets no raster, not that rendering does not exist: ${reasons.no_visual_regression}`);
  for (const [name, def] of Object.entries(CAL.ACCEPTANCE_CHECKS).filter(([, d]) => !d.implemented)) {
    assert.ok(def.blocked_by, `${name} must say what blocks it`);
    assert.ok(!/Phase [0-5]\b/.test(def.blocked_by),
      `${name} defers to a phase that has shipped instead of naming its obstacle: ${def.blocked_by}`);
  }
});

check('cal: contact_drift_within measures the after-state, and says when the drift predates the change', () => {
  const before = plantFixture();
  const after = JSON.parse(JSON.stringify(before));
  after.tracks.hero.LeftHip.keys.push({ t: 16, v: CF.fromEuler(0.5, 0, 0) });
  const spec = CAL.acceptanceSpec({ checks: [
    { check: 'contact_drift_within', itemId: 'hero', effector: 'the left foot', start: 0, end: 16, tolerance: 0.05 },
  ] });
  assert.equal(spec.not_runnable.length, 0, 'contact_drift_within is implemented — it may not be listed as unrunnable');

  const clean = CAL.evaluateAcceptance(before, before, spec, { itemId: 'hero' });
  assert.equal(clean.results[0].status, 'pass');
  assert.equal(clean.fully_validated, true);

  const broken = CAL.evaluateAcceptance(before, after, spec, { itemId: 'hero' });
  assert.equal(broken.results[0].status, 'fail');
  assert.equal(broken.accepted, false);
  assert.equal(broken.results[0].measured.pre_existing, false, 'the contact was clean before, so the change owns it');
  assert.ok(broken.results[0].measured.after > 0.5);

  // The same edit judged against an already-broken before-state must say so, or the report blames
  // the last person who touched the file.
  const worse = JSON.parse(JSON.stringify(after));
  worse.tracks.hero.LeftHip.keys[1].v = CF.fromEuler(0.9, 0, 0);
  const already = CAL.evaluateAcceptance(after, worse, spec, { itemId: 'hero' });
  assert.equal(already.results[0].status, 'fail');
  assert.equal(already.results[0].measured.pre_existing, true);
  assert.ok(/ALREADY out of tolerance/.test(already.results[0].detail));
});

check('cal: a contact check with no tolerance is NOT RUN, and a sliding one is measured not judged', () => {
  const p = plantFixture();
  const after = JSON.parse(JSON.stringify(p));
  after.tracks.hero.LeftHip.keys.push({ t: 16, v: CF.fromEuler(0.5, 0, 0) });
  const noTol = CAL.acceptanceSpec({ checks: [{ check: 'contact_drift_within', itemId: 'hero', effector: 'the left foot', start: 0, end: 16 }] });
  const r1 = CAL.evaluateAcceptance(p, after, noTol, { itemId: 'hero' });
  assert.equal(r1.results[0].status, 'not_run');
  assert.equal(r1.accepted, false, 'a spec whose only check did not run has not been accepted');

  const sliding = CAL.acceptanceSpec({ checks: [{ check: 'contact_drift_within', itemId: 'hero', effector: 'the left foot', start: 0, end: 16, tolerance: 0.05, mode: 'sliding' }] });
  const r2 = CAL.evaluateAcceptance(p, after, sliding, { itemId: 'hero' });
  assert.equal(r2.results[0].status, 'not_run');
  assert.ok(/expected to move/.test(r2.results[0].reason));
});

check('cal: acceptance checks measure what they claim, and label the proxies', () => {
  const before = slashFixture();
  const after = slashFixture();
  after.tracks.hero.Waist.keys[1].t = 9;                          // a key moved
  after.tracks.hero.RightShoulder.keys[1].es = 'Quart';           // an ease changed
  after.tracks.hero.Root.keys[2].v = CF.fromEuler(0, -0.9, 0);    // a pose grew

  const spec = CAL.acceptanceSpec({ checks: [
    { check: 'key_times_unchanged', itemId: 'hero' },
    { check: 'easing_changed', itemId: 'hero', min_keys: 1 },
    { check: 'amplitude_increased', itemId: 'hero', tracks: ['Root'], min_ratio: 1.1 },
    { check: 'pose_unchanged_at', itemId: 'hero', track: 'LeftHip', t: 16, tolerance_deg: 0.1 },
    { check: 'scope_unchanged', itemIds: ['hero'] },
  ] });
  const r = CAL.evaluateAcceptance(before, after, spec, { itemId: 'hero' });
  const by = Object.fromEntries(r.results.map((x) => [x.check, x]));
  assert.equal(by.key_times_unchanged.status, 'fail');
  assert.equal(by.easing_changed.status, 'pass');
  assert.equal(by.amplitude_increased.status, 'pass');
  assert.equal(by.pose_unchanged_at.status, 'pass');
  assert.equal(by.scope_unchanged.status, 'pass');
  assert.equal(r.accepted, false);
  // Part 12: an artistic claim must never inherit a measurement's certainty.
  assert.ok(r.proxies.some((x) => x.check === 'amplitude_increased' && /judgement/.test(x.proxy_for)));
});

console.log('\n— intent (Part 20.1) —');

check('intent: the request becomes a labelled interpretation of both halves', () => {
  const p = slashFixture();
  const r = INT.interpretRequest(p, { request: 'make the slash heavier without changing timing', itemId: 'hero' });
  assert.equal(r.intent.action_type, 'attack', '"slash" names the motion, not a third of it');
  assert.deepEqual(r.intent.preserve, ['aspect:timing']);
  assert.ok(r.intent.dimensions.weight_transfer > 0);
  assert.ok(r.interpretation.changes.length > 3, 'the interpretation must say what will change');
  assert.ok(r.interpretation.preserves.some((s) => /timing: protected/.test(s)), 'and what will not');
  assert.equal(r.constraints.constraints.length, 1);
  assert.equal(r.constraints.constraints[0].aspect[0], 'timing');
});

check('intent: unrecognised words change nothing and are reported', () => {
  const p = slashFixture();
  const r = INT.interpretRequest(p, { request: 'make it more zorbulent and heavier', itemId: 'hero' });
  assert.ok(r.unrecognised.includes('zorbulent'));
  assert.ok(r.questions.some((q) => /zorbulent/.test(q)));
  assert.ok(r.findings.some((f) => f.id === 'INTENT-UNPARSED'));
  assert.ok(r.intent.dimensions.weight_transfer > 0, 'the part that WAS understood still works');
  assert.ok(r.intent.confidence < 1);
});

check('intent: "too heavy" reduces weight rather than increasing it', () => {
  const p = slashFixture();
  const r = INT.interpretRequest(p, { request: 'this is too heavy', itemId: 'hero' });
  assert.ok(r.intent.dimensions.weight_transfer < 0);
});

check('intent: a named phase and a frame range both narrow the target', () => {
  const p = slashFixture();
  const a = INT.interpretRequest(p, { request: 'make the windup heavier', itemId: 'hero' });
  assert.deepEqual(a.intent.target.phases, ['anticipation']);
  const b = INT.interpretRequest(p, { request: 'make frames 4 to 12 snappier', itemId: 'hero' });
  assert.deepEqual(b.intent.target.timeRange, [4, 12]);
  // …and with neither, the scope is the whole clip and the caller is told so.
  const c = INT.interpretRequest(p, { request: 'heavier', itemId: 'hero' });
  assert.equal(c.intent.target.timeRange, null);
  assert.ok(c.questions.some((q) => /whole animation/.test(q)));
});

check('intent: a preserve clause is compiled through the SAME constraint compiler as a hand-written one', () => {
  const p = slashFixture();
  const r = INT.interpretRequest(p, { request: 'snappier, keep the impact on frame 16 within 1 frame, do not change the left hip', itemId: 'hero' });
  const rules = r.constraints.constraints.map((c) => c.property_or_semantic_rule);
  assert.ok(rules.some((s) => /frame 16/.test(s)));
  assert.ok(rules.some((s) => /left hip/.test(s)));
  assert.equal(r.intent.critical_events[0].expected_time, 16);
  assert.equal(r.intent.critical_events[0].tolerance, 1);
});

console.log('\n— planner and motion compiler (Parts 20.2, 24) —');

check('plan: phases are cut at key times and named only with evidence', () => {
  const p = slashFixture();
  const s = PLAN.segmentPhases(p, 'hero', { actionType: 'attack' });
  assert.deepEqual(s.segments.map((x) => [x.from, x.to]), [[0, 8], [8, 16], [16, 28]]);
  const marked = s.phases.find((x) => x.name === 'impact');
  assert.equal(marked.certainty, C.CERTAINTY.HIGHLY_LIKELY, 'a marker is better evidence than a curve');
  assert.ok(/marker named "impact"/.test(marked.derivation));
  const inferred = s.phases.find((x) => x.name === 'anticipation');
  assert.equal(inferred.certainty, C.CERTAINTY.POSSIBLE, 'a rate profile is never better than possible');
  assert.ok(s.findings.some((f) => f.id === 'PLAN-PHASES-INFERRED'));
});

check('plan: without a template, spans stay unnamed and say why', () => {
  const p = slashFixture();
  delete p.markers.hero;
  const s = PLAN.segmentPhases(p, 'hero', { actionType: 'gesture' });
  assert.ok(s.phases.every((x) => x.name === null), 'inventing a phase structure for a gesture would be a guess');
  assert.ok(s.coverage.notRun.some((x) => /no phase template exists/.test(x)));
});

check('plan: declared boundaries outrank everything and are certain', () => {
  const p = slashFixture();
  const s = PLAN.segmentPhases(p, 'hero', { actionType: 'attack', boundaries: [{ name: 'action', from: 2, to: 5 }] });
  assert.equal(s.source, 'declared');
  assert.equal(s.phases.length, 1);
  assert.equal(s.phases[0].certainty, C.CERTAINTY.CERTAIN);
});

check('plan: an unimplemented dimension is blocked with its reason, not dropped', () => {
  const p = slashFixture();
  const i = INT.interpretRequest(p, { request: 'heavier', itemId: 'hero' });
  const m = PLAN.planMotion(p, { intent: i.intent, constraints: i.constraints.constraints });
  const cf = m.plan.blocked.find((b) => b.dimension === 'contact_firmness');
  assert.ok(cf, 'contact_firmness compiles to nothing and must be reported, not dropped');
  assert.equal(cf.blocked_by, 'capability');
  // The reason has to name the missing EDIT, not the missing measurement — MOT-008 shipped the
  // measurement, and a reason still citing it would be telling a caller a capability is absent
  // when it is not.
  assert.ok(/inverse-kinematic|effector/.test(cf.reason), `contact_firmness must name the missing edit: ${cf.reason}`);
  assert.ok(!/cannot be measured/.test(cf.reason));
  assert.ok(m.plan.blocked.some((b) => b.dimension.startsWith('vfx_') && /Part 37/.test(b.reason)));

  // …and the same property across every blocked dimension, so the next one to land cannot leave a
  // stale sentence behind in a row nobody wrote a case for.
  for (const [name, d] of Object.entries(VOC.DIMENSIONS).filter(([, x]) => !x.implemented)) {
    assert.ok(d.blocked_by, `${name} must say what blocks it`);
    assert.ok(!/\(Phase [0-5]\)|until Phase [0-5]/.test(d.blocked_by), `${name} defers to a shipped phase: ${d.blocked_by}`);
  }
});

check('plan: three dimensions sharing one strategy are COMBINED, not applied one after another', () => {
  // The bug this pins: heavy routes weight_transfer, anticipation_depth and motion_amplitude into
  // `amplitude`. Built as three separate edits they produced three set_key ops on the same key, and
  // the last applied won — silently discarding the largest pull, which is most of what heavy means.
  const p = slashFixture();
  const i = INT.interpretRequest(p, { request: 'make the slash heavier', itemId: 'hero' });
  const m = PLAN.planMotion(p, { intent: i.intent, constraints: [] });
  const amp = m.plan.edits.filter((e) => e.strategy === 'amplitude');
  assert.equal(amp.length, 1, 'amplitude must appear once, carrying every contribution');
  assert.equal(amp[0].contributions.length, 3);
  assert.ok(amp[0].pull > Math.max(...amp[0].contributions.map((c) => c.pull)), 'the combined pull must exceed the largest single one');

  const c = PLAN.compilePlan(p, m.plan, m.ctx, { constraints: [] });
  const writes = c.ops.filter((o) => o.op === 'set_key');
  assert.ok(writes.length >= 10, `the uniqueness check below is only meaningful with real writes; got ${writes.length}`);
  const seen = new Set();
  for (const op of writes) {
    const k = `${op.track}@${op.t}`;
    assert.ok(!seen.has(k), `${k} is written twice — one write would silently win`);
    seen.add(k);
  }
  // …and the surviving scale reflects the COMBINED pull, not the smallest contribution. The
  // smallest is motion_amplitude at +0.2, which alone would scale the waist by ×1.1.
  const after = PATCH.planPatch(p, PATCH.makePatch({ ops: c.ops })).result;
  const grew = K.angleBetween(CF.IDENTITY, K.evalTrackCF(after.tracks.hero.Waist, 8))
    / K.angleBetween(CF.IDENTITY, K.evalTrackCF(p.tracks.hero.Waist, 8));
  assert.ok(grew > 1.2, `the waist grew only ×${grew.toFixed(3)} — that is the smallest pull winning, not the combination`);
});

check('plan: spacing never touches the key at the end of a phase', () => {
  // That key's easing governs the NEXT span. Expressing the exclusion as `to - EPS` did not work:
  // the tolerance inside keysIn cancelled it exactly and every phase reshaped its successor.
  const p = slashFixture();
  const i = INT.interpretRequest(p, { request: 'snappier', itemId: 'hero' });
  const m = PLAN.planMotion(p, { intent: i.intent, constraints: [] });
  const c = PLAN.compilePlan(p, m.plan, m.ctx, { constraints: [] });
  const eases = c.ops.filter((o) => o.op === 'set_easing');
  assert.ok(eases.length >= 5, `the exclusions below are only meaningful with real ops; got ${eases.length}`);
  assert.ok(!eases.some((o) => o.t === 28), 'the last key of the clip has no outgoing segment inside it');
  // Three spans, so exactly three departure keys per track — never six.
  const perTrack = eases.filter((o) => o.track === 'Waist').length;
  assert.equal(perTrack, 3, `Waist got ${perTrack} easing ops for 3 spans (6 means each span also reshaped its successor)`);
});

check('plan: two strategies writing the same easing resolve by precedence, and the loss is reported', () => {
  const p = slashFixture();
  // "slash" is what makes this an attack, which is what names the phases, which is what lets
  // overshoot find an arriving span at all. A bare "heavier" leaves the spans unnamed on purpose.
  const i = INT.interpretRequest(p, { request: 'make the slash heavier', itemId: 'hero' });
  const m = PLAN.planMotion(p, { intent: i.intent, constraints: [] });
  const c = PLAN.compilePlan(p, m.plan, m.ctx, { constraints: [] });
  const keys = c.ops.filter((o) => o.op === 'set_easing').map((o) => `${o.track}@${o.t}`);
  assert.equal(new Set(keys).size, keys.length, 'no key may carry two easing writes');
  assert.ok(c.findings.some((f) => f.id === 'PLAN-OP-OVERLAP' && /overshoot/.test(f.statement)));
});

check('plan: overshoot decides a plant by MEASUREMENT, not by whether the part could hold one', () => {
  // This used to be a blanket refusal: every hand, foot, forearm and shin was skipped, because
  // nothing could tell a planted foot from a swinging forearm. MOT-008 can, and the strategy now
  // costs the arm nothing while still protecting a real plant. Both halves are asserted, because
  // a change that only relaxed the rule would be a regression wearing a measurement.
  const p = slashFixture();
  const i = INT.interpretRequest(p, { request: 'make the slash heavier', itemId: 'hero' });
  const m = PLAN.planMotion(p, { intent: i.intent, constraints: [] });
  const c = PLAN.compilePlan(p, m.plan, m.ctx, { constraints: [] });
  const back = c.ops.filter((o) => o.es === 'Back');
  assert.ok(back.length, 'the attack template names a follow_through, so overshoot has somewhere to go');
  assert.ok(back.some((o) => o.track === 'RightElbow'),
    'the forearm sweeps a stud and a half in this span — it is not planted, and refusing it inertia was costing the strategy most of the arm');
  assert.ok(c.notes.some((n) => /^overshoot: /.test(n) && /not planted there/.test(n)),
    'and the measurement that decided it is recorded');
  assert.ok(!back.some((o) => o.t === 8), 'frame 8 departs into the impact — overshooting into a contact is the thing not to do');

  // The other half: a foot that genuinely does not move is still refused, and the refusal now
  // carries the number it was refused on.
  const pl = plantFixture();
  const i2 = INT.interpretRequest(pl, { request: 'make the slash heavier', itemId: 'hero' });
  const m2 = PLAN.planMotion(pl, { intent: i2.intent, constraints: [] });
  const c2 = PLAN.compilePlan(pl, m2.plan, m2.ctx, { constraints: [] });
  const skip = c2.skipped.find((s) => s.strategy === 'overshoot' && s.track === 'LeftAnkle');
  assert.ok(skip, 'the planted ankle must still be skipped');
  assert.ok(/breaks the plant/.test(skip.why) && /travels only 0 stud/.test(skip.why),
    `the refusal must carry its measurement: ${skip && skip.why}`);
  assert.ok(!c2.ops.some((o) => o.es === 'Back' && o.track === 'LeftAnkle'));
});

check('plan: with no action type the spans stay unnamed, and overshoot declines rather than guessing', () => {
  const p = slashFixture();
  const i = INT.interpretRequest(p, { request: 'heavier', itemId: 'hero' });
  assert.equal(i.intent.action_type, null, 'one adjective is not enough to claim what kind of motion this is');
  const m = PLAN.planMotion(p, { intent: i.intent, constraints: [] });
  const c = PLAN.compilePlan(p, m.plan, m.ctx, { constraints: [] });
  assert.ok(c.skipped.some((s) => s.strategy === 'overshoot' && /would land anywhere/.test(s.why)));
  assert.ok(!c.ops.some((o) => o.es === 'Back'));
  // …and the strategies that do not need a phase name still run, so the request is not wasted.
  assert.ok(c.applied.some((a) => a.strategy === 'amplitude'));
});

check('plan: an amplitude edit anchors on the span start, so the range still joins what precedes it', () => {
  const p = slashFixture();
  const before = K.evalTrackCF(p.tracks.hero.Waist, 0);
  const i = INT.interpretRequest(p, { request: 'heavier', itemId: 'hero' });
  const m = PLAN.planMotion(p, { intent: i.intent, constraints: [] });
  const c = PLAN.compilePlan(p, m.plan, m.ctx, { constraints: [] });
  const patch = PATCH.makePatch({ ops: c.ops });
  const after = PATCH.planPatch(p, patch).result;
  assert.ok(K.angleBetween(before, K.evalTrackCF(after.tracks.hero.Waist, 0)) < 1e-6, 'frame 0 is the anchor and must not move');
  assert.ok(K.angleBetween(K.evalTrackCF(p.tracks.hero.Waist, 16), K.evalTrackCF(after.tracks.hero.Waist, 16)) > 1, 'and the strike must actually grow');
});

check('plan: scaleAbout takes the short way round', () => {
  // A rotation stored as its long-way-round equivalent would otherwise scale along the long arc and
  // swing the joint the wrong direction — the quaternion has to be flipped to w >= 0 first.
  const anchor = CF.IDENTITY.slice();
  const v = CF.fromEuler(0, 0, 3.0);          // 172°, close enough to π to flip sign in the quat
  const half = PLAN.scaleAbout(anchor, v, 0.5);
  assert.ok(Math.abs(K.angleBetween(anchor, half) - K.angleBetween(anchor, v) / 2) < 0.5,
    'half the scale must be half the angle');
  assert.ok(K.angleBetween(PLAN.scaleAbout(anchor, v, 1), v) < 1e-6, 'a scale of 1 is the identity');
});

check('plan: a plan against an item with no rig refuses rather than producing nothing', () => {
  const p = slashFixture();
  p.items.push({ id: 'cam', kind: 'camera', name: 'Camera', origin: I() });
  const i = INT.interpretRequest(p, { request: 'heavier', itemId: 'cam' });
  assert.throws(() => PLAN.planMotion(p, { intent: i.intent, constraints: [] }), /no rig/);
});

check('plan: a named phase that segmentation cannot find asks instead of guessing', () => {
  const p = slashFixture();
  delete p.markers.hero;
  const i = INT.interpretRequest(p, { request: 'make the settle heavier', itemId: 'hero', actionType: 'gesture' });
  const m = PLAN.planMotion(p, { intent: i.intent, constraints: [] });
  assert.ok(m.questions.some((q) => /segmentation did not identify one/.test(q)));
  assert.ok(m.findings.some((f) => f.id === 'PLAN-PHASE-NOT-FOUND'));
  const c = PLAN.compilePlan(p, m.plan, m.ctx, { constraints: [] });
  assert.equal(c.ops.length, 0, 'it must not silently widen to the whole clip');
});

check('plan: a persisted lock blocks the strategy that would break it', () => {
  const p = slashFixture();
  CON.lock(p, { target: { kind: 'track', itemId: 'hero', track: 'Waist' }, reason: 'the torso is signed off' });
  const i = INT.interpretRequest(p, { request: 'heavier', itemId: 'hero' });
  const m = PLAN.planMotion(p, { intent: i.intent, constraints: i.constraints.constraints });
  const c = PLAN.compilePlan(p, m.plan, m.ctx, { constraints: i.constraints.constraints });
  const amp = c.blocked.find((b) => b.strategy === 'amplitude');
  assert.ok(amp, 'the amplitude strategy touches the locked track, so the whole strategy is dropped');
  assert.equal(amp.blocked_by, 'constraint');
  assert.ok(amp.contributes.length > 10, 'and the plan says what the motion loses');
  assert.ok(!c.ops.some((o) => o.track === 'Waist' && o.op === 'set_key'));
});

check('plan: nothing in a plan claims a visual or contact check was made', () => {
  const p = slashFixture();
  const i = INT.interpretRequest(p, { request: 'heavier', itemId: 'hero' });
  const m = PLAN.planMotion(p, { intent: i.intent, constraints: [] });
  assert.ok(m.coverage.notRun.some((s) => /nothing was rendered/.test(s)));
  // A DECLARED contact is measured now; an undeclared one is not, and the difference is the claim.
  assert.ok(m.coverage.notRun.some((s) => /UNDECLARED one is not/.test(s)));
  assert.ok(PLAN.planLimitations().cannot.some((s) => /judge the result/.test(s)));
  assert.ok(!m.coverage.notRun.some((s) => /Phase [0-5]\b/.test(s)),
    'a plan may not defer any of its uncovered ground to a phase that has already shipped');
});

check('layer: the Phase 3 success condition — "heavier without changing timing", expressed, planned, enforced', () => {
  // Part 62, Phase 3, verbatim: "the user can request 'heavier without changing timing,' and
  // Cadence can express, plan, and enforce that request."
  const p = slashFixture();
  const origin = H.contentHash(p);
  const before = JSON.parse(JSON.stringify(p));
  const ledger = new TXN.TransactionLedger();

  // EXPRESS
  const i = INT.interpretRequest(p, { request: 'make the slash heavier without changing timing', itemId: 'hero' });
  assert.deepEqual(i.intent.preserve, ['aspect:timing']);
  assert.ok(i.interpretation.text.includes('weight_transfer'));

  // PLAN
  const m = PLAN.planMotion(p, { intent: i.intent, constraints: i.constraints.constraints });
  assert.ok(m.plan.phases.length === 3);
  assert.ok(m.plan.edits.length >= 3);
  const c = PLAN.compilePlan(p, m.plan, m.ctx, { constraints: i.constraints.constraints });

  // ENFORCE — the one strategy that moves keys is refused, by name, with what it cost
  const lead = c.blocked.find((b) => b.strategy === 'lead_lag');
  assert.ok(lead, 'body lead moves keys and must be blocked by the timing protection');
  assert.equal(lead.blocked_by, 'constraint');
  assert.equal(lead.constraints[0].rule, 'no key changes time');
  assert.ok(lead.operations_dropped > 0);
  assert.ok(c.lost.some((l) => /body-driven motion/.test(l.cost)));
  // …and the rest still runs, so the request is not simply refused
  assert.ok(c.ops.length > 0);
  assert.ok(c.applied.some((a) => a.strategy === 'amplitude'));
  assert.ok(!c.ops.some((o) => o.op === 'move_key'), 'not one key may move');

  // APPLY through the Phase 2 machinery
  const patch = PATCH.makePatch({ ops: c.ops, intent: 'heavier, timing preserved' });
  const plan = PATCH.planPatch(p, patch);
  const report = CON.checkPatch(p, patch, i.constraints.constraints, { result: plan.result });
  assert.equal(report.allowed, true, 'what survived compilation must survive the checker too');
  const applied = TXN.apply(p, patch, plan, { ledger, constraintReport: report, timestamp: 'T1' });
  assert.equal(applied.applied, true);

  // ACCEPT — the criteria the plan set for itself
  const acc = CAL.evaluateAcceptance(before, p, m.plan.acceptance_criteria, { itemId: 'hero' });
  assert.equal(acc.accepted, true, acc.summary);
  assert.equal(acc.fully_validated, false, 'nothing rendered, so this is not fully validated and must not claim to be');
  const by = Object.fromEntries(acc.results.map((x) => [x.check, x]));
  assert.equal(by.key_times_unchanged.status, 'pass', 'the timing promise, measured');
  assert.equal(by.amplitude_increased.status, 'pass', 'the heaviness proxy, measured');
  assert.equal(by.no_visual_regression.status, 'not_run');

  // …and fully reversible, back to the byte-identical original.
  const rb = TXN.rollback(p, ledger, applied.transaction_id, { timestamp: 'T2' });
  assert.equal(rb.complete, true);
  assert.equal(H.contentHash(p), origin, 'the project must be exactly where it started');
});

console.log('\n— raster —');

// A raster fixture: `draw` paints into a byte buffer with the same origin convention the real
// passes use (row 0 at the top), so a region reported here means what it means in the app.
function gray(width, height, draw, { camera = CAM_A } = {}) {
  const data = new Uint8Array(width * height);
  draw((x, y, v) => { data[y * width + x] = v; });
  return RAS.makeRaster({ pass: 'silhouette', frame: 0, width, height, encoding: 'gray8', data, camera });
}
function idRaster(width, height, palette, draw, { camera = CAM_A } = {}) {
  const data = new Uint8Array(width * height * 4);
  draw((x, y, index) => {
    const o = (y * width + x) * 4;
    data[o] = index & 0xff; data[o + 1] = (index >> 8) & 0xff; data[o + 2] = (index >> 16) & 0xff; data[o + 3] = 255;
  });
  return RAS.makeRaster({ pass: 'object_id', frame: 0, width, height, encoding: 'id8', data, camera, palette });
}
const CAM_A = RAS.cameraFingerprint({ position: [9, 7, 12], quaternion: [0, 0, 0, 1], fov: 55, aspect: 1 });
const CAM_B = RAS.cameraFingerprint({ position: [9, 7, 13], quaternion: [0, 0, 0, 1], fov: 55, aspect: 1 });
const box = (x0, y0, w, h, v = 255) => (set) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, v); };

check('raster: a buffer that does not match its own header is refused at construction', () => {
  assert.throws(() => RAS.makeRaster({ pass: 'silhouette', width: 4, height: 4, encoding: 'gray8', data: new Uint8Array(15) }), /needs 16 bytes/);
  assert.throws(() => RAS.makeRaster({ pass: 'object_id', width: 2, height: 2, encoding: 'id8', data: new Uint8Array(16) }), /without a palette names nothing/);
});

check('raster: the digest is over the pixels AND the shape', () => {
  const a = gray(8, 8, box(1, 1, 3, 3));
  const b = gray(8, 8, box(1, 1, 3, 3));
  assert.equal(RAS.rasterDigest(a), RAS.rasterDigest(b));
  assert.notEqual(RAS.rasterDigest(a), RAS.rasterDigest(gray(8, 8, box(2, 1, 3, 3))));
  // Same bytes, different declared shape: a 4x16 and a 16x4 buffer of identical content are not
  // the same image, and a digest that said they were would alias two baselines.
  const flat = new Uint8Array(64).fill(7);
  assert.notEqual(
    RAS.rasterDigest(RAS.makeRaster({ pass: 'silhouette', width: 4, height: 16, encoding: 'gray8', data: flat, camera: CAM_A })),
    RAS.rasterDigest(RAS.makeRaster({ pass: 'silhouette', width: 16, height: 4, encoding: 'gray8', data: flat, camera: CAM_A })),
  );
});

check('raster: a comparison across two viewpoints is REFUSED, not measured', () => {
  // The failure this pins: the user nudges the orbit camera between a baseline and a check, every
  // silhouette moves, and a regression engine reports a whole-body change with total confidence.
  const a = gray(8, 8, box(1, 1, 3, 3), { camera: CAM_A });
  const b = gray(8, 8, box(1, 1, 3, 3), { camera: CAM_B });
  for (const m of [RAS.pixelDifference(a, b), RAS.maskDifference(a, b), RAS.edgeDifference(a, b)]) {
    assert.equal(m.comparable, false, `${m.method} must refuse across viewpoints`);
    assert.match(m.reason, /camera moved/);
  }
  // And a raster with no fingerprint at all is refused too — unknown is not "probably fine".
  const anon = RAS.makeRaster({ pass: 'silhouette', width: 8, height: 8, encoding: 'gray8', data: new Uint8Array(64), camera: null });
  assert.equal(RAS.pixelDifference(a, anon).comparable, false);
  assert.match(RAS.pixelDifference(a, anon).reason, /no camera fingerprint/);
});

check('raster: a resolution mismatch is refused rather than resampled', () => {
  const a = gray(8, 8, box(1, 1, 3, 3));
  const b = gray(16, 16, box(2, 2, 6, 6));
  assert.equal(RAS.pixelDifference(a, b).comparable, false);
  assert.match(RAS.pixelDifference(a, b).reason, /resampling/);
});

check('raster: pixel difference locates the change to an exact region', () => {
  const a = gray(16, 16, box(2, 2, 4, 4));
  const b = gray(16, 16, (set) => { box(2, 2, 4, 4)(set); box(10, 11, 2, 3)(set); });
  const d = RAS.pixelDifference(a, b);
  assert.equal(d.changed, true);
  assert.equal(d.changed_pixels, 6);
  assert.equal(d.max_channel_delta, 255);
  assert.deepEqual(d.region, { x: 10, y: 11, width: 2, height: 3 });
  assert.equal(RAS.pixelDifference(a, a).changed, false);
  assert.equal(RAS.pixelDifference(a, a).region, null);
});

check('raster: silhouette coverage separates what was gained from what was lost', () => {
  const a = gray(16, 16, box(2, 2, 4, 4));   // 16 px
  const b = gray(16, 16, box(4, 2, 4, 4));   // 16 px, shifted right by 2
  const d = RAS.maskDifference(a, b);
  assert.equal(d.coverage_before, 16);
  assert.equal(d.coverage_after, 16);
  assert.equal(d.pixels_gained, 8);
  assert.equal(d.pixels_lost, 8);
  assert.equal(d.centroid_shift_px, 2);
  // The count alone cannot tell a shift from a resize; IoU and the centroid can.
  assert.ok(d.intersection_over_union > 0.3 && d.intersection_over_union < 0.4);
});

check('raster: edge displacement measures HOW FAR an outline moved, not how many pixels changed', () => {
  const a = gray(32, 32, box(4, 4, 8, 8));
  const near = gray(32, 32, box(5, 4, 8, 8));   // one pixel right
  const far = gray(32, 32, box(16, 4, 8, 8));   // twelve pixels right
  const dn = RAS.edgeDifference(a, near), df = RAS.edgeDifference(a, far);
  assert.equal(dn.approximate, true, 'a chamfer distance must declare itself approximate');
  assert.ok(dn.max_displacement_px <= 1.5, `a one-pixel shift should measure about 1px, got ${dn.max_displacement_px}`);
  assert.ok(df.max_displacement_px > 8, `a twelve-pixel shift should measure far more, got ${df.max_displacement_px}`);
  assert.ok(df.max_displacement_px > dn.max_displacement_px * 4);
  assert.equal(RAS.edgeDifference(a, gray(32, 32, box(4, 4, 8, 8))).max_displacement_px, 0);
});

check('raster: object-ID difference names WHICH objects moved, appeared and vanished', () => {
  const palette = { 1: 'part:hero/Torso', 2: 'part:hero/RightHand', 3: 'part:hero/LeftHand' };
  const a = idRaster(32, 32, palette, (set) => {
    box(10, 10, 6, 8, 1)(set); box(18, 12, 3, 3, 2)(set); box(4, 12, 3, 3, 3)(set);
  });
  const b = idRaster(32, 32, palette, (set) => {
    box(10, 10, 6, 8, 1)(set); box(24, 12, 3, 3, 2)(set); // right hand moved 6px, left hand gone
  });
  const d = RAS.idDifference(a, b);
  assert.equal(d.trustworthy, true, 'every pixel must be attributable to a palette entry');
  assert.deepEqual(d.disappeared.map((x) => x.entity), ['part:hero/LeftHand']);
  assert.deepEqual(d.appeared, []);
  assert.equal(d.moved.length, 1);
  assert.equal(d.moved[0].entity, 'part:hero/RightHand');
  assert.equal(d.moved[0].centroid_shift_px, 6);
  assert.equal(d.unchanged_count, 1, 'the torso held still and must be reported as unchanged, not omitted');
});

check('raster: a pixel the palette cannot name is counted, not attributed to a neighbour', () => {
  const palette = { 1: 'part:hero/Torso' };
  const r = idRaster(8, 8, palette, (set) => { box(1, 1, 2, 2, 1)(set); box(5, 5, 2, 2, 9)(set); });
  const counts = RAS.objectPixelCounts(r);
  assert.equal(counts.objects['part:hero/Torso'].pixels, 4);
  assert.equal(counts.unclassified_pixels, 4);
  const d = RAS.idDifference(r, idRaster(8, 8, palette, box(1, 1, 2, 2, 1)));
  assert.equal(d.trustworthy, false, 'a comparison with unattributable pixels must not claim to be complete');
  assert.match(d.note, /incomplete/);
});

check('raster: a signature localises without pretending to measure', () => {
  const a = gray(64, 64, box(4, 4, 8, 8));
  const b = gray(64, 64, box(40, 40, 8, 8));
  const d = RAS.signatureDifference(RAS.signature(a, { blocks: 8 }), RAS.signature(b, { blocks: 8 }));
  assert.equal(d.changed, true);
  assert.ok(d.changed_blocks >= 2 && d.changed_blocks <= 8);
  assert.ok(d.cannot_answer.some((s) => /by how many pixels/.test(s)), 'a degraded comparison must name what it cannot answer');
  assert.equal(RAS.signatureDifference(RAS.signature(a), RAS.signature(a)).changed, false);
});

console.log('\n— observe —');

check('observe: every Part 43 pass is present, and the 19 that do not exist say what blocks them', () => {
  const all = Object.values(OBS.PASSES);
  assert.ok(all.length >= 24, `Part 43 lists 24 observation kinds; PASSES has ${all.length}`);
  const missing = all.filter((p) => !p.implemented);
  assert.ok(missing.length >= 15);
  for (const p of missing) assert.ok(p.unblocked_by && p.unblocked_by.length > 10, `${p.id} is unimplemented and does not say why`);
  assert.deepEqual(OBS.availablePasses().sort(), ['beauty', 'changed_region_mask', 'object_bounding_boxes', 'object_id', 'silhouette']);
  // The prose count drifted from the registry once already: observeLimitations said "4 of 24 …
  // the other 20" while PASSES held 5 implemented and 19 not, because the pre-existing beauty
  // render was left out of the tally in one place and counted in the other. Tie the sentence to
  // the registry so the next pass to land cannot leave it stale.
  const lim = OBS.observeLimitations().cannot.find((s) => /of Part 43's 24 observation kinds/.test(s));
  assert.ok(lim, 'observeLimitations must state how many of Part 43\'s 24 kinds exist');
  assert.ok(lim.startsWith(`${OBS.availablePasses().length} of Part 43's 24`),
    `observeLimitations claims a different count from PASSES (${OBS.availablePasses().length} implemented): ${lim}`);
  assert.ok(new RegExp(`the other ${missing.length} are enumerated`).test(lim),
    `observeLimitations must say ${missing.length} are missing, to match PASSES: ${lim}`);
});

check('observe: a derived pass resolves back to the render that produces it', () => {
  // Asking the renderer for "changed_region_mask" would produce nothing — it is post-processing
  // over a silhouette. Resolving it here is what stops that from being a silent no-op.
  assert.deepEqual(OBS.renderablePasses(['changed_region_mask', 'object_bounding_boxes']), ['silhouette', 'object_id']);
  assert.deepEqual(OBS.renderablePasses(['depth']), [], 'an unimplemented pass resolves to nothing rather than to a lie');
  assert.throws(() => OBS.renderablePasses(['xray']), /unknown pass/);
});

check('observe: an identical pair is settled at tier 1 and costs no render', () => {
  const p = fixture();
  const plan = OBS.observationPlan(SNAP.diffProjects(p, p));
  assert.deepEqual(plan.recommended.passes, []);
  assert.deepEqual(plan.recommended.frames, []);
  assert.equal(plan.tiers[0].chosen, true);
  assert.ok(plan.tiers.slice(1).every((t) => !t.chosen), 'no tier past the first may run once the answer is known');
  assert.ok(plan.findings.some((f) => /No observation is warranted/.test(f.statement)));
});

check('observe: a joint edit stops at tier 3; a camera edit escalates to tier 5', () => {
  const a = fixture();
  const b = fixture();
  b.tracks.hero.RightShoulder.keys[1].v = CF.fromEuler(0, 0, 1.6);
  const local = OBS.observationPlan(SNAP.diffProjects(a, b), { length: a.length });
  assert.deepEqual(local.recommended.passes, ['silhouette', 'object_id']);
  assert.ok(local.recommended.frames.includes(8), 'the changed key time must be observed');
  assert.equal(local.tiers[4].chosen, false, 'a local joint edit must not escalate to a full pass comparison');
  assert.equal(local.escalation_triggers_fired.length, 0);

  const c = fixture();
  c.tracks.cam['@fov'].keys[1].v = 20;
  const wide = OBS.observationPlan(SNAP.diffProjects(a, c), { length: a.length });
  assert.equal(wide.tiers[4].chosen, true);
  assert.ok(wide.escalation_triggers_fired.some((t) => t.trigger === 'camera'));
});

check('observe: suspect frames include the midpoints, and a frame dropped by the cap is named', () => {
  const a = fixture();
  const b = fixture();
  b.tracks.hero.RightShoulder.keys[1].v = CF.fromEuler(0, 0, 1.6);
  b.tracks.hero.RightShoulder.keys[2].v = CF.fromEuler(0, 0, -1.4);
  const s = OBS.suspectFrames(SNAP.diffProjects(a, b), { length: 60, max: 6 });
  assert.deepEqual(s.frames.map((f) => f.frame), [8, 12, 16]);
  assert.ok(s.frames[1].why[0].includes('midway'), 'the midpoint must say why it was chosen');
  const capped = OBS.suspectFrames(SNAP.diffProjects(a, b), { length: 60, max: 2 });
  assert.equal(capped.frames.length, 2);
  assert.ok(capped.note && /NOT observed/.test(capped.note), 'a frame the cap dropped must be named, not silently omitted');
  assert.deepEqual(capped.dropped, [12]);
});

console.log('\n— baseline —');

function observation(frame, pass, digest, cells) {
  return { frame, pass, digest, camera: CAM_A, signature: { kind: 'mean_luminance', blocks: 2, cells, objects: null }, stats: null };
}

check('baseline: Part 44\'s seventeen fields are all present, and the four Cadence cannot fill say why', () => {
  const p = fixture();
  const b = BASE.createBaseline(p, {
    name: 'before the swing', snapshot: { id: 'snapshot:aaa', hash: 'aaa' },
    observations: [observation(8, 'silhouette', 'd1', [1, 2, 3, 4])],
    resolution: '192x192', author: 'ai', timestamp: '2026-09-08T00:00:00Z',
  });
  for (const f of ['scene_snapshot', 'animation_revision', 'vfx_revision', 'camera_revision',
    'lighting_and_environment_state', 'render_settings', 'frame_rate', 'resolution', 'frame_range',
    'color_management', 'simulation_seeds', 'cache_hashes', 'diagnostic_passes_available',
    'acceptance_criteria', 'approved_differences', 'author', 'timestamp']) {
    assert.ok(f in b, `Part 44's "${f}" is missing from the baseline record`);
  }
  assert.equal(b.frame_rate, 30);
  assert.deepEqual(b.frame_range, { start: 8, end: 8 });
  // The four nulls must each carry their own reason. A null with no reason reads as "unchanged".
  assert.equal(b.unavailable.length, 4);
  for (const u of b.unavailable) {
    assert.equal(b[u.field], null);
    assert.ok(u.reason.length > 40, `${u.field} is null without a real reason`);
  }
  assert.ok(b.unavailable.some((u) => u.field === 'lighting_and_environment_state'));
});

check('baseline: animation, camera and VFX revisions move independently', () => {
  const p = fixture();
  const r0 = BASE.revisionsOf(p);
  p.tracks.hero.RightShoulder.keys[1].v = CF.fromEuler(0, 0, 1.6);
  const r1 = BASE.revisionsOf(p);
  assert.notEqual(r0.animation, r1.animation);
  assert.equal(r0.camera, r1.camera, 'a joint edit must not move the camera revision');
  p.tracks.cam['@fov'].keys[1].v = 20;
  const r2 = BASE.revisionsOf(p);
  assert.notEqual(r1.camera, r2.camera);
  assert.equal(r1.animation, r2.animation, 'a camera edit must not move the animation revision');
});

check('baseline: it lives in the project and survives a JSON round trip', () => {
  const p = fixture();
  BASE.createBaseline(p, { name: 'keep me', snapshot: { id: 'snapshot:aaa', hash: 'aaa' }, observations: [observation(0, 'silhouette', 'd1', [0, 0, 0, 0])], timestamp: 't' });
  const reloaded = JSON.parse(JSON.stringify(p));
  const list = BASE.listBaselines(reloaded);
  assert.equal(list.baselines.length, 1);
  assert.equal(list.baselines[0].name, 'keep me');
  assert.equal(BASE.getBaseline(reloaded, 'keep me').observations[0].digest, 'd1');
});

check('baseline: an approval needs a target AND a reason, and then it bites', () => {
  const p = fixture();
  const b = BASE.createBaseline(p, { name: 'b', observations: [], timestamp: 't' });
  assert.throws(() => BASE.approveDifference(p, b.id, { target: 'track:hero|RightHip' }), /needs a reason/);
  assert.throws(() => BASE.approveDifference(p, b.id, { reason: 'because' }), /needs a target/);
  BASE.approveDifference(p, b.id, { target: 'track:hero|RightHip', kind: 'curve', reason: 'the hip retime is the point of the edit', author: 'user' });
  assert.equal(BASE.findApproval(b, { target: 'track:hero|RightHip', kind: 'curve' }).author, 'user');
  assert.equal(BASE.findApproval(b, { target: 'track:hero|RightHip', kind: 'silhouette' }), null, 'a curve approval must not cover a silhouette difference');
  assert.equal(BASE.findApproval(b, { target: 'track:hero|RightElbow', kind: 'curve' }), null);
});

check('baseline: taking one does NOT make the project look edited', () => {
  // The defect this pins, found by the Phase 4 success-condition test: `create_baseline` writes
  // into `project.semantics`, so a diff against the state it just pinned reported `project field
  // "semantics" changed` — every comparison opened by announcing that a baseline had been taken,
  // and explain_change classified it as an unexplained difference. A baseline is a record ABOUT
  // states, so it belongs in NOT_STATE alongside provenance.
  const p = fixture();
  const store = new SNAP.SnapshotStore();
  const snap = store.take(p, { reason: 'baseline' });
  BASE.createBaseline(p, { name: 'b', snapshot: { id: snap.id, hash: snap.hash }, observations: [], timestamp: 't' });
  const d = SNAP.diffProjects(store.get(snap.id).project, p);
  assert.equal(d.identical, true, 'creating a baseline must not register as a change to the animation');
  assert.deepEqual(d.project_fields, []);
  // Content addressing has to agree, or a snapshot taken after the baseline would not dedupe
  // against the one the baseline pins.
  assert.equal(store.take(p, { reason: 'again' }).hash, snap.hash);
  assert.ok(SNAP.NOT_STATE.includes('baselines') && SNAP.NOT_STATE.includes('provenance'));
});

check('baseline: undo does not delete a baseline, and neither does a restore', () => {
  // Same rule from the other side. `state.js` holds the same two keys out of the undo snapshot,
  // and this reads the source to prove the two lists have not drifted apart — a baseline that
  // vanished on Ctrl+Z would take its approved differences with it.
  const src = fs.readFileSync(path.join(ROOT, 'renderer/js/state.js'), 'utf8');
  const m = src.match(/function undoableSemantics\(p\) \{[\s\S]*?const \{([^}]*)\} = p\.semantics;/);
  assert.ok(m, 'undoableSemantics no longer destructures what it holds out of undo');
  const held = m[1].split(',').map((s) => s.trim()).filter((s) => s && s !== '...rest');
  assert.deepEqual(held.sort(), [...SNAP.NOT_STATE].sort(), 'state.js and ai/snapshot.js disagree about what is not state');
});

check('baseline: a missing snapshot is reported as missing, not as nothing-changed', () => {
  const p = fixture();
  const store = new SNAP.SnapshotStore();
  const snap = store.take(p, { reason: 'x' });
  const b = BASE.createBaseline(p, { snapshot: { id: snap.id, hash: snap.hash }, observations: [], timestamp: 't' });
  assert.equal(BASE.snapshotAvailable(b, store).available, true);
  assert.equal(BASE.snapshotAvailable(b, new SNAP.SnapshotStore()).available, false);
  assert.match(BASE.snapshotAvailable(b, new SNAP.SnapshotStore()).reason, /no longer held/);
});

console.log('\n— explain —');

// One applied transaction that claims the shoulder key at frame 8, in the ledger's own shape.
function appliedTxn(entities, { id = 'txn:1:aaa', intent = 'make the swing heavier', status = 'applied' } = {}) {
  return { transaction_id: id, status, interpreted_intent: intent, user_request: 'heavier', changed_entities: entities, changed_properties: [], timestamp: 't' };
}

check('explain: a change a transaction claims is EXPECTED and names the transaction', () => {
  const before = fixture();
  const after = fixture();
  after.tracks.hero.RightShoulder.keys[1].v = CF.fromEuler(0, 0, 1.6);
  const key = IDS.keyId('hero', 'RightShoulder', 8);
  const out = EXP.explainChange({ before, after, transactions: [appliedTxn([key])], timestamp: 't' });

  assert.equal(out.differences.length, 1);
  const d = out.differences[0];
  assert.equal(d.classification, 'expected');
  assert.equal(d.classification_certainty, 'certain');
  assert.equal(d.explained_by_transaction[0].transaction_id, 'txn:1:aaa');
  assert.deepEqual(d.when_did_it_change.frames, [8]);
  assert.equal(d.needs_user_intent, false);
  assert.equal(out.minimum_safe_correction.action, null, 'nothing to correct when everything is explained');
  assert.equal(out.ranked_causes[0].kind, 'recorded_edit');
});

check('explain: a change nothing claims is UNEXPECTED, with ranked causes and a correction', () => {
  const before = fixture();
  const after = fixture();
  after.tracks.hero.RightElbow.keys[1].v = CF.fromEuler(0.9, 0, 0);
  const out = EXP.explainChange({ before, after, transactions: [], timestamp: 't' });

  assert.equal(out.classification_counts.unexpected, 1);
  assert.equal(out.differences[0].needs_user_intent, true);
  assert.ok(out.ranked_causes.length >= 2, 'a difference nobody claims has more than one plausible cause');
  // The directive's rule: with several causes live, none may be reported as certain.
  assert.ok(out.ranked_causes.every((c) => c.certainty !== 'certain'), 'no cause may be certain while others remain plausible');
  for (const c of out.ranked_causes) assert.ok(c.distinguishing_evidence.length, `"${c.kind}" offers nothing that would distinguish it`);
  assert.ok(/untracked_edit/.test(out.ranked_causes.map((c) => c.kind).join(',')));
  assert.ok(out.minimum_safe_correction.action, 'an unexplained difference must come with a correction');
});

check('explain: a previewed or rolled-back transaction may NOT explain a difference', () => {
  // The false-clean-bill case: a transaction that was planned but never applied, or one that was
  // reversed, is not in the state being compared and cannot be its cause.
  const before = fixture();
  const after = fixture();
  after.tracks.hero.RightShoulder.keys[1].v = CF.fromEuler(0, 0, 1.6);
  const key = IDS.keyId('hero', 'RightShoulder', 8);
  for (const status of ['previewed', 'rolled_back', 'failed', 'rejected']) {
    const out = EXP.explainChange({ before, after, transactions: [appliedTxn([key], { status })], timestamp: 't' });
    assert.equal(out.differences[0].classification, 'unexpected', `a "${status}" transaction must not explain a difference`);
  }
  const ok = EXP.explainChange({ before, after, transactions: [appliedTxn([key], { status: 'accepted' })], timestamp: 't' });
  assert.equal(ok.differences[0].classification, 'expected');
});

check('explain: an approved difference stops being a finding', () => {
  const before = fixture();
  const after = fixture();
  after.tracks.hero.RightElbow.keys[1].v = CF.fromEuler(0.9, 0, 0);
  const bl = BASE.createBaseline(after, { name: 'b', observations: [], timestamp: 't' });
  BASE.approveDifference(after, bl.id, { target: IDS.trackId('hero', 'RightElbow'), reason: 'the elbow follow-through is intended', author: 'user' });
  const out = EXP.explainChange({ baseline: bl, before, after, transactions: [], timestamp: 't' });
  assert.equal(out.differences[0].classification, 'approved');
  assert.equal(out.classification_counts.unexpected, 0);
  assert.equal(out.minimum_safe_correction.action, null);
});

check('explain: without a before-state nothing is EXPECTED — it is uncertain, and says why', () => {
  const after = fixture();
  const bl = BASE.createBaseline(after, {
    name: 'b', snapshot: { id: 'snapshot:gone', hash: 'gone' },
    observations: [observation(8, 'silhouette', 'digest-then', [10, 10, 10, 10])], timestamp: 't',
  });
  const now = { frame: 8, pass: 'silhouette', digest: 'digest-now', camera: CAM_A, signature: { kind: 'mean_luminance', blocks: 2, cells: [10, 90, 10, 10], objects: null } };
  const out = EXP.explainChange({ baseline: bl, before: null, after, observations: [now], transactions: [], timestamp: 't' });

  assert.equal(out.classification_counts.uncertain, 1);
  assert.equal(out.classification_counts.expected, 0);
  assert.ok(out.coverage.notRun.some((s) => /data-level difference/.test(s)));
  assert.ok(out.coverage.notRun.some((s) => /full-resolution comparison/.test(s)));
  assert.ok(out.findings.some((f) => f.id === 'explain:degraded-comparison'));
  assert.equal(out.visual_difference.comparisons[0].degraded, true);
  assert.match(out.visual_difference.comparisons[0].granularity, /1\/2/);
});

check('explain: identical digests settle a pass without any pixel work', () => {
  const after = fixture();
  const bl = BASE.createBaseline(after, { name: 'b', observations: [observation(8, 'silhouette', 'same', [1, 1, 1, 1])], timestamp: 't' });
  const out = EXP.explainChange({
    baseline: bl, before: fixture(), after,
    observations: [{ frame: 8, pass: 'silhouette', digest: 'same', camera: CAM_A }],
    transactions: [], timestamp: 't',
  });
  assert.equal(out.visual_difference.comparisons[0].method, 'digest');
  assert.equal(out.visual_difference.comparisons[0].changed, false);
  assert.equal(out.differences.length, 0);
  assert.equal(out.header, 'Nothing changed.');
});

check('explain: an observation the baseline never took is reported, not compared', () => {
  const after = fixture();
  const bl = BASE.createBaseline(after, { name: 'b', observations: [observation(8, 'silhouette', 'd', [1, 1, 1, 1])], timestamp: 't' });
  const out = EXP.explainChange({
    baseline: bl, before: fixture(), after,
    observations: [{ frame: 99, pass: 'silhouette', digest: 'x', camera: CAM_A }],
    transactions: [], timestamp: 't',
  });
  const reasons = out.visual_difference.unmatched_observations.map((u) => u.reason).join(' ');
  assert.match(reasons, /holds no observation of this pass at this frame/);
  assert.match(reasons, /the baseline observed this pass at this frame and the current run did not/);
  assert.ok(out.coverage.notRun.some((s) => /frame 8/.test(s)));
});

check('explain: each moved object is classified on its own, and occlusion is not called a regression', () => {
  // This is the object-ID pass earning its cost, and the trap that comes with it.
  //
  // The shoulder key moved, so the forearm moving is a rig consequence: EXPECTED, but only highly
  // likely, because propagation is structural inference rather than a measurement of this pixel
  // change. The head also changed on screen and nothing in the data reaches it — but an ID pass
  // records the frontmost object per pixel, so an arm swinging across a head changes the head's
  // visible region without the head having moved. That is UNCERTAIN with the checks that would
  // separate it, not a regression. One difference per object is what makes the distinction
  // expressible at all: lumped together, the explained forearm would carry the head past the
  // classifier unexamined.
  const before = fixture();
  const after = fixture();
  after.tracks.hero.RightShoulder.keys[1].v = CF.fromEuler(0, 0, 1.6);
  const forearm = IDS.partId('hero', 'RightLowerArm');
  const head = IDS.partId('hero', 'Head');
  const palette = { 1: forearm, 2: head };
  const then = idRaster(32, 32, palette, (set) => { box(8, 8, 4, 4, 1)(set); box(20, 4, 4, 4, 2)(set); });
  const now = idRaster(32, 32, palette, (set) => { box(14, 8, 4, 4, 1)(set); box(26, 4, 4, 4, 2)(set); });

  const bl = BASE.createBaseline(after, {
    name: 'b', observations: [{ frame: 8, pass: 'object_id', digest: RAS.rasterDigest(then), signature: RAS.signature(then), camera: CAM_A }],
    timestamp: 't',
  });
  const out = EXP.explainChange({
    baseline: bl, before, after,
    observations: [{ frame: 8, pass: 'object_id', digest: RAS.rasterDigest(now), raster: now, camera: CAM_A }],
    baselineRasters: (f, p) => (f === 8 && p === 'object_id' ? then : null),
    transactions: [appliedTxn([IDS.keyId('hero', 'RightShoulder', 8)])],
    expectedMovers: [{ entityId: forearm, name: 'RightLowerArm', reason: 'it hangs below RightUpperArm, which "RightShoulder" moves' }],
    timestamp: 't',
  });

  const visual = out.differences.filter((d) => d.kind === 'object_id_shift');
  assert.equal(visual.length, 2, 'each moved object must be its own difference — Part 44 asks "which objects" of EACH difference');

  const arm = visual.find((d) => d.where_did_it_change.entity === forearm);
  assert.equal(arm.classification, 'expected');
  assert.equal(arm.classification_certainty, 'highly_likely', 'propagation is inference and must never be reported as certain');
  assert.match(arm.classification_reason, /moves as a consequence/);
  assert.match(arm.what_changed, /moved 6px on screen/);

  const noggin = visual.find((d) => d.where_did_it_change.entity === head);
  assert.equal(noggin.classification, 'uncertain', 'an occlusion change must not be reported as a regression');
  assert.match(noggin.classification_reason, /partly hidden by one that moved/);
  assert.equal(noggin.classification_certainty, 'possible');
  assert.equal(out.classification_counts.unexpected, 0);

  const occl = out.ranked_causes.find((c) => c.kind === 'occlusion');
  assert.ok(occl, 'occlusion must be offered as a ranked cause');
  assert.ok(occl.distinguishing_evidence.some((s) => /depth pass/.test(s)), 'and must name the pass that would settle it');
  assert.ok(EXP.explainLimitations().cannot.some((s) => /front of it/.test(s)));
});

check('explain: a silhouette alone cannot say WHAT moved, so it is uncertain rather than a defect', () => {
  // A silhouette is one outline for the whole rig. It can prove something moved and it can measure
  // how far, but it names no object — attributing it needs the object-ID pass at the same frame.
  // Reporting it as "unexpected" would turn "I cannot tell" into "something is wrong", which is
  // the difference between a regression engine people read and one they learn to ignore.
  const p = fixture();
  const then = gray(32, 32, box(4, 4, 8, 8));
  const now = gray(32, 32, box(6, 4, 8, 8));
  const bl = BASE.createBaseline(p, { name: 'b', observations: [{ frame: 0, pass: 'silhouette', digest: RAS.rasterDigest(then), signature: RAS.signature(then), camera: CAM_A }], timestamp: 't' });
  const out = EXP.explainChange({
    baseline: bl, before: fixture(), after: p,
    observations: [{ frame: 0, pass: 'silhouette', digest: RAS.rasterDigest(now), raster: now, camera: CAM_A }],
    baselineRasters: () => then,
    transactions: [], expectedMovers: [], timestamp: 't',
  });
  assert.equal(out.classification_counts.uncertain, 1);
  assert.equal(out.classification_counts.unexpected, 0);
  assert.match(out.differences[0].what_changed, /displaced by up to/, 'it must still MEASURE what it cannot attribute');
  assert.match(out.differences[0].which_objects_or_passes.attribution, /no object-ID pass was rendered/);
  assert.equal(out.minimum_safe_correction.action, null, 'nothing may be corrected on the strength of an unanswered question');
  assert.ok(out.minimum_safe_correction.next_checks.length, 'it must say what would answer it instead');
  // The causes are still ranked — abstaining from a classification is not abstaining from analysis.
  const kinds = out.ranked_causes.map((c) => c.kind);
  assert.ok(kinds.includes('observation_artefact'), 'a visual-only difference must offer the "the render changed, not the animation" cause');
  assert.ok(kinds.includes('untracked_edit'));
  assert.ok(kinds.includes('lost_record'));
});

check('explain: with an object-ID pass at the same frame, the silhouette borrows its attribution', () => {
  const before = fixture();
  const after = fixture();
  after.tracks.hero.RightShoulder.keys[1].v = CF.fromEuler(0, 0, 1.6);
  const forearm = IDS.partId('hero', 'RightLowerArm');
  const palette = { 1: forearm };
  const idThen = idRaster(32, 32, palette, box(8, 8, 4, 4, 1));
  const idNow = idRaster(32, 32, palette, box(14, 8, 4, 4, 1));
  const silThen = gray(32, 32, box(8, 8, 4, 4));
  const silNow = gray(32, 32, box(14, 8, 4, 4));
  const bl = BASE.createBaseline(after, {
    name: 'b', timestamp: 't',
    observations: [
      { frame: 8, pass: 'object_id', digest: RAS.rasterDigest(idThen), signature: RAS.signature(idThen), camera: CAM_A },
      { frame: 8, pass: 'silhouette', digest: RAS.rasterDigest(silThen), signature: RAS.signature(silThen), camera: CAM_A },
    ],
  });
  const out = EXP.explainChange({
    baseline: bl, before, after,
    observations: [
      { frame: 8, pass: 'object_id', digest: RAS.rasterDigest(idNow), raster: idNow, camera: CAM_A },
      { frame: 8, pass: 'silhouette', digest: RAS.rasterDigest(silNow), raster: silNow, camera: CAM_A },
    ],
    baselineRasters: (f, pass) => (pass === 'object_id' ? idThen : silThen),
    transactions: [appliedTxn([IDS.keyId('hero', 'RightShoulder', 8)])],
    expectedMovers: [{ entityId: forearm, name: 'RightLowerArm', reason: 'it hangs below RightUpperArm, which "RightShoulder" moves' }],
    timestamp: 't',
  });
  const sil = out.differences.find((d) => d.kind === 'silhouette');
  assert.equal(sil.classification, 'expected');
  assert.match(sil.which_objects_or_passes.attribution, /borrowed from the object-ID pass/);
  assert.deepEqual(sil.which_objects_or_passes.objects, [forearm]);
  assert.equal(out.classification_counts.unexpected, 0);
  assert.equal(out.classification_counts.uncertain, 0);
});

check('explain: every result names what it did not look at', () => {
  const out = EXP.explainChange({ before: fixture(), after: fixture(), timestamp: 't' });
  assert.ok(out.coverage.notRun.length >= 15, 'the 20 unrendered Part 43 passes must all be named');
  assert.ok(out.coverage.notRun.some((s) => /motion-vector/.test(s)));
  assert.ok(out.coverage.notRun.some((s) => /no render pass was observed at all/.test(s)));
  const lim = EXP.explainLimitations();
  assert.ok(lim.cannot.length >= 4 && lim.assumptions.length >= 2);
});

console.log('\n— motion (Part 23) —');

check('motion: every Part 23 quantity is present, and the ones that are not measured say what blocks them', () => {
  const names = Object.keys(MOT.MEASUREMENTS);
  assert.ok(names.length >= 17, 'Part 23 lists eighteen quantities and every one keeps a row');
  for (const [k, m] of Object.entries(MOT.MEASUREMENTS)) {
    if (m.implemented) assert.ok(m.unit && m.from, `${k} claims to be measured and must say in what unit, from what`);
    else {
      assert.ok(m.unblocked_by, `${k} is not measured and must say what would change that`);
      assert.ok(!/Phase [0-5]\b/.test(m.unblocked_by), `${k} defers to a shipped phase: ${m.unblocked_by}`);
    }
  }
  const lim = MOT.motionLimitations();
  assert.equal(lim.measured.length + lim.not_measured.length, names.length,
    'the limitations prose is generated from the registry, so the two cannot disagree');
  assert.ok(/decide that a motion is bad/.test(lim.cannot[0]), 'Part 4.5: measurement is not judgement');
});

check('motion: velocity, acceleration and jerk come from the FK solve, and the ends are flagged', () => {
  const p = plantFixture();
  const s = MOT.sampleMotion(p, { itemId: 'hero', partIds: ['RightHand'], frameRange: [0, 16] });
  const sub = s.subjects[0];
  assert.equal(sub.samples.length, 17, 'one sample per frame at step 1, inclusive of both ends');
  assert.equal(sub.role, 'hand');
  assert.equal(sub.contact_capable, true);
  assert.ok(sub.summary.path_length_studs > 1, 'the arm swings, so the hand travels');
  assert.ok(sub.summary.peak_speed > 0 && sub.summary.peak_speed_frame !== null);
  // A one-sided derivative at the boundary is systematically different from its neighbours, so it
  // is marked rather than left to be read as a pop.
  assert.equal(sub.samples[0].boundary, true);
  assert.equal(sub.samples[16].boundary, true);
  assert.equal(sub.samples[0].acceleration, null, 'a second difference needs a sample either side');
  assert.equal(sub.samples[1].jerk, null, 'a third difference needs two either side');
  assert.ok(sub.samples[5].jerk !== null);
  // A part nothing moves reads as still, and `still` is a claim the summary makes explicitly.
  const foot = MOT.sampleMotion(p, { itemId: 'hero', partIds: ['LeftFoot'], frameRange: [0, 16] }).subjects[0];
  assert.equal(foot.summary.still, true);
  assert.equal(foot.summary.path_length_studs, 0);
});

check('motion: a straight path has no curvature and no bow; a swing has both', () => {
  const p = plantFixture();
  const hand = MOT.sampleMotion(p, { itemId: 'hero', partIds: ['RightHand'], frameRange: [0, 16] }).subjects[0];
  assert.ok(hand.summary.bow_studs > 0.05, 'a shoulder rotation sweeps an arc, which bows off its chord');
  assert.ok(hand.samples.slice(1, -1).some((s) => s.curvature > 0));
  // Bow is NOT "distance from the expected arc", and the registry says so rather than letting the
  // number be read as a verdict.
  assert.equal(MOT.MEASUREMENTS.distance_to_expected_arc.implemented, false);
  assert.ok(/bow_studs/.test(MOT.MEASUREMENTS.distance_to_expected_arc.unblocked_by));
});

check('motion: the sample grid is capped, and a truncated range is named rather than silently dropped', () => {
  const p = plantFixture();
  const s = MOT.sampleGrid(p, 'hero', { frameRange: [0, 5000], step: 1 });
  assert.equal(s.frames.length, MOT.MAX_SAMPLES);
  assert.ok(/were NOT sampled/.test(s.truncated));
  const sampled = MOT.sampleMotion(p, { itemId: 'hero', partIds: ['RightHand'], frameRange: [0, 5000] });
  assert.ok(sampled.coverage.notRun.some((x) => /were NOT sampled/.test(x)));
});

check('motion: contact drift measures against the effector\'s own start position, and says so', () => {
  const p = plantFixture();
  const clean = MOT.measureContactDrift(p, { itemId: 'hero', effector: 'the left foot', start: 0, end: 16, tolerance_studs: 0.05 });
  assert.equal(clean.measured, true);
  assert.equal(clean.effector.part_id, 'LeftFoot');
  assert.equal(clean.within_tolerance, true);
  assert.equal(clean.max_drift_studs, 0);
  assert.equal(clean.reference.kind, 'effector_at_first_frame');
  assert.ok(clean.findings[0].evidence.some((e) => e.kind === 'assumption' && /ground plane/.test(e.detail)),
    'the assumption the whole measurement rests on has to be in the evidence, not only in a doc comment');

  const moved = JSON.parse(JSON.stringify(p));
  moved.tracks.hero.LeftHip.keys.push({ t: 16, v: CF.fromEuler(0.5, 0, 0) });
  const bad = MOT.measureContactDrift(moved, { itemId: 'hero', effector: 'the left foot', start: 0, end: 16, tolerance_studs: 0.05 });
  assert.equal(bad.within_tolerance, false);
  assert.ok(bad.max_drift_studs > 0.5);
  assert.equal(bad.max_drift_frame, 16);
  assert.equal(bad.first_breach_frame, 1, 'the breach frame is where it crossed, not where it was worst');
  assert.ok(bad.exceeded_by_studs > 0.5);
});

check('motion: an unmeasurable contact is refused with a question, never answered with zero', () => {
  const p = plantFixture();
  const noRange = MOT.measureContactDrift(p, { itemId: 'hero', effector: 'the left foot' });
  assert.equal(noRange.measured, false);
  assert.equal(noRange.max_drift_studs, null, 'an unmeasured drift is null — zero would read as a clean contact');
  assert.ok(/frame range/.test(noRange.reason));
  const noPart = MOT.measureContactDrift(p, { itemId: 'hero', effector: 'the third elbow', start: 0, end: 8 });
  assert.equal(noPart.measured, false);
  assert.ok(noPart.coverage.notRun.length === 1 && /NOT measured/.test(noPart.coverage.notRun[0]));
  const noItem = MOT.measureContactDrift(p, { itemId: 'nobody', effector: 'the left foot', start: 0, end: 8 });
  assert.equal(noItem.measured, false);
});

check('motion: a contact resolved from a semantic phrase cannot produce a certain verdict', () => {
  // "the left foot" is an exact role lookup and IS certain. "the planted foot" is a travel
  // measurement standing in for an intent, and Part 13's own worked example caps it at highly
  // likely — a drift finding may not launder that into certainty.
  const p = plantFixture();
  p.tracks.hero.RightHip = { keys: [{ t: 0, v: I() }, { t: 16, v: CF.fromEuler(0.6, 0, 0) }] };
  const exact = MOT.measureContactDrift(p, { itemId: 'hero', effector: 'the left foot', start: 0, end: 16, tolerance_studs: 0.05 });
  assert.equal(exact.effector.certainty, C.CERTAINTY.CERTAIN);
  assert.equal(exact.findings[0].certainty, C.CERTAINTY.CERTAIN);
  const heuristic = MOT.measureContactDrift(p, { itemId: 'hero', effector: 'the planted foot', start: 0, end: 16, tolerance_studs: 0.05 });
  assert.equal(heuristic.effector.part_id, 'LeftFoot');
  assert.notEqual(heuristic.findings[0].certainty, C.CERTAINTY.CERTAIN);
  assert.ok(/semantic phrase/.test(heuristic.effector.how_identified));
});

check('motion: chain lead/lag reports an inversion without calling it wrong', () => {
  const p = plantFixture();
  // The forearm starts a third of the way in; the shoulder starts at once. That is the normal
  // order, so nothing is inverted.
  const ok = MOT.analyseChain(p, { itemId: 'hero', chain: ['RightShoulder', 'RightElbow'] });
  assert.equal(ok.links.length, 2);
  assert.equal(ok.inversions.length, 0);
  assert.equal(ok.chain_source, 'caller');

  // Now make the elbow fire first.
  const led = JSON.parse(JSON.stringify(p));
  led.tracks.hero.RightShoulder.keys = [{ t: 0, v: I() }, { t: 8, v: I() }, { t: 16, v: CF.fromEuler(0, 0, 1.2) }, { t: 28, v: I() }];
  led.tracks.hero.RightElbow.keys = [{ t: 0, v: I() }, { t: 4, v: CF.fromEuler(1.0, 0, 0) }, { t: 16, v: CF.fromEuler(1.0, 0, 0) }, { t: 28, v: I() }];
  const inv = MOT.analyseChain(led, { itemId: 'hero', chain: ['RightShoulder', 'RightElbow'] });
  assert.equal(inv.inversions.length, 1);
  assert.equal(inv.inversions[0].child, 'RightElbow');
  assert.ok(inv.inversions[0].lead_frames > 0);
  // Part 22 names four kinds of motion where a child legitimately leads. So the finding is
  // `possible`, and the assumption it rests on is in its own evidence.
  assert.equal(inv.findings[0].certainty, C.CERTAINTY.POSSIBLE);
  assert.ok(inv.findings[0].evidence.some((e) => e.kind === 'assumption' && /whip crack/.test(e.detail)));
  assert.ok(inv.coverage.notRun.some((s) => /four kinds of motion where it is correct/.test(s)));
});

check('motion: the derived chain does not join a left leg to a right arm', () => {
  // Two limbs on opposite sides have no propagation relationship, and a lag between them is not a
  // finding — it is two unrelated actions read as one.
  const p = plantFixture();
  p.tracks.hero.LeftHip = { keys: [{ t: 0, v: I() }, { t: 16, v: CF.fromEuler(0.4, 0, 0) }] };
  const c = MOT.analyseChain(p, { itemId: 'hero' });
  const sides = new Set(c.links.map((l) => l.side).filter((s) => s === 'left' || s === 'right'));
  assert.ok(sides.size <= 1, `the derived chain mixed sides: ${[...sides].join(', ')}`);
  assert.ok(/side with the most animated joints/.test(c.chain_source));
});

check('motion: Part 23\'s noise policy separates the three authored kinds and refuses to guess the rest', () => {
  const p = plantFixture();
  p.tracks.hero.RightShoulder.keys[1].es = 'Constant';
  assert.equal(MOT.classifyVariation(p, 'hero', 'RightShoulder', 8).kind, 'stepped');

  const held = plantFixture();
  assert.equal(MOT.classifyVariation(held, 'hero', 'LeftAnkle', 8).kind, 'stylised_hold',
    'four identical keys in a row are a hold, and a hold is deliberate');

  // The marker at 16 names the impact, so a discontinuity there was authored.
  assert.equal(MOT.classifyVariation(held, 'hero', 'RightShoulder', 16).kind, 'impact_discontinuity');

  // And a frame with no mark at all: reported as unclassified, explicitly NOT as a defect.
  const un = MOT.classifyVariation(held, 'hero', 'RightShoulder', 11);
  assert.equal(un.kind, 'unclassified');
  assert.ok(/NOT called a defect/.test(un.why));
  const undistinguishable = Object.values(MOT.VARIATION_KINDS).filter((v) => !v.distinguishable);
  assert.equal(undistinguishable.length, 6, 'six of Part 23\'s nine kinds have no mark in Cadence data');
  for (const v of undistinguishable) assert.ok(v.needs, 'and each one says what it would take');
});

console.log('\n— diagnose (Part 46) —');

check('diagnose: all seven of Part 46\'s workflows keep a row, and the unbuilt ones name their obstacle', () => {
  const impl = Object.entries(DIAG.DIAGNOSTICS).filter(([, d]) => d.implemented);
  assert.equal(Object.keys(DIAG.DIAGNOSTICS).length, 7);
  assert.equal(impl.length, 2);
  for (const [name, d] of Object.entries(DIAG.DIAGNOSTICS)) {
    if (d.implemented) continue;
    assert.ok(d.routed_to || d.unblocked_by, `${name} must be routed or blocked, not silent`);
    if (d.unblocked_by) assert.ok(!/Phase [0-5]\b/.test(d.unblocked_by), `${name} defers to a shipped phase: ${d.unblocked_by}`);
  }
  const lim = DIAG.diagnoseLimitations();
  assert.equal(lim.implemented.length + lim.routed.length + lim.blocked.length, 7);
  assert.throws(() => DIAG.diagnose(plantFixture(), { question: 'why_is_it_ugly' }), /no diagnostic named/);
});

check('diagnose: an unimplemented question refuses by name and never fabricates an answer', () => {
  const p = plantFixture();
  const r = DIAG.diagnose(p, { question: 'why_does_this_animation_feel_light', itemId: 'hero' });
  assert.equal(r.likely_causes.length, 0);
  assert.equal(r.confidence, C.CERTAINTY.USER_INTENT_REQUIRED);
  assert.ok(r.coverage.notRun.some((s) => /PHY-001/.test(s)));
  const routed = DIAG.diagnose(p, { question: 'why_did_this_object_move', itemId: 'hero' });
  assert.deepEqual(routed.next_checks, ['call `explain_change`']);
});

check('diagnose: a stable contact is reported as stable, not as a problem nobody found', () => {
  const p = plantFixture();
  const r = DIAG.diagnose(p, { question: 'why_is_this_contact_unstable', itemId: 'hero', effector: 'the left foot', start: 0, end: 16, tolerance_studs: 0.05 });
  assert.ok(/the contact is stable/.test(r.header));
  assert.equal(r.likely_causes.length, 0);
  assert.ok(r.next_checks.some((s) => /explain_change/.test(s)), 'and it points at the check it did NOT run');
});

check('diagnose: a contact with no tolerance is answered with a question, not a verdict', () => {
  const p = plantFixture();
  p.tracks.hero.LeftHip.keys.push({ t: 16, v: CF.fromEuler(0.5, 0, 0) });
  const r = DIAG.diagnose(p, { question: 'why_is_this_contact_unstable', itemId: 'hero', effector: 'the left foot', start: 0, end: 16 });
  assert.equal(r.confidence, C.CERTAINTY.USER_INTENT_REQUIRED);
  assert.ok(/How far may/.test(r.user_question));
  assert.equal(r.recommended_action, null);
});

check('diagnose: drift is attributed by counterfactual, so the cause is proved rather than guessed', () => {
  const p = plantFixture();
  p.tracks.hero.LeftHip.keys.push({ t: 16, v: CF.fromEuler(0.5, 0, 0) });
  p.tracks.hero.LeftKnee = { keys: [{ t: 0, v: I() }, { t: 16, v: CF.fromEuler(0.1, 0, 0) }] };
  const r = DIAG.diagnose(p, { question: 'why_is_this_contact_unstable', itemId: 'hero', effector: 'the left foot', start: 0, end: 16, tolerance_studs: 0.05 });

  assert.ok(r.likely_causes.length >= 2);
  assert.equal(r.likely_causes[0].cause, '"LeftHip"', 'the hip swings the whole leg and must rank first');
  assert.ok(r.likely_causes[0].share_of_drift > 0.7);
  assert.ok(r.likely_causes[1].share_of_drift < r.likely_causes[0].share_of_drift, 'causes are ranked by share, not by order');
  // The distinguishing evidence is the counterfactual itself — freezing the joint and re-measuring.
  assert.ok(/freezing "LeftHip" at its frame-0 value leaves/.test(r.likely_causes[0].distinguishing_evidence));
  assert.equal(r.measurements.attribution.method.startsWith('counterfactual'), true);
  // Part 46's eight required fields, all populated for an answered question.
  for (const f of ['observed_facts', 'referenced_plan', 'dependencies', 'likely_causes', 'next_checks']) {
    assert.ok(Array.isArray(r[f]) && r[f].length, `Part 46 requires ${f}`);
  }
  assert.ok(r.recommended_action.requires_user_approval, 'a recommendation is not an instruction to act');
  assert.ok(r.coverage.notRun.some((s) => /nothing visual was checked/.test(s)));
});

check('diagnose: root motion is a candidate cause, and beats the joints when it is the real one', () => {
  // Part 30 lists "handle changes in root motion" as its own case: a foot that slides because the
  // whole character was translated is a completely different fix from a bent knee.
  const p = plantFixture();
  p.tracks.hero['@origin'] = { keys: [{ t: 0, v: I() }, { t: 16, v: CF.fromPos ? CF.fromPos(3, 0, 0) : [3, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] }] };
  const r = DIAG.diagnose(p, { question: 'why_is_this_contact_unstable', itemId: 'hero', effector: 'the left foot', start: 0, end: 16, tolerance_studs: 0.05 });
  assert.ok(/root motion/.test(r.likely_causes[0].cause));
  assert.ok(r.likely_causes[0].share_of_drift > 0.9);
  assert.equal(r.likely_causes[0].kind, 'root_motion');
});

check('diagnose: an authored discontinuity is NOT called a defect', () => {
  // Part 23, verbatim: "Never label motion as bad simply because it deviates from smoothness."
  const p = plantFixture();
  p.tracks.hero.RightShoulder.keys[1].es = 'Constant';
  const r = DIAG.diagnose(p, { question: 'why_is_this_motion_bad', itemId: 'hero', joint: 'RightShoulder', frame: 8 });
  assert.ok(/deliberate stepped/.test(r.header));
  assert.equal(r.findings[0].id, 'MOTION-AUTHORED-VARIATION');
  assert.equal(r.likely_causes[0].kind, 'authored');
  assert.equal(r.user_question, null, 'nothing needs asking: the project already says what this is');
  assert.ok(r.coverage.notRun.some((s) => /6 of Part 23's 9 variation kinds/.test(s)));
});

check('diagnose: an unexplained discontinuity is reported as possible, with the question attached', () => {
  const p = plantFixture();
  // A hard reversal in the middle of a span, with no key, no marker and no stepped easing to
  // explain it — the shoulder snaps back between two ordinary keys.
  p.tracks.hero.RightShoulder.keys = [
    { t: 0, v: I(), es: 'Linear' }, { t: 10, v: CF.fromEuler(0, 0, 1.4), es: 'Linear' },
    { t: 11, v: CF.fromEuler(0, 0, -1.4), es: 'Linear' }, { t: 28, v: I(), es: 'Linear' },
  ];
  p.markers = {};
  const r = DIAG.diagnose(p, { question: 'why_is_this_motion_bad', itemId: 'hero', joint: 'RightShoulder', frame: 11 });
  assert.equal(r.confidence, C.CERTAINTY.POSSIBLE, 'the measurement is certain; what it MEANS is not');
  assert.equal(r.findings[0].id, 'MOTION-DISCONTINUITY');
  assert.ok(/Was the discontinuity at frame 11 intended\?/.test(r.user_question));
  assert.ok(r.likely_causes.some((c) => /indistinguishable in the data/.test(c.distinguishing_evidence)));

  // The other half, and the one that decides whether this detector is worth reading: an ordinary
  // Sine-eased swing reports NOTHING at every frame. A detector that fires on normal motion is a
  // detector nobody looks at twice.
  const ordinary = plantFixture();
  for (const f of [4, 11, 20]) {
    const q = DIAG.diagnose(ordinary, { question: 'why_is_this_motion_bad', itemId: 'hero', joint: 'RightShoulder', frame: f });
    assert.equal(q.findings.length, 0, `frame ${f} of an ordinary eased swing must not be reported`);
    assert.ok(/nothing unusual/.test(q.header));
  }
});

console.log('\n— layer —');

check('layer: capabilities() states both what it can and cannot do', () => {
  const c = AI.capabilities();
  assert.ok(c.can.length >= 5 && c.cannot.length >= 5);
  assert.ok(c.can.some((s) => /velocity/.test(s)), 'Part 23 landed and capabilities() must say so');
  assert.ok(c.cannot.some((s) => /flicker/.test(s)));
  assert.ok(c.cannot.some((s) => /contact nobody declared/.test(s)));
  assert.ok(c.can.some((s) => /baseline/.test(s)), 'Phase 4 exists and capabilities() must say so');
});

check('layer: the Phase 5 success condition — a contact error is identified with evidence, and undone', () => {
  // Part 62, Phase 5, verbatim: "Cadence can identify a known contact error or motion-propagation
  // problem with evidence." End to end through the REAL machinery: declare the contact, break it
  // with a transactional patch, have the constraint checker catch it, have the diagnostic attribute
  // it, roll the transaction back, and re-measure to zero.
  const p = plantFixture();
  const origin = H.contentHash(p);
  const ledger = new TXN.TransactionLedger();

  // DECLARE — Part 54's own worked example, in the closed grammar.
  const comp = CON.compileConstraints({ text: 'keep the left foot within 0.05 studs from frame 0 to 16' }, p);
  assert.equal(comp.unparsed.length, 0);
  assert.equal(comp.constraints[0].condition.check, 'contact_drift');

  // MEASURE, before anything is changed: the contact is clean, and that is an answer.
  const clean = MOT.measureContactDrift(p, { itemId: 'hero', effector: 'the left foot', start: 0, end: 16, tolerance_studs: 0.05 });
  assert.equal(clean.within_tolerance, true);

  // BREAK IT — a hip rotation, applied through the transaction machinery like any other edit.
  const beforeState = JSON.parse(JSON.stringify(p));
  const patch = PATCH.makePatch({ intent: 'swing the left leg through', ops: [{ op: 'set_key', itemId: 'hero', track: 'LeftHip', t: 16, value: CF.fromEuler(0.5, 0, 0) }] });
  const plan = PATCH.planPatch(p, patch);
  const report = CON.checkPatch(p, patch, comp.constraints, { result: plan.result });

  // The constraint catches it, with the number and the frame it first crossed.
  assert.equal(report.violations.length, 1);
  assert.ok(/would drift/.test(report.violations[0].reason));
  assert.equal(report.violations[0].finding.frame, 1);

  const applied = TXN.apply(p, patch, plan, { ledger, constraintReport: report, timestamp: 'T1' });
  assert.equal(applied.applied, true, 'the contact constraint compiles to `warn`, so it reports rather than refusing');

  // IDENTIFY, with evidence: which joint owns the drift, proved by freezing it and re-measuring.
  const why = DIAG.diagnose(p, { question: 'why_is_this_contact_unstable', itemId: 'hero', effector: 'the left foot', start: 0, end: 16, tolerance_studs: 0.05 });
  assert.equal(why.likely_causes[0].cause, '"LeftHip"');
  assert.equal(why.findings[0].id, 'CONTACT-UNSTABLE');
  assert.equal(why.findings[0].certainty, C.CERTAINTY.CERTAIN);
  assert.ok(why.findings[0].evidence.some((e) => e.kind === 'measurement' && /drift/.test(e.statement)));

  // The acceptance check agrees, and says the drift is this change's fault rather than pre-existing.
  const spec = CAL.acceptanceSpec({ checks: [{ check: 'contact_drift_within', itemId: 'hero', effector: 'the left foot', start: 0, end: 16, tolerance: 0.05 }] });
  const acc = CAL.evaluateAcceptance(beforeState, p, spec, { itemId: 'hero' });
  assert.equal(acc.results[0].status, 'fail');
  assert.equal(acc.results[0].measured.pre_existing, false, 'the contact was clean before, so this change owns the break');

  // UNDO — and the measurement comes back to exactly where it started.
  const back = TXN.rollback(p, ledger, applied.transaction_id, { timestamp: 'T2' });
  assert.equal(back.rolled_back, true);
  assert.equal(back.complete, true);
  assert.equal(H.contentHash(p), origin, 'the rollback must land byte-identical, not merely close');
  const after = MOT.measureContactDrift(p, { itemId: 'hero', effector: 'the left foot', start: 0, end: 16, tolerance_studs: 0.05 });
  assert.equal(after.within_tolerance, true);
  assert.equal(after.max_drift_studs, 0);
});

check('layer: the Phase 4 success condition — a scoped edit is explained, and the explanation undoes it', () => {
  // Part 62 Phase 4: "Cadence can explain what changed after a scoped edit." End to end, without a
  // renderer: baseline → scoped edit through the real transaction machinery → explain → the
  // correction the explanation names, applied → back to the baseline exactly.
  const p = fixture();
  const store = new SNAP.SnapshotStore();
  const ledger = new TXN.TransactionLedger();
  const snap = store.take(p, { reason: 'baseline', pinned: true, timestamp: 't0' });
  const bl = BASE.createBaseline(p, { name: 'before the swing', snapshot: { id: snap.id, hash: snap.hash }, observations: [], author: 'ai', timestamp: 't0' });
  const startHash = H.contentHash(p);

  const patch = PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'RightShoulder', t: 8, value: CF.fromEuler(0, 0, 1.9) }], intent: 'bigger wind-up' });
  const plan = PATCH.planPatch(p, patch);
  const txn = ledger.open({ intent: 'bigger wind-up', request: 'wind up further', tool: 'test', plan, beforeSnapshot: snap.id, timestamp: 't1' });
  const applied = TXN.apply(p, patch, plan, { ledger, txn, timestamp: 't1' });
  assert.equal(applied.applied, true);

  const before = store.get(bl.scene_snapshot.id).project;
  const changedTracks = SNAP.diffProjects(before, p).tracks.map((t) => IDS.trackId(t.itemId, t.track));
  const movers = SCOPE.propagateTracks(p, changedTracks);
  const out = EXP.explainChange({
    baseline: bl, before, after: p,
    transactions: ledger.list().transactions,
    expectedMovers: movers.parts.map((m) => ({ entityId: m.entityId, name: m.name, reason: m.reason })),
    timestamp: 't2',
  });

  // It explains it, and attributes it to the transaction that did it.
  assert.equal(out.classification_counts.expected, 1);
  assert.equal(out.classification_counts.unexpected, 0);
  assert.match(out.header, /1 difference\(s\) — 1 expected/);
  assert.equal(out.differences[0].explained_by_transaction[0].transaction_id, txn.transaction_id);
  assert.match(out.differences[0].what_changed, /"RightShoulder": 1 key\(s\) modified at 8/);

  // The propagation walk really did reach the arm below the shoulder — that is what makes a
  // visual difference on the forearm explainable rather than a mystery.
  assert.ok(movers.parts.some((m) => m.partId === 'RightLowerArm'), 'the propagation list must reach below the edited joint');

  // And the loop closes: roll the transaction back and the project is byte-identical, with the
  // explanation now reporting no difference at all.
  TXN.rollback(p, ledger, txn.transaction_id, { timestamp: 't3' });
  assert.equal(H.contentHash(p), startHash, 'the project must land exactly where the baseline pinned it');
  const after = EXP.explainChange({ baseline: bl, before, after: p, transactions: ledger.list().transactions, timestamp: 't4' });
  assert.equal(after.differences.length, 0);
  assert.equal(after.header, 'Nothing changed.');
});
check('layer: the whole Phase 1 loop runs end to end on one project', () => {
  const p = fixture();
  const scene = AI.sceneGraph(p, { frame: 16 });
  const hero = p.items[0];
  const rig = AI.rigGraph(p, hero);
  const timeline = AI.timelineGraph(p, hero, { includeKeys: true });
  const sel = AI.resolveSemantic(p, 'the planted foot', { frame: 10 });
  const store = new AI.SnapshotStore();
  const before = store.take(p, { reason: 'before the edit' });
  p.tracks.hero.RightElbow.keys[1].v = CF.fromEuler(0.9, 0, 0);
  const after = store.take(p, { reason: 'after the edit' });
  const d = AI.diffProjects(store.get(before.id).project, store.get(after.id).project);

  assert.ok(scene.objects.length === 3);
  assert.ok(rig.validation.findings.length === 0);
  assert.ok(timeline.counts.keys > 0);
  assert.ok(sel.matches.length === 1);
  assert.notEqual(before.hash, after.hash);
  assert.deepEqual(d.changed_frame_range, { start: 16, end: 16 });
  assert.ok(d.tracks[0].keys_modified[0].fields.includes('v'));
});

// ---------------------------------------------------------------- Phase 6: events + VFXSpec

check('patch: add_item and remove_item are exact inverses', () => {
  const p = fixture();
  const origin = H.contentHash(p);
  const item = { id: 'vfx-x', kind: 'vfx', name: 'Sparks', origin: I(), emitter: { rate: 12 }, visible: true };

  const patch = PATCH.makePatch({ ops: [{ op: 'add_item', item }], intent: 'add an emitter' });
  const plan = PATCH.planPatch(p, patch);
  assert.equal(plan.applicable, true);
  assert.equal(plan.ops[0].effect, 'created');
  assert.deepEqual(plan.inverse.ops.map((o) => o.op), ['remove_item']);

  const done = PATCH.commitPatch(p, patch, plan);
  assert.equal(p.items.length, 4);
  assert.deepEqual(p.tracks['vfx-x'], {}, 'an added item gets an empty track table, as state.addItem does');

  // And back, byte-identical — not merely close.
  const back = PATCH.planPatch(p, done.inverse);
  PATCH.commitPatch(p, done.inverse, back);
  assert.equal(H.contentHash(p), origin);
  assert.equal(p.tracks['vfx-x'], undefined);
});

check('patch: remove_item carries an item\'s tracks and markers into its own inverse', () => {
  const p = fixture();
  const origin = H.contentHash(p);
  // `hero` owns tracks AND a marker table, so a bare item-only inverse would silently lose both.
  const patch = PATCH.makePatch({ ops: [{ op: 'remove_item', itemId: 'cam' }] });
  const plan = PATCH.planPatch(p, patch);
  assert.equal(plan.applicable, true);
  const inv = plan.inverse.ops[0];
  assert.equal(inv.op, 'add_item');
  assert.ok(inv.tracks['@fov'], 'the inverse must carry the track table back');

  const done = PATCH.commitPatch(p, patch, plan);
  assert.equal(p.tracks.cam, undefined);
  PATCH.commitPatch(p, done.inverse, PATCH.planPatch(p, done.inverse));
  assert.equal(H.contentHash(p), origin, 'tracks and markers must come back with the item');
});

check('patch: add_item refuses a duplicate id, a rig and a PNX effect', () => {
  const p = fixture();
  const bad = (item) => {
    const plan = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'add_item', item }] }));
    assert.equal(plan.applicable, false);
    return plan.problems[0].statement;
  };
  assert.match(bad({ id: 'hero', kind: 'vfx' }), /already exists/);
  assert.match(bad({ id: 'r2', kind: 'rig' }), /rig topology is not animation data/);
  assert.match(bad({ id: 'e2', kind: 'effect' }), /own undo and its own validators/);
  assert.match(bad({ id: 'p2', kind: 'prop' }), /attach_item exists for that reason/);
  assert.match(bad({ id: 'q2', kind: 'sasquatch' }), /unknown item kind/);
  // An id is required, because commitPatch verifies the applied result against the planned hash.
  // (A handler throw becomes a refusal, not a propagated exception — runOps wraps the dispatch.)
  assert.match(bad({ kind: 'vfx' }), /needs a string id/);
  assert.match(bad({ id: 'k2' }), /needs a kind/);
});

check('patch: remove_item refuses to strand a key group, a semantic record or an attachment', () => {
  const p = fixture();
  // `sword` is attached to `hero`, so removing the host would leave it in no transform space.
  let plan = PATCH.planPatch(p, PATCH.makePatch({ ops: [{ op: 'remove_item', itemId: 'hero' }] }));
  assert.equal(plan.applicable, false);
  assert.match(plan.problems[0].statement, /another item is attached/);

  const q = fixture();
  q.items = q.items.filter((i) => i.id !== 'sword');
  q.groups = [{ id: 'g1', keys: [{ itemId: 'hero', track: 'RightShoulder', t: 0 }] }];
  plan = PATCH.planPatch(q, PATCH.makePatch({ ops: [{ op: 'remove_item', itemId: 'hero' }] }));
  assert.equal(plan.applicable, false);
  assert.match(plan.problems[0].statement, /key group\(s\) still hold keys/);

  const r = fixture();
  r.items = r.items.filter((i) => i.id !== 'sword');
  r.semantics = { roles: { hero: { RightHand: 'weapon_hand' } } };
  plan = PATCH.planPatch(r, PATCH.makePatch({ ops: [{ op: 'remove_item', itemId: 'hero' }] }));
  assert.equal(plan.applicable, false);
  assert.match(plan.problems[0].statement, /semantic layer still refers/);
});

check('snapshot: a brand-new keyed track contributes its frames to the changed range', () => {
  // Regression. An added track used to report only a key COUNT, so `frameRangeOf`, ai/explain.js
  // and ai/observe.js — all of which read `keys_added` — saw no frames at all, and a regression
  // pass would have skipped exactly the frames the new track occupies.
  const before = fixture();
  const after = JSON.parse(JSON.stringify(before));
  after.tracks.hero['@rate'] = { keys: [{ t: 22, v: 0 }, { t: 24, v: 105 }, { t: 34, v: 0 }] };

  const d = SNAP.diffProjects(before, after);
  const tc = d.tracks.find((t) => t.track === '@rate');
  assert.equal(tc.change, 'added');
  assert.equal(tc.keys, 3, 'the count is kept for the callers that read it');
  assert.deepEqual(tc.keys_added, [22, 24, 34]);
  assert.deepEqual(d.changed_frame_range, { start: 22, end: 34 });
  assert.match(d.summary, /3 keyframe change/);

  // Symmetrically for a removal.
  const d2 = SNAP.diffProjects(after, before);
  assert.deepEqual(d2.tracks.find((t) => t.track === '@rate').keys_removed, [22, 24, 34]);
  assert.deepEqual(d2.changed_frame_range, { start: 22, end: 34 });
});

check('events: the shared timeline projects every per-item marker table into one ordered view', () => {
  const p = fixture();
  p.markers.cam = [{ t: 4, width: 0, name: 'cut' }, { t: 40, width: 0, name: 'settle' }];
  const tl = EV.buildTimeline(p);
  assert.equal(tl.count, 3);
  assert.deepEqual(tl.events.map((e) => e.frame), [4, 16, 40], 'ordered by frame across items');
  assert.deepEqual(tl.items.sort(), ['cam', 'hero']);
  const impact = tl.events.find((e) => e.name === 'impact');
  assert.equal(impact.itemId, 'hero');
  assert.equal(impact.itemName, 'Hero');
  assert.deepEqual(impact.span, [16, 18], 'a widthed event occupies a span, not an instant');
  assert.equal(tl.byId.get(impact.id).frame, 16);
});

check('events: an event name on two items is a question, not a guess', () => {
  const p = fixture();
  p.markers.cam = [{ t: 30, width: 0, name: 'impact' }];
  const amb = EV.resolveEvent(p, 'impact');
  assert.equal(amb.frame, null, 'picking the earlier one would silently time an effect to the wrong item');
  assert.equal(amb.ambiguous, true);
  assert.match(amb.question, /2 different items/);

  // Naming the item resolves it.
  assert.equal(EV.resolveEvent(p, 'impact', { itemId: 'hero' }).frame, 16);
  assert.equal(EV.resolveEvent(p, { frame: 12 }).frame, 12, 'an explicit frame is never ambiguous');
  assert.equal(EV.resolveEvent(p, 'nope').frame, null);
  assert.match(EV.resolveEvent(p, 'nope').question, /Known event names: impact/);
});

check('events: an event id encodes its frame, so a retimed marker says so rather than "not found"', () => {
  const p = fixture();
  const tl = EV.buildTimeline(p);
  const id = tl.events[0].id;
  assert.equal(EV.resolveEvent(p, { id }, { timeline: tl }).frame, 16);
  // Retime the marker; the old id must not silently resolve to something else.
  p.markers.hero[0].t = 20;
  const stale = EV.resolveEvent(p, { id });
  assert.equal(stale.frame, null);
  assert.match(stale.question, /has since been retimed/);
});

check('events: a marker table whose item is gone is reported, not listed as an event', () => {
  const p = fixture();
  p.markers.ghost = [{ t: 5, width: 0, name: 'orphan' }];
  const tl = EV.buildTimeline(p);
  assert.equal(tl.count, 1, 'an event nothing owns is not on the timeline');
  assert.equal(tl.warnings[0].id, 'EVENTS-ORPHANED-TABLE');
  assert.match(tl.warnings[0].statement, /no longer exists/);
});

check('events: concurrency and overlap are what a per-item marker list cannot show', () => {
  const p = fixture();
  p.markers.cam = [{ t: 16, width: 4, name: 'shake', codeBegin: 'shake()' }];
  const tl = EV.buildTimeline(p);

  const conc = EV.concurrentEvents(tl);
  assert.equal(conc.length, 1);
  assert.equal(conc[0].frame, 16);
  assert.equal(conc[0].crossItem, true, 'two items landing on one frame is the fact worth surfacing');
  assert.equal(conc[0].withCode, 1);

  const ov = EV.overlaps(tl);
  assert.equal(ov.length, 1);
  assert.equal(ov[0].from, 16);
  assert.equal(ov[0].to, 18, 'the overlap extent distinguishes a clip from an eclipse');
  assert.equal(ov[0].sameItem, false);

  assert.deepEqual(EV.eventsSpanning(tl, 17).map((e) => e.name).sort(), ['impact', 'shake']);
  assert.deepEqual(EV.eventsSpanning(tl, 30), [], 'a frame outside every span is inside nothing');
  assert.equal(EV.eventsInRange(tl, 0, 16).length, 2);
});

check('events: describeShot reports what the project holds and names what it does not', () => {
  const p = fixture();
  const shot = EV.describeShot(p);
  assert.equal(shot.fps, 30);
  assert.equal(shot.length_frames, 60);
  assert.equal(shot.duration_seconds, 2);
  assert.equal(shot.cameras.length, 1);
  assert.equal(shot.active_camera, 'cam', 'one camera is unambiguous');
  assert.equal(shot.characters[0].itemId, 'hero');
  assert.equal(shot.events, 1);
  // Part 4.7: the absent things are named, so a caller does not conclude they are unsupported.
  assert.match(shot.absent.shot_entity, /no Shot record/);
  assert.match(shot.absent.camera_spec, /SHOT-003/);

  // With two cameras, nothing in the project marks which one the shot uses — so it says so.
  p.items.push({ id: 'cam2', kind: 'camera', name: 'Camera 2', origin: I() });
  const two = EV.describeShot(p);
  assert.equal(two.active_camera, null);
  assert.match(two.absent.active_camera, /nothing in the project marks one/);
});

check('vfxspec: the primitive vocabulary is derived from the preset table, not restated', () => {
  assert.equal(VS.PRIMITIVES.length, 22);
  assert.ok(VS.PRIMITIVES.includes('explosion-debris'));
  assert.ok(VS.PRIMITIVES.includes('blood-splatter'), 'a hyphenated material key must survive the split');
  assert.deepEqual(VS.THEMES, ['arcane', 'classic', 'ember', 'holy', 'ice', 'toxic']);
  // Every primitive/theme/scale triple must name a real preset, or compileSpec would throw.
  for (const prim of VS.PRIMITIVES) {
    for (const theme of VS.THEMES) {
      for (const scale of VS.SCALES) {
        assert.ok(PARTICLES.findPreset(`${prim}-${theme}-${scale}`), `${prim}-${theme}-${scale} must exist`);
      }
    }
  }
});

check('vfxspec: timing resolves lead, attack, sustain and decay into an envelope', () => {
  const p = fixture();
  const t = VS.resolveTiming(p, { timing: { event: 'impact', lead: 2, attack: 3, sustain: 4, decay: 6 } });
  assert.equal(t.resolved, true);
  assert.equal(t.event_frame, 16);
  assert.equal(t.peak_frame, 14, 'a positive lead means the effect PEAKS before the event');
  assert.equal(t.start_frame, 11);
  assert.equal(t.hold_frame, 18);
  assert.equal(t.end_frame, 24);
  assert.equal(t.duration_frames, 13);

  // A degenerate attack/decay would put two keys on one frame, which is not a ramp.
  const z = VS.resolveTiming(p, { timing: { event: 'impact', attack: 0, decay: 0 } });
  assert.equal(z.attack, 1);
  assert.equal(z.decay, 1);
  assert.deepEqual(z.findings.map((f) => f.id).sort(), ['VFX-ATTACK-CLAMPED', 'VFX-DECAY-CLAMPED']);

  // An envelope that runs off either end of the timeline is reported.
  const early = VS.resolveTiming(p, { timing: { frame: 1, attack: 10 } });
  assert.ok(early.findings.some((f) => f.id === 'VFX-STARTS-BEFORE-ZERO'));
  const late = VS.resolveTiming(p, { timing: { frame: 58, decay: 20 } });
  assert.ok(late.findings.some((f) => f.id === 'VFX-OUTLIVES-TIMELINE'));
});

check('vfxspec: an unknown primitive, a missing anchor part and an unresolvable event are refused', () => {
  const p = fixture();
  const base = { primitive: 'explosion-debris', anchor: { itemId: 'hero', partId: 'RightHand' }, timing: { event: 'impact' } };

  const unknown = VS.compileSpec(p, { ...base, primitive: 'explosion' });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.ops.length, 0, 'a refused spec must not emit half a patch');
  const f = unknown.findings.find((x) => x.id === 'VFX-PRIMITIVE-UNKNOWN');
  assert.equal(f.suggestion.text, 'did you mean explosion-debris?');

  assert.equal(VS.compileSpec(p, { ...base, anchor: { itemId: 'hero', partId: 'Tentacle' } }).ok, false);
  assert.equal(VS.compileSpec(p, { ...base, anchor: { itemId: 'nobody' } }).ok, false);
  assert.equal(VS.compileSpec(p, { ...base, timing: { event: 'nonexistent' } }).ok, false);
  assert.equal(VS.compileSpec(p, { ...base, offset: [0, 1] }).ok, false);
  assert.equal(VS.compileSpec(p, { ...base, role: 'starring' }).ok, false);
  assert.equal(VS.compileSpec(p, {}).ok, false);
});

check('vfxspec: Part 38\'s role hierarchy shares the particle budget', () => {
  const p = fixture();
  const base = { primitive: 'smoke', anchor: { itemId: 'hero', partId: 'RightHand' }, timing: { event: 'impact' } };
  const prim = VS.compileSpec(p, { ...base, role: 'primary', budget: { maxParticles: 200 } });
  const sup = VS.compileSpec(p, { ...base, role: 'supporting', budget: { maxParticles: 200 } });
  const res = VS.compileSpec(p, { ...base, role: 'residual', budget: { maxParticles: 200 } });
  assert.equal(prim.budget.granted, 200);
  assert.equal(sup.budget.granted, 100);
  assert.equal(res.budget.granted, 50);
  assert.equal(prim.item.emitter.maxParticles, 200);
  // A reduced budget is reported rather than applied silently.
  assert.ok(sup.findings.some((x) => x.id === 'VFX-BUDGET-SHARED'));
  assert.ok(!prim.findings.some((x) => x.id === 'VFX-BUDGET-SHARED'));
  // The three roles are three different specs, so three different items.
  assert.equal(new Set([prim.item.id, sup.item.id, res.item.id]).size, 3);
});

check('vfxspec: a spec compiles to a deterministic id, so the same spec twice is idempotent', () => {
  const p = fixture();
  const spec = { primitive: 'fire', theme: 'ember', anchor: { itemId: 'hero' }, timing: { event: 'impact' } };
  const a = VS.compileSpec(p, spec);
  const b = VS.compileSpec(p, { ...spec, intent: 'presentational, not part of what the spec MEANS' });
  assert.equal(a.item.id, b.item.id, 'the id derives from meaning, not from field order or intent prose');
  assert.match(a.item.id, /^vfx-[0-9a-f]+$/);

  // Committing it twice therefore refuses as a duplicate rather than stacking two emitters.
  const patch = PATCH.makePatch({ ops: a.ops });
  PATCH.commitPatch(p, patch, PATCH.planPatch(p, patch));
  assert.equal(PATCH.planPatch(p, patch).applicable, false);

  // A materially different spec is a different item.
  assert.notEqual(VS.compileSpec(p, { ...spec, theme: 'ice' }).item.id, a.item.id);
});

check('vfxspec: validateTiming judges the peak against the event and catches an open envelope', () => {
  const p = fixture();
  // An emitter with no envelope at all is not timed to anything.
  p.items.push({ id: 'amb', kind: 'vfx', name: 'Ambient', origin: I(), emitter: { rate: 6 }, visible: true });
  p.tracks.amb = {};
  let vt = VS.validateTiming(p);
  assert.ok(vt.findings.some((f) => f.id === 'VFX-NO-ENVELOPE'));

  // A compiled one peaks exactly on its event.
  const c = VS.compileSpec(p, { primitive: 'explosion-debris', anchor: { itemId: 'hero', partId: 'RightHand' }, timing: { event: 'impact' } });
  const patch = PATCH.makePatch({ ops: c.ops });
  PATCH.commitPatch(p, patch, PATCH.planPatch(p, patch));
  vt = VS.validateTiming(p);
  const peak = vt.findings.find((f) => f.id === 'VFX-PEAK-ON-EVENT');
  assert.ok(peak, 'the compiled envelope must land on the event it was timed to');
  assert.match(peak.statement, /peaks exactly on event "impact" at frame 16/);

  // An envelope whose last key is hot keeps emitting forever.
  p.tracks[c.item.id]['@rate'].keys.at(-1).v = 40;
  assert.ok(VS.validateTiming(p).findings.some((f) => f.id === 'VFX-ENVELOPE-UNCLOSED'));
});

check('layer: the Phase 6 success condition — a parameterized impact effect is attached, timed, and reversible', () => {
  // Part 62, Phase 6, verbatim: "Cadence can generate a parameterized impact effect that remains
  // attached, timed, and reversible." End to end through the real machinery — no renderer.
  const p = fixture();
  const origin = H.contentHash(p);
  const ledger = new TXN.TransactionLedger();

  // The shot already carries the event the effect must hit.
  const tl = EV.buildTimeline(p);
  assert.equal(EV.resolveEvent(p, 'impact', { timeline: tl }).frame, 16);

  // PARAMETERIZED — a declarative spec, not a hand-built item.
  const spec = {
    primitive: 'explosion-debris', theme: 'ember', scale: 'large', role: 'primary',
    anchor: { itemId: 'hero', partId: 'RightHand' }, offset: [0, -0.5, 0],
    timing: { event: 'impact', lead: 0, attack: 2, decay: 8 },
    intent: 'a heavy impact on the sword hand',
  };
  const c = VS.compileSpec(p, spec, { timeline: tl });
  assert.equal(c.ok, true);
  assert.equal(c.preset.id, 'explosion-debris-ember-large');

  // ATTACHED — the emitter rides the hand, so it follows the animation rather than sitting still.
  assert.equal(c.item.attachedTo.itemId, 'hero');
  assert.equal(c.item.attachedTo.partId, 'RightHand');
  assert.deepEqual(c.item.attachedTo.offset.slice(0, 3), [0, -0.5, 0]);

  // TIMED — the rate envelope peaks on the event, and closes.
  assert.deepEqual(c.envelope, [{ frame: 14, rate: 0 }, { frame: 16, rate: c.envelope[1].rate }, { frame: 24, rate: 0 }]);
  assert.ok(c.envelope[1].rate > 0);

  // Applied through the transaction machinery like any other edit.
  const patch = PATCH.makePatch({ ops: c.ops, intent: spec.intent });
  const plan = PATCH.planPatch(p, patch);
  assert.equal(plan.applicable, true);
  // The affected frame range must cover the envelope — this is what a regression pass renders.
  assert.deepEqual(plan.diff.changed_frame_range, { start: 14, end: 24 });
  const applied = TXN.apply(p, patch, plan, { ledger, timestamp: 'T1' });
  assert.equal(applied.applied, true);

  // The effect is now really there, and really timed to the event.
  const vt = VS.validateTiming(p);
  assert.ok(vt.findings.some((f) => f.id === 'VFX-PEAK-ON-EVENT'));
  assert.equal(p.items.find((i) => i.id === c.item.id).emitter.motion, 'burst', 'an impact is omnidirectional, not a spray');

  // REVERSIBLE — the whole effect, item and envelope together, comes back out byte-identically.
  const back = TXN.rollback(p, ledger, applied.transaction_id, { timestamp: 'T2' });
  assert.equal(back.rolled_back, true);
  assert.equal(back.complete, true);
  assert.equal(H.contentHash(p), origin, 'the rollback must land byte-identical, not merely close');
  assert.equal(p.items.some((i) => i.kind === 'vfx'), false);
  assert.equal(p.tracks[c.item.id], undefined);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
