#!/usr/bin/env node
/**
 * extract-congestion.js — Headless Scrutinizer congestion computation
 *
 * Runs the exact same congestion-core.js code path used by the real-time
 * saliency worker, but in Node.js against static PNG/JPG images.
 *
 * Usage:
 *   node scripts/extract-congestion.js [--input-dir=path] [--output-dir=path]
 *
 * Defaults:
 *   --input-dir  tests/validation/rosenholtz-maps/ + tests/reference-pages/screenshots/
 *   --output-dir tests/validation/results/
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// congestion-core.js: shared pure-math module
const {
    gaussianBlur,
    computeLocalVariance,
    normalizeFeature,
    computeStats,
    computeEdgeDensity,
    computeCompositeScore
} = require('../renderer/congestion-core');

// oklab-utils.js: color conversion
const {
    srgbToLinear,
    linearSrgbToOklab
} = require('../renderer/oklab-utils');

// ── CLI args ─────────────────────────────────────────────────────────────

function getArg(prefix) {
    const arg = process.argv.find(a => a.startsWith(prefix));
    return arg ? arg.split('=')[1] : undefined;
}

const ROOT = path.join(__dirname, '..');
const ROSENHOLTZ_DIR = getArg('--input-dir') || path.join(ROOT, 'tests', 'validation', 'rosenholtz-maps');
const SCREENSHOT_DIR = path.join(ROOT, 'tests', 'reference-pages', 'screenshots');
const OUTPUT_DIR = getArg('--output-dir') || path.join(ROOT, 'tests', 'validation', 'results');
const MAP_DIR = path.join(OUTPUT_DIR, 'scrutinizer_maps');

// Validation runs at higher res than the real-time worker (256px).
// 256px destroys webpage structure — text becomes blobs, fine UI merges.
// Default 0 = no downscale (full resolution, matching Python reference).
// The sigma scales proportionally so the spatial neighborhood stays constant.
const MAX_DIM = parseInt(getArg('--max-dim')) || 0;
const FIXED_SIGMA = parseFloat(getArg('--sigma')) || 0; // 0 = auto-scale
const BASE_SIGMA = 2.5;   // σ at 256px in the real-time worker
const BASE_DIM = 256;     // reference dimension for sigma scaling

// ── Image loading ────────────────────────────────────────────────────────

function loadPng(filePath) {
    const data = fs.readFileSync(filePath);
    return PNG.sync.read(data);
}

/**
 * Bilinear downscale to fit within maxDim, matching saliency-worker behavior.
 * Returns { width, height, pixels: Uint8Array(w*h*4) }
 */
function downscale(png, maxDim) {
    const srcW = png.width;
    const srcH = png.height;
    const maxSrc = Math.max(srcW, srcH);

    if (maxSrc <= maxDim) {
        return { width: srcW, height: srcH, pixels: png.data };
    }

    const scale = maxDim / maxSrc;
    const dstW = Math.floor(srcW * scale);
    const dstH = Math.floor(srcH * scale);
    const out = Buffer.alloc(dstW * dstH * 4);

    for (let dy = 0; dy < dstH; dy++) {
        for (let dx = 0; dx < dstW; dx++) {
            // Map destination pixel center to source coordinates
            const sx = (dx + 0.5) / scale - 0.5;
            const sy = (dy + 0.5) / scale - 0.5;

            const x0 = Math.max(0, Math.floor(sx));
            const y0 = Math.max(0, Math.floor(sy));
            const x1 = Math.min(srcW - 1, x0 + 1);
            const y1 = Math.min(srcH - 1, y0 + 1);

            const fx = sx - x0;
            const fy = sy - y0;

            const dstIdx = (dy * dstW + dx) * 4;

            for (let c = 0; c < 4; c++) {
                const tl = png.data[(y0 * srcW + x0) * 4 + c];
                const tr = png.data[(y0 * srcW + x1) * 4 + c];
                const bl = png.data[(y1 * srcW + x0) * 4 + c];
                const br = png.data[(y1 * srcW + x1) * 4 + c];

                const top = tl + (tr - tl) * fx;
                const bot = bl + (br - bl) * fx;
                out[dstIdx + c] = Math.round(top + (bot - top) * fy);
            }
        }
    }

    return { width: dstW, height: dstH, pixels: out };
}

// ── Congestion computation (mirrors saliency-worker.js onmessage) ────────

function computeCongestion(img, sigma) {
    const { width, height, pixels } = img;
    const len = width * height;

    // Extract Oklab features
    const I = new Float32Array(len);
    const RG = new Float32Array(len);
    const BY = new Float32Array(len);

    for (let i = 0; i < len; i++) {
        const rLin = srgbToLinear(pixels[i * 4] / 255.0);
        const gLin = srgbToLinear(pixels[i * 4 + 1] / 255.0);
        const bLin = srgbToLinear(pixels[i * 4 + 2] / 255.0);

        const lab = linearSrgbToOklab(rLin, gLin, bLin);
        I[i] = lab.L;
        RG[i] = Math.abs(lab.a);
        BY[i] = Math.abs(lab.b);
    }
    const var_I = computeLocalVariance(I, width, height, sigma);
    const var_RG = computeLocalVariance(RG, width, height, sigma);
    const var_BY = computeLocalVariance(BY, width, height, sigma);

    // Sum variances → raw congestion
    const congestion = new Float32Array(len);
    for (let i = 0; i < len; i++) {
        congestion[i] = var_I[i] + var_RG[i] + var_BY[i];
    }

    // Normalize to [0,1]
    const normCongestion = normalizeFeature(congestion);

    // Edge density (Sobel + blur at σ=3.0) on luminance channel
    const rawEdge = computeEdgeDensity(I, width, height, 3.0);
    const normEdge = normalizeFeature(rawEdge);

    // Stats
    const congestionStats = computeStats(normCongestion, width, height);
    const edgeDensityStats = computeStats(normEdge, width, height);

    // Composite score (matching ComplexityHUD formula)
    const { score, rating } = computeCompositeScore(congestionStats, edgeDensityStats);

    return {
        congestion: normCongestion,
        edgeDensity: normEdge,
        congestionStats,
        edgeDensityStats,
        score,
        rating,
        width,
        height
    };
}

// ── Save heatmap as grayscale PNG ────────────────────────────────────────

function saveHeatmap(data, width, height, filePath) {
    const png = new PNG({ width, height });
    for (let i = 0; i < width * height; i++) {
        const v = Math.round(Math.max(0, Math.min(1, data[i])) * 255);
        png.data[i * 4] = v;
        png.data[i * 4 + 1] = v;
        png.data[i * 4 + 2] = v;
        png.data[i * 4 + 3] = 255;
    }
    fs.writeFileSync(filePath, PNG.sync.write(png));
}

// ── Main ─────────────────────────────────────────────────────────────────

function collectImages() {
    const images = [];

    // Rosenholtz benchmark maps
    if (fs.existsSync(ROSENHOLTZ_DIR)) {
        const files = fs.readdirSync(ROSENHOLTZ_DIR).filter(f => f.endsWith('.png'));
        for (const f of files) {
            images.push({ path: path.join(ROSENHOLTZ_DIR, f), name: f, source: 'rosenholtz' });
        }
    }

    // Reference page screenshots
    if (fs.existsSync(SCREENSHOT_DIR)) {
        const files = fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png'));
        for (const f of files) {
            images.push({ path: path.join(SCREENSHOT_DIR, f), name: f, source: 'reference-page' });
        }
    }

    return images;
}

function main() {
    const images = collectImages();

    if (images.length === 0) {
        console.error('No images found. Run validate:download and/or capture reference screenshots first.');
        process.exit(1);
    }

    // Ensure output directories exist
    for (const dir of [OUTPUT_DIR, MAP_DIR]) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    const results = [];

    console.log(`Processing ${images.length} images at ${MAX_DIM > 0 ? MAX_DIM + 'px max' : 'full resolution'}...`);

    for (const img of images) {
        process.stdout.write(`  ${img.name} ... `);

        try {
            const png = loadPng(img.path);
            const scaled = MAX_DIM > 0 ? downscale(png, MAX_DIM) : { width: png.width, height: png.height, pixels: png.data };

            // Scale sigma proportionally to resolution so the spatial neighborhood
            // covers the same fraction of the image. At 256px, σ=2.5 covers ~15px.
            // --sigma=N overrides to a fixed value (useful for isolating resolution effects).
            const effectiveDim = Math.max(scaled.width, scaled.height);
            const sigma = FIXED_SIGMA > 0 ? FIXED_SIGMA : BASE_SIGMA * (effectiveDim / BASE_DIM);

            const result = computeCongestion(scaled, sigma);
            const { congestion, edgeDensity, congestionStats, edgeDensityStats, score, rating, width, height } = result;

            // Save heatmaps
            const congMapName = img.name.replace(/\.\w+$/, '_congestion.png');
            saveHeatmap(congestion, width, height, path.join(MAP_DIR, congMapName));
            const edgeMapName = img.name.replace(/\.\w+$/, '_edgedensity.png');
            saveHeatmap(edgeDensity, width, height, path.join(MAP_DIR, edgeMapName));

            results.push({
                name: img.name,
                source: img.source,
                width,
                height,
                sigma: sigma,
                score,
                rating: rating.label,
                congestion: {
                    mean: congestionStats.mean,
                    p90: congestionStats.p90,
                    p10: congestionStats.p10,
                    max: congestionStats.max,
                    quadrants: congestionStats.quadrants
                },
                edgeDensity: {
                    mean: edgeDensityStats.mean,
                    p90: edgeDensityStats.p90,
                    p10: edgeDensityStats.p10,
                    max: edgeDensityStats.max,
                    quadrants: edgeDensityStats.quadrants
                },
                congestionMapFile: congMapName,
                edgeDensityMapFile: edgeMapName
            });

            console.log(`${width}x${height} σ=${sigma.toFixed(1)} score=${score} (${rating.label}) congestion_p90=${congestionStats.p90.toFixed(4)} edge_p90=${edgeDensityStats.p90.toFixed(4)}`);
        } catch (err) {
            console.log(`ERROR: ${err.message}`);
            results.push({ name: img.name, source: img.source, error: err.message });
        }
    }

    // Write results JSON
    const outputPath = path.join(OUTPUT_DIR, 'scrutinizer_results.json');
    fs.writeFileSync(outputPath, JSON.stringify({
        generator: 'extract-congestion.js',
        timestamp: new Date().toISOString(),
        params: { maxDim: MAX_DIM || 'full', baseSigma: BASE_SIGMA, baseDim: BASE_DIM, colorSpace: 'Oklab' },
        images: results
    }, null, 2));

    console.log(`\nResults written to ${outputPath}`);
    console.log(`Heatmaps written to ${MAP_DIR}/`);
}

main();
