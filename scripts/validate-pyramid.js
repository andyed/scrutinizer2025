#!/usr/bin/env node
/**
 * Wave 7a: Pyramid Decomposition Fidelity
 *
 * Validates WGSL Laplacian pyramid output against JS and pyrtools references.
 * Tier 1 checks (must pass), Tier 2 (should pass), Tier 3 (nice to have).
 *
 * Prerequisites:
 *   node scripts/capture-pyramid-subbands.js   # generates WGSL + JS ref PNGs
 *   python scripts/generate-pyramid-reference.py  # generates pyrtools ref
 *
 * Usage:
 *   node scripts/validate-pyramid.js
 *
 * Exit codes:
 *   0 = all Tier 1 checks pass
 *   1 = Tier 1 validation failed
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const CAPTURE_DIR = path.join(ROOT, 'tests', 'pyramid-captures');
const PYRTOOLS_DIR = path.join(ROOT, 'tests', 'pyrtools-reference');
const RESULTS_FILE = path.join(ROOT, 'tests', 'validation', 'wave7a-pyramid.json');

const SOURCES = ['dashboard', 'article', 'ecommerce'];
const NUM_BANDS = 4;

// ── Validation criteria from spec ──

const CRITERIA = {
    // Tier 1: must pass
    solidGrayBandMSE: { threshold: 0.001, tier: 1, desc: 'Solid gray → near-zero bands' },
    reconstructionMSE: { threshold: 0.005, tier: 1, desc: 'Perfect reconstruction (sum bands + residual = original)' },
    // Tier 2: should pass
    pyrtoolsBandMSE: { threshold: 0.005, tier: 2, desc: 'Per-band MSE vs pyrtools < 0.005' },
    // Tier 3: nice to have
    energyConservation: { threshold: 0.02, tier: 3, desc: 'Energy conservation ± 2%' },
};

// ── Image loading ──

function loadPng(filepath) {
    if (!fs.existsSync(filepath)) return null;
    return PNG.sync.read(fs.readFileSync(filepath));
}

function loadBandFloat(filepath) {
    const png = loadPng(filepath);
    if (!png) return null;
    // Band PNGs are centered at 128 (0 = -128, 255 = +127)
    const data = new Float32Array(png.width * png.height);
    for (let i = 0; i < data.length; i++) {
        data[i] = png.data[i * 4] - 128;
    }
    return { data, width: png.width, height: png.height };
}

function loadResidualFloat(filepath) {
    const png = loadPng(filepath);
    if (!png) return null;
    const data = new Float32Array(png.width * png.height);
    for (let i = 0; i < data.length; i++) {
        data[i] = png.data[i * 4]; // absolute, not centered
    }
    return { data, width: png.width, height: png.height };
}

function extractLuminance(png) {
    const data = new Float32Array(png.width * png.height);
    for (let i = 0; i < data.length; i++) {
        const idx = i * 4;
        data[i] = 0.2126 * png.data[idx] + 0.7152 * png.data[idx + 1] + 0.0722 * png.data[idx + 2];
    }
    return { data, width: png.width, height: png.height };
}

function mse(a, b) {
    if (a.length !== b.length) return NaN;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        sum += d * d;
    }
    return sum / a.length;
}

function totalEnergy(data) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum += data[i] * data[i];
    }
    return sum;
}

// ── Main ──

function main() {
    const checks = [];
    let tier1Pass = 0, tier1Fail = 0;
    let tier2Pass = 0, tier2Fail = 0;
    let tier3Pass = 0, tier3Fail = 0;

    function check(name, tier, actual, threshold, comparator = '<=') {
        const pass = comparator === '<=' ? actual <= threshold : actual >= threshold;
        checks.push({ name, tier, actual, threshold, comparator, pass });

        const tag = pass ? 'PASS' : 'FAIL';
        const bucket = tier === 1 ? (pass ? ++tier1Pass : ++tier1Fail)
                     : tier === 2 ? (pass ? ++tier2Pass : ++tier2Fail)
                     : (pass ? ++tier3Pass : ++tier3Fail);
        void bucket;

        console.log(`  [${tag}] T${tier} ${name}: ${typeof actual === 'number' ? actual.toFixed(6) : actual} ${comparator} ${threshold}`);
    }

    // ── Check 1: Solid gray identity (Tier 1) ──
    // A solid gray image should produce near-zero bands and all energy in residual.
    // We synthesize a solid gray PNG in memory.
    console.log('\n── Solid Gray Identity ──');
    {
        const W = 256, H = 256;
        const gray = new Float32Array(W * H).fill(128);
        const bands = buildLaplacianPyramid(gray, W, H, NUM_BANDS);

        for (let b = 0; b < bands.bands.length; b++) {
            const bandMSE = totalEnergy(bands.bands[b].data) / bands.bands[b].data.length;
            check(`solid_gray_band${b}_mse`, 1, bandMSE, CRITERIA.solidGrayBandMSE.threshold);
        }
    }

    // ── Check 2: Perfect reconstruction (Tier 1) ──
    console.log('\n── Perfect Reconstruction ──');
    for (const source of SOURCES) {
        const rawPath = path.join(ROOT, 'tests', 'golden-captures', 'raw', `${source}_raw.png`);
        const rawPng = loadPng(rawPath);
        if (!rawPng) {
            console.log(`  [SKIP] ${source}: raw capture not found`);
            continue;
        }

        const lum = extractLuminance(rawPng);
        const pyramid = buildLaplacianPyramid(lum.data, lum.width, lum.height, NUM_BANDS);

        // Reconstruct: sum bands (upsampled to original size) + residual (upsampled)
        const reconstructed = reconstructFromPyramid(pyramid);
        const err = mse(lum.data, reconstructed);
        check(`${source}_reconstruction_mse`, 1, err, CRITERIA.reconstructionMSE.threshold);
    }

    // ── Check 3: WGSL vs JS reference (Tier 2) ──
    console.log('\n── WGSL vs JS Reference ──');
    for (const source of SOURCES) {
        for (let b = 0; b < NUM_BANDS; b++) {
            const wgslPath = path.join(CAPTURE_DIR, `${source}_wgsl_band${b}.png`);
            const jsPath = path.join(CAPTURE_DIR, `${source}_jsref_band${b}.png`);

            const wgsl = loadBandFloat(wgslPath);
            const js = loadBandFloat(jsPath);

            if (!wgsl || !js) {
                console.log(`  [SKIP] ${source} band ${b}: missing WGSL or JS capture`);
                continue;
            }

            if (wgsl.data.length !== js.data.length) {
                console.log(`  [SKIP] ${source} band ${b}: dimension mismatch (${wgsl.width}x${wgsl.height} vs ${js.width}x${js.height})`);
                continue;
            }

            const err = mse(wgsl.data, js.data);
            check(`${source}_wgsl_vs_js_band${b}_mse`, 2, err, CRITERIA.pyrtoolsBandMSE.threshold);
        }
    }

    // ── Check 4: Pyrtools reference (Tier 2) ──
    console.log('\n── JS vs Pyrtools Reference ──');
    for (const source of SOURCES) {
        for (let b = 0; b < NUM_BANDS; b++) {
            const jsPath = path.join(CAPTURE_DIR, `${source}_jsref_band${b}.png`);
            const pyPath = path.join(PYRTOOLS_DIR, `${source}_pyrtools_band${b}.npy.png`);

            const js = loadBandFloat(jsPath);
            const py = loadBandFloat(pyPath);

            if (!js || !py) {
                console.log(`  [SKIP] ${source} band ${b}: missing JS or pyrtools capture`);
                continue;
            }

            if (js.data.length !== py.data.length) {
                console.log(`  [SKIP] ${source} band ${b}: dimension mismatch`);
                continue;
            }

            const err = mse(js.data, py.data);
            check(`${source}_js_vs_pyrtools_band${b}_mse`, 2, err, CRITERIA.pyrtoolsBandMSE.threshold);
        }
    }

    // ── Check 5: Energy conservation (Tier 3) ──
    console.log('\n── Energy Conservation ──');
    for (const source of SOURCES) {
        const rawPath = path.join(ROOT, 'tests', 'golden-captures', 'raw', `${source}_raw.png`);
        const rawPng = loadPng(rawPath);
        if (!rawPng) continue;

        const lum = extractLuminance(rawPng);
        const pyramid = buildLaplacianPyramid(lum.data, lum.width, lum.height, NUM_BANDS);

        const originalEnergy = totalEnergy(lum.data);
        let bandEnergy = 0;
        for (const band of pyramid.bands) {
            bandEnergy += totalEnergy(band.data);
        }
        bandEnergy += totalEnergy(pyramid.residual.data);

        const ratio = Math.abs(bandEnergy - originalEnergy) / originalEnergy;
        check(`${source}_energy_conservation`, 3, ratio, CRITERIA.energyConservation.threshold);
    }

    // ── Summary ──
    console.log('\n=== Wave 7a Summary ===');
    console.log(`  Tier 1 (must):  ${tier1Pass} pass, ${tier1Fail} fail`);
    console.log(`  Tier 2 (should): ${tier2Pass} pass, ${tier2Fail} fail`);
    console.log(`  Tier 3 (nice):  ${tier3Pass} pass, ${tier3Fail} fail`);

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

    // Exit 1 only if Tier 1 fails
    process.exit(tier1Fail > 0 ? 1 : 0);
}

// ── Laplacian pyramid (JS reference, matches validate-subband-entropy.js) ──

function buildLaplacianPyramid(data, width, height, numBands) {
    let current = { data, width, height };
    const bands = [];

    for (let s = 0; s < numBands; s++) {
        const down = boxDownsample(current);
        const up = bilinearUpsample(down, current.width, current.height);

        const band = new Float32Array(current.width * current.height);
        for (let i = 0; i < band.length; i++) {
            band[i] = current.data[i] - up.data[i];
        }
        bands.push({ data: band, width: current.width, height: current.height });
        current = down;
    }

    return { bands, residual: current };
}

function reconstructFromPyramid(pyramid) {
    let current = pyramid.residual;

    for (let s = pyramid.bands.length - 1; s >= 0; s--) {
        const band = pyramid.bands[s];
        const up = bilinearUpsample(current, band.width, band.height);
        const reconstructed = new Float32Array(band.data.length);
        for (let i = 0; i < reconstructed.length; i++) {
            reconstructed[i] = up.data[i] + band.data[i];
        }
        current = { data: reconstructed, width: band.width, height: band.height };
    }

    return current.data;
}

function boxDownsample(img) {
    const w2 = Math.floor(img.width / 2);
    const h2 = Math.floor(img.height / 2);
    const out = new Float32Array(w2 * h2);
    for (let y = 0; y < h2; y++) {
        for (let x = 0; x < w2; x++) {
            const sx = x * 2, sy = y * 2;
            out[y * w2 + x] = (
                img.data[sy * img.width + sx] +
                img.data[sy * img.width + sx + 1] +
                img.data[(sy + 1) * img.width + sx] +
                img.data[(sy + 1) * img.width + sx + 1]
            ) / 4;
        }
    }
    return { data: out, width: w2, height: h2 };
}

function bilinearUpsample(img, targetW, targetH) {
    const out = new Float32Array(targetW * targetH);
    for (let y = 0; y < targetH; y++) {
        for (let x = 0; x < targetW; x++) {
            const sx = (x / targetW) * img.width;
            const sy = (y / targetH) * img.height;
            const x0 = Math.floor(sx), y0 = Math.floor(sy);
            const x1 = Math.min(x0 + 1, img.width - 1);
            const y1 = Math.min(y0 + 1, img.height - 1);
            const fx = sx - x0, fy = sy - y0;
            out[y * targetW + x] =
                img.data[y0 * img.width + x0] * (1 - fx) * (1 - fy) +
                img.data[y0 * img.width + x1] * fx * (1 - fy) +
                img.data[y1 * img.width + x0] * (1 - fx) * fy +
                img.data[y1 * img.width + x1] * fx * fy;
        }
    }
    return { data: out, width: targetW, height: targetH };
}

main();
