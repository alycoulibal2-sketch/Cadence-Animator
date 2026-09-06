// Mesh and curve editing nodes (spec Parts 22, 24, 25), over mesh.js. These are the operations that
// nodes/geometry.js's header said were absent until a connectivity layer existed; mesh.js is that
// layer, derived per operation from the corner table rather than stored on the geometry.
//
// Selection inputs are `field<bool>` evaluated on the FACE domain (extrude, inset, delete faces) or the
// point domain (separate), so "the top faces" is `normal.y > 0.5` and "the left half" is
// `position.x < 0` — the same fields that drive everything else, not a separate selection type.

import * as V from '../values.js';
import * as F from '../fields.js';
import * as GEO from '../geometry.js';
import * as MESH from '../mesh.js';
import * as VOL from '../volume.js';
import { node, n, i as intIn, b as boolIn, v3, out, mode } from './_helpers.js';

const C = 'Mesh';
const CU = 'Curves';
const GEOC = 'Geometry';

const geoIn = (key = 'geometry', label = 'Geometry') => ({ key, label, type: 'geometry' });
const geoOut = (label = 'Geometry', key = 'out') => ({ key, label, type: 'geometry' });
const curveIn = (label = 'Curve') => ({ key: 'curve', label, type: 'geometry' });
const sel = (label = 'Selection', dflt = true, description = 'Which elements the operation applies to. Unconnected means all of them.') => ({ key: 'selection', label, type: 'field<bool>', default: dflt, description });

function faceSampler(g, field) {
  const walker = GEO.makeElementContext(g, 'face');
  const tri = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  return (f) => {
    const ctx = walker.at(f);
    // a face sample context carries the face's centre and normal, which is what selections ask about
    GEO.triangleCorners(g, f, tri);
    ctx.position = [(tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3, (tri[0][2] + tri[1][2] + tri[2][2]) / 3];
    ctx.normal = GEO.faceNormal(tri[0], tri[1], tri[2]);
    return F.sampleAny(field, ctx);
  };
}

function pointSampler(g, field) {
  const walker = GEO.makeElementContext(g, 'point');
  return (i) => F.sampleAny(field, walker.at(i));
}

const attrField = (name, type = 'float') => F.makeField(type, (ctx) => {
  const v = F.attr(ctx, name, 0);
  return type === 'bool' ? (Array.isArray(v) ? v[0] : v) > 0.5 : (Array.isArray(v) ? v[0] : v);
});

// ---------------------------------------------------------------- clean-up and orientation
node({
  id: 'cadence.mesh.weld', label: 'Merge By Distance', category: C, subcategory: 'Clean up',
  aliases: ['weld', 'remove doubles', 'merge vertices', 'merge points', 'close seams', 'fuse'],
  summary: 'Merges points that sit within a distance of each other.',
  explain: 'Primitives built from rings have a seam of duplicated points where the ring closes, and Join Geometry leaves every input\'s points separate. Welding is what turns a joined pile of parts into one connected mesh — which Subdivide, Smooth and Mesh To SDF all need. Curves are left alone: their points are consecutive rows, and merging across them would break the curves.',
  commonUses: ['before subdividing a joined mesh', 'closing the seam on a swept tube', 'fixing lighting seams'],
  exportSupport: 'converted', performance: 'moderate',
  inputs: [geoIn(), n('distance', 'Distance', 0.001, { min: 0, unit: 'studs' })],
  outputs: [geoOut(), { key: 'merged', label: 'Merged', type: 'int' }],
  evaluate: (api, i) => {
    if (!GEO.isGeometry(i.geometry)) return { out: GEO.newGeometry(), merged: 0 };
    if (i.geometry.curves) api.note('This geometry has curves; their points were not merged.');
    const r = MESH.weld(i.geometry, Math.max(1e-6, i.distance));
    return { out: r.geometry, merged: r.merged };
  },
});

node({
  id: 'cadence.mesh.flip', label: 'Flip Faces', category: C, subcategory: 'Clean up',
  aliases: ['reverse normals', 'inside out', 'flip normals', 'invert faces', 'turn inside out'],
  summary: 'Turns every face inside out.',
  explain: 'A mesh lit as though hollow, or invisible from outside, has its faces wound the wrong way. Flipping swaps the winding and negates the stored normals, which is the fix — not a doubled-sided material, which hides the problem and costs twice the draw.',
  exportSupport: 'converted',
  inputs: [geoIn()],
  outputs: [geoOut()],
  evaluate: (api, i) => (GEO.isGeometry(i.geometry) ? MESH.flipFaces(i.geometry) : GEO.newGeometry()),
});

// ---------------------------------------------------------------- extrude, inset
node({
  id: 'cadence.mesh.extrude', label: 'Extrude Faces', category: C, subcategory: 'Edit',
  aliases: ['extrude', 'push out faces', 'thicken', 'pull faces', 'grow faces', 'raise'],
  summary: 'Pushes the selected faces out along their normals, walling the rim.',
  teach: 'Choose faces (or leave the selection alone for all of them) and how far to push. Region moves the patch as one piece; Individual pushes every face on its own.',
  explain: 'The output carries two face attributes, "top" and "side", so the moved faces and the new walls can be told apart downstream — read them with Read Attribute, or use the Top / Side outputs here directly as selections for the next Extrude. Offset is a field evaluated per face, so a noise-driven offset makes a spiky or crystalline growth in one node.',
  commonUses: ['a crystal cluster from an icosphere', 'a spiked shell', 'a stepped, layered platform'],
  exportSupport: 'converted', performance: 'moderate',
  inputs: [
    geoIn(), sel(),
    { key: 'offset', label: 'Offset', type: 'field<float>', default: 0.5, unit: 'studs' },
    mode('mode', 'Mode', ['region', 'individual'], 'region'),
  ],
  outputs: [geoOut(), { key: 'top', label: 'Top', type: 'field<bool>' }, { key: 'side', label: 'Side', type: 'field<bool>' }],
  evaluate: (api, i) => {
    const g = i.geometry;
    const top = attrField('top', 'bool'), side = attrField('side', 'bool');
    if (!GEO.isGeometry(g) || !GEO.faceCount(g)) { if (GEO.isGeometry(g) && GEO.pointCount(g)) api.warn('Extrude Faces needs faces — this geometry has points only.'); return { out: GEO.newGeometry(), top, side }; }
    const selAt = faceSampler(g, i.selection), offAt = faceSampler(g, i.offset);
    const r = MESH.extrudeFaces(g, (f) => !!selAt(f), (f) => Number(offAt(f)) || 0, { individual: i.mode === 'individual' });
    if (!r.extruded) api.note('No faces were selected, so nothing was extruded.');
    return { out: r.geometry, top, side };
  },
});

node({
  id: 'cadence.mesh.inset', label: 'Inset Faces', category: C, subcategory: 'Edit',
  aliases: ['inset', 'shrink faces', 'panel', 'bevel face', 'frame faces', 'window'],
  summary: 'Shrinks each selected face towards its centre and walls the gap.',
  explain: 'The classic panelling operation: inset then extrude the "top" faces inward and every face becomes a recessed panel. Amount is a fraction of the way to the centre (0 nothing, 1 a point); Depth pushes the shrunk face along its normal at the same time. Each face is inset on its own, which is the form that stays valid on triangles.',
  commonUses: ['sci-fi panelling', 'a honeycomb from a subdivided icosphere', 'window frames'],
  exportSupport: 'converted', performance: 'moderate',
  inputs: [
    geoIn(), sel(),
    { key: 'amount', label: 'Amount', type: 'field<float>', default: 0.25, min: 0, max: 1 },
    { key: 'depth', label: 'Depth', type: 'field<float>', default: 0, unit: 'studs' },
  ],
  outputs: [geoOut(), { key: 'top', label: 'Top', type: 'field<bool>' }, { key: 'side', label: 'Side', type: 'field<bool>' }],
  evaluate: (api, i) => {
    const g = i.geometry;
    const top = attrField('top', 'bool'), side = attrField('side', 'bool');
    if (!GEO.isGeometry(g) || !GEO.faceCount(g)) return { out: GEO.newGeometry(), top, side };
    const selAt = faceSampler(g, i.selection), amtAt = faceSampler(g, i.amount), depAt = faceSampler(g, i.depth);
    const r = MESH.insetFaces(g, (f) => !!selAt(f), (f) => Number(amtAt(f)) || 0, (f) => Number(depAt(f)) || 0);
    return { out: r.geometry, top, side };
  },
});

// ---------------------------------------------------------------- subdivide, smooth
node({
  id: 'cadence.mesh.subdivide', label: 'Subdivide Mesh', category: C, subcategory: 'Edit',
  aliases: ['subdivision surface', 'smooth subdivide', 'more polygons', 'refine', 'loop subdivision', 'tessellate'],
  summary: 'Splits every triangle into four, optionally smoothing the shape as it goes.',
  explain: 'Plain subdivision adds detail without changing the shape — what you want before displacing a surface with noise. Smooth subdivision (Loop\'s scheme) rounds the mesh towards its limit surface as well, turning a box into a rounded blob in two or three levels, which is how organic shapes are made from simple ones. Each level quadruples the triangle count, so the levels are capped at 5.',
  commonUses: ['a rounded blob from a box', 'enough points to displace a plane into terrain', 'smoothing a marching-tetrahedra surface'],
  exportSupport: 'converted', performance: 'expensive',
  inputs: [geoIn(), intIn('levels', 'Levels', 1, { min: 0, max: 5 }), boolIn('smooth', 'Smooth', true)],
  outputs: [geoOut()],
  evaluate: (api, i) => {
    const g = i.geometry;
    if (!GEO.isGeometry(g)) return GEO.newGeometry();
    const fc = GEO.faceCount(g);
    const L = Math.max(0, Math.min(5, Math.round(i.levels)));
    if (fc * Math.pow(4, L) > 2_000_000) { api.warn(`${L} levels on ${fc} faces would make ${fc * Math.pow(4, L)} triangles — too many. Lower the levels.`); return g; }
    return MESH.subdivideMesh(g, L, !!i.smooth);
  },
});

node({
  id: 'cadence.mesh.smooth', label: 'Smooth Mesh', category: C, subcategory: 'Edit',
  aliases: ['relax', 'laplacian smooth', 'soften mesh', 'melt', 'even out'],
  summary: 'Relaxes every point towards the average of its neighbours.',
  explain: 'Repeated smoothing shrinks a closed mesh a little each pass (the well-known Laplacian shrink), which is fine for softening noise or the facets of a marched surface and wrong for preserving volume — keep the iterations low, or subdivide smooth instead.',
  exportSupport: 'converted', performance: 'moderate',
  inputs: [geoIn(), intIn('iterations', 'Iterations', 3, { min: 0, max: 100 }), n('factor', 'Strength', 0.5, { min: 0, max: 1 })],
  outputs: [geoOut()],
  evaluate: (api, i) => (GEO.isGeometry(i.geometry) ? MESH.smoothMesh(i.geometry, Math.round(i.iterations), i.factor) : GEO.newGeometry()),
});

// ---------------------------------------------------------------- topology: islands, separate, delete, duplicate
node({
  id: 'cadence.mesh.islands', label: 'Mesh Islands', category: C, subcategory: 'Topology',
  aliases: ['connected pieces', 'separate parts', 'components', 'loose parts', 'shards', 'fragments'],
  summary: 'Numbers the disconnected pieces of a geometry.',
  explain: 'Every point gets an "island" attribute: 0 for the first connected piece, 1 for the next, and so on. That number is what makes a fracture effect possible — offset each island by a random direction keyed on its index and the pieces fly apart as pieces rather than as a spray of points.',
  commonUses: ['flying apart a shattered mesh piece by piece', 'colouring shards individually', 'counting how many parts a join produced'],
  exportSupport: 'converted', performance: 'moderate',
  inputs: [geoIn()],
  outputs: [geoOut(), { key: 'island', label: 'Island index', type: 'field<int>' }, { key: 'count', label: 'Island count', type: 'int' }],
  evaluate: (api, i) => {
    const g = i.geometry;
    const island = attrField('island', 'int');
    if (!GEO.isGeometry(g)) return { out: GEO.newGeometry(), island, count: 0 };
    const r = MESH.islands(g);
    const o = GEO.cloneGeometry(g);
    const col = GEO.ensureAttr(o.points, 'island', 1);
    col.data.set(r.ids);
    return { out: o, island, count: r.count };
  },
});

node({
  id: 'cadence.mesh.separate', label: 'Separate Geometry', category: C, subcategory: 'Topology',
  aliases: ['split geometry', 'select part', 'keep half', 'cut in two', 'filter geometry', 'mask geometry'],
  summary: 'Splits a geometry in two by a per-point selection, keeping faces and curves intact where they can be.',
  explain: 'Unlike Delete Points, this keeps the faces whose corners all fall on one side, so cutting a mesh in half by position gives two half-meshes rather than two point clouds. A face straddling the cut belongs to neither side.',
  commonUses: ['a mesh dissolving from one end', 'keeping only the top of a shape', 'the two halves of a split'],
  exportSupport: 'converted', performance: 'moderate',
  inputs: [geoIn(), sel('Selection', true, 'Points to keep on the Selected side.')],
  outputs: [geoOut('Selected', 'selected'), geoOut('Inverted', 'inverted')],
  evaluate: (api, i) => {
    const g = i.geometry;
    if (!GEO.isGeometry(g)) return { selected: GEO.newGeometry(), inverted: GEO.newGeometry() };
    const at = pointSampler(g, i.selection);
    return MESH.separateByPoints(g, (k) => !!at(k));
  },
});

node({
  id: 'cadence.mesh.deleteFaces', label: 'Delete Faces', category: C, subcategory: 'Topology',
  aliases: ['remove faces', 'cut holes', 'open up', 'punch holes', 'delete polygons'],
  summary: 'Removes the faces a selection rejects; the points stay.',
  explain: 'The complement of Delete Points: holes in a surface rather than a thinned cloud. Removing faces by a noise threshold is the quickest dissolve there is.',
  exportSupport: 'converted', performance: 'moderate',
  inputs: [geoIn(), { key: 'keep', label: 'Keep where', type: 'field<bool>', default: true }],
  outputs: [geoOut()],
  evaluate: (api, i) => {
    const g = i.geometry;
    if (!GEO.isGeometry(g) || !GEO.faceCount(g)) return GEO.isGeometry(g) ? g : GEO.newGeometry();
    const at = faceSampler(g, i.keep);
    return MESH.deleteFaces(g, (f) => !!at(f));
  },
});

node({
  id: 'cadence.mesh.duplicate', label: 'Duplicate Elements', category: C, subcategory: 'Topology',
  aliases: ['copies', 'repeat geometry', 'clone', 'multiply geometry', 'stack copies'],
  summary: 'Makes N copies of a geometry, each tagged with its copy number.',
  explain: 'Every copy\'s points carry a "copy" attribute, so a Set Position driven by copy × offset spreads them into a row, a ring or a spiral — the geometry version of instancing, for when the copies need to be edited as real meshes afterwards. For many copies of an unchanging mesh, Instance On Points is far cheaper.',
  commonUses: ['a stack of rings', 'concentric shells', 'a staircase'],
  exportSupport: 'converted', performance: 'moderate',
  inputs: [geoIn(), intIn('count', 'Copies', 3, { min: 1, max: 512 })],
  outputs: [geoOut(), { key: 'copy', label: 'Copy index', type: 'field<int>' }],
  evaluate: (api, i) => {
    const g = i.geometry;
    const copy = attrField('copy', 'int');
    if (!GEO.isGeometry(g)) return { out: GEO.newGeometry(), copy };
    const count = Math.max(1, Math.min(512, Math.round(i.count)));
    if (GEO.pointCount(g) * count > 2_000_000) { api.warn('Too many points for that many copies; lower the count.'); return { out: g, copy }; }
    return { out: MESH.duplicate(g, count), copy };
  },
});

// ---------------------------------------------------------------- surfaces from fields, fields from surfaces
const boxInputs = () => [
  v3('center', 'Centre', [0, 0, 0], { unit: 'studs' }),
  v3('size', 'Size', [4, 4, 4], { unit: 'studs' }),
  intIn('resolution', 'Resolution', 32, { min: 4, max: 128, description: 'Cells per side. Detail and cost both go up with the cube of this.' }),
];

node({
  id: 'cadence.mesh.fromSdf', label: 'SDF To Mesh', category: C, subcategory: 'Convert',
  aliases: ['marching cubes', 'surface from distance', 'mesh from sdf', 'isosurface', 'polygonise', 'shape to mesh', 'metaballs'],
  summary: 'Builds a mesh where a distance field crosses zero.',
  teach: 'Turn any SDF shape — including smooth unions of several — into a real mesh you can render, extrude and export.',
  explain: 'Samples the field on a grid inside the box and runs marching tetrahedra on it, so any shape you can describe as a distance (every SDF node, any maths on them) becomes a mesh. Metaballs are a smooth union of spheres fed to this node. The mesh is faceted at the grid resolution; Subdivide (smooth) or Smooth Mesh softens it. Anything outside the box is cut off.',
  commonUses: ['metaballs', 'a mesh of a smooth-unioned blob', 'exporting an SDF shape to Roblox'],
  exportSupport: 'converted', performance: 'expensive',
  inputs: [
    { key: 'distance', label: 'Distance', type: 'field<float>', default: 1, unit: 'studs' },
    ...boxInputs(),
    n('iso', 'Surface at', 0, { unit: 'studs', description: 'The distance treated as the surface. Positive values inflate the shape.' }),
  ],
  outputs: [geoOut()],
  evaluate: (api, i) => {
    const ctx = F.newSampleContext({});
    const c = V.toComponents('vector3', i.center), s = V.toComponents('vector3', i.size);
    const sample = (x, y, z) => { ctx.position = [x, y, z]; const v = F.sampleAny(i.distance, ctx); return Number(Array.isArray(v) ? v[0] : v) || 0; };
    const g = MESH.marchingTetrahedra(sample, { center: c, size: s, resolution: Math.round(i.resolution), iso: i.iso });
    if (!GEO.faceCount(g)) api.note('The distance field never crossed the surface value inside the box — nothing was built. Move the box or check the field.');
    return g;
  },
});

node({
  id: 'cadence.mesh.fromVolume', label: 'Volume To Mesh', category: C, subcategory: 'Convert',
  aliases: ['mesh from volume', 'surface from density', 'smoke to mesh', 'cloud to mesh', 'threshold to mesh'],
  summary: 'Builds a mesh around everywhere a volume is denser than a threshold.',
  explain: 'The volume\'s own grid is sampled with trilinear interpolation and marched, so a cloud or a frame of smoke becomes a lumpy solid — the basis of a low-poly cloud, or a fluid frozen as a shape.',
  commonUses: ['a low-poly cloud from the Cloud node', 'freezing a frame of smoke as a mesh'],
  exportSupport: 'converted', performance: 'expensive',
  inputs: [
    { key: 'volume', label: 'Volume', type: 'volumeGrid' },
    n('threshold', 'Threshold', 0.5, { min: 0 }),
    intIn('resolution', 'Resolution', 0, { min: 0, max: 128, description: '0 uses the volume\'s own resolution.' }),
  ],
  outputs: [geoOut()],
  evaluate: (api, i) => {
    const vol = i.volume;
    if (!VOL.isVolume(vol)) { api.warn('Connect a volume.'); return GEO.newGeometry(); }
    const res = Math.round(i.resolution) > 0 ? Math.round(i.resolution) : vol.resolution;
    const thr = Math.max(0, i.threshold);
    return MESH.marchingTetrahedra((x, y, z) => thr - VOL.sampleVolume(vol, [x, y, z]), { center: vol.center, size: vol.size, resolution: res, iso: 0 });
  },
});

node({
  id: 'cadence.mesh.toSdf', label: 'Mesh To SDF', category: C, subcategory: 'Convert',
  aliases: ['distance to mesh', 'mesh distance field', 'collide with mesh', 'inside mesh', 'signed distance from mesh', 'proximity'],
  summary: 'The signed distance from any point to a mesh: negative inside, positive outside.',
  teach: 'Makes any mesh usable everywhere an SDF is — as a collider, a spawn region, a mask, or in booleans.',
  explain: 'Finds the nearest triangle through a grid of bins, so each sample costs a few triangle tests rather than all of them. The sign comes from angle-weighted pseudonormals, which is what makes it correct at edges and corners where a plain face normal is not. A mesh with holes has no inside; the node says so and the sign is then unreliable near the holes.',
  commonUses: ['particles colliding with an imported shape', 'spawning inside a mesh', 'a mesh boolean'],
  exportSupport: 'baked', performance: 'expensive',
  inputs: [geoIn(), n('cellSize', 'Bin size', 0, { min: 0, unit: 'studs', description: '0 picks one from the mesh size.' })],
  outputs: [{ key: 'out', label: 'Distance', type: 'field<float>', unit: 'studs' }, { key: 'closed', label: 'Watertight', type: 'bool' }],
  evaluate: (api, i) => {
    const g = i.geometry;
    if (!GEO.isGeometry(g) || !GEO.faceCount(g)) { api.warn('Mesh To SDF needs a mesh with faces.'); return { out: F.constantField('float', 1e6), closed: false }; }
    const md = MESH.meshDistance(g, { cellSize: i.cellSize > 0 ? i.cellSize : null });
    if (!md.closed) api.note('This mesh is not watertight, so "inside" is only reliable away from its open edges.');
    return { out: F.makeField('float', (ctx) => md.distance(ctx.position || [0, 0, 0])), closed: md.closed };
  },
});

node({
  id: 'cadence.mesh.boolean', label: 'Mesh Boolean', category: C, subcategory: 'Convert',
  aliases: ['boolean', 'union meshes', 'subtract mesh', 'cut mesh', 'intersect meshes', 'carve', 'csg'],
  summary: 'Union, difference or intersection of two meshes, through their distance fields.',
  explain: 'Both meshes become signed distance fields, the fields are combined (exactly, or with a smooth blend), and the result is marched back to a mesh. That route never produces the cracked, non-manifold output that an edge-splitting boolean does on messy input, at the cost of resampling: the result is only as sharp as the resolution. Both meshes should be watertight; an open mesh has no inside to subtract.',
  commonUses: ['carving a hole through a shape', 'merging overlapping parts into one skin', 'a rounded-off join between two meshes'],
  exportSupport: 'converted', performance: 'expensive',
  inputs: [
    { key: 'a', label: 'A', type: 'geometry' }, { key: 'b', label: 'B', type: 'geometry' },
    mode('operation', 'Operation', ['union', 'difference', 'intersection'], 'difference'),
    n('smoothness', 'Smoothness', 0, { min: 0, unit: 'studs', description: 'Rounds the join by blending the two distances.' }),
    intIn('resolution', 'Resolution', 48, { min: 8, max: 128 }),
  ],
  outputs: [geoOut()],
  evaluate: (api, i) => {
    if (!GEO.isGeometry(i.a) || !GEO.faceCount(i.a)) { api.warn('Connect a mesh to A.'); return GEO.newGeometry(); }
    if (!GEO.isGeometry(i.b) || !GEO.faceCount(i.b)) return i.a;
    const da = MESH.meshDistance(i.a), db = MESH.meshDistance(i.b);
    if (!da.closed || !db.closed) api.note('One of the meshes is not watertight; the boolean may leak there.');
    const ba = GEO.bounds(i.a), bb = GEO.bounds(i.b);
    const min = [0, 1, 2].map((k) => Math.min(ba.min[k], bb.min[k])), max = [0, 1, 2].map((k) => Math.max(ba.max[k], bb.max[k]));
    const pad = 0.05 * Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-3);
    const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2), size = [0, 1, 2].map((k) => max[k] - min[k] + 2 * pad);
    const k = Math.max(0, i.smoothness);
    const smin = (x, y) => { if (k <= 0) return Math.min(x, y); const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (y - x) / k)); return y + (x - y) * h - k * h * (1 - h); };
    const smax = (x, y) => -smin(-x, -y);
    const op = i.operation;
    const sample = (x, y, z) => {
      const p = [x, y, z];
      const A = da.distance(p), B = db.distance(p);
      if (op === 'union') return smin(A, B);
      if (op === 'intersection') return smax(A, B);
      return smax(A, -B);
    };
    return MESH.marchingTetrahedra(sample, { center, size, resolution: Math.round(i.resolution), iso: 0 });
  },
});

// ---------------------------------------------------------------- curves
node({
  id: 'cadence.curveGeometry.toMesh', label: 'Curve To Mesh', category: CU, subcategory: 'Convert',
  aliases: ['sweep', 'tube', 'pipe along curve', 'extrude curve', 'rope', 'cable', 'wire', 'loft', 'thick line'],
  summary: 'Sweeps a round (or custom) profile along a curve to make a tube.',
  teach: 'Any path becomes a solid tube. Radius can vary along the path, so a tapered tentacle or a lightning bolt with a thin tip is one node.',
  explain: 'The profile is carried along the curve with a rotation-minimising frame, so the tube never twists at bends the way a naive frame does. Radius is a field evaluated per curve point — a point attribute named "radius" (stored with Store Attribute) is the usual driver; a Profile geometry replaces the circle with your own outline drawn in the XY plane (a Star makes a star-section tube).',
  commonUses: ['a tentacle', 'a lightning bolt with a thin tip', 'a spiral cable', 'a thick, shaded trail'],
  exportSupport: 'converted', performance: 'moderate',
  inputs: [
    curveIn(),
    { key: 'radius', label: 'Radius', type: 'field<float>', default: 0.2, min: 0, unit: 'studs' },
    intIn('segments', 'Segments', 12, { min: 3, max: 64 }),
    { key: 'profile', label: 'Profile', type: 'geometry', description: 'Optional: a curve in the XY plane to sweep instead of a circle.' },
    boolIn('caps', 'Cap the ends', true),
  ],
  outputs: [geoOut('Mesh')],
  evaluate: (api, i) => {
    const c = i.curve;
    if (!GEO.isGeometry(c) || !GEO.curveCount(c)) { if (GEO.isGeometry(c) && GEO.pointCount(c)) api.warn('Curve To Mesh needs a curve — put Curve From Points in front of it.'); return GEO.newGeometry(); }
    const rAt = pointSampler(c, i.radius);
    const total = GEO.pointCount(c) * Math.max(3, Math.round(i.segments));
    if (total > 1_000_000) { api.warn('That tube would have over a million points; lower the segments or resample the curve.'); return GEO.newGeometry(); }
    return MESH.curveToMesh(c, { radiusAt: (k) => Math.max(0, Number(rAt(k)) || 0), segments: Math.round(i.segments), profile: GEO.isGeometry(i.profile) && GEO.pointCount(i.profile) >= 2 ? i.profile : null, caps: !!i.caps });
  },
});

node({
  id: 'cadence.curveGeometry.fill', label: 'Fill Curve', category: CU, subcategory: 'Convert',
  aliases: ['fill', 'polygon', 'flat shape from outline', 'cap', 'face from curve', 'outline to face'],
  summary: 'Turns a closed outline into a flat filled face.',
  explain: 'Ear-clipping in each curve\'s own plane, so any simple (non-self-crossing) outline fills correctly, concave ones included. Each curve is filled on its own — a curve inside another does not cut a hole.',
  commonUses: ['a star-shaped card from a Star curve', 'a flat shape to extrude into a solid', 'an arbitrary decal shape'],
  exportSupport: 'converted', performance: 'moderate',
  inputs: [curveIn()],
  outputs: [geoOut('Mesh')],
  evaluate: (api, i) => (GEO.isGeometry(i.curve) && GEO.curveCount(i.curve) ? MESH.fillCurves(i.curve) : GEO.newGeometry()),
});

node({
  id: 'cadence.curveGeometry.trim', label: 'Trim Curve', category: CU, subcategory: 'Edit',
  aliases: ['cut curve', 'shorten', 'grow curve', 'draw on', 'reveal path', 'partial curve', 'animate along'],
  summary: 'Keeps only the part of a curve between two fractions of its length.',
  teach: 'Animate End from 0 to 1 and the curve draws itself on. Animate Start behind it and the line travels.',
  explain: 'Fractions are by length, so the reveal moves at a constant speed along the path whatever the spacing of its points.',
  commonUses: ['a lightning bolt drawing itself', 'a travelling segment along a track', 'a sweep that grows'],
  exportSupport: 'converted',
  inputs: [curveIn(), n('start', 'Start', 0, { min: 0, max: 1 }), n('end', 'End', 1, { min: 0, max: 1 })],
  outputs: [geoOut('Curve')],
  evaluate: (api, i) => (GEO.isGeometry(i.curve) && GEO.curveCount(i.curve) ? MESH.trimCurves(i.curve, i.start, i.end) : GEO.newGeometry()),
});

node({
  id: 'cadence.curveGeometry.fillet', label: 'Fillet Curve', category: CU, subcategory: 'Edit',
  aliases: ['round corners', 'soften corners', 'bevel curve', 'smooth corners', 'rounded path'],
  summary: 'Rounds every corner of a curve with a circular arc.',
  explain: 'A true arc of the given radius, shortened where the neighbouring segments are too short to fit it. Four segments per corner reads as round at any normal size; raise it for a tube seen up close.',
  commonUses: ['a rounded rectangle path', 'softening a hand-placed path before sweeping it'],
  exportSupport: 'converted',
  inputs: [curveIn(), n('radius', 'Radius', 0.25, { min: 0, unit: 'studs' }), intIn('segments', 'Segments per corner', 4, { min: 1, max: 32 })],
  outputs: [geoOut('Curve')],
  evaluate: (api, i) => (GEO.isGeometry(i.curve) && GEO.curveCount(i.curve) ? MESH.filletCurves(i.curve, i.radius, Math.round(i.segments)) : GEO.newGeometry()),
});

node({
  id: 'cadence.curveGeometry.info', label: 'Curve Info', category: CU, subcategory: 'Read',
  aliases: ['curve length', 'how long', 'path length', 'count curves'],
  summary: 'The total length of a geometry\'s curves and how many there are.',
  exportSupport: 'native',
  inputs: [curveIn()],
  outputs: [{ key: 'length', label: 'Length', type: 'float', unit: 'studs' }, { key: 'count', label: 'Curves', type: 'int' }, { key: 'points', label: 'Points', type: 'int' }],
  evaluate: (api, i) => {
    const c = i.curve;
    if (!GEO.isGeometry(c) || !GEO.curveCount(c)) return { length: 0, count: 0, points: GEO.pointCount(c) };
    let L = 0;
    for (let k = 0; k < GEO.curveCount(c); k++) L += MESH.curveTotalLength(c, k);
    return { length: L, count: GEO.curveCount(c), points: GEO.pointCount(c) };
  },
});

// curve primitives
function curvePrimitive(spec) {
  return node({
    id: spec.id, label: spec.label, category: CU, subcategory: 'Build',
    aliases: spec.aliases, summary: spec.summary, explain: spec.explain, commonUses: spec.commonUses,
    exportSupport: 'converted',
    inputs: spec.inputs,
    outputs: [geoOut('Curve')],
    evaluate: (api, i) => {
      const built = spec.build(i);
      const pts = built.points;
      const g = GEO.pointCloud(pts.length);
      const pos = g.points.attrs.position;
      for (let k = 0; k < pts.length; k++) { pos.data[k * 3] = pts[k][0]; pos.data[k * 3 + 1] = pts[k][1]; pos.data[k * 3 + 2] = pts[k][2]; }
      if (pts.length) GEO.setCurves(g, [0, pts.length], [built.cyclic ? 1 : 0]);
      return g;
    },
  });
}

curvePrimitive({
  id: 'cadence.curveGeometry.bezier', label: 'Bezier Curve',
  aliases: ['bezier', 'smooth curve', 'handle curve', 's curve', 'arc between', 'swoop'],
  summary: 'A smooth cubic curve from a start, an end and two handles.',
  explain: 'The handles pull the curve towards them without it passing through — drag them in the viewport to shape a swoop. Chain several with Join Geometry for a longer path.',
  commonUses: ['a swooping projectile path', 'a smooth camera-style sweep', 'a tentacle centreline'],
  inputs: [
    v3('start', 'Start', [-2, 0, 0], { unit: 'studs' }), v3('handle1', 'Start handle', [-1, 2, 0], { unit: 'studs' }),
    v3('handle2', 'End handle', [1, 2, 0], { unit: 'studs' }), v3('end', 'End', [2, 0, 0], { unit: 'studs' }),
    intIn('segments', 'Segments', 32, { min: 1, max: 1024 }),
  ],
  build: (i) => ({ points: MESH.bezierPoints(V.toComponents('vector3', i.start), V.toComponents('vector3', i.handle1), V.toComponents('vector3', i.handle2), V.toComponents('vector3', i.end), Math.round(i.segments)), cyclic: false }),
});

curvePrimitive({
  id: 'cadence.curveGeometry.spiral', label: 'Spiral',
  aliases: ['flat spiral', 'archimedean spiral', 'coil flat', 'swirl path', 'vortex path'],
  summary: 'A flat spiral (or a cone spiral with height) whose radius grows with the turns.',
  explain: 'Helix keeps a constant radius and climbs; Spiral changes radius as it turns and lies flat by default. Height above zero lifts it into a cone.',
  commonUses: ['a vortex path for particles to follow', 'a swirl decal outline', 'a spring seen from above'],
  inputs: [
    n('turns', 'Turns', 3, { min: 0.01, unit: 'turns' }), n('startRadius', 'Start radius', 0.2, { min: 0, unit: 'studs' }),
    n('endRadius', 'End radius', 2, { min: 0, unit: 'studs' }), n('height', 'Height', 0, { unit: 'studs' }),
    intIn('segments', 'Segments', 96, { min: 2, max: 4096 }), mode('plane', 'Lies in', ['xz', 'xy', 'yz'], 'xz'),
  ],
  build: (i) => {
    const seg = Math.max(2, Math.round(i.segments)); const pts = [];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg, a = t * i.turns * Math.PI * 2, r = i.startRadius + (i.endRadius - i.startRadius) * t;
      const u = Math.cos(a) * r, v = Math.sin(a) * r, h = i.height * (t - 0.5);
      pts.push(i.plane === 'xy' ? [u, v, h] : i.plane === 'yz' ? [h, u, v] : [u, h, v]);
    }
    return { points: pts, cyclic: false };
  },
});

curvePrimitive({
  id: 'cadence.curveGeometry.star', label: 'Star',
  aliases: ['star outline', 'star shape', 'spikes outline', 'pointed shape', 'polygon outline', 'gear outline'],
  summary: 'A closed star outline with alternating inner and outer points.',
  explain: 'Equal radii give a regular polygon; a small inner radius gives sharp spikes. Fill Curve turns it into a card, Curve To Mesh into a star-section tube, and as a Profile for Curve To Mesh it becomes the cross-section of one.',
  commonUses: ['a star card for a hit flash', 'a gear-like profile', 'a spiky outline to instance along'],
  inputs: [
    intIn('points', 'Points', 5, { min: 2, max: 256 }), n('innerRadius', 'Inner radius', 0.5, { min: 0, unit: 'studs' }),
    n('outerRadius', 'Outer radius', 1, { min: 0, unit: 'studs' }), n('twist', 'Twist', 0, { unit: 'degrees' }),
    mode('plane', 'Lies in', ['xy', 'xz', 'yz'], 'xy'),
  ],
  build: (i) => {
    const np = Math.max(2, Math.round(i.points)); const pts = [];
    const tw = (i.twist * Math.PI) / 180;
    for (let k = 0; k < np * 2; k++) {
      const a = (k / (np * 2)) * Math.PI * 2 - Math.PI / 2, r = k % 2 === 0 ? i.outerRadius : i.innerRadius;
      const ang = a + (k % 2 === 0 ? 0 : tw);
      const u = Math.cos(ang) * r, v = Math.sin(ang) * r;
      pts.push(i.plane === 'xz' ? [u, 0, v] : i.plane === 'yz' ? [0, u, v] : [u, v, 0]);
    }
    return { points: pts, cyclic: true };
  },
});

// ---------------------------------------------------------------- primitives that belong with the others
node({
  id: 'cadence.geometry.icosphere', label: 'Icosphere', category: GEOC, subcategory: 'Primitives',
  aliases: ['ico sphere', 'geodesic', 'even sphere', 'triangle sphere', 'blob base', 'rock base'],
  summary: 'A sphere of evenly sized triangles, with no dense poles.',
  explain: 'The UV sphere bunches its points at the poles; an icosphere spreads them evenly, which is what you want under a displacement (a rock, a blob, a planet) or before extruding faces into a crystal cluster. Each subdivision level quadruples the faces: 2 is 320 faces, 4 is 5,120.',
  commonUses: ['a rock or asteroid after noise displacement', 'a crystal cluster after Extrude Faces', 'an even base for Inset panelling'],
  exportSupport: 'converted',
  inputs: [n('radius', 'Radius', 1, { min: 0, unit: 'studs' }), intIn('subdivisions', 'Subdivisions', 2, { min: 0, max: 6 })],
  outputs: [geoOut()],
  evaluate: (api, i) => MESH.icosphere(i.radius, Math.round(i.subdivisions)),
});

// ---------------------------------------------------------------- attribute statistics
node({
  id: 'cadence.attribute.statistics', label: 'Attribute Statistics', category: 'Attributes', subcategory: 'Read',
  aliases: ['min max', 'average', 'mean', 'median', 'sum of', 'standard deviation', 'range of', 'statistics', 'highest point', 'lowest point'],
  summary: 'The minimum, maximum, mean, median, sum, spread and range of a value over a geometry.',
  teach: 'Ask "how high is the highest point" or "what is the average speed" and get a number you can wire anywhere.',
  explain: 'Evaluates the field once per element of the chosen domain and reduces. For vectors every statistic is taken per component. This is how an effect adapts to its own geometry: normalise a height by the maximum, centre a shape by its mean, threshold by the median.',
  commonUses: ['normalising a height to 0..1 by the maximum', 'centring a mesh on its mean position', 'a colour that tracks the average speed'],
  exportSupport: 'baked', performance: 'moderate',
  generics: { T: { kinds: ['float', 'vector3'] } },
  inputs: [geoIn(), { key: 'value', label: 'Value', type: 'field<T>', default: 0 }, mode('domain', 'On', ['point', 'face', 'curve'], 'point')],
  outputs: [out('min', 'Minimum'), out('max', 'Maximum'), out('mean', 'Mean'), out('median', 'Median'), out('sum', 'Sum'), out('std', 'Standard deviation'), out('range', 'Range'), { key: 'count', label: 'Count', type: 'int' }],
  evaluate: (api, i) => {
    const t = api.typeName('T'); const comps = V.componentCount(t);
    const empty = comps === 1 ? 0 : [0, 0, 0];
    if (!GEO.isGeometry(i.geometry)) return { min: empty, max: empty, mean: empty, median: empty, sum: empty, std: empty, range: empty, count: 0 };
    const data = GEO.sampleFieldOverDomain(i.geometry, i.domain, i.value, comps);
    const s = MESH.statistics(data, comps);
    const pick = (arr) => (comps === 1 ? arr[0] : arr);
    return { min: pick(s.min), max: pick(s.max), mean: pick(s.mean), median: pick(s.median), sum: pick(s.sum), std: pick(s.std), range: pick(s.range), count: s.count };
  },
});
