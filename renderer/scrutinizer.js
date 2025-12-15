(() => {
    const { ipcRenderer } = require('electron');
    const Logger = require('./logger');
    const WebGLRenderer = require('./webgl-renderer');
    const StructureMap = require('./structure-map');
    // Architecture: Explicit require for dependencies
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
                maskSmoothness: 0.4, // Increased from 0.1 for tighter mouse tracking
                saccadicSuppressionThreshold: 4.0,
                ...config
            };

            // Canvas setup
            this.canvas = document.getElementById('overlay-canvas');

            // Initialize WebGL Renderer
            try {
                this.renderer = new WebGLRenderer(this.canvas);
            } catch (e) {
                Logger.error('Failed to initialize WebGL:', e.message);
                if (e.stack) Logger.error('Stack:', e.stack);
                Logger.warn('WebGL is required for Scrutinizer. Visual effects will be disabled.');
                // alert('WebGL is required for this version of Scrutinizer.'); // Suppressed to avoid spam
            }

            // Performance Optimization: Pre-allocate ImageData buffer to eliminate allocations in hot path
            // This buffer will be reused every frame (60fps) instead of creating new allocations
            this.imageDataBuffer = null;
            this.imageData = null;
            this.lastBufferSize = 0;
            // Structure Map (Content Density Texture)
            const StructureMap = require('./structure-map.js');
            const GestaltProcessor = require('./gestalt-processor.js');
            this.structureMap = new StructureMap();
            this.gestaltProcessor = new GestaltProcessor();
            this.hasStructure = false;

            // Saliency Map (Visual Attractiveness Texture)
            // Moved to Web Worker for performance
            this.saliencyWorker = new Worker('./saliency-worker.js');
            this.saliencyWorker.onmessage = (e) => {
                const { imageData } = e.data;
                if (imageData) {
                    // Fix Oscillation: Route through smoothing canvas instead of direct upload
                    // This ensures the render() loop's smoothing logic (Target -> Current) works,
                    // preventing the "fight" between raw worker updates and smoothed frames.

                    if (!this.saliencyTargetCanvas) {
                        this.saliencyTargetCanvas = document.createElement('canvas');
                    }

                    // RESIZE if dimensions changed (Adaptive Scaling support)
                    if (this.saliencyTargetCanvas.width !== imageData.width ||
                        this.saliencyTargetCanvas.height !== imageData.height) {
                        this.saliencyTargetCanvas.width = imageData.width;
                        this.saliencyTargetCanvas.height = imageData.height;

                        // Also resize the buffer canvas
                        if (!this.saliencyCurrentCanvas) {
                            this.saliencyCurrentCanvas = document.createElement('canvas');
                        }
                        this.saliencyCurrentCanvas.width = imageData.width;
                        this.saliencyCurrentCanvas.height = imageData.height;
                    }

                    // Update Target Canvas
                    const ctx = this.saliencyTargetCanvas.getContext('2d');
                    ctx.putImageData(imageData, 0, 0);

                    // Trigger smoothing loop in render()
                    // 60 frames = ~1 second of smoothing updates
                    this.saliencyUpdateCountdown = 60;
                }
            };
            this.lastFrameBitmap = null;

            // Visual Memory
            this.visualMemoryBuffer = []; // Array of {x, y, radius, timestamp}
            this.fixationStartTime = 0;
            this.isFixating = false;
            this.maskCanvas = document.createElement('canvas');
            this.maskCtx = this.maskCanvas.getContext('2d', { alpha: true }); // Enable alpha for proper blending
            this.maskDirty = true;

            // Set limit AFTER buffers are ready
            const initLimit = config.visualMemoryLimit !== undefined ? config.visualMemoryLimit : 0;
            this.setVisualMemoryLimit(initLimit);

            // Velocity tracking for fixation detection
            this.lastMouseX = 0;
            this.lastMouseY = 0;
            this.lastRenderTime = 0;
            this.currentVelocity = 0; // pixels per ms

            // Mouse tracking
            this.mouseX = 0;
            this.mouseY = 0;
            this.targetMouseX = 0;
            this.targetMouseY = 0;
            // Stable mouse for distortion (heavy hysteresis to prevent peripheral jiggle)
            this.stableMouseX = 0;
            this.stableMouseY = 0;
            this.currentZoom = 1.0;

            // Bind methods
            this.handleMouseMove = this.handleMouseMove.bind(this);
            this.handleResize = this.handleResize.bind(this);
            this.render = this.render.bind(this);
            this.handleStructureUpdate = this.handleStructureUpdate.bind(this);

            this.setupEventListeners();

            // Initialize SVG Overlay
            console.log('[Scrutinizer] Attempting to init SVGOverlay...');
            // Check local require first, then global window
            const OverlayClass = SVGOverlay || (typeof window !== 'undefined' ? window.SVGOverlay : null);

            if (OverlayClass) {
                this.svgOverlay = new OverlayClass('debug-overlay');
                console.log('[Scrutinizer] SVGOverlay initialized:', this.svgOverlay);
            } else {
                console.error('[Scrutinizer] SVGOverlay class NOT found (require failed and global missing)!');
            }
        }

        setupEventListeners() {
            // REMOVED local mouse listener to prevent conflict with IPC stream
            // window.addEventListener('mousemove', this.handleMouseMove);
            window.addEventListener('resize', this.handleResize);

            // Listen for structure updates
            ipcRenderer.on('structure-update', (event, blocks) => {
                this.handleStructureUpdate(blocks);
            });

            // Initial resize
            this.handleResize();
            const container = document.getElementById('webview-container');
            if (container) {
                container.addEventListener('mousemove', this.handleMouseMove);
            }
        }

        enable() {
            this.enabled = true;
            this.canvas.style.display = 'block';
            Logger.log('[Scrutinizer] ENABLE called');
            Logger.log(`[Scrutinizer] Canvas state: ${this.canvas.width}x${this.canvas.height}, display=${this.canvas.style.display}, position=${this.canvas.style.position}`);
            Logger.log(`[Scrutinizer] Canvas computed style: ${window.getComputedStyle(this.canvas).display}`);
            this.startRenderLoop();
        }

        disable() {
            this.enabled = false;
            this.canvas.style.display = 'none';
            Logger.log('[Scrutinizer] DISABLE called');
            this.stopRenderLoop();

            // Clear canvas
            if (this.renderer) {
                this.renderer.clear();
            }
        }

        handleResize() {
            // Request actual window size from main process
            const { ipcRenderer } = require('electron');
            Logger.log('[Scrutinizer] handleResize called, requesting window size...');
            ipcRenderer.send('get-window-size');

            // Listen for response (only once per resize)
            ipcRenderer.once('window-size', (event, { width, height }) => {
                const dpr = window.devicePixelRatio || 1;
                this.dpr = dpr; // Store for structure map updates

                // Set CSS size to match window
                this.canvas.style.width = width + 'px';
                this.canvas.style.height = height + 'px';

                // Set canvas buffer size with DPR
                const bufferWidth = width * dpr;
                const bufferHeight = height * dpr;

                if (this.canvas.width !== bufferWidth || this.canvas.height !== bufferHeight) {
                    this.canvas.width = bufferWidth;
                    this.canvas.height = bufferHeight;
                    console.log(`[Scrutinizer] Canvas resized to: ${bufferWidth}x${bufferHeight} (Physical), CSS: ${width}x${height} (Logical), DPR: ${dpr}`);

                    // Resize mask canvas (1/4 resolution is enough for soft mask)
                    const maskScale = 0.25;
                    this.maskCanvas.width = Math.ceil(bufferWidth * maskScale);
                    this.maskCanvas.height = Math.ceil(bufferHeight * maskScale);

                    // Clear mask to black on resize
                    this.maskCtx.fillStyle = 'black';
                    this.maskCtx.fillRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
                    this.maskDirty = true;

                    // Resize saliency map
                    // ADAPTIVE SCALING (Phase 2): Target 256px max dim
                    const TARGET_MAX_DIM = 256;
                    const maxDim = Math.max(bufferWidth, bufferHeight);
                    const saliencyScale = maxDim > 0 ? Math.min(1.0, TARGET_MAX_DIM / maxDim) : 0.25;

                    this.saliencyMap?.resize(bufferWidth, bufferHeight);

                    // Create offscreen canvas for saliency generation if not exists
                    if (!this.saliencyTargetCanvas) {
                        this.saliencyTargetCanvas = document.createElement('canvas');
                    }
                    if (!this.saliencyCurrentCanvas) {
                        this.saliencyCurrentCanvas = document.createElement('canvas');
                    }

                    const sWidth = Math.floor(bufferWidth * saliencyScale);
                    const sHeight = Math.floor(bufferHeight * saliencyScale);

                    this.saliencyTargetCanvas.width = sWidth;
                    this.saliencyTargetCanvas.height = sHeight;

                    this.saliencyCurrentCanvas.width = sWidth;
                    this.saliencyCurrentCanvas.height = sHeight;
                }
            });
        }

        handleMouseMove(event) {
            const rect = this.canvas.getBoundingClientRect();

            // Guard against hidden canvas (display: none) causing divide by zero
            if (rect.width === 0 || rect.height === 0) return;

            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;

            // Store scale factors for reverse-projection in render()
            this.scaleX = scaleX;
            this.scaleY = scaleY;

            if (event.zoom) {
                this.currentZoom = event.zoom;
            }

            let clientX = event.clientX;
            let clientY = event.clientY;

            // FIX: Do NOT scale mouse coordinates by zoom. 
            // In Electron/Chrome, clientX/Y from the preload event (even with zoom)
            // appear to align with the viewport overlay 1:1, or the scaling 
            // logic here was double-applying it. User reported offset to bottom-right 
            // which implies we were scaling up (zoom > 1) when we shouldn't.
            // if (event.zoom) {
            //     clientX *= event.zoom;
            //     clientY *= event.zoom;
            // }

            this.targetMouseX = (clientX - rect.left) * scaleX;
            this.targetMouseY = (clientY - rect.top) * scaleY;

            // DEBUG: Log coordinate calculations
            console.log(`[Mouse Debug] rect: (${rect.left}, ${rect.top}), client: (${clientX}, ${clientY}), scale: (${scaleX}, ${scaleY}), target: (${this.targetMouseX}, ${this.targetMouseY})`);
        }

        handleZoomChanged(zoom) {
            console.log('[Scrutinizer] Zoom changed to:', zoom);
            this.currentZoom = zoom;
        }

        async toggle() {
            this.enabled = !this.enabled;
            if (this.enabled) await this.enable();
            else this.disable();
            return this.enabled;
        }

        resetState() {
            console.log('[Scrutinizer] resetState called');
            // Clear texture?
            if (this.lastFrameBitmap) {
                this.lastFrameBitmap.close();
                this.lastFrameBitmap = null;
            }
            // Clear canvas
            if (this.renderer && this.renderer.gl) {
                const gl = this.renderer.gl;
                gl.clearColor(0.1, 0.1, 0.1, 1.0);
                gl.clear(gl.COLOR_BUFFER_BIT);
            }
            // Clear mask
            this.maskCtx.fillStyle = 'black';
            this.maskCtx.fillRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
            this.maskDirty = true;
        }

        processFrame(buffer, width, height) {
            if (!this.renderer || !this.enabled) {
                Logger.log(`[Scrutinizer] processFrame skipped - renderer: ${!!this.renderer}, enabled: ${this.enabled}`);
                return;
            }

            // Saccadic Suppression: Skip heavy processing during rapid eye movement
            // This simulates "saccadic blindness" and frees up resources for the moment of fixation
            if (this.currentVelocity > this.config.saccadicSuppressionThreshold) {
                // if (Math.random() < 0.05) console.log(`[Scrutinizer] Saccade suppressed (Vel: ${this.currentVelocity.toFixed(1)})`);
                return;
            }

            // Performance Optimization: Reuse pre-allocated ImageData buffer
            // Eliminates 60 allocations/sec (one per frame at 60fps)
            const bufferSize = width * height * 4;
            if (!this.imageDataBuffer || this.lastBufferSize !== bufferSize) {
                // Allocate new buffer only if size changed (e.g., window resize)
                this.imageDataBuffer = new Uint8ClampedArray(bufferSize);
                this.imageData = new ImageData(this.imageDataBuffer, width, height);
                this.lastBufferSize = bufferSize;
                Logger.log(`[Scrutinizer] Allocated ImageData buffer: ${width}x${height}`);
            }

            // Fast typed array copy (much faster than new allocation)
            this.imageDataBuffer.set(buffer);

            // Upload texture
            this.renderer.uploadTexture(this.imageData);

            // Compute saliency from SOURCE browser capture (before rendering effects)
            if (width > 0 && height > 0) {
                // Throttle Saliency: Only compute every N frames (e.g., 15 frames ~ 250ms at 60fps)
                // This is an expensive CPU operation (pixel analysis) so we shouldn't run it every frame.
                if (!this.saliencyFrameCounter) this.saliencyFrameCounter = 0;
                this.saliencyFrameCounter++;

                if (this.saliencyFrameCounter % 15 === 0) {
                    // IMPORTANT: Create a COPY of imageData for the worker
                    // Since we're now reusing this.imageData buffer, we need a separate copy
                    // for the async saliency computation to avoid data corruption
                    const saliencyImageData = new ImageData(
                        new Uint8ClampedArray(this.imageDataBuffer),
                        width,
                        height
                    );

                    // Create ImageBitmap for efficient transfer to worker
                    createImageBitmap(saliencyImageData).then(bitmap => {
                        this.saliencyWorker.postMessage({
                            imageBitmap: bitmap,
                            id: this.saliencyFrameCounter,
                            structureData: this.lastGroupedBlocks || this.lastBlocks // Sync: Pass GESTALT (fused) structure for strong edges
                        }, [bitmap]);
                    });

                    if (Math.random() < 0.01) {
                        console.log(`[Scrutinizer] Uploaded Saliency Map (${width}x${height})`);
                    }
                }
            }

            // Log occasionally
            if (!this.frameUploadCount) {
                this.frameUploadCount = 0;
                Logger.log(`[Scrutinizer] First frame uploaded! ${width}x${height}`);
            }
            this.frameUploadCount++;
            if (this.frameUploadCount % 60 === 0) {
                Logger.log(`[Scrutinizer] Uploaded frame ${this.frameUploadCount} to WebGL (${width}x${height})`);
            }
        }

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

        render() {
            if (!this.renderer) return;

            const now = performance.now();
            const dt = now - this.lastRenderTime;
            this.lastRenderTime = now;

            // Self-heal NaN/Infinity coordinates
            if (!Number.isFinite(this.mouseX) || !Number.isFinite(this.mouseY)) {
                console.warn('[Scrutinizer] Detected NaN/Infinity mouse coordinates, resetting to center');
                this.mouseX = this.canvas.width / 2;
                this.mouseY = this.canvas.height / 2;
                this.targetMouseX = this.mouseX;
                this.targetMouseY = this.mouseY;
                this.currentVelocity = 0;
            }

            // Smooth mouse (skip if target coords not initialized)
            if (this.targetMouseX !== 0 || this.targetMouseY !== 0) {
                this.mouseX += (this.targetMouseX - this.mouseX) * this.config.maskSmoothness;
                this.mouseY += (this.targetMouseY - this.mouseY) * this.config.maskSmoothness;
            }

            // Calculate velocity (pixels per ms)
            // Use raw distance to avoid sqrt for perf? No, we need actual speed.
            const dx = this.mouseX - this.lastMouseX;
            const dy = this.mouseY - this.lastMouseY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Simple moving average for velocity to smooth out jitter
            const instantVelocity = dt > 0 ? dist / dt : 0;

            // Adaptive smoothing (Time-based)
            // We want consistent behavior regardless of FPS
            // Target: 95% smoothing at 60fps (16ms) -> alpha ~0.05
            // Formula: current = lerp(current, instant, 1 - exp(-decay * dt))

            // Decay constants tuned for 60fps equivalent
            const decay = instantVelocity < 1.0 ? this.config.velocityDecayStop : this.config.velocityDecayMove;
            const alpha = 1.0 - Math.exp(-decay * dt);

            this.currentVelocity = this.currentVelocity + (instantVelocity - this.currentVelocity) * alpha;

            this.lastMouseX = this.mouseX;
            this.lastMouseY = this.mouseY;

            // Determine effective radius
            // If disabled, use a huge radius to show the clear image everywhere
            // Canvas height is usually ~1000px, so 5000px is safe
            const effectiveRadius = this.enabled ? this.config.fovealRadius : 5000.0;

            // Update Visual Memory Mask
            // Only if enabled and visual memory is active
            // Use loose equality (!=) to handle '0' string vs 0 number (robustness)
            const useMask = this.enabled && (this.visualMemoryLimit != 0);

            if (useMask) {
                // 1. Fixation Detection
                // Bounds Check: Must be strictly inside the canvas
                const isInside = this.mouseX > 0 && this.mouseX < this.canvas.width &&
                    this.mouseY > 0 && this.mouseY < this.canvas.height;

                // 1. Update Fixation State for "Visual Memory"
                // Only run if Visual Memory is enabled (limit != 0)
                if (this.visualMemoryLimit != 0) {
                    // Velocity-based fixation detection
                    // If moving slow enough, we are fixating
                    if (this.currentVelocity < 0.1) { // Threshold 0.1 px/ms = 100px/s (Adjust as needed)
                        if (!this.isFixating) {
                            this.isFixating = true;
                            this.fixationStartTime = now;
                            // console.log('[Scrutinizer] Fixation started');
                        } else {
                            const dwellTime = now - this.fixationStartTime;
                            if (dwellTime > this.config.dwellTimeThreshold) {
                                // Confirmed fixation! Add/Update buffer
                                // Check if we are close to an existing point to update it instead of adding new
                                const existingIndex = this.visualMemoryBuffer.findIndex(p => {
                                    const dx = p.x - this.mouseX;
                                    const dy = p.y - this.mouseY;
                                    return Math.sqrt(dx * dx + dy * dy) < (effectiveRadius * this.config.foveaBypassMargin);
                                });

                                if (existingIndex !== -1) {
                                    // Update existing
                                    this.visualMemoryBuffer[existingIndex].x = this.mouseX;
                                    this.visualMemoryBuffer[existingIndex].y = this.mouseY;
                                    this.visualMemoryBuffer[existingIndex].timestamp = now;
                                    // console.log('[Scrutinizer] Updated existing fixation point');
                                } else {
                                    // Add new
                                    this.visualMemoryBuffer.push({
                                        x: this.mouseX,
                                        y: this.mouseY,
                                        radius: effectiveRadius,
                                        timestamp: now
                                    });
                                    // console.log(`[Scrutinizer] Added new fixation point. Buffer size: ${this.visualMemoryBuffer.length}, Limit: ${this.visualMemoryLimit}`);

                                    // Enforce Limit
                                    // Limit > 0: FIFO
                                    // Limit == -1: Infinite (no removal)
                                    if (this.visualMemoryLimit > 0 && this.visualMemoryBuffer.length > this.visualMemoryLimit) {
                                        // Remove oldest (first element)
                                        this.visualMemoryBuffer.shift();
                                        // console.log('[Scrutinizer] Limit reached, evicted oldest point');
                                    }
                                }
                            }
                        }
                    } else {
                        if (this.isFixating) {
                            // console.log('[Scrutinizer] Fixation broken (movement)');
                        }
                        this.isFixating = false;
                        this.fixationStartTime = 0;
                    }
                } else {
                    // Behavior if Memory is OFF (Limit 0)
                    // Ensure buffer is empty so we don't draw stale trails if user just toggled it off
                    if (this.visualMemoryBuffer.length > 0) {
                        this.visualMemoryBuffer = [];
                    }
                    this.isFixating = false;
                    this.fixationStartTime = 0;
                }

                // 2. Render Mask
                // Reset composite operation
                this.maskCtx.globalCompositeOperation = 'source-over';
                // Clear to transparent black
                this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);

                // Draw all points in buffer
                const maskScaleX = this.maskCanvas.width / this.canvas.width;
                const maskScaleY = this.maskCanvas.height / this.canvas.height;

                this.maskCtx.globalCompositeOperation = 'screen'; // Additive blending for white spots

                for (const point of this.visualMemoryBuffer) {
                    const maskX = point.x * maskScaleX;
                    const maskY = point.y * maskScaleY;
                    const maskRadius = point.radius * maskScaleX;

                    // Draw soft gradient
                    const gradient = this.maskCtx.createRadialGradient(maskX, maskY, 0, maskX, maskY, maskRadius);
                    gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)'); // Full clarity
                    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
                    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

                    this.maskCtx.fillStyle = gradient;
                    this.maskCtx.beginPath();
                    this.maskCtx.arc(maskX, maskY, maskRadius, 0, Math.PI * 2);
                    this.maskCtx.fill();
                }

                // Removed redundant Current Fovea drawing. Shader handles live fovea.

                // Upload mask to GPU
                this.renderer.uploadMask(this.maskCanvas);
            }

            // --- Saliency Smoothing ---
            // Blend Target -> Current to prevent flicker
            // OPTIMIZATION: Only update when active (countdown > 0) to save GPU bandwidth
            if (this.saliencyTargetCanvas && this.saliencyCurrentCanvas && this.saliencyUpdateCountdown > 0) {
                const ctx = this.saliencyCurrentCanvas.getContext('2d', { alpha: false });

                // Draw Target over Current with low opacity to smooth changes
                // 0.1 = Slow smooth, 0.3 = Fast smooth
                // 0.8 = Fast update (Phase 2 fix for "ghosting" lag)
                // Since we removed the legacy conflict, we can update much faster.
                ctx.globalAlpha = 0.8;
                ctx.drawImage(this.saliencyTargetCanvas, 0, 0);
                ctx.globalAlpha = 1.0;

                // Upload Current to GPU
                this.renderer.uploadSaliencyMap(this.saliencyCurrentCanvas);

                // Decrement activity timer
                this.saliencyUpdateCountdown--;
            }

            // Log first render
            if (!this.renderCount) {
                this.renderCount = 0;
            }
            this.renderCount++;
            if (this.renderCount === 1) {
                Logger.log(`[Scrutinizer] First render call: canvas=${this.canvas.width}x${this.canvas.height}, mouse=(${this.mouseX},${this.mouseY}), radius=${effectiveRadius}`);
            }

            // DEBUG: Log state occasionally
            if (Math.random() < 0.005) {
                console.log(`[Scrutinizer] Render: Enabled=${this.enabled}, Radius=${effectiveRadius}, Mem=${this.visualMemoryLimit}, Vel=${this.currentVelocity.toFixed(3)}`);
                console.log(`[Scrutinizer] Canvas: ${this.canvas.width}x${this.canvas.height}, Display: ${this.canvas.style.display}, Mouse: (${this.mouseX.toFixed(1)}, ${this.mouseY.toFixed(1)})`);
                console.log(`[Scrutinizer] Renderer exists: ${!!this.renderer}, Frame count: ${this.frameUploadCount || 0}`);
            }


            const aspectRatio = this.config.fovealAspectRatio || 1.33;

            // Auto-reduce intensity when visual memory is active to avoid heavy ghosting
            // Remembered areas stay clear, forgotten areas get lighter blur instead of heavy distortion
            const effectiveIntensity = useMask ? this.config.intensity * 0.6 : this.config.intensity;

            // Update SVG Overlay
            if (this.svgOverlay) {
                // FIX: SVG Overlay works in Logical pixels (CSS), while WebGL works in Physical pixels (DPR scaled).
                // We must scale down the physical coordinates back to logical for the DOM overlay.
                // We use the exact scale factor calculated in handleMouseMove to be robust against resolution mismatches.
                const scaleX = this.scaleX || this.dpr || window.devicePixelRatio || 1;
                const scaleY = this.scaleY || scaleX;

                // Approximate shader logic for parafovea (usually 2.5x fovea)
                const parafoveaRadius = effectiveRadius * 2.5;

                this.svgOverlay.update(
                    this.mouseX / scaleX,
                    this.mouseY / scaleY,
                    effectiveRadius / scaleX, // Radius is mostly X-based in shader logic
                    aspectRatio,
                    this.config.debugBoundary,
                    parafoveaRadius / scaleX
                );
            }

            this.renderer.render(
                this.canvas.width,
                this.canvas.height,
                this.mouseX,
                this.mouseY,
                this.config.fovealRadius,
                aspectRatio,
                effectiveIntensity, // Use reduced intensity when memory is active
                this.config.caStrength,
                0.0, // Force disable shader debug (we use SVG now)
                this.config.debugStructure, // New arg
                useMask ? (this.inhibitionMode ? 2.0 : 1.0) : 0.0,
                this.config.mongrelMode,
                this.aestheticMode,
                this.currentVelocity,
                this.mouseX, // stableMouseX
                this.mouseY, // stableMouseY
                (this.hasStructure && this.config.enableStructureMap) ? 1.0 : 0.0, // hasStructure (only if enabled)
                this.config.enableSaliencyModulation ? 1.0 : 0.0, // enableSaliencyModulation
                now / 1000.0 // time (seconds)
            );
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
            console.log('[Scrutinizer] Intensity set to:', intensity);
        }

        toggleCA(enabled) {
            this.config.chromaticAberration = enabled;
            console.log('[Scrutinizer] CA set to:', enabled);
        }

        setDebugBoundaryMode(mode) {
            this.config.debugBoundary = parseFloat(mode);
            console.log(`[Scrutinizer] Debug Boundary set to: ${this.config.debugBoundary}`);
        }

        toggleStructureMap(enabled) {
            this.showStructureMap = enabled;
            this.updateDebugMode();
        }

        toggleSaliencyMap(enabled) {
            this.showSaliencyMap = enabled;
            this.updateDebugMode();

            // Force upload if enabling and map exists
            if (enabled && this.saliencyMap && this.renderer) {
                // The original instruction had a copy-paste error here.
                // Assuming the intent was to upload the saliency map if it exists.
                // The original code uploaded structureMap, but the instruction's snippet
                // implied saliencyMap. I'm going with the instruction's implied change.
                this.renderer.uploadSaliencyMap(this.saliencyMap.getCanvas());
            }
        }

        toggleSaliencyModulation(enabled) {
            this.config.enableSaliencyModulation = enabled;
            Logger.log(`[Scrutinizer] Saliency modulation ${enabled ? 'enabled' : 'disabled'}`);
        }

        updateDebugMode() {
            // Priority: Saliency (2.0) > Structure (1.0) > None (0.0)
            if (this.showSaliencyMap) {
                this.config.debugStructure = 2.0;
            } else if (this.showStructureMap) {
                this.config.debugStructure = 1.0;
            } else {
                this.config.debugStructure = 0.0;
            }
            console.log(`[Scrutinizer] Debug Mode updated: ${this.config.debugStructure} (Saliency: ${this.showSaliencyMap}, Structure: ${this.showStructureMap})`);
        }

        toggleEnableStructureMap(enabled) {
            this.config.enableStructureMap = enabled;
            console.log(`[Scrutinizer] Enable Structure Map set to: ${this.config.enableStructureMap}`);
        }

        setVisualMemoryLimit(limit) {
            const rawLimit = Number(limit);
            ipcRenderer.send('log:renderer', `[Scrutinizer] setVisualMemoryLimit called with: ${limit} -> ${rawLimit}`);
            console.log('[Scrutinizer] Visual Memory Limit set to:', rawLimit);

            if (rawLimit === 20) {
                this.visualMemoryLimit = 10;
                this.inhibitionMode = true;
                ipcRenderer.send('log:renderer', '[Scrutinizer] Mode: Inhibition of Return');
                console.log('[Scrutinizer] Mode: Inhibition of Return');
            } else {
                this.visualMemoryLimit = rawLimit;
                this.inhibitionMode = false;
            }

            // Always reset memory when changing modes to prevent "ghosts"
            // e.g. switching from Infinite to Limited should clear the infinite mask
            this.resetVisualMemory();
            ipcRenderer.send('log:renderer', `[Scrutinizer] Visual Memory Reset. Current Buffer Size: ${this.visualMemoryBuffer.length}`);
        }

        resetVisualMemory() {
            console.log('[Scrutinizer] Resetting visual memory mask');
            this.visualMemoryBuffer = [];
            this.maskCtx.globalCompositeOperation = 'source-over';
            this.maskCtx.fillStyle = 'black';
            this.maskCtx.fillRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
            this.maskDirty = true;
            // Upload immediately to clear GPU state
            if (this.renderer) {
                this.renderer.uploadMask(this.maskCanvas);
            }
        }

        setMongrelMode(mode) {
            this.config.mongrelMode = Number(mode); // Ensure number
            const msg = `[Scrutinizer] Mongrel Mode set to: ${this.config.mongrelMode} (Type: ${typeof this.config.mongrelMode})`;
            console.log(msg);
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('log:renderer', msg);
        }

        setAestheticMode(mode) {
            this.aestheticMode = Number(mode);
            const msg = `[Scrutinizer] Aesthetic Mode set to: ${this.aestheticMode}`;
            console.log(msg);
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('log:renderer', msg);
        }

        handleStructureUpdate(blocks) {
            if (!this.renderer || !this.structureMap) return;

            // Optimization: Check if blocks have actually changed
            // This prevents flicker on sites like YouTube where attributes change rapidly (progress bars)
            // but the layout remains stable.
            if (this.areBlocksEqual(this.lastBlocks, blocks)) {
                // console.log('[Scrutinizer] Skipping redundant structure update');
                return;
            }
            this.lastBlocks = blocks;

            // console.log(`[Scrutinizer] Received structure update: ${blocks.length} blocks`);

            // Ensure map size matches viewport
            this.structureMap.resize(this.canvas.width, this.canvas.height);
            this.structureMap.clear();

            // Gestalt Grouping: Merge adjacent text blocks into "Paragraphs"
            // This reduces visual clutter and simulates "pre-attentive" grouping of text lines
            // Phase 5b: Full Gestalt Closure
            const groupedBlocks = this.gestaltProcessor.process(blocks);
            this.lastGroupedBlocks = groupedBlocks;

            // Draw blocks
            const dpr = window.devicePixelRatio || 1;
            const yOffset = 0; //80px; // Toolbar height compensation
            for (const block of groupedBlocks) {
                this.structureMap.drawBlock(
                    block.x * dpr,
                    (block.y + yOffset) * dpr,
                    block.w * dpr,
                    block.h * dpr,
                    block.type,
                    block.density,
                    block.lineHeight,
                    block.color
                );
            }

            // Upload to GPU
            if (this.renderer) {
                this.renderer.uploadStructureMap(this.structureMap.getCanvas());
            }
        }

        areBlocksEqual(prev, next) {
            if (!prev && !next) return true;
            if (!prev || !next) return false;
            if (prev.length !== next.length) return false;

            // Check a few random samples to fail fast? 
            // Or just check all. For <1000 blocks, checking all is fast enough (sub-ms).
            // We check geometry and type with a small epsilon for floats
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

        groupStructureBlocks(rawBlocks) {
            if (!rawBlocks || rawBlocks.length === 0) return [];

            // Quantize blocks to stabilize the structure map against small layout shifts
            // Text: 1px grid (remove sub-pixel jitter)
            // UI/Media: 10px grid (stabilize progress bars/animations)
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

            // 1. Filter only text blocks (type 1) for grouping. Keep others as is.
            // FIX: Previously checked type 0 (UI), which caused instability with changing UI elements
            const textBlocks = blocks.filter(b => b.type === 1);
            const otherBlocks = blocks.filter(b => b.type !== 1);

            if (textBlocks.length === 0) return otherBlocks;

            // 2. Sort by Y then X
            // Quantize coordinates to prevent sub-pixel jitter from affecting sort order
            textBlocks.sort((a, b) => {
                const yDiff = Math.floor(a.y) - Math.floor(b.y);
                if (yDiff !== 0) return yDiff;
                return Math.floor(a.x) - Math.floor(b.x);
            });

            const merged = [];
            let current = textBlocks[0];

            for (let i = 1; i < textBlocks.length; i++) {
                const next = textBlocks[i];

                // Check for vertical adjacency and alignment
                const verticalGap = next.y - (current.y + current.h);
                const isVerticalNeighbor = verticalGap >= -5 && verticalGap <= (current.lineHeight * 1.5); // Allow small overlap or gap

                // Check horizontal alignment (left aligned or similar width)
                const isAligned = Math.abs(current.x - next.x) < 20 && Math.abs(current.w - next.w) < 50;

                if (isVerticalNeighbor && isAligned) {
                    // Merge 'next' into 'current'
                    // New height includes the gap
                    const newHeight = (next.y + next.h) - current.y;
                    current.h = newHeight;
                    // Use max width
                    current.w = Math.max(current.w, next.w);
                    // Keep density/lineHeight of the top block (simplification)
                } else {
                    // Push current and start new group
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
