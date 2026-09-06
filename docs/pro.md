# Cadence Pro — how the key works in the app

Cadence Animator is MIT. **Pro** is an optional one-time licence key ($9 for the first 100 founding
keys, $12 after) that funds the project. This file is the engineering side; the site
(`site/index.html#pricing`, `site/docs.html#pro`) is the buyer's side, and `services/license/README.md`
is the owner's set-up guide. All three describe the same thing; change one, change the others.

## What the key switches on

| | Free (always) | Pro |
| --- | --- | --- |
| Animator, rigs, IK, onion skin, Studio sync, MCP | ✔ | ✔ |
| VFX Studio, layer effects, 396 presets, layer export to Luau | ✔ | ✔ |
| Procedural engine: every node, the Effect Sheet, the node editor | ✔ (preview) | ✔ |
| **Simulation pack** — Flock, Keep Apart, Liquid Pressure, the four neighbour reads, Particle Events (sub-emission), Simulate Smoke & Fire, Cloud, Volume Renderer | yield their default + a diagnostic | ✔ |
| **Roblox export of a procedural effect** (native emitters, baked recordings, flipbook sheets) | refused with the Pro message | ✔ |
| Pro badge in the app, priority updates | | ✔ |

The pack nodes are flagged `pro: true` in their definitions (`nodes/_helpers.js` carries the flag
into the registry; `registry.catalogue()` and `describeNode()` expose it; the node palette shows a
**Pro** badge). The gate is one `if` in `evaluator.js` `_compute`: with `options.pro === false` a
flagged node returns its output type's default plus the diagnostic *"This node is part of the Cadence
Pro simulation pack…"*. The engine's DEFAULT is `pro: true` — tests, scripts and source builds are not
the place for a gate; only the studio session passes the real state (`pnxStudio.openSession`,
`pnxThumbs`), and `Evaluator.setPro()` flips it in place when a key is entered.

The export gate is in two places that both ask the main process at the moment of the click:
`renderer-vfx/js/app.js` (the Export button opens the Pro dialog instead) and
`renderer-vfx/js/pnxMcp.js` `pnx_export_lua` (throws the same message, so Claude gets the same
answer a person does). The layer-based export stays free.

## Where the key lives

`src/pro.js` (main process). `settings.json → pro: { email, key, valid, tier, since, verifiedAt,
checked }`. IPC: `pro:status`, `pro:activate(email, key)`, `pro:deactivate`; both windows receive
`pro:changed`. Activation calls `{LICENSE_API}/verify?email=&key=` (20 s timeout, so a sleeping free
Render instance gets to wake up; the error says so). Re-verification runs quietly on launch when the
last check is older than 7 days; without network the key stays active 30 days past its last good
check, then lapses until a check succeeds. Nothing else phones home.

`DEFAULT_LICENSE_API` in `src/pro.js` is empty until the licence service is deployed; while it is
empty the dialog says Pro is not open and activation is refused with that reason. `settings.json →
pro.api` overrides it per machine (self-hosters, tests). A smoketest run (`--demo-js-file=…smoketest.js`)
accepts exactly one fixed pair — `smoketest@cadence.local` / `TEST-TEST-TEST-TEST-TEST` — so the gate
can be exercised without a server; that branch does not exist outside a smoketest run.

## The dialog

`renderer/js/proDialog.js`, shared by both renderers (it takes the bridge — `window.cadence` or
`window.vfxStudio`). Opened from the command palette (**Cadence Pro: enter your key**), from the VFX
Studio export gate (with the reason), and it is where a key is removed from a PC. It injects its own
styles, so neither stylesheet needed editing.

## Honesty

The gate lives in the shipped build; anyone building from source can remove it, and the site says
so. Pro is priced as "pay the maker for the finished, updated, soon-signed app", never as copy
protection. Nothing free today moves behind the key.
