// The studio's PNX session: one long-lived evaluator per graph, and the frame→draw-list pipeline.
//
// WHY THE EVALUATOR IS LONG-LIVED, and why that is the whole reason this module exists rather than the
// preview calling evaluateOnce(): a simulation's state lives in the evaluator (evaluator.js's
// `persistent` map). Constructing a fresh evaluator per frame would restart every particle system on
// every frame — the effect would look like it was permanently at frame 1. So the session owns one
// evaluator, feeds it the playhead, and invalidates it on graph edits.
//
// THE INVALIDATION CONTRACT is the part worth getting right, because both failure modes are bad:
//   - Too little: a stale cached value, or a simulation whose history came from a different graph.
//   - Too much: dropping the simulation on every playhead move, which is the "stuck at frame 1" bug.
// So: playhead moves call setTime() (time-dependent cache only, simulations survive). Graph edits call
// invalidateNode() for a value change, or invalidateAll() when the graph object itself is replaced.

import { Evaluator } from '../../renderer/js/pnx/evaluator.js';
import * as PGRAPH from '../../renderer/js/pnx/graph.js';
import * as RENDER from '../../renderer/js/pnx/render.js';
import { getNode as getNodeType } from '../../renderer/js/pnx/registry.js';
import { buildRobloxExport, analyseForRoblox } from '../../renderer/js/pnx/targets/roblox.js';
import '../../renderer/js/pnx/nodes/index.js';

const OUTPUT_TYPE = 'cadence.render.output';

let session = null;

export function hasSession() {
  return !!session;
}

export function currentGraph() {
  return session ? session.graph : null;
}

// Start (or restart) a session on a graph. Called when a PNX document is opened or created.
export function openSession(graph, { fps = 30, duration = 60, seed = 0 } = {}) {
  session = {
    graph,
    evaluator: new Evaluator(graph, { fps, duration, seed, profiling: false }),
    lastFrame: -1,
    lastScene: { draws: [], stats: {} },
    lastDiagnostics: [],
    outputNodeId: findOutputNode(graph),
  };
  return session;
}

export function closeSession() {
  session = null;
}

// The node whose value is the scene. An explicit Effect Output if there is one; otherwise the newest
// render command in the graph, so a half-built graph still previews — which matters more than it
// sounds, because "add a sprite renderer and see nothing until you also add an output node" is a
// genuinely discouraging first experience.
function findOutputNode(graph) {
  const nodes = Object.values(graph.nodes || {});
  const explicit = nodes.find((n) => n.type.startsWith(OUTPUT_TYPE));
  if (explicit) return explicit.id;
  const renderers = nodes.filter((n) => {
    const def = getNodeType(n.type);
    return def && def.outputs.some((s) => s.type && s.type.name === 'renderCommand');
  });
  return renderers.length ? renderers[renderers.length - 1].id : null;
}

// Re-find the output after a structural change. Cheap, and it means dropping in an Effect Output node
// takes effect immediately rather than after a reload.
export function refreshOutput() {
  if (session) session.outputNodeId = findOutputNode(session.graph);
}

// A value or link changed on one node.
export function invalidateNode(nodeId) {
  if (!session) return;
  session.evaluator.invalidateNode(nodeId);
  refreshOutput();
}

// The graph object itself was replaced (undo, open, paste). Everything goes, including simulations —
// a history produced by a different graph is not a valid starting point for this one.
export function invalidateAll(graph = null) {
  if (!session) return;
  if (graph) {
    session.graph = graph;
    session.evaluator.graph = graph;
  }
  session.evaluator.invalidateAll();
  session.lastFrame = -1;
  refreshOutput();
}

export function setOptions({ fps, duration, seed }) {
  if (!session) return;
  const e = session.evaluator;
  if (fps !== undefined && fps !== e.options.fps) e.setOption('fps', fps);
  if (duration !== undefined && duration !== e.options.duration) e.setOption('duration', duration);
  if (seed !== undefined && seed !== e.options.seed) e.setOption('seed', seed);
}

// Evaluate one frame into a draw list. Returns null when there is nothing to draw, which the caller
// treats as "clear the backend" rather than as an error — an empty graph is a normal state.
export function evaluateFrame(frame) {
  if (!session) return null;
  const { evaluator } = session;
  evaluator.setTime(frame);

  if (!session.outputNodeId) {
    session.lastScene = { draws: [], stats: { commands: 0 } };
    session.lastDiagnostics = [];
    return session.lastScene;
  }

  const result = evaluator.evaluateSocket(session.outputNodeId, 'out');
  session.lastDiagnostics = result.diagnostics || [];

  const commands = RENDER.flattenCommands(result.value);
  const scene = RENDER.resolveScene(commands, {
    time: evaluator.options.time,
    frame: evaluator.options.frame,
  });
  // The strip backend scrolls texture UVs by time; pass it through on the draws so the backend needs
  // no clock of its own (and so a bake gets the same numbers).
  for (const d of scene.draws) d.time = evaluator.options.time;

  session.lastFrame = frame;
  session.lastScene = scene;
  session.lastCommands = commands;
  return scene;
}

// Read one socket's value at the current frame, for an inspector or an MCP inspect call. Goes through
// the SAME evaluator as the preview, so what an inspector shows is what is actually being drawn — a
// separate one-shot evaluation would report a simulation restarted from frame 0 rather than the live
// one, which is exactly the sort of discrepancy that sends someone debugging the wrong thing.
export function inspectSocket(nodeId, socketKey) {
  if (!session) return null;
  const r = session.evaluator.evaluateSocket(nodeId, socketKey);
  return r.value;
}

// ---------------------------------------------------------------- export (Parts 56-58)
// The export takes an `evaluateFrame` that runs through THIS session's evaluator, because a bake has to
// see the same simulation the preview shows. Handing the exporter a fresh evaluator would bake a
// simulation restarted from frame 0 at every frame — a recording of nothing but spawn.
//
// The playhead is saved and restored around the bake: a bake walks the whole frame range, and leaving the
// user's playhead wherever the last baked frame happened to be would look like the export moved their
// timeline.
export function exportRoblox({ name = 'Procedural Effect', fps = 30, duration = 60, bake = {} } = {}) {
  if (!session) return null;
  const { evaluator } = session;
  const savedFrame = evaluator.options.frame;

  evaluator.setTime(Math.floor(duration / 2));
  const mid = evaluateFrame(Math.floor(duration / 2));
  const commands = session.lastCommands || [];

  try {
    return buildRobloxExport({
      commands, graph: session.graph, evaluator,
      evaluateFrame: (frame) => evaluateFrame(frame),
      name, fps, duration, bake,
    });
  } finally {
    evaluator.setTime(savedFrame);
    evaluateFrame(savedFrame);
  }
}

// The classification without doing the work. Cheap enough to show live in a panel, which is the point:
// a user should know a pass will be baked before they press Export, not after.
export function robloxAnalysis() {
  if (!session) return null;
  return analyseForRoblox(session.lastCommands || [], { graph: session.graph, evaluator: session.evaluator });
}

// ---------------------------------------------------------------- reporting (Parts 52, 57, 61-62)
// What the diagnostics panel and the MCP verification tools read. Deliberately structured, and
// deliberately silent about whether the effect looks good.
export function report() {
  if (!session) return { ok: true, active: false, diagnostics: [], stats: {} };
  const { evaluator, lastScene, lastDiagnostics } = session;
  const graphCheck = evaluator.validateGraph();

  const diagnostics = [
    ...graphCheck.diagnostics,
    ...lastDiagnostics.filter((d) => !graphCheck.diagnostics.some((g) => g.message === d.message && g.nodeId === d.nodeId)),
  ];

  // The specific, actionable "nothing is on screen" cases (Part 61's list). Each names what to check
  // rather than merely observing that the output is empty.
  const stats = lastScene.stats || {};
  const drawn = (stats.sprites || 0) + (stats.meshes || 0) + (stats.instances || 0) + (stats.stripVertices || 0) + (stats.lights || 0);
  if (!session.outputNodeId) {
    diagnostics.push({
      severity: 'warning', nodeId: null, code: 'noOutput',
      message: 'Nothing is connected to an Effect Output, so nothing is drawn. Add an Effect Output node and connect a renderer to it.',
    });
  } else if (!stats.commands) {
    diagnostics.push({
      severity: 'warning', nodeId: session.outputNodeId, code: 'noPasses',
      message: 'The Effect Output has no render passes connected.',
    });
  } else if (!drawn) {
    // Frame 0 of a particle graph legitimately has nothing in it — the emitter has not stepped yet.
    // Reporting that as a warning meant every newly-created procedural effect greeted its author with
    // "1 warning" on a graph that is working perfectly, which teaches people to ignore the count.
    // Node types are STORED versioned ('cadence.particles.simulate@1' — see graph.js newNode), so
    // this has to compare the bare id, not the stored string.
    const simulates = Object.values(session.graph.nodes || {})
      .some((n) => String(n.type).split('@')[0] === 'cadence.particles.simulate');
    const atStart = (session.lastFrame ?? 0) <= 0;
    diagnostics.push(simulates && atStart
      ? {
        severity: 'info', nodeId: session.outputNodeId, code: 'nothingDrawnYet',
        message: 'Nothing is drawn at frame 0 — particles have not been emitted yet. Scrub forward to see the effect.',
      }
      : {
        severity: 'warning', nodeId: session.outputNodeId, code: 'nothingDrawn',
        message: 'There are render passes but nothing to draw at this frame. Check that the particles or geometry feeding them are not empty.',
      });
  }

  return {
    ok: !diagnostics.some((d) => d.severity === 'error'),
    active: true,
    diagnostics,
    stats: {
      ...stats,
      frame: evaluator.options.frame,
      drawnElements: drawn,
      nodes: Object.keys(session.graph.nodes || {}).length,
      links: Object.keys(session.graph.links || {}).length,
      cacheEntries: evaluator.cache.size,
      simulations: evaluator.persistent.size,
    },
  };
}

// Backend compatibility for the currently-evaluated scene (Part 57).
export function compatibility(backend = 'roblox') {
  if (!session || !session.lastCommands) return null;
  return RENDER.backendReport(session.lastCommands, backend);
}

// Per-node timing. Profiling is off by default because it costs a clock read per node per frame.
export function profile(frame, { enable = true } = {}) {
  if (!session) return null;
  const { evaluator } = session;
  const was = evaluator.options.profiling;
  evaluator.options.profiling = enable;
  evaluator.profile.clear();
  evaluator.invalidateAll();          // a cached graph profiles as zero, which is useless
  evaluateFrame(frame);
  const out = evaluator.profileReport();
  evaluator.options.profiling = was;
  return out;
}

// ---------------------------------------------------------------- a starting graph
// What "New procedural effect" produces. Not a preset in the Part 73 sense — it is the smallest graph
// that draws something, so the first thing a user sees is a working effect they can take apart rather
// than an empty canvas and a node menu. Every node in it is a primitive.
export function newStarterGraph(name = 'Untitled Procedural Effect') {
  const g = PGRAPH.newGraph(name);
  const at = (type, x, y, values) => PGRAPH.newNode(g, type, x, y, values ? { values } : {});
  const wire = (a, sa, b, sb) => PGRAPH.connect(g, a.id, sa, b.id, sb);

  // The coordinates below are laid out against the node editor's REAL box size — 268px wide, and one
  // 22px row per socket on top of a 26px header. That makes the boxes much taller than they look in a
  // diagram: Simulate Particles is 13 rows and 316px tall. Positions picked by eye against the old
  // guess put three nodes on top of each other the first time the canvas actually drew this graph.
  // Columns are 328px apart (268 + 60), and nodes sharing a column are spaced by their own height.

  // A sphere to emit from, a burst emitter, gravity, and a sprite pass coloured by age.
  const sphere = at('cadence.geometry.sphere', -980, -60, { radius: 0.4, segments: 12, rings: 6 });
  const emitter = at('cadence.particles.emitter', -652, -160, {
    emitFrom: 'surface', rate: 34, lifetime: 1.6, velocity: [0, 4, 0], burstCount: 0,
  });
  const gravity = at('cadence.fields.constantDirection', -652, 120, { direction: [0, -1, 0], strength: 6 });
  const sim = at('cadence.particles.simulate', -324, -120, { maxParticles: 4000, drag: 0.6 });

  // Colour and size over life, built the way the engine intends: Normalized Age into a gradient and a
  // curve. This is the pattern that replaces every "over lifetime" property in the engine, so the
  // starter graph demonstrates it rather than describing it.
  const life = at('cadence.particles.life', -324, 240);
  const grad = at('cadence.color.sampleGradient', 4, 60, {
    // White-hot to orange to dark red: the standard cooling ramp, and legible enough that dragging a
    // stop shows immediately what a gradient does.
    gradient: {
      kind: 'color',
      stops: [{ u: 0, v: '#fff6e0' }, { u: 0.25, v: '#ffb040' }, { u: 0.7, v: '#c02808' }, { u: 1, v: '#200400' }],
    },
  });
  const size = at('cadence.curve.evaluate', 4, 250, {
    // Grow fast, then shrink away — a shape a linear ramp cannot give, which is the point of it being
    // a curve rather than two numbers.
    curve: { kind: 'float', keys: [{ t: 0, v: 0.05 }, { t: 0.2, v: 0.45 }, { t: 1, v: 0 }] },
  });
  // Additive blending SUMS overlapping sprites, so opacity has to come down as the count goes up or
  // the middle of the plume clips to white and the gradient stops being visible at all. Emission is
  // deliberately NOT wired to the same gradient as base colour: adding them doubles every channel and
  // blows out the highlights, which is what made the first version of this graph a white blob.
  const mat = at('cadence.material.surface', 332, -20, { blend: 'additive', opacity: 0.35 });
  const spr = at('cadence.render.sprite', 660, -80);
  const output = at('cadence.render.output', 988, 10);

  wire(sphere, 'out', emitter, 'shape');
  wire(emitter, 'out', sim, 'emitter');
  wire(gravity, 'out', sim, 'force');
  wire(life, 'out', grad, 'position');
  wire(life, 'out', size, 'position');
  wire(grad, 'out', mat, 'baseColor');
  wire(size, 'out', spr, 'size');
  wire(sim, 'out', spr, 'source');
  wire(mat, 'out', spr, 'material');
  wire(spr, 'out', output, 'passes');
  return g;
}
