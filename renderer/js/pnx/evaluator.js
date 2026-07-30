// PNX evaluator: typed, pull-based, cached graph evaluation.
//
// Pull-based (demand-driven) rather than push: evaluation starts from an output that someone
// actually wants and walks backwards. A graph with four unconnected experiments and one live chain
// costs only the live chain. Combined with memoization and dirty propagation, that is what makes
// Part 3's "do NOT recompute an entire graph because one number changed" true structurally, rather
// than being an optimisation to add later.
//
// FOUR MECHANISMS WORTH UNDERSTANDING BEFORE CHANGING ANYTHING HERE:
//
// 1. GENERIC RESOLUTION. A node signature may use type variables (`T`). The evaluator unifies them
//    against what is actually connected, so one `Add` implementation serves float / vector2 /
//    vector3 / vector4 / color.
//
// 2. AUTOMATIC FIELD LIFTING. If a generic slot receives a `field<X>` where the signature wanted
//    `X`, the node's own evaluate() is wrapped in a per-sample closure and its output becomes a
//    field. The node never learns that fields exist. This is why the spec's several hundred
//    pointwise operations do not need a spatial variant each (Part 79), and it falls out of
//    unification rather than needing a flag: a node that declares `field<T>` explicitly unifies
//    field-to-field and is handed the raw field instead.
//
// 3. TIME-DEPENDENCE TRACKING. Cache entries are tagged time-dependent if the node declares
//    `timeDependent` or if any input it consumed was tagged. Advancing the playhead therefore
//    invalidates only the animated part of the graph, and a static 900-node material chain
//    survives scrubbing untouched. Time is only exposed to nodes that DECLARE they need it, so a
//    node cannot silently read the clock and become uncacheable behind the evaluator's back.
//
// 4. STRUCTURAL SEEDING. A node's seed comes from its position in the graph (id + group
//    instance path), never from evaluation order or an array index — Part 14's requirement that
//    editing an unrelated branch must not perturb an unrelated random result.

import * as T from './types.js';
import * as V from './values.js';
import * as F from './fields.js';
import { getNode as getNodeType } from './registry.js';
import {
  socketsOf, linksInto, ROOT_SCOPE, topoOrder, downstreamOf,
  isGroupInstanceType, groupIdOfType, GROUP_INPUT_TYPE, GROUP_OUTPUT_TYPE, isGroupBoundaryType,
  nodesInScope,
} from './graph.js';

const MAX_DEPTH = 64; // group nesting + evaluation depth guard; a real graph never approaches this

export class Evaluator {
  constructor(graph, options = {}) {
    this.graph = graph;
    this.cache = new Map();        // 'path|socket' -> { value, type, timeDependent }
    // Per-node-path persistent state, for the nodes that genuinely have some (simulations). Keyed by
    // path rather than by node id so a group used twice keeps two independent simulations — sharing
    // one would make the second instance's history depend on the first's, which is the same class of
    // bug the cache namespacing avoids.
    this.persistent = new Map();   // path -> arbitrary object owned by the node
    this.diagnostics = [];         // errors/warnings raised during the last evaluation pass
    this.profile = new Map();      // nodeId -> { calls, totalMs, cacheHits }
    this.options = {
      time: 0, frame: 0, fps: 30, duration: 60,
      seed: 0, quality: 1,
      profiling: false,
      ...options,
    };
    this._depth = 0;
    this._diagKeys = new Set();    // dedupes identical diagnostics within one pass
  }

  // ---------------------------------------------------------------- context
  // Changing time invalidates only time-dependent cache entries. Changing the seed or any other
  // structural option invalidates everything, because there is no cheap way to know what consumed
  // it and a wrong answer is far worse than a recompute.
  setTime(frame, time = null) {
    const nextFrame = Number.isFinite(frame) ? frame : 0;
    const nextTime = time === null ? nextFrame / (this.options.fps || 30) : time;
    if (nextFrame === this.options.frame && nextTime === this.options.time) return;
    this.options.frame = nextFrame;
    this.options.time = nextTime;
    this.invalidateTimeDependent();
  }

  setOption(key, value) {
    if (this.options[key] === value) return;
    this.options[key] = value;
    this.invalidateAll();
  }

  invalidateAll() {
    this.cache.clear();
    this.persistent.clear();
  }

  // Advancing the playhead invalidates time-dependent cache entries but MUST NOT touch persistent
  // state. A simulation's whole purpose is to survive from one frame to the next; dropping it here
  // would restart every particle system on every frame of playback. Structural changes — a different
  // force, a new wire — go through invalidateNode/invalidateAll instead, which do drop it, because a
  // simulation's history is only meaningful for the graph that produced it.
  invalidateTimeDependent() {
    for (const [k, e] of this.cache) if (e.timeDependent) this.cache.delete(k);
  }

  // Dirty propagation: a node's own entry plus everything reachable downstream from it. Called by
  // the editor on any value/link change, which is the whole reason a 900-node graph stays
  // interactive while a slider is dragged.
  invalidateNode(nodeId) {
    this._invalidatePath(nodeId);
    for (const id of downstreamOf(this.graph, nodeId)) this._invalidatePath(id);
    // A node inside a group affects every instance of that group, and the cache is namespaced by
    // instance path, so clear by suffix match.
    const node = this.graph.nodes[nodeId];
    if (node && node.scope !== ROOT_SCOPE) this._invalidateGroup(node.scope);
  }

  _invalidatePath(nodeId) {
    for (const k of [...this.cache.keys()]) {
      const bar = k.lastIndexOf('|');
      const path = k.slice(0, bar);
      if (path === nodeId || path.endsWith(`/${nodeId}`)) this.cache.delete(k);
    }
    for (const path of [...this.persistent.keys()]) {
      if (path === nodeId || path.endsWith(`/${nodeId}`)) this.persistent.delete(path);
    }
  }

  _invalidateGroup(groupId) {
    for (const n of Object.values(this.graph.nodes)) {
      if (isGroupInstanceType(n.type) && groupIdOfType(n.type) === groupId) this.invalidateNode(n.id);
    }
  }

  // ---------------------------------------------------------------- public evaluation
  // Evaluate one output socket. Returns { value, type, ok, diagnostics }. Never throws: a broken
  // node yields its output type's default plus a diagnostic, because a graph is in a broken state
  // for most of its editing life and the preview has to keep drawing.
  evaluateSocket(nodeId, socketKey) {
    this.diagnostics = [];
    this._diagKeys.clear();
    const node = this.graph.nodes[nodeId];
    if (!node) {
      this._diag('error', nodeId, `No node with id "${nodeId}".`);
      return { ok: false, value: null, type: null, diagnostics: this.diagnostics };
    }
    const out = this._pull(node, socketKey, { pathPrefix: '', groupInputs: null });
    return {
      ok: !this.diagnostics.some((d) => d.severity === 'error'),
      value: out.value,
      type: T.formatType(out.type),
      timeDependent: out.timeDependent,
      diagnostics: this.diagnostics,
    };
  }

  // Evaluate every output of one node — what an inspector panel or a `pnx_inspect` MCP call wants.
  evaluateNodeOutputs(nodeId) {
    this.diagnostics = [];
    this._diagKeys.clear();
    const node = this.graph.nodes[nodeId];
    if (!node) return { ok: false, outputs: {}, diagnostics: this.diagnostics };
    const { outputs } = socketsOf(this.graph, node);
    const result = {};
    for (const s of outputs) {
      const out = this._pull(node, s.key, { pathPrefix: '', groupInputs: null });
      result[s.key] = { value: out.value, type: T.formatType(out.type) };
    }
    return { ok: !this.diagnostics.some((d) => d.severity === 'error'), outputs: result, diagnostics: this.diagnostics };
  }

  // Validate the whole graph without needing anything to be wired to an output: evaluates every
  // terminal node (one with no outgoing links) in every scope. This is the backbone of Part 61 —
  // "Claude must never simply say Done" — because it surfaces type errors and NaNs in branches
  // that nothing is currently previewing.
  validateGraph() {
    this.diagnostics = [];
    this._diagKeys.clear();
    for (const scope of [ROOT_SCOPE, ...Object.keys(this.graph.groups)]) {
      const order = topoOrder(this.graph, scope);
      if (!order.ok) {
        this._diag('error', order.cycle[0] || null,
          `These nodes form a loop and cannot be evaluated: ${order.cycle.join(', ')}.`,
          { cycle: order.cycle });
        continue;
      }
      if (scope !== ROOT_SCOPE) continue; // group interiors evaluate through their instances
      for (const node of nodesInScope(this.graph, scope)) {
        const { outputs } = socketsOf(this.graph, node);
        const hasConsumer = Object.values(this.graph.links).some((l) => l.fromNode === node.id);
        if (hasConsumer || !outputs.length) continue;
        for (const s of outputs) this._pull(node, s.key, { pathPrefix: '', groupInputs: null });
      }
    }
    return {
      ok: !this.diagnostics.some((d) => d.severity === 'error'),
      diagnostics: this.diagnostics,
      counts: this.diagnostics.reduce((a, d) => ({ ...a, [d.severity]: (a[d.severity] || 0) + 1 }), {}),
    };
  }

  // ---------------------------------------------------------------- profiling (Part 52/53)
  profileReport() {
    const rows = [...this.profile.entries()].map(([nodeId, p]) => ({
      nodeId,
      type: this.graph.nodes[nodeId]?.type || null,
      calls: p.calls,
      cacheHits: p.cacheHits,
      totalMs: Math.round(p.totalMs * 1000) / 1000,
      avgMs: p.calls ? Math.round((p.totalMs / p.calls) * 1000) / 1000 : 0,
    }));
    rows.sort((a, b) => b.totalMs - a.totalMs);
    return {
      nodes: rows,
      cacheEntries: this.cache.size,
      totalMs: Math.round(rows.reduce((s, r) => s + r.totalMs, 0) * 1000) / 1000,
    };
  }

  // ---------------------------------------------------------------- internals
  _diag(severity, nodeId, message, extra = {}) {
    const key = `${severity}|${nodeId}|${message}`;
    if (this._diagKeys.has(key)) return;
    this._diagKeys.add(key);
    this.diagnostics.push({
      severity, nodeId: nodeId || null,
      nodeType: nodeId ? this.graph.nodes[nodeId]?.type || null : null,
      message, ...extra,
    });
  }

  // Pull one output socket of one node, in one evaluation frame (a frame is a group-instance
  // context: its path prefix namespaces the cache, and groupInputs carries the values the
  // instance's own inputs resolved to).
  _pull(node, socketKey, frame) {
    const path = frame.pathPrefix ? `${frame.pathPrefix}/${node.id}` : node.id;
    const cacheKey = `${path}|${socketKey}`;
    const hit = this.cache.get(cacheKey);
    if (hit) {
      if (this.options.profiling) this._prof(node.id).cacheHits++;
      return hit;
    }

    if (this._depth > MAX_DEPTH) {
      this._diag('error', node.id, `Evaluation nested more than ${MAX_DEPTH} levels deep — this usually means a group contains itself.`);
      return this._fallback(node, socketKey);
    }

    const started = this.options.profiling ? nowMs() : 0;
    this._depth++;
    let result;
    try {
      result = this._compute(node, socketKey, frame, path);
    } catch (e) {
      this._diag('error', node.id, `This node failed: ${e.message}`);
      result = this._fallback(node, socketKey);
    } finally {
      this._depth--;
      if (this.options.profiling) {
        const p = this._prof(node.id);
        p.calls++;
        p.totalMs += nowMs() - started;
      }
    }

    // Every value crossing a socket is NaN-checked once, here. A non-finite number that reaches a
    // particle position or a colour is unrecoverable and invisible; catching it at the boundary
    // turns it into a diagnostic that names the node that produced it.
    if (V.hasNonFinite(result.value)) {
      this._diag('warning', node.id,
        `Produced a value that is not a finite number (NaN or Infinity) — it was replaced with zero. A divide by zero or an out-of-range input is the usual cause.`,
        { socket: socketKey });
      result = { ...result, value: V.sanitize(result.value) };
    }

    this.cache.set(cacheKey, result);
    return result;
  }

  _prof(nodeId) {
    let p = this.profile.get(nodeId);
    if (!p) this.profile.set(nodeId, p = { calls: 0, totalMs: 0, cacheHits: 0 });
    return p;
  }

  _fallback(node, socketKey) {
    const s = socketsOf(this.graph, node).outputs.find((x) => x.key === socketKey);
    const type = s ? this._concreteType(s.type) : T.parseType('float');
    return { value: T.defaultValue(type), type, timeDependent: false };
  }

  // A signature type with unbound generics, evaluated as a concrete type: unbound variables fall
  // back to float so a partially-wired node still yields something usable.
  _concreteType(ref) {
    return T.containsGeneric(ref) ? T.substitute(ref, {}) : ref;
  }

  _compute(node, socketKey, frame, path) {
    // --- group boundary nodes
    if (node.type === GROUP_INPUT_TYPE) {
      const provided = frame.groupInputs?.[socketKey];
      if (provided) return provided;
      const s = socketsOf(this.graph, node).outputs.find((x) => x.key === socketKey);
      const type = s ? s.type : T.parseType('float');
      const dflt = s && s.default !== undefined ? s.default : T.defaultValue(type);
      return { value: dflt, type, timeDependent: false };
    }
    if (isGroupInstanceType(node.type)) return this._computeGroupInstance(node, socketKey, frame, path);

    const def = getNodeType(node.type);
    if (!def) {
      this._diag('error', node.id, `Node type "${node.type}" is not available in this build.`);
      return this._fallback(node, socketKey);
    }

    // --- muted: outputs are type defaults, upstream is not evaluated at all
    if (node.muted) {
      const s = def.outputs.find((x) => x.key === socketKey);
      const type = s ? this._concreteType(s.type) : T.parseType('float');
      return { value: T.defaultValue(type), type, timeDependent: false };
    }

    // --- resolve inputs, unifying generics as we go
    const bindings = {};
    const resolved = {};   // socketKey -> { value, type, timeDependent }
    const liftedKeys = [];  // inputs that arrived as a field where the node wanted a plain value
    let timeDependent = !!def.timeDependent;

    for (const s of def.inputs) {
      const got = this._resolveInput(node, s, frame, path);
      resolved[s.key] = got;
      if (got.timeDependent) timeDependent = true;
      if (T.containsGeneric(s.type) && got.type) {
        if (!T.unify(s.type, got.type, bindings)) {
          this._diag('warning', node.id,
            `"${s.label}" received ${T.formatType(got.type)}, which does not fit this node's other inputs — it was ignored.`,
            { socket: s.key });
        }
      }
      // A field arriving at a socket that asked for a plain value lifts the whole node. This is
      // deliberately checked for CONCRETE socket types as well as generic ones: it means a node
      // author writes `Length(vector3) -> float` once and it works spatially for free. A node that
      // wants the raw field instead declares `field<...>` in its signature, and then this test is
      // false because the socket type is itself a field.
      if (got.type && T.isFieldType(got.type) && !T.isFieldType(s.type)) {
        liftedKeys.push(s.key);
        bindings.__lifted = true;
      }
    }

    // --- bypassed: pass the first input through to the requested output when the types allow it
    if (node.bypassed) {
      const passthrough = this._bypass(node, def, socketKey, resolved, bindings);
      if (passthrough) return passthrough;
    }

    const lifted = !!bindings.__lifted && def.lift !== false && liftedKeys.length > 0;
    const inputs = {};
    const perSampleConv = {};  // key -> { from, to } inner types, applied at sample time

    // Convert each input into the type the node actually asked for (with generics substituted).
    // Inputs that arrived as fields stay as fields and are sampled per element inside the closure
    // below; everything else is converted once, now.
    for (const s of def.inputs) {
      const want = T.substitute(s.type, bindings);
      const got = resolved[s.key];
      if (lifted && liftedKeys.includes(s.key)) {
        inputs[s.key] = got.value; // a field; sampled per element
        perSampleConv[s.key] = {
          from: T.isFieldType(got.type) ? got.type.param : got.type,
          to: T.isFieldType(want) ? want.param : want,
        };
        continue;
      }
      inputs[s.key] = this._coerce(node, s, got, want);
    }

    const api = this._makeApi(node, def, bindings, path, frame);

    if (!lifted) {
      const produced = def.evaluate(api, inputs);
      return this._packOutputs(node, def, socketKey, produced, bindings, timeDependent);
    }

    // --- lifted evaluation: the node becomes a field. Its evaluate() runs once per sample, with
    // every generic input sampled at that point first. Constant fields are sampled too (their
    // sample() is a closure over a constant), which keeps this path uniform at negligible cost.
    const outSocket = def.outputs.find((x) => x.key === socketKey);
    const outWant = outSocket ? T.substitute(outSocket.type, bindings) : T.parseType('float');
    const innerType = T.isFieldType(outWant) ? outWant.param : outWant;
    const fieldType = T.fieldOf(innerType);

    const field = F.makeField(innerType, (sampleCtx) => {
      const perSample = { ...inputs };
      for (const key of liftedKeys) {
        const sampled = F.sampleAny(inputs[key], sampleCtx);
        const c = perSampleConv[key];
        perSample[key] = c ? T.convertValue(sampled, c.from, c.to) : sampled;
      }
      const produced = def.evaluate({ ...api, sample: sampleCtx }, perSample);
      const value = produced && typeof produced === 'object' && !Array.isArray(produced) && socketKey in produced
        ? produced[socketKey]
        : produced;
      return V.sanitize(value);
    });

    return { value: field, type: fieldType, timeDependent };
  }

  // Turn whatever evaluate() returned into the requested socket's value. A single-output node may
  // return a bare value; a multi-output node returns an object keyed by socket.
  _packOutputs(node, def, socketKey, produced, bindings, timeDependent) {
    const outSocket = def.outputs.find((x) => x.key === socketKey);
    const type = outSocket ? T.substitute(outSocket.type, bindings) : T.parseType('float');
    let value;
    if (def.outputs.length === 1) {
      value = produced && typeof produced === 'object' && !Array.isArray(produced) && !F.isField(produced) && socketKey in produced
        ? produced[socketKey]
        : produced;
    } else {
      if (!produced || typeof produced !== 'object' || Array.isArray(produced)) {
        this._diag('error', node.id, `This node has several outputs but returned a single value.`);
        return this._fallback(node, socketKey);
      }
      value = produced[socketKey];
    }
    if (value === undefined) value = T.defaultValue(type);
    return { value, type, timeDependent };
  }

  // Resolve one input: the connected link if there is one, otherwise the node's stored inline
  // value, otherwise the socket default, otherwise the type default. A multi-input collects every
  // connected value into an array.
  _resolveInput(node, socket, frame, path) {
    const links = linksInto(this.graph, node.id, socket.key);
    if (socket.multi) {
      const values = [], types = [];
      let td = false;
      for (const l of links) {
        const src = this.graph.nodes[l.fromNode];
        if (!src) continue;
        const got = this._pull(src, l.fromSocket, frame);
        values.push(got.value);
        types.push(got.type);
        if (got.timeDependent) td = true;
      }
      const elemType = types[0] || (T.isArrayType(socket.type) ? socket.type.param : socket.type);
      return { value: values, type: T.arrayOf(elemType), timeDependent: td, multi: true, elementTypes: types };
    }

    const link = links[0];
    if (link) {
      const src = this.graph.nodes[link.fromNode];
      if (src) return this._pull(src, link.fromSocket, frame);
    }

    const inline = node.values?.[socket.key];
    const declared = this._concreteType(socket.type);
    // `defaultFrom` lets an unconnected socket fall back to something the evaluation context knows
    // rather than to a literal — the clock for a time input, the point being evaluated for a
    // position input. Every time-reshaping node (Loop, Ping Pong, Time Scale) and every spatial node
    // (SDFs, noise, patterns) has such an input, and with a literal default all of them sit inert
    // until the user wires the obvious thing in by hand. This is what makes Part 11's "time is a
    // value you can reshape" and Part 18's field sources composable without being fussy: the wire is
    // available when you want to override, and implied when you do not.
    if (inline === undefined && socket.defaultFrom && !link) {
      const implied = this._defaultFromContext(socket.defaultFrom);
      if (implied) {
        const want = T.isFieldType(declared) || T.containsGeneric(socket.type) ? declared : implied.type;
        return {
          value: T.convertValue(implied.value, implied.type, want),
          type: want,
          timeDependent: !!implied.timeDependent,
          inline: true,
        };
      }
    }
    const raw = inline !== undefined ? inline : (socket.default !== undefined ? socket.default : T.defaultValue(declared));
    // A socket that asks for a field, given a plain inline value, gets a constant field. Without
    // this the declared type and the actual value disagree, and a field-aware node would receive a
    // bare array where it expected something with a sample() — the kind of mismatch that only shows
    // up as a crash in one specific wiring.
    if (T.isFieldType(declared) && !F.isField(raw)) {
      return { value: T.convertValue(raw, declared.param, declared), type: declared, timeDependent: false, inline: true };
    }
    return { value: raw, type: declared, timeDependent: false, inline: true };
  }

  // What a `defaultFrom` socket may name. Deliberately a small closed set: an input that could
  // implicitly read arbitrary evaluation state would make caching unsound, since the cache tracks
  // only time-dependence.
  //
  // Two kinds:
  //   CLOCKS resolve to a number now, and are time-dependent.
  //   SAMPLE SOURCES resolve to a field that reads the sample context when it is eventually sampled.
  //     This is what makes "leave it unconnected and it means the point being evaluated" work: a
  //     Sphere SDF, a noise node or a pattern needs no Position wire to be spatial. Defaulting these
  //     to a constant zero instead — the obvious-looking alternative — silently collapses every
  //     spatial node onto the origin, which looks like the node being broken rather than unwired.
  _defaultFromContext(which) {
    switch (which) {
      case 'time': return { value: this.options.time, type: T.parseType('float'), timeDependent: true };
      case 'frame': return { value: this.options.frame, type: T.parseType('float'), timeDependent: true };
      case 'duration': return { value: this.options.duration, type: T.parseType('float'), timeDependent: true };
      case 'position': return sampleSource('vector3', (c) => c.position || [0, 0, 0]);
      case 'normal': return sampleSource('vector3', (c) => c.normal || [0, 1, 0]);
      case 'tangent': return sampleSource('vector3', (c) => c.tangent || [0, 0, 0]);
      case 'velocity': return sampleSource('vector3', (c) => c.velocity || [0, 0, 0]);
      case 'uv': return sampleSource('vector2', (c) => c.uv || [0, 0]);
      case 'age': return sampleSource('float', (c) => c.age || 0);
      case 'life': return sampleSource('float', (c) => c.life || 0);
      case 'index': return sampleSource('int', (c) => c.index || 0);
      default: return null;
    }
  }

  // Convert a resolved input into the type the node wants, reporting an incompatibility once
  // rather than silently substituting a default that looks like a working effect.
  _coerce(node, socket, got, want) {
    if (got.multi) {
      const wantElem = T.isArrayType(want) ? want.param : want;
      const srcElem = T.isArrayType(got.type) ? got.type.param : got.type;
      return (got.value || []).map((v) => T.convertValue(v, srcElem, wantElem));
    }
    if (T.sameType(got.type, want)) return got.value;
    const c = T.findConversion(got.type, want);
    if (!c) {
      this._diag('warning', node.id,
        `"${socket.label}" needs ${T.formatType(want)} but received ${T.formatType(got.type)}. The default was used instead.`,
        { socket: socket.key });
      return socket.default !== undefined ? socket.default : T.defaultValue(want);
    }
    return c.convert(got.value);
  }

  _bypass(node, def, socketKey, resolved, bindings) {
    const outSocket = def.outputs.find((x) => x.key === socketKey);
    if (!outSocket) return null;
    const want = T.substitute(outSocket.type, bindings);
    for (const s of def.inputs) {
      const got = resolved[s.key];
      if (!got || got.multi) continue;
      if (T.sameType(got.type, want) || T.canConvert(got.type, want)) {
        return { value: T.convertValue(got.value, got.type, want), type: want, timeDependent: got.timeDependent };
      }
    }
    return null; // nothing compatible to pass through — fall through to normal evaluation
  }

  // The `api` object a node's evaluate() receives. Time is present ONLY for nodes that declared
  // timeDependent, so a node cannot read the clock without the cache knowing about it.
  _makeApi(node, def, bindings, path, frame) {
    const seed = Number.isFinite(node.seed) ? node.seed : 0;
    const api = {
      node,
      path,
      seed: F.seedFor(path, V.mixSeeds(seed, this.options.seed)),
      quality: this.options.quality,
      types: Object.fromEntries(Object.entries(bindings).filter(([k]) => k !== '__lifted').map(([k, v]) => [k, T.formatType(v)])),
      typeName: (generic) => (bindings[generic] ? T.formatType(bindings[generic]) : 'float'),
      // Per-element deterministic random. `channel` decorrelates independent uses on the same
      // element, so a random size and a random colour never come out identical.
      random: (element = 0, channel = 0) => F.randomAt(path, V.mixSeeds(seed, this.options.seed), element, channel),
      // Persistent per-node state, for simulations. `factory` runs once; later calls return the same
      // object until something structurally invalidates this node. A node using this must declare
      // pure: false, so the fact that it is not a function of its inputs alone stays visible.
      persistent: (factory) => {
        let held = this.persistent.get(path);
        if (held === undefined) { held = factory(); this.persistent.set(path, held); }
        return held;
      },
      resetPersistent: () => { this.persistent.delete(path); },
      warn: (message) => this._diag('warning', node.id, message),
      error: (message) => this._diag('error', node.id, message),
      note: (message) => this._diag('info', node.id, message),
      groupPath: frame.pathPrefix,
    };
    if (def.timeDependent) {
      api.time = this.options.time;
      api.frame = this.options.frame;
      api.fps = this.options.fps;
      api.duration = this.options.duration;
    }
    return api;
  }

  // ---------------------------------------------------------------- node groups
  // A group instance evaluates its own interior in a nested frame. The instance's resolved inputs
  // become the interior Group Input node's outputs; the interior Group Output node's inputs become
  // the instance's outputs. The nested frame's path prefix namespaces the cache, so the same group
  // used twice with different inputs does not share cached values — a subtle bug this design
  // avoids by construction rather than by remembering to clear something.
  _computeGroupInstance(node, socketKey, frame, path) {
    const groupId = groupIdOfType(node.type);
    const group = this.graph.groups[groupId];
    if (!group) {
      this._diag('error', node.id, `The group this node refers to no longer exists.`);
      return this._fallback(node, socketKey);
    }

    const { inputs: gIn, outputs: gOut } = socketsOf(this.graph, node);
    const groupInputs = {};
    let timeDependent = false;
    for (const s of gIn) {
      const got = this._resolveInput(node, s, frame, path);
      const want = this._concreteType(s.type);
      groupInputs[s.key] = {
        value: got.multi ? got.value : T.convertValue(got.value, got.type, want),
        type: want,
        timeDependent: got.timeDependent,
      };
      if (got.timeDependent) timeDependent = true;
    }

    const innerFrame = { pathPrefix: path, groupInputs };
    const outNode = nodesInScope(this.graph, groupId).find((n) => n.type === GROUP_OUTPUT_TYPE);
    const outSocket = gOut.find((s) => s.key === socketKey);
    const wantType = outSocket ? this._concreteType(outSocket.type) : T.parseType('float');

    if (!outNode) {
      this._diag('warning', node.id, `The group "${group.name}" has no output node, so it produces nothing.`);
      return { value: T.defaultValue(wantType), type: wantType, timeDependent };
    }

    const links = linksInto(this.graph, outNode.id, socketKey);
    if (!links.length) {
      return { value: outSocket?.default ?? T.defaultValue(wantType), type: wantType, timeDependent };
    }
    const src = this.graph.nodes[links[0].fromNode];
    if (!src) return { value: T.defaultValue(wantType), type: wantType, timeDependent };
    const got = this._pull(src, links[0].fromSocket, innerFrame);
    return {
      value: T.convertValue(got.value, got.type, wantType),
      type: wantType,
      timeDependent: timeDependent || got.timeDependent,
    };
  }
}

function nowMs() {
  return (globalThis.performance?.now ? performance.now() : Date.now());
}

// A `defaultFrom` sample source: a field that reads one fact out of the sample context. Not a
// constant field — the whole point is that it varies per element — so it deliberately carries no
// `constant` marker and consumers will sample it per element.
function sampleSource(typeName, read) {
  return {
    value: F.makeField(typeName, read),
    type: T.fieldOf(typeName),
    timeDependent: false,
  };
}

// ---------------------------------------------------------------- convenience
// One-shot evaluation for tests, MCP calls and bake passes — no cache reuse across calls, so it is
// the wrong tool for interactive preview but the right one for "what is this worth, once".
export function evaluateOnce(graph, nodeId, socketKey, options = {}) {
  return new Evaluator(graph, options).evaluateSocket(nodeId, socketKey);
}
