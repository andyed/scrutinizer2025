/**
 * Saliency Computation Worker with Center-Surround (DoG) & Face Detection
 * Implements Difference-of-Gaussians for biologically accurate saliency detection
 * combined with a specific "Face Channel" using face-api.js (Tiny Face Detector).
 */

console.log('[SaliencyWorker] Worker starting. Location:', self.location.href);
try {
    importScripts('./congestion-core.js');
} catch (e) {
    console.error('[SaliencyWorker] congestion-core import failed:', e);
}

let canvas;
let ctx;
let width = 0;
let height = 0;

// Reusable buffers to avoid allocations
let tempBuffer1;
let tempBuffer2;

// Face Detection State — lazy-loaded on first saliency frame.
// Three states: importing the 1.3MB face-api.min.js library, fetching the
// 192KB tiny-face-detector weights, and ready. Per-frame code gates on
// faceModelLoaded so saliency works (DoG + Oklab opponency) before any of
// these complete and continues working if either step fails. Boot path:
// worker spawn → ensureFaceApi() fires on first onmessage frame → import
// face-api in the background → load model in the background → on completion
// face channel joins the saliency composite. No user-visible boot blocking.
let faceApiImported = false;
let faceModelLoaded = false;
let faceOptions;
let faceLoadInFlight = false;

function ensureFaceApi() {
    if (faceModelLoaded || faceLoadInFlight) return;
    faceLoadInFlight = true;
    // 1. Import the face-api.min.js library (synchronous from this point, but
    //    runs off the worker spawn path so saliency frames already started).
    if (!faceApiImported) {
        try {
            const t0 = performance.now();
            importScripts('./lib/face-api.min.js');
            faceApiImported = true;
            console.log(`[SaliencyWorker] face-api.js loaded in ${(performance.now() - t0).toFixed(1)}ms.`);
        } catch (e) {
            console.error('[SaliencyWorker] face-api.js import failed — saliency continues without face channel:', e);
            return; // leave faceLoadInFlight=true to avoid retry storms
        }
    }
    // 2. Fetch the model weights. Fire-and-forget; per-frame code gates on
    //    faceModelLoaded.
    (async () => {
        try {
            console.log('[SaliencyWorker] Loading Face Model...');
            await faceapi.nets.tinyFaceDetector.loadFromUri('./assets/models');
            // inputSize: 224 is a good balance for our ~256px canvas.
            faceOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 });
            faceModelLoaded = true;
            console.log('[SaliencyWorker] Face model loaded successfully.');
        } catch (e) {
            console.error('[SaliencyWorker] Face model load failed — saliency continues without face channel:', e);
            // Leave faceLoadInFlight=true; retrying a fundamentally-broken
            // model fetch on every frame would just spam errors.
        }
    })();
}


// ── Color conversion (kept inline — not part of congestion-core) ────────

/**
* Convert sRGB component to linear RGB
*/
function srgbToLinear(c) {
    if (c <= 0.04045) {
        return c / 12.92;
    } else {
        return Math.pow((c + 0.055) / 1.055, 2.4);
    }
}

/**
* Convert linear sRGB to Oklab
*/
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

// ── Cached-buffer wrapper for gaussianBlur (frame-rate performance) ─────
// congestion-core.js provides the pure functions; this wrapper reuses
// module-level temp buffers to avoid per-frame allocation.

function gaussianBlurCached(data, width, height, sigma) {
    const len = width * height;
    if (!tempBuffer1 || tempBuffer1.length !== len) {
        tempBuffer1 = new Float32Array(len);
        tempBuffer2 = new Float32Array(len);
    }
    return gaussianBlur(data, width, height, sigma, tempBuffer1, tempBuffer2);
}

/**
 * Compute center-surround for a feature map
 */
function computeCenterSurround(feature, width, height) {
    const len = width * height;
    const result = new Float32Array(len);

    // Copy feature to avoid modifying original
    const featureCopy = new Float32Array(feature);

    // Fine scale (σ=1.0)
    const fine = gaussianBlurCached(featureCopy, width, height, 1.0);

    // CRITICAL: Copy fine result before computing coarse
    // (gaussianBlurCached reuses temp buffers)
    const fineCopy = new Float32Array(fine);

    // Reset feature for coarse blur
    const featureCopy2 = new Float32Array(feature);

    // Coarse scale (σ=3.0)
    const coarse = gaussianBlurCached(featureCopy2, width, height, 3.0);

    // Difference-of-Gaussians
    for (let i = 0; i < len; i++) {
        result[i] = Math.abs(fineCopy[i] - coarse[i]);
    }

    return result;
}

/**
 * Generate Inhibitor and Excitor masks from Structure Blocks
 */
function generateStructureMasks(blocks, targetW, targetH, sourceW, sourceH, dpr) {
    const len = targetW * targetH;
    const inhibitor = new Float32Array(len);
    const excitor = new Float32Array(len);

    // sourceW/H are Physical pixels (from NativeImage.getSize() which returns
    // full-resolution bitmap dimensions — confirmed: getScaleFactors()=[1]).
    // Blocks are in CSS/logical pixels (from getBoundingClientRect × zoom).
    // Scale: CSS → physical (× dpr) → saliency space (× targetW/sourceW).
    const scaleX = (targetW / sourceW) * dpr;
    const scaleY = (targetH / sourceH) * dpr;

    for (const block of blocks) {
        const x = Math.floor(block.x * scaleX);
        const y = Math.floor(block.y * scaleY);
        const w = Math.ceil(block.w * scaleX);
        const h = Math.ceil(block.h * scaleY);

        const dilation = 2;
        const startX = Math.max(0, x - dilation);
        const startY = Math.max(0, y - dilation);
        const endX = Math.min(targetW, x + w + dilation);
        const endY = Math.min(targetH, y + h + dilation);

        const isText = (block.type === 1);

        for (let row = startY; row < endY; row++) {
            const rowOffset = row * targetW;
            const endRowOffset = rowOffset + endX;
            for (let idx = rowOffset + startX; idx < endRowOffset; idx++) {
                inhibitor[idx] = 1.0;
                if (!isText) {
                    excitor[idx] = 1.0;
                }
            }
        }
    }
    return { inhibitor, excitor };
}

/**
 * Draw a Gaussian blob for a detected face
 */
// ── V1 length-tuning / end-stopping (Hubel-Wiesel 1965, Cavanaugh-Bair-Movshon 2002)
// ─────────────────────────────────────────────────────────────────────────────
// Production hook for the algorithm whose shader reference implementation lives
// at peripheral.frag:281-339. See docs/specs/length_tuned_edge_suppression.md D4.
//
// Walks tangent over the SOURCE LUMINANCE (Oklab L of the captured frame at
// saliency resolution), computes per-pixel persistence, and sigmoid-suppresses
// the saliency value at that pixel. The result propagates through every
// downstream consumer of the saliency map (LGN gating, V1 strength, V4 chroma,
// pyramid synth weight), giving the mechanism the visual reach P1's shader-
// only orientBonus hook couldn't deliver.
//
// Cost: ~1ms once per saliency cycle at 256-512 px (vs 32 texture reads per
// edge fragment per frame in the shader path). Pure JS, runs on this worker
// thread off the main thread.
function suppressLongEdges(saliency, sourceL, width, height, params) {
    const { K_STEPS, midpoint, steepness, strength } = params;
    // Gate threshold on luminance gradient at saliency-map resolution.
    const EDGE_GATE_SQ = 0.0001;

    // Snapshot the source luminance so the probe reads a fixed map even as we
    // mutate saliency in place.
    const L = sourceL;

    // STRIDE — the critical scaling that keeps the probe meaningful across
    // saliency-map resolutions (256 / 512 / 1024 are all menu options).
    // K_STEPS by itself walks K saliency-pixels each side. At 256 res that's
    // ~K × 7.5 native px ≈ 60 native px for K=8 — a reasonable "long edge"
    // probe span. At 1024 res the same K=8 walks only ±15 native px, far too
    // short to discriminate a page-tall border from a paragraph baseline.
    // Scale stride so the absolute probe span stays roughly constant in
    // native-pixel terms: stride = round(width / 256). At 256 res stride=1
    // (60 native-px span); at 512 res stride=2 (60 native-px); at 1024 res
    // stride=4 (60 native-px). Per-sample cost is fixed, total samples are
    // fixed — only the spacing between samples changes.
    const stride = Math.max(1, Math.round(width / 256));

    for (let y = 2; y < height - 2; y++) {
        const rowBase = y * width;
        for (let x = 2; x < width - 2; x++) {
            const i = rowBase + x;
            // Center luminance gradient via 4-neighbour difference (matches
            // the shader's gradient construction at peripheral.frag:244-250).
            const gx = L[i + 1] - L[i - 1];
            const gy = L[i + width] - L[i - width];
            const g2 = gx * gx + gy * gy;
            if (g2 < EDGE_GATE_SQ) continue;

            const gMag = Math.sqrt(g2);
            // Tangent = perpendicular to gradient. Walk this direction at
            // the resolution-adapted stride.
            const tx = -gy / gMag;
            const ty = gx / gMag;

            let persistSum = 0;
            let validSamples = 0;
            for (let k = 1; k <= K_STEPS; k++) {
                for (let sign = -1; sign <= 1; sign += 2) {
                    // stride multiplier — the only difference from the
                    // shader's per-MIP-1-texel walk. See block comment above.
                    const sx = x + tx * k * sign * stride;
                    const sy = y + ty * k * sign * stride;
                    const px = Math.round(sx);
                    const py = Math.round(sy);
                    if (px < 1 || px >= width - 1 || py < 1 || py >= height - 1) continue;
                    const ix = py * width + px;
                    const gxp = L[ix + 1] - L[ix - 1];
                    const gyp = L[ix + width] - L[ix - width];
                    const g2p = gxp * gxp + gyp * gyp;
                    if (g2p < 1e-8) continue;
                    const align = (gx * gxp + gy * gyp) / Math.sqrt(g2 * g2p);
                    if (align > 0) persistSum += align;
                    validSamples++;
                }
            }
            if (validSamples === 0) continue;
            const persist = persistSum / validSamples;

            const sig = 1.0 / (1.0 + Math.exp(-steepness * (persist - midpoint)));
            const lengthSuppress = 1.0 - strength * sig;
            saliency[i] *= lengthSuppress;
        }
    }
}

function drawFaceBlob(faceMap, width, height, box) {
    // Box is { x, y, width, height } in canvas coords
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Sigma relative to face size (larger sigma = softer blob)
    // We want the blob to cover the face and fall off
    const sigma = Math.max(box.width, box.height) * 0.6; // Increased from 0.5 for broader hotspots
    const sigma2 = 2 * sigma * sigma;

    // Bounds to optimize loop
    const radius = Math.ceil(sigma * 2.5);
    const startX = Math.max(0, Math.floor(cx - radius));
    const startY = Math.max(0, Math.floor(cy - radius));
    const endX = Math.min(width, Math.ceil(cx + radius));
    const endY = Math.min(height, Math.ceil(cy + radius));

    for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
            const dx = x - cx;
            const dy = y - cy;
            const dist2 = dx * dx + dy * dy;

            // Gaussian value
            const val = Math.exp(-dist2 / sigma2);

            // Additive blending into face map
            const idx = y * width + x;
            faceMap[idx] = Math.min(1.0, faceMap[idx] + val);
        }
    }
}

self.onmessage = async function (e) {
    const { imageBitmap, id, maxDimension, lengthTuning } = e.data;

    if (!imageBitmap) return;

    // Kick off face-api import + model load on first frame. Fire-and-forget.
    // Per-frame code below gates on faceModelLoaded — saliency works
    // immediately with DoG + Oklab opponency; face channel joins when ready.
    ensureFaceApi();

    // Adaptive Resolution Scaling — configurable via ContentAnalysis.setSaliencyResolution()
    const SALIENCY_MAX_DIM = maxDimension || 256;
    const FACE_DETECT_MAX_DIM = 640; // Higher res for small face detection

    const srcW = imageBitmap.width;
    const srcH = imageBitmap.height;
    const maxDim = Math.max(srcW, srcH);



    // Calculate scales
    const saliencyScale = maxDim > 0 ? Math.min(1.0, SALIENCY_MAX_DIM / maxDim) : 0.25;
    const faceScale = maxDim > 0 ? Math.min(1.0, FACE_DETECT_MAX_DIM / maxDim) : 0.5;

    // Saliency Dimensions
    const sWidth = Math.floor(srcW * saliencyScale);
    const sHeight = Math.floor(srcH * saliencyScale);

    // Face Dimensions
    const fWidth = Math.floor(srcW * faceScale);
    const fHeight = Math.floor(srcH * faceScale);

    // Initialize/Resize Saliency Canvas (Main processing canvas)
    if (width !== sWidth || height !== sHeight) {
        width = sWidth;
        height = sHeight;
        canvas = new OffscreenCanvas(width, height);
        ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;

        // Re-allocate buffers
        const len = width * height;
        tempBuffer1 = new Float32Array(len);
        tempBuffer2 = new Float32Array(len);
    }

    // Draw frame to Saliency Canvas
    ctx.drawImage(imageBitmap, 0, 0, width, height);

    const len = width * height;

    // Get ImageData for processing
    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = imageData.data;

    // --------- FACE DETECTION ---------
    // Run on a separate, higher-res canvas if needed to detect small faces
    let faceMap = new Float32Array(width * height); // Initialize empty

    if (faceModelLoaded) {
        // Create temp face canvas
        const faceCanvas = new OffscreenCanvas(fWidth, fHeight);
        const faceCtx = faceCanvas.getContext('2d');
        faceCtx.drawImage(imageBitmap, 0, 0, fWidth, fHeight);

        try {
            const faces = await faceapi.detectAllFaces(faceCanvas, faceOptions);

            if (faces && faces.length > 0) {
                console.log(`[SaliencyWorker] Detected ${faces.length} faces`);
                for (const face of faces) {
                    // Map box from Face Space (fWidth) to Saliency Space (width)
                    const scaleFactor = width / fWidth;

                    const scaledBox = {
                        x: face.box.x * scaleFactor,
                        y: face.box.y * scaleFactor,
                        width: face.box.width * scaleFactor,
                        height: face.box.height * scaleFactor
                    };

                    drawFaceBlob(faceMap, width, height, scaledBox);
                }
            }
        } catch (err) {
            // Don't crash the worker if detection fails
            console.warn('[SaliencyWorker] Face detection error:', err);
        }
    } // End if(faceModelLoaded)

    // Feature maps
    const I = new Float32Array(len);   // Intensity (Oklab L)
    const RG = new Float32Array(len);  // Red-Green (Oklab |a|)
    const BY = new Float32Array(len);  // Blue-Yellow (Oklab |b|)

    // PASS 1: Extract features using Oklab
    for (let i = 0; i < len; i++) {
        // Normalize 0-255 to 0-1 and Linearize
        const rLin = srgbToLinear(pixels[i * 4] / 255.0);
        const gLin = srgbToLinear(pixels[i * 4 + 1] / 255.0);
        const bLin = srgbToLinear(pixels[i * 4 + 2] / 255.0);

        // Convert to Oklab
        const lab = linearSrgbToOklab(rLin, gLin, bLin);

        // Feature Mapping
        I[i] = lab.L;              // Lightness matches Intensity
        RG[i] = Math.abs(lab.a);   // Magnitude of Red-Green opponent
        BY[i] = Math.abs(lab.b);   // Magnitude of Blue-Yellow opponent
    }

    // PASS 2: Compute center-surround for each feature
    const cs_I = computeCenterSurround(I, width, height);
    const cs_RG = computeCenterSurround(RG, width, height);
    const cs_BY = computeCenterSurround(BY, width, height);

    // PASS 3: Normalize each feature map independently
    // normalizeFeature() provided by congestion-core.js via importScripts
    const norm_I = normalizeFeature(cs_I);
    const norm_RG = normalizeFeature(cs_RG);
    const norm_BY = normalizeFeature(cs_BY);

    // ── FEATURE CONGESTION (Rosenholtz et al. 2007) ──────────────────
    // Local variance across I, RG, BY channels. Variance = E[X²] - E[X]².
    // computeLocalVariance() provided by congestion-core.js; pass cached buffers.

    function computeLocalVarianceCached(channel, w, h, sigma) {
        return computeLocalVariance(channel, w, h, sigma, tempBuffer1, tempBuffer2);
    }

    const congestionSigma = 2.5;
    const var_I = computeLocalVarianceCached(I, width, height, congestionSigma);
    const var_RG = computeLocalVarianceCached(RG, width, height, congestionSigma);
    const var_BY = computeLocalVarianceCached(BY, width, height, congestionSigma);

    // Sum variances across channels → raw congestion
    const congestion = new Float32Array(len);
    for (let i = 0; i < len; i++) {
        congestion[i] = var_I[i] + var_RG[i] + var_BY[i];
    }

    // ── EDGE DENSITY ─────────────────────────────────────────────────
    // Sobel magnitude on intensity channel, then blur to get local density.
    const edgeMag = new Float32Array(len);
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            // 3×3 Sobel on I (intensity)
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

    // Blur edge magnitude to get local edge density
    const edgeMagCopy = new Float32Array(edgeMag);
    const blurredEdge = gaussianBlurCached(edgeMagCopy, width, height, 3.0);
    const edgeDensity = new Float32Array(blurredEdge);

    // Normalize congestion and edge density
    const norm_congestion = normalizeFeature(congestion);
    const norm_edgeDensity = normalizeFeature(edgeDensity);

    // ── SUMMARY STATS (for Complexity HUD) ───────────────────────────
    // computeStats() provided by congestion-core.js via importScripts
    const congestionStats = computeStats(norm_congestion, width, height);
    const edgeDensityStats = computeStats(norm_edgeDensity, width, height);
    // Face is already 0-1 mostly from Gaussian, but better normalize just in case
    // Actually, drawFaceBlob max is 1.0. If multiple faces overlap, it might go > 1.
    // Let's rely on final clamp.

    // --- PHASE 5: GATED SALIENCY MASKS ---
    let inhibitorMask = null;
    let excitorMask = null;

    if (e.data.structureData && e.data.structureData.length > 0 && srcW > 0) {
        const dpr = e.data.dpr || 1;
        const masks = generateStructureMasks(e.data.structureData, width, height, srcW, srcH, dpr);
        inhibitorMask = masks.inhibitor;
        excitorMask = masks.excitor;
    }

    // PASS 4: Combine normalized features with weights
    const W_I = 0.3;
    const W_RG = 0.35;
    const W_BY = 0.35;
    const W_FACE = 2.0; // Boosted from 0.5 to make faces pop against complex backgrounds

    const saliency = new Float32Array(len);
    let maxVal = 0;

    for (let i = 0; i < len; i++) {
        // Raw Bottom-Up Saliency
        // If Face > 0, it dominates or adds strongly
        let raw = W_I * norm_I[i] + W_RG * norm_RG[i] + W_BY * norm_BY[i];

        let val = raw + (faceMap[i] * W_FACE);

        // --- PHASE 5: STRUCTURE-GATED SALIENCY (Bandwidth Allocation) ---
        // Structure masks determine which regions deserve processing budget.
        // Inhibitor: zero out non-content areas (whitespace, background).
        // Excitor: multiplicative gain on content blocks (media, UI elements).
        if (inhibitorMask && excitorMask) {
            const inhibition = inhibitorMask[i];
            const excitation = excitorMask[i];

            // 1. Gating (filter non-content — don't waste bandwidth on whitespace)
            val *= (inhibition * 0.9 + 0.1);

            // 2. Gain modulation (amplify existing signal, don't create from nothing)
            // Multiplicative ensures dark featureless regions stay low-priority.
            // Was additive +0.15, which dominated in low-saliency dark regions.
            val *= (1.0 + excitation * 0.3);
        }

        saliency[i] = val;
        if (val > maxVal) maxVal = val;
    }

    // PASS 4.5: V1 length-tuning / end-stopping suppression.
    // Production hook for the algorithm whose shader reference lives at
    // peripheral.frag:281-339. Walks tangent over source luminance (I),
    // sigmoid-suppresses saliency for long-edge regions. See spec §D4.
    // Mutating saliency in place; re-derive maxVal in PASS 5's normalize.
    if (lengthTuning && lengthTuning.enabled) {
        suppressLongEdges(saliency, I, width, height, {
            K_STEPS: lengthTuning.K_STEPS || 8,
            midpoint: lengthTuning.midpoint ?? 0.75,
            steepness: lengthTuning.steepness ?? 10.0,
            strength: lengthTuning.strength ?? 0.7,
        });
        // Recompute maxVal because suppression may have changed which pixel
        // is the brightest (unlikely — suppression only lowers — but if the
        // OLD max was on a long edge, it's now smaller).
        maxVal = 0;
        for (let i = 0; i < len; i++) {
            if (saliency[i] > maxVal) maxVal = saliency[i];
        }
    }

    // PASS 5: Normalize & Write Output
    if (maxVal < 0.001) {
        maxVal = 1.0;
    }

    for (let i = 0; i < len; i++) {
        let val = saliency[i] / maxVal;

        // Boost contrast for visualization
        val = Math.pow(val, 0.8);

        // Clamp to [0, 1]
        val = Math.max(0, Math.min(1, val));

        // RGB-packed output: R=Saliency, G=Feature Congestion, B=Edge Density
        // Repurposes previously wasted G/B channels (were copies of R)
        pixels[i * 4]     = Math.floor(val * 255);                                      // R: Saliency
        pixels[i * 4 + 1] = Math.floor(Math.max(0, Math.min(1, norm_congestion[i])) * 255);  // G: Feature Congestion
        pixels[i * 4 + 2] = Math.floor(Math.max(0, Math.min(1, norm_edgeDensity[i])) * 255); // B: Edge Density
        pixels[i * 4 + 3] = 255;
    }

    // Send back the processed ImageData + summary stats
    self.postMessage({
        imageData: imageData,
        id: id,
        congestionStats: congestionStats,
        edgeDensityStats: edgeDensityStats
    }, [imageData.data.buffer]);
};
