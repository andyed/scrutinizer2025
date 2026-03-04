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

    let ComplexityHUD;
    try {
        ComplexityHUD = require('./complexity-hud');
    } catch (e) {
        console.warn('[Scrutinizer] Could not require complexity-hud:', e);
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
            this._congestionReportMode = 0;
            this._lastCongestionGeneration = 0;
            this._lastCongestionResultTime = 0;
            this._heatmapPendingRestore = false;

            // ── SVG Overlay (debug visualization) ────────────────────
            const OverlayClass = SVGOverlay || (typeof window !== 'undefined' ? window.SVGOverlay : null);
            if (OverlayClass) {
                this.svgOverlay = new OverlayClass('debug-overlay');
            } else {
                console.error('[Scrutinizer] SVGOverlay class NOT found');
            }

            // ── Complexity HUD (congestion stats readout) ─────────────
            const HUDClass = ComplexityHUD || (typeof window !== 'undefined' ? window.ComplexityHUD : null);
            if (HUDClass) {
                this.complexityHud = new HUDClass('complexity-hud', {
                    ipcRenderer,
                    onClose: () => {
                        this.setShowCongestion(0);
                    }
                });
            }

            // ── Side-by-Side Labels (saliency vs congestion) ────────
            this._sideBySideLabels = null;
            this._createSideBySideLabels();

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
            // Fires on scroll, resize, and DOM mutations.
            // trigger: 'scroll' | 'mutation' — controls congestion recompute urgency.
            ipcRenderer.on('structure-update', (event, blocks, trigger) => {
                this.contentAnalysis.handleStructureUpdate(blocks, this.renderer);

                // When congestion report or congestion-gated pooling is active,
                // viewport changes may invalidate stats.
                if (this._congestionReportMode > 0 || this.renderer?.config.congestion_pooling) {
                    const now = performance.now();
                    const timeSinceLastResult = now - (this._lastCongestionResultTime || 0);
                    const isScroll = (trigger === 'scroll');

                    if (isScroll) {
                        // Scroll = viewport content changed significantly.
                        // Full pending state (dim to 0.35) + debounced recompute.
                        if (this.complexityHud) {
                            this.complexityHud.setPending(true);
                        }
                        // Hide heatmap during scroll — stale overlay at any opacity is misleading
                        if (this._congestionReportMode >= 2 && this.renderer) {
                            this.renderer.config.show_congestion = 0;
                            this._heatmapPendingRestore = true;
                        }
                        clearTimeout(this._congestionScrollTimer);
                        this._congestionScrollTimer = setTimeout(() => {
                            this._submitCongestionFrame();
                        }, 600);
                    } else {
                        // DOM mutation = content changed but viewport didn't move.
                        // Current score is mostly valid — gentle fade only.
                        // Enforce 5s cooldown: don't recompute if we just did.
                        if (timeSinceLastResult < 5000) {
                            // Within cooldown — just show gentle staleness indicator.
                            // Queue a recompute for when cooldown expires.
                            if (this.complexityHud) {
                                this.complexityHud.setPending(true, true); // gentle mode
                            }
                            clearTimeout(this._congestionMutationTimer);
                            const remaining = 5000 - timeSinceLastResult;
                            this._congestionMutationTimer = setTimeout(() => {
                                this._submitCongestionFrame();
                            }, remaining + 300); // +300ms settle time after cooldown
                        } else {
                            // Cooldown expired — recompute with gentle pending.
                            if (this.complexityHud) {
                                this.complexityHud.setPending(true, true);
                            }
                            clearTimeout(this._congestionMutationTimer);
                            this._congestionMutationTimer = setTimeout(() => {
                                this._submitCongestionFrame();
                            }, 800);
                        }
                    }
                }
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

            // Re-submit to congestion worker on navigation (if report mode or congestion pooling is active)
            ipcRenderer.on('browser:did-navigate', () => {
                if (this._congestionReportMode > 0 || this.renderer?.config.congestion_pooling) {
                    // Clear stale heatmap immediately — old page's overlay shouldn't linger
                    if (this._congestionReportMode >= 2 && this.renderer) {
                        this.contentAnalysis.clearCongestionData(this.renderer);
                        this.renderer.config.show_congestion = 0;
                        this._heatmapPendingRestore = true;
                    }
                    // Delay to let the page render before capturing
                    clearTimeout(this._congestionNavTimer);
                    this._congestionNavTimer = setTimeout(() => {
                        this._submitCongestionFrame();
                    }, 500);
                }
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

            // 4. Update content analysis (saliency + congestion smoothing)
            this.contentAnalysis.updateSaliencySmoothing(this.renderer);
            if (this._congestionReportMode > 0 || this.renderer.config.congestion_pooling) {
                this.contentAnalysis.updateCongestionSmoothing(this.renderer);
            }

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

            // 7b. Detect fresh congestion data via generation counter
            const gen = this.contentAnalysis.congestionGeneration;
            if (gen !== this._lastCongestionGeneration) {
                this._lastCongestionGeneration = gen;
                this._lastCongestionResultTime = performance.now();
                if (this.complexityHud) {
                    this.complexityHud.setPending(false);
                }
                // Restore heatmap overlay after scroll/navigation hid it
                if (this._heatmapPendingRestore && this._congestionReportMode >= 2 && this.renderer) {
                    // Restore correct shader mode: 2=side-by-side, 1=heatmap
                    this.renderer.config.show_congestion = this._congestionReportMode >= 3 ? 2 : 1;
                    this._heatmapPendingRestore = false;
                }
                ipcRenderer.send('overlay:congestion-processing', false);
            }
            if (this.complexityHud) {
                this.complexityHud.update(contentState.congestionStats, contentState.edgeDensityStats);
            }

            // 8. Render (single call to WebGL with all composed state)
            const debugMode = this.contentAnalysis.getDebugMode();
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
                debugMode,
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

        toggleChromaticPooling(enabled) {
            if (this.renderer) {
                this.renderer.config.chromatic_pooling = enabled;
                ipcRenderer.send('log:renderer', `[Scrutinizer] Chromatic pooling: ${enabled}`);
            }
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

            // Auto-start high-res congestion worker for congestion-gated modes
            if (this.renderer?.config.congestion_pooling) {
                this._submitCongestionFrame();
            }
        }

        /**
         * Set congestion report mode.
         * @param {number} mode - 0=off, 1=stats only, 2=heatmap+stats, 3=side-by-side
         */
        setShowCongestion(mode) {
            const m = Number(mode);
            if (this.renderer) {
                // Map UI mode → shader uniform value
                // mode 0,1 → shader 0 (no overlay)
                // mode 2   → shader 1 (full-screen congestion heatmap)
                // mode 3   → shader 2 (side-by-side: saliency vs congestion)
                if (m >= 3) {
                    this.renderer.config.show_congestion = 2;
                } else if (m >= 2) {
                    this.renderer.config.show_congestion = 1;
                } else {
                    this.renderer.config.show_congestion = 0;
                }
            }
            if (this.complexityHud) {
                this.complexityHud.setVisible(m > 0);
            }
            this._congestionReportMode = m;

            // Show/hide side-by-side labels
            this._updateSideBySideLabels(m === 3);

            // Edge cases: clear pending restore when leaving heatmap mode
            if (m < 2) {
                this._heatmapPendingRestore = false;
            }
            if (m === 0) {
                ipcRenderer.send('overlay:congestion-processing', false);
            }

            // High-res congestion worker: start/stop based on mode
            if (m > 0) {
                // Submit current frame to congestion worker for high-res analysis
                this._submitCongestionFrame();
            } else {
                // Clear high-res congestion data, fall back to saliency worker's 256px
                this.contentAnalysis.clearCongestionData(this.renderer);
            }

            const shaderVal = this.renderer ? this.renderer.config.show_congestion : 'n/a';
            const msg = `[Scrutinizer] Congestion report mode: ${m} (shader=${shaderVal})`;
            console.log(msg);
            ipcRenderer.send('log:renderer', msg);
        }

        /**
         * Submit current frame buffer to the high-res congestion worker.
         * @private
         */
        _submitCongestionFrame() {
            if (this.imageDataBuffer && this.imageData) {
                this.contentAnalysis.submitForCongestion(
                    this.imageDataBuffer,
                    this.imageData.width,
                    this.imageData.height
                );
                ipcRenderer.send('overlay:congestion-processing', true);
            }
        }

        /**
         * Set congestion worker resolution.
         * @param {number} maxDim - 512, 768, or 1024
         */
        setCongestionResolution(maxDim) {
            this.contentAnalysis.setCongestionResolution(maxDim);
            // Re-submit if report is active to get updated results at new resolution
            if (this._congestionReportMode > 0) {
                this._submitCongestionFrame();
            }
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

        // ── Side-by-Side Labels ────────────────────────────────────

        /**
         * Create DOM labels for side-by-side comparison view.
         * @private
         */
        _createSideBySideLabels() {
            const container = document.createElement('div');
            container.id = 'side-by-side-labels';
            container.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                pointer-events: none; z-index: 104; display: none;
            `;

            const labelStyle = `
                position: absolute; top: 12px;
                transform: translateX(-50%);
                font: bold 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                color: #fff; background: rgba(0, 0, 0, 0.7);
                padding: 5px 14px; border-radius: 4px;
                letter-spacing: 0.5px;
            `;

            const leftLabel = document.createElement('div');
            leftLabel.innerHTML = 'SALIENCY<span style="display:block;font-size:10px;font-weight:normal;opacity:0.7;margin-top:1px">What pops out?</span>';
            leftLabel.style.cssText = labelStyle + 'left: 25%;';

            const rightLabel = document.createElement('div');
            rightLabel.innerHTML = 'CONGESTION<span style="display:block;font-size:10px;font-weight:normal;opacity:0.7;margin-top:1px">How cluttered?</span>';
            rightLabel.style.cssText = labelStyle + 'left: 75%;';

            container.appendChild(leftLabel);
            container.appendChild(rightLabel);
            document.body.appendChild(container);
            this._sideBySideLabels = container;
        }

        /**
         * Show/hide side-by-side comparison labels.
         * @private
         */
        _updateSideBySideLabels(visible) {
            if (this._sideBySideLabels) {
                this._sideBySideLabels.style.display = visible ? 'block' : 'none';
            }
        }

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
