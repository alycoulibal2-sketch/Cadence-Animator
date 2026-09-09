// Controlled experiments and multi-candidate comparison (directive Part 48).
//
// This is Phase 7's keystone, because Part 62's success condition for the phase is exactly what
// this file does: *"Cadence can compare bounded alternatives and justify a recommendation."*
//
// Part 48 opens with the problem: *"Do not make broad, untraceable edits when the right correction
// is uncertain."* The answer is not "try something and see" — it is a set of NAMED candidates, each
// of which declares what it changes, what it must not disturb, and how it will be judged, compared
// on dimensions that are measured rather than asserted.
//
// Five decisions shape the file.
//
// 1. **Comparing candidates never mutates anything.** Each candidate is planned with
//    `ai/patch.js planPatch`, which runs the ops against a CLONE and hands back the resulting
//    project. So a comparison of four candidates touches the real project zero times, and
//    "bounded and reversible" is true by construction rather than by discipline. Nothing here
//    applies a candidate; choosing one is a separate, ordinary transaction.
//
// 2. **Protected variables are enforced through the constraint system, not a new mechanism.**
//    `protect` compiles to real ConstraintSpecs and every candidate is checked against them with
//    the same `checkPatch` the apply path uses. A candidate that would disturb a protected
//    variable is therefore REFUSED, not annotated — which is the difference between a declaration
//    and a guarantee.
//
// 3. **Superficiality is tested where it can be, and reported where it cannot.** Part 48 forbids
//    "superficial random parameter changes". Two things are decidable: a candidate with no
//    hypothesis is refused, and two candidates that produce an identical result hash are the same
//    experiment wearing two names. What is NOT decidable is whether two candidates that move the
//    same variable are meaningfully different — Part 48's own example set has "anticipation plus
//    10 percent" and "anticipation plus four frames", which move one variable in two units and are
//    plainly both legitimate. So that case is reported for a human to judge, never refused.
//
// 4. **A recommendation is justified from measured dimensions only, or it is withheld.** Of Part
//    48's eight comparison dimensions, five can be measured here and three cannot (see
//    `COMPARISON_DIMENSIONS`). When the measured five do not separate the candidates, this returns
//    no winner and the question a human has to answer. A recommendation with nothing behind it is
//    the failure mode Part 48 exists to prevent, so it is better to have none.
//
// 5. **The comparison is between candidates, not against perfection.** Every candidate can be bad.
//    `recommend` reports the best of the set and says so in those words, and separately reports
//    whether the winner is acceptable in absolute terms when an AcceptanceSpec was supplied.
//
// Pure at load like the rest of `ai/`.

import { contentHash, shortHash } from './hash.js';
import { CERTAINTY, evidence, finding, coverage } from './certainty.js';
import { makePatch, planPatch, describeOp } from './patch.js';
import * as constraints from './constraints.js';
import * as scope from './scope.js';
import * as motion from './motion.js';
import * as cal from './cal.js';
import * as modes from './modes.js';

/**
 * Part 48's required declarations, verbatim, and whether this layer requires each one.
 *
 * The four marked `required: true` are the ones without which a candidate cannot be judged at all:
 * with no hypothesis there is nothing to test, and with no ops there is no candidate. The rest are
 * recorded and reported; a missing one weakens the comparison and is named in the result rather
 * than blocking it.
 */
export const EXPERIMENT_FIELDS = Object.freeze({
  name: { required: true, note: 'a short label — Part 48 names its examples "Experiment A" … "Experiment D"' },
  hypothesis: { required: true, note: 'what this candidate claims will improve, and why. Part 48: each candidate must be "a meaningful creative or technical hypothesis"' },
  ops: { required: true, note: 'the changed variables, as real patch operations — this is what makes the candidate comparable rather than described' },
  changed_variables: { required: false, note: 'derived from the ops when omitted, so it can never disagree with them' },
  protected_variables: { required: false, note: 'inherited from the experiment set; a candidate may add its own' },
  target_frames: { required: false, note: 'derived from the ops when omitted' },
  expected_effect: { required: false, note: 'what the animator should SEE if the hypothesis holds. Not measurable here; carried for the human review step' },
  metric: { required: false, note: 'how this candidate should be judged. Falls back to the set-wide acceptance criteria' },
  render_configuration: { required: false, note: 'recorded and passed through — this layer renders nothing (Part 43/44 tools do)' },
  rollback_reference: { required: false, note: 'derived: the pre-experiment state hash plus the inverse patch the plan computed' },
});

/**
 * Part 48's eight comparison dimensions, and what each one honestly is here.
 *
 * Rule 5 of `CLAUDE.md`: an unimplemented check is reported, never counted as satisfied. Three of
 * these can never be measured by this layer — two of them because they are definitionally the
 * user's, and one because nothing has been ingested to compare against.
 */
export const COMPARISON_DIMENSIONS = Object.freeze({
  constraint_compliance: {
    measured: true,
    how: 'ai/constraints.js checkPatch against the set-wide protected variables and every persisted lock — the same call the apply path makes',
    decides: true,
  },
  regression_risk: {
    measured: true,
    how: 'ai/scope.js analyseScope — breadth, dependent objects, and whether the edit reaches a protected or event-bearing frame range',
    decides: true,
  },
  motion_analysis: {
    measured: true,
    how: 'ai/motion.js sampled on each candidate\'s PLANNED result — peak speed, acceleration, jerk and path length over the frames the edit can reach',
    decides: false,
    note: 'measured and reported, but it does NOT vote on its own, because a number is neither better nor worse without a declared target direction: "snappier" wants a higher peak speed and "heavier" wants more deceleration contrast, and the same measurement serves both. The way motion DOES decide is through intent_alignment — an acceptance check encodes the direction, which is how the candidate that broke a planted foot lost in this module\'s own test.',
  },
  intent_alignment: {
    measured: true,
    how: 'ai/cal.js evaluateAcceptance against the AcceptanceSpec the set declares, before vs after, per candidate',
    decides: true,
    note: 'only when the set supplies acceptance criteria; without them this reports not_run rather than passing',
  },
  performance_cost: {
    measured: true,
    how: 'keyframe count delta, and for a created emitter its particle-pool cap',
    decides: false,
    note: 'a real but narrow proxy. It does NOT measure render cost, draw calls or Roblox-side evaluation cost, and it is not weighted into the recommendation for that reason',
  },
  visual_analysis: {
    measured: false,
    why: 'this layer renders nothing. The passes exist (Part 43/44) but they measure an APPLIED state — comparing candidates visually would mean applying each one, which is what Part 48 exists to avoid. Apply the chosen candidate, then explain_change against the baseline.',
    decides: false,
  },
  reference_alignment: {
    measured: false,
    why: 'nothing has been ingested to align against. Part 48 marks this dimension "if applicable"; it is never applicable yet (REF-* rows are Phase 8).',
    decides: false,
  },
  user_preference: {
    measured: false,
    why: 'definitionally the user\'s. Reported as an open question, never inferred from the measured dimensions — inferring it would be this layer voting twice.',
    decides: false,
  },
  human_review: {
    measured: false,
    why: 'definitionally the user\'s. Part 48 lists it as a comparison dimension, so it is carried as a required step rather than dropped.',
    decides: false,
  },
});

export const EXPERIMENT_LIMITATIONS = Object.freeze([
  'Comparing candidates applies nothing. Every measurement is taken on a planned result, so anything that can only be measured on an applied state (rendered pixels, the Studio bridge, export) is out of reach by design.',
  'Candidates are compared against each other, not against a standard. The winner is the best of the set; whether it is GOOD is a separate question, answered only when the set declares acceptance criteria.',
  '5 of Part 48\'s 8 comparison dimensions are measured and 3 are not — two are definitionally the user\'s and one has nothing to compare against. `COMPARISON_DIMENSIONS` gives the reason for each.',
  'Whether two candidates are meaningfully different is only partly decidable: identical result hashes are caught, but two candidates moving the same variable in different units are legitimate (Part 48\'s own example set does this) and are reported for a human to judge.',
  'Motion is measured per candidate but does not vote. A raw peak speed is not good or bad without a declared target direction; put the direction into the acceptance criteria for the set and it decides through intent_alignment.',
  'A candidate is excluded by ANY violation of a declared protection, which is stricter than the apply path: a warn-level constraint lets a direct edit proceed, because a human asked for that edit specifically. The protections declared for an experiment are its boundary, so stepping outside them disqualifies a candidate rather than warning about it.',
  'An experiment set is not persisted. It is computed, compared and returned; the durable record of what was tried is the provenance graph, written when a candidate is APPLIED.',
]);

// ---------------------------------------------------------------- building a set

/**
 * Normalise and validate one candidate.
 *
 * Returns `{ ok, candidate, findings }`. A candidate that cannot be judged is refused here rather
 * than producing a comparison row with holes in it.
 */
export function experimentSpec(raw = {}, { index = 0 } = {}) {
  const findings = [];
  const fail = (id, statement, suggestion = null) => findings.push(finding({
    id, certainty: CERTAINTY.CERTAIN, statement, evidence: [evidence('data', 'the candidate as supplied', { index })], suggestion,
  }));

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : null;
  if (!name) fail('EXPT-NAME-MISSING', `candidate ${index} has no name — Part 48's experiments are NAMED so a person can refer to one`);

  const hypothesis = typeof raw.hypothesis === 'string' && raw.hypothesis.trim() ? raw.hypothesis.trim() : null;
  if (!hypothesis) {
    fail('EXPT-HYPOTHESIS-MISSING',
      `candidate ${name || index} has no hypothesis — Part 48 requires each candidate to be "a meaningful creative or technical hypothesis", and a parameter change with no stated claim is exactly the superficial variant it forbids`,
      { text: 'state what this candidate claims will improve, and why', reversible: true });
  }

  const ops = Array.isArray(raw.ops) ? raw.ops : null;
  if (!ops || !ops.length) fail('EXPT-OPS-MISSING', `candidate ${name || index} has no operations, so there is nothing to compare`);

  if (findings.length) return { ok: false, candidate: null, findings };

  return {
    ok: true,
    findings,
    candidate: {
      name,
      hypothesis,
      ops,
      expected_effect: raw.expected_effect ?? raw.expectedEffect ?? null,
      metric: raw.metric ?? null,
      render_configuration: raw.render_configuration ?? raw.renderConfiguration ?? null,
      protected_variables: [...(raw.protected_variables ?? raw.protect ?? [])],
    },
  };
}

// ---------------------------------------------------------------- comparing

/**
 * Compare a bounded set of candidates and justify a recommendation.
 *
 * @param project              the real project. It is NOT modified.
 * @param set.name             a label for the whole set
 * @param set.candidates       the candidates (see `experimentSpec`)
 * @param set.protect          protected variables for the whole set — a constraint request in the
 *                             closed grammar, exactly as the patch tools take it
 * @param set.acceptance       an AcceptanceSpec, or the shape `cal.acceptanceSpec` takes
 * @param set.itemId           the item the experiment is about, for motion measurement
 * @param set.intent           the request this set came from, carried through
 * @param opts.frame           the frame constraints are evaluated at
 */
export function compareExperiments(project, set = {}, { frame = 0, mode = 'experiment', discipline = modes.DEFAULT_DISCIPLINE } = {}) {
  const findings = [];
  const auth = modes.authorise({ mutates: false, name: 'compare_experiments' }, { mode, discipline });

  const rawCandidates = Array.isArray(set.candidates) ? set.candidates : [];
  if (rawCandidates.length < 2) {
    return refuse(`an experiment set needs at least two candidates to compare — Part 48 is about choosing between bounded alternatives, and one alternative is just an edit`, { auth });
  }

  // Protected variables become real constraints, so "protected" is enforced rather than declared.
  const compiled = constraints.compileConstraints(set.protect ? (typeof set.protect === 'string' ? { text: set.protect } : set.protect) : { constraints: [] }, project);
  if (compiled.unparsed?.length) {
    findings.push(finding({
      id: 'EXPT-PROTECTION-UNPARSED',
      certainty: CERTAINTY.CERTAIN,
      statement: `${compiled.unparsed.length} protected-variable line(s) were not understood, so they protect nothing — a protection nobody parsed is a protection nobody applied`,
      evidence: [evidence('data', 'unparsed protection lines', { lines: compiled.unparsed })],
      suggestion: { text: 'inspect_constraints lists the grammar the compiler accepts', reversible: true },
    }));
  }

  const acceptance = set.acceptance
    ? (Array.isArray(set.acceptance) ? cal.acceptanceSpec({ checks: set.acceptance }) : cal.acceptanceSpec(set.acceptance))
    : null;

  const baseHash = contentHash(project);
  const rows = [];
  const rejected = [];

  for (let i = 0; i < rawCandidates.length; i++) {
    const built = experimentSpec(rawCandidates[i], { index: i });
    if (!built.ok) { rejected.push({ index: i, name: rawCandidates[i]?.name ?? null, findings: built.findings }); continue; }
    const c = built.candidate;

    let patch, plan;
    try {
      patch = makePatch({ ops: c.ops, intent: `${set.name || 'experiment'} / ${c.name}: ${c.hypothesis}`, author: 'ai' });
      plan = planPatch(project, patch);
    } catch (e) {
      // A malformed op is a rejected candidate, not a failed comparison. The other candidates are
      // still worth comparing, and the reason this one is out has to survive into the result.
      rejected.push({
        index: i, name: c.name,
        findings: [finding({
          id: 'EXPT-OPS-INVALID', certainty: CERTAINTY.CERTAIN,
          statement: `candidate "${c.name}" could not be built into a patch: ${e.message}`,
          evidence: [evidence('data', 'makePatch/planPatch rejected the operations')],
        })],
      });
      continue;
    }

    const candidateProtect = [...compiled.constraints];
    if (c.protected_variables.length) {
      const own = constraints.compileConstraints({ constraints: c.protected_variables.map((p) => (typeof p === 'string' ? { protect: p, reason: `protected by candidate ${c.name}` } : p)) }, project);
      candidateProtect.push(...own.constraints);
    }
    const report = constraints.checkPatch(project, patch, candidateProtect, { frame, result: plan.result });
    const scopeReport = scope.analyseScope(project, plan, { constraints: candidateProtect, frame });

    rows.push({
      name: c.name,
      hypothesis: c.hypothesis,
      // Derived rather than restated, so a declaration can never disagree with the operations.
      changed_variables: [...new Set((plan.ops || []).filter((r) => r.effect !== 'no_op').map((r) => describeOp(r.op)))],
      target_frames: plan.changed_frame_range,
      protected_variables: candidateProtect.map((k) => k.id ?? k.protect ?? 'constraint'),
      expected_effect: c.expected_effect,
      metric: c.metric ?? (acceptance ? `the set-wide acceptance criteria (${cal.checksOf(acceptance).length} check(s))` : null),
      render_configuration: c.render_configuration,
      // Part 48's "rollback reference". Nothing was applied, so the reference is what WOULD undo
      // it: the pre-experiment state and the inverse the plan already computed.
      rollback_reference: {
        pre_experiment_state: shortHash(baseHash),
        inverse_available: !!plan.inverse,
        inverse_ops: plan.inverse ? plan.inverse.ops.length : 0,
        note: 'nothing has been applied; this is the reference a commit of this candidate would roll back to',
      },
      applicable: plan.applicable,
      result_hash: plan.result_hash,
      measurements: measure(project, plan, report, scopeReport, acceptance, set.itemId ?? inferItem(plan)),
      plan_summary: plan.summary,
      problems: plan.problems,
      warnings: plan.warnings,
    });
  }

  if (rows.length < 2) {
    return refuse(
      rows.length
        ? `only 1 of ${rawCandidates.length} candidate(s) survived validation, so there is nothing to compare against`
        : `no candidate survived validation`,
      { auth, rejected, findings });
  }

  const distinct = checkDistinctness(rows);
  findings.push(...distinct.findings);

  const rec = recommend(rows, { acceptance });
  findings.push(...rec.findings);

  return {
    ok: true,
    set: set.name ?? null,
    intent: set.intent ?? null,
    mode: auth.mode,
    discipline: auth.discipline,
    active_mode: auth.active,
    candidates: rows,
    rejected,
    distinctness: distinct.report,
    recommendation: rec.recommendation,
    dimensions: COMPARISON_DIMENSIONS,
    fields: EXPERIMENT_FIELDS,
    required_human_steps: [
      'user_preference — Part 48 lists it as a comparison dimension and it is not inferable from any measurement here',
      'human_review — the candidates have not been looked at; apply the chosen one and run explain_change against a baseline to see it',
    ],
    findings,
    applied: false,
    next: rec.recommendation.candidate
      ? `nothing has been applied. To take "${rec.recommendation.candidate}", pass its ops to apply_animation_patch (or preview_animation_patch first); the comparison itself changed nothing.`
      : 'nothing has been applied, and the measured dimensions do not choose between these candidates — see recommendation.question',
    coverage: coverage({
      scope: `${rows.length} candidate(s) planned on a clone and measured; ${Object.values(COMPARISON_DIMENSIONS).filter((d) => d.measured).length} of ${Object.keys(COMPARISON_DIMENSIONS).length} Part 48 dimensions measured${acceptance ? `, against ${cal.checksOf(acceptance).length} acceptance check(s)` : ', with no acceptance criteria declared'}`,
      frames: null,
      loop: 'fast',
      notRun: Object.entries(COMPARISON_DIMENSIONS).filter(([, d]) => !d.measured).map(([k, d]) => `${k} — ${d.why}`),
    }),
    limitations: EXPERIMENT_LIMITATIONS,
  };

  function refuse(reason, extra = {}) {
    return {
      ok: false, set: set.name ?? null, reason, candidates: [], recommendation: null,
      dimensions: COMPARISON_DIMENSIONS, fields: EXPERIMENT_FIELDS, applied: false,
      limitations: EXPERIMENT_LIMITATIONS, findings: extra.findings ?? [], rejected: extra.rejected ?? [],
      mode: extra.auth?.mode ?? null, discipline: extra.auth?.discipline ?? null,
    };
  }
}

/** The item a plan is about, when the caller did not say. Used only to aim the motion
 *  measurement; a plan touching several items measures none, and says so. */
function inferItem(plan) {
  const items = new Set((plan.ops || []).filter((r) => r.effect !== 'no_op').map((r) => r.op.itemId ?? r.op.item?.id).filter(Boolean));
  return items.size === 1 ? [...items][0] : null;
}

/**
 * The frames a candidate's edit can actually change the motion over.
 *
 * A `set_key` at frame 8 alters the interpolated pose from the previous key to the next one, so
 * measuring only frame 8 measures a single sample and reports a peak speed of 0 for every
 * candidate. This widens the changed range to the nearest key on either side, per affected track,
 * which is exactly the interval the edit can reach.
 */
function propagationWindow(plan, itemId) {
  const range = plan.changed_frame_range;
  if (!range || !itemId) return range;
  const tracks = plan.result?.tracks?.[itemId] || {};
  const touched = new Set((plan.ops || [])
    .filter((r) => r.effect !== 'no_op' && r.op.itemId === itemId && r.op.track)
    .map((r) => r.op.track));

  let start = range.start, end = range.end;
  for (const name of touched) {
    const times = (tracks[name]?.keys || []).map((k) => k.t).filter(Number.isFinite).sort((a, b) => a - b);
    // STRICTLY outside the changed range. The edited key usually sits exactly on `range.start`, so
    // a `<=` here matches that key itself and the window never widens — which is what made every
    // candidate report a peak speed of 0.
    const before = [...times].reverse().find((t) => t < range.start);
    const after = times.find((t) => t > range.end);
    if (before !== undefined) start = Math.min(start, before);
    if (after !== undefined) end = Math.max(end, after);
  }
  return { start, end };
}

/** The measured half of Part 48's dimension list, per candidate. */
function measure(project, plan, report, scopeReport, acceptance, itemId) {
  const out = {};

  out.constraint_compliance = {
    measured: true,
    allowed: report.allowed,
    violations: report.violations.length,
    highest_priority_violated: report.violations.length ? report.violations[0].priority : null,
    detail: report.violations.map((v) => v.reason),
  };

  out.regression_risk = {
    measured: true,
    // `analyseScope().breadth` is an object carrying the verdict, the counts, the thresholds and a
    // finding. Only the verdict orders candidates; the rest is why, and belongs in `breadth_detail`
    // rather than inlined into every ranked row.
    breadth: scopeReport.breadth?.verdict ?? null,
    breadth_detail: scopeReport.breadth,
    dependent_objects: scopeReport.dependent_objects.length,
    dependent_effect_emitters: scopeReport.dependent_effect_emitters.length,
    events_touched: scopeReport.event_implications?.overlapping?.length ?? 0,
    frames: scopeReport.target_time_range,
  };

  const range = propagationWindow(plan, itemId);
  if (itemId && range && range.end > range.start) {
    // Measured on the PLANNED result — the whole point of planning on a clone is that a candidate
    // can be measured without existing.
    try {
      const m = motion.sampleMotion(plan.result, { itemId, frameRange: [range.start, range.end], step: 1 });
      const worst = (m.subjects || []).reduce((a, s) => (s.summary?.peak_speed > (a?.summary?.peak_speed ?? -Infinity) ? s : a), null);
      out.motion_analysis = {
        measured: true,
        subjects: (m.subjects || []).length,
        peak_speed: worst?.summary?.peak_speed ?? null,
        peak_speed_part: worst?.part_id ?? null,
        peak_jerk: Math.max(0, ...(worst?.samples || []).map((s) => Math.abs(s.jerk ?? 0))),
        path_length_studs: worst?.summary?.path_length_studs ?? null,
        sampled_frames: [range.start, range.end],
        window_note: 'the sampled window is the changed frames widened to the neighbouring keys on each affected track, because a key edit changes the motion BETWEEN its neighbours, not only on its own frame',
      };
    } catch (e) {
      out.motion_analysis = { measured: false, why: `the motion sample failed on this candidate: ${e.message}` };
    }
  } else {
    out.motion_analysis = {
      measured: false,
      why: !itemId
        ? 'the candidate touches more than one item and none was named, so the measurement has no single subject'
        : 'the candidate changes no frames, or its affected tracks have no neighbouring keys to widen to, so there is no interval over which motion exists',
    };
  }

  out.intent_alignment = acceptance
    ? (() => {
      const acc = cal.evaluateAcceptance(project, plan.result, acceptance, { itemId });
      return {
        measured: true,
        accepted: acc.accepted,
        fully_validated: acc.fully_validated,
        passed: acc.results.filter((r) => r.status === 'pass').length,
        failed: acc.results.filter((r) => r.status === 'fail').length,
        not_run: acc.results.filter((r) => r.status === 'not_run').length,
        detail: acc.results.map((r) => ({ check: r.check, status: r.status, reason: r.reason ?? null })),
      };
    })()
    : { measured: false, why: 'the experiment set declared no acceptance criteria, so there is nothing to align against. This is NOT a pass.' };

  const keyDelta = (plan.diff?.tracks || []).reduce((n, t) => n
    + ((t.keys_added?.length || 0) - (t.keys_removed?.length || 0)), 0);
  const createdEmitters = (plan.ops || []).filter((r) => r.op.op === 'add_item' && r.op.item?.kind === 'vfx');
  out.performance_cost = {
    measured: true,
    keyframes_delta: keyDelta,
    items_added: (plan.diff?.items?.added || []).length,
    particle_cap_added: createdEmitters.reduce((n, r) => n + (r.op.item.emitter?.maxParticles ?? 0), 0),
    note: 'a narrow proxy — no render cost, draw calls or Roblox-side evaluation cost is measured, and this dimension does not vote',
  };

  for (const [k, d] of Object.entries(COMPARISON_DIMENSIONS)) {
    if (!d.measured && !out[k]) out[k] = { measured: false, why: d.why };
  }
  return out;
}

/**
 * Are these candidates actually different experiments?
 *
 * Part 48: *"Do not generate variants that are superficial random parameter changes."* What is
 * decidable is stated in decision 3 of this file's header.
 */
function checkDistinctness(rows) {
  const findings = [];
  const byHash = new Map();
  for (const r of rows) {
    if (!byHash.has(r.result_hash)) byHash.set(r.result_hash, []);
    byHash.get(r.result_hash).push(r.name);
  }
  const duplicates = [...byHash.values()].filter((names) => names.length > 1);
  for (const names of duplicates) {
    findings.push(finding({
      id: 'EXPT-CANDIDATES-IDENTICAL',
      certainty: CERTAINTY.CERTAIN,
      statement: `${names.join(' and ')} produce byte-identical results, so they are one experiment under ${names.length} names`,
      evidence: [evidence('measurement', 'the planned result hashes match exactly', { candidates: names })],
      suggestion: { text: 'drop all but one, or change what actually differs between them', reversible: true },
    }));
  }

  // Same variables, different magnitudes. Reported, never refused — Part 48's own example set does
  // this deliberately ("anticipation plus 10 percent" vs "anticipation plus four frames").
  const byVars = new Map();
  for (const r of rows) {
    const k = JSON.stringify([...r.changed_variables].sort());
    if (!byVars.has(k)) byVars.set(k, []);
    byVars.get(k).push(r.name);
  }
  const sameVars = [...byVars.entries()].filter(([, names]) => names.length > 1);
  for (const [, names] of sameVars) {
    findings.push(finding({
      id: 'EXPT-SAME-VARIABLES',
      certainty: CERTAINTY.POSSIBLE,
      statement: `${names.join(' and ')} change the same variables in different amounts — that is legitimate when the hypotheses genuinely differ (Part 48's own example set does exactly this), and superficial when they do not`,
      evidence: [evidence('data', 'the candidates resolve to the same changed-variable set', { candidates: names })],
      suggestion: { text: 'a human decides this one: check that each hypothesis claims something different', reversible: true },
    }));
  }

  return {
    findings,
    report: {
      distinct_results: byHash.size,
      candidates: rows.length,
      identical_groups: duplicates,
      same_variable_groups: sameVars.map(([, names]) => names),
      all_distinct: byHash.size === rows.length,
    },
  };
}

/**
 * Choose, and say why — or decline to choose, and say what would settle it.
 *
 * The order below is not a weighting to be tuned; it is a lexicographic ladder, and it is the
 * quality hierarchy of Part 14 applied to this decision: a candidate that violates a constraint is
 * out regardless of how good it looks, and a candidate that fails acceptance is behind one that
 * passes regardless of its regression breadth.
 */
export function recommend(rows, { acceptance = null } = {}) {
  const findings = [];
  // ANY violation of a declared protection excludes a candidate, which is deliberately STRICTER
  // than the apply path. A contact constraint compiles to `warn` priority, so `report.allowed`
  // stays true and `apply_animation_patch` would proceed with a warning — correct there, because a
  // human asked for that specific edit. Here the protections were declared as the boundary of the
  // experiment, and a candidate that steps outside it is not a bounded alternative at all. The
  // violation is reported either way; what changes is whether it can win.
  const viable = rows.filter((r) => r.applicable && r.measurements.constraint_compliance.violations === 0);
  const blocked = rows.filter((r) => !viable.includes(r));

  for (const r of blocked) {
    findings.push(finding({
      id: 'EXPT-CANDIDATE-BLOCKED',
      certainty: CERTAINTY.CERTAIN,
      statement: `"${r.name}" is out: ${r.applicable
        ? `it violates ${r.measurements.constraint_compliance.violations} declared protection(s) — ${r.measurements.constraint_compliance.detail.join('; ')}${r.measurements.constraint_compliance.allowed ? ' (the constraint only warns, so applying this directly would be permitted; it is excluded here because the protections are the boundary of the experiment)' : ''}`
        : `the patch would not apply — ${r.plan_summary}`}`,
      evidence: [evidence('measurement', 'constraint check on the planned result', { violations: r.measurements.constraint_compliance.violations })],
      target: r.name,
    }));
  }

  if (!viable.length) {
    return {
      findings,
      recommendation: {
        candidate: null,
        justification: 'every candidate is either inapplicable or violates a protected variable, so there is nothing to recommend',
        question: 'relax a protection deliberately, or propose candidates that respect it — which of those is right is a decision about intent, not a measurement',
        ranked: [],
        decided_by: [],
      },
    };
  }

  const scored = viable.map((r) => {
    const ia = r.measurements.intent_alignment;
    const rr = r.measurements.regression_risk;
    return {
      row: r,
      accepted: ia.measured ? !!ia.accepted : null,
      failed_checks: ia.measured ? ia.failed : null,
      breadth_rank: BREADTH_ORDER[rr.breadth] ?? 99,
      dependents: rr.dependent_objects + rr.dependent_effect_emitters,
    };
  });

  // The ladder. Each rung is only consulted when the one above it ties.
  const ranked = [...scored].sort((a, b) => {
    if (a.accepted !== b.accepted) {
      if (a.accepted === true) return -1;
      if (b.accepted === true) return 1;
      if (a.accepted === null) return 1;
      if (b.accepted === null) return -1;
    }
    if ((a.failed_checks ?? 0) !== (b.failed_checks ?? 0)) return (a.failed_checks ?? 0) - (b.failed_checks ?? 0);
    if (a.breadth_rank !== b.breadth_rank) return a.breadth_rank - b.breadth_rank;
    if (a.dependents !== b.dependents) return a.dependents - b.dependents;
    return 0;
  });

  const best = ranked[0];
  const runnerUp = ranked[1] ?? null;
  const decidedBy = [];
  if (best.accepted !== null) decidedBy.push('intent_alignment (the acceptance criteria the set declared)');
  if (runnerUp && best.breadth_rank !== runnerUp.breadth_rank) decidedBy.push('regression_risk (the narrower edit wins a tie)');
  if (runnerUp && best.dependents !== runnerUp.dependents) decidedBy.push('regression_risk (fewer dependent objects)');

  // A tie on every measured dimension is the case Part 48's success condition most needs handled
  // honestly: recommending one anyway would be a preference dressed as a measurement.
  const tied = runnerUp
    && best.accepted === runnerUp.accepted
    && (best.failed_checks ?? 0) === (runnerUp.failed_checks ?? 0)
    && best.breadth_rank === runnerUp.breadth_rank
    && best.dependents === runnerUp.dependents;

  if (tied) {
    const names = ranked.filter((s) => s.breadth_rank === best.breadth_rank && s.dependents === best.dependents && s.accepted === best.accepted).map((s) => s.row.name);
    findings.push(finding({
      id: 'EXPT-NO-MEASURED-WINNER',
      certainty: CERTAINTY.USER_INTENT_REQUIRED,
      statement: `${names.join(', ')} are indistinguishable on every dimension this layer can measure — the choice between them is artistic, and nothing here should make it`,
      evidence: [
        evidence('measurement', 'the measured dimensions tie', { candidates: names }),
        evidence('absence', 'the dimensions that would separate them are not measurable here', { dimensions: Object.entries(COMPARISON_DIMENSIONS).filter(([, d]) => !d.measured).map(([k]) => k) }),
      ],
      suggestion: { text: 'apply one, create_baseline, apply another and explain_change — or look at them', reversible: true },
    }));
    return {
      findings,
      recommendation: {
        candidate: null,
        tied_candidates: names,
        justification: `${names.length} candidates are equal on constraint compliance, intent alignment and regression risk${acceptance ? '' : ', and no acceptance criteria were declared to separate them'}`,
        question: `Which of ${names.join(', ')} reads better? The measured dimensions do not choose, and ${acceptance ? 'the remaining dimensions are visual and preferential' : 'declaring acceptance criteria for the set would let intent_alignment decide it'}.`,
        ranked: ranked.map(summariseRank),
        decided_by: [],
        not_decided_by: Object.entries(COMPARISON_DIMENSIONS).filter(([, d]) => !d.measured).map(([k]) => k),
        confidence: CERTAINTY.USER_INTENT_REQUIRED,
        caveat: 'this is a comparison between these candidates, not a judgement that any of them is good. Nobody has looked at them: no candidate was rendered or applied.',
        requires_user_approval: true,
      },
    };
  }

  const justification = [
    `"${best.row.name}" is the best of ${rows.length} candidate(s) on the dimensions that can be measured`,
    best.accepted === true ? 'it meets the declared acceptance criteria' : best.accepted === false ? `it fails ${best.failed_checks} acceptance check(s), fewer than any other viable candidate` : 'no acceptance criteria were declared, so intent alignment did not vote',
    `its edit is ${best.row.measurements.regression_risk.breadth} in breadth with ${best.dependents} dependent object(s)`,
    blocked.length ? `${blocked.length} candidate(s) were excluded for violating a protected variable or failing to apply` : null,
  ].filter(Boolean).join('; ');

  return {
    findings,
    recommendation: {
      candidate: best.row.name,
      hypothesis: best.row.hypothesis,
      justification,
      // Named explicitly so a reader can see the recommendation rests on measurements, and which.
      decided_by: decidedBy.length ? decidedBy : ['it was the only viable candidate'],
      not_decided_by: Object.entries(COMPARISON_DIMENSIONS).filter(([, d]) => !d.measured).map(([k]) => k),
      confidence: best.accepted === true ? CERTAINTY.HIGHLY_LIKELY : CERTAINTY.POSSIBLE,
      caveat: 'this is a comparison between these candidates, not a judgement that the winner is good. Nobody has looked at it: no candidate was rendered or applied.',
      requires_user_approval: true,
      ranked: ranked.map(summariseRank),
    },
  };
}

const BREADTH_ORDER = Object.freeze({ local: 0, moderate: 1, broad: 2, 'project-wide': 3 });

function summariseRank(s) {
  return {
    name: s.row.name,
    accepted: s.accepted,
    failed_acceptance_checks: s.failed_checks,
    breadth: s.row.measurements.regression_risk.breadth,
    dependent_objects: s.dependents,
    peak_speed: s.row.measurements.motion_analysis?.peak_speed ?? null,
    keyframes_delta: s.row.measurements.performance_cost.keyframes_delta,
  };
}
