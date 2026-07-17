// Themes & customization: named UI themes + accent colors, applied as CSS-variable overrides on
// :root plus a small non-CSS palette for the two canvas surfaces (three.js viewport, timeline
// dope sheet) that can't inherit CSS vars directly. Persisted in settings.json ({ theme, accent })
// and applied live — no restart, no per-element restyling.
import * as S from './state.js';

// Accent swatches. `dim`/`glow` are derived from the hex at apply-time, so a future custom
// accent (arbitrary hex) needs no extra data here.
export const ACCENTS = [
  { id: 'periwinkle', label: 'Periwinkle', hex: '#7c8cff' },
  { id: 'mint', label: 'Mint', hex: '#4fd6a0' },
  { id: 'amber', label: 'Amber', hex: '#f0b95c' },
  { id: 'rose', label: 'Rose', hex: '#f27a9b' },
  { id: 'cyan', label: 'Cyan', hex: '#54c8e8' },
  { id: 'violet', label: 'Violet', hex: '#a97cff' },
];
export const DEFAULT_ACCENT = ACCENTS[0].hex;

// Every theme sets the SAME full set of vars (no partial overrides) so switching between any two
// themes is always a clean swap with no leftovers from the previous one.
export const THEMES = {
  dark: {
    label: 'Cadence Dark',
    desc: 'the classic look',
    vars: {
      '--bg-0': '#0a0a0e', '--bg-1': '#101016', '--bg-2': '#16161e', '--bg-3': '#1c1c26', '--bg-4': '#23232f', '--bg-5': '#2b2b38',
      '--border': 'rgba(255,255,255,0.08)', '--border-soft': 'rgba(255,255,255,0.05)',
      '--text-0': '#f2f2f6', '--text-1': '#c9cbe0', '--text-2': '#9394a8', '--text-3': '#6b6c7d',
      '--tl-ruler-bg': '#14141b', '--tl-ruler-text': 'rgba(255,255,255,0.45)', '--tl-label-text': '#101016',
      '--tl-grid': 'rgba(255,255,255,0.05)', '--tl-stripe-item': 'rgba(255,255,255,0.045)',
      '--tl-stripe-alt': 'rgba(255,255,255,0.014)', '--tl-shade': 'rgba(255,255,255,0.025)',
    },
    viewport: { bg: '#101016', ground: '#16161e', grid1: '#2e2e3c', grid2: '#22222d' },
  },
  midnight: {
    label: 'Midnight',
    desc: 'deeper, near-black',
    vars: {
      '--bg-0': '#050508', '--bg-1': '#0a0a11', '--bg-2': '#0f0f18', '--bg-3': '#14141f', '--bg-4': '#1a1a28', '--bg-5': '#212132',
      '--border': 'rgba(255,255,255,0.07)', '--border-soft': 'rgba(255,255,255,0.04)',
      '--text-0': '#eeeef4', '--text-1': '#c3c5dc', '--text-2': '#8c8da2', '--text-3': '#636477',
      '--tl-ruler-bg': '#0b0b12', '--tl-ruler-text': 'rgba(255,255,255,0.42)', '--tl-label-text': '#0a0a11',
      '--tl-grid': 'rgba(255,255,255,0.045)', '--tl-stripe-item': 'rgba(255,255,255,0.04)',
      '--tl-stripe-alt': 'rgba(255,255,255,0.012)', '--tl-shade': 'rgba(255,255,255,0.022)',
    },
    viewport: { bg: '#0a0a11', ground: '#0e0e16', grid1: '#25252f', grid2: '#1b1b24' },
  },
  slate: {
    label: 'Slate',
    desc: 'cool blue-grey',
    vars: {
      '--bg-0': '#12151c', '--bg-1': '#171b24', '--bg-2': '#1d222d', '--bg-3': '#242a37', '--bg-4': '#2b3242', '--bg-5': '#343c4e',
      '--border': 'rgba(210,225,255,0.10)', '--border-soft': 'rgba(210,225,255,0.06)',
      '--text-0': '#f0f3f9', '--text-1': '#c8d0e2', '--text-2': '#949db4', '--text-3': '#6b7386',
      '--tl-ruler-bg': '#1a1f29', '--tl-ruler-text': 'rgba(255,255,255,0.45)', '--tl-label-text': '#171b24',
      '--tl-grid': 'rgba(210,225,255,0.06)', '--tl-stripe-item': 'rgba(210,225,255,0.05)',
      '--tl-stripe-alt': 'rgba(210,225,255,0.016)', '--tl-shade': 'rgba(210,225,255,0.03)',
    },
    viewport: { bg: '#171b24', ground: '#1d222d', grid1: '#39435a', grid2: '#2a3242' },
  },
  light: {
    label: 'Light',
    desc: 'bright & clean',
    vars: {
      '--bg-0': '#e9e9f0', '--bg-1': '#f4f4f8', '--bg-2': '#ececf2', '--bg-3': '#e1e1ea', '--bg-4': '#d5d5e1', '--bg-5': '#c8c8d6',
      '--border': 'rgba(20,20,40,0.14)', '--border-soft': 'rgba(20,20,40,0.08)',
      '--text-0': '#16161e', '--text-1': '#2b2b3a', '--text-2': '#565768', '--text-3': '#7f8093',
      '--tl-ruler-bg': '#dfdfe8', '--tl-ruler-text': 'rgba(0,0,0,0.5)', '--tl-label-text': '#f4f4f8',
      '--tl-grid': 'rgba(0,0,0,0.07)', '--tl-stripe-item': 'rgba(0,0,0,0.055)',
      '--tl-stripe-alt': 'rgba(0,0,0,0.02)', '--tl-shade': 'rgba(0,0,0,0.045)',
    },
    viewport: { bg: '#dcdce6', ground: '#cfcfdb', grid1: '#a8a8bc', grid2: '#bcbcca' },
  },
};
export const DEFAULT_THEME = 'dark';

const current = { theme: DEFAULT_THEME, accent: DEFAULT_ACCENT };

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function rgbToHex([r, g, b]) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function applyTheme(themeName, accentHex) {
  const theme = THEMES[themeName] || THEMES[DEFAULT_THEME];
  const accent = hexToRgb(accentHex) ? accentHex : DEFAULT_ACCENT;
  current.theme = THEMES[themeName] ? themeName : DEFAULT_THEME;
  current.accent = accent;

  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(theme.vars)) root.setProperty(k, v);
  const rgb = hexToRgb(accent);
  root.setProperty('--accent', accent);
  root.setProperty('--accent-dim', rgbToHex(rgb.map((c) => c * 0.64)));
  root.setProperty('--accent-glow', `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.35)`);

  S.emit('theme', { theme: current.theme, accent });
}

export function currentTheme() { return { ...current }; }

// The three.js scene can't read CSS vars — it pulls its palette from here (and re-pulls on the
// 'theme' event). Falls back to the dark palette when applyTheme was never called (e.g. the
// mobile companion page, which reuses viewport.js but has no theme UI).
export function viewportPalette() {
  return (THEMES[current.theme] || THEMES[DEFAULT_THEME]).viewport;
}
