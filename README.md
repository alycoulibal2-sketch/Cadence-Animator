# Cadence Animator

A standalone Roblox animation app — animate rigs in a real desktop app (not a Studio plugin UI), then sync with Roblox Studio to bring rigs in and send finished animations back out.

## Running it

```
npm install
npm start
```

To build a Windows installer/portable exe:

```
npm run dist
```

Output lands in `dist/`.

## Connecting Roblox Studio

Cadence talks to Studio over a local HTTP bridge (`127.0.0.1:35747`) via a small companion plugin.

1. In the app, click the **Studio offline** chip (top right) → installs `CadenceBridge.lua` into your Roblox Plugins folder.
2. Restart Studio.
3. In **Game Settings → Security**, turn on **Allow HTTP Requests**.
4. Click **Connect** on the new "Cadence Animator" toolbar tab in Studio.

Once connected, the chip turns green and shows the place name.

### What the plugin gives you

- **Add rig → Your Roblox avatar…** — builds the real avatar for any username, live in Studio, and pulls it in.
- **Add rig → From Studio selection** — select any rig's Model in Explorer, Cadence fetches it (any nesting depth, any part count).
- **Add from asset ID** — inserts any Roblox model asset via Studio's own InsertService.
- **Import → By Roblox animation ID** — pulls a published animation's keyframes straight in.
- **Import → From a rig in Studio** — reads `AnimSaves` folders (the same convention Roblox's own Animation Editor and Moon Animator both use), so existing Moon exports on a rig are importable too.
- **Export → Straight into Studio** — writes a `KeyframeSequence` into `<rig>.AnimSaves.<name>`, ready for Studio's Animation Editor to Import.
- **Export → Publish to Roblox** — same as above, plus a reminder of the one remaining manual step: third-party plugins can't push directly to Roblox's asset servers (nothing can, by design), so you open the Animation Editor → Import → Export to get the asset ID. That's a Roblox platform limitation, not an app limitation.
- Two toolbar buttons in Studio itself: **Send Selection** (push a rig to Cadence without Cadence asking first) and **Sync Pose** (re-read a rig's current geometry after using Studio's native Move/Rotate tools on it, in case you edited the reference rig outside Cadence).

One honest limitation: you can't literally drag an item out of Studio's Explorer panel into Cadence's window — Studio doesn't support that as an OS-level drag source. "Add from Studio selection" is the equivalent: select it in Explorer, one click in Cadence.

## Everything autosaves

There's no "save before you close or you lose your work" — every change writes to disk within a second, and the last 10 generations are kept as rolling backups. On launch, Cadence offers to restore your last session if it had anything in it.

## Rig types

R6, R15, Rthro, Rthro Slender ship built in. Anything else — your own avatar, a specific asset ID, a `.rbxm`/`.rbxmx` file — comes in through the flows above, at any hierarchy depth, with UGC textures (including `SurfaceAppearance` face textures) applied automatically.

## Keyboard

`Ctrl+K` opens the command palette — type what you want to do. `?` shows the full shortcut sheet, or click **⌘ Shortcuts** in the title bar. The essentials: `Space` play/pause, `W`/`E` move/rotate, `S` key the current pose, `A` toggle auto-key, `C` rotation-grid snap, `F` focus selected.

## Auto-update

Cadence checks GitHub Releases for a newer version shortly after launch, and via **Check for updates** in the command palette any time. If one's found, a chip appears in the title bar — click it to download, then click again (or "Restart now" in the confirm dialog) to install. Nothing downloads or installs without you clicking; a background check never interrupts you.

This only works in the **installed** build (the NSIS installer, not the portable exe — a portable app has nothing for the updater to replace in place) and only once `package.json`'s `build.publish.owner`/`repo` point at a real GitHub repo with actual releases published to it.

### Cutting a new release

One-time setup:
1. Create a GitHub repo (public is simplest — no token needed for users to *check* for updates, only for you to *publish*).
2. Fix `package.json`'s `build.publish.owner` to your GitHub username (it starts as `REPLACE_ME_GITHUB_USERNAME`).
3. Push this project's code to that repo.
4. Generate a GitHub Personal Access Token with `repo` scope (Settings → Developer settings → Personal access tokens).

Every release after that:
1. Bump `version` in `package.json` (and re-sync `package-lock.json`'s version with `npm install --package-lock-only`) — electron-updater compares this against what's installed, so it must go up.
2. `GH_TOKEN=<your token> npm run release` — builds the installer/portable exe and publishes a GitHub Release with them attached, tagged from `package.json`'s version.
3. Done. Anyone on an older version sees the update chip next time they open the app (or within its periodic check).

`npm run dist` (no token, no publish) still works exactly as before for local builds you just want to hand someone directly.
