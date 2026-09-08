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
const CF = await import('../renderer/js/cf.js');

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

console.log('\n— purity —');

check('purity: every ai/ module imports in plain Node with no renderer globals', () => {
  // Reaching this line at all means all 12 imports at the top of this file succeeded. Asserting a
  // symbol from each one keeps a future tree-shaking or re-export mistake from making that vacuous.
  for (const [name, mod] of Object.entries({ H, C, IDS, K, R, RG, TG, SG, SEL, SNAP, PRV, PATCH, CON, SCOPE, TXN, VOC, CAL, INT, PLAN })) {
    assert.ok(Object.keys(mod).length > 0, `${name} exported nothing`);
  }
  assert.equal(typeof AI.SEMANTIC_LAYER_VERSION, 'string');
});

check('purity: every ai/ module on disk is imported by this file', () => {
  // The purity gate is only a gate if it covers everything. A new module that nobody imports here
  // could reach for `window` freely, and the check below that greps the sources would catch the
  // obvious cases but not a lazy `await import('three')`.
  const onDisk = fs.readdirSync(path.join(ROOT, 'renderer/js/ai')).filter((n) => n.endsWith('.js') && n !== 'index.js').sort();
  const imported = ['cal.js', 'certainty.js', 'constraints.js', 'hash.js', 'ids.js', 'intent.js', 'kinematics.js', 'patch.js', 'plan.js', 'provenance.js', 'riggraph.js', 'roles.js', 'scenegraph.js', 'scope.js', 'select.js', 'snapshot.js', 'timelinegraph.js', 'transaction.js', 'vocabulary.js'];
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
    'animation_vocabulary', 'interpret_intent', 'plan_motion', 'evaluate_acceptance']) {
    assert.ok(found.get(t).startsWith('READ-ONLY'), `${t} must be declared READ-ONLY`);
  }
  for (const t of ['apply_animation_patch', 'rollback_transaction', 'lock_constraint', 'unlock_constraint',
    'set_vocabulary_term', 'apply_motion_plan']) {
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
  // Part 54's own worked example includes a foot-contact tolerance, and Cadence cannot measure it
  // until Phase 5. This is the check that keeps that honest.
  const p = fixture();
  const comp = CON.compileConstraints({ contacts: [{ effector: 'the left foot', from: 12, to: 23, tolerance_studs: 0.07 }] }, p);
  assert.equal(comp.constraints.length, 1);
  assert.ok(comp.notes.some((n) => /cannot be verified yet/.test(n)));
  const chk = CON.checkPatch(p, PATCH.makePatch({ ops: [{ op: 'set_key', itemId: 'hero', track: 'LeftAnkle', t: 15, value: CF.fromEuler(0.5, 0, 0) }] }), comp.constraints);
  assert.equal(chk.violations.length, 0);
  assert.ok(chk.coverage.notRun.some((s) => /contact_drift/.test(s) && /MOT-008/.test(s)));
  assert.ok(/see coverage.notRun/.test(chk.recommendation), 'the recommendation must not read as a clean pass');
  assert.equal(CON.CHECKS.contact_drift.implemented, false);
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
  assert.equal(s.expected_visual_region.region, null);
  assert.ok(/OBS-002/.test(s.expected_visual_region.blocked_on));
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
  assert.ok(/REG-001/.test(txn.baseline_comparison.blocked_on), 'an empty baseline comparison must say what unblocks it');
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
  assert.ok(c.methods_unavailable.every((s) => /Phase 4/.test(s)));
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
  assert.ok(pv.constraints_checked.not_checked.some((s) => /contact_drift/.test(s)));

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
    { check: 'contact_drift_within', itemId: 'hero', effector: 'the left foot' },
  ] });
  assert.equal(spec.not_runnable.length, 2);
  const p = slashFixture();
  const r = CAL.evaluateAcceptance(p, p, spec, { itemId: 'hero' });
  assert.equal(r.accepted, true, 'the one runnable check passes on an unchanged project');
  assert.equal(r.fully_validated, false, 'but two checks did not run, so this is NOT fully validated');
  assert.equal(r.results.filter((x) => x.status === 'not_run').length, 2);
  assert.ok(r.coverage.notRun.some((s) => /Phase 4/.test(s)));
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
  assert.ok(cf && /Part 23/.test(cf.reason));
  assert.equal(cf.blocked_by, 'capability');
  assert.ok(m.plan.blocked.some((b) => b.dimension.startsWith('vfx_') && /Part 37/.test(b.reason)));
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

check('plan: overshoot refuses a contact-capable effector and an impact span', () => {
  const p = slashFixture();
  const i = INT.interpretRequest(p, { request: 'make the slash heavier', itemId: 'hero' });
  const m = PLAN.planMotion(p, { intent: i.intent, constraints: [] });
  const c = PLAN.compilePlan(p, m.plan, m.ctx, { constraints: [] });
  const back = c.ops.filter((o) => o.es === 'Back');
  assert.ok(back.length, 'the attack template names a follow_through, so overshoot has somewhere to go');
  assert.ok(c.skipped.some((s) => s.strategy === 'overshoot' && /breaks the plant/.test(s.why)),
    'the elbow drives a lower arm, which can hold a contact');
  assert.ok(!back.some((o) => o.track === 'RightElbow'));
  assert.ok(!back.some((o) => o.t === 8), 'frame 8 departs into the impact — overshooting into a contact is the thing not to do');
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
  assert.ok(m.coverage.notRun.some((s) => /no contact was measured/.test(s)));
  assert.ok(PLAN.planLimitations().cannot.some((s) => /judge the result/.test(s)));
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

check('layer: capabilities() states both what it can and cannot do', () => {
  const c = AI.capabilities();
  assert.ok(c.can.length >= 5 && c.cannot.length >= 5);
  assert.ok(c.cannot.some((s) => /velocity/.test(s)));
  assert.ok(c.cannot.some((s) => /baseline/.test(s)));
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
