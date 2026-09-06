// PNX particle solver: real stateful simulation with deterministic scrubbing (spec Parts 25-30).
//
// THIS IS THE MODULE THAT SUPERSEDES THE ANALYTIC SAMPLER. Cadence's existing vfx.js computes a
// particle's position as a closed-form function of (spawnFrame, hash, age). That is what made
// scrubbing free, and it is also a hard ceiling: forces that depend on where a particle currently is,
// collisions, drag, neighbour interaction, fluids and pyro cannot be written as a function of age.
//
// So this is stateful integration. The problem that creates — and the one this file exists to solve —
// is that determinism under scrubbing is load-bearing for the whole app: the timeline, onion skin,
// render_frame and export baking all assume "same frame in, same result out". A naive stateful
// simulation breaks every one of them, because frame 40 would depend on whether you arrived from 39
// or from 400.
//
// The answer (Part 28) is REPLAY FROM CHECKPOINTS:
//
//   seek(f) where f == current   -> return the state
//            where f >  current   -> step forward
//            where f <  current   -> restore the newest checkpoint at or before f, then step forward
//
// Every path to frame f therefore executes exactly the same sequence of steps from the same starting
// state, so it produces exactly the same result. Scrubbing backwards costs a replay; scrubbing
// forwards is free. That is the trade the spec asks for, and it is the only one that keeps the app's
// existing promises.
//
// THREE THINGS THE DETERMINISM DEPENDS ON, none of which can be relaxed:
//   1. Fixed timestep. dt comes from the frame rate, never from wall-clock time.
//   2. No Math.random. Every random value derives from seedFor(nodePath, graphSeed, particleId).
//   3. Particle ids are assigned by a counter that is part of the checkpointed state, so a replay
//      hands the same particle the same id and therefore the same seed.
//
// PARTICLES ARE POINTS. The state is a geometry.js attribute table, which means a particle set IS a
// point-domain geometry. Everything built in phase 4 — instancing, sampling, nearest-point, attribute
// reads — works on simulated particles with no adapter, and a renderer consumes one type rather than
// two. `position`, `velocity`, `age`, `lifetime`, `life`, `id`, `seed` and `mass` are predeclared
// because the solver itself reads them; everything else a graph wants is an ordinary custom
// attribute, so `temperature` and `magicStrength` are exactly as first-class (Part 5).
//
// FORCES ARE FIELDS. A force input is a `field<vector3>` sampled per particle per substep, with the
// particle's own position/velocity/age/attributes in the sample context. That is why this file
// contains no gravity node, no vortex node and no turbulence node: those already exist as vector
// fields from Part 19, and they compose with the whole maths library. The only forces implemented
// HERE are the ones that are functions of velocity rather than of position (drag, friction), because
// a field cannot see the velocity of the thing it is being applied to until it is inside this loop.

import * as V from './values.js';
import * as F from './fields.js';
import * as GEO from './geometry.js';
import { SpatialGrid } from './spatial.js';

// The attributes the solver itself reads or writes. Anything else is a user attribute.
export const CORE_ATTRS = [
  ['position', 3], ['velocity', 3], ['age', 1], ['lifetime', 1],
  ['life', 1], ['id', 1], ['seed', 1], ['mass', 1],
  // Event bookkeeping (Part 12): the trigger field's last value (for rising-edge detection) and the
  // per-particle interval timer. Core because the solver reads them every step.
  ['trigger', 1], ['timer', 1],
];
const CORE_NAMES = new Set(CORE_ATTRS.map(([n]) => n));

// ---------------------------------------------------------------- events
// An event stream is what a Simulate node's `events` output carries and what an Emitter's `events`
// input reads: `{ __events: true, eventsAt(frame) -> [record] }`. A record describes one thing that
// happened during the step INTO `frame`: a birth, a death, a collision, a trigger crossing, or an
// interval tick, with the particle's position, velocity, age and custom attributes at that moment.
// The stream is an ACCESSOR rather than a list because a child simulation replaying from a checkpoint
// needs the parent's events for every frame it re-steps, not only the current one.
export const EVENT_KINDS = ['birth', 'death', 'collision', 'trigger', 'interval'];
export const isEvents = (v) => !!v && v.__events === true && typeof v.eventsAt === 'function';
export const EMPTY_EVENTS = Object.freeze({ __events: true, eventsAt: () => [] });

// The custom (non-core) attributes of one row, copied into a plain object so an event outlives the
// row it came from. Only rows that produce an event pay for this.
function customAttrsOf(table, row) {
  let out = null;
  for (const name of GEO.attrNames(table)) {
    if (CORE_NAMES.has(name)) continue;
    if (!out) out = Object.create(null);
    out[name] = GEO.readAttr(table, name, row, 0);
  }
  return out;
}

function eventRecord(kind, table, row, state) {
  return {
    kind,
    id: GEO.readAttr(table, 'id', row, 0),
    position: GEO.readAttr(table, 'position', row, [0, 0, 0]),
    velocity: GEO.readAttr(table, 'velocity', row, [0, 0, 0]),
    age: GEO.readAttr(table, 'age', row, 0),
    life: Math.min(1, GEO.readAttr(table, 'life', row, 0)),
    time: state.time,
    attributes: customAttrsOf(table, row),
  };
}

// Per-frame event lists are capped so a runaway rate cannot turn history into a memory leak. The cap
// is far above anything a preview draws; when it is hit the frame's list says so.
const MAX_EVENTS_PER_FRAME = 20000;
const MAX_HISTORY_FRAMES = 4096;

export const COLLISION_RESPONSES = ['bounce', 'slide', 'stick', 'kill', 'none'];

// ---------------------------------------------------------------- state
// FRAME CONVENTION, and it is worth being exact about because everything downstream counts on it:
// frame `startFrame` is the UNTOUCHED initial state at t = 0, before anything has been simulated.
// Frame N is therefore the state after exactly (N - startFrame) steps of dt. So at 30fps a 30/second
// emitter holds 10 particles at frame 10, and a particle released at frame 0 under 10 studs/s^2 is
// travelling at exactly 10 studs/s at frame 30. Starting the count at -1 instead — "no frame has been
// simulated" — silently runs one extra step for every seek, which reads as an effect that is slightly
// ahead of its own timeline and as physics that is a few percent wrong.
export function newState(startFrame = 0) {
  const table = GEO.newTable(0);
  for (const [name, comps] of CORE_ATTRS) GEO.ensureAttr(table, name, comps);
  return {
    table,
    frame: startFrame,
    time: 0,
    nextId: 0,
    spawnDebt: 0,     // fractional particles carried between frames, so a rate of 0.5/s works
    stats: { spawned: 0, died: 0, collisions: 0 },
  };
}

export function cloneState(s) {
  return {
    table: GEO.cloneTable(s.table),
    frame: s.frame,
    time: s.time,
    nextId: s.nextId,
    spawnDebt: s.spawnDebt,
    stats: { ...s.stats },
  };
}

// The state as a geometry, for anything downstream. Shares the table rather than copying it: the
// consumer is read-only by convention, and copying a 50 000-particle table on every frame of preview
// would dominate the frame time.
export function stateAsGeometry(s) {
  const g = GEO.newGeometry();
  g.points = s.table;
  return g;
}

export function particleCount(s) {
  return s.table.count;
}

// ---------------------------------------------------------------- spawning
// Emission is rate * dt plus whatever fraction was left over last step. Carrying the remainder is
// what makes a rate of 0.5 particles/second emit one particle every two seconds rather than none at
// all — truncating each step independently is a classic emitter bug that makes low rates silently dead.
function spawnCount(spec, state, dt) {
  let count = 0;
  if (spec.rate > 0) {
    const exact = spec.rate * dt + state.spawnDebt;
    count = Math.floor(exact);
    state.spawnDebt = exact - count;
  }
  // A burst fires on the single step whose window contains its time, so it fires exactly once
  // regardless of frame rate, and replays identically.
  for (const burst of spec.bursts || []) {
    const t = burst.time || 0;
    if (state.time <= t && t < state.time + dt) count += Math.max(0, Math.round(burst.count));
  }
  return count;
}

// Where a new particle starts. An emitter geometry is sampled by area when it has faces, by point
// otherwise — which means every phase-4 primitive and every sampling node is already a valid emitter
// shape, including ones built by the user out of SDFs and noise.
function emitPosition(spec, index, rng) {
  const emitter = spec.emitter;
  if (!GEO.isGeometry(emitter) || !GEO.pointCount(emitter)) return [0, 0, 0];

  if (spec.emitFrom === 'surface' && GEO.faceCount(emitter)) {
    const cum = spec._areaTable || (spec._areaTable = GEO.faceAreaTable(emitter));
    if (cum[cum.length - 1] > 0) {
      const face = GEO.pickFaceByArea(cum, rng(1));
      const bary = GEO.barycentric(rng(2), rng(3));
      const tri = GEO.triangleCorners(emitter, face);
      return [0, 1, 2].map((a) => tri[0][a] * bary[0] + tri[1][a] * bary[1] + tri[2][a] * bary[2]);
    }
  }
  if (spec.emitFrom === 'curve' && GEO.curveCount(emitter)) {
    const c = Math.floor(rng(4) * GEO.curveCount(emitter)) % GEO.curveCount(emitter);
    return GEO.sampleCurve(emitter, c, rng(5)).position;
  }
  // 'points', and the fallback for everything else: pick one of the emitter's points.
  const k = Math.floor(rng(6) * GEO.pointCount(emitter)) % GEO.pointCount(emitter);
  return GEO.readAttr(emitter.points, 'position', k, [0, 0, 0]);
}

// The normal at the emission point, when there is one — what "emit along the surface" needs.
function emitNormal(spec, position) {
  const emitter = spec.emitter;
  if (!GEO.isGeometry(emitter) || !GEO.pointCount(emitter) || !GEO.hasAttr(emitter.points, 'normal')) return null;
  // Nearest emitter point's normal. Exact for point emission and close enough for surface emission,
  // where the alternative is threading the face index out of emitPosition for a value that is only
  // used as an initial direction.
  let best = Infinity, bi = 0;
  for (let k = 0; k < GEO.pointCount(emitter); k++) {
    const p = GEO.readAttr(emitter.points, 'position', k, [0, 0, 0]);
    const d = V.vDistance(p, position);
    if (d < best) { best = d; bi = k; }
  }
  return GEO.readAttr(emitter.points, 'normal', bi, [0, 1, 0]);
}

// The particles born from EVENTS this frame (Part 26's "spawn on death / on collision", generalised):
// each source stream is asked for the events of the frame being produced, and every event yields
// `perEvent` births at the event's position, carrying `inherit` × the event's velocity plus whatever
// the emitter's own initial-velocity field says. Asked once per frame, on the first substep, so an
// event spawns exactly once however many substeps the frame has.
function eventSpawns(spec, state) {
  const out = [];
  for (const src of spec.eventSources || []) {
    if (!src || typeof src.eventsAt !== 'function') continue;
    const list = src.eventsAt(state.frame + 1) || [];
    const per = Math.max(0, Math.round(src.perEvent ?? 1));
    const inherit = Number.isFinite(src.inherit) ? src.inherit : 0;
    for (const ev of list) {
      const v = ev.velocity || [0, 0, 0];
      for (let k = 0; k < per; k++) {
        out.push({
          position: ev.position || [0, 0, 0],
          velocity: [v[0] * inherit, v[1] * inherit, v[2] * inherit],
          parentVelocity: v,
          attributes: ev.attributes || null,
        });
      }
    }
  }
  return out;
}

function doSpawn(state, spec, dt, ctxHolder, stepEvents, firstSubstep) {
  const count = spawnCount(spec, state, dt);
  const fromEvents = firstSubstep ? eventSpawns(spec, state) : [];
  const wanted = count + fromEvents.length;
  if (wanted <= 0) return 0;

  const limit = Math.max(0, spec.maxParticles);
  const room = Math.max(0, limit - state.table.count);
  const actual = Math.min(wanted, room);
  if (actual <= 0) return 0;

  const at = state.table.count;
  GEO.resizeTable(state.table, at + actual);
  for (const [name, comps] of CORE_ATTRS) GEO.ensureAttr(state.table, name, comps);

  for (let k = 0; k < actual; k++) {
    const row = at + k;
    const id = state.nextId++;
    const rng = (channel) => spec.random(id, channel);
    // Event births come first so a full pool still honours them: they are the ones a user wired up
    // on purpose, while a rate is a background stream.
    const ev = k < fromEvents.length ? fromEvents[k] : null;
    let pos;
    if (ev) {
      // The spawn shape, when there is one, is an OFFSET around the event: a small sphere at each
      // death gives a puff rather than a point.
      const off = spec.emitter ? emitPosition(spec, k, rng) : [0, 0, 0];
      pos = [ev.position[0] + off[0], ev.position[1] + off[1], ev.position[2] + off[2]];
    } else {
      pos = emitPosition(spec, k, rng);
    }

    GEO.writeAttr(state.table, 'id', row, id);
    GEO.writeAttr(state.table, 'seed', row, F.seedFor(spec.path, spec.graphSeed, id) >>> 0);
    GEO.writeAttr(state.table, 'position', row, pos);
    GEO.writeAttr(state.table, 'age', row, 0);
    GEO.writeAttr(state.table, 'life', row, 0);
    GEO.writeAttr(state.table, 'trigger', row, 0);
    GEO.writeAttr(state.table, 'timer', row, 0);

    // The spawn fields see a context describing the particle being born: its position, its emitter
    // normal, its own index and seed. That is what lets initial velocity be "along the normal, with
    // a random spread" without any of those being built-in options. A particle born from an event
    // also sees the parent's velocity and custom attributes, so "inherit the parent's colour" is a
    // Read Attribute, not a feature.
    const ctx = ctxHolder;
    ctx.position = pos;
    ctx.index = id;
    ctx.seed = F.seedFor(spec.path, spec.graphSeed, id) >>> 0;
    ctx.age = 0;
    ctx.life = 0;
    ctx.time = state.time;
    ctx.velocity = ev ? ev.parentVelocity : [0, 0, 0];
    const pv = ev ? ev.parentVelocity : null;
    ctx.normal = (pv && V.vLength(pv) > 1e-6) ? V.vNormalize(pv) : (emitNormal(spec, pos) || [0, 1, 0]);
    ctx.attributes = ev ? ev.attributes : null;

    const lifetime = Math.max(1e-4, Number(F.sampleAny(spec.lifetime, ctx)) || 1);
    GEO.writeAttr(state.table, 'lifetime', row, lifetime);
    GEO.writeAttr(state.table, 'mass', row, Math.max(1e-6, Number(F.sampleAny(spec.mass, ctx)) || 1));
    const iv = V.toComponents('vector3', F.sampleAny(spec.initialVelocity, ctx));
    const vel = ev ? [iv[0] + ev.velocity[0], iv[1] + ev.velocity[1], iv[2] + ev.velocity[2]] : iv;
    GEO.writeAttr(state.table, 'velocity', row, vel);

    // Initial custom attributes. Created on demand, so a graph that writes `temperature` at spawn
    // gets a temperature column and one that does not pays nothing.
    for (const w of spec.spawnWrites || []) {
      if (!w.name || w.remove) continue;
      const value = F.sampleAny(w.value, ctx);
      GEO.ensureAttr(state.table, w.name, Array.isArray(value) ? value.length : 1);
      GEO.writeAttr(state.table, w.name, row, value);
    }
    if (stepEvents && stepEvents.length < MAX_EVENTS_PER_FRAME) stepEvents.push(eventRecord('birth', state.table, row, state));
  }
  state.stats.spawned += actual;
  return actual;
}

// ---------------------------------------------------------------- collision
// Colliders are SDFs, which is the reason this function is short and general: plane, sphere, box,
// capsule, mesh-converted and anything a user composed out of smooth unions are all just a
// field<float>, and the contact normal is the field's gradient. Part 29's list of collider shapes
// needs no per-shape code at all.
function resolveCollision(state, row, collider, dt) {
  // Read fresh rather than reusing the walker's scratch: integration has just written a new position,
  // and a stale one here would test the collision against where the particle used to be.
  const p = GEO.readAttr(state.table, 'position', row, [0, 0, 0]);
  const v = GEO.readAttr(state.table, 'velocity', row, [0, 0, 0]);
  const ctx = collider.ctx;
  ctx.position = p;
  ctx.velocity = v;
  ctx.index = row;

  const d = Number(F.sampleAny(collider.shape, ctx));
  const thickness = collider.thickness || 0;
  if (!(d < thickness)) return false;   // not touching

  if (collider.response === 'kill') return 'kill';

  // The contact normal: the direction the distance increases fastest, i.e. straight out of the
  // surface. Estimated by central differences, which works for any composed shape.
  const e = collider.epsilon || 0.01;
  const sampleAt = (dx, dy, dz) => {
    ctx.position = [p[0] + dx, p[1] + dy, p[2] + dz];
    return Number(F.sampleAny(collider.shape, ctx));
  };
  let nrm = V.vNormalize([
    (sampleAt(e, 0, 0) - sampleAt(-e, 0, 0)) / (2 * e),
    (sampleAt(0, e, 0) - sampleAt(0, -e, 0)) / (2 * e),
    (sampleAt(0, 0, e) - sampleAt(0, 0, -e)) / (2 * e),
  ]);
  ctx.position = p;
  if (!(V.vLength(nrm) > 1e-6)) nrm = [0, 1, 0];   // a flat spot in the field: pick something valid

  // Push out to the surface first, so a particle never accumulates inside the collider. Doing this
  // before the velocity response matters: resolving velocity while still embedded lets a particle
  // sink further every step and eventually tunnel through.
  const push = thickness - d;
  GEO.writeAttr(state.table, 'position', row, [p[0] + nrm[0] * push, p[1] + nrm[1] * push, p[2] + nrm[2] * push]);

  if (collider.response === 'stick') {
    GEO.writeAttr(state.table, 'velocity', row, [0, 0, 0]);
    return 'hit';
  }
  if (collider.response === 'none') return 'hit';

  const vn = V.vDot(v, nrm);
  // Only respond to motion INTO the surface. A particle already moving away is leaving, and
  // reflecting it again is what produces jitter along a wall.
  if (vn < 0) {
    const normalPart = [nrm[0] * vn, nrm[1] * vn, nrm[2] * vn];
    const tangentPart = [v[0] - normalPart[0], v[1] - normalPart[1], v[2] - normalPart[2]];
    const restitution = collider.response === 'slide' ? 0 : V.clamp(collider.restitution, 0, 1);
    const friction = V.clamp(collider.friction, 0, 1);
    GEO.writeAttr(state.table, 'velocity', row, [
      tangentPart[0] * (1 - friction) - normalPart[0] * restitution,
      tangentPart[1] * (1 - friction) - normalPart[1] * restitution,
      tangentPart[2] * (1 - friction) - normalPart[2] * restitution,
    ]);
  }
  return 'hit';
}

// ---------------------------------------------------------------- the step
// One frame, in the stage order of Part 28. Substeps subdivide the frame for stability: a fast
// particle and a thin collider need a smaller step than one frame, and raising substeps is the fix
// that does not change the look of the simulation, only its accuracy.
export function stepState(state, spec, dt) {
  const substeps = Math.max(1, Math.min(16, Math.round(spec.substeps || 1)));
  const h = dt / substeps;
  const walkCtx = F.newSampleContext();
  // Everything that happens during this frame, for the Simulate node's `events` output. Always
  // collected: recording is a few small objects per birth/death and nothing at all in a quiet frame,
  // and it is what lets a child emitter replay from a checkpoint identically.
  const frameEvents = [];

  for (let sub = 0; sub < substeps; sub++) {
    // --- SPAWN
    doSpawn(state, spec, h, walkCtx, frameEvents, sub === 0);

    const count = state.table.count;
    if (count) {
      const table = state.table;
      const walker = GEO.makeElementContext(stateAsGeometry(state), 'point', { time: state.time });

      // NEIGHBOURS (Part 27). The walker's default neighbour query reads the live table, which is
      // being rewritten as this loop runs — a particle late in the row order would see its early
      // neighbours already moved. So the solver installs its own query over a SNAPSHOT taken here,
      // after spawning and before any integration: every particle sees the same picture, whatever
      // its row, which makes flocking independent of row order and therefore replayable. Built
      // lazily on the first request, so a graph with no neighbour-aware node pays nothing.
      let grid = null;
      const gridFor = (radius) => grid || (grid = SpatialGrid.fromTable(table, Math.max(1e-3, Number(radius) || 1)));
      walker.ctx.neighbours = (radius, fn) => gridFor(radius).query(walker.ctx.position, radius, walker.ctx.index, fn);
      walker.ctx.nearestNeighbour = (maxRadius) => gridFor(maxRadius).nearest(walker.ctx.position, walker.ctx.index);
      // EVENTS — Part 12 / Part 26. Deaths, contacts and trigger crossings are collected here as
      // data (the information exists only inside this loop) and recorded on the Simulation as the
      // frame's history. A child emitter reads that history by frame; it never runs inside this loop,
      // which is what keeps the step re-entrant and the determinism argument simple.
      const events = frameEvents;
      const hasTrigger = !!spec.triggerWhen;
      const every = Math.max(0, Number(spec.triggerEvery) || 0);

      for (let row = 0; row < count; row++) {
        const ctx = walker.at(row);
        ctx.time = state.time;

        // --- FORCES. Sampled per particle, so a force may depend on where this particle is, how old
        // it is, how fast it is going, or any attribute it carries.
        const mass = Math.max(1e-6, Number(GEO.readAttr(table, 'mass', row, 1)) || 1);
        const f = V.toComponents('vector3', F.sampleAny(spec.force, ctx));
        const acc = [f[0] / mass, f[1] / mass, f[2] / mass];

        const v = GEO.readAttr(table, 'velocity', row, [0, 0, 0]);

        // Velocity-dependent damping. Exponential rather than linear (v *= 1 - k*dt) because the
        // linear form goes NEGATIVE — and therefore explodes — as soon as k*dt exceeds 1, which a
        // user reaches simply by dragging a drag slider up.
        const drag = Math.max(0, Number(F.sampleAny(spec.drag, ctx)) || 0);
        const damp = drag > 0 ? Math.exp(-drag * h) : 1;

        // --- INTEGRATION. Semi-implicit Euler: velocity first, then position from the NEW velocity.
        // Explicit Euler (position from the old velocity) loses energy on a spring and gains it on an
        // orbit; semi-implicit is stable for both at the same cost, which matters because an orbiting
        // particle system that slowly flies apart looks like a bug in the force, not in the integrator.
        const nv = [
          (v[0] + acc[0] * h) * damp,
          (v[1] + acc[1] * h) * damp,
          (v[2] + acc[2] * h) * damp,
        ];
        const p = ctx.position;
        GEO.writeAttr(table, 'velocity', row, nv);
        GEO.writeAttr(table, 'position', row, [p[0] + nv[0] * h, p[1] + nv[1] * h, p[2] + nv[2] * h]);

        // --- COLLISION
        let killed = false;
        for (const collider of spec.colliders || []) {
          const r = resolveCollision(state, row, collider, h);
          if (r === 'kill') { killed = true; break; }
          if (r === 'hit') {
            state.stats.collisions++;
            if (events.length < MAX_EVENTS_PER_FRAME) events.push(eventRecord('collision', table, row, state));
          }
        }

        // --- POST-SIMULATION: ageing, then the kill tests.
        const age = Number(GEO.readAttr(table, 'age', row, 0)) + h;
        const lifetime = Math.max(1e-4, Number(GEO.readAttr(table, 'lifetime', row, 1)) || 1);
        GEO.writeAttr(table, 'age', row, age);
        GEO.writeAttr(table, 'life', row, Math.min(1, age / lifetime));

        if (!killed && spec.killByAge !== false && age >= lifetime) killed = true;
        if (!killed && (spec.kill || hasTrigger)) {
          // Re-read the context so the tests see this step's position and age, not last step's.
          const post = walker.at(row);
          post.time = state.time;
          if (spec.kill && F.sampleAny(spec.kill, post)) killed = true;
          if (!killed && hasTrigger) {
            // A trigger fires on the RISING EDGE of its condition: once when it becomes true, not on
            // every step it stays true. The previous value rides along as a core attribute so a replay
            // from a checkpoint sees the same edges.
            const on = !!F.sampleAny(spec.triggerWhen, post);
            const was = GEO.readAttr(table, 'trigger', row, 0) > 0.5;
            if (on && !was && events.length < MAX_EVENTS_PER_FRAME) events.push(eventRecord('trigger', table, row, state));
            GEO.writeAttr(table, 'trigger', row, on ? 1 : 0);
          }
        }
        if (!killed && every > 0) {
          // A per-particle timer, so "every 0.2 seconds" is measured from each particle's own birth.
          let t = Number(GEO.readAttr(table, 'timer', row, 0)) + h;
          while (t >= every) {
            t -= every;
            if (events.length < MAX_EVENTS_PER_FRAME) events.push(eventRecord('interval', table, row, state));
          }
          GEO.writeAttr(table, 'timer', row, t);
        }
        if (killed && events.length < MAX_EVENTS_PER_FRAME) events.push(eventRecord('death', table, row, state));
        // Mark for compaction rather than deleting now: removing a row mid-loop would renumber every
        // row after it and silently skip a particle.
        if (killed) GEO.writeAttr(table, 'life', row, 2);   // 2 is the "dead" sentinel; live life is 0..1
      }

      const before = table.count;
      GEO.compactTable(table, (row) => Number(GEO.readAttr(table, 'life', row, 0)) <= 1);
      state.stats.died += before - table.count;
    }

    state.time += h;
  }
  state.frame += 1;
  // Handed out as data, never acted on here: a sub-emitter is another simulation, and running one
  // inside this loop would make the step non-reentrant and its determinism unarguable.
  state.lastEvents = frameEvents;
  if (typeof spec.events === 'function' && frameEvents.length) spec.events(frameEvents, state);
  return state;
}

// ---------------------------------------------------------------- the simulation, with replay
// Owns the state, the checkpoints and the seek logic. One of these exists per Simulate node instance,
// keyed by the node's path so a group used twice does not share a simulation.
export class Simulation {
  constructor(spec, options = {}) {
    this.spec = spec;
    this.fps = options.fps || 30;
    this.startFrame = options.startFrame || 0;
    this.checkpointEvery = Math.max(1, options.checkpointEvery || 8);
    this.maxCheckpoints = Math.max(2, options.maxCheckpoints || 64);
    this.maxCatchUpFrames = Math.max(1, options.maxCatchUpFrames || 6000);
    this.state = newState(this.startFrame);
    this.checkpoints = new Map();   // frame -> cloned state
    this.history = new Map();       // frame -> the events of the step INTO that frame
    this.lastSeek = { frame: null, steps: 0 };
  }

  reset() {
    this.state = newState(this.startFrame);
    this.checkpoints.clear();
    this.history.clear();
    this.spec._areaTable = null;
  }

  // The events of the step into `frame`, for a child emitter. A hit in the recorded history is free.
  // A miss for a frame this simulation has already passed is REPLAYED on a scratch copy from the
  // newest checkpoint before it — never on the live state, which a renderer may be reading through
  // the shared table — and the frames replayed on the way are recorded too. A frame in the future is
  // simply empty: the parent is always evaluated first (the child pulls on it), so that only happens
  // when a child starts earlier than its parent, and then there genuinely were no events.
  eventsAt(frame) {
    const f = Math.floor(frame);
    const hit = this.history.get(f);
    if (hit) return hit;
    if (f <= this.startFrame || f > this.state.frame) return [];
    let bestFrame = -Infinity, best = null;
    for (const [cf, s] of this.checkpoints) {
      if (cf < f && cf > bestFrame) { bestFrame = cf; best = s; }
    }
    let scratch = best ? cloneState(best) : newState(this.startFrame);
    const dt = 1 / this.fps;
    let steps = 0;
    while (scratch.frame < f && steps < this.maxCatchUpFrames) {
      stepState(scratch, this.spec, dt);
      this._record(scratch.frame, scratch.lastEvents);
      steps++;
    }
    return this.history.get(f) || [];
  }

  _record(frame, events) {
    this.history.set(frame, events || []);
    if (this.history.size > MAX_HISTORY_FRAMES) {
      // Drop the oldest frames; anything a child still needs is reconstructed by eventsAt's replay.
      const frames = [...this.history.keys()].sort((a, b) => a - b);
      for (let k = 0; k < frames.length - MAX_HISTORY_FRAMES; k++) this.history.delete(frames[k]);
    }
  }

  // The state at the END of `frame`. This is the function the whole determinism argument rests on:
  // every route to a given frame runs the same steps from the same start.
  seek(frame) {
    const target = Math.max(this.startFrame, Math.floor(frame));
    const dt = 1 / this.fps;

    if (this.state.frame === target) { this.lastSeek = { frame: target, steps: 0 }; return this.state; }

    // Going backwards (or to before the start): rewind to the newest usable checkpoint.
    if (target < this.state.frame) {
      let bestFrame = -Infinity, best = null;
      for (const [f, s] of this.checkpoints) {
        if (f <= target && f > bestFrame) { bestFrame = f; best = s; }
      }
      this.state = best ? cloneState(best) : newState(this.startFrame);
      if (!best) this.spec._areaTable = null;
    }

    // A very long catch-up is a real possibility (jumping to frame 9000 of a 30fps effect), and
    // silently spending a minute on it is worse than saying so. The caller surfaces this.
    let steps = 0;
    const budget = this.maxCatchUpFrames;
    while (this.state.frame < target && steps < budget) {
      stepState(this.state, this.spec, dt);
      this._record(this.state.frame, this.state.lastEvents);
      steps++;
      if (this.state.frame % this.checkpointEvery === 0) this._checkpoint();
    }
    this.lastSeek = { frame: target, steps, truncated: this.state.frame < target };
    return this.state;
  }

  _checkpoint() {
    this.checkpoints.set(this.state.frame, cloneState(this.state));
    if (this.checkpoints.size <= this.maxCheckpoints) return;
    // Drop the OLDEST checkpoint past the first: the first is the cheapest possible restart point and
    // throwing it away would make an early scrub replay the whole history.
    const frames = [...this.checkpoints.keys()].sort((a, b) => a - b);
    this.checkpoints.delete(frames[1] ?? frames[0]);
  }

  memoryEstimate() {
    let bytes = 0;
    const tableBytes = (t) => Object.values(t.attrs).reduce((s, c) => s + c.data.byteLength, 0);
    bytes += tableBytes(this.state.table);
    for (const s of this.checkpoints.values()) bytes += tableBytes(s.table);
    return bytes;
  }
}

// ---------------------------------------------------------------- diagnostics (Parts 61-62)
// The structured checks a verification tool reads. Deliberately about TECHNICAL validity, never about
// whether the effect looks good — the spec is explicit that those are different questions.
export function diagnoseSimulation(sim) {
  const s = sim.state;
  const out = [];
  const count = particleCount(s);

  if (count === 0 && s.frame > sim.startFrame) {
    out.push({ severity: 'warning', code: 'noParticles', message: 'No particles are alive at this frame. Check the spawn rate, the lifetime, and whether a kill condition is always true.' });
  }
  if (count >= sim.spec.maxParticles) {
    out.push({ severity: 'warning', code: 'atLimit', message: `The particle count has reached its limit of ${sim.spec.maxParticles}, so new particles are being dropped. Raise the limit or shorten the lifetime.` });
  }

  // An exploding simulation: positions or speeds running away. Caught by magnitude rather than by
  // NaN, because a simulation usually becomes useless long before it becomes non-finite.
  let maxSpeed = 0, maxDist = 0, nonFinite = 0;
  for (let k = 0; k < count; k++) {
    const p = GEO.readAttr(s.table, 'position', k, [0, 0, 0]);
    const v = GEO.readAttr(s.table, 'velocity', k, [0, 0, 0]);
    if (V.hasNonFinite(p) || V.hasNonFinite(v)) { nonFinite++; continue; }
    maxSpeed = Math.max(maxSpeed, V.vLength(v));
    maxDist = Math.max(maxDist, V.vLength(p));
  }
  if (nonFinite) {
    out.push({ severity: 'error', code: 'nonFinite', message: `${nonFinite} particle${nonFinite === 1 ? ' has' : 's have'} a position or velocity that is not a finite number. A divide by zero in a force field is the usual cause.` });
  }
  if (maxDist > 1e5) {
    out.push({ severity: 'warning', code: 'exploding', message: `A particle is ${Math.round(maxDist)} studs from the origin, which usually means a force is unbounded. Add drag, or clamp the force.` });
  }
  if (maxSpeed > 1e4) {
    out.push({ severity: 'warning', code: 'fastParticles', message: `A particle is travelling at ${Math.round(maxSpeed)} studs/second, which will tunnel through colliders. Raise the substeps or reduce the force.` });
  }
  if (sim.lastSeek.truncated) {
    out.push({ severity: 'warning', code: 'seekTruncated', message: `Reaching this frame needed more than ${sim.maxCatchUpFrames} simulation steps, so the result is incomplete. Bake the simulation, or start the effect closer to this frame.` });
  }

  return {
    ok: !out.some((d) => d.severity === 'error'),
    diagnostics: out,
    stats: {
      frame: s.frame,
      particles: count,
      spawned: s.stats.spawned,
      died: s.stats.died,
      collisions: s.stats.collisions,
      maxSpeed: Math.round(maxSpeed * 1000) / 1000,
      maxDistance: Math.round(maxDist * 1000) / 1000,
      replaySteps: sim.lastSeek.steps,
      checkpoints: sim.checkpoints.size,
      memoryBytes: sim.memoryEstimate(),
    },
  };
}
