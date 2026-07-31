// The Roblox export target (spec Parts 56-58).
//
// PART 2 SETS THE TERMS: "Roblox determines what can ultimately run natively inside Roblox. Roblox must
// NOT determine what Cadence itself is capable of authoring." So this file's job is not to restrict the
// engine; it is to translate as much as Roblox can run, bake what it cannot, and REPORT the difference
// honestly rather than quietly producing something that looks nothing like the preview.
//
// THE THREE STRATEGIES, chosen per render pass:
//
//   NATIVE       a sprite pass whose motion Roblox's own ParticleEmitter can reproduce becomes one.
//                Cheap, small, and it keeps Roblox's per-particle randomness — so it is a STATISTICAL
//                match, exactly like the existing effectExport.js contract: individual particles
//                differ, the effect reads the same.
//   CONVERTED    a beam becomes a Roblox Beam; a light becomes a PointLight. Different implementation,
//                same intent.
//   BAKED        everything else. Record what was drawn, frame by frame, and replay it. Correct for any
//                effect at a cost in script size, which is measured and reported rather than discovered.
//
// WHAT DECIDES BETWEEN THEM is bake.js's field probing. A size that varies only over a particle's life
// becomes a NumberSequence and is exact; a size that varies with position has no Roblox equivalent at
// all and forces the whole pass to be baked. That question cannot be answered by reading the graph,
// because a field is a closure — so it is answered by sampling.
//
// A NOTE ON WHAT IS NOT ATTEMPTED. Procedural geometry cannot become a MeshPart: Roblox has no runtime
// mesh construction, and a mesh must be uploaded as an asset first. A mesh pass is therefore reported as
// unsupported with that explanation, rather than exported as several hundred Parts that would look
// wrong and run badly. Refusing with a reason is the honest option (Part 78).

import * as V from '../values.js';
import * as F from '../fields.js';
import * as GEO from '../geometry.js';
import * as BAKE from '../bake.js';
import { getNode as getNodeType } from '../registry.js';

// ---------------------------------------------------------------- Luau emission helpers
// Same conventions as the existing effectExport.js, deliberately: an exported PNX script and an exported
// Effect-doc script should read like they came from the same tool.
const n = (v) => {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
const luaStr = (s) => `"${String(s).replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\n')}"`;
const c3 = (rgb) => `Color3.fromRGB(${Math.round(V.clamp01(rgb[0]) * 255)}, ${Math.round(V.clamp01(rgb[1]) * 255)}, ${Math.round(V.clamp01(rgb[2]) * 255)})`;
const v3 = (a) => `Vector3.new(${n(a[0])}, ${n(a[1])}, ${n(a[2])})`;

// A Roblox NumberSequence from baked keypoints. Values are clamped to the property's own legal range,
// because Roblox throws on an out-of-range keypoint rather than clamping, and an export that crashes on
// paste is worse than one that clamps and says so.
function numberSequence(points, { min = -Infinity, max = Infinity } = {}) {
  const kp = points.map((p) => `NumberSequenceKeypoint.new(${n(V.clamp(p.t, 0, 1))}, ${n(V.clamp(Number(p.v) || 0, min, max))})`);
  return `NumberSequence.new({${kp.join(', ')}})`;
}

function colorSequence(points) {
  const kp = points.map((p) => {
    const c = V.toComponents('color', p.v);
    return `ColorSequenceKeypoint.new(${n(V.clamp(p.t, 0, 1))}, ${c3(c)})`;
  });
  return `ColorSequence.new({${kp.join(', ')}})`;
}

// Transparency is 1 - alpha in Roblox. Worth stating because getting it backwards produces a fully
// invisible effect with no error anywhere, which is a genuinely hard bug to see.
function transparencySequence(points) {
  return numberSequence(points.map((p) => {
    const c = Array.isArray(p.v) ? V.toComponents('color', p.v) : [0, 0, 0, Number(p.v)];
    return { t: p.t, v: 1 - V.clamp01(c[3]) };
  }), { min: 0, max: 1 });
}

// ---------------------------------------------------------------- pass analysis
// Can this sprite pass be a real ParticleEmitter? The conditions are concrete and each one is checked,
// because a "close enough" native export that silently drops collisions or a curl-noise force is far
// worse than an honest bake.
function analyseSpritePass(cmd, graph, evaluator) {
  const reasons = [];
  const strategies = {};
  const s = cmd.settings || {};
  const mat = cmd.material || {};

  for (const [name, field] of [
    ['size', s.size], ['rotation', s.rotation],
    ['baseColor', mat.channels?.baseColor], ['opacity', mat.channels?.opacity],
    ['emission', mat.channels?.emission],
  ]) {
    if (field === undefined) continue;
    const st = BAKE.bakeStrategy(field);
    strategies[name] = st;
    if (st.kind === 'perFrame') {
      reasons.push(`${name} varies with ${st.deps.filter((d) => d !== 'life' && d !== 'index').join(' and ')}, which a Roblox ParticleEmitter has no way to express`);
    }
  }

  // The simulation behind the pass. A ParticleEmitter has Acceleration and Drag and nothing else — no
  // collisions, no spatial forces, no kill conditions.
  const sim = findSimulateNode(cmd, graph, evaluator);
  if (sim) {
    if (sim.colliders && sim.colliders.length) reasons.push('the particles collide with something, and Roblox particles cannot collide');
    if (sim.forceStrategy && sim.forceStrategy.kind === 'perFrame') {
      reasons.push(`the force varies with ${sim.forceStrategy.deps.join(' and ')} — Roblox only has a constant Acceleration`);
    }
    if (sim.hasKill) reasons.push('a kill condition removes particles early, which Roblox cannot do');
    if (sim.emitFrom === 'surface' || sim.emitFrom === 'curve') {
      // Not disqualifying, but it changes the look, so it is a note rather than a reason.
      strategies.__emitShapeNote = `particles are born on a ${sim.emitFrom}; Roblox emits from a box or a sphere, so the birth positions differ`;
    }
  } else {
    reasons.push('the particles do not come from a Simulate Particles node, so there is no emitter to translate');
  }

  if (s.facing === 'velocity') strategies.__facingNote = 'velocity-facing sprites are approximated by Roblox\'s own SpreadAngle/stretch behaviour and will not match exactly';

  return { native: reasons.length === 0, reasons, strategies, sim };
}

// Walk back from a render command's source to the Simulate Particles node that produced it, and read
// what the exporter needs off it. Done through the graph rather than by inspecting the geometry, because
// the geometry is the RESULT — it carries no record of the forces that shaped it.
function findSimulateNode(cmd, graph, evaluator) {
  if (!graph) return null;
  const sims = Object.values(graph.nodes).filter((nd) => nd.type.startsWith('cadence.particles.simulate'));
  if (!sims.length) return null;
  // One simulation is the overwhelmingly common case; with several, the first is used and the report
  // says so rather than silently picking.
  const node = sims[0];

  const read = (socket) => {
    try {
      const r = evaluator.evaluateSocket(node.id, socket);
      return r.value;
    } catch (e) { return undefined; }
  };
  const inputOf = (socketKey) => {
    const link = Object.values(graph.links).find((l) => l.toNode === node.id && l.toSocket === socketKey);
    if (!link) return node.values?.[socketKey];
    try { return evaluator.evaluateSocket(link.fromNode, link.fromSocket).value; } catch (e) { return undefined; }
  };

  const force = inputOf('force');
  const emitter = inputOf('emitter');
  const colliders = inputOf('colliders');
  const kill = inputOf('kill');

  return {
    nodeId: node.id,
    several: sims.length > 1,
    forceStrategy: BAKE.bakeStrategy(force),
    forceConstant: F.isField(force)
      ? V.toComponents('vector3', F.sampleAny(force, F.newSampleContext()))
      : V.toComponents('vector3', force || [0, 0, 0]),
    drag: Number(node.values?.drag ?? 0) || 0,
    colliders: Array.isArray(colliders) ? colliders.filter(Boolean) : (colliders ? [colliders] : []),
    hasKill: kill !== undefined && kill !== false && kill !== null,
    emitter: emitter && emitter.__emitter ? emitter : null,
    emitFrom: emitter?.emitFrom,
  };
}

// ---------------------------------------------------------------- the report (Part 57)
// Built BEFORE any Luau is written, and returned alongside it, so the user sees the classification and
// what it cost before deciding to use the output. Every row names the node responsible, which is what
// Part 57's "allow clicking an item to locate the responsible nodes" needs.
export function analyseForRoblox(commands, { graph = null, evaluator = null } = {}) {
  const rows = [];
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    const base = { index: i, kind: cmd.kind, nodeId: cmd.settings?.__nodeId || null };

    switch (cmd.kind) {
      case 'sprite':
      case 'point': {
        const a = analyseSpritePass(cmd, graph, evaluator);
        rows.push({
          ...base,
          level: a.native ? 'native' : 'baked',
          how: a.native
            ? 'Becomes a Roblox ParticleEmitter. A statistical match: Roblox rolls its own per-particle randomness, so individual particles differ while the effect reads the same.'
            : 'Baked to a per-frame cache and replayed, because Roblox cannot reproduce the motion.',
          reasons: a.reasons,
          notes: [a.strategies.__emitShapeNote, a.strategies.__facingNote].filter(Boolean),
          analysis: a,
        });
        break;
      }
      case 'beam':
      case 'trail': {
        rows.push({
          ...base, level: 'converted',
          how: 'Becomes a Roblox Beam between two attachments, with the width and colour baked into its sequences.',
          reasons: [],
          notes: ['A Beam is a flat, camera-facing strip; a trail with more than a couple of segments is approximated by its endpoints plus curve control points.'],
        });
        break;
      }
      case 'light': {
        rows.push({
          ...base, level: 'converted',
          how: 'Becomes a Roblox PointLight per element, with intensity and range baked per frame.',
          reasons: [],
          notes: ['Roblox renders a limited number of lights at once, so a high count is silently dropped in-game regardless of what is exported.'],
        });
        break;
      }
      case 'mesh': {
        rows.push({
          ...base, level: 'unsupported',
          how: 'Not exported.',
          reasons: ['Roblox cannot build a mesh at runtime — a mesh has to be uploaded as an asset first. Exporting this as several hundred Parts instead would look wrong and run badly, so it is refused rather than approximated.'],
          notes: ['Export the geometry separately as a mesh asset, then use a Roblox MeshPart and animate it with a transform sequence.'],
        });
        break;
      }
      case 'ribbon':
      case 'line': {
        rows.push({
          ...base, level: 'unsupported',
          how: 'Not exported.',
          reasons: [`Roblox has no ${cmd.kind} primitive, and a Beam cannot hold its own orientation the way a ribbon does.`],
          notes: [],
        });
        break;
      }
      default:
        rows.push({ ...base, level: 'unsupported', how: 'Not exported.', reasons: ['Unrecognised render pass.'], notes: [] });
    }

    // Material channels no backend honours. Reported per pass so the row that loses them is identifiable.
    const dropped = Object.keys(cmd.material?.channels || {}).filter((c) =>
      ['transmission', 'refraction', 'ior', 'absorption', 'scattering', 'height', 'specular', 'fresnel', 'ambientOcclusion'].includes(c));
    if (dropped.length) rows[rows.length - 1].droppedChannels = dropped;
  }

  const counts = rows.reduce((a, r) => ({ ...a, [r.level]: (a[r.level] || 0) + 1 }), {});
  return {
    rows,
    counts,
    exportable: rows.some((r) => r.level !== 'unsupported'),
    lossless: rows.every((r) => r.level === 'native') && !rows.some((r) => r.droppedChannels?.length),
  };
}

// ---------------------------------------------------------------- the exporter
// Returns { lua, report, notes }. Never throws on a graph it cannot fully express: it exports what it
// can and the report says what it could not, which is the whole point of Part 56's classification.
export function buildRobloxExport({
  commands, graph, evaluator, evaluateFrame,
  name = 'Procedural Effect',
  fps = 30, duration = 60,
  bake = {},
} = {}) {
  const report = analyseForRoblox(commands, { graph, evaluator });
  const notes = [];
  const L = [];

  L.push(`-- ${name} — exported from Cadence VFX Studio (procedural engine)`);
  L.push('--');
  L.push('-- Self-contained LocalScript. Parent it to a BasePart to play at that part, or anywhere');
  L.push('-- client-side to play at the origin. Fire the "PlayEffect" BindableEvent under this script,');
  L.push('-- or set AUTOPLAY = true.');
  L.push('--');
  // The honest header. A user who pastes this into Studio in six months' time should be able to see
  // what was translated and what was precomputed without going back to Cadence.
  for (const row of report.rows) {
    const label = `pass ${row.index + 1} (${row.kind})`;
    L.push(`-- ${label}: ${row.level.toUpperCase()} — ${row.how}`);
    for (const r of row.reasons) L.push(`--   because ${r}`);
    for (const nt of row.notes) L.push(`--   note: ${nt}`);
    if (row.droppedChannels?.length) L.push(`--   dropped material channels: ${row.droppedChannels.join(', ')}`);
  }
  L.push('');
  L.push('local AUTOPLAY = false');
  L.push(`local FPS = ${fps}`);
  L.push(`local DURATION = ${duration} -- frames`);
  L.push('');
  L.push('local RunService = game:GetService("RunService")');
  L.push('');
  L.push('local originCF = script.Parent and script.Parent:IsA("BasePart") and script.Parent.CFrame or CFrame.new(0, 3, 0)');
  L.push('local rig = Instance.new("Folder")');
  L.push(`rig.Name = ${luaStr(name)}`);
  L.push('rig.Parent = workspace');
  L.push('');
  L.push('local function hostPart(cf)');
  L.push('  local p = Instance.new("Part")');
  L.push('  p.Anchored = true; p.CanCollide = false; p.CanQuery = false; p.CanTouch = false');
  L.push('  p.Transparency = 1; p.Size = Vector3.new(0.2, 0.2, 0.2); p.CFrame = cf; p.Parent = rig');
  L.push('  return p');
  L.push('end');
  L.push('local anchor = hostPart(originCF)');
  L.push('');
  L.push('local PASSES = {} -- each entry: { update = function(frame), stop = function() }');
  L.push('');

  let emitted = 0;
  for (const row of report.rows) {
    const cmd = commands[row.index];
    const id = `P${row.index + 1}`;
    L.push(`-- ============================== pass ${row.index + 1}: ${row.kind} (${row.level})`);
    if (row.level === 'unsupported') {
      L.push(`-- not exported: ${row.reasons[0] || 'unsupported'}`);
      L.push('');
      notes.push(`Pass ${row.index + 1} (${row.kind}) was not exported: ${row.reasons[0]}`);
      continue;
    }
    if (row.level === 'native') {
      emitNativeEmitter(L, notes, cmd, row, id, { fps, duration });
      emitted++;
    } else if (row.kind === 'light') {
      emitBakedLight(L, notes, cmd, row, id, { fps, duration, evaluateFrame, bake });
      emitted++;
    } else if (row.kind === 'beam' || row.kind === 'trail') {
      emitBeam(L, notes, cmd, row, id, { fps, duration, evaluateFrame, bake });
      emitted++;
    } else {
      emitBakedParticles(L, notes, cmd, row, id, { fps, duration, evaluateFrame, bake });
      emitted++;
    }
    L.push('');
  }

  if (!emitted) {
    L.push('-- Nothing in this effect could be exported. See the notes at the top of this file.');
  }

  // The driver: wall-clock Heartbeat, never a task.wait step loop — the same rule the Effect-doc
  // exporter follows, and for the same reason (a wait loop drifts under load and stalls the effect).
  L.push('-- ============================== driver');
  L.push('local playing = false');
  L.push('local conn = nil');
  L.push('local function stopAll()');
  L.push('  playing = false');
  L.push('  if conn then conn:Disconnect(); conn = nil end');
  L.push('  for _, p in ipairs(PASSES) do if p.stop then p.stop() end end');
  L.push('end');
  L.push('local function play()');
  L.push('  if playing then return end');
  L.push('  playing = true');
  L.push('  local t0 = os.clock()');
  L.push('  conn = RunService.Heartbeat:Connect(function()');
  L.push('    local frame = (os.clock() - t0) * FPS');
  L.push('    if frame >= DURATION then stopAll(); return end');
  L.push('    for _, p in ipairs(PASSES) do p.update(frame) end');
  L.push('  end)');
  L.push('end');
  L.push('');
  L.push('local ev = Instance.new("BindableEvent")');
  L.push('ev.Name = "PlayEffect"');
  L.push('ev.Parent = script');
  L.push('ev.Event:Connect(play)');
  L.push('local stopEv = Instance.new("BindableEvent")');
  L.push('stopEv.Name = "StopEffect"');
  L.push('stopEv.Parent = script');
  L.push('stopEv.Event:Connect(stopAll)');
  L.push('if AUTOPLAY then play() end');
  L.push('');

  const lua = L.join('\n');
  const budget = BAKE.describeBudget(lua.length);
  if (budget.message) notes.push(budget.message);

  return {
    lua,
    report,
    notes,
    bytes: lua.length,
    withinBudget: budget.ok,
  };
}

// ---------------------------------------------------------------- native ParticleEmitter
function emitNativeEmitter(L, notes, cmd, row, id, { fps }) {
  const a = row.analysis;
  const sim = a.sim;
  const em = sim?.emitter;
  const st = a.strategies;

  L.push(`local ${id}_att = Instance.new("Attachment")`);
  L.push(`${id}_att.Parent = anchor`);
  L.push(`local ${id} = Instance.new("ParticleEmitter")`);
  L.push(`${id}.Parent = ${id}_att`);
  L.push(`${id}.Enabled = false`);

  // Rate and lifetime.
  const rate = Math.min(BAKE.ROBLOX_LIMITS.particleRate, Math.max(0, em?.rate ?? 20));
  if ((em?.rate ?? 0) > BAKE.ROBLOX_LIMITS.particleRate) {
    notes.push(`Rate was clamped from ${Math.round(em.rate)} to Roblox's maximum of ${BAKE.ROBLOX_LIMITS.particleRate} particles/second.`);
  }
  L.push(`${id}.Rate = ${n(rate)}`);

  const lifeRange = em ? BAKE.bakeRange(em.lifetime) : { min: 2, max: 2 };
  const lifeLo = Math.min(BAKE.ROBLOX_LIMITS.particleLifetime, Math.max(0.01, lifeRange.min));
  const lifeHi = Math.min(BAKE.ROBLOX_LIMITS.particleLifetime, Math.max(lifeLo, lifeRange.max));
  L.push(`${id}.Lifetime = NumberRange.new(${n(lifeLo)}, ${n(lifeHi)})`);

  // Speed, from the emitter's initial velocity magnitude.
  if (em) {
    const speed = BAKE.bakeRange(em.velocity);
    L.push(`${id}.Speed = NumberRange.new(${n(Math.max(0, speed.min))}, ${n(Math.max(0, speed.max))})`);
    // A single fixed direction becomes EmissionDirection plus a narrow spread; anything else gets a
    // wide spread, because Roblox cannot aim particles per-particle.
    const v = F.isField(em.velocity) ? V.toComponents('vector3', F.sampleAny(em.velocity, F.newSampleContext())) : V.toComponents('vector3', em.velocity || [0, 0, 0]);
    const dir = V.vNormalize(v);
    const axis = Math.abs(dir[1]) > 0.7 ? (dir[1] > 0 ? 'Top' : 'Bottom') : Math.abs(dir[0]) > 0.7 ? (dir[0] > 0 ? 'Right' : 'Left') : (dir[2] > 0 ? 'Front' : 'Back');
    L.push(`${id}.EmissionDirection = Enum.NormalId.${axis}`);
    L.push(`${id}.SpreadAngle = Vector2.new(20, 20)`);
  }

  // Size: a life-only field is exact as a NumberSequence; an index-only one becomes a range applied as
  // a flat sequence, which is the closest Roblox allows.
  if (st.size?.kind === 'sequence' || st.size?.kind === 'sequenceRange') {
    L.push(`${id}.Size = ${numberSequence(BAKE.bakeSequence(cmd.settings.size), { min: 0, max: BAKE.ROBLOX_LIMITS.particleSize })}`);
  } else if (st.size?.kind === 'range') {
    const r = BAKE.bakeRange(cmd.settings.size);
    L.push(`${id}.Size = NumberSequence.new(${n(Math.max(0, (r.min + r.max) / 2))})`);
    notes.push('Particle size varies per particle but not over life; Roblox has no per-particle size sequence, so the average was used.');
  } else {
    const sz = F.isField(cmd.settings.size) ? Number(F.sampleAny(cmd.settings.size, F.newSampleContext())) : Number(cmd.settings.size ?? 1);
    L.push(`${id}.Size = NumberSequence.new(${n(Math.max(0, sz))})`);
  }

  // Colour and transparency.
  const baseColor = cmd.material?.channels?.baseColor;
  if (st.baseColor?.kind === 'sequence' || st.baseColor?.kind === 'sequenceRange') {
    L.push(`${id}.Color = ${colorSequence(BAKE.bakeSequence(baseColor))}`);
  } else if (baseColor !== undefined) {
    const c = V.toComponents('color', F.isField(baseColor) ? F.sampleAny(baseColor, F.newSampleContext()) : baseColor);
    L.push(`${id}.Color = ColorSequence.new(${c3(c)})`);
  }

  // Transparency is where BOTH the opacity channel and the base colour's alpha land, because Roblox has
  // one Transparency property and no separate alpha. They MULTIPLY — an effect at 0.35 opacity with a
  // colour that fades out over life is dimmer still at the end — so both are sampled and combined
  // per keypoint. Branching on one or the other instead silently discards whichever lost: an earlier
  // version of this checked the colour's alpha first and dropped an explicit 0.35 opacity entirely,
  // which exported at full brightness with nothing to indicate the setting had been ignored.
  const opacity = cmd.material?.channels?.opacity;
  const alphaAt = (life) => {
    const ctx = F.newSampleContext({ life, age: life });
    const o = opacity === undefined ? 1 : Number(F.sampleAny(opacity, ctx));
    const c = baseColor === undefined ? [1, 1, 1, 1] : V.toComponents('color', F.sampleAny(baseColor, ctx));
    return V.clamp01((Number.isFinite(o) ? o : 1) * (c[3] === undefined ? 1 : c[3]));
  };
  const alphaVaries = ['sequence', 'sequenceRange'].includes(st.opacity?.kind) || ['sequence', 'sequenceRange'].includes(st.baseColor?.kind);
  if (alphaVaries) {
    const pts = [];
    for (let k = 0; k < 8; k++) { const life = k / 7; pts.push({ t: life, v: 1 - alphaAt(life) }); }
    L.push(`${id}.Transparency = ${numberSequence(pts, { min: 0, max: 1 })}`);
  } else {
    L.push(`${id}.Transparency = NumberSequence.new(${n(1 - alphaAt(0))})`);
  }

  // Emission becomes LightEmission plus LightInfluence 0, which is the only handle Roblox gives for
  // "this glows rather than being lit". Additive blending implies fully self-lit, and takes precedence
  // over the emission channel's own strength — emitting both would write the property twice.
  const emission = cmd.material?.channels?.emission;
  let lightEmission = null;
  if (emission !== undefined) {
    const e = V.toComponents('color', F.isField(emission) ? F.sampleAny(emission, F.newSampleContext()) : emission);
    lightEmission = V.clamp01((e[0] + e[1] + e[2]) / 3);
  }
  if (cmd.material?.blend === 'additive') lightEmission = 1;
  if (lightEmission !== null) {
    L.push(`${id}.LightEmission = ${n(lightEmission)}`);
    L.push(`${id}.LightInfluence = 0`);
  }

  // Forces: Acceleration and Drag are the whole of Roblox's particle physics.
  if (sim) {
    L.push(`${id}.Acceleration = ${v3(sim.forceConstant)}`);
    if (sim.drag > 0) L.push(`${id}.Drag = ${n(sim.drag)}`);
  }
  L.push(`${id}.Texture = "rbxasset://textures/particles/smoke_main.dds"`);
  L.push(`${id}.ZOffset = 0`);
  L.push('');
  L.push(`local function ${id}_update(frame) ${id}.Enabled = true end`);
  L.push(`local function ${id}_stop() ${id}.Enabled = false; ${id}:Clear() end`);
  L.push(`PASSES[#PASSES + 1] = { update = ${id}_update, stop = ${id}_stop }`);
}

// ---------------------------------------------------------------- baked particles
function emitBakedParticles(L, notes, cmd, row, id, { fps, duration, evaluateFrame, bake }) {
  const cache = BAKE.bakeParticleCache(evaluateFrame, {
    from: 0, to: duration - 1,
    stride: bake.stride ?? 1,
    maxParticles: bake.maxParticles ?? 300,
    precision: bake.precision ?? 2,
  });

  if (cache.stats.truncated) {
    notes.push(`The bake was capped at ${bake.maxParticles ?? 300} particles per frame. The exported effect is thinner than the preview; raise the cap or reduce the particle count to match.`);
  }
  if (!cache.stats.totalRows) {
    L.push('-- nothing was drawn on any frame, so there is nothing to replay');
    notes.push(`Pass ${row.index + 1} drew nothing on any frame and was skipped.`);
    return;
  }

  // The cache is emitted as one flat table per frame — id, x, y, z, r, g, b, a, size — because Luau
  // parses a flat numeric table far faster than a table of tables, and a bake is exactly where that
  // matters.
  const STRIDE = 9;
  L.push(`-- baked cache: ${cache.stats.frameCount} frames, up to ${cache.stats.peakParticles} particles, ${cache.stats.distinctParticles} distinct`);
  L.push(`local ${id}_FRAMES = {`);
  for (const f of cache.frames) {
    const flat = [];
    for (const r of f.rows) {
      flat.push(r.id, r.p[0], r.p[1], r.p[2], r.c[0], r.c[1], r.c[2], r.a, r.s);
    }
    L.push(`  [${f.frame}] = {${flat.map(n).join(',')}},`);
  }
  L.push('}');
  L.push(`local ${id}_STRIDE = ${STRIDE}`);
  L.push('');

  // Replay: a pool of parts, reused across frames. Pooling matters as much here as in the live
  // renderer — creating and destroying instances per frame is what makes a naive replay unwatchable.
  L.push(`local ${id}_pool = {}`);
  L.push(`local ${id}_folder = Instance.new("Folder")`);
  L.push(`${id}_folder.Name = ${luaStr(`pass${row.index + 1}`)}`);
  L.push(`${id}_folder.Parent = rig`);
  L.push(`local function ${id}_get(i)`);
  L.push(`  if ${id}_pool[i] then return ${id}_pool[i] end`);
  L.push('  local p = Instance.new("Part")');
  L.push('  p.Anchored = true; p.CanCollide = false; p.CanQuery = false; p.CanTouch = false');
  L.push('  p.Shape = Enum.PartType.Ball; p.Material = Enum.Material.Neon; p.TopSurface = Enum.SurfaceType.Smooth');
  L.push('  p.BottomSurface = Enum.SurfaceType.Smooth');
  L.push(`  p.Parent = ${id}_folder`);
  L.push(`  ${id}_pool[i] = p`);
  L.push('  return p');
  L.push('end');
  L.push('');
  // Nearest baked frame rather than interpolation between two: interpolating would need matching
  // particles by id across both frames, and a particle that does not exist in both has no sensible
  // in-between. At 30fps the difference is not visible; the stride is what to lower if it is.
  L.push(`local ${id}_keys = {}`);
  L.push(`for k in pairs(${id}_FRAMES) do ${id}_keys[#${id}_keys + 1] = k end`);
  L.push(`table.sort(${id}_keys)`);
  L.push(`local function ${id}_nearest(frame)`);
  L.push(`  local best, bestd = ${id}_keys[1], math.huge`);
  L.push(`  for _, k in ipairs(${id}_keys) do`);
  L.push('    local d = math.abs(k - frame)');
  L.push('    if d < bestd then best, bestd = k, d end');
  L.push('  end');
  L.push('  return best');
  L.push('end');
  L.push('');
  L.push(`local function ${id}_update(frame)`);
  L.push(`  local rows = ${id}_FRAMES[${id}_nearest(frame)]`);
  L.push('  if not rows then return end');
  L.push(`  local count = #rows / ${id}_STRIDE`);
  L.push('  for i = 1, count do');
  L.push(`    local o = (i - 1) * ${id}_STRIDE`);
  L.push(`    local p = ${id}_get(i)`);
  L.push('    local s = rows[o + 9]');
  L.push('    p.Size = Vector3.new(s, s, s)');
  L.push('    p.CFrame = originCF * CFrame.new(rows[o + 2], rows[o + 3], rows[o + 4])');
  L.push('    p.Color = Color3.new(math.clamp(rows[o + 5], 0, 1), math.clamp(rows[o + 6], 0, 1), math.clamp(rows[o + 7], 0, 1))');
  L.push('    p.Transparency = 1 - math.clamp(rows[o + 8], 0, 1)');
  L.push('    p.Parent = ' + `${id}_folder`);
  L.push('  end');
  L.push(`  for i = count + 1, #${id}_pool do ${id}_pool[i].Parent = nil end`);
  L.push('end');
  L.push(`local function ${id}_stop()`);
  L.push(`  for _, p in ipairs(${id}_pool) do p.Parent = nil end`);
  L.push('end');
  L.push(`PASSES[#PASSES + 1] = { update = ${id}_update, stop = ${id}_stop }`);

  notes.push(`Pass ${row.index + 1} was baked: ${cache.stats.frameCount} frames of up to ${cache.stats.peakParticles} particles, replayed as Neon balls. Roblox has no way to reproduce the motion, so this is a recording rather than a simulation — it will look the same every time it plays.`);
}

// ---------------------------------------------------------------- lights
function emitBakedLight(L, notes, cmd, row, id, { duration, evaluateFrame }) {
  const seq = BAKE.bakeTransformSequence(evaluateFrame, (scene) => {
    const d = scene.draws.find((x) => x.kind === 'light');
    if (!d || !d.count) return null;
    return [d.positions[0], d.positions[1], d.positions[2], d.intensities[0], d.ranges[0], d.colors[0], d.colors[1], d.colors[2]];
  }, { from: 0, to: duration - 1, stride: 1 });

  const live = seq.filter((s) => s.value);
  if (!live.length) {
    L.push('-- the light was never on, so nothing was exported');
    return;
  }
  L.push(`local ${id}_att = Instance.new("Attachment")`);
  L.push(`${id}_att.Parent = anchor`);
  L.push(`local ${id} = Instance.new("PointLight")`);
  L.push(`${id}.Parent = ${id}_att`);
  L.push(`${id}.Enabled = false`);
  L.push(`local ${id}_KEYS = {`);
  for (const s of live) L.push(`  {${n(s.frame)},${s.value.map(n).join(',')}},`);
  L.push('}');
  L.push(`local function ${id}_update(frame)`);
  L.push(`  local best = ${id}_KEYS[1]`);
  L.push(`  for _, k in ipairs(${id}_KEYS) do if k[1] <= frame then best = k else break end end`);
  L.push(`  ${id}.Enabled = true`);
  L.push(`  ${id}_att.Position = Vector3.new(best[2], best[3], best[4])`);
  L.push(`  ${id}.Brightness = best[5]`);
  L.push(`  ${id}.Range = math.clamp(best[6], 0, ${BAKE.ROBLOX_LIMITS.lightRange})`);
  L.push(`  ${id}.Color = Color3.new(math.clamp(best[7],0,1), math.clamp(best[8],0,1), math.clamp(best[9],0,1))`);
  L.push('end');
  L.push(`local function ${id}_stop() ${id}.Enabled = false end`);
  L.push(`PASSES[#PASSES + 1] = { update = ${id}_update, stop = ${id}_stop }`);
  notes.push(`Pass ${row.index + 1} exports as a PointLight with its position, brightness, range and colour baked per frame.`);
}

// ---------------------------------------------------------------- beams
function emitBeam(L, notes, cmd, row, id, { duration, evaluateFrame }) {
  // A Roblox Beam runs between two attachments, so the export takes the strip's endpoints per frame and
  // its width/colour from the strip's own parameterisation. A many-segment curve is genuinely lossy
  // here — Beam has CurveSize0/1 and nothing more — and the note says so.
  const seq = BAKE.bakeTransformSequence(evaluateFrame, (scene) => {
    const d = scene.draws.find((x) => x.kind === 'beam' || x.kind === 'trail');
    if (!d || !d.strips.length) return null;
    const s = d.strips[0];
    const last = s.count - 1;
    return [
      s.positions[0], s.positions[1], s.positions[2],
      s.positions[last * 3], s.positions[last * 3 + 1], s.positions[last * 3 + 2],
      s.widths[0], s.widths[last],
      s.colors[0], s.colors[1], s.colors[2],
    ];
  }, { from: 0, to: duration - 1, stride: 1 });

  const live = seq.filter((s) => s.value);
  if (!live.length) {
    L.push('-- the beam was never drawn, so nothing was exported');
    return;
  }
  const segments = 0;
  L.push(`local ${id}_a0 = Instance.new("Attachment"); ${id}_a0.Parent = anchor`);
  L.push(`local ${id}_a1 = Instance.new("Attachment"); ${id}_a1.Parent = anchor`);
  L.push(`local ${id} = Instance.new("Beam")`);
  L.push(`${id}.Attachment0 = ${id}_a0; ${id}.Attachment1 = ${id}_a1`);
  L.push(`${id}.Parent = anchor`);
  L.push(`${id}.Enabled = false`);
  L.push(`${id}.FaceCamera = true`);
  L.push(`${id}.LightEmission = ${cmd.material?.blend === 'additive' ? '1' : '0'}`);
  if (cmd.settings?.textureFlow) L.push(`${id}.TextureSpeed = ${n(cmd.settings.textureFlow)}`);
  L.push(`local ${id}_KEYS = {`);
  for (const s of live) L.push(`  {${n(s.frame)},${s.value.map(n).join(',')}},`);
  L.push('}');
  L.push(`local function ${id}_update(frame)`);
  L.push(`  local best = ${id}_KEYS[1]`);
  L.push(`  for _, k in ipairs(${id}_KEYS) do if k[1] <= frame then best = k else break end end`);
  L.push(`  ${id}.Enabled = true`);
  L.push(`  ${id}_a0.Position = Vector3.new(best[2], best[3], best[4])`);
  L.push(`  ${id}_a1.Position = Vector3.new(best[5], best[6], best[7])`);
  L.push(`  ${id}.Width0 = best[8]; ${id}.Width1 = best[9]`);
  L.push(`  ${id}.Color = ColorSequence.new(Color3.new(math.clamp(best[10],0,1), math.clamp(best[11],0,1), math.clamp(best[12],0,1)))`);
  L.push('end');
  L.push(`local function ${id}_stop() ${id}.Enabled = false end`);
  L.push(`PASSES[#PASSES + 1] = { update = ${id}_update, stop = ${id}_stop }`);
  notes.push(`Pass ${row.index + 1} exports as a Roblox Beam between its two endpoints. A Beam is a straight camera-facing strip, so any curvature in the original is lost.`);
}
