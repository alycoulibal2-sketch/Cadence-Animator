// Reusable AI workflows (directive Part 52).
//
// Part 52's first sentence is the design: *"Implement reusable workflows that compose tools rather
// than duplicating logic in giant prompts."* So a workflow here is a **declared, ordered tool
// chain** with its inputs validated, not a new implementation of anything. It lists the sixteen
// workflows the directive names, documents each against Part 52's eight required fields, and
// resolves one into the exact sequence of existing MCP calls that performs it.
//
// The purity boundary decides the shape. `ai/**` cannot call an MCP tool — those live in
// `MCP_HANDLERS` in `app.js`, which imports the renderer. So this module RESOLVES a workflow into a
// plan (which tool, with which arguments, in which order, and where a human must approve) and the
// `run_workflow` handler executes that plan. That split is what keeps the workflow definitions
// testable in plain Node.
//
// Three decisions worth stating.
//
// 1. **Rule 9 applies hardest here.** Sixteen shells would be worse than a handful of real ones
//    (directive 4.6: "a tool whose output nothing consumes is worse than its absence"). So each
//    entry is either `implemented: true`, meaning every tool in its chain exists and the chain has
//    been run, or `implemented: false` with `blocked_by` naming what is missing. Thirteen are real;
//    three are not, and each says why.
//
//    The registry is EXACTLY Part 52's sixteen. Part 50's analysis tools (`analyze_pose`,
//    `analyze_camera`, `run_cadence_simulation`) are tracked by MCP-007 and are deliberately not
//    duplicated here — adding rows the directive does not list would make the registry drift from
//    the thing it is derived from.
//
// 2. **Every workflow's `benchmark_coverage` is `none`, and that is not an oversight.** Part 52
//    requires the field, and there is no benchmark suite in this build at all (BCH-001, Phase 9).
//    Reporting `none` with the row that would fix it is the honest answer; inventing a coverage
//    number would be worse than the empty field.
//
// 3. **A workflow declares its protected inputs, and they become real constraints.** Part 52 asks
//    for "protected inputs" as documentation. Where a workflow's whole point is preserving
//    something — `preserve_timing_change_style`, `preserve_pose_change_spacing` — the protection is
//    resolved into a ConstraintSpec and passed to the patch tools, so it is enforced rather than
//    described.
//
// Pure at load like the rest of `ai/`.

import { CERTAINTY, evidence, finding } from './certainty.js';
import { TERMS } from './vocabulary.js';

/** The three-field shape every step of a resolved plan has. */
const step = (tool, args, { approval = false, why = null } = {}) => ({ tool, args, requires_user_approval: approval, why });

/**
 * The sixteen workflows Part 52 names, each documenting its eight required fields.
 *
 * `chain(args)` returns the ordered tool plan. It is present only on implemented workflows; an
 * unimplemented one carries `blocked_by` instead, so the registry can never hand back a plan whose
 * tools do not exist.
 */
export const WORKFLOWS = Object.freeze({
  review_shot: {
    implemented: true,
    goal: 'review a shot like a senior animator, VFX supervisor, cinematographer and technical QA reviewer (Part 49)',
    tools: ['review_shot'],
    required_input: ['itemId (or a single rig in the project)'],
    protected_inputs: ['nothing — this workflow is read-only and Part 11 makes review mode non-mutating'],
    normal_output: 'deterministic defects ordered by Part 14, artistic suggestions kept separate, the highest failing layer, and minimal safe corrections',
    failure_behavior: 'with two or more rigs and no itemId it returns a question rather than reviewing an arbitrary one',
    approval_points: ['none — it recommends and never acts'],
    chain: (a) => [step('review_shot', { itemId: a.itemId ?? null, acceptance: a.acceptance ?? null, constrain: a.constrain ?? null })],
  },

  diagnose_frame: {
    implemented: true,
    goal: 'explain why one frame looks wrong, with the joint that owns it proved by counterfactual (Part 46)',
    tools: ['analyze_motion', 'explain_motion_problem'],
    required_input: ['itemId', 'frame', 'joint (for a motion question)'],
    protected_inputs: ['nothing — read-only'],
    normal_output: 'observed facts, ranked causes with a share of the defect each, confidence, non-destructive next checks and a safe recommended action',
    failure_behavior: 'an authored discontinuity (a stepped key, a held pose, a marked impact) is reported as authored and NOT as a defect',
    approval_points: ['the recommended action always requires approval — a recommendation is not an instruction'],
    chain: (a) => [
      step('analyze_motion', { itemId: a.itemId, from: Math.max(0, (a.frame ?? 0) - 6), to: (a.frame ?? 0) + 6 }),
      step('explain_motion_problem', { question: 'why_is_this_motion_bad', itemId: a.itemId, joint: a.joint, frame: a.frame }),
    ],
  },

  find_unintended_changes: {
    implemented: true,
    goal: 'find what changed that nobody asked for, against a baseline (Parts 44 and 45)',
    tools: ['create_baseline', 'explain_change'],
    required_input: ['a baseline taken BEFORE the edit'],
    protected_inputs: ['the baseline itself — it is project data and is never overwritten by a comparison'],
    normal_output: 'every difference classified, with the transaction that explains each one and the ones no transaction explains',
    failure_behavior: 'with no baseline it says so rather than comparing against the current state, which would find nothing by definition',
    approval_points: ['none — read-only'],
    chain: (a) => [step('explain_change', { baselineId: a.baselineId ?? null, itemId: a.itemId ?? null, request: a.request ?? null })],
  },

  fix_only_unintended_changes: {
    implemented: true,
    goal: 'undo exactly the differences nobody asked for, and nothing else (Part 45)',
    tools: ['explain_change', 'rollback_transaction'],
    required_input: ['a baseline', 'the transaction to scope the rollback to'],
    protected_inputs: ['every intended change — the rollback is scoped by property or time range so it cannot reach them'],
    normal_output: 'a scoped rollback, plus a list of anything the scope excluded',
    failure_behavior: 'a difference with no linked transaction cannot be rolled back as a transaction, and is reported instead of being silently left',
    approval_points: ['the rollback — it changes project data'],
    chain: (a) => [
      step('explain_change', { baselineId: a.baselineId ?? null, itemId: a.itemId ?? null }),
      step('rollback_transaction', { transactionId: a.transactionId, property: a.property ?? undefined, timeRange: a.timeRange ?? undefined },
        { approval: true, why: 'this changes project data' }),
    ],
  },

  generate_three_meaningful_variations: {
    implemented: true,
    goal: 'produce bounded named alternatives and a justified recommendation (Part 48)',
    tools: ['compare_experiments'],
    required_input: ['at least two candidates, each with a hypothesis and its ops'],
    protected_inputs: ['whatever `protect` declares — it is the boundary of the experiment, and ANY violation disqualifies a candidate'],
    normal_output: 'a measured comparison across 5 of Part 48\'s 8 dimensions, and either a justified winner or the question that would settle a tie',
    failure_behavior: 'a candidate with no hypothesis is refused rather than compared; identical candidates are reported as one experiment under two names',
    approval_points: ['taking a candidate — the comparison itself applies nothing'],
    chain: (a) => [step('compare_experiments', {
      name: a.name ?? null, intent: a.intent ?? null, itemId: a.itemId ?? null,
      protect: a.protect ?? null, acceptance: a.acceptance ?? null, candidates: a.candidates,
    })],
  },

  create_vfx: {
    implemented: true,
    goal: 'create an effect that is attached, timed to a shot event, and reversible (Parts 37-39)',
    tools: ['list_shot_events', 'compile_effect'],
    required_input: ['a primitive', 'an anchor', 'a timing event or frame'],
    protected_inputs: ['the animation itself — compile_effect adds an item and keys its own @rate track, and touches no existing track'],
    normal_output: 'one emitter item attached to the anchor part with a rate envelope peaking on the event, in a single reversible transaction',
    failure_behavior: 'an unknown primitive is refused with the nearest match; an ambiguous event name is refused with the question; the same spec twice refuses as a duplicate',
    approval_points: ['the compile — it creates an item'],
    chain: (a) => [
      step('list_shot_events', {}),
      step('compile_effect', {
        primitive: a.primitive, theme: a.theme ?? undefined, scale: a.scale ?? undefined, role: a.role ?? undefined,
        anchor: a.anchor ?? undefined, offset: a.offset ?? undefined, timing: a.timing ?? undefined, intent: a.intent ?? undefined,
      }, { approval: true, why: 'this creates an item' }),
    ],
  },

  synchronize_impact_event: {
    implemented: true,
    goal: 'make an effect peak exactly on the impact it reacts to (Part 39)',
    tools: ['list_shot_events', 'validate_effect_timing', 'compile_effect'],
    required_input: ['an event on the shot timeline'],
    protected_inputs: ['the event itself — its frame is read, never moved'],
    normal_output: 'a report of which emitters peak on their event and which are off by how many frames, and a corrected envelope',
    failure_behavior: 'an emitter with no envelope is reported as timed to nothing rather than silently graded',
    approval_points: ['any corrective compile'],
    chain: (a) => [
      step('list_shot_events', { itemId: a.itemId ?? null }),
      step('validate_effect_timing', {}),
    ],
  },

  make_motion_heavier: heavierLike('heavy', 'make the motion read as heavier'),
  make_motion_snappier: heavierLike('snappy', 'make the motion read as snappier'),
  make_motion_floatier: heavierLike('floaty', 'make the motion read as floatier'),
  make_motion_more_aggressive: heavierLike('aggressive', 'make the motion read as more aggressive'),

  preserve_timing_change_style: {
    implemented: true,
    goal: 'change how a motion reads without moving when anything happens (Part 27\'s independent dimensions)',
    tools: ['interpret_intent', 'plan_motion', 'apply_motion_plan'],
    required_input: ['itemId', 'a style term from the vocabulary'],
    protected_inputs: ['every key TIME — compiled into a real constraint so the planner cannot retime, rather than being trusted to behave'],
    normal_output: 'value and easing edits only, with the key times provably untouched',
    failure_behavior: 'a strategy that can only achieve the term by retiming is BLOCKED by the constraint and reported as lost, not applied quietly',
    approval_points: ['the apply'],
    chain: (a) => [
      step('interpret_intent', { request: a.request ?? `make it ${a.term}`, itemId: a.itemId, mode: 'polish' }),
      step('apply_motion_plan', {
        request: a.request ?? `make it ${a.term}`, itemId: a.itemId, mode: 'polish',
        constrain: { constraints: [{ protect: 'timing', aspect: 'timing', reason: 'preserve_timing_change_style: the timing is the thing being held' }] },
      }, { approval: true, why: 'this changes project data' }),
    ],
  },

  preserve_pose_change_spacing: {
    implemented: true,
    goal: 'keep the poses and change only how the motion moves between them (Part 27)',
    tools: ['interpret_intent', 'apply_motion_plan'],
    required_input: ['itemId', 'the frames whose poses must not move'],
    protected_inputs: ['the pose VALUES at the named frames, compiled into a constraint'],
    normal_output: 'easing and interpolation edits, with the keyed poses unchanged',
    failure_behavior: 'a strategy needing a pose change is blocked and reported as lost',
    approval_points: ['the apply'],
    chain: (a) => [
      step('interpret_intent', { request: a.request ?? `change the spacing`, itemId: a.itemId, mode: 'polish' }),
      step('apply_motion_plan', {
        request: a.request ?? 'change the spacing', itemId: a.itemId, mode: 'polish',
        constrain: { constraints: [{ protect: a.poses ?? 'the keyed poses', aspect: 'value', reason: 'preserve_pose_change_spacing: the poses are the thing being held' }] },
      }, { approval: true, why: 'this changes project data' }),
    ],
  },

  // ---- the eight that are NOT implemented, each with what blocks it ----

  polish_animation: {
    implemented: false,
    goal: 'improve a selected motion, pose, curve, VFX layer or shot element (Part 11 polish mode)',
    tools: ['review_shot', 'explain_motion_problem', 'apply_motion_plan'],
    required_input: ['itemId', 'what to polish'],
    protected_inputs: ['the scope boundary — Part 11 requires polish to preserve it'],
    normal_output: 'a diagnosis followed by the minimal corrections it justifies',
    failure_behavior: 'n/a',
    approval_points: ['each correction'],
    blocked_by: '"polish" has no closed meaning. Every tool in the chain exists, but choosing WHICH defect to correct and by how much is the judgement Part 14 orders and this build cannot make: 4 of its 13 quality layers are unmeasurable, and the top three (intent, readability, pose design) are exactly the ones a polish pass would start from. Running the chain with an arbitrary target would be a broad untraceable edit — Part 48\'s opening warning.',
  },

  compare_to_reference: {
    implemented: false,
    goal: 'compare a shot against an ingested reference (Part 48\'s reference-alignment dimension)',
    tools: ['explain_change'],
    required_input: ['a reference'],
    protected_inputs: ['the reference is read-only'],
    normal_output: 'per-dimension alignment against the reference',
    failure_behavior: 'n/a',
    approval_points: ['none'],
    blocked_by: 'nothing has been ingested to compare against. Reference profiles are Phase 8 (REF-*), and `ai/experiment.js` already reports reference_alignment as never-applicable for the same reason.',
  },

  prepare_for_export: {
    implemented: false,
    goal: 'final validation, export constraints, provenance and locking the accepted baseline (Part 11 ship mode)',
    tools: ['validate_animation', 'validate_project', 'create_baseline', 'lock_constraint'],
    required_input: ['the finished shot'],
    protected_inputs: ['the accepted baseline, once locked'],
    normal_output: 'a validation report, a locked baseline and a concise ship summary',
    failure_behavior: 'n/a',
    approval_points: ['the lock, and the export itself'],
    blocked_by: '`validate.js` imports `state.js`, so the export acceptance check cannot run from the pure layer (see CLAUDE.md). The MCP tools exist, but the workflow would be a chain this layer cannot validate the inputs of, and the ship-mode obligations in `ai/modes.js` are not yet checkable.',
  },





});

/** The four `make_motion_*` workflows are one pipeline parameterised by a vocabulary term. */
function heavierLike(term, goal) {
  return {
    implemented: true,
    goal: `${goal} (Part 21's vocabulary: "${term}" is a vector over motion dimensions, not a slider)`,
    tools: ['animation_vocabulary', 'interpret_intent', 'plan_motion', 'apply_motion_plan'],
    required_input: ['itemId'],
    protected_inputs: ['whatever `constrain` declares; every persisted lock applies regardless'],
    normal_output: 'the dimension vector the term produced, the strategies it compiled to, what each constraint blocked, and an acceptance evaluation',
    failure_behavior: `a dimension "${term}" asks for that no strategy can compile is reported as LOST, not silently dropped; a plan every constraint blocks returns applied:false with the explanation`,
    approval_points: ['the apply'],
    term,
    chain: (a) => [
      step('animation_vocabulary', { term }),
      step('interpret_intent', { request: a.request ?? `make it ${term}`, itemId: a.itemId, mode: a.mode ?? 'polish' }),
      step('plan_motion', { request: a.request ?? `make it ${term}`, itemId: a.itemId, constrain: a.constrain ?? null }),
      step('apply_motion_plan', {
        request: a.request ?? `make it ${term}`, itemId: a.itemId,
        constrain: a.constrain ?? null, mode: a.mode ?? 'polish', force: a.force ?? false,
      }, { approval: true, why: 'this changes project data' }),
    ],
  };
}

export const WORKFLOW_NAMES = Object.freeze(Object.keys(WORKFLOWS));

/** Part 52 requires a `benchmark_coverage` field on every workflow. There is no benchmark suite in
 *  this build, so the honest value is the same for all sixteen, said once. */
export const BENCHMARK_COVERAGE = Object.freeze({
  coverage: 'none',
  why: 'no benchmark suite exists in this build (BCH-001, Phase 9). Part 52 requires the field, so it is reported as none rather than filled with a number nothing measured.',
  unblocked_by: 'BCH-001 — the Part 59 benchmark library',
});

export const WORKFLOW_LIMITATIONS = Object.freeze([
  'A workflow is a declared, ordered tool chain — it composes existing MCP tools and implements nothing itself (Part 52\'s own instruction). This module resolves the chain; the run_workflow handler executes it, because ai/** cannot call an MCP tool.',
  '13 of Part 52\'s 16 workflows are implemented and 3 are not: `polish_animation` (choosing which defect to correct is the judgement Part 14 orders and this build cannot make), `compare_to_reference` (nothing is ingested to compare against — Phase 8) and `prepare_for_export` (validate.js imports state.js, so the export acceptance check cannot run from the pure layer).',
  'Every workflow reports benchmark_coverage: none. Part 52 requires the field and no benchmark suite exists (BCH-001).',
  'A resolved plan is not validated against the live project. It names tools and arguments; whether the itemId exists is checked by the tools themselves when the plan runs.',
]);

/**
 * Resolve a workflow into an ordered tool plan.
 *
 * Returns `{ ok, workflow, plan, findings }`. An unimplemented workflow is refused with what blocks
 * it, so a caller can never receive a plan whose tools do not exist.
 */
export function resolveWorkflow(name, args = {}) {
  const findings = [];
  const w = WORKFLOWS[name];
  if (!w) {
    return {
      ok: false,
      question: `"${name}" is not one of Part 52's workflows. Known: ${WORKFLOW_NAMES.join(', ')}.`,
      findings,
    };
  }
  if (!w.implemented) {
    findings.push(finding({
      id: 'WORKFLOW-NOT-IMPLEMENTED',
      certainty: CERTAINTY.CERTAIN,
      statement: `"${name}" is declared but not implemented — ${w.blocked_by}`,
      evidence: [evidence('absence', 'the workflow has no resolvable tool chain', { workflow: name })],
    }));
    return { ok: false, workflow: describe(name, w), reason: w.blocked_by, plan: [], findings };
  }

  // Required input, checked before a plan is handed back. A chain that runs and then fails on a
  // missing itemId three tools in is worse than a refusal.
  const missing = [];
  for (const req of w.required_input) {
    const key = req.split(' ')[0].replace(/[^\w]/g, '');
    if (!key || key === 'the' || key === 'a' || key === 'at' || key === 'nothing') continue;
    if (args[key] === undefined || args[key] === null) missing.push(key);
  }
  if (missing.length) {
    findings.push(finding({
      id: 'WORKFLOW-INPUT-MISSING',
      certainty: CERTAINTY.CERTAIN,
      statement: `"${name}" needs ${missing.join(', ')} — ${w.required_input.join('; ')}`,
      evidence: [evidence('absence', 'required input was not supplied', { missing })],
      suggestion: { text: 'supply the missing argument, or ask which value it should take', reversible: true },
    }));
    return { ok: false, workflow: describe(name, w), plan: [], findings, missing_input: missing };
  }

  const plan = w.chain(args);
  return {
    ok: true,
    workflow: describe(name, w),
    plan,
    approval_required_at: plan.filter((s) => s.requires_user_approval).map((s) => s.tool),
    findings,
  };
}

/** One workflow, with Part 52's eight fields plus the honest benchmark answer. */
function describe(name, w) {
  return {
    name,
    implemented: w.implemented,
    goal: w.goal,
    tools_used: w.tools,
    required_input: w.required_input,
    protected_inputs: w.protected_inputs,
    normal_output: w.normal_output,
    failure_behavior: w.failure_behavior,
    approval_points: w.approval_points,
    benchmark_coverage: BENCHMARK_COVERAGE,
    ...(w.blocked_by ? { blocked_by: w.blocked_by } : {}),
    ...(w.term ? { vocabulary_term: w.term, term_known: !!TERMS[w.term] } : {}),
  };
}

/** The catalogue, for a caller deciding which workflow to use. */
export function listWorkflows() {
  const all = WORKFLOW_NAMES.map((n) => describe(n, WORKFLOWS[n]));
  return {
    workflows: all,
    implemented: all.filter((w) => w.implemented).map((w) => w.name),
    not_implemented: all.filter((w) => !w.implemented).map((w) => ({ name: w.name, blocked_by: w.blocked_by })),
    count: all.length,
    benchmark_coverage: BENCHMARK_COVERAGE,
    limitations: WORKFLOW_LIMITATIONS,
  };
}
