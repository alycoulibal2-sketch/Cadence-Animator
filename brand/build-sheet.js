'use strict';
// Builds brand/preview.html - one page showing every icon the project ships, at its real size,
// inside a mock of the place it actually appears. Run by `npm run brand` after build-icons.js, so
// the sheet can never drift from the artwork: every icon on it is the real SVG, embedded.
//
// Writes two files from one template:
//   brand/preview.html          a complete document - open it in any browser, works offline
//   brand/preview.artifact.html the same page without the <!doctype>/<head>/<body> skeleton, which
//                               is the shape the Artifact publisher expects
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, s) => { fs.writeFileSync(path.join(ROOT, p), s); console.log('  wrote ' + p + ' (' + s.length + ' bytes)'); };

// Each icon goes in as its own <img> data URI rather than inline <svg>. The generated tiles all
// carry the same gradient/filter ids, and five inline copies in one document would collide on
// those ids - as separate documents they render exactly as the real files do.
const uri = (svg) => 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');

const TILE = read('brand/cadence-icon.svg');
const MARK = read('brand/cadence-mark.svg');
const ICONS = {
  tile: uri(TILE),
  // What a phone actually stores: full-bleed, because the OS applies its own corner mask.
  maskable: uri(TILE.replace(/rx="116"/g, 'rx="0"').replace(/<rect id="edge"[^>]*\/>\s*/, '')),
  favicon: uri(read('brand/cadence-favicon.svg')),
  markAccent: uri(MARK.split('currentColor').join('#7c8cff')),
  connect: uri(read('brand/roblox/connect.svg')),
  status: uri(read('brand/roblox/status.svg')),
  send: uri(read('brand/roblox/send-selection.svg')),
  sync: uri(read('brand/roblox/sync-pose.svg')),
};

const img = (key, px, extra) => `<img src="${ICONS[key]}" width="${px}" height="${px}" alt=""${extra || ''}>`;
// A size ladder: each icon drawn at exactly the pixel size under it.
const ladder = (key, sizes) => `<div class="ladder">${sizes.map((s) =>
  `<div class="rung"><div class="rung-art" style="height:${Math.max(...sizes)}px">${img(key, s)}</div><span class="px">${s}</span></div>`).join('')}</div>`;

const TITLE = 'Cadence Icon Sheet';

const STYLE = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
/* Cadence is a dark tool by a documented decision (site/README.md: "Dark only, on purpose"), and
   this sheet is part of that product, so it commits to one visual world instead of following the
   viewer's theme. Every colour is painted explicitly, and the light-ground check the theme would
   have given is here as real context instead: the browser tab strip and the Studio light toolbar
   below are drawn on their true light backgrounds. */
:root {
  --bg-0: #0a0a0e;
  --bg-1: #101016;
  --bg-2: #16161e;
  --bg-3: #1c1c26;
  --bg-4: #23232f;
  --border: rgba(255,255,255,0.08);
  --border-soft: rgba(255,255,255,0.05);
  --text-0: #f2f2f6;
  --text-1: #c9cbe0;
  --text-2: #9394a8;
  --text-3: #6b6c7d;
  --accent: #7c8cff;
  --accent-dim: #4d55a8;
  --good: #5fd99a;
  --warn: #f0b95c;
  --display: 'Archivo', 'Segoe UI', system-ui, sans-serif;
  --body: 'Inter', 'Segoe UI', system-ui, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg-0);
  color: var(--text-1);
  font-family: var(--body);
  font-size: 14.5px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
img { display: block; }
.shell { max-width: 1000px; margin: 0 auto; padding: 0 28px; }

/* ---------------------------------------------------------------- masthead */
.masthead { padding: 56px 0 36px; }
.lockup { display: flex; align-items: center; gap: 12px; margin-bottom: 30px; }
.lockup .name { font-family: var(--display); font-weight: 700; font-size: 20px; color: var(--text-0); letter-spacing: -0.02em; }
.lockup .sub { font-size: 15px; color: var(--text-3); font-weight: 500; }
h1 {
  font-family: var(--display);
  font-weight: 600;
  font-size: clamp(32px, 5vw, 46px);
  line-height: 1.08;
  letter-spacing: -0.03em;
  color: var(--text-0);
  margin: 0 0 16px;
  text-wrap: balance;
}
.lede { font-size: 16.5px; color: var(--text-2); max-width: 62ch; margin: 0; }
.facts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px; }
.fact {
  font-family: var(--mono); font-size: 11.5px; letter-spacing: 0.01em;
  color: var(--text-2); background: var(--bg-2);
  border: 1px solid var(--border); border-radius: 5px; padding: 5px 10px;
}
.fact b { color: var(--accent); font-weight: 500; }

/* ---------------------------------------------------------------- sections */
section { padding: 44px 0; border-top: 1px solid var(--border-soft); }
.eyebrow {
  font-family: var(--mono); font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.14em; color: var(--accent-dim); margin: 0 0 10px;
}
h2 {
  font-family: var(--display); font-weight: 600; font-size: 25px; letter-spacing: -0.02em;
  color: var(--text-0); margin: 0 0 10px;
}
.note { color: var(--text-2); max-width: 62ch; margin: 0 0 26px; }
.note code, .path { font-family: var(--mono); font-size: 12.5px; color: var(--text-1); }
.stack { display: flex; flex-direction: column; gap: 26px; }
.split { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 34px; align-items: start; }
@media (max-width: 760px) { .split { grid-template-columns: minmax(0, 1fr); } }

/* the caption under every mock: which file, drawn at what size */
.caption { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 12px; align-items: baseline; }
.caption .path { color: var(--text-2); }
.caption .at { font-family: var(--mono); font-size: 11.5px; color: var(--text-3); }

/* ---------------------------------------------------------------- size ladder */
.ladder { display: flex; align-items: flex-end; gap: 18px; flex-wrap: wrap; }
.rung { display: flex; flex-direction: column; align-items: center; gap: 7px; }
.rung-art { display: flex; align-items: flex-end; }
.px { font-family: var(--mono); font-size: 10.5px; color: var(--text-3); font-variant-numeric: tabular-nums; }

/* ---------------------------------------------------------------- mock chrome */
.mock { border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }

/* a browser tab strip, on its real light ground */
.tabstrip { background: #dee1e6; padding: 8px 8px 0; }
.tab {
  display: flex; align-items: center; gap: 9px;
  background: #fff; border-radius: 8px 8px 0 0;
  padding: 9px 14px; max-width: 300px;
  font-size: 12.5px; color: #3c4043;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tab span { overflow: hidden; text-overflow: ellipsis; }
.urlbar { background: #fff; padding: 8px 12px; display: flex; align-items: center; gap: 10px; }
.urlpill {
  background: #f1f3f4; border-radius: 999px; padding: 5px 14px;
  font-family: var(--mono); font-size: 11.5px; color: #5f6368; flex: 1;
}

/* the app's own title bar, restated from renderer/styles.css */
.titlebar {
  display: flex; align-items: center; gap: 10px;
  height: 40px; padding: 0 14px;
  background: var(--bg-1); border-bottom: 1px solid var(--border);
}
.titlebar .logo { display: flex; align-items: center; gap: 7px; font-weight: 600; color: var(--text-0); font-size: 13px; }
.titlebar .proj { font-size: 12.5px; color: var(--text-2); }
.titlebar .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--good); opacity: 0.55; }
.titlebar .body { height: 62px; background: var(--bg-0); }

/* the site's own nav bar */
.sitenav {
  display: flex; align-items: center; gap: 22px;
  padding: 14px 18px; background: rgba(10,10,14,0.9);
  border-bottom: 1px solid var(--border);
}
.sitenav .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; color: var(--text-0); font-size: 15px; letter-spacing: -0.02em; }
.sitenav .brand .sub { color: var(--text-3); font-weight: 500; font-size: 13.5px; letter-spacing: 0; }
.sitenav ul { display: flex; gap: 4px; list-style: none; margin: 0; padding: 0; }
.sitenav a { color: var(--text-2); font-size: 13px; text-decoration: none; padding: 6px 10px; }

/* the mobile page's top bar */
.mobilebar {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; background: #0d0d12; border-bottom: 1px solid #24242e;
  font-size: 13px;
}
.mobilebar .logo { display: flex; align-items: center; gap: 6px; font-weight: 700; color: var(--accent); }
.mobilebar .proj { color: #b7b7c2; flex: 1; }
.mobilebar .conn { font-size: 11px; color: var(--good); }

/* a Windows taskbar and a desktop shortcut */
.taskbar { display: flex; align-items: center; gap: 14px; padding: 7px 16px; background: #1f1f24; }
.taskbar .app { padding: 5px; border-radius: 5px; }
.taskbar .app.on { background: rgba(255,255,255,0.08); box-shadow: inset 0 -2px 0 var(--accent); }
.shortcut { display: flex; flex-direction: column; align-items: center; gap: 7px; width: 92px; }
.shortcut .label { font-size: 11.5px; color: #e8e8ee; text-align: center; text-shadow: 0 1px 3px rgba(0,0,0,0.9); line-height: 1.3; }

/* the NSIS installer sidebar, at its real 164 x 314 */
.sidebar {
  width: 164px; height: 314px; flex: 0 0 auto;
  background: linear-gradient(#12121a, #0a0a0e);
  border: 1px solid var(--border);
  display: flex; flex-direction: column; align-items: center;
  padding-top: 46px; position: relative; overflow: hidden;
}
.sidebar::before {
  content: ""; position: absolute; inset: 0;
  background: radial-gradient(120px 120px at 50% 96px, rgba(124,140,255,0.22), rgba(124,140,255,0));
}
.sidebar > * { position: relative; }
.sidebar .n { font-family: var(--display); font-weight: 600; font-size: 20px; color: var(--text-0); margin-top: 22px; }
.sidebar .s { font-size: 15px; color: var(--text-2); }
.sidebar .rule { width: 28px; height: 2px; background: rgba(124,140,255,0.55); margin: 14px 0 12px; }
.sidebar .t { font-size: 11px; color: var(--text-3); }

/* Roblox Studio toolbars, one per Studio theme */
.toolbars { display: flex; flex-wrap: wrap; gap: 18px; }
.toolbar { display: flex; gap: 4px; padding: 8px; border-radius: 8px; border: 1px solid var(--border); }
.toolbar.dark { background: #2b2b2b; }
.toolbar.light { background: #f1f1f1; border-color: rgba(0,0,0,0.12); }
.tbtn { display: flex; flex-direction: column; align-items: center; gap: 5px; width: 76px; padding: 7px 4px; border-radius: 5px; }
.toolbar.dark .tbtn { color: #e4e4e4; }
.toolbar.light .tbtn { color: #2b2b2b; }
.toolbar.dark .tbtn.active { background: rgba(255,255,255,0.11); }
.toolbar.light .tbtn.active { background: rgba(0,0,0,0.08); }
.tbtn .lbl { font-size: 10.5px; line-height: 1.2; text-align: center; }

/* a phone home screen */
.home {
  width: 210px; padding: 22px 18px 26px; border-radius: 22px;
  background: linear-gradient(160deg, #1b1b2c, #0d0d14 70%);
  border: 1px solid var(--border);
  display: flex; gap: 18px;
}
.homeapp { display: flex; flex-direction: column; align-items: center; gap: 7px; }
.homeapp .tile { width: 60px; height: 60px; border-radius: 13.5px; overflow: hidden; }
.homeapp .tile img { width: 60px; height: 60px; }
.homeapp .label { font-size: 11px; color: #e8e8ee; }

/* ---------------------------------------------------------------- file map */
.tablewrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; min-width: 620px; }
th, td { text-align: left; padding: 10px 14px 10px 0; border-bottom: 1px solid var(--border-soft); vertical-align: top; }
th {
  font-family: var(--mono); font-size: 10.5px; text-transform: uppercase;
  letter-spacing: 0.12em; color: var(--text-3); font-weight: 500;
}
td:first-child { font-family: var(--mono); font-size: 12px; color: var(--text-1); white-space: nowrap; }
td:nth-child(2) { font-family: var(--mono); font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
td { color: var(--text-2); }

.flag {
  display: flex; gap: 12px; align-items: flex-start;
  border-left: 2px solid var(--warn); padding: 12px 0 12px 16px;
  background: linear-gradient(90deg, rgba(240,185,92,0.06), transparent 60%);
  margin-top: 24px;
}
.flag p { margin: 0; color: var(--text-2); font-size: 13.5px; max-width: 60ch; }
.flag b { color: var(--text-0); font-weight: 600; }

footer { padding: 40px 0 64px; color: var(--text-3); font-size: 13px; border-top: 1px solid var(--border-soft); }
footer code { font-family: var(--mono); font-size: 12px; color: var(--text-2); }
</style>`;

const BODY = `
<div class="shell">

<header class="masthead">
  <div class="lockup">
    ${img('markAccent', 26)}
    <span class="name">Cadence</span>
    <span class="sub">Animator</span>
  </div>
  <h1>Every icon, where you'll actually see it</h1>
  <p class="lede">One mark: a bold C drawn as a motion path that arrives at two keyframe diamonds. Below it is drawn at the size each interface really uses, in a mock of the place it appears.</p>
  <div class="facts">
    <span class="fact">3 sources &rarr; <b>22 generated files</b></span>
    <span class="fact">rebuild with <b>npm run brand</b></span>
    <span class="fact">accent <b>#7c8cff</b></span>
    <span class="fact">ground <b>#0a0a0e</b></span>
  </div>
</header>

<section>
  <p class="eyebrow">The mark</p>
  <h2>One shape, three jobs</h2>
  <p class="note">The C is the letter of the name, the curve an animator edits, and the diamond every animation tool already uses for a keyframe. Inline it takes its colour from the text around it, so it works on any ground.</p>
  <div class="split">
    <div class="stack">
      <div>
        <div class="mock"><div class="sitenav">
          <span class="brand">${img('markAccent', 24)} Cadence <span class="sub">Animator</span></span>
          <ul><li><a href="#">Features</a></li><li><a href="#">VFX Studio</a></li><li><a href="#">Docs</a></li></ul>
        </div></div>
        <div class="caption"><span class="path">site/index.html, site/docs.html</span><span class="at">header and footer &middot; 24px</span></div>
      </div>
      <div>
        <div class="mock"><div class="titlebar">
          <span class="logo">${img('markAccent', 18)} Cadence</span>
          <span class="proj">Sprint Cycle</span>
          <span class="dot"></span>
        </div><div class="body"></div></div>
        <div class="caption"><span class="path">renderer/index.html, renderer-vfx/index.html</span><span class="at">title bar &middot; 18px</span></div>
      </div>
      <div>
        <div class="mock"><div class="mobilebar">
          <span class="logo">${img('markAccent', 16)} Cadence</span>
          <span class="proj">Sprint Cycle</span>
          <span class="conn">Live</span>
        </div></div>
        <div class="caption"><span class="path">renderer-mobile/index.html</span><span class="at">top bar &middot; 16px</span></div>
      </div>
    </div>
    <div>
      ${img('markAccent', 128)}
      <div class="caption"><span class="path">brand/cadence-mark.svg</span></div>
    </div>
  </div>
</section>

<section>
  <p class="eyebrow">Browser</p>
  <h2>The tab</h2>
  <p class="note">At 16px the arc and the diamonds are drawn heavier, on the dark tile, so the shape survives. That is a separate source file, not the big icon scaled down.</p>
  <div class="mock" style="max-width:520px">
    <div class="tabstrip"><div class="tab">${img('favicon', 16)}<span>Cadence Animator &mdash; a standalone Roblox animation suite</span></div></div>
    <div class="urlbar"><span class="urlpill">cadenceanimator.js.org</span></div>
  </div>
  <div class="caption"><span class="path">site/assets/img/favicon.svg &middot; favicon.ico &middot; apple-touch-icon.png</span><span class="at">tab &middot; 16px</span></div>
  <div style="margin-top:26px">${ladder('favicon', [16, 32, 48])}</div>
</section>

<section>
  <p class="eyebrow">Windows</p>
  <h2>Taskbar, shortcut, installer</h2>
  <p class="note">The app had no icon at all before this: the taskbar, the installer and every shortcut showed Electron's own logo. One <span class="path">.ico</span> now carries nine sizes, and Windows picks the one it needs.</p>
  <div class="split">
    <div class="stack">
      <div>
        <div class="mock"><div class="taskbar">
          <span class="app on">${img('tile', 32)}</span>
          <span class="app" style="opacity:0.35">${img('favicon', 32)}</span>
        </div></div>
        <div class="caption"><span class="at">taskbar &middot; 32px, running</span></div>
      </div>
      <div>
        <div class="mock" style="background:linear-gradient(140deg,#26314a,#131a2b);padding:20px">
          <div class="shortcut">${img('tile', 48)}<span class="label">Cadence Animator</span></div>
        </div>
        <div class="caption"><span class="at">desktop shortcut &middot; 48px</span></div>
      </div>
    </div>
    <div>
      <div class="sidebar">
        ${img('tile', 100)}
        <span class="n">Cadence</span>
        <span class="s">Animator</span>
        <span class="rule"></span>
        <span class="t">Roblox animation suite</span>
      </div>
      <div class="caption"><span class="path">brand/installerSidebar.bmp</span><span class="at">164 &times; 314</span></div>
    </div>
  </div>
  <div style="margin-top:30px">${ladder('tile', [16, 20, 24, 32, 40, 48, 64, 128])}</div>
  <div class="caption"><span class="path">brand/icon.ico</span><span class="at">plus 256px &middot; nine sizes in one file</span></div>
</section>

<section>
  <p class="eyebrow">Roblox Studio</p>
  <h2>The plugin's toolbar</h2>
  <p class="note">Four buttons, four glyphs, each on the same tile as the app icon. Studio has a light theme and a dark one and recolours nothing, so a bare stroke icon would vanish against one of them. The tile never does.</p>
  <div class="toolbars">
    <div class="toolbar dark">
      <span class="tbtn active">${img('connect', 32)}<span class="lbl">Connect</span></span>
      <span class="tbtn">${img('status', 32)}<span class="lbl">Status</span></span>
      <span class="tbtn">${img('send', 32)}<span class="lbl">Send Selection</span></span>
      <span class="tbtn">${img('sync', 32)}<span class="lbl">Sync Pose</span></span>
    </div>
    <div class="toolbar light">
      <span class="tbtn active">${img('connect', 32)}<span class="lbl">Connect</span></span>
      <span class="tbtn">${img('status', 32)}<span class="lbl">Status</span></span>
      <span class="tbtn">${img('send', 32)}<span class="lbl">Send Selection</span></span>
      <span class="tbtn">${img('sync', 32)}<span class="lbl">Sync Pose</span></span>
    </div>
  </div>
  <div class="caption"><span class="path">brand/roblox/connect.png &middot; status.png &middot; send-selection.png &middot; sync-pose.png</span><span class="at">toolbar &middot; 32px</span></div>
  <div class="flag">
    <p><b>These four are the one thing not live yet.</b> Roblox draws a toolbar icon only from an uploaded asset, so the plugin's icon ids are still empty and each button falls back to its emoji label, exactly as before. Nothing is broken while they wait. The upload procedure, including the trap that a Decal id fails silently as an icon, is in <span class="path">brand/README.md</span>.</p>
  </div>
</section>

<section>
  <p class="eyebrow">Phone</p>
  <h2>Added to a home screen</h2>
  <p class="note">The mobile page can be installed like an app. Its icon is stored full-bleed, with no corners of its own, because the phone applies its own mask, and a tile with baked-in corners gets cut twice.</p>
  <div class="split">
    <div>
      <div class="home">
        <div class="homeapp"><span class="tile">${img('maskable', 60)}</span><span class="label">Cadence</span></div>
      </div>
      <div class="caption"><span class="path">renderer-mobile/icon-maskable-512.png</span><span class="at">home screen &middot; 60px, masked by the OS</span></div>
    </div>
    <div>
      ${ladder('tile', [180, 192])}
      <div class="caption"><span class="path">apple-touch-icon.png &middot; icon-192.png</span></div>
    </div>
  </div>
</section>

<section>
  <p class="eyebrow">The map</p>
  <h2>Which file goes where</h2>
  <p class="note">Three SVGs are the source. Everything else is generated from them by <span class="path">npm run brand</span> and should never be edited by hand.</p>
  <div class="tablewrap">
  <table>
    <thead><tr><th>File</th><th>Size</th><th>Where it shows up</th></tr></thead>
    <tbody>
      <tr><td>brand/cadence-mark.svg</td><td>source</td><td>Inline in the site header and footer, both app title bars, the mobile top bar</td></tr>
      <tr><td>brand/cadence-favicon.svg</td><td>source</td><td>The 16px-tuned tile behind the browser tab and every icon 32px and under</td></tr>
      <tr><td>brand/cadence-icon.svg</td><td>source</td><td>The app tile behind everything 40px and above</td></tr>
      <tr><td>brand/icon.ico</td><td>16&ndash;256</td><td>The exe, the installer, shortcuts, the taskbar, and the dev-mode window</td></tr>
      <tr><td>brand/icon.png</td><td>512</td><td>The README header</td></tr>
      <tr><td>brand/installerSidebar.bmp</td><td>164&times;314</td><td>The installer's welcome and finish pages</td></tr>
      <tr><td>brand/roblox/plugin-icon.png</td><td>512</td><td>A Creator Store listing for the Studio plugin</td></tr>
      <tr><td>brand/roblox/*.png</td><td>512</td><td>The four Studio toolbar buttons, once uploaded</td></tr>
      <tr><td>site/assets/img/favicon.svg</td><td>32</td><td>The browser tab on both site pages</td></tr>
      <tr><td>site/assets/img/favicon.ico</td><td>16, 32, 48</td><td>Browsers that ignore the SVG</td></tr>
      <tr><td>site/assets/img/apple-touch-icon.png</td><td>180</td><td>The site saved to an iOS home screen</td></tr>
      <tr><td>renderer-mobile/icon-192.png</td><td>192</td><td>The installed mobile app</td></tr>
      <tr><td>renderer-mobile/icon-maskable-512.png</td><td>512</td><td>Android, which masks the corners itself</td></tr>
    </tbody>
  </table>
  </div>
</section>

<footer>
  Generated by <code>brand/build-sheet.js</code> from the SVG sources, so nothing here can drift from the artwork. Every icon on this page is the real file, embedded.
</footer>

</div>`;

console.log('building the icon sheet');
write('brand/preview.html',
  '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
  + `<title>${TITLE}</title>\n` + STYLE + '\n</head>\n<body>\n' + BODY + '\n</body>\n</html>\n');
write('brand/preview.artifact.html', `<title>${TITLE}</title>\n` + STYLE + '\n' + BODY + '\n');
