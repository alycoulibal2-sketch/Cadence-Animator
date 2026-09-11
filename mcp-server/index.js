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
const vec3Schema = z.array(z.number()).length(3).describe('[x, y, z]');

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
  {
    itemId: z.string(), track: z.string(), tStart: z.number(), tEnd: z.number(), step: z.number().optional(),
    wiggle: z.object({
      pos: z.array(z.number()).length(3).optional().describe('random position magnitude per axis, in studs'),
      rot: z.array(z.number()).length(3).optional().describe('random rotation magnitude per axis, in degrees'),
      num: z.number().optional().describe('random magnitude for numeric tracks (@fov, @rate, @lifetime, @speed)'),
      minZero: z.boolean().optional().describe('nudge only upward instead of symmetrically around the original value'),
    }).optional().describe('randomise each baked frame instead of baking the exact interpolated value — cheap hand-drawn jitter on a held pose'),
  },
  async ({ itemId, track, tStart, tEnd, step, wiggle }) => { try { return textResult(await call('fill_frames', { itemId, track, tStart, tEnd, step, wiggle })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'offset_frames', 'Shift every keyframe and event marker along the timeline by `dt` frames (negative moves earlier). Pass an itemId to offset just that item.',
  { dt: z.number(), itemId: z.string().optional() },
  async ({ dt, itemId }) => { try { return textResult(await call('offset_frames', { dt, itemId })); } catch (e) { return errorResult(e); } },
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

// ---------------------------------------------------------------- event markers
const markerRefSchema = z.object({ itemId: z.string(), t: z.number() });
server.tool(
  'list_markers', 'List an item\'s event markers — the labelled bars on its timeline "Events" lane. Each marker exports as a named Roblox Keyframe plus any KeyframeMarker children.',
  { itemId: z.string() },
  async ({ itemId }) => { try { return textResult(await call('list_markers', { itemId })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'add_marker', 'Add an event marker to an item\'s Events lane at frame `t`. Use these to mark footsteps, hit frames, sound cues — anything gameplay code should react to. `kf` entries become Roblox KeyframeMarkers, which fire AnimationTrack:GetMarkerReachedSignal(name) in-game.',
  {
    itemId: z.string(),
    t: z.number().describe('start frame'),
    name: z.string().optional().describe('label; also becomes the exported Roblox Keyframe name, which KeyframeReached fires with'),
    width: z.number().optional().describe('length in frames (0 = a single-frame event)'),
    codeBegin: z.string().optional().describe('Luau to run at the start — stored and exported, never executed by Cadence itself'),
    codeEnd: z.string().optional().describe('Luau to run at the end — stored and exported, never executed by Cadence itself'),
    kf: z.record(z.string()).optional().describe('{name: value} pairs exported as Roblox KeyframeMarker instances'),
  },
  async (a) => { try { return textResult(await call('add_marker', a)); } catch (e) { return errorResult(e); } },
);
server.tool(
  'set_marker', 'Update an existing event marker (identified by its item and start frame). Only the fields you pass are changed.',
  {
    itemId: z.string(), t: z.number(),
    name: z.string().optional(), width: z.number().optional(),
    codeBegin: z.string().optional(), codeEnd: z.string().optional(),
    kf: z.record(z.string()).optional(),
  },
  async (a) => { try { return textResult(await call('set_marker', a)); } catch (e) { return errorResult(e); } },
);
server.tool(
  'delete_markers', 'Delete event markers.',
  { markers: z.array(markerRefSchema) },
  async ({ markers }) => { try { return textResult(await call('delete_markers', { markers })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'move_markers', 'Shift event markers along the timeline by `dt` frames.',
  { markers: z.array(markerRefSchema), dt: z.number() },
  async ({ markers, dt }) => { try { return textResult(await call('move_markers', { markers, dt })); } catch (e) { return errorResult(e); } },
);

// ---------------------------------------------------------------- Roblox property items
// These cover the "animate any instance property" half of Moon Animator that a KeyframeSequence
// cannot express — Lighting, sounds, particle emitters, GUIs, constraints, post-processing.
// They are delivered as a generated Luau script (export_property_script), not as animation data.
server.tool(
  'list_prop_classes', 'List the Roblox classes whose properties can be animated, with how many properties and one-shot actions each exposes. Optionally filter by a search string.',
  { search: z.string().optional() },
  async ({ search }) => { try { return textResult(await call('list_prop_classes', { search })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'list_class_properties', 'List every animatable property of a Roblox class (with its value type) plus its one-shot actions, and which properties are added by default.',
  { className: z.string() },
  async ({ className }) => { try { return textResult(await call('list_class_properties', { className })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'add_prop_item', 'Add a Roblox object to the timeline so its properties can be keyframed — e.g. className "Lighting" target "Lighting", or className "ParticleEmitter" target "Workspace.Campfire.Fire". `target` is the instance path the exported script resolves at runtime.',
  {
    className: z.string().describe('use list_prop_classes to see valid names'),
    target: z.string().describe('instance path in the game, e.g. "Lighting" or "Workspace.Campfire.Fire"'),
    name: z.string().optional().describe('label in the timeline; defaults to the target path'),
    withDefaults: z.boolean().optional().describe('create tracks for the class\'s default properties straight away (default true)'),
  },
  async (a) => { try { return textResult(await call('add_prop_item', a)); } catch (e) { return errorResult(e); } },
);
server.tool(
  'add_property_track', 'Add a track for one more property of a Roblox object item, so it can be keyframed.',
  { itemId: z.string(), property: z.string() },
  async ({ itemId, property }) => { try { return textResult(await call('add_property_track', { itemId, property })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'add_action_track', 'Add a one-shot action track to a Roblox object item — Sound.Play, ParticleEmitter.Emit, Humanoid.MoveTo and so on. Each keyframe fires the call once as playback crosses it.',
  { itemId: z.string(), action: z.string().describe('e.g. "Sound.Play" — see list_class_properties for what a class supports') },
  async ({ itemId, action }) => { try { return textResult(await call('add_action_track', { itemId, action })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'remove_track', 'Remove a track and all its keyframes from an item.',
  { itemId: z.string(), track: z.string() },
  async ({ itemId, track }) => { try { return textResult(await call('remove_track', { itemId, track })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'weld_all_parts', 'Join every unattached part of a rig to one base part in a single call (Moon\'s "Easy Weld"). Parts that already have a joint are skipped, so running it twice is safe. Use kind "motor" to get animatable Motor6Ds with their own timeline tracks instead of rigid welds.',
  {
    itemId: z.string(),
    kind: z.enum(['weld', 'motor']).optional().describe('rigid weld (default) or animatable Motor6D'),
    basePartId: z.string().optional().describe('part id or name to weld everything to; defaults to the rig root'),
  },
  async (a) => { try { return textResult(await call('weld_all_parts', a)); } catch (e) { return errorResult(e); } },
);
server.tool(
  'add_screen_effect', 'Add one of Moon\'s screen effects — a vignette, letterboxing bars, a full-screen cover (for fades) or subtitles. Each becomes a keyframeable item that previews over the viewport and exports as a real ScreenGui. Subtitles animate Text plus MaxVisibleGraphemes, which types the line out character by character.',
  { effect: z.enum(['vignette', 'letterbox', 'cover', 'subtitles']) },
  async ({ effect }) => { try { return textResult(await call('add_screen_effect', { effect })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'export_property_script', 'Generate the self-contained Luau script that reproduces every property and action track in Studio. Property values are baked per frame with easing already applied; actions fire once as playback crosses them.',
  { itemIds: z.array(z.string()).optional().describe('limit to these Roblox object items; omit for all of them') },
  async ({ itemIds }) => { try { return textResult(await call('export_property_script', { itemIds })); } catch (e) { return errorResult(e); } },
);

// ---------------------------------------------------------------- play range
server.tool(
  'get_play_range', 'Get the play range — the frame window playback and looping are confined to. `full: true` means the whole animation.',
  {},
  async () => { try { return textResult(await call('get_play_range', {})); } catch (e) { return errorResult(e); } },
);
server.tool(
  'set_play_range', 'Confine playback and looping to a frame window, so you can loop just the section you are polishing. Omit both bounds to clear it and play the whole animation again.',
  { start: z.number().optional(), end: z.number().optional() },
  async ({ start, end }) => { try { return textResult(await call('set_play_range', { start: start ?? null, end: end ?? null })); } catch (e) { return errorResult(e); } },
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
  'set_view',
  'Aim the viewport camera before render_frame, instead of being stuck with whatever angle the user last left the orbit at. azimuthDeg 0 looks at the rig\'s FRONT, 90 at its left side, 180 at its back; elevationDeg is the height of the camera above the target. Use this to check a pose from a second angle — a silhouette that reads correctly head-on often hides a twisted joint.',
  {
    target: z.array(z.number()).length(3).optional().describe('world-space point to orbit around; defaults to the current orbit target'),
    azimuthDeg: z.number().optional().describe('0 = front, 90 = left side, 180 = back (default 0)'),
    elevationDeg: z.number().optional().describe('camera height angle above the target (default 12)'),
    distance: z.number().optional().describe('distance from the target; defaults to the current camera distance'),
  },
  async (args) => { try { return textResult(await call('set_view', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'set_project_props', 'Change animation-level settings: fps, length (in frames), loop, priority (Idle/Movement/Action/Action2/Action3/Action4/Core), or the project name.',
  { fps: z.number().optional(), length: z.number().optional(), loop: z.boolean().optional(), priority: z.string().optional(), name: z.string().optional() },
  async (args) => { try { return textResult(await call('set_project_props', args)); } catch (e) { return errorResult(e); } },
);

server.tool('undo', 'Undo the last change.', {}, async () => { try { return textResult(await call('undo')); } catch (e) { return errorResult(e); } });
server.tool('redo', 'Redo the last undone change.', {}, async () => { try { return textResult(await call('redo')); } catch (e) { return errorResult(e); } });

server.tool(
  'set_theme',
  'Change the app\'s visual theme and/or accent color (a UI preference, persisted to settings — has no effect on any project data). Omit either field to leave it unchanged.',
  { theme: z.enum(['dark', 'midnight', 'slate', 'light']).optional(), accent: z.enum(['periwinkle', 'mint', 'amber', 'rose', 'cyan', 'violet']).optional() },
  async ({ theme, accent }) => { try { return textResult(await call('set_theme', { theme, accent })); } catch (e) { return errorResult(e); } },
);

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
  'export_camera_script',
  'Bake a camera\'s @origin+@fov animation (easing included) into a self-contained Roblox Luau LocalScript that lerps between the baked frames on RenderStepped, with a PlayCameraAnimation BindableEvent for non-autoplay triggering. Pass savePath to write it to disk (.rbxmx wraps it as a droppable LocalScript instance; any other extension writes plain .lua text) — omit savePath to get the Lua source back directly in the response instead.',
  { itemId: z.string().describe('a camera item id'), name: z.string().optional().describe('script/instance name, defaults to "<camera name> script"'), savePath: z.string().optional().describe('absolute path to write to; omit to get the Lua source back in the response instead') },
  async ({ itemId, name, savePath }) => { try { return textResult(await call('export_camera_script', { itemId, name, savePath })); } catch (e) { return errorResult(e); } },
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
  {
    keys: z.array(keyRefSchema),
    es: z.string().optional().describe('Linear, Constant, Sine, Quad, Cubic, Quart, Quint, Sextic, Exponential, Circular, Back, Elastic, Bounce'),
    ed: z.enum(['In', 'Out', 'InOut', 'OutIn']).optional(),
    ep: z.object({
      Overshoot: z.number().optional().describe('Back only — how far past the target it swings (default 1.70158)'),
      Amplitude: z.number().optional().describe('Elastic only — oscillation size (default 1)'),
      Period: z.number().optional().describe('Elastic only — oscillation wavelength in frames (default 0.3)'),
    }).optional().describe('Extra parameters for the styles that take them; omitted params fall back to the style default'),
  },
  async ({ keys, es, ed, ep }) => { try { return textResult(await call('set_easing', { keys, es, ed, ep })); } catch (e) { return errorResult(e); } },
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

// ---------------------------------------------------------------- inverse kinematics & pose math
server.tool(
  'solve_ik',
  'Position a limb\'s end part (e.g. a hand or foot) at an exact world-space point; the Motor6D chain above it (shoulder+elbow, or however many joints chainLength covers) solves via CCD to reach it. Keys the result at `frame` unless key:false, which instead just reports the solved pose and residual error for a dry run. Prefer this over hand-deriving a rotation whenever you have a concrete position to reach for — it reuses the app\'s own tested solver instead of composing Euler angles by hand, which is easy to get subtly wrong (see compute_swing_twist for the "aim at a direction, not a position" case). Optionally pass twistDeg to also control the end part\'s ROLL around the reach direction (e.g. which way a gripped item\'s edge faces) once the position is solved — this is a real but limited notion of "orientation": it adjusts twist/roll around the already-solved reach axis, not arbitrary independent 3-axis facing, since a chain built for reaching a position doesn\'t have spare degrees of freedom for that.',
  {
    itemId: z.string(), partId: z.string().describe('the limb\'s end part (id or name) to place at target — e.g. a hand or foot'),
    target: vec3Schema.describe('world-space position in studs to reach for — a position only, NOT a CFrame/orientation'),
    chainLength: z.number().optional().describe('how many joints up the chain to solve (e.g. 2 for hand+wrist reaching via elbow+shoulder); defaults to the app\'s current IK chain length setting (usually 3)'),
    frame: z.number().optional().describe('defaults to the current playhead'),
    key: z.boolean().optional().describe('set false for a dry run that returns the solved pose/error without keying anything (default true)'),
    twistDeg: z.number().optional().describe('additional roll in degrees around the solved reach axis, applied to the tip-most joint after position convergence — controls facing/grip-roll without disturbing the reached position'),
  },
  async ({ itemId, partId, target, chainLength, frame, key, twistDeg }) => { try { return textResult(await call('solve_ik', { itemId, partId, target, chainLength, frame, key, twistDeg })); } catch (e) { return errorResult(e); } },
);

server.tool(
  'compute_swing_twist',
  'Pure math helper (touches no project state): computes the rotation CFrame that swings restDirection to point along aimDirection, optionally twisted an extra twistDeg around that now-aimed axis afterward. Use this for a "point this joint/limb toward direction D" pose with no position to solve toward (if you DO have a world-space position target for a limb\'s end part, use solve_ik instead). Returns both the raw flat-12 CFrame and its XYZ Euler degrees for a quick sanity check — feed the cframe straight into set_keyframe once it looks right. Exists so a reach/aim rotation is computed the same correct way every time instead of hand-deriving Rodrigues/quaternion math from scratch.',
  {
    restDirection: vec3Schema.describe('the joint\'s un-rotated (rest-pose) local direction, e.g. [0,-1,0] for a limb hanging straight down at rest — need not be pre-normalized'),
    aimDirection: vec3Schema.describe('the direction restDirection should end up pointing, expressed in the SAME space as restDirection (world or parent-local — this tool does no space conversion, it is pure vector math) — need not be pre-normalized'),
    twistDeg: z.number().optional().describe('additional rotation in degrees about the now-aimed axis, applied after the swing (e.g. to roll a limb around its own length once aimed)'),
  },
  async ({ restDirection, aimDirection, twistDeg }) => { try { return textResult(await call('compute_swing_twist', { restDirection, aimDirection, twistDeg })); } catch (e) { return errorResult(e); } },
);

// ---------------------------------------------------------------- unparented (world-space) animation
server.tool(
  'set_track_space',
  'Toggle a joint track between parent-relative (local, normal) and origin-relative world-space storage. Conversion is exact and lossless in both directions — every existing key is re-derived under the new interpretation from the rig\'s actual solved pose at that key\'s own time, so switching back and forth never drifts the pose. World-space ("unparented") animation pastes/retargets correctly onto rigs with different proportions since the motion is authored as a path through space rather than a parent-relative wobble specific to one rig\'s bone lengths.',
  { itemId: z.string(), track: z.string(), space: z.enum(['world', 'local']) },
  async ({ itemId, track, space }) => { try { return textResult(await call('set_track_space', { itemId, track, space })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'get_track_space', 'Get whether a joint track is currently stored parent-relative ("local") or origin-relative ("world"/unparented).',
  { itemId: z.string(), track: z.string() },
  async ({ itemId, track }) => { try { return textResult(await call('get_track_space', { itemId, track })); } catch (e) { return errorResult(e); } },
);

// ---------------------------------------------------------------- rigging tools
server.tool(
  'create_joint',
  'Add a new Motor6D (or, with kind:"weld", a rigid weld) between two existing parts on a rig, rigging up a previously-loose part or adding a whole new limb segment. C0/C1 are derived from the parts\' REST bind CFrames (not whatever pose is currently on screen), pivoted at part1\'s rest origin — the same convention Studio itself uses when a Motor6D is authored by hand. Refuses to create a cycle or to double-drive a part that already has a motor.',
  {
    itemId: z.string(),
    name: z.string().optional().describe('defaults to "<part1 name>Joint"; motor track names ARE joint names, so this becomes the track name in set_keyframe'),
    kind: z.enum(['motor', 'weld']).optional().describe('defaults to motor (animatable); weld is a rigid, non-animatable attachment'),
    part0: z.string().describe('the parent part (id or name) — the new joint\'s pivot anchor'),
    part1: z.string().describe('the child part (id or name) this joint will drive'),
  },
  async ({ itemId, name, kind, part0, part1 }) => { try { return textResult(await call('create_joint', { itemId, name, kind, part0, part1 })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'remove_joint', 'Delete a joint (motor or weld) from a rig. A motor\'s animation track is deleted with it — recreating a same-named joint later starts with a fresh, empty track, not the old keyframes.',
  { itemId: z.string(), name: z.string() },
  async ({ itemId, name }) => { try { return textResult(await call('remove_joint', { itemId, name })); } catch (e) { return errorResult(e); } },
);
server.tool(
  'convert_joint',
  'Flip a joint between weld and Motor6D. Weld -> motor makes a previously-rigid attachment animatable. Motor -> weld freezes it rigid at its current rest position AND deletes its animation track (same reasoning as remove_joint) — make sure you don\'t need that track\'s keyframes before converting.',
  { itemId: z.string(), name: z.string() },
  async ({ itemId, name }) => { try { return textResult(await call('convert_joint', { itemId, name })); } catch (e) { return errorResult(e); } },
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

// ---------------------------------------------------------------------------- PNX procedural engine
// The procedural node engine's tools (spec Parts 59-62). A procedural effect is a DIFFERENT document
// from the layer-based Effect doc the vfx_* tools above edit — the two are exclusive, and pnx_get_state
// says which is open. Structured graph APIs throughout: nothing here drives the UI.
//
// The verification tools exist because of Part 61's rule that "Done" is never an acceptable report.
// Every write returns a read-back, and pnx_verify / pnx_verify_range give the evidence directly.

server.tool(
  'pnx_new',
  'Start a new PROCEDURAL effect, replacing whatever is open. Procedural effects are built from primitives (geometry, fields, noise, SDFs, particles, materials, renderers) rather than from preset layers, so they can express effects nobody anticipated. Defaults to a small working starter graph you can take apart; pass blank:true for an empty canvas. NOTE: procedural effects cannot be exported to Roblox yet.',
  { name: z.string().optional(), blank: z.boolean().optional().describe('true for an empty graph instead of the starter') },
  async (args) => { try { return textResult(await vfxCall('pnx_new', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_get_state',
  'Whether a procedural effect is open, and its overall health: playhead, frame rate, node/link counts, how many elements the current frame actually drew, live simulation count, and diagnostic counts. Read this first — it also tells you whether the studio is in procedural or layer-based mode.',
  {},
  async () => { try { return textResult(await vfxCall('pnx_get_state')); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_get_graph',
  'The COMPLETE procedural graph: every node with its type, position and inline socket values, every link, and every node group. This is ground truth — read it before editing a node you did not just create.',
  { scope: z.string().optional().describe('limit to one group id; omit for the whole graph') },
  async (args) => { try { return textResult(await vfxCall('pnx_get_graph', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_set_graph',
  'Replace the whole procedural graph with one you supply. Use for bulk construction; prefer pnx_add_node/pnx_connect for edits, which give a per-change read-back.',
  { graph: z.any().describe('a serialized PNX graph — the shape pnx_get_graph returns') },
  async (args) => { try { return textResult(await vfxCall('pnx_set_graph', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_collapse_to_group',
  'Collapse a set of nodes into a reusable node group. Links crossing the boundary become the group\'s inputs and outputs automatically. The group is a SCOPE of ordinary nodes, not a black box — pnx_get_graph with its scope shows every node inside, and the result the graph computes is unchanged by collapsing.',
  {
    nodeIds: z.array(z.string()).describe('the nodes to enclose; they must all be in the same scope'),
    name: z.string().optional(),
    description: z.string().optional(),
  },
  async (args) => { try { return textResult(await vfxCall('pnx_collapse_to_group', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_expand_group',
  'Dissolve a group instance back into its parent scope. The interior is COPIED rather than moved, so every other instance of the same group keeps working.',
  { nodeId: z.string().describe('a group instance node') },
  async (args) => { try { return textResult(await vfxCall('pnx_expand_group', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_instantiate_group',
  'Place another instance of an existing group. Each instance evaluates independently, so the same group can be used several times with different inputs.',
  { groupId: z.string(), x: z.number().optional(), y: z.number().optional(), scope: z.string().optional() },
  async (args) => { try { return textResult(await vfxCall('pnx_instantiate_group', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_export_group',
  'Export a node group as a portable document, carrying its nested groups so it drops into another project without dangling references.',
  { groupId: z.string() },
  async (args) => { try { return textResult(await vfxCall('pnx_export_group', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_import_group',
  'Import a node group exported by pnx_export_group. Ids are remapped, so importing the same group twice does not collide.',
  { group: z.any().describe('the payload pnx_export_group returned'), name: z.string().optional() },
  async (args) => { try { return textResult(await vfxCall('pnx_import_group', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_list_recipes',
  'The node-group library: reusable compositions like Curl Motion, Fire Turbulence, Soft Glow, Radial Burst and Dissolve. Every one is built from primitives rather than being an engine capability, and each says what it demonstrates — so they are worth reading as examples of how to build something, not only as shortcuts. Also lists what the library cannot build yet, and why.',
  {},
  async () => { try { return textResult(await vfxCall('pnx_list_recipes')); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_add_recipe',
  'Build a library recipe into the graph as a node group and place an instance of it. Faster than wiring the composition by hand, and the group can be opened and taken apart — every node inside is a primitive.',
  {
    recipe: z.string().describe('a recipe id from pnx_list_recipes, e.g. curlMotion'),
    instantiate: z.boolean().optional().describe('also place an instance (default true)'),
    x: z.number().optional(), y: z.number().optional(),
  },
  async (args) => { try { return textResult(await vfxCall('pnx_add_recipe', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_sheet',
  'The Effect Sheet: the open procedural effect read as things you can see → their properties → what feeds each one (a literal, or the phrase of the source node, recursively), with shared values named once and unused nodes listed. The same projection a person sees in VFX Studio. Prefer this over pnx_get_graph to understand an effect; use the nodeId/socket keys it returns with pnx_sheet_menu and pnx_sheet_apply.',
  { scope: z.string().optional().describe('A group id to read that group\'s interior instead of the root'), text: z.boolean().optional().describe('Include the indented text rendering (default true)') },
  async (args) => { try { return textResult(await vfxCall('pnx_sheet', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_sheet_menu',
  'The "how does this vary?" menu for one slot of the sheet: curated entries (over its life, random per particle, by distance, a swirl, the floor, …) each with its Roblox export level, plus values already in the effect that fit, plus how many registry nodes fit for a search. Every entry is a composition of registry nodes, never a hidden capability.',
  { nodeId: z.string(), socket: z.string().describe('the input key, as pnx_sheet lists it') },
  async (args) => { try { return textResult(await vfxCall('pnx_sheet_menu', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_sheet_apply',
  'Apply a sheet menu choice to a slot, exactly as clicking it does: pass `entry` (an id from pnx_sheet_menu), or `sourceNodeId`+`sourceSocket` to read an existing value, or `type` for any registry node whose output fits. One undo step; returns the verification read-back.',
  { nodeId: z.string(), socket: z.string(), entry: z.string().optional(), sourceNodeId: z.string().optional(), sourceSocket: z.string().optional(), type: z.string().optional() },
  async (args) => { try { return textResult(await vfxCall('pnx_sheet_apply', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_sheet_add_thing',
  'Add a complete visible thing wired to the Effect Output — particles, ring, trail, beam, light, copies — so the first result is on screen immediately. Returns the renderer node id and the ids of the nodes it built.',
  { thing: z.enum(['particles', 'ring', 'trail', 'beam', 'light', 'copies']) },
  async (args) => { try { return textResult(await vfxCall('pnx_sheet_add_thing', args)); } catch (e) { return errorResult(e); } },
);
server.tool(
  'pnx_catalogue',
  'Every available node type as one compact line each: id, label, category, summary, socket types, Roblox export support. Read this (or pnx_search_nodes) before constructing a graph — it is what stops you inventing node types and parameters that do not exist.',
  { category: z.string().optional().describe('e.g. Math, Fields, SDF, Particles, Renderers') },
  async (args) => { try { return textResult(await vfxCall('pnx_catalogue', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_describe_node',
  'Full documentation for one node type: every input and output with its exact type, units, ranges and defaults, plus what it is for, common uses, performance class and Roblox export support. Read this before setting values on a node type you have not used.',
  { type: z.string().describe('e.g. cadence.noise.curl') },
  async (args) => { try { return textResult(await vfxCall('pnx_describe_node', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_search_nodes',
  'Search node types by name, alias, category or description. Understands everyday terms as well as technical ones — "swirl" finds Curl Noise and Vortex Field, "fade" finds Map Range and Normalized Age. Use it when you know what you want the effect to DO but not which primitive does it.',
  { query: z.string(), category: z.string().optional(), limit: z.number().optional() },
  async (args) => { try { return textResult(await vfxCall('pnx_search_nodes', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_add_node',
  'Add a node to the procedural graph. Returns the new node id plus a full verification read-back. An unknown type is rejected with the closest matches rather than silently creating nothing.',
  {
    type: z.string().describe('node type id, e.g. cadence.particles.simulate'),
    x: z.number().optional(), y: z.number().optional(),
    values: z.record(z.any()).optional().describe('inline socket values, keyed by socket key'),
    scope: z.string().optional().describe('a group id, to place the node inside a group'),
    id: z.string().optional().describe('an explicit node id, for reproducible construction'),
  },
  async (args) => { try { return textResult(await vfxCall('pnx_add_node', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_remove_node',
  'Delete a node and every link touching it.',
  { nodeId: z.string() },
  async (args) => { try { return textResult(await vfxCall('pnx_remove_node', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_move_node',
  'Move a node on the canvas. Presentation only — it does not re-evaluate anything or disturb a running simulation.',
  { nodeId: z.string(), x: z.number(), y: z.number() },
  async (args) => { try { return textResult(await vfxCall('pnx_move_node', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_auto_layout',
  'Arrange the graph: a layered left-to-right layout by depth (what feeds what), rows packed without overlap. Presentation only — nothing re-evaluates. Lays out the root by default; pass a group id to lay out that group\'s interior, or all: true for every scope. Returns the new positions and any overlaps left (none, unless boxes are wider than the layout assumes).',
  { scope: z.string().optional().describe('A group id, to lay out that group\'s interior instead of the root'), all: z.boolean().optional().describe('Lay out the root and every group') },
  async (args) => { try { return textResult(await vfxCall('pnx_auto_layout', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_set_value',
  'Set one input socket value on a node. Rejects an unknown socket and lists the real ones. Only this node and what depends on it is recomputed.',
  { nodeId: z.string(), socket: z.string(), value: z.any() },
  async (args) => { try { return textResult(await vfxCall('pnx_set_value', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_connect',
  'Wire one node output into another node input. Type-checked: an incompatible wire is refused with the reason. Note that a field output IS accepted by a plain input — the receiving node is evaluated per element and its output becomes a field.',
  { fromNode: z.string(), fromSocket: z.string(), toNode: z.string(), toSocket: z.string() },
  async (args) => { try { return textResult(await vfxCall('pnx_connect', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_disconnect',
  'Remove a link, either by its id or by whatever is plugged into a given node input.',
  { linkId: z.string().optional(), toNode: z.string().optional(), toSocket: z.string().optional() },
  async (args) => { try { return textResult(await vfxCall('pnx_disconnect', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_set_node_flags',
  'Mute a node (its outputs become type defaults and its inputs are not evaluated), bypass it (the first compatible input passes straight through), or rename it. Muting is the fastest way to find which part of a graph is responsible for something.',
  { nodeId: z.string(), muted: z.boolean().optional(), bypassed: z.boolean().optional(), label: z.string().optional() },
  async (args) => { try { return textResult(await vfxCall('pnx_set_node_flags', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_get_dependencies',
  'What a node depends on and what depends on it. Use it to know what a change will affect before making it.',
  { nodeId: z.string(), direction: z.enum(['upstream', 'downstream', 'both']).optional() },
  async (args) => { try { return textResult(await vfxCall('pnx_get_dependencies', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_inspect',
  'What a node actually produces at a frame. A field is a function rather than a value, so it is probed at several standard sample points; a geometry is summarised by its counts and attribute names. This is how you find out WHY a value is wrong instead of guessing.',
  { nodeId: z.string(), socket: z.string().optional().describe('omit for every output'), frame: z.number().optional() },
  async (args) => { try { return textResult(await vfxCall('pnx_inspect', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_verify',
  'Verify a procedural effect at one frame: graph validity, every diagnostic, what was actually drawn, and what the backend put on screen. Call this after building or changing an effect — reporting success without it is guesswork. It reports TECHNICAL validity only and never claims the effect looks right.',
  { frame: z.number().optional() },
  async (args) => { try { return textResult(await vfxCall('pnx_verify', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_verify_range',
  'Verify across several frames, and list the ones that drew nothing. Prefer this to pnx_verify for a finished effect: an effect that is valid at frame 0 and empty by frame 40 passes a single-frame check, which is the commonest false positive there is.',
  { from: z.number().optional(), to: z.number().optional(), samples: z.number().optional().describe('default 5, max 30') },
  async (args) => { try { return textResult(await vfxCall('pnx_verify_range', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_export_lua',
  'Export the procedural effect as a self-contained Roblox LocalScript. Passes Roblox can run natively become real ParticleEmitters/Beams/PointLights; passes it cannot are BAKED into a per-frame recording and replayed; passes with no Roblox equivalent at all are refused with a reason rather than approximated. The result carries the per-pass classification, so you always know what was translated and what was precomputed. Read pnx_export_report first if you only want the classification.',
  {
    bakeStride: z.number().optional().describe('bake every Nth frame — raise it to shrink a large baked script (default 1)'),
    maxBakedParticles: z.number().optional().describe('cap on particles recorded per frame (default 300)'),
    precision: z.number().optional().describe('decimal places in the baked numbers (default 2)'),
  },
  async (args) => { try { return textResult(await vfxCall('pnx_export_lua', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_export_report',
  'What a Roblox export WOULD do to each pass, without baking anything: native, converted, baked or unsupported, why, and which material channels are lost. Cheap — call it before pnx_export_lua to find out whether an effect will bake to a huge script before producing one.',
  {},
  async () => { try { return textResult(await vfxCall('pnx_export_report')); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_export_compatibility',
  'What a target platform would keep, change or lose about the current effect: which render passes are native, converted, approximated or unsupported, and which material channels a backend ignores. Procedural effects have no Roblox exporter yet, so this reports what WOULD happen.',
  { backend: z.enum(['preview', 'roblox']).optional() },
  async (args) => { try { return textResult(await vfxCall('pnx_export_compatibility', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_profile',
  'Per-node evaluation cost at a frame, slowest first. Use it when a procedural effect is slow — the answer is usually one expensive node sampled per particle.',
  { frame: z.number().optional() },
  async (args) => { try { return textResult(await vfxCall('pnx_profile', args)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'pnx_render_frame',
  'Screenshot the procedural effect at a frame. This is the one way to see what a procedural effect actually looks like — pnx_verify tells you it is technically valid, this shows you whether it reads the way you intended. Returns a PNG plus the draw statistics for that frame.',
  { frame: z.number().describe('frame to capture') },
  async (args) => {
    try {
      const r = await vfxCall('pnx_render_frame', args);
      return { content: [{ type: 'image', data: r.image, mimeType: r.mimeType }, { type: 'text', text: JSON.stringify({ frame: r.frame, stats: r.stats }) }] };
    } catch (e) { return errorResult(e); }
  },
);

server.tool(
  'pnx_scrub',
  'Move the playhead of a procedural effect and evaluate that frame. Scrubbing backwards replays a simulation from a checkpoint, so the same frame always looks the same however it was reached.',
  { frame: z.number() },
  async (args) => { try { return textResult(await vfxCall('pnx_scrub', args)); } catch (e) { return errorResult(e); } },
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

// ================================================================ the semantic layer
//
// Cadence Animation Intelligence — the semantic model, semantic selection, snapshots and
// provenance. Built to Cadence_Animator_Ultimate_Master_Directive.md; see
// docs/animation-intelligence/requirements-matrix.md for what is and is not implemented.
//
// Every description below opens with its EFFECT — read-only, mutating, or destructive — because
// directive Part 50 requires a tool to state whether it changes anything before it is called, not
// after. The 140 pre-existing tools above do not carry that marker yet; these do.
//
// These tools return SEMANTIC facts with stable ids, certainty labels and evidence. Prefer them
// over get_state when the question is "what is this?" rather than "give me the raw data".

server.tool(
  'inspect_scene',
  'READ-ONLY. The Scene Graph: every item with a stable id, semantic role, world transform at a frame, dependency edges, and the layer\'s own capability statement. This is the right first call for "what is in this shot?" — it answers with roles and relationships rather than raw part names. Reports what it CANNOT answer (materials, lights, framing) explicitly rather than by omission.',
  {
    frame: z.number().optional().describe('Frame at which to resolve world transforms. Defaults to the current playhead.'),
    includeRig: z.boolean().optional().describe('Include the full Rig Graph per rig item (default true). Set false for a light listing.'),
    includeTimeline: z.boolean().optional().describe('Include the full Timeline Graph per item (default false — it is the largest part of the payload; inspect_timeline fetches it per item).'),
    includeKeys: z.boolean().optional().describe('When including timelines, include every keyframe (default false).'),
  },
  async (a) => { try { return textResult(await call('inspect_scene', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'inspect_rig',
  'READ-ONLY. The Rig Graph for one rig: every part and joint with a stable id that survives a rename, a semantic role (hips/chest/wrist/foot…) with the evidence and certainty behind it, mirror partners, FK and IK chain membership, contact capability, motion space, the Roblox mapping back to real part/joint names, and a full rig validation pass (root, cycles, duplicate motors, orphaned parts, rest-pose consistency, mirror completeness, role coverage, export shape). joint_limits is null because Cadence stores none — that means UNKNOWN, not unlimited.',
  { itemId: z.string().optional().describe('Rig item id. Defaults to the first rig in the project.') },
  async (a) => { try { return textResult(await call('inspect_rig', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'inspect_timeline',
  'READ-ONLY. The Timeline Graph for one item: tracks with kind, value type, space, dependency back to the joint they drive, and keyframes with stable ids, exact times, seconds (with the fps used), easing, and any phase/intent annotations. Also the canonical time block (frames are canonical; seconds are derived) and the item\'s markers and key groups. layer/blend_mode/weight and in/out tangents are null because Cadence has neither animation layers nor tangent vectors.',
  {
    itemId: z.string().optional().describe('Item id. Defaults to the first item.'),
    includeKeys: z.boolean().optional().describe('Include every keyframe (default true).'),
  },
  async (a) => { try { return textResult(await call('inspect_timeline', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'resolve_semantic',
  'READ-ONLY. Turn a phrase into concrete entity ids — "the left foot", "the planted foot", "the weapon hand", "the hands", "the active camera" — with the evidence and a certainty level behind each match. Measured answers (the planted foot is derived from world-space foot travel over a frame window) are never reported as certain. When the project genuinely cannot decide, it returns no match and a question rather than guessing. Call selection_vocabulary to see every phrase it understands.',
  {
    query: z.string().describe('A phrase such as "the planted foot", "the weapon hand", "the left elbow", "both hands".'),
    itemId: z.string().optional().describe('Restrict to one item.'),
    frame: z.number().optional().describe('The frame the question is about. Defaults to the playhead. Used by measured queries.'),
    window: z.array(z.number()).length(2).optional().describe('[from, to] frame window for measured queries. Defaults to ±3 frames around `frame`.'),
    kind: z.enum(['part', 'joint', 'item', 'any']).optional().describe('Restrict the kind of entity returned (default any).'),
  },
  async (a) => { try { return textResult(await call('resolve_semantic', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'selection_vocabulary',
  'READ-ONLY. Every role word, side word and special phrase resolve_semantic understands.',
  {},
  async () => { try { return textResult(await call('selection_vocabulary')); } catch (e) { return errorResult(e); } },
);

server.tool(
  'set_semantic_role',
  'MUTATING (undoable). Pin a semantic role onto an item, part or joint, so a rig this layer could not name — a creature, a vehicle, a mechanical rig, a weapon prop — becomes addressable by resolve_semantic. A pinned role always beats inference and is reported as certain. Pass role: null to clear one.',
  {
    itemId: z.string(),
    kind: z.enum(['items', 'parts', 'joints']).describe('Which table the key belongs to.'),
    key: z.string().describe('The part id, joint name, or item id being pinned.'),
    role: z.string().nullable().describe('A role from the ROLE vocabulary (hips, chest, hand, foot, weapon, target, …). null clears the pin.'),
    side: z.enum(['left', 'right', 'centre']).nullable().optional(),
    reason: z.string().optional().describe('Why — kept with the pin and recorded in provenance.'),
  },
  async (a) => { try { return textResult(await call('set_semantic_role', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'snapshot_scene',
  'MUTATING (records provenance only; the project itself is untouched). Capture an immutable, content-addressed snapshot of the current project. Identical content is deduplicated, so snapshotting before every edit is cheap. Pin a snapshot to protect it from eviction. The store is IN MEMORY and does not survive an app restart.',
  {
    reason: z.string().optional().describe('Why this state is worth keeping.'),
    author: z.string().optional().describe("'user' | 'ai' | a tool name (default 'ai')."),
    pinned: z.boolean().optional().describe('Never evict this one — use for a baseline or a transaction before-state.'),
  },
  async (a) => { try { return textResult(await call('snapshot_scene', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'list_snapshots',
  'READ-ONLY. Every snapshot currently held, with its hash, reason, author and pin state, plus store statistics.',
  {},
  async () => { try { return textResult(await call('list_snapshots')); } catch (e) { return errorResult(e); } },
);

server.tool(
  'restore_snapshot',
  'DESTRUCTIVE (undoable). Replace the whole project with a held snapshot. A snapshot of the pre-restore state is taken and pinned first, and the restore itself goes on the undo stack, so it can be reversed two ways. Returns the diff that was applied.',
  { id: z.string().describe('Snapshot id or hash, from list_snapshots.') },
  async (a) => { try { return textResult(await call('restore_snapshot', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'diff_snapshots',
  'READ-ONLY. Structural difference between two project states, down to individual keyframes: items added/removed/changed, tracks with keys added/removed/modified (and which fields changed on each), track space changes, project-level field changes, and the frame range the edits actually touched. Omit either id to compare against the live project.',
  {
    from: z.string().optional().describe('Snapshot id. Omit to use the live project.'),
    to: z.string().optional().describe('Snapshot id. Omit to use the live project.'),
  },
  async (a) => { try { return textResult(await call('diff_snapshots', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'record_provenance',
  'MUTATING (appends to the project). Record a node in the provenance graph: a request, an interpretation, a plan, a tool call, a patch, an analysis, a decision or a lesson, linked to what caused it and to the entity ids it touched. The graph lives inside the project, so it survives save/load and travels with the .cadence file. Record the REQUEST before doing work and the PATCH after, so "why is this keyframe here?" stays answerable later.',
  {
    type: z.enum(['request', 'intent', 'plan', 'tool_call', 'patch', 'snapshot', 'render', 'analysis', 'decision', 'lesson', 'note']),
    summary: z.string().describe('One line, human-readable. Required.'),
    detail: z.any().optional().describe('Structured payload, kept verbatim.'),
    parents: z.array(z.string()).optional().describe('Ids of nodes this one was caused by.'),
    entities: z.array(z.string()).optional().describe('Entity ids this node touched (from inspect_scene / inspect_rig / inspect_timeline).'),
    links: z.array(z.object({ type: z.string(), target: z.string() })).optional().describe('Extra typed edges: interprets, implements, observes, evaluates, approves, rolls_back, before, after, derived_from.'),
    author: z.string().optional(),
  },
  async (a) => { try { return textResult(await call('record_provenance', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'inspect_provenance',
  'READ-ONLY. Query the provenance graph. Give a nodeId to get its full causal ancestry and consequences ("why is this built this way?"); an entity id to get everything recorded about it and the request behind each record ("which user request caused this keyframe?"); or neither to list recent records. Reports honestly when the graph has been truncated, so an incomplete ancestry is never mistaken for a complete one.',
  {
    nodeId: z.string().optional().describe('Explain one node: its ancestry, consequences and affected entities.'),
    entity: z.string().optional().describe('Everything recorded about one entity id.'),
    type: z.string().optional().describe('Filter by node type.'),
    contains: z.string().optional().describe('Substring match on the summary.'),
    limit: z.number().optional(),
  },
  async (a) => { try { return textResult(await call('inspect_provenance', a)); } catch (e) { return errorResult(e); } },
);

// ================================================================ safe patch and rollback
//
// Directive Parts 54 (semantic constraints and safe change control) and 55 (transaction, undo,
// rollback and failure recovery). The two-phase contract matters and is worth stating once:
// PREVIEW plans on a clone and changes nothing; APPLY re-plans, refuses a violated constraint,
// commits, and verifies the committed state's hash against the plan's. Rollback then works from
// the recorded inverse, so it can be scoped to one property or one frame range — which whole-
// project undo, still available and still correct, cannot do.

const PATCH_OPS_SCHEMA = z.array(z.object({
  op: z.enum(['set_key', 'restore_key', 'delete_key', 'move_key', 'set_easing', 'set_track_space', 'remove_track', 'set_item_field', 'set_project_field', 'set_marker', 'delete_marker']),
  itemId: z.string().optional(),
  track: z.string().optional().describe('Track name: a joint name, "@origin", "@fov", a property name, or "@act:Sound.Play".'),
  t: z.number().optional().describe('Frame. For set_marker/delete_marker it is rounded to a whole frame, as in the editor.'),
  to: z.number().optional().describe('move_key only: the destination frame. Clamped to the timeline, and the clamp is reported.'),
  value: z.any().optional().describe('set_key: a 12-number CFrame array, or a number for a numeric track. Required when the key does not exist yet.'),
  es: z.string().optional().describe('Easing style (Cubic, Quad, Elastic, Bounce, Back, Linear, …).'),
  ed: z.string().optional().describe('Easing direction (In, Out, InOut).'),
  bez: z.any().optional().describe('Bezier override [x1,y1,x2,y2], or null to clear.'),
  ep: z.any().optional().describe("Style parameters (Back's Overshoot, Elastic's Amplitude/Period). Pruned to what the style accepts, as in the editor."),
  key: z.any().optional().describe('restore_key only: the whole key object to write verbatim.'),
  space: z.enum(['local', 'world']).optional(),
  path: z.string().optional().describe('set_item_field / set_project_field: the field name.'),
  patch: z.any().optional().describe('set_marker only: { name?, width?, codeBegin?, codeEnd?, kf? }.'),
})).describe('The operations, in order. Later operations see the effect of earlier ones.');

const CONSTRAIN_SCHEMA = z.object({
  preserve: z.array(z.any()).optional().describe('Phrases ("the camera", "the left arm") or selectors that must not change.'),
  lock: z.array(z.any()).optional().describe('Same, at lock priority, for this request only. lock_constraint persists one instead.'),
  allow: z.array(z.any()).optional().describe('The ONLY things the patch may touch. Compiles to a protection over everything else — this is how "change the arms and nothing else" is expressed.'),
  avoid: z.array(z.any()).optional(),
  aspect: z.any().optional().describe("Which aspect to protect: 'timing', 'value', 'easing', 'space', 'existence', an array of those, or omit for all. 'timing' + allow is how \"heavier without changing timing\" is expressed."),
  protect_frames: z.array(z.object({ frame: z.number(), tolerance: z.number().optional(), reason: z.string().optional() })).optional().describe('Protected moments, e.g. the impact frame.'),
  contacts: z.array(z.object({ effector: z.any(), from: z.number(), to: z.number(), tolerance_studs: z.number(), reason: z.string().optional() })).optional().describe('Declared contacts. RECORDED and reported, but NOT yet verifiable — contact-drift measurement is Phase 5, and the result says so in coverage.notRun.'),
  budgets: z.array(z.object({ countable: z.enum(['keys', 'markers']).optional(), max: z.number() })).optional(),
  text: z.string().optional().describe('Lines in a small closed grammar ("do not change timing", "keep frame 16 within 1 frame", "lock the camera", "at most 200 keys"). Anything it does not recognise is returned in `unparsed` and is NOT enforced — call inspect_constraints to see the grammar.'),
  reason: z.string().optional(),
  source: z.enum(['user', 'project', 'character', 'style', 'ai', 'platform']).optional().describe('Sets the default priority on Part 54\'s ladder.'),
}).describe('A change request compiled into ConstraintSpecs.');

server.tool(
  'preview_animation_patch',
  'READ-ONLY (a dry run). Plan an animation patch without touching the project: what each operation would do, the exact diff, the frames affected, which parts/props/effects move as a consequence, whether it violates a constraint or a lock, and whether Part 54 calls it a local correction or a broad rewrite. Returns a transaction id in state "previewed" and proves it changed nothing via `state_unchanged`. Call this before apply_animation_patch — apply refuses a patch that was not planned.',
  {
    ops: PATCH_OPS_SCHEMA,
    intent: z.string().optional().describe('What this patch is for, in one line. Kept on the transaction and in provenance.'),
    request: z.string().optional().describe("The user's own words, verbatim."),
    strict: z.boolean().optional().describe('Treat every warning as a refusal (default false). Rollback patches use this internally.'),
    constrain: CONSTRAIN_SCHEMA.optional(),
    frame: z.number().optional().describe('Frame at which semantic constraint targets are resolved. Defaults to the playhead.'),
  },
  async (a) => { try { return textResult(await call('preview_animation_patch', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'apply_animation_patch',
  'MUTATING (transactional, undoable, rollback-capable). Apply an animation patch atomically. Refuses when a constraint whose response is "refuse" is violated, and refuses without applying anything partial — the committed state\'s content hash is verified against the plan\'s, and a mismatch restores the previous state. Snapshots and pins the before-state, records provenance, and returns a transaction id you can roll back whole or scoped to one property or frame range. Pass force: true to override your own constraint; the override is recorded on the transaction rather than hidden.',
  {
    ops: PATCH_OPS_SCHEMA,
    intent: z.string().optional(),
    request: z.string().optional(),
    strict: z.boolean().optional(),
    constrain: CONSTRAIN_SCHEMA.optional(),
    frame: z.number().optional(),
    force: z.boolean().optional().describe('Apply despite a refusing constraint. The violation is recorded as a user override, not discarded.'),
    snapshotFirst: z.boolean().optional().describe('Snapshot and pin the before-state (default true). Turning this off removes the rollback of last resort.'),
  },
  async (a) => { try { return textResult(await call('apply_animation_patch', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'rollback_transaction',
  'MUTATING (undoable). Reverse an applied patch using its recorded inverse — the whole thing, or scoped to one property, one item, one track, or one frame range. A scoped rollback reports what it did NOT undo (`not_undone`) and what of the transaction is still applied (`still_applied`), and a later call with no scope reverses the rest. Refuses honestly when the project has moved on in a way that consumed what the inverse expected, rather than half-applying.',
  {
    transactionId: z.string().describe('From apply_animation_patch or list_transactions.'),
    property: z.string().optional().describe('Track entity id (e.g. "track:<itemId>/RightShoulder") to roll back only that property.'),
    itemId: z.string().optional().describe('Roll back only operations on this item.'),
    track: z.string().optional().describe('Roll back only operations on this track name.'),
    timeRange: z.array(z.number()).length(2).optional().describe('[from, to] — roll back only operations entirely inside this frame range.'),
  },
  async (a) => { try { return textResult(await call('rollback_transaction', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'list_transactions',
  'READ-ONLY. Every transaction this session holds, with its request, intent, operations, changed entities and properties, changed frame range, constraint set, validation result and whether a rollback is still available. The ledger is IN MEMORY and does not survive a restart; the durable record is the provenance graph inside the project.',
  {
    limit: z.number().optional(),
    status: z.enum(['previewed', 'applied', 'accepted', 'rejected', 'rolled_back', 'failed']).optional(),
  },
  async (a) => { try { return textResult(await call('list_transactions', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'inspect_transaction',
  'READ-ONLY. One transaction in full, including the inverse operations that would undo it, which of them have already been rolled back, and the honest nulls: `baseline_comparison` and `expected_visual_effect` say why they are empty and what unblocks them. Set compareSnapshots to diff the before and after snapshots.',
  {
    transactionId: z.string(),
    compareSnapshots: z.boolean().optional().describe('Also diff the before/after snapshots (data-side methods only — no image comparison exists yet).'),
  },
  async (a) => { try { return textResult(await call('inspect_transaction', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'inspect_constraints',
  'READ-ONLY. Every persisted lock with what it resolves to right now, plus — if you pass a request — how that request compiles into ConstraintSpecs, which lines were NOT understood, and Part 54\'s priority ladder applied to them. Also returns the constraint vocabulary (types, aspects, selector kinds, which checks are actually implemented and which are blocked on a later phase) and exactly what a patch can and cannot express. Read this before writing a constraint.',
  {
    constrain: CONSTRAIN_SCHEMA.optional().describe('Optional: compile this request and show the result without applying anything.'),
    frame: z.number().optional(),
  },
  async (a) => { try { return textResult(await call('inspect_constraints', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'lock_constraint',
  'MUTATING (undoable). Persist a lock into the project, so every later patch is checked against it — a camera that must not move, an impact frame that must stay put, an arm that is finished. Refuses if the target does not resolve, because a lock over nothing is worse than no lock. Locks live at project.semantics.locks, so they survive save/load and travel with the .cadence file, and they appear as `lock_state` on the Scene Graph.',
  {
    query: z.string().optional().describe('A phrase: "the camera", "the left foot", "the weapon hand".'),
    target: z.any().optional().describe('Or a selector: { kind: "track"|"item"|"key"|"frame"|"marker"|"item_field"|"project_field"|"everything"|"complement"|"semantic", … }.'),
    itemId: z.string().optional(),
    track: z.string().optional(),
    t: z.number().optional().describe('Lock a frame (a protected moment).'),
    aspect: z.any().optional().describe("Lock only one aspect: 'timing', 'value', 'easing', 'space', 'existence', or an array. Omit to lock everything about the target."),
    timeRange: z.array(z.number()).length(2).optional().describe('[from, to] — the lock only bites inside this frame range.'),
    reason: z.string().optional().describe('Why. Reported with the lock; a lock nobody can explain is a lock somebody removes.'),
  },
  async (a) => { try { return textResult(await call('lock_constraint', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'unlock_constraint',
  'MUTATING (undoable). Remove a persisted lock by id. Explicit by design: a patch is never allowed to quietly drop a lock in order to succeed — it refuses, and removing the lock is a separate, recorded decision.',
  { id: z.string().describe('Constraint id from inspect_constraints.') },
  async (a) => { try { return textResult(await call('unlock_constraint', a)); } catch (e) { return errorResult(e); } },
);

// ---------------------------------------------------------------- the formal animation language
//
// Directive Part 20. These four tools are the difference between "write these keyframes" and
// "make this heavier without changing the timing": a request becomes an IntentSpec, the IntentSpec
// becomes a phase-structured MotionPlan, the plan compiles to operations, and every candidate
// change a constraint or a missing capability stopped is reported with what the motion lost.
//
// Read `animation_vocabulary` first. The words carry specific, editable meanings, and a word the
// vocabulary does not know changes nothing rather than being guessed at.

const INTENT_TARGET_SCHEMA = {
  itemId: z.string().optional().describe('The rig to plan against. Required unless the intent already names one.'),
  timeRange: z.array(z.number()).length(2).optional().describe('[from, to] in frames. Narrows the edit; without it (or a named phase) the plan applies to the whole keyed span and says so as a risk.'),
  terms: z.array(z.any()).optional().describe('Bypass the text scanner: ["heavy"] or [{ term: "heavy", weight: 1.4 }]. Negative weight means "less".'),
  mode: z.string().optional().describe("Part 11's operating mode (create/polish/analyze/fix/experiment/review/ship). Recorded on the intent."),
};

server.tool(
  'animation_vocabulary',
  'READ-ONLY. What the animation words actually mean here. Every term ("heavy", "snappy", "floaty", "panicked", "elegant", "powerful", "weary", …) with the motion dimensions it pulls on, what it deliberately does NOT change (heavy does not mean slow), its counterexamples and common failure modes, and any scoped override this project holds. Also returns the request grammar interpret_intent understands, the compiler strategies and their bounds, and which acceptance checks are real versus blocked on a later phase. Read this before phrasing a request.',
  {
    itemId: z.string().optional().describe('Show character-scoped overrides for this item too.'),
    style: z.string().optional().describe('Show style-scoped overrides for this style profile too.'),
  },
  async (a) => { try { return textResult(await call('animation_vocabulary', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'set_vocabulary_term',
  'MUTATING (undoable). Record that a term means something different for this project, character or style — as a scoped DELTA against the shared definition, never a replacement. Requires `evidence`: at least one statement of what the user said or did that justifies it, because Part 21 asks for a corrected interpretation captured with its reasoning rather than a silent redefinition. The same correction recorded twice increments an observation count instead of duplicating.',
  {
    term: z.string().describe('An existing term from animation_vocabulary. Inventing a new word is not supported — a term needs counterexamples and failure modes, not just a number.'),
    dimensions: z.record(z.number()).optional().describe('Deltas against the default, e.g. { motion_amplitude: -0.2 } for "heavy should not make things bigger on this character". Range [-2, 2].'),
    scope: z.enum(['project', 'character', 'style']).optional().describe('Default project. "character" and "style" need a scopeId.'),
    scopeId: z.string().optional().describe('The item id (character scope) or style profile name (style scope).'),
    note: z.string().optional(),
    evidence: z.array(z.any()).describe('Required. What was said or observed that justifies the change.'),
    author: z.string().optional(),
  },
  async (a) => { try { return textResult(await call('set_vocabulary_term', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'interpret_intent',
  'READ-ONLY. Turn a request into an IntentSpec and say out loud what it was taken to mean, before anything is planned or changed. Returns the dimension vector the words produced, a human-readable interpretation naming both what will change and what is protected, the ConstraintSpecs the preserve clause compiles to, any tension between contradictory words, and — importantly — the words that were NOT understood, which changed nothing. The grammar is closed: nothing is guessed from unrecognised text.',
  {
    request: z.string().optional().describe('The user\'s own words, e.g. "make the slash heavier without changing timing" or "less floaty, keep the impact on frame 16".'),
    ...INTENT_TARGET_SCHEMA,
    actionType: z.enum(['attack', 'locomotion', 'reaction', 'gesture', 'idle', 'cinematic', 'custom']).optional().describe('Overrides what the text implied. Selects the phase template, so getting it wrong shapes the whole plan.'),
    styleProfile: z.string().optional().describe('realistic | anime | cartoon | game_combat | cinematic | mechanical | horror | fantasy | abstract'),
    preserve: z.array(z.string()).optional().describe('Extra semantic targets to protect, on top of anything the text asked for.'),
    preserveAspects: z.array(z.enum(['timing', 'value', 'easing', 'space', 'existence'])).optional().describe("Aspects to protect. 'timing' is how \"without changing timing\" is expressed structurally."),
    protectFrames: z.array(z.object({ frame: z.number(), tolerance: z.number().optional(), reason: z.string().optional() })).optional(),
    narrativePurpose: z.string().optional(),
    realismLevel: z.enum(['stylized', 'hybrid', 'realistic']).optional(),
    readabilityPriority: z.enum(['low', 'medium', 'high']).optional(),
    audienceFocus: z.enum(['character', 'weapon', 'target', 'environment', 'camera']).optional(),
  },
  async (a) => { try { return textResult(await call('interpret_intent', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'plan_motion',
  'READ-ONLY (a dry run). Cut the existing animation into phases, choose edit strategies from the intent, and show the operations that WOULD be applied — without touching anything. Every phase says how it was named and how certain that is (a declared boundary is certain, a marker is highly likely, a rate profile is only possible). Every candidate change a constraint refuses or a missing capability blocks appears in `blocked` and `lost`, with what the motion gives up by its absence: "heavier without changing timing" cannot have body-lead offsets, and this is where it says so. Also returns the AcceptanceSpec the change will be judged against.',
  {
    request: z.string().optional().describe('The request text. Or pass `intent` from interpret_intent.'),
    intent: z.any().optional().describe('An IntentSpec from interpret_intent, optionally edited. Its preserve clause is compiled on top of any `constrain` you pass, never replaced by it.'),
    ...INTENT_TARGET_SCHEMA,
    boundaries: z.array(z.object({
      name: z.enum(['preparation', 'anticipation', 'acceleration', 'action', 'impact', 'follow_through', 'recovery', 'settle']),
      from: z.number(), to: z.number(), purpose: z.string().optional(),
    })).optional().describe('Declare the phases yourself. Overrides segmentation entirely, and is the fix when the inferred phases are wrong.'),
    constrain: CONSTRAIN_SCHEMA.optional().describe('Extra constraints on top of whatever the request implied.'),
  },
  async (a) => { try { return textResult(await call('plan_motion', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'apply_motion_plan',
  'MUTATING (transactional, undoable, rollback-capable). Interpret, plan, compile and apply in one call, then evaluate the plan\'s own acceptance criteria against the before-state. Re-plans against the live project rather than trusting an earlier plan_motion, snapshots and pins the before-state, and returns a transaction id that rollback_transaction can reverse whole or scoped. A plan every constraint blocks returns applied:false with the explanation — that is an outcome, not an error. The acceptance report separates `accepted` from `fully_validated`: nothing here renders, so the visual check always comes back NOT RUN.',
  {
    request: z.string().optional(),
    intent: z.any().optional(),
    ...INTENT_TARGET_SCHEMA,
    boundaries: z.array(z.any()).optional().describe('Declared phase boundaries, as in plan_motion.'),
    constrain: CONSTRAIN_SCHEMA.optional(),
    force: z.boolean().optional().describe('Apply despite a refusing constraint. Recorded as a user override on the transaction, not hidden.'),
  },
  async (a) => { try { return textResult(await call('apply_motion_plan', a)); } catch (e) { return errorResult(e); } },
);

// ---------------------------------------------------------------- authoring (generation)

const POSE_GOAL_SCHEMA = z.array(z.object({
  joint: z.string().optional().describe('The exact joint/track name, e.g. "RightShoulder". inspect_rig lists them.'),
  semantic_role: z.string().optional().describe('Or a role phrase ("right shoulder", "left knee") / a role id. Refused if it resolves to more than one joint — it never picks for you.'),
  side: z.enum(['left', 'right', 'centre']).optional(),
  rotation_goal: z.object({
    x: z.number().optional(), y: z.number().optional(), z: z.number().optional(),
  }).optional().describe('DEGREES about the joint\'s own axes, absolute from rest, composed Rx·Ry·Rz — the same numbers get_rotation_degrees reads back and the editor\'s rotation fields show. Never write a CFrame: call pose_conventions for what each axis means on this rig.'),
  position_goal: z.object({
    effector: z.string().describe('The part to place: "left foot", "right hand", or an exact part id.'),
    target: z.object({
      world: z.array(z.number()).optional().describe('An absolute world position in studs.'),
      relative_to: z.string().optional().describe('Or a named part, plus `offset`.'),
      offset: z.array(z.number()).optional().describe('Offset in world studs.'),
      hold: z.boolean().optional().describe('Or hold the effector exactly where it is at the script\'s start frame — this is how a planted foot is AUTHORED rather than measured afterwards and apologised for.'),
    }),
    bend: z.enum(['natural', 'reverse']).optional().describe('Which way the middle joint bends. "natural" is the declared human direction; "reverse" deliberately bends a knee backwards, and nothing stops you.'),
    twist_deg: z.number().optional().describe('Roll about the reach direction. Changes the limb\'s orientation without moving the effector at all.'),
    chain_length: z.number().optional().describe('How many joints up from the effector to consider (default 3: the two most proximal solve, the rest hold).'),
    bend_axis: z.array(z.number()).optional().describe('Required only where no natural bend is declared (a chain whose middle joint is a shoulder). Positive rotation about this axis is the bend.'),
    effector_offset: z.array(z.number()).optional().describe('A point inside the effector part, in its own frame — a sword tip rather than a hand centre.'),
  }).optional(),
})).describe('Pose goals. A PoseSpec\'s body_region_targets array, or the goals directly.');

server.tool(
  'pose_conventions',
  'READ-ONLY. What a pose goal may say, and what every axis means on this rig — read it before writing your first goal. Returns the rotation convention (degrees, Rx·Ry·Rz, the same numbers get_rotation_degrees reports), what +X/+Y/+Z do at each joint on a humanoid, the declared natural bend direction for every two-bone chain, and the exact reach chains this rig has with their bone lengths in studs. You never write a CFrame, a quaternion or an axis sign: state degrees and studs, and the compiler composes them.',
  { itemId: z.string().optional().describe('The rig. Defaults to the first rig item in the project.') },
  async (a) => { try { return textResult(await call('pose_conventions', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'compile_pose',
  'READ-ONLY (a dry run). Turn pose goals into the keyframe operations that realise them at one frame, and measure the resulting pose — WITHOUT applying anything. Rotation goals are exact degrees; a reach goal is solved analytically onto its target and lands on it to floating-point precision, or reports how many studs short it falls and why (it never silently approximates). Returns the line of action, a volume-proxy centre of mass, and balance against the support you declare — measurements, not judgements: whether the pose READS is not something this build decides. Hand `ops` to preview_animation_patch or apply_animation_patch to commit it.',
  {
    itemId: z.string().describe('The rig to pose.'),
    pose: POSE_GOAL_SCHEMA,
    t: z.number().optional().describe('The frame to key at. Defaults to the playhead.'),
    holdFrame: z.number().optional().describe('The frame a `{ hold: true }` reach target reads its position from (default 0).'),
    support: z.array(z.string()).optional().describe('Effectors carrying the body\'s weight, e.g. ["left foot"]. Without it balance comes back null with the reason — nothing here infers which foot is planted.'),
    easing: z.object({ es: z.string().optional(), ed: z.enum(['In', 'Out', 'InOut']).optional() }).optional(),
    onlyNamed: z.boolean().optional().describe('Default true: key only the joints the goals reach. False keys every joint on the rig, making the frame a full-body pose nothing can drift out from under.'),
  },
  async (a) => { try { return textResult(await call('compile_pose', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'author_motion',
  'MUTATING (transactional, undoable, rollback-capable). GENERATE animation on an empty or existing timeline: key poses at the phase frames you declare, plus breakdowns, holds and a settle, applied as one reversible transaction and then measured against an acceptance spec built for authoring. This is the counterpart of apply_motion_plan, which only ever transforms keys that already exist — on an empty rig that one correctly produces nothing, and this one produces the motion. Frames are yours and are never inferred: a phase template names an attack\'s phases in order and says nothing about their durations, so a call with no `phases` returns the phase names and a question rather than a guess. Every authored key is checked against your declared contacts by the same constraint checker an edit goes through, and a step a constraint refuses is dropped and named.',
  {
    request: z.string().optional().describe('What this motion IS, in a sentence — it carries the style and the preserve clause the acceptance is built from. Or pass `intent`.'),
    intent: z.any().optional().describe('An IntentSpec from interpret_intent.'),
    itemId: z.string().optional().describe('The rig to author onto.'),
    actionType: z.enum(['attack', 'reaction', 'gesture', 'locomotion', 'idle', 'transition', 'other']).optional(),
    start: z.object({
      pose: POSE_GOAL_SCHEMA.optional(),
      easing: z.object({ es: z.string().optional(), ed: z.enum(['In', 'Out', 'InOut']).optional() }).optional(),
    }).optional().describe('The pose at the first phase\'s `from` frame. Omitted means the rig\'s rest pose, written explicitly as a key rather than left implied.'),
    phases: z.array(z.object({
      name: z.enum(['preparation', 'anticipation', 'acceleration', 'action', 'impact', 'follow_through', 'recovery', 'settle']).optional(),
      from: z.number().describe('First frame of the phase.'),
      to: z.number().describe('The frame this phase\'s key pose lands on.'),
      pose: POSE_GOAL_SCHEMA.optional(),
      hold_until: z.number().optional().describe('Write the same pose again at this frame, so the hold is real data rather than an accident of interpolation.'),
      breakdown: z.object({
        at: z.number().describe('The frame the breakdown key lands on, strictly inside the span.'),
        bias: z.number().describe('How far between the two key poses the breakdown SITS (0 = the earlier pose, 1 = the later). Deliberately not the time fraction: the gap between them is what makes the motion favour one end.'),
      }).optional(),
      easing: z.object({ es: z.string().optional(), ed: z.enum(['In', 'Out', 'InOut']).optional() }).optional(),
    })).optional().describe('The phase timing, in exact frames. Required — nothing here invents a duration.'),
    settle: z.object({
      overshoot_at: z.number().describe('A frame strictly between the second-to-last key and the last one.'),
      ratio: z.number().describe('How far past the final pose the overshoot travels, as a fraction of the last transition.'),
      easing: z.object({ es: z.string().optional(), ed: z.enum(['In', 'Out', 'InOut']).optional() }).optional(),
    }).optional(),
    contacts: z.array(z.object({
      effector: z.string().describe('Use a ROLE PHRASE ("left foot"), not a part name — a part name resolves for the measurement and NOT for the constraint, and a violation rate of 0 would then be a lie.'),
      start: z.number(), end: z.number(), tolerance_studs: z.number().optional(),
      mode: z.enum(['planted', 'sliding', 'glancing', 'gripping', 'collision', 'suspended', 'custom']).optional(),
    })).optional(),
    support: z.array(z.string()).optional().describe('Effectors carrying the weight, for the balance measured at every key.'),
    keyAllTouched: z.boolean().optional().describe('Default true: every authored frame keys every joint the script touches, so a joint posed in one phase and not the next holds visibly instead of drifting by interpolation.'),
    constrain: CONSTRAIN_SCHEMA.optional(),
    force: z.boolean().optional().describe('Apply despite a refusing constraint. Recorded as a user override on the transaction, not hidden.'),
  },
  async (a) => { try { return textResult(await call('author_motion', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'evaluate_acceptance',
  'READ-ONLY. Run an AcceptanceSpec against the current project, comparing to a snapshot or a transaction\'s before-state. Each check comes back pass / fail / NOT RUN — never "passed" for something that could not be evaluated — and the summary counts all three separately. `proxies` names the checks that measure something adjacent to the artistic claim rather than the claim itself: rotation amplitude going up is a fact, "it reads heavier" is not something any check here can decide.',
  {
    acceptance: z.any().describe('An AcceptanceSpec — plan_motion returns one, or build one from animation_vocabulary.language.acceptance_checks.'),
    snapshotId: z.string().optional().describe('The state to compare against. list_snapshots shows what is held.'),
    transactionId: z.string().optional().describe('Or a transaction id, whose before-snapshot becomes the baseline.'),
    itemId: z.string().optional().describe('Default item for checks that do not name one.'),
  },
  async (a) => { try { return textResult(await call('evaluate_acceptance', a)); } catch (e) { return errorResult(e); } },
);

// ================================================================ observation and baseline
//
// Directive Parts 43 (the observation layer), 44 (deterministic visual regression) and 45 (change
// explanation). The loop is: plan_observation → create_baseline → edit → explain_change, with
// approve_difference to retire a difference that is intended.
//
// Two properties are worth knowing before calling any of these, because they decide whether the
// answers mean anything. Passes are rendered with ANTIALIASING OFF and at a square resolution, so
// exact pixel comparison is exact. And every render carries a camera fingerprint: explain_change
// reproduces the baseline's exact viewpoint, and a comparison across two different viewpoints is
// REFUSED rather than reported, because every pixel would differ for a reason that has nothing to
// do with the animation.

server.tool(
  'plan_observation',
  'READ-ONLY. Part 43\'s hierarchical observation policy: given what changed, which evidence is worth gathering, cheapest first — and which tiers were skipped, with the reason. Answers "should I render at all?" (usually no: a keyframe edit is fully described by the curve difference) and, when a render IS warranted, which passes at which frames. Also lists every Part 43 pass this build cannot produce, with what blocks each. Call this before create_baseline if you are not sure what to observe.',
  {
    from: z.string().optional().describe('Snapshot id for the before-state. Omit to use the live project.'),
    to: z.string().optional().describe('Snapshot id for the after-state. Omit to use the live project.'),
    question: z.string().optional().describe('What you are trying to find out — carried into the plan and the coverage report.'),
    maxFrames: z.number().optional().describe('Cap on suspect frames (default 6). Frames dropped by the cap are named, never silently omitted.'),
  },
  async (a) => { try { return textResult(await call('plan_observation', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'create_baseline',
  'MUTATING (appends to the project; no animation data is touched). Record an approved state as a baseline (Part 44): a pinned scene snapshot, the animation/camera/VFX revisions, and a rendered silhouette and object-ID pass at each chosen frame. The baseline lives INSIDE the project, so it survives save/load — but a saved file holds a digest and a 16x16 signature per observation, not pixels: the full rasters are session-only, and a comparison in a later session degrades to block granularity and says so. Four of Part 44\'s seventeen fields (lighting, colour management, simulation seeds, cache hashes) are null with the reason in `unavailable`, because Cadence has nothing behind them. Take a baseline BEFORE the edit you want to be able to explain.',
  {
    name: z.string().optional().describe('A name you will recognise later. Defaults to "baseline N".'),
    frames: z.array(z.number()).optional().describe('Frames to observe. Defaults to the current playhead. plan_observation suggests a set.'),
    passes: z.array(z.enum(['silhouette', 'object_id'])).optional().describe("Default ['silhouette','object_id']. Anything else is reported as skipped rather than silently dropped."),
    size: z.number().optional().describe('Square render resolution, 32-512 (default 192). The comparison refuses to compare two different resolutions.'),
    reason: z.string().optional().describe('Why this state is worth pinning.'),
    acceptance: z.any().optional().describe('An AcceptanceSpec this baseline is the accepted result of (from plan_motion).'),
    author: z.string().optional(),
  },
  async (a) => { try { return textResult(await call('create_baseline', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'list_baselines',
  'READ-ONLY. Every baseline this project holds, with its frame range, passes, revisions, pinned snapshot and approved-difference count, plus whether the session still holds the full rasters.',
  {},
  async () => { try { return textResult(await call('list_baselines')); } catch (e) { return errorResult(e); } },
);

server.tool(
  'explain_change',
  'READ-ONLY (it appends an analysis record to provenance; no animation data is touched). Part 44\'s regression workflow and Part 45\'s explanation, in one call: re-render the baseline\'s exact passes at its exact frames from its exact viewpoint, diff the project data, and report every difference with Part 44\'s ten answers — what, where, when, which objects, which transaction explains it, whether it is deterministic, and whether it needs you. Each is classified expected / unexpected / uncertain / approved: `expected` means a specific applied transaction names the entity or the object moves as a rig consequence of one that does; `uncertain` means the evidence needed was not available and is never reported as a pass. Causes are RANKED with the evidence that would distinguish them, and the minimum safe correction is named. This is the tool that answers "what did my edit actually change?".',
  {
    baselineId: z.string().optional().describe('From list_baselines. Omit for the most recent baseline.'),
    frames: z.array(z.number()).optional().describe("Override which frames to re-observe. Defaults to exactly the baseline's own frames — anything else cannot be compared."),
    size: z.number().optional().describe("Override the render resolution. Do not, unless you know why: a different resolution makes every pass incomparable and the result will say so."),
    observe: z.boolean().optional().describe('Render the passes (default true). false gives the data-side comparison alone, and the coverage report names what was not looked at.'),
    request: z.string().optional().describe('The question in your own words, kept on the explanation and in provenance.'),
  },
  async (a) => { try { return textResult(await call('explain_change', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'approve_difference',
  'MUTATING (appends to the project). Record that a difference against a baseline is intended (Part 44\'s fourth classification). An approval is scoped to one target and REQUIRES a reason — an unattributed "this is fine" cannot be reviewed later, which is the whole point of recording it. Afterwards explain_change reports that difference as `approved` rather than as a finding.',
  {
    baselineId: z.string().describe('From list_baselines.'),
    target: z.string().describe('What is approved: an entity id, a track entity id, or a difference\'s `where_did_it_change.entity` from explain_change.'),
    kind: z.string().optional().describe("Restrict to one difference kind ('curve', 'silhouette', 'object_id_shift', 'object_property'). Default 'any'."),
    reason: z.string().describe('Why this difference is intended. Required.'),
    author: z.string().optional(),
  },
  async (a) => { try { return textResult(await call('approve_difference', a)); } catch (e) { return errorResult(e); } },
);

// ---------------------------------------------------------------- motion and contact analysis (Parts 22, 23, 30, 46)

server.tool(
  'analyze_motion',
  'READ-ONLY. Part 23\'s mathematical motion model, sampled per frame from the forward-kinematic solve: world position and rotation, linear and angular velocity, acceleration, angular acceleration, jerk, path curvature, plus key density and interpolation types over the range. Also returns Part 22\'s first Motion Graph question — each joint\'s onset and peak frame along a chain, and any inversion where a child starts before its parent (reported, never called wrong: Part 22 lists whip cracks and isolated gestures as legitimate exceptions). Angular speed is UNSIGNED, so a reversal and a continuation look alike. Screen-space velocity, balance and distance-from-an-expected-arc are NOT measured and say what blocks each. Nothing here judges whether the motion is good.',
  {
    itemId: z.string().optional().describe('The rig item. Defaults to the current selection.'),
    parts: z.array(z.string()).optional().describe('Part ids to sample. Default: every contact-capable part plus the root and hips — sampling all fifteen R15 parts buries those in numbers.'),
    from: z.number().optional().describe('First frame. Defaults to the item\'s first key.'),
    to: z.number().optional().describe('Last frame. Defaults to the item\'s last key. A range needing more than 601 samples is truncated and the truncation is named.'),
    step: z.number().optional().describe('Frames between samples (default 1). The grid is always uniform, because a non-uniform one makes the second and third derivatives quietly wrong.'),
    chain: z.array(z.string()).optional().describe('Joint track names in the order they are EXPECTED to fire, root-most first. Omit to derive it from rig depth — the derivation is reported as an assumption, and it never joins a left leg to a right arm.'),
  },
  async (a) => { try { return textResult(await call('analyze_motion', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'analyze_contacts',
  'READ-ONLY. Does a declared contact hold? For each contact, the effector\'s world travel is measured over its frame range against its declared positional tolerance (Part 23 / Part 30 contact locking), and the result reports the worst drift, the frame it first crossed, and by how much it misses. IMPORTANT: nothing here INFERS a contact — if none is declared, none is measured, and the tool says so rather than guessing which foot was meant to be planted. The contact point is the effector\'s own world position on the contact\'s first frame, because Cadence has no ground plane or collision surface; an effector that was already sliding when the contact was declared measures clean. A `sliding` or `glancing` contact is measured and NOT judged.',
  {
    itemId: z.string().optional().describe('The rig item. Defaults to the current selection.'),
    contacts: z.array(z.object({
      effector: z.string().describe('A part id, a part name, or a semantic phrase such as "the left foot".'),
      start: z.number(), end: z.number(),
      tolerance_studs: z.number().optional().describe('Omit and the drift is measured but NOT judged — "no tolerance" is not "any drift is acceptable".'),
      rotational_tolerance_deg: z.number().optional(),
      mode: z.string().optional().describe("Part 20.5's modes: planted (default) | sliding | glancing | gripping | collision | suspended. Only planted and gripping are judged against a tolerance."),
      itemId: z.string().optional(),
    })).optional().describe('Contacts to measure directly.'),
    constrain: z.object({
      text: z.string().optional().describe('The closed grammar, e.g. "keep the left foot within 0.05 studs from frame 12 to 23".'),
      contacts: z.array(z.object({ effector: z.string(), from: z.number(), to: z.number(), tolerance_studs: z.number(), reason: z.string().optional() })).optional(),
    }).optional().describe('A constraint request to compile contacts out of — the same shape the patch tools take.'),
  },
  async (a) => { try { return textResult(await call('analyze_contacts', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'explain_motion_problem',
  'READ-ONLY (it appends an analysis record to provenance when it reaches a conclusion; no animation data is touched). Part 46\'s "why?" diagnostics. Two questions are answered here: `why_is_this_contact_unstable` measures the drift and then ATTRIBUTES it — each ancestor joint is frozen at the contact\'s first frame in turn and the drift re-measured, so the cause is a counterfactual rather than a coincidence, and root motion is one of the candidates. `why_is_this_motion_bad` measures speed, acceleration and jerk around a frame and runs Part 23\'s noise-and-signal policy first: a stepped key, a held pose and a marked impact are authored, and are NOT reported as defects. Every answer carries Part 46\'s eight fields — observed facts, referenced plan, dependencies, ranked causes, confidence, non-destructive next checks, a safe recommended action, and a user-intent question when it cannot decide. Two of Part 46\'s seven workflows are routed to explain_change and three are blocked; all seven are listed with the reason.',
  {
    question: z.string().describe('why_is_this_contact_unstable | why_is_this_motion_bad. The other five are listed in the result with what each is routed to or blocked on.'),
    itemId: z.string().optional().describe('The rig item. Defaults to the current selection.'),
    effector: z.string().optional().describe('Contact questions: a part id, a part name, or a semantic phrase.'),
    start: z.number().optional().describe('Contact questions: first frame of the contact.'),
    end: z.number().optional().describe('Contact questions: last frame of the contact.'),
    tolerance_studs: z.number().optional().describe('Contact questions. Without it the drift is reported with a question rather than a verdict.'),
    mode: z.string().optional().describe("Contact questions: Part 20.5's contact mode. Default planted."),
    joint: z.string().optional().describe('Motion questions: the joint track name.'),
    frame: z.number().optional().describe('Motion questions: the frame in question.'),
    radius: z.number().optional().describe('Motion questions: how many frames either side to sample (default 6).'),
  },
  async (a) => { try { return textResult(await call('explain_motion_problem', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'list_shot_events',
  'READ-ONLY. The whole shot\'s events in one ordered timeline (Part 41). Cadence stores event markers per item, so no existing surface shows two events on DIFFERENT items landing on the same frame, or one event\'s Luau hook firing inside another\'s span — this projects every per-item marker table into a single view and reports exactly that: `concurrent` (events sharing a frame, flagged `crossItem`) and `overlapping` (spans that intersect, with the extent). Co-timing is reported as a FACT, never as a problem: two characters impacting on one frame is usually the point. An event id encodes the frame it was read at, so it does NOT survive a retime — resolve by name after moving markers. A marker table whose owning item has been deleted is reported as a warning rather than listed as an event.',
  {
    itemId: z.string().optional().describe('Restrict to one item\'s events. Omit for the whole shot, which is the point of the tool.'),
  },
  async (a) => { try { return textResult(await call('list_shot_events', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'describe_shot',
  'READ-ONLY. The shot-shaped facts this project actually carries (Part 40): fps, length, duration, play range, loop, priority, cameras, characters, effects and event frames. IMPORTANT: Cadence has NO Shot entity, and this does not invent one — it reports what is recorded and names what is not in an `absent` block (no staging or coverage record, no CameraSpec, and with two or more cameras nothing marks which one the shot uses, because the editor tracks a view as UI state and never saves it as shot data). Writing "the shot" means writing the project.',
  {},
  async (a) => { try { return textResult(await call('describe_shot', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'validate_effect_timing',
  'READ-ONLY. Does each particle emitter\'s rate envelope land on the event it is reacting to (Parts 38-39)? For every `vfx` item it measures the `@rate` track and reports: whether the peak sits exactly on a nearby shot event or is off by N frames; an emitter with no envelope at all (which emits at a constant rate for the whole timeline and so is timed to nothing); an envelope whose last key is non-zero (it keeps emitting forever); and one whose first key is already hot. It also lists emitters stacked on the SAME anchor part, which is Part 38\'s hierarchy question — a primary plus its residual is the intended shape, so that is reported and not judged. This measures the envelope, not the picture: whether an effect READS as an impact needs the observation passes, which are not built (VFX-009).',
  {},
  async (a) => { try { return textResult(await call('validate_effect_timing', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'compile_effect',
  'MUTATING (one reversible transaction; roll it back with rollback_transaction, or pass preview to dry-run it first). Compiles a declarative VFXSpec into a particle emitter that is attached, timed and reversible (Parts 37-39). The effect is described by WHAT IT IS rather than by emitter numbers: a `primitive` (one of 22 material archetypes — explosion-debris, blood-splatter, smoke, fire, muzzle-spark, confetti…), a colour `theme`, a `scale`, and a Part 38 `role` that governs its share of the particle budget (primary 100%, supporting 50%, residual 25%). `timing.event` names a shot event from list_shot_events and the rate envelope is built around it — `lead` is how far BEFORE the event the effect PEAKS, then attack/sustain/decay. The emitter is created ATTACHED to the anchor part, so it rides the animation instead of sitting still. The new item id is DERIVED from the spec, so compiling the same spec twice refuses as a duplicate instead of silently stacking two identical emitters. SCOPE: this compiles ONE emitter item; it does not author a multi-layer PNX effect graph (use the pnx_* and vfx_* tools for that), and it cannot declare light, sound or particle collision because a Cadence project has nowhere to keep them.',
  {
    primitive: z.string().describe('The material archetype, e.g. "explosion-debris". A wrong one is refused with the nearest match rather than silently defaulted; the full list comes back in the refusal.'),
    theme: z.string().optional().describe('classic (the material\'s own colours) | ice | ember | toxic | arcane | holy.'),
    scale: z.string().optional().describe('small | standard (default) | large — scales size, rate and pool cap together.'),
    role: z.string().optional().describe('primary (default) | supporting | residual. Part 38\'s hierarchy; it sets the budget share, and a reduced cap is reported rather than applied silently.'),
    name: z.string().optional().describe('Display name. Defaults to the preset\'s name.'),
    anchor: z.union([
      z.string().describe('A part name on the currently selected item.'),
      z.object({ itemId: z.string(), partId: z.string().optional() }),
    ]).optional().describe('The part the effect rides on. Omit for a world-space effect at the offset.'),
    offset: z.array(z.number()).length(3).optional().describe('[x, y, z] studs in the anchor part\'s own space.'),
    timing: z.object({
      event: z.union([z.string(), z.number()]).optional().describe('A shot event name, an event id, or a frame. An event name that exists on two items is AMBIGUOUS and refused with the question, rather than resolved to the earlier one.'),
      eventItemId: z.string().optional().describe('Disambiguates an event name carried by more than one item.'),
      frame: z.number().optional().describe('An explicit frame, instead of an event.'),
      lead: z.number().optional().describe('How far BEFORE the event the effect peaks (default 0). Negative trails it.'),
      attack: z.number().optional().describe('Frames from emission start to peak rate (default 1). 0 is clamped to 1 and reported, because two keys on one frame are not a ramp.'),
      sustain: z.number().optional().describe('Frames held at peak (default 0).'),
      decay: z.number().optional().describe('Frames from peak back to zero (default 6).'),
      peak: z.number().optional().describe('Multiplier on the preset\'s base rate at the peak (default 1).'),
    }).optional(),
    budget: z.object({ maxParticles: z.number() }).optional().describe('Particle pool cap before the role\'s share is applied.'),
    colorStart: z.string().optional().describe('Overrides the theme, e.g. "#ffd36b".'),
    colorEnd: z.string().optional(),
    intent: z.string().optional().describe('The request this came from. Recorded in provenance; it does NOT affect the derived item id.'),
    preview: z.boolean().optional().describe('Dry-run: compile and plan the patch, changing nothing.'),
    force: z.boolean().optional().describe('Apply despite constraint warnings.'),
  },
  async (a) => { try { return textResult(await call('compile_effect', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'operating_modes',
  'READ-ONLY. Part 11\'s eight operating modes (create, polish, analyze, compare, fix, experiment, review, ship) and the exploration/production axis that crosses them, with what each one actually changes: whether it may mutate at all, how much freedom it has, what analysis it owes before acting, and what approval it needs. Pass a mode to see what it would resolve to before relying on it. IMPORTANT: a mode NARROWS and never widens — no mode overrides a lock or a refusing constraint, and `create` is the most exploratory mode while still being required to preserve locked properties. `analyze`, `compare` and `review` are read-only and a mutating call in one of them is refused and is NOT forceable, because Part 11 makes leaving a read-only mode the user\'s decision. An unstated mode stays unstated and gets the strictest defaults rather than being guessed from the request text. What a mode requires of the CALLER — "polish must start with diagnosis", "fix must stop when the issue is resolved" — is returned as obligations, because this layer sees one action and not the session history that would prove them.',
  {
    mode: z.string().optional().describe('A mode to resolve, e.g. "experiment". Omit to list them all. A typo is refused rather than falling back to "no mode", which would look permissive and be unlabelled.'),
    discipline: z.string().optional().describe('exploration | production (default). Production means strict constraints, full provenance and explicit acceptance.'),
  },
  async (a) => { try { return textResult(await call('operating_modes', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'compare_experiments',
  'READ-ONLY (it records the comparison in provenance; NO candidate is applied). Part 48\'s controlled experiments: compare bounded, named alternatives and get a recommendation that names the measurements behind it. Every candidate is planned against a CLONE, so comparing four alternatives changes the project zero times — that is what makes this safe to run before deciding anything, and applying the winner is a separate ordinary patch. Each candidate must declare a `hypothesis`, and one without it is REFUSED rather than compared: Part 48 forbids "superficial random parameter changes", and a parameter change with no stated claim is exactly that. Candidates are measured on 5 of Part 48\'s 8 dimensions — constraint compliance, regression risk, motion, intent alignment against the declared acceptance criteria, and a narrow performance proxy; visual analysis, reference alignment, user preference and human review are NOT measured and each says why. `protect` declares the boundary of the experiment and ANY violation disqualifies a candidate, which is deliberately stricter than apply_animation_patch (where a warn-level constraint proceeds, because a human asked for that exact edit). Two candidates that produce identical results are reported as one experiment under two names. If the measured dimensions do not separate the candidates, NO winner is returned and the question a human has to answer is — a recommendation with nothing behind it is the failure this tool exists to prevent.',
  {
    candidates: z.array(z.object({
      name: z.string().describe('Part 48 names its examples "Experiment A" … "Experiment D". Required, so a person can refer to one.'),
      hypothesis: z.string().describe('What this candidate claims will improve, and why. REQUIRED — a candidate without one is refused, not compared.'),
      ops: z.array(z.object({}).passthrough()).describe('The changed variables as real patch operations, in the same shape apply_animation_patch takes.'),
      expected_effect: z.string().optional().describe('What the animator should SEE if the hypothesis holds. Carried for the human review step; not measurable here.'),
      metric: z.string().optional().describe('How this candidate should be judged. Falls back to the set-wide acceptance criteria.'),
      render_configuration: z.object({}).passthrough().optional().describe('Recorded and passed through — this tool renders nothing.'),
      protected_variables: z.array(z.string()).optional().describe('Protections this candidate adds on top of the set-wide ones.'),
    })).min(2).describe('At least two. One alternative is just an edit — use preview_animation_patch for that.'),
    name: z.string().optional().describe('A label for the whole set, e.g. "Give the slash more weight".'),
    intent: z.string().optional().describe('The request this set came from. Recorded in provenance.'),
    itemId: z.string().optional().describe('The item the experiment is about, for the motion measurement. Defaults to the selection.'),
    protect: z.union([z.string(), z.object({}).passthrough()]).optional().describe('Protected variables for the whole set, in the same closed grammar the patch tools take (e.g. "keep the left foot within 0.05 studs from frame 0 to 16"). A line that does not parse is reported, because a protection nobody parsed is a protection nobody applied.'),
    acceptance: z.object({ checks: z.array(z.object({}).passthrough()) }).optional().describe('An AcceptanceSpec for the set. This is how a motion measurement gets a DIRECTION and becomes able to decide — without it, intent_alignment reports not_run rather than passing, and candidates often tie.'),
    frame: z.number().optional().describe('The frame constraints are evaluated at. Defaults to the playhead.'),
    mode: z.string().optional().describe('Part 11 operating mode (default "experiment").'),
    discipline: z.string().optional().describe('exploration | production (default).'),
  },
  async (a) => { try { return textResult(await call('compare_experiments', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'review_shot',
  'READ-ONLY (it records the review in provenance; no animation data is touched). Part 49\'s structured shot review, ordered by Part 14\'s quality hierarchy. Returns deterministic defects and artistic suggestions as SEPARATE lists that are never merged — merging them is how a subjective opinion starts looking like a measurement — plus the single highest-impact failing layer, because Part 14 says to fix that one first. IMPORTANT about coverage: of Part 14\'s 13 quality layers this build measures 3 fully (timing, spacing, contacts), 6 only partly, and 4 NOT AT ALL — readability and staging, pose design, camera relationship and secondary motion. Those four are reported as unmeasured and NEVER as passing, each naming what blocks it, because "pose design: fine" would be worse than useless. Severity is this codebase\'s own convention (the directive requires a severity without defining a scale) and describes CONSEQUENCE, separately from Part 13\'s certainty which describes CONFIDENCE. A contact is only reviewed if one is DECLARED via `constrain` — nothing infers a contact. Part 49 also asks for annotated render crops, and this tool renders nothing: it returns the suspect frame list to look at instead. With two or more rigs and no itemId it asks which character rather than reviewing an arbitrary one.',
  {
    itemId: z.string().optional().describe('The character to review. Defaults to the selection, or the only rig.'),
    acceptance: z.union([z.object({ checks: z.array(z.object({}).passthrough()) }), z.array(z.object({}).passthrough())]).optional().describe('An AcceptanceSpec. This is the ONLY way layer 1 (intent and purpose) becomes measurable — without it, nothing here knows what the shot is for, and that is reported rather than passed.'),
    constrain: z.union([z.string(), z.object({}).passthrough()]).optional().describe('A constraint request in the closed grammar, e.g. "keep the left foot within 0.05 studs from frame 0 to 16". Declares what is protected AND what contact to measure.'),
    from: z.number().optional().describe('First frame. Defaults to the item\'s keyed range.'),
    to: z.number().optional().describe('Last frame.'),
  },
  async (a) => { try { return textResult(await call('review_shot', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'simulate_change',
  'READ-ONLY. Part 47\'s Cadence Simulation: a controlled PRE-COMMIT evaluation of a proposed change. It plans the ops against a clone, reviews the shot before and after, and reports the difference PER QUALITY LAYER — which is the one thing no other tool can say. (preview_animation_patch says what would change; analyse_scope says how far it reaches; review_shot says whether the shot as it stands is any good; this says whether the change would make it better or worse, before it lands.) Returns Part 47\'s Technical / Animation / VFX sections plus recommended actions ordered by Part 14. There is deliberately NO overall score: Part 47 says the report "must never imply that a subjective score is ground truth", and a single number would have to average a measured contact drift against an unmeasurable judgement about pose design. Steps 4 and 5 of Part 47\'s nine-step pipeline — render diagnostic passes, run visual comparisons — CANNOT run here, because this layer has no pixels; they are named in every report, and the frames worth rendering afterwards are listed. Omit `ops` entirely to evaluate the shot as it stands. Nothing is ever applied.',
  {
    ops: z.array(z.object({}).passthrough()).optional().describe('The proposed operations, in the same shape apply_animation_patch takes. Omit to evaluate the shot as it stands with no proposed change.'),
    itemId: z.string().optional().describe('The subject for the review half. Defaults to the selection.'),
    constrain: z.union([z.string(), z.object({}).passthrough()]).optional().describe('What must not be disturbed, in the closed grammar. Also declares the contact to measure.'),
    acceptance: z.union([z.object({ checks: z.array(z.object({}).passthrough()) }), z.array(z.object({}).passthrough())]).optional().describe('An AcceptanceSpec — the shot\'s own definition of done. A change that breaks it is reported as a layer-1 (intent) regression.'),
    intent: z.string().optional().describe('The request this change came from.'),
    frame: z.number().optional().describe('The frame constraints are evaluated at. Defaults to the playhead.'),
  },
  async (a) => { try { return textResult(await call('simulate_change', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'list_workflows',
  'READ-ONLY. Part 52\'s sixteen reusable workflows — the registry is EXACTLY the directive\'s list, because an extra row would be drift and a missing one a gap. Each entry documents Part 52\'s eight required fields: goal, tools used, required input, protected inputs, normal output, failure behaviour, approval points and benchmark coverage. 13 are implemented as declared tool chains (a workflow composes existing tools and implements nothing itself, per Part 52\'s own instruction); 3 are not, and each names what blocks it — `polish_animation` (choosing which defect to correct is the judgement Part 14 orders and this build cannot make), `compare_to_reference` (nothing is ingested to compare against) and `prepare_for_export` (validate.js imports state.js, so the export check cannot run from the pure layer). EVERY workflow reports benchmark_coverage: none, which is not an oversight: Part 52 requires the field and no benchmark suite exists in this build (BCH-001). Pass a `name` to see one workflow and what it needs.',
  {
    name: z.string().optional().describe('One workflow to describe. Omit for the whole catalogue. Resolving with no arguments is how you ask what a workflow requires — the missing-input answer IS the answer.'),
  },
  async (a) => { try { return textResult(await call('list_workflows', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'run_workflow',
  'MUTATING when the chain contains a mutating tool, otherwise read-only (each step is an ordinary tool call, so anything it applies is rolled back with rollback_transaction). Runs one of Part 52\'s workflows as its declared, ordered tool chain. Approval points are ENFORCED, not documented: execution stops BEFORE the first step that changes project data and returns the remaining plan so you can see exactly what you would be approving — pass `approve: true` to run the whole chain. Required input is validated before any step runs, because failing three tools into a chain is worse than a refusal. An unimplemented workflow is refused with what blocks it and hands back no partial plan. A chain also stops at the first step that refuses or throws, since later steps assume the earlier ones worked.',
  {
    name: z.string().describe('The workflow to run. list_workflows returns the sixteen.'),
    args: z.object({}).passthrough().optional().describe('Arguments for the workflow — see its `required_input`.'),
    approve: z.boolean().optional().describe('Run past the approval points. Without this the chain stops before the first mutating step and shows you the rest.'),
    stopAtApproval: z.boolean().optional().describe('Default true. Set false with approve to run straight through.'),
  },
  async (a) => { try { return textResult(await call('run_workflow', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'animation_knowledge',
  'READ-ONLY. The Part 25/26 knowledge system: the twelve classical animation principles (each with the full 20-field structure — definition, use/non-use cases, Cadence representation, detection methods, failure modes, and more), the categories they fall into (essential/advanced/optional/specialized/experimental), the Principle Interaction Graph, the controlled-expansion procedure for adding new entries, and coverage against the Part 73 premium-animation standard. Call with no arguments for the whole catalogue, or `concept` for one entry.',
  {
    concept: z.string().optional().describe('One principle to look up, e.g. "anticipation" or "follow_through_overlap". Omit to list all twelve plus the categories, interaction graph and premium-standard coverage.'),
    category: z.enum(['essential', 'advanced', 'optional', 'specialized', 'experimental']).optional().describe('Filter the full listing to one category. Ignored when `concept` is given.'),
  },
  async (a) => { try { return textResult(await call('animation_knowledge', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'evaluate_technique_relevance',
  'READ-ONLY. Part 71\'s nine-question relevance gate for one knowledge-system concept: does it serve the stated intent, conflict with a locked aspect, violate a constraint, and so on. Answers only the questions this build has real evidence for (aspect-lock overlap, style non-use-cases, intent-vs-use-case text match, and the always-true rollback guarantee) and honestly marks the rest unanswerable — readability, visual noise, and performance cost are never computed. The verdict is built only from what was actually answered.',
  {
    concept: z.string().describe('A concept from animation_knowledge, e.g. "squash_stretch" or "exaggeration".'),
    intent: z.string().optional().describe('Free text describing what the caller is trying to do, checked against this entry\'s own use_cases/non_use_cases.'),
    style: z.string().optional().describe('A style profile name from style_profile — checked against this entry\'s non_use_cases.'),
    lockedAspects: z.array(z.enum(['timing', 'value', 'easing', 'space', 'existence'])).optional().describe('Aspects currently locked or protected on the target, from inspect_constraints. Without this, the conflict questions (4 and 7) report unanswerable rather than assuming no conflict.'),
  },
  async (a) => { try { return textResult(await call('evaluate_technique_relevance', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'style_profile',
  'READ-ONLY. Part 35\'s style catalogue: all ten declared profiles, the vocabulary-dimension multipliers each one applies (grounded in the directive\'s own text for that style), the project\'s currently declared style (or null if none was ever approved), and what this build does NOT yet make style-sensitive (VFX dimensions, camera/lighting, acceptance-check thresholds, review suggestions).',
  {},
  async () => { try { return textResult(await call('style_profile', {})); } catch (e) { return errorResult(e); } },
);

server.tool(
  'set_project_style',
  'MUTATING (undoable). Declare, change, or clear (pass `name: null`) the project\'s approved style. There is no default — until this is called, animation_vocabulary interprets every term with no style bias at all. Once declared, every vocabulary interpretation applies this style\'s dimension modifiers automatically unless a call explicitly passes a different style. This is the mechanism Part 62\'s success condition names: "adapt a new animation using approved project style without making unapproved global assumptions."',
  {
    name: z.enum(['realistic', 'anime', 'cartoon', 'game_combat', 'cinematic', 'mechanical', 'horror', 'fantasy', 'abstract', 'unspecified']).nullable().describe('One of style_profile\'s ten names, or null to clear the declared style entirely.'),
    note: z.string().optional(),
    author: z.string().optional(),
  },
  async (a) => { try { return textResult(await call('set_project_style', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'record_user_correction',
  'MUTATING (undoable). Capture one correction — an edit the user made to the AI\'s work — as evidence toward a learned preference (Part 57). Requires `patternKey` naming the kind of correction this is (this build does not infer that two corrections are "the same kind of thing" from project data alone) and `evidence`. The same patternKey recorded repeatedly accumulates observations on ONE candidate rather than duplicating; once it reaches the sufficiency threshold the result includes a `surfaced_candidate` line for the user to review with review_preference_candidate. Never changes project behaviour by itself.',
  {
    patternKey: z.string().describe('A short, stable name for the kind of correction, e.g. "sword_attack.torso_contribution". The same key on a later correction is treated as the same pattern.'),
    before: z.any().describe('The state before the correction — a diff_snapshots result, a described property, or any structured description of what the AI had produced.'),
    after: z.any().describe('The state after the correction.'),
    changedObjectsAndProperties: z.array(z.string()).optional(),
    changedFrameRange: z.object({ start: z.number(), end: z.number() }).optional(),
    semanticInterpretationThatFailed: z.string().optional().describe('What the AI took the request to mean, that the correction suggests was wrong.'),
    rationale: z.string().optional().describe('What the user said, if anything, about why they made this change.'),
    styleContext: z.string().optional(),
    characterContext: z.string().optional(),
    evidence: z.array(z.any()).describe('Required. What was observed that justifies treating this as a correction rather than an unrelated edit.'),
  },
  async (a) => { try { return textResult(await call('record_user_correction', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'review_preference_candidate',
  'MUTATING (undoable). Part 57\'s five verbs on a learned preference candidate: accept, reject, edit, pause, or delete. `accept` changes ONLY the candidate\'s own status field — it never rewrites animation_vocabulary or any track by itself, because doing that silently is exactly the "unapproved global assumption" Part 62 forbids. A caller that wants an accepted preference to take effect must separately call set_vocabulary_term, citing this candidate as evidence.',
  {
    id: z.string().describe('A memory entry id, from record_user_correction\'s result.'),
    decision: z.enum(['accept', 'reject', 'edit', 'pause', 'delete']),
    editedStatement: z.string().optional().describe('Required when decision is "edit".'),
    note: z.string().optional(),
  },
  async (a) => { try { return textResult(await call('review_preference_candidate', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'store_reference_profile',
  'MUTATING (undoable). Part 36: build a reference profile from an existing item\'s already-authored motion and store it on the project. Only in-project animation items are supported — no video, external Roblox animation files, pose sequences, or renders. Measures what it can (timing, spacing, energy, arc quality, pose density; anticipation/impact only where a named marker exists) and honestly marks the rest (weight, overshoot, silhouette, camera, VFX rhythm, lighting) as not measured rather than guessing. `emulate`/`notCopied` are the caller\'s own declaration of what to keep versus deliberately not copy (Part 36 forbids inferring this) — nothing here applies them to any other item.',
  {
    itemId: z.string().describe('The item whose motion to build a profile from.'),
    frameRange: z.object({ start: z.number(), end: z.number() }).optional(),
    targetItemId: z.string().optional().describe('An item elsewhere in this project the profile is meant to inform — if given, adaptation_needed compares real rig/fps/style facts between the two rather than reporting "not compared".'),
    emulate: z.array(z.string()).optional().describe('Which characteristics the caller intends to carry over. Stored verbatim, not inferred.'),
    notCopied: z.array(z.string()).optional().describe('Which characteristics are deliberately NOT being carried over. Stored verbatim.'),
    label: z.string().optional(),
  },
  async (a) => { try { return textResult(await call('store_reference_profile', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'list_reference_profiles',
  'READ-ONLY. Every reference profile stored on the project by store_reference_profile.',
  {},
  async () => { try { return textResult(await call('list_reference_profiles', {})); } catch (e) { return errorResult(e); } },
);

// ---------------------------------------------------------------- the cross-project library (Part 70)

server.tool(
  'import_from_studio',
  'MUTATING (undoable). Pull an animation out of Roblox Studio into this project as a REFERENCE item beside your work — never onto your working rig. Call with nothing to LIST every rig\'s AnimSaves over the bridge; call with rigName + animName, or an assetId, to import one. This is the route for Roblox\'s own Animation Capture (Animation Editor → Capture → Body tracks a video and saves keyframes into AnimSaves) and for its Animation Importer (a Mixamo FBX retargeted onto R15). A Part 36 profile is built and stored for the imported item, so it is comparable immediately. Nothing here estimates a pose — the estimation is Studio\'s, and a clip that came from Capture must be recorded as provenance kind "captured", estimated true, when you add_to_library it.',
  {
    rigName: z.string().optional().describe('The rig in the open place whose AnimSaves folder holds the animation. Omit with animName to list.'),
    animName: z.string().optional().describe('The KeyframeSequence inside that rig\'s AnimSaves.'),
    assetId: z.string().optional().describe('Alternatively, a published animation asset id to fetch via KeyframeSequenceProvider.'),
    rigType: z.string().optional().describe('Which rig to build for the reference item: r15 (default), r6, rthro, rthroSlender. Animation Capture produces R15.'),
    name: z.string().optional(),
    label: z.string().optional().describe('Label for the stored Part 36 profile.'),
  },
  async (a) => { try { return textResult(await call('import_from_studio', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'import_animation_file',
  'MUTATING (undoable). Import a KeyframeSequence / AnimSaves .rbxm or .rbxmx from disk as a REFERENCE item, with a Part 36 profile stored. Same result as import_from_studio, for an animation that was exported to a file rather than left in the open place. Omit `path` to open a file picker. The LICENCE of whatever you import is yours to declare when you add_to_library it — nothing here infers one from a filename or a folder.',
  {
    path: z.string().optional().describe('Absolute path to the .rbxm/.rbxmx. Omit to open a picker.'),
    rigType: z.string().optional().describe('r15 (default), r6, rthro, rthroSlender.'),
    index: z.number().optional().describe('Which KeyframeSequence in the file, when it holds more than one (default 0).'),
    name: z.string().optional(),
    label: z.string().optional(),
  },
  async (a) => { try { return textResult(await call('import_animation_file', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'add_to_library',
  'MUTATING (writes to the user\'s library folder — NOT undoable, and outside every project). Store one rig item\'s motion in the cross-project library with Part 70\'s full field list: a Part 36 profile is measured from it, and the description, action type, tags, provenance and licence come from you. `provenance.kind` is captured (Roblox Animation Capture — a pose ESTIMATE, so `estimated` must be true and a source_video_url is required), mocap (a retargeted library clip such as Mixamo — a `source` is required), authored (your own accepted shot) or imported (a file). `licenseOrOwnership` needs `terms` and an explicit `redistributable` boolean: nothing in this build infers a licence, and Mixamo clips may be used inside a project but not redistributed as files. The library lives in the app\'s user-data folder and never enters a project file or the repo.',
  {
    itemId: z.string().describe('The rig item whose motion to store.'),
    semanticDescription: z.string().describe('What this motion IS, in a sentence — "a heavy two-handed overhead slash with a long recovery".'),
    actionType: z.string().describe('The shelf it goes on, normalised to lowercase_underscores. Part 59\'s benchmark categories are the vocabulary the first corpus uses ("heavy attack", "walk cycle", "jump and landing"); anything else is allowed and simply searched by its own name.'),
    provenance: z.object({
      kind: z.enum(['captured', 'mocap', 'authored', 'imported']),
      estimated: z.boolean().optional().describe('Required true for "captured": Animation Capture estimates poses from video.'),
      source_video_url: z.string().optional().describe('Required for "captured".'),
      source_timestamps: z.string().optional().describe('Which part of the video, e.g. "8:09–8:24".'),
      estimated_by: z.string().optional().describe('Required for "captured" — normally "Roblox Studio Animation Capture (Body)".'),
      source: z.string().optional().describe('Required for "mocap" — e.g. "Mixamo".'),
      source_file: z.string().optional().describe('Required for "imported".'),
      added_at: z.string().optional(),
    }).describe('Where the motion came from. Never inferred.'),
    licenseOrOwnership: z.object({
      terms: z.string().describe('The actual terms, in your words — e.g. "Mixamo: free to use within a project, redistribution of the clip file is not permitted".'),
      redistributable: z.boolean().describe('Stated explicitly. "Unknown" is how a non-redistributable clip ends up in a product build.'),
      holder: z.string().optional(),
    }),
    intentTags: z.array(z.string()).optional().describe('What it is FOR — "telegraphed", "punishable", "finisher".'),
    styleTags: z.array(z.string()).optional().describe('How it reads — "anime", "realistic", "game_combat".'),
    frameRange: z.object({ start: z.number(), end: z.number() }).optional(),
    parameters: z.array(z.any()).optional(),
    dependencies: z.array(z.any()).optional(),
    performanceCost: z.any().optional(),
    previewMedia: z.array(z.any()).optional(),
    acceptanceTests: z.array(z.any()).optional(),
    baselineExamples: z.array(z.any()).optional(),
    knownFailureCases: z.array(z.string()).optional(),
    version: z.string().optional(),
  },
  async (a) => { try { return textResult(await call('add_to_library', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'search_library',
  'READ-ONLY. Find motion in the cross-project library by action type, intent or style tags, rig compatibility and provenance kind — and, with `nearItemId`, by measured distance from an item in this project. Filters EXCLUDE and say why rather than dropping silently. The ranking is stated and lexicographic (matched tags, then profile distance, then id): there is no weighted score, because no exchange rate between "two tags matched" and "0.3 relative distance" exists to justify one. The distance compares 3 of Part 36\'s 15 dimensions (spacing variability, peak speed, peak angular speed, per part); a null distance means nothing was comparable, usually a different rig, and never that two clips are identical.',
  {
    actionType: z.string().optional(),
    intentTags: z.array(z.string()).optional(),
    styleTags: z.array(z.string()).optional(),
    rig: z.string().optional().describe('Only entries compatible with this rig name.'),
    provenanceKinds: z.array(z.enum(['captured', 'mocap', 'authored', 'imported'])).optional().describe('e.g. ["authored","mocap"] to exclude estimated captures.'),
    nearItemId: z.string().optional().describe('Measure every entry\'s distance from THIS item\'s motion, and return a nearest-by-measurement list beside the search.'),
    limit: z.number().optional(),
  },
  async (a) => { try { return textResult(await call('search_library', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'load_from_library',
  'MUTATING (undoable). Bring a library entry into this project as a REFERENCE item beside your work, with its stored Part 36 profile. Nothing is applied to your rig and nothing is retargeted — Part 36 comparison is advisory, and adapting a reference is a separate, deliberate edit through plan_motion / author_motion. A non-redistributable entry says so in the result.',
  {
    libraryId: z.string().describe('From search_library.'),
    name: z.string().optional(),
  },
  async (a) => { try { return textResult(await call('load_from_library', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'accept_shot',
  'MUTATING (undoable). Part 58 as a tool: record that a shot was accepted or rejected, with what made it work or fail. `decision: "accepted"` records validated_solutions (retained features, selected experiments, constraints that mattered, correlated signals); `"rejected"` records failed_approaches (what was attempted, what happened, what corrected it) — a failed approach is evidence too and is kept. `evidence` is required, the same bar record_user_correction sets. An accepted shot is OFFERED to the cross-project library, never added to it: an entry needs a description, an action type and a licence that nothing can derive from motion data. Returns a dated lesson paragraph and appends it to the library folder\'s lessons.md.',
  {
    itemId: z.string().optional().describe('The item the shot is on. Needed for the library offer.'),
    statement: z.string().describe('What was learned, in one sentence.'),
    decision: z.enum(['accepted', 'rejected']).optional().describe('Default "accepted".'),
    evidence: z.array(z.any()).describe('Required. What was observed that makes this a lesson rather than an opinion.'),
    retainedFeatures: z.array(z.string()).optional().describe('accepted: which features of the result were kept.'),
    selectedExperiments: z.array(z.string()).optional().describe('accepted: which alternatives won.'),
    matteredConstraints: z.array(z.string()).optional().describe('accepted: which constraints turned out to matter.'),
    correlatedSignals: z.array(z.string()).optional(),
    attempted: z.string().optional().describe('rejected: what was tried.'),
    whyItSeemedReasonable: z.string().optional(),
    observedResult: z.string().optional().describe('rejected: what actually happened.'),
    failureKind: z.enum(['objective', 'likely', 'subjective']).optional(),
    correctedBy: z.string().optional(),
    generalized: z.string().optional().describe('rejected: the general lesson, if there is one.'),
    styleOrProjectContext: z.string().optional(),
    offerLibraryEntry: z.boolean().optional(),
  },
  async (a) => { try { return textResult(await call('accept_shot', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'propose_knowledge_entry',
  'MUTATING (writes to the user\'s knowledge folder — NOT undoable, and outside every project). Part 72\'s controlled expansion: add a knowledge entry carrying all twenty Part 25 fields. Two gates, both refusing rather than storing something partial — the SHAPE gate (every field answered, a real category, no placeholder) and the EVIDENCE gate (evidence_status must name a video URL with a timestamp, a directive part, or a measurement this build made). An entry stays `experimental` until a benchmark or the user validates it. It may not shadow one of the twelve classical principles. Nothing here is applied to any animation: an entry is cited, and it becomes a runnable check only if it names `measurement_keys` that already exist in ai/motion.js MEASUREMENTS.',
  {
    entry: z.any().describe('The full entry. Call animation_knowledge with no arguments for the field list and an existing entry to copy the shape from.'),
    apply: z.boolean().optional().describe('false to validate without writing.'),
  },
  async (a) => { try { return textResult(await call('propose_knowledge_entry', a)); } catch (e) { return errorResult(e); } },
);


server.tool(
  'benchmark_library',
  'READ-ONLY. Part 59\'s benchmark library: all 25 baseline categories (each defined with benchmark ids, or blocked with the reason), every defined benchmark with its 15 Part 59 fields, the 21 evaluation dimensions with which 11 this build measures and why the other 10 cannot be measured headless, the human-review rubric (kept apart from everything measured), and the implementation options a prototype can flip without code. Read this before run_benchmark_suite or propose_architecture_improvement.',
  {},
  async () => { try { return textResult(await call('benchmark_library', {})); } catch (e) { return errorResult(e); } },
);

server.tool(
  'run_benchmark_suite',
  'READ-ONLY. Runs the Part 59 benchmark suite — permanent fixtures through the real interpret → plan → compile → check → apply → evaluate pipeline, each benchmark twice for reproducibility — against production, or against a prototype named by `options` (see benchmark_library.implementation_options). The suite runs on its own fixtures and never on the open project: the result carries `live_project_untouched`, measured by hashing the project before and after. By default the run is compared against the committed baseline (renderer/js/ai/benchmarkBaseline.js) per dimension, per benchmark, with no overall score; a difference in either direction means the code changed what a benchmark measures. Wall-clock time is reported and never judged.',
  {
    ids: z.array(z.string()).optional().describe('A subset of benchmark ids from benchmark_library. Omit for all.'),
    options: z.record(z.boolean()).optional().describe('Implementation options to flip, e.g. { protect_support_chains: true } — this makes the run a PROTOTYPE run, labelled as such.'),
    label: z.string().optional(),
    compare: z.union([z.literal('baseline'), z.literal('none'), z.string(), z.object({}).passthrough()]).optional().describe('"baseline" (default) compares against the committed baseline; "none" skips; a run id from this session or a benchmark_run object compares against that.'),
    repeat: z.number().int().min(2).max(5).optional().describe('Runs per benchmark for the reproducibility measurement. Default 2.'),
    verbose: z.boolean().optional().describe('Return every per-benchmark detail block. Default false — the full run is held under run_id.'),
  },
  async (a) => { try { return textResult(await call('run_benchmark_suite', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'detect_recurring_problems',
  'READ-ONLY. Part 60\'s DETECT stage, from durable evidence only: memory candidates that reached the sufficiency threshold (repeated corrections), rollback frequency in this session\'s ledger and in the project\'s provenance graph, and — given a run id — benchmarks that fail reproducibly. Each problem carries evidence, a certainty level and CANDIDATE categories; the category itself is the caller\'s choice, because propose_architecture_improvement refuses a proposal that skipped classification (ARCH-002). Part 60\'s self-critique questions are listed, not answered — they need session history this layer never sees.',
  {
    benchmarkRunId: z.string().optional().describe('A run_id from run_benchmark_suite, to include reproducible benchmark failures.'),
  },
  async (a) => { try { return textResult(await call('detect_recurring_problems', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'propose_architecture_improvement',
  'READ-ONLY (records a proposal in this session and as a provenance note; changes nothing else). Part 60: a proposal must name the problem WITH one of the twelve problem categories, a likely architectural cause, a hypothesis, a runnable minimum prototype (an implementation option from benchmark_library, or the label of a code prototype the CLI runs), the benchmarks that will decide it, and an adoption rule over measured dimensions. Anything missing, unknown, or unmeasurable is REFUSED with the reason rather than filled in. The record carries every Part 60 loop stage; compare, approval and versioning are not done at creation. Nothing is ever applied by this tool (Part 4.8).',
  {
    problem: z.object({
      statement: z.string(),
      category: z.string().describe('One of Part 60\'s twelve: knowledge, representation, tool, observation, planning, generation, evaluation, memory, ux, performance, architecture, platform_limitation. Required.'),
      evidence: z.array(z.any()).optional(),
      source: z.any().optional(),
    }),
    likely_cause: z.string(),
    hypothesis: z.string(),
    prototype: z.object({
      description: z.string(),
      options: z.record(z.boolean()).optional().describe('A declared implementation option the app can run, e.g. { protect_support_chains: true }.'),
      overrides_label: z.string().optional().describe('The label of a code prototype run with tools/benchmark.mjs --prototype; its run is passed to review_architecture_experiment as `after`.'),
    }),
    benchmark_ids: z.array(z.string()).min(1),
    adoption_rule: z.object({
      must_improve: z.array(z.string()).min(1).describe('Measured dimensions that must improve on at least one named benchmark and regress on none.'),
      must_not_regress: z.union([z.literal('all_others'), z.array(z.string())]).optional().describe('Dimensions that may not regress on the named benchmarks. Default all_others.'),
    }),
    engineering_card: z.object({}).passthrough().optional().describe('Part 8\'s engineering card, any subset of its 17 fields; completeness is reported.'),
    rollback_path: z.string().optional(),
    author: z.string().optional(),
  },
  async (a) => { try { return textResult(await call('propose_architecture_improvement', a)); } catch (e) { return errorResult(e); } },
);

server.tool(
  'review_architecture_experiment',
  'READ-ONLY (records the evaluation and any decision in provenance; changes nothing else). With no arguments, lists this session\'s proposals. With a proposalId: runs Part 60\'s COMPARE OLD AND NEW — `before` and `after` are each "baseline" (the committed run), "production" (a fresh production run now), "prototype" (a fresh run with the proposal\'s declared options), "current", a run id from this session, or a benchmark_run object — evaluates the proposal\'s adoption rule mechanically, lists every side effect outside the rule by name, and returns adopt / reject / inconclusive with the cells behind it. The verdict is never the decision: pass `decision` (approve, reject, defer, adopt, roll_back) to record what a PERSON decided. An approval before any evaluation is refused; adoption needs a `version`; a code prototype must be run with tools/benchmark.mjs and passed in as a run.',
  {
    proposalId: z.string().optional(),
    before: z.union([z.string(), z.object({}).passthrough()]).optional().describe('Default "baseline".'),
    after: z.union([z.string(), z.object({}).passthrough()]).optional().describe('Default "prototype".'),
    decision: z.enum(['approve', 'reject', 'defer', 'adopt', 'roll_back']).optional().describe('A human decision to record. Without before/after, only the decision is recorded (and refused if the proposal was never evaluated).'),
    version: z.string().optional().describe('Required for decision "adopt": the version the change ships in.'),
    note: z.string().optional(),
    author: z.string().optional().describe('Who decided. Default "user".'),
  },
  async (a) => { try { return textResult(await call('review_architecture_experiment', a)); } catch (e) { return errorResult(e); } },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main();
