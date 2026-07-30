// Time node family (spec Part 11).
//
// Every node here declares `timeDependent: true`, which is what lets the evaluator invalidate ONLY
// the animated part of a graph when the playhead moves. A large static material chain therefore
// survives scrubbing untouched. Time is not exposed to nodes that do not declare it, so nothing can
// read the clock behind the cache's back.
//
// Part 11's closing instruction is the important one: "everything that can reasonably vary over
// time should accept fields/curves rather than requiring dedicated 'over lifetime' versions of
// every node." That is why there is no Size Over Life or Colour Over Life node anywhere in this
// engine — you take Normalized Age, put it through a curve or gradient, and connect it to size or
// colour. One mechanism, every property.

import * as V from '../values.js';
import * as F from '../fields.js';
import { node, n, out, mode } from './_helpers.js';

const C = 'Time';

// ---------------------------------------------------------------- clocks
node({
  id: 'cadence.time.effectTime', label: 'Effect Time', category: C, subcategory: 'Clocks',
  aliases: ['time', 'clock', 'seconds', 'now', 'playhead', 'frame'],
  summary: 'How long the effect has been running.',
  teach: 'A stopwatch that starts when the effect starts.',
  timeDependent: true,
  exportSupport: 'native',
  exportNote: 'Becomes elapsed wall-clock time in the exported script, driven by Heartbeat.',
  inputs: [],
  outputs: [
    { key: 'seconds', label: 'Seconds', type: 'float', unit: 'seconds' },
    { key: 'frame', label: 'Frame', type: 'float', unit: 'frames' },
    { key: 'normalized', label: 'Progress (0-1)', type: 'float' },
  ],
  evaluate: (api) => ({
    seconds: api.time,
    frame: api.frame,
    normalized: api.duration > 0 ? Math.min(Math.max(api.frame / api.duration, 0), 1) : 0,
  }),
});

node({
  id: 'cadence.time.deltaTime', label: 'Delta Time', category: C, subcategory: 'Clocks',
  aliases: ['frame time', 'step', 'dt', 'per second'],
  summary: 'How much time one frame takes.',
  explain: 'At the effect\'s own frame rate this is a fixed 1/fps, because the whole engine evaluates at fixed frame positions so that scrubbing is repeatable. It is what you multiply a per-second rate by to get a per-frame amount.',
  timeDependent: true,
  exportSupport: 'converted',
  exportNote: 'Becomes the real variable frame delta in-game, which will differ from the editor\'s fixed step.',
  inputs: [],
  outputs: [{ key: 'out', label: 'Seconds', type: 'float', unit: 'seconds' }],
  evaluate: (api) => (api.fps > 0 ? 1 / api.fps : 0),
});

node({
  id: 'cadence.time.duration', label: 'Duration', category: C, subcategory: 'Clocks',
  aliases: ['length', 'total time', 'how long'],
  summary: 'How long the whole effect lasts.',
  timeDependent: true,
  exportSupport: 'native',
  inputs: [],
  outputs: [
    { key: 'seconds', label: 'Seconds', type: 'float', unit: 'seconds' },
    { key: 'frames', label: 'Frames', type: 'float', unit: 'frames' },
  ],
  evaluate: (api) => ({ seconds: api.fps > 0 ? api.duration / api.fps : 0, frames: api.duration }),
});

// ---------------------------------------------------------------- reshaping time
node({
  id: 'cadence.time.scale', label: 'Time Scale', category: C, subcategory: 'Reshape',
  aliases: ['speed up', 'slow down', 'time multiplier', 'tempo', 'rate'],
  summary: 'Speeds up or slows down a time value.',
  timeDependent: true,
  exportSupport: 'baked',
  inputs: [n('time', 'Time', 0, { unit: 'seconds', defaultFrom: 'time' }), n('scale', 'Scale', 1)],
  outputs: [{ key: 'out', label: 'Time', type: 'float', unit: 'seconds' }],
  evaluate: (api, i) => i.time * i.scale,
});

node({
  id: 'cadence.time.offset', label: 'Time Offset', category: C, subcategory: 'Reshape',
  aliases: ['delay', 'shift time', 'head start', 'stagger'],
  summary: 'Shifts a time value earlier or later.',
  commonUses: ['staggering several copies of one effect so they do not move in lockstep'],
  timeDependent: true,
  exportSupport: 'baked',
  inputs: [n('time', 'Time', 0, { unit: 'seconds', defaultFrom: 'time' }), n('offset', 'Offset', 0, { unit: 'seconds' })],
  outputs: [{ key: 'out', label: 'Time', type: 'float', unit: 'seconds' }],
  evaluate: (api, i) => i.time + i.offset,
});

node({
  id: 'cadence.time.delay', label: 'Delay', category: C, subcategory: 'Reshape',
  aliases: ['wait', 'hold at zero', 'start later'],
  summary: 'Holds at zero until a start time, then runs from zero.',
  explain: 'Unlike Time Offset, this does not run negative before the start — it waits. That is the difference between "this began earlier" and "this has not begun yet".',
  timeDependent: true,
  exportSupport: 'baked',
  inputs: [n('time', 'Time', 0, { unit: 'seconds', defaultFrom: 'time' }), n('delay', 'Delay', 0, { min: 0, unit: 'seconds' })],
  outputs: [
    { key: 'out', label: 'Time', type: 'float', unit: 'seconds' },
    { key: 'started', label: 'Started', type: 'bool' },
  ],
  evaluate: (api, i) => ({ out: Math.max(0, i.time - i.delay), started: i.time >= i.delay }),
});

node({
  id: 'cadence.time.loop', label: 'Loop', category: C, subcategory: 'Reshape',
  aliases: ['repeat', 'cycle', 'wrap time', 'period', 'phase', 'again'],
  summary: 'Repeats a stretch of time over and over.',
  teach: 'Makes time go round in a circle: when it reaches the end of one period it starts again from the beginning.',
  timeDependent: true,
  exportSupport: 'baked',
  inputs: [n('time', 'Time', 0, { unit: 'seconds', defaultFrom: 'time' }), n('period', 'Period', 1, { min: 1e-4, unit: 'seconds' })],
  outputs: [
    { key: 'out', label: 'Time', type: 'float', unit: 'seconds' },
    { key: 'phase', label: 'Phase (0-1)', type: 'float' },
    { key: 'iteration', label: 'Repeat number', type: 'int' },
  ],
  evaluate: (api, i) => {
    const p = Math.max(1e-4, i.period);
    const wrapped = i.time - Math.floor(i.time / p) * p;
    return { out: wrapped, phase: wrapped / p, iteration: Math.floor(i.time / p) };
  },
});

node({
  id: 'cadence.time.pingPong', label: 'Ping Pong Time', category: C, subcategory: 'Reshape',
  aliases: ['back and forth', 'bounce time', 'yoyo', 'breathe', 'in and out'],
  summary: 'Runs time forwards then backwards, over and over.',
  explain: 'Period is the whole round trip, exactly as it is on Loop — it goes out over the first half and back over the second. That means swapping a wire from Loop to Ping Pong Time keeps the range of times you get out identical and changes only how they are travelled, which is almost always what you wanted.',
  commonUses: ['a pulse that breathes rather than snapping back to the start'],
  timeDependent: true,
  exportSupport: 'baked',
  inputs: [n('time', 'Time', 0, { unit: 'seconds', defaultFrom: 'time' }), n('period', 'Period', 1, { min: 1e-4, unit: 'seconds' })],
  outputs: [
    { key: 'out', label: 'Time', type: 'float', unit: 'seconds' },
    { key: 'phase', label: 'Phase (0-1)', type: 'float' },
  ],
  evaluate: (api, i) => {
    const p = Math.max(1e-4, i.period);
    const half = p / 2;
    const m = i.time - Math.floor(i.time / p) * p;   // position within this round trip
    const phase = m <= half ? m / half : 2 - m / half;
    return { out: phase * p, phase };
  },
});

node({
  id: 'cadence.time.remap', label: 'Time Remap', category: C, subcategory: 'Reshape',
  aliases: ['retime', 'time warp', 'speed ramp', 'slow motion'],
  summary: 'Rescales one stretch of time onto another, optionally holding at the ends.',
  commonUses: ['a slow-motion section inside a normal-speed effect'],
  timeDependent: true,
  exportSupport: 'baked',
  inputs: [
    n('time', 'Time', 0, { unit: 'seconds', defaultFrom: 'time' }),
    n('fromStart', 'From start', 0, { unit: 'seconds' }),
    n('fromEnd', 'From end', 1, { unit: 'seconds' }),
    n('toStart', 'To start', 0, { unit: 'seconds' }),
    n('toEnd', 'To end', 1, { unit: 'seconds' }),
    { key: 'hold', label: 'Hold outside the range', type: 'bool', default: true, socket: false },
  ],
  outputs: [{ key: 'out', label: 'Time', type: 'float', unit: 'seconds' }],
  evaluate: (api, i) => {
    const span = i.fromEnd - i.fromStart;
    let f = span === 0 ? 0 : (i.time - i.fromStart) / span;
    if (i.hold) f = Math.min(Math.max(f, 0), 1);
    return i.toStart + (i.toEnd - i.toStart) * f;
  },
});

// ---------------------------------------------------------------- oscillation
node({
  id: 'cadence.time.oscillate', label: 'Oscillate', category: C, subcategory: 'Oscillate',
  aliases: ['wave', 'wobble', 'pulse', 'sine over time', 'flicker', 'shimmer', 'vibrate'],
  summary: 'A smooth wave that rises and falls over time.',
  teach: 'Makes something go up and down forever. Frequency is how fast, amplitude is how far.',
  explain: 'Phase shifts where in the wave it starts, in turns — 0.25 turns a sine into a cosine. Offset moves the whole wave up or down, so a value that should never go negative can be built as offset 1, amplitude 1.',
  timeDependent: true,
  exportSupport: 'baked',
  inputs: [
    n('frequency', 'Frequency', 1, { min: 0, unit: 'hertz' }),
    n('amplitude', 'Amplitude', 1),
    n('phase', 'Phase', 0, { unit: 'turns' }),
    n('offset', 'Centre', 0),
    mode('shape', 'Shape', ['sine', 'triangle', 'square', 'sawtooth'], 'sine'),
  ],
  outputs: [{ key: 'out', label: 'Value', type: 'float' }],
  evaluate: (api, i) => {
    const x = api.time * i.frequency + i.phase;
    const frac = x - Math.floor(x);
    let w;
    switch (i.shape) {
      // Every shape is phase-aligned with the sine (starts at 0, peaks at a quarter turn) so
      // switching shape changes the character of the motion without also shifting its timing.
      case 'triangle': w = frac < 0.25 ? 4 * frac : (frac < 0.75 ? 2 - 4 * frac : 4 * frac - 4); break;
      case 'square': w = frac < 0.5 ? 1 : -1; break;
      case 'sawtooth': w = frac * 2 - 1; break;
      default: w = Math.sin(x * Math.PI * 2);
    }
    return i.offset + w * i.amplitude;
  },
});

node({
  id: 'cadence.time.timeNoise', label: 'Time Noise', category: C, subcategory: 'Oscillate',
  aliases: ['wobble', 'jitter over time', 'random over time', 'drift', 'flicker', 'shake', 'handheld'],
  summary: 'A smooth random wander over time — the same every playback.',
  teach: 'Wobbles randomly, but gently, and always exactly the same way each time you play it.',
  explain: 'Value noise over time rather than a random number per frame: the result is smooth, so it reads as drift or a handheld camera rather than as static. It is a pure function of time, so scrubbing backwards gives the identical value — a real random number per frame could not.',
  commonUses: ['camera shake', 'flame flicker', 'light intensity wander'],
  timeDependent: true,
  exportSupport: 'baked',
  inputs: [
    n('frequency', 'Speed', 1, { min: 0, unit: 'hertz' }),
    n('amplitude', 'Amount', 1),
    n('seed', 'Variation', 0),
    n('octaves', 'Detail', 1, { min: 1, max: 6 }),
  ],
  outputs: [{ key: 'out', label: 'Value', type: 'float' }],
  evaluate: (api, i) => {
    const noise1 = (x, seed) => {
      const idx = Math.floor(x), f = x - idx;
      const u = f * f * (3 - 2 * f);
      return V.hash01(idx, seed) * (1 - u) + V.hash01(idx + 1, seed) * u;
    };
    const oct = Math.max(1, Math.round(i.octaves));
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += (noise1(api.time * i.frequency * freq, i.seed + o * 17) * 2 - 1) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return (norm > 0 ? sum / norm : 0) * i.amplitude;
  },
});

// ---------------------------------------------------------------- per-element time
// These read the SAMPLE context rather than the graph clock: an age only exists for an element that
// has one. They are fields, which is what makes "over lifetime" a general mechanism instead of a
// per-property feature — Normalized Age into a curve into any property at all.
node({
  id: 'cadence.time.age', label: 'Age', category: C, subcategory: 'Per element',
  aliases: ['particle age', 'how old', 'elapsed', 'since birth'],
  summary: 'How long the thing being drawn has existed, in seconds.',
  exportSupport: 'native',
  inputs: [],
  outputs: [{ key: 'out', label: 'Age', type: 'field<float>', unit: 'seconds' }],
  evaluate: () => F.makeField('float', (ctx) => ctx.age || 0),
});

node({
  id: 'cadence.time.normalizedAge', label: 'Normalized Age', category: C, subcategory: 'Per element',
  aliases: ['life', 'over lifetime', 'life fraction', '0 to 1 age', 'fade', 'over life', 'progress'],
  summary: 'How far through its life the thing being drawn is, from 0 at birth to 1 at death.',
  teach: 'A number that starts at 0 when a particle is born and reaches 1 just as it disappears. Feed it into a curve or a gradient to make anything change over a particle\'s life.',
  explain: 'This is the node that replaces every "over lifetime" variant the engine could otherwise have needed. Size over life, colour over life, opacity over life, speed over life — all of them are this, through a curve, into the property.',
  commonUses: ['fading out', 'shrinking', 'colour over life'],
  exportSupport: 'native',
  exportNote: 'Maps directly onto the 0-1 parameter of a Roblox NumberSequence or ColorSequence.',
  inputs: [],
  outputs: [{ key: 'out', label: 'Life (0-1)', type: 'field<float>' }],
  evaluate: () => F.makeField('float', (ctx) => Math.min(Math.max(ctx.life || 0, 0), 1)),
});
