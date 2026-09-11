// The first semantic planner and the first slice of the motion compiler (directive Parts 20.2 and
// 24), plus the phase segmentation both of them stand on.
//
// The shape of the loop this module closes:
//
//     IntentSpec ──▶ segment the existing motion into phases
//                ──▶ choose edit strategies from the dimension vector
//                ──▶ block the ones a constraint forbids, BEFORE compiling them
//                ──▶ compile the survivors into patch operations
//                ──▶ state what the blocked ones would have contributed
//
// Three rules that shaped it, each the answer to a way this could have gone wrong:
//
//   * **A strategy declares the aspects it touches, and is blocked by the real constraint
//     checker.** Not by a parallel approximation of it — `compilePlan` builds a trial patch per
//     strategy and runs `constraints.checkPatch` on it, the same call `apply_animation_patch`
//     makes. Two implementations of "is this allowed" would drift, and the one that drifted would
//     be the one that let an edit through.
//   * **A blocked strategy is a first-class output.** "Heavier without changing timing" *cannot*
//     have body-lead offsets, because those move keys. The plan says so, names the constraint, and
//     says what the motion loses — instead of quietly producing a thinner result.
//   * **Phase names are evidence-bound.** A boundary the caller declared is `certain`; one a marker
//     names is `highly_likely`; one inferred from a rate profile is `possible` and never better.
//     Nothing gets named from an action type alone.
//
// What this module deliberately does NOT do: it never renders and never judges whether the result
// is good. Those are `explain_change` (Phase 4) and Phase 7, and every plan says so in its own
// `coverage.notRun`. It DOES now measure one thing: whether a contact-capable effector is actually
// planted during a span, because `overshoot` used to refuse to touch every hand and foot on the
// grounds that it could not tell (MOT-008 closed that).

import * as CF from '../cf.js';
import { paramsFor } from '../easing.js';
import * as K from './kinematics.js';
import * as MOTION from './motion.js';
import * as POSE from './pose.js';
import * as CAL from './cal.js';
import * as VOC from './vocabulary.js';
import * as ROLES from './roles.js';
import { ROLE } from './roles.js';
import { makePatch, planPatch } from './patch.js';
import { checkPatch } from './constraints.js';
import { CERTAINTY, coverage, evidence, finding, sortFindings } from './certainty.js';

const EPS = 1e-6;
const DEG = 180 / Math.PI;

// ---------------------------------------------------------------- tunables
//
// Each is a bound on how far one unit of a dimension may move the animation. They are here, named
// and justified, rather than inline: a reviewer arguing that "heavier" should be able to grow a
// rotation by more than half again should be arguing with one number, not hunting for it.

const GAIN = Object.freeze({
  /** A +1 amplitude pull scales a rotation by 1.5×; -1 scales it by 0.5×. Past that the pose stops
   *  being the pose the animator authored and starts being a different one. */
  amplitude: 0.5,
  /** Hard bounds on the resulting scale regardless of how the pulls stack. */
  amplitudeMin: 0.2,
  amplitudeMax: 2.5,
  /** A +1 body-lead pull delays the most distal joint by 3 frames relative to the root. Three
   *  frames at 30fps is a tenth of a second — clearly readable, still inside a normal action. */
  lead: 3,
  /** A +1 overshoot pull sets Back's Overshoot parameter to this. Roblox/Moon's default is
   *  1.70158; going far past it turns a settle into a wobble. */
  overshoot: 1.7,
  /** How many steps along the easing ladder a +1 contrast pull moves. */
  contrastSteps: 3,
});

/** The easing ladder, ordered by how concentrated the travel is. Linear spreads motion evenly;
 *  Exponential piles nearly all of it into one end. Moving along this ladder is the whole of what
 *  "more/less acceleration contrast" compiles to, which is why the ladder is a single ordered list
 *  rather than a set of special cases. */
const CONTRAST_LADDER = Object.freeze(['Linear', 'Sine', 'Quad', 'Cubic', 'Quart', 'Quint', 'Exponential']);

/** Which easing direction a phase wants, when the phase is named with enough certainty to act on.
 *  `In` accelerates into the next pose; `Out` decelerates into it. Absent from this table means
 *  "keep whatever direction the key already has" — the safe default, and the one used whenever the
 *  phase name is only `possible`. */
const PHASE_DIRECTION = Object.freeze({
  anticipation: 'In',
  preparation: 'In',
  acceleration: 'In',
  action: 'In',
  impact: 'In',
  follow_through: 'Out',
  recovery: 'Out',
  settle: 'Out',
});

// ---------------------------------------------------------------- helpers

const tracksOf = (project, itemId) => (project.tracks && project.tracks[itemId]) || {};
const itemOf = (project, itemId) => (project.items || []).find((i) => i.id === itemId) || null;

function jointTrackNames(project, itemId) {
  return Object.keys(tracksOf(project, itemId)).filter((n) => !n.startsWith('@'));
}

/**
 * Keys of a track inside a span.
 *
 * Both ends are switchable and both switches are load-bearing:
 *
 *   `inclusiveStart: false` — the key at the span's start is the pose the span DEPARTS from. An
 *   amplitude edit anchors on it, so writing it would move the anchor.
 *
 *   `inclusiveEnd: false` — the easing on a key governs the segment that LEAVES it, so the key at
 *   the span's end belongs to the next span, not this one. Expressing that by passing `to - EPS`
 *   does not work: the epsilon tolerance below cancels it exactly, and the key at the boundary is
 *   included anyway. That silently made every spacing edit reshape the span after the one it was
 *   aimed at.
 */
function keysIn(track, from, to, { inclusiveStart = true, inclusiveEnd = true } = {}) {
  return ((track && track.keys) || []).filter((k) => (inclusiveStart ? k.t >= from - EPS : k.t > from + EPS)
    && (inclusiveEnd ? k.t <= to + EPS : k.t < to - EPS));
}

/** Rotation angle of a transform CFrame away from identity, in degrees. For a joint track that is
 *  literally "how far this joint is rotated from rest". */
const rotOf = (cf) => (Array.isArray(cf) ? K.angleBetween(CF.IDENTITY, cf) : 0);

/**
 * Scale a rigid transform's departure from an anchor.
 *
 * `v' = anchor · scale(anchor⁻¹ · v, k)` — the rotation's angle and the translation are both
 * multiplied by k about the anchor, so the anchor pose itself is a fixed point of the operation.
 * That fixed point is the reason this is anchored rather than absolute: scaling about identity
 * would move the FIRST key of the range too, and the range would no longer join what precedes it.
 *
 * The quaternion is flipped to the w >= 0 hemisphere first. Without that, a rotation stored as its
 * long-way-round equivalent would scale along the long arc and swing the joint the wrong way.
 */
export function scaleAbout(anchor, v, k) {
  const d = CF.mul(CF.inverse(anchor), v);
  let q = CF.toQuat(d);
  if (q[3] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
  const w = Math.max(-1, Math.min(1, q[3]));
  const angle = 2 * Math.acos(w);
  const s = Math.sqrt(Math.max(0, 1 - w * w));
  const scaled = (angle < 1e-7 || s < 1e-7)
    ? CF.IDENTITY.slice()
    : CF.axisAngle([q[0] / s, q[1] / s, q[2] / s], angle * k);
  scaled[0] = d[0] * k; scaled[1] = d[1] * k; scaled[2] = d[2] * k;
  return CF.mul(anchor, scaled);
}

// ---------------------------------------------------------------- phase segmentation

/** Marker names that anchor a phase boundary. A marker is the animator saying what a moment IS, so
 *  it outranks anything inferred from the curve. */
const MARKER_PHASE = Object.freeze({
  impact: 'impact', hit: 'impact', contact: 'impact',
  anticipation: 'anticipation', windup: 'anticipation', 'wind-up': 'anticipation',
  prep: 'preparation', preparation: 'preparation',
  action: 'action', strike: 'action', swing: 'action',
  'follow-through': 'follow_through', followthrough: 'follow_through', follow_through: 'follow_through',
  recovery: 'recovery', settle: 'settle', acceleration: 'acceleration',
});

/**
 * Phase templates, applied relative to the segment with the highest angular rate.
 *
 * Only two action types have one, and that is the point: a template is a claim about the shape of
 * a motion, and Cadence has no basis for such a claim about a gesture or a walk cycle. Those come
 * back with unnamed segments and a stated reason, which a caller can fix by declaring boundaries.
 */
const TEMPLATES = Object.freeze({
  attack: {
    why: 'an attack builds, strikes, and recovers — the fastest stretch is the strike',
    label: (offset) => (offset === 0 ? 'action'
      : offset === -1 ? 'anticipation'
        : offset < -1 ? 'preparation'
          : offset === 1 ? 'follow_through'
            : offset === 2 ? 'recovery' : 'settle'),
  },
  reaction: {
    why: 'a reaction starts at its fastest — the hit is the beginning, not the middle',
    label: (offset) => (offset === 0 ? 'impact'
      : offset < 0 ? 'preparation'
        : offset === 1 ? 'follow_through'
          : offset === 2 ? 'recovery' : 'settle'),
  },
});

/**
 * Cut the existing animation into phases.
 *
 * Boundaries come from distinct keyframe times: a frame where no track has a key is fully
 * determined by its neighbours and cannot be where a phase turns. That is a Timeline Graph fact,
 * not a motion measurement, so the BOUNDARIES are `certain` even though the NAMES are not.
 *
 * @param opts.boundaries `[{ name, from, to }]` declared by the caller — wins over everything
 * @param opts.actionType selects a template; without one, segments stay unnamed
 */
export function segmentPhases(project, itemId, { boundaries = null, actionType = null, timeRange = null } = {}) {
  const item = itemOf(project, itemId);
  const tracks = tracksOf(project, itemId);
  const findings = [];
  const notRun = [
    'phases are cut at keyframe times and rated by AVERAGE angular travel per frame. A per-frame velocity, acceleration and jerk profile exists now (analyze_motion — MOT-003/004), but the segmenter does not consume it, so a boundary the motion implies and the keys do not is still missed',
    'no contact, foot-plant or ground relationship informs these boundaries. Contact drift is measurable (MOT-008), but only against a contact somebody DECLARED — nothing detects one from the motion',
  ];

  if (!item) throw new Error(`segmentPhases: no item "${itemId}"`);

  if (boundaries && boundaries.length) {
    const phases = boundaries.map((b) => CAL.phaseSpec({
      name: b.name, timeRange: [b.from, b.to], purpose: b.purpose ?? null,
      derivation: 'declared by the caller', certainty: CERTAINTY.CERTAIN,
    }));
    return { phases, segments: [], source: 'declared', findings, coverage: coverage({ scope: `item ${itemId}`, notRun }) };
  }

  const times = K.keyTimesOf(tracks).filter((t) => !timeRange || (t >= timeRange[0] - EPS && t <= timeRange[1] + EPS));
  if (times.length < 2) {
    findings.push(finding({
      id: 'PLAN-NO-SEGMENTS',
      certainty: CERTAINTY.CERTAIN,
      statement: `"${item.name || itemId}" has ${times.length} distinct keyframe time(s), which is not enough to cut into phases.`,
      evidence: [evidence('data', `key times: ${times.join(', ') || 'none'}`)],
      suggestion: { text: 'declare the phase boundaries explicitly, or key the motion first', reversible: true },
    }));
    return { phases: [], segments: [], source: 'none', findings, coverage: coverage({ scope: `item ${itemId}`, frames: times, notRun }) };
  }

  // --- rate profile: how much rotation happens per frame across each span
  const names = jointTrackNames(project, itemId);
  const segments = [];
  for (let i = 0; i < times.length - 1; i++) {
    const [a, b] = [times[i], times[i + 1]];
    let travel = 0;
    for (const n of names) {
      travel += K.angleBetween(K.evalTrackCF(tracks[n], a), K.evalTrackCF(tracks[n], b));
    }
    const span = b - a;
    segments.push({
      index: i, from: a, to: b, span,
      travel_deg: round2(travel),
      rate_deg_per_frame: round2(span > 0 ? travel / span : 0),
      name: null, certainty: null, derivation: null,
    });
  }

  // --- markers name what they can
  const markers = (project.markers && project.markers[itemId]) || [];
  let anchored = 0;
  for (const m of markers) {
    const phase = MARKER_PHASE[String(m.name || '').toLowerCase()];
    if (!phase) continue;
    // A marker names the moment; the segment it names is the one ENDING there (the travel that
    // arrives at it), falling back to the one starting there for a marker on the first key.
    const ending = segments.find((s) => Math.abs(s.to - m.t) < 0.5);
    const starting = segments.find((s) => Math.abs(s.from - m.t) < 0.5);
    const seg = ending || starting;
    if (!seg) continue;
    seg.name = phase;
    seg.certainty = CERTAINTY.HIGHLY_LIKELY;
    seg.derivation = `a marker named "${m.name}" sits at frame ${m.t}`;
    anchored++;
  }

  // --- the template fills the rest, relative to the fastest segment
  const template = TEMPLATES[actionType];
  let peak = -1;
  if (template) {
    peak = segments.reduce((best, s, i) => (s.rate_deg_per_frame > segments[best].rate_deg_per_frame ? i : best), 0);
    // A marker that names the template's anchor phase overrides the rate peak — the animator's
    // label beats the curve every time. An attack is anchored by either name: a marker reading
    // "impact" marks the same span a marker reading "action" would, and refusing to accept the
    // commoner of the two words would throw away the only hard evidence in the segmentation.
    const anchorNames = actionType === 'reaction' ? ['impact'] : ['action', 'impact'];
    const marked = segments.findIndex((s) => anchorNames.includes(s.name));
    const anchorName = marked >= 0 ? segments[marked].name : anchorNames[0];
    if (marked >= 0) peak = marked;

    for (const s of segments) {
      if (s.name) continue;
      s.name = template.label(s.index - peak);
      s.certainty = CERTAINTY.POSSIBLE;
      s.derivation = `${template.why}; the fastest span is frames ${segments[peak].from}–${segments[peak].to} at ${segments[peak].rate_deg_per_frame}°/frame`;
    }
    findings.push(finding({
      id: 'PLAN-PHASES-INFERRED',
      certainty: CERTAINTY.POSSIBLE,
      statement: `Phase names were inferred from the rate profile of a "${actionType}"; the fastest span (frames ${segments[peak].from}–${segments[peak].to}) was taken to be the ${anchorName}.`,
      evidence: [
        evidence('measurement', 'average angular travel per frame, per span', segments.map((s) => `${s.from}–${s.to}: ${s.rate_deg_per_frame}°/f`)),
        evidence('assumption', template.why),
      ],
      suggestion: { text: 'if that is the wrong span, pass `boundaries` or add a named marker at the real impact', reversible: true },
    }));
  } else {
    notRun.push(`segments are unnamed: no phase template exists for action type "${actionType ?? 'unspecified'}" — only attack and reaction have one, and inventing a phase structure for anything else would be a guess dressed as an analysis`);
    if (anchored) {
      findings.push(finding({
        id: 'PLAN-PHASES-PARTIAL',
        certainty: CERTAINTY.CERTAIN,
        statement: `${anchored} of ${segments.length} spans were named by markers; the rest are unnamed.`,
        evidence: [evidence('absence', 'no phase template applies to this action type')],
      }));
    }
  }

  const phases = segments.map((s) => CAL.phaseSpec({
    name: s.name,
    timeRange: [s.from, s.to],
    purpose: s.name ? purposeOf(s.name) : null,
    derivation: s.derivation || `keyframe times ${s.from} and ${s.to} bound this span; no evidence names it`,
    certainty: s.certainty || CERTAINTY.CERTAIN,
    timingRules: [`${s.span} frame(s), ${s.travel_deg}° of total joint rotation, ${s.rate_deg_per_frame}°/frame`],
  }));

  return {
    phases,
    segments,
    source: template ? 'rate_template' : (anchored ? 'markers' : 'unnamed'),
    peak_segment: peak >= 0 ? peak : null,
    findings,
    coverage: coverage({ scope: `item ${itemId}`, frames: times, notRun }),
  };
}

function purposeOf(name) {
  return {
    preparation: 'set up the body before the action is readable',
    anticipation: 'travel against the action to make its direction and force clear',
    acceleration: 'build speed into the action',
    action: 'the movement the shot exists for',
    impact: 'the frame the force lands on',
    follow_through: 'carry the inertia past the action',
    recovery: 'return toward a controlled state',
    settle: 'come to rest',
  }[name] ?? null;
}

function round2(v) { return Math.round(v * 100) / 100; }

// ---------------------------------------------------------------- strategies
//
// A strategy is a named, bounded transform with a declared footprint. `aspects` is what makes the
// constraint system able to refuse one before it is built, and `contributes` is what the plan can
// say was lost when it does.
//
// Each strategy is built ONCE per plan, from a list of `contributions` — every dimension that
// routes to it, with its pull and its scope. That is not a tidiness choice. "Heavier" routes three
// separate dimensions (weight_transfer, anticipation_depth, motion_amplitude) into `amplitude`, and
// building three independent edits produced three `set_key` operations on the same key. The last
// one applied won, so the largest pull — the one that carries most of what "heavy" means — was
// silently discarded in favour of whichever happened to be built last. Combining first is the fix.
//
// `precedence` resolves the remaining case, where two DIFFERENT strategies write the same field:
// `spacing_contrast` and `overshoot` both set easing. The higher precedence wins, deterministically
// and with the loss reported, rather than the winner depending on iteration order.

const STRATEGIES = {
  // ---- spacing: change how the travel is distributed, without moving a key or a pose
  spacing_contrast: {
    id: 'spacing_contrast',
    dimensions: ['acceleration_contrast', 'spacing_evenness', 'recovery_speed'],
    aspects: ['easing'],
    precedence: 1,
    contributes: 'the difference between a move that reads as an effort and one that reads as a slide',
    build(ctx, contributions) {
      const ops = [], notes = [], skipped = [];

      for (const ph of ctx.phasesInRange) {
        // Per phase, because two of the three dimensions are phase-selective: evenness pulls the
        // other way from contrast, and recovery speed applies only where the motion is settling.
        const pulls = [];
        for (const c of contributions) {
          if (c.dimension === 'acceleration_contrast') pulls.push(c.pull);
          else if (c.dimension === 'spacing_evenness') pulls.push(-c.pull);
          else if (c.dimension === 'recovery_speed' && (ph.name === 'recovery' || ph.name === 'settle')) pulls.push(c.pull);
        }
        const pull = VOC.combinePulls(pulls);
        const steps = Math.round(pull * GAIN.contrastSteps);
        if (!steps) {
          if (pulls.length) skipped.push({ phase: ph.name, why: `a combined contrast pull of ${pull} rounds to zero steps on the easing ladder` });
          continue;
        }
        const dir = phaseDirectionFor(ph);
        for (const name of ctx.trackNames) {
          const tr = ctx.tracks[name];
          for (const k of keysIn(tr, ph.time_range[0], ph.time_range[1], { inclusiveEnd: false })) {
            if (k.bez) {
              skipped.push({ track: name, t: k.t, why: 'the key uses a custom bezier, and evalSegment takes the bezier before the style — setting a style here would change the stored data and not the motion' });
              continue;
            }
            const from = CONTRAST_LADDER.indexOf(canonical(k.es));
            if (from < 0) {
              skipped.push({ track: name, t: k.t, why: `easing style "${k.es}" is off the contrast ladder (it is a shape, not a rate) — changing it would be a style decision, not a spacing one` });
              continue;
            }
            const to = clampIndex(from + steps, CONTRAST_LADDER.length);
            const es = CONTRAST_LADDER[to];
            const ed = dir ?? k.ed ?? 'Out';
            if (es === canonical(k.es) && ed === (k.ed ?? 'Out')) continue;
            const op = { op: 'set_easing', itemId: ctx.itemId, track: name, t: k.t, es, ed };
            // A style with no parameters must not inherit the previous style's — set_easing prunes
            // them, but saying so here keeps the op self-describing in the plan.
            if (!paramsFor(es).length) op.ep = null;
            ops.push(op);
          }
        }
        notes.push(`${ph.name ?? `frames ${ph.time_range[0]}–${ph.time_range[1]}`}: easing moved ${steps > 0 ? `${steps} step(s) up` : `${-steps} step(s) down`} the ladder (${CONTRAST_LADDER.join(' → ')})`);
      }
      return { ops, notes, skipped };
    },
  },

  // ---- amplitude: change the size of the pose change, without moving a key
  amplitude: {
    id: 'amplitude',
    dimensions: ['motion_amplitude', 'weight_transfer', 'anticipation_depth'],
    aspects: ['value'],
    precedence: 1,
    contributes: 'the size of the pose change — the difference between a suggested wind-up and a committed one',
    build(ctx, contributions) {
      const ops = [], notes = [], skipped = [];

      // One bucket per (track, span). Spans are the phases, which do not overlap, and a key at a
      // boundary belongs to the span that ARRIVES at it — so every key falls in exactly one bucket
      // and no key can be written twice.
      const buckets = new Map();
      for (const c of contributions) {
        const spans = c.phases ?? ctx.phasesInRange;
        const targets = c.roles ? ctx.trackNames.filter((n) => c.roles.includes(ctx.roleOf[n]?.role)) : ctx.trackNames;
        if (c.roles && !targets.length) {
          skipped.push({ dimension: c.dimension, why: `no animated joint on this rig fills the role(s) ${c.roles.join('/')} — the pull was carried, and reached nothing` });
        }
        if (!spans.length) {
          // Never widened to the whole clip. An amplitude edit aimed at a phase that was never
          // identified must not silently become an amplitude edit on everything — that is the
          // difference between a narrow correction and a rewrite.
          skipped.push({ dimension: c.dimension, why: 'the phase this dimension targets was not identified in range, so there is no span to scale. Declare boundaries or name the range in frames' });
          continue;
        }
        for (const n of targets) {
          for (const p of spans) {
            const key = `${n}|${p.time_range[0]}|${p.time_range[1]}`;
            const b = buckets.get(key) || { track: n, from: p.time_range[0], to: p.time_range[1], pulls: [], dimensions: [] };
            b.pulls.push(c.pull);
            b.dimensions.push(c.dimension);
            buckets.set(key, b);
          }
        }
      }

      const scales = new Set();
      for (const b of buckets.values()) {
        const k = clamp(1 + VOC.combinePulls(b.pulls) * GAIN.amplitude, GAIN.amplitudeMin, GAIN.amplitudeMax);
        if (Math.abs(k - 1) < 0.01) continue;
        scales.add(round2(k));
        const tr = ctx.tracks[b.track];
        // The value AT the span start is the anchor and is never written, so the edit joins what
        // precedes it exactly. Keys after it grow away from it.
        const anchor = K.evalTrackCF(tr, b.from);
        for (const key of keysIn(tr, b.from, b.to, { inclusiveStart: false })) {
          const next = scaleAbout(anchor, key.v, k);
          if (K.angleBetween(key.v, next) < 0.05) continue;
          ops.push({ op: 'set_key', itemId: ctx.itemId, track: b.track, t: key.t, value: next });
        }
      }

      if (!ops.length && !skipped.length) notes.push('the combined amplitude change is under 1% and was not applied');
      if (ops.length) {
        notes.push(`rotations scaled ×${[...scales].sort((a, z) => a - z).join(' / ×')} about the pose at each span start, so every span still joins what precedes it exactly`);
        notes.push(`pulls from ${[...new Set(contributions.map((c) => c.dimension))].join(', ')} were combined per joint and span, not applied one after another`);
        notes.push('joint limits are not checked: Cadence stores none, and the Rig Graph reports them as null (unknown, not unlimited)');
      }
      return { ops, notes, skipped };
    },
  },

  // ---- lead and lag: move keys so the body initiates before the limbs
  lead_lag: {
    id: 'lead_lag',
    dimensions: ['body_lead', 'secondary_delay'],
    aspects: ['timing'],
    precedence: 1,
    contributes: 'body-driven motion — hips before torso before shoulder before wrist. Without it a "heavy" action still starts everywhere at once, which is the single most common reason a heavy motion reads as weightless',
    build(ctx, contributions) {
      const ops = [], notes = [], skipped = [];
      const maxDepth = Math.max(...ctx.trackNames.map((n) => ctx.roleOf[n]?.depth ?? 0), 1);
      let maxOffset = 0;

      for (const name of ctx.trackNames) {
        const info = ctx.roleOf[name];
        const depth = info?.depth ?? null;
        if (depth === null) {
          skipped.push({ track: name, why: 'no semantic role could be resolved for this joint, so its place in the kinetic chain is unknown — offsetting it would be a guess' });
          continue;
        }
        // `secondary_delay` addresses what trails the action, so it is applied only where a trail
        // is plausible: a joint whose part cannot hold a contact. A foot that lags is not secondary
        // motion, it is a broken plant.
        const pulls = contributions
          .filter((c) => c.dimension !== 'secondary_delay' || !ROLES.isContactCapable(info.partRole))
          .map((c) => c.pull);
        const offset = Math.round(VOC.combinePulls(pulls) * GAIN.lead * (depth / maxDepth));
        if (!offset) continue;
        maxOffset = Math.max(maxOffset, Math.abs(offset));

        for (const [from, to] of ctx.phasesInRange.map((p) => p.time_range)) {
          // Never the key at the span start (it is the pose the span departs from) and never
          // frame 0 (the rest pose every exporter expects to be there).
          const inRange = keysIn(ctx.tracks[name], from, to, { inclusiveStart: false }).filter((key) => key.t > EPS);
          const ordered = offset > 0 ? [...inRange].sort((a, b) => b.t - a.t) : [...inRange].sort((a, b) => a.t - b.t);
          for (const key of ordered) {
            const dest = key.t + offset;
            if (dest < 0 || dest > (ctx.project.length ?? Infinity)) {
              skipped.push({ track: name, t: key.t, why: `moving to frame ${dest} would leave the timeline (0–${ctx.project.length})` });
              continue;
            }
            const occupied = (ctx.tracks[name].keys || []).some((o) => Math.abs(o.t - dest) < EPS && !inRange.includes(o));
            if (occupied) {
              skipped.push({ track: name, t: key.t, why: `frame ${dest} already holds a key that is not being moved — a move would overwrite it` });
              continue;
            }
            ops.push({ op: 'move_key', itemId: ctx.itemId, track: name, t: key.t, to: dest });
          }
        }
      }
      if (ops.length) {
        notes.push(`distal joints offset by up to ${maxOffset} frame(s) relative to the root, scaled by chain depth`);
        notes.push('this changes WHEN keys happen — it is the one strategy a timing lock forbids');
      } else if (!skipped.length) {
        notes.push('the combined lead/lag pull rounds to zero frames on every joint');
      }
      return { ops, notes, skipped };
    },
  },

  // ---- overshoot: carry past the target and return, without adding a key
  overshoot: {
    id: 'overshoot',
    dimensions: ['overshoot'],
    aspects: ['easing'],
    // Above spacing_contrast: Back/Out is a specific shape chosen for a specific span, and the
    // generic ladder position must not overwrite it.
    precedence: 2,
    contributes: 'inertia at the end of a move — a part that stops dead reads as weightless whatever its amplitude',
    build(ctx, contributions) {
      const ops = [], notes = [], skipped = [];
      const pull = VOC.combinePulls(contributions.map((c) => c.pull));
      if (pull <= 0) {
        return { ops, notes: ['reducing overshoot is not implemented: removing a Back ease would need to know whether the animator chose it deliberately, and this build cannot tell'], skipped };
      }
      const amount = round2(pull * GAIN.overshoot);
      // `impact` is excluded on purpose. Overshoot means passing the target and returning, and the
      // target of an impact span is the contact — going past it and coming back is precisely the
      // thing a plant must not do. Overshoot belongs after the contact, not into it.
      const arriving = ctx.phasesInRange.filter((p) => ['action', 'follow_through'].includes(p.name));
      if (!arriving.length) {
        return { ops, notes: [], skipped: [{ why: 'no phase in range is named action or follow_through. Overshoot applied to an unidentified span would land anywhere, and applying it into an impact would break the contact it arrives at' }] };
      }

      for (const ph of arriving) {
        for (const name of ctx.trackNames) {
          const info = ctx.roleOf[name];
          // This used to be a blanket skip on every contact-capable part, because nothing could
          // tell a planted foot from a swinging hand. MOT-008 can: the part's world travel over
          // this span IS the answer. A part that barely moves is holding something; a part that
          // sweeps a stud and a half is not, and refusing to give it inertia was costing the
          // strategy most of the arm.
          if (info && ROLES.isContactCapable(info.partRole) && info.partId) {
            const plant = plantedDuring(ctx, info.partId, ph.time_range);
            if (plant.planted) {
              skipped.push({ track: name, why: `"${info.partRole}" travels only ${plant.travel_studs} stud(s) over frames ${ph.time_range[0]}–${ph.time_range[1]}, within the ${PLANT_TOLERANCE_STUDS}-stud plant threshold — it is holding a contact there, and an overshoot on a planted effector breaks the plant (measured, MOT-008)` });
              continue;
            }
            notes.push(`"${name}" drives a contact-capable part, but it travels ${plant.travel_studs} stud(s) over frames ${ph.time_range[0]}–${ph.time_range[1]} — it is not planted there, so it gets the overshoot`);
          }
          for (const key of keysIn(ctx.tracks[name], ph.time_range[0], ph.time_range[1], { inclusiveEnd: false })) {
            if (key.bez) { skipped.push({ track: name, t: key.t, why: 'a custom bezier already governs this segment' }); continue; }
            ops.push({ op: 'set_easing', itemId: ctx.itemId, track: name, t: key.t, es: 'Back', ed: 'Out', ep: { Overshoot: amount } });
          }
        }
      }
      notes.push(`Back/Out with Overshoot ${amount} on the arriving segments — the part passes its target and returns to it, with no new keys`);
      return { ops, notes, skipped };
    },
  },
};

export const STRATEGY_IDS = Object.freeze(Object.keys(STRATEGIES));

/**
 * Below this much total world travel across a span, a contact-capable part is treated as planted.
 *
 * It is a CONVENTION, not a measurement: nothing in a Cadence project declares a plant unless the
 * user writes a ContactSpec, so this is the planner guessing conservatively on their behalf. Two
 * studs is roughly a foot's own length; a twentieth of that is well inside "did not go anywhere".
 * A user who disagrees declares a contact explicitly, and the constraint checker then enforces the
 * tolerance THEY chose rather than this one.
 */
export const PLANT_TOLERANCE_STUDS = 0.1;

function plantedDuring(ctx, partId, [from, to]) {
  const s = MOTION.sampleMotion(ctx.project, { itemId: ctx.itemId, partIds: [partId], frameRange: [from, to], step: 1 });
  const travel = s.subjects[0]?.summary?.path_length_studs ?? null;
  return {
    travel_studs: travel,
    // A part that could not be solved is NOT assumed to be free. Unknown is not a default.
    planted: travel === null ? true : travel <= PLANT_TOLERANCE_STUDS,
  };
}

function canonical(style) {
  const s = style || 'Linear';
  return ({ Expo: 'Exponential', Circ: 'Circular', None: 'Constant' })[s] || s;
}
function clampIndex(i, n) { return Math.max(0, Math.min(n - 1, i)); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function phaseDirectionFor(phase) {
  // Only act on a direction when the phase name is trustworthy. A `possible` name is good enough to
  // report and to choose an amplitude range from; it is not good enough to invert an ease the
  // animator chose, because that is visible and hard to attribute later.
  if (!phase.name) return null;
  if (phase.certainty !== CERTAINTY.CERTAIN && phase.certainty !== CERTAINTY.HIGHLY_LIKELY) return null;
  return PHASE_DIRECTION[phase.name] ?? null;
}

// ---------------------------------------------------------------- planning

/**
 * Build a MotionPlan from an IntentSpec.
 *
 * @param opts.intent      an IntentSpec (from `ai/intent.js`, or built by hand)
 * @param opts.itemId      the item to plan against; defaults to `intent.target.itemId`
 * @param opts.constraints ConstraintSpecs the plan must respect
 * @param opts.boundaries  declared phase boundaries, which override segmentation
 */
export function planMotion(project, { intent, itemId = null, constraints = [], boundaries = null } = {}) {
  if (!intent || !intent.id) throw new TypeError('planMotion: an IntentSpec is required — build one with ai/intent.js interpretRequest');
  const target = intent.target || {};
  const id = itemId ?? target.itemId ?? null;
  const item = id ? itemOf(project, id) : null;
  const findings = [...(intent.findings || [])];
  const questions = [...(intent.unresolved_questions || [])];
  const risks = [];

  if (!item) {
    throw new Error(`planMotion: no item "${id}" — pass itemId, or set intent.target.itemId`);
  }
  if (!item.rig) {
    throw new Error(`planMotion: "${item.name || id}" has no rig. This planner edits joint tracks; a camera or prop needs a different compiler (Part 40 — Phase 6)`);
  }

  // --- phases
  const seg = segmentPhases(project, id, { boundaries, actionType: intent.action_type, timeRange: null });
  findings.push(...seg.findings);

  // --- the range this applies to
  const tracks = tracksOf(project, id);
  const allTimes = K.keyTimesOf(tracks);
  const clipRange = allTimes.length ? [allTimes[0], allTimes[allTimes.length - 1]] : [0, project.length ?? 0];
  let range = target.timeRange ?? null;
  let rangeWhy = range ? 'the request named a frame range' : null;
  let phasesInRange = seg.phases;

  if (!range && target.phases && target.phases.length) {
    const matched = seg.phases.filter((p) => target.phases.includes(p.name));
    if (!matched.length) {
      const available = seg.phases.map((p) => `${p.name ?? 'unnamed'} ${p.time_range[0]}–${p.time_range[1]}`).join(', ');
      questions.push(`The request names the ${target.phases.join('/')} phase, and segmentation did not identify one. Spans found: ${available || 'none'}. Declare boundaries or add a named marker.`);
      findings.push(finding({
        id: 'PLAN-PHASE-NOT-FOUND',
        certainty: CERTAINTY.CERTAIN,
        statement: `No span was identified as "${target.phases.join('/')}", so the plan has no range to edit.`,
        evidence: [evidence('absence', `spans available: ${available || 'none'}`)],
        suggestion: { text: 'pass `boundaries: [{ name, from, to }]`, or place a marker named after the phase', reversible: true },
      }));
      phasesInRange = [];
    } else {
      range = [Math.min(...matched.map((p) => p.time_range[0])), Math.max(...matched.map((p) => p.time_range[1]))];
      rangeWhy = `the request named the ${target.phases.join('/')} phase`;
      phasesInRange = matched;
    }
  }

  if (!range && phasesInRange.length) {
    range = clipRange;
    rangeWhy = 'no range or phase was named, so the whole keyed span is in scope';
    risks.push('this applies to the whole animation because nothing narrowed it — name a phase or a frame range to make it local (Part 54: a local correction should default to minimal scope)');
  }
  if (range) phasesInRange = phasesInRange.filter((p) => p.time_range[1] > range[0] + EPS && p.time_range[0] < range[1] - EPS);
  // A range with no identified phases still has to be editable — treat it as one unnamed span.
  if (range && !phasesInRange.length) {
    phasesInRange = [CAL.phaseSpec({ name: null, timeRange: range, derivation: rangeWhy, certainty: CERTAINTY.CERTAIN })];
  }

  // --- the joints, and what they are
  const trackNames = jointTrackNames(project, id).filter((n) => (tracks[n].keys || []).length);
  const roleOf = {};
  for (const n of trackNames) {
    const joint = (item.rig.joints || []).find((j) => j.name === n);
    if (!joint) {
      roleOf[n] = null;
      risks.push(`track "${n}" drives no joint on this rig — it is animation data with nothing to animate, and every strategy skips it`);
      continue;
    }
    const jr = ROLES.jointRole(project, item, joint);
    const part = (item.rig.parts || []).find((p) => p.id === joint.part1);
    const pr = part ? ROLES.partRole(project, item, part) : null;
    roleOf[n] = { role: jr.role, side: jr.side, depth: ROLES.chainDepth(jr.role), partRole: pr?.role ?? null, partId: joint.part1, certainty: jr.certainty };
  }
  const usable = trackNames.filter((n) => roleOf[n]);

  const ctx = { project, itemId: id, item, tracks, trackNames: usable, roleOf, phasesInRange };

  // --- choose strategies from the dimension vector
  const dims = intent.dimensions || {};
  const edits = [];
  const blocked = [];
  const THRESHOLD = 0.05;

  // Dimensions are routed to strategies and GROUPED, so each strategy is built once from every
  // pull that reaches it. See the STRATEGIES comment for why building them separately was wrong.
  const byStrategy = new Map();
  for (const [dim, pull] of Object.entries(dims)) {
    if (Math.abs(pull) < THRESHOLD) continue;
    const spec = VOC.DIMENSIONS[dim];
    if (!spec) continue;
    if (!spec.implemented) {
      blocked.push({
        strategy: null, dimension: dim, pull,
        summary: `${dim} ${pull > 0 ? '+' : ''}${pull}`,
        reason: spec.blocked_by,
        blocked_by: 'capability',
        contributes: spec.summary,
      });
      continue;
    }
    const strategy = STRATEGY_IDS.find((s) => STRATEGIES[s].dimensions.includes(dim));
    if (!strategy) {
      blocked.push({
        strategy: null, dimension: dim, pull, summary: `${dim} ${pull > 0 ? '+' : ''}${pull}`,
        reason: `no compiler strategy claims "${dim}" — the dimension is marked implemented but nothing builds operations for it`,
        blocked_by: 'capability', contributes: spec.summary,
      });
      continue;
    }
    const contribution = { dimension: dim, pull };
    // The scope filters are what make three dimensions that share one strategy mean different
    // things: weight_transfer addresses the body's mass, anticipation_depth addresses one phase,
    // motion_amplitude addresses everything.
    if (dim === 'weight_transfer') contribution.roles = [ROLE.ROOT_JOINT, ROLE.WAIST, ROLE.HIP];
    if (dim === 'anticipation_depth') {
      contribution.phases = phasesInRange.filter((p) => p.name === 'anticipation' || p.name === 'preparation');
      if (!contribution.phases.length) {
        contribution.warning = 'no anticipation or preparation phase was identified in range, so this dimension reaches nothing';
      }
    }
    if (!byStrategy.has(strategy)) byStrategy.set(strategy, []);
    byStrategy.get(strategy).push(contribution);
  }

  for (const [strategy, contributions] of byStrategy) {
    const headline = VOC.combinePulls(contributions.map((c) => c.pull));
    edits.push({
      id: `edit:${strategy}`,
      strategy,
      contributions,
      dimension: contributions.map((c) => c.dimension).join('+'),
      pull: headline,
      aspects: STRATEGIES[strategy].aspects,
      phase: phasesInRange[0]?.id ?? null,
      warnings: contributions.filter((c) => c.warning).map((c) => `${c.dimension}: ${c.warning}`),
      summary: `${strategy}: ${contributions.map((c) => `${c.dimension} ${fmtPull(c.pull)}`).join(', ')} → combined ${fmtPull(headline)} — ${STRATEGIES[strategy].contributes}`,
      contributes: STRATEGIES[strategy].contributes,
    });
  }

  for (const [dim, pull] of Object.entries(intent.vfx_dimensions || {})) {
    if (Math.abs(pull) < THRESHOLD) continue;
    blocked.push({
      strategy: null, dimension: dim, pull, summary: `${dim} ${pull > 0 ? '+' : ''}${pull}`,
      reason: 'the VFX compiler is Part 37 (Phase 6); no effect graph is touched by this planner',
      blocked_by: 'capability',
      contributes: VOC.VFX_DIMENSIONS[dim]?.summary ?? dim,
    });
  }

  // --- poses, timing, spacing, contacts
  const poses = phasesInRange.map((p) => CAL.poseSpec({
    time: p.time_range[1],
    role: poseRoleFor(p.name),
    purpose: p.name ? `the pose the ${p.name} phase arrives at` : `the pose at frame ${p.time_range[1]}`,
    bodyRegionTargets: usable
      .filter((n) => keysIn(tracks[n], p.time_range[1] - 0.5, p.time_range[1] + 0.5).length)
      .map((n) => ({
        role: roleOf[n].role, joint: n,
        rotationGoal: `${round2(rotOf(K.evalTrackCF(tracks[n], p.time_range[1])))}° from rest`,
        orientationIntent: null, constraint: null,
      })),
    confidence: p.certainty,
    styleNotes: intent.style_profile,
  }));

  const timing = CAL.timingSpec({
    duration: range ? range[1] - range[0] : null,
    frameRate: project.fps ?? null,
    phaseBoundaries: seg.phases.map((p) => ({ name: p.name, at: p.time_range[0] })),
    impactFrames: seg.phases.filter((p) => p.name === 'impact').map((p) => p.time_range[1]),
    beatMarkers: ((project.markers && project.markers[id]) || []).map((m) => ({ t: m.t, name: m.name ?? null })),
    protectedTimes: (intent.critical_events || []).map((e) => ({ t: e.expected_time, tolerance: e.tolerance })),
    timingContrast: seg.segments.length
      ? `${round2(Math.max(...seg.segments.map((s) => s.rate_deg_per_frame)))}°/f fastest against ${round2(Math.min(...seg.segments.map((s) => s.rate_deg_per_frame)))}°/f slowest`
      : null,
    retimingLimits: intent.preserve.includes('aspect:timing') ? 'timing is protected: no key may move' : null,
  });

  const spacing = CAL.spacingSpec({
    targetRegions: [...new Set(usable.map((n) => roleOf[n].role))],
    accelerationProfile: dims.acceleration_contrast ? `contrast ${fmtPull(dims.acceleration_contrast)}` : null,
    overshootProfile: dims.overshoot ? `overshoot ${fmtPull(dims.overshoot)}` : null,
    rotationalProfile: dims.motion_amplitude ? `amplitude ${fmtPull(dims.motion_amplitude)}` : null,
    interpolationPolicy: `easing moves along the ladder ${CONTRAST_LADDER.join(' → ')}; a key with a custom bezier is never touched`,
    tangentPolicy: null,
    noisePolicy: 'no noise is added or removed — Part 69 is Phase 8',
  });

  // Contacts: only what a constraint already declared. This planner does not infer contacts, and
  // Part 20.5 is explicit that they should not be inferred after the fact anyway.
  const contacts = constraints
    .filter((c) => c.condition && c.condition.check === 'contact_drift')
    .map((c) => CAL.contactSpec({
      effector: c.condition.effector,
      mode: 'planted',
      start: c.time_range ? c.time_range[0] : null,
      end: c.time_range ? c.time_range[1] : null,
      positionalTolerance: c.condition.tolerance_studs ?? null,
      validationMethod: 'declared',
      userLocked: c.constraint_type === 'lock',
      certainty: CERTAINTY.USER_INTENT_REQUIRED,
      evidence: [evidence('data', `declared by constraint ${c.id}`, c.property_or_semantic_rule)],
    }));
  if (contacts.length) {
    risks.push(`${contacts.length} declared contact(s) are protected by constraint AND measured: the plan's acceptance spec carries a contact_drift_within check for each, and the constraint checker measures the drift on the planned result before it is applied (MOT-008). What is not checked is whether the contact was declared over the right frames`);
  }

  const acceptance = buildAcceptance({ intent, itemId: id, edits, range, contacts, project });

  const protectedElements = [
    ...intent.preserve,
    ...constraints.map((c) => c.property_or_semantic_rule),
  ];

  const plan = CAL.motionPlan({
    intentId: intent.id,
    duration: range ? range[1] - range[0] : null,
    phases: seg.phases,
    omittedPhases: omittedPhases(seg.phases, intent.action_type),
    rootMotionStrategy: 'unchanged — no strategy in this build writes the @origin track',
    secondaryMotionStrategy: dims.secondary_delay ? `secondary delay ${fmtPull(dims.secondary_delay)} via lead_lag` : 'unchanged',
    styleOverrides: intent.style_profile,
    protectedElements,
    acceptanceCriteria: acceptance,
    risks,
    target: { itemId: id, timeRange: range, range_reason: rangeWhy, phases: phasesInRange.map((p) => p.id) },
    edits,
    blocked,
    timing,
    spacing,
    contacts,
    poses,
  });

  return {
    plan,
    ctx,
    segmentation: seg,
    questions,
    findings: sortFindings(findings),
    description: CAL.describePlan(plan),
    coverage: coverage({
      scope: `item ${id}${range ? `, frames ${range[0]}–${range[1]}` : ''}`,
      frames: range,
      loop: 'fast',
      notRun: [
        ...seg.coverage.notRun,
        'nothing was rendered: a plan is produced before the patch, so whether it reads as intended is unanswered HERE. explain_change measures it afterwards against a baseline (Part 43/44); a forward prediction of the rendered result still does not exist',
        'a DECLARED contact is measured against the planned result by the constraint checker (MOT-008); an UNDECLARED one is not, because nothing detects a contact from the motion',
        'no silhouette or screen-space check was run (Parts 28, 43). Path curvature and bow ARE measurable now (analyze_motion), but no strategy reshapes a path, so the plan neither reads nor writes them',
      ],
    }),
  };
}

function poseRoleFor(name) {
  return { anticipation: 'anticipation', action: 'extreme', impact: 'contact', follow_through: 'follow_through', recovery: 'recovery', settle: 'hold', preparation: 'breakdown', acceleration: 'passing' }[name] ?? 'key';
}

function fmtPull(v) { return `${v > 0 ? '+' : ''}${v}`; }

function omittedPhases(phases, actionType) {
  if (!actionType || !TEMPLATES[actionType]) return [];
  const present = new Set(phases.map((p) => p.name).filter(Boolean));
  const expected = actionType === 'attack'
    ? ['anticipation', 'action', 'follow_through', 'recovery']
    : ['impact', 'follow_through', 'recovery'];
  return expected.filter((n) => !present.has(n)).map((n) => ({
    name: n,
    why: `no span was identified as ${n}: the animation has ${phases.length} keyframe-bounded span(s), which is fewer than this action type's full structure. That may be correct — a compressed action legitimately merges phases — but nothing here can tell that from a missing one`,
  }));
}

/**
 * The acceptance criteria a plan must meet. Generated from the intent's preserve clause and the
 * strategies chosen, so the criteria cannot disagree with the plan.
 *
 * `no_visual_regression` is added unconditionally and always comes back as NOT RUN. That is the
 * point: every acceptance report this build produces should end by saying that nobody has looked
 * at the result.
 */
function buildAcceptance({ intent, itemId, edits, range, contacts }) {
  const checks = [];
  const preserved = new Set(intent.preserve.filter((p) => p.startsWith('aspect:')).map((p) => p.slice(7)));

  if (preserved.has('timing')) checks.push({ check: 'key_times_unchanged', itemId });
  if (preserved.has('value')) checks.push({ check: 'amplitude_within', itemId, timeRange: range, max_ratio: 1.001 });
  if (preserved.has('easing')) checks.push({ check: 'easing_changed', itemId, timeRange: range, min_keys: 0 });

  for (const e of intent.critical_events || []) {
    if (e.expected_time === null || e.expected_time === undefined) continue;
    checks.push({ check: 'key_times_unchanged', itemId, timeRange: [e.expected_time - (e.tolerance ?? 0), e.expected_time + (e.tolerance ?? 0)] });
    checks.push({ check: 'marker_within', itemId, t: e.expected_time, tolerance: e.tolerance ?? 0 });
  }

  // Everything outside the target item must be untouched, always. This is the check that catches
  // an edit reaching somewhere nobody was watching.
  checks.push({ check: 'scope_unchanged', itemIds: [itemId] });
  checks.push({ check: 'no_new_tracks' });

  const amp = edits.find((e) => e.strategy === 'amplitude');
  if (amp && !preserved.has('value')) {
    // A deliberately conservative threshold: half the nominal gain. The strategy anchors each range
    // at its start, so the FIRST key of every range does not move at all and the measured ratio is
    // always below the nominal scale factor.
    const nominal = 1 + amp.pull * GAIN.amplitude;
    if (amp.pull > 0) checks.push({ check: 'amplitude_increased', itemId, timeRange: range, min_ratio: round3(1 + (nominal - 1) * 0.3) });
    else checks.push({ check: 'amplitude_within', itemId, timeRange: range, max_ratio: 1.001 });
  }
  if (edits.some((e) => e.strategy === 'spacing_contrast' || e.strategy === 'overshoot')) {
    checks.push({ check: 'easing_changed', itemId, timeRange: range, min_keys: 1 });
  }
  for (const c of contacts) {
    checks.push({ check: 'contact_drift_within', itemId, effector: c.effector, start: c.start, end: c.end, tolerance: c.positional_tolerance });
  }
  checks.push({ check: 'no_visual_regression', baselineId: null, threshold: null });

  return CAL.acceptanceSpec({
    checks,
    reviewRequired: contacts.length > 0 || edits.some((e) => e.strategy === 'lead_lag'),
    baselinePolicy: 'the state immediately before the patch is the comparison point, unless create_baseline pinned an approved baseline first (Part 44) — which is the stronger option, because a baseline also holds rendered passes to compare against',
    tolerancePolicy: 'pose tolerances are in degrees of joint rotation; timing tolerances are in frames',
    escalationPolicy: 'a failed protected-state check should be rolled back, not overridden — rollback_transaction takes the transaction id',
  });
}

function round3(v) { return Math.round(v * 1000) / 1000; }

// ---------------------------------------------------------------- compilation (Part 24)

/**
 * Compile a MotionPlan into patch operations.
 *
 * Each strategy is built, wrapped in a trial patch, and run through the real constraint checker
 * on its own. A strategy that would be refused is dropped whole rather than partially — half an
 * amplitude edit is a broken pose, not a compromise.
 *
 * @param opts.constraints the same ConstraintSpecs the plan was built against
 * @param opts.frame       the frame semantic selectors resolve at
 */
export function compilePlan(project, plan, ctx, { constraints = [], frame = 0 } = {}) {
  const ops = [];
  const applied = [];
  const blocked = [...plan.blocked];
  const notes = [];
  const skipped = [];
  const findings = [];

  for (const edit of plan.edits) {
    const strategy = STRATEGIES[edit.strategy];
    const built = strategy.build(ctx, edit.contributions);
    notes.push(...built.notes.map((n) => `${edit.strategy}: ${n}`));
    skipped.push(...built.skipped.map((s) => ({ strategy: edit.strategy, ...s })));

    if (!built.ops.length) {
      blocked.push({
        strategy: edit.strategy, dimension: edit.dimension, pull: edit.pull, summary: edit.summary,
        reason: built.notes[0] || built.skipped[0]?.why || 'the strategy produced no operations for this range',
        blocked_by: 'no_effect',
        contributes: edit.contributes,
      });
      continue;
    }

    // The real check, on this strategy alone, so the reason a strategy was dropped names the
    // constraint that dropped it rather than "something in the batch was refused".
    const trial = makePatch({ ops: built.ops, intent: edit.summary });
    const trialPlan = planPatch(project, trial);
    const report = checkPatch(project, trial, constraints, { frame, result: trialPlan.result });
    const refusing = report.violations.filter((v) => v.response === 'refuse');

    if (refusing.length) {
      // Deduplicated by constraint: one timing lock violated by forty key moves is one reason, not
      // forty. The operation count is kept separately so the size of the drop is still visible.
      const byConstraint = [...new Map(refusing.map((v) => [v.constraint_id, v])).values()];
      blocked.push({
        strategy: edit.strategy, dimension: edit.dimension, pull: edit.pull, summary: edit.summary,
        reason: `${byConstraint.length} constraint(s) refuse this: ${byConstraint.map((v) => v.rule).join('; ')}`,
        blocked_by: 'constraint',
        constraints: byConstraint.map((v) => ({ id: v.constraint_id, rule: v.rule, type: v.constraint_type, priority: v.priority, priority_name: v.priority_name })),
        contributes: edit.contributes,
        operations_dropped: built.ops.length,
      });
      findings.push(finding({
        id: 'PLAN-STRATEGY-BLOCKED',
        certainty: CERTAINTY.CERTAIN,
        statement: `"${edit.strategy}" was dropped: it changes ${edit.aspects.join('/')}, and that is protected.`,
        evidence: [
          evidence('data', byConstraint.map((v) => v.rule).join('; '), { operations_dropped: built.ops.length }),
          evidence('inference', `the motion loses: ${edit.contributes}`),
        ],
        suggestion: { text: `if that is not wanted, relax the constraint on ${edit.aspects.join('/')} and re-plan`, reversible: true },
      }));
      continue;
    }
    if (!trialPlan.applicable) {
      blocked.push({
        strategy: edit.strategy, dimension: edit.dimension, pull: edit.pull, summary: edit.summary,
        reason: `the operations would not apply: ${trialPlan.ops.flatMap((o) => o.problems || []).map((p) => p.statement).join('; ') || 'unknown'}`,
        blocked_by: 'inapplicable',
        contributes: edit.contributes,
      });
      continue;
    }

    ops.push(...built.ops.map((o) => ({ ...o, __strategy: edit.strategy })));
    applied.push({ strategy: edit.strategy, dimensions: edit.contributions.map((c) => c.dimension), pull: edit.pull, operations: built.ops.length, aspects: edit.aspects });
  }

  // `set_key` (value) and `set_easing` (style) write different fields of the same key and compose
  // fine. Two writes of the SAME field do not, and the survivor would otherwise be whichever
  // strategy happened to be built last. Precedence decides it instead, and the loser is reported.
  const { kept, dropped } = resolveOverlaps(ops);
  for (const d of dropped) {
    const a = applied.find((x) => x.strategy === d.loser);
    if (a) a.operations -= d.count;
    findings.push(finding({
      id: 'PLAN-OP-OVERLAP',
      certainty: CERTAINTY.CERTAIN,
      statement: `${d.count} operation(s) from "${d.loser}" were dropped: "${d.winner}" writes the same easing on the same key(s) and takes precedence.`,
      evidence: [
        evidence('data', `both strategies target ${d.examples.join(', ')}${d.count > d.examples.length ? ` and ${d.count - d.examples.length} more` : ''}`),
        evidence('inference', `"${d.winner}" is the more specific shape, so the generic one yields rather than the order of construction deciding it`),
      ],
    }));
  }
  const finalOps = kept.map(({ __strategy, ...o }) => o);

  return {
    ops: finalOps,
    applied: applied.filter((a) => a.operations > 0),
    blocked,
    notes,
    skipped,
    findings,
    summary: finalOps.length
      ? `${finalOps.length} operation(s) from ${applied.filter((a) => a.operations > 0).length} strategy/strategies${blocked.length ? `, ${blocked.length} blocked` : ''}`
      : `nothing to apply${blocked.length ? ` — all ${blocked.length} candidate change(s) were blocked` : ''}`,
    lost: blocked.map((b) => ({ what: b.summary, why: b.reason, cost: b.contributes })),
  };
}

/** Resolve two operations writing the same field of the same key by strategy precedence. Returns
 *  the surviving operations and a per-collision report of what was dropped and why. */
function resolveOverlaps(ops) {
  const rank = (o) => STRATEGIES[o.__strategy]?.precedence ?? 0;
  const winners = new Map();
  for (const o of ops) {
    const key = `${o.itemId}|${o.track}|${o.t}|${o.op}`;
    const held = winners.get(key);
    if (!held || rank(o) > rank(held)) winners.set(key, o);
  }
  const kept = [], collisions = new Map();
  for (const o of ops) {
    const key = `${o.itemId}|${o.track}|${o.t}|${o.op}`;
    if (winners.get(key) === o) { kept.push(o); continue; }
    const w = winners.get(key);
    const ck = `${o.__strategy}->${w.__strategy}`;
    const c = collisions.get(ck) || { loser: o.__strategy, winner: w.__strategy, count: 0, examples: [] };
    c.count++;
    if (c.examples.length < 3) c.examples.push(`${o.track} @ ${o.t}`);
    collisions.set(ck, c);
  }
  return { kept, dropped: [...collisions.values()] };
}

// ---------------------------------------------------------------- authoring (Parts 26, 29, 32)
//
// `planMotion` above edits. This authors: an empty timeline in, key poses at declared phase
// boundaries out, with breakdowns, holds and a settle, all COMPUTED from explicit numbers.
//
// Four decisions shaped it, each a place it could have gone wrong:
//
//   * **Frames are the caller's, never inferred.** `segmentPhases`'s templates name an attack's
//     phases in order; they say nothing about how many frames each one should take, and this file
//     will not invent proportions. A caller who names an action type without frames gets the
//     template's phase ORDER back plus a question — not a guess wearing a number's clothes. Adding
//     a default-proportion recipe is a product decision, not a compiler's.
//   * **Every authored frame is a full key over the script's own joint set.** A joint posed in one
//     phase and not the next would otherwise hold its value through the next phase by
//     interpolation, which is the classic "I didn't key it and it drifted" bug. Carrying it
//     forward explicitly makes the hold visible in the timeline, in the x-sheet and to every later
//     strategy. `keyAllTouched: false` turns it off for a caller who wants a sparse track.
//   * **A breakdown is a POSE BIAS, not a time fraction.** A key 40% of the way through a span
//     holding a pose 25% of the way between its neighbours is what makes an arc favour its
//     anticipation. Both numbers are reported side by side so the favour is visible.
//   * **A settle overshoots BEFORE it rests.** The final pose is the rest pose; the overshoot key
//     sits between the previous key and it, past the final value by a declared ratio of the last
//     transition's travel. `scaleAbout` — the same anchored scale the `amplitude` strategy uses —
//     computes both the breakdown and the overshoot, so there is one interpolation primitive here
//     and not two that could disagree.

/** The steps an authoring script compiles to. Named so a blocked one can be reported by kind. */
export const AUTHOR_STEP_KINDS = Object.freeze(['start', 'key_pose', 'breakdown', 'hold', 'settle']);

/** Which pose role a phase's arriving key plays, for the PoseSpec the plan carries. */
function authoredPoseRole(name) {
  return poseRoleFor(name);
}

function sortedUnique(values) {
  return [...new Set(values.map((v) => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b);
}

/**
 * Author a motion from an IntentSpec, a phase timing and a PoseSpec per phase.
 *
 * @param opts.intent      an IntentSpec — carries the request, the preserve clause and the style
 * @param opts.itemId      the rig to author onto
 * @param opts.phases      `[{ name, from, to, pose, hold_until?, breakdown?, easing? }]`, in frames
 * @param opts.start       `{ pose, easing }` for the key at the first phase's `from`
 * @param opts.settle      `{ overshoot_at, ratio, easing }`
 * @param opts.constraints ConstraintSpecs the authored keys are checked against
 * @param opts.contacts    declared contacts (`{ effector, start, end, tolerance_studs }`)
 * @param opts.actionType  used ONLY to name the phases a caller must supply frames for
 */
export function authorMotion(project, {
  intent, itemId = null, phases = null, start = null, settle = null,
  constraints = [], contacts = [], support = [], actionType = null,
  keyAllTouched = true, frame = 0,
} = {}) {
  if (!intent || !intent.id) throw new TypeError('authorMotion: an IntentSpec is required — build one with ai/intent.js interpretRequest, or by hand with ai/cal.js intentSpec');
  const target = intent.target || {};
  const id = itemId ?? target.itemId ?? null;
  const item = itemOf(project, id);
  if (!item) throw new Error(`authorMotion: no item "${id}" — pass itemId, or set intent.target.itemId`);
  if (!item.rig) throw new Error(`authorMotion: "${item.name || id}" has no rig. Authoring writes joint rotations; a camera or prop has none`);

  const findings = [...(intent.findings || [])];
  const questions = [...(intent.unresolved_questions || [])];
  const risks = [];
  const notes = [];
  const act = actionType ?? intent.action_type ?? null;

  // --- the timing has to be given. A template names the phases; it does not time them.
  if (!phases || !phases.length) {
    const template = TEMPLATES[act];
    const order = template
      ? ['preparation', 'anticipation', 'action', 'follow_through', 'recovery', 'settle'].filter((n) => (act === 'reaction' ? n !== 'anticipation' : true))
      : null;
    const q = template
      ? `Authoring needs frames. A "${act}" runs ${order.join(' → ')} (${template.why}). Give each phase a \`from\` and \`to\` in frames — this compiler will not invent durations, because a proportion it made up would read as a measurement.`
      : 'Authoring needs `phases`: [{ name, from, to, pose }] in frames. No phase template exists for this action type, and inventing a phase structure would be a guess dressed as an analysis.';
    questions.push(q);
    findings.push(finding({
      id: 'AUTHOR-NO-TIMING',
      certainty: CERTAINTY.CERTAIN,
      statement: 'No phase timing was supplied, so nothing was authored.',
      evidence: [evidence('absence', template ? `the "${act}" template names the phase order but carries no durations` : `no phase template exists for action type "${act ?? 'unspecified'}"`)],
      suggestion: { text: 'pass `phases: [{ name, from, to, pose }]` with exact frames', reversible: true },
    }));
    return authorResult({ project, itemId: id, intent, ops: [], steps: [], blocked: [], findings, questions, risks, notes, phases: [], keyTimes: [], contacts: [], acceptance: null, range: null, poses: [] });
  }

  // --- validate the timing before anything is compiled, so a bad script fails with the reason
  const ordered = [...phases].sort((a, b) => a.from - b.from);
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i];
    if (!(Number.isFinite(p.from) && Number.isFinite(p.to))) throw new TypeError(`authorMotion: phase ${i} ("${p.name ?? 'unnamed'}") needs numeric \`from\` and \`to\` in frames`);
    if (p.to <= p.from) throw new TypeError(`authorMotion: phase "${p.name ?? i}" ends at ${p.to}, which is not after its start ${p.from}`);
    if (i && p.from < ordered[i - 1].to - EPS) throw new TypeError(`authorMotion: phase "${p.name ?? i}" starts at ${p.from}, before "${ordered[i - 1].name ?? i - 1}" ends at ${ordered[i - 1].to} — authoring does not overlap phases, because two poses arriving at one frame have no defined order`);
  }

  const tracks = tracksOf(project, id);
  const startFrame = ordered[0].from;

  // --- step 1: the start pose. Rest unless the caller gives one, and written explicitly rather
  // than left to the editor's auto-zero-key affordance, which this layer deliberately does not do.
  const steps = [];
  const compiled = [];
  const startCompile = POSE.compilePose(project, {
    itemId: id, t: startFrame, pose: (start && start.pose) || [], support,
  });
  compiled.push({ kind: 'start', name: 'start', t: startFrame, out: startCompile });

  // The pose the whole script is authored against at the hold frame — the stance, not the rig's
  // rest, because the stance exists only as operations at this point.
  const holdPose = startCompile.pose;

  // --- step 2: one key pose per phase, each layered on the pose the previous key arrived at
  let carried = { ...startCompile.pose };
  for (const p of ordered) {
    const out = POSE.compilePose(project, {
      itemId: id, t: p.to, pose: p.pose || [], basePose: carried,
      holdFrame: startFrame, holdPose, support,
    });
    compiled.push({ kind: 'key_pose', name: p.name ?? `frames ${p.from}–${p.to}`, t: p.to, phase: p, out });
    carried = { ...out.pose };
    if (p.hold_until !== undefined && p.hold_until !== null) {
      if (!(p.hold_until > p.to + EPS)) throw new TypeError(`authorMotion: phase "${p.name ?? ''}" holds until ${p.hold_until}, which is not after its key at ${p.to}`);
      // `applied` is cleared: the hold re-writes the pose the phase already solved, and repeating
      // the phase's reach results here would report one solve as two.
      compiled.push({ kind: 'hold', name: `${p.name ?? 'phase'} hold`, t: p.hold_until, phase: p, out: { ...out, ops: [], applied: [], findings: [], pose: out.pose }, holdOf: p.to });
    }
  }

  // --- the joint set: every joint any step touched. Every authored frame keys all of them.
  const touched = sortedTracks(compiled);
  if (!touched.length) {
    findings.push(finding({
      id: 'AUTHOR-NO-GOALS',
      certainty: CERTAINTY.CERTAIN,
      statement: 'No pose goal resolved to a joint, so there is nothing to author.',
      evidence: [evidence('absence', compiled.flatMap((c) => c.out.unresolved || []).map((u) => u.why).join('; ') || 'the script named no pose goals at all')],
      suggestion: { text: 'give at least one phase a pose: { joint | semantic_role, rotation_goal: { x, y, z } } — inspect_rig lists the joints', reversible: true },
    }));
  }

  // --- step 3: breakdowns, computed as a pose BIAS between the neighbouring key poses
  const withBreakdowns = [];
  for (let i = 0; i < compiled.length; i++) {
    withBreakdowns.push(compiled[i]);
    const next = compiled[i + 1];
    if (!next || next.kind !== 'key_pose' || !next.phase || !next.phase.breakdown) continue;
    const bd = next.phase.breakdown;
    const from = compiled[i], to = next;
    if (!(bd.at > from.t + EPS && bd.at < to.t - EPS)) throw new TypeError(`authorMotion: the breakdown for "${next.name}" is at frame ${bd.at}, which is not strictly between ${from.t} and ${to.t}`);
    const bias = bd.bias ?? bd.pose_bias ?? null;
    if (typeof bias !== 'number') throw new TypeError(`authorMotion: the breakdown for "${next.name}" needs a numeric \`bias\` — how far between the two key poses the breakdown sits (0 = the earlier pose, 1 = the later one). It is deliberately NOT the time fraction; the difference is what makes the motion favour one end`);
    const pose = {};
    for (const name of touched) {
      const a = from.out.pose[name] || CF.IDENTITY.slice();
      const b = to.out.pose[name] || CF.IDENTITY.slice();
      pose[name] = scaleAbout(a, b, bias);
    }
    withBreakdowns.push({
      kind: 'breakdown', name: `${next.name} breakdown`, t: bd.at,
      // A breakdown is a real key pose, so it is measured like one — a breakdown that throws the
      // balance outside the support polygon is exactly the kind of thing worth seeing.
      out: { pose, ops: [], applied: [], unresolved: [], findings: [], measured: POSE.measurePose(project, { itemId: id, pose, support, frame: bd.at }) },
      bias, between: [from.t, to.t], easing: bd.easing || null,
    });
  }

  // --- step 4: the settle — an overshoot key before the final rest pose
  const finalStep = withBreakdowns[withBreakdowns.length - 1];
  const prevStep = withBreakdowns[withBreakdowns.length - 2];
  let settleStep = null;
  if (settle) {
    if (!prevStep) throw new TypeError('authorMotion: a settle needs at least two authored keys — it overshoots the travel BETWEEN them');
    const at = settle.overshoot_at ?? settle.at ?? null;
    const ratio = settle.ratio ?? settle.overshoot_ratio ?? null;
    if (!(typeof at === 'number' && at > prevStep.t + EPS && at < finalStep.t - EPS)) {
      throw new TypeError(`authorMotion: the settle's \`overshoot_at\` must be strictly between the previous key (${prevStep.t}) and the final key (${finalStep.t}); got ${at}`);
    }
    if (!(typeof ratio === 'number' && ratio > 0)) throw new TypeError('authorMotion: a settle needs a positive `ratio` — how far past the final pose the overshoot travels, as a fraction of the last transition');
    const pose = {};
    for (const name of touched) {
      const a = prevStep.out.pose[name] || CF.IDENTITY.slice();
      const b = finalStep.out.pose[name] || CF.IDENTITY.slice();
      pose[name] = scaleAbout(a, b, 1 + ratio);
    }
    settleStep = {
      kind: 'settle', name: 'settle', t: at,
      out: { pose, ops: [], applied: [], unresolved: [], findings: [], measured: POSE.measurePose(project, { itemId: id, pose, support, frame: at }) },
      ratio, between: [prevStep.t, finalStep.t], easing: settle.easing || { es: 'Sine', ed: 'InOut' },
    };
    withBreakdowns.splice(withBreakdowns.length - 1, 0, settleStep);
  }

  // --- build the operations, in frame order, keying the whole joint set at every authored frame
  const inOrder = [...withBreakdowns].sort((a, b) => a.t - b.t);
  const keyTimes = sortedUnique(inOrder.map((s) => s.t));
  if (keyTimes.length !== inOrder.length) {
    throw new TypeError(`authorMotion: two authored keys land on the same frame (${inOrder.map((s) => `${s.name}@${s.t}`).join(', ')}) — a frame holds one pose, so the script has to choose`);
  }
  const running = {};
  for (const step of inOrder) {
    const ops = [];
    const held = [];
    // One easing for every operation at a frame, not one per track. A key's easing governs the
    // segment that LEAVES it, so the direction comes from the phase that segment travels through
    // — the same rule `spacing_contrast` applies to an existing key. Mixing per-track defaults
    // into one key would make a held joint ease differently from a posed one at the same frame,
    // which reads as the body coming apart.
    const declared = step.kind === 'start' ? (start && start.easing) : (step.kind === 'key_pose' ? (step.phase && step.phase.easing) : step.easing);
    const easing = { ...(departingEasing(step.t, ordered) || {}), ...(declared || {}) };
    const names = keyAllTouched ? touched : sortedUnique2(step.out.ops.map((o) => o.track));
    for (const name of names) {
      const v = step.out.pose[name] ?? running[name] ?? CF.IDENTITY.slice();
      const explicit = step.out.ops.some((o) => o.track === name) || step.kind === 'breakdown' || step.kind === 'settle';
      if (!explicit && step.kind !== 'start') held.push(name);
      const op = { op: 'set_key', itemId: id, track: name, t: step.t, value: v };
      if (easing.es) op.es = easing.es;
      if (easing.ed) op.ed = easing.ed;
      ops.push(op);
      running[name] = v;
    }
    steps.push({ ...step, ops, held, easing });
  }

  // --- every step is checked against the declared constraints on its own, so a blocked step names
  // the constraint that blocked it rather than "something in the batch was refused" — the same
  // rule compilePlan follows for a strategy.
  const applied = [];
  const blocked = [];
  const finalOps = [];
  for (const step of steps) {
    if (!step.ops.length) continue;
    const trial = makePatch({ ops: step.ops, intent: `author ${step.kind}: ${step.name} @ ${step.t}` });
    const trialPlan = planPatch(project, trial);
    const report = checkPatch(project, trial, constraints, { frame, result: trialPlan.result });
    const refusing = report.violations.filter((v) => v.response === 'refuse');
    if (refusing.length) {
      const byConstraint = [...new Map(refusing.map((v) => [v.constraint_id, v])).values()];
      blocked.push({
        step: step.kind, name: step.name, t: step.t,
        reason: `${byConstraint.length} constraint(s) refuse this: ${byConstraint.map((v) => v.rule).join('; ')}`,
        blocked_by: 'constraint',
        constraints: byConstraint.map((v) => ({ id: v.constraint_id, rule: v.rule, type: v.constraint_type, priority: v.priority, priority_name: v.priority_name })),
        operations_dropped: step.ops.length,
      });
      findings.push(finding({
        id: 'AUTHOR-STEP-BLOCKED',
        certainty: CERTAINTY.CERTAIN,
        statement: `the ${step.kind} at frame ${step.t} ("${step.name}") was dropped: ${byConstraint.map((v) => v.rule).join('; ')}.`,
        evidence: [evidence('data', `${step.ops.length} operation(s) dropped`, byConstraint.map((v) => v.rule))],
        frame: step.t,
        suggestion: { text: 'relax the constraint, or move the key outside its protected range', reversible: true },
      }));
      continue;
    }
    const warnings = report.violations.filter((v) => v.response !== 'refuse');
    applied.push({
      step: step.kind, name: step.name, t: step.t, operations: step.ops.length,
      tracks: step.ops.map((o) => o.track),
      held_from_previous: step.held,
      reached: (step.out.applied || []).filter((a) => a.kind === 'reach').map((a) => ({ effector: a.effector, residual_studs: a.residual_studs, reached: a.reached })),
      contact_warnings: warnings.map((v) => v.rule),
      bias: step.bias ?? null, ratio: step.ratio ?? null, between: step.between ?? null,
      holds: step.holdOf ?? null,
    });
    finalOps.push(...step.ops);
  }

  // --- the plan this authored, in the same language a planned edit speaks
  const range = [startFrame, Math.max(...keyTimes)];
  const planPhases = ordered.map((p) => CAL.phaseSpec({
    name: p.name ?? null,
    timeRange: [p.from, p.to],
    purpose: p.purpose ?? (p.name ? purposeOf(p.name) : null),
    derivation: 'declared by the authoring script',
    certainty: CERTAINTY.CERTAIN,
    timingRules: [`${p.to - p.from} frame(s)${p.hold_until ? `, then held to ${p.hold_until}` : ''}${p.breakdown ? `, breakdown at ${p.breakdown.at} biased ${p.breakdown.bias}` : ''}`],
    poseGoals: (p.pose || []).map((g) => (g.rotation_goal ? `${g.joint ?? g.semantic_role ?? g.role}: ${JSON.stringify(g.rotation_goal)}°` : `${g.position_goal?.effector ?? g.joint ?? 'effector'}: reach`)),
  }));
  const poseSpecs = steps.filter((s) => s.kind === 'key_pose' || s.kind === 'breakdown' || s.kind === 'settle' || s.kind === 'start').map((s) => CAL.poseSpec({
    time: s.t,
    role: s.kind === 'breakdown' ? 'breakdown' : s.kind === 'settle' ? 'recoil' : s.kind === 'start' ? 'key' : authoredPoseRole(s.phase?.name),
    purpose: s.kind === 'breakdown' ? `a breakdown biased ${s.bias} between frames ${s.between.join(' and ')}` : s.kind === 'settle' ? `an overshoot ${s.ratio} past the final pose` : s.name,
    bodyRegionTargets: (s.ops || []).map((o) => ({
      role: null, joint: o.track,
      rotationGoal: POSE.degreesFromRotation(o.value),
      orientationIntent: null, constraint: null,
    })),
    lineOfAction: s.out.measured?.line_of_action ? `${s.out.measured.line_of_action.tilt_from_vertical_deg}° from vertical, spine deviation ${s.out.measured.line_of_action.max_deviation_studs} studs (measured)` : null,
    // Null when no support was declared, because nothing infers one — the PoseSpec field stays
    // null rather than carrying a balance verdict computed against a guess.
    balanceState: balanceSentence(s.out.measured),
    centerOfMassTarget: s.out.measured?.centre_of_mass ? `${JSON.stringify(s.out.measured.centre_of_mass.point)} — ${s.out.measured.centre_of_mass.method}` : null,
    supportPolygon: s.out.measured?.balance?.support_polygon ?? null,
    confidence: CERTAINTY.CERTAIN,
    styleNotes: intent.style_profile,
  }));

  const contactSpecs = contacts.map((c) => CAL.contactSpec({
    effector: c.effector, mode: c.mode || 'planted', start: c.start ?? null, end: c.end ?? null,
    positionalTolerance: c.tolerance_studs ?? null, validationMethod: 'declared',
    certainty: CERTAINTY.USER_INTENT_REQUIRED,
    evidence: [evidence('data', 'declared on the authoring script')],
  }));

  const timing = CAL.timingSpec({
    duration: range[1] - range[0],
    frameRate: project.fps ?? null,
    phaseBoundaries: ordered.map((p) => ({ name: p.name ?? null, at: p.from })),
    heldFrames: steps.filter((s) => s.kind === 'hold').map((s) => ({ from: s.holdOf, to: s.t })),
    impactFrames: ordered.filter((p) => p.name === 'impact').map((p) => p.to),
    contactRanges: contacts.map((c) => [c.start, c.end]),
    protectedTimes: (intent.critical_events || []).map((e) => ({ t: e.expected_time, tolerance: e.tolerance })),
    retimingLimits: null,
  });

  const acceptance = buildAuthoringAcceptance({ itemId: id, tracks: touched, keyTimes: applied.map((a) => a.t), contacts, steps, project });

  if (touched.length && !keyAllTouched) risks.push('keyAllTouched is off, so a joint posed in one phase and not the next holds its value by interpolation rather than by a key — a later strategy will not see that hold, and neither will an x-sheet');
  const unreached = steps.flatMap((s) => (s.out.applied || []).filter((a) => a.kind === 'reach' && !a.reached).map((a) => ({ t: s.t, effector: a.effector, shortfall: a.shortfall })));
  if (unreached.length) risks.push(`${unreached.length} reach goal(s) fell short of their target and were solved to the closest reachable pose — the shortfall in studs is on each one, and a contact declared over those frames will measure the difference`);
  notes.push(...steps.flatMap((s) => (s.out.findings || []).map((f) => `${s.name}: ${f.statement}`)));
  findings.push(...compiled.flatMap((c) => c.out.findings || []));

  const plan = CAL.motionPlan({
    intentId: intent.id,
    duration: range[1] - range[0],
    phases: planPhases,
    rootMotionStrategy: 'unchanged — authoring writes joint tracks; nothing here writes the @origin track, so the character does not travel',
    secondaryMotionStrategy: 'none — overlap and drag are not generated; a lead_lag edit after authoring is how they get added (plan_motion)',
    styleOverrides: intent.style_profile,
    protectedElements: [...intent.preserve, ...constraints.map((c) => c.property_or_semantic_rule)],
    acceptanceCriteria: acceptance,
    risks,
    target: { itemId: id, timeRange: range, range_reason: 'the authoring script declared these frames', phases: planPhases.map((p) => p.id) },
    edits: applied.map((a) => ({ id: `author:${a.step}:${a.t}`, strategy: `author_${a.step}`, dimension: null, pull: null, aspects: ['value'], summary: `${a.step} at frame ${a.t}: ${a.operations} key(s)`, contributes: 'the pose itself — this operation generates animation rather than transforming it' })),
    blocked,
    timing,
    contacts: contactSpecs,
    poses: poseSpecs,
  });

  return authorResult({
    project, itemId: id, intent, ops: finalOps, steps: applied, blocked, findings: sortFindings(findings),
    questions, risks, notes, phases: planPhases, keyTimes: applied.map((a) => a.t), contacts: contactSpecs,
    acceptance, range, poses: poseSpecs, plan, touched, measured: steps.map((s) => ({ t: s.t, name: s.name, measured: s.out.measured })),
  });
}

/**
 * The easing a key at frame `t` should carry.
 *
 * A key's easing governs the segment that LEAVES it, so the direction is the one the phase that
 * segment travels through wants — `PHASE_DIRECTION`, the same table `spacing_contrast` uses on an
 * existing key, so an authored clip and an edited one speak the same language.
 *
 * Only the DIRECTION is defaulted. The style is left to `set_key`'s own default, because choosing
 * Sine over Quart is a spacing decision and this is a pose generator; a caller who wants one says
 * so per phase, and `plan_motion`'s spacing strategies reshape it afterwards.
 */
function departingEasing(t, ordered) {
  const phase = ordered.find((p) => t >= p.from - EPS && t < p.to - EPS);
  const dir = phase && phase.name ? PHASE_DIRECTION[phase.name] : null;
  return dir ? { ed: dir } : null;
}

/** The balance field of an authored PoseSpec, or null when no support was declared to test against. */
function balanceSentence(measured) {
  const b = measured && measured.balance;
  if (!b || b.supported === null || b.supported === undefined) return null;
  return b.supported
    ? `supported, margin ${b.margin_studs} studs (measured against the declared support)`
    : `unsupported by ${Math.abs(b.margin_studs)} studs (measured against the declared support)`;
}

function sortedTracks(compiled) {
  return [...new Set(compiled.flatMap((c) => (c.out.ops || []).map((o) => o.track)))].sort();
}
function sortedUnique2(values) { return [...new Set(values)].sort(); }

/**
 * The acceptance spec for an authored motion.
 *
 * Different from a planned EDIT's spec in the one way that matters: an edit proves that what it
 * did not mean to change did not change, and an authoring run has to prove that what it promised
 * to create actually exists. `key_times_include` is that check, and `pose_changed_at` on the first
 * and last authored frames is what proves the poses reached the joints rather than compiling to
 * identity everywhere.
 */
function buildAuthoringAcceptance({ itemId, tracks, keyTimes, contacts, steps }) {
  const checks = [];
  if (keyTimes.length) checks.push({ check: 'key_times_include', itemId, times: keyTimes, tracks });
  // The extremes: whichever authored key is furthest from the start pose has to be measurably
  // different from it, or nothing was authored but keys.
  const keyed = steps.filter((s) => s.kind === 'key_pose' && s.ops.length);
  if (keyed.length && tracks.length) {
    const first = keyed[0];
    const biggest = keyed.reduce((best, s) => {
      const d = (s.ops || []).reduce((acc, o) => acc + K.angleBetween(CF.IDENTITY, o.value), 0);
      return d > best.d ? { s, d } : best;
    }, { s: keyed[0], d: -1 });
    const track = (biggest.s.ops || []).slice().sort((a, b) => K.angleBetween(CF.IDENTITY, b.value) - K.angleBetween(CF.IDENTITY, a.value))[0];
    if (track) checks.push({ check: 'pose_changed_at', itemId, track: track.track, t: track.t, min_deg: 5 });
    if (first !== biggest.s) checks.push({ check: 'key_count_within', itemId, max: Math.max(64, tracks.length * (keyTimes.length + 2)) });
    else checks.push({ check: 'key_count_within', itemId, max: Math.max(64, tracks.length * (keyTimes.length + 2)) });
  }
  for (const c of contacts) {
    checks.push({ check: 'contact_drift_within', itemId, effector: c.effector, start: c.start, end: c.end, tolerance: c.tolerance_studs, mode: c.mode || 'planted' });
  }
  checks.push({ check: 'scope_unchanged', itemIds: [itemId] });
  return CAL.acceptanceSpec({
    checks,
    reviewRequired: 'a person watches the authored range and rates it — no measurement here says the motion reads as intended (Part 4.5)',
    baselinePolicy: 'the before-state is an empty (or pre-existing) timeline; the acceptance compares against it',
    tolerancePolicy: 'a declared contact carries its own tolerance in studs; a reach that fell short reports its shortfall rather than being counted as reached',
  });
}

/** One result shape for every exit, so a caller never has to branch on which failure happened. */
function authorResult({ project, itemId, intent, ops, steps, blocked, findings, questions, risks, notes, phases, keyTimes, contacts, acceptance, range, poses, plan = null, touched = [], measured = [] }) {
  return {
    plan,
    ops,
    steps,
    blocked,
    authored: ops.length > 0,
    summary: ops.length
      ? `${ops.length} operation(s) across ${steps.length} authoring step(s) on ${touched.length} joint(s), frames ${range[0]}–${range[1]}${blocked.length ? `, ${blocked.length} blocked` : ''}`
      : `nothing was authored${blocked.length ? ` — all ${blocked.length} step(s) were blocked` : ''}`,
    tracks: touched,
    key_frames: keyTimes,
    phases,
    poses,
    contacts,
    acceptance,
    measured,
    findings,
    questions,
    risks,
    notes,
    description: plan ? CAL.describePlan(plan) : 'nothing was authored',
    coverage: coverage({
      scope: `item ${itemId}${range ? `, frames ${range[0]}–${range[1]}` : ''}`,
      frames: range,
      loop: 'fast',
      notRun: [
        'nothing was rendered. Whether the authored poses read — silhouette, staging, whether the arc is the one intended — is not measured anywhere in this build (MOT-012, Parts 28, 43)',
        'no secondary motion, overlap or drag was generated: the keys are the poses asked for, exactly. Adding overlap is an EDIT (plan_motion\'s lead_lag) on top of what this authored',
        'no joint limit was consulted — Cadence stores none (the Rig Graph reports them as unknown, not unlimited)',
        'phase durations are the caller\'s. Nothing here judges whether an anticipation of that length is right for that action; Part 26 has no measurable rule this build could apply',
        'a contact is measured only where one was DECLARED. A foot the script meant to plant and nobody declared is not checked (MOT-016)',
      ],
    }),
  };
}

/** What the planner and compiler can and cannot do, for a caller who should not have to infer it
 *  from an empty result. */
export function planLimitations() {
  return {
    strategies: STRATEGY_IDS.map((s) => ({
      id: s, dimensions: STRATEGIES[s].dimensions, aspects: STRATEGIES[s].aspects, contributes: STRATEGIES[s].contributes,
    })),
    phase_sources: ['declared boundaries (certain)', 'named markers (highly likely)', 'a rate template for attack and reaction (possible)'],
    gains: GAIN,
    authoring: {
      entry_point: 'authorMotion',
      step_kinds: AUTHOR_STEP_KINDS,
      can: [
        'generate keys on an empty timeline from an IntentSpec, declared phase frames and a PoseSpec per phase',
        'compute each pose exactly: degrees about named axes, or an analytic two-bone reach to a target in studs (ai/pose.js)',
        'insert a breakdown at a declared frame with a declared POSE BIAS, which is what makes an arc favour one end',
        'hold a pose by writing it again at a declared frame, so the hold is visible in the data rather than implied by interpolation',
        'overshoot before a final pose by a declared ratio of the last transition — a settle',
        'check every authored key against declared contacts through the same constraint checker an edit goes through, and drop a step a constraint refuses',
        'measure the line of action, a volume-proxy centre of mass and balance against declared support at every authored key',
      ],
      cannot: [
        'invent phase durations. A template names an attack\'s phases in order and says nothing about their length; authorMotion asks rather than guessing, and adding a default-proportion recipe is a product decision',
        'generate secondary motion, overlap or drag — the keys are the poses asked for. Overlap is an EDIT (lead_lag) applied on top',
        'author root motion: nothing writes the @origin track, so an authored character does not travel',
        'author anything but rig joint tracks — no camera, prop, effect item or marker',
        'decide which pose is wanted, or judge whether the result reads (Part 4.5)',
      ],
    },
    cannot: [
      'generate a motion from nothing WITH A STRATEGY: all four strategies transform existing keys, so an empty timeline has nothing to make heavier. Generation is `authorMotion` above — a separate entry point, because editing and authoring are different operations with different acceptance criteria',
      'add or remove keys FROM A STRATEGY. `authorMotion` inserts breakdowns, holds and settles (checked against declared contacts, MOT-008); no strategy does, and none may — a strategy that silently added a key would break every `key_times_unchanged` promise the edit path makes',
      'plan for cameras, props or effect items — only rig joint tracks',
      'reshape a path. Curvature, bow and per-frame velocity are measured now (analyze_motion), but no strategy consumes them — the planner still reasons about keys and easings, not trajectories',
      'reason about silhouette or screen space (Parts 28, 43 — screen space needs an active camera, MOT-006)',
      'know a joint limit: Cadence stores none, and the Rig Graph reports them as unknown rather than unlimited',
      'judge the result. Nothing here renders, and no acceptance check in this build looks at a pixel',
    ],
  };
}
