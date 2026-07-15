#!/usr/bin/env node
'use strict';
// npm launcher shim: `require('electron')` from plain Node (not from inside Electron itself)
// resolves to the path of the platform's electron binary — that's what makes `npx cadence-animator`
// or a global `npm install -g` work without the user needing Electron installed separately.
const path = require('path');
const { spawn } = require('child_process');

const electronPath = require('electron');
const appRoot = path.join(__dirname, '..');

const child = spawn(electronPath, [appRoot, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('close', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('Failed to launch Cadence Animator:', err.message);
  process.exit(1);
});
