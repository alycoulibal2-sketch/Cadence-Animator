// SKETCH IT 2.0, Step 3 of the spec's workflow: "Cadence immediately cleans the sketch... the
// raw drawing should not remain. Internally convert it into clean editable vector guides." Pure,
// state-free (no window/DOM — importable bare, same convention as sketchGeometry.js/effectModel.js),
// so it's unit-testable directly and loads identically anywhere.
//
// Only Free Sketch strokes ever reach this — every OTHER shape tool (Line/Circle/Ellipse/Rect/
// Spiral/Arrow/Lightning/Bezier) already synthesizes clean points+params directly at draw time in
// sketchWorkspace.js via effectShapes.js's primitives, so there's nothing messy to clean up there.
// This module exists specifically for the one tool that captures raw, jittery pointer input.

import { analyzePrimaryStroke, dist, turningAngles } from './sketchGeometry.js';

const TAU = Math.PI * 2;

function centroidOf(points) {
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  return { x: cx / points.length, y: cy / points.length };
}

function circlePoints(center, r, n = 48) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    pts.push({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r, p: 0.6, t: i });
  }
  return pts;
}

function linePoints(p0, p1) {
  return [{ x: p0.x, y: p0.y, p: 0.6, t: 0 }, { x: p1.x, y: p1.y, p: 0.6, t: 1 }];
}

function spiralPoints(center, r, turns, n = 72) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = u * TAU * turns;
    const rr = r * u;
    pts.push({ x: center.x + Math.cos(a) * rr, y: center.y + Math.sin(a) * rr, p: 0.6, t: i });
  }
  return pts;
}

// Catmull-Rom through the raw points, resampled to a fixed count — smooths hand jitter while
// keeping the stroke's actual path (never snapped to a primitive), the spec's "messy slash ->
// smooth editable curve" for gestures that aren't confidently a circle/line/spiral.
function smoothFreeform(points, outCount = 40) {
  const pts = points;
  if (pts.length < 3) return pts.map((p) => ({ ...p }));
  const at = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  const out = [];
  const segs = pts.length - 1;
  for (let i = 0; i <= outCount; i++) {
    const u = (i / outCount) * segs;
    const seg = Math.min(segs - 1, Math.floor(u));
    const t = u - seg;
    const p0 = at(seg - 1), p1 = at(seg), p2 = at(seg + 1), p3 = at(seg + 2);
    const c = (a, b, c2, d, tt) => {
      const t2 = tt * tt, t3 = t2 * tt;
      return 0.5 * ((2 * b) + (-a + c2) * tt + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3);
    };
    out.push({
      x: c(p0.x, p1.x, p2.x, p3.x, t),
      y: c(p0.y, p1.y, p2.y, p3.y, t),
      p: p1.p ?? 0.6,
      t: i,
    });
  }
  return out;
}

// Confidence thresholds tuned conservatively — a false "clean-up" that discards real intent (e.g.
// snapping an intentionally lopsided oval to a perfect circle) is worse than leaving a messy
// stroke as smoothed freeform, matching this codebase's "unrecognized -> neutral, never
// confidently wrong" convention (see sketchCandidates.js's scoreArchetype).
const CIRCLE_MIN_CIRCULARITY = 0.82;
const LINE_MIN_STRAIGHTNESS = 0.93;
const SPIRAL_MIN_SPIRALNESS = 0.55;

// recognizeStroke(rawPoints) -> Guide = { tool, points, params }. Never throws; a degenerate
// input (too short, near-zero length) just falls back to 'freehand' with the raw points intact.
export function recognizeStroke(rawPoints) {
  const pts = rawPoints || [];
  if (pts.length < 5) return { tool: 'freehand', points: pts.map((p) => ({ ...p })), params: null };

  const shape = analyzePrimaryStroke({ points: pts });

  if (shape.closed && shape.circularity >= CIRCLE_MIN_CIRCULARITY) {
    const center = centroidOf(pts);
    let r = 0;
    for (const p of pts) r += dist(p, center);
    r /= pts.length;
    return { tool: 'circle', points: circlePoints(center, Math.max(0.5, r)), params: { cx: center.x, cy: center.y, r: Math.max(0.5, r) } };
  }

  if (shape.spiralness >= SPIRAL_MIN_SPIRALNESS) {
    const center = centroidOf(pts.slice(0, Math.max(1, Math.round(pts.length * 0.25)))); // spiral starts near its own center
    const rMax = Math.max(0.5, Math.max(...pts.map((p) => dist(p, center))));
    // shape.curvature is clamp01()'d in analyzePrimaryStroke, so it saturates at one full turn and
    // can't tell 2 turns from 5 — sum the raw turning angles ourselves for a real turn count.
    const totalTurn = turningAngles(pts).reduce((s, a) => s + Math.abs(a), 0);
    const turns = Math.max(1, Math.round((totalTurn / TAU) * 2) / 2);
    return { tool: 'spiral', points: spiralPoints(center, rMax, turns), params: { cx: center.x, cy: center.y, r: rMax, turns } };
  }

  if (!shape.closed && shape.straightness >= LINE_MIN_STRAIGHTNESS) {
    const p0 = pts[0], p1 = pts[pts.length - 1];
    return { tool: 'line', points: linePoints(p0, p1), params: { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y } };
  }

  return { tool: 'freehand', points: smoothFreeform(pts), params: null };
}
