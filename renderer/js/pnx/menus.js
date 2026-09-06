// The Effect Sheet's source menus and "add a thing" gallery (docs/effect-sheet.md §5.1, §5.3, §5.5).
//
// EVERYTHING HERE IS A COMPOSITION OF REGISTRY NODES, never a capability. Choosing "over its life" on a
// size slot builds `Normalized Age → Evaluate Curve` and wires it in — the same two nodes a person
// would place on the canvas, which is why the node editor shows exactly what the sheet did. Deleting
// this module removes some convenience and changes nothing about what the engine can express (the
// same test the library passes, Part 47).
//
// Every entry carries its Roblox export level so the sheet can badge a choice BEFORE it is made: a
// size over life becomes a NumberSequence (native); a size by position has no Roblox equivalent and
// bakes. That is bake.js's classification, stated one level earlier.
//
// Pure: no DOM. The sheet asks `menuFor()` for the entries of a slot and calls `applyEntry()` on the
// one chosen, inside ST.mutatePnx so it is one undo step.

import * as G from './graph.js';
import * as T from './types.js';
import * as REG from './registry.js';
import { feedersFor } from './sheet.js';

// ---------------------------------------------------------------- slot classification
// Which menu a slot gets. From its type first, then a hint from its key/label where the type alone
// is ambiguous (a vector3 that is a direction wants cones and normals; one that is a position wants
// points and paths).
export function slotKindOf(socket) {
  const type = T.parseType(socket.type);
  if (!type) return null;
  const inner = T.isFieldType(type) ? type.param : type;
  const name = inner?.name;
  const key = String(socket.key || '').toLowerCase();
  const label = String(socket.label || '').toLowerCase();
  const hint = key + ' ' + label;
  if (socket.socket === false) return 'mode';
  if (T.containsGeneric(type)) return 'number';
  switch (name) {
    case 'float': case 'int': return 'number';
    case 'bool': return 'bool';
    case 'color': return 'colour';
    case 'vector3':
      if (key === 'force') return 'force';
      if (/velocity|direction|axis|normal|up\b/.test(hint)) return 'direction';
      return 'position';
    case 'geometry': return 'shape';
    case 'collider': return 'collider';
    case 'texture2d': return 'texture';
    case 'material': return 'material';
    case 'event': return 'events';
    case 'emitter': return 'emitter';
    case 'instanceSet': return 'instances';
    case 'curve': return 'curve';
    case 'gradient': return 'gradient';
    case 'renderCommand': return 'pass';
    case 'volumeGrid': return 'volume';
    default: return 'other';
  }
}

// ---------------------------------------------------------------- building helpers
// New nodes are placed to the left of the node they feed, stacked, so the canvas stays readable when
// the user presses "Show as nodes".
function placer(graph, target) {
  let k = 0;
  return (type, values = {}, extra = {}) => {
    const n = G.newNode(graph, type, (target?.x ?? 0) - 320 - (extra.col || 0) * 300, (target?.y ?? 0) + k * 120, { scope: target?.scope ?? G.ROOT_SCOPE, values });
    k++;
    return n;
  };
}
function link(graph, a, sa, b, sb) {
  const r = G.connect(graph, a.id, sa, b.id, sb);
  if (!r.ok) throw new Error(`could not connect ${a.type}.${sa} → ${b.type}.${sb}: ${r.reason}`);
  return r.link;
}
function unlink(graph, node, socketKey) {
  for (const [lid, l] of Object.entries(graph.links)) if (l.toNode === node.id && l.toSocket === socketKey) delete graph.links[lid];
}
function currentSource(graph, node, socketKey) {
  const l = G.linksInto(graph, node.id, socketKey)[0];
  return l ? { node: graph.nodes[l.fromNode], socket: l.fromSocket } : null;
}
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const vlen = (v) => (Array.isArray(v) ? Math.hypot(v[0] || 0, v[1] || 0, v[2] || 0) : 0);
const scaledCurve = (base, shape) => ({ kind: 'float', keys: shape.map(([t, k]) => ({ t, v: base * k })) });
const EMBER = { kind: 'color', stops: [{ u: 0, v: '#fff6e0' }, { u: 0.25, v: '#ffb040' }, { u: 0.7, v: '#c02808' }, { u: 1, v: '#200400' }] };
// Something that reads as "what you have now": the literal, or the magnitude of a wired vector.
function baseNumber(graph, node, socket) {
  const v = node.values?.[socket.key];
  if (typeof v === 'number') return v;
  if (typeof socket.default === 'number') return socket.default;
  return 1;
}
function baseVector(node, socket, fallback) {
  const v = node.values?.[socket.key];
  return Array.isArray(v) && vlen(v) > 1e-6 ? v : (Array.isArray(socket.default) && vlen(socket.default) > 1e-6 ? socket.default : fallback);
}

// An entry: { id, label, teach, roblox, apply(graph, node, socket) -> { nodes:[ids], focus?: id } }
const E = (id, label, teach, roblox, apply, extra = {}) => ({ id, label, teach, roblox, apply, ...extra });
const PGRAPH_socketsOf = (g, n) => G.socketsOf(g, n);

// ---------------------------------------------------------------- menus per slot kind
const MENUS = {
  number: (graph, node, socket) => {
    const v = baseNumber(graph, node, socket);
    const unit = socket.unit ? ` ${socket.unit}` : '';
    return [
      E('fixed', 'a number', 'One value, the same for every particle and every frame.', 'native', (g, n, s) => { unlink(g, n, s.key); return { nodes: [] }; }),
      E('random', 'random for each particle', `Every particle gets its own value, between two limits (${fmt(v * 0.7)} to ${fmt(v * 1.3)}${unit} to start).`, 'range', (g, n, s) => {
        const at = placer(g, n); const r = at('cadence.random.float', { min: v * 0.7, max: v * 1.3 }); link(g, r, 'out', n, s.key); return { nodes: [r.id], focus: r.id };
      }),
      E('overLife', 'over its life', 'A curve from birth to death: grows, shrinks, fades — drag it on the life strip.', 'sequence', (g, n, s) => {
        const at = placer(g, n); const life = at('cadence.particles.life', {}, { col: 1 }); const c = at('cadence.curve.evaluate', { curve: scaledCurve(v, [[0, 0.2], [0.25, 1], [1, 0]]) }); link(g, life, 'out', c, 'position'); link(g, c, 'out', n, s.key); return { nodes: [life.id, c.id], focus: c.id };
      }),
      E('overTime', "over the effect's time", 'A curve along the effect timeline, the same for every particle: build up, hold, die away.', 'scheduled', (g, n, s) => {
        const at = placer(g, n); const t = at('cadence.time.effectTime', {}, { col: 1 }); const c = at('cadence.curve.evaluate', { curve: scaledCurve(v, [[0, 0], [0.3, 1], [1, 0]]) }); link(g, t, 'normalized', c, 'position'); link(g, c, 'out', n, s.key); return { nodes: [t.id, c.id], focus: c.id };
      }),
      E('byHeight', 'by how high it is', 'Changes with height: low is one value, high is another.', 'baked', (g, n, s) => {
        const at = placer(g, n); const p = at('cadence.fields.position', {}, { col: 2 }); const sep = at('cadence.vector.separate', {}, { col: 1 }); const m = at('cadence.math.mapRange', { fromMin: 0, fromMax: 5, toMin: v * 0.5, toMax: v * 1.5, clamp: true }); link(g, p, 'out', sep, 'vector'); link(g, sep, 'y', m, 'value'); link(g, m, 'out', n, s.key); return { nodes: [p.id, sep.id, m.id], focus: m.id };
      }),
      E('byDistance', 'by distance from a point', 'Near the point is one value, far away is another. Drag the point on the stage.', 'baked', (g, n, s) => {
        const at = placer(g, n); const d = at('cadence.fields.distance', { center: [0, 0, 0] }, { col: 1 }); const m = at('cadence.math.mapRange', { fromMin: 0, fromMax: 5, toMin: v * 1.5, toMax: v * 0.5, clamp: true }); link(g, d, 'out', m, 'value'); link(g, m, 'out', n, s.key); return { nodes: [d.id, m.id], focus: d.id };
      }),
      E('bySpeed', 'by how fast it goes', 'Slow particles get one value, fast ones another.', 'baked', (g, n, s) => {
        const at = placer(g, n); const sp = at('cadence.particles.speed', {}, { col: 1 }); const m = at('cadence.math.mapRange', { fromMin: 0, fromMax: 10, toMin: v * 0.5, toMax: v * 1.5, clamp: true }); link(g, sp, 'out', m, 'value'); link(g, m, 'out', n, s.key); return { nodes: [sp.id, m.id], focus: m.id };
      }),
      E('crowding', 'by how crowded it is', 'Bigger or brighter where particles bunch up.', 'baked', (g, n, s) => {
        const at = placer(g, n); const c = at('cadence.particles.density', { radius: 1.5 }, { col: 1 }); const m = at('cadence.math.mapRange', { fromMin: 1, fromMax: 4, toMin: v, toMax: v * 2, clamp: true }); link(g, c, 'out', m, 'value'); link(g, m, 'out', n, s.key); return { nodes: [c.id, m.id], focus: m.id };
      }),
      E('noise', 'noise', 'A smooth random pattern over space, so nearby particles get similar values.', 'baked', (g, n, s) => {
        const at = placer(g, n); const f = at('cadence.noise.fbm', { scale: 1, octaves: 3 }, { col: 1 }); const m = at('cadence.math.mapRange', { fromMin: 0, fromMax: 1, toMin: v * 0.5, toMax: v * 1.5, clamp: true }); link(g, f, 'out', m, 'value'); link(g, m, 'out', n, s.key); return { nodes: [f.id, m.id], focus: f.id };
      }),
      E('maths', 'this × another value', 'Keep what is here and multiply it by something else — a random factor, a fade, a distance.', null, (g, n, s) => {
        const at = placer(g, n); const cur = currentSource(g, n, s.key); const m = at('cadence.math.multiply', { a: cur ? 0 : v, b: 1 }); if (cur) link(g, cur.node, cur.socket, m, 'a'); link(g, m, 'out', n, s.key); return { nodes: [m.id], focus: m.id };
      }),
    ];
  },

  direction: (graph, node, socket) => {
    const cur = baseVector(node, socket, [0, 1, 0]);
    const speed = Math.max(0.5, vlen(cur)) || 10;
    const axis = vlen(cur) > 1e-6 ? cur.map((c) => c / vlen(cur)) : [0, 1, 0];
    const withSpeed = (g, n, s, at, dirNode) => { const m = at('cadence.math.multiply', { b: speed }); link(g, dirNode, 'out', m, 'a'); link(g, m, 'out', n, s.key); return m; };
    return [
      E('fixed', 'one direction', 'The same direction and speed for every particle. Drag the arrow on the stage.', 'native', (g, n, s) => { unlink(g, n, s.key); return { nodes: [] }; }),
      E('cone', 'random, in a cone', 'Each particle picks its own direction inside a cone. Drag the cone\'s edge to open it.', 'native', (g, n, s) => {
        const at = placer(g, n); const c = at('cadence.random.cone', { axis, angle: 25 }, { col: 1 }); const m = withSpeed(g, n, s, at, c); return { nodes: [c.id, m.id], focus: c.id };
      }),
      E('any', 'random, any direction', 'Every direction equally — a burst.', 'native', (g, n, s) => {
        const at = placer(g, n); const c = at('cadence.random.unitVector', {}, { col: 1 }); const m = withSpeed(g, n, s, at, c); return { nodes: [c.id, m.id], focus: m.id };
      }),
      E('away', 'away from the centre', 'Straight out from a point, like a shockwave.', 'approximated', (g, n, s) => {
        const at = placer(g, n); const r = at('cadence.fields.radial', { center: [0, 0, 0], strength: speed, falloff: 0, radius: 0 }); link(g, r, 'out', n, s.key); return { nodes: [r.id], focus: r.id };
      }),
      E('toward', 'toward a point', 'Everything heads for one spot. Drag the spot on the stage.', 'baked', (g, n, s) => {
        const at = placer(g, n); const d = at('cadence.fields.directionFrom', { center: [0, 3, 0] }, { col: 1 }); const m = at('cadence.math.multiply', { b: -speed }); link(g, d, 'out', m, 'a'); link(g, m, 'out', n, s.key); return { nodes: [d.id, m.id], focus: d.id };
      }),
      E('surface', 'along the surface', 'Out of the shape it was born on, the way fur or an aura leaves a body.', 'approximated', (g, n, s) => {
        const at = placer(g, n); const nrm = at('cadence.fields.normal', {}, { col: 1 }); const m = withSpeed(g, n, s, at, nrm); return { nodes: [nrm.id, m.id], focus: m.id };
      }),
      E('swirlDir', 'a swirl', 'Directions that curl around each other, like smoke.', 'baked', (g, n, s) => {
        const at = placer(g, n); const c = at('cadence.noise.curl', { scale: 0.5, octaves: 2 }, { col: 1 }); const m = withSpeed(g, n, s, at, c); return { nodes: [c.id, m.id], focus: c.id };
      }),
    ];
  },

  position: (graph, node, socket) => [
    E('fixed', 'a point', 'One spot. Drag it on the stage.', 'native', (g, n, s) => { unlink(g, n, s.key); return { nodes: [] }; }),
    E('ownPosition', "each particle's own position", 'Wherever the particle is right now.', 'baked', (g, n, s) => {
      const at = placer(g, n); const p = at('cadence.fields.position'); link(g, p, 'out', n, s.key); return { nodes: [p.id], focus: p.id };
    }),
    E('noisePos', 'a wandering point', 'A point that drifts around with noise.', 'baked', (g, n, s) => {
      const at = placer(g, n); const c = at('cadence.noise.curl', { scale: 0.3, octaves: 1 }, { col: 1 }); const m = at('cadence.math.multiply', { b: 3 }); link(g, c, 'out', m, 'a'); link(g, m, 'out', n, s.key); return { nodes: [c.id, m.id], focus: c.id };
    }),
  ],

  force: (graph, node, socket) => {
    const combine = (g, n, s, at, made) => {
      // "Add to what is there": keep the existing force and sum the new one with it.
      const cur = currentSource(g, n, s.key);
      if (!cur) { link(g, made, 'out', n, s.key); return [made.id]; }
      const add = at('cadence.math.add'); link(g, cur.node, cur.socket, add, 'a'); link(g, made, 'out', add, 'b'); link(g, add, 'out', n, s.key); return [made.id, add.id];
    };
    const one = (id, label, teach, roblox, type, values, focusOnAdd = false) => E(id, label, teach, roblox, (g, n, s) => {
      const at = placer(g, n); const m = at(type, values, { col: 1 }); const ids = combine(g, n, s, at, m); return { nodes: ids, focus: m.id };
    });
    return [
      E('none', 'nothing', 'No force at all: particles keep the speed they were born with.', 'native', (g, n, s) => { unlink(g, n, s.key); return { nodes: [] }; }),
      one('gravity', 'gravity', 'Pulls everything down. Drag the arrow to change how hard.', 'native', 'cadence.fields.constantDirection', { direction: [0, -1, 0], strength: 10 }),
      one('wind', 'wind', 'Pushes everything one way.', 'native', 'cadence.fields.constantDirection', { direction: [1, 0, 0], strength: 4 }),
      one('turbulence', 'gusts', 'Random pushes that change over space, like turbulent air.', 'baked', 'cadence.fields.turbulenceForce', { scale: 0.6, strength: 4, octaves: 2 }),
      E('swirl', 'a swirl', 'Curling motion that reads as smoke rather than drifting dust.', 'baked', (g, n, s) => {
        const at = placer(g, n); const c = at('cadence.noise.curl', { scale: 0.5, octaves: 2 }, { col: 2 }); const m = at('cadence.math.multiply', { b: 6 }, { col: 1 }); link(g, c, 'out', m, 'a'); const ids = combine(g, n, s, at, m); return { nodes: [c.id, ...ids], focus: c.id };
      }),
      one('spin', 'a spin around the centre', 'Whirls particles around a line, like water down a drain.', 'baked', 'cadence.fields.vortex', { center: [0, 0, 0], axis: [0, 1, 0], strength: 6, inward: 0, lift: 0 }),
      one('pull', 'a pull toward a point', 'Everything falls toward one spot. Drag the spot.', 'baked', 'cadence.fields.attract', { center: [0, 3, 0], strength: 20, falloff: 1, radius: 0 }),
      one('orbit', 'an orbit', 'Holds particles in a ring while they circle a centre.', 'baked', 'cadence.fields.orbit', { center: [0, 1, 0], axis: [0, 1, 0], radius: 3, strength: 4 }),
      one('air', 'air resistance', 'Slows everything down the faster it goes.', 'approximated', 'cadence.forces.dragForce', { strength: 1, law: 'linear' }),
      one('chase', 'chase a target', 'Steers toward a point and arrives, like a homing missile.', 'baked', 'cadence.forces.seek', { target: [0, 3, 0], speed: 10, strength: 4 }),
      one('flock', 'a flock', 'Particles keep apart, match speed and stay together, like birds.', 'baked', 'cadence.forces.flock', {}),
      one('apart', 'keep apart', 'Particles push each other away so they never pile up.', 'baked', 'cadence.forces.separation', {}),
      one('liquid', 'liquid', 'Particles resist being squeezed and drag on each other, like water.', 'baked', 'cadence.forces.liquid', {}),
    ];
  },

  collider: (graph, node, socket) => {
    const withCollider = (g, n, s, at, shapeNode, response = 'bounce') => { const c = at('cadence.particles.collider', { response, restitution: 0.4 }); link(g, shapeNode, 'out', c, 'shape'); link(g, c, 'out', n, s.key); return c; };
    return [
      E('none', 'nothing', 'Particles pass through everything.', 'native', (g, n, s) => { unlink(g, n, s.key); return { nodes: [] }; }),
      E('floor', 'the floor', 'A flat ground. Drag it up and down.', 'baked', (g, n, s) => { const at = placer(g, n); const p = at('cadence.sdf.plane', { point: [0, 0, 0], normal: [0, 1, 0] }, { col: 1 }); const c = withCollider(g, n, s, at, p); return { nodes: [p.id, c.id], focus: p.id }; }),
      E('floorSplash', 'the floor, and die on it', 'Particles vanish where they land — pair it with "Spawn from events" for splashes.', 'baked', (g, n, s) => { const at = placer(g, n); const p = at('cadence.sdf.plane', { point: [0, 0, 0], normal: [0, 1, 0] }, { col: 1 }); const c = withCollider(g, n, s, at, p, 'kill'); return { nodes: [p.id, c.id], focus: c.id }; }),
      E('ball', 'a ball', 'A sphere to bounce off. Drag its rim.', 'baked', (g, n, s) => { const at = placer(g, n); const p = at('cadence.sdf.sphere', { center: [0, 1, 0], radius: 1 }, { col: 1 }); const c = withCollider(g, n, s, at, p); return { nodes: [p.id, c.id], focus: p.id }; }),
      E('box', 'a box', 'A block to bounce off.', 'baked', (g, n, s) => { const at = placer(g, n); const p = at('cadence.sdf.box', { center: [0, 1, 0], size: [2, 2, 2] }, { col: 1 }); const c = withCollider(g, n, s, at, p); return { nodes: [p.id, c.id], focus: p.id }; }),
      E('capsule', 'a capsule', 'A pill shape, the closest to a character body.', 'baked', (g, n, s) => { const at = placer(g, n); const p = at('cadence.sdf.capsule', { a: [0, 0, 0], b: [0, 3, 0], radius: 0.8 }, { col: 1 }); const c = withCollider(g, n, s, at, p); return { nodes: [p.id, c.id], focus: p.id }; }),
      E('combo', 'a floor with a ball on it', 'Two shapes joined into one — add more with the node editor.', 'baked', (g, n, s) => {
        const at = placer(g, n); const p = at('cadence.sdf.plane', { point: [0, 0, 0], normal: [0, 1, 0] }, { col: 2 }); const b = at('cadence.sdf.sphere', { center: [0, 0.8, 0], radius: 0.8 }, { col: 2 }); const u = at('cadence.sdf.union', {}, { col: 1 }); link(g, p, 'out', u, 'a'); link(g, b, 'out', u, 'b'); const c = withCollider(g, n, s, at, u); return { nodes: [p.id, b.id, u.id, c.id], focus: u.id };
      }),
    ];
  },

  shape: (graph, node, socket) => {
    const shape = (id, label, teach, roblox, type, values) => E(id, label, teach, roblox, (g, n, s) => { const at = placer(g, n); const m = at(type, values); link(g, m, 'out', n, s.key); return { nodes: [m.id], focus: m.id }; });
    return [
      shape('point', 'a point', 'Everything starts from one spot.', 'native', 'cadence.geometry.point', { position: [0, 0, 0] }),
      shape('sphere', 'a sphere', 'Born on or inside a ball. Drag its rim.', 'native', 'cadence.geometry.sphere', { radius: 1, segments: 16, rings: 8 }),
      shape('box', 'a box', 'Born inside a block — rain, snow, a room of dust.', 'native', 'cadence.geometry.box', { size: [4, 0.2, 4] }),
      shape('disc', 'a ring', 'A flat ring on the ground — auras, magic circles, shockwaves.', 'approximated', 'cadence.geometry.disc', { radius: 2, innerRadius: 1.6, segments: 48, plane: 'xz' }),
      shape('circle', 'a circle of points', 'Evenly spaced points around a circle.', 'approximated', 'cadence.geometry.pointCircle', { count: 48, radius: 2, center: [0, 0, 0], plane: 'xz' }),
      shape('cylinder', 'a cylinder', 'A tube, standing up.', 'approximated', 'cadence.geometry.cylinder', { radiusBottom: 1, radiusTop: 1, height: 3, segments: 24, heightSegments: 1, caps: false }),
      shape('torus', 'a donut', 'A ring with thickness — portals.', 'approximated', 'cadence.geometry.torus', { majorRadius: 2, minorRadius: 0.3, majorSegments: 48, minorSegments: 12 }),
      shape('line', 'a line', 'From one point to another. Drag both ends.', 'approximated', 'cadence.curveGeometry.line', { from: [-2, 0, 0], to: [2, 0, 0], segments: 16 }),
      shape('arc', 'an arc', 'A curved sweep — a sword slash.', 'approximated', 'cadence.curveGeometry.arc', { radius: 3, startAngle: -60, sweep: 120, segments: 24, plane: 'xz' }),
      shape('helix', 'a spiral', 'Winds upward around a centre.', 'baked', 'cadence.curveGeometry.helix', { radius: 1.5, endRadius: 0.2, height: 4, turns: 3, segments: 96 }),
      shape('grid', 'a grid of points', 'Rows and columns of points — a field of grass, a wall of sparks.', 'baked', 'cadence.geometry.pointGrid', { size: [4, 0, 4], countX: 8, countY: 1, countZ: 8, center: [0, 0, 0] }),
      E('surface', 'the surface of a sphere', 'Random points scattered evenly over a sphere\'s skin.', 'approximated', (g, n, s) => { const at = placer(g, n); const sp = at('cadence.geometry.sphere', { radius: 1.5, segments: 16, rings: 8 }, { col: 1 }); const pts = at('cadence.sample.pointsOnSurface', { count: 300 }); link(g, sp, 'out', pts, 'geometry'); link(g, pts, 'out', n, s.key); return { nodes: [sp.id, pts.id], focus: sp.id }; }),
      E('volume', 'inside a ball', 'Random points filling a sphere.', 'native', (g, n, s) => { const at = placer(g, n); const sdf = at('cadence.sdf.sphere', { center: [0, 0, 0], radius: 1.5 }, { col: 1 }); const pts = at('cadence.sample.pointsInVolume', { count: 300, boundsCenter: [0, 0, 0], boundsSize: [3, 3, 3] }); link(g, sdf, 'out', pts, 'shape'); link(g, pts, 'out', n, s.key); return { nodes: [sdf.id, pts.id], focus: sdf.id }; }),
    ];
  },

  texture: (graph, node, socket) => {
    const raster = (g, n, s, at, patternNode, outKey = 'mask') => { const r = at('cadence.texture.rasterize', { resolution: 128, extent: 2, wrap: 'clamp' }); link(g, patternNode, outKey, r, 'field'); link(g, r, 'out', n, s.key); return r; };
    return [
      E('none', 'a plain dot', 'No picture: the renderer\'s own soft dot.', 'native', (g, n, s) => { unlink(g, n, s.key); return { nodes: [] }; }),
      E('glow', 'a soft glow', 'A circle that fades at the edge.', 'native', (g, n, s) => { const at = placer(g, n); const p = at('cadence.pattern.radialGradient', { scale: 1, center: [0, 0, 0], radius: 1 }, { col: 1 }); const r = raster(g, n, s, at, p); return { nodes: [p.id, r.id], focus: p.id }; }),
      E('ring', 'a ring', 'A hollow circle.', 'native', (g, n, s) => { const at = placer(g, n); const p = at('cadence.pattern.rings', { scale: 1, thickness: 0.2 }, { col: 1 }); const r = raster(g, n, s, at, p); return { nodes: [p.id, r.id], focus: p.id }; }),
      E('star', 'a star', 'A star with points you can count.', 'native', (g, n, s) => { const at = placer(g, n); const p = at('cadence.pattern.star', { scale: 1, points: 5, radius: 0.9 }, { col: 1 }); const r = raster(g, n, s, at, p); return { nodes: [p.id, r.id], focus: p.id }; }),
      E('smoke', 'smoke', 'Soft noise with the contrast pushed up.', 'native', (g, n, s) => { const at = placer(g, n); const f = at('cadence.noise.fbm', { scale: 2, octaves: 4 }, { col: 2 }); const r = at('cadence.texture.rasterize', { resolution: 128, extent: 2, wrap: 'clamp' }, { col: 1 }); link(g, f, 'out', r, 'field'); const lv = at('cadence.texture.levels', { inputBlack: 0.35, inputWhite: 0.75 }); link(g, r, 'out', lv, 'texture'); link(g, lv, 'out', n, s.key); return { nodes: [f.id, r.id, lv.id], focus: f.id }; }),
      E('fire', 'fire', 'Noise coloured from black through red to white-hot.', 'native', (g, n, s) => { const at = placer(g, n); const f = at('cadence.noise.fbm', { scale: 3, octaves: 4 }, { col: 3 }); const r = at('cadence.texture.rasterize', { resolution: 128, extent: 1, wrap: 'clamp' }, { col: 2 }); link(g, f, 'out', r, 'field'); const lv = at('cadence.texture.levels', { inputBlack: 0.3, inputWhite: 0.7 }, { col: 1 }); link(g, r, 'out', lv, 'texture'); const gm = at('cadence.texture.gradientMap', { gradient: { kind: 'color', stops: [{ u: 0, v: '#000000' }, { u: 0.35, v: '#c02000' }, { u: 0.7, v: '#ffa020' }, { u: 1, v: '#fff8e0' }] } }); link(g, lv, 'out', gm, 'texture'); link(g, gm, 'out', n, s.key); return { nodes: [f.id, r.id, lv.id, gm.id], focus: gm.id }; }),
      E('flipbook', 'an animated sheet', 'Noise baked into a 4×4 flipbook that plays over each particle\'s life.', 'native', (g, n, s) => { const at = placer(g, n); const f = at('cadence.noise.fbm', { scale: 2, octaves: 3 }, { col: 1 }); const fb = at('cadence.texture.flipbook', { columns: 4, rows: 4, cellSize: 64, duration: 1, extent: 2 }); link(g, f, 'out', fb, 'field'); link(g, fb, 'out', n, s.key); return { nodes: [f.id, fb.id], focus: fb.id }; }),
      E('solid', 'a solid colour', 'A flat square of one colour.', 'native', (g, n, s) => { const at = placer(g, n); const t = at('cadence.texture.solid', { color: [1, 1, 1, 1], resolution: 4 }); link(g, t, 'out', n, s.key); return { nodes: [t.id], focus: t.id }; }),
    ];
  },

  material: (graph, node, socket) => {
    const mat = (id, label, teach, values) => E(id, label, teach, 'native', (g, n, s) => { const at = placer(g, n); const m = at('cadence.material.surface', values); link(g, m, 'out', n, s.key); return { nodes: [m.id], focus: m.id }; });
    return [
      mat('glow', 'a glow', 'Adds light where sprites overlap — sparks, fire, magic.', { blend: 'additive', opacity: 0.6, baseColor: [1, 0.7, 0.3, 1] }),
      mat('solid', 'solid', 'Plain colour, no glow — debris, leaves, confetti.', { blend: 'normal', opacity: 1, baseColor: [1, 1, 1, 1] }),
      mat('smoke', 'smoke', 'Soft, see-through grey.', { blend: 'normal', opacity: 0.35, baseColor: [0.6, 0.6, 0.65, 1] }),
    ];
  },

  colour: (graph, node, socket) => {
    const cur = Array.isArray(node.values?.[socket.key]) ? node.values[socket.key] : (Array.isArray(socket.default) ? socket.default : [1, 1, 1, 1]);
    const viaGradient = (g, n, s, at, driver, driverOut, extraIds = []) => { const gr = at('cadence.color.sampleGradient', { gradient: EMBER }); link(g, driver, driverOut, gr, 'position'); link(g, gr, 'out', n, s.key); return { nodes: [...extraIds, driver.id, gr.id], focus: gr.id }; };
    return [
      E('fixed', 'one colour', 'The same colour everywhere.', 'native', (g, n, s) => { unlink(g, n, s.key); return { nodes: [] }; }),
      E('overLife', 'over its life', 'A gradient from birth to death — white-hot to red to dark is the classic.', 'sequence', (g, n, s) => { const at = placer(g, n); const life = at('cadence.particles.life', {}, { col: 1 }); return viaGradient(g, n, s, at, life, 'out'); }),
      E('overTime', "over the effect's time", 'A gradient along the effect timeline.', 'scheduled', (g, n, s) => { const at = placer(g, n); const t = at('cadence.time.effectTime', {}, { col: 1 }); return viaGradient(g, n, s, at, t, 'normalized'); }),
      E('bySpeed', 'by speed', 'Fast particles one end of the gradient, slow ones the other.', 'baked', (g, n, s) => { const at = placer(g, n); const sp = at('cadence.particles.speed', {}, { col: 2 }); const m = at('cadence.math.mapRange', { fromMin: 0, fromMax: 10, toMin: 1, toMax: 0, clamp: true }, { col: 1 }); link(g, sp, 'out', m, 'value'); return viaGradient(g, n, s, at, m, 'out', [sp.id]); }),
      E('byHeight', 'by how high it is', 'Colour changes with height.', 'baked', (g, n, s) => { const at = placer(g, n); const p = at('cadence.fields.position', {}, { col: 3 }); const sep = at('cadence.vector.separate', {}, { col: 2 }); const m = at('cadence.math.mapRange', { fromMin: 0, fromMax: 5, toMin: 0, toMax: 1, clamp: true }, { col: 1 }); link(g, p, 'out', sep, 'vector'); link(g, sep, 'y', m, 'value'); return viaGradient(g, n, s, at, m, 'out', [p.id, sep.id]); }),
      E('random', 'random shades', 'Each particle a slightly different shade of this colour.', 'range', (g, n, s) => { const at = placer(g, n); const r = at('cadence.random.color', { base: cur, hueRange: 0.08, saturationRange: 0.2, valueRange: 0.2 }); link(g, r, 'out', n, s.key); return { nodes: [r.id], focus: r.id }; }),
      E('noise', 'noise', 'Patches of colour over space.', 'baked', (g, n, s) => { const at = placer(g, n); const f = at('cadence.noise.fbm', { scale: 1, octaves: 3 }, { col: 1 }); return viaGradient(g, n, s, at, f, 'out'); }),
      E('temperature', 'a temperature', 'The colour of something that hot, in kelvin: 1800 candle, 3000 bulb, 6500 daylight.', 'native', (g, n, s) => { const at = placer(g, n); const t = at('cadence.color.temperature', { kelvin: 3000 }); link(g, t, 'out', n, s.key); return { nodes: [t.id], focus: t.id }; }),
    ];
  },

  events: (graph, node, socket) => {
    const sims = Object.values(graph.nodes).filter((n) => n.type.startsWith('cadence.particles.simulate') && n.id !== node.id && n.scope === node.scope);
    const entries = [E('none', 'nothing', 'Not born from events.', 'native', (g, n, s) => { unlink(g, n, s.key); return { nodes: [] }; })];
    for (const sim of sims) {
      const name = sim.label || 'those particles';
      const mk = (id, label, teach, kind, extra = {}) => E(`${id}:${sim.id}`, label, teach, 'baked', (g, n, s) => { const at = placer(g, n); const f = at('cadence.particles.events', { kind, ...extra }); link(g, g.nodes[sim.id], 'events', f, 'events'); link(g, f, 'out', n, s.key); return { nodes: [f.id], focus: f.id }; });
      entries.push(
        mk('death', `when ${name} die`, 'A puff, a splash, a burst at every death.', 'death'),
        mk('hit', `when ${name} hit something`, 'Needs a collider on that simulation.', 'collision'),
        mk('birth', `when ${name} are born`, 'A flash at every birth.', 'birth'),
        mk('interval', `every 0.1 s of ${name}'s life`, 'A trail of children behind each particle (set "Fire an event every" on that simulation).', 'interval'),
        mk('trigger', `when ${name}'s condition fires`, 'Uses that simulation\'s "Fire an event when".', 'trigger'),
      );
    }
    return entries;
  },

  emitter: (graph, node, socket) => [
    E('stream', 'a steady stream', 'Particles keep coming at a rate per second.', 'native', (g, n, s) => { const at = placer(g, n); const e = at('cadence.particles.emitter', { rate: 30, lifetime: 1.5, velocity: [0, 4, 0] }); link(g, e, 'out', n, s.key); return { nodes: [e.id], focus: e.id }; }),
    E('burst', 'one burst', 'Everything at once, then nothing.', 'native', (g, n, s) => { const at = placer(g, n); const e = at('cadence.particles.emitter', { rate: 0, burstCount: 150, burstTime: 0, lifetime: 1.2, velocity: [0, 6, 0] }); link(g, e, 'out', n, s.key); return { nodes: [e.id], focus: e.id }; }),
  ],

  volume: (graph, node, socket) => {
    // The renderer's Heat input, when the same node has one, is wired from the same simulation so fire
    // needs one choice, not two.
    const wireHeat = (g, n, sim) => { const heat = PGRAPH_socketsOf(g, n).inputs.find((x) => x.key === 'temperature'); if (heat && !G.linksInto(g, n.id, 'temperature').length) link(g, sim, 'temperature', n, 'temperature'); };
    return [
      E('none', 'nothing', 'No volume: the renderer draws nothing.', 'native', (g, n, s) => { unlink(g, n, s.key); return { nodes: [] }; }),
      E('fire', 'fire', 'A burning source: fuel ignites into flame and smoke.', 'baked', (g, n, s) => { const at = placer(g, n); const src = at('cadence.geometry.point', { position: [0, 0.4, 0] }, { col: 1 }); const sim = at('cadence.pyro.simulate', { fuel: 3, temperature: 1.6, density: 1.5, resolution: 32 }); link(g, src, 'out', sim, 'shape'); link(g, sim, 'density', n, s.key); wireHeat(g, n, sim); return { nodes: [src.id, sim.id], focus: sim.id }; }),
      E('smoke', 'smoke', 'A smoke source with no flame.', 'baked', (g, n, s) => { const at = placer(g, n); const src = at('cadence.geometry.point', { position: [0, 0.4, 0] }, { col: 1 }); const sim = at('cadence.pyro.simulate', { fuel: 0, temperature: 1.2, density: 5, resolution: 32 }); link(g, src, 'out', sim, 'shape'); link(g, sim, 'density', n, s.key); return { nodes: [src.id, sim.id], focus: sim.id }; }),
      E('cloud', 'a cloud', 'Lumpy shaped noise that drifts.', 'baked', (g, n, s) => { const at = placer(g, n); const c = at('cadence.volume.cloud', {}); link(g, c, 'out', n, s.key); return { nodes: [c.id], focus: c.id }; }),
      E('bake', 'a baked field', 'Any field frozen into a grid — noise here.', 'baked', (g, n, s) => { const at = placer(g, n); const f = at('cadence.noise.fbm', { scale: 1.5, octaves: 3 }, { col: 1 }); const b = at('cadence.volume.rasterize', { resolution: 24, center: [0, 2, 0], size: [4, 4, 4] }); link(g, f, 'out', b, 'field'); link(g, b, 'out', n, s.key); return { nodes: [f.id, b.id], focus: b.id }; }),
      E('blurred', 'this, blurred', 'Soften whatever is here.', 'baked', (g, n, s) => { const at = placer(g, n); const cur = currentSource(g, n, s.key); if (!cur) return { nodes: [] }; const bl = at('cadence.volume.blur', { radius: 1 }); link(g, cur.node, cur.socket, bl, 'volume'); link(g, bl, 'out', n, s.key); return { nodes: [bl.id], focus: bl.id }; }),
    ];
  },

  instances: (graph, node, socket) => [
    E('copies', 'copies on points', 'A small shape copied onto every point — debris, rocks, leaves.', 'converted', (g, n, s) => { const at = placer(g, n); const pts = at('cadence.geometry.pointGrid', { size: [4, 0, 4], countX: 6, countY: 1, countZ: 6 }, { col: 1 }); const shape = at('cadence.geometry.box', { size: [0.3, 0.3, 0.3] }, { col: 1 }); const inst = at('cadence.instance.onPoints', {}); link(g, pts, 'out', inst, 'points'); link(g, shape, 'out', inst, 'geometry'); link(g, inst, 'out', n, s.key); return { nodes: [pts.id, shape.id, inst.id], focus: inst.id }; }),
  ],
};

// ---------------------------------------------------------------- the public menu
// The entries for one slot: the kind's curated list, then "a value this effect already has" (every
// node in scope whose output fits, named values first), then "anything else…" (the ranked search).
export function menuFor(graph, node, socket) {
  const kind = slotKindOf(socket);
  const curated = (MENUS[kind] || (() => []))(graph, node, socket);
  const cur = currentSource(graph, node, socket.key);
  for (const e of curated) e.current = false;
  // Mark the entry that matches what is wired now, by the source node's type.
  if (cur) {
    const srcType = cur.node.type.split('@')[0];
    for (const e of curated) if (e.matches && e.matches(srcType)) e.current = true;
  } else {
    const fixed = curated.find((e) => e.id === 'fixed' || e.id === 'none');
    if (fixed) fixed.current = true;
  }
  const existing = existingSources(graph, node, socket);
  return { kind, curated, existing, searchable: feedersFor(socket.type).length, current: cur };
}

// Nodes already in the graph whose output fits this slot — "from another value" without a wire.
export function existingSources(graph, node, socket) {
  const want = T.parseType(socket.type);
  if (!want) return [];
  const inner = T.isFieldType(want) ? want.param : want;
  const out = [];
  for (const other of G.nodesInScope(graph, node.scope || G.ROOT_SCOPE)) {
    if (other.id === node.id || G.isGroupBoundaryType(other.type)) continue;
    if (G.wouldCycle(graph, other.id, node.id)) continue;
    const def = REG.getNode(other.type);
    const outs = G.socketsOf(graph, other).outputs;
    for (const o of outs) {
      const fits = T.containsGeneric(o.type) ? ['float', 'int', 'vector2', 'vector3', 'vector4', 'color', 'bool'].includes(inner?.name)
        : (T.canConnect(o.type, want) || T.canConnect(o.type, T.fieldOf(inner)));
      if (!fits) continue;
      out.push({ nodeId: other.id, socket: o.key, label: (other.label || def?.label || other.type) + (outs.length > 1 ? ` (its ${o.label})` : ''), type: T.formatType(o.type) });
    }
  }
  return out;
}

// Apply one menu entry. Returns { nodes: [new ids], focus } — the caller wraps this in ST.mutatePnx.
export function applyEntry(graph, node, socket, entry) {
  unlink(graph, node, socket.key);
  return entry.apply(graph, node, socket);
}

export function applyExisting(graph, node, socket, source) {
  unlink(graph, node, socket.key);
  const src = graph.nodes[source.nodeId];
  if (!src) throw new Error('that value no longer exists');
  link(graph, src, source.socket, node, socket.key);
  return { nodes: [], focus: src.id };
}

export function applyNodeType(graph, node, socket, type) {
  unlink(graph, node, socket.key);
  const at = placer(graph, node);
  const made = at(type);
  const def = REG.getNode(type);
  // First output that fits.
  const want = T.parseType(socket.type);
  const inner = T.isFieldType(want) ? want.param : want;
  const o = (def?.outputs || []).find((x) => T.containsGeneric(x.type) || T.canConnect(x.type, want) || T.canConnect(x.type, T.fieldOf(inner)));
  if (!o) throw new Error(`${def?.label || type} has no output that fits ${socket.label}`);
  link(graph, made, o.key, node, socket.key);
  return { nodes: [made.id], focus: made.id };
}

// ---------------------------------------------------------------- "add a thing"
// Each entry builds a complete visible thing wired to the Effect Output, so the first result is on
// screen immediately: never a bare renderer with nothing to draw.
function ensureOutput(graph) {
  let out = Object.values(graph.nodes).find((n) => n.type.startsWith('cadence.render.output') && n.scope === G.ROOT_SCOPE);
  if (!out) out = G.newNode(graph, 'cadence.render.output', 1000, 0);
  return out;
}
function nextRow(graph) {
  const ys = Object.values(graph.nodes).map((n) => n.y);
  return ys.length ? Math.max(...ys) + 360 : 0;
}
export const THINGS = [
  {
    id: 'particles', label: 'Particles', teach: 'Sprites born from a shape, pushed by forces. The commonest thing in any effect.', roblox: 'native',
    build(graph) {
      const y = nextRow(graph); const out = ensureOutput(graph);
      const at = (type, x, values = {}) => G.newNode(graph, type, x, y, { values });
      const sphere = at('cadence.geometry.sphere', -980, { radius: 0.4, segments: 12, rings: 6 });
      const em = at('cadence.particles.emitter', -652, { emitFrom: 'surface', rate: 30, lifetime: 1.5, velocity: [0, 4, 0] });
      const grav = G.newNode(graph, 'cadence.fields.constantDirection', -652, y + 300, { values: { direction: [0, -1, 0], strength: 6 } });
      const sim = at('cadence.particles.simulate', -324, { maxParticles: 4000, drag: 0.4 });
      const life = G.newNode(graph, 'cadence.particles.life', -324, y + 380);
      const grad = G.newNode(graph, 'cadence.color.sampleGradient', 4, y + 60, { values: { gradient: EMBER } });
      const size = G.newNode(graph, 'cadence.curve.evaluate', 4, y + 250, { values: { curve: { kind: 'float', keys: [{ t: 0, v: 0.1 }, { t: 0.2, v: 0.45 }, { t: 1, v: 0 }] } } });
      const mat = at('cadence.material.surface', 332, { blend: 'additive', opacity: 0.4 });
      const spr = at('cadence.render.sprite', 660, {});
      link(graph, sphere, 'out', em, 'shape'); link(graph, em, 'out', sim, 'emitter'); link(graph, grav, 'out', sim, 'force');
      link(graph, life, 'out', grad, 'position'); link(graph, life, 'out', size, 'position'); link(graph, grad, 'out', mat, 'baseColor');
      link(graph, size, 'out', spr, 'size'); link(graph, sim, 'out', spr, 'source'); link(graph, mat, 'out', spr, 'material'); link(graph, spr, 'out', out, 'passes');
      return { thing: spr.id, nodes: [sphere.id, em.id, grav.id, sim.id, life.id, grad.id, size.id, mat.id, spr.id] };
    },
  },
  {
    id: 'ring', label: 'A ring', teach: 'A flat ring you can grow and fade — the core of every shockwave, aura and impact.', roblox: 'unsupported',
    build(graph) {
      const y = nextRow(graph); const out = ensureOutput(graph);
      const at = (type, x, values = {}) => G.newNode(graph, type, x, y, { values });
      const t = at('cadence.time.effectTime', -980, {});
      const radius = at('cadence.curve.evaluate', -652, { curve: { kind: 'float', keys: [{ t: 0, v: 0.2 }, { t: 0.5, v: 4 }, { t: 1, v: 5 }] } });
      const inner = G.newNode(graph, 'cadence.math.subtract', -324, y + 140, { values: { b: 0.5 } });
      const disc = at('cadence.geometry.disc', -324, { plane: 'xz', segments: 64 });
      const fade = G.newNode(graph, 'cadence.curve.evaluate', -652, y + 280, { values: { curve: { kind: 'float', keys: [{ t: 0, v: 1 }, { t: 1, v: 0 }] } } });
      const mat = at('cadence.material.surface', 4, { baseColor: [0.6, 0.8, 1, 1], blend: 'additive' });
      const mesh = at('cadence.render.mesh', 332, {});
      link(graph, t, 'normalized', radius, 'position'); link(graph, t, 'normalized', fade, 'position');
      link(graph, radius, 'out', disc, 'radius'); link(graph, radius, 'out', inner, 'a'); link(graph, inner, 'out', disc, 'innerRadius');
      link(graph, fade, 'out', mat, 'opacity'); link(graph, disc, 'out', mesh, 'source'); link(graph, mat, 'out', mesh, 'material'); link(graph, mesh, 'out', out, 'passes');
      return { thing: mesh.id, nodes: [t.id, radius.id, inner.id, disc.id, fade.id, mat.id, mesh.id] };
    },
  },
  {
    id: 'trail', label: 'A trail', teach: 'A streak along a curve — a sword slash, a comet tail.', roblox: 'converted',
    build(graph) {
      const y = nextRow(graph); const out = ensureOutput(graph);
      const at = (type, x, values = {}) => G.newNode(graph, type, x, y, { values });
      const arc = at('cadence.curveGeometry.arc', -652, { radius: 3, startAngle: -60, sweep: 120, segments: 24, plane: 'xz' });
      const mat = at('cadence.material.surface', -324, { baseColor: [1, 1, 1, 1], blend: 'additive' });
      const trail = at('cadence.render.trail', 4, { width: 0.4 });
      link(graph, arc, 'out', trail, 'source'); link(graph, mat, 'out', trail, 'material'); link(graph, trail, 'out', out, 'passes');
      return { thing: trail.id, nodes: [arc.id, mat.id, trail.id] };
    },
  },
  {
    id: 'beam', label: 'A beam', teach: 'A straight bolt between two points — lasers, lightning with noise.', roblox: 'converted',
    build(graph) {
      const y = nextRow(graph); const out = ensureOutput(graph);
      const at = (type, x, values = {}) => G.newNode(graph, type, x, y, { values });
      const line = at('cadence.curveGeometry.line', -652, { from: [-3, 1, 0], to: [3, 1, 0], segments: 16 });
      const mat = at('cadence.material.surface', -324, { baseColor: [0.5, 0.8, 1, 1], blend: 'additive' });
      const beam = at('cadence.render.beam', 4, { width: 0.25 });
      link(graph, line, 'out', beam, 'source'); link(graph, mat, 'out', beam, 'material'); link(graph, beam, 'out', out, 'passes');
      return { thing: beam.id, nodes: [line.id, mat.id, beam.id] };
    },
  },
  {
    id: 'light', label: 'A light', teach: 'A point light that can flicker, grow and change colour.', roblox: 'converted',
    build(graph) {
      const y = nextRow(graph); const out = ensureOutput(graph);
      const at = (type, x, values = {}) => G.newNode(graph, type, x, y, { values });
      const pt = at('cadence.geometry.point', -652, { position: [0, 1.5, 0] });
      const mat = at('cadence.material.surface', -324, { baseColor: [1, 0.75, 0.4, 1] });
      const light = at('cadence.render.light', 4, { intensity: 4, range: 10 });
      link(graph, pt, 'out', light, 'source'); link(graph, mat, 'out', light, 'material'); link(graph, light, 'out', out, 'passes');
      return { thing: light.id, nodes: [pt.id, mat.id, light.id] };
    },
  },
  {
    id: 'copies', label: 'Copies of a shape', teach: 'One small shape copied onto many points — debris, rocks, petals.', roblox: 'unsupported',
    build(graph) {
      const y = nextRow(graph); const out = ensureOutput(graph);
      const at = (type, x, values = {}) => G.newNode(graph, type, x, y, { values });
      const pts = at('cadence.geometry.pointGrid', -980, { size: [4, 0, 4], countX: 6, countY: 1, countZ: 6, center: [0, 0.2, 0] });
      const box = G.newNode(graph, 'cadence.geometry.box', -980, y + 220, { values: { size: [0.3, 0.3, 0.3] } });
      const inst = at('cadence.instance.onPoints', -652, {});
      const mat = at('cadence.material.surface', -324, { baseColor: [0.8, 0.8, 0.85, 1] });
      const mesh = at('cadence.render.mesh', 4, {});
      link(graph, pts, 'out', inst, 'points'); link(graph, box, 'out', inst, 'geometry'); link(graph, inst, 'out', mesh, 'instances'); link(graph, mat, 'out', mesh, 'material'); link(graph, mesh, 'out', out, 'passes');
      return { thing: mesh.id, nodes: [pts.id, box.id, inst.id, mat.id, mesh.id] };
    },
  },
  {
    id: 'fire', label: 'Fire & smoke', teach: 'A real gas simulation: flames rise from a source and trail smoke. Drawn with light and shadow.', roblox: 'baked',
    build(graph) {
      const y = nextRow(graph); const out = ensureOutput(graph);
      const at = (type, x, values = {}) => G.newNode(graph, type, x, y, { values });
      const src = at('cadence.geometry.point', -652, { position: [0, 0.4, 0] });
      const sim = at('cadence.pyro.simulate', -324, { fuel: 3, temperature: 1.6, density: 1.5, resolution: 32, center: [0, 2.5, 0], size: [5, 5, 5] });
      const vr = at('cadence.render.volume', 4, {});
      link(graph, src, 'out', sim, 'shape'); link(graph, sim, 'density', vr, 'density'); link(graph, sim, 'temperature', vr, 'temperature'); link(graph, vr, 'out', out, 'passes');
      return { thing: vr.id, nodes: [src.id, sim.id, vr.id] };
    },
  },
  {
    id: 'cloud', label: 'A cloud', teach: 'A lumpy, lit, drifting cloud.', roblox: 'baked',
    build(graph) {
      const y = nextRow(graph); const out = ensureOutput(graph);
      const at = (type, x, values = {}) => G.newNode(graph, type, x, y, { values });
      const c = at('cadence.volume.cloud', -324, {});
      const vr = at('cadence.render.volume', 4, { smokeColor: [0.95, 0.95, 1, 1], absorption: 2, emission: 0, scatter: 0.45 });
      link(graph, c, 'out', vr, 'density'); link(graph, vr, 'out', out, 'passes');
      return { thing: vr.id, nodes: [c.id, vr.id] };
    },
  },
];

export function addThing(graph, id) {
  const t = THINGS.find((x) => x.id === id);
  if (!t) throw new Error(`no thing called "${id}"`);
  return t.build(graph);
}

// A sheet card's "remove this thing": the renderer and everything that only it (directly or
// through nodes being removed) makes use of. A node read by anything outside that set stays — a shared
// Normalized Age feeding another thing's colour is untouched.
export function removeThing(graph, thingId) {
  const upstream = new Set(G.upstreamOf(graph, thingId));
  const doomed = new Set([thingId]);
  // Fixpoint: a node joins the removal set once every consumer it has is already in it.
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of upstream) {
      if (doomed.has(id)) continue;
      const consumers = G.linksOutOf(graph, id).map((l) => l.toNode);
      if (consumers.length && consumers.every((c) => doomed.has(c))) { doomed.add(id); grew = true; }
    }
  }
  for (const id of doomed) G.removeNode(graph, id);
  return { removed: [...doomed] };
}

function fmt(v) { return Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100); }
