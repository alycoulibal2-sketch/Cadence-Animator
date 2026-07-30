// Logic node family (spec Part 13).
//
// Booleans here are a real type rather than 0/1 numbers, so a mis-wire is caught at connect time
// instead of producing a silently-wrong effect. They still widen into numbers automatically, which
// is what makes a yes/no usable directly as a multiplier — the single most common way a condition
// is applied in practice.
//
// STATE NODES (Latch, Toggle, Counter, Accumulator, Previous Value) are deliberately NOT here.
// Every one of them needs memory of a previous frame, and this engine's guarantee is that
// evaluating frame 40 gives the same answer whether you arrived from frame 39 or from frame 400.
// Holding that guarantee together with real state requires the simulation stage and its frame
// cache, which is phase 5. Registering them now against no backing store would be exactly the
// pretend-it-exists button Part 78 forbids; they are listed in docs/pnx-plan.md as phase 5 work.

import * as V from '../values.js';
import { node, n, b, out, mode } from './_helpers.js';

const C = 'Logic';

const bool = (key, label, dflt = false, extra = {}) => ({ key, label, type: 'bool', default: dflt, ...extra });

// ---------------------------------------------------------------- boolean algebra
// And/Or take a multi-input, so combining five conditions is one node rather than four.
node({
  id: 'cadence.logic.and', label: 'And', category: C, subcategory: 'Boolean',
  aliases: ['both', 'all', 'every', '&&'],
  summary: 'Yes only if every input is yes.',
  explain: 'With nothing connected the answer is yes. That is the mathematically consistent choice (an empty "all of these are true" is true) and it is the useful one: an unwired gate lets everything through rather than blocking the whole effect.',
  exportSupport: 'baked',
  inputs: [{ key: 'values', label: 'Conditions', type: 'bool', multi: true }],
  outputs: [{ key: 'out', label: 'Yes/No', type: 'bool' }],
  evaluate: (api, i) => (Array.isArray(i.values) ? i.values.every(Boolean) : true),
});

node({
  id: 'cadence.logic.or', label: 'Or', category: C, subcategory: 'Boolean',
  aliases: ['either', 'any', 'at least one', '||'],
  summary: 'Yes if any input is yes.',
  exportSupport: 'baked',
  inputs: [{ key: 'values', label: 'Conditions', type: 'bool', multi: true }],
  outputs: [{ key: 'out', label: 'Yes/No', type: 'bool' }],
  evaluate: (api, i) => (Array.isArray(i.values) ? i.values.some(Boolean) : false),
});

node({
  id: 'cadence.logic.not', label: 'Not', category: C, subcategory: 'Boolean',
  aliases: ['invert', 'opposite', 'flip', 'negate', '!'],
  summary: 'Flips yes to no and no to yes.',
  exportSupport: 'baked',
  inputs: [bool('value', 'Condition')],
  outputs: [{ key: 'out', label: 'Yes/No', type: 'bool' }],
  evaluate: (api, i) => !i.value,
});

node({
  id: 'cadence.logic.xor', label: 'Exclusive Or', category: C, subcategory: 'Boolean',
  aliases: ['xor', 'one but not both', 'different'],
  summary: 'Yes if exactly one of the two inputs is yes.',
  exportSupport: 'baked',
  inputs: [bool('a', 'A'), bool('b', 'B')],
  outputs: [{ key: 'out', label: 'Yes/No', type: 'bool' }],
  evaluate: (api, i) => (!!i.a) !== (!!i.b),
});

// ---------------------------------------------------------------- selection
node({
  id: 'cadence.logic.switch', label: 'Switch', category: C, subcategory: 'Select',
  aliases: ['if', 'choose', 'either or', 'branch', 'conditional', 'select', 'ternary'],
  summary: 'Picks one of two values depending on a yes/no condition.',
  teach: 'Asks a question, and gives you one answer if it is yes and another if it is no.',
  explain: 'Both branches are evaluated whichever is chosen — this is a value graph, not a program with control flow. That matters for cost (an expensive unused branch still costs) but not for correctness: a failure in the branch not chosen cannot corrupt the result.',
  exportSupport: 'baked',
  generics: { T: { kinds: [...V.NUMERIC_KINDS, 'bool', 'string', 'transform', 'quaternion'] } },
  inputs: [
    bool('condition', 'Condition'),
    { key: 'ifTrue', label: 'If yes', type: 'T' },
    { key: 'ifFalse', label: 'If no', type: 'T' },
  ],
  outputs: [out('out', 'Result')],
  evaluate: (api, i) => (i.condition ? i.ifTrue : i.ifFalse),
});

node({
  id: 'cadence.logic.selectIndex', label: 'Select By Index', category: C, subcategory: 'Select',
  aliases: ['pick', 'choose from list', 'index', 'switch many', 'multiplex'],
  summary: 'Picks one value out of a list by its position.',
  explain: 'The index wraps rather than failing, so index 5 of a 3-item list gives item 2. A wrap is always a usable result; an out-of-range error mid-evaluation would blank the effect.',
  exportSupport: 'baked',
  generics: { T: { kinds: [...V.NUMERIC_KINDS, 'bool', 'string', 'transform', 'quaternion'] } },
  inputs: [
    { key: 'values', label: 'Values', type: 'T', multi: true },
    n('index', 'Index', 0),
  ],
  outputs: [out('out', 'Result')],
  evaluate: (api, i) => {
    const list = Array.isArray(i.values) ? i.values : [];
    if (!list.length) return V.fromComponents(api.typeName('T'), [0]);
    const k = Math.round(i.index);
    return list[((k % list.length) + list.length) % list.length];
  },
});

node({
  id: 'cadence.logic.gate', label: 'Gate', category: C, subcategory: 'Select',
  aliases: ['mask', 'enable', 'allow', 'block', 'mute', 'on off'],
  summary: 'Lets a value through when open, and gives zero when shut.',
  commonUses: ['switching a whole branch of an effect on and off from one condition'],
  exportSupport: 'baked',
  generics: { T: { kinds: V.NUMERIC_KINDS } },
  inputs: [{ key: 'value', label: 'Value', type: 'T' }, bool('open', 'Open', true)],
  outputs: [out('out', 'Result')],
  evaluate: (api, i) => (i.open ? i.value : V.mapValue(api.typeName('T'), i.value, () => 0)),
});

node({
  id: 'cadence.logic.inRange', label: 'In Range', category: C, subcategory: 'Select',
  aliases: ['between', 'within', 'band', 'window'],
  summary: 'Yes if a value sits between a low and a high limit.',
  exportSupport: 'baked',
  inputs: [n('value', 'Value'), n('low', 'Low', 0), n('high', 'High', 1), b('inclusive', 'Include the limits', true)],
  outputs: [{ key: 'out', label: 'Yes/No', type: 'bool' }],
  evaluate: (api, i) => (i.inclusive
    ? i.value >= i.low && i.value <= i.high
    : i.value > i.low && i.value < i.high),
});

// ---------------------------------------------------------------- probability
node({
  id: 'cadence.logic.randomChance', label: 'Random Chance', category: C, subcategory: 'Chance',
  aliases: ['probability', 'percent chance', 'maybe', 'coin flip', 'sometimes', 'dice'],
  summary: 'Yes some of the time, with the given probability.',
  explain: 'Decided per element from that element\'s own stable seed, so a particle that came out "yes" stays "yes" for its whole life and stays "yes" every time you scrub back to it. A fresh random number each frame would make it strobe.',
  commonUses: ['only some particles spawn a sub-effect', 'variation between instances'],
  exportSupport: 'approximated',
  exportNote: 'Roblox rolls its own randomness, so the same particles will not be chosen in-game — the proportion matches, the individuals do not.',
  inputs: [n('probability', 'Chance', 0.5, { min: 0, max: 1 }), n('seed', 'Variation', 0)],
  outputs: [{ key: 'out', label: 'Yes/No', type: 'field<bool>' }],
  evaluate: (api, i) => ({
    __field: true,
    type: 'bool',
    sample: (ctx) => api.random(ctx.index || 0, 7919 + Math.round(i.seed)) < i.probability,
  }),
});

node({
  id: 'cadence.logic.weightedChoice', label: 'Weighted Random Choice', category: C, subcategory: 'Chance',
  aliases: ['weighted random', 'loot table', 'pick with odds', 'distribution'],
  summary: 'Picks an index from a list of weights, favouring the larger ones.',
  explain: 'Weights need not add up to 1 — they are normalised. A negative weight is treated as zero. With every weight zero the result is index 0, not an error.',
  exportSupport: 'approximated',
  inputs: [
    { key: 'weights', label: 'Weights', type: 'float', multi: true },
    n('seed', 'Variation', 0),
  ],
  outputs: [{ key: 'out', label: 'Index', type: 'field<int>' }],
  evaluate: (api, i) => {
    const raw = (Array.isArray(i.weights) ? i.weights : []).map((w) => Math.max(0, Number(w) || 0));
    const total = raw.reduce((s, w) => s + w, 0);
    return {
      __field: true,
      type: 'int',
      sample: (ctx) => {
        if (!raw.length || total <= 0) return 0;
        let r = api.random(ctx.index || 0, 104729 + Math.round(i.seed)) * total;
        for (let k = 0; k < raw.length; k++) {
          r -= raw[k];
          if (r <= 0) return k;
        }
        return raw.length - 1;
      },
    };
  },
});

// ---------------------------------------------------------------- conversion
node({
  id: 'cadence.logic.toNumber', label: 'Yes/No To Number', category: C, subcategory: 'Convert',
  aliases: ['bool to float', 'as number', '1 or 0'],
  summary: 'Turns yes into 1 and no into 0.',
  explain: 'Usually unnecessary — a yes/no widens into a number automatically wherever one is wanted. Use this when you want the conversion to be visible in the graph.',
  exportSupport: 'baked',
  inputs: [bool('value', 'Condition')],
  outputs: [{ key: 'out', label: 'Number', type: 'float' }],
  evaluate: (api, i) => (i.value ? 1 : 0),
});

node({
  id: 'cadence.logic.isValid', label: 'Is Valid Number', category: C, subcategory: 'Convert',
  aliases: ['nan check', 'finite', 'sanity', 'is broken', 'debug'],
  summary: 'Yes if the value is a real, finite number.',
  explain: 'The engine already replaces non-finite values with zero at every socket and raises a warning, so this will rarely say no. It exists so a graph can defend itself explicitly at a point where an upstream divide is expected to occasionally blow up.',
  exportSupport: 'baked',
  generics: { T: { kinds: V.NUMERIC_KINDS } },
  inputs: [{ key: 'value', label: 'Value', type: 'T' }],
  outputs: [{ key: 'out', label: 'Yes/No', type: 'bool' }],
  evaluate: (api, i) => !V.hasNonFinite(i.value),
});
