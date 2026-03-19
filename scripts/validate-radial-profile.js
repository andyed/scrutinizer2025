#!/usr/bin/env node
/**
 * Radial Contrast Profile — continuous degradation curve measurement.
 *
 * Measures Oklab luminance standard deviation at fine radial intervals
 * from fixation outward. This IS the curve that corticalStrength() will
 * reshape. Zone-based boundaries produce steps; continuous functions
 * produce smooth curves. The test captures both.
 *
 * Usage:
 *   node scripts/validate-radial-profile.js [options]
 *     --screenshot <path>   Processed screenshot (default: latest smoke_dashboard_mode0)
 *     --baseline <path>     Unfiltered reference (default: latest mode_disabled capture)
 *     --freeze-baseline     Capture and freeze a new radial profile baseline
 *     --num-rings <N>       Number of annular rings (default: 20)
 *     --max-r <N>           Maximum radius in fovea-radius units (default: 12.0)
 *     --fixation-x <0-1>    Horizontal fixation (default: 0.5)
 *     --fixation-y <0-1>    Vertical fixation (default: 0.5)
 *
 * Exit codes:
 *   0 = monotonic decline, no fog rings
 *   1 = validation failed
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { annularStdDev } = require('./lib/image-analysis');

const FOVEA_RADIUS_NORM = 45 / 1012;  // fovealRadius / CSS viewport height
const BASELINE_PATH = path.join(__dirname, '..', 'tests', 'validation', 'radial-profile-baseline.json');

function computeProfile(pngPath, fixationX, fixationY, numRings, maxR) {
    const png = PNG.sync.read(fs.readFileSync(pngPath));
    const foveaRadiusPx = Math.round(FOVEA_RADIUS_NORM * png.height);
    const fixPxX = fixationX * png.width;
    const fixPxY = fixationY * png.height;

    const ringWidth = maxR / numRings;
    const rings = [];

    for (let i = 0; i < numRings; i++) {
        const rMin = i * ringWidth;
        const rMax = (i + 1) * ringWidth;
        const rMinPx = rMin * foveaRadiusPx;
        const rMaxPx = rMax * foveaRadiusPx;
        const rMidDeg = ((rMin + rMax) / 2);  // in fovea-radius units ≈ degrees

        const stats = annularStdDev(png, fixPxX, fixPxY, rMinPx, rMaxPx);

        rings.push({
            rMin, rMax, rMidDeg,
            ...stats,
        });
    }

    return {
        screenshot: path.basename(pngPath),
        imageSize: { width: png.width, height: png.height },
        foveaRadiusPx,
        fixation: { x: fixationX, y: fixationY },
        numRings, maxR,
        rings,
    };
}

async function main() {
    const args = process.argv.slice(2);
    let screenshotPath = null;
    let freezeBaseline = false;
    let numRings = 20;
    let maxR = 12.0;
    let fixationX = 0.5;
    let fixationY = 0.5;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--screenshot' && args[i + 1]) screenshotPath = args[++i];
        else if (args[i] === '--freeze-baseline') freezeBaseline = true;
        else if (args[i] === '--num-rings' && args[i + 1]) numRings = parseInt(args[++i], 10);
        else if (args[i] === '--max-r' && args[i + 1]) maxR = parseFloat(args[++i]);
        else if (args[i] === '--fixation-x' && args[i + 1]) fixationX = parseFloat(args[++i]);
        else if (args[i] === '--fixation-y' && args[i + 1]) fixationY = parseFloat(args[++i]);
    }

    // Find screenshot
    if (!screenshotPath) {
        const smokeDir = path.join(__dirname, '..', 'tests', 'smoke-captures');
        const smokeFile = 'smoke_dashboard_mode0.png';
        screenshotPath = path.join(smokeDir, smokeFile);
        if (!fs.existsSync(screenshotPath)) {
            console.error(`No smoke capture found at ${screenshotPath}`);
            console.error('Run: npm run capture-smoke -- --force');
            process.exit(1);
        }
    }

    console.log(`Screenshot: ${path.basename(screenshotPath)}`);

    // Compute radial profile
    const profile = computeProfile(screenshotPath, fixationX, fixationY, numRings, maxR);
    console.log(`Image: ${profile.imageSize.width}x${profile.imageSize.height}px  Fovea: ${profile.foveaRadiusPx}px`);

    // Freeze baseline if requested
    if (freezeBaseline) {
        const dir = path.dirname(BASELINE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(BASELINE_PATH, JSON.stringify({
            ...profile,
            timestamp: new Date().toISOString(),
        }, null, 2));
        console.log(`\nBaseline frozen to: ${BASELINE_PATH}`);
    }

    // Display profile
    console.log('\n═══ Radial Contrast Profile (Oklab Luminance StdDev) ═══\n');
    console.log(`  ${'Ring'.padEnd(6)} ${'Ecc°'.padStart(5)} ${'StdDev'.padStart(8)} ${'Samples'.padStart(8)}  Visual`);
    console.log(`  ${'─'.repeat(55)}`);

    for (const ring of profile.rings) {
        if (ring.sampleCount < 10) continue;
        const bar = '█'.repeat(Math.round(ring.stdDevL * 200));
        console.log(`  ${ring.rMin.toFixed(1).padStart(3)}-${ring.rMax.toFixed(1).padEnd(3)} ${ring.rMidDeg.toFixed(1).padStart(5)} ${ring.stdDevL.toFixed(4).padStart(8)} ${String(ring.sampleCount).padStart(8)}  ${bar}`);
    }

    // Validation
    console.log('\n═══ Validation ═══\n');
    let pass = true;

    // Check monotonic decline (with tolerance for content variation)
    const populated = profile.rings.filter(r => r.sampleCount >= 50);
    if (populated.length >= 4) {
        let monotonic = true;
        // Use 3-ring moving average to smooth content variation
        for (let i = 3; i < populated.length; i++) {
            const avgPrev = (populated[i - 3].stdDevL + populated[i - 2].stdDevL + populated[i - 1].stdDevL) / 3;
            const avgCurr = (populated[i - 2].stdDevL + populated[i - 1].stdDevL + populated[i].stdDevL) / 3;
            if (avgCurr > avgPrev + 0.01) {
                console.error(`  ✗ Non-monotonic (smoothed): ring ${populated[i].rMin.toFixed(1)}° avg ${avgCurr.toFixed(4)} > ${avgPrev.toFixed(4)}`);
                monotonic = false;
            }
        }
        if (monotonic) {
            console.log('  ✓ Luminance contrast declines monotonically (3-ring smoothed)');
        } else {
            pass = false;
        }
    }

    // Check no fog rings (stdDevL < 0.001 indicates grey averaging)
    const fogRings = populated.filter(r => r.stdDevL < 0.001 && r.rMidDeg > 1.0);
    if (fogRings.length > 0) {
        console.error(`  ✗ Fog detected: ${fogRings.length} ring(s) with stdDevL < 0.001`);
        for (const r of fogRings) {
            console.error(`    Ring ${r.rMin.toFixed(1)}-${r.rMax.toFixed(1)}° stdDevL=${r.stdDevL.toFixed(5)}`);
        }
        pass = false;
    } else {
        console.log('  ✓ No fog rings (all stdDevL >= 0.001)');
    }

    // Compare to frozen baseline if available
    if (fs.existsSync(BASELINE_PATH)) {
        const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
        console.log(`\n  Baseline comparison (frozen ${baseline.timestamp.split('T')[0]}):`);
        let maxDrift = 0;
        let driftCount = 0;
        for (let i = 0; i < Math.min(profile.rings.length, baseline.rings.length); i++) {
            const cur = profile.rings[i];
            const base = baseline.rings[i];
            if (base.stdDevL > 0.001 && cur.sampleCount >= 50) {
                const drift = Math.abs(cur.stdDevL - base.stdDevL) / base.stdDevL;
                if (drift > maxDrift) maxDrift = drift;
                if (drift > 0.25) driftCount++;
            }
        }
        if (driftCount > 0) {
            console.error(`  ✗ ${driftCount} ring(s) drifted >25% from baseline (max drift: ${(maxDrift * 100).toFixed(1)}%)`);
            pass = false;
        } else {
            console.log(`  ✓ All rings within 25% of baseline (max drift: ${(maxDrift * 100).toFixed(1)}%)`);
        }
    }

    // Save results
    const resultsPath = path.join(__dirname, '..', 'tests', 'validation', 'radial-profile.json');
    const resultsDir = path.dirname(resultsPath);
    if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(resultsPath, JSON.stringify({
        ...profile,
        timestamp: new Date().toISOString(),
    }, null, 2));
    console.log(`\nResults saved to: ${resultsPath}`);

    console.log('');
    if (pass) {
        console.log('PASS: Radial contrast profile validates monotonic decline, no fog.');
        process.exit(0);
    } else {
        console.error('FAIL: Radial contrast profile validation failed.');
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
