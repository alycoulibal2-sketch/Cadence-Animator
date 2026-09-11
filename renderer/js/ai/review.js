// The structured shot review (directive Part 49) and the quality hierarchy that orders it
// (directive Part 14).
//
// Part 49 asks for one command that reviews a shot "like a senior animator, VFX supervisor,
// cinematographer, and technical QA reviewer", returning ten specific things. Part 14 supplies the
// ordering: thirteen quality layers, most-important first, and the instruction that makes the
// ordering matter rather than decorate — *"Fix the highest-impact failing layer first."*
//
// Those two parts together are the reason this module exists rather than a fourth analysis tool.
// Everything it measures is measured elsewhere: `ai/motion.js` for curves and contacts,
// `ai/riggraph.js` for rig validity, `ai/vfxspec.js` for effect timing, `ai/events.js` for the
// shot's events, `ai/constraints.js` for what is protected. What a review adds is **altitude and
// order** — one pass that gathers them, sorts what it finds by the layer it belongs to, and names
// the single highest-impact failing layer instead of handing back a flat list of everything wrong.
//
// Five decisions shape the file.
//
// 1. **Deterministic defects and artistic suggestions never mix.** Part 49 requires the review to
//    "distinguish deterministic defects from artistic suggestions", and Part 11's review mode
//    repeats it. They are separate arrays in the result, they are never merged into one ranking,
//    and a suggestion carries no severity — only a defect does. This is the single most important
//    property of the output, because merging them is how a subjective opinion starts looking like
//    a measurement.
//
// 2. **A layer that cannot be measured is reported as unmeasured, not as passing.** Of Part 14's
//    thirteen layers this build measures three fully, six only partly, and four not at all.
//    "Pose design" and "readability and staging" need
//    silhouette and line-of-action analysis that does not exist (MOT-011/012); "camera
//    relationship" needs an active-camera model. A review that returned "pose design: fine" would
//    be worse than useless, so `QUALITY_LAYERS` records what measures each layer or what blocks it,
//    and the result says how much of the shot was actually reviewed.
//
// 3. **Severity is a declared convention, and the directive does not define one.** Part 49 asks
//    for severity and Part 66 asks for it again, but no part enumerates the levels. So `SEVERITY`
//    is this codebase's own scale, it is labelled as a convention in the evidence of every finding
//    that uses it, and it is deliberately about CONSEQUENCE while Part 13's certainty is about
//    CONFIDENCE. The two are orthogonal and are reported separately: a certainly-detected
//    micro-polish nit is `certain` and `minor`.
//
// 4. **The hierarchy is used to refuse advice, not only to sort it.** Part 14's three named
//    anti-patterns — do not add secondary motion to a weak pose, camera shake to conceal absent
//    weight, or VFX polish to an unclear impact — generalise to one checkable rule: an action at a
//    low layer while a higher layer is failing is treating a symptom. `checkHierarchyInversion`
//    applies that rule to a proposed action, and names the three explicitly because the directive
//    does.
//
// 5. **A review recommends and never acts.** Part 49's tenth step is "recommend minimal safe
//    corrections", and Part 11 makes review mode read-only. Nothing here builds a patch; a
//    recommendation names the tool that would make the correction and whether a human has to
//    decide first.
//
// Pure at load like the rest of `ai/`.

import * as ids from './ids.js';
import { CERTAINTY, certaintyRank, evidence, finding, coverage, sortFindings } from './certainty.js';
import * as riggraph from './riggraph.js';
import * as scenegraph from './scenegraph.js';
import * as motion from './motion.js';
import * as events from './events.js';
import * as vfxspec from './vfxspec.js';
import * as constraints from './constraints.js';
import * as cal from './cal.js';
import * as modes from './modes.js';
import * as knowledge from './knowledge.js';

/**
 * Consequence, as distinct from confidence.
 *
 * NOT from the directive — Part 49 and Part 66 both require severity without defining a scale, so
 * this is a declared convention and every finding that carries one says so in its evidence.
 */
export const SEVERITY = Object.freeze({
  BLOCKING: 'blocking',
  MAJOR: 'major',
  MINOR: 'minor',
  NOTE: 'note',
});
const SEVERITY_ORDER = Object.freeze({ blocking: 0, major: 1, minor: 2, note: 3 });

/**
 * Part 14's quality hierarchy, in the directive's own order, with what this build can say about
 * each layer.
 *
 * The order is the product: it is what `highestFailingLayer` reads, and what makes "fix the
 * highest-impact failing layer first" an instruction a tool can follow.
 */
export const QUALITY_LAYERS = Object.freeze([
  { layer: 1, name: 'intent and purpose', measured: 'partly', by: 'the AcceptanceSpec, when one is supplied — otherwise nothing here knows what the shot is FOR', blocked_by: 'no shot plan entity exists (SHOT-001)' },
  { layer: 2, name: 'readability and staging', measured: false, blocked_by: 'silhouette readability and staging need the silhouette pass plus a camera model; the pass exists (OBS-002) but nothing judges readability from it (MOT-012)' },
  { layer: 3, name: 'pose design', measured: false, blocked_by: 'line of action, balance and silhouette clarity are not measurable (MOT-011/012); part mass is unknown, so balance cannot be computed at all' },
  { layer: 4, name: 'timing', measured: true, by: 'ai/motion.js — key density, interpolation types, phase durations against the event timeline' },
  { layer: 5, name: 'spacing', measured: true, by: 'ai/motion.js — velocity and acceleration profiles between keys' },
  { layer: 6, name: 'weight and mechanics', measured: 'partly', by: 'ai/motion.js — acceleration contrast and jerk are measurable proxies', blocked_by: 'perceived weight itself is subjective (Part 67); nothing here judges whether a motion FEELS heavy' },
  { layer: 7, name: 'contacts and constraints', measured: true, by: 'ai/motion.js measureContactDrift plus ai/constraints.js — the only layer with a user-declared tolerance to judge against' },
  { layer: 8, name: 'arcs and motion propagation', measured: 'partly', by: 'ai/motion.js — path curvature, and chain lead/lag for propagation', blocked_by: 'distance from an EXPECTED arc needs an arc model, which does not exist' },
  { layer: 9, name: 'overlap and follow-through', measured: 'partly', by: 'ai/motion.js analyseChain — a chain inversion is detectable', blocked_by: 'whether the amount of overlap is RIGHT is subjective' },
  { layer: 10, name: 'camera relationship', measured: false, blocked_by: 'no active-camera model. With two or more cameras nothing in the project even marks which one the shot uses (see events.describeShot().absent)' },
  { layer: 11, name: 'VFX relationship', measured: 'partly', by: 'ai/vfxspec.js validateTiming — whether an effect peaks on the event it reacts to, and whether its envelope closes', blocked_by: 'depth integration, lighting and flicker are not measured (VFX-008/009)' },
  { layer: 12, name: 'secondary motion', measured: false, blocked_by: 'nothing marks a track as secondary, so secondary motion cannot be told from primary' },
  { layer: 13, name: 'micro-polish', measured: 'partly', by: 'ai/motion.js — unexplained jerk spikes and degenerate keys', blocked_by: 'what counts as polish rather than noise is a judgement (Part 23 noise-and-signal policy applies first)' },
]);

const LAYER_BY_NAME = Object.freeze(Object.fromEntries(QUALITY_LAYERS.map((l) => [l.name, l])));

/** Part 14's three named anti-patterns, kept verbatim because the directive names them. */
export const HIERARCHY_ANTIPATTERNS = Object.freeze([
  { action_layer: 12, blocked_by_layer: 3, statement: 'do not add beautiful secondary motion to a weak pose' },
  { action_layer: 10, blocked_by_layer: 6, statement: 'do not add camera shake to conceal absent weight' },
  { action_layer: 11, blocked_by_layer: 2, statement: 'do not add VFX polish to an unclear impact' },
]);

export const REVIEW_LIMITATIONS = Object.freeze([
  'A review measures 6 of Part 14\'s 13 quality layers fully or partly and cannot measure 4 at all. `QUALITY_LAYERS` names what blocks each one; a layer that cannot be measured is reported as unmeasured and NEVER as passing.',
  'Nothing is rendered. Part 49 asks for "annotated render crops" and this layer has no pixels — create_baseline before an edit and explain_change after it is what produces rendered evidence, and the review names the frames worth looking at instead.',
  'Deterministic defects and artistic suggestions are separate arrays and are never merged into one ranking. A suggestion carries no severity, because a severity on a subjective judgement is what makes an opinion look like a measurement.',
  'Severity is this codebase\'s own convention: the directive requires severity in Parts 49 and 66 without defining a scale. It describes CONSEQUENCE and is orthogonal to Part 13\'s certainty, which describes CONFIDENCE.',
  'A review recommends and never acts. Part 11 makes review mode read-only; every recommendation names the tool that would make the correction and whether a human has to decide first.',
  'The review has no memory. It cannot say "this is the third time this shot has had this problem" — that is Phase 8 (MEM-003/004).',
]);

// ---------------------------------------------------------------- OPS-005: the hierarchy

/**
 * Order findings the way Part 14 says to look at them: by quality layer first, then by
 * consequence, then by confidence.
 *
 * Layer beats severity deliberately. A blocking micro-polish defect is still less important than a
 * major timing problem, because fixing the polish first is how a shot gets beautifully wrong.
 */
export function orderByHierarchy(findings) {
  return [...findings].sort((a, b) => {
    const la = a.quality_layer ?? 99, lb = b.quality_layer ?? 99;
    if (la !== lb) return la - lb;
    const sa = SEVERITY_ORDER[a.severity] ?? 9, sb = SEVERITY_ORDER[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    return certaintyRank(a.certainty) - certaintyRank(b.certainty);
  });
}

/**
 * The layer to fix first: the highest (lowest-numbered) layer with a real defect.
 *
 * Only DEFECTS count. An artistic suggestion at layer 3 does not make pose design "failing" — it
 * makes it commented on, and Part 14's instruction is about failures.
 */
export function highestFailingLayer(defects) {
  const withLayer = defects.filter((d) => Number.isFinite(d.quality_layer));
  if (!withLayer.length) return null;
  const best = orderByHierarchy(withLayer)[0];
  const layer = QUALITY_LAYERS.find((l) => l.layer === best.quality_layer) ?? null;
  return {
    layer: best.quality_layer,
    name: layer?.name ?? null,
    finding: best,
    also_failing: [...new Set(withLayer.map((d) => d.quality_layer))].sort((a, b) => a - b).filter((n) => n !== best.quality_layer),
    instruction: 'Part 14: fix the highest-impact failing layer first — a correction at a lower layer is treating a symptom while this stands',
  };
}

/**
 * Would this action treat a symptom?
 *
 * Part 14's three named anti-patterns are the special cases; the general rule is that an action at
 * layer N while some layer M < N is failing is polish applied over a problem. Reported as a
 * warning and never a refusal: sometimes the lower-layer work is what the user asked for, and this
 * layer does not overrule that.
 *
 * @param action.layer  the quality layer the proposed action sits at (1-13), or its name
 * @param defects       the defects a review found
 */
export function checkHierarchyInversion(action, defects) {
  const actionLayer = typeof action?.layer === 'string' ? LAYER_BY_NAME[action.layer]?.layer : action?.layer;
  if (!Number.isFinite(actionLayer)) {
    return { inverted: false, findings: [], reason: 'the action was not attributed to a quality layer, so nothing can be said about its ordering' };
  }
  const higherFailing = defects.filter((d) => Number.isFinite(d.quality_layer) && d.quality_layer < actionLayer);
  if (!higherFailing.length) return { inverted: false, findings: [] };

  const out = [];
  for (const anti of HIERARCHY_ANTIPATTERNS) {
    if (anti.action_layer !== actionLayer) continue;
    const hit = higherFailing.find((d) => d.quality_layer === anti.blocked_by_layer);
    if (!hit) continue;
    out.push(finding({
      id: 'HIERARCHY-ANTIPATTERN',
      certainty: CERTAINTY.HIGHLY_LIKELY,
      statement: `Part 14, in as many words: "${anti.statement}". ${nameOf(anti.blocked_by_layer)} is failing, and this action is at ${nameOf(anti.action_layer)}`,
      evidence: [
        evidence('convention', 'Part 14 names this anti-pattern explicitly', { antipattern: anti.statement }),
        evidence('measurement', 'the higher layer has a defect', { layer: anti.blocked_by_layer, finding: hit.id }),
      ],
      suggestion: { text: `fix ${nameOf(anti.blocked_by_layer)} first`, reversible: true },
    }));
  }
  if (!out.length) {
    const worst = orderByHierarchy(higherFailing)[0];
    out.push(finding({
      id: 'HIERARCHY-INVERTED',
      certainty: CERTAINTY.POSSIBLE,
      statement: `this action is at ${nameOf(actionLayer)}, but ${nameOf(worst.quality_layer)} is failing — Part 14 puts the higher layer first, so this may be polish over a problem`,
      evidence: [
        evidence('measurement', 'a higher quality layer has a defect', { action_layer: actionLayer, failing_layer: worst.quality_layer, finding: worst.id }),
        evidence('convention', 'the layer ordering is Part 14\'s, and the threshold for calling this inverted is simply "higher layer failing"'),
      ],
      suggestion: { text: `consider ${nameOf(worst.quality_layer)} first — or say why this ordering is deliberate`, reversible: true },
    }));
  }
  return { inverted: true, findings: out, action_layer: actionLayer, higher_failing_layers: [...new Set(higherFailing.map((d) => d.quality_layer))].sort((a, b) => a - b) };
}

const nameOf = (n) => `layer ${n} (${QUALITY_LAYERS.find((l) => l.layer === n)?.name ?? 'unknown'})`;

// ---------------------------------------------------------------- REV-001: the review

/**
 * Review a shot (Part 49).
 *
 * @param project           the project. NOT modified.
 * @param opts.itemId       the character to review. Defaults to the only rig, or asks.
 * @param opts.acceptance   an AcceptanceSpec — this is the only way layer 1 (intent) is measurable
 * @param opts.constrain    a constraint request, so protected elements can be reported
 * @param opts.from/.to     frame range; defaults to the item's keyed range
 */
export function reviewShot(project, { itemId = null, acceptance = null, constrain = null, from = null, to = null, mode = 'review', discipline = undefined } = {}) {
  const auth = modes.authorise({ mutates: false, name: 'review_shot' }, { mode, discipline });
  const defects = [];
  const suggestions = [];
  const notRun = [];
  const steps = {};

  // Part 49 step 1 — the shot plan and acceptance criteria.
  const shot = events.describeShot(project);
  const timeline = events.buildTimeline(project);
  steps.shot_plan = acceptance
    ? { reviewed: true, checks: cal.checksOf(acceptance).length, not_runnable: acceptance.not_runnable }
    : { reviewed: false, why: 'no acceptance criteria were supplied, so nothing here knows what this shot is FOR — layer 1 (intent and purpose) cannot be reviewed' };
  if (!acceptance) notRun.push('layer 1, intent and purpose — no AcceptanceSpec was supplied, and there is no shot plan entity to read one from (SHOT-001)');

  // Which character. A review of "the shot" with two rigs and no itemId is a question, not a guess.
  const rigs = (project?.items || []).filter((i) => i.kind === 'rig');
  const subject = itemId ?? (rigs.length === 1 ? rigs[0].id : null);
  if (!subject) {
    return {
      ok: false,
      mode: auth.mode, active_mode: auth.active,
      question: rigs.length
        ? `Which character should be reviewed? ${rigs.map((r) => `${r.name} (${r.id})`).join(', ')}.`
        : 'There is no rig in this project to review.',
      shot, layers: QUALITY_LAYERS, limitations: REVIEW_LIMITATIONS,
    };
  }
  const item = (project.items || []).find((i) => i.id === subject);

  // Part 49 step 2 — scene, rig and dependency state. This is the technical QA reviewer.
  // `rigGraph` and `validateRig` take the ITEM, not its id.
  const rg = riggraph.rigGraph(project, item);
  const validation = riggraph.validateRig(project, item, rg);
  const sg = scenegraph.sceneGraph(project);
  steps.scene_and_rig = { parts: rg?.parts?.length ?? null, joints: rg?.joints?.length ?? null, objects: sg.objects.length, rig_findings: validation.findings.length };
  for (const f of validation.findings) {
    defects.push(withLayer(f, 7, severityFromCertainty(f, SEVERITY.MAJOR), 'rig validity is a technical precondition for contacts and constraints'));
  }

  // Part 49 steps 4 and 8 — timing, spacing, curves, contacts, propagation, and suspect frames.
  const range = resolveRange(project, subject, from, to);
  let sampled = null;
  if (range) {
    sampled = motion.sampleMotion(project, { itemId: subject, frameRange: [range.start, range.end], step: 1 });
    steps.motion = { subjects: sampled.subjects.length, frames: [range.start, range.end], not_measured: sampled.coverage?.notRun?.length ?? 0 };
    // Layer 13. `motion.classifyVariation` runs Part 23's noise-and-signal policy and DELIBERATELY
    // refuses to call an unexplained discontinuity a defect: accidental jitter, procedural detail
    // and an interpolation artefact are indistinguishable in Cadence project data. A review must
    // not overrule that, so an unexplained spike is an artistic SUGGESTION — something to look at —
    // and an authored one is not reported at all.
    for (const s of sampled.subjects) {
      for (const spike of jerkSpikes(s)) {
        const cls = motion.classifyVariation(project, subject, nearestTrack(project, subject, s), spike.t);
        if (cls.kind !== 'unclassified') continue; // stepped, held or marked: authored, not a problem
        suggestions.push(withLayer(finding({
          id: 'REVIEW-UNEXPLAINED-DISCONTINUITY',
          certainty: CERTAINTY.POSSIBLE,
          statement: `${s.name || s.part_id} has an unexplained motion discontinuity at frame ${spike.t} — worth a look, and NOT called a defect`,
          evidence: [
            evidence('measurement', 'jerk well above this part\'s own median', { frame: spike.t, jerk: spike.jerk, median: spike.median }),
            evidence('convention', cls.why),
          ],
          target: s.entity_id ?? null, frame: spike.t,
          suggestion: { text: 'explain_motion_problem { question: "why_is_this_motion_bad" } judges it against Part 23\'s policy with the surrounding frames', reversible: true },
        }), 13, null, 'reported as a suggestion because ai/motion.js refuses to call an unexplained discontinuity a defect, and a review does not overrule the measurement layer'));
      }
    }
    const chain = motion.analyseChain(project, { itemId: subject, frameRange: [range.start, range.end], step: 1 });
    steps.propagation = { links: chain.links?.length ?? 0, inversions: chain.inversions?.length ?? 0 };
    for (const inv of chain.inversions || []) {
      // Part 22 lists whip cracks and isolated gestures as legitimate, so this is a SUGGESTION.
      suggestions.push(withLayer(finding({
        id: 'REVIEW-CHAIN-INVERTED',
        certainty: CERTAINTY.POSSIBLE,
        statement: `${inv.later ?? 'a distal joint'} leads ${inv.earlier ?? 'its parent'}, which is inverted for ordinary follow-through — legitimate for a whip crack or an isolated gesture`,
        evidence: [evidence('measurement', 'peak-speed ordering along the chain', inv)],
      }), 9, null, 'reported as a suggestion because Part 22 names legitimate exceptions'));
    }
  } else {
    steps.motion = { reviewed: false, why: 'the item has no keys, so there is no motion to review' };
    notRun.push('layers 4, 5, 6, 8, 9 and 13 — the item has no keyframes, so nothing was sampled');
  }

  // Part 49 step 4 (contacts) — the only layer with a declared tolerance to judge against.
  const compiled = constrain ? constraints.compileConstraints(typeof constrain === 'string' ? { text: constrain } : constrain, project) : { constraints: [], unparsed: [] };
  const contactChecks = compiled.constraints.filter((c) => c.condition?.check === 'contact_drift');
  if (contactChecks.length) {
    for (const c of contactChecks) {
      // A compiled ConstraintSpec keeps its range in `time_range` (not on the condition) and its
      // `target` is an ARRAY of selectors. Reading `condition.from` / `target.itemId` silently
      // measured `undefined` and reported no contact problem at all.
      const [cFrom, cTo] = Array.isArray(c.time_range) ? c.time_range : [null, null];
      const targets = Array.isArray(c.target) ? c.target : (c.target ? [c.target] : []);
      const a = motion.measureContactDrift(project, {
        itemId: targets.find((t) => t.itemId)?.itemId ?? subject,
        effector: c.condition.effector ?? targets[0]?.query,
        start: cFrom, end: cTo,
        tolerance_studs: c.condition.tolerance_studs,
      });
      if (a && a.within_tolerance === false) {
        defects.push(withLayer(finding({
          id: 'REVIEW-CONTACT-DRIFT',
          certainty: CERTAINTY.CERTAIN,
          statement: `the declared contact on "${c.condition.effector ?? 'an effector'}" drifts ${a.max_drift_studs} stud(s) over frames ${cFrom}–${cTo}, past its ${c.condition.tolerance_studs}-stud tolerance`,
          evidence: [evidence('measurement', 'world-space drift of the contact effector', { max: a.max_drift_studs, frame: a.at_frame, tolerance: c.condition.tolerance_studs })],
          frame: a.first_breach_frame ?? a.at_frame,
          suggestion: { text: 'explain_motion_problem { question: "why_is_this_contact_unstable" } attributes the drift to a joint', reversible: true },
        }), 7, SEVERITY.BLOCKING, 'a broken declared contact is a deterministic defect: the tolerance came from the user'));
      }
    }
  } else {
    notRun.push('layer 7, contacts — no contact was DECLARED, and nothing here infers one (MOT-008). Pass `constrain` to have a contact reviewed');
  }

  // Part 49 step 5 — VFX timing. The measurable half of the VFX supervisor's job.
  const vfxReport = vfxspec.validateTiming(project, { timeline });
  steps.vfx = { emitters: vfxReport.emitters, findings: vfxReport.findings.length };
  for (const f of vfxReport.findings) {
    if (f.id === 'VFX-PEAK-ON-EVENT') continue; // a pass, not a finding to report as a problem
    const blocking = f.id === 'VFX-NO-ENVELOPE' || f.id === 'VFX-ENVELOPE-UNCLOSED';
    defects.push(withLayer(f, 11, blocking ? SEVERITY.MAJOR : SEVERITY.MINOR, 'effect timing against the shot events is measurable; how the effect LOOKS is not'));
  }
  notRun.push('layer 11, VFX relationship — depth integration, lighting and flicker are not measured (VFX-008/009); only envelope timing against the events was reviewed');

  // Part 49 steps 3, 6 and 7 — the ones that cannot run, named rather than skipped silently.
  steps.poses = { reviewed: false, why: QUALITY_LAYERS[2].blocked_by };
  steps.camera = { reviewed: false, why: QUALITY_LAYERS[9].blocked_by };
  steps.baseline_and_references = {
    reviewed: false,
    why: 'a baseline comparison needs rendered passes, which this layer does not have. create_baseline before an edit and explain_change after it runs them; references are not ingested at all (Phase 8).',
  };
  notRun.push('layer 2, readability and staging — ' + QUALITY_LAYERS[1].blocked_by);
  notRun.push('layer 3, pose design — ' + QUALITY_LAYERS[2].blocked_by);
  notRun.push('layer 10, camera relationship — ' + QUALITY_LAYERS[9].blocked_by);
  notRun.push('layer 12, secondary motion — ' + QUALITY_LAYERS[11].blocked_by);
  notRun.push('Part 49\'s "annotated render crops" — nothing is rendered here; the suspect frame list is what to look at instead');

  // Part 49 step 1 (acceptance) as a measured layer, when criteria were supplied.
  if (acceptance) {
    const acc = cal.evaluateAcceptance(project, project, acceptance, { itemId: subject });
    steps.acceptance = { accepted: acc.accepted, fully_validated: acc.fully_validated, results: acc.results.map((r) => ({ check: r.check, status: r.status })) };
    for (const r of acc.results.filter((x) => x.status === 'fail')) {
      defects.push(withLayer(finding({
        id: 'REVIEW-ACCEPTANCE-FAIL',
        certainty: CERTAINTY.CERTAIN,
        statement: `the shot does not meet its own acceptance criterion "${r.check}"${r.reason ? `: ${r.reason}` : ''}`,
        evidence: [evidence('measurement', 'acceptance evaluation against the declared spec', { check: r.check, measured: r.measured ?? null })],
      }), 1, SEVERITY.BLOCKING, 'a declared criterion is the shot\'s own definition of done'));
    }
  }

  // Part 49 step 9 — classify by certainty AND severity. Already done per finding; here it is
  // aggregated, and step 10's recommendation is derived from the ORDER rather than from the count.
  const orderedDefects = orderByHierarchy(defects);
  const first = highestFailingLayer(orderedDefects);
  const protectedElements = compiled.constraints.map((c) => ({ id: c.id, protects: c.target?.query ?? c.protect ?? null, priority: c.priority ?? null }));

  const suspectFrames = [...new Set(orderedDefects.map((d) => d.frame).filter((f) => Number.isFinite(f)))].sort((a, b) => a - b);

  return {
    ok: true,
    mode: auth.mode,
    active_mode: auth.active,
    subject: { itemId: subject, name: item?.name ?? null },
    shot,
    steps,

    // Part 49's ten return fields, in its own order.
    timeline_markers: timeline.events.map((e) => ({ id: e.id, frame: e.frame, name: e.name, itemId: e.itemId, hasCode: e.hasCode })),
    suspect_frames: suspectFrames,
    annotated_render_crops: {
      available: false,
      why: 'this layer renders nothing. The suspect frame list above is what to render and look at; create_baseline + explain_change produces the rendered comparison.',
    },
    motion_and_curve_evidence: sampled
      ? sampled.subjects.map((s) => ({ part_id: s.part_id, peak_speed: s.summary?.peak_speed ?? null, path_length_studs: s.summary?.path_length_studs ?? null, still: s.summary?.still ?? null }))
      : [],
    affected_objects: [...new Set(orderedDefects.map((d) => d.target).filter(Boolean))],

    // Decisions 1 and 3: two separate arrays, severity only on the deterministic side.
    deterministic_defects: orderedDefects,
    artistic_suggestions: sortFindings(suggestions),

    severity_summary: countBy(orderedDefects, (d) => d.severity),
    confidence_summary: countBy(orderedDefects, (d) => d.certainty),

    // Part 49 step 10, ordered by Part 14 rather than by severity alone.
    fix_first: first,
    recommended_corrections: recommend(orderedDefects, first),
    protected_elements: protectedElements,
    user_judgment_required: suggestions.length > 0 || orderedDefects.some((d) => d.certainty === CERTAINTY.USER_INTENT_REQUIRED || d.certainty === CERTAINTY.SUBJECTIVE),

    // KNW-003 wired to a real measurement rather than left as prose. Every knowledge entry —
    // the twelve compiled principles and whatever the user has loaded from disk — declares a
    // detection method; this reports the ones ai/motion.js can actually compute on THIS shot,
    // with the value, and names the rest as not measured with the reason. It grows as the
    // knowledge corpus grows, which is the whole point of the corpus being loadable.
    //
    // Deliberately NOT findings: a measurement a principle points at is not a defect and not a
    // suggestion. Each runnable check carries `verdict: null`, because there is no threshold in
    // this build for "enough anticipation" and each entry's own style_variations is why.
    knowledge_checks: sampled
      ? knowledge.knowledgeChecks(motion.MEASUREMENTS, { sampled })
      : { runnable: [], not_measured: [], counts: { runnable: 0, not_measured: 0, total: 0 }, note: 'nothing was sampled (the item has no keyframes), so no principle-backed measurement could run' },

    quality_layers: QUALITY_LAYERS,
    layers_reviewed: QUALITY_LAYERS.filter((l) => l.measured === true || l.measured === 'partly').map((l) => l.layer),
    layers_not_reviewable: QUALITY_LAYERS.filter((l) => l.measured === false).map((l) => ({ layer: l.layer, name: l.name, blocked_by: l.blocked_by })),

    coverage: coverage({
      scope: `${QUALITY_LAYERS.filter((l) => l.measured !== false).length} of ${QUALITY_LAYERS.length} Part 14 quality layers reviewed, fully or partly`,
      frames: range ? [range.start, range.end] : null,
      loop: 'fast',
      notRun,
    }),
    limitations: REVIEW_LIMITATIONS,
  };
}

/** Part 49 step 10: minimal safe corrections, in the order Part 14 says to make them. */
function recommend(defects, first) {
  if (!defects.length) {
    return [{
      action: null,
      statement: 'no deterministic defect was found in the layers that can be measured. That is not "the shot is good" — 4 of Part 14\'s 13 layers cannot be reviewed at all, and nobody has looked at it.',
      // Approval IS required: the statement above disclaims itself, so nothing should treat it as a
      // pass. "Nothing measurable objected" is not "this shot is finished".
      requires_user_approval: true,
    }];
  }
  const out = [];
  if (first) {
    out.push({
      action: first.finding.suggestion?.text ?? `address ${nameOf(first.layer)}`,
      statement: `${first.instruction}. The highest failing layer is ${nameOf(first.layer)}: ${first.finding.statement}`,
      layer: first.layer,
      severity: first.finding.severity,
      certainty: first.finding.certainty,
      requires_user_approval: first.finding.certainty !== CERTAINTY.CERTAIN,
    });
  }
  for (const d of defects.slice(0, 6)) {
    if (first && d === first.finding) continue;
    out.push({
      action: d.suggestion?.text ?? null,
      statement: d.statement,
      layer: d.quality_layer ?? null,
      severity: d.severity,
      certainty: d.certainty,
      after: first ? `after ${nameOf(first.layer)}` : null,
      requires_user_approval: d.certainty !== CERTAINTY.CERTAIN,
    });
  }
  return out;
}

/** Attach a quality layer and a severity to a finding, recording that both are conventions. */
function withLayer(f, layer, severity, why) {
  return {
    ...f,
    quality_layer: layer,
    quality_layer_name: QUALITY_LAYERS.find((l) => l.layer === layer)?.name ?? null,
    ...(severity ? { severity } : {}),
    evidence: [
      ...(f.evidence || []),
      evidence('convention', `assigned to Part 14 layer ${layer} (${QUALITY_LAYERS.find((l) => l.layer === layer)?.name}) — ${why}`),
      ...(severity ? [evidence('convention', `severity "${severity}" is this codebase\'s scale; the directive requires a severity without defining one`)] : []),
    ],
  };
}

function severityFromCertainty(f, fallback) {
  return f.certainty === CERTAINTY.CERTAIN ? fallback : SEVERITY.MINOR;
}

function resolveRange(project, itemId, from, to) {
  if (Number.isFinite(from) && Number.isFinite(to)) return { start: from, end: to };
  const tracks = project?.tracks?.[itemId] || {};
  const times = [];
  for (const tr of Object.values(tracks)) for (const k of tr?.keys || []) if (Number.isFinite(k.t)) times.push(k.t);
  if (!times.length) return null;
  const start = Math.min(...times), end = Math.max(...times);
  return end > start ? { start, end } : null;
}

/**
 * Frames where this part's jerk stands well above its own median.
 *
 * Per-part rather than absolute, because a fast arm and a drifting torso have different natural
 * scales and one global threshold would flag every fast part and miss every slow one. The
 * multiplier is a declared convention, and it is reported in the evidence of every finding.
 */
const JERK_SPIKE_MULTIPLE = 6;
function jerkSpikes(subject) {
  const js = (subject.samples || []).map((x) => Math.abs(x.jerk ?? 0)).filter((x) => x > 0);
  if (js.length < 5) return [];
  const sorted = [...js].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!(median > 0)) return [];
  const out = [];
  for (const x of subject.samples || []) {
    const j = Math.abs(x.jerk ?? 0);
    if (j > median * JERK_SPIKE_MULTIPLE) out.push({ t: x.t, jerk: j, median });
  }
  return out;
}

/** The joint track that drives a part, for the variation classification. A part is posed by the
 *  joint whose child it is, and the track table is keyed by joint NAME (ai/ids.js explains why). */
function nearestTrack(project, itemId, subject) {
  const tracks = Object.keys(project?.tracks?.[itemId] || {});
  return tracks.find((t) => t === subject.part_id) ?? tracks.find((t) => subject.part_id && t.includes(subject.part_id)) ?? tracks[0] ?? '';
}

function countBy(list, fn) {
  const out = {};
  for (const x of list) {
    const k = fn(x) ?? 'unclassified';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
