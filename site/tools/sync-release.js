#!/usr/bin/env node
// Refreshes the release facts on the website — version, filenames, sizes and
// SHA-256 for both Windows builds — from the live GitHub release, so the
// no-JavaScript fallback links and the printed checksums can't go stale after a
// release.
//
//   node site/tools/sync-release.js           # rewrite the files in place
//   node site/tools/sync-release.js --check   # report drift, change nothing
//   node site/tools/sync-release.js --tag v0.8.0
//
// Run it as step 2 of the release checklist in site/README.md.
const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO = 'alycoulibal2-sketch/Cadence-Animator';
const ROOT = path.resolve(__dirname, '..', '..');
const FILES = ['index.html', 'docs.html'].map((f) => path.join(ROOT, 'site', f));

const check = process.argv.includes('--check');
const tagArg = (() => {
  const i = process.argv.indexOf('--tag');
  return i !== -1 ? process.argv[i + 1] : null;
})();

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            // GitHub rejects API requests with no user agent.
            'User-Agent': 'cadence-site-sync',
            Accept: 'application/vnd.github+json',
          },
        },
        (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            res.resume();
            return get(res.headers.location).then(resolve, reject);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`GitHub API returned ${res.statusCode} for ${url}`));
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => { body += c; });
          res.on('end', () => {
            try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
          });
        }
      )
      .on('error', reject);
  });
}

// GitHub reports each asset's digest as "sha256:<hex>". Older releases predate
// that field, in which case we can still fall back to the local dist/ build.
function digestOf(asset) {
  const d = asset && asset.digest;
  if (d && d.indexOf('sha256:') === 0) return d.slice('sha256:'.length).toLowerCase();
  return null;
}

function localDigest(name, version) {
  // dist/ names the files "Cadence Animator Setup 0.8.0.exe"; the release asset
  // is the same file with spaces turned into hyphens.
  const local = path.join(ROOT, 'dist', name.replace(/-/g, ' '));
  if (!fs.existsSync(local)) return null;
  const crypto = require('crypto');
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(local));
  const hex = h.digest('hex');
  console.log(`  (hashed dist/${path.basename(local)} locally for ${version})`);
  return hex;
}

// The separator between the number and the unit is a non-breaking space,
// written here as a \u00a0 escape so it is visible in source. It stops
// "97.2 MB" splitting across a line, and keeps this script idempotent
// against markup a previous run already wrote.
const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + '\u00a0MB';

(async () => {
  const release = await get(
    tagArg
      ? `https://api.github.com/repos/${REPO}/releases/tags/${tagArg}`
      : `https://api.github.com/repos/${REPO}/releases/latest`
  );

  const version = String(release.tag_name || '').replace(/^v/, '');
  const assets = release.assets || [];
  const installer = assets.find((a) => /Setup.*\.exe$/i.test(a.name));
  const portable = assets.find((a) => /\.exe$/i.test(a.name) && !/Setup/i.test(a.name));

  if (!version || !installer || !portable) {
    console.error('sync-release: release is missing a version, an installer or a portable exe.');
    console.error('  tag:', release.tag_name, '| assets:', assets.map((a) => a.name).join(', '));
    process.exit(1);
  }

  const info = {
    version,
    installer: {
      name: installer.name,
      url: installer.browser_download_url,
      size: mb(installer.size),
      sha: digestOf(installer) || localDigest(installer.name, version),
    },
    portable: {
      name: portable.name,
      url: portable.browser_download_url,
      size: mb(portable.size),
      sha: digestOf(portable) || localDigest(portable.name, version),
    },
  };

  if (!info.installer.sha || !info.portable.sha) {
    console.error('sync-release: could not determine a SHA-256 for both builds.');
    console.error('  GitHub had no digest field and dist/ has no matching local file.');
    console.error('  Refusing to write a page with a missing or stale checksum.');
    process.exit(1);
  }

  let drift = false;

  for (const file of FILES) {
    const before = fs.readFileSync(file, 'utf8');
    let out = before;

    // Version, everywhere it is displayed.
    out = out.replace(/(<span data-version>)[^<]*(<\/span>)/g, `$1${version}$2`);

    // Download hrefs. Only the two tagged anchors, so an unrelated GitHub link
    // in the prose is never touched.
    out = out.replace(
      /<a([^>]*?)href="[^"]*"([^>]*?)data-dl="installer"/g,
      `<a$1href="${info.installer.url}"$2data-dl="installer"`
    );
    out = out.replace(
      /<a([^>]*?)href="[^"]*"([^>]*?)data-dl="portable"/g,
      `<a$1href="${info.portable.url}"$2data-dl="portable"`
    );

    // Sizes.
    out = out.replace(/(<span data-size>)[^<]*(<\/span>)/g, `$1${info.installer.size}$2`);
    out = out.replace(/(data-size-installer>)[^<]*(<\/dd>)/g, `$1${info.installer.size}$2`);
    out = out.replace(/(data-size-portable>)[^<]*(<\/dd>)/g, `$1${info.portable.size}$2`);

    // Filenames and checksums, matched by the asset name pattern so each card
    // gets its own values rather than both getting the installer's.
    out = out.replace(
      /<code>Cadence-Animator-Setup-[^<]*<\/code>/g,
      `<code>${info.installer.name}</code>`
    );
    out = out.replace(
      /<code>Cadence-Animator-(?!Setup)[0-9][^<]*<\/code>/g,
      `<code>${info.portable.name}</code>`
    );

    // The two <details> hash blocks, in document order: installer then portable.
    let hashSeen = 0;
    out = out.replace(/(<summary>Verify this file \(SHA-256\)<\/summary>\s*<code>)[0-9a-f]{64}(<\/code>)/g,
      (m, a, b) => a + (hashSeen++ === 0 ? info.installer.sha : info.portable.sha) + b);

    if (out !== before) {
      drift = true;
      if (!check) fs.writeFileSync(file, out);
      console.log(`${check ? 'stale' : 'updated'}: site/${path.basename(file)}`);
    } else {
      console.log(`unchanged: site/${path.basename(file)}`);
    }
  }

  console.log(
    `\nrelease ${version}\n` +
    `  ${info.installer.name}  ${info.installer.size}  ${info.installer.sha}\n` +
    `  ${info.portable.name}  ${info.portable.size}  ${info.portable.sha}`
  );

  if (check && drift) {
    console.error('\nsync-release: the site does not match the live release. Run without --check.');
    process.exit(1);
  }
})().catch((e) => {
  console.error('sync-release failed:', e.message);
  console.error('The site is unchanged. Its hardcoded links still point at a real release.');
  process.exit(1);
});
