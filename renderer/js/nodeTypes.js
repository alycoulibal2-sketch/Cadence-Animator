// The v1 node type catalog — one real, fully-compiling node per category, proving the framework
// out without attempting the full ~40-node catalog yet (Logic nodes especially: today's engine
// has no branching/event model at all, so they're not attempted here — see
// docs/vfx-studio.md). Each node's `compile(ctx, params)` mutates `ctx.layer` (an
// effectModel.js Layer the graphCompiler.js walk builds once per Create-node chain) using the
// EXACT SAME helpers the hand-editing UI and MCP tools already call (setLayerProps, addModifier)
// — a node is never a parallel reimplementation of what a layer prop already does, only a
// friendlier face on it.
//
// Node titles are plain-language concepts, never Roblox/engine class names (the user's Golden
// Rule: "could an intelligent 11-year-old understand this within 10 seconds?").

import { registerNodeType } from './nodeGraphModel.js';
import { newLayer, setLayerProps, addModifier } from './effectModel.js';

// ---------------------------------------------------------------- Create
registerNodeType('spawnParticles', {
  label: '✨ Spawn Particles', icon: '✨', category: 'Create',
  inputs: [], outputs: ['flow'],
  defaults: () => ({ rate: 25, maxParticles: 200, shape: 'glow' }),
  params: [
    { key: 'rate', label: 'How many appear per second', kind: 'number', min: 0, max: 2000, step: 1 },
    { key: 'maxParticles', label: 'Most that can exist at once', kind: 'number', min: 1, max: 2000, step: 1 },
    { key: 'shape', label: 'Look', kind: 'select', options: ['glow', 'spark', 'ring', 'star', 'smoke', 'square', 'leaf'] },
  ],
  // The one node type allowed to start a chain — it's the only compile() that creates ctx.layer
  // rather than mutating an existing one.
  compile(ctx, params) {
    ctx.layer = newLayer('emitter', 'Spawn Particles');
    setLayerProps(ctx.layer, { rate: params.rate, maxParticles: params.maxParticles, shape: params.shape });
  },
});

// ---------------------------------------------------------------- Appearance
registerNodeType('color', {
  label: '🎨 Color', icon: '🎨', category: 'Appearance',
  inputs: ['flow'], outputs: ['flow'],
  defaults: () => ({ colorStart: '#ffcc66', colorEnd: '#ff6633' }),
  params: [
    { key: 'colorStart', label: 'Color when born', kind: 'color' },
    { key: 'colorEnd', label: 'Color when it fades out', kind: 'color' },
  ],
  compile(ctx, params) {
    setLayerProps(ctx.layer, { colorStart: params.colorStart, colorEnd: params.colorEnd });
  },
});

registerNodeType('size', {
  label: '📈 Size Over Time', icon: '📈', category: 'Appearance',
  inputs: ['flow'], outputs: ['flow'],
  defaults: () => ({ sizeStart: 0.4, sizeEnd: 0.05 }),
  params: [
    { key: 'sizeStart', label: 'Size when born', kind: 'number', min: 0.005, max: 50, step: 0.01 },
    { key: 'sizeEnd', label: 'Size when it fades out', kind: 'number', min: 0.005, max: 50, step: 0.01 },
  ],
  compile(ctx, params) {
    setLayerProps(ctx.layer, { sizeStart: params.sizeStart, sizeEnd: params.sizeEnd });
  },
});

// ---------------------------------------------------------------- Motion
registerNodeType('move', {
  label: '➡ Move', icon: '➡', category: 'Motion',
  inputs: ['flow'], outputs: ['flow'],
  defaults: () => ({ motion: 'cone', speed: 3, spreadDegrees: 20 }),
  params: [
    { key: 'motion', label: 'Movement style', kind: 'select', options: ['cone', 'burst', 'rise', 'fall', 'orbit', 'ambient'] },
    { key: 'speed', label: 'Speed', kind: 'number', min: -100, max: 100, step: 0.1 },
    { key: 'spreadDegrees', label: 'Spread°', kind: 'number', min: 0, max: 90, step: 1 },
  ],
  compile(ctx, params) {
    setLayerProps(ctx.layer, { motion: params.motion, speed: params.speed, spreadDegrees: params.spreadDegrees });
  },
});

registerNodeType('orbit', {
  label: '🌀 Orbit', icon: '🌀', category: 'Motion',
  inputs: ['flow'], outputs: ['flow'],
  defaults: () => ({ speed: 2, radius: 0.6 }),
  params: [
    { key: 'speed', label: 'Swirl speed', kind: 'number', min: -30, max: 30, step: 0.1 },
    { key: 'radius', label: 'Swirl radius', kind: 'number', min: 0, max: 20, step: 0.05 },
  ],
  // Adds/tunes the engine's existing 'orbit' modifier directly on the object it returns — same
  // pattern inspector.js's own modifier-param editors already write (mod.props[key] = v).
  compile(ctx, params) {
    const mod = addModifier(ctx.layer, 'orbit');
    Object.assign(mod.props, { speed: params.speed, radius: params.radius });
  },
});

// ---------------------------------------------------------------- Physics
registerNodeType('wind', {
  label: '🌬 Wind', icon: '🌬', category: 'Physics',
  inputs: ['flow'], outputs: ['flow'],
  defaults: () => ({ direction: [1, 0, 0], strength: 1.5 }),
  params: [
    { key: 'direction', label: 'Direction', kind: 'vec3' },
    { key: 'strength', label: 'Strength', kind: 'number', min: -50, max: 50, step: 0.1 },
  ],
  compile(ctx, params) {
    const mod = addModifier(ctx.layer, 'wind');
    Object.assign(mod.props, { direction: params.direction, strength: params.strength });
  },
});

// ---------------------------------------------------------------- Timing
registerNodeType('lifetime', {
  label: '⏳ Lifetime', icon: '⏳', category: 'Timing',
  inputs: ['flow'], outputs: ['flow'],
  defaults: () => ({ lifetime: 1.2, burst: 0 }),
  params: [
    { key: 'lifetime', label: 'How long each particle lives (sec)', kind: 'number', min: 0.05, max: 30, step: 0.1 },
    { key: 'burst', label: 'Extra particles all at once when it starts', kind: 'number', min: 0, max: 500, step: 1 },
  ],
  compile(ctx, params) {
    setLayerProps(ctx.layer, { lifetime: params.lifetime, burst: params.burst });
  },
});

// ---------------------------------------------------------------- Output
registerNodeType('preview', {
  label: '👁 Preview', icon: '👁', category: 'Output',
  inputs: ['flow'], outputs: [],
  multiInput: true, // accepts one incoming chain per Create node — each becomes its own layer
  defaults: () => ({}),
  params: [],
  // Nothing to do — graphCompiler.js addLayer()s ctx.layer once the walk reaches here. Present
  // (rather than skipped) so every node in a chain, including the terminal one, goes through the
  // same uniform compile() call — a future Export-category output node can hook the same seam
  // without the compiler needing a special case.
  compile() {},
});
