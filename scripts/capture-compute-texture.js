#!/usr/bin/env node
/**
 * Compute Texture Isolation Capture
 *
 * Captures raw compute textures from Tier 2.5 (mode 10) and Tier 2.75 (mode 14)
 * on the same source page. Used to verify whether cross-scale magnitude correlations
 * produce visibly better synthesis output.
 *
 * Output: tests/compute-captures/
 *   - mode10_compute.raw  (Tier 2.5 oriented noise)
 *   - mode14_compute.raw  (Tier 2.75 pyramid synthesis)
 *   - mode10_composite.png (full pipeline screenshot for reference)
 *   - mode14_composite.png (full pipeline screenshot for reference)
 *
 * Each .raw file has an 8-byte header (u32le width, u32le height) followed by
 * width*height*4 bytes of RGBA8 data. Alpha encodes blend weight (0=fovea, 255=periphery).
 *
 * Usage:
 *   node scripts/capture-compute-texture.js
 *   node scripts/capture-compute-texture.js --page article
 */

const path = require('path');
const fs = require('fs');
const { run } = require('./lib/capture-runner');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'tests', 'compute-captures');
const fullVersion = require('../package.json').version;

const page = process.argv.includes('--page')
    ? process.argv[process.argv.indexOf('--page') + 1]
    : 'dashboard';

const REF_PAGES = `file://${path.join(ROOT, 'tests', 'reference-pages')}`;
const url = `${REF_PAGES}/${page}.html`;

// Use different URLs to force separate Electron instances per mode.
// This avoids compute pipeline mode-switch race conditions.
const SPECS = [
    // Mode 10: Tier 2.5 — oriented noise, no cross-scale correlations
    // Append ?mode=10 to force a separate batch from mode 14.
    {
        filename: `mode10_composite.png`,
        url: `${url}?mode=10`,
        mode: '10',
        fixationX: 0.5, fixationY: 0.5,
        selector: '', overlay: false,
        radius: '45', width: '1920', height: '1080', mobile: 'false',
        captureCompute: true,
    },
    // Mode 14: Tier 2.75 — pyramid synthesis with cross-scale correlations
    {
        filename: `mode14_composite.png`,
        url: `${url}?mode=14`,
        mode: '14',
        fixationX: 0.5, fixationY: 0.5,
        selector: '', overlay: false,
        radius: '45', width: '1920', height: '1080', mobile: 'false',
        captureCompute: true,
    },
];

async function main() {
    console.log(`\n🔬 Compute Texture Isolation Capture`);
    console.log(`   Page: ${page}.html`);
    console.log(`   Modes: 10 (Tier 2.5) vs 14 (Tier 2.75)`);
    console.log(`   Output: ${OUTPUT_DIR}\n`);

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const result = await run(SPECS, {
        outputDir: OUTPUT_DIR,
        appVersion: fullVersion,
        force: true,
    });

    console.log(`\n🔬 Capture complete.`);
    console.log(`   Captured: ${result.captured}, Failed: ${result.failed}`);

    // Check for .raw files
    const rawFiles = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.raw'));
    if (rawFiles.length >= 2) {
        console.log(`   Compute textures: ${rawFiles.join(', ')}`);
        console.log(`\n   Next: node scripts/compare-compute-textures.js`);
    } else {
        console.warn(`\n   ⚠ Expected 2 .raw files but found ${rawFiles.length}`);
        console.warn(`   Check that WebGPU compute is available and modes 10/14 dispatched.`);
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
