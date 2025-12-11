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

    // Fine scale (σ=1.0)
    const fine = gaussianBlur(feature, width, height, 1.0);

    // Coarse scale (σ=3.0)
    const coarse = gaussianBlur(feature, width, height, 3.0);

    // Difference-of-Gaussians
    for (let i = 0; i < len; i++) {
        result[i] = Math.abs(fine[i] - coarse[i]);
    }

    return result;
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
    const I = new Float32Array(len);   // Intensity
    const RG = new Float32Array(len);  // Red-Green opponency
    const BY = new Float32Array(len);  // Blue-Yellow opponency

    // PASS 1: Extract features
    for (let i = 0; i < len; i++) {
        const r = pixels[i * 4] / 255.0;
        const g = pixels[i * 4 + 1] / 255.0;
        const b = pixels[i * 4 + 2] / 255.0;

        // Intensity (ITU-R BT.709)
        I[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        // Color Opponency
        RG[i] = Math.abs(r - g);
        BY[i] = Math.abs(b - (r + g) / 2.0);
    }

    // PASS 2: Compute center-surround for each feature
    const cs_I = computeCenterSurround(I, width, height);
    const cs_RG = computeCenterSurround(RG, width, height);
    const cs_BY = computeCenterSurround(BY, width, height);

    // PASS 3: Combine with weights
    const W_I = 0.3;
    const W_RG = 0.35;
    const W_BY = 0.35;

    const saliency = new Float32Array(len);
    let maxVal = 0;

    for (let i = 0; i < len; i++) {
        const val = W_I * cs_I[i] + W_RG * cs_RG[i] + W_BY * cs_BY[i];
        saliency[i] = val;
        if (val > maxVal) maxVal = val;
    }

    // PASS 4: Normalize & Write Output
    if (maxVal < 0.001) maxVal = 1.0;

    for (let i = 0; i < len; i++) {
        let val = saliency[i] / maxVal;
        val = Math.pow(val, 0.8); // Boost contrast

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
