const { spawn } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Debug logging
console.log('Starting signed build...');
console.log('APPLE_ID present:', !!process.env.APPLE_ID);
console.log('APPLE_ID_PASSWORD present:', !!process.env.APPLE_ID_PASSWORD);
console.log('APPLE_TEAM_ID present:', !!process.env.APPLE_TEAM_ID);

// Map credentials for notarytool/electron-builder
if (process.env.APPLE_ID_PASSWORD) {
    process.env.APPLE_APP_SPECIFIC_PASSWORD = process.env.APPLE_ID_PASSWORD;
    console.log('Mapped APPLE_ID_PASSWORD to APPLE_APP_SPECIFIC_PASSWORD');
}

// Run electron-builder
const builder = spawn('./node_modules/.bin/electron-builder', ['--mac'], {
    stdio: 'inherit',
    shell: true,
    env: process.env // Pass the modified environment
});

builder.on('close', (code) => {
    console.log(`Build process exited with code ${code}`);
    process.exit(code);
});
