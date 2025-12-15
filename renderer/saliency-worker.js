/**
 * Saliency Computation Worker with Center-Surround (DoG)
 * Implements Difference-of-Gaussians for biologically accurate saliency detection.
 */

let canvas;
let ctx;
let width = 0;
let height = 0;

// Reusable buffers to avoid allocations
let tempBuffer1;
let tempBuffer2;

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
 * @param {Array} blocks - Structure blocks from main thread
 * @param {number} targetW - Width of saliency map
 * @param {number} targetH - Height of saliency map
 * @param {number} sourceW - Width of original viewport
 * @param {number} sourceH - Height of original viewport
 */
function generateStructureMasks(blocks, targetW, targetH, sourceW, sourceH) {
    const len = targetW * targetH;
    const inhibitor = new Float32Array(len);
    const excitor = new Float32Array(len);

    const scaleX = targetW / sourceW;
    const scaleY = targetH / sourceH;

    for (const block of blocks) {
        // Map block coordinates to saliency map space
        const x = Math.floor(block.x * scaleX);
        const y = Math.floor(block.y * scaleY);
        const w = Math.ceil(block.w * scaleX);
        const h = Math.ceil(block.h * scaleY);

        // Clip to bounds
        const startX = Math.max(0, x);
        const startY = Math.max(0, y);
        const endX = Math.min(targetW, x + w);
        const endY = Math.min(targetH, y + h);

        const isText = (block.type === 1);

        for (let row = startY; row < endY; row++) {
            const rowOffset = row * targetW;
            const endRowOffset = rowOffset + endX;
            for (let idx = rowOffset + startX; idx < endRowOffset; idx++) {
                // Inhibitor: Mark existence of ANY content
                inhibitor[idx] = 1.0;

                // Excitor: Mark interactive content (Non-Text)
                if (!isText) {
                    excitor[idx] = 1.0;
                }
            }
        }
    }
    return { inhibitor, excitor };
}

self.onmessage = function (e) {
    const { imageBitmap, id } = e.data;

    if (!imageBitmap) return;

    // Adaptive Resolution Scaling
    const TARGET_MAX_DIM = 256;
    const maxDim = Math.max(imageBitmap.width, imageBitmap.height);
    const scale = maxDim > 0 ? Math.min(1.0, TARGET_MAX_DIM / maxDim) : 0.25;

    // Calculate target dimensions
    const newWidth = Math.floor(imageBitmap.width * scale);
    const newHeight = Math.floor(imageBitmap.height * scale);

    // Initialize or resize OffscreenCanvas
    if (width !== newWidth || height !== newHeight) {
        width = newWidth;
        height = newHeight;
        canvas = new OffscreenCanvas(width, height);
        ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;
    }

    // Draw and resize
    ctx.drawImage(imageBitmap, 0, 0, width, height);
    imageBitmap.close(); // Release memory immediately

    // Get pixel data
    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    const len = width * height;

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

    // PASS 3: Normalize each feature map independently (Itti-Koch-Niebur)
    // This prevents one feature from dominating
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

    // --- PHASE 5: GATED SALIENCY MASKS ---
    let inhibitorMask = null;
    let excitorMask = null;

    if (e.data.structureData && e.data.structureData.length > 0) {
        // Generate masks using provided structure blocks
        // We pass the RAW image width/height to correctly map the blocks (which are in viewport pixels)
        // to the current downscaled canvas resolution.
        // e.data.imageBitmap.width is the SOURCE width.
        // width/height are the TARGET (downscaled) dimensions.
        const sourceW = e.data.imageBitmap.width;
        const sourceH = e.data.imageBitmap.height;

        const masks = generateStructureMasks(e.data.structureData, width, height, sourceW, sourceH);
        inhibitorMask = masks.inhibitor;
        excitorMask = masks.excitor;
    }

    // PASS 4: Combine normalized features with weights
    // Oklab provides cleaner perceptual separation, so equal weights often work well,
    // but we'll stick to established saliency weights.
    const W_I = 0.3;
    const W_RG = 0.35;
    const W_BY = 0.35;

    const saliency = new Float32Array(len);
    let maxVal = 0;

    for (let i = 0; i < len; i++) {
        // Raw Bottom-Up Saliency
        let val = W_I * norm_I[i] + W_RG * norm_RG[i] + W_BY * norm_BY[i];

        // --- PHASE 5: GATED SALIENCY (Cognitive Alignment) ---
        // Top-Down Modulation using Structure Data
        if (inhibitorMask && excitorMask) {
            // Formula: Final = (Raw * Inhibitor) + (Excitor * Boost)
            // Inhibitor: 0.0 for noise, 1.0 for content
            // Excitor: 0.0 for normal, 1.0 for interactive/important
            const inhibition = inhibitorMask[i];
            const excitation = excitorMask[i];

            // 1. Gating: Silence the noise
            // We use a safe floor (0.1) so real objects in empty space aren't TOTALLY invisible if structure misses them
            val *= (inhibition * 0.9 + 0.1);

            // 2. Boosting: Highlight the controls
            // Add excitation signal (boost factor 0.8 ensures buttons pop even if low contrast)
            val += (excitation * 0.8);
        }

        saliency[i] = val;
        if (val > maxVal) maxVal = val;
    }

    // PASS 4: Normalize & Write Output
    if (maxVal < 0.001) {
        console.warn('[Saliency] maxVal too low:', maxVal, '- using fallback');
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

    // Debug: Log stats occasionally
    if (Math.random() < 0.01) {
        console.log('[Saliency] maxVal:', maxVal.toFixed(4), 'len:', len);
    }

    // Send back the processed ImageData
    self.postMessage({
        imageData: imageData,
        id: id
    }, [imageData.data.buffer]);
};
