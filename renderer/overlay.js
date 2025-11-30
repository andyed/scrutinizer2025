/**
 * Overlay view - handles toolbar UI + canvas rendering
 */

(() => {
    const { ipcRenderer } = require('electron');
    const CONFIG = require('./config');

    let scrutinizer;
    let captureInterval = null;
    let fovealEnabled = false;

    // Helper to forward logs to main process terminal
    const log = (msg) => {
        console.log(msg);
        ipcRenderer.send('log:renderer', msg);
    };

    document.addEventListener('DOMContentLoaded', () => {
        log('[Overlay] Initializing (no toolbar - menu only)');

        // Initialize Scrutinizer for canvas rendering
        // Scrutinizer should be available on window now
        if (typeof Scrutinizer === 'undefined') {
            log('[Overlay] Error: Scrutinizer class not found!');
            return;
        }

        scrutinizer = new Scrutinizer(CONFIG);

        // Track mouse for foveal center (HUD forwards all events so we get them here too)
        document.addEventListener('mousemove', (e) => {
            if (scrutinizer) {
                scrutinizer.handleMouseMove(e);
            }
        });

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
            // log('[Overlay] Sending hud:capture:request');
            ipcRenderer.send('hud:capture:request');
        };

        const startCapturing = () => {
            if (isCapturing) return;
            log('[Overlay] Starting capture loop (self-clocking)');
            isCapturing = true;
            isWaitingForFrame = false;
            requestNextFrame();
        };

        const stopCapturing = () => {
            if (!isCapturing) return;
            log('[Overlay] Stopping capture loop');
            isCapturing = false;
            isWaitingForFrame = false;
        };

        // Listen for frame data from main process
        ipcRenderer.on('hud:frame-captured', (event, data) => {
            // Mark as ready for next frame
            isWaitingForFrame = false;

            if (Math.random() < 0.05) {
                log(`[Overlay] Received frame: ${data.width}x${data.height}`);
            }

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
                    if (scrutinizer) {
                        scrutinizer.updateFovealRadius(10, true);
                        ipcRenderer.send('settings:radius-changed', scrutinizer.config.fovealRadius);
                    }
                } else if (keyEvent.code === 'ArrowLeft') {
                    if (scrutinizer) {
                        scrutinizer.updateFovealRadius(-10, true);
                        ipcRenderer.send('settings:radius-changed', scrutinizer.config.fovealRadius);
                    }
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
            log('[Overlay] Page loading started');
        });

        ipcRenderer.on('browser:did-finish-load', () => {
            log('[Overlay] Page loading finished');
        });

        ipcRenderer.on('browser:did-navigate', (event, url) => {
            log(`[Overlay] Browser navigated to: ${url}`);
        });

        // Listen for init state from main process
        ipcRenderer.on('settings:init-state', (event, state) => {
            log(`[Overlay] Received init-state: ${JSON.stringify(state)}`);
            if (state.enabled) toggleFoveal(true);
            if (state.radius) {
                scrutinizer.updateFovealRadius(state.radius, false);
            }
            if (state.visualMemory !== undefined) {
                log(`[Overlay] Initializing visual memory: ${state.visualMemory}`);
                if (scrutinizer) scrutinizer.setVisualMemoryLimit(state.visualMemory);
            }
            if (state.intensity !== undefined) {
                if (scrutinizer) scrutinizer.updateIntensity(state.intensity);
            }
        });

        // Menu IPC handlers
        ipcRenderer.on('menu:toggle-foveal', () => {
            toggleFoveal();
        });

        ipcRenderer.on('menu:set-radius', (event, radius) => {
            if (scrutinizer) scrutinizer.updateFovealRadius(radius, false);
        });

        ipcRenderer.on('menu:set-intensity', (event, intensity) => {
            if (scrutinizer) {
                scrutinizer.updateIntensity(intensity);
                ipcRenderer.send('settings:intensity-changed', intensity);
            }
        });

        ipcRenderer.on('menu:toggle-ca', (event, enabled) => {
            if (scrutinizer) scrutinizer.toggleCA(enabled);
        });

        ipcRenderer.on('menu:toggle-debug-boundary', (e, enabled) => {
            scrutinizer.toggleDebugBoundary(enabled);
        });

        ipcRenderer.on('menu:toggle-structure-map', (e, enabled) => {
            scrutinizer.toggleStructureMap(enabled);
        });

        ipcRenderer.on('menu:toggle-enable-structure-map', (e, enabled) => {
            scrutinizer.toggleEnableStructureMap(enabled);
        });

        ipcRenderer.on('menu:toggle-saliency-map', (e, enabled) => {
            scrutinizer.toggleSaliencyMap(enabled);
        });

        ipcRenderer.on('menu:set-visual-memory', (event, limit) => {
            log(`[Overlay] Setting visual memory limit: ${limit}`);
            if (scrutinizer) scrutinizer.setVisualMemoryLimit(limit);

            // Notify main process to persist setting
            ipcRenderer.send('settings:visual-memory-changed', limit);
        });

        ipcRenderer.on('menu:set-mongrel-mode', (event, mode) => {
            log(`[Overlay] IPC received menu:set-mongrel-mode: ${mode}`);
            if (scrutinizer) scrutinizer.setMongrelMode(mode);
        });

        ipcRenderer.on('menu:set-aesthetic-mode', (event, mode) => {
            if (scrutinizer) scrutinizer.setAestheticMode(mode);
        });

        ipcRenderer.on('hud:reset-visual-memory', () => {
            if (scrutinizer && scrutinizer.config.visualMemory > 0) {
                log('[Overlay] Resetting visual memory due to navigation');
                scrutinizer.resetVisualMemory();
            }
        });

        log('[Overlay] Ready (menu-only mode)');
    });
})();
