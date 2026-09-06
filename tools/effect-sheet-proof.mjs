// PROOF SCRIPT for docs/effect-sheet.md — "the Effect Sheet is a lossless projection of a PNX graph".
// Plain Node, no Electron: node tools/effect-sheet-proof.mjs
//
// Loads the REAL Cadence registry (354 node types) and REAL graphs (the starter graph, every library
// recipe, and four hand-built Part-75 effects), and prints each one as a readable sheet:
//   thing → property → value-with-source, recursively, with fan-out turned into named values.
// Zero per-node hand-written text: every word comes from the registry (label / teach / input labels /
// units / options) or from the graph's own values. Then it derives the "source menu" per socket type
// from the registry, and times a hover-preview evaluation of a candidate edit.
import { pathToFileURL } from 'node:url';
// Repo-relative, so this runs from any checkout: node tools/effect-sheet-proof.mjs
const R = new URL('../', import.meta.url).href;
const imp = (p) => import(R + p);

const REG = await imp('renderer/js/pnx/registry.js');
const G = await imp('renderer/js/pnx/graph.js');
const T = await imp('renderer/js/pnx/types.js');
const LIB = await imp('renderer/js/pnx/library.js');
const EV = await imp('renderer/js/pnx/evaluator.js');
const RENDER = await imp('renderer/js/pnx/render.js');
const BAKE = await imp('renderer/js/pnx/bake.js');
const F = await imp('renderer/js/pnx/fields.js');
await imp('renderer/js/pnx/nodes/index.js');
const STUDIO = await imp('renderer-vfx/js/pnxStudio.js');

// ---------------------------------------------------------------- 1. the projection
// A "thing" is any node that produces a renderCommand (or the Effect Output). Everything else is a
// source that some thing's property pulls on. Nodes with more than one consumer become named values.
const fmtNum = (v) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100);
function fmtValue(v, socket) {
  const type = T.isFieldType(socket.type) ? socket.type.param : socket.type;
  const name = type?.name;
  const unit = socket.unit ? ' ' + socket.unit : '';
  if (v === undefined || v === null) return '(nothing)';
  if (name === 'color' && Array.isArray(v)) return '■ rgb(' + v.slice(0, 3).map((c) => Math.round(c * 255)).join(',') + ')';
  if (name === 'gradient' || (v && Array.isArray(v.stops))) return 'gradient ' + (v.stops || []).map((s) => s.v).join(' → ');
  if (name === 'curve' || (v && Array.isArray(v.keys))) return 'curve ' + (v.keys || []).map((k) => `${fmtNum(k.v)}@${fmtNum(k.t)}`).join(' → ');
  if (Array.isArray(v)) return '(' + v.map(fmtNum).join(', ') + ')' + unit;
  if (typeof v === 'number') return fmtNum(v) + unit;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

function consumersOf(graph) {
  const m = new Map();
  for (const l of Object.values(graph.links)) {
    const k = l.fromNode;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function projectGraph(graph, { scope = G.ROOT_SCOPE } = {}) {
  const nodes = G.nodesInScope(graph, scope);
  const consumers = consumersOf(graph);
  const out = [];
  const named = new Map();     // nodeId -> name (fan-out values)
  const visited = new Set();
  let nameCounter = 0;

  const defOf = (n) => (G.isGroupInstanceType(n.type) ? { label: graph.groups[G.groupIdOfType(n.type)]?.name || 'Group', teach: graph.groups[G.groupIdOfType(n.type)]?.description } : REG.getNode(n.type));
  const isThing = (n) => {
    if (G.isGroupBoundaryType(n.type)) return false;
    const def = REG.getNode(n.type);
    return !!def && def.outputs.some((s) => s.type?.name === 'renderCommand');
  };

  // Where does a socket's value come from? A wire, or the node's own value, or the registry default.
  function sourceLines(node, socket, depth) {
    const links = G.linksInto(graph, node.id, socket.key);
    const pad = '  '.repeat(depth);
    if (!links.length) {
      if (socket.defaultFrom) return [`${pad}${socket.label}: (each particle's own ${socket.defaultFrom})`];
      if (!T.containsGeneric(socket.type) && socket.type?.name && !['float', 'int', 'bool', 'string', 'vector2', 'vector3', 'vector4', 'color', 'curve', 'gradient', 'quaternion'].includes((T.isFieldType(socket.type) ? socket.type.param : socket.type)?.name)) {
        // a wire-only type with nothing wired: say what it falls back to
        return [`${pad}${socket.label}: ${socket.defaultFrom ? '(its own ' + socket.defaultFrom + ')' : '(nothing)'}`];
      }
      const v = node.values?.[socket.key] !== undefined ? node.values[socket.key] : socket.default;
      const opt = socket.options ? '  ▾' : '';
      return [`${pad}${socket.label}: ${fmtValue(v, socket)}${opt}`];
    }
    const lines = [];
    const heads = [];
    for (const l of links) {
      const src = graph.nodes[l.fromNode];
      const rendered = renderSource(src, l.fromSocket, depth + 1);
      heads.push(rendered.head);
      lines.push(...rendered.body);
    }
    lines.unshift(`${pad}${socket.label}: ${heads.join(' + ')}`);
    return lines;
  }

  // Render a source node as a phrase (head) plus its own inputs (body), recursively. A node that feeds
  // more than one consumer becomes a named value, defined once under "Values used in several places".
  function renderSource(src, fromSocket, depth) {
    const def = defOf(src);
    const outSock = G.socketsOf(graph, src).outputs.find((s) => s.key === fromSocket);
    const via = outSock && G.socketsOf(graph, src).outputs.length > 1 ? ` (its ${outSock.label})` : '';
    const label = def?.label || src.type;
    if ((consumers.get(src.id) || 0) > 1) {
      if (!named.has(src.id)) {
        named.set(src.id, `«${label}${++nameCounter > 1 ? ' ' + nameCounter : ''}»`);
      }
      return { head: named.get(src.id) + via, body: [] };
    }
    if (isThing(src)) return { head: `[${label}]` + via, body: [] };
    const body = [];
    const { inputs } = G.socketsOf(graph, src);
    for (const s of inputs) body.push(...sourceLines(src, s, depth));
    visited.add(src.id);
    return { head: `${label}${via}`, body };
  }

  function renderThing(n) {
    const def = defOf(n);
    const lines = [`• ${def?.label || n.type}${def?.teach ? '  — ' + def.teach : ''}`];
    const { inputs } = G.socketsOf(graph, n);
    for (const s of inputs) lines.push(...sourceLines(n, s, 1));
    visited.add(n.id);
    return lines;
  }

  const outputNode = nodes.find((n) => n.type.startsWith('cadence.render.output'));
  const things = nodes.filter(isThing);
  const order = outputNode
    ? G.linksInto(graph, outputNode.id, 'passes').map((l) => graph.nodes[l.fromNode]).filter(Boolean)
    : things.filter((n) => !n.type.startsWith('cadence.render.output'));
  for (const t of order) out.push(...renderThing(t), '');
  if (outputNode) visited.add(outputNode.id);

  // Named (fan-out) values, defined once.
  if (named.size) {
    out.push('Values used in several places:');
    for (const [id, name] of named) {
      const src = graph.nodes[id];
      const def = defOf(src);
      const { inputs } = G.socketsOf(graph, src);
      const body = [];
      for (const s of inputs) body.push(...sourceLines(src, s, 2));
      out.push(`  ${name} = ${def?.label}${def?.teach ? '  — ' + def.teach : ''}`, ...body);
      visited.add(id);
    }
    out.push('');
  }
  // Anything not reached from a thing is "not used" — shown, never hidden.
  const unused = nodes.filter((n) => !visited.has(n.id) && !G.isGroupBoundaryType(n.type));
  if (unused.length) out.push('Not used by anything drawn: ' + unused.map((n) => defOf(n)?.label || n.type).join(', '), '');
  return { text: out.join('\n'), covered: visited.size, total: nodes.filter((n) => !G.isGroupBoundaryType(n.type)).length, named: named.size };
}

// ---------------------------------------------------------------- 2. graphs to project
const graphs = [];
graphs.push(['STARTER GRAPH (what "New procedural effect" opens)', STUDIO.newStarterGraph('Starter')]);

// Four Part-75 effects, hand-built from primitives (the exact node ids the stress test names).
function sparksOnFloor() {
  const g = G.newGraph('Sparks bouncing on the floor');
  const at = (type, values) => G.newNode(g, type, 0, 0, values ? { values } : {});
  const w = (a, sa, b, sb) => { const r = G.connect(g, a.id, sa, b.id, sb); if (!r.ok) throw new Error(r.reason); };
  const pt = at('cadence.geometry.point', { position: [0, 3, 0] });
  const dir = at('cadence.random.cone', { axis: [0, 1, 0], angle: 35 });
  const speed = at('cadence.random.float', { min: 8, max: 14 });
  const vel = at('cadence.math.multiply', {});
  const em = at('cadence.particles.emitter', { rate: 0, burstCount: 150, lifetime: 1.4 });
  const gravity = at('cadence.fields.constantDirection', { direction: [0, -1, 0], strength: 20 });
  const floor = at('cadence.sdf.plane', { normal: [0, 1, 0], point: [0, 0, 0] });
  const col = at('cadence.particles.collider', { response: 'bounce', restitution: 0.5 });
  const sim = at('cadence.particles.simulate', { maxParticles: 2000 });
  const life = at('cadence.particles.life');
  const grad = at('cadence.color.sampleGradient', { gradient: { kind: 'color', stops: [{ u: 0, v: '#ffffff' }, { u: 0.3, v: '#ffc040' }, { u: 1, v: '#ff2000' }] } });
  const fade = at('cadence.math.subtract', { a: 1 });
  const mat = at('cadence.material.surface', { blend: 'additive' });
  const spr = at('cadence.render.sprite', { size: 0.12, facing: 'velocity' });
  const outp = at('cadence.render.output');
  w(pt, 'out', em, 'shape'); w(dir, 'out', vel, 'a'); w(speed, 'out', vel, 'b'); w(vel, 'out', em, 'velocity');
  w(em, 'out', sim, 'emitter'); w(gravity, 'out', sim, 'force'); w(floor, 'out', col, 'shape'); w(col, 'out', sim, 'colliders');
  w(life, 'out', grad, 'position'); w(life, 'out', fade, 'b'); w(grad, 'out', mat, 'baseColor'); w(fade, 'out', mat, 'opacity');
  w(sim, 'out', spr, 'source'); w(mat, 'out', spr, 'material'); w(spr, 'out', outp, 'passes');
  return g;
}
function shockwave() {
  const g = G.newGraph('Shockwave ring');
  const at = (type, values) => G.newNode(g, type, 0, 0, values ? { values } : {});
  const w = (a, sa, b, sb) => { const r = G.connect(g, a.id, sa, b.id, sb); if (!r.ok) throw new Error(r.reason); };
  const t = at('cadence.time.effectTime');
  const radius = at('cadence.curve.evaluate', { curve: { kind: 'float', keys: [{ t: 0, v: 0.2 }, { t: 0.6, v: 9 }, { t: 1, v: 11 }] } });
  const opacity = at('cadence.curve.evaluate', { curve: { kind: 'float', keys: [{ t: 0, v: 1 }, { t: 1, v: 0 }] } });
  const inner = at('cadence.math.subtract', { b: 0.6 });
  const disc = at('cadence.geometry.disc', { plane: 'xz', segments: 64 });
  const mat = at('cadence.material.surface', { baseColor: [0.6, 0.8, 1, 1], blend: 'additive' });
  const mesh = at('cadence.render.mesh');
  const outp = at('cadence.render.output');
  w(t, 'normalized', radius, 'position'); w(t, 'normalized', opacity, 'position');
  w(radius, 'out', disc, 'radius'); w(radius, 'out', inner, 'a'); w(inner, 'out', disc, 'innerRadius');
  w(opacity, 'out', mat, 'opacity'); w(disc, 'out', mesh, 'source'); w(mat, 'out', mesh, 'material'); w(mesh, 'out', outp, 'passes');
  return g;
}
function slashTrail() {
  const g = G.newGraph('Sword slash');
  const at = (type, values) => G.newNode(g, type, 0, 0, values ? { values } : {});
  const w = (a, sa, b, sb) => { const r = G.connect(g, a.id, sa, b.id, sb); if (!r.ok) throw new Error(r.reason); };
  const arc = at('cadence.curveGeometry.arc', { radius: 3, startAngle: -60, sweep: 120, segments: 24 });
  const width = at('cadence.curve.evaluate', { curve: { kind: 'float', keys: [{ t: 0, v: 0.05 }, { t: 0.5, v: 0.7 }, { t: 1, v: 0.05 }] } });
  const grad = at('cadence.color.sampleGradient', { gradient: { kind: 'color', stops: [{ u: 0, v: '#ffffff' }, { u: 1, v: '#40a0ff' }] } });
  const mat = at('cadence.material.surface', { blend: 'additive' });
  const trail = at('cadence.render.trail');
  const outp = at('cadence.render.output');
  w(width, 'out', trail, 'width'); w(grad, 'out', mat, 'baseColor'); w(arc, 'out', trail, 'source'); w(mat, 'out', trail, 'material'); w(trail, 'out', outp, 'passes');
  return g;
}
function fireTextureSprite() {
  const g = G.newGraph('Fire sprite from a procedural texture');
  const at = (type, values) => G.newNode(g, type, 0, 0, values ? { values } : {});
  const w = (a, sa, b, sb) => { const r = G.connect(g, a.id, sa, b.id, sb); if (!r.ok) throw new Error(r.reason); };
  const noise = at('cadence.noise.fbm', { scale: 3, octaves: 4 });
  const ras = at('cadence.texture.rasterize', { resolution: 64 });
  const levels = at('cadence.texture.levels', { inputBlack: 0.3, inputWhite: 0.7 });
  const gm = at('cadence.texture.gradientMap', { gradient: { kind: 'color', stops: [{ u: 0, v: '#000000' }, { u: 0.5, v: '#c02000' }, { u: 1, v: '#fff8e0' }] } });
  const mat = at('cadence.material.surface', { blend: 'additive' });
  const sphere = at('cadence.geometry.sphere', { radius: 0.3 });
  const em = at('cadence.particles.emitter', { rate: 20, lifetime: 1.2, velocity: [0, 3, 0] });
  const up = at('cadence.fields.constantDirection', { direction: [0, 1, 0], strength: 4 });
  const curl = at('cadence.noise.curl', { scale: 0.6, octaves: 2 });
  const gain = at('cadence.math.multiply', { b: 5 });
  const total = at('cadence.math.add');
  const sim = at('cadence.particles.simulate', {});
  const spr = at('cadence.render.sprite', { size: 0.8 });
  const outp = at('cadence.render.output');
  w(noise, 'out', ras, 'field'); w(ras, 'out', levels, 'texture'); w(levels, 'out', gm, 'texture'); w(gm, 'out', mat, 'texture');
  w(sphere, 'out', em, 'shape'); w(em, 'out', sim, 'emitter');
  w(curl, 'out', gain, 'a'); w(up, 'out', total, 'a'); w(gain, 'out', total, 'b'); w(total, 'out', sim, 'force');
  w(sim, 'out', spr, 'source'); w(mat, 'out', spr, 'material'); w(spr, 'out', outp, 'passes');
  return g;
}
for (const f of [sparksOnFloor, shockwave, slashTrail, fireTextureSprite]) {
  try { const g = f(); graphs.push([g.name.toUpperCase(), g]); } catch (e) { console.log('BUILD FAILED', f.name, e.message); }
}

console.log('==================== SHEETS (generated, zero hand text) ====================');
const coverage = [];
for (const [title, g] of graphs) {
  const p = projectGraph(g);
  coverage.push({ title, covered: p.covered, total: p.total, named: p.named });
  console.log(`\n### ${title}\n${p.text}`);
}

// Every library recipe, projected as a group interior (the recipe's own sheet).
console.log('\n==================== LIBRARY RECIPES as sheets ====================');
for (const r of LIB.listRecipes()) {
  const g = G.newGraph('r');
  const res = LIB.buildRecipe(g, r.id);
  if (!res.ok) { console.log('recipe failed', r.id, res.reason); continue; }
  // Inside a group there is no renderer; project from the group's output node instead.
  const scope = res.groupId;
  const nodes = G.nodesInScope(g, scope);
  const gOut = nodes.find((n) => n.type === G.GROUP_OUTPUT_TYPE);
  // Temporarily treat the group's output node as the thing.
  const p = projectGroup(g, scope, gOut, r);
  coverage.push({ title: 'recipe ' + r.name, covered: p.covered, total: p.total, named: p.named });
  console.log(`\n### RECIPE: ${r.name} — ${r.description}\n${p.text}`);
}
function projectGroup(graph, scope, gOut, recipe) {
  // Reuse projectGraph's machinery by faking a renderer: simplest is to inline a small variant.
  const nodes = G.nodesInScope(graph, scope);
  const consumers = consumersOf(graph);
  const named = new Map(); const visited = new Set(); let c = 0;
  const lines = [];
  const groupDef = graph.groups[scope];
  function src(node, fromSocket, depth) {
    const def = node.type === G.GROUP_INPUT_TYPE ? { label: 'a setting you choose' } : REG.getNode(node.type);
    const outs = G.socketsOf(graph, node).outputs;
    const o = outs.find((s) => s.key === fromSocket);
    if (node.type === G.GROUP_INPUT_TYPE) { visited.add(node.id); return { head: `⟨${o?.label || fromSocket}⟩`, body: [] }; }
    const via = o && outs.length > 1 ? ` (its ${o.label})` : '';
    if ((consumers.get(node.id) || 0) > 1) {
      if (!named.has(node.id)) named.set(node.id, `«${def?.label}${++c > 1 ? ' ' + c : ''}»`);
      return { head: named.get(node.id) + via, body: [] };
    }
    visited.add(node.id);
    const body = [];
    for (const s of G.socketsOf(graph, node).inputs) body.push(...inp(node, s, depth));
    return { head: (def?.label || node.type) + via, body };
  }
  function inp(node, s, depth) {
    const pad = '  '.repeat(depth);
    const links = G.linksInto(graph, node.id, s.key);
    if (!links.length) {
      if (s.defaultFrom) return [`${pad}${s.label}: (each particle's own ${s.defaultFrom})`];
      const v = node.values?.[s.key] !== undefined ? node.values[s.key] : s.default;
      return [`${pad}${s.label}: ${fmtValue(v, s)}${s.options ? '  ▾' : ''}`];
    }
    const heads = []; const body = [];
    for (const l of links) { const r = src(graph.nodes[l.fromNode], l.fromSocket, depth + 1); heads.push(r.head); body.push(...r.body); }
    return [`${pad}${s.label}: ${heads.join(' + ')}`, ...body];
  }
  visited.add(gOut.id);
  for (const s of G.socketsOf(graph, gOut).inputs) lines.push(...inp(gOut, s, 1));
  if (named.size) {
    lines.push('  Values used in several places:');
    for (const [id, name] of named) {
      const node = graph.nodes[id]; visited.add(id);
      const def = REG.getNode(node.type);
      const body = []; for (const s of G.socketsOf(graph, node).inputs) body.push(...inp(node, s, 3));
      lines.push(`    ${name} = ${def?.label}`, ...body);
    }
  }
  const total = nodes.filter((n) => !G.isGroupBoundaryType(n.type)).length;
  const covered = [...visited].filter((id) => !G.isGroupBoundaryType(graph.nodes[id].type)).length;
  return { text: lines.join('\n'), covered, total, named: named.size };
}

console.log('\n==================== COVERAGE ====================');
for (const c of coverage) console.log(`${c.title.padEnd(60)} ${c.covered}/${c.total} nodes reached from the drawn things, ${c.named} named values`);

// ---------------------------------------------------------------- 3. the source menu, derived
// For each leaf type a slot can have, which registry nodes can feed it (directly, or as a field of it)?
console.log('\n==================== SOURCE MENU per slot type (derived from the registry) ====================');
const leafTypes = ['float', 'int', 'bool', 'vector3', 'color', 'geometry', 'texture2d', 'material', 'emitter', 'collider', 'curve', 'gradient', 'renderCommand', 'instanceSet'];
const nodes = REG.currentNodes();
for (const lt of leafTypes) {
  const want = T.parseType(lt);
  const feeders = nodes.filter((n) => n.outputs.some((o) => {
    if (T.containsGeneric(o.type)) return ['float', 'int', 'vector3', 'color', 'bool'].includes(lt) && !['geometry', 'texture2d', 'material', 'emitter', 'collider', 'renderCommand', 'instanceSet'].includes(lt);
    return T.canConnect(o.type, want) || T.canConnect(o.type, T.fieldOf(want));
  }));
  const byCat = {};
  for (const n of feeders) (byCat[n.category] ||= []).push(n.label);
  console.log(`\n${lt}: ${feeders.length} possible sources — ` + Object.entries(byCat).map(([c, l]) => `${c} ${l.length}`).join(', '));
}

// What can a value VARY WITH? The sample context, as the registry exposes it: nodes with no inputs whose
// output is a field (they read the sample point) plus defaultFrom sockets.
const readers = nodes.filter((n) => !n.inputs.length && n.outputs.some((o) => T.isFieldType(o.type)));
console.log('\nThings a value can vary with (input-less field readers in the registry):');
for (const n of readers) console.log(`  ${n.label.padEnd(22)} ${n.category.padEnd(12)} ${n.summary}`);

// ---------------------------------------------------------------- 4. hover preview cost
console.log('\n==================== HOVER-PREVIEW TIMING ====================');
function timeEval(graph, frame) {
  const ev = new EV.Evaluator(graph, { fps: 30, duration: 60 });
  const outNode = Object.values(graph.nodes).find((n) => n.type.startsWith('cadence.render.output'));
  const t0 = performance.now();
  ev.setTime(frame);
  const res = ev.evaluateSocket(outNode.id, 'out');
  const cmds = RENDER.flattenCommands(res.value);
  const scene = RENDER.resolveScene(cmds, {});
  const ms = performance.now() - t0;
  const drawn = (scene.draws || []).reduce((a, d) => a + (d.count || 0), 0);
  return { ms: Math.round(ms * 10) / 10, drawn, passes: cmds.length };
}
const starter = STUDIO.newStarterGraph('t');
console.log('starter @ frame 20 (fresh evaluator, cold):', timeEval(starter, 20));
console.log('starter @ frame 20 (again):', timeEval(starter, 20));
// candidate edit: make size vary by speed instead of by life
const cand = structuredClone(starter);
const spr = Object.values(cand.nodes).find((n) => n.type.startsWith('cadence.render.sprite'));
const speed = G.newNode(cand, 'cadence.particles.speed');
const map = G.newNode(cand, 'cadence.math.mapRange', 0, 0, { values: { fromMin: 0, fromMax: 8, toMin: 0.05, toMax: 0.6 } });
G.connect(cand, speed.id, 'out', map.id, 'value');
G.connect(cand, map.id, 'out', spr.id, 'size');
console.log('candidate "size by speed" @ frame 20:', timeEval(cand, 20));
const cand2 = structuredClone(starter);
const sim = Object.values(cand2.nodes).find((n) => n.type.startsWith('cadence.particles.simulate'));
const curl = G.newNode(cand2, 'cadence.noise.curl', 0, 0, { values: { scale: 0.5, octaves: 2 } });
const gain = G.newNode(cand2, 'cadence.math.multiply', 0, 0, { values: { b: 6 } });
G.connect(cand2, curl.id, 'out', gain.id, 'a'); G.connect(cand2, gain.id, 'out', sim.id, 'force');
console.log('candidate "force = swirl" @ frame 20:', timeEval(cand2, 20));
console.log('candidate "force = swirl" @ frame 60:', timeEval(cand2, 60));

// ---------------------------------------------------------------- 5. what does each wired field vary with? (structural, exact)
console.log('\n==================== "HOW DOES IT VARY" — read structurally off the graph ====================');
function variesWith(graph, nodeId, socketKey, seen = new Set()) {
  const axes = new Set();
  for (const l of G.linksInto(graph, nodeId, socketKey)) {
    const src = graph.nodes[l.fromNode];
    if (seen.has(src.id)) continue; seen.add(src.id);
    const def = REG.getNode(src.type);
    if (!def) continue;
    if (!def.inputs.length && def.outputs.some((o) => T.isFieldType(o.type))) axes.add(def.label);
    if (def.timeDependent) axes.add('Effect Time');
    if (def.category === 'Random') axes.add('Random per particle');
    if (def.category === 'Noise') axes.add('Noise');
    for (const s of def.inputs) {
      if (s.defaultFrom && !G.linksInto(graph, src.id, s.key).length) axes.add('its own ' + s.defaultFrom);
      for (const a of variesWith(graph, src.id, s.key, seen)) axes.add(a);
    }
  }
  return axes;
}
for (const [title, g] of graphs) {
  const rows = [];
  for (const n of Object.values(g.nodes)) {
    const def = REG.getNode(n.type); if (!def) continue;
    for (const s of def.inputs) {
      const links = G.linksInto(g, n.id, s.key); if (!links.length) continue;
      const v = variesWith(g, n.id, s.key);
      if (v.size) rows.push(`  ${def.label} › ${s.label}: varies with ${[...v].join(', ')}`);
    }
  }
  console.log(`\n${title}\n${rows.join('\n')}`);
}
