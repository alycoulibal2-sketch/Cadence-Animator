// Math node family (spec Part 6) and the numeric constants.
//
// Every operation here is declared once and works on float, int, vector2, vector3, vector4 and
// colour — and, through the evaluator's automatic field lifting, on fields of all of those. That
// is why this file registers roughly fifty nodes in a few hundred lines instead of a few thousand.
//
// Component-wise is the semantics throughout, matching shader languages: sin(vector3) takes the
// sine of each component, add(color, color) adds all four channels including alpha. Where an
// operation is genuinely scalar-only (atan2, degrees/radians conversion) it says so in its type.

import { registerNode } from '../registry.js';
import * as V from '../values.js';
import { pointwise1, pointwise2, pointwise3, node, constant, t, n, out, mode, safeDiv, emod } from './_helpers.js';

const M = 'Math';

// ---------------------------------------------------------------- arithmetic
pointwise2({
  id: 'cadence.math.add', label: 'Add', category: M, subcategory: 'Arithmetic',
  aliases: ['plus', 'sum', '+', 'combine', 'offset'],
  summary: 'Adds two values together.',
  teach: 'Puts two numbers together. Works on colours and directions too — it adds each part separately.',
  fn: (a, b) => a + b,
});
pointwise2({
  id: 'cadence.math.subtract', label: 'Subtract', category: M, subcategory: 'Arithmetic',
  aliases: ['minus', 'difference', '-', 'take away'],
  summary: 'Subtracts the second value from the first.',
  fn: (a, b) => a - b,
});
pointwise2({
  id: 'cadence.math.multiply', label: 'Multiply', category: M, subcategory: 'Arithmetic',
  aliases: ['times', 'product', '*', 'scale', 'strength', 'amount'],
  summary: 'Multiplies two values together.',
  teach: 'Scales one value by another. Multiplying by 2 doubles it; by 0.5 halves it; by 0 removes it.',
  bDefault: 1,
  fn: (a, b) => a * b,
});
pointwise2({
  id: 'cadence.math.divide', label: 'Divide', category: M, subcategory: 'Arithmetic',
  aliases: ['/', 'quotient', 'ratio', 'per'],
  summary: 'Divides the first value by the second. Dividing by zero gives zero.',
  explain: 'Dividing by zero yields zero rather than infinity. Every value crossing a socket in this engine is guaranteed finite, because a single non-finite number reaching a particle position blanks an entire effect with no visible cause.',
  bDefault: 1,
  fn: safeDiv,
});
pointwise3({
  id: 'cadence.math.multiplyAdd', label: 'Multiply Add', category: M, subcategory: 'Arithmetic',
  aliases: ['mad', 'fma', 'scale and offset', 'a*b+c'],
  summary: 'Multiplies the first two values and adds the third.',
  teach: 'A shortcut for "scale it, then shift it" — the most common pair of adjustments, in one node.',
  aLabel: 'Value', bLabel: 'Multiplier', cLabel: 'Add', bExtra: { default: 1 },
  fn: (a, b, c) => a * b + c,
});

// ---------------------------------------------------------------- powers, roots, logs
pointwise2({
  id: 'cadence.math.power', label: 'Power', category: M, subcategory: 'Exponential',
  aliases: ['pow', '^', 'exponent', 'raise', 'gamma', 'contrast'],
  summary: 'Raises the first value to the power of the second.',
  explain: 'A negative base with a fractional exponent has no real result and yields 0. Powers are the usual way to bend a 0-1 ramp: above 1 pushes it toward the end, below 1 toward the start.',
  aLabel: 'Base', bLabel: 'Exponent', bDefault: 2,
  fn: (a, b) => {
    const r = Math.pow(a, b);
    return Number.isFinite(r) ? r : 0;
  },
});
pointwise1({
  id: 'cadence.math.exponent', label: 'Exponent', category: M, subcategory: 'Exponential',
  aliases: ['exp', 'e^x'],
  summary: 'Raises e to the power of the value.',
  fn: (a) => {
    const r = Math.exp(a);
    return Number.isFinite(r) ? r : Number.MAX_VALUE;
  },
});
pointwise2({
  id: 'cadence.math.logarithm', label: 'Logarithm', category: M, subcategory: 'Exponential',
  aliases: ['log', 'ln'],
  summary: 'The logarithm of the value in the given base. Zero and negative values give zero.',
  aLabel: 'Value', bLabel: 'Base', bDefault: Math.E, aExtra: { default: 1 },
  fn: (a, b) => {
    if (a <= 0 || b <= 0 || b === 1) return 0;
    return Math.log(a) / Math.log(b);
  },
});
pointwise1({
  id: 'cadence.math.squareRoot', label: 'Square Root', category: M, subcategory: 'Exponential',
  aliases: ['sqrt', 'root'],
  summary: 'The square root of the value. Negative values give zero.',
  fn: (a) => (a <= 0 ? 0 : Math.sqrt(a)),
});
pointwise1({
  id: 'cadence.math.inverseSquareRoot', label: 'Inverse Square Root', category: M, subcategory: 'Exponential',
  aliases: ['rsqrt', 'inversesqrt', 'falloff'],
  summary: 'One divided by the square root of the value — the classic distance falloff curve.',
  commonUses: ['light and force falloff over distance'],
  fn: (a) => (a <= 0 ? 0 : 1 / Math.sqrt(a)),
});

// ---------------------------------------------------------------- sign and magnitude
pointwise1({
  id: 'cadence.math.absolute', label: 'Absolute', category: M, subcategory: 'Sign',
  aliases: ['abs', 'magnitude', 'positive'],
  summary: 'Removes the minus sign, making every value positive.',
  fn: Math.abs,
});
pointwise1({
  id: 'cadence.math.sign', label: 'Sign', category: M, subcategory: 'Sign',
  aliases: ['direction', 'positive or negative'],
  summary: 'Gives 1 for positive values, -1 for negative, and 0 for zero.',
  fn: Math.sign,
});
pointwise1({
  id: 'cadence.math.negate', label: 'Negate', category: M, subcategory: 'Sign',
  aliases: ['invert', 'flip', 'opposite', 'minus'],
  summary: 'Flips the sign of the value.',
  fn: (a) => -a,
});

// ---------------------------------------------------------------- ranges
pointwise2({
  id: 'cadence.math.minimum', label: 'Minimum', category: M, subcategory: 'Range',
  aliases: ['min', 'smaller', 'lower', 'darken'],
  summary: 'Whichever of the two values is smaller.',
  fn: Math.min,
});
pointwise2({
  id: 'cadence.math.maximum', label: 'Maximum', category: M, subcategory: 'Range',
  aliases: ['max', 'larger', 'upper', 'lighten'],
  summary: 'Whichever of the two values is larger.',
  fn: Math.max,
});
pointwise3({
  id: 'cadence.math.clamp', label: 'Clamp', category: M, subcategory: 'Range',
  aliases: ['limit', 'constrain', 'bound', 'range'],
  summary: 'Keeps the value between a low and a high limit.',
  teach: 'Stops a number escaping. Anything below the low limit becomes the low limit; anything above the high limit becomes the high limit.',
  aLabel: 'Value', bLabel: 'Low', cLabel: 'High', cExtra: { default: 1 },
  fn: (v, lo, hi) => (lo <= hi ? Math.min(Math.max(v, lo), hi) : Math.min(Math.max(v, hi), lo)),
});
pointwise1({
  id: 'cadence.math.saturate', label: 'Saturate', category: M, subcategory: 'Range',
  aliases: ['clamp01', 'clamp 0 1', 'normalize range'],
  summary: 'Clamps the value between 0 and 1.',
  fn: (a) => Math.min(Math.max(a, 0), 1),
});

// ---------------------------------------------------------------- wrapping and rounding
pointwise2({
  id: 'cadence.math.modulo', label: 'Modulo', category: M, subcategory: 'Rounding',
  aliases: ['mod', 'remainder', '%', 'repeat', 'tile', 'cycle'],
  summary: 'The remainder after dividing — the standard way to make something repeat.',
  explain: 'Uses the Euclidean convention: the result takes the sign of the divisor, so mod(-1, 3) is 2. That is what keeps a repeating pattern seamless across zero; a C-style remainder produces a visible mirror seam at the origin.',
  bDefault: 1,
  fn: emod,
});
pointwise1({
  id: 'cadence.math.fraction', label: 'Fraction', category: M, subcategory: 'Rounding',
  aliases: ['frac', 'fract', 'decimal part', 'repeat', 'saw'],
  summary: 'Just the part after the decimal point — a 0-to-1 ramp that repeats every whole number.',
  fn: (a) => a - Math.floor(a),
});
pointwise3({
  id: 'cadence.math.wrap', label: 'Wrap', category: M, subcategory: 'Rounding',
  aliases: ['loop', 'cycle', 'repeat between'],
  summary: 'Wraps the value around so it always lands between a low and a high limit.',
  aLabel: 'Value', bLabel: 'Low', cLabel: 'High', cExtra: { default: 1 },
  fn: (v, lo, hi) => {
    const span = hi - lo;
    return span === 0 ? lo : lo + emod(v - lo, span);
  },
});
pointwise2({
  id: 'cadence.math.pingPong', label: 'Ping Pong', category: M, subcategory: 'Rounding',
  aliases: ['bounce', 'back and forth', 'triangle', 'yoyo'],
  summary: 'Bounces the value back and forth between 0 and the given size.',
  commonUses: ['a pulse that breathes in and out instead of snapping back'],
  aLabel: 'Value', bLabel: 'Size', bDefault: 1,
  fn: (v, size) => {
    if (size === 0) return 0;
    const s = Math.abs(size);
    const m = emod(v, s * 2);
    return m <= s ? m : s * 2 - m;
  },
});
pointwise1({
  id: 'cadence.math.floor', label: 'Floor', category: M, subcategory: 'Rounding',
  aliases: ['round down', 'integer part'],
  summary: 'Rounds down to the nearest whole number.',
  fn: Math.floor,
});
pointwise1({
  id: 'cadence.math.ceil', label: 'Ceil', category: M, subcategory: 'Rounding',
  aliases: ['round up', 'ceiling'],
  summary: 'Rounds up to the nearest whole number.',
  fn: Math.ceil,
});
pointwise1({
  id: 'cadence.math.round', label: 'Round', category: M, subcategory: 'Rounding',
  aliases: ['nearest'],
  summary: 'Rounds to the nearest whole number.',
  fn: Math.round,
});
pointwise1({
  id: 'cadence.math.truncate', label: 'Truncate', category: M, subcategory: 'Rounding',
  aliases: ['trunc', 'toward zero', 'drop decimals'],
  summary: 'Removes the decimal part, rounding toward zero.',
  fn: Math.trunc,
});
pointwise2({
  id: 'cadence.math.snap', label: 'Snap', category: M, subcategory: 'Rounding',
  aliases: ['quantize', 'step to', 'grid', 'posterize'],
  summary: 'Rounds the value to the nearest multiple of a step size.',
  commonUses: ['stepped, chunky motion instead of smooth motion', 'banded colour'],
  aLabel: 'Value', bLabel: 'Step', bDefault: 0.1,
  fn: (v, step) => (step === 0 ? v : Math.round(v / step) * step),
});

// ---------------------------------------------------------------- interpolation
pointwise3({
  id: 'cadence.math.lerp', label: 'Lerp', category: M, subcategory: 'Interpolation',
  aliases: ['mix', 'blend', 'between', 'interpolate', 'fade', 'crossfade'],
  summary: 'Blends between two values. A factor of 0 gives the first, 1 gives the second.',
  teach: 'Slides smoothly from one value to another. Think of the factor as "how far along" — 0 is the start, 1 is the end, 0.5 is halfway.',
  aLabel: 'From', bLabel: 'To', cLabel: 'Factor', bExtra: { default: 1 }, cExtra: { min: 0, max: 1 },
  fn: (a, b, f) => a + (b - a) * f,
});
pointwise3({
  id: 'cadence.math.inverseLerp', label: 'Inverse Lerp', category: M, subcategory: 'Interpolation',
  aliases: ['unlerp', 'progress', 'how far along', 'normalize'],
  summary: 'The opposite of Lerp: given a value and a range, says how far along the range it sits, as 0 to 1.',
  commonUses: ['turning a distance into a 0-1 falloff you can feed a ramp'],
  aLabel: 'From', bLabel: 'To', cLabel: 'Value', bExtra: { default: 1 },
  fn: (a, b, v) => (b - a === 0 ? 0 : (v - a) / (b - a)),
});
pointwise2({
  id: 'cadence.math.step', label: 'Step', category: M, subcategory: 'Interpolation',
  aliases: ['threshold', 'cutoff', 'hard edge', 'binary'],
  summary: 'Gives 0 below the edge and 1 at or above it — a hard on/off switch.',
  aLabel: 'Value', bLabel: 'Edge', bDefault: 0.5,
  fn: (v, edge) => (v >= edge ? 1 : 0),
});
pointwise3({
  id: 'cadence.math.smoothstep', label: 'Smoothstep', category: M, subcategory: 'Interpolation',
  aliases: ['soft edge', 'soft threshold', 'ease', 'feather', 'falloff', 'fade'],
  summary: 'A soft 0-to-1 ramp between two edges, easing in and out at both ends.',
  teach: 'Like Step, but the change is gradual instead of sudden. This is the node behind almost every soft edge, glow falloff and gentle fade.',
  explain: 'The classic 3x²-2x³ curve: value and first derivative are continuous, so an edge built with it has no visible crease. Smootherstep matches the second derivative too, which matters when the result drives motion rather than colour.',
  aLabel: 'Edge 1', bLabel: 'Edge 2', cLabel: 'Value', bExtra: { default: 1 },
  fn: (e1, e2, v) => {
    if (e1 === e2) return v >= e2 ? 1 : 0;
    const x = Math.min(Math.max((v - e1) / (e2 - e1), 0), 1);
    return x * x * (3 - 2 * x);
  },
});
pointwise3({
  id: 'cadence.math.smootherstep', label: 'Smootherstep', category: M, subcategory: 'Interpolation',
  aliases: ['smoother', 'quintic ease', 'very soft edge'],
  summary: 'Like Smoothstep but even gentler at both ends.',
  explain: 'Perlin\'s quintic 6x⁵-15x⁴+10x³. Its second derivative is also zero at the ends, so when it drives motion there is no acceleration jolt at the start or finish.',
  aLabel: 'Edge 1', bLabel: 'Edge 2', cLabel: 'Value', bExtra: { default: 1 },
  fn: (e1, e2, v) => {
    if (e1 === e2) return v >= e2 ? 1 : 0;
    const x = Math.min(Math.max((v - e1) / (e2 - e1), 0), 1);
    return x * x * x * (x * (x * 6 - 15) + 10);
  },
});

// Map Range gets its own definition rather than a pointwise helper: five inputs plus a clamp mode
// is past the point where a generic helper stays readable.
registerNode({
  id: 'cadence.math.mapRange', version: 1, label: 'Map Range', category: M, subcategory: 'Interpolation',
  aliases: ['remap', 'rescale', 'convert range', 'fit', 'normalize', 'fade'],
  summary: 'Rescales a value from one range into another.',
  teach: 'Says "this number goes from 0 to 100, but I want it to go from 0 to 1 instead" — and does the conversion.',
  commonUses: ['turning a distance into an opacity', 'turning a 0-1 ramp into a real-world size'],
  exportSupport: 'baked',
  generics: { T: { kinds: V.NUMERIC_KINDS } },
  inputs: [
    t('value', 'Value'),
    t('fromMin', 'From low', { default: 0 }),
    t('fromMax', 'From high', { default: 1 }),
    t('toMin', 'To low', { default: 0 }),
    t('toMax', 'To high', { default: 1 }),
    { key: 'clamp', label: 'Keep inside the new range', type: 'bool', default: true, socket: false },
  ],
  outputs: [out('out', 'Result')],
  evaluate: (api, i) => {
    const tn = api.typeName('T');
    const v = V.toComponents(tn, i.value);
    const fl = V.toComponents(tn, i.fromMin), fh = V.toComponents(tn, i.fromMax);
    const tl = V.toComponents(tn, i.toMin), th = V.toComponents(tn, i.toMax);
    const outc = v.map((x, k) => {
      const span = fh[k] - fl[k];
      let f = span === 0 ? 0 : (x - fl[k]) / span;
      if (i.clamp) f = Math.min(Math.max(f, 0), 1);
      return tl[k] + (th[k] - tl[k]) * f;
    });
    return V.fromComponents(tn, outc);
  },
});

// ---------------------------------------------------------------- comparison
// Comparisons take generic values and produce a single yes/no. On a multi-component value every
// component must satisfy the comparison — stated plainly on each node, since "is this vector
// greater than that one" has no single obvious meaning and a silent choice would be a trap.
function comparison(id, label, aliases, summary, fn) {
  registerNode({
    id, version: 1, label, category: M, subcategory: 'Comparison',
    aliases, summary,
    explain: 'On vectors and colours, every component must satisfy the comparison for the result to be yes.',
    exportSupport: 'baked',
    generics: { T: { kinds: V.NUMERIC_KINDS } },
    inputs: [t('a', 'A'), t('b', 'B')],
    outputs: [{ key: 'out', label: 'Yes/No', type: 'bool' }],
    evaluate: (api, i) => {
      const tn = api.typeName('T');
      const ca = V.toComponents(tn, i.a), cb = V.toComponents(tn, i.b);
      return ca.every((x, k) => fn(x, cb[k]));
    },
  });
}
comparison('cadence.math.greaterThan', 'Greater Than', ['>', 'above', 'more than', 'over'], 'Is the first value bigger than the second?', (a, b) => a > b);
comparison('cadence.math.lessThan', 'Less Than', ['<', 'below', 'under', 'smaller than'], 'Is the first value smaller than the second?', (a, b) => a < b);
comparison('cadence.math.greaterOrEqual', 'Greater or Equal', ['>=', 'at least'], 'Is the first value bigger than or the same as the second?', (a, b) => a >= b);
comparison('cadence.math.lessOrEqual', 'Less or Equal', ['<=', 'at most'], 'Is the first value smaller than or the same as the second?', (a, b) => a <= b);

registerNode({
  id: 'cadence.math.equal', version: 1, label: 'Equal', category: M, subcategory: 'Comparison',
  aliases: ['==', 'same', 'matches', 'is'],
  summary: 'Are the two values the same, within a small tolerance?',
  explain: 'The tolerance exists because exact equality between computed decimals is almost never true — 0.1+0.2 is not 0.3 in any engine. Comparing without a tolerance is one of the most common sources of a condition that "never fires".',
  exportSupport: 'baked',
  generics: { T: { kinds: V.NUMERIC_KINDS } },
  inputs: [t('a', 'A'), t('b', 'B'), n('tolerance', 'Tolerance', 1e-6, { min: 0 })],
  outputs: [{ key: 'out', label: 'Yes/No', type: 'bool' }],
  evaluate: (api, i) => {
    const tn = api.typeName('T');
    const ca = V.toComponents(tn, i.a), cb = V.toComponents(tn, i.b);
    return ca.every((x, k) => Math.abs(x - cb[k]) <= i.tolerance);
  },
});
registerNode({
  id: 'cadence.math.notEqual', version: 1, label: 'Not Equal', category: M, subcategory: 'Comparison',
  aliases: ['!=', 'different', 'differs'],
  summary: 'Are the two values different, beyond a small tolerance?',
  exportSupport: 'baked',
  generics: { T: { kinds: V.NUMERIC_KINDS } },
  inputs: [t('a', 'A'), t('b', 'B'), n('tolerance', 'Tolerance', 1e-6, { min: 0 })],
  outputs: [{ key: 'out', label: 'Yes/No', type: 'bool' }],
  evaluate: (api, i) => {
    const tn = api.typeName('T');
    const ca = V.toComponents(tn, i.a), cb = V.toComponents(tn, i.b);
    return ca.some((x, k) => Math.abs(x - cb[k]) > i.tolerance);
  },
});

// ---------------------------------------------------------------- trigonometry
// Angles are RADIANS throughout, matching every trigonometric function in every engine. The two
// conversion nodes below exist so a human can work in degrees where degrees are natural, and the
// unit is stated on every socket (Part 64).
const trig = (id, label, aliases, summary, fn, extra = {}) => pointwise1({
  id, label, category: M, subcategory: 'Trigonometry', aliases, summary,
  inputExtra: { unit: extra.inputUnit || 'radians' },
  fn,
  ...extra,
});
trig('cadence.math.sine', 'Sine', ['sin', 'wave', 'oscillate', 'wobble', 'pulse'], 'The sine of an angle in radians — a smooth wave between -1 and 1.', Math.sin);
trig('cadence.math.cosine', 'Cosine', ['cos', 'wave'], 'The cosine of an angle in radians — the same wave as sine, shifted a quarter turn.', Math.cos);
trig('cadence.math.tangent', 'Tangent', ['tan'], 'The tangent of an angle in radians. Values near a quarter turn grow without limit and are clamped.', (a) => {
  const r = Math.tan(a);
  return Number.isFinite(r) ? Math.min(Math.max(r, -1e6), 1e6) : 0;
});
trig('cadence.math.arcSine', 'Arc Sine', ['asin', 'inverse sine'], 'The angle whose sine is this value. Inputs outside -1 to 1 are clamped.', (a) => Math.asin(Math.min(Math.max(a, -1), 1)), { inputUnit: null });
trig('cadence.math.arcCosine', 'Arc Cosine', ['acos', 'inverse cosine', 'angle between'], 'The angle whose cosine is this value. Inputs outside -1 to 1 are clamped.', (a) => Math.acos(Math.min(Math.max(a, -1), 1)), { inputUnit: null });
trig('cadence.math.arcTangent', 'Arc Tangent', ['atan', 'inverse tangent'], 'The angle whose tangent is this value.', Math.atan, { inputUnit: null });
trig('cadence.math.sinh', 'Hyperbolic Sine', ['sinh'], 'The hyperbolic sine of the value.', (a) => {
  const r = Math.sinh(a);
  return Number.isFinite(r) ? r : Math.sign(a) * Number.MAX_VALUE;
}, { inputUnit: null });
trig('cadence.math.cosh', 'Hyperbolic Cosine', ['cosh'], 'The hyperbolic cosine of the value.', (a) => {
  const r = Math.cosh(a);
  return Number.isFinite(r) ? Number.MAX_VALUE : r;
}, { inputUnit: null });
trig('cadence.math.tanh', 'Hyperbolic Tangent', ['tanh', 'soft clamp', 'squash'], 'The hyperbolic tangent — squashes any value smoothly into the range -1 to 1.', Math.tanh, { inputUnit: null });

pointwise2({
  id: 'cadence.math.arcTan2', label: 'ArcTan2', category: M, subcategory: 'Trigonometry',
  aliases: ['atan2', 'angle of', 'direction to angle', 'heading', 'angular'],
  summary: 'The angle of the direction (X, Y), covering a full turn rather than only half.',
  commonUses: ['turning a direction into an angle for an angular gradient or a spiral'],
  explain: 'Unlike Arc Tangent, this knows which quadrant the direction is in, so it returns the full -PI..PI range. It is the correct tool for "which way is this pointing".',
  aLabel: 'Y', bLabel: 'X', bDefault: 1,
  fn: (y, x) => Math.atan2(y, x),
});
pointwise1({
  id: 'cadence.math.degreesToRadians', label: 'Degrees to Radians', category: M, subcategory: 'Trigonometry',
  aliases: ['radians', 'deg2rad', 'convert angle'],
  summary: 'Converts an angle from degrees into radians.',
  inputExtra: { unit: 'degrees' }, outputLabel: 'Radians',
  fn: (a) => (a * Math.PI) / 180,
});
pointwise1({
  id: 'cadence.math.radiansToDegrees', label: 'Radians to Degrees', category: M, subcategory: 'Trigonometry',
  aliases: ['degrees', 'rad2deg', 'convert angle'],
  summary: 'Converts an angle from radians into degrees.',
  inputExtra: { unit: 'radians' }, outputLabel: 'Degrees',
  fn: (a) => (a * 180) / Math.PI,
});

// ---------------------------------------------------------------- constants
constant({ id: 'cadence.math.pi', label: 'Pi', value: Math.PI, aliases: ['3.14', 'half turn'], summary: 'Half a turn in radians (3.14159…).' });
constant({ id: 'cadence.math.tau', label: 'Tau', value: Math.PI * 2, aliases: ['2pi', 'full turn', 'circle'], summary: 'A full turn in radians (6.28318…) — the natural period of a sine wave.' });
constant({ id: 'cadence.math.e', label: 'E', value: Math.E, aliases: ['euler', 'natural'], summary: "Euler's number (2.71828…), the base of the natural logarithm." });
constant({ id: 'cadence.math.epsilon', label: 'Epsilon', value: 1e-6, aliases: ['tiny', 'tolerance', 'nearly zero'], summary: 'A very small number, for comparisons that should not demand exactness.' });
constant({
  id: 'cadence.math.largestNumber', label: 'Largest Number', value: Number.MAX_VALUE,
  aliases: ['infinity', 'huge', 'max', 'unbounded'],
  summary: 'The largest finite number this engine can carry.',
  explain: 'There is deliberately no Infinity constant. Every value crossing a socket here is guaranteed finite, because a single infinite or NaN value reaching a particle position blanks the whole effect invisibly. Where the specification calls for infinity — an unbounded limit, an initial value for a running minimum — this is the value that behaves correctly and stays diagnosable.',
});

// ---------------------------------------------------------------- reductions over lists
// A multi-input socket makes "add up however many things are plugged in" one node rather than a
// chain of two-input Adds. The type is generic, so it sums numbers, vectors and colours alike.
function reduction(id, label, aliases, summary, reduce, initial) {
  node({
    id, label, category: M, subcategory: 'Lists', aliases, summary,
    exportSupport: 'baked',
    generics: { T: { kinds: V.NUMERIC_KINDS } },
    inputs: [{ key: 'values', label: 'Values', type: 'T', multi: true }],
    outputs: [out('out', 'Result')],
    evaluate: (api, i) => {
      const tn = api.typeName('T');
      const list = Array.isArray(i.values) ? i.values : [];
      if (!list.length) return V.fromComponents(tn, [initial]);
      return list.reduce((acc, v) => V.zipValue(tn, acc, v, reduce));
    },
  });
}
reduction('cadence.math.sum', 'Sum', ['add all', 'total', 'accumulate'], 'Adds together every value plugged in.', (a, b) => a + b, 0);
reduction('cadence.math.product', 'Product', ['multiply all'], 'Multiplies together every value plugged in.', (a, b) => a * b, 1);
reduction('cadence.math.minimumOf', 'Minimum Of', ['min all', 'smallest'], 'The smallest of every value plugged in.', Math.min, 0);
reduction('cadence.math.maximumOf', 'Maximum Of', ['max all', 'largest'], 'The largest of every value plugged in.', Math.max, 0);

node({
  id: 'cadence.math.average', label: 'Average', category: M, subcategory: 'Lists',
  aliases: ['mean', 'blend all', 'mix all'],
  summary: 'The average of every value plugged in.',
  exportSupport: 'baked',
  generics: { T: { kinds: V.NUMERIC_KINDS } },
  inputs: [{ key: 'values', label: 'Values', type: 'T', multi: true }],
  outputs: [out('out', 'Result')],
  evaluate: (api, i) => {
    const tn = api.typeName('T');
    const list = Array.isArray(i.values) ? i.values : [];
    if (!list.length) return V.fromComponents(tn, [0]);
    const total = list.reduce((acc, v) => V.zipValue(tn, acc, v, (a, b) => a + b));
    return V.mapValue(tn, total, (c) => c / list.length);
  },
});
