/**
 * Congestion Core — Pure-math functions for Feature Congestion computation
 *
 * Extracted from saliency-worker.js so both the real-time Web Worker and
 * headless Node.js validation scripts share the exact same code path.
 *
 * Implements a simplified Rosenholtz et al. (2007) Feature Congestion:
 *   - Oklab color space (L, |a|, |b|) instead of CIE L*a*b*
 *   - Single Gaussian local-variance (σ=2.5) instead of multi-scale steerable pyramid
 *   - Sum of per-channel variance instead of covariance ellipsoid volume
 *
 * Dual export: Node.js (module.exports) + Web Worker (Object.assign(self, ...))
 */

// ── Gaussian Kernel & Blur ──────────────────────────────────────────────

/**
 * Generate 1D Gaussian kernel
 * @param {number} sigma - Standard deviation
 * @returns {Float32Array} Normalized kernel
 */
function generateGaussianKernel(sigma) {
    // Kernel size: 6σ (covers 99.7% of distribution)
    const radius = Math.ceil(sigma * 3);
    const size = radius * 2 + 1;
    const kernel = new Float32Array(size);

    let sum = 0;
    for (let i = 0; i < size; i++) {
        const x = i - radius;
        kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
        sum += kernel[i];
    }

    // Normalize
    for (let i = 0; i < size; i++) {
        kernel[i] /= sum;
    }

    return kernel;
}

/**
 * Horizontal blur pass (separable)
 */
function blurHorizontal(src, dst, width, height, kernel) {
    const radius = Math.floor(kernel.length / 2);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let sum = 0;

            for (let k = 0; k < kernel.length; k++) {
                const sx = x + k - radius;
                // Clamp to edges
                const cx = Math.max(0, Math.min(width - 1, sx));
                sum += src[y * width + cx] * kernel[k];
            }

            dst[y * width + x] = sum;
        }
    }
}

/**
 * Vertical blur pass (separable)
 */
function blurVertical(src, dst, width, height, kernel) {
    const radius = Math.floor(kernel.length / 2);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let sum = 0;

            for (let k = 0; k < kernel.length; k++) {
                const sy = y + k - radius;
                // Clamp to edges
                const cy = Math.max(0, Math.min(height - 1, sy));
                sum += src[cy * width + x] * kernel[k];
            }

            dst[y * width + x] = sum;
        }
    }
}

/**
 * Apply separable Gaussian blur
 * Allocates fresh temp buffers each call (no shared state).
 * The saliency-worker wraps this with cached buffers for frame-rate perf.
 *
 * @param {Float32Array} data - Input channel (width × height)
 * @param {number} width
 * @param {number} height
 * @param {number} sigma
 * @param {Float32Array} [tmpA] - Optional pre-allocated temp buffer
 * @param {Float32Array} [tmpB] - Optional pre-allocated temp buffer
 * @returns {Float32Array} Blurred output (tmpB if provided, else fresh array)
 */
function gaussianBlur(data, width, height, sigma, tmpA, tmpB) {
    const kernel = generateGaussianKernel(sigma);
    const len = width * height;

    const buf1 = tmpA && tmpA.length === len ? tmpA : new Float32Array(len);
    const buf2 = tmpB && tmpB.length === len ? tmpB : new Float32Array(len);

    // Horizontal pass
    blurHorizontal(data, buf1, width, height, kernel);

    // Vertical pass
    blurVertical(buf1, buf2, width, height, kernel);

    return buf2;
}

// ── Feature Congestion ──────────────────────────────────────────────────

/**
 * Compute local variance of a single channel via E[X²] - E[X]²
 *
 * @param {Float32Array} channel - Input feature map
 * @param {number} width
 * @param {number} height
 * @param {number} sigma - Gaussian sigma for local pooling
 * @param {Float32Array} [tmpA] - Optional temp buffer for gaussianBlur
 * @param {Float32Array} [tmpB] - Optional temp buffer for gaussianBlur
 * @returns {Float32Array} Per-pixel variance
 */
function computeLocalVariance(channel, width, height, sigma, tmpA, tmpB) {
    const len = width * height;

    // 1. Compute mean(channel) via blur
    const channelCopy = new Float32Array(channel);
    const blurredMean = gaussianBlur(channelCopy, width, height, sigma, tmpA, tmpB);
    const mean = new Float32Array(blurredMean); // Copy before next blur reuses buffers

    // 2. Compute mean(channel²) via blur of squared values
    const squared = new Float32Array(len);
    for (let i = 0; i < len; i++) {
        squared[i] = channel[i] * channel[i];
    }
    const blurredSq = gaussianBlur(squared, width, height, sigma, tmpA, tmpB);

    // 3. Variance = E[X²] - E[X]²
    const variance = new Float32Array(len);
    for (let i = 0; i < len; i++) {
        variance[i] = Math.max(0, blurredSq[i] - mean[i] * mean[i]);
    }
    return variance;
}

/**
 * Normalize a feature map to [0, 1] by dividing by max
 */
function normalizeFeature(feature) {
    let max = 0;
    for (let i = 0; i < feature.length; i++) {
        if (feature[i] > max) max = feature[i];
    }
    if (max < 0.001) max = 1.0;

    const normalized = new Float32Array(feature.length);
    for (let i = 0; i < feature.length; i++) {
        normalized[i] = feature[i] / max;
    }
    return normalized;
}

/**
 * Compute distribution stats from a feature map (for Complexity HUD)
 */
function computeStats(data, w, h) {
    const n = data.length;
    let sum = 0;
    const sorted = new Float32Array(data).sort();
    for (let i = 0; i < n; i++) sum += data[i];

    const mean = sum / n;
    const p90 = sorted[Math.floor(n * 0.9)];
    const p10 = sorted[Math.floor(n * 0.1)];
    const max = sorted[n - 1];

    // Regional breakdown (quadrants)
    const qW = Math.floor(w / 2);
    const qH = Math.floor(h / 2);
    const regions = { tl: 0, tr: 0, bl: 0, br: 0, tlN: 0, trN: 0, blN: 0, brN: 0 };
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const v = data[y * w + x];
            if (x < qW && y < qH) { regions.tl += v; regions.tlN++; }
            else if (x >= qW && y < qH) { regions.tr += v; regions.trN++; }
            else if (x < qW) { regions.bl += v; regions.blN++; }
            else { regions.br += v; regions.brN++; }
        }
    }

    return {
        mean, p90, p10, max,
        quadrants: {
            topLeft: regions.tl / (regions.tlN || 1),
            topRight: regions.tr / (regions.trN || 1),
            bottomLeft: regions.bl / (regions.blN || 1),
            bottomRight: regions.br / (regions.brN || 1)
        }
    };
}

// ── Edge Density (Sobel gradient magnitude + Gaussian smoothing) ────────

/**
 * Compute edge density via Sobel operator + Gaussian blur.
 *
 * Applies a 3×3 Sobel filter to the luminance channel to get gradient
 * magnitude, then smooths with Gaussian blur (σ=3.0) to produce a
 * local edge density map.
 *
 * @param {Float32Array} luminance - Lightness channel (width × height)
 * @param {number} width
 * @param {number} height
 * @param {number} [blurSigma=3.0] - Gaussian σ for smoothing edge magnitudes
 * @param {Float32Array} [tmpA] - Optional pre-allocated temp buffer for blur
 * @param {Float32Array} [tmpB] - Optional pre-allocated temp buffer for blur
 * @returns {Float32Array} Per-pixel edge density (not yet normalized)
 */
function computeEdgeDensity(luminance, width, height, blurSigma, tmpA, tmpB) {
    if (blurSigma === undefined) blurSigma = 3.0;
    const len = width * height;
    const edgeMag = new Float32Array(len);

    // Sobel 3×3 gradient magnitude
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            const tl = luminance[(y - 1) * width + (x - 1)];
            const t  = luminance[(y - 1) * width + x];
            const tr = luminance[(y - 1) * width + (x + 1)];
            const ml = luminance[y * width + (x - 1)];
            const mr = luminance[y * width + (x + 1)];
            const bl = luminance[(y + 1) * width + (x - 1)];
            const b  = luminance[(y + 1) * width + x];
            const br = luminance[(y + 1) * width + (x + 1)];

            const gx = (tl + 2 * ml + bl) - (tr + 2 * mr + br);
            const gy = (tl + 2 * t + tr) - (bl + 2 * b + br);
            edgeMag[idx] = Math.sqrt(gx * gx + gy * gy);
        }
    }

    // Smooth with Gaussian blur to get local edge density
    const edgeMagCopy = new Float32Array(edgeMag);
    return gaussianBlur(edgeMagCopy, width, height, blurSigma, tmpA, tmpB);
}

// ── Composite Scoring ───────────────────────────────────────────────────

/**
 * Rating thresholds — shared between ComplexityHUD and CLI.
 * Each entry: { max, label, bars, color }
 */
const RATINGS = [
    { max: 25, label: 'Low', bars: 1, color: '#43a047' },
    { max: 50, label: 'Medium', bars: 2, color: '#f9a825' },
    { max: 75, label: 'High', bars: 3, color: '#ef6c00' },
    { max: 100, label: 'Extreme', bars: 4, color: '#d32f2f' }
];

/**
 * Compute composite complexity score (0-100) from congestion and edge density stats.
 *
 * Formula: round(sqrt(congestion_p90 * 0.7 + edgeDensity_p90 * 0.3) * 100)
 * - Uses p90 to capture cluttered regions without whitespace dragging down the mean
 * - sqrt scaling spreads the 0-100 range for more perceptual linearity
 *
 * @param {{ p90: number }} congestionStats - Stats from computeStats on normalized congestion
 * @param {{ p90: number }} edgeDensityStats - Stats from computeStats on normalized edge density
 * @returns {{ score: number, rating: { max: number, label: string, bars: number, color: string } }}
 */
function computeCompositeScore(congestionStats, edgeDensityStats) {
    const score = Math.round(
        Math.sqrt(congestionStats.p90 * 0.7 + edgeDensityStats.p90 * 0.3) * 100
    );
    const clamped = Math.max(0, Math.min(100, score));
    const rating = RATINGS.find(r => clamped <= r.max) || RATINGS[RATINGS.length - 1];
    return { score: clamped, rating };
}

// ── Dual Export ──────────────────────────────────────────────────────────

const exports_ = {
    generateGaussianKernel,
    blurHorizontal,
    blurVertical,
    gaussianBlur,
    computeLocalVariance,
    normalizeFeature,
    computeStats,
    computeEdgeDensity,
    computeCompositeScore,
    RATINGS
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports_;
} else if (typeof self !== 'undefined') {
    Object.assign(self, exports_);
}
