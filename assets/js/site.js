/* ==========================================================================
   Cadence Animator — site behaviour

   Everything here is progressive enhancement. With JavaScript off the page is
   still fully navigable and every download link still points at a real file:
   the hardcoded hrefs in the HTML are the source of truth, and the GitHub
   release lookup below only ever *upgrades* them to a newer version.
   ========================================================================== */

(function () {
  'use strict';

  var REPO = 'alycoulibal2-sketch/Cadence-Animator';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  /* ------------------------------------------------------------------ nav */

  var nav = $('#nav');
  var navLinks = $('#navLinks');
  var navToggle = $('#navToggle');

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      var open = navLinks.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    // Tapping a link on mobile should close the sheet, not leave it covering
    // the section you just jumped to.
    navLinks.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        navLinks.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* -------------------------------------------- scroll: nav state + progress */

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
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            io.unobserve(entry.target);
          }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
      reveals.forEach(function (el) { io.observe(el); });
    }
  }

  /* ------------------------------------------ active section highlighting

     Used by both pages: the landing page highlights its top nav, the docs page
     highlights its sidebar. Picking "the last heading above the fold line" is
     more stable than IntersectionObserver ratios on sections of wildly
     different heights — a short section never loses the highlight to a tall
     neighbour.                                                            */

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
      // Near the very bottom the last section wins even if its heading is above
      // the line — otherwise the final nav item can never activate.
      var atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 40;
      if (atBottom) current = targets[targets.length - 1];

      var changed = false;
      targets.forEach(function (t) {
        var want = t === current;
        if (t.link.classList.contains('active') !== want) changed = true;
        t.link.classList.toggle('active', want);
      });

      // The docs sidebar is its own scroll container and is taller than the
      // viewport. Without this, reading a section near the end of a long page
      // leaves the sidebar parked at the top with the highlight out of sight.
      // Adjusting scrollTop directly (rather than scrollIntoView) keeps the
      // window scroll untouched.
      if (changed && current) {
        var box = current.link.closest('.toc');
        if (box && box.scrollHeight > box.clientHeight + 4) {
          var top = current.link.offsetTop - box.offsetTop;
          var bottom = top + current.link.offsetHeight;
          if (top < box.scrollTop + 8) box.scrollTop = Math.max(0, top - 8);
          else if (bottom > box.scrollTop + box.clientHeight - 8) {
            box.scrollTop = bottom - box.clientHeight + 8;
          }
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

  /* ------------------------------------------------------- command palette

     The app opens its command palette with Ctrl+K, so the site does too. This
     is the "never hunt for anything" affordance: every section of both pages is
     reachable in two keystrokes and a word.                                */

  var PALETTE = [
    { label: 'Download Cadence', group: 'Get it', href: 'index.html#download' },
    { label: 'Features overview', group: 'Product', href: 'index.html#features' },
    { label: 'Roblox Studio bridge', group: 'Product', href: 'index.html#studio' },
    { label: 'VFX Studio', group: 'Product', href: 'index.html#vfx' },
    { label: 'Sketch it — draw an effect', group: 'Product', href: 'index.html#vfx' },
    { label: 'Claude & MCP tools', group: 'Product', href: 'index.html#claude' },
    { label: 'Compared to Moon Animator 2', group: 'Product', href: 'index.html#compare' },
    { label: 'Frequently asked questions', group: 'Product', href: 'index.html#faq' },

    { label: 'Install Cadence', group: 'Docs', href: 'docs.html#install' },
    { label: 'System requirements', group: 'Docs', href: 'docs.html#requirements' },
    { label: 'Connect Roblox Studio', group: 'Docs', href: 'docs.html#studio-setup' },
    { label: 'Your first animation', group: 'Docs', href: 'docs.html#first-animation' },
    { label: 'Importing rigs', group: 'Docs', href: 'docs.html#rigs' },
    { label: 'Inverse kinematics', group: 'Docs', href: 'docs.html#ik' },
    { label: 'Easing and the curve editor', group: 'Docs', href: 'docs.html#easing' },
    { label: 'Exporting to Studio', group: 'Docs', href: 'docs.html#export' },
    { label: 'VFX Studio guide', group: 'Docs', href: 'docs.html#vfx-guide' },
    { label: 'Set up MCP for Claude', group: 'Docs', href: 'docs.html#mcp' },
    { label: 'Keyboard shortcuts', group: 'Docs', href: 'docs.html#shortcuts' },
    { label: 'Phone companion', group: 'Docs', href: 'docs.html#mobile' },
    { label: 'Updating Cadence', group: 'Docs', href: 'docs.html#updating' },
    { label: 'Autosave and recovery', group: 'Docs', href: 'docs.html#autosave' },
    { label: 'Troubleshooting', group: 'Docs', href: 'docs.html#troubleshooting' },

    { label: 'Source code on GitHub', group: 'Project', href: 'https://github.com/' + REPO },
    { label: 'All releases', group: 'Project', href: 'https://github.com/' + REPO + '/releases' },
    { label: 'Report an issue', group: 'Project', href: 'https://github.com/' + REPO + '/issues' }
  ];

  var cmdk = $('#cmdk');
  var cmdkInput = $('#cmdkInput');
  var cmdkResults = $('#cmdkResults');
  var cmdkOpenBtn = $('#cmdkOpen');
  var selIndex = 0;
  var shown = [];
  var lastFocus = null;

  // On the page we are already on, drop the filename so the link is a pure
  // in-page anchor (no reload, and smooth-scroll still applies).
  var onDocs = /docs\.html$/.test(location.pathname);
  function resolveHref(href) {
    if (onDocs && href.indexOf('docs.html#') === 0) return href.slice('docs.html'.length);
    if (!onDocs && href.indexOf('index.html#') === 0) return href.slice('index.html'.length);
    return href;
  }

  function score(item, q) {
    var label = item.label.toLowerCase();
    var i = label.indexOf(q);
    if (i === 0) return 0;
    if (i > 0) return 1;
    if (item.group.toLowerCase().indexOf(q) === 0) return 2;
    // Loose subsequence match, so "kbsh" finds "Keyboard shortcuts".
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
      ? PALETTE
          .map(function (it) { return { it: it, s: score(it, q) }; })
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

  if (cmdk) {
    cmdk.addEventListener('mousedown', function (e) {
      if (e.target === cmdk) closeCmdk();
    });
  }

  document.addEventListener('keydown', function (e) {
    var open = cmdk && cmdk.classList.contains('open');

    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      open ? closeCmdk() : openCmdk();
      return;
    }
    // "/" is the other conventional search key — but not while the visitor is
    // typing in a field.
    if (!open && e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      openCmdk();
      return;
    }
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
    } else if (e.key === 'Tab') {
      // Keep focus inside the dialog while it is modal.
      e.preventDefault();
      cmdkInput.focus();
    }
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

  /* ---------------------------------------------------- copy code blocks */

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
      var text = pre.innerText;
      var done = function () {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = 'Copy'; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { btn.textContent = 'Press Ctrl+C'; });
      } else {
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (err) { /* nothing sensible to do */ }
        document.body.removeChild(ta);
      }
    });
  });

  /* --------------------------------------------- latest release (enhancement)

     The download buttons already work without this. All this does is notice
     when a newer release exists than the one this page was built against, and
     retarget the buttons plus the version and size labels at it — so the site
     is never stale between deploys. Any failure is silent by design: a rate
     limit or an offline visitor must never break a working download link.   */

  function fmtSize(bytes) {
    return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' MB';
  }

  function applyRelease(release) {
    var assets = release.assets || [];
    var find = function (re) {
      for (var i = 0; i < assets.length; i++) {
        if (re.test(assets[i].name)) return assets[i];
      }
      return null;
    };
    var installer = find(/Setup.*\.exe$/i);
    var portable = find(/^(?!.*Setup).*\.exe$/i);
    var tag = (release.tag_name || '').replace(/^v/, '');
    if (!tag || !installer) return;

    // Only move forward. A cached or mis-ordered response must not downgrade
    // the page below the version it shipped with.
    var current = ($('[data-version]') || {}).textContent || '0';
    var cmp = function (a, b) {
      var pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
      for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
        var d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return d;
      }
      return 0;
    };
    if (cmp(tag, current.trim()) <= 0) return;

    $$('[data-version]').forEach(function (el) { el.textContent = tag; });
    $$('[data-dl="installer"]').forEach(function (a) {
      a.href = installer.browser_download_url;
    });
    if (portable) {
      $$('[data-dl="portable"]').forEach(function (a) {
        a.href = portable.browser_download_url;
      });
    }
    $$('[data-size]').forEach(function (el) { el.textContent = fmtSize(installer.size); });
    $$('[data-size-installer]').forEach(function (el) { el.textContent = fmtSize(installer.size); });
    if (portable) {
      $$('[data-size-portable]').forEach(function (el) { el.textContent = fmtSize(portable.size); });
    }
    // Filenames and checksums are version-specific; rather than show a stale
    // hash next to a newer file, point at the release page for verification.
    $$('[data-stale-on-update]').forEach(function (el) {
      el.innerHTML = 'See the <a href="' + release.html_url + '">' + tag +
        ' release notes</a> for this build’s filenames and checksums.';
    });
  }

  if (window.fetch) {
    fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' }
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) { if (json && !json.draft && !json.prerelease) applyRelease(json); })
      .catch(function () { /* keep the built-in links exactly as they are */ });
  }
})();
