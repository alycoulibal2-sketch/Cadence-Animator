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
| 5 | Particles, forces, the staged solver, collisions | **done except sub-emission** — the analytic sampler is superseded (§2a). Part 12's event graph is a documented seam, not a feature; see §6 |
| 6 | Renderers, materials, lights, trails/ribbons/beams | **done** — plus the three.js backend and the studio wiring |
| 7 | Textures, shader graph, compositing | not started |
| 8 | Volumes, fluid foundation, pyro | not started. **Interface + architecture only when it is.** A CPU grid solver at useful resolutions is not viable in this renderer; the backend gets defined and left explicitly unimplemented rather than faked |
| 9 | Baking, Roblox exporter, compatibility analyser | not started — will reuse the existing `exportMode` contract |
| 10 | MCP control, verification, profiling, documentation | **done** — 22 `pnx_*` tools; docs are per-node and served from the registry |
| 11 | Node library, node groups, examples, education hooks | not started |

### 4.1 What is actually built, as of the end of Phase 4

**326 node types across 17 modules, 166 Node-level tests** (`node test/pnxtest.mjs`, ~3s, no Electron), plus **7 in-app integration steps** in `test/smoketest.js`.

PNX **is wired into the app**. A procedural effect is a third document mode in the VFX studio,
exclusive with the two that existed (hand-edited layers, and the v1 node graph) — reachable from the
preset browser's "✨ Start a Procedural Effect", and from `pnx_new` over MCP. It renders through its own
three.js backend, and no existing project, preset or export path was modified to make that work.

| Module | Contents |
| --- | --- |
| `types.js` `values.js` `fields.js` | type system + conversions + generic unification; value representations per type; `Field<T>` and its spatial algebra (warp, blur, gradient, curl) |
| `registry.js` `graph.js` `evaluator.js` | versioned registry with search + introspection; graph document, groups, serialization, migration, cycle rejection; pull-based cached evaluation with generics, automatic field lifting, dirty propagation, profiling |
| `noisecore.js` `geometry.js` | noise bases (white/value/perlin/simplex/voronoi) + fractal layering; attribute tables and the point/curve/face domain model |
| `nodes/math` `vector` `transform` `color` `curve` `time` `logic` `random` | Phase 2 |
| `nodes/noise` `pattern` `sdf` `fields` `attribute` | Phase 3 |
| `nodes/geometry` `sampling` | Phase 4 |
| `solver.js` `nodes/particles` | Phase 5 |
| `render.js` `nodes/render` | Phase 6 — materials, render commands, the resolve pass |
| `renderer-vfx/js/pnxBackend.js` | Phase 6 — the ONLY file in the engine that knows three.js exists |
| `renderer-vfx/js/pnxStudio.js` | the studio session: one long-lived evaluator, the frame→draw-list pipeline, reporting |
| `renderer-vfx/js/pnxMcp.js` | Phase 10 — 22 structured graph/introspection/verification handlers |
| `nodes/debug` | Part 52 observability — always available, always pass-through |

Three mechanisms carried that node count without copy-paste (Part 79): generic type variables,
automatic field lifting, and the `pointwise1/2/3` declaration helpers. `cadence.math.add` is ONE
implementation serving float/int/vector2/vector3/vector4/colour **and** fields of all six.

### 4.3 The solver, and why phase 5 added so few nodes

A literal reading of Parts 25–30 counts about a hundred nodes: Gravity, Drag, Wind, Turbulence, Curl
Force, Vortex, Attract, Repel, Orbit, Seek, Follow Field, Follow Curve, plus a collider per shape.
Phase 5 added **ten**, and that is the design working rather than a shortfall:

- Every **position-dependent force** is already a vector field from Part 19. Gravity is Constant
  Direction; wind is Constant Direction plus Noise; turbulence is Curl Noise. So `Force` on the
  Simulate node is one `field<vector3>` input and `Add` combines them.
- Every **collider shape** is already an SDF from Part 20, and the contact normal is that field's
  gradient. One Collider node covers plane/sphere/box/capsule and anything composed from them.
- Every **emitter shape** is already geometry plus the phase-4 samplers. One `geometry` input and a
  mode covers spawn-from points/surface/volume/curve.

What phase 5 had to add is what genuinely cannot be expressed otherwise: the staged solver itself, and
the two forces that are functions of a particle's **velocity** rather than of its position (Drag Force,
Seek) — a field is evaluated at a point in space and cannot see what is passing through it.

**Determinism under scrubbing** is the property the whole design exists for, since the timeline, onion
skin, `render_frame` and export baking all assume "same frame in, same result out". Stateful
integration plus checkpoint replay delivers it: every route to frame *f* runs the same steps from the
same start. The test asserts this across four routes — straight forwards, past-and-back, a jittery
eight-hop scrub, and a fresh simulation — comparing every particle's id, position, velocity and age.

Three things it rests on, none of them relaxable: fixed timestep from the frame rate; no `Math.random`
anywhere; and particle ids assigned from a counter that is part of the checkpointed state, so a replay
hands the same particle the same id and therefore the same seed.

**Frame convention:** frame `startFrame` is the untouched initial state at t=0, so frame N is exactly
(N − startFrame) steps of dt. Counting from −1 instead runs one extra step per seek — which showed up
as gravity reading −10.33 studs/s after one second at 10 studs/s².

**Measured cost** (20 000 particles, 30 frames, this machine):

| Force | Per frame | Backward scrub |
| --- | --- | --- |
| constant (gravity) | 13.9 ms | ~0 ms from a checkpoint |
| curl noise | 96 ms | ~1 ms |

Curl noise dominates because each sample is six FBM evaluations. It declares
`performance: 'expensive'` so the profiler and the docs say so before a user finds out. State is
`Float32Array` (48 bytes per particle across the eight core attributes); 20 000 particles with
checkpoints is about 3.7 MB.

### 4.4 Rendering, and what the wiring actually required

**Part 36's separation is the design.** A renderer node draws nothing; it emits a *render command*
(what to draw, how, with which material). `render.js`'s resolve pass turns commands into flat
Float32Arrays with no API calls in them, and a backend consumes those. So the same particles render as
sprites, meshes, trails, ribbons, beams or lights by swapping one node, and a Roblox exporter or a bake
will consume the identical draw list without reimplementing any evaluation. `pnxBackend.js` is the only
file in the whole engine that imports three.js.

**Materials are channel bags, not fixed properties.** Part 34 lists eighteen inputs; each is a
`field<...>`, and a backend honours the subset it can and *reports* the rest (Part 57). Defining the
material by the poorest backend's abilities would make Cadence's authoring ceiling equal to Roblox's,
which Part 2 forbids. `Advanced Material Channels` exists as a separate node precisely because no
backend honours transmission/refraction/IOR yet — it carries them and says so, rather than silently
doing nothing.

**There is no "over lifetime" property anywhere.** Normalized Age → Gradient → Base Colour is the
pattern, and the same three nodes give size over lifetime, opacity over distance or emission over
speed. The starter graph demonstrates it rather than describing it.

**What wiring turned out to require, beyond drawing:**

- **A third document mode, not a conversion.** A PNX effect does not compile to an Effect doc (§2c), so
  `state.pnx` is exclusive with `state.doc`-authoring and `state.graph`. Save format gained a
  discriminated `cadenceStudioSave: 2`; v1 graphs and bare Effect docs still load byte-identically.
- **One long-lived evaluator per graph.** A simulation's state lives in the evaluator, so constructing
  a fresh one per frame would restart every particle system on every frame. The invalidation contract
  is the load-bearing part: a playhead move calls `setTime()` (time-dependent cache only, simulations
  survive); a graph edit calls `invalidateNode()`; replacing the graph object clears everything.
- **The UI must not lie about which document is in charge.** The inspector, the timeline track column
  and the name field all read the Effect doc. Left alone in procedural mode they showed a
  "Spawn Particles" layer with editable Rate/Lifetime/Gravity fields that changed nothing — controls
  that pretend to work, which Part 78 forbids as squarely as a fake feature does. Each now shows what
  is really in charge. The Lua export and Send-to-Animator paths are blocked with an explanation for
  the same reason: `doc` is not what is being drawn, so exporting it would ship the wrong effect.

### 4.5 Phases 7-11: the decisions worth recording

**Field probing (phase 9) is the technique the exporter rests on.** A field is an opaque closure, so
nothing can be read off it — yet the export strategy depends entirely on what a value varies WITH. A
size that varies over a particle's life becomes a Roblox NumberSequence and is exact; one that varies
with position has no Roblox equivalent and forces the whole pass to be baked. `bake.js` answers that by
SAMPLING: vary one input, hold the rest, see whether the output moves. The probe points are deliberately
awkward rather than round, because round numbers are exactly where a periodic or lattice-based field
aliases into looking constant. It is a heuristic and says so; a wrong answer degrades fidelity rather
than correctness, since the fallback is always to bake more than necessary.

**Three types exist where one might seem to do, and the reason is the same each time.** A `field<T>` is
continuous and lazy; a `texture2d` and a `volumeGrid` are discrete and eager. Blur, edge detect, dilate
and 3D diffusion all need NEIGHBOURS, and "neighbour" has no meaning in a continuous field. So
`Rasterize` and `Bake To Volume` are explicit nodes rather than implicit conversions — a user can see
where the resolution was fixed instead of discovering that a chain silently rasterised at 64x64 somewhere
in the middle.

**`volumeGrid` is deliberately NOT `volume`.** The simulated kind stays declared and
`implemented: false`, so `registerNode()` refuses any node whose socket names it. A Pyro or Volume
Renderer button cannot be created by accident — which is a stronger guarantee than a comment, and it is
asserted in a test that tries to register one and expects the refusal.

**Node groups are scopes, not compiled units.** Part 46 requires that a user can enter a group and
inspect every node, so `groups.js` performs bookkeeping on the graph document and nothing else — no
flattening, no specialisation. The intricate part is entirely the boundary: keying group inputs by the
EXTERNAL source (not the internal target) is what makes one external value feeding four inner sockets
produce one shared input rather than four identical ones. Expanding COPIES the interior rather than
moving it, because moving it would empty the group and break every other instance.

**The library registers no node types, and that is the test.** Part 47 states it: a user should be able
to delete the entire library and still build new effects. Each entry is a RECIPE — a list of primitive
node types and the wires between them — re-evaluated against the live registry rather than frozen as a
document, so a group built on `cadence.noise.curl` picks up an improved curl noise and fails loudly if a
node it needs is gone. A test asserts the node count is unchanged after building every recipe.

**A new time primitive fell out of the flipbook.** There are two kinds of time: GRAPH time is the
playhead and is one number for the whole evaluation; SAMPLE time is what the thing being evaluated is
asking about, and a flipbook bake rasterises the same field at successive times. Wiring `Effect Time`
into a flipbook therefore produced a sheet of identical cells, because the field was collapsed before the
flipbook asked for anything. `Sample Time` now exists as a separate node so the distinction is legible
at a glance, and the trap is asserted in a test rather than only documented.

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

## 5.1 Part 75's stress test, as a standing check

The specification's own acceptance criterion is kept as a test rather than as a one-off exercise
(`test/pnxtest.mjs`, "Part 75"). It asserts that the PRIMITIVES each listed effect needs still exist, and
its real value is as a regression guard on the catalogue: renaming or removing a primitive that one of
these compositions depends on now breaks a test instead of being discovered by a user.

**32 of the 34 listed effects are constructible from existing primitives.** The two that are not are
exactly the two the specification itself expects to be blocked:

| Effect | Blocked on |
| --- | --- |
| Realistic fire | The pyro solver (Parts 31–32). Part 32 is explicit that realistic fire must NOT be faked with a preset plus random particles, so it is absent rather than approximated. A STYLISED fire is constructible, which is the distinction Part 32 draws. |
| Realistic cloud | Volume rendering (Part 35). A cloud can be baked into a volume and read as a field; it cannot be raymarched. |

Both are recorded in `volume.js`'s `UNIMPLEMENTED` table, which a test reads — so the day a solver
arrives, that test starts failing and the entry has to move rather than being quietly forgotten.

Part 80's statement of success is the thing this is really measuring: a professional should not need to
ask "does Cadence have this effect", but "how do I construct this effect". For 32 of 34, they can.

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
- **Screen-space compositing is NOT built (Part 41).** Bloom over the final render, motion blur, depth of
  field, chromatic aberration and lens distortion are screen-space passes: they need a render target and a
  post-process chain that reads back the renderer's own output, which the sprite/mesh preview backend
  cannot do. What IS built operates on a texture the graph made — real and useful, and named `Glow`
  rather than `Bloom` to keep the distinction visible.
- **Send-to-Animator still refuses a procedural effect.** The animator's timeline holds Effect docs and a
  procedural graph is not one. Lua export works (phase 9).
- **A baked export is a recording, not a simulation.** It plays back identically every time, and the note
  the exporter emits says so. That is inherent to baking rather than a shortcoming of this one.
- **Volume rendering is absent (Part 35), and cannot be registered by accident.** The `volume` type is
  declared `implemented: false`, so `registerNode()` refuses any node using it — a Volume Renderer
  button cannot exist until the raymarching backend does. Decal is absent for the same reason.
- **The node editor does not yet edit PNX graphs.** `nodeEditor.js` is the v1 canvas; the procedural
  inspector points at it, but per-node PNX parameter editing on the canvas is not built. Everything is
  reachable through the 22 `pnx_*` MCP tools, which is what Part 59 asks for; a human editing a
  procedural graph by hand needs canvas work that is its own piece.
- **Sub-emission is NOT built (Parts 12, 26).** "Spawn On Death" and "Spawn On Collision" need a
  second simulation driven by the first's events, with its own state, checkpoints and determinism
  argument. `solver.js` collects deaths and contacts as data and hands them to a sink, because that
  information exists only inside the step loop — recovering "which particles died this step" from
  outside would mean diffing two states and guessing. **Nothing sets that sink yet and no node exposes
  it**, so nothing in the UI claims it works. The general event bus (Send/Receive/Filter/Sequence/Gate)
  is likewise absent; the `event` type is declared `implemented: false`, which mechanically prevents a
  node being registered against it.
- **Particle interaction is NOT built (Part 27).** Neighbour search, flocking, separation/alignment/
  cohesion and density estimation all need a spatial acceleration structure. The same structure is what
  the brute-force queries below want, so it is one piece of work rather than two.
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
