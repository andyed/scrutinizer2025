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
    // Oriented OFF (isotropic DoG — same mode 0 pipeline, orientation disabled)
    { page: 'dashboard',   id: 'dashboard_isotropic',   mode: '0', dogOriented: 'false' },
    { page: 'article',     id: 'article_isotropic',     mode: '0', dogOriented: 'false' },
    { page: 'techmeme',    id: 'techmeme_isotropic',    mode: '0', dogOriented: 'false' },
    { page: 'dense-table',    id: 'dense-table_isotropic',    mode: '0', dogOriented: 'false', fixX: '0.15', fixY: '0.12' },
    { page: 'checkout-form', id: 'checkout-form_isotropic', mode: '0', dogOriented: 'false', fixX: '0.35', fixY: '0.25' },
    // Oriented ON with biological bias (2.0) — subtle effect, visible in careful comparison
    { page: 'dashboard',     id: 'dashboard_oriented',     mode: '0', dogOriented: 'true', orientBias: '2.0' },
    { page: 'article',       id: 'article_oriented',       mode: '0', dogOriented: 'true', orientBias: '2.0' },
    { page: 'techmeme',      id: 'techmeme_oriented',      mode: '0', dogOriented: 'true', orientBias: '2.0' },
    { page: 'dense-table',   id: 'dense-table_oriented',   mode: '0', dogOriented: 'true', orientBias: '2.0', fixX: '0.15', fixY: '0.12' },
    { page: 'checkout-form', id: 'checkout-form_oriented',  mode: '0', dogOriented: 'true', orientBias: '2.0', fixX: '0.35', fixY: '0.25' },
    // Exaggerated (bias=4, eccFade bypassed) — for blog demo captures
    { page: 'orientation-grid', id: 'grid_isotropic',  mode: '0', dogOriented: 'false' },
    { page: 'orientation-grid', id: 'grid_oriented_4x', mode: '0', dogOriented: 'true', orientBias: '4.0' },
    { page: 'spiderweb',       id: 'web_isotropic',    mode: '0', dogOriented: 'false' },
    { page: 'spiderweb',       id: 'web_oriented_4x',  mode: '0', dogOriented: 'true', orientBias: '4.0' },
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
            TEST_FIXATION_X: capture.fixX || '0.5',
            TEST_FIXATION_Y: capture.fixY || '0.5',
            TEST_DOG_ORIENTED: capture.dogOriented,
            TEST_DOG_ORIENT_BIAS: capture.orientBias || undefined,
            TEST_OVERLAY: capture.overlay || process.env.TEST_OVERLAY || undefined,
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
