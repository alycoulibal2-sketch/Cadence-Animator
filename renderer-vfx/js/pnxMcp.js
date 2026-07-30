// PNX MCP handlers (spec Parts 59-62): structured graph control, introspection and verification.
//
// PART 59 IS EXPLICIT: "Do NOT require Claude to manipulate the UI visually. Give it structured graph
// APIs." So every handler here operates on the graph document, never on the canvas. Nothing in this
// file reads a DOM node or simulates a click.
//
// PART 60 (introspection) is what stops a caller inventing nodes and parameters that do not exist. The
// catalogue, node descriptions and search are served from the registry itself, so they cannot drift
// from what is actually registered — a describe call is generated from the same definition the
// evaluator runs.
//
// PART 61 IS THE ONE WORTH BEING CAREFUL ABOUT: "Claude must NEVER simply say Done." Every write
// handler returns a verification read-back — graph validity, diagnostics, and what the frame actually
// drew — following the same discipline the existing studio handlers already use. A caller cannot
// report success without having been handed the evidence, and `pnx_verify` exists so the evidence can
// be asked for directly.
//
// The line Part 62 draws is kept: everything reported here is TECHNICAL validity (did anything render,
// are the counts sane, is a value non-finite). Nothing here claims to judge whether an effect looks
// good.

import * as ST from './studioState.js';
import * as PNX from './pnxStudio.js';
import { pnxDrawStats } from './preview.js';
import * as PGRAPH from '../../renderer/js/pnx/graph.js';
import * as REG from '../../renderer/js/pnx/registry.js';
import * as RENDER from '../../renderer/js/pnx/render.js';
import { formatType } from '../../renderer/js/pnx/types.js';
import '../../renderer/js/pnx/nodes/index.js';

function requirePnx() {
  if (!ST.state.pnx) {
    throw new Error('No procedural effect is open. Call pnx_new to start one, or pnx_set_graph to load a graph.');
  }
  return ST.state.pnx;
}

function requireNode(nodeId) {
  const node = requirePnx().nodes[nodeId];
  if (!node) {
    const available = Object.keys(ST.state.pnx.nodes).slice(0, 20);
    throw new Error(`No node with id "${nodeId}". The graph has: ${available.join(', ')}${available.length === 20 ? ' …' : ''}. Call pnx_get_graph to see it.`);
  }
  return node;
}

// The uniform write read-back (Part 61). Deliberately includes what the CURRENT FRAME DREW, not only
// whether the graph parses: a graph can be perfectly valid and draw nothing, and that is the most
// common way a procedural effect is broken.
function writeResult(extra = {}) {
  const rep = PNX.report();
  return {
    ok: rep.ok,
    graph: PGRAPH.graphSummary ? PGRAPH.graphSummary(ST.state.pnx) : { nodes: Object.keys(ST.state.pnx.nodes).length },
    diagnostics: rep.diagnostics.filter((d) => d.severity === 'error' || d.severity === 'warning'),
    stats: rep.stats,
    ...extra,
  };
}

export const PNX_HANDLERS = {
  // ---------------------------------------------------------------- lifecycle
  pnx_new({ name, blank = false } = {}) {
    if (blank) ST.newBlankPnxGraph(name || 'Untitled Procedural Effect');
    else ST.newPnxEffect(name || 'Untitled Procedural Effect');
    return writeResult({ started: blank ? 'blank' : 'starter' });
  },

  pnx_close() {
    ST.closePnx();
    return { ok: true, active: false };
  },

  pnx_get_state() {
    const rep = PNX.report();
    return {
      active: rep.active,
      playhead: Math.floor(ST.state.playhead),
      playing: ST.state.playing,
      fps: ST.state.doc.fps || 30,
      duration: ST.state.doc.duration || 60,
      ok: rep.ok,
      stats: rep.stats,
      diagnosticCounts: rep.diagnostics.reduce((a, d) => ({ ...a, [d.severity]: (a[d.severity] || 0) + 1 }), {}),
      // What the BACKEND drew, as distinct from what the graph asked for. The two differing is worth
      // seeing — a light count capped by the backend, for instance.
      drawn: pnxDrawStats(),
    };
  },

  pnx_get_graph({ scope = null } = {}) {
    const g = requirePnx();
    const nodes = Object.values(g.nodes)
      .filter((n) => (scope ? n.scope === scope : true))
      .map((n) => ({
        id: n.id, type: n.type, x: n.x, y: n.y, scope: n.scope,
        ...(n.label ? { label: n.label } : {}),
        ...(n.muted ? { muted: true } : {}),
        ...(n.bypassed ? { bypassed: true } : {}),
        values: n.values,
      }));
    return {
      name: g.name,
      nodes,
      links: Object.values(g.links).map((l) => ({
        id: l.id, from: `${l.fromNode}.${l.fromSocket}`, to: `${l.toNode}.${l.toSocket}`,
      })),
      groups: Object.values(g.groups || {}).map((gr) => ({ id: gr.id, name: gr.name, inputs: gr.inputs, outputs: gr.outputs })),
    };
  },

  pnx_set_graph({ graph }) {
    const parsed = PGRAPH.parseGraph(graph);
    if (!parsed.ok) throw new Error(`Graph rejected: ${parsed.error}`);
    ST.pushUndo();
    ST.setPnxGraph(parsed.graph);
    return writeResult({ warnings: parsed.warnings || [] });
  },

  // ---------------------------------------------------------------- node editing (Part 59)
  pnx_add_node({ type, x = 0, y = 0, values = {}, scope = undefined, id = null }) {
    requirePnx();
    if (!REG.getNode(type)) {
      const near = REG.searchNodes(type, { limit: 5 }).map((n) => n.id);
      throw new Error(`No node type "${type}". Closest matches: ${near.join(', ') || 'none'}. Call pnx_search_nodes or pnx_catalogue.`);
    }
    let created = null;
    ST.mutatePnx((g) => {
      created = PGRAPH.newNode(g, type, x, y, { values, id, ...(scope ? { scope } : {}) });
    }, { structural: true });
    return writeResult({ nodeId: created.id, node: { id: created.id, type: created.type } });
  },

  pnx_remove_node({ nodeId }) {
    requireNode(nodeId);
    ST.mutatePnx((g) => PGRAPH.removeNode(g, nodeId), { structural: true });
    return writeResult({ removed: nodeId });
  },

  pnx_move_node({ nodeId, x, y }) {
    requireNode(nodeId);
    // Position is presentation only, so it does not invalidate anything — passing a nodeId here would
    // needlessly drop a running simulation every time a node was dragged.
    ST.mutatePnx((g) => { const n = g.nodes[nodeId]; n.x = x; n.y = y; }, { nodeId: '__layout__' });
    return { ok: true, nodeId, x, y };
  },

  pnx_set_value({ nodeId, socket, value }) {
    const node = requireNode(nodeId);
    const def = REG.getNode(node.type);
    if (def && !def.inputs.some((s) => s.key === socket)) {
      throw new Error(`Node "${node.type}" has no input "${socket}". It has: ${def.inputs.map((s) => s.key).join(', ')}.`);
    }
    ST.mutatePnx((g) => PGRAPH.setNodeValue(g, nodeId, socket, value), { nodeId });
    return writeResult({ nodeId, socket, value });
  },

  pnx_connect({ fromNode, fromSocket, toNode, toSocket }) {
    requireNode(fromNode);
    requireNode(toNode);
    let result = null;
    ST.mutatePnx((g) => { result = PGRAPH.connect(g, fromNode, fromSocket, toNode, toSocket); }, { structural: true });
    if (!result.ok) throw new Error(`Cannot connect: ${result.reason}`);
    return writeResult({ linkId: result.link.id });
  },

  pnx_disconnect({ linkId = null, toNode = null, toSocket = null }) {
    requirePnx();
    let removed = 0;
    ST.mutatePnx((g) => {
      if (linkId) { if (g.links[linkId]) { delete g.links[linkId]; removed = 1; } return; }
      for (const [id, l] of Object.entries(g.links)) {
        if (l.toNode === toNode && (!toSocket || l.toSocket === toSocket)) { delete g.links[id]; removed++; }
      }
    }, { structural: true });
    if (!removed) throw new Error('Nothing matched — no link was removed.');
    return writeResult({ removed });
  },

  pnx_set_node_flags({ nodeId, muted = undefined, bypassed = undefined, label = undefined }) {
    requireNode(nodeId);
    ST.mutatePnx((g) => {
      const n = g.nodes[nodeId];
      if (muted !== undefined) n.muted = !!muted;
      if (bypassed !== undefined) n.bypassed = !!bypassed;
      if (label !== undefined) n.label = label;
    }, { structural: true });
    return writeResult({ nodeId });
  },

  // ---------------------------------------------------------------- introspection (Part 60)
  pnx_catalogue({ category = null } = {}) {
    const all = REG.catalogue();
    const rows = category ? all.filter((n) => n.category === category) : all;
    return { count: rows.length, categories: Object.keys(REG.nodesByCategory()), nodes: rows };
  },

  pnx_describe_node({ type }) {
    const desc = REG.describeNode(type);
    if (!desc) {
      const near = REG.searchNodes(type, { limit: 5 }).map((n) => n.id);
      throw new Error(`No node type "${type}". Closest matches: ${near.join(', ') || 'none'}.`);
    }
    return desc;
  },

  pnx_search_nodes({ query, category = null, limit = 20 }) {
    return {
      query,
      results: REG.searchNodes(query, { category, limit }).map((n) => ({
        id: n.id, label: n.label, category: n.category, summary: n.summary,
        exportSupport: n.exportSupport, performance: n.performance,
      })),
    };
  },

  // Upstream/downstream reachability — how a caller answers "what does changing this affect".
  pnx_get_dependencies({ nodeId, direction = 'both' }) {
    const g = requirePnx();
    requireNode(nodeId);
    const out = { nodeId };
    if (direction === 'upstream' || direction === 'both') out.upstream = [...PGRAPH.upstreamOf(g, nodeId)];
    if (direction === 'downstream' || direction === 'both') out.downstream = [...PGRAPH.downstreamOf(g, nodeId)];
    return out;
  },

  pnx_inspect({ nodeId, socket = null, frame = null }) {
    const g = requirePnx();
    requireNode(nodeId);
    if (frame !== null) ST.setPlayhead(frame);
    PNX.evaluateFrame(Math.floor(ST.state.playhead));

    // Values are described rather than serialized: a field is a closure and a geometry is megabytes of
    // typed array, so returning them raw would be useless at best. Fields are probed at a few standard
    // sample points, which is the only meaningful answer to "what is this field".
    const session = PNX.currentGraph() === g ? true : false;
    if (!session) PNX.openSession(g, { fps: ST.state.doc.fps || 30 });
    const desc = REG.describeNode(g.nodes[nodeId].type);
    const sockets = socket ? [socket] : (desc ? desc.outputs.map((s) => s.key) : ['out']);
    const results = {};
    for (const key of sockets) {
      results[key] = describeValueForMcp(PNX.inspectSocket(nodeId, key));
    }
    return { nodeId, frame: Math.floor(ST.state.playhead), outputs: results };
  },

  // ---------------------------------------------------------------- verification (Parts 61-62)
  pnx_verify({ frame = null } = {}) {
    requirePnx();
    if (frame !== null) ST.setPlayhead(frame);
    PNX.evaluateFrame(Math.floor(ST.state.playhead));
    const rep = PNX.report();
    return {
      // TECHNICALLY VALID, deliberately not "good". Part 62 asks for the distinction to be kept, and
      // the field name is where it is kept.
      technicallyValid: rep.ok && (rep.stats.drawnElements || 0) > 0,
      graphValid: rep.ok,
      frame: Math.floor(ST.state.playhead),
      diagnostics: rep.diagnostics,
      stats: rep.stats,
      drawn: pnxDrawStats(),
      note: 'Reports technical validity only — whether anything rendered, whether the counts and values are sane. It does not judge whether the effect looks right.',
    };
  },

  // Sample several frames, which is what catches an effect that is valid at frame 0 and empty by
  // frame 40 (or the reverse). A single-frame check passing is the commonest false positive.
  pnx_verify_range({ from = 0, to = null, samples = 5 } = {}) {
    requirePnx();
    const end = to === null ? (ST.state.doc.duration || 60) - 1 : to;
    const n = Math.max(2, Math.min(30, Math.round(samples)));
    const rows = [];
    for (let k = 0; k < n; k++) {
      const frame = Math.round(from + ((end - from) * k) / (n - 1));
      PNX.evaluateFrame(frame);
      const rep = PNX.report();
      rows.push({
        frame,
        drawn: rep.stats.drawnElements || 0,
        errors: rep.diagnostics.filter((d) => d.severity === 'error').length,
        warnings: rep.diagnostics.filter((d) => d.severity === 'warning').length,
      });
    }
    const drewSomething = rows.some((r) => r.drawn > 0);
    const drewEverywhere = rows.every((r) => r.drawn > 0);
    return {
      technicallyValid: drewSomething && rows.every((r) => !r.errors),
      drewSomething,
      drewEverywhere,
      emptyFrames: rows.filter((r) => !r.drawn).map((r) => r.frame),
      frames: rows,
      note: drewSomething && !drewEverywhere
        ? 'Some sampled frames drew nothing. That may be intended (a burst that finishes) or may be a bug — check the empty frames listed.'
        : undefined,
    };
  },

  // ---------------------------------------------------------------- export (Parts 56-58)
  pnx_export_lua({ bakeStride = 1, maxBakedParticles = 300, precision = 2 } = {}) {
    requirePnx();
    const built = PNX.exportRoblox({
      name: ST.state.pnx.name,
      fps: ST.state.doc.fps || 30,
      duration: ST.state.doc.duration || 60,
      bake: { stride: bakeStride, maxParticles: maxBakedParticles, precision },
    });
    if (!built) throw new Error('The procedural session is not running, so there is nothing to export.');
    return {
      lua: built.lua,
      bytes: built.bytes,
      withinBudget: built.withinBudget,
      // The classification travels WITH the script, so a caller cannot report a successful export
      // without also having been handed what it cost (Part 61).
      counts: built.report.counts,
      lossless: built.report.lossless,
      passes: built.report.rows.map((r) => ({
        index: r.index, kind: r.kind, level: r.level, how: r.how,
        reasons: r.reasons, notes: r.notes,
        ...(r.droppedChannels ? { droppedChannels: r.droppedChannels } : {}),
      })),
      notes: built.notes,
    };
  },

  pnx_export_report() {
    requirePnx();
    PNX.evaluateFrame(Math.floor(ST.state.playhead));
    const a = PNX.robloxAnalysis();
    if (!a) return { rows: [], note: 'Nothing is being drawn, so there is nothing to classify.' };
    return {
      counts: a.counts,
      lossless: a.lossless,
      exportable: a.exportable,
      rows: a.rows.map((r) => ({
        index: r.index, kind: r.kind, level: r.level, how: r.how,
        reasons: r.reasons, notes: r.notes,
        ...(r.droppedChannels ? { droppedChannels: r.droppedChannels } : {}),
      })),
      note: 'The classification only — nothing is baked. Use pnx_export_lua to produce the script.',
    };
  },

  pnx_export_compatibility({ backend = 'roblox' } = {}) {
    requirePnx();
    PNX.evaluateFrame(Math.floor(ST.state.playhead));
    const compat = PNX.compatibility(backend);
    if (!compat) return { backend, rows: [], note: 'Nothing is being drawn, so there is nothing to classify.' };
    return {
      ...compat,
      note: 'A procedural effect has no Roblox exporter yet (phase 9). This reports what WOULD be native, converted, approximated or lost.',
    };
  },

  pnx_profile({ frame = null } = {}) {
    requirePnx();
    const f = frame === null ? Math.floor(ST.state.playhead) : frame;
    const prof = PNX.profile(f);
    return {
      frame: f,
      totalMs: prof.totalMs,
      cacheEntries: prof.cacheEntries,
      // Slowest first, and only the ones that cost something — a hundred rows of 0ms is noise.
      nodes: prof.nodes.filter((n) => n.totalMs > 0.01).slice(0, 25),
    };
  },

  pnx_scrub({ frame }) {
    requirePnx();
    ST.setPlaying(false);
    ST.setPlayhead(frame);
    PNX.evaluateFrame(Math.floor(ST.state.playhead));
    const rep = PNX.report();
    return { ok: true, frame: Math.floor(ST.state.playhead), stats: rep.stats };
  },
};

// A value described for a tool result. Fields are probed; big buffers are summarised. Returning a
// 50 000-element Float32Array over a pipe would be useless and slow, and returning a closure would be
// meaningless — so both are described instead.
function describeValueForMcp(v) {
  if (v === null || v === undefined) return { kind: 'none' };
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return { kind: 'value', value: v };
  if (Array.isArray(v)) return { kind: 'vector', value: v.slice(0, 16) };
  if (v.__field === true) {
    if ('constant' in v) return { kind: 'field', constant: true, value: v.constant, type: formatType(v.type) };
    const probes = [
      { at: 'origin', ctx: { position: [0, 0, 0] } },
      { at: '(1,0,0)', ctx: { position: [1, 0, 0] } },
      { at: 'element 0 newborn', ctx: { index: 0, life: 0 } },
      { at: 'element 1 half-life', ctx: { index: 1, life: 0.5 } },
    ];
    return {
      kind: 'field', constant: false, type: formatType(v.type),
      samples: probes.map((p) => ({ at: p.at, value: safeSample(v, p.ctx) })),
    };
  }
  if (v.__geometry === true) {
    return {
      kind: 'geometry',
      points: v.points ? v.points.count : 0,
      faces: v.faces ? v.faces.table.count : 0,
      curves: v.curves ? v.curves.table.count : 0,
      attributes: v.points ? Object.keys(v.points.attrs) : [],
    };
  }
  if (v.__instanceSet === true) return { kind: 'instances', count: v.table.count, sources: v.sources.length };
  if (v.__material === true) return { kind: 'material', channels: Object.keys(v.channels), blend: v.blend };
  if (v.__render === true) return { kind: 'render', renderKind: v.kind };
  if (v.__emitter === true) return { kind: 'emitter', rate: v.rate, emitFrom: v.emitFrom };
  if (v.__collider === true) return { kind: 'collider', response: v.response };
  if (Array.isArray(v.keys)) return { kind: 'curve', keys: v.keys.length };
  if (Array.isArray(v.stops)) return { kind: 'gradient', stops: v.stops.length };
  if (Array.isArray(v.p)) return { kind: 'transform', position: v.p, rotation: v.q, scale: v.s };
  return { kind: 'object' };
}

function safeSample(field, ctx) {
  try {
    const F = field.sample({
      position: [0, 0, 0], normal: [0, 1, 0], tangent: [0, 0, 0], uv: [0, 0],
      time: 0, frame: 0, age: 0, life: 0, velocity: [0, 0, 0], index: 0, seed: 0,
      attributes: null, space: 'world', ...ctx,
    });
    return Array.isArray(F) ? F.map((x) => Math.round(x * 1e4) / 1e4) : (typeof F === 'number' ? Math.round(F * 1e4) / 1e4 : F);
  } catch (e) {
    return `error: ${e.message}`;
  }
}
