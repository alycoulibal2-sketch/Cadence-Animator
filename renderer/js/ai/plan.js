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
// What this module deliberately does NOT do: it never renders, never measures a contact, and never
// judges whether the result is good. Those are Phases 4, 5 and 7, and every plan says so in its
// own `coverage.notRun`.

import * as CF from '../cf.js';
import { paramsFor } from '../easing.js';
import * as K from './kinematics.js';
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
    'phases are cut at keyframe times and rated by average angular travel per frame — there is no per-frame velocity, acceleration or jerk profile until Part 23 (Phase 5)',
    'no contact, foot-plant or ground relationship informs these boundaries (Phase 5)',
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
          if (info && ROLES.isContactCapable(info.partRole)) {
            skipped.push({ track: name, why: `"${info.partRole}" can hold a contact, and an overshoot on a planted effector breaks the plant. Contact drift is unmeasurable until Part 23, so this is skipped rather than risked` });
            continue;
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
    roleOf[n] = { role: jr.role, side: jr.side, depth: ROLES.chainDepth(jr.role), partRole: pr?.role ?? null, certainty: jr.certainty };
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
    risks.push(`${contacts.length} declared contact(s) are protected by constraint and NOT verified — contact drift is unmeasurable until Part 23 (Phase 5)`);
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
        'nothing was rendered: whether the planned change reads as intended is unanswered until Part 43 (Phase 4)',
        'no contact was measured (Part 23 — Phase 5)',
        'no arc, silhouette or screen-space check was run (Parts 28, 43)',
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
    baselinePolicy: 'the state immediately before the patch is the comparison point; no approved baseline exists until Phase 4',
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

/** What the planner and compiler can and cannot do, for a caller who should not have to infer it
 *  from an empty result. */
export function planLimitations() {
  return {
    strategies: STRATEGY_IDS.map((s) => ({
      id: s, dimensions: STRATEGIES[s].dimensions, aspects: STRATEGIES[s].aspects, contributes: STRATEGIES[s].contributes,
    })),
    phase_sources: ['declared boundaries (certain)', 'named markers (highly likely)', 'a rate template for attack and reaction (possible)'],
    gains: GAIN,
    cannot: [
      'generate a motion from nothing — every strategy edits existing keys, so an empty timeline has nothing to make heavier',
      'add or remove keys: holds, added settles and inserted breakdowns all need the contact model (Part 23, Phase 5) to be inserted safely',
      'plan for cameras, props or effect items — only rig joint tracks',
      'reason about arcs, silhouette, screen space or contact drift',
      'know a joint limit: Cadence stores none, and the Rig Graph reports them as unknown rather than unlimited',
      'judge the result. Nothing here renders, and no acceptance check in this build looks at a pixel',
    ],
  };
}
