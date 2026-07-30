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
  // Randomness 0 puts every cell centre on the lattice, so which cell a point falls in is a fact about
  // the coordinates rather than about the seed. With the default randomness the centres are jittered by
  // the node's structural seed, and since node ids are random per run, two fixed probe points a hundredth
  // of a stud apart occasionally straddle a boundary — this test failed roughly one run in ten before the
  // randomness was pinned. The id is pinned too, so a failure is reproducible rather than a coin toss.
  const vor = G.newNode(g2, 'cadence.noise.voronoi', 200, 0, { id: 'vor', values: { scale: 2, randomness: 0 } });
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
  id: 'test.texture.constant', version: 1, label: 'Constant Texture', category: 'Debug',
  summary: 'Test fixture: emits a texture supplied directly as an inline value.',
  exportSupport: 'unsupported',
  inputs: [{ key: 'texture', label: 'Texture', type: 'texture2d' }],
  outputs: [{ key: 'out', label: 'Texture', type: 'texture2d' }],
  evaluate: (api, i) => i.texture,
});

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

// ================================================================ phase 6: rendering
const RENDER = await import('../renderer/js/pnx/render.js');
// pnxStudio owns the evaluator lifecycle for the studio window. It is imported here because it must
// stay free of DOM and three.js — the moment it reaches for either, this test stops loading, which is
// the same purity gate the pnx modules get.
const STUDIO = await import('../renderer-vfx/js/pnxStudio.js');

// A points geometry with a known layout, for asserting on resolved buffers.
function threePoints() {
  const g = GEO.pointCloud(3);
  for (let k = 0; k < 3; k++) GEO.writeAttr(g.points, 'position', k, [k, k * 2, 0]);
  GEO.ensureAttr(g.points, 'life', 1);
  GEO.writeAttr(g.points, 'life', 0, 0);
  GEO.writeAttr(g.points, 'life', 1, 0.5);
  GEO.writeAttr(g.points, 'life', 2, 1);
  return g;
}

// Wire source -> renderer -> output and return the evaluated command list.
function renderGraph(rendererType, rendererValues = {}, materialValues = null, geometry = null) {
  const g = G.newGraph('r');
  const src = G.newNode(g, 'test.geometry.constant', 0, 0, { id: 'rsrc' });
  G.setNodeValue(g, src.id, 'geometry', geometry || threePoints());
  const ren = G.newNode(g, rendererType, 200, 0, { id: 'rren', values: rendererValues });
  const out = G.newNode(g, 'cadence.render.output', 400, 0, { id: 'rout' });
  const srcSocket = rendererType === 'cadence.render.mesh' ? 'source' : 'source';
  assert.ok(G.connect(g, src.id, 'out', ren.id, srcSocket).ok, 'source must connect to the renderer');
  assert.ok(G.connect(g, ren.id, 'out', out.id, 'passes').ok, 'renderer must connect to the output');
  if (materialValues) {
    const mat = G.newNode(g, 'cadence.material.surface', 200, 300, { id: 'rmat', values: materialValues });
    assert.ok(G.connect(g, mat.id, 'out', ren.id, 'material').ok);
  }
  const e = new E.Evaluator(g, { fps: 30 });
  const r = e.evaluateSocket(out.id, 'out');
  return { g, e, out, ren, result: r, commands: RENDER.flattenCommands(r.value) };
}

check('render: a renderer emits a command, and the output collects passes in order', () => {
  const { commands, result } = renderGraph('cadence.render.sprite', { size: 0.5 });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.equal(commands.length, 1);
  assert.equal(commands[0].kind, 'sprite');
  assert.ok(RENDER.isRenderCommand(commands[0]));

  // Several passes into one output socket, drawn in connection order.
  const g = G.newGraph('multi');
  const src = G.newNode(g, 'test.geometry.constant', 0, 0, { id: 'msrc' });
  G.setNodeValue(g, src.id, 'geometry', threePoints());
  const a = G.newNode(g, 'cadence.render.sprite', 200, 0, { id: 'ma' });
  const b = G.newNode(g, 'cadence.render.point', 200, 200, { id: 'mb' });
  const out = G.newNode(g, 'cadence.render.output', 400, 100, { id: 'mout' });
  for (const n of [a, b]) {
    assert.ok(G.connect(g, src.id, 'out', n.id, 'source').ok);
    assert.ok(G.connect(g, n.id, 'out', out.id, 'passes').ok);
  }
  const list = RENDER.flattenCommands(ev(g, out.id).value);
  assert.deepEqual(list.map((c) => c.kind), ['sprite', 'point']);
});

check('render: material channels are evaluated per element, not once', () => {
  // Base colour driven by Normalized Age: each of the three points has a different life, so each must
  // resolve to a different colour. Resolving a material once and reusing it is the failure this
  // catches, and it would look like every particle being the same colour.
  const g = G.newGraph('m');
  const src = G.newNode(g, 'test.geometry.constant', 0, 0, { id: 'msrc' });
  G.setNodeValue(g, src.id, 'geometry', threePoints());
  const life = G.newNode(g, 'cadence.particles.life', 0, 200, { id: 'mlife' });
  const grad = G.newNode(g, 'cadence.color.sampleGradient', 200, 200, {
    id: 'mgrad',
    values: { gradient: { kind: 'color', stops: [{ u: 0, v: '#000000' }, { u: 1, v: '#ffffff' }] } },
  });
  const mat = G.newNode(g, 'cadence.material.surface', 400, 200, { id: 'mmat' });
  const spr = G.newNode(g, 'cadence.render.sprite', 600, 0, { id: 'mspr' });
  const out = G.newNode(g, 'cadence.render.output', 800, 0, { id: 'mout2' });
  assert.ok(G.connect(g, life.id, 'out', grad.id, 'position').ok);
  assert.ok(G.connect(g, grad.id, 'out', mat.id, 'baseColor').ok);
  assert.ok(G.connect(g, mat.id, 'out', spr.id, 'material').ok);
  assert.ok(G.connect(g, src.id, 'out', spr.id, 'source').ok);
  assert.ok(G.connect(g, spr.id, 'out', out.id, 'passes').ok);

  const scene = RENDER.resolveScene(RENDER.flattenCommands(ev(g, out.id).value), { frame: 0, time: 0 });
  const d = scene.draws[0];
  assert.equal(d.count, 3);
  near(d.colors[0], 0, 1e-6, 'life 0 must be the gradient start');
  near(d.colors[2 * 4], 1, 1e-6, 'life 1 must be the gradient end');
  assert.ok(d.colors[1 * 4] > 0.2 && d.colors[1 * 4] < 0.8, 'life 0.5 must be between them');
});

check('render: an rgb-only colour resolves opaque, not invisible', () => {
  // A vector3 into a colour channel must give alpha 1. Defaulting it to 0 makes every rgb material
  // invisible, which is a genuinely baffling failure to debug from the outside.
  const { commands } = renderGraph('cadence.render.sprite', {}, { baseColor: [1, 0.5, 0.25] });
  const scene = RENDER.resolveScene(commands, { frame: 0, time: 0 });
  const d = scene.draws[0];
  near(d.colors[3], 1, 1e-6, 'alpha must default to opaque');
  near(d.colors[0], 1, 1e-6);
  near(d.colors[1], 0.5, 1e-6);
});

check('render: a channel a material does not carry falls back to its documented default', () => {
  const { commands } = renderGraph('cadence.render.sprite', {});   // no material wired at all
  const scene = RENDER.resolveScene(commands, { frame: 0, time: 0 });
  const d = scene.draws[0];
  assert.equal(d.count, 3);
  for (let k = 0; k < 3; k++) {
    near(d.opacity[k], 1, 1e-6, 'an unwired material must be fully opaque, not invisible');
    near(d.colors[k * 4], 1, 1e-6, 'and white, so an unwired renderer shows something');
  }
});

check('render: sprite size and rotation accept fields', () => {
  const g = G.newGraph('s');
  const src = G.newNode(g, 'test.geometry.constant', 0, 0, { id: 'ssrc' });
  G.setNodeValue(g, src.id, 'geometry', threePoints());
  const life = G.newNode(g, 'cadence.particles.life', 0, 200, { id: 'slife' });
  const spr = G.newNode(g, 'cadence.render.sprite', 400, 0, { id: 'sspr' });
  const out = G.newNode(g, 'cadence.render.output', 600, 0, { id: 'sout' });
  assert.ok(G.connect(g, life.id, 'out', spr.id, 'size').ok, 'size must accept a field');
  assert.ok(G.connect(g, src.id, 'out', spr.id, 'source').ok);
  assert.ok(G.connect(g, spr.id, 'out', out.id, 'passes').ok);
  const d = RENDER.resolveScene(RENDER.flattenCommands(ev(g, out.id).value), {}).draws[0];
  near(d.sizes[0], 0, 1e-6);
  near(d.sizes[1], 0.5, 1e-6);
  near(d.sizes[2], 1, 1e-6);
});

check('render: a flipbook advances through its atlas cells', () => {
  const { commands } = renderGraph('cadence.render.sprite', {
    flipbookColumns: 4, flipbookRows: 2, flipbookMode: 'life',
  });
  const d = RENDER.resolveScene(commands, {}).draws[0];
  assert.ok(d.flipbook, 'a flipbook layout must reach the backend');
  assert.equal(d.flipbook.columns, 4);
  assert.equal(d.flipbook.rows, 2);
  // life 0 is the first cell; life 1 wraps back to the first, which is what a looping flipbook does.
  assert.equal(d.flipbook.cells[0], 0);
  assert.equal(d.flipbook.cells[1], 4, 'life 0.5 of 8 cells is cell 4');
});

check('render: a mesh pass carries indices and per-vertex colour', () => {
  const box = evalNode('cadence.geometry.box', { size: [2, 2, 2] }, 'out', {}, 'rbox');
  const { commands } = renderGraph('cadence.render.mesh', {}, { baseColor: [1, 0, 0, 1] }, box);
  const d = RENDER.resolveScene(commands, {}).draws[0];
  assert.equal(d.kind, 'mesh');
  assert.ok(!d.instanced);
  assert.equal(d.indices.length, 12 * 3);
  assert.equal(d.positions.length, 24 * 3);
  near(d.vertexColors[0], 1, 1e-6);
  near(d.vertexColors[1], 0, 1e-6);
});

check('render: a mesh renderer given points warns instead of silently drawing nothing', () => {
  const { result } = renderGraph('cadence.render.mesh', {});   // threePoints has no faces
  assert.ok(result.diagnostics.some((d) => d.severity === 'warning' && /no faces/i.test(d.message)),
    `expected a "no faces" warning, got ${JSON.stringify(result.diagnostics)}`);
});

check('render: instances resolve to transforms, not to duplicated geometry', () => {
  const g = G.newGraph('i');
  const pts = G.newNode(g, 'cadence.geometry.pointCircle', 0, 0, { id: 'ipts', values: { count: 6, radius: 3 } });
  const box = G.newNode(g, 'cadence.geometry.box', 0, 200, { id: 'ibox', values: { size: [1, 1, 1] } });
  const inst = G.newNode(g, 'cadence.instance.onPoints', 200, 100, { id: 'iinst' });
  const ren = G.newNode(g, 'cadence.render.mesh', 400, 100, { id: 'iren' });
  const out = G.newNode(g, 'cadence.render.output', 600, 100, { id: 'iout' });
  assert.ok(G.connect(g, pts.id, 'out', inst.id, 'points').ok);
  assert.ok(G.connect(g, box.id, 'out', inst.id, 'geometry').ok);
  assert.ok(G.connect(g, inst.id, 'out', ren.id, 'instances').ok);
  assert.ok(G.connect(g, ren.id, 'out', out.id, 'passes').ok);

  const scene = RENDER.resolveScene(RENDER.flattenCommands(ev(g, out.id).value), {});
  const d = scene.draws[0];
  assert.ok(d.instanced, 'an instance set must resolve as instanced');
  assert.equal(d.count, 6);
  assert.equal(d.positions.length, 6 * 3, 'six transforms, not six copies of 24 vertices');
  assert.equal(d.rotations.length, 6 * 4);
  assert.equal(d.sources.length, 1, 'one shared source geometry');
  assert.equal(scene.stats.instances, 6);
});

check('render: strips resolve to polylines with per-vertex width and colour', () => {
  const g = G.newGraph('t');
  const helix = G.newNode(g, 'cadence.curveGeometry.helix', 0, 0, {
    id: 'thelix', values: { radius: 1, endRadius: 1, height: 4, turns: 2, segments: 24 },
  });
  const trail = G.newNode(g, 'cadence.render.trail', 200, 0, { id: 'ttrail', values: { width: 0.3 } });
  const out = G.newNode(g, 'cadence.render.output', 400, 0, { id: 'tout' });
  assert.ok(G.connect(g, helix.id, 'out', trail.id, 'source').ok);
  assert.ok(G.connect(g, trail.id, 'out', out.id, 'passes').ok);

  const d = RENDER.resolveScene(RENDER.flattenCommands(ev(g, out.id).value), {}).draws[0];
  assert.equal(d.strips.length, 1);
  const strip = d.strips[0];
  assert.equal(strip.count, 25, '24 segments is 25 points');
  assert.equal(strip.positions.length, 25 * 3);
  for (let k = 0; k < strip.count; k++) near(strip.widths[k], 0.3, 1e-6);
  // `along` must run 0 to 1 by LENGTH, which is what a width curve or a colour gradient is indexed by.
  near(strip.alongs[0], 0, 1e-9);
  near(strip.alongs[strip.count - 1], 1, 1e-9);
  for (let k = 1; k < strip.count; k++) {
    assert.ok(strip.alongs[k] > strip.alongs[k - 1], 'along must increase monotonically');
  }
});

check('render: a strip renderer given points warns rather than drawing nothing', () => {
  const { result } = renderGraph('cadence.render.trail', {});
  assert.ok(result.diagnostics.some((d) => /needs a curve/i.test(d.message)),
    `expected a "needs a curve" warning, got ${JSON.stringify(result.diagnostics)}`);
});

check('render: lights resolve per point, and a single light needs no geometry', () => {
  const { commands } = renderGraph('cadence.render.light', { intensity: 3, range: 12 });
  const d = RENDER.resolveScene(commands, {}).draws[0];
  assert.equal(d.count, 3);
  near(d.intensities[0], 3, 1e-6);
  near(d.ranges[0], 12, 1e-6);

  // No geometry: one light at the node's own position.
  const solo = evalNode('cadence.render.light', { position: [1, 2, 3], intensity: 5 }, 'out', {}, 'lsolo');
  const sd = RENDER.resolveScene([solo], {}).draws[0];
  assert.equal(sd.count, 1);
  nearArr(Array.from(sd.positions), [1, 2, 3], 1e-6);
});

check('render: an unconnected output warns rather than failing silently', () => {
  const g = G.newGraph('e');
  const out = G.newNode(g, 'cadence.render.output', 0, 0, { id: 'eout' });
  const r = ev(g, out.id);
  assert.ok(r.diagnostics.some((d) => /nothing is connected/i.test(d.message)),
    'an empty output must say so — this is the commonest reason a correct graph draws nothing');
});

check('render: the backend report names what a target cannot reproduce', () => {
  // Transmission is unsupported everywhere today, so it must be REPORTED, not quietly dropped.
  const g = G.newGraph('c');
  const src = G.newNode(g, 'test.geometry.constant', 0, 0, { id: 'csrc' });
  G.setNodeValue(g, src.id, 'geometry', threePoints());
  const mat = G.newNode(g, 'cadence.material.surface', 200, 200, { id: 'cmat' });
  const phys = G.newNode(g, 'cadence.material.physical', 400, 200, { id: 'cphys', values: { transmission: 0.9 } });
  const spr = G.newNode(g, 'cadence.render.sprite', 600, 0, { id: 'cspr' });
  const out = G.newNode(g, 'cadence.render.output', 800, 0, { id: 'cout' });
  assert.ok(G.connect(g, mat.id, 'out', phys.id, 'material').ok);
  assert.ok(G.connect(g, phys.id, 'out', spr.id, 'material').ok);
  assert.ok(G.connect(g, src.id, 'out', spr.id, 'source').ok);
  assert.ok(G.connect(g, spr.id, 'out', out.id, 'passes').ok);

  const commands = RENDER.flattenCommands(ev(g, out.id).value);
  const preview = RENDER.backendReport(commands, 'preview');
  assert.ok(preview.rows[0].droppedChannels.includes('transmission'),
    'the preview cannot refract, so transmission must be reported as dropped');
  assert.ok(!preview.ok, 'a report with dropped channels is not "fully supported"');

  // A ribbon is unsupported on Roblox and must be classified so.
  const rib = RENDER.backendReport([RENDER.newRenderCommand('ribbon', null, RENDER.DEFAULT_MATERIAL)], 'roblox');
  assert.equal(rib.rows[0].level, 'unsupported');
  // ...while a sprite is the one thing Roblox does natively.
  const sp = RENDER.backendReport([RENDER.newRenderCommand('sprite', null, RENDER.DEFAULT_MATERIAL)], 'roblox');
  assert.equal(sp.rows[0].level, 'native');
});

// ================================================================ the studio session
check('studio: a session survives playhead moves and drops on structural change', () => {
  const g = STUDIO.newStarterGraph('t');
  STUDIO.openSession(g, { fps: 30, duration: 60 });
  try {
    const first = STUDIO.evaluateFrame(10);
    assert.ok(first, 'a frame must resolve');
    assert.ok(first.stats.sprites > 0, `the starter graph must draw something, got ${JSON.stringify(first.stats)}`);

    // The simulation must persist across frames. If it restarted every frame the count would not grow.
    const later = STUDIO.evaluateFrame(30);
    assert.ok(later.stats.sprites > first.stats.sprites,
      `particles should accumulate (frame 10: ${first.stats.sprites}, frame 30: ${later.stats.sprites})`);

    const rep = STUDIO.report();
    assert.ok(rep.active);
    assert.equal(rep.stats.simulations, 1, 'exactly one simulation should be held');
    assert.ok(rep.stats.drawnElements > 0);
    assert.ok(rep.ok, `the starter graph must be technically valid: ${JSON.stringify(rep.diagnostics)}`);
  } finally {
    STUDIO.closeSession();
  }
});

check('studio: the starter graph is deterministic across a scrub', () => {
  const g = STUDIO.newStarterGraph('t');
  STUDIO.openSession(g, { fps: 30, duration: 60 });
  try {
    const snapshot = (scene) => {
      const d = scene.draws[0];
      const rows = [];
      for (let k = 0; k < d.count; k++) {
        rows.push([...Array.from(d.positions.slice(k * 3, k * 3 + 3)), d.sizes[k]]
          .map((v) => Math.round(v * 1e5) / 1e5));
      }
      return JSON.stringify(rows);
    };
    const forwards = snapshot(STUDIO.evaluateFrame(35));
    STUDIO.evaluateFrame(70);
    for (const f of [5, 60, 12, 48]) STUDIO.evaluateFrame(f);
    assert.equal(snapshot(STUDIO.evaluateFrame(35)), forwards,
      'a scrubbed procedural frame must match the frame reached by playing forwards');
  } finally {
    STUDIO.closeSession();
  }
});

check('studio: an empty graph reports why nothing is drawn instead of just being empty', () => {
  STUDIO.openSession(G.newGraph('empty'), { fps: 30 });
  try {
    const scene = STUDIO.evaluateFrame(0);
    assert.equal(scene.draws.length, 0);
    const rep = STUDIO.report();
    assert.ok(rep.diagnostics.some((d) => d.code === 'noOutput'),
      'an empty graph must say that nothing is connected to an output');
  } finally {
    STUDIO.closeSession();
  }
});

check('studio: a graph with a renderer but no output node still previews', () => {
  // "Add a sprite renderer and see nothing until you also add an output node" is a discouraging first
  // experience, so the session falls back to the newest render command.
  const g = G.newGraph('noout');
  const pts = PGRAPH_newNode(g, 'cadence.geometry.pointGrid', { countX: 2, countY: 1, countZ: 2 });
  const spr = PGRAPH_newNode(g, 'cadence.render.sprite', {});
  assert.ok(G.connect(g, pts.id, 'out', spr.id, 'source').ok);
  STUDIO.openSession(g, { fps: 30 });
  try {
    const scene = STUDIO.evaluateFrame(0);
    assert.equal(scene.stats.sprites, 4, 'the renderer alone should still preview');
  } finally {
    STUDIO.closeSession();
  }
});
function PGRAPH_newNode(g, type, values) {
  return G.newNode(g, type, 0, 0, { values });
}

check('studio: compatibility reporting reaches the session', () => {
  const g = STUDIO.newStarterGraph('t');
  STUDIO.openSession(g, { fps: 30 });
  try {
    STUDIO.evaluateFrame(20);
    const compat = STUDIO.compatibility('roblox');
    assert.ok(compat, 'the session must be able to report backend compatibility');
    assert.equal(compat.rows.length, 1);
    assert.equal(compat.rows[0].level, 'native', 'a sprite pass is native on Roblox');
  } finally {
    STUDIO.closeSession();
  }
});

check('studio: profiling attributes cost to nodes', () => {
  const g = STUDIO.newStarterGraph('t');
  STUDIO.openSession(g, { fps: 30 });
  try {
    STUDIO.evaluateFrame(30);
    const prof = STUDIO.profile(30);
    assert.ok(prof.nodes.length > 3, 'every evaluated node should appear');
    assert.ok(prof.nodes.every((n) => Number.isFinite(n.totalMs)));
    // The simulation is the expensive node in this graph; it should not be reported as free.
    const sim = prof.nodes.find((n) => (n.type || '').includes('simulate'));
    assert.ok(sim, 'the simulation node must be profiled');
  } finally {
    STUDIO.closeSession();
  }
});

// ================================================================ phase 9: baking and export
const BAKE = await import('../renderer/js/pnx/bake.js');
const RBX = await import('../renderer/js/pnx/targets/roblox.js');

// A structural validator for generated Luau. Not a parser — a parser is a project of its own — but it
// catches every failure mode a CODE GENERATOR actually has: an unclosed block, unbalanced brackets, a
// malformed number, an accidentally-emitted `undefined` or `NaN`. Without this, a generator bug ships as
// a script that fails to compile on paste, and the only way to find out is to paste it.
function checkLuaStructure(lua) {
  const problems = [];

  // Strip strings and comments first, or a brace inside a string throws the balance off.
  let code = lua
    .replace(/--\[\[[\s\S]*?\]\]/g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");

  // Bracket balance.
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  for (const ch of code) {
    if (pairs[ch]) stack.push(ch);
    else if (ch === ')' || ch === ']' || ch === '}') {
      const open = stack.pop();
      if (!open || pairs[open] !== ch) { problems.push(`unbalanced bracket near "${ch}"`); break; }
    }
  }
  if (stack.length) problems.push(`${stack.length} unclosed bracket(s): ${stack.join('')}`);

  // Block balance. Only three keywords open a block that `end` closes: `function`, `if`, and `do`.
  // `for` and `while` are NOT openers — each is always followed by its own `do`, which is what gets
  // closed. Counting them as openers too double-counts every loop, which is exactly the bug the first
  // version of this checker had: it reported valid generated code as having unclosed blocks.
  // `repeat ... until` needs no `end` at all, so neither word counts.
  const words = code.match(/\b[a-zA-Z_]\w*\b/g) || [];
  let depth = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === 'function' || w === 'if' || w === 'do') depth++;
    else if (w === 'end') depth--;
    if (depth < 0) { problems.push(`an "end" with no matching block at word ${i}`); break; }
  }
  if (depth > 0) problems.push(`${depth} block(s) never closed with "end"`);

  // Things a generator emits by accident and Luau will not accept.
  for (const bad of ['undefined', 'NaN', 'Infinity', 'null', '[object Object]']) {
    // ESCAPED: "[object Object]" contains brackets, and unescaped it becomes a character class that
    // matches almost any letter — the check then fired on every valid script it was handed.
    const needle = bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^\\w"])${needle}([^\\w"]|$)`).test(code)) problems.push(`emitted a JavaScript value: ${bad}`);
  }
  // A number like `1.2.3` or a stray `,,`
  if (/\d+\.\d*\.\d/.test(code)) problems.push('malformed number literal');
  if (/,\s*,/.test(code)) problems.push('empty element in a table constructor');

  return problems;
}

check('bake: field probing identifies what a field actually depends on', () => {
  // This is the technique the whole exporter branches on, so it is worth testing directly: a field is
  // an opaque closure, and the strategy is decided by sampling it rather than by reading the graph.
  const strategy = (f) => BAKE.bakeStrategy(f).kind;
  assert.equal(strategy(3), 'constant', 'a plain number depends on nothing');
  assert.equal(strategy(F.constantField('float', 5)), 'constant');
  assert.equal(strategy(F.makeField('float', (c) => c.life * 2)), 'sequence', 'life-only becomes a NumberSequence');
  assert.equal(strategy(F.makeField('float', (c) => c.age * 2)), 'sequence', 'age is the same axis as life');
  assert.equal(strategy(F.makeField('float', (c) => (c.index % 7) / 7)), 'range', 'index-only becomes a range');
  assert.equal(strategy(F.makeField('float', (c) => c.position[0])), 'perFrame', 'spatial has no Roblox equivalent');
  assert.equal(strategy(F.makeField('float', (c) => c.velocity[1])), 'perFrame');
  assert.equal(strategy(F.makeField('float', (c) => c.life + c.index)), 'sequenceRange');
  assert.equal(strategy(F.makeField('float', (c) => c.life + c.position[2])), 'perFrame',
    'life plus position is still spatial, so it must not be mistaken for a sequence');

  // A field that returns the same value everywhere reads as constant — stated as a known limit of the
  // probe rather than pretended away. It degrades fidelity, never correctness.
  assert.equal(strategy(F.makeField('float', () => 1)), 'constant');
});

check('bake: sequences and ranges sample what they claim', () => {
  const f = F.makeField('float', (c) => c.life * 10);
  const pts = BAKE.bakeSequence(f, { samples: 5 });
  assert.equal(pts.length, 5);
  near(pts[0].t, 0, 1e-9); near(pts[0].v, 0, 1e-9);
  near(pts[4].t, 1, 1e-9); near(pts[4].v, 10, 1e-9);

  const r = BAKE.bakeRange(F.makeField('float', (c) => 5 + (c.index % 10)));
  assert.equal(r.min, 5);
  assert.equal(r.max, 14);
});

check('bake: a particle cache records rows keyed by stable particle id', () => {
  const { sim, e } = simGraph({ emitter: { rate: 30, lifetime: 2, velocity: [0, 5, 0] } });
  const evaluateFrame = (frame) => {
    e.setTime(frame);
    const r = e.evaluateSocket(sim.id, 'out');
    return RENDER.resolveScene([RENDER.newRenderCommand('sprite', r.value, RENDER.DEFAULT_MATERIAL, { size: 0.4 })], { frame });
  };
  const cache = BAKE.bakeParticleCache(evaluateFrame, { from: 0, to: 30, stride: 2, maxParticles: 200 });
  assert.ok(cache.stats.totalRows > 50, `expected recorded rows, got ${cache.stats.totalRows}`);
  assert.ok(cache.stats.peakParticles > 5);
  assert.ok(cache.stats.estimatedBytes > 0);

  // Identity is the part that matters: a cache keyed by array position is worthless because particles
  // die and the table compacts, so slot 3 is a different particle every frame.
  const late = cache.frames[cache.frames.length - 1];
  const ids = late.rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'ids within a frame must be unique');
  // More particles have existed than are alive at once, so the highest id seen must exceed the peak
  // per-frame count. If ids were array positions they could never exceed it, which is the whole point.
  // Ids come from the solver's own counter, so they keep climbing as particles are born and die.
  // The highest id seen must therefore exceed the highest id present on the first populated frame,
  // which array positions could never do.
  const allIds = cache.frames.flatMap((f) => f.rows.map((r) => r.id));
  const highestId = Math.max(...allIds);
  const firstIds = (cache.frames.find((f) => f.rows.length) || { rows: [] }).rows.map((r) => r.id);
  assert.ok(highestId > Math.max(0, ...firstIds),
    `ids must climb as particles are born (highest ${highestId}, first frame ${firstIds.join(',')})`);

  // A tracked particle's recorded position must move monotonically upward under an upward velocity.
  const tracked = ids[0];
  const path = cache.frames.map((f) => f.rows.find((r) => r.id === tracked)).filter(Boolean);
  assert.ok(path.length >= 2, 'a particle should appear in several frames');
  for (let k = 1; k < path.length; k++) {
    assert.ok(path[k].p[1] >= path[k - 1].p[1] - 1e-6,
      'a particle launched upward must not move down in the cache — that would mean ids are being confused');
  }
});

check('bake: the size budget is measured and refuses honestly', () => {
  const small = BAKE.describeBudget(10_000);
  assert.ok(small.ok);
  assert.equal(small.message, null, 'a small script needs no warning');
  const big = BAKE.describeBudget(5_000_000);
  assert.ok(!big.ok);
  assert.ok(/reduce the frame range|stride|particle count/i.test(big.message), 'a refusal must say what to change');
});

// ---------------------------------------------------------------- the Roblox exporter
function exportGraph(g, { fps = 30, duration = 60, bake = {} } = {}) {
  const e = new E.Evaluator(g, { fps, duration });
  const out = Object.values(g.nodes).find((nd) => nd.type.startsWith('cadence.render.output'));
  assert.ok(out, 'the graph needs an Effect Output');
  e.setTime(Math.floor(duration / 2));
  const commands = RENDER.flattenCommands(e.evaluateSocket(out.id, 'out').value);
  const evaluateFrame = (frame) => {
    e.setTime(frame);
    return RENDER.resolveScene(RENDER.flattenCommands(e.evaluateSocket(out.id, 'out').value), { frame });
  };
  return RBX.buildRobloxExport({ commands, graph: g, evaluator: e, evaluateFrame, name: 'Test', fps, duration, bake });
}

check('export: a simple sprite effect becomes a real ParticleEmitter', () => {
  const built = exportGraph(STUDIO.newStarterGraph('t'));
  assert.equal(built.report.counts.native, 1, `expected a native pass: ${JSON.stringify(built.report.rows.map((r) => [r.level, r.reasons]))}`);
  assert.ok(built.lua.includes('Instance.new("ParticleEmitter")'));
  // The gradient and the size curve must survive as real Roblox sequences, not as averages.
  assert.ok(built.lua.includes('ColorSequence.new({'), 'the colour gradient must become a ColorSequence');
  assert.ok(built.lua.includes('NumberSequence.new({'), 'the size curve must become a NumberSequence');
  assert.ok(/Acceleration = Vector3\.new\(0, -6/.test(built.lua), 'constant gravity must become Acceleration');
  assert.ok(built.bytes < 20000, `a native export should be small, got ${built.bytes} bytes`);
  assert.deepEqual(checkLuaStructure(built.lua), [], 'the generated Luau must be structurally sound');
});

check('export: an explicit opacity is not lost behind the colour alpha', () => {
  // Both the opacity channel and the base colour's alpha land on Roblox's single Transparency property.
  // Branching on one or the other silently discards whichever lost, which is what an earlier version of
  // this exporter did with a constant 0.35 opacity.
  const g = G.newGraph('o');
  const em = G.newNode(g, 'cadence.particles.emitter', 0, 0, { id: 'oem', values: { rate: 20, lifetime: 1 } });
  const sim = G.newNode(g, 'cadence.particles.simulate', 200, 0, { id: 'osim' });
  const mat = G.newNode(g, 'cadence.material.surface', 200, 200, { id: 'omat', values: { opacity: 0.25 } });
  const spr = G.newNode(g, 'cadence.render.sprite', 400, 0, { id: 'ospr' });
  const out = G.newNode(g, 'cadence.render.output', 600, 0, { id: 'oout' });
  assert.ok(G.connect(g, em.id, 'out', sim.id, 'emitter').ok);
  assert.ok(G.connect(g, sim.id, 'out', spr.id, 'source').ok);
  assert.ok(G.connect(g, mat.id, 'out', spr.id, 'material').ok);
  assert.ok(G.connect(g, spr.id, 'out', out.id, 'passes').ok);

  const built = exportGraph(g);
  // Transparency is 1 - alpha, so 0.25 opacity is 0.75 transparency.
  assert.ok(/Transparency = NumberSequence\.new\(0\.75\)/.test(built.lua),
    `expected transparency 0.75 from opacity 0.25, got: ${(/Transparency = [^\n]*/.exec(built.lua) || [])[0]}`);
  // And LightEmission must appear at most once — writing it twice is a generator slip, not a feature.
  assert.ok((built.lua.match(/\.LightEmission =/g) || []).length <= 1, 'LightEmission must be written once');
});

check('export: a colliding, curl-forced effect is BAKED, with both reasons named', () => {
  const g = G.newGraph('b');
  const em = G.newNode(g, 'cadence.particles.emitter', 0, 0, { id: 'bem', values: { rate: 40, lifetime: 2, velocity: [0, 6, 0] } });
  const curl = G.newNode(g, 'cadence.noise.curl', 0, 200, { id: 'bcurl', values: { scale: 0.4 } });
  const plane = G.newNode(g, 'cadence.sdf.plane', 0, 400, { id: 'bpl' });
  const col = G.newNode(g, 'cadence.particles.collider', 200, 400, { id: 'bcol' });
  const sim = G.newNode(g, 'cadence.particles.simulate', 400, 0, { id: 'bsim', values: { maxParticles: 300 } });
  const spr = G.newNode(g, 'cadence.render.sprite', 600, 0, { id: 'bspr', values: { size: 0.3 } });
  const out = G.newNode(g, 'cadence.render.output', 800, 0, { id: 'bout' });
  assert.ok(G.connect(g, em.id, 'out', sim.id, 'emitter').ok);
  assert.ok(G.connect(g, curl.id, 'out', sim.id, 'force').ok);
  assert.ok(G.connect(g, plane.id, 'out', col.id, 'shape').ok);
  assert.ok(G.connect(g, col.id, 'out', sim.id, 'colliders').ok);
  assert.ok(G.connect(g, sim.id, 'out', spr.id, 'source').ok);
  assert.ok(G.connect(g, spr.id, 'out', out.id, 'passes').ok);

  const built = exportGraph(g, { duration: 40, bake: { stride: 2, maxParticles: 100 } });
  const row = built.report.rows[0];
  assert.equal(row.level, 'baked');
  const why = row.reasons.join(' | ');
  assert.ok(/collide/i.test(why), `the collider must be named as a reason: ${why}`);
  assert.ok(/force varies/i.test(why), `the spatial force must be named as a reason: ${why}`);

  // The bake must contain actual recorded data, and be structurally valid Luau.
  assert.ok(/_FRAMES = \{/.test(built.lua), 'a baked pass must emit a frame table');
  assert.ok(built.bytes > 5000, `a bake should contain real data, got ${built.bytes} bytes`);
  assert.deepEqual(checkLuaStructure(built.lua), [], 'baked Luau must be structurally sound');
  assert.ok(built.notes.some((nt) => /recording rather than a simulation/i.test(nt)),
    'the user must be told a bake is a recording, not a simulation');
});

check('export: a mesh pass is refused with a reason, never faked', () => {
  const g = G.newGraph('m');
  const sph = G.newNode(g, 'cadence.geometry.sphere', 0, 0, { id: 'msph', values: { radius: 2 } });
  const ren = G.newNode(g, 'cadence.render.mesh', 200, 0, { id: 'mren' });
  const out = G.newNode(g, 'cadence.render.output', 400, 0, { id: 'mout9' });
  assert.ok(G.connect(g, sph.id, 'out', ren.id, 'source').ok);
  assert.ok(G.connect(g, ren.id, 'out', out.id, 'passes').ok);

  const built = exportGraph(g);
  assert.equal(built.report.rows[0].level, 'unsupported');
  assert.ok(/cannot build a mesh at runtime/i.test(built.report.rows[0].reasons[0]),
    'the refusal must explain WHY, not merely refuse');
  // And it must not have quietly emitted several hundred parts instead.
  assert.ok(!/Instance\.new\("Part"\)[\s\S]*Instance\.new\("Part"\)[\s\S]*Instance\.new\("Part"\)/.test(built.lua)
    || built.lua.includes('not exported'), 'an unsupported pass must not be silently approximated');
  assert.deepEqual(checkLuaStructure(built.lua), []);
});

check('export: a light becomes a PointLight with its values baked per frame', () => {
  const g = G.newGraph('l');
  const pt = G.newNode(g, 'cadence.geometry.point', 0, 0, { id: 'lpt', values: { position: [0, 3, 0] } });
  const life = G.newNode(g, 'cadence.time.effectTime', 0, 200, { id: 'ltime' });
  const light = G.newNode(g, 'cadence.render.light', 200, 0, { id: 'llight', values: { intensity: 4, range: 15 } });
  const out = G.newNode(g, 'cadence.render.output', 400, 0, { id: 'lout' });
  assert.ok(G.connect(g, pt.id, 'out', light.id, 'source').ok);
  assert.ok(G.connect(g, light.id, 'out', out.id, 'passes').ok);

  const built = exportGraph(g, { duration: 20 });
  assert.equal(built.report.rows[0].level, 'converted');
  assert.ok(built.lua.includes('Instance.new("PointLight")'));
  assert.ok(/Range = math\.clamp/.test(built.lua), 'the range must be clamped to Roblox\'s own limit');
  assert.deepEqual(checkLuaStructure(built.lua), []);
});

check('export: a beam becomes a Roblox Beam and says what it lost', () => {
  const g = G.newGraph('bm');
  const helix = G.newNode(g, 'cadence.curveGeometry.helix', 0, 0, { id: 'bmh', values: { radius: 1, endRadius: 1, height: 6, turns: 2, segments: 20 } });
  const beam = G.newNode(g, 'cadence.render.beam', 200, 0, { id: 'bmb', values: { width: 0.4 } });
  const out = G.newNode(g, 'cadence.render.output', 400, 0, { id: 'bmo' });
  assert.ok(G.connect(g, helix.id, 'out', beam.id, 'source').ok);
  assert.ok(G.connect(g, beam.id, 'out', out.id, 'passes').ok);

  const built = exportGraph(g, { duration: 20 });
  assert.equal(built.report.rows[0].level, 'converted');
  assert.ok(built.lua.includes('Instance.new("Beam")'));
  assert.ok(built.notes.some((nt) => /curvature in the original is lost/i.test(nt)),
    'a 20-segment helix flattened to a 2-point Beam must say so');
  assert.deepEqual(checkLuaStructure(built.lua), []);
});

check('export: an empty graph produces a valid script that explains itself', () => {
  const g = G.newGraph('e');
  G.newNode(g, 'cadence.render.output', 0, 0, { id: 'eout9' });
  const built = exportGraph(g);
  assert.deepEqual(checkLuaStructure(built.lua), [], 'even a nothing-to-export script must be valid Luau');
  assert.ok(/Nothing in this effect could be exported/.test(built.lua));
});

check('export: the report classifies every pass and names the level honestly', () => {
  // Several passes at once: one native, one unsupported. The report must not collapse them.
  const g = G.newGraph('mix');
  const em = G.newNode(g, 'cadence.particles.emitter', 0, 0, { id: 'xem', values: { rate: 20, lifetime: 1 } });
  const sim = G.newNode(g, 'cadence.particles.simulate', 200, 0, { id: 'xsim' });
  const spr = G.newNode(g, 'cadence.render.sprite', 400, 0, { id: 'xspr' });
  const sph = G.newNode(g, 'cadence.geometry.sphere', 0, 300, { id: 'xsph' });
  const mesh = G.newNode(g, 'cadence.render.mesh', 400, 300, { id: 'xmesh' });
  const out = G.newNode(g, 'cadence.render.output', 600, 0, { id: 'xout' });
  assert.ok(G.connect(g, em.id, 'out', sim.id, 'emitter').ok);
  assert.ok(G.connect(g, sim.id, 'out', spr.id, 'source').ok);
  assert.ok(G.connect(g, sph.id, 'out', mesh.id, 'source').ok);
  assert.ok(G.connect(g, spr.id, 'out', out.id, 'passes').ok);
  assert.ok(G.connect(g, mesh.id, 'out', out.id, 'passes').ok);

  const built = exportGraph(g, { duration: 30 });
  assert.equal(built.report.rows.length, 2, 'both passes must be classified');
  const levels = built.report.rows.map((r) => r.level).sort();
  assert.deepEqual(levels, ['native', 'unsupported']);
  assert.ok(!built.report.lossless, 'an export that loses a pass is not lossless');
  assert.ok(built.report.exportable, 'but it is still partly exportable');
  // The header comment must carry the classification, so the script explains itself months later.
  assert.ok(/pass 1 \(sprite\): NATIVE/.test(built.lua));
  assert.ok(/pass 2 \(mesh\): UNSUPPORTED/.test(built.lua));
  assert.deepEqual(checkLuaStructure(built.lua), []);
});

check('export: the Luau structure checker actually catches broken output', () => {
  // A validator that never fails is worthless, so it is negative-tested. Each of these is a real
  // failure mode of a code generator.
  assert.ok(checkLuaStructure('local function f() return 1').length, 'must catch an unclosed function');
  assert.ok(checkLuaStructure('local t = {1, 2').length, 'must catch an unclosed table');
  assert.ok(checkLuaStructure('local x = undefined').length, 'must catch a leaked JavaScript value');
  assert.ok(checkLuaStructure('local x = NaN').length, 'must catch NaN');
  assert.ok(checkLuaStructure('local t = {1,,2}').length, 'must catch an empty table element');
  assert.ok(checkLuaStructure('local x = 1 end').length, 'must catch a stray end');
  assert.ok(checkLuaStructure('for i=1,3 do print(i)').length, 'must catch an unclosed for loop');
  // ...and pass on valid code, including the shapes the generator actually emits: nested functions,
  // numeric and generic for loops, if/else, and a table of tables.
  assert.deepEqual(checkLuaStructure('local function f(a) if a then return 1 else return 2 end end\nfor i=1,3 do print(i) end'), []);
  assert.deepEqual(checkLuaStructure('for _, k in ipairs(t) do if k > 1 then print(k) end end'), []);
  assert.deepEqual(checkLuaStructure('local T = {\n  [0] = {1,2,3},\n  [2] = {4,5,6},\n}\nwhile x do y() end'), []);
  assert.deepEqual(checkLuaStructure('local c = RunService.Heartbeat:Connect(function() print("x") end)'), []);
});

// ================================================================ phase 7: textures
const TEX = await import('../renderer/js/pnx/texture.js');

check('texture: sampling puts a texel colour at the texel CENTRE', () => {
  // The half-pixel offset is the detail that is always wrong first time. A 2x2 texture sampled at the
  // centre of each texel must return that texel exactly; without the offset, every sample is a
  // quarter-pixel-shifted blur and a gradient comes out subtly wrong everywhere.
  const t = TEX.newTexture(2, 2, { filter: 'linear', wrap: 'clamp' });
  TEX.setPixel(t, 0, 0, [1, 0, 0, 1]);
  TEX.setPixel(t, 1, 0, [0, 1, 0, 1]);
  TEX.setPixel(t, 0, 1, [0, 0, 1, 1]);
  TEX.setPixel(t, 1, 1, [1, 1, 0, 1]);
  nearArr(TEX.sampleTexture(t, 0.25, 0.25), [1, 0, 0, 1], 1e-6);
  nearArr(TEX.sampleTexture(t, 0.75, 0.25), [0, 1, 0, 1], 1e-6);
  nearArr(TEX.sampleTexture(t, 0.25, 0.75), [0, 0, 1, 1], 1e-6);
  // ...and halfway between two texels is their average.
  nearArr(TEX.sampleTexture(t, 0.5, 0.25), [0.5, 0.5, 0, 1], 1e-6);
});

check('texture: wrap modes address correctly outside the texture', () => {
  const build = (wrap) => {
    const t = TEX.newTexture(4, 1, { wrap, filter: 'nearest' });
    for (let x = 0; x < 4; x++) TEX.setPixel(t, x, 0, [x / 3, 0, 0, 1]);
    return t;
  };
  const at = (t, x) => TEX.getPixel(t, x, 0)[0];
  const rep = build('repeat');
  near(at(rep, 4), at(rep, 0), 1e-6, 'repeat must wrap round');
  near(at(rep, -1), at(rep, 3), 1e-6, 'and wrap backwards too');
  const cl = build('clamp');
  near(at(cl, 9), at(cl, 3), 1e-6, 'clamp must hold the edge');
  near(at(cl, -5), at(cl, 0), 1e-6);
  const mi = build('mirror');
  near(at(mi, 4), at(mi, 3), 1e-6, 'mirror must reflect at the boundary, not jump');
  near(at(mi, 5), at(mi, 2), 1e-6);
});

check('texture: rasterizing a field gives each pixel its own uv and a world position', () => {
  // A field written for 3D space must rasterize sensibly without the user converting coordinates by
  // hand, so the rasterizer supplies both uv and a position on the z=0 plane.
  const uvField = F.makeField('color', (c) => [c.uv[0], c.uv[1], 0, 1]);
  const t = TEX.rasterize(uvField, 4);
  nearArr(TEX.getPixel(t, 0, 0).slice(0, 2), [0.125, 0.125], 1e-6, 'the first texel is half a texel in');
  nearArr(TEX.getPixel(t, 3, 3).slice(0, 2), [0.875, 0.875], 1e-6);

  const posField = F.makeField('color', (c) => [c.position[0], c.position[1], 0, 1]);
  const p = TEX.rasterize(posField, 4, 4, { extent: 2 });
  // extent 2 means the texture spans -2..2, so the first texel's centre is at -1.5.
  nearArr(TEX.getPixel(p, 0, 0).slice(0, 2), [-1.5, -1.5], 1e-6);
  nearArr(TEX.getPixel(p, 3, 3).slice(0, 2), [1.5, 1.5], 1e-6);
});

check('texture: a rasterized texture round-trips back into a field', () => {
  const g = G.newGraph('t');
  const src = G.newNode(g, 'cadence.texture.solid', 0, 0, { id: 'tsolid', values: { color: [0.25, 0.5, 0.75, 1], resolution: 4 } });
  const smp = G.newNode(g, 'cadence.texture.sample', 200, 0, { id: 'tsamp' });
  assert.ok(G.connect(g, src.id, 'out', smp.id, 'texture').ok);
  const f = ev(g, smp.id).value;
  assert.ok(F.isField(f), 'Sample Texture must produce a field');
  nearArr(f.sample(F.newSampleContext({ uv: [0.5, 0.5] })), [0.25, 0.5, 0.75, 1], 1e-4);
});

check('texture: blur is separable and actually softens', () => {
  // A single bright texel, blurred, must spread into its neighbours and conserve roughly its total
  // energy. A blur that brightens or darkens overall means the kernel is not normalised.
  const t = TEX.newTexture(16, 16, { wrap: 'clamp' });
  TEX.setPixel(t, 8, 8, [1, 1, 1, 1]);
  const before = sumChannel(t, 0);
  const blurred = TEX.blurTexture(t, 3);
  assert.ok(TEX.getPixel(blurred, 8, 8)[0] < 1, 'the bright texel must lose intensity');
  assert.ok(TEX.getPixel(blurred, 9, 8)[0] > 0, 'and its neighbour must gain some');
  near(sumChannel(blurred, 0), before, 0.05, 'a normalised kernel conserves total brightness');
});

function sumChannel(tex, channel) {
  let s = 0;
  for (let i = 0; i < tex.width * tex.height; i++) s += tex.data[i * 4 + channel];
  return s;
}

check('texture: grow and shrink are inverse in the obvious direction', () => {
  const t = TEX.newTexture(24, 24, { wrap: 'clamp' });
  for (let y = 10; y < 14; y++) for (let x = 10; x < 14; x++) TEX.setPixel(t, x, y, [1, 1, 1, 1]);
  const opaque = (tx) => {
    let n = 0;
    for (let i = 0; i < tx.width * tx.height; i++) if (tx.data[i * 4 + 3] > 0.5) n++;
    return n;
  };
  const base = opaque(t);
  assert.ok(opaque(TEX.morphTexture(t, 2, 1)) > base, 'grow must cover more');
  assert.ok(opaque(TEX.morphTexture(t, 1, -1)) < base, 'shrink must cover less');
});

check('texture: edge detect finds a boundary and ignores a flat field', () => {
  const flat = TEX.solidTexture([0.5, 0.5, 0.5, 1], 16);
  const flatEdges = TEX.edgeTexture(flat, 1);
  for (let i = 0; i < 16 * 16; i++) near(flatEdges.data[i * 4], 0, 1e-6, 'a flat texture has no edges');

  const split = TEX.newTexture(16, 16, { wrap: 'clamp' });
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) TEX.setPixel(split, x, y, x < 8 ? [0, 0, 0, 1] : [1, 1, 1, 1]);
  const edges = TEX.edgeTexture(split, 1);
  assert.ok(TEX.getPixel(edges, 8, 8)[0] > 0.5, 'the boundary must light up');
  assert.ok(TEX.getPixel(edges, 2, 8)[0] < 0.1, 'and the flat interior must not');
});

check('texture: a normal map from flat height is flat, and a slope tilts the right way', () => {
  const flat = TEX.solidTexture([0.5, 0.5, 0.5, 1], 8);
  const nrm = TEX.normalFromHeight(flat, 1);
  // Packed 0..1, so a flat surface is (0.5, 0.5, 1) — straight up in tangent space.
  nearArr(TEX.getPixel(nrm, 4, 4).slice(0, 3), [0.5, 0.5, 1], 1e-4);

  // A left-to-right ramp must tilt the normal along x, and the sign must be consistent.
  const ramp = TEX.newTexture(16, 16, { wrap: 'clamp' });
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const h = x / 15; TEX.setPixel(ramp, x, y, [h, h, h, 1]); }
  const rn = TEX.normalFromHeight(ramp, 4);
  assert.ok(TEX.getPixel(rn, 8, 8)[0] < 0.5, 'an uphill-to-the-right slope must tilt the normal left');
});

check('texture: warp reads offsets as signed, so neutral grey does nothing', () => {
  const base = TEX.newTexture(16, 16, { wrap: 'clamp', filter: 'nearest' });
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) TEX.setPixel(base, x, y, [x / 15, 0, 0, 1]);
  // 0.5 grey means "no offset". Reading offsets as 0..1 instead would displace everything by half the
  // amount, which looks like the warp being permanently on.
  const neutral = TEX.solidTexture([0.5, 0.5, 0.5, 1], 16);
  const unwarped = TEX.warpTexture(base, neutral, 0.25);
  for (const x of [2, 8, 14]) near(TEX.getPixel(unwarped, x, 8)[0], TEX.getPixel(base, x, 8)[0], 1e-3,
    'a neutral offset map must leave the texture alone');

  const pushed = TEX.warpTexture(base, TEX.solidTexture([1, 0.5, 0.5, 1], 16), 0.25);
  assert.ok(TEX.getPixel(pushed, 8, 8)[0] > TEX.getPixel(base, 8, 8)[0], 'a positive offset must shift the source');
});

check('texture: levels stretches a narrow range to full contrast', () => {
  const g = G.newGraph('t');
  // A texture whose values all sit between 0.4 and 0.6 — the shape raw noise actually has.
  const narrow = TEX.newTexture(8, 8, { wrap: 'clamp' });
  for (let i = 0; i < 64; i++) {
    const v = 0.4 + (i / 63) * 0.2;
    narrow.data[i * 4] = narrow.data[i * 4 + 1] = narrow.data[i * 4 + 2] = v;
    narrow.data[i * 4 + 3] = 1;
  }
  const src = G.newNode(g, 'test.texture.constant', 0, 0, { id: 'lsrc' });
  G.setNodeValue(g, src.id, 'texture', narrow);
  const lv = G.newNode(g, 'cadence.texture.levels', 200, 0, { id: 'llv', values: { inputBlack: 0.4, inputWhite: 0.6 } });
  assert.ok(G.connect(g, src.id, 'out', lv.id, 'texture').ok);
  const out = ev(g, lv.id).value;
  near(TEX.getPixel(out, 0, 0)[0], 0, 1e-5, 'the darkest value must reach 0');
  near(TEX.getPixel(out, 7, 7)[0], 1, 1e-5, 'and the brightest must reach 1');
});

check('texture: blend modes composite as they claim', () => {
  const a = TEX.solidTexture([0.4, 0.4, 0.4, 1], 4);
  const b = TEX.solidTexture([0.25, 0.25, 0.25, 1], 4);
  const blend = (m, amount = 1) => {
    const g = G.newGraph('t');
    const sa = G.newNode(g, 'test.texture.constant', 0, 0, { id: `ba_${m}` });
    const sb = G.newNode(g, 'test.texture.constant', 0, 200, { id: `bb_${m}` });
    G.setNodeValue(g, sa.id, 'texture', a);
    G.setNodeValue(g, sb.id, 'texture', b);
    const bl = G.newNode(g, 'cadence.texture.blend', 200, 100, { id: `bl_${m}`, values: { blend: m, amount } });
    assert.ok(G.connect(g, sa.id, 'out', bl.id, 'a').ok);
    assert.ok(G.connect(g, sb.id, 'out', bl.id, 'b').ok);
    return TEX.getPixel(ev(g, bl.id).value, 1, 1)[0];
  };
  near(blend('add'), 0.65, 1e-5);
  near(blend('subtract'), 0.15, 1e-5);
  near(blend('multiply'), 0.1, 1e-5);
  near(blend('difference'), 0.15, 1e-5);
  near(blend('min'), 0.25, 1e-5);
  near(blend('max'), 0.4, 1e-5);
  near(blend('mix', 0.5), 0.325, 1e-5);
  // `over` is real alpha compositing, so an opaque layer fully replaces the base.
  near(blend('over'), 0.25, 1e-5);
});

check('texture: a flipbook lays frames out in a grid and advances through them', () => {
  const g = G.newGraph('t');
  // A field constant in space and varying only with time, so each cell should be a different uniform
  // brightness — which makes the layout checkable rather than merely plausible.
  //
  // SAMPLE Time, not Effect Time. Effect Time reads the playhead and is one number for the whole
  // evaluation, so a flipbook driven by it produces a sheet of identical cells: the field is already
  // collapsed before the flipbook asks for anything. This distinction did not have a node until the
  // flipbook exposed the gap.
  const timeField = G.newNode(g, 'cadence.time.sampleTime', 0, 0, { id: 'ftime' });
  const book = G.newNode(g, 'cadence.texture.flipbook', 200, 0, {
    id: 'fbook',
    values: { columns: 2, rows: 2, cellSize: 8, duration: 4 },
  });
  assert.ok(G.connect(g, timeField.id, 'out', book.id, 'field').ok);

  const r = ev(g, book.id, 'out');
  const sheet = r.value;
  assert.equal(sheet.width, 16, 'two columns of 8px cells');
  assert.equal(sheet.height, 16);
  assert.equal(ev(g, book.id, 'frames').value, 4);
  // Cell 0 covers time 0 and cell 1 covers time 1, so they must differ.
  const cell0 = TEX.getPixel(sheet, 4, 4)[0];
  const cell1 = TEX.getPixel(sheet, 12, 4)[0];
  assert.notEqual(cell0, cell1, 'consecutive flipbook cells must show different moments');
  near(cell0, 0, 1e-5, 'the first cell is time 0');
  near(cell1, 1, 1e-5, 'the second cell is time 1 of a 4-second sheet over 4 frames');

  // The trap, asserted rather than merely documented: Effect Time gives identical cells.
  const g2 = G.newGraph('t');
  const graphTime = G.newNode(g2, 'cadence.time.effectTime', 0, 0, { id: 'gt' });
  const book2 = G.newNode(g2, 'cadence.texture.flipbook', 200, 0, {
    id: 'fbook2', values: { columns: 2, rows: 1, cellSize: 8, duration: 4 },
  });
  assert.ok(G.connect(g2, graphTime.id, 'seconds', book2.id, 'field').ok);
  const flat = ev(g2, book2.id, 'out').value;
  assert.equal(TEX.getPixel(flat, 4, 4)[0], TEX.getPixel(flat, 12, 4)[0],
    'Effect Time is one number per evaluation, so it must produce identical cells — this is why Sample Time exists');
});

check('texture: UV transform rotates and tiles about its pivot', () => {
  const uv = (values, at) => sampleNode('cadence.texture.uvTransform', values, 'out', { uv: at }, {}, 'uvt');
  // Identity leaves the coordinate alone.
  nearArr(uv({}, [0.25, 0.75]), [0.25, 0.75], 1e-6);
  // Tiling doubles the distance from the pivot, not from the origin.
  nearArr(uv({ tiling: [2, 2] }, [0.75, 0.5]), [1, 0.5], 1e-6);
  // A quarter turn about the centre maps right to up.
  nearArr(uv({ rotation: 90 }, [1, 0.5]), [0.5, 1], 1e-6);
  // Offset is applied last.
  nearArr(uv({ offset: [0.1, -0.2] }, [0.5, 0.5]), [0.6, 0.3], 1e-6);
});

check('texture: glow brightens only what is above the threshold', () => {
  const g = G.newGraph('t');
  // Half dark, half bright. The dark half must stay dark: blurring the WHOLE image and adding it back
  // would wash the dark half out, which reads as fog rather than as glow.
  const t = TEX.newTexture(32, 32, { wrap: 'clamp' });
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) TEX.setPixel(t, x, y, x < 8 ? [0, 0, 0, 1] : [1, 1, 1, 1]);
  const src = G.newNode(g, 'test.texture.constant', 0, 0, { id: 'gsrc' });
  G.setNodeValue(g, src.id, 'texture', t);
  const glow = G.newNode(g, 'cadence.compositing.glow', 200, 0, { id: 'gglow', values: { threshold: 0.6, radius: 3, intensity: 1 } });
  assert.ok(G.connect(g, src.id, 'out', glow.id, 'texture').ok);
  const out = ev(g, glow.id).value;
  near(TEX.getPixel(out, 0, 16)[0], 0, 1e-3, 'far into the dark half must stay black');
  assert.ok(TEX.getPixel(out, 6, 16)[0] > 0.01, 'just outside the bright edge must pick up spill');
  assert.ok(TEX.getPixel(out, 20, 16)[0] > 1, 'the bright interior must be pushed above 1');
});

check('texture: colour grade adjusts contrast about mid-grey, not about zero', () => {
  const g = G.newGraph('t');
  const src = G.newNode(g, 'test.texture.constant', 0, 0, { id: 'csrc' });
  G.setNodeValue(g, src.id, 'texture', TEX.solidTexture([0.5, 0.5, 0.5, 1], 4));
  const grade = G.newNode(g, 'cadence.compositing.colorGrade', 200, 0, { id: 'cg', values: { contrast: 2 } });
  assert.ok(G.connect(g, src.id, 'out', grade.id, 'texture').ok);
  // Mid-grey is the pivot, so raising contrast must leave it exactly where it was. Pivoting about zero
  // instead would double it, which darkens or brightens an image as a side effect of adding contrast.
  near(TEX.getPixel(ev(g, grade.id).value, 1, 1)[0], 0.5, 1e-6);

  // Exposure is in stops.
  const exp = G.newNode(g, 'cadence.compositing.colorGrade', 200, 200, { id: 'ce', values: { exposure: 1 } });
  assert.ok(G.connect(g, src.id, 'out', exp.id, 'texture').ok);
  near(TEX.getPixel(ev(g, exp.id).value, 1, 1)[0], 1, 1e-6, '+1 stop doubles the brightness');
});

check('texture: an unconnected texture input produces nothing rather than a wrong image', () => {
  for (const type of ['cadence.texture.blur', 'cadence.texture.levels', 'cadence.texture.edges',
    'cadence.compositing.glow', 'cadence.compositing.vignette']) {
    const v = evalNode(type, {}, 'out', {}, `empty_${type}`);
    assert.equal(v, null, `${type} with no texture must return null, not a blank image`);
  }
});

check('texture: float storage keeps values above 1 until they are quantised', () => {
  // Emission above 1 is normal in VFX, and an intermediate that clamps loses the highlights a glow
  // needs. The clamp happens at toBytes(), not before.
  const t = TEX.solidTexture([2.5, 0.5, 0.25, 1], 2);
  near(TEX.getPixel(t, 0, 0)[0], 2.5, 1e-6, 'the float buffer must hold values above 1');
  const bytes = TEX.toBytes(t);
  assert.equal(bytes.data[0], 255, 'and only clamp when quantised to 8-bit');
  assert.equal(bytes.data[1], 128);
});

// ================================================================ phase 11: groups and the library
const GRP = await import('../renderer/js/pnx/groups.js');
const LIB = await import('../renderer/js/pnx/library.js');

// A chain of three multiplies with an external source and an external sink, so the boundary of a
// collapse is unambiguous and checkable.
function chainForGrouping() {
  const g = G.newGraph('t');
  const src = G.newNode(g, 'cadence.math.pi', 0, 0, { id: 'src' });
  const a = G.newNode(g, 'cadence.math.multiply', 200, 0, { id: 'a', values: { b: 2 } });
  const b = G.newNode(g, 'cadence.math.multiply', 400, 0, { id: 'b', values: { b: 3 } });
  const sink = G.newNode(g, 'cadence.math.add', 600, 0, { id: 'sink', values: { b: 1 } });
  assert.ok(G.connect(g, src.id, 'out', a.id, 'a').ok);
  assert.ok(G.connect(g, a.id, 'out', b.id, 'a').ok);
  assert.ok(G.connect(g, b.id, 'out', sink.id, 'a').ok);
  return { g, src, a, b, sink };
}

check('groups: collapsing a selection preserves what the graph computes', () => {
  // The property that matters: a collapse is bookkeeping, so the value at the sink must be identical
  // before and after. pi * 2 * 3 + 1.
  const { g, a, b, sink } = chainForGrouping();
  const before = ev(g, sink.id).value;
  near(before, Math.PI * 6 + 1, 1e-9);

  const res = GRP.collapseToGroup(g, [a.id, b.id], { name: 'Scale' });
  assert.ok(res.ok, res.reason);
  assert.equal(res.enclosed, 2);
  assert.equal(res.inputs.length, 1, 'one external source crosses in, so one input');
  assert.equal(res.outputs.length, 1, 'one internal value crosses out, so one output');
  near(ev(g, sink.id).value, before, 1e-9, 'collapsing must not change the result');

  // And the nodes really moved into the group's scope — a group is a scope of ordinary nodes, not a
  // new kind of node with hidden behaviour (Part 46: no black boxes).
  assert.equal(g.nodes[a.id].scope, res.groupId);
  assert.equal(g.nodes[b.id].scope, res.groupId);
  const interior = G.nodesInScope(g, res.groupId);
  assert.equal(interior.length, 4, 'two enclosed nodes plus the two boundary nodes');
  assert.ok(interior.some((nd) => nd.type === G.GROUP_INPUT_TYPE));
  assert.ok(interior.some((nd) => nd.type === G.GROUP_OUTPUT_TYPE));
});

check('groups: one external source feeding several inner sockets makes ONE shared input', () => {
  // Keyed by the external source rather than by the internal target. Getting this backwards produces a
  // group with four identical inputs where one belongs, which is the classic collapse bug.
  const g = G.newGraph('t');
  const src = G.newNode(g, 'cadence.math.pi', 0, 0, { id: 'psrc' });
  const m1 = G.newNode(g, 'cadence.math.multiply', 200, 0, { id: 'pm1' });
  const m2 = G.newNode(g, 'cadence.math.multiply', 200, 200, { id: 'pm2' });
  const add = G.newNode(g, 'cadence.math.add', 400, 100, { id: 'padd' });
  assert.ok(G.connect(g, src.id, 'out', m1.id, 'a').ok);
  assert.ok(G.connect(g, src.id, 'out', m2.id, 'a').ok);
  assert.ok(G.connect(g, m1.id, 'out', add.id, 'a').ok);
  assert.ok(G.connect(g, m2.id, 'out', add.id, 'b').ok);

  const res = GRP.collapseToGroup(g, [m1.id, m2.id, add.id], { name: 'Twice' });
  assert.ok(res.ok, res.reason);
  assert.equal(res.inputs.length, 1, `one source, so one input — got ${res.inputs.length}`);
  assert.equal(res.outputs.length, 0, 'nothing crosses out, so no outputs');
});

check('groups: one inner output feeding several external sockets makes ONE shared output', () => {
  const g = G.newGraph('t');
  const inner = G.newNode(g, 'cadence.math.pi', 0, 0, { id: 'qi' });
  const s1 = G.newNode(g, 'cadence.math.multiply', 200, 0, { id: 'qs1' });
  const s2 = G.newNode(g, 'cadence.math.multiply', 200, 200, { id: 'qs2' });
  assert.ok(G.connect(g, inner.id, 'out', s1.id, 'a').ok);
  assert.ok(G.connect(g, inner.id, 'out', s2.id, 'a').ok);

  const res = GRP.collapseToGroup(g, [inner.id], { name: 'Source' });
  assert.ok(res.ok, res.reason);
  assert.equal(res.outputs.length, 1, `one inner source, so one output — got ${res.outputs.length}`);
  // Both external consumers must still be fed.
  const fedBy = Object.values(g.links).filter((l) => l.fromNode === res.instanceId);
  assert.equal(fedBy.length, 2, 'both external consumers must be reconnected to the instance');
});

check('groups: collapse refuses the cases that have no meaning', () => {
  const { g, a, b } = chainForGrouping();
  assert.ok(!GRP.collapseToGroup(g, []).ok, 'an empty selection must be refused');

  const res = GRP.collapseToGroup(g, [a.id, b.id], { name: 'G' });
  assert.ok(res.ok);
  const interior = G.nodesInScope(g, res.groupId);
  const gIn = interior.find((nd) => nd.type === G.GROUP_INPUT_TYPE);
  // A group's own boundary node cannot be enclosed by another group — the interior would then have two
  // conflicting notions of where the boundary is.
  assert.ok(!GRP.collapseToGroup(g, [gIn.id, interior[0].id]).ok, 'a boundary node must not be enclosable');

  // Nodes from two different scopes cannot be one group.
  const outside = G.newNode(g, 'cadence.math.pi', 900, 0, { id: 'ox' });
  assert.ok(!GRP.collapseToGroup(g, [outside.id, a.id]).ok, 'nodes in different scopes must be refused');
});

check('groups: a group used twice keeps two independent evaluations', () => {
  // The cache is namespaced by instance path, so two instances with different inputs must not share
  // cached values. This is what makes a reusable group actually reusable.
  const g = G.newGraph('t');
  const m = G.newNode(g, 'cadence.math.multiply', 0, 0, { id: 'gm', values: { b: 10 } });
  const res = GRP.collapseToGroup(g, [m.id], { name: 'TimesTen' });
  assert.ok(res.ok, res.reason);
  // The collapse produced no boundary at all (nothing crossed), so wire the group up by hand.
  const interior = G.nodesInScope(g, res.groupId);
  const gIn = interior.find((nd) => nd.type === G.GROUP_INPUT_TYPE);
  const gOut = interior.find((nd) => nd.type === G.GROUP_OUTPUT_TYPE);
  g.groups[res.groupId].inputs = [{ key: 'v', label: 'Value', type: 'float', default: 0 }];
  g.groups[res.groupId].outputs = [{ key: 'r', label: 'Result', type: 'float' }];
  assert.ok(G.connect(g, gIn.id, 'v', m.id, 'a').ok);
  assert.ok(G.connect(g, m.id, 'out', gOut.id, 'r').ok);

  const i2 = GRP.instantiateGroup(g, res.groupId, 400, 200);
  assert.ok(i2.ok);
  G.setNodeValue(g, res.instanceId, 'v', 3);
  G.setNodeValue(g, i2.nodeId, 'v', 7);

  const e = new E.Evaluator(g, {});
  near(e.evaluateSocket(res.instanceId, 'r').value, 30, 1e-9);
  near(e.evaluateSocket(i2.nodeId, 'r').value, 70, 1e-9, 'the second instance must not reuse the first\'s cached value');
});

check('groups: a group cannot be made to contain itself', () => {
  const g = G.newGraph('t');
  const grp = G.newGroupDef(g, 'Outer', { inputs: [], outputs: [] });
  const inside = GRP.instantiateGroup(g, grp.id, 0, 0, { scope: grp.id });
  assert.ok(!inside.ok, 'placing a group inside itself must be refused, or evaluation is infinite');
  assert.ok(/contain itself/i.test(inside.reason));
});

check('groups: expanding restores the interior and keeps the result', () => {
  const { g, a, b, sink } = chainForGrouping();
  const before = ev(g, sink.id).value;
  const res = GRP.collapseToGroup(g, [a.id, b.id], { name: 'Scale' });
  assert.ok(res.ok);
  near(ev(g, sink.id).value, before, 1e-9);

  const exp = GRP.expandGroup(g, res.instanceId);
  assert.ok(exp.ok, exp.reason);
  assert.equal(exp.expanded, 2, 'both enclosed nodes must come back');
  assert.equal(g.nodes[res.instanceId], undefined, 'the instance must be gone');
  near(ev(g, sink.id).value, before, 1e-9, 'expanding must not change the result either');
});

check('groups: expanding one instance does not break the others', () => {
  // Expanding COPIES the interior rather than moving it. Moving it would empty the group and break every
  // other instance — the sort of thing that only surfaces once a group has been used twice.
  const g = G.newGraph('t');
  const m = G.newNode(g, 'cadence.math.multiply', 0, 0, { id: 'em', values: { a: 4, b: 5 } });
  const res = GRP.collapseToGroup(g, [m.id], { name: 'Twenty' });
  assert.ok(res.ok);
  g.groups[res.groupId].outputs = [{ key: 'r', label: 'Result', type: 'float' }];
  const gOut = G.nodesInScope(g, res.groupId).find((nd) => nd.type === G.GROUP_OUTPUT_TYPE);
  assert.ok(G.connect(g, m.id, 'out', gOut.id, 'r').ok);

  const second = GRP.instantiateGroup(g, res.groupId, 400, 200);
  assert.ok(second.ok);
  assert.ok(GRP.expandGroup(g, res.instanceId).ok);
  // The surviving instance must still evaluate.
  near(ev(g, second.nodeId, 'r').value, 20, 1e-9, 'the other instance must still work after one was expanded');
});

check('groups: export and import round-trip through a different graph', () => {
  const { g, a, b } = chainForGrouping();
  const res = GRP.collapseToGroup(g, [a.id, b.id], { name: 'Scale by six' });
  assert.ok(res.ok);

  const payload = GRP.exportGroup(g, res.groupId);
  assert.ok(payload, 'a group must be exportable');
  assert.equal(payload.cadenceNodeGroup, 1);
  assert.equal(payload.name, 'Scale by six');

  // Into a FRESH graph, which is the case that matters — the same-graph case can accidentally work by
  // reusing ids that already happen to exist.
  const g2 = G.newGraph('other');
  const imported = GRP.importGroup(g2, JSON.parse(JSON.stringify(payload)));
  assert.ok(imported.ok, imported.reason);
  assert.equal(imported.name, 'Scale by six');
  assert.ok(imported.nodes >= 2);

  // The imported group must evaluate to the same thing the original did.
  const inst = GRP.instantiateGroup(g2, imported.groupId, 0, 0);
  assert.ok(inst.ok);
  const src = G.newNode(g2, 'cadence.math.pi', -200, 0, { id: 'isrc' });
  const inKey = g2.groups[imported.groupId].inputs[0].key;
  const outKey = g2.groups[imported.groupId].outputs[0].key;
  assert.ok(G.connect(g2, src.id, 'out', inst.nodeId, inKey).ok);
  near(ev(g2, inst.nodeId, outKey).value, Math.PI * 6, 1e-9);
});

check('groups: importing twice does not collide', () => {
  const { g, a, b } = chainForGrouping();
  const res = GRP.collapseToGroup(g, [a.id, b.id], { name: 'Scale' });
  const payload = GRP.exportGroup(g, res.groupId);
  const g2 = G.newGraph('other');
  const one = GRP.importGroup(g2, JSON.parse(JSON.stringify(payload)));
  const two = GRP.importGroup(g2, JSON.parse(JSON.stringify(payload)));
  assert.ok(one.ok && two.ok);
  assert.notEqual(one.groupId, two.groupId, 'ids must be remapped, not reused');
  assert.equal(Object.keys(g2.groups).length, 2);
});

check('groups: an imported group serializes and reloads', () => {
  const { g, a, b } = chainForGrouping();
  const res = GRP.collapseToGroup(g, [a.id, b.id], { name: 'Scale' });
  assert.ok(res.ok);
  const parsed = G.parseGraph(JSON.parse(G.serializeGraph(g)));
  assert.ok(parsed.ok, parsed.error);
  assert.ok(parsed.graph.groups[res.groupId], 'the group definition must survive a save/load');
  assert.equal(G.nodesInScope(parsed.graph, res.groupId).length, 4);
  near(ev(parsed.graph, 'sink').value, Math.PI * 6 + 1, 1e-9, 'and still evaluate the same');
});

// ---------------------------------------------------------------- the library (Part 47)
check('library: every recipe builds, wires cleanly, and evaluates to its declared type', () => {
  // Part 47's own acceptance test is that the library is composition, not capability — so each entry has
  // to be buildable from primitives that already exist, and every wire in it has to take. A recipe with
  // a failed connection would produce a half-wired group that looks like the user's mistake.
  const recipes = LIB.listRecipes();
  assert.ok(recipes.length >= 8, `expected a real library, got ${recipes.length} recipes`);

  for (const r of recipes) {
    assert.ok(r.available, `${r.id} names a node type this build does not have`);
    assert.ok(r.description && r.teaches, `${r.id} must explain itself and what it teaches`);

    const g = G.newGraph('t');
    const built = LIB.buildRecipe(g, r.id);
    assert.ok(built.ok, `${r.id}: ${built.reason}`);
    assert.deepEqual(built.failures, [], `${r.id} had connections that did not take`);

    // Instantiate and evaluate the first output, to prove the group actually produces something of the
    // type it claims rather than merely being wired.
    const inst = GRP.instantiateGroup(g, built.groupId, 600, 0);
    assert.ok(inst.ok, `${r.id}: ${inst.reason}`);
    const outKey = r.outputs[0];
    const res = ev(g, inst.nodeId, outKey);
    const errors = res.diagnostics.filter((d) => d.severity === 'error');
    assert.deepEqual(errors, [], `${r.id} evaluated with errors: ${JSON.stringify(errors)}`);
    assert.ok(res.value !== null && res.value !== undefined, `${r.id} produced nothing on "${outKey}"`);
  }
});

check('library: the engine does not depend on the library existing', () => {
  // Part 47's stated test: "A user should be able to delete the entire complete-effect library and still
  // build new effects." Asserted structurally — the library must define no node types and nothing in the
  // engine may import it, so removing the file changes what is convenient and not what is possible.
  const before = R.nodeCount();
  LIB.listRecipes();
  for (const r of LIB.listRecipes()) LIB.buildRecipe(G.newGraph('t'), r.id);
  assert.equal(R.nodeCount(), before, 'the library must not register any node types');
});

check('library: what it cannot build yet is named, not silently missing', () => {
  // Part 47 lists Impact Camera and Smoke Advection; this engine has neither the camera nodes nor the
  // volume solver. Saying so beats letting a user conclude the library is arbitrarily incomplete.
  assert.ok(LIB.UNAVAILABLE.length >= 2);
  for (const u of LIB.UNAVAILABLE) {
    assert.ok(u.name && u.why, 'each unavailable entry must say why');
    assert.ok(/not built|Part \d/i.test(u.why), `"${u.name}" should point at what is missing: ${u.why}`);
  }
});

check('library: a recipe naming a missing node type fails loudly', () => {
  // Recipes are re-evaluated against the LIVE registry rather than being frozen documents, which is what
  // lets them pick up an improved node — and means a removed node must produce a clear refusal instead
  // of a silently broken subgraph.
  const res = LIB.buildRecipe(G.newGraph('t'), 'nonexistentRecipe');
  assert.ok(!res.ok);
  assert.ok(/no recipe/i.test(res.reason));
});

// ================================================================ phase 8: volume grids
const VOL = await import('../renderer/js/pnx/volume.js');

check('volume: a baked grid reproduces the field it came from', () => {
  // The whole justification for volumes today is that they CACHE an expensive field. That only holds if
  // sampling the cache agrees with sampling the original, so this is the load-bearing test.
  const field = F.makeField('float', (c) => c.position[0] + c.position[1] * 0.5);
  const vol = VOL.rasterizeVolume(field, 32, { center: [0, 0, 0], size: [4, 4, 4] });
  for (const p of [[0, 0, 0], [1, 1, 0], [-1.5, 0.5, 1], [1.8, -1.8, -1.8]]) {
    near(VOL.sampleVolume(vol, p), p[0] + p[1] * 0.5, 0.08,
      `the cache must agree with the field at ${p}`);
  }
});

check('volume: sampling holds the edge value outside the box rather than wrapping', () => {
  // A density field has a boundary. Wrapping would make smoke re-enter on the far side, which reads as
  // a bug in the effect rather than in the sampler.
  const vol = VOL.rasterizeVolume(F.makeField('float', (c) => c.position[0]), 16, { size: [4, 4, 4] });
  const atEdge = VOL.sampleVolume(vol, [1.9, 0, 0]);
  const wayOut = VOL.sampleVolume(vol, [50, 0, 0]);
  near(wayOut, atEdge, 0.2, 'far outside must hold the edge, not wrap round to the other side');
});

check('volume: a volume reads back as a field, so particles can use it', () => {
  const g = G.newGraph('t');
  const noise = G.newNode(g, 'cadence.noise.fbm', 0, 0, { id: 'vnoise', values: { scale: 2 } });
  const bake = G.newNode(g, 'cadence.volume.rasterize', 200, 0, { id: 'vbake', values: { resolution: 16, size: [4, 4, 4] } });
  const smp = G.newNode(g, 'cadence.volume.sample', 400, 0, { id: 'vsamp' });
  assert.ok(G.connect(g, noise.id, 'out', bake.id, 'field').ok);
  assert.ok(G.connect(g, bake.id, 'out', smp.id, 'volume').ok);

  const f = ev(g, smp.id).value;
  assert.ok(F.isField(f), 'Sample Volume must produce a field');
  const a = f.sample(F.newSampleContext({ position: [0.5, 0.5, 0.5] }));
  const b = f.sample(F.newSampleContext({ position: [-1, 1, 0] }));
  assert.ok(Number.isFinite(a) && Number.isFinite(b));
  assert.notEqual(a, b, 'a baked noise volume must vary through space');
});

check('volume: 3D blur smooths and conserves the average', () => {
  // A single hot voxel spread over its neighbours. A blur that changes the total is not normalised.
  const vol = VOL.newVolume(16, { size: [4, 4, 4] });
  VOL.setVoxel(vol, 8, 8, 8, 100);
  const before = VOL.describeVolume(vol);
  const blurred = VOL.blurVolume(vol, 2, 1);
  const after = VOL.describeVolume(blurred);
  near(after.average, before.average, before.average * 0.05, 'a box blur must conserve the average');
  assert.ok(after.range.max < before.range.max, 'the peak must come down');
  assert.ok(after.occupancy > before.occupancy, 'and the density must spread to more voxels');
});

check('volume: setVoxel writes where it says, and rejects out of range', () => {
  // The index arithmetic is the easiest thing here to get wrong, and a transposed axis is invisible on
  // symmetric data — so each axis is written and read back separately.
  const vol = VOL.newVolume(8, { size: [8, 8, 8], center: [0, 0, 0] });
  VOL.setVoxel(vol, 1, 0, 0, 11);
  VOL.setVoxel(vol, 0, 2, 0, 22);
  VOL.setVoxel(vol, 0, 0, 3, 33);
  assert.equal(VOL.getVoxel(vol, 1, 0, 0), 11);
  assert.equal(VOL.getVoxel(vol, 0, 2, 0), 22, 'the y axis must not be transposed with x');
  assert.equal(VOL.getVoxel(vol, 0, 0, 3), 33, 'nor z');
  assert.equal(VOL.getVoxel(vol, 0, 1, 0), 0, 'and nothing must leak into a neighbour');

  VOL.setVoxel(vol, -1, 0, 0, 99);
  VOL.setVoxel(vol, 8, 0, 0, 99);
  let total = 0;
  for (let i = 0; i < vol.data.length; i++) total += vol.data[i];
  assert.equal(total, 66, 'an out-of-range write must be dropped, not wrap into a valid voxel');
});

check('volume: world and voxel coordinates round-trip', () => {
  const vol = VOL.newVolume(8, { center: [10, 0, -5], size: [4, 4, 4] });
  // The centre voxel of an even grid straddles the middle, so check the corners, where the mapping is
  // unambiguous: the first voxel centre is half a voxel in from the low corner.
  const low = VOL.worldOfVoxel(vol, 0, 0, 0);
  nearArr(low, [10 - 2 + 0.25, -2 + 0.25, -5 - 2 + 0.25], 1e-6);
  const high = VOL.worldOfVoxel(vol, 7, 7, 7);
  nearArr(high, [10 + 2 - 0.25, 2 - 0.25, -5 + 2 - 0.25], 1e-6);
});

check('volume: combining samples the layer at the base grid, not the other way round', () => {
  // A fine detail volume combined into a coarse base must not upscale the base.
  const coarse = VOL.rasterizeVolume(F.constantField('float', 1), 8, { size: [4, 4, 4] });
  const fine = VOL.rasterizeVolume(F.constantField('float', 0.5), 32, { size: [4, 4, 4] });
  const sum = VOL.zipVolumes(coarse, fine, (a, b) => a + b);
  assert.equal(sum.resolution, 8, 'the result keeps the BASE resolution');
  near(VOL.sampleVolume(sum, [0, 0, 0]), 1.5, 1e-5);
});

check('volume: moving a volume changes its box without touching its data', () => {
  const vol = VOL.rasterizeVolume(F.makeField('float', (c) => c.position[0]), 16, { size: [4, 4, 4] });
  const moved = VOL.transformVolume(vol, { center: [10, 0, 0] });
  // The same data, addressed at the new location. Resampling instead would blur it for no reason.
  assert.deepEqual(Array.from(moved.data.slice(0, 8)), Array.from(vol.data.slice(0, 8)));
  near(VOL.sampleVolume(moved, [10, 0, 0]), VOL.sampleVolume(vol, [0, 0, 0]), 1e-5);
});

check('volume: occupancy reports how much of the box is actually used', () => {
  // The number that explains a sparse-looking volume effect: a box far bigger than its content.
  const tiny = VOL.rasterizeVolume(
    F.makeField('float', (c) => (V.vLength(c.position) < 0.3 ? 1 : 0)),
    24, { size: [8, 8, 8] },
  );
  const d = VOL.describeVolume(tiny);
  assert.ok(d.occupancy < 0.05, `a small blob in a big box must report low occupancy, got ${d.occupancy}`);
  const full = VOL.rasterizeVolume(F.constantField('float', 1), 8, { size: [4, 4, 4] });
  near(VOL.describeVolume(full).occupancy, 1, 1e-6);
});

check('volume: the unimplemented backends are declared, and no node can use them', () => {
  // Part 78 enforced mechanically rather than by memory: `volume` is declared but unimplemented, so the
  // registry REFUSES any node whose socket names it. A Pyro or Volume Renderer button cannot be created
  // by accident, which is a stronger guarantee than a comment.
  assert.ok(!T.isImplementedType(T.parseType('volume')), 'the simulated volume type must stay unimplemented');
  assert.ok(T.isImplementedType(T.parseType('volumeGrid')), 'the grid type that IS built must be usable');

  assert.throws(() => R.registerNode({
    id: 'test.volume.pyro', version: 1, label: 'Pyro', category: 'Pyro',
    summary: 'Would need the fluid solver.',
    exportSupport: 'unsupported',
    inputs: [{ key: 'v', label: 'Volume', type: 'volume' }],
    outputs: [{ key: 'out', label: 'Out', type: 'volume' }],
    evaluate: () => null,
  }), /not yet implemented/, 'registering against an unimplemented type must be refused');

  // ...and each absent backend must say what it is, why, and what it would take.
  for (const [key, u] of Object.entries(VOL.UNIMPLEMENTED)) {
    assert.ok(u.what && u.why && u.needs, `${key} must state what, why and what it needs`);
    assert.ok(Array.isArray(u.parts) && u.parts.length, `${key} must cite the spec part it comes from`);
  }
});

check('volume: the capabilities node answers the question from inside the graph', () => {
  // The answer to "can this engine simulate smoke" has to be available to an MCP caller, not only in a
  // comment — so it is a node, reading the engine's own record rather than a duplicated string.
  const g = G.newGraph('t');
  const caps = G.newNode(g, 'cadence.volume.capabilities', 0, 0, { id: 'caps' });
  assert.equal(ev(g, caps.id, 'hasFluidSolver').value, false);
  assert.equal(ev(g, caps.id, 'hasVolumeRendering').value, false);
  const missing = ev(g, caps.id, 'missing').value;
  assert.ok(/advection|pressure/i.test(missing), `the missing list must name the solver: ${missing}`);
  assert.ok(/raymarch/i.test(missing), 'and the renderer');
  const built = ev(g, caps.id, 'built').value;
  assert.ok(/cache|blur|spawn/i.test(built), `and it must say what volumes ARE good for: ${built}`);
});

// ================================================================
console.log(`\nPNX: ${passed} passed, ${failed} failed  (${R.nodeCount()} node types registered)`);
if (failed) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
