// Mesh and curve operations over geometry.js's attribute tables (spec Parts 22, 24, 25 — the
// operations that need CONNECTIVITY, which the primitives and deformers in nodes/geometry.js do not).
//
// The header of nodes/geometry.js explains why these were absent until 2026-09-06: a plausible-looking
// extrude or subdivide built on a bare triangle soup produces cracked normals and duplicated vertices
// that only show up on export. Everything here therefore starts by deriving the connectivity it needs
// from the corner table — edges, the faces around each vertex, the boundary — and works on that. A
// mesh is still "a point table plus a face table"; no half-edge structure is stored on the geometry,
// because attribute tables are the interface (Part 5) and an operation that needs more builds it
// locally in a few milliseconds.
//
// Surfaces from fields use MARCHING TETRAHEDRA rather than marching cubes: six tetrahedra per cell,
// four cases per tetrahedron, no 256-entry lookup table to get subtly wrong, and never an ambiguous
// face. It costs about twice the triangles of marching cubes at the same resolution, which Subdivide
// (smooth) and Smooth Mesh below can tidy, and it is exact about topology, which the table method is
// not. Winding is fixed geometrically (every triangle is oriented away from the inside of its own
// tetrahedron), so the output is consistently outward-facing whatever the sign convention upstream.
//
// Mesh → SDF uses angle-weighted pseudonormals (Bærentzen & Aanæs 2005) for the sign, which is exact
// for closed meshes at vertices and edges where a plain face normal gets the sign wrong — the classic
// "my mesh SDF has needles poking out of every corner" artefact.

import * as V from './values.js';
import * as GEO from './geometry.js';

// ---------------------------------------------------------------- small vector helpers (allocation-light)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => { const l = len(a); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function positionsOf(g) {
  const n = g.points.count, pos = g.points.attrs.position;
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = [pos.data[i * 3], pos.data[i * 3 + 1], pos.data[i * 3 + 2]];
  return out;
}

// Build a geometry from positions + triangles, carrying a per-new-point provenance so every attribute
// column of `src` can be copied or averaged across. `origin[i]` is either an old point index or a pair
// [a, b, t] meaning "interpolate between old points a and b at t".
function buildFrom(src, positions, triangles, origin = null, extraFaceAttrs = null) {
  const g = GEO.pointCloud(positions.length);
  const pos = g.points.attrs.position;
  for (let i = 0; i < positions.length; i++) {
    pos.data[i * 3] = positions[i][0]; pos.data[i * 3 + 1] = positions[i][1]; pos.data[i * 3 + 2] = positions[i][2];
  }
  if (src && origin) {
    for (const name of GEO.attrNames(src.points)) {
      if (name === 'position') continue;
      const col = src.points.attrs[name];
      const c = col.components;
      const dst = GEO.ensureAttr(g.points, name, c);
      for (let i = 0; i < positions.length; i++) {
        const o = origin[i];
        if (Array.isArray(o)) {
          const [a, b, t] = o;
          for (let k = 0; k < c; k++) dst.data[i * c + k] = col.data[a * c + k] + (col.data[b * c + k] - col.data[a * c + k]) * t;
        } else if (o >= 0) {
          for (let k = 0; k < c; k++) dst.data[i * c + k] = col.data[o * c + k];
        }
      }
    }
  }
  if (triangles.length) GEO.setTriangles(g, triangles);
  if (extraFaceAttrs && g.faces) {
    for (const [name, rows] of Object.entries(extraFaceAttrs)) {
      const dst = GEO.ensureAttr(g.faces.table, name, 1);
      for (let i = 0; i < rows.length; i++) dst.data[i] = rows[i];
    }
  }
  if (g.faces) GEO.recalculateNormals(g);
  return g;
}

// ---------------------------------------------------------------- connectivity
const ekey = (a, b, n) => (a < b ? a * n + b : b * n + a);

// Edges (undirected) with the faces on each, plus faces around every vertex.
export function buildAdjacency(g) {
  const n = g.points.count;
  const edges = new Map();          // key -> { a, b, faces: [] }
  const vertexFaces = new Array(n);
  for (let i = 0; i < n; i++) vertexFaces[i] = [];
  const fc = GEO.faceCount(g);
  const corners = g.faces ? g.faces.corners : new Int32Array(0);
  for (let f = 0; f < fc; f++) {
    const a = corners[f * 3], b = corners[f * 3 + 1], c = corners[f * 3 + 2];
    vertexFaces[a].push(f); vertexFaces[b].push(f); vertexFaces[c].push(f);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const k = ekey(p, q, n);
      let e = edges.get(k);
      if (!e) { e = { a: Math.min(p, q), b: Math.max(p, q), faces: [] }; edges.set(k, e); }
      e.faces.push(f);
    }
  }
  return { edges, vertexFaces, n };
}

// Vertex neighbours over edges (mesh) and curve segments.
export function neighbourLists(g) {
  const n = g.points.count;
  const nb = new Array(n);
  for (let i = 0; i < n; i++) nb[i] = new Set();
  if (g.faces) {
    const c = g.faces.corners;
    for (let f = 0; f < GEO.faceCount(g); f++) {
      const a = c[f * 3], b = c[f * 3 + 1], d = c[f * 3 + 2];
      nb[a].add(b); nb[a].add(d); nb[b].add(a); nb[b].add(d); nb[d].add(a); nb[d].add(b);
    }
  }
  if (g.curves) {
    for (let k = 0; k < GEO.curveCount(g); k++) {
      const [from, to] = GEO.curveSpan(g, k);
      for (let i = from; i + 1 < to; i++) { nb[i].add(i + 1); nb[i + 1].add(i); }
      if (g.curves.cyclic[k] && to - from > 2) { nb[from].add(to - 1); nb[to - 1].add(from); }
    }
  }
  return nb.map((s) => [...s]);
}

// Connected components over faces and curve segments. Returns a component id per point.
export function islands(g) {
  const n = g.points.count;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  if (g.faces) {
    const c = g.faces.corners;
    for (let f = 0; f < GEO.faceCount(g); f++) { union(c[f * 3], c[f * 3 + 1]); union(c[f * 3], c[f * 3 + 2]); }
  }
  if (g.curves) {
    for (let k = 0; k < GEO.curveCount(g); k++) {
      const [from, to] = GEO.curveSpan(g, k);
      for (let i = from; i + 1 < to; i++) union(i, i + 1);
    }
  }
  const ids = new Int32Array(n);
  const remap = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let id = remap.get(r);
    if (id === undefined) { id = remap.size; remap.set(r, id); }
    ids[i] = id;
  }
  return { ids, count: remap.size };
}

// ---------------------------------------------------------------- weld / flip / delete / separate / duplicate
// Merge points closer than `tolerance`. Faces are re-pointed; triangles that collapse are dropped.
// Curves are left alone: their spans are contiguous point rows and welding across them would break
// the spans, which the node reports rather than silently doing.
export function weld(g, tolerance = 1e-4) {
  const n = g.points.count;
  if (!n) return GEO.cloneGeometry(g);
  const inv = 1 / Math.max(1e-9, tolerance);
  const rep = new Int32Array(n);
  const keepFlag = new Uint8Array(n);
  const seen = new Map();
  const p = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    GEO.readAttrInto(g.points, 'position', i, p);
    const key = `${Math.round(p[0] * inv)},${Math.round(p[1] * inv)},${Math.round(p[2] * inv)}`;
    const first = seen.get(key);
    if (first === undefined) { seen.set(key, i); rep[i] = i; keepFlag[i] = 1; } else rep[i] = first;
  }
  const newIndex = new Int32Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) if (keepFlag[i]) newIndex[i] = k++;
  const out = GEO.cloneGeometry(g);
  out.curves = null;
  GEO.compactTable(out.points, (i) => keepFlag[i] === 1);
  if (g.faces) {
    const tris = [];
    const c = g.faces.corners;
    for (let f = 0; f < GEO.faceCount(g); f++) {
      const a = newIndex[rep[c[f * 3]]], b = newIndex[rep[c[f * 3 + 1]]], d = newIndex[rep[c[f * 3 + 2]]];
      if (a === b || b === d || a === d) continue;
      tris.push(a, b, d);
    }
    GEO.setTriangles(out, tris);
    GEO.recalculateNormals(out);
  }
  return { geometry: out, merged: n - k };
}

export function flipFaces(g) {
  const out = GEO.cloneGeometry(g);
  if (!out.faces) return out;
  const c = out.faces.corners;
  for (let f = 0; f < GEO.faceCount(out); f++) { const t = c[f * 3 + 1]; c[f * 3 + 1] = c[f * 3 + 2]; c[f * 3 + 2] = t; }
  if (GEO.hasAttr(out.points, 'normal')) { const d = out.points.attrs.normal.data; for (let i = 0; i < d.length; i++) d[i] = -d[i]; }
  return out;
}

// Drop faces the predicate rejects; points stay (a mesh with holes, not a dismantled one).
export function deleteFaces(g, keepFace) {
  const out = GEO.cloneGeometry(g);
  if (!out.faces) return out;
  const fc = GEO.faceCount(g);
  const c = g.faces.corners;
  const tris = [], keptRows = [];
  for (let f = 0; f < fc; f++) if (keepFace(f)) { tris.push(c[f * 3], c[f * 3 + 1], c[f * 3 + 2]); keptRows.push(f); }
  const oldTable = g.faces.table;
  GEO.setTriangles(out, tris);
  for (const name of GEO.attrNames(oldTable)) {
    const col = oldTable.attrs[name];
    const dst = GEO.ensureAttr(out.faces.table, name, col.components);
    for (let i = 0; i < keptRows.length; i++) for (let k = 0; k < col.components; k++) dst.data[i * col.components + k] = col.data[keptRows[i] * col.components + k];
  }
  return out;
}

// Split a geometry in two by a per-point predicate, keeping every face whose corners all fall on one
// side (a face straddling the cut is dropped from both). Curves are cut into runs.
export function separateByPoints(g, keepPoint) {
  const n = g.points.count;
  const flags = new Uint8Array(n);
  for (let i = 0; i < n; i++) flags[i] = keepPoint(i) ? 1 : 0;
  const side = (want) => {
    const out = GEO.cloneGeometry(g);
    const newIndex = new Int32Array(n).fill(-1);
    let k = 0;
    for (let i = 0; i < n; i++) if (flags[i] === want) newIndex[i] = k++;
    if (g.faces) {
      const c = g.faces.corners, tris = [];
      for (let f = 0; f < GEO.faceCount(g); f++) {
        const a = newIndex[c[f * 3]], b = newIndex[c[f * 3 + 1]], d = newIndex[c[f * 3 + 2]];
        if (a >= 0 && b >= 0 && d >= 0) tris.push(a, b, d);
      }
      out.faces = null;
      if (tris.length) GEO.setTriangles(out, tris);
    }
    if (g.curves) {
      const offsets = [0], cyclic = [];
      for (let cI = 0; cI < GEO.curveCount(g); cI++) {
        const [from, to] = GEO.curveSpan(g, cI);
        let run = 0;
        for (let i = from; i <= to; i++) {
          const inside = i < to && flags[i] === want;
          if (inside) run++;
          else if (run) { offsets.push(offsets[offsets.length - 1] + run); cyclic.push(0); run = 0; }
        }
      }
      out.curves = null;
      if (offsets.length > 1) GEO.setCurves(out, offsets, cyclic);
    }
    GEO.compactTable(out.points, (i) => flags[i] === want);
    return out;
  };
  return { selected: side(1), inverted: side(0) };
}

// N copies of the whole geometry, each tagged with a `copy` index on its points.
export function duplicate(g, count) {
  const c = Math.max(1, Math.floor(count));
  let out = null;
  for (let k = 0; k < c; k++) {
    const copy = GEO.cloneGeometry(g);
    const col = GEO.ensureAttr(copy.points, 'copy', 1);
    col.data.fill(k);
    out = out ? GEO.joinGeometry(out, copy) : copy;
  }
  return out || GEO.newGeometry();
}

// ---------------------------------------------------------------- extrude / inset
function faceNormalOf(P, c, f) { return GEO.faceNormal(P[c[f * 3]], P[c[f * 3 + 1]], P[c[f * 3 + 2]]); }

// Extrude the selected faces. Region mode moves the whole selected patch as one and walls its rim;
// individual mode moves each face on its own normal and walls all three of its edges.
export function extrudeFaces(g, selectFace, offsetOf, { individual = false } = {}) {
  if (!g.faces) return { geometry: GEO.cloneGeometry(g), extruded: 0 };
  const P = positionsOf(g);
  const c = g.faces.corners, fc = GEO.faceCount(g), n = g.points.count;
  const positions = P.slice(), origin = P.map((_, i) => i), tris = [];
  const topFlag = [], sideFlag = [];
  const oldTop = [];
  let extruded = 0;
  const selected = new Uint8Array(fc);
  for (let f = 0; f < fc; f++) selected[f] = selectFace(f) ? 1 : 0;

  // faces that stay
  for (let f = 0; f < fc; f++) if (!selected[f]) { tris.push(c[f * 3], c[f * 3 + 1], c[f * 3 + 2]); topFlag.push(0); sideFlag.push(0); oldTop.push(f); }

  const addWall = (a, b, a2, b2, outward) => {
    // two triangles for the quad a→b→b2→a2, oriented so the wall faces `outward`
    const nrm = cross(sub(positions[b], positions[a]), sub(positions[b2], positions[a]));
    if (dot(nrm, outward) >= 0) { tris.push(a, b, b2, a, b2, a2); } else { tris.push(a, b2, b, a, a2, b2); }
    topFlag.push(0, 0); sideFlag.push(1, 1); oldTop.push(-1, -1);
  };

  if (individual) {
    for (let f = 0; f < fc; f++) {
      if (!selected[f]) continue;
      const nrm = faceNormalOf(P, c, f);
      const d = offsetOf(f);
      const ids = [c[f * 3], c[f * 3 + 1], c[f * 3 + 2]];
      const centroid = mul(add(add(P[ids[0]], P[ids[1]]), P[ids[2]]), 1 / 3);
      const fresh = ids.map((i) => { positions.push(add(P[i], mul(nrm, d))); origin.push(i); return positions.length - 1; });
      tris.push(fresh[0], fresh[1], fresh[2]); topFlag.push(1); sideFlag.push(0); oldTop.push(f);
      for (let e = 0; e < 3; e++) {
        const a = ids[e], b = ids[(e + 1) % 3];
        const mid = mul(add(P[a], P[b]), 0.5);
        addWall(a, b, fresh[e], fresh[(e + 1) % 3], sub(mid, centroid));
      }
      extruded++;
    }
  } else {
    // region: one duplicate per point used by any selected face, moved along the selected-face normal
    const used = new Int32Array(n).fill(-1);
    const accN = new Array(n), accD = new Float64Array(n), accW = new Float64Array(n);
    const patchCentroid = [0, 0, 0]; let patchCount = 0;
    for (let f = 0; f < fc; f++) {
      if (!selected[f]) continue;
      const nrm = faceNormalOf(P, c, f), d = offsetOf(f);
      const area = GEO.triangleArea(P[c[f * 3]], P[c[f * 3 + 1]], P[c[f * 3 + 2]]) + 1e-9;
      for (let k = 0; k < 3; k++) {
        const i = c[f * 3 + k];
        if (!accN[i]) accN[i] = [0, 0, 0];
        accN[i] = add(accN[i], mul(nrm, area)); accD[i] += d * area; accW[i] += area;
        patchCentroid[0] += P[i][0]; patchCentroid[1] += P[i][1]; patchCentroid[2] += P[i][2]; patchCount++;
      }
    }
    if (patchCount) { patchCentroid[0] /= patchCount; patchCentroid[1] /= patchCount; patchCentroid[2] /= patchCount; }
    const freshOf = (i) => {
      if (used[i] >= 0) return used[i];
      const nrm = norm(accN[i]), d = accW[i] > 0 ? accD[i] / accW[i] : 0;
      positions.push(add(P[i], mul(nrm, d))); origin.push(i);
      used[i] = positions.length - 1;
      return used[i];
    };
    // directed edge counts among selected faces: an edge seen once is the rim
    const dir = new Map();
    for (let f = 0; f < fc; f++) {
      if (!selected[f]) continue;
      for (let e = 0; e < 3; e++) {
        const a = c[f * 3 + e], b = c[f * 3 + (e + 1) % 3];
        dir.set(ekey(a, b, n), (dir.get(ekey(a, b, n)) || 0) + 1);
      }
    }
    for (let f = 0; f < fc; f++) {
      if (!selected[f]) continue;
      const ids = [c[f * 3], c[f * 3 + 1], c[f * 3 + 2]].map(freshOf);
      tris.push(ids[0], ids[1], ids[2]); topFlag.push(1); sideFlag.push(0); oldTop.push(f);
      for (let e = 0; e < 3; e++) {
        const a = c[f * 3 + e], b = c[f * 3 + (e + 1) % 3];
        if (dir.get(ekey(a, b, n)) !== 1) continue;
        const mid = mul(add(P[a], P[b]), 0.5);
        addWall(a, b, used[a], used[b], sub(mid, patchCentroid));
      }
      extruded++;
    }
  }
  const out = buildFrom(g, positions, tris, origin, { top: topFlag, side: sideFlag });
  copyFaceAttrs(g, out, oldTop);
  return { geometry: out, extruded };
}

function copyFaceAttrs(src, dst, oldOf) {
  if (!src.faces || !dst.faces) return;
  for (const name of GEO.attrNames(src.faces.table)) {
    if (name === 'top' || name === 'side') continue;
    const col = src.faces.table.attrs[name];
    const d = GEO.ensureAttr(dst.faces.table, name, col.components);
    for (let i = 0; i < oldOf.length; i++) {
      const o = oldOf[i]; if (o < 0) continue;
      for (let k = 0; k < col.components; k++) d.data[i * col.components + k] = col.data[o * col.components + k];
    }
  }
}

// Inset every selected face towards its own centre (0..1 of the way), optionally pushing it along its
// normal by `depth`. Each face is treated individually, which is the form that stays valid on a
// triangle mesh without a region-merging step.
export function insetFaces(g, selectFace, amountOf, depthOf) {
  if (!g.faces) return { geometry: GEO.cloneGeometry(g), inset: 0 };
  const P = positionsOf(g);
  const c = g.faces.corners, fc = GEO.faceCount(g);
  const positions = P.slice(), origin = P.map((_, i) => i), tris = [], topFlag = [], sideFlag = [], oldTop = [];
  let count = 0;
  for (let f = 0; f < fc; f++) {
    const ids = [c[f * 3], c[f * 3 + 1], c[f * 3 + 2]];
    if (!selectFace(f)) { tris.push(...ids); topFlag.push(0); sideFlag.push(0); oldTop.push(f); continue; }
    const amount = Math.max(0, Math.min(1, amountOf(f))), depth = depthOf(f);
    const nrm = faceNormalOf(P, c, f);
    const centroid = mul(add(add(P[ids[0]], P[ids[1]]), P[ids[2]]), 1 / 3);
    const fresh = ids.map((i) => {
      const q = add(lerp3(P[i], centroid, amount), mul(nrm, depth));
      positions.push(q); origin.push([i, i, 0]);
      return positions.length - 1;
    });
    tris.push(fresh[0], fresh[1], fresh[2]); topFlag.push(1); sideFlag.push(0); oldTop.push(f);
    for (let e = 0; e < 3; e++) {
      const a = ids[e], b = ids[(e + 1) % 3], a2 = fresh[e], b2 = fresh[(e + 1) % 3];
      // the rim quad keeps the original face's orientation
      tris.push(a, b, b2, a, b2, a2); topFlag.push(0, 0); sideFlag.push(1, 1); oldTop.push(-1, -1);
    }
    count++;
  }
  const out = buildFrom(g, positions, tris, origin, { top: topFlag, side: sideFlag });
  copyFaceAttrs(g, out, oldTop);
  return { geometry: out, inset: count };
}

// ---------------------------------------------------------------- subdivide / smooth
// One level of 1→4 subdivision with shared edge midpoints. With `smooth`, Loop's rules move the old
// and new vertices, which turns a box into something that becomes a sphere-ish blob over levels —
// the mesh equivalent of a smooth curve through control points.
export function subdivideMesh(g, levels = 1, smooth = false) {
  let cur = g;
  const L = Math.max(0, Math.min(6, Math.floor(levels)));
  for (let l = 0; l < L; l++) cur = subdivideOnce(cur, smooth);
  return cur;
}

function subdivideOnce(g, smooth) {
  if (!g.faces) return GEO.cloneGeometry(g);
  const P = positionsOf(g);
  const n = P.length, c = g.faces.corners, fc = GEO.faceCount(g);
  const adj = buildAdjacency(g);
  const positions = P.map((p) => p.slice()), origin = P.map((_, i) => i);
  const midOf = new Map();
  const tris = [];
  const mid = (a, b) => {
    const k = ekey(a, b, n);
    let m = midOf.get(k);
    if (m !== undefined) return m;
    let q;
    const e = adj.edges.get(k);
    if (smooth && e && e.faces.length === 2) {
      // interior edge: 3/8 (a+b) + 1/8 (opposite corners)
      const opp = e.faces.map((f) => [c[f * 3], c[f * 3 + 1], c[f * 3 + 2]].find((v) => v !== a && v !== b));
      q = add(mul(add(P[a], P[b]), 3 / 8), mul(add(P[opp[0]], P[opp[1]]), 1 / 8));
    } else q = mul(add(P[a], P[b]), 0.5);
    positions.push(q); origin.push([a, b, 0.5]);
    m = positions.length - 1; midOf.set(k, m);
    return m;
  };
  for (let f = 0; f < fc; f++) {
    const a = c[f * 3], b = c[f * 3 + 1], d = c[f * 3 + 2];
    const ab = mid(a, b), bd = mid(b, d), da = mid(d, a);
    tris.push(a, ab, da, ab, b, bd, da, bd, d, ab, bd, da);
  }
  if (smooth) {
    // Loop's vertex rule on the ORIGINAL vertices, from the original positions
    const nb = neighbourLists(g);
    for (let i = 0; i < n; i++) {
      const ring = nb[i]; const k = ring.length;
      if (!k) continue;
      // boundary vertex: only its two boundary neighbours count
      const boundaryNb = ring.filter((j) => { const e = adj.edges.get(ekey(i, j, n)); return e && e.faces.length === 1; });
      if (boundaryNb.length === 2) {
        positions[i] = add(mul(P[i], 3 / 4), mul(add(P[boundaryNb[0]], P[boundaryNb[1]]), 1 / 8));
        continue;
      }
      const beta = k === 3 ? 3 / 16 : 3 / (8 * k);
      let sum = [0, 0, 0];
      for (const j of ring) sum = add(sum, P[j]);
      positions[i] = add(mul(P[i], 1 - k * beta), mul(sum, beta));
    }
  }
  const out = buildFrom(g, positions, tris, origin);
  // face attributes: each child inherits its parent's row
  if (g.faces && out.faces) {
    const oldOf = [];
    for (let f = 0; f < fc; f++) oldOf.push(f, f, f, f);
    copyFaceAttrs(g, out, oldOf);
  }
  return out;
}

// Laplacian smoothing: each point moves a fraction of the way towards the mean of its neighbours.
export function smoothMesh(g, iterations = 3, factor = 0.5) {
  const out = GEO.cloneGeometry(g);
  const n = out.points.count;
  if (!n) return out;
  const nb = neighbourLists(out);
  const pos = out.points.attrs.position.data;
  const it = Math.max(0, Math.min(200, Math.floor(iterations)));
  const f = Math.max(0, Math.min(1, factor));
  let cur = Float32Array.from(pos), next = new Float32Array(pos.length);
  for (let s = 0; s < it; s++) {
    for (let i = 0; i < n; i++) {
      const ring = nb[i];
      if (!ring.length) { next[i * 3] = cur[i * 3]; next[i * 3 + 1] = cur[i * 3 + 1]; next[i * 3 + 2] = cur[i * 3 + 2]; continue; }
      let mx = 0, my = 0, mz = 0;
      for (const j of ring) { mx += cur[j * 3]; my += cur[j * 3 + 1]; mz += cur[j * 3 + 2]; }
      mx /= ring.length; my /= ring.length; mz /= ring.length;
      next[i * 3] = cur[i * 3] + (mx - cur[i * 3]) * f;
      next[i * 3 + 1] = cur[i * 3 + 1] + (my - cur[i * 3 + 1]) * f;
      next[i * 3 + 2] = cur[i * 3 + 2] + (mz - cur[i * 3 + 2]) * f;
    }
    const t = cur; cur = next; next = t;
  }
  pos.set(cur);
  if (out.faces) GEO.recalculateNormals(out);
  return out;
}

// ---------------------------------------------------------------- surfaces from fields
// The six tetrahedra of a cube, as indices into its 8 corners (bit order x, y, z), all sharing the
// 0–6 diagonal so neighbouring cubes agree on their shared faces.
const TETS = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];
const CORNER = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];

// Surface of `sample(x, y, z) = iso`, inside where the value is BELOW iso (the SDF convention).
export function marchingTetrahedra(sample, { center = [0, 0, 0], size = [4, 4, 4], resolution = 32, iso = 0 } = {}) {
  const r = Math.max(2, Math.min(160, Math.floor(resolution)));
  const R = r + 1, N = R * R * R;
  const values = new Float32Array(N);
  const origin = [center[0] - size[0] / 2, center[1] - size[1] / 2, center[2] - size[2] / 2];
  const step = [size[0] / r, size[1] / r, size[2] / r];
  const idx = (x, y, z) => (z * R + y) * R + x;
  for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
    values[idx(x, y, z)] = sample(origin[0] + x * step[0], origin[1] + y * step[1], origin[2] + z * step[2]) - iso;
  }
  const positions = [], tris = [];
  const vertOf = new Map();
  const pointOf = (i) => { const z = Math.floor(i / (R * R)), y = Math.floor((i - z * R * R) / R), x = i - z * R * R - y * R; return [origin[0] + x * step[0], origin[1] + y * step[1], origin[2] + z * step[2]]; };
  const edgeVertex = (i, j) => {
    const k = i < j ? i * N + j : j * N + i;
    let v = vertOf.get(k);
    if (v !== undefined) return v;
    const fi = values[i], fj = values[j];
    const t = Math.abs(fj - fi) < 1e-12 ? 0.5 : Math.max(0, Math.min(1, fi / (fi - fj)));
    positions.push(lerp3(pointOf(i), pointOf(j), t));
    v = positions.length - 1; vertOf.set(k, v);
    return v;
  };
  const emit = (a, b, cc, insideCentroid, outsideCentroid) => {
    if (a === b || b === cc || a === cc) return;
    const nrm = cross(sub(positions[b], positions[a]), sub(positions[cc], positions[a]));
    const outward = sub(outsideCentroid, insideCentroid);
    if (dot(nrm, outward) >= 0) tris.push(a, b, cc); else tris.push(a, cc, b);
  };
  const corner = new Int32Array(8);
  for (let z = 0; z < r; z++) for (let y = 0; y < r; y++) for (let x = 0; x < r; x++) {
    for (let k = 0; k < 8; k++) corner[k] = idx(x + CORNER[k][0], y + CORNER[k][1], z + CORNER[k][2]);
    // skip cells with no crossing at all (the common case)
    let anyIn = false, anyOut = false;
    for (let k = 0; k < 8; k++) { if (values[corner[k]] < 0) anyIn = true; else anyOut = true; }
    if (!anyIn || !anyOut) continue;
    for (const tet of TETS) {
      const v = [corner[tet[0]], corner[tet[1]], corner[tet[2]], corner[tet[3]]];
      const inside = [], outside = [];
      for (let k = 0; k < 4; k++) (values[v[k]] < 0 ? inside : outside).push(v[k]);
      if (!inside.length || !outside.length) continue;
      const cen = (list) => { let s = [0, 0, 0]; for (const i of list) s = add(s, pointOf(i)); return mul(s, 1 / list.length); };
      const ci = cen(inside), co = cen(outside);
      if (inside.length === 1) {
        const [i] = inside;
        emit(edgeVertex(i, outside[0]), edgeVertex(i, outside[1]), edgeVertex(i, outside[2]), ci, co);
      } else if (inside.length === 3) {
        const [o] = outside;
        emit(edgeVertex(inside[0], o), edgeVertex(inside[1], o), edgeVertex(inside[2], o), ci, co);
      } else {
        const [i0, i1] = inside, [o0, o1] = outside;
        const a = edgeVertex(i0, o0), b = edgeVertex(i0, o1), cc = edgeVertex(i1, o1), d = edgeVertex(i1, o0);
        emit(a, b, cc, ci, co); emit(a, cc, d, ci, co);
      }
    }
  }
  return buildFrom(null, positions, tris);
}

// ---------------------------------------------------------------- mesh → signed distance
// Closest point on triangle f (flat vertex array) to p (Ericson, Real-Time Collision Detection 5.1.5),
// written on scalars so a query allocates nothing. Writes the point into q and returns the feature it
// lies on: 0/1/2 a vertex, 3/4/5 an edge (ab, bc, ca), 6 the face.
function closestOnTriangleFlat(px, py, pz, f, fa, q) {
  const o = f * 9;
  const ax = fa[o], ay = fa[o + 1], az = fa[o + 2], bx = fa[o + 3], by = fa[o + 4], bz = fa[o + 5], cx = fa[o + 6], cy = fa[o + 7], cz = fa[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { q[0] = ax; q[1] = ay; q[2] = az; return 0; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { q[0] = bx; q[1] = by; q[2] = bz; return 1; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); q[0] = ax + abx * v; q[1] = ay + aby * v; q[2] = az + abz * v; return 3; }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { q[0] = cx; q[1] = cy; q[2] = cz; return 2; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); q[0] = ax + acx * w; q[1] = ay + acy * w; q[2] = az + acz * w; return 5; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); q[0] = bx + (cx - bx) * w; q[1] = by + (cy - by) * w; q[2] = bz + (cz - bz) * w; return 4; }
  const denom = 1 / (va + vb + vc); const v = vb * denom, w = vc * denom;
  q[0] = ax + abx * v + acx * w; q[1] = ay + aby * v + acy * w; q[2] = az + abz * v + acz * w; return 6;
}

// A signed distance evaluator for a triangle mesh. Builds a uniform grid of triangle bins once; each
// query walks outward in shells until the best hit is provably closer than the next shell. No
// allocation per query: flat vertex arrays, a stamp array instead of a visited set, squared distances.
export function meshDistance(g, { cellSize = null } = {}) {
  if (!g.faces || !GEO.faceCount(g)) return { distance: () => 0, nearest: () => null, closed: false, faces: 0 };
  const P = positionsOf(g);
  const c = g.faces.corners, fc = GEO.faceCount(g), n = P.length;
  const adj = buildAdjacency(g);
  const fa = new Float64Array(fc * 9);
  const faceN = new Float64Array(fc * 3);
  const vertN = new Float64Array(n * 3);
  for (let f = 0; f < fc; f++) {
    const a = c[f * 3], b = c[f * 3 + 1], d = c[f * 3 + 2];
    fa.set(P[a], f * 9); fa.set(P[b], f * 9 + 3); fa.set(P[d], f * 9 + 6);
    const nrm = GEO.faceNormal(P[a], P[b], P[d]);
    faceN[f * 3] = nrm[0]; faceN[f * 3 + 1] = nrm[1]; faceN[f * 3 + 2] = nrm[2];
    const ang = (i, j, k) => { const u = norm(sub(P[j], P[i])), v = norm(sub(P[k], P[i])); return Math.acos(Math.max(-1, Math.min(1, dot(u, v)))); };
    const wa = ang(a, b, d), wb = ang(b, d, a), wd = ang(d, a, b);
    for (let k = 0; k < 3; k++) { vertN[a * 3 + k] += nrm[k] * wa; vertN[b * 3 + k] += nrm[k] * wb; vertN[d * 3 + k] += nrm[k] * wd; }
  }
  for (let i = 0; i < n; i++) { const l = Math.hypot(vertN[i * 3], vertN[i * 3 + 1], vertN[i * 3 + 2]) || 1; vertN[i * 3] /= l; vertN[i * 3 + 1] /= l; vertN[i * 3 + 2] /= l; }
  const edgeN = new Map();
  let closed = true;
  for (const [k, e] of adj.edges) {
    let sx = 0, sy = 0, sz = 0;
    for (const f of e.faces) { sx += faceN[f * 3]; sy += faceN[f * 3 + 1]; sz += faceN[f * 3 + 2]; }
    const l = Math.hypot(sx, sy, sz) || 1;
    edgeN.set(k, [sx / l, sy / l, sz / l]);
    if (e.faces.length !== 2) closed = false;
  }
  // bins
  const b = GEO.bounds(g);
  const maxDim = Math.max(b.size[0], b.size[1], b.size[2], 1e-6);
  const cs = cellSize || Math.max(maxDim / 32, 1e-6);
  const dims = [0, 1, 2].map((k) => Math.max(1, Math.ceil(b.size[k] / cs) + 1));
  const bins = new Map();
  const key = (x, y, z) => (z * dims[1] + y) * dims[0] + x;
  for (let f = 0; f < fc; f++) {
    const o = f * 9;
    const lo = [0, 1, 2].map((k) => Math.floor((Math.min(fa[o + k], fa[o + 3 + k], fa[o + 6 + k]) - b.min[k]) / cs));
    const hi = [0, 1, 2].map((k) => Math.floor((Math.max(fa[o + k], fa[o + 3 + k], fa[o + 6 + k]) - b.min[k]) / cs));
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
      const k = key(x, y, z);
      let list = bins.get(k); if (!list) bins.set(k, list = []);
      list.push(f);
    }
  }
  const stamp = new Int32Array(fc); let qid = 0;
  const q = new Float64Array(3), bestQ = new Float64Array(3);
  const maxShell = Math.max(dims[0], dims[1], dims[2]) + 2;
  const nearest = (p) => {
    const px = p[0], py = p[1], pz = p[2];
    const cx = Math.floor((px - b.min[0]) / cs), cy = Math.floor((py - b.min[1]) / cs), cz = Math.floor((pz - b.min[2]) / cs);
    let best = Infinity, bestF = -1, bestFeat = 6;
    qid++;
    for (let s = 0; s <= maxShell; s++) {
      const x0 = cx - s, x1 = cx + s, y0 = cy - s, y1 = cy + s, z0 = cz - s, z1 = cz + s;
      const zs = Math.max(0, z0), ze = Math.min(dims[2] - 1, z1), ys = Math.max(0, y0), ye = Math.min(dims[1] - 1, y1), xs = Math.max(0, x0), xe = Math.min(dims[0] - 1, x1);
      for (let z = zs; z <= ze; z++) for (let y = ys; y <= ye; y++) for (let x = xs; x <= xe; x++) {
        if (x !== x0 && x !== x1 && y !== y0 && y !== y1 && z !== z0 && z !== z1) continue;
        const list = bins.get(key(x, y, z));
        if (!list) continue;
        for (let li = 0; li < list.length; li++) {
          const f = list[li];
          if (stamp[f] === qid) continue; stamp[f] = qid;
          const feat = closestOnTriangleFlat(px, py, pz, f, fa, q);
          const dx = px - q[0], dy = py - q[1], dz = pz - q[2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < best) { best = d2; bestF = f; bestFeat = feat; bestQ[0] = q[0]; bestQ[1] = q[1]; bestQ[2] = q[2]; }
        }
      }
      // every unvisited cell in shell s+1 is at least s*cs away from p (p lies inside its own cell)
      if (best <= (s * cs) * (s * cs)) break;
      if (x0 <= 0 && y0 <= 0 && z0 <= 0 && x1 >= dims[0] - 1 && y1 >= dims[1] - 1 && z1 >= dims[2] - 1) break;
    }
    if (bestF < 0) return null;
    const f = bestF, a = c[f * 3], bb = c[f * 3 + 1], d = c[f * 3 + 2];
    let nx, ny, nz;
    if (bestFeat === 6) { nx = faceN[f * 3]; ny = faceN[f * 3 + 1]; nz = faceN[f * 3 + 2]; }
    else if (bestFeat < 3) { const vi = bestFeat === 0 ? a : bestFeat === 1 ? bb : d; nx = vertN[vi * 3]; ny = vertN[vi * 3 + 1]; nz = vertN[vi * 3 + 2]; }
    else { const e = edgeN.get(bestFeat === 3 ? ekey(a, bb, n) : bestFeat === 4 ? ekey(bb, d, n) : ekey(d, a, n)) || [faceN[f * 3], faceN[f * 3 + 1], faceN[f * 3 + 2]]; nx = e[0]; ny = e[1]; nz = e[2]; }
    const dist = Math.sqrt(best);
    const sign = (px - bestQ[0]) * nx + (py - bestQ[1]) * ny + (pz - bestQ[2]) * nz < 0 ? -1 : 1;
    return { distance: dist * sign, point: [bestQ[0], bestQ[1], bestQ[2]], face: bestF, normal: [nx, ny, nz] };
  };
  return { distance: (p) => { const r = nearest(p); return r ? r.distance : 0; }, nearest, closed, faces: fc };
}
// ---------------------------------------------------------------- curves
// Rotation-minimising frames along a polyline by parallel transport. Returns { tangent, normal,
// binormal } per point; a twist-free tube needs exactly this and not a Frenet frame, which flips at
// every inflection.
export function curveFrames(points, cyclic = false) {
  const n = points.length;
  const T = new Array(n), Nn = new Array(n), B = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = points[i > 0 ? i - 1 : (cyclic ? n - 1 : 0)], next = points[i < n - 1 ? i + 1 : (cyclic ? 0 : n - 1)];
    let t = norm(sub(next, prev));
    if (len(t) < 1e-9) t = i > 0 ? T[i - 1] : [0, 1, 0];
    T[i] = t;
  }
  // initial normal: any vector perpendicular to the first tangent
  const t0 = T[0];
  let ref = Math.abs(t0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  Nn[0] = norm(cross(cross(t0, ref), t0));
  B[0] = cross(t0, Nn[0]);
  for (let i = 1; i < n; i++) {
    const a = T[i - 1], b = T[i];
    const axis = cross(a, b), s = len(axis), cth = dot(a, b);
    let nrm = Nn[i - 1];
    if (s > 1e-9) {
      // rotate the previous normal by the rotation taking a to b (Rodrigues)
      const k = mul(axis, 1 / s), th = Math.atan2(s, cth);
      const cosT = Math.cos(th), sinT = Math.sin(th);
      nrm = add(add(mul(nrm, cosT), mul(cross(k, nrm), sinT)), mul(k, dot(k, nrm) * (1 - cosT)));
    }
    Nn[i] = norm(sub(nrm, mul(b, dot(nrm, b))));
    B[i] = cross(b, Nn[i]);
  }
  return { tangent: T, normal: Nn, binormal: B };
}

// Sweep a profile (a circle of `segments` points, or the XY points of a profile geometry) along every
// curve of `curve`. `radiusAt(pointIndex)` scales the profile per curve point. Caps close open tubes.
export function curveToMesh(curve, { radiusAt = () => 0.2, segments = 12, profile = null, caps = true } = {}) {
  if (!curve.curves || !GEO.curveCount(curve)) return GEO.newGeometry();
  const prof = [];
  let profClosed = true;
  if (profile && GEO.isGeometry(profile) && GEO.pointCount(profile) >= 2) {
    const pp = positionsOf(profile);
    for (const p of pp) prof.push([p[0], p[1]]);
    profClosed = profile.curves ? !!profile.curves.cyclic[0] : true;
  } else {
    const s = Math.max(3, Math.min(256, Math.floor(segments)));
    for (let j = 0; j < s; j++) { const a = (j / s) * Math.PI * 2; prof.push([Math.cos(a), Math.sin(a)]); }
  }
  const m = prof.length;
  const positions = [], uvs = [], tris = [], origin = [];
  const P = positionsOf(curve);
  for (let cI = 0; cI < GEO.curveCount(curve); cI++) {
    const [from, to] = GEO.curveSpan(curve, cI);
    const n = to - from;
    if (n < 2) continue;
    const cyclic = !!curve.curves.cyclic[cI];
    const pts = []; for (let i = from; i < to; i++) pts.push(P[i]);
    const fr = curveFrames(pts, cyclic);
    const cum = GEO.curveLengths(curve, cI); const total = cum[cum.length - 1] || 1;
    const base = positions.length;
    for (let i = 0; i < n; i++) {
      const r = radiusAt(from + i);
      const u = cum[Math.min(i, cum.length - 1)] / total;
      for (let j = 0; j < m; j++) {
        const q = add(pts[i], add(mul(fr.normal[i], prof[j][0] * r), mul(fr.binormal[i], prof[j][1] * r)));
        positions.push(q); origin.push(from + i); uvs.push([u, j / m]);
      }
    }
    const rings = n, ringPairs = cyclic ? n : n - 1;
    for (let i = 0; i < ringPairs; i++) {
      const r0 = base + i * m, r1 = base + ((i + 1) % rings) * m;
      const segs = profClosed ? m : m - 1;
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % m;
        const a = r0 + j, b = r0 + j1, cc = r1 + j, d = r1 + j1;
        tris.push(a, cc, b, b, cc, d);
      }
    }
    if (caps && !cyclic && profClosed) {
      // fan caps: a centre point at each end
      for (const [ring, flip] of [[0, true], [n - 1, false]]) {
        positions.push(pts[ring]); origin.push(from + ring); uvs.push([ring === 0 ? 0 : 1, 0.5]);
        const centre = positions.length - 1, r0 = base + ring * m;
        for (let j = 0; j < m; j++) {
          const a = r0 + j, b = r0 + ((j + 1) % m);
          if (flip) tris.push(centre, b, a); else tris.push(centre, a, b);
        }
      }
    }
  }
  const g = buildFrom(curve, positions, tris, origin);
  const uv = GEO.ensureAttr(g.points, 'uv', 2);
  for (let i = 0; i < uvs.length; i++) { uv.data[i * 2] = uvs[i][0]; uv.data[i * 2 + 1] = uvs[i][1]; }
  return g;
}

// Newell's method: the plane normal of a polygon that may not be perfectly flat.
function polygonNormal(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return norm([nx, ny, nz]);
}

// Ear clipping of one simple polygon, given as indices into `positions`. Returns triangles wound
// with the polygon's own normal.
function earClip(indices, positions) {
  const pts = indices.map((i) => positions[i]);
  const nrm = polygonNormal(pts);
  if (len(nrm) < 1e-9 || pts.length < 3) return [];
  // 2D basis in the polygon's plane
  const u = norm(cross(nrm, Math.abs(nrm[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const v = cross(nrm, u);
  const p2 = pts.map((p) => [dot(p, u), dot(p, v)]);
  let ring = indices.map((_, k) => k);
  // ensure counter-clockwise in 2D
  let area = 0;
  for (let i = 0; i < p2.length; i++) { const a = p2[i], b = p2[(i + 1) % p2.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) ring.reverse();
  const tris = [];
  const crossZ = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inTri = (p, a, b, c) => crossZ(a, b, p) >= -1e-12 && crossZ(b, c, p) >= -1e-12 && crossZ(c, a, p) >= -1e-12;
  let guard = 0;
  while (ring.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < ring.length; i++) {
      const i0 = ring[(i + ring.length - 1) % ring.length], i1 = ring[i], i2 = ring[(i + 1) % ring.length];
      const a = p2[i0], b = p2[i1], c = p2[i2];
      if (crossZ(a, b, c) <= 1e-12) continue;   // reflex or degenerate
      let ok = true;
      for (const k of ring) { if (k === i0 || k === i1 || k === i2) continue; if (inTri(p2[k], a, b, c)) { ok = false; break; } }
      if (!ok) continue;
      tris.push(indices[i0], indices[i1], indices[i2]);
      ring.splice(i, 1); clipped = true; break;
    }
    if (!clipped) { // fall back: fan the remainder (self-intersecting input)
      for (let i = 1; i + 1 < ring.length; i++) tris.push(indices[ring[0]], indices[ring[i]], indices[ring[i + 1]]);
      ring = [];
      break;
    }
  }
  if (ring.length === 3) tris.push(indices[ring[0]], indices[ring[1]], indices[ring[2]]);
  return tris;
}

// Fill every curve with a flat face (ear clipping in each curve's own plane). Holes are not
// recognised — each curve becomes its own filled shape.
export function fillCurves(curve) {
  if (!curve.curves || !GEO.curveCount(curve)) return GEO.newGeometry();
  const P = positionsOf(curve);
  const tris = [];
  for (let cI = 0; cI < GEO.curveCount(curve); cI++) {
    const [from, to] = GEO.curveSpan(curve, cI);
    if (to - from < 3) continue;
    const idx = []; for (let i = from; i < to; i++) idx.push(i);
    // drop a duplicated closing point
    if (len(sub(P[idx[0]], P[idx[idx.length - 1]])) < 1e-6 && idx.length > 3) idx.pop();
    tris.push(...earClip(idx, P));
  }
  const out = GEO.cloneGeometry(curve);
  out.curves = null;
  out.faces = null;
  if (tris.length) { GEO.setTriangles(out, tris); GEO.recalculateNormals(out); }
  return out;
}

// Keep the part of each curve between two length fractions.
export function trimCurves(curve, start = 0, end = 1) {
  if (!curve.curves || !GEO.curveCount(curve)) return GEO.newGeometry();
  const s0 = Math.max(0, Math.min(1, Math.min(start, end))), s1 = Math.max(0, Math.min(1, Math.max(start, end)));
  const positions = [], origin = [], offsets = [0], cyclic = [];
  for (let cI = 0; cI < GEO.curveCount(curve); cI++) {
    const [from, to] = GEO.curveSpan(curve, cI);
    const n = to - from;
    if (n < 2) continue;
    const cum = GEO.curveLengths(curve, cI); const total = cum[cum.length - 1];
    if (!(total > 0)) continue;
    const a = GEO.sampleCurve(curve, cI, s0, cum), b = GEO.sampleCurve(curve, cI, s1, cum);
    positions.push(a.position); origin.push([from + a.segment, from + ((a.segment + 1) % n), 0.5]);
    for (let s = 0; s < cum.length; s++) {
      const L = cum[s] / total;
      if (L > s0 + 1e-9 && L < s1 - 1e-9) { const i = from + (s % n); positions.push(positions.length ? [...pointAt(curve, i)] : pointAt(curve, i)); origin.push(i); }
    }
    positions.push(b.position); origin.push([from + b.segment, from + ((b.segment + 1) % n), 0.5]);
    offsets.push(positions.length); cyclic.push(0);
  }
  const g = buildFrom(curve, positions, [], origin);
  if (offsets.length > 1) GEO.setCurves(g, offsets, cyclic);
  return g;
}

function pointAt(g, i) { const p = [0, 0, 0]; GEO.readAttrInto(g.points, 'position', i, p); return p; }

// Round every interior corner of every curve with a circular arc of `radius` (shortened where the
// neighbouring segments are too short), `segments` points per arc.
export function filletCurves(curve, radius = 0.25, segments = 4) {
  if (!curve.curves || !GEO.curveCount(curve)) return GEO.newGeometry();
  const P = positionsOf(curve);
  const positions = [], origin = [], offsets = [0], cyclic = [];
  const segs = Math.max(1, Math.min(64, Math.floor(segments)));
  for (let cI = 0; cI < GEO.curveCount(curve); cI++) {
    const [from, to] = GEO.curveSpan(curve, cI);
    const n = to - from;
    const cyc = !!curve.curves.cyclic[cI];
    if (n < 3) { for (let i = from; i < to; i++) { positions.push(P[i]); origin.push(i); } offsets.push(positions.length); cyclic.push(cyc ? 1 : 0); continue; }
    const first = cyc ? 0 : 1, last = cyc ? n - 1 : n - 2;
    if (!cyc) { positions.push(P[from]); origin.push(from); }
    for (let k = first; k <= last; k++) {
      const i = from + k, prev = from + ((k - 1 + n) % n), next = from + ((k + 1) % n);
      const Pp = P[i], A = P[prev], C = P[next];
      const u1 = norm(sub(A, Pp)), u2 = norm(sub(C, Pp));
      const cosT = Math.max(-1, Math.min(1, dot(u1, u2)));
      const theta = Math.acos(cosT);
      if (theta < 1e-4 || Math.PI - theta < 1e-4 || radius <= 0) { positions.push(Pp); origin.push(i); continue; }
      const half = theta / 2;
      let t = radius / Math.tan(half);
      const maxT = Math.min(len(sub(A, Pp)), len(sub(C, Pp))) * 0.5;
      if (t > maxT) t = maxT;
      const r = t * Math.tan(half);
      const p1 = add(Pp, mul(u1, t)), p2 = add(Pp, mul(u2, t));
      const bis = norm(add(u1, u2));
      const centre = add(Pp, mul(bis, r / Math.sin(half)));
      const v1 = sub(p1, centre), v2 = sub(p2, centre);
      const axis = norm(cross(v1, v2));
      const phi = Math.acos(Math.max(-1, Math.min(1, dot(norm(v1), norm(v2)))));
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * phi;
        const ca = Math.cos(a), sa = Math.sin(a);
        const v = add(add(mul(v1, ca), mul(cross(axis, v1), sa)), mul(axis, dot(axis, v1) * (1 - ca)));
        positions.push(add(centre, v)); origin.push(i);
      }
    }
    if (!cyc) { positions.push(P[to - 1]); origin.push(to - 1); }
    offsets.push(positions.length); cyclic.push(cyc ? 1 : 0);
  }
  const g = buildFrom(curve, positions, [], origin);
  GEO.setCurves(g, offsets, cyclic);
  return g;
}

export function bezierPoints(p0, p1, p2, p3, segments = 32) {
  const s = Math.max(1, Math.min(4096, Math.floor(segments)));
  const pts = [];
  for (let k = 0; k <= s; k++) {
    const t = k / s, mt = 1 - t;
    const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    pts.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1], a * p0[2] + b * p1[2] + c * p2[2] + d * p3[2]]);
  }
  return pts;
}

export function curveTotalLength(g, cI) {
  const cum = GEO.curveLengths(g, cI);
  return cum[cum.length - 1] || 0;
}

// ---------------------------------------------------------------- icosphere
export function icosphere(radius = 1, subdivisions = 2) {
  const t = (1 + Math.sqrt(5)) / 2;
  let positions = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  let tris = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  const S = Math.max(0, Math.min(6, Math.floor(subdivisions)));
  for (let s = 0; s < S; s++) {
    const cache = new Map();
    const n = positions.length;
    const mid = (a, b) => {
      const k = ekey(a, b, n * 8);
      let m = cache.get(k); if (m !== undefined) return m;
      positions.push(norm(mul(add(positions[a], positions[b]), 0.5)));
      m = positions.length - 1; cache.set(k, m); return m;
    };
    const next = [];
    for (let f = 0; f < tris.length; f += 3) {
      const a = tris[f], b = tris[f + 1], c = tris[f + 2];
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    tris = next;
  }
  const r = Math.max(0, radius);
  const g = buildFrom(null, positions.map((p) => mul(p, r)), tris);
  const uv = GEO.ensureAttr(g.points, 'uv', 2);
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    uv.data[i * 2] = 0.5 + Math.atan2(p[2], p[0]) / (2 * Math.PI);
    uv.data[i * 2 + 1] = 0.5 + Math.asin(Math.max(-1, Math.min(1, p[1]))) / Math.PI;
  }
  return g;
}

// ---------------------------------------------------------------- statistics
export function statistics(data, components = 1) {
  const count = Math.floor(data.length / components);
  const out = { count, min: [], max: [], mean: [], median: [], sum: [], std: [], range: [] };
  for (let k = 0; k < components; k++) {
    const vals = new Float64Array(count);
    for (let i = 0; i < count; i++) vals[i] = data[i * components + k];
    let sum = 0, min = Infinity, max = -Infinity;
    for (const v of vals) { sum += v; if (v < min) min = v; if (v > max) max = v; }
    const mean = count ? sum / count : 0;
    let sq = 0; for (const v of vals) sq += (v - mean) * (v - mean);
    const sorted = Float64Array.from(vals).sort();
    const median = count ? (count % 2 ? sorted[(count - 1) / 2] : (sorted[count / 2 - 1] + sorted[count / 2]) / 2) : 0;
    out.min.push(count ? min : 0); out.max.push(count ? max : 0); out.mean.push(mean); out.median.push(median);
    out.sum.push(sum); out.std.push(count ? Math.sqrt(sq / count) : 0); out.range.push(count ? max - min : 0);
  }
  return out;
}

export { positionsOf };
