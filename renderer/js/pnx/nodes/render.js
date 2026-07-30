// Material and renderer nodes (spec Parts 34, 36-39).
//
// PART 36's SEPARATION IS THE POINT: a renderer node draws nothing. It emits a render command — what
// to draw, how, with which material — and a backend consumes commands. So the same particles can be
// drawn as sprites, meshes, trails, ribbons, beams or lights by swapping one node, and adding a new
// backend requires no changes here at all.
//
// MATERIALS ARE FIELDS ALL THE WAY DOWN (Part 34). Every channel is a `field<...>`, so
// `Noise -> Color Ramp -> Emission` and `Distance Field -> Smoothstep -> Opacity` work — the two
// examples the spec gives — and so do the ones nobody has thought of. That also means there is no
// "colour over lifetime" property anywhere in this engine: Normalized Age feeds a Gradient, which
// feeds Base Colour, and the same three nodes give size over lifetime, opacity over distance, or
// emission over speed.
//
// WHY THERE IS ONE MATERIAL NODE, not one per surface type: a channel bag lets a material carry
// everything Part 34 lists while each backend honours the subset it can, and REPORTS what it dropped
// (Part 57). Defining the material by the poorest backend's abilities would make Cadence's authoring
// ceiling equal to Roblox's, which Part 2 explicitly forbids.

import * as V from '../values.js';
import * as F from '../fields.js';
import * as GEO from '../geometry.js';
import * as RENDER from '../render.js';
import { node, n, i as intIn, b as boolIn, v3, col, out, mode } from './_helpers.js';

const MAT = 'Materials';
const REN = 'Renderers';

const geoIn = (key = 'source', label = 'Particles / Points') => ({ key, label, type: 'geometry' });
const matIn = () => ({ key: 'material', label: 'Material', type: 'material', description: 'Leave unconnected for plain white.' });
const cmdOut = () => ({ key: 'out', label: 'Render', type: 'renderCommand' });

// ---------------------------------------------------------------- the material
node({
  id: 'cadence.material.surface', label: 'Material', category: MAT, subcategory: 'Build',
  aliases: ['shader', 'surface', 'look', 'appearance', 'colour', 'color', 'emission', 'opacity', 'shading'],
  summary: 'Describes what something looks like: its colour, how bright it glows, how see-through it is.',
  teach: 'Sets the colour and brightness of whatever you are drawing. Every setting can vary per particle.',
  explain: 'Every channel accepts a field, so a colour can depend on a particle\'s age, its speed, where it is, or any attribute it carries — which is why this engine has no separate "colour over lifetime" control. Feed Normalized Age into a Gradient and into Base Colour instead, and the same pattern gives you every other over-lifetime curve. Channels a backend cannot reproduce are reported rather than silently dropped: check the Render Report.',
  commonUses: ['a glowing additive spark', 'smoke that fades as it ages', 'a shield whose edge lights up where it is grazed'],
  exportSupport: 'converted',
  exportNote: 'Colour and opacity map onto Roblox natively. Emission is approximated with a bright colour plus additive blending; the physically-based channels have no Roblox equivalent.',
  inputs: [
    { key: 'baseColor', label: 'Base colour', type: 'field<color>', default: [1, 1, 1, 1] },
    { key: 'emission', label: 'Emission', type: 'field<color>', default: [0, 0, 0, 1], description: 'Light the surface gives off on its own. Values above 1 bloom.' },
    { key: 'opacity', label: 'Opacity', type: 'field<float>', default: 1, min: 0, max: 1 },
    mode('blend', 'Blending', RENDER.BLEND_MODES, 'normal'),
    { key: 'roughness', label: 'Roughness', type: 'field<float>', default: 0.5, min: 0, max: 1 },
    { key: 'metallic', label: 'Metallic', type: 'field<float>', default: 0, min: 0, max: 1 },
    { key: 'normal', label: 'Normal', type: 'field<vector3>', default: [0, 0, 1] },
    { key: 'texture', label: 'Texture', type: 'texture2d',
      description: 'An image for the surface, built by the Textures nodes or sampled from one. Multiplies the base colour.' },
    boolIn('doubleSided', 'Double sided', true),
    boolIn('depthWrite', 'Write depth', false, { description: 'Off is right for glows and smoke, which should not hide each other. On is right for solid geometry.' }),
  ],
  outputs: [{ key: 'out', label: 'Material', type: 'material' }],
  evaluate: (api, i) => RENDER.newMaterial({
    baseColor: i.baseColor,
    emission: i.emission,
    opacity: i.opacity,
    roughness: i.roughness,
    metallic: i.metallic,
    normal: i.normal,
  }, {
    blend: i.blend,
    doubleSided: i.doubleSided,
    depthWrite: i.depthWrite,
    // The texture rides on the material rather than being one of its channels, because a backend BINDS
    // a texture (three.js as a map, Roblox as an asset id) rather than evaluating it per element.
    texture: i.texture || null,
  }),
});

node({
  id: 'cadence.material.physical', label: 'Advanced Material Channels', category: MAT, subcategory: 'Build',
  aliases: ['pbr', 'glass', 'refraction', 'transmission', 'ior', 'subsurface', 'physically based'],
  summary: 'Adds the physically-based channels to a material: transmission, refraction, index of refraction, scattering.',
  explain: 'Separate from the main Material node because no current backend honours these — the studio preview cannot refract and neither can Roblox. They are carried through the graph, reported honestly by the Render Report as unsupported, and will light up when a backend that can do them exists. Nothing here silently does nothing without saying so.',
  exportSupport: 'unsupported',
  exportNote: 'No backend reproduces these channels yet. They are carried and reported, never quietly discarded.',
  inputs: [
    matIn(),
    { key: 'transmission', label: 'Transmission', type: 'field<float>', default: 0, min: 0, max: 1 },
    { key: 'refraction', label: 'Refraction', type: 'field<float>', default: 0, min: 0, max: 1 },
    { key: 'ior', label: 'Index of refraction', type: 'field<float>', default: 1.45, min: 1, max: 3 },
    { key: 'absorption', label: 'Absorption', type: 'field<float>', default: 0, min: 0 },
    { key: 'scattering', label: 'Scattering', type: 'field<float>', default: 0, min: 0 },
    { key: 'fresnel', label: 'Fresnel', type: 'field<float>', default: 0, min: 0, max: 1 },
  ],
  outputs: [{ key: 'out', label: 'Material', type: 'material' }],
  evaluate: (api, i) => {
    const base = RENDER.isMaterial(i.material) ? i.material : RENDER.DEFAULT_MATERIAL;
    api.note('The physically-based channels are carried but not yet drawn by any backend. The Render Report lists them as unsupported.');
    return RENDER.newMaterial({
      ...base.channels,
      transmission: i.transmission,
      refraction: i.refraction,
      ior: i.ior,
      absorption: i.absorption,
      scattering: i.scattering,
      fresnel: i.fresnel,
    }, base);
  },
});

// ---------------------------------------------------------------- sprite / point renderers (Part 37)
node({
  id: 'cadence.render.sprite', label: 'Sprite Renderer', category: REN, subcategory: 'Points',
  aliases: ['billboard', 'draw particles', 'quad', 'flipbook', 'card', 'puff', 'draw', 'render particles'],
  summary: 'Draws each point as a flat image that faces the camera.',
  teach: 'Turns points into visible puffs or sparks. The commonest way to draw particles.',
  explain: 'Facing decides how the quad is turned. Camera-facing is the default and reads as a soft round puff. Velocity-facing stretches along the direction of travel, which is what makes a spark read as a streak rather than a dot. Size accepts a field, so Normalized Age into a Curve into Size gives growth and shrink without a dedicated control.',
  commonUses: ['smoke puffs', 'sparks and embers', 'flipbook explosions'],
  exportSupport: 'native',
  exportNote: 'Maps directly onto a Roblox ParticleEmitter, which is the one part of this engine Roblox reproduces natively.',
  inputs: [
    geoIn(),
    matIn(),
    { key: 'size', label: 'Size', type: 'field<float>', default: 0.5, min: 0, unit: 'studs' },
    { key: 'rotation', label: 'Rotation', type: 'field<float>', default: 0, unit: 'degrees' },
    mode('facing', 'Facing', RENDER.FACING_MODES, 'camera'),
    v3('axis', 'Locked axis', [0, 1, 0], { description: 'Which axis the sprite keeps when Facing is set to axis.' }),
    boolIn('softParticles', 'Soft edges', true),
    intIn('flipbookColumns', 'Flipbook columns', 1, { min: 1, max: 32 }),
    intIn('flipbookRows', 'Flipbook rows', 1, { min: 1, max: 32 }),
    mode('flipbookMode', 'Flipbook timing', ['life', 'age'], 'life'),
    n('flipbookFps', 'Flipbook rate', 24, { min: 0, unit: 'per second' }),
  ],
  outputs: [cmdOut()],
  evaluate: (api, i) => {
    if (GEO.isGeometry(i.source) && !GEO.pointCount(i.source)) {
      api.note('There are no points to draw at this frame.');
    }
    return RENDER.newRenderCommand('sprite', i.source, i.material, {
      size: i.size, rotation: i.rotation, facing: i.facing, axis: i.axis,
      softParticles: i.softParticles,
      flipbookColumns: i.flipbookColumns, flipbookRows: i.flipbookRows,
      flipbookMode: i.flipbookMode, flipbookFps: i.flipbookFps,
    });
  },
});

node({
  id: 'cadence.render.point', label: 'Point Renderer', category: REN, subcategory: 'Points',
  aliases: ['dots', 'draw points', 'debug points', 'pixels', 'stars'],
  summary: 'Draws each point as a small dot.',
  explain: 'Cheaper than sprites because there is no quad to orient, and the natural choice for anything where the individual element should read as a speck: dust, stars, distant debris. Also the fastest way to see whether a scatter is producing what you expect.',
  commonUses: ['dust and motes', 'a starfield', 'checking a scatter looks right'],
  exportSupport: 'approximated',
  exportNote: 'Becomes a small-sprite ParticleEmitter; Roblox has no point primitive.',
  performance: 'cheap',
  inputs: [geoIn(), matIn(), { key: 'size', label: 'Size', type: 'field<float>', default: 0.1, min: 0, unit: 'studs' }],
  outputs: [cmdOut()],
  evaluate: (api, i) => RENDER.newRenderCommand('point', i.source, i.material, { size: i.size, facing: 'camera' }),
});

// ---------------------------------------------------------------- mesh renderer
node({
  id: 'cadence.render.mesh', label: 'Mesh Renderer', category: REN, subcategory: 'Geometry',
  aliases: ['draw mesh', 'draw geometry', 'solid', 'surface', 'render mesh', 'draw shape'],
  summary: 'Draws a geometry as a solid surface.',
  explain: 'Takes either a geometry with faces or a set of instances. Instances are drawn as instances — one copy of the shape, many transforms — so ten thousand rocks cost ten thousand transforms rather than ten thousand meshes.',
  commonUses: ['a shockwave ring', 'debris shards', 'a displaced sphere as a fireball'],
  exportSupport: 'converted',
  exportNote: 'Becomes a MeshPart or a set of Parts. Deformed geometry that changes per frame has to be baked.',
  inputs: [
    { key: 'source', label: 'Geometry', type: 'geometry' },
    { key: 'instances', label: 'Instances', type: 'instanceSet' },
    matIn(),
    boolIn('wireframe', 'Wireframe', false),
  ],
  outputs: [cmdOut()],
  evaluate: (api, i) => {
    // Instances win when both are wired: a user who connected an instance set meant to draw the
    // copies, and silently drawing the un-instanced source instead would look like the instancing
    // node having no effect.
    const source = i.instances || i.source;
    if (i.instances && i.source) api.note('Both a geometry and instances are connected, so the instances are drawn.');
    if (GEO.isGeometry(source) && !GEO.faceCount(source)) {
      api.warn('This geometry has no faces, so a Mesh Renderer draws nothing. Use a Sprite or Point Renderer for a set of points, or a Trail/Beam Renderer for a curve.');
    }
    return RENDER.newRenderCommand('mesh', source, i.material, { wireframe: i.wireframe });
  },
});

// ---------------------------------------------------------------- strips (Part 38)
// Trail, Ribbon, Beam and Line all resolve through the same path, because all four are "a polyline
// with a per-vertex width and colour". They are separate nodes only because they take their curve
// from different places, and because the names are what a user searches for.
const stripNode = (spec) => node({
  id: spec.id, label: spec.label, category: REN, subcategory: 'Strips',
  aliases: spec.aliases, summary: spec.summary, teach: spec.teach, explain: spec.explain,
  commonUses: spec.commonUses,
  exportSupport: spec.exportSupport || 'approximated',
  exportNote: spec.exportNote || 'Becomes a Roblox Beam where the shape is simple enough, and is baked otherwise.',
  performance: 'moderate',
  inputs: [
    { key: 'source', label: spec.sourceLabel || 'Curve', type: 'geometry' },
    matIn(),
    { key: 'width', label: 'Width', type: 'field<float>', default: 0.2, min: 0, unit: 'studs',
      description: 'Accepts a field. Feed the `along` attribute or UV.x through a Curve to taper it.' },
    n('smoothing', 'Smoothing', 0, { min: 0, max: 1, description: 'Rounds off hard corners. Useful on a noise-displaced path, which would otherwise read as a zigzag.' }),
    n('textureFlow', 'Texture flow', 0, { unit: 'per second', description: 'Scrolls the texture along the strip. This is what makes energy read as travelling.' }),
    n('tiling', 'Texture tiling', 1, { min: 0 }),
    n('twist', 'Twist', 0, { unit: 'degrees' }),
    ...(spec.extraInputs || []),
  ],
  outputs: [cmdOut()],
  evaluate: (api, i) => {
    if (GEO.isGeometry(i.source) && GEO.pointCount(i.source) && !GEO.curveCount(i.source)) {
      api.warn(`${spec.label} needs a curve, and this geometry has points but no curve. Put Curve From Points in front of it.`);
    }
    return RENDER.newRenderCommand(spec.kind, i.source, i.material, {
      width: i.width, smoothing: i.smoothing, textureFlow: i.textureFlow,
      tiling: i.tiling, twist: i.twist,
      ...(spec.settings ? spec.settings(i) : {}),
    });
  },
});

stripNode({
  id: 'cadence.render.trail', label: 'Trail Renderer', kind: 'trail',
  aliases: ['streak', 'tail', 'motion trail', 'comet', 'swoosh', 'wake', 'draw trail'],
  summary: 'Draws a curve as a tapering ribbon that follows its length.',
  teach: 'Draws a streak along a path, like the tail of a comet.',
  explain: 'A trail is a polyline with width. Feeding the `along` attribute through a Curve into Width is what tapers it — and because that is an ordinary curve, you get any taper shape rather than the two or three a dedicated control would offer.',
  commonUses: ['a sword swing arc', 'a comet or projectile tail', 'energy following a path'],
});

stripNode({
  id: 'cadence.render.ribbon', label: 'Ribbon Renderer', kind: 'ribbon',
  aliases: ['band', 'strip', 'flat trail', 'banner', 'cloth strip'],
  summary: 'Draws a curve as a flat band that keeps its own orientation.',
  explain: 'Unlike a trail, a ribbon does not turn to face the camera — it keeps the orientation its curve gives it, so it reads as a physical band with a front and a back. That is what you want for a banner or a flag; it is the wrong choice for a glow, which should always face the viewer.',
  commonUses: ['a banner or streamer', 'a flat energy band', 'a slash with a visible plane'],
  exportSupport: 'unsupported',
  exportNote: 'Roblox has no oriented-ribbon primitive; a ribbon must be baked to a mesh.',
});

stripNode({
  id: 'cadence.render.beam', label: 'Beam Renderer', kind: 'beam',
  aliases: ['laser', 'lightning', 'bolt', 'ray', 'link', 'connection', 'zap', 'draw beam'],
  summary: 'Draws a curve as a beam, optionally jittered along its length.',
  teach: 'Draws a laser or a lightning bolt along a path.',
  explain: 'A beam is a trail whose ends are usually pinned to two points. For lightning, displace the curve with noise before it reaches here — that keeps the jitter under the graph\'s control, so it can be animated, seeded per bolt, or driven by an impact.',
  commonUses: ['a laser between two points', 'chain lightning', 'a tether or link effect'],
  exportSupport: 'converted',
  exportNote: 'Maps onto a Roblox Beam, which supports width, colour, texture and texture speed natively.',
});

stripNode({
  id: 'cadence.render.line', label: 'Line Renderer', kind: 'line',
  aliases: ['wireframe path', 'draw curve', 'debug line', 'outline', 'thin line'],
  summary: 'Draws a curve as a thin line.',
  explain: 'One pixel wide regardless of distance, which makes it right for diagnostics and for a deliberately technical look, and wrong for anything that should have physical presence.',
  commonUses: ['seeing the shape of a curve while building it', 'a hologram wireframe'],
  exportSupport: 'unsupported',
  exportNote: 'Roblox has no thin-line primitive.',
  performance: 'cheap',
});

// ---------------------------------------------------------------- lights (Part 39)
node({
  id: 'cadence.render.light', label: 'Light Renderer', category: 'Lights', subcategory: 'Emit',
  aliases: ['point light', 'glow', 'illuminate', 'flash', 'lamp', 'flicker', 'draw light'],
  summary: 'Emits light from a point, or from every point of a geometry.',
  teach: 'Lights up the scene around it. Plug in particles and each one becomes a little light.',
  explain: 'Intensity accepts a field, which is the whole of Part 39\'s example: Normalized Age into a Curve into Intensity gives a flash that decays, with no dedicated flash control. Note that a light per particle is expensive in any real renderer — a handful of lights plus emissive sprites usually reads better than a thousand lights and costs a fraction.',
  commonUses: ['a muzzle flash that decays', 'an explosion lighting its surroundings', 'a few embers casting light'],
  exportSupport: 'converted',
  exportNote: 'Becomes a Roblox PointLight per element. Roblox limits how many lights render at once, so a high count is dropped in-game.',
  performance: 'expensive',
  inputs: [
    { key: 'source', label: 'Points', type: 'geometry', description: 'Leave unconnected for a single light at the position below.' },
    matIn(),
    v3('position', 'Position', [0, 0, 0], { unit: 'studs' }),
    { key: 'intensity', label: 'Intensity', type: 'field<float>', default: 2, min: 0 },
    { key: 'range', label: 'Range', type: 'field<float>', default: 8, min: 0, unit: 'studs' },
    n('falloff', 'Falloff', 2, { min: 0, description: '2 is how real light falls off. Lower spreads further, higher concentrates.' }),
    boolIn('shadows', 'Cast shadows', false),
  ],
  outputs: [cmdOut()],
  evaluate: (api, i) => {
    const count = GEO.isGeometry(i.source) ? GEO.pointCount(i.source) : 1;
    if (count > 64) {
      api.warn(`${count} lights is more than any real-time renderer will draw. Consider a few lights plus emissive sprites instead.`);
    }
    return RENDER.newRenderCommand('light', i.source, i.material, {
      position: i.position, intensity: i.intensity, range: i.range,
      falloff: i.falloff, shadows: i.shadows,
    });
  },
});

// ---------------------------------------------------------------- output and reporting
node({
  id: 'cadence.render.output', label: 'Effect Output', category: REN, subcategory: 'Output',
  aliases: ['output', 'final', 'result', 'render', 'effect', 'end', 'draw everything'],
  summary: 'The final output of the effect. Everything you want drawn connects here.',
  teach: 'The end of the graph. Whatever reaches this gets drawn.',
  explain: 'Takes as many render passes as you like, drawn in the order they are connected — so a smoke pass behind a spark pass behind a light pass is three wires into one socket. This is the node the preview and the exporter look for; a graph with nothing connected here draws nothing, which is the commonest reason an otherwise-correct graph appears to do nothing.',
  exportSupport: 'native',
  inputs: [{ key: 'passes', label: 'Render passes', type: 'renderCommand', multi: true }],
  outputs: [{ key: 'out', label: 'Scene', type: 'renderCommand' }],
  evaluate: (api, i) => {
    const list = RENDER.flattenCommands(i.passes);
    if (!list.length) api.warn('Nothing is connected to the Effect Output, so nothing will be drawn.');
    return list;
  },
});

node({
  id: 'cadence.render.report', label: 'Render Report', category: REN, subcategory: 'Output',
  aliases: ['statistics', 'how many', 'draw calls', 'performance', 'compatibility', 'export report', 'what is drawn'],
  summary: 'Counts what is being drawn and reports what a target platform cannot reproduce.',
  explain: 'Two questions at once, both factual. How much is being drawn (particles, triangles, lights) and what a chosen backend will change about it. A material channel a backend cannot honour is listed here rather than silently ignored, which is what Part 57 asks for — the point being that you find out before exporting, not after.',
  commonUses: ['checking a count before exporting', 'finding out which channels Roblox will drop'],
  exportSupport: 'native',
  exportNote: 'A diagnostic. It is not part of the drawn effect.',
  inputs: [
    { key: 'scene', label: 'Scene', type: 'renderCommand', multi: true },
    mode('backend', 'Target', ['preview', 'roblox'], 'preview'),
  ],
  outputs: [
    { key: 'out', label: 'Scene', type: 'renderCommand' },
    { key: 'sprites', label: 'Sprites', type: 'int' },
    { key: 'triangles', label: 'Triangles', type: 'int' },
    { key: 'lights', label: 'Lights', type: 'int' },
    { key: 'passes', label: 'Passes', type: 'int' },
    { key: 'fullySupported', label: 'Fully supported', type: 'bool' },
  ],
  evaluate: (api, i) => {
    const list = RENDER.flattenCommands(i.scene);
    const scene = RENDER.resolveScene(list, { time: 0, frame: 0 });
    const report = RENDER.backendReport(list, i.backend);

    for (const row of report.rows) {
      if (row.level === 'unsupported') {
        api.warn(`${report.backend} cannot draw a ${row.kind} pass at all — it will be baked or dropped on export.`);
      }
      if (row.droppedChannels.length) {
        api.warn(`${report.backend} ignores these material channels on the ${row.kind} pass: ${row.droppedChannels.join(', ')}.`);
      }
    }
    return {
      out: list,
      sprites: scene.stats.sprites,
      triangles: Math.round(scene.stats.triangles),
      lights: scene.stats.lights,
      passes: list.length,
      fullySupported: report.ok,
    };
  },
});
