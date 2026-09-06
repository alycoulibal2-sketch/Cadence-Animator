// Neighbour-aware nodes (spec Part 27): flocking, separation, liquid-like pressure, and the reads
// that let a look depend on crowding.
//
// WHAT MAKES THESE DIFFERENT from every other force field in the engine: a field is evaluated at a
// point and normally knows only about that point. These ask the sample context for its NEIGHBOURS —
// `ctx.neighbours(radius, fn)` — which exists on any context produced by walking a point table
// (geometry.js's element walker) and, inside the particle solver, is a snapshot of the whole state at
// the start of the substep (solver.js). Sampled anywhere else, with no neighbourhood to consult, every
// node here returns a quiet zero rather than throwing: a graph is half-built most of the time.
//
// The forces follow Reynolds' three rules. They are fields, so they add to gravity, wind and every
// other force with an ordinary Add node, and their weights can themselves vary per particle.

import * as V from '../values.js';
import * as F from '../fields.js';
import { node, n, out } from './_helpers.js';

const FORCES = 'Forces';
const PARTICLES = 'Particles';

const ZERO3 = [0, 0, 0];
const hasNeighbours = (ctx) => typeof ctx?.neighbours === 'function';

function clampLength(v, max) {
  if (!(max > 0)) return v;
  const l = V.vLength(v);
  if (l <= max || l < 1e-12) return v;
  const k = max / l;
  return [v[0] * k, v[1] * k, v[2] * k];
}

// ---------------------------------------------------------------- Flock
node({
  id: 'cadence.forces.flock', label: 'Flock', category: FORCES, subcategory: 'Flocking',
  aliases: ['boids', 'birds', 'school of fish', 'swarm', 'herd', 'crowd', 'flocking', 'follow each other', 'bees'],
  summary: 'Makes particles move like a flock: they keep apart, match speed with their neighbours, and stay together.',
  teach: 'Three rules make a flock: do not crowd your neighbours, fly the way they fly, and stay near the group.',
  explain: 'The classic boids model. Separation pushes away from anything closer than the personal space, growing stronger the closer it is. Alignment steers toward the average velocity of everything within the radius. Cohesion steers toward their average position. Each rule has its own weight, so zeroing two of them gives a pure separation or a pure gathering force, and the whole thing is clamped so a dense crowd cannot explode. It reads the neighbourhood at the start of each substep, so every particle sees the same picture whatever order they are processed in.',
  commonUses: ['a flock of birds or a school of fish', 'a swarm of sparks that hunts as a group', 'crowd motion for debris'],
  exportSupport: 'baked',
  exportNote: 'Roblox particles cannot see each other. The motion is baked per frame on export.',
  performance: 'expensive',
  inputs: [
    n('radius', 'Sees neighbours within', 3, { min: 0.01, unit: 'studs' }),
    n('personalSpace', 'Personal space', 1, { min: 0, unit: 'studs', description: 'Closer than this, particles push apart.' }),
    n('separation', 'Keep apart', 1.5, { min: 0 }),
    n('alignment', 'Match velocity', 1, { min: 0 }),
    n('cohesion', 'Stay together', 1, { min: 0 }),
    n('maxForce', 'Force limit', 30, { min: 0, unit: 'studs/second²', description: 'Caps the total so a crowd never explodes. 0 means no cap.' }),
    { key: 'velocity', label: 'Velocity', type: 'field<vector3>', default: [0, 0, 0], defaultFrom: 'velocity', unit: 'studs/second' },
  ],
  outputs: [{ key: 'out', label: 'Force', type: 'field<vector3>', unit: 'studs/second²' }],
  evaluate: (api, i) => F.makeField('vector3', (ctx) => {
    if (!hasNeighbours(ctx)) return ZERO3;
    const v = V.toComponents('vector3', F.sampleAny(i.velocity, ctx));
    const ps = Math.max(0, i.personalSpace), ps2 = ps * ps;
    let count = 0, sx = 0, sy = 0, sz = 0, cx = 0, cy = 0, cz = 0, ax = 0, ay = 0, az = 0;
    ctx.neighbours(i.radius, (row, d2, dx, dy, dz, vx, vy, vz) => {
      count++;
      cx += dx; cy += dy; cz += dz;
      ax += vx; ay += vy; az += vz;
      if (ps > 0 && d2 < ps2 && d2 > 1e-12) {
        // Push away, harder the closer: weight grows as the gap closes.
        const d = Math.sqrt(d2);
        const w = (1 - d / ps) / d;
        sx -= dx * w; sy -= dy * w; sz -= dz * w;
      }
    });
    if (!count) return ZERO3;
    const inv = 1 / count;
    const fx = sx * i.separation + (ax * inv - v[0]) * i.alignment + cx * inv * i.cohesion;
    const fy = sy * i.separation + (ay * inv - v[1]) * i.alignment + cy * inv * i.cohesion;
    const fz = sz * i.separation + (az * inv - v[2]) * i.alignment + cz * inv * i.cohesion;
    return clampLength([fx, fy, fz], i.maxForce);
  }),
});

// ---------------------------------------------------------------- Keep Apart
node({
  id: 'cadence.forces.separation', label: 'Keep Apart', category: FORCES, subcategory: 'Flocking',
  aliases: ['separation', 'repel each other', 'spread out', 'personal space', 'avoid overlap', 'no overlap', 'push apart'],
  summary: 'Pushes particles away from each other so they do not pile up.',
  teach: 'Every particle pushes its neighbours away. Useful when they all get born in one spot.',
  explain: 'A repulsion from every neighbour inside the radius, fading to nothing at the edge and growing toward the centre with the chosen softness. Softness 1 is a straight ramp; higher values keep the push gentle until particles are nearly touching. Unlike Flock this has no cohesion or alignment, so it never makes particles group up — it only spreads them.',
  commonUses: ['un-piling a burst that spawned from one point', 'keeping debris from overlapping', 'filling a region evenly'],
  exportSupport: 'baked',
  exportNote: 'Roblox particles cannot see each other. Baked per frame on export.',
  performance: 'expensive',
  inputs: [
    n('radius', 'Radius', 1.5, { min: 0.01, unit: 'studs' }),
    n('strength', 'Strength', 10, { min: 0 }),
    n('softness', 'Softness', 2, { min: 0.1, max: 8 }),
    n('maxForce', 'Force limit', 50, { min: 0, unit: 'studs/second²' }),
  ],
  outputs: [{ key: 'out', label: 'Force', type: 'field<vector3>', unit: 'studs/second²' }],
  evaluate: (api, i) => F.makeField('vector3', (ctx) => {
    if (!hasNeighbours(ctx)) return ZERO3;
    let fx = 0, fy = 0, fz = 0;
    const r = i.radius;
    ctx.neighbours(r, (row, d2, dx, dy, dz) => {
      if (d2 < 1e-12) {
        // Exactly coincident: pick a deterministic direction from the row so the pair still separates.
        const a = (row * 0.618033) % 1 * Math.PI * 2;
        fx += Math.cos(a) * i.strength; fz += Math.sin(a) * i.strength;
        return;
      }
      const d = Math.sqrt(d2);
      const w = Math.pow(1 - d / r, i.softness) * i.strength / d;
      fx -= dx * w; fy -= dy * w; fz -= dz * w;
    });
    return clampLength([fx, fy, fz], i.maxForce);
  }),
});

// ---------------------------------------------------------------- Liquid pressure (simplified SPH)
// Smoothed-particle hydrodynamics in its simplest honest form: a density estimate from a poly6 kernel,
// a pressure force that pushes from dense toward sparse, and a viscosity term that pulls velocities
// together. It is a fluid LOOK — splashes, puddles, blobs — not a fluid solver; the real thing needs
// a pressure projection, which is the grid solver's job.
const poly6 = (d2, h2, h9) => (d2 >= h2 ? 0 : (315 / (64 * Math.PI * h9)) * Math.pow(h2 - d2, 3));

node({
  id: 'cadence.forces.liquid', label: 'Liquid Pressure', category: FORCES, subcategory: 'Flocking',
  aliases: ['sph', 'fluid particles', 'water', 'blob', 'splash', 'puddle', 'incompressible', 'viscosity', 'goo', 'slime'],
  summary: 'Makes particles behave like a liquid: they resist being squeezed together and drag on each other.',
  teach: 'Particles push apart when crowded and slow down their neighbours, which is what water drops do.',
  explain: 'A simplified smoothed-particle hydrodynamics force. Each particle estimates how crowded it is with a smooth kernel over its neighbours; where the crowding is above the rest density, a pressure force pushes toward less crowded space, and a viscosity term pulls each particle\'s velocity toward its neighbours\'. With gravity and a floor collider it gives puddles, splashes and blobs. It is a look rather than a true incompressible solve, and it says so here.',
  commonUses: ['a splash that settles into a puddle', 'a blob of slime or goo', 'water pouring from a tap'],
  exportSupport: 'baked',
  exportNote: 'No Roblox equivalent. Baked per frame on export.',
  performance: 'expensive',
  inputs: [
    n('radius', 'Smoothing radius', 1, { min: 0.01, unit: 'studs' }),
    n('restDensity', 'Rest density', 2, { min: 0.01, description: 'How crowded is "normal". Below this there is no pressure.' }),
    n('stiffness', 'Stiffness', 40, { min: 0 }),
    n('viscosity', 'Viscosity', 2, { min: 0 }),
    n('maxForce', 'Force limit', 200, { min: 0, unit: 'studs/second²' }),
    { key: 'velocity', label: 'Velocity', type: 'field<vector3>', default: [0, 0, 0], defaultFrom: 'velocity', unit: 'studs/second' },
  ],
  outputs: [
    { key: 'out', label: 'Force', type: 'field<vector3>', unit: 'studs/second²' },
    { key: 'density', label: 'Density', type: 'field<float>' },
  ],
  evaluate: (api, i) => {
    const h = Math.max(0.01, i.radius), h2 = h * h, h9 = Math.pow(h, 9);
    const densityAt = (ctx) => {
      if (!hasNeighbours(ctx)) return 0;
      let rho = poly6(0, h2, h9);   // self-contribution
      ctx.neighbours(h, (row, d2) => { rho += poly6(d2, h2, h9); });
      return rho;
    };
    // Normalise so "rest density" is in units of "particles' worth of crowding": one isolated particle
    // reads 1. Users reason in counts, not in kernel units.
    const unit = poly6(0, h2, h9);
    return {
      density: F.makeField('float', (ctx) => densityAt(ctx) / unit),
      out: F.makeField('vector3', (ctx) => {
        if (!hasNeighbours(ctx)) return ZERO3;
        const rho = densityAt(ctx) / unit;
        const v = V.toComponents('vector3', F.sampleAny(i.velocity, ctx));
        const p = Math.max(0, rho - i.restDensity) * i.stiffness;
        let fx = 0, fy = 0, fz = 0;
        ctx.neighbours(h, (row, d2, dx, dy, dz, vx, vy, vz) => {
          const d = Math.sqrt(d2);
          const q = 1 - d / h;             // 1 at contact, 0 at the edge
          if (d > 1e-9 && p > 0) {
            // Spiky-kernel style pressure gradient: push away from the neighbour.
            const w = p * q * q / d;
            fx -= dx * w; fy -= dy * w; fz -= dz * w;
          }
          // Viscosity: pull our velocity toward the neighbour's, weighted by closeness.
          fx += (vx - v[0]) * q * i.viscosity;
          fy += (vy - v[1]) * q * i.viscosity;
          fz += (vz - v[2]) * q * i.viscosity;
        });
        return clampLength([fx, fy, fz], i.maxForce);
      }),
    };
  },
});

// ---------------------------------------------------------------- reads
node({
  id: 'cadence.particles.neighbourCount', label: 'Neighbour Count', category: PARTICLES, subcategory: 'Neighbours',
  aliases: ['crowding', 'how many nearby', 'density count', 'neighbors', 'nearby particles', 'count within'],
  summary: 'How many other particles (or points) are within a radius of this one.',
  teach: 'Counts the neighbours around each particle. Colour by it and crowded places light up.',
  explain: 'Works on any point geometry, not only particles: sampled while walking a scatter or a mesh\'s points it counts those. Sampled somewhere with no neighbourhood at all it reads 0.',
  commonUses: ['colouring a crowd hotter where it is dense', 'killing particles that are too crowded', 'sizing by isolation'],
  exportSupport: 'baked',
  performance: 'moderate',
  inputs: [n('radius', 'Radius', 2, { min: 0.01, unit: 'studs' })],
  outputs: [{ key: 'out', label: 'Count', type: 'field<float>' }],
  evaluate: (api, i) => F.makeField('float', (ctx) => {
    if (!hasNeighbours(ctx)) return 0;
    let c = 0;
    ctx.neighbours(i.radius, () => { c++; });
    return c;
  }),
});

node({
  id: 'cadence.particles.density', label: 'Crowding', category: PARTICLES, subcategory: 'Neighbours',
  aliases: ['density', 'smooth density', 'how packed', 'local density', 'sph density', 'thickness'],
  summary: 'A smooth measure of how packed the particles are around this one: 1 alone, higher in a crowd.',
  teach: 'Like Neighbour Count, but smooth — a particle just inside the radius counts a little, one right on top counts fully.',
  explain: 'The poly6 smoothing kernel from SPH, normalised so an isolated particle reads exactly 1. Smooth means it can drive size or opacity without popping when a neighbour crosses the radius. Feed it into a Map Range or a Gradient.',
  commonUses: ['thicker smoke where puffs overlap', 'a liquid that looks denser in the middle of a splash', 'brighter cores in a swarm'],
  exportSupport: 'baked',
  performance: 'moderate',
  inputs: [n('radius', 'Radius', 2, { min: 0.01, unit: 'studs' })],
  outputs: [{ key: 'out', label: 'Crowding', type: 'field<float>' }],
  evaluate: (api, i) => {
    const h = Math.max(0.01, i.radius), h2 = h * h, h9 = Math.pow(h, 9);
    const unit = poly6(0, h2, h9);
    return F.makeField('float', (ctx) => {
      if (!hasNeighbours(ctx)) return 1;
      let rho = unit;
      ctx.neighbours(h, (row, d2) => { rho += poly6(d2, h2, h9); });
      return rho / unit;
    });
  },
});

node({
  id: 'cadence.particles.nearestNeighbour', label: 'Nearest Neighbour', category: PARTICLES, subcategory: 'Neighbours',
  aliases: ['closest particle', 'distance to nearest', 'nearest other', 'gap', 'spacing', 'direction to nearest'],
  summary: 'The distance and direction to the closest other particle.',
  explain: 'Searches outward from the particle up to the search radius. Beyond that it reports the search radius itself and no direction, so a lonely particle reads "far away" rather than "infinitely far" — which keeps anything you drive with it finite.',
  commonUses: ['a beam to the nearest particle', 'shrinking when something gets close', 'chain-lightning targets'],
  exportSupport: 'baked',
  performance: 'moderate',
  inputs: [n('searchRadius', 'Search up to', 10, { min: 0.01, unit: 'studs' })],
  outputs: [
    { key: 'distance', label: 'Distance', type: 'field<float>', unit: 'studs' },
    { key: 'direction', label: 'Direction', type: 'field<vector3>' },
    { key: 'found', label: 'Found one', type: 'field<bool>' },
  ],
  evaluate: (api, i) => {
    const find = (ctx) => {
      if (!hasNeighbours(ctx)) return null;
      let best = Infinity, bx = 0, by = 0, bz = 0;
      ctx.neighbours(i.searchRadius, (row, d2, dx, dy, dz) => {
        if (d2 < best) { best = d2; bx = dx; by = dy; bz = dz; }
      });
      if (!Number.isFinite(best)) return null;
      const d = Math.sqrt(best);
      return { distance: d, direction: d > 1e-9 ? [bx / d, by / d, bz / d] : ZERO3 };
    };
    return {
      distance: F.makeField('float', (ctx) => find(ctx)?.distance ?? i.searchRadius),
      direction: F.makeField('vector3', (ctx) => find(ctx)?.direction ?? ZERO3),
      found: F.makeField('bool', (ctx) => !!find(ctx)),
    };
  },
});

node({
  id: 'cadence.particles.neighbourVelocity', label: 'Neighbours\' Velocity', category: PARTICLES, subcategory: 'Neighbours',
  aliases: ['average velocity nearby', 'group velocity', 'flow around me', 'match speed', 'local flow'],
  summary: 'The average velocity of the other particles within a radius.',
  explain: 'What Flock\'s alignment rule reads, exposed on its own so a look can use it: stretch a sprite along the group\'s motion, or colour by how much a particle disagrees with its neighbours.',
  commonUses: ['stretching sprites along the local flow', 'colouring stragglers differently'],
  exportSupport: 'baked',
  performance: 'moderate',
  inputs: [n('radius', 'Radius', 3, { min: 0.01, unit: 'studs' })],
  outputs: [out('out', 'Average velocity', 'field<vector3>')],
  evaluate: (api, i) => F.makeField('vector3', (ctx) => {
    if (!hasNeighbours(ctx)) return ZERO3;
    let c = 0, x = 0, y = 0, z = 0;
    ctx.neighbours(i.radius, (row, d2, dx, dy, dz, vx, vy, vz) => { c++; x += vx; y += vy; z += vz; });
    return c ? [x / c, y / c, z / c] : ZERO3;
  }),
});
