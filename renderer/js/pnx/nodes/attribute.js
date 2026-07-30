// Custom attribute nodes (spec Part 5).
//
// Part 5 calls this mandatory, and the reason is the one property that separates a procedural engine
// from a properties panel: Cadence must NOT need to understand the semantic meaning of every
// attribute. `temperature`, `fuel`, `charge`, `distanceFromCore`, `magicStrength` — the engine
// stores and moves them without knowing what any of them mean. A user inventing an attribute the
// developers never imagined is the normal case, not an extension point.
//
// HOW READING AND WRITING RELATE, because the asymmetry is deliberate:
//
//   READ is a field. `Read Attribute "heat"` is a value that varies per element, so it composes
//   with every maths node in the engine immediately.
//
//   WRITE is a field TRANSFORM, not a mutation. `Set Attribute` takes the value to store and yields
//   an *attribute write* — a small record the consuming stage (a particle solver, a geometry
//   operation) applies to each element as it processes it. Nothing is mutated at graph-evaluation
//   time, because graph evaluation is cached and re-entrant: a node that mutated shared state would
//   produce different results depending on how many times the cache happened to call it, which is
//   exactly the class of bug that makes a scrubbing timeline non-deterministic.
//
// The write record is `{ __attrWrite: true, name, value }` — deliberately a plain data shape rather
// than a class, so it serializes, so a stage can inspect it, and so `array<...>` of them collects
// naturally through a multi-input.

import * as V from '../values.js';
import * as F from '../fields.js';
import { node, n, out, mode } from './_helpers.js';

const C = 'Attributes';

// A name input is a string that names a slot, so a wire cannot drive it: a graph whose attribute
// names varied per element could not be validated, previewed or exported at all.
const nameIn = (dflt = '', label = 'Name') => ({
  key: 'name', label, type: 'string', default: dflt, socket: false,
  description: 'The attribute to read or write. Any name works — the engine does not need to know what it means.',
});

export const ATTR_WRITE = '__attrWrite';
export const isAttrWrite = (v) => !!v && v[ATTR_WRITE] === true;

// Flatten whatever arrived on an attribute-write multi-input into a plain {name: value-or-field} map.
// Later writes win, matching the reading order of a stack of nodes.
export function collectAttrWrites(list, ctx = null) {
  const out = {};
  for (const w of Array.isArray(list) ? list : [list]) {
    if (!isAttrWrite(w) || !w.name) continue;
    out[w.name] = ctx ? F.sampleAny(w.value, ctx) : w.value;
  }
  return out;
}

// ---------------------------------------------------------------- read
node({
  id: 'cadence.attribute.read', label: 'Read Attribute', category: C, subcategory: 'Read',
  aliases: ['get attribute', 'attribute', 'custom property', 'lookup', 'per particle value', 'read'],
  summary: 'Reads a named value carried by the particle, point or instance being evaluated.',
  teach: 'Every particle can carry its own named values. This looks one up by name.',
  explain: 'The built-in facts (position, velocity, age, life, index, seed, uv, normal) are readable by name here too, so you do not need a different node per intrinsic. If nothing has written the name, the fallback is used — a missing attribute is never an error, because a graph is half-built most of the time.',
  commonUses: ['reading a temperature written by a spawn node', 'reading your own invented attribute like magicStrength'],
  exportSupport: 'converted',
  exportNote: 'Becomes a Roblox instance attribute where one element maps to one instance; per-particle attributes have no Roblox equivalent and are baked.',
  inputs: [
    nameIn(''),
    { key: 'fallback', label: 'If missing', type: 'T', default: 0 },
  ],
  generics: { T: { kinds: V.NUMERIC_KINDS } },
  outputs: [{ key: 'out', label: 'Value', type: 'field<T>' }],
  evaluate: (api, i) => {
    const tn = api.typeName('T');
    const name = String(i.name || '');
    if (!name) api.warn('This Read Attribute has no name, so it always returns the fallback.');
    return F.makeField(tn, (ctx) => {
      const fallback = F.sampleAny(i.fallback, ctx);
      const raw = F.attrRaw(ctx, name);
      return raw === undefined ? fallback : V.coerceToKind(tn, raw, fallback);
    });
  },
});

node({
  id: 'cadence.attribute.exists', label: 'Has Attribute', category: C, subcategory: 'Read',
  aliases: ['attribute exists', 'is set', 'defined', 'present'],
  summary: 'Whether the element being evaluated carries a named attribute at all.',
  explain: 'Distinguishes "the value is zero" from "there is no value", which Read Attribute deliberately cannot: it returns the fallback for both.',
  exportSupport: 'baked',
  inputs: [nameIn('')],
  outputs: [{ key: 'out', label: 'Present', type: 'field<bool>' }],
  evaluate: (api, i) => {
    const name = String(i.name || '');
    return F.makeField('bool', (ctx) => F.hasAttr(ctx, name));
  },
});

// ---------------------------------------------------------------- write
node({
  id: 'cadence.attribute.write', label: 'Set Attribute', category: C, subcategory: 'Write',
  aliases: ['store attribute', 'write attribute', 'create attribute', 'capture', 'remember', 'set'],
  summary: 'Stores a value on each element under a name of your choosing.',
  teach: 'Gives every particle its own named value that other parts of the graph can read back.',
  explain: 'This produces an attribute WRITE, which you plug into the stage that owns the elements (a spawn or a simulation step) — it does not change anything on its own. That is what keeps the graph re-evaluable: nothing is mutated while values are being computed, so the same frame always produces the same result no matter how often it is recomputed.',
  commonUses: ['writing a temperature at spawn so colour can read it later', 'storing distance from an impact point'],
  exportSupport: 'converted',
  inputs: [
    nameIn(''),
    { key: 'value', label: 'Value', type: 'field<T>', default: 0 },
  ],
  generics: { T: { kinds: V.NUMERIC_KINDS } },
  outputs: [{ key: 'out', label: 'Write', type: 'attributeWrite' }],
  evaluate: (api, i) => {
    const name = String(i.name || '');
    if (!name) api.warn('This Set Attribute has no name, so nothing will be stored.');
    return { [ATTR_WRITE]: true, name, value: i.value };
  },
});

node({
  id: 'cadence.attribute.remove', label: 'Delete Attribute', category: C, subcategory: 'Write',
  aliases: ['remove attribute', 'clear attribute', 'unset', 'forget'],
  summary: 'Removes a named attribute from each element.',
  explain: 'Deleting is not the same as writing zero: after this, Has Attribute reports false and Read Attribute uses its fallback. Useful for freeing memory on a large particle set once a phase of an effect is finished with a value.',
  exportSupport: 'converted',
  inputs: [nameIn('')],
  outputs: [{ key: 'out', label: 'Write', type: 'attributeWrite' }],
  evaluate: (api, i) => ({ [ATTR_WRITE]: true, name: String(i.name || ''), value: undefined, remove: true }),
});

node({
  id: 'cadence.attribute.rename', label: 'Rename Attribute', category: C, subcategory: 'Write',
  aliases: ['move attribute', 'copy attribute to'],
  summary: 'Copies an attribute to a new name and removes the old one.',
  exportSupport: 'converted',
  inputs: [
    { key: 'from', label: 'From', type: 'string', default: '', socket: false },
    { key: 'to', label: 'To', type: 'string', default: '', socket: false },
  ],
  outputs: [{ key: 'out', label: 'Writes', type: 'array<attributeWrite>' }],
  evaluate: (api, i) => {
    const from = String(i.from || ''), to = String(i.to || '');
    if (!from || !to) {
      api.warn('Rename Attribute needs both a From and a To name.');
      return [];
    }
    return [
      { [ATTR_WRITE]: true, name: to, value: F.makeField('float', (ctx) => F.attr(ctx, from, 0)) },
      { [ATTR_WRITE]: true, name: from, value: undefined, remove: true },
    ];
  },
});

// ---------------------------------------------------------------- combine / inspect
node({
  id: 'cadence.attribute.gather', label: 'Combine Attributes', category: C, subcategory: 'Write',
  aliases: ['merge attributes', 'several attributes', 'attribute list', 'bundle'],
  summary: 'Bundles several attribute writes into one connection.',
  explain: 'A stage takes one Attributes input; this is how several Set Attribute nodes reach it. Where two writes name the same attribute, the later one wins.',
  exportSupport: 'converted',
  inputs: [{ key: 'writes', label: 'Writes', type: 'attributeWrite', multi: true }],
  outputs: [{ key: 'out', label: 'Writes', type: 'array<attributeWrite>' }],
  evaluate: (api, i) => {
    const list = (Array.isArray(i.writes) ? i.writes : [i.writes]).flat().filter(isAttrWrite);
    const seen = new Map();
    for (const w of list) seen.set(w.name, w);   // later wins
    return [...seen.values()];
  },
});

// Transfer is the sampling half of Part 5's attribute list: reading one element's attribute at a
// DIFFERENT point in space. It needs a source element set to sample from, which arrives in Phase 4
// with geometry — so the general operation lives with the geometry sampling family rather than being
// half-built here. Part 78: the interface is not exposed until the backend exists.

node({
  id: 'cadence.attribute.interpolate', label: 'Blend Attributes', category: C, subcategory: 'Read',
  aliases: ['mix attributes', 'lerp attribute', 'crossfade attribute'],
  summary: 'Blends between two named attributes of the same element.',
  explain: 'A blend of 0 gives the first attribute, 1 gives the second. Handy for a value that should hand over from one meaning to another partway through an effect — for instance from spawn temperature to ambient temperature as a particle ages.',
  exportSupport: 'baked',
  inputs: [
    { key: 'a', label: 'From name', type: 'string', default: '', socket: false },
    { key: 'b', label: 'To name', type: 'string', default: '', socket: false },
    { key: 'blend', label: 'Blend', type: 'field<float>', default: 0, min: 0, max: 1 },
    n('fallback', 'If missing', 0),
  ],
  outputs: [{ key: 'out', label: 'Value', type: 'field<float>' }],
  evaluate: (api, i) => F.makeField('float', (ctx) => {
    const av = Number(F.attr(ctx, String(i.a || ''), i.fallback)) || 0;
    const bv = Number(F.attr(ctx, String(i.b || ''), i.fallback)) || 0;
    const t = V.clamp01(F.sampleAny(i.blend, ctx));
    return av + (bv - av) * t;
  }),
});
