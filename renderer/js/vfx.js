// VFX Animator: a deterministic, scrubbable particle sampler. The hard part of "just add
// particles" is that a normal realtime emitter sim can't scrub — it only knows how to step
// forward. This instead answers "what does frame F look like" as a pure function of the item's
// keyframed emitter tracks and a per-particle hash, with no persistent simulation state at all —
// so jumping to any frame (forward, backward, or repeatedly to the same frame) always produces
// the exact same result, which is what the timeline/onion-skin/MCP render_frame tooling all
// assume of every other animatable thing in this app.
import * as CF from './cf.js';
import { shapePoint } from './effectShapes.js';
// Deliberately no import of state.js here: this file is reused as-is by the standalone VFX Studio
// window (a separate renderer with no project/undo/autosave state at all), so every call site
// takes an explicit `evalNum(itemId, track, frame, fallback)` track-evaluator instead of reaching
// out to a shared S.evalTrackNum — the main app passes the real one (see viewport.js), the studio
// passes a trivial "just return the fallback" stand-in since it has no keyframed tracks at all.
//
// The evalNum contract is also how the effect engine expresses clip semantics without this file
// knowing clips exist (docs/vfx-studio.md, "Frame-space contract"): the engine's adapter returns
// rate 0 outside a layer's clip window (so emission is gated but particles live out their
// lifetime past clip end, like a Roblox emitter with Enabled=false), wraps curve lookups for
// looping clips, and spikes the rate by burst*fps at iteration-start frames to deposit exactly
// `burst` whole spawns into the accumulator. Beyond '@rate'/'@lifetime'/'@speed', the sampler
// below queries '@spread'/'@gravity'/'@sizeStart'/'@sizeEnd'/'@transparencyStart'/
// '@transparencyEnd' AT EACH PARTICLE'S SPAWN FRAME (falling back to the static em.* values, so
// existing projects render bit-identically). Per-spawn resolution is deliberate: gravity stays a
// per-particle constant (the closed-form 0.5·g·t² trajectory never bends retroactively), keyed
// spread re-aims only newly spawned particles, keyed sizes affect new spawns — matching how a
// real Roblox emitter reads Speed/Lifetime/SpreadAngle at emission time.

export const VFX_DEFAULTS = {
  colorStart: '#ffffff', colorEnd: '#ffffff',
  sizeStart: 0.3, sizeEnd: 0.05,
  transparencyStart: 0, transparencyEnd: 1,
  spreadDegrees: 20,
  gravity: -9.8,
  maxParticles: 150,
  // shape/motion/blendMode default to the exact old look (a soft glow sprite, spray-cone motion,
  // normal blending) so any project saved before these fields existed renders identically.
  shape: 'glow',
  motion: 'cone',
  blendMode: 'normal',
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
function paramsAt(item, frame, evalNum) {
  const em = item.emitter || VFX_DEFAULTS;
  return {
    rate: evalNum(item.id, '@rate', frame, em.rate ?? 8),
    lifetime: evalNum(item.id, '@lifetime', frame, em.lifetime ?? 1.5),
    speed: evalNum(item.id, '@speed', frame, em.speed ?? 4),
  };
}

// Six particle "motions" — the position formula for a single particle, still a pure function of
// its own spawn frame and index (no persistent sim state, same determinism guarantee as the rest
// of this file). `speed` and `spreadDegrees` are deliberately repurposed per motion (documented
// inline below) rather than adding a new emitter field for every motion's own knob — keeps the
// Inspector/Studio UI to the same handful of fields regardless of which motion is selected.
function motionPosition(motion, ctx) {
  const { spawnPos, up, perp1, perp2, rnd1, rnd2, spreadRad, speed, ageSec, spawnIndex, gravity, spreadDegrees } = ctx;
  const gravityTerm = 0.5 * gravity * ageSec * ageSec;
  if (motion === 'burst') {
    // Fully omnidirectional (ignores spread/up entirely) — an explosion/impact, not a spray.
    const theta = (rnd1 * 0.5 + 0.5) * Math.PI; // 0..PI polar angle
    const phi = (hash01(spawnIndex, 4) * 2 - 1) * Math.PI; // -PI..PI azimuth
    const st = Math.sin(theta);
    const dir = [st * Math.cos(phi), Math.cos(theta), st * Math.sin(phi)];
    return [
      spawnPos[0] + dir[0] * speed * ageSec,
      spawnPos[1] + dir[1] * speed * ageSec + gravityTerm,
      spawnPos[2] + dir[2] * speed * ageSec,
    ];
  }
  if (motion === 'rise' || motion === 'fall') {
    // Mostly straight up/down (world axis, not the emitter's own orientation — embers rise and
    // rain falls regardless of which way the emitter is rotated) plus a gentle per-particle sway.
    // spreadDegrees (0..90) is repurposed here as a 0..0.6 stud sway-amount knob.
    const sign = motion === 'rise' ? 1 : -1;
    const phase = hash01(spawnIndex, 5) * Math.PI * 2;
    const freq = 1.2 + hash01(spawnIndex, 6) * 1.3;
    const swayAmp = (spreadDegrees / 90) * 0.6;
    return [
      spawnPos[0] + Math.sin(ageSec * freq + phase) * swayAmp,
      spawnPos[1] + sign * speed * ageSec + gravityTerm,
      spawnPos[2] + Math.cos(ageSec * freq * 0.8 + phase) * swayAmp,
    ];
  }
  if (motion === 'orbit') {
    // Spirals around the emitter's up axis in the perp1/perp2 plane. spreadDegrees is repurposed
    // as an orbit-radius knob (studs) and `speed` as angular velocity (rad/sec).
    const radius = Math.max(0.05, spreadDegrees / 15);
    const phase = hash01(spawnIndex, 7) * Math.PI * 2;
    const ang = phase + ageSec * speed;
    const rise = 0.3 * ageSec;
    const c = Math.cos(ang) * radius, s = Math.sin(ang) * radius;
    return [
      spawnPos[0] + perp1[0] * c + perp2[0] * s,
      spawnPos[1] + rise + gravityTerm,
      spawnPos[2] + perp1[2] * c + perp2[2] * s,
    ];
  }
  if (motion === 'ambient') {
    // Barely leaves its spawn point — gentle 3-axis jitter for fireflies/dust/floaty sparkle.
    // `speed` is repurposed as the jitter amplitude scale.
    const phase = hash01(spawnIndex, 5) * Math.PI * 2;
    const amp = Math.max(0.03, speed * 0.3);
    return [
      spawnPos[0] + Math.sin(ageSec * 1.3 + phase) * amp,
      spawnPos[1] + Math.sin(ageSec * 0.9 + phase * 1.7) * amp * 0.6 + gravityTerm,
      spawnPos[2] + Math.cos(ageSec * 1.1 + phase * 0.6) * amp,
    ];
  }
  // 'cone' (default): directional spray around `up`, spread by spreadDegrees — the original,
  // unchanged formula so any existing project with no `motion` field renders bit-for-bit the same.
  const dir = [
    up[0] + (perp1[0] * rnd1 + perp2[0] * rnd2) * Math.sin(spreadRad),
    up[1] + (perp1[1] * rnd1 + perp2[1] * rnd2) * Math.sin(spreadRad),
    up[2] + (perp1[2] * rnd1 + perp2[2] * rnd2) * Math.sin(spreadRad),
  ];
  const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  return [
    spawnPos[0] + (dir[0] / dl) * speed * ageSec,
    spawnPos[1] + (dir[1] / dl) * speed * ageSec + gravityTerm,
    spawnPos[2] + (dir[2] / dl) * speed * ageSec,
  ];
}

// Every particle still alive at `frame`, as { pos:[x,y,z], size, color:[r,g,b], opacity }.
// Pure — takes no live instance, just the item + project fps, an origin-per-frame resolver, and a
// track evaluator (so an animated/attached emitter's moving position is honored at each particle's
// own spawn frame, not just the current one). `evalNum` defaults to "just return the fallback"
// (no keyframed-track support) so callers with no track system at all — the VFX Studio preview —
// can omit it entirely; the main app always passes S.evalTrackNum explicitly (see viewport.js).
export function sampleParticles(item, frame, fps, resolveOrigin, evalNum = (_id, _track, _f, fallback) => fallback) {
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
    const rateAtF = evalNum(item.id, '@rate', f, em.rate ?? 8);
    acc += Math.max(0, rateAtF) / fps;
    while (acc >= 1) {
      acc -= 1;
      const lifetimeSec = Math.max(0.05, evalNum(item.id, '@lifetime', f, em.lifetime ?? 1.5));
      const ageFrames = frame - f;
      const ageSec = ageFrames / fps;
      if (ageSec <= lifetimeSec) {
        const speed = evalNum(item.id, '@speed', f, em.speed ?? 4);
        // Per-spawn parameter resolution (see header comment): each of these is read at the
        // particle's own spawn frame f and stays constant for that particle's whole life.
        const spreadDegrees = evalNum(item.id, '@spread', f, em.spreadDegrees);
        const gravity = evalNum(item.id, '@gravity', f, em.gravity);
        const sizeStart = evalNum(item.id, '@sizeStart', f, em.sizeStart);
        const sizeEnd = evalNum(item.id, '@sizeEnd', f, em.sizeEnd);
        const trStart = evalNum(item.id, '@transparencyStart', f, em.transparencyStart);
        const trEnd = evalNum(item.id, '@transparencyEnd', f, em.transparencyEnd);
        const origin = resolveOrigin(f);
        const up = localUpInWorld(origin);
        // Shared basis for every motion below: `up` plus two arbitrary perpendicular axes — not a
        // perfectly uniform sphere-cap distribution, but visually convincing and, crucially,
        // stable and cheap: no per-frame trig setup beyond what's already needed.
        const ax = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const px = [up[1] * ax[2] - up[2] * ax[1], up[2] * ax[0] - up[0] * ax[2], up[0] * ax[1] - up[1] * ax[0]];
        const pl = Math.hypot(px[0], px[1], px[2]) || 1;
        const perp1 = [px[0] / pl, px[1] / pl, px[2] / pl];
        const perp2 = [up[1] * perp1[2] - up[2] * perp1[1], up[2] * perp1[0] - up[0] * perp1[2], up[0] * perp1[1] - up[1] * perp1[0]];
        const rnd1 = (hash01(spawnIndex, 1) * 2 - 1);
        const rnd2 = (hash01(spawnIndex, 2) * 2 - 1);
        const spreadRad = (spreadDegrees * Math.PI) / 180;
        // Emission-shape support: spawn across a shapes-system def instead of the origin point,
        // sampled by two per-particle hashes (u along the shape, v across its second dimension).
        // No emissionShape → the exact old behavior (spawn at the origin point).
        const localSpawn = em.emissionShape
          ? shapePoint(em.emissionShape, hash01(spawnIndex, 8), hash01(spawnIndex, 9))
          : [0, 0, 0];
        const spawnPos = applyToPoint(origin, localSpawn);
        const motion = em.motion || 'cone';
        const pos = motionPosition(motion, { spawnPos, up, perp1, perp2, rnd1, rnd2, spreadRad, speed, ageSec, spawnIndex, gravity, spreadDegrees });
        const lf = ageSec / lifetimeSec; // particle-local life fraction, 0..1
        alive.push({
          pos,
          size: Math.max(0.005, sizeStart + (sizeEnd - sizeStart) * lf),
          color: lerp3(colorStart, colorEnd, lf),
          opacity: Math.max(0, 1 - (trStart + (trEnd - trStart) * lf)),
          // Stable identity + life data for the modifier stack: `seed` never changes for a given
          // particle no matter what dies around it (array position does — never key on it).
          seed: spawnIndex,
          spawnFrame: f,
          lf,
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
