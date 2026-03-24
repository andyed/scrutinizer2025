/**
 * Congestion Worker — Dedicated high-resolution Feature Congestion computation
 *
 * Runs independently of the 256px saliency worker to produce accurate
 * congestion + edge density data for the inspection overlay and HUD.
 *
 * Validation showed congestion ranking degrades at 256px (Spearman ρ=0.69)
 * but reaches ρ=0.89 at 512px and ρ=0.93 at 768px with fixed σ=2.5.
 * This worker defaults to 1024px for maximum detail in the inspection overlay.
 *
 * Reuses congestion-core.js (shared with saliency-worker.js) for all math.
 * Inlines Oklab conversion (same as saliency-worker.js — small functions,
 * avoids cross-worker import complexity).
 *
 * No face detection, no center-surround DoG, no structure gating.
 * This worker is congestion + edge density only.
 */

console.log('[CongestionWorker] Worker starting.');
try {
    importScripts('./congestion-core.js');
    console.log('[CongestionWorker] congestion-core.js loaded.');
} catch (e) {
    console.error('[CongestionWorker] Import failed:', e);
}

let canvas;
let ctx;
let width = 0;
let height = 0;

// Cached temp buffers for gaussianBlur (same pattern as saliency-worker.js)
let tempBuffer1;
let tempBuffer2;

// ── Color conversion (inlined — same as saliency-worker.js) ─────────

function srgbToLinear(c) {
    if (c <= 0.04045) {
        return c / 12.92;
    } else {
        return Math.pow((c + 0.055) / 1.055, 2.4);
    }
}

function linearSrgbToOklab(r, g, b) {
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);

    return {
        L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    };
}

// ── Cached-buffer wrapper for gaussianBlur ───────────────────────────

function gaussianBlurCached(data, w, h, sigma) {
    const len = w * h;
    if (!tempBuffer1 || tempBuffer1.length !== len) {
        tempBuffer1 = new Float32Array(len);
        tempBuffer2 = new Float32Array(len);
    }
    return gaussianBlur(data, w, h, sigma, tempBuffer1, tempBuffer2);
}

// ── Main message handler ─────────────────────────────────────────────

self.onmessage = function (e) {
    const { imageBitmap, id, maxDimension } = e.data;

    if (!imageBitmap) return;

    const t0 = performance.now();

    const MAX_DIM = maxDimension || 1024;
    const srcW = imageBitmap.width;
    const srcH = imageBitmap.height;
    const maxDim = Math.max(srcW, srcH);
    const scale = maxDim > 0 ? Math.min(1.0, MAX_DIM / maxDim) : 0.5;

    const targetW = Math.floor(srcW * scale);
    const targetH = Math.floor(srcH * scale);

    // Initialize/resize canvas
    if (width !== targetW || height !== targetH) {
        width = targetW;
        height = targetH;
        canvas = new OffscreenCanvas(width, height);
        ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;

        const len = width * height;
        tempBuffer1 = new Float32Array(len);
        tempBuffer2 = new Float32Array(len);
    }

    // Draw frame at target resolution
    ctx.drawImage(imageBitmap, 0, 0, width, height);

    const len = width * height;
    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = imageData.data;

    // ── Extract Oklab channels ───────────────────────────────────────
    const I = new Float32Array(len);   // Lightness (L)
    const RG = new Float32Array(len);  // |a| (red-green)
    const BY = new Float32Array(len);  // |b| (blue-yellow)

    for (let i = 0; i < len; i++) {
        const rLin = srgbToLinear(pixels[i * 4] / 255.0);
        const gLin = srgbToLinear(pixels[i * 4 + 1] / 255.0);
        const bLin = srgbToLinear(pixels[i * 4 + 2] / 255.0);

        const lab = linearSrgbToOklab(rLin, gLin, bLin);

        I[i] = lab.L;
        RG[i] = Math.abs(lab.a);
        BY[i] = Math.abs(lab.b);
    }

    // ── Feature Congestion (Rosenholtz 2007) ─────────────────────────
    // Local variance across L, |a|, |b| channels with σ=2.5
    const congestionSigma = 2.5;

    function computeLocalVarianceCached(channel, w, h, sigma) {
        return computeLocalVariance(channel, w, h, sigma, tempBuffer1, tempBuffer2);
    }

    const var_I = computeLocalVarianceCached(I, width, height, congestionSigma);
    const var_RG = computeLocalVarianceCached(RG, width, height, congestionSigma);
    const var_BY = computeLocalVarianceCached(BY, width, height, congestionSigma);

    // Sum variances → raw congestion
    const congestion = new Float32Array(len);
    for (let i = 0; i < len; i++) {
        congestion[i] = var_I[i] + var_RG[i] + var_BY[i];
    }

    // ── Edge Density (Sobel + blur) ──────────────────────────────────
    const edgeMag = new Float32Array(len);
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            const tl = I[(y - 1) * width + (x - 1)];
            const t  = I[(y - 1) * width + x];
            const tr = I[(y - 1) * width + (x + 1)];
            const ml = I[y * width + (x - 1)];
            const mr = I[y * width + (x + 1)];
            const bl = I[(y + 1) * width + (x - 1)];
            const b  = I[(y + 1) * width + x];
            const br = I[(y + 1) * width + (x + 1)];

            const gx = (tl + 2 * ml + bl) - (tr + 2 * mr + br);
            const gy = (tl + 2 * t + tr) - (bl + 2 * b + br);
            edgeMag[idx] = Math.sqrt(gx * gx + gy * gy);
        }
    }

    // Blur edge magnitude → local edge density
    const edgeMagCopy = new Float32Array(edgeMag);
    const blurredEdge = gaussianBlurCached(edgeMagCopy, width, height, 3.0);
    const edgeDensity = new Float32Array(blurredEdge);

    // ── Normalize ────────────────────────────────────────────────────
    const norm_congestion = normalizeFeature(congestion);
    const norm_edgeDensity = normalizeFeature(edgeDensity);

    // ── Stats for HUD ────────────────────────────────────────────────
    const congestionStats = computeStats(norm_congestion, width, height);
    const edgeDensityStats = computeStats(norm_edgeDensity, width, height);

    // ── Peripheral congestion (128px, σ=5.0) ─────────────────────────
    // Eccentricity-weighted: coarser spatial scale matching how the visual
    // system pools features at increasing eccentricity. Packed into B channel.
    const PERIPH_MAX_DIM = 128;
    const periphScale = Math.min(1.0, PERIPH_MAX_DIM / Math.max(width, height));
    const pW = Math.max(1, Math.floor(width * periphScale));
    const pH = Math.max(1, Math.floor(height * periphScale));
    const pLen = pW * pH;

    // Downscale Oklab channels to peripheral resolution via box filter
    const pI = new Float32Array(pLen);
    const pRG = new Float32Array(pLen);
    const pBY = new Float32Array(pLen);

    for (let py = 0; py < pH; py++) {
        for (let px = 0; px < pW; px++) {
            // Map peripheral pixel to source region
            const sx0 = Math.floor(px / periphScale);
            const sy0 = Math.floor(py / periphScale);
            const sx1 = Math.min(width - 1, Math.floor((px + 1) / periphScale));
            const sy1 = Math.min(height - 1, Math.floor((py + 1) / periphScale));
            let sumI = 0, sumRG = 0, sumBY = 0, count = 0;
            for (let sy = sy0; sy <= sy1; sy++) {
                for (let sx = sx0; sx <= sx1; sx++) {
                    const si = sy * width + sx;
                    sumI += I[si]; sumRG += RG[si]; sumBY += BY[si];
                    count++;
                }
            }
            const pi = py * pW + px;
            pI[pi] = sumI / count;
            pRG[pi] = sumRG / count;
            pBY[pi] = sumBY / count;
        }
    }

    // Compute local variance at wider σ=5.0 (peripheral pooling scale)
    const pTmp1 = new Float32Array(pLen);
    const pTmp2 = new Float32Array(pLen);
    const pVar_I = computeLocalVariance(pI, pW, pH, 5.0, pTmp1, pTmp2);
    const pVar_RG = computeLocalVariance(pRG, pW, pH, 5.0, pTmp1, pTmp2);
    const pVar_BY = computeLocalVariance(pBY, pW, pH, 5.0, pTmp1, pTmp2);

    const periphCong = new Float32Array(pLen);
    for (let i = 0; i < pLen; i++) {
        periphCong[i] = pVar_I[i] + pVar_RG[i] + pVar_BY[i];
    }
    const norm_periphCong = normalizeFeature(periphCong);

    // Upscale peripheral congestion back to full output resolution (bilinear)
    const periphUpscaled = new Float32Array(len);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const sx = (x / width) * pW;
            const sy = (y / height) * pH;
            const x0 = Math.floor(sx), y0 = Math.floor(sy);
            const x1 = Math.min(x0 + 1, pW - 1);
            const y1 = Math.min(y0 + 1, pH - 1);
            const fx = sx - x0, fy = sy - y0;
            periphUpscaled[y * width + x] =
                norm_periphCong[y0 * pW + x0] * (1 - fx) * (1 - fy) +
                norm_periphCong[y0 * pW + x1] * fx * (1 - fy) +
                norm_periphCong[y1 * pW + x0] * (1 - fx) * fy +
                norm_periphCong[y1 * pW + x1] * fx * fy;
        }
    }

    // ── Pack into ImageData: R=congestion, G=edgeDensity, B=periphCong, A=255
    for (let i = 0; i < len; i++) {
        pixels[i * 4]     = Math.floor(Math.max(0, Math.min(1, norm_congestion[i])) * 255);
        pixels[i * 4 + 1] = Math.floor(Math.max(0, Math.min(1, norm_edgeDensity[i])) * 255);
        pixels[i * 4 + 2] = Math.floor(Math.max(0, Math.min(1, periphUpscaled[i])) * 255);
        pixels[i * 4 + 3] = 255;
    }

    const elapsed = performance.now() - t0;
    console.log(`[CongestionWorker] Computed ${width}x${height} in ${elapsed.toFixed(1)}ms`);

    // Return results
    self.postMessage({
        imageData: imageData,
        id: id,
        congestionStats: congestionStats,
        edgeDensityStats: edgeDensityStats,
        resolution: { width, height },
        computeTimeMs: elapsed
    }, [imageData.data.buffer]);
};
