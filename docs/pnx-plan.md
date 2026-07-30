# Cadence Procedural Node Engine (PNX) — audit + implementation plan

This is the mapping document between the procedural-VFX-engine specification and the Cadence
codebase as it actually exists. Written before any implementation code, per the spec's own
instruction. `docs/vfx-studio.md` remains the narrative for the *current* shipped VFX system;
this file is the plan for what replaces its authoring core.

Name: **PNX** (procedural node engine). Lives in `renderer/js/pnx/`. Chosen so it can coexist
with the existing `nodeGraphModel.js` v1 graph without either shadowing the other during
migration.

---

## 1. Audit — what exists today

### 1.1 The evaluation core

| Module | Lines | What it is |
| --- | --- | --- |
| `renderer/js/vfx.js` | 227 | `sampleParticles()` — a **closed-form analytic** particle sampler. A particle's position is a pure function of its spawn frame, a hash of its spawn index, and its age. Replays from frame 0 on every call. Six hardcoded "motions". |
| `renderer/js/effectEngine.js` | 390 | `sampleEffect(doc, frame, opts)` — pure. Walks layers, dispatches a hardcoded `switch` over 8 modifier types, returns `{particles, shapes, lights, screen, shake, sounds, stats}`. |
| `renderer/js/effectModel.js` | 489 | The Effect document: 6 layer types, 8 modifier types, per-prop curves with the animator's easing vocabulary, expressions, `resolveProp()` (expr → curve → base). |
| `renderer/js/expr.js` | 275 | A real recursive-descent expression parser compiled to a closure tree. CSP-safe (no `eval`). Deterministic `noise()`/`rand()`. ~20 functions. |
| `renderer/js/easing.js` | 347 | The shared easing/Bézier vocabulary (also the animator's). |
| `renderer/js/cf.js` | 227 | CFrame math on flat 12-arrays: `mul`, `mirror`, `rotationBetween`, `axisAngle`, `rotateVector`. Zero imports — the established pure-math leaf. |
| `renderer/js/effectShapes.js` | 249 | 14 shape primitives with `shapePoint(shape, u, v)` and `shapePolyline()`. |
| `renderer/js/rampEval.js` | 58 | Multi-stop gradient/ramp evaluation. |

### 1.2 The existing node graph (v1)

| Module | Lines | What it is |
| --- | --- | --- |
| `renderer/js/nodeGraphModel.js` | 181 | Graph document + node-type registry + `connect()` with cycle rejection. **One socket kind exists: `'flow'`.** No value types, no dataflow, no groups. |
| `renderer/js/nodeTypes.js` | 124 | **8 nodes.** Each `compile()` mutates `ctx.layer` via `setLayerProps`/`addModifier`. |
| `renderer/js/graphCompiler.js` | 73 | Walks backward from Output nodes to Create nodes along linear chains; compiles into an Effect doc. No caching, no dirty propagation. |
| `renderer-vfx/js/nodeEditor.js` | 593 | The canvas: DOM node boxes in a `transform`ed world container, SVG wire overlay, pan/zoom, box-select, comments, copy/paste, add menu. |

### 1.3 Everything downstream of the Effect doc

- `renderer-vfx/js/preview.js` (281) — three.js. Pooled **sprites** per emitter layer, shape meshes, point lights, a 2D canvas screen-FX overlay, camera shake. No trails/ribbons/beams/volumes/custom materials.
- `renderer/js/effectExport.js` (526) — bakes to a self-contained Luau LocalScript. Already carries an explicit degrade contract.
- `renderer/js/diagnostics.js` (105) — the validator **framework**: `registerValidator`, `registerAutoFix`, `runValidation(scope, ctx)`, structured `Diagnostic` records with stable ids, `applyAutoFixes`.
- `renderer/js/effectValidators.js` (535) — the effect validator pack + `performanceReport`.
- `renderer-vfx/js/studioState.js` (278) — snapshot undo (`structuredClone` of doc + graph), debounced autosave, `mutate`/`mutateGraph`/`beginGesture`, continuous validation.
- `mcp-server/index.js` (712) — 104 tools, 28 of them `vfx_*`. **Zero graph tools.** Two graph hooks exist but are deliberately test-only (`vfx_graph_test_compile`, `vfx_graph_test_apply`).
- `test/coretest.mjs` (497) — plain-Node tests for the pure modules. The fast iteration loop. `test/smoketest.js` (1259) is the in-app integration pass.

---

## 2. The four findings that shape the plan

**(a) There is no simulation engine.** Everything is closed-form analytic. That is a hard blocker
for spec Parts 26–33 (forces/integration, collisions, neighbour interaction, fluids, pyro,
volumes) — none of them can be expressed as a function of `(spawnFrame, hash, age)`.

But determinism under scrubbing is a load-bearing invariant of the entire app: the timeline,
onion skin, `render_frame`, and export baking all assume "same frame in, same result out". So the
solver must be **stateful integration plus a frame cache with deterministic replay from a known
state** — never "abandon determinism to get simulation". Scrubbing backward re-runs from the
nearest cached state; scrubbing forward advances. That is the design in Part 28 of the spec and it
is compatible with what this app already promises.

**(b) The v1 graph is not a dataflow graph.** One untyped socket kind, and node parameters can
never be fed by a connection. Spec Parts 3–4 require a real typed runtime. This gets **replaced**,
not extended — but v1 graph documents must keep loading (§5).

**(c) The Effect doc is the current universal interchange, and it is the ceiling.** Preview,
export, validation, MCP, and the animator's `effect` items all speak it. Compiling the v1 graph
into it was the right call for v1 — it bought a whole runtime for free. But an Effect doc can only
express what its 6 layer types and 8 modifiers express, so a general procedural engine *cannot*
compile down to it without amputation. Therefore: **PNX evaluates its own output**, and the Effect
doc becomes one of several *bake targets* (`pnx/targets/effectDoc.js`), which is what keeps the
existing preview/export/animator path alive during the whole transition.

**(d) Several existing subsystems map onto the spec almost exactly and must be reused, not
reinvented:**

| Spec part | Already exists as |
| --- | --- |
| 52 / 57 / 61 (debugging, export report, AI verification) | `diagnostics.js`'s validator + auto-fix registry, with stable diagnostic ids |
| 56 (support classification NATIVE/CONVERTED/APPROXIMATED/BAKED/UNSUPPORTED) | `MODIFIER_TYPES[].exportMode` (`baked`/`scheduled`/`approximated`/`dropped`) + `layerExportFidelity()` |
| 10 (curves, Bézier easing) | `easing.js` + `effectModel.js`'s curve keys — spec explicitly says integrate, don't duplicate |
| 6 (math nodes) | `expr.js`'s function table and its determinism discipline |
| 14 (seeded randomness) | the `hash01(a,b)` convention used identically in `vfx.js`, `effectEngine.js`, `expr.js` |
| 8 (transforms) | `cf.js` |
| 9 (color) | `rampEval.js` + `effectModel.js`'s `lerpHex` |
| 76 (testing) | `test/coretest.mjs` |

---

## 3. Architecture

```
pnx/types.js        type system: descriptors, generics, implicit conversions
pnx/values.js       value constructors + arithmetic per type
pnx/fields.js       Field<T> — the lazy, sample-point-parameterised value
pnx/registry.js     versioned node registry (cadence.math.multiply@1), search, docs
pnx/graph.js        graph document, groups, serialization, migration, cycles
pnx/evaluator.js    typed pull evaluation, caching, dirty propagation, profiling, errors
pnx/nodes/*.js      node families — one module per category
pnx/targets/*.js    bake targets (effectDoc, luau, textures, caches)
```

### 3.1 Two evaluation regimes — the central design decision

- **Graph-time (eager, cached):** scalars, vectors, colours, curves, geometry, settings. Pull-based
  from the requested output, memoized per `(node, socket, epoch)`, invalidated by dirty
  propagation over reverse reachability.
- **Sample-time (lazy):** `Field<T>`. A field node's graph-time output is a *compiled sampler
  closure*, and the particle/geometry/render stage invokes it per element with a sample context
  (`position`, `normal`, attributes, `age`, `time`, …).

This is what makes the engine general rather than a bigger pile of properties. `Position → Noise →
Color Ramp → Emission` works because every stage is a field transform evaluated per-element, not a
value computed once.

### 3.2 Generics + automatic field lifting — the answer to Part 79

A node declares type variables rather than one signature per concrete type:

```js
{ id: 'cadence.math.add', version: 1,
  generics: { T: { kinds: ['float','vector2','vector3','vector4','color'] } },
  inputs:  [ { key:'a', type:'T' }, { key:'b', type:'T' } ],
  outputs: [ { key:'out', type:'T' } ],
  evaluate: (ctx, i) => V.add(i.a, i.b) }
```

Two mechanisms sit on top:

1. **Generic resolution.** `T` is unified from whatever is actually connected, so one `Add`
   implementation serves float/vector2/vector3/vector4/color.
2. **Automatic field lifting.** If any resolved input is a `Field<X>` where the signature wanted
   `X`, the evaluator wraps `evaluate()` in a per-sample closure and the output type becomes
   `Field<X>` — *without the node knowing fields exist*. One implementation therefore covers the
   scalar case and the field case for every pointwise node in the engine.

Together these are why the spec's ~600 listed operations do not require ~600 hand-written nodes.

### 3.3 Determinism

Seeds derive from a **stable structural path hash** (node id, plus group path, plus an explicit
seed input), never from evaluation order or array index. Spec Part 14's requirement — "changing
unrelated graph portions should not unpredictably alter deterministic procedural effects" — is
therefore a property of the seeding scheme rather than a discipline callers must remember.

---

## 4. Dependency order (the actual build order)

Phase numbering follows the spec's Part 77. What is *not* yet started is marked so plainly, per
Part 78 (no fake features).

| Phase | Content | Status |
| --- | --- | --- |
| 1 | Graph runtime, type system, serialization, node registry, socket system, evaluation, groups, undo integration | **done** |
| 2 | Math, vector, transform, colour, curves, time, logic, random | **done** (rides on Phase 1's generics) |
| 3 | Attributes, fields, noise, patterns, SDFs | **done** |
| 4 | Geometry, curve geometry, sampling, instancing | **done except Part 22 mesh editing** — see §6 |
| 5 | Particles, forces, the staged solver, events, collisions | **next** — this is where the analytic sampler is superseded (§2a) |
| 6 | Renderers, materials, lights, trails/ribbons/beams | not started |
| 7 | Textures, shader graph, compositing | not started |
| 8 | Volumes, fluid foundation, pyro | not started. **Interface + architecture only when it is.** A CPU grid solver at useful resolutions is not viable in this renderer; the backend gets defined and left explicitly unimplemented rather than faked |
| 9 | Baking, Roblox exporter, compatibility analyser | not started — will reuse the existing `exportMode` contract |
| 10 | MCP control, verification, profiling, documentation | not started |
| 11 | Node library, node groups, examples, education hooks | not started |

### 4.1 What is actually built, as of the end of Phase 4

**304 node types across 15 modules, 129 Node-level tests** (`node test/pnxtest.mjs`, ~1s, no Electron).

PNX is **not yet wired into the app**: nothing in `renderer/js/app.js`, `renderer-vfx/` or `src/`
imports it. That is deliberate for Phases 1–4 (§5.1) and is what Phases 6 and 10 change. Consequently
nothing a user can currently click has changed, and no existing project, preset or export path has
been touched.

| Module | Contents |
| --- | --- |
| `types.js` `values.js` `fields.js` | type system + conversions + generic unification; value representations per type; `Field<T>` and its spatial algebra (warp, blur, gradient, curl) |
| `registry.js` `graph.js` `evaluator.js` | versioned registry with search + introspection; graph document, groups, serialization, migration, cycle rejection; pull-based cached evaluation with generics, automatic field lifting, dirty propagation, profiling |
| `noisecore.js` `geometry.js` | noise bases (white/value/perlin/simplex/voronoi) + fractal layering; attribute tables and the point/curve/face domain model |
| `nodes/math` `vector` `transform` `color` `curve` `time` `logic` `random` | Phase 2 |
| `nodes/noise` `pattern` `sdf` `fields` `attribute` | Phase 3 |
| `nodes/geometry` `sampling` | Phase 4 |
| `nodes/debug` | Part 52 observability — always available, always pass-through |

Three mechanisms carried that node count without copy-paste (Part 79): generic type variables,
automatic field lifting, and the `pointwise1/2/3` declaration helpers. `cadence.math.add` is ONE
implementation serving float/int/vector2/vector3/vector4/colour **and** fields of all six.

### 4.2 Decisions taken during implementation that the audit did not anticipate

- **One `geometry` type, not four.** The spec lists Mesh, CurveGeometry and PointCloud separately. As
  separate types the compositions the spec asks for become unrepresentable — joining a curve to a mesh
  would have no type at all, and `Points On Surface` → `Instance On Points` could not be wired. A
  geometry is a container of point/curve/face domains; a node that needs faces asks whether there are
  faces. Reasoning recorded in `types.js`.
- **`canConnect` is deliberately wider than `canConvert`.** A `field<X>` output plugged into a plain
  `Y` input is legal, because the evaluator LIFTS the receiving node. There is deliberately no
  value-level `field<X> -> X` conversion: unwrapping a field needs a sample point, which exists only
  inside a per-element loop. Keeping that out of the conversion table but allowing it as a connection
  is what stops a field being silently collapsed to a single value.
- **`defaultFrom` sockets.** An unconnected input may fall back to something the evaluation context
  knows — the clock for a time input, the point being evaluated for a position input — rather than to a
  literal. Without it, every spatial node silently collapses onto the origin and every time-reshaping
  node sits frozen at 0 until the user draws the one obvious wire by hand. This is what makes Part 11
  and Part 18 composable rather than fussy.
- **Attribute writes are records, not mutations.** `Set Attribute` yields `{__attrWrite, name, value}`
  for a consuming stage to apply. Graph evaluation is cached and re-entrant; a node that mutated
  shared state would produce different results depending on how often the cache happened to call it —
  precisely the class of bug that makes a scrubbing timeline non-deterministic.
- **Per-element randomness is a `field<T>`, not a number.** One particle's random size must not be
  every particle's random size.
- **Constructors let NaN through; `sanitize()` repairs it.** The evaluator NaN-checks every value
  crossing a socket so it can name the node responsible. A constructor that quietly zeroed NaN would
  leave a transform silently snapped to the origin with no diagnostic — the exact failure the check
  exists to prevent.

## 5. Migration and compatibility

Non-negotiables from Part 1, and how each is met:

1. **Existing projects load.** PNX is additive — new files only. `effectModel.js`,
   `effectEngine.js`, `vfx.js`, `preview.js`, `effectExport.js` are not modified in Phase 1–4.
2. **Existing presets work.** `effectLibrary.js`'s archetypes and `particleLibrary.js` are
   untouched; they produce Effect docs, which remain valid.
3. **v1 graphs keep opening.** `nodeGraphModel.js`/`nodeTypes.js`/`graphCompiler.js` stay live.
   A `pnx/migrate/v1graph.js` converts a v1 graph into a PNX graph (each of the 8 v1 nodes has a
   direct PNX equivalent or a small node group), and `studioState.js`'s save wrapper gains a
   discriminated `pnxGraph` field so both formats round-trip.
4. **Nothing silently degrades on export.** The existing `exportMode` column generalises to the
   spec's five-level classification; the export report (Part 57) is built from it.
5. **Node identity is versioned from day one** (`cadence.math.multiply@1`), with a migration hook
   per node type, so Part 66 is satisfied before there is anything to migrate.

## 6. Known limitations to state plainly, not paper over

- **Mesh editing (Part 22) is NOT built, and is not stubbed.** Extrude, Inset, Bevel, Subdivide,
  Triangulate, Decimate, Weld, Bridge, Fill and the three Boolean operations need half-edge or
  BMesh-style *connectivity*, and a plausible-looking version written against a bare triangle soup
  produces cracked normals, duplicated vertices and non-manifold output that surfaces only on export.
  Per Part 78 there is no button for them: `geometry.js`'s domain model is what a connectivity layer
  would be built on, and until that layer exists the operations are absent from the catalogue.
  What *is* built is Part 42's deformation family, which needs no connectivity because it only moves
  points — and it is one node (`Set Position` driven by a field), not fifteen, because bend, twist,
  taper, bulge, wave, ripple, melt and noise-displace are all "move each point by a field".
- **Nearest-point, attribute transfer and raycast are brute force.** They cost O(points) or O(faces)
  *per sample*, which is fine for hundreds and expensive for tens of thousands sampled per particle.
  Part 27's spatial acceleration structures are the fix and belong with the particle-interaction work
  in Phase 5; the nodes declare `performance: 'expensive'` so the profiler and the docs say so now.
- **Volumetric pyro/fluid (Parts 31–33, 35).** Interfaces and data model only. A real grid solver
  plus raymarching is out of reach for this renderer at usable resolutions; it will be marked
  unimplemented in the UI and in the export classification.
- **GPU compute (Parts 53–54).** The execution-backend seam is designed so CPU and a future GPU
  backend can coexist. Only the CPU backend gets built.
- **Roblox output (Parts 56–58).** Roblox cannot reproduce most of this natively. That is expected
  and is exactly why the classification and export report exist. Cadence's authoring capability is
  deliberately not limited to what Roblox can run.
- **The current preview renderer draws sprites, meshes and point lights only.** Trails, ribbons,
  beams, decals and volumes need new renderer backends (Phase 6), not new node types.
