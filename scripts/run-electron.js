const { spawn } = require('child_process');
const electron = require('electron');
const path = require('path');

// Sanitize Environment: Ensure we don't inherit the "run as node" flag
// which causes Electron to fail to launch the app.
delete process.env.ELECTRON_RUN_AS_NODE;

// Get args (exclude node and script path)
const args = process.argv.slice(2);

// Add '.' if no args provided (default to current dir)
// This ensures 'node scripts/run-electron.js' behaves like 'electron .'
if (args.length === 0) {
    args.push('.');
}

console.log(`[Run-Electron] Launching Electron with args: ${args.join(' ')}`);

// Spawn Electron
const child = spawn(electron, args, {
    stdio: 'inherit',
    env: process.env
});

child.on('close', (code) => {
    process.exit(code);
});
