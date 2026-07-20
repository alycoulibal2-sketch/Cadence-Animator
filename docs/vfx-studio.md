# Cadence VFX Studio — Architecture

VFX Studio is Cadence's standalone visual-effects editor: a separate window where a complete,
multi-layer Roblox effect (particles, shapes, lights, screen effects, camera shake, sound) is
built visually — layers on a clip timeline, every animatable property driven by bezier curves —
then saved, sent into the animator, attached to an animation, and exported to Roblox.

The design constraint everything below follows: **an effect is a pure function of a frame
number.** No persistent simulation state, ever. Scrubbing to frame 40, then 10, then 40 again
must be bit-for-bit identical. This is the same guarantee `vfx.js`'s `sampleParticles` already
gives single emitters, extended to whole effect documents — it's what makes deterministic
preview, onion-skin-style comparison, MCP `vfx_render_frame`, and the validation pipeline all
trustworthy.

## Module map

Shared modules (importable by BOTH the main window and the studio window — must never import
`state.js` or touch `window.cadence` at module load):

| Module | Responsibility |
| --- | --- |
| `renderer/js/effectModel.js` | Effect document schema, defaults, layer/curve/clip/modifier ops, curve evaluation (`evalCurve`), serialization + migration, `LAYER_TYPES` registry |
| `renderer/js/effectShapes.js` | Base-shape system: 14 primitives + custom bezier splines, `shapePoint(shape, u)` sampler, polyline tessellation for meshes |
| `renderer/js/expr.js` | CSP-safe math-expression parser/evaluator for advanced mode (`rate = 120 * sin(t)`) — no `eval`/`new Function` |
| `renderer/js/effectEngine.js` | `sampleEffect(effect, frame, opts)` → render state for every layer type; modifier stack application; the only place layer semantics live |
| `renderer/js/diagnostics.js` | Validation framework: validator registry, structured diagnostics, auto-fix engine, performance report |
| `renderer/js/effectLibrary.js` | Procedural multi-layer effect presets (archetypes × themes × scales) |
| `renderer/js/effectExport.js` | Bake an effect document to a self-contained Roblox LocalScript (Luau) / `.rbxmx` |
| `renderer/js/vfx.js` | (existing) single-emitter particle sampler; gains optional shape-based emission, backward compatible |

Studio window (`renderer-vfx/js/`):

| Module | Responsibility |
| --- | --- |
| `studioState.js` | The open effect doc + selection + playhead; snapshot undo/redo; autosave; save/load `.cfx`; event bus |
| `preview.js` | three.js scene; renders `sampleEffect` output (sprite pools, shape meshes, lights); screen-fx DOM overlay; camera shake |
| `clipTimeline.js` | Canvas clip timeline: one row per layer, drag/move/resize/loop clips, playhead scrub, transport |
| `layersPanel.js` | Layer stack: add/rename/duplicate/reorder/enable/solo/delete |
| `inspector.js` | Typed property editors per layer type; per-prop key ⏺ + curve buttons; modifier stack; advanced mode (raw values + expressions) |
| `curveEditor.js` | Standalone multi-keyframe curve editor for effect docs (value keys over clip-local frames, per-segment easing/bezier) |
| `presetsPanel.js` | Effect + particle preset browser, user presets |
| `mcp.js` | Studio-side MCP command handlers |
| `app.js` | boot + wiring only |

## Effect document schema (version 2)

```js
{
  version: 2,
  id: 'uuid',
  name: 'Sword Slash',
  fps: 30,
  duration: 60,            // frames
  loop: true,              // preview loop default
  layers: [ Layer ],
}

Layer = {
  id: 'uuid',
  type: 'emitter' | 'shape' | 'light' | 'screen' | 'shake' | 'sound',
  name: 'Glow',
  enabled: true,
  solo: false,
  clip: { start: 0, len: 60, loop: false },   // frames, doc space
  props: { ...typed per layer type },          // static base values
  curves: { [prop]: [ { t, v, es, ed, bez } ] }, // t = frames RELATIVE to clip start
  exprs: { [prop]: 'expression string' },      // advanced mode; overrides curve+base when set
  modifiers: [ { id, type, enabled, props } ],
}
```

Curve keys use the exact same easing vocabulary as the animator (`es`/`ed` from `easing.js`,
`bez` = cubic-bezier 4-array) — `evalSegment` is reused, not duplicated. `evalCurve(keys, t,
fallback)`: sorted keys, hold before first / after last, per-segment easing from the LEFT key
(same convention as animator tracks). Color props curve as hex strings lerped in RGB.

Property resolution order for any animatable prop, at clip-local frame `t`:
`expression (if advanced mode set)` → `curve (if keys exist)` → `props base value`.

### Layer types and their props

- **emitter** — the full existing emitter vocabulary (`rate, lifetime, speed, spreadDegrees,
  gravity, sizeStart/End, colorStart/End, transparencyStart/End, shape, motion, blendMode,
  maxParticles`) plus `burst` (particles emitted instantly at clip start), `emissionShape`
  (a shapes-system shape particles spawn across), `offset` ([x,y,z] from effect origin), and
  `colorRamp`/`densityRamp` (SKETCH IT 2.0 — see below): `[{u:0..1, v, es?, ed?, bez?}]`, a real
  multi-stop gradient over particle life-fraction that supersedes the plain Start/End pair when
  it has ≥2 stops (empty array = inactive, falls back to Start/End exactly as before). `u` is
  continuous 0..1 (a particle's own life-fraction), not a clip-local frame like `curves` keys —
  evaluated by `rampEval.js`'s `evalRamp`, the life-fraction-keyed twin of `evalCurve`, kept as
  its own leaf module specifically to avoid a circular import (`effectModel.js` already imports
  `VFX_DEFAULTS` from `vfx.js`). Animatable: rate, lifetime, speed, spreadDegrees, gravity,
  sizeStart, sizeEnd.
- **shape** — a rendered mesh built from the shape system: `shape` (primitive def), `color`,
  `opacity`, `scale`, `rotation` (deg around up axis), `thickness`, `emissive` (additive vs
  normal), `offset`. Animatable: opacity, scale, rotation, thickness. This is the "core" of a
  slash/ring/shockwave.
- **light** — `color`, `intensity`, `range`, `offset`. Animatable: intensity, range.
- **screen** — `kind: 'flash' | 'vignette' | 'speedlines' | 'overlay'`, `color`, `opacity`,
  `density` (speedlines). Animatable: opacity, density. Rendered as a DOM overlay in the studio
  and exported as ScreenGui in Luau; not rendered inside the main animator viewport.
- **shake** — `amplitude` (studs of camera offset), `frequency` (Hz), `roll` (deg). Animatable:
  amplitude. Deterministic noise from frame number.
- **sound** — `soundId` (rbxassetid or empty), `volume`, `pitch`. Fires at clip start on
  playback; deterministic sampling reports `{ shouldBePlaying, tOffset }` rather than playing.

### Modifiers

Modifiers post-process a layer's sampled output, in stack order. All deterministic (hash noise
keyed by particle index/frame — never `Math.random()`):
`noise` (positional turbulence: amount, frequency), `wind` (directional drift: direction,
strength), `pulse` (size/opacity oscillation: amount, frequency), `flicker` (per-particle opacity
jitter: amount), `orbit` (swirl around origin axis: speed, radius), `gradientShift` (hue rotate
over layer time: degrees), `sizeOverLife` / `fadeInOut` (curve-shaped ramps: in, out fractions),
`glowBoost` (size+opacity multiplier: amount). Each modifier declares which layer types it
applies to; `amount`-style props are animatable via the owning layer's curves under
`mod:<modifierId>:<prop>` track names.

## Engine contract

```js
sampleEffect(effect, frame, {
  origin = IDENTITY_CF,     // world CFrame the effect is planted at
  resolveOrigin = null,     // (f) => CF for animated/attached origins (animator integration)
  quality = 1,              // 0..1 particle-count scale for preview perf
}) → {
  particles: [ { pos, size, color, opacity, shape, blendMode, layerId } ],
  shapes:    [ { layerId, shapeDef, color, opacity, scale, rotation, thickness, emissive, offset } ],
  lights:    [ { layerId, color, intensity, range, offset } ],
  screen:    [ { layerId, kind, color, opacity, density } ],
  shake:     { dx, dy, roll },        // summed across shake layers
  sounds:    [ { layerId, soundId, volume, pitch, shouldBePlaying, tOffset } ],
  stats:     { particleCount, liveLayerCount },
}
```

Clip windowing: a layer contributes nothing outside `[start, start+len)`; with `clip.loop`, the
local frame wraps `((f - start) % len)`. Emitter layers sample `vfx.js`'s `sampleParticles` with
an `evalNum` adapter that resolves the layer's curves/expressions, so studio effects and the
animator's plain vfx items share one particle simulation to the digit.

## Expressions (advanced mode)

Tiny recursive-descent parser (CSP forbids `eval`), grammar: numbers, `t` (seconds into clip),
`f` (clip-local frame), `dur` (clip seconds), `value` (what curve/base resolved to), `pi`, `+ -
* / % ^`, parens, unary minus, comparisons + `?:`, and functions `sin cos tan abs floor ceil
round sqrt pow min max clamp lerp sign exp log noise(x) rand(seed) saw(x) tri(x) square(x)`.
Compiled once per string, cached; a parse/eval error surfaces as a diagnostic and falls back to
the curve/base value — an expression must never crash sampling.

## Diagnostics framework

```js
registerValidator({ id, category, appliesTo, run(ctx) → [Diagnostic] })
runValidation(scope, ctx)   // scope: 'object' | 'effect' | 'project' | 'export'
  → { diagnostics, counts: {error, warning, suggestion, info}, blockedForExport, performance }

Diagnostic = {
  id: 'VFX-E003',            // stable code: <AREA>-<E|W|S|I><nnn>
  severity: 'error' | 'warning' | 'suggestion' | 'info',
  category: 'vfx' | 'animation' | 'timeline' | 'curves' | 'performance' | 'export' | ...,
  target: { itemId?, layerId?, track?, modifierId? },
  frame: number | null,
  message: '...',            // human-readable, specific
  causes: ['...'],           // most-likely causes, best first
  fix: { autoFixId, label, safe: true } | null,
  confidence: 0..1,
}
```

Errors block export/send; warnings and below never block. `autoFix(effect, ids?)` applies every
`safe: true` fix (clamping negatives, resizing particle pools, pulling clips back in range,
dropping orphan curve keys, …) and returns `{ applied, skipped, before, after }` so callers can
diff. `performanceReport(effect)` scans every frame for peak/avg particle counts, light and
screen-layer totals, and grades PC/console/mobile budgets.

The animator's existing `validateAnimation` heuristics are wrapped as diagnostics under the
`animation` category so `validate_project` returns one uniform structure for everything.

## MCP surface

Studio commands are routed by `src/main.js` to the studio window (auto-opening it if closed) via
a `sendToVfxRenderer` twin of the existing `sendToRenderer`. Every mutating tool returns
`{ ok, summary, warnings, diagnostics }` — the read-back is built in, Claude never has to assume
a write landed.

Studio tools (`vfx_` prefix): `vfx_open_studio`, `vfx_get_state`, `vfx_get_effect`,
`vfx_new_effect`, `vfx_set_effect_props`, `vfx_add_layer`, `vfx_update_layer`,
`vfx_remove_layer`, `vfx_reorder_layer`, `vfx_set_clip`, `vfx_set_curve`, `vfx_delete_curve`,
`vfx_set_expression`, `vfx_add_modifier`, `vfx_update_modifier`, `vfx_remove_modifier`,
`vfx_list_presets`, `vfx_apply_preset`, `vfx_scrub`, `vfx_render_frame` (screenshot),
`vfx_validate`, `vfx_auto_fix`, `vfx_performance_report`, `vfx_save_effect`, `vfx_load_effect`,
`vfx_send_to_animator`, `vfx_undo`, `vfx_redo`, `vfx_export_luau`.

Animator additions: `validate_project` (all items + timeline, uniform diagnostics),
`get_effect_item`, `set_effect_item` (effect docs on timeline items).

## Animator integration

New item kind `'effect'`: holds a full effect document (`item.effect`), an `@origin` track like
vfx/camera items, `item.effectStart` (doc frame 0 sits at this project frame) and `item.effectLoop`.
`EffectInstance` in `rigbuild.js` renders world layers (particles via pooled sprites, shape
meshes, point lights); screen/shake/sound layers are studio-preview + export only. "Edit in VFX
Studio" round-trips the doc. Send-to-animator from the studio carries the full doc (the v1
single-emitter path stays for plain particle presets). Export to Roblox = `effectExport.js`
Luau script (ParticleEmitters with baked NumberSequences, clip-window Enabled scheduling, burst
`Emit()`, PointLights, ScreenGui flash/vignette, camera-shake RenderStepped loop, Sounds), as
`.lua` file / clipboard / `.rbxmx` LocalScript — same pattern as the camera script exporter.

## Presets

`effectLibrary.js` generates full effect documents: ~22 archetypes (sword slash, explosion,
fireball, portal, aura, heal burst, lightning strike, shockwave, muzzle flash, ground slam, …)
× 6 themes × 3 scales ≈ 400, alongside the existing 396 single-emitter particle presets. Every
generated preset must pass `runValidation` with zero errors — enforced by the smoketest, so the
library can never ship a preset the validator itself would flag.

---

# Design decisions — adopted from the pre-implementation adversarial review

Three independent review lenses (determinism/architecture, Roblox export fidelity, UX/scope) ran
against the draft above before implementation. The contracts below OVERRIDE anything they
contradict in the draft.

## Frame-space contract (the one frame axis)

`sampleEffect` and `sampleParticles` operate in **doc frames** end to end. `resolveOrigin(f)`
always receives doc frames. Clip semantics are implemented entirely inside the engine's per-layer
track adapter passed to `sampleParticles` as `evalNum`:

- **Windowing**: the adapter returns `rate = 0` for any doc frame outside the emission window, so
  a layer *spawns* only inside its clip but already-spawned particles **live out their lifetime**
  past clip end — exactly Roblox's `Enabled = false` decay. Particles are never guillotined.
- **Looping (`clip.loop`)**: the emission window becomes `[start, effect.duration)`; curve/expr
  lookups for a doc frame `f` evaluate at clip-local `(f - start) % len`. Emission is continuous
  across the seam — particles from the previous iteration survive it, exactly like a real looping
  Roblox emitter. There is no pool reset.
- **Burst**: the adapter adds `burst * fps` to the rate exactly at each iteration-start frame
  (`(f - start) % len === 0` inside the window) — this deposits exactly `burst` extra whole
  spawns into the accumulator with no fractional bleed, and re-fires each loop iteration.
- **Animator/project mapping**: `docFrame = floor((projectFrame - item.effectStart) *
  effect.fps / project.fps)`. All sampling (curves, emission quantization, expression `t`/`dur`)
  runs in doc-frame/doc-fps space; export bakes wall-clock seconds from doc fps.

## Per-spawn parameter resolution in vfx.js

`sampleParticles` additionally queries `'@spread'`, `'@gravity'`, `'@sizeStart'`, `'@sizeEnd'`,
`'@transparencyStart'`, `'@transparencyEnd'` through `evalNum` **at each particle's spawn
frame** (fallback: the static `em.*` value — bit-identical for existing projects). Gravity is a
per-spawn constant, preserving the closed-form trajectory; keying gravity affects newly spawned
particles only ("smoke rises, then new smoke gets heavy"), never rewrites past arcs. Colors and
blend/shape/motion are static per layer in v1 — **color props are not animatable** and hex curve
keys have no UI (evalCurve's string-lerp stays as a guard, nothing produces it).

Particle records gain `{ seed, spawnFrame, lf }` (additive; existing consumers unaffected).
Modifiers must hash on `seed` — never on array position, which shifts as particles die/cap.

`quality` (preview-only) = deterministic post-sample decimation: keep particle iff
`hash01(seed, 9999) < quality` — a strict subset of the quality-1 set. `vfx_render_frame`,
validation, and the performance report always sample at quality 1.

## Model op invariants (orphan prevention)

- `removeModifier(layer, id)` deletes every `mod:<id>:*` curve and expr transactionally.
- `removeLayer` removes the whole layer (curves/exprs go with it).
- `duplicateLayer` regenerates modifier ids AND rewrites the matching `mod:*` curve/expr key
  names atomically.
- Orphan-key auto-fix exists only for hand-edited/MCP-written docs — the UI can never create one.
- `solo` is **not part of the document** — it is studio view-state (a Set of layer ids) passed to
  `sampleEffect` via opts. Export/send skips `enabled:false` layers and reports them as an info
  diagnostic.
- All panels re-resolve layers/modifiers by id on every `effect` event; never hold object
  references across mutations (snapshot undo replaces objects wholesale). Autosave closes over
  the doc reference at schedule time (state.js's established pattern).

## Validator registration tiers (shared-module safety)

`diagnostics.js` exports the framework only. Validator packs:
1. `effectValidators.js` — shared, state-free; both windows import and register it.
2. Animation validators — main-window only, registered from app.js boot (wraps validate.js).
3. Studio-only validators — registered from renderer-vfx boot.
The smoketest imports every shared module in a context with no `window.cadence` to enforce this
structurally.

## Export contract: scripted bake + explicit degrade table

The exporter is a **scripted per-frame Luau bake** in the camera-exporter's pattern: per-frame
values pre-baked into FRAMES tables (never re-implement evalCurve/expressions in Luau), driven by
elapsed wall-clock `(os.clock() - t0) * FPS` on Heartbeat (never a `task.wait(1/FPS)` step loop),
Rate-then-Enabled write order, `Emit(n)` for bursts at clip start and every loop wrap. Preview →
game is an explicit **statistical match** (in-game spread/lifetime are engine-random): per-
particle positions differ, the effect reads the same.

Two curve channels, never conflated:
- **Over-life** (sizeStart/End, transparencyStart/End, colorStart/End + `sizeOverLife`/
  `fadeInOut`/`glowBoost` modifiers): baked into NumberSequence/ColorSequence keypoints (≤20,
  bezier easing sampled down to linear keypoints).
- **Over-clip** (rate, speed, lifetime, spread — read-at-emission in Roblox, matching vfx.js's
  per-spawn semantics): scheduled per-frame property writes from the FRAMES table. Clip-animated
  sizeStart/End/gravity export as **static at clip start** + a warning diagnostic (retroactive
  sequence rewrites would visibly differ from the preview's per-spawn semantics).

Degrade table (every approximation/drop emits an export-scope diagnostic):
- **Motions**: cone → EmissionDirection+SpreadAngle+Speed+Acceleration (faithful). burst →
  SpreadAngle (180,180). rise/fall → world-up/-down attachment + Speed (sway dropped, warning).
  orbit/ambient → Speed≈0 + Drag + small SpreadAngle (swirl/jitter dropped, warning).
- **emissionShape**: sphere → Sphere; rect → Box; circle/ring/cylinder → Cylinder (Surface);
  everything else → the shape polyline tessellated into ≤12 point attachments, each with a
  cloned emitter at Rate/N (perf report accounts for the multiplier); past the cap → Sphere +
  warning.
- **Modifiers** (registry gains `exportMode`): wind → approximated (Acceleration); sizeOverLife/
  fadeInOut/glowBoost → baked; pulse/gradientShift → scheduled sequence rewrites (layer-wide in
  preview too, acceptable); noise/flicker → dropped + warning.
- **Sprites**: fixed table sprite-shape → built-in `rbxasset://textures/particles/*` ids with a
  per-layer `textureId` override prop; never export an empty Texture. additive →
  `LightEmission=1`, normal → `LightEmission=0`; **always `LightInfluence=0`** (the preview is
  unlit; default LightInfluence=1 goes black at night in game).
- **Roblox hard clamps** as export diagnostics: Rate ≤ 500/s, Lifetime ≤ 20 s, Size keypoints
  ≤ 10 studs, PointLight.Range ≤ 60. `maxParticles` has no Roblox equivalent — the performance
  report grades in-game density as rate × lifetime, not the preview cap.
- **Shape layers**: path shapes (line/arc/slash/ribbon/wave/lightning/circle/ring/spiral) →
  a chain of ≤16 attachments along the polyline joined by Beams (width = thickness, taper for
  slash, glow via LightEmission); sphere/cylinder/rect → a Neon Part (Ball/Cylinder/Block);
  cone → Neon Ball + warning. Scale/rotation curves export static-at-clip-start + warning;
  opacity/thickness curves export as scheduled Beam.Transparency/Width writes.
- **Shake**: `RunService:BindToRenderStep(name, Enum.RenderPriority.Camera.Value + 1, ...)`
  applying a **delta** (`camera.CFrame = camera.CFrame * offset`), noise sampled from elapsed
  time × frequency (never frame index). Runs after any exported camera script's priority.
- **Screen**: flash/overlay → full-screen Frame; vignette/speedlines → procedural Frame-based
  approximations (fidelity warning). All LocalScript-only (only the local player sees it) —
  stated in the export header comment.
- **Sound**: `PlaybackSpeed` (not deprecated Pitch), `TimePosition = tOffset` for mid-clip
  joins, retrigger on loop wrap. Studio preview never plays audio (CSP cannot fetch rbxassetid):
  sound clips carry an "export only" badge — data + export, no play-attempt code.

Every layer and modifier gets an **export-fidelity badge** in the UI (faithful / approximated /
preview-only) computed from this table, so divergence is visible while editing, not after export.

## Studio window layout (single 1520×920 window, resizable)

- **Center**: three.js preview (the largest region, always).
- **Right**: inspector (typed editors; animatable fields show the **playhead-evaluated** value
  with a static/curved/expression badge, one-click clear-curve/clear-expr; editing a curved field
  inserts/updates a key at the playhead — the animator's "key the evaluated value" idiom; DOM
  built once per selection, values updated in place guarded by document.activeElement).
- **Bottom**: clip timeline whose left column IS the layers panel (name/enable/solo/reorder/
  delete in the row header; clip bars on the canvas; per-animated-prop sub-rows with key diamonds
  behind a caret; dblclick empty sub-row = key at evaluated value; drag = move; right-click =
  easing/delete). Out-of-window keys draw dimmed. The curve editor is a drawer that expands over
  the timeline, opened from a prop's curve button or dblclicking a key; its ruler shows doc
  frames (converted by clip.start) and the shared playhead.
- **Presets**: a modal browser (choose-grid), opened automatically on first boot (blank-state
  flow) with a "Start from scratch" escape hatch that creates one emitter layer, and from a
  toolbar button. Applying a preset replaces the doc as ONE undo step + toast ("Ctrl+Z to
  restore"); "Add as layers" merges instead (the pro path).
- **Diagnostics chip** next to the transport ("2 errors · 1 warning"), expanding to a list with
  per-diagnostic Fix buttons; clicking one selects the target layer and scrubs to its frame.
  Validation re-runs debounced on every edit (continuous validation).
- **Transport**: spacebar play/pause; ruler drag scrubs live (playback follows); clip bodies get
  grab cursors, 6px edge handles get ew-resize cursors, looped clips draw repeat ticks; every
  drag gesture snapshots undo at pointerdown and commits at pointerup (curves.js pattern).
- **Custom splines are cut from v1 UI** — the math ships in effectShapes.js and MCP may write
  spline defs, but the inspector offers parametric primitives only; a viewport spline gizmo is
  the v2 follow-up. Modifier rows get the same key/curve affordances as layer props.

## Presets (revised)

~22 **hand-tuned** multi-layer archetype documents (each individually validated), with theme
(hue remap) and scale (size/rate multiplier) as **post-apply parametric transforms** exposed as
dropdowns in the browser — the same 400-point design space without 400 near-duplicate cards. The
existing 396 single-emitter particle presets remain browsable in their own tab and apply as a
one-emitter-layer doc. The smoketest gate validates every archetype × every theme × every scale
to zero errors.

---

# SKETCH IT — sketch-to-VFX generative workflow (2026-07-20)

Full pipeline: **Sketch → Geometry/Paint Analysis → Composition Planner → Ranking → Preview
Renderer → User Selection → Editable Effect**, an equally-first-class alternative to the manual
preset browser above, never a replacement for it. Entry point: a "✏ SKETCH IT" banner in the
preset browser's "Pick a starting point" modal.

## Workspace: four canvas-painting layers, one canvas

`renderer-vfx/js/sketchWorkspace.js`'s toolbar has a layer-tab strip — **Shape** (the only layer
with its own 9-tool palette: Free Sketch, Line, Circle, Ellipse, Rect, Spiral, Arrow, Lightning,
Bezier Path — feeds `sketchGeometry.js`'s `analyzeSketchStrokes`), **Color** (paints `{x,y,radius,
hex}` dabs), **Density** (paints `{x,y,radius,intensity}` dabs, intensity via a slider — "dark
brush = high density" is a slider value, not inferred from stroke darkness), and **Motion**
(drags an arrow into `{origin,dir,magnitude}`, reusing the Shape tab's own `arrowGuide()` purely
for live-preview rendering — the drag is never committed to `strokes`). None of the four share
canvas state; only the physical canvas element (and Color/Density share the Brush-size control)
is common. The Energy layer is *not* a canvas mode at all — just a 4-chip toolbar control (calm/
normal/strong/extreme), since it has no spatial paint data to capture. All four buffers
(`strokes`, `colorDabs`, `densityDabs`, `motionArrows`) live on ONE shared local undo stack.

Free Sketch is the one tool whose raw capture needs cleanup: `renderer/js/sketchClean.js`'s
`recognizeStroke(points)` snaps a confident messy circle/line/spiral into a clean `tool`+`params`
guide (reusing `sketchGeometry.js`'s exported `analyzePrimaryStroke`/`turningAngles`), else falls
back to a Catmull-Rom-smoothed freeform polyline. Every other Shape tool already synthesizes
clean points+params directly at drag time via `effectShapes.js`'s real primitives (Circle/
Lightning) or small dedicated 2D math (Ellipse/Rect/Spiral — `effectShapes.js`'s own "spiral" is
a constant-radius 3D helix, not a flat growing-radius spiral, so it isn't reusable here).
Thresholds are deliberately conservative: an unrecognized/ambiguous gesture always falls back to
neutral (freehand, or no paint-layer override), never a confident wrong guess — the same
philosophy as archetype scoring below.

## SketchIntent — captured once, degraded many times, never discarded

```js
SketchIntent = {
  shapeGuides: Guide[],                                          // the raw Shape-layer strokes
  colorField:   null | { dabs: [{x,y,radius,hex}] },
  densityField: null | { dabs: [{x,y,radius,intensity}] },
  motionField:  null | { arrows: [{origin:{x,y}, dir:{x,y}, magnitude}] },
  energyLevel: 'calm'|'normal'|'strong'|'extreme',
}
```

`renderer/js/sketchIntent.js`'s `captureSketchIntent(session)` normalizes the raw workspace
buffers into this shape with the *minimum* processing (no archetype/engine knowledge at all).
`NEUTRAL_INTENT` is the all-absent default — every function downstream of it defaults to
`intent = NEUTRAL_INTENT` and must produce byte-identical output to before this feature existed
when nothing was painted (enforced by permanent smoketest regression checks at every phase).

This exact object is what lands verbatim on **`doc.sketchOrigin`** (see effectModel.js's schema)
— pure metadata the engine/exporter never reads, attached to *every* generated candidate whether
or not anything was painted, per the hard requirement that painted intent is never thrown away,
only degraded at render/export time. `parseEffect` passes it through leniently (best-effort,
malformed input just drops the field rather than failing the whole parse); `serializeEffect`
needs no special handling since it's plain `JSON.stringify`.

## Composition Planner — the replaceable seam

`renderer/js/sketchCandidates.js` exposes `registerCompositionPlanner`/`getCompositionPlanner`/
`planCompositions(features, {count, intent, plannerId, onCandidate, signal})` — the ONE entry
point `sketchResults.js` calls; a future planner (generative, or an LLM-backed one) registers
under a new id and the UI never changes. The default (`archetype-planner-v1`) is not hardcoded as
*the* planner, just the one registered today: it scores/picks from the 25 hand-tuned archetypes
(`SCORERS` in `sketchCandidates.js`, geometry-only, never reads `intent`) and may also **combine
two archetypes from different categories into one composition** (`effectLibrary.js`'s
`combineArchetypeDocs` — concatenates two independently-built docs' layers; collision-safe
because archetype layer definitions never set an explicit id, so `parseEffect` always mints a
fresh one) for a small reserved slice of the ~30 slots, confidence deliberately kept below both
combo partners' own solo slots so a combo can never outrank a genuine single-archetype match.

## Interpreters — graceful degradation onto existing primitives, one per paint layer

After the existing geometry-driven nudges (`applyGeometryNudges`, unchanged since SKETCH IT 1.0),
`materializeCandidate` runs four more passes, each a no-op when its `intent` field is absent, each
routed through the existing `clampProp`/modifier-param clamps:

- **`interpretEnergy(doc, energyLevel)`** — a flat 4-bucket multiplier (.6×/1×/1.35×/1.8×) over
  emitter size, light intensity, shake amplitude, and noise/pulse/flicker/glowBoost modifier
  amounts. Never exposes raw Roblox properties to the user, only the 4-word chip.
- **`interpretColor(doc, colorField, shapeGuides)`** — picks a sampling axis from the primary
  shape guide's own geometry (closed+circular → radial distance from centroid; open+straight →
  arc-length position along the path) via the shared `axisPositionsOf` helper, bucket-averages
  painted dabs into a 3–6 stop `colorRamp` along it. No confident axis → a plain core/edge
  `colorStart`/`colorEnd` override with **no ramp** — an honest degrade, never a guessed axis.
- **`interpretDensity(doc, densityField, shapeGuides)`** — the "closest supported approximation"
  principle in code: a doc with 2+ emitters samples the field **at each emitter's own offset**
  (inverse-distance-weighted, projecting both the canvas-space dabs and the emitters'
  effect-local offsets into comparable 0..1 spans) and weights each emitter's `rate`/
  `maxParticles` relative to the others — the real "multiple emitters" spatial approximation,
  zero new engine primitives. A single emitter instead gets one global sublinear density scalar
  (same growth idiom `effectLibrary.js`'s `applyScaleToDoc` already uses) plus an optional
  life-fraction `densityRamp` when an axis exists (reuses the exact same `axisPositionsOf`/
  `bucketAverage` machinery as Color).
- **`interpretMotion(doc, motionField)`** — `classifyMotion(arrows)` decomposes each arrow's
  direction against its own radius vector (relative to the arrow set's shared centroid) into a
  tangential component (spinning around a point) and a radial component (expanding away from/
  toward a point), plus a raw direction-sum for "all pointing one way regardless of position" —
  three genuinely different intents a flat direction-only average could never distinguish.
  Classifies as `orbit`/`vortex`/`radial`/`flow`/`none` and tunes the existing `motion` enum
  (`orbit`, `burst`) and `orbit`/`wind` modifiers accordingly (adding one if absent); `vortex`
  additionally animates the `orbit` modifier's own `radius` over the clip via the existing
  `setCurveKey()` (already `animatable:true`) so the swirl visibly widens/narrows — no new
  modifier type anywhere. Ambiguous/self-contradicting arrow sets → **no override at all**.

Every interpreter was verified standalone (hand-constructed fixtures with full control over
geometry/positions) before being wired into the planner — the real pipeline's archetype/theme
selection isn't deterministic enough to target a specific classification from an integration
test alone, so both layers of testing exist deliberately, not redundantly.

## What's deliberately NOT built (v2.0 scope)

Per an explicit product decision, not an oversight: no real spatial spawn-mask engine primitive
(Density's "multiple emitters" approximation is the interim answer), no arbitrary free-form
path-following motion (Motion's enum-mapping is the interim answer), and the planner's
`archetype-planner-v1` dresses/combines existing archetypes rather than generating novel layer
graphs per sketch. Each is a real, larger follow-on project if user testing shows the
approximation reads as too generic — not a quick tweak on top of what exists today.
