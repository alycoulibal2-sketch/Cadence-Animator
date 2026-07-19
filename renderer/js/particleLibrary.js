// Procedural particle preset library. Hand-authoring hundreds of individually distinct particle
// presets isn't a realistic amount of work to keep consistent — instead this defines ~22 real base
// "materials" (a shape + motion + blend-mode + physical-feel archetype: fire, smoke, rain, magic
// energy, blood, confetti, etc.) and multiplies each by 6 color themes x 3 intensity scales, giving
// ~400 presets that are all meaningfully different (not just palette-swapped clones of one particle)
// while staying small and easy to extend — add one MATERIALS entry and it fans out into 18 presets
// for free. Consumed by both the inline timeline VFX item Inspector and the standalone VFX Studio
// window; SHAPES/MOTIONS here are just the vocabulary — the actual texture generation lives in
// rigbuild.js (getParticleTexture) and the actual position math lives in vfx.js (sampleParticles),
// so both surfaces render/simulate identically without duplicating either.
import { VFX_DEFAULTS } from './vfx.js';

export const SHAPES = ['glow', 'spark', 'ring', 'star', 'smoke', 'square', 'leaf'];
export const MOTIONS = ['cone', 'burst', 'rise', 'fall', 'orbit', 'ambient'];

// size: [sizeStart, sizeEnd] in studs. speed/lifetime: [min, max] — the midpoint is used as the
// base value (still a single number in the emitter, same as a hand-set value would be; the range
// here just documents the material's natural feel and lets scale variants stretch it).
const MATERIALS = [
  // ---- Elemental ----
  { key: 'fire', name: 'Fire', category: 'Elemental', shape: 'glow', motion: 'rise', blend: 'additive',
    colorStart: '#ffd36b', colorEnd: '#7a1400', gravity: -0.6, spread: 16, speed: [1.4, 2.8], lifetime: [0.5, 1.0], size: [0.5, 0.08], rate: 45 },
  { key: 'embers', name: 'Embers', category: 'Elemental', shape: 'spark', motion: 'rise', blend: 'additive',
    colorStart: '#ffb347', colorEnd: '#3a0e00', gravity: -0.15, spread: 32, speed: [0.7, 1.6], lifetime: [1.0, 2.2], size: [0.12, 0.02], rate: 18 },
  { key: 'smoke', name: 'Smoke', category: 'Elemental', shape: 'smoke', motion: 'rise', blend: 'normal',
    colorStart: '#9a9a9a', colorEnd: '#3a3a3a', gravity: -0.1, spread: 48, speed: [0.4, 1.1], lifetime: [2.2, 4.2], size: [0.4, 1.5], rate: 10 },
  { key: 'water-splash', name: 'Water Splash', category: 'Elemental', shape: 'glow', motion: 'burst', blend: 'normal',
    colorStart: '#bfe9ff', colorEnd: '#4aa0d8', gravity: 9.8, spread: 90, speed: [2.2, 5.0], lifetime: [0.4, 0.9], size: [0.25, 0.04], rate: 55 },
  { key: 'bubbles', name: 'Bubbles', category: 'Elemental', shape: 'ring', motion: 'rise', blend: 'normal',
    colorStart: '#d8f6ff', colorEnd: '#ffffff', gravity: -1.1, spread: 18, speed: [0.4, 0.9], lifetime: [1.6, 3.2], size: [0.14, 0.2], rate: 9 },
  { key: 'ice-shard', name: 'Ice Shards', category: 'Elemental', shape: 'square', motion: 'burst', blend: 'normal',
    colorStart: '#d6f4ff', colorEnd: '#8fd8ff', gravity: 6.5, spread: 90, speed: [1.5, 3.5], lifetime: [0.5, 1.0], size: [0.16, 0.04], rate: 30 },

  // ---- Weather ----
  { key: 'rain', name: 'Rain', category: 'Weather', shape: 'spark', motion: 'fall', blend: 'normal',
    colorStart: '#cfe8ff', colorEnd: '#8fb8dd', gravity: 9.8, spread: 8, speed: [6.0, 10.0], lifetime: [0.5, 1.0], size: [0.08, 0.08], rate: 90 },
  { key: 'snow', name: 'Snow', category: 'Weather', shape: 'glow', motion: 'fall', blend: 'normal',
    colorStart: '#ffffff', colorEnd: '#eef6ff', gravity: 0.5, spread: 65, speed: [0.3, 0.7], lifetime: [3.0, 6.0], size: [0.1, 0.1], rate: 14 },
  { key: 'leaves', name: 'Falling Leaves', category: 'Weather', shape: 'leaf', motion: 'fall', blend: 'normal',
    colorStart: '#c98a3a', colorEnd: '#7a5a1a', gravity: 1.4, spread: 75, speed: [0.5, 1.0], lifetime: [2.5, 5.0], size: [0.2, 0.2], rate: 6 },
  { key: 'dust-motes', name: 'Dust Motes', category: 'Weather', shape: 'glow', motion: 'ambient', blend: 'additive',
    colorStart: '#fff3c4', colorEnd: '#fff3c4', gravity: 0, spread: 90, speed: [0.15, 0.4], lifetime: [3.5, 6.0], size: [0.03, 0.03], rate: 8 },

  // ---- Magic ----
  { key: 'arcane-sparkle', name: 'Arcane Sparkle', category: 'Magic', shape: 'star', motion: 'ambient', blend: 'additive',
    colorStart: '#c9a3ff', colorEnd: '#5a2ea6', gravity: 0, spread: 90, speed: [0.3, 0.8], lifetime: [1.0, 2.0], size: [0.14, 0.02], rate: 22 },
  { key: 'energy-orb', name: 'Energy Orb', category: 'Magic', shape: 'glow', motion: 'orbit', blend: 'additive',
    colorStart: '#7ad9ff', colorEnd: '#1a4d7a', gravity: 0, spread: 40, speed: [1.2, 2.4], lifetime: [1.2, 2.4], size: [0.16, 0.05], rate: 20 },
  { key: 'portal-swirl', name: 'Portal Swirl', category: 'Magic', shape: 'ring', motion: 'orbit', blend: 'additive',
    colorStart: '#b56bff', colorEnd: '#2a0f4d', gravity: 0, spread: 65, speed: [2.0, 3.5], lifetime: [1.0, 2.0], size: [0.2, 0.06], rate: 26 },
  { key: 'heal-aura', name: 'Heal Aura', category: 'Magic', shape: 'star', motion: 'rise', blend: 'additive',
    colorStart: '#c8ffd8', colorEnd: '#ffffff', gravity: -0.3, spread: 30, speed: [0.6, 1.3], lifetime: [1.2, 2.2], size: [0.12, 0.03], rate: 16 },
  { key: 'mana-burst', name: 'Mana Burst', category: 'Magic', shape: 'glow', motion: 'burst', blend: 'additive',
    colorStart: '#8bc9ff', colorEnd: '#1a2a6b', gravity: 0.4, spread: 90, speed: [2.5, 5.0], lifetime: [0.4, 0.9], size: [0.22, 0.03], rate: 60 },

  // ---- Combat ----
  { key: 'blood-splatter', name: 'Blood Splatter', category: 'Combat', shape: 'glow', motion: 'burst', blend: 'normal',
    colorStart: '#a30f16', colorEnd: '#3d0509', gravity: 9.8, spread: 90, speed: [2.0, 4.5], lifetime: [0.4, 0.8], size: [0.14, 0.03], rate: 50 },
  { key: 'explosion-debris', name: 'Explosion Debris', category: 'Combat', shape: 'square', motion: 'burst', blend: 'normal',
    colorStart: '#ff8a3d', colorEnd: '#2a1a0a', gravity: 8.5, spread: 90, speed: [3.0, 6.5], lifetime: [0.6, 1.2], size: [0.2, 0.05], rate: 70 },
  { key: 'muzzle-spark', name: 'Muzzle Spark', category: 'Combat', shape: 'spark', motion: 'cone', blend: 'additive',
    colorStart: '#fff2b0', colorEnd: '#ff7a1a', gravity: 1.0, spread: 22, speed: [4.0, 7.0], lifetime: [0.15, 0.3], size: [0.1, 0.01], rate: 90 },
  { key: 'shockwave-ring', name: 'Shockwave Ring', category: 'Combat', shape: 'ring', motion: 'burst', blend: 'additive',
    colorStart: '#eaf6ff', colorEnd: '#8fc9ff', gravity: 0, spread: 90, speed: [3.5, 6.0], lifetime: [0.3, 0.6], size: [0.3, 0.6], rate: 24 },

  // ---- Nature ----
  { key: 'fireflies', name: 'Fireflies', category: 'Nature', shape: 'glow', motion: 'ambient', blend: 'additive',
    colorStart: '#e6ff9c', colorEnd: '#c9ff4a', gravity: 0, spread: 90, speed: [0.2, 0.5], lifetime: [2.0, 4.0], size: [0.05, 0.05], rate: 6 },
  { key: 'petals', name: 'Falling Petals', category: 'Nature', shape: 'leaf', motion: 'fall', blend: 'normal',
    colorStart: '#ffc9de', colorEnd: '#ff9ec2', gravity: 1.1, spread: 70, speed: [0.4, 0.9], lifetime: [2.5, 4.5], size: [0.16, 0.16], rate: 7 },

  // ---- Celebration ----
  { key: 'confetti', name: 'Confetti', category: 'Celebration', shape: 'square', motion: 'burst', blend: 'normal',
    colorStart: '#ff5c8a', colorEnd: '#ffd23f', gravity: 3.5, spread: 90, speed: [2.5, 5.0], lifetime: [1.5, 3.0], size: [0.14, 0.14], rate: 40 },
];

const COLOR_THEMES = [
  { key: 'classic', label: 'Classic' }, // uses the material's own defined colors
  { key: 'ice', label: 'Ice', colorStart: '#bfe9ff', colorEnd: '#ffffff' },
  { key: 'ember', label: 'Ember', colorStart: '#ff7a1a', colorEnd: '#3a0a00' },
  { key: 'toxic', label: 'Toxic', colorStart: '#9dff5c', colorEnd: '#1a3300' },
  { key: 'arcane', label: 'Arcane', colorStart: '#b98cff', colorEnd: '#2a0d4d' },
  { key: 'holy', label: 'Holy', colorStart: '#fff6c9', colorEnd: '#ffffff' },
];

const SCALES = [
  { key: 'small', label: 'Small', size: 0.6, rate: 0.7, cap: 0.6 },
  { key: 'standard', label: 'Standard', size: 1, rate: 1, cap: 1 },
  { key: 'large', label: 'Large', size: 1.6, rate: 1.5, cap: 1.5 },
];

const round = (v, d) => { const m = 10 ** d; return Math.round(v * m) / m; };
const mid = (range) => (range[0] + range[1]) / 2;

function buildPresets() {
  const out = [];
  for (const m of MATERIALS) {
    for (const theme of COLOR_THEMES) {
      for (const scale of SCALES) {
        const colorStart = theme.colorStart || m.colorStart;
        const colorEnd = theme.colorEnd || m.colorEnd;
        const lifetime = round(mid(m.lifetime), 2);
        const rate = round(m.rate * scale.rate, 1);
        // Rough pool sizing so the cap comfortably fits how many particles are alive at once
        // (rate * lifetime, with slack) rather than defaulting every preset to the same 150.
        const maxParticles = Math.max(6, Math.min(2000, Math.round(rate * lifetime * 1.6 * scale.cap)));
        const nameSuffix = scale.key === 'standard' ? '' : ` (${scale.label})`;
        const name = theme.key === 'classic' ? `${m.name}${nameSuffix}` : `${theme.label} ${m.name}${nameSuffix}`;
        out.push({
          id: `${m.key}-${theme.key}-${scale.key}`,
          name,
          category: m.category,
          emitter: {
            ...VFX_DEFAULTS,
            shape: m.shape,
            motion: m.motion,
            blendMode: m.blend,
            colorStart, colorEnd,
            sizeStart: round(m.size[0] * scale.size, 3),
            sizeEnd: round(m.size[1] * scale.size, 3),
            transparencyStart: 0,
            transparencyEnd: 1,
            spreadDegrees: m.spread,
            gravity: m.gravity,
            maxParticles,
            rate,
            lifetime,
            speed: round(mid(m.speed), 2),
          },
        });
      }
    }
  }
  return out;
}

export const PARTICLE_PRESETS = buildPresets();
export const CATEGORIES = ['All', ...new Set(MATERIALS.map((m) => m.category))];

export function searchPresets(query, category) {
  const q = (query || '').trim().toLowerCase();
  return PARTICLE_PRESETS.filter((p) =>
    (!category || category === 'All' || p.category === category) &&
    (!q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)));
}
export function findPreset(id) {
  return PARTICLE_PRESETS.find((p) => p.id === id) || null;
}
