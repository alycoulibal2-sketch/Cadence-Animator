# Moon Animator 2 parity

Cadence began as a standalone replacement for [Moon Animator 2](https://devforum.roblox.com/t/moon-animator-2/). This document records what was ported from Moon's own source, where Cadence deliberately differs, and what genuinely cannot cross over.

The port was done by extracting Moon's 139 Lua modules from `MoonAnimator2.rbxm` and translating the relevant ones, rather than reimplementing from behaviour. Where a file is named below, it is the actual source that was translated.

## Easing — `renderer/js/easing.js`

A direct translation of `Libraries/EasingFunctions.module.lua` and `Classes/Ease.module.lua`. The functions keep the original `(t, b, c, d)` signature rather than being normalised, because several styles are **not** simple reflections of their `In` variant and re-deriving them from `out(t) = 1 - in(1-t)` silently diverges.

Verified bit-exact against an independent longhand transcription of the Lua: 13 styles × 4 directions × 205 sample points, plus parameter sweeps — 21,108 comparisons at 1e-12 tolerance.

What this added over Cadence's previous easing:

| | Before | After |
|---|---|---|
| Styles | 12 | 13 (**Sextic**) |
| Directions | In / Out / InOut | + **OutIn** |
| Parameters | none | **Back**: Overshoot · **Elastic**: Amplitude, Period |

Also ported: Moon's per-style keyframe colours (`Ease.EASE_DATA[x].Color`), behind the **Easing Colors** toggle, and **Use Last Ease** — new keyframes inherit the last applied easing instead of the default.

**Two quirks are reproduced on purpose, not fixed:**

- `Exponential` In and OutIn land on `0.999` / `0.9995` at `t = 1`. That is the `0.001` fudge factor in the library Moon uses. Matching it is the point.
- `Back` and `Elastic` default their parameters the way Moon's `Ease` constructor does (1.70158 / 1 / 0.3), never as nil — Moon's own code would error on a nil amplitude, so that path is unreachable there too.

`Period` is **frame-relative**, matching Moon's `frame_relative` flag: the stored value is in frames, so the same value reads identically on a short and a long segment. `evalSegment(key, t, segFrames)` takes the segment length for this reason.

Roblox's `PoseEasingStyle` has no Sextic, no OutIn and no parameters, so `needsBaking()` bakes those to explicit per-frame keys on export — the same "bake, don't translate" rule the rest of the exporter follows.

## Event markers — `renderer/js/state.js`, `timeline.js`

Ports `Classes/TrackItem/Marker.module.lua`, `Classes/LayerSystemItem/MarkerTrack.module.lua` and `Windows/EditMarkers.module.lua`.

Every item gets an **Events** lane. Unlike a keyframe, a marker spans a range — a start frame plus a `width` — and carries a name, a `{key: value}` map, and Luau for its start and end. Markers select, drag, resize against the next marker's start (Moon's `maxWidth` rule), undo, and round-trip through save.

On export a marker becomes a **named Roblox `Keyframe`** plus `KeyframeMarker` children, so `KeyframeReached` and `GetMarkerReachedSignal` both fire in-game. Import reads them back.

**Deliberate difference:** the Luau in `codeBegin` / `codeEnd` is stored and exported but **never executed by Cadence**. Moon can run it because it lives inside Studio with a real Luau VM. Cadence is an Electron renderer with no Luau runtime and a CSP without `unsafe-eval`; the code runs in Studio after export.

## Play range — Moon's PlayArea

Ports `SetPlayArea` and the play/loop logic from `Classes/GuiElement/LayerSystem/PlaybackHandler.module.lua`. A saved `[start, end]` window confines playback and looping, drawn as a draggable strip along the bottom of the ruler — drag either end, or the middle to slide the whole window — with everything outside it dimmed. Starting playback outside the range snaps into it first, as Moon's `Play()` does.

A null range means the whole animation, so this is the previous behaviour until a range is set.

## Frame operations

- **Wiggle fill** — `Windows/FillFrames.module.lua`'s Wiggle checkbox. Each baked frame is nudged by a bounded random amount: per-axis position (studs) and rotation (degrees) for CFrame tracks, a single amount for numeric ones, with Moon's `MinZero` to nudge only upward.

  Moon reads the values it wiggles from a **precomputed `BufferMap`**. That detail matters: sampling the curve while writing to it makes each frame interpolate against the keys just written, so the jitter compounds — a 10° wiggle measured 11.32° before this was fixed. `fillFrames` now samples every target frame before writing any of them.

- **Frame offset** — `Windows/FrameOffset.module.lua`. Shifts every keyframe, event marker and group along the timeline at once.

## Property and action tracks — `renderer/js/propTracks.js`

Ports `Libraries/ItemTable.module.lua`: **67 Roblox classes** with their animatable properties, class inheritance flattened the same way Moon does it (`TextLabel` picks up `Frame`'s, `SpotLight` picks up `Light`'s, `Texture` picks up `Decal`'s), plus Moon's **22 one-shot action tracks** from `Classes/LayerSystemItem/Action/*`.

A `prop` item is a named Roblox instance — Lighting, a Sound, a ParticleEmitter, a GUI object, a constraint — whose properties become timeline tracks. Tracks carry a value type and evaluation dispatches on it, mirroring `ItemTable.TweenFunctions`:

| Type | Tween |
|---|---|
| `number`, `NumberSequence` | linear |
| `Color3`, `Vector2`, `Vector3`, `NumberRange`, `ColorSequence` | componentwise lerp |
| `CFrame` | the existing cached CFrame evaluator |
| `string`, `boolean`, `Instance`, `EnumItem` | **discrete** — hold the earlier value, snap at the next key |

**Deliberate difference:** Moon drives live Studio instances because it runs inside Studio. Cadence has no Roblox runtime, so delivery is a **generated Luau script** (`buildPropertyScriptLua` in `io.js`): property tracks are baked one row per frame with easing already applied, actions fire once as playback crosses their keyframe, and instance paths resolve leniently so a missing object disables only its own tracks rather than killing the whole animation.

## Screen effects — `renderer/js/screenFx.js`

Ports Moon's `Item ▸ Add Effects` menu: **Vignette, Letterboxing, Screen Cover, Subtitles**.

Moon builds these as real ScreenGui objects and then adds them to the timeline as ordinary items. Cadence does the same structurally — each is a `prop` item of the matching Roblox class, so it inherits property tracks, keyframing, easing, the inspector and the Luau exporter for free. The additions are a `screenEffect` tag, a pointer-transparent DOM overlay that previews it over the viewport, and an exporter preamble that **builds** the GUI (unlike other prop items, these instances do not already exist in the user's game, so `resolve()` checks a `_built` table before walking from `game`).

Subtitles animate `MaxVisibleGraphemes`, which types the line out character by character, exactly as in Moon.

## Other ported pieces

- **Welder** (`Windows/Welder.module.lua`) — its "Weld Model" button, as `weldAllParts`: join every loose part of a rig to one base part in a single action, as rigid Welds or animatable Motor6Ds. Parts that already have a joint are skipped, so running it twice is safe.
- **Edit Selection** (`Windows/EditKeyframes_Value.module.lua`) — bulk-edit every selected keyframe's value and easing, with Moon's "leave a varied field alone" rule: a blank field means "don't touch", so a mixed selection can be nudged on one axis only. Bound to Keypad 7, as in Moon.
- **Ease parameters in the curve editor** (`Windows/EditKeyframes_Ease.module.lua`) — the Back/Elastic parameter inputs, and the direction control greys out for Linear/Constant.
- **Colour picker** (`Windows/ColorPicker.module.lua`) — the same three linked representations (H/S/V, R/G/B, hex) over a saturation-value square with a hue slider, used wherever a Color3 property track is edited. The conversions live in `color.js`, a pure leaf module with no imports, so they can be unit-tested with plain `node` (anything importing `ui.js` touches `window` at load time).

## What does not cross over

Moon is a Studio plugin; some of it is only meaningful inside Studio and has no Cadence equivalent by design:

- **Live instance manipulation.** Moon writes to real Studio instances as you scrub. Cadence authors and exports; Studio applies.
- **Executing marker Luau.** See the markers section above.
- **`Windows/Activate.module.lua`** (EULA/licensing) and `Supporters` — Moon-specific, not features.
- **`Libraries/MASConvert.module.lua`** — converts Moon's own legacy save format. Not applicable.
- **KojoGizmos** — Moon's custom Studio drag handles. Cadence has its own three.js gizmos (translate/rotate/scale/trackball/IK), which Moon has no equivalent of.

Cadence also has substantial capability Moon does not: a real 3D viewport, IK, world-space (unparented) tracks, onion skinning, the node-graph VFX Studio, a mobile companion, and an MCP server that lets Claude drive the whole app.

## Testing

`test/smoketest.js` carries eight permanent Moon-parity steps covering the easing engine, markers, play range, wiggle fill, property/action tracks, screen effects, colour conversions and the welder. The bit-exactness check for easing lives in the first of those; the full 21,108-comparison sweep against an independent transcription was a one-off verification during the port.

Full suite at the time of writing: **47 checks, 0 console errors**.

Two bugs were found by running the suite rather than by review, both worth remembering as failure shapes:

- `fillFrames` sampled the curve *while* writing to it, so wiggle compounded frame over frame. Moon's precomputed `BufferMap` exists for exactly this reason.
- `makeInstance` fell through to `RigInstance` for any item without a rig, so every prop item threw on `item.rig.parts` on **every animation frame** — hundreds of console errors and a stalled run. Items with nothing to draw now get `NullInstance`.
