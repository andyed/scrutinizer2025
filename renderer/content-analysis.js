/**
 * ContentAnalysis — Pre-cortical feature extraction
 *
 * Orchestrates content analysis layers that feed the LGN gating stage:
 * structure map (Gestalt grouping), saliency map (visual attention),
 * and future analyzers (DoG decomposition, face detection, etc.).
 *
 * Each analyzer produces a texture that the shader reads via uniform.
 * The modes.json pipeline config (lgn_use_structure_mask, lgn_use_saliency_gate)
 * controls which analyzers are active per aesthetic mode.
 *
 * Biological analog: Pre-cortical feature extraction (retinal ganglion cells,
 * LGN magno/parvo pathways). Both biology and simulation solve the same problem:
 * selectively allocating limited processing bandwidth to high-value input.
 *
 * @module ContentAnalysis
 */
(() => {
    const Logger = require('./logger');
    const StructureMap = require('./structure-map.js');
    const PrimitiveMap = require('./primitive-map.js');
    const GestaltProcessor = require('./gestalt-processor.js');

    class ContentAnalysis {
        /**
         * @param {Object} options
         * @param {HTMLCanvasElement} options.canvas - Main overlay canvas (for sizing)
         * @param {Object} options.config - Scrutinizer config (enableStructureMap, enableSaliencyModulation)
         */
        constructor({ canvas, config }) {
            this.canvas = canvas;
            this.config = config;

            // ── Structure Map (Gestalt-based layout analysis) ────────
            this.structureMap = new StructureMap();
            this.gestaltProcessor = new GestaltProcessor();
            this.hasStructure = false;
            this.lastBlocks = null;
            this.lastGroupedBlocks = null;
            this.currentMode = 0;

            // ── Primitive Map (DOM-aware perception, parallel to structureMap) ──
            // Populated with primitive_type_id from the DOM classifier. Calibration
            // parameters (G/B/A) are zero-initialized for Stage 3; per-gaze
            // calibration lands with the compositor in Stage 5. See
            // docs/dom-aware-perception-plan.md.
            this.primitiveMap = new PrimitiveMap();

            // ── Saliency Map (Visual attention heatmap) ──────────────
            // Target canvas: raw worker output. Current canvas: smoothed for GPU.
            this.saliencyTargetCanvas = document.createElement('canvas');
            this.saliencyCurrentCanvas = null;
            this.saliencyUpdateCountdown = 0;
            this.saliencyFrameCounter = 0;
            this.saliencyWorker = null;
            this.saliencyMaxDimension = 256; // Configurable: 256/512

            this._initSaliencyWorker();

            // ── High-Res Congestion Worker (on-demand, 1024px default) ─
            // Separate worker for accurate congestion when report is toggled on.
            // Saliency worker congestion (256/512px) stays for real-time pooling modifier.
            this.congestionWorker = null;
            this._congestionWorkerBusy = false;
            this.congestionTargetCanvas = document.createElement('canvas');
            this.congestionCurrentCanvas = null;
            this.congestionUpdateCountdown = 0;
            this.congestionMaxDimension = 512; // Configurable: 256/512/1024/2048

            this._initCongestionWorker();

            // ── Complexity Stats ──────────────────────────────────────
            // Low-res stats from saliency worker (always available)
            this._saliencyCongestionStats = null;
            this._saliencyEdgeDensityStats = null;
            // High-res stats from congestion worker (when active)
            this._hiResCongestionStats = null;
            this._hiResEdgeDensityStats = null;
            // Public getters prefer high-res when available
            this.congestionStats = null;
            this.edgeDensityStats = null;
            // Generation counter: incremented each time congestion worker delivers fresh results
            this.congestionGeneration = 0;

            // ── Dirty-check checksums (skip redundant worker submissions) ──
            this._lastSaliencyChecksum = -1;
            this._lastCongestionChecksum = -1;
            this._saliencySkipCount = 0;

            // ── Debug / Visualization ────────────────────────────────
            this.showStructureMap = false;
            this.showSaliencyMap = false;
            this.debugStructure = 0.0; // 0=none, 1=structure, 2=saliency
        }

        /**
         * Initialize the saliency Web Worker.
         * @private
         */
        _initSaliencyWorker() {
            if (!window.Worker) {
                console.warn('[ContentAnalysis] Web Workers not available, saliency disabled');
                return;
            }

            // Cache-bust during development
            this.saliencyWorker = new Worker(`./saliency-worker.js?v=${Date.now()}`);

            this.saliencyWorker.onerror = (error) => {
                console.error('[ContentAnalysis] Saliency Worker Error:', error);
            };

            this.saliencyWorker.onmessage = (e) => {
                const { imageData, congestionStats, edgeDensityStats } = e.data;
                if (!imageData) return;

                // Store low-res stats from saliency worker
                this._saliencyCongestionStats = congestionStats || null;
                this._saliencyEdgeDensityStats = edgeDensityStats || null;
                // Public stats: prefer high-res when congestion worker has produced results
                if (!this._hiResCongestionStats) {
                    this.congestionStats = this._saliencyCongestionStats;
                    this.edgeDensityStats = this._saliencyEdgeDensityStats;
                }

                // Resize target canvas if dimensions changed (adaptive scaling)
                if (!this.saliencyTargetCanvas ||
                    this.saliencyTargetCanvas.width !== imageData.width ||
                    this.saliencyTargetCanvas.height !== imageData.height) {
                    this.saliencyTargetCanvas.width = imageData.width;
                    this.saliencyTargetCanvas.height = imageData.height;

                    if (!this.saliencyCurrentCanvas) {
                        this.saliencyCurrentCanvas = document.createElement('canvas');
                    }
                    this.saliencyCurrentCanvas.width = imageData.width;
                    this.saliencyCurrentCanvas.height = imageData.height;
                }

                // Update target canvas with raw worker output
                const ctx = this.saliencyTargetCanvas.getContext('2d');
                ctx.putImageData(imageData, 0, 0);

                // Trigger smoothing loop in render (60 frames = ~1 second)
                this.saliencyUpdateCountdown = 60;
            };
        }

        /**
         * Initialize the dedicated high-resolution congestion Web Worker.
         * @private
         */
        _initCongestionWorker() {
            if (!window.Worker) {
                console.warn('[ContentAnalysis] Web Workers not available, congestion worker disabled');
                return;
            }

            this.congestionWorker = new Worker(`./congestion-worker.js?v=${Date.now()}`);

            this.congestionWorker.onerror = (error) => {
                console.error('[ContentAnalysis] Congestion Worker Error:', error);
                this._congestionWorkerBusy = false;
            };

            this.congestionWorker.onmessage = (e) => {
                const { imageData, congestionStats, edgeDensityStats, resolution, computeTimeMs } = e.data;
                this._congestionWorkerBusy = false;

                if (!imageData) return;

                // Store high-res stats (these override saliency worker stats for HUD)
                this._hiResCongestionStats = congestionStats || null;
                this._hiResEdgeDensityStats = edgeDensityStats || null;
                this.congestionStats = this._hiResCongestionStats;
                this.edgeDensityStats = this._hiResEdgeDensityStats;
                this.congestionGeneration++;

                // Resize target canvas if dimensions changed
                if (!this.congestionTargetCanvas ||
                    this.congestionTargetCanvas.width !== imageData.width ||
                    this.congestionTargetCanvas.height !== imageData.height) {
                    this.congestionTargetCanvas.width = imageData.width;
                    this.congestionTargetCanvas.height = imageData.height;

                    if (!this.congestionCurrentCanvas) {
                        this.congestionCurrentCanvas = document.createElement('canvas');
                    }
                    this.congestionCurrentCanvas.width = imageData.width;
                    this.congestionCurrentCanvas.height = imageData.height;
                }

                // Update target canvas with raw worker output
                const ctx = this.congestionTargetCanvas.getContext('2d');
                ctx.putImageData(imageData, 0, 0);

                // Trigger smoothing (shorter than saliency — congestion is on-demand)
                this.congestionUpdateCountdown = 30;

                console.log(`[ContentAnalysis] High-res congestion ready: ${resolution.width}x${resolution.height} in ${computeTimeMs.toFixed(0)}ms`);
            };
        }

        /**
         * Submit a frame for high-resolution congestion analysis.
         * On-demand: only called when congestion report mode is active.
         * Debounced: skips if worker is still processing previous frame.
         *
         * @param {Uint8ClampedArray} imageDataBuffer - Raw BGRA pixel buffer
         * @param {number} width
         * @param {number} height
         * @param {boolean} [force=false] - Bypass dirty check (scroll/mutation/navigation)
         */
        submitForCongestion(imageDataBuffer, width, height, force = false) {
            if (!this.congestionWorker || this._congestionWorkerBusy || width <= 0 || height <= 0) return;

            // Dirty check: skip if frame content hasn't changed (unless forced)
            const congestionChecksum = this._computeFrameChecksum(imageDataBuffer, imageDataBuffer.length);
            if (!force && congestionChecksum === this._lastCongestionChecksum) return;
            this._lastCongestionChecksum = congestionChecksum;

            this._congestionWorkerBusy = true;

            // BGRA→RGBA swap (same as saliency path)
            const rgbaBuffer = new Uint8ClampedArray(imageDataBuffer);
            for (let i = 0; i < rgbaBuffer.length; i += 4) {
                const b = rgbaBuffer[i];
                rgbaBuffer[i] = rgbaBuffer[i + 2];
                rgbaBuffer[i + 2] = b;
            }
            const congestionImageData = new ImageData(rgbaBuffer, width, height);

            createImageBitmap(congestionImageData).then(bitmap => {
                this.congestionWorker.postMessage({
                    imageBitmap: bitmap,
                    id: Date.now(),
                    maxDimension: this.congestionMaxDimension
                }, [bitmap]);
            });
        }

        /**
         * Per-frame congestion smoothing: blend target → current to prevent flicker.
         * Mirrors saliency smoothing pattern. Call once per render frame.
         * @param {WebGLRenderer} renderer
         */
        updateCongestionSmoothing(renderer) {
            if (!this.congestionTargetCanvas || !this.congestionCurrentCanvas || this.congestionUpdateCountdown <= 0) {
                return;
            }

            const ctx = this.congestionCurrentCanvas.getContext('2d', { alpha: false });

            // Fast smooth (0.8 alpha)
            ctx.globalAlpha = 0.8;
            ctx.drawImage(this.congestionTargetCanvas, 0, 0);
            ctx.globalAlpha = 1.0;

            // Upload high-res congestion texture to GPU
            renderer.uploadCongestionMap(this.congestionCurrentCanvas);

            this.congestionUpdateCountdown--;
        }

        /**
         * Clear high-res congestion data (when report mode is turned off).
         * Resets stats to fall back to saliency worker's 256px data.
         * @param {WebGLRenderer} renderer
         */
        clearCongestionData(renderer) {
            this._hiResCongestionStats = null;
            this._hiResEdgeDensityStats = null;
            // Fall back to saliency worker stats
            this.congestionStats = this._saliencyCongestionStats;
            this.edgeDensityStats = this._saliencyEdgeDensityStats;
            this.congestionUpdateCountdown = 0;

            // Clear the congestion texture so shader falls back to saliency map
            if (renderer) {
                renderer.clearCongestionMap();
            }
        }

        /**
         * Set saliency worker resolution.
         * Higher resolution improves congestion ranking accuracy for pooling
         * but costs ~4x more compute per frame at 512 vs 256.
         * @param {number} maxDim - Maximum dimension (256 or 512)
         */
        setSaliencyResolution(maxDim) {
            this.saliencyMaxDimension = maxDim;
            this._lastSaliencyChecksum = -1; // Force recompute at new resolution
            console.log(`[ContentAnalysis] Saliency resolution set to: ${maxDim}px`);
        }

        /**
         * Set congestion worker resolution.
         * @param {number} maxDim - Maximum dimension (256, 512, 1024, or 2048)
         */
        setCongestionResolution(maxDim) {
            this.congestionMaxDimension = maxDim;
            this._lastCongestionChecksum = -1; // Force recompute at new resolution
            console.log(`[ContentAnalysis] Congestion resolution set to: ${maxDim}px`);
        }

        /**
         * Submit a frame for saliency analysis.
         * Throttled internally — call every frame, it will skip when not ready.
         * @param {Uint8ClampedArray} imageDataBuffer - Raw BGRA pixel buffer
         * @param {number} width
         * @param {number} height
         */
        submitFrameForSaliency(imageDataBuffer, width, height) {
            if (!this.saliencyWorker || width <= 0 || height <= 0) return;

            this.saliencyFrameCounter++;

            // Throttle: compute every 15 frames (~250ms at 60fps)
            if (this.saliencyFrameCounter % 15 !== 0) return;

            // Dirty check: skip if frame content hasn't changed since last submission
            const saliencyChecksum = this._computeFrameChecksum(imageDataBuffer, imageDataBuffer.length);
            if (saliencyChecksum === this._lastSaliencyChecksum) {
                this._saliencySkipCount++;
                if (this._saliencySkipCount === 10) {
                    Logger.log('[ContentAnalysis] Saliency: skipping unchanged frames');
                }
                return;
            }
            this._lastSaliencyChecksum = saliencyChecksum;
            if (this._saliencySkipCount > 0) {
                Logger.log(`[ContentAnalysis] Saliency: resumed after ${this._saliencySkipCount} skipped`);
                this._saliencySkipCount = 0;
            }

            // Create a copy for the async worker (main buffer is reused each frame)
            // Fix BGRA→RGBA: Electron's capturePage returns BGRA byte order,
            // but ImageData expects RGBA. Swap R↔B to get correct color features.
            const rgbaBuffer = new Uint8ClampedArray(imageDataBuffer);
            for (let i = 0; i < rgbaBuffer.length; i += 4) {
                const b = rgbaBuffer[i];
                rgbaBuffer[i] = rgbaBuffer[i + 2];     // R ← was B
                rgbaBuffer[i + 2] = b;                  // B ← was R
            }
            const saliencyImageData = new ImageData(rgbaBuffer, width, height);

            createImageBitmap(saliencyImageData).then(bitmap => {
                this.saliencyWorker.postMessage({
                    imageBitmap: bitmap,
                    id: this.saliencyFrameCounter,
                    structureData: this.lastGroupedBlocks || this.lastBlocks,
                    dpr: window.devicePixelRatio || 1,
                    maxDimension: this.saliencyMaxDimension
                }, [bitmap]);
            });
        }

        /**
         * Per-frame saliency smoothing: blend target → current to prevent flicker.
         * Call once per render frame.
         * @param {WebGLRenderer} renderer
         */
        updateSaliencySmoothing(renderer) {
            if (!this.saliencyTargetCanvas || !this.saliencyCurrentCanvas || this.saliencyUpdateCountdown <= 0) {
                return;
            }

            const ctx = this.saliencyCurrentCanvas.getContext('2d', { alpha: false });

            // Fast smooth (0.8 alpha) — Phase 2 fix for "ghosting" lag
            ctx.globalAlpha = 0.8;
            ctx.drawImage(this.saliencyTargetCanvas, 0, 0);
            ctx.globalAlpha = 1.0;

            // Upload smoothed saliency to GPU
            renderer.uploadSaliencyMap(this.saliencyCurrentCanvas);

            this.saliencyUpdateCountdown--;
        }

        // ── Structure Map ────────────────────────────────────────────

        /**
         * Set the current aesthetic mode ID (used to skip Gestalt for Blueprint).
         * @param {number} modeId - v4_style_id from modes.json
         */
        setAestheticMode(modeId) {
            this.currentMode = modeId;
        }

        /**
         * Handle incoming structure update from DOM analysis (via IPC).
         * @param {Array} blocks - Raw DOM blocks from content script
         * @param {WebGLRenderer} renderer - For uploading texture
         */
        handleStructureUpdate(blocks, renderer) {
            if (!renderer || !this.structureMap) return;

            // Skip redundant updates (prevents flicker on dynamic sites like YouTube)
            if (this._areBlocksEqual(this.lastBlocks, blocks)) return;
            this.lastBlocks = blocks;

            // Ensure maps match viewport
            this.structureMap.resize(this.canvas.width, this.canvas.height);
            this.structureMap.clear();
            this.primitiveMap.resize(this.canvas.width, this.canvas.height);
            this.primitiveMap.clear();

            // Gestalt grouping: merge adjacent text blocks into perceptual units
            const groupedBlocks = this.gestaltProcessor.process(blocks);
            this.lastGroupedBlocks = groupedBlocks;

            // Draw blocks onto structure texture
            // Gestalt merge preserves ariaRole (max role wins), so all modes
            // use grouped blocks for proper closure.
            //
            // Also populate the primitive map in parallel with type_id only;
            // calibration parameters (G/B/A) remain zero until Stage 5 wires
            // per-gaze calibration. Stage 3 is the data-plumbing step.
            const dpr = window.devicePixelRatio || 1;
            for (const block of groupedBlocks) {
                this.structureMap.drawBlock(
                    block.x * dpr,
                    block.y * dpr,
                    block.w * dpr,
                    block.h * dpr,
                    block.type,
                    block.density,
                    block.lineHeight,
                    block.ariaRole || 0
                );

                // Gestalt-merged blocks carry a `children` array of the original
                // primitives; fall back to the merged block itself if absent.
                const primitives = block.children || [block];
                for (const p of primitives) {
                    if (!p.primitiveType) continue;
                    this.primitiveMap.drawBlock(
                        p.x * dpr,
                        p.y * dpr,
                        p.w * dpr,
                        p.h * dpr,
                        p.primitiveType,
                        null  // zero G/B/A until Stage 5 calibration-per-gaze
                    );
                }
            }

            // Flush ImageData buffers to canvas before GPU upload
            this.structureMap.flush();
            this.primitiveMap.flush();

            // Upload to GPU
            renderer.uploadStructureMap(this.structureMap.getCanvas());
            renderer.uploadPrimitiveMap(this.primitiveMap.getCanvas());
            this.hasStructure = true;

            // Render debug annotations if structure visualization is active
            if (this.showStructureMap) {
                this.renderStructureAnnotations(blocks);
            }
        }

        // ── Debug Visualization ──────────────────────────────────────

        /**
         * Toggle structure map debug overlay.
         * @param {boolean} enabled
         */
        toggleStructureMapDebug(enabled) {
            this.showStructureMap = enabled;

            const container = document.getElementById('structure-annotations');
            if (container) {
                container.style.display = enabled ? 'block' : 'none';
                if (!enabled) container.innerHTML = '';
            }

            if (enabled && this.lastBlocks) {
                this.renderStructureAnnotations(this.lastBlocks);
            }

            this._updateDebugMode();
        }

        /**
         * Toggle saliency map debug overlay.
         * @param {boolean} enabled
         * @param {WebGLRenderer} [renderer]
         */
        toggleSaliencyMapDebug(enabled, renderer) {
            this.showSaliencyMap = enabled;
            this._updateDebugMode();

            if (enabled && this.saliencyCurrentCanvas && renderer) {
                renderer.uploadSaliencyMap(this.saliencyCurrentCanvas);
            }
        }

        /**
         * Toggle saliency modulation (bandwidth allocation in LGN).
         * @param {boolean} enabled
         */
        toggleSaliencyModulation(enabled) {
            this.config.enableSaliencyModulation = enabled;
            Logger.log(`[ContentAnalysis] Saliency modulation ${enabled ? 'enabled' : 'disabled'}`);
        }

        /**
         * Toggle structure map LGN input.
         * @param {boolean} enabled
         */
        toggleEnableStructureMap(enabled) {
            this.config.enableStructureMap = enabled;
        }

        /**
         * Get the current debug mode value for the shader uniform.
         * @returns {number} 0=none, 1=structure, 2=saliency
         */
        getDebugMode() {
            return this.debugStructure;
        }

        /**
         * Set debug level directly (for levels beyond structure/saliency toggles).
         * Levels 4 and 5 are oriented DoG diagnostics.
         * @param {number} level - 0=none, 1=structure, 2=saliency, 3=mask, 4=gradient field, 5=band weights
         */
        setDebugLevel(level) {
            // Clear toggle state when setting directly
            if (level !== 1) this.showStructureMap = false;
            if (level !== 2) this.showSaliencyMap = false;
            if (level === 1) this.showStructureMap = true;
            if (level === 2) this.showSaliencyMap = true;
            this.debugStructure = level;
        }

        /**
         * Update debug mode priority: Saliency (2.0) > Structure (1.0) > None (0.0)
         * @private
         */
        _updateDebugMode() {
            if (this.showSaliencyMap) {
                this.debugStructure = 2.0;
            } else if (this.showStructureMap) {
                this.debugStructure = 1.0;
            } else {
                this.debugStructure = 0.0;
            }
        }

        /**
         * Render lineHeight annotations on large text blocks as DOM elements.
         * @param {Array} blocks - Raw structure blocks
         */
        renderStructureAnnotations(blocks) {
            const container = document.getElementById('structure-annotations');
            if (!container) return;

            container.innerHTML = '';
            let count = 0;
            const maxAnnotations = 50;

            for (const block of blocks) {
                if (block.type < 0.9 || block.w < 60 || block.h < 16 || !block.lineHeight) continue;
                if (count >= maxAnnotations) break;

                const label = document.createElement('div');
                label.textContent = Math.round(block.lineHeight);
                label.style.cssText = `
                    position: absolute;
                    left: ${block.x + block.w - 30}px;
                    top: ${block.y}px;
                    font: bold 12px system-ui, sans-serif;
                    color: white;
                    background: rgba(0,0,0,0.7);
                    padding: 1px 3px;
                    border-radius: 2px;
                    pointer-events: none;
                `;
                container.appendChild(label);
                count++;
            }
        }

        // ── Utility ──────────────────────────────────────────────────

        /**
         * Fast pixel-sample checksum for content-change detection.
         * Samples ~1024 evenly-spaced pixels from a raw BGRA/RGBA buffer
         * and returns a checksum. Cost: ~0.01ms on a 1920x1080 frame.
         * @param {Uint8ClampedArray} buffer - Raw pixel buffer
         * @param {number} length - Buffer byte length
         * @returns {number} 32-bit checksum (two 16-bit halves packed)
         * @private
         */
        _computeFrameChecksum(buffer, length) {
            const SAMPLE_COUNT = 1024;
            const stride = Math.max(4, Math.floor(length / (SAMPLE_COUNT * 4)) * 4);
            let sumA = 0;
            let sumB = 0;
            for (let i = 0; i < length; i += stride) {
                sumA = (sumA + buffer[i] + buffer[i + 1]) | 0;
                sumB = (sumB + buffer[i + 2]) | 0;
            }
            return ((sumA & 0xFFFF) << 16) | (sumB & 0xFFFF);
        }

        /**
         * Reset dirty-check checksums (call on navigation or resolution change).
         * Forces next submission to go through regardless of content.
         */
        resetDirtyChecks() {
            this._lastSaliencyChecksum = -1;
            this._lastCongestionChecksum = -1;
        }

        /**
         * Compare two block arrays for equality (skip redundant updates).
         * @private
         */
        _areBlocksEqual(prev, next) {
            if (!prev && !next) return true;
            if (!prev || !next) return false;
            if (prev.length !== next.length) return false;

            const EPSILON = 0.1;
            for (let i = 0; i < prev.length; i++) {
                const p = prev[i];
                const n = next[i];
                if (Math.abs(p.x - n.x) > EPSILON ||
                    Math.abs(p.y - n.y) > EPSILON ||
                    Math.abs(p.w - n.w) > EPSILON ||
                    Math.abs(p.h - n.h) > EPSILON ||
                    p.type !== n.type ||
                    Math.abs(p.lineHeight - n.lineHeight) > EPSILON ||
                    Math.abs(p.density - n.density) > EPSILON) {
                    return false;
                }
            }
            return true;
        }

        /**
         * Get structure/saliency state flags for the pipeline orchestrator.
         * @returns {{ hasStructure: boolean, enableStructureMap: boolean, enableSaliencyModulation: boolean }}
         */
        getState() {
            return {
                hasStructure: this.hasStructure,
                enableStructureMap: this.config.enableStructureMap,
                enableSaliencyModulation: this.config.enableSaliencyModulation,
                congestionStats: this.congestionStats,
                edgeDensityStats: this.edgeDensityStats
            };
        }
    }

    // CommonJS + window export (Scrutinizer module pattern)
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ContentAnalysis;
    }
    window.ContentAnalysis = ContentAnalysis;
})();
