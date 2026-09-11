#!/usr/bin/env node
// Write the twelve compiled classical principles out as JSON, one file per concept.
//
//   node tools/export-knowledge.mjs            # write docs/animation-intelligence/knowledge/*.json
//   node tools/export-knowledge.mjs --check    # exit 1 if the files on disk disagree with the module
//
// Why both a module table AND files on disk:
//
//   * the MODULE is the authority, because the twelve are compiled reference data (see the header
//     of `renderer/js/ai/knowledge.js` for why they are not project state);
//   * the FILES are what a session, a watch batch, or anything outside this repo can read, diff
//     and add to. `docs/animation-intelligence/knowledge/` is the same folder the watch sessions'
//     accepted entries are merged into, so one folder holds the whole corpus in one shape.
//
// `--check` runs in `aitest`, so the two cannot drift: change a card in the module and the export
// is a required part of the same commit, the way `benchmarkBaseline.js` is.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = path.join(ROOT, 'docs/animation-intelligence/knowledge');

const KNOW = await import('../renderer/js/ai/knowledge.js');

/** Deterministic, stable, diffable: the Part 25 field order the module declares, two-space JSON,
 *  a trailing newline. A reordered key would show as a whole-file diff and hide the real change. */
function serialise(entry) {
  const ordered = {};
  for (const f of KNOW.knowledgeFieldList()) ordered[f] = entry[f];
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

const wanted = new Map();
for (const e of KNOW.KNOWLEDGE_ENTRIES) wanted.set(`${e.concept}.json`, serialise(e));

const check = process.argv.includes('--check');
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
for (const [name, text] of wanted) {
  const file = path.join(OUT, name);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (current === text) continue;
  if (check) { problems.push(current === null ? `${name} is missing` : `${name} differs from the module`); continue; }
  fs.writeFileSync(file, text);
  console.log(`${current === null ? 'wrote' : 'updated'} ${name}`);
}

// A card renamed or removed in the module must not leave an orphan file behind claiming to be a
// classical principle. Merged watch entries live in the same folder, so only files whose concept
// the module OWNS are policed — anything else is somebody's accepted entry and is left alone.
const builtinConcepts = new Set(KNOW.KNOWLEDGE_ENTRIES.map((e) => e.concept));
for (const f of fs.readdirSync(OUT).filter((n) => n.endsWith('.json'))) {
  if (wanted.has(f)) continue;
  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch (_) { continue; }
  if (!builtinConcepts.has(parsed?.concept)) continue;
  if (check) problems.push(`${f} claims a built-in concept "${parsed.concept}" under the wrong filename`);
  else { fs.unlinkSync(path.join(OUT, f)); console.log(`removed stale ${f}`); }
}

if (check) {
  if (problems.length) {
    console.error(`knowledge seed is out of date:\n  ${problems.join('\n  ')}\nrun: node tools/export-knowledge.mjs`);
    process.exit(1);
  }
  console.log(`knowledge seed matches the module (${wanted.size} entries)`);
} else {
  console.log(`${wanted.size} entries in ${path.relative(ROOT, OUT)}`);
}
