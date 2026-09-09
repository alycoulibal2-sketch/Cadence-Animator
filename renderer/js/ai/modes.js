// Operating modes (directive Part 11), and the exploration/production axis that crosses them.
//
// Part 11 opens with the sentence this whole file exists to honour: *"The mode changes the default
// level of freedom, analysis, and approval."* Before this module `IntentSpec.mode` was a free-form
// string that was carried through interpretation and written to provenance and **read by nobody** —
// so declaring `mode: 'analyze'` recorded an intention and permitted exactly the same mutations as
// `mode: 'create'`. A field that governs nothing is worse than an absent one, because a caller
// reasonably assumes it works (Part 4.6).
//
// So the modes here are not labels. Each one declares four things a caller can act on — whether it
// may mutate at all, how much freedom it has, how much analysis it owes before changing anything,
// and what approval it needs — and `authorise()` turns those into a yes or no for a specific
// action. The enforcement points are the MCP handlers, because that is where an action actually
// happens; this module is the policy, not the police.
//
// Three decisions worth stating.
//
// 1. **A mode narrows; it never widens.** No mode grants permission that the constraint system
//    would otherwise refuse. `create` is the most exploratory mode and Part 11 still requires it to
//    "preserve explicitly locked properties", so a lock outranks every mode. `authorise` can only
//    turn an allowed action into a refused one.
//
// 2. **The default is the strict end of every axis.** An absent mode resolves to `production`
//    discipline with no exploratory freedom, because the alternative — treating "unspecified" as
//    "anything goes" — makes the safest call the one nobody wrote. `DEFAULT_MODE` is null rather
//    than 'create': not knowing which mode is active is different from being in create mode, and
//    Part 11 ends by requiring that *"the user must always know which mode is active"*.
//
// 3. **What a mode requires of the CALLER is stated, not enforced.** "Polish mode must start with
//    diagnosis" is a real requirement, and nothing here can verify that a diagnosis happened —
//    `ai/` sees a project and an action, not a session history. So it is returned as an
//    `obligations` list the handler reports, and the honest limitation is named rather than a
//    check being faked.
//
// Pure at load like the rest of `ai/`.

import { CERTAINTY, evidence, finding } from './certainty.js';

/**
 * The eight modes of Part 11.
 *
 * `mutates` is the only field with teeth on its own: `analyze` and `compare` are read-only, and
 * Part 11 says so in as many words ("Analyze mode must not modify anything unless the user
 * explicitly transitions into a change mode").
 */
export const MODES = Object.freeze({
  create: {
    summary: 'generate an initial motion, effect, shot or variation from intent',
    mutates: true,
    freedom: 'exploratory — may propose variation beyond the literal request',
    analysis_required: 'none before acting',
    approval: 'the change is reviewable after the fact, like any transaction',
    obligations: ['locked properties are preserved even here — Part 11 states this explicitly for create mode, and a lock outranks every mode'],
  },
  polish: {
    summary: 'improve a selected motion, pose, curve, VFX layer or shot element',
    mutates: true,
    freedom: 'bounded — the existing scope is the boundary, not a starting point',
    analysis_required: 'diagnosis first',
    approval: 'the change is reviewable after the fact',
    obligations: [
      'Part 11: polish "must start with diagnosis" — run analyze_motion / explain_motion_problem / simulate_change before editing',
      'Part 11: polish "must preserve scope boundaries" — do not widen the edit beyond what was selected',
    ],
  },
  analyze: {
    summary: 'inspect scene state, curves, motion, VFX, camera, synchronisation and technical validity',
    mutates: false,
    freedom: 'none — this mode does not change anything',
    analysis_required: 'this mode IS the analysis',
    approval: 'not applicable',
    obligations: ['Part 11: analyze "must not modify anything unless the user explicitly transitions into a change mode" — the transition is the user\'s to make, not the tool\'s'],
  },
  compare: {
    summary: 'compare a shot against a baseline, reference, alternative or prior version',
    mutates: false,
    freedom: 'none',
    analysis_required: 'this mode IS the analysis',
    approval: 'not applicable',
    obligations: ['Part 11: compare must "report evidence rather than generic preference" — a comparison with no measurement behind it is an opinion, and must be labelled subjective'],
  },
  fix: {
    summary: 'repair a declared issue',
    mutates: true,
    freedom: 'the narrowest of any mutating mode',
    analysis_required: 'the cause must be identified first',
    approval: 'the change is reviewable after the fact',
    obligations: [
      'Part 11: fix must "identify the cause" first — a correction applied without attribution is a guess',
      'Part 11: fix must "alter only the causal scope"',
      'Part 11: fix must "stop when the issue is resolved" — re-measure, and do not keep going',
    ],
  },
  experiment: {
    summary: 'generate bounded, named, reversible alternatives',
    mutates: true,
    freedom: 'wide WITHIN a declared boundary; none outside it',
    analysis_required: 'a hypothesis per candidate',
    approval: 'a candidate is applied only when one is chosen',
    obligations: [
      'Part 48: every experiment must declare its changed variables AND its protected variables — ai/experiment.js refuses one that does not',
      'Part 48: candidates must be meaningful hypotheses, not "superficial random parameter changes"',
    ],
  },
  review: {
    summary: 'a structured senior-animation, VFX, cinematic and QA review',
    mutates: false,
    freedom: 'none',
    analysis_required: 'this mode IS the analysis',
    approval: 'not applicable',
    obligations: ['Part 11: review must "distinguish deterministic defects from artistic suggestions" — ai/review.js keeps them in separate blocks that are never merged'],
  },
  ship: {
    summary: 'final validation, export constraints, provenance, and locking the accepted baseline',
    mutates: true,
    freedom: 'none beyond what shipping requires',
    analysis_required: 'full validation',
    approval: 'explicit acceptance',
    obligations: [
      'Part 11: ship must "verify export constraints" — validate_animation and the export acceptance check',
      'Part 11: ship must "preserve provenance" and "lock the accepted baseline"',
    ],
  },
});

export const MODE_NAMES = Object.freeze(Object.keys(MODES));

/**
 * Part 11's second axis, which crosses all eight modes.
 *
 * `production` is the default for the reason given in this file's header: an unspecified
 * discipline must not be the loosest one.
 */
export const DISCIPLINES = Object.freeze({
  exploration: {
    summary: 'rapid candidates, looser constraints, cheap previews, easy discard',
    constraints: 'looser — a warn-level constraint may be proceeded past with the warning recorded',
    provenance: 'still recorded; nothing in this layer skips provenance, because a discarded candidate a reviewer cannot find is not cheap, it is lost',
    previews: 'cheap previews are acceptable in place of full validation',
    acceptance: 'not required',
  },
  production: {
    summary: 'strict constraints, full provenance, deterministic validation, minimal unrelated changes, explicit acceptance',
    constraints: 'strict — a refusing constraint refuses, and `force` is the only override',
    provenance: 'full',
    previews: 'deterministic validation, not a cheap preview',
    acceptance: 'explicit acceptance is required before the work is considered done',
  },
});

export const DEFAULT_DISCIPLINE = 'production';

/** There is deliberately no default MODE. See decision 2 in this file's header: not knowing which
 *  mode is active is a distinct state from being in a permissive one, and Part 11 requires the
 *  active mode to be knowable. */
export const DEFAULT_MODE = null;

export function isMode(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(MODES, name);
}

/**
 * Resolve a declared mode and discipline into the policy that applies.
 *
 * An unknown mode is an error rather than a silent fallback: `mode: 'polsh'` resolving to "no mode"
 * would apply production discipline with no obligations and look like it worked.
 */
export function resolveMode(mode = DEFAULT_MODE, discipline = DEFAULT_DISCIPLINE) {
  const findings = [];
  let name = mode ?? null;
  if (name !== null && !isMode(name)) {
    return {
      ok: false, mode: null, discipline: DEFAULT_DISCIPLINE,
      question: `"${mode}" is not one of Part 11's operating modes (${MODE_NAMES.join(', ')}).`,
      findings, policy: null,
    };
  }
  let disc = discipline ?? DEFAULT_DISCIPLINE;
  if (!Object.prototype.hasOwnProperty.call(DISCIPLINES, disc)) {
    return {
      ok: false, mode: name, discipline: DEFAULT_DISCIPLINE,
      question: `"${discipline}" is not a Part 11 discipline (${Object.keys(DISCIPLINES).join(', ')}).`,
      findings, policy: null,
    };
  }

  if (name === null) {
    findings.push(finding({
      id: 'MODE-UNDECLARED',
      certainty: CERTAINTY.CERTAIN,
      statement: 'no operating mode was declared, so the strictest defaults apply: production discipline, and no mode-specific freedom',
      evidence: [evidence('convention', 'Part 11 requires the active mode to be knowable; an unstated mode is not a permissive one')],
      suggestion: { text: `declare one of: ${MODE_NAMES.join(', ')}`, reversible: true },
    }));
  }

  const m = name ? MODES[name] : null;
  return {
    ok: true,
    mode: name,
    discipline: disc,
    policy: {
      mutates: m ? m.mutates : false,
      freedom: m ? m.freedom : 'unstated, so treated as none',
      analysis_required: m ? m.analysis_required : 'unstated',
      approval: m ? m.approval : DISCIPLINES[disc].acceptance,
      obligations: m ? [...m.obligations] : [],
      constraints: DISCIPLINES[disc].constraints,
      provenance: DISCIPLINES[disc].provenance,
      acceptance_required: disc === 'production',
    },
    findings,
    limitations: MODE_LIMITATIONS,
  };
}

/**
 * May this action proceed in this mode?
 *
 * The one thing this can decide on its own is the read/write question, and it is the one Part 11
 * is most explicit about. Everything else a mode "requires" is about the caller's process rather
 * than the action's shape, so it comes back as `obligations` for the caller to report — see
 * decision 3 in the header.
 *
 * @param action.mutates  does this action change project data
 * @param action.name     the tool or operation, for the refusal text
 */
export function authorise(action, { mode = DEFAULT_MODE, discipline = DEFAULT_DISCIPLINE, force = false } = {}) {
  const r = resolveMode(mode, discipline);
  if (!r.ok) return { allowed: false, refused_because: r.question, mode: null, discipline: r.discipline, obligations: [], findings: r.findings };

  const mutating = !!action?.mutates;
  const name = action?.name || 'this action';

  if (mutating && r.mode && !r.policy.mutates) {
    // Not forceable. Part 11 says the transition out of a read-only mode is the user's to make;
    // a `force` flag that let a tool leave analyze mode on its own would be the tool making it.
    return {
      allowed: false,
      mode: r.mode,
      discipline: r.discipline,
      refused_because: `${name} changes project data, and "${r.mode}" mode does not modify anything — ${MODES[r.mode].obligations[0]}`,
      remedy: `re-issue this in a mutating mode (${MODE_NAMES.filter((n) => MODES[n].mutates).join(', ')}), which is a decision for the user to make explicitly`,
      forceable: false,
      obligations: r.policy.obligations,
      findings: r.findings,
    };
  }

  return {
    allowed: true,
    mode: r.mode,
    discipline: r.discipline,
    // Reported on every authorisation, because Part 11's closing requirement is that the user
    // always knows which mode is active — including when it is none.
    active: r.mode ? `${r.mode} / ${r.discipline}` : `no mode declared / ${r.discipline}`,
    obligations: r.policy.obligations,
    acceptance_required: r.policy.acceptance_required,
    forced: !!force,
    findings: r.findings,
  };
}

export const MODE_LIMITATIONS = Object.freeze([
  'A mode narrows what is permitted and never widens it. No mode overrides a lock or a refusing constraint; `create` is the most exploratory mode and Part 11 still requires it to preserve locked properties.',
  'The read/write distinction is the only rule enforced here. "Polish must start with diagnosis", "fix must stop when the issue is resolved" and "ship must lock the accepted baseline" are obligations on the CALLER: this layer sees a project and one action, never the session history that would prove a diagnosis happened first.',
  'Nothing infers the mode from the request text. An unstated mode stays unstated and gets the strictest defaults, rather than being guessed from words like "polish" — guessing it would make the safest reading the one nobody chose.',
  'The discipline axis (exploration/production) currently changes the reported constraint posture and whether acceptance is required. It does NOT yet make the constraint checker itself more permissive in exploration mode; `force` remains the only override, and that is deliberate until there is a way to mark a candidate as discardable.',
]);
