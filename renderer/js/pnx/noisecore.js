// Procedural noise kernels (spec Part 15). Pure maths, no node definitions — nodes/noise.js wraps
// these. Kept separate so the raw functions can be unit-tested and reused by the pyro/volume
// backends later without dragging the registry in.
//
// EVERY function here is a pure function of its coordinates and an integer seed. There is no
// permutation table built at load time and no internal state, which matters for two reasons: the
// seed can vary per node without rebuilding anything, and identical coordinates give identical
// results forever — across sessions, across machines, and across a scrub backwards.
//
// The integer hash is pure 32-bit integer arithmetic rather than the sin-based hash used elsewhere
// in the codebase. That is deliberate here: a sin-based hash can differ in its last bits between
// JavaScript engines, and noise magnifies that into visible speckle. Integer mixing cannot drift.

const F = (x) => Math.floor(x);

// 32-bit integer hash of three lattice coordinates plus a seed.
function ihash(x, y, z, seed) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x3b9f4d1b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const unit = (h) => (h >>> 8) / 16777216; // top 24 bits -> [0,1)

// Quintic fade. Its first AND second derivatives vanish at 0 and 1, so noise driving motion has no
// acceleration crease at lattice boundaries. The cheaper cubic smoothstep shows a faint grid when
// noise displaces geometry, which is exactly where it gets used most.
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- white noise
// A different value at every point, with no smoothness at all. Quantised to a lattice fine enough
// to look continuous but coarse enough to be stable: hashing raw floats would make the value flicker
// with floating-point noise at scale changes.
export function white3(x, y, z, seed = 0) {
  return unit(ihash(F(x * 4096), F(y * 4096), F(z * 4096), seed));
}

// ---------------------------------------------------------------- value noise
// Smooth interpolation between random values at lattice corners. Cheaper than gradient noise and
// visibly blockier — its extremes sit ON the lattice points, which reads as a grid at low scales.
export function value3(x, y, z, seed = 0) {
  const ix = F(x), iy = F(y), iz = F(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const c = (dx, dy, dz) => unit(ihash(ix + dx, iy + dy, iz + dz, seed));
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), fx), lerp(c(0, 1, 0), c(1, 1, 0), fx), fy),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), fx), lerp(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  );
}

// ---------------------------------------------------------------- gradient (Perlin) noise
// The 12 edge-midpoint gradients of a cube — the standard set. Using axis-aligned gradients instead
// produces obvious cross-shaped artefacts.
const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

// Returns -1..1 (approximately: the theoretical bound in 3D for this gradient set is sqrt(3)/2,
// so the result is scaled by 2/sqrt(3) and clamped).
const PERLIN_SCALE = 2 / Math.sqrt(3);
export function perlin3(x, y, z, seed = 0) {
  const ix = F(x), iy = F(y), iz = F(z);
  const rx = x - ix, ry = y - iy, rz = z - iz;
  const u = fade(rx), v = fade(ry), w = fade(rz);
  const dot = (dx, dy, dz) => {
    const g = GRAD3[ihash(ix + dx, iy + dy, iz + dz, seed) % 12];
    return g[0] * (rx - dx) + g[1] * (ry - dy) + g[2] * (rz - dz);
  };
  const n = lerp(
    lerp(lerp(dot(0, 0, 0), dot(1, 0, 0), u), lerp(dot(0, 1, 0), dot(1, 1, 0), u), v),
    lerp(lerp(dot(0, 0, 1), dot(1, 0, 1), u), lerp(dot(0, 1, 1), dot(1, 1, 1), u), v),
    w,
  );
  return Math.max(-1, Math.min(1, n * PERLIN_SCALE));
}

// ---------------------------------------------------------------- simplex noise
// Genuinely different from Perlin rather than a rename: the lattice is a tetrahedral packing, so
// there are no axis-aligned directions for artefacts to line up along, and it stays isotropic when
// scaled non-uniformly. Costs about the same in 3D and looks less "griddy" under domain warping.
const SKEW3 = 1 / 3;
const UNSKEW3 = 1 / 6;
export function simplex3(x, y, z, seed = 0) {
  const s = (x + y + z) * SKEW3;
  const i = F(x + s), j = F(y + s), k = F(z + s);
  const t = (i + j + k) * UNSKEW3;
  const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);

  // Which of the six tetrahedra within the skewed cube the point falls in, by ordering the
  // fractional coordinates.
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
    else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else {
    if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
  }

  const x1 = x0 - i1 + UNSKEW3, y1 = y0 - j1 + UNSKEW3, z1 = z0 - k1 + UNSKEW3;
  const x2 = x0 - i2 + 2 * UNSKEW3, y2 = y0 - j2 + 2 * UNSKEW3, z2 = z0 - k2 + 2 * UNSKEW3;
  const x3 = x0 - 1 + 3 * UNSKEW3, y3 = y0 - 1 + 3 * UNSKEW3, z3 = z0 - 1 + 3 * UNSKEW3;

  const contrib = (dx, dy, dz, gi, gj, gk) => {
    const t0 = 0.6 - dx * dx - dy * dy - dz * dz;
    if (t0 <= 0) return 0;
    const g = GRAD3[ihash(gi, gj, gk, seed) % 12];
    const t2 = t0 * t0;
    return t2 * t2 * (g[0] * dx + g[1] * dy + g[2] * dz);
  };

  const n = contrib(x0, y0, z0, i, j, k)
    + contrib(x1, y1, z1, i + i1, j + j1, k + k1)
    + contrib(x2, y2, z2, i + i2, j + j2, k + k2)
    + contrib(x3, y3, z3, i + 1, j + 1, k + 1);
  return Math.max(-1, Math.min(1, n * 32));
}

// ---------------------------------------------------------------- cellular / Voronoi
// Returns the distance to the nearest feature point (F1), the distance to the second nearest (F2),
// the nearest point's own position, and a stable random value identifying its cell.
//
// F2 - F1 is what draws cell BORDERS (it goes to zero exactly on the boundary between two cells),
// which is why both are returned rather than just the nearest: cracks, scales and shattered glass
// are all that difference, and computing it from two separate lookups would not work.
export function voronoi3(x, y, z, seed = 0, randomness = 1, metric = 'euclidean') {
  const ix = F(x), iy = F(y), iz = F(z);
  let f1 = Infinity, f2 = Infinity;
  let bestCell = 0, bx = 0, by = 0, bz = 0;
  const r = Math.min(Math.max(randomness, 0), 1);

  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx, cy = iy + dy, cz = iz + dz;
        const h = ihash(cx, cy, cz, seed);
        // Three decorrelated offsets from one hash, by re-mixing it per axis.
        const ox = unit(ihash(cx, cy, cz, seed ^ 0x1234)) * r + (1 - r) * 0.5;
        const oy = unit(ihash(cx, cy, cz, seed ^ 0x5678)) * r + (1 - r) * 0.5;
        const oz = unit(ihash(cx, cy, cz, seed ^ 0x9abc)) * r + (1 - r) * 0.5;
        const px = cx + ox, py = cy + oy, pz = cz + oz;
        const ex = px - x, ey = py - y, ez = pz - z;
        let d;
        if (metric === 'manhattan') d = Math.abs(ex) + Math.abs(ey) + Math.abs(ez);
        else if (metric === 'chebyshev') d = Math.max(Math.abs(ex), Math.abs(ey), Math.abs(ez));
        else d = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (d < f1) {
          f2 = f1; f1 = d;
          bestCell = unit(h); bx = px; by = py; bz = pz;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
  }
  return { f1, f2, cell: bestCell, position: [bx, by, bz] };
}

// ---------------------------------------------------------------- fractal layering
// Sums several octaves of a base noise. `gain` (persistence) is how much quieter each octave is;
// `lacunarity` is how much finer. The result is divided by the total amplitude, so changing octave
// count changes the DETAIL without changing the overall contrast — otherwise every octave slider
// would double as a brightness slider.
export function fbm(basis, x, y, z, { octaves = 4, lacunarity = 2, gain = 0.5, seed = 0 } = {}) {
  const oct = Math.max(1, Math.min(12, Math.round(octaves)));
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += basis(x * freq, y * freq, z * freq, seed + o * 1013) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

// Ridged: fold each octave's absolute value upward, so the zero crossings become sharp creases.
// This is what makes mountain ridges, lightning filaments and the sharp edges inside smoke.
export function ridgedFbm(basis, x, y, z, { octaves = 4, lacunarity = 2, gain = 0.5, seed = 0, sharpness = 1 } = {}) {
  const oct = Math.max(1, Math.min(12, Math.round(octaves)));
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    const n = 1 - Math.abs(basis(x * freq, y * freq, z * freq, seed + o * 1013));
    sum += Math.pow(Math.max(0, n), Math.max(0.05, sharpness)) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

// Turbulence: absolute value WITHOUT the fold, giving billowing, cauliflower-like forms. The
// classic smoke and cloud basis, and visibly different from ridged despite both using abs().
export function turbulence(basis, x, y, z, { octaves = 4, lacunarity = 2, gain = 0.5, seed = 0 } = {}) {
  const oct = Math.max(1, Math.min(12, Math.round(octaves)));
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += Math.abs(basis(x * freq, y * freq, z * freq, seed + o * 1013)) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

// ---------------------------------------------------------------- helpers for node wrappers
export const BASIS = { perlin: perlin3, simplex: simplex3, value: (x, y, z, s) => value3(x, y, z, s) * 2 - 1 };
export const to01 = (v) => v * 0.5 + 0.5;
