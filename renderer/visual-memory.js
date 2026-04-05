/**
 * VisualMemory — Visuospatial working memory simulation
 *
 * Tracks where the user has fixated (via GazeModel velocity), maintains a
 * buffer of remembered locations, and renders a soft mask texture that the
 * shader uses to inhibit peripheral distortion in recently-attended areas.
 *
 * Biological analog: Visuospatial sketchpad (Baddeley & Hitch, 1974)
 * — limited capacity, time-decaying, inhibition of return.
 *
 * @module VisualMemory
 */
(() => {
    class VisualMemory {
        /**
         * @param {Object} config
         * @param {number} config.fixationVelocityThreshold - Max velocity (px/ms) to count as fixation.
         * @param {number} config.dwellTimeThreshold - Ms of fixation before memory point is recorded.
         * @param {number} config.foveaBypassMargin - Fraction of foveal radius for merging nearby fixations.
         * @param {HTMLCanvasElement} canvas - The main overlay canvas (for sizing the mask).
         */
        constructor(config, canvas) {
            this.config = config;
            this.canvas = canvas;

            // Memory buffer: array of { x, y, radius, timestamp }
            this.buffer = [];

            // Fixation state machine
            this.isFixating = false;
            this.fixationStartTime = 0;

            // Mask canvas (1/4 resolution for performance)
            this.maskCanvas = document.createElement('canvas');
            this.maskCtx = this.maskCanvas.getContext('2d', { alpha: true });
            this.maskDirty = true;

            // Memory mode
            // 0 = Off, positive integer = FIFO limit, -1 = infinite
            this.limit = 0;
            this.inhibitionMode = false;
        }

        /**
         * Resize the mask canvas to match the overlay canvas.
         * Called on window resize.
         * @param {number} canvasWidth - Physical pixel width
         * @param {number} canvasHeight - Physical pixel height
         */
        resize(canvasWidth, canvasHeight) {
            const maskScale = 0.25;
            this.maskCanvas.width = Math.ceil(canvasWidth * maskScale);
            this.maskCanvas.height = Math.ceil(canvasHeight * maskScale);

            // Clear to black on resize
            this.maskCtx.fillStyle = 'black';
            this.maskCtx.fillRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
            this.maskDirty = true;
        }

        /**
         * Set the memory limit (mode).
         *  0 = Off (no memory effect)
         *  positive int = FIFO buffer size (limited memory)
         *  -1 = Infinite (never forget)
         *  20 = Special: Inhibition of Return mode (limit=10, inverted mask)
         * @param {number} rawLimit
         */
        setLimit(rawLimit) {
            const limit = Number(rawLimit);

            if (limit === 20) {
                // Special code: Inhibition of Return
                this.limit = 10;
                this.inhibitionMode = true;
            } else {
                this.limit = limit;
                this.inhibitionMode = false;
            }

            // Always reset when changing modes to prevent "ghosts"
            this.reset();
        }

        /**
         * @returns {number} Current memory limit
         */
        getLimit() {
            return this.limit;
        }

        /**
         * @returns {boolean} Whether inhibition-of-return mode is active
         */
        isInhibitionMode() {
            return this.inhibitionMode;
        }

        /**
         * Clear all memory points and reset mask.
         */
        reset() {
            this.buffer = [];
            this.isFixating = false;
            this.fixationStartTime = 0;
            this.maskCtx.globalCompositeOperation = 'source-over';
            this.maskCtx.fillStyle = 'black';
            this.maskCtx.fillRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
            this.maskDirty = true;
        }

        /**
         * @returns {boolean} Whether visual memory is active (limit != 0)
         */
        isActive() {
            // Use loose equality to handle '0' string vs 0 number (robustness)
            return this.limit != 0;
        }

        /**
         * Per-frame update: detect fixations and update memory buffer.
         * @param {number} now - performance.now() timestamp
         * @param {number} mouseX - Smoothed gaze X (physical pixels)
         * @param {number} mouseY - Smoothed gaze Y (physical pixels)
         * @param {number} velocity - Current gaze velocity (px/ms)
         * @param {number} fovealRadius - Current effective foveal radius
         */
        update(now, mouseX, mouseY, velocity, fovealRadius) {
            if (!this.isActive()) {
                // Memory off: ensure buffer is cleared
                if (this.buffer.length > 0) {
                    this.buffer = [];
                    this.isFixating = false;
                    this.fixationStartTime = 0;
                }
                return;
            }

            // Bounds check: must be strictly inside the canvas
            const isInside = mouseX > 0 && mouseX < this.canvas.width &&
                mouseY > 0 && mouseY < this.canvas.height;
            if (!isInside) return;

            // Velocity-based fixation detection
            // Threshold 0.1 px/ms = 100px/s
            if (velocity < 0.1) {
                if (!this.isFixating) {
                    this.isFixating = true;
                    this.fixationStartTime = now;
                } else {
                    const dwellTime = now - this.fixationStartTime;
                    if (dwellTime > this.config.dwellTimeThreshold) {
                        this._recordFixation(now, mouseX, mouseY, fovealRadius);
                    }
                }
            } else {
                this.isFixating = false;
                this.fixationStartTime = 0;
            }
        }

        /**
         * Record a fixation point, merging with nearby existing points.
         * @private
         */
        _recordFixation(now, mouseX, mouseY, fovealRadius) {
            // Check if we are close to an existing point (merge instead of adding new)
            const mergeRadius = fovealRadius * this.config.foveaBypassMargin;
            const existingIndex = this.buffer.findIndex(p => {
                const dx = p.x - mouseX;
                const dy = p.y - mouseY;
                return Math.sqrt(dx * dx + dy * dy) < mergeRadius;
            });

            if (existingIndex !== -1) {
                // Update existing point's position and timestamp
                this.buffer[existingIndex].x = mouseX;
                this.buffer[existingIndex].y = mouseY;
                this.buffer[existingIndex].timestamp = now;
            } else {
                // Add new fixation point.
                // Memory radius extends to parafovea (~2.5× foveal radius) because
                // fixations retain information from the full useful field, not just
                // the foveal peak. This matches the perceptual span during scene viewing.
                this.buffer.push({
                    x: mouseX,
                    y: mouseY,
                    radius: fovealRadius * 2.5,
                    timestamp: now
                });

                // Enforce FIFO limit
                // limit > 0: evict oldest when full
                // limit == -1: infinite (no eviction)
                if (this.limit > 0 && this.buffer.length > this.limit) {
                    this.buffer.shift();
                }
            }
        }

        /**
         * Render the mask texture from current buffer.
         * White = remembered (reduce distortion), Black = forgotten.
         * @param {WebGLRenderer} renderer - For uploading mask to GPU
         */
        renderMask(renderer) {
            if (!this.isActive()) return;

            // Clear to transparent black
            this.maskCtx.globalCompositeOperation = 'source-over';
            this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);

            const maskScaleX = this.maskCanvas.width / this.canvas.width;
            const maskScaleY = this.maskCanvas.height / this.canvas.height;

            // Additive blending for overlapping fixation circles
            this.maskCtx.globalCompositeOperation = 'screen';

            for (const point of this.buffer) {
                const maskX = point.x * maskScaleX;
                const maskY = point.y * maskScaleY;
                const maskRadius = point.radius * maskScaleX;

                const hasReadingSpan = point.vdx !== undefined && point.vdy !== undefined
                    && (point.vdx !== 0 || point.vdy !== 0);

                if (hasReadingSpan) {
                    // Rayner reading span: asymmetric elliptical gradient
                    // Perceptual span ~1.3° left, ~5° right (Rayner 1998).
                    // Shift center 0.7r in reading direction (matches peripheral.frag line 1895).
                    // Stretch 1.5x forward, 0.8x backward.
                    const angle = Math.atan2(point.vdy, point.vdx);
                    const shiftAmount = maskRadius * 0.7;

                    this.maskCtx.save();
                    this.maskCtx.translate(maskX, maskY);
                    this.maskCtx.rotate(angle);
                    // Shift center in reading direction (forward = +x in rotated space)
                    this.maskCtx.translate(shiftAmount, 0);
                    // Asymmetric scale: elongate forward, compress backward
                    this.maskCtx.scale(1.5, 0.8);

                    const gradient = this.maskCtx.createRadialGradient(0, 0, 0, 0, 0, maskRadius);
                    gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
                    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
                    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

                    this.maskCtx.fillStyle = gradient;
                    this.maskCtx.beginPath();
                    this.maskCtx.arc(0, 0, maskRadius, 0, Math.PI * 2);
                    this.maskCtx.fill();
                    this.maskCtx.restore();
                } else {
                    // Standard symmetric circular gradient
                    const gradient = this.maskCtx.createRadialGradient(
                        maskX, maskY, 0,
                        maskX, maskY, maskRadius
                    );
                    gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
                    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
                    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

                    this.maskCtx.fillStyle = gradient;
                    this.maskCtx.beginPath();
                    this.maskCtx.arc(maskX, maskY, maskRadius, 0, Math.PI * 2);
                    this.maskCtx.fill();
                }
            }

            // Upload mask to GPU
            renderer.uploadMask(this.maskCanvas);
        }

        /**
         * Get the mask canvas element (for direct upload if needed).
         * @returns {HTMLCanvasElement}
         */
        getMaskCanvas() {
            return this.maskCanvas;
        }
    }

    // CommonJS + window export (Scrutinizer module pattern)
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = VisualMemory;
    }
    window.VisualMemory = VisualMemory;
})();
