#!/usr/bin/env node
// Merge a watch batch's knowledge entries into the corpus.
//
//   node tools/merge-knowledge-inbox.mjs --batch W01 --dry-run   # report only, move nothing
//   node tools/merge-knowledge-inbox.mjs --batch W01             # move that batch's accepted entries
//
// Step 1 and 2 of the merge described in `docs/animation-intelligence/watch/README.md`. A watch
// session writes `docs/animation-intelligence/knowledge/inbox/Wnn-<video>-<slug>.json`; this moves
// the ones that pass BOTH gates up a level into the corpus and leaves the rest in the inbox with
// the reason printed, so a later session fixes the file rather than losing the entry.
//
// Two gates, not one, and they answer different questions:
//
//   validateProposedEntry  — Part 72 steps 5-9: is every Part 25 field answered, is the category
//                            real, is nothing placeholdered. A shape gate.
//   validateEvidenceSource — Part 72's closing line, "do not permanently add unverified claims":
//                            does evidence_status actually name where the claim came from.
//
// A file that fails either is never loaded as-is. Nothing here judges whether an entry is GOOD —
// that is what `evidence_status: experimental` is for, and it stays experimental until a benchmark
// or the user validates it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CORPUS = path.join(ROOT, 'docs/animation-intelligence/knowledge');
const INBOX = path.join(CORPUS, 'inbox');

const KNOW = await import('../renderer/js/ai/knowledge.js');

const dry = process.argv.includes('--dry-run');
// Batches finish at different times, and several watch sessions run at once — on both machines.
// Merging an inbox while a session is still writing into it takes that session's files out from
// under it mid-batch, so a merge names the batch it is merging: --batch W01. The default (every
// file) is correct only when nothing is running.
const batchArg = process.argv.indexOf('--batch');
const batch = batchArg > -1 ? process.argv[batchArg + 1] : null;
const files = (fs.existsSync(INBOX) ? fs.readdirSync(INBOX) : [])
  .filter((n) => n.endsWith('.json'))
  .filter((n) => !batch || n.startsWith(`${batch}-`))
  .sort();

if (!files.length) {
  console.log(batch
    ? `no ${batch}-*.json in the inbox — nothing to merge for that batch`
    : 'the inbox is empty — nothing to merge (a normal result when no watch batch has run since the last merge)');
  process.exit(0);
}

const builtin = new Set(KNOW.KNOWLEDGE_ENTRIES.map((e) => e.concept));
const existing = new Map();
for (const f of fs.readdirSync(CORPUS).filter((n) => n.endsWith('.json'))) {
  try { existing.set(JSON.parse(fs.readFileSync(path.join(CORPUS, f), 'utf8')).concept, f); } catch (_) { /* not an entry */ }
}

const accepted = [], refused = [], collided = [];

for (const f of files) {
  const raw = fs.readFileSync(path.join(INBOX, f), 'utf8');
  let entry;
  try { entry = JSON.parse(raw); } catch (e) { refused.push({ file: f, problems: [`not valid JSON: ${e.message}`] }); continue; }

  const shape = KNOW.validateProposedEntry(entry);
  const ev = KNOW.validateEvidenceSource(entry);
  const problems = [...shape.problems, ...(ev.ok ? [] : [ev.problem])];
  if (problems.length) { refused.push({ file: f, concept: entry.concept, problems }); continue; }

  if (builtin.has(entry.concept)) {
    collided.push({ file: f, concept: entry.concept, why: 'one of the twelve compiled classical principles — the compiled card wins (ai/knowledge.js); a project-specific exception belongs in ai/memory.js project_conventions' });
    continue;
  }
  const clash = existing.get(entry.concept);
  if (clash && clash !== `${entry.concept}.json`) {
    collided.push({ file: f, concept: entry.concept, why: `already in the corpus as ${clash}` });
    continue;
  }

  const dest = path.join(CORPUS, `${entry.concept}.json`);
  const updating = fs.existsSync(dest);
  if (!dry) {
    // Re-serialise in the module's own field order so every file in the corpus has one shape and
    // a later diff shows a changed VALUE rather than a reordered key.
    const ordered = {};
    for (const k of KNOW.knowledgeFieldList()) ordered[k] = entry[k];
    for (const k of Object.keys(entry)) if (!(k in ordered)) ordered[k] = entry[k];
    fs.writeFileSync(dest, `${JSON.stringify(ordered, null, 2)}\n`);
    fs.unlinkSync(path.join(INBOX, f));
  }
  accepted.push({ file: f, concept: entry.concept, category: entry.category, evidence: ev.sources.join(' + '), updating });
  existing.set(entry.concept, `${entry.concept}.json`);
}

console.log(`${dry ? '[dry run] ' : ''}inbox: ${files.length} file(s)`);
console.log(`\naccepted (${accepted.length}):`);
for (const a of accepted) console.log(`  ${a.concept.padEnd(38)} ${a.category.padEnd(12)} evidence: ${a.evidence}${a.updating ? '  [replaces an existing corpus entry]' : ''}`);
if (collided.length) {
  console.log(`\nleft in the inbox — name collision (${collided.length}):`);
  for (const c of collided) console.log(`  ${c.file}: ${c.why}`);
}
if (refused.length) {
  console.log(`\nleft in the inbox — refused by the gate (${refused.length}):`);
  for (const r of refused) console.log(`  ${r.file}:\n    ${r.problems.join('\n    ')}`);
}
console.log(`\n${dry ? 'nothing was moved' : `${accepted.length} moved into docs/animation-intelligence/knowledge/`}`);
if (refused.length || collided.length) {
  console.log('write the reason for every file left behind into LESSONS.md — an entry dropped without a reason is a lesson lost twice.');
}
