# VFX without learning nodes — the Effect Sheet

*Design document, 2026-09-06. The result of a research session asked to find the best way to let
people make ANY effect the procedural engine can express, without learning nodes, and without the
tool guessing what they meant. Nothing in this document is implemented yet; §13 says what to build
and where. The proof script in §8 runs today against the real registry.*

---

## 0. The answer in ten lines

1. Keep the PNX graph exactly as it is. It is the file format and the engine. Nobody has to see it.
2. Show the effect as a **Sheet**: a list of *things you can see* (sparks, a ring, a beam, a light),
   each with plain-English *properties*, each property a *value*. Every value can be told **how it
   varies** from a small menu: fixed · random per particle · over its life · over the effect's time ·
   by where it is · by how fast it goes · noise · from another value · maths · anything else (search).
   That menu entry can itself have values with the same menu, recursively. **That recursion is the
   entire node graph, rendered as nested sentences.** A value used in two places gets a name.
3. Every menu entry is shown as a **live thumbnail of THIS effect with that choice applied** (the
   real evaluator, 2–15 ms per candidate — measured). You never need to know what "Curl Noise"
   means; you hover it and look.
4. Spatial values get **handles on the Stage** (the existing preview): drag the spawn shape, the
   direction arrow, the spread cone, the gravity arrow, the floor, the light. Handles are generated
   from the registry's units, the same way the node editor generates its controls.
5. One particle's whole life is shown as a **ghost strip** (0 · 25 · 50 · 75 · 100 %) you can edit:
   drag a ghost's size, click its colour, drag its opacity. "Animate one particle; we make a thousand."
   Animators already know this from onion skin and keyframes.
6. **Never a blank canvas.** New effect = the starter graph, already alive. Recipes open as sheets
   that read as their own explanation.
7. **"Show as nodes"** opens today's node editor on the same object. Editing either side updates the
   other, because there is one object.
8. **Exact by construction.** Every control writes one value or one wire into the graph. No
   inference, no candidates-of-what-you-might-mean. The only thing the tool "guesses" is nothing.
9. **Complete by construction.** A dataflow DAG is a set of nested expressions plus names for shared
   values — that is a theorem, not a hope — and the proof script projects the starter graph, four
   hand-built stress-test effects and all nine library recipes with 100 % of nodes reached.
10. The user's earlier Golden Rule still governs every phrase: an intelligent 11-year-old understands
    it in 10 seconds or it gets redesigned.

---

## 1. The ask, and the three constraints

> "Make VFX without having to learn nodes … they have to be able to do whatever they want: just
> like nodes but without learning. It won't be an estimation of what they want."

Three constraints fall out, and each past attempt in this repo failed exactly one of them:

| Constraint | Meaning | What it killed |
| --- | --- | --- |
| **C1 Exactness** | The tool does what the user specified, never a guess. | SKETCH IT (draw → 30 interpretations = estimation). Removed 2026-07-21. |
| **C2 No learning** | No vocabulary to memorise, no wiring discipline, no blank canvas before the first visible result. | The node editor as the primary surface (354 names, typed sockets, fields vs values, two clocks). |
| **C3 Full power** | Every valid PNX graph must be reachable. | A preset library as the ceiling (finished effects, however many). |

The apparent contradiction between C2 and C3 dissolves once "learning nodes" is taken apart.

## 2. What "learning nodes" actually consists of

| | Cost | Removable? |
| --- | --- | --- |
| L1 | **Vocabulary** — what does *Curl Noise* / *Map Range* / *SDF* do? | Yes: replace names with live previews (recognition, not recall). |
| L2 | **Composition rules** — types, field vs value, the sample point, Effect Time vs Sample Time | Yes: typed slots that only offer what fits; the engine's field lifting already makes "a number slot accepts a thing that varies" work. |
| L3 | **Decomposition** — turning "a fireball" into emitter + force + material + renderer | Mostly: organise the UI by *things and their properties* (pull from the renderer), so the user never assembles operations; they answer "how does this vary?" on a property they can already see. |
| L4 | **Mechanics** — dragging wires, panning, finding the palette | Yes: no wires; slots. |

Nodes are organised by *operation* (Math, Noise, SDF …). People describe effects by *thing +
property + how it varies*: "sparks that fly out, fall, and turn red as they die." The whole
difficulty of nodes is that the user has to translate from the second frame to the first. The Sheet
does the translation once, in code, and never asks the user to.

## 3. The insight that makes this a projection, not an approximation

In PNX **a field is "a value that varies over a sample point"** (`fields.js`). The sample context
lists everything a value can vary with: `position`, `normal/tangent/uv`, `time/frame`, `age/life`,
`velocity`, `index/seed`, `attributes`. The exporter's `bakeStrategy()` already classifies every
field by exactly these axes to decide native-vs-baked.

The user's concept ("how does this vary?") and the engine's concept (a field over the sample
context) are **the same concept**. So a UI whose only mechanism is "pick how this value varies" is
not a simplified model sitting on top of the graph — it *is* the graph, written in the user's frame.
Nothing is lost, nothing needs migrating, and the node editor stays available as a second view of
the same object.

Two facts of the codebase make this cheap:

- The evaluator is **pull-based** from the output (`evaluator.js`). The Sheet is the same walk,
  printed.
- Every control in the node editor is **generated from socket metadata** (`pnxNodeEditor.js`:
  274 ranged inputs, 53 enums, 194 units). The Sheet's phrases, menus and Stage handles are
  generated from the same metadata. There is no list of 354 anything in the Sheet either.

## 4. The design: three surfaces over one object

```
┌───────────────────────────────────────────────┬──────────────────────────────────────┐
│  THE STAGE (existing preview)                 │  THE SHEET                            │
│                                               │                                       │
│      ⟋ spread cone (drag edge = 30°)          │  ✦ Sparks                    Roblox ✓ │
│     ●──▶ direction + speed arrow              │    born  150 at once ▾  from a point ▾│
│    (◯) spawn shape: sphere r 0.4 (drag rim)   │    start moving  up ▾ at 8–14 ▾       │
│      ↓ gravity arrow (drag length = 20)       │          spread 35° ▾                  │
│   ═══════ floor (collider) drag height        │    pushed by  gravity 20 ▾            │
│                                               │    bounces off  the floor ▾ (50 %)     │
│   ghost strip: one particle's life            │    live  1.4 s ▾                       │
│   ○   ○   ○   ○   ○   ← size handles          │    look  soft glow ▾                   │
│   0%  25% 50% 75% 100%  colour swatches       │       size  0.12 ▾   colour  ▮▮▮ over life ▾
│   [life ─────●────────]                       │       fades  over life ▾   additive ▾  │
├───────────────────────────────────────────────┤  + Add a thing ▾                       │
│  effect timeline (existing clip timeline)     │  Values used in several places: …      │
│  [0 ───────●──────────────── 60]              │  ▸ Show as nodes                        │
└───────────────────────────────────────────────┴──────────────────────────────────────┘
```

| Surface | What it is | Status |
| --- | --- | --- |
| **Sheet** | The effect as things → properties → value-with-source. Replaces the procedural inspector. | New (`renderer-vfx/js/effectSheet.js`). |
| **Stage** | The existing three.js preview plus generated handles and the hero-particle ghost strip. | Extend `preview.js` / `pnxBackend.js`. |
| **Graph** | Today's `pnxNodeEditor.js`, opened by "Show as nodes". | Exists. Unchanged. |

All three read and write `ST.state.pnx` through `ST.mutatePnx` + `graph.js`, the same path the MCP
tools use. That is the same rule `pnxNodeEditor.js` states in its header: one object, several
clients, nothing to synchronise.

## 5. The Sheet, precisely

### 5.1 Things

A **thing** is any node whose output is a `renderCommand`: Sprite, Point, Mesh, Trail, Ribbon,
Beam, Line, Light (9 in the registry today). The Sheet lists the things wired into Effect Output, in
draw order, then anything that renders but is unwired ("not drawn — connect it?"), then anything
unreachable ("not used by anything drawn"). Nothing is hidden: a node that exists is on the Sheet.

**Add a thing** offers exactly those things, each as a live thumbnail, and creates the *whole*
sensible sub-structure so the first result is visible immediately (Particles = Sprite + Simulate +
Emitter + Point shape, exactly the starter's skeleton; Ring = Mesh + Disc + Material; Beam = Beam +
Line + Material; Light = Light). Each is a library recipe (§5.5), not an engine feature.

### 5.2 Properties

A thing's properties are its input sockets, in registry order, grouped by the registry's
`subcategory` where one exists. Labels are the socket labels (already plain English: "Spawn from",
"Where on it", "Rate", "Lifetime", "Initial velocity", "Bounciness"). A sub-thing (Simulate → Emitter
→ shape) is a nested card, collapsed beyond one level to a summary sentence built from its
non-default values ("150 at once from a point, up 8–14, spread 35°").

Mode inputs (`socket: false`, e.g. "Where on it: surface", "Blending: additive") are dropdowns.
They cannot vary, and the Sheet does not offer the source menu on them.

**Few big knobs first.** A card shows its *primary* slots (for an emitter: how many, from where,
how they start moving, how long they live; for a sprite: size, look) and any slot whose value
differs from its default; everything else (Mass, Substeps, Write depth, Sampling step…) sits behind
"more…". Media Molecule's Dreams team named "endless menus, endless sliders" as what makes tools
intimidating, and Carroll's training-wheels studies measured novices learning faster with advanced
controls walled off (§10). Which slots are primary is one more piece of registry metadata
(`primary: ['rate', 'shape', 'velocity', 'lifetime']`), with a fallback of "the first four".

### 5.3 Values and the source menu — the one mechanism

Every non-mode input is a **slot**. A slot shows either a literal (with the registry's unit and
range) or a **phrase** describing the node wired into it, followed by that node's own slots. Every
slot has a `▾` that opens **the source menu for its type**. The menu's top level is small, curated,
and shown as live thumbnails; the last entry is "Anything else…", which is the existing ranked
search over every registry node that can feed that slot type (200 for a number, 250 for a vector,
234 for a colour — derived from the registry, §8).

| Slot type | Top-level sources (each one is a recipe over registry nodes) | Roblox |
| --- | --- | --- |
| **number** | a number · random for each particle (`random.float`) · over its life (`particles.life → curve.evaluate`) · over the effect's time (`time.effectTime.normalized → curve.evaluate`) · by where it is (`fields.position → distance/height/along axis → math.mapRange`) · by how fast it goes (`particles.speed → mapRange`) · noise (`noise.fbm`) · from another value (named value / pick-whip) · maths (add/multiply/min/max/mix of two sources) · type a formula (`fields.customScalar`) · anything else | native · range · sequence · scheduled · baked · baked · baked · — · — · baked |
| **colour** | a colour · over its life (gradient) · over the effect's time (gradient) · random from a set · by speed (gradient) · by where it is · from a texture · noise · from another value · anything else | native · sequence · scheduled · range · baked … |
| **direction / velocity** | a direction (arrow handle) · random in a cone (cone handle) · random any direction · away from the centre (`fields.radial`) · toward a point (`fields.directionFrom`) · along the surface (`fields.normal`) · over life / over time · from another value · anything else | native · native (SpreadAngle) · native · approximated · baked … |
| **shape (geometry)** | a point · sphere · box · disc/ring · circle · cylinder · torus · a curve (line/arc/helix/drawn) · **a part of the character** (the rig part's mesh, picked by clicking it — Dreams' "emit the thing you point at") · points on the surface / inside any of these · anything else | native (box/sphere) · approximated · baked |
| **force (vector field)** | gravity · wind (direction + gusts) · swirl (`noise.curl`) · spin around an axis (`fields.vortex`) · pull toward a point (`fields.attract`) · orbit · air resistance (`forces.dragForce`) · chase a target (`forces.seek`) · noise · combine (add) · anything else | Acceleration for constant ones · Drag · baked for the rest |
| **collider** | the floor (`sdf.plane`) · a ball · a box · a capsule · a combination (union/subtract) · anything else | baked (Roblox particles cannot collide) |
| **texture** | a picture from the library · draw one (paint canvas → `texture2d`) · build one (noise → levels → gradient map; flipbook) · from a file · anything else | native (asset id) · uploaded · baked flipbook |
| **material** | inline: colour · glow · see-through · blending · texture (each slot has its own menu) | native/approximated |
| **curve / gradient** | the existing curve and gradient dialogs from `pnxNodeEditor.js`, plus the ghost strip (§6.2) | sequence |

The **Roblox column is shown in the menu** as a badge on every entry, read from the recipe's node
`exportSupport` values, so a user learns *before* choosing that "by where it is" will be baked.
That is the classification `registry.js` already makes mandatory (spec Part 56), surfaced one level
earlier than the export report.

**Recursion is the whole point.** "Over its life" is a curve whose *height* is a number slot with
its own menu, so "size over life, scaled by a random per-particle factor, scaled again by an
effect-time fade" is three nested choices — and is exactly the graph the node editor would show.

### 5.4 Named values

A node with more than one consumer is a **named value**, listed once under "Values used in several
places" and referenced by name in every slot that uses it. The name defaults to the node's label
(the starter graph's shared `Normalized Age` becomes «Normalized Age»); the user can rename it.
"Save this as a value…" on any slot creates one; "From another value" in any menu references one.
This is the `let` binding of the projection theorem (§8.1) and the only abstraction step a user
ever meets. The Sheet also shows backlinks ("used by: size, colour"), which is the one cognitive
dimension a property panel is weaker on than a graph (hidden dependencies, §10.2).

### 5.5 Everything above is data: recipes, not code

Each source-menu entry and each "Add a thing" entry is a **library recipe** in exactly the format
`renderer/js/pnx/library.js` already uses (`nodes`, `links`, `inputs`, `outputs`, `teaches`), built
against the live registry when chosen. The library registers no node types (spec Part 47's test),
so the Sheet adds **zero engine capability** — only compositions and words. The current nine
recipes (Curl Motion, Orbit Field, Fire Turbulence, Soft Glow, Dissolve, Shockwave Geometry, Radial
Burst, Size Over Life, Fire Texture) are already five of the menu entries.

A recipe chosen from a menu is inserted *expanded* by default (its nodes appear as nested slots), not
as a black-box group, so the user sees and can change every part. "Collapse into one card" is
available and is the existing `groups.js` collapse.

**The user's own recipes sit next to the built-ins.** "Save this as a recipe…" on any card or slot
exports the group (`groups.js` `exportGroup`) into a personal library, and it appears in the same
menus with the same thumbnails. Scratch's ceiling problem was solved by Snap! precisely by making
user-defined blocks look and behave like built-ins (§10.3); the ladder here is continuous — same
document, same engine — rather than Fortnite's "presets in the device, Niagara in another product".

### 5.6 Phrases without hand-written text

The proof script (§8) renders every node as `Label` + its input labels, entirely from the registry.
That is complete and already readable (see Appendix A). To read as *sentences* rather than forms, a
node may declare an optional `phrase` template in its registry definition, e.g.
`'{rate} per second from {shape}, living {lifetime}'`. The fallback is automatic, so phrases can be
added incrementally, most-used nodes first, and they live in the registry — so `pnx_describe_node`
and the MCP catalogue carry them too, and the Golden Rule check runs on them like on `teach`.

### 5.7 Warnings live on the slot

The evaluator's diagnostics already name the node responsible. The Sheet shows each one on the slot
it concerns ("nothing is drawn after 0.2 s because size reaches 0"), which is where a user looks,
instead of a separate panel. The existing `Simulation Report` and `Render Report` nodes become
sentences at the top of the thing's card ("22 alive · fastest 6 studs/s · Roblox: native").

## 6. The Stage

### 6.1 Handles are generated from metadata

A handle exists for any slot whose type and unit make one meaningful, exactly as a slider exists in
the node editor only where the metadata gives a bounded range:

| Socket metadata | Handle |
| --- | --- |
| `vector3` named position / point / center | a draggable point |
| `vector3` named direction / axis / normal | a draggable arrow (length = the sibling `strength`/speed slot when one exists) |
| `float` with unit `studs` named radius / width / range | a rim you drag |
| `float` with unit `degrees` on a cone / spread | a cone whose edge you drag |
| a collider's `sdf.*` shape | the shape itself, draggable and resizable |
| a `geometry` primitive | its outline |
| a light | a bulb with a range ring |

Hovering a slot on the Sheet highlights its handle; dragging a handle highlights and updates its
slot. The handle map is a function of (type, unit, label) — one table, not 354 cases.

### 6.2 The hero particle: "animate one particle, we make a thousand"

A particle system's card shows a **ghost strip**: one representative particle's life drawn as
ghosts at 0 · 25 · 50 · 75 · 100 % of life along its real trajectory, each ghost showing that
moment's size, colour and opacity. It is built by sampling the material and size fields at
`life ∈ {0, .25, .5, .75, 1}` with a representative context (`F.sampleAny(field, ctx)`), and the
trajectory by reading one particle id's positions across frames from the deterministic solver.

Editing the ghosts edits the curves: drag a ghost's rim → a key in the size curve at that life;
click a ghost → a gradient stop at that life; drag its opacity. Under the strip sits a life
scrubber (0–1), distinct from the effect timeline, so **the two clocks are two visible things**
rather than a concept to explain ("over its life" vs "over the effect's time" — the trap
`docs/pnx-plan.md` §4.5 records). Animators already know this from onion skin and keyframes.

When motion is a random range, three ghost trails are drawn (low / typical / high), so "8–14" is
visible as a fan rather than a pair of numbers.

### 6.3 The one rule for direct manipulation

**A handle exists only where dragging it sets exactly one value in the graph.** Dragging a
mid-life ghost sideways to make the trajectory pass through a point is *not* offered: it is an
inverse problem with many answers (change speed? direction? gravity? drag?), and choosing one would
be estimation — the failure mode PBD research documents (§10.2). Where a user wants "pass through
here", the exact tool is the *shape* menu ("along a path I draw" → `curveGeometry.fromPoints`), whose
handles are the path's own points.

## 7. The Graph

Unchanged. "Show as nodes" opens `pnxNodeEditor.js` on `ST.state.pnx`. A parity smoketest already
compares the editor's palette with the MCP catalogue; a second one should compare the Sheet's
"Anything else…" list with both, so a node reachable only through one client fails a test.

## 8. Proof that it is complete and exact

### 8.1 The projection theorem

A PNX graph is a directed acyclic graph of typed nodes (`graph.js` rejects cycles). For any DAG:
walk backward from each output; a node with one consumer prints inline as a nested expression; a
node with more than one consumer is printed once under a name and referenced elsewhere. The
result is a tree of nested slots plus a table of named values, and it can be inverted (every slot
is a node id + socket key; every name is a node id). So **the Sheet reaches every graph the node
editor reaches, and every edit on the Sheet is one `setNodeValue` / `connect` / `newNode`** — the
same mutators, through `ST.mutatePnx`. Exactness is therefore not a policy; there is no code path
that infers anything.

### 8.2 Measured, today, against the real registry

`tools/effect-sheet-proof.mjs` (added with this document; plain Node, no Electron) loads the 354
registered node types and projects real graphs with **zero hand-written per-node text**:

| Graph | Nodes reached from drawn things | Auto-named shared values |
| --- | --- | --- |
| Starter graph (what "New procedural effect" opens) | 10 / 10 | 1 (Normalized Age) |
| Sparks bouncing on the floor (Part-75 style, with a collider) | 15 / 15 | 1 |
| Shockwave ring (animated disc, effect-time driven) | 8 / 8 | 2 |
| Sword slash (arc trail) | 6 / 6 | 0 |
| Fire sprite from a procedural texture (noise → levels → gradient map) | 14 / 14 | 0 |
| All 9 library recipes (as group interiors) | 33 / 33 | 1 |

The full generated sheets are in Appendix A. Read the starter's: it is a legible description of the
effect with no words added by hand.

**Source-menu derivation.** Counting registry nodes whose output fits a slot type (directly or as a
field): number 200, vector 250, colour 234, geometry 25, texture 19, render pass 10, curve 8. The
"anything else" search is therefore never empty and never wrong for the slot. The seven
input-less field readers in the registry — Sample Time, Age, Normalized Age, Position, Normal,
Tangent, UV — plus Random and Noise and the `defaultFrom` sockets are the complete list of things a
value can vary with; the menu's top level is built from exactly them.

**"How does it vary" is readable structurally, not by probing.** Walking upstream of any wired
slot and collecting field readers gives, for the sparks graph: `Initial velocity: varies with
Random per particle`, `Opacity: varies with Normalized Age`, `Colliders: varies with its own
position`. That is what the Sheet prints next to a phrase, exactly, without sampling.

**Hover previews are real-time.** Fresh evaluator, starter graph at frame 20: 7.7 ms cold, 1.7 ms
warm. A candidate edit "size by speed": 2.2 ms. "Force = swirl" (curl noise, the expensive one):
5.8 ms at frame 20, 15.3 ms at frame 60. A menu of twelve thumbnails is under a quarter of a
second at the far end of a long effect, and they render lazily.

## 9. Proof that it needs no learning: walkthroughs

Every walkthrough starts from the living starter (an orange puff rising from a small sphere and
fading) and counts **actions** and the **concepts** a first-time user meets. The only concept in
the whole system is *"every value has ▾: how does it vary?"*; the second column shows when it first
appears.

| # | Effect | Actions from the starter | New concept met |
| --- | --- | --- | --- |
| 1 | **Fireball** | click the 50 % ghost → pick orange; drag the direction arrow up; drag a ghost rim bigger. 3 actions. | none (click what you see) |
| 2 | **Sparks that bounce** | *born* ▾ → "150 at once"; *start moving* ▾ → "random in a cone" (a cone handle appears, drag it to 35°); *bounces off* ▾ → "the floor" (a floor appears, drag its height); *look* ▾ → "streak". 4 menus. | the ▾ menu, learned on the first one |
| 3 | **Shockwave ring** | Add a thing → Ring; *size* ▾ → "over the effect's time", drag the curve (or scrub the timeline and drag the rim: that keys it); *fades* ▾ → "over the effect's time". | that the effect timeline is a second clock; it is visible under the stage |
| 4 | **Sword slash trail** | Add a thing → Trail; *along* ▾ → "an arc" (drag its two end handles); *width* ▾ → "along the path"; colour → white→blue. Attach to the hand in the animator as any effect item. | none |
| 5 | **Aura on a character** | *born* ▾ → *from* ▾ → "the surface of a sphere" (drag rim to body size); *start moving* ▾ → "along the surface"; *look* → soft glow, additive. | none |
| 6 | **Rain with splashes** | *born from* ▾ → "a box" (drag it wide and high); *pushed by* → gravity; *bounces off* → floor, "die on contact"; Add a thing → Particles (splash) *born* → "on contact" — **not available**: sub-emission is not built (§12). Workaround shown by the Sheet: a second system born from the floor plane at a low rate. | the tool says what it cannot do |
| 7 | **Portal** | Add → Ring; *pushed by* ▾ → "spin around an axis" (axis handle); *born from* → "a ring"; *colour* ▾ → "by where it is → distance from the centre" (gradient). | "by where it is" (the badge says: baked in Roblox) |
| 8 | **Healing spell** | *born from* → "a circle"; *pushed by* → "orbit" (centre + radius handles); *start moving* → up; colour green→white over life. | none |
| 9 | **Lightning** | Add → Beam; *along* ▾ → "a line" (two end handles); *jitter* ▾ → "noise" (thumbnail shows the jag); *width* → "over the effect's time" flicker. | none |
| 10 | **Snow** | *born from* → box; *pushed by* → gravity 2 + "swirl" (menu: combine); *slowed by* → air 1; *look* → picture "snowflake"; *size* → random 0.1–0.3. | "combine" = the maths entry, previewed |
| 11 | **Smoke trail behind a rocket** | *born from* → point attached to the rocket; *start moving* → backward; *pushed by* → "swirl"; *size* → grows over life; *fades* → over life; *look* → picture "smoke". | none |
| 12 | **Size depends on distance from the player** (the kind of thing only nodes could do) | *size* ▾ → "by where it is" → "distance from a point" (a point handle appears; drag it onto the player) → its curve near→far. | none new: same menu, one level deeper |
| 13 | **A texture nobody made** | *look* ▾ → *picture* ▾ → "build one": noise → contrast → colours (each a slot with a thumbnail). | none |
| 14 | **Something the menu does not have** (e.g. hexagon-pattern shield) | *look* ▾ → *picture* ▾ → "anything else…" → type "hex" → Hexagons (the ranked search that exists today), preview, apply. | search, when they want it |

Every one of these is a graph the node editor can show, unchanged, via "Show as nodes".

## 10. What the research says

Two sub-agents surveyed the field; their full reports (with sources) are in
`docs/research/effect-sheet-research.md`. The findings that shaped the design:

### 10.1 Prior art: how professional tools give power without wires

- **Unreal Niagara** chose a *hybrid* on purpose: an ordered **stack** of modules for "the 99 %
  case" and the graph only for module authors — and, crucially, **dynamic inputs**: a dropdown on
  every parameter that replaces a constant with a mini-function whose own inputs get the same
  dropdown, *recursively*. Epic's stated rationale (GDC 2018): "if you're not super technical … a
  huge suite of dynamic inputs that have almost all of the power of writing new modules except
  you don't have to write one." The recursive source menu in §5.3 is this mechanism, with the
  difference that here it is a *lossless view of the graph* rather than a second data model.
- **Unity Shuriken**'s learnability comes from one thing: every property is a four-way dropdown
  (constant / curve / random between constants / random between curves). Its ceiling is low
  because that dropdown does not recurse and has no "link to Y". VFX Graph is widely described as
  having a steep learning curve for the same visual reason the Blender community gives about
  Geometry Nodes ("a circuit diagram").
- **Cavalry** is the closest existing instance of §4: a full graph engine behind a layer/property
  UI ("Cavalry is actually node based behind the scenes"), with "anything can connect to
  anything" by dragging one attribute onto another.
- **Houdini HDAs, After Effects Essential Graphics, Blender node-group inputs, Niagara
  "bubble-up"**: the same *promotion* pattern everywhere — experts ship power as a panel of a few
  knobs. Our recipes-with-inputs are this.
- **After Effects pick-whip** and Blender drivers: the wire gesture without a canvas ("from
  another value" here).
- **Cinema 4D MoGraph fields**: "varies by distance from that thing" as a *draggable shape in the
  viewport* — zero abstraction. §6.1's handles for `fields.distance` / `attract` / `vortex` are this.
- **Roblox Studio's own** NumberSequence/ColorSequence editors are what the audience already
  knows; the ghost strip and gradient bars must feel like them.
- **Dreams** (Media Molecule) is the only kid-facing precedent; its tweak-menu-on-everything is the
  right model, and it still needed wires for logic and "time to learn" — evidence that hiding wires
  behind *properties* (not behind a simpler canvas) is what matters.

Skeptical note carried over from the survey: nobody has *measured* a 12-year-old reaching a
354-node ceiling through menus; the evidence is that adults prefer stacks for the common case and
tolerate graphs for the rest, and that a recursive per-property menu is the only surveyed mechanism
claiming near-full power without a canvas.

### 10.2 HCI research, ranked by how much it constrains this design

1. **One source of truth, several bidirectional views** (Sketch-n-Sketch 2016, Apparatus 2015,
   Hazel 2019). The graph stays; the child never has to see it.
2. **Typed slots with holes, never errors** (Scratch: blocks only snap where they fit; Hazel: every
   state is well-typed and still runs). PNX's `canConnect` + `defaultFrom` + "missing attribute is
   never an error" already give this.
3. **Immediate deterministic feedback** (Victor's *Learnable Programming*, Resnick's
   tinkerability). The engine's determinism is the enabler.
4. **Show alternatives as rendered previews, not names** (Design Galleries 1997, Side Views 2002,
   Juxtapose 2008, Lee et al. 2010: gallery-made designs rated higher). §5.3's thumbnails.
5. **Direct manipulation only where the mapping is one-to-one** (Shneiderman 1983; Myers 1992 on
   why demonstrational inference fails: it guesses and cannot be seen or edited). §6.3's rule.
6. **Cognitive Dimensions** (Green & Petre 1996 measured 508 s in LabVIEW vs 63 s in Basic to
   insert code, from rewiring viscosity): a property panel beats a graph on every dimension except
   hidden dependencies, which §5.4's backlinks repair.
7. **Strokes carry path and timing** (Draco 2014 — a sketch-based particle system; K-Sketch 2008:
   3× faster, half the learning time vs PowerPoint). "Along a path I draw" and the ghost strip.
8. **Start from a living example; create by reacting, then abstract** (Victor; Kid Pix's "no
   manual"; Carroll's training wheels: novices with advanced functions walled off learned faster).

Three documented failure modes designed against: inference that cannot be seen or edited (§6.3);
graph viscosity re-imported through a "fallback" canvas (the canvas is a *view*, never the
place edits must happen); ambiguity in output-directed editing (no inverse-problem handles).

### 10.3 What Roblox VFX creators actually make, and where it hurts

From the creator docs, 25 DevForum threads and 500 r/robloxgamedev posts/comments (2025-07 →
2026-09), read via the Arctic Shift API (full report and quotes in the research file):

- **The native boundary.** In a Roblox `ParticleEmitter` only **Colour, Size, Transparency and
  Squash** can vary over a particle's life (sequences, ≤ 20 keypoints). **Lifetime, Speed, Rotation,
  RotSpeed** are random ranges fixed at birth. Everything else — Rate, SpreadAngle, Acceleration,
  Drag, light, shape, texture — is a per-emitter constant. So "slow down then flare" needs a
  script or stacked emitters in Studio. This is exactly `bake.js`'s `sequence / range / perFrame`
  split, and it is why the source menu's Roblox badge (§5.3) matters: the Sheet tells a user
  *before* they choose that "size over life" plays natively and "speed over life" will be baked.
- **What gets made, ranked:** slash/sword arc (a Blender arc mesh, Neon, tweened Size/Transparency
  — or a flipbook), aura (2–4 locked emitters + a ring beam + Highlight), explosion (`Emit()` bursts
  + flipbook smoke + sparks + a shockwave ring tween + a light tween), shockwave/ground crack (a ring
  mesh tweened 0→N), impact (sparks + flash + Highlight "impact frames" + camera shake), orb/charge
  (Sphere shape, ShapeInOut Inward), beam/laser (scrolling TextureSpeed), trails/dash, portal, and
  ambient (fog, embers, rain). §9's walkthroughs cover all ten.
- **The pipeline convention:** a "VFX model" of attachments whose emitters carry
  `EmitCount / EmitDelay / EmitDuration` attributes, a small module that walks them, `Emit()`s and
  tweens meshes, triggered from animation keyframe markers. The Sheet's exporter should emit this
  convention so an effect fires from an animation without code — the single most-asked question in
  both communities is "how do I fire particles at frame N of my animation without Moon Animator or
  a script".
- **Pain, classified** (verbatim quotes in the research file): (a) which property does what —
  "How do you guys make great VFX despite simple settings on Particle Emitter?"; (b) textures —
  "I know about After Effects but it's very expensive for me"; (c) mesh shapes — "my only issue is
  making the vfx", "Blender … harder to set up"; (d) timing — "how to trigger particle effects at a
  certain point of my animation"; (e) looking good — "i cant imagine making more specific vfx with
  just particles… SOMEONE HELP"; (f) scripting — a plugin author had written "13 thousand lines of
  animation code" for VFX before building a tool.
- **The tool landscape:** every well-liked plugin's headline feature is a Bézier curve editor
  (VFX Suite, Visulie, Beziers, Effect Designer Suite); the free one beginners reach for (VFX
  Studio) "has all these scripts that don't really have any indication on what they are actually
  meant to do"; and **the audience refuses paid plugins and cannot pay in USD** — a free core, no
  card, is a hard requirement Cadence already meets.
- **Consequences for this design:** (1) the hover thumbnails and `teach` lines answer (a)
  directly; (2) "draw one / build one" textures and a flipbook builder answer (b) without After
  Effects; (3) parametric slashes, rings, cones and spirals answer (c) — **but PNX refuses to export
  a mesh pass** because Roblox cannot build a mesh at runtime. The fix is not approximation: Cadence
  already publishes Models through Open Cloud (used on Defend or Die), so a parametric VFX mesh can
  be uploaded once as an asset and the exported Luau tweens its Size/Transparency/CFrame — exactly
  what the community does by hand. That is a §13 item, not a Sheet feature; (4) closing
  "Send-to-Animator refuses procedural effects" makes the animator's timeline the one timeline for
  the whole hit, which answers (d) and (f).

### 10.4 Kids' creative tools

Scratch's first-session design ("click a stack of blocks and it starts to execute immediately";
blocks only fit where they make sense; "it's OK to be a little messy"), Dreams' emitter that
"emits any element you point at", Media Molecule's warning against "endless menus, endless
sliders", Canva's evidence that a blank canvas is where novices stall, Lens Studio's templates
"structured from the simple to complex", and Snap!'s lesson that a ceiling is raised by letting
user-made abstractions look like built-ins — each is reflected in §5–§6 above. The counter-example
worth remembering is Fortnite Creative: a preset device with four knobs and, for anything custom, a
second product (UEFN + Niagara). A discontinuous ladder is what this design avoids: the same
document all the way up.

## 11. Alternatives considered, and which constraint each fails

| Alternative | Fails | Why |
| --- | --- | --- |
| Natural-language / LLM authoring as the primary way | C1 | A model's reading of "make it feel more magical" is estimation by definition; also a runtime dependency other users cannot be assumed to have. Kept only as an optional *client* of the graph whose edits appear as Sheet diffs (§13.5). |
| A bigger preset library with sliders | C3 | A ceiling, however high. Presets survive only as recipes that open fully expanded. |
| Scratch-style puzzle blocks | C2 partly | Blocks are still organised by *operation* and by control flow; VFX is dataflow over things. The Sheet keeps Scratch's typed-slot idea and drops the block chrome. |
| Pure direct manipulation (everything by handles) | C3 | Not every value has a spatial handle ("rate depends on noise"); handles cover the spatial half and the ghost strip covers the over-life half. |
| A fixed module stack (Shuriken/Niagara-style) as the data model | C3, and a migration | A stack fixes stage order and module vocabulary; the recursive slot is strictly more general and, as a *view*, needs no second document format. |
| A better node editor (tutorials, templates, node previews) | C2 | Every survey and the Cognitive Dimensions result say the barrier is the canvas itself, not the tooltips. |

## 12. Risks and honest limits

- **Phrase quality.** The automatic rendering is complete but reads like a form until `phrase`
  templates exist for the ~60 nodes the menus use most. This is writing, not engineering, and it is
  incremental.
- **Thumbnails cost.** 2–15 ms each today; a graph with a heavy simulation at a late frame could
  reach 100 ms. Render lazily, at a fixed early frame, cap at 12, cache by (graph hash, candidate).
- **The engine's own gaps are the Sheet's gaps**, and the Sheet must say so on the slot: no
  sub-emission (spawn on death/collision), no neighbour interaction, no pyro or volume rendering,
  no runtime mesh export to Roblox, beams approximate trails. Part 78 applies: no menu entry for a
  thing that does not work.
- **Inverse-problem temptation.** Someone will ask for "drag the particle to where it should be at
  50 %". The answer is the path shape, not a solver (§6.3).
- **Two clocks.** The ghost strip and the timeline must look unmistakably different (different
  colour, different ruler labels: "one particle's life" vs "the effect").
- **Three document modes.** Today the studio has layer docs, v1 graphs and PNX graphs, exclusive,
  with documented UI-lies risks. The Sheet is PNX-only. Recommendation (a product decision for the
  user): make PNX the only authoring mode going forward; each of the 6 layer types and 8 modifiers
  is expressible as a recipe, and old docs keep loading read-only.

## 13. Implementation plan against the codebase

Nothing here touches the engine's semantics. Phases are independent enough to ship one at a time,
each with a smoketest step, in the order that gives a usable tool soonest.

1. **Projection module** — `renderer/js/pnx/sheet.js` (pure, Node-loadable like every PNX
   module): `projectGraph(graph, scope) → { things, named, unused }` — the algorithm in
   `tools/effect-sheet-proof.mjs`, with `variesWith()` and the per-type feeder lists. Tests in
   `test/pnxtest.mjs`: coverage = 100 % on the starter, on every recipe, and on a randomly wired
   graph (property test: every non-boundary node appears exactly once).
2. **Source-menu recipes** — extend `renderer/js/pnx/library.js` with the entries in §5.3, each
   in the existing recipe format plus `menu: { slotType, label, order }` and a `preview`
   hint. Test: every menu recipe builds against the live registry; every slot type has ≥ 6 entries;
   every entry's `exportSupport` badge is computed, never typed.
3. **The Sheet panel** — `renderer-vfx/js/effectSheet.js`, replacing the procedural inspector's
   contents in PNX mode. Rows generated from `projectGraph`; slot controls reuse
   `pnxNodeEditor.js`'s `buildControl` (extract it to `renderer-vfx/js/pnxControls.js` so both
   editors share one factory — the Part-79 rule on the UI side). Source menu = thumbnails rendered
   by evaluating a `structuredClone` of the graph with the recipe applied, at `min(frame, 20)`,
   through the existing `pnxBackend` into an offscreen canvas.
4. **Stage handles** — `renderer-vfx/js/pnxHandles.js`: the (type, unit, label) → handle table of
   §6.1, drawn with three.js `TransformControls`-style gizmos in `preview.js`; commits through
   `ST.mutatePnx` with `beginGesture`/`endGesture` (one undo step per drag, as the clip timeline
   does).
5. **Hero particle strip** — `renderer-vfx/js/heroStrip.js`: samples fields at five life values,
   reads one particle id's trajectory from the solver's checkpoints, and edits curve/gradient keys.
6. **Add a thing / recipes open expanded** — presets panel: replace "Start a Procedural Effect" and
   the old preset grid, in PNX mode, with the thing gallery and recipe gallery (live thumbnails).
7. **Parity test** — smoketest: Sheet "anything else" list ≡ node-editor palette ≡ MCP catalogue.
8. **Phrases** — add `phrase` to the ~60 most-used node definitions; Golden-Rule review.
9. **Optional AI client** — an MCP-driven or local-model assistant that edits the same graph; the
   Sheet highlights changed slots. Off by default; never required.

**Do not build:** any "interpret this drawing/prompt into an effect" path; any handle that solves an
inverse problem; any menu entry for an unimplemented capability; a second data model.

## 14. Decisions for the user

1. **Name.** "Effect Sheet" is the working name (a sheet you read). Alternatives: Plain View,
   Recipe View, Story.
2. **PNX-only authoring** (retire the layer inspector and the v1 graph as authoring modes, keep them
   loadable). Recommended.
3. **Whether to add the optional AI client at all** (§13.9). Recommended: later, off by default.

---

## Appendix A — generated sheets (output of `tools/effect-sheet-proof.mjs`, unedited)

The text below is produced with no hand-written per-node text. Labels, units, options and teaching
lines come from the registry; numbers come from the graph.

```
### STARTER GRAPH (what "New procedural effect" opens)
• Sprite Renderer  — Turns points into visible puffs or sparks. The commonest way to draw particles.
  Particles / Points: Simulate Particles (its Particles)
    Emitter: Emitter
      Spawn from: Sphere
        Radius: 0.4 studs
        Segments: 12
        Rings: 6
      Where on it: surface  ▾
      Rate: 34 per second
      Burst count: 0
      Burst at: 0 seconds
      Lifetime: 1.6 seconds
      Initial velocity: (0, 4, 0) studs/second
      Mass: 1
      Initial attributes: (nothing)
    Force: Constant Direction
      Direction: (0, -1, 0)
      Strength: 6
    Drag: 0.6
    Kill when: no
    Colliders: (nothing)
    Particle limit: 4000
    Substeps: 1
    Die of old age: yes
    Start at frame: 0
  Material: Material
    Base colour: Sample Gradient
      Gradient: gradient #fff6e0 → #ffb040 → #c02808 → #200400
      Position: «Normalized Age»
    Emission: ■ rgb(0,0,0)
    Opacity: 0.35
    Blending: additive  ▾
    Roughness: 0.5
    Metallic: 0
    Normal: (0, 0, 1)
    Texture: (nothing)
    Double sided: yes
    Write depth: no
  Size: Evaluate Curve
    Curve: curve 0.05@0 → 0.45@0.2 → 0@1
    Position: «Normalized Age»
  Rotation: 0 degrees
  Facing: camera  ▾
  Locked axis: (0, 1, 0)
  Soft edges: yes
  Flipbook columns: 1
  Flipbook rows: 1
  Flipbook timing: life  ▾
  Flipbook rate: 24 per second
Values used in several places:
  «Normalized Age» = Normalized Age  — Counts from 0 when the particle is born to 1 when it dies, whatever its lifetime is.
```

```
### SPARKS BOUNCING ON THE FLOOR
• Sprite Renderer  — Turns points into visible puffs or sparks. The commonest way to draw particles.
  Particles / Points: Simulate Particles (its Particles)
    Emitter: Emitter
      Spawn from: Point
        Position: (0, 3, 0) studs
      Where on it: points  ▾
      Rate: 0 per second
      Burst count: 150
      Burst at: 0 seconds
      Lifetime: 1.4 seconds
      Initial velocity: Multiply
        A: Random Direction In Cone
          Axis: (0, 1, 0)
          Spread: 35 radians
          Variation: 0
        B: Random Number
          Low: 8
          High: 14
          Variation: 0
      Mass: 1
      Initial attributes: (nothing)
    Force: Constant Direction
      Direction: (0, -1, 0)
      Strength: 20
    Drag: 0
    Kill when: no
    Colliders: Collider
      Shape (distance): Plane
        Position: (each particle's own position)
        Point on plane: (0, 0, 0)
        Normal: (0, 1, 0)
      On contact: bounce  ▾
      Bounciness: 0.5
      Friction: 0.2
      Thickness: 0.05 studs
    Particle limit: 2000
    Substeps: 1
    Die of old age: yes
    Start at frame: 0
  Material: Material
    Base colour: Sample Gradient
      Gradient: gradient #ffffff → #ffc040 → #ff2000
      Position: «Normalized Age»
    Emission: ■ rgb(0,0,0)
    Opacity: Subtract
      A: 1
      B: «Normalized Age»
    Blending: additive  ▾
    …
  Size: 0.12 studs
  Facing: velocity  ▾
  …
Values used in several places:
  «Normalized Age» = Normalized Age  — Counts from 0 when the particle is born to 1 when it dies, whatever its lifetime is.
```

The remaining sheets (shockwave ring, sword slash, fire texture sprite, and all nine recipes) are in
the script's output; run `node tools/effect-sheet-proof.mjs` to regenerate them.

## Appendix B — what a value can vary with (from the registry, not invented)

Input-less field readers: Sample Time · Age · Normalized Age · Position · Normal · Tangent · UV.
Per-element randomness: the Random category (12 nodes, all fields). Noise: 12 nodes. `defaultFrom`
sockets that read the sample point when unwired: position, velocity, time. That is the complete
top level of "how does it vary?", and the menu is built from it.
