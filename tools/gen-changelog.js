#!/usr/bin/env node
// Generates site/changelog.html from the repository's own history — the last
// 60 commits, grouped by day, each linked to its commit on GitHub — so the
// public changelog can never say something the repository does not.
//
//   node site/tools/gen-changelog.js            # rewrite site/changelog.html
//   node site/tools/gen-changelog.js --count 80 # a different window
//
// Run it as part of cutting a release (site/README.md). The page shell lives
// in this file on purpose: there is nothing to hand-edit in the output.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'site', 'changelog.html');
const REPO = 'alycoulibal2-sketch/Cadence-Animator';

const countArg = process.argv.indexOf('--count');
const COUNT = countArg !== -1 ? parseInt(process.argv[countArg + 1], 10) : 60;

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

// hash \x1f short \x1f date \x1f subject, one commit per line.
const raw = execFileSync('git', ['log', `-${COUNT}`, '--date=short', '--format=%H%x1f%h%x1f%ad%x1f%s'], {
  cwd: ROOT,
  encoding: 'utf8',
});
const commits = raw.split('\n').filter(Boolean).map((line) => {
  const [sha, short, date, subject] = line.split('\x1f');
  return { sha, short, date, subject };
});
if (!commits.length) {
  console.error('gen-changelog: git log returned nothing.');
  process.exit(1);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isRelease = (s) => /^(Bump version to|\d+\.\d+\.\d+\b|Release )/i.test(s);

const byDay = new Map();
for (const c of commits) {
  if (!byDay.has(c.date)) byDay.set(c.date, []);
  byDay.get(c.date).push(c);
}

let body = '';
for (const [date, list] of byDay) {
  const nice = new Date(date + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  body += `      <li class="log-day">\n        <h2>${esc(nice)}</h2>\n        <ul>\n`;
  for (const c of list) {
    const pill = isRelease(c.subject) ? ' <span class="pill pill-release">release</span>' : '';
    body += `          <li><a class="sha" href="https://github.com/${REPO}/commit/${c.sha}">${c.short}</a><span>${esc(c.subject)}${pill}</span></li>\n`;
  }
  body += '        </ul>\n      </li>\n';
}

const generated = new Date().toISOString().slice(0, 10);

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Changelog — Cadence Animator</title>
<meta name="description" content="What changed in Cadence Animator, straight from the repository: the last ${commits.length} commits, each linked to its diff on GitHub.">
<meta name="theme-color" content="#0a0a0e">
<link rel="canonical" href="https://alycoulibal2-sketch.github.io/Cadence-Animator/changelog.html">
<meta property="og:type" content="article">
<meta property="og:title" content="Changelog — Cadence Animator">
<meta property="og:description" content="The last ${commits.length} commits, generated from git log.">
<meta property="og:url" content="https://alycoulibal2-sketch.github.io/Cadence-Animator/changelog.html">
<link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">
<script>(function(){try{var t=localStorage.getItem('cadence-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}document.documentElement.className+=' js'})();</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Inter:opsz,wght@14..32,400..700&display=swap">
<link rel="stylesheet" href="assets/css/site.css">
</head>
<body>

<a class="skip-link" href="#main">Skip to content</a>
<div class="progress" id="progress" aria-hidden="true"></div>

<header class="nav" id="nav">
  <div class="shell nav-inner">
    <a class="brand" href="./" aria-label="Cadence Animator — home">
      <svg viewBox="0 0 28 24" width="26" height="22" fill="none" aria-hidden="true" focusable="false">
        <path d="M4.6 17.8C9.4 17.8 11.2 6.2 16 6.2C19.3 6.2 21 10.5 23.4 12" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
        <path d="M4.6 15L7.4 17.8L4.6 20.6L1.8 17.8Z" fill="currentColor"/>
        <path d="M16 3.4L18.8 6.2L16 9L13.2 6.2Z" fill="currentColor"/>
      </svg>
      Cadence <span class="brand-sub">Animator</span>
    </a>
    <nav aria-label="Primary">
      <ul class="nav-links" id="navLinks">
        <li><a href="index.html#animate">Animate</a></li>
        <li><a href="index.html#vfx">VFX</a></li>
        <li><a href="index.html#studio">Studio + Claude</a></li>
        <li><a href="index.html#pricing">Pricing</a></li>
        <li><a href="safety.html">Safety</a></li>
        <li><a href="docs.html">Docs</a></li>
      </ul>
    </nav>
    <div class="nav-actions">
      <button class="nav-search" id="cmdkOpen" type="button" aria-label="Search the site (Control K)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <span aria-hidden="true">Search</span>
        <kbd aria-hidden="true">Ctrl K</kbd>
      </button>
      <button class="icon-btn theme-toggle" id="themeToggle" type="button" aria-label="Switch theme">
        <svg class="sun" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
        <svg class="moon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>
      </button>
      <a class="btn btn-primary btn-sm" href="index.html#download">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 20h16"/></svg>
        <span>Download</span>
      </a>
      <button class="icon-btn nav-toggle" id="navToggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="navLinks">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
    </div>
  </div>
</header>

<main id="main">
  <div class="shell shell-narrow">
    <div class="page-hero">
      <p class="eyebrow">Changelog</p>
      <h1>What changed, straight from the repository.</h1>
      <p class="lede">
        The last <span data-changelog-count>${commits.length}</span> commits, generated from
        <code>git log</code> by <code>site/tools/gen-changelog.js</code> &mdash; nothing here was written
        for the website. Each line links to its diff. The current release is
        <a href="https://github.com/${REPO}/releases">v<span data-version>${esc(version)}</span></a>.
      </p>
      <p class="small muted">Generated ${generated} at commit <a class="mono" href="https://github.com/${REPO}/commit/${commits[0].sha}">${commits[0].short}</a>. <a href="https://github.com/${REPO}/commits/main">The full history is on GitHub.</a></p>
    </div>

    <!-- CHANGELOG:BEGIN — generated by site/tools/gen-changelog.js, do not hand-edit -->
    <ul class="log">
${body}    </ul>
    <!-- CHANGELOG:END -->
  </div>
</main>

<footer class="footer">
  <div class="shell">
    <div class="footer-grid">
      <div class="footer-about">
        <a class="brand" href="./" style="margin-right:0">
          <svg viewBox="0 0 28 24" width="26" height="22" fill="none" aria-hidden="true" focusable="false">
            <path d="M4.6 17.8C9.4 17.8 11.2 6.2 16 6.2C19.3 6.2 21 10.5 23.4 12" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
            <path d="M4.6 15L7.4 17.8L4.6 20.6L1.8 17.8Z" fill="currentColor"/>
            <path d="M16 3.4L18.8 6.2L16 9L13.2 6.2Z" fill="currentColor"/>
          </svg>
          Cadence <span class="brand-sub">Animator</span>
        </a>
        <p>A free, open-source Roblox animation suite for Windows. Built in the open; nothing leaves your PC.</p>
      </div>
      <div>
        <p class="footer-label">Product</p>
        <ul>
          <li><a href="index.html#animate">Animate</a></li>
          <li><a href="index.html#vfx">VFX Studio</a></li>
          <li><a href="index.html#studio">Roblox Studio + Claude</a></li>
          <li><a href="index.html#compare">Compared to Moon</a></li>
          <li><a href="index.html#pricing">Pricing</a></li>
          <li><a href="index.html#roadmap">Roadmap</a></li>
        </ul>
      </div>
      <div>
        <p class="footer-label">Docs</p>
        <ul>
          <li><a href="docs.html#install">Install</a></li>
          <li><a href="docs.html#studio-setup">Connect Studio</a></li>
          <li><a href="docs.html#first-animation">First animation</a></li>
          <li><a href="docs.html#shortcuts">Shortcuts</a></li>
          <li><a href="docs.html#pro">Pro and your key</a></li>
          <li><a href="docs.html#troubleshooting">Troubleshooting</a></li>
        </ul>
      </div>
      <div>
        <p class="footer-label">Trust</p>
        <ul>
          <li><a href="safety.html">Is it safe?</a></li>
          <li><a href="safety.html#verify">Verify a download</a></li>
          <li><a href="privacy.html">Privacy</a></li>
          <li><a href="changelog.html" aria-current="page">Changelog</a></li>
          <li><a href="https://github.com/${REPO}">Source code</a></li>
          <li><a href="https://github.com/${REPO}/issues">Report a concern</a></li>
        </ul>
      </div>
      <div>
        <p class="footer-label">Account</p>
        <ul>
          <li><a href="account.html">Your licence key</a></li>
          <li><a href="index.html#download">Download</a></li>
          <li><a href="https://github.com/${REPO}/releases">All releases</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-base">
      <span>Cadence Animator <span data-version>${esc(version)}</span> &middot; MIT licence</span>
      <span>Not affiliated with Roblox Corporation or Moon Animator.</span>
    </div>
  </div>
</footer>

<div class="cmdk" id="cmdk" role="dialog" aria-modal="true" aria-label="Jump to a section">
  <div class="cmdk-box">
    <div class="cmdk-input">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5" stroke-linecap="round"/></svg>
      <input id="cmdkInput" type="text" placeholder="Jump to anything…" autocomplete="off" spellcheck="false" aria-label="Search sections and documentation">
    </div>
    <ul class="cmdk-results" id="cmdkResults"></ul>
    <div class="cmdk-foot">
      <span><kbd>&uarr;</kbd><kbd>&darr;</kbd> navigate</span>
      <span><kbd>&crarr;</kbd> open</span>
      <span><kbd>Esc</kbd> close</span>
    </div>
  </div>
</div>

<script src="assets/js/config.js"></script>
<script src="assets/js/site.js" defer></script>
</body>
</html>
`;

fs.writeFileSync(OUT, page);
console.log(`gen-changelog: wrote ${commits.length} commits across ${byDay.size} days to site/changelog.html (head ${commits[0].short}).`);
