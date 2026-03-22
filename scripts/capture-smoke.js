#!/usr/bin/env node
/**
 * Smoke Test Capture
 *
 * Quick pipeline sanity check — 6 shots across 3 Electron batches.
 * Uses local file:// reference pages (no network dependency).
 * Output in tests/smoke-captures/ (gitignored).
 *
 * Usage:
 *   npm run capture-smoke               # Incremental — skips unchanged shots (<1s)
 *   npm run capture-smoke -- --force     # Full recapture (~45s)
 */

const path = require('path');
const fs = require('fs');
const { run } = require('./lib/capture-runner');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'tests', 'smoke-captures');
const fullVersion = require('../package.json').version;
const force = process.argv.includes('--force');

const REF_PAGES = `file://${path.join(ROOT, 'tests', 'reference-pages')}`;

const SMOKE_SPECS = [
    // Batch 1: dashboard — basic render, mode switch, saliency, isotropic
    {
        filename: 'smoke_dashboard_mode0.png',
        url: `${REF_PAGES}/dashboard.html`,
        mode: '0',
        fixationX: 0.5, fixationY: 0.5,
        selector: '', overlay: false,
        radius: '45', width: '1920', height: '1080', mobile: 'false',
    },
    {
        filename: 'smoke_dashboard_mode6.png',
        url: `${REF_PAGES}/dashboard.html`,
        mode: '6',
        fixationX: 0.5, fixationY: 0.5,
        selector: '', overlay: false,
        radius: '45', width: '1920', height: '1080', mobile: 'false',
    },
    {
        filename: 'smoke_dashboard_saliency.png',
        url: `${REF_PAGES}/dashboard.html`,
        mode: 'saliency',
        fixationX: 0.5, fixationY: 0.5,
        selector: '', overlay: false,
        radius: '45', width: '1920', height: '1080', mobile: 'false',
    },
    {
        filename: 'smoke_dashboard_mode14.png',
        url: `${REF_PAGES}/dashboard.html`,
        mode: '14',
        fixationX: 0.5, fixationY: 0.5,
        selector: '', overlay: false,
        radius: '45', width: '1920', height: '1080', mobile: 'false',
    },
    {
        filename: 'smoke_dashboard_mode12.png',
        url: `${REF_PAGES}/dashboard.html`,
        mode: '12',
        fixationX: 0.5, fixationY: 0.5,
        selector: '', overlay: false,
        radius: '45', width: '1920', height: '1080', mobile: 'false',
    },

    // Batch 2: article — scroll position
    {
        filename: 'smoke_article_scrolled.png',
        url: `${REF_PAGES}/article.html`,
        mode: '0',
        fixationX: 0.5, fixationY: 0.5,
        selector: '', overlay: false,
        radius: '45', width: '1920', height: '1080', mobile: 'false',
        scrollY: 600,
    },

    // Batch 3: article — off-center fixation
    {
        filename: 'smoke_article_topleft.png',
        url: `${REF_PAGES}/article.html`,
        mode: '0',
        fixationX: 0.2, fixationY: 0.2,
        selector: '', overlay: false,
        radius: '45', width: '1920', height: '1080', mobile: 'false',
    },

    // Batch 4: artifact detection — color shift on achromatic surface
    {
        filename: 'smoke_gray_chromatic.png',
        url: `${REF_PAGES}/chroma-uniform.html?color=gray`,
        mode: '0',
        fixationX: 0.5, fixationY: 0.5,
        selector: '', overlay: false,
        chromaticPooling: 'true',
        radius: '45', width: '1920', height: '1080', mobile: 'false',
    },
];

async function main() {
    console.log(`\n🔥 Smoke Test Capture`);
    console.log(`   Shots: ${SMOKE_SPECS.length}`);
    console.log(`   Output: ${OUTPUT_DIR}`);
    if (force) console.log(`   Mode: --force (recapture all)`);
    console.log('');

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const result = await run(SMOKE_SPECS, {
        outputDir: OUTPUT_DIR,
        appVersion: fullVersion,
        force
    });

    console.log(`\n🔥 Smoke test complete.`);
    console.log(`   Captured: ${result.captured}, Skipped: ${result.skipped}, Failed: ${result.failed}`);

    if (result.failed > 0) {
        console.error('\n❌ Smoke test FAILED — pipeline is broken.');
        process.exit(1);
    }

    // ── Artifact detection pass ──
    let artifactsFailed = 0;
    try {
        const { analyzeArtifacts } = require('./analyze-artifacts');
        const artifactResult = analyzeArtifacts(OUTPUT_DIR);
        if (artifactResult.failures > 0) {
            console.error(`\n⚠️  Artifact detection: ${artifactResult.failures} check(s) failed`);
            for (const f of artifactResult.details.filter(d => !d.pass)) {
                console.error(`   ✗ ${f.name}: ${f.reason}`);
            }
            artifactsFailed = artifactResult.failures;
        } else {
            console.log(`\n🔬 Artifact checks: ${artifactResult.details.length} passed`);
        }
    } catch (e) {
        // analyze-artifacts.js not yet implemented — skip gracefully
        if (e.code !== 'MODULE_NOT_FOUND') {
            console.warn(`\n⚠️  Artifact analysis error: ${e.message}`);
        }
    }

    if (artifactsFailed > 0) {
        console.error('\n❌ Smoke test FAILED — artifacts detected.');
        process.exit(1);
    }

    console.log('\n✅ Pipeline intact.');
}

main();
