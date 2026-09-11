// The architecture-improvement loop (directive Part 60). ARCH-001, ARCH-002.
//
// Part 60's loop, verbatim, is the shape of this module:
//
//     DETECT RECURRING PROBLEM → CLASSIFY THE PROBLEM → IDENTIFY LIKELY ARCHITECTURAL CAUSE
//     → PROPOSE HYPOTHESIS → DEFINE MINIMUM PROTOTYPE → BUILD BENCHMARK → COMPARE OLD AND NEW
//     → REVIEW SIDE EFFECTS → REQUEST OR RECORD APPROVAL → VERSION ADOPTED CHANGE
//     → RETAIN ROLLBACK PATH
//
// and Part 4.8 is the rule it must never break: *"The AI may identify weaknesses, propose
// architecture changes, build prototypes, run benchmarks, and recommend adoption. It must not
// silently alter production architecture."* So nothing in this file changes code, a threshold, a
// rule or a preference. It produces RECORDS — a detected problem with its evidence, a proposal with
// the loop's stages, an evaluation against two benchmark runs, a decision a human made — and each
// record says what it rests on.
//
// Four decisions, each the answer to a way this could have gone wrong.
//
// 1. **A proposal without a problem category is refused** (ARCH-002). Part 60: *"Do not rewrite
//    architecture before understanding the failure category."* The category is one of Part 60's
//    twelve, chosen by the caller — `detectRecurringProblems` offers candidates and says the choice
//    is not its to make.
//
// 2. **The adoption rule is evaluated mechanically, and the verdict is never the decision.**
//    `evaluateAdoption` compares two `ai/benchmark.js` runs with `compareRuns`, checks every
//    dimension the rule names, and returns adopt / reject / inconclusive with the cells behind it.
//    Then it stops. `decideProposal` records what a HUMAN decided, and refuses to record an approval
//    for a proposal nobody benchmarked — Part 60 puts COMPARE before APPROVAL, and a record that
//    let approval come first would let "we adopted it" mean "we liked the idea".
//
// 3. **Side effects are listed, never averaged away.** A regression on a dimension the rule did not
//    name, or on a benchmark the proposal did not name, is a side effect — reported by name in the
//    evaluation so the reviewer sees it. Part 60's REVIEW SIDE EFFECTS stage is that list.
//
// 4. **Detection reads durable evidence, and only durable evidence.** Repeated corrections come from
//    `ai/memory.js` (Part 57's candidates), rollback frequency from the transaction ledger the caller
//    hands in and from the provenance graph's `rolls_back` edges. Nothing here infers a recurring
//    problem from a single event: one rollback is a rollback, three are a pattern, and the threshold
//    is declared.
//
// Storage is the caller's. A proposal is a plain record; the app keeps a session registry and writes
// each one into provenance as a `note` so it survives save/load, and the adopting change lives in
// git, which is the rollback path. `improveLimitations()` says so rather than implying a store.
//
// Pure at load like the rest of `ai/`.

import * as BENCH from './benchmark.js';
import * as MEM from './memory.js';
import * as PRV from './provenance.js';
import { contentHash, shortHash } from './hash.js';
import { CERTAINTY, coverage, evidence, finding } from './certainty.js';

// ---------------------------------------------------------------- Part 60, verbatim

/** Part 60's problem categories. A proposal must name exactly one. */
export const PROBLEM_CATEGORIES = Object.freeze({
  knowledge: 'the system lacks a concept, a rule of thumb, or an explanation it needed (Part 25)',
  representation: 'a fact the system needed has no place to live in the semantic model (Parts 16–20)',
  tool: 'an MCP tool is missing, misshapen, or answers a different question than the one asked (Part 50)',
  observation: 'the system could not see the evidence that would have settled the question (Part 43)',
  planning: 'a plan was built, but it was the wrong plan for the intent or the constraints (Parts 20.2, 54)',
  generation: 'the plan was right and the operations it compiled to were not (Part 24)',
  evaluation: 'a measurement, an acceptance check or a comparison reported the wrong thing (Parts 23, 44, 59)',
  memory: 'a lesson was learned and not kept, or kept and not applied where it belonged (Parts 57–58)',
  ux: 'the person could not see, approve or reverse what happened (Part 53)',
  performance: 'the right thing was done too slowly or too expensively (Part 15)',
  architecture: 'a module boundary or data ownership is what makes the recurring failure recur (Part 61)',
  platform_limitation: 'Roblox or the renderer cannot represent what was asked (Part 24)',
});

export const CATEGORY_IDS = Object.freeze(Object.keys(PROBLEM_CATEGORIES));

/** Part 60's loop stages, in order. Every proposal carries all eleven with their evidence. */
export const LOOP_STAGES = Object.freeze([
  'detect_recurring_problem',
  'classify_the_problem',
  'identify_likely_architectural_cause',
  'propose_hypothesis',
  'define_minimum_prototype',
  'build_benchmark',
  'compare_old_and_new',
  'review_side_effects',
  'request_or_record_approval',
  'version_adopted_change',
  'retain_rollback_path',
]);

export const PROPOSAL_STATUSES = Object.freeze(['proposed', 'evaluated', 'approved', 'rejected', 'deferred', 'adopted', 'rolled_back']);
export const DECISIONS = Object.freeze(['approve', 'reject', 'defer', 'adopt', 'roll_back']);
export const VERDICTS = Object.freeze(['adopt', 'reject', 'inconclusive']);

/** Part 8's engineering card. Optional on a proposal; completeness is reported, never faked. */
export const ENGINEERING_CARD_FIELDS = Object.freeze([
  'concept', 'problem_it_solves', 'user_outcome', 'animation_or_vfx_outcome', 'information_required',
  'cadence_representation', 'mcp_exposure', 'user_visible_controls', 'deterministic_measurements',
  'model_assisted_judgment', 'failure_modes', 'performance_cost', 'roblox_limitations',
  'smallest_robust_implementation', 'future_extensible_implementation', 'tests_and_benchmarks', 'decision',
]);

/** Part 60's architecture self-critique, the questions a session asks periodically. Reported, not
 *  answered here — each needs session history this layer never sees. */
export const SELF_CRITIQUE_QUESTIONS = Object.freeze([
  'Which errors repeat?',
  'Which tools are used inefficiently?',
  'Which data does the model repeatedly lack?',
  'Which transformations require too many low-level edits?',
  'Which user corrections recur?',
  'Which metrics are misleading?',
  'Which features create visual clutter?',
  'Which workflows are slow?',
  'Which modules are redundant?',
  'Which assumptions are causing failures?',
]);

/** Below this many rolled-back or failed transactions no ratio is a pattern. Declared, not tuned. */
export const MIN_EVENTS_FOR_A_PATTERN = 3;
export const ROLLBACK_RATIO_THRESHOLD = 0.34;

export const DEFAULT_ROLLBACK_PATH = 'the adopting change is one commit; `git revert` of that commit restores the previous behaviour, and the proposal record keeps the pre-adoption benchmark run id so the reversal can be measured too';

// ---------------------------------------------------------------- DETECT

/**
 * Detect recurring problems from durable evidence.
 *
 * @param opts.ledger  the plain output of `TransactionLedger.list()` — `{ transactions: [...] }` —
 *                     or null when the caller has no session ledger
 * @param opts.benchmarkRun  a benchmark_run whose failed checks count as recurring evidence when a
 *                     benchmark is reproducible AND fails: the same input fails the same way twice
 */
export function detectRecurringProblems(project, { ledger = null, benchmarkRun = null, minObservations = MEM.SUFFICIENCY_THRESHOLD, minEvents = MIN_EVENTS_FOR_A_PATTERN, rollbackRatio = ROLLBACK_RATIO_THRESHOLD } = {}) {
  const problems = [];
  const notRun = [];

  // 1. Repeated user corrections (Part 57's candidates are Part 66's "repeated user correction").
  const candidates = MEM.listMemory(project, { status: 'candidate' }).filter((e) => (e.observations ?? 0) >= minObservations);
  for (const c of candidates) {
    problems.push(problem({
      kind: 'repeated_correction',
      statement: `the same correction "${c.pattern_key ?? c.statement}" has been recorded ${c.observations} times and no decision has been made about it`,
      certainty: CERTAINTY.HIGHLY_LIKELY,
      evidence: [
        evidence('data', `memory entry ${c.id} has ${c.observations} observation(s), status candidate`, { id: c.id, pattern_key: c.pattern_key ?? null, statement: c.statement }),
        evidence('convention', `${minObservations} observations is the sufficiency threshold ai/memory.js declares`),
      ],
      candidate_categories: ['knowledge', 'planning', 'representation'],
      next: 'review the candidate (review_preference_candidate), and if the correction keeps recurring after a preference is applied, the problem is not the preference — propose with the category that explains why the planner keeps producing the thing being corrected',
      source: { memory_id: c.id },
    }));
  }
  if (!candidates.length) notRun.push(`no memory candidate has reached ${minObservations} observations`);

  // 2. Rollback frequency from the session ledger (Part 59's rollback_frequency, as evidence).
  if (ledger && Array.isArray(ledger.transactions)) {
    const rows = ledger.transactions.filter((t) => ['applied', 'accepted', 'rolled_back', 'failed'].includes(t.status));
    const bad = rows.filter((t) => t.status === 'rolled_back' || t.status === 'failed');
    const ratio = rows.length ? bad.length / rows.length : 0;
    if (bad.length >= minEvents && ratio >= rollbackRatio) {
      problems.push(problem({
        kind: 'rollback_frequency',
        statement: `${bad.length} of ${rows.length} transactions in this session were rolled back or refused (${Math.round(ratio * 100)}%)`,
        certainty: CERTAINTY.CERTAIN,
        evidence: [
          evidence('measurement', `rollback-or-failure ratio ${Math.round(ratio * 1000) / 1000} over ${rows.length} transaction(s)`, { rolled_back: rows.filter((t) => t.status === 'rolled_back').length, failed: rows.filter((t) => t.status === 'failed').length }),
          evidence('convention', `${rollbackRatio} is the declared threshold, and ${minEvents} events the minimum for a pattern`),
        ],
        candidate_categories: ['planning', 'generation', 'evaluation', 'tool'],
        next: 'inspect the rolled-back transactions (inspect_transaction) for what they had in common before choosing a category',
        source: { transactions: bad.map((t) => t.transaction_id) },
      }));
    } else {
      notRun.push(rows.length ? `the session ledger's rollback ratio (${bad.length}/${rows.length}) is under the threshold or under ${minEvents} events` : 'the session ledger holds no applied, rolled-back or failed transaction');
    }
  } else {
    notRun.push('no session ledger was supplied — rollback frequency for this session was not read');
  }

  // 3. Rollback frequency from provenance — the durable record, across sessions of this file.
  const g = PRV.getGraph(project);
  const patches = g.nodes.filter((n) => n.type === 'patch').length;
  const rollbacks = g.edges.filter((e) => e.type === 'rolls_back').length;
  if (patches >= minEvents && rollbacks >= minEvents && rollbacks / patches >= rollbackRatio) {
    problems.push(problem({
      kind: 'rollback_frequency_durable',
      statement: `across this project's recorded history, ${rollbacks} of ${patches} patches were rolled back`,
      certainty: CERTAINTY.CERTAIN,
      evidence: [
        evidence('data', `provenance holds ${patches} patch node(s) and ${rollbacks} rolls_back edge(s)`, { truncated: g.truncated || 0 }),
        ...(g.truncated ? [evidence('absence', `${g.truncated} earlier record(s) were dropped at the cap, so the ratio is over what survived`)] : []),
      ],
      candidate_categories: ['planning', 'generation', 'evaluation'],
      next: 'inspect_provenance with type decision lists the rollbacks and what each one reversed',
      source: { patches, rollbacks },
    }));
  } else {
    notRun.push(`provenance rollback ratio not a pattern (${rollbacks} rollback(s) over ${patches} patch(es))`);
  }

  // 4. A benchmark that fails reproducibly: the same input fails the same way every time.
  if (benchmarkRun && Array.isArray(benchmarkRun.results)) {
    const failing = benchmarkRun.results.filter((r) => r.status === 'ran' && r.reproducible && r.checks.some((c) => c.ok === false));
    for (const r of failing) {
      problems.push(problem({
        kind: 'reproducible_benchmark_failure',
        statement: `benchmark "${r.benchmark_id}" fails the same way on every run: ${r.checks.filter((c) => c.ok === false).map((c) => c.name).join('; ')}`,
        certainty: CERTAINTY.CERTAIN,
        evidence: [evidence('measurement', 'a reproducible benchmark with at least one failed check', { benchmark: r.benchmark_id, failed_checks: r.checks.filter((c) => c.ok === false).map((c) => c.name), result_hash: r.result_hash })],
        candidate_categories: ['planning', 'generation', 'evaluation', 'platform_limitation'],
        next: `the benchmark's known_failure_cases field says whether this failure is the fixture's point; if it is not, propose with benchmark_ids: ["${r.benchmark_id}"]`,
        source: { benchmark_id: r.benchmark_id },
      }));
    }
    if (!failing.length) notRun.push('no benchmark in the supplied run fails reproducibly');
  } else {
    notRun.push('no benchmark run was supplied — reproducible benchmark failures were not read');
  }

  return {
    problems,
    count: problems.length,
    classification_note: 'candidate_categories are offered, not chosen: Part 60 makes CLASSIFY a stage of its own, and proposeImprovement refuses a proposal that has not named one category (ARCH-002)',
    self_critique: SELF_CRITIQUE_QUESTIONS,
    findings: problems.map((p) => finding({ id: `RECURRING-${p.kind.toUpperCase()}`, certainty: p.certainty, statement: p.statement, evidence: p.evidence })),
    coverage: coverage({
      scope: 'memory candidates, the supplied session ledger, the provenance graph, and the supplied benchmark run',
      loop: 'fast',
      notRun: [
        ...notRun,
        'Part 60\'s self-critique questions (which tools are used inefficiently, which workflows are slow, which assumptions cause failures) need session history this layer never sees — they are listed for the caller, not answered',
      ],
    }),
  };
}

function problem(p) {
  return { id: `problem:${shortHash(contentHash({ kind: p.kind, source: p.source }))}`, ...p };
}

// ---------------------------------------------------------------- PROPOSE

/**
 * Build a proposal record. Refuses rather than guessing: no category, no hypothesis, an unknown
 * benchmark, or an adoption rule that names a dimension nothing can measure all come back as
 * `{ ok: false, refused_because }`.
 *
 * @param raw.problem          `{ statement, category, evidence?, source? }` — category is REQUIRED
 * @param raw.likely_cause     one sentence
 * @param raw.hypothesis       what the prototype is expected to change, and why
 * @param raw.prototype        `{ description, options?, overrides_label? }` — `options` are
 *                             ai/benchmark.js IMPLEMENTATION_OPTIONS a run can flip without code;
 *                             `overrides_label` names a code prototype the CLI or a test supplies
 * @param raw.benchmark_ids    the benchmarks the comparison must run
 * @param raw.adoption_rule    `{ must_improve: [dims], must_not_regress: [dims] | 'all_others' }`
 * @param raw.engineering_card Part 8's card, any subset of ENGINEERING_CARD_FIELDS
 */
export function proposeImprovement(raw = {}, { timestamp = null } = {}) {
  const refuse = (why) => ({ ok: false, refused_because: why, findings: [finding({ id: 'PROPOSAL-REFUSED', certainty: CERTAINTY.CERTAIN, statement: why, evidence: [evidence('absence', 'a required field of a Part 60 proposal was missing or invalid')] })] });

  const p = raw.problem;
  if (!p || typeof p !== 'object' || !p.statement) return refuse('a proposal needs a `problem` with a `statement` — Part 60 starts at DETECT, and detect_recurring_problems returns problems in this shape');
  if (!p.category) return refuse(`the problem has no category. Part 60: "Do not rewrite architecture before understanding the failure category." Name one of: ${CATEGORY_IDS.join(', ')} (ARCH-002)`);
  if (!CATEGORY_IDS.includes(p.category)) return refuse(`"${p.category}" is not one of Part 60's problem categories (${CATEGORY_IDS.join(', ')})`);
  if (!raw.likely_cause) return refuse('a proposal needs `likely_cause` — the IDENTIFY LIKELY ARCHITECTURAL CAUSE stage');
  if (!raw.hypothesis) return refuse('a proposal needs a `hypothesis` — what the prototype is expected to change in a measured outcome, and why');
  const proto = raw.prototype;
  if (!proto || typeof proto !== 'object' || !proto.description) return refuse('a proposal needs a `prototype` with a `description` — Part 60\'s DEFINE MINIMUM PROTOTYPE stage');
  if (proto.options) {
    for (const k of Object.keys(proto.options)) {
      if (!(k in BENCH.IMPLEMENTATION_OPTIONS)) return refuse(`prototype option "${k}" is not one ai/benchmark.js can flip (known: ${Object.keys(BENCH.IMPLEMENTATION_OPTIONS).join(', ')}); a code prototype is named with overrides_label and supplied to the run by the caller`);
    }
  }
  if (!proto.options && !proto.overrides_label) return refuse('a prototype must be runnable: name `options` (a declared implementation option) or `overrides_label` (a code prototype the caller supplies to runSuite)');

  const ids = Array.isArray(raw.benchmark_ids) ? raw.benchmark_ids : [];
  if (!ids.length) return refuse('a proposal needs `benchmark_ids` — Part 60 puts BUILD BENCHMARK before COMPARE, and a proposal with no benchmark cannot be compared');
  const unknown = ids.filter((id) => !BENCH.BENCHMARKS[id]);
  if (unknown.length) return refuse(`unknown benchmark id(s): ${unknown.join(', ')} — benchmark_library lists the ${BENCH.BENCHMARK_IDS.length}`);

  const rule = raw.adoption_rule || {};
  const mustImprove = Array.isArray(rule.must_improve) ? rule.must_improve : [];
  if (!mustImprove.length) return refuse('the adoption rule needs `must_improve` with at least one dimension — a proposal that promises to improve nothing measurable cannot be adopted on evidence');
  for (const d of mustImprove) {
    const spec = BENCH.EVALUATION_DIMENSIONS[d];
    if (!spec) return refuse(`"${d}" is not one of Part 59's evaluation dimensions`);
    if (!spec.measured) return refuse(`the adoption rule names "${d}", which this build cannot measure (${spec.blocked_by}) — evidence for it would be impossible, so the rule would be unfalsifiable`);
    if (!ids.some((id) => BENCH.BENCHMARKS[id].dimensions.includes(d))) return refuse(`no named benchmark measures "${d}" — ${ids.join(', ')} measure ${[...new Set(ids.flatMap((id) => BENCH.BENCHMARKS[id].dimensions))].join(', ')}`);
  }
  const mustNotRegress = rule.must_not_regress === undefined || rule.must_not_regress === 'all_others'
    ? 'all_others'
    : (Array.isArray(rule.must_not_regress) ? rule.must_not_regress : null);
  if (mustNotRegress === null) return refuse('`must_not_regress` must be a list of dimensions or the string "all_others"');
  if (Array.isArray(mustNotRegress)) {
    for (const d of mustNotRegress) if (!BENCH.EVALUATION_DIMENSIONS[d]) return refuse(`"${d}" in must_not_regress is not one of Part 59's evaluation dimensions`);
  }

  const card = {};
  const cardMissing = [];
  for (const f of ENGINEERING_CARD_FIELDS) {
    const v = raw.engineering_card?.[f];
    card[f] = v === undefined ? null : v;
    if (v === undefined || v === null || v === '') cardMissing.push(f);
  }

  const body = {
    problem: { statement: p.statement, category: p.category, category_meaning: PROBLEM_CATEGORIES[p.category], evidence: p.evidence || [], source: p.source || 'caller' },
    likely_cause: raw.likely_cause,
    hypothesis: raw.hypothesis,
    prototype: { description: proto.description, options: proto.options ? { ...proto.options } : null, overrides_label: proto.overrides_label || null },
    benchmark_ids: ids,
    adoption_rule: { must_improve: mustImprove, must_not_regress: mustNotRegress, reproducibility_required: true },
  };
  const id = `proposal:${shortHash(contentHash(body))}`;
  const stage = (done, extra = {}) => ({ done, ...extra });
  const proposal = {
    kind: 'architecture_proposal',
    id,
    status: 'proposed',
    created_at: timestamp,
    author: raw.author || 'ai',
    ...body,
    measurements: [...new Set([...mustImprove, ...(Array.isArray(mustNotRegress) ? mustNotRegress : [])])],
    engineering_card: card,
    card_completeness: { present: ENGINEERING_CARD_FIELDS.length - cardMissing.length, of: ENGINEERING_CARD_FIELDS.length, missing: cardMissing },
    stages: {
      detect_recurring_problem: stage(true, { evidence_count: (p.evidence || []).length, source: p.source || 'caller' }),
      classify_the_problem: stage(true, { category: p.category }),
      identify_likely_architectural_cause: stage(true),
      propose_hypothesis: stage(true),
      define_minimum_prototype: stage(true, { runnable_as: proto.options ? 'declared options' : 'a code override the caller supplies' }),
      build_benchmark: stage(true, { benchmark_ids: ids }),
      compare_old_and_new: stage(false, { how: 'review_architecture_experiment / evaluateAdoption with a before run and an after run' }),
      review_side_effects: stage(false),
      request_or_record_approval: stage(false, { who: 'a human, via decideProposal' }),
      version_adopted_change: stage(false),
      retain_rollback_path: stage(true, { path: raw.rollback_path || DEFAULT_ROLLBACK_PATH }),
    },
    evaluation: null,
    decision: null,
    adopted_in_version: null,
    rollback_path: raw.rollback_path || DEFAULT_ROLLBACK_PATH,
    history: [{ status: 'proposed', at: timestamp, note: null }],
    never_self_applies: 'Part 4.8: this record changes nothing. Adoption is a human decision recorded with decideProposal, and the adopting code change is a versioned commit outside this layer.',
  };
  return { ok: true, proposal, findings: [] };
}

// ---------------------------------------------------------------- COMPARE + REVIEW SIDE EFFECTS

/**
 * Evaluate a proposal's adoption rule against two benchmark runs.
 *
 * Returns the verdict WITH the cells that produced it, and a copy of the proposal advanced to
 * `evaluated`. It never changes the proposal's status past that: approval is a person's.
 */
export function evaluateAdoption(proposal, beforeRun, afterRun, { timestamp = null } = {}) {
  if (!proposal || proposal.kind !== 'architecture_proposal') throw new TypeError('evaluateAdoption: a proposal from proposeImprovement is required');
  const comparison = BENCH.compareRuns(beforeRun, afterRun);
  const named = new Set(proposal.benchmark_ids);
  const rule = proposal.adoption_rule;
  const findings = [];

  const missing = proposal.benchmark_ids.filter((id) => !comparison.benchmarks.some((b) => b.benchmark_id === id && b.comparable));
  const onNamed = comparison.cells.filter((c) => named.has(c.benchmark_id));

  const improveRows = rule.must_improve.map((dim) => {
    const cells = onNamed.filter((c) => c.dimension === dim);
    const improved = cells.filter((c) => c.verdict === 'improved').map((c) => c.benchmark_id);
    const regressed = cells.filter((c) => c.verdict === 'regressed').map((c) => c.benchmark_id);
    const unchanged = cells.filter((c) => c.verdict === 'unchanged').map((c) => c.benchmark_id);
    const notComparable = proposal.benchmark_ids.filter((id) => !cells.some((c) => c.benchmark_id === id));
    return { dimension: dim, improved_on: improved, regressed_on: regressed, unchanged_on: unchanged, not_comparable_on: notComparable, satisfied: improved.length > 0 && regressed.length === 0, violated: regressed.length > 0 };
  });

  const protectedDims = rule.must_not_regress === 'all_others'
    ? [...new Set(onNamed.map((c) => c.dimension))].filter((d) => !rule.must_improve.includes(d))
    : rule.must_not_regress.filter((d) => !rule.must_improve.includes(d));
  const protectRows = protectedDims.map((dim) => {
    const cells = onNamed.filter((c) => c.dimension === dim);
    const regressed = cells.filter((c) => c.verdict === 'regressed').map((c) => c.benchmark_id);
    return { dimension: dim, regressed_on: regressed, satisfied: regressed.length === 0 };
  });

  const afterNamed = (afterRun.results || []).filter((r) => named.has(r.benchmark_id));
  const reproducibility = {
    required: !!rule.reproducibility_required,
    satisfied: afterNamed.length > 0 && afterNamed.every((r) => r.status === 'ran' && r.reproducible),
    not_reproducible: afterNamed.filter((r) => r.status !== 'ran' || !r.reproducible).map((r) => r.benchmark_id),
  };

  // Side effects: every regression the rule does not cover — other dimensions on the named
  // benchmarks when the rule lists specific ones, and anything on benchmarks the proposal never
  // named. Also a benchmark check that held before and fails now.
  const ruleDims = new Set([...rule.must_improve, ...protectedDims]);
  const sideEffects = [
    ...comparison.cells.filter((c) => c.verdict === 'regressed' && (!named.has(c.benchmark_id) || !ruleDims.has(c.dimension))).map((c) => ({ kind: 'dimension_regressed', benchmark_id: c.benchmark_id, dimension: c.dimension, before: c.before, after: c.after, covered_by_rule: false })),
    ...comparison.benchmarks.filter((b) => b.comparable).flatMap((b) => (b.check_flips || []).filter((f) => f.before === true && f.after === false).map((f) => ({ kind: 'check_regressed', benchmark_id: b.benchmark_id, check: f.check }))),
  ];

  const violated = improveRows.some((r) => r.violated) || protectRows.some((r) => !r.satisfied) || (reproducibility.required && !reproducibility.satisfied && afterNamed.length > 0);
  const satisfied = improveRows.every((r) => r.satisfied) && protectRows.every((r) => r.satisfied) && (!reproducibility.required || reproducibility.satisfied);
  let verdict, why;
  if (missing.length) {
    verdict = 'inconclusive';
    why = `${missing.join(', ')} ${missing.length === 1 ? 'was' : 'were'} not comparable between the two runs — the rule cannot be evaluated on a benchmark that did not run on both sides`;
  } else if (violated) {
    verdict = 'reject';
    why = [
      ...improveRows.filter((r) => r.violated).map((r) => `${r.dimension} REGRESSED on ${r.regressed_on.join(', ')}, and the rule requires it to improve`),
      ...protectRows.filter((r) => !r.satisfied).map((r) => `${r.dimension} regressed on ${r.regressed_on.join(', ')}, and the rule protects it`),
      ...(reproducibility.required && !reproducibility.satisfied ? [`the prototype is not reproducible on ${reproducibility.not_reproducible.join(', ')}`] : []),
    ].join('; ');
  } else if (satisfied) {
    verdict = 'adopt';
    why = `${improveRows.map((r) => `${r.dimension} improved on ${r.improved_on.join(', ')}`).join('; ')}; nothing the rule protects regressed; the prototype is reproducible${sideEffects.length ? ` — WITH ${sideEffects.length} side effect(s) outside the rule, listed for review` : ''}`;
  } else {
    verdict = 'inconclusive';
    why = improveRows.filter((r) => !r.satisfied).map((r) => `${r.dimension} did not improve on any named benchmark (unchanged on ${r.unchanged_on.join(', ') || 'none'}${r.not_comparable_on.length ? `, not comparable on ${r.not_comparable_on.join(', ')}` : ''})`).join('; ') || 'the measured dimensions tied';
  }

  findings.push(finding({
    id: `ADOPTION-${verdict.toUpperCase()}`,
    certainty: CERTAINTY.CERTAIN,
    statement: `${proposal.id}: ${verdict} — ${why}`,
    evidence: [
      evidence('measurement', `${comparison.counts.improved} improved, ${comparison.counts.regressed} regressed, ${comparison.counts.unchanged} unchanged cells across both runs`, comparison.counts),
      evidence('convention', 'the verdict applies the proposal\'s own adoption rule mechanically; whether the rule was the right rule is the reviewer\'s question'),
    ],
    suggestion: { text: verdict === 'adopt' ? 'record the decision with decideProposal — adoption is not automatic' : verdict === 'reject' ? 'record the rejection, or narrow the prototype and benchmark again' : 'widen the benchmark set or the prototype; the evidence does not decide it either way', reversible: true },
  }));
  for (const s of sideEffects) {
    findings.push(finding({
      id: 'ADOPTION-SIDE-EFFECT', certainty: CERTAINTY.CERTAIN,
      statement: s.kind === 'dimension_regressed' ? `side effect: ${s.dimension} regressed on ${s.benchmark_id} (${s.before} → ${s.after}), outside the adoption rule` : `side effect: the check "${s.check}" on ${s.benchmark_id} held before and fails now`,
      evidence: [evidence('measurement', 'a regression the adoption rule does not cover', s)],
    }));
  }

  const evaluation = {
    verdict, why,
    before: comparison.before, after: comparison.after,
    rule_evaluation: { must_improve: improveRows, must_not_regress: protectRows, reproducibility, missing_benchmarks: missing },
    side_effects: sideEffects,
    cells_on_named_benchmarks: onNamed,
    comparison_counts: comparison.counts,
    no_overall_score: BENCH.WHY_NO_OVERALL_SCORE,
    evaluated_at: timestamp,
    requires_user_approval: true,
  };

  const updated = {
    ...proposal,
    status: proposal.status === 'proposed' || proposal.status === 'evaluated' ? 'evaluated' : proposal.status,
    evaluation,
    stages: {
      ...proposal.stages,
      compare_old_and_new: { done: true, before_run: beforeRun.id, after_run: afterRun.id, verdict },
      review_side_effects: { done: true, side_effects: sideEffects.length },
    },
    history: [...proposal.history, { status: 'evaluated', at: timestamp, note: `${verdict}: ${why}` }],
  };
  return { verdict, why, evaluation, comparison, proposal: updated, findings, requires_user_approval: true };
}

// ---------------------------------------------------------------- APPROVAL, VERSION, ROLLBACK

/**
 * Record a human decision on a proposal. Returns `{ ok, proposal }` or `{ ok: false, refused_because }`.
 *
 *   approve    needs an evaluation (Part 60: COMPARE before APPROVAL). Recorded as overriding the
 *              verdict when the evaluation did not say adopt — loudly, never silently.
 *   adopt      needs `approve` first and a `version`; records the version and keeps the rollback path
 *   reject / defer   from any status but adopted / rolled_back
 *   roll_back  from adopted only
 */
export function decideProposal(proposal, { decision, version = null, author = 'user', note = null, timestamp = null } = {}) {
  if (!proposal || proposal.kind !== 'architecture_proposal') throw new TypeError('decideProposal: a proposal from proposeImprovement is required');
  if (!DECISIONS.includes(decision)) return { ok: false, refused_because: `decision must be one of ${DECISIONS.join(', ')} (got ${JSON.stringify(decision)})`, proposal };
  const refuse = (why) => ({ ok: false, refused_because: why, proposal });
  const record = (status, extra = {}) => ({
    ok: true,
    proposal: {
      ...proposal,
      ...extra,
      status,
      decision: { decision, by: author, at: timestamp, note, ...(extra.decision_extra || {}) },
      history: [...proposal.history, { status, at: timestamp, note: `${decision} by ${author}${note ? `: ${note}` : ''}` }],
    },
  });

  switch (decision) {
    case 'approve': {
      if (!proposal.evaluation) return refuse('Part 60 puts COMPARE OLD AND NEW before REQUEST OR RECORD APPROVAL: evaluate the proposal against two benchmark runs first (review_architecture_experiment). An approval with no measured comparison behind it would record a preference as evidence.');
      if (proposal.status === 'adopted' || proposal.status === 'rolled_back') return refuse(`a ${proposal.status} proposal cannot be approved again`);
      const overrides = proposal.evaluation.verdict !== 'adopt';
      const out = record('approved', {
        stages: { ...proposal.stages, request_or_record_approval: { done: true, by: author, at: timestamp, overrides_verdict: overrides, verdict_at_approval: proposal.evaluation.verdict } },
        decision_extra: { overrides_verdict: overrides, verdict_at_approval: proposal.evaluation.verdict },
      });
      if (overrides) {
        out.warning = `the evaluation's verdict was "${proposal.evaluation.verdict}" and this approval overrides it — recorded on the proposal, not hidden`;
      }
      return out;
    }
    case 'adopt': {
      if (proposal.status !== 'approved') return refuse(`only an approved proposal can be adopted (status is ${proposal.status})`);
      if (!version) return refuse('adoption needs a `version` — Part 60\'s VERSION ADOPTED CHANGE stage; the semantic layer version or the app version the change ships in');
      return record('adopted', {
        adopted_in_version: version,
        stages: { ...proposal.stages, version_adopted_change: { done: true, version, at: timestamp }, retain_rollback_path: { done: true, path: proposal.rollback_path, pre_adoption_run: proposal.evaluation?.before?.id ?? null } },
      });
    }
    case 'reject':
    case 'defer': {
      if (proposal.status === 'adopted' || proposal.status === 'rolled_back') return refuse(`a ${proposal.status} proposal cannot be ${decision === 'reject' ? 'rejected' : 'deferred'}; roll it back instead`);
      return record(decision === 'reject' ? 'rejected' : 'deferred', {
        stages: { ...proposal.stages, request_or_record_approval: { done: true, by: author, at: timestamp, decision } },
      });
    }
    case 'roll_back': {
      if (proposal.status !== 'adopted') return refuse(`only an adopted proposal can be rolled back (status is ${proposal.status})`);
      return record('rolled_back', {
        stages: { ...proposal.stages, retain_rollback_path: { ...proposal.stages.retain_rollback_path, done: true, rolled_back_at: timestamp, note } },
      });
    }
    default:
      return refuse('unreachable');
  }
}

// ---------------------------------------------------------------- limitations

export function improveLimitations() {
  return [
    'Nothing here changes code, a threshold, a rule or a preference (Part 4.8). A proposal is a record; adoption is a human decision recorded with decideProposal; the adopting change is a versioned commit outside this layer, and git is the rollback path.',
    'Detection reads four durable sources — memory candidates, a session ledger the caller supplies, the provenance graph\'s rolls_back edges, and a benchmark run — and nothing else. Part 60\'s self-critique questions need session history this layer never sees; they are listed, not answered.',
    'candidate_categories on a detected problem are offered, never chosen: CLASSIFY is a stage a person or the calling model performs, and proposeImprovement refuses a proposal that skipped it (ARCH-002).',
    'A prototype is runnable in two ways only: a declared ai/benchmark.js implementation option (no code), or a code override the caller supplies to runSuite under the label the proposal names. The app can run the first kind; the second needs the CLI (tools/benchmark.mjs --prototype) or a test.',
    'The adoption rule is evaluated mechanically on the proposal\'s named benchmarks. Regressions elsewhere are side effects, listed by name and never averaged into the verdict — and never used to change it, because whether a side effect is acceptable is the reviewer\'s call.',
    'Proposals are stored by the caller. The app keeps a session registry and writes each record into provenance as a note; there is no proposal store of its own, and this file does not pretend there is.',
  ];
}
