#!/usr/bin/env node
/**
 * Capture raw (unfiltered) page screenshots through Scrutinizer's Electron renderer.
 *
 * Unlike capture-raw-pages.js (Playwright/Chromium), this captures through the same
 * Electron browser that Scrutinizer uses, with effects DISABLED. This ensures pixel-
 * identical rendering for Brown metamer comparison — no browser mismatch artifacts.
 *
 * Output: tests/golden-captures/raw-electron/
 *   - {page}_center_raw.png (same dimensions as golden captures: 3840x2024 at 2x)
 *   - manifest.json (for Brown metamer pipeline)
 *
 * Usage:
 *   node scripts/capture-raw-electron.js
 */

const path = require('path');
const fs = require('fs');
const { run } = require('./lib/capture-runner');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'tests', 'golden-captures', 'raw-electron');
const fullVersion = require('../package.json').version;

// Same pages as capture-raw-pages.js and Brown metamer pipeline
const BASE_URL = 'https://andyed.github.io/scrutinizer-www/reference-pages';

const PAGES = ['dashboard', 'article', 'ecommerce', 'techmeme', 'crowding', 'color-spectrum'];

// Each page gets a 'disabled' mode capture — Scrutinizer effects off, raw Electron rendering
const SPECS = PAGES.map(page => ({
    filename: `${page}_center_raw.png`,
    url: `${BASE_URL}/${page}.html`,
    mode: 'disabled',
    fixationX: 0.5,
    fixationY: 0.5,
    selector: '',
    overlay: false,
    radius: '45',
    width: '1920',
    height: '1080',
    mobile: 'false',
}));

async function main() {
    console.log(`\n📷 Raw Electron Capture (effects disabled)`);
    console.log(`   Pages: ${PAGES.length}`);
    console.log(`   Output: ${OUTPUT_DIR}\n`);

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const result = await run(SPECS, {
        outputDir: OUTPUT_DIR,
        appVersion: fullVersion,
        force: true,
    });

    console.log(`\n📷 Raw capture complete.`);
    console.log(`   Captured: ${result.captured}, Failed: ${result.failed}`);

    // Generate manifest for Brown metamer pipeline
    const manifest = PAGES.map(page => ({
        page,
        fixation: 'center',
        gaze: [0.5, 0.5],
        file: `${page}_center_raw.png`,
    }));

    // Read first capture to get dimensions
    const firstFile = path.join(OUTPUT_DIR, `${PAGES[0]}_center_raw.png`);
    if (fs.existsSync(firstFile)) {
        const { PNG } = require('pngjs');
        const img = PNG.sync.read(fs.readFileSync(firstFile));
        manifest.forEach(m => { m.width = img.width; m.height = img.height; });
    }

    fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`   Manifest: ${path.join(OUTPUT_DIR, 'manifest.json')}`);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
