// Geometry sampling (spec Part 23) and instancing (Part 24).
//
// Part 23 calls sampling "extremely important for VFX", and the reason is that it is the join between
// the two halves of the engine: geometry describes WHERE, particles and instances are WHAT. Once
// "points on the surface of an arbitrary geometry" exists, a user can spawn an effect from any shape
// they can construct — including shapes the developers never anticipated — which is Part 80's whole
// definition of success.
//
// AREA WEIGHTING IS NOT OPTIONAL. Scattering points by picking a random triangle uniformly clusters
// them on small triangles, and every mesh that came out of a modelling package has wildly uneven
// triangle areas. The result is instantly recognisable as banding along dense regions, and it is the
// single most common way a scatter looks wrong. So the surface sampler weights by cumulative area
// (geometry.js's faceAreaTable) and the cost of building that table is worth paying every time.
//
// EVERY SAMPLER IS DETERMINISTIC. Positions come from the node's structural seed (Part 14), never
// from Math.random, so the same graph at the same frame scatters points identically — which is what
// makes scrubbing and baking meaningful.

import * as V from '../values.js';
import * as F from '../fields.js';
import * as GEO from '../geometry.js';
import { node, n, i as intIn, b as boolIn, v3, out, mode } from './_helpers.js';

const C = 'Geometry';
const IN = 'Instances';

const geoIn = (key = 'geometry', label = 'Geometry') => ({ key, label, type: 'geometry' });
const geoOut = (label = 'Points') => ({ key: 'out', label, type: 'geometry' });
const countIn = (dflt = 100) => intIn('count', 'Count', dflt, { min: 0, max: 200000 });
const seedIn = () => n('seed', 'Variation', 0);

// Copy the attributes of a source element onto a freshly created point, so a scattered point inherits
// whatever the surface it came from was carrying. Interpolated across a triangle's three corners when
// barycentric weights are supplied — a point halfway along an edge should get the halfway colour, not
// one corner's colour.
function inheritAttrs(dst, dstIndex, src, indices, weights) {
  for (const name of GEO.attrNames(src)) {
    if (name === 'position') continue;
    const col = src.attrs[name];
    GEO.ensureAttr(dst, name, col.components);
    const acc = new Array(col.components).fill(0);
    for (let w = 0; w < indices.length; w++) {
      const base = indices[w] * col.components;
      for (let k = 0; k < col.components; k++) acc[k] += col.data[base + k] * weights[w];
    }
    GEO.writeAttr(dst, name, dstIndex, col.components === 1 ? acc[0] : acc);
  }
}

// ---------------------------------------------------------------- surface sampling
node({
  id: 'cadence.sample.pointsOnSurface', label: 'Points On Surface', category: C, subcategory: 'Sample',
  aliases: ['scatter on mesh', 'distribute on surface', 'spawn from mesh', 'random points on', 'surface scatter', 'cover'],
  summary: 'Scatters points randomly over the surface of a geometry.',
  teach: 'Sprinkles points evenly all over the outside of a shape.',
  explain: 'Points are placed by surface AREA, so a mesh with big and small triangles still gets an even covering — scattering per triangle instead would bunch points wherever the mesh is finely divided. Each point inherits the surface\'s normal and its attributes, so what you scatter can be aligned and coloured by the surface it came from.',
  commonUses: ['spawning particles from a character\'s surface', 'scattering debris over ground', 'sparks over a shape'],
  exportSupport: 'baked', performance: 'moderate',
  inputs: [
    geoIn(),
    countIn(100),
    { key: 'density', label: 'Density mask', type: 'field<float>', default: 1, description: 'Rejects points where it is low: 1 keeps everything, 0 keeps nothing. Use it to scatter only on part of a surface.' },
    seedIn(),
  ],
  outputs: [geoOut(), { key: 'count', label: 'Points made', type: 'int' }],
  evaluate: (api, i) => {
    const src = i.geometry;
    const want = Math.max(0, Math.round(i.count));
    if (!GEO.isGeometry(src) || !GEO.faceCount(src) || !want) {
      if (GEO.isGeometry(src) && GEO.pointCount(src) && !GEO.faceCount(src)) {
        api.warn('Points On Surface needs faces — this geometry has points but no surface. Points In Volume or Points On Curve may be what you want.');
      }
      return { out: GEO.newGeometry(), count: 0 };
    }
    const cum = GEO.faceAreaTable(src);
    if (!(cum[cum.length - 1] > 0)) {
      api.warn('Every face of this geometry has zero area, so there is no surface to scatter on.');
      return { out: GEO.newGeometry(), count: 0 };
    }
    const g = GEO.pointCloud(want);
    GEO.ensureAttr(g.points, 'normal', 3);
    const tri = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const pos = g.points.attrs.position, nrm = g.points.attrs.normal;
    const densityCtx = F.newSampleContext();
    let made = 0;
    for (let k = 0; k < want; k++) {
      const face = GEO.pickFaceByArea(cum, api.random(k, 1));
      const bary = GEO.barycentric(api.random(k, 2), api.random(k, 3));
      GEO.triangleCorners(src, face, tri);
      const p = [0, 0, 0];
      for (let a = 0; a < 3; a++) p[a] = tri[0][a] * bary[0] + tri[1][a] * bary[1] + tri[2][a] * bary[2];
      // The density mask is evaluated AT the candidate position, so it can be any spatial field.
      // Rejection rather than redistribution: it keeps the accepted points' distribution correct.
      densityCtx.position = p;
      densityCtx.index = k;
      densityCtx.normal = GEO.faceNormal(tri[0], tri[1], tri[2]);
      const d = Number(F.sampleAny(i.density, densityCtx));
      if (d < 1 && api.random(k, 4) > d) continue;
      pos.data[made * 3] = p[0]; pos.data[made * 3 + 1] = p[1]; pos.data[made * 3 + 2] = p[2];
      const fn = densityCtx.normal;
      nrm.data[made * 3] = fn[0]; nrm.data[made * 3 + 1] = fn[1]; nrm.data[made * 3 + 2] = fn[2];
      const base = src.faces.offsets[face];
      inheritAttrs(g.points, made, src.points, [src.faces.corners[base], src.faces.corners[base + 1], src.faces.corners[base + 2]], bary);
      made++;
    }
    GEO.compactTable(g.points, (k) => k < made);
    return { out: g, count: made };
  },
});

node({
  id: 'cadence.sample.pointsInVolume', label: 'Points In Volume', category: C, subcategory: 'Sample',
  aliases: ['scatter inside', 'fill with points', 'spawn in shape', 'volume scatter', 'inside shape', 'cloud of points'],
  summary: 'Scatters points randomly inside a region defined by a distance field.',
  teach: 'Fills the inside of a shape with points.',
  explain: 'Takes an SDF rather than a mesh, because "inside" is a question only a distance field can answer cheaply and for any shape — including one built from smooth unions that no mesh exists for. Points are tried inside the bounding box and kept when the field says they are inside, so a thin shape inside a big box needs more attempts; the attempts limit stops that becoming a hang.',
  commonUses: ['filling a cloud or nebula volume', 'spawning particles inside an arbitrary region', 'a volumetric explosion core'],
  exportSupport: 'baked', performance: 'moderate',
  inputs: [
    { key: 'shape', label: 'Shape (distance)', type: 'field<float>', default: 0, unit: 'studs' },
    countIn(100),
    v3('boundsCenter', 'Search centre', [0, 0, 0], { unit: 'studs' }),
    v3('boundsSize', 'Search size', [4, 4, 4], { unit: 'studs' }),
    intIn('maxAttempts', 'Attempts per point', 16, { min: 1, max: 256, description: 'Give up on a point after this many tries. Raise it for thin shapes inside a large search box.' }),
    seedIn(),
  ],
  outputs: [geoOut(), { key: 'count', label: 'Points made', type: 'int' }],
  evaluate: (api, i) => {
    const want = Math.max(0, Math.round(i.count));
    if (!want) return { out: GEO.newGeometry(), count: 0 };
    const c = V.toComponents('vector3', i.boundsCenter), s = V.toComponents('vector3', i.boundsSize);
    const tries = Math.max(1, Math.round(i.maxAttempts));
    const g = GEO.pointCloud(want);
    const pos = g.points.attrs.position;
    const ctx = F.newSampleContext();
    let made = 0;
    for (let k = 0; k < want; k++) {
      for (let t = 0; t < tries; t++) {
        const p = [
          c[0] + (api.random(k, 100 + t * 3) - 0.5) * s[0],
          c[1] + (api.random(k, 101 + t * 3) - 0.5) * s[1],
          c[2] + (api.random(k, 102 + t * 3) - 0.5) * s[2],
        ];
        ctx.position = p;
        ctx.index = k;
        if (Number(F.sampleAny(i.shape, ctx)) >= 0) continue;
        pos.data[made * 3] = p[0]; pos.data[made * 3 + 1] = p[1]; pos.data[made * 3 + 2] = p[2];
        made++;
        break;
      }
    }
    if (made < want) {
      api.note(`${made} of ${want} points landed inside the shape. Shrink the search size around the shape, or raise the attempts, to get the rest.`);
    }
    GEO.compactTable(g.points, (k) => k < made);
    return { out: g, count: made };
  },
});

node({
  id: 'cadence.sample.pointsOnCurve', label: 'Points On Curve', category: 'Curves', subcategory: 'Sample',
  aliases: ['along path', 'distribute on curve', 'spawn along', 'points along line', 'space along', 'follow path'],
  summary: 'Places points along a curve, evenly spaced or randomly.',
  explain: 'Spacing is measured by LENGTH along the curve, so points come out evenly spaced even where the curve\'s own control points are bunched. Each point gets the curve\'s tangent, which is what lets you align instances to point along the path.',
  commonUses: ['segments of a lightning bolt', 'beads along an energy trail', 'spawning along a sword\'s slash arc'],
  exportSupport: 'baked', performance: 'cheap',
  inputs: [
    geoIn('geometry', 'Curve'),
    countIn(32),
    mode('distribution', 'Spacing', ['even', 'random'], 'even'),
    n('startOffset', 'Start at', 0, { min: 0, max: 1, description: 'Where along the curve to begin, as a fraction of its length.' }),
    n('endOffset', 'End at', 1, { min: 0, max: 1 }),
    seedIn(),
  ],
  outputs: [geoOut(), { key: 'count', label: 'Points made', type: 'int' }],
  evaluate: (api, i) => {
    const src = i.geometry;
    const want = Math.max(0, Math.round(i.count));
    if (!GEO.isGeometry(src) || !GEO.curveCount(src) || !want) {
      if (GEO.isGeometry(src) && GEO.pointCount(src) && !GEO.curveCount(src)) {
        api.warn('Points On Curve needs a curve. Put Curve From Points in front of it to thread these points into one.');
      }
      return { out: GEO.newGeometry(), count: 0 };
    }
    const curves = GEO.curveCount(src);
    const from = V.clamp01(Math.min(i.startOffset, i.endOffset));
    const to = V.clamp01(Math.max(i.startOffset, i.endOffset));
    const positions = [], tangents = [], curveIds = [], alongs = [];
    for (let c = 0; c < curves; c++) {
      const cum = GEO.curveLengths(src, c);
      const perCurve = Math.max(1, Math.round(want / curves));
      for (let k = 0; k < perCurve; k++) {
        const u = i.distribution === 'random'
          ? api.random(c * 100003 + k, 5)
          : (perCurve === 1 ? 0.5 : k / (perCurve - 1));
        const t = from + (to - from) * u;
        const s = GEO.sampleCurve(src, c, t, cum);
        positions.push(s.position);
        tangents.push(s.tangent);
        curveIds.push(c);
        alongs.push(t);
      }
    }
    const g = GEO.pointCloud(positions.length);
    const pos = g.points.attrs.position;
    for (let k = 0; k < positions.length; k++) {
      pos.data[k * 3] = positions[k][0]; pos.data[k * 3 + 1] = positions[k][1]; pos.data[k * 3 + 2] = positions[k][2];
    }
    GEO.ensureAttr(g.points, 'tangent', 3);
    GEO.ensureAttr(g.points, 'curveIndex', 1);
    GEO.ensureAttr(g.points, 'along', 1);
    for (let k = 0; k < positions.length; k++) {
      GEO.writeAttr(g.points, 'tangent', k, tangents[k]);
      GEO.writeAttr(g.points, 'curveIndex', k, curveIds[k]);
      GEO.writeAttr(g.points, 'along', k, alongs[k]);
    }
    return { out: g, count: positions.length };
  },
});

// ---------------------------------------------------------------- queries
node({
  id: 'cadence.sample.nearestPoint', label: 'Nearest Point', category: C, subcategory: 'Query',
  aliases: ['closest point', 'find nearest', 'snap to points', 'proximity', 'distance to points'],
  summary: 'Finds the closest point of a geometry to wherever you are.',
  explain: 'A brute-force search, so it costs the point count per lookup — fine for hundreds of points, expensive for tens of thousands sampled per particle. It is the primitive behind proximity effects: fading by distance to a set of markers, or attracting particles to the nearest of several targets.',
  commonUses: ['attracting particles to their nearest target', 'fading by distance to a set of markers'],
  exportSupport: 'baked', performance: 'expensive',
  inputs: [geoIn('geometry', 'Points')],
  outputs: [
    { key: 'position', label: 'Position', type: 'field<vector3>', unit: 'studs' },
    { key: 'distance', label: 'Distance', type: 'field<float>', unit: 'studs' },
    { key: 'index', label: 'Which point', type: 'field<int>' },
  ],
  evaluate: (api, i) => {
    const src = i.geometry;
    const count = GEO.pointCount(src);
    const pos = count ? src.points.attrs.position : null;
    // Compute once per sample and share across the three outputs, so asking for position AND distance
    // does not double the search cost.
    const find = (ctx) => {
      if (!count) return { position: [0, 0, 0], distance: 0, index: -1 };
      const p = ctx.position || [0, 0, 0];
      let best = Infinity, bi = 0;
      for (let k = 0; k < count; k++) {
        const dx = pos.data[k * 3] - (p[0] || 0);
        const dy = pos.data[k * 3 + 1] - (p[1] || 0);
        const dz = pos.data[k * 3 + 2] - (p[2] || 0);
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) { best = d; bi = k; }
      }
      return {
        position: [pos.data[bi * 3], pos.data[bi * 3 + 1], pos.data[bi * 3 + 2]],
        distance: Math.sqrt(best),
        index: bi,
      };
    };
    return {
      position: F.makeField('vector3', (ctx) => find(ctx).position),
      distance: F.makeField('float', (ctx) => find(ctx).distance),
      index: F.makeField('int', (ctx) => find(ctx).index),
    };
  },
});

node({
  id: 'cadence.sample.attribute', label: 'Sample Attribute', category: C, subcategory: 'Query',
  aliases: ['read from geometry', 'transfer attribute', 'attribute from nearest', 'lookup on geometry', 'borrow'],
  summary: 'Reads an attribute from the nearest point of another geometry.',
  explain: 'Attribute transfer: it lets one geometry\'s data drive another\'s. Colour a particle by the colour of the surface point nearest to it, or read a temperature written onto a low-resolution grid from a high-resolution scatter.',
  commonUses: ['colouring particles from the mesh they came near', 'reading a coarse field written onto a point grid'],
  exportSupport: 'baked', performance: 'expensive',
  generics: { T: { kinds: V.NUMERIC_KINDS } },
  inputs: [
    geoIn('geometry', 'From'),
    { key: 'name', label: 'Attribute', type: 'string', default: 'position', socket: false },
    { key: 'fallback', label: 'If missing', type: 'T', default: 0 },
  ],
  outputs: [{ key: 'out', label: 'Value', type: 'field<T>' }],
  evaluate: (api, i) => {
    const tn = api.typeName('T');
    const src = i.geometry;
    const count = GEO.pointCount(src);
    const name = String(i.name || '');
    if (count && !GEO.hasAttr(src.points, name)) {
      api.warn(`This geometry has no point attribute called "${name}". It has: ${GEO.attrNames(src.points).join(', ') || 'none'}.`);
    }
    const pos = count ? src.points.attrs.position : null;
    return F.makeField(tn, (ctx) => {
      if (!count) return i.fallback;
      const p = ctx.position || [0, 0, 0];
      let best = Infinity, bi = 0;
      for (let k = 0; k < count; k++) {
        const dx = pos.data[k * 3] - (p[0] || 0);
        const dy = pos.data[k * 3 + 1] - (p[1] || 0);
        const dz = pos.data[k * 3 + 2] - (p[2] || 0);
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) { best = d; bi = k; }
      }
      return V.coerceToKind(tn, GEO.readAttr(src.points, name, bi, undefined), i.fallback);
    });
  },
});

node({
  id: 'cadence.sample.raycast', label: 'Raycast', category: C, subcategory: 'Query',
  aliases: ['ray hit', 'trace', 'line of sight', 'project onto mesh', 'drop onto surface', 'shoot ray'],
  summary: 'Fires a ray at a geometry and reports where it hits.',
  explain: 'Brute-force against every triangle, so it costs the face count per ray. The classic use is dropping scattered points onto uneven ground: scatter above, cast down, move each point to where it hit.',
  commonUses: ['dropping debris onto uneven ground', 'sticking decals to a surface', 'testing whether a path is blocked'],
  exportSupport: 'baked', performance: 'expensive',
  inputs: [
    geoIn('geometry', 'Against'),
    { key: 'origin', label: 'From', type: 'field<vector3>', default: [0, 0, 0], defaultFrom: 'position', unit: 'studs' },
    { key: 'direction', label: 'Direction', type: 'field<vector3>', default: [0, -1, 0] },
    n('maxDistance', 'Maximum distance', 100, { min: 0, unit: 'studs' }),
  ],
  outputs: [
    { key: 'hit', label: 'Hit', type: 'field<bool>' },
    { key: 'position', label: 'Hit position', type: 'field<vector3>', unit: 'studs' },
    { key: 'normal', label: 'Hit normal', type: 'field<vector3>' },
    { key: 'distance', label: 'Distance', type: 'field<float>', unit: 'studs' },
  ],
  evaluate: (api, i) => {
    const src = i.geometry;
    const faces = GEO.faceCount(src);
    if (GEO.isGeometry(src) && !faces) api.warn('Raycast needs faces to hit — this geometry has none.');
    const tri = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];

    const cast = (ctx) => {
      const o = V.toComponents('vector3', F.sampleAny(i.origin, ctx));
      const d = V.vNormalize(V.toComponents('vector3', F.sampleAny(i.direction, ctx)));
      let bestT = Math.max(0, i.maxDistance), hit = false, hn = [0, 1, 0];
      for (let f = 0; f < faces; f++) {
        GEO.triangleCorners(src, f, tri);
        const t = rayTriangle(o, d, tri[0], tri[1], tri[2]);
        if (t !== null && t < bestT) { bestT = t; hit = true; hn = GEO.faceNormal(tri[0], tri[1], tri[2]); }
      }
      return {
        hit,
        distance: hit ? bestT : 0,
        position: hit ? [o[0] + d[0] * bestT, o[1] + d[1] * bestT, o[2] + d[2] * bestT] : o,
        normal: hn,
      };
    };
    return {
      hit: F.makeField('bool', (ctx) => cast(ctx).hit),
      position: F.makeField('vector3', (ctx) => cast(ctx).position),
      normal: F.makeField('vector3', (ctx) => cast(ctx).normal),
      distance: F.makeField('float', (ctx) => cast(ctx).distance),
    };
  },
});

// Möller–Trumbore. Returns the ray parameter or null. Backfaces count as hits: a ray cast from
// inside a closed mesh should still find its wall, and refusing backfaces there would report "no
// hit" for a particle escaping a container.
function rayTriangle(o, d, a, b, c) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const p = V.vCross(d, e2);
  const det = V.vDot(e1, p);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const t0 = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const u = V.vDot(t0, p) * inv;
  if (u < 0 || u > 1) return null;
  const q = V.vCross(t0, e1);
  const v = V.vDot(d, q) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = V.vDot(e2, q) * inv;
  return t > 1e-6 ? t : null;
}

// ---------------------------------------------------------------- instancing
// An instance set is a table of transforms plus a list of the geometries being placed. Storing
// transforms rather than duplicated geometry is the entire point: 10 000 rocks cost 10 000 transforms
// and one rock, not 10 000 rocks. Realize Instances is the deliberate, explicit way to pay the cost of
// actually duplicating them, and it is separate precisely so that the cost is never accidental.
const instanceIn = () => ({ key: 'instances', label: 'Instances', type: 'instanceSet' });
const instanceOut = () => ({ key: 'out', label: 'Instances', type: 'instanceSet' });

function newInstanceSet(count, sources) {
  const table = GEO.newTable(count);
  GEO.ensureAttr(table, 'position', 3);
  GEO.ensureAttr(table, 'rotation', 4, [0, 0, 0, 1]);
  GEO.ensureAttr(table, 'scale', 3, [1, 1, 1]);
  GEO.ensureAttr(table, 'source', 1);
  return { __instanceSet: true, table, sources: sources.filter(GEO.isGeometry) };
}
const isInstanceSet = (v) => !!v && v.__instanceSet === true;

node({
  id: 'cadence.instance.onPoints', label: 'Instance On Points', category: IN, subcategory: 'Create',
  aliases: ['copy to points', 'place on points', 'duplicate onto', 'scatter mesh', 'copies', 'clone to points'],
  summary: 'Places a copy of a geometry at every point.',
  teach: 'Puts a copy of one shape at each point, without making thousands of real copies.',
  explain: 'Instances store a transform each, not a copy of the geometry, so ten thousand of them cost ten thousand transforms and one shape. Plug in several geometries and each point picks one — randomly, or by an index you supply, which is how a debris field gets three different rock shapes.',
  commonUses: ['debris and rubble fields', 'a swarm of identical shapes', 'crystal shards over a surface'],
  exportSupport: 'converted',
  exportNote: 'Becomes one Roblox instance per copy; a very high count will be slow in-game even though it is cheap here.',
  performance: 'cheap',
  inputs: [
    geoIn('points', 'Points'),
    { key: 'geometry', label: 'Geometry to place', type: 'geometry', multi: true },
    { key: 'pick', label: 'Which one', type: 'field<int>', default: -1, description: 'Which of the plugged-in geometries to use. Leave at -1 to choose at random per point.' },
    seedIn(),
  ],
  outputs: [instanceOut(), { key: 'count', label: 'Count', type: 'int' }],
  evaluate: (api, i) => {
    const pts = i.points;
    const sources = (Array.isArray(i.geometry) ? i.geometry : [i.geometry]).filter(GEO.isGeometry);
    const count = GEO.pointCount(pts);
    if (!count || !sources.length) {
      if (count && !sources.length) api.warn('Instance On Points has points but no geometry to place.');
      return { out: newInstanceSet(0, sources), count: 0 };
    }
    const set = newInstanceSet(count, sources);
    const walker = GEO.makeElementContext(pts, 'point');
    for (let k = 0; k < count; k++) {
      const ctx = walker.at(k);
      GEO.writeAttr(set.table, 'position', k, ctx.position);
      const picked = Math.round(Number(F.sampleAny(i.pick, ctx)));
      const which = picked >= 0
        ? picked % sources.length
        : Math.floor(api.random(k, 7) * sources.length) % sources.length;
      GEO.writeAttr(set.table, 'source', k, which);
      // Carry the point's own attributes onto the instance, so Instance Attribute can read them and a
      // per-point colour or size survives into the placement.
      for (const name of GEO.attrNames(pts.points)) {
        if (name === 'position') continue;
        const col = pts.points.attrs[name];
        GEO.ensureAttr(set.table, name, col.components);
        GEO.writeAttr(set.table, name, k, GEO.readAttr(pts.points, name, k));
      }
    }
    return { out: set, count };
  },
});

function instanceTransformOp(spec) {
  return node({
    id: spec.id, label: spec.label, category: IN, subcategory: 'Transform',
    aliases: spec.aliases, summary: spec.summary, explain: spec.explain, commonUses: spec.commonUses,
    exportSupport: 'converted', performance: 'cheap',
    inputs: [instanceIn(), ...spec.inputs],
    outputs: [instanceOut()],
    evaluate: (api, i) => {
      if (!isInstanceSet(i.instances)) return newInstanceSet(0, []);
      const src = i.instances;
      const set = { __instanceSet: true, table: GEO.cloneTable(src.table), sources: src.sources };
      const count = set.table.count;
      const ctx = F.newSampleContext();
      const posScratch = [0, 0, 0];
      for (let k = 0; k < count; k++) {
        ctx.index = k;
        ctx.position = GEO.readAttrInto(set.table, 'position', k, posScratch);
        ctx.attributes = null;
        spec.apply(set.table, k, i, ctx, api);
      }
      return set;
    },
  });
}

instanceTransformOp({
  id: 'cadence.instance.scale', label: 'Scale Instances',
  aliases: ['resize instances', 'size instances', 'grow copies', 'per copy size'],
  summary: 'Sets or multiplies the size of every instance.',
  explain: 'Feed a field to vary size per instance — a random number for natural variation, a distance for a size falloff, or an age for something that grows.',
  inputs: [
    { key: 'scale', label: 'Scale', type: 'field<vector3>', default: [1, 1, 1] },
    mode('mode', 'Mode', ['multiply', 'set'], 'multiply'),
  ],
  apply: (table, k, i, ctx) => {
    const s = V.toComponents('vector3', F.sampleAny(i.scale, ctx));
    if (i.mode === 'set') { GEO.writeAttr(table, 'scale', k, s); return; }
    const cur = GEO.readAttr(table, 'scale', k, [1, 1, 1]);
    GEO.writeAttr(table, 'scale', k, [cur[0] * s[0], cur[1] * s[1], cur[2] * s[2]]);
  },
});

instanceTransformOp({
  id: 'cadence.instance.rotate', label: 'Rotate Instances',
  aliases: ['spin instances', 'turn copies', 'random rotation', 'orient instances'],
  summary: 'Rotates every instance.',
  explain: 'Rotation composes with whatever the instance already had, so a random rotation followed by an alignment gives a randomly spun object that still points the right way.',
  inputs: [
    { key: 'rotation', label: 'Rotate', type: 'field<vector3>', default: [0, 0, 0], unit: 'degrees' },
    mode('mode', 'Mode', ['add', 'set'], 'add'),
  ],
  apply: (table, k, i, ctx) => {
    const d = V.toComponents('vector3', F.sampleAny(i.rotation, ctx)).map((v) => (v * Math.PI) / 180);
    const q = V.qFromEuler(d[0], d[1], d[2]);
    if (i.mode === 'set') { GEO.writeAttr(table, 'rotation', k, q); return; }
    GEO.writeAttr(table, 'rotation', k, V.qMultiply(q, GEO.readAttr(table, 'rotation', k, [0, 0, 0, 1])));
  },
});

instanceTransformOp({
  id: 'cadence.instance.translate', label: 'Translate Instances',
  aliases: ['move instances', 'offset copies', 'nudge instances', 'jitter positions'],
  summary: 'Moves every instance.',
  inputs: [
    { key: 'offset', label: 'Move', type: 'field<vector3>', default: [0, 0, 0], unit: 'studs' },
  ],
  apply: (table, k, i, ctx) => {
    const o = V.toComponents('vector3', F.sampleAny(i.offset, ctx));
    const cur = GEO.readAttr(table, 'position', k, [0, 0, 0]);
    GEO.writeAttr(table, 'position', k, [cur[0] + o[0], cur[1] + o[1], cur[2] + o[2]]);
  },
});

instanceTransformOp({
  id: 'cadence.instance.align', label: 'Align Instances',
  aliases: ['point instances', 'face direction', 'orient to normal', 'look along', 'aim copies'],
  summary: 'Turns every instance so a chosen axis points along a direction.',
  explain: 'The usual directions are the point\'s normal (so shards stand up off a surface), its velocity (so debris flies nose-first) or a curve tangent (so segments follow a path). Those all arrive as fields, so this one node covers every case.',
  commonUses: ['shards standing up off a surface', 'debris flying nose-first', 'segments following a curve'],
  inputs: [
    { key: 'direction', label: 'Point along', type: 'field<vector3>', default: [0, 1, 0], defaultFrom: 'normal' },
    mode('axis', 'Which axis', ['x', 'y', 'z'], 'y'),
    { key: 'up', label: 'Up', type: 'vector3', default: [0, 1, 0] },
  ],
  apply: (table, k, i, ctx) => {
    const dir = V.vNormalize(V.toComponents('vector3', F.sampleAny(i.direction, ctx)));
    if (!(V.vLength(dir) > 1e-9)) return;
    // qLookAt builds a rotation whose forward is -Z by convention; realign it to the chosen axis so
    // "point Y along the normal" means what it says.
    const q = V.qLookAt([0, 0, 0], dir, V.toComponents('vector3', i.up));
    const fix = i.axis === 'y' ? V.qFromAxisAngle([1, 0, 0], -Math.PI / 2)
      : i.axis === 'x' ? V.qFromAxisAngle([0, 1, 0], Math.PI / 2)
        : [0, 0, 0, 1];
    GEO.writeAttr(table, 'rotation', k, V.qMultiply(q, fix));
  },
});

node({
  id: 'cadence.instance.attribute', label: 'Instance Attribute', category: IN, subcategory: 'Read',
  aliases: ['read instance', 'per instance value', 'instance index', 'instance id'],
  summary: 'Reads a named value from the instance being evaluated.',
  explain: 'Instances inherit the attributes of the points they were placed on, so anything stored on those points is readable here — which is how a per-point random value becomes a per-instance size or colour.',
  exportSupport: 'converted',
  generics: { T: { kinds: V.NUMERIC_KINDS } },
  inputs: [
    { key: 'name', label: 'Name', type: 'string', default: 'index', socket: false },
    { key: 'fallback', label: 'If missing', type: 'T', default: 0 },
  ],
  outputs: [{ key: 'out', label: 'Value', type: 'field<T>' }],
  evaluate: (api, i) => {
    const tn = api.typeName('T');
    const name = String(i.name || '');
    return F.makeField(tn, (ctx) => {
      const raw = F.attrRaw(ctx, name);
      return raw === undefined ? i.fallback : V.coerceToKind(tn, raw, i.fallback);
    });
  },
});

node({
  id: 'cadence.instance.realize', label: 'Realize Instances', category: IN, subcategory: 'Create',
  aliases: ['flatten instances', 'make real', 'bake instances', 'expand copies', 'to geometry'],
  summary: 'Turns instances into real geometry, one full copy each.',
  explain: 'The deliberate moment you pay for the copies. Before this, a thousand instances are a thousand transforms; after it they are a thousand meshes\' worth of points, and every geometry operation downstream costs accordingly. Only realize when you need to deform the copies individually or to export them as geometry — this node being explicit is what stops that cost happening by accident.',
  exportSupport: 'baked', performance: 'expensive',
  inputs: [instanceIn()],
  outputs: [geoOut('Geometry'), { key: 'points', label: 'Points made', type: 'int' }],
  evaluate: (api, i) => {
    if (!isInstanceSet(i.instances) || !i.instances.table.count) return { out: GEO.newGeometry(), points: 0 };
    const set = i.instances;
    let acc = GEO.newGeometry();
    let total = 0;
    for (let k = 0; k < set.table.count; k++) {
      const which = Math.round(GEO.readAttr(set.table, 'source', k, 0));
      const src = set.sources[which] || set.sources[0];
      if (!GEO.isGeometry(src)) continue;
      const copy = GEO.cloneGeometry(src);
      const t = V.newTransform(
        GEO.readAttr(set.table, 'position', k, [0, 0, 0]),
        GEO.readAttr(set.table, 'rotation', k, [0, 0, 0, 1]),
        GEO.readAttr(set.table, 'scale', k, [1, 1, 1]),
      );
      const pos = copy.points.attrs.position;
      for (let p = 0; p < copy.points.count; p++) {
        const q = V.transformPoint(t, [pos.data[p * 3], pos.data[p * 3 + 1], pos.data[p * 3 + 2]]);
        pos.data[p * 3] = q[0]; pos.data[p * 3 + 1] = q[1]; pos.data[p * 3 + 2] = q[2];
      }
      if (GEO.hasAttr(copy.points, 'normal')) {
        const nrm = copy.points.attrs.normal;
        for (let p = 0; p < copy.points.count; p++) {
          const nv = V.vNormalize(V.qRotateVector(t.q, [nrm.data[p * 3], nrm.data[p * 3 + 1], nrm.data[p * 3 + 2]]));
          nrm.data[p * 3] = nv[0]; nrm.data[p * 3 + 1] = nv[1]; nrm.data[p * 3 + 2] = nv[2];
        }
      }
      // The instance's own attributes go onto every point of its copy, so a per-instance value stays
      // readable after realizing.
      for (const name of GEO.attrNames(set.table)) {
        if (name === 'position' || name === 'rotation' || name === 'scale' || name === 'source') continue;
        const col = set.table.attrs[name];
        GEO.ensureAttr(copy.points, name, col.components);
        const v = GEO.readAttr(set.table, name, k);
        for (let p = 0; p < copy.points.count; p++) GEO.writeAttr(copy.points, name, p, v);
      }
      GEO.ensureAttr(copy.points, 'instanceIndex', 1);
      for (let p = 0; p < copy.points.count; p++) GEO.writeAttr(copy.points, 'instanceIndex', p, k);
      acc = GEO.joinGeometry(acc, copy);
      total += copy.points.count;
    }
    return { out: acc, points: total };
  },
});

node({
  id: 'cadence.instance.info', label: 'Instance Info', category: IN, subcategory: 'Read',
  aliases: ['count instances', 'how many copies', 'instance statistics'],
  summary: 'How many instances there are and what they are copies of.',
  exportSupport: 'native',
  inputs: [instanceIn()],
  outputs: [
    { key: 'count', label: 'Count', type: 'int' },
    { key: 'sources', label: 'Different shapes', type: 'int' },
    { key: 'pointsIfRealized', label: 'Points if realized', type: 'int' },
  ],
  evaluate: (api, i) => {
    if (!isInstanceSet(i.instances)) return { count: 0, sources: 0, pointsIfRealized: 0 };
    const set = i.instances;
    let perSource = 0;
    for (let k = 0; k < set.table.count; k++) {
      const src = set.sources[Math.round(GEO.readAttr(set.table, 'source', k, 0))] || set.sources[0];
      perSource += GEO.pointCount(src);
    }
    return { count: set.table.count, sources: set.sources.length, pointsIfRealized: perSource };
  },
});
