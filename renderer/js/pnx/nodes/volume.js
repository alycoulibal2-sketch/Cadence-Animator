// Volume grid nodes (spec Part 33, honestly scoped).
//
// These speak `volumeGrid`, NOT the `volume` type. That separation is the point: `volume` stays declared
// but `implemented: false` in types.js, so the registry mechanically refuses any node that would need the
// absent fluid solver or the absent volume renderer — a Pyro or Volume Renderer button cannot be created
// by accident. `volumeGrid` is the thing that IS built, and what it is good for is stated plainly on each
// node rather than implied.
//
// WHAT A VOLUME GRID IS FOR, given no solver and no raymarcher:
//
//   1. A CACHE. Rasterise an expensive field into a grid once, then sample it per particle for eight
//      array reads instead of six FBM evaluations. This is a real and large win, and it is the reason
//      these nodes exist rather than waiting for the solver.
//   2. THREE-DIMENSIONAL BLUR. The only way to blur in 3D, for exactly the reason a texture is the only
//      way to blur in 2D: "neighbour" has no meaning in a continuous field.
//   3. SPAWN REGIONS AND MASKS. A density grid read as a field drives where particles are born, how
//      bright they are, or where they die.
//
// What these nodes will NOT do is advect, project, ignite or draw. See volume.js's UNIMPLEMENTED table,
// which the Volume Capabilities node below reads out loud rather than leaving a user to discover.

import * as V from '../values.js';
import * as F from '../fields.js';
import * as VOL from '../volume.js';
import { node, n, i as intIn, v3, out, mode } from './_helpers.js';

const C = 'Volumes';

const volIn = (key = 'volume', label = 'Volume') => ({ key, label, type: 'volumeGrid' });
const volOut = (label = 'Volume') => ({ key: 'out', label, type: 'volumeGrid' });

node({
  id: 'cadence.volume.rasterize', label: 'Bake To Volume', category: C, subcategory: 'Create',
  aliases: ['field to volume', 'cache field', 'voxelize', '3d bake', 'freeze field', 'density grid'],
  summary: 'Evaluates a field once into a 3D grid, so it can be sampled cheaply many times.',
  teach: 'Works out a complicated value at every point in a box, once, and remembers the answers.',
  explain: 'This is the reason volumes exist in this engine today. A noise chain that costs six evaluations per sample becomes eight array reads and some arithmetic once it is baked — so an expensive field sampled by ten thousand particles becomes affordable. Resolution is cubed, so 32 is 32 768 voxels and 64 is 262 144: raise it only as far as the detail you can actually see.',
  commonUses: ['caching an expensive noise chain that many particles read', 'building a density field to spawn inside'],
  exportSupport: 'baked',
  exportNote: 'A volume has no Roblox equivalent. Whatever reads it is baked instead.',
  performance: 'expensive',
  timeDependent: true,
  inputs: [
    { key: 'field', label: 'Field', type: 'field<float>', default: 0 },
    intIn('resolution', 'Resolution', VOL.DEFAULT_RESOLUTION, { min: 2, max: VOL.MAX_RESOLUTION,
      description: 'Voxels per side. The cost is this number cubed.' }),
    v3('center', 'Centre', [0, 0, 0], { unit: 'studs' }),
    v3('size', 'Size', [4, 4, 4], { unit: 'studs', description: 'The box the grid covers. Too large and the volume is mostly empty; check the occupancy in Volume Info.' }),
  ],
  outputs: [volOut()],
  evaluate: (api, i) => {
    const res = Math.max(2, Math.min(VOL.MAX_RESOLUTION, Math.round(i.resolution)));
    const voxels = res ** 3;
    if (voxels > 200000) {
      api.note(`${res}x${res}x${res} is ${voxels.toLocaleString()} voxels and will be slow to re-bake on every change. Build at a low resolution and raise it once.`);
    }
    return VOL.rasterizeVolume(i.field, res, { center: i.center, size: i.size, time: api.time });
  },
});

node({
  id: 'cadence.volume.sample', label: 'Sample Volume', category: C, subcategory: 'Read',
  aliases: ['read volume', 'volume to field', 'density at', 'lookup volume'],
  summary: 'Reads a volume as a value that varies through space.',
  explain: 'Trilinear interpolation between the eight surrounding voxels, so the result is smooth rather than blocky. Outside the volume\'s box the edge value is held rather than wrapping — a density field has a boundary, and wrapping would make smoke re-enter on the far side.',
  commonUses: ['driving particle colour from a baked density', 'using a volume as a spawn mask'],
  exportSupport: 'baked',
  inputs: [volIn()],
  outputs: [{ key: 'out', label: 'Value', type: 'field<float>' }],
  evaluate: (api, i) => {
    if (!VOL.isVolume(i.volume)) return F.constantField('float', 0);
    return VOL.volumeAsField(i.volume);
  },
});

node({
  id: 'cadence.volume.info', label: 'Volume Info', category: C, subcategory: 'Read',
  aliases: ['volume statistics', 'occupancy', 'how big', 'voxel count', 'memory'],
  summary: 'The size, value range, occupancy and memory cost of a volume.',
  explain: 'Occupancy is the fraction of voxels holding anything, and it is the number to look at when a volume-driven effect looks sparse: a low occupancy means the box is far bigger than the content, so most of the memory and most of the bake time went on empty space.',
  exportSupport: 'native',
  inputs: [volIn()],
  outputs: [
    { key: 'resolution', label: 'Resolution', type: 'int' },
    { key: 'voxels', label: 'Voxels', type: 'int' },
    { key: 'min', label: 'Lowest', type: 'float' },
    { key: 'max', label: 'Highest', type: 'float' },
    { key: 'average', label: 'Average', type: 'float' },
    { key: 'occupancy', label: 'Occupancy (0-1)', type: 'float' },
    { key: 'megabytes', label: 'Memory (MB)', type: 'float' },
  ],
  evaluate: (api, i) => {
    const d = VOL.describeVolume(i.volume);
    if (d.empty) return { resolution: 0, voxels: 0, min: 0, max: 0, average: 0, occupancy: 0, megabytes: 0 };
    if (d.occupancy < 0.02 && d.voxels > 1000) {
      api.note(`Only ${(d.occupancy * 100).toFixed(1)}% of this volume holds anything — the box is much larger than the content, so most of the bake was spent on empty space.`);
    }
    return {
      resolution: d.resolution, voxels: d.voxels,
      min: d.range.min, max: d.range.max, average: d.average,
      occupancy: d.occupancy, megabytes: d.megabytes,
    };
  },
});

node({
  id: 'cadence.volume.blur', label: 'Blur Volume', category: C, subcategory: 'Process',
  aliases: ['smooth volume', 'soften 3d', 'diffuse', 'spread density'],
  summary: 'Softens a volume in three dimensions.',
  explain: 'The only way to blur in 3D, and the reason a volume is a distinct type rather than a field: blurring needs neighbouring values, and "neighbour" has no meaning in a continuous field. Separable, so a radius of 4 is 27 taps per voxel rather than 257.',
  commonUses: ['turning hard noise into cloud-like density', 'softening a voxelised shape'],
  exportSupport: 'baked',
  performance: 'expensive',
  inputs: [volIn(), n('radius', 'Radius', 2, { min: 0, max: 16, unit: 'voxels' }), intIn('passes', 'Passes', 2, { min: 1, max: 4 })],
  outputs: [volOut()],
  evaluate: (api, i) => (VOL.isVolume(i.volume) ? VOL.blurVolume(i.volume, i.radius, i.passes) : null),
});

node({
  id: 'cadence.volume.combine', label: 'Combine Volumes', category: C, subcategory: 'Process',
  aliases: ['add volumes', 'multiply volumes', 'mask volume', 'blend 3d', 'max volume'],
  summary: 'Combines two volumes.',
  explain: 'Where the two grids differ in resolution or position, the second is sampled at the first\'s voxels rather than either being resampled — so combining a fine detail volume into a coarse base does not silently upscale the base.',
  exportSupport: 'baked',
  performance: 'moderate',
  inputs: [
    volIn('a', 'Base'),
    volIn('b', 'Layer'),
    mode('operation', 'Operation', ['add', 'subtract', 'multiply', 'min', 'max', 'mix'], 'add'),
    n('amount', 'Amount', 1, { min: 0, max: 1 }),
  ],
  outputs: [volOut()],
  evaluate: (api, i) => {
    if (!VOL.isVolume(i.a) && !VOL.isVolume(i.b)) return null;
    const k = V.clamp01(i.amount);
    const ops = {
      add: (a, b) => a + b * k,
      subtract: (a, b) => a - b * k,
      multiply: (a, b) => a * (1 - k + b * k),
      min: (a, b) => Math.min(a, b),
      max: (a, b) => Math.max(a, b),
      mix: (a, b) => a + (b - a) * k,
    };
    return VOL.zipVolumes(i.a, i.b, ops[i.operation] || ops.add);
  },
});

node({
  id: 'cadence.volume.threshold', label: 'Threshold Volume', category: C, subcategory: 'Process',
  aliases: ['cutoff volume', 'clip density', 'isosurface', 'solidify'],
  summary: 'Turns a volume into hard or soft regions above a value.',
  explain: 'Softness above zero feathers the boundary rather than leaving a blocky one, which matters because a hard threshold on a low-resolution grid reads as cubes.',
  exportSupport: 'baked',
  performance: 'moderate',
  inputs: [volIn(), n('threshold', 'Threshold', 0.5), n('softness', 'Softness', 0.1, { min: 0, max: 1 })],
  outputs: [volOut()],
  evaluate: (api, i) => {
    if (!VOL.isVolume(i.volume)) return null;
    const s = Math.max(1e-6, i.softness);
    return VOL.mapVolume(i.volume, (v) => {
      const t = V.clamp01((v - i.threshold + s * 0.5) / s);
      return t * t * (3 - 2 * t);
    });
  },
});

node({
  id: 'cadence.volume.transform', label: 'Move Volume', category: C, subcategory: 'Process',
  aliases: ['position volume', 'resize volume', 'place volume'],
  summary: 'Moves or resizes the box a volume occupies, without touching its contents.',
  explain: 'Cheap, because it changes only the box: resampling the data into a new grid would blur it for no reason. This is how a baked volume follows something around.',
  exportSupport: 'baked',
  performance: 'cheap',
  inputs: [volIn(), v3('center', 'Centre', [0, 0, 0], { unit: 'studs' }), v3('size', 'Size', [4, 4, 4], { unit: 'studs' })],
  outputs: [volOut()],
  evaluate: (api, i) => (VOL.isVolume(i.volume) ? VOL.transformVolume(i.volume, { center: i.center, size: i.size }) : null),
});

// ---------------------------------------------------------------- the honest statement
node({
  id: 'cadence.volume.capabilities', label: 'Volume Capabilities', category: C, subcategory: 'Read',
  aliases: ['what is missing', 'fluid solver', 'pyro', 'smoke simulation', 'volume rendering', 'why no fire'],
  summary: 'Says which volume features exist and which do not, and why.',
  teach: 'A plain answer to "can this engine simulate smoke or fire in a volume". It cannot yet, and this says what is missing.',
  explain: 'Reads out the engine\'s own record of what is unimplemented rather than a comment somebody has to keep up to date. Volume grids work as a cache, a 3D blur and a spawn region. Fluid advection, pressure solving, combustion and raymarched rendering are not built — each for a stated reason, with what it would take. Existing as a node rather than only as documentation means the answer is available from inside the graph, including to an MCP caller.',
  commonUses: ['finding out why there is no Pyro node', 'checking what a volume can currently be used for'],
  exportSupport: 'native',
  exportNote: 'A diagnostic. It produces no visual output and is not exported.',
  inputs: [],
  outputs: [
    { key: 'built', label: 'What works', type: 'string' },
    { key: 'missing', label: 'What does not', type: 'string' },
    { key: 'hasFluidSolver', label: 'Fluid solver', type: 'bool' },
    { key: 'hasVolumeRendering', label: 'Volume rendering', type: 'bool' },
  ],
  evaluate: (api) => {
    const missing = Object.values(VOL.UNIMPLEMENTED)
      .map((u) => `${u.what} — ${u.why} Needs: ${u.needs}`)
      .join(' | ');
    api.note('Volume grids work as a cache, a 3D blur and a spawn region. There is no fluid solver and no volume rendering; see this node\'s outputs for why.');
    return {
      built: 'Bake a field to a grid, sample it, blur it in 3D, combine, threshold and move it. Read it as a field to drive particles, colour or spawn regions.',
      missing,
      hasFluidSolver: false,
      hasVolumeRendering: false,
    };
  },
});
