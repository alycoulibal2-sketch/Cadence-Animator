// Compiles a NodeGraph (nodeGraphModel.js) into an effectModel.js Effect document. A graph is
// never executed directly — every existing runtime (three.js preview, Luau export, the
// validator/autofix pipeline, every MCP vfx_* tool) keeps operating on the SAME Effect-document
// shape it always has; the graph is purely a new authoring surface that compiles down onto it.
// Pure, no DOM/window — same discipline as effectModel.js/compositionGenerator.js's predecessor.

import { getNodeType } from './nodeGraphModel.js';
import { newEffect, addLayer, parseEffect } from './effectModel.js';

// The one incoming connection into a node's given input socket, or null. Every v1 node type has
// at most one input socket, and nodeGraphModel.js's connect() enforces at most one incoming
// connection per non-multiInput socket — so for any graph actually built through the editor,
// "the" incoming connection is unambiguous. (Output nodes are multiInput and use a separate
// lookup below — this helper is only ever called for a single-input node.)
function incomingConnection(graph, nodeId, socket) {
  return graph.connections.find((c) => c.toNode === nodeId && c.toSocket === socket) || null;
}

// Walks backward from one of an Output node's incoming connections to the Create node that
// starts its chain. Returns { ok:true, chain } (Create-first, Output-last — compile order) when
// the chain is genuinely rooted at a Create node (inputs.length === 0); { ok:false,
// reason:'unrooted' } when it dead-ends on an unconnected input first (a normal mid-edit
// state — e.g. a Color node wired to Preview with nothing feeding it yet, nothing to compile,
// not an error); { ok:false, reason:'cycle' } only if the walk outlives the graph's own node
// count, which can only happen via a cycle a hand-crafted/MCP-written graph slipped past
// nodeGraphModel.js's own connect()-time cycle rejection (the editor itself can never produce
// one, since every connect() call is checked there first).
function walkChain(graph, outputNode, firstConn) {
  const chain = [outputNode];
  let node = graph.nodes.find((n) => n.id === firstConn.fromNode);
  const guard = graph.nodes.length + 1;
  for (let i = 0; i < guard; i++) {
    if (!node) return { ok: false, reason: 'unrooted' }; // connection points at a node that no longer exists
    chain.push(node);
    const meta = getNodeType(node.type);
    if (!meta.inputs.length) { chain.reverse(); return { ok: true, chain }; } // reached a Create node
    const conn = incomingConnection(graph, node.id, meta.inputs[0]);
    if (!conn) return { ok: false, reason: 'unrooted' }; // dead end before reaching a Create node
    node = graph.nodes.find((n) => n.id === conn.fromNode);
  }
  return { ok: false, reason: 'cycle' };
}

// compileGraph(graph) -> { ok, doc, errors }. `errors` is populated only for genuinely abnormal
// graph data (a cycle, a downstream node that failed to compile); an incomplete/unrooted chain
// or an unwired Create node simply contributes no layer — never an error, matching this
// codebase's "unrecognized/incomplete -> neutral, never confidently wrong" convention.
export function compileGraph(graph) {
  const errors = [];
  const doc = newEffect(graph.name || 'Untitled Effect');

  const outputNodes = graph.nodes.filter((n) => getNodeType(n.type)?.category === 'Output');
  for (const outputNode of outputNodes) {
    const outMeta = getNodeType(outputNode.type);
    const incoming = graph.connections.filter((c) => c.toNode === outputNode.id && outMeta.inputs.includes(c.toSocket));
    for (const conn of incoming) {
      const result = walkChain(graph, outputNode, conn);
      if (!result.ok) {
        if (result.reason === 'cycle') errors.push(`A connection into "${outMeta.label}" forms a cycle — it was skipped.`);
        continue;
      }
      const ctx = {};
      try {
        for (const node of result.chain) getNodeType(node.type).compile(ctx, node.params);
      } catch (e) {
        errors.push(`A chain into "${outMeta.label}" failed to compile: ${e.message}`);
        continue;
      }
      if (ctx.layer) addLayer(doc, ctx.layer);
    }
  }

  // Same "always validate through the one true path" convention buildArchetypeDoc/the deleted
  // compositionGenerator.js both used — even though every layer here was already built through
  // the canonical newLayer()/setLayerProps()/addModifier() helpers, not hand-assembled JSON.
  const parsed = parseEffect(doc);
  if (!parsed.ok) return { ok: false, doc: null, errors: [...errors, `compiled graph produced an invalid document: ${parsed.error}`] };
  return { ok: true, doc: parsed.doc, errors };
}
