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
  for (const [name, mod] of Object.entries({ H, C, IDS, K, R, RG, TG, SG, SEL, SNAP, PRV })) {
    assert.ok(Object.keys(mod).length > 0, `${name} exported nothing`);
  }
  assert.equal(typeof AI.SEMANTIC_LAYER_VERSION, 'string');
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
  for (const t of ['inspect_scene', 'inspect_rig', 'inspect_timeline', 'resolve_semantic', 'selection_vocabulary', 'list_snapshots', 'diff_snapshots', 'inspect_provenance']) {
    assert.ok(found.get(t).startsWith('READ-ONLY'), `${t} must be declared READ-ONLY`);
  }
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
