/**
 * Scrutinizer - Foveal Vision Simulator
 * Core logic for capturing, processing, and rendering the peripheral vision effect
 */

class Scrutinizer {
    constructor(config) {
        this.config = config;

        // Canvas setup
        this.canvas = document.getElementById('overlay-canvas');

        // Initialize WebGL Renderer
        try {
            this.renderer = new WebGLRenderer(this.canvas);
        } catch (e) {
            console.error('Failed to initialize WebGL:', e);
            alert('WebGL is required for this version of Scrutinizer.');
        }

        // State
        this.enabled = false;
        this.lastFrameBitmap = null;

        // Mouse tracking
        this.mouseX = 0;
        this.mouseY = 0;
        this.targetMouseX = 0;
        this.targetMouseY = 0;

        // Bind methods
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleResize = this.handleResize.bind(this);
        this.render = this.render.bind(this);

        this.setupEventListeners();
    }

    setupEventListeners() {
        window.addEventListener('mousemove', this.handleMouseMove);
        window.addEventListener('resize', this.handleResize);

        // Initial resize
        this.handleResize();
        const container = document.getElementById('webview-container');
        if (container) {
            container.addEventListener('mousemove', this.handleMouseMove);
        }
    }

    handleResize() {
        // Request actual window size from main process
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('get-window-size');

        // Listen for response (only once per resize)
        ipcRenderer.once('window-size', (event, { width, height }) => {
            const dpr = window.devicePixelRatio || 1;

            // Set CSS size to match window
            this.canvas.style.width = width + 'px';
            this.canvas.style.height = height + 'px';

            // Set canvas buffer size with DPR
            const bufferWidth = width * dpr;
            const bufferHeight = height * dpr;

            if (this.canvas.width !== bufferWidth || this.canvas.height !== bufferHeight) {
                this.canvas.width = bufferWidth;
                this.canvas.height = bufferHeight;
                console.log('[Scrutinizer] Canvas resized to:', bufferWidth, 'x', bufferHeight, 'CSS:', width, 'x', height);
            }
        });
    }

    handleMouseMove(event) {
        const rect = this.canvas.getBoundingClientRect();
        // WebGL viewport handles scaling, but we need mouse in canvas pixel coords
        // If canvas.width != rect.width (HiDPI), we need to scale
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;

        this.targetMouseX = (event.clientX - rect.left) * scaleX;
        this.targetMouseY = (event.clientY - rect.top) * scaleY;
    }

    async toggle() {
        this.enabled = !this.enabled;
        if (this.enabled) await this.enable();
        else this.disable();
        return this.enabled;
    }

    async enable() {
        console.log('[Scrutinizer] ENABLE called');
        this.enabled = true;
        this.canvas.style.display = 'block';
        console.log('[Scrutinizer] Canvas display set to block');

        // Initialize mouse to center
        const rect = this.canvas.getBoundingClientRect();
        this.mouseX = (rect.width / 2) * (this.canvas.width / rect.width);
        this.mouseY = (rect.height / 2) * (this.canvas.height / rect.height);
        this.targetMouseX = this.mouseX;
        this.targetMouseY = this.mouseY;

        this.startRenderLoop();
        console.log('[Scrutinizer] Render loop started');
    }

    disable() {
        console.log('[Scrutinizer] DISABLE called');
        this.enabled = false;
        // Hide canvas - content view is visible underneath
        this.canvas.style.display = 'none';
        this.stopRenderLoop();
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
    }

    async processFrame(buffer, width, height) {
        // Create ImageBitmap from buffer (Blob/ImageData)
        // Electron sends a Buffer. We can create an ImageData or Blob.
        // Faster: new ImageData(new Uint8ClampedArray(buffer), width, height)
        // Then createImageBitmap(imageData) -> GPU

        const imageData = new ImageData(new Uint8ClampedArray(buffer), width, height);

        // Direct upload of ImageData is more robust than createImageBitmap
        // and avoids "SharedImageManager" errors in some Electron environments.
        if (this.renderer) {
            this.renderer.uploadTexture(imageData);

            // Log occasionally
            if (!this.frameUploadCount) this.frameUploadCount = 0;
            this.frameUploadCount++;
            if (this.frameUploadCount % 30 === 0) {
                console.log('[Scrutinizer] Uploaded frame', this.frameUploadCount, 'to WebGL');
            }
        } else {
            console.warn('[Scrutinizer] No renderer available for frame upload!');
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

        // Smooth mouse
        this.mouseX += (this.targetMouseX - this.mouseX) * this.config.maskSmoothness;
        this.mouseY += (this.targetMouseY - this.mouseY) * this.config.maskSmoothness;

        // Determine effective radius
        // If disabled, use a huge radius to show the clear image everywhere
        // Canvas height is usually ~1000px, so 5000px is safe
        const effectiveRadius = this.enabled ? this.config.fovealRadius : 5000.0;

        // DEBUG: Log state occasionally
        if (Math.random() < 0.005) {
            console.log(`[Scrutinizer] Render: Enabled=${this.enabled}, Radius=${effectiveRadius}`);
        }

        this.renderer.render(
            this.canvas.width,
            this.canvas.height,
            this.mouseX,
            this.mouseY,
            effectiveRadius,
            this.config.intensity !== undefined ? this.config.intensity : 0.6 // Default to 0.6
        );
    }

    updateFovealRadius(radius) {
        let newRadius;
        if (typeof radius === 'number' && Math.abs(radius) <= 50 && radius !== 20) {
            newRadius = this.config.fovealRadius + radius;
        } else {
            newRadius = radius;
        }
        newRadius = Math.max(20, Math.min(300, newRadius));
        this.config.fovealRadius = newRadius;
    }

    updateIntensity(intensity) {
        this.config.intensity = intensity;
        console.log('[Scrutinizer] Intensity set to:', intensity);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Scrutinizer;
}
