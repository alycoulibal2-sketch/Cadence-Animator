# The Cadence brand

One mark: a bold **C** drawn as a motion path that arrives at two keyframe diamonds. It is the
letter of the name, the curve an animator edits, and the keyframe symbol every animation tool
shares, in the app's own indigo accent (`#7c8cff`) on its dark ground (`#0a0a0e`).

## Sources (edit these, nothing else)

| File | What it is | Where it is used |
| --- | --- | --- |
| `cadence-mark.svg` | The monochrome mark on a 64-unit grid, coloured by `currentColor`. | Inline in the site header and footer, the app title bar, the VFX Studio title bar, the mobile top bar. |
| `cadence-favicon.svg` | The mark tuned for 16 px: heavier arc and diamonds on the dark tile. | The browser tab (`site/assets/img/favicon.svg`) and every icon size at 32 px and under. |
| `cadence-icon.svg` | The app icon: the mark on a dark rounded tile with a soft glow. | Everything at 40 px and above: the Windows icon, PWA icons, touch icons, the README. |

The inline copies are pasted, not linked (the app's CSP allows no external images, and the site
makes no third-party requests), so a change to `cadence-mark.svg` must be repeated in
`renderer/index.html`, `renderer-vfx/index.html`, `renderer-mobile/index.html`, `site/index.html`
and `site/docs.html`. Search for `class="logo-mark"` and `class="brand-mark"`.

## Generated (never hand-edit)

```
npm run brand
```

runs `build-icons.js` under Electron (Chromium rasterizes the SVGs; no extra dependency) and writes:

| Output | Sizes | Consumer |
| --- | --- | --- |
| `brand/icon.ico` | 256 (PNG, first in the file: electron-builder reads the size from the first entry) + 16, 20, 24, 32, 40, 48, 64, 128 (BGRA) | `build.win.icon` in package.json: the exe, installer, uninstaller, shortcuts, taskbar. Also the dev-mode window icon (`APP_ICON` in `src/main.js`). |
| `brand/icon.png` | 512 | The README header. |
| `brand/installerSidebar.bmp` | 164 x 314 | The NSIS installer's welcome and finish pages (`build.nsis.installerSidebar`). |
| `brand/roblox/plugin-icon.png` | 512 | The plugin's own tile, for a Creator Store listing. |
| `brand/roblox/connect.png`, `status.png`, `send-selection.png`, `sync-pose.png` (+ the `.svg` each was rendered from) | 512 | One per toolbar button in `plugin/CadenceBridge.lua`. **Not uploaded** — see "The Studio plugin's toolbar" below. |
| `brand/roblox/preview.png` | contact sheet | The four button icons at 32 px and 16 px on both Studio themes. |
| `brand/preview.png` | contact sheet | Look at it after any change: every size on dark and on light, and the mark next to the wordmark. |
| `site/assets/img/favicon.svg`, `favicon.ico`, `apple-touch-icon.png` | 16/32/48; 180 | `<link rel="icon">` and `<link rel="apple-touch-icon">` in both site pages. |
| `renderer-mobile/icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` | 192, 512, 180 | `renderer-mobile/manifest.json` and the mobile page's head. The maskable one is full-bleed because the phone applies its own corner mask. |

## Rules

- The mark is always the accent colour on a dark ground, or `currentColor` when inline. No
  outlines, no drop shadows outside the app icon's glow, no recolouring per feature.
- Keep the clear space around the mark at least one diamond wide.
- The wordmark is "Cadence" in the UI font at weight 600 to 700, with "Animator" lighter and
  dimmer beside it where there is room.

## The Studio plugin's toolbar

`plugin/CadenceBridge.lua` gives Studio four toolbar buttons, and each one has an icon in
`brand/roblox/`: a plug for **Connect**, signal arcs for **Status**, an arrow leaving a baseline for
**Send Selection**, and a circular arrow for **Sync Pose**. Three of the four glyphs are the app's
own icons from `renderer/js/icons.js`, drawn on the same tile as the app icon — a bare stroke glyph
would disappear against one of Studio's two themes, and the dark tile never does. Check
`brand/roblox/preview.png` before changing any of them.

**They are not live yet.** Roblox draws a toolbar icon only from an uploaded asset, so `ICONS` at
the top of the toolbar section in `plugin/CadenceBridge.lua` holds four empty strings and every
button falls back to its emoji label. Nothing is broken while they are empty. To turn them on:

1. **Upload the four PNGs** to a Roblox account — Creator Dashboard → Development Items → Decals →
   Upload Decal, or Open Cloud's asset API with `assetType: "Decal"`. Uploading publishes them
   under that account and they go through Roblox moderation, so this is a deliberate step, not part
   of `npm run brand`.
2. **Convert each Decal id to its Image id.** This is the trap: what an upload hands back is a
   *Decal* id, and setting a Decal id as a toolbar icon fails silently — no error, the icon simply
   never appears, exactly as it does in an `ImageLabel`. Read the real id out of the Decal once, in
   the Studio command bar:

   ```lua
   for _, decalId in ipairs({ 0, 0, 0, 0 }) do -- the four ids from step 1
       local model = game:GetService("InsertService"):LoadAsset(decalId)
       print(decalId, "->", model:FindFirstChildWhichIsA("Decal", true).Texture)
   end
   ```

3. **Paste the four `rbxassetid://<imageId>` strings** into `ICONS` in `plugin/CadenceBridge.lua`
   (`connect`, `status`, `send`, `sync`). Each filled-in id also swaps that button's label from the
   emoji spelling to the plain one, so a button never shows both.
4. **Reinstall the plugin and restart Studio** — the app's Studio-offline chip reinstalls it.
