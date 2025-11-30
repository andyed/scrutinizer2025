/**
 * SaliencyMap: Computes visual attractiveness using edge detection and contrast analysis
 * 
 * Generates a continuous, gradient-based saliency map that predicts where the eye is drawn
 * based on computational attractiveness (not discrete heuristics).
 */
class SaliencyMap {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        this.ctx.imageSmoothingEnabled = false;

        this.width = 0;
        this.height = 0;
        this.scale = 0.25; // 25% resolution for performance (interpolated by GPU)
    }

    /**
     * Resize the saliency map canvas
     */
    resize(width, height) {
        const newWidth = Math.floor(width * this.scale);
        const newHeight = Math.floor(height * this.scale);

        if (this.width !== newWidth || this.height !== newHeight) {
            this.width = newWidth;
            this.height = newHeight;
            this.canvas.width = this.width;
            this.canvas.height = this.height;
        }
    }

    /**
     * Compute saliency map from source image
     * @param {HTMLCanvasElement|HTMLImageElement} sourceImage - Source to analyze
     */
    computeFromImage(sourceImage) {
        // Draw source at reduced resolution
        this.ctx.drawImage(sourceImage, 0, 0, this.width, this.height);

        // Get pixel data
        const imageData = this.ctx.getImageData(0, 0, this.width, this.height);
        const pixels = imageData.data;

        // Step 1: Compute luminance map
        const luminance = new Float32Array(this.width * this.height);
        for (let i = 0; i < pixels.length; i += 4) {
            const idx = i / 4;
            luminance[idx] = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
        }

        // Step 2: Edge detection (Sobel operator)
        const edges = this.sobelEdgeDetection(luminance, this.width, this.height);

        // Step 3: Color contrast (simplified: use edge magnitude as proxy)
        // In future: convert to Lab space and compute local color difference

        // Step 4: Combine and normalize
        const saliency = new Uint8ClampedArray(this.width * this.height);
        let maxEdge = 0;
        for (let i = 0; i < edges.length; i++) {
            maxEdge = Math.max(maxEdge, edges[i]);
        }

        for (let i = 0; i < edges.length; i++) {
            saliency[i] = Math.floor((edges[i] / maxEdge) * 255);
        }

        // Step 5: Gaussian blur for smooth gradients
        const blurred = this.gaussianBlur(saliency, this.width, this.height, 5); // sigma=5px

        // Write back to canvas as grayscale
        for (let i = 0; i < blurred.length; i++) {
            const val = blurred[i];
            pixels[i * 4] = val;       // R
            pixels[i * 4 + 1] = val;   // G
            pixels[i * 4 + 2] = val;   // B
            pixels[i * 4 + 3] = 255;   // A
        }

        this.ctx.putImageData(imageData, 0, 0);
    }

    /**
     * Sobel edge detection
     * Returns edge magnitude for each pixel
     */
    sobelEdgeDetection(luminance, width, height) {
        const edges = new Float32Array(width * height);

        // Sobel kernels
        const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
        const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                let gx = 0;
                let gy = 0;

                // Convolve 3x3 neighborhood
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        const idx = (y + ky) * width + (x + kx);
                        const kernelIdx = (ky + 1) * 3 + (kx + 1);

                        gx += luminance[idx] * sobelX[kernelIdx];
                        gy += luminance[idx] * sobelY[kernelIdx];
                    }
                }

                // Gradient magnitude
                edges[y * width + x] = Math.sqrt(gx * gx + gy * gy);
            }
        }

        return edges;
    }

    /**
     * Gaussian blur for smooth gradients
     * Simplified box blur (3 passes approximates Gaussian)
     */
    gaussianBlur(data, width, height, radius) {
        let src = new Uint8ClampedArray(data);
        let dst = new Uint8ClampedArray(data.length);

        // 3 passes of box blur approximates Gaussian
        for (let pass = 0; pass < 3; pass++) {
            // Horizontal pass
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    let sum = 0;
                    let count = 0;

                    for (let kx = -radius; kx <= radius; kx++) {
                        const sx = x + kx;
                        if (sx >= 0 && sx < width) {
                            sum += src[y * width + sx];
                            count++;
                        }
                    }

                    dst[y * width + x] = sum / count;
                }
            }

            // Vertical pass
            [src, dst] = [dst, src];
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    let sum = 0;
                    let count = 0;

                    for (let ky = -radius; ky <= radius; ky++) {
                        const sy = y + ky;
                        if (sy >= 0 && sy < height) {
                            sum += src[sy * width + x];
                            count++;
                        }
                    }

                    dst[y * width + x] = sum / count;
                }
            }

            [src, dst] = [dst, src];
        }

        return src;
    }

    /**
     * Clear the saliency map to black (low saliency everywhere)
     */
    clear() {
        this.ctx.fillStyle = 'black';
        this.ctx.fillRect(0, 0, this.width, this.height);
    }

    /**
     * Get the canvas for texture upload
     */
    getCanvas() {
        return this.canvas;
    }
}

module.exports = SaliencyMap;
