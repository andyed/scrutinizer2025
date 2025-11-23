/**
 * Scrutinizer - Foveal Vision Simulator
 * Core logic for capturing, processing, and rendering the peripheral vision effect
 */

class Scrutinizer {
    constructor(webview, config) {
        this.webview = webview;
        this.config = config;
        this.processor = new ImageProcessor(config);

        // Canvas setup
        this.canvas = document.getElementById('overlay-canvas');
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

        // Offscreen canvases for rendering
        this.sharpCanvas = document.createElement('canvas');
        this.sharpCtx = this.sharpCanvas.getContext('2d', { willReadFrequently: true });

        this.fovealCanvas = document.createElement('canvas');
        this.fovealCtx = this.fovealCanvas.getContext('2d', { willReadFrequently: true });

        this.maskCanvas = document.createElement('canvas');
        this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });

        this.blurredCanvas = document.createElement('canvas');
        this.blurredCtx = this.blurredCanvas.getContext('2d', { willReadFrequently: true });

        // State
        this.enabled = false;
        this.isCapturing = false;
        this.processedImage = null; // Blurred/desaturated background

        // Mouse tracking
        this.mouseX = 0;
        this.mouseY = 0;
        this.targetMouseX = 0;
        this.targetMouseY = 0;

        // Debounce timers
        this.scrollTimeout = null;
        this.mutationTimeout = null;
        this.resizeTimeout = null;

        // Bind methods
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleScroll = this.handleScroll.bind(this);
        this.handleMutation = this.handleMutation.bind(this);
        this.handleResize = this.handleResize.bind(this);
        this.render = this.render.bind(this);

        this.setupEventListeners();
    }

    setupEventListeners() {
        // Mouse tracking on window to catch all mouse movement
        window.addEventListener('mousemove', this.handleMouseMove);

        // Window resize handling
        window.addEventListener('resize', this.handleResize);

        // Also track on the webview container specifically
        const container = document.getElementById('webview-container');
        if (container) {
            container.addEventListener('mousemove', this.handleMouseMove);
        }

        // Webview IPC listeners for mouse, scroll, and mutations
        this.webview.addEventListener('ipc-message', (event) => {
            if (event.channel === 'mousemove') {
                this.targetMouseX = event.args[0];
                this.targetMouseY = event.args[1];

                // Debug: log occasionally
                if (!this.mouseMoveCount) this.mouseMoveCount = 0;
                this.mouseMoveCount++;
                if (this.mouseMoveCount % 30 === 0) {
                    console.log('Mouse from webview IPC:', this.targetMouseX.toFixed(0), this.targetMouseY.toFixed(0));
                }
            } else if (event.channel === 'scroll') {
                this.handleScroll();
            } else if (event.channel === 'mutation') {
                this.handleMutation();
            }
        });

        // Webview scroll detection and mouse tracking
        // Note: Mouse tracking is handled by preload.js
        this.webview.addEventListener('did-finish-load', () => {
            // Initial capture
            setTimeout(() => this.captureAndProcess(), 1000);
        });


    }

    handleResize() {
        if (!this.enabled) return;

        // Debounce resize capture
        if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
        this.resizeTimeout = setTimeout(() => {
            this.captureAndProcess();
        }, 200);
    }

    handleMouseMove(event) {
        // Get mouse position relative to the webview container
        const rect = this.canvas.getBoundingClientRect();
        this.targetMouseX = event.clientX - rect.left;
        this.targetMouseY = event.clientY - rect.top;

        // Debug: log occasionally
        if (!this.mouseMoveCount) this.mouseMoveCount = 0;
        this.mouseMoveCount++;
        if (this.mouseMoveCount % 30 === 0) {
            console.log('Mouse move event:', event.clientX, event.clientY, '-> target:',
                this.targetMouseX.toFixed(0), this.targetMouseY.toFixed(0));
        }
    }

    handleScroll() {
        if (!this.enabled) return;

        clearTimeout(this.scrollTimeout);
        this.scrollTimeout = setTimeout(() => {
            this.captureAndProcess();
        }, this.config.scrollDebounce);
    }

    handleMutation() {
        if (!this.enabled) return;

        clearTimeout(this.mutationTimeout);
        this.mutationTimeout = setTimeout(() => {
            this.captureAndProcess();
        }, this.config.mutationDebounce);
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
        console.log('Enabling Scrutinizer mode...');
        this.canvas.style.display = 'block';
        await this.captureAndProcess();
        this.startRenderLoop();
    }

    disable() {
        console.log('Disabling Scrutinizer mode...');
        this.canvas.style.display = 'none';
        this.stopRenderLoop();
    }

    async captureAndProcess() {
        if (this.isCapturing) return;
        this.isCapturing = true;

        try {
            // Resize canvas to match webview
            const rect = this.webview.getBoundingClientRect();
            const width = Math.ceil(rect.width);
            const height = Math.ceil(rect.height);

            // Ensure main canvas matches
            if (this.canvas.width !== width || this.canvas.height !== height) {
                console.log('Resizing main canvas:', this.canvas.width, 'x', this.canvas.height, '->', width, 'x', height);
                this.canvas.width = width;
                this.canvas.height = height;
                // Prevent transparency by filling with white immediately
                this.ctx.fillStyle = 'white';
                this.ctx.fillRect(0, 0, width, height);
            }

            // Ensure offscreen sharp canvas matches
            if (this.sharpCanvas.width !== width || this.sharpCanvas.height !== height) {
                this.sharpCanvas.width = width;
                this.sharpCanvas.height = height;
            }

            // Ensure blurred canvas matches
            if (this.blurredCanvas.width !== width || this.blurredCanvas.height !== height) {
                this.blurredCanvas.width = width;
                this.blurredCanvas.height = height;
            }

            // Capture webview content using Electron's native capturePage
            const image = await this.webview.capturePage();
            const dataUrl = image.toDataURL();

            // Load captured image
            const img = new Image();
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = dataUrl;
            });

            // Draw to offscreen sharp canvas for data extraction and slicing
            this.sharpCtx.clearRect(0, 0, this.sharpCanvas.width, this.sharpCanvas.height);
            // Fill with white first to handle transparency
            this.sharpCtx.fillStyle = 'white';
            this.sharpCtx.fillRect(0, 0, this.sharpCanvas.width, this.sharpCanvas.height);
            this.sharpCtx.drawImage(img, 0, 0, this.sharpCanvas.width, this.sharpCanvas.height);

            // Get image data for processing from offscreen canvas
            let imageData = this.sharpCtx.getImageData(0, 0, this.sharpCanvas.width, this.sharpCanvas.height);

            // Apply desaturation
            imageData = this.processor.desaturate(imageData);

            // Apply blur
            imageData = this.processor.blur(imageData, this.config.blurRadius);

            // Store processed image in offscreen canvas
            this.blurredCtx.putImageData(imageData, 0, 0);
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

        // Smooth mouse movement
        this.mouseX += (this.targetMouseX - this.mouseX) * this.config.maskSmoothness;
        this.mouseY += (this.targetMouseY - this.mouseY) * this.config.maskSmoothness;

        // Debug: log every 60 frames
        if (!this.frameCount) this.frameCount = 0;
        this.frameCount++;
        if (this.frameCount % 60 === 0) {
            console.log('Render frame', this.frameCount, 'Mouse:', this.mouseX.toFixed(0), this.mouseY.toFixed(0));
        }

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
    }

    updateFovealRadius(delta) {
        let newRadius = this.config.fovealRadius + delta;
        newRadius = Math.max(20, Math.min(300, newRadius));
        this.config.fovealRadius = newRadius;
        console.log('Foveal radius:', this.config.fovealRadius);
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
