# The Cadence Animator website

A static site. No build step, no dependencies, nothing to install — the files in this folder are
exactly what gets served. Open `index.html` in a browser to work on it, or serve the folder:

```bash
npx serve site          # or: python -m http.server 8080 -d site
```

Deployed to GitHub Pages from `main` by `.github/workflows/pages.yml`, live at
<https://alycoulibal2-sketch.github.io/Cadence-Animator/>.

```
site/
  index.html            landing page — hero, features, Studio, VFX, MCP, comparison, download, FAQ
  docs.html             documentation — install through troubleshooting, plus the shortcut reference
  assets/css/site.css   the whole design system (mirrors renderer/styles.css)
  assets/js/site.js     nav, scroll state, reveals, Ctrl+K palette, release lookup
  assets/img/           hero screenshot, favicon
  tools/                the two scripts that keep the site honest (below)
```

## Update the site on every release

**This is part of cutting a release, not an afterthought.** The site states the version, the file
sizes, the checksums and a lot of exact counts; every one of those goes stale on its own.

After `npm run release` succeeds and the GitHub release is live:

1. **Regenerate the shortcut reference** — reads `renderer/js/app.js` and rewrites the generated
   block in `docs.html`. It also refreshes the shortcut and command counts quoted in the prose.

   ```bash
   node site/tools/gen-shortcuts.js
   ```

2. **Refresh the release facts** — version, filenames, sizes and SHA-256 for both builds, on
   `index.html`'s download cards and in every `data-version` span.

   ```bash
   node site/tools/sync-release.js          # reads the live GitHub release
   node site/tools/sync-release.js --check  # just report drift, change nothing
   ```

3. **Write the new features in.** No script can do this one. If the release added a capability,
   it belongs in `index.html`'s feature grid and in the relevant `docs.html` section. If it added
   something countable, re-count it from source — never copy a number out of a changelog or a
   comment.

4. **Re-read anything you changed with fresh eyes**, then commit. Pushing to `main` deploys.

### Verifying counts

Every number on this site was counted from source, not estimated. Some useful one-liners:

```bash
grep -c 'server\.tool(' mcp-server/index.js                    # MCP tools
node -e "const s=require('fs').readFileSync('renderer/js/app.js','utf8');console.log((s.match(/\n\s*C\(\{/g)||[]).length)"   # palette commands
node --input-type=module -e "const m=await import('./renderer/js/effectModel.js');console.log(Object.keys(m.LAYER_TYPES).length, Object.keys(m.MODIFIER_TYPES).length)"
node --input-type=module -e "const l=await import('./renderer/js/effectLibrary.js');console.log(l.EFFECT_ARCHETYPES.length)"
node --input-type=module -e "const p=await import('./renderer/js/particleLibrary.js');console.log(p.PARTICLE_PRESETS.length)"
node -e "console.log((require('fs').readFileSync('test/smoketest.js','utf8').match(/await step\(/g)||[]).length)"  # smoketest checks
```

Modules that import `state.js` cannot be loaded in plain Node — `state.js` touches
`window.cadence` at module load — so count those with a regex over the source instead of an
import.

## Ground rules

- **Nothing on this site may be aspirational.** If a feature is early, partial, or excluded from
  export, the page says so. The node editor in VFX Studio is described as early because it is;
  the Roblox publish step is described as Roblox's limitation because it is.
- **No third-party requests.** No CDNs, no webfonts, no analytics, no trackers. The only network
  call the site makes is one optional `fetch` to the GitHub releases API to notice a newer
  version, and it fails silently.
- **Downloads work with JavaScript off.** The hardcoded `href`s in `index.html` are the source of
  truth; `site.js` only ever retargets them at a *newer* release, never an older one.
- **The design system is the app's.** `assets/css/site.css` deliberately restates the same
  variables as `renderer/styles.css`. If the app's palette changes, change both.
- **Dark only, on purpose.** Cadence is a dark professional tool. A half-committed light mode
  would read as less considered.
