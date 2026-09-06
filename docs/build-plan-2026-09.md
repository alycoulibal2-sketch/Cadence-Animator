# Build plan — "complete and premium" VFX (started 2026-09-06)

The user's ask, verbatim in spirit: *make the node system complete (everything Blender's nodes can
do), add every kind of particle, close the four gaps (realistic fire/clouds, sub-emission, flocking,
Roblox export), and make it fluid, easy to navigate, ultra user-friendly and responsive. Go above
the necessary.* The Effect Sheet design (`docs/effect-sheet.md`) is the UI half of that.

This file is the **handoff record**: what is done, what is next, and the decisions that must not be
re-litigated. Update the status column as phases land. Every phase ends green
(`node test/pnxtest.mjs` + `node test/coretest.mjs`, plus `npm run smoketest` for UI phases) and is
committed locally on its own (never pushed/released without the user).

## Rules that apply to every phase

- **No fake features (spec Part 78).** A type stays `implemented: false` until its backend exists;
  the registry refuses nodes on it. When a backend lands, flip the flag AND move the entry in
  `volume.js`'s `UNIMPLEMENTED` table (a test reads it) in the same commit.
- **Determinism under scrubbing is load-bearing.** Anything stateful uses fixed dt, zero
  `Math.random`, checkpoint replay (`solver.js`'s pattern). Tests assert four routes to a frame agree.
- **Nothing hand-maintained per node in the UI.** Controls, sheet rows, handles and menus are
  generated from registry metadata.
- **The library registers no node types.** Menus and "add a thing" entries are recipes.
- **Roblox is a bake target, not the ceiling.** Native where possible, converted where sensible,
  baked otherwise, reported always.
- Another session may share this repo: check `git status`/HEAD before each commit.

## Phases

| # | Phase | Status | Notes |
| --- | --- | --- | --- |
| 0 | Baseline + this plan | done | 224 PNX + 41 core green at `6d42a39` |
| 1 | Neighbours + flocking: spatial hash, `ctx.neighbours` query, Flock / Separation / Density / Neighbour Count / Nearest Neighbour nodes, grid-accelerated nearest point | done | 7 nodes, `spatial.js`, 10 tests; 234 PNX green |
| 2 | Events + sub-emission: `event` type implemented, Particle Events (death / collision / birth / at age / every N s), Emitter `events` input, deterministic child sims via recorded parent history | done | 1 node + 2 Simulate inputs + Emitter inputs; 9 tests; 243 PNX green |
| 3 | The Effect Sheet UI (design §13 phases 1–7): projection module, menu recipes, sheet panel, stage handles, hero strip, add-a-thing gallery, parity test | done | sheet.js + menus.js + effectSheet.js + pnxHandles.js + heroStrip.js + pnxControls.js + pnxThumbs.js; 4 MCP tools; 3 smoketest steps; 263 PNX green at ac69079 |
| 4 | Pyro + volumes: grid fluid solver (smoke/fire), `volume` type, Volume Renderer (three.js raymarch), Cloud node, Bake Volume To Flipbook for Roblox | done | fluid.js (Stam solver + combustion, checkpoints), nodes/pyro.js (Simulate Smoke & Fire, Cloud), Volume Renderer + backend raymarch (Data3DTexture, GLSL3), volume slot menu + fire/cloud things, Roblox flipbook bake + PNG save IPC; 268 PNX green; smoketest fire step lit 1957 px, bake 5.4 s |
| 5 | Geometry completeness: connectivity, marching cubes (SDF/volume → mesh), mesh→SDF, curve to mesh (sweep), fill curve, trim/subdivide/fillet/smooth, extrude/inset/subdivide/triangulate/weld/flip, primitives (cone, icosphere, grid, star, spiral, bezier), Simulation Zone + Repeat Zone, attribute statistics, mesh islands, separate/duplicate | done | mesh.js (marching TETRAHEDRA, pseudonormal mesh SDF, RMF sweep, ear clipping, Loop subdivision) + nodes/mesh.js (24 nodes); zones = two modes on every group instance (`__repeat`, `__simulate`) in evaluator.js with checkpointed replay; the stale-group-interior cache bug fixed on the way; cone = Cylinder with top radius 0, grid = Plane segments, triangulate is implicit (everything is triangles); 283 PNX green, smoketest 77/77 |
| 6 | Post effects + Roblox export upgrades: bloom/colour-grade/blur/vignette as Effect Look → three.js post + native Roblox PostEffects; mesh export as .obj + tween script; thin curve meshes → beam chains; volumes → flipbook | | |
| 7 | Node editor polish: drag-wire-to-empty-space typed search, auto-layout, minimap, node help panel, keyboard nav | | |
| 8 | Docs, memory, and the WEBSITE (site/index.html feature grid, site/docs.html sections, regenerate counts with site/tools) — the user asked for this explicitly | | |

## Decisions (do not re-open)

- Neighbour queries are a **solver-provided context function** (`ctx.neighbours(radius)`), rebuilt per
  substep from a uniform grid; neighbour forces are fields like Drag/Seek, not solver settings.
- Events are **recorded per frame on the parent simulation** (deterministic history), and a child
  emitter reads `eventsAt(frame)`; a child never runs inside the parent's step loop.
- The pyro solver is a **CPU grid at preview resolution** (32³–64³) with checkpoints; Roblox gets a
  flipbook. Volume rendering is a raymarch box in the three.js backend only.
- Mesh booleans are done **through SDFs** (mesh → SDF → union/subtract → marching cubes), never on
  triangle soups.
