// Easing engine — a direct port of Moon Animator 2's Libraries/EasingFunctions.module.lua
// and Classes/Ease.module.lua, so a keyframe eased here matches Moon frame for frame.
//
// The Lua original is itself derived from EmmanuelOga/easing and Blender's easing.c, and every
// function keeps that library's (t, b, c, d) signature — t=time, b=begin, c=change, d=duration.
// They are ported verbatim rather than re-derived into normalized 0..1 form on purpose: several
// styles (Expo's 0.001 fudge, Back's 1.525 InOut scaling, Elastic's amplitude blend) are NOT
// simple reflections of their "In" variant, and rebuilding them from the usual
// `out(t) = 1 - in(1-t)` identity would silently diverge from Moon.
//
// `EASE(val, ...params)` wrappers at the bottom are the normalized b=0, c=1, d=1 entry points,
// mirroring Moon's own `module.SineIn = function(val) return inSine(val, 0, 1, 1) end`.

const PI = Math.PI;
const pow = Math.pow;

// ---------------------------------------------------------------- linear / constant
function linear(t, b, c, d) { return c * t / d + b; }
function constant(t, b, c, d) { return t === d ? 1 : 0; }

// ---------------------------------------------------------------- sine
function inSine(t, b, c, d) { return -c * Math.cos(t / d * (PI / 2)) + c + b; }
function outSine(t, b, c, d) { return c * Math.sin(t / d * (PI / 2)) + b; }
function inOutSine(t, b, c, d) { return -c / 2 * (Math.cos(PI * t / d) - 1) + b; }
function outInSine(t, b, c, d) {
  if (t < d / 2) return outSine(t * 2, b, c / 2, d);
  return inSine((t * 2) - d, b + c / 2, c / 2, d);
}

// ---------------------------------------------------------------- polynomial families
// Quad/Cubic/Quart/Quint/Sextic are the same shape at powers 2..6; Moon spells each one out
// longhand, but the only thing that varies is the exponent and the InOut sign flip on odd
// powers, so they are generated here from one factory that reproduces those forms exactly.
function polyFamily(n) {
  const oddPower = n % 2 === 1;
  const inF = (t, b, c, d) => { t = t / d; return c * pow(t, n) + b; };
  // even powers need the -c(t^n - 1) form, odd powers c(t^n + 1) — matching Moon's outQuad
  // (-c*t*(t-2), i.e. the n=2 even form) vs outCubic (c*(t^3+1), the odd form).
  const outF = (t, b, c, d) => {
    t = t / d - 1;
    return oddPower ? c * (pow(t, n) + 1) + b : -c * (pow(t, n) - 1) + b;
  };
  const inOutF = (t, b, c, d) => {
    t = t / d * 2;
    if (t < 1) return c / 2 * pow(t, n) + b;
    t = t - 2;
    return oddPower ? c / 2 * (pow(t, n) + 2) + b : -c / 2 * (pow(t, n) - 2) + b;
  };
  const outInF = (t, b, c, d) => {
    if (t < d / 2) return outF(t * 2, b, c / 2, d);
    return inF((t * 2) - d, b + c / 2, c / 2, d);
  };
  return { in: inF, out: outF, inOut: inOutF, outIn: outInF };
}
const QUAD = polyFamily(2);
const CUBIC = polyFamily(3);
const QUART = polyFamily(4);
const QUINT = polyFamily(5);
const SEXTIC = polyFamily(6);

// ---------------------------------------------------------------- exponential
// The 0.001 / 1.001 fudge factors are Moon's (from the Oga library) — they make the curve
// hit exactly 0 and 1 at the endpoints despite 2^-10 never reaching zero. Kept deliberately.
function inExpo(t, b, c, d) {
  if (t === 0) return b;
  return c * pow(2, 10 * (t / d - 1)) + b - c * 0.001;
}
function outExpo(t, b, c, d) {
  if (t === d) return b + c;
  return c * 1.001 * (-pow(2, -10 * t / d) + 1) + b;
}
function inOutExpo(t, b, c, d) {
  if (t === 0) return b;
  if (t === d) return b + c;
  t = t / d * 2;
  if (t < 1) return c / 2 * pow(2, 10 * (t - 1)) + b - c * 0.0005;
  t = t - 1;
  return c / 2 * 1.0005 * (-pow(2, -10 * t) + 2) + b;
}
function outInExpo(t, b, c, d) {
  if (t < d / 2) return outExpo(t * 2, b, c / 2, d);
  return inExpo((t * 2) - d, b + c / 2, c / 2, d);
}

// ---------------------------------------------------------------- circular
function inCirc(t, b, c, d) { t = t / d; return -c * (Math.sqrt(1 - pow(t, 2)) - 1) + b; }
function outCirc(t, b, c, d) { t = t / d - 1; return c * Math.sqrt(1 - pow(t, 2)) + b; }
function inOutCirc(t, b, c, d) {
  t = t / d * 2;
  if (t < 1) return -c / 2 * (Math.sqrt(1 - t * t) - 1) + b;
  t = t - 2;
  return c / 2 * (Math.sqrt(1 - t * t) + 1) + b;
}
function outInCirc(t, b, c, d) {
  if (t < d / 2) return outCirc(t * 2, b, c / 2, d);
  return inCirc((t * 2) - d, b + c / 2, c / 2, d);
}

// ---------------------------------------------------------------- back (overshoot param `s`)
export const BACK_DEFAULT_OVERSHOOT = 1.70158;
function inBack(t, b, c, d, s) {
  if (s == null) s = BACK_DEFAULT_OVERSHOOT;
  t = t / d;
  return c * t * t * ((s + 1) * t - s) + b;
}
function outBack(t, b, c, d, s) {
  if (s == null) s = BACK_DEFAULT_OVERSHOOT;
  t = t / d - 1;
  return c * (t * t * ((s + 1) * t + s) + 1) + b;
}
function inOutBack(t, b, c, d, s) {
  if (s == null) s = BACK_DEFAULT_OVERSHOOT;
  s = s * 1.525;
  t = t / d * 2;
  if (t < 1) return c / 2 * (t * t * ((s + 1) * t - s)) + b;
  t = t - 2;
  return c / 2 * (t * t * ((s + 1) * t + s) + 2) + b;
}
function outInBack(t, b, c, d, s) {
  if (t < d / 2) return outBack(t * 2, b, c / 2, d, s);
  return inBack((t * 2) - d, b + c / 2, c / 2, d, s);
}

// ---------------------------------------------------------------- bounce
function outBounce(t, b, c, d) {
  t = t / d;
  if (t < 1 / 2.75) return c * (7.5625 * t * t) + b;
  if (t < 2 / 2.75) { t = t - (1.5 / 2.75); return c * (7.5625 * t * t + 0.75) + b; }
  if (t < 2.5 / 2.75) { t = t - (2.25 / 2.75); return c * (7.5625 * t * t + 0.9375) + b; }
  t = t - (2.625 / 2.75);
  return c * (7.5625 * t * t + 0.984375) + b;
}
function inBounce(t, b, c, d) { return c - outBounce(d - t, 0, c, d) + b; }
function inOutBounce(t, b, c, d) {
  if (t < d / 2) return inBounce(t * 2, 0, c, d) * 0.5 + b;
  return outBounce(t * 2 - d, 0, c, d) * 0.5 + c * 0.5 + b;
}
function outInBounce(t, b, c, d) {
  if (t < d / 2) return outBounce(t * 2, b, c / 2, d);
  return inBounce((t * 2) - d, b + c / 2, c / 2, d);
}

// ---------------------------------------------------------------- elastic (amplitude + period)
export const ELASTIC_DEFAULT_AMPLITUDE = 1;
export const ELASTIC_DEFAULT_PERIOD = 0.3;
// Blender's amplitude blend: when the requested amplitude is smaller than the travelled
// distance the curve is faded toward a plain exponential near t=0 so it does not visibly
// start away from the keyframe's own value.
function elasticBlend(t, c, d, a, s, f) {
  if (c !== 0) {
    const tAbs = Math.abs(s);
    if (a !== 0) f = f * (a / Math.abs(c));
    else f = 0;
    if (Math.abs(t * d) < tAbs) {
      const l = Math.abs(t * d) / tAbs;
      f = (f * l) + (1 - l);
    }
  }
  return f;
}
function inElastic(t, b, c, d, a, p) {
  let s, f = 1;
  if (t === 0) return b;
  t = t / d;
  if (t === 1) return b + c;
  t = t - 1;
  if (!p || p === 0) p = d * 0.3;
  if (a == null || a < Math.abs(c)) {
    s = p / 4;
    f = elasticBlend(t, c, d, a, s, f);
    a = c;
  } else {
    s = p / (2 * PI) * Math.asin(c / a);
  }
  return (-f * (a * pow(2, 10 * t) * Math.sin((t * d - s) * (2 * PI) / p))) + b;
}
function outElastic(t, b, c, d, a, p) {
  let s, f = 1;
  if (t === 0) return b;
  t = t / d;
  if (t === 1) return b + c;
  t = -t;
  if (!p || p === 0) p = d * 0.3;
  if (a == null || a < Math.abs(c)) {
    s = p / 4;
    f = elasticBlend(t, c, d, a, s, f);
    a = c;
  } else {
    s = p / (2 * PI) * Math.asin(c / a);
  }
  return (f * (a * pow(2, 10 * t) * Math.sin((t * d - s) * (2 * PI) / p))) + c + b;
}
function inOutElastic(t, b, c, d, a, p) {
  let s, f = 1;
  if (t === 0) return b;
  t = t / (d / 2);
  if (t === 2) return b + c;
  t = t - 1;
  if (!p || p === 0) p = d * (0.3 * 1.5);
  if (a == null || a < Math.abs(c)) {
    s = p / 4;
    f = elasticBlend(t, c, d, a, s, f);
    a = c;
  } else {
    s = p / (2 * PI) * Math.asin(c / a);
  }
  if (t < 0) {
    f = f * -0.5;
    return (f * (a * pow(2, 10 * t) * Math.sin((t * d - s) * (2 * PI) / p))) + b;
  }
  t = -t;
  f = f * 0.5;
  return (f * (a * pow(2, 10 * t) * Math.sin((t * d - s) * (2 * PI) / p))) + c + b;
}
function outInElastic(t, b, c, d, a, p) {
  if (t < d / 2) return outElastic(t * 2, b, c / 2, d, a, p);
  return inElastic((t * 2) - d, b + c / 2, c / 2, d, a, p);
}

// ---------------------------------------------------------------- style registry
// `params` mirrors Moon's Ease.EASE_DATA: which extra inputs a style exposes beyond direction.
// `color` is Moon's own per-style keyframe tint (Ease.EASE_DATA[x].Color), used by the
// timeline's "Easing Colors" mode so a dope sheet reads the same as Moon's.
export const EASE_DATA = {
  Linear: { color: '#1765b8', directional: false, params: [] },
  Constant: { color: '#756c3c', directional: false, params: [], label: 'None' },
  Sine: { color: '#00d717', directional: true, params: [] },
  Back: { color: '#bdc3c7', directional: true, params: ['Overshoot'] },
  Quad: { color: '#e91818', directional: true, params: [] },
  Cubic: { color: '#b81785', directional: true, params: [] },
  Quart: { color: '#fd5b03', directional: true, params: [] },
  Quint: { color: '#fec606', directional: true, params: [] },
  Sextic: { color: '#ac8de0', directional: true, params: [] },
  Exponential: { color: '#ff7fc8', directional: true, params: [] },
  Circular: { color: '#10d2e5', directional: true, params: [] },
  Bounce: { color: '#6717b8', directional: true, params: [] },
  Elastic: { color: '#5db817', directional: true, params: ['Amplitude', 'Period'] },
};

// Moon's own ordering in Ease.EASE_LIST — kept so the ease dropdown reads identically.
export const STYLES = ['Linear', 'Constant', 'Sine', 'Back', 'Quad', 'Cubic', 'Quart', 'Quint',
  'Sextic', 'Exponential', 'Circular', 'Bounce', 'Elastic'];
export const DIRECTIONS = ['In', 'Out', 'InOut', 'OutIn'];

// Moon calls these Expo/Circ; Roblox's own Enum.EasingStyle (and every Cadence project saved
// before this port) calls them Exponential/Circular. Accept both, store Cadence's spelling.
const STYLE_ALIASES = { Expo: 'Exponential', Circ: 'Circular', None: 'Constant' };
export function canonicalStyle(style) {
  if (!style) return 'Linear';
  return STYLE_ALIASES[style] || (EASE_DATA[style] ? style : 'Linear');
}

// Moon's Ease.PARAM_DATA — the extra numeric inputs, their defaults and spinner increments.
export const PARAM_DATA = {
  Overshoot: { name: 'Overshoot', default: BACK_DEFAULT_OVERSHOOT, inc: 0.1 },
  Amplitude: { name: 'Amplitude', default: ELASTIC_DEFAULT_AMPLITUDE, inc: 0.1 },
  // frameRelative: Moon scales Period by the segment's frame length rather than treating it
  // as an absolute 0..1 fraction, so a given Period looks the same on a long and short segment.
  Period: { name: 'Period', default: ELASTIC_DEFAULT_PERIOD, inc: 0.01, frameRelative: true },
};

export function paramsFor(style) { return EASE_DATA[canonicalStyle(style)]?.params || []; }
export function isDirectional(style) { return EASE_DATA[canonicalStyle(style)]?.directional !== false; }
export function easeColor(style) { return EASE_DATA[canonicalStyle(style)]?.color || '#1765b8'; }

const FAMILIES = {
  Sine: { in: inSine, out: outSine, inOut: inOutSine, outIn: outInSine },
  Quad: QUAD, Cubic: CUBIC, Quart: QUART, Quint: QUINT, Sextic: SEXTIC,
  Exponential: { in: inExpo, out: outExpo, inOut: inOutExpo, outIn: outInExpo },
  Circular: { in: inCirc, out: outCirc, inOut: inOutCirc, outIn: outInCirc },
  Back: { in: inBack, out: outBack, inOut: inOutBack, outIn: outInBack },
  Bounce: { in: inBounce, out: outBounce, inOut: inOutBounce, outIn: outInBounce },
  Elastic: { in: inElastic, out: outElastic, inOut: inOutElastic, outIn: outInElastic },
};
const DIR_KEY = { In: 'in', Out: 'out', InOut: 'inOut', OutIn: 'outIn' };

/**
 * Evaluate an easing curve at normalized time t ∈ [0,1].
 * @param {string} style   e.g. 'Quad' (Moon's 'Expo'/'Circ' spellings also accepted)
 * @param {string} direction 'In' | 'Out' | 'InOut' | 'OutIn'
 * @param {number} t
 * @param {object} [params] { Overshoot } for Back, { Amplitude, Period } for Elastic
 */
export function ease(style, direction, t, params) {
  t = Math.max(0, Math.min(1, t));
  const s = canonicalStyle(style);
  if (s === 'Linear') return linear(t, 0, 1, 1);
  if (s === 'Constant') return constant(t, 0, 1, 1);
  const fam = FAMILIES[s];
  if (!fam) return t;
  const f = fam[DIR_KEY[direction] || 'out'];
  if (s === 'Back') {
    return f(t, 0, 1, 1, params?.Overshoot ?? BACK_DEFAULT_OVERSHOOT);
  }
  if (s === 'Elastic') {
    return f(t, 0, 1, 1,
      params?.Amplitude ?? ELASTIC_DEFAULT_AMPLITUDE,
      params?.Period ?? ELASTIC_DEFAULT_PERIOD);
  }
  return f(t, 0, 1, 1);
}

// Cubic bezier easing like CSS cubic-bezier(x1, y1, x2, y2)
export function cubicBezier(x1, y1, x2, y2, t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // solve u for x(u) = t via Newton-Raphson with bisection fallback
  const X = (u) => (((1 - 3 * x2 + 3 * x1) * u + (3 * x2 - 6 * x1)) * u + 3 * x1) * u;
  const dX = (u) => (3 * (1 - 3 * x2 + 3 * x1) * u + 2 * (3 * x2 - 6 * x1)) * u + 3 * x1;
  const Y = (u) => (((1 - 3 * y2 + 3 * y1) * u + (3 * y2 - 6 * y1)) * u + 3 * y1) * u;
  let u = t;
  for (let i = 0; i < 8; i++) {
    const x = X(u) - t;
    if (Math.abs(x) < 1e-6) return Y(u);
    const d = dX(u);
    if (Math.abs(d) < 1e-6) break;
    u -= x / d;
    u = Math.max(0, Math.min(1, u));
  }
  // bisection fallback
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    u = (lo + hi) / 2;
    if (X(u) < t) lo = u; else hi = u;
  }
  return Y(u);
}

/**
 * Evaluate a keyframe segment's easing. Key carries {es, ed, bez, ep}.
 * `ep` holds this key's own easing parameters (Overshoot / Amplitude / Period).
 * `segFrames` is the segment's length in frames, needed for Period's frame-relative scaling.
 */
export function evalSegment(key, t, segFrames) {
  if (key && key.bez) return cubicBezier(key.bez[0], key.bez[1], key.bez[2], key.bez[3], t);
  if (!key) return ease('Linear', 'Out', t);
  let params = key.ep;
  if (params && params.Period != null && segFrames > 0) {
    // Moon marks Period frame_relative: the stored value is in frames, but the easing math
    // wants a fraction of the (normalized, d=1) segment.
    params = { ...params, Period: params.Period / segFrames };
  }
  return ease(key.es || 'Linear', key.ed || 'Out', t, params);
}

// Bezier presets shown in the curve editor
export const BEZIER_PRESETS = [
  { name: 'Smooth', v: [0.25, 0.1, 0.25, 1] },
  { name: 'Snap in', v: [0.6, 0.04, 0.98, 0.34] },
  { name: 'Snap out', v: [0.05, 0.7, 0.1, 1] },
  { name: 'Anticipate', v: [0.36, 0, 0.66, -0.56] },
  { name: 'Overshoot', v: [0.34, 1.56, 0.64, 1] },
  { name: 'Ease both', v: [0.45, 0, 0.55, 1] },
];

// Mapping helpers for KeyframeSequence export.
// Roblox PoseEasingStyle only supports these; everything else gets baked at export.
export const POSE_NATIVE_STYLES = new Set(['Linear', 'Constant', 'Cubic', 'Elastic', 'Bounce']);
export function needsBaking(key) {
  if (!key) return false;
  if (key.bez) return true;
  // A parameterised ease has no Roblox equivalent even when the style itself is native —
  // Roblox's PoseEasingStyle carries no Overshoot/Amplitude/Period, so it must be baked.
  if (key.ep && Object.keys(key.ep).length) return true;
  if (key.ed === 'OutIn') return true; // Roblox has no OutIn direction
  return !POSE_NATIVE_STYLES.has(canonicalStyle(key.es || 'Linear'));
}
