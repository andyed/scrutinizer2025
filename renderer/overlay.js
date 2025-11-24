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
    ipcRenderer.on('browser:mousemove', (event, x, y) => {
        // Update foveal center when mouse moves in browser below
        if (scrutinizer) {
            const syntheticEvent = { clientX: x, clientY: y };
            scrutinizer.handleMouseMove(syntheticEvent);
        }
    });

    // Listen for frame data from main process
    ipcRenderer.on('frame-captured', (event, data) => {
        if (scrutinizer && data.width > 0 && data.height > 0) {
            const buffer = new Uint8Array(data.buffer);
            scrutinizer.processFrame(buffer, data.width, data.height);
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

    // Start/stop capture loop
    const startCapturing = () => {
        if (captureInterval) return;
        console.log('[Overlay] Starting capture loop');
        captureInterval = setInterval(() => {
            ipcRenderer.send('capture:request');
        }, 33); // 30fps
    };

    const stopCapturing = () => {
        if (captureInterval) {
            console.log('[Overlay] Stopping capture loop');
            clearInterval(captureInterval);
            captureInterval = null;
        }
    };

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

    console.log('[Overlay] Ready (menu-only mode)');
});
