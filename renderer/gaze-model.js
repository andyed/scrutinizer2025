/**
 * GazeModel — Oculomotor system proxy
 *
 * Tracks the user's gaze position (via mouse or future eye-tracker input),
 * computes smoothed velocity, and detects saccadic vs fixation states.
 * Swappable: mouse proxy today, Tobii eye tracker tomorrow.
 *
 * Biological analog: Oculomotor system (saccade generator + smooth pursuit)
 *
 * @module GazeModel
 */
(() => {
    class GazeModel {
        /**
         * @param {Object} config
         * @param {number} config.maskSmoothness - Mouse smoothing alpha (0-1). Higher = snappier tracking.
         * @param {number} config.velocityDecayMove - Velocity EMA decay during movement (lower = smoother).
         * @param {number} config.velocityDecayStop - Velocity EMA decay when stopping (lower = smoother).
         * @param {number} config.saccadicSuppressionThreshold - Velocity (px/ms) above which saccadic suppression fires.
         * @param {HTMLCanvasElement} canvas - The overlay canvas (for coordinate scaling).
         */
        constructor(config, canvas) {
            this.config = config;
            this.canvas = canvas;

            // Position state (physical pixel coordinates)
            this.mouseX = 0;
            this.mouseY = 0;
            this.targetMouseX = 0;
            this.targetMouseY = 0;

            // Stable mouse for distortion (heavy hysteresis to prevent peripheral jiggle)
            this.stableMouseX = 0;
            this.stableMouseY = 0;

            // Velocity tracking
            this.lastMouseX = 0;
            this.lastMouseY = 0;
            this.lastUpdateTime = 0;
            this.currentVelocity = 0; // pixels per ms

            // Zoom (Electron browser zoom level)
            this.currentZoom = 1.0;

            // Coordinate scaling (set by handleMouseMove, used by SVG overlay)
            this.scaleX = 1.0;
            this.scaleY = 1.0;
        }

        /**
         * Handle raw mouse/gaze input event.
         * Converts from DOM coordinates to physical canvas pixels.
         * @param {Object} event - Mouse event with clientX, clientY, optional zoom
         */
        handleMouseMove(event) {
            const rect = this.canvas.getBoundingClientRect();

            // Guard against hidden canvas (display: none) causing divide by zero
            if (rect.width === 0 || rect.height === 0) return;

            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;

            // Store scale factors for reverse-projection (e.g., SVG overlay)
            this.scaleX = scaleX;
            this.scaleY = scaleY;

            if (event.zoom) {
                this.currentZoom = event.zoom;
            }

            const clientX = event.clientX;
            const clientY = event.clientY;

            this.targetMouseX = (clientX - rect.left) * scaleX;
            this.targetMouseY = (clientY - rect.top) * scaleY;
        }

        /**
         * Handle browser zoom change.
         * @param {number} zoom
         */
        handleZoomChanged(zoom) {
            this.currentZoom = zoom;
        }

        /**
         * Per-frame update: smooth mouse position, calculate velocity.
         * Call once per requestAnimationFrame.
         * @param {number} now - performance.now() timestamp
         * @returns {{ isSaccading: boolean }} - State flags for the current frame
         */
        update(now) {
            const dt = now - this.lastUpdateTime;
            this.lastUpdateTime = now;

            // Self-heal NaN/Infinity coordinates
            if (!Number.isFinite(this.mouseX) || !Number.isFinite(this.mouseY)) {
                console.warn('[GazeModel] Detected NaN/Infinity coordinates, resetting to center');
                this.mouseX = this.canvas.width / 2;
                this.mouseY = this.canvas.height / 2;
                this.targetMouseX = this.mouseX;
                this.targetMouseY = this.mouseY;
                this.currentVelocity = 0;
            }

            // Smooth mouse position (exponential lerp toward target)
            if (this.targetMouseX !== 0 || this.targetMouseY !== 0) {
                this.mouseX += (this.targetMouseX - this.mouseX) * this.config.maskSmoothness;
                this.mouseY += (this.targetMouseY - this.mouseY) * this.config.maskSmoothness;
            }

            // Calculate velocity (pixels per ms)
            const dx = this.mouseX - this.lastMouseX;
            const dy = this.mouseY - this.lastMouseY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const instantVelocity = dt > 0 ? dist / dt : 0;

            // Adaptive smoothing (time-based EMA)
            // Consistent behavior regardless of FPS
            // Target: 95% smoothing at 60fps (16ms) -> alpha ~0.05
            const decay = instantVelocity < 1.0
                ? this.config.velocityDecayStop
                : this.config.velocityDecayMove;
            const alpha = 1.0 - Math.exp(-decay * dt);
            this.currentVelocity = this.currentVelocity + (instantVelocity - this.currentVelocity) * alpha;

            this.lastMouseX = this.mouseX;
            this.lastMouseY = this.mouseY;

            return {
                isSaccading: this.currentVelocity > this.config.saccadicSuppressionThreshold
            };
        }

        /**
         * Get current smoothed gaze position in physical pixels.
         * @returns {{ x: number, y: number }}
         */
        getPosition() {
            return { x: this.mouseX, y: this.mouseY };
        }

        /**
         * Get current gaze velocity in pixels/ms.
         * @returns {number}
         */
        getVelocity() {
            return this.currentVelocity;
        }

        /**
         * Get coordinate scale factors (physical/CSS) for SVG overlay reverse-projection.
         * @returns {{ scaleX: number, scaleY: number }}
         */
        getScale() {
            return { scaleX: this.scaleX, scaleY: this.scaleY };
        }
    }

    // CommonJS + window export (Scrutinizer module pattern)
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = GazeModel;
    }
    window.GazeModel = GazeModel;
})();
