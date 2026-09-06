/* ==========================================================================
   Cadence Animator — site behaviour

   Everything here is progressive enhancement. With JavaScript off every page
   is still fully readable, every download link still points at a real file,
   and every "not open yet" state is the one written in the HTML. Scripts only
   ever add: a theme toggle, live numbers, a hash checker, and the Pro links
   when config.js has them.

   No third-party script runs on this site. The only network calls are to
   api.github.com (numbers and the latest release) and, when configured, the
   owner's own licence API.
   ========================================================================== */

(function () {
  'use strict';

  var REPO = 'alycoulibal2-sketch/Cadence-Animator';
  var API = 'https://api.github.com/repos/' + REPO;
  var CONFIG = window.CADENCE_CONFIG || {};
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (page.indexOf('.html') === -1) page = 'index.html';

  /* ------------------------------------------------------------- theme */

  var root = document.documentElement;
  var themeMeta = $('meta[name="theme-color"]');

  function currentTheme() {
    var set = root.getAttribute('data-theme');
    if (set === 'light' || set === 'dark') return set;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  function paintMeta() {
    if (themeMeta) themeMeta.setAttribute('content', currentTheme() === 'light' ? '#f4f4f8' : '#0a0a0e');
  }
  paintMeta();

  $$('.theme-toggle').forEach(function (btn) {
    btn.setAttribute('aria-label', 'Switch to ' + (currentTheme() === 'light' ? 'dark' : 'light') + ' theme');
    btn.addEventListener('click', function () {
      var next = currentTheme() === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('cadence-theme', next); } catch (e) { /* private mode: the choice lasts the page */ }
      btn.setAttribute('aria-label', 'Switch to ' + (next === 'light' ? 'dark' : 'light') + ' theme');
      paintMeta();
    });
  });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', paintMeta);

  /* ------------------------------------------------------------- toast */

  var toastEl = null, toastTimer = null;
  function toast(html, ms) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = html;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 5200);
  }

  /* ------------------------------------------------------------- nav */

  var nav = $('#nav');
  var navLinks = $('#navLinks');
  var navToggle = $('#navToggle');

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      var open = navLinks.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    navLinks.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        navLinks.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  var progress = $('#progress');
  var ticking = false;
  function onScroll() {
    var y = window.scrollY || document.documentElement.scrollTop;
    if (nav) nav.classList.toggle('scrolled', y > 8);
    if (progress) {
      var doc = document.documentElement;
      var max = doc.scrollHeight - doc.clientHeight;
      progress.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0) + ')';
    }
    ticking = false;
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();

  /* ------------------------------------------------------------- reveal */

  var reveals = $$('.reveal');
  if (reveals.length) {
    if (reduceMotion || !('IntersectionObserver' in window)) {
      reveals.forEach(function (el) { el.classList.add('in'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { entry.target.classList.add('in'); io.unobserve(entry.target); }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
      reveals.forEach(function (el) { io.observe(el); });
    }
  }

  /* ------------------------------------------ active section highlighting */

  function trackActive(linkSelector) {
    var links = $$(linkSelector).filter(function (a) {
      var href = a.getAttribute('href') || '';
      return href.charAt(0) === '#' && href.length > 1;
    });
    if (!links.length) return;
    var targets = links.map(function (a) {
      return { link: a, el: document.getElementById(a.getAttribute('href').slice(1)) };
    }).filter(function (t) { return t.el; });
    if (!targets.length) return;

    var pending = false;
    function update() {
      var line = (window.scrollY || 0) + (nav ? nav.offsetHeight : 0) + 60;
      var current = null;
      targets.forEach(function (t) {
        if (t.el.getBoundingClientRect().top + window.scrollY <= line) current = t;
      });
      var atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 40;
      if (atBottom) current = targets[targets.length - 1];
      var changed = false;
      targets.forEach(function (t) {
        var want = t === current;
        if (t.link.classList.contains('active') !== want) changed = true;
        t.link.classList.toggle('active', want);
      });
      if (changed && current) {
        var box = current.link.closest('.toc');
        if (box && box.scrollHeight > box.clientHeight + 4) {
          var top = current.link.offsetTop - box.offsetTop;
          var bottom = top + current.link.offsetHeight;
          if (top < box.scrollTop + 8) box.scrollTop = Math.max(0, top - 8);
          else if (bottom > box.scrollTop + box.clientHeight - 8) box.scrollTop = bottom - box.clientHeight + 8;
        }
      }
      pending = false;
    }
    window.addEventListener('scroll', function () {
      if (!pending) { pending = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', update);
    update();
  }
  trackActive('.nav-links a');
  trackActive('.toc a');

  /* ------------------------------------------------------- command palette */

  var PALETTE = [
    { label: 'Download Cadence', group: 'Get it', href: 'index.html#download' },
    { label: 'See it in 60 seconds', group: 'Product', href: 'index.html#demo' },
    { label: 'Animate — IK, onion skin, Moon keybinds', group: 'Product', href: 'index.html#animate' },
    { label: 'VFX Studio and the procedural engine', group: 'Product', href: 'index.html#vfx' },
    { label: 'Roblox Studio sync and Claude', group: 'Product', href: 'index.html#studio' },
    { label: 'Compared to Moon Animator 2', group: 'Product', href: 'index.html#compare' },
    { label: 'Is it safe? Proof, not claims', group: 'Trust', href: 'safety.html' },
    { label: 'Verify a download (SHA-256)', group: 'Trust', href: 'safety.html#verify' },
    { label: 'What Windows will show you', group: 'Trust', href: 'index.html#smartscreen' },
    { label: 'Privacy', group: 'Trust', href: 'privacy.html' },
    { label: 'Pricing — Free and Pro', group: 'Product', href: 'index.html#pricing' },
    { label: 'Frequently asked questions', group: 'Product', href: 'index.html#faq' },
    { label: 'Roadmap', group: 'Project', href: 'index.html#roadmap' },
    { label: 'Changelog', group: 'Project', href: 'changelog.html' },
    { label: 'Your account and licence key', group: 'Account', href: 'account.html' },

    { label: 'Install Cadence', group: 'Docs', href: 'docs.html#install' },
    { label: 'System requirements', group: 'Docs', href: 'docs.html#requirements' },
    { label: 'Connect Roblox Studio', group: 'Docs', href: 'docs.html#studio-setup' },
    { label: 'Your first animation', group: 'Docs', href: 'docs.html#first-animation' },
    { label: 'Importing rigs', group: 'Docs', href: 'docs.html#rigs' },
    { label: 'Inverse kinematics', group: 'Docs', href: 'docs.html#ik' },
    { label: 'Easing and the curve editor', group: 'Docs', href: 'docs.html#easing' },
    { label: 'Exporting to Studio', group: 'Docs', href: 'docs.html#export' },
    { label: 'VFX Studio guide', group: 'Docs', href: 'docs.html#vfx-guide' },
    { label: 'Procedural engine guide', group: 'Docs', href: 'docs.html#procedural-guide' },
    { label: 'What the engine gained — flocking, liquid, events', group: 'Docs', href: 'docs.html#engine-additions' },
    { label: 'Pro and your licence key', group: 'Docs', href: 'docs.html#pro' },
    { label: 'Set up MCP for Claude', group: 'Docs', href: 'docs.html#mcp' },
    { label: 'Keyboard shortcuts', group: 'Docs', href: 'docs.html#shortcuts' },
    { label: 'Phone companion', group: 'Docs', href: 'docs.html#mobile' },
    { label: 'Updating Cadence', group: 'Docs', href: 'docs.html#updating' },
    { label: 'Autosave and recovery', group: 'Docs', href: 'docs.html#autosave' },
    { label: 'Troubleshooting', group: 'Docs', href: 'docs.html#troubleshooting' },

    { label: 'Source code on GitHub', group: 'Project', href: 'https://github.com/' + REPO },
    { label: 'All releases', group: 'Project', href: 'https://github.com/' + REPO + '/releases' },
    { label: 'Report an issue or a concern', group: 'Project', href: 'https://github.com/' + REPO + '/issues' }
  ];

  var cmdk = $('#cmdk');
  var cmdkInput = $('#cmdkInput');
  var cmdkResults = $('#cmdkResults');
  var cmdkOpenBtn = $('#cmdkOpen');
  var selIndex = 0;
  var shown = [];
  var lastFocus = null;

  function resolveHref(href) {
    // On the page we are already on, drop the filename so the link is a pure
    // in-page anchor (no reload, smooth scroll still applies).
    if (href.indexOf(page + '#') === 0) return href.slice(page.length);
    if (href === page) return '#';
    return href;
  }

  function score(item, q) {
    var label = item.label.toLowerCase();
    var i = label.indexOf(q);
    if (i === 0) return 0;
    if (i > 0) return 1;
    if (item.group.toLowerCase().indexOf(q) === 0) return 2;
    var pos = 0;
    for (var c = 0; c < q.length; c++) {
      pos = label.indexOf(q.charAt(c), pos);
      if (pos === -1) return -1;
      pos++;
    }
    return 3;
  }

  function renderResults() {
    if (!cmdkResults) return;
    var q = (cmdkInput.value || '').trim().toLowerCase();
    shown = q
      ? PALETTE.map(function (it) { return { it: it, s: score(it, q) }; })
          .filter(function (r) { return r.s >= 0; })
          .sort(function (a, b) { return a.s - b.s; })
          .map(function (r) { return r.it; })
      : PALETTE.slice();
    if (selIndex >= shown.length) selIndex = 0;
    cmdkResults.innerHTML = '';
    if (!shown.length) {
      var empty = document.createElement('li');
      empty.className = 'cmdk-empty';
      empty.textContent = 'Nothing matches “' + (cmdkInput.value || '') + '”.';
      cmdkResults.appendChild(empty);
      return;
    }
    shown.forEach(function (item, i) {
      var li = document.createElement('li');
      if (i === selIndex) li.className = 'sel';
      var a = document.createElement('a');
      a.href = resolveHref(item.href);
      a.textContent = item.label;
      var small = document.createElement('small');
      small.textContent = item.group;
      a.appendChild(small);
      a.addEventListener('click', function () { closeCmdk(); });
      a.addEventListener('mousemove', function () {
        if (selIndex === i) return;
        selIndex = i;
        $$('li', cmdkResults).forEach(function (el, k) { el.className = k === i ? 'sel' : ''; });
      });
      li.appendChild(a);
      cmdkResults.appendChild(li);
    });
  }

  function openCmdk() {
    if (!cmdk) return;
    lastFocus = document.activeElement;
    cmdk.classList.add('open');
    cmdkInput.value = '';
    selIndex = 0;
    renderResults();
    cmdkInput.focus();
  }
  function closeCmdk() {
    if (!cmdk) return;
    cmdk.classList.remove('open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  if (cmdkOpenBtn) cmdkOpenBtn.addEventListener('click', openCmdk);
  if (cmdkInput) cmdkInput.addEventListener('input', function () { selIndex = 0; renderResults(); });
  if (cmdk) cmdk.addEventListener('mousedown', function (e) { if (e.target === cmdk) closeCmdk(); });

  document.addEventListener('keydown', function (e) {
    var open = cmdk && cmdk.classList.contains('open');
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      open ? closeCmdk() : openCmdk();
      return;
    }
    if (!open && e.key === '/' && !typing) { e.preventDefault(); openCmdk(); return; }
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); closeCmdk(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown.length) return;
      selIndex = (selIndex + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      renderResults();
      var sel = $('li.sel', cmdkResults);
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      var link = $('li.sel a', cmdkResults);
      if (link) { closeCmdk(); link.click(); }
    } else if (e.key === 'Tab') { e.preventDefault(); cmdkInput.focus(); }
  });

  /* ------------------------------------------------ shortcut reference filter */

  var keysFilter = $('#keysFilter');
  if (keysFilter) {
    var groups = $$('.keys-group');
    var noMatch = $('#keysEmpty');
    keysFilter.addEventListener('input', function () {
      var q = keysFilter.value.trim().toLowerCase();
      var anyVisible = false;
      groups.forEach(function (group) {
        var rows = $$('.keys-list > div', group);
        var groupVisible = false;
        rows.forEach(function (row) {
          var hit = !q || row.textContent.toLowerCase().indexOf(q) !== -1;
          row.style.display = hit ? '' : 'none';
          if (hit) groupVisible = true;
        });
        group.style.display = groupVisible ? '' : 'none';
        if (groupVisible) anyVisible = true;
      });
      if (noMatch) noMatch.style.display = anyVisible ? 'none' : '';
    });
  }

  /* ---------------------------------------------------- copy to clipboard */

  function copyText(text, done, fail) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fail);
      return;
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (err) { fail(); }
    document.body.removeChild(ta);
  }

  $$('pre').forEach(function (pre) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost btn-sm';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy code to clipboard');
    btn.style.cssText = 'position:absolute;top:8px;right:8px;padding:4px 10px;font-size:0.75rem;opacity:0;transition:opacity var(--dur) var(--ease)';
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative';
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);
    wrap.appendChild(btn);
    function show() { btn.style.opacity = '1'; }
    function hide() { if (document.activeElement !== btn) btn.style.opacity = '0'; }
    wrap.addEventListener('mouseenter', show);
    wrap.addEventListener('mouseleave', hide);
    btn.addEventListener('focus', show);
    btn.addEventListener('blur', hide);
    btn.addEventListener('click', function () {
      copyText(pre.innerText, function () {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = 'Copy'; }, 1600);
      }, function () { btn.textContent = 'Press Ctrl+C'; });
    });
  });

  $$('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = $(btn.getAttribute('data-copy'));
      if (!target) return;
      var original = btn.textContent;
      copyText(target.textContent.trim(), function () {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = original; }, 1600);
      }, function () { btn.textContent = 'Press Ctrl+C'; });
    });
  });

  /* ------------------------------------------------ demo: the honest state */

  var demoPlay = $('#demoPlay');
  if (demoPlay) {
    demoPlay.addEventListener('click', function (e) {
      e.preventDefault();
      toast('The 60-second video is not published yet — what you see is an unedited screenshot of the shipping build. ' +
            'Meanwhile: <a href="docs.html#first-animation">your first animation in six steps →</a>', 7000);
    });
  }

  /* --------------------------------------------- latest release (enhancement)

     The download buttons already work without this. All it does is notice a
     newer release than the one the page was built against and retarget the
     buttons, version and size labels at it. Any failure is silent by design. */

  function fmtSize(bytes) { return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' MB'; }

  function cmpVersion(a, b) {
    var pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  function applyRelease(release) {
    var assets = release.assets || [];
    var find = function (re) {
      for (var i = 0; i < assets.length; i++) if (re.test(assets[i].name)) return assets[i];
      return null;
    };
    var installer = find(/Setup.*\.exe$/i);
    var portable = find(/^(?!.*Setup).*\.exe$/i);
    var tag = (release.tag_name || '').replace(/^v/, '');
    if (!tag || !installer) return;
    var current = (($('[data-version]') || {}).textContent || '0').trim();
    if (cmpVersion(tag, current) <= 0) return;

    $$('[data-version]').forEach(function (el) { el.textContent = tag; });
    $$('[data-dl="installer"]').forEach(function (a) { a.href = installer.browser_download_url; });
    $$('[data-size]').forEach(function (el) { el.textContent = fmtSize(installer.size); });
    $$('[data-size-installer]').forEach(function (el) { el.textContent = fmtSize(installer.size); });
    $$('[data-file="installer"]').forEach(function (el) { el.textContent = installer.name; });
    if (portable) {
      $$('[data-dl="portable"]').forEach(function (a) { a.href = portable.browser_download_url; });
      $$('[data-size-portable]').forEach(function (el) { el.textContent = fmtSize(portable.size); });
      $$('[data-file="portable"]').forEach(function (el) { el.textContent = portable.name; });
    }
    // Hashes and VirusTotal links are version-specific. Rather than leave a
    // stale hash next to a newer file, point at the release page instead.
    $$('[data-stale-on-update]').forEach(function (el) {
      el.innerHTML = 'See the <a href="' + release.html_url + '">' + tag +
        ' release notes</a> for this build’s filenames and checksums.';
    });
    $$('[data-vt]').forEach(function (a) {
      a.href = release.html_url;
      a.textContent = 'Hashes for ' + tag + ' are on the release page';
    });
    $$('.hash').forEach(function (d) { d.setAttribute('data-stale', 'true'); });
  }

  /* ------------------------------------------------ live numbers from GitHub

     "—" until they load, and "—" if they never do. Nothing here is ever
     estimated, cached in the page or padded. */

  var ghEls = $$('[data-gh]');
  var ghStatus = $('#ghStatus');
  function setGh(key, value) {
    ghEls.forEach(function (el) {
      if (el.getAttribute('data-gh') !== key) return;
      el.textContent = value;
      el.classList.remove('pending');
    });
  }
  function fmtInt(n) { return Number(n).toLocaleString('en-US'); }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return iso.slice(0, 10); }
  }
  function ghFetch(url) {
    return fetch(url, { headers: { Accept: 'application/vnd.github+json' } }).then(function (r) {
      if (!r.ok) throw new Error('GitHub answered ' + r.status);
      return r;
    });
  }

  if (window.fetch && (ghEls.length || $('[data-dl]'))) {
    var jobs = [];

    if (ghEls.length) {
      jobs.push(ghFetch(API).then(function (r) { return r.json(); }).then(function (j) {
        setGh('stars', fmtInt(j.stargazers_count));
        setGh('forks', fmtInt(j.forks_count));
        setGh('watchers', fmtInt(j.subscribers_count));
      }));

      // Sum the download_count of every .exe in every release. The .blockmap
      // and latest.yml assets are fetched by the updater on every launch, so
      // counting them would call an update check a download.
      var sumPage = function (pageNo, acc) {
        return ghFetch(API + '/releases?per_page=100&page=' + pageNo).then(function (r) { return r.json(); }).then(function (list) {
          list.forEach(function (rel) {
            (rel.assets || []).forEach(function (a) {
              if (/\.exe$/i.test(a.name)) acc.exe += a.download_count || 0;
            });
          });
          if (pageNo === 1 && list.length) {
            var latest = list.filter(function (r) { return !r.draft && !r.prerelease; })[0];
            if (latest) {
              acc.latest = latest;
              setGh('last-release', fmtDate(latest.published_at));
              setGh('releases', fmtInt(list.length));
            }
          }
          if (list.length === 100 && pageNo < 5) return sumPage(pageNo + 1, acc);
          return acc;
        });
      };
      jobs.push(sumPage(1, { exe: 0, latest: null }).then(function (acc) {
        setGh('downloads', fmtInt(acc.exe));
        if (acc.latest) applyRelease(acc.latest);
      }));

      // GitHub exposes the Link header, whose last page number with
      // per_page=1 is the commit count. If the header is missing, "—" stays.
      jobs.push(ghFetch(API + '/commits?per_page=1').then(function (r) {
        var link = r.headers.get('Link') || '';
        var m = /[?&]page=(\d+)>;\s*rel="last"/.exec(link);
        if (m) setGh('commits', fmtInt(m[1]));
      }));
    } else {
      jobs.push(ghFetch(API + '/releases/latest').then(function (r) { return r.json(); }).then(function (j) {
        if (j && !j.draft && !j.prerelease) applyRelease(j);
      }));
    }

    Promise.all(jobs.map(function (p) { return p.catch(function (e) { return e; }); })).then(function (results) {
      var failed = results.some(function (r) { return r instanceof Error; });
      if (ghStatus) {
        ghStatus.textContent = failed
          ? 'GitHub could not be reached just now, so some numbers stayed blank — nothing here is ever estimated.'
          : 'Live from the GitHub API a moment ago.';
      }
    });
  }

  /* ------------------------------------------------ verify a download

     Drag the installer onto the page: the browser hashes it locally with
     WebCrypto and compares against the hashes printed on the page. The file
     never leaves the machine — there is no upload target here to send it to. */

  var verify = $('#verify');
  if (verify) {
    var zone = $('#dropzone');
    var fileInput = $('#verifyFile');
    var result = $('#verifyResult');
    var hasCrypto = !!(window.crypto && window.crypto.subtle && window.crypto.subtle.digest);
    if (!hasCrypto) verify.classList.add('no-webcrypto');

    function publishedHashes() {
      return $$('.hash').filter(function (d) { return !d.getAttribute('data-stale'); }).map(function (d) {
        var code = $('code', d);
        var build = d.getAttribute('data-build') || 'build';
        var nameEl = $('[data-file="' + build + '"]');
        return {
          hex: (code ? code.textContent : '').trim().toLowerCase(),
          build: build,
          name: nameEl ? nameEl.textContent.trim() : build
        };
      }).filter(function (h) { return /^[0-9a-f]{64}$/.test(h.hex); });
    }

    function show(kind, html) {
      result.className = 'note verify-result show note-' + kind;
      result.innerHTML =
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        (kind === 'good' ? '<path d="m5 13 4 4L19 7"/>' : kind === 'bad' ? '<path d="M6 6l12 12M18 6 6 18"/>' : '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>') +
        '</svg><span>' + html + '</span>';
    }

    function hex(buf) {
      var bytes = new Uint8Array(buf), out = '';
      for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
      return out;
    }

    function check(file) {
      if (!file) return;
      if (!hasCrypto) {
        show('warn', 'This browser has no WebCrypto, so the page cannot hash the file. Use the PowerShell command below instead.');
        return;
      }
      var mb = (file.size / (1024 * 1024)).toFixed(1);
      show('info', 'Reading <strong>' + file.name + '</strong> (' + mb + ' MB) — nothing is uploaded, the hash is computed here in your browser…');
      var started = Date.now();
      file.arrayBuffer().then(function (buf) {
        show('info', 'Hashing ' + mb + ' MB with SHA-256…');
        return window.crypto.subtle.digest('SHA-256', buf);
      }).then(function (digest) {
        var got = hex(digest);
        var published = publishedHashes();
        var hit = published.filter(function (h) { return h.hex === got; })[0];
        var secs = ((Date.now() - started) / 1000).toFixed(1);
        var version = (($('[data-version]') || {}).textContent || '').trim();
        if (hit) {
          show('good', '<strong>Match.</strong> <em>' + file.name + '</em> is byte-for-byte the published <strong>' + hit.name +
            '</strong> (' + hit.build + ' build, v' + version + '). Hashed in ' + secs + ' s.<code>' + got + '</code>');
        } else if (!published.length) {
          show('warn', 'The page has no current hash to compare against (a newer release exists — see the release notes). Your file’s SHA-256:<code>' + got + '</code>');
        } else {
          show('bad', '<strong>No match.</strong> The SHA-256 of <em>' + file.name + '</em> is not one of the hashes published for v' + version +
            '. If it is a different version, compare it against <a href="https://github.com/' + REPO + '/releases">that release’s page</a>. ' +
            'Otherwise do not run it: delete it and download again from this site.<code>' + got + '</code>');
        }
      }).catch(function (e) {
        show('warn', 'Could not read that file: ' + (e && e.message ? e.message : e));
      });
    }

    if (fileInput) fileInput.addEventListener('change', function () { check(fileInput.files[0]); });
    if (zone) {
      ['dragenter', 'dragover'].forEach(function (ev) {
        zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('over'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('over'); });
      });
      zone.addEventListener('drop', function (e) {
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        check(f);
      });
      // Dropping anywhere else on the page would navigate to the file.
      window.addEventListener('dragover', function (e) { e.preventDefault(); });
      window.addEventListener('drop', function (e) { e.preventDefault(); });
    }
  }

  /* ------------------------------------------------ pricing: config-driven */

  function replaceWithLink(placeholder, url, label, sub, primary) {
    var a = document.createElement('a');
    a.className = 'btn ' + (primary ? 'btn-primary' : 'btn-ghost') + ' btn-block';
    a.href = url;
    a.textContent = label;
    if (sub) {
      var s = document.createElement('span');
      s.className = 'btn-sub';
      s.textContent = sub;
      a.appendChild(s);
    }
    placeholder.parentNode.replaceChild(a, placeholder);
    return a;
  }

  var buyFounding = $('#buyFounding');
  var buyPro = $('#buyPro');
  if (buyFounding || buyPro) {
    var founding = CONFIG.PRO_FOUNDING_LINK && String(CONFIG.PRO_FOUNDING_LINK).trim();
    var regular = CONFIG.PRO_LINK && String(CONFIG.PRO_LINK).trim();
    var soldOut = false;

    if (buyFounding && founding) buyFounding = replaceWithLink(buyFounding, founding, 'Buy a Founding key', '$9 one-time', true);
    if (buyPro && regular) buyPro = replaceWithLink(buyPro, regular, 'Buy Pro', '$12 one-time', !founding);

    var left = $('#foundingLeft');
    var api = CONFIG.LICENSE_API && String(CONFIG.LICENSE_API).replace(/\/+$/, '');
    if (left && api && window.fetch) {
      fetch(api + '/stats', { headers: { Accept: 'application/json' } }).then(function (r) {
        return r.ok ? r.json() : null;
      }).then(function (j) {
        var f = j && j.founding;
        if (!f || typeof f.sold !== 'number' || typeof f.limit !== 'number') return;
        var remaining = Math.max(0, f.limit - f.sold);
        left.textContent = remaining > 0
          ? remaining + ' of ' + f.limit + ' founding keys left'
          : 'All ' + f.limit + ' founding keys are gone — the regular price applies';
        left.classList.add('show');
        if (remaining === 0 && buyFounding) {
          soldOut = true;
          var span = document.createElement('span');
          span.className = 'btn is-disabled btn-block';
          span.textContent = 'Founding keys sold out';
          buyFounding.parentNode.replaceChild(span, buyFounding);
        }
      }).catch(function () { /* the counter stays hidden: no number is better than a wrong one */ });
    }
  }

  /* ------------------------------------------------ account: verify a key */

  var accountForm = $('#accountForm');
  if (accountForm) {
    var apiBase = CONFIG.LICENSE_API && String(CONFIG.LICENSE_API).replace(/\/+$/, '');
    var closed = $('#accountClosed');
    var status = $('#accountStatus');
    var support = CONFIG.SUPPORT_EMAIL ? '<a href="mailto:' + CONFIG.SUPPORT_EMAIL + '">' + CONFIG.SUPPORT_EMAIL + '</a>'
                                       : '<a href="https://github.com/' + REPO + '/issues">the issue tracker</a>';
    if (!apiBase) {
      if (closed) closed.classList.add('show');
      $$('input, button', accountForm).forEach(function (el) { el.disabled = true; });
    } else {
      if (closed) closed.classList.remove('show');
      accountForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var email = ($('#accountEmail') || {}).value || '';
        var key = ($('#accountKey') || {}).value || '';
        var btn = $('button[type="submit"]', accountForm);
        btn.disabled = true;
        status.className = 'note status show';
        status.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg><span>Checking with the licence server…</span>';
        fetch(apiBase + '/verify?email=' + encodeURIComponent(email.trim()) + '&key=' + encodeURIComponent(key.trim()), {
          headers: { Accept: 'application/json' }
        }).then(function (r) {
          if (!r.ok) throw new Error('The licence server answered ' + r.status);
          return r.json();
        }).then(function (j) {
          if (j && j.valid === true) {
            status.className = 'note note-good status show';
            status.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>' +
              '<span><strong>Valid.</strong> ' + (j.tier ? 'Tier: <strong>' + String(j.tier) + '</strong>. ' : '') +
              (j.since ? 'Since ' + fmtDate(j.since) + '. ' : '') +
              'Pro is the same download as Free: open Cadence, go to <strong>Settings → Pro</strong>, paste this key with this email, and the Pro features switch on. ' +
              '<a href="index.html#download">Download the current build →</a></span>';
          } else if (j && j.valid === false) {
            status.className = 'note note-bad status show';
            status.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>' +
              '<span><strong>Not valid</strong> for that email. Keys are tied to the email used at checkout — check both for typos, or write to ' + support + ' with your Stripe receipt.</span>';
          } else {
            throw new Error('Unexpected answer from the licence server.');
          }
        }).catch(function (err) {
          status.className = 'note note-warn status show';
          status.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 3 2 20h20L12 3Zm0 6v6m0 3h.01"/></svg>' +
              '<span><strong>Could not check right now.</strong> ' + (err && err.message ? err.message : '') + ' Try again in a minute. Your key is still valid — a failed check never revokes anything.</span>';
        }).then(function () { btn.disabled = false; });
      });
    }
  }

  /* ------------------------------------------------ thanks: fetch the key */

  var thanks = $('#thanks');
  if (thanks) {
    var tApi = CONFIG.LICENSE_API && String(CONFIG.LICENSE_API).replace(/\/+$/, '');
    var params = new URLSearchParams(location.search);
    var sessionId = params.get('session_id') || '';
    var states = ['thanksNoApi', 'thanksNoSession', 'thanksLoading', 'thanksKey', 'thanksError'];
    function state(id) {
      states.forEach(function (s) { var el = $('#' + s); if (el) el.hidden = s !== id; });
    }
    var supportLine = CONFIG.SUPPORT_EMAIL ? '<a href="mailto:' + CONFIG.SUPPORT_EMAIL + '">' + CONFIG.SUPPORT_EMAIL + '</a>'
                                            : '<a href="https://github.com/' + REPO + '/issues">the issue tracker</a> (never paste your key in a public issue)';
    $$('[data-support]').forEach(function (el) { el.innerHTML = supportLine; });

    function load() {
      state('thanksLoading');
      fetch(tApi + '/license?session_id=' + encodeURIComponent(sessionId), { headers: { Accept: 'application/json' } })
        .then(function (r) {
          if (!r.ok) throw new Error('The licence server answered ' + r.status);
          return r.json();
        })
        .then(function (j) {
          if (!j || typeof j.key !== 'string' || !j.key) throw new Error('No key in the answer yet');
          $('#thanksKeyValue').textContent = j.key;
          $('#thanksEmail').textContent = j.email || '(the email you entered at checkout)';
          state('thanksKey');
        })
        .catch(function (err) {
          var msg = $('#thanksErrorMsg');
          if (msg) msg.textContent = err && err.message ? err.message : 'Unknown error';
          state('thanksError');
        });
    }

    if (!tApi) state('thanksNoApi');
    else if (!sessionId) state('thanksNoSession');
    else load();

    var retry = $('#thanksRetry');
    if (retry) retry.addEventListener('click', load);
  }
})();
