// PNX spatial acceleration: a uniform hash grid over a point table (spec Part 27).
//
// This is the structure that unblocks every "particles that know about each other" feature —
// flocking, separation, density, nearest-neighbour reads — and it also accelerates the brute-force
// queries phase 4 shipped (nearest point). One structure, several consumers, deliberately: Part 27
// names spatial acceleration as one piece of work, not one per feature.
//
// WHY A HASH GRID rather than a k-d tree or an octree: particles move every frame, so the structure is
// REBUILT every substep, and a hash grid builds in O(n) with one pass and no sorting. Queries are
// "everything within a radius", which is a bounded scan of neighbouring cells. Rebuilding is cheaper
// than maintaining any balanced structure at the scale a preview runs at (thousands to tens of
// thousands of points).
//
// DETERMINISM. Buckets are filled in row order and cells are scanned in a fixed order, so a query
// visits neighbours in the same order every time. Nothing here depends on iteration order of a Map
// with mixed insertion (cells are looked up by key, never iterated), so a replayed frame produces
// byte-identical forces. The grid also COPIES positions (and velocities) at build time: consumers
// inside the solver's step loop see a snapshot of the state at the start of the substep, so every
// particle reads the same neighbourhood regardless of where it sits in the row order — a Jacobi-style
// update rather than a Gauss-Seidel one, which is what makes the result independent of row order.

// No import of geometry.js, deliberately: geometry.js attaches the neighbour query to every element
// walker it makes, so importing it back from here would be a cycle. This module only ever needs a
// table's `position` column, which it reads directly.

// Cell coordinates are hashed to one integer. Distinct cells CAN collide into one bucket; a query
// re-checks the true distance of every candidate, so a collision costs a little time and never
// correctness.
function cellKey(ix, iy, iz) {
  return ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) | 0;
}

export class SpatialGrid {
  constructor(cellSize) {
    this.cell = Math.max(1e-6, Number(cellSize) || 1);
    this.buckets = new Map();   // key -> array of rows
    this.pos = null;            // Float32Array(count * 3), a snapshot
    this.vel = null;            // Float32Array(count * 3) or null
    this.count = 0;
  }

  // Build from a geometry attribute table. Velocity is copied when the table carries one, because
  // alignment forces need it and reading it back from a table that is mid-update would be wrong.
  static fromTable(table, cellSize) {
    const g = new SpatialGrid(cellSize);
    const count = table ? table.count : 0;
    g.count = count;
    g.pos = new Float32Array(count * 3);
    const src = table && table.attrs.position;
    if (src && src.components === 3) g.pos.set(src.data.subarray(0, count * 3));
    const vsrc = table && table.attrs.velocity;
    if (vsrc && vsrc.components === 3) { g.vel = new Float32Array(count * 3); g.vel.set(vsrc.data.subarray(0, count * 3)); }
    const inv = 1 / g.cell;
    for (let row = 0; row < count; row++) {
      const k = cellKey(Math.floor(g.pos[row * 3] * inv), Math.floor(g.pos[row * 3 + 1] * inv), Math.floor(g.pos[row * 3 + 2] * inv));
      let b = g.buckets.get(k);
      if (!b) { b = []; g.buckets.set(k, b); }
      b.push(row);
    }
    return g;
  }

  static fromGeometry(geometry, cellSize) {
    return SpatialGrid.fromTable(geometry && geometry.__geometry === true ? geometry.points : null, cellSize);
  }

  // Visit every row within `radius` of p (excluding `exclude`), calling
  //   fn(row, dist2, dx, dy, dz, vx, vy, vz)
  // where (dx,dy,dz) points FROM p TO the neighbour and (vx,vy,vz) is the neighbour's snapshot
  // velocity (zero when the table had none). No allocation per neighbour, on purpose: a flock of ten
  // thousand with thirty neighbours each is three hundred thousand callbacks per substep.
  query(p, radius, exclude, fn) {
    const r = Math.max(0, Number(radius) || 0);
    if (!this.count || r <= 0) return 0;
    const r2 = r * r;
    const inv = 1 / this.cell;
    const px = p?.[0] || 0, py = p?.[1] || 0, pz = p?.[2] || 0;
    const reach = Math.ceil(r * inv);
    const cx = Math.floor(px * inv), cy = Math.floor(py * inv), cz = Math.floor(pz * inv);
    const pos = this.pos, vel = this.vel;
    let visited = 0;
    for (let ix = cx - reach; ix <= cx + reach; ix++) {
      for (let iy = cy - reach; iy <= cy + reach; iy++) {
        for (let iz = cz - reach; iz <= cz + reach; iz++) {
          const b = this.buckets.get(cellKey(ix, iy, iz));
          if (!b) continue;
          for (let n = 0; n < b.length; n++) {
            const row = b[n];
            if (row === exclude) continue;
            const dx = pos[row * 3] - px, dy = pos[row * 3 + 1] - py, dz = pos[row * 3 + 2] - pz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > r2) continue;
            visited++;
            if (vel) fn(row, d2, dx, dy, dz, vel[row * 3], vel[row * 3 + 1], vel[row * 3 + 2]);
            else fn(row, d2, dx, dy, dz, 0, 0, 0);
          }
        }
      }
    }
    return visited;
  }

  // The nearest row to p (excluding `exclude`), or -1. Expanding rings of cells: once a candidate is
  // found at distance d, every cell within d has been scanned by the time the ring reaches ceil(d/cell),
  // so the search can stop. Falls back to a full scan past a generous ring count, which only happens
  // for a query far outside the populated region.
  nearest(p, exclude = -1) {
    if (!this.count) return { row: -1, dist2: Infinity };
    const inv = 1 / this.cell;
    const px = p?.[0] || 0, py = p?.[1] || 0, pz = p?.[2] || 0;
    const cx = Math.floor(px * inv), cy = Math.floor(py * inv), cz = Math.floor(pz * inv);
    const pos = this.pos;
    let best = Infinity, bestRow = -1;
    const scanCell = (ix, iy, iz) => {
      const b = this.buckets.get(cellKey(ix, iy, iz));
      if (!b) return;
      for (let n = 0; n < b.length; n++) {
        const row = b[n];
        if (row === exclude) continue;
        const dx = pos[row * 3] - px, dy = pos[row * 3 + 1] - py, dz = pos[row * 3 + 2] - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best) { best = d2; bestRow = row; }
      }
    };
    const MAX_RING = 12;
    for (let ring = 0; ring <= MAX_RING; ring++) {
      // Only the shell of the ring is new; the interior was scanned by earlier rings.
      for (let ix = cx - ring; ix <= cx + ring; ix++) {
        for (let iy = cy - ring; iy <= cy + ring; iy++) {
          const onShellXY = Math.abs(ix - cx) === ring || Math.abs(iy - cy) === ring;
          if (onShellXY) { for (let iz = cz - ring; iz <= cz + ring; iz++) scanCell(ix, iy, iz); }
          else { scanCell(ix, iy, cz - ring); if (ring) scanCell(ix, iy, cz + ring); }
        }
      }
      // Everything within (ring * cell) of p has now been scanned. A candidate closer than that cannot
      // be beaten by anything further out.
      if (bestRow >= 0 && Math.sqrt(best) <= ring * this.cell) return { row: bestRow, dist2: best };
    }
    // Far outside the populated region: finish with a full scan so the answer is still exact.
    for (let row = 0; row < this.count; row++) {
      if (row === exclude) continue;
      const dx = pos[row * 3] - px, dy = pos[row * 3 + 1] - py, dz = pos[row * 3 + 2] - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) { best = d2; bestRow = row; }
    }
    return { row: bestRow, dist2: best };
  }

  positionOf(row, out = [0, 0, 0]) {
    out[0] = this.pos[row * 3]; out[1] = this.pos[row * 3 + 1]; out[2] = this.pos[row * 3 + 2];
    return out;
  }
}

// A sensible cell size for a static point set: about two points per cell on average, from the
// bounding box. Used by the nearest-point accelerator, where the caller has no radius in mind.
export function cellSizeFor(geometry) {
  const table = geometry && geometry.__geometry === true ? geometry.points : null;
  const n = table ? table.count : 0;
  const pos = table && table.attrs.position;
  if (!n || !pos || pos.components !== 3) return 1;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let k = 0; k < n; k++) {
    const x = pos.data[k * 3], y = pos.data[k * 3 + 1], z = pos.data[k * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const sx = maxX - minX, sy = maxY - minY, sz = maxZ - minZ;
  const vol = Math.max(1e-9, sx * sy * sz);
  // Degenerate (flat or linear) sets get a size from the longest edge instead of a zero volume.
  const longest = Math.max(sx, sy, sz, 1e-3);
  const byVolume = Math.cbrt(vol / Math.max(1, n / 2));
  return Math.max(byVolume, longest / Math.max(1, Math.cbrt(n)) * 0.5, 1e-3);
}

// Attach a lazy neighbour query to a sample context. The grid is built on the FIRST request, from the
// table as it is at that moment, and reused for every later request on the same context — which is
// exactly right for a walk over a static table (a renderer colouring particles by crowding) and
// exactly wrong for the solver's step loop, which therefore installs its own snapshot query instead
// (see solver.js). `getIndex` returns the current element so a point never counts itself.
export function attachNeighbourQuery(ctx, table, getIndex) {
  let grid = null;
  ctx.neighbours = (radius, fn) => {
    if (!grid) grid = SpatialGrid.fromTable(table, Math.max(1e-3, Number(radius) || 1));
    return grid.query(ctx.position, radius, getIndex(), fn);
  };
  ctx.nearestNeighbour = (maxRadius) => {
    if (!grid) grid = SpatialGrid.fromTable(table, Math.max(1e-3, Number(maxRadius) || 1));
    return grid.nearest(ctx.position, getIndex());
  };
  return ctx;
}
