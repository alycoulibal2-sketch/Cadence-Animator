// Transactions, rollback and failure recovery (directive Part 55).
//
//   INSPECT → PLAN → DRY RUN OR PREVIEW → APPLY TO TRANSACTIONAL STATE → VALIDATE
//           → ACCEPT OR ROLLBACK
//
// Cadence already has whole-project undo, and it is good at what it does: one keystroke, always
// available, never wrong. What it cannot do is any of Part 55's other five recovery actions —
// roll back one property, roll back one time range, restore an approved baseline, compare a failed
// state against an accepted one, or replay an operation in preview. A clone stack has no idea
// which part of the clone was the change, so it cannot undo a subset of it.
//
// A transaction here closes that gap by recording the change as OPERATIONS with a computed
// inverse (see `ai/patch.js`) alongside the before-state. Scoped rollback is then the inverse
// patch, filtered — which is why `filterOps` reports what a scope EXCLUDES as well as what it
// keeps: a scoped rollback that silently skipped half its work would be worse than none.
//
// Three deliberate boundaries:
//
//   * **The ledger is session-scoped and in memory**, like the snapshot store. The durable record
//     of what happened is the provenance graph, which lives inside the project. A transaction is
//     the machinery of one change; provenance is the history. Persisting the machinery would mean
//     promising that a rollback works after a restart, and it would not — the before-snapshot it
//     depends on is in memory too.
//   * **No clock.** Timestamps come from the caller, as everywhere else in this layer. A
//     transaction with no timestamp reports `null` rather than inventing one.
//   * **Nothing is approved automatically.** A transaction lands in `applied`, not `accepted`.
//     Acceptance is a decision, and Part 12 forbids taking it on the user's behalf.

import { contentHash, shortHash } from './hash.js';
import { commitPatch, planPatch, makePatch, filterOps, describeOp } from './patch.js';
import { diffProjects } from './snapshot.js';
import { coverage } from './certainty.js';

/** A transaction's lifecycle. `applied` is not `accepted` — see the header. */
export const TXN_STATUS = Object.freeze(['previewed', 'applied', 'accepted', 'rejected', 'rolled_back', 'failed']);

const DEFAULT_CAPACITY = 200;

export class TransactionLedger {
  constructor({ capacity = DEFAULT_CAPACITY } = {}) {
    this.capacity = capacity;
    this.byId = new Map();
    this.order = [];
    this.seq = 0;
    this.dropped = 0;
  }

  /**
   * Record a transaction. Part 55's field list, in full; the fields Cadence cannot yet answer are
   * present and null with a reason, because a transaction record that quietly lacks
   * `baseline_comparison` reads as "compared, and fine".
   */
  open({
    request = null, intent = null, tool = null, plan = null, constraints = null,
    beforeSnapshot = null, parent = null, author = null, timestamp = null, mode = null,
  } = {}) {
    const n = ++this.seq;
    const id = `txn:${n}:${shortHash(contentHash({ n, tool, request, at: this.order[this.order.length - 1] || null }))}`;
    const txn = {
      transaction_id: id,
      parent_transaction_id: parent,
      user_request: request,
      interpreted_intent: intent,
      tool,
      // Part 55 wants a plan reference, not the plan: the plan carries a whole project copy, and a
      // ledger of those would be a memory leak with a nice name.
      plan_reference: plan ? { patch_id: plan.patch_id, operations: plan.ops?.length ?? null, result_hash: plan.result_hash } : null,
      constraint_set: constraints ? constraints.map((c) => ({ id: c.id, type: c.constraint_type, rule: c.property_or_semantic_rule, priority: c.priority })) : null,
      before_snapshot: beforeSnapshot,
      after_snapshot: null,
      changed_entities: [],
      changed_properties: [],
      changed_frame_range: null,
      expected_visual_effect: null,   // set below, honestly
      validation_results: null,
      // Filled in by `recordBaselineComparison` when `explain_change` runs against a baseline.
      // Until then it says "not compared", which is a different claim from "compared and clean" —
      // and the reason it is a field rather than an absence.
      baseline_comparison: {
        compared: false,
        reason: 'no baseline comparison has been run for this transaction. create_baseline before the edit and explain_change after it is what fills this in',
        blocked_on: null,
      },
      approval_status: 'not_requested',
      rollback_method: null,
      author,
      timestamp,
      mode,                            // Part 11's operating mode, when the caller names one
      status: 'previewed',
      operations: [],
      inverse: null,
      // Which of the inverse's operations have already been reversed. A scoped rollback undoes
      // part of a transaction; a later "roll back the rest" then has to know what is left, or it
      // would try to delete a key its own earlier call already removed and refuse in strict mode.
      rolled_back_ops: [],
      warnings: [],
      problems: [],
      history: [{ status: 'previewed', timestamp }],
    };
    txn.expected_visual_effect = {
      described: null,
      reason: 'predicting the visible result needs a render of a state that does not exist yet; only the data-side change is known at this point. The MEASURED visual effect is available after the fact from explain_change, which fills in baseline_comparison',
      blocked_on: 'a forward projection of a planned pose through the camera — the after-the-fact measurement exists (Part 43/44), the prediction does not',
    };
    this.byId.set(id, txn);
    this.order.push(id);
    this.#trim();
    return txn;
  }

  #trim() {
    while (this.byId.size > this.capacity) {
      const victim = this.order.find((id) => {
        const t = this.byId.get(id);
        // Never drop something a caller could still legitimately roll back.
        return t && t.status !== 'applied' && t.status !== 'accepted';
      });
      if (!victim) return;
      this.byId.delete(victim);
      this.order.splice(this.order.indexOf(victim), 1);
      this.dropped++;
    }
  }

  get(id) { return this.byId.get(id) || null; }

  list({ limit = 50, status = null } = {}) {
    const rows = this.order.map((id) => this.byId.get(id)).filter(Boolean)
      .filter((t) => !status || t.status === status);
    return {
      transactions: rows.slice(-limit).map(publicView),
      total: rows.length,
      dropped_from_ledger: this.dropped,
      capacity: this.capacity,
      storage: 'in memory, for this session only. The durable record is the provenance graph inside the project (Part 56); a rollback depends on the in-memory before-state and does NOT survive a restart',
    };
  }

  stats() {
    const byStatus = {};
    for (const id of this.order) {
      const t = this.byId.get(id);
      if (t) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    }
    return { count: this.byId.size, by_status: byStatus, dropped: this.dropped, capacity: this.capacity };
  }
}

/** The ledger view without the bulky internals a caller never needs. */
function publicView(t) {
  const { operations, inverse, ...rest } = t;
  return {
    ...rest,
    operation_count: operations.length,
    operations: operations.map((o) => o.description),
    rollback_available: !!inverse,
  };
}

// ---------------------------------------------------------------- the two-phase apply

/**
 * Preview a patch (Part 55's DRY RUN): plan it, check it, and record a `previewed` transaction.
 * Nothing is mutated — `project` is read only, and the caller can prove it with the returned
 * `state_unchanged` fingerprint pair.
 *
 * @param deps.check     `(project, patch, plan) => constraintReport` — usually a closure over
 *                       `constraints.checkPatch`. Injected rather than imported so a caller can
 *                       preview without a constraint set at all.
 * @param deps.scope     `(project, plan) => scopeReport`
 */
export function preview(project, patch, { ledger, request, intent, tool, constraints, author, timestamp, mode, parent, check, scope } = {}) {
  const beforeHash = contentHash(project);
  const plan = planPatch(project, patch);
  const constraintReport = check ? check(project, patch, plan) : null;
  const scopeReport = scope ? scope(project, plan) : null;
  const afterHash = contentHash(project);

  const txn = ledger.open({ request, intent, tool, plan, constraints, author, timestamp, mode, parent });
  txn.changed_entities = plan.changed_entities;
  txn.changed_properties = plan.changed_properties;
  txn.changed_frame_range = plan.changed_frame_range;
  txn.operations = plan.ops.filter((r) => r.effect !== 'no_op').map((r) => ({ description: describeOp(r.op), effect: r.effect }));
  txn.warnings = plan.warnings;
  txn.problems = plan.problems;
  txn.rollback_method = plan.inverse
    ? `apply the recorded inverse patch (${plan.inverse.ops.length} operation(s)); rollback_transaction can also scope it to one property or frame range`
    : 'nothing to roll back — this patch changes nothing';
  txn.validation_results = {
    plan_applicable: plan.applicable,
    constraints: constraintReport ? { checked: constraintReport.checked, violations: constraintReport.violations.length, allowed: constraintReport.allowed, recommendation: constraintReport.recommendation } : null,
    ran: constraintReport ? ['patch planning', 'constraint check'] : ['patch planning'],
  };

  const blocked = !plan.applicable || (constraintReport && !constraintReport.allowed);
  return {
    ...mutationResult(txn, {
      status: 'previewed',
      applied: false,
      blocked,
      plan,
      constraintReport,
      scopeReport,
    }),
    // The proof that a preview previewed. Cheap, and it turns "read-only" from a promise into a
    // checkable claim — the smoketest asserts it.
    state_unchanged: beforeHash === afterHash,
    diff_if_applied: plan.diff,
    result_hash: plan.result_hash,
  };
}

/**
 * Apply a previewed patch (Part 55's APPLY + VALIDATE).
 *
 * Refuses when the plan was refused or a constraint whose response is `refuse` was violated —
 * Part 54: "reject or flag violations before a commit". `force` exists because a user may
 * legitimately override their own constraint, and when they do it is recorded on the transaction
 * as an override rather than making the violation disappear.
 */
export function apply(project, patch, plan, { ledger, txn, constraintReport, force = false, timestamp = null, afterSnapshot = null } = {}) {
  const record = txn || ledger.open({ tool: 'apply_patch', plan, timestamp });

  if (!plan.applicable) {
    return fail(record, `the patch was refused at plan time: ${plan.summary}`, plan.problems, timestamp, constraintReport);
  }
  const refusing = constraintReport ? constraintReport.violations.filter((v) => v.response === 'refuse') : [];
  if (refusing.length && !force) {
    return fail(record, constraintReport.recommendation, refusing.map((v) => v.finding), timestamp, constraintReport);
  }

  let commit;
  try {
    commit = commitPatch(project, patch, plan);
  } catch (e) {
    // commitPatch restores the pre-commit state itself; this records that it happened rather than
    // letting a failed apply look like a transaction that never existed.
    return fail(record, `apply failed and the project was left unchanged: ${e.message}`, [], timestamp, constraintReport);
  }

  record.status = 'applied';
  record.history.push({ status: 'applied', timestamp });
  record.timestamp = record.timestamp ?? timestamp;
  record.after_snapshot = afterSnapshot;
  record.changed_entities = commit.changed_entities;
  record.changed_properties = commit.changed_properties;
  record.changed_frame_range = commit.changed_frame_range;
  record.operations = commit.ops.filter((r) => r.effect !== 'no_op').map((r) => ({ description: describeOp(r.op), effect: r.effect }));
  record.inverse = commit.inverse;
  record.warnings = commit.warnings;
  record.rollback_method = commit.inverse
    ? `rollback_transaction ${record.transaction_id} — the recorded inverse patch, optionally scoped to a property or a frame range`
    : 'nothing to roll back';
  record.validation_results = {
    ...(record.validation_results || {}),
    committed_hash_matches_plan: commit.result_hash === plan.result_hash,
    constraints: constraintReport ? { checked: constraintReport.checked, violations: constraintReport.violations.length, allowed: constraintReport.allowed, recommendation: constraintReport.recommendation } : null,
    overridden: refusing.length && force
      ? refusing.map((v) => ({ constraint: v.constraint_id, rule: v.rule, priority: v.priority, reason: v.reason }))
      : null,
    ran: ['patch planning', ...(constraintReport ? ['constraint check'] : []), 'post-commit hash verification'],
  };
  if (refusing.length && force) {
    record.approval_status = 'user_override';
  }

  return mutationResult(record, { status: 'applied', applied: true, blocked: false, plan, constraintReport, commit });
}

// `constraintReport` is threaded through deliberately: a refusal that did not say WHICH constraint
// it violated would be the least useful possible answer, and Part 12 forbids hiding the reason
// behind generic language. Every `fail` call site passes it.
function fail(record, reason, problems, timestamp, constraintReport = null) {
  record.status = 'failed';
  record.history.push({ status: 'failed', timestamp, reason });
  record.problems = problems;
  return {
    ...mutationResult(record, { status: 'failed', applied: false, blocked: true, constraintReport }),
    refused: true,
    reason,
    // Part 55's failure behaviour, made explicit in the result rather than left to be inferred.
    failure_behaviour: {
      state_preserved: true,
      partial_result_applied: false,
      what_is_known: reason,
      what_is_unknown: 'nothing was applied, so nothing about the resulting animation was measured',
      safe_recovery_actions: [
        'narrow the patch so it does not touch the protected target',
        'remove or relax the constraint explicitly (unlock_constraint for a persisted lock)',
        're-apply with force: true, which records the override on the transaction instead of hiding it',
      ],
    },
  };
}

// ---------------------------------------------------------------- rollback (TXN-003)

/**
 * Roll a transaction back — wholly, or scoped to one property or one frame range.
 *
 * The rollback is itself an applied patch with its own inverse, so it can be rolled back in turn.
 * Part 55 requires recovery from a recovery.
 *
 * @param opts.scope  `{}` for the whole transaction, or `{ property }` / `{ track, itemId }` /
 *                    `{ timeRange:[a,b] }`. Anything the scope excludes is REPORTED, not dropped
 *                    silently.
 */
export function rollback(project, ledger, transactionId, { scope = {}, timestamp = null, author = null } = {}) {
  const txn = ledger.get(transactionId);
  if (!txn) throw new Error(`no transaction "${transactionId}" in this session's ledger (it is in-memory only — list_transactions shows what is held)`);
  // `rolled_back` is deliberately NOT an error: a caller asking to roll back something already
  // reversed should get "there is nothing left" as data, not an exception. Only a transaction that
  // never applied anything is an error, because there is no state to reason about.
  if (txn.status !== 'applied' && txn.status !== 'accepted' && txn.status !== 'rolled_back') {
    throw new Error(`transaction ${transactionId} is "${txn.status}", not applied — there is nothing to roll back`);
  }
  if (!txn.inverse) throw new Error(`transaction ${transactionId} recorded no inverse (it changed nothing)`);

  // Only what has not already been reversed. Order is preserved: the inverse's operation order is
  // load-bearing (a move must be undone before a displaced key is restored), and filtering by
  // index keeps it.
  const done = new Set(txn.rolled_back_ops);
  const remaining = txn.inverse.ops.map((o, i) => ({ o, i })).filter(({ i }) => !done.has(i));
  const scoped = filterOps(remaining.map((x) => x.o), scope);
  const keptIndices = remaining.filter(({ o }) => scoped.ops.includes(o)).map(({ i }) => i);

  if (!scoped.ops.length) {
    return {
      transaction_id: transactionId,
      rolled_back: false,
      complete: !remaining.length,
      reason: remaining.length
        ? 'the scope matched none of the operations that are still applied'
        : 'every operation of this transaction has already been rolled back',
      scope,
      already_undone: txn.rolled_back_ops.map((i) => describeOp(txn.inverse.ops[i])),
      would_not_undo: scoped.dropped.map(describeOp),
      available_properties: [...new Set(remaining.map(({ o }) => (o.track ? `${o.itemId}/${o.track}` : o.path)).filter(Boolean))],
    };
  }

  const inversePatch = makePatch({
    ops: scoped.ops,
    intent: `rollback of ${transactionId}${Object.keys(scope).length ? ` (scoped: ${JSON.stringify(scope)})` : ''}`,
    strict: true,
    author: author || 'rollback',
  });
  const plan = planPatch(project, inversePatch);
  const rollbackTxn = ledger.open({
    request: `rollback ${transactionId}`,
    intent: inversePatch.intent,
    tool: 'rollback_transaction',
    plan,
    parent: transactionId,
    author,
    timestamp,
  });

  if (!plan.applicable) {
    // A scoped rollback CAN legitimately fail: the state may have moved on since. Reporting that
    // is the whole job — a rollback that half-worked would be the worst outcome available.
    const failed = fail(rollbackTxn, `the recorded inverse no longer applies to the current state: ${plan.summary}`, plan.problems, timestamp);
    return {
      ...failed,
      transaction_id: transactionId,
      rolled_back: false,
      complete: false,
      hint: 'the project changed after this transaction in a way that consumed what the inverse expected. A whole-project undo, or restoring the before-snapshot, still works.',
      before_snapshot: txn.before_snapshot,
    };
  }

  const result = apply(project, inversePatch, plan, { ledger, txn: rollbackTxn, timestamp });
  let whole = false;
  if (result.applied) {
    txn.rolled_back_ops = [...new Set([...txn.rolled_back_ops, ...keptIndices])].sort((a, b) => a - b);
    whole = txn.rolled_back_ops.length === txn.inverse.ops.length;
    txn.status = whole ? 'rolled_back' : 'applied';
    txn.history.push({ status: whole ? 'rolled_back' : 'partially_rolled_back', timestamp, by: rollbackTxn.transaction_id, scope });
  }
  const stillApplied = txn.inverse.ops.filter((_, i) => !txn.rolled_back_ops.includes(i));
  return {
    ...result,
    transaction_id: transactionId,
    rollback_transaction_id: rollbackTxn.transaction_id,
    rolled_back: result.applied,
    complete: whole,
    scope,
    undone: scoped.ops.map(describeOp),
    // The honest half of a scoped rollback: what this call left in place, and what of the whole
    // transaction is still applied after it.
    not_undone: scoped.dropped.map(describeOp),
    still_applied: stillApplied.map(describeOp),
    note: whole
      ? 'the whole transaction is now reversed'
      : `${stillApplied.length} operation(s) of this transaction are still applied — call rollback_transaction again without a scope to reverse the rest`,
  };
}

/** Record a decision on a transaction (Part 55's ACCEPT). Never automatic. */
export function decide(ledger, transactionId, decision, { timestamp = null, author = null, reason = null } = {}) {
  const txn = ledger.get(transactionId);
  if (!txn) throw new Error(`no transaction "${transactionId}"`);
  if (decision !== 'accepted' && decision !== 'rejected') throw new TypeError("decide: decision must be 'accepted' or 'rejected'");
  txn.status = decision;
  txn.approval_status = decision;
  txn.history.push({ status: decision, timestamp, author, reason });
  return publicView(txn);
}

/**
 * Attach the outcome of a baseline comparison to a transaction (Part 55's `baseline_comparison`).
 *
 * Written by `explain_change`, not by the apply path: an apply cannot compare against a baseline
 * because the comparison needs the AFTER state to have been rendered, which happens later. Only
 * an explanation that actually classified this transaction's own differences may write here, so
 * `explained` counts the differences that named it — a comparison that found nothing to do with
 * this transaction records `explained: 0` rather than an implicit clean bill.
 */
export function recordBaselineComparison(ledger, transactionId, comparison) {
  const txn = ledger.get(transactionId);
  if (!txn) return null;
  txn.baseline_comparison = {
    compared: true,
    baseline_id: comparison.baseline_id ?? null,
    baseline_name: comparison.baseline_name ?? null,
    explanation_id: comparison.explanation_id ?? null,
    differences_explained_by_this_transaction: comparison.explained ?? 0,
    unexpected_differences_in_the_same_check: comparison.unexpected ?? 0,
    timestamp: comparison.timestamp ?? null,
    reason: null,
    blocked_on: null,
    note: 'this records that a comparison RAN and what it attributed to this transaction. It is not an approval — Part 55 keeps acceptance separate, and that is `approval_status`',
  };
  txn.history.push({ status: txn.status, timestamp: comparison.timestamp ?? null, note: `baseline comparison against ${comparison.baseline_name || comparison.baseline_id}` });
  return txn.baseline_comparison;
}

// ---------------------------------------------------------------- the mutating-tool result shape

/**
 * The shape Part 50 requires of EVERY mutating tool:
 *
 *   transaction ID · changed object IDs · changed properties · changed time range ·
 *   constraints checked · baseline relationship · preview or validation status ·
 *   rollback availability · warnings
 *
 * One function so the eight tools cannot drift apart, and so a missing field is a change here
 * rather than an omission nobody notices in one of them.
 */
export function mutationResult(txn, { status, applied, blocked, plan = null, constraintReport = null, scopeReport = null, commit = null } = {}) {
  return {
    transaction_id: txn.transaction_id,
    status,
    applied,
    blocked,
    changed_entities: txn.changed_entities,
    changed_properties: txn.changed_properties,
    changed_frame_range: txn.changed_frame_range,
    operations: txn.operations,
    constraints_checked: constraintReport
      ? {
        count: constraintReport.checked,
        violations: constraintReport.violations,
        conflicts: constraintReport.conflicts,
        allowed: constraintReport.allowed,
        recommendation: constraintReport.recommendation,
        not_checked: constraintReport.coverage.notRun,
        unresolved_targets: constraintReport.unresolved_targets,
      }
      : { count: 0, violations: [], conflicts: [], allowed: true, recommendation: 'no constraints were supplied, and none are persisted for these targets', not_checked: ['no constraint check was requested'], unresolved_targets: [] },
    baseline_relationship: txn.baseline_comparison,
    validation: txn.validation_results,
    rollback: {
      available: !!txn.inverse || status === 'previewed',
      method: txn.rollback_method,
      tool: applied ? `rollback_transaction with transaction_id "${txn.transaction_id}"` : null,
      scoped: 'rollback_transaction accepts { property } or { timeRange } to reverse part of a transaction; anything the scope excludes is reported in not_undone',
      also: 'whole-project undo (Ctrl+Z / the undo tool) reverses the last applied patch too, coarsely',
    },
    warnings: txn.warnings,
    problems: txn.problems,
    scope: scopeReport,
    coverage: coverage({
      scope: applied ? 'the patch was applied and its post-commit hash verified against the plan' : 'planning and constraint checking only; nothing was applied',
      frames: txn.changed_frame_range ? [txn.changed_frame_range.start, txn.changed_frame_range.end] : null,
      loop: 'fast',
      notRun: [
        'nothing was rendered and no baseline was compared BY THIS CALL — the passes and the comparison exist (Part 43/44); create_baseline before the edit and explain_change after it is what runs them, and inspect_transaction then reports the outcome in baseline_comparison',
        'no motion measurement BY THIS CALL — velocity, curvature and contact drift exist (Part 23) and run on either state: analyze_motion and analyze_contacts against the committed project, and the `contact_drift` constraint against the planned one before it is applied. A transaction record does not measure them itself',
        ...(plan?.ui_affordances_not_applied?.length
          ? [`${plan.ui_affordances_not_applied.length} editor affordance(s) were deliberately not reproduced — see the warnings`]
          : []),
      ],
    }),
    summary: blocked
      ? `refused — ${constraintReport?.recommendation || plan?.summary || 'see problems'}`
      : applied
        ? `applied ${txn.operations.length} operation(s)${txn.changed_frame_range ? ` across frames ${txn.changed_frame_range.start}–${txn.changed_frame_range.end}` : ''}; reversible via ${txn.transaction_id}`
        : `previewed ${txn.operations.length} operation(s) — nothing was changed`,
  };
}

/** Compare a failed or rolled-back state with an accepted one (Part 55's "compare failed and
 *  accepted states"). Snapshot-based, so it works on anything the snapshot store still holds. */
export function compareStates(beforeProject, afterProject) {
  const d = diffProjects(beforeProject, afterProject);
  return {
    ...d,
    methods_used: ['scene-graph difference', 'keyframe-level curve difference'],
    // These say what THIS function did not do, which is not the same as what the build cannot do.
    // Exact-pixel, edge and object-ID comparison all exist now (`ai/raster.js`) — compareStates is
    // handed two project objects and no rasters, so it cannot reach them. Naming the tool that can
    // is the difference between "unavailable" and "unavailable here".
    methods_unavailable: [
      'pixel, edge-displacement and object-ID comparison: these EXIST (Part 43/44) but need rendered passes, and compareStates receives only project data — create_baseline then explain_change runs them',
      'perceptual comparison — nothing in this build judges whether a difference is visually meaningful (REG-003)',
      'depth, normal, motion-vector and alpha comparison — those passes do not exist (OBS-004/005/006)',
      'temporal comparison across a frame range: flicker and one-frame pops between sampled frames are not looked for by anything',
    ],
  };
}
