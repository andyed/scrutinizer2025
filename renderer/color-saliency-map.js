/**
 * ColorSaliencyMap: Computes visual attractiveness using Color Opponency + Intensity
 * 
 * This is an alternative implementation to the standard SaliencyMap.
 * It uses the Itti-Koch inspired color opponency model:
 * - Red-Green opponency
 * - Blue-Yellow opponency
 * - Intensity (Luminance)
 * 
 * This detects colorful regions as salient, not just high-contrast edges.
 */
class ColorSaliencyMap {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        this.ctx.imageSmoothingEnabled = false;

        this.width = 0;
        this.height = 0;
        this.scale = 0.25; // 25% resolution
    }

    resize(width, height) {
        // Adaptive Resolution Scaling (Phase 2)
        // Target a consistent max dimension (e.g., 256px) regardless of screen size.
        // This prevents performance degradation on 4K/5K displays.
        const TARGET_MAX_DIM = 256;
        const maxDim = Math.max(width, height);

        // Calculate scale to fit within target, but never upscale (max 1.0)
        this.scale = maxDim > 0 ? Math.min(1.0, TARGET_MAX_DIM / maxDim) : 0.25;

        const newWidth = Math.floor(width * this.scale);
        const newHeight = Math.floor(height * this.scale);

        if (this.width !== newWidth || this.height !== newHeight) {
            this.width = newWidth;
            this.height = newHeight;
            this.canvas.width = this.width;
            this.canvas.height = this.height;
            // Restore context state after resize
            this.ctx.imageSmoothingEnabled = false;
        }
    }

    computeFromImage(sourceImage) {
        // Draw source at reduced resolution
        this.ctx.drawImage(sourceImage, 0, 0, this.width, this.height);

        // Get pixel data
        const imageData = this.ctx.getImageData(0, 0, this.width, this.height);
        const pixels = imageData.data;
        const len = this.width * this.height;

        // Loop Fusion (Phase 2):
        // Eliminated intermediate Float32Arrays for I, RG, BY.
        // We now compute features and combine them in a single pass.

        const saliency = new Float32Array(len);
        let maxVal = 0;

        // Feature weight constants
        const W_I = 0.3;   // Intensity weight
        const W_RG = 0.35; // Red-Green opponency weight
        const W_BY = 0.35; // Blue-Yellow opponency weight

        // PASS 1: Extract & Combine
        for (let i = 0; i < len; i++) {
            const r = pixels[i * 4] / 255.0;
            const g = pixels[i * 4 + 1] / 255.0;
            const b = pixels[i * 4 + 2] / 255.0;

            // Intensity (ITU-R BT.709)
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
        if (maxVal < 0.001) maxVal = 1.0; // Prevent div by zero

        // Debug Log (Throttled)
        if (Math.random() < 0.01) {
            console.log(`[ColorSaliencyMap] MaxVal: ${maxVal.toFixed(4)}, Scale: ${this.scale.toFixed(3)}`);
        }

        for (let i = 0; i < len; i++) {
            // Normalize
            let val = saliency[i] / maxVal;

            // Boost contrast
            val = Math.pow(val, 0.8);

            const byteVal = Math.floor(val * 255);
            pixels[i * 4] = byteVal;
            pixels[i * 4 + 1] = byteVal;
            pixels[i * 4 + 2] = byteVal;
            pixels[i * 4 + 3] = 255;
        }

        this.ctx.putImageData(imageData, 0, 0);

        // Expose raw saliency data for downstream processing
        return {
            data: saliency,
            width: this.width,
            height: this.height,
            maxVal: maxVal
        };
    }

    clear() {
        this.ctx.fillStyle = 'black';
        this.ctx.fillRect(0, 0, this.width, this.height);
    }

    getCanvas() {
        return this.canvas;
    }
}

module.exports = ColorSaliencyMap;
