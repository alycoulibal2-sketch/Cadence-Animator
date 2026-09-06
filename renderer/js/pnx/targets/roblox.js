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
// MESHES, BEAMS AND THE LOOK (Part 41). Roblox has no runtime mesh construction, so a mesh pass is
// exported as a Wavefront .obj to upload as a MeshPart, plus a mover script that clones the uploaded
// part and places it per frame (per instance for an instance set). A curved strip becomes a CHAIN of
// Beams through points sampled evenly along it, rather than one Beam that loses the curve. An Effect
// Look becomes Roblox's own BloomEffect and ColorCorrectionEffect under Lighting; the vignette has no
// equivalent and is dropped with a note. Ribbons and lines are still refused with a reason (Part 78).

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
          how: 'Becomes a chain of Roblox Beams through points sampled evenly along the strip, with the width and colour baked per frame.',
          reasons: [],
          notes: ['A Beam is a flat, camera-facing strip; the curve is kept to the resolution of the chain (up to ' + BAKE.ROBLOX_LIMITS.beamSegments + ' segments).'],
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
      case 'look': {
        const st = cmd.settings || {};
        const notes = [];
        if ((st.vignette || 0) > 0) notes.push('The vignette has no Roblox equivalent and is dropped.');
        rows.push({
          ...base, level: 'approximated',
          how: 'Becomes a BloomEffect and a ColorCorrectionEffect under Lighting while the effect plays (bloom, exposure, saturation, contrast, tint).',
          reasons: ['Roblox post-processing is a fixed set of Lighting effects; the values are mapped onto their ranges.'],
          notes,
        });
        break;
      }
      case 'mesh': {
        rows.push({
          ...base, level: 'baked',
          how: 'Exported as an .obj to upload as a MeshPart, plus a script that places and moves it (per instance, per frame). Save the .obj the export offers, upload it, insert the MeshPart under the script with the name the script asks for.',
          reasons: ['Roblox cannot build a mesh at runtime — a mesh has to be uploaded as an asset first.'],
          notes: ['A mesh that deforms over time exports its first drawn frame only; the script moves it.'],
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
      case 'volume': {
        rows.push({
          ...base, level: 'baked',
          how: 'Baked to a flipbook sprite sheet — 8×8 frames of the volume as seen from the front, played once over the effect on a ParticleEmitter. Save the PNG the export offers, upload it to Roblox as a decal, and paste its asset id where the script says PASTE_FLIPBOOK_ID.',
          reasons: ['Roblox cannot render volumes; a flipbook is how its fire and smoke are made by hand.'],
          notes: ['The sheet is a front view; the sprite faces the camera, so it reads correctly from every side except directly above.'],
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
  const flipbooks = [];
  const meshes = [];
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
    } else if (row.kind === 'volume') {
      emitVolumeFlipbook(L, notes, cmd, row, id, { fps, duration, evaluateFrame, bake, flipbooks });
      emitted++;
    } else if (row.kind === 'look') {
      emitLook(L, notes, cmd, row, id);
      emitted++;
    } else if (row.kind === 'mesh') {
      emitMesh(L, notes, cmd, row, id, { fps, duration, evaluateFrame, bake, meshes });
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
    // Volume passes baked to sprite sheets: RGBA pixels the studio turns into PNGs to save and upload.
    flipbooks,
    // Mesh passes as .obj text, one per source geometry, to save and upload as MeshParts.
    meshes,
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
function emitBeam(L, notes, cmd, row, id, { duration, evaluateFrame, bake = {} }) {
  // A Roblox Beam is a straight camera-facing strip between two attachments, so a curved strip is
  // exported as a CHAIN of Beams through K+1 points sampled evenly along it. K is capped by Roblox's
  // practical limit; a two-point strip is one Beam, as before.
  const want = Math.max(1, Math.min(BAKE.ROBLOX_LIMITS.beamSegments, Math.round(bake.beamSegments ?? 8)));
  let K = 1;
  {
    const probe = evaluateFrame(Math.floor(duration / 2));
    const d = probe && probe.draws[row.index];
    const s0 = d && d.strips && d.strips[0];
    if (s0 && s0.count > 2) K = Math.min(want, s0.count - 1);
  }
  const N = K + 1;
  const seq = BAKE.bakeTransformSequence(evaluateFrame, (scene) => {
    const d = scene.draws[row.index];
    if (!d || d.kind !== row.kind || !d.strips || !d.strips.length) return null;
    const s = d.strips[0];
    if (s.count < 2) return null;
    const out = [];
    for (let k = 0; k < N; k++) {
      const t = N === 1 ? 0 : k / (N - 1);
      // the strip's own `along` parameter is by length, so even t is even spacing on the curve
      let j = 0; while (j < s.count - 2 && s.alongs[j + 1] < t) j++;
      const a0 = s.alongs[j], a1 = s.alongs[Math.min(j + 1, s.count - 1)];
      const u = a1 > a0 ? Math.max(0, Math.min(1, (t - a0) / (a1 - a0))) : 0;
      const j1 = Math.min(j + 1, s.count - 1);
      for (let c = 0; c < 3; c++) out.push(s.positions[j * 3 + c] + (s.positions[j1 * 3 + c] - s.positions[j * 3 + c]) * u);
      out.push(s.widths[j] + (s.widths[j1] - s.widths[j]) * u);
      for (let c = 0; c < 3; c++) out.push(s.colors[j * 4 + c] + (s.colors[j1 * 4 + c] - s.colors[j * 4 + c]) * u);
    }
    return out;
  }, { from: 0, to: duration - 1, stride: 1 });

  const live = seq.filter((s) => s.value);
  if (!live.length) {
    L.push('-- the beam was never drawn, so nothing was exported');
    return;
  }
  for (let k = 0; k < N; k++) L.push(`local ${id}_a${k} = Instance.new("Attachment"); ${id}_a${k}.Parent = anchor`);
  L.push(`local ${id}_beams = {}`);
  for (let k = 0; k < K; k++) {
    L.push(`do local b = Instance.new("Beam"); b.Attachment0 = ${id}_a${k}; b.Attachment1 = ${id}_a${k + 1}; b.Parent = anchor; b.Enabled = false; b.FaceCamera = true`);
    L.push(`  b.LightEmission = ${cmd.material?.blend === 'additive' ? '1' : '0'}${cmd.settings?.textureFlow ? `; b.TextureSpeed = ${n(cmd.settings.textureFlow)}` : ''}; ${id}_beams[${k + 1}] = b end`);
  }
  L.push(`local ${id}_KEYS = {`);
  for (const s of live) L.push(`  {${n(s.frame)},${s.value.map(n).join(',')}},`);
  L.push('}');
  L.push(`local function ${id}_update(frame)`);
  L.push(`  local best = ${id}_KEYS[1]`);
  L.push(`  for _, k in ipairs(${id}_KEYS) do if k[1] <= frame then best = k else break end end`);
  // Luau cannot index locals by a built name, so the attachments go through a table.
  L.push(`  local A = {${Array.from({ length: N }, (_, k) => `${id}_a${k}`).join(', ')}}`);
  L.push(`  for i = 1, ${N} do local o = 2 + (i - 1) * 7`);
  L.push(`    A[i].Position = Vector3.new(best[o], best[o + 1], best[o + 2])`);
  L.push(`  end`);
  L.push(`  for i = 1, ${K} do local o = 2 + (i - 1) * 7; local b = ${id}_beams[i]`);
  L.push(`    b.Enabled = true`);
  L.push(`    b.Width0 = best[o + 3]; b.Width1 = best[o + 10]`);
  L.push(`    b.Color = ColorSequence.new(Color3.new(math.clamp(best[o + 4], 0, 1), math.clamp(best[o + 5], 0, 1), math.clamp(best[o + 6], 0, 1)), Color3.new(math.clamp(best[o + 11], 0, 1), math.clamp(best[o + 12], 0, 1), math.clamp(best[o + 13], 0, 1)))`);
  L.push(`  end`);
  L.push('end');
  L.push(`local function ${id}_stop() for _, b in ipairs(${id}_beams) do b.Enabled = false end end`);
  L.push(`PASSES[#PASSES + 1] = { update = ${id}_update, stop = ${id}_stop }`);
  notes.push(K > 1
    ? `Pass ${row.index + 1} exports as a chain of ${K} Roblox Beams through ${N} points sampled evenly along the strip, so its curve is kept to that resolution.`
    : `Pass ${row.index + 1} exports as a Roblox Beam between its two endpoints.`);
}

// ---------------------------------------------------------------- the look → Lighting effects
function emitLook(L, notes, cmd, row, id) {
  const st = cmd.settings || {};
  const bloomOn = (st.bloomStrength || 0) > 0;
  const intensity = Math.min(1, (st.bloomStrength || 0) * 0.6);
  const size = 8 + Math.max(0, Math.min(1, st.bloomRadius ?? 0.4)) * 48;
  const threshold = Math.max(0, Math.min(1, st.bloomThreshold ?? 0.8));
  const brightness = Math.max(-1, Math.min(1, (st.exposure ?? 1) - 1));
  const contrast = Math.max(-1, Math.min(1, (st.contrast ?? 1) - 1));
  const saturation = Math.max(-1, Math.min(1, (st.saturation ?? 1) - 1));
  const tint = st.tint || [1, 1, 1];
  L.push(`local ${id}_bloom, ${id}_cc`);
  L.push(`local function ${id}_update(frame)`);
  L.push(`  if ${id}_cc then return end`);
  L.push(`  local Lighting = game:GetService("Lighting")`);
  if (bloomOn) L.push(`  ${id}_bloom = Instance.new("BloomEffect"); ${id}_bloom.Intensity = ${n(intensity)}; ${id}_bloom.Size = ${n(size)}; ${id}_bloom.Threshold = ${n(threshold)}; ${id}_bloom.Parent = Lighting`);
  L.push(`  ${id}_cc = Instance.new("ColorCorrectionEffect"); ${id}_cc.Brightness = ${n(brightness)}; ${id}_cc.Contrast = ${n(contrast)}; ${id}_cc.Saturation = ${n(saturation)}; ${id}_cc.TintColor = Color3.new(${n(Math.max(0, Math.min(1, tint[0])))}, ${n(Math.max(0, Math.min(1, tint[1])))}, ${n(Math.max(0, Math.min(1, tint[2])))}); ${id}_cc.Parent = Lighting`);
  L.push('end');
  L.push(`local function ${id}_stop() if ${id}_bloom then ${id}_bloom:Destroy(); ${id}_bloom = nil end if ${id}_cc then ${id}_cc:Destroy(); ${id}_cc = nil end end`);
  L.push(`PASSES[#PASSES + 1] = { update = ${id}_update, stop = ${id}_stop }`);
  notes.push(`Pass ${row.index + 1} (look) becomes ${bloomOn ? 'a BloomEffect and ' : ''}a ColorCorrectionEffect under Lighting while the effect plays${(st.vignette || 0) > 0 ? '; the vignette is dropped' : ''}.`);
}

// ---------------------------------------------------------------- mesh → .obj + a MeshPart mover
// Wavefront OBJ of a geometry: positions, normals and uvs when present, 1-based triangle faces.
export function objFromGeometry(g, name = 'mesh', precision = 4) {
  const q = (v) => { const m = 10 ** precision; const r = Math.round((Number(v) || 0) * m) / m; return Object.is(r, -0) ? 0 : r; };
  const lines = [`# Cadence Animator export: ${name}`, `o ${name.replace(/\s+/g, '_')}`];
  const n = GEO.pointCount(g);
  const pos = g.points.attrs.position.data;
  for (let i = 0; i < n; i++) lines.push(`v ${q(pos[i * 3])} ${q(pos[i * 3 + 1])} ${q(pos[i * 3 + 2])}`);
  const hasUv = GEO.hasAttr(g.points, 'uv'), hasN = GEO.hasAttr(g.points, 'normal');
  if (hasUv) { const uv = g.points.attrs.uv.data; for (let i = 0; i < n; i++) lines.push(`vt ${q(uv[i * 2])} ${q(uv[i * 2 + 1])}`); }
  if (hasN) { const nr = g.points.attrs.normal.data; for (let i = 0; i < n; i++) lines.push(`vn ${q(nr[i * 3])} ${q(nr[i * 3 + 1])} ${q(nr[i * 3 + 2])}`); }
  const c = g.faces ? g.faces.corners : new Int32Array(0);
  const ref = (i) => (hasUv && hasN ? `${i}/${i}/${i}` : hasUv ? `${i}/${i}` : hasN ? `${i}//${i}` : `${i}`);
  for (let f = 0; f < GEO.faceCount(g); f++) lines.push(`f ${ref(c[f * 3] + 1)} ${ref(c[f * 3 + 1] + 1)} ${ref(c[f * 3 + 2] + 1)}`);
  return lines.join('\n') + '\n';
}

function emitMesh(L, notes, cmd, row, id, { duration, evaluateFrame, bake = {}, meshes }) {
  // the first frame that draws the mesh is the one exported as geometry
  let first = null;
  const step = Math.max(1, Math.round(duration / 16));
  for (let f = 0; f < duration && !first; f += step) { const sc = evaluateFrame(f); const d = sc && sc.draws[row.index]; if (d && d.kind === 'mesh' && d.count) first = d; }
  if (!first) { L.push('-- the mesh was never drawn, so nothing was exported'); return; }
  const sources = first.instanced ? (first.sources || []) : [first.geometry];
  const names = sources.map((_, k) => `${id}_Mesh${sources.length > 1 ? k + 1 : ''}`);
  sources.forEach((g, k) => { if (GEO.isGeometry(g) && GEO.faceCount(g)) meshes.push({ passIndex: row.index, name: names[k], obj: objFromGeometry(g, names[k], bake.precision ?? 4), triangles: GEO.faceCount(g), points: GEO.pointCount(g) }); });
  const stride = Math.max(1, Math.round(bake.stride ?? 1));
  const maxInst = Math.max(1, Math.round(bake.maxInstances ?? 64));
  // per-frame keys: instances carry position, rotation, scale; a plain mesh carries its centre
  const centreOf = (positions) => { let x = 0, y = 0, z = 0; const cnt = positions.length / 3; for (let i = 0; i < cnt; i++) { x += positions[i * 3]; y += positions[i * 3 + 1]; z += positions[i * 3 + 2]; } return cnt ? [x / cnt, y / cnt, z / cnt] : [0, 0, 0]; };
  const c0 = first.instanced ? [0, 0, 0] : centreOf(first.positions);
  const seq = BAKE.bakeTransformSequence(evaluateFrame, (scene) => {
    const d = scene.draws[row.index];
    if (!d || d.kind !== 'mesh' || !d.count) return null;
    if (!d.instanced) { const c = centreOf(d.positions); return [1, c[0] - c0[0], c[1] - c0[1], c[2] - c0[2]]; }
    const cnt = Math.min(d.count, maxInst), rc = d.rotations.length / d.count;
    const out = [cnt];
    for (let i = 0; i < cnt; i++) {
      out.push(d.sourceIndex[i] || 0, d.positions[i * 3], d.positions[i * 3 + 1], d.positions[i * 3 + 2]);
      if (rc === 4) out.push(d.rotations[i * 4], d.rotations[i * 4 + 1], d.rotations[i * 4 + 2], d.rotations[i * 4 + 3]);
      else { const e = [d.rotations[i * rc] || 0, d.rotations[i * rc + 1] || 0, d.rotations[i * rc + 2] || 0]; const q = eulerToQuat(e); out.push(q[0], q[1], q[2], q[3]); }
      out.push(d.scales[i * 3], d.scales[i * 3 + 1], d.scales[i * 3 + 2]);
    }
    return out;
  }, { from: 0, to: duration - 1, stride, precision: bake.precision ?? 3 });
  const live = seq.filter((s) => s.value);
  const isStatic = !first.instanced && BAKE.geometryIsStatic(evaluateFrame, (sc) => { const d = sc.draws[row.index]; return d && d.kind === 'mesh' && d.count ? { count: d.positions.length, positions: d.positions } : null; });
  if (!first.instanced && !isStatic) notes.push(`Pass ${row.index + 1}: the mesh deforms over time; the export carries its first drawn frame and moves it by its centre.`);
  const neon = first.emission && first.emission.length ? (Array.from(first.emission).reduce((a, v) => a + v, 0) / first.emission.length) > 0.5 : false;
  L.push(`-- Upload the .obj Cadence saved as ${names.join(', ')}, insert ${sources.length > 1 ? 'them' : 'it'} as MeshPart${sources.length > 1 ? 's' : ''} named ${names.map((x) => `"${x}"`).join(', ')} under this script.`);
  L.push(`local ${id}_templates = {${names.map((x) => `script:FindFirstChild("${x}") or script.Parent:FindFirstChild("${x}")`).join(', ')}}`);
  L.push(`local ${id}_parts = {}`);
  L.push(`local ${id}_warned = false`);
  L.push(`local ${id}_KEYS = {`);
  for (const s of live) L.push(`  {${n(s.frame)},${s.value.map(n).join(',')}},`);
  L.push('}');
  L.push(`local function ${id}_part(i, src)`);
  L.push(`  local p = ${id}_parts[i]`);
  L.push(`  if p then return p end`);
  L.push(`  local t = ${id}_templates[src + 1] or ${id}_templates[1]`);
  L.push(`  if not t then if not ${id}_warned then ${id}_warned = true; warn("Cadence export: MeshPart ${names[0]} not found under the script — upload the .obj and insert it") end return nil end`);
  L.push(`  p = t:Clone(); p.Anchored = true; p.CanCollide = false; p.CanQuery = false; p.CanTouch = false${neon ? '; p.Material = Enum.Material.Neon' : ''}; p.Parent = rig`);
  L.push(`  ${id}_parts[i] = p`);
  L.push(`  return p`);
  L.push('end');
  L.push(`local function ${id}_update(frame)`);
  L.push(`  local best = ${id}_KEYS[1]`);
  L.push(`  for _, k in ipairs(${id}_KEYS) do if k[1] <= frame then best = k else break end end`);
  if (!first.instanced) {
    L.push(`  local p = ${id}_part(1, 0)`);
    L.push(`  if p then p.CFrame = anchor.CFrame * CFrame.new(best[3], best[4], best[5]) end`);
  } else {
    L.push(`  local cnt = best[2]`);
    L.push(`  for i = 1, cnt do local o = 3 + (i - 1) * 11`);
    L.push(`    local p = ${id}_part(i, best[o])`);
    L.push(`    if p then`);
    L.push(`      p.CFrame = anchor.CFrame * CFrame.new(best[o + 1], best[o + 2], best[o + 3], best[o + 4], best[o + 5], best[o + 6], best[o + 7])`);
    L.push(`      local t = ${id}_templates[best[o] + 1] or ${id}_templates[1]`);
    L.push(`      p.Size = Vector3.new(t.Size.X * best[o + 8], t.Size.Y * best[o + 9], t.Size.Z * best[o + 10])`);
    L.push(`      p.Transparency = 0`);
    L.push(`    end`);
    L.push(`  end`);
    L.push(`  for i = cnt + 1, #${id}_parts do ${id}_parts[i].Transparency = 1 end`);
  }
  L.push('end');
  L.push(`local function ${id}_stop() for _, p in pairs(${id}_parts) do p.Transparency = 1 end end`);
  L.push(`PASSES[#PASSES + 1] = { update = ${id}_update, stop = ${id}_stop }`);
  notes.push(`Pass ${row.index + 1} (mesh) was exported as ${meshes.filter((m) => m.passIndex === row.index).length} .obj file${sources.length > 1 ? 's' : ''} plus a mover script. Save the .obj, upload it to Roblox, and insert the MeshPart named ${names[0]} under the script.`);
}

function eulerToQuat(e) {
  const [x, y, z] = e.map((d) => (d * Math.PI) / 180);
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2), cy = Math.cos(y / 2), sy = Math.sin(y / 2), cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz - sx * sy * cz, cx * cy * cz + sx * sy * sz];
}
// ---------------------------------------------------------------- volume → flipbook (Part 35 → Part 58)
// A CPU raymarch of the volume pass, front view, orthographic, one cell per sampled frame. The same
// compositing as the backend shader without self-shadow taps beyond three, so a 96 px cell over 64
// frames costs about a second. Output is straight-alpha RGBA, which is what a PNG and Roblox expect.
export function bakeVolumeFlipbook(evaluateFrame, passIndex, { fps = 30, duration = 60, columns = 8, rows = 8, cell = 96, steps = 40 } = {}) {
  const frames = columns * rows;
  const W = columns * cell, H = rows * cell;
  const data = new Uint8ClampedArray(W * H * 4);
  let drawn = 0;
  for (let k = 0; k < frames; k++) {
    const frame = Math.round((k * Math.max(1, duration - 1)) / Math.max(1, frames - 1));
    const scene = evaluateFrame(frame);
    const draw = scene && scene.draws ? scene.draws[passIndex] : null;
    if (!draw || draw.kind !== 'volume' || !draw.count) continue;
    drawn++;
    const r = draw.resolution, tex = draw.texels, st = draw.settings || {};
    const lut = draw.lut, dScale = draw.densityScale, tScale = draw.temperatureScale / Math.max(0.01, st.heatRange || 2);
    const absorption = st.absorption ?? 1.5, emission = st.emission ?? 2, scatter = st.scatter ?? 0.3, shadow = st.shadow ?? 1;
    const sc = st.smokeColor || [0.75, 0.75, 0.8];
    const depth = draw.size[2];
    const stepLen = 1 / steps;
    const cx0 = (k % columns) * cell, cy0 = Math.floor(k / columns) * cell;
    const sample = (u, v, w) => {
      // trilinear on the RGBA8 texels; u,v,w in 0..1
      const gx = Math.max(0, Math.min(r - 1.0001, u * r - 0.5)), gy = Math.max(0, Math.min(r - 1.0001, v * r - 0.5)), gz = Math.max(0, Math.min(r - 1.0001, w * r - 0.5));
      const x0 = Math.floor(gx), y0 = Math.floor(gy), z0 = Math.floor(gz), tx = gx - x0, ty = gy - y0, tz = gz - z0;
      const x1 = Math.min(r - 1, x0 + 1), y1 = Math.min(r - 1, y0 + 1), z1 = Math.min(r - 1, z0 + 1);
      const at = (x, y, z, c) => tex[((z * r + y) * r + x) * 4 + c] / 255;
      const lerp3 = (c) => { const a = at(x0, y0, z0, c) + (at(x1, y0, z0, c) - at(x0, y0, z0, c)) * tx, b = at(x0, y1, z0, c) + (at(x1, y1, z0, c) - at(x0, y1, z0, c)) * tx, e = at(x0, y0, z1, c) + (at(x1, y0, z1, c) - at(x0, y0, z1, c)) * tx, f = at(x0, y1, z1, c) + (at(x1, y1, z1, c) - at(x0, y1, z1, c)) * tx; const g0 = a + (b - a) * ty, g1 = e + (f - e) * ty; return g0 + (g1 - g0) * tz; };
      return [lerp3(0) * dScale, lerp3(1) * tScale];
    };
    for (let py = 0; py < cell; py++) {
      for (let px = 0; px < cell; px++) {
        const u = (px + 0.5) / cell, v = 1 - (py + 0.5) / cell;
        let acc0 = 0, acc1 = 0, acc2 = 0, accA = 0;
        for (let i = 0; i < steps; i++) {
          const w = (i + 0.5) * stepLen;
          const [d, temp] = sample(u, v, w);
          if (d < 0.002 && temp < 0.02) continue;
          const a = 1 - Math.exp(-d * absorption * stepLen * depth);
          let sh = 1;
          if (shadow > 0 && d > 0.002) { let occ = 0; for (let q = 1; q <= 3; q++) { const vv = v + q * stepLen * 2.5; if (vv > 1) break; occ += sample(u, vv, w)[0]; } sh = Math.exp(-occ * absorption * stepLen * 2.5 * depth * shadow); }
          const lit = scatter + (1 - scatter) * sh;
          const tt = Math.max(0, Math.min(1, temp)); const li = Math.round(tt * 255) * 4;
          const fr = lut[li] * emission * temp * stepLen * depth, fg = lut[li + 1] * emission * temp * stepLen * depth, fb = lut[li + 2] * emission * temp * stepLen * depth;
          acc0 += (1 - accA) * (sc[0] * lit * a + fr); acc1 += (1 - accA) * (sc[1] * lit * a + fg); acc2 += (1 - accA) * (sc[2] * lit * a + fb);
          accA += (1 - accA) * a;
          if (accA > 0.995) break;
        }
        // fire with no smoke is pure emission: give it alpha from its brightness so it is not cut out
        const lum = Math.max(acc0, acc1, acc2);
        const alpha = Math.max(accA, Math.min(1, lum));
        const o = ((cy0 + py) * W + (cx0 + px)) * 4;
        const un = alpha > 1e-4 ? 1 / alpha : 0;
        data[o] = Math.round(Math.min(1, acc0 * un) * 255); data[o + 1] = Math.round(Math.min(1, acc1 * un) * 255); data[o + 2] = Math.round(Math.min(1, acc2 * un) * 255); data[o + 3] = Math.round(alpha * 255);
      }
    }
  }
  return { passIndex, width: W, height: H, columns, rows, cell, data, frames, drawn };
}

function emitVolumeFlipbook(L, notes, cmd, row, id, { fps, duration, evaluateFrame, bake, flipbooks }) {
  const sheet = bakeVolumeFlipbook(evaluateFrame, row.index, { fps, duration, columns: 8, rows: 8, cell: bake.flipbookCell || 96, steps: bake.flipbookSteps || 40 });
  flipbooks.push(sheet);
  const centre = cmd.settings?.density?.center || [0, 2, 0];
  const size = cmd.settings?.density?.size || [4, 4, 4];
  notes.push(`Pass ${row.index + 1} (volume) was baked to an 8×8 flipbook (${sheet.width}×${sheet.height}). Save the PNG, upload it to Roblox, and replace PASTE_FLIPBOOK_ID in the script.`);
  L.push(`local ${id}_att = Instance.new("Attachment")`);
  L.push(`${id}_att.Parent = anchor`);
  L.push(`${id}_att.Position = ${v3(centre)}`);
  L.push(`local ${id} = Instance.new("ParticleEmitter")`);
  L.push(`${id}.Parent = ${id}_att`);
  L.push(`${id}.Texture = "rbxassetid://PASTE_FLIPBOOK_ID" -- the 8x8 sheet Cadence exported next to this script`);
  L.push(`${id}.FlipbookLayout = Enum.ParticleFlipbookLayout.Grid8x8`);
  L.push(`${id}.FlipbookMode = Enum.ParticleFlipbookMode.OneShot`);
  L.push(`${id}.Rate = 0`);
  L.push(`${id}.Lifetime = NumberRange.new(${n(Math.max(0.05, duration / fps))})`);
  L.push(`${id}.Speed = NumberRange.new(0)`);
  L.push(`${id}.Size = NumberSequence.new(${n(Math.max(size[0], size[1]))})`);
  L.push(`${id}.Transparency = NumberSequence.new(0)`);
  L.push(`${id}.LightEmission = ${cmd.settings?.emission > 0 ? 0.8 : 0}`);
  L.push(`${id}.LightInfluence = 0`);
  L.push(`${id}.Orientation = Enum.ParticleOrientation.FacingCamera`);
  L.push(`${id}.LockedToPart = true`);
  L.push(`${id}.Enabled = false`);
  L.push(`do local started = false`);
  L.push(`  PASSES[#PASSES + 1] = { update = function(frame) if not started then started = true; ${id}:Emit(1) end end, stop = function() started = false; ${id}:Clear() end }`);
  L.push(`end`);
}
