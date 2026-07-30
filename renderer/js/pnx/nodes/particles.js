// Particle nodes (spec Parts 25-30): the simulation, its emitter, its colliders, and the reads.
//
// WHY THIS FILE IS SHORT. A naive reading of Parts 25-30 counts about a hundred nodes: Gravity, Drag,
// Wind, Turbulence, Curl Force, Vortex, Attract, Repel, Orbit, Seek, Follow Field, Follow Curve, and
// a collider per shape. Almost none of them are here, because almost none of them are primitives:
//
//   - Every POSITION-dependent force already exists as a vector field (Part 19, nodes/fields.js).
//     Gravity is Constant Direction. Wind is Constant Direction plus Noise. Vortex is Vortex Field.
//     Attract/Repel/Orbit are the attraction fields. Turbulence is Curl Noise. They compose with the
//     whole maths library, and Add sums them — so `Force` on the Simulate node is one `field<vector3>`
//     input, and a user can build a force nobody anticipated out of Position and arithmetic.
//   - Every COLLIDER SHAPE already exists as an SDF (Part 20, nodes/sdf.js). Plane, sphere, box,
//     capsule, and anything a user composed out of smooth unions are all `field<float>`, and the
//     contact normal is the field's gradient. So there is one Collider node, not nine.
//   - Every EMITTER SHAPE already exists as geometry plus the phase-4 samplers (Parts 21/23). Spawn
//     From Points, From Surface, From Volume and From Curve are one `geometry` input plus a mode.
//
// That is Part 74's golden test applied honestly: when a requested feature can be built from existing
// primitives, it becomes a composition, not a node. What remains here is what genuinely cannot be
// expressed otherwise — the solver itself, and the forces that are functions of a particle's VELOCITY
// rather than of its position, which a field cannot see from outside the integration loop.

import * as V from '../values.js';
import * as F from '../fields.js';
import * as GEO from '../geometry.js';
import * as SOLVER from '../solver.js';
import { isAttrWrite } from './attribute.js';
import { node, n, i as intIn, b as boolIn, v3, out, mode } from './_helpers.js';

const C = 'Particles';

// ---------------------------------------------------------------- the emitter
// A description of how particles are born. Separate from the Simulate node so one emitter can be
// reused, and so the spawn settings are legible rather than being fifteen more sockets on the solver.
node({
  id: 'cadence.particles.emitter', label: 'Emitter', category: C, subcategory: 'Spawn',
  aliases: ['spawn', 'source', 'birth', 'emit', 'spawner', 'rate', 'burst'],
  summary: 'Describes how particles are born: how many, where from, and what they start with.',
  teach: 'Sets how fast particles appear, where they appear, and how long they live.',
  explain: 'Rate is per second and accumulates fractionally, so 0.5 means one particle every two seconds rather than none. Burst count fires once at the burst time. The shape you plug in can be any geometry at all — a primitive, a scatter, points filled into an SDF — which is what lets particles be born from something the developers never anticipated.',
  commonUses: ['a steady stream of smoke', 'a single burst for an explosion', 'sparks born from a mesh surface'],
  exportSupport: 'converted',
  exportNote: 'Roblox ParticleEmitter covers rate and lifetime natively; spawn shapes other than a box or sphere are approximated or baked.',
  inputs: [
    { key: 'shape', label: 'Spawn from', type: 'geometry', description: 'Any geometry. Leave unconnected to emit from the origin.' },
    mode('emitFrom', 'Where on it', ['points', 'surface', 'volume', 'curve'], 'points'),
    n('rate', 'Rate', 20, { min: 0, unit: 'per second' }),
    intIn('burstCount', 'Burst count', 0, { min: 0, max: 100000 }),
    n('burstTime', 'Burst at', 0, { min: 0, unit: 'seconds' }),
    { key: 'lifetime', label: 'Lifetime', type: 'field<float>', default: 2, min: 1e-3, unit: 'seconds' },
    { key: 'velocity', label: 'Initial velocity', type: 'field<vector3>', default: [0, 0, 0], unit: 'studs/second' },
    { key: 'mass', label: 'Mass', type: 'field<float>', default: 1, min: 1e-6 },
    { key: 'attributes', label: 'Initial attributes', type: 'any', multi: true, description: 'Set Attribute nodes, applied once when each particle is born.' },
  ],
  outputs: [{ key: 'out', label: 'Emitter', type: 'any' }],
  evaluate: (api, i) => ({
    __emitter: true,
    shape: GEO.isGeometry(i.shape) ? i.shape : null,
    emitFrom: i.emitFrom,
    rate: Math.max(0, i.rate),
    bursts: i.burstCount > 0 ? [{ time: Math.max(0, i.burstTime), count: Math.round(i.burstCount) }] : [],
    lifetime: i.lifetime,
    velocity: i.velocity,
    mass: i.mass,
    writes: (Array.isArray(i.attributes) ? i.attributes : [i.attributes]).flat().filter(isAttrWrite),
  }),
});
const isEmitter = (v) => !!v && v.__emitter === true;

// ---------------------------------------------------------------- colliders
node({
  id: 'cadence.particles.collider', label: 'Collider', category: 'Collision', subcategory: 'Collide',
  aliases: ['bounce', 'collide', 'wall', 'floor', 'obstacle', 'hit', 'ground', 'barrier'],
  summary: 'Makes particles collide with a shape, and says what happens when they do.',
  teach: 'Stops particles passing through a shape. They can bounce off it, slide along it, stick to it, or die.',
  explain: 'The shape is a distance field, so a plane, a sphere, a box, a capsule and anything you built by combining them all work through this one node — the surface direction to bounce off is worked out from the field itself. Bounciness of 1 loses no speed; 0 means the particle stops dead against the surface. Friction slows the sideways slide.',
  commonUses: ['sparks bouncing off the ground', 'debris sliding down a slope', 'particles dying when they hit a wall'],
  exportSupport: 'unsupported',
  exportNote: 'Roblox particles cannot collide with arbitrary shapes. Collision must be baked into the particle paths on export.',
  performance: 'moderate',
  inputs: [
    { key: 'shape', label: 'Shape (distance)', type: 'field<float>', default: 0, unit: 'studs' },
    mode('response', 'On contact', SOLVER.COLLISION_RESPONSES, 'bounce'),
    n('restitution', 'Bounciness', 0.4, { min: 0, max: 1 }),
    n('friction', 'Friction', 0.2, { min: 0, max: 1 }),
    n('thickness', 'Thickness', 0.05, { min: 0, unit: 'studs', description: 'Treat the surface as this much thicker, so fast particles are less likely to pass through it.' }),
  ],
  outputs: [{ key: 'out', label: 'Collider', type: 'any' }],
  evaluate: (api, i) => ({
    __collider: true,
    shape: i.shape,
    response: SOLVER.COLLISION_RESPONSES.includes(i.response) ? i.response : 'bounce',
    restitution: i.restitution,
    friction: i.friction,
    thickness: Math.max(0, i.thickness),
    epsilon: 0.01,
    ctx: F.newSampleContext(),
  }),
});
const isCollider = (v) => !!v && v.__collider === true;

// ---------------------------------------------------------------- the solver
node({
  id: 'cadence.particles.simulate', label: 'Simulate Particles', category: C, subcategory: 'Simulate',
  aliases: ['particles', 'simulation', 'solver', 'run particles', 'physics', 'particle system', 'sim'],
  summary: 'Runs a particle simulation and gives back the living particles as points.',
  teach: 'The engine that actually moves the particles: it spawns them, pushes them with forces, bounces them off things, and removes them when they die.',
  explain: 'The result is an ordinary point geometry, so everything that works on points works on simulated particles — instancing a mesh onto them, reading their attributes, scattering more points from them. Force is a single direction field: build it from the vector fields and add them together, so gravity plus wind plus turbulence is three nodes and an Add rather than three settings. Scrubbing backwards replays from a saved checkpoint, so the same frame always looks the same however you got there.',
  commonUses: ['smoke, sparks and debris', 'anything that needs to bounce, drag or accumulate', 'a swarm driven by a field you invented'],
  exportSupport: 'baked',
  exportNote: 'A general simulation has no Roblox equivalent. On export the particle paths are baked, or approximated with a ParticleEmitter where the motion is simple enough.',
  performance: 'expensive',
  pure: false,          // owns a simulation across frames; see api.persistent
  timeDependent: true,
  inputs: [
    { key: 'emitter', label: 'Emitter', type: 'any' },
    { key: 'force', label: 'Force', type: 'field<vector3>', default: [0, 0, 0], unit: 'studs/second²', description: 'Add the vector fields together to combine forces. Divided by each particle\'s mass to get its acceleration.' },
    { key: 'drag', label: 'Drag', type: 'field<float>', default: 0, min: 0, description: 'Slows particles in proportion to how fast they are going. A field, so it can depend on speed, height or age.' },
    { key: 'kill', label: 'Kill when', type: 'field<bool>', default: false, description: 'Remove a particle the moment this becomes true. Age is handled separately.' },
    { key: 'colliders', label: 'Colliders', type: 'any', multi: true },
    intIn('maxParticles', 'Particle limit', 10000, { min: 1, max: 500000 }),
    intIn('substeps', 'Substeps', 1, { min: 1, max: 16, description: 'Subdivide each frame. Raise it when fast particles pass through colliders — it costs accuracy, not appearance.' }),
    boolIn('killByAge', 'Die of old age', true),
    intIn('startFrame', 'Start at frame', 0, { min: 0, max: 100000 }),
  ],
  outputs: [
    { key: 'out', label: 'Particles', type: 'geometry' },
    { key: 'count', label: 'Alive', type: 'int' },
    { key: 'spawned', label: 'Spawned so far', type: 'int' },
    { key: 'died', label: 'Died so far', type: 'int' },
  ],
  evaluate: (api, i) => {
    const emitter = isEmitter(i.emitter) ? i.emitter : null;
    if (i.emitter && !emitter) api.warn('The Emitter input needs an Emitter node.');

    const colliders = (Array.isArray(i.colliders) ? i.colliders : [i.colliders]).flat().filter(isCollider);
    const badColliders = (Array.isArray(i.colliders) ? i.colliders : [i.colliders]).flat().filter((c) => c && !isCollider(c));
    if (badColliders.length) api.warn('The Colliders input only accepts Collider nodes.');

    // The spec the solver runs. Rebuilt every frame — it is cheap, and the fields inside it are the
    // same closures the evaluator cached, so rebuilding does not re-evaluate the graph.
    const spec = {
      path: api.path,
      graphSeed: api.seed,
      random: (id, channel) => api.random(id, channel),
      emitter: emitter?.shape || null,
      emitFrom: emitter?.emitFrom || 'points',
      rate: emitter ? emitter.rate : 0,
      bursts: emitter?.bursts || [],
      lifetime: emitter ? emitter.lifetime : 2,
      initialVelocity: emitter ? emitter.velocity : [0, 0, 0],
      mass: emitter ? emitter.mass : 1,
      spawnWrites: emitter?.writes || [],
      force: i.force,
      drag: i.drag,
      kill: i.kill,
      killByAge: i.killByAge !== false,
      colliders,
      maxParticles: Math.max(1, Math.round(i.maxParticles)),
      substeps: Math.round(i.substeps),
    };

    // The simulation itself persists across frames. It is dropped whenever this node is structurally
    // invalidated (a changed force, a new wire), because a history produced by a different graph is
    // not a valid starting point for this one.
    const sim = api.persistent(() => new SOLVER.Simulation(spec, {
      fps: api.fps || 30,
      startFrame: Math.round(i.startFrame),
    }));
    sim.spec = spec;               // fields may be new closures even when nothing structural changed
    sim.fps = api.fps || 30;
    sim.startFrame = Math.round(i.startFrame);

    const state = sim.seek(api.frame);
    if (sim.lastSeek.truncated) {
      api.warn(`Reaching frame ${api.frame} needed more simulation steps than the limit allows, so this frame is incomplete. Bake the simulation or start it closer to here.`);
    }

    return {
      out: SOLVER.stateAsGeometry(state),
      count: SOLVER.particleCount(state),
      spawned: state.stats.spawned,
      died: state.stats.died,
    };
  },
});

node({
  id: 'cadence.particles.diagnose', label: 'Simulation Report', category: C, subcategory: 'Simulate',
  aliases: ['simulation stats', 'particle count', 'is it working', 'debug simulation', 'check simulation'],
  summary: 'Reports whether a simulation is technically healthy, and passes the particles through.',
  explain: 'Answers the questions that have a factual answer: are there any particles, is anything flying off to infinity, has the count hit its limit, is a position NaN. It deliberately says nothing about whether the effect looks good — that is not a question a number can settle.',
  commonUses: ['finding out why nothing is on screen', 'catching an exploding simulation before it is baked'],
  exportSupport: 'native',
  exportNote: 'A diagnostic, not part of the effect. It disappears on export.',
  inputs: [{ key: 'particles', label: 'Particles', type: 'geometry' }],
  outputs: [
    { key: 'out', label: 'Particles', type: 'geometry' },
    { key: 'alive', label: 'Alive', type: 'int' },
    { key: 'maxSpeed', label: 'Fastest', type: 'float', unit: 'studs/second' },
    { key: 'maxDistance', label: 'Furthest out', type: 'float', unit: 'studs' },
    { key: 'healthy', label: 'Technically valid', type: 'bool' },
  ],
  evaluate: (api, i) => {
    const g = i.particles;
    const count = GEO.pointCount(g);
    let maxSpeed = 0, maxDist = 0, nonFinite = 0;
    for (let k = 0; k < count; k++) {
      const p = GEO.readAttr(g.points, 'position', k, [0, 0, 0]);
      const v = GEO.hasAttr(g.points, 'velocity') ? GEO.readAttr(g.points, 'velocity', k, [0, 0, 0]) : [0, 0, 0];
      if (V.hasNonFinite(p) || V.hasNonFinite(v)) { nonFinite++; continue; }
      maxSpeed = Math.max(maxSpeed, V.vLength(v));
      maxDist = Math.max(maxDist, V.vLength(p));
    }
    if (!count) api.warn('There are no particles here at this frame. Check the spawn rate, the lifetime, and whether the kill condition is always true.');
    if (nonFinite) api.error(`${nonFinite} particle${nonFinite === 1 ? '' : 's'} have a position or velocity that is not a finite number.`);
    if (maxDist > 1e5) api.warn(`A particle is ${Math.round(maxDist)} studs out, which usually means an unbounded force. Add drag or clamp the force.`);
    if (maxSpeed > 1e4) api.warn(`A particle is travelling at ${Math.round(maxSpeed)} studs/second and will pass through colliders. Raise the substeps.`);
    return { out: g, alive: count, maxSpeed, maxDistance: maxDist, healthy: !nonFinite && count > 0 };
  },
});

// ---------------------------------------------------------------- velocity-dependent forces
// The only forces that are NOT already vector fields, because each is a function of the velocity of
// the thing it acts on — which a field cannot see, since a field is evaluated at a point in space and
// knows nothing about what is passing through it. Everything else belongs in nodes/fields.js.
node({
  id: 'cadence.forces.dragForce', label: 'Drag Force', category: 'Forces', subcategory: 'Damping',
  aliases: ['air resistance', 'slow down', 'damping', 'friction', 'viscosity', 'terminal velocity'],
  summary: 'A force opposing motion, growing with speed.',
  teach: 'Slows things down, like air pushing back on them. The faster they go, the harder it pushes.',
  explain: 'Linear drag opposes velocity in proportion to speed and is what makes smoke settle. Quadratic drag grows with the square of speed, which is how real air behaves and what gives a falling object a terminal velocity. The Simulate node also has a plain Drag input, which is cheaper and unconditionally stable — prefer that unless you need drag to vary in space.',
  commonUses: ['smoke slowing as it rises', 'debris settling', 'a terminal velocity for falling sparks'],
  exportSupport: 'approximated',
  exportNote: 'Roblox ParticleEmitter has a Drag property that behaves like the linear form.',
  inputs: [
    { key: 'velocity', label: 'Velocity', type: 'field<vector3>', default: [0, 0, 0], defaultFrom: 'velocity', unit: 'studs/second' },
    n('strength', 'Strength', 1, { min: 0 }),
    mode('law', 'Grows with', ['linear', 'quadratic'], 'linear'),
  ],
  outputs: [{ key: 'out', label: 'Force', type: 'field<vector3>', unit: 'studs/second²' }],
  evaluate: (api, i) => F.makeField('vector3', (ctx) => {
    const v = V.toComponents('vector3', F.sampleAny(i.velocity, ctx));
    const speed = V.vLength(v);
    if (speed < 1e-9) return [0, 0, 0];
    const magnitude = i.law === 'quadratic' ? i.strength * speed * speed : i.strength * speed;
    const k = -magnitude / speed;
    return [v[0] * k, v[1] * k, v[2] * k];
  }),
});

node({
  id: 'cadence.forces.seek', label: 'Seek', category: 'Forces', subcategory: 'Steering',
  aliases: ['steer towards', 'home in', 'chase', 'follow target', 'missile', 'arrive', 'guided'],
  summary: 'A steering force that turns motion towards a target rather than simply pulling on it.',
  explain: 'The difference from an Attraction Field: attraction adds force towards the target, so a fast particle overshoots and orbits. Seek corrects the DIRECTION of travel towards the target, so it arrives. That is what makes a homing projectile read as guided rather than as falling.',
  commonUses: ['a homing projectile', 'particles converging on a point', 'a swarm gathering'],
  exportSupport: 'unsupported',
  inputs: [
    { key: 'target', label: 'Target', type: 'field<vector3>', default: [0, 0, 0], unit: 'studs' },
    { key: 'position', label: 'Position', type: 'field<vector3>', default: [0, 0, 0], defaultFrom: 'position', unit: 'studs' },
    { key: 'velocity', label: 'Velocity', type: 'field<vector3>', default: [0, 0, 0], defaultFrom: 'velocity', unit: 'studs/second' },
    n('speed', 'Desired speed', 10, { min: 0, unit: 'studs/second' }),
    n('strength', 'Turn strength', 4, { min: 0 }),
    n('arriveWithin', 'Slow down within', 0, { min: 0, unit: 'studs', description: 'Ease off inside this distance so the particle settles instead of overshooting. Zero means never slow down.' }),
  ],
  outputs: [{ key: 'out', label: 'Force', type: 'field<vector3>', unit: 'studs/second²' }],
  evaluate: (api, i) => F.makeField('vector3', (ctx) => {
    const p = V.toComponents('vector3', F.sampleAny(i.position, ctx));
    const t = V.toComponents('vector3', F.sampleAny(i.target, ctx));
    const v = V.toComponents('vector3', F.sampleAny(i.velocity, ctx));
    const to = [t[0] - p[0], t[1] - p[1], t[2] - p[2]];
    const dist = V.vLength(to);
    if (dist < 1e-9) return [0, 0, 0];
    let wanted = i.speed;
    if (i.arriveWithin > 0 && dist < i.arriveWithin) wanted = i.speed * (dist / i.arriveWithin);
    const desired = [(to[0] / dist) * wanted, (to[1] / dist) * wanted, (to[2] / dist) * wanted];
    // Steer along the difference between where we are going and where we want to go.
    return [
      (desired[0] - v[0]) * i.strength,
      (desired[1] - v[1]) * i.strength,
      (desired[2] - v[2]) * i.strength,
    ];
  }),
});

// ---------------------------------------------------------------- reading a particle
// Particles are points, so Read Attribute already covers every custom value. These exist because the
// three quantities below are the ones nearly every effect drives something from, and asking a user to
// remember that normalised age is spelled "life" is a bad trade for one saved node.
const particleRead = (id, label, aliases, summary, name, type, extra = {}) => node({
  id, label, category: C, subcategory: 'Read', aliases, summary,
  teach: extra.teach, explain: extra.explain, commonUses: extra.commonUses,
  exportSupport: extra.exportSupport || 'native',
  inputs: [],
  outputs: [{ key: 'out', label, type: `field<${type}>`, unit: extra.unit }],
  evaluate: () => F.makeField(type, (ctx) => {
    const raw = F.attrRaw(ctx, name);
    return raw === undefined ? V.coerceToKind(type, 0, 0) : V.coerceToKind(type, raw, 0);
  }),
});

particleRead('cadence.particles.age', 'Age', ['how old', 'seconds alive', 'elapsed', 'time alive'],
  'How long this particle has been alive, in seconds.', 'age', 'float', { unit: 'seconds' });

particleRead('cadence.particles.life', 'Normalized Age', ['life', 'progress', 'fade over life', '0 to 1 age', 'lifetime fraction', 'over lifetime'],
  'How far through its life this particle is, from 0 at birth to 1 at death.',
  'life', 'float', {
    teach: 'Counts from 0 when the particle is born to 1 when it dies, whatever its lifetime is.',
    explain: 'This is the input almost every "over lifetime" curve wants. Because it is normalised, a curve built against it works unchanged when the lifetime changes — which is why the engine has no separate "size over lifetime" or "colour over lifetime" property: you feed this into a Curve or a Gradient and get both.',
    commonUses: ['fading opacity out as a particle dies', 'growing then shrinking a size', 'shifting colour from white-hot to smoke'],
  });

particleRead('cadence.particles.velocityOf', 'Particle Velocity', ['speed', 'how fast', 'motion', 'direction of travel', 'stretch direction'],
  'How fast and which way this particle is moving.', 'velocity', 'vector3', { unit: 'studs/second' });

node({
  id: 'cadence.particles.speed', label: 'Particle Speed', category: C, subcategory: 'Read',
  aliases: ['how fast', 'magnitude of velocity', 'colour by speed', 'velocity length'],
  summary: 'How fast this particle is moving, ignoring direction.',
  explain: 'Colouring or sizing by speed is one of the cheapest ways to make a simulation read as physical rather than as a scatter — fast particles reading hot and slow ones cold is a cue the eye picks up immediately.',
  commonUses: ['colouring sparks by speed', 'stretching a sprite more the faster it goes'],
  exportSupport: 'baked',
  inputs: [],
  outputs: [{ key: 'out', label: 'Speed', type: 'field<float>', unit: 'studs/second' }],
  evaluate: () => F.makeField('float', (ctx) => V.vLength(V.toComponents('vector3', F.attr(ctx, 'velocity', [0, 0, 0])))),
});
