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

            // ── Saliency Map (Visual attention heatmap) ──────────────
            // Target canvas: raw worker output. Current canvas: smoothed for GPU.
            this.saliencyTargetCanvas = document.createElement('canvas');
            this.saliencyCurrentCanvas = null;
            this.saliencyUpdateCountdown = 0;
            this.saliencyFrameCounter = 0;
            this.saliencyWorker = null;

            this._initSaliencyWorker();

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
                const { imageData } = e.data;
                if (!imageData) return;

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
                    dpr: window.devicePixelRatio || 1
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
         * Handle incoming structure update from DOM analysis (via IPC).
         * @param {Array} blocks - Raw DOM blocks from content script
         * @param {WebGLRenderer} renderer - For uploading texture
         */
        handleStructureUpdate(blocks, renderer) {
            if (!renderer || !this.structureMap) return;

            // Skip redundant updates (prevents flicker on dynamic sites like YouTube)
            if (this._areBlocksEqual(this.lastBlocks, blocks)) return;
            this.lastBlocks = blocks;

            // Ensure map matches viewport
            this.structureMap.resize(this.canvas.width, this.canvas.height);
            this.structureMap.clear();

            // Gestalt grouping: merge adjacent text blocks into perceptual units
            const groupedBlocks = this.gestaltProcessor.process(blocks);
            this.lastGroupedBlocks = groupedBlocks;

            // Draw blocks onto structure texture
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
                    block.color
                );
            }

            // Upload to GPU
            renderer.uploadStructureMap(this.structureMap.getCanvas());
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
         * Toggle saliency modulation (fidelity bias in LGN).
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
                enableSaliencyModulation: this.config.enableSaliencyModulation
            };
        }
    }

    // CommonJS + window export (Scrutinizer module pattern)
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ContentAnalysis;
    }
    window.ContentAnalysis = ContentAnalysis;
})();
