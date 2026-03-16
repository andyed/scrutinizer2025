#!/usr/bin/env node
/**
 * Isotropic Comparison Capture
 *
 * Captures the same pages under polar quantize (mode 8) and FOVI isotropic (mode 12)
 * for side-by-side comparison showing the v2.5 grid upgrade.
 *
 * Usage:
 *   node scripts/capture-isotropic-comparison.js
 *   node scripts/capture-isotropic-comparison.js --force
 */

const path = require('path');
const fs = require('fs');
const { run } = require('./lib/capture-runner');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'docs', 'golden', 'isotropic-comparison');
const fullVersion = require('../package.json').version;
const force = process.argv.includes('--force');

// Local reference pages — no network dependency
const LOCAL = `file://${path.join(ROOT, 'tests', 'reference-pages')}`;
const WWW = 'https://andyed.github.io/scrutinizer-www/reference-pages';

// Pages that best show the polar→isotropic difference:
// - grid: geometric regularity makes distortion obvious
// - crowding: flanker legibility sensitive to tangential sampling
// - dashboard: real UI at multiple eccentricities
// - article: text-heavy, reading-relevant
const PAGES = [
    { name: 'grid', url: `${LOCAL}/grid.html` },
    { name: 'crowding', url: `${WWW}/crowding.html` },
    { name: 'dashboard', url: `${LOCAL}/dashboard.html` },
    { name: 'article', url: `${LOCAL}/article.html` },
];

// Also add mode 0 (default smoothstep) as baseline
const MODES = [
    { id: 'mode0_smoothstep', mode: '0', label: 'Default (Smoothstep)' },
    { id: 'mode8_polar', mode: '8', label: 'Polar Quantize (v2.4)' },
    { id: 'mode12_isotropic', mode: '12', label: 'FOVI Isotropic (v2.5)' },
];

const FIXATIONS = [
    { id: 'center', x: 0.5, y: 0.5 },
    { id: 'topleft', x: 0.25, y: 0.25 },
];

function buildSpecs() {
    const specs = [];
    for (const page of PAGES) {
        for (const mode of MODES) {
            for (const fix of FIXATIONS) {
                specs.push({
                    filename: `${page.name}_${fix.id}_${mode.id}.png`,
                    url: page.url,
                    mode: mode.mode,
                    fixationX: fix.x,
                    fixationY: fix.y,
                    selector: '',
                    overlay: false,
                    radius: '45',
                    width: '1920',
                    height: '1080',
                    mobile: 'false',
                });
            }
        }
    }
    return specs;
}

async function main() {
    const specs = buildSpecs();

    console.log(`\n📐 Isotropic Comparison Capture`);
    console.log(`   Pages: ${PAGES.map(p => p.name).join(', ')}`);
    console.log(`   Modes: ${MODES.map(m => m.id).join(', ')}`);
    console.log(`   Fixations: ${FIXATIONS.map(f => f.id).join(', ')}`);
    console.log(`   Total shots: ${specs.length}`);
    console.log(`   Output: ${OUTPUT_DIR}`);
    if (force) console.log(`   Mode: --force (recapture all)`);
    console.log('');

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const result = await run(specs, {
        outputDir: OUTPUT_DIR,
        appVersion: fullVersion,
        force
    });

    console.log(`\n📐 Comparison captures complete.`);
    console.log(`   Captured: ${result.captured}, Skipped: ${result.skipped}, Failed: ${result.failed}`);

    if (result.failed > 0) {
        process.exit(1);
    }
}

main();
