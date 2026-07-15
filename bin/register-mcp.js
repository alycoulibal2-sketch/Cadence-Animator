#!/usr/bin/env node
'use strict';
// Runs as npm's postinstall: tries to register the MCP server with Claude Code automatically
// so the user never has to hand-edit an MCP config file. Best-effort only — never fails the
// install if the `claude` CLI isn't on PATH, and never throws (postinstall failures are noisy).
const path = require('path');
const { execFileSync } = require('child_process');

const serverPath = path.join(__dirname, '..', 'mcp-server', 'index.js');

function claudeAvailable() {
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function main() {
  if (!claudeAvailable()) {
    console.log('\n[cadence-animator] Claude Code CLI not found on PATH — skipping automatic MCP registration.');
    console.log('[cadence-animator] To wire it up yourself, run:');
    console.log(`  claude mcp add cadence-animator -- node "${serverPath}"\n`);
    return;
  }
  try {
    execFileSync('claude', ['mcp', 'add', 'cadence-animator', '--', 'node', serverPath], { stdio: 'inherit' });
    console.log('\n[cadence-animator] Registered the MCP server with Claude Code — launch Cadence Animator, then ask Claude to use it.\n');
  } catch (e) {
    console.log('\n[cadence-animator] Automatic MCP registration failed — you can add it manually:');
    console.log(`  claude mcp add cadence-animator -- node "${serverPath}"\n`);
  }
}

main();
