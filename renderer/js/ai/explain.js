// Regression classification and change explanation (directive Parts 44 and 45).
//
// This is the module Phase 4 exists for: "Cadence can explain what changed after a scoped edit."
//
// It runs Part 44's regression workflow over two states and produces Part 45's explanation. The
// three things it is careful about are the three that are easy to get wrong:
//
//   1. A DIFFERENCE IS NOT A DEFECT. Part 44 classifies every difference as expected, unexpected,
//      uncertain or approved. Most differences after an edit are expected — that is what the edit
//      was for — and a report that treats them all as findings is noise that trains a reader to
//      skip it. `expected` here means a specific applied transaction names the entity; not "it
//      looks like something we did".
//
//   2. EVIDENCE THAT WAS NOT GATHERED IS NOT EVIDENCE OF ABSENCE. If the baseline's snapshot was
//      evicted, the data diff did not run, and every classification that would have needed it is
//      `uncertain` — never `expected`, and never a clean pass. Same for a pass that was not
//      rendered, or two renders from different viewpoints.
//
//   3. "The explanation engine must not invent causal certainty. If several causes remain
//      plausible, list them in rank order and show the evidence that distinguishes them." So a
//      cause is capped: with a second live candidate, the top one cannot be reported as `certain`,
//      and each candidate carries what would rule it in or out.
//
// Pure. It takes two project objects, some rasters, and a list of transactions. It renders nothing
// and mutates nothing.

import { CERTAINTY, certaintyRank, coverage, evidence, finding, sortFindings } from './certainty.js';
import { contentHash } from './hash.js';
import * as ids from './ids.js';
import { diffProjects } from './snapshot.js';
import { findApproval } from './baseline.js';
import { edgeDifference, idDifference, maskDifference, pixelDifference, signature, signatureDifference } from './raster.js';
import { PASSES } from './observe.js';

/** Part 44's four values, exactly. */
export const CLASSIFICATION = Object.freeze({
  EXPECTED: 'expected',
  UNEXPECTED: 'unexpected',
  UNCERTAIN: 'uncertain',
  APPROVED: 'approved',
});

/**
 * Compare a state against a baseline and explain the difference.
 *
 * @param o.baseline       a Baseline record (ai/baseline.js), or null to compare two states directly
 * @param o.before         the project object the baseline was taken from, or null if it is gone
 * @param o.after          the current project object
 * @param o.observations   `[{ frame, pass, raster?, digest, signature, camera }]` measured NOW
 * @param o.baselineRasters `(frame, pass) => raster | null` — the session's raster store, when it
 *                          still holds the baseline's own rasters. Absent means the comparison
 *                          degrades to signatures and says so.
 * @param o.transactions   plain transaction records (`ledger.list().transactions`)
 * @param o.expectedMovers `[{ entityId, name, reason }]` — parts the data change should move, from
 *                          `scope.propagateTracks`. This is what turns "the forearm moved" from an
 *                          observation into "the forearm moved, as the shoulder edit implies".
 *                          `null` (the default) and `[]` mean DIFFERENT things and are treated
 *                          differently: null is "nobody asked which parts should have moved", so
 *                          a visual difference is `uncertain`; `[]` is "we asked, and the answer
 *                          is none", so an object that moved anyway is `unexpected`. Collapsing
 *                          the two would turn every unasked question into a clean bill.
 */
export function explainChange({
  baseline = null, before = null, after, observations = [], baselineRasters = null,
  transactions = [], expectedMovers = null, timestamp = null, request = null,
} = {}) {
  if (!after) throw new TypeError('explainChange: an `after` project is required');

  const notRun = [];
  const differences = [];

  // ---- step 1-3 of Part 44's workflow: what changed in the data, and where in time
  let diff = null;
  if (before) {
    diff = diffProjects(before, after);
  } else {
    notRun.push(baseline
      ? 'the data-level difference — the snapshot this baseline pins is no longer held, so WHAT changed in the project cannot be listed. The digests below still prove WHETHER the render changed'
      : 'the data-level difference — no before-state was supplied');
  }

  const moverIndex = expectedMovers ? new Map(expectedMovers.map((m) => [m.entityId, m])) : null;
  if (!moverIndex) notRun.push('the propagation question — no caller asked which objects SHOULD have moved, so a rendered object that moved cannot be told from one that moved for a reason');
  const txnIndex = indexTransactions(transactions);

  // ---- data differences
  if (diff) {
    for (const t of diff.tracks) {
      const trackEntity = ids.trackId(t.itemId, t.track);
      const keyEntities = [
        ...(t.keys_added || []).map((f) => ids.keyId(t.itemId, t.track, f)),
        ...(t.keys_removed || []).map((f) => ids.keyId(t.itemId, t.track, f)),
        ...(t.keys_modified || []).map((m) => ids.keyId(t.itemId, t.track, m.t)),
      ];
      const frames = [
        ...(t.keys_added || []), ...(t.keys_removed || []),
        ...(t.keys_modified || []).map((m) => m.t),
      ].sort((a, b) => a - b);
      differences.push(makeDifference({
        kind: 'curve',
        what: describeTrackChange(t),
        where: { item: t.itemId, track: t.track, entity: trackEntity },
        when: frames.length ? { start: frames[0], end: frames[frames.length - 1], frames } : null,
        objects: [trackEntity, ...keyEntities],
        passes: ['curve difference (no render involved)'],
        detail: t,
        baseline, txnIndex,
      }));
    }
    for (const id of diff.items.added) {
      differences.push(makeDifference({
        kind: 'object_created', what: `item "${id}" exists now and did not before`,
        where: { item: id, entity: ids.itemId(id) }, when: null,
        objects: [ids.itemId(id)], passes: ['scene-graph difference'], detail: null, baseline, txnIndex,
      }));
    }
    for (const id of diff.items.removed) {
      differences.push(makeDifference({
        kind: 'object_deleted', what: `item "${id}" existed before and does not now`,
        where: { item: id, entity: ids.itemId(id) }, when: null,
        objects: [ids.itemId(id)], passes: ['scene-graph difference'], detail: null, baseline, txnIndex,
      }));
    }
    for (const c of diff.items.changed) {
      differences.push(makeDifference({
        kind: 'object_property', what: `"${c.name}" changed: ${c.fields.join(', ')}`,
        where: { item: c.itemId, entity: ids.itemId(c.itemId) }, when: null,
        objects: [ids.itemId(c.itemId)], passes: ['scene-graph difference'], detail: c, baseline, txnIndex,
      }));
    }
    for (const f of diff.project_fields) {
      differences.push(makeDifference({
        kind: 'project_property', what: `project field "${f}" changed`,
        where: { entity: ids.projectId(after), field: f }, when: null,
        objects: [ids.projectId(after)], passes: ['scene-graph difference'], detail: null, baseline, txnIndex,
      }));
    }
  }

  // ---- visual differences
  const visual = compareObservations({ baseline, observations, baselineRasters, notRun });

  // A SILHOUETTE difference names no object — it is one outline for the whole rig, and by itself
  // it can only say "something moved". Attributing it needs the object-ID pass at the same frame,
  // which is exactly what the two passes are for as a pair. Without one, the silhouette difference
  // is `uncertain`, not `unexpected`: "I cannot tell what moved" is a different report from
  // "something moved that nothing explains", and only the second is a defect.
  const movedByFrame = new Map();
  for (const v of visual.comparisons) {
    if (v.pass === 'object_id' && v.objects_moved) {
      movedByFrame.set(v.frame, [...(v.objects_moved.map((m) => m.entity)), ...(v.objects_appeared || []), ...(v.objects_disappeared || [])]);
    }
  }

  let occlusionSuspects = 0;
  for (const v of visual.comparisons) {
    if (!v.changed) continue;

    if (v.pass === 'object_id' && v.objects_moved) {
      // ONE DIFFERENCE PER OBJECT. Part 44 asks each difference "which objects were affected?",
      // and a single row saying "five things moved" cannot answer it — one explained mover would
      // carry the other four past the classifier.
      //
      // But an object-ID pass measures VISIBLE PIXELS, so an arm swinging across a torso changes
      // the torso's visible region without the torso having moved at all. That occlusion case is
      // indistinguishable from a real move with this pass alone, so an object nothing in the data
      // reaches, at a frame where something else DID legitimately move, is `uncertain` with the
      // reason — not `unexpected`. Calling occlusion a regression would make the pass unusable.
      const anyExplained = movedByFrame.get(v.frame)?.some((e) => moverIndex?.has(e) || txnIndex.byEntity.has(e));
      const rows = [
        ...(v.objects_moved || []).map((m) => ({ entity: m.entity, what: `${m.entity} moved ${m.shift_px}px on screen (${m.pixel_delta >= 0 ? '+' : ''}${m.pixel_delta} px of coverage)` })),
        ...(v.objects_appeared || []).map((e) => ({ entity: e, what: `${e} became visible` })),
        ...(v.objects_disappeared || []).map((e) => ({ entity: e, what: `${e} is no longer visible` })),
      ];
      const shown = rows.slice(0, 12);
      if (rows.length > shown.length) notRun.push(`${rows.length - shown.length} further object(s) changed on screen at frame ${v.frame} and are not listed individually`);
      for (const row of shown) {
        const unreachable = anyExplained && !moverIndex?.has(row.entity) && !txnIndex.byEntity.has(row.entity);
        if (unreachable) occlusionSuspects++;
        differences.push(makeDifference({
          kind: 'object_id_shift',
          what: row.what,
          where: { entity: row.entity, pass: v.pass, granularity: 'pixel' },
          when: { start: v.frame, end: v.frame, frames: [v.frame] },
          objects: [row.entity],
          attribution: 'from this pass',
          passes: [v.pass],
          detail: v.detail?.moved?.find((m) => m.entity === row.entity) ?? null,
          baseline, txnIndex, visual: true, movers: moverIndex, dataAvailable: !!diff,
          occlusionPossible: unreachable,
        }));
      }
      continue;
    }

    differences.push(makeDifference({
      kind: 'silhouette',
      what: v.statement,
      where: { region: v.region ?? null, pass: v.pass, granularity: v.granularity ?? 'pixel' },
      when: { start: v.frame, end: v.frame, frames: [v.frame] },
      objects: movedByFrame.get(v.frame) || [],
      attribution: movedByFrame.has(v.frame)
        ? 'borrowed from the object-ID pass at the same frame — a silhouette names no object of its own'
        : 'none: a silhouette difference cannot say what moved, and no object-ID pass was rendered at this frame',
      passes: [v.pass],
      detail: v,
      baseline, txnIndex,
      // A visual difference is explained by a data difference that reaches the same objects. A
      // rendered part that nothing in the data reaches is the interesting case, and the reason
      // the pass is worth its cost.
      visual: true,
      movers: moverIndex,
      dataAvailable: !!diff,
    }));
  }

  // ---- step 9: the explanation
  const counts = countBy(differences, (d) => d.classification);
  const causes = rankCauses({ differences, diff, txnIndex, occlusionSuspects });
  const findings = buildFindings({ differences, counts, causes, visual, diff });

  for (const p of Object.values(PASSES)) if (!p.implemented) notRun.push(`the ${p.part43} was not rendered — ${p.unblocked_by}`);
  if (!observations.length) notRun.push('no render pass was observed at all, so nothing here is evidence about the visible result');

  const frames = [...new Set(observations.map((o) => o.frame))].sort((a, b) => a - b);

  return {
    id: `explain:${contentHash({ b: baseline?.id ?? null, d: differences.map((x) => x.id), t: timestamp }).slice(0, 10)}`,
    baseline: baseline ? { id: baseline.id, name: baseline.name, timestamp: baseline.timestamp } : null,
    request: request || null,
    timestamp,

    header: header(differences, counts, frames),
    differences,
    classification_counts: counts,
    ranked_causes: causes,
    minimum_safe_correction: minimumSafeCorrection(differences, causes),
    findings: sortFindings(findings),

    data_difference: diff,
    visual_difference: visual,
    expected_movers: expectedMovers,

    coverage: coverage({
      scope: baseline
        ? `the current project against baseline "${baseline.name}" — ${differences.length} difference(s) over ${observations.length} observation(s)`
        : `two project states — ${differences.length} difference(s)`,
      frames: frames.length ? frames : null,
      loop: 'fast',
      notRun,
    }),
  };
}

// ---------------------------------------------------------------- differences

function makeDifference({ kind, what, where, when, objects, passes, detail, baseline, txnIndex, visual = false, movers = null, dataAvailable = true, attribution = null, occlusionPossible = false }) {
  const id = `diff:${contentHash({ kind, what, where, when }).slice(0, 10)}`;

  // Part 44: "Is it explained by an approved transaction?"
  const explaining = [];
  for (const o of objects) {
    for (const t of txnIndex.byEntity.get(o) || []) if (!explaining.includes(t)) explaining.push(t);
  }
  // A visual difference is rarely named by a transaction directly — a transaction changes a KEY,
  // and what moves on screen is a PART. The propagation list is the bridge, and it is the whole
  // reason `expectedMovers` is an input rather than an afterthought.
  const impliedBy = [];
  if (movers) {
    for (const o of objects) {
      const m = movers.get(o);
      if (m) impliedBy.push(m);
    }
  }

  const approval = findApproval(baseline, { target: where.entity || objects[0] || null, kind });

  let classification, why, certainty;
  if (approval) {
    classification = CLASSIFICATION.APPROVED;
    why = `an approval on this baseline covers it: ${approval.reason}`;
    certainty = CERTAINTY.CERTAIN;
  } else if (!dataAvailable) {
    classification = CLASSIFICATION.UNCERTAIN;
    why = 'the data-level difference could not be computed, so there is no way to tell whether an edit explains this';
    certainty = CERTAINTY.USER_INTENT_REQUIRED;
  } else if (explaining.length) {
    classification = CLASSIFICATION.EXPECTED;
    why = `${explaining.length} applied transaction(s) name this entity as changed: ${explaining.map((t) => t.transaction_id).join(', ')}`;
    certainty = CERTAINTY.CERTAIN;
  } else if (impliedBy.length) {
    classification = CLASSIFICATION.EXPECTED;
    why = `no transaction names this object directly, but it moves as a consequence of one that was edited: ${impliedBy.map((m) => m.reason).join('; ')}`;
    // Propagation is a structural inference, not a measurement of this specific pixel change.
    certainty = CERTAINTY.HIGHLY_LIKELY;
  } else if (visual && !movers) {
    // Asked nothing, so answer nothing. An unasked question is not a clean bill — this is the
    // single easiest place in the module to accidentally report "expected" by omission.
    classification = CLASSIFICATION.UNCERTAIN;
    why = 'nothing supplied a propagation list, so "should this object have moved?" was never asked';
    certainty = CERTAINTY.USER_INTENT_REQUIRED;
  } else if (visual && !objects.length) {
    classification = CLASSIFICATION.UNCERTAIN;
    why = `this pass reports that something changed but names no object, so it cannot be attributed (${attribution || 'no attribution source'})`;
    certainty = CERTAINTY.USER_INTENT_REQUIRED;
  } else if (occlusionPossible) {
    classification = CLASSIFICATION.UNCERTAIN;
    why = 'nothing in the data moves this object, but something that DOES move changed at the same frame. An object-ID pass measures visible pixels, so an object partly hidden by one that moved reports a change it did not make — this pass cannot tell that from a real move. A depth pass (OBS-004) or an isolation render (OBS-007) would separate them';
    certainty = CERTAINTY.POSSIBLE;
  } else {
    classification = CLASSIFICATION.UNEXPECTED;
    why = 'no applied transaction names this entity, and it is not downstream of anything that was edited';
    certainty = CERTAINTY.HIGHLY_LIKELY;
  }

  return {
    id,
    kind,
    // Part 44's ten questions, in Part 44's order.
    what_changed: what,
    where_did_it_change: where,
    when_did_it_change: when,
    which_objects_or_passes: { objects, passes, attribution },
    explained_by_transaction: explaining.map((t) => ({
      transaction_id: t.transaction_id,
      intent: t.interpreted_intent,
      request: t.user_request,
      status: t.status,
    })),
    is_deterministic: {
      value: kind === 'curve' || kind === 'object_property' || kind === 'project_property',
      reason: kind === 'silhouette' || kind === 'object_id_shift'
        ? 'a render is deterministic for a fixed viewpoint and resolution, which the camera fingerprint pins — but the GPU is not bit-guaranteed across drivers, so a render is treated as reproducible rather than proven'
        : 'read directly from project data',
    },
    violates_constraint: {
      value: null,
      reason: 'this compares two states; constraint enforcement happens at patch time (CON-005) and a state that already exists cannot be refused retrospectively',
    },
    needs_user_intent: classification === CLASSIFICATION.UNEXPECTED || classification === CLASSIFICATION.UNCERTAIN,
    classification,
    classification_reason: why,
    classification_certainty: certainty,
    implied_by: impliedBy,
    detail,
  };
}

function describeTrackChange(t) {
  const bits = [];
  if (t.change === 'added') return `track "${t.track}" is new (${t.keys} key(s))`;
  if (t.change === 'removed') return `track "${t.track}" was removed (${t.keys} key(s))`;
  if (t.keys_added?.length) bits.push(`${t.keys_added.length} key(s) added at ${t.keys_added.join(', ')}`);
  if (t.keys_removed?.length) bits.push(`${t.keys_removed.length} key(s) removed at ${t.keys_removed.join(', ')}`);
  if (t.keys_modified?.length) {
    bits.push(`${t.keys_modified.length} key(s) modified at ${t.keys_modified.map((m) => `${m.t} (${m.fields.join('/')})`).join(', ')}`);
  }
  if (t.space_changed) bits.push(`track space changed from ${t.space_changed.from} to ${t.space_changed.to}`);
  return `"${t.track}": ${bits.join('; ')}`;
}

// ---------------------------------------------------------------- visual comparison

function compareObservations({ baseline, observations, baselineRasters, notRun }) {
  const comparisons = [];
  const unmatched = [];
  const baseObs = new Map((baseline?.observations || []).map((o) => [`${o.pass}@${o.frame}`, o]));

  for (const now of observations) {
    const key = `${now.pass}@${now.frame}`;
    const was = baseObs.get(key);
    if (!was) {
      unmatched.push({ ...key ? { observation: key } : {}, reason: 'the baseline holds no observation of this pass at this frame, so there is nothing to compare it against' });
      continue;
    }
    baseObs.delete(key);

    // The cheapest possible answer first: identical digests prove identical pixels, and no further
    // comparison can find anything.
    if (was.digest && now.digest && was.digest === now.digest) {
      comparisons.push({
        pass: now.pass, frame: now.frame, changed: false, method: 'digest',
        statement: `${now.pass} at frame ${now.frame} is byte-identical to the baseline`,
      });
      continue;
    }

    const oldRaster = baselineRasters ? baselineRasters(now.frame, now.pass) : null;
    const newRaster = now.raster || null;

    if (oldRaster && newRaster) {
      comparisons.push(fullComparison(oldRaster, newRaster, now));
      continue;
    }

    // Degraded path: the baseline came off disk, or the raster store dropped it.
    const sigNow = now.signature || (newRaster ? signature(newRaster) : null);
    const sigThen = was.signature || (oldRaster ? signature(oldRaster) : null);
    const sd = signatureDifference(sigThen, sigNow);
    notRun.push(`a full-resolution comparison of ${now.pass} at frame ${now.frame} — the baseline's own raster is no longer in memory, so the answer is at ${sd.granularity || 'block'} granularity only`);
    comparisons.push({
      pass: now.pass, frame: now.frame,
      changed: sd.comparable ? sd.changed : true,
      method: 'signature',
      degraded: true,
      statement: sd.comparable
        ? `${now.pass} at frame ${now.frame} differs from the baseline in ${sd.changed_blocks} of ${sd.total_blocks} blocks (block granularity only — the full raster is gone)`
        : `${now.pass} at frame ${now.frame}: the digests differ, but the comparison could not run — ${sd.reason}`,
      region: sd.block_region || null,
      granularity: sd.granularity || null,
      detail: sd,
    });
  }

  for (const [key, was] of baseObs) {
    unmatched.push({ observation: key, reason: 'the baseline observed this pass at this frame and the current run did not, so a difference there would not have been seen' });
    notRun.push(`${was.pass} at frame ${was.frame} — the baseline observed it and this comparison did not`);
  }

  return { comparisons, unmatched_observations: unmatched };
}

function fullComparison(oldRaster, newRaster, now) {
  if (now.pass === 'object_id') {
    const d = idDifference(oldRaster, newRaster);
    if (!d.comparable) {
      return { pass: now.pass, frame: now.frame, changed: true, method: 'object_id', comparable: false, statement: `object-ID at frame ${now.frame} could not be compared: ${d.reason}`, detail: d };
    }
    const moved = d.moved.map((m) => ({ entity: m.entity, shift_px: m.centroid_shift_px, pixel_delta: m.pixel_delta }));
    const names = [...d.appeared.map((x) => `${x.entity} appeared`), ...d.disappeared.map((x) => `${x.entity} disappeared`),
      ...d.moved.slice(0, 6).map((m) => `${m.entity} moved ${m.centroid_shift_px}px`)];
    return {
      pass: now.pass, frame: now.frame, changed: d.changed, method: 'object_id',
      statement: d.changed
        ? `object-ID at frame ${now.frame}: ${names.join(', ')}${d.moved.length > 6 ? ` and ${d.moved.length - 6} more` : ''}`
        : `object-ID at frame ${now.frame}: every visible object holds the same pixels`,
      objects_moved: moved,
      objects_appeared: d.appeared.map((x) => x.entity),
      objects_disappeared: d.disappeared.map((x) => x.entity),
      trustworthy: d.trustworthy,
      detail: d,
    };
  }

  const mask = maskDifference(oldRaster, newRaster);
  const edge = edgeDifference(oldRaster, newRaster);
  const px = pixelDifference(oldRaster, newRaster);
  if (!mask.comparable) {
    return { pass: now.pass, frame: now.frame, changed: true, method: 'silhouette_coverage', comparable: false, statement: `${now.pass} at frame ${now.frame} could not be compared: ${mask.reason}`, detail: { mask, edge, px } };
  }
  return {
    pass: now.pass, frame: now.frame, changed: mask.changed || px.changed, method: 'silhouette_coverage',
    statement: mask.changed
      ? `${now.pass} at frame ${now.frame}: ${mask.pixels_gained} px gained, ${mask.pixels_lost} px lost, outline displaced by up to ${edge.max_displacement_px ?? '?'} px (mean ${edge.mean_displacement_px ?? '?'}), IoU ${mask.intersection_over_union.toFixed(4)}`
      : `${now.pass} at frame ${now.frame}: unchanged`,
    region: px.region || mask.region,
    displacement_px: edge.max_displacement_px ?? null,
    detail: { mask, edge, px },
  };
}

// ---------------------------------------------------------------- causes

function indexTransactions(transactions) {
  const byEntity = new Map();
  const applied = [];
  for (const t of transactions || []) {
    // A previewed transaction changed nothing, and a rolled-back one is no longer in the state
    // being compared. Letting either explain a difference would be the classic false clean bill.
    if (t.status !== 'applied' && t.status !== 'accepted') continue;
    applied.push(t);
    for (const e of t.changed_entities || []) {
      if (!byEntity.has(e)) byEntity.set(e, []);
      byEntity.get(e).push(t);
    }
    for (const e of t.changed_properties || []) {
      if (!byEntity.has(e)) byEntity.set(e, []);
      if (!byEntity.get(e).includes(t)) byEntity.get(e).push(t);
    }
  }
  return { byEntity, applied };
}

/**
 * Part 45's ranked causes.
 *
 * Every candidate carries the evidence FOR it and the evidence that would DISTINGUISH it from the
 * others. The certainty cap at the end is the rule the directive states directly: with more than
 * one live candidate, nothing may be reported as certain.
 */
function rankCauses({ differences, diff, txnIndex, occlusionSuspects = 0 }) {
  const causes = [];
  // Uncertain counts as unexplained here. A difference nobody could classify still has plausible
  // causes worth ranking, and withholding them because the classifier abstained would leave a
  // reader with a shrug where the directive asks for a ranked list.
  const unexplained = differences.filter((d) => d.classification === CLASSIFICATION.UNEXPECTED || d.classification === CLASSIFICATION.UNCERTAIN);
  const expected = differences.filter((d) => d.classification === CLASSIFICATION.EXPECTED);

  // Candidate 1: the transactions that actually claim the change.
  const claiming = new Map();
  for (const d of expected) for (const t of d.explained_by_transaction) claiming.set(t.transaction_id, t);
  for (const t of claiming.values()) {
    const covered = expected.filter((d) => d.explained_by_transaction.some((x) => x.transaction_id === t.transaction_id));
    causes.push({
      cause: `transaction ${t.transaction_id}${t.intent ? ` — ${t.intent}` : ''}`,
      kind: 'recorded_edit',
      explains: covered.map((d) => d.id),
      certainty: CERTAINTY.CERTAIN,
      evidence: [
        evidence('data', `the transaction record names ${covered.length} of the ${differences.length} difference(s) as its own changed entities`),
        t.request ? evidence('data', `originating request: "${t.request}"`) : evidence('absence', 'the transaction records no originating user request'),
      ],
      distinguishing_evidence: ['the transaction ledger is the record; nothing distinguishes this from an alternative because the edit is not inferred, it is logged'],
    });
  }

  if (!unexplained.length) {
    if (!causes.length && differences.length) {
      causes.push({
        cause: 'unknown — differences exist and nothing in this session recorded making them',
        kind: 'unknown',
        explains: differences.map((d) => d.id),
        certainty: CERTAINTY.USER_INTENT_REQUIRED,
        evidence: [evidence('absence', 'no applied transaction in the ledger names any changed entity')],
        distinguishing_evidence: ['inspect_provenance on the changed entity ids would say whether anything outside the transaction ledger recorded the change'],
      });
    }
    return causes;
  }

  // Candidates for what is left over. These are real and specific to this codebase, not filler:
  // the ledger is session-scoped, the direct mutators genuinely bypass it, and the UI genuinely
  // does not create transactions. Each is a thing that has actually happened here.
  const anyVisualOnly = unexplained.every((d) => d.kind === 'silhouette' || d.kind === 'object_id_shift');

  if (occlusionSuspects) {
    causes.push({
      cause: `occlusion: ${occlusionSuspects} object(s) whose VISIBLE region changed because something in front of them moved, not because they did`,
      kind: 'occlusion',
      explains: unexplained.filter((d) => d.kind === 'object_id_shift').map((d) => d.id),
      certainty: CERTAINTY.HIGHLY_LIKELY,
      evidence: [
        evidence('measurement', `${occlusionSuspects} object(s) changed on screen at a frame where a DIFFERENT object was legitimately moved by the edit`),
        evidence('convention', 'an object-ID pass records the frontmost object per pixel, so an object behind a mover changes without moving'),
      ],
      distinguishing_evidence: [
        'a depth pass (OBS-004) would show whether the two objects overlap in depth at the changed pixels',
        'an isolation render of the suspect object (OBS-007) would move or not move independently of what is in front of it',
        'if the object\'s pixel COUNT changed but its centroid barely did, occlusion is the better explanation; a real move shifts the centroid',
      ],
    });
  }

  if (anyVisualOnly && diff) {
    causes.push({
      cause: 'the render changed without the project data changing — a viewport or renderer difference rather than an animation one',
      kind: 'observation_artefact',
      explains: unexplained.map((d) => d.id),
      certainty: CERTAINTY.POSSIBLE,
      evidence: [
        evidence('absence', 'the data diff names no change that reaches these objects'),
        evidence('measurement', `${unexplained.length} visual difference(s) with no corresponding curve or property change`),
      ],
      distinguishing_evidence: [
        'if the camera fingerprints match and the resolutions match, this is NOT a viewpoint artefact and the cause is elsewhere',
        'a mesh or texture that finished loading between the two renders would produce exactly this signature — check whether the changed objects carry a customMesh or customTexture',
      ],
    });
  }

  causes.push({
    cause: 'an edit made outside the transactional path — set_key, move_keyframes, the timeline UI or a direct manipulation in the viewport',
    kind: 'untracked_edit',
    explains: unexplained.map((d) => d.id),
    certainty: CERTAINTY.POSSIBLE,
    evidence: [
      evidence('data', `${unexplained.length} difference(s) that no applied transaction names`),
      evidence('convention', 'the pre-existing direct mutators and the UI do not open transactions — that boundary is documented in CON-005 and is real, not an oversight'),
    ],
    distinguishing_evidence: [
      'inspect_provenance on these entity ids: a non-transactional tool still records a provenance node, so provenance can distinguish "an MCP tool did it" from "the user dragged it"',
      'whole-project undo history would show a step the ledger does not',
    ],
  });

  causes.push({
    cause: 'the transaction ledger no longer holds the transaction that made this change',
    kind: 'lost_record',
    explains: unexplained.map((d) => d.id),
    certainty: txnIndex.applied.length ? CERTAINTY.POSSIBLE : CERTAINTY.HIGHLY_LIKELY,
    evidence: [
      txnIndex.applied.length
        ? evidence('data', `${txnIndex.applied.length} applied transaction(s) are in the ledger, so it is not empty`)
        : evidence('absence', 'the ledger holds no applied transaction at all, which is what a restarted session looks like'),
      evidence('convention', 'the ledger is in memory and session-scoped by design (TXN-001); the durable record is the provenance graph inside the project'),
    ],
    distinguishing_evidence: [
      'if the provenance graph inside the project names a patch touching these entities, the change was recorded and only the ledger forgot it',
    ],
  });

  causes.sort((a, b) => certaintyRank(a.certainty) - certaintyRank(b.certainty));

  // The directive's own rule, applied mechanically rather than left to judgement.
  const live = causes.filter((c) => c.kind !== 'recorded_edit');
  if (live.length > 1) {
    for (const c of live) {
      if (certaintyRank(c.certainty) < certaintyRank(CERTAINTY.POSSIBLE)) {
        c.certainty = CERTAINTY.POSSIBLE;
        c.capped = 'downgraded: more than one cause remains plausible, and Part 45 forbids inventing causal certainty';
      }
    }
  }
  return causes;
}

function minimumSafeCorrection(differences, causes) {
  const unexpected = differences.filter((d) => d.classification === CLASSIFICATION.UNEXPECTED);
  const uncertain = differences.filter((d) => d.classification === CLASSIFICATION.UNCERTAIN);
  if (!unexpected.length) {
    // Part 46's "non-destructive next checks": the right answer to a difference nobody could
    // classify is more evidence, not a correction. Proposing an edit here would be acting on an
    // unanswered question, which Part 13 forbids for exactly this certainty level.
    if (uncertain.length) {
      return {
        action: null,
        reason: `${uncertain.length} difference(s) could not be classified; correcting something nobody has identified would be a guess`,
        next_checks: [...new Set(uncertain.map((d) => d.classification_reason))].slice(0, 4),
        reversible: null,
      };
    }
    return {
      action: null,
      reason: differences.length
        ? 'every difference is expected or approved — there is nothing to correct'
        : 'nothing changed',
    };
  }
  const rollbackable = unexpected.filter((d) => d.explained_by_transaction.length);
  if (rollbackable.length) {
    const t = rollbackable[0].explained_by_transaction[0];
    return {
      action: `rollback_transaction { transactionId: "${t.transaction_id}", property: "${rollbackable[0].where_did_it_change.entity}" }`,
      reason: 'a scoped rollback reverses exactly this property and leaves the rest of the transaction applied',
      reversible: true,
    };
  }
  const targets = unexpected.map((d) => d.where_did_it_change.entity || d.which_objects_or_passes.objects[0]).filter(Boolean);
  return {
    action: targets.length
      ? `restore the baseline value for ${targets.slice(0, 3).join(', ')}${targets.length > 3 ? ` and ${targets.length - 3} more` : ''} — via restore_snapshot on the baseline's pinned snapshot, or a scoped apply_animation_patch if the rest of the current state must be kept`
      : null,
    reason: 'no transaction owns these differences, so there is no inverse to apply; the correction has to be written against the baseline value rather than undone',
    reversible: true,
    caution: causes.some((c) => c.kind === 'untracked_edit')
      ? 'if these came from an untracked edit, restoring the whole snapshot would also discard any other untracked work since the baseline'
      : null,
  };
}

// ---------------------------------------------------------------- reporting

function buildFindings({ differences, counts, causes, visual, diff }) {
  const out = [];

  if (!differences.length) {
    out.push(finding({
      id: 'explain:no-difference',
      certainty: CERTAINTY.CERTAIN,
      statement: 'No difference was found by any comparison that ran.',
      evidence: [
        diff ? evidence('data', diff.summary) : evidence('absence', 'the data diff did not run'),
        evidence('measurement', `${visual.comparisons.length} render comparison(s) ran`),
      ],
    }));
    return out;
  }

  if (counts.unexpected) {
    out.push(finding({
      id: 'explain:unexpected',
      certainty: CERTAINTY.HIGHLY_LIKELY,
      statement: `${counts.unexpected} difference(s) are not explained by any applied transaction.`,
      evidence: differences.filter((d) => d.classification === CLASSIFICATION.UNEXPECTED)
        .slice(0, 6).map((d) => evidence('measurement', d.what_changed)),
      suggestion: { text: causes[0]?.distinguishing_evidence?.[0] || 'inspect_provenance on the affected entity ids', reversible: true },
    }));
  }
  if (counts.uncertain) {
    out.push(finding({
      id: 'explain:uncertain',
      certainty: CERTAINTY.USER_INTENT_REQUIRED,
      statement: `${counts.uncertain} difference(s) could not be classified because the evidence needed was not available.`,
      evidence: differences.filter((d) => d.classification === CLASSIFICATION.UNCERTAIN)
        .slice(0, 6).map((d) => evidence('absence', d.classification_reason)),
    }));
  }
  if (counts.expected) {
    out.push(finding({
      id: 'explain:expected',
      certainty: CERTAINTY.CERTAIN,
      statement: `${counts.expected} difference(s) are accounted for by an applied transaction or by propagation from one.`,
      evidence: [evidence('data', 'each carries the transaction id or the propagation reason that explains it')],
    }));
  }

  // A visual difference where the render says one thing and the data says another is the single
  // most valuable output of the pass existing, so it gets its own finding rather than being one
  // row in a table.
  const silentMovers = differences.filter((d) => d.kind === 'object_id_shift' && d.classification === CLASSIFICATION.UNEXPECTED);
  if (silentMovers.length) {
    out.push(finding({
      id: 'explain:moved-without-data-change',
      certainty: CERTAINTY.HIGHLY_LIKELY,
      statement: 'An object moved on screen that nothing in the project data explains.',
      evidence: silentMovers.slice(0, 4).map((d) => evidence('measurement', d.what_changed)),
      suggestion: { text: 'this is the propagation case Part 43 names as an escalation trigger — expand the observation before accepting', reversible: true },
    }));
  }

  const degraded = visual.comparisons.filter((c) => c.degraded);
  if (degraded.length) {
    out.push(finding({
      id: 'explain:degraded-comparison',
      certainty: CERTAINTY.CERTAIN,
      statement: `${degraded.length} comparison(s) ran at block granularity rather than pixel, because the baseline's own rasters are no longer in memory.`,
      evidence: [evidence('absence', 'the raster store is session-scoped; a baseline reloaded from disk carries digests and signatures only')],
    }));
  }
  return out;
}

function header(differences, counts, frames) {
  if (!differences.length) return 'Nothing changed.';
  const parts = [];
  for (const k of ['unexpected', 'uncertain', 'expected', 'approved']) if (counts[k]) parts.push(`${counts[k]} ${k}`);
  return `${differences.length} difference(s) — ${parts.join(', ')}${frames.length ? `; observed at frame(s) ${frames.join(', ')}` : '; no frame was observed'}.`;
}

function countBy(rows, fn) {
  const out = { expected: 0, unexpected: 0, uncertain: 0, approved: 0 };
  for (const r of rows) out[fn(r)] = (out[fn(r)] || 0) + 1;
  return out;
}

export function explainLimitations() {
  return {
    cannot: [
      'tell an object that MOVED from one whose visible pixels changed because something moved in front of it. An object-ID pass records the frontmost object per pixel; the occlusion case is reported as `uncertain` with the checks that would separate it, never as a regression',
      'answer Part 44\'s "does it violate a constraint?" — constraints are enforced when a patch is applied, and a state that already exists cannot be refused retrospectively',
      'detect flicker, one-frame pops or temporal artefacts: those need consecutive frames, and the observation policy samples suspect frames',
      'attribute a difference to a specific STRATEGY inside a motion plan — provenance links at plan granularity, not operation granularity (CMP-004)',
      'distinguish a genuine untracked edit from a lost ledger record without consulting provenance; both are offered as ranked causes and the distinguishing check is named',
      'answer "why does this look wrong" — it answers "what is different and who did it". The Part 46 diagnostics that answer the other question are `explain_motion_problem` (contact instability and per-frame discontinuity, EXP-002); the two are not joined, so a visual difference does not automatically get a motion explanation',
    ],
    assumptions: [
      'a transaction that names an entity as changed is the cause of that entity\'s difference. If two transactions touched the same key, both are listed and neither is preferred',
      'propagation through the rig implies a visual change is expected. That is structural inference, capped at highly_likely, never reported as certain',
    ],
  };
}
