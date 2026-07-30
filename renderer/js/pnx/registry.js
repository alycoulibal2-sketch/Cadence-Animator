// PNX node registry — the catalogue of node types, their documentation, and node search.
//
// A node type is identified by a STABLE id plus a version (`cadence.math.multiply@1`, spec Part
// 66). The display label is free to change; the id is not. Serialized graphs store the versioned
// id, and a type can declare per-version `migrate` functions so an old project keeps loading.
//
// Registration VALIDATES the definition, and that validation is where several of the
// specification's rules stop being aspirations:
//   - Part 78 (no fake features): a node whose socket uses a type marked `implemented: false`
//     cannot be registered. A subsystem that isn't built cannot accidentally grow a UI.
//   - Part 50 (documentation): `summary` is mandatory. A node with no one-sentence description of
//     what it does does not get into the catalogue.
//   - Part 56 (export classification): `exportSupport` is mandatory, so the export report can
//     never be out of step with what the exporter actually does.
//
// EVERY input is a socket with an inline default editor, rather than there being a separate
// "parameters" concept — that is what makes Part 11 work ("everything that can reasonably vary
// over time should accept fields/curves, not need a dedicated over-lifetime variant of every
// node"). The exception is `socket: false` inputs: enums and mode switches that change a node's
// STRUCTURE rather than its value, which cannot meaningfully be driven by a wire.

import { parseType, formatType, isImplementedType, containsGeneric, typeMeta } from './types.js';

// Part 49's add-menu categories, in menu order.
export const CATEGORIES = [
  'Input', 'Math', 'Vector', 'Color', 'Transform',
  'Time', 'Logic', 'Events', 'Random',
  'Noise', 'Patterns', 'Textures',
  'Fields', 'Attributes',
  'Geometry', 'Curves', 'SDF',
  'Particles', 'Instances',
  'Forces', 'Simulation', 'Collision',
  'Fluids', 'Pyro', 'Volumes',
  'Materials', 'Shaders',
  'Renderers', 'Lights', 'Camera',
  'Compositing', 'Audio',
  'Groups', 'Roblox', 'Debug', 'Utilities',
];

// Part 56's five-level support classification. The existing effect exporter's `exportMode` column
// (baked/scheduled/approximated/dropped) maps onto this: `scheduled` is a form of `converted`.
export const EXPORT_SUPPORT = ['native', 'converted', 'approximated', 'baked', 'unsupported'];
export const PERFORMANCE_CLASSES = ['trivial', 'cheap', 'moderate', 'expensive'];

const nodeTypes = new Map();      // 'id@version' -> def
const latestByBaseId = new Map(); // 'id' -> highest registered version

export class RegistrationError extends Error {}

function fail(id, message) {
  throw new RegistrationError(`node "${id}": ${message}`);
}

function validateSocket(id, s, kind, seenKeys) {
  if (!s || typeof s.key !== 'string' || !s.key) fail(id, `${kind} needs a key`);
  if (seenKeys.has(s.key)) fail(id, `duplicate ${kind} key "${s.key}"`);
  seenKeys.add(s.key);
  const ref = parseType(s.type);
  if (!ref) fail(id, `${kind} "${s.key}" has an unknown type "${s.type}"`);
  // Generic variables are resolved at evaluation time, so they cannot be checked for
  // implementedness here — but a concrete type can, and that is where Part 78 is enforced.
  if (!containsGeneric(ref) && !isImplementedType(ref)) {
    const meta = typeMeta(ref.name);
    fail(id, `${kind} "${s.key}" uses type "${formatType(ref)}", which is declared but not yet implemented`
      + (meta?.phase ? ` (planned for phase ${meta.phase})` : '')
      + '. Define the backend before exposing a node that needs it.');
  }
  return { ...s, type: ref, label: s.label || s.key };
}

export function registerNode(def) {
  const baseId = def?.id;
  // A dotted path of lowerCamelCase segments: `cadence.math.multiply`, `cadence.color.adjustHsv`.
  // Each segment must START lowercase, which is what keeps ids predictable enough to guess and
  // stops `Cadence.Math.Multiply` and `cadence.math.multiply` from ever being two different nodes.
  if (typeof baseId !== 'string' || !/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/.test(baseId)) {
    fail(String(baseId), 'id must be a dotted lowerCamelCase path like "cadence.math.multiplyAdd"');
  }
  const version = Number.isInteger(def.version) ? def.version : 1;
  const fullId = `${baseId}@${version}`;
  if (nodeTypes.has(fullId)) fail(fullId, 'already registered');

  if (!def.label) fail(fullId, 'needs a label');
  if (!def.summary) fail(fullId, 'needs a one-sentence summary (spec Part 50)');
  if (!CATEGORIES.includes(def.category)) fail(fullId, `category "${def.category}" is not one of the known categories`);
  if (!EXPORT_SUPPORT.includes(def.exportSupport)) {
    fail(fullId, `exportSupport must be one of ${EXPORT_SUPPORT.join('/')} (spec Part 56) — it is what the export report is built from`);
  }
  if (def.performance && !PERFORMANCE_CLASSES.includes(def.performance)) {
    fail(fullId, `performance must be one of ${PERFORMANCE_CLASSES.join('/')}`);
  }
  if (typeof def.evaluate !== 'function' && !def.stage) {
    fail(fullId, 'needs an evaluate() (or a `stage` marker for simulation-stage nodes)');
  }

  const inKeys = new Set(), outKeys = new Set();
  const inputs = (def.inputs || []).map((s) => validateSocket(fullId, s, 'input', inKeys));
  const outputs = (def.outputs || []).map((s) => validateSocket(fullId, s, 'output', outKeys));

  // Generic variables used in sockets must be declared, so a typo in a type reads as an error at
  // registration rather than as a silently-defaulted float at evaluation time.
  const declared = new Set(Object.keys(def.generics || {}));
  for (const s of [...inputs, ...outputs]) {
    for (const g of collectGenerics(s.type)) {
      if (!declared.has(g)) fail(fullId, `socket "${s.key}" uses undeclared generic "${g}"`);
    }
  }

  const entry = Object.freeze({
    ...def,
    id: baseId,
    version,
    fullId,
    inputs, outputs,
    generics: def.generics || {},
    aliases: def.aliases || [],
    performance: def.performance || 'trivial',
    pure: def.pure !== false,
    searchText: [def.label, baseId, def.category, def.subcategory, def.summary, ...(def.aliases || [])]
      .filter(Boolean).join(' ').toLowerCase(),
  });
  nodeTypes.set(fullId, entry);
  const prev = latestByBaseId.get(baseId);
  if (prev === undefined || version > prev) latestByBaseId.set(baseId, version);
  return entry;
}

function collectGenerics(ref, out = []) {
  if (!ref) return out;
  if (!ref.param && /^[A-Z][0-9]?$/.test(ref.name)) out.push(ref.name);
  if (ref.param) collectGenerics(ref.param, out);
  return out;
}

// ---------------------------------------------------------------- lookup
// Accepts 'cadence.math.add' (resolves to the newest registered version) or
// 'cadence.math.add@1' (exact). A graph always stores the exact form; a human or an MCP call may
// use either.
export function getNode(idOrFullId) {
  if (typeof idOrFullId !== 'string') return null;
  if (idOrFullId.includes('@')) return nodeTypes.get(idOrFullId) || null;
  const v = latestByBaseId.get(idOrFullId);
  return v === undefined ? null : nodeTypes.get(`${idOrFullId}@${v}`) || null;
}

export function latestVersionOf(baseId) {
  return latestByBaseId.get(baseId) ?? null;
}

export function allNodes() {
  return [...nodeTypes.values()];
}

export function nodeCount() {
  return nodeTypes.size;
}

// Only the newest version of each id — what an add-menu should offer. Older versions stay
// resolvable so old graphs load, but must not be creatable from the UI.
export function currentNodes() {
  return [...latestByBaseId.entries()].map(([id, v]) => nodeTypes.get(`${id}@${v}`)).filter(Boolean);
}

export function nodesByCategory() {
  const out = {};
  for (const c of CATEGORIES) out[c] = [];
  for (const n of currentNodes()) (out[n.category] || (out[n.category] = [])).push(n);
  for (const c of Object.keys(out)) {
    out[c].sort((a, b) => (a.subcategory || '').localeCompare(b.subcategory || '') || a.label.localeCompare(b.label));
    if (!out[c].length) delete out[c];
  }
  return out;
}

// ---------------------------------------------------------------- search (Part 48)
// Ranked, not filtered. The spec's own examples are the acceptance criteria: "swirl" must reach
// Vortex Field / Curl Noise / Rotate Vector / Orbit, and "fade" must reach Opacity / Curve /
// Map Range / Normalized Age. Those associations live in each node's `aliases`, which is why
// aliases are part of the node contract rather than an afterthought.
export function searchNodes(query, { category = null, limit = 40 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  let pool = currentNodes();
  if (category) pool = pool.filter((n) => n.category === category);
  if (!q) return pool.slice(0, limit);

  const terms = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const n of pool) {
    let score = 0;
    const label = n.label.toLowerCase();
    for (const t of terms) {
      if (label === t) score += 100;
      else if (label.startsWith(t)) score += 60;
      else if (label.includes(t)) score += 40;
      if (n.aliases.some((a) => a.toLowerCase() === t)) score += 55;
      else if (n.aliases.some((a) => a.toLowerCase().includes(t))) score += 25;
      if (n.id.includes(t)) score += 20;
      if ((n.category || '').toLowerCase() === t) score += 18;
      if ((n.summary || '').toLowerCase().includes(t)) score += 10;
      if (!label.includes(t) && !n.searchText.includes(t)) score -= 35; // a term matching nothing is evidence against
    }
    if (score > 0) scored.push({ n, score });
  }
  scored.sort((a, b) => b.score - a.score || a.n.label.localeCompare(b.n.label));
  return scored.slice(0, limit).map((s) => s.n);
}

// ---------------------------------------------------------------- introspection (Part 60)
// The structured description an MCP client reads instead of guessing at node names and parameters.
// Everything a caller needs to construct a valid node without a round trip through the UI.
export function describeNode(idOrFullId) {
  const n = getNode(idOrFullId);
  if (!n) return null;
  const socket = (s) => ({
    key: s.key,
    label: s.label,
    type: formatType(s.type),
    connectable: s.socket !== false,
    ...(s.default !== undefined ? { default: s.default } : {}),
    ...(s.unit ? { unit: s.unit } : {}),
    ...(s.min !== undefined ? { min: s.min } : {}),
    ...(s.max !== undefined ? { max: s.max } : {}),
    ...(s.options ? { options: s.options } : {}),
    ...(s.multi ? { multi: true } : {}),
    ...(s.description ? { description: s.description } : {}),
  });
  return {
    id: n.id,
    fullId: n.fullId,
    version: n.version,
    label: n.label,
    category: n.category,
    subcategory: n.subcategory || null,
    summary: n.summary,
    teach: n.teach || null,
    explain: n.explain || null,
    aliases: n.aliases,
    generics: Object.fromEntries(Object.entries(n.generics).map(([k, g]) => [k, g.kinds || []])),
    inputs: n.inputs.map(socket),
    outputs: n.outputs.map(socket),
    exportSupport: n.exportSupport,
    exportNote: n.exportNote || null,
    performance: n.performance,
    preview: n.preview || null,
    examples: n.examples || [],
    commonUses: n.commonUses || [],
    lesson: n.lesson || null,
    pure: n.pure,
  };
}

// The compact catalogue: one line per node. Small enough to hand to an MCP client whole, which is
// what stops a caller inventing node names that do not exist.
export function catalogue() {
  return currentNodes().map((n) => ({
    id: n.id, version: n.version, label: n.label, category: n.category,
    summary: n.summary, exportSupport: n.exportSupport,
    inputs: n.inputs.map((s) => `${s.key}:${formatType(s.type)}`),
    outputs: n.outputs.map((s) => `${s.key}:${formatType(s.type)}`),
  }));
}

// ---------------------------------------------------------------- test support
// Only for tests that need a clean registry. Never called by the app — the catalogue is populated
// once at module load and stays put.
export function __resetRegistryForTests() {
  nodeTypes.clear();
  latestByBaseId.clear();
}
