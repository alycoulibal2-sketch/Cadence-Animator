// Node-definition helpers. Part 79 ("do NOT build 1,000 copy-pasted nodes") is a rule about the
// SOURCE as much as about the catalogue: the way to get one `Add` that works over float, vector2,
// vector3, vector4, colour and every field of those is to declare the operation once and let the
// type system carry it, not to write six variants.
//
// `pointwise1/2/3` register a node whose operation applies component-by-component over a generic
// numeric type. Combined with the evaluator's automatic field lifting, one call here yields an
// operation valid on every numeric type AND on fields of every numeric type.

import { registerNode } from '../registry.js';
import * as V from '../values.js';

const NUMERIC = V.NUMERIC_KINDS;

// Shared socket shorthands. `n()` is a plain number input with a UI range; `t()` is a
// generic-typed value input.
export const t = (key, label, extra = {}) => ({ key, label, type: 'T', default: 0, ...extra });
export const n = (key, label, dflt = 0, extra = {}) => ({ key, label, type: 'float', default: dflt, ...extra });
export const i = (key, label, dflt = 0, extra = {}) => ({ key, label, type: 'int', default: dflt, ...extra });
export const b = (key, label, dflt = false, extra = {}) => ({ key, label, type: 'bool', default: dflt, ...extra });
export const v3 = (key, label, dflt = [0, 0, 0], extra = {}) => ({ key, label, type: 'vector3', default: dflt, ...extra });
export const col = (key, label, dflt = [1, 1, 1, 1], extra = {}) => ({ key, label, type: 'color', default: dflt, ...extra });
export const out = (key, label, type = 'T') => ({ key, label, type });

// An enum input: a mode switch, not a value. `socket: false` means no wire can drive it, which is
// honest — these change what a node IS, not what it computes.
export const mode = (key, label, options, dflt, extra = {}) => ({
  key, label, type: 'string', default: dflt, options, socket: false, ...extra,
});

function base(spec) {
  return {
    version: spec.version || 1,
    label: spec.label,
    category: spec.category,
    subcategory: spec.subcategory,
    summary: spec.summary,
    teach: spec.teach,
    explain: spec.explain,
    aliases: spec.aliases || [],
    exportSupport: spec.exportSupport || 'baked',
    exportNote: spec.exportNote,
    performance: spec.performance || 'trivial',
    commonUses: spec.commonUses,
    examples: spec.examples,
    preview: spec.preview,
    lesson: spec.lesson,
  };
}

// One generic input -> one generic output, applied per component.
export function pointwise1(spec) {
  const kinds = spec.kinds || NUMERIC;
  return registerNode({
    ...base(spec),
    id: spec.id,
    generics: { T: { kinds } },
    inputs: [t('value', spec.inputLabel || 'Value', spec.inputExtra), ...(spec.extraInputs || [])],
    outputs: [out('out', spec.outputLabel || 'Result')],
    evaluate: (api, inp) => V.mapValue(api.typeName('T'), inp.value, (c, idx) => spec.fn(c, inp, api, idx)),
  });
}

// Two generic inputs -> one generic output, applied per component. Both inputs share the type
// variable, so `add(0.5, vector3)` resolves T = vector3 and broadcasts the scalar.
export function pointwise2(spec) {
  const kinds = spec.kinds || NUMERIC;
  return registerNode({
    ...base(spec),
    id: spec.id,
    generics: { T: { kinds } },
    inputs: [
      t('a', spec.aLabel || 'A', spec.aExtra),
      t('b', spec.bLabel || 'B', { ...(spec.bDefault !== undefined ? { default: spec.bDefault } : {}), ...spec.bExtra }),
      ...(spec.extraInputs || []),
    ],
    outputs: [out('out', spec.outputLabel || 'Result')],
    evaluate: (api, inp) => V.zipValue(api.typeName('T'), inp.a, inp.b, (x, y, idx) => spec.fn(x, y, inp, api, idx)),
  });
}

export function pointwise3(spec) {
  const kinds = spec.kinds || NUMERIC;
  return registerNode({
    ...base(spec),
    id: spec.id,
    generics: { T: { kinds } },
    inputs: [
      t('a', spec.aLabel || 'A', spec.aExtra),
      t('b', spec.bLabel || 'B', spec.bExtra),
      t('c', spec.cLabel || 'C', spec.cExtra),
      ...(spec.extraInputs || []),
    ],
    outputs: [out('out', spec.outputLabel || 'Result')],
    evaluate: (api, inp) => V.zip3Value(api.typeName('T'), inp.a, inp.b, inp.c, (x, y, z, idx) => spec.fn(x, y, z, inp, api, idx)),
  });
}

// A node with a fixed, non-generic signature — everything the pointwise helpers cannot express.
export function node(spec) {
  return registerNode({
    ...base(spec),
    id: spec.id,
    generics: spec.generics || {},
    inputs: spec.inputs || [],
    outputs: spec.outputs || [],
    evaluate: spec.evaluate,
    timeDependent: spec.timeDependent,
    lift: spec.lift,
    pure: spec.pure,
    migrate: spec.migrate,
  });
}

// A pure constant — no inputs, one output. Kept separate so the catalogue can offer them as a
// group and so they are trivially recognisable as cacheable forever.
export function constant(spec) {
  return registerNode({
    ...base(spec),
    id: spec.id,
    category: spec.category || 'Input',
    subcategory: spec.subcategory || 'Constants',
    exportSupport: spec.exportSupport || 'native',
    inputs: [],
    outputs: [{ key: 'out', label: spec.label, type: spec.type || 'float' }],
    evaluate: () => spec.value,
  });
}

// Guarded division: a divide by zero yields zero rather than Infinity. Documented on every node
// that uses it, because "0" is a choice — but it is the only choice that keeps a field finite at
// its singularities, and a field that goes non-finite at one point blanks the whole effect.
export const safeDiv = (a, b) => (b === 0 ? 0 : a / b);

// Euclidean modulo: the result carries the SIGN OF THE DIVISOR, so mod(-1, 3) is 2, not -1. This
// is what makes tiling and wrapping behave sensibly at negative coordinates — the C-style
// remainder produces a visible seam at the origin, which is a bug users report as "my pattern
// mirrors on one side".
export const emod = (a, b) => (b === 0 ? 0 : a - Math.floor(a / b) * b);
