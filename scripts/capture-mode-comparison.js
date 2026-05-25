#!/usr/bin/env node
/**
 * Mode Comparison Capture
 *
 * Captures the same page under multiple modes for side-by-side comparison
 * in the blog post. Uses batch mode + manifest caching.
 *
 * Usage:
 *   node scripts/capture-mode-comparison.js
 *   node scripts/capture-mode-comparison.js --page=dashboard
 *   node scripts/capture-mode-comparison.js --force
 */

const path = require('path');
const fs = require('fs');
const { run } = require('./lib/capture-runner');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'docs', 'golden', 'mode-comparison');
const fullVersion = require('../package.json').version;
const force = process.argv.includes('--force');

const pageArg = process.argv.find(a => a.startsWith('--page='));
const pages = pageArg ? [pageArg.split('=')[1]] : ['dashboard', 'article'];

const MODES = [
    { id: 'mode0_smoothstep', mode: '0', label: 'Mode 0 — Smoothstep (High-Key)' },
    { id: 'mode6_logpolar',   mode: '6', label: 'Mode 6 — Log-Polar MIP (Blauch 2026)' },
    { id: 'mode7_legacy',     mode: '7', label: 'Mode 7 — Legacy v1.6' },
    { id: 'mode9_congestion', mode: '9', label: 'Mode 9 — Congestion-Gated Pooling' },
    { id: 'mode10_texture_synth', mode: '10', label: 'Mode 10 — Texture Synthesis (WebGPU)' },
    { id: 'mode12_fovi_isotropic', mode: '12', label: 'Mode 12 — FOVI Cortical Grid (Blauch 2026)' },
];

const BASE_URL = process.env.BASE_URL || 'https://andyed.github.io/scrutinizer-www/reference-pages';

function buildSpecs() {
    const specs = [];
    for (const page of pages) {
        for (const modeConfig of MODES) {
            specs.push({
                // _overlay suffix declares the intentional debug overlay
                // (eccentricity-ring visualization for blog comparison images).
                // See CODEBASE_MAP.md gotcha #15 and the hygiene test at
                // tests/unit/capture-debug-overlay-hygiene.test.js.
                filename: `${page}_center_${modeConfig.id}_overlay.png`,
                url: `${BASE_URL}/${page}.html`,
                mode: modeConfig.mode,
                fixationX: 0.5,
                fixationY: 0.5,
                selector: '',
                overlay: true,
                radius: '45',
                width: '1920',
                height: '1080',
                mobile: 'false',
            });
        }
    }
    return specs;
}

async function main() {
    console.log(`\n🎯 Mode Comparison Capture (Batch)`);
    console.log(`   Pages: ${pages.join(', ')}`);
    console.log(`   Modes: ${MODES.map(m => m.id).join(', ')}`);
    console.log(`   Output: ${OUTPUT_DIR}`);
    if (force) console.log(`   Mode: --force (recapture all)`);
    console.log('');

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Golden captures go to tests/golden-captures/v{version}/
    // We also need to copy to the mode-comparison output dir
    const packageVersion = fullVersion.replace(/\.\d+$/, '');
    const goldenDir = path.join(ROOT, 'tests', 'golden-captures', `v${packageVersion}`);

    const specs = buildSpecs();
    console.log(`   Total shots: ${specs.length}\n`);

    const result = await run(specs, {
        outputDir: goldenDir,
        appVersion: fullVersion,
        force
    });

    // Copy captured files to mode-comparison dir
    let copied = 0;
    for (const spec of specs) {
        const src = path.join(goldenDir, spec.filename);
        const dest = path.join(OUTPUT_DIR, spec.filename);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
            copied++;
        }
    }

    console.log(`\n🎉 Comparison captures complete.`);
    console.log(`   Captured: ${result.captured}, Skipped: ${result.skipped}, Failed: ${result.failed}`);
    console.log(`   Copied ${copied} files to: ${OUTPUT_DIR}`);
    console.log(`\n   Copy to www for blog post:`);
    console.log(`   cp ${OUTPUT_DIR}/*.png ../scrutinizer-www/src/blog/images/`);
}

main();
