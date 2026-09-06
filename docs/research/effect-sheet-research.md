# Research behind `docs/effect-sheet.md`

Four research passes were run on 2026-09-06 to answer one question: *how can a non-expert
(11–13 years old) author any effect a 354-node procedural engine can express, without learning
nodes, and without the tool guessing?* Each pass was capped at 15 web searches. The reports are
reproduced below with their own source-quality marks: **[S]** sourced, **[K]** prior knowledge not
verified that day, **[I]** inference. Treat every URL as "as fetched on 2026-09-06".

---

## Report 1 — Prior art: power without node graphs

Evidence quality note: mechanism descriptions below are sourced unless marked *(knowledge)* or
*(inference)*. Hard learnability data (studies, usage percentages) essentially does not exist for
any of these tools; what exists is vendor rationale and practitioner consensus.

### 1. Unreal Niagara (and Cascade)

(a) Unit: a **module** in an ordered **stack** (Emitter Spawn/Update → Particle Spawn/Update →
Event Handler → Render), "processed sequentially from top to bottom"
([Niagara overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-niagara-effects-for-unreal-engine)).
(b) Vary: every module input has a **dynamic input** slot: a dropdown that replaces a constant with
a mini-function (random range, curve over age, vector op, external data), and the dynamic input's
own inputs get the same dropdown, recursively. Epic's docs: dynamic inputs "can be selected and
dropped into the stack without actually creating new modules."
(c) Dataflow without wires: modules read/write a shared **parameter map** by name
(`Particles.Position` etc.); any stack value can be flipped to a "micro-expression" (HLSL
one-liner) referencing any attribute; module parameters "can be bubbled up" to emitter/system
level and overridden there (GDC talk, 09:21).
(d) Ceiling: new behaviour = a module or Scratch Pad module, authored in the node graph. Epic's
design says the 99 % case should never need this.
(e) Epic's stated rationale (Wyeth Johnson, GDC 2018, transcript): "it began a debate for us
between the graph paradigm... and the stack paradigm... graphs are great because you get total
control... stacks are modular and they also have that at-a-glance readability... if you're not
technical I can't expect you to go in and do a whole bunch of really complex graph logic; I need
you to be able to snap behaviors together and make art, so we actually chose a hybrid"
(07:50–08:35). On Cascade: "if you're not technical there's actually a lot of power in Cascade
because I don't have to know how to program or even the fundamentals of complex math in order to
pick a behavior" (03:06); its failure was being "fixed function... if you want a new feature go
ask a programmer" (03:46). On dynamic inputs: "if you're not super technical and you're just
working in the stack we can have a huge suite of dynamic inputs that have almost all of the power
of writing new modules except you don't have to write one" (29:30). Audience split: "give you the
99% case right off the bat and then if you're more technical go ahead and dive in and deconstruct"
(44:22). [Talk](https://www.youtube.com/watch?v=mNPYdfRVPtM),
[Scratch Pad doc](https://dev.epicgames.com/documentation/en-us/unreal-engine/niagara-scratch-pad-modules-in-unreal-engine).
Caveat: designer rationale, not measured learnability; Niagara is widely regarded as harder than
Cascade *(inference from community sentiment, unsourced)*.

### 2. Unity Shuriken vs VFX Graph

(a) Unit: a fixed set of toggleable **modules** on one component (Emission, Shape, Size over
Lifetime, Noise, Trails...).
(b) Vary: every numeric property is a MinMaxCurve with a four-way dropdown: Constant / Curve /
Random Between Two Constants / Random Between Two Curves *(knowledge)*. Curves are only "over
lifetime" or "by speed", fixed per module.
(c) Dataflow: none. No links, no expressions; only C# scripting or the Custom Data module.
(d) Ceiling: anything not in the module list requires VFX Graph.
(e) Practitioner consensus: "VFX Graph has a steep learning curve, whereas Shuriken is more
straightforward" ([RealTimeVFX thread](https://realtimevfx.com/t/unity-vfx-graph-and-shuriken/15033));
"Because VFX Graph is node-based, the initial learning curve is steep"
([UhiyamaLab](https://uhiyama-lab.com/en/notes/unity/unity-vfx-graph-guide/)). No studies.

### 3. Houdini Digital Assets

(a) Unit: the asset's **parameter panel**; the network is hidden.
(b)/(c) Author drags a parameter from any inner node into the asset's Type Properties list;
Houdini rewrites the inner parameter into a **channel reference** `ch("../name")` to the promoted
one ([asset UI doc](https://www.sidefx.com/docs/houdini/assets/asset_ui.html),
[The Technical Artist](https://thetechnicalartist.com/houdini/hdas.html)). Any parameter field can
hold an expression referencing any other parameter — dataflow by *text reference*, not wires
*(knowledge)*.
(d) Ceiling: anything not promoted requires "Allow Editing of Contents" and the network.
(e) The Houdini Engine business (HDAs inside Unity/Unreal as parameter panels for non-Houdini
users) is the existence proof that this pattern works for downstream non-experts *(inference)*.

### 4. After Effects, Essential Graphics, Trapcode

(a) Unit: a **layer** with an ordered **effect stack**. (b) Keyframes; or an expression per
property. (c) The **pick-whip** — drag from a property to another property; AE writes the
expression text ([School of Motion](https://schoolofmotion.com/blog/after-effects-expressions-what-you-need-to-know-to-get-started)).
"Expression controls" act as user-defined knobs. **Essential Graphics** is AE's HDA
([Adobe](https://helpx.adobe.com/after-effects/using/creating-motion-graphics-templates.html)).
(d) Beyond pick-whip = JavaScript. (e) No survey found giving a percentage of AE users who write
expressions; the claim "most never do" is unsupported. Trapcode Particular: parameter list plus a
**Designer** window with instant preview and draggable preset blocks
([postPerspective](https://postperspective.com/tag/trapcode-particular/)).

### 5. Dreams and LittleBigPlanet

(a) Any object or **gadget** has a uniform **tweak menu**; "logic elements are little tiles you
place in the game world and contain their own menus to tweak, and these tiles are linked up by
wires" ([Engadget](https://engadget.com/2018/05/21/dreams-makes-imagination-manifest-on-the-ps4)).
(c) Dreams **does** use wires, in 3D space, but wire targets are tweak-menu sliders, not graph
sockets; microchips group logic
([Dreamschool](https://dreamskool.wordpress.com/2019/02/18/logic-gadgets-microchip/)).
(e) Media Molecule: "perfect for kids... you're working with sliders and menus rather than lines of
code" ([Game Informer](https://gameinformer.com/2018/10/17/how-media-molecule-hopes-dreams-can-go-beyond-just-games)).
Retrospective: "relatively easy to use (so long as you were willing to put the time in to learn
it)" ([Inverse](https://www.inverse.com/gaming/dreams-anniversary-five-years-playstation-media-molecule)).

### 6. Cinema 4D MoGraph Fields

An **effector** with a **Field list**; a field is a scene object (linear, spherical, radial,
sound, spline, shader, formula...) producing 0–1 per clone; fields layer with blend modes plus
modifier layers ([Maxon](https://www.maxon.net/en/cinema-4d/features/fields-system)); selecting a
field selects it in the viewport for dragging
([help](https://help.maxon.net/c4d/2026/en-us/Content/html/OEDELAY-FALLOFF_GROUPFALLOFF.html)).
"Varies by distance from that thing" expressed as a draggable shape is the one pattern with zero
abstraction *(inference)*.

### 7. Cavalry

**Layers** with **Behaviours** added by "right-click any attribute"; 40+ behaviours
([School of Motion](https://schoolofmotion.com/blog/getting-started-with-cavalry-5-things-every-beginner-should-know)).
Drag one attribute onto another; "while Cavalry's UI offers Layer based interactions, Cavalry is
actually 'node based' behind the scenes"
([Cavalry docs](https://cavalry.studio/docs/getting-started/key-concepts/connections/)). "Anything
can connect to anything." SoM: "interface has a one-day learning curve." Cavalry is the closest
existing instance of the hypothesis: a full graph engine with a layer/property-panel UI.

### 8. Blender

Ordered **modifier stack** ("six modifiers for 90 % of beginner projects",
[Medium](https://medium.com/@royaldanecreates/the-blender-modifier-stack-a-visual-guide-for-confused-beginners-8bdb5d65f853));
drivers link any property to any other *(knowledge)*; a node group's Group Inputs appear as fields
in the modifier panel *(knowledge)*; Blender plans to convert the stack to nodes
([design task](https://developer.blender.org/T74967)). Sentiment: GN is "a wall of colored boxes
and noodly connections that looks more like a circuit diagram than a 3D scene"
([CGWire](https://blog.cg-wire.com/blender-scripting-geometry-nodes/)); learners run "back to
their familiar modifiers" ([StraySpark](https://www.strayspark.studio/blog/blender-geometry-nodes-beginners-guide-2026)).

### 9. Briefly

- **Godot 4** ParticleProcessMaterial: per property Min/Max/Curve
  ([docs](https://docs.godotengine.org/en/stable/tutorials/3d/particles/process_material_properties.html)).
- **Effekseer**: Fixed / Random / Easing / F-Curve per property *(knowledge)*.
- **EmberGen** 1.1 added "inline graphs for finer control over node parameters" — a graph nested
  inside one property, i.e. dynamic inputs ([CG Channel](https://www.cgchannel.com/2024/01/jangafx-releases-embergen-1-1/)).
- **Rive**: state machine with typed inputs as the only public surface
  ([Rive](https://help.rive.app/runtimes/state-machines)).

### 10. Roblox Studio

Size/Transparency/Squash open a NumberSequence editor: click to add keypoints, drag value, and
"drag the envelope lines up or down... particles generate at a random size between the pink
envelope" ([creator-docs](https://github.com/Roblox/creator-docs/blob/main/content/en-us/effects/particle-emitters.md));
ColorSequence is a gradient bar. Curves exist only over particle lifetime; no fields, no links.
The 11–13-year-old target already knows this editor.

### Synthesis

Every non-node power tool surveyed converges on: (1) an **ordered stack of behaviours**; (2) a
**per-property source selector**: Constant / Random range / Curve over X / Linked / Expression;
(3) **spatial gizmos** for spatial values. The correction: the strongest instances (Niagara,
Cavalry, Blender, EmberGen) are not "stack instead of graph" but **stack as a view over a graph**,
with the ceiling removed by making the graph reachable *per property* (a dynamic input is a graph
attached to one slot) rather than per effect. Patterns not in the original hypothesis: **recursive
source menus** (Niagara); **bubbling/promotion** (Houdini, AE, Blender, Niagara); **named shared
attributes** (Niagara parameter map, Cavalry); **pick-whip**; **copy-as-reference**;
**direct-manipulation falloff shapes** (C4D). The consistent complaint about graphs is visual
("circuit diagram"); the consistent praise for stacks is "at-a-glance readability". Nobody has
measured either for children.

---

## Report 2 — HCI and end-user-programming research

### 1. Bret Victor

Principle: see the data at every step, see comparisons, start from something concrete and *react*
to it, abstract only after the concrete case works; the picture on screen is the handle on the
program. Evidence [S]: *Learnable Programming* (2012, http://worrydream.com/LearnableProgramming/)
— read the vocabulary, follow the flow, see the state, *create by reacting*, *create by
abstracting*. *Drawing Dynamic Visualizations* (2013,
http://worrydream.com/DrawingDynamicVisualizationsTalk/): every drawing action is a step in a
visible, parameterised procedure. *Magic Ink* (2006, http://worrydream.com/MagicInk/). *Inventing
on Principle* (2012, https://vimeo.com/36579366): scrubbable numbers, trails showing the whole
trajectory. Argued essays with worked demos, not controlled studies.

### 2. Direct manipulation, the gulfs, programming by demonstration

Shneiderman 1983, "Direct Manipulation: A Step Beyond Programming Languages", IEEE Computer 16(8)
(https://doi.org/10.1109/MC.1983.1654471): continuous representation, physical actions, rapid
incremental reversible operations. Hutchins, Hollan & Norman 1985 and Norman 1988: gulf of
execution / evaluation. Myers 1992, "Demonstrational Interfaces: A Step Beyond Direct
Manipulation" (https://dl.acm.org/doi/10.1109/2.153286; https://acypher.com/wwid/Chapters/26Demonstrational.html):
the system may generalise wrongly and the user cannot see what it inferred; inferred programs
often have no static representation; users cannot tell what the system can do; per-inference
confirmation annoys. Myers & McDaniel 2001 ("Sometimes you need a little intelligence, sometimes
you need a lot"): macro recorders are predictable but weak; inference buys power at the cost of
predictability.

### 3. Bidirectional, projectional and structure editing

Chugh et al. 2016, "Programmatic and Direct Manipulation, Together at Last", PLDI
(https://dl.acm.org/doi/10.1145/2980983.2908103): dragging output shapes is translated into edits
to program constants; the central difficulty is *ambiguity*, handled with heuristics, "freeze"
annotations, and offering alternatives. Mayer, Kunčak & Chugh 2018 (https://dl.acm.org/doi/10.1145/3276497).
Schachman's *Apparatus* (2015, https://aprt.us/): outline panel = nested attributes + expressions +
named variables. Jacobs et al. 2017 (Para, CHI Best Paper, https://dl.acm.org/doi/10.1145/3025453.3025927)
and 2018 (Dynamic Brushes, https://dl.acm.org/doi/10.1145/3173574.3174164): multi-week studies
with professional artists; direct-manipulation constraints had lower entry cost, representational
tools higher expressiveness. Hazel — Omar et al. 2017 POPL (https://dl.acm.org/doi/10.1145/3009837.3009900);
Omar, Voysey, Chugh & Hammer 2019 POPL (https://arxiv.org/pdf/1805.00155): every editor state is
well-typed because missing pieces are *holes*, and programs with holes still evaluate. JetBrains
MPS (https://www.jetbrains.com/mps/); Voelter et al. 2014.

**The DAG-as-let-bindings claim [S, standard PL]:** a DAG whose nodes each have one consumer prints
as nested expressions; a node with fan-out must be named once and referenced.

### 4. Resnick, Scratch, tinkerability

Resnick et al. 2009, "Scratch: Programming for All", CACM 52(11)
(https://doi.org/10.1145/1592761.1592779); Maloney et al. 2010, ACM TOCE 10(4)
(https://doi.org/10.1145/1868358.1868363): liveness, no error dialogs, fail-soft, palette shows
every block. Resnick & Rosenbaum 2013, "Designing for Tinkerability": immediate feedback, fluid
experimentation, open exploration.

### 5. Green & Petre's Cognitive Dimensions

Green & Petre 1996, JVLC 7(2) (https://www.sciencedirect.com/science/article/abs/pii/S1045926X96900099)
— evaluates two dataflow node languages: inserting new code took 508 s in LabVIEW and 194 s in
Prograph versus 63 s in Basic (viscosity from rewiring).

| Dimension | Node graph | Property-with-source panel | Direct manipulation |
|---|---|---|---|
| Viscosity | high (rewire) [S] | low [I] | lowest for spatial params [I] |
| Visibility | poor: off-screen wires [S] | good if every property has a row [I] | spatial params only [I] |
| Hidden dependencies | explicit but long-range [S] | needs "used by N" backlinks [I] | invisible unless drawn [I] |
| Premature commitment | layout + port order [S] | low [I] | low [I] |
| Abstraction gradient | groups required [S] | "named value" is the single step [I] | none [I] |
| Role-expressiveness | node names [S] | property names *are* roles [I] | glyph shape = role [I] |
| Error-proneness | dangling/mistyped ports [S] | typed slots prevent [I] | constrained handles prevent [I] |
| Progressive evaluation | needs preview nodes [S] | live render per edit [I] | inherent [I] |

### 6. Spacetime constraints and sketch-based animation

Witkin & Kass 1988, "Spacetime Constraints" (https://dl.acm.org/doi/10.1145/54852.378507).
Thorne, Burke & van de Panne 2004, "Motion Doodles" (https://www.cs.ubc.ca/~van/papers/2004-siggraph-motiondoodles.pdf).
Davis, Colwell & Landay 2008, "K-Sketch" (https://dl.acm.org/doi/10.1145/1357054.1357122): 3×
faster than PowerPoint, half the learning time. Kazi et al. 2014, "Draco: Bringing Life to
Illustrations with Kinetic Textures" (https://rubaiathabib.me/2013/12/31/draco/): a sketch-based
particle system — emitters + per-particle motion + global motion paths; shipped as Autodesk
SketchBook Motion. Kitty (UIST 2014), Vignette (CHI 2012), Energy-Brushes (Xing et al. UIST 2016,
https://dl.acm.org/doi/10.1145/2984511.2984585). Zhang et al. 2025, "KinemaFX", UIST
(https://arxiv.org/html/2507.19782): non-experts (n=16) authored particle effects via text + drawn
trajectory; "simple graphical input cannot express complex kinematic intent" is the stated limit.

### 7. Galleries and alternatives beat names

Marks et al. 1997, "Design Galleries" (https://www.researchgate.net/publication/220720426). Terry &
Mynatt 2002, "Side Views" (https://uist.acm.org/archive/html/proceedings/2002.html). Terry et al.
2004 (https://dl.acm.org/doi/10.1145/985692.985782). Hartmann et al. 2008, "Juxtapose"
(https://dl.acm.org/doi/10.1145/1449715.1449732). Dow et al. 2010
(https://hci.stanford.edu/publications/2010/parallel-prototyping/ParallelPrototyping2010-final.pdf).
Lee et al. 2010, "Designing with Interactive Example Galleries" (https://dx.doi.org/10.1145/1753326.1753667):
designs made with example galleries were rated higher.

### 8. Onboarding without tutorials

Hickman, "Kid Pix: The Early Years" (http://red-green-blue.com/kid-pix-the-early-years): "no
manual"; features "explain themselves through use". Carroll & Carrithers 1984, "Training Wheels in
a User Interface", CACM 27(8): novices with advanced functions blocked learned faster; the control
group spent about a quarter of its time recovering from errors. Nielsen: recognition over recall;
progressive disclosure (https://www.nngroup.com/articles/progressive-disclosure/).

### Ranked principles

1. One source of truth, many bidirectional views. 2. Typed slots with holes, never errors.
3. Immediate, deterministic feedback on every change. 4. Show alternatives as rendered previews,
not names. 5. Direct manipulation only where the mapping is one-to-one. 6. Constraints over
keyframes for "make it go through here". 7. Strokes carry path and timing. 8. Start from a living
example; create by reacting, then abstract.

### Three documented failure modes

1. Inference that guesses and cannot be seen or edited. 2. Viscosity and hidden dependencies of
node graphs — exposing the graph "as a fallback" re-imports the failure. 3. Ambiguity in
output-directed editing — a drag that could change several upstream values must present the
candidates, not pick one.

---

## Report 3 — Kids' creative tools: onboarding evidence

### (a) Recurring onboarding mechanics

1. **Start inside a living example; the first click produces motion.** Resnick et al. 2009: "Just
   click on a stack of blocks and it starts to execute its code immediately... Children can start
   by simply tinkering with the bricks" [S] https://web.media.mit.edu/~mres/papers/Scratch-CACM-final.pdf.
   Canva: "Without templates, a new Canva user sees only a blank canvas" [S, secondary]
   https://growthcasestudies.com/p/canva-templates. "Templates have been shown to help novices in
   a variety of design tasks" [S] https://arxiv.org/pdf/2305.00937.
2. **No wrong states.** "Scratch blocks are shaped to fit together only in ways that make
   syntactic sense" [S]. Counter-example: Godot's GPUParticles2D shows "only a white dot... and a
   warning icon" until a material is assigned [S]
   https://github.com/godotengine/godot-docs/blob/master/tutorials/2d/particle_systems_2d.rst.
3. **Tinkering is sanctioned; mess is allowed.** "It's OK to be a little messy and experimental" [S].
4. **Few big controls, not endless sliders.** Media Molecule's Jon Eckersley: "The things that,
   for me, make traditional tools really intimidating are endless menus, and endless sliders, and
   endless settings" [S] https://www.gamedeveloper.com/design/how-media-molecule-designed-a-fun-and-robust-toolset-for-i-dreams-i-.
5. **A remix ladder.** Dreams: users "might initially remix existing assets before progressing to
   creating original" work [S]; Scratch's remix culture [S].
6. **Wide walls measured.** Dasgupta & Hill: causal evidence that widening walls increases
   engagement and learning [S, snippet] https://medium.com/hci-design-at-uw/testing-the-wide-walls-design-principle-in-the-wild-bbb3487fbbb3.
7. **Templates simple→complex as the teaching device in node tools.** Lens Studio's VFX
   template: "structured from the simple to complex VFX" plus "Empty VFX" vs "Simple Emitter VFX"
   [S] https://developers.snap.com/lens-studio/features/graphics/particles/vfx-editor/vfx-templates/vfx.
   Effect House: "pre-built visual scripting subgraphs called Interactions" [S]. No study says nodes
   are the barrier; both platforms' remedial features are the implicit admission [I].

### (b) Beginner particle UIs and their unit of manipulation

| Tool | Unit | Ceiling |
|---|---|---|
| Fortnite Creative VFX Spawner | a list of 50+ presets; knobs: loop/burst, tint, rate, time [S] https://dev.epicgames.com/documentation/fortnite/using-vfx-spawner-devices-in-fortnite-creative | Hard stop; custom = UEFN + Niagara (a second product) |
| Dreams | an **emitter gadget that emits any object you point at**: "attach the dashed line to any element in your scene to select it as the template object" [S] https://dreamskool.wordpress.com/2019/02/25/logic-gadgets-emitter/ | effects = sculpts + emitter + gadgets |
| LittleBigPlanet 2 | emitter emits captured objects; Microchip hides logic on the object [S] | wires on the chip |
| GDevelop | property panel on an object [S] https://wiki.gdevelop.io/gdevelop5/objects/particles_emitter/ | events sheet |
| GameMaker | built-in particle editor, "preview them in real-time" [S] | GML |
| Godot | inspector + ParticleProcessMaterial [S] | shaders |
| Lens Studio / Effect House | node graph + templates [S] | unlimited |
| Roblox ParticleEmitter | properties panel + sequence editors [K] | scripting |

### (c) Where kids hit the ceiling

- **Scratch**: "We plan to keep our primary focus on lowering the floor and widening the walls,
  not raising the ceiling" [S]. Snap!/BYOB raised it by making blocks first-class [S]
  https://snap.berkeley.edu/about; the ceiling-raiser was *user-defined abstractions that look
  like the built-ins*.
- **Dreams**: "things become tricky when moving into animation, trigger points, and logic" [S]
  https://screenrant.com/dreams-review/.
- **Roblox Studio** (CHI 2025, 18 teen devs, mean age 16.3): entry is by asking; scripting
  problems required expert input [S] https://arxiv.org/html/2502.18120.
- **Fortnite**: the device caps at presets; Epic shipped a second product rather than raising the
  device's ceiling — a discontinuous ladder [I].

### (d) Five mechanics to copy

1. Open on a running effect; every "New" is a living preset, never an empty emitter.
2. Pick-what-to-spray by pointing (Dreams' emitter emits a thing you already have).
3. Few big knobs with live drag, wide range; everything else behind "more".
4. Presets are collapsed groups; "open it" reveals the real graph; a kid can save their own and it
   appears next to the built-ins (Snap!'s lesson).
5. Example gallery as the manual, ordered simple→complex, each openable and editable.
Supporting rule: **no invalid state is constructible in the simple layer** — every slot has a
default that renders.

---

## Report 4 — Roblox VFX practice and pain points

Sources: Roblox creator docs (fetched), 25 DevForum threads (read via the `.json` endpoint),
r/robloxgamedev via Arctic Shift (400 posts + 100 comments, 2025-07 → 2026-09), Google
autocomplete, 12 web searches. **[S]** = sourced, **[I]** = inference.

### 1. The toolbox and the "varies over life" boundary [S]

**ParticleEmitter** (https://create.roblox.com/docs/reference/engine/classes/ParticleEmitter)

| Varies over each particle's life natively | Random per particle at birth, then fixed | Constant for the whole emitter |
|---|---|---|
| **Color** (ColorSequence), **Size**, **Transparency**, **Squash** (NumberSequence; Size/Transparency have an envelope); flipbook frame | **Lifetime, Speed, Rotation, RotSpeed, FlipbookFramerate** (NumberRange) | Rate, SpreadAngle, Acceleration, Drag, WindAffectsDrag, VelocityInheritance, LockedToPart, ZOffset, TimeScale, Brightness, LightEmission, LightInfluence, Orientation, Shape (Box/Sphere/Cylinder/Disc), ShapeStyle, ShapeInOut, ShapePartial, EmissionDirection, Texture/TextureContent, FlipbookLayout (None/2x2/4x4/8x8/Custom), FlipbookMode, FlipbookSizeX/Y (1-64), FlipbookStartRandom, FlipbookBlendFrames, Enabled |

Methods: `Emit(n)`, `Clear()`. Limits: Lifetime ≤ 20 s, Rate ≤ 400/s (100/s mobile), flipbook
≤ 30 fps (https://create.roblox.com/docs/effects/particle-emitters); sequences capped at 20
keypoints (https://devforum.roblox.com/t/188572).

**The boundary that matters:** only colour, size, transparency and squash can curve over a
particle's life. Speed, rotation speed, drag, acceleration, rate, light and spread are per-emitter
constants — "slow down then flare", "spin up", "burst then linger" need scripts, stacked emitters,
or a custom particle system (Lumina's author: "Roblox is just not a good place to make vfx",
https://devforum.roblox.com/t/2963557).

**Beam**: Color/Transparency are sequences **along the beam**, not over time; Width0/1,
CurveSize0/1, Segments, Texture, TextureLength, TextureMode, **TextureSpeed** (the only native
animation), LightEmission/Influence, Brightness, FaceCamera, ZOffset. **Trail**:
Color/Transparency/WidthScale along the trail; Lifetime, Min/MaxLength, Texture*, Light*.
**Highlight**: all constants; 31 simultaneous limit. **PointLight/SpotLight**: Brightness,
Color, Range (≤60), Shadows, Angle — constants. **Mesh VFX**: MeshPart/SpecialMesh (Neon or
textured) with Size/CFrame/Transparency tweened by TweenService; TweenService cannot tween
sequences — Visulie sells precisely that (https://devforum.roblox.com/t/3582453).
**Attachments**: the "VFX Root" pattern is the accepted answer for playing effects during
attacks (https://devforum.roblox.com/t/3223497).

**New in 2025-2026 [S]:** Custom Flipbook Layouts (Oct 2025, https://devforum.roblox.com/t/4005128);
TextureContent; Texture Streaming (Dec 2025 — server-emitted particles "have a chance to
straight up just not emit because the texture takes too long to load",
https://devforum.roblox.com/t/4144855); 4K textures (Jan 2026); Creator Store "Visual Effects"
category (Apr 2026). No new ParticleEmitter/Beam/Trail properties beyond flipbooks.

### 2. What gets made, and how (ranking [I], recipes [S])

Autocomplete demand: "roblox explosion vfx tutorial", "mesh vfx", "aura vfx", "slash vfx",
"sword slash vfx", "how to make roblox vfx textures", "roblox vfx pack free".

1. **Slash / sword arc** — Blender arc mesh (cylinder → subdivide → SimpleDeform 360°,
   https://devforum.roblox.com/t/vfx-tutorial-roblox/872437) with Neon or a slash texture,
   tweened Size/Transparency/CFrame; or a flipbook slash sheet (https://devforum.roblox.com/t/3894239).
2. **Aura** — 2-4 emitters on HumanoidRootPart attachments, LockedToPart, Sphere shape,
   LightEmission ≈ 1, a ring beam and Highlight.
3. **Explosion / burst** — `Emit()` bursts: a flash particle, flipbook smoke, sparks (high
   Speed + Drag + downward Acceleration), a shockwave ring mesh tween, a PointLight tween
   (https://devforum.roblox.com/t/4079170).
4. **Shockwave / ground crack** — ring mesh tweened Size 0→N and Transparency 0→1
   (https://devforum.roblox.com/t/1827644/5); floor crack/magic circle = one long-lived particle
   with Rate = 1/Lifetime (https://devforum.roblox.com/t/2938199).
5. **Impact / hit** — spark bursts (VelocityParallel + Squash), flash, "impact frames" via
   Highlight + ColorCorrection flicker, camera shake.
6. **Orb / charge** — Shape Sphere + ShapeInOut Inward; VelocityPerpendicular + tween the
   emitter part's rotation (https://devforum.roblox.com/t/1588766).
7. **Beam / laser / tornado** — Beam with scrolling TextureSpeed and tweened Width; tornado =
   "giant beams with a smoke trail texture".
8. **Trails / dash streaks** — Trail on attachments; dash wind = backward Acceleration + wide spread.
9. **Portal / magic circle** — flat texture on a Part or a rotating particle; curved beams.
10. **Ambient** — fog, embers, aurora ("northern lights using ONE particle emitter",
    https://devforum.roblox.com/t/3929731), rain over a large Part volume.

**Standard pipeline [S]:** textures from the toolbox / Photopea / After Effects → Blender for
shapes → a "VFX model" with attachments; every emitter carries attributes **EmitCount /
EmitDelay / EmitDuration** (the convention most packs share, https://devforum.roblox.com/t/1986838)
→ a module loops descendants, `task.delay(EmitDelay)`, `Emit(EmitCount)`, tweens meshes →
triggered client-side from animation keyframe markers or a RemoteEvent (SushiScripter's
81k-view guide, https://devforum.roblox.com/t/1610853). Veterans' learning advice: "Look up VFX
packs in the toolbox, and take each one apart" (https://devforum.roblox.com/t/2805022).

### 3. Pain, verbatim, classified

**(a) Which property does what** — "I know how to use very LITTLE particle emitters and all
that, but with that I can't do much." (https://devforum.roblox.com/t/2805022); "How do you guys
make great VFX despite simple settings on Particle Emitter?" (https://devforum.roblox.com/t/4138403);
"The parameter that controls how fast the particles go maxes out at 1 so I'm at a loss there."
(https://www.reddit.com/r/robloxgamedev/comments/1ukafcf/); "it tilts whenever i rotated it from
the side or downwards… nothong actually works" (https://www.reddit.com/r/robloxgamedev/comments/1stddqy/).

**(b) Textures** — "I know about after effects but its very expensive for me at this time"
(https://devforum.roblox.com/t/3546172); "I've been using after effects to attempt making these
but I'm struggling to get a grasp on how to start" (https://devforum.roblox.com/t/4029502);
VFX Loom thread replies: "pretty hard to make particles in roblox anyways" / "Let me guess, it
costs money?" (https://www.reddit.com/r/robloxgamedev/comments/1vj176i/).

**(c) Mesh shapes** — "This was very helpful! My only issue is making the vfx"
(https://devforum.roblox.com/t/1610853); "Blender is convenient... but it's harder to set up."
(https://devforum.roblox.com/t/3309490); "the tutorials present are old asf… How do I actually
learn VFX?" (https://www.reddit.com/r/robloxgamedev/comments/1ryu8gf/).

**(d) Animating / timing** — "How can I make particles emit a burst once in Moon Animator?"
(https://devforum.roblox.com/t/1625209); "how to trigger particle effects at a certain point of my
animation. I can't find anything on this topic online" (https://www.reddit.com/r/robloxgamedev/comments/1omucv7/).

**(e) Making it look good** — "The particle emitters are frustrating me even when i try to make
them good i cant… SOMEONE HELP." (https://www.reddit.com/r/robloxgamedev/comments/1m1332f/);
"How do I make a particle tornado that actually looks good?"
(https://www.reddit.com/r/robloxgamedev/comments/1p4vugp/). Autocomplete: "is roblox vfx hard",
"roblox how to make good vfx".

**(f) Scripting needed** — "When I started scripting VFX on Roblox, I couldn't find any useful
tutorials" (https://devforum.roblox.com/t/1610853); Visulie's author had written "13 thousand
lines of animation code" for VFX before building it (https://devforum.roblox.com/t/3582453).

**Editor pain:** "currently impossible to make smooth curves with NumberSequences beyond the
current limit of 20 keypoints" (https://devforum.roblox.com/t/188572); VFX Suite "UI is REALLY
small" (https://devforum.roblox.com/t/2545686).

### 4. Existing tools and what users say [S]

- **VFX Studio** (free, MIT; https://sytranom.github.io/vfx-studio-docs/) — most recommended,
  but "it has all these scripts that don't really have any indication on what they are actually
  meant to do" (https://www.reddit.com/r/robloxgamedev/comments/1vunri2/).
- **VFX Suite** (paid; 41k views) — Bézier editor; "UI is REALLY small"; USD-only ("forced to buy
  it with a card which is limited to most countries").
- **Beziers / Advanced VFX Plugin** ($7) — "sadly its not free ):" was the dominant reply.
- **Lumina** (free, node-based custom particle system; 26k views) — CPU-only, worse performance.
- **VFX Forge** (paid) — obfuscated; hard to trigger from code.
- **Visulie** ($10) — keyframes any property incl. sequences, exports Lua; "well worth the money".
- **Effect Composer Pro** ($4.99, May 2026), **Effect Designer Suite** (free OSS, Jul 2026),
  **Ros Particle Editor** (free), **VFX Loom** (2026, node texture generator, WIP).
- **Moon Animator 2** — used to *showcase* VFX; its exports don't play as in-game attacks
  (https://devforum.roblox.com/t/3917078).
- **Cadence Animator**: no public mentions found.

### 5. Implications — the five capabilities that remove the most pain [I]

1. **One timeline for the whole hit**: rig pose + `Emit()` bursts + mesh tweens + lights +
   impact frames + camera shake, exported as keyframe markers plus a Luau module using the
   EmitCount/EmitDelay convention.
2. **A real curve editor that bakes to Roblox**: unlimited keypoints, presets, copy between
   emitters, bake to ≤ 20-keypoint sequences; non-native curves bake to a tween script.
3. **Built-in texture and flipbook maker**: procedural soft-circle/ring/streak/crescent/smoke/
   noise, custom 1-64 grids, one-click upload.
4. **Parametric VFX meshes**: slash arcs, rings, cones, spirals, no Blender.
5. **Recipes plus a "why it looks flat" linter**: layer templates with live property
   explanations, the perf budget (400/s, mobile 100/s), a "deconstruct this pack" view.

Pricing finding: the audience refuses paid plugins and cannot pay USD — free core, no card, is a
hard requirement.
