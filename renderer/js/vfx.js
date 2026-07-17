// VFX Animator: a deterministic, scrubbable particle sampler. The hard part of "just add
// particles" is that a normal realtime emitter sim can't scrub — it only knows how to step
// forward. This instead answers "what does frame F look like" as a pure function of the item's
// keyframed emitter tracks and a per-particle hash, with no persistent simulation state at all —
// so jumping to any frame (forward, backward, or repeatedly to the same frame) always produces
// the exact same result, which is what the timeline/onion-skin/MCP render_frame tooling all
// assume of every other animatable thing in this app.
import * as CF from './cf.js';
import * as S from './state.js';

export const VFX_DEFAULTS = {
  colorStart: '#ffffff', colorEnd: '#ffffff',
  sizeStart: 0.3, sizeEnd: 0.05,
  transparencyStart: 0, transparencyEnd: 1,
  spreadDegrees: 20,
  gravity: -9.8,
  maxParticles: 150,
};

function hexToRgb01(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return [1, 1, 1];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

// Deterministic pseudo-random in [0,1) from two integers — same inputs always give the same
// output, with no shared/mutable RNG state (so evaluating frame 50 then frame 10 then frame 50
// again is bit-for-bit identical every time, unlike a stateful Math.random() stream would be).
function hash01(a, b) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function applyToPoint(cf, p) {
  const [x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22] = cf;
  return [r00 * p[0] + r01 * p[1] + r02 * p[2] + x, r10 * p[0] + r11 * p[1] + r12 * p[2] + y, r20 * p[0] + r21 * p[1] + r22 * p[2] + z];
}
function localUpInWorld(cf) {
  return [cf[4], cf[7], cf[10]]; // world direction of local +Y — see CF.mul's column convention
}

// itemId's '@rate'/'@lifetime'/'@speed' tracks override item.emitter's base rate/lifetime/speed
// (same "default + optional keyframed override" convention as a camera's fov/'@fov').
function paramsAt(item, frame) {
  const em = item.emitter || VFX_DEFAULTS;
  return {
    rate: S.evalTrackNum(item.id, '@rate', frame, em.rate ?? 8),
    lifetime: S.evalTrackNum(item.id, '@lifetime', frame, em.lifetime ?? 1.5),
    speed: S.evalTrackNum(item.id, '@speed', frame, em.speed ?? 4),
  };
}

// Every particle still alive at `frame`, as { pos:[x,y,z], size, color:[r,g,b], opacity }.
// Pure — takes no live instance, just the item + project fps, and an origin-per-frame resolver
// (so an animated/attached emitter's moving position is honored at each particle's own spawn
// frame, not just the current one).
export function sampleParticles(item, frame, fps, resolveOrigin) {
  const em = { ...VFX_DEFAULTS, ...(item.emitter || {}) };
  const cap = Math.max(1, Math.min(2000, em.maxParticles || VFX_DEFAULTS.maxParticles));

  // Emission is frame-quantized: accumulate rate/fps each frame and spawn once the running
  // fractional total crosses an integer. Looping from frame 0 every call is deliberately simple
  // (not incrementally cached) — animations here run at most tens of thousands of frames, and
  // this is a few float ops each, well under a millisecond even at 60fps scrub/playback rates.
  const colorStart = hexToRgb01(em.colorStart), colorEnd = hexToRgb01(em.colorEnd);
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  const alive = [];
  let acc = 0, spawnIndex = 0;
  for (let f = 0; f <= frame; f++) {
    const rateAtF = S.evalTrackNum(item.id, '@rate', f, em.rate ?? 8);
    acc += Math.max(0, rateAtF) / fps;
    while (acc >= 1) {
      acc -= 1;
      const lifetimeSec = Math.max(0.05, S.evalTrackNum(item.id, '@lifetime', f, em.lifetime ?? 1.5));
      const ageFrames = frame - f;
      const ageSec = ageFrames / fps;
      if (ageSec <= lifetimeSec) {
        const speed = S.evalTrackNum(item.id, '@speed', f, em.speed ?? 4);
        const origin = resolveOrigin(f);
        const up = localUpInWorld(origin);
        // Deterministic cone spread around `up`, using two arbitrary perpendicular axes — not a
        // perfectly uniform sphere-cap distribution, but visually convincing and, crucially,
        // stable and cheap: no per-frame trig setup beyond what's already needed.
        const ax = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const px = [up[1] * ax[2] - up[2] * ax[1], up[2] * ax[0] - up[0] * ax[2], up[0] * ax[1] - up[1] * ax[0]];
        const pl = Math.hypot(px[0], px[1], px[2]) || 1;
        const perp1 = [px[0] / pl, px[1] / pl, px[2] / pl];
        const perp2 = [up[1] * perp1[2] - up[2] * perp1[1], up[2] * perp1[0] - up[0] * perp1[2], up[0] * perp1[1] - up[1] * perp1[0]];
        const rnd1 = (hash01(spawnIndex, 1) * 2 - 1);
        const rnd2 = (hash01(spawnIndex, 2) * 2 - 1);
        const spreadRad = (em.spreadDegrees * Math.PI) / 180;
        const dir = [
          up[0] + (perp1[0] * rnd1 + perp2[0] * rnd2) * Math.sin(spreadRad),
          up[1] + (perp1[1] * rnd1 + perp2[1] * rnd2) * Math.sin(spreadRad),
          up[2] + (perp1[2] * rnd1 + perp2[2] * rnd2) * Math.sin(spreadRad),
        ];
        const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
        const spawnPos = applyToPoint(origin, [0, 0, 0]);
        const lf = ageSec / lifetimeSec; // particle-local life fraction, 0..1
        alive.push({
          pos: [
            spawnPos[0] + (dir[0] / dl) * speed * ageSec,
            spawnPos[1] + (dir[1] / dl) * speed * ageSec + 0.5 * em.gravity * ageSec * ageSec,
            spawnPos[2] + (dir[2] / dl) * speed * ageSec,
          ],
          size: Math.max(0.005, em.sizeStart + (em.sizeEnd - em.sizeStart) * lf),
          color: lerp3(colorStart, colorEnd, lf),
          opacity: Math.max(0, 1 - (em.transparencyStart + (em.transparencyEnd - em.transparencyStart) * lf)),
        });
      }
      spawnIndex++;
    }
  }
  // Most-recently-spawned particles win if over cap — an old, nearly-dead particle disappearing
  // a little early reads better than a freshly-spawned one never appearing at all.
  return alive.length > cap ? alive.slice(alive.length - cap) : alive;
}

export { paramsAt };
