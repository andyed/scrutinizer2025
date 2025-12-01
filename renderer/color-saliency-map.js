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

        const saliency = new Float32Array(len);

        // Feature Maps
        const I = new Float32Array(len); // Intensity
        const RG = new Float32Array(len); // Red-Green
        const BY = new Float32Array(len); // Blue-Yellow

        let maxVal = 0;

        // 1. Extract Features
        for (let i = 0; i < len; i++) {
            const r = pixels[i * 4] / 255.0;
            const g = pixels[i * 4 + 1] / 255.0;
            const b = pixels[i * 4 + 2] / 255.0;

            // Intensity
            const intensity = (r + g + b) / 3.0;
            I[i] = intensity;

            // Color Opponency
            // R-G: |R - G|
            // B-Y: |B - (R+G)/2|
            RG[i] = Math.abs(r - g);
            BY[i] = Math.abs(b - (r + g) / 2.0);
        }

        // 2. Combine Features (Linear Combination)
        // Weights: Intensity=0.3, Color=0.7 (Bias towards color)
        for (let i = 0; i < len; i++) {
            const val = 0.3 * I[i] + 0.35 * RG[i] + 0.35 * BY[i];
            saliency[i] = val;
            if (val > maxVal) maxVal = val;
        }

        // 3. Normalize & Write Output
        if (maxVal < 0.001) maxVal = 1.0; // Prevent div by zero

        // Debug Log (Throttled)
        if (Math.random() < 0.01) {
            console.log(`[ColorSaliencyMap] MaxVal: ${maxVal.toFixed(4)}`);
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
