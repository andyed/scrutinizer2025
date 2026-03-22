#!/usr/bin/env node
/**
 * Phase 0: Tier 2.5 Gap Analysis
 *
 * Quantifies how far Tier 2.5 (mode 10) output is from Brown/Rosenholtz
 * metamers at matched eccentricities. Establishes the baseline that
 * Tier 2.75/3 is improving against.
 *
 * Compares per-eccentricity-band SSIM between:
 *   1. Original (unfiltered) page screenshots
 *   2. Tier 2.5 mode 10 captures
 *   3. Brown metamers (from generate-brown-metamers.py)
 *
 * Usage:
 *   node scripts/analyze-tier25-gap.js
 *   node scripts/analyze-tier25-gap.js --capture   # recapture mode 10 first
 *
 * Exit codes:
 *   0 = analysis complete (no pass/fail — this is a baseline measurement)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { annularStdDev, srgbToLinear } = require('./lib/image-analysis');

const ROOT = path.join(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'tests', 'golden-captures', 'raw');
const GOLDEN_DIR = path.join(ROOT, 'tests', 'golden-captures');
const BROWN_DIR = path.join(ROOT, 'tests', 'brown-metamers');
const RESULTS_FILE = path.join(ROOT, 'tests', 'validation', 'tier25-gap.json');

// Annular rings — same as subband entropy and OCR for comparability
const RINGS = [
    { name: 'fovea',       rMin: 0,    rMax: 0.75 },
    { name: 'parafovea',   rMin: 0.75, rMax: 1.5 },
    { name: 'near_periph', rMin: 1.5,  rMax: 3.0 },
    { name: 'mid_periph',  rMin: 3.0,  rMax: 5.0 },
    { name: 'far_periph',  rMin: 5.0,  rMax: 8.0 },
];

// Test sources — pages with golden + raw + brown captures
const SOURCES = [
    { name: 'dashboard', fixX: 0.5, fixY: 0.5 },
    { name: 'article',   fixX: 0.5, fixY: 0.3 },
    { name: 'ecommerce', fixX: 0.5, fixY: 0.5 },
];

// ── Image math ──

function loadPng(filepath) {
    if (!fs.existsSync(filepath)) return null;
    const data = fs.readFileSync(filepath);
    return PNG.sync.read(data);
}

function extractLuminance(png) {
    const w = png.width, h = png.height;
    const lum = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            lum[y * w + x] = 0.2126 * srgbToLinear(png.data[idx])
                            + 0.7152 * srgbToLinear(png.data[idx + 1])
                            + 0.0722 * srgbToLinear(png.data[idx + 2]);
        }
    }
    return { data: lum, width: w, height: h };
}

/**
 * SSIM within an annular ring (luminance channel).
 * Standard Wang et al. 2004 with C1=0.01², C2=0.03².
 */
function annularSSIM(imgA, imgB, fixX, fixY, rMinPx, rMaxPx) {
    const C1 = 0.0001, C2 = 0.0009; // for [0,1] range
    const rMin2 = rMinPx * rMinPx;
    const rMax2 = rMaxPx * rMaxPx;

    let sumA = 0, sumB = 0, sumA2 = 0, sumB2 = 0, sumAB = 0, count = 0;

    // Sample every 2nd pixel for speed
    for (let y = 0; y < imgA.height; y += 2) {
        for (let x = 0; x < imgA.width; x += 2) {
            const dx = x - fixX, dy = y - fixY;
            const dist2 = dx * dx + dy * dy;
            if (dist2 >= rMin2 && dist2 < rMax2) {
                const a = imgA.data[y * imgA.width + x];
                const b = imgB.data[y * imgB.width + x];
                sumA += a; sumB += b;
                sumA2 += a * a; sumB2 += b * b;
                sumAB += a * b;
                count++;
            }
        }
    }

    if (count < 10) return { ssim: NaN, sampleCount: count };

    const muA = sumA / count, muB = sumB / count;
    const sigA2 = sumA2 / count - muA * muA;
    const sigB2 = sumB2 / count - muB * muB;
    const sigAB = sumAB / count - muA * muB;

    const ssim = ((2 * muA * muB + C1) * (2 * sigAB + C2)) /
                 ((muA * muA + muB * muB + C1) * (sigA2 + sigB2 + C2));

    return { ssim, sampleCount: count };
}

// ── Main ──

function main() {
    const doCapture = process.argv.includes('--capture');

    if (doCapture) {
        console.log('Recapture not yet wired — run `npm run capture-golden` first.');
    }

    const foveaRadius = 45; // px at 1x DPR — matches v2.6 default
    const results = { timestamp: new Date().toISOString(), sources: {} };

    let foundAny = false;

    for (const source of SOURCES) {
        // Find matching files (convention: {source}_mode10.png, {source}_raw.png)
        const mode10Files = fs.readdirSync(GOLDEN_DIR)
            .filter(f => f.includes(source.name) && f.includes('mode10') && f.endsWith('.png'));
        const rawFiles = fs.readdirSync(RAW_DIR)
            .filter(f => f.includes(source.name) && f.endsWith('.png'));
        const brownFiles = fs.existsSync(BROWN_DIR) ? fs.readdirSync(BROWN_DIR)
            .filter(f => f.includes(source.name) && f.endsWith('.png')) : [];

        if (mode10Files.length === 0 || rawFiles.length === 0) {
            console.log(`  [SKIP] ${source.name}: missing mode10 or raw captures`);
            continue;
        }
        foundAny = true;

        const mode10 = loadPng(path.join(GOLDEN_DIR, mode10Files[0]));
        const raw = loadPng(path.join(RAW_DIR, rawFiles[0]));
        const brown = brownFiles.length > 0 ? loadPng(path.join(BROWN_DIR, brownFiles[0])) : null;

        const lumMode10 = extractLuminance(mode10);
        const lumRaw = extractLuminance(raw);
        const lumBrown = brown ? extractLuminance(brown) : null;

        const fixXpx = Math.round(source.fixX * mode10.width);
        const fixYpx = Math.round(source.fixY * mode10.height);

        console.log(`\n── ${source.name} (${mode10.width}×${mode10.height}) ──`);

        const ringResults = [];
        for (const ring of RINGS) {
            const rMinPx = ring.rMin * foveaRadius;
            const rMaxPx = ring.rMax * foveaRadius;

            // Raw vs Mode 10 — how much does Tier 2.5 degrade?
            const rawVsMode10 = annularSSIM(lumRaw, lumMode10, fixXpx, fixYpx, rMinPx, rMaxPx);

            // Raw vs Brown — how much does ground-truth degrade?
            const rawVsBrown = lumBrown
                ? annularSSIM(lumRaw, lumBrown, fixXpx, fixYpx, rMinPx, rMaxPx)
                : { ssim: NaN, sampleCount: 0 };

            // Mode 10 vs Brown — how close is Tier 2.5 to ground truth?
            const mode10VsBrown = lumBrown
                ? annularSSIM(lumMode10, lumBrown, fixXpx, fixYpx, rMinPx, rMaxPx)
                : { ssim: NaN, sampleCount: 0 };

            const result = {
                ring: ring.name,
                rawVsMode10_ssim: rawVsMode10.ssim,
                rawVsBrown_ssim: rawVsBrown.ssim,
                mode10VsBrown_ssim: mode10VsBrown.ssim,
                sampleCount: rawVsMode10.sampleCount,
            };
            ringResults.push(result);

            const m10 = isFinite(result.rawVsMode10_ssim) ? result.rawVsMode10_ssim.toFixed(3) : 'N/A';
            const brn = isFinite(result.rawVsBrown_ssim) ? result.rawVsBrown_ssim.toFixed(3) : 'N/A';
            const gap = isFinite(result.mode10VsBrown_ssim) ? result.mode10VsBrown_ssim.toFixed(3) : 'N/A';

            console.log(`  ${ring.name.padEnd(14)} raw→m10: ${m10}  raw→brown: ${brn}  m10→brown: ${gap}  (n=${result.sampleCount})`);
        }

        results.sources[source.name] = ringResults;
    }

    if (!foundAny) {
        console.log('\nNo source images found. Run:');
        console.log('  npm run capture-golden    # mode 10 + raw captures');
        console.log('  npm run generate-brown    # Brown metamers');
        process.exit(0);
    }

    // Write results
    fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    console.log(`\nResults: ${RESULTS_FILE}`);
    console.log('\nThis is a baseline measurement — no pass/fail. Expected:');
    console.log('  Fovea SSIM ~0.95+, far peripheral ~0.3-0.5');
    console.log('  Mode10→Brown gap shows where Tier 2.5 diverges from ground truth.');

    process.exit(0);
}

main();
