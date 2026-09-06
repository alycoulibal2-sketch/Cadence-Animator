#!/usr/bin/env node
// Headless check of every page: loads each one at three widths in an
// offscreen Electron window and reports console errors, horizontal overflow
// (naming the element that caused it), broken images, loaded webfonts and page
// height, with screenshots: the full page, the first screen ("fold"), and for
// the landing page at desktop width one shot per section. Run before deploying.
//
//   node node_modules/electron/cli.js site/tools/check-site.js [out-dir]
//
// out-dir defaults to test-output/site-check (git-ignored). Exit code 1 if any
// page overflowed, threw, or had a broken image.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const SITE = path.join(ROOT, 'site');
const OUT = path.resolve(process.argv[2] || process.env.OUT || path.join(ROOT, 'test-output', 'site-check'));
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'progress.log');
const log = (s) => { fs.appendFileSync(LOG, s + '\n'); console.log(s); };
fs.writeFileSync(LOG, '');
process.on('uncaughtException', (e) => { log('UNCAUGHT ' + (e && e.stack || e)); app.exit(2); });
process.on('unhandledRejection', (e) => { log('UNHANDLED ' + (e && e.stack || e)); app.exit(2); });

app.setPath('userData', path.join(OUT, 'userdata'));
app.disableHardwareAcceleration();
// Windows are created and destroyed one after another; without this Electron
// quits the moment the first one closes.
app.on('window-all-closed', () => {});

const pages = [
  ['index.html', {}],
  ['docs.html', {}],
  ['safety.html', {}],
  ['account.html', {}],
  ['thanks.html', { session_id: 'cs_test_123' }],
  ['privacy.html', {}],
  ['changelog.html', {}],
];
const widths = [360, 820, 1366];
const SECTIONS = ['#demo', '#compare', '#proof', '#animate', '#vfx', '#studio', '#download', '#smartscreen', '#safety', '#verify-card', '#pricing', '#faq', '#roadmap'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROBE = `(() => {
  const d = document.documentElement;
  const cw = d.clientWidth;
  const wide = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > cw + 1) {
      const cls = typeof el.className === 'string' ? el.className : '';
      wide.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls.trim().split(/\\s+/).join('.') : '') + ' right=' + Math.round(r.right));
      if (wide.length >= 6) break;
    }
  }
  return {
    sw: d.scrollWidth, cw, h: d.scrollHeight, title: document.title,
    badImgs: [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')),
    wide,
    fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).filter((v, i, a) => a.indexOf(v) === i),
  };
})()`;

async function shot(win, file) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, file), img.toPNG());
}

app.whenReady().then(async () => {
  const report = [];
  let failed = false;
  for (const w of widths) {
    const win = new BrowserWindow({
      width: w, height: 900, show: false,
      webPreferences: { offscreen: true, backgroundThrottling: false },
    });
    let errors = [];
    win.webContents.on('console-message', (e, level, msg, line, src) => {
      // Electron prints its own dev-mode CSP notice into every page it hosts; it is
      // about the harness, not the site.
      if (level >= 2 && msg.indexOf('Electron Security Warning') === -1) errors.push(msg + ' @' + (src || '') + ':' + line);
    });
    win.webContents.setFrameRate(10);
    for (const [p, query] of pages) {
      errors = [];
      const base = p.replace('.html', '') + '-' + w;
      log(`load ${p} @ ${w}`);
      try {
        await win.loadFile(path.join(SITE, p), { query });
        await sleep(2200);
        const info = await win.webContents.executeJavaScript(PROBE);
        // First screen.
        await shot(win, `${base}-fold.png`);
        // Full page (capped).
        win.setSize(w, Math.max(600, Math.min(info.h, 12000)));
        await sleep(700);
        await shot(win, `${base}-full.png`);
        win.setSize(w, 900);
        await sleep(300);
        const row = { page: p, width: w, ...info, errors: errors.slice() };
        if (info.sw > info.cw || info.badImgs.length) failed = true;
        report.push(row);
        log(`  ok h=${info.h} overflow=${info.sw - info.cw} imgs=${info.badImgs.length} errors=${row.errors.length}`);
        if (p === 'index.html' && w === 1366) {
          for (const sel of SECTIONS) {
            const found = await win.webContents.executeJavaScript(
              `(() => { const el = document.querySelector('${sel}'); if (!el) return false; document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70); return true; })()`
            );
            if (!found) { log(`  section ${sel} not found`); continue; }
            await sleep(1000);
            win.webContents.invalidate();
            await sleep(200);
            await shot(win, `index-1366-section-${sel.replace('#', '')}.png`);
          }
          await win.webContents.executeJavaScript(`window.scrollTo(0, 0); document.getElementById('themeToggle').click(); true`);
          await sleep(800);
          await shot(win, 'index-1366-light-fold.png');
          await win.webContents.executeJavaScript(`(() => { const el = document.querySelector('#pricing'); document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70); return true; })()`);
          await sleep(1000);
          win.webContents.invalidate();
          await sleep(200);
          await shot(win, 'index-1366-light-pricing.png');
          await win.webContents.executeJavaScript(`localStorage.removeItem('cadence-theme'); document.documentElement.removeAttribute('data-theme'); true`);
        }
        if (p === 'docs.html' && w === 1366) {
          for (const sel of ['#engine-additions', '#pro', '#shortcuts']) {
            await win.webContents.executeJavaScript(`(() => { const el = document.querySelector('${sel}'); document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70); return true; })()`);
            await sleep(1000);
            win.webContents.invalidate();
            await sleep(200);
            await shot(win, `docs-1366-section-${sel.replace('#', '')}.png`);
          }
        }
      } catch (e) {
        failed = true;
        report.push({ page: p, width: w, error: String(e), errors: errors.slice() });
        log(`  THREW ${e}`);
      }
    }
    win.destroy();
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  for (const r of report) {
    log(
      `${r.page.padEnd(15)} ${String(r.width).padStart(4)}px  h=${String(r.h || '-').padStart(5)}  ` +
      `overflow=${r.sw > r.cw ? r.sw - r.cw + 'px ' + r.wide.join(' | ') : 'none'}  ` +
      `badImgs=${(r.badImgs || []).length}  errors=${r.errors.length}${r.error ? '  THREW ' + r.error : ''}`
    );
    for (const e of r.errors) log('    console: ' + e);
  }
  log(`screenshots in ${OUT}`);
  app.exit(failed ? 1 : 0);
});
