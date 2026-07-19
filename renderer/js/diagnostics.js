// The validation framework — and ONLY the framework. Validator packs register themselves from
// whichever window can satisfy their imports (docs/vfx-studio.md "Validator registration
// tiers"): shared effect validators (effectValidators.js) are state-free and register in both
// windows; animation validators need state.js and register from the main window's boot only;
// studio-only validators register from renderer-vfx boot. This file must stay importable in a
// bare context — no state.js, no window.*, no three.js — the smoketest enforces that.
//
// A Diagnostic is structured data, never prose-only (MCP tools return them verbatim):
//   {
//     id: 'VFX-E003',        // stable code — <AREA>-<E|W|S|I><nnn>; tests/tools key on these
//     severity: 'error' | 'warning' | 'suggestion' | 'info',
//     category: 'vfx' | 'animation' | 'timeline' | 'curves' | 'performance' | 'export' | ...,
//     target: { itemId?, layerId?, layerName?, prop?, modifierId? },
//     frame: number | null,  // where to scrub to see it
//     message: '…',          // specific, human-readable
//     causes: ['…'],         // most-likely causes, best first
//     fix: { autoFixId, label, safe } | null,
//     confidence: 0..1,
//   }
// Errors block export/send; warnings and below never block.

export const SEVERITIES = ['error', 'warning', 'suggestion', 'info'];
const SEV_RANK = { error: 0, warning: 1, suggestion: 2, info: 3 };

const validators = new Map(); // id -> { id, category, scopes, run }
const autoFixes = new Map();  // id -> { id, label, safe, apply }

// scopes: which runValidation scopes this validator participates in. 'effect' runs on every
// editor validation pass; 'export' adds the Roblox-fidelity checks that only matter when the
// doc is about to leave the studio; 'project' is the animator's whole-project sweep.
export function registerValidator({ id, category, scopes, run }) {
  if (!id || typeof run !== 'function') throw new Error('validator needs an id and a run()');
  validators.set(id, { id, category: category || 'general', scopes: scopes || ['effect'], run });
}

export function registerAutoFix({ id, label, safe = true, apply }) {
  if (!id || typeof apply !== 'function') throw new Error('auto-fix needs an id and an apply()');
  autoFixes.set(id, { id, label: label || id, safe, apply });
}

export function getAutoFix(id) {
  return autoFixes.get(id) || null;
}

// Convenience constructor: fills defaults so validators stay terse.
export function diag(id, severity, message, extra = {}) {
  return {
    id, severity, message,
    category: extra.category || 'vfx',
    target: extra.target || {},
    frame: extra.frame ?? null,
    causes: extra.causes || [],
    fix: extra.fix || null,
    confidence: extra.confidence ?? 0.9,
  };
}

// Run every validator registered for `scope` against ctx (shape depends on scope — effect
// validators get { effect }, project validators get { project, ... }). Validators must never
// throw for bad data — bad data is what they EXIST for — but a crashed validator is downgraded
// to its own error diagnostic rather than killing the whole pass.
export function runValidation(scope, ctx) {
  const diagnostics = [];
  for (const v of validators.values()) {
    if (!v.scopes.includes(scope)) continue;
    try {
      const out = v.run(ctx) || [];
      for (const d of out) diagnostics.push(d);
    } catch (e) {
      diagnostics.push(diag('SYS-E001', 'error', `Validator "${v.id}" crashed: ${e.message}`, {
        category: 'system', confidence: 1,
        causes: ['a document shape the validator did not expect — worth reporting'],
      }));
    }
  }
  diagnostics.sort((a, b) => (SEV_RANK[a.severity] ?? 4) - (SEV_RANK[b.severity] ?? 4));
  const counts = { error: 0, warning: 0, suggestion: 0, info: 0 };
  for (const d of diagnostics) if (counts[d.severity] !== undefined) counts[d.severity]++;
  return {
    scope,
    diagnostics,
    counts,
    blockedForExport: counts.error > 0,
    summary: counts.error + counts.warning + counts.suggestion + counts.info === 0
      ? 'No issues found'
      : `${counts.error} error(s), ${counts.warning} warning(s), ${counts.suggestion} suggestion(s), ${counts.info} note(s)`,
  };
}

// Apply auto-fixes for the given diagnostics (all of them by default, or a subset of diagnostic
// ids). Only fixes marked safe run without `includeUnsafe`. Returns what happened per
// diagnostic, so callers (the studio's Fix buttons, the vfx_auto_fix MCP tool) can report a
// faithful before/after instead of assuming.
export function applyAutoFixes(ctx, diagnostics, { onlyIds = null, includeUnsafe = false } = {}) {
  const applied = [], skipped = [];
  for (const d of diagnostics) {
    if (onlyIds && !onlyIds.includes(d.id)) continue;
    if (!d.fix || !d.fix.autoFixId) { skipped.push({ id: d.id, reason: 'no auto-fix available' }); continue; }
    const fix = autoFixes.get(d.fix.autoFixId);
    if (!fix) { skipped.push({ id: d.id, reason: `unknown auto-fix "${d.fix.autoFixId}"` }); continue; }
    if (!fix.safe && !includeUnsafe) { skipped.push({ id: d.id, reason: 'fix requires confirmation (not marked safe)' }); continue; }
    try {
      const result = fix.apply(ctx, d);
      applied.push({ id: d.id, autoFixId: fix.id, label: fix.label, result: result || 'applied' });
    } catch (e) {
      skipped.push({ id: d.id, reason: `fix crashed: ${e.message}` });
    }
  }
  return { applied, skipped };
}

export function listValidators() {
  return [...validators.values()].map((v) => ({ id: v.id, category: v.category, scopes: v.scopes }));
}
