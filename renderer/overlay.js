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
        window._scrutinizer = scrutinizer; // Expose for test harness queries

        // REMOVED local mouse listener to prevent conflict with IPC stream
        // document.addEventListener('mousemove', (e) => {
        //     if (scrutinizer) {
        //         scrutinizer.handleMouseMove(e);
        //     }
        // });

        // Also listen for mouse position from content view
        ipcRenderer.on('browser:mousemove', (event, screenX, screenY, zoom = 1.0) => {
            // Update foveal center when mouse moves in browser below
            if (scrutinizer) {
                // Convert Screen Coordinates -> Local HUD Coordinates
                // This bypasses any zoom/DPI scaling confusion in the source webview
                const localX = screenX - window.screenX;
                const localY = screenY - window.screenY; // HUD is frameless, so this is content area

                if (Math.random() < 0.001) { // 0.1% sample rate (reduced from 5%)
                    log(`[Overlay] Mouse Sync: Screen(${screenX}, ${screenY}) - Win(${window.screenX}, ${window.screenY}) = Local(${localX}, ${localY}). HUD: ${window.innerWidth}x${window.innerHeight}, DPR=${window.devicePixelRatio}`);
                }

                const syntheticEvent = { clientX: localX, clientY: localY, zoom: zoom };
                scrutinizer.handleMouseMove(syntheticEvent);

                // Check if cursor is over the ComplexityHUD for interactivity toggle
                if (scrutinizer.complexityHud) {
                    scrutinizer.complexityHud.handleMousePosition(localX, localY);
                }
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
            if (state.enableSaliencyModulation !== undefined) {
                if (scrutinizer) scrutinizer.toggleSaliencyModulation(state.enableSaliencyModulation);
            }
            if (state.comfortMode) {
                if (scrutinizer) scrutinizer.toggleComfortMode(true);
            }
        });

        // Menu IPC handlers
        ipcRenderer.on('menu:toggle-foveal', () => {
            toggleFoveal();
        });

        ipcRenderer.on('menu:set-radius', (event, radius) => {
            if (scrutinizer) scrutinizer.updateFovealRadius(radius, false);
        });

        // Listen for global enable/disable from toolbar or other windows
        ipcRenderer.on('settings:enabled-changed', (event, enabled) => {
            if (fovealEnabled !== enabled) {
                toggleFoveal(enabled);
            }
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

        ipcRenderer.on('menu:set-debug-boundary', (e, mode) => {
            scrutinizer.setDebugBoundaryMode(mode);
        });

        ipcRenderer.on('menu:toggle-structure-map', (e, enabled) => {
            log(`[Overlay] IPC received: menu:toggle-structure-map -> ${enabled}`);
            scrutinizer.toggleStructureMap(enabled);
        });

        ipcRenderer.on('menu:toggle-saliency-map', (e, enabled) => {
            scrutinizer.toggleSaliencyMap(enabled);
        });

        ipcRenderer.on('menu:toggle-saliency-modulation', (e, enabled) => {
            scrutinizer.toggleSaliencyModulation(enabled);
        });

        ipcRenderer.on('menu:set-debug-level', (e, level) => {
            scrutinizer.setDebugLevel(level);
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

        ipcRenderer.on('menu:toggle-congestion-pooling', (event, enabled) => {
            log(`[Overlay] IPC received menu:toggle-congestion-pooling: ${enabled}`);
            if (scrutinizer) scrutinizer.toggleCongestionPooling(enabled);
        });

        ipcRenderer.on('menu:toggle-chromatic-pooling', (e, enabled) => {
            scrutinizer.toggleChromaticPooling(enabled);
        });

        ipcRenderer.on('menu:toggle-saccadic-blindness', (e, enabled) => {
            scrutinizer.toggleSaccadicBlindness(enabled);
        });

        ipcRenderer.on('menu:toggle-fovea-protect', (e, enabled) => {
            scrutinizer.toggleFoveaProtect(enabled);
        });

        ipcRenderer.on('menu:toggle-reading-span', (e, enabled) => {
            scrutinizer.toggleReadingSpan(enabled);
        });

        ipcRenderer.on('menu:toggle-comfort-mode', (e, enabled) => {
            scrutinizer.toggleComfortMode(enabled);
        });

        ipcRenderer.on('menu:toggle-gaussian-blur-mode', (e, enabled) => {
            scrutinizer.toggleGaussianBlurMode(enabled);
        });

        ipcRenderer.on('menu:set-dog-e2', (e, value) => {
            scrutinizer.setDogE2(value);
        });

        ipcRenderer.on('menu:toggle-dog-oriented', (e, enabled) => {
            scrutinizer.setDogOriented(enabled);
        });

        ipcRenderer.on('menu:set-dog-orient-bias', (e, value) => {
            scrutinizer.setDogOrientBias(value);
        });

        ipcRenderer.on('menu:set-aesthetic-mode', (event, mode) => {
            if (scrutinizer) scrutinizer.setAestheticMode(mode);
        });

        ipcRenderer.on('menu:set-show-congestion', (event, mode) => {
            log(`[Overlay] IPC received menu:set-show-congestion: ${mode}`);
            if (scrutinizer) scrutinizer.setShowCongestion(mode);
        });

        ipcRenderer.on('menu:set-saliency-resolution', (event, maxDim) => {
            log(`[Overlay] IPC received menu:set-saliency-resolution: ${maxDim}`);
            if (scrutinizer) scrutinizer.setSaliencyResolution(maxDim);
        });

        ipcRenderer.on('menu:set-congestion-resolution', (event, maxDim) => {
            log(`[Overlay] IPC received menu:set-congestion-resolution: ${maxDim}`);
            if (scrutinizer) scrutinizer.setCongestionResolution(maxDim);
        });

        // Toggle congestion report (from menu keyboard shortcut)
        ipcRenderer.on('menu:toggle-congestion-report', () => {
            if (scrutinizer) {
                const current = scrutinizer._congestionReportMode || 0;
                const next = current > 0 ? 0 : 1;
                scrutinizer.setShowCongestion(next);
            }
        });

        ipcRenderer.on('hud:reset-visual-memory', () => {
            if (scrutinizer && scrutinizer.visualMemoryLimit !== 0) {
                log('[Overlay] Resetting visual memory due to navigation');
                scrutinizer.resetVisualMemory();
            }
        });

        // ── Scanpath Replay IPC ────────────────────────────────────
        ipcRenderer.on('scanpath:load', (event, data) => {
            log(`[Overlay] Loading scanpath: ${data.scanpathData.fixations.length} fixations`);
            if (scrutinizer) scrutinizer.loadScanpath(data.scanpathData);
        });

        ipcRenderer.on('scanpath:play', (event, data) => {
            if (data && data.speed && scrutinizer) scrutinizer.scanpathSetSpeed(data.speed);
            if (scrutinizer) scrutinizer.scanpathPlay();
        });

        ipcRenderer.on('scanpath:pause', () => {
            if (scrutinizer) scrutinizer.scanpathPause();
        });

        ipcRenderer.on('scanpath:seek', (event, data) => {
            if (scrutinizer && data && data.timeMs !== undefined) scrutinizer.scanpathSeek(data.timeMs);
        });

        ipcRenderer.on('scanpath:step', (event, data) => {
            if (scrutinizer && data && data.n !== undefined) scrutinizer.scanpathStep(data.n);
        });

        ipcRenderer.on('scanpath:reset', () => {
            if (scrutinizer) scrutinizer.scanpathReset();
        });

        log('[Overlay] Ready (menu-only mode)');
    });
})();
