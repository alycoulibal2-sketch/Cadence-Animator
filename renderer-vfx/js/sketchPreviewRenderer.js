// The "Preview Renderer" stage of the SKETCH IT pipeline — deliberately Canvas2D, never three.js.
// The suggestion grid shows up to ~30 simultaneously-looping previews; the real studio viewport
// (preview.js) is a single persistent three.js/WebGL context and stays that way. Spinning up 30
// throwaway WebGL contexts as the user browses candidates would be the wrong tradeoff even on a
// healthy machine, and this project has already hit real, documented intermittent GPU/WebGL
// instability in at least one environment — a cheap, honest 2D approximation is the safer and
// (per the design spec) explicitly correct choice: "Lightweight preview... Never static images."
//
// Not a crude placeholder, though: it samples the SAME sampleEffect(doc, frame) pure function the
// real studio and exporter use, and draws shape layers via the SAME shapePolyline() math the real
// mesh builder tessellates — so what you see here is a faithful, cheap projection of the real
// data, not a separate guess at what the effect looks like.
//
// One shared rAF-driven scheduler drives every registered preview (cheaper than N independent
// loops, and gives one place to pause everything — e.g. while the Preview Focus modal covers the
// grid). registerPreview()/unregisterPreview() around a card's lifetime; pauseAll()/resumeAll()
// around anything that visually covers the grid.

import { sampleEffect } from '../../renderer/js/effectEngine.js';
import { shapePolyline } from '../../renderer/js/effectShapes.js';

const TAU = Math.PI * 2;

function rgba(color, alpha) {
  const c = Array.isArray(color) ? color : [1, 1, 1];
  const r = Math.round(Math.max(0, Math.min(1, c[0])) * 255);
  const g = Math.round(Math.max(0, Math.min(1, c[1])) * 255);
  const b = Math.round(Math.max(0, Math.min(1, c[2])) * 255);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

// One-time (not per-frame) rough extent estimate from the doc's own authored data, so each
// candidate gets a stable, sensibly-framed camera instead of either a dynamic (jittery) fit or
// one fixed scale that makes small effects look lost and big ones look cropped.
function estimateWorldRadius(doc) {
  let maxR = 1.5;
  for (const layer of doc.layers) {
    const off = layer.props.offset;
    if (Array.isArray(off)) maxR = Math.max(maxR, Math.hypot(off[0] || 0, off[2] || 0) + Math.abs(off[1] || 0) * 0.6);
    if (layer.type === 'emitter') {
      const es = layer.props.emissionShape;
      if (es) for (const k of ['radius', 'width', 'depth', 'height', 'length']) if (typeof es[k] === 'number') maxR = Math.max(maxR, es[k] * 0.7);
      maxR = Math.max(maxR, (layer.props.speed || 0) * (layer.props.lifetime || 0) * 0.5);
    } else if (layer.type === 'shape' && layer.props.shape) {
      for (const k of ['radius', 'length', 'height']) {
        if (typeof layer.props.shape[k] === 'number') maxR = Math.max(maxR, layer.props.shape[k] * (layer.props.scale || 1));
      }
    } else if (layer.type === 'light') {
      maxR = Math.max(maxR, (layer.props.range || 0) * 0.25);
    }
  }
  return Math.min(12, Math.max(1.5, maxR));
}

// Fixed oblique camera (looking slightly down, along -Z) — cheap and consistent. Not meant to
// match the real studio viewport's camera exactly; just enough depth cue to read as "3D-ish".
function project(x, y, z, view) {
  const tilt = 0.55;
  const sx = x;
  const sy = -(y * Math.cos(tilt) - z * Math.sin(tilt) * 0.5);
  return { x: view.cx + sx * view.scale, y: view.cy + sy * view.scale };
}

function drawEntry(entry, now) {
  const { canvas, ctx, doc, worldRadius } = entry;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w <= 0 || h <= 0) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.max(1, Math.floor(w * dpr)), ph = Math.max(1, Math.floor(h * dpr));
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const fps = doc.fps || 30;
  const duration = Math.max(1, doc.duration || 60);
  const frame = Math.floor((now / 1000) * fps) % duration;
  const result = sampleEffect(doc, frame, { quality: entry.quality });

  ctx.fillStyle = 'rgba(9,9,13,0.45)';
  ctx.fillRect(0, 0, w, h);

  const shakeK = entry.shake === false ? 0 : 1;
  const view = {
    cx: w / 2 + result.shake.dx * shakeK * 6,
    cy: h * 0.62 + result.shake.dy * shakeK * 6,
    scale: (Math.min(w, h) * 0.42) / worldRadius,
  };

  for (const scr of result.screen) {
    if (scr.opacity <= 0.01) continue;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgba(scr.color, Math.min(0.6, scr.opacity));
    ctx.fillRect(0, 0, w, h);
  }

  for (const light of result.lights) {
    if (light.intensity <= 0.02) continue;
    const p = project(light.offset[0], light.offset[1], light.offset[2], view);
    const r = Math.max(4, light.range * view.scale * 0.5);
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    grad.addColorStop(0, rgba(light.color, Math.min(0.9, light.intensity * 0.35)));
    grad.addColorStop(1, rgba(light.color, 0));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
  }

  for (const shp of result.shapes) {
    if (shp.opacity <= 0.01) continue;
    const rad = ((shp.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const pts = shapePolyline(shp.shapeDef, 40).map((pt) => {
      const sx = pt[0] * shp.scale, sz = pt[2] * shp.scale;
      const rx = sx * cos - sz * sin, rz = sx * sin + sz * cos;
      return project(rx + shp.offset[0], pt[1] * shp.scale + shp.offset[1], rz + shp.offset[2], view);
    });
    if (!pts.length) continue;
    ctx.globalCompositeOperation = shp.emissive ? 'lighter' : 'source-over';
    ctx.strokeStyle = rgba(shp.color, shp.opacity);
    ctx.lineWidth = Math.max(1, shp.thickness * view.scale * 4);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  }

  for (const p of result.particles) {
    if (p.opacity <= 0.01) continue;
    const sp = project(p.pos[0], p.pos[1], p.pos[2], view);
    const r = Math.max(0.6, p.size * view.scale * 0.5);
    ctx.globalCompositeOperation = p.blendMode === 'additive' ? 'lighter' : 'source-over';
    const grad = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r);
    grad.addColorStop(0, rgba(p.color, p.opacity));
    grad.addColorStop(1, rgba(p.color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, TAU); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Sound has no visual/audible footprint in this sandboxed preview — a small pulsing glyph is
  // the only feedback a viewer gets that toggling "Sound" off in the breakdown did anything.
  if (result.sounds.some((s) => s.shouldBePlaying)) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 180);
    ctx.globalAlpha = 0.35 + 0.4 * pulse;
    ctx.font = `${Math.max(10, Math.min(w, h) * 0.09)}px sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText('🔊', 6, 4);
    ctx.globalAlpha = 1;
  }
}

const registry = new Map();
let rafHandle = null;
let paused = false;

function tick(now) {
  rafHandle = null;
  for (const entry of registry.values()) {
    try { drawEntry(entry, now); } catch (_) { /* a bad candidate doc should never wedge the loop */ }
  }
  if (registry.size && !paused) rafHandle = requestAnimationFrame(tick);
}
function ensureLoop() {
  if (rafHandle == null) rafHandle = requestAnimationFrame(tick);
}

// opts: { quality: 0..1 (default 1), shake: false to suppress the camera-shake nudge — used by
// the grid, where 30 independently-jittering thumbnails would read as noisy, not lively }.
export function registerPreview(canvas, doc, opts = {}) {
  const handle = {
    canvas, ctx: canvas.getContext('2d'), doc,
    quality: typeof opts.quality === 'number' ? opts.quality : 1,
    shake: opts.shake !== false,
    worldRadius: estimateWorldRadius(doc),
  };
  registry.set(handle, handle);
  ensureLoop();
  return handle;
}
export function unregisterPreview(handle) {
  registry.delete(handle);
}
export function setPreviewDoc(handle, doc) {
  if (!registry.has(handle)) return;
  handle.doc = doc;
  handle.worldRadius = estimateWorldRadius(doc);
}
export function pauseAll() { paused = true; }
export function resumeAll() { paused = false; ensureLoop(); }
