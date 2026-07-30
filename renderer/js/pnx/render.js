// PNX rendering: materials, render commands, and the resolve pass (spec Parts 34, 36-39).
//
// PART 36 IS THE WHOLE DESIGN: "Simulation and rendering MUST remain separate." The same particles
// may render as sprites, meshes, points, lines, beams, trails, ribbons, volumes or lights — so a
// renderer node does not draw anything. It produces a RENDER COMMAND: a description of what to draw,
// how, and with which material. A backend consumes commands.
//
//   graph  ->  render commands  ->  resolve  ->  flat buffers  ->  backend (three.js / Roblox / bake)
//
// The resolve pass is where fields become numbers. A material's channels are `field<...>`, evaluated
// once per element, packed into Float32Arrays laid out for direct upload. That is the CPU/GPU seam
// Part 54 asks for: resolve produces data with no API calls in it, so the same command can be drawn by
// three.js today, by a compute backend later, or written into a bake — and the backend contains no
// evaluation logic that would have to be reimplemented for each.
//
// WHY MATERIALS ARE CHANNEL BAGS. Part 34 lists eighteen inputs (base colour, emission, opacity,
// roughness, metallic, normal, transmission, IOR, ...). They are stored as a map of named field
// channels rather than as fixed properties, for the reason that decides most of this file's shape: a
// backend supports a SUBSET. three.js sprites honour colour/opacity/emission and ignore IOR; Roblox
// honours fewer still. A channel bag lets a material carry everything and lets each backend report
// what it dropped (Part 56/57), instead of the material being defined by the poorest backend.
//
// WHAT IS NOT HERE. Volume rendering (Part 35) needs raymarching. The `volume` type is declared
// `implemented: false`, so registry.js mechanically refuses to register a Volume Renderer node — the
// button cannot exist by accident. Same for Decal, which needs projected-texture support the preview
// renderer does not have.

import * as V from './values.js';
import * as F from './fields.js';
import * as GEO from './geometry.js';

// ---------------------------------------------------------------- materials
// Part 34's input list. `components` is how wide the channel is; `dflt` is what a backend uses when
// the material does not carry it.
export const MATERIAL_CHANNELS = {
  baseColor: { components: 4, dflt: [1, 1, 1, 1], label: 'Base colour' },
  emission: { components: 4, dflt: [0, 0, 0, 1], label: 'Emission' },
  opacity: { components: 1, dflt: 1, label: 'Opacity' },
  roughness: { components: 1, dflt: 0.5, label: 'Roughness' },
  metallic: { components: 1, dflt: 0, label: 'Metallic' },
  specular: { components: 1, dflt: 0.5, label: 'Specular' },
  normal: { components: 3, dflt: [0, 0, 1], label: 'Normal' },
  height: { components: 1, dflt: 0, label: 'Height' },
  transmission: { components: 1, dflt: 0, label: 'Transmission' },
  refraction: { components: 1, dflt: 0, label: 'Refraction' },
  ior: { components: 1, dflt: 1.45, label: 'Index of refraction' },
  absorption: { components: 1, dflt: 0, label: 'Absorption' },
  scattering: { components: 1, dflt: 0, label: 'Scattering' },
  fresnel: { components: 1, dflt: 0, label: 'Fresnel' },
  ambientOcclusion: { components: 1, dflt: 1, label: 'Ambient occlusion' },
};

export const BLEND_MODES = ['normal', 'additive', 'multiply', 'screen'];

// What a backend can actually honour. Kept here rather than in the backend so the export report and
// the material node's own documentation read from one table (Part 56/57): a channel silently ignored
// by a backend is the kind of thing that turns into "why is my glass not refracting".
export const BACKEND_SUPPORT = {
  preview: {
    label: 'Studio preview',
    native: ['baseColor', 'emission', 'opacity'],
    approximated: ['roughness', 'metallic', 'specular', 'normal', 'fresnel', 'ambientOcclusion'],
    unsupported: ['height', 'transmission', 'refraction', 'ior', 'absorption', 'scattering'],
  },
  roblox: {
    label: 'Roblox',
    native: ['baseColor', 'opacity'],
    approximated: ['emission', 'roughness', 'metallic', 'normal'],
    unsupported: ['height', 'transmission', 'refraction', 'ior', 'absorption', 'scattering', 'specular', 'fresnel', 'ambientOcclusion'],
  },
};

// `settings` may itself BE a material — that is how a node layers extra channels onto an incoming one
// (Advanced Material Channels does exactly this). So its own `channels` and `__material` keys are
// destructured away before the rest is spread: leaving them in put the base material's channels back
// over the merged set, silently discarding whatever the caller had just added. The failure looked like
// the node doing nothing at all, with no diagnostic, which is why the exclusion is explicit here
// rather than being every caller's job to remember.
export function newMaterial(channels = {}, settings = {}) {
  const { channels: _ignored, __material: _alsoIgnored, ...rest } = settings;
  return {
    ...rest,
    __material: true,
    channels: { ...channels },
    blend: BLEND_MODES.includes(settings.blend) ? settings.blend : 'normal',
    doubleSided: settings.doubleSided !== false,
    depthWrite: !!settings.depthWrite,
    texture: settings.texture || null,
  };
}
export const isMaterial = (v) => !!v && v.__material === true;

// The material a command falls back to when none is wired: plain white, so an unwired render node
// draws something visible rather than nothing. An invisible default would read as "the renderer is
// broken" when it actually means "no material yet".
export const DEFAULT_MATERIAL = newMaterial({});

// ---------------------------------------------------------------- render commands
export const RENDER_KINDS = ['sprite', 'mesh', 'point', 'line', 'trail', 'ribbon', 'beam', 'light'];
export const FACING_MODES = ['camera', 'velocity', 'axis', 'normal', 'fixed'];

export function newRenderCommand(kind, source, material, settings = {}) {
  return {
    __render: true,
    kind,
    source: source || null,
    material: isMaterial(material) ? material : DEFAULT_MATERIAL,
    settings: { ...settings },
  };
}
export const isRenderCommand = (v) => !!v && v.__render === true;

// Several commands as one value, so a Render Output can take a multi-input and an effect can layer a
// sprite pass, a trail pass and a light pass without a node per combination.
export function flattenCommands(list) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (isRenderCommand(v)) out.push(v);
  };
  walk(list);
  return out;
}

// ---------------------------------------------------------------- the resolve pass
// Evaluate a material's channels over a domain into flat buffers. This is the only place fields are
// turned into pixels-worth-of-numbers, and it is deliberately allocation-light: one buffer per
// requested channel, filled in a single walk of the elements.
function resolveChannels(geometry, domain, material, wanted, count, extraCtx = {}) {
  const buffers = {};
  const walker = GEO.makeElementContext(geometry, domain, extraCtx);
  const specs = wanted.map((name) => {
    const meta = MATERIAL_CHANNELS[name];
    const comps = meta ? meta.components : 1;
    const field = material.channels[name];
    return { name, comps, field, dflt: meta ? meta.dflt : 0, present: field !== undefined };
  });
  for (const s of specs) buffers[s.name] = new Float32Array(count * s.comps);

  for (let k = 0; k < count; k++) {
    const ctx = walker.at(k);
    for (const s of specs) {
      const buf = buffers[s.name];
      const base = k * s.comps;
      const value = s.present ? F.sampleAny(s.field, ctx) : s.dflt;
      if (s.comps === 1) {
        buf[base] = typeof value === 'boolean' ? (value ? 1 : 0) : (Number(Array.isArray(value) ? value[0] : value) || 0);
      } else {
        for (let c = 0; c < s.comps; c++) {
          buf[base + c] = Number(Array.isArray(value) ? value[c] : value) || 0;
        }
        // A colour given as a 3-vector is opaque, not transparent. Defaulting alpha to 0 here would
        // make every rgb-only material invisible, which is a genuinely baffling failure.
        if (s.comps === 4 && Array.isArray(value) && value.length === 3) buf[base + 3] = 1;
      }
    }
  }
  return buffers;
}

// Read a per-element scalar from a settings value that may be a field, a number, or absent.
function scalarBuffer(geometry, domain, value, count, dflt, extraCtx = {}) {
  const buf = new Float32Array(count);
  if (value === undefined || value === null) { buf.fill(dflt); return buf; }
  if (!F.isField(value)) { buf.fill(Number(value) || 0); return buf; }
  if (F.isConstantField(value)) { buf.fill(Number(value.constant) || 0); return buf; }
  const walker = GEO.makeElementContext(geometry, domain, extraCtx);
  for (let k = 0; k < count; k++) buf[k] = Number(F.sampleAny(value, walker.at(k))) || 0;
  return buf;
}

function vectorBuffer(geometry, domain, value, count, dflt, comps, extraCtx = {}) {
  const buf = new Float32Array(count * comps);
  const fill = (v) => {
    for (let k = 0; k < count; k++) for (let c = 0; c < comps; c++) buf[k * comps + c] = Number(v[c]) || 0;
  };
  if (value === undefined || value === null) { fill(dflt); return buf; }
  if (!F.isField(value)) { fill(V.toComponents(comps === 3 ? 'vector3' : 'vector4', value)); return buf; }
  const walker = GEO.makeElementContext(geometry, domain, extraCtx);
  for (let k = 0; k < count; k++) {
    const v = V.toComponents(comps === 3 ? 'vector3' : 'vector4', F.sampleAny(value, walker.at(k)));
    for (let c = 0; c < comps; c++) buf[k * comps + c] = v[c];
  }
  return buf;
}

// --- sprites / billboards / points (Part 37)
export function resolveSprites(cmd, opts = {}) {
  const geo = cmd.source;
  const count = GEO.pointCount(geo);
  const ctx = { time: opts.time || 0, frame: opts.frame || 0 };
  if (!count) return { kind: cmd.kind, count: 0, material: cmd.material, settings: cmd.settings };

  const channels = resolveChannels(geo, 'point', cmd.material, ['baseColor', 'emission', 'opacity'], count, ctx);
  const s = cmd.settings;

  const out = {
    kind: cmd.kind,
    count,
    positions: geo.points.attrs.position.data,
    colors: channels.baseColor,
    emission: channels.emission,
    opacity: channels.opacity,
    sizes: scalarBuffer(geo, 'point', s.size, count, 1, ctx),
    rotations: scalarBuffer(geo, 'point', s.rotation, count, 0, ctx),
    material: cmd.material,
    settings: s,
    facing: FACING_MODES.includes(s.facing) ? s.facing : 'camera',
  };

  // Velocity facing needs the velocity to reach the backend, since orienting a quad is the backend's
  // job (it owns the camera). Passed through rather than resolved into a rotation here, because a
  // rotation about the view axis is not enough to describe it.
  if (out.facing === 'velocity' && GEO.hasAttr(geo.points, 'velocity')) {
    out.velocities = geo.points.attrs.velocity.data;
  }
  // Stable per-element identity, when the source carries one. A live renderer does not need it — it
  // pools by array position — but a BAKE does: a cache keyed by array position is worthless, because
  // particles die and the table compacts, so slot 3 is a different particle every frame and replaying
  // it makes every particle jump between paths. See bake.js.
  if (GEO.hasAttr(geo.points, 'id')) out.ids = geo.points.attrs.id.data;
  if (GEO.hasAttr(geo.points, 'life')) out.lives = geo.points.attrs.life.data;
  if (out.facing === 'normal' && GEO.hasAttr(geo.points, 'normal')) {
    out.normals = geo.points.attrs.normal.data;
  }

  // Flipbook: which atlas cell each element is on this frame. Resolved here because it is a pure
  // function of the element's own age and the sheet layout, and a backend should not need to know
  // what "age" means.
  if (s.flipbookColumns > 1 || s.flipbookRows > 1) {
    const cols = Math.max(1, Math.round(s.flipbookColumns || 1));
    const rows = Math.max(1, Math.round(s.flipbookRows || 1));
    const frames = cols * rows;
    const cells = new Float32Array(count);
    const walker = GEO.makeElementContext(geo, 'point', ctx);
    for (let k = 0; k < count; k++) {
      const c = walker.at(k);
      const t = s.flipbookMode === 'life' ? (Number(c.life) || 0) : ((Number(c.age) || 0) * (s.flipbookFps || 24)) / frames;
      const idx = s.flipbookLoop === false
        ? Math.min(frames - 1, Math.floor(V.clamp01(t) * frames))
        : Math.floor((t - Math.floor(t)) * frames) % frames;
      cells[k] = idx;
    }
    out.flipbook = { columns: cols, rows, cells };
  }
  return out;
}

// --- meshes and instances
export function resolveMeshes(cmd, opts = {}) {
  const src = cmd.source;
  const ctx = { time: opts.time || 0, frame: opts.frame || 0 };

  // An instance set draws one transform per instance; a plain geometry draws once at the identity.
  if (src && src.__instanceSet === true) {
    const count = src.table.count;
    const geo = { __geometry: true, points: src.table, faces: null, curves: null };
    const channels = count ? resolveChannels(geo, 'point', cmd.material, ['baseColor', 'emission', 'opacity'], count, ctx) : {};
    return {
      kind: 'mesh', count,
      instanced: true,
      sources: src.sources,
      positions: count ? src.table.attrs.position.data : new Float32Array(0),
      rotations: count ? src.table.attrs.rotation.data : new Float32Array(0),
      scales: count ? src.table.attrs.scale.data : new Float32Array(0),
      sourceIndex: count ? src.table.attrs.source.data : new Float32Array(0),
      colors: channels.baseColor || new Float32Array(0),
      emission: channels.emission || new Float32Array(0),
      opacity: channels.opacity || new Float32Array(0),
      material: cmd.material, settings: cmd.settings,
    };
  }

  if (!GEO.isGeometry(src) || !GEO.faceCount(src)) {
    return { kind: 'mesh', count: 0, instanced: false, material: cmd.material, settings: cmd.settings };
  }
  const count = GEO.pointCount(src);
  const channels = resolveChannels(src, 'point', cmd.material, ['baseColor', 'emission', 'opacity'], count, ctx);
  return {
    kind: 'mesh', count: 1, instanced: false,
    geometry: src,
    positions: src.points.attrs.position.data,
    normals: GEO.hasAttr(src.points, 'normal') ? src.points.attrs.normal.data : null,
    uvs: GEO.hasAttr(src.points, 'uv') ? src.points.attrs.uv.data : null,
    indices: src.faces.corners,
    vertexColors: channels.baseColor,
    emission: channels.emission,
    opacity: channels.opacity,
    material: cmd.material, settings: cmd.settings,
  };
}

// --- lines / trails / ribbons / beams (Part 38)
// All four are the same data — a set of polylines with a per-vertex width and colour — differing only
// in where the polylines come from. Resolving them through one function is why Width Curve, Colour
// Gradient, Twist and Texture Flow work identically on every one of them, rather than each renderer
// growing its own subset.
export function resolveStrips(cmd, opts = {}) {
  const src = cmd.source;
  const ctx = { time: opts.time || 0, frame: opts.frame || 0 };
  const s = cmd.settings;
  if (!GEO.isGeometry(src) || !GEO.curveCount(src)) {
    return { kind: cmd.kind, strips: [], material: cmd.material, settings: s };
  }

  const strips = [];
  const smoothing = Math.max(0, Math.min(1, s.smoothing || 0));
  for (let c = 0; c < GEO.curveCount(src); c++) {
    const [from, to] = GEO.curveSpan(src, c);
    const n = to - from;
    if (n < 2) continue;
    const cum = GEO.curveLengths(src, c);
    const total = cum[cum.length - 1] || 1;

    const positions = new Float32Array(n * 3);
    const widths = new Float32Array(n);
    const colors = new Float32Array(n * 4);
    const alongs = new Float32Array(n);

    const walker = GEO.makeElementContext(src, 'point', ctx);
    for (let k = 0; k < n; k++) {
      const row = from + k;
      const along = cum[Math.min(k, cum.length - 1)] / total;
      alongs[k] = along;

      const p = GEO.readAttr(src.points, 'position', row, [0, 0, 0]);
      positions[k * 3] = p[0]; positions[k * 3 + 1] = p[1]; positions[k * 3 + 2] = p[2];

      // The strip's own parameter is exposed as `uv.x` and as the `along` attribute, so a width curve
      // or a colour gradient can be driven by position along the strip using the ordinary curve and
      // gradient nodes rather than a bespoke "width over length" control.
      const ectx = walker.at(row);
      ectx.uv = [along, 0];
      if (!ectx.attributes) ectx.attributes = Object.create(null);
      ectx.attributes.along = along;

      widths[k] = s.width === undefined ? 0.1 : Number(F.sampleAny(s.width, ectx)) || 0;
      const col = cmd.material.channels.baseColor !== undefined
        ? V.toComponents('color', F.sampleAny(cmd.material.channels.baseColor, ectx))
        : [1, 1, 1, 1];
      const alpha = cmd.material.channels.opacity !== undefined
        ? Number(F.sampleAny(cmd.material.channels.opacity, ectx))
        : 1;
      colors[k * 4] = col[0]; colors[k * 4 + 1] = col[1]; colors[k * 4 + 2] = col[2];
      colors[k * 4 + 3] = (col[3] === undefined ? 1 : col[3]) * (Number.isFinite(alpha) ? alpha : 1);
    }

    // Chaikin-style smoothing on the positions, in place across interior vertices. Cheap, and it is
    // what turns a noise-displaced lightning polyline from a zigzag of hard corners into a bolt.
    if (smoothing > 0) {
      for (let pass = 0; pass < 2; pass++) {
        for (let k = 1; k < n - 1; k++) {
          for (let a = 0; a < 3; a++) {
            const prev = positions[(k - 1) * 3 + a], cur = positions[k * 3 + a], next = positions[(k + 1) * 3 + a];
            positions[k * 3 + a] = cur + ((prev + next) / 2 - cur) * smoothing * 0.5;
          }
        }
      }
    }

    strips.push({
      count: n, positions, widths, colors, alongs,
      cyclic: !!src.curves.cyclic[c],
      length: total,
    });
  }
  return { kind: cmd.kind, strips, material: cmd.material, settings: s };
}

// --- lights (Part 39)
export function resolveLights(cmd, opts = {}) {
  const src = cmd.source;
  const ctx = { time: opts.time || 0, frame: opts.frame || 0 };
  const s = cmd.settings;
  const count = GEO.isGeometry(src) ? GEO.pointCount(src) : 0;

  // No geometry means one light at the settings' own position — the common case of a single flash.
  if (!count) {
    const one = F.newSampleContext(ctx);
    return {
      kind: 'light', count: 1,
      positions: Float32Array.from(V.toComponents('vector3', F.sampleAny(s.position, one) || [0, 0, 0])),
      colors: Float32Array.from(V.toComponents('color', F.sampleAny(cmd.material.channels.emission ?? cmd.material.channels.baseColor, one) || [1, 1, 1, 1])),
      intensities: Float32Array.from([Number(F.sampleAny(s.intensity, one)) || 0]),
      ranges: Float32Array.from([Number(F.sampleAny(s.range, one)) || 8]),
      settings: s, material: cmd.material,
    };
  }
  const channel = cmd.material.channels.emission ?? cmd.material.channels.baseColor;
  return {
    kind: 'light', count,
    positions: src.points.attrs.position.data,
    colors: vectorBuffer(src, 'point', channel, count, [1, 1, 1, 1], 4, ctx),
    intensities: scalarBuffer(src, 'point', s.intensity, count, 1, ctx),
    ranges: scalarBuffer(src, 'point', s.range, count, 8, ctx),
    settings: s, material: cmd.material,
  };
}

// ---------------------------------------------------------------- the scene
// Resolve every command into a draw list. This is what a backend receives, and it is pure data: no
// three.js types, no GL calls, nothing a Roblox exporter or a bake could not also read.
export function resolveScene(commands, opts = {}) {
  const list = flattenCommands(commands);
  const draws = [];
  const stats = { commands: list.length, sprites: 0, meshes: 0, instances: 0, stripVertices: 0, lights: 0, triangles: 0 };

  for (const cmd of list) {
    switch (cmd.kind) {
      case 'sprite':
      case 'point': {
        const d = resolveSprites(cmd, opts);
        stats.sprites += d.count;
        draws.push(d);
        break;
      }
      case 'mesh': {
        const d = resolveMeshes(cmd, opts);
        if (d.instanced) { stats.instances += d.count; } else if (d.count) { stats.meshes += 1; }
        if (d.indices) stats.triangles += d.indices.length / 3;
        draws.push(d);
        break;
      }
      case 'line': case 'trail': case 'ribbon': case 'beam': {
        const d = resolveStrips(cmd, opts);
        for (const strip of d.strips) stats.stripVertices += strip.count;
        draws.push(d);
        break;
      }
      case 'light': {
        const d = resolveLights(cmd, opts);
        stats.lights += d.count;
        draws.push(d);
        break;
      }
      default:
        break;
    }
  }
  return { draws, stats };
}

// ---------------------------------------------------------------- backend compatibility (Part 57)
// What a given backend will and will not honour about a scene. Built from BACKEND_SUPPORT plus the
// commands' own kinds, so the report cannot drift from what the backend actually does.
const KIND_SUPPORT = {
  preview: { native: ['sprite', 'point', 'mesh', 'light'], approximated: ['line', 'trail', 'ribbon', 'beam'], unsupported: [] },
  roblox: { native: ['sprite', 'point'], approximated: ['mesh', 'light', 'beam', 'trail'], unsupported: ['ribbon', 'line'] },
};

export function backendReport(commands, backend = 'preview') {
  const support = BACKEND_SUPPORT[backend] || BACKEND_SUPPORT.preview;
  const kinds = KIND_SUPPORT[backend] || KIND_SUPPORT.preview;
  const list = flattenCommands(commands);
  const rows = [];

  for (const cmd of list) {
    const level = kinds.native.includes(cmd.kind) ? 'native'
      : kinds.approximated.includes(cmd.kind) ? 'approximated'
        : 'unsupported';
    const dropped = [], approximated = [];
    for (const name of Object.keys(cmd.material.channels)) {
      if (support.unsupported.includes(name)) dropped.push(name);
      else if (support.approximated.includes(name)) approximated.push(name);
    }
    rows.push({ kind: cmd.kind, level, droppedChannels: dropped, approximatedChannels: approximated });
  }

  const counts = rows.reduce((a, r) => ({ ...a, [r.level]: (a[r.level] || 0) + 1 }), {});
  return {
    backend: support.label,
    rows,
    counts,
    ok: !rows.some((r) => r.level === 'unsupported' || r.droppedChannels.length),
  };
}
