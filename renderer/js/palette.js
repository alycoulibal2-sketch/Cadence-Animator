// Command palette (Ctrl+K): every action in the app is findable here,
// so you never have to hunt through menus to learn "how do I…".

const commands = [];
let palOpen = false;

export function registerCommand(cmd) {
  // { id, title, hint?, shortcut?, run, section? }
  commands.push(cmd);
}

export function getCommands() { return commands; }

function score(query, text) {
  // simple subsequence fuzzy scoring
  query = query.toLowerCase();
  text = text.toLowerCase();
  if (!query) return 1;
  let qi = 0, s = 0, streak = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) {
      qi++;
      streak++;
      s += 2 + streak;
      if (i === 0 || text[i - 1] === ' ') s += 6;
    } else streak = 0;
  }
  return qi === query.length ? s : -1;
}

export function initPalette() {
  const back = document.getElementById('paletteBack');
  const input = document.getElementById('paletteInput');
  const list = document.getElementById('paletteList');
  let results = [];
  let active = 0;

  function render() {
    list.innerHTML = '';
    results.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'pal-row' + (i === active ? ' active' : '');
      row.innerHTML = `<span class="t"></span><span class="hint"></span>${c.shortcut ? `<span class="sc">${c.shortcut}</span>` : ''}`;
      row.querySelector('.t').textContent = c.title;
      row.querySelector('.hint').textContent = c.hint || '';
      row.addEventListener('click', () => { hide(); c.run(); });
      row.addEventListener('pointermove', () => { active = i; render(); });
      list.appendChild(row);
    });
    if (!results.length) {
      list.innerHTML = '<div class="pal-empty">No matching command</div>';
    }
  }

  function refresh() {
    const q = input.value.trim();
    results = commands
      .map((c) => ({ c, s: score(q, c.title + ' ' + (c.hint || '')) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((r) => r.c);
    active = 0;
    render();
  }

  function show() {
    palOpen = true;
    back.classList.add('show');
    input.value = '';
    refresh();
    setTimeout(() => input.focus(), 30);
  }
  function hide() {
    palOpen = false;
    back.classList.remove('show');
  }

  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(results.length - 1, active + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { const c = results[active]; if (c) { hide(); c.run(); } }
    else if (e.key === 'Escape') hide();
  });
  back.addEventListener('pointerdown', (e) => { if (e.target === back) hide(); });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (palOpen) hide(); else show();
    }
  });

  return { show, hide };
}

// Shortcuts overlay ("?")
export function showShortcuts() {
  const back = document.getElementById('shortcutsBack');
  const grid = document.getElementById('shortcutsGrid');
  grid.innerHTML = '';
  const bySection = new Map();
  for (const c of commands) {
    if (!c.shortcut) continue;
    const sec = c.section || 'General';
    if (!bySection.has(sec)) bySection.set(sec, []);
    bySection.get(sec).push(c);
  }
  for (const [sec, cmds] of bySection) {
    const col = document.createElement('div');
    col.className = 'sc-col';
    col.innerHTML = `<div class="sc-head">${sec}</div>`;
    for (const c of cmds) {
      const row = document.createElement('div');
      row.className = 'sc-row';
      row.innerHTML = `<span class="k">${c.shortcut}</span><span class="v"></span>`;
      row.querySelector('.v').textContent = c.title;
      col.appendChild(row);
    }
    grid.appendChild(col);
  }
  back.classList.add('show');
}
export function hideShortcuts() {
  document.getElementById('shortcutsBack').classList.remove('show');
}

document.getElementById('shortcutsBack').addEventListener('pointerdown', (e) => {
  if (e.target === e.currentTarget) hideShortcuts();
});
