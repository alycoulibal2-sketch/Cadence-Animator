// Procedural geometry: primitives, curves, transforms and attribute capture (spec Parts 21, 42, and
// the parts of 22 that are honestly implementable here).
//
// Geometry in a VFX engine is not for modelling — it is for the things particles are born from, fly
// along and collide with, and for the shapes that ARE the effect (a shockwave ring, a slash plane, a
// beam tube). That is why the primitives below are parameterised the way they are and why sampling
// (Part 23) matters more than editing.
//
// WHAT IS DELIBERATELY NOT HERE. Part 22 lists Extrude, Inset, Bevel, Subdivide, Decimate, Bridge,
// Boolean Union/Difference/Intersection and friends. Those are mesh-editing operations that need a
// half-edge or BMesh-style connectivity structure to be correct, and a plausible-looking version
// built on a bare triangle soup produces cracked normals, duplicated vertices and non-manifold output
// that only shows up once someone exports. Per Part 78, they are not stubbed: the domain model here
// (geometry.js's attribute tables) is what a connectivity layer would be built on, and until that
// layer exists the operations do not appear in the catalogue at all. What IS here is the deformation
// family (Part 42), which needs no connectivity because it only moves points.

import * as V from '../values.js';
import * as F from '../fields.js';
import * as GEO from '../geometry.js';
import { node, n, i as intIn, b as boolIn, v3, out, mode } from './_helpers.js';

const C = 'Geometry';
const CU = 'Curves';

const geoIn = (key = 'geometry', label = 'Geometry') => ({ key, label, type: 'geometry' });
const geoOut = (label = 'Geometry') => ({ key: 'out', label, type: 'geometry' });

// Build a point cloud from a list of positions, plus optional extra columns.
function cloudFrom(positions, extra = {}) {
  const g = GEO.pointCloud(positions.length);
  const pos = g.points.attrs.position;
  for (let i = 0; i < positions.length; i++) {
    pos.data[i * 3] = positions[i][0] || 0;
    pos.data[i * 3 + 1] = positions[i][1] || 0;
    pos.data[i * 3 + 2] = positions[i][2] || 0;
  }
  for (const [name, rows] of Object.entries(extra)) {
    const comps = Array.isArray(rows[0]) ? rows[0].length : 1;
    GEO.ensureAttr(g.points, name, comps);
    for (let i = 0; i < rows.length; i++) GEO.writeAttr(g.points, name, i, rows[i]);
  }
  return g;
}

// A primitive that produces a surface. `build` returns { positions, triangles, uvs? }.
function surface(spec) {
  return node({
    id: spec.id, label: spec.label, category: C, subcategory: spec.subcategory || 'Primitives',
    aliases: spec.aliases, summary: spec.summary, teach: spec.teach, explain: spec.explain,
    commonUses: spec.commonUses,
    exportSupport: spec.exportSupport || 'converted',
    exportNote: spec.exportNote || 'Becomes a Roblox MeshPart or a wedge/part approximation depending on the shape.',
    performance: spec.performance || 'cheap',
    inputs: spec.inputs || [],
    outputs: [geoOut()],
    evaluate: (api, inp) => {
      const built = spec.build(inp, api);
      if (!built || !built.positions.length) return GEO.newGeometry();
      const g = cloudFrom(built.positions);
      if (built.triangles && built.triangles.length) GEO.setTriangles(g, built.triangles);
      if (built.uvs) {
        GEO.ensureAttr(g.points, 'uv', 2);
        for (let i = 0; i < built.uvs.length; i++) GEO.writeAttr(g.points, 'uv', i, built.uvs[i]);
      }
      if (built.triangles && built.triangles.length) GEO.recalculateNormals(g);
      return g;
    },
  });
}

const TAU = Math.PI * 2;
// Resolution inputs are clamped hard. An unclamped subdivision count is one fat-fingered keystroke
// away from allocating gigabytes, and a graph is edited by dragging numbers.
const resIn = (key, label, dflt, max = 256) => intIn(key, label, dflt, { min: 2, max });

// ---------------------------------------------------------------- point primitives
node({
  id: 'cadence.geometry.point', label: 'Point', category: C, subcategory: 'Primitives',
  aliases: ['single point', 'vertex', 'position', 'one point', 'origin'],
  summary: 'A single point.',
  explain: 'The smallest possible geometry, and more useful than it sounds: instance a mesh onto it to place one copy, or use it as the seed for a whole procedural structure.',
  exportSupport: 'converted',
  inputs: [v3('position', 'Position', [0, 0, 0], { unit: 'studs' })],
  outputs: [geoOut('Points')],
  evaluate: (api, i) => cloudFrom([V.toComponents('vector3', i.position)]),
});

node({
  id: 'cadence.geometry.pointGrid', label: 'Point Grid', category: C, subcategory: 'Primitives',
  aliases: ['grid of points', 'lattice', 'array of points', 'volume points', 'scatter grid'],
  summary: 'Points arranged evenly on a grid, in a plane or through a volume.',
  commonUses: ['a regular field of debris', 'sampling a volume', 'a starting lattice to distort'],
  exportSupport: 'converted', performance: 'moderate',
  inputs: [
    v3('size', 'Size', [4, 0, 4], { unit: 'studs' }),
    intIn('countX', 'Count X', 8, { min: 1, max: 256 }),
    intIn('countY', 'Count Y', 1, { min: 1, max: 256 }),
    intIn('countZ', 'Count Z', 8, { min: 1, max: 256 }),
    v3('center', 'Centre', [0, 0, 0], { unit: 'studs' }),
  ],
  outputs: [geoOut('Points')],
  evaluate: (api, i) => {
    const s = V.toComponents('vector3', i.size), c = V.toComponents('vector3', i.center);
    const nx = Math.max(1, Math.round(i.countX)), ny = Math.max(1, Math.round(i.countY)), nz = Math.max(1, Math.round(i.countZ));
    const positions = [], uvs = [];
    // A single point along an axis sits at the CENTRE of that axis, not at its low end — otherwise a
    // 1-deep grid would silently be off by half the size, which reads as a mysterious offset.
    const along = (idx, count, extent) => (count === 1 ? 0 : -extent / 2 + (extent * idx) / (count - 1));
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          positions.push([c[0] + along(x, nx, s[0]), c[1] + along(y, ny, s[1]), c[2] + along(z, nz, s[2])]);
          uvs.push([nx === 1 ? 0.5 : x / (nx - 1), nz === 1 ? 0.5 : z / (nz - 1)]);
        }
      }
    }
    return cloudFrom(positions, { uv: uvs });
  },
});

node({
  id: 'cadence.geometry.pointCircle', label: 'Point Ring', category: C, subcategory: 'Primitives',
  aliases: ['points on circle', 'ring of points', 'radial array', 'clock positions', 'around'],
  summary: 'Points spaced evenly around a circle.',
  commonUses: ['a radial burst of sub-effects', 'evenly spaced runes around a magic circle'],
  exportSupport: 'converted',
  inputs: [
    intIn('count', 'Count', 12, { min: 1, max: 4096 }),
    n('radius', 'Radius', 1, { min: 0, unit: 'studs' }),
    v3('center', 'Centre', [0, 0, 0], { unit: 'studs' }),
    mode('plane', 'Plane', ['xz', 'xy', 'yz'], 'xz'),
    n('phase', 'Rotate', 0, { unit: 'turns' }),
  ],
  outputs: [geoOut('Points')],
  evaluate: (api, i) => {
    const cnt = Math.max(1, Math.round(i.count));
    const c = V.toComponents('vector3', i.center);
    const positions = [], normals = [], uvs = [];
    for (let k = 0; k < cnt; k++) {
      const a = (k / cnt + i.phase) * TAU;
      const u = Math.cos(a) * i.radius, w = Math.sin(a) * i.radius;
      const p = i.plane === 'xy' ? [u, w, 0] : i.plane === 'yz' ? [0, u, w] : [u, 0, w];
      positions.push([c[0] + p[0], c[1] + p[1], c[2] + p[2]]);
      normals.push(V.vNormalize(p));
      uvs.push([k / cnt, 0]);
    }
    return cloudFrom(positions, { normal: normals, uv: uvs });
  },
});

// ---------------------------------------------------------------- surfaces
surface({
  id: 'cadence.geometry.plane', label: 'Plane', aliases: ['quad', 'flat', 'sheet', 'card', 'billboard shape', 'ground'],
  summary: 'A flat rectangle, optionally divided into a grid.',
  commonUses: ['a slash or sweep card', 'a ground plane to collide against', 'a base to displace into terrain'],
  inputs: [
    v3('size', 'Size', [2, 0, 2], { unit: 'studs' }),
    resIn('segmentsX', 'Segments X', 1), resIn('segmentsY', 'Segments Y', 1),
    mode('plane', 'Facing', ['xz', 'xy', 'yz'], 'xz'),
  ],
  build: (i) => {
    const s = V.toComponents('vector3', i.size);
    const nx = Math.max(1, Math.round(i.segmentsX)), ny = Math.max(1, Math.round(i.segmentsY));
    const ax = i.plane === 'xy' ? [0, 1] : i.plane === 'yz' ? [1, 2] : [0, 2];
    const ex = s[ax[0]] || 2, ey = s[ax[1]] || 2;
    const positions = [], uvs = [], triangles = [];
    for (let y = 0; y <= ny; y++) {
      for (let x = 0; x <= nx; x++) {
        const p = [0, 0, 0];
        p[ax[0]] = -ex / 2 + (ex * x) / nx;
        p[ax[1]] = -ey / 2 + (ey * y) / ny;
        positions.push(p);
        uvs.push([x / nx, y / ny]);
      }
    }
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const a = y * (nx + 1) + x, b = a + 1, c = a + nx + 1, d = c + 1;
        triangles.push(a, c, b, b, c, d);
      }
    }
    return { positions, uvs, triangles };
  },
});

surface({
  id: 'cadence.geometry.disc', label: 'Disc', aliases: ['circle', 'fan', 'flat round', 'shockwave disc', 'pie'],
  summary: 'A filled circle, optionally a partial arc or a ring.',
  explain: 'Inner radius above zero makes it an annulus, and a sweep below a full turn makes it a wedge. Between them this one node covers shockwave rings, radial wipes, cone-of-effect markers and pie slices.',
  commonUses: ['expanding shockwave rings', 'a ground marker for an area attack', 'radial sweeps'],
  inputs: [
    n('radius', 'Radius', 1, { min: 0, unit: 'studs' }),
    n('innerRadius', 'Inner radius', 0, { min: 0, unit: 'studs' }),
    resIn('segments', 'Segments', 32, 512),
    n('sweep', 'Sweep', 1, { min: 0, max: 1, unit: 'turns' }),
    mode('plane', 'Facing', ['xz', 'xy', 'yz'], 'xz'),
  ],
  build: (i) => {
    const seg = Math.max(3, Math.round(i.segments));
    const outer = Math.max(0, i.radius), inner = Math.min(Math.max(0, i.innerRadius), outer);
    const sweep = V.clamp01(i.sweep);
    const ax = i.plane === 'xy' ? [0, 1] : i.plane === 'yz' ? [1, 2] : [0, 2];
    const positions = [], uvs = [], triangles = [];
    const put = (r, a) => {
      const p = [0, 0, 0];
      p[ax[0]] = Math.cos(a) * r;
      p[ax[1]] = Math.sin(a) * r;
      positions.push(p);
      uvs.push([a / TAU, outer > 0 ? r / outer : 0]);
      return positions.length - 1;
    };
    // A full sweep shares its first and last ring positions; a partial one must not, or the wedge
    // closes itself.
    const rings = sweep >= 1 ? seg : seg + 1;
    for (let k = 0; k < rings; k++) {
      const a = (k / seg) * TAU * sweep;
      put(inner, a);
      put(outer, a);
    }
    const steps = sweep >= 1 ? seg : seg;
    for (let k = 0; k < steps; k++) {
      const i0 = (k % rings) * 2, i1 = ((k + 1) % rings) * 2;
      if (inner <= 1e-9) {
        triangles.push(i0 + 1, i1 + 1, i0);       // fan from the (degenerate) centre
      } else {
        triangles.push(i0, i0 + 1, i1, i1, i0 + 1, i1 + 1);
      }
    }
    return { positions, uvs, triangles };
  },
});

surface({
  id: 'cadence.geometry.box', label: 'Box', aliases: ['cube', 'block', 'brick', 'crate'],
  summary: 'A rectangular box.',
  exportNote: 'Exports as a Roblox Part natively when it is not deformed.',
  exportSupport: 'native',
  inputs: [v3('size', 'Size', [1, 1, 1], { unit: 'studs' })],
  build: (i) => {
    const s = V.toComponents('vector3', i.size).map((v) => Math.abs(v) / 2);
    const positions = [], uvs = [], triangles = [];
    // Six independent quads: a shared-corner box cannot have per-face normals or per-face UVs, and
    // both matter the moment the box is textured or lit.
    const faces = [
      [[1, 1, 1], [1, 1, -1], [1, -1, -1], [1, -1, 1]],   // +X
      [[-1, 1, -1], [-1, 1, 1], [-1, -1, 1], [-1, -1, -1]], // -X
      [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]],   // +Y
      [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]], // -Y
      [[-1, 1, 1], [1, 1, 1], [1, -1, 1], [-1, -1, 1]],   // +Z
      [[1, 1, -1], [-1, 1, -1], [-1, -1, -1], [1, -1, -1]], // -Z
    ];
    for (const quad of faces) {
      const base = positions.length;
      for (let k = 0; k < 4; k++) positions.push([quad[k][0] * s[0], quad[k][1] * s[1], quad[k][2] * s[2]]);
      uvs.push([0, 1], [1, 1], [1, 0], [0, 0]);
      triangles.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    return { positions, uvs, triangles };
  },
});

surface({
  id: 'cadence.geometry.sphere', label: 'Sphere', aliases: ['ball', 'globe', 'orb', 'uv sphere', 'round'],
  summary: 'A sphere built from rings of quads.',
  explain: 'Rings and segments means the poles are denser than the equator, which is visible if you scatter points over it by vertex — sample by surface area instead and the distribution is even regardless.',
  commonUses: ['a fireball or energy core to displace', 'a spherical shell to spawn from'],
  inputs: [
    n('radius', 'Radius', 1, { min: 0, unit: 'studs' }),
    resIn('segments', 'Segments', 24, 256), resIn('rings', 'Rings', 12, 256),
  ],
  build: (i) => {
    const seg = Math.max(3, Math.round(i.segments)), rings = Math.max(2, Math.round(i.rings));
    const r = Math.max(0, i.radius);
    const positions = [], uvs = [], triangles = [];
    for (let y = 0; y <= rings; y++) {
      const v = y / rings, phi = v * Math.PI;
      for (let x = 0; x <= seg; x++) {
        const u = x / seg, theta = u * TAU;
        positions.push([
          r * Math.sin(phi) * Math.cos(theta),
          r * Math.cos(phi),
          r * Math.sin(phi) * Math.sin(theta),
        ]);
        uvs.push([u, 1 - v]);
      }
    }
    for (let y = 0; y < rings; y++) {
      for (let x = 0; x < seg; x++) {
        const a = y * (seg + 1) + x, b = a + 1, c = a + seg + 1, d = c + 1;
        // Wound so the normal faces OUT. The ring index runs from the north pole downwards, which
        // reverses the handedness relative to the cylinder below, where it runs upwards — get this
        // backwards and the shape lights as though it were inside out.
        if (y !== 0) triangles.push(a, b, c);
        if (y !== rings - 1) triangles.push(b, d, c);
      }
    }
    return { positions, uvs, triangles };
  },
});

surface({
  id: 'cadence.geometry.cylinder', label: 'Cylinder', aliases: ['tube', 'pipe', 'beam shape', 'column', 'rod', 'cone', 'taper'],
  summary: 'A cylinder or cone, with independent top and bottom radii.',
  explain: 'Setting the top radius to zero gives a cone; different non-zero radii give a truncated cone. Capping is optional because an open tube is what you want for a beam you can see through.',
  commonUses: ['an energy beam or laser tube', 'a rocket exhaust cone', 'a tornado funnel to displace'],
  inputs: [
    n('radiusBottom', 'Bottom radius', 1, { min: 0, unit: 'studs' }),
    n('radiusTop', 'Top radius', 1, { min: 0, unit: 'studs' }),
    n('height', 'Height', 2, { min: 0, unit: 'studs' }),
    resIn('segments', 'Segments', 24, 512), resIn('heightSegments', 'Height segments', 1, 256),
    boolIn('caps', 'Capped', true),
  ],
  build: (i) => {
    const seg = Math.max(3, Math.round(i.segments)), hs = Math.max(1, Math.round(i.heightSegments));
    const rb = Math.max(0, i.radiusBottom), rt = Math.max(0, i.radiusTop), h = Math.max(0, i.height);
    const positions = [], uvs = [], triangles = [];
    for (let y = 0; y <= hs; y++) {
      const v = y / hs, r = rb + (rt - rb) * v;
      for (let x = 0; x <= seg; x++) {
        const u = x / seg, a = u * TAU;
        positions.push([Math.cos(a) * r, -h / 2 + h * v, Math.sin(a) * r]);
        uvs.push([u, v]);
      }
    }
    for (let y = 0; y < hs; y++) {
      for (let x = 0; x < seg; x++) {
        const a = y * (seg + 1) + x, b = a + 1, c = a + seg + 1, d = c + 1;
        if (rb > 1e-9 || y > 0) triangles.push(a, c, b);
        if (rt > 1e-9 || y < hs - 1) triangles.push(b, c, d);
      }
    }
    if (i.caps) {
      for (const [r, yPos, flip] of [[rb, -h / 2, true], [rt, h / 2, false]]) {
        if (r <= 1e-9) continue;
        const centre = positions.length;
        positions.push([0, yPos, 0]); uvs.push([0.5, 0.5]);
        const ring = positions.length;
        for (let x = 0; x < seg; x++) {
          const a = (x / seg) * TAU;
          positions.push([Math.cos(a) * r, yPos, Math.sin(a) * r]);
          uvs.push([0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5]);
        }
        for (let x = 0; x < seg; x++) {
          const p0 = ring + x, p1 = ring + ((x + 1) % seg);
          if (flip) triangles.push(centre, p0, p1); else triangles.push(centre, p1, p0);
        }
      }
    }
    return { positions, uvs, triangles };
  },
});

surface({
  id: 'cadence.geometry.torus', label: 'Torus', aliases: ['ring', 'donut', 'halo', 'portal rim', 'loop'],
  summary: 'A ring with a circular cross-section.',
  commonUses: ['a portal rim', 'a halo or aura ring', 'a shockwave with visible thickness'],
  inputs: [
    n('majorRadius', 'Ring radius', 1, { min: 0, unit: 'studs' }),
    n('minorRadius', 'Thickness', 0.25, { min: 0, unit: 'studs' }),
    resIn('majorSegments', 'Ring segments', 32, 512), resIn('minorSegments', 'Tube segments', 12, 256),
  ],
  build: (i) => {
    const ms = Math.max(3, Math.round(i.majorSegments)), ns = Math.max(3, Math.round(i.minorSegments));
    const R = Math.max(0, i.majorRadius), r = Math.max(0, i.minorRadius);
    const positions = [], uvs = [], triangles = [];
    for (let u = 0; u <= ms; u++) {
      const a = (u / ms) * TAU;
      for (let v = 0; v <= ns; v++) {
        const b = (v / ns) * TAU;
        const rr = R + r * Math.cos(b);
        positions.push([Math.cos(a) * rr, r * Math.sin(b), Math.sin(a) * rr]);
        uvs.push([u / ms, v / ns]);
      }
    }
    for (let u = 0; u < ms; u++) {
      for (let v = 0; v < ns; v++) {
        const a = u * (ns + 1) + v, b = a + 1, c = a + ns + 1, d = c + 1;
        triangles.push(a, b, c, b, d, c);   // outward, as in the sphere
      }
    }
    return { positions, uvs, triangles };
  },
});

// ---------------------------------------------------------------- curves
function curvePrimitive(spec) {
  return node({
    id: spec.id, label: spec.label, category: CU, subcategory: spec.subcategory || 'Primitives',
    aliases: spec.aliases, summary: spec.summary, explain: spec.explain, teach: spec.teach,
    commonUses: spec.commonUses,
    exportSupport: 'converted',
    exportNote: 'Becomes a chain of parts, a beam, or a baked trail depending on the renderer used.',
    inputs: spec.inputs,
    outputs: [geoOut('Curve')],
    evaluate: (api, i) => {
      const built = spec.build(i, api);
      if (!built || !built.length) return GEO.newGeometry();
      const g = cloudFrom(built);
      GEO.setCurves(g, [0, built.length], [spec.cyclic ? 1 : 0]);
      return g;
    },
  });
}

curvePrimitive({
  id: 'cadence.curveGeometry.line', label: 'Line', aliases: ['segment', 'straight', 'between two points', 'beam path'],
  summary: 'A straight line between two points.',
  inputs: [v3('from', 'From', [0, 0, 0], { unit: 'studs' }), v3('to', 'To', [0, 1, 0], { unit: 'studs' }), resIn('segments', 'Segments', 1)],
  build: (i) => {
    const a = V.toComponents('vector3', i.from), b = V.toComponents('vector3', i.to);
    const seg = Math.max(1, Math.round(i.segments));
    const pts = [];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
    return pts;
  },
});

curvePrimitive({
  id: 'cadence.curveGeometry.arc', label: 'Arc', aliases: ['curved line', 'bend', 'circle segment', 'sweep path'],
  summary: 'A circular arc.',
  inputs: [
    n('radius', 'Radius', 1, { min: 0, unit: 'studs' }),
    n('startAngle', 'From', 0, { unit: 'turns' }),
    n('sweep', 'Sweep', 0.25, { unit: 'turns' }),
    resIn('segments', 'Segments', 16, 512),
    mode('plane', 'Plane', ['xz', 'xy', 'yz'], 'xz'),
  ],
  build: (i) => {
    const seg = Math.max(1, Math.round(i.segments));
    const pts = [];
    for (let k = 0; k <= seg; k++) {
      const a = (i.startAngle + (i.sweep * k) / seg) * TAU;
      const u = Math.cos(a) * i.radius, w = Math.sin(a) * i.radius;
      pts.push(i.plane === 'xy' ? [u, w, 0] : i.plane === 'yz' ? [0, u, w] : [u, 0, w]);
    }
    return pts;
  },
});

curvePrimitive({
  id: 'cadence.curveGeometry.helix', label: 'Helix', aliases: ['spiral', 'coil', 'corkscrew', 'spring', 'dna', 'twisting path'],
  summary: 'A spiral winding around an axis.',
  commonUses: ['a spiralling energy trail', 'a coiled beam', 'particles following a corkscrew'],
  inputs: [
    n('radius', 'Radius', 1, { min: 0, unit: 'studs' }),
    n('endRadius', 'End radius', 1, { min: 0, unit: 'studs', description: 'Different from Radius makes it a cone spiral rather than a cylinder.' }),
    n('height', 'Height', 2, { unit: 'studs' }),
    n('turns', 'Turns', 3, { unit: 'turns' }),
    intIn('segments', 'Segments', 64, { min: 2, max: 4096 }),
  ],
  build: (i) => {
    const seg = Math.max(2, Math.round(i.segments));
    const pts = [];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      const a = t * i.turns * TAU;
      const r = i.radius + (i.endRadius - i.radius) * t;
      pts.push([Math.cos(a) * r, i.height * (t - 0.5), Math.sin(a) * r]);
    }
    return pts;
  },
});

node({
  id: 'cadence.curveGeometry.fromPoints', label: 'Curve From Points', category: CU, subcategory: 'Build',
  aliases: ['polyline', 'connect points', 'path from points', 'spline from points', 'trail from points'],
  summary: 'Threads a curve through the points of a geometry, in order.',
  explain: 'The points keep every attribute they had, so a curve built this way can be coloured, sized or timed per point. This is the bridge from "a scatter of points" to "a path" — and with a Point Ring in front of it, to a closed loop.',
  commonUses: ['turning a scatter into a trail', 'building a lightning path from displaced points'],
  exportSupport: 'converted',
  inputs: [geoIn('geometry', 'Points'), boolIn('cyclic', 'Closed loop', false)],
  outputs: [geoOut('Curve')],
  evaluate: (api, i) => {
    if (!GEO.isGeometry(i.geometry) || !GEO.pointCount(i.geometry)) return GEO.newGeometry();
    const g = GEO.cloneGeometry(i.geometry);
    g.faces = null;   // a curve through these points, not a surface over them
    GEO.setCurves(g, [0, GEO.pointCount(g)], [i.cyclic ? 1 : 0]);
    return g;
  },
});

node({
  id: 'cadence.curveGeometry.resample', label: 'Resample Curve', category: CU, subcategory: 'Edit',
  aliases: ['even spacing', 'subdivide curve', 'smooth path', 'more points', 'respace'],
  summary: 'Rebuilds a curve with evenly spaced points.',
  explain: 'Spaces the new points by LENGTH along the curve rather than by control point, so they come out genuinely evenly spaced. That matters for anything you place along a curve — instanced segments spaced by control point bunch up wherever the original points were dense.',
  commonUses: ['evening out a hand-made path before instancing along it', 'adding points so a curve can be displaced smoothly'],
  exportSupport: 'converted', performance: 'moderate',
  inputs: [geoIn('geometry', 'Curve'), intIn('count', 'Points', 32, { min: 2, max: 8192 })],
  outputs: [geoOut('Curve')],
  evaluate: (api, i) => {
    const src = i.geometry;
    if (!GEO.isGeometry(src) || !GEO.curveCount(src)) {
      if (GEO.isGeometry(src) && GEO.pointCount(src)) api.warn('Resample Curve needs a curve — this geometry has points but no curve. Put Curve From Points in front of it.');
      return GEO.newGeometry();
    }
    const count = Math.max(2, Math.round(i.count));
    const positions = [], tangents = [];
    const offsets = [0];
    const cyclic = [];
    for (let c = 0; c < GEO.curveCount(src); c++) {
      const cum = GEO.curveLengths(src, c);
      for (let k = 0; k < count; k++) {
        const s = GEO.sampleCurve(src, c, k / (count - 1), cum);
        positions.push(s.position);
        tangents.push(s.tangent);
      }
      offsets.push(positions.length);
      cyclic.push(src.curves.cyclic[c]);
    }
    const g = cloudFrom(positions, { tangent: tangents });
    GEO.setCurves(g, offsets, cyclic);
    return g;
  },
});

// ---------------------------------------------------------------- transform and deform
node({
  id: 'cadence.geometry.transform', label: 'Transform Geometry', category: C, subcategory: 'Transform',
  aliases: ['move geometry', 'rotate geometry', 'scale geometry', 'place', 'offset shape'],
  summary: 'Moves, rotates and scales a whole geometry.',
  exportSupport: 'native',
  inputs: [
    geoIn(),
    v3('translation', 'Move', [0, 0, 0], { unit: 'studs' }),
    v3('rotation', 'Rotate', [0, 0, 0], { unit: 'degrees' }),
    v3('scale', 'Scale', [1, 1, 1]),
  ],
  outputs: [geoOut()],
  evaluate: (api, i) => {
    if (!GEO.isGeometry(i.geometry)) return GEO.newGeometry();
    const g = GEO.cloneGeometry(i.geometry);
    const r = V.toComponents('vector3', i.rotation).map((d) => (d * Math.PI) / 180);
    const t = V.newTransform(V.toComponents('vector3', i.translation), V.qFromEuler(r[0], r[1], r[2]), V.toComponents('vector3', i.scale));
    const pos = g.points.attrs.position;
    const p = [0, 0, 0];
    for (let k = 0; k < g.points.count; k++) {
      p[0] = pos.data[k * 3]; p[1] = pos.data[k * 3 + 1]; p[2] = pos.data[k * 3 + 2];
      const q = V.transformPoint(t, p);
      pos.data[k * 3] = q[0]; pos.data[k * 3 + 1] = q[1]; pos.data[k * 3 + 2] = q[2];
    }
    // Normals rotate but must not translate or pick up scale — a scaled normal is no longer unit
    // length and shades wrong, which looks like a lighting bug rather than a transform bug.
    if (GEO.hasAttr(g.points, 'normal')) {
      const nrm = g.points.attrs.normal;
      for (let k = 0; k < g.points.count; k++) {
        const nv = V.vNormalize(V.qRotateVector(t.q, [nrm.data[k * 3], nrm.data[k * 3 + 1], nrm.data[k * 3 + 2]]));
        nrm.data[k * 3] = nv[0]; nrm.data[k * 3 + 1] = nv[1]; nrm.data[k * 3 + 2] = nv[2];
      }
    }
    return g;
  },
});

node({
  id: 'cadence.geometry.setPosition', label: 'Set Position', category: C, subcategory: 'Transform',
  aliases: ['move points', 'displace', 'deform', 'offset points', 'warp geometry', 'noise displace'],
  summary: 'Moves every point by a field, or to a position a field gives.',
  teach: 'Pushes each point somewhere else. Feed it noise to make a smooth shape lumpy.',
  explain: 'This one node is the whole of the deformation family: bend, twist, taper, bulge, wave, ripple, melt and noise-displace are all "move each point by a field", and building them from Position, maths and noise means you can build the ones nobody thought to name. Offset mode adds to where the point already is; Absolute mode replaces it.',
  commonUses: ['noise-displacing a sphere into a fireball', 'rippling a plane into water', 'exploding a mesh outwards along its normals'],
  exportSupport: 'baked', performance: 'moderate',
  inputs: [
    geoIn(),
    { key: 'offset', label: 'Offset', type: 'field<vector3>', default: [0, 0, 0], unit: 'studs' },
    mode('space', 'Mode', ['offset', 'absolute'], 'offset'),
    { key: 'selection', label: 'Only where', type: 'field<float>', default: 1, description: 'A mask: 0 leaves a point alone, 1 moves it fully, and values between scale the movement.' },
    boolIn('recalculateNormals', 'Recalculate normals', true),
  ],
  outputs: [geoOut()],
  evaluate: (api, i) => {
    if (!GEO.isGeometry(i.geometry)) return GEO.newGeometry();
    const g = GEO.cloneGeometry(i.geometry);
    const count = g.points.count;
    if (!count) return g;
    const walker = GEO.makeElementContext(g, 'point');
    const pos = g.points.attrs.position;
    const absolute = i.space === 'absolute';
    for (let k = 0; k < count; k++) {
      const ctx = walker.at(k);
      const mask = Number(F.sampleAny(i.selection, ctx));
      if (!(mask > 0)) continue;
      const off = V.toComponents('vector3', F.sampleAny(i.offset, ctx));
      const base = k * 3;
      for (let a = 0; a < 3; a++) {
        const target = absolute ? off[a] : pos.data[base + a] + off[a];
        pos.data[base + a] += (target - pos.data[base + a]) * Math.min(1, mask);
      }
    }
    if (i.recalculateNormals && g.faces) GEO.recalculateNormals(g);
    return g;
  },
});

node({
  id: 'cadence.geometry.capture', label: 'Store Attribute On Geometry', category: C, subcategory: 'Attributes',
  aliases: ['capture attribute', 'bake field', 'freeze field', 'write attribute to points', 'store'],
  summary: 'Evaluates a field at every element and stores the result as a named attribute.',
  explain: 'This is the moment a field stops being a formula and becomes data. Once stored, the value travels with the geometry — so a colour computed from a position that later moves keeps the colour it had where it was born, which is exactly what you want for a dissolve or a fracture.',
  commonUses: ['freezing a noise value per point so it stays put when the point moves', 'writing a per-shard delay before an explosion'],
  exportSupport: 'baked', performance: 'moderate',
  generics: { T: { kinds: V.NUMERIC_KINDS } },
  inputs: [
    geoIn(),
    { key: 'name', label: 'Name', type: 'string', default: 'value', socket: false },
    { key: 'value', label: 'Value', type: 'field<T>', default: 0 },
    mode('domain', 'On', ['point', 'curve', 'face'], 'point'),
  ],
  outputs: [geoOut()],
  evaluate: (api, i) => {
    if (!GEO.isGeometry(i.geometry)) return GEO.newGeometry();
    const name = String(i.name || '').trim();
    if (!name) { api.warn('Store Attribute On Geometry has no name, so nothing was stored.'); return i.geometry; }
    const g = GEO.cloneGeometry(i.geometry);
    const table = GEO.tableFor(g, i.domain);
    if (!table) {
      api.warn(`This geometry has no ${i.domain} elements, so "${name}" was not stored.`);
      return g;
    }
    const comps = V.componentCount(api.typeName('T'));
    const data = GEO.sampleFieldOverDomain(g, i.domain, i.value, comps);
    GEO.ensureAttr(table, name, comps);
    table.attrs[name].data.set(data);
    return g;
  },
});

// ---------------------------------------------------------------- combine and inspect
node({
  id: 'cadence.geometry.join', label: 'Join Geometry', category: C, subcategory: 'Combine',
  aliases: ['merge geometry', 'combine shapes', 'append', 'add together', 'union points'],
  summary: 'Combines several geometries into one.',
  explain: 'Attributes present on only some inputs are filled with zeros on the others, so joining a coloured mesh to a plain one works rather than refusing. Faces and curves keep pointing at the right points — the indices are shifted for you.',
  exportSupport: 'converted',
  inputs: [{ key: 'geometries', label: 'Geometry', type: 'geometry', multi: true }],
  outputs: [geoOut()],
  evaluate: (api, i) => {
    const list = (Array.isArray(i.geometries) ? i.geometries : [i.geometries]).filter(GEO.isGeometry);
    if (!list.length) return GEO.newGeometry();
    return list.reduce((acc, g) => GEO.joinGeometry(acc, g));
  },
});

node({
  id: 'cadence.geometry.info', label: 'Geometry Info', category: C, subcategory: 'Read',
  aliases: ['count points', 'bounds', 'how many', 'size of', 'bounding box', 'statistics'],
  summary: 'How many elements a geometry has and how big it is.',
  explain: 'The node to reach for when an effect renders nothing: a point count of zero says the problem is upstream of the renderer, which is usually the fastest thing to establish.',
  exportSupport: 'native',
  inputs: [geoIn()],
  outputs: [
    { key: 'points', label: 'Points', type: 'int' },
    { key: 'faces', label: 'Faces', type: 'int' },
    { key: 'curves', label: 'Curves', type: 'int' },
    { key: 'center', label: 'Centre', type: 'vector3', unit: 'studs' },
    { key: 'size', label: 'Size', type: 'vector3', unit: 'studs' },
    { key: 'min', label: 'Lowest corner', type: 'vector3', unit: 'studs' },
    { key: 'max', label: 'Highest corner', type: 'vector3', unit: 'studs' },
  ],
  evaluate: (api, i) => {
    const b = GEO.bounds(i.geometry);
    return {
      points: GEO.pointCount(i.geometry),
      faces: GEO.faceCount(i.geometry),
      curves: GEO.curveCount(i.geometry),
      center: b.center, size: b.size, min: b.min, max: b.max,
    };
  },
});

node({
  id: 'cadence.geometry.deletePoints', label: 'Delete Points', category: C, subcategory: 'Combine',
  aliases: ['remove points', 'filter points', 'cull', 'keep only', 'mask points', 'trim'],
  summary: 'Removes the points a mask rejects.',
  explain: 'Deleting points invalidates any faces that used them, so faces are dropped when points are. For a mesh you want to hide rather than dismantle, drive opacity from the mask instead.',
  commonUses: ['keeping only the points inside a shape', 'thinning a dense scatter'],
  exportSupport: 'baked', performance: 'moderate',
  inputs: [
    geoIn(),
    { key: 'keep', label: 'Keep where', type: 'field<bool>', default: true },
  ],
  outputs: [geoOut()],
  evaluate: (api, i) => {
    if (!GEO.isGeometry(i.geometry)) return GEO.newGeometry();
    const g = GEO.cloneGeometry(i.geometry);
    const walker = GEO.makeElementContext(g, 'point');
    const flags = new Uint8Array(g.points.count);
    for (let k = 0; k < g.points.count; k++) flags[k] = F.sampleAny(i.keep, walker.at(k)) ? 1 : 0;
    const removed = g.points.count - flags.reduce((a, v) => a + v, 0);
    if (removed && (g.faces || g.curves)) {
      api.note(`${removed} point${removed === 1 ? '' : 's'} deleted, so the faces and curves that used them were dropped too.`);
      g.faces = null;
      g.curves = null;
    }
    GEO.compactTable(g.points, (k) => flags[k] === 1);
    return g;
  },
});
