#!/usr/bin/env node
/**
 * Wave 7b: Pyramid Statistics Accuracy
 *
 * Validates per-tile statistics from the WGSL pyramid-stats shader against
 * Python reference (pyrtools decompose → numpy per-tile stats).
 *
 * Checks:
 *   Tier 1: Mean magnitude per band per tile within 5% of reference
 *   Tier 2: Cross-scale correlation sign matches reference
 *   Tier 2: Correlation magnitude within 0.15 of reference
 *   Tier 3: Skewness within 0.2 of reference
 *
 * Prerequisites:
 *   node scripts/capture-pyramid-subbands.js   # WGSL captures with stats readback
 *   python scripts/generate-pyramid-reference.py --stats  # pyrtools reference stats
 *
 * Usage:
 *   node scripts/analyze-pyramid-stats.js
 *
 * Exit codes:
 *   0 = Tier 1 checks pass
 *   1 = Tier 1 validation failed
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WGSL_STATS_DIR = path.join(ROOT, 'tests', 'pyramid-captures', 'stats');
const PYRTOOLS_STATS_DIR = path.join(ROOT, 'tests', 'pyrtools-reference', 'stats');
const RESULTS_FILE = path.join(ROOT, 'tests', 'validation', 'wave7b-pyramid-stats.json');

const SOURCES = ['dashboard', 'article', 'ecommerce'];
const NUM_BANDS = 4;
const NUM_CROSS_SCALE = 3; // correlations between adjacent band pairs

// ── Validation criteria from spec ──

const THRESHOLDS = {
    magnitudeRelError: 0.05,   // Tier 1: within 5%
    correlationSign: true,     // Tier 2: sign matches
    correlationAbsDiff: 0.15,  // Tier 2: magnitude within 0.15
    skewnessAbsDiff: 0.2,      // Tier 3: within 0.2
};

// ── Data loading ──

function loadStatsJson(filepath) {
    if (!fs.existsSync(filepath)) return null;
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

// ── Main ──

function main() {
    const checks = [];
    let tier1Pass = 0, tier1Fail = 0;
    let tier2Pass = 0, tier2Fail = 0;
    let tier3Pass = 0, tier3Fail = 0;

    function check(name, tier, pass, detail) {
        checks.push({ name, tier, pass, detail });
        const tag = pass ? 'PASS' : 'FAIL';
        if (tier === 1) pass ? tier1Pass++ : tier1Fail++;
        else if (tier === 2) pass ? tier2Pass++ : tier2Fail++;
        else pass ? tier3Pass++ : tier3Fail++;
        console.log(`  [${tag}] T${tier} ${name}: ${detail}`);
    }

    for (const source of SOURCES) {
        console.log(`\n── ${source} ──`);

        const wgslStats = loadStatsJson(path.join(WGSL_STATS_DIR, `${source}_tile_stats.json`));
        const pyStats = loadStatsJson(path.join(PYRTOOLS_STATS_DIR, `${source}_tile_stats.json`));

        if (!wgslStats || !pyStats) {
            console.log(`  [SKIP] Missing stats for ${source}`);
            console.log(`    WGSL: ${wgslStats ? 'found' : 'MISSING'} (${path.join(WGSL_STATS_DIR, source + '_tile_stats.json')})`);
            console.log(`    Pyrtools: ${pyStats ? 'found' : 'MISSING'} (${path.join(PYRTOOLS_STATS_DIR, source + '_tile_stats.json')})`);
            continue;
        }

        const numTiles = Math.min(wgslStats.tiles.length, pyStats.tiles.length);

        // ── Tier 1: Mean magnitude per band ──
        let magPassCount = 0, magTotalCount = 0;
        for (let t = 0; t < numTiles; t++) {
            for (let b = 0; b < NUM_BANDS; b++) {
                const wMag = wgslStats.tiles[t].bandMagnitude[b];
                const pMag = pyStats.tiles[t].bandMagnitude[b];

                if (!isFinite(wMag) || !isFinite(pMag)) continue;
                magTotalCount++;

                const denom = Math.max(Math.abs(pMag), 1e-6);
                const relErr = Math.abs(wMag - pMag) / denom;
                if (relErr <= THRESHOLDS.magnitudeRelError) magPassCount++;
            }
        }
        const magRate = magTotalCount > 0 ? magPassCount / magTotalCount : 0;
        check(`${source}_magnitude_accuracy`, 1,
            magRate >= 0.90, // 90% of tiles must pass
            `${magPassCount}/${magTotalCount} tiles within 5% (${(magRate * 100).toFixed(1)}%)`);

        // ── Tier 2: Cross-scale correlation sign ──
        let signPassCount = 0, signTotalCount = 0;
        let corrPassCount = 0, corrTotalCount = 0;

        for (let t = 0; t < numTiles; t++) {
            for (let c = 0; c < NUM_CROSS_SCALE; c++) {
                const wCorr = wgslStats.tiles[t].crossScaleCorrelation[c];
                const pCorr = pyStats.tiles[t].crossScaleCorrelation[c];

                if (!isFinite(wCorr) || !isFinite(pCorr)) continue;

                // Sign check
                signTotalCount++;
                if (Math.sign(wCorr) === Math.sign(pCorr) || Math.abs(pCorr) < 0.05) {
                    signPassCount++;
                }

                // Magnitude check
                corrTotalCount++;
                if (Math.abs(wCorr - pCorr) <= THRESHOLDS.correlationAbsDiff) {
                    corrPassCount++;
                }
            }
        }

        const signRate = signTotalCount > 0 ? signPassCount / signTotalCount : 0;
        check(`${source}_correlation_sign`, 2,
            signRate >= 0.85,
            `${signPassCount}/${signTotalCount} tiles sign-match (${(signRate * 100).toFixed(1)}%)`);

        const corrRate = corrTotalCount > 0 ? corrPassCount / corrTotalCount : 0;
        check(`${source}_correlation_magnitude`, 2,
            corrRate >= 0.80,
            `${corrPassCount}/${corrTotalCount} tiles within 0.15 (${(corrRate * 100).toFixed(1)}%)`);

        // ── Tier 3: Skewness ──
        let skewPassCount = 0, skewTotalCount = 0;
        for (let t = 0; t < numTiles; t++) {
            for (let b = 0; b < NUM_BANDS; b++) {
                const wSkew = wgslStats.tiles[t].skewness ? wgslStats.tiles[t].skewness[b] : undefined;
                const pSkew = pyStats.tiles[t].skewness ? pyStats.tiles[t].skewness[b] : undefined;

                if (!isFinite(wSkew) || !isFinite(pSkew)) continue;
                skewTotalCount++;
                if (Math.abs(wSkew - pSkew) <= THRESHOLDS.skewnessAbsDiff) {
                    skewPassCount++;
                }
            }
        }

        const skewRate = skewTotalCount > 0 ? skewPassCount / skewTotalCount : 0;
        check(`${source}_skewness`, 3,
            skewRate >= 0.75,
            `${skewPassCount}/${skewTotalCount} tiles within 0.2 (${(skewRate * 100).toFixed(1)}%)`);
    }

    // ── Summary ──
    console.log('\n=== Wave 7b Summary ===');
    console.log(`  Tier 1 (must):   ${tier1Pass} pass, ${tier1Fail} fail`);
    console.log(`  Tier 2 (should): ${tier2Pass} pass, ${tier2Fail} fail`);
    console.log(`  Tier 3 (nice):   ${tier3Pass} pass, ${tier3Fail} fail`);

    fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
    fs.writeFileSync(RESULTS_FILE, JSON.stringify({
        timestamp: new Date().toISOString(),
        checks,
        summary: {
            tier1: { pass: tier1Pass, fail: tier1Fail },
            tier2: { pass: tier2Pass, fail: tier2Fail },
            tier3: { pass: tier3Pass, fail: tier3Fail },
        },
    }, null, 2));
    console.log(`\nResults: ${RESULTS_FILE}`);

    process.exit(tier1Fail > 0 ? 1 : 0);
}

main();
