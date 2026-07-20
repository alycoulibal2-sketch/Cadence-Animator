// Bake an effect document into a self-contained Roblox LocalScript, following the export
// contract in docs/vfx-studio.md: per-frame values pre-baked into FRAMES tables (never re-
// implementing curves/expressions in Luau), an elapsed-wall-clock Heartbeat driver (never a
// task.wait step loop), Rate-then-Enabled ordering, Emit(n) bursts re-fired per loop iteration,
// and the degrade table for everything Roblox can't express (motions, emission shapes, dropped
// modifiers, hard clamps). The preview→game contract is a STATISTICAL match: per-particle
// positions differ, the effect reads the same.
//
// Scalar layers (shape/light/screen) are baked by literally sampling the engine per frame —
// modifiers therefore export exactly as previewed, because the numbers come from the same
// sampleEffect the preview draws. Emitter layers bake parameter channels (rate/speed/lifetime/
// spread) via the same resolveProp the engine uses, plus explicit folds: glowBoost → size/
// transparency multipliers, wind → Acceleration. fadeInOut on an EMITTER is the one deliberate
// exception to "exports exactly as previewed": the preview fades PER-PARTICLE OPACITY (constant
// density, particles fade transparent), but Roblox's ParticleEmitter has no way to rewrite a
// live particle's transparency after it spawns — only Rate can be scheduled — so the export
// approximates the same visual arc (sparse -> dense -> sparse) via a rate envelope instead
// (fewer, fully-opaque particles during the fade rather than many half-transparent ones). This
// is the more faithful of the two viable approximations given Roblox's constraints, not a bug;
// bakeEmitterChannels below flags it with an explicit fidelity note.

import { sampleEffect } from './effectEngine.js';
import { resolveProp } from './effectModel.js';
import { shapePolyline } from './effectShapes.js';

const ROBLOX = { rate: 500, lifetime: 20, size: 10, lightRange: 60, pathAttachments: 12, beamPoints: 16 };

const TEXTURES = {
  glow: 'rbxasset://textures/particles/smoke_main.dds',
  smoke: 'rbxasset://textures/particles/smoke_main.dds',
  ring: 'rbxasset://textures/particles/smoke_main.dds',
  square: 'rbxasset://textures/particles/smoke_main.dds',
  leaf: 'rbxasset://textures/particles/smoke_main.dds',
  spark: 'rbxasset://textures/particles/sparkles_main.dds',
  star: 'rbxasset://textures/particles/sparkles_main.dds',
};

const n = (v) => {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
const c3 = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  const v = m ? parseInt(m[1], 16) : 0xffffff;
  return `Color3.fromRGB(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255})`;
};
const c3rgb = (rgb) => `Color3.fromRGB(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)})`;
const luaStr = (s) => `"${String(s).replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\n')}"`;
const vecTable = (arr) => `{${arr.map(n).join(', ')}}`;

function envelope(progress, fadeIn, fadeOut) {
  let v = 1;
  if (fadeIn > 0 && progress < fadeIn) v = Math.min(v, progress / fadeIn);
  if (fadeOut > 0 && progress > 1 - fadeOut) v = Math.min(v, (1 - progress) / fadeOut);
  return Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------------- emitter channel baking
function bakeEmitterChannels(layer, fps) {
  const len = layer.clip.len;
  const fade = layer.modifiers.find((m) => m.enabled && m.type === 'fadeInOut');
  const varying = ['rate', 'speed', 'lifetime', 'spreadDegrees'].filter(
    (p) => (layer.curves[p]?.length || layer.exprs?.[p]) || (p === 'rate' && fade));
  if (!varying.length) return null;
  const rows = { rate: [], speed: [], lifetime: [], spread: [] };
  for (let lf = 0; lf < len; lf++) {
    const env = fade ? envelope(len > 0 ? lf / len : 0, fade.props.fadeIn ?? 0.15, fade.props.fadeOut ?? 0.3) : 1;
    rows.rate.push(Math.min(ROBLOX.rate, Math.max(0, resolveProp(layer, 'rate', lf, fps) * env)));
    rows.speed.push(resolveProp(layer, 'speed', lf, fps));
    rows.lifetime.push(Math.min(ROBLOX.lifetime, Math.max(0.05, resolveProp(layer, 'lifetime', lf, fps))));
    rows.spread.push(Math.max(0, Math.min(180, resolveProp(layer, 'spreadDegrees', lf, fps))));
  }
  return rows;
}

// Motion → Roblox degrade mapping (docs/vfx-studio.md).
function motionMapping(layer) {
  const p = layer.props;
  switch (p.motion || 'cone') {
    case 'burst': return { spread: 'Vector2.new(180, 180)', dir: 'Enum.NormalId.Top', accel: p.gravity, drag: 0, note: null };
    case 'rise': return { spread: `Vector2.new(${n(Math.min(30, p.spreadDegrees))}, ${n(Math.min(30, p.spreadDegrees))})`, dir: 'Enum.NormalId.Top', accel: p.gravity, drag: 0, note: 'per-particle sway dropped; "up" follows this effect\'s own placement rotation, not necessarily true world-up, if it\'s attached to a rotated part' };
    case 'fall': return { spread: `Vector2.new(${n(Math.min(30, p.spreadDegrees))}, ${n(Math.min(30, p.spreadDegrees))})`, dir: 'Enum.NormalId.Bottom', accel: p.gravity, drag: 0, note: 'per-particle sway dropped; "down" follows this effect\'s own placement rotation, not necessarily true world-down, if it\'s attached to a rotated part' };
    case 'orbit': return { spread: 'Vector2.new(180, 180)', dir: 'Enum.NormalId.Top', accel: p.gravity, drag: 2, speedOverride: Math.max(0.3, Math.abs(p.speed) * 0.25), note: 'orbit approximated as slow drift' };
    case 'ambient': return { spread: 'Vector2.new(180, 180)', dir: 'Enum.NormalId.Top', accel: p.gravity, drag: 2, speedOverride: Math.max(0.1, Math.abs(p.speed) * 0.3), note: 'ambient jitter approximated as slow drift' };
    default: return { spread: `Vector2.new(${n(p.spreadDegrees)}, ${n(p.spreadDegrees)})`, dir: 'Enum.NormalId.Top', accel: p.gravity, drag: 0, note: null };
  }
}

// Emission shape → host geometry. Returns { kind: 'point' | 'part', partProps?, shapeEnum?,
// style?, attachOffsets? } — path shapes fan out into point attachments along the polyline.
function emissionMapping(shape) {
  if (!shape || shape.kind === 'point') return { kind: 'point' };
  switch (shape.kind) {
    case 'sphere': return { kind: 'part', size: [shape.radius * 2, shape.radius * 2, shape.radius * 2], shapeEnum: 'Sphere', style: 'Volume' };
    case 'rect': return { kind: 'part', size: [shape.width, 0.2, shape.depth], shapeEnum: 'Box', style: 'Volume' };
    case 'circle': case 'ring': return { kind: 'part', size: [shape.radius * 2, 0.2, shape.radius * 2], shapeEnum: 'Cylinder', style: 'Surface' };
    case 'cylinder': return { kind: 'part', size: [shape.radius * 2, shape.height, shape.radius * 2], shapeEnum: 'Cylinder', style: 'Volume' };
    default: {
      const pts = shapePolyline(shape, ROBLOX.pathAttachments - 1);
      return { kind: 'multi', offsets: pts };
    }
  }
}

// ---------------------------------------------------------------- the generator
export function buildEffectLua(doc) {
  const fps = doc.fps || 30;
  const notes = [];
  const L = [];
  const layers = doc.layers.filter((l) => l.enabled);
  const disabled = doc.layers.filter((l) => !l.enabled);
  if (disabled.length) notes.push(`skipped disabled layer(s): ${disabled.map((l) => l.name).join(', ')}`);

  L.push(`-- ${doc.name} — exported from Cadence VFX Studio`);
  L.push('-- Self-contained LocalScript: parent it to a BasePart (plays at that part) or anywhere');
  L.push('-- client-side (plays at the workspace origin). Fire the "PlayEffect" BindableEvent that');
  L.push('-- appears under this script to play it, or set AUTOPLAY = true.');
  L.push('-- The in-game effect is a statistical match of the studio preview: Roblox rolls its own');
  L.push('-- per-particle randomness, so individual particles differ while the effect reads the same.');
  L.push('');
  L.push('local AUTOPLAY = false');
  L.push(`local FPS = ${fps}`);
  L.push(`local DURATION = ${doc.duration} -- frames`);
  L.push(`local LOOP = ${doc.loop ? 'true' : 'false'}`);
  L.push('');
  L.push('local RunService = game:GetService("RunService")');
  L.push('local Players = game:GetService("Players")');
  L.push('local Debris = game:GetService("Debris")');
  L.push('');
  L.push('local originCF = script.Parent and script.Parent:IsA("BasePart") and script.Parent.CFrame or CFrame.new(0, 3, 0)');
  L.push('local rig = Instance.new("Folder")');
  L.push(`rig.Name = ${luaStr(doc.name + ' (VFX)')}`);
  L.push('rig.Parent = workspace');
  L.push('local function hostPart(size, cf)');
  L.push('  local p = Instance.new("Part")');
  L.push('  p.Anchored = true; p.CanCollide = false; p.CanQuery = false; p.CanTouch = false');
  L.push('  p.Transparency = 1; p.Size = size; p.CFrame = cf; p.Parent = rig');
  L.push('  return p');
  L.push('end');
  L.push('local anchor = hostPart(Vector3.new(0.2, 0.2, 0.2), originCF)');
  L.push('');
  L.push('local LAYERS = {} -- populated below; each entry drives itself from the frame clock');
  L.push('');

  let idx = 0;
  for (const layer of layers) {
    idx++;
    const id = `L${idx}`;
    const { start, len, loop } = layer.clip;
    L.push(`-- ============================== ${layer.name} (${layer.type})`);
    if (layer.type === 'emitter') emitLuaEmitter(L, notes, layer, id, doc, fps);
    else if (layer.type === 'shape') emitLuaShape(L, notes, layer, id, doc, fps);
    else if (layer.type === 'light') emitLuaLight(L, notes, layer, id, doc, fps);
    else if (layer.type === 'screen') emitLuaScreen(L, notes, layer, id, doc, fps);
    else if (layer.type === 'shake') emitLuaShake(L, notes, layer, id, doc, fps);
    else if (layer.type === 'sound') emitLuaSound(L, notes, layer, id, doc, fps);
    L.push(`LAYERS[#LAYERS + 1] = { name = ${luaStr(layer.name)}, start = ${start}, len = ${len}, loop = ${loop ? 'true' : 'false'}, update = ${id}_update, stop = ${id}_stop }`);
    L.push('');
  }

  // driver
  L.push('-- ============================== driver (wall-clock, never a task.wait step loop)');
  L.push('local playing = false');
  L.push('local function stopAll()');
  L.push('  for _, layer in ipairs(LAYERS) do layer.stop() end');
  L.push('end');
  L.push('local function play()');
  L.push('  if playing then return end');
  L.push('  playing = true');
  L.push('  local t0 = os.clock()');
  L.push('  local iteration = {}');
  L.push('  local conn');
  L.push('  conn = RunService.Heartbeat:Connect(function()');
  L.push('    local f = (os.clock() - t0) * FPS');
  L.push('    if f >= DURATION then');
  L.push('      if LOOP then');
  L.push('        t0 = os.clock(); iteration = {}; f = 0');
  L.push('      else');
  L.push('        conn:Disconnect(); stopAll(); playing = false; return');
  L.push('      end');
  L.push('    end');
  L.push('    for i, layer in ipairs(LAYERS) do');
  L.push('      local active, lf, iter');
  L.push('      if f < layer.start then');
  L.push('        active = false; lf = 0; iter = -1');
  L.push('      elseif layer.loop then');
  L.push('        active = true; lf = (f - layer.start) % layer.len; iter = math.floor((f - layer.start) / layer.len)');
  L.push('      else');
  L.push('        active = f < layer.start + layer.len; lf = math.min(f - layer.start, layer.len - 1); iter = 0');
  L.push('      end');
  L.push('      local firstOfIteration = active and iteration[i] ~= iter');
  L.push('      if firstOfIteration then iteration[i] = iter end');
  L.push('      layer.update(active, lf, firstOfIteration)');
  L.push('    end');
  L.push('  end)');
  L.push('end');
  L.push('');
  L.push('local trigger = Instance.new("BindableEvent")');
  L.push('trigger.Name = "PlayEffect"');
  L.push('trigger.Parent = script');
  L.push('trigger.Event:Connect(play)');
  L.push('if AUTOPLAY then play() end');

  return { lua: L.join('\n'), notes };
}

// ---------------------------------------------------------------- emitters
function emitLuaEmitter(L, notes, layer, id, doc, fps) {
  const p = layer.props;
  const motion = motionMapping(layer);
  if (motion.note) notes.push(`${layer.name}: ${motion.note}`);
  const emission = emissionMapping(p.emissionShape);
  const glowMod = layer.modifiers.find((m) => m.enabled && m.type === 'glowBoost');
  const sizeMul = glowMod ? 1 + (glowMod.props.amount ?? 0.5) * 0.5 : 1;
  const wind = layer.modifiers.find((m) => m.enabled && m.type === 'wind');
  const windAccel = wind ? (() => {
    const d = wind.props.direction || [1, 0, 0];
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    const s = wind.props.strength ?? 1.5;
    return [d[0] / dl * s, d[1] / dl * s, d[2] / dl * s];
  })() : [0, 0, 0];
  for (const m of layer.modifiers) {
    if (m.enabled && (m.type === 'noise' || m.type === 'flicker' || m.type === 'orbit')) {
      notes.push(`${layer.name}: modifier "${m.type}" is preview-only (dropped on export)`);
    }
  }

  const texture = p.textureId?.trim() || TEXTURES[p.shape] || TEXTURES.glow;
  if (!p.textureId?.trim() && p.shape !== 'smoke') notes.push(`${layer.name}: sprite "${p.shape}" uses a built-in placeholder texture — set a Roblox texture override for an exact look`);
  const size0 = Math.min(ROBLOX.size, Math.max(0.01, p.sizeStart * sizeMul));
  const size1 = Math.min(ROBLOX.size, Math.max(0.01, p.sizeEnd * sizeMul));
  const off = p.offset || [0, 0, 0];

  const channels = bakeEmitterChannels(layer, fps);
  if (layer.modifiers.some((m) => m.enabled && m.type === 'fadeInOut')) {
    notes.push(`${layer.name}: "Fade in/out" approximates via a rate envelope (fewer, fully-opaque particles during the fade) rather than a per-particle opacity fade — Roblox cannot rewrite a live particle's transparency after it spawns`);
  }
  const emitterCount = emission.kind === 'multi' ? emission.offsets.length : 1;
  if (emission.kind === 'multi') notes.push(`${layer.name}: emission shape "${p.emissionShape.kind}" fans out into ${emitterCount} point emitters`);

  L.push(`local ${id}_emitters = {}`);
  if (emission.kind === 'part') {
    L.push(`local ${id}_host = hostPart(Vector3.new(${vecArgs(emission.size)}), originCF * CFrame.new(${vecArgs(off)}))`);
  }
  L.push(`do`);
  const hostExpr = emission.kind === 'part' ? `${id}_host` : 'nil';
  L.push(`  local positions = ${emission.kind === 'multi'
    ? `{ ${emission.offsets.map((o) => `Vector3.new(${vecArgs([o[0] + off[0], o[1] + off[1], o[2] + off[2]])})`).join(', ')} }`
    : `{ Vector3.new(${vecArgs(off)}) }`}`);
  L.push('  for i, pos in ipairs(positions) do');
  L.push(`    local host = ${hostExpr}`);
  L.push('    local parentInst');
  L.push('    if host then parentInst = host else');
  L.push('      local a = Instance.new("Attachment"); a.Position = pos; a.Parent = anchor; parentInst = a');
  L.push('    end');
  L.push('    local e = Instance.new("ParticleEmitter")');
  L.push(`    e.Texture = ${luaStr(texture)}`);
  // SKETCH IT 2.0: a >=2-stop ramp exports a real multi-keypoint sequence — Roblox's native
  // ColorSequence/NumberSequence already support arbitrary stop counts, so this is strictly more
  // faithful than the plain start/end pair below, never a regression. sanitizeRamp() guarantees
  // the first/last stop sit at exactly u=0/u=1, which Roblox's Keypoint API requires.
  if (Array.isArray(p.colorRamp) && p.colorRamp.length >= 2) {
    const kps = p.colorRamp.map((s) => `ColorSequenceKeypoint.new(${n(s.u)}, ${c3(s.v)})`).join(', ');
    L.push(`    e.Color = ColorSequence.new({ ${kps} })`);
  } else {
    L.push(`    e.Color = ColorSequence.new(${c3(p.colorStart)}, ${c3(p.colorEnd)})`);
  }
  L.push(`    e.Size = NumberSequence.new(${n(size0)}, ${n(size1)})`);
  if (Array.isArray(p.densityRamp) && p.densityRamp.length >= 2) {
    // densityRamp.v is OPACITY (0=invisible..1=opaque, matching its inspector label); Roblox's
    // Transparency is the inverse convention (0=opaque..1=invisible).
    const kps = p.densityRamp.map((s) => `NumberSequenceKeypoint.new(${n(s.u)}, ${n(Math.max(0, Math.min(1, 1 - s.v)))})`).join(', ');
    L.push(`    e.Transparency = NumberSequence.new({ ${kps} })`);
  } else {
    L.push(`    e.Transparency = NumberSequence.new(${n(Math.max(0, Math.min(1, p.transparencyStart)))}, ${n(Math.max(0, Math.min(1, p.transparencyEnd)))})`);
  }
  L.push(`    e.Lifetime = NumberRange.new(${n(Math.min(ROBLOX.lifetime, Math.max(0.05, p.lifetime)))})`);
  L.push(`    e.Speed = NumberRange.new(${n(motion.speedOverride ?? p.speed)})`);
  L.push(`    e.SpreadAngle = ${typeof motion.spread === 'string' ? motion.spread : motion.spread}`);
  L.push(`    e.EmissionDirection = ${motion.dir}`);
  L.push(`    e.Acceleration = Vector3.new(${vecArgs([windAccel[0], (motion.accel ?? 0) + windAccel[1], windAccel[2]])})`);
  if (motion.drag) L.push(`    e.Drag = ${n(motion.drag)}`);
  if (emission.kind === 'part') L.push(`    e.Shape = Enum.ParticleEmitterShape.${emission.shapeEnum}; e.ShapeStyle = Enum.ParticleEmitterShapeStyle.${emission.style}`);
  L.push(`    e.LightEmission = ${p.blendMode === 'additive' ? '1' : '0'}`);
  L.push('    e.LightInfluence = 0 -- the studio preview is unlit; default 1 goes black at night');
  L.push(`    e.Rate = ${n(Math.min(ROBLOX.rate, Math.max(0, p.rate)) / emitterCount)}`);
  L.push('    e.Enabled = false');
  L.push('    e.Parent = parentInst');
  L.push(`    ${id}_emitters[i] = e`);
  L.push('  end');
  L.push('end');
  if (channels) {
    L.push(`local ${id}_rate = ${luaNumTable(channels.rate.map((v) => v / emitterCount))}`);
    L.push(`local ${id}_speed = ${luaNumTable(channels.speed)}`);
    L.push(`local ${id}_life = ${luaNumTable(channels.lifetime)}`);
    L.push(`local ${id}_spread = ${luaNumTable(channels.spread)}`);
  }
  L.push(`local function ${id}_update(active, lf, firstOfIteration)`);
  L.push(`  for _, e in ipairs(${id}_emitters) do`);
  if (channels) {
    L.push('    if active then');
    L.push(`      local i = math.clamp(math.floor(lf) + 1, 1, #${id}_rate)`);
    L.push(`      e.Rate = ${id}_rate[i] -- Rate before Enabled (write order matters at clip start)`);
    L.push(`      e.Speed = NumberRange.new(${id}_speed[i])`);
    L.push(`      e.Lifetime = NumberRange.new(${id}_life[i])`);
    if ((layer.props.motion || 'cone') === 'cone') L.push(`      e.SpreadAngle = Vector2.new(${id}_spread[i], ${id}_spread[i])`);
    L.push('    end');
  }
  L.push('    e.Enabled = active');
  if ((layer.props.burst || 0) > 0) {
    L.push(`    if firstOfIteration then e:Emit(${Math.round(layer.props.burst / emitterCount)}) end`);
  }
  L.push('  end');
  L.push('end');
  L.push(`local function ${id}_stop()`);
  L.push(`  for _, e in ipairs(${id}_emitters) do e.Enabled = false end`);
  L.push('end');
}

// ---------------------------------------------------------------- scalar bakes from the engine
// One pass of sampleEffect per frame, shared by all scalar layers of the doc — cached per doc.
const scalarBakeCache = new WeakMap();
function scalarBake(doc) {
  let bake = scalarBakeCache.get(doc);
  if (bake) return bake;
  bake = [];
  for (let f = 0; f < doc.duration; f++) bake.push(sampleEffect(doc, f));
  scalarBakeCache.set(doc, bake);
  return bake;
}
function scalarRows(doc, layerId, listKey, fields) {
  const bake = scalarBake(doc);
  return bake.map((s) => {
    const hit = s[listKey].find((x) => x.layerId === layerId);
    return fields.map((fieldFn) => (hit ? fieldFn(hit) : 0));
  });
}

function emitLuaShape(L, notes, layer, id, doc, fps) {
  const def = layer.props.shape || { kind: 'slash' };
  const scale0 = resolveProp(layer, 'scale', 0, fps);
  const rot0 = (resolveProp(layer, 'rotation', 0, fps) * Math.PI) / 180;
  if (layer.curves.scale?.length || layer.curves.rotation?.length) notes.push(`${layer.name}: animated scale/rotation exports static at its clip-start value`);
  const off = layer.props.offset || [0, 0, 0];
  const rows = scalarRows(doc, layer.id, 'shapes', [(s) => s.opacity, (s) => s.thickness]);
  const opTable = luaNumTable(rows.map((r) => Math.max(0, Math.min(1, 1 - r[0]))));
  const thTable = luaNumTable(rows.map((r) => Math.max(0.02, r[1])));

  const isSolid = ['sphere', 'cylinder', 'rect'].includes(def.kind) || def.kind === 'cone';
  if (isSolid) {
    if (def.kind === 'cone') notes.push(`${layer.name}: cone shape exports as a glowing ball (no Roblox equivalent)`);
    const size = def.kind === 'sphere' || def.kind === 'cone'
      ? [def.radius * 2 * scale0, def.radius * 2 * scale0, def.radius * 2 * scale0]
      : def.kind === 'cylinder'
        ? [def.height * scale0, def.radius * 2 * scale0, def.radius * 2 * scale0]
        : [def.width * scale0, 0.15, def.depth * scale0];
    L.push(`local ${id}_part = hostPart(Vector3.new(${vecArgs(size)}), originCF * CFrame.new(${vecArgs(off)})${def.kind === 'cylinder' ? ' * CFrame.Angles(0, 0, math.rad(90))' : ''})`);
    L.push(`${id}_part.Material = Enum.Material.Neon`);
    L.push(`${id}_part.Color = ${c3(layer.props.color)}`);
    if (def.kind === 'sphere' || def.kind === 'cone') L.push(`${id}_part.Shape = Enum.PartType.Ball`);
    else if (def.kind === 'cylinder') L.push(`${id}_part.Shape = Enum.PartType.Cylinder`);
    L.push(`local ${id}_tr = ${opTable}`);
    L.push(`local function ${id}_update(active, lf, _)`);
    L.push(`  if not active then ${id}_part.Transparency = 1 return end`);
    L.push(`  ${id}_part.Transparency = ${id}_tr[math.clamp(math.floor(lf) + 1, 1, #${id}_tr)]`);
    L.push('end');
    L.push(`local function ${id}_stop() ${id}_part.Transparency = 1 end`);
    return;
  }

  // path shapes → beam chain along the tessellated polyline
  notes.push(`${layer.name}: "${def.kind}" exports as a chain of Beams along its path`);
  // shapePolyline already samples u=1 (== u=0 for any closed shape, by construction — see
  // effectShapes.js), so the point list is self-closing; appending pts[0] again would pair a
  // final zero-length degenerate Beam between two identical positions.
  const pts = shapePolyline(def, ROBLOX.beamPoints - 1).map((pt) => rotY(pt, rot0).map((v, i) => v * scale0 + off[i]));
  L.push(`local ${id}_beams = {}`);
  L.push('do');
  L.push(`  local pts = { ${pts.map((pt) => `Vector3.new(${vecArgs(pt)})`).join(', ')} }`);
  L.push('  local prev');
  L.push('  for i, pos in ipairs(pts) do');
  L.push('    local a = Instance.new("Attachment"); a.Position = pos; a.Parent = anchor');
  L.push('    if prev then');
  L.push('      local b = Instance.new("Beam")');
  L.push('      b.Attachment0 = prev; b.Attachment1 = a');
  L.push(`      b.Color = ColorSequence.new(${c3(layer.props.color)})`);
  L.push(`      b.LightEmission = ${layer.props.emissive ? '1' : '0'}`);
  L.push('      b.FaceCamera = true');
  L.push('      b.Transparency = NumberSequence.new(1)');
  L.push('      b.Segments = 1');
  L.push('      b.Parent = anchor');
  L.push(`      ${id}_beams[#${id}_beams + 1] = b`);
  L.push('    end');
  L.push('    prev = a');
  L.push('  end');
  L.push('end');
  L.push(`local ${id}_tr = ${opTable}`);
  L.push(`local ${id}_w = ${thTable}`);
  L.push(`local function ${id}_update(active, lf, _)`);
  L.push(`  local i = math.clamp(math.floor(lf) + 1, 1, #${id}_tr)`);
  L.push(`  local tr = active and ${id}_tr[i] or 1`);
  L.push(`  local w = ${id}_w[i]`);
  const taper = def.kind === 'slash';
  L.push(`  for bi, b in ipairs(${id}_beams) do`);
  L.push('    b.Transparency = NumberSequence.new(tr)');
  if (taper) {
    L.push(`    local u = (bi - 0.5) / #${id}_beams`);
    L.push('    local taper = math.sin(u * math.pi)');
    L.push('    b.Width0 = w * taper * 6; b.Width1 = w * taper * 6');
  } else {
    L.push('    b.Width0 = w * 6; b.Width1 = w * 6');
  }
  L.push('  end');
  L.push('end');
  L.push(`local function ${id}_stop() for _, b in ipairs(${id}_beams) do b.Transparency = NumberSequence.new(1) end end`);
}

function emitLuaLight(L, notes, layer, id, doc) {
  const off = layer.props.offset || [0, 0.5, 0];
  const rows = scalarRows(doc, layer.id, 'lights', [(l) => l.intensity, (l) => Math.min(ROBLOX.lightRange, l.range), (l) => l.color]);
  L.push(`local ${id}_att = Instance.new("Attachment"); ${id}_att.Position = Vector3.new(${vecArgs(off)}); ${id}_att.Parent = anchor`);
  L.push(`local ${id}_light = Instance.new("PointLight")`);
  L.push(`${id}_light.Color = ${rows.length ? c3rgb(rows[Math.floor(rows.length / 4)][2] || [1, 1, 1]) : c3(layer.props.color)}`);
  L.push(`${id}_light.Brightness = 0`);
  L.push(`${id}_light.Range = ${n(Math.min(ROBLOX.lightRange, layer.props.range))}`);
  L.push(`${id}_light.Parent = ${id}_att`);
  L.push(`local ${id}_br = ${luaNumTable(rows.map((r) => r[0]))}`);
  L.push(`local function ${id}_update(active, lf, _)`);
  L.push(`  ${id}_light.Brightness = active and ${id}_br[math.clamp(math.floor(lf) + 1, 1, #${id}_br)] or 0`);
  L.push('end');
  L.push(`local function ${id}_stop() ${id}_light.Brightness = 0 end`);
}

function emitLuaScreen(L, notes, layer, id, doc) {
  const kind = layer.props.kind || 'flash';
  const rows = scalarRows(doc, layer.id, 'screen', [(s) => s.opacity]);
  if (kind === 'vignette' || kind === 'speedlines') notes.push(`${layer.name}: ${kind} is approximated with UI frames in Roblox`);
  L.push(`local ${id}_gui = Instance.new("ScreenGui")`);
  L.push(`${id}_gui.Name = ${luaStr(`VFX_${kind}`)}`);
  L.push(`${id}_gui.IgnoreGuiInset = true`);
  L.push(`${id}_gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")`);
  L.push(`local ${id}_frames = {}`);
  if (kind === 'flash' || kind === 'overlay') {
    L.push(`do local fr = Instance.new("Frame"); fr.Size = UDim2.fromScale(1, 1); fr.BackgroundColor3 = ${c3(layer.props.color)}; fr.BackgroundTransparency = 1; fr.BorderSizePixel = 0; fr.Parent = ${id}_gui; ${id}_frames[1] = fr end`);
  } else if (kind === 'vignette') {
    L.push('do -- four edge gradients approximating a radial vignette');
    L.push('  local edges = { {0, 0, 1, 0.22, 90}, {0, 0.78, 1, 0.22, 270}, {0, 0, 0.18, 1, 0}, {0.82, 0, 0.18, 1, 180} }');
    L.push('  for i, e in ipairs(edges) do');
    L.push(`    local fr = Instance.new("Frame"); fr.Position = UDim2.fromScale(e[1], e[2]); fr.Size = UDim2.fromScale(e[3], e[4])`);
    L.push(`    fr.BackgroundColor3 = ${c3(layer.props.color)}; fr.BackgroundTransparency = 1; fr.BorderSizePixel = 0; fr.Parent = ${id}_gui`);
    L.push('    local g = Instance.new("UIGradient"); g.Rotation = e[5]');
    L.push('    g.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0), NumberSequenceKeypoint.new(1, 1) })');
    L.push(`    g.Parent = fr; ${id}_frames[i] = fr`);
    L.push('  end');
    L.push('end');
  } else {
    const density = Math.min(40, Math.round(layer.props.density || 24));
    L.push(`do -- ${density} rotated frames approximating radial speed lines`);
    L.push(`  for i = 1, ${density} do`);
    L.push(`    local fr = Instance.new("Frame"); fr.AnchorPoint = Vector2.new(0.5, 0)`);
    L.push(`    fr.Position = UDim2.fromScale(0.5, 0.5); fr.Size = UDim2.new(0, 3, 0.75, 0)`);
    L.push(`    fr.BackgroundColor3 = ${c3(layer.props.color)}; fr.BackgroundTransparency = 1; fr.BorderSizePixel = 0`);
    L.push(`    fr.Rotation = (i / ${density}) * 360`);
    L.push(`    fr.Parent = ${id}_gui; ${id}_frames[i] = fr`);
    L.push('  end');
    L.push('end');
  }
  L.push(`local ${id}_tr = ${luaNumTable(rows.map((r) => Math.max(0, Math.min(1, 1 - r[0]))))}`);
  L.push(`local function ${id}_update(active, lf, _)`);
  L.push(`  local tr = active and ${id}_tr[math.clamp(math.floor(lf) + 1, 1, #${id}_tr)] or 1`);
  L.push(`  for _, fr in ipairs(${id}_frames) do fr.BackgroundTransparency = tr end`);
  L.push('end');
  L.push(`local function ${id}_stop() for _, fr in ipairs(${id}_frames) do fr.BackgroundTransparency = 1 end end`);
}

function emitLuaShake(L, notes, layer, id, doc, fps) {
  const rows = [];
  for (let lf = 0; lf < layer.clip.len; lf++) rows.push(Math.max(0, resolveProp(layer, 'amplitude', lf, fps)));
  L.push(`local ${id}_amp = ${luaNumTable(rows)}`);
  L.push(`local ${id}_bound = false`);
  L.push(`local ${id}_lf = 0 -- upvalue: the render-step closure reads the LIVE local frame`);
  L.push(`local ${id}_seed = ${n((idxHash(layer.id) % 1000) / 100)}`);
  L.push(`local ${id}_last = CFrame.new() -- last-applied shake offset, undone before the next one so it never compounds`);
  L.push(`local function ${id}_update(active, lf, _)`);
  L.push(`  ${id}_lf = lf`);
  L.push('  local camera = workspace.CurrentCamera');
  L.push('  if active and not ' + id + '_bound then');
  L.push(`    ${id}_bound = true`);
  // Delta AFTER the camera update (and after any exported camera script). Undo the previous
  // frame's offset before applying this frame's (the standard non-accumulating camera-shake
  // pattern) — multiplying a fresh delta straight onto camera.CFrame every RenderStep with no
  // undo compounds forever on a Scriptable camera with nothing else re-anchoring it each frame.
  // Noise is still sampled from TIME so shake speed stays framerate-independent.
  L.push(`    RunService:BindToRenderStep(${luaStr(id + '_shake')}, Enum.RenderPriority.Camera.Value + 2, function()`);
  L.push(`      local amp = ${id}_amp[math.clamp(math.floor(${id}_lf) + 1, 1, #${id}_amp)]`);
  L.push(`      local t = os.clock() * ${n(layer.props.frequency || 9)}`);
  L.push(`      local dx = amp * (math.sin(t * 6.283 + ${id}_seed) * 0.7 + math.sin(t * 10.87 + ${id}_seed * 2) * 0.3) * 0.25`);
  L.push(`      local dy = amp * (math.sin(t * 7.1 + ${id}_seed * 3) * 0.7 + math.sin(t * 11.9 + ${id}_seed * 4) * 0.3) * 0.25`);
  L.push(`      local roll = math.rad(${n(layer.props.roll ?? 0.8)}) * math.sin(t * 5.7 + ${id}_seed * 5)`);
  L.push(`      local newOffset = CFrame.new(dx, dy, 0) * CFrame.Angles(0, 0, roll)`);
  L.push(`      camera.CFrame = camera.CFrame * ${id}_last:Inverse() * newOffset`);
  L.push(`      ${id}_last = newOffset`);
  L.push('    end)');
  L.push(`  elseif not active and ${id}_bound then`);
  L.push(`    ${id}_bound = false`);
  L.push(`    camera.CFrame = camera.CFrame * ${id}_last:Inverse()`);
  L.push(`    ${id}_last = CFrame.new()`);
  L.push(`    RunService:UnbindFromRenderStep(${luaStr(id + '_shake')})`);
  L.push('  end');
  L.push('end');
  L.push(`local function ${id}_stop()`);
  L.push(`  if ${id}_bound then`);
  L.push(`    ${id}_bound = false`);
  L.push('    local camera = workspace.CurrentCamera');
  L.push(`    camera.CFrame = camera.CFrame * ${id}_last:Inverse()`);
  L.push(`    ${id}_last = CFrame.new()`);
  L.push(`    RunService:UnbindFromRenderStep(${luaStr(id + '_shake')})`);
  L.push('  end');
  L.push('end');
}

function emitLuaSound(L, notes, layer, id) {
  const soundId = layer.props.soundId?.trim() || '';
  if (!soundId) notes.push(`${layer.name}: no sound id set — the Sound instance exports silent`);
  L.push(`local ${id}_sound = Instance.new("Sound")`);
  L.push(`${id}_sound.SoundId = ${luaStr(soundId)}`);
  L.push(`${id}_sound.Volume = ${n(layer.props.volume ?? 0.7)}`);
  L.push(`${id}_sound.PlaybackSpeed = ${n(layer.props.pitch ?? 1)} -- Pitch is deprecated; PlaybackSpeed is the property`);
  L.push(`${id}_sound.Parent = anchor`);
  L.push(`local function ${id}_update(active, lf, firstOfIteration)`);
  L.push(`  if firstOfIteration and ${id}_sound.SoundId ~= "" then`);
  L.push(`    ${id}_sound.TimePosition = 0`);
  L.push(`    ${id}_sound:Play()`);
  L.push('  end');
  L.push(`  if not active and ${id}_sound.IsPlaying then ${id}_sound:Stop() end`);
  L.push('end');
  L.push(`local function ${id}_stop() ${id}_sound:Stop() end`);
}

// ---------------------------------------------------------------- small helpers
function vecArgs(arr) { return arr.map(n).join(', '); }
function luaNumTable(values) { return `{ ${values.map(n).join(', ')} }`; }
function rotY(p, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
}
function idxHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 100000;
  return h;
}
