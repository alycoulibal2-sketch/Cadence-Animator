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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main();
