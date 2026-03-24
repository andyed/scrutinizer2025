#!/usr/bin/env node
/**
 * compare-congestion.js — Compare Scrutinizer vs Rosenholtz FC results
 *
 * Reads JSON output from both extract-congestion.js and validate-congestion.py,
 * computes Spearman rank correlation and per-pixel SSIM between heatmaps.
 *
 * Usage:
 *   node scripts/compare-congestion.js
 *
 * Output:
 *   tests/validation/results/comparison_report.json
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

function getArg(prefix) {
    const arg = process.argv.find(a => a.startsWith(prefix));
    return arg ? arg.split('=')[1] : undefined;
}

const ROOT = path.join(__dirname, '..');
const PYTHON_DIR = path.join(ROOT, 'tests', 'validation', 'results');
const SC_DIR = getArg('--scrutinizer-dir')
    ? path.resolve(ROOT, getArg('--scrutinizer-dir'))
    : PYTHON_DIR;

const SCRUTINIZER_JSON = path.join(SC_DIR, 'scrutinizer_results.json');
const PYTHON_JSON = path.join(PYTHON_DIR, 'python_results.json');
const SCRUTINIZER_MAPS = path.join(SC_DIR, 'scrutinizer_maps');
const PYTHON_MAPS = path.join(PYTHON_DIR, 'python_maps');
const REPORT_PATH = path.join(SC_DIR, 'comparison_report.json');


// ── Spearman rank correlation ────────────────────────────────────────────

/**
 * Compute ranks with average tie-breaking.
 * @param {number[]} values
 * @returns {number[]} Fractional ranks (1-based)
 */
function computeRanks(values) {
    const n = values.length;
    const indexed = values.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);

    const ranks = new Array(n);
    let i = 0;
    while (i < n) {
        let j = i;
        // Find group of tied values
        while (j < n && indexed[j].v === indexed[i].v) j++;
        // Average rank for ties
        const avgRank = (i + j + 1) / 2; // 1-based
        for (let k = i; k < j; k++) {
            ranks[indexed[k].i] = avgRank;
        }
        i = j;
    }
    return ranks;
}

/**
 * Spearman rank correlation coefficient.
 * rho = 1 - (6 * Σd²) / (n * (n² - 1))
 */
function spearmanRho(x, y) {
    if (x.length !== y.length || x.length < 3) return NaN;

    const n = x.length;
    const rankX = computeRanks(x);
    const rankY = computeRanks(y);

    let sumD2 = 0;
    for (let i = 0; i < n; i++) {
        const d = rankX[i] - rankY[i];
        sumD2 += d * d;
    }

    return 1 - (6 * sumD2) / (n * (n * n - 1));
}


// ── SSIM (adapted from golden-compare.js) ────────────────────────────────

function loadGrayscalePng(filePath) {
    const data = fs.readFileSync(filePath);
    const png = PNG.sync.read(data);
    const out = new Float64Array(png.width * png.height);
    for (let i = 0; i < png.width * png.height; i++) {
        // Grayscale: just take R channel (all channels are equal)
        out[i] = png.data[i * 4];
    }
    return { pixels: out, width: png.width, height: png.height };
}

/**
 * Bilinear downscale a grayscale image to target dimensions.
 */
function resizeGrayscale(src, targetW, targetH) {
    const out = new Float64Array(targetW * targetH);
    const scaleX = src.width / targetW;
    const scaleY = src.height / targetH;

    for (let dy = 0; dy < targetH; dy++) {
        for (let dx = 0; dx < targetW; dx++) {
            const sx = (dx + 0.5) * scaleX - 0.5;
            const sy = (dy + 0.5) * scaleY - 0.5;

            const x0 = Math.max(0, Math.floor(sx));
            const y0 = Math.max(0, Math.floor(sy));
            const x1 = Math.min(src.width - 1, x0 + 1);
            const y1 = Math.min(src.height - 1, y0 + 1);

            const fx = sx - x0;
            const fy = sy - y0;

            const tl = src.pixels[y0 * src.width + x0];
            const tr = src.pixels[y0 * src.width + x1];
            const bl = src.pixels[y1 * src.width + x0];
            const br = src.pixels[y1 * src.width + x1];

            const top = tl + (tr - tl) * fx;
            const bot = bl + (br - bl) * fx;
            out[dy * targetW + dx] = top + (bot - top) * fy;
        }
    }

    return { pixels: out, width: targetW, height: targetH };
}

/**
 * Compute SSIM between two grayscale images.
 * If dimensions differ, resizes the larger image to match the smaller.
 */
function computeSSIM(a, b) {
    // Resize to match if dimensions differ
    if (a.width !== b.width || a.height !== b.height) {
        const targetW = Math.min(a.width, b.width);
        const targetH = Math.min(a.height, b.height);
        if (a.width !== targetW || a.height !== targetH) {
            a = resizeGrayscale(a, targetW, targetH);
        }
        if (b.width !== targetW || b.height !== targetH) {
            b = resizeGrayscale(b, targetW, targetH);
        }
    }

    const n = a.pixels.length;
    const muA = a.pixels.reduce((s, v) => s + v, 0) / n;
    const muB = b.pixels.reduce((s, v) => s + v, 0) / n;

    let varA = 0, varB = 0, cov = 0;
    for (let i = 0; i < n; i++) {
        const da = a.pixels[i] - muA;
        const db = b.pixels[i] - muB;
        varA += da * da;
        varB += db * db;
        cov += da * db;
    }
    varA /= n;
    varB /= n;
    cov /= n;

    const c1 = (0.01 * 255) ** 2;
    const c2 = (0.03 * 255) ** 2;

    return ((2 * muA * muB + c1) * (2 * cov + c2)) /
           ((muA * muA + muB * muB + c1) * (varA + varB + c2));
}


// ── Main ─────────────────────────────────────────────────────────────────

function main() {
    // Load results
    if (!fs.existsSync(SCRUTINIZER_JSON)) {
        console.error(`Missing: ${SCRUTINIZER_JSON}\nRun: npm run validate:scrutinizer`);
        process.exit(1);
    }
    if (!fs.existsSync(PYTHON_JSON)) {
        console.error(`Missing: ${PYTHON_JSON}\nRun: npm run validate:python`);
        process.exit(1);
    }

    const scrutinizerData = JSON.parse(fs.readFileSync(SCRUTINIZER_JSON, 'utf8'));
    const pythonData = JSON.parse(fs.readFileSync(PYTHON_JSON, 'utf8'));

    // Index by image name
    const pyByName = {};
    for (const img of pythonData.images) {
        if (!img.error) pyByName[img.name] = img;
    }

    const scByName = {};
    for (const img of scrutinizerData.images) {
        if (!img.error) scByName[img.name] = img;
    }

    // Find matching images (present in both result sets without errors)
    const commonNames = Object.keys(pyByName).filter(n => scByName[n]);

    if (commonNames.length === 0) {
        console.error('No common images found between Python and Scrutinizer results.');
        process.exit(1);
    }

    console.log(`Comparing ${commonNames.length} images...\n`);

    // ── Per-image comparison ──

    const pyScalars = [];
    const scMeans = [];
    const comparisons = [];

    for (const name of commonNames) {
        const py = pyByName[name];
        const sc = scByName[name];

        pyScalars.push(py.scalar);
        // Scrutinizer results may nest congestion stats under .congestion or at top level
        const scMean = sc.mean ?? sc.congestion?.mean;
        const scP90 = sc.p90 ?? sc.congestion?.p90;
        scMeans.push(scMean);

        const entry = {
            name,
            source: py.source,
            python: { scalar: py.scalar, mean: py.mean, p90: py.p90 },
            scrutinizer: { mean: scMean, p90: scP90 },
        };

        // Try heatmap SSIM
        const pyMapFile = py.mapFile || py.congestionMapFile;
        const scMapFile = sc.mapFile || sc.congestionMapFile;
        const pyMapPath = pyMapFile ? path.join(PYTHON_MAPS, pyMapFile) : null;
        const scMapPath = scMapFile ? path.join(SCRUTINIZER_MAPS, scMapFile) : null;

        if (pyMapPath && scMapPath && fs.existsSync(pyMapPath) && fs.existsSync(scMapPath)) {
            try {
                const pyMap = loadGrayscalePng(pyMapPath);
                const scMap = loadGrayscalePng(scMapPath);
                const ssim = computeSSIM(pyMap, scMap);
                if (ssim !== null) {
                    entry.ssim = ssim;
                } else {
                    entry.ssim = null;
                    entry.ssimNote = `Size mismatch: python=${pyMap.width}x${pyMap.height} scrutinizer=${scMap.width}x${scMap.height}`;
                }
            } catch (err) {
                entry.ssim = null;
                entry.ssimNote = err.message;
            }
        } else {
            entry.ssim = null;
            entry.ssimNote = 'Heatmap file missing';
        }

        comparisons.push(entry);
    }

    // ── Rank correlation ──

    const rho = spearmanRho(pyScalars, scMeans);

    if (isNaN(rho)) {
        console.log(`Note: Spearman requires ≥3 images (have ${commonNames.length}). Add more test images.`);
    }

    // ── Rank table for display ──

    const pyRanks = computeRanks(pyScalars);
    const scRanks = computeRanks(scMeans);

    for (let i = 0; i < comparisons.length; i++) {
        comparisons[i].pythonRank = pyRanks[i];
        comparisons[i].scrutinizerRank = scRanks[i];
        comparisons[i].rankDelta = Math.abs(pyRanks[i] - scRanks[i]);
    }

    // Sort by python scalar (ascending = least cluttered first)
    comparisons.sort((a, b) => a.python.scalar - b.python.scalar);

    // ── Report ──

    const avgSSIM = comparisons
        .filter(c => c.ssim !== null)
        .reduce((s, c, _, a) => s + c.ssim / a.length, 0);

    const report = {
        timestamp: new Date().toISOString(),
        numImages: commonNames.length,
        spearmanRho: rho,
        spearmanPass: rho >= 0.70,
        averageSSIM: avgSSIM || null,
        params: {
            python: pythonData.params,
            scrutinizer: scrutinizerData.params,
        },
        comparisons,
    };

    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

    // ── Console summary ──

    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log('│            Feature Congestion Validation Report             │');
    console.log('├─────────────────────────────────────────────────────────────┤');
    console.log(`│  Images compared:  ${commonNames.length.toString().padStart(4)}`);
    console.log(`│  Spearman rho:     ${rho.toFixed(4).padStart(8)}  ${rho >= 0.70 ? '✓ PASS (≥0.70)' : '✗ FAIL (<0.70)'}`);
    if (avgSSIM) {
        console.log(`│  Average SSIM:     ${avgSSIM.toFixed(4).padStart(8)}`);
    }
    console.log('├─────────────────────────────────────────────────────────────┤');
    console.log('│  Image                      Py.FC   Sc.Mean  Rank Δ  SSIM  │');
    console.log('├─────────────────────────────────────────────────────────────┤');

    for (const c of comparisons) {
        const name = c.name.substring(0, 26).padEnd(26);
        const pyVal = c.python.scalar.toFixed(3).padStart(7);
        const scVal = c.scrutinizer.mean.toFixed(3).padStart(7);
        const delta = c.rankDelta.toFixed(0).padStart(5);
        const ssim = c.ssim !== null ? c.ssim.toFixed(3).padStart(6) : '   N/A';
        console.log(`│  ${name} ${pyVal} ${scVal}  ${delta} ${ssim}  │`);
    }

    console.log('└─────────────────────────────────────────────────────────────┘');
    console.log(`\nReport written to ${REPORT_PATH}`);

    // Exit code reflects pass/fail
    process.exit(rho >= 0.70 ? 0 : 1);
}

main();
