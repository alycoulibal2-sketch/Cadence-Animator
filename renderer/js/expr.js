// Advanced-mode math expressions: `rate = 120 * sin(t)`, `size = 0.5 + noise(t*2)`, etc.
// A tiny recursive-descent parser compiled to a closure tree — deliberately NOT eval/new Function,
// which the app's CSP (script-src 'self') blocks outright, and deliberately deterministic: the
// noise()/rand() functions are stateless hashes of their input, never Math.random(), so an
// expression-driven property still honors the "same frame in, same value out" guarantee every
// other part of the effect pipeline gives (see docs/vfx-studio.md).
//
// Grammar (loosest binding first):
//   ternary := or ('?' expr ':' expr)?
//   or      := and ('||' and)*
//   and     := cmp ('&&' cmp)*
//   cmp     := add (('<'|'>'|'<='|'>='|'=='|'!=') add)?
//   add     := mul (('+'|'-') mul)*
//   mul     := unary (('*'|'/'|'%') unary)*
//   unary   := '-' unary | pow
//   pow     := atom ('^' unary)?          (right-associative)
//   atom    := number | name | name '(' expr (',' expr)* ')' | '(' expr ')'
//
// Booleans are numbers (0/1), like shader languages — `t > 0.5 ? 1 : 0` works as expected.

const MAX_SRC_LEN = 500;
const MAX_TOKENS = 200;

// Deterministic hash in [0,1) — the same construction vfx.js uses for particle randomness.
function hash01(a, b = 0) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

// 1D value noise: smooth interpolation between hash values at integer lattice points.
function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f); // smoothstep
  return hash01(i) * (1 - u) + hash01(i + 1) * u;
}

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  sqrt: (x) => Math.sqrt(Math.max(0, x)),
  exp: Math.exp, log: (x) => Math.log(Math.max(1e-12, x)), sign: Math.sign,
  pow: (a, b) => Math.pow(a, b),
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a),
  clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
  lerp: (a, b, t) => a + (b - a) * t,
  noise: (x) => noise1(x),
  rand: (seed) => hash01(seed),
  saw: (x) => x - Math.floor(x),                       // 0..1 ramp, period 1
  tri: (x) => 1 - Math.abs(2 * (x - Math.floor(x)) - 1), // 0..1..0 triangle, period 1
  square: (x, duty = 0.5) => ((x - Math.floor(x)) < duty ? 1 : 0),
};
const FUNC_ARITY = { pow: 2, clamp: 3, lerp: 3, min: -2, max: -2, square: -1 }; // -n = at least |n|... -1 = 1 or 2

const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?/i.exec(src.slice(i));
      if (!m) throw new Error(`bad number at ${i}`);
      tokens.push({ k: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i));
      tokens.push({ k: 'name', v: m[0] });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '==' || two === '!=' || two === '&&' || two === '||') {
      tokens.push({ k: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/%^()?:,<>'.includes(c)) {
      tokens.push({ k: 'op', v: c });
      i++;
      continue;
    }
    throw new Error(`unexpected character "${c}"`);
  }
  if (tokens.length > MAX_TOKENS) throw new Error('expression too long');
  return tokens;
}

// Parses to a closure tree: every node is (env) => number. `env` is a plain object of variables.
function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (v) => {
    const t = tokens[pos];
    if (!t || (v !== undefined && t.v !== v)) throw new Error(`expected "${v}" but got ${t ? `"${t.v}"` : 'end of expression'}`);
    pos++;
    return t;
  };

  function atom() {
    const t = peek();
    if (!t) throw new Error('unexpected end of expression');
    if (t.k === 'num') { pos++; const v = t.v; return () => v; }
    if (t.v === '(') {
      eat('(');
      const inner = ternary();
      eat(')');
      return inner;
    }
    if (t.k === 'name') {
      pos++;
      const name = t.v;
      if (peek() && peek().v === '(') {
        const fn = FUNCS[name];
        if (!fn) throw new Error(`unknown function "${name}"`);
        eat('(');
        const args = [ternary()];
        while (peek() && peek().v === ',') { eat(','); args.push(ternary()); }
        eat(')');
        const arity = FUNC_ARITY[name] ?? 1;
        if (arity >= 0 && args.length !== arity) throw new Error(`${name}() takes ${arity} argument${arity === 1 ? '' : 's'}`);
        if (arity < 0 && args.length < -arity) throw new Error(`${name}() needs at least ${-arity} argument${arity === -1 ? '' : 's'}`);
        return (env) => fn(...args.map((a) => a(env)));
      }
      if (name in CONSTS) { const v = CONSTS[name]; return () => v; }
      return (env) => {
        const v = env[name];
        if (typeof v !== 'number') throw new Error(`unknown variable "${name}"`);
        return v;
      };
    }
    throw new Error(`unexpected "${t.v}"`);
  }

  function power() {
    const base = atom();
    if (peek() && peek().v === '^') {
      eat('^');
      const exp = unary(); // right-assoc: 2^3^2 = 2^(3^2)
      return (env) => Math.pow(base(env), exp(env));
    }
    return base;
  }

  function unary() {
    if (peek() && peek().v === '-') {
      eat('-');
      const operand = unary();
      return (env) => -operand(env);
    }
    return power();
  }

  function mul() {
    let left = unary();
    while (peek() && (peek().v === '*' || peek().v === '/' || peek().v === '%')) {
      const op = eat().v;
      const right = unary();
      const l = left;
      if (op === '*') left = (env) => l(env) * right(env);
      else if (op === '/') left = (env) => { const d = right(env); return d === 0 ? 0 : l(env) / d; };
      else left = (env) => { const d = right(env); return d === 0 ? 0 : l(env) % d; };
    }
    return left;
  }

  function add() {
    let left = mul();
    while (peek() && (peek().v === '+' || peek().v === '-')) {
      const op = eat().v;
      const right = mul();
      const l = left;
      left = op === '+' ? (env) => l(env) + right(env) : (env) => l(env) - right(env);
    }
    return left;
  }

  function cmp() {
    const left = add();
    const t = peek();
    if (t && ['<', '>', '<=', '>=', '==', '!='].includes(t.v)) {
      const op = eat().v;
      const right = add();
      return (env) => {
        const a = left(env), b = right(env);
        switch (op) {
          case '<': return a < b ? 1 : 0;
          case '>': return a > b ? 1 : 0;
          case '<=': return a <= b ? 1 : 0;
          case '>=': return a >= b ? 1 : 0;
          case '==': return a === b ? 1 : 0;
          default: return a !== b ? 1 : 0;
        }
      };
    }
    return left;
  }

  function andExpr() {
    let left = cmp();
    while (peek() && peek().v === '&&') {
      eat('&&');
      const right = cmp();
      const l = left;
      left = (env) => (l(env) !== 0 && right(env) !== 0 ? 1 : 0);
    }
    return left;
  }

  function orExpr() {
    let left = andExpr();
    while (peek() && peek().v === '||') {
      eat('||');
      const right = andExpr();
      const l = left;
      left = (env) => (l(env) !== 0 || right(env) !== 0 ? 1 : 0);
    }
    return left;
  }

  function ternary() {
    const cond = orExpr();
    if (peek() && peek().v === '?') {
      eat('?');
      const thenB = ternary();
      eat(':');
      const elseB = ternary();
      return (env) => (cond(env) !== 0 ? thenB(env) : elseB(env));
    }
    return cond;
  }

  const root = ternary();
  if (pos !== tokens.length) throw new Error(`unexpected "${tokens[pos].v}" after end of expression`);
  return root;
}

const cache = new Map(); // src -> { ok, eval } | { ok:false, error }

// Compile an expression string. Returns { ok:true, eval(env) → number } or { ok:false, error }.
// Results (including failures) are cached per source string — recompiling every sampled frame
// would dominate the cost of actually evaluating.
export function compileExpr(src) {
  if (typeof src !== 'string') return { ok: false, error: 'not a string' };
  const key = src;
  const hit = cache.get(key);
  if (hit) return hit;
  let out;
  const trimmed = src.trim();
  if (!trimmed) out = { ok: false, error: 'empty expression' };
  else if (trimmed.length > MAX_SRC_LEN) out = { ok: false, error: 'expression too long' };
  else {
    try {
      const fn = parse(tokenize(trimmed));
      out = { ok: true, eval: fn };
    } catch (e) {
      out = { ok: false, error: e.message };
    }
  }
  if (cache.size > 500) cache.clear(); // effectively unbounded user input; keep the cache tiny
  cache.set(key, out);
  return out;
}

// Evaluate with a safety net: any parse error, runtime error (unknown variable), or non-finite
// result returns `fallback` instead — a broken expression must degrade to the curve/base value,
// never crash or NaN-poison the sampler. The diagnostics system reports the error separately
// (see validateExpressions in diagnostics.js); this function stays silent by design.
export function evalExpr(src, env, fallback = 0) {
  const c = compileExpr(src);
  if (!c.ok) return fallback;
  try {
    const v = c.eval(env);
    return Number.isFinite(v) ? v : fallback;
  } catch (_) {
    return fallback;
  }
}

// For diagnostics: returns null if the expression compiles and evaluates finitely against a
// representative env, else a human-readable problem description.
export function checkExpr(src) {
  const c = compileExpr(src);
  if (!c.ok) return c.error;
  try {
    const v = c.eval({ t: 0.5, f: 15, dur: 2, value: 1 });
    if (!Number.isFinite(v)) return 'evaluates to a non-finite number';
    return null;
  } catch (e) {
    return e.message;
  }
}
