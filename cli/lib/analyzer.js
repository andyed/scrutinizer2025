/**
 * Analyzer — Screenshot buffer → complexity metrics
 *
 * Wraps congestion-core.js + oklab-utils.js to produce the full scoring
 * pipeline: Oklab feature extraction → congestion → edge density → composite score.
 *
 * Input: raw RGBA pixel buffer (from Playwright screenshot PNG or direct buffer).
 * Output: { score, rating, congestion, edgeDensity, computeTimeMs }
 */

const { PNG } = require('pngjs');
const {
    computeLocalVariance,
    normalizeFeature,
    computeStats,
    computeEdgeDensity,
    computeCompositeScore
} = require('../../renderer/congestion-core');
const {
    srgbToLinear,
    linearSrgbToOklab
} = require('../../renderer/oklab-utils');

// Default analysis resolution — matches congestion-worker.js
const DEFAULT_MAX_DIM = 1024;
const BASE_SIGMA = 2.5;
const BASE_DIM = 256;

/**
 * Bilinear downscale to fit within maxDim.
 * Matches extract-congestion.js and saliency-worker behavior.
 */
function downscale(pixels, srcW, srcH, maxDim) {
    const maxSrc = Math.max(srcW, srcH);
    if (maxSrc <= maxDim) {
        return { width: srcW, height: srcH, pixels };
    }

    const scale = maxDim / maxSrc;
    const dstW = Math.floor(srcW * scale);
    const dstH = Math.floor(srcH * scale);
    const out = Buffer.alloc(dstW * dstH * 4);

    for (let dy = 0; dy < dstH; dy++) {
        for (let dx = 0; dx < dstW; dx++) {
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
                const tl = pixels[(y0 * srcW + x0) * 4 + c];
                const tr = pixels[(y0 * srcW + x1) * 4 + c];
                const bl = pixels[(y1 * srcW + x0) * 4 + c];
                const br = pixels[(y1 * srcW + x1) * 4 + c];

                const top = tl + (tr - tl) * fx;
                const bot = bl + (br - bl) * fx;
                out[dstIdx + c] = Math.round(top + (bot - top) * fy);
            }
        }
    }

    return { width: dstW, height: dstH, pixels: out };
}

/**
 * Run full congestion + edge density + composite score pipeline on raw pixels.
 *
 * @param {Buffer|Uint8Array} pixels - RGBA pixel data
 * @param {number} srcWidth - Source image width
 * @param {number} srcHeight - Source image height
 * @param {{ maxDim?: number }} [opts]
 * @returns {{ score, rating, congestion, edgeDensity, width, height, computeTimeMs }}
 */
function analyzePixels(pixels, srcWidth, srcHeight, opts = {}) {
    const t0 = Date.now();
    const maxDim = opts.maxDim || DEFAULT_MAX_DIM;

    // Downscale if needed
    const img = downscale(pixels, srcWidth, srcHeight, maxDim);
    const { width, height } = img;
    const len = width * height;

    // Scale sigma proportionally to resolution
    const effectiveDim = Math.max(width, height);
    const sigma = BASE_SIGMA * (effectiveDim / BASE_DIM);

    // Extract Oklab channels
    const I = new Float32Array(len);
    const RG = new Float32Array(len);
    const BY = new Float32Array(len);

    for (let i = 0; i < len; i++) {
        const rLin = srgbToLinear(img.pixels[i * 4] / 255.0);
        const gLin = srgbToLinear(img.pixels[i * 4 + 1] / 255.0);
        const bLin = srgbToLinear(img.pixels[i * 4 + 2] / 255.0);

        const lab = linearSrgbToOklab(rLin, gLin, bLin);
        I[i] = lab.L;
        RG[i] = Math.abs(lab.a);
        BY[i] = Math.abs(lab.b);
    }

    // Feature congestion (Rosenholtz 2007)
    const var_I = computeLocalVariance(I, width, height, sigma);
    const var_RG = computeLocalVariance(RG, width, height, sigma);
    const var_BY = computeLocalVariance(BY, width, height, sigma);

    const congestion = new Float32Array(len);
    for (let i = 0; i < len; i++) {
        congestion[i] = var_I[i] + var_RG[i] + var_BY[i];
    }
    const normCongestion = normalizeFeature(congestion);

    // Edge density (Sobel + Gaussian blur σ=3.0)
    const rawEdge = computeEdgeDensity(I, width, height, 3.0);
    const normEdge = normalizeFeature(rawEdge);

    // Stats
    const congestionStats = computeStats(normCongestion, width, height);
    const edgeDensityStats = computeStats(normEdge, width, height);

    // Composite score
    const { score, rating } = computeCompositeScore(congestionStats, edgeDensityStats);

    return {
        score,
        rating: rating.label,
        congestion: congestionStats,
        edgeDensity: edgeDensityStats,
        width,
        height,
        computeTimeMs: Date.now() - t0,
        // Raw maps (for heatmap export)
        _congestionMap: normCongestion,
        _edgeDensityMap: normEdge
    };
}

/**
 * Analyze a PNG buffer (as returned by Playwright screenshot).
 *
 * @param {Buffer} pngBuffer - PNG file contents
 * @param {{ maxDim?: number }} [opts]
 * @returns {Promise<object>} Analysis results
 */
function analyzePng(pngBuffer, opts = {}) {
    const png = PNG.sync.read(pngBuffer);
    return analyzePixels(png.data, png.width, png.height, opts);
}

/**
 * Save a float32 map as a grayscale PNG.
 */
function saveHeatmapPng(data, width, height) {
    const png = new PNG({ width, height });
    for (let i = 0; i < width * height; i++) {
        const v = Math.round(Math.max(0, Math.min(1, data[i])) * 255);
        png.data[i * 4] = v;
        png.data[i * 4 + 1] = v;
        png.data[i * 4 + 2] = v;
        png.data[i * 4 + 3] = 255;
    }
    return PNG.sync.write(png);
}

module.exports = { analyzePixels, analyzePng, saveHeatmapPng, downscale };
