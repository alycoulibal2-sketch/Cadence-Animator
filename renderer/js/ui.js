// Toasts, context menus, modals — the small smooth interactions.

// A mono-styled text block with a reliable one-click copy button (Electron's clipboard IPC,
// not navigator.clipboard — more consistent inside a packaged app) — use this anywhere a modal
// shows a path or command the user needs to paste elsewhere, instead of a bare .mono block.
export function copyableRow(text) {
  const row = document.createElement('div');
  row.className = 'mono-row';
  const mono = document.createElement('p');
  mono.className = 'mono';
  mono.textContent = text;
  const btn = document.createElement('button');
  btn.className = 'copy-btn';
  btn.title = 'Copy to clipboard';
  btn.textContent = '⧉';
  btn.addEventListener('click', async () => {
    await window.cadence.copyText(text);
    btn.textContent = '✓';
    btn.classList.add('copied');
    toast('Copied to clipboard', 'success', 1600);
    setTimeout(() => { btn.textContent = '⧉'; btn.classList.remove('copied'); }, 1200);
  });
  row.appendChild(mono);
  row.appendChild(btn);
  return row;
}

export function toast(message, kind = 'info', ms = 3200) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 260);
  }, ms);
  return el;
}

export function toastProgress(message) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast progress';
  el.innerHTML = `<span class="spinner"></span><span class="msg"></span>`;
  el.querySelector('.msg').textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  return {
    update(msg) { el.querySelector('.msg').textContent = msg; },
    done(msg, kind = 'success') {
      el.classList.remove('progress');
      el.classList.add(kind);
      el.innerHTML = '';
      el.textContent = msg;
      setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 260);
      }, 2800);
    },
  };
}

// ---------------------------------------------------------------- context menu
let openMenus = [];
export function closeMenus() {
  openMenus.forEach((m) => m.remove());
  openMenus = [];
}
window.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.ctx-menu')) closeMenus();
});

export function showContextMenu(x, y, items, depth = 0) {
  if (depth === 0) closeMenus();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  for (const it of items) {
    if (it.sep) {
      const s = document.createElement('div');
      s.className = 'sep';
      menu.appendChild(s);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'ctx-item' + (it.header ? ' header' : '') + (it.danger ? ' danger' : '') + (it.children ? ' has-sub' : '');
    row.innerHTML = `<span class="lbl"></span>${it.shortcut ? `<span class="sc">${it.shortcut}</span>` : ''}${it.children ? '<span class="arrow">›</span>' : ''}`;
    row.querySelector('.lbl').textContent = it.label;
    if (!it.header) {
      if (it.children) {
        let sub = null;
        row.addEventListener('pointerenter', () => {
          const r = row.getBoundingClientRect();
          sub = showContextMenu(r.right - 4, r.top - 4, it.children, depth + 1);
        });
        row.addEventListener('pointerleave', (e) => {
          if (sub && !sub.contains(e.relatedTarget)) { sub.remove(); openMenus = openMenus.filter((m) => m !== sub); }
        });
      } else if (it.run) {
        row.addEventListener('click', () => { closeMenus(); it.run(); });
      }
    }
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
  requestAnimationFrame(() => menu.classList.add('show'));
  openMenus.push(menu);
  return menu;
}

// ---------------------------------------------------------------- modal
export function modal({ title, body, actions = [], onClose }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const box = document.createElement('div');
  box.className = 'modal';
  const h = document.createElement('div');
  h.className = 'modal-title';
  h.textContent = title;
  box.appendChild(h);
  const content = document.createElement('div');
  content.className = 'modal-body';
  if (typeof body === 'string') content.innerHTML = body;
  else content.appendChild(body);
  box.appendChild(content);
  const foot = document.createElement('div');
  foot.className = 'modal-foot';
  const close = () => {
    back.classList.remove('show');
    setTimeout(() => back.remove(), 220);
    onClose?.();
  };
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = 'btn' + (a.primary ? ' primary' : '');
    b.textContent = a.label;
    b.addEventListener('click', async () => {
      const keep = await a.run?.(close);
      if (!keep) close();
    });
    foot.appendChild(b);
  }
  box.appendChild(foot);
  back.appendChild(box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add('show'));
  return { close, box };
}

export function promptModal({ title, label, placeholder = '', initial = '', okLabel = 'OK' }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<label class="fld-label"></label><input class="fld" type="text">`;
    wrap.querySelector('.fld-label').textContent = label;
    const input = wrap.querySelector('input');
    input.placeholder = placeholder;
    input.value = initial;
    let resolved = false;
    const m = modal({
      title,
      body: wrap,
      actions: [
        { label: 'Cancel', run: () => { } },
        { label: okLabel, primary: true, run: () => { resolved = true; resolve(input.value.trim()); } },
      ],
      onClose: () => { if (!resolved) resolve(null); },
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { resolved = true; resolve(input.value.trim()); m.close(); }
    });
    setTimeout(() => input.focus(), 60);
  });
}

export function chooseModal({ title, options, onDelete }) {
  // options: [{id, label, desc, icon}]. onDelete (optional): async (option) => boolean — return
  // true to remove that card from the list without closing the modal (the caller owns any
  // confirmation step; this just renders the trash affordance and reacts to the result).
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'choose-grid';
    let resolved = false;
    const m = modal({
      title,
      body: wrap,
      actions: [{ label: 'Cancel', run: () => { } }],
      onClose: () => { if (!resolved) resolve(null); },
    });
    for (const o of options) {
      const card = document.createElement('button');
      card.className = 'choose-card';
      card.innerHTML = `<span class="ic"></span><span class="t"></span><span class="d"></span>`;
      card.querySelector('.ic').textContent = o.icon || '●';
      card.querySelector('.t').textContent = o.label;
      card.querySelector('.d').textContent = o.desc || '';
      card.addEventListener('click', () => { resolved = true; resolve(o.id); m.close(); });
      if (onDelete && !o.noDelete) {
        const del = document.createElement('span');
        del.className = 'choose-card-delete';
        del.title = 'Delete';
        del.textContent = '🗑';
        del.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (await onDelete(o)) card.remove();
        });
        card.appendChild(del);
      }
      wrap.appendChild(card);
    }
  });
}
