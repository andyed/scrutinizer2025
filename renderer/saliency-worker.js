/**
 * Saliency Computation Worker
 * Handles expensive pixel processing off the main thread.
 */

let canvas;
let ctx;
let width = 0;
let height = 0;


self.onmessage = function (e) {
    const { imageBitmap, id } = e.data;

    if (!imageBitmap) return;

    // Adaptive Resolution Scaling (Phase 2)
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

    // Loop Fusion (Phase 2)
    const saliency = new Float32Array(len);
    let maxVal = 0;

    // Feature weight constants
    const W_I = 0.3;
    const W_RG = 0.35;
    const W_BY = 0.35;

    // PASS 1: Extract & Combine
    for (let i = 0; i < len; i++) {
        const r = pixels[i * 4] / 255.0;
        const g = pixels[i * 4 + 1] / 255.0;
        const b = pixels[i * 4 + 2] / 255.0;

        // Intensity
        const intensity = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        // Color Opponency
        const rg = Math.abs(r - g);
        const by = Math.abs(b - (r + g) / 2.0);

        // Weighted Sum
        const val = W_I * intensity + W_RG * rg + W_BY * by;

        saliency[i] = val;
        if (val > maxVal) maxVal = val;
    }

    // PASS 2: Normalize & Write Output
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
    // imageData.data.buffer is transferable
    self.postMessage({
        imageData: imageData,
        id: id
    }, [imageData.data.buffer]);
};
