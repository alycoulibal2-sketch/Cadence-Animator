// VFXSpec: a declarative effect, compiled into reversible operations (directive Parts 37 and 39,
// plus Part 38's effect hierarchy).
//
// ---------------------------------------------------------------------------------------------
// THE BOUNDARY DECISION, which shapes everything else in this file
// ---------------------------------------------------------------------------------------------
//
// Cadence already has a large procedural VFX engine: `renderer/js/pnx/**`, 390+ node types, its
// own studio window, its own Luau exporter, its own test suite. So the question this phase had to
// answer FIRST was not "how do we make effects" but "what does a semantic layer add to an engine
// that already exists" — and, concretely, which of the app's three VFX systems a VFXSpec targets.
//
// It targets the `kind: 'vfx'` emitter item, and NOT the PNX graph. Three reasons, in order:
//
//   1. **Reversibility.** A VFXSpec has to compile to `ai/patch.js` operations, because that is
//      what makes it reviewable before it lands and undoable after. A `kind: 'vfx'` item is
//      exactly the effect representation Cadence patches field-by-field — plain numbers on an
//      item, plus `@rate`/`@lifetime`/`@speed` keyframe tracks. A PNX document is refused by
//      `set_item_field` for a stated reason ("an effect document is a whole PNX graph with its own
//      undo and its own validators"), and routing a spec through it would mean a second undo stack
//      that the transaction ledger cannot see.
//
//   2. **Purity.** `ai/**` is pure at load and `test/aitest.mjs` enforces it by importing every
//      module in plain Node. `pnx/**` is not importable that way. `renderer/js/vfx.js` and
//      `renderer/js/particleLibrary.js` ARE — they were written as a deterministic, scrubbable
//      sampler with no renderer and no `state.js` import, precisely so the standalone studio could
//      reuse them. So the emitter path crosses the boundary and the graph path does not.
//
//   3. **Determinism.** `vfx.js` answers "what does frame F look like" as a pure function of the
//      item's tracks and a per-particle hash. A spec compiled onto it inherits that, which is what
//      VFX-005 asks for.
//
// This is the same move Phase 3 made with CAL: drive the machinery that exists rather than
// reimplement it. What this file therefore does NOT do is named in `VFXSPEC_LIMITATIONS` — most
// importantly, it cannot author a multi-layer PNX effect, and does not pretend to.
//
// ---------------------------------------------------------------------------------------------
//
// Two further decisions worth not relitigating:
//
// * **The primitive vocabulary is `particleLibrary.js`, not a new list.** That file already
//   defines 22 real material archetypes (fire, smoke, blood, debris, confetti…) multiplied by 6
//   colour themes and 3 scales, and both the Inspector and the VFX Studio already resolve presets
//   through it. Part 37.2 asks for parameterised, composable primitives; inventing a parallel set
//   here would give the semantic layer a vocabulary the rest of the app does not share.
//
// * **A new item may declare its attachment; an existing one may not.** `set_item_field` refuses
//   `attachedTo` because re-parenting an item that already has a world position has to re-derive
//   the offset to keep it visually still, and this layer has no solved poses. A newly created item
//   has no prior position to preserve, so its offset IS the spec's declared offset and there is
//   nothing to derive. That is why `add_item` carries `attachedTo` and `set_item_field` still
//   refuses it — the asymmetry is real, not an oversight.
//
// Pure at load like the rest of `ai/`.

import * as ids from './ids.js';
import { contentHash, shortHash } from './hash.js';
import { CERTAINTY, evidence, finding } from './certainty.js';
import * as events from './events.js';
import { VFX_DEFAULTS } from '../vfx.js';
import { findPreset, presetId, MATERIAL_KEYS, THEME_KEYS, SCALE_KEYS, SHAPES, MOTIONS } from '../particleLibrary.js';

/** The spec vocabulary, taken from `particleLibrary.js`'s own axes rather than restated here, so
 *  adding a material extends the spec language for free. Sorted for a stable, readable refusal
 *  message; the library's own order is presentational. */
export const PRIMITIVES = Object.freeze([...MATERIAL_KEYS].sort());
export const THEMES = Object.freeze([...THEME_KEYS].sort());
export const SCALES = Object.freeze([...SCALE_KEYS]);

/**
 * Part 38's effect hierarchy (VFX-011).
 *
 * The hierarchy is a STATEMENT OF INTENT, not a measurement: it says which effect is meant to
 * carry the read and which are texture around it. It is used for two concrete things — the share
 * of the particle budget an effect may take, and the order a reviewer should look at them in.
 * Nothing here measures whether the primary effect actually reads as primary; that needs the
 * observation passes (VFX-009, still unplanned).
 */
export const EFFECT_ROLES = Object.freeze({
  primary: { budget_share: 1.0, summary: 'carries the read — the thing the viewer is meant to see' },
  supporting: { budget_share: 0.5, summary: 'reinforces the primary without competing with it' },
  residual: { budget_share: 0.25, summary: 'what is left behind afterwards — smoke, dust, embers' },
});

/**
 * The Part 37.1 VFXSpec fields, and what Cadence can actually hold for each.
 *
 * Part 4.7: a missing capability is named, not hidden.
 */
export const VFXSPEC_FIELDS = Object.freeze({
  name: { required: false, note: 'display name; defaults to the primitive' },
  primitive: { required: true, note: `one of ${PRIMITIVES.length} material archetypes` },
  theme: { required: false, note: 'colour theme; "classic" keeps the material\'s own colours' },
  scale: { required: false, note: 'small | standard | large — scales size, rate and pool cap together' },
  role: { required: false, note: 'primary | supporting | residual (Part 38 hierarchy)' },
  anchor: { required: false, note: '{ itemId, partId } — the part the effect rides on' },
  offset: { required: false, note: '[x,y,z] studs, in the anchor part\'s own space' },
  timing: { required: false, note: 'Part 39: event, lead, attack, sustain, decay, peak, loop' },
  budget: { required: false, note: '{ maxParticles } — capped by the role\'s share' },
  intent: { required: false, note: 'the request this spec came from, carried through for provenance' },
  colorStart: { required: false, note: 'overrides the theme' },
  colorEnd: { required: false, note: 'overrides the theme' },
  absent: Object.freeze({
    layers: 'a VFXSpec compiles to ONE emitter. A multi-layer effect is a PNX document, which this file deliberately does not author — see the boundary decision above',
    meshes_and_beams: 'the emitter item renders sprites only; beams, trails and mesh effects exist in PNX and have no emitter-item equivalent',
    light: 'nothing in a Cadence project holds a light, so an effect cannot declare one',
    sound: 'project.audio is a single timeline track, not a per-effect cue',
    collision: 'particles have no collision model in vfx.js — the closed-form trajectory never bends',
  }),
});

export const VFXSPEC_LIMITATIONS = Object.freeze([
  'A spec compiles to one `kind: "vfx"` emitter item. Multi-layer PNX effects are out of scope by the boundary decision at the top of this file.',
  'The rate envelope is written to the `@rate` track. `@lifetime` and `@speed` stay static, because a per-particle constant that changes retroactively is exactly what vfx.js is built not to do.',
  'Attachment rides the anchor part every frame, but nothing here verifies the anchor part exists in the rig at compile time beyond a name lookup — a renamed part silently falls back to the item origin at render time (that fallback is viewport.js:494, not this layer).',
  'The compiled emitter is not rendered or measured here. Whether the effect READS as an impact needs the observation passes (VFX-009).',
  'Timing is validated against the shot-event timeline, which is derived from per-item markers — so an effect can only be timed to an event that some item owns (see ai/events.js).',
]);

// ---------------------------------------------------------------- the timing model (Part 39)

/**
 * Part 39's timing fields, resolved to concrete frames.
 *
 * `lead` is the one that matters and the one most easily got backwards, so it is defined here
 * once: **lead is how far BEFORE the event the effect PEAKS.** A positive lead means the effect
 * anticipates the event; a negative lead means it trails it. Everything else is measured from
 * that peak.
 *
 *     start = peak - attack        emission begins, rate 0
 *     peak  = event - lead        rate reaches its maximum
 *     hold  = peak + sustain      rate still at maximum
 *     end   = hold + decay        rate back to 0
 *
 * Defaults describe an impact, because that is Part 62's success condition for this phase: no
 * lead, a one-frame attack, no sustain, and a short decay.
 */
export const TIMING_DEFAULTS = Object.freeze({
  lead: 0, attack: 1, sustain: 0, decay: 6, peak: 1, loop: false,
});

export function resolveTiming(project, spec, { timeline = null } = {}) {
  const t = { ...TIMING_DEFAULTS, ...(spec?.timing || {}) };
  const fps = Number.isFinite(project?.fps) && project.fps > 0 ? project.fps : 30;
  const findings = [];

  const ref = t.event ?? t.frame ?? 0;
  const res = events.resolveEvent(project, ref, { timeline, itemId: t.eventItemId ?? null });
  if (res.frame === null) {
    return {
      resolved: false, event: res, findings, fps,
      question: res.question,
    };
  }

  for (const k of ['lead', 'attack', 'sustain', 'decay']) {
    if (!Number.isFinite(t[k])) { t[k] = TIMING_DEFAULTS[k]; }
  }
  // A zero-length attack would put two keys on one frame; the sampler would read whichever came
  // last and the envelope would have no ramp at all. Clamp and say so rather than emit a
  // degenerate track.
  let attackClamped = false;
  if (t.attack <= 0) { t.attack = 1; attackClamped = true; }
  let decayClamped = false;
  if (t.decay <= 0) { t.decay = 1; decayClamped = true; }

  const peakFrame = res.frame - t.lead;
  const startFrame = peakFrame - t.attack;
  const holdFrame = peakFrame + Math.max(0, t.sustain);
  const endFrame = holdFrame + t.decay;

  if (attackClamped) {
    findings.push(finding({
      id: 'VFX-ATTACK-CLAMPED',
      certainty: CERTAINTY.CERTAIN,
      statement: 'an attack of 0 frames would put the envelope\'s start and peak keys on the same frame, leaving no ramp — it was clamped to 1 frame',
      evidence: [evidence('convention', 'two keys on one frame are not a ramp')],
      frame: peakFrame,
    }));
  }
  if (decayClamped) {
    findings.push(finding({
      id: 'VFX-DECAY-CLAMPED',
      certainty: CERTAINTY.CERTAIN,
      statement: 'a decay of 0 frames would leave the emitter running at peak rate with no key to bring it down — it was clamped to 1 frame',
      evidence: [evidence('convention', 'an envelope with no decay never returns to zero')],
      frame: endFrame,
    }));
  }
  if (startFrame < 0) {
    findings.push(finding({
      id: 'VFX-STARTS-BEFORE-ZERO',
      certainty: CERTAINTY.CERTAIN,
      statement: `the envelope would start at frame ${round3(startFrame)}, before the timeline begins — the effect will already be mid-emission on frame 0`,
      evidence: [evidence('measurement', 'start frame is negative', { start: startFrame, lead: t.lead, attack: t.attack })],
      frame: 0,
      suggestion: { text: 'reduce lead or attack, or move the event later', reversible: true },
    }));
  }
  const length = Number.isFinite(project?.length) ? project.length : null;
  if (length !== null && endFrame > length) {
    findings.push(finding({
      id: 'VFX-OUTLIVES-TIMELINE',
      certainty: CERTAINTY.CERTAIN,
      statement: `the envelope ends at frame ${round3(endFrame)} but the timeline is ${length} frames long, so the tail is cut off`,
      evidence: [evidence('measurement', 'end frame is past the timeline length', { end: endFrame, length })],
      frame: length,
      suggestion: { text: 'shorten decay or lengthen the timeline', reversible: true },
    }));
  }

  return {
    resolved: true,
    fps,
    event: res,
    event_frame: res.frame,
    lead: t.lead, attack: t.attack, sustain: Math.max(0, t.sustain), decay: t.decay, peak: t.peak, loop: !!t.loop,
    start_frame: startFrame,
    peak_frame: peakFrame,
    hold_frame: holdFrame,
    end_frame: endFrame,
    duration_frames: endFrame - startFrame,
    duration_seconds: (endFrame - startFrame) / fps,
    findings,
  };
}

// ---------------------------------------------------------------- validation

/**
 * Check a spec before compiling it.
 *
 * Returns `{ ok, findings, spec }`. `ok` false means `compileSpec` will refuse; a true with
 * findings means it will compile but a reviewer should read them.
 */
export function validateSpec(project, spec, { timeline = null } = {}) {
  const findings = [];
  const fail = (id, statement, ev = [], suggestion = null) => {
    findings.push(finding({ id, certainty: CERTAINTY.CERTAIN, statement, evidence: ev, suggestion }));
  };

  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    fail('VFX-SPEC-NOT-AN-OBJECT', 'a VFXSpec must be an object');
    return { ok: false, findings };
  }
  if (typeof spec.primitive !== 'string' || !spec.primitive) {
    fail('VFX-PRIMITIVE-MISSING', `a VFXSpec needs a primitive (one of: ${PRIMITIVES.join(', ')})`);
  } else if (!PRIMITIVES.includes(spec.primitive)) {
    fail('VFX-PRIMITIVE-UNKNOWN', `"${spec.primitive}" is not a known effect primitive`,
      [evidence('data', 'the primitive vocabulary comes from particleLibrary.js', { known: PRIMITIVES.length })],
      { text: `did you mean ${nearest(spec.primitive, PRIMITIVES) || PRIMITIVES[0]}?`, reversible: true });
  }
  const theme = spec.theme ?? 'classic';
  if (!THEMES.includes(theme)) {
    fail('VFX-THEME-UNKNOWN', `"${theme}" is not a known colour theme (one of: ${THEMES.join(', ')})`);
  }
  const scale = spec.scale ?? 'standard';
  if (!SCALES.includes(scale)) {
    fail('VFX-SCALE-UNKNOWN', `"${scale}" is not a known scale (one of: ${SCALES.join(', ')})`);
  }
  const role = spec.role ?? 'primary';
  if (!EFFECT_ROLES[role]) {
    fail('VFX-ROLE-UNKNOWN', `"${role}" is not a Part 38 effect role (one of: ${Object.keys(EFFECT_ROLES).join(', ')})`);
  }

  if (spec.anchor !== undefined && spec.anchor !== null) {
    const a = spec.anchor;
    if (typeof a !== 'object' || typeof a.itemId !== 'string') {
      fail('VFX-ANCHOR-MALFORMED', 'an anchor must be { itemId, partId? }');
    } else {
      const host = (project?.items || []).find((i) => i.id === a.itemId);
      if (!host) {
        fail('VFX-ANCHOR-MISSING', `no item with id "${a.itemId}" to anchor to`);
      } else if (a.partId) {
        const parts = host.rig?.parts || [];
        const part = parts.find((p) => p.id === a.partId || p.name === a.partId);
        if (!part) {
          fail('VFX-ANCHOR-PART-MISSING', `"${host.name}" has no part "${a.partId}"`,
            [evidence('absence', 'the part was not found on the anchor item', { parts: parts.length })],
            { text: parts.length ? `parts on this item include: ${parts.slice(0, 8).map((p) => p.name).join(', ')}` : 'this item has no rig, so it has no parts to anchor to', reversible: true });
        }
      }
    }
  }

  if (spec.offset !== undefined && spec.offset !== null) {
    if (!Array.isArray(spec.offset) || spec.offset.length !== 3 || !spec.offset.every(Number.isFinite)) {
      fail('VFX-OFFSET-MALFORMED', 'an offset must be [x, y, z] of finite numbers, in studs');
    }
  }

  const timing = resolveTiming(project, spec, { timeline });
  if (!timing.resolved) {
    fail('VFX-EVENT-UNRESOLVED', timing.question || 'the timing event could not be resolved',
      [evidence('absence', 'no event resolved from the spec timing')],
      { text: 'add_marker creates a shot event, or pass timing.frame for an explicit frame', reversible: true });
  } else {
    findings.push(...timing.findings);
  }

  const ok = !findings.some((f) => HARD_FAILURES.has(f.id));
  return { ok, findings, timing, resolved: { theme, scale, role } };
}

/** Findings that stop a compile, as opposed to ones a reviewer should merely read. */
const HARD_FAILURES = new Set([
  'VFX-SPEC-NOT-AN-OBJECT', 'VFX-PRIMITIVE-MISSING', 'VFX-PRIMITIVE-UNKNOWN',
  'VFX-THEME-UNKNOWN', 'VFX-SCALE-UNKNOWN', 'VFX-ROLE-UNKNOWN',
  'VFX-ANCHOR-MALFORMED', 'VFX-ANCHOR-MISSING', 'VFX-ANCHOR-PART-MISSING',
  'VFX-OFFSET-MALFORMED', 'VFX-EVENT-UNRESOLVED',
]);

// ---------------------------------------------------------------- compilation

/**
 * Compile a VFXSpec into patch operations.
 *
 * Returns `{ ok, ops, item, timing, spec_hash, findings, summary }`. The caller plans and commits
 * the ops through `ai/patch.js`, so the effect is reviewable before it lands and undoable after —
 * `add_item`'s inverse is a `remove_item` that takes the whole thing back out.
 *
 * The item id is DERIVED from the spec content (`vfx-<hash>`), for two reasons: `commitPatch`
 * verifies the applied result against the hash the plan predicted, so a randomly minted id would
 * make every commit fail its own post-condition; and compiling the same spec twice then refuses as
 * a duplicate instead of silently stacking two identical emitters on one anchor.
 */
export function compileSpec(project, spec, { timeline = null, itemId = null } = {}) {
  const tl = timeline || events.buildTimeline(project);
  const check = validateSpec(project, spec, { timeline: tl });
  if (!check.ok) {
    return { ok: false, ops: [], item: null, timing: check.timing ?? null, findings: check.findings, summary: `refused: ${check.findings.filter((f) => HARD_FAILURES.has(f.id)).map((f) => f.statement).join('; ')}` };
  }

  const { theme, scale, role } = check.resolved;
  const timing = check.timing;
  const findings = [...check.findings];

  const pid = presetId(spec.primitive, theme, scale);
  const preset = findPreset(pid);
  if (!preset) {
    // Unreachable through validateSpec, which checks all three parts against the same table. Kept
    // as a real error rather than a fallback, because a silent default here would produce an
    // effect that is not the one asked for.
    throw new Error(`compileSpec: no preset "${pid}" — the primitive/theme/scale vocabulary and the preset table have diverged`);
  }

  const budgetShare = EFFECT_ROLES[role].budget_share;
  const askedCap = Number.isFinite(spec.budget?.maxParticles) ? spec.budget.maxParticles : preset.emitter.maxParticles;
  const cap = Math.max(1, Math.round(askedCap * budgetShare));
  if (cap !== askedCap) {
    findings.push(finding({
      id: 'VFX-BUDGET-SHARED',
      certainty: CERTAINTY.CERTAIN,
      statement: `role "${role}" takes ${Math.round(budgetShare * 100)}% of the particle budget, so the cap is ${cap} rather than ${askedCap}`,
      evidence: [evidence('convention', 'Part 38\'s effect hierarchy governs the budget share', { role, share: budgetShare })],
    }));
  }

  const emitter = {
    ...VFX_DEFAULTS,
    ...preset.emitter,
    maxParticles: cap,
    ...(spec.colorStart ? { colorStart: spec.colorStart } : {}),
    ...(spec.colorEnd ? { colorEnd: spec.colorEnd } : {}),
  };
  const baseRate = emitter.rate;

  const offset = spec.offset && spec.offset.length === 3 ? spec.offset : [0, 0, 0];
  const originCF = [offset[0], offset[1], offset[2], 1, 0, 0, 0, 1, 0, 0, 0, 1];

  const specHash = shortHash(contentHash(canonicalSpec(spec)));
  const newId = itemId || `vfx-${specHash}`;

  const item = {
    id: newId,
    kind: 'vfx',
    name: spec.name || `${preset.name}${spec.role && spec.role !== 'primary' ? ` (${spec.role})` : ''}`,
    origin: originCF,
    emitter,
    visible: true,
  };
  // A newly created item may declare its attachment — see the second decision in this file's
  // header for why that is not the same as re-parenting an existing one.
  if (spec.anchor?.itemId) {
    item.attachedTo = { itemId: spec.anchor.itemId, partId: spec.anchor.partId ?? null, offset: originCF };
    // The offset lives in the attachment; the static origin is then only the fallback the viewport
    // uses if the anchor part cannot be found, so it stays the same transform rather than identity.
  }

  const ops = [{ op: 'add_item', item }];

  // The rate envelope (Part 39). Four keys, on the one track vfx.js reads per frame rather than
  // per particle — `@lifetime` and `@speed` are resolved AT SPAWN and stay static deliberately.
  const peakRate = baseRate * (Number.isFinite(timing.peak) ? timing.peak : 1);
  const env = [
    { t: timing.start_frame, v: 0, es: 'Sine', ed: 'Out' },
    { t: timing.peak_frame, v: peakRate, es: 'Sine', ed: 'Out' },
    ...(timing.sustain > 0 ? [{ t: timing.hold_frame, v: peakRate, es: 'Linear', ed: 'InOut' }] : []),
    { t: timing.end_frame, v: 0, es: 'Quad', ed: 'Out' },
  ];
  for (const k of env) {
    ops.push({ op: 'set_key', itemId: newId, track: '@rate', t: round3(k.t), value: k.v, es: k.es, ed: k.ed });
  }

  if (timing.loop) {
    // `effectLoop` is an `kind: 'effect'` field; a vfx emitter loops by having its envelope repeat,
    // which is a retime operation and not a field. Say so rather than write a field that the
    // emitter path ignores.
    findings.push(finding({
      id: 'VFX-LOOP-NOT-A-FIELD',
      certainty: CERTAINTY.CERTAIN,
      statement: 'timing.loop was asked for, but a vfx emitter has no loop field — item.effectLoop belongs to a PNX effect graph, not to an emitter, so the envelope was written once',
      evidence: [evidence('data', 'effectLoop is not read on the emitter path', { kind: 'vfx' })],
      suggestion: { text: 'repeat_frames over the envelope range, or hold the rate at peak with a longer sustain', reversible: true },
    }));
  }

  return {
    ok: true,
    ops,
    item,
    timing,
    spec_hash: specHash,
    preset: { id: pid, name: preset.name, category: preset.category },
    role,
    budget: { asked: askedCap, granted: cap, share: budgetShare },
    envelope: env.map((k) => ({ frame: round3(k.t), rate: k.v })),
    entity: ids.itemId(item),
    findings,
    limitations: VFXSPEC_LIMITATIONS,
    summary: `${preset.name} anchored to ${spec.anchor?.partId || spec.anchor?.itemId || 'the world'}, peaking at frame ${round3(timing.peak_frame)} (event ${round3(timing.event_frame)}${timing.lead ? `, lead ${timing.lead}` : ''}), ${round3(timing.duration_frames)} frames long, cap ${cap}`,
  };
}

/**
 * Check a compiled effect's timing against the shot (VFX-010).
 *
 * Separate from `resolveTiming`, which computes the envelope. This judges it: whether the peak
 * actually lands on the event, whether the effect starts before the thing it is reacting to, and
 * whether two effects on the same anchor are fighting for the same moment. Part 4.5 — measurement
 * is `resolveTiming`, judgement is here.
 */
export function validateTiming(project, { timeline = null } = {}) {
  const tl = timeline || events.buildTimeline(project);
  const findings = [];
  const emitters = (project?.items || []).filter((i) => i.kind === 'vfx');

  for (const item of emitters) {
    const keys = project?.tracks?.[item.id]?.['@rate']?.keys || [];
    if (!keys.length) {
      findings.push(finding({
        id: 'VFX-NO-ENVELOPE',
        certainty: CERTAINTY.CERTAIN,
        statement: `"${item.name}" emits at a constant ${item.emitter?.rate ?? VFX_DEFAULTS.rate ?? 8}/s for the whole timeline — it has no rate envelope, so it is not timed to anything`,
        evidence: [evidence('absence', 'the @rate track has no keys', { itemId: item.id })],
        target: ids.itemId(item),
        suggestion: { text: 'compile a VFXSpec with a timing.event, or key @rate by hand', reversible: true },
      }));
      continue;
    }
    // A keyframe holds its value in `k.v` — `value` is the name of the PATCH OP field, not of the
    // stored one (state.js `setKey`). Reading `k.value` here silently measured undefined.
    const sorted = [...keys].sort((a, b) => a.t - b.t);
    const rateOf = (k) => (Number.isFinite(k?.v) ? k.v : null);
    const withRate = sorted.filter((k) => rateOf(k) !== null);
    const first = sorted[0], last = sorted.at(-1);
    if (!withRate.length) {
      findings.push(finding({
        id: 'VFX-ENVELOPE-VALUELESS',
        certainty: CERTAINTY.CERTAIN,
        statement: `"${item.name}" has ${sorted.length} @rate key(s) but none of them carries a number, so the envelope evaluates to the emitter's static rate`,
        evidence: [evidence('data', 'no @rate key holds a finite value', { keys: sorted.length })],
        target: ids.itemId(item),
      }));
      continue;
    }
    const peak = withRate.reduce((m, k) => (rateOf(k) > rateOf(m) ? k : m), withRate[0]);

    // Does the peak coincide with an event? A peak with no event near it is not wrong — the effect
    // may be ambient — so this is reported only when an event IS close, as the fact that it is.
    const nearby = tl.events
      .map((e) => ({ e, d: Math.abs(e.frame - peak.t) }))
      .filter((x) => x.d <= 4)
      .sort((a, b) => a.d - b.d);
    if (nearby.length) {
      const { e, d } = nearby[0];
      findings.push(finding({
        id: d < 1e-6 ? 'VFX-PEAK-ON-EVENT' : 'VFX-PEAK-OFF-EVENT',
        certainty: CERTAINTY.CERTAIN,
        statement: d < 1e-6
          ? `"${item.name}" peaks exactly on event "${e.name || e.frame}" at frame ${e.frame}`
          : `"${item.name}" peaks at frame ${round3(peak.t)}, ${round3(d)} frame(s) ${peak.t < e.frame ? 'before' : 'after'} event "${e.name || e.frame}" at ${e.frame}`,
        evidence: [evidence('measurement', 'distance from the rate peak to the nearest event', { peak: peak.t, event: e.frame, delta: peak.t - e.frame })],
        target: ids.itemId(item),
        frame: peak.t,
      }));
    }

    if (rateOf(last) > 0) {
      findings.push(finding({
        id: 'VFX-ENVELOPE-UNCLOSED',
        certainty: CERTAINTY.CERTAIN,
        statement: `"${item.name}" has its last @rate key at frame ${last.t} with a rate of ${rateOf(last)}, so it keeps emitting at that rate for the rest of the timeline`,
        evidence: [evidence('data', 'the final rate key is non-zero', { t: last.t, rate: rateOf(last) })],
        target: ids.itemId(item),
        frame: last.t,
        suggestion: { text: 'add a rate 0 key after the tail', reversible: true },
      }));
    }
    if (rateOf(first) > 0) {
      findings.push(finding({
        id: 'VFX-ENVELOPE-STARTS-HOT',
        certainty: CERTAINTY.CERTAIN,
        statement: `"${item.name}" starts at rate ${rateOf(first)} on its first key (frame ${first.t}) — the emitter is already running when the timeline reaches it`,
        evidence: [evidence('data', 'the first rate key is non-zero', { t: first.t, rate: rateOf(first) })],
        target: ids.itemId(item),
        frame: first.t,
      }));
    }
  }

  // Two emitters on the same anchor part peaking on the same frame is the Part 38 hierarchy
  // question: reported as co-timing, not as an error, because a primary plus its residual is
  // exactly the intended shape.
  const byAnchor = new Map();
  for (const item of emitters) {
    const k = `${item.attachedTo?.itemId || '-'}/${item.attachedTo?.partId || '-'}`;
    if (!byAnchor.has(k)) byAnchor.set(k, []);
    byAnchor.get(k).push(item);
  }
  const stacked = [];
  for (const [anchor, list] of byAnchor) {
    if (anchor === '-/-' || list.length < 2) continue;
    stacked.push({ anchor, items: list.map((i) => ({ itemId: i.id, name: i.name })), count: list.length });
  }

  return {
    emitters: emitters.length,
    events: tl.count,
    findings,
    stacked_anchors: stacked,
    concurrent_events: events.concurrentEvents(tl),
    limitations: VFXSPEC_LIMITATIONS,
  };
}

// ---------------------------------------------------------------- helpers

/** The fields that define what a spec MEANS, in a fixed order, so the derived id is stable across
 *  key insertion order and ignores presentational extras like `intent`. */
function canonicalSpec(spec) {
  return {
    primitive: spec.primitive ?? null,
    theme: spec.theme ?? 'classic',
    scale: spec.scale ?? 'standard',
    role: spec.role ?? 'primary',
    anchor: spec.anchor ? { itemId: spec.anchor.itemId, partId: spec.anchor.partId ?? null } : null,
    offset: spec.offset ?? null,
    timing: { ...TIMING_DEFAULTS, ...(spec.timing || {}) },
    budget: spec.budget ?? null,
    colorStart: spec.colorStart ?? null,
    colorEnd: spec.colorEnd ?? null,
    name: spec.name ?? null,
  };
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/** Cheapest useful "did you mean" — shared prefix length. Enough to turn "explosion" into
 *  "explosion-debris" without pulling in an edit-distance implementation. */
function nearest(needle, list) {
  const n = String(needle).toLowerCase();
  let best = null, bestScore = 0;
  for (const c of list) {
    let i = 0;
    while (i < n.length && i < c.length && n[i] === c[i]) i++;
    if (i > bestScore) { bestScore = i; best = c; }
  }
  return bestScore >= 3 ? best : null;
}

/** Re-exported so a caller can see the emitter vocabulary a spec compiles into without importing
 *  the renderer-side library itself. */
export const EMITTER_VOCABULARY = Object.freeze({ shapes: SHAPES, motions: MOTIONS });
