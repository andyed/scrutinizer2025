(() => {
    const { ipcRenderer } = require('electron');
    const Logger = require('./logger');
    const WebGLRenderer = require('./webgl-renderer');
    const StructureMap = require('./structure-map');

    class Scrutinizer {
        constructor(config) {
            this.config = config;

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

            // Initialize Structure Map
            this.structureMap = new StructureMap();

            this.enabled = false;
            this.lastFrameBitmap = null;

            // Visual Memory (Fog of War)
            this.visualMemoryLimit = 0; // 0 = Off, -1 = Infinite, >0 = Count
            this.maskCanvas = document.createElement('canvas');
            this.maskCtx = this.maskCanvas.getContext('2d', { alpha: false }); // No transparency needed, just B&W
            this.maskDirty = true;

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
            this.currentZoom = 1.0;

            // Bind methods
            this.handleMouseMove = this.handleMouseMove.bind(this);
            this.handleResize = this.handleResize.bind(this);
            this.render = this.render.bind(this);
            this.handleStructureUpdate = this.handleStructureUpdate.bind(this);

            this.setupEventListeners();
        }

        setupEventListeners() {
            window.addEventListener('mousemove', this.handleMouseMove);
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
                }
            });
        }

        handleStructureUpdate(blocks) {
            if (!this.renderer || !this.structureMap) return;

            // console.log(`[Scrutinizer] Received structure update: ${blocks.length} blocks`);

            // Ensure map size matches viewport
            this.structureMap.resize(this.canvas.width, this.canvas.height);
            this.structureMap.clear();

            // Draw blocks
            const dpr = this.dpr || 1;

            for (const block of blocks) {
                this.structureMap.drawBlock(
                    block.x * dpr, block.y * dpr, block.w * dpr, block.h * dpr,
                    block.type, block.density, block.lineHeight
                );
            }

            // Upload to GPU
            this.renderer.uploadStructureMap(this.structureMap.getCanvas());
        }
        handleMouseMove(event) {
            const rect = this.canvas.getBoundingClientRect();
            // WebGL viewport handles scaling, but we need mouse in canvas pixel coords
            // If canvas.width != rect.width (HiDPI), we need to scale
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;

            // Update zoom if provided in event (from synthetic event)
            if (event.zoom) {
                this.currentZoom = event.zoom;
            }

            // Apply zoom correction to client coordinates
            let clientX = event.clientX;
            let clientY = event.clientY;

            if (event.zoom) {
                clientX *= event.zoom;
                clientY *= event.zoom;
            }

            this.targetMouseX = (clientX - rect.left) * scaleX;
            this.targetMouseY = (clientY - rect.top) * scaleY;
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

            // Create ImageData from buffer
            const imageData = new ImageData(new Uint8ClampedArray(buffer), width, height);

            // Upload texture
            this.renderer.uploadTexture(imageData);

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

            // Smooth mouse
            this.mouseX += (this.targetMouseX - this.mouseX) * this.config.maskSmoothness;
            this.mouseY += (this.targetMouseY - this.mouseY) * this.config.maskSmoothness;

            // Calculate velocity (pixels per ms)
            // Use raw distance to avoid sqrt for perf? No, we need actual speed.
            const dx = this.mouseX - this.lastMouseX;
            const dy = this.mouseY - this.lastMouseY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Simple moving average for velocity to smooth out jitter
            // Increased smoothing to 0.95 to prevent "bouncy" velocity on steady movements
            const instantVelocity = dt > 0 ? dist / dt : 0;
            this.currentVelocity = this.currentVelocity * 0.95 + instantVelocity * 0.05;

            this.lastMouseX = this.mouseX;
            this.lastMouseY = this.mouseY;

            // Determine effective radius
            // If disabled, use a huge radius to show the clear image everywhere
            // Canvas height is usually ~1000px, so 5000px is safe
            const effectiveRadius = this.enabled ? this.config.fovealRadius : 5000.0;

            // Update Mask (Fog of War)
            // Only if enabled and visual memory is active
            const useMask = this.enabled && (this.visualMemoryLimit !== 0);

            if (useMask) {
                // 1. Decay Logic
                // If limit > 0, we decay.
                // 5 items ~ 1-2s persistence -> faster decay
                // 10 items ~ 5-10s persistence -> slower decay
                // Infinite (-1) -> No decay

                if (this.visualMemoryLimit > 0) {
                    let baseDecay = 0.0;
                    let interferenceDecay = 0.0;

                    if (this.visualMemoryLimit === 5) {
                        baseDecay = 0.005; // Passive fade (scanning)
                        interferenceDecay = 0.012; // Active displacement (was 0.025) - More retention
                    } else if (this.visualMemoryLimit === 10) {
                        baseDecay = 0.003; // Very slow passive fade (was 0.002)
                        interferenceDecay = 0.006; // Weak displacement (was 0.004)
                    }

                    // Calculate effective decay
                    // If velocity is low (fixation), we are encoding new info, so old info is displaced faster.
                    let currentDecay = baseDecay;
                    if (this.currentVelocity < 0.5) { // Same threshold as painting
                        currentDecay += interferenceDecay;
                    }

                    // Apply global fade
                    this.maskCtx.globalCompositeOperation = 'destination-out';
                    this.maskCtx.fillStyle = `rgba(0, 0, 0, ${currentDecay})`;
                    this.maskCtx.fillRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
                }

                // 2. Painting Logic
                // Infinite (-1): Instant clear, no velocity check
                // Limited (>0): Dwell-based clear, velocity check (fixation only)

                let brushOpacity = 0.0;
                let velocityThreshold = 0.0;

                if (this.visualMemoryLimit === -1) {
                    // Infinite: Fog of War style
                    brushOpacity = 1.0; // Instant clear
                    velocityThreshold = Infinity; // Always paint
                } else {
                    // Limited: Working Memory simulation
                    // Bumped opacity significantly (0.05 -> 0.15) to make memory visible and reduce CA artifacts
                    // Still requires ~7 frames (~100ms) to reach full clarity, so dwell is still needed but less punishing.
                    brushOpacity = 0.15;
                    velocityThreshold = 0.5; // Fixation only
                }

                if (this.currentVelocity < velocityThreshold) {
                    // Draw soft white circle on mask at current mouse position
                    // We need to map main canvas coords to mask canvas coords
                    const maskScaleX = this.maskCanvas.width / this.canvas.width;
                    const maskScaleY = this.maskCanvas.height / this.canvas.height;

                    const maskX = this.mouseX * maskScaleX;
                    const maskY = this.mouseY * maskScaleY;
                    const maskRadius = effectiveRadius * maskScaleX; // Assume uniform scaling roughly

                    // Draw "brush"
                    const gradient = this.maskCtx.createRadialGradient(maskX, maskY, maskRadius * 0.5, maskX, maskY, maskRadius);
                    gradient.addColorStop(0, `rgba(255, 255, 255, ${brushOpacity})`);
                    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)'); // Fade out

                    this.maskCtx.globalCompositeOperation = 'screen'; // Additive light (accumulates up to 1.0)
                    this.maskCtx.fillStyle = gradient;
                    this.maskCtx.beginPath();
                    this.maskCtx.arc(maskX, maskY, maskRadius, 0, Math.PI * 2);
                    this.maskCtx.fill();
                }

                // Upload mask to GPU
                this.renderer.uploadMask(this.maskCanvas);
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

            this.renderer.render(
                this.canvas.width,
                this.canvas.height,
                this.mouseX,
                this.mouseY,
                this.config.fovealRadius,
                this.config.peripheralIntensity,
                this.config.caStrength,
                this.config.debugBoundary,
                this.config.debugStructure, // New arg
                useMask ? 1.0 : 0.0,
                this.config.mongrelMode,
                this.aestheticMode,
                this.currentVelocity,
                this.mouseX, // stableMouseX
                this.mouseY, // stableMouseY
                (this.hasStructure && this.config.enableStructureMap) ? 1.0 : 0.0 // hasStructure (only if enabled)
            );
        }

        updateFovealRadius(value, isDelta = false) {
            let newRadius;
            if (isDelta) {
                newRadius = this.config.fovealRadius + value;
            } else {
                newRadius = value;
            }
            newRadius = Math.max(20, Math.min(300, newRadius));
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

        toggleDebugBoundary(enabled) {
            this.config.debugBoundary = enabled ? 1.0 : 0.0;
            console.log(`[Scrutinizer] Debug Boundary set to: ${this.config.debugBoundary}`);
        }

        toggleStructureMap(enabled) {
            this.config.debugStructure = enabled ? 1.0 : 0.0;
            console.log(`[Scrutinizer] Debug Structure set to: ${this.config.debugStructure}`);
        }

        toggleEnableStructureMap(enabled) {
            this.config.enableStructureMap = enabled;
            console.log(`[Scrutinizer] Enable Structure Map set to: ${this.config.enableStructureMap}`);
        }

        setVisualMemoryLimit(limit) {
            this.visualMemoryLimit = limit;
            console.log('[Scrutinizer] Visual Memory Limit set to:', limit);

            // Always reset memory when changing modes to prevent "ghosts"
            // e.g. switching from Infinite to Limited should clear the infinite mask
            this.resetVisualMemory();
        }

        resetVisualMemory() {
            console.log('[Scrutinizer] Resetting visual memory mask');
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

            // console.log(`[Scrutinizer] Received structure update: ${blocks.length} blocks`);

            // Ensure map size matches viewport
            this.structureMap.resize(this.canvas.width, this.canvas.height);
            this.structureMap.clear();

            // Draw blocks
            const dpr = window.devicePixelRatio || 1;
            const yOffset = 0; //80px; // Toolbar height compensation
            for (const block of blocks) {
                this.structureMap.drawBlock(
                    block.x * dpr, (block.y + yOffset) * dpr, block.w * dpr, block.h * dpr,
                    block.type, block.density, block.lineHeight
                );
            }

            // Upload to GPU
            this.renderer.uploadStructureMap(this.structureMap.getCanvas());
        }
    }

    // Expose to window
    window.Scrutinizer = Scrutinizer;
})();
