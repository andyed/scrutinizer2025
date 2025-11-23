/**
 * Image processing utilities for Scrutinizer effect
 * Handles desaturation and blur operations on canvas ImageData
 */

class ImageProcessor {
    constructor(config) {
        this.config = config;
    }

    /**
     * Desaturate image data using ColorMatrix luminance weights
     * Based on the original ActionScript ColorMatrix implementation
     * @param {ImageData} imageData - Canvas ImageData to process
     * @returns {ImageData} Desaturated image data
     */
    desaturate(imageData) {
        const data = imageData.data;
        const { LUM_R, LUM_G, LUM_B, desaturationAmount } = this.config;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // Calculate luminance using ColorMatrix weights
            const gray = r * LUM_R + g * LUM_G + b * LUM_B;

            // Blend between original and grayscale based on desaturation amount
            data[i] = r + (gray - r) * desaturationAmount;
            data[i + 1] = g + (gray - g) * desaturationAmount;
            data[i + 2] = b + (gray - b) * desaturationAmount;
            // Force alpha to 255 (fully opaque) to prevent see-through to webview
            data[i + 3] = 255;
        }

        return imageData;
    }

    /**
     * Build a simple multi-resolution pyramid from a base image.
     * Levels[0] is sharp, higher indices are progressively more blurred.
     * @param {ImageData} baseData
     * @param {number[]} radii - blur radii for each additional level
     * @returns {ImageData[]} array of ImageData levels
     */
    buildPyramid(baseData, radii) {
        const levels = [baseData];
        for (const r of radii) {
            const copy = new ImageData(new Uint8ClampedArray(baseData.data), baseData.width, baseData.height);
            levels.push(this.blur(copy, r));
        }
        return levels;
    }

    /**
     * Apply box blur to image data
     * Uses a simple box blur for performance (can be upgraded to Gaussian)
     * @param {ImageData} imageData - Canvas ImageData to blur
     * @param {number} radius - Blur radius in pixels
     * @returns {ImageData} Blurred image data
     */
    blur(imageData, radius) {
        if (radius <= 0) return imageData;

        const width = imageData.width;
        const height = imageData.height;
        const data = imageData.data;

        // Create buffers for the 3 passes
        // We need to copy data back and forth
        const buffer1 = new Uint8ClampedArray(data);
        const buffer2 = new Uint8ClampedArray(data);

        // 3 passes of box blur approximates Gaussian blur
        // Pass 1
        this.boxBlurHorizontal(buffer1, buffer2, width, height, radius);
        this.boxBlurVertical(buffer2, buffer1, width, height, radius);

        // Pass 2
        this.boxBlurHorizontal(buffer1, buffer2, width, height, radius);
        this.boxBlurVertical(buffer2, buffer1, width, height, radius);

        // Pass 3
        this.boxBlurHorizontal(buffer1, buffer2, width, height, radius);
        this.boxBlurVertical(buffer2, data, width, height, radius); // Write final result back to data

        return imageData;
    }

    /**
     * Horizontal box blur pass
     * @private
     */
    boxBlurHorizontal(input, output, width, height, radius) {
        const diameter = radius * 2 + 1;

        for (let y = 0; y < height; y++) {
            let r = 0, g = 0, b = 0, a = 0;

            // Initialize with leftmost pixels
            for (let x = -radius; x <= radius; x++) {
                const px = Math.max(0, Math.min(width - 1, x));
                const idx = (y * width + px) * 4;
                r += input[idx];
                g += input[idx + 1];
                b += input[idx + 2];
                a += input[idx + 3];
            }

            // Slide the window across
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                output[idx] = r / diameter;
                output[idx + 1] = g / diameter;
                output[idx + 2] = b / diameter;
                output[idx + 3] = a / diameter;

                // Remove leftmost pixel, add rightmost pixel
                const leftPx = Math.max(0, x - radius);
                const rightPx = Math.min(width - 1, x + radius + 1);

                const leftIdx = (y * width + leftPx) * 4;
                const rightIdx = (y * width + rightPx) * 4;

                r += input[rightIdx] - input[leftIdx];
                g += input[rightIdx + 1] - input[leftIdx + 1];
                b += input[rightIdx + 2] - input[leftIdx + 2];
                a += input[rightIdx + 3] - input[leftIdx + 3];
            }
        }
    }

    /**
     * Blend between a sharp and blurred image based on distance from a fixation point.
     * The farther from (cx, cy), the more weight goes to the blurred image, creating
     * a gradual low-pass filter that increases with eccentricity.
     *
     * @param {ImageData} sharpData - Original (sharp) image data
     * @param {ImageData} blurredData - Fully blurred image data
     * @param {number} cx - Fixation x coordinate in pixels
     * @param {number} cy - Fixation y coordinate in pixels
     * @param {number} innerRadius - Radius of (mostly) sharp foveal region
     * @param {number} outerRadius - Radius where blur reaches full strength
     * @returns {ImageData} - Radially blended ImageData
     */
    radialBlend(sharpData, blurredData, cx, cy, innerRadius, outerRadius) {
        const width = sharpData.width;
        const height = sharpData.height;
        const sharp = sharpData.data;
        const blur = blurredData.data;

        const result = new ImageData(new Uint8ClampedArray(sharp.length), width, height);
        const out = result.data;

        const inner2 = innerRadius * innerRadius;
        const outer2 = outerRadius * outerRadius;
        const range = Math.max(outer2 - inner2, 1);

        for (let y = 0; y < height; y++) {
            const dy = y - cy;
            for (let x = 0; x < width; x++) {
                const dx = x - cx;
                const idx = (y * width + x) * 4;

                const d2 = dx * dx + dy * dy;

                let t;
                if (d2 <= inner2) {
                    t = 0; // fully sharp
                } else if (d2 >= outer2) {
                    t = 1; // fully blurred
                } else {
                    // Smoothly increase blur weight between inner and outer radii.
                    // Use a cubic easing to more aggressively approximate rapid, non-linear acuity decay.
                    const norm = (d2 - inner2) / range; // 0..1
                    t = norm * norm * norm;
                }

                const invT = 1 - t;

                out[idx]     = sharp[idx]     * invT + blur[idx]     * t;
                out[idx + 1] = sharp[idx + 1] * invT + blur[idx + 1] * t;
                out[idx + 2] = sharp[idx + 2] * invT + blur[idx + 2] * t;
                out[idx + 3] = 255;
            }
        }

        return result;
    }

    /**
     * Vertical box blur pass
     * @private
     */
    boxBlurVertical(input, output, width, height, radius) {
        const diameter = radius * 2 + 1;

        for (let x = 0; x < width; x++) {
            let r = 0, g = 0, b = 0, a = 0;

            // Initialize with topmost pixels
            for (let y = -radius; y <= radius; y++) {
                const py = Math.max(0, Math.min(height - 1, y));
                const idx = (py * width + x) * 4;
                r += input[idx];
                g += input[idx + 1];
                b += input[idx + 2];
                a += input[idx + 3];
            }

            // Slide the window down
            for (let y = 0; y < height; y++) {
                const idx = (y * width + x) * 4;
                output[idx] = r / diameter;
                output[idx + 1] = g / diameter;
                output[idx + 2] = b / diameter;
                output[idx + 3] = a / diameter;

                // Remove topmost pixel, add bottommost pixel
                const topPy = Math.max(0, y - radius);
                const bottomPy = Math.min(height - 1, y + radius + 1);

                const topIdx = (topPy * width + x) * 4;
                const bottomIdx = (bottomPy * width + x) * 4;

                r += input[bottomIdx] - input[topIdx];
                g += input[bottomIdx + 1] - input[topIdx + 1];
                b += input[bottomIdx + 2] - input[topIdx + 2];
                a += input[bottomIdx + 3] - input[topIdx + 3];
            }
        }
    }

    /**
     * Apply foveal mask to context
     * Creates a circular cutout revealing the original content
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {number} x - Center X position
     * @param {number} y - Center Y position
     * @param {number} radius - Foveal radius
     */
    applyFovealMask(ctx, x, y, radius) {
        // Use destination-out compositing to create a hole
        ctx.globalCompositeOperation = 'destination-out';

        // Draw circle with soft edge for more natural appearance
        const gradient = ctx.createRadialGradient(x, y, radius * 0.8, x, y, radius);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        // Reset composite operation
        ctx.globalCompositeOperation = 'source-over';
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ImageProcessor;
}
