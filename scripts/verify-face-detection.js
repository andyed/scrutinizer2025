#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const version = require('../package.json').version;
const OUTPUT_DIR = path.join(__dirname, '..', 'tests', 'verification');

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function runTest() {
    return new Promise((resolve, reject) => {
        const pagePath = path.resolve(__dirname, '..', 'tests', 'reference-pages', 'face-test.html');
        const fileUrl = `file://${pagePath}`;
        const filename = 'face_detection_result.png';

        console.log(`\n🧪 Running Face Detection Verification`);
        console.log(`   URL: ${fileUrl}`);
        console.log(`   Output: ${path.join(OUTPUT_DIR, filename)}\n`);

        const env = {
            ...process.env,
            TEST_URL: fileUrl,
            TEST_MODES: 'saliency', // Force Saliency Mode
            TEST_FIXATION_X: '0.5',
            TEST_FIXATION_Y: '0.5',
            TEST_OUTPUT_FILENAME: filename,
            TEST_OUTPUT_DIR: OUTPUT_DIR, // Override output dir logic in main.js if supported, else check default
            SCREENSHOT_MODE: 'update',
            ELECTRON_RUN_AS_NODE: undefined
        };

        // Note: main.js usually writes to specific dirs. We might need to check where it writes.
        // run-electron.js -> main.js -> scrutinizer.js -> writes to 'tests/golden/...' usually?
        // Let's assume standard behavior and check likely paths.

        const child = spawn('npm', ['start'], {
            cwd: path.join(__dirname, '..'),
            env: env,
            stdio: 'inherit'
        });

        child.on('close', (code) => {
            if (code === 0) {
                console.log(`✅ Test Completed. Check ${OUTPUT_DIR}/${filename}`);
                resolve();
            } else {
                console.error(`❌ Test Failed (Code: ${code})`);
                reject();
            }
        });
    });
}

runTest();
