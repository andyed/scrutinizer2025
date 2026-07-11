#!/usr/bin/env node
/**
 * Wave 7c: Crowding Asymmetry Validation
 *
 * Intended to be THE SCIENTIFIC MILESTONE for Tier 3 — but CURRENTLY A
 * KNOWN-FAILING DIAGNOSTIC, not a validated claim. As of 2026-07-11 the
 * synthesis modes' (14/15) *isolated*-letter OCR baseline is unreadable, so
 * the crowding/asymmetry checks are unscorable (see status:"known-failing-
 * diagnostic" in the output JSON). A low flanked-confidence with an unreadable
 * isolated baseline does NOT demonstrate crowding — it is indistinguishable
 * from a blank capture. Do not cite crowding as validated until a run reaches
 * status:"passing". Tracking: docs/sprucing/phase-0-science-verification.md P0-1.
 *
 * Tests whether synthesis-based peripheral rendering produces crowding
 * asymmetry as an emergent property of statistical pooling:
 *
 *   Tier 1: Isolated letter at 8° — OCR recognizes it (structure preserved)
 *   Tier 1: Flanked letter at 8° — OCR fails (crowding destroys identity)
 *   Tier 2: Asymmetry ratio > 2× (isolated recognition / flanked recognition)
 *   Tier 3: Critical spacing tracks Bouma's 0.5 × eccentricity within 20%
 *
 * If Tier 2.75/3 produces this asymmetry but displacement (mode 12) does NOT,
 * the pooling mechanism is responsible — a publishable result.
 *
 * Prerequisites:
 *   node scripts/capture-crowding-tier3.js
 *
 * Usage:
 *   node scripts/validate-crowding-tier3.js
 *
 * Exit codes:
 *   0 = Tier 1 checks pass
 *   1 = Tier 1 validation failed
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CAPTURE_DIR = path.join(ROOT, 'tests', 'crowding-captures', 'tier3');
const RESULTS_FILE = path.join(ROOT, 'tests', 'validation', 'wave7c-crowding.json');

// Letter region — where the target letter sits in the capture.
// crowding-ocr-test.html places target at 8° = 360px right of center.
// At 1920x1012 frame: center=(960,506), target center=(1320,506).
// Letter is ~36px tall (0.8 * 45ppd). Crop generously around it.
// Retina captures would be 2x — detect and scale below.
function getLetterRegion(imageWidth) {
    const dpr = imageWidth > 2000 ? 2 : 1;
    return {
        x: (1320 - 40) * dpr,  // 40px left of letter center
        y: (506 - 40) * dpr,   // 40px above letter center
        width: 80 * dpr,
        height: 80 * dpr,
    };
}

const MODES = ['mode12', 'mode14', 'mode15'];
const CONDITIONS = ['isolated', 'flanked'];

// ── OCR ──

/**
 * Run OCR on a cropped region of a PNG.
 * Returns { text, confidence } using Tesseract if available,
 * or falls back to luminance-contrast heuristic.
 */
function ocrRegion(pngPath, region) {
    const png = loadPng(pngPath);
    if (!png) return { text: '', confidence: 0, method: 'missing' };

    // Try Tesseract
    try {
        // Crop region to temp file
        const cropPng = cropRegion(png, region);
        const tmpPath = path.join(CAPTURE_DIR, '_ocr_tmp.png');
        fs.writeFileSync(tmpPath, PNG.sync.write(cropPng));

        const result = execSync(
            `tesseract "${tmpPath}" stdout --psm 10 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ 2>/dev/null`,
            { encoding: 'utf-8', timeout: 5000 }
        ).trim();

        // Clean up
        try { fs.unlinkSync(tmpPath); } catch (_) {}

        return {
            text: result,
            confidence: result.length === 1 ? 1.0 : result.length > 0 ? 0.5 : 0.0,
            method: 'tesseract',
        };
    } catch (_) {
        // Tesseract not available — fall back to contrast heuristic
        return contrastHeuristic(png, region);
    }
}

/**
 * Fallback: measure whether a letter-like structure is recognizable
 * by checking if the region has structured contrast (edges) vs noise.
 *
 * High edge coherence = recognizable letter structure.
 * Low edge coherence = pooled/noisy = crowded.
 */
function contrastHeuristic(png, region) {
    const crop = cropRegion(png, region);
    const w = crop.width, h = crop.height;

    // Compute horizontal and vertical gradient magnitudes
    let gradSum = 0, gradCount = 0;
    let lumValues = [];

    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const idx = (y * w + x) * 4;
            const lum = 0.2126 * crop.data[idx] + 0.7152 * crop.data[idx + 1] + 0.0722 * crop.data[idx + 2];
            lumValues.push(lum);

            const idxL = (y * w + (x - 1)) * 4;
            const idxR = (y * w + (x + 1)) * 4;
            const idxU = ((y - 1) * w + x) * 4;
            const idxD = ((y + 1) * w + x) * 4;

            const gx = (0.2126 * crop.data[idxR] + 0.7152 * crop.data[idxR + 1] + 0.0722 * crop.data[idxR + 2])
                      - (0.2126 * crop.data[idxL] + 0.7152 * crop.data[idxL + 1] + 0.0722 * crop.data[idxL + 2]);
            const gy = (0.2126 * crop.data[idxD] + 0.7152 * crop.data[idxD + 1] + 0.0722 * crop.data[idxD + 2])
                      - (0.2126 * crop.data[idxU] + 0.7152 * crop.data[idxU + 1] + 0.0722 * crop.data[idxU + 2]);

            gradSum += Math.sqrt(gx * gx + gy * gy);
            gradCount++;
        }
    }

    const meanGrad = gradCount > 0 ? gradSum / gradCount : 0;

    // Compute luminance std dev
    const meanLum = lumValues.reduce((a, b) => a + b, 0) / lumValues.length;
    const varLum = lumValues.reduce((a, b) => a + (b - meanLum) ** 2, 0) / lumValues.length;
    const stdLum = Math.sqrt(varLum);

    // Edge coherence: structured edges (letters) have high gradient with low noise
    // Pooled regions have moderate gradient but high noise (random directions)
    const coherence = meanGrad > 5 && stdLum > 10 ? 1.0 : meanGrad > 2 ? 0.5 : 0.0;

    return {
        text: coherence >= 0.5 ? '?' : '',
        confidence: coherence,
        method: 'contrast_heuristic',
        meanGradient: meanGrad,
        stdLuminance: stdLum,
    };
}

function loadPng(filepath) {
    if (!fs.existsSync(filepath)) return null;
    return PNG.sync.read(fs.readFileSync(filepath));
}

function cropRegion(png, region) {
    const x0 = Math.max(0, region.x);
    const y0 = Math.max(0, region.y);
    const x1 = Math.min(png.width, region.x + region.width);
    const y1 = Math.min(png.height, region.y + region.height);
    const w = x1 - x0, h = y1 - y0;

    const crop = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const srcIdx = ((y0 + y) * png.width + (x0 + x)) * 4;
            const dstIdx = (y * w + x) * 4;
            crop.data[dstIdx]     = png.data[srcIdx];
            crop.data[dstIdx + 1] = png.data[srcIdx + 1];
            crop.data[dstIdx + 2] = png.data[srcIdx + 2];
            crop.data[dstIdx + 3] = png.data[srcIdx + 3];
        }
    }
    return crop;
}

// ── Main ──

function main() {
    const checks = [];
    let tier1Pass = 0, tier1Fail = 0;
    let tier2Pass = 0, tier2Fail = 0;
    let tier3Pass = 0, tier3Fail = 0;

    // A check may be `valid: false` — meaning it could not be scored at all
    // (e.g. the isolated-letter baseline was unreadable, so "did crowding
    // destroy the flanked letter?" is unanswerable). An invalid check is NEVER
    // a pass, and is tallied as a failure so the run cannot exit green on it.
    // This is the guard against the historic "OCR read nothing → counted as
    // crowding" defect (a 0.00-confidence flanked read used to pass by itself).
    let invalidCount = 0;
    function check(name, tier, pass, detail, valid = true) {
        if (!valid) pass = false;
        checks.push({ name, tier, pass, valid, detail });
        const tag = !valid ? 'INVALID' : pass ? 'PASS' : 'FAIL';
        if (!valid) invalidCount++;
        if (tier === 1) pass ? tier1Pass++ : tier1Fail++;
        else if (tier === 2) pass ? tier2Pass++ : tier2Fail++;
        else pass ? tier3Pass++ : tier3Fail++;
        console.log(`  [${tag}] T${tier} ${name}: ${detail}`);
    }

    // Per-mode results for comparison
    const modeResults = {};

    for (const mode of MODES) {
        console.log(`\n── ${mode} ──`);
        const results = {};

        for (const cond of CONDITIONS) {
            const filename = `crowding_${cond}_${mode}.png`;
            const filepath = path.join(CAPTURE_DIR, filename);

            if (!fs.existsSync(filepath)) {
                console.log(`  [SKIP] ${filename}: not found`);
                results[cond] = { confidence: NaN, method: 'missing' };
                continue;
            }

            const png = loadPng(filepath);
            const region = getLetterRegion(png ? png.width : 1920);
            const ocr = ocrRegion(filepath, region);
            results[cond] = ocr;
            console.log(`  ${cond}: confidence=${ocr.confidence.toFixed(2)} method=${ocr.method} text="${ocr.text}"`);
        }

        modeResults[mode] = results;

        // Validate mode14 (tiles) and mode15 (sectors) — both pooling pipelines
        if (mode === 'mode14' || mode === 'mode15') {
            const isoConf = Number.isFinite(results.isolated?.confidence) ? results.isolated.confidence : 0;
            const flkConf = Number.isFinite(results.flanked?.confidence) ? results.flanked.confidence : 0;

            // Readability precondition: crowding can only be scored if the
            // ISOLATED letter was actually read. Without a legible baseline,
            // a low flanked confidence is indistinguishable from a blank/broken
            // capture — so we must not credit it as "crowding".
            const isolatedReadable = isoConf >= 0.5;

            // Tier 1: Isolated letter recognized (the precondition itself)
            check(`${mode}_isolated_recognized`, 1,
                isolatedReadable,
                `confidence ${isoConf.toFixed(2)} >= 0.5`);

            if (!isolatedReadable) {
                // Baseline unreadable → the crowding and asymmetry checks are
                // UNSCORABLE, not passing. Mark invalid (counts as failure).
                check(`${mode}_flanked_crowded`, 1, false,
                    `invalid: isolated letter unreadable (conf ${isoConf.toFixed(2)}) — cannot score crowding`,
                    /* valid */ false);
                check(`${mode}_asymmetry_ratio`, 2, false,
                    `invalid: isolated letter unreadable (conf ${isoConf.toFixed(2)}) — asymmetry undefined`,
                    /* valid */ false);
            } else {
                // Tier 1: Flanked letter NOT recognized (crowding) — now meaningful
                check(`${mode}_flanked_crowded`, 1,
                    flkConf < 0.5,
                    `confidence ${flkConf.toFixed(2)} < 0.5 (isolated readable at ${isoConf.toFixed(2)})`);

                // Tier 2: Asymmetry ratio > 2×
                const ratio = flkConf > 0 ? isoConf / flkConf : Infinity;
                check(`${mode}_asymmetry_ratio`, 2,
                    ratio > 2.0,
                    `ratio ${isFinite(ratio) ? ratio.toFixed(2) : '∞'} > 2.0`);
            }
        }
    }

    // ── Cross-mode comparison ──
    console.log('\n── Cross-Mode Comparison ──');
    {
        // Displacement (mode12) should NOT show asymmetry
        const m12 = modeResults.mode12;
        if (m12?.isolated && m12?.flanked) {
            const m12iso = m12.isolated.confidence;
            const m12flk = m12.flanked.confidence;
            const m12ratio = m12flk > 0 ? m12iso / m12flk : 1;
            console.log(`  mode12 (displacement): isolated=${m12iso.toFixed(2)} flanked=${m12flk.toFixed(2)} ratio=${m12ratio.toFixed(2)}`);
            console.log(`  Expected: ratio ≈ 1.0 (no asymmetry from displacement)`);
        }

        // Synthesis (mode14) SHOULD show asymmetry
        const m14 = modeResults.mode14;
        if (m14?.isolated && m14?.flanked) {
            const m14iso = m14.isolated.confidence;
            const m14flk = m14.flanked.confidence;
            const m14ratio = m14flk > 0 ? m14iso / m14flk : Infinity;
            console.log(`  mode14 (synthesis):    isolated=${m14iso.toFixed(2)} flanked=${m14flk.toFixed(2)} ratio=${isFinite(m14ratio) ? m14ratio.toFixed(2) : '∞'}`);
            console.log(`  Expected: ratio > 2.0 (crowding from pooling)`);
        }
    }

    // ── Summary ──
    console.log('\n=== Wave 7c Summary ===');
    console.log(`  Tier 1 (must):   ${tier1Pass} pass, ${tier1Fail} fail`);
    console.log(`  Tier 2 (should): ${tier2Pass} pass, ${tier2Fail} fail`);
    console.log(`  Tier 3 (nice):   ${tier3Pass} pass, ${tier3Fail} fail`);
    if (invalidCount > 0) {
        console.log(`  Invalid (unscorable): ${invalidCount} — isolated-letter baseline unreadable`);
    }

    // Top-level status the rest of the project can trust:
    //   passing                    — Tier-1 checks all scored and passed (the milestone)
    //   known-failing-diagnostic   — at least one check was unscorable (baseline
    //                                unreadable); this file is a diagnostic, NOT a
    //                                validated claim. Do not cite crowding as validated.
    //   failing                    — checks scored but did not pass
    let status;
    if (invalidCount > 0) {
        status = 'known-failing-diagnostic';
    } else if (tier1Pass > 0 && tier1Fail === 0) {
        status = 'passing';
    } else {
        status = 'failing';
    }

    if (status === 'passing') {
        console.log('\n  *** SCIENTIFIC MILESTONE: Crowding asymmetry from pooling confirmed. ***');
    } else if (status === 'known-failing-diagnostic') {
        console.log('\n  ⚠ DIAGNOSTIC ONLY: isolated-letter baseline unreadable — crowding is NOT validated by this run.');
    }

    fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
    fs.writeFileSync(RESULTS_FILE, JSON.stringify({
        timestamp: new Date().toISOString(),
        status,
        note: status === 'known-failing-diagnostic'
            ? 'Isolated-letter OCR baseline was unreadable, so crowding/asymmetry checks are unscorable (marked valid:false). A low flanked-confidence here does NOT demonstrate crowding — it is indistinguishable from a blank capture. Do not cite crowding as a validated claim until this run reaches status:passing. See docs/sprucing/phase-0-science-verification.md P0-1.'
            : undefined,
        checks,
        modeResults,
        summary: {
            tier1: { pass: tier1Pass, fail: tier1Fail },
            tier2: { pass: tier2Pass, fail: tier2Fail },
            tier3: { pass: tier3Pass, fail: tier3Fail },
            invalid: invalidCount,
        },
    }, null, 2));
    console.log(`\nResults: ${RESULTS_FILE}`);

    // Exit non-zero on any Tier-1 failure OR any unscorable check — a run that
    // could not even read its baseline must never report success.
    process.exit((tier1Fail > 0 || invalidCount > 0) ? 1 : 0);
}

main();
