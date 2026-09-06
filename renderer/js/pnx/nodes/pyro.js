// Fire, smoke and clouds (spec Parts 31, 32 and 35): the nodes over fluid.js's grid solver and the
// cloud generator, both producing `volumeGrid` values the existing volume nodes (blur, threshold,
// combine, sample) and the Volume Renderer consume.
//
// WHY THESE ARE `volumeGrid` AND NOT A NEW `volume` TYPE: a simulated density and a baked density are
// the same thing to every consumer — a box of numbers with a world position. Giving the simulated one
// its own type would only mean that Blur Volume works on a cloud and not on smoke. The `volume` type
// stays reserved (types.js) for the day a sparse or tiled representation genuinely differs.
//
// The simulation node is stateful in exactly the way Simulate Particles is: one FluidSimulation per
// node instance (api.persistent), fed the playhead, replaying from checkpoints on a backwards scrub.

import * as V from '../values.js';
import * as F from '../fields.js';
import * as GEO from '../geometry.js';
import * as VOL from '../volume.js';
import * as FLUID from '../fluid.js';
import { node, n, i as intIn, b as boolIn, v3, col, out, mode } from './_helpers.js';

const C = 'Pyro';
const volOut = (key, label) => ({ key, label, type: 'volumeGrid' });

// A fluid state's channel as a volumeGrid that SHARES the solver's array — no copy per frame. Consumers
// clone before they mutate (every volume.js operation returns a new volume), so sharing is safe.
function channelVolume(s, name) {
  return { __volume: true, resolution: s.resolution, channels: 1, center: [...s.center], size: [...s.size], data: s[name] };
}

node({
  id: 'cadence.pyro.simulate', label: 'Simulate Smoke & Fire', category: C, subcategory: 'Simulate',
  aliases: ['fire', 'smoke', 'pyro', 'fluid', 'gas', 'flames', 'realistic fire', 'campfire', 'explosion smoke', 'steam', 'volumetric', 'burn'],
  summary: 'A real gas simulation on a grid: smoke that rolls and curls, fire that rises and burns fuel.',
  teach: 'Puts smoke (and heat, and fuel) into a box of air and lets it move like air does. Draw it with the Volume Renderer.',
  explain: 'Semi-Lagrangian advection, buoyancy from heat, vorticity confinement for the curls, and a pressure solve every frame so the gas is incompressible — smoke goes around and folds into itself instead of piling up. Fuel above the ignition temperature burns into heat and soot, which is what makes fire rise from a fuel source and trail smoke. Resolution is cubed: 32 previews in real time on a desktop, 48 is a slower preview, 64 is a bake. The source is any geometry (its points, with a radius) and/or a distance field region; Wind takes any vector field, so turbulence is Curl Noise wired in. Scrubbing backwards replays from a checkpoint, so the same frame always looks the same.',
  commonUses: ['a campfire or torch', 'smoke from an explosion', 'steam, mist, a chimney', 'a cloud that actually moves'],
  exportSupport: 'baked',
  exportNote: 'Roblox has no volumes. On export the Volume Renderer pass becomes a flipbook sprite sheet (one image per frame, 8×8), which is how Roblox fire and smoke are made by hand.',
  performance: 'expensive',
  pure: false,
  timeDependent: true,
  primary: ['shape', 'temperature', 'fuel', 'density', 'buoyancy', 'vorticity', 'resolution'],
  inputs: [
    { key: 'shape', label: 'Source shape', type: 'geometry', description: 'Any geometry: its points become the source, each with the radius below. Leave unconnected to use the region only, or a point at the box floor.' },
    n('radius', 'Source radius', 0.5, { min: 0.01, unit: 'studs' }),
    { key: 'region', label: 'Source region', type: 'field<float>', default: 1, description: 'A distance field: everywhere it is below zero emits too. Leave at 1 for none.' },
    n('density', 'Smoke per second', 4, { min: 0, description: 'How much smoke the source adds each second. 0 for a clean flame.' }),
    n('temperature', 'Source heat', 1.5, { min: 0, description: 'The temperature the source holds its cells at. Above the ignition point it lights fuel; buoyancy lifts anything hot.' }),
    n('fuel', 'Fuel per second', 0, { min: 0, description: 'Fuel added each second. Fuel that reaches the ignition temperature burns into heat and smoke — set this above zero for fire.' }),
    v3('sourceVelocity', 'Source push', [0, 2, 0], { unit: 'studs/second', description: 'The velocity the source imposes on its cells: a jet, a chimney draught, a fan.' }),
    n('buoyancy', 'Buoyancy', 2.5, { min: 0, description: 'How hard heat lifts. 0 for a gas with no temperature.' }),
    n('weight', 'Smoke weight', 0.2, { min: 0, description: 'How much dense smoke sinks.' }),
    n('vorticity', 'Curl', 0.8, { min: 0, max: 5, description: 'Vorticity confinement: puts back the small swirls the grid smears away. Too high looks noisy.' }),
    n('dissipation', 'Smoke fade', 0.15, { min: 0, unit: 'per second' }),
    n('cooling', 'Cooling', 0.5, { min: 0, unit: 'per second', description: 'How fast heat is lost. Faster cooling makes shorter flames.' }),
    { key: 'wind', label: 'Wind', type: 'field<vector3>', default: [0, 0, 0], unit: 'studs/second²', description: 'Any vector field: a constant direction for wind, Curl Noise for turbulence, both added.' },
    n('ignition', 'Ignition heat', 1, { min: 0 }),
    n('burnRate', 'Burn rate', 3, { min: 0, unit: 'per second' }),
    n('heatRelease', 'Heat from burning', 2, { min: 0 }),
    n('soot', 'Smoke from burning', 0.4, { min: 0 }),
    intIn('resolution', 'Resolution', FLUID.DEFAULT_RESOLUTION, { min: 8, max: FLUID.MAX_RESOLUTION, description: 'Cells per side of the box. The cost is this number cubed: 32 is real time, 64 is a bake.' }),
    v3('center', 'Box centre', [0, 2.5, 0], { unit: 'studs' }),
    v3('size', 'Box size', [5, 5, 5], { unit: 'studs' }),
    intIn('iterations', 'Pressure accuracy', 24, { min: 4, max: 80, description: 'Solver iterations per frame. More is more incompressible and slower.' }),
    mode('boundary', 'Box edges', ['open', 'closed'], 'open'),
    intIn('startFrame', 'Start at frame', 0, { min: 0, max: 100000 }),
  ],
  outputs: [
    volOut('density', 'Smoke'),
    volOut('temperature', 'Heat'),
    volOut('fuel', 'Fuel'),
    { key: 'velocity', label: 'Air velocity', type: 'field<vector3>', unit: 'studs/second', description: 'The gas velocity at any point — feed it to particles as a force or a velocity so embers ride the smoke.' },
    { key: 'burned', label: 'Fuel burned so far', type: 'float' },
    { key: 'stepMs', label: 'Step cost (ms)', type: 'float' },
  ],
  evaluate: (api, i) => {
    const res = Math.max(8, Math.min(FLUID.MAX_RESOLUTION, Math.round(i.resolution)));
    if (res > 40) api.note(`${res}³ is ${(res ** 3).toLocaleString()} cells; expect a slow preview and bake the effect for playback.`);
    // Source points from the geometry: every point, as world xyz triples.
    let points = null;
    if (GEO.isGeometry(i.shape) && GEO.pointCount(i.shape)) {
      const count = GEO.pointCount(i.shape);
      points = new Float32Array(count * 3);
      for (let k = 0; k < count; k++) { const p = GEO.readAttr(i.shape.points, 'position', k, [0, 0, 0]); points[k * 3] = p[0]; points[k * 3 + 1] = p[1]; points[k * 3 + 2] = p[2]; }
    }
    const region = F.isField(i.region) && !(F.isConstantField(i.region) && Number(i.region.constant) >= 0) ? i.region : null;
    if (!points && !region) {
      // Nothing to emit from: use a point at the bottom of the box, so a bare node still shows fire.
      points = new Float32Array([i.center[0], i.center[1] - i.size[1] * 0.45, i.center[2]]);
    }
    const wind = F.isField(i.wind) ? (F.isConstantField(i.wind) && V.vLength(V.toComponents('vector3', i.wind.constant)) < 1e-9 ? null : i.wind) : (V.vLength(V.toComponents('vector3', i.wind)) > 1e-9 ? V.toComponents('vector3', i.wind) : null);
    const spec = {
      sources: [{ points, radius: i.radius, sdf: region, density: i.density, temperature: i.temperature, fuel: i.fuel, velocity: V.toComponents('vector3', i.sourceVelocity) }],
      buoyancy: i.buoyancy, weight: i.weight, cooling: i.cooling, dissipation: i.dissipation, vorticity: i.vorticity,
      iterations: Math.round(i.iterations), ignition: i.ignition, burnRate: i.burnRate, heatRelease: i.heatRelease, soot: i.soot,
      wind, boundary: i.boundary,
    };
    const sim = api.persistent(() => new FLUID.FluidSimulation(spec, {
      fps: api.fps || 30, startFrame: Math.round(i.startFrame), resolution: res,
      center: V.toComponents('vector3', i.center), size: V.toComponents('vector3', i.size),
    }));
    // The box and resolution are structural: changing them means a different grid, so restart.
    if (sim.resolution !== res || sim.box.center.some((c, k) => c !== i.center[k]) || sim.box.size.some((c, k) => c !== i.size[k])) {
      sim.resolution = res; sim.box = { center: V.toComponents('vector3', i.center), size: V.toComponents('vector3', i.size) }; sim.reset();
    }
    sim.spec = spec;
    sim.fps = api.fps || 30;
    sim.startFrame = Math.round(i.startFrame);
    const state = sim.seek(api.frame);
    if (sim.lastSeek.truncated) api.warn(`Reaching frame ${api.frame} needed more steps than the limit allows; this frame is incomplete.`);
    return {
      density: channelVolume(state, 'density'),
      temperature: channelVolume(state, 'temperature'),
      fuel: channelVolume(state, 'fuel'),
      velocity: F.makeField('vector3', (ctx) => FLUID.velocityAtWorld(state, ctx.position || [0, 0, 0])),
      burned: state.stats.burned,
      stepMs: sim.lastSeek.steps ? Math.round((sim.lastSeek.ms / sim.lastSeek.steps) * 10) / 10 : 0,
    };
  },
});

// ---------------------------------------------------------------- clouds
// A cloud is shaped noise, not a simulation: coverage, softness and a drift are all a realistic cloud
// needs, and the Volume Renderer's lighting does the rest. Deliberately a generator, so it costs one
// bake per frame it drifts and nothing when it is still.
node({
  id: 'cadence.volume.cloud', label: 'Cloud', category: 'Volumes', subcategory: 'Create',
  aliases: ['clouds', 'realistic cloud', 'cumulus', 'fog bank', 'mist', 'nebula', 'volumetric cloud', 'puffy'],
  summary: 'A cloud-shaped density volume: layered noise inside a soft ellipsoid, drifting over time.',
  teach: 'Makes a fluffy cloud you can draw with the Volume Renderer. Coverage makes it thicker, drift makes it move.',
  explain: 'Fractal noise is evaluated at every voxel and masked by a soft ellipsoid, then pushed through a coverage threshold so the edges break up into lumps rather than fading evenly — the single cue that makes a volume read as cumulus. Drift offsets the noise over time, so the cloud changes shape slowly without any simulation. Resolution is cubed; 32 is plenty for a cloud that is not filling the screen.',
  commonUses: ['a cloud a character stands on', 'a fog bank rolling in', 'a nebula behind a space scene'],
  exportSupport: 'baked',
  exportNote: 'Exported as a flipbook sprite through the Volume Renderer.',
  performance: 'expensive',
  timeDependent: true,
  primary: ['radius', 'coverage', 'softness', 'drift', 'resolution'],
  inputs: [
    v3('center', 'Centre', [0, 3, 0], { unit: 'studs' }),
    v3('radius', 'Radius', [3, 1.6, 2.2], { unit: 'studs', description: 'Half-sizes of the cloud\'s ellipsoid.' }),
    n('coverage', 'Coverage', 0.55, { min: 0, max: 1, description: 'How much of the ellipsoid is filled. Low is wispy, high is a solid puff.' }),
    n('softness', 'Softness', 0.25, { min: 0.01, max: 1 }),
    n('scale', 'Detail scale', 0.9, { min: 0.05, description: 'Size of the noise lumps, in studs.' }),
    n('detail', 'Detail', 4, { min: 1, max: 8 }),
    n('density', 'Density', 1.5, { min: 0 }),
    v3('drift', 'Drift', [0.3, 0.05, 0], { unit: 'studs/second' }),
    n('seed', 'Variation', 0),
    intIn('resolution', 'Resolution', 32, { min: 8, max: VOL.MAX_RESOLUTION }),
  ],
  outputs: [volOut('out', 'Cloud')],
  evaluate: (api, i) => {
    const res = Math.max(8, Math.min(VOL.MAX_RESOLUTION, Math.round(i.resolution)));
    const rad = V.toComponents('vector3', i.radius).map((v) => Math.max(0.05, Math.abs(v)));
    const size = rad.map((v) => v * 2.2);
    const t = api.time || 0;
    const off = [i.drift[0] * t, i.drift[1] * t, i.drift[2] * t];
    const seed = Math.round(Number(i.seed) || 0);
    const cov = Math.max(0, Math.min(1, i.coverage)), soft = Math.max(0.01, i.softness);
    const field = F.makeField('float', (ctx) => {
      const p = ctx.position || [0, 0, 0];
      const dx = (p[0] - i.center[0]) / rad[0], dy = (p[1] - i.center[1]) / rad[1], dz = (p[2] - i.center[2]) / rad[2];
      const shape = 1 - Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (shape <= -0.2) return 0;
      const nz = fbm3((p[0] + off[0]) / i.scale, (p[1] + off[1]) / i.scale, (p[2] + off[2]) / i.scale, Math.round(i.detail), seed);
      const v = nz * 0.7 + 0.3 * Math.max(0, shape) + (shape - 0.5) * 0.6;
      const edge = 1 - cov;
      const s = (v - edge + soft * 0.5) / soft;
      return Math.max(0, Math.min(1, s)) * i.density * Math.max(0, Math.min(1, shape + 0.35));
    });
    return VOL.rasterizeVolume(field, res, { center: V.toComponents('vector3', i.center), size, time: t });
  },
});

// A small deterministic value-noise FBM for the cloud: the noise nodes are fields over a sample point,
// which is what the generator above also is, but calling the registry from inside a node would couple
// this file to those definitions. This is the same value-noise basis noisecore.js uses, kept local.
function hash3(x, y, z, seed) {
  let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647 >>> 5) ^ Math.imul(seed | 0, 1274126177)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise3(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c00 = l(hash3(xi, yi, zi, seed), hash3(xi + 1, yi, zi, seed), sx);
  const c10 = l(hash3(xi, yi + 1, zi, seed), hash3(xi + 1, yi + 1, zi, seed), sx);
  const c01 = l(hash3(xi, yi, zi + 1, seed), hash3(xi + 1, yi, zi + 1, seed), sx);
  const c11 = l(hash3(xi, yi + 1, zi + 1, seed), hash3(xi + 1, yi + 1, zi + 1, seed), sx);
  return l(l(c00, c10, sy), l(c01, c11, sy), sz);
}
function fbm3(x, y, z, octaves, seed) {
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let o = 0; o < Math.max(1, Math.min(8, octaves)); o++) {
    sum += a * vnoise3(x * f, y * f, z * f, seed + o * 17);
    norm += a; a *= 0.5; f *= 2.05;
  }
  return sum / norm;
}
