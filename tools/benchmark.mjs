#!/usr/bin/env node
// The Part 59 benchmark suite, from the command line. Plain Node, no Electron.
//
//   node tools/benchmark.mjs                     run the suite against production and print it
//   node tools/benchmark.mjs --compare           ...and compare it against the committed baseline;
//                                                exit 1 on any deterministic regression or drift
//   node tools/benchmark.mjs --write-baseline    regenerate renderer/js/ai/benchmarkBaseline.js
//                                                (a DELIBERATE act — the diff is the approval, Part 44)
//   node tools/benchmark.mjs --json out.json     write the run as JSON (review_architecture_experiment
//                                                accepts it as a before/after run)
//   node tools/benchmark.mjs --options '{"protect_support_chains":true}'
//                                                run a declared-option prototype (ai/benchmark.js
//                                                IMPLEMENTATION_OPTIONS) instead of production
//   node tools/benchmark.mjs --prototype ./p.mjs run a code prototype: the module's default export is
//                                                `{ label, options?, overrides? }` for makeImplementation
//   node tools/benchmark.mjs --ids heavy_attack,walk_cycle
//                                                a subset
//
// What "drift" means in --compare: the committed baseline is the production run at the commit that
// wrote it. A fresh production run that differs on a measured dimension — in EITHER direction — means
// the code changed what a benchmark measures, and that change is either an intended improvement
// (re-run with --write-baseline and commit the new baseline with the change) or a regression. Both
// exit 1, because both need a person to say which. Timing is never compared.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const B = await imp('renderer/js/ai/benchmark.js');
// The layer's index re-exports the baseline module this script GENERATES, so importing it here
// would make the first-ever baseline impossible to write. The version is read from the source.
const SEMANTIC_LAYER_VERSION = (fs.readFileSync(path.join(ROOT, 'renderer/js/ai/index.js'), 'utf8').match(/SEMANTIC_LAYER_VERSION = '([^']+)'/) || [])[1] ?? 'unknown';
const AI = { SEMANTIC_LAYER_VERSION };

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

const rigs = JSON.parse(fs.readFileSync(path.join(ROOT, 'rigs/builtin.json'), 'utf8'));
const clock = { now: () => performance.now() };
const timestamp = new Date().toISOString();

let implementation = null;
if (value('--options')) implementation = B.makeImplementation({ label: 'options', options: JSON.parse(value('--options')) });
if (value('--prototype')) {
  const mod = await import(pathToFileURL(path.resolve(value('--prototype'))).href);
  implementation = B.makeImplementation(mod.default || mod);
}
const ids = value('--ids') ? value('--ids').split(',').map((s) => s.trim()).filter(Boolean) : null;

const run = B.runSuite({ rigs, ids, implementation, clock, timestamp, repeat: 2 });

// ---------------------------------------------------------------- print
const pad = (s, n) => String(s).padEnd(n);
console.log(`\nCadence benchmark suite — ${run.implementation.label}${run.implementation.options_on.length ? ` (options: ${run.implementation.options_on.join(', ')})` : ''}${run.implementation.overrides.length ? ` (overrides: ${run.implementation.overrides.join(', ')})` : ''}`);
console.log(`semantic layer ${AI.SEMANTIC_LAYER_VERSION} · run ${run.id} · ${run.results.length} benchmark(s) · ${run.elapsed_ms} ms\n`);
for (const r of run.results) {
  const status = r.status === 'ran' ? (r.reproducible ? 'ran' : 'NOT REPRODUCIBLE') : r.status.toUpperCase();
  console.log(`${pad(r.benchmark_id, 24)} ${pad(status, 18)} ${pad(`${r.elapsed_ms ?? '-'} ms`, 10)} ${r.category}`);
  for (const [dim, m] of Object.entries(r.measured)) console.log(`    ${pad(dim, 42)} ${m.value} ${m.unit}`);
  for (const c of r.checks.filter((x) => x.ok === false)) console.log(`    FAILED CHECK  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (r.status !== 'ran') console.log(`    ${r.reason}`);
}
console.log(`\n${run.summary.ran} ran, ${run.summary.reproducible} reproducible, ${run.summary.checks_failed} failed check(s), ${run.summary.not_run} not run, ${run.summary.failed} threw`);
console.log(`${run.dimensions.measured_in_this_run.length} dimension(s) measured this run; ${run.dimensions.not_measured_in_this_build.length} of Part 59's ${B.DIMENSION_IDS.length} are not measurable in a headless run`);
console.log(`${run.categories.defined} of Part 59's ${B.BENCHMARK_CATEGORIES.length} categories have a benchmark; ${run.categories.undefined} are blocked (see listBenchmarks().categories)`);

if (value('--json')) {
  fs.writeFileSync(path.resolve(value('--json')), JSON.stringify(run, null, 2));
  console.log(`\nrun written to ${path.resolve(value('--json'))}`);
}

// ---------------------------------------------------------------- baseline
const BASELINE_PATH = path.join(ROOT, 'renderer/js/ai/benchmarkBaseline.js');

function commitHash() {
  try { return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; }
}

if (flag('--write-baseline')) {
  if (implementation && !implementation.production) {
    console.error('\nrefusing to write a prototype run as the baseline — the baseline is PRODUCTION at a commit');
    process.exit(2);
  }
  const stripped = stripForBaseline(run);
  const src = `// GENERATED by \`node tools/benchmark.mjs --write-baseline\` — do not edit by hand.
//
// The production run of the Part 59 benchmark suite at the commit that wrote this file. Every fresh
// run is compared against it (\`compareRuns(BASELINE_RUN, fresh)\`): a difference on a measured
// dimension means the code changed what a benchmark measures, and a person decides whether that
// was the point (re-run --write-baseline and commit the diff with the change) or a regression.
// Wall-clock numbers are stripped, because a busy machine is not a regression. This module is
// data only, and is pure at load like the rest of ai/.
//
// semantic layer ${AI.SEMANTIC_LAYER_VERSION} · commit ${commitHash() ?? 'unknown'} · written ${timestamp}

export const BASELINE_META = Object.freeze(${JSON.stringify({ semantic_layer_version: AI.SEMANTIC_LAYER_VERSION, commit: commitHash(), written_at: timestamp, benchmarks: run.results.length }, null, 2)});

export const BASELINE_RUN = Object.freeze(${JSON.stringify(stripped, null, 2)});
`;
  fs.writeFileSync(BASELINE_PATH, src);
  console.log(`\nbaseline written to ${path.relative(ROOT, BASELINE_PATH)} (${run.results.length} benchmark(s), run ${run.id})`);
}

/** Timing out, everything measured in. `detail` blocks are kept — they are what a reviewer reads
 *  when a number moves. */
function stripForBaseline(r) {
  return {
    ...r,
    elapsed_ms: null,
    results: r.results.map((x) => ({ ...x, elapsed_ms: null })),
  };
}

// ---------------------------------------------------------------- compare
if (flag('--compare')) {
  const BASE = await imp('renderer/js/ai/benchmarkBaseline.js');
  const cmp = B.compareRuns(BASE.BASELINE_RUN, run);
  console.log(`\ncompared against the committed baseline (${BASE.BASELINE_META.semantic_layer_version} @ ${BASE.BASELINE_META.commit ?? 'unknown'}, ${BASE.BASELINE_META.written_at})`);
  console.log(`  improved ${cmp.counts.improved} · regressed ${cmp.counts.regressed} · unchanged ${cmp.counts.unchanged} · not comparable ${cmp.counts.not_comparable}`);
  for (const c of cmp.cells.filter((x) => x.verdict !== 'unchanged')) {
    console.log(`  ${pad(c.verdict.toUpperCase(), 10)} ${c.benchmark_id}.${c.dimension}: ${c.before} → ${c.after} ${c.unit}`);
  }
  for (const b of cmp.benchmarks) {
    if (!b.comparable) console.log(`  NOT COMPARABLE ${b.benchmark_id}: ${b.reason}`);
    for (const f of b.check_flips || []) console.log(`  CHECK FLIPPED  ${b.benchmark_id}: "${f.check}" ${f.before} → ${f.after}`);
  }
  const drift = cmp.counts.improved + cmp.counts.regressed + cmp.benchmarks.filter((b) => !b.comparable).length + cmp.benchmarks.reduce((a, b) => a + (b.check_flips || []).filter((f) => f.before === true && f.after === false).length, 0);
  if (drift) {
    console.log(`\n${drift} deterministic difference(s) from the baseline. If this change was meant to move a measured outcome, re-run with --write-baseline and commit the new baseline WITH the change; otherwise it is a regression.`);
    process.exit(1);
  }
  console.log('\nno deterministic difference from the baseline');
}
