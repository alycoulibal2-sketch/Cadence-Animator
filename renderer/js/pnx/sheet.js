// The Effect Sheet projection (docs/effect-sheet.md §5, §8): a PNX graph read as
//
//   things you can see  →  properties  →  a value, or the phrase of what feeds it, recursively
//
// with a node that feeds more than one place named once. This is a lossless view of the graph — a
// DAG is nested expressions plus names for shared values — and it is PURE: no DOM, no three.js, no
// state.js, so test/pnxtest.mjs can assert its coverage and the MCP layer can hand it to Claude as
// the same object a person is looking at.
//
// EVERY WORD COMES FROM THE REGISTRY OR THE GRAPH. Labels, units, ranges, options, teaching lines and
// export classifications are the socket/node metadata `registry.js` already validates; numbers are the
// graph's values. There is no list of 354 anything here (Part 79 on the UI side). A node may carry an
// optional `phrase` template ('{rate} per second from {shape}') to read as a sentence; when it does not,
// the fallback is the node's label plus its rows, which is complete and already legible.

import * as REG from './registry.js';
import * as G from './graph.js';
import * as T from './types.js';

export const OUTPUT_TYPE_PREFIX = 'cadence.render.output';
const VALUE_TYPES = new Set(['float', 'int', 'bool', 'string', 'vector2', 'vector3', 'vector4', 'color', 'curve', 'gradient', 'quaternion']);

// A thing is a node that produces a render pass (sprites, meshes, trails, beams, lights). The Effect
// Output and the Render Report are plumbing, not things: the sheet reads them but does not list them.
export function isThingDef(def) {
  if (!def || !def.outputs) return false;
  if (def.id === 'cadence.render.output' || def.id === 'cadence.render.report') return false;
  return def.outputs.some((s) => s.type && s.type.name === 'renderCommand');
}

function defOf(graph, node) {
  if (!node) return null;
  if (G.isGroupInstanceType(node.type)) {
    const g = graph.groups[G.groupIdOfType(node.type)];
    return g ? { id: node.type, label: g.name || 'Group', teach: g.description || '', group: true, inputs: [], outputs: [], exportSupport: 'converted' } : null;
  }
  if (G.isGroupBoundaryType(node.type)) return { id: node.type, label: node.type === G.GROUP_INPUT_TYPE ? 'A setting you choose' : 'The result', boundary: true, inputs: [], outputs: [] };
  return REG.getNode(node.type);
}

function consumerCounts(graph) {
  const m = new Map();
  for (const l of Object.values(graph.links)) m.set(l.fromNode, (m.get(l.fromNode) || 0) + 1);
  return m;
}

// The inputs a card shows first. Registry metadata (`primary`) when a node declares it; otherwise the
// first four connectable inputs plus anything whose value differs from its default — "few big knobs
// first, the rest behind more".
export function primaryKeys(def, node) {
  if (!def) return [];
  if (Array.isArray(def.primary)) return def.primary;
  const keys = [];
  for (const s of def.inputs || []) {
    if (keys.length < 4) keys.push(s.key);
    else if (node && node.values && node.values[s.key] !== undefined && JSON.stringify(node.values[s.key]) !== JSON.stringify(s.default)) keys.push(s.key);
  }
  return keys;
}

// The sample-context readers, random and noise a value can vary with, walking upstream of a socket.
// Structural, so it is exact: no probing, no sampling.
export function variesWith(graph, nodeId, socketKey, seen = new Set()) {
  const axes = new Set();
  for (const l of G.linksInto(graph, nodeId, socketKey)) {
    const src = graph.nodes[l.fromNode];
    if (!src || seen.has(src.id)) continue;
    seen.add(src.id);
    const def = REG.getNode(src.type);
    if (!def) {
      if (G.isGroupInstanceType(src.type)) axes.add('a recipe');
      continue;
    }
    if (!def.inputs.length && def.outputs.some((o) => T.isFieldType(o.type))) axes.add(def.label);
    if (def.timeDependent) axes.add('the effect\'s time');
    if (def.category === 'Random') axes.add('random per particle');
    if (def.category === 'Noise') axes.add('noise');
    for (const s of def.inputs) {
      if (s.defaultFrom && !G.linksInto(graph, src.id, s.key).length) axes.add(`its own ${s.defaultFrom}`);
      for (const a of variesWith(graph, src.id, s.key, seen)) axes.add(a);
    }
  }
  return axes;
}

// Registry nodes whose output fits a slot, directly or as a field of it. What "anything else…" lists.
export function feedersFor(typeRef, { includeGeneric = true } = {}) {
  const want = T.parseType(typeRef);
  if (!want) return [];
  const inner = T.isFieldType(want) ? want.param : want;
  const genericOk = ['float', 'int', 'vector2', 'vector3', 'vector4', 'color', 'bool'].includes(inner?.name);
  return REG.currentNodes().filter((n) => n.outputs.some((o) => {
    if (T.containsGeneric(o.type)) return includeGeneric && genericOk;
    return T.canConnect(o.type, want) || T.canConnect(o.type, T.fieldOf(inner));
  }));
}

// Optional sentence template on a node definition: '{rate} per second from {shape}'. Keys are input
// socket keys; a key whose slot is wired renders as the source's label. Returns null without a template.
export function phraseFor(graph, node, def, renderedRows) {
  if (!def || typeof def.phrase !== 'string') return null;
  const byKey = new Map(renderedRows.map((r) => [r.key, r]));
  return def.phrase.replace(/\{(\w+)\}/g, (_, key) => {
    const r = byKey.get(key);
    if (!r) return `{${key}}`;
    if (r.kind === 'source' && r.sources.length) return r.sources.map((s) => s.name || s.label).join(' + ');
    return valueText(r.value, r);
  });
}

// A short human rendering of a literal — the sheet's controls render the real editors; this is for
// summaries, tests and the MCP text view.
export function valueText(v, row) {
  const name = row?.innerType;
  const unit = row?.unit ? ` ${row.unit}` : '';
  if (v === undefined || v === null) return '(nothing)';
  if (name === 'color' && Array.isArray(v)) return `rgb(${v.slice(0, 3).map((c) => Math.round(c * 255)).join(',')})`;
  if (v && Array.isArray(v.stops)) return `gradient ${v.stops.map((s) => s.v).join(' → ')}`;
  if (v && Array.isArray(v.keys)) return `curve ${v.keys.map((k) => `${fmt(k.v)}@${fmt(k.t)}`).join(' → ')}`;
  if (Array.isArray(v)) return `(${v.map(fmt).join(', ')})${unit}`;
  if (typeof v === 'number') return fmt(v) + unit;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}
const fmt = (v) => (typeof v !== 'number' ? String(v) : Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));

// ---------------------------------------------------------------- the projection
export function projectGraph(graph, { scope = G.ROOT_SCOPE, maxDepth = 24 } = {}) {
  const nodes = G.nodesInScope(graph, scope);
  const consumers = consumerCounts(graph);
  const named = new Map();     // nodeId -> entry
  const visited = new Set();
  let nameCounter = 0;

  const nameFor = (src, def) => {
    if (!named.has(src.id)) {
      nameCounter++;
      const base = src.label || def?.label || src.type;
      named.set(src.id, { nodeId: src.id, name: nameCounter > 1 ? `${base} ${nameCounter}` : base, label: def?.label || src.type, teach: def?.teach || '', rows: null, usedBy: [] });
    }
    return named.get(src.id);
  };

  function rowsOf(node, def, depth) {
    const { inputs } = G.socketsOf(graph, node);
    const rows = [];
    const prim = new Set(primaryKeys(def, node));
    for (const s of inputs) {
      const inner = T.isFieldType(s.type) ? s.type.param : s.type;
      const row = {
        nodeId: node.id, key: s.key, label: s.label || s.key,
        type: T.formatType(s.type), innerType: inner?.name || null, isField: T.isFieldType(s.type), generic: T.containsGeneric(s.type),
        unit: s.unit || null, min: s.min, max: s.max, options: s.options || null,
        connectable: s.socket !== false, multi: !!s.multi, description: s.description || null, defaultFrom: s.defaultFrom || null,
        default: s.default, primary: prim.has(s.key),
        kind: 'value', value: undefined, sources: [], variesWith: [],
      };
      const links = G.linksInto(graph, node.id, s.key);
      if (s.socket === false) {
        row.kind = 'mode';
        row.value = node.values?.[s.key] !== undefined ? node.values[s.key] : s.default;
      } else if (!links.length) {
        const isValue = T.containsGeneric(s.type) || VALUE_TYPES.has(inner?.name);
        row.kind = isValue ? 'value' : 'empty';
        row.value = node.values?.[s.key] !== undefined ? node.values[s.key] : (isValue ? s.default : undefined);
      } else {
        row.kind = 'source';
        for (const l of links) {
          const src = graph.nodes[l.fromNode];
          if (!src) continue;
          row.sources.push(renderSource(src, l.fromSocket, node, s, depth + 1));
        }
        row.variesWith = [...variesWith(graph, node.id, s.key)];
      }
      rows.push(row);
    }
    return rows;
  }

  function renderSource(src, fromSocket, targetNode, targetSocket, depth) {
    const def = defOf(graph, src);
    const outs = G.socketsOf(graph, src).outputs;
    const o = outs.find((x) => x.key === fromSocket);
    const via = o && outs.length > 1 ? o.label : null;
    const entry = { nodeId: src.id, type: src.type, fromSocket, via, label: def?.label || src.type, teach: def?.teach || '', exportSupport: def?.exportSupport || null, name: null, thing: false, rows: [], boundary: !!def?.boundary };
    if (def?.boundary) { visited.add(src.id); entry.label = o?.label || entry.label; return entry; }
    if ((consumers.get(src.id) || 0) > 1) {
      const n = nameFor(src, def);
      n.usedBy.push({ nodeId: targetNode.id, socketKey: targetSocket.key, label: targetSocket.label || targetSocket.key });
      entry.name = n.name;
      return entry;
    }
    if (isThingDef(def)) { entry.thing = true; visited.add(src.id); return entry; }
    visited.add(src.id);
    if (depth < maxDepth) entry.rows = rowsOf(src, def, depth);
    if (def?.phrase) entry.phrase = phraseFor(graph, src, def, entry.rows);
    return entry;
  }

  // Things, in draw order (the Effect Output's passes), then any renderer that exists but is not
  // wired to the output — shown, flagged "not drawn", never hidden.
  const outputNode = nodes.find((n) => n.type.startsWith(OUTPUT_TYPE_PREFIX));
  const drawn = outputNode ? G.linksInto(graph, outputNode.id, 'passes').map((l) => l.fromNode) : [];
  const drawnSet = new Set(drawn);
  const thingNodes = nodes.filter((n) => isThingDef(defOf(graph, n)));
  const ordered = [...drawn.map((id) => graph.nodes[id]).filter(Boolean), ...thingNodes.filter((n) => !drawnSet.has(n.id))];
  const things = [];
  // Inside a group there are no renderers: the group's declared result IS the thing being built, so
  // its Group Output node is the root the sheet reads from ("The result: …").
  if (scope !== G.ROOT_SCOPE) {
    const gOut = nodes.find((n) => n.type === G.GROUP_OUTPUT_TYPE);
    if (gOut) {
      visited.add(gOut.id);
      const group = graph.groups[scope];
      const rows = rowsOf(gOut, { inputs: [] }, 1);
      things.push({ nodeId: gOut.id, type: gOut.type, label: group ? `${group.name} — the result` : 'The result', teach: group?.description || '', summary: '', exportSupport: null, drawn: true, result: true, rows, phrase: null });
    }
  }
  for (const n of ordered) {
    const def = defOf(graph, n);
    visited.add(n.id);
    const rows = rowsOf(n, def, 1);
    things.push({
      nodeId: n.id, type: n.type, label: n.label || def?.label || n.type, teach: def?.teach || '', summary: def?.summary || '',
      exportSupport: def?.exportSupport || null, drawn: drawnSet.has(n.id), rows,
      phrase: def?.phrase ? phraseFor(graph, n, def, rows) : null,
    });
  }
  if (outputNode) visited.add(outputNode.id);
  // The Group Input node is a boundary: reached the moment anything reads it, and never "unused" on
  // its own — it is the group's face, not a node a user placed.
  for (const n of nodes) if (n.type === G.GROUP_INPUT_TYPE) visited.add(n.id);

  // Named values, expanded once. A named value's own rows may name further values, so iterate until
  // the map stops growing.
  let guard = 0;
  while (guard++ < 64) {
    const pending = [...named.values()].filter((e) => e.rows === null);
    if (!pending.length) break;
    for (const e of pending) {
      const src = graph.nodes[e.nodeId];
      const def = defOf(graph, src);
      visited.add(src.id);
      e.rows = rowsOf(src, def, 2);
      e.exportSupport = def?.exportSupport || null;
      e.phrase = def?.phrase ? phraseFor(graph, src, def, e.rows) : null;
    }
  }

  const unused = nodes.filter((n) => !visited.has(n.id) && !G.isGroupBoundaryType(n.type)).map((n) => ({ nodeId: n.id, type: n.type, label: defOf(graph, n)?.label || n.type }));
  const total = nodes.filter((n) => !G.isGroupBoundaryType(n.type)).length;
  return {
    scope, outputNodeId: outputNode ? outputNode.id : null,
    things, named: [...named.values()], unused,
    stats: { nodes: total, reached: total - unused.length, named: named.size, things: things.length, drawn: drawn.length },
  };
}

// ---------------------------------------------------------------- text view
// The same projection as indented text — what tests assert against and what `pnx_sheet` returns.
export function sheetText(projection, { showDefaults = true } = {}) {
  const out = [];
  const line = (depth, s) => out.push('  '.repeat(depth) + s);
  const rowLine = (r, depth) => {
    if (r.kind === 'mode') return line(depth, `${r.label}: ${valueText(r.value, r)} ▾`);
    if (r.kind === 'empty') return line(depth, `${r.label}: ${r.defaultFrom ? `(each particle's own ${r.defaultFrom})` : '(nothing)'}`);
    if (r.kind === 'value') return line(depth, `${r.label}: ${valueText(r.value, r)}`);
    const heads = r.sources.map((s) => (s.name ? `«${s.name}»` : s.thing ? `[${s.label}]` : (s.phrase || s.label)) + (s.via ? ` (its ${s.via})` : '')).join(' + ');
    line(depth, `${r.label}: ${heads}${r.variesWith.length ? `   ~ varies with ${r.variesWith.join(', ')}` : ''}`);
    for (const s of r.sources) for (const rr of s.rows) rowLine(rr, depth + 1);
  };
  for (const t of projection.things) {
    line(0, `• ${t.label}${t.drawn ? '' : '  (not drawn — not connected to the Effect Output)'}${t.teach ? `  — ${t.teach}` : ''}`);
    for (const r of t.rows) rowLine(r, 1);
    out.push('');
  }
  if (projection.named.length) {
    line(0, 'Values used in several places:');
    for (const n of projection.named) {
      line(1, `«${n.name}» = ${n.label}${n.teach ? `  — ${n.teach}` : ''}   (used by ${n.usedBy.map((u) => u.label).join(', ')})`);
      for (const r of n.rows || []) rowLine(r, 2);
    }
    out.push('');
  }
  if (projection.unused.length) line(0, `Not used by anything drawn: ${projection.unused.map((u) => u.label).join(', ')}`);
  return out.join('\n');
}

// A one-line summary of a thing or source for a collapsed card: its non-default values in order.
export function summaryOf(entry, limit = 4) {
  const parts = [];
  for (const r of entry.rows || []) {
    if (parts.length >= limit) break;
    if (r.kind === 'source') parts.push(`${r.label.toLowerCase()}: ${r.sources.map((s) => s.name || s.label).join(' + ')}`);
    else if (r.kind === 'value' && r.value !== undefined && JSON.stringify(r.value) !== JSON.stringify(r.default)) parts.push(`${r.label.toLowerCase()} ${valueText(r.value, r)}`);
  }
  return parts.join(' · ');
}
