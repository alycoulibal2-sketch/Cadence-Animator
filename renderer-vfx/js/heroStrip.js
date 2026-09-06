// The hero particle: one particle's whole life as five ghosts (docs/effect-sheet.md §6.2).
//
//   "Animate one particle; we make a thousand."
//
// The strip samples the FIRST particle system's look at life 0 · ¼ · ½ · ¾ · 1 — size from the sprite
// renderer's `size` field, colour and opacity from its material — using a real particle's context at
// each of those ages (the alive particle whose life is nearest), so what the ghosts show is what the
// engine draws, not an illustration. Dragging a ghost's rim writes a key of the size curve at that
// life; clicking a ghost writes a gradient stop; dragging the bar under it writes an opacity key. Each
// is one value in the graph, through ST.mutatePnx — no inference.
//
// When a property does not yet vary over life, the first drag turns it into "over its life" through
// the same menu entry the sheet offers (menus.js), then edits the key — so the strip is usable from the
// very first effect without the user knowing the word "curve".

import * as ST from './studioState.js';
import * as PNX from './pnxStudio.js';
import * as PGRAPH from '../../renderer/js/pnx/graph.js';
import * as GEO from '../../renderer/js/pnx/geometry.js';
import * as F from '../../renderer/js/pnx/fields.js';
import * as V from '../../renderer/js/pnx/values.js';
import * as MENUS from '../../renderer/js/pnx/menus.js';
import { pickColor } from '../../renderer/js/colorPicker.js';
import { toast } from '../../renderer/js/ui.js';

const LIVES = [0, 0.25, 0.5, 0.75, 1];
let host = null, canvas = null, ctx = null, head = null;
let drag = null;
let model = null;   // what the last paint found: { sprite, sim, material, ghosts:[{u,size,color,alpha,y}] }
const graph = () => ST.state.pnx;

export function mountHeroStrip(container) {
  host = container;
  const wrap = document.createElement('div');
  wrap.className = 'hero-strip';
  head = document.createElement('div');
  head.className = 'hero-strip-head';
  head.innerHTML = '<b>One particle\'s life</b><span>drag a rim to size it · click a ghost to colour it · drag the bar to fade it</span>';
  canvas = document.createElement('canvas');
  canvas.className = 'hero-strip-canvas';
  const scale = document.createElement('div');
  scale.className = 'hero-strip-scale';
  scale.innerHTML = '<span>born</span><span>25 %</span><span>50 %</span><span>75 %</span><span>dies</span>';
  wrap.append(head, canvas, scale);
  host.appendChild(wrap);
  ctx = canvas.getContext('2d');
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('mousemove', (e) => { if (drag) return; const z = zoneAt(e); canvas.style.cursor = z ? (z.part === 'fade' ? 'ns-resize' : z.part === 'rim' ? 'ew-resize' : 'pointer') : 'default'; });
  const onChange = () => paint();
  ST.on('effect', onChange); ST.on('pnx', onChange); ST.on('playhead', onChange);
  new ResizeObserver(paint).observe(wrap);
  paint();
  return { destroy() { ST.off('effect', onChange); ST.off('pnx', onChange); ST.off('playhead', onChange); wrap.remove(); host = null; } };
}

// ---------------------------------------------------------------- reading the graph
// The first sprite pass that draws a simulation: its size field, its material's colour/opacity fields,
// and the simulation's live particles for real sample contexts.
function findHero() {
  const g = graph();
  if (!g) return null;
  const sprite = Object.values(g.nodes).find((n) => n.type.startsWith('cadence.render.sprite') && n.scope === PGRAPH.ROOT_SCOPE);
  if (!sprite) return null;
  const srcLink = PGRAPH.linksInto(g, sprite.id, 'source')[0];
  const sim = srcLink ? g.nodes[srcLink.fromNode] : null;
  const matLink = PGRAPH.linksInto(g, sprite.id, 'material')[0];
  const material = matLink ? g.nodes[matLink.fromNode] : null;
  let particles = null, size = null, color = null, opacity = null;
  try {
    if (sim && sim.type.startsWith('cadence.particles.simulate')) particles = PNX.inspectSocket(sim.id, 'out');
    size = inputValue(sprite, 'size');
    if (material && material.type.startsWith('cadence.material.surface')) { color = inputValue(material, 'baseColor'); opacity = inputValue(material, 'opacity'); }
  } catch (_) { /* a half-built graph is normal */ }
  return { sprite, sim, material, particles, size, color, opacity };
}
// The value feeding an input: the wired source's evaluated output, or the literal.
function inputValue(node, key) {
  const g = graph();
  const l = PGRAPH.linksInto(g, node.id, key)[0];
  if (l) return PNX.inspectSocket(l.fromNode, l.fromSocket);
  const s = PGRAPH.socketsOf(g, node).inputs.find((x) => x.key === key);
  return node.values?.[key] !== undefined ? node.values[key] : s?.default;
}
// A sample context at life u: the alive particle nearest that life if there is one, else a plain one.
function contextAt(hero, u) {
  const geo = hero.particles;
  const n = GEO.isGeometry(geo) ? GEO.pointCount(geo) : 0;
  if (n) {
    let best = -1, bd = Infinity;
    for (let k = 0; k < n; k++) { const d = Math.abs(GEO.readAttr(geo.points, 'life', k, 0) - u); if (d < bd) { bd = d; best = k; } }
    if (best >= 0) { const w = GEO.makeElementContext(geo, 'point', { time: ST.state.playhead / (ST.state.doc.fps || 30) }); const c = w.at(best); c.life = u; c.age = u * (GEO.readAttr(geo.points, 'lifetime', best, 1) || 1); return { ctx: c, y: c.position ? c.position[1] : 0 }; }
  }
  return { ctx: F.newSampleContext({ life: u, age: u, index: 0 }), y: 0 };
}

// ---------------------------------------------------------------- painting
function paint() {
  if (!canvas || !host || !host.isConnected) return;
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(10, Math.round(r.width * dpr)); canvas.height = Math.max(10, Math.round(r.height * dpr));
  const W = canvas.width, H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = css('--bg-2'); ctx.fillRect(0, 0, W, H);
  const hero = findHero();
  model = null;
  if (!hero) { note('Add particles to see one particle\'s life here.'); return; }
  const ghosts = [];
  for (const u of LIVES) {
    const { ctx: sc, y } = contextAt(hero, u);
    const size = Math.max(0, Number(F.sampleAny(hero.size, sc)) || 0);
    const col = hero.color != null ? V.toComponents('color', F.sampleAny(hero.color, sc)) : [1, 1, 1, 1];
    const alpha = hero.opacity != null ? Math.max(0, Math.min(1, Number(F.sampleAny(hero.opacity, sc)))) : 1;
    ghosts.push({ u, size, color: col, alpha, y });
  }
  const ys = ghosts.map((g) => g.y), lo = Math.min(...ys), hi = Math.max(...ys), span = Math.max(0.5, hi - lo);
  const px = (i) => 36 * dpr + (W - 72 * dpr) * i / 4;
  const py = (y) => 22 * dpr + (H - 62 * dpr) * (1 - (y - lo) / span);
  // the path
  ctx.strokeStyle = css('--text-3'); ctx.lineWidth = dpr; ctx.setLineDash([3 * dpr, 4 * dpr]); ctx.beginPath();
  ghosts.forEach((g, i) => { i ? ctx.lineTo(px(i), py(g.y)) : ctx.moveTo(px(i), py(g.y)); }); ctx.stroke(); ctx.setLineDash([]);
  const additive = hero.material?.values?.blend === 'additive';
  const scale = (W / 10);   // px per stud, so a 0.5-stud sprite reads at a sensible size
  ctx.globalCompositeOperation = additive ? 'lighter' : 'source-over';
  ghosts.forEach((g, i) => {
    const rad = Math.max(3 * dpr, g.size * scale * 0.9);
    const x = px(i), y = py(g.y);
    const [cr, cg, cb] = g.color;
    const gr = ctx.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${b(cr)},${b(cg)},${b(cb)},${g.alpha})`); gr.addColorStop(1, `rgba(${b(cr)},${b(cg)},${b(cb)},0)`);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    g.x = x; g.py = y; g.rad = rad;
  });
  ctx.globalCompositeOperation = 'source-over';
  for (const g of ghosts) {
    ctx.strokeStyle = css('--accent'); ctx.lineWidth = 1.2 * dpr; ctx.setLineDash([2 * dpr, 3 * dpr]);
    ctx.beginPath(); ctx.arc(g.x, g.py, g.rad, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = css('--accent'); ctx.beginPath(); ctx.arc(g.x + g.rad, g.py, 4 * dpr, 0, Math.PI * 2); ctx.fill();
    const bh = 24 * dpr, bx = g.x - 3 * dpr, by = H - 8 * dpr - bh;
    ctx.fillStyle = css('--bg-4'); ctx.fillRect(bx, by, 6 * dpr, bh);
    ctx.fillStyle = css('--text-2'); ctx.fillRect(bx, by + bh * (1 - g.alpha), 6 * dpr, bh * g.alpha);
    g.bar = { x: bx, y: by, h: bh };
  }
  model = { ...hero, ghosts, dpr, scale };
}
const b = (c) => Math.round(Math.max(0, Math.min(1, c)) * 255);
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; }
function note(text) {
  const dpr = model?.dpr || 1;
  ctx.fillStyle = css('--text-3'); ctx.font = `${11 * (window.devicePixelRatio || 1)}px Inter, sans-serif`;
  ctx.fillText(text, 12 * dpr, 20 * dpr);
}

// ---------------------------------------------------------------- editing
function zoneAt(e) {
  if (!model) return null;
  const r = canvas.getBoundingClientRect(); const dpr = model.dpr;
  const x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr;
  let best = null, bd = Infinity;
  model.ghosts.forEach((g, i) => { const d = Math.abs(g.x - x); if (d < bd) { bd = d; best = i; } });
  if (best === null || bd > 40 * dpr) return null;
  const g = model.ghosts[best];
  if (y >= g.bar.y - 6 * dpr) return { i: best, part: 'fade' };
  if (Math.abs(x - (g.x + g.rad)) < 8 * dpr && Math.abs(y - g.py) < 10 * dpr) return { i: best, part: 'rim' };
  if (Math.hypot(x - g.x, y - g.py) <= Math.max(g.rad, 10 * dpr)) return { i: best, part: 'body' };
  return { i: best, part: 'rim' };
}

// Find (or make) the curve/gradient node that drives an input over life. Returns { node, key } of the
// curve/gradient socket to key, or null when it could not be arranged.
function overLifeDriver(owner, key, kind) {
  const g = graph();
  const l = PGRAPH.linksInto(g, owner.id, key)[0];
  const src = l ? g.nodes[l.fromNode] : null;
  const want = kind === 'gradient' ? 'cadence.color.sampleGradient' : 'cadence.curve.evaluate';
  if (src && src.type.startsWith(want)) {
    const pos = PGRAPH.linksInto(g, src.id, 'position')[0];
    if (pos && g.nodes[pos.fromNode]?.type.startsWith('cadence.particles.life')) return { node: src, key: kind === 'gradient' ? 'gradient' : 'curve' };
  }
  return null;
}
function ensureOverLife(owner, key, kind) {
  const have = overLifeDriver(owner, key, kind);
  if (have) return have;
  // Make it vary over life through the same entry the sheet offers, so the strip never has a private
  // way of building a graph.
  const sock = PGRAPH.socketsOf(graph(), owner).inputs.find((s) => s.key === key);
  let made = null;
  ST.mutatePnx((g) => {
    const n = g.nodes[owner.id];
    const s = PGRAPH.socketsOf(g, n).inputs.find((x) => x.key === key);
    const m = MENUS.menuFor(g, n, s);
    const entry = m.curated.find((e) => e.id === 'overLife');
    if (!entry) throw new Error(`${s.label} cannot vary over life`);
    made = MENUS.applyEntry(g, n, s, entry);
  }, { structural: true });
  void sock;
  toast(`${key === 'baseColor' ? 'Colour' : key[0].toUpperCase() + key.slice(1)} now varies over its life — Ctrl+Z undoes`);
  return overLifeDriver(graph().nodes[owner.id], key, kind);
}
function setKey(driver, u, value, { undoable = false } = {}) {
  ST.mutatePnx((g) => {
    const n = g.nodes[driver.node.id];
    const cur = n.values?.[driver.key] || (driver.key === 'gradient' ? { kind: 'color', stops: [] } : { kind: 'float', keys: [] });
    const next = structuredClone(cur);
    if (driver.key === 'gradient') {
      next.stops = next.stops || [];
      const k = next.stops.find((s) => Math.abs(s.u - u) < 0.02);
      if (k) k.v = value; else next.stops.push({ u, v: value });
      next.stops.sort((a, b2) => a.u - b2.u);
    } else {
      next.keys = next.keys || [];
      const k = next.keys.find((s) => Math.abs(s.t - u) < 0.02);
      if (k) k.v = value; else next.keys.push({ t: u, v: value });
      next.keys.sort((a, b2) => a.t - b2.t);
    }
    PGRAPH.setNodeValue(g, n.id, driver.key, next);
  }, { nodeId: driver.node.id, undoable });
}
const hex = (c) => '#' + [c[0], c[1], c[2]].map((v) => b(v).toString(16).padStart(2, '0')).join('');

function onDown(e) {
  const z = zoneAt(e);
  if (!z || !model) return;
  const g = model.ghosts[z.i];
  if (z.part === 'body') {
    // colour: a gradient stop at this life
    const owner = model.material;
    if (!owner) { toast('Add a material to colour the particle'); return; }
    pickColor({ title: `Colour at ${Math.round(g.u * 100)} % of life`, initial: [g.color[0], g.color[1], g.color[2]] }).then((c) => {
      if (!c) return;
      const driver = ensureOverLife(owner, 'baseColor', 'gradient');
      if (driver) setKey(driver, g.u, hex(c), { undoable: true });
    });
    return;
  }
  const owner = z.part === 'rim' ? model.sprite : model.material;
  const key = z.part === 'rim' ? 'size' : 'opacity';
  if (!owner) return;
  const driver = ensureOverLife(owner, key, 'curve');
  if (!driver) return;
  ST.beginGesture();
  drag = { z, driver, ghost: g };
  canvas.setPointerCapture(e.pointerId);
}
function onMove(e) {
  if (!drag || !model) return;
  const r = canvas.getBoundingClientRect(); const dpr = model.dpr;
  const x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr;
  const g = drag.ghost;
  if (drag.z.part === 'rim') {
    const rad = Math.max(1, x - g.x);
    const size = Math.round((rad / (model.scale * 0.9)) * 1000) / 1000;
    setKey(drag.driver, g.u, size);
  } else {
    const a = Math.max(0, Math.min(1, 1 - (y - g.bar.y) / g.bar.h));
    setKey(drag.driver, g.u, Math.round(a * 100) / 100);
  }
}
function onUp(e) {
  if (!drag) return;
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* fine */ }
  drag = null;
  ST.endGesture();
}

export function heroModel() { return model ? { ghosts: model.ghosts.map((g) => ({ u: g.u, size: g.size, alpha: g.alpha, color: g.color })) } : null; }
