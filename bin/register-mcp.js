#!/usr/bin/env node
'use strict';
// Runs as npm's postinstall: tries to register the MCP server with Claude Code automatically
// so the user never has to hand-edit an MCP config file. Best-effort only — never fails the
// install if the `claude` CLI isn't on PATH, and never throws (postinstall failures are noisy).
const path = require('path');
const { execFileSync } = require('child_process');

const serverPath = path.join(__dirname, '..', 'mcp-server', 'index.js');

// Runs `claude` reliably. execFileSync('claude', ...) alone fails here even when `claude` works
// fine in any terminal: a global npm install puts a `claude.cmd` shim on Windows (not a real
// .exe), execFileSync's raw CreateProcess call never consults PATHEXT the way a shell does, and
// .cmd/.bat files can't be launched directly by CreateProcess at all regardless — they need
// cmd.exe to interpret them. Routing through `cmd.exe /c` fixes both: it does real PATHEXT
// resolution, and Node's own argv-array escaping (not shell:true, which naively concatenates)
// keeps arguments containing spaces intact — this app's own install path commonly has one.
function runClaudeCli(args, opts) {
  if (process.platform === 'win32') {
    return execFileSync('cmd.exe', ['/c', 'claude', ...args], opts);
  }
  return execFileSync('claude', args, opts);
}

function claudeAvailable() {
  try {
    runClaudeCli(['--version'], { stdio: 'ignore' });
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
    runClaudeCli(['mcp', 'add', 'cadence-animator', '--', 'node', serverPath], { stdio: 'inherit' });
    console.log('\n[cadence-animator] Registered the MCP server with Claude Code — launch Cadence Animator, then ask Claude to use it.\n');
  } catch (e) {
    console.log('\n[cadence-animator] Automatic MCP registration failed — you can add it manually:');
    console.log(`  claude mcp add cadence-animator -- node "${serverPath}"\n`);
  }
}

main();
