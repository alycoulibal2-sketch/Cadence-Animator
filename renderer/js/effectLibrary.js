// Multi-layer effect presets: hand-tuned archetype documents plus theme (hue remap) and scale
// (size/rate multiplier) transforms applied POST-parse — one legible card per archetype instead
// of hundreds of near-duplicate matrix entries, with the same design space (see
// docs/vfx-studio.md "Presets (revised)"). State-free and pure like the rest of the effect core;
// the smoketest validates every archetype x theme x scale to zero errors.
import { parseEffect } from './effectModel.js';

// ---------------------------------------------------------------- transforms
function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}
function hslToHex({ h, s, l }) {
  const chan = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const to255 = (x) => Math.round(Math.max(0, Math.min(1, x)) * 255);
  const r = s === 0 ? l : chan(h + 1 / 3), g = s === 0 ? l : chan(h), b = s === 0 ? l : chan(h - 1 / 3);
  return `#${((to255(r) << 16) | (to255(g) << 8) | to255(b)).toString(16).padStart(6, '0')}`;
}

export const EFFECT_THEMES = [
  { key: 'classic', label: 'Classic' }, // archetype's own palette
  { key: 'ice', label: 'Ice', hue: 200 / 360, satMul: 0.85 },
  { key: 'ember', label: 'Ember', hue: 22 / 360, satMul: 1.05 },
  { key: 'toxic', label: 'Toxic', hue: 95 / 360, satMul: 1.0 },
  { key: 'arcane', label: 'Arcane', hue: 275 / 360, satMul: 1.0 },
  { key: 'holy', label: 'Holy', hue: 48 / 360, satMul: 0.55 },
];

export const EFFECT_SCALES = [
  { key: 'small', label: 'Small', factor: 0.6 },
  { key: 'standard', label: 'Standard', factor: 1 },
  { key: 'large', label: 'Large', factor: 1.6 },
];

const COLOR_PROPS = ['color', 'colorStart', 'colorEnd'];

// Rotate every color in the doc so the effect's dominant hue lands on the theme hue — keeps each
// layer's relative hue offsets (a fire's yellow core stays hotter than its red fringe after
// becoming an ice effect's white core / blue fringe).
export function applyThemeToDoc(doc, themeKey) {
  const theme = EFFECT_THEMES.find((t) => t.key === themeKey);
  if (!theme || theme.hue === undefined) return doc;
  let dominant = null;
  for (const layer of doc.layers) {
    for (const p of COLOR_PROPS) {
      const hsl = layer.props[p] ? hexToHsl(layer.props[p]) : null;
      if (hsl && hsl.s > 0.15 && !dominant) dominant = hsl.h;
    }
  }
  const shift = theme.hue - (dominant ?? 0);
  for (const layer of doc.layers) {
    for (const p of COLOR_PROPS) {
      const hsl = layer.props[p] ? hexToHsl(layer.props[p]) : null;
      if (!hsl) continue;
      if (hsl.s < 0.08) continue; // whites/greys stay neutral
      let h = (hsl.h + shift) % 1;
      if (h < 0) h += 1;
      layer.props[p] = hslToHex({ h, s: Math.min(1, hsl.s * (theme.satMul ?? 1)), l: hsl.l });
    }
  }
  return doc;
}

// Which props scale with physical size, per layer type (curve VALUES for these scale too — a
// keyed sizeStart must grow with the preset or the animation fights the transform).
const SCALE_PROPS = {
  emitter: ['sizeStart', 'sizeEnd', 'speed'],
  shape: ['scale', 'thickness'],
  light: ['range'],
  shake: ['amplitude'],
};
export function applyScaleToDoc(doc, factor) {
  if (!factor || factor === 1) return doc;
  const round3 = (v) => Math.round(v * 1000) / 1000;
  for (const layer of doc.layers) {
    for (const prop of SCALE_PROPS[layer.type] || []) {
      if (typeof layer.props[prop] === 'number') layer.props[prop] = round3(layer.props[prop] * factor);
      for (const k of layer.curves[prop] || []) {
        if (typeof k.v === 'number') k.v = round3(k.v * factor);
      }
    }
    if (layer.type === 'emitter') {
      const rateMul = 0.5 + factor * 0.5; // density grows sublinearly with size
      layer.props.rate = round3((layer.props.rate ?? 0) * rateMul);
      for (const k of layer.curves.rate || []) if (typeof k.v === 'number') k.v = round3(k.v * rateMul);
      layer.props.burst = Math.round((layer.props.burst || 0) * rateMul);
      layer.props.maxParticles = Math.max(1, Math.min(2000, Math.round((layer.props.maxParticles || 150) * rateMul)));
      if (Array.isArray(layer.props.offset)) layer.props.offset = layer.props.offset.map((v) => round3(v * factor));
      const es = layer.props.emissionShape;
      if (es) {
        for (const dim of ['radius', 'length', 'width', 'depth', 'height']) {
          if (typeof es[dim] === 'number') es[dim] = round3(es[dim] * factor);
        }
      }
    }
    if (Array.isArray(layer.props.offset) && layer.type !== 'emitter') {
      layer.props.offset = layer.props.offset.map((v) => round3(v * factor));
    }
  }
  return doc;
}

// ---------------------------------------------------------------- archetypes
// Compact authoring helper: L(type, name, clipStart, clipLen, props, {curves, modifiers, loop})
const L = (type, name, start, len, props, extra = {}) => ({
  type, name, enabled: true,
  clip: { start, len, loop: !!extra.loop },
  props,
  curves: extra.curves || {},
  modifiers: (extra.modifiers || []).map((m) => ({ type: m[0], enabled: true, props: m[1] || {} })),
});
const K = (t, v, es, ed) => (es ? { t, v, es, ed: ed || 'Out' } : { t, v });

// Each archetype: a complete, hand-tuned document. Layer stagger builds anticipation → impact →
// dissipation; curves put real easing on the money moment. Keep peak in-game density
// (Σ rate·lifetime + bursts) under ~700 so every theme/scale variant passes the perf validator.
export const EFFECT_ARCHETYPES = [
  {
    key: 'sword-slash', name: 'Sword Slash', category: 'Combat', icon: '⚔️',
    description: 'A fast glowing crescent with a spark trail',
    doc: {
      name: 'Sword Slash', fps: 30, duration: 24, loop: false,
      layers: [
        L('shape', 'Slash Arc', 0, 14, { shape: { kind: 'slash', radius: 2.6, angleDeg: 160, tiltDeg: 20 }, color: '#8fd0ff', opacity: 0, scale: 0.9, rotation: 0, thickness: 0.16, emissive: true, offset: [0, 0, 0] }, {
          curves: {
            opacity: [K(0, 0), K(2, 0.95, 'Quad', 'Out'), K(13, 0)],
            scale: [K(0, 0.55, 'Exponential', 'Out'), K(6, 1.05), K(13, 1.15)],
            thickness: [K(0, 0.2), K(13, 0.02, 'Quad', 'In')],
          },
        }),
        L('emitter', 'Edge Sparks', 1, 10, { rate: 0, burst: 26, lifetime: 0.45, speed: 5, spreadDegrees: 24, gravity: 4, shape: 'spark', motion: 'cone', blendMode: 'additive', colorStart: '#eaf6ff', colorEnd: '#3a78c2', sizeStart: 0.14, sizeEnd: 0.02, transparencyStart: 0, transparencyEnd: 1, maxParticles: 40, emissionShape: { kind: 'arc', radius: 2.4, angleDeg: 150 }, offset: [0, 0, 0] }),
        L('light', 'Flash Glow', 0, 10, { color: '#a8d8ff', intensity: 0, range: 14, offset: [0, 0.5, 0] }, {
          curves: { intensity: [K(0, 0), K(2, 2.2, 'Quad', 'Out'), K(9, 0)] },
        }),
      ],
    },
  },
  {
    key: 'explosion', name: 'Explosion', category: 'Combat', icon: '💥',
    description: 'Flash, debris, fireball, shockwave, lingering smoke',
    doc: {
      name: 'Explosion', fps: 30, duration: 75, loop: false,
      layers: [
        L('screen', 'Impact Flash', 0, 8, { kind: 'flash', color: '#ffe9c4', opacity: 0, density: 24 }, {
          curves: { opacity: [K(0, 0), K(1, 0.55, 'Quad', 'Out'), K(7, 0)] },
        }),
        L('shape', 'Shockwave Ring', 0, 16, { shape: { kind: 'circle', radius: 1 }, color: '#ffd9a0', opacity: 0, scale: 0.4, rotation: 0, thickness: 0.22, emissive: true, offset: [0, 0.15, 0] }, {
          curves: {
            opacity: [K(0, 0), K(1, 0.9), K(15, 0, 'Quad', 'Out')],
            scale: [K(0, 0.4, 'Exponential', 'Out'), K(15, 5.2)],
            thickness: [K(0, 0.3), K(15, 0.03)],
          },
        }),
        L('emitter', 'Fire Core', 0, 12, { rate: 40, burst: 30, lifetime: 0.55, speed: 3.2, spreadDegrees: 85, gravity: -1.5, shape: 'glow', motion: 'burst', blendMode: 'additive', colorStart: '#ffd36b', colorEnd: '#8a1a00', sizeStart: 0.85, sizeEnd: 0.2, transparencyStart: 0, transparencyEnd: 1, maxParticles: 80, emissionShape: null, offset: [0, 0.4, 0] }),
        L('emitter', 'Debris', 2, 8, { rate: 0, burst: 34, lifetime: 1.1, speed: 6.5, spreadDegrees: 90, gravity: 14, shape: 'square', motion: 'burst', blendMode: 'normal', colorStart: '#ff8a3d', colorEnd: '#2a1a0a', sizeStart: 0.18, sizeEnd: 0.05, transparencyStart: 0, transparencyEnd: 0.9, maxParticles: 44, emissionShape: null, offset: [0, 0.3, 0] }),
        L('emitter', 'Smoke Linger', 6, 40, { rate: 14, burst: 0, lifetime: 1.8, speed: 1, spreadDegrees: 45, gravity: -0.5, shape: 'smoke', motion: 'rise', blendMode: 'normal', colorStart: '#6a6a6a', colorEnd: '#2c2c2c', sizeStart: 0.7, sizeEnd: 1.9, transparencyStart: 0.25, transparencyEnd: 1, maxParticles: 60, emissionShape: { kind: 'circle', radius: 0.8 }, offset: [0, 0.3, 0] }, {
          curves: { rate: [K(0, 26), K(30, 0, 'Quad', 'In')] },
          modifiers: [['wind', { direction: [0.4, 0, 0.1], strength: 0.5 }]],
        }),
        L('light', 'Blast Light', 0, 14, { color: '#ffb45e', intensity: 0, range: 24, offset: [0, 1, 0] }, {
          curves: { intensity: [K(0, 0), K(1, 4, 'Quad', 'Out'), K(13, 0)] },
        }),
        L('shake', 'Impact Shake', 0, 12, { amplitude: 0, frequency: 11, roll: 0.7 }, {
          curves: { amplitude: [K(0, 0.55, 'Quad', 'Out'), K(11, 0)] },
        }),
        L('sound', 'Boom', 0, 30, { soundId: '', volume: 0.8, pitch: 1 }),
      ],
    },
  },
  {
    key: 'muzzle-flash', name: 'Muzzle Flash', category: 'Combat', icon: '🔫',
    description: 'A ten-frame gunshot pop with sparks and a light kick',
    doc: {
      name: 'Muzzle Flash', fps: 30, duration: 12, loop: false,
      layers: [
        L('emitter', 'Flash Cone', 0, 4, { rate: 0, burst: 14, lifetime: 0.14, speed: 7, spreadDegrees: 18, gravity: 0.5, shape: 'spark', motion: 'cone', blendMode: 'additive', colorStart: '#fff2b0', colorEnd: '#ff7a1a', sizeStart: 0.16, sizeEnd: 0.01, transparencyStart: 0, transparencyEnd: 1, maxParticles: 20, emissionShape: null, offset: [0, 0, 0] }),
        L('shape', 'Core Star', 0, 4, { shape: { kind: 'circle', radius: 0.28 }, color: '#ffe9a8', opacity: 0, scale: 1, rotation: 0, thickness: 0.12, emissive: true, offset: [0, 0, 0] }, {
          curves: { opacity: [K(0, 0.95), K(3, 0, 'Quad', 'In')], scale: [K(0, 0.7, 'Back', 'Out'), K(3, 1.2)] },
        }),
        L('light', 'Muzzle Light', 0, 5, { color: '#ffd98a', intensity: 0, range: 12, offset: [0, 0, 0] }, {
          curves: { intensity: [K(0, 3, 'Quad', 'Out'), K(4, 0)] },
        }),
      ],
    },
  },
  {
    key: 'ground-slam', name: 'Ground Slam', category: 'Combat', icon: '🪨',
    description: 'Expanding impact ring, dust plume, rock debris, camera thud',
    doc: {
      name: 'Ground Slam', fps: 30, duration: 50, loop: false,
      layers: [
        L('shape', 'Impact Ring', 0, 18, { shape: { kind: 'ring', radius: 1, width: 0.5 }, color: '#d9c9a8', opacity: 0, scale: 0.4, rotation: 0, thickness: 0.12, emissive: false, offset: [0, 0.08, 0] }, {
          curves: {
            opacity: [K(0, 0.85), K(17, 0, 'Quad', 'Out')],
            scale: [K(0, 0.4, 'Exponential', 'Out'), K(17, 4.4)],
          },
        }),
        L('emitter', 'Dust Plume', 0, 16, { rate: 30, burst: 22, lifetime: 1.2, speed: 2.4, spreadDegrees: 70, gravity: -0.4, shape: 'smoke', motion: 'burst', blendMode: 'normal', colorStart: '#b8a888', colorEnd: '#5a5245', sizeStart: 0.5, sizeEnd: 1.5, transparencyStart: 0.2, transparencyEnd: 1, maxParticles: 80, emissionShape: { kind: 'circle', radius: 1.2 }, offset: [0, 0.2, 0] }, {
          curves: { rate: [K(0, 44), K(14, 0, 'Quad', 'In')] },
        }),
        L('emitter', 'Rock Debris', 0, 6, { rate: 0, burst: 20, lifetime: 0.9, speed: 5.5, spreadDegrees: 55, gravity: 16, shape: 'square', motion: 'cone', blendMode: 'normal', colorStart: '#8a7a5e', colorEnd: '#4a4438', sizeStart: 0.16, sizeEnd: 0.08, transparencyStart: 0, transparencyEnd: 0.6, maxParticles: 26, emissionShape: { kind: 'circle', radius: 0.9 }, offset: [0, 0.2, 0] }),
        L('shake', 'Thud', 0, 14, { amplitude: 0, frequency: 8, roll: 0.4 }, {
          curves: { amplitude: [K(0, 0.7, 'Quad', 'Out'), K(13, 0)] },
        }),
      ],
    },
  },
  {
    key: 'hit-spark', name: 'Hit Spark', category: 'Combat', icon: '✨',
    description: 'A small, crisp melee impact — star pop and sparks',
    doc: {
      name: 'Hit Spark', fps: 30, duration: 16, loop: false,
      layers: [
        L('emitter', 'Spark Burst', 0, 4, { rate: 0, burst: 16, lifetime: 0.35, speed: 5.5, spreadDegrees: 90, gravity: 6, shape: 'star', motion: 'burst', blendMode: 'additive', colorStart: '#fff6c9', colorEnd: '#ff9a2a', sizeStart: 0.15, sizeEnd: 0.02, transparencyStart: 0, transparencyEnd: 1, maxParticles: 22, emissionShape: null, offset: [0, 0, 0] }),
        L('shape', 'Pop Ring', 0, 7, { shape: { kind: 'circle', radius: 0.5 }, color: '#ffe9a8', opacity: 0, scale: 0.3, rotation: 0, thickness: 0.09, emissive: true, offset: [0, 0, 0] }, {
          curves: { opacity: [K(0, 0.9), K(6, 0, 'Quad', 'Out')], scale: [K(0, 0.3, 'Exponential', 'Out'), K(6, 1.6)] },
        }),
        L('light', 'Spark Light', 0, 6, { color: '#ffdf9e', intensity: 0, range: 8, offset: [0, 0, 0] }, {
          curves: { intensity: [K(0, 1.8, 'Quad', 'Out'), K(5, 0)] },
        }),
      ],
    },
  },
  {
    key: 'fireball', name: 'Fireball', category: 'Magic', icon: '🔥',
    description: 'A roaring fire core with embers and a smoke tail',
    doc: {
      name: 'Fireball', fps: 30, duration: 60, loop: true,
      layers: [
        L('emitter', 'Fire Core', 0, 60, { rate: 55, burst: 0, lifetime: 0.5, speed: 1.8, spreadDegrees: 20, gravity: -1.2, shape: 'glow', motion: 'rise', blendMode: 'additive', colorStart: '#ffd36b', colorEnd: '#8a1400', sizeStart: 0.55, sizeEnd: 0.1, transparencyStart: 0, transparencyEnd: 1, maxParticles: 60, emissionShape: { kind: 'sphere', radius: 0.35 }, offset: [0, 0, 0] }, { loop: true, modifiers: [['noise', { amount: 0.12, frequency: 3 }]] }),
        L('emitter', 'Embers', 0, 60, { rate: 12, burst: 0, lifetime: 1.1, speed: 1.4, spreadDegrees: 40, gravity: -0.4, shape: 'spark', motion: 'rise', blendMode: 'additive', colorStart: '#ffb347', colorEnd: '#5a1600', sizeStart: 0.09, sizeEnd: 0.015, transparencyStart: 0, transparencyEnd: 1, maxParticles: 24, emissionShape: { kind: 'sphere', radius: 0.4 }, offset: [0, 0.2, 0] }, { loop: true }),
        L('emitter', 'Smoke Tail', 0, 60, { rate: 9, burst: 0, lifetime: 1.4, speed: 1, spreadDegrees: 30, gravity: -0.6, shape: 'smoke', motion: 'rise', blendMode: 'normal', colorStart: '#4a4a4a', colorEnd: '#222222', sizeStart: 0.4, sizeEnd: 1.1, transparencyStart: 0.4, transparencyEnd: 1, maxParticles: 20, emissionShape: null, offset: [0, 0.6, 0] }, { loop: true }),
        L('light', 'Fire Light', 0, 60, { color: '#ff9a3d', intensity: 1.8, range: 16, offset: [0, 0.4, 0] }, { loop: true, modifiers: [['flicker', { amount: 0.25 }]] }),
      ],
    },
  },
  {
    key: 'portal', name: 'Portal', category: 'Magic', icon: '🌀',
    description: 'A looping swirl of arcane particles around a glowing ring',
    doc: {
      name: 'Portal', fps: 30, duration: 90, loop: true,
      layers: [
        L('shape', 'Portal Ring', 0, 90, { shape: { kind: 'circle', radius: 1.8 }, color: '#b56bff', opacity: 0.85, scale: 1, rotation: 0, thickness: 0.14, emissive: true, offset: [0, 1.8, 0] }, {
          loop: true,
          curves: { rotation: [K(0, 0), K(89, 340, 'Linear')] },
          modifiers: [['pulse', { amount: 0.12, frequency: 0.8 }]],
        }),
        L('emitter', 'Swirl', 0, 90, { rate: 26, burst: 0, lifetime: 1.6, speed: 2.2, spreadDegrees: 40, gravity: 0, shape: 'glow', motion: 'orbit', blendMode: 'additive', colorStart: '#c9a3ff', colorEnd: '#3a1470', sizeStart: 0.16, sizeEnd: 0.03, transparencyStart: 0, transparencyEnd: 1, maxParticles: 70, emissionShape: { kind: 'circle', radius: 1.7 }, offset: [0, 1.8, 0] }, { loop: true }),
        L('emitter', 'Stray Sparkle', 0, 90, { rate: 7, burst: 0, lifetime: 2, speed: 0.4, spreadDegrees: 80, gravity: 0, shape: 'star', motion: 'ambient', blendMode: 'additive', colorStart: '#eadcff', colorEnd: '#8a5cd0', sizeStart: 0.08, sizeEnd: 0.01, transparencyStart: 0, transparencyEnd: 1, maxParticles: 20, emissionShape: { kind: 'circle', radius: 2.2 }, offset: [0, 1.8, 0] }, { loop: true }),
        L('light', 'Portal Glow', 0, 90, { color: '#a877ff', intensity: 1.6, range: 15, offset: [0, 1.8, 0] }, { loop: true, modifiers: [['pulse', { amount: 0.2, frequency: 0.8 }]] }),
      ],
    },
  },
  {
    key: 'heal-burst', name: 'Heal Burst', category: 'Magic', icon: '💚',
    description: 'Gentle rising stars and a soft expanding ring',
    doc: {
      name: 'Heal Burst', fps: 30, duration: 45, loop: false,
      layers: [
        L('shape', 'Bloom Ring', 0, 20, { shape: { kind: 'circle', radius: 1 }, color: '#a8ffc9', opacity: 0, scale: 0.5, rotation: 0, thickness: 0.1, emissive: true, offset: [0, 0.15, 0] }, {
          curves: { opacity: [K(0, 0), K(3, 0.8, 'Sine', 'Out'), K(19, 0)], scale: [K(0, 0.5, 'Sine', 'Out'), K(19, 2.6)] },
        }),
        L('emitter', 'Rising Stars', 0, 26, { rate: 22, burst: 8, lifetime: 1.3, speed: 1.6, spreadDegrees: 35, gravity: -0.3, shape: 'star', motion: 'rise', blendMode: 'additive', colorStart: '#c8ffd8', colorEnd: '#4ade80', sizeStart: 0.14, sizeEnd: 0.02, transparencyStart: 0, transparencyEnd: 1, maxParticles: 44, emissionShape: { kind: 'circle', radius: 1.1 }, offset: [0, 0.2, 0] }, {
          curves: { rate: [K(0, 30), K(24, 0, 'Quad', 'In')] },
        }),
        L('light', 'Soft Glow', 0, 30, { color: '#b9ffd1', intensity: 0, range: 12, offset: [0, 1, 0] }, {
          curves: { intensity: [K(0, 0), K(4, 1.6, 'Sine', 'Out'), K(29, 0)] },
        }),
      ],
    },
  },
  {
    key: 'lightning-strike', name: 'Lightning Strike', category: 'Magic', icon: '⚡',
    description: 'A jagged bolt that flickers in, sparks, and thunders out',
    doc: {
      name: 'Lightning Strike', fps: 30, duration: 30, loop: false,
      layers: [
        L('shape', 'Bolt', 0, 10, { shape: { kind: 'lightning', length: 7, jag: 0.9, segments: 11, seed: 3 }, color: '#eaf2ff', opacity: 0, scale: 1, rotation: 0, thickness: 0.09, emissive: true, offset: [0, 0, 0] }, {
          curves: { opacity: [K(0, 1, 'Constant'), K(2, 0.25, 'Constant'), K(3, 1, 'Constant'), K(5, 0.15, 'Constant'), K(6, 0.9, 'Constant'), K(9, 0)] },
        }),
        L('screen', 'Sky Flash', 0, 6, { kind: 'flash', color: '#dce8ff', opacity: 0, density: 24 }, {
          curves: { opacity: [K(0, 0.45, 'Quad', 'Out'), K(5, 0)] },
        }),
        L('emitter', 'Ground Sparks', 1, 6, { rate: 0, burst: 22, lifetime: 0.5, speed: 6, spreadDegrees: 80, gravity: 9, shape: 'spark', motion: 'burst', blendMode: 'additive', colorStart: '#eaf2ff', colorEnd: '#3a6ad0', sizeStart: 0.13, sizeEnd: 0.02, transparencyStart: 0, transparencyEnd: 1, maxParticles: 28, emissionShape: null, offset: [0, 0.1, 0] }),
        L('light', 'Strike Light', 0, 9, { color: '#cfe0ff', intensity: 0, range: 26, offset: [0, 3, 0] }, {
          curves: { intensity: [K(0, 5, 'Constant'), K(2, 1, 'Constant'), K(3, 4.4, 'Constant'), K(8, 0)] },
        }),
        L('shake', 'Thunder', 0, 10, { amplitude: 0, frequency: 13, roll: 0.5 }, {
          curves: { amplitude: [K(0, 0.4, 'Quad', 'Out'), K(9, 0)] },
        }),
      ],
    },
  },
  {
    key: 'arcane-aura', name: 'Arcane Aura', category: 'Magic', icon: '🔮',
    description: 'A looping idle aura — orbiting glyph sparks and drifting dust',
    doc: {
      name: 'Arcane Aura', fps: 30, duration: 90, loop: true,
      layers: [
        L('emitter', 'Orbiting Glyphs', 0, 90, { rate: 14, burst: 0, lifetime: 2.2, speed: 1.6, spreadDegrees: 30, gravity: 0, shape: 'star', motion: 'orbit', blendMode: 'additive', colorStart: '#c9a3ff', colorEnd: '#5a2ea6', sizeStart: 0.13, sizeEnd: 0.02, transparencyStart: 0, transparencyEnd: 1, maxParticles: 44, emissionShape: { kind: 'circle', radius: 1.1 }, offset: [0, 1, 0] }, { loop: true }),
        L('emitter', 'Drift Dust', 0, 90, { rate: 8, burst: 0, lifetime: 2.6, speed: 0.4, spreadDegrees: 80, gravity: -0.15, shape: 'glow', motion: 'ambient', blendMode: 'additive', colorStart: '#e8dcff', colorEnd: '#7a5cd0', sizeStart: 0.06, sizeEnd: 0.01, transparencyStart: 0.2, transparencyEnd: 1, maxParticles: 26, emissionShape: { kind: 'cylinder', radius: 1.3, height: 2 }, offset: [0, 0.2, 0] }, { loop: true }),
        L('light', 'Aura Glow', 0, 90, { color: '#9a6cf0', intensity: 1.1, range: 11, offset: [0, 1.2, 0] }, { loop: true, modifiers: [['pulse', { amount: 0.18, frequency: 0.5 }]] }),
      ],
    },
  },
  {
    key: 'campfire', name: 'Campfire', category: 'Elemental', icon: '🏕️',
    description: 'A cozy looping fire — flames, embers, smoke, flickering light',
    doc: {
      name: 'Campfire', fps: 30, duration: 90, loop: true,
      layers: [
        L('emitter', 'Flames', 0, 90, { rate: 42, burst: 0, lifetime: 0.7, speed: 1.6, spreadDegrees: 16, gravity: -0.6, shape: 'glow', motion: 'rise', blendMode: 'additive', colorStart: '#ffd36b', colorEnd: '#7a1400', sizeStart: 0.5, sizeEnd: 0.08, transparencyStart: 0, transparencyEnd: 1, maxParticles: 60, emissionShape: { kind: 'circle', radius: 0.5 }, offset: [0, 0.1, 0] }, { loop: true, modifiers: [['noise', { amount: 0.1, frequency: 2.5 }]] }),
        L('emitter', 'Embers', 0, 90, { rate: 8, burst: 0, lifetime: 1.8, speed: 1.1, spreadDegrees: 35, gravity: -0.15, shape: 'spark', motion: 'rise', blendMode: 'additive', colorStart: '#ffb347', colorEnd: '#3a0e00', sizeStart: 0.08, sizeEnd: 0.01, transparencyStart: 0, transparencyEnd: 1, maxParticles: 22, emissionShape: { kind: 'circle', radius: 0.4 }, offset: [0, 0.4, 0] }, { loop: true }),
        L('emitter', 'Smoke', 0, 90, { rate: 6, burst: 0, lifetime: 2.6, speed: 0.8, spreadDegrees: 25, gravity: -0.3, shape: 'smoke', motion: 'rise', blendMode: 'normal', colorStart: '#5a5a5a', colorEnd: '#26262a', sizeStart: 0.45, sizeEnd: 1.5, transparencyStart: 0.35, transparencyEnd: 1, maxParticles: 20, emissionShape: null, offset: [0, 0.9, 0] }, { loop: true, modifiers: [['wind', { direction: [0.3, 0, 0.1], strength: 0.3 }]] }),
        L('light', 'Fire Light', 0, 90, { color: '#ff9a3d', intensity: 1.7, range: 15, offset: [0, 0.6, 0] }, { loop: true, modifiers: [['flicker', { amount: 0.3 }]] }),
      ],
    },
  },
  {
    key: 'water-splash', name: 'Water Splash', category: 'Elemental', icon: '💧',
    description: 'A crisp droplet burst with mist and a surface ring',
    doc: {
      name: 'Water Splash', fps: 30, duration: 35, loop: false,
      layers: [
        L('emitter', 'Droplets', 0, 6, { rate: 0, burst: 34, lifetime: 0.7, speed: 4.2, spreadDegrees: 50, gravity: 12, shape: 'glow', motion: 'cone', blendMode: 'normal', colorStart: '#bfe9ff', colorEnd: '#4aa0d8', sizeStart: 0.14, sizeEnd: 0.03, transparencyStart: 0.05, transparencyEnd: 1, maxParticles: 40, emissionShape: { kind: 'circle', radius: 0.5 }, offset: [0, 0.1, 0] }),
        L('emitter', 'Mist', 0, 14, { rate: 18, burst: 6, lifetime: 1, speed: 0.9, spreadDegrees: 75, gravity: -0.2, shape: 'smoke', motion: 'burst', blendMode: 'normal', colorStart: '#dcf2ff', colorEnd: '#9cc8e8', sizeStart: 0.3, sizeEnd: 0.9, transparencyStart: 0.5, transparencyEnd: 1, maxParticles: 30, emissionShape: null, offset: [0, 0.2, 0] }, {
          curves: { rate: [K(0, 26), K(12, 0, 'Quad', 'In')] },
        }),
        L('shape', 'Surface Ring', 0, 14, { shape: { kind: 'circle', radius: 0.7 }, color: '#cfeaff', opacity: 0, scale: 0.5, rotation: 0, thickness: 0.07, emissive: false, offset: [0, 0.03, 0] }, {
          curves: { opacity: [K(0, 0.75), K(13, 0, 'Quad', 'Out')], scale: [K(0, 0.5, 'Sine', 'Out'), K(13, 2.4)] },
        }),
      ],
    },
  },
  {
    key: 'poison-cloud', name: 'Poison Cloud', category: 'Elemental', icon: '☠️',
    description: 'A slow, sickly looping fog that pulses',
    doc: {
      name: 'Poison Cloud', fps: 30, duration: 90, loop: true,
      layers: [
        L('emitter', 'Fog Body', 0, 90, { rate: 16, burst: 0, lifetime: 2.4, speed: 0.5, spreadDegrees: 85, gravity: -0.05, shape: 'smoke', motion: 'ambient', blendMode: 'normal', colorStart: '#8adf5c', colorEnd: '#25430f', sizeStart: 0.8, sizeEnd: 1.7, transparencyStart: 0.3, transparencyEnd: 1, maxParticles: 52, emissionShape: { kind: 'cylinder', radius: 1.6, height: 0.8 }, offset: [0, 0.4, 0] }, { loop: true, modifiers: [['pulse', { amount: 0.15, frequency: 0.4 }]] }),
        L('emitter', 'Bubbles', 0, 90, { rate: 6, burst: 0, lifetime: 1.4, speed: 0.7, spreadDegrees: 60, gravity: -0.5, shape: 'ring', motion: 'rise', blendMode: 'additive', colorStart: '#b8ff7a', colorEnd: '#3f7a1a', sizeStart: 0.09, sizeEnd: 0.16, transparencyStart: 0.2, transparencyEnd: 1, maxParticles: 14, emissionShape: { kind: 'circle', radius: 1.2 }, offset: [0, 0.2, 0] }, { loop: true }),
        L('light', 'Sick Glow', 0, 90, { color: '#7adf3c', intensity: 0.9, range: 10, offset: [0, 0.6, 0] }, { loop: true, modifiers: [['pulse', { amount: 0.25, frequency: 0.4 }]] }),
      ],
    },
  },
  {
    key: 'ice-burst', name: 'Ice Burst', category: 'Elemental', icon: '❄️',
    description: 'Shattering shards, frost ring, and a cold light pop',
    doc: {
      name: 'Ice Burst', fps: 30, duration: 35, loop: false,
      layers: [
        L('emitter', 'Shards', 0, 5, { rate: 0, burst: 28, lifetime: 0.8, speed: 5, spreadDegrees: 90, gravity: 9, shape: 'square', motion: 'burst', blendMode: 'normal', colorStart: '#d6f4ff', colorEnd: '#7ec8f0', sizeStart: 0.17, sizeEnd: 0.05, transparencyStart: 0.05, transparencyEnd: 0.9, maxParticles: 34, emissionShape: { kind: 'sphere', radius: 0.4 }, offset: [0, 0.4, 0] }),
        L('emitter', 'Frost Sparkle', 0, 12, { rate: 20, burst: 8, lifetime: 0.9, speed: 0.8, spreadDegrees: 80, gravity: 0.6, shape: 'star', motion: 'burst', blendMode: 'additive', colorStart: '#eaf8ff', colorEnd: '#9cd8f8', sizeStart: 0.1, sizeEnd: 0.01, transparencyStart: 0, transparencyEnd: 1, maxParticles: 30, emissionShape: null, offset: [0, 0.4, 0] }, {
          curves: { rate: [K(0, 28), K(10, 0, 'Quad', 'In')] },
        }),
        L('shape', 'Frost Ring', 0, 15, { shape: { kind: 'ring', radius: 0.9, width: 0.4 }, color: '#cfeeff', opacity: 0, scale: 0.4, rotation: 0, thickness: 0.09, emissive: true, offset: [0, 0.1, 0] }, {
          curves: { opacity: [K(0, 0.85), K(14, 0, 'Quad', 'Out')], scale: [K(0, 0.4, 'Exponential', 'Out'), K(14, 2.8)] },
        }),
        L('light', 'Cold Pop', 0, 10, { color: '#bfe6ff', intensity: 0, range: 14, offset: [0, 0.6, 0] }, {
          curves: { intensity: [K(0, 2.6, 'Quad', 'Out'), K(9, 0)] },
        }),
      ],
    },
  },
  {
    key: 'tornado', name: 'Tornado', category: 'Elemental', icon: '🌪️',
    description: 'A looping debris vortex with kicked-up dust',
    doc: {
      name: 'Tornado', fps: 30, duration: 90, loop: true,
      layers: [
        L('emitter', 'Vortex', 0, 90, { rate: 34, burst: 0, lifetime: 1.6, speed: 3.4, spreadDegrees: 55, gravity: -1.4, shape: 'smoke', motion: 'orbit', blendMode: 'normal', colorStart: '#b8ab90', colorEnd: '#57503f', sizeStart: 0.4, sizeEnd: 0.9, transparencyStart: 0.25, transparencyEnd: 1, maxParticles: 90, emissionShape: { kind: 'cone', radius: 1.6, height: 3.4 }, offset: [0, 0, 0] }, { loop: true }),
        L('emitter', 'Kicked Debris', 0, 90, { rate: 10, burst: 0, lifetime: 1, speed: 4.5, spreadDegrees: 70, gravity: 7, shape: 'leaf', motion: 'orbit', blendMode: 'normal', colorStart: '#8a7a5e', colorEnd: '#4a4438', sizeStart: 0.12, sizeEnd: 0.06, transparencyStart: 0, transparencyEnd: 0.8, maxParticles: 20, emissionShape: { kind: 'circle', radius: 1.4 }, offset: [0, 0.2, 0] }, { loop: true }),
        L('emitter', 'Ground Dust', 0, 90, { rate: 12, burst: 0, lifetime: 1.3, speed: 1.4, spreadDegrees: 85, gravity: -0.1, shape: 'smoke', motion: 'burst', blendMode: 'normal', colorStart: '#c8bda2', colorEnd: '#6a6252', sizeStart: 0.5, sizeEnd: 1.2, transparencyStart: 0.45, transparencyEnd: 1, maxParticles: 30, emissionShape: { kind: 'circle', radius: 1.8 }, offset: [0, 0.1, 0] }, { loop: true }),
      ],
    },
  },
  {
    key: 'rain', name: 'Rain', category: 'Ambience', icon: '🌧️',
    description: 'Looping rainfall over a wide area',
    doc: {
      name: 'Rain', fps: 30, duration: 60, loop: true,
      layers: [
        L('emitter', 'Rainfall', 0, 60, { rate: 90, burst: 0, lifetime: 0.8, speed: 9, spreadDegrees: 6, gravity: 10, shape: 'spark', motion: 'fall', blendMode: 'normal', colorStart: '#cfe8ff', colorEnd: '#8fb8dd', sizeStart: 0.09, sizeEnd: 0.07, transparencyStart: 0.25, transparencyEnd: 0.8, maxParticles: 130, emissionShape: { kind: 'rect', width: 9, depth: 9 }, offset: [0, 6, 0] }, { loop: true }),
        L('emitter', 'Ground Mist', 0, 60, { rate: 8, burst: 0, lifetime: 1.8, speed: 0.3, spreadDegrees: 85, gravity: 0, shape: 'smoke', motion: 'ambient', blendMode: 'normal', colorStart: '#b9d4e8', colorEnd: '#7a95ab', sizeStart: 0.7, sizeEnd: 1.4, transparencyStart: 0.65, transparencyEnd: 1, maxParticles: 18, emissionShape: { kind: 'rect', width: 8, depth: 8 }, offset: [0, 0.2, 0] }, { loop: true }),
      ],
    },
  },
  {
    key: 'snowfall', name: 'Snowfall', category: 'Ambience', icon: '🌨️',
    description: 'Gentle looping snow drifting down',
    doc: {
      name: 'Snowfall', fps: 30, duration: 90, loop: true,
      layers: [
        L('emitter', 'Snow', 0, 90, { rate: 26, burst: 0, lifetime: 4, speed: 0.6, spreadDegrees: 60, gravity: 0.4, shape: 'glow', motion: 'fall', blendMode: 'normal', colorStart: '#ffffff', colorEnd: '#dcecff', sizeStart: 0.09, sizeEnd: 0.08, transparencyStart: 0.1, transparencyEnd: 0.9, maxParticles: 140, emissionShape: { kind: 'rect', width: 10, depth: 10 }, offset: [0, 6, 0] }, { loop: true, modifiers: [['wind', { direction: [0.5, 0, 0.2], strength: 0.25 }]] }),
      ],
    },
  },
  {
    key: 'fireflies', name: 'Fireflies', category: 'Ambience', icon: '🪲',
    description: 'A calm night swarm of blinking glow dots',
    doc: {
      name: 'Fireflies', fps: 30, duration: 90, loop: true,
      layers: [
        L('emitter', 'Swarm', 0, 90, { rate: 7, burst: 0, lifetime: 3.5, speed: 0.35, spreadDegrees: 85, gravity: 0, shape: 'glow', motion: 'ambient', blendMode: 'additive', colorStart: '#e6ff9c', colorEnd: '#9ccc3a', sizeStart: 0.06, sizeEnd: 0.04, transparencyStart: 0.1, transparencyEnd: 1, maxParticles: 34, emissionShape: { kind: 'cylinder', radius: 2.6, height: 1.6 }, offset: [0, 0.6, 0] }, { loop: true, modifiers: [['flicker', { amount: 0.55 }]] }),
      ],
    },
  },
  {
    key: 'confetti-burst', name: 'Confetti Burst', category: 'Celebration', icon: '🎉',
    description: 'A party-popper cone of tumbling paper squares',
    doc: {
      name: 'Confetti Burst', fps: 30, duration: 55, loop: false,
      layers: [
        L('emitter', 'Confetti', 0, 6, { rate: 0, burst: 44, lifetime: 1.7, speed: 5.5, spreadDegrees: 35, gravity: 5, shape: 'square', motion: 'cone', blendMode: 'normal', colorStart: '#ff5c8a', colorEnd: '#ffd23f', sizeStart: 0.13, sizeEnd: 0.11, transparencyStart: 0, transparencyEnd: 0.4, maxParticles: 50, emissionShape: null, offset: [0, 0, 0] }, { modifiers: [['noise', { amount: 0.25, frequency: 2 }], ['gradientShift', { degrees: 300 }]] }),
        L('emitter', 'Sparkle Accent', 0, 8, { rate: 14, burst: 6, lifetime: 0.8, speed: 3, spreadDegrees: 40, gravity: 1.5, shape: 'star', motion: 'cone', blendMode: 'additive', colorStart: '#fff6c9', colorEnd: '#ffb347', sizeStart: 0.1, sizeEnd: 0.01, transparencyStart: 0, transparencyEnd: 1, maxParticles: 20, emissionShape: null, offset: [0, 0, 0] }),
      ],
    },
  },
  {
    key: 'level-up', name: 'Level Up', category: 'Celebration', icon: '🏆',
    description: 'A golden fountain of stars with a rising ring',
    doc: {
      name: 'Level Up', fps: 30, duration: 50, loop: false,
      layers: [
        L('shape', 'Rising Ring', 0, 26, { shape: { kind: 'circle', radius: 1.2 }, color: '#ffdf7a', opacity: 0, scale: 1, rotation: 0, thickness: 0.09, emissive: true, offset: [0, 0, 0] }, {
          curves: { opacity: [K(0, 0), K(3, 0.9, 'Sine', 'Out'), K(25, 0)], scale: [K(0, 1), K(25, 0.55, 'Sine', 'InOut')] },
        }),
        L('emitter', 'Star Fountain', 0, 22, { rate: 34, burst: 10, lifetime: 1.1, speed: 3.4, spreadDegrees: 22, gravity: 3.5, shape: 'star', motion: 'cone', blendMode: 'additive', colorStart: '#fff2b0', colorEnd: '#e09a1a', sizeStart: 0.15, sizeEnd: 0.02, transparencyStart: 0, transparencyEnd: 1, maxParticles: 56, emissionShape: { kind: 'circle', radius: 0.5 }, offset: [0, 0.1, 0] }, {
          curves: { rate: [K(0, 40), K(20, 0, 'Quad', 'In')] },
        }),
        L('light', 'Golden Glow', 0, 30, { color: '#ffd98a', intensity: 0, range: 14, offset: [0, 1.2, 0] }, {
          curves: { intensity: [K(0, 0), K(4, 2.4, 'Sine', 'Out'), K(29, 0)] },
        }),
        L('screen', 'Triumph Flash', 0, 7, { kind: 'flash', color: '#fff3d0', opacity: 0, density: 24 }, {
          curves: { opacity: [K(0, 0), K(2, 0.35, 'Sine', 'Out'), K(6, 0)] },
        }),
      ],
    },
  },
  {
    key: 'energy-shield', name: 'Energy Shield', category: 'Sci-fi', icon: '🛡️',
    description: 'A looping shimmering dome with a pulsing rim',
    doc: {
      name: 'Energy Shield', fps: 30, duration: 90, loop: true,
      layers: [
        L('emitter', 'Dome Shimmer', 0, 90, { rate: 24, burst: 0, lifetime: 1.4, speed: 0.2, spreadDegrees: 80, gravity: 0, shape: 'glow', motion: 'ambient', blendMode: 'additive', colorStart: '#7ad9ff', colorEnd: '#1a4d7a', sizeStart: 0.12, sizeEnd: 0.02, transparencyStart: 0.15, transparencyEnd: 1, maxParticles: 56, emissionShape: { kind: 'sphere', radius: 2.2 }, offset: [0, 1.2, 0] }, { loop: true }),
        L('shape', 'Rim Ring', 0, 90, { shape: { kind: 'circle', radius: 2.2 }, color: '#8fe0ff', opacity: 0.7, scale: 1, rotation: 0, thickness: 0.08, emissive: true, offset: [0, 0.1, 0] }, { loop: true, modifiers: [['pulse', { amount: 0.2, frequency: 1.2 }]] }),
        L('light', 'Shield Glow', 0, 90, { color: '#5ec8ff', intensity: 1.2, range: 13, offset: [0, 1.2, 0] }, { loop: true, modifiers: [['pulse', { amount: 0.15, frequency: 1.2 }]] }),
      ],
    },
  },
  {
    key: 'teleport', name: 'Teleport', category: 'Sci-fi', icon: '🌌',
    description: 'A vertical beam, imploding sparks, and a departure flash',
    doc: {
      name: 'Teleport', fps: 30, duration: 30, loop: false,
      layers: [
        L('shape', 'Beam', 0, 16, { shape: { kind: 'line', length: 5 }, color: '#9adcff', opacity: 0, scale: 1, rotation: 90, thickness: 0.2, emissive: true, offset: [0, 2.5, 0] }, {
          curves: { opacity: [K(0, 0), K(3, 0.95, 'Quad', 'Out'), K(15, 0)], thickness: [K(0, 0.34), K(15, 0.03, 'Quad', 'In')] },
        }),
        L('emitter', 'Implode Sparks', 0, 12, { rate: 30, burst: 12, lifetime: 0.6, speed: 2.4, spreadDegrees: 60, gravity: -2, shape: 'spark', motion: 'orbit', blendMode: 'additive', colorStart: '#c9ecff', colorEnd: '#3a78c2', sizeStart: 0.12, sizeEnd: 0.01, transparencyStart: 0, transparencyEnd: 1, maxParticles: 40, emissionShape: { kind: 'cylinder', radius: 1, height: 4 }, offset: [0, 0.2, 0] }, {
          curves: { rate: [K(0, 40), K(10, 0, 'Quad', 'In')] },
        }),
        L('screen', 'Departure Flash', 8, 7, { kind: 'flash', color: '#cfeaff', opacity: 0, density: 24 }, {
          curves: { opacity: [K(0, 0), K(2, 0.5, 'Quad', 'Out'), K(6, 0)] },
        }),
        L('light', 'Beam Light', 0, 16, { color: '#9adcff', intensity: 0, range: 16, offset: [0, 2, 0] }, {
          curves: { intensity: [K(0, 0), K(3, 3, 'Quad', 'Out'), K(15, 0)] },
        }),
      ],
    },
  },
  {
    key: 'black-hole', name: 'Black Hole', category: 'Sci-fi', icon: '🕳️',
    description: 'A looping dark core with in-spiraling violet dust',
    doc: {
      name: 'Black Hole', fps: 30, duration: 90, loop: true,
      layers: [
        L('shape', 'Event Horizon', 0, 90, { shape: { kind: 'sphere', radius: 0.7 }, color: '#0a0114', opacity: 0.95, scale: 1, rotation: 0, thickness: 0.3, emissive: false, offset: [0, 1.5, 0] }, { loop: true }),
        L('shape', 'Accretion Ring', 0, 90, { shape: { kind: 'circle', radius: 1.2 }, color: '#b56bff', opacity: 0.85, scale: 1, rotation: 0, thickness: 0.07, emissive: true, offset: [0, 1.5, 0] }, {
          loop: true,
          curves: { rotation: [K(0, 0), K(89, -400, 'Linear')] },
        }),
        L('emitter', 'Infalling Dust', 0, 90, { rate: 30, burst: 0, lifetime: 1.5, speed: -2.6, spreadDegrees: 85, gravity: 0, shape: 'glow', motion: 'orbit', blendMode: 'additive', colorStart: '#c9a3ff', colorEnd: '#2a0f4d', sizeStart: 0.1, sizeEnd: 0.01, transparencyStart: 0.1, transparencyEnd: 1, maxParticles: 60, emissionShape: { kind: 'sphere', radius: 2.4 }, offset: [0, 1.5, 0] }, { loop: true }),
        L('light', 'Rim Light', 0, 90, { color: '#8a4cd8', intensity: 1.3, range: 12, offset: [0, 1.5, 0] }, { loop: true, modifiers: [['pulse', { amount: 0.2, frequency: 0.6 }]] }),
      ],
    },
  },
  {
    key: 'speed-dash', name: 'Speed Dash', category: 'Sci-fi', icon: '💨',
    description: 'Anime speed lines, a streak trail, and a jolt of shake',
    doc: {
      name: 'Speed Dash', fps: 30, duration: 20, loop: false,
      layers: [
        L('screen', 'Speed Lines', 0, 14, { kind: 'speedlines', color: '#ffffff', opacity: 0, density: 36 }, {
          curves: { opacity: [K(0, 0), K(2, 0.7, 'Quad', 'Out'), K(13, 0)] },
        }),
        L('emitter', 'Streaks', 0, 10, { rate: 50, burst: 10, lifetime: 0.4, speed: -7, spreadDegrees: 10, gravity: 0, shape: 'spark', motion: 'cone', blendMode: 'additive', colorStart: '#eaf6ff', colorEnd: '#6aa8e8', sizeStart: 0.22, sizeEnd: 0.02, transparencyStart: 0.1, transparencyEnd: 1, maxParticles: 40, emissionShape: { kind: 'circle', radius: 0.7 }, offset: [0, 1, 0] }, {
          curves: { rate: [K(0, 60), K(9, 0, 'Quad', 'In')] },
        }),
        L('shake', 'Dash Jolt', 0, 8, { amplitude: 0, frequency: 15, roll: 0.3 }, {
          curves: { amplitude: [K(0, 0.35, 'Quad', 'Out'), K(7, 0)] },
        }),
      ],
    },
  },
  {
    key: 'sparkle-trail', name: 'Sparkle Trail', category: 'Sci-fi', icon: '🌠',
    description: 'A gentle looping star-drip for weapons and pets',
    doc: {
      name: 'Sparkle Trail', fps: 30, duration: 60, loop: true,
      layers: [
        L('emitter', 'Star Drip', 0, 60, { rate: 18, burst: 0, lifetime: 0.9, speed: 0.7, spreadDegrees: 25, gravity: 1.2, shape: 'star', motion: 'fall', blendMode: 'additive', colorStart: '#fff6c9', colorEnd: '#c98ae8', sizeStart: 0.11, sizeEnd: 0.01, transparencyStart: 0, transparencyEnd: 1, maxParticles: 26, emissionShape: null, offset: [0, 0, 0] }, { loop: true, modifiers: [['gradientShift', { degrees: 160 }]] }),
        L('emitter', 'Dust Haze', 0, 60, { rate: 6, burst: 0, lifetime: 1.4, speed: 0.2, spreadDegrees: 80, gravity: 0, shape: 'glow', motion: 'ambient', blendMode: 'additive', colorStart: '#ffe9f6', colorEnd: '#a877ff', sizeStart: 0.05, sizeEnd: 0.01, transparencyStart: 0.3, transparencyEnd: 1, maxParticles: 12, emissionShape: null, offset: [0, 0, 0] }, { loop: true }),
      ],
    },
  },
];

export const EFFECT_CATEGORIES = ['All', ...new Set(EFFECT_ARCHETYPES.map((a) => a.category))];

// Build a fresh document for an archetype (new ids every call), optionally themed and scaled.
// Returns null for an unknown key. Never returns a doc that failed to parse — archetype data is
// validated by the smoketest, so a parse failure here is a bug, not a user-input case.
export function buildArchetypeDoc(key, { theme = 'classic', scale = 1 } = {}) {
  const arch = EFFECT_ARCHETYPES.find((a) => a.key === key);
  if (!arch) return null;
  const parsed = parseEffect(structuredClone(arch.doc));
  if (!parsed.ok) throw new Error(`archetype "${key}" failed to parse: ${parsed.error}`);
  applyThemeToDoc(parsed.doc, theme);
  applyScaleToDoc(parsed.doc, typeof scale === 'number' ? scale : (EFFECT_SCALES.find((s) => s.key === scale)?.factor ?? 1));
  const themeMeta = EFFECT_THEMES.find((t) => t.key === theme);
  if (themeMeta && theme !== 'classic') parsed.doc.name = `${themeMeta.label} ${arch.name}`;
  return parsed.doc;
}

export function searchEffectArchetypes(query, category) {
  const q = (query || '').trim().toLowerCase();
  return EFFECT_ARCHETYPES.filter((a) =>
    (!category || category === 'All' || a.category === category) &&
    (!q || a.name.toLowerCase().includes(q) || a.category.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)));
}
