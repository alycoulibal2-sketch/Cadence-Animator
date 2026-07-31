// PNX geometry: the data model for points, curves and meshes (spec Parts 21-24), and the attribute
// tables they are built out of.
//
// ONE IDEA, APPLIED THREE TIMES. A geometry is a small set of DOMAINS, and every domain is a table
// of named attribute columns over a count of elements:
//
//   points   position, and anything else — this is also what a particle set is
//   curves   one row per curve, plus a span of point rows it owns
//   faces    one row per face, plus a span of corner indices into the point rows
//
// Nothing here is a class hierarchy of shapes. A sphere is not a Sphere; it is a point table plus a
// face table. That is what makes Part 23's sampling operations work on *anything*: "points on
// surface" needs a face table, not a knowledge of what shape produced it.
//
// STORAGE. Each attribute column is a flat Float32Array plus a component count:
//
//   { components: 3, data: Float32Array(count * 3) }
//
// Flat and typed rather than an array of [x,y,z] arrays, for three reasons that all matter at the
// scale VFX works at: a 50 000-point cloud is one allocation rather than 50 001, sampling walks
// memory in order, and the buffers hand off to three.js and to a bake without a conversion pass.
// The cost is that reading a vector allocates a small array — so the hot paths below all offer a
// `readInto` form that writes into a caller's scratch array instead.
//
// ATTRIBUTES ARE THE INTERFACE, not a feature (Part 5). The engine stores `temperature`, `fuel`,
// `magicStrength` without knowing what any of them mean; a node that needs `position` asks for it by
// name exactly like a node that needs a user's invented attribute. There is no privileged column.

import * as V from './values.js';
import * as F from './fields.js';

export const DOMAINS = ['point', 'curve', 'face', 'instance'];

// ---------------------------------------------------------------- attribute tables
export function newTable(count = 0) {
  return { count: Math.max(0, Math.floor(count)), attrs: Object.create(null) };
}

// Component count for a value kind, used when a node creates an attribute from a typed socket.
export function componentsFor(typeName) {
  return V.componentCount(typeName);
}

export function hasAttr(table, name) {
  return !!table && name in table.attrs;
}

export function attrNames(table) {
  return table ? Object.keys(table.attrs) : [];
}

// Create (or resize) an attribute column. `fill` seeds every element; passing an array fills
// component-wise. Creating an attribute that already exists with the same width is a no-op, so
// "ensure this exists" is the natural way to call it.
export function ensureAttr(table, name, components = 1, fill = 0) {
  const c = Math.max(1, Math.floor(components));
  const existing = table.attrs[name];
  if (existing && existing.components === c && existing.data.length === table.count * c) return existing;
  const data = new Float32Array(table.count * c);
  if (fill !== 0 || Array.isArray(fill)) {
    const f = Array.isArray(fill) ? fill : new Array(c).fill(fill);
    for (let i = 0; i < table.count; i++) {
      for (let k = 0; k < c; k++) data[i * c + k] = Number(f[k]) || 0;
    }
  }
  // Preserve what fits when a column is being widened rather than created.
  if (existing) {
    const keep = Math.min(existing.components, c);
    const n = Math.min(existing.data.length / existing.components, table.count);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < keep; k++) data[i * c + k] = existing.data[i * existing.components + k];
    }
  }
  table.attrs[name] = { components: c, data };
  return table.attrs[name];
}

export function removeAttr(table, name) {
  delete table.attrs[name];
}

export function renameAttr(table, from, to) {
  if (!hasAttr(table, from) || from === to) return;
  table.attrs[to] = table.attrs[from];
  delete table.attrs[from];
}

// Read one element's value. Returns a number for a 1-component column and a fresh array otherwise.
export function readAttr(table, name, index, fallback = 0) {
  const col = table?.attrs?.[name];
  if (!col || index < 0 || index >= table.count) return fallback;
  const c = col.components;
  if (c === 1) return col.data[index];
  const out = new Array(c);
  for (let k = 0; k < c; k++) out[k] = col.data[index * c + k];
  return out;
}

// The allocation-free form, for the per-element loops. Returns `into`.
export function readAttrInto(table, name, index, into) {
  const col = table?.attrs?.[name];
  if (!col) { into.fill(0); return into; }
  const c = Math.min(col.components, into.length);
  const base = index * col.components;
  for (let k = 0; k < c; k++) into[k] = col.data[base + k];
  for (let k = c; k < into.length; k++) into[k] = 0;
  return into;
}

export function writeAttr(table, name, index, value) {
  const col = table?.attrs?.[name];
  if (!col || index < 0 || index >= table.count) return;
  const c = col.components;
  const base = index * c;
  if (c === 1) {
    col.data[base] = typeof value === 'boolean' ? (value ? 1 : 0) : (Number(Array.isArray(value) ? value[0] : value) || 0);
    return;
  }
  for (let k = 0; k < c; k++) col.data[base + k] = Number(Array.isArray(value) ? value[k] : value) || 0;
}

// Grow a table, preserving every column. Used by spawning: a burst appends rows.
export function resizeTable(table, count) {
  const next = Math.max(0, Math.floor(count));
  if (next === table.count) return table;
  const old = table.count;
  table.count = next;
  for (const [name, col] of Object.entries(table.attrs)) {
    const data = new Float32Array(next * col.components);
    data.set(col.data.subarray(0, Math.min(old, next) * col.components));
    table.attrs[name] = { components: col.components, data };
  }
  return table;
}

// Keep only the elements `keep(i)` accepts, compacting in place order. Returns the surviving count.
// This is how particles die and how a selection becomes geometry, and it is stable: survivors stay in
// their original relative order, so anything that indexed by "the nth of these" stays meaningful.
export function compactTable(table, keep) {
  let w = 0;
  const cols = Object.values(table.attrs);
  for (let r = 0; r < table.count; r++) {
    if (!keep(r)) continue;
    if (w !== r) {
      for (const col of cols) {
        const c = col.components;
        for (let k = 0; k < c; k++) col.data[w * c + k] = col.data[r * c + k];
      }
    }
    w++;
  }
  const before = table.count;
  table.count = w;
  if (before !== w) {
    // A fresh buffer, not a subarray VIEW. A view would keep the whole original allocation alive —
    // compacting 100 000 dead particles down to 100 would free nothing at all, which is the kind of
    // leak that only shows up as a session that gets slower the longer it runs.
    for (const [name, col] of Object.entries(table.attrs)) {
      table.attrs[name] = { components: col.components, data: col.data.slice(0, w * col.components) };
    }
  }
  return w;
}

export function cloneTable(table) {
  const out = newTable(table.count);
  for (const [name, col] of Object.entries(table.attrs)) {
    out.attrs[name] = { components: col.components, data: new Float32Array(col.data) };
  }
  return out;
}

// Append `src`'s rows onto `dst`. Columns present in only one side are filled with zeros on the
// other, which is the only sane merge: refusing to join two point clouds because one carries an extra
// attribute would make Join Geometry almost useless.
export function appendTable(dst, src) {
  const at = dst.count;
  const names = new Set([...attrNames(dst), ...attrNames(src)]);
  resizeTable(dst, dst.count + src.count);
  for (const name of names) {
    const s = src.attrs[name];
    const comps = s ? s.components : dst.attrs[name].components;
    ensureAttr(dst, name, comps);
    if (!s) continue;
    const d = dst.attrs[name];
    const c = Math.min(d.components, s.components);
    for (let i = 0; i < src.count; i++) {
      for (let k = 0; k < c; k++) d.data[(at + i) * d.components + k] = s.data[i * s.components + k];
    }
  }
  return dst;
}

// ---------------------------------------------------------------- geometry
export function newGeometry() {
  return {
    __geometry: true,
    points: newTable(0),
    curves: null,     // { table, offsets: Int32Array(count+1), cyclic: Uint8Array(count) }
    faces: null,      // { table, corners: Int32Array, offsets: Int32Array(count+1) }
  };
}

export const isGeometry = (g) => !!g && g.__geometry === true;

export function pointCloud(count) {
  const g = newGeometry();
  g.points = newTable(count);
  ensureAttr(g.points, 'position', 3);
  return g;
}

// Attach a face table built from triangle corner indices. Triangles are the only primitive stored,
// because every consumer (sampling, rendering, raycast) needs them triangulated anyway and keeping
// n-gons would mean triangulating repeatedly at every use.
export function setTriangles(g, indices) {
  const tri = Math.floor(indices.length / 3);
  const corners = indices instanceof Int32Array ? indices : Int32Array.from(indices);
  const offsets = new Int32Array(tri + 1);
  for (let i = 0; i <= tri; i++) offsets[i] = i * 3;
  g.faces = { table: newTable(tri), corners, offsets };
  return g.faces;
}

// Attach a curve table. `offsets` has count+1 entries delimiting each curve's span of point rows.
export function setCurves(g, offsets, cyclic = null) {
  const off = offsets instanceof Int32Array ? offsets : Int32Array.from(offsets);
  const count = Math.max(0, off.length - 1);
  g.curves = {
    table: newTable(count),
    offsets: off,
    cyclic: cyclic ? (cyclic instanceof Uint8Array ? cyclic : Uint8Array.from(cyclic)) : new Uint8Array(count),
  };
  return g.curves;
}

export function pointCount(g) {
  return isGeometry(g) ? g.points.count : 0;
}
export function faceCount(g) {
  return isGeometry(g) && g.faces ? g.faces.table.count : 0;
}
export function curveCount(g) {
  return isGeometry(g) && g.curves ? g.curves.table.count : 0;
}

export function tableFor(g, domain) {
  if (!isGeometry(g)) return null;
  switch (domain) {
    case 'point': return g.points;
    case 'curve': return g.curves ? g.curves.table : null;
    case 'face': return g.faces ? g.faces.table : null;
    default: return null;
  }
}

export function cloneGeometry(g) {
  if (!isGeometry(g)) return newGeometry();
  const out = newGeometry();
  out.points = cloneTable(g.points);
  if (g.faces) out.faces = { table: cloneTable(g.faces.table), corners: new Int32Array(g.faces.corners), offsets: new Int32Array(g.faces.offsets) };
  if (g.curves) out.curves = { table: cloneTable(g.curves.table), offsets: new Int32Array(g.curves.offsets), cyclic: new Uint8Array(g.curves.cyclic) };
  return out;
}

// Join two geometries into one. Face and curve indices in `b` are shifted by `a`'s point count —
// getting that shift wrong is the classic geometry-merge bug and produces a mesh whose triangles all
// reference the first object.
export function joinGeometry(a, b) {
  if (!isGeometry(a)) return cloneGeometry(b);
  if (!isGeometry(b)) return cloneGeometry(a);
  const out = cloneGeometry(a);
  const shift = out.points.count;
  appendTable(out.points, b.points);

  if (b.faces) {
    const shifted = Int32Array.from(b.faces.corners, (c) => c + shift);
    if (!out.faces) {
      out.faces = { table: cloneTable(b.faces.table), corners: shifted, offsets: new Int32Array(b.faces.offsets) };
    } else {
      const baseCorners = out.faces.corners.length;
      const corners = new Int32Array(baseCorners + shifted.length);
      corners.set(out.faces.corners); corners.set(shifted, baseCorners);
      const offsets = new Int32Array(out.faces.offsets.length + b.faces.offsets.length - 1);
      offsets.set(out.faces.offsets);
      for (let i = 1; i < b.faces.offsets.length; i++) offsets[out.faces.offsets.length - 1 + i] = baseCorners + b.faces.offsets[i];
      appendTable(out.faces.table, b.faces.table);
      out.faces.corners = corners;
      out.faces.offsets = offsets;
    }
  }

  if (b.curves) {
    if (!out.curves) {
      out.curves = { table: cloneTable(b.curves.table), offsets: Int32Array.from(b.curves.offsets, (o) => o + shift), cyclic: new Uint8Array(b.curves.cyclic) };
    } else {
      const prev = out.curves.offsets;
      const offsets = new Int32Array(prev.length + b.curves.offsets.length - 1);
      offsets.set(prev);
      for (let i = 1; i < b.curves.offsets.length; i++) offsets[prev.length - 1 + i] = b.curves.offsets[i] + shift;
      const cyclic = new Uint8Array(out.curves.cyclic.length + b.curves.cyclic.length);
      cyclic.set(out.curves.cyclic); cyclic.set(b.curves.cyclic, out.curves.cyclic.length);
      appendTable(out.curves.table, b.curves.table);
      out.curves.offsets = offsets;
      out.curves.cyclic = cyclic;
    }
  }
  return out;
}

// ---------------------------------------------------------------- bounds
export function bounds(g) {
  const t = isGeometry(g) ? g.points : null;
  const pos = t?.attrs?.position;
  if (!pos || !t.count) return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], size: [0, 0, 0], empty: true };
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const c = pos.components;
  for (let i = 0; i < t.count; i++) {
    for (let k = 0; k < 3; k++) {
      const v = c > k ? pos.data[i * c + k] : 0;
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return {
    min, max,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    empty: false,
  };
}

// ---------------------------------------------------------------- element sample contexts
// The bridge between geometry and fields: an element becomes a sample context, so every field in the
// engine can be evaluated per point / per face / per curve without knowing what a geometry is.
//
// `scratch` is reused across the whole loop deliberately. Allocating a fresh context per element is
// what turns a 100 000-point evaluation from milliseconds into seconds, and because a field's
// sample() is documented as not retaining the context, reuse is safe — the one exception being the
// spatial helpers in fields.js, which clone rather than mutate for exactly this reason.
export function makeElementContext(g, domain, base = {}) {
  const table = tableFor(g, domain);
  const ctx = F.newSampleContext({ ...base });
  const attributes = Object.create(null);
  ctx.attributes = attributes;

  // One scratch array per column, allocated once and reused for every element. The vector-valued
  // intrinsics ALIAS their scratch into `attributes`, so reading `position` by name and reading
  // ctx.position are the same memory and neither allocates. Getting this wrong — a fresh array per
  // attribute per element — is the difference between a 100 000-point evaluation taking milliseconds
  // and taking seconds, and it is invisible until the point count is large.
  const cols = [];
  if (table) {
    for (const name of attrNames(table)) {
      const c = table.attrs[name].components;
      cols.push({ name, components: c, scratch: c > 1 ? new Array(c).fill(0) : null });
    }
  }
  const INTRINSIC = { position: 'position', normal: 'normal', velocity: 'velocity', uv: 'uv' };

  return {
    ctx,
    // Point the context at element `i`. Returns the same ctx object every time — a field's sample()
    // must not retain it, which is why the spatial helpers in fields.js clone rather than mutate.
    at(i) {
      ctx.index = i;
      if (!table) return ctx;
      for (const col of cols) {
        const v = col.scratch ? readAttrInto(table, col.name, i, col.scratch) : readAttr(table, col.name, i);
        attributes[col.name] = v;
        const slot = INTRINSIC[col.name];
        if (slot) ctx[slot] = v;
        else if (col.name === 'age' || col.name === 'life' || col.name === 'seed') ctx[col.name] = v;
      }
      return ctx;
    },
  };
}

// Evaluate a field once per element of a domain and return a flat array of results. The single
// workhorse behind every "field drives a geometry attribute" operation.
export function sampleFieldOverDomain(g, domain, field, components = 1, base = {}) {
  const table = tableFor(g, domain);
  const count = table ? table.count : 0;
  const data = new Float32Array(count * components);
  if (!count) return data;
  const walker = makeElementContext(g, domain, base);
  for (let i = 0; i < count; i++) {
    const v = F.sampleAny(field, walker.at(i));
    if (components === 1) {
      data[i] = typeof v === 'boolean' ? (v ? 1 : 0) : (Number(Array.isArray(v) ? v[0] : v) || 0);
    } else {
      for (let k = 0; k < components; k++) data[i * components + k] = Number(Array.isArray(v) ? v[k] : v) || 0;
    }
  }
  return data;
}

// ---------------------------------------------------------------- face geometry helpers
// Triangle corner positions, areas, and the cumulative-area table that makes area-weighted surface
// sampling correct. Uniform-by-triangle sampling — the naive version — clusters points on small
// triangles, which is instantly visible as banding on any non-uniform mesh.
export function triangleCorners(g, faceIndex, out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]) {
  const f = g.faces;
  if (!f) return out;
  const base = f.offsets[faceIndex];
  for (let k = 0; k < 3; k++) readAttrInto(g.points, 'position', f.corners[base + k], out[k]);
  return out;
}

export function triangleArea(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return Math.sqrt(cx * cx + cy * cy + cz * cz) * 0.5;
}

export function faceAreaTable(g) {
  const n = faceCount(g);
  const cum = new Float64Array(n + 1);
  const tri = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    triangleCorners(g, i, tri);
    cum[i + 1] = cum[i] + triangleArea(tri[0], tri[1], tri[2]);
  }
  return cum;
}

// Which face a uniform 0..1 pick lands on, weighted by area. Binary search over the cumulative table.
export function pickFaceByArea(cum, u) {
  const total = cum[cum.length - 1];
  if (!(total > 0)) return 0;
  const target = u * total;
  let lo = 0, hi = cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target) lo = mid; else hi = mid;
  }
  return lo;
}

// A uniformly-distributed barycentric coordinate from two uniforms. The fold is what makes it
// uniform: without it, points bunch towards one corner of every triangle.
export function barycentric(u, v) {
  let a = u, b = v;
  if (a + b > 1) { a = 1 - a; b = 1 - b; }
  return [1 - a - b, a, b];
}

export function faceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return V.vNormalize([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]);
}

// Recompute per-point normals by area-weighted accumulation of face normals. Area weighting rather
// than plain averaging matters on meshes with mixed triangle sizes — a strip of slivers would
// otherwise dominate the normal of the vertex they share.
export function recalculateNormals(g) {
  if (!isGeometry(g) || !g.faces) return g;
  const nrm = ensureAttr(g.points, 'normal', 3, 0);
  nrm.data.fill(0);
  const tri = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const f = g.faces;
  for (let i = 0; i < f.table.count; i++) {
    triangleCorners(g, i, tri);
    const n = faceNormal(tri[0], tri[1], tri[2]);
    const w = triangleArea(tri[0], tri[1], tri[2]);
    const base = f.offsets[i];
    for (let k = 0; k < 3; k++) {
      const p = f.corners[base + k];
      for (let a = 0; a < 3; a++) nrm.data[p * 3 + a] += n[a] * w;
    }
  }
  for (let i = 0; i < g.points.count; i++) {
    const n = V.vNormalize([nrm.data[i * 3], nrm.data[i * 3 + 1], nrm.data[i * 3 + 2]]);
    nrm.data[i * 3] = n[0]; nrm.data[i * 3 + 1] = n[1]; nrm.data[i * 3 + 2] = n[2];
  }
  return g;
}

// ---------------------------------------------------------------- curve helpers
// A curve's point span, its total length, and a length-parameterised sample. Sampling by LENGTH
// rather than by control-point index is what makes evenly-spaced points on a curve actually evenly
// spaced — parameterising by index bunches points wherever the control points are dense.
export function curveSpan(g, curveIndex) {
  const c = g.curves;
  if (!c) return [0, 0];
  return [c.offsets[curveIndex], c.offsets[curveIndex + 1]];
}

export function curveLengths(g, curveIndex) {
  const [from, to] = curveSpan(g, curveIndex);
  const n = to - from;
  const cyclic = !!g.curves.cyclic[curveIndex];
  const segs = cyclic ? n : Math.max(0, n - 1);
  const cum = new Float64Array(segs + 1);
  const a = [0, 0, 0], b = [0, 0, 0];
  for (let s = 0; s < segs; s++) {
    readAttrInto(g.points, 'position', from + s, a);
    readAttrInto(g.points, 'position', from + ((s + 1) % n), b);
    cum[s + 1] = cum[s] + V.vDistance(a, b);
  }
  return cum;
}

// Position and tangent at normalised distance `t` along a curve.
export function sampleCurve(g, curveIndex, t, cum = null) {
  const [from, to] = curveSpan(g, curveIndex);
  const n = to - from;
  if (n <= 0) return { position: [0, 0, 0], tangent: [0, 0, 1] };
  if (n === 1) return { position: readAttr(g.points, 'position', from, [0, 0, 0]), tangent: [0, 0, 1] };
  const lengths = cum || curveLengths(g, curveIndex);
  const total = lengths[lengths.length - 1];
  const target = V.clamp01(t) * total;
  let s = 0;
  while (s + 1 < lengths.length - 1 && lengths[s + 1] < target) s++;
  const segLen = lengths[s + 1] - lengths[s];
  const local = segLen > 1e-12 ? (target - lengths[s]) / segLen : 0;
  const a = readAttr(g.points, 'position', from + s, [0, 0, 0]);
  const b = readAttr(g.points, 'position', from + ((s + 1) % n), [0, 0, 0]);
  return {
    position: [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local, a[2] + (b[2] - a[2]) * local],
    tangent: V.vNormalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]),
    segment: s,
  };
}

// ---------------------------------------------------------------- summary (for diagnostics/MCP)
export function describeGeometry(g) {
  if (!isGeometry(g)) return { empty: true };
  const b = bounds(g);
  return {
    points: pointCount(g),
    faces: faceCount(g),
    curves: curveCount(g),
    attributes: {
      point: attrNames(g.points),
      face: g.faces ? attrNames(g.faces.table) : [],
      curve: g.curves ? attrNames(g.curves.table) : [],
    },
    bounds: b.empty ? null : { min: b.min, max: b.max, size: b.size },
  };
}
