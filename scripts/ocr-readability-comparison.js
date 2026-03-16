#!/usr/bin/env node
/**
 * OCR Readability Comparison — mode 0 vs mode 12
 *
 * Crops horizontal strips at different eccentricities from captured PNGs,
 * runs Tesseract OCR on each strip, and compares word recognition rates.
 * This quantifies whether mode 12 (isotropic cortical sampling) preserves
 * too much readability compared to mode 0 (smoothstep baseline).
 *
 * Usage:
 *   node scripts/ocr-readability-comparison.js
 *   node scripts/ocr-readability-comparison.js --capture   # re-capture first
 *   node scripts/ocr-readability-comparison.js --verbose
 */

const path = require('path');
const fs = require('fs');
const { PNG } = require('pngjs');
const { execSync } = require('child_process');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const COMPARISON_DIR = path.join(ROOT, 'docs', 'golden', 'isotropic-comparison');
const REPORT_DIR = path.join(ROOT, 'tests', 'validation', 'reports');
const verbose = process.argv.includes('--verbose');

// Use article captures — text-heavy, best for OCR
const MODES = [
    { id: 'mode0_smoothstep', label: 'Mode 0 (Smoothstep)' },
    { id: 'mode12_isotropic', label: 'Mode 12 (FOVI Isotropic)' },
    { id: 'mode8_polar', label: 'Mode 8 (Polar Quantize)' },
];

// Eccentricity rings (horizontal strips centered on fixation)
// At 1920x1080 with center fixation (960, 540), 45px fovea radius
const FOVEA_PX = 45;  // fovea radius in CSS px (retina doubles)
const CENTER_X = 960;
const CENTER_Y = 540;

// Ring definitions: inner/outer radius in fovea units, strip height
const RINGS = [
    { label: 'fovea (0-1°)', innerMult: 0, outerMult: 1.0, eccentricity: 0.5 },
    { label: 'parafovea (1-2.5°)', innerMult: 1.0, outerMult: 2.5, eccentricity: 1.75 },
    { label: 'near-periph (2.5-5°)', innerMult: 2.5, outerMult: 5.0, eccentricity: 3.75 },
    { label: 'mid-periph (5-8°)', innerMult: 5.0, outerMult: 8.0, eccentricity: 6.5 },
    { label: 'far-periph (8-12°)', innerMult: 8.0, outerMult: 12.0, eccentricity: 10.0 },
];

function loadPNG(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return PNG.sync.read(fs.readFileSync(filePath));
}

/**
 * Crop a horizontal strip from a PNG at the given vertical offset range.
 * Uses the right side of fixation (more text in English layouts).
 */
function cropRing(png, innerPx, outerPx, dpr) {
    const cx = CENTER_X * dpr;
    const cy = CENTER_Y * dpr;

    // Horizontal strip to the right of fixation
    const x0 = Math.max(0, cx + innerPx * dpr);
    const x1 = Math.min(png.width, cx + outerPx * dpr);
    const stripHeight = Math.min(200 * dpr, (outerPx - innerPx) * dpr);
    const y0 = Math.max(0, cy - Math.floor(stripHeight / 2));
    const y1 = Math.min(png.height, y0 + stripHeight);

    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return null;

    const crop = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const srcIdx = ((y0 + y) * png.width + (x0 + x)) * 4;
            const dstIdx = (y * w + x) * 4;
            crop.data[dstIdx] = png.data[srcIdx];
            crop.data[dstIdx + 1] = png.data[srcIdx + 1];
            crop.data[dstIdx + 2] = png.data[srcIdx + 2];
            crop.data[dstIdx + 3] = png.data[srcIdx + 3];
        }
    }
    return crop;
}

function runOCR(pngData, label) {
    const tmpDir = path.join(os.tmpdir(), 'scrutinizer-ocr');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, `${label}.png`);
    fs.writeFileSync(tmpFile, PNG.sync.write(pngData));

    try {
        const result = execSync(
            `tesseract "${tmpFile}" stdout --psm 6 -l eng 2>/dev/null`,
            { encoding: 'utf-8', timeout: 10000 }
        );
        const words = result.trim().split(/\s+/).filter(w => w.length > 2);
        return words;
    } catch (e) {
        if (verbose) console.log(`    OCR failed for ${label}: ${e.message}`);
        return [];
    }
}

function main() {
    console.log('# OCR Readability Comparison: Mode 0 vs Mode 12 vs Mode 8\n');

    // Detect DPR from image dimensions
    const samplePath = path.join(COMPARISON_DIR, 'article_center_mode0_smoothstep.png');
    const samplePng = loadPNG(samplePath);
    if (!samplePng) {
        console.error(`Missing: ${samplePath}`);
        console.error('Run: node scripts/capture-isotropic-comparison.js --force');
        process.exit(1);
    }
    const dpr = samplePng.width / 1920;
    console.log(`Image: ${samplePng.width}x${samplePng.height}, DPR=${dpr}\n`);

    const results = {};

    for (const mode of MODES) {
        const imgPath = path.join(COMPARISON_DIR, `article_center_${mode.id}.png`);
        const png = loadPNG(imgPath);
        if (!png) {
            console.error(`Missing: ${imgPath}`);
            continue;
        }

        results[mode.id] = [];

        for (const ring of RINGS) {
            const innerPx = ring.innerMult * FOVEA_PX;
            const outerPx = ring.outerMult * FOVEA_PX;
            const crop = cropRing(png, innerPx, outerPx, dpr);

            if (!crop) {
                results[mode.id].push({ ring: ring.label, words: 0, ecc: ring.eccentricity });
                continue;
            }

            const words = runOCR(crop, `${mode.id}_${ring.label.replace(/[^a-z0-9]/gi, '_')}`);
            results[mode.id].push({
                ring: ring.label,
                words: words.length,
                ecc: ring.eccentricity,
                sample: words.slice(0, 5).join(', ')
            });

            if (verbose) {
                console.log(`  ${mode.label} @ ${ring.label}: ${words.length} words [${words.slice(0, 8).join(', ')}]`);
            }
        }
    }

    // Report
    console.log('## Results\n');
    console.log('| Eccentricity | Mode 0 (words) | Mode 12 (words) | Mode 8 (words) | M12 vs M0 |');
    console.log('|-------------|----------------|-----------------|----------------|-----------|');

    for (let i = 0; i < RINGS.length; i++) {
        const m0 = results.mode0_smoothstep?.[i];
        const m12 = results.mode12_isotropic?.[i];
        const m8 = results.mode8_polar?.[i];

        const ratio = m0 && m0.words > 0
            ? ((m12?.words || 0) / m0.words * 100).toFixed(0) + '%'
            : 'N/A';

        console.log(`| ${RINGS[i].label} | ${m0?.words || 0} | ${m12?.words || 0} | ${m8?.words || 0} | ${ratio} |`);
    }

    // Validation check
    console.log('\n## Validation\n');
    const m0_total = results.mode0_smoothstep?.reduce((s, r) => s + r.words, 0) || 0;
    const m12_total = results.mode12_isotropic?.reduce((s, r) => s + r.words, 0) || 0;
    const m8_total = results.mode8_polar?.reduce((s, r) => s + r.words, 0) || 0;

    console.log(`Total words recognized: Mode 0=${m0_total}, Mode 12=${m12_total}, Mode 8=${m8_total}`);

    if (m0_total > 0) {
        const m12_ratio = m12_total / m0_total;
        console.log(`\nMode 12 / Mode 0 ratio: ${m12_ratio.toFixed(2)}`);

        if (m12_ratio > 1.2) {
            console.log('⚠️  CONCERN: Mode 12 preserves >20% more readable text than Mode 0');
            console.log('   Sector-derivative pooling may not be producing enough degradation.');
        } else if (m12_ratio > 0.8 && m12_ratio < 1.2) {
            console.log('✅ Mode 12 readability is within 20% of Mode 0 (comparable degradation)');
        } else {
            console.log('✅ Mode 12 produces more degradation than Mode 0');
        }

        // Per-ring comparison — near periphery is the critical region
        const parafovea_m0 = results.mode0_smoothstep?.[1]?.words || 0;
        const parafovea_m12 = results.mode12_isotropic?.[1]?.words || 0;
        if (parafovea_m0 > 0 && parafovea_m12 > parafovea_m0 * 1.3) {
            console.log(`\n⚠️  PARAFOVEA: Mode 12 (${parafovea_m12} words) vs Mode 0 (${parafovea_m0} words)`);
            console.log('   Sector derivatives not pooling enough in the parafoveal region.');
        }
    }
}

main();
