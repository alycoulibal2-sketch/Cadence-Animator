// Part 20.1 — turning a request into an IntentSpec, and saying out loud what it was taken to mean.
//
// This module is the boundary where English becomes structure. Everything past it reasons about
// dimensions, phases and constraints; nothing past it reads the request string again. That makes
// the interpretation the single place a misunderstanding can happen — which is exactly why Part
// 20.1 requires it to be printed back:
//
//     Interpretation of "extremely heavy but explosive":
//     - preparation uses visible weight transfer rather than slow overall motion;
//     - …
//
// The parser is a CLOSED GRAMMAR, matching `ai/constraints.js`. It scans for patterns it knows,
// marks the spans it consumed, and reports the words it did not use. It never falls back to
// guessing, because the two failure modes of a guessing parser are both silent: it protects things
// nobody asked to protect, and it drops the protection somebody did ask for.
//
// Leftover words are not an error. They are returned in `unrecognised`, with a question, and the
// caller decides whether they mattered.

import * as VOC from './vocabulary.js';
import * as CAL from './cal.js';
import { compileConstraints } from './constraints.js';
import { CERTAINTY, coverage, evidence, finding } from './certainty.js';

// ---------------------------------------------------------------- modifiers
//
// The multiplier a word puts on a term's pull, and its sign. `too` is the interesting one: "too
// heavy" is a request to REDUCE heaviness, and reading it as an intensifier would produce the
// opposite of what was asked.

const MODIFIERS = Object.freeze({
  slightly: 0.5, 'a bit': 0.5, 'a little': 0.5, somewhat: 0.6, 'a touch': 0.5,
  more: 1, much: 1.4, far: 1.4, very: 1.4, really: 1.4, 'a lot': 1.4, 'way': 1.4,
  extremely: 1.7, 'insanely': 1.7, 'super': 1.5, 'incredibly': 1.7,
  less: -1, 'not so': -1, 'not as': -1, 'too': -1, 'overly': -1, 'not': -1,
});
const MODIFIER_FORMS = Object.keys(MODIFIERS).sort((a, b) => b.length - a.length);

/** Words that carry no interpretable content, so their presence in the leftovers is not a gap.
 *  Kept deliberately short — a long list would swallow real words and make the "did you mean
 *  something by this?" question stop firing when it matters. */
const FILLER = new Set([
  'make', 'makes', 'making', 'made', 'let', 'lets', 'give', 'gives',
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its',
  'be', 'is', 'are', 'was', 'were', 'been', 'being', 'do', 'does', 'did',
  'feel', 'feels', 'feeling', 'look', 'looks', 'looking', 'read', 'reads', 'seem', 'seems',
  'should', 'shall', 'must', 'can', 'could', 'would', 'will', 'want', 'wants', 'need', 'needs',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'please', 'just', 'now',
  'to', 'of', 'on', 'in', 'at', 'for', 'with', 'and', 'but', 'or', 'so', 'as', 'by', 'from',
  'animation', 'anim', 'motion', 'clip', 'shot', 'move', 'movement', 'whole', 'entire', 'all', 'bit', 'lot',
  'it\'s', 'its', 'up', 'down', 'again', 'still', 'overall',
]);

// ---------------------------------------------------------------- phases and ranges

/**
 * Words that name a phase of the motion. These pick a TIME RANGE, which the segmenter then has to
 * supply — this table only says which phase name was meant.
 *
 * `swing`, `slash`, `strike` and `attack` are deliberately ABSENT even though each names a phase in
 * some contexts. In "make the slash heavier" the word names the whole motion, not the middle third
 * of it, and reading it as a phase produced exactly that bug: the request scoped itself to a span
 * the segmenter had not identified, and the plan came back empty. They live in ACTION_WORDS, which
 * is scanned first, so the word sets the action type and the phase template rather than a range.
 */
const PHASE_WORDS = Object.freeze({
  windup: 'anticipation', 'wind-up': 'anticipation', 'wind up': 'anticipation',
  anticipation: 'anticipation', prep: 'preparation', preparation: 'preparation',
  buildup: 'preparation', 'build-up': 'preparation',
  action: 'action', acceleration: 'acceleration',
  impact: 'impact', hit: 'impact', contact: 'impact',
  'follow-through': 'follow_through', 'follow through': 'follow_through', followthrough: 'follow_through',
  recovery: 'recovery', 'recover': 'recovery',
  settle: 'settle', 'settling': 'settle',
});
const PHASE_FORMS = Object.keys(PHASE_WORDS).sort((a, b) => b.length - a.length);

/** A small, closed set of action words. Deliberately NOT exhaustive: `action_type` selects a phase
 *  template, and getting it wrong shapes the whole plan, so an unrecognised action stays null and
 *  the caller is asked rather than being given a default that looks like a decision. */
const ACTION_WORDS = Object.freeze({
  attack: 'attack', slash: 'attack', swing: 'attack', punch: 'attack', kick: 'attack', strike: 'attack', stab: 'attack', swipe: 'attack',
  walk: 'locomotion', run: 'locomotion', sprint: 'locomotion', jump: 'locomotion', land: 'locomotion', crouch: 'locomotion', dash: 'locomotion',
  idle: 'idle', breathe: 'idle', breathing: 'idle',
  react: 'reaction', reaction: 'reaction', flinch: 'reaction', stagger: 'reaction', recoil: 'reaction', hurt: 'reaction',
  wave: 'gesture', point: 'gesture', gesture: 'gesture', nod: 'gesture', shrug: 'gesture',
  cutscene: 'cinematic', cinematic: 'cinematic',
});

const STYLE_WORDS = Object.freeze({
  anime: 'anime', cartoon: 'cartoon', cartoony: 'cartoon', realistic: 'realistic', realism: 'realistic',
  cinematic: 'cinematic', mechanical: 'mechanical', robotic: 'mechanical', horror: 'horror',
  fantasy: 'fantasy', magical: 'fantasy', abstract: 'abstract', 'game combat': 'game_combat', combat: 'game_combat',
});

// ---------------------------------------------------------------- the closed grammar
//
// Each entry consumes a span of the request and contributes something structured. Order matters:
// the preserve clauses run first so that "without changing timing" is consumed before the term
// scanner can see the words inside it.

const PRESERVE_GRAMMAR = [
  {
    example: 'without changing timing',
    re: /\b(?:with(?:out| no)|but (?:do ?n[o']?t|never)|while (?:not )?keeping)\s*(?:chang(?:e|ing)|alter(?:ing)?|touch(?:ing)?|mov(?:e|ing)|shift(?:ing)?)?\s*(?:the\s+)?(timing|poses?|values?|easing|eases|interpolation|spacing|contacts?|key ?times?)\b/gi,
    apply: (m, out) => {
      const aspect = ASPECT_WORD[m[1].toLowerCase().replace(/s$/, '')] || null;
      if (!aspect) return false;
      out.preserveAspects.add(aspect);
      out.preserveText.push(`do not change ${aspect === 'value' ? 'poses' : aspect}`);
      return true;
    },
  },
  {
    example: 'keep the timing',
    re: /\b(?:keep|hold|retain|maintain)(?:ing)? (?:the )?(timing|poses?|values?|easing|spacing|key ?times?)\b(?! within)/gi,
    apply: (m, out) => {
      const aspect = ASPECT_WORD[m[1].toLowerCase().replace(/s$/, '')] || null;
      if (!aspect) return false;
      out.preserveAspects.add(aspect);
      out.preserveText.push(`do not change ${aspect === 'value' ? 'poses' : aspect}`);
      return true;
    },
  },
  {
    example: 'same timing',
    re: /\b(?:the )?same (timing|poses?|length|duration|key ?times?)\b/gi,
    apply: (m, out) => {
      const w = m[1].toLowerCase();
      if (w === 'length' || w === 'duration') { out.preserveDuration = true; out.preserveText.push('the total length does not change'); return true; }
      const aspect = ASPECT_WORD[w.replace(/s$/, '')] || null;
      if (!aspect) return false;
      out.preserveAspects.add(aspect);
      out.preserveText.push(`do not change ${aspect === 'value' ? 'poses' : aspect}`);
      return true;
    },
  },
  {
    example: 'keep the impact on frame 16',
    re: /\b(?:keep|hold|lock)(?:ing)? (?:the )?(?:impact|hit|contact|beat|event) (?:on|at) frame (-?\d+(?:\.\d+)?)(?:\s*(?:within|±|\+\/-)\s*(\d+(?:\.\d+)?)\s*frames?)?/gi,
    apply: (m, out) => {
      out.protectFrames.push({ frame: Number(m[1]), tolerance: m[2] ? Number(m[2]) : 0, reason: 'the request named it as a protected moment' });
      return true;
    },
  },
  {
    example: "don't touch the left arm",
    re: /\b(?:do ?n[o']?t|do not|never|avoid)\s+(?:chang(?:e|ing)|touch(?:ing)?|mov(?:e|ing)|edit(?:ing)?)\s+(?:the\s+)?([a-z][a-z\s]*?)(?=\s*(?:[,.;]|$|\band\b|\bbut\b|\bwhile\b|\bwithout\b))/gi,
    apply: (m, out) => {
      const phrase = m[1].trim();
      // A bare aspect word here was already handled above; anything else is a semantic target and
      // is passed to the selector rather than being interpreted here.
      if (ASPECT_WORD[phrase.replace(/s$/, '')]) return false;
      out.preserveTargets.push(phrase);
      return true;
    },
  },
];

const ASPECT_WORD = Object.freeze({
  timing: 'timing', 'key time': 'timing', keytime: 'timing',
  pose: 'value', value: 'value',
  easing: 'easing', ease: 'easing', interpolation: 'easing',
  spacing: 'easing',   // spacing is expressed through easing in Cadence's key model
  contact: 'contact',  // not an ASPECT — handled separately below
});

// ---------------------------------------------------------------- parsing

class Mask {
  constructor(text) { this.text = text; this.used = new Array(text.length).fill(false); }
  /** True if the span is still free; marks it used when it is. Overlapping matches are refused so
   *  a term inside an already-consumed preserve clause cannot be double-counted. */
  claim(start, end) {
    for (let i = start; i < end; i++) if (this.used[i]) return false;
    for (let i = start; i < end; i++) this.used[i] = true;
    return true;
  }
  leftovers() {
    let cur = '', out = [];
    for (let i = 0; i < this.text.length; i++) {
      if (this.used[i]) { if (cur.trim()) out.push(cur.trim()); cur = ''; }
      else cur += this.text[i];
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
}

function scan(re, text, mask, fn) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    if (mask.claim(m.index, m.index + m[0].length)) {
      if (fn(m) === false) {
        // The handler declined; give the span back so a later rule can have it.
        for (let i = m.index; i < m.index + m[0].length; i++) mask.used[i] = false;
      }
    }
  }
}

/** Escape a literal for use inside a RegExp. Surface forms come from a frozen table, but they do
 *  contain hyphens and are worth escaping rather than trusting. */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseRequest(text) {
  const out = {
    terms: [], preserveAspects: new Set(), preserveTargets: [], preserveText: [], protectFrames: [],
    preserveDuration: false, phases: [], ranges: [], actionType: null, styleProfile: null,
    evidence: [],
  };
  if (!text) return { ...out, leftovers: [], mask: null };
  const mask = new Mask(text);

  // 1. preserve clauses first — they contain words the term scanner would otherwise consume
  for (const g of PRESERVE_GRAMMAR) scan(g.re, text, mask, (m) => g.apply(m, out));

  // 2. explicit frame ranges
  scan(/\bframes?\s+(-?\d+(?:\.\d+)?)\s*(?:-|–|—|to|through|until|\.\.)\s*(-?\d+(?:\.\d+)?)/gi, text, mask, (m) => {
    out.ranges.push([Number(m[1]), Number(m[2])]);
  });
  scan(/\b(?:at|on) frame\s+(-?\d+(?:\.\d+)?)/gi, text, mask, (m) => {
    out.ranges.push([Number(m[1]), Number(m[1])]);
  });

  // 3. action type and style — BEFORE phases, so a word that could be either ("slash") names the
  //    motion rather than scoping the edit to a third of it
  scan(new RegExp(`\\b(${Object.keys(ACTION_WORDS).map(esc).join('|')})\\b`, 'gi'), text, mask, (m) => {
    if (!out.actionType) {
      out.actionType = ACTION_WORDS[m[1].toLowerCase()];
      out.evidence.push(evidence('convention', `"${m[1]}" reads as a ${out.actionType}`, 'action type steers the phase template; it is a guess from one word'));
    }
  });
  scan(new RegExp(`\\b(${Object.keys(STYLE_WORDS).map(esc).join('|')})\\b`, 'gi'), text, mask, (m) => {
    if (!out.styleProfile) out.styleProfile = STYLE_WORDS[m[1].toLowerCase()];
  });

  // 4. named phases
  scan(new RegExp(`\\b(${PHASE_FORMS.map(esc).join('|')})\\b`, 'gi'), text, mask, (m) => {
    const phase = PHASE_WORDS[m[1].toLowerCase()];
    if (phase && !out.phases.includes(phase)) out.phases.push(phase);
  });

  // 5. vocabulary terms, with the modifier that precedes them
  const termRe = new RegExp(`(?:\\b(${MODIFIER_FORMS.map(esc).join('|')})\\s+)?\\b(${VOC.surfaceForms().map(esc).join('|')})\\b`, 'gi');
  scan(termRe, text, mask, (m) => {
    const term = VOC.termFor(m[2]);
    if (!term) return false;
    const mod = m[1] ? MODIFIERS[m[1].toLowerCase()] ?? 1 : 1;
    out.terms.push({ term, weight: mod, surface: m[0].trim() });
    out.evidence.push(evidence('data', `the request says "${m[0].trim()}"`, `read as ${term} × ${mod}`));
  });

  const leftovers = mask.leftovers()
    .flatMap((chunk) => chunk.split(/[\s,;.]+/))
    .map((w) => w.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, ''))
    .filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w));

  return { ...out, leftovers, mask };
}

// ---------------------------------------------------------------- the public entry point

/**
 * Interpret a request into an IntentSpec, an explanation, and the constraints it implies.
 *
 * Structured arguments always win over the parsed text: a caller who knows the action type should
 * not have to phrase a sentence that produces it. The text is for humans, and its parse is
 * reported so a human can see what it did.
 *
 * @param req.request      the raw text
 * @param req.itemId       the item this is about (used to scope vocabulary overrides)
 * @param req.timeRange    `[from, to]` — overrides any range found in the text
 * @param req.terms        `[{term, weight}]` — bypasses the term scanner entirely
 * @param req.preserve     extra semantic targets to protect
 * @param req.preserveAspects  `['timing', …]`
 * @param req.mode         Part 11's operating mode
 */
export function interpretRequest(project, req = {}) {
  const text = req.request ?? null;
  const parsed = parseRequest(text);

  const terms = req.terms && req.terms.length ? req.terms.map((t) => (typeof t === 'string' ? { term: t, weight: 1 } : t)) : parsed.terms;
  const itemId = req.itemId ?? null;
  const styleProfile = req.styleProfile ?? parsed.styleProfile ?? null;

  const interp = VOC.interpret(project, terms, { itemId, style: styleProfile });

  const preserveAspects = new Set([...(req.preserveAspects || []), ...parsed.preserveAspects]);
  const preserveTargets = [...(req.preserve || []), ...parsed.preserveTargets];
  const protectFrames = [...(req.protectFrames || []), ...parsed.protectFrames];

  const questions = [];
  const findings = [...interp.findings];

  // --- what does this apply to?
  const timeRange = req.timeRange ?? (parsed.ranges.length
    ? [Math.min(...parsed.ranges.map((r) => r[0])), Math.max(...parsed.ranges.map((r) => r[1]))]
    : null);
  const phases = req.phases ?? parsed.phases;
  if (!timeRange && !phases.length) {
    questions.push('No frame range or phase was named, so this applies to the whole animation. Say "frames 4 to 12" or name a phase ("the windup") to narrow it.');
  }

  // --- unknown words
  if (interp.unknown_terms.length) {
    questions.push(`These were passed as terms but are not in the vocabulary: ${interp.unknown_terms.join(', ')}. Call animation_vocabulary for the list, or define one with set_vocabulary_term.`);
  }
  if (parsed.leftovers.length) {
    questions.push(`These words were not understood and changed nothing: ${[...new Set(parsed.leftovers)].map((w) => `"${w}"`).join(', ')}. If one of them mattered, restate it — nothing was guessed from it.`);
    findings.push(finding({
      id: 'INTENT-UNPARSED',
      certainty: CERTAINTY.CERTAIN,
      statement: `${new Set(parsed.leftovers).size} word(s) in the request were not interpreted.`,
      evidence: [evidence('absence', `unmatched: ${[...new Set(parsed.leftovers)].join(', ')}`, 'the grammar is closed; unmatched text is reported rather than guessed at')],
    }));
  }
  if (!terms.length) {
    questions.push('No vocabulary term was found in the request, so there is no dimension to move. Pass `terms` directly, or use a word the vocabulary knows.');
  }
  for (const t of interp.tensions) questions.push(t.question);

  // --- the intent
  const weightDim = interp.dimensions.weight_transfer ?? 0;
  const energyDim = interp.dimensions.acceleration_contrast ?? 0;
  const intent = CAL.intentSpec({
    actionType: req.actionType ?? parsed.actionType,
    narrativePurpose: req.narrativePurpose ?? null,
    emotionalIntent: req.emotionalIntent ?? null,
    styleProfile,
    // energy and weight are DERIVED from the dimension vector, mapped from [-1,1] onto [0,1] with
    // 0.5 meaning "as it is now". A caller can override; nothing invents a value from nothing.
    energy: req.energy ?? (terms.length ? clamp01(0.5 + energyDim / 2) : null),
    energyWhy: terms.length ? `derived from acceleration_contrast ${fmt(energyDim)}; 0.5 means unchanged from the current animation` : null,
    weight: req.weight ?? (terms.length ? clamp01(0.5 + weightDim / 2) : null),
    weightWhy: terms.length ? `derived from weight_transfer ${fmt(weightDim)}; 0.5 means unchanged from the current animation` : null,
    readabilityPriority: req.readabilityPriority ?? null,
    realismLevel: req.realismLevel ?? null,
    audienceFocus: req.audienceFocus ?? null,
    requestedDuration: req.requestedDuration ?? (parsed.preserveDuration ? { unchanged: true } : null),
    criticalEvents: protectFrames.map((f) => ({ eventId: `frame_${f.frame}`, expectedTime: f.frame, tolerance: f.tolerance })),
    preserve: [...preserveTargets, ...[...preserveAspects].map((a) => `aspect:${a}`)],
    avoid: req.avoid ?? [],
    evidenceSource: [
      ...(text ? [`user text: "${text}"`] : []),
      ...(req.terms && req.terms.length ? ['terms supplied structurally by the caller'] : []),
      ...interp.overrides_applied.map((o) => `project vocabulary override ${o.id} (${o.scope})`),
    ],
    confidence: confidenceOf(terms, parsed, interp, questions),
    unresolvedQuestions: questions,
    dimensions: interp.dimensions,
    vfxDimensions: interp.vfx_dimensions,
    terms: interp.terms,
    target: { itemId, timeRange, phases },
    request: text,
    mode: req.mode ?? null,
  });

  // --- the constraints the preserve clause implies
  //
  // Compiled through the existing constraint compiler rather than a second one, so a protection
  // written in a request and one written by hand are the same object and are enforced by the same
  // code. Aspect protections become one whole-project `preserve` per aspect.
  const constraintReq = {
    preserve: preserveTargets,
    protect_frames: protectFrames,
    text: parsed.preserveText.join('\n') || undefined,
    reason: text ? `from the request: "${text}"` : 'from the interpreted intent',
  };
  const compiled = compileConstraints(constraintReq, project, { source: 'user' });

  const explanation = VOC.explain(interp, { phrase: text });
  // The preserve clause belongs in the human-readable interpretation too — it is half of what the
  // user said, and an interpretation that only reports what will change is misleading.
  const preserveLines = [
    ...[...preserveAspects].map((a) => `${a === 'value' ? 'poses' : a}: protected — the request said not to change it`),
    ...preserveTargets.map((t) => `"${t}": protected`),
    ...protectFrames.map((f) => `frame ${f.frame}: held${f.tolerance ? ` within ±${f.tolerance}` : ''}`),
  ];

  return {
    intent,
    interpretation: {
      header: explanation.header,
      changes: explanation.lines,
      preserves: preserveLines,
      text: [explanation.header, ...explanation.lines.map((l) => `- ${l};`), ...preserveLines.map((l) => `- ${l};`)].join('\n'),
    },
    vocabulary: interp,
    constraints: compiled,
    questions,
    unrecognised: [...new Set(parsed.leftovers)],
    parse: {
      terms: parsed.terms,
      phases: parsed.phases,
      ranges: parsed.ranges,
      action_type: parsed.actionType,
      style_profile: parsed.styleProfile,
      preserve_aspects: [...preserveAspects],
      grammar: PRESERVE_GRAMMAR.map((g) => g.example),
    },
    findings,
    coverage: coverage({
      scope: text ? `the request "${text}"` : 'a structured intent with no text',
      loop: 'fast',
      notRun: [
        ...interp.notRun,
        'the request is not checked against the scene — whether the named phase or range exists is decided by plan_motion, not here',
      ],
    }),
  };
}

function clamp01(v) { return Math.max(0, Math.min(1, Math.round(v * 1000) / 1000)); }
function fmt(v) { return `${v > 0 ? '+' : ''}${v}`; }

/**
 * How much of the request was understood, as a 0..1 number that is a real fraction rather than a
 * feeling: the share of recognised content, penalised by open questions.
 */
function confidenceOf(terms, parsed, interp, questions) {
  if (!terms.length) return 0;
  const recognised = terms.length + parsed.phases.length + parsed.ranges.length + parsed.preserveText.length;
  const total = recognised + parsed.leftovers.length + interp.unknown_terms.length;
  const base = total ? recognised / total : 0;
  // Each unresolved question costs a tenth, floored at a third — a request with open questions is
  // never fully confident, and a request with many is not zero-confidence either.
  return Math.round(Math.max(base * 0.34, base - questions.length * 0.1) * 100) / 100;
}

/** The grammar and vocabularies a caller needs to phrase a request this module will understand. */
export function intentVocabulary() {
  return {
    action_types: CAL.ACTION_TYPES,
    style_profiles: CAL.STYLE_PROFILES,
    emotions: CAL.EMOTIONS,
    realism_levels: CAL.REALISM_LEVELS,
    readability: CAL.READABILITY,
    audience_focus: CAL.AUDIENCE_FOCUS,
    terms: VOC.surfaceForms(),
    modifiers: MODIFIER_FORMS,
    phase_words: Object.keys(PHASE_WORDS),
    preserve_grammar: PRESERVE_GRAMMAR.map((g) => g.example),
    range_forms: ['frames 4 to 12', 'frames 4-12', 'at frame 16'],
    note: 'the grammar is closed. Words it does not recognise are returned in `unrecognised` and change nothing — they are never guessed at.',
  };
}
