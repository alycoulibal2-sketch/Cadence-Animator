'use strict';
// Rasterizes the brand SVGs into every icon the project ships, so the logo is one source of
// truth (brand/*.svg) and everything else is generated from it:
//
//   brand/icon.ico                    Windows app icon (exe, installer, taskbar) - 16..256 px
//   brand/icon.png                    512 px tile, for the README and anything that wants a PNG
//   brand/installerSidebar.bmp        NSIS installer welcome/finish sidebar (164 x 314)
//   brand/roblox-plugin-icon.png      64 px, ready to upload as the Studio plugin toolbar icon
//   brand/preview.png                 contact sheet at every size, on dark and light - look at it
//   site/assets/img/favicon.svg|ico   the browser tab
//   site/assets/img/apple-touch-icon.png
//   renderer-mobile/icon.svg|icon-192.png|icon-512.png|icon-maskable-512.png|apple-touch-icon.png
//
// Run with: npm run brand   (it is an Electron script: Chromium does the SVG rasterizing, which
// is the same renderer the app and the site are seen through, and needs no extra dependency).

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, buf) => {
  fs.mkdirSync(path.dirname(path.join(ROOT, p)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, p), buf);
  console.log('  wrote ' + p + ' (' + buf.length + ' bytes)');
};

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

const TILE = read('brand/cadence-icon.svg');
const FAVICON = read('brand/cadence-favicon.svg');
const MARK = read('brand/cadence-mark.svg');
// Full-bleed variant for maskable / touch icons: the OS applies its own corner mask, so the tile
// must fill the square with no transparent corners and no hairline edge.
const TILE_SQUARE = TILE.replace(/rx="116"/g, 'rx="0"').replace(/<rect id="edge"[^>]*\/>\s*/, '');

// ------------------------------------------------------------- Roblox plugin buttons
// The Studio plugin's four toolbar buttons, each drawn as the app's own icon glyph on the app's
// own tile - so the toolbar reads as Cadence at a glance, in both Studio themes (a bare stroke
// icon would vanish against one of them; the dark tile never does).
//
// Three of the four glyphs are copied verbatim from renderer/js/icons.js, on its 24x24 grid, so
// the plugin and the app draw literally the same shapes. `signal` is authored here in the same
// grammar because the app has no equivalent.
const GLYPH_24 = {
  export: '<polyline points="7 8 12 3 17 8"/><line x1="12" y1="3" x2="12" y2="15"/><path d="M4 19h16"/>',
  // The app's `rotate` arc, but with a real triangular arrowhead instead of its 16 px chevron -
  // that chevron is a detached stub once the icon is drawn at 512. The arc sweeps top-right-
  // bottom-left and its tangent at the end point (4,12) points straight up, so the head does too.
  rotate: '<path d="M12 4a8 8 0 1 1-8 8"/>'
    + '<polygon points="4 8.4 1.7 12.6 6.3 12.6" fill="CURRENT" stroke="none"/>',
  plug: '<line x1="9" y1="2.6" x2="9" y2="7"/><line x1="15" y1="2.6" x2="15" y2="7"/>'
    + '<path d="M5.8 7h12.4v2.6a6.2 6.2 0 0 1-12.4 0V7z"/><line x1="12" y1="15.8" x2="12" y2="21.4"/>',
  signal: '<path d="M4.8 10.2a10 10 0 0 1 14.4 0"/><path d="M8.1 13.6a5.4 5.4 0 0 1 7.8 0"/>'
    + '<circle cx="12" cy="17.6" r="1.5" fill="CURRENT" stroke="none"/>',
};

// file base name -> [glyph, what the button does]
const ROBLOX_BUTTONS = [
  // `plug` rather than the app's own `link` glyph: in the app `link` already means "node graph"
  // (VFX Studio's Nodes button), and the plug matches the emoji the panel's own toggle uses.
  ['connect', 'plug', 'Connect / disconnect the bridge'],
  ['status', 'signal', 'Connection status panel'],
  ['send-selection', 'export', 'Push the selected rig to Cadence'],
  ['sync-pose', 'rotate', 'Re-read the rig and correct Cadence'],
];

// Swaps the C mark out of the app tile for a 24x24 glyph, keeping the tile, its glow, its edge and
// its gradients untouched. The regex anchors on the LAST </g> before </svg>, because the mark
// group has a nested group inside it.
function tileWithGlyph(glyph) {
  const paint = (stroke, fill, extra) =>
    `  <g${extra} transform="translate(256 256) scale(14.1667) translate(-12 -12)" fill="none"`
    + ` stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n`
    + `    ${GLYPH_24[glyph].split('CURRENT').join(fill)}\n  </g>`;
  const group = '  <g id="glyph">\n'
    + paint('#7c8cff', '#7c8cff', ' filter="url(#soft)" opacity="0.55"') + '\n'
    + paint('url(#arc)', '#e6e9ff', '') + '\n  </g>';
  const out = TILE.replace(/ {2}<g id="mark"[\s\S]*<\/g>\n<\/svg>/, group + '\n</svg>');
  if (out === TILE) throw new Error('tileWithGlyph: the mark group in cadence-icon.svg did not match');
  return out;
}

// The four icons at their real toolbar size, on both Studio themes, so they can be judged before
// anything is uploaded.
const ROBLOX_PREVIEW_JS = (svgs, labels) => `(async () => {
  const svgs = ${JSON.stringify(svgs)}, labels = ${JSON.stringify(labels)};
  const W = 640, H = 260;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#252525'; ctx.fillRect(0, 0, W, H / 2);
  ctx.fillStyle = '#f1f1f1'; ctx.fillRect(0, H / 2, W, H / 2);
  const imgs = [];
  for (const s of svgs) imgs.push(await window.__svgToImage(s));
  for (const half of [0, 1]) {
    const baseY = half * (H / 2);
    ctx.fillStyle = half ? '#666' : '#999'; ctx.font = '11px "Segoe UI"'; ctx.textAlign = 'left';
    ctx.fillText(half ? 'Studio light theme' : 'Studio dark theme', 16, baseY + 20);
    imgs.forEach((img, i) => {
      const x = 24 + i * 150;
      for (const [size, dy] of [[32, 44], [16, 92]]) {
        const t = document.createElement('canvas'); t.width = size; t.height = size;
        t.getContext('2d').drawImage(img, 0, 0, size, size);
        ctx.drawImage(t, x, baseY + dy);
        ctx.fillStyle = half ? '#888' : '#777'; ctx.font = '10px "Segoe UI"';
        ctx.fillText(size + 'px', x + size + 8, baseY + dy + size - 2);
      }
      ctx.fillStyle = half ? '#222' : '#ddd'; ctx.font = '600 12px "Segoe UI"';
      ctx.fillText(labels[i], x, baseY + 122);
    });
  }
  return window.__pack(c);
})()`;

// ------------------------------------------------------------------ encoders
// 24-bit bottom-up BMP, the only format NSIS accepts for the installer sidebar.
function bmp24(w, h, rgba) {
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const pix = rowSize * h;
  const buf = Buffer.alloc(54 + pix);
  buf.write('BM', 0);
  buf.writeUInt32LE(54 + pix, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pix, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++) {
    const src = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const i = (src * w + x) * 4;
      const o = 54 + y * rowSize + x * 3;
      buf[o] = rgba[i + 2]; buf[o + 1] = rgba[i + 1]; buf[o + 2] = rgba[i];
    }
  }
  return buf;
}

// A 32-bit BGRA DIB icon entry (straight alpha, plus an all-zero AND mask) - the classic format
// every Windows version and rcedit/NSIS read for sizes under 256.
function dibEntry(size, rgba) {
  const maskRow = Math.ceil(size / 32) * 4;
  const xorBytes = size * size * 4;
  const andBytes = maskRow * size;
  const buf = Buffer.alloc(40 + xorBytes + andBytes);
  buf.writeUInt32LE(40, 0);
  buf.writeInt32LE(size, 4);
  buf.writeInt32LE(size * 2, 8);
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(32, 14);
  buf.writeUInt32LE(0, 16);
  buf.writeUInt32LE(xorBytes + andBytes, 20);
  for (let y = 0; y < size; y++) {
    const src = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const i = (src * size + x) * 4;
      const o = 40 + (y * size + x) * 4;
      buf[o] = rgba[i + 2]; buf[o + 1] = rgba[i + 1]; buf[o + 2] = rgba[i]; buf[o + 3] = rgba[i + 3];
    }
  }
  return buf;
}

function ico(entries) {
  // entries: [{ size, data }] where data is a DIB entry or a whole PNG (256 px only)
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  const blobs = [];
  entries.forEach((e, i) => {
    const o = 6 + i * 16;
    header[o] = e.size >= 256 ? 0 : e.size;
    header[o + 1] = e.size >= 256 ? 0 : e.size;
    header[o + 2] = 0;
    header[o + 3] = 0;
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(e.data.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += e.data.length;
    blobs.push(e.data);
  });
  return Buffer.concat([header, ...blobs]);
}

// ------------------------------------------------------------------ rasterizing
const PAGE_LIB = `
  window.__svgToImage = (svg) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('svg failed to load'));
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
  });
  window.__pack = (canvas) => {
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let s = '';
    for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
    return { png: canvas.toDataURL('image/png').split(',')[1], rgba: btoa(s), w: canvas.width, h: canvas.height };
  };
  window.__raster = async (svg, size) => {
    const img = await window.__svgToImage(svg);
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    c.getContext('2d').drawImage(img, 0, 0, size, size);
    return window.__pack(c);
  };
  0;
`;

const SIDEBAR_JS = (tile) => `(async () => {
  const W = 164, H = 314;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#12121a'); g.addColorStop(1, '#0a0a0e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 96, 4, W / 2, 96, 120);
  glow.addColorStop(0, 'rgba(124,140,255,0.22)'); glow.addColorStop(1, 'rgba(124,140,255,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  const img = await window.__svgToImage(${JSON.stringify(tile)});
  ctx.drawImage(img, 32, 46, 100, 100);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2f2f6';
  ctx.font = '600 20px "Segoe UI", sans-serif';
  ctx.fillText('Cadence', W / 2, 190);
  ctx.fillStyle = '#9394a8';
  ctx.font = '400 15px "Segoe UI", sans-serif';
  ctx.fillText('Animator', W / 2, 212);
  ctx.fillStyle = 'rgba(124,140,255,0.55)';
  ctx.fillRect(W / 2 - 14, 228, 28, 2);
  ctx.fillStyle = '#6b6c7d';
  ctx.font = '400 11px "Segoe UI", sans-serif';
  ctx.fillText('Roblox animation suite', W / 2, 254);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(W - 1, 0, 1, H);
  return window.__pack(c);
})()`;

// Every size on dark and on light, plus the monochrome mark beside the wordmark, so a human can
// judge the logo the way it will actually be seen.
const PREVIEW_JS = (fav, tile, mark) => `(async () => {
  const sizes = [16, 20, 24, 32, 48, 64, 128, 256];
  const W = 1000, H = 720;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0d0d12'; ctx.fillRect(0, 0, W, H / 2);
  ctx.fillStyle = '#f4f4f7'; ctx.fillRect(0, H / 2, W, H / 2);
  const favImg = await window.__svgToImage(${JSON.stringify(fav)});
  const tileImg = await window.__svgToImage(${JSON.stringify(tile)});
  const markImg = await window.__svgToImage(${JSON.stringify(mark).replace(/currentColor/g, '#7c8cff')});
  for (const half of [0, 1]) {
    let x = 24;
    const baseY = half * (H / 2) + 30;
    for (const s of sizes) {
      const t = document.createElement('canvas'); t.width = s; t.height = s;
      t.getContext('2d').drawImage(s <= 32 ? favImg : tileImg, 0, 0, s, s);
      ctx.drawImage(t, x, baseY + (256 - s));
      ctx.fillStyle = half ? '#555' : '#888'; ctx.font = '12px "Segoe UI"'; ctx.textAlign = 'left';
      ctx.fillText(String(s), x, baseY + 256 + 18);
      x += s + 24;
    }
    const mx = 24, my = baseY + 296;
    const t22 = document.createElement('canvas'); t22.width = 22; t22.height = 22;
    t22.getContext('2d').drawImage(markImg, 0, 0, 22, 22);
    ctx.drawImage(t22, mx, my);
    ctx.fillStyle = half ? '#111' : '#f2f2f6'; ctx.font = '700 17px "Segoe UI"'; ctx.fillText('Cadence', mx + 32, my + 17);
    ctx.fillStyle = half ? '#777' : '#6b6c7d'; ctx.font = '500 15px "Segoe UI"'; ctx.fillText('Animator', mx + 104, my + 17);
    const t44 = document.createElement('canvas'); t44.width = 44; t44.height = 44;
    t44.getContext('2d').drawImage(markImg, 0, 0, 44, 44);
    ctx.drawImage(t44, mx + 220, my - 10);
    const t18 = document.createElement('canvas'); t18.width = 18; t18.height = 18;
    t18.getContext('2d').drawImage(markImg, 0, 0, 18, 18);
    ctx.drawImage(t18, mx + 300, my + 2);
    ctx.fillStyle = half ? '#111' : '#f2f2f6'; ctx.font = '600 13px "Segoe UI"'; ctx.fillText('Cadence', mx + 324, my + 15);
  }
  return window.__pack(c);
})()`;

async function main() {
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  await win.webContents.executeJavaScript(PAGE_LIB);
  const raster = async (svg, size) => {
    const r = await win.webContents.executeJavaScript('window.__raster(' + JSON.stringify(svg) + ', ' + size + ')');
    return { png: Buffer.from(r.png, 'base64'), rgba: Buffer.from(r.rgba, 'base64') };
  };

  console.log('rasterizing');
  // Sizes 32 and under come from the favicon variant (heavier strokes); everything larger from
  // the full tile with its glow.
  const small = {};
  for (const s of [16, 20, 24, 32]) small[s] = await raster(FAVICON, s);
  const big = {};
  for (const s of [40, 48, 64, 128, 192, 256, 512]) big[s] = await raster(TILE, s);
  const square = {};
  for (const s of [180, 512]) square[s] = await raster(TILE_SQUARE, s);

  console.log('writing');
  // The 256 px PNG entry goes FIRST: electron-builder's app-builder reads the icon size from the
  // first directory entry and rejects the file ("must be at least 256x256") when a small one leads.
  // Windows picks an entry by size regardless of order.
  write('brand/icon.ico', ico([
    { size: 256, data: big[256].png },
    { size: 16, data: dibEntry(16, small[16].rgba) },
    { size: 20, data: dibEntry(20, small[20].rgba) },
    { size: 24, data: dibEntry(24, small[24].rgba) },
    { size: 32, data: dibEntry(32, small[32].rgba) },
    { size: 40, data: dibEntry(40, big[40].rgba) },
    { size: 48, data: dibEntry(48, big[48].rgba) },
    { size: 64, data: dibEntry(64, big[64].rgba) },
    { size: 128, data: dibEntry(128, big[128].rgba) },
  ]));
  write('brand/icon.png', big[512].png);

  // Roblox Studio plugin: the plugin's own tile plus one icon per toolbar button. 512 px because
  // that is what Roblox stores and downsamples from; Studio draws them at 32 px or 16 px.
  write('brand/roblox/plugin-icon.png', big[512].png);
  const robloxSvgs = [];
  for (const [name, glyph] of ROBLOX_BUTTONS) {
    const svg = tileWithGlyph(glyph);
    robloxSvgs.push(svg);
    write('brand/roblox/' + name + '.svg', Buffer.from(svg));
    write('brand/roblox/' + name + '.png', (await raster(svg, 512)).png);
  }
  const rbxPreview = await win.webContents.executeJavaScript(
    ROBLOX_PREVIEW_JS(robloxSvgs, ROBLOX_BUTTONS.map((b) => b[0])));
  write('brand/roblox/preview.png', Buffer.from(rbxPreview.png, 'base64'));

  write('site/assets/img/favicon.svg', Buffer.from(FAVICON));
  write('site/assets/img/favicon.ico', ico([
    { size: 16, data: dibEntry(16, small[16].rgba) },
    { size: 32, data: dibEntry(32, small[32].rgba) },
    { size: 48, data: dibEntry(48, big[48].rgba) },
  ]));
  write('site/assets/img/apple-touch-icon.png', square[180].png);

  write('renderer-mobile/icon.svg', Buffer.from(TILE));
  write('renderer-mobile/icon-192.png', big[192].png);
  write('renderer-mobile/icon-512.png', big[512].png);
  write('renderer-mobile/icon-maskable-512.png', square[512].png);
  write('renderer-mobile/apple-touch-icon.png', square[180].png);

  const sidebar = await win.webContents.executeJavaScript(SIDEBAR_JS(TILE));
  write('brand/installerSidebar.bmp', bmp24(164, 314, Buffer.from(sidebar.rgba, 'base64')));

  const preview = await win.webContents.executeJavaScript(PREVIEW_JS(FAVICON, TILE, MARK));
  write('brand/preview.png', Buffer.from(preview.png, 'base64'));
  console.log('done');
}

app.whenReady().then(() => main().then(() => app.exit(0), (e) => { console.error(e); app.exit(1); }));
setTimeout(() => { console.error('timed out'); app.exit(2); }, 60000);
