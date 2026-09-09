// The Observation Layer's catalogue and policy (directive Part 43).
//
// Part 43 lists twenty-four things Cadence should be able to show. Four of them exist. The other
// twenty are in the table below anyway, each with what blocks it, because Part 4.7 is explicit
// that a missing capability is named rather than hidden — and because a planner that cannot see
// the list cannot know to ask for depth instead of guessing from a silhouette.
//
// The other half of Part 43 is the part people skip: the HIERARCHICAL OBSERVATION POLICY. "Do not
// flood the model or the user with every pass for every frame." Rendering is the most expensive
// evidence in the system and usually the least necessary — a keyframe edit that changed one
// rotation by 6 degrees is fully explained by the curve difference, and a render adds cost without
// adding certainty. `observationPlan` is the policy as code: it walks Part 43's six tiers cheapest
// first, stops at the tier that can answer, and states what would make it escalate.
//
// Pure: this module chooses and describes observations. It never makes one.

import { CERTAINTY, coverage, evidence, finding } from './certainty.js';

/**
 * Part 43's list, in Part 43's order.
 *
 *   cost         'free'      already in project data, no render
 *                'cheap'     one offscreen render at reduced resolution
 *                'moderate'  a render per frame across a range
 *                'expensive' a full-resolution sequence
 *   implemented  whether this build can actually produce it
 *   derived_from a pass that is produced by post-processing another one rather than by its own
 *                render — real capability, but it inherits that pass's limits
 */
export const PASSES = Object.freeze({
  beauty: {
    id: 'beauty', part43: 'beauty or color render', cost: 'cheap', implemented: true, encoding: 'rgba8',
    answers: ['what it actually looks like'],
    limits: 'captures the whole app window, chrome and all — it is a screenshot, not a clean render pass, so it is unsuitable for pixel comparison',
    unblocked_by: null,
  },
  silhouette: {
    id: 'silhouette', part43: 'silhouette render', cost: 'cheap', implemented: true, encoding: 'gray8',
    answers: ['whether the pose reads', 'whether the outline moved, and by how far'],
    limits: 'rig parts only; ground, grid, effects, sprites and camera bodies are excluded by construction',
    unblocked_by: null,
  },
  object_id: {
    id: 'object_id', part43: 'object-ID pass', cost: 'cheap', implemented: true, encoding: 'id8',
    answers: ['which objects are visible', 'which object occupies a pixel', 'which objects moved on screen'],
    limits: 'one index per rig part; props, effects and screen effects have no index',
    unblocked_by: null,
  },
  object_bounding_boxes: {
    id: 'object_bounding_boxes', part43: 'object bounding boxes', cost: 'cheap', implemented: true, derived_from: 'object_id',
    answers: ['the screen-space extent of each visible object'],
    limits: 'screen-space, from the ID pass — an object hidden behind another reports only its visible extent',
    unblocked_by: null,
  },
  changed_region_mask: {
    id: 'changed_region_mask', part43: 'changed-region masks', cost: 'cheap', implemented: true, derived_from: 'silhouette',
    answers: ['exactly where in frame two renders differ'],
    limits: 'reported as a bounding region and a block grid, not as a per-pixel mask — the mask itself is never returned, because a caller that wanted 36 000 booleans wanted a crop instead',
    unblocked_by: null,
  },
  material_id: { id: 'material_id', part43: 'material-ID pass', cost: 'cheap', implemented: false, unblocked_by: 'Cadence has no material entities — a part carries a colour and a material NAME, not a shared material object to index (SEM-011)' },
  depth: { id: 'depth', part43: 'depth pass', cost: 'cheap', implemented: false, unblocked_by: 'OBS-004 — buildable on the existing scene with a depth override material; not built because nothing yet consumes a depth difference' },
  normal: { id: 'normal', part43: 'normal pass', cost: 'cheap', implemented: false, unblocked_by: 'OBS-005 — the override material is trivial, but a normal difference is only meaningful against a shading model, and nothing here reasons about shading yet' },
  motion_vector: { id: 'motion_vector', part43: 'motion-vector pass', cost: 'moderate', implemented: false, unblocked_by: 'OBS-006 — needs a velocity-writing material set the renderer does not have, which means a previous-frame matrix per object and a custom shader' },
  alpha: { id: 'alpha', part43: 'alpha or matte pass', cost: 'cheap', implemented: false, unblocked_by: 'RND-002 — Cadence models transparency per part rather than as a composited matte, so an alpha pass would report the same thing the silhouette already does' },
  shadow: { id: 'shadow', part43: 'shadow pass', cost: 'moderate', implemented: false, unblocked_by: 'RND-001 — needs the lighting model split into separable contributions; the viewport lighting is a fixed three-light rig with no per-contribution output' },
  lighting_contribution: { id: 'lighting_contribution', part43: 'lighting contribution pass', cost: 'moderate', implemented: false, unblocked_by: 'RND-001 — same fixed lighting rig; there are no light entities to attribute a contribution to' },
  emission: { id: 'emission', part43: 'emission pass', cost: 'cheap', implemented: false, unblocked_by: 'RND-001 — emissive is a per-part material property (Neon) rather than a separable pass, so this would need its own override material set' },
  wireframe: { id: 'wireframe', part43: 'wireframe', cost: 'cheap', implemented: false, unblocked_by: 'nothing technical blocks it; no diagnostic in this build reads a wireframe, and a pass nobody consumes is a maintenance cost with no evidence value' },
  rig_control_view: { id: 'rig_control_view', part43: 'rig-bone or control view', cost: 'cheap', implemented: false, unblocked_by: 'the joint handles exist in the viewport but are excluded from every pass; a control view means rendering them ALONE, which needs its own isolation set (OBS-007)' },
  object_isolation: { id: 'object_isolation', part43: 'selected-object isolation', cost: 'cheap', implemented: false, unblocked_by: 'OBS-007 — the visibility machinery exists (every pass already isolates rig parts from the scene); what is missing is the per-entity selector on the request' },
  effect_isolation: { id: 'effect_isolation', part43: 'selected-effect isolation', cost: 'moderate', implemented: false, unblocked_by: 'OBS-007 + the PNX document model — an effect renders in the studio window, not this scene' },
  contact_sheet: { id: 'contact_sheet', part43: 'frame contact sheets', cost: 'moderate', implemented: false, unblocked_by: 'OBS-008 — a tiling of frames this layer can already render; blocked on nothing but a composite step' },
  crop: { id: 'crop', part43: 'enlarged crops', cost: 'cheap', implemented: false, unblocked_by: 'OBS-008 — the changed region is already computed; cropping to it is the missing step' },
  before_after_overlay: { id: 'before_after_overlay', part43: 'before/after overlays', cost: 'cheap', implemented: false, unblocked_by: 'OBS-008 — both rasters are already held in the session store; what is missing is a composite step and a way to return an image rather than numbers' },
  temporal_trails: { id: 'temporal_trails', part43: 'temporal trails', cost: 'moderate', implemented: false, unblocked_by: 'POL-003 — onion skin exists in the viewport, but nothing renders a trail as an inspectable pass' },
  flicker_heatmap: { id: 'flicker_heatmap', part43: 'flicker heatmaps', cost: 'expensive', implemented: false, unblocked_by: 'needs a run of CONSECUTIVE frames rendered together; the observation policy deliberately samples suspect frames instead, so flicker between two sampled frames is not looked for at all' },
  event_overlay: { id: 'event_overlay', part43: 'event overlays', cost: 'cheap', implemented: false, unblocked_by: 'SHOT-002 — there is no shared shot-event timeline to overlay yet' },
  motion_path: { id: 'motion_path', part43: 'motion paths', cost: 'cheap', implemented: false, unblocked_by: 'MOT-005 — a path needs per-frame world positions, which is Phase 5' },
});

/** The passes this build can actually render or derive. */
export function availablePasses() {
  return Object.values(PASSES).filter((p) => p.implemented).map((p) => p.id);
}

/** The ones it cannot, each with the reason — never an empty list, and never silence. */
export function unavailablePasses() {
  return Object.values(PASSES).filter((p) => !p.implemented).map((p) => ({ pass: p.id, part43: p.part43, unblocked_by: p.unblocked_by }));
}

export function passInfo(id) {
  const p = PASSES[id];
  if (!p) throw new TypeError(`observe: unknown pass "${id}" — Part 43's list is ${Object.keys(PASSES).join(', ')}`);
  return p;
}

/** Passes that must be RENDERED, with derived ones resolved back to their source. Rendering
 *  `changed_region_mask` means rendering `silhouette` and post-processing it; asking the renderer
 *  for the derived name directly would silently produce nothing. */
export function renderablePasses(passes) {
  const out = [];
  for (const id of passes) {
    const p = passInfo(id);
    const src = p.derived_from || p.id;
    if (!PASSES[src].implemented) continue;
    if (!out.includes(src)) out.push(src);
  }
  return out;
}

// ---------------------------------------------------------------- suspect frames

/**
 * Part 43 tier 3: "targeted suspect frames". Given what a diff says changed, which frames are
 * worth rendering — and, just as importantly, why each one.
 *
 * Every returned frame carries its reason, because "we rendered frames 8, 16 and 17" is not
 * evidence of anything on its own, and a later reader has to be able to tell a frame that was
 * chosen from one that happened to be sampled.
 */
export function suspectFrames(diff, { length = null, max = 6, alsoNeighbours = true } = {}) {
  const reasons = new Map();
  const add = (t, why) => {
    if (t === null || t === undefined || !Number.isFinite(t)) return;
    if (length !== null && (t < 0 || t > length)) return;
    const f = Math.round(t);
    if (!reasons.has(f)) reasons.set(f, []);
    if (!reasons.get(f).includes(why)) reasons.get(f).push(why);
  };

  for (const tc of diff?.tracks || []) {
    for (const t of tc.keys_added || []) add(t, `a key was added on ${tc.track}`);
    for (const t of tc.keys_removed || []) add(t, `a key was removed on ${tc.track}`);
    for (const m of tc.keys_modified || []) add(m.t, `a key changed on ${tc.track}`);
    if (tc.space_changed) add(0, `${tc.track} changed track space, which re-interprets every key on it`);
  }

  // The frames BETWEEN two changed keys are where an easing change actually shows, and they are
  // exactly the frames a key-time-only sampler misses. One midpoint per adjacent pair, capped.
  const keyFrames = [...reasons.keys()].sort((a, b) => a - b);
  if (alsoNeighbours) {
    for (let i = 0; i < keyFrames.length - 1; i++) {
      const mid = Math.round((keyFrames[i] + keyFrames[i + 1]) / 2);
      if (mid !== keyFrames[i] && mid !== keyFrames[i + 1]) add(mid, 'midway between two changed keys, where a spacing or easing change shows and a key-time sample would miss it');
    }
  }

  const all = [...reasons.entries()].map(([frame, why]) => ({ frame, why })).sort((a, b) => a.frame - b.frame);
  // Trim from the middle rather than the end: the first and last changed frames bound the edit,
  // and dropping either would understate its extent.
  let chosen = all, dropped = [];
  if (all.length > max) {
    const keep = new Set([0, all.length - 1]);
    const step = (all.length - 1) / (max - 1);
    for (let i = 1; i < max - 1; i++) keep.add(Math.round(i * step));
    chosen = all.filter((_, i) => keep.has(i));
    dropped = all.filter((_, i) => !keep.has(i)).map((f) => f.frame);
  }
  return {
    frames: chosen,
    dropped,
    note: dropped.length
      ? `${dropped.length} further changed frame(s) were NOT observed (${dropped.join(', ')}) — the cap is ${max}. Raise it or name frames explicitly to cover them.`
      : null,
  };
}

// ---------------------------------------------------------------- the policy

const TIERS = Object.freeze([
  { tier: 1, name: 'metadata and dependency analysis', cost: 'free' },
  { tier: 2, name: 'structured numerical diagnostics', cost: 'free' },
  { tier: 3, name: 'targeted suspect frames', cost: 'cheap' },
  { tier: 4, name: 'targeted crops or isolated layers', cost: 'cheap' },
  { tier: 5, name: 'complete pass comparison', cost: 'moderate' },
  { tier: 6, name: 'full sequence review', cost: 'expensive' },
]);

/**
 * Part 43's hierarchical observation policy, applied to one edit.
 *
 * Input is what is already known for free — the diff and (optionally) the scope report. Output is
 * an ordered ladder saying which tiers were satisfied without rendering, which tier the evidence
 * has to reach, and what would force it higher.
 *
 * The escalation triggers are Part 43's own list: camera, VFX, lighting, root motion, broad
 * composition, or unexpected propagation. They are evaluated against real project facts rather
 * than asserted, so a plain joint edit genuinely stops at tier 3.
 */
export function observationPlan(diff, { scope = null, question = null, length = null, maxFrames = 6, available = null } = {}) {
  const have = available || availablePasses();
  const findings = [];
  const notRun = [];

  const nothingChanged = !diff || diff.identical;
  const tracks = diff?.tracks || [];
  const itemsTouched = new Set([
    ...(diff?.items?.added || []),
    ...(diff?.items?.removed || []),
    ...(diff?.items?.changed || []).map((c) => c.itemId),
    ...tracks.map((t) => t.itemId),
  ]);

  // Part 43's escalation list, each answered from data rather than assumed.
  const triggers = [];
  if (tracks.some((t) => t.track === '@fov')) triggers.push({ trigger: 'camera', why: 'a field-of-view track changed, which reframes everything in shot' });
  if (tracks.some((t) => t.track === '@origin')) triggers.push({ trigger: 'root motion', why: 'an @origin track changed, so the whole item moves and no local crop bounds the effect' });
  if (diff?.items?.added?.length || diff?.items?.removed?.length) triggers.push({ trigger: 'broad composition', why: 'an item was added or removed, which changes what is in frame rather than how it moves' });
  if ((diff?.project_fields || []).length) triggers.push({ trigger: 'broad composition', why: `project-level fields changed (${diff.project_fields.join(', ')})` });
  if (scope?.classification === 'broad') triggers.push({ trigger: 'unexpected propagation', why: 'scope analysis classified this edit as broad rather than a local correction' });

  const tiers = [];
  const push = (t, chosen, why, extra = {}) => tiers.push({ ...TIERS[t - 1], chosen, why, ...extra });

  push(1, true, nothingChanged
    ? 'ran first and is sufficient on its own: no semantic object changed, so there is nothing for a render to be evidence about'
    : `ran first and for free: ${itemsTouched.size} item(s) touched, ${tracks.length} track(s) changed`, {
    evidence: [
      evidence('data', diff?.summary || 'no structural difference'),
      evidence('data', `items touched: ${[...itemsTouched].join(', ') || 'none'}`),
    ],
  });

  if (nothingChanged) {
    for (let t = 2; t <= 6; t++) push(t, false, 'skipped: tier 1 already proves the two states are identical, and a render cannot disagree with that');
    findings.push(finding({
      id: 'observe:nothing-to-see',
      certainty: CERTAINTY.CERTAIN,
      statement: 'No observation is warranted — the two states are structurally identical.',
      evidence: [evidence('absence', 'the structural diff reports no item, track, key or project-field change')],
    }));
    return result({ question, tiers, frames: [], passes: [], findings, triggers, notRun: ['every render pass — tier 1 settled the question for free'], escalate: [] });
  }

  push(2, true, `ran for free: the curve difference already names every changed key and the frame range they span (${diff.changed_frame_range ? `${diff.changed_frame_range.start}–${diff.changed_frame_range.end}` : 'no keys moved'})`, {
    evidence: [evidence('measurement', `${tracks.reduce((n, t) => n + ((t.keys_added?.length || 0) + (t.keys_removed?.length || 0) + (t.keys_modified?.length || 0)), 0)} keyframe change(s) across ${tracks.length} track(s)`)],
  });

  const susp = suspectFrames(diff, { length, max: maxFrames });
  const wantRender = susp.frames.length > 0 || triggers.length > 0;
  const passes = choosePasses(diff, triggers, have);

  push(3, wantRender, wantRender
    ? `${susp.frames.length} frame(s) selected from the changed key times and the midpoints between them, rather than a range`
    : 'skipped: nothing changed at a specific frame, so there is no suspect frame to target', {
    frames: susp.frames,
    dropped: susp.dropped,
  });
  if (susp.note) notRun.push(susp.note);

  push(4, false, 'not run: crops and isolation renders are Part 43 capabilities this build does not have yet (OBS-007, OBS-008). The changed region IS computed from the passes at tier 3, so the localisation this tier would add is partly covered; the enlargement is not.');
  notRun.push('targeted crops and isolation renders (Part 43 tier 4) — OBS-007/OBS-008');

  const tier5 = triggers.length > 0;
  push(5, tier5, tier5
    ? `escalated: ${triggers.map((t) => t.trigger).join(', ')} — Part 43 names each of these as a reason to expand beyond a local check`
    : 'not needed: no camera, VFX, lighting, root-motion, composition or propagation trigger fired, so a full pass comparison would cost more without deciding anything');

  push(6, false, 'not run: full-sequence review is for final validation, not for explaining one edit. Nothing here should be read as a shot-level sign-off.');
  notRun.push('full-sequence review (Part 43 tier 6) — this is a scoped check, not a shot sign-off');

  for (const p of Object.values(PASSES)) {
    if (!p.implemented) notRun.push(`the ${p.part43} — ${p.unblocked_by}`);
  }

  findings.push(finding({
    id: 'observe:evidence-level',
    certainty: CERTAINTY.CERTAIN,
    statement: tier5
      ? `This edit needs pass comparison (tier 5): ${triggers.map((t) => t.why).join('; ')}.`
      : `Targeted frames (tier 3) are the cheapest evidence that can settle this edit; ${passes.join(' + ') || 'no render'} on ${susp.frames.length} frame(s).`,
    evidence: [
      evidence('inference', 'chosen by Part 43\'s hierarchical policy, cheapest tier first'),
      ...triggers.map((t) => evidence('data', `escalation trigger: ${t.trigger} — ${t.why}`)),
    ],
  }));

  return result({
    question, tiers, frames: susp.frames, passes, findings, triggers, notRun,
    escalate: [
      'the object-ID pass shows an object moving that the diff does not name — that is unexpected propagation',
      'a silhouette changes at a frame where no key changed',
      'the camera fingerprint differs between the two observations, which makes every pixel comparison meaningless',
    ],
  });
}

function choosePasses(diff, triggers, have) {
  const want = [];
  const tracks = diff?.tracks || [];
  // A rotation or position change moves an outline; that is what a silhouette is for.
  if (tracks.length) want.push('silhouette');
  // Which objects moved, and whether anything moved that the diff did not name. This is the pass
  // that catches propagation, so it is worth its cost whenever more than one thing could move.
  if (tracks.length || diff?.items?.added?.length || diff?.items?.removed?.length) want.push('object_id');
  if (triggers.length) want.push('beauty');
  return want.filter((p) => have.includes(p));
}

function result({ question, tiers, frames, passes, findings, triggers, notRun, escalate }) {
  return {
    question: question || null,
    policy: 'directive Part 43 — hierarchical observation, cheapest evidence first',
    tiers,
    recommended: {
      passes,
      frames: frames.map((f) => f.frame),
      frames_with_reasons: frames,
      resolution_hint: 192,
      why: passes.length
        ? 'the smallest set of renders that can prove or disprove the change the free tiers already located'
        : 'no render is warranted',
    },
    escalate_if: escalate,
    escalation_triggers_fired: triggers,
    findings,
    coverage: coverage({
      scope: 'which observations are worth making for one edit — this plans evidence, it does not gather it',
      frames: frames.map((f) => f.frame),
      loop: 'fast',
      notRun,
    }),
  };
}

export function observeLimitations() {
  return {
    cannot: [
      '5 of Part 43\'s 24 observation kinds exist (beauty, silhouette, object-ID, object bounding boxes, changed-region mask); the other 19 are enumerated in PASSES with what blocks each',
      'observe anything but rig parts — props, effect items, screen effects, the ground and the grid are excluded from every pass by construction',
      'render a range of consecutive frames: the policy targets suspect frames, so flicker and one-frame pops between them are not looked for',
      'decide anything on its own — this module chooses observations and nothing here executes one',
    ],
    assumptions: [
      'the cheapest tier that can answer is the right tier. An edit whose visual effect is genuinely invisible in the curve data would be under-observed, and Part 43\'s escalation triggers are the mitigation, not a proof',
      'a midpoint frame between two changed keys is where an easing change shows. That is a heuristic about where to look, not a measurement',
    ],
  };
}
