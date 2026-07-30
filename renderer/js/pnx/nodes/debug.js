// Debug and utility nodes (spec Part 52).
//
// "A user should be able to understand WHY an effect is broken." That is a design requirement about
// OBSERVABILITY, and it needs nodes because the interesting values in a procedural graph are mostly
// invisible: a field is a function, so you cannot look at it — you can only look at what it returns
// at points you choose.
//
// Every node here is a PASS-THROUGH. Inspect, Assert and Watch all return their input unchanged, so
// inserting one never changes what the graph produces. That property is what makes them safe to
// leave in a finished effect, and it is why they are pass-through rather than terminal: a debug node
// you have to remove to test the real behaviour is a debug node that changes the thing it measures.
//
// Reports are collected as diagnostics through the evaluator's own `api.note` / `api.warn` channel,
// so they arrive in the same structured list the validator and the MCP verification tools already
// read (Part 61) instead of in a console nobody is watching.

import * as V from '../values.js';
import * as F from '../fields.js';
import { node, n, out, mode } from './_helpers.js';

const C = 'Debug';

// Format a value compactly for a diagnostic message. Fields are the interesting case: they get
// sampled at a small fixed set of probe points, because "it is a function" is not a useful report.
const PROBES = [
  { label: 'at origin', ctx: { position: [0, 0, 0] } },
  { label: 'at (1,0,0)', ctx: { position: [1, 0, 0] } },
  { label: 'element 0, age 0', ctx: { index: 0, age: 0, life: 0 } },
  { label: 'element 1, half life', ctx: { index: 1, life: 0.5 } },
];

function describeValue(v, probes = PROBES) {
  if (F.isField(v)) {
    if (F.isConstantField(v)) return `a constant field of ${fmt(v.constant)}`;
    const shown = probes.map((p) => `${p.label}: ${fmt(v.sample(F.newSampleContext(p.ctx)))}`);
    return `a field — ${shown.join(', ')}`;
  }
  return fmt(v);
}

function fmt(v) {
  if (v === null || v === undefined) return 'nothing';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string') return `"${v}"`;
  if (Array.isArray(v)) return `(${v.map(fmt).join(', ')})`;
  if (v && Array.isArray(v.p)) return `position ${fmt(v.p)}, rotation ${fmt(v.q)}, scale ${fmt(v.s)}`;
  if (v && Array.isArray(v.keys)) return `a curve with ${v.keys.length} key${v.keys.length === 1 ? '' : 's'}`;
  if (v && Array.isArray(v.stops)) return `a gradient with ${v.stops.length} stop${v.stops.length === 1 ? '' : 's'}`;
  if (typeof v === 'object') return 'an object';
  return String(v);
}

// ---------------------------------------------------------------- inspect
node({
  id: 'cadence.debug.inspect', label: 'Inspect', category: C, subcategory: 'Inspect',
  aliases: ['print', 'log', 'watch', 'what is this', 'value', 'peek', 'probe', 'debug'],
  summary: 'Reports what a value actually is, and passes it through unchanged.',
  teach: 'Shows you the number flowing down a wire, without changing it.',
  explain: 'A field is a function, not a number, so it cannot simply be displayed — this samples it at a few standard probe points instead. Inserting this node never changes what the graph produces, so it is safe to leave in place.',
  commonUses: ['finding out why a value is zero', 'checking a field varies the way you expect'],
  exportSupport: 'native',
  exportNote: 'Disappears entirely on export; it produces no runtime cost.',
  generics: { T: { kinds: ['float', 'int', 'bool', 'string', 'vector2', 'vector3', 'vector4', 'color', 'quaternion', 'transform', 'curve', 'gradient', 'any'] } },
  inputs: [{ key: 'value', label: 'Value', type: 'T', default: 0 }],
  outputs: [out('out', 'Value')],
  lift: false,   // must see the field itself, not be lifted into it
  evaluate: (api, i) => {
    api.note(`Inspect: ${describeValue(i.value)}`);
    return i.value;
  },
});

node({
  id: 'cadence.debug.range', label: 'Value Range', category: C, subcategory: 'Inspect',
  aliases: ['min max', 'bounds', 'how big', 'spread', 'histogram', 'extent'],
  summary: 'Measures the smallest and largest values a field takes over a region, and passes it through.',
  explain: 'Samples the field on a grid inside a box and reports the range it found. This is how you discover that a noise field you expected to be 0..1 is actually -0.7..0.7 — which is the most common reason a mask looks wrong.',
  commonUses: ['checking a noise field is in the range you assumed', 'finding out why an effect is invisible'],
  exportSupport: 'native', performance: 'moderate',
  inputs: [
    { key: 'value', label: 'Field', type: 'field<float>', default: 0 },
    n('extent', 'Region size', 4, { min: 1e-3, unit: 'studs' }),
    { key: 'resolution', label: 'Samples per axis', type: 'int', default: 6, min: 2, max: 24 },
  ],
  outputs: [
    { key: 'out', label: 'Field', type: 'field<float>' },
    { key: 'min', label: 'Smallest', type: 'float' },
    { key: 'max', label: 'Largest', type: 'float' },
    { key: 'average', label: 'Average', type: 'float' },
  ],
  lift: false,
  evaluate: (api, i) => {
    const res = Math.max(2, Math.min(24, Math.round(i.resolution)));
    const half = Math.max(1e-3, i.extent) / 2;
    let lo = Infinity, hi = -Infinity, sum = 0, count = 0;
    for (let x = 0; x < res; x++) {
      for (let y = 0; y < res; y++) {
        for (let z = 0; z < res; z++) {
          const p = [
            -half + (2 * half * x) / (res - 1),
            -half + (2 * half * y) / (res - 1),
            -half + (2 * half * z) / (res - 1),
          ];
          const v = Number(F.sampleAny(i.value, F.newSampleContext({ position: p, index: count })));
          if (!Number.isFinite(v)) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
          sum += v; count++;
        }
      }
    }
    if (!count) {
      api.warn('Value Range found nothing finite to measure.');
      return { out: i.value, min: 0, max: 0, average: 0 };
    }
    api.note(`Value Range over ${Math.max(1e-3, i.extent)} studs: ${fmt(lo)} to ${fmt(hi)}, average ${fmt(sum / count)}`);
    return { out: i.value, min: lo, max: hi, average: sum / count };
  },
});

// ---------------------------------------------------------------- assertions
node({
  id: 'cadence.debug.assert', label: 'Assert', category: C, subcategory: 'Check',
  aliases: ['check', 'require', 'must be', 'validate', 'guard', 'expect'],
  summary: 'Warns when a value leaves the range you expect, and passes it through.',
  explain: 'A deliberate tripwire. Put it on a value that should never go negative, or should stay within 0 to 1, and the graph will tell you the moment it does — rather than the effect quietly looking wrong. It never changes the value; it only reports.',
  commonUses: ['catching an opacity that has gone above 1', 'catching a lifetime that has gone to zero'],
  exportSupport: 'native',
  inputs: [
    { key: 'value', label: 'Value', type: 'field<float>', default: 0 },
    n('min', 'Expected at least', 0),
    n('max', 'Expected at most', 1),
    { key: 'label', label: 'Name', type: 'string', default: '', socket: false },
  ],
  outputs: [{ key: 'out', label: 'Value', type: 'field<float>' }],
  lift: false,
  evaluate: (api, i) => {
    const name = i.label ? `"${i.label}"` : 'This value';
    const lo = Math.min(i.min, i.max), hi = Math.max(i.min, i.max);
    let reported = false;
    return F.makeField('float', (ctx) => {
      const v = Number(F.sampleAny(i.value, ctx));
      if (!reported && Number.isFinite(v) && (v < lo || v > hi)) {
        reported = true;   // one report per evaluation, not one per particle
        api.warn(`${name} reached ${fmt(v)}, outside the expected ${fmt(lo)} to ${fmt(hi)}.`);
      }
      return v;
    });
  },
});

node({
  id: 'cadence.debug.finite', label: 'Guard Against NaN', category: C, subcategory: 'Check',
  aliases: ['nan', 'infinity', 'not a number', 'sanitize', 'safe', 'fix broken'],
  summary: 'Replaces any value that is not a finite number with a fallback, and says where it happened.',
  explain: 'A single NaN reaching a position or a colour destroys everything downstream of it and is invisible — nothing draws, with no error. The engine already checks values crossing sockets, but a field is only checked when it is sampled, so this node is how you pin down a NaN that appears inside a per-particle chain.',
  commonUses: ['isolating a divide-by-zero in a field chain', 'protecting an export from a bad frame'],
  exportSupport: 'converted',
  generics: { T: { kinds: V.NUMERIC_KINDS } },
  inputs: [
    { key: 'value', label: 'Value', type: 'field<T>', default: 0 },
    { key: 'fallback', label: 'If broken', type: 'T', default: 0 },
  ],
  outputs: [{ key: 'out', label: 'Value', type: 'field<T>' }],
  lift: false,
  evaluate: (api, i) => {
    const tn = api.typeName('T');
    let reported = false;
    return F.makeField(tn, (ctx) => {
      const v = F.sampleAny(i.value, ctx);
      if (!V.hasNonFinite(v)) return v;
      if (!reported) {
        reported = true;
        api.warn(`A value here was not a finite number and was replaced with ${fmt(i.fallback)}.`);
      }
      return i.fallback;
    });
  },
});

// ---------------------------------------------------------------- visualisation
node({
  id: 'cadence.debug.visualize', label: 'Visualise Field', category: C, subcategory: 'Inspect',
  aliases: ['show field', 'see field', 'preview field', 'colour by value', 'heatmap', 'false colour'],
  summary: 'Turns any number field into a colour so you can see it in the preview.',
  teach: 'Paints a field as colour: dark where the value is low, bright where it is high.',
  explain: 'Values outside the low-to-high range are clamped, so a bright white area means "at or above the high value" rather than "exactly the high value". The signed mode is the one to use for a distance field — it paints negative (inside) and positive (outside) different colours with a visible line at zero.',
  commonUses: ['seeing what a noise field actually looks like', 'checking where an SDF surface lies'],
  exportSupport: 'unsupported',
  exportNote: 'A diagnostic view, not part of an effect — it is not exported.',
  inputs: [
    { key: 'value', label: 'Field', type: 'field<float>', default: 0 },
    n('low', 'Low', 0),
    n('high', 'High', 1),
    mode('style', 'Style', ['greyscale', 'heat', 'signed'], 'greyscale'),
  ],
  outputs: [{ key: 'out', label: 'Colour', type: 'field<color>' }],
  lift: false,
  evaluate: (api, i) => F.makeField('color', (ctx) => {
    const v = Number(F.sampleAny(i.value, ctx)) || 0;
    if (i.style === 'signed') {
      // Blue inside, red outside, with a bright band at the zero crossing so the surface is legible.
      const band = Math.exp(-Math.abs(v) * 24);
      const s = V.clamp01(Math.abs(v) / Math.max(1e-6, Math.max(Math.abs(i.low), Math.abs(i.high))));
      return v < 0
        ? [band, band + s * 0.2, Math.max(band, s), 1]
        : [Math.max(band, s), band + s * 0.2, band, 1];
    }
    const t = V.clamp01((v - i.low) / (Math.abs(i.high - i.low) < 1e-12 ? 1 : i.high - i.low));
    if (i.style === 'heat') {
      // black -> red -> orange -> white, the standard temperature read.
      return [V.clamp01(t * 3), V.clamp01(t * 3 - 1), V.clamp01(t * 3 - 2), 1];
    }
    return [t, t, t, 1];
  }),
});

// ---------------------------------------------------------------- utilities
node({
  id: 'cadence.utility.reroute', label: 'Reroute', category: 'Utilities', subcategory: 'Layout',
  aliases: ['dot', 'pin', 'bend wire', 'tidy', 'pass through'],
  summary: 'Passes a value straight through, for tidying up wires.',
  explain: 'Purely visual. It exists so a long wire can be routed around other nodes without implying anything about the data, and it costs nothing at evaluation time.',
  exportSupport: 'native',
  generics: { T: { kinds: ['float', 'int', 'bool', 'string', 'vector2', 'vector3', 'vector4', 'color', 'quaternion', 'transform', 'curve', 'gradient', 'any'] } },
  inputs: [{ key: 'value', label: 'In', type: 'T', default: 0 }],
  outputs: [out('out', 'Out')],
  lift: false,
  evaluate: (api, i) => i.value,
});

node({
  id: 'cadence.utility.comment', label: 'Note', category: 'Utilities', subcategory: 'Layout',
  aliases: ['comment', 'label', 'annotation', 'text', 'remark', 'documentation'],
  summary: 'A written note attached to the graph.',
  explain: 'Produces no value and affects nothing. It is here so an 80-node subgraph can explain itself to whoever opens it next, including you.',
  exportSupport: 'native',
  inputs: [{ key: 'text', label: 'Text', type: 'string', default: '', socket: false }],
  outputs: [],
  evaluate: () => ({}),
});
