/**
 * Overlay view - handles toolbar UI + canvas rendering
 */

const { ipcRenderer } = require('electron');

let scrutinizer;
let captureInterval = null;
let fovealEnabled = false;

document.addEventListener('DOMContentLoaded', () => {
    console.log('[Overlay] Initializing (no toolbar - menu only)');

    // Initialize Scrutinizer for canvas rendering
    scrutinizer = new Scrutinizer(CONFIG);

    // Track mouse for foveal center (HUD forwards all events so we get them here too)
    document.addEventListener('mousemove', (e) => {
        if (scrutinizer) {
            scrutinizer.handleMouseMove(e);
        }
    });

    // Also listen for mouse position from content view
    // Also listen for mouse position from content view
    ipcRenderer.on('browser:mousemove', (event, x, y, zoom = 1.0) => {
        // Update foveal center when mouse moves in browser below
        if (scrutinizer) {
            const syntheticEvent = { clientX: x, clientY: y, zoom: zoom };
            scrutinizer.handleMouseMove(syntheticEvent);
        }
    });

    // Listen for zoom changes
    ipcRenderer.on('browser:zoom-changed', (event, zoom) => {
        if (scrutinizer) {
            scrutinizer.handleZoomChanged(zoom);
        }
    });

    // Start/stop capture loop
    let isCapturing = false;
    let isWaitingForFrame = false;

    const requestNextFrame = () => {
        if (!isCapturing) return;
        if (isWaitingForFrame) return; // Backpressure control

        isWaitingForFrame = true;
        ipcRenderer.send('capture:request');
    };

    const startCapturing = () => {
        if (isCapturing) return;
        console.log('[Overlay] Starting capture loop (self-clocking)');
        isCapturing = true;
        isWaitingForFrame = false;
        requestNextFrame();
    };

    const stopCapturing = () => {
        if (!isCapturing) return;
        console.log('[Overlay] Stopping capture loop');
        isCapturing = false;
        isWaitingForFrame = false;
    };

    // Listen for frame data from main process
    ipcRenderer.on('frame-captured', (event, data) => {
        // Mark as ready for next frame
        isWaitingForFrame = false;

        if (scrutinizer && data.width > 0 && data.height > 0) {
            const buffer = new Uint8Array(data.buffer);
            scrutinizer.processFrame(buffer, data.width, data.height);
        }

        // Request next frame if still capturing
        if (isCapturing) {
            // Use requestAnimationFrame to sync with display refresh
            // and prevent tight loops if capture is instant
            requestAnimationFrame(requestNextFrame);
        }
    });

    // Keyboard shortcuts coming from content view (preload forwards as webview:keydown)
    ipcRenderer.on('webview:keydown', (event, keyEvent) => {
        if (!keyEvent || !keyEvent.code) return;

        // ESC is handled in main.js to toggle HUD window visibility
        // Arrow keys to adjust radius (when enabled)
        if (fovealEnabled) {
            if (keyEvent.code === 'ArrowRight') {
                if (scrutinizer) scrutinizer.updateFovealRadius(10);
            } else if (keyEvent.code === 'ArrowLeft') {
                if (scrutinizer) scrutinizer.updateFovealRadius(-10);
            }
        }
    });

    // Toggle foveal effect (called from menu)
    const toggleFoveal = (forceState = null) => {
        if (forceState !== null) {
            fovealEnabled = forceState;
        } else {
            fovealEnabled = !fovealEnabled;
        }

        // Notify main process
        ipcRenderer.send('settings:enabled-changed', fovealEnabled);

        if (fovealEnabled) {
            scrutinizer.enable();
            startCapturing();
        } else {
            scrutinizer.disable();
            stopCapturing();
        }
    };

    // Listen for page load events
    ipcRenderer.on('browser:did-start-loading', () => {
        console.log('[Overlay] Page loading started');
    });

    ipcRenderer.on('browser:did-finish-load', () => {
        console.log('[Overlay] Page loading finished');
    });

    ipcRenderer.on('browser:did-navigate', (event, url) => {
        console.log('[Overlay] Browser navigated to:', url);
    });

    // Listen for init state from main process
    ipcRenderer.on('settings:init-state', (event, state) => {
        console.log('[Overlay] Received init-state:', state);
        if (state.enabled) toggleFoveal(true);
        if (state.radius) {
            scrutinizer.updateFovealRadius(state.radius);
        }
        if (state.visualMemory !== undefined) {
            console.log('[Overlay] Initializing visual memory:', state.visualMemory);
            if (scrutinizer) scrutinizer.setVisualMemoryLimit(state.visualMemory);
        }
    });

    // Menu IPC handlers
    ipcRenderer.on('menu:toggle-foveal', () => {
        toggleFoveal();
    });

    ipcRenderer.on('menu:set-intensity', (event, intensity) => {
        if (scrutinizer) scrutinizer.updateIntensity(intensity);
    });

    ipcRenderer.on('menu:toggle-ca', (event, enabled) => {
        if (scrutinizer) scrutinizer.toggleCA(enabled);
    });

    ipcRenderer.on('menu:toggle-debug-boundary', (event, enabled) => {
        if (scrutinizer) scrutinizer.toggleDebugBoundary(enabled);
    });

    ipcRenderer.on('menu:toggle-debug-boundary', (event, enabled) => {
        if (scrutinizer) scrutinizer.toggleDebugBoundary(enabled);
    });

    ipcRenderer.on('menu:set-visual-memory', (event, limit) => {
        console.log('[Overlay] Setting visual memory limit:', limit);
        if (scrutinizer) scrutinizer.setVisualMemoryLimit(limit);

        // Notify main process to persist setting
        ipcRenderer.send('settings:visual-memory-changed', limit);
    });

    ipcRenderer.on('hud:reset-visual-memory', () => {
        console.log('[Overlay] Resetting visual memory due to navigation');
        if (scrutinizer) scrutinizer.resetVisualMemory();
    });

    console.log('[Overlay] Ready (menu-only mode)');
});
