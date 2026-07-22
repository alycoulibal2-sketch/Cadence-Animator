// Line-icon system: replaces the emoji glyphs the UI used to render icons with. Every icon is
// stroke-based on a 24x24 grid so one shared stroke-width/currentColor rule styles all of them
// uniformly, and they inherit color/size from CSS instead of depending on the OS emoji font
// rendering differently across machines. No icon font, no external asset — CSP here has no
// font-src beyond 'self'/data: and pulling in a dependency for ~35 glyphs isn't worth it.
//
// ALIAS lets every existing call site that still passes a raw emoji character (there are ~30
// scattered through app.js's chooseModal option lists) keep working unchanged — iconSvg()/resolve()
// map the old glyph to its replacement, so only the actual rendering choke points (chooseModal,
// item rows, the transport bar, etc.) needed to change, not every call site that picks an icon.

const PATHS = {
  // shapes / status
  dot: '<circle cx="12" cy="12" r="5"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  check: '<polyline points="4 12 9 17 20 6"/>',
  close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  copy: '<rect x="4" y="4" width="12" height="12" rx="1.5"/><path d="M8 20h10a1 1 0 0 0 1-1V9"/>',
  caret: '<polyline points="6 9 12 15 18 9"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/><line x1="3" y1="3" x2="21" y2="21"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 13.5"/>',
  gear: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="3" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="21"/><line x1="3" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="21" y2="12"/><line x1="5.6" y1="5.6" x2="7.8" y2="7.8"/><line x1="16.2" y1="16.2" x2="18.4" y2="18.4"/><line x1="5.6" y1="18.4" x2="7.8" y2="16.2"/><line x1="16.2" y1="7.8" x2="18.4" y2="5.6"/>',
  link: '<circle cx="7" cy="17" r="3"/><circle cx="17" cy="7" r="3"/><line x1="9.1" y1="14.9" x2="14.9" y2="9.1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  file: '<path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4"/>',
  film: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="7" y1="5" x2="7" y2="19"/><line x1="17" y1="5" x2="17" y2="19"/><line x1="2" y1="10" x2="7" y2="10"/><line x1="2" y1="14" x2="7" y2="14"/><line x1="17" y1="10" x2="22" y2="10"/><line x1="17" y1="14" x2="22" y2="14"/>',
  box: '<path d="M3 8l9-5 9 5-9 5-9-5z"/><path d="M3 8v9l9 5 9-5V8"/><line x1="12" y1="13" x2="12" y2="22"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>',
  rocket: '<path d="M12 2c3 2 4 6 4 10l-4 4-4-4c0-4 1-8 4-10z"/><circle cx="12" cy="10" r="1.5"/><path d="M8 14l-2 4M16 14l2 4"/>',

  // people / item kinds
  person: '<circle cx="12" cy="7" r="3.2"/><path d="M5 21c0-4.4 3.1-7 7-7s7 2.6 7 7"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l1.6-2.5h4.8L16 7"/><circle cx="12" cy="13.5" r="3.4"/>',
  sparkle: '<path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3z"/>',
  burst: '<path d="M12 2v6M12 16v6M2 12h6M16 12h6M4.9 4.9l4.2 4.2M14.9 14.9l4.2 4.2M19.1 4.9l-4.2 4.2M9.1 14.9l-4.2 4.2"/>',

  // titlebar actions
  import: '<polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/><path d="M4 19h16"/>',
  export: '<polyline points="7 8 12 3 17 8"/><line x1="12" y1="3" x2="12" y2="15"/><path d="M4 19h16"/>',
  wand: '<line x1="4" y1="20" x2="14" y2="10"/><path d="M17.5 3.5l.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9.9-1.9z"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><line x1="11" y1="18.5" x2="13" y2="18.5"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10" x2="6" y2="10"/><line x1="10" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="14" y2="10"/><line x1="18" y1="10" x2="18" y2="10"/><line x1="6" y1="14" x2="14" y2="14"/><line x1="18" y1="14" x2="18" y2="14"/>',

  // viewport tools
  move: '<polyline points="18 8 22 12 18 16"/><polyline points="6 8 2 12 6 16"/><polyline points="8 18 12 22 16 18"/><polyline points="8 6 12 2 16 6"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>',
  rotate: '<path d="M12 4a8 8 0 1 1-8 8"/><polyline points="2 9 4 12 7 10"/>',
  trackball: '<circle cx="12" cy="12" r="7"/><ellipse cx="12" cy="12" rx="7" ry="2.6"/>',
  ik: '<rect x="3" y="8" width="8" height="8" rx="4"/><rect x="13" y="8" width="8" height="8" rx="4"/>',
  scale: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
  fit: '<polyline points="4 9 4 4 9 4"/><polyline points="20 9 20 4 15 4"/><polyline points="4 15 4 20 9 20"/><polyline points="20 15 20 20 15 20"/>',

  // transport
  'step-back': '<polygon points="15 5 15 19 6 12"/><line x1="4" y1="5" x2="4" y2="19"/>',
  'step-fwd': '<polygon points="9 5 9 19 18 12"/><line x1="20" y1="5" x2="20" y2="19"/>',
  play: '<polygon points="7 4 20 12 7 20"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  key: '<rect x="7" y="7" width="10" height="10" rx="1.5" transform="rotate(45 12 12)"/>',
  curves: '<path d="M3 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0"/>',

  // VFX Studio window
  save: '<path d="M5 3h11l3 3v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v6h8V3"/><path d="M7 21v-7h10v7"/>',
  star: '<path d="M12 2l2.9 6.2 6.6.8-4.9 4.6 1.3 6.6L12 17l-5.9 3.2 1.3-6.6-4.9-4.6 6.6-.8L12 2z"/>',
  send: '<line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/>',
};

// Old emoji glyph -> canonical icon name. Anything not listed (or not in PATHS) falls back to `dot`
// rather than rendering blank — a typo'd icon name should never produce an invisible button.
const ALIAS = {
  '🧍': 'person', '👤': 'person', '🎥': 'camera', '✨': 'sparkle', '🎇': 'burst',
  '🔗': 'link', '🌐': 'globe', '📄': 'file', '🔊': 'speaker', '📋': 'copy',
  '🚀': 'rocket', '📦': 'box', '🎞': 'film', '🕘': 'clock', '🗑': 'trash',
  '✕': 'close', '＋': 'plus', '👁': 'eye', '·': 'eye-off', '●': 'dot', '⚙': 'gear',
  '⧉': 'copy', '✓': 'check',
};

const FILLED = new Set(['play', 'pause', 'stop', 'key', 'dot', 'more']);

function resolve(name) {
  if (PATHS[name]) return name;
  if (ALIAS[name]) return ALIAS[name];
  return 'dot';
}

export function iconSvg(name, { size = 16, strokeWidth = 1.75 } = {}) {
  const key = resolve(name);
  const filled = FILLED.has(key);
  const fill = filled ? 'currentColor' : 'none';
  const stroke = filled ? 'none' : 'currentColor';
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${PATHS[key]}</svg>`;
}

// Swaps an element's content for a new icon and pops it in — for toggle buttons (play/pause,
// visibility) that used to just overwrite textContent with a new glyph. Reuses the same `.icon-pop`
// keyframe every such toggle should use, so adding a new one later doesn't mean inventing a new
// animation too.
export function swapIcon(el, name, opts) {
  el.innerHTML = iconSvg(name, opts);
  el.firstElementChild?.classList.add('icon-pop');
}

const ITEM_KIND_ICON = { camera: 'camera', vfx: 'sparkle', effect: 'burst' };
export function itemIcon(kind) { return ITEM_KIND_ICON[kind] || 'person'; }
export function itemIconSvg(kind, opts) { return iconSvg(itemIcon(kind), opts); }

// Boot-time pass over the static HTML: every element tagged `data-icon="name"` gets that icon
// inserted as its first child. index.html can't import this module directly (it's plain markup,
// and the CSP's script-src has no 'unsafe-inline' for a bootstrapping <script> block), so this is
// the one place static chrome (titlebar, viewport tool chips, transport) and JS-rendered content
// (item rows, menus) both resolve through the same PATHS table instead of two copies drifting apart.
export function applyStaticIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const name = el.getAttribute('data-icon');
    const size = parseInt(el.getAttribute('data-icon-size') || '16', 10);
    el.insertAdjacentHTML('afterbegin', iconSvg(name, { size }));
  });
}
