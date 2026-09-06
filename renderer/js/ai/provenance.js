// The Provenance Graph (directive Part 56).
//
// "Provenance is not merely logging. It allows safe learning, debuggability, review, and trust."
//
// The graph has to answer questions like "which user request caused this keyframe?" and "what
// changed between the accepted version and the current version?". That rules out a flat log: the
// answers are paths through a graph, not lines in a file.
//
// Three decisions that shape everything below.
//
// 1. **It lives inside the project**, at `project.semantics.provenance`. That is unusual for a
//    log, and it is the point: it then survives save/load, travels with a `.cadence` file, and is
//    captured by `structuredClone` undo and by a snapshot — so "why is this animation built this
//    way" is answerable a week later on another machine, which a session-scoped store could never
//    manage. The cost is project-file size, which is why it is capped and why payloads are
//    references rather than embedded state.
//
// 2. **Append-only, with an explicit cap.** Records are never rewritten. When the cap is reached
//    the oldest records are dropped and a `truncated` counter records that it happened — a gap
//    that announces itself, rather than a graph that silently starts mid-story.
//
// 3. **No clock.** This module is pure; the caller supplies `timestamp`. A record with no
//    timestamp reports `null`. That is deliberate: a semantic layer that reads the wall clock
//    cannot be replayed deterministically, and Part 44 needs snapshots and provenance to be
//    reproducible.

import { contentHash } from './hash.js';

const DEFAULT_CAP = 500;

/**
 * Node types, matching the stages Part 56 says must be traceable.
 *
 *   request     what the user actually asked for, verbatim
 *   intent      how it was interpreted (an IntentSpec, once Phase 3 exists)
 *   plan        a motion / VFX / camera / event plan
 *   tool_call   a tool that ran, with its arguments and scope
 *   patch       a change that was applied, with its transaction id
 *   snapshot    a captured state
 *   render      an observation that was produced
 *   analysis    a measurement or critique that was run
 *   decision    an approval, rejection or rollback
 *   lesson      something extracted for memory (Part 58)
 *   note        anything else worth recording, said plainly
 */
export const NODE_TYPES = Object.freeze([
  'request', 'intent', 'plan', 'tool_call', 'patch', 'snapshot', 'render', 'analysis', 'decision', 'lesson', 'note',
]);

/**
 * Edge types. `caused_by` is the backbone — every node points at what produced it — and the rest
 * are the cross-links that make questions like "which plan produced this keyframe" answerable
 * without walking the whole graph.
 */
export const EDGE_TYPES = Object.freeze([
  'caused_by',     // child → parent, the causal spine
  'interprets',    // intent → request
  'implements',    // patch → plan
  'observes',      // render/analysis → patch or snapshot
  'evaluates',     // analysis → render
  'approves',      // decision → patch
  'rolls_back',    // decision → patch
  'before',        // patch → snapshot taken before it
  'after',         // patch → snapshot taken after it
  'affects',       // patch → entity id it touched
  'derived_from',  // lesson → analysis/decision
]);

function store(project, { create = false } = {}) {
  if (!project.semantics) {
    if (!create) return null;
    project.semantics = {};
  }
  if (!project.semantics.provenance) {
    if (!create) return null;
    project.semantics.provenance = { version: 1, seq: 0, nodes: [], edges: [], truncated: 0, cap: DEFAULT_CAP };
  }
  const g = project.semantics.provenance;
  // A graph written before `seq` existed, or one loaded from an older file, starts its counter
  // past everything it already holds rather than at zero — otherwise the first new node would
  // reuse an id that trimming had freed up.
  if (typeof g.seq !== 'number') g.seq = g.nodes.length + (g.truncated || 0);
  return g;
}

function nextId(g, type) {
  // `seq` is monotonic and never decremented by trimming, so an id is never reused. It is also
  // content-salted with the previous node's id, so two machines appending to the same saved
  // project cannot mint the same id for different content without a clock or a UUID.
  const n = ++g.seq;
  return `prov:${type}:${n}:${contentHash({ type, n, at: g.nodes.length ? g.nodes[g.nodes.length - 1].id : null }).slice(0, 6)}`;
}

/**
 * Append a node. Returns its id.
 *
 * @param node.type    one of NODE_TYPES
 * @param node.summary one line, human-readable. Required — a record nobody can read is not
 *                     provenance, it is noise.
 * @param node.detail  structured payload, kept verbatim
 * @param node.parents ids of nodes this one was caused by
 * @param node.links   `[{ type, target }]` extra typed edges
 * @param node.entities entity ids this node touched (Part 55's "changed entities")
 * @param node.timestamp caller-supplied ISO string, or omitted
 */
export function record(project, node) {
  const g = store(project, { create: true });
  if (!NODE_TYPES.includes(node.type)) throw new TypeError(`provenance: unknown node type "${node.type}"`);
  if (!node.summary) throw new TypeError('provenance: a node needs a one-line summary');

  const id = nextId(g, node.type);
  g.nodes.push({
    id,
    type: node.type,
    summary: node.summary,
    detail: node.detail ?? null,
    entities: node.entities ?? [],
    author: node.author ?? null,
    timestamp: node.timestamp ?? null,
    certainty: node.certainty ?? null,
  });
  for (const p of node.parents || []) g.edges.push({ type: 'caused_by', from: id, to: p });
  for (const l of node.links || []) {
    if (!EDGE_TYPES.includes(l.type)) throw new TypeError(`provenance: unknown edge type "${l.type}"`);
    g.edges.push({ type: l.type, from: id, to: l.target });
  }
  for (const e of node.entities || []) g.edges.push({ type: 'affects', from: id, to: e });

  trim(g);
  return id;
}

/** Add an edge between two existing nodes after the fact (a decision approving an earlier patch). */
export function link(project, type, from, to) {
  const g = store(project, { create: true });
  if (!EDGE_TYPES.includes(type)) throw new TypeError(`provenance: unknown edge type "${type}"`);
  g.edges.push({ type, from, to });
  return { type, from, to };
}

function trim(g) {
  const cap = g.cap || DEFAULT_CAP;
  if (g.nodes.length <= cap) return;
  const drop = g.nodes.length - cap;
  const dropped = new Set(g.nodes.slice(0, drop).map((n) => n.id));
  g.nodes = g.nodes.slice(drop);
  // Edges pointing at a dropped node are dropped too, EXCEPT `affects` edges to entity ids, which
  // point outside the graph and stay valid. Keeping dangling caused_by edges would make `explain`
  // report a parent that cannot be shown.
  g.edges = g.edges.filter((e) => !dropped.has(e.from) && (e.type === 'affects' || !dropped.has(e.to)));
  g.truncated = (g.truncated || 0) + drop;
}

export function getGraph(project) {
  return store(project) || { version: 1, nodes: [], edges: [], truncated: 0, cap: DEFAULT_CAP };
}

/**
 * Query the graph.
 * @param q.type     node type(s)
 * @param q.entity   only nodes that touched this entity id
 * @param q.since    only nodes at or after this index (cheap paging without a clock)
 * @param q.limit    default 50
 * @param q.contains substring match on summary
 */
export function query(project, q = {}) {
  const g = getGraph(project);
  const types = q.type ? (Array.isArray(q.type) ? q.type : [q.type]) : null;
  const entityNodes = q.entity
    ? new Set(g.edges.filter((e) => e.type === 'affects' && e.to === q.entity).map((e) => e.from))
    : null;

  let nodes = g.nodes;
  if (q.since) nodes = nodes.slice(q.since);
  nodes = nodes.filter((n) => (!types || types.includes(n.type))
    && (!entityNodes || entityNodes.has(n.id))
    && (!q.contains || n.summary.toLowerCase().includes(String(q.contains).toLowerCase())));

  const limit = q.limit ?? 50;
  return {
    nodes: nodes.slice(-limit),
    total_matching: nodes.length,
    total_in_graph: g.nodes.length,
    truncated_before_this_graph: g.truncated || 0,
  };
}

/**
 * Explain one node: its causal ancestry, what it affected, and what happened to it afterwards.
 * This is the "why is this animation built this way?" traversal.
 */
export function explain(project, nodeId, { maxDepth = 12 } = {}) {
  const g = getGraph(project);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const node = byId.get(nodeId);
  if (!node) return null;

  const parentsOf = (id) => g.edges.filter((e) => e.from === id && e.type !== 'affects').map((e) => e.to);
  const childrenOf = (id) => g.edges.filter((e) => e.to === id).map((e) => e.from);

  const chain = [];
  const seen = new Set([nodeId]);
  let frontier = [nodeId];
  for (let d = 0; d < maxDepth && frontier.length; d++) {
    const next = [];
    for (const id of frontier) {
      for (const p of parentsOf(id)) {
        if (seen.has(p)) continue;
        seen.add(p);
        const n = byId.get(p);
        if (n) { chain.push({ depth: d + 1, ...n }); next.push(p); }
      }
    }
    frontier = next;
  }

  const consequences = childrenOf(nodeId).map((id) => byId.get(id)).filter(Boolean);
  const affected = g.edges.filter((e) => e.from === nodeId && e.type === 'affects').map((e) => e.to);

  return {
    node,
    caused_by: chain,
    consequences,
    affected_entities: affected,
    // A truncated graph cannot promise a complete ancestry, and saying so is the difference
    // between provenance and a log that looks authoritative.
    complete: !(g.truncated > 0) || chain.length < maxDepth,
    note: g.truncated ? `${g.truncated} earlier record(s) were dropped when the graph hit its cap, so an ancestry may be incomplete` : null,
  };
}

/**
 * Everything recorded about one entity, newest last — "which user request caused this keyframe?"
 * answered directly.
 */
export function historyOf(project, entityId, { limit = 50 } = {}) {
  const g = getGraph(project);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const touching = g.edges.filter((e) => e.type === 'affects' && e.to === entityId).map((e) => byId.get(e.from)).filter(Boolean);
  return {
    entity: entityId,
    records: touching.slice(-limit),
    // The originating request for each record, which is what a human actually wants to see.
    origins: touching.slice(-limit).map((n) => {
      const ex = explain(project, n.id);
      const req = ex?.caused_by.find((c) => c.type === 'request');
      return { record: n.id, request: req ? req.summary : null };
    }),
    truncated_before_this_graph: g.truncated || 0,
  };
}

/** Drop the whole graph. Explicit, never automatic — Part 4.8 forbids silent self-modification,
 *  and quietly discarding provenance is exactly that. */
export function clear(project) {
  const g = store(project);
  const had = g ? g.nodes.length : 0;
  if (project.semantics) delete project.semantics.provenance;
  return { cleared: had };
}

export function stats(project) {
  const g = getGraph(project);
  const byType = {};
  for (const n of g.nodes) byType[n.type] = (byType[n.type] || 0) + 1;
  return {
    nodes: g.nodes.length,
    edges: g.edges.length,
    by_type: byType,
    truncated: g.truncated || 0,
    cap: g.cap || DEFAULT_CAP,
    storage: 'inside the project, at project.semantics.provenance — survives save/load and undo, and travels with the .cadence file',
  };
}
