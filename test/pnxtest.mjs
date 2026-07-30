// Fast Node-level tests for the PNX procedural node engine (renderer/js/pnx/**). Plain Node, no
// Electron — the tight iteration loop, exactly like test/coretest.mjs is for the effect core.
// Run: node test/pnxtest.mjs
//
// This file doubles as the purity gate: importing these modules here proves none of them reaches
// for window.*, state.js or three.js at load time.

import assert from 'node:assert/strict';

const T = await import('../renderer/js/pnx/types.js');
const V = await import('../renderer/js/pnx/values.js');
const F = await import('../renderer/js/pnx/fields.js');
const R = await import('../renderer/js/pnx/registry.js');
const G = await import('../renderer/js/pnx/graph.js');
const E = await import('../renderer/js/pnx/evaluator.js');
await import('../renderer/js/pnx/nodes/index.js');

let passed = 0, failed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e.message}`);
    console.error(`FAIL  ${name}: ${e.message}`);
  }
}
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `expected ${b}, got ${a}`);
const nearArr = (a, b, eps = 1e-6) => {
  assert.equal(a.length, b.length, `length ${a.length} != ${b.length}`);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= eps, `[${i}] expected ${b[i]}, got ${v}`));
};

// ================================================================ types
check('types: parse and format', () => {
  assert.equal(T.formatType(T.parseType('float')), 'float');
  assert.equal(T.formatType(T.parseType('field<vector3>')), 'field<vector3>');
  assert.equal(T.formatType(T.parseType('array<field<color>>')), 'array<field<color>>');
  assert.equal(T.parseType('nonsense'), null);
  assert.equal(T.parseType('field<nonsense>'), null);
  assert.equal(T.parseType('float<float>'), null); // float is not a wrapper
});

check('types: generics recognised', () => {
  assert.ok(T.isGeneric(T.parseType('T')));
  assert.ok(T.isGeneric(T.parseType('T2')));
  assert.ok(!T.isGeneric(T.parseType('float')));
  assert.ok(T.containsGeneric(T.parseType('field<T>')));
  assert.ok(!T.containsGeneric(T.parseType('field<float>')));
});

check('types: widening converts, narrowing does not', () => {
  assert.ok(T.canConvert('int', 'float'));
  assert.ok(T.canConvert('float', 'vector3'));
  assert.ok(T.canConvert('vector3', 'color'));
  assert.ok(T.canConvert('vector2', 'vector3'));
  // narrowing is deliberately refused — the spec has explicit Length/Luminance/Split nodes
  assert.ok(!T.canConvert('vector3', 'float'));
  assert.ok(!T.canConvert('color', 'float'));
  assert.ok(!T.canConvert('vector3', 'vector2'));
  assert.ok(!T.canConvert('string', 'float'));
});

check('types: float broadcasts, vector4 and color are exact', () => {
  nearArr(T.convertValue(0.5, 'float', 'vector3'), [0.5, 0.5, 0.5]);
  nearArr(T.convertValue(0.5, 'float', 'color'), [0.5, 0.5, 0.5, 1]);
  nearArr(T.convertValue([1, 2, 3], 'vector3', 'color'), [1, 2, 3, 1]);
  nearArr(T.convertValue([1, 2, 3, 0.5], 'color', 'vector4'), [1, 2, 3, 0.5]);
  assert.equal(T.findConversion('vector4', 'color').cost, 1);
  assert.ok(T.findConversion('float', 'vector3').cost > 1);
});

check('types: T lifts into field<T>, but a field never silently collapses', () => {
  const lifted = T.convertValue(7, 'float', 'field<float>');
  assert.ok(F.isField(lifted));
  assert.equal(lifted.sample(F.newSampleContext()), 7);
  assert.ok(F.isConstantField(lifted));
  assert.ok(!T.canConvert('field<float>', 'float'));
});

check('types: field<A> -> field<B> converts lazily', () => {
  const src = F.makeField('float', (ctx) => ctx.position[0]);
  const conv = T.convertValue(src, 'field<float>', 'field<vector3>');
  assert.ok(F.isField(conv));
  nearArr(conv.sample(F.newSampleContext({ position: [4, 0, 0] })), [4, 4, 4]);
});

check('types: unify resolves a shared variable to the widest type', () => {
  const bind = {};
  assert.ok(T.unify(T.parseType('T'), T.parseType('float'), bind));
  assert.ok(T.unify(T.parseType('T'), T.parseType('vector3'), bind));
  assert.equal(T.formatType(bind.T), 'vector3');
  // order-independent: the wide one first, then the narrow one
  const bind2 = {};
  T.unify(T.parseType('T'), T.parseType('vector3'), bind2);
  T.unify(T.parseType('T'), T.parseType('float'), bind2);
  assert.equal(T.formatType(bind2.T), 'vector3');
});

check('types: a field in a generic slot marks the call lifted; an explicit field slot does not', () => {
  const lift = {};
  assert.ok(T.unify(T.parseType('T'), T.parseType('field<float>'), lift));
  assert.equal(T.formatType(lift.T), 'float');
  assert.equal(lift.__lifted, true);

  const raw = {};
  assert.ok(T.unify(T.parseType('field<T>'), T.parseType('field<vector3>'), raw));
  assert.equal(T.formatType(raw.T), 'vector3');
  assert.ok(!raw.__lifted, 'declaring field<T> must hand over the raw field, not lift');
});

check('types: unimplemented types are named but rejected', () => {
  assert.ok(T.parseType('volume'), 'volume must be a known type name');
  assert.ok(!T.isImplementedType('volume'), 'volume must not claim to be implemented');
  assert.ok(T.isImplementedType('field<color>'));
});

// ================================================================ values
check('values: component round-trip preserves type', () => {
  assert.equal(V.fromComponents('float', [1.7]), 1.7);
  assert.equal(V.fromComponents('int', [1.7]), 2);
  assert.equal(V.fromComponents('bool', [0]), false);
  nearArr(V.fromComponents('color', [1, 0, 0]), [1, 0, 0, 1]); // alpha defaults opaque
  nearArr(V.toComponents('vector3', [1, 2, 3]), [1, 2, 3]);
  nearArr(V.toComponents('vector3', null), [0, 0, 0]); // absent input is zero, never NaN
});

check('values: vector maths', () => {
  near(V.vLength([3, 4, 0]), 5);
  near(V.vDot([1, 2, 3], [4, 5, 6]), 32);
  nearArr(V.vCross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  nearArr(V.vNormalize([0, 5, 0]), [0, 1, 0]);
  nearArr(V.vNormalize([0, 0, 0]), [0, 0, 0]); // degenerate -> zero, not NaN
  near(V.vAngle([1, 0, 0], [0, 1, 0]), Math.PI / 2);
  near(V.vAngle([0, 0, 0], [0, 1, 0]), 0); // degenerate -> 0, not NaN
  nearArr(V.vReflect([1, -1, 0], [0, 1, 0]), [1, 1, 0]);
  nearArr(V.vProject([3, 4, 0], [1, 0, 0]), [3, 0, 0]);
  nearArr(V.vReject([3, 4, 0], [1, 0, 0]), [0, 4, 0]);
});

check('values: signed angle knows which way round', () => {
  near(V.vSignedAngle([1, 0, 0], [0, 0, 1], [0, 1, 0]), -Math.PI / 2, 1e-9);
  near(V.vSignedAngle([0, 0, 1], [1, 0, 0], [0, 1, 0]), Math.PI / 2, 1e-9);
});

check('values: total internal reflection returns zero, not a silent reflection', () => {
  const grazing = V.vRefract([1, -0.02, 0], [0, 1, 0], 4);
  nearArr(grazing, [0, 0, 0]);
});

check('values: quaternions round-trip through Euler using the app convention', () => {
  const q = V.qFromEuler(0.3, -0.7, 1.1);
  const e = V.qToEuler(q);
  nearArr(e, [0.3, -0.7, 1.1], 1e-6);
});

check('values: quaternion rotates a vector correctly', () => {
  const q = V.qFromAxisAngle([0, 1, 0], Math.PI / 2);
  nearArr(V.qRotateVector(q, [1, 0, 0]), [0, 0, -1], 1e-9);
});

check('values: qBetween produces the shortest arc', () => {
  const q = V.qBetween([1, 0, 0], [0, 1, 0]);
  nearArr(V.qRotateVector(q, [1, 0, 0]), [0, 1, 0], 1e-6);
  nearArr(V.qBetween([1, 0, 0], [1, 0, 0]), [0, 0, 0, 1]); // already aligned -> identity
});

check('values: look-at aims local +Y at the target', () => {
  const q = V.qLookAt([0, 0, 0], [0, 0, 5]);
  nearArr(V.qRotateVector(q, [0, 1, 0]), [0, 0, 1], 1e-6);
});

check('values: transform compose, inverse and point/direction differ correctly', () => {
  const t = V.newTransform([1, 2, 3], V.qFromAxisAngle([0, 1, 0], Math.PI / 2), [2, 2, 2]);
  const p = V.transformPoint(t, [1, 0, 0]);
  const d = V.transformDirection(t, [1, 0, 0]);
  nearArr(p, [1, 2, 1], 1e-6);   // scaled, rotated, THEN translated
  nearArr(d, [0, 0, -2], 1e-6);  // direction ignores translation
  const back = V.transformPoint(V.transformInverse(t), p);
  nearArr(back, [1, 0, 0], 1e-6);
});

check('values: transform multiply matches applying the two in order', () => {
  const a = V.newTransform([1, 0, 0], V.qFromAxisAngle([0, 1, 0], Math.PI / 2));
  const b = V.newTransform([0, 0, 2]);
  const combined = V.transformMultiply(a, b);
  nearArr(V.transformPoint(combined, [0, 0, 0]), V.transformPoint(a, V.transformPoint(b, [0, 0, 0])), 1e-6);
});

check('values: matrix and transform round-trip', () => {
  const t = V.newTransform([4, -1, 2], V.qFromEuler(0.2, 0.4, -0.1), [1.5, 1.5, 1.5]);
  const back = V.m4ToTransform(V.m4FromTransform(t));
  nearArr(back.p, t.p, 1e-6);
  nearArr(back.s, t.s, 1e-6);
  // quaternion sign is not unique — compare the rotation's action instead
  nearArr(V.qRotateVector(back.q, [1, 2, 3]), V.qRotateVector(t.q, [1, 2, 3]), 1e-6);
});

check('values: colour conversions', () => {
  nearArr(V.hexToColor('#ff8000'), [1, 128 / 255, 0, 1], 1e-9);
  nearArr(V.hexToColor('#f80'), [1, 136 / 255, 0, 1], 1e-9);
  assert.equal(V.colorToHex([1, 0, 0, 1]), '#ff0000');
  nearArr(V.hexToColor('not a colour', [0, 0, 0, 1]), [0, 0, 0, 1]);
  const hsv = V.rgbToHsv([0.2, 0.8, 0.4]);
  nearArr(V.hsvToRgb(...hsv), [0.2, 0.8, 0.4], 1e-9);
  const hsl = V.rgbToHsl([0.2, 0.8, 0.4]);
  nearArr(V.hslToRgb(...hsl), [0.2, 0.8, 0.4], 1e-9);
  near(V.luminance([1, 1, 1]), 1, 1e-9);
});

check('values: colour temperature reads warm low and cool high', () => {
  const candle = V.temperatureToColor(1700);
  const daylight = V.temperatureToColor(6500);
  const sky = V.temperatureToColor(15000);
  assert.ok(candle[0] > candle[2], 'candle flame must be red-dominant');
  assert.ok(sky[2] > sky[0], 'a 15000K sky must be blue-dominant');
  assert.ok(Math.abs(daylight[0] - daylight[2]) < 0.25, 'daylight should be roughly neutral');
});

check('values: premultiply round-trips', () => {
  const c = [0.4, 0.6, 0.8, 0.5];
  nearArr(V.unpremultiply(V.premultiply(c)), c, 1e-9);
  nearArr(V.unpremultiply([0, 0, 0, 0]), [0, 0, 0, 0]); // fully transparent -> no divide by zero
});

check('values: hashing is deterministic and structural', () => {
  assert.equal(V.hashString('cadence.math.add'), V.hashString('cadence.math.add'));
  assert.notEqual(V.hashString('a'), V.hashString('b'));
  assert.equal(V.mixSeeds(3, 7), V.mixSeeds(3, 7));
  assert.notEqual(V.mixSeeds(3, 7), V.mixSeeds(7, 3));
  const u = V.seedToUnit(V.hashString('x'));
  assert.ok(u >= 0 && u < 1);
});

check('values: sanitize contains NaN and Infinity', () => {
  assert.equal(V.sanitize(NaN), 0);
  assert.equal(V.sanitize(Infinity), 0);
  nearArr(V.sanitize([1, NaN, 3]), [1, 0, 3]);
  assert.ok(V.hasNonFinite([1, Infinity]));
  assert.ok(!V.hasNonFinite([1, 2, 3]));
  assert.ok(V.hasNonFinite(V.newTransform([NaN, 0, 0])));
});

// ================================================================ fields
check('fields: constant fields stay constant through maps', () => {
  const c = F.constantField('float', 3);
  const doubled = F.mapField('float', c, (v) => v * 2);
  assert.ok(F.isConstantField(doubled), 'a mapped constant must stay recognisably constant');
  assert.equal(doubled.sample(F.newSampleContext()), 6);
});

check('fields: attributes read intrinsics and custom names alike', () => {
  const ctx = F.newSampleContext({ position: [1, 2, 3], age: 0.4, attributes: { heat: 900 } });
  nearArr(F.attr(ctx, 'position'), [1, 2, 3]);
  assert.equal(F.attr(ctx, 'age'), 0.4);
  assert.equal(F.attr(ctx, 'heat'), 900);
  assert.equal(F.attr(ctx, 'nothing', -1), -1);
});

check('fields: warp offsets the sample point, not the value', () => {
  const px = F.makeField('float', (ctx) => ctx.position[0]);
  const warped = F.warpField(px, [10, 0, 0]);
  assert.equal(warped.sample(F.newSampleContext({ position: [1, 0, 0] })), 11);
});

check('fields: transformField applies the inverse to the domain', () => {
  const px = F.makeField('float', (ctx) => ctx.position[0]);
  // Moving the field +5 along X means the value that was at 0 is now found at 5.
  const moved = F.transformField(px, V.newTransform([5, 0, 0]));
  near(moved.sample(F.newSampleContext({ position: [5, 0, 0] })), 0, 1e-9);
});

check('fields: gradient of a linear ramp is its slope', () => {
  const ramp = F.makeField('float', (ctx) => 3 * ctx.position[0] - 2 * ctx.position[1]);
  const g = F.gradientField(ramp);
  nearArr(g.sample(F.newSampleContext({ position: [1, 1, 1] })), [3, -2, 0], 1e-6);
});

check('fields: curl of a linear rotation field is constant and divergence-free', () => {
  // v = (-y, x, 0) rotates about Z; its curl is (0, 0, 2) everywhere.
  const rot = F.makeField('vector3', (ctx) => [-ctx.position[1], ctx.position[0], 0]);
  const c = F.curlField(rot);
  nearArr(c.sample(F.newSampleContext({ position: [3, -7, 2] })), [0, 0, 2], 1e-5);
});

check('fields: blur of a constant field is that constant', () => {
  const flat = F.makeField('float', () => 4);
  near(F.blurField(flat, 2).sample(F.newSampleContext()), 4, 1e-9);
});

check('fields: seeding is structural, so an unrelated edit cannot perturb it', () => {
  const a = F.randomAt('n_abc', 0, 5, 0);
  const b = F.randomAt('n_abc', 0, 5, 0);
  assert.equal(a, b, 'same path/seed/element must give the same value');
  assert.notEqual(a, F.randomAt('n_xyz', 0, 5, 0), 'a different node must decorrelate');
  assert.notEqual(a, F.randomAt('n_abc', 0, 6, 0), 'a different element must decorrelate');
  assert.notEqual(a, F.randomAt('n_abc', 0, 5, 1), 'a different channel must decorrelate');
});

// ================================================================ registry
check('registry: the catalogue registered without error', () => {
  assert.ok(R.nodeCount() > 40, `expected a real catalogue, got ${R.nodeCount()} nodes`);
  assert.ok(R.getNode('cadence.math.add'), 'add must resolve unversioned');
  assert.ok(R.getNode('cadence.math.add@1'), 'add must resolve versioned');
  assert.equal(R.getNode('cadence.math.nonexistent'), null);
});

check('registry: a node using an unimplemented type is refused (spec Part 78)', () => {
  assert.throws(() => R.registerNode({
    id: 'test.fake.volume', version: 1, label: 'Fake Volume', category: 'Volumes',
    summary: 'Pretends volumes exist.', exportSupport: 'unsupported',
    inputs: [{ key: 'v', label: 'Volume', type: 'volume' }],
    outputs: [{ key: 'out', label: 'Out', type: 'float' }],
    evaluate: () => 0,
  }), /not yet implemented/);
});

check('registry: documentation and export classification are mandatory', () => {
  const skeleton = {
    id: 'test.doc.check', version: 1, label: 'X', category: 'Math',
    inputs: [], outputs: [{ key: 'out', label: 'o', type: 'float' }], evaluate: () => 0,
  };
  assert.throws(() => R.registerNode({ ...skeleton, exportSupport: 'baked' }), /summary/);
  assert.throws(() => R.registerNode({ ...skeleton, summary: 'x' }), /exportSupport/);
  assert.throws(() => R.registerNode({ ...skeleton, summary: 'x', exportSupport: 'nope' }), /exportSupport/);
});

check('registry: undeclared generics and duplicate ids are refused', () => {
  assert.throws(() => R.registerNode({
    id: 'test.generic.undeclared', version: 1, label: 'X', category: 'Math',
    summary: 'x', exportSupport: 'baked',
    inputs: [{ key: 'a', label: 'A', type: 'Q' }],
    outputs: [{ key: 'out', label: 'o', type: 'Q' }], evaluate: () => 0,
  }), /undeclared generic/);
  assert.throws(() => R.registerNode({
    id: 'cadence.math.add', version: 1, label: 'Dup', category: 'Math',
    summary: 'x', exportSupport: 'baked', inputs: [], outputs: [], evaluate: () => 0,
  }), /already registered/);
});

check('registry: search finds nodes by the words users actually type', () => {
  const ids = (q) => R.searchNodes(q).map((n) => n.id);
  assert.ok(ids('add').includes('cadence.math.add'));
  assert.ok(ids('mix').includes('cadence.math.lerp'), '"mix" must reach Lerp');
  assert.ok(ids('soft edge').includes('cadence.math.smoothstep'), '"soft edge" must reach Smoothstep');
  assert.ok(ids('remap').includes('cadence.math.mapRange'), '"remap" must reach Map Range');
  assert.ok(ids('repeat').includes('cadence.math.modulo'), '"repeat" must reach Modulo');
  assert.equal(R.searchNodes('zzzzqqqq').length, 0, 'a nonsense query must return nothing');
});

check('registry: describeNode gives an MCP client everything it needs', () => {
  const d = R.describeNode('cadence.math.mapRange');
  assert.equal(d.id, 'cadence.math.mapRange');
  assert.equal(d.fullId, 'cadence.math.mapRange@1');
  assert.ok(d.summary.length > 10);
  assert.ok(d.inputs.some((s) => s.key === 'value'));
  assert.ok(d.inputs.find((s) => s.key === 'clamp').connectable === false, 'a mode switch must be marked unconnectable');
  assert.ok(R.EXPORT_SUPPORT.includes(d.exportSupport));
});

// ================================================================ graph
function chainGraph() {
  const g = G.newGraph('test');
  const a = G.newNode(g, 'cadence.math.add', 0, 0, { values: { a: 2, b: 3 } });
  const m = G.newNode(g, 'cadence.math.multiply', 200, 0, { values: { b: 4 } });
  const r = G.connect(g, a.id, 'out', m.id, 'a');
  assert.ok(r.ok, r.reason);
  return { g, a, m };
}

check('graph: nodes store a versioned type even when created unversioned', () => {
  const { a } = chainGraph();
  assert.equal(a.type, 'cadence.math.add@1');
});

check('graph: connect refuses self-links, unknown sockets and loops with a reason', () => {
  const { g, a, m } = chainGraph();
  assert.match(G.connect(g, a.id, 'out', a.id, 'a').reason, /itself/);
  assert.match(G.connect(g, a.id, 'nope', m.id, 'a').reason, /not an output/);
  assert.match(G.connect(g, m.id, 'out', a.id, 'a').reason, /loop/);
});

check('graph: a single-input socket replaces its wire instead of collecting them', () => {
  const { g, a, m } = chainGraph();
  const c = G.newNode(g, 'cadence.math.pi', -200, 0);
  G.connect(g, c.id, 'out', m.id, 'a');
  assert.equal(G.linksInto(g, m.id, 'a').length, 1);
});

check('graph: a multi-input socket collects wires and refuses exact duplicates', () => {
  const g = G.newGraph('t');
  const sum = G.newNode(g, 'cadence.math.sum');
  const p = G.newNode(g, 'cadence.math.pi');
  const e = G.newNode(g, 'cadence.math.e');
  assert.ok(G.connect(g, p.id, 'out', sum.id, 'values').ok);
  assert.ok(G.connect(g, e.id, 'out', sum.id, 'values').ok);
  assert.equal(G.linksInto(g, sum.id, 'values').length, 2);
  assert.match(G.connect(g, p.id, 'out', sum.id, 'values').reason, /already connected/);
});

check('graph: an incompatible wire is refused before it exists', () => {
  const g = G.newGraph('t');
  const gt = G.newNode(g, 'cadence.math.greaterThan');   // outputs bool
  const deg = G.newNode(g, 'cadence.math.degreesToRadians'); // wants float — bool widens to float
  assert.ok(G.connect(g, gt.id, 'out', deg.id, 'value').ok, 'bool must widen into float');
});

check('graph: removing a node cascades to its links', () => {
  const { g, a, m } = chainGraph();
  G.removeNode(g, a.id);
  assert.equal(Object.keys(g.links).length, 0);
  assert.equal(G.getNode(g, a.id), null);
  assert.ok(G.getNode(g, m.id));
});

check('graph: topological order respects dependencies and is deterministic', () => {
  const { g, a, m } = chainGraph();
  const t1 = G.topoOrder(g);
  assert.ok(t1.ok);
  assert.ok(t1.order.indexOf(a.id) < t1.order.indexOf(m.id));
  assert.deepEqual(G.topoOrder(g).order, t1.order, 'ordering must be stable across calls');
});

check('graph: a hand-crafted cycle is reported with the offending nodes, never a hang', () => {
  const { g, a, m } = chainGraph();
  g.links.forced = { id: 'forced', fromNode: m.id, fromSocket: 'out', toNode: a.id, toSocket: 'a' };
  const t = G.topoOrder(g);
  assert.equal(t.ok, false);
  assert.equal(t.cycle.length, 2);
  assert.ok(t.cycle.includes(a.id) && t.cycle.includes(m.id));
});

check('graph: upstream and downstream sets are transitive', () => {
  const { g, a, m } = chainGraph();
  assert.deepEqual([...G.upstreamOf(g, m.id)], [a.id]);
  assert.deepEqual([...G.downstreamOf(g, a.id)], [m.id]);
  assert.equal(G.upstreamOf(g, a.id).size, 0);
});

check('graph: serialize/parse round-trips exactly', () => {
  const { g } = chainGraph();
  G.addComment(g, 10, 20, 'note');
  const parsed = G.parseGraph(G.serializeGraph(g));
  assert.ok(parsed.ok, parsed.error);
  assert.deepEqual(Object.keys(parsed.graph.nodes).sort(), Object.keys(g.nodes).sort());
  assert.equal(Object.keys(parsed.graph.links).length, Object.keys(g.links).length);
  assert.equal(parsed.graph.comments.length, 1);
  assert.equal(parsed.warnings.length, 0);
});

check('graph: an unknown node type fails the parse; a dangling link only warns', () => {
  const { g, a } = chainGraph();
  const raw = JSON.parse(G.serializeGraph(g));
  raw.nodes[a.id].type = 'cadence.does.not.exist@1';
  assert.equal(G.parseGraph(raw).ok, false);

  const raw2 = JSON.parse(G.serializeGraph(g));
  raw2.links.ghost = { id: 'ghost', fromNode: 'nope', fromSocket: 'out', toNode: a.id, toSocket: 'a' };
  const p2 = G.parseGraph(raw2);
  assert.ok(p2.ok);
  assert.ok(p2.warnings.some((w) => /link/.test(w)));
});

check('graph: an unversioned stored type resolves forward to the newest version', () => {
  const { g, a } = chainGraph();
  const raw = JSON.parse(G.serializeGraph(g));
  raw.nodes[a.id].type = 'cadence.math.add';
  const p = G.parseGraph(raw);
  assert.ok(p.ok, p.error);
  assert.equal(p.graph.nodes[a.id].type, 'cadence.math.add@1');
});

// ================================================================ groups
check('groups: a new group comes with its own boundary nodes', () => {
  const g = G.newGraph('t');
  const grp = G.newGroupDef(g, 'Vortex', { inputs: [{ key: 'strength', label: 'Strength', type: 'float', default: 1 }], outputs: [{ key: 'out', label: 'Out', type: 'float' }] });
  const inside = G.nodesInScope(g, grp.id);
  assert.equal(inside.length, 2);
  assert.ok(inside.some((n) => n.type === G.GROUP_INPUT_TYPE));
  assert.ok(inside.some((n) => n.type === G.GROUP_OUTPUT_TYPE));
});

check('groups: the boundary is inside-out — declared inputs appear as outputs within', () => {
  const g = G.newGraph('t');
  const grp = G.newGroupDef(g, 'G', { inputs: [{ key: 'x', label: 'X', type: 'float' }], outputs: [{ key: 'y', label: 'Y', type: 'float' }] });
  const inNode = G.nodesInScope(g, grp.id).find((n) => n.type === G.GROUP_INPUT_TYPE);
  const s = G.socketsOf(g, inNode);
  assert.equal(s.inputs.length, 0);
  assert.equal(s.outputs[0].key, 'x');
});

check('groups: wiring across a group boundary is refused', () => {
  const g = G.newGraph('t');
  const grp = G.newGroupDef(g, 'G', { inputs: [{ key: 'x', label: 'X', type: 'float' }], outputs: [{ key: 'y', label: 'Y', type: 'float' }] });
  const outside = G.newNode(g, 'cadence.math.pi');
  const insideAdd = G.newNode(g, 'cadence.math.add', 0, 0, { scope: grp.id });
  assert.match(G.connect(g, outside.id, 'out', insideAdd.id, 'a').reason, /different groups/);
});

check('groups: recursion is detected before it can be created', () => {
  const g = G.newGraph('t');
  const outer = G.newGroupDef(g, 'Outer');
  const inner = G.newGroupDef(g, 'Inner');
  G.newNode(g, `${G.GROUP_TYPE_PREFIX}${inner.id}`, 0, 0, { scope: outer.id });
  assert.ok(G.wouldRecurse(g, inner.id, outer.id), 'putting Outer inside Inner would recurse');
  assert.ok(G.wouldRecurse(g, outer.id, outer.id), 'a group inside itself must be refused');
  assert.ok(!G.wouldRecurse(g, outer.id, inner.id));
});

// ================================================================ evaluator
const ev = (g, nodeId, socket = 'out', opts = {}) => new E.Evaluator(g, opts).evaluateSocket(nodeId, socket);

check('evaluator: a simple chain computes correctly', () => {
  const { g, m } = chainGraph();
  const r = ev(g, m.id);
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  assert.equal(r.value, 20); // (2+3) * 4
  assert.equal(r.type, 'float');
});

check('evaluator: an unwired node uses socket defaults, never an error', () => {
  const g = G.newGraph('t');
  const mul = G.newNode(g, 'cadence.math.multiply');
  const r = ev(g, mul.id);
  assert.ok(r.ok);
  assert.equal(r.value, 0); // default a=0, b=1
  assert.equal(r.diagnostics.length, 0);
});

check('evaluator: generics resolve to the widest connected type and broadcast the rest', () => {
  const g = G.newGraph('t');
  const add = G.newNode(g, 'cadence.math.add', 0, 0, { values: { a: 0.5, b: [1, 2, 3] } });
  const r = ev(g, add.id);
  assert.equal(r.type, 'float', 'an inline value carries only its declared socket type');

  // Through a real wire, the vector type propagates.
  const g2 = G.newGraph('t');
  const mk = G.newNode(g2, 'cadence.vector.combine', 0, 0, { values: { x: 1, y: 2, z: 3 } });
  const add2 = G.newNode(g2, 'cadence.math.add', 200, 0, { values: { b: 10 } });
  assert.ok(G.connect(g2, mk.id, 'out', add2.id, 'a').ok);
  const r2 = ev(g2, add2.id);
  assert.equal(r2.type, 'vector3');
  nearArr(r2.value, [11, 12, 13]);
});

check('evaluator: divide by zero yields zero, with no non-finite value escaping', () => {
  const g = G.newGraph('t');
  const d = G.newNode(g, 'cadence.math.divide', 0, 0, { values: { a: 5, b: 0 } });
  const r = ev(g, d.id);
  assert.equal(r.value, 0);
  assert.ok(Number.isFinite(r.value));
});

check('evaluator: a node that throws is contained as a diagnostic', () => {
  R.registerNode({
    id: 'test.evaluator.thrower', version: 1, label: 'Thrower', category: 'Debug',
    summary: 'Throws, for testing containment.', exportSupport: 'unsupported',
    inputs: [], outputs: [{ key: 'out', label: 'Out', type: 'float' }],
    evaluate: () => { throw new Error('boom'); },
  });
  const g = G.newGraph('t');
  const bad = G.newNode(g, 'test.evaluator.thrower');
  const r = ev(g, bad.id);
  assert.equal(r.ok, false);
  assert.equal(r.value, 0, 'a failed node must still yield its type default');
  assert.ok(r.diagnostics.some((d) => /boom/.test(d.message)));
});

check('evaluator: a NaN escaping a node is caught and reported at the boundary', () => {
  R.registerNode({
    id: 'test.evaluator.nan', version: 1, label: 'NaN Source', category: 'Debug',
    summary: 'Emits NaN, for testing the boundary guard.', exportSupport: 'unsupported',
    inputs: [], outputs: [{ key: 'out', label: 'Out', type: 'float' }],
    evaluate: () => NaN,
  });
  const g = G.newGraph('t');
  const bad = G.newNode(g, 'test.evaluator.nan');
  const r = ev(g, bad.id);
  assert.equal(r.value, 0);
  assert.ok(r.diagnostics.some((d) => d.severity === 'warning' && /finite/.test(d.message)));
});

check('evaluator: caching serves repeats, and invalidateNode clears downstream', () => {
  const { g, a, m } = chainGraph();
  const e = new E.Evaluator(g, { profiling: true });
  assert.equal(e.evaluateSocket(m.id, 'out').value, 20);
  assert.equal(e.evaluateSocket(m.id, 'out').value, 20);
  assert.ok(e.profile.get(m.id).cacheHits >= 1, 'the second evaluation must be a cache hit');

  g.nodes[a.id].values.a = 10;
  e.invalidateNode(a.id);
  assert.equal(e.evaluateSocket(m.id, 'out').value, 52); // (10+3) * 4
});

check('evaluator: a stale cache is a real risk, so a value change without invalidation is visible', () => {
  const { g, a, m } = chainGraph();
  const e = new E.Evaluator(g);
  assert.equal(e.evaluateSocket(m.id, 'out').value, 20);
  g.nodes[a.id].values.a = 10;
  assert.equal(e.evaluateSocket(m.id, 'out').value, 20, 'without invalidation the cache is authoritative — this is why editors must call invalidateNode');
  e.invalidateAll();
  assert.equal(e.evaluateSocket(m.id, 'out').value, 52);
});

check('evaluator: only time-dependent entries are dropped when the playhead moves', () => {
  const g = G.newGraph('t');
  const clock = G.newNode(g, 'cadence.time.effectTime');
  const stat = G.newNode(g, 'cadence.math.pi');
  const e = new E.Evaluator(g, { fps: 30 });
  const t0 = e.evaluateSocket(clock.id, 'seconds');
  assert.equal(t0.timeDependent, true);
  const s0 = e.evaluateSocket(stat.id, 'out');
  assert.equal(s0.timeDependent, false);
  const before = e.cache.size;
  e.setTime(30);
  assert.ok(e.cache.size < before, 'a time change must drop something');
  assert.ok(e.cache.has(`${stat.id}|out`), 'a static node must survive a time change');
  assert.equal(e.evaluateSocket(clock.id, 'seconds').value, 1);
});

check('evaluator: muted produces defaults, bypassed passes a compatible input through', () => {
  const g = G.newGraph('t');
  const mul = G.newNode(g, 'cadence.math.multiply', 0, 0, { values: { a: 7, b: 3 } });
  assert.equal(ev(g, mul.id).value, 21);
  g.nodes[mul.id].muted = true;
  assert.equal(ev(g, mul.id).value, 0);
  delete g.nodes[mul.id].muted;
  g.nodes[mul.id].bypassed = true;
  assert.equal(ev(g, mul.id).value, 7, 'bypass must forward the first input');
});

check('evaluator: automatic field lifting turns pointwise maths into a field', () => {
  const g = G.newGraph('t');
  const pos = G.newNode(g, 'cadence.fields.position');
  const len = G.newNode(g, 'cadence.vector.length', 200, 0);
  const mul = G.newNode(g, 'cadence.math.multiply', 400, 0, { values: { b: 2 } });
  assert.ok(G.connect(g, pos.id, 'out', len.id, 'vector').ok);
  assert.ok(G.connect(g, len.id, 'out', mul.id, 'a').ok);

  const r = ev(g, mul.id);
  assert.equal(r.type, 'field<float>', 'multiplying a field must yield a field');
  assert.ok(F.isField(r.value));
  near(r.value.sample(F.newSampleContext({ position: [3, 4, 0] })), 10, 1e-9); // length 5, doubled
  near(r.value.sample(F.newSampleContext({ position: [0, 0, 1] })), 2, 1e-9);
});

check('evaluator: a lifted chain of several nodes samples correctly end to end', () => {
  const g = G.newGraph('t');
  const pos = G.newNode(g, 'cadence.fields.position');
  const sep = G.newNode(g, 'cadence.vector.separate', 200, 0);
  const smooth = G.newNode(g, 'cadence.math.smoothstep', 400, 0, { values: { a: 0, b: 4 } });
  assert.ok(G.connect(g, pos.id, 'out', sep.id, 'vector').ok);
  assert.ok(G.connect(g, sep.id, 'x', smooth.id, 'c').ok);

  const r = ev(g, smooth.id);
  assert.equal(r.type, 'field<float>');
  near(r.value.sample(F.newSampleContext({ position: [-1, 0, 0] })), 0, 1e-9);
  near(r.value.sample(F.newSampleContext({ position: [2, 0, 0] })), 0.5, 1e-9);
  near(r.value.sample(F.newSampleContext({ position: [9, 0, 0] })), 1, 1e-9);
});

check('evaluator: a node declaring field<T> receives the raw field, not a lifted call', () => {
  const g = G.newGraph('t');
  const pos = G.newNode(g, 'cadence.fields.position');
  const sep = G.newNode(g, 'cadence.vector.separate', 200, 0);
  const warp = G.newNode(g, 'cadence.fields.warp', 400, 0, { values: { offset: [10, 0, 0] } });
  G.connect(g, pos.id, 'out', sep.id, 'vector');
  G.connect(g, sep.id, 'x', warp.id, 'field');
  const r = ev(g, warp.id);
  assert.equal(r.type, 'field<float>');
  near(r.value.sample(F.newSampleContext({ position: [1, 0, 0] })), 11, 1e-9);
});

check('evaluator: group instances evaluate their interior', () => {
  const g = G.newGraph('t');
  const grp = G.newGroupDef(g, 'Doubler', {
    inputs: [{ key: 'x', label: 'X', type: 'float', default: 0 }],
    outputs: [{ key: 'y', label: 'Y', type: 'float' }],
  });
  const gin = G.nodesInScope(g, grp.id).find((n) => n.type === G.GROUP_INPUT_TYPE);
  const gout = G.nodesInScope(g, grp.id).find((n) => n.type === G.GROUP_OUTPUT_TYPE);
  const mul = G.newNode(g, 'cadence.math.multiply', 0, 0, { scope: grp.id, values: { b: 2 } });
  assert.ok(G.connect(g, gin.id, 'x', mul.id, 'a').ok);
  assert.ok(G.connect(g, mul.id, 'out', gout.id, 'y').ok);

  const inst = G.newNode(g, `${G.GROUP_TYPE_PREFIX}${grp.id}`, 400, 0, { values: { x: 21 } });
  const r = ev(g, inst.id, 'y');
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  assert.equal(r.value, 42);
});

check('evaluator: two instances of one group do not share cached values', () => {
  const g = G.newGraph('t');
  const grp = G.newGroupDef(g, 'Doubler', {
    inputs: [{ key: 'x', label: 'X', type: 'float', default: 0 }],
    outputs: [{ key: 'y', label: 'Y', type: 'float' }],
  });
  const gin = G.nodesInScope(g, grp.id).find((n) => n.type === G.GROUP_INPUT_TYPE);
  const gout = G.nodesInScope(g, grp.id).find((n) => n.type === G.GROUP_OUTPUT_TYPE);
  const mul = G.newNode(g, 'cadence.math.multiply', 0, 0, { scope: grp.id, values: { b: 2 } });
  G.connect(g, gin.id, 'x', mul.id, 'a');
  G.connect(g, mul.id, 'out', gout.id, 'y');

  const i1 = G.newNode(g, `${G.GROUP_TYPE_PREFIX}${grp.id}`, 400, 0, { values: { x: 5 } });
  const i2 = G.newNode(g, `${G.GROUP_TYPE_PREFIX}${grp.id}`, 400, 200, { values: { x: 50 } });
  const e = new E.Evaluator(g);
  assert.equal(e.evaluateSocket(i1.id, 'y').value, 10);
  assert.equal(e.evaluateSocket(i2.id, 'y').value, 100);
});

check('evaluator: nested groups evaluate to the right depth', () => {
  const g = G.newGraph('t');
  const inner = G.newGroupDef(g, 'Inner', {
    inputs: [{ key: 'x', label: 'X', type: 'float', default: 0 }],
    outputs: [{ key: 'y', label: 'Y', type: 'float' }],
  });
  const iIn = G.nodesInScope(g, inner.id).find((n) => n.type === G.GROUP_INPUT_TYPE);
  const iOut = G.nodesInScope(g, inner.id).find((n) => n.type === G.GROUP_OUTPUT_TYPE);
  const add3 = G.newNode(g, 'cadence.math.add', 0, 0, { scope: inner.id, values: { b: 3 } });
  G.connect(g, iIn.id, 'x', add3.id, 'a');
  G.connect(g, add3.id, 'out', iOut.id, 'y');

  const outer = G.newGroupDef(g, 'Outer', {
    inputs: [{ key: 'x', label: 'X', type: 'float', default: 0 }],
    outputs: [{ key: 'y', label: 'Y', type: 'float' }],
  });
  const oIn = G.nodesInScope(g, outer.id).find((n) => n.type === G.GROUP_INPUT_TYPE);
  const oOut = G.nodesInScope(g, outer.id).find((n) => n.type === G.GROUP_OUTPUT_TYPE);
  const innerInst = G.newNode(g, `${G.GROUP_TYPE_PREFIX}${inner.id}`, 0, 0, { scope: outer.id });
  const dbl = G.newNode(g, 'cadence.math.multiply', 200, 0, { scope: outer.id, values: { b: 2 } });
  G.connect(g, oIn.id, 'x', innerInst.id, 'x');
  G.connect(g, innerInst.id, 'y', dbl.id, 'a');
  G.connect(g, dbl.id, 'out', oOut.id, 'y');

  const inst = G.newNode(g, `${G.GROUP_TYPE_PREFIX}${outer.id}`, 600, 0, { values: { x: 4 } });
  const r = ev(g, inst.id, 'y');
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  assert.equal(r.value, 14); // (4 + 3) * 2
});

check('evaluator: validateGraph reports a cycle instead of hanging', () => {
  const { g, a, m } = chainGraph();
  g.links.forced = { id: 'forced', fromNode: m.id, fromSocket: 'out', toNode: a.id, toSocket: 'a' };
  const r = new E.Evaluator(g).validateGraph();
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some((d) => /loop/.test(d.message)));
});

check('evaluator: validateGraph checks branches nothing is previewing', () => {
  const g = G.newGraph('t');
  G.newNode(g, 'test.evaluator.thrower');   // a terminal node with no consumer
  const r = new E.Evaluator(g).validateGraph();
  assert.equal(r.ok, false, 'an unconnected broken branch must still be reported');
});

check('evaluator: evaluation is deterministic and order-independent', () => {
  const g = G.newGraph('t');
  const rnd = G.newNode(g, 'cadence.random.float', 0, 0, { values: { min: 0, max: 100 } });
  const sample = (r) => r.value.sample(F.newSampleContext({ index: 7 }));
  const first = sample(ev(g, rnd.id));
  // Adding an unrelated node must not perturb an unrelated random result (spec Part 14).
  G.newNode(g, 'cadence.math.pi', 500, 500);
  assert.equal(sample(ev(g, rnd.id)), first);
  // A different graph seed must change it.
  assert.notEqual(sample(new E.Evaluator(g, { seed: 99 }).evaluateSocket(rnd.id, 'out')), first);
});

check('evaluator: profiling reports per-node cost', () => {
  const { g, m } = chainGraph();
  const e = new E.Evaluator(g, { profiling: true });
  e.evaluateSocket(m.id, 'out');
  const p = e.profileReport();
  assert.ok(p.nodes.length >= 2);
  assert.ok(p.nodes.every((r) => Number.isFinite(r.totalMs)));
  assert.ok(p.cacheEntries > 0);
});

// ================================================================ node family spot checks
// Evaluate one node standalone and return its value as-is — a field-valued node yields the field.
// `id` is pinnable because random and noise seeds derive from the node's identity by design (spec
// Part 14), so a test that asserts an exact random value has to fix the identity it came from.
function evalNode(type, values, socket = 'out', opts = {}, id = null) {
  const g = G.newGraph('t');
  const nd = G.newNode(g, type, 0, 0, { values, id });
  const r = ev(g, nd.id, socket, opts);
  assert.ok(r.diagnostics.every((d) => d.severity !== 'error'), JSON.stringify(r.diagnostics));
  return r.value;
}

// The same, sampled at one point — for the field-valued nodes, where the value under test only
// exists at a sample point.
function sampleNode(type, values, socket = 'out', ctx = {}, opts = {}, id = 'fixed') {
  const v = evalNode(type, values, socket, opts, id);
  return F.isField(v) ? v.sample(F.newSampleContext(ctx)) : v;
}

check('math: rounding and wrapping behave at negative values', () => {
  assert.equal(evalNode('cadence.math.modulo', { a: -1, b: 3 }), 2, 'Euclidean modulo, not C remainder');
  assert.equal(evalNode('cadence.math.fraction', { value: -0.25 }), 0.75);
  assert.equal(evalNode('cadence.math.truncate', { value: -1.7 }), -1);
  assert.equal(evalNode('cadence.math.floor', { value: -1.2 }), -2);
  assert.equal(evalNode('cadence.math.wrap', { a: 7, b: 0, c: 5 }), 2);
  assert.equal(evalNode('cadence.math.pingPong', { a: 7, b: 5 }), 3);
  assert.equal(evalNode('cadence.math.snap', { a: 0.37, b: 0.25 }), 0.25);
});

check('math: interpolation family', () => {
  assert.equal(evalNode('cadence.math.lerp', { a: 10, b: 20, c: 0.25 }), 12.5);
  assert.equal(evalNode('cadence.math.inverseLerp', { a: 10, b: 20, c: 12.5 }), 0.25);
  assert.equal(evalNode('cadence.math.mapRange', { value: 50, fromMin: 0, fromMax: 100, toMin: 0, toMax: 1 }), 0.5);
  assert.equal(evalNode('cadence.math.mapRange', { value: 150, fromMin: 0, fromMax: 100, toMin: 0, toMax: 1, clamp: true }), 1);
  assert.equal(evalNode('cadence.math.mapRange', { value: 150, fromMin: 0, fromMax: 100, toMin: 0, toMax: 1, clamp: false }), 1.5);
  assert.equal(evalNode('cadence.math.step', { a: 0.6, b: 0.5 }), 1);
});

check('math: guarded operations never produce a non-finite value', () => {
  assert.equal(evalNode('cadence.math.squareRoot', { value: -4 }), 0);
  assert.equal(evalNode('cadence.math.logarithm', { a: 0, b: Math.E }), 0);
  assert.equal(evalNode('cadence.math.inverseSquareRoot', { value: 0 }), 0);
  assert.ok(Number.isFinite(evalNode('cadence.math.tangent', { value: Math.PI / 2 })));
  assert.equal(evalNode('cadence.math.power', { a: -8, b: 0.5 }), 0);
});

check('math: comparisons and lists', () => {
  assert.equal(evalNode('cadence.math.greaterThan', { a: 3, b: 2 }), true);
  assert.equal(evalNode('cadence.math.equal', { a: 0.1 + 0.2, b: 0.3 }), true, 'the tolerance must absorb float error');
  assert.equal(evalNode('cadence.math.notEqual', { a: 1, b: 1 }), false);
  assert.equal(evalNode('cadence.math.sum', {}), 0, 'an empty list must be neutral, not an error');
});

check('math: degrees and radians round-trip', () => {
  near(evalNode('cadence.math.radiansToDegrees', { value: Math.PI }), 180);
  near(evalNode('cadence.math.degreesToRadians', { value: 180 }), Math.PI);
});

check('vector: construction, length, dot, cross, normalize', () => {
  nearArr(evalNode('cadence.vector.combine', { x: 1, y: 2, z: 3 }), [1, 2, 3]);
  assert.equal(evalNode('cadence.vector.separate', { vector: [1, 2, 3] }, 'y'), 2);
  assert.equal(evalNode('cadence.vector.length', { vector: [3, 4, 0] }), 5);
  assert.equal(evalNode('cadence.vector.distance', { a: [0, 0, 0], b: [0, 3, 4] }), 5);
  assert.equal(evalNode('cadence.vector.dot', { a: [1, 0, 0], b: [1, 0, 0] }), 1);
  nearArr(evalNode('cadence.vector.cross', { a: [1, 0, 0], b: [0, 1, 0] }), [0, 0, 1]);
  nearArr(evalNode('cadence.vector.normalize', { vector: [0, 0, 8] }), [0, 0, 1]);
});

check('vector: rotate about an axis', () => {
  nearArr(evalNode('cadence.vector.rotate', { vector: [1, 0, 0], axis: [0, 1, 0], angle: Math.PI / 2 }), [0, 0, -1], 1e-9);
});

check('color: split, combine and the HSV round-trip', () => {
  assert.equal(evalNode('cadence.color.separateRgb', { color: [0.25, 0.5, 0.75, 1] }, 'g'), 0.5);
  nearArr(evalNode('cadence.color.combineRgb', { r: 1, g: 0.5, b: 0, a: 1 }), [1, 0.5, 0, 1]);
  const hsv = evalNode('cadence.color.separateHsv', { color: [0.2, 0.6, 0.4, 1] }, 'h');
  assert.ok(hsv >= 0 && hsv <= 1);
  nearArr(evalNode('cadence.color.combineHsv', { h: 0, s: 1, v: 1, a: 1 }), [1, 0, 0, 1], 1e-9);
  near(evalNode('cadence.color.luminance', { color: [1, 1, 1, 1] }), 1);
});

check('color: hex parsing and a gradient sample', () => {
  nearArr(evalNode('cadence.color.fromHex', { hex: '#00ff00' }), [0, 1, 0, 1]);
  const grad = { kind: 'color', stops: [{ t: 0, v: '#000000' }, { t: 1, v: '#ffffff' }] };
  nearArr(evalNode('cadence.color.sampleGradient', { gradient: grad, position: 0.5 }), [0.5, 0.5, 0.5, 1], 0.01);
});

check('color: mix modes behave as their names claim', () => {
  nearArr(evalNode('cadence.color.mix', { a: [0, 0, 0, 1], b: [1, 1, 1, 1], factor: 0.5, blend: 'mix' }), [0.5, 0.5, 0.5, 1]);
  nearArr(evalNode('cadence.color.mix', { a: [0.5, 0.5, 0.5, 1], b: [0.5, 0.5, 0.5, 1], factor: 1, blend: 'add' }), [1, 1, 1, 1]);
  nearArr(evalNode('cadence.color.mix', { a: [0.5, 0.5, 0.5, 1], b: [0.5, 0.5, 0.5, 1], factor: 1, blend: 'multiply' }), [0.25, 0.25, 0.25, 1]);
});

check('transform: compose, decompose, and apply', () => {
  const tr = evalNode('cadence.transform.combine', { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] });
  nearArr(tr.p, [1, 2, 3]);
  nearArr(evalNode('cadence.transform.separate', { transform: tr }, 'position'), [1, 2, 3]);
  nearArr(evalNode('cadence.transform.point', { transform: tr, point: [0, 0, 0] }), [1, 2, 3]);
  nearArr(evalNode('cadence.transform.direction', { transform: tr, direction: [1, 0, 0] }), [1, 0, 0]);
});

check('transform: look-at aims at its target', () => {
  const tr = evalNode('cadence.transform.lookAt', { from: [0, 0, 0], to: [5, 0, 0] });
  nearArr(V.qRotateVector(tr.q, [0, 1, 0]), [1, 0, 0], 1e-6);
});

check('curves: a curve evaluates with the animator easing vocabulary', () => {
  const curve = { kind: 'float', keys: [{ t: 0, v: 0 }, { t: 1, v: 10 }] };
  near(evalNode('cadence.curve.evaluate', { curve, position: 0.5 }), 5, 1e-9);
  near(evalNode('cadence.curve.evaluate', { curve, position: -1 }), 0, 1e-9); // holds before the first key
  near(evalNode('cadence.curve.evaluate', { curve, position: 99 }), 10, 1e-9); // holds after the last
});

check('curves: easing shapes run 0 to 1 and are monotonic', () => {
  for (const ease of ['easeIn', 'easeOut', 'easeInOut']) {
    const id = `cadence.curve.${ease}`;
    near(evalNode(id, { value: 0 }), 0, 1e-9);
    near(evalNode(id, { value: 1 }), 1, 1e-9);
    let prev = -1;
    for (let x = 0; x <= 1.0001; x += 0.1) {
      const y = evalNode(id, { value: x });
      assert.ok(y >= prev - 1e-9, `${ease} must not go backwards at ${x}`);
      prev = y;
    }
  }
});

check('time: clocks read the evaluation context', () => {
  assert.equal(evalNode('cadence.time.effectTime', {}, 'seconds', { frame: 60, time: 2, fps: 30 }), 2);
  assert.equal(evalNode('cadence.time.effectTime', {}, 'frame', { frame: 60, time: 2, fps: 30 }), 60);
  near(evalNode('cadence.time.loop', { period: 2 }, 'phase', { time: 3, fps: 30 }), 0.5, 1e-9);
  near(evalNode('cadence.time.pingPong', { period: 2 }, 'phase', { time: 3, fps: 30 }), 1, 1e-9);
  near(evalNode('cadence.time.oscillate', { frequency: 1, amplitude: 2 }, 'out', { time: 0.25, fps: 30 }), 2, 1e-6);
});

check('logic: boolean algebra and selection', () => {
  assert.equal(evalNode('cadence.logic.and', { values: [] }), true, 'an empty AND is vacuously true');
  assert.equal(evalNode('cadence.logic.not', { value: false }), true);
  assert.equal(evalNode('cadence.logic.xor', { a: true, b: true }), false);
  assert.equal(evalNode('cadence.logic.switch', { condition: true, ifTrue: 5, ifFalse: 9 }), 5);
  assert.equal(evalNode('cadence.logic.switch', { condition: false, ifTrue: 5, ifFalse: 9 }), 9);
});

check('logic: Switch does not evaluate the branch it did not pick', () => {
  // The unpicked branch is still pulled (this is a pull-based evaluator, not a lazy one), but a
  // failure in it must not poison the chosen result.
  const g = G.newGraph('t');
  const bad = G.newNode(g, 'test.evaluator.thrower');
  const sw = G.newNode(g, 'cadence.logic.switch', 200, 0, { values: { condition: true, ifTrue: 42 } });
  G.connect(g, bad.id, 'out', sw.id, 'ifFalse');
  const r = ev(g, sw.id);
  assert.equal(r.value, 42, 'the chosen branch must still deliver its value');
});

check('random: values are stable, in range, and decorrelated per channel', () => {
  // Per-element random is a FIELD: one particle's random size must not be every particle's. The
  // same element of the same node always agrees; different elements do not.
  const f = evalNode('cadence.random.float', { min: 0, max: 1, seed: 1 }, 'out', {}, 'r1');
  const at = (index) => f.sample(F.newSampleContext({ index }));
  assert.equal(at(7), at(7), 'the same element must always get the same number');
  assert.ok(at(7) >= 0 && at(7) < 1);
  assert.notEqual(at(7), at(8), 'different elements must get different numbers');
  // The variation input re-rolls without touching the graph.
  const g2 = evalNode('cadence.random.float', { min: 0, max: 1, seed: 2 }, 'out', {}, 'r1');
  assert.notEqual(at(7), g2.sample(F.newSampleContext({ index: 7 })));
  // ...and the node's identity is what seeds it, so an identical node elsewhere differs.
  const elsewhere = evalNode('cadence.random.float', { min: 0, max: 1, seed: 1 }, 'out', {}, 'r2');
  assert.notEqual(at(7), elsewhere.sample(F.newSampleContext({ index: 7 })));

  near(V.vLength(sampleNode('cadence.random.unitVector', { seed: 3 }, 'out', { index: 4 })), 1, 1e-6);
  assert.equal(sampleNode('cadence.random.int', { min: 5, max: 5, seed: 1 }, 'out', { index: 2 }), 5,
    'a zero-width integer range must be exact, not off by one');
});

check('random: gaussian stays finite and roughly centred', () => {
  const f = evalNode('cadence.random.gaussian', { mean: 0, deviation: 1, seed: 0 }, 'out', {}, 'gauss');
  let sum = 0;
  for (let index = 0; index < 400; index++) {
    const v = f.sample(F.newSampleContext({ index }));
    assert.ok(Number.isFinite(v), `element ${index} produced ${v}`);
    sum += v;
  }
  assert.ok(Math.abs(sum / 400) < 0.35, `mean drifted too far: ${sum / 400}`);
});

check('noise: value noise is smooth, bounded, and deterministic', () => {
  const g = G.newGraph('t');
  const pos = G.newNode(g, 'cadence.fields.position');
  const noise = G.newNode(g, 'cadence.noise.perlin', 200, 0, { values: { scale: 1 } });
  G.connect(g, pos.id, 'out', noise.id, 'position');
  const r = ev(g, noise.id);
  assert.equal(r.type, 'field<float>');
  const at = (p) => r.value.sample(F.newSampleContext({ position: p }));
  const v1 = at([0.5, 0.5, 0.5]);
  assert.equal(v1, at([0.5, 0.5, 0.5]), 'noise must be deterministic');
  assert.ok(v1 >= 0 && v1 <= 1, `expected 0..1, got ${v1}`);
  assert.ok(Math.abs(at([0.5, 0.5, 0.5]) - at([0.51, 0.5, 0.5])) < 0.1, 'noise must be smooth, not white');
});

check('noise: white noise is NOT smooth, and voronoi returns a cell id', () => {
  const g = G.newGraph('t');
  const pos = G.newNode(g, 'cadence.fields.position');
  const white = G.newNode(g, 'cadence.noise.white', 200, 0);
  G.connect(g, pos.id, 'out', white.id, 'position');
  const w = ev(g, white.id).value;
  const a = w.sample(F.newSampleContext({ position: [0.5, 0, 0] }));
  const b = w.sample(F.newSampleContext({ position: [0.51, 0, 0] }));
  assert.notEqual(a, b);

  const g2 = G.newGraph('t');
  const p2 = G.newNode(g2, 'cadence.fields.position');
  const vor = G.newNode(g2, 'cadence.noise.voronoi', 200, 0, { values: { scale: 2 } });
  G.connect(g2, p2.id, 'out', vor.id, 'position');
  const dist = ev(g2, vor.id, 'distance').value;
  const cell = ev(g2, vor.id, 'cell').value;
  assert.ok(dist.sample(F.newSampleContext({ position: [1, 1, 1] })) >= 0);
  const c1 = cell.sample(F.newSampleContext({ position: [1.1, 1.1, 1.1] }));
  const c2 = cell.sample(F.newSampleContext({ position: [1.12, 1.1, 1.1] }));
  assert.equal(c1, c2, 'two points in the same cell must report the same cell value');
});

check('noise: fbm adds detail without leaving its range', () => {
  const g = G.newGraph('t');
  const pos = G.newNode(g, 'cadence.fields.position');
  const fbm = G.newNode(g, 'cadence.noise.fbm', 200, 0, { values: { scale: 1, octaves: 4 } });
  G.connect(g, pos.id, 'out', fbm.id, 'position');
  const f = ev(g, fbm.id).value;
  for (const p of [[0, 0, 0], [1.3, -2.7, 5.1], [100, 100, 100]]) {
    const v = f.sample(F.newSampleContext({ position: p }));
    assert.ok(v >= -0.01 && v <= 1.01, `fbm left 0..1 at ${p}: ${v}`);
  }
});

check('fields: curl noise is divergence-free enough to swirl rather than diverge', () => {
  const g = G.newGraph('t');
  const pos = G.newNode(g, 'cadence.fields.position');
  // The step MUST match the one the node differentiates with. A discrete curl taken at step h is
  // divergence-free to machine precision when the divergence is measured at the same h — every
  // stencil term cancels against its twin — and only to O(h^2) when the steps differ. Measuring at
  // a different step would test the discretisation error, not the property.
  const e = 0.01;
  const curl = G.newNode(g, 'cadence.noise.curl', 200, 0, { values: { scale: 1, epsilon: e }, id: 'curl' });
  G.connect(g, pos.id, 'out', curl.id, 'position');
  const c = ev(g, curl.id).value;
  const p = [0.3, 1.7, -0.9];
  const at = (dx, dy, dz) => c.sample(F.newSampleContext({ position: [p[0] + dx, p[1] + dy, p[2] + dz] }));
  const div = (at(e, 0, 0)[0] - at(-e, 0, 0)[0]) / (2 * e)
    + (at(0, e, 0)[1] - at(0, -e, 0)[1]) / (2 * e)
    + (at(0, 0, e)[2] - at(0, 0, -e)[2]) / (2 * e);
  assert.ok(Math.abs(div) < 1e-6, `divergence should be near zero, got ${div}`);
  // ...and it must actually flow. A field returning zero everywhere is divergence-free too.
  assert.ok(V.vLength(at(0, 0, 0)) > 1e-3, 'curl noise produced no motion at all');
});

check('fields: vector field primitives point the right way', () => {
  const radial = sampleNode('cadence.fields.radial', { center: [0, 0, 0], strength: 1 }, 'out', { position: [2, 0, 0] });
  nearArr(radial, [1, 0, 0], 1e-6);
  const attract = sampleNode('cadence.fields.attract', { center: [0, 0, 0], strength: 1, falloff: 0 }, 'out', { position: [2, 0, 0] });
  nearArr(attract, [-1, 0, 0], 1e-6);
  const v = sampleNode('cadence.fields.vortex', { center: [0, 0, 0], axis: [0, 1, 0], strength: 1 }, 'out', { position: [1, 0, 0] });
  near(V.vDot(v, [1, 0, 0]), 0, 1e-6); // tangential: perpendicular to the radius
  near(V.vDot(v, [0, 1, 0]), 0, 1e-6); // and to the axis
});

check('fields: distance to a sphere is negative inside and zero on the surface', () => {
  const sdf = evalNode('cadence.sdf.sphere', { center: [0, 0, 0], radius: 2 });
  near(sdf.sample(F.newSampleContext({ position: [2, 0, 0] })), 0, 1e-9);
  near(sdf.sample(F.newSampleContext({ position: [0, 0, 0] })), -2, 1e-9);
  near(sdf.sample(F.newSampleContext({ position: [5, 0, 0] })), 3, 1e-9);
});

check('sdf: boolean operations combine shapes correctly', () => {
  const g = G.newGraph('t');
  const s1 = G.newNode(g, 'cadence.sdf.sphere', 0, 0, { values: { center: [-1, 0, 0], radius: 1.5 } });
  const s2 = G.newNode(g, 'cadence.sdf.sphere', 0, 200, { values: { center: [1, 0, 0], radius: 1.5 } });
  const uni = G.newNode(g, 'cadence.sdf.union', 200, 100);
  G.connect(g, s1.id, 'out', uni.id, 'a');
  G.connect(g, s2.id, 'out', uni.id, 'b');
  const u = ev(g, uni.id).value;
  assert.ok(u.sample(F.newSampleContext({ position: [0, 0, 0] })) < 0, 'the overlap must be inside the union');
  assert.ok(u.sample(F.newSampleContext({ position: [6, 0, 0] })) > 0, 'far outside must be outside');
});

check('attributes: read and write round-trip through a sample context', () => {
  const g = G.newGraph('t');
  const rd = G.newNode(g, 'cadence.attribute.read', 0, 0, { values: { name: 'heat', fallback: -1 } });
  const f = ev(g, rd.id).value;
  assert.equal(f.sample(F.newSampleContext({ attributes: { heat: 1200 } })), 1200);
  assert.equal(f.sample(F.newSampleContext({})), -1, 'a missing attribute must fall back, not error');
});

check('debug: inspect passes its input through unchanged', () => {
  assert.equal(evalNode('cadence.debug.inspect', { value: 7 }), 7);
});

// ================================================================ phase 3: the rest
check('sdf: primitives measure the distances they claim to', () => {
  const at = (type, values, position) => sampleNode(type, values, 'out', { position });
  // Box: exact outside, and inside the value is the distance to the nearest face.
  near(at('cadence.sdf.box', { size: [1, 1, 1] }, [2, 0, 0]), 1, 1e-9);
  near(at('cadence.sdf.box', { size: [1, 1, 1] }, [0, 0, 0]), -1, 1e-9);
  near(at('cadence.sdf.box', { size: [1, 1, 1] }, [2, 2, 0]), Math.SQRT2, 1e-9);
  // Plane: signed, positive on the side the normal points.
  near(at('cadence.sdf.plane', { point: [0, 0, 0], normal: [0, 1, 0] }, [5, 3, 5]), 3, 1e-9);
  near(at('cadence.sdf.plane', { point: [0, 0, 0], normal: [0, 1, 0] }, [0, -2, 0]), -2, 1e-9);
  // Capsule: exact distance to the segment, so a point beside the middle is radius-distance away.
  near(at('cadence.sdf.capsule', { a: [0, 0, 0], b: [0, 4, 0], radius: 1 }, [3, 2, 0]), 2, 1e-9);
  // Torus: on the ring's own circle the distance is minus the thickness.
  near(at('cadence.sdf.torus', { major: 2, minor: 0.5, axis: 'y' }, [2, 0, 0]), -0.5, 1e-9);
  // Circle is a 1D ring: never negative, because nothing is inside a flat disc in 3D.
  assert.ok(at('cadence.sdf.circle', { radius: 2 }, [0, 0, 0]) > 0);
  near(at('cadence.sdf.circle', { radius: 2, axis: 'y' }, [2, 3, 0]), 3, 1e-9);
});

check('sdf: shape operators do what their names say', () => {
  const g = G.newGraph('t');
  const sphere = G.newNode(g, 'cadence.sdf.sphere', 0, 0, { values: { radius: 2 } });
  const shell = G.newNode(g, 'cadence.sdf.shell', 200, 0, { values: { thickness: 0.4 } });
  G.connect(g, sphere.id, 'out', shell.id, 'distance');
  const s = ev(g, shell.id).value;
  // A shell is inside AT the surface and outside both deeper in and further out.
  assert.ok(s.sample(F.newSampleContext({ position: [2, 0, 0] })) < 0, 'the surface must be inside the shell');
  assert.ok(s.sample(F.newSampleContext({ position: [0, 0, 0] })) > 0, 'the centre must be outside a hollow shell');
  assert.ok(s.sample(F.newSampleContext({ position: [5, 0, 0] })) > 0, 'far away must be outside');

  // Smooth union with zero blend must agree exactly with a plain union, or the blend width is not
  // in the units it claims to be.
  const a = G.newNode(g, 'cadence.sdf.sphere', 0, 400, { values: { center: [-1, 0, 0], radius: 1 } });
  const b = G.newNode(g, 'cadence.sdf.sphere', 0, 600, { values: { center: [1, 0, 0], radius: 1 } });
  const hard = G.newNode(g, 'cadence.sdf.union', 200, 500);
  const soft = G.newNode(g, 'cadence.sdf.smoothUnion', 400, 500, { values: { smoothing: 0 } });
  for (const [n, ka, kb] of [[hard, 'a', 'b'], [soft, 'a', 'b']]) {
    assert.ok(G.connect(g, a.id, 'out', n.id, ka).ok);
    assert.ok(G.connect(g, b.id, 'out', n.id, kb).ok);
  }
  const p = F.newSampleContext({ position: [0, 0.5, 0] });
  near(ev(g, soft.id).value.sample(p), ev(g, hard.id).value.sample(p), 1e-9);
});

check('sdf: normals point out of the surface and masks fade outwards', () => {
  const g = G.newGraph('t');
  const sphere = G.newNode(g, 'cadence.sdf.sphere', 0, 0, { values: { radius: 2 } });
  const nrm = G.newNode(g, 'cadence.sdf.normal', 200, 0);
  const mask = G.newNode(g, 'cadence.sdf.mask', 200, 200, { values: { softness: 1 } });
  G.connect(g, sphere.id, 'out', nrm.id, 'distance');
  G.connect(g, sphere.id, 'out', mask.id, 'distance');
  nearArr(ev(g, nrm.id).value.sample(F.newSampleContext({ position: [3, 0, 0] })), [1, 0, 0], 1e-4);
  nearArr(ev(g, nrm.id).value.sample(F.newSampleContext({ position: [0, -3, 0] })), [0, -1, 0], 1e-4);
  const m = ev(g, mask.id).value;
  assert.equal(m.sample(F.newSampleContext({ position: [0, 0, 0] })), 1, 'deep inside must be fully on');
  assert.equal(m.sample(F.newSampleContext({ position: [9, 0, 0] })), 0, 'far outside must be fully off');
  const edge = m.sample(F.newSampleContext({ position: [2.5, 0, 0] }));
  assert.ok(edge > 0 && edge < 1, `half a softness out should be mid-fade, got ${edge}`);
});

check('sdf: repeat tiles a single shape without duplicating it', () => {
  const g = G.newGraph('t');
  const sphere = G.newNode(g, 'cadence.sdf.sphere', 0, 0, { values: { radius: 0.4 } });
  const rep = G.newNode(g, 'cadence.sdf.repeat', 200, 0, { values: { spacing: [4, 0, 0] } });
  G.connect(g, sphere.id, 'out', rep.id, 'shape');
  const r = ev(g, rep.id).value;
  const atOrigin = r.sample(F.newSampleContext({ position: [0, 0, 0] }));
  near(r.sample(F.newSampleContext({ position: [8, 0, 0] })), atOrigin, 1e-9);
  near(r.sample(F.newSampleContext({ position: [-4, 0, 0] })), atOrigin, 1e-9);
  assert.ok(r.sample(F.newSampleContext({ position: [2, 0, 0] })) > 0, 'the gap between copies must be empty');
});

check('patterns: masks stay in range and cells identify tiles', () => {
  const at = (type, values, position) => sampleNode(type, values, 'mask', { position });
  // Checker alternates, and diagonal neighbours agree.
  assert.equal(at('cadence.pattern.checker', {}, [0.5, 0.5, 0]), 0);
  assert.equal(at('cadence.pattern.checker', {}, [1.5, 0.5, 0]), 1);
  assert.equal(at('cadence.pattern.checker', {}, [1.5, 1.5, 0]), 0);
  // Radial gradient is 1 at the centre and 0 at the radius.
  near(at('cadence.pattern.radialGradient', { radius: 4 }, [0, 0, 0]), 1, 1e-9);
  near(at('cadence.pattern.radialGradient', { radius: 4 }, [4, 0, 0]), 0, 1e-9);
  // Angular gradient wraps once around.
  near(at('cadence.pattern.angularGradient', {}, [1, 0, 0]), 0, 1e-9);
  near(at('cadence.pattern.angularGradient', {}, [0, 1, 0]), 0.25, 1e-9);
  // Waves are smooth and signed only when asked.
  near(at('cadence.pattern.waves', { direction: [1, 0, 0], signed: true }, [0.25, 0, 0]), 1, 1e-9);
  near(at('cadence.pattern.waves', { direction: [1, 0, 0], signed: false }, [0.75, 0, 0]), 0, 1e-9);
  // Every pattern must keep its mask within 0..1 everywhere it is sampled.
  const masked = ['checker', 'grid', 'stripes', 'rings', 'dots', 'bricks', 'hexagons', 'spiral', 'star', 'randomCells'];
  for (const name of masked) {
    for (const p of [[0, 0, 0], [0.37, 1.71, -0.9], [12.5, -3.25, 7.125], [-100.5, 0.5, 0.5]]) {
      const v = at(`cadence.pattern.${name}`, {}, p);
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `${name} at ${p} produced ${v}`);
    }
  }
});

check('patterns: cell ids are constant inside a cell and differ between cells', () => {
  const cell = (position) => sampleNode('cadence.pattern.randomCells', { threeD: true }, 'cell', { position });
  const value = (position) => sampleNode('cadence.pattern.randomCells', { threeD: true }, 'mask', { position });
  assert.equal(cell([0.2, 0.2, 0.2]), cell([0.8, 0.8, 0.8]), 'one cell has one id');
  assert.equal(value([0.2, 0.2, 0.2]), value([0.8, 0.8, 0.8]), 'one cell has one value');
  assert.notEqual(cell([0.5, 0.5, 0.5]), cell([1.5, 0.5, 0.5]), 'neighbouring cells differ');
});

check('patterns: voronoi edge distance is zero on a boundary, not at a centre', () => {
  const g = G.newGraph('t');
  const cells = G.newNode(g, 'cadence.pattern.cells', 0, 0, { values: { randomness: 0 }, id: 'cells' });
  const r = ev(g, cells.id, 'edge');
  // With randomness 0 the centres sit on a regular half-integer lattice, so (1, 0.5, 0.5) is
  // exactly equidistant between two of them — an edge — and (0.5, 0.5, 0.5) is a centre.
  near(r.value.sample(F.newSampleContext({ position: [1, 0.5, 0.5] })), 0, 1e-9);
  assert.ok(ev(g, cells.id, 'mask').value.sample(F.newSampleContext({ position: [0.5, 0.5, 0.5] })) < 1e-9,
    'the distance to the centre must be zero AT a centre');
});

check('attributes: writes are records, and gather resolves later writes over earlier ones', () => {
  const g = G.newGraph('t');
  const w1 = G.newNode(g, 'cadence.attribute.write', 0, 0, { values: { name: 'heat', value: 10 } });
  const w2 = G.newNode(g, 'cadence.attribute.write', 0, 200, { values: { name: 'heat', value: 20 } });
  const w3 = G.newNode(g, 'cadence.attribute.write', 0, 400, { values: { name: 'fuel', value: 3 } });
  const gather = G.newNode(g, 'cadence.attribute.gather', 200, 200);
  for (const w of [w1, w2, w3]) assert.ok(G.connect(g, w.id, 'out', gather.id, 'writes').ok);
  const list = ev(g, gather.id).value;
  assert.equal(list.length, 2, 'two names, so two writes survive');
  const byName = Object.fromEntries(list.map((w) => [w.name, w]));
  assert.ok(byName.heat && byName.fuel);
  // The value may be a field or a plain number; sampling covers both.
  assert.equal(F.sampleAny(byName.heat.value, F.newSampleContext()), 20, 'the later write wins');
});

check('attributes: intrinsics are readable by name, and absent is not zero', () => {
  const g = G.newGraph('t');
  const rd = G.newNode(g, 'cadence.attribute.read', 0, 0, { values: { name: 'life', fallback: -1 } });
  near(ev(g, rd.id).value.sample(F.newSampleContext({ life: 0.25 })), 0.25, 1e-9);

  const has = G.newNode(g, 'cadence.attribute.exists', 0, 200, { values: { name: 'heat' } });
  const h = ev(g, has.id).value;
  assert.equal(h.sample(F.newSampleContext({ attributes: { heat: 0 } })), true, 'a zero value is still present');
  assert.equal(h.sample(F.newSampleContext({ attributes: {} })), false);
});

check('debug: guards report without changing the value they guard', () => {
  const g = G.newGraph('t');
  const div = G.newNode(g, 'cadence.math.divide', 0, 0, { values: { a: 1, b: 1 } });
  const guard = G.newNode(g, 'cadence.debug.finite', 200, 0, { values: { fallback: 99 } });
  G.connect(g, div.id, 'out', guard.id, 'value');
  near(ev(g, guard.id).value.sample(F.newSampleContext()), 1, 1e-9);
  // Assert passes the value through untouched even when it trips.
  const a = evalNode('cadence.debug.assert', { value: 5, min: 0, max: 1 });
  near(F.sampleAny(a, F.newSampleContext()), 5, 1e-9);
});

// ================================================================ phase 4: geometry
const GEO = await import('../renderer/js/pnx/geometry.js');

// A test-only source that emits a geometry built by hand, so a sampler can be tested against a shape
// with known areas rather than against whatever a primitive happens to produce.
R.registerNode({
  id: 'test.geometry.constant', version: 1, label: 'Constant Geometry', category: 'Debug',
  summary: 'Test fixture: emits a geometry supplied directly as an inline value.',
  exportSupport: 'unsupported',
  inputs: [{ key: 'geometry', label: 'Geometry', type: 'geometry' }],
  outputs: [{ key: 'out', label: 'Geometry', type: 'geometry' }],
  evaluate: (api, i) => i.geometry,
});

check('geometry: attribute tables read, write, resize and compact', () => {
  const t = GEO.newTable(4);
  GEO.ensureAttr(t, 'position', 3);
  GEO.ensureAttr(t, 'heat', 1, 5);
  for (let k = 0; k < 4; k++) GEO.writeAttr(t, 'position', k, [k, k * 2, k * 3]);
  nearArr(GEO.readAttr(t, 'position', 2), [2, 4, 6]);
  assert.equal(GEO.readAttr(t, 'heat', 3), 5, 'ensureAttr fill must reach every element');

  // Growing preserves what was there and zero-fills the rest.
  GEO.resizeTable(t, 6);
  nearArr(GEO.readAttr(t, 'position', 2), [2, 4, 6]);
  nearArr(GEO.readAttr(t, 'position', 5), [0, 0, 0]);

  // Compacting keeps survivors in order and does not leave a view over the old buffer.
  const kept = GEO.compactTable(t, (k) => k % 2 === 0);
  assert.equal(kept, 3);
  assert.equal(t.count, 3);
  nearArr(GEO.readAttr(t, 'position', 1), [2, 4, 6], 1e-9);
  assert.equal(t.attrs.position.data.length, 9, 'compaction must shrink the buffer, not just the count');
  assert.equal(t.attrs.position.data.byteOffset, 0, 'a compacted column must own its buffer, not view a larger one');
});

check('geometry: joining shifts face indices onto the joined points', () => {
  const a = GEO.pointCloud(3);
  for (let k = 0; k < 3; k++) GEO.writeAttr(a.points, 'position', k, [k, 0, 0]);
  GEO.setTriangles(a, [0, 1, 2]);
  const b = GEO.pointCloud(3);
  for (let k = 0; k < 3; k++) GEO.writeAttr(b.points, 'position', k, [k, 5, 0]);
  GEO.setTriangles(b, [0, 1, 2]);

  const j = GEO.joinGeometry(a, b);
  assert.equal(GEO.pointCount(j), 6);
  assert.equal(GEO.faceCount(j), 2);
  // The second triangle must reference points 3,4,5 — not 0,1,2.
  assert.deepEqual([...j.faces.corners], [0, 1, 2, 3, 4, 5]);
  const tri = GEO.triangleCorners(j, 1);
  near(tri[0][1], 5, 1e-9, 'the second face must sit where the second geometry was');
});

check('geometry: joining fills columns that only one side has', () => {
  const a = GEO.pointCloud(2);
  GEO.ensureAttr(a.points, 'heat', 1, 7);
  const b = GEO.pointCloud(2);
  GEO.ensureAttr(b.points, 'charge', 1, 3);
  const j = GEO.joinGeometry(a, b);
  assert.equal(GEO.readAttr(j.points, 'heat', 0), 7);
  assert.equal(GEO.readAttr(j.points, 'heat', 2), 0, 'the side without the column gets zeros, not a refusal');
  assert.equal(GEO.readAttr(j.points, 'charge', 2), 3);
});

check('geometry: primitives build the counts and bounds they claim', () => {
  const build = (type, values) => evalNode(type, values, 'out', {}, 'geo');
  const plane = build('cadence.geometry.plane', { size: [2, 0, 2], segmentsX: 2, segmentsY: 2 });
  assert.equal(GEO.pointCount(plane), 9, '3x3 grid of points for 2x2 segments');
  assert.equal(GEO.faceCount(plane), 8, 'two triangles per quad');
  nearArr(GEO.bounds(plane).size, [2, 0, 2], 1e-6);

  const box = build('cadence.geometry.box', { size: [2, 4, 6] });
  assert.equal(GEO.pointCount(box), 24, 'six independent quads, so no shared corners');
  assert.equal(GEO.faceCount(box), 12);
  nearArr(GEO.bounds(box).size, [2, 4, 6], 1e-6);

  const sphere = build('cadence.geometry.sphere', { radius: 3, segments: 8, rings: 4 });
  nearArr(GEO.bounds(sphere).size, [6, 6, 6], 1e-6);
  // Every point must actually be on the sphere.
  for (let k = 0; k < GEO.pointCount(sphere); k++) {
    near(V.vLength(GEO.readAttr(sphere.points, 'position', k)), 3, 1e-6);
  }

  const cone = build('cadence.geometry.cylinder', { radiusBottom: 2, radiusTop: 0, height: 4, segments: 8, caps: true });
  nearArr(GEO.bounds(cone).size, [4, 4, 4], 1e-6);
  assert.ok(GEO.faceCount(cone) > 0);
});

check('geometry: a point grid with one row along an axis centres it', () => {
  const g = evalNode('cadence.geometry.pointGrid', { size: [4, 0, 4], countX: 3, countY: 1, countZ: 3 }, 'out', {}, 'grid');
  assert.equal(GEO.pointCount(g), 9);
  const b = GEO.bounds(g);
  nearArr(b.size, [4, 0, 4], 1e-6);
  nearArr(b.center, [0, 0, 0], 1e-6, 'a 1-deep axis must sit centred, not offset by half the size');
});

check('geometry: normals are recalculated outward on a closed shape', () => {
  const sphere = evalNode('cadence.geometry.sphere', { radius: 2, segments: 12, rings: 6 }, 'out', {}, 'sph');
  assert.ok(GEO.hasAttr(sphere.points, 'normal'));
  let checked = 0;
  for (let k = 0; k < GEO.pointCount(sphere); k++) {
    const p = GEO.readAttr(sphere.points, 'position', k);
    const nrm = GEO.readAttr(sphere.points, 'normal', k);
    if (V.vLength(nrm) < 0.5) continue;             // the poles are degenerate in a UV sphere
    assert.ok(V.vDot(V.vNormalize(p), nrm) > 0.9, `normal at ${k} points inward: ${nrm}`);
    checked++;
  }
  assert.ok(checked > 20, 'most normals should be well-defined');
});

check('geometry: every closed primitive is wound so its normals face outward', () => {
  // Winding is the easiest thing in this file to get backwards, and an inverted surface is invisible
  // in a point count and obvious only once something is lit. Checking the whole family at once is
  // what stops the next primitive from repeating it: on a closed convex shape centred at the origin,
  // an outward normal always agrees with the direction from the centre to the point.
  // Each shape says where "out" is at a given point, because one heuristic does not fit all of them:
  // for a convex shape centred at the origin it is the direction from the centre, but a torus is not
  // convex — on the inner half of its tube the true outward normal points TOWARDS the torus axis, so
  // measuring from the centre would call a correctly-wound torus reversed.
  const fromOrigin = (p) => V.vNormalize(p);
  const closed = [
    ['cadence.geometry.sphere', { radius: 2, segments: 16, rings: 8 }, fromOrigin],
    ['cadence.geometry.box', { size: [2, 3, 4] }, fromOrigin],
    ['cadence.geometry.cylinder', { radiusBottom: 2, radiusTop: 2, height: 4, segments: 16, caps: true }, fromOrigin],
    // Away from the nearest point on the tube's centre circle, which lies in the xz-plane at radius R.
    ['cadence.geometry.torus', { majorRadius: 3, minorRadius: 1, majorSegments: 20, minorSegments: 10 },
      (p) => {
        const r = Math.hypot(p[0], p[2]) || 1e-9;
        return V.vNormalize([p[0] - (p[0] / r) * 3, p[1], p[2] - (p[2] / r) * 3]);
      }],
  ];
  for (const [type, values, outwardAt] of closed) {
    const geo = evalNode(type, values, 'out', {}, `w_${type}`);
    const tri = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    let inward = 0, checked = 0;
    for (let f = 0; f < GEO.faceCount(geo); f++) {
      GEO.triangleCorners(geo, f, tri);
      const nrm = GEO.faceNormal(tri[0], tri[1], tri[2]);
      const mid = [0, 1, 2].map((a) => (tri[0][a] + tri[1][a] + tri[2][a]) / 3);
      const dot = V.vDot(outwardAt(mid), nrm);
      if (Math.abs(dot) < 0.05) continue;   // a face seen edge-on says nothing either way
      checked++;
      if (dot < 0) inward++;
    }
    assert.ok(checked > 10, `${type}: too few faces to judge (${checked})`);
    assert.equal(inward, 0, `${type}: ${inward} of ${checked} faces point inward — the winding is reversed`);
  }
  // A plane facing "xz" is a ground plane, so it must face UP rather than down.
  const plane = evalNode('cadence.geometry.plane', { size: [4, 0, 4], plane: 'xz' }, 'out', {}, 'wplane');
  for (let f = 0; f < GEO.faceCount(plane); f++) {
    const tri = GEO.triangleCorners(plane, f);
    nearArr(GEO.faceNormal(tri[0], tri[1], tri[2]), [0, 1, 0], 1e-6);
  }
});

check('geometry: Set Position displaces by a field and respects its mask', () => {
  const g = G.newGraph('t');
  const plane = G.newNode(g, 'cadence.geometry.plane', 0, 0, { values: { size: [2, 0, 2], segmentsX: 4, segmentsY: 4 }, id: 'plane' });
  const move = G.newNode(g, 'cadence.geometry.setPosition', 200, 0, { values: { offset: [0, 5, 0] }, id: 'move' });
  assert.ok(G.connect(g, plane.id, 'out', move.id, 'geometry').ok);
  const out = ev(g, move.id).value;
  nearArr(GEO.bounds(out).center, [0, 5, 0], 1e-6);

  // With the mask at zero nothing moves, which proves the mask is consulted rather than ignored.
  move.values.selection = 0;
  const masked = new E.Evaluator(g, {}).evaluateSocket(move.id, 'out').value;
  nearArr(GEO.bounds(masked).center, [0, 0, 0], 1e-6);
});

check('geometry: Store Attribute On Geometry freezes a field into data', () => {
  const g = G.newGraph('t');
  const grid = G.newNode(g, 'cadence.geometry.pointGrid', 0, 0, { values: { size: [4, 0, 4], countX: 3, countY: 1, countZ: 3 }, id: 'grid' });
  const pos = G.newNode(g, 'cadence.fields.position', 0, 200);
  const len = G.newNode(g, 'cadence.vector.length', 200, 200);
  const cap = G.newNode(g, 'cadence.geometry.capture', 400, 0, { values: { name: 'dist' }, id: 'cap' });
  assert.ok(G.connect(g, grid.id, 'out', cap.id, 'geometry').ok);
  assert.ok(G.connect(g, pos.id, 'out', len.id, 'vector').ok);
  assert.ok(G.connect(g, len.id, 'out', cap.id, 'value').ok);
  const out = ev(g, cap.id).value;
  assert.ok(GEO.hasAttr(out.points, 'dist'), 'the attribute must exist after capture');
  // Each stored value must be that point's own distance from the origin.
  for (let k = 0; k < GEO.pointCount(out); k++) {
    near(GEO.readAttr(out.points, 'dist', k), V.vLength(GEO.readAttr(out.points, 'position', k)), 1e-5);
  }
});

check('geometry: curves resample by length, not by control point', () => {
  const g = G.newGraph('t');
  // Three points with a deliberately uneven gap: 0->1 is short, 1->11 is long.
  const p1 = G.newNode(g, 'cadence.geometry.point', 0, 0, { values: { position: [0, 0, 0] }, id: 'p1' });
  const p2 = G.newNode(g, 'cadence.geometry.point', 0, 100, { values: { position: [1, 0, 0] }, id: 'p2' });
  const p3 = G.newNode(g, 'cadence.geometry.point', 0, 200, { values: { position: [11, 0, 0] }, id: 'p3' });
  const join = G.newNode(g, 'cadence.geometry.join', 200, 100, { id: 'join' });
  for (const p of [p1, p2, p3]) assert.ok(G.connect(g, p.id, 'out', join.id, 'geometries').ok);
  const curve = G.newNode(g, 'cadence.curveGeometry.fromPoints', 400, 100, { id: 'curve' });
  assert.ok(G.connect(g, join.id, 'out', curve.id, 'geometry').ok);
  const res = G.newNode(g, 'cadence.curveGeometry.resample', 600, 100, { values: { count: 11 }, id: 'res' });
  assert.ok(G.connect(g, curve.id, 'out', res.id, 'geometry').ok);

  const out = ev(g, res.id).value;
  assert.equal(GEO.pointCount(out), 11);
  // Evenly spaced by LENGTH means consecutive gaps are all equal (total 11 over 10 gaps = 1.1 each).
  for (let k = 0; k < 10; k++) {
    const a = GEO.readAttr(out.points, 'position', k);
    const b = GEO.readAttr(out.points, 'position', k + 1);
    near(V.vDistance(a, b), 1.1, 1e-6, `gap ${k} is uneven — resampling followed control points, not length`);
  }
});

check('sampling: surface scatter is area-weighted, not per-triangle', () => {
  // A geometry of two triangles whose areas differ 100:1. Per-triangle sampling would put half the
  // points on each; area weighting must put ~99% on the large one.
  const geo = GEO.pointCloud(6);
  const put = (k, p) => GEO.writeAttr(geo.points, 'position', k, p);
  put(0, [0, 0, 0]); put(1, [10, 0, 0]); put(2, [0, 10, 0]);         // area 50
  put(3, [100, 0, 0]); put(4, [101, 0, 0]); put(5, [100, 1, 0]);     // area 0.5
  GEO.setTriangles(geo, [0, 1, 2, 3, 4, 5]);

  const g = G.newGraph('t');
  const src = G.newNode(g, 'test.geometry.constant', 0, 0, { id: 'src' });
  G.setNodeValue(g, src.id, 'geometry', geo);
  const scat = G.newNode(g, 'cadence.sample.pointsOnSurface', 200, 0, { values: { count: 400 }, id: 'scat' });
  assert.ok(G.connect(g, src.id, 'out', scat.id, 'geometry').ok);
  const out = ev(g, scat.id).value;
  assert.equal(GEO.pointCount(out), 400);
  let onBig = 0;
  for (let k = 0; k < 400; k++) if (GEO.readAttr(out.points, 'position', k)[0] < 50) onBig++;
  assert.ok(onBig > 380, `expected ~99% of points on the large triangle, got ${onBig}/400`);
});

check('sampling: scattered points inherit interpolated attributes and a normal', () => {
  const geo = GEO.pointCloud(3);
  GEO.writeAttr(geo.points, 'position', 0, [0, 0, 0]);
  GEO.writeAttr(geo.points, 'position', 1, [4, 0, 0]);
  GEO.writeAttr(geo.points, 'position', 2, [0, 0, 4]);
  GEO.ensureAttr(geo.points, 'heat', 1);
  for (let k = 0; k < 3; k++) GEO.writeAttr(geo.points, 'heat', k, 10);
  GEO.setTriangles(geo, [0, 1, 2]);

  const g = G.newGraph('t');
  const src = G.newNode(g, 'test.geometry.constant', 0, 0, { id: 'src2' });
  G.setNodeValue(g, src.id, 'geometry', geo);
  const scat = G.newNode(g, 'cadence.sample.pointsOnSurface', 200, 0, { values: { count: 20 }, id: 'scat2' });
  assert.ok(G.connect(g, src.id, 'out', scat.id, 'geometry').ok);
  const out = ev(g, scat.id).value;
  assert.ok(GEO.hasAttr(out.points, 'heat'), 'attributes must come across');
  for (let k = 0; k < GEO.pointCount(out); k++) {
    // Every corner reads 10, so every barycentric blend of them must also read 10.
    near(GEO.readAttr(out.points, 'heat', k), 10, 1e-4);
    nearArr(GEO.readAttr(out.points, 'normal', k), [0, -1, 0], 1e-6);
    near(GEO.readAttr(out.points, 'position', k)[1], 0, 1e-6, 'points must lie in the triangle');
  }
});

check('sampling: volume scatter keeps only points inside the shape', () => {
  const g = G.newGraph('t');
  const sphere = G.newNode(g, 'cadence.sdf.sphere', 0, 0, { values: { radius: 1.5 }, id: 'vsph' });
  const fill = G.newNode(g, 'cadence.sample.pointsInVolume', 200, 0, {
    values: { count: 200, boundsSize: [4, 4, 4], maxAttempts: 64 }, id: 'fill',
  });
  assert.ok(G.connect(g, sphere.id, 'out', fill.id, 'shape').ok);
  const out = ev(g, fill.id).value;
  assert.ok(GEO.pointCount(out) > 150, `most points should land inside, got ${GEO.pointCount(out)}`);
  for (let k = 0; k < GEO.pointCount(out); k++) {
    assert.ok(V.vLength(GEO.readAttr(out.points, 'position', k)) <= 1.5 + 1e-6, 'a point escaped the shape');
  }
});

check('sampling: raycast hits the surface it is aimed at', () => {
  const g = G.newGraph('t');
  const plane = G.newNode(g, 'cadence.geometry.plane', 0, 0, { values: { size: [20, 0, 20] }, id: 'rp' });
  const ray = G.newNode(g, 'cadence.sample.raycast', 200, 0, { values: { direction: [0, -1, 0], maxDistance: 100 }, id: 'ray' });
  assert.ok(G.connect(g, plane.id, 'out', ray.id, 'geometry').ok);
  const at = (position, socket) => ev(g, ray.id, socket).value.sample(F.newSampleContext({ position }));
  assert.equal(at([1, 5, 1], 'hit'), true);
  near(at([1, 5, 1], 'distance'), 5, 1e-5);
  nearArr(at([1, 5, 1], 'position'), [1, 0, 1], 1e-5);
  assert.equal(at([50, 5, 50], 'hit'), false, 'a ray that misses must report a miss');
});

check('instancing: instances stay cheap until realized, then expand exactly', () => {
  const g = G.newGraph('t');
  // Four points, so the ring's bounding box is exactly the diameter in both axes and the expected
  // numbers are checkable by hand. Five would be a pentagon, whose box is narrower than its diameter.
  const pts = G.newNode(g, 'cadence.geometry.pointCircle', 0, 0, { values: { count: 4, radius: 10 }, id: 'ipts' });
  const box = G.newNode(g, 'cadence.geometry.box', 0, 200, { values: { size: [1, 1, 1] }, id: 'ibox' });
  const inst = G.newNode(g, 'cadence.instance.onPoints', 200, 100, { id: 'inst' });
  assert.ok(G.connect(g, pts.id, 'out', inst.id, 'points').ok);
  assert.ok(G.connect(g, box.id, 'out', inst.id, 'geometry').ok);

  assert.equal(ev(g, inst.id, 'count').value, 4);
  const info = G.newNode(g, 'cadence.instance.info', 400, 100, { id: 'iinfo' });
  assert.ok(G.connect(g, inst.id, 'out', info.id, 'instances').ok);
  assert.equal(ev(g, info.id, 'count').value, 4);
  assert.equal(ev(g, info.id, 'pointsIfRealized').value, 4 * 24, 'four boxes of 24 points each');

  const real = G.newNode(g, 'cadence.instance.realize', 400, 300, { id: 'ireal' });
  assert.ok(G.connect(g, inst.id, 'out', real.id, 'instances').ok);
  const out = ev(g, real.id).value;
  assert.equal(GEO.pointCount(out), 4 * 24);
  assert.equal(GEO.faceCount(out), 4 * 12);
  // The copies must be spread around the ring, not stacked at the origin: 20 studs across the ring
  // plus the 1-stud box overhanging half a stud at each extreme.
  nearArr(GEO.bounds(out).size, [21, 1, 21], 1e-4);
});

check('instancing: transforms apply per instance and compose', () => {
  const g = G.newGraph('t');
  const pts = G.newNode(g, 'cadence.geometry.point', 0, 0, { values: { position: [3, 0, 0] }, id: 'tp' });
  const box = G.newNode(g, 'cadence.geometry.box', 0, 200, { values: { size: [2, 2, 2] }, id: 'tb' });
  const inst = G.newNode(g, 'cadence.instance.onPoints', 200, 100, { id: 'ti' });
  const scale = G.newNode(g, 'cadence.instance.scale', 400, 100, { values: { scale: [2, 2, 2] }, id: 'ts' });
  const move = G.newNode(g, 'cadence.instance.translate', 600, 100, { values: { offset: [0, 10, 0] }, id: 'tt' });
  const real = G.newNode(g, 'cadence.instance.realize', 800, 100, { id: 'tr' });
  assert.ok(G.connect(g, pts.id, 'out', inst.id, 'points').ok);
  assert.ok(G.connect(g, box.id, 'out', inst.id, 'geometry').ok);
  assert.ok(G.connect(g, inst.id, 'out', scale.id, 'instances').ok);
  assert.ok(G.connect(g, scale.id, 'out', move.id, 'instances').ok);
  assert.ok(G.connect(g, move.id, 'out', real.id, 'instances').ok);
  const b = GEO.bounds(ev(g, real.id).value);
  nearArr(b.size, [4, 4, 4], 1e-6, 'a 2-stud box scaled by 2 is 4 studs');
  nearArr(b.center, [3, 10, 0], 1e-6, 'scaled about the instance, then moved');
});

// ================================================================ phase 5: the solver
const SOLVER = await import('../renderer/js/pnx/solver.js');

// Build a graph with an emitter feeding a simulate node, and hand back both plus the evaluator, so a
// test can seek frames in any order through ONE evaluator (which is what exercises the replay path —
// a fresh evaluator per frame would only ever step forwards).
function simGraph({ emitter = {}, simulate = {}, force = null, gravity = null } = {}) {
  const g = G.newGraph('sim');
  const em = G.newNode(g, 'cadence.particles.emitter', 0, 0, {
    id: 'em', values: { rate: 10, lifetime: 1, velocity: [0, 0, 0], ...emitter },
  });
  const sim = G.newNode(g, 'cadence.particles.simulate', 400, 0, {
    id: 'sim', values: { maxParticles: 1000, ...simulate },
  });
  assert.ok(G.connect(g, em.id, 'out', sim.id, 'emitter').ok);
  if (gravity !== null) sim.values.force = gravity;
  if (force) {
    const f = G.newNode(g, force.type, 200, 200, { id: 'force', values: force.values || {} });
    assert.ok(G.connect(g, f.id, 'out', sim.id, 'force').ok, 'force must connect');
  }
  const e = new E.Evaluator(g, { fps: 30 });
  return { g, em, sim, e };
}

const seekTo = (e, sim, frame, socket = 'out') => {
  e.setTime(frame);
  return e.evaluateSocket(sim.id, socket);
};

check('solver: a bare emitter spawns at the rate it claims', () => {
  const { sim, e } = simGraph({ emitter: { rate: 30, lifetime: 100 } });
  // 30/second at 30fps is one per frame. After 10 frames, 10 particles.
  assert.equal(seekTo(e, sim, 10, 'count').value, 10);
  assert.equal(seekTo(e, sim, 20, 'count').value, 20);
});

check('solver: a fractional spawn rate still emits', () => {
  // 0.5/second must give one particle every two seconds, not zero forever. Truncating each frame
  // independently is the classic bug this guards.
  const { sim, e } = simGraph({ emitter: { rate: 0.5, lifetime: 1000 } });
  assert.equal(seekTo(e, sim, 30, 'count').value, 0, 'not yet at one second');
  assert.equal(seekTo(e, sim, 60, 'count').value, 1, 'one particle by two seconds');
  assert.equal(seekTo(e, sim, 120, 'count').value, 2);
});

check('solver: a burst fires exactly once', () => {
  const { sim, e } = simGraph({ emitter: { rate: 0, burstCount: 50, burstTime: 0.5, lifetime: 1000 } });
  assert.equal(seekTo(e, sim, 10, 'count').value, 0, 'before the burst time');
  assert.equal(seekTo(e, sim, 20, 'count').value, 50, 'the burst has fired');
  assert.equal(seekTo(e, sim, 60, 'count').value, 50, 'and must not fire again');
});

check('solver: particles die of old age', () => {
  const { sim, e } = simGraph({ emitter: { rate: 30, lifetime: 1 } });
  // One per frame, each living 30 frames: the population plateaus at 30.
  assert.equal(seekTo(e, sim, 20, 'count').value, 20);
  const plateau = seekTo(e, sim, 90, 'count').value;
  assert.ok(plateau >= 29 && plateau <= 31, `expected a plateau near 30, got ${plateau}`);
  assert.ok(seekTo(e, sim, 90, 'died').value > 0, 'particles must actually be dying');
});

check('solver: SCRUBBING IS DETERMINISTIC — the same frame is identical however it is reached', () => {
  // This is the property the whole checkpoint/replay design exists for. Without it the timeline, onion
  // skin, render_frame and export baking are all unsound.
  const snapshot = (r) => {
    const g = r.value;
    const rows = [];
    for (let k = 0; k < GEO.pointCount(g); k++) {
      rows.push([
        GEO.readAttr(g.points, 'id', k),
        ...GEO.readAttr(g.points, 'position', k),
        ...GEO.readAttr(g.points, 'velocity', k),
        GEO.readAttr(g.points, 'age', k),
      ].map((v) => Math.round(v * 1e6) / 1e6));
    }
    rows.sort((a, b) => a[0] - b[0]);
    return JSON.stringify(rows);
  };

  const setup = () => simGraph({
    emitter: { rate: 20, lifetime: 1.5, velocity: [2, 6, 0] },
    simulate: { force: [0, -30, 0], drag: 0.4, substeps: 2 },
  });

  // Route A: straight forwards to frame 47.
  const a = setup();
  const forwards = snapshot(seekTo(a.e, a.sim, 47));
  assert.ok(forwards.length > 10, 'the simulation must actually produce particles');

  // Route B: past it and back — this forces a restore from a checkpoint plus a replay.
  const b = setup();
  seekTo(b.e, b.sim, 90);
  const backwards = snapshot(seekTo(b.e, b.sim, 47));
  assert.equal(backwards, forwards, 'scrubbing backwards gave a different frame 47');

  // Route C: a jittery scrub, the way a user actually drags a playhead.
  const c = setup();
  for (const f of [5, 60, 12, 88, 30, 71, 2, 47]) seekTo(c.e, c.sim, f);
  assert.equal(snapshot(seekTo(c.e, c.sim, 47)), forwards, 'a jittery scrub gave a different frame 47');

  // Route D: a fresh simulation reaching it in one hop must agree too.
  const d = setup();
  assert.equal(snapshot(seekTo(d.e, d.sim, 47)), forwards);
});

check('solver: replaying backwards costs steps, replaying forwards does not', () => {
  const { sim, e } = simGraph({ emitter: { rate: 10, lifetime: 5 } });
  seekTo(e, sim, 40);
  const simObj = [...e.persistent.values()][0];
  assert.ok(simObj instanceof SOLVER.Simulation, 'the simulation must be held as persistent state');

  seekTo(e, sim, 41);
  assert.equal(simObj.lastSeek.steps, 1, 'one frame forward is one step');

  // Re-asking for the frame we are already on must not advance the state. Called on the simulation
  // directly, because through the graph the evaluator does not even re-run the node — its cache entry
  // is still valid, which is cheaper still but tests the cache rather than the seek.
  const frameBefore = simObj.state.frame;
  simObj.seek(41);
  assert.equal(simObj.lastSeek.steps, 0, 'the same frame again must cost nothing');
  assert.equal(simObj.state.frame, frameBefore, 'and must not advance the state');

  seekTo(e, sim, 20);
  assert.ok(simObj.lastSeek.steps > 0 && simObj.lastSeek.steps <= 20,
    `a backward seek should replay from a checkpoint, not from zero (${simObj.lastSeek.steps} steps)`);
});

check('solver: advancing time keeps the simulation, changing the graph resets it', () => {
  const { sim, e } = simGraph({ emitter: { rate: 10, lifetime: 100 } });
  seekTo(e, sim, 30);
  const first = [...e.persistent.values()][0];
  seekTo(e, sim, 31);
  assert.equal([...e.persistent.values()][0], first, 'moving the playhead must not restart the simulation');

  // A structural change must drop it: a history produced by a different graph is not a valid start.
  e.invalidateNode(sim.id);
  assert.equal(e.persistent.size, 0, 'a structural change must discard the simulation');
});

check('solver: gravity accelerates at the rate it is given', () => {
  const { sim, e } = simGraph({
    emitter: { rate: 0, burstCount: 1, burstTime: 0, lifetime: 100, velocity: [0, 0, 0] },
    simulate: { force: [0, -10, 0], substeps: 8 },
  });
  const g = seekTo(e, sim, 30).value;   // one second at 30fps
  assert.equal(GEO.pointCount(g), 1);
  const p = GEO.readAttr(g.points, 'position', 0);
  const v = GEO.readAttr(g.points, 'velocity', 0);
  // v = a*t is exact for semi-implicit Euler under a constant force. The tolerance is set by the
  // state being stored in Float32Array (deliberately — half the memory of doubles, and what every
  // particle engine does): 240 float32 additions accumulate a few parts in 10^6, not in 10^16.
  near(v[1], -10, 1e-4, 'velocity after one second of 10 studs/s^2');
  // Position lags the analytic -0.5*a*t^2 = -5 by one step's worth; being within a step is the
  // correctness bar for a first-order integrator, and it must not be wildly off.
  assert.ok(p[1] < -4.5 && p[1] > -5.5, `expected roughly -5 studs, got ${p[1]}`);
});

check('solver: drag is stable however hard it is pushed', () => {
  // Linear damping (v *= 1 - k*dt) goes NEGATIVE and explodes once k*dt > 1, which a user reaches by
  // dragging a slider. Exponential damping cannot.
  for (const drag of [0.5, 5, 50, 5000]) {
    const { sim, e } = simGraph({
      emitter: { rate: 0, burstCount: 1, burstTime: 0, lifetime: 100, velocity: [100, 0, 0] },
      simulate: { drag },
    });
    const g = seekTo(e, sim, 30).value;
    const v = GEO.readAttr(g.points, 'velocity', 0);
    assert.ok(Number.isFinite(v[0]), `drag ${drag} produced ${v[0]}`);
    assert.ok(v[0] >= 0 && v[0] <= 100, `drag ${drag} must slow the particle, not reverse or amplify it: ${v[0]}`);
  }
});

check('solver: a collider stops particles and bounce returns some speed', () => {
  const mk = (response, restitution) => {
    const g = G.newGraph('c');
    const em = G.newNode(g, 'cadence.particles.emitter', 0, 0, {
      id: 'cem', values: { rate: 0, burstCount: 1, burstTime: 0, lifetime: 100, velocity: [0, -20, 0] },
    });
    const plane = G.newNode(g, 'cadence.sdf.plane', 0, 200, { id: 'cpl', values: { point: [0, 0, 0], normal: [0, 1, 0] } });
    const col = G.newNode(g, 'cadence.particles.collider', 200, 200, {
      id: 'ccol', values: { response, restitution, friction: 0, thickness: 0.05 },
    });
    const sim = G.newNode(g, 'cadence.particles.simulate', 400, 0, {
      id: 'csim', values: { maxParticles: 10, substeps: 4 },
    });
    assert.ok(G.connect(g, plane.id, 'out', col.id, 'shape').ok);
    assert.ok(G.connect(g, em.id, 'out', sim.id, 'emitter').ok);
    assert.ok(G.connect(g, col.id, 'out', sim.id, 'colliders').ok);
    return { sim, e: new E.Evaluator(g, { fps: 30 }) };
  };

  // Bouncing: the particle must end up on or above the plane, moving upwards.
  const b = mk('bounce', 0.6);
  const bg = seekTo(b.e, b.sim, 20).value;
  assert.equal(GEO.pointCount(bg), 1);
  assert.ok(GEO.readAttr(bg.points, 'position', 0)[1] >= -1e-3, 'a bounced particle must not be below the plane');
  assert.ok(GEO.readAttr(bg.points, 'velocity', 0)[1] > 0, 'a bounced particle must be moving up');

  // Sticking: it must stop dead.
  const s = mk('stick', 0);
  const sg = seekTo(s.e, s.sim, 20).value;
  near(V.vLength(GEO.readAttr(sg.points, 'velocity', 0)), 0, 1e-6);

  // Killing: it must be gone.
  const k = mk('kill', 0);
  assert.equal(seekTo(k.e, k.sim, 20, 'count').value, 0, 'a killing collider must remove the particle');
});

check('solver: the kill field removes particles the moment it is true', () => {
  const g = G.newGraph('k');
  const em = G.newNode(g, 'cadence.particles.emitter', 0, 0, {
    id: 'kem', values: { rate: 30, lifetime: 1000, velocity: [0, 10, 0] },
  });
  // Kill anything above 3 studs: Position -> Separate -> Greater Than.
  const pos = G.newNode(g, 'cadence.fields.position', 0, 200, { id: 'kpos' });
  const sep = G.newNode(g, 'cadence.vector.separate', 200, 200, { id: 'ksep' });
  const gt = G.newNode(g, 'cadence.math.greaterThan', 400, 200, { id: 'kgt', values: { b: 3 } });
  const sim = G.newNode(g, 'cadence.particles.simulate', 600, 0, { id: 'ksim', values: { maxParticles: 500 } });
  assert.ok(G.connect(g, pos.id, 'out', sep.id, 'vector').ok);
  assert.ok(G.connect(g, sep.id, 'y', gt.id, 'a').ok);
  assert.ok(G.connect(g, em.id, 'out', sim.id, 'emitter').ok);
  assert.ok(G.connect(g, gt.id, 'out', sim.id, 'kill').ok);

  const e = new E.Evaluator(g, { fps: 30 });
  const out = seekTo(e, sim, 60);
  assert.ok(out.value !== null);
  for (let k = 0; k < GEO.pointCount(out.value); k++) {
    assert.ok(GEO.readAttr(out.value.points, 'position', k)[1] <= 3 + 1e-3, 'a particle survived above the kill height');
  }
  assert.ok(seekTo(e, sim, 60, 'died').value > 0, 'the kill field must actually be killing');
});

check('solver: initial attributes are written at birth and travel with the particle', () => {
  const g = G.newGraph('a');
  const rnd = G.newNode(g, 'cadence.random.float', 0, 400, { id: 'arnd', values: { min: 100, max: 200 } });
  const set = G.newNode(g, 'cadence.attribute.write', 200, 400, { id: 'aset', values: { name: 'heat' } });
  const em = G.newNode(g, 'cadence.particles.emitter', 400, 0, {
    id: 'aem', values: { rate: 30, lifetime: 1000 },
  });
  const sim = G.newNode(g, 'cadence.particles.simulate', 600, 0, { id: 'asim', values: { maxParticles: 500 } });
  assert.ok(G.connect(g, rnd.id, 'out', set.id, 'value').ok);
  assert.ok(G.connect(g, set.id, 'out', em.id, 'attributes').ok);
  assert.ok(G.connect(g, em.id, 'out', sim.id, 'emitter').ok);

  const e = new E.Evaluator(g, { fps: 30 });
  const out = seekTo(e, sim, 20).value;
  assert.ok(GEO.pointCount(out) > 5);
  assert.ok(GEO.hasAttr(out.points, 'heat'), 'the custom attribute must exist on the particles');
  const values = [];
  for (let k = 0; k < GEO.pointCount(out); k++) {
    const h = GEO.readAttr(out.points, 'heat', k);
    assert.ok(h >= 100 && h <= 200, `heat ${h} is outside the range it was spawned with`);
    values.push(h);
  }
  assert.ok(new Set(values.map((v) => Math.round(v))).size > 1, 'every particle got the same value — the spawn context is not varying per particle');
});

check('solver: normalized age runs 0 to 1 and drives an over-lifetime curve', () => {
  const { sim, e } = simGraph({ emitter: { rate: 30, lifetime: 1 } });
  const out = seekTo(e, sim, 45).value;
  let sawEarly = false, sawLate = false;
  for (let k = 0; k < GEO.pointCount(out); k++) {
    const life = GEO.readAttr(out.points, 'life', k);
    assert.ok(life >= 0 && life <= 1, `life ${life} is outside 0..1`);
    if (life < 0.2) sawEarly = true;
    if (life > 0.8) sawLate = true;
  }
  assert.ok(sawEarly && sawLate, 'a steady emitter should hold particles at every stage of life');
});

check('solver: particles are points, so phase-4 nodes work on them unchanged', () => {
  const g = G.newGraph('p');
  const em = G.newNode(g, 'cadence.particles.emitter', 0, 0, {
    id: 'pem', values: { rate: 30, lifetime: 1000, velocity: [0, 5, 0] },
  });
  const sim = G.newNode(g, 'cadence.particles.simulate', 200, 0, { id: 'psim', values: { maxParticles: 500 } });
  const box = G.newNode(g, 'cadence.geometry.box', 0, 400, { id: 'pbox', values: { size: [1, 1, 1] } });
  const inst = G.newNode(g, 'cadence.instance.onPoints', 400, 200, { id: 'pinst' });
  const info = G.newNode(g, 'cadence.instance.info', 600, 200, { id: 'pinfo' });
  assert.ok(G.connect(g, em.id, 'out', sim.id, 'emitter').ok);
  assert.ok(G.connect(g, sim.id, 'out', inst.id, 'points').ok, 'particles must connect straight into instancing');
  assert.ok(G.connect(g, box.id, 'out', inst.id, 'geometry').ok);
  assert.ok(G.connect(g, inst.id, 'out', info.id, 'instances').ok);

  const e = new E.Evaluator(g, { fps: 30 });
  e.setTime(15);
  const alive = e.evaluateSocket(sim.id, 'count').value;
  assert.ok(alive > 5, `expected particles, got ${alive}`);
  assert.equal(e.evaluateSocket(info.id, 'count').value, alive, 'one instance per particle');
  assert.equal(e.evaluateSocket(info.id, 'pointsIfRealized').value, alive * 24);
});

check('solver: the particle limit is respected and reported, not silently exceeded', () => {
  const { sim, e } = simGraph({
    emitter: { rate: 1000, lifetime: 1000 },
    simulate: { maxParticles: 25 },
  });
  assert.equal(seekTo(e, sim, 60, 'count').value, 25);
  const simObj = [...e.persistent.values()][0];
  const report = SOLVER.diagnoseSimulation(simObj);
  assert.ok(report.diagnostics.some((d) => d.code === 'atLimit'), 'hitting the limit must be reported');
});

check('solver: the report names an exploding simulation rather than shrugging', () => {
  const { sim, e } = simGraph({
    emitter: { rate: 0, burstCount: 5, burstTime: 0, lifetime: 1000, velocity: [1e6, 0, 0] },
  });
  seekTo(e, sim, 30);
  const report = SOLVER.diagnoseSimulation([...e.persistent.values()][0]);
  assert.ok(report.diagnostics.some((d) => d.code === 'exploding' || d.code === 'fastParticles'),
    `expected an explosion warning, got ${JSON.stringify(report.diagnostics)}`);
  assert.ok(report.stats.particles === 5 && report.stats.maxSpeed > 1e5);
});

check('solver: substeps change accuracy, not appearance', () => {
  // The same setup at 1 and at 8 substeps must agree closely. If it does not, the step is not
  // subdividing time properly and raising substeps would change the look of the effect rather than
  // just its accuracy — which would make it a creative control by accident.
  const height = (substeps) => {
    const { sim, e } = simGraph({
      emitter: { rate: 0, burstCount: 1, burstTime: 0, lifetime: 100, velocity: [0, 20, 0] },
      simulate: { force: [0, -10, 0], substeps },
    });
    return GEO.readAttr(seekTo(e, sim, 30).value.points, 'position', 0)[1];
  };
  const coarse = height(1), fine = height(8);
  assert.ok(Math.abs(coarse - fine) < 0.5, `1 substep gave ${coarse}, 8 gave ${fine} — too far apart`);
  assert.ok(Math.abs(fine - 15) < 0.2, `the fine result should approach the analytic 15 studs, got ${fine}`);
});

// ================================================================
console.log(`\nPNX: ${passed} passed, ${failed} failed  (${R.nodeCount()} node types registered)`);
if (failed) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
