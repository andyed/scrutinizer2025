#!/usr/bin/env node
/**
 * Isotropic Rendering Validation (spec items 5-9)
 *
 * Validates type 5 (cortical isotropic) rendering properties by comparing
 * mode 12 captures against mode 0 (baseline) on reference pages.
 *
 * Tests:
 *   5. Angular isotropy — degradation equal in all directions at same eccentricity
 *   6. Readability destruction — parafoveal text not MORE readable than mode 0
 *   7. Texture preservation — peripheral content retains luminance variance
 *   8. Dark mode artifacts — no bright scatter on dark backgrounds
 *   9. Mode comparison — mode 12 visually comparable to mode 0
 *
 * Requires captures from: node scripts/capture-isotropic-comparison.js --force
 *
 * Usage:
 *   node scripts/validate-isotropic-rendering.js
 *   node scripts/validate-isotropic-rendering.js --capture  (run captures first)
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { PNG } = require('pngjs');
const { annularStdDev } = require('./lib/image-analysis');

const ROOT = path.join(__dirname, '..');
const CAPTURE_DIR = path.join(ROOT, 'docs', 'golden', 'isotropic-comparison');

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadPng(filepath) {
    if (!fs.existsSync(filepath)) return null;
    const data = fs.readFileSync(filepath);
    return PNG.sync.read(data);
}

function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(r, g, b) {
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/**
 * Sample luminance variance in a wedge-shaped sector (angular slice of an annulus).
 * Returns stddev of luminance in the sector.
 */
function wedgeStdDev(png, fixX, fixY, rMin, rMax, angleMin, angleMax) {
    let sum = 0, sum2 = 0, count = 0;
    const rMin2 = rMin * rMin, rMax2 = rMax * rMax;

    for (let y = 0; y < png.height; y += 2) {
        for (let x = 0; x < png.width; x += 2) {
            const dx = x - fixX, dy = y - fixY;
            const dist2 = dx * dx + dy * dy;
            if (dist2 < rMin2 || dist2 >= rMax2) continue;

            let angle = Math.atan2(dy, dx);
            if (angle < 0) angle += 2 * Math.PI;
            if (angle < angleMin || angle >= angleMax) continue;

            const idx = (y * png.width + x) * 4;
            const lum = luminance(png.data[idx], png.data[idx + 1], png.data[idx + 2]);
            sum += lum;
            sum2 += lum * lum;
            count++;
        }
    }

    if (count < 10) return { stdDev: 0, count };
    const mean = sum / count;
    return { stdDev: Math.sqrt(Math.max(0, sum2 / count - mean * mean)), count };
}

/**
 * Count "bright scatter" pixels — isolated bright pixels on dark backgrounds.
 * A pixel is a bright scatter if it's significantly brighter than its 3x3 neighborhood.
 */
function countBrightScatter(png, fixX, fixY, rMin, rMax, threshold) {
    let scatterCount = 0, totalCount = 0;
    const rMin2 = rMin * rMin, rMax2 = rMax * rMax;

    for (let y = 2; y < png.height - 2; y++) {
        for (let x = 2; x < png.width - 2; x++) {
            const dx = x - fixX, dy = y - fixY;
            const dist2 = dx * dx + dy * dy;
            if (dist2 < rMin2 || dist2 >= rMax2) continue;

            const idx = (y * png.width + x) * 4;
            const lum = luminance(png.data[idx], png.data[idx + 1], png.data[idx + 2]);

            // 3x3 neighborhood mean (excluding center)
            let nSum = 0, nCount = 0;
            for (let ny = -1; ny <= 1; ny++) {
                for (let nx = -1; nx <= 1; nx++) {
                    if (nx === 0 && ny === 0) continue;
                    const ni = ((y + ny) * png.width + (x + nx)) * 4;
                    nSum += luminance(png.data[ni], png.data[ni + 1], png.data[ni + 2]);
                    nCount++;
                }
            }
            const neighborMean = nSum / nCount;

            totalCount++;
            if (lum - neighborMean > threshold) {
                scatterCount++;
            }
        }
    }

    return { scatterCount, totalCount, rate: totalCount > 0 ? scatterCount / totalCount : 0 };
}

// ── Validators ───────────────────────────────────────────────────────────────

const results = [];
let passCount = 0, failCount = 0, skipCount = 0;

function check(id, label, pass, detail) {
    const status = pass ? '✓' : '✗';
    const tag = pass ? 'PASS' : 'FAIL';
    console.log(`  ${status} ${id} ${label}: ${detail}`);
    results.push({ id, label, pass, detail });
    if (pass) passCount++; else failCount++;
}

function skip(id, label, reason) {
    console.log(`  ⊘ ${id} ${label}: SKIP — ${reason}`);
    results.push({ id, label, pass: null, detail: reason });
    skipCount++;
}

// ── Test 5: Angular Isotropy ─────────────────────────────────────────────────
// At same eccentricity, degradation should be equal in all directions.
// Measure luminance stddev in 4 quadrant wedges at the same radius.
// Coefficient of variation across quadrants should be < 0.5 (50%).

function test5_angularIsotropy(page, fixation) {
    const file = `${page}_${fixation}_mode12_isotropic.png`;
    const png = loadPng(path.join(CAPTURE_DIR, file));
    if (!png) { skip('5', `Angular isotropy (${page}/${fixation})`, `missing ${file}`); return; }

    const fixX = Math.round(png.width * (fixation === 'center' ? 0.5 : 0.25));
    const fixY = Math.round(png.height * (fixation === 'center' ? 0.5 : 0.25));

    // Test at mid-periphery (~200px from fixation)
    const rMin = 150, rMax = 250;
    const quadrants = [
        { name: 'right',  min: 0,              max: Math.PI / 2 },
        { name: 'top',    min: Math.PI / 2,    max: Math.PI },
        { name: 'left',   min: Math.PI,        max: 3 * Math.PI / 2 },
        { name: 'bottom', min: 3 * Math.PI / 2, max: 2 * Math.PI },
    ];

    const stdDevs = quadrants.map(q => wedgeStdDev(png, fixX, fixY, rMin, rMax, q.min, q.max));
    const vals = stdDevs.map(s => s.stdDev).filter(v => v > 0);

    if (vals.length < 3) {
        skip('5', `Angular isotropy (${page}/${fixation})`, 'insufficient quadrant data');
        return;
    }

    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const cv = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length) / Math.max(mean, 0.001);

    check('5', `Angular isotropy (${page}/${fixation})`,
        cv < 0.5,
        `CV=${cv.toFixed(3)} across quadrants (threshold: <0.50). stdDevs: ${vals.map(v => v.toFixed(4)).join(', ')}`
    );
}

// ── Test 6: Readability Destruction ──────────────────────────────────────────
// Mode 12 parafoveal HF content should not EXCEED mode 0.
// Compare annular luminance stddev at 1-2.5° (parafovea) between modes.

function test6_readabilityDestruction(page) {
    const m0file = `${page}_center_mode0_smoothstep.png`;
    const m12file = `${page}_center_mode12_isotropic.png`;
    const m0 = loadPng(path.join(CAPTURE_DIR, m0file));
    const m12 = loadPng(path.join(CAPTURE_DIR, m12file));

    if (!m0 || !m12) {
        skip('6', `Readability destruction (${page})`,
            `missing ${!m0 ? m0file : m12file}`);
        return;
    }

    const fixX = Math.round(m0.width * 0.5);
    const fixY = Math.round(m0.height * 0.5);

    // Parafovea: ~45-112px (1-2.5° at 45ppd)
    const rMin = 45, rMax = 112;

    const stats0 = annularStdDev(m0, fixX, fixY, rMin, rMax);
    const stats12 = annularStdDev(m12, fixX, fixY, rMin, rMax);

    // Mode 12 should not have MORE high-frequency content (higher stddev) than mode 0
    // Allow 20% tolerance — some variation is expected from different displacement patterns
    const ratio = stats12.stdDevL / Math.max(stats0.stdDevL, 0.001);

    check('6', `Readability destruction (${page})`,
        ratio < 1.2,
        `mode12/mode0 parafoveal stdDevL ratio=${ratio.toFixed(3)} (threshold: <1.20). m0=${stats0.stdDevL.toFixed(4)}, m12=${stats12.stdDevL.toFixed(4)}`
    );
}

// ── Test 7: Texture Preservation ─────────────────────────────────────────────
// Peripheral content should retain luminance variance (not collapse to fog).
// Compare far-periphery stddev against fovea — ratio should stay above 0.15.

function test7_texturePreservation(page) {
    const file = `${page}_center_mode12_isotropic.png`;
    const png = loadPng(path.join(CAPTURE_DIR, file));
    if (!png) { skip('7', `Texture preservation (${page})`, `missing ${file}`); return; }

    const fixX = Math.round(png.width * 0.5);
    const fixY = Math.round(png.height * 0.5);

    // Fovea: 0-45px, Far periphery: 300-500px
    const fovea = annularStdDev(png, fixX, fixY, 0, 45);
    const farPeriph = annularStdDev(png, fixX, fixY, 300, 500);

    if (fovea.stdDevL < 0.001) {
        skip('7', `Texture preservation (${page})`, 'fovea stdDevL too low (uniform content)');
        return;
    }

    const ratio = farPeriph.stdDevL / fovea.stdDevL;

    check('7', `Texture preservation (${page})`,
        ratio > 0.15,
        `far-periph/fovea stdDevL ratio=${ratio.toFixed(3)} (threshold: >0.15). fovea=${fovea.stdDevL.toFixed(4)}, farPeriph=${farPeriph.stdDevL.toFixed(4)}`
    );
}

// ── Test 8: Dark Mode Scatter ────────────────────────────────────────────────
// No bright scatter on dark backgrounds. Scatter rate should be < 0.1%.
// Uses the gray chromatic smoke capture (dark reference).

function test8_darkModeScatter() {
    // Check if we have a dark-background capture from smoke tests
    const smokeDir = path.join(ROOT, 'tests', 'smoke-captures');
    const grayFile = path.join(smokeDir, 'smoke_gray_chromatic.png');
    const png = loadPng(grayFile);

    if (!png) { skip('8', 'Dark mode scatter', 'missing smoke_gray_chromatic.png'); return; }

    const fixX = Math.round(png.width * 0.5);
    const fixY = Math.round(png.height * 0.5);

    // Periphery: 150-400px from fixation
    const scatter = countBrightScatter(png, fixX, fixY, 150, 400, 0.15);

    check('8', 'Dark mode scatter',
        scatter.rate < 0.001,
        `scatter rate=${(scatter.rate * 100).toFixed(3)}% (threshold: <0.1%). ${scatter.scatterCount}/${scatter.totalCount} pixels`
    );
}

// ── Test 9: Mode Comparison ──────────────────────────────────────────────────
// Mode 12 should be visually comparable to mode 0.
// Global luminance mean should be within 10%, global stddev within 30%.

function test9_modeComparison(page) {
    const m0file = `${page}_center_mode0_smoothstep.png`;
    const m12file = `${page}_center_mode12_isotropic.png`;
    const m0 = loadPng(path.join(CAPTURE_DIR, m0file));
    const m12 = loadPng(path.join(CAPTURE_DIR, m12file));

    if (!m0 || !m12) {
        skip('9', `Mode comparison (${page})`, `missing ${!m0 ? m0file : m12file}`);
        return;
    }

    const fixX = Math.round(m0.width * 0.5);
    const fixY = Math.round(m0.height * 0.5);

    // Full image comparison (annulus 0 to max)
    const maxR = Math.max(m0.width, m0.height);
    const stats0 = annularStdDev(m0, fixX, fixY, 0, maxR);
    const stats12 = annularStdDev(m12, fixX, fixY, 0, maxR);

    const meanRatio = stats12.meanL / Math.max(stats0.meanL, 0.001);
    const stdRatio = stats12.stdDevL / Math.max(stats0.stdDevL, 0.001);

    const meanOk = meanRatio > 0.90 && meanRatio < 1.10;
    const stdOk = stdRatio > 0.70 && stdRatio < 1.30;

    check('9', `Mode comparison (${page})`,
        meanOk && stdOk,
        `meanL ratio=${meanRatio.toFixed(3)} (0.90-1.10), stdDevL ratio=${stdRatio.toFixed(3)} (0.70-1.30)`
    );
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const doCapture = process.argv.includes('--capture');

    if (doCapture) {
        console.log('Running isotropic comparison captures...\n');
        const { execSync } = require('child_process');
        execSync('node scripts/capture-isotropic-comparison.js --force', {
            cwd: ROOT,
            stdio: 'inherit',
            timeout: 300000,
        });
        console.log('');
    }

    console.log('═══ Isotropic Rendering Validation (spec items 5-9) ═══\n');

    // Check for captures
    if (!fs.existsSync(CAPTURE_DIR)) {
        console.log(`  No captures found at ${CAPTURE_DIR}`);
        console.log('  Run: node scripts/capture-isotropic-comparison.js --force\n');
        console.log('  Or: node scripts/validate-isotropic-rendering.js --capture\n');
    }

    const pages = ['grid', 'dashboard', 'article'];

    // Test 5: Angular isotropy
    console.log('── Test 5: Angular Isotropy ──');
    for (const page of pages) {
        test5_angularIsotropy(page, 'center');
    }

    // Test 6: Readability destruction
    console.log('\n── Test 6: Readability Destruction ──');
    for (const page of ['article', 'dashboard']) {
        test6_readabilityDestruction(page);
    }

    // Test 7: Texture preservation
    console.log('\n── Test 7: Texture Preservation ──');
    for (const page of pages) {
        test7_texturePreservation(page);
    }

    // Test 8: Dark mode scatter
    console.log('\n── Test 8: Dark Mode Scatter ──');
    test8_darkModeScatter();

    // Test 9: Mode comparison
    console.log('\n── Test 9: Mode Comparison ──');
    for (const page of pages) {
        test9_modeComparison(page);
    }

    // Summary
    console.log(`\n═══ Summary ═══`);
    console.log(`  Passed: ${passCount}, Failed: ${failCount}, Skipped: ${skipCount}`);

    // Save results
    const outPath = path.join(ROOT, 'tests', 'validation', 'isotropic-rendering.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), results, passCount, failCount, skipCount }, null, 2));
    console.log(`  Results: ${outPath}\n`);

    if (failCount > 0) {
        console.log(`FAIL: ${failCount} check(s) did not meet criteria.\n`);
        process.exit(1);
    } else if (passCount === 0) {
        console.log('No checks ran — captures needed.\n');
        process.exit(1);
    } else {
        console.log(`PASS: All ${passCount} checks passed.\n`);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
