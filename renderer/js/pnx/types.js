// PNX type system: type descriptors, the implicit-conversion table, and generic unification.
// Pure — no DOM, no window.*, no three.js, no state.js. Loadable in plain Node (test/pnxtest.mjs
// enforces this), exactly like effectModel.js and cf.js.
//
// A type is written as a string and parsed into a TypeRef:
//   'float'              -> { name: 'float', param: null }
//   'field<vector3>'     -> { name: 'field', param: { name: 'vector3', param: null } }
//   'array<color>'       -> { name: 'array',  param: { name: 'color',  param: null } }
//   'T'                  -> a GENERIC variable (single uppercase letter, or upper + digits)
//
// Two structural wrappers exist: `field<T>` (a value that varies over a sample point — see
// fields.js) and `array<T>`. Everything else is a leaf.
//
// Conversion policy, chosen deliberately and worth not loosening casually:
//   - WIDENING is implicit (int->float, float->vector3 broadcast, T->field<T> constant lift).
//   - NARROWING is not (vector3->float, color->float), because there is always more than one
//     defensible answer and the spec has explicit nodes for each of them (Length, Luminance,
//     Split Vector). A silent choice here would be a whole class of "why is my effect grey"
//     bugs that no diagnostic could explain.
//   - Exactly ONE hop. No transitive conversion chains: predictability beats cleverness, and a
//     chain's cost ordering is not stable under adding a new type later.
//   - Lossy-but-universally-wanted conversions (float->int for a count, float->bool for a gate)
//     are allowed at a high cost, so an exact match always wins socket resolution.

// ---------------------------------------------------------------- type descriptors
// implemented: false marks a type the engine can NAME and type-check but has no values for yet.
// The registry refuses to register a node using one (see registry.js) — that is how the spec's
// "do not fake features" rule is enforced mechanically rather than by remembering.
const TYPES = {
  // --- Phase 1/2 leaves, fully implemented
  float: { label: 'Number', color: '#a6b4c8', implemented: true, unit: null },
  int: { label: 'Whole number', color: '#8fa8c8', implemented: true, unit: null },
  bool: { label: 'Yes/No', color: '#c89a6a', implemented: true, unit: null },
  string: { label: 'Text', color: '#9a8fc8', implemented: true, unit: null },

  vector2: { label: 'Vector 2', color: '#7fc8a8', implemented: true, components: 2 },
  vector3: { label: 'Vector 3', color: '#6fc8c8', implemented: true, components: 3 },
  vector4: { label: 'Vector 4', color: '#6fb0c8', implemented: true, components: 4 },
  color: { label: 'Color', color: '#e0c060', implemented: true, components: 4 },

  quaternion: { label: 'Rotation', color: '#c87fa8', implemented: true, components: 4 },
  transform: { label: 'Transform', color: '#c86f8f', implemented: true },
  matrix4: { label: 'Matrix', color: '#a86f8f', implemented: true, components: 16 },

  curve: { label: 'Curve', color: '#8fc86f', implemented: true },
  gradient: { label: 'Gradient', color: '#c8b06f', implemented: true },

  // --- structural wrappers
  field: { label: 'Field', color: '#6f8fc8', implemented: true, wrapper: true },
  array: { label: 'List', color: '#8f8f9a', implemented: true, wrapper: true },

  // --- the escape hatch: runtime-checked, always the last resort in socket resolution
  any: { label: 'Anything', color: '#787884', implemented: true },

  // --- Phase 4: geometry. ONE type, deliberately.
  // The spec lists Mesh, CurveGeometry and PointCloud separately, and an early draft of this table
  // had them as separate types. They were collapsed because separate types make the composition the
  // spec actually asks for impossible: `Points On Surface` would need a Mesh, `Instance On Points` a
  // PointCloud, and joining a curve to a mesh would have no type at all. A geometry is a container of
  // point/curve/face domains (see geometry.js), so one type covers every combination and a node that
  // needs faces asks whether there are faces rather than demanding a different type.
  geometry: { label: 'Geometry', color: '#6fc87f', implemented: true },
  instanceSet: { label: 'Instances', color: '#c8906f', implemented: true },

  // --- Phase 5/6 handoff values. Each is a small description that one node builds and another
  // consumes. They are typed rather than passed as `any` for one concrete reason: an `any` socket
  // would happily accept a Collider where an Emitter belongs, and the failure would surface as "my
  // particles do not spawn" rather than as a refused wire.
  emitter: { label: 'Emitter', color: '#c8a06f', implemented: true },
  collider: { label: 'Collider', color: '#c87f7f', implemented: true },
  attributeWrite: { label: 'Attribute write', color: '#9ac86f', implemented: true },
  material: { label: 'Material', color: '#c86f6f', implemented: true },
  // A 2D raster. Distinct from `field<color>` on purpose: a field is continuous and lazy, a texture
  // is a fixed grid evaluated once. Blur, edge detect and dilate need NEIGHBOURING pixels, and
  // "neighbour" has no meaning in a continuous field — which is the whole reason both types exist.
  texture2d: { label: 'Texture', color: '#6fa8c8', implemented: true },
  renderCommand: { label: 'Render', color: '#e08f5f', implemented: true },

  // --- Declared, type-checkable, and NOT yet implemented. registerNode() refuses any node whose
  // socket names one of these, which is how Part 78 is enforced mechanically rather than by memory.
  //
  // `light` and `camera` are worth a word: this engine renders a light by emitting a render command
  // (Part 36 lists Light Renderer among the renderers), so there is no Light *value* to pass through
  // non-rendering nodes yet. The type stays declared for the day one is needed — a light you can
  // transform, parent and query before drawing.
  particleSet: { label: 'Particles', color: '#c8a06f', implemented: false, phase: 5 },
  volume: { label: 'Volume', color: '#9a6fc8', implemented: false, phase: 8 },
  shader: { label: 'Shader', color: '#c87f6f', implemented: false, phase: 7 },
  light: { label: 'Light', color: '#e0d060', implemented: false, phase: 6 },
  camera: { label: 'Camera', color: '#6fc8b0', implemented: false, phase: 6 },
  event: { label: 'Event', color: '#e07f7f', implemented: false, phase: 5 },
  state: { label: 'State', color: '#7f7fe0', implemented: false, phase: 5 },
};

export function typeMeta(name) {
  return TYPES[name] || null;
}
export function typeNames() {
  return Object.keys(TYPES);
}
export function isImplementedType(ref) {
  const r = asRef(ref);
  if (!r) return false;
  if (isGeneric(r)) return true;
  const meta = TYPES[r.name];
  if (!meta || !meta.implemented) return false;
  return r.param ? isImplementedType(r.param) : true;
}

// ---------------------------------------------------------------- parsing
const GENERIC_RE = /^[A-Z][0-9]?$/;
export function isGeneric(ref) {
  const r = asRef(ref);
  return !!r && !r.param && GENERIC_RE.test(r.name);
}

const parseCache = new Map();

// parseType('field<float>') -> TypeRef. Returns null for anything unparseable rather than
// throwing: a graph loaded from disk can contain a type string this build does not know, and the
// caller (registry/graph validation) turns that into a diagnostic with real context.
export function parseType(str) {
  if (str && typeof str === 'object' && typeof str.name === 'string') return str; // already a ref
  if (typeof str !== 'string') return null;
  const key = str.trim();
  if (parseCache.has(key)) return parseCache.get(key);
  const ref = parseTypeInner(key);
  parseCache.set(key, ref);
  return ref;
}

function parseTypeInner(s) {
  const lt = s.indexOf('<');
  if (lt < 0) {
    if (!GENERIC_RE.test(s) && !TYPES[s]) return null;
    return Object.freeze({ name: s, param: null });
  }
  if (!s.endsWith('>')) return null;
  const name = s.slice(0, lt).trim();
  const meta = TYPES[name];
  if (!meta || !meta.wrapper) return null;
  const inner = parseTypeInner(s.slice(lt + 1, -1).trim());
  if (!inner) return null;
  return Object.freeze({ name, param: inner });
}

function asRef(t) {
  return typeof t === 'string' ? parseType(t) : (t && typeof t.name === 'string' ? t : null);
}

export function formatType(ref) {
  const r = asRef(ref);
  if (!r) return '?';
  return r.param ? `${r.name}<${formatType(r.param)}>` : r.name;
}

export function sameType(a, b) {
  return formatType(a) === formatType(b);
}

export const isFieldType = (t) => asRef(t)?.name === 'field';
export const isArrayType = (t) => asRef(t)?.name === 'array';
export const innerType = (t) => asRef(t)?.param || null;

export function fieldOf(t) {
  const r = asRef(t);
  return r ? Object.freeze({ name: 'field', param: r }) : null;
}
export function arrayOf(t) {
  const r = asRef(t);
  return r ? Object.freeze({ name: 'array', param: r }) : null;
}

// ---------------------------------------------------------------- default values
// Every implemented type has a zero value, so an unconnected input always has something valid to
// evaluate with. This is why an unwired graph produces a neutral result rather than an error —
// the same "unrecognized/incomplete -> neutral, never confidently wrong" convention the effect
// compiler already follows.
export function defaultValue(t) {
  const r = asRef(t);
  if (!r) return null;
  switch (r.name) {
    case 'float': return 0;
    case 'int': return 0;
    case 'bool': return false;
    case 'string': return '';
    case 'vector2': return [0, 0];
    case 'vector3': return [0, 0, 0];
    case 'vector4': return [0, 0, 0, 0];
    case 'color': return [1, 1, 1, 1];
    case 'quaternion': return [0, 0, 0, 1];
    case 'transform': return { p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
    case 'matrix4': return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    case 'curve': return { kind: 'float', keys: [] };
    case 'gradient': return { kind: 'color', stops: [] };
    case 'array': return [];
    case 'field': return null; // fields.js's constantField() is the real default — see below
    // A missing geometry is NULL, not an empty container, and every function in geometry.js treats
    // null as empty (pointCount(null) is 0, joinGeometry passes the other side through). Returning a
    // literal empty geometry here instead would mean this module knowing geometry.js's shape, and
    // geometry.js already depends on this one — the import would be circular.
    case 'geometry': return null;
    case 'instanceSet': return null;
    case 'emitter': case 'collider': case 'attributeWrite': case 'renderCommand': return null;
    case 'texture2d': return null;
    case 'material': return null;
    case 'any': return null;
    default: return null;
  }
}

// ---------------------------------------------------------------- conversions
// Table entries are [fromName, toName] -> { cost, convert }. Costs are ordinal, not physical:
// 0 identity, 1 exact widening, 2 structural/broadcast, 3 lossy, 5 unchecked (`any`).
const CONVERSIONS = new Map();
function conv(from, to, cost, convert) {
  CONVERSIONS.set(`${from}>${to}`, { cost, convert });
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// numeric ladder
conv('int', 'float', 1, (v) => num(v));
conv('bool', 'float', 1, (v) => (v ? 1 : 0));
conv('bool', 'int', 1, (v) => (v ? 1 : 0));
conv('float', 'int', 3, (v) => Math.round(num(v)));
conv('float', 'bool', 3, (v) => num(v) !== 0);
conv('int', 'bool', 3, (v) => num(v) !== 0);

// scalar -> vector/color broadcast
conv('float', 'vector2', 2, (v) => [num(v), num(v)]);
conv('float', 'vector3', 2, (v) => [num(v), num(v), num(v)]);
conv('float', 'vector4', 2, (v) => [num(v), num(v), num(v), num(v)]);
conv('float', 'color', 2, (v) => [num(v), num(v), num(v), 1]);
conv('int', 'vector3', 2, (v) => [num(v), num(v), num(v)]);
conv('int', 'float', 1, (v) => num(v));

// vector widening (never narrowing — see the header)
conv('vector2', 'vector3', 2, (v) => [num(v?.[0]), num(v?.[1]), 0]);
conv('vector2', 'vector4', 2, (v) => [num(v?.[0]), num(v?.[1]), 0, 0]);
conv('vector3', 'vector4', 2, (v) => [num(v?.[0]), num(v?.[1]), num(v?.[2]), 0]);

// vector <-> color. vector3->color takes rgb with opaque alpha; vector4<->color is the same four
// numbers, so it is exact in both directions.
conv('vector3', 'color', 2, (v) => [num(v?.[0]), num(v?.[1]), num(v?.[2]), 1]);
conv('vector4', 'color', 1, (v) => [num(v?.[0]), num(v?.[1]), num(v?.[2]), num(v?.[3])]);
conv('color', 'vector4', 1, (v) => [num(v?.[0]), num(v?.[1]), num(v?.[2]), num(v?.[3])]);
conv('color', 'vector3', 2, (v) => [num(v?.[0]), num(v?.[1]), num(v?.[2])]);

// rotation representations
conv('quaternion', 'transform', 2, (v) => ({ p: [0, 0, 0], q: [num(v?.[0]), num(v?.[1]), num(v?.[2]), v?.[3] ?? 1], s: [1, 1, 1] }));
conv('vector3', 'transform', 3, (v) => ({ p: [num(v?.[0]), num(v?.[1]), num(v?.[2])], q: [0, 0, 0, 1], s: [1, 1, 1] }));

// A curve is a function of one parameter; sampling it needs a parameter, which only an explicit
// node can supply. So there is deliberately no curve->float / curve->field conversion here.

// findConversion(from, to) -> { cost, convert } | null. Handles identity, the table, `any`, and
// the two structural wrappers.
export function findConversion(fromT, toT) {
  const from = asRef(fromT), to = asRef(toT);
  if (!from || !to) return null;
  if (sameType(from, to)) return { cost: 0, convert: (v) => v };

  // `any` in either position: pass through unchecked. Highest cost so a real match always wins.
  if (to.name === 'any' || from.name === 'any') return { cost: 5, convert: (v) => v };

  // field<A> -> field<B> when A -> B. The wrapper is preserved and the inner conversion is
  // applied lazily per sample, so lifting never forces a field to be evaluated eagerly.
  if (from.name === 'field' && to.name === 'field') {
    const inner = findConversion(from.param, to.param);
    if (!inner) return null;
    return {
      cost: inner.cost,
      convert: (v) => (v && typeof v.sample === 'function'
        ? { __field: true, type: to.param, sample: (ctx) => inner.convert(v.sample(ctx)) }
        : v),
    };
  }

  // T -> field<T'>: the constant lift. This is what lets every field-consuming input also accept
  // a plain number, which is most of why the engine feels composable rather than fussy.
  if (to.name === 'field' && from.name !== 'field') {
    const inner = findConversion(from, to.param);
    if (!inner) return null;
    return {
      cost: inner.cost + 1,
      convert: (v) => {
        const lifted = inner.convert(v);
        return { __field: true, type: to.param, constant: lifted, sample: () => lifted };
      },
    };
  }

  // array<A> -> array<B>, and T -> array<T> (singleton).
  if (from.name === 'array' && to.name === 'array') {
    const inner = findConversion(from.param, to.param);
    if (!inner) return null;
    return { cost: inner.cost, convert: (v) => (Array.isArray(v) ? v.map(inner.convert) : []) };
  }
  if (to.name === 'array' && from.name !== 'array') {
    const inner = findConversion(from, to.param);
    if (!inner) return null;
    return { cost: inner.cost + 2, convert: (v) => [inner.convert(v)] };
  }

  return CONVERSIONS.get(`${from.name}>${to.name}`) || null;
}

export function canConvert(fromT, toT) {
  return !!findConversion(fromT, toT);
}

// canConnect is deliberately WIDER than canConvert, and the difference is the engine's central
// mechanism rather than a leniency.
//
// A `field<X>` output plugged into a plain `Y` input is legal whenever X converts to Y, because the
// evaluator LIFTS the receiving node: its evaluate() is re-run per sample point and its output
// becomes a field (see evaluator.js's automatic field lifting). So `Position -> Length -> Multiply`
// wires up even though nothing in that chain mentions fields, and the result is a field<float>.
//
// There is no value-level `field<X> -> X` conversion, and there must not be: unwrapping a field
// requires a sample point, which only exists inside a per-element loop. Keeping that out of the
// CONVERSION table while allowing it as a CONNECTION is what stops a field from being silently
// collapsed to its value at some arbitrary point.
export function canConnect(fromT, toT) {
  if (canConvert(fromT, toT)) return true;
  const from = asRef(fromT), to = asRef(toT);
  if (!from || !to) return false;
  if (from.name === 'field' && to.name !== 'field') return canConvert(from.param, to);
  // An array of fields feeding a plain multi-input lifts the same way, one element at a time.
  if (from.name === 'array' && from.param?.name === 'field' && to.name !== 'field') {
    return canConvert(from.param.param, isArrayType(to) ? to.param : to);
  }
  return false;
}

// Convert a value, or return it untouched when no conversion exists (the caller has already
// validated connectability — this is the runtime half, and it must never throw mid-evaluation).
export function convertValue(value, fromT, toT) {
  const c = findConversion(fromT, toT);
  return c ? c.convert(value) : value;
}

// ---------------------------------------------------------------- generic unification
// Unify a signature type (which may contain generic variables) against a concrete type, filling
// `bindings`. Returns true on success. Used by the evaluator to resolve one `Add` implementation
// across float/vector3/color/field<...> — see registry.js's generic contract.
//
// A generic binds to the concrete type MINUS any field wrapper, and the wrapper is recorded
// separately (bindings.__lifted) so the evaluator knows to run the node per-sample. That is the
// whole mechanism behind "every pointwise node works on fields for free".
export function unify(signatureT, concreteT, bindings) {
  const sig = asRef(signatureT), got = asRef(concreteT);
  if (!sig || !got) return false;

  if (isGeneric(sig)) {
    // A field flowing into a generic slot binds the generic to the field's INNER type and marks
    // the call as lifted.
    let bindTo = got;
    if (isFieldType(got)) {
      bindTo = got.param;
      bindings.__lifted = true;
    }
    const existing = bindings[sig.name];
    if (!existing) { bindings[sig.name] = bindTo; return true; }
    if (sameType(existing, bindTo)) return true;
    // Two different concrete types landed on the same variable: keep whichever the other can
    // convert INTO, so `add(float, vector3)` resolves T = vector3 rather than failing.
    if (canConvert(existing, bindTo)) { bindings[sig.name] = bindTo; return true; }
    if (canConvert(bindTo, existing)) return true;
    return false;
  }

  if (sig.name !== got.name) {
    // Not a structural match. Allowed only if the concrete type can convert into the signature's
    // — with generics inside the signature, that check has to wait for full resolution, so a
    // signature containing a variable under a mismatched wrapper is simply not unifiable.
    if (containsGeneric(sig)) return false;
    return canConvert(got, sig);
  }
  if (!sig.param && !got.param) return true;
  if (!sig.param || !got.param) return false;
  return unify(sig.param, got.param, bindings);
}

export function containsGeneric(t) {
  const r = asRef(t);
  if (!r) return false;
  return isGeneric(r) || (r.param ? containsGeneric(r.param) : false);
}

// Substitute resolved bindings back into a signature type. Unbound variables fall back to
// `float`, which keeps a partially-wired node evaluable instead of erroring.
export function substitute(t, bindings) {
  const r = asRef(t);
  if (!r) return null;
  if (isGeneric(r)) return bindings[r.name] || parseType('float');
  if (!r.param) return r;
  return Object.freeze({ name: r.name, param: substitute(r.param, bindings) });
}
