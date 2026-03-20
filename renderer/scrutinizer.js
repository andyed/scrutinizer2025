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
    const { probeWebGPU } = require('./webgpu-probe');
    const { WebGPUSafetyHarness } = require('./webgpu-safety');
    const { WebGPUCrowdingCompute } = require('./webgpu-crowding-compute');

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

            // ── Frame Timer (zero-alloc rolling-window perf tracker) ──
            const TimerClass = (typeof FrameTimer !== 'undefined') ? FrameTimer : (typeof window !== 'undefined' ? window.FrameTimer : null);
            this.frameTimer = TimerClass ? new TimerClass(120) : null;

            // ── Frame state ──────────────────────────────────────────
            this.lastFrameBitmap = null;
            this.aestheticMode = 12; // FOVI Cortical Grid (Blauch): isotropic cortical sampling
            this.dpr = window.devicePixelRatio || 1;
            this._congestionReportMode = 0;
            this._lastCongestionGeneration = 0;
            this._lastCongestionResultTime = 0;
            this._heatmapPendingRestore = false;

            // ── WebGPU Compute (Tier 2.5) ──────────────────────────────
            this.webgpuCompute = null;
            this.webgpuSafety = null;
            this.webgpuDevice = null;
            this.webgpuTier = 0;
            // Velocity-gated metamer freeze state
            this._metamerSaccading = false;
            this._metamerInitialized = false;
            this._lastSynthGazeX = 0;
            this._lastSynthGazeY = 0;
            this._initWebGPU();

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

        // ── WebGPU Init (Tier 2.5) ────────────────────────────────────

        /**
         * Non-blocking WebGPU probe → safety harness → compute pipeline.
         * Only activates if the current mode has compute_tier >= 2.5.
         */
        async _initWebGPU() {
            try {
                const result = await probeWebGPU();
                if (!result.success) {
                    console.log('[Scrutinizer] WebGPU not available:', result.error);
                    return;
                }
                this.webgpuDevice = result.device;

                // Safety harness with auto-fallback callback
                this.webgpuSafety = new WebGPUSafetyHarness(result.device, {
                    onBudgetExceeded: () => this._fallbackToTier16(),
                });

                // Device loss callback (for external kill signals)
                window._scrutinizerWebGPULostCallback = () => this._fallbackToTier16();

                console.log('[Scrutinizer] WebGPU ready (Tier 2.5 available)');
            } catch (e) {
                console.warn('[Scrutinizer] WebGPU init error:', e.message);
            }
        }

        /**
         * Simple 2x2 box downsample for compute shader input.
         * @param {Uint8ClampedArray} src - full-res RGBA
         * @param {number} w - full width
         * @param {number} h - full height
         * @returns {Uint8Array} half-res RGBA
         */
        _downsampleToHalf(src, w, h) {
            const hw = Math.ceil(w / 2);
            const hh = Math.ceil(h / 2);
            const dst = new Uint8Array(hw * hh * 4);
            for (let y = 0; y < hh; y++) {
                const sy = Math.min(y * 2, h - 1);
                const sy1 = Math.min(sy + 1, h - 1);
                for (let x = 0; x < hw; x++) {
                    const sx = Math.min(x * 2, w - 1);
                    const sx1 = Math.min(sx + 1, w - 1);
                    const i00 = (sy * w + sx) * 4;
                    const i10 = (sy * w + sx1) * 4;
                    const i01 = (sy1 * w + sx) * 4;
                    const i11 = (sy1 * w + sx1) * 4;
                    const di = (y * hw + x) * 4;
                    dst[di]     = (src[i00] + src[i10] + src[i01] + src[i11]) >> 2;
                    dst[di + 1] = (src[i00 + 1] + src[i10 + 1] + src[i01 + 1] + src[i11 + 1]) >> 2;
                    dst[di + 2] = (src[i00 + 2] + src[i10 + 2] + src[i01 + 2] + src[i11 + 2]) >> 2;
                    dst[di + 3] = 255;
                }
            }
            return dst;
        }

        /**
         * Destroy compute pipeline and revert to fragment-shader-only path.
         */
        _fallbackToTier16() {
            console.warn('[Scrutinizer] Falling back to Tier 1.6 (WebGL-only)');
            if (this.webgpuCompute) {
                this.webgpuCompute.destroy();
                this.webgpuCompute = null;
            }
            this.webgpuTier = 0;
            if (this.renderer) {
                this.renderer.setComputeTier(0);
            }
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
                        // Invalidate compute texture so shader falls back to MIP
                        // during the resynth gap, then force resynth on next cycle.
                        this._metamerInitialized = false;
                        if (this.renderer) {
                            this.renderer.invalidateComputeTexture();
                        }
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
                            this._submitCongestionFrame(true); // Viewport changed
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
                                this._submitCongestionFrame(true); // DOM changed
                            }, remaining + 300); // +300ms settle time after cooldown
                        } else {
                            // Cooldown expired — recompute with gentle pending.
                            if (this.complexityHud) {
                                this.complexityHud.setPending(true, true);
                            }
                            clearTimeout(this._congestionMutationTimer);
                            this._congestionMutationTimer = setTimeout(() => {
                                this._submitCongestionFrame(true); // DOM changed
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
                // New page — reset all dirty checks so first frame goes through
                this.contentAnalysis.resetDirtyChecks();

                // Reset WebGPU compute state — old page's metamer texture is stale.
                // invalidateComputeTexture() makes shader fall back to fresh MIP chain
                // during the 2-5 frame gap while new compute runs.
                this._metamerInitialized = false;
                this._metamerSaccading = false;
                this._lastSynthGazeX = 0;
                this._lastSynthGazeY = 0;
                if (this.webgpuCompute) {
                    this.webgpuCompute.frameCounter = -1;
                }
                if (this.renderer) {
                    this.renderer.invalidateComputeTexture();
                }

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
                        this._submitCongestionFrame(true); // New page
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

            // Track saccade state for metamer freeze *before* the early return,
            // so the flag is set even when processFrame bails during saccadic suppression.
            const currentVelocity = this.gazeModel.getVelocity();
            if (currentVelocity > this.config.saccadicSuppressionThreshold) {
                this._metamerSaccading = true;
            }

            // Saccadic suppression: skip heavy processing during rapid eye movement.
            // When saccadic blindness is enabled, let the render proceed — the shader
            // shrinks the fovea instead of skipping the frame entirely.
            if (currentVelocity > this.config.saccadicSuppressionThreshold
                && !this.renderer.config.saccadic_blindness) {
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
            if (this.frameTimer) this.frameTimer.beginFrame();

            // 1. Update gaze model (smoothing + velocity)
            this.gazeModel.update(now);
            const gaze = this.gazeModel.getPosition();
            const velocity = this.gazeModel.getVelocity();
            if (this.frameTimer) this.frameTimer.mark('gaze');

            // 2. Determine effective foveal radius
            const effectiveRadius = this.enabled ? this.config.fovealRadius : 5000.0;

            // 3. Update visual memory (fixation detection + buffer management)
            const useMask = this.enabled && this.visualMemory.isActive();
            if (useMask) {
                this.visualMemory.update(now, gaze.x, gaze.y, velocity, effectiveRadius);
                this.visualMemory.renderMask(this.renderer);
            }
            if (this.frameTimer) this.frameTimer.mark('memory');

            // 4. Update content analysis (saliency + congestion smoothing)
            this.contentAnalysis.updateSaliencySmoothing(this.renderer);
            if (this._congestionReportMode > 0 || this.renderer.config.congestion_pooling) {
                this.contentAnalysis.updateCongestionSmoothing(this.renderer);
            }
            if (this.frameTimer) this.frameTimer.mark('saliency');

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
                const perfStats = this.frameTimer ? this.frameTimer.getStats() : null;
                this.complexityHud.update(contentState.congestionStats, contentState.edgeDensityStats, perfStats);
            }

            // 7c. WebGPU compute dispatch (Tier 2.5)
            // Runs every other frame. Uploads half-res source, dispatches stats+synth,
            // async readback → WebGL TEXTURE5.
            if (this.webgpuDevice && this.webgpuSafety?.isAlive() &&
                this.renderer?.config.compute_tier >= 2.5 &&
                this.imageData) {
                // Use actual frame dimensions, NOT canvas dimensions.
                // Canvas may include toolbar chrome (e.g. 3840x2104 vs frame 3840x2024).
                const frameW = this.imageData.width;
                const frameH = this.imageData.height;
                const halfW = Math.ceil(frameW / 2);
                const halfH = Math.ceil(frameH / 2);
                if (!this.webgpuCompute) {
                    try {
                        this.webgpuCompute = new WebGPUCrowdingCompute(this.webgpuDevice, halfW, halfH);
                        this.webgpuTier = 2.5;
                        this.renderer.setComputeTier(2.5);
                    } catch (e) {
                        console.warn('[Scrutinizer] WebGPU compute init failed:', e.message);
                        this._fallbackToTier16();
                    }
                } else if (halfW !== this.webgpuCompute.width || halfH !== this.webgpuCompute.height) {
                    this.webgpuCompute.resize(halfW, halfH);
                }

                // Gaze is in canvas space — scale to frame space for compute.
                // Canvas may be taller than frame (toolbar chrome).
                const gazeFrameX = gaze.x * (frameW / this.canvas.width);
                const gazeFrameY = gaze.y * (frameH / this.canvas.height);

                // Velocity-gated metamer freeze: don't resynthesize during fixation/pursuit.
                // Peripheral representation is stable during these states (Sperry 1950, Burr 1994).
                // Only resynthesize after saccade landing (deceleration below threshold).
                // Note: _metamerSaccading is set above the saccadic suppression early-return
                // (line ~389) so it tracks velocity even when processFrame bails.
                const isSaccading = velocity > this.config.saccadicSuppressionThreshold;
                const saccadeLanded = this._metamerSaccading && !isSaccading;

                // Displacement safety valve: if gaze drifted far from last synthesis,
                // force resynthesis even during slow movement (sustained pursuit edge case).
                const synthDx = gazeFrameX / 2 - this._lastSynthGazeX;
                const synthDy = gazeFrameY / 2 - this._lastSynthGazeY;
                const synthDist = Math.sqrt(synthDx * synthDx + synthDy * synthDy);
                const maxDrift = this.config.fovealRadius * 2.0; // ~5° at default radius
                const driftExceeded = synthDist > maxDrift;

                const shouldResynth = saccadeLanded || driftExceeded || !this._metamerInitialized;

                if (this.webgpuCompute?.shouldCompute() && this.imageDataBuffer && shouldResynth) {
                    // Downsample source to half-res using frame dimensions (not canvas)
                    const halfBuf = this._downsampleToHalf(this.imageDataBuffer, frameW, frameH);

                    // Compute cortical_max for half-res coordinates
                    const foveaDeg = 1.0;
                    const halfDiag = Math.sqrt(halfW * halfW + halfH * halfH) / 2;
                    const halfFovea = this.config.fovealRadius / 2;
                    const rMaxDeg = (halfDiag / halfFovea) * foveaDeg;
                    const cmfA = this.renderer.config.cmf_a || 2.78;
                    const corticalMax = Math.log1p(rMaxDeg / cmfA);

                    this.webgpuCompute.uploadAndConfigure(
                        halfBuf,
                        gazeFrameX / 2, gazeFrameY / 2,
                        halfFovea,
                        this.renderer.config,
                        corticalMax,
                        aspectRatio  // fovea_aspect_ratio (same as fragment shader)
                    );
                    this.webgpuCompute.dispatch();

                    // Clear saccade flag and track synthesis position inside the dispatch
                    // block so a saccade-landing isn't lost to shouldCompute() frame-skip.
                    if (saccadeLanded) {
                        this._metamerSaccading = false;
                        console.debug('[Scrutinizer] Metamer resynth: reason=saccade');
                    } else if (driftExceeded) {
                        console.debug('[Scrutinizer] Metamer resynth: reason=drift (%dpx)', Math.round(synthDist));
                    } else {
                        console.debug('[Scrutinizer] Metamer resynth: reason=init');
                    }
                    this._lastSynthGazeX = gazeFrameX / 2;
                    this._lastSynthGazeY = gazeFrameY / 2;
                    this._metamerInitialized = true;

                    // Async readback — non-blocking, result arrives next frame
                    const cw = this.canvas.width, ch = this.canvas.height;
                    this.webgpuCompute.readback().then((data) => {
                        if (data && this.renderer) {
                            this.renderer.uploadComputeTexture(data, halfW, halfH, cw, ch);
                            // Always invalidate after upload so next content change triggers resynth.
                            // Without this, hover effects / CSS animations / dynamic content
                            // show stale tiles until the next saccade or drift threshold.
                            this._metamerInitialized = false;
                        }
                    });
                }
            }

            // 8. Render (single call to WebGL with all composed state)
            const debugMode = this.contentAnalysis.getDebugMode();
            const vel = this.gazeModel.getVelocityComponents();
            // Debug: log velocity every 30 frames via IPC (shows in test stdout)
            if (!this._rsDebugCount) this._rsDebugCount = 0;
            this._rsDebugCount++;
            if (this._rsDebugCount % 30 === 0) {
                const scalarV = this.gazeModel.getVelocity();
                ipcRenderer.send('log:renderer', `[ReadingSpan] frame=${this._rsDebugCount} vx=${vel.vx.toFixed(4)} vy=${vel.vy.toFixed(4)} scalar=${scalarV.toFixed(4)} gaze=(${gaze.x.toFixed(0)},${gaze.y.toFixed(0)}) target=(${this.gazeModel.targetMouseX.toFixed(0)},${this.gazeModel.targetMouseY.toFixed(0)}) reading_span=${this.renderer.config.reading_span}`);
            }
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
                this.config.scrollbarWidth,
                vel.vx,
                vel.vy
            );

            if (this.frameTimer) this.frameTimer.mark('render');
            if (this.frameTimer) this.frameTimer.endFrame();

            // Occasional debug logging
            if (Math.random() < 0.005) {
                console.log(`[Scrutinizer] Render: Enabled=${this.enabled}, Radius=${effectiveRadius}, Mem=${this.visualMemory.getLimit()}, Vel=${velocity.toFixed(3)}`);
            }
        }

        /** @returns {Object|null} Current frame timing stats from FrameTimer */
        getFrameStats() {
            return this.frameTimer ? this.frameTimer.getStats() : null;
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

        setDebugLevel(level) {
            this.contentAnalysis.setDebugLevel(level);
        }

        toggleSaliencyModulation(enabled) {
            this.contentAnalysis.toggleSaliencyModulation(enabled);
        }

        toggleEnableStructureMap(enabled) {
            this.contentAnalysis.toggleEnableStructureMap(enabled);
        }

        toggleCongestionPooling(enabled) {
            if (this.renderer) {
                this.renderer.config.congestion_pooling = enabled;
                this.renderer._congestionPoolingOverride = enabled;
                ipcRenderer.send('log:renderer', `[Scrutinizer] Congestion-gated pooling: ${enabled}`);
            }
        }

        toggleChromaticPooling(enabled) {
            if (this.renderer) {
                this.renderer.config.chromatic_pooling = enabled;
                // Flag survives per-frame updateConfigFromMode() resets
                this.renderer._chromaticPoolingOverride = enabled;
                ipcRenderer.send('log:renderer', `[Scrutinizer] Chromatic pooling: ${enabled}`);
            }
        }

        toggleSaccadicBlindness(enabled) {
            if (this.renderer) {
                this.renderer.config.saccadic_blindness = enabled;
                this.renderer._saccadicBlindnessOverride = enabled;
                ipcRenderer.send('log:renderer', `[Scrutinizer] Saccadic blindness: ${enabled}`);
            }
        }

        toggleReadingSpan(enabled) {
            if (this.renderer) {
                this.renderer.config.reading_span = enabled;
                this.renderer._readingSpanOverride = enabled;
                ipcRenderer.send('log:renderer', `[Scrutinizer] Reading span: ${enabled}`);
            }
        }

        toggleGaussianBlurMode(enabled) {
            if (this.renderer) {
                this.renderer.config.gaussian_blur_mode = enabled;
                this.renderer._gaussianBlurModeOverride = enabled;
                ipcRenderer.send('log:renderer', `[Scrutinizer] Gaussian blur mode: ${enabled}`);
            }
        }

        setDogE2(value) {
            if (this.renderer) {
                this.renderer.config.dog_e2 = value;
                this.renderer._dogE2Override = value;
                ipcRenderer.send('log:renderer', `[Scrutinizer] DoG E2 override: ${value}`);
            }
        }

        setDogOriented(enabled) {
            if (this.renderer) {
                this.renderer.config.dog_oriented = enabled;
                this.renderer._dogOrientedOverride = enabled;
                ipcRenderer.send('log:renderer', `[Scrutinizer] DoG oriented override: ${enabled}`);
            }
        }

        setDogOrientBias(value) {
            if (this.renderer) {
                this.renderer.config.dog_orient_bias = value;
                this.renderer._dogOrientBiasOverride = value;
                ipcRenderer.send('log:renderer', `[Scrutinizer] DoG orient bias override: ${value}`);
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
            this.contentAnalysis.setAestheticMode(this.aestheticMode);
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
         * @param {boolean} [force=false] - Bypass dirty check (scroll/mutation/navigation)
         * @private
         */
        _submitCongestionFrame(force = false) {
            if (this.imageDataBuffer && this.imageData) {
                this.contentAnalysis.submitForCongestion(
                    this.imageDataBuffer,
                    this.imageData.width,
                    this.imageData.height,
                    force
                );
                ipcRenderer.send('overlay:congestion-processing', true);
            }
        }

        /**
         * Set saliency worker resolution.
         * Higher res improves congestion ranking for pooling (ρ=0.69 at 256 → ~0.85 at 512).
         * @param {number} maxDim - 256 or 512
         */
        setSaliencyResolution(maxDim) {
            this.contentAnalysis.setSaliencyResolution(maxDim);
        }

        /**
         * Set congestion worker resolution.
         * @param {number} maxDim - 512, 768, or 1024
         */
        setCongestionResolution(maxDim) {
            this.contentAnalysis.setCongestionResolution(maxDim);
            // Re-submit if report is active to get updated results at new resolution
            if (this._congestionReportMode > 0) {
                this._submitCongestionFrame(true); // Resolution changed
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
