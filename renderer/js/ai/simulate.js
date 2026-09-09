// Cadence Simulation: the controlled pre-commit evaluation (directive Part 47).
//
// Part 47 is explicit that this is "a controlled pre-commit evaluation, not necessarily a physics
// simulation", and gives a nine-step pipeline plus an example report. The report has three graded
// sections — Technical, Animation, VFX — followed by recommended actions, and one rule that governs
// the whole design: *"The report must never imply that a subjective score is ground truth."*
//
// **What this adds that the existing tools do not.** Three things already answer part of this
// question, and a fourth report that re-answers them slightly differently would be worse than
// nothing (Part 4.6). The division is:
//
//   preview_animation_patch  what would CHANGE — ops, diff, inverse, constraint check
//   analyse_scope            how far the change REACHES — dependents, breadth, regression need
//   review_shot              whether the shot as it STANDS is any good (Parts 49 + 14)
//   simulate_change (here)   whether the shot would be any good AFTER — the review, run on the
//                            planned result, with the before/after delta per quality layer
//
// So the one thing only this can say is **whether a change makes the shot better or worse, layer by
// layer, before it is committed.** It plans the patch on a clone, reviews both states, and diffs
// the two reviews. Nothing else does that, and it is the whole reason the module exists.
//
// Four decisions shape the file.
//
// 1. **Measured scores and artistic judgements are separate sections and are never totalled.**
//    Part 47 step 6 says "score only defined measurable dimensions" and step 7 says "classify
//    artistic suggestions separately". So `technical` carries pass/warn/fail verdicts that rest on
//    measurements, `animation` and `vfx` carry only what is measurable with the rest named absent,
//    and there is deliberately **no overall score**. A single number would be exactly the
//    "subjective score as ground truth" the part forbids — see `WHY_NO_OVERALL_SCORE`.
//
// 2. **A regression is a layer that got worse, not a finding that appeared.** Comparing counts of
//    findings would report noise; comparing the per-layer verdicts before and after says whether
//    the change helped, hurt, or left a layer alone. That per-layer delta is the product.
//
// 3. **Nothing is committed, and the report says what to do next rather than doing it.** Part 47
//    step 9 is "allow user review before commit", so this returns the ops it evaluated and the
//    tool that would apply them; it never applies anything.
//
// 4. **The pipeline reports which of its own nine steps ran.** Steps 4 and 5 — render diagnostic
//    passes and run visual comparisons — cannot run here at all, because this layer has no pixels.
//    They are named in every report rather than quietly skipped.
//
// Pure at load like the rest of `ai/`.

import { contentHash } from './hash.js';
import { coverage } from './certainty.js';
import { makePatch, planPatch } from './patch.js';
import * as constraints from './constraints.js';
import * as scope from './scope.js';
import * as cal from './cal.js';
import * as review from './review.js';
import * as modes from './modes.js';

/** Part 47's nine steps, and whether this build can run each one. */
export const SIMULATION_STEPS = Object.freeze([
  { step: 1, name: 'resolve current plan, constraints and baseline', runs: 'partly', how: 'constraints and persisted locks are compiled and checked; the AcceptanceSpec stands in for the plan. There is no shot plan entity (SHOT-001), and a rendered baseline is not reachable from here' },
  { step: 2, name: 'generate or preview the proposed state', runs: true, how: 'ai/patch.js planPatch on a clone — the resulting project is a real object the rest of the pipeline measures' },
  { step: 3, name: 'inspect curves, contacts, motion graph and event graph', runs: true, how: 'ai/review.js over both states — ai/motion.js for curves and contacts, ai/events.js for the event timeline' },
  { step: 4, name: 'render needed diagnostic passes', runs: false, why: 'this layer has no pixels. The passes exist (Part 43, OBS-002/003) and run through plan_observation / explain_change against an APPLIED state' },
  { step: 5, name: 'run visual and temporal comparisons', runs: false, why: 'same reason — a visual comparison needs two rendered states, and nothing here is applied or rendered. `observation_plan` below names the frames worth comparing after the commit' },
  { step: 6, name: 'score only defined measurable dimensions', runs: true, how: 'the technical section carries verdicts that rest on measurements; every quality layer that cannot be measured is reported as unmeasured rather than passing' },
  { step: 7, name: 'classify artistic suggestions separately', runs: true, how: 'a separate array, never merged into the graded sections and never given a severity' },
  { step: 8, name: 'propose safe candidate fixes', runs: 'partly', how: 'each finding\'s own suggestion, ordered by Part 14\'s hierarchy. They are proposals with a named tool, not generated patches' },
  { step: 9, name: 'allow user review before commit', runs: true, how: 'nothing is applied. The evaluated ops and the tool that would apply them are returned' },
]);

/** Part 47's closing rule, kept where a reader of the result will find it. */
export const WHY_NO_OVERALL_SCORE = 'Part 47: "The report must never imply that a subjective score is ground truth." A single overall score would have to average a measured contact drift against an unmeasurable judgement about pose design, and the result would look authoritative while resting on nothing. The sections are reported separately and are not totalled.';

export const SIMULATION_LIMITATIONS = Object.freeze([
  'Steps 4 and 5 of Part 47\'s pipeline — rendering diagnostic passes and running visual comparisons — cannot run here at all. This layer has no pixels; create_baseline before the commit and explain_change after it is what runs them.',
  'The Animation section reports only what is measurable. Part 47\'s example report grades "pose readability" and "weight"; neither is measurable in this build (MOT-011/012, and part mass is unknown), so they are named absent rather than graded.',
  'There is deliberately no overall score. ' + WHY_NO_OVERALL_SCORE,
  'A simulation evaluates ONE proposed change. Comparing several is ai/experiment.js (Part 48), which is the tool for "which of these should I do".',
  'The before/after comparison is of the two REVIEWS, not of two renders. A layer whose verdict is unchanged may still look different.',
]);

const VERDICT = Object.freeze({ PASS: 'pass', WARNING: 'warning', FAIL: 'fail', NOT_MEASURED: 'not_measured' });

/**
 * Simulate a proposed change.
 *
 * @param project           the project. NOT modified.
 * @param opts.ops          the proposed operations, in the shape apply_animation_patch takes
 * @param opts.itemId       the subject for the review
 * @param opts.constrain    a constraint request — what must not be disturbed
 * @param opts.acceptance   an AcceptanceSpec, which is the only way layer 1 becomes measurable
 * @param opts.intent       the request this change came from
 */
export function simulateChange(project, { ops = null, itemId = null, constrain = null, acceptance = null, intent = null, frame = 0, mode = 'analyze', discipline = undefined } = {}) {
  // Part 11: a simulation changes nothing, so it is legal in `analyze` mode and that is the default.
  const auth = modes.authorise({ mutates: false, name: 'simulate_change' }, { mode, discipline });
  const before = contentHash(project);

  const compiled = constrain
    ? constraints.compileConstraints(typeof constrain === 'string' ? { text: constrain } : constrain, project)
    : { constraints: [], unparsed: [], questions: [] };
  const spec = acceptance
    ? (Array.isArray(acceptance) ? cal.acceptanceSpec({ checks: acceptance }) : cal.acceptanceSpec(acceptance))
    : null;

  // Step 3 on the CURRENT state. This is the baseline the delta is measured against, and it is
  // also the answer when there is no proposed change at all.
  const reviewBefore = review.reviewShot(project, { itemId, acceptance: spec, constrain, mode: 'review' });
  if (!reviewBefore.ok) {
    return { ok: false, question: reviewBefore.question, steps: SIMULATION_STEPS, limitations: SIMULATION_LIMITATIONS, mode: auth.mode, active_mode: auth.active };
  }

  // Step 2. No ops is a legitimate call: "simulate the shot as it stands" is a review with the
  // pipeline's own reporting around it, and saying so is better than requiring a no-op patch.
  let plan = null, patch = null, reviewAfter = null, constraintReport = null, scopeReport = null;
  if (Array.isArray(ops) && ops.length) {
    patch = makePatch({ ops, intent: intent ?? 'simulated change', author: 'ai' });
    plan = planPatch(project, patch);
    constraintReport = constraints.checkPatch(project, patch, compiled.constraints, { frame, result: plan.result });
    scopeReport = scope.analyseScope(project, plan, { constraints: compiled.constraints, frame });
    if (plan.applicable) {
      reviewAfter = review.reviewShot(plan.result, { itemId, acceptance: spec, constrain, mode: 'review' });
    }
  }

  const technical = technicalSection(project, plan, constraintReport, scopeReport, reviewBefore, reviewAfter, compiled);
  const animation = gradedSection(reviewBefore, reviewAfter, [1, 4, 5, 6, 7, 8, 9, 13]);
  const vfx = gradedSection(reviewBefore, reviewAfter, [11]);
  const delta = layerDelta(reviewBefore, reviewAfter);

  const target = reviewAfter ?? reviewBefore;
  const suggestions = target.artistic_suggestions;

  return {
    ok: true,
    mode: auth.mode,
    active_mode: auth.active,
    evaluating: plan ? `${plan.ops.filter((r) => r.effect !== 'no_op').length} operation(s)` : 'the shot as it stands, with no proposed change',
    intent,

    // Part 47's report sections, in its own order.
    technical,
    animation,
    vfx,
    artistic_suggestions: suggestions,

    // Decision 2: the product is the per-layer delta, not a count of findings.
    change_effect: delta,

    recommended_actions: recommendedActions(target, delta, constraintReport),

    // Step 9. What it would take to commit, and the fact that nothing was.
    commit: {
      applied: false,
      applicable: plan ? plan.applicable : null,
      blocked_by_constraints: constraintReport ? !constraintReport.allowed : null,
      apply_with: plan ? 'apply_animation_patch with these same ops' : null,
      ops_evaluated: plan ? patch.ops : [],
      inverse_available: plan?.inverse ? plan.inverse.ops.length : 0,
    },

    // Steps 4 and 5 cannot run, so the report says what WOULD run them, after the fact.
    observation_plan: {
      available_here: false,
      why: 'nothing is rendered by a simulation',
      frames_worth_comparing: target.suspect_frames,
      how: 'create_baseline before applying, then explain_change after — that runs the silhouette and object-ID passes over the affected frames',
    },

    scope: scopeReport,
    constraint_compilation: compiled,
    review_before: summariseReview(reviewBefore),
    review_after: reviewAfter ? summariseReview(reviewAfter) : null,

    steps: SIMULATION_STEPS,
    no_overall_score: WHY_NO_OVERALL_SCORE,
    unchanged: contentHash(project) === before,
    coverage: coverage({
      scope: `${SIMULATION_STEPS.filter((s) => s.runs !== false).length} of Part 47's 9 pipeline steps ran; ${target.layers_reviewed.length} of Part 14's 13 quality layers were reviewed`,
      frames: target.coverage.frames,
      loop: 'fast',
      notRun: [
        ...SIMULATION_STEPS.filter((s) => s.runs === false).map((s) => `step ${s.step}, ${s.name} — ${s.why}`),
        ...target.coverage.notRun,
      ],
    }),
    limitations: SIMULATION_LIMITATIONS,
  };
}

/** The Technical section: the things that either hold or do not, with a measurement behind each. */
function technicalSection(project, plan, report, scopeReport, before, after, compiled) {
  const rows = [];

  if (compiled.unparsed?.length) {
    rows.push({
      check: 'constraint compilation', verdict: VERDICT.FAIL,
      detail: `${compiled.unparsed.length} protection line(s) were not understood, so they protect nothing`,
      evidence: compiled.unparsed,
    });
  }

  if (report) {
    rows.push({
      check: 'protected state', verdict: report.violations.length ? (report.allowed ? VERDICT.WARNING : VERDICT.FAIL) : VERDICT.PASS,
      detail: report.violations.length
        ? `${report.violations.length} violation(s): ${report.violations.map((v) => v.reason).join('; ')}`
        : `${report.checked} constraint(s) checked, none violated`,
      note: report.violations.length && report.allowed
        ? 'the violated constraint only warns, so apply_animation_patch would proceed — see ai/experiment.js for why an experiment treats this as disqualifying instead'
        : null,
    });
  } else {
    rows.push({ check: 'protected state', verdict: VERDICT.NOT_MEASURED, detail: 'no change was proposed, so nothing was checked against the protections' });
  }

  if (plan) {
    rows.push({
      check: 'patch applies cleanly', verdict: plan.applicable ? VERDICT.PASS : VERDICT.FAIL,
      detail: plan.applicable ? plan.summary : plan.problems.map((p) => p.statement).join('; '),
    });
    rows.push({
      check: 'reversible', verdict: plan.inverse ? VERDICT.PASS : VERDICT.WARNING,
      detail: plan.inverse ? `an inverse of ${plan.inverse.ops.length} operation(s) was computed from the state actually found` : 'no inverse was computed, so this change could not be rolled back as a transaction',
    });
    rows.push({
      check: 'scope', verdict: scopeReport?.breadth?.verdict === 'local' ? VERDICT.PASS : VERDICT.WARNING,
      detail: scopeReport?.summary ?? null,
    });
  }

  const rigDefects = (after ?? before).deterministic_defects.filter((d) => d.quality_layer === 7 && /rig/i.test(d.id));
  rows.push({
    check: 'rig validity', verdict: rigDefects.length ? VERDICT.WARNING : VERDICT.PASS,
    detail: rigDefects.length ? rigDefects.map((d) => d.statement).join('; ') : 'no rig validation finding',
  });

  const contact = (after ?? before).deterministic_defects.filter((d) => d.id === 'REVIEW-CONTACT-DRIFT');
  rows.push({
    check: 'declared contacts', verdict: contact.length ? VERDICT.FAIL : ((after ?? before).coverage.notRun.some((s) => /no contact was DECLARED/.test(s)) ? VERDICT.NOT_MEASURED : VERDICT.PASS),
    detail: contact.length ? contact.map((d) => d.statement).join('; ') : 'no declared contact is broken (a contact must be DECLARED to be measured — nothing here infers one)',
  });

  return { rows, verdict: worst(rows.map((r) => r.verdict)) };
}

/** A graded section over a set of quality layers — measured only, never invented. */
function gradedSection(before, after, layers) {
  const target = after ?? before;
  const rows = [];
  for (const n of layers) {
    const meta = review.QUALITY_LAYERS.find((l) => l.layer === n);
    if (!meta) continue;
    if (meta.measured === false) {
      rows.push({ layer: n, name: meta.name, verdict: VERDICT.NOT_MEASURED, blocked_by: meta.blocked_by });
      continue;
    }
    const defects = target.deterministic_defects.filter((d) => d.quality_layer === n);
    const worstSeverity = defects.length ? defects.map((d) => d.severity).sort((a, b) => (a === 'blocking' ? -1 : b === 'blocking' ? 1 : 0))[0] : null;
    rows.push({
      layer: n,
      name: meta.name,
      verdict: !defects.length ? VERDICT.PASS : (worstSeverity === 'blocking' ? VERDICT.FAIL : VERDICT.WARNING),
      partial: meta.measured === 'partly',
      measured_by: meta.by ?? null,
      not_measured: meta.measured === 'partly' ? meta.blocked_by : null,
      detail: defects.map((d) => d.statement),
    });
  }
  return { rows, verdict: worst(rows.map((r) => r.verdict)) };
}

/**
 * Per-layer before/after. Decision 2: this is what a pre-commit report is FOR.
 */
function layerDelta(before, after) {
  if (!after) return { measured: false, why: 'no change was proposed, so there is no before-and-after to compare' };
  const rows = [];
  for (const meta of review.QUALITY_LAYERS) {
    if (meta.measured === false) continue;
    const b = before.deterministic_defects.filter((d) => d.quality_layer === meta.layer);
    const a = after.deterministic_defects.filter((d) => d.quality_layer === meta.layer);
    const dir = a.length === b.length ? 'unchanged' : a.length < b.length ? 'improved' : 'worse';
    if (dir === 'unchanged') continue;
    rows.push({
      layer: meta.layer, name: meta.name, direction: dir,
      before: b.length, after: a.length,
      introduced: a.filter((x) => !b.some((y) => y.id === x.id && y.statement === x.statement)).map((x) => x.statement),
      resolved: b.filter((x) => !a.some((y) => y.id === x.id && y.statement === x.statement)).map((x) => x.statement),
    });
  }
  const worse = rows.filter((r) => r.direction === 'worse');
  return {
    measured: true,
    rows,
    verdict: worse.length ? 'this change makes at least one quality layer worse' : rows.length ? 'this change improves at least one layer and makes none worse' : 'this change leaves every measurable layer as it was',
    regressions: worse,
    highest_regressed_layer: worse.length ? Math.min(...worse.map((r) => r.layer)) : null,
  };
}

/** Part 47's "Recommended actions", ordered by Part 14 and led by anything the change would break. */
function recommendedActions(target, delta, report) {
  const out = [];

  if (delta.measured && delta.regressions.length) {
    const first = delta.regressions.find((r) => r.layer === delta.highest_regressed_layer);
    out.push({
      priority: 1,
      action: 'reconsider this change, or protect what it disturbs',
      statement: `it makes ${first.name} worse: ${first.introduced.join('; ')}`,
      layer: first.layer,
      requires_user_approval: true,
    });
  }
  if (report && report.violations.length) {
    out.push({
      priority: out.length + 1,
      action: 'resolve the constraint violation before committing',
      statement: report.violations.map((v) => v.reason).join('; '),
      requires_user_approval: !report.allowed,
    });
  }
  for (const c of target.recommended_corrections) {
    if (!c.action && !c.statement) continue;
    out.push({ priority: out.length + 1, action: c.action, statement: c.statement, layer: c.layer ?? null, requires_user_approval: c.requires_user_approval });
  }
  if (!out.length) {
    out.push({
      priority: 1, action: null,
      statement: 'nothing measurable objects to this change. That is not approval: 4 of Part 14\'s 13 layers cannot be measured, nothing was rendered, and nobody has looked at it.',
      requires_user_approval: true,
    });
  }
  return out;
}

function summariseReview(r) {
  return {
    defects: r.deterministic_defects.length,
    suggestions: r.artistic_suggestions.length,
    severity: r.severity_summary,
    fix_first: r.fix_first ? { layer: r.fix_first.layer, name: r.fix_first.name, statement: r.fix_first.finding.statement } : null,
    layers_reviewed: r.layers_reviewed,
  };
}

const RANK = Object.freeze({ fail: 0, warning: 1, not_measured: 2, pass: 3 });
function worst(verdicts) {
  const real = verdicts.filter((v) => v && v !== VERDICT.NOT_MEASURED);
  if (!real.length) return VERDICT.NOT_MEASURED;
  return real.sort((a, b) => RANK[a] - RANK[b])[0];
}
