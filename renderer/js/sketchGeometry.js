// Pure, state-free sketch geometry analysis: turns a set of drawn strokes into measurable shape
// features (straightness, circularity, spiralness, zigzag, branching, crossings, speed, thickness,
// direction, complexity...) that sketchCandidates.js matches against effect archetypes. No
// window.*, no DOM, no three.js — loads identically anywhere, like effectModel.js/effectShapes.js
// (the smoketest imports this directly, same convention).
//
// A Stroke is { points: [{ x, y, p, t }] } in workspace-logical units (already pan/zoom-corrected
// by the caller — see sketchWorkspace.js). `p` is pressure 0..1 (default 0.5 when unavailable,
// e.g. a mouse); `t` is a monotonic timestamp in ms (performance.now()-style).
//
// Shape-specific features (straightness, circularity, spiralness, zigzag, curvature, dominant
// angle, openness) are read off the sketch's PRIMARY stroke — its longest by path length, on the
// theory that one decisive gesture usually carries the intent even when small accent strokes are
// also present. Composition features (stroke count, combined bounding box, branching, crossings,
// continuity, complexity, speed, thickness) are read off ALL strokes together.
//
// Every shape metric that describes FORM (straightness/circularity/spiralness/zigzag/curvature) is
// deliberately scale-invariant (built from angles and ratios, never raw workspace units) so it
// reads the same whether the user sketched large or zoomed in tight. Metrics about SIZE/SPEED
// (length, bbox, avgSpeed) stay in workspace units on purpose — those really do carry intent
// (a big sweeping gesture vs. a tiny fiddly one).

const TAU = Math.PI * 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

export function strokeLength(stroke) {
  const pts = stroke.points;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

export function bboxOf(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, diagonal: 0 };
  const width = maxX - minX, height = maxY - minY;
  return { minX, minY, maxX, maxY, width, height, diagonal: Math.hypot(width, height) };
}

// 2x2 PCA of a point cloud: the major-axis angle (as an undirected LINE angle, 0..180) plus a
// straightness score (1 = every point sits on one line, 0 = spread equally in every direction).
export function pca(points) {
  const n = points.length;
  if (n < 2) return { angleDeg: 0, straightness: 0 };
  let mx = 0, my = 0;
  for (const p of points) { mx += p.x; my += p.y; }
  mx /= n; my /= n;
  let cxx = 0, cyy = 0, cxy = 0;
  for (const p of points) {
    const dx = p.x - mx, dy = p.y - my;
    cxx += dx * dx; cyy += dy * dy; cxy += dx * dy;
  }
  cxx /= n; cyy /= n; cxy /= n;
  const tr = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.max(0, (tr * tr) / 4 - det);
  const s = Math.sqrt(disc);
  const majorEig = tr / 2 + s;
  const minorEig = Math.max(0, tr / 2 - s);
  let angleDeg;
  if (Math.abs(cxy) < 1e-9 && Math.abs(cxx - cyy) < 1e-9) {
    angleDeg = 0; // isotropic (near-single point, or a near-perfect circle) — direction is undefined
  } else {
    // Eigenvector of [[cxx,cxy],[cxy,cyy]] for eigenvalue `majorEig`: (cxx-λ)vx + cxy·vy = 0.
    angleDeg = (((Math.atan2(majorEig - cxx, cxy) * 180) / Math.PI) % 180 + 180) % 180;
  }
  const sum = majorEig + minorEig;
  const straightness = sum > 1e-9 ? clamp01(1 - (2 * minorEig) / sum) : 0;
  return { angleDeg, straightness };
}

// Signed turning angle (radians) at each interior vertex — positive = left/CCW, negative =
// right/CW. Scale-invariant by construction (it's an angle, not a distance).
export function turningAngles(points) {
  const out = [];
  for (let i = 1; i < points.length - 1; i++) {
    const ax = points[i].x - points[i - 1].x, ay = points[i].y - points[i - 1].y;
    const bx = points[i + 1].x - points[i].x, by = points[i + 1].y - points[i].y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) { out.push(0); continue; }
    const cross = (ax * by - ay * bx) / (la * lb);
    const dot = (ax * bx + ay * by) / (la * lb);
    out.push(Math.atan2(cross, dot));
  }
  return out;
}

export function analyzePrimaryStroke(stroke) {
  const pts = stroke.points;
  const len = strokeLength(stroke);
  const bbox = bboxOf(pts);
  if (pts.length < 3 || len < 1e-6) {
    return {
      straightness: pts.length <= 1 ? 0 : 1, closed: false, circularity: 0, spiralness: 0,
      zigzagScore: 0, curvature: 0, dominantAngleDeg: 0, openPath: true, length: len, bbox,
    };
  }
  const { angleDeg, straightness } = pca(pts);
  const turns = turningAngles(pts);
  const totalAbsTurn = turns.reduce((s, a) => s + Math.abs(a), 0);
  const netTurn = turns.reduce((s, a) => s + a, 0); // signed, unwrapped
  const curvature = clamp01(totalAbsTurn / TAU); // "full-circles-equivalent" of total turning

  // Closed loop: ends meet relative to the stroke's own size.
  const endGap = dist(pts[0], pts[pts.length - 1]);
  const closed = len > 0 && endGap < 0.15 * len;

  // Circularity: how constant the radius-from-centroid is, discounted unless the stroke actually
  // swept most of a full turn (otherwise a short constant-radius arc would falsely read as "a
  // circle").
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;
  const radii = pts.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const meanR = radii.reduce((s, r) => s + r, 0) / radii.length;
  const varR = radii.reduce((s, r) => s + (r - meanR) * (r - meanR), 0) / radii.length;
  const radiusConsistency = meanR > 1e-6 ? clamp01(1 - Math.sqrt(varR) / meanR) : 0;
  const turnsSwept = Math.abs(netTurn) / TAU;
  const circularity = radiusConsistency * clamp01(turnsSwept / 0.75);

  // Spiralness: swept more than one full turn AND the radius trends monotonically with progress
  // along the stroke (a circle holds radius constant; a spiral grows or shrinks it).
  const N = radii.length;
  let sumU = 0, sumR = 0, sumUR = 0, sumUU = 0, sumRR = 0;
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    sumU += u; sumR += radii[i]; sumUR += u * radii[i]; sumUU += u * u; sumRR += radii[i] * radii[i];
  }
  const covUR = sumUR / N - (sumU / N) * (sumR / N);
  const varU = sumUU / N - (sumU / N) * (sumU / N);
  const varRR = sumRR / N - (sumR / N) * (sumR / N);
  const radiusTrend = varU > 1e-9 && varRR > 1e-9 ? clamp01(Math.abs(covUR / Math.sqrt(varU * varRR))) : 0;
  const spiralness = clamp01((turnsSwept - 0.8) / 2) * radiusTrend;

  // Zigzag: how often the turn direction flips, relative to vertex count — ignores wobble below
  // ~12° so ordinary hand jitter never reads as a zigzag.
  const EPS = (12 * Math.PI) / 180;
  let reversals = 0, lastSign = 0;
  for (const a of turns) {
    if (Math.abs(a) < EPS) continue;
    const sign = a > 0 ? 1 : -1;
    if (lastSign !== 0 && sign !== lastSign) reversals++;
    lastSign = sign;
  }
  const zigzagScore = clamp01(reversals / Math.max(3, turns.length / 4));

  return {
    straightness, closed, circularity, spiralness, zigzagScore, curvature,
    dominantAngleDeg: angleDeg, openPath: !closed, length: len, bbox,
  };
}

// Downsamples only for the O(n^2) crossing test on pathologically long strokes — analysis-only,
// never mutates the stored stroke.
function segmentsOf(points, strideCap = 300) {
  const stride = points.length > strideCap ? Math.ceil(points.length / strideCap) : 1;
  const pts = stride === 1 ? points : points.filter((_, i) => i % stride === 0);
  const segs = [];
  for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]);
  return segs;
}

function segmentsIntersect(a0, a1, b0, b1) {
  const d1x = a1.x - a0.x, d1y = a1.y - a0.y;
  const d2x = b1.x - b0.x, d2y = b1.y - b0.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return false; // parallel/collinear — not a meaningful crossing
  const t = ((b0.x - a0.x) * d2y - (b0.y - a0.y) * d2x) / denom;
  const u = ((b0.x - a0.x) * d1y - (b0.y - a0.y) * d1x) / denom;
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
}

function countCrossings(strokes) {
  const allSegs = [];
  strokes.forEach((s, si) => segmentsOf(s.points).forEach((seg) => allSegs.push({ seg, si })));
  let count = 0;
  for (let i = 0; i < allSegs.length; i++) {
    for (let j = i + 1; j < allSegs.length; j++) {
      // Same-stroke path-adjacent segments always share an endpoint — not a real crossing.
      if (allSegs[i].si === allSegs[j].si && Math.abs(i - j) <= 1) continue;
      if (segmentsIntersect(allSegs[i].seg[0], allSegs[i].seg[1], allSegs[j].seg[0], allSegs[j].seg[1])) count++;
    }
  }
  return count;
}

// Greedy proximity clustering of stroke endpoints — a cluster of 3+ endpoints is a fork/junction.
// Only meaningful for multi-stroke sketches (2 strokes can only ever produce 4 endpoints total,
// never a 3-way cluster unless they truly meet at a point).
function countBranches(strokes) {
  if (strokes.length < 2) return 0;
  const endpoints = [];
  for (const s of strokes) {
    if (s.points.length) { endpoints.push(s.points[0]); endpoints.push(s.points[s.points.length - 1]); }
  }
  const bbox = bboxOf(endpoints);
  const threshold = Math.max(4, bbox.diagonal * 0.06);
  const clusters = [];
  for (const pt of endpoints) {
    const hit = clusters.find((c) => dist(c.points[0], pt) < threshold);
    if (hit) hit.points.push(pt);
    else clusters.push({ points: [pt] });
  }
  return clusters.filter((c) => c.points.length >= 3).length;
}

// 1 = strokes were drawn as one continuous gesture (or there's only one); drops toward 0 as gaps
// between consecutive strokes grow relative to the sketch's own size.
function computeContinuity(strokes) {
  if (strokes.length < 2) return 1;
  const allPts = strokes.flatMap((s) => s.points);
  const scale = Math.max(1, bboxOf(allPts).diagonal);
  let totalGap = 0, gaps = 0;
  for (let i = 1; i < strokes.length; i++) {
    const prevPts = strokes[i - 1].points, curPts = strokes[i].points;
    if (!prevPts.length || !curPts.length) continue;
    totalGap += dist(prevPts[prevPts.length - 1], curPts[0]) / scale;
    gaps++;
  }
  return gaps ? clamp01(1 - totalGap / gaps) : 1;
}

function speedAndThickness(strokes) {
  let speedSum = 0, speedCount = 0, maxSpeed = 0;
  let pSum = 0, pSqSum = 0, pCount = 0;
  for (const s of strokes) {
    const pts = s.points;
    for (const p of pts) {
      const pressure = Number.isFinite(p.p) ? p.p : 0.5;
      pSum += pressure; pSqSum += pressure * pressure; pCount++;
    }
    for (let i = 1; i < pts.length; i++) {
      const dt = (pts[i].t ?? 0) - (pts[i - 1].t ?? 0);
      if (dt <= 0) continue;
      const v = (dist(pts[i - 1], pts[i]) / dt) * 1000; // workspace units / second
      speedSum += v; speedCount++;
      if (v > maxSpeed) maxSpeed = v;
    }
  }
  const avgThickness = pCount ? pSum / pCount : 0.5;
  const meanSq = pCount ? pSqSum / pCount : 0.25;
  const thicknessVariance = Math.max(0, meanSq - avgThickness * avgThickness);
  const avgSpeed = speedCount ? speedSum / speedCount : 0;
  return { avgThickness, thicknessVariance, avgSpeed, maxSpeed };
}

const EMPTY_FEATURES = {
  empty: true, strokeCount: 0, totalLength: 0, bbox: bboxOf([]), aspectRatio: 1,
  straightness: 0.5, closed: false, openPath: true, circularity: 0, spiralness: 0,
  zigzagScore: 0, curvature: 0, dominantAngleDeg: 0, branchCount: 0, crossingCount: 0,
  continuity: 1, complexity: 0, avgThickness: 0.5, thicknessVariance: 0, avgSpeed: 0,
  maxSpeed: 0, durationMs: 0,
};

// The one entry point. Never throws on empty/degenerate input — an empty canvas still returns a
// neutral feature set so "Generate" always produces something rather than erroring (SKETCH IT's
// whole point is zero fear of doing it wrong).
export function analyzeSketchStrokes(strokes) {
  const valid = (strokes || []).filter((s) => s && s.points && s.points.length);
  if (!valid.length) return { ...EMPTY_FEATURES };

  const primary = valid.reduce((a, b) => (strokeLength(b) > strokeLength(a) ? b : a));
  const shape = analyzePrimaryStroke(primary);
  const allPts = valid.flatMap((s) => s.points);
  const bbox = bboxOf(allPts);
  const totalLength = valid.reduce((s, str) => s + strokeLength(str), 0);
  const branchCount = countBranches(valid);
  const crossingCount = countCrossings(valid);
  const continuity = computeContinuity(valid);
  const { avgThickness, thicknessVariance, avgSpeed, maxSpeed } = speedAndThickness(valid);
  const allT = allPts.map((p) => p.t ?? 0);
  const durationMs = allT.length ? Math.max(...allT) - Math.min(...allT) : 0;

  const complexity = clamp01(
    0.28 * clamp01((valid.length - 1) / 6) +
    0.28 * clamp01(crossingCount / 6) +
    0.24 * shape.zigzagScore +
    0.2 * clamp01(branchCount / 3)
  );

  return {
    empty: false,
    strokeCount: valid.length,
    totalLength,
    bbox,
    aspectRatio: bbox.height > 1e-6 ? bbox.width / bbox.height : 1,
    straightness: shape.straightness,
    closed: shape.closed,
    openPath: shape.openPath,
    circularity: shape.circularity,
    spiralness: shape.spiralness,
    zigzagScore: shape.zigzagScore,
    curvature: shape.curvature,
    dominantAngleDeg: shape.dominantAngleDeg,
    branchCount,
    crossingCount,
    continuity,
    complexity,
    avgThickness,
    thicknessVariance,
    avgSpeed,
    maxSpeed,
    durationMs,
  };
}
