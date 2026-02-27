/**
 * Scrutinizer — Pipeline Orchestrator
 *
 * Thin coordinator that wires GazeModel, VisualMemory, and ContentAnalysis
 * into the LGN→V1→V4 rendering pipeline. Reads modes.json configuration
 * to determine which analysis layers and visual stages are active.
 *
 * Biological analog: The visual pathway itself — routing signals from
 * retina through LGN to cortical areas.
 *
 * Architecture note: Aesthetic modes (modes.json) are the extensibility model.
 * Scientists extend Scrutinizer by adding new modes, V1 distortion types,
 * or ContentAnalysis layers — not by modifying this orchestrator.
 *
 * @module Scrutinizer
 */
(() => {
    const { ipcRenderer } = require('electron');
    const Logger = require('./logger');
    const WebGLRenderer = require('./webgl-renderer');
    const GazeModel = require('./gaze-model');
    const VisualMemory = require('./visual-memory');
    const ContentAnalysis = require('./content-analysis');

    // Architecture: Explicit require for optional dependencies
    let SVGOverlay;
    try {
        SVGOverlay = require('./svg-overlay');
    } catch (e) {
        console.warn('[Scrutinizer] Could not require svg-overlay:', e);
    }

    class Scrutinizer {
        constructor(config) {
            // Apply defaults for missing config values
            this.config = {
                fixationVelocityThreshold: 20.0,
                dwellTimeThreshold: 150,
                foveaBypassMargin: 0.8,
                velocityDecayMove: 0.01,
                velocityDecayStop: 0.02,
                maskSmoothness: 0.4,
                saccadicSuppressionThreshold: 4.0,
                scrollbarWidth: 20.0,
                ...config
            };

            // ── Canvas Setup ─────────────────────────────────────────
            this.canvas = document.getElementById('overlay-canvas');

            // ── WebGL Renderer ───────────────────────────────────────
            try {
                this.renderer = new WebGLRenderer(this.canvas);
            } catch (e) {
                Logger.error('Failed to initialize WebGL:', e.message);
                if (e.stack) Logger.error('Stack:', e.stack);
                Logger.warn('WebGL is required for Scrutinizer. Visual effects will be disabled.');
            }

            // ── Performance: Pre-allocated ImageData buffer ──────────
            this.imageDataBuffer = null;
            this.imageData = null;
            this.lastBufferSize = 0;

            // ── Module Initialization ────────────────────────────────
            // GazeModel: Oculomotor system proxy (mouse tracking, velocity, saccade detection)
            this.gazeModel = new GazeModel(this.config, this.canvas);

            // VisualMemory: Visuospatial working memory (fixation history, mask texture)
            this.visualMemory = new VisualMemory(this.config, this.canvas);
            const initLimit = config.visualMemoryLimit !== undefined ? config.visualMemoryLimit : 0;
            this.visualMemory.setLimit(initLimit);

            // ContentAnalysis: Pre-cortical feature extraction (structure, saliency, future DoG)
            this.contentAnalysis = new ContentAnalysis({
                canvas: this.canvas,
                config: this.config
            });

            // ── Frame state ──────────────────────────────────────────
            this.lastFrameBitmap = null;
            this.aestheticMode = 0;
            this.dpr = window.devicePixelRatio || 1;

            // ── SVG Overlay (debug visualization) ────────────────────
            const OverlayClass = SVGOverlay || (typeof window !== 'undefined' ? window.SVGOverlay : null);
            if (OverlayClass) {
                this.svgOverlay = new OverlayClass('debug-overlay');
            } else {
                console.error('[Scrutinizer] SVGOverlay class NOT found');
            }

            // ── Bind & Wire ──────────────────────────────────────────
            this.handleMouseMove = this.gazeModel.handleMouseMove.bind(this.gazeModel);
            this.handleResize = this.handleResize.bind(this);
            this.render = this.render.bind(this);

            this.setupEventListeners();
        }

        // ── Event Wiring ─────────────────────────────────────────────

        setupEventListeners() {
            window.addEventListener('resize', this.handleResize);

            // Structure updates from DOM analysis (via IPC)
            ipcRenderer.on('structure-update', (event, blocks) => {
                this.contentAnalysis.handleStructureUpdate(blocks, this.renderer);
            });

            // Menu commands → ContentAnalysis
            ipcRenderer.on('menu:toggle-saliency-modulation', (event, enabled) => {
                this.contentAnalysis.toggleSaliencyModulation(enabled);
            });
            ipcRenderer.on('menu:toggle-saliency-map', (event, enabled) => {
                this.contentAnalysis.toggleSaliencyMapDebug(enabled, this.renderer);
            });
            ipcRenderer.on('menu:toggle-structure-map', (event, enabled) => {
                this.contentAnalysis.toggleStructureMapDebug(enabled);
            });
            ipcRenderer.on('menu:toggle-enable-structure-map', (event, enabled) => {
                this.contentAnalysis.toggleEnableStructureMap(enabled);
            });

            // Initial resize
            this.handleResize();

            // Mouse tracking from webview container
            const container = document.getElementById('webview-container');
            if (container) {
                container.addEventListener('mousemove', this.handleMouseMove);
            }
        }

        // ── Lifecycle ────────────────────────────────────────────────

        enable() {
            this.enabled = true;
            this.canvas.style.display = 'block';
            Logger.log('[Scrutinizer] ENABLE called');
            this.startRenderLoop();
        }

        disable() {
            this.enabled = false;
            this.canvas.style.display = 'none';
            Logger.log('[Scrutinizer] DISABLE called');
            this.stopRenderLoop();
            if (this.renderer) {
                this.renderer.clear();
            }
        }

        async toggle() {
            this.enabled = !this.enabled;
            if (this.enabled) await this.enable();
            else this.disable();
            return this.enabled;
        }

        // ── Resize ───────────────────────────────────────────────────

        handleResize() {
            Logger.log('[Scrutinizer] handleResize called, requesting window size...');
            ipcRenderer.send('get-window-size');

            ipcRenderer.once('window-size', (event, { width, height }) => {
                const dpr = window.devicePixelRatio || 1;
                this.dpr = dpr;

                // CSS size matches window
                this.canvas.style.width = width + 'px';
                this.canvas.style.height = height + 'px';

                // Buffer size with DPR
                const bufferWidth = width * dpr;
                const bufferHeight = height * dpr;

                if (this.canvas.width !== bufferWidth || this.canvas.height !== bufferHeight) {
                    this.canvas.width = bufferWidth;
                    this.canvas.height = bufferHeight;
                    console.log(`[Scrutinizer] Canvas resized to: ${bufferWidth}x${bufferHeight} (Physical), CSS: ${width}x${height} (Logical), DPR: ${dpr}`);

                    // Propagate resize to VisualMemory mask canvas
                    this.visualMemory.resize(bufferWidth, bufferHeight);
                }
            });
        }

        // ── Frame Processing ─────────────────────────────────────────

        processFrame(buffer, width, height) {
            if (!this.renderer || !this.enabled) return;

            // Saccadic suppression: skip heavy processing during rapid eye movement
            if (this.gazeModel.getVelocity() > this.config.saccadicSuppressionThreshold) {
                return;
            }

            // Reuse pre-allocated ImageData buffer (eliminates 60 allocations/sec)
            const bufferSize = width * height * 4;
            if (!this.imageDataBuffer || this.lastBufferSize !== bufferSize) {
                this.imageDataBuffer = new Uint8ClampedArray(bufferSize);
                this.imageData = new ImageData(this.imageDataBuffer, width, height);
                this.lastBufferSize = bufferSize;
                Logger.log(`[Scrutinizer] Allocated ImageData buffer: ${width}x${height}`);
            }
            this.imageDataBuffer.set(buffer);

            // Upload frame texture to GPU
            this.renderer.uploadTexture(this.imageData);

            // Submit for saliency analysis (internally throttled)
            this.contentAnalysis.submitFrameForSaliency(this.imageDataBuffer, width, height);

            // Logging
            if (!this.frameUploadCount) {
                this.frameUploadCount = 0;
                Logger.log(`[Scrutinizer] First frame uploaded! ${width}x${height}`);
            }
            this.frameUploadCount++;
            if (this.frameUploadCount % 60 === 0) {
                Logger.log(`[Scrutinizer] Uploaded frame ${this.frameUploadCount} to WebGL (${width}x${height})`);
            }
        }

        // ── Render Loop ──────────────────────────────────────────────

        startRenderLoop() {
            if (this.renderLoopId) return;
            const loop = () => {
                this.render();
                this.renderLoopId = requestAnimationFrame(loop);
            };
            this.renderLoopId = requestAnimationFrame(loop);
        }

        stopRenderLoop() {
            if (this.renderLoopId) {
                cancelAnimationFrame(this.renderLoopId);
                this.renderLoopId = null;
            }
        }

        /**
         * Main render frame — the pipeline orchestrator's core job.
         * Delegates to modules, then composes all state into a single renderer.render() call.
         */
        render() {
            if (!this.renderer) return;
            const now = performance.now();

            // 1. Update gaze model (smoothing + velocity)
            this.gazeModel.update(now);
            const gaze = this.gazeModel.getPosition();
            const velocity = this.gazeModel.getVelocity();

            // 2. Determine effective foveal radius
            const effectiveRadius = this.enabled ? this.config.fovealRadius : 5000.0;

            // 3. Update visual memory (fixation detection + buffer management)
            const useMask = this.enabled && this.visualMemory.isActive();
            if (useMask) {
                this.visualMemory.update(now, gaze.x, gaze.y, velocity, effectiveRadius);
                this.visualMemory.renderMask(this.renderer);
            }

            // 4. Update content analysis (saliency smoothing)
            this.contentAnalysis.updateSaliencySmoothing(this.renderer);

            // 5. Compose render state
            const aspectRatio = this.config.fovealAspectRatio || 1.33;

            // Auto-reduce intensity when visual memory is active to avoid heavy ghosting
            const effectiveIntensity = useMask
                ? this.config.intensity * 0.6
                : this.config.intensity;

            // 6. Update SVG overlay (debug visualization)
            if (this.svgOverlay) {
                const scale = this.gazeModel.getScale();
                const parafoveaRadius = effectiveRadius * 2.5;
                this.svgOverlay.update(
                    gaze.x / scale.scaleX,
                    gaze.y / scale.scaleY,
                    effectiveRadius / scale.scaleX,
                    aspectRatio,
                    this.config.debugBoundary,
                    parafoveaRadius / scale.scaleX
                );
            }

            // 7. Content analysis state for shader uniforms
            const contentState = this.contentAnalysis.getState();

            // 8. Render (single call to WebGL with all composed state)
            this.renderer.render(
                this.canvas.width,
                this.canvas.height,
                gaze.x,
                gaze.y,
                this.config.fovealRadius,
                aspectRatio,
                effectiveIntensity,
                this.config.caStrength,
                0.0, // Force disable shader debug (we use SVG now)
                this.contentAnalysis.getDebugMode(),
                useMask ? (this.visualMemory.isInhibitionMode() ? 2.0 : 1.0) : 0.0,
                this.config.mongrelMode,
                this.aestheticMode,
                velocity,
                gaze.x, // stableMouseX
                gaze.y, // stableMouseY
                (contentState.hasStructure && contentState.enableStructureMap) ? 1.0 : 0.0,
                contentState.enableSaliencyModulation ? 1.0 : 0.0,
                now / 1000.0, // time (seconds)
                this.config.scrollbarWidth
            );

            // Occasional debug logging
            if (Math.random() < 0.005) {
                console.log(`[Scrutinizer] Render: Enabled=${this.enabled}, Radius=${effectiveRadius}, Mem=${this.visualMemory.getLimit()}, Vel=${velocity.toFixed(3)}`);
            }
        }

        // ── Public API (delegating to modules) ───────────────────────

        resetState() {
            if (this.lastFrameBitmap) {
                this.lastFrameBitmap.close();
                this.lastFrameBitmap = null;
            }
            if (this.renderer && this.renderer.gl) {
                const gl = this.renderer.gl;
                gl.clearColor(0.1, 0.1, 0.1, 1.0);
                gl.clear(gl.COLOR_BUFFER_BIT);
            }
            this.visualMemory.reset();
            if (this.renderer) {
                this.renderer.uploadMask(this.visualMemory.getMaskCanvas());
            }
        }

        updateFovealRadius(value, isDelta = false) {
            let newRadius;
            if (isDelta) {
                newRadius = this.config.fovealRadius + value;
            } else {
                newRadius = value;
            }
            newRadius = Math.max(20, Math.min(500, newRadius));
            this.config.fovealRadius = newRadius;
            console.log('[Scrutinizer] Updated foveal radius to:', newRadius);
        }

        updateIntensity(intensity) {
            this.config.intensity = intensity;
        }

        toggleCA(enabled) {
            this.config.chromaticAberration = enabled;
        }

        setDebugBoundaryMode(mode) {
            this.config.debugBoundary = parseFloat(mode);
        }

        // Delegate to ContentAnalysis
        toggleStructureMap(enabled) {
            this.contentAnalysis.toggleStructureMapDebug(enabled);
        }

        toggleSaliencyMap(enabled) {
            this.contentAnalysis.toggleSaliencyMapDebug(enabled, this.renderer);
        }

        toggleSaliencyModulation(enabled) {
            this.contentAnalysis.toggleSaliencyModulation(enabled);
        }

        toggleEnableStructureMap(enabled) {
            this.contentAnalysis.toggleEnableStructureMap(enabled);
        }

        // Delegate to VisualMemory
        setVisualMemoryLimit(limit) {
            ipcRenderer.send('log:renderer', `[Scrutinizer] setVisualMemoryLimit called with: ${limit}`);
            this.visualMemory.setLimit(limit);
        }

        resetVisualMemory() {
            this.visualMemory.reset();
            if (this.renderer) {
                this.renderer.uploadMask(this.visualMemory.getMaskCanvas());
            }
        }

        setMongrelMode(mode) {
            this.config.mongrelMode = Number(mode);
            const msg = `[Scrutinizer] Mongrel Mode set to: ${this.config.mongrelMode}`;
            console.log(msg);
            ipcRenderer.send('log:renderer', msg);
        }

        setAestheticMode(mode) {
            this.aestheticMode = Number(mode);
            const msg = `[Scrutinizer] Aesthetic Mode set to: ${this.aestheticMode}`;
            console.log(msg);
            ipcRenderer.send('log:renderer', msg);
        }

        // Delegate to GazeModel
        handleZoomChanged(zoom) {
            this.gazeModel.handleZoomChanged(zoom);
        }

        // ── Backward-Compatible Property Proxies ─────────────────────
        // Test code and overlay.js access internal state directly.
        // These proxies delegate to the appropriate module without
        // breaking existing callers during the transition period.

        get mouseX() { return this.gazeModel.mouseX; }
        set mouseX(v) { this.gazeModel.mouseX = v; }

        get mouseY() { return this.gazeModel.mouseY; }
        set mouseY(v) { this.gazeModel.mouseY = v; }

        get targetMouseX() { return this.gazeModel.targetMouseX; }
        set targetMouseX(v) { this.gazeModel.targetMouseX = v; }

        get targetMouseY() { return this.gazeModel.targetMouseY; }
        set targetMouseY(v) { this.gazeModel.targetMouseY = v; }

        get lastMouseX() { return this.gazeModel.lastMouseX; }
        set lastMouseX(v) { this.gazeModel.lastMouseX = v; }

        get lastMouseY() { return this.gazeModel.lastMouseY; }
        set lastMouseY(v) { this.gazeModel.lastMouseY = v; }

        get currentVelocity() { return this.gazeModel.currentVelocity; }
        set currentVelocity(v) { this.gazeModel.currentVelocity = v; }

        get lastRenderTime() { return this.gazeModel.lastUpdateTime; }
        set lastRenderTime(v) { this.gazeModel.lastUpdateTime = v; }

        get visualMemoryLimit() { return this.visualMemory.getLimit(); }
        set visualMemoryLimit(v) { this.visualMemory.setLimit(v); }

        get visualMemoryBuffer() { return this.visualMemory.buffer; }

        get isFixating() { return this.visualMemory.isFixating; }
        set isFixating(v) { this.visualMemory.isFixating = v; }

        get fixationStartTime() { return this.visualMemory.fixationStartTime; }
        set fixationStartTime(v) { this.visualMemory.fixationStartTime = v; }

        get hasStructure() { return this.contentAnalysis.hasStructure; }

        // ── Legacy Methods (preserved for backward compatibility) ────

        /**
         * Structure block grouping (kept here for callers that reference it directly).
         * Delegates to GestaltProcessor internally.
         */
        handleStructureUpdate(blocks) {
            this.contentAnalysis.handleStructureUpdate(blocks, this.renderer);
        }

        /**
         * Block equality check — exposed for test access.
         */
        areBlocksEqual(prev, next) {
            return this.contentAnalysis._areBlocksEqual(prev, next);
        }

        /**
         * Block grouping — exposed for test access. Uses the gestalt processor.
         */
        groupStructureBlocks(rawBlocks) {
            if (!rawBlocks || rawBlocks.length === 0) return [];

            // Quantize blocks to stabilize against small layout shifts
            const blocks = rawBlocks.map(b => {
                const grid = b.type === 1 ? 1 : 10;
                return {
                    ...b,
                    x: Math.round(b.x / grid) * grid,
                    y: Math.round(b.y / grid) * grid,
                    w: Math.round(b.w / grid) * grid,
                    h: Math.round(b.h / grid) * grid
                };
            });

            const textBlocks = blocks.filter(b => b.type === 1);
            const otherBlocks = blocks.filter(b => b.type !== 1);

            if (textBlocks.length === 0) return otherBlocks;

            textBlocks.sort((a, b) => {
                const yDiff = Math.floor(a.y) - Math.floor(b.y);
                if (yDiff !== 0) return yDiff;
                return Math.floor(a.x) - Math.floor(b.x);
            });

            const merged = [];
            let current = textBlocks[0];

            for (let i = 1; i < textBlocks.length; i++) {
                const next = textBlocks[i];
                const verticalGap = next.y - (current.y + current.h);
                const isVerticalNeighbor = verticalGap >= -5 && verticalGap <= (current.lineHeight * 1.5);
                const isAligned = Math.abs(current.x - next.x) < 20 && Math.abs(current.w - next.w) < 50;

                if (isVerticalNeighbor && isAligned) {
                    const newHeight = (next.y + next.h) - current.y;
                    current.h = newHeight;
                    current.w = Math.max(current.w, next.w);
                } else {
                    merged.push(current);
                    current = next;
                }
            }
            merged.push(current);

            return [...otherBlocks, ...merged];
        }
    }

    // Export for CommonJS AND window (needed for script tag loading in overlay.html)
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = Scrutinizer;
    }
    // Always expose to window for overlay.js which checks window.Scrutinizer
    window.Scrutinizer = Scrutinizer;
})();
