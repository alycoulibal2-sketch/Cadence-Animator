// Thumbnails for the Effect Sheet's source menus: THIS effect, at (about) this frame, with one
// candidate choice applied — rendered by the real evaluator through the real backend on a scratch
// copy of the graph. Nothing is illustrated; what the menu shows is what choosing it produces.
//
// A fresh Evaluator per thumbnail on purpose: a candidate must never touch the live session's cache or
// its simulations, and the cost is small (2–15 ms per candidate, measured — docs/effect-sheet.md §8.2).
// One hidden WebGL canvas and one backend are shared by every thumbnail, cleared between candidates so
// no pooled object from one candidate leaks into the next.

import * as THREE from '../../node_modules/three/build/three.module.js';
import { Evaluator } from '../../renderer/js/pnx/evaluator.js';
import * as RENDER from '../../renderer/js/pnx/render.js';
import { getNode as getNodeType } from '../../renderer/js/pnx/registry.js';
import { PnxBackend } from './pnxBackend.js';
import { isActive as proActive } from '../../renderer/js/proDialog.js';

const W = 240, H = 150;
let renderer = null, scene = null, camera = null, backend = null;

function ensure() {
  if (renderer) return;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e0e15);
  camera = new THREE.PerspectiveCamera(50, W / H, 0.05, 500);
  camera.position.set(4.2, 3.0, 4.8);
  camera.lookAt(0, 1, 0);
  scene.add(new THREE.HemisphereLight(0x8899ff, 0x0a0a12, 1.0));
  const grid = new THREE.GridHelper(12, 12, 0x2a2a36, 0x1c1c26);
  scene.add(grid);
  backend = new PnxBackend(scene);
}

// The node whose value is the scene: an explicit Effect Output, else the newest renderer — the same
// rule the studio session uses, so a thumbnail and the live preview agree about what "the effect" is.
function findOutput(graph) {
  const nodes = Object.values(graph.nodes || {});
  const explicit = nodes.find((n) => n.type.startsWith('cadence.render.output'));
  if (explicit) return explicit.id;
  const renderers = nodes.filter((n) => { const d = getNodeType(n.type); return d && d.outputs.some((s) => s.type && s.type.name === 'renderCommand'); });
  return renderers.length ? renderers[renderers.length - 1].id : null;
}

// Render `graph` at `frame` into `target` (a 2D canvas). Returns { ok, drawn, ms } and never throws:
// a candidate that fails to evaluate shows an honest blank rather than breaking the menu.
export function renderCandidate(graph, frame, target, { fps = 30, duration = 60 } = {}) {
  const t0 = performance.now();
  try {
    ensure();
    const outId = findOutput(graph);
    if (!outId) return blank(target, 'nothing to draw');
    const ev = new Evaluator(graph, { fps, duration, quality: 0.6, pro: proActive() });
    ev.setTime(Math.max(0, Math.floor(frame)));
    const res = ev.evaluateSocket(outId, 'out');
    const cmds = RENDER.flattenCommands(res.value);
    const scene3 = RENDER.resolveScene(cmds, { quality: 0.6 });
    backend.clear();
    backend.render(scene3.draws || [], camera);
    renderer.render(scene, camera);
    const ctx = target.getContext('2d');
    ctx.drawImage(renderer.domElement, 0, 0, target.width, target.height);
    backend.clear();
    const drawn = (scene3.draws || []).reduce((a, d) => a + (d.count || 0), 0);
    return { ok: true, drawn, ms: performance.now() - t0 };
  } catch (e) {
    return blank(target, 'could not preview');
  }
}

// Test-only: render `graph` at `frame` on the hidden canvas and read the pixels back, so a test can
// prove a pass DRAWS (a shader that fails to compile still reports a pass and draws nothing). `only`
// keeps just that draw kind, so a volume can be measured without the sprites in front of it. Returns
// the number of pixels that differ from the background, plus any shader diagnostics three.js kept.
export function probeCandidate(graph, frame, { fps = 30, duration = 60, only = null } = {}) {
  ensure();
  const outId = findOutput(graph);
  if (!outId) return { ok: false, reason: 'nothing to draw' };
  const ev = new Evaluator(graph, { fps, duration, quality: 0.6, pro: proActive() });
  ev.setTime(Math.max(0, Math.floor(frame)));
  const res = ev.evaluateSocket(outId, 'out');
  const cmds = RENDER.flattenCommands(res.value);
  const scene3 = RENDER.resolveScene(cmds, { quality: 0.6 });
  const draws = (scene3.draws || []).filter((d) => !only || d.kind === only);
  backend.clear();
  backend.render(draws, camera);
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  // the background is the clear colour plus the grid; count pixels that are clearly brighter than it
  let lit = 0, sum = 0;
  for (let i = 0; i < W * H; i++) { const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2]; const m = Math.max(r, g, b); if (m > 60) lit++; sum += m; }
  const programErrors = (renderer.info.programs || []).filter((pr) => pr.diagnostics && pr.diagnostics.runnable === false).map((pr) => ({ name: pr.name, log: String(pr.diagnostics.programLog || (pr.diagnostics.fragmentShader && pr.diagnostics.fragmentShader.log) || '').slice(0, 400) }));
  backend.clear();
  return { ok: true, draws: draws.length, kinds: draws.map((d) => d.kind), lit, mean: sum / (W * H), stats: backend.lastStats, programErrors };
}

function blank(target, label) {
  const ctx = target.getContext('2d');
  ctx.fillStyle = '#0e0e15';
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.fillStyle = '#6b6c7d';
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, target.width / 2, target.height / 2 + 4);
  return { ok: false, drawn: 0, ms: 0 };
}

// Render a queue of candidates across animation frames, so a menu of twelve opens instantly and fills
// in over the next few frames instead of blocking the pointer for a quarter of a second.
export function renderQueue(items, { fps, duration, perFrame = 3 } = {}) {
  let cancelled = false;
  const queue = [...items];
  const step = () => {
    if (cancelled) return;
    for (let k = 0; k < perFrame && queue.length; k++) {
      const it = queue.shift();
      if (!it.canvas.isConnected) continue;
      const r = renderCandidate(it.graph, it.frame, it.canvas, { fps, duration });
      if (it.done) it.done(r);
    }
    if (queue.length) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return () => { cancelled = true; };
}
