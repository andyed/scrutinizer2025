/**
 * Saliency Computation Worker with Center-Surround (DoG) & Face Detection
 * Implements Difference-of-Gaussians for biologically accurate saliency detection
 * combined with a specific "Face Channel" using face-api.js (Tiny Face Detector).
 */

console.log('[SaliencyWorker] Worker starting. Location:', self.location.href);
try {
    importScripts('./lib/face-api.min.js');
    console.log('[SaliencyWorker] face-api.js loaded.');
} catch (e) {
    console.error('[SaliencyWorker] Import failed:', e);
}

let canvas;
let ctx;
let width = 0;
let height = 0;

// Reusable buffers to avoid allocations
let tempBuffer1;
let tempBuffer2;

// Face Detection State
let faceModelLoaded = false;
let faceOptions;

// Initialize Face API
async function loadModels() {
    try {
        console.log('[SaliencyWorker] Loading Face Model...');
        // Load model from relative path (resolving from root apparently)
        await faceapi.nets.tinyFaceDetector.loadFromUri('./assets/models');

        // Configure options for real-time speed
        // inputSize: 224 is a good balance for our ~256px canvas
        faceOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 });

        faceModelLoaded = true;
        console.log('[SaliencyWorker] Face model loaded successfully.');
    } catch (e) {
        console.error('[SaliencyWorker] Face model load failed:', e);
    }
}

// Start loading immediately
loadModels();


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
 */
function gaussianBlur(data, width, height, sigma) {
    const kernel = generateGaussianKernel(sigma);
    const len = width * height;

    // Ensure temp buffers exist
    if (!tempBuffer1 || tempBuffer1.length !== len) {
        tempBuffer1 = new Float32Array(len);
        tempBuffer2 = new Float32Array(len);
    }

    // Horizontal pass
    blurHorizontal(data, tempBuffer1, width, height, kernel);

    // Vertical pass
    blurVertical(tempBuffer1, tempBuffer2, width, height, kernel);

    return tempBuffer2;
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
    const fine = gaussianBlur(featureCopy, width, height, 1.0);

    // CRITICAL: Copy fine result before computing coarse
    // (gaussianBlur reuses temp buffers)
    const fineCopy = new Float32Array(fine);

    // Reset feature for coarse blur
    const featureCopy2 = new Float32Array(feature);

    // Coarse scale (σ=3.0)
    const coarse = gaussianBlur(featureCopy2, width, height, 3.0);

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

    // sourceW/H are Physical pixels. blocks are Logical pixels.
    // We must scale blocks by DPR to get Physical, then by (target/source) to get Saliency Space.
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
    const { imageBitmap, id } = e.data;

    if (!imageBitmap) return;

    // Adaptive Resolution Scaling
    const SALIENCY_MAX_DIM = 256;
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

    const norm_I = normalizeFeature(cs_I);
    const norm_RG = normalizeFeature(cs_RG);
    const norm_BY = normalizeFeature(cs_BY);
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

        // --- PHASE 5: GATED SALIENCY (Cognitive Alignment) ---
        if (inhibitorMask && excitorMask) {
            const inhibition = inhibitorMask[i];
            const excitation = excitorMask[i];

            // 1. Gating (Suppress background/whitespace)
            val *= (inhibition * 0.9 + 0.1);

            // 2. Boosting (Slightly highlight content areas, but don't overwhelm visual features)
            // Was 0.8, which washed out actual image details. Reduced to 0.15.
            val += (excitation * 0.15);
        }

        saliency[i] = val;
        if (val > maxVal) maxVal = val;
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

        const byteVal = Math.floor(val * 255);
        pixels[i * 4] = byteVal;
        pixels[i * 4 + 1] = byteVal;
        pixels[i * 4 + 2] = byteVal;
        pixels[i * 4 + 3] = 255;
    }

    // Send back the processed ImageData
    self.postMessage({
        imageData: imageData,
        id: id
    }, [imageData.data.buffer]);
};
