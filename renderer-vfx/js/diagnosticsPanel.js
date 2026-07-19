// The diagnostics surface: a status chip beside the transport ("2 errors · 1 warning") that
// expands into the full list — message, causes, per-diagnostic Fix buttons, and Fix-all-safe.
// Clicking a diagnostic selects its layer and scrubs to its frame. The chip re-renders on every
// (debounced) validation pass — continuous validation, not export-time surprises.

import * as ST from './studioState.js';
import { applyAutoFixes } from '../../renderer/js/diagnostics.js';
import { modal, toast } from '../../renderer/js/ui.js';

let chip;

export function initDiagnosticsPanel() {
  chip = document.getElementById('vfxDiagChip');
  chip.addEventListener('click', openList);
  ST.on('diagnostics', renderChip);
  ST.validateNow();
}

function renderChip() {
  const rep = ST.state.lastReport;
  if (!rep) { chip.textContent = '…'; return; }
  const { error, warning } = rep.counts;
  chip.classList.remove('err', 'warn', 'ok');
  if (error) {
    chip.textContent = `⛔ ${error} error${error > 1 ? 's' : ''}${warning ? ` · ${warning} warning${warning > 1 ? 's' : ''}` : ''}`;
    chip.classList.add('err');
  } else if (warning) {
    chip.textContent = `⚠ ${warning} warning${warning > 1 ? 's' : ''}`;
    chip.classList.add('warn');
  } else {
    chip.textContent = '✓ valid';
    chip.classList.add('ok');
  }
  chip.title = rep.summary + (error ? ' — errors block Send/Export' : '');
}

function openList() {
  const rep = ST.validateNow();
  const wrap = document.createElement('div');
  wrap.className = 'vfx-diag-list';

  if (!rep.diagnostics.length) {
    wrap.textContent = 'No issues — the effect is clean.';
  }
  for (const d of rep.diagnostics) {
    const row = document.createElement('div');
    row.className = `vfx-diag vfx-diag-${d.severity}`;
    const head = document.createElement('div');
    head.className = 'vfx-diag-head';
    const sev = document.createElement('span');
    sev.className = 'vfx-diag-sev';
    sev.textContent = { error: '⛔', warning: '⚠', suggestion: '💡', info: 'ℹ' }[d.severity] || '·';
    const msg = document.createElement('span');
    msg.className = 'vfx-diag-msg';
    msg.textContent = `${d.id} — ${d.message}`;
    head.append(sev, msg);
    row.appendChild(head);
    if (d.causes?.length) {
      const causes = document.createElement('div');
      causes.className = 'vfx-diag-causes';
      causes.textContent = `Likely: ${d.causes.join('; ')}`;
      row.appendChild(causes);
    }
    const actions = document.createElement('div');
    actions.className = 'vfx-diag-actions';
    if (d.target?.layerId) {
      const go = document.createElement('button');
      go.className = 'tb-btn';
      go.textContent = '→ Show me';
      go.addEventListener('click', () => {
        ST.select(d.target.layerId);
        if (d.frame != null) ST.setPlayhead(d.frame);
        m.close();
      });
      actions.appendChild(go);
    }
    if (d.fix) {
      const fixBtn = document.createElement('button');
      fixBtn.className = 'tb-btn primary';
      fixBtn.textContent = `Fix: ${d.fix.label}`;
      fixBtn.addEventListener('click', () => {
        ST.mutate((doc) => {
          const { applied, skipped } = applyAutoFixes({ effect: doc }, [d], { includeUnsafe: true });
          toast(applied.length ? `Fixed — ${applied[0].result}` : `Could not fix: ${skipped[0]?.reason}`);
        });
        m.close();
        openList(); // reopen with the fresh report
      });
      actions.appendChild(fixBtn);
    }
    if (actions.children.length) row.appendChild(actions);
    wrap.appendChild(row);
  }

  const fixables = rep.diagnostics.filter((d) => d.fix?.safe);
  const actions = [{ label: 'Close', run: () => { } }];
  if (fixables.length) {
    actions.unshift({
      label: `🔧 Fix all safe (${fixables.length})`,
      run: () => {
        ST.mutate((doc) => {
          const { applied } = applyAutoFixes({ effect: doc }, rep.diagnostics);
          toast(`${applied.length} issue(s) auto-fixed — Ctrl+Z reverts them all`);
        });
      },
    });
  }
  const m = modal({ title: `🩺 Diagnostics — ${rep.summary}`, body: wrap, actions });
}
