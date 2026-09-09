// Image comparison as plain data (directive Part 44, "comparison systems").
//
// This is the first module in the semantic layer that looks at pixels, and it does so WITHOUT
// looking at a renderer. A raster here is `{ width, height, encoding, data }` where `data` is a
// flat byte buffer — nothing more. Whoever produced it (three.js offscreen, a PNG decoder, a
// fixture in a test) is not this module's business, which is exactly why the purity rule survives
// Phase 4: the GPU work lives in `renderer/js/observationPasses.js`, and only bytes cross over.
//
// Part 44 is emphatic that no single comparison method is sufficient, so the methods are separate
// functions with separate names and separate failure modes, rather than one `compare()` that
// silently picks something. Each returns `comparable: false` with a reason when it cannot run —
// an incomparable pair must never come back as "no difference found".
//
// What is deliberately NOT here: perceptual difference (needs a colour-appearance model nobody in
// this repo has), depth/normal/motion-vector difference (the passes do not exist — see
// `observe.js`), and temporal difference across frames (a caller with two frames can run pixel
// difference twice; calling that "flicker detection" would be a claim this module cannot support).

import { byteHash, contentHash } from './hash.js';

/**
 * Byte layouts a raster may use. Kept small on purpose — every one of these has to be produced by
 * an actual pass and consumed by an actual comparison, and a layout nobody writes is a lie about
 * capability.
 *
 *   gray8   1 byte per pixel. Silhouette coverage: 0 = background, >0 = subject.
 *   rgb8    3 bytes per pixel.
 *   rgba8   4 bytes per pixel.
 *   id8     4 bytes per pixel, but the RGB triple is an INDEX into `palette`, not a colour.
 */
export const ENCODINGS = Object.freeze({
  gray8: 1,
  rgb8: 3,
  rgba8: 4,
  id8: 4,
});

export function channelsOf(encoding) {
  const n = ENCODINGS[encoding];
  if (!n) throw new TypeError(`raster: unknown encoding "${encoding}" (expected one of ${Object.keys(ENCODINGS).join(', ')})`);
  return n;
}

/**
 * Build a raster, validating that the buffer is the size its own header claims.
 *
 * @param pass      which observation pass produced it ('silhouette', 'object_id', …)
 * @param frame     the frame it was rendered at
 * @param camera    a camera fingerprint — see `cameraFingerprint`. REQUIRED for any pass that can
 *                  be compared against a baseline, because two renders from different viewpoints
 *                  are not evidence about the same thing, and the comparison functions refuse.
 * @param palette   id8 only: `{ [index]: entityId }`. Index 0 is reserved for background.
 */
export function makeRaster({ pass, frame = null, width, height, encoding, data, camera = null, palette = null, note = null }) {
  const ch = channelsOf(encoding);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError(`raster "${pass}": width and height must be positive integers (got ${width}x${height})`);
  }
  const expected = width * height * ch;
  if (!data || typeof data.length !== 'number') throw new TypeError(`raster "${pass}": data must be an array-like byte buffer`);
  if (data.length !== expected) {
    throw new TypeError(`raster "${pass}": ${encoding} at ${width}x${height} needs ${expected} bytes, got ${data.length}`);
  }
  if (encoding === 'id8' && !palette) throw new TypeError('raster: an id8 raster without a palette names nothing');
  const bytes = data instanceof Uint8Array || data instanceof Uint8ClampedArray ? data : Uint8Array.from(data);
  return { pass, frame, width, height, encoding, channels: ch, data: bytes, camera, palette, note };
}

/**
 * A stable fingerprint of the viewpoint a pass was rendered from.
 *
 * This exists because of a failure mode that would otherwise be invisible and constant: the user
 * nudges the orbit camera between taking a baseline and checking against it, every silhouette
 * moves, and a regression engine reports a body-wide change with total confidence. Rounding is
 * deliberate — a camera with damping never settles to identical floats, and a sub-millistud drift
 * is not a different viewpoint.
 */
export function cameraFingerprint({ position, quaternion, fov, aspect, source = 'viewport' }) {
  const r = (n, p = 4) => Math.round(n * 10 ** p) / 10 ** p;
  return {
    source,
    position: position.map((n) => r(n, 3)),
    quaternion: quaternion.map((n) => r(n, 5)),
    fov: r(fov, 3),
    aspect: r(aspect, 4),
  };
}

export function sameViewpoint(a, b) {
  if (!a || !b) return false;
  return contentHash(a) === contentHash(b);
}

/** 128-bit digest over the pixels, salted with the shape so two passes cannot alias. */
export function rasterDigest(raster) {
  return byteHash(raster.data, `${raster.pass}|${raster.encoding}|${raster.width}x${raster.height}`);
}

// ---------------------------------------------------------------- signatures
//
// A baseline that stored every raster whole would put a megabyte of pixels per frame into a
// .cadence file. A signature is the coarse form that DOES go in the file: a block grid, plus
// per-object pixel counts for an id pass. It is enough to say "the change is in the lower right",
// never enough to say "displaced by 14 pixels" — and `signatureDifference` says which of those two
// it is answering, so a reloaded baseline degrades honestly instead of quietly.

const DEFAULT_BLOCKS = 16;

export function signature(raster, { blocks = DEFAULT_BLOCKS } = {}) {
  const { width, height, channels, data, encoding } = raster;
  const cells = new Array(blocks * blocks).fill(0);
  const counts = new Array(blocks * blocks).fill(0);

  if (encoding === 'id8') {
    // Modal object index per block. A mean would average two unrelated object ids into a third
    // object's id, which is worse than useless — it would name the wrong part.
    const tally = Array.from({ length: blocks * blocks }, () => new Map());
    forEachPixel(raster, (x, y, o) => {
      const idx = data[o] | (data[o + 1] << 8) | (data[o + 2] << 16);
      const b = blockOf(x, y, width, height, blocks);
      const m = tally[b];
      m.set(idx, (m.get(idx) || 0) + 1);
    });
    for (let b = 0; b < cells.length; b++) {
      let best = 0, bestN = -1;
      for (const [idx, n] of tally[b]) if (n > bestN || (n === bestN && idx < best)) { best = idx; bestN = n; }
      cells[b] = best;
    }
    return { kind: 'modal_object_index', blocks, cells, objects: objectPixelCounts(raster) };
  }

  forEachPixel(raster, (x, y, o) => {
    const b = blockOf(x, y, width, height, blocks);
    cells[b] += luminance(data, o, channels);
    counts[b]++;
  });
  for (let b = 0; b < cells.length; b++) cells[b] = counts[b] ? Math.round(cells[b] / counts[b]) : 0;
  return { kind: 'mean_luminance', blocks, cells, objects: null };
}

function blockOf(x, y, width, height, blocks) {
  const bx = Math.min(blocks - 1, Math.floor((x * blocks) / width));
  const by = Math.min(blocks - 1, Math.floor((y * blocks) / height));
  return by * blocks + bx;
}

function luminance(data, o, channels) {
  if (channels === 1) return data[o];
  return Math.round(0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]);
}

function forEachPixel(raster, fn) {
  const { width, height, channels, data } = raster;
  for (let y = 0, o = 0; y < height; y++) {
    for (let x = 0; x < width; x++, o += channels) fn(x, y, o, data);
  }
}

// ---------------------------------------------------------------- comparison methods

function incomparable(method, reason) {
  return { method, comparable: false, reason, changed: null };
}

function shapesAgree(method, a, b) {
  if (!a || !b) return incomparable(method, 'one of the two rasters is missing — it was never rendered, or the in-memory store no longer holds it');
  if (a.encoding !== b.encoding) return incomparable(method, `encodings differ (${a.encoding} vs ${b.encoding})`);
  if (a.width !== b.width || b.height !== a.height) {
    return incomparable(method, `resolutions differ (${a.width}x${a.height} vs ${b.width}x${b.height}) — a resized comparison would report resampling as change`);
  }
  if (a.camera && b.camera && !sameViewpoint(a.camera, b.camera)) {
    return incomparable(method, 'the two renders are from different viewpoints; the camera moved between them, so every pixel difference is explained by the camera and none of it is evidence about the animation');
  }
  if (!a.camera || !b.camera) {
    return incomparable(method, 'at least one raster has no camera fingerprint, so there is no way to know the two were rendered from the same viewpoint');
  }
  return null;
}

/**
 * Part 44's "exact pixel difference for reproducible outputs".
 *
 * `threshold` is a per-channel tolerance, defaulting to 0 — these passes are rendered with
 * antialiasing OFF precisely so that exact really means exact.
 */
export function pixelDifference(a, b, { threshold = 0 } = {}) {
  const bad = shapesAgree('exact_pixel', a, b);
  if (bad) return bad;

  const ch = a.channels, da = a.data, db = b.data;
  let changed = 0, maxDelta = 0, sumDelta = 0;
  let minX = a.width, minY = a.height, maxX = -1, maxY = -1;

  for (let y = 0, o = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++, o += ch) {
      let d = 0;
      for (let c = 0; c < ch; c++) { const v = Math.abs(da[o + c] - db[o + c]); if (v > d) d = v; }
      if (d > maxDelta) maxDelta = d;
      if (d > threshold) {
        changed++;
        sumDelta += d;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const total = a.width * a.height;
  return {
    method: 'exact_pixel',
    comparable: true,
    changed: changed > 0,
    threshold,
    changed_pixels: changed,
    total_pixels: total,
    fraction: total ? changed / total : 0,
    max_channel_delta: maxDelta,
    mean_delta_over_changed: changed ? sumDelta / changed : 0,
    region: maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

/**
 * Silhouette coverage difference — Part 43's silhouette pass, compared as a binary mask.
 *
 * `cutoff` is the luminance above which a pixel counts as subject. The pass is rendered as flat
 * white on black with no antialiasing, so anything above black is subject and the exact value does
 * not matter; the parameter exists so a caller feeding it a beauty render knows it must choose one.
 */
export function maskDifference(a, b, { cutoff = 8 } = {}) {
  const bad = shapesAgree('silhouette_coverage', a, b);
  if (bad) return bad;

  const ma = binaryMask(a, cutoff), mb = binaryMask(b, cutoff);
  let inA = 0, inB = 0, added = 0, removed = 0, both = 0;
  let minX = a.width, minY = a.height, maxX = -1, maxY = -1;
  for (let i = 0, y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++, i++) {
      const p = ma[i], q = mb[i];
      if (p) inA++;
      if (q) inB++;
      if (p && q) both++;
      if (p !== q) {
        if (q) added++; else removed++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const union = inA + inB - both;
  return {
    method: 'silhouette_coverage',
    comparable: true,
    changed: added + removed > 0,
    coverage_before: inA,
    coverage_after: inB,
    coverage_before_fraction: inA / (a.width * a.height),
    coverage_after_fraction: inB / (a.width * a.height),
    pixels_gained: added,
    pixels_lost: removed,
    intersection_over_union: union ? both / union : 1,
    centroid_shift_px: centroidShift(ma, mb, a.width),
    region: maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

function binaryMask(raster, cutoff) {
  const { width, height, channels, data } = raster;
  const out = new Uint8Array(width * height);
  for (let i = 0, o = 0; i < out.length; i++, o += channels) out[i] = luminance(data, o, channels) > cutoff ? 1 : 0;
  return out;
}

function centroidShift(ma, mb, width) {
  const c = (m) => {
    let n = 0, sx = 0, sy = 0;
    for (let i = 0; i < m.length; i++) if (m[i]) { n++; sx += i % width; sy += (i / width) | 0; }
    return n ? [sx / n, sy / n] : null;
  };
  const a = c(ma), b = c(mb);
  if (!a || !b) return null;
  return Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * 100) / 100;
}

/**
 * Part 44's "edge difference for silhouette or mask movement", and the source of Part 45's
 * "silhouette displaced by 14 pixels".
 *
 * The displacement is measured with a two-pass chamfer distance transform (3-4 weights, divided by
 * 3): for every edge pixel in the AFTER image, how far is the nearest edge pixel in the BEFORE
 * image. That distance is an approximation with about 8% worst-case error against true Euclidean
 * distance, which is stated here rather than rounded away, and it is reported as `approximate`.
 *
 * Why displacement rather than a pixel count: a silhouette that shifts two pixels sideways and one
 * that grows a whole new limb can produce the same number of changed pixels. The distance says
 * which one happened.
 */
export function edgeDifference(a, b, { cutoff = 8 } = {}) {
  const bad = shapesAgree('edge', a, b);
  if (bad) return bad;

  const ea = edgeMask(binaryMask(a, cutoff), a.width, a.height);
  const eb = edgeMask(binaryMask(b, cutoff), b.width, b.height);
  const countA = count(ea), countB = count(eb);
  if (!countA || !countB) {
    return {
      method: 'edge', comparable: true, changed: countA !== countB,
      edge_pixels_before: countA, edge_pixels_after: countB,
      max_displacement_px: null, mean_displacement_px: null,
      note: 'one of the two silhouettes is empty, so there is no edge to measure a displacement against',
    };
  }
  const dist = chamferDistance(ea, a.width, a.height);
  let max = 0, sum = 0, n = 0;
  for (let i = 0; i < eb.length; i++) if (eb[i]) { const d = dist[i]; if (d > max) max = d; sum += d; n++; }
  return {
    method: 'edge',
    comparable: true,
    changed: max > 0,
    edge_pixels_before: countA,
    edge_pixels_after: countB,
    max_displacement_px: Math.round(max * 100) / 100,
    mean_displacement_px: Math.round((sum / n) * 100) / 100,
    approximate: true,
    approximation: 'chamfer 3-4 distance transform, within about 8% of true Euclidean distance',
  };
}

function count(mask) { let n = 0; for (let i = 0; i < mask.length; i++) if (mask[i]) n++; return n; }

// A set pixel with at least one unset 4-neighbour. Pixels on the image border count as edge only
// where the mask actually stops inside the frame — a subject cropped by the viewport has no
// visible boundary there, and calling the crop an edge would report the frame as a silhouette.
function edgeMask(mask, w, h) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const left = x > 0 ? mask[i - 1] : 1;
      const right = x < w - 1 ? mask[i + 1] : 1;
      const up = y > 0 ? mask[i - w] : 1;
      const down = y < h - 1 ? mask[i + w] : 1;
      if (!left || !right || !up || !down) out[i] = 1;
    }
  }
  return out;
}

function chamferDistance(mask, w, h) {
  const INF = 1e9;
  const d = new Float64Array(mask.length);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? INF : d[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      v = Math.min(v, at(x - 1, y) + 3, at(x + 1, y - 1) + 4, at(x, y - 1) + 3, at(x - 1, y - 1) + 4);
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      v = Math.min(v, at(x + 1, y) + 3, at(x - 1, y + 1) + 4, at(x, y + 1) + 3, at(x + 1, y + 1) + 4);
      d[i] = v;
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = d[i] >= INF ? INF : d[i] / 3;
  return d;
}

// ---------------------------------------------------------------- object-ID difference

/** `{ entityId: { pixels, region } }` for every object visible in an id8 raster, plus what could
 *  not be attributed. `unclassified` is not a rounding error to be swallowed: a nonzero count means
 *  the palette and the render disagree, and every per-object number below it is suspect. */
export function objectPixelCounts(raster) {
  if (raster.encoding !== 'id8') throw new TypeError(`objectPixelCounts: needs an id8 raster, got ${raster.encoding}`);
  const { width, height, data, palette } = raster;
  const byIndex = new Map();
  let background = 0, unclassified = 0;
  for (let y = 0, o = 0; y < height; y++) {
    for (let x = 0; x < width; x++, o += 4) {
      const idx = data[o] | (data[o + 1] << 8) | (data[o + 2] << 16);
      if (idx === 0) { background++; continue; }
      const entity = palette[idx];
      if (!entity) { unclassified++; continue; }
      let e = byIndex.get(entity);
      if (!e) { e = { pixels: 0, minX: width, minY: height, maxX: -1, maxY: -1 }; byIndex.set(entity, e); }
      e.pixels++;
      if (x < e.minX) e.minX = x; if (x > e.maxX) e.maxX = x;
      if (y < e.minY) e.minY = y; if (y > e.maxY) e.maxY = y;
    }
  }
  const objects = {};
  for (const [entity, e] of byIndex) {
    objects[entity] = {
      pixels: e.pixels,
      region: { x: e.minX, y: e.minY, width: e.maxX - e.minX + 1, height: e.maxY - e.minY + 1 },
      centroid: [Math.round(((e.minX + e.maxX) / 2) * 10) / 10, Math.round(((e.minY + e.maxY) / 2) * 10) / 10],
    };
  }
  return { objects, background_pixels: background, unclassified_pixels: unclassified };
}

/**
 * Part 44's "object-ID difference for object presence and visibility" — and Phase 4's
 * "changed-object reporting". This is the method that turns "something moved" into "the right
 * forearm and the sword moved, and nothing else did", which is the whole reason the pass exists.
 */
export function idDifference(a, b, { minPixels = 1 } = {}) {
  const bad = shapesAgree('object_id', a, b);
  if (bad) return bad;
  if (a.encoding !== 'id8') return incomparable('object_id', `needs an id8 raster, got ${a.encoding}`);

  const A = objectPixelCounts(a), B = objectPixelCounts(b);
  const names = new Set([...Object.keys(A.objects), ...Object.keys(B.objects)]);
  const appeared = [], disappeared = [], moved = [], unchanged = [];

  for (const id of [...names].sort()) {
    const x = A.objects[id], y = B.objects[id];
    if (!x) { appeared.push({ entity: id, pixels: y.pixels, region: y.region }); continue; }
    if (!y) { disappeared.push({ entity: id, pixels: x.pixels, region: x.region }); continue; }
    const shift = Math.hypot(y.centroid[0] - x.centroid[0], y.centroid[1] - x.centroid[1]);
    const dPixels = y.pixels - x.pixels;
    if (Math.abs(dPixels) < minPixels && shift < 0.5) { unchanged.push(id); continue; }
    moved.push({
      entity: id,
      pixels_before: x.pixels,
      pixels_after: y.pixels,
      pixel_delta: dPixels,
      centroid_shift_px: Math.round(shift * 100) / 100,
      region_before: x.region,
      region_after: y.region,
    });
  }
  moved.sort((p, q) => (q.centroid_shift_px - p.centroid_shift_px) || (Math.abs(q.pixel_delta) - Math.abs(p.pixel_delta)));
  return {
    method: 'object_id',
    comparable: true,
    changed: appeared.length + disappeared.length + moved.length > 0,
    appeared,
    disappeared,
    moved,
    unchanged_count: unchanged.length,
    unclassified_pixels: { before: A.unclassified_pixels, after: B.unclassified_pixels },
    trustworthy: A.unclassified_pixels === 0 && B.unclassified_pixels === 0,
    note: A.unclassified_pixels || B.unclassified_pixels
      ? 'some pixels carried an index the palette does not name — the per-object numbers below are incomplete and must not be read as exhaustive'
      : null,
  };
}

// ---------------------------------------------------------------- degraded comparison

/**
 * Compare two signatures when the full rasters are gone — the baseline was saved to disk and
 * reloaded, so only the block grid survived.
 *
 * This answers "where" at block granularity and refuses to answer "by how much". The distinction is
 * carried in the result (`granularity`, `answers`, `cannot_answer`) rather than left for a reader
 * to infer from a suspiciously round number.
 */
export function signatureDifference(sa, sb, { threshold = 3 } = {}) {
  if (!sa || !sb) return incomparable('signature', 'one of the two signatures is missing');
  if (sa.kind !== sb.kind) return incomparable('signature', `signature kinds differ (${sa.kind} vs ${sb.kind})`);
  if (sa.blocks !== sb.blocks) return incomparable('signature', `block counts differ (${sa.blocks} vs ${sb.blocks})`);

  const n = sa.blocks;
  const changedCells = [];
  let minX = n, minY = n, maxX = -1, maxY = -1;
  for (let i = 0; i < sa.cells.length; i++) {
    const differs = sa.kind === 'modal_object_index' ? sa.cells[i] !== sb.cells[i] : Math.abs(sa.cells[i] - sb.cells[i]) > threshold;
    if (!differs) continue;
    const x = i % n, y = (i / n) | 0;
    changedCells.push({ x, y, before: sa.cells[i], after: sb.cells[i] });
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return {
    method: 'signature',
    comparable: true,
    changed: changedCells.length > 0,
    granularity: `1/${n} of the frame in each axis`,
    blocks: n,
    changed_blocks: changedCells.length,
    total_blocks: n * n,
    block_region: maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    cells: changedCells.slice(0, 64),
    cells_truncated: Math.max(0, changedCells.length - 64),
    answers: ['whether anything changed', 'roughly where in frame'],
    cannot_answer: ['by how many pixels', 'which object', 'whether the change is a shift or a shape change'],
  };
}

export function rasterLimitations() {
  return {
    cannot: [
      'perceptual difference — no colour-appearance model exists here, so "visually meaningful" is not something this module can distinguish from "numerically different"',
      'depth, normal, motion-vector, alpha, shadow or material-ID difference — the passes that would feed them are not rendered (see observe.js PASSES)',
      'temporal difference (flicker, one-frame pops) — that needs a run of consecutive frames rendered at once, and the observation policy currently samples suspect frames rather than ranges',
      'sub-pixel measurement — every pass is rendered with antialiasing off so that exact comparison is exact, which costs sub-pixel precision at silhouette edges',
    ],
    assumptions: [
      'a raster is compared only against one rendered from the same viewpoint at the same resolution; every method refuses otherwise rather than resampling',
      'edge displacement is a chamfer approximation, reported as approximate, not a true Euclidean distance transform',
    ],
  };
}
