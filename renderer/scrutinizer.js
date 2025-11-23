/**
 * Scrutinizer - Foveal Vision Simulator
 * Core logic for capturing, processing, and rendering the peripheral vision effect
 */

class Scrutinizer {
    constructor(config) {
        // WebContentsView is managed by main process; we receive frames via IPC
        this.config = config;
        this.processor = new ImageProcessor(config);

        // Canvas setup
        this.canvas = document.getElementById('overlay-canvas');
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

        // Offscreen canvases for rendering
        this.originalCanvas = document.createElement('canvas');
        this.originalCtx = this.originalCanvas.getContext('2d', { willReadFrequently: true });

        this.sharpCanvas = document.createElement('canvas');
        this.sharpCtx = this.sharpCanvas.getContext('2d', { willReadFrequently: true });

        this.fovealCanvas = document.createElement('canvas');
        this.fovealCtx = this.fovealCanvas.getContext('2d', { willReadFrequently: true });

        this.maskCanvas = document.createElement('canvas');
        this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });

        this.blurredCanvas = document.createElement('canvas');
        this.blurredCtx = this.blurredCanvas.getContext('2d', { willReadFrequently: true });

        // Multi-level blur pyramid canvases for progressive filtering
        this.pyramidCanvases = [];
        this.pyramidCtxs = [];
        for (let i = 0; i < 3; i++) {
            const canvas = document.createElement('canvas');
            this.pyramidCanvases.push(canvas);
            this.pyramidCtxs.push(canvas.getContext('2d', { willReadFrequently: true }));
        }

        // State
        this.enabled = false;
        this.isCapturing = false;
        this.processedImage = null; // Blurred/desaturated background

        // Track blur jobs so we can ignore stale worker results when blur
        // radius or content changes rapidly while foveal mode is active.
        this.blurJobId = 0;

        // Web Worker for blur computation
        if (this.config.useFoveatedBlur) {
            this.blurWorker = new Worker('blur-worker.js');
            this.blurWorker.onmessage = this.handleWorkerMessage.bind(this);
            this.blurWorker.onerror = (error) => {
                console.error('Blur worker error:', error);
                this.blurWorker = null; // Fallback to main thread
            };
        }

        // Mouse tracking
        this.mouseX = 0;
        this.mouseY = 0;
        this.targetMouseX = 0;
        this.targetMouseY = 0;

        // Debounce timers
        this.scrollTimeout = null;
        this.mutationTimeout = null;
        this.inputTimeout = null;
        this.resizeTimeout = null;
        this.mouseCaptureTimeout = null;

        // Bind methods
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleScroll = this.handleScroll.bind(this);
        this.handleMutation = this.handleMutation.bind(this);
        this.handleInputChange = this.handleInputChange.bind(this);
        this.handleResize = this.handleResize.bind(this);
        this.render = this.render.bind(this);

        this.setupEventListeners();
    }

    setupEventListeners() {
        // Mouse tracking on window to catch all mouse movement
        window.addEventListener('mousemove', this.handleMouseMove);

        // Window resize handling
        window.addEventListener('resize', this.handleResize);

        // Track on the webview container for overlay mouse events
        const container = document.getElementById('webview-container');
        if (container) {
            container.addEventListener('mousemove', this.handleMouseMove);
        }

        // IPC listeners for events from WebContentsView (via preload → main → renderer)
        // These will be wired up in app.js via ipcRenderer.on()


    }

    handleResize() {
        // Resize is handled automatically by paint events from WebContentsView
        // No need to manually trigger capture
    }

    handleMouseMove(event) {
        // Get mouse position relative to the canvas
        const rect = this.canvas.getBoundingClientRect();
        this.targetMouseX = event.clientX - rect.left;
        this.targetMouseY = event.clientY - rect.top;

        // Mouse tracking updates foveal position in render loop
        // Paint events from WebContentsView provide frames automatically
    }

    handleScroll() {
        // Scroll changes trigger paint events automatically from WebContentsView
        // No manual capture needed
    }

    handleMutation() {
        // DOM mutations trigger paint events automatically from WebContentsView
        // No manual capture needed
    }

    handleInputChange() {
        // Input changes trigger paint events automatically from WebContentsView
        // No manual capture needed
    }

    async toggle() {
        this.enabled = !this.enabled;

        if (this.enabled) {
            await this.enable();
        } else {
            this.disable();
        }

        return this.enabled;
    }

    async enable() {
        // Ensure internal state flag matches visual state, even when enable()
        // is called directly (e.g. from pending init state).
        this.enabled = true;
        this.canvas.style.display = 'block';

        // Initialize foveal center to canvas center as a safe default
        const rect = this.canvas.getBoundingClientRect();
        this.mouseX = rect.width / 2;
        this.mouseY = rect.height / 2;
        this.targetMouseX = this.mouseX;
        this.targetMouseY = this.mouseY;

        // Frames will arrive via paint events; just start render loop
        this.startRenderLoop();
    }

    disable() {
        // Keep enabled flag in sync when disabling from any code path.
        this.enabled = false;
        this.canvas.style.display = 'none';
        this.stopRenderLoop();
    }

    handleWorkerMessage(e) {
        // Ignore stale worker results that belong to an older blur job.
        if (typeof e.data.jobId === 'number' && e.data.jobId !== this.blurJobId) {
            // Still clear capturing flag so future captures are not blocked.
            this.isCapturing = false;
            return;
        }

        if (e.data.success) {
            if (e.data.pyramid) {
                // Store multi-level pyramid
                e.data.pyramid.forEach((level, i) => {
                    // Ensure pyramid canvas is sized
                    if (this.pyramidCanvases[i].width !== level.width || this.pyramidCanvases[i].height !== level.height) {
                        this.pyramidCanvases[i].width = level.width;
                        this.pyramidCanvases[i].height = level.height;
                    }
                    this.pyramidCtxs[i].putImageData(level, 0, 0);
                });
                this.hasPyramid = true;
            } else if (e.data.blurred) {
                // Single blur fallback
                this.blurredCtx.putImageData(e.data.blurred, 0, 0);
            }
            this.hasProcessedImage = true;
            this.isCapturing = false;
        } else {
            console.error('Worker blur failed:', e.data.error);
            this.isCapturing = false;
        }
    }

    processFrame(buffer, width, height) {
        if (this.isCapturing) return;
        this.isCapturing = true;

        try {
            // Ensure main canvas matches frame size
            if (this.canvas.width !== width || this.canvas.height !== height) {
                this.canvas.width = width;
                this.canvas.height = height;
                // Prevent transparency by filling with white immediately
                this.ctx.fillStyle = 'white';
                this.ctx.fillRect(0, 0, width, height);
            }

            // Ensure offscreen canvases match
            if (this.originalCanvas.width !== width || this.originalCanvas.height !== height) {
                this.originalCanvas.width = width;
                this.originalCanvas.height = height;
            }
            if (this.sharpCanvas.width !== width || this.sharpCanvas.height !== height) {
                this.sharpCanvas.width = width;
                this.sharpCanvas.height = height;
            }

            // Ensure blurred canvas matches
            if (this.blurredCanvas.width !== width || this.blurredCanvas.height !== height) {
                this.blurredCanvas.width = width;
                this.blurredCanvas.height = height;
            }

            // Convert BGRA buffer to ImageData
            // Note: Electron's toBitmap() returns BGRA, but ImageData expects RGBA
            // We need to swap R and B channels
            const imageData = new ImageData(width, height);
            for (let i = 0; i < buffer.length; i += 4) {
                imageData.data[i] = buffer[i + 2];     // R = B
                imageData.data[i + 1] = buffer[i + 1]; // G = G
                imageData.data[i + 2] = buffer[i];     // B = R
                imageData.data[i + 3] = buffer[i + 3]; // A = A
            }

            // Draw to offscreen canvases - preserve original for binocular overlay
            this.originalCtx.clearRect(0, 0, width, height);
            this.originalCtx.fillStyle = 'white';
            this.originalCtx.fillRect(0, 0, width, height);
            this.originalCtx.putImageData(imageData, 0, 0);

            this.sharpCtx.clearRect(0, 0, width, height);
            this.sharpCtx.fillStyle = 'white';
            this.sharpCtx.fillRect(0, 0, width, height);
            this.sharpCtx.putImageData(imageData, 0, 0);

            // Get image data for processing from offscreen canvas
            let baseData = this.sharpCtx.getImageData(0, 0, width, height);

            // Apply desaturation first
            baseData = this.processor.desaturate(baseData);

            // For very small blur radii (e.g., the "Light" preset), the
            // foveated multi-level path can introduce visual artifacts
            // without adding much perceptual benefit. In that case fall
            // back to the stable uniform blur path.
            const useFoveatedForThisFrame = this.config.useFoveatedBlur && this.config.blurRadius >= 8;

            if (useFoveatedForThisFrame) {
                // Hybrid path: simplified blur + real-time compositing
                // Store sharp (desaturated) version immediately
                this.sharpCtx.putImageData(baseData, 0, 0);
                this.hasProcessedImage = true; // We can keep showing the
                                              // previous blur pyramid while
                                              // the new one computes.

                // Offload blur pyramid to Web Worker (non-blocking)
                if (this.blurWorker) {
                    // Bump job id so we can ignore out-of-order worker results.
                    const jobId = ++this.blurJobId;
                    const blurInput = new ImageData(
                        new Uint8ClampedArray(baseData.data), 
                        baseData.width, 
                        baseData.height
                    );
                    this.blurWorker.postMessage({
                        imageData: blurInput,
                        baseBlurRadius: this.config.blurRadius,
                        buildPyramid: true,
                        jobId
                    }, [blurInput.data.buffer]);
                    // Worker will call handleWorkerMessage when done
                    return; // Don't set isCapturing = false yet
                } else {
                    // Fallback to main thread if worker failed
                    const blurredData = this.processor.blur(
                        new ImageData(new Uint8ClampedArray(baseData.data), baseData.width, baseData.height),
                        this.config.blurRadius * 1.5
                    );
                    this.blurredCtx.putImageData(blurredData, 0, 0);
                }
            } else {
                // Stable path: uniform blur across the entire image
                let imageData = this.processor.blur(baseData, this.config.blurRadius);
                this.blurredCtx.putImageData(imageData, 0, 0);
            }
            this.hasProcessedImage = true;

        } catch (error) {
            console.error('Error capturing/processing:', error);
        } finally {
            this.isCapturing = false;
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
        if (!this.hasProcessedImage) {
            return;
        }

        // Hybrid progressive filter: real-time gradient compositing with multi-level pyramid
        if (this.config.useFoveatedBlur) {
            // Smooth mouse movement at 60fps
            this.mouseX += (this.targetMouseX - this.mouseX) * this.config.maskSmoothness;
            this.mouseY += (this.targetMouseY - this.mouseY) * this.config.maskSmoothness;

            if (this.hasPyramid) {
                // Use multi-level pyramid for progressive blur
                // Layer from back to front: heavy blur -> moderate blur -> light blur -> sharp
                
                const r1 = this.config.fovealRadius * 0.3;  // Inner sharp zone
                const r2 = this.config.fovealRadius * 0.8;  // Light blur zone
                const r3 = this.config.fovealRadius * 1.5;  // Moderate blur zone
                // Beyond r3: Heavy blur

                // 1. Draw heavy blur everywhere (Level 2)
                this.ctx.drawImage(this.pyramidCanvases[2], 0, 0);

                // 2. Draw moderate blur with gradient mask (Level 1)
                this.ctx.save();
                this.ctx.globalCompositeOperation = 'destination-out';
                let gradient = this.ctx.createRadialGradient(
                    this.mouseX, this.mouseY, r2,
                    this.mouseX, this.mouseY, r3
                );
                gradient.addColorStop(0, 'rgba(0,0,0,1)');
                gradient.addColorStop(1, 'rgba(0,0,0,0)');
                this.ctx.fillStyle = gradient;
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.restore();

                this.ctx.globalCompositeOperation = 'destination-over';
                this.ctx.drawImage(this.pyramidCanvases[1], 0, 0);
                this.ctx.globalCompositeOperation = 'source-over';

                // 3. Draw light blur with gradient mask (Level 0)
                this.ctx.save();
                this.ctx.globalCompositeOperation = 'destination-out';
                gradient = this.ctx.createRadialGradient(
                    this.mouseX, this.mouseY, r1,
                    this.mouseX, this.mouseY, r2
                );
                gradient.addColorStop(0, 'rgba(0,0,0,1)');
                gradient.addColorStop(1, 'rgba(0,0,0,0)');
                this.ctx.fillStyle = gradient;
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.restore();

                this.ctx.globalCompositeOperation = 'destination-over';
                this.ctx.drawImage(this.pyramidCanvases[0], 0, 0);
                this.ctx.globalCompositeOperation = 'source-over';

                // 4. Draw sharp content at very center
                this.ctx.save();
                this.ctx.globalCompositeOperation = 'destination-out';
                gradient = this.ctx.createRadialGradient(
                    this.mouseX, this.mouseY, 0,
                    this.mouseX, this.mouseY, r1
                );
                gradient.addColorStop(0, 'rgba(0,0,0,1)');
                gradient.addColorStop(1, 'rgba(0,0,0,0)');
                this.ctx.fillStyle = gradient;
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.restore();

                this.ctx.globalCompositeOperation = 'destination-over';
                this.ctx.drawImage(this.sharpCanvas, 0, 0);
                this.ctx.globalCompositeOperation = 'source-over';
            } else {
                // Fallback to simple gradient if pyramid not ready
                this.ctx.drawImage(this.sharpCanvas, 0, 0);
            }

            // 5. Calculate binocular dimensions (needed for desaturation mask)
            const bioRadius = this.config.fovealRadius * 0.45;
            const eyeOffset = bioRadius * 0.6;
            const totalWidth = (bioRadius * 2) + (eyeOffset * 2);
            const totalHeight = bioRadius * 2;
            const boxX = this.mouseX - (totalWidth / 2);
            const boxY = this.mouseY - bioRadius;

            // 6. Add binocular foveal overlay from captured content FIRST (full color)
            // Resize binocular canvases if needed
            if (this.fovealCanvas.width !== totalWidth || this.fovealCanvas.height !== totalHeight) {
                this.fovealCanvas.width = totalWidth;
                this.fovealCanvas.height = totalHeight;
                this.maskCanvas.width = totalWidth;
                this.maskCanvas.height = totalHeight;
            }

            // Create binocular mask
            this.maskCtx.clearRect(0, 0, totalWidth, totalHeight);
            this.maskCtx.globalCompositeOperation = 'lighter';

            const drawEye = (ctx, centerX, centerY) => {
                const gradient = ctx.createRadialGradient(
                    centerX, centerY, bioRadius * 0.4,
                    centerX, centerY, bioRadius
                );
                gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
                gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(centerX, centerY, bioRadius, 0, Math.PI * 2);
                ctx.fill();
            };

            const centerX = totalWidth / 2;
            const centerY = totalHeight / 2;
            drawEye(this.maskCtx, centerX - eyeOffset, centerY);
            drawEye(this.maskCtx, centerX + eyeOffset, centerY);

            // Apply mask to captured ORIGINAL (color) content.
            // Use boxX/boxY directly so the foveal patch stays registered
            // with the blurred background; let drawImage handle cropping
            // when the binocular region approaches canvas edges.
            this.fovealCtx.clearRect(0, 0, totalWidth, totalHeight);
            this.fovealCtx.drawImage(
                this.originalCanvas,
                boxX,
                boxY,
                totalWidth,
                totalHeight,
                0,
                0,
                totalWidth,
                totalHeight
            );
            this.fovealCtx.globalCompositeOperation = 'destination-in';
            this.fovealCtx.drawImage(this.maskCanvas, 0, 0);
            this.fovealCtx.globalCompositeOperation = 'source-over';

            // Composite binocular overlay onto main canvas
            this.ctx.drawImage(this.fovealCanvas, boxX, boxY);

            // 7. Progressive desaturation is already baked into the pyramid blur layers
            // The binocular overlay from originalCanvas provides the only color content
            // This mimics how color vision is limited to the fovea

            // 8. Exclude scrollbar - keep it sharp (typically 15-17px on right edge)
            const scrollbarWidth = 17;
            const scrollbarX = this.canvas.width - scrollbarWidth;
            if (scrollbarX > 0) {
                this.ctx.drawImage(
                    this.originalCanvas,
                    scrollbarX, 0, scrollbarWidth, this.canvas.height,
                    scrollbarX, 0, scrollbarWidth, this.canvas.height
                );
            }

            return;
        }

        // Smooth mouse movement
        this.mouseX += (this.targetMouseX - this.mouseX) * this.config.maskSmoothness;
        this.mouseY += (this.targetMouseY - this.mouseY) * this.config.maskSmoothness;


        // 1. Draw blurred/desaturated background using drawImage (FAST)
        // this.ctx.putImageData(this.processedImage, 0, 0); // SLOW
        this.ctx.drawImage(this.blurredCanvas, 0, 0);

        // 2. Draw sharp foveal region with soft edge (Binocular / 16:9)
        const radius = this.config.fovealRadius;
        // User logic: "16:9 assumes each eye is 10 wide".
        // If Total=16, Eye=10. Center offset = 3. Radius = 5.
        // Offset factor = 3/5 = 0.6.
        const eyeOffset = radius * 0.6;

        const totalWidth = (radius * 2) + (eyeOffset * 2);
        const totalHeight = radius * 2;

        // Resize offscreen canvases if needed
        if (this.fovealCanvas.width !== totalWidth || this.fovealCanvas.height !== totalHeight) {
            this.fovealCanvas.width = totalWidth;
            this.fovealCanvas.height = totalHeight;
            this.maskCanvas.width = totalWidth;
            this.maskCanvas.height = totalHeight;
        }

        // Calculate top-left of the foveal box
        const boxX = this.mouseX - (totalWidth / 2);
        const boxY = this.mouseY - radius;

        // A. Prepare the Mask (Union of two eyes)
        this.maskCtx.clearRect(0, 0, totalWidth, totalHeight);
        // Use 'lighter' for additive blending (binocular summation)
        this.maskCtx.globalCompositeOperation = 'lighter';

        // Helper to draw one eye gradient
        const drawEye = (ctx, centerX, centerY) => {
            const gradient = ctx.createRadialGradient(
                centerX, centerY, radius * 0.4, // Start fading
                centerX, centerY, radius        // End fading
            );
            gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            ctx.fill();
        };

        // Draw Left Eye Mask
        const centerX = totalWidth / 2;
        const centerY = totalHeight / 2;
        drawEye(this.maskCtx, centerX - eyeOffset, centerY);
        drawEye(this.maskCtx, centerX + eyeOffset, centerY);

        // B. Prepare the Sharp Content
        this.fovealCtx.clearRect(0, 0, totalWidth, totalHeight);
        this.fovealCtx.globalCompositeOperation = 'source-over';

        // Draw sharp image chunk
        this.fovealCtx.drawImage(
            this.sharpCanvas,
            boxX, boxY, totalWidth, totalHeight, // Source
            0, 0, totalWidth, totalHeight        // Dest
        );

        // C. Apply Mask to Sharp Content
        this.fovealCtx.globalCompositeOperation = 'destination-in';
        this.fovealCtx.drawImage(this.maskCanvas, 0, 0);

        // D. Composite onto Main Canvas
        this.ctx.drawImage(this.fovealCanvas, boxX, boxY);

        // E. Exclude scrollbar - keep it sharp
        const scrollbarWidth = 17;
        const scrollbarX = this.canvas.width - scrollbarWidth;
        if (scrollbarX > 0) {
            this.ctx.drawImage(
                this.sharpCanvas,
                scrollbarX, 0, scrollbarWidth, this.canvas.height,
                scrollbarX, 0, scrollbarWidth, this.canvas.height
            );
        }
    }

    updateFovealRadius(radius) {
        // Accept absolute value (from menu) or delta (from wheel)
        // If radius looks like a delta (small number, could be negative), treat as delta
        // Otherwise treat as absolute value
        let newRadius;
        if (typeof radius === 'number' && Math.abs(radius) <= 50 && radius !== 20) {
            // Likely a delta from wheel event
            newRadius = this.config.fovealRadius + radius;
        } else {
            // Absolute value from menu
            newRadius = radius;
        }
        newRadius = Math.max(20, Math.min(300, newRadius));
        this.config.fovealRadius = newRadius;
    }

    updateBlurRadius(radius) {
        this.config.blurRadius = radius;

        // Debounce reprocessing to avoid lag while dragging slider
        if (this.blurUpdateTimeout) clearTimeout(this.blurUpdateTimeout);
        this.blurUpdateTimeout = setTimeout(() => {
            this.captureAndProcess();
        }, 100);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Scrutinizer;
}
