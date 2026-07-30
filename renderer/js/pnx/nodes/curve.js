// Curve node family (spec Part 10).
//
// Part 10 says Cadence's existing Bézier functionality "should integrate with this system rather
// than become duplicated" — so it does, literally: `evalCurve` comes from effectModel.js and the
// whole easing vocabulary comes from easing.js. A curve authored on an animator track and a curve
// in a node graph are evaluated by the same code, including every easing style, its direction, and
// its per-key parameters. Learning one teaches the other, and they can never drift apart.
//
// Curve keys use `t` (the curve's own parameter) with the shape { t, v, es, ed, bez, ep } — the
// animator's key shape, unchanged.

import * as V from '../values.js';
import { evalCurve } from '../../effectModel.js';
import { ease, cubicBezier, STYLES, DIRECTIONS } from '../../easing.js';
import { node, n, out, mode } from './_helpers.js';

const C = 'Curves';

const curveIn = (key = 'curve', label = 'Curve') => ({
  key, label, type: 'curve',
  default: { kind: 'float', keys: [{ t: 0, v: 0 }, { t: 1, v: 1 }] },
});

const sortedKeys = (curve) => {
  const keys = Array.isArray(curve?.keys) ? curve.keys : Array.isArray(curve) ? curve : [];
  return keys.filter((k) => k && Number.isFinite(k.t)).slice().sort((a, b) => a.t - b.t);
};

// ---------------------------------------------------------------- evaluation
node({
  id: 'cadence.curve.evaluate', label: 'Evaluate Curve', category: C, subcategory: 'Evaluate',
  aliases: ['sample curve', 'read curve', 'curve at', 'over time', 'over life'],
  summary: 'Reads the value of a curve at a position along it.',
  teach: 'A curve is a shape drawn on a graph. This asks "how high is the line at this point?"',
  explain: 'Before the first key and after the last, the value holds flat — the same convention as an animator track, so a curve behaves identically in both editors. Between keys, the LEFT key\'s easing shapes the segment.',
  preview: 'curve',
  exportSupport: 'native',
  exportNote: 'A curve driving a particle property over life exports as a Roblox NumberSequence; a curve driving anything else is baked per frame.',
  inputs: [curveIn(), n('position', 'Position', 0)],
  outputs: [{ key: 'out', label: 'Value', type: 'float' }],
  evaluate: (api, i) => {
    const keys = sortedKeys(i.curve);
    if (!keys.length) return 0;
    const v = evalCurve(keys, i.position, keys[0].v);
    return typeof v === 'number' ? v : 0;
  },
});

node({
  id: 'cadence.curve.remap', label: 'Remap Through Curve', category: C, subcategory: 'Evaluate',
  aliases: ['shape', 'curve remap', 'apply curve', 'reshape', 'transfer'],
  summary: 'Passes a value through a curve, rescaling the input range onto the curve first.',
  commonUses: ['shaping a raw noise or distance value with a hand-drawn curve'],
  preview: 'curve',
  exportSupport: 'baked',
  inputs: [
    n('value', 'Value'),
    curveIn(),
    n('inMin', 'Input low', 0),
    n('inMax', 'Input high', 1),
  ],
  outputs: [{ key: 'out', label: 'Value', type: 'float' }],
  evaluate: (api, i) => {
    const keys = sortedKeys(i.curve);
    if (!keys.length) return i.value;
    const span = i.inMax - i.inMin;
    const f = span === 0 ? 0 : (i.value - i.inMin) / span;
    const first = keys[0].t, last = keys[keys.length - 1].t;
    const v = evalCurve(keys, first + (last - first) * f, keys[0].v);
    return typeof v === 'number' ? v : 0;
  },
});

node({
  id: 'cadence.curve.derivative', label: 'Curve Slope', category: C, subcategory: 'Evaluate',
  aliases: ['derivative', 'rate of change', 'steepness', 'velocity from curve'],
  summary: 'How steeply a curve is rising or falling at a point.',
  explain: 'Measured numerically with a small step either side, so it works on every easing style including the ones with no closed-form derivative (bounce, elastic).',
  exportSupport: 'baked',
  inputs: [curveIn(), n('position', 'Position', 0), n('step', 'Step', 0.001, { min: 1e-5 })],
  outputs: [{ key: 'out', label: 'Slope', type: 'float' }],
  evaluate: (api, i) => {
    const keys = sortedKeys(i.curve);
    if (keys.length < 2) return 0;
    const h = Math.max(1e-5, i.step);
    const at = (x) => {
      const v = evalCurve(keys, x, keys[0].v);
      return typeof v === 'number' ? v : 0;
    };
    return (at(i.position + h) - at(i.position - h)) / (2 * h);
  },
});

// ---------------------------------------------------------------- easing
// One node exposing the whole shared easing library. This is the reuse that matters most: the
// styles and directions here are exactly the ones on an animator keyframe, so an artist's
// intuition transfers between the two editors with nothing to relearn.
node({
  id: 'cadence.curve.ease', label: 'Ease', category: C, subcategory: 'Easing',
  aliases: ['easing', 'smooth', 'bounce', 'elastic', 'back', 'overshoot', 'accelerate', 'anticipate'],
  summary: 'Reshapes a 0-to-1 value with any of the standard easing styles.',
  teach: 'Turns a steady 0-to-1 slide into one that speeds up, slows down, overshoots or bounces.',
  explain: 'The same easing library the animator timeline uses, with the same style and direction names — Quad/Cubic/Expo/Circ/Back/Elastic/Bounce, In/Out/InOut/OutIn. Overshoot applies to Back; Amplitude and Period apply to Elastic.',
  preview: 'curve',
  exportSupport: 'baked',
  inputs: [
    n('value', 'Value', 0, { min: 0, max: 1 }),
    mode('style', 'Style', STYLES, 'Quad'),
    mode('direction', 'Direction', DIRECTIONS, 'Out'),
    n('overshoot', 'Overshoot (Back)', 1.70158),
    n('amplitude', 'Amplitude (Elastic)', 1),
    n('period', 'Period (Elastic)', 0.3, { min: 0.01 }),
  ],
  outputs: [{ key: 'out', label: 'Value', type: 'float' }],
  evaluate: (api, i) => ease(i.style, i.direction, i.value, {
    Overshoot: i.overshoot, Amplitude: i.amplitude, Period: i.period,
  }),
});

node({
  id: 'cadence.curve.customBezier', label: 'Custom Bezier Easing', category: C, subcategory: 'Easing',
  aliases: ['cubic bezier', 'bezier easing', 'css easing', 'handles', 'custom ease'],
  summary: 'Reshapes a 0-to-1 value with a bézier curve defined by two control handles.',
  explain: 'The same four numbers as a CSS cubic-bezier, and the same solver the curve editor uses. Handle X values outside 0-1 make the curve non-monotonic, which is legitimate (that is how you get an overshoot) but means the result may leave 0-1.',
  preview: 'curve',
  exportSupport: 'baked',
  inputs: [
    n('value', 'Value', 0, { min: 0, max: 1 }),
    n('x1', 'Handle 1 X', 0.25), n('y1', 'Handle 1 Y', 0.1),
    n('x2', 'Handle 2 X', 0.25), n('y2', 'Handle 2 Y', 1),
  ],
  outputs: [{ key: 'out', label: 'Value', type: 'float' }],
  evaluate: (api, i) => cubicBezier(i.x1, i.y1, i.x2, i.y2, Math.min(Math.max(i.value, 0), 1)),
});

// The three simple power eases the specification names individually. Deliberately separate from
// the Ease node above: these are the ones a beginner reaches for, with one obvious knob.
const powerEase = (id, label, aliases, summary, fn) => node({
  id, label, category: C, subcategory: 'Easing', aliases, summary,
  preview: 'curve', exportSupport: 'baked',
  inputs: [n('value', 'Value', 0, { min: 0, max: 1 }), n('power', 'Strength', 2, { min: 1, max: 8 })],
  outputs: [{ key: 'out', label: 'Value', type: 'float' }],
  evaluate: (api, i) => fn(Math.min(Math.max(i.value, 0), 1), Math.max(1, i.power)),
});
powerEase('cadence.curve.easeIn', 'Ease In', ['accelerate', 'slow start', 'build up'],
  'Starts slowly and speeds up.', (x, p) => Math.pow(x, p));
powerEase('cadence.curve.easeOut', 'Ease Out', ['decelerate', 'slow stop', 'settle', 'fade out'],
  'Starts quickly and slows down.', (x, p) => 1 - Math.pow(1 - x, p));
powerEase('cadence.curve.easeInOut', 'Ease In Out', ['smooth', 'both ends', 'gentle'],
  'Starts and ends slowly, quickest in the middle.',
  (x, p) => (x < 0.5 ? Math.pow(2 * x, p) / 2 : 1 - Math.pow(2 * (1 - x), p) / 2));

// ---------------------------------------------------------------- curve construction and editing
node({
  id: 'cadence.curve.fromPoints', label: 'Curve From Values', category: C, subcategory: 'Construct',
  aliases: ['make curve', 'build curve', 'linear curve', 'from list'],
  summary: 'Builds a curve by spacing a list of values evenly from 0 to 1.',
  commonUses: ['turning a handful of numbers into a shape without opening a curve editor'],
  exportSupport: 'baked',
  inputs: [
    { key: 'values', label: 'Values', type: 'float', multi: true },
    mode('easing', 'Between values', ['Linear', 'Sine', 'Quad', 'Cubic', 'Constant'], 'Linear'),
  ],
  outputs: [{ key: 'out', label: 'Curve', type: 'curve' }],
  evaluate: (api, i) => {
    const vals = Array.isArray(i.values) ? i.values : [];
    if (!vals.length) return { kind: 'float', keys: [] };
    if (vals.length === 1) return { kind: 'float', keys: [{ t: 0, v: vals[0] }] };
    return {
      kind: 'float',
      keys: vals.map((v, k) => ({ t: k / (vals.length - 1), v, es: i.easing, ed: 'InOut' })),
    };
  },
});

node({
  id: 'cadence.curve.reverse', label: 'Reverse Curve', category: C, subcategory: 'Edit',
  aliases: ['flip curve', 'backwards', 'mirror curve'],
  summary: 'Flips a curve left to right, so it runs backwards.',
  exportSupport: 'baked',
  inputs: [curveIn()],
  outputs: [{ key: 'out', label: 'Curve', type: 'curve' }],
  evaluate: (api, i) => {
    const keys = sortedKeys(i.curve);
    if (!keys.length) return { kind: 'float', keys: [] };
    const first = keys[0].t, last = keys[keys.length - 1].t;
    return {
      kind: i.curve?.kind || 'float',
      keys: keys.map((k) => ({ ...k, t: first + (last - k.t) })).sort((a, b) => a.t - b.t),
    };
  },
});

node({
  id: 'cadence.curve.normalize', label: 'Normalize Curve', category: C, subcategory: 'Edit',
  aliases: ['fit curve', 'rescale curve', 'to 0 1'],
  summary: 'Rescales a curve so its lowest value becomes 0 and its highest becomes 1.',
  exportSupport: 'baked',
  inputs: [curveIn()],
  outputs: [{ key: 'out', label: 'Curve', type: 'curve' }],
  evaluate: (api, i) => {
    const keys = sortedKeys(i.curve).filter((k) => typeof k.v === 'number');
    if (!keys.length) return { kind: 'float', keys: [] };
    const lo = Math.min(...keys.map((k) => k.v)), hi = Math.max(...keys.map((k) => k.v));
    const span = hi - lo;
    return {
      kind: 'float',
      keys: keys.map((k) => ({ ...k, v: span === 0 ? 0 : (k.v - lo) / span })),
    };
  },
});

// Curve combination works by resampling both curves onto a shared set of key positions — the union
// of their own key times. That preserves every feature of both inputs, rather than picking a fixed
// sample count that could miss a narrow spike.
function combineCurves(id, label, aliases, summary, fn) {
  node({
    id, label, category: C, subcategory: 'Combine', aliases, summary,
    exportSupport: 'baked',
    inputs: [curveIn('a', 'Curve A'), curveIn('b', 'Curve B')],
    outputs: [{ key: 'out', label: 'Curve', type: 'curve' }],
    evaluate: (api, i) => {
      const ka = sortedKeys(i.a), kb = sortedKeys(i.b);
      if (!ka.length) return i.b;
      if (!kb.length) return i.a;
      const times = [...new Set([...ka.map((k) => k.t), ...kb.map((k) => k.t)])].sort((x, y) => x - y);
      const at = (keys, x) => {
        const v = evalCurve(keys, x, keys[0].v);
        return typeof v === 'number' ? v : 0;
      };
      return { kind: 'float', keys: times.map((x) => ({ t: x, v: fn(at(ka, x), at(kb, x)) })) };
    },
  });
}
combineCurves('cadence.curve.add', 'Add Curves', ['sum curves', 'layer curves'], 'Adds two curves together at every point.', (a, b) => a + b);
combineCurves('cadence.curve.multiply', 'Multiply Curves', ['mask curve', 'envelope', 'window'], 'Multiplies two curves together at every point.', (a, b) => a * b);
combineCurves('cadence.curve.maximum', 'Maximum Of Curves', ['max curves', 'either'], 'Takes whichever curve is higher at every point.', Math.max);
combineCurves('cadence.curve.minimum', 'Minimum Of Curves', ['min curves', 'clip curve'], 'Takes whichever curve is lower at every point.', Math.min);

node({
  id: 'cadence.curve.blend', label: 'Blend Curves', category: C, subcategory: 'Combine',
  aliases: ['mix curves', 'morph curve', 'interpolate curves'],
  summary: 'Blends smoothly from one curve\'s shape to another\'s.',
  exportSupport: 'baked',
  inputs: [curveIn('a', 'Curve A'), curveIn('b', 'Curve B'), n('factor', 'Factor', 0.5, { min: 0, max: 1 })],
  outputs: [{ key: 'out', label: 'Curve', type: 'curve' }],
  evaluate: (api, i) => {
    const ka = sortedKeys(i.a), kb = sortedKeys(i.b);
    if (!ka.length) return i.b;
    if (!kb.length) return i.a;
    const f = Math.min(Math.max(i.factor, 0), 1);
    const times = [...new Set([...ka.map((k) => k.t), ...kb.map((k) => k.t)])].sort((x, y) => x - y);
    const at = (keys, x) => {
      const v = evalCurve(keys, x, keys[0].v);
      return typeof v === 'number' ? v : 0;
    };
    return { kind: 'float', keys: times.map((x) => ({ t: x, v: at(ka, x) + (at(kb, x) - at(ka, x)) * f })) };
  },
});
