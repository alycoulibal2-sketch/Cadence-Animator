#!/usr/bin/env node
'use strict';
// MCP server for Cadence Animator. Runs as a separate process (spawned by Claude Code/Desktop
// over stdio) and drives the ALREADY-RUNNING Cadence Animator app over a local HTTP channel —
// it holds no animation state itself. Launch Cadence Animator first, then connect this server.
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const MCP_PORT = 35748;
const BASE = `http://127.0.0.1:${MCP_PORT}`;

async function call(type, payload) {
  let res;
  try {
    res = await fetch(`${BASE}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload: payload || {} }),
    });
  } catch (e) {
    throw new Error(
      'Could not reach Cadence Animator. Make sure the app is running (open it, or if launched ' +
      'via npm run `npx cadence-animator`), then try again. ' + e.message,
    );
  }
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Cadence Animator reported an unknown error');
  return json.data;
}

function textResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
function errorResult(e) {
  return { content: [{ type: 'text', text: `Error: ${e.message || e}` }], isError: true };
}

const cframeSchema = z.array(z.number()).length(12)
  .describe('Flat 12-number CFrame: [x,y,z, r00,r01,r02, r10,r11,r12, r20,r21,r22] — same order as Roblox CFrame:GetComponents(). Identity is [0,0,0,1,0,0,0,1,0,0,0,1].');
const keyRefSchema = z.object({ itemId: z.string(), track: z.string(), t: z.number() });

const server = new McpServer({ name: 'cadence-animator', version: '0.1.0' });

server.tool(
  'get_state', 'Get the full current project: every item, every track, every keyframe, groups, fps, length, priority, loop, audio. The ground-truth source of what exists — read this before assuming anything about the current animation.',
  {},
  async () => { try { return textResult(await call('get_state')); } catch (e) { return errorResult(e); } },
);

server.tool(
  'list_items', 'List every item (rig or camera) in the scene with its id, name, kind, and joint/track names.',
  {},
  async () => { try { return textResult(await call('list_items')); } catch (e) { return errorResult(e); } },
);

server.tool(
  'list_builtin_rigs', 'List the rig presets available to add_rig (r6, r15, rthro, rthroSlender).',
  {},
  async () => { try { return textResult(await call('list_builtin_rigs')); } catch (e) { return errorResult(e); } },
);

server.tool(
  'add_rig', 'Add a built-in rig (R6, R15, Rthro, or Rthro Slender) to the scene. Returns its itemId and the exact joint names you can key — use these joint names verbatim in set_keyframe, they will not match Blender/other tools\' bone names.',
  { rigType: z.enum(['r6', 'r15', 'rthro', 'rthroSlender']) },
  async ({ rigType }) => { try { return textResult(await call('add_rig', { rigType })); } catch (e) { return errorResult(e); } },
);

server.tool(
  'add_camera', 'Add an animatable camera to the scene.',
  {},
  async () => { try { return textResult(await call('add_camera')); } catch (e) { return errorResult(e); } },
);

server.tool(
  'remove_item', 'Delete an item (rig or camera) and all its keyframes.',
  { itemId: z.string() },
  async ({ itemId }) => { try { return textResult(await call('remove_item', { itemId })); } catch (e) { return errorResult(e); } },
);

// ---------------------------------------------------------------- effect items (VFX Studio
// documents placed on the animator's OWN timeline, distinct from the standalone vfx_* tools
// which build/edit the document itself). Typical flow: build/edit with the vfx_* tools against
// VFX Studio, then vfx_export via add_effect_item to place the finished doc in the animation.
server.tool(
  'add_effect_item',
  'Place a VFX Studio effect document as a new item on the animator\'s timeline. Pass the full document (e.g. from vfx_get_effect, or vfx_apply_preset\'s effect field via a follow-up vfx_get_effect). effectStart (project frame where the document\'s own frame 0 lands) defaults to the current playhead if omitted.',
  { effect: z.record(z.string(), z.any()).describe('a full effect document'), name: z.string().optional(), effectStart: z.number().optional(), effectLoop: z.boolean().optional() },
  async (args) => { try { return textResult(await call('add_effect_item', args)); } catch (e) { return errorResult(e); } },
);
server.tool(
  'get_effect_item', 'Get an effect item\'s complete document plus its placement (effectStart/effectLoop) on the animator timeline.',
  { itemId: z.string() },
  async ({ itemId }) => { try { return textResult(await call('get_effect_item', { itemId })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'set_effect_item',
  'Replace an effect item\'s document and/or its timeline placement. Omit `effect` to only change effectStart/effectLoop.',
  { itemId: z.string(), effect: z.record(z.string(), z.any()).optional(), effectStart: z.number().optional(), effectLoop: z.boolean().optional() },
  async (args) => { try { return textResult(await call('set_effect_item', args)); } catch (e) { return errorResult(e); } },
);
server.tool(
  'validate_effect_item', 'Run the diagnostics pipeline on one effect item already placed in the animation (same structured output as vfx_validate).',
  { itemId: z.string() },
  async ({ itemId }) => { try { return textResult(await call('validate_effect_item', { itemId })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'validate_project',
  'Whole-project sweep: every rig\'s animation quality heuristics (the same checks validate_animation runs, one per rig) PLUS every effect item\'s validation, merged into one uniform structured report — the fastest way to check "is anything wrong anywhere" before calling a task done.',
  {},
  async () => { try { return textResult(await call('validate_project')); } catch (e) { return errorResult(e); } },
);

server.tool(
  'select', 'Select an item and optionally a specific joint/part in the app UI (also affects what the gizmo/inspector show in a render_frame screenshot).',
  { itemId: z.string().nullable(), partId: z.string().nullable().optional() },
  async ({ itemId, partId }) => { try { return textResult(await call('select', { itemId, partId })); } catch (e) { return errorResult(e); } },
);

server.tool(
  'set_keyframe', 'Set an exact keyframe on a joint track (or "@origin" for the rig\'s root position, or "@fov" for a camera). Use exact numeric CFrame values — never approximate. Get joint names from add_rig or list_items.',
  {
    itemId: z.string(), track: z.string(), t: z.number().describe('frame number'),
    value: z.union([cframeSchema, z.number()]).describe('a 12-number CFrame for joints/@origin, or a plain number for @fov'),
    es: z.string().optional().describe('easing style: Linear, Constant, Sine, Quad, Cubic, Quart, Quint, Exponential, Circular, Back, Elastic, Bounce'),
    ed: z.enum(['In', 'Out', 'InOut']).optional(),
  },
  async ({ itemId, track, t, value, es, ed }) => { try { return textResult(await call('set_keyframe', { itemId, track, t, value, es, ed })); } catch (e) { return errorResult(e); } },
);

server.tool(
  'get_track', 'Get every keyframe on one track, in order, with their exact values and easing.',
  { itemId: z.string(), track: z.string() },
  async ({ itemId, track }) => { try { return textResult(await call('get_track', { itemId, track })); } catch (e) { return errorResult(e); } },
);

server.tool(
  'delete_keyframes', 'Delete a list of keyframes.',
  { keys: z.array(keyRefSchema) },
  async ({ keys }) => { try { return textResult(await call('delete_keyframes', { keys })); } catch (e) { return errorResult(e); } },
);

server.tool(
  'move_keyframes', 'Shift a list of keyframes in time by dt frames (grouped keys move together automatically).',
  { keys: z.array(keyRefSchema), dt: z.number() },
  async ({ keys, dt }) => { try { return textResult(await call('move_keyframes', { keys, dt })); } catch (e) { return errorResult(e); } },
);

server.tool(
  'group_keys', 'Group 2+ keyframes so they always move together in time from now on.',
  { keys: z.array(keyRefSchema) },
  async ({ keys }) => { try { return textResult(await call('group_keys', { keys })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'ungroup_keys', 'Remove the group link for the given keyframes.',
  { keys: z.array(keyRefSchema) },
  async ({ keys }) => { try { return textResult(await call('ungroup_keys', { keys })); } catch (e) { return errorResult(e); } },
);

server.tool(
  'mirror_item', 'Reflect a rig\'s entire animation left-right (swaps Left*/Right* joint tracks and mirrors the CFrames).',
  { itemId: z.string() },
  async ({ itemId }) => { try { return textResult(await call('mirror_item', { itemId })); } catch (e) { return errorResult(e); } },
);

server.tool(
  'fill_frames', 'Bake an explicit keyframe every `step` frames across [tStart, tEnd] on one track, turning an interpolated curve into explicit per-frame keys you can then hand-tune.',
  { itemId: z.string(), track: z.string(), tStart: z.number(), tEnd: z.number(), step: z.number().optional() },
  async ({ itemId, track, tStart, tEnd, step }) => { try { return textResult(await call('fill_frames', { itemId, track, tStart, tEnd, step })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'repeat_frames', 'Duplicate the time range spanned by the given keyframes forward `times` more times, back-to-back.',
  { keys: z.array(keyRefSchema), times: z.number() },
  async ({ keys, times }) => { try { return textResult(await call('repeat_frames', { keys, times })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'stretch_frames', 'Rescale the time-spacing of the given keyframes by a factor (2 = twice as slow, 0.5 = twice as fast), anchored at the earliest selected frame.',
  { keys: z.array(keyRefSchema), factor: z.number() },
  async ({ keys, factor }) => { try { return textResult(await call('stretch_frames', { keys, factor })); } catch (e) { return errorResult(e); } },
);

server.tool(
  'get_pose', 'Get the exact world-space CFrame of every part of a rig at a given frame, without touching the app\'s current display. This is the precise numeric alternative to eyeballing a screenshot — use it to check exact positions, detect clipping, or verify a pose before/after an edit.',
  { itemId: z.string(), frame: z.number() },
  async ({ itemId, frame }) => { try { return textResult(await call('get_pose', { itemId, frame })); } catch (e) { return errorResult(e); } },
);

server.tool(
  'get_facing',
  'Get the exact world-space direction a rig part is facing (default: its Head, i.e. which way its face points), plus whether that direction currently points toward or away from the viewport camera. Use this instead of guessing from a screenshot — a resting humanoid pose often looks nearly identical from the front and the back, and even an in-frame face can be at an angle that\'s hard to judge by eye. Returns a unit vector, a compass-style bearing, the angle off dead-on from the camera, and a plain-language note on whether a render_frame screenshot right now would show the front or the back.',
  { itemId: z.string(), frame: z.number(), partId: z.string().optional().describe('Which part to check (defaults to "Head" if the rig has one, else its root part).') },
  async ({ itemId, frame, partId }) => { try { return textResult(await call('get_facing', { itemId, frame, partId })); } catch (e) { return errorResult(e); } },
);

server.tool(
  'validate_animation',
  'Run automated quality checks on a rig\'s animation: corrupted/degenerate keyframes, rotation or position "pops" (implausibly large per-frame jumps that usually mean a mistake, not intentional fast motion), joints that were never animated, and a held-pose tail after the last keyframe. Run this after making edits instead of assuming they look right — this is how you check "every frame" without rendering every frame.',
  { itemId: z.string() },
  async ({ itemId }) => { try { return textResult(await call('validate_animation', { itemId })); } catch (e) { return errorResult(e); } },
);

server.tool(
  'render_frame',
  'Screenshot the actual 3D viewport at a specific frame so you can visually verify a pose — silhouette, clipping, whether a rotation reads correctly. Use this to actually look, rather than assuming your numeric edit produced the right visual result.',
  { frame: z.number() },
  async ({ frame }) => {
    try {
      const data = await call('render_frame', { frame });
      return { content: [{ type: 'text', text: `Frame ${data.frame}` }, { type: 'image', data: data.image, mimeType: data.mimeType || 'image/png' }] };
    } catch (e) { return errorResult(e); }
  },
);

server.tool(
  'scrub_to_frame', 'Move the playhead to a frame (lighter weight than render_frame when you don\'t need a screenshot back).',
  { frame: z.number() },
  async ({ frame }) => { try { return textResult(await call('scrub_to_frame', { frame })); } catch (e) { return errorResult(e); } },
);

server.tool(
  'set_project_props', 'Change animation-level settings: fps, length (in frames), loop, priority (Idle/Movement/Action/Action2/Action3/Action4/Core), or the project name.',
  { fps: z.number().optional(), length: z.number().optional(), loop: z.boolean().optional(), priority: z.string().optional(), name: z.string().optional() },
  async (args) => { try { return textResult(await call('set_project_props', args)); } catch (e) { return errorResult(e); } },
);

server.tool('undo', 'Undo the last change.', {}, async () => { try { return textResult(await call('undo')); } catch (e) { return errorResult(e); } });
server.tool('redo', 'Redo the last undone change.', {}, async () => { try { return textResult(await call('redo')); } catch (e) { return errorResult(e); } });

server.tool(
  'save_project', 'Save the project to its current file path. If it has never been saved to a file, this reports that autosave already has every change, since Cadence autosaves continuously.',
  {},
  async () => { try { return textResult(await call('save_project')); } catch (e) { return errorResult(e); } },
);

server.tool(
  'export_to_studio', 'Export a rig\'s animation directly into the connected Roblox Studio session as a KeyframeSequence (requires the user to have Studio open and connected via the Cadence Bridge plugin).',
  { itemId: z.string(), name: z.string().optional(), publish: z.boolean().optional() },
  async ({ itemId, name, publish }) => { try { return textResult(await call('export_to_studio', { itemId, name, publish })); } catch (e) { return errorResult(e); } },
);

server.tool(
  'dismiss_blocking_modal', 'Clear a "Welcome back?" recovery prompt or onboarding card if one happens to be covering the app on launch.',
  {},
  async () => { try { return textResult(await call('dismiss_blocking_modal')); } catch (e) { return errorResult(e); } },
);

// ---------------------------------------------------------------- effects
server.tool(
  'reverse_frames', 'Reverse time within the range spanned by the given keyframes — the pose at the start ends up at the end and vice versa. Same operation as the app\'s one-click "Reverse Time".',
  { keys: z.array(keyRefSchema) },
  async ({ keys }) => { try { return textResult(await call('reverse_frames', { keys })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'set_easing', 'Bulk-set the easing style/direction on a list of keyframes at once — e.g. set them all to Constant for a stop-motion/stepped look (the app\'s one-click "Stop Motion" is exactly this).',
  { keys: z.array(keyRefSchema), es: z.string().optional().describe('Linear, Constant, Sine, Quad, Cubic, Quart, Quint, Exponential, Circular, Back, Elastic, Bounce'), ed: z.enum(['In', 'Out', 'InOut']).optional() },
  async ({ keys, es, ed }) => { try { return textResult(await call('set_easing', { keys, es, ed })); } catch (e) { return errorResult(e); } },
);

// ---------------------------------------------------------------- resize
server.tool(
  'resize_item', 'Resize a rig by a factor (2 = twice as big, 0.5 = half size). This is a REAL resize baked into the rig\'s actual part sizes and joint offsets, not a cosmetic stretch — an exported/re-imported rig is genuinely that size.',
  { itemId: z.string(), factor: z.number().describe('e.g. 1.5 for 50% bigger, 0.5 for half size') },
  async ({ itemId, factor }) => { try { return textResult(await call('resize_item', { itemId, factor })); } catch (e) { return errorResult(e); } },
);

// ---------------------------------------------------------------- face presets
server.tool(
  'add_face_layer', 'Add a face texture layer to a rig\'s head from a local image file (PNG/JPG/WebP). Stack multiple calls for a layered face (e.g. base skin + separate eyebrows).',
  { itemId: z.string(), imagePath: z.string().describe('absolute path to a local image file'), opacity: z.number().min(0).max(1).optional() },
  async ({ itemId, imagePath, opacity }) => { try { return textResult(await call('add_face_layer', { itemId, imagePath, opacity })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'clear_face', 'Remove all custom face layers from a rig\'s head, reverting to its default look.',
  { itemId: z.string() },
  async ({ itemId }) => { try { return textResult(await call('clear_face', { itemId })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'list_face_presets', 'List every saved face preset in the app-wide library (shared across all projects), with id, name, and layer count.',
  {},
  async () => { try { return textResult(await call('list_face_presets')); } catch (e) { return errorResult(e); } },
);
server.tool(
  'save_face_preset', 'Save a rig\'s CURRENT face layers (set via add_face_layer) as a named, reusable preset in the app-wide library.',
  { itemId: z.string(), name: z.string() },
  async ({ itemId, name }) => { try { return textResult(await call('save_face_preset', { itemId, name })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'apply_face_preset', 'Instantly apply a saved face preset (by id, from list_face_presets) to a rig.',
  { itemId: z.string(), presetId: z.string() },
  async ({ itemId, presetId }) => { try { return textResult(await call('apply_face_preset', { itemId, presetId })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'delete_face_preset', 'Remove a saved face preset from the library permanently.',
  { presetId: z.string() },
  async ({ presetId }) => { try { return textResult(await call('delete_face_preset', { presetId })); } catch (e) { return errorResult(e); } },
);

// ---------------------------------------------------------------- attach & detach
server.tool(
  'attach_item', 'Rigidly attach one item (a prop — weapon, tool, held item) to a part on another rig (e.g. a hand) so it follows automatically every frame from now on, at its exact current relative position — no manual per-frame keying of the prop needed.',
  { itemId: z.string().describe('the item to attach (the prop)'), targetItemId: z.string().describe('the rig to attach it to'), targetPartName: z.string().describe('e.g. "RightHand"') },
  async ({ itemId, targetItemId, targetPartName }) => { try { return textResult(await call('attach_item', { itemId, targetItemId, targetPartName })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'detach_item', 'Release an item from whatever it\'s attached to — it stays exactly where it currently is (no snap/jump), free to animate independently again.',
  { itemId: z.string() },
  async ({ itemId }) => { try { return textResult(await call('detach_item', { itemId })); } catch (e) { return errorResult(e); } },
);

// ---------------------------------------------------------------- precision inspection
// These give exact structured facts instead of a screenshot to eyeball — checking a pose this
// way is faster and strictly more precise than looking at a render, which is the entire point of
// Claude driving this app directly rather than through a human's eyes.
server.tool(
  'get_bounding_box', 'Get the exact world-space axis-aligned bounding box of every part of a rig at a given frame, plus one combined box for the whole rig — use this to check reach/extent or spot obviously-wrong poses (e.g. a hand nowhere near where it should be) without rendering anything.',
  { itemId: z.string(), frame: z.number() },
  async ({ itemId, frame }) => { try { return textResult(await call('get_bounding_box', { itemId, frame })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'get_rotation_degrees', 'Get a joint\'s (or @origin\'s) rotation at a frame as human-readable XYZ Euler degrees instead of a raw 3x3 CFrame matrix — much easier to sanity-check than mentally decoding rotation matrix components.',
  { itemId: z.string(), track: z.string(), frame: z.number() },
  async ({ itemId, track, frame }) => { try { return textResult(await call('get_rotation_degrees', { itemId, track, frame })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'check_collision', 'Check whether two parts on the same rig are clipping into each other at a given frame, via their world-space bounding boxes. Conservative: uses AXIS-ALIGNED boxes, so it can flag a near-miss as colliding when a part is rotated, but a "not colliding" result is always trustworthy.',
  { itemId: z.string(), partA: z.string().describe('part id or name'), partB: z.string().describe('part id or name'), frame: z.number() },
  async ({ itemId, partA, partB, frame }) => { try { return textResult(await call('check_collision', { itemId, partA, partB, frame })); } catch (e) { return errorResult(e); } },
);

// ==================================================================================
// VFX Studio — a completely separate, richer effect editor (particles, shapes, lights,
// screen effects, camera shake, sound), each with clips on its own timeline and bezier curves
// on every animatable property. Every vfx_* call auto-opens the studio window if it isn't
// already running (no separate "launch" step needed), and every mutating tool returns the
// document's fresh summary + diagnostics — never assume a write landed, read the response.
//
// Workflow: read first (vfx_get_state/vfx_get_effect), make ONE change, re-read/validate,
// repeat — never chain several blind edits and hope. Before considering an effect finished:
// vfx_validate (or the export gate does this for you), and if anything's flagged,
// vfx_auto_fix handles the mechanical repairs. vfx_render_frame lets you actually SEE a frame
// instead of inferring it from numbers.
const curveKeySchema = z.object({
  t: z.number().describe('frame, RELATIVE TO THE LAYER\'S CLIP START (clip-local, not doc-absolute)'),
  v: z.union([z.number(), z.string()]).describe('value at this key (a hex color string only for color props, which are rare)'),
  es: z.string().optional().describe('easing style: Linear, Constant, Sine, Quad, Cubic, Quart, Quint, Exponential, Circular, Back, Elastic, Bounce'),
  ed: z.enum(['In', 'Out', 'InOut']).optional(),
  bez: z.array(z.number()).length(4).optional().describe('cubic-bezier [x1,y1,x2,y2], overrides es/ed if present'),
});
const layerTypeSchema = z.enum(['emitter', 'shape', 'light', 'screen', 'shake', 'sound']);
const clipSchema = z.object({
  start: z.number().optional().describe('doc frame this layer\'s clip begins at'),
  len: z.number().optional().describe('clip length in frames'),
  loop: z.boolean().optional().describe('loop this layer to the effect\'s end instead of playing once'),
});

async function vfxCall(type, payload) {
  return call(type, payload);
}

server.tool(
  'vfx_open_studio',
  'Open the VFX Studio window (or focus it if already open). Every other vfx_ tool auto-opens it too, so this is rarely needed on its own — mainly useful to make sure the user can see what you\'re doing.',
  {},
  async () => { try { return textResult(await vfxCall('vfx_open_studio')); } catch (e) { return errorResult(e); } },
);

server.tool(
  'vfx_get_state',
  'Get the VFX Studio\'s overall state: a compact effect summary (layers, clips, curve/expression key counts — NOT full curve data), playhead, selection, undo depth, diagnostic counts, and the full layer/modifier type catalogs with their applicable-to rules and Roblox export modes. Read this before assuming anything about what\'s open.',
  {},
  async () => { try { return textResult(await vfxCall('vfx_get_state')); } catch (e) { return errorResult(e); } },
);

server.tool(
  'vfx_get_effect',
  'Get the COMPLETE current effect document — every layer, every curve key, every expression, every modifier. This is the ground truth; read it before editing a layer/curve/modifier you didn\'t just create yourself.',
  {},
  async () => { try { return textResult(await vfxCall('vfx_get_effect')); } catch (e) { return errorResult(e); } },
);

server.tool(
  'vfx_new_effect',
  'Start a brand-new, blank effect (one empty emitter layer) in the studio, replacing whatever was open. Prefer vfx_apply_preset for anything resembling a known archetype (sword slash, explosion, fireball, ...) — it\'s a much faster starting point than building every layer by hand.',
  { name: z.string().optional(), duration: z.number().optional().describe('frames, default 60'), fps: z.number().optional().describe('default 30') },
  async (args) => { try { return textResult(await vfxCall('vfx_new_effect', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'vfx_set_effect_props',
  'Change effect-level settings: name, duration (frames — every layer\'s clip is re-clamped to fit), fps, or preview loop.',
  { name: z.string().optional(), duration: z.number().optional(), fps: z.number().optional(), loop: z.boolean().optional() },
  async (args) => { try { return textResult(await vfxCall('vfx_set_effect_props', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'vfx_add_layer',
  'Add a new layer to the effect. Layer types: emitter (particles), shape (a rendered mesh built from a base shape — slash/ring/lightning/etc, the "core" of a slash or shockwave), light (PointLight-like glow), screen (flash/vignette/speedlines/overlay, screen-space only), shake (camera shake), sound. Returns createdLayerId — use it for follow-up curve/modifier calls.',
  {
    type: layerTypeSchema,
    name: z.string().optional(),
    clip: clipSchema.optional(),
    props: z.record(z.string(), z.any()).optional().describe('initial property values, e.g. {rate:40, colorStart:"#ffaa33"} for an emitter — see vfx_get_state\'s layerTypes/modifierTypes or vfx_get_effect for an existing layer of the same type to learn valid keys'),
  },
  async (args) => { try { return textResult(await vfxCall('vfx_add_layer', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'vfx_update_layer',
  'Rename, enable/disable, or change property values on an existing layer. Only pass the fields you want changed.',
  { layerId: z.string(), name: z.string().optional(), enabled: z.boolean().optional(), props: z.record(z.string(), z.any()).optional() },
  async (args) => { try { return textResult(await vfxCall('vfx_update_layer', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'vfx_remove_layer', 'Delete a layer and everything on it (curves, expressions, modifiers).',
  { layerId: z.string() },
  async ({ layerId }) => { try { return textResult(await vfxCall('vfx_remove_layer', { layerId })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'vfx_duplicate_layer', 'Duplicate a layer (including its curves/modifiers, with fresh ids so they don\'t collide with the original).',
  { layerId: z.string() },
  async ({ layerId }) => { try { return textResult(await vfxCall('vfx_duplicate_layer', { layerId })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'vfx_reorder_layer', 'Move a layer to a new position in the stack (0 = first/bottom).',
  { layerId: z.string(), index: z.number() },
  async ({ layerId, index }) => { try { return textResult(await vfxCall('vfx_reorder_layer', { layerId, index })); } catch (e) { return errorResult(e); } },
);

server.tool(
  'vfx_set_clip',
  'Change a layer\'s clip window on the timeline: when it starts, how long it plays, and whether it loops to the effect\'s end. Stagger clip starts to build anticipation -> impact -> dissipation.',
  { layerId: z.string(), start: z.number().optional(), len: z.number().optional(), loop: z.boolean().optional() },
  async (args) => { try { return textResult(await vfxCall('vfx_set_clip', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'vfx_get_curve', 'Read one property\'s curve keys, its expression (if any), and its static base value.',
  { layerId: z.string(), prop: z.string().describe('e.g. "rate", "opacity", "scale", or "mod:<modifierId>:<param>" for a modifier parameter') },
  async ({ layerId, prop }) => { try { return textResult(await vfxCall('vfx_get_curve', { layerId, prop })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'vfx_set_curve',
  'Replace a property\'s ENTIRE curve with the given keys (pass all keys you want, not just new ones — this is a full replace, not an append). Only props marked animatable in the layer type\'s metadata can meaningfully carry a curve (check vfx_get_state\'s layerTypes, or read an existing similar layer). Key times are CLIP-LOCAL (relative to the layer\'s clip.start), so a key at t=0 fires exactly when the clip starts.',
  { layerId: z.string(), prop: z.string(), keys: z.array(curveKeySchema) },
  async ({ layerId, prop, keys }) => { try { return textResult(await vfxCall('vfx_set_curve', { layerId, prop, keys })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'vfx_delete_curve', 'Remove a property\'s curve entirely, reverting it to its static base value.',
  { layerId: z.string(), prop: z.string() },
  async ({ layerId, prop }) => { try { return textResult(await vfxCall('vfx_delete_curve', { layerId, prop })); } catch (e) { return errorResult(e); } },
);

server.tool(
  'vfx_set_expression',
  'Advanced mode: drive a property with a math expression instead of (or composed with) its curve — e.g. "value * (1 + 0.3*sin(t*6))" where `value` is what the curve/base already resolved to, `t` is seconds into the clip, `f` is the clip-local frame, `dur` is the clip length in seconds. Functions: sin cos tan asin acos atan abs floor ceil round sqrt exp log sign pow min max clamp lerp noise rand saw tri square, plus the constant pi. A broken expression is rejected outright (nothing is changed) — fix the syntax and retry. Pass an empty/omitted expression to clear it.',
  { layerId: z.string(), prop: z.string(), expression: z.string().optional() },
  async ({ layerId, prop, expression }) => { try { return textResult(await vfxCall('vfx_set_expression', { layerId, prop, expression })); } catch (e) { return errorResult(e); } },
);

server.tool(
  'vfx_add_modifier',
  'Add a modifier to a layer\'s stack: noise (positional turbulence, emitter only, preview-only on export), wind (directional drift, emitter only, approximated as Acceleration on export), pulse (size/opacity oscillation, emitter/shape/light), flicker (opacity jitter, emitter/light/screen, preview-only on export), orbit (swirl around the origin axis, emitter only, preview-only on export), fadeInOut (fade envelope by clip-fraction, most layer types, bakes into the export), gradientShift (hue rotate over clip time, emitter/shape/light, exports as scheduled writes), glowBoost (size+opacity multiplier, emitter/shape, bakes into the export). Check vfx_get_state\'s modifierTypes.appliesTo before adding one to an incompatible layer type (it will error).',
  { layerId: z.string(), type: z.enum(['noise', 'wind', 'pulse', 'flicker', 'orbit', 'fadeInOut', 'gradientShift', 'glowBoost']), props: z.record(z.string(), z.any()).optional() },
  async (args) => { try { return textResult(await vfxCall('vfx_add_modifier', args)); } catch (e) { return errorResult(e); } },
);
server.tool(
  'vfx_update_modifier', 'Change a modifier\'s enabled state or its parameter values.',
  { layerId: z.string(), modifierId: z.string(), enabled: z.boolean().optional(), props: z.record(z.string(), z.any()).optional() },
  async (args) => { try { return textResult(await vfxCall('vfx_update_modifier', args)); } catch (e) { return errorResult(e); } },
);
server.tool(
  'vfx_remove_modifier', 'Remove a modifier from a layer (its curve/expression tracks are deleted with it).',
  { layerId: z.string(), modifierId: z.string() },
  async ({ layerId, modifierId }) => { try { return textResult(await vfxCall('vfx_remove_modifier', { layerId, modifierId })); } catch (e) { return errorResult(e); } },
);

server.tool(
  'vfx_list_presets',
  'List available presets. kind:"effects" (default) lists the hand-tuned multi-layer archetypes (sword-slash, explosion, fireball, portal, ...) plus the theme/scale keys vfx_apply_preset accepts; kind:"particles" lists the 396 single-emitter particle presets instead.',
  { query: z.string().optional(), category: z.string().optional(), kind: z.enum(['effects', 'particles']).optional() },
  async (args) => { try { return textResult(await vfxCall('vfx_list_presets', args)); } catch (e) { return errorResult(e); } },
);
server.tool(
  'vfx_apply_preset',
  'Apply a preset archetype by its key (from vfx_list_presets). theme recolors it (classic/ice/ember/toxic/arcane/holy); scale is a size/rate multiplier (try 0.6, 1, or 1.6, or any number). mode:"replace" (default) swaps the whole open effect as one undo step; mode:"add" merges its layers into what\'s currently open instead (the way to combine archetypes, e.g. a slash + a separate glow preset).',
  { key: z.string(), theme: z.string().optional(), scale: z.number().optional(), mode: z.enum(['replace', 'add']).optional() },
  async (args) => { try { return textResult(await vfxCall('vfx_apply_preset', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'vfx_scrub', 'Move the VFX Studio playhead to a frame (lighter weight than vfx_render_frame when you don\'t need a screenshot back).',
  { frame: z.number() },
  async ({ frame }) => { try { return textResult(await vfxCall('vfx_scrub', { frame })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'vfx_render_frame',
  'Screenshot the VFX Studio\'s actual 3D preview at a specific frame so you can visually verify the effect — silhouette, color, timing, whether particles are even visible. Use this to actually look rather than assuming a numeric edit produced the right visual result.',
  { frame: z.number() },
  async ({ frame }) => {
    try {
      const data = await vfxCall('vfx_render_frame', { frame });
      return { content: [{ type: 'text', text: `Frame ${data.frame}` }, { type: 'image', data: data.image, mimeType: data.mimeType || 'image/png' }] };
    } catch (e) { return errorResult(e); }
  },
);

server.tool(
  'vfx_validate',
  'Run the diagnostics pipeline on the current effect. scope:"effect" (default) is the everyday check; scope:"export" adds Roblox-export-fidelity notes (dropped modifiers, clamped rates, approximated shapes/motions) — run this before vfx_export_luau if you want to see fidelity notes without triggering an actual export. Returns structured diagnostics: id, severity (error/warning/suggestion/info), category, target (layerId/prop/modifierId), frame, message, causes, and a fix handle when auto-fixable. Errors block export/send; nothing else does. Run this after edits instead of assuming they look right.',
  { scope: z.enum(['effect', 'export']).optional() },
  async ({ scope }) => { try { return textResult(await vfxCall('vfx_validate', { scope })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'vfx_auto_fix',
  'Automatically repair diagnostics that have a safe fix (clamping bad values, resizing an undersized particle pool, pulling an out-of-range clip back in, deduping/dropping corrupted curve keys, etc). Pass specific diagnostic ids to fix only those, or omit to fix everything safely fixable. includeUnsafe additionally applies fixes that need judgment (e.g. deleting keys beyond a shortened clip) — use sparingly, and prefer just doing the edit yourself when the right fix is a creative decision rather than a mechanical one. Returns before/after diagnostic counts so you can confirm it worked instead of assuming.',
  { ids: z.array(z.string()).optional(), includeUnsafe: z.boolean().optional() },
  async (args) => { try { return textResult(await vfxCall('vfx_auto_fix', args)); } catch (e) { return errorResult(e); } },
);
server.tool(
  'vfx_performance_report',
  'Estimate real in-game particle density (rate x lifetime + bursts — NOT the preview\'s pool cap, which Roblox has no equivalent of) and grade it against PC/console/mobile budgets. Also reports peak lights, peak screen layers, and how many emitter instances a path-shaped emission will fan out into on export. Run this on anything with several emitter layers before calling it done.',
  {},
  async () => { try { return textResult(await vfxCall('vfx_performance_report')); } catch (e) { return errorResult(e); } },
);

server.tool(
  'vfx_export_luau',
  'Bake the effect into a self-contained Roblox LocalScript (ParticleEmitters with baked NumberSequences and scheduled per-frame properties, Beams for path shapes, Neon parts for solid shapes, PointLights, ScreenGui for screen effects, camera shake via a post-camera RenderStep delta, Sound). Blocked if the effect has validation errors — fix them (vfx_auto_fix handles most) and retry. Returns the Luau source, a human-readable list of every approximation/degrade the export made, and the full export-scope diagnostics. The in-game result is a STATISTICAL match of the studio preview, not a pixel-identical one — Roblox rolls its own per-particle randomness.',
  {},
  async () => { try { return textResult(await vfxCall('vfx_export_luau')); } catch (e) { return errorResult(e); } },
);

server.tool(
  'vfx_send_to_animator',
  'Send the current effect to the main Cadence Animator window as a new timeline item (undoable there like any other edit) — the bridge from "built in VFX Studio" to "attached to an animation". Blocked if the effect has validation errors, same as export.',
  {},
  async () => { try { return textResult(await vfxCall('vfx_send_to_animator')); } catch (e) { return errorResult(e); } },
);

server.tool(
  'vfx_select_layer', 'Select a layer in the VFX Studio UI (affects what the inspector/timeline show in a vfx_render_frame screenshot).',
  { layerId: z.string() },
  async ({ layerId }) => { try { return textResult(await vfxCall('vfx_select_layer', { layerId })); } catch (e) { return errorResult(e); } },
);
server.tool('vfx_undo', 'Undo the last VFX Studio change.', {}, async () => { try { return textResult(await vfxCall('vfx_undo')); } catch (e) { return errorResult(e); } });
server.tool('vfx_redo', 'Redo the last undone VFX Studio change.', {}, async () => { try { return textResult(await vfxCall('vfx_redo')); } catch (e) { return errorResult(e); } });

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main();
