// All Roblox easing styles + directions, plus interactive cubic-bezier curves.
// Style functions are defined in their "In" form over t ∈ [0,1].

const c1 = 1.70158;
const c3 = c1 + 1;

const IN = {
  Linear: (t) => t,
  Constant: (t) => (t >= 1 ? 1 : 0),
  Sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  Quad: (t) => t * t,
  Cubic: (t) => t * t * t,
  Quart: (t) => t * t * t * t,
  Quint: (t) => t * t * t * t * t,
  Exponential: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  Circular: (t) => 1 - Math.sqrt(1 - t * t),
  Back: (t) => c3 * t * t * t - c1 * t * t,
  Elastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3))),
  Bounce: (t) => 1 - bounceOut(1 - t),
};

function bounceOut(t) {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

export const STYLES = Object.keys(IN);
export const DIRECTIONS = ['In', 'Out', 'InOut'];

export function ease(style, direction, t) {
  t = Math.max(0, Math.min(1, t));
  const f = IN[style] || IN.Linear;
  if (style === 'Linear' || style === 'Constant') return f(t);
  switch (direction) {
    case 'In': return f(t);
    case 'Out': return 1 - f(1 - t);
    case 'InOut': return t < 0.5 ? f(t * 2) / 2 : 1 - f(2 - t * 2) / 2;
    default: return f(t);
  }
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

// Evaluate a keyframe segment's easing. Key carries {es, ed, bez}.
export function evalSegment(key, t) {
  if (key && key.bez) return cubicBezier(key.bez[0], key.bez[1], key.bez[2], key.bez[3], t);
  return ease(key ? key.es || 'Linear' : 'Linear', key ? key.ed || 'Out' : 'Out', t);
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
  return !POSE_NATIVE_STYLES.has(key.es || 'Linear');
}
