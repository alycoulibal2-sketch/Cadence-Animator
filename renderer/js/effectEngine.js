// The effect engine: sampleEffect(doc, frame, opts) answers "what does this whole effect look
// like at doc frame F" as a pure function — every layer type, every curve, every modifier, zero
// persistent state. Shared by the studio preview, the animator's EffectInstance, export baking,
// and validation, so all four see the identical effect by construction.
//
// Frame-space contract (docs/vfx-studio.md): everything here runs in DOC frames at the doc's own
// fps. Clip semantics live in the per-layer track adapter handed to vfx.js's sampleParticles:
// rate gates emission to the clip window (particles OUTLIVE their clip, like a Roblox emitter
// with Enabled=false), looping clips wrap curve lookups so emission is continuous across the
// seam (no pool reset), and burst spikes the rate at each iteration start. resolveOrigin always
// receives doc frames.

import * as CF from './cf.js';
import { sampleParticles } from './vfx.js';
import { resolveProp, resolveModParam, MODIFIER_TYPES } from './effectModel.js';

const TAU = Math.PI * 2;

function hash01(a, b = 0) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function hexToRgb01(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return [1, 1, 1];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

// Hue-rotate an [r,g,b] 0..1 color by `deg` degrees (used by the gradientShift modifier).
function hueRotate(rgb, deg) {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [r, g, b]; // grey — hue undefined, rotation is a no-op
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  h = (h + deg / 360) % 1;
  if (h < 0) h += 1;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const chan = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [chan(h + 1 / 3), chan(h), chan(h - 1 / 3)];
}

// ---------------------------------------------------------------- clip helpers
// Local frame within the layer's clip for a doc frame INSIDE the active window. Looping wraps;
// non-looping just offsets (callers gate the window themselves).
export function clipLocalFrame(layer, f) {
  const { start, len, loop } = layer.clip;
  const lf = f - start;
  if (loop && len > 0) return ((lf % len) + len) % len;
  return lf;
}

// Is this scalar (non-emitter) layer active at doc frame f? Emitters use rate-gating instead —
// their particles outlive the window; a shape/light/screen contributes only inside it.
function scalarActive(layer, f, docDuration) {
  const { start, len, loop } = layer.clip;
  if (f < start) return false;
  if (loop) return f < docDuration;
  return f < start + len;
}

const TRACK_TO_PROP = {
  '@rate': 'rate', '@lifetime': 'lifetime', '@speed': 'speed',
  '@spread': 'spreadDegrees', '@gravity': 'gravity',
  '@sizeStart': 'sizeStart', '@sizeEnd': 'sizeEnd',
  '@transparencyStart': 'transparencyStart', '@transparencyEnd': 'transparencyEnd',
};

// The adapter that teaches sampleParticles about clips without vfx.js knowing clips exist.
function makeEmitterEvalNum(layer, fps, docDuration) {
  const { start, len, loop } = layer.clip;
  return (_id, track, f, fallback) => {
    const prop = TRACK_TO_PROP[track];
    if (!prop) return fallback;
    if (track === '@rate') {
      // Emission window: [start, start+len) — or [start, docDuration) when looping.
      if (f < start) return 0;
      if (loop ? f >= docDuration : f >= start + len) return 0;
      const lf = clipLocalFrame(layer, f);
      let rate = Math.max(0, resolveProp(layer, 'rate', lf, fps));
      const burst = layer.props.burst || 0;
      // A rate spike of burst*fps at the iteration-start frame deposits exactly `burst` extra
      // whole spawns into the accumulator (rate/fps summed once) — and re-fires each loop.
      if (burst > 0 && lf === 0) rate += burst * fps;
      return rate;
    }
    // Non-rate params are only ever queried at spawn frames, which the rate gate keeps inside
    // the window — but clamp defensively so a stray query can't read a negative local frame.
    const lf = Math.max(0, clipLocalFrame(layer, f));
    return resolveProp(layer, prop, lf, fps);
  };
}

function translateCF(cf, offset) {
  if (!offset || (!offset[0] && !offset[1] && !offset[2])) return cf;
  return CF.mul(cf, [offset[0], offset[1], offset[2], 1, 0, 0, 0, 1, 0, 0, 0, 1]);
}

// Upper bound of a prop over its whole curve (for "can any particle still be alive" early-outs).
function maxPropValue(layer, prop) {
  const base = layer.props[prop] ?? 0;
  const keys = layer.curves[prop];
  if (!keys || !keys.length) return base;
  return Math.max(base, ...keys.map((k) => (typeof k.v === 'number' ? k.v : base)));
}

// ---------------------------------------------------------------- modifier stack
function applyParticleModifiers(layer, particles, f, fps, docDuration) {
  if (!layer.modifiers.length) return particles;
  const lf = Math.max(0, clipLocalFrame(layer, f));
  const tSec = lf / fps;
  const clipLen = layer.clip.len;
  const clipProgress = clipLen > 0 ? Math.min(1, lf / clipLen) : 0;

  for (const mod of layer.modifiers) {
    if (!mod.enabled || !MODIFIER_TYPES[mod.type]) continue;
    const P = (param) => resolveModParam(layer, mod, param, lf, fps);
    switch (mod.type) {
      case 'noise': {
        const amount = P('amount'), freq = P('frequency');
        if (amount <= 0) break;
        for (const p of particles) {
          const age = (f - p.spawnFrame) / fps;
          for (let axis = 0; axis < 3; axis++) {
            // Smooth per-particle wobble: deterministic phase from the particle's stable seed.
            p.pos[axis] += amount * Math.sin(age * freq * TAU + hash01(p.seed, 31 + axis) * TAU) * (0.4 + 0.6 * hash01(p.seed, 41 + axis));
          }
        }
        break;
      }
      case 'wind': {
        const strength = P('strength');
        const dir = mod.props.direction || [1, 0, 0];
        const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
        for (const p of particles) {
          const age = (f - p.spawnFrame) / fps;
          p.pos[0] += (dir[0] / dl) * strength * age;
          p.pos[1] += (dir[1] / dl) * strength * age;
          p.pos[2] += (dir[2] / dl) * strength * age;
        }
        break;
      }
      case 'pulse': {
        const amount = P('amount'), freq = P('frequency');
        const m = 1 + amount * Math.sin(tSec * freq * TAU);
        for (const p of particles) p.size *= Math.max(0, m);
        break;
      }
      case 'flicker': {
        const amount = P('amount');
        for (const p of particles) {
          // Re-hash every other frame so the jitter visibly flickers instead of strobing at fps.
          p.opacity *= Math.max(0, 1 - amount * hash01(p.seed, Math.floor(f / 2)));
        }
        break;
      }
      case 'orbit': {
        const speed = P('speed'), radius = P('radius');
        for (const p of particles) {
          const age = (f - p.spawnFrame) / fps;
          // Additive swirl: each particle circles at its own phase (from its stable seed), the
          // circle growing over its life up to `radius` — reads as a vortex without needing the
          // layer's origin (which may itself be moving).
          const ang = speed * age + hash01(p.seed, 51) * TAU;
          const push = radius * p.lf;
          p.pos[0] += Math.cos(ang) * push;
          p.pos[2] += Math.sin(ang) * push;
        }
        break;
      }
      case 'fadeInOut': {
        const fadeIn = mod.props.fadeIn ?? 0.15, fadeOut = mod.props.fadeOut ?? 0.3;
        const env = envelope(clipProgress, fadeIn, fadeOut);
        for (const p of particles) p.opacity *= env;
        break;
      }
      case 'gradientShift': {
        const deg = P('degrees') * clipProgress;
        for (const p of particles) p.color = hueRotate(p.color, deg);
        break;
      }
      case 'glowBoost': {
        const amount = P('amount');
        for (const p of particles) {
          p.size *= 1 + amount * 0.5;
          p.opacity = Math.min(1, p.opacity * (1 + amount * 0.5));
        }
        break;
      }
    }
  }
  return particles;
}

function envelope(progress, fadeIn, fadeOut) {
  let v = 1;
  if (fadeIn > 0 && progress < fadeIn) v = Math.min(v, progress / fadeIn);
  if (fadeOut > 0 && progress > 1 - fadeOut) v = Math.min(v, (1 - progress) / fadeOut);
  return Math.max(0, Math.min(1, v));
}

// Modifier envelope for scalar layers: returns multipliers for the layer's "primary" outputs.
function scalarModifiers(layer, f, fps) {
  const lf = Math.max(0, clipLocalFrame(layer, f));
  const tSec = lf / fps;
  const clipLen = layer.clip.len;
  const clipProgress = clipLen > 0 ? Math.min(1, lf / clipLen) : 0;
  let intensityMul = 1, sizeMul = 1, hueDeg = 0;
  for (const mod of layer.modifiers) {
    if (!mod.enabled || !MODIFIER_TYPES[mod.type]) continue;
    const P = (param) => resolveModParam(layer, mod, param, lf, fps);
    switch (mod.type) {
      case 'pulse': {
        const m = 1 + P('amount') * Math.sin(tSec * P('frequency') * TAU);
        intensityMul *= Math.max(0, m);
        sizeMul *= Math.max(0, m);
        break;
      }
      case 'flicker':
        intensityMul *= Math.max(0, 1 - P('amount') * hash01(layerSeed(layer), Math.floor(f / 2)));
        break;
      case 'fadeInOut':
        intensityMul *= envelope(clipProgress, mod.props.fadeIn ?? 0.15, mod.props.fadeOut ?? 0.3);
        break;
      case 'gradientShift':
        hueDeg += P('degrees') * clipProgress;
        break;
      case 'glowBoost': {
        const amount = P('amount');
        intensityMul *= 1 + amount * 0.5;
        sizeMul *= 1 + amount * 0.25;
        break;
      }
    }
  }
  return { intensityMul, sizeMul, hueDeg };
}

const layerSeedCache = new Map();
function layerSeed(layer) {
  let s = layerSeedCache.get(layer.id);
  if (s === undefined) {
    s = 0;
    for (let i = 0; i < layer.id.length; i++) s = (s * 31 + layer.id.charCodeAt(i)) % 100000;
    layerSeedCache.set(layer.id, s);
  }
  return s;
}

// ---------------------------------------------------------------- sampleEffect
// opts:
//   origin        — world CFrame the effect is planted at (flat 12-array), default identity.
//   resolveOrigin — (docFrame) => CF for animated/attached origins; overrides `origin`.
//   quality       — 0..1 preview decimation: keep particle iff hash01(seed, 9999) < quality.
//                   Deterministic and a strict SUBSET of the quality-1 particle set. Validation,
//                   perf reports, and vfx_render_frame must use quality 1 (the default).
//   soloIds       — Set of layer ids (studio view-state): when non-empty, only those layers
//                   sample. Solo is never part of the document.
export function sampleEffect(doc, frame, opts = {}) {
  const origin = opts.origin || CF.IDENTITY.slice();
  const resolveOriginDoc = opts.resolveOrigin || (() => origin);
  const quality = typeof opts.quality === 'number' ? Math.max(0, Math.min(1, opts.quality)) : 1;
  const soloIds = opts.soloIds && opts.soloIds.size ? opts.soloIds : null;
  const fps = doc.fps || 30;

  const out = {
    particles: [], shapes: [], lights: [], screen: [],
    shake: { dx: 0, dy: 0, roll: 0 },
    sounds: [],
    stats: { particleCount: 0, liveLayerCount: 0, quality },
  };
  if (frame < 0) return out;

  for (const layer of doc.layers) {
    if (!layer.enabled) continue;
    if (soloIds && !soloIds.has(layer.id)) continue;

    if (layer.type === 'emitter') {
      const { start, len, loop } = layer.clip;
      if (frame < start) continue;
      if (!loop) {
        // Early-out once emission is over AND the longest-lived particle must be dead.
        const maxLifeFrames = Math.ceil(maxPropValue(layer, 'lifetime') * fps);
        if (frame >= start + len + maxLifeFrames) continue;
      }
      const em = { ...layer.props };
      const item = { id: layer.id, emitter: em };
      const evalNum = makeEmitterEvalNum(layer, fps, doc.duration);
      const originResolver = (f) => translateCF(resolveOriginDoc(f), layer.props.offset);
      let particles = sampleParticles(item, frame, fps, originResolver, evalNum);
      particles = applyParticleModifiers(layer, particles, frame, fps, doc.duration);
      if (quality < 1) particles = particles.filter((p) => hash01(p.seed, 9999) < quality);
      if (particles.length) {
        out.stats.liveLayerCount++;
        const shape = em.shape || 'glow';
        const blendMode = em.blendMode || 'normal';
        for (const p of particles) {
          p.shape = shape;
          p.blendMode = blendMode;
          p.layerId = layer.id;
        }
        out.particles.push(...particles);
      }
      continue;
    }

    if (!scalarActive(layer, frame, doc.duration)) continue;
    const lf = Math.max(0, clipLocalFrame(layer, frame));
    const R = (prop) => resolveProp(layer, prop, lf, fps);
    const mods = scalarModifiers(layer, frame, fps);
    out.stats.liveLayerCount++;

    if (layer.type === 'shape') {
      let color = hexToRgb01(layer.props.color);
      if (mods.hueDeg) color = hueRotate(color, mods.hueDeg);
      out.shapes.push({
        layerId: layer.id,
        shapeDef: layer.props.shape,
        color,
        opacity: Math.max(0, Math.min(1, R('opacity') * mods.intensityMul)),
        scale: Math.max(0.001, R('scale') * mods.sizeMul),
        rotation: R('rotation'),
        thickness: Math.max(0.002, R('thickness')),
        emissive: !!layer.props.emissive,
        offset: layer.props.offset || [0, 0, 0],
      });
    } else if (layer.type === 'light') {
      let color = hexToRgb01(layer.props.color);
      if (mods.hueDeg) color = hueRotate(color, mods.hueDeg);
      out.lights.push({
        layerId: layer.id,
        color,
        intensity: Math.max(0, R('intensity') * mods.intensityMul),
        range: Math.max(0, R('range')),
        offset: layer.props.offset || [0, 0, 0],
      });
    } else if (layer.type === 'screen') {
      let color = hexToRgb01(layer.props.color);
      if (mods.hueDeg) color = hueRotate(color, mods.hueDeg);
      out.screen.push({
        layerId: layer.id,
        kind: layer.props.kind || 'flash',
        color,
        opacity: Math.max(0, Math.min(1, R('opacity') * mods.intensityMul)),
        density: Math.max(1, Math.round(R('density'))),
      });
    } else if (layer.type === 'shake') {
      const amp = R('amplitude');
      const freq = layer.props.frequency || 9;
      const roll = R('roll');
      const tSec = lf / fps;
      const seed = layerSeed(layer);
      // Sum of two incommensurate sines per axis reads as noise but stays perfectly
      // deterministic and scrub-stable (a real noise() call keyed on time would too — this is
      // simply cheaper and has no lattice artifacts at low frequencies).
      const n = (phase, mul) =>
        Math.sin(tSec * freq * TAU * mul + hash01(seed, phase) * TAU) * 0.7 +
        Math.sin(tSec * freq * TAU * mul * 1.73 + hash01(seed, phase + 1) * TAU) * 0.3;
      out.shake.dx += amp * n(1, 1);
      out.shake.dy += amp * n(3, 1.13);
      out.shake.roll += roll * n(5, 0.91);
    } else if (layer.type === 'sound') {
      const { len, loop } = layer.clip;
      out.sounds.push({
        layerId: layer.id,
        soundId: layer.props.soundId || '',
        volume: layer.props.volume ?? 0.7,
        pitch: layer.props.pitch ?? 1,
        shouldBePlaying: loop ? true : lf < len,
        tOffset: (loop ? lf : Math.min(lf, len)) / fps,
      });
    }
  }

  out.stats.particleCount = out.particles.length;
  return out;
}

// Peak/average scan across the whole doc — the numeric backbone of the performance report and
// several validators. Always samples at quality 1.
export function scanEffect(doc, opts = {}) {
  const step = Math.max(1, Math.round(opts.step || 1));
  let peakParticles = 0, peakFrame = 0, totalParticles = 0, samples = 0;
  let peakLights = 0, peakScreen = 0;
  for (let f = 0; f < doc.duration; f += step) {
    const s = sampleEffect(doc, f, { origin: CF.IDENTITY.slice() });
    if (s.particles.length > peakParticles) { peakParticles = s.particles.length; peakFrame = f; }
    peakLights = Math.max(peakLights, s.lights.length);
    peakScreen = Math.max(peakScreen, s.screen.length);
    totalParticles += s.particles.length;
    samples++;
  }
  return {
    peakParticles, peakFrame,
    avgParticles: samples ? Math.round(totalParticles / samples) : 0,
    peakLights, peakScreen,
    framesScanned: samples,
  };
}
