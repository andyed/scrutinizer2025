const { spawn } = require('child_process');
const path = require('path');

// Preflight: fail with an actionable message instead of a raw MODULE_NOT_FOUND
// when the root deps (incl. the electron binary) aren't installed. Every
// capture/test path that spawns the app funnels through here.
let electron;
try {
    electron = require('electron');
} catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND') {
        console.error('[Run-Electron] electron is not installed.');
        console.error('[Run-Electron] Run `npm install` at the scrutinizer2025 repo root, then retry.');
        process.exit(1);
    }
    throw e;
}

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
