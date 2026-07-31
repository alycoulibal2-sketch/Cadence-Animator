// Colour node family (spec Part 9), plus gradient sampling.
//
// Colours are [r, g, b, a] with components nominally 0-1 but ALLOWED TO EXCEED 1: emission is the
// whole point of most VFX, and clamping a glow to 1 at every step is what makes a stylised effect
// look flat. Only the nodes that genuinely need a bounded result clamp, and they say so.
//
// Gradient stops use `u` (0-1) rather than `t`, matching rampEval.js — the existing ramp evaluator
// is reused rather than reimplemented, so a gradient authored in a node graph and a colour ramp on
// a legacy emitter interpolate identically, including their easing.

import { registerNode } from '../registry.js';
import * as V from '../values.js';
import { evalRamp } from '../../rampEval.js';
import { node, n, col, out, mode } from './_helpers.js';

const C = 'Color';

const rng01 = { min: 0, max: 1 };

// Accepts either `u` (the codebase convention) or `t` (what a hand-written or MCP-supplied
// gradient is likely to use) so a legible mistake degrades into the right answer rather than a
// blank result. rampEval also wants `#rrggbb` strings for colour stops, so a stop given as a
// numeric colour array is converted on the way in.
function normalizeStops(gradient, kind) {
  const stops = Array.isArray(gradient?.stops) ? gradient.stops : Array.isArray(gradient) ? gradient : [];
  return stops
    .map((s) => {
      const u = Number.isFinite(s?.u) ? s.u : (Number.isFinite(s?.t) ? s.t : null);
      if (u === null || s?.v === undefined) return null;
      const v = kind === 'color' && Array.isArray(s.v) ? V.colorToHex(s.v) : s.v;
      return { ...s, u: Math.min(Math.max(u, 0), 1), v };
    })
    .filter(Boolean)
    .sort((a, b) => a.u - b.u);
}

// ---------------------------------------------------------------- construction
node({
  id: 'cadence.color.combineRgb', label: 'Combine RGB', category: C, subcategory: 'Construct',
  aliases: ['make color', 'rgb', 'build colour', 'from channels'],
  summary: 'Builds a colour from separate red, green, blue and alpha amounts.',
  exportSupport: 'native',
  inputs: [n('r', 'Red', 1, rng01), n('g', 'Green', 1, rng01), n('b', 'Blue', 1, rng01), n('a', 'Alpha', 1, rng01)],
  outputs: [{ key: 'out', label: 'Color', type: 'color' }],
  evaluate: (api, i) => [i.r, i.g, i.b, i.a],
});

node({
  id: 'cadence.color.separateRgb', label: 'Separate RGB', category: C, subcategory: 'Construct',
  aliases: ['split color', 'channels', 'break colour', 'channel split'],
  summary: 'Splits a colour into its red, green, blue and alpha amounts.',
  exportSupport: 'baked',
  inputs: [col('color', 'Color')],
  outputs: [
    { key: 'r', label: 'Red', type: 'float' },
    { key: 'g', label: 'Green', type: 'float' },
    { key: 'b', label: 'Blue', type: 'float' },
    { key: 'a', label: 'Alpha', type: 'float' },
  ],
  evaluate: (api, i) => ({ r: i.color[0], g: i.color[1], b: i.color[2], a: i.color[3] ?? 1 }),
});

node({
  id: 'cadence.color.combineHsv', label: 'Combine HSV', category: C, subcategory: 'Construct',
  aliases: ['hsv', 'hue saturation value', 'from hue'],
  summary: 'Builds a colour from hue, saturation and value.',
  teach: 'Hue is which colour of the rainbow (0 is red, going all the way round back to red at 1). Saturation is how vivid. Value is how bright.',
  exportSupport: 'native',
  inputs: [n('h', 'Hue', 0, rng01), n('s', 'Saturation', 1, rng01), n('v', 'Value', 1, rng01), n('a', 'Alpha', 1, rng01)],
  outputs: [{ key: 'out', label: 'Color', type: 'color' }],
  evaluate: (api, i) => [...V.hsvToRgb(i.h, i.s, i.v), i.a],
});

node({
  id: 'cadence.color.separateHsv', label: 'Separate HSV', category: C, subcategory: 'Construct',
  aliases: ['get hue', 'to hsv', 'split hue'],
  summary: 'Splits a colour into hue, saturation and value.',
  exportSupport: 'baked',
  inputs: [col('color', 'Color')],
  outputs: [
    { key: 'h', label: 'Hue', type: 'float' },
    { key: 's', label: 'Saturation', type: 'float' },
    { key: 'v', label: 'Value', type: 'float' },
    { key: 'a', label: 'Alpha', type: 'float' },
  ],
  evaluate: (api, i) => {
    const [h, s, v] = V.rgbToHsv(i.color);
    return { h, s, v, a: i.color[3] ?? 1 };
  },
});

node({
  id: 'cadence.color.combineHsl', label: 'Combine HSL', category: C, subcategory: 'Construct',
  aliases: ['hsl', 'hue saturation lightness'],
  summary: 'Builds a colour from hue, saturation and lightness.',
  explain: 'HSL differs from HSV in what the third number means: lightness 1 is always white, whereas value 1 is the most saturated version of the hue. HSL is easier for tints and shades; HSV for picking a vivid colour.',
  exportSupport: 'native',
  inputs: [n('h', 'Hue', 0, rng01), n('s', 'Saturation', 1, rng01), n('l', 'Lightness', 0.5, rng01), n('a', 'Alpha', 1, rng01)],
  outputs: [{ key: 'out', label: 'Color', type: 'color' }],
  evaluate: (api, i) => [...V.hslToRgb(i.h, i.s, i.l), i.a],
});

node({
  id: 'cadence.color.separateHsl', label: 'Separate HSL', category: C, subcategory: 'Construct',
  aliases: ['get lightness', 'to hsl'],
  summary: 'Splits a colour into hue, saturation and lightness.',
  exportSupport: 'baked',
  inputs: [col('color', 'Color')],
  outputs: [
    { key: 'h', label: 'Hue', type: 'float' },
    { key: 's', label: 'Saturation', type: 'float' },
    { key: 'l', label: 'Lightness', type: 'float' },
    { key: 'a', label: 'Alpha', type: 'float' },
  ],
  evaluate: (api, i) => {
    const [h, s, l] = V.rgbToHsl(i.color);
    return { h, s, l, a: i.color[3] ?? 1 };
  },
});

node({
  id: 'cadence.color.fromHex', label: 'Color From Hex', category: C, subcategory: 'Construct',
  aliases: ['hex', 'html color', 'web color', '#'],
  summary: 'Reads a colour from a hex code like #ff8800.',
  exportSupport: 'native',
  inputs: [{ key: 'hex', label: 'Hex code', type: 'string', default: '#ffffff' }],
  outputs: [{ key: 'out', label: 'Color', type: 'color' }],
  evaluate: (api, i) => V.hexToColor(i.hex),
});

node({
  id: 'cadence.color.temperature', label: 'Color Temperature', category: C, subcategory: 'Construct',
  aliases: ['kelvin', 'blackbody', 'warm cool', 'fire colour', 'flame'],
  summary: 'The colour of a glowing object at a given temperature in kelvin.',
  teach: 'Hot things glow. Around 1700 kelvin is candle flame orange, 6500 is white daylight, and above 10000 goes blue.',
  explain: 'An approximation of the Planckian locus (Tanner Helland\'s fit), accurate enough that named temperatures read correctly. It is not a spectral integration, and does not claim to be — for stylised fire the fit is indistinguishable from the exact curve.',
  commonUses: ['fire and explosion colour driven by a temperature attribute rather than a hand-picked gradient'],
  exportSupport: 'baked',
  inputs: [n('kelvin', 'Temperature', 3000, { min: 1000, max: 40000, unit: 'kelvin' })],
  outputs: [{ key: 'out', label: 'Color', type: 'color' }],
  evaluate: (api, i) => V.temperatureToColor(i.kelvin),
});

// ---------------------------------------------------------------- mixing
const BLEND_MODES = ['mix', 'add', 'subtract', 'multiply', 'screen', 'overlay', 'difference', 'darken', 'lighten', 'divide'];

function blendChannel(mode, a, b) {
  switch (mode) {
    case 'add': return a + b;
    case 'subtract': return a - b;
    case 'multiply': return a * b;
    case 'screen': return 1 - (1 - a) * (1 - b);
    case 'overlay': return a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
    case 'difference': return Math.abs(a - b);
    case 'darken': return Math.min(a, b);
    case 'lighten': return Math.max(a, b);
    case 'divide': return b === 0 ? 0 : a / b;
    default: return b; // 'mix'
  }
}

node({
  id: 'cadence.color.mix', label: 'Mix Color', category: C, subcategory: 'Mix',
  aliases: ['blend', 'combine colours', 'lerp color', 'overlay', 'add colour', 'multiply colour', 'tint'],
  summary: 'Blends two colours, with a choice of blend mode.',
  explain: 'The factor blends between the first colour and the result of the blend mode, so a factor of 0 always leaves the first colour untouched whichever mode is chosen. Alpha follows the first colour; use Set Alpha to change it deliberately.',
  exportSupport: 'baked',
  inputs: [
    col('a', 'Color', [0, 0, 0, 1]),
    col('b', 'Blend with', [1, 1, 1, 1]),
    n('factor', 'Factor', 1, rng01),
    mode('blend', 'Blend mode', BLEND_MODES, 'mix'),
  ],
  outputs: [{ key: 'out', label: 'Color', type: 'color' }],
  evaluate: (api, i) => {
    const f = Math.min(Math.max(i.factor, 0), 1);
    const outc = [0, 1, 2].map((k) => {
      const blended = blendChannel(i.blend, i.a[k], i.b[k]);
      return i.a[k] + (blended - i.a[k]) * f;
    });
    return [...outc, i.a[3] ?? 1];
  },
});

node({
  id: 'cadence.color.sampleGradient', label: 'Sample Gradient', category: C, subcategory: 'Mix',
  aliases: ['color ramp', 'gradient', 'ramp', 'colour over life', 'fade', 'gradient map', 'colorize'],
  summary: 'Reads a colour out of a gradient at a position from 0 to 1.',
  teach: 'A gradient is a strip of colours. This picks the colour at a given point along the strip — 0 is the left end, 1 is the right.',
  commonUses: ['colour over a particle\'s life', 'turning any 0-1 value, like noise or height, into colour'],
  preview: 'gradient',
  exportSupport: 'native',
  exportNote: 'Exports directly as a Roblox ColorSequence when driven by particle life.',
  inputs: [
    { key: 'gradient', label: 'Gradient', type: 'gradient', default: { kind: 'color', stops: [{ u: 0, v: '#000000' }, { u: 1, v: '#ffffff' }] } },
    n('position', 'Position', 0, rng01),
  ],
  outputs: [{ key: 'out', label: 'Color', type: 'color' }],
  evaluate: (api, i) => {
    const stops = normalizeStops(i.gradient, 'color');
    if (stops.length === 0) return [1, 1, 1, 1];
    if (stops.length === 1) return V.hexToColor(stops[0].v);
    return V.hexToColor(evalRamp(stops, i.position, stops[stops.length - 1].v));
  },
});

node({
  id: 'cadence.color.sampleNumberGradient', label: 'Sample Number Gradient', category: C, subcategory: 'Mix',
  aliases: ['number ramp', 'value ramp', 'opacity over life', 'size over life', 'curve strip'],
  summary: 'Reads a number out of a gradient of numbers at a position from 0 to 1.',
  commonUses: ['opacity or size over a particle\'s life'],
  preview: 'curve',
  exportSupport: 'native',
  exportNote: 'Exports directly as a Roblox NumberSequence when driven by particle life.',
  inputs: [
    { key: 'gradient', label: 'Gradient', type: 'gradient', default: { kind: 'number', stops: [{ u: 0, v: 0 }, { u: 1, v: 1 }] } },
    n('position', 'Position', 0, rng01),
  ],
  outputs: [{ key: 'out', label: 'Value', type: 'float' }],
  evaluate: (api, i) => {
    const stops = normalizeStops(i.gradient, 'number');
    if (!stops.length) return 0;
    if (stops.length === 1) return Number(stops[0].v) || 0;
    return evalRamp(stops, i.position, Number(stops[stops.length - 1].v) || 0);
  },
});

// ---------------------------------------------------------------- adjustment
node({
  id: 'cadence.color.adjustHsv', label: 'Adjust Hue/Saturation/Value', category: C, subcategory: 'Adjust',
  aliases: ['hue shift', 'saturate', 'desaturate', 'brighten', 'tint shift', 'rainbow'],
  summary: 'Shifts a colour\'s hue and scales its saturation and brightness.',
  commonUses: ['a rainbow shift over time', 'draining colour as something dies'],
  exportSupport: 'baked',
  inputs: [
    col('color', 'Color'),
    n('hueShift', 'Hue shift', 0, { min: -1, max: 1 }),
    n('saturation', 'Saturation', 1, { min: 0, max: 4 }),
    n('value', 'Brightness', 1, { min: 0, max: 8 }),
  ],
  outputs: [{ key: 'out', label: 'Color', type: 'color' }],
  evaluate: (api, i) => {
    const [h, s, v] = V.rgbToHsv(i.color);
    const rgb = V.hsvToRgb(h + i.hueShift, Math.min(s * i.saturation, 1), v * i.value);
    return [...rgb, i.color[3] ?? 1];
  },
});

node({
  id: 'cadence.color.exposure', label: 'Exposure', category: C, subcategory: 'Adjust',
  aliases: ['brightness stops', 'ev', 'gain', 'glow up'],
  summary: 'Brightens or darkens a colour in photographic stops — each stop doubles or halves it.',
  explain: 'Multiplies by 2 raised to the exposure. Unlike a plain multiply, equal steps read as equal changes to the eye, which is why exposure is the right control for glow strength.',
  exportSupport: 'baked',
  inputs: [col('color', 'Color'), n('stops', 'Stops', 0, { min: -10, max: 10 })],
  outputs: [{ key: 'out', label: 'Color', type: 'color' }],
  evaluate: (api, i) => {
    const g = Math.pow(2, i.stops);
    return [i.color[0] * g, i.color[1] * g, i.color[2] * g, i.color[3] ?? 1];
  },
});

node({
  id: 'cadence.color.contrast', label: 'Contrast', category: C, subcategory: 'Adjust',
  aliases: ['punch', 'flatten', 'levels'],
  summary: 'Pushes a colour away from or toward mid grey.',
  exportSupport: 'baked',
  inputs: [col('color', 'Color'), n('amount', 'Amount', 1, { min: 0, max: 4 }), n('pivot', 'Pivot', 0.5, rng01)],
  outputs: [{ key: 'out', label: 'Color', type: 'color' }],
  evaluate: (api, i) => [0, 1, 2].map((k) => i.pivot + (i.color[k] - i.pivot) * i.amount).concat([i.color[3] ?? 1]),
});

node({
  id: 'cadence.color.gamma', label: 'Gamma', category: C, subcategory: 'Adjust',
  aliases: ['power curve', 'midtones', 'lift'],
  summary: 'Bends a colour\'s midtones without moving pure black or pure white.',
  exportSupport: 'baked',
  inputs: [col('color', 'Color'), n('gamma', 'Gamma', 1, { min: 0.05, max: 8 })],
  outputs: [{ key: 'out', label: 'Color', type: 'color' }],
  evaluate: (api, i) => {
    const g = Math.max(0.05, i.gamma);
    const ch = (v) => (v <= 0 ? 0 : Math.pow(v, 1 / g));
    return [ch(i.color[0]), ch(i.color[1]), ch(i.color[2]), i.color[3] ?? 1];
  },
});

node({
  id: 'cadence.color.invert', label: 'Invert Color', category: C, subcategory: 'Adjust',
  aliases: ['negative', 'flip colour', 'opposite'],
  summary: 'Flips a colour to its opposite, leaving alpha alone.',
  exportSupport: 'baked',
  inputs: [col('color', 'Color'), n('factor', 'Amount', 1, rng01)],
  outputs: [{ key: 'out', label: 'Color', type: 'color' }],
  evaluate: (api, i) => [0, 1, 2].map((k) => i.color[k] + ((1 - i.color[k]) - i.color[k]) * i.factor).concat([i.color[3] ?? 1]),
});

node({
  id: 'cadence.color.posterize', label: 'Posterize', category: C, subcategory: 'Adjust',
  aliases: ['banding', 'steps', 'quantize colour', 'cel shade', 'stylize'],
  summary: 'Reduces a colour to a limited number of steps per channel.',
  commonUses: ['a stylised, banded look instead of a smooth gradient'],
  exportSupport: 'baked',
  inputs: [col('color', 'Color'), n('steps', 'Steps', 4, { min: 2, max: 64 })],
  outputs: [{ key: 'out', label: 'Color', type: 'color' }],
  evaluate: (api, i) => {
    const s = Math.max(2, Math.round(i.steps));
    const q = (v) => Math.round(Math.min(Math.max(v, 0), 1) * (s - 1)) / (s - 1);
    return [q(i.color[0]), q(i.color[1]), q(i.color[2]), i.color[3] ?? 1];
  },
});

node({
  id: 'cadence.color.luminance', label: 'Luminance', category: C, subcategory: 'Adjust',
  aliases: ['brightness', 'grey', 'greyscale', 'perceived brightness', 'to number'],
  summary: 'How bright a colour looks to the eye, as a single number.',
  explain: 'Weighted for human vision (green counts most, blue least), which is why a pure green reads brighter than a pure blue of the same numeric value. This is the honest way to turn a colour into a number — there is deliberately no automatic colour-to-number conversion.',
  exportSupport: 'baked',
  inputs: [col('color', 'Color')],
  outputs: [{ key: 'out', label: 'Brightness', type: 'float' }],
  evaluate: (api, i) => V.luminance(i.color),
});

// ---------------------------------------------------------------- alpha
node({
  id: 'cadence.color.setAlpha', label: 'Set Alpha', category: C, subcategory: 'Alpha',
  aliases: ['opacity', 'transparency', 'fade', 'alpha'],
  summary: 'Replaces a colour\'s alpha, keeping its red, green and blue.',
  explain: 'Alpha 1 is fully opaque and 0 is invisible. Note that Roblox\'s ParticleEmitter uses the opposite convention (Transparency, where 0 is opaque); the exporter converts, so you never have to think in both.',
  exportSupport: 'converted',
  inputs: [col('color', 'Color'), n('alpha', 'Alpha', 1, rng01)],
  outputs: [{ key: 'out', label: 'Color', type: 'color' }],
  evaluate: (api, i) => [i.color[0], i.color[1], i.color[2], i.alpha],
});

node({
  id: 'cadence.color.premultiply', label: 'Premultiply Alpha', category: C, subcategory: 'Alpha',
  aliases: ['premultiplied', 'associate alpha'],
  summary: 'Multiplies the colour channels by alpha.',
  explain: 'Premultiplied colour is what additive and glow blending expects — without it, a half-transparent bright colour brightens the background as much as an opaque one would.',
  exportSupport: 'baked',
  inputs: [col('color', 'Color')],
  outputs: [{ key: 'out', label: 'Color', type: 'color' }],
  evaluate: (api, i) => V.premultiply(i.color),
});

node({
  id: 'cadence.color.unpremultiply', label: 'Unpremultiply Alpha', category: C, subcategory: 'Alpha',
  aliases: ['unassociate alpha', 'straight alpha'],
  summary: 'Divides the colour channels by alpha, undoing a premultiply.',
  exportSupport: 'baked',
  inputs: [col('color', 'Color')],
  outputs: [{ key: 'out', label: 'Color', type: 'color' }],
  evaluate: (api, i) => V.unpremultiply(i.color),
});

// ---------------------------------------------------------------- colour space
node({
  id: 'cadence.color.srgbToLinear', label: 'sRGB To Linear', category: C, subcategory: 'Space',
  aliases: ['linearize', 'degamma', 'colour space'],
  summary: 'Converts a colour from screen (sRGB) encoding into linear light.',
  explain: 'Maths on colour — adding lights, averaging, blurring — is only physically correct in linear space. Hex codes and colour pickers are sRGB-encoded. Cadence stores hex colours as-is and does not linearise behind your back, so that existing effects keep their exact appearance; convert explicitly when the difference matters.',
  exportSupport: 'baked',
  inputs: [col('color', 'Color')],
  outputs: [{ key: 'out', label: 'Color', type: 'color' }],
  evaluate: (api, i) => [V.srgbToLinear(i.color[0]), V.srgbToLinear(i.color[1]), V.srgbToLinear(i.color[2]), i.color[3] ?? 1],
});

node({
  id: 'cadence.color.linearToSrgb', label: 'Linear To sRGB', category: C, subcategory: 'Space',
  aliases: ['gamma encode', 'to screen', 'colour space'],
  summary: 'Converts a colour from linear light into screen (sRGB) encoding.',
  exportSupport: 'baked',
  inputs: [col('color', 'Color')],
  outputs: [{ key: 'out', label: 'Color', type: 'color' }],
  evaluate: (api, i) => [V.linearToSrgb(i.color[0]), V.linearToSrgb(i.color[1]), V.linearToSrgb(i.color[2]), i.color[3] ?? 1],
});
