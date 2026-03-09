#!/usr/bin/env node
/**
 * Capture oriented DoG Phase 1 interim results.
 * Stores to tests/golden-captures/oriented-dog-phase1/
 *
 * Captures: dashboard + article, each with isotropic (off) and oriented (on).
 * Uses mode 0 (highkey) which now has dog_oriented=true by default.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = path.join(__dirname, '..', 'tests', 'golden-captures', 'oriented-dog-phase1');
const BASE_URL = process.env.BASE_URL || 'https://andyed.github.io/scrutinizer-www/reference-pages';
const CAPTURE_FOVEA_RADIUS = '90';
const CAPTURE_WIDTH = '1920';
const CAPTURE_HEIGHT = '1080';

const CAPTURES = [
    // Oriented ON (default mode 0 now has dog_oriented=true)
    { page: 'dashboard', id: 'dashboard_oriented', mode: '0' },
    { page: 'article',   id: 'article_oriented',   mode: '0' },
    { page: 'techmeme',  id: 'techmeme_oriented',  mode: '0' },
    // Comparison: mode 7 (legacy v1.6, no oriented DoG)
    { page: 'dashboard', id: 'dashboard_legacy',   mode: '7' },
    { page: 'article',   id: 'article_legacy',     mode: '7' },
    { page: 'techmeme',  id: 'techmeme_legacy',    mode: '7' },
];

console.log(`\nOriented DoG Phase 1 — Interim Golden Captures`);
console.log(`  Output: ${OUTPUT_DIR}\n`);

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function runCapture(capture) {
    return new Promise((resolve, reject) => {
        const pageUrl = `${BASE_URL}/${capture.page}.html`;
        const filename = `${capture.id}.png`;

        console.log(`  Capturing: ${filename}`);

        const env = {
            ...process.env,
            TEST_MODE: 'true',
            TEST_URL: pageUrl,
            TEST_MODES: capture.mode,
            TEST_RADIUS: CAPTURE_FOVEA_RADIUS,
            TEST_WIDTH: CAPTURE_WIDTH,
            TEST_HEIGHT: CAPTURE_HEIGHT,
            TEST_FIXATION_X: '0.5',
            TEST_FIXATION_Y: '0.5',
            TEST_OUTPUT_FILENAME: filename,
            SCREENSHOT_MODE: 'update',
            ELECTRON_RUN_AS_NODE: undefined
        };

        const child = spawn('npm', ['start'], {
            cwd: path.join(__dirname, '..'),
            env: env,
            stdio: 'inherit'
        });

        child.on('close', (code) => {
            if (code === 0) {
                // Move from default golden dir to our custom dir
                const packageVersion = require('../package.json').version.replace(/\.\d+$/, '');
                const defaultDir = path.join(__dirname, '..', 'tests', 'golden-captures', `v${packageVersion}`);
                const src = path.join(defaultDir, filename);
                const dst = path.join(OUTPUT_DIR, filename);
                if (fs.existsSync(src)) {
                    fs.renameSync(src, dst);
                    console.log(`  -> ${dst}\n`);
                }
                resolve();
            } else {
                console.error(`  FAILED: ${filename} (exit ${code})\n`);
                reject(new Error(`Exit code ${code}`));
            }
        });
    });
}

async function main() {
    for (const capture of CAPTURES) {
        try {
            await runCapture(capture);
        } catch (e) {
            console.error(e.message);
        }
    }
    console.log(`\nDone. Captures in: ${OUTPUT_DIR}`);
}

main();
