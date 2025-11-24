/**
 * Application entry point
 * Initializes Scrutinizer and sets up UI event handlers
 */

let scrutinizer;

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing Scrutinizer...');

    // IPC from main process
    const { ipcRenderer } = require('electron');
    let radiusOptions = null;

    // Get elements (no webview element anymore)
    const toggleBtn = document.getElementById('toggle-btn');
    const urlInput = document.getElementById('url-input');
    const navigateBtn = document.getElementById('go-btn');
    const backBtn = document.getElementById('back-btn');
    const forwardBtn = document.getElementById('forward-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const statusText = document.getElementById('status-text');

    // Welcome Popup elements
    const welcomePopup = document.getElementById('welcome-popup');
    const closePopupBtn = document.getElementById('close-popup');
    const dontShowCheckbox = document.getElementById('dont-show-again');

    const closePopup = () => {
        welcomePopup.style.display = 'none';
        // If "Don't show again" is checked, update settings
        if (dontShowCheckbox.checked) {
            ipcRenderer.send('settings:welcome-changed', false);
        }
    };

    closePopupBtn.addEventListener('click', closePopup);

    let pendingInitState = null;

    // Toggle foveal mode function (defined early so it can be used in event handlers)
    const toggleFoveal = async (forceState = null) => {
        if (!scrutinizer) {
            console.warn('[Renderer] Cannot toggle - scrutinizer not initialized');
            return;
        }

        let enabled;
        if (forceState !== null) {
            if (forceState) {
                await scrutinizer.enable();
                enabled = true;
            } else {
                await scrutinizer.disable();
                enabled = false;
            }
        } else {
            enabled = await scrutinizer.toggle();
        }

        toggleBtn.classList.toggle('active', enabled);
        statusText.textContent = enabled ? 'Foveal mode active' : 'Foveal mode disabled';

        // Notify main process of state change so new windows inherit it
        ipcRenderer.send('settings:enabled-changed', enabled);

        // Tell main process to start/stop capturing frames
        ipcRenderer.send(enabled ? 'foveal:enabled' : 'foveal:disabled');
    };

    // Add missing click handler for toggle button
    toggleBtn.addEventListener('click', () => {
        toggleFoveal();
    });

    // Initialize Scrutinizer immediately (no webview element to wait for)
    console.log('[Renderer] Initializing new Scrutinizer instance');
    scrutinizer = new Scrutinizer(CONFIG);
    statusText.textContent = 'Ready - Press ESC or click Enable to start';

    // Wire up frame-captured IPC from main process (paint events)
    ipcRenderer.on('frame-captured', (event, data) => {
        // console.log('[Renderer] Frame captured:', data.width, 'x', data.height); // Uncomment for verbose logging
        if (scrutinizer) {
            // Convert Node Buffer to Uint8Array
            const buffer = new Uint8Array(data.buffer);
            scrutinizer.processFrame(buffer, data.width, data.height);
        }
    });

    // Update URL bar when navigation occurs
    ipcRenderer.on('browser:did-navigate', (event, url) => {
        // Don't update if the input is focused to avoid interrupting typing
        if (document.activeElement !== urlInput) {
            urlInput.value = url;
        }
        // Also remove loading class as a fallback
        toggleBtn.classList.remove('loading');
    });

    // Handle page loading start (prevent FOUC)
    ipcRenderer.on('browser:did-start-loading', () => {
        console.log('[App] Page loading started - adding loading class');
        // Add loading animation to toggle button
        toggleBtn.classList.add('loading');

        if (scrutinizer) {
            scrutinizer.resetState();
        }

        // Safety timeout: remove loading class after 5s if did-finish-load doesn't fire
        setTimeout(() => {
            if (toggleBtn.classList.contains('loading')) {
                console.log('[App] Safety timeout - removing stuck loading class');
                toggleBtn.classList.remove('loading');
            }
        }, 5000);
    });

    // Handle page loading finish
    ipcRenderer.on('browser:did-finish-load', () => {
        console.log('[App] Page loading finished - removing loading class');
        // Remove loading animation
        toggleBtn.classList.remove('loading');
    });

    // Navigation controls - send to main process which controls the WebContentsView
    backBtn.addEventListener('click', () => {
        ipcRenderer.send('navigate:back');
    });

    forwardBtn.addEventListener('click', () => {
        ipcRenderer.send('navigate:forward');
    });

    refreshBtn.addEventListener('click', () => {
        ipcRenderer.send('navigate:reload');
    });

    navigateBtn.addEventListener('click', () => {
        const url = urlInput.value.trim();
        if (url) {
            // Add protocol if missing
            const fullUrl = url.startsWith('http') ? url : 'https://' + url;
            ipcRenderer.send('navigate:to', fullUrl);
            // Save as start page
            ipcRenderer.send('settings:page-changed', fullUrl);
        }
    });

    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            navigateBtn.click();
        }
    });

    // Keyboard shortcut handler (works for both document and webview events)
    const handleKeyboardShortcut = (e) => {
        // Escape to toggle foveal view on/off
        if (e.code === 'Escape') {
            if (welcomePopup.style.display !== 'none') {
                closePopup();
            } else {
                // Always try to toggle, toggleFoveal has its own guard
                if (e.preventDefault) e.preventDefault();
                toggleFoveal();
            }
            return;
        }

        // Left/Right arrows (<>) to adjust fovea size (only when foveal mode is active)
        if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
            // Skip if typing in input field
            if (e.target && e.target.tagName === 'INPUT') return;

            if (scrutinizer && scrutinizer.enabled) {
                if (e.preventDefault) e.preventDefault();

                const radiusSteps = (radiusOptions && radiusOptions.length) ? radiusOptions : [100, 180, 250];
                const currentRadius = scrutinizer.config.fovealRadius;

                let currentIndex = radiusSteps.findIndex(r => r === currentRadius);
                if (currentIndex === -1) {
                    let nearestIndex = 0;
                    let nearestDiff = Math.abs(currentRadius - radiusSteps[0]);
                    for (let i = 1; i < radiusSteps.length; i++) {
                        const diff = Math.abs(currentRadius - radiusSteps[i]);
                        if (diff < nearestDiff) {
                            nearestDiff = diff;
                            nearestIndex = i;
                        }
                    }
                    currentIndex = nearestIndex;
                }

                // Right arrow (>) increases, Left arrow (<) decreases
                const direction = e.code === 'ArrowRight' ? 1 : -1;
                let nextIndex = currentIndex;
                if (direction > 0 && currentIndex < radiusSteps.length - 1) {
                    nextIndex = currentIndex + 1;
                } else if (direction < 0 && currentIndex > 0) {
                    nextIndex = currentIndex - 1;
                }

                const newRadius = radiusSteps[nextIndex];
                scrutinizer.updateFovealRadius(newRadius);
                ipcRenderer.send('settings:radius-changed', newRadius);
            }
        }
    };

    // Keyboard shortcuts from document (when focus is on toolbar/UI)
    document.addEventListener('keydown', handleKeyboardShortcut);

    // Listen for keyboard events forwarded from WebContentsView via main process
    ipcRenderer.on('webview:keydown', (event, keyEvent) => {
        handleKeyboardShortcut(keyEvent);
    });

    // Forward input events to the hidden content window
    const container = document.getElementById('webview-container');

    // Helper to send mouse events
    const forwardMouseEvent = (e, type) => {
        const rect = container.getBoundingClientRect();
        const x = Math.round(e.clientX - rect.left);
        const y = Math.round(e.clientY - rect.top);

        ipcRenderer.send('input:mouse', {
            type: type,
            x: x,
            y: y,
            button: e.button === 0 ? 'left' : (e.button === 1 ? 'middle' : 'right'),
            clickCount: 1
        });
    };

    if (container) {
        container.addEventListener('mousedown', (e) => forwardMouseEvent(e, 'mouseDown'));
        container.addEventListener('mouseup', (e) => forwardMouseEvent(e, 'mouseUp'));
        container.addEventListener('mousemove', (e) => forwardMouseEvent(e, 'mouseMove'));

        // Forward scroll events
        container.addEventListener('wheel', (e) => {
            ipcRenderer.send('input:wheel', {
                deltaX: e.deltaX,
                deltaY: e.deltaY,
                x: e.clientX,
                y: e.clientY
            });
        }, { passive: true });
    }

    // Forward keyboard events
    document.addEventListener('keydown', (e) => {
        // Don't forward if typing in URL bar
        if (e.target === urlInput) return;

        // List of keys that should be forwarded for scrolling/navigation
        const navigationKeys = [
            'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
            'PageUp', 'PageDown', 'Home', 'End', ' '
        ];

        // Prevent default for navigation keys so they don't affect the toolbar
        if (navigationKeys.includes(e.key)) {
            e.preventDefault();
        }

        ipcRenderer.send('input:keyboard', {
            type: 'keyDown',
            keyCode: e.key,
            modifiers: [] // TODO: Add modifier support if needed
        });
    });

    document.addEventListener('keyup', (e) => {
        if (e.target === urlInput) return;

        const navigationKeys = [
            'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
            'PageUp', 'PageDown', 'Home', 'End', ' '
        ];

        if (navigationKeys.includes(e.key)) {
            e.preventDefault();
        }

        ipcRenderer.send('input:keyboard', {
            type: 'keyUp',
            keyCode: e.key,
            modifiers: []
        });
    });

    // IPC listeners for main process (menus, settings)
    ipcRenderer.on('settings:radius-options', (event, options) => {
        radiusOptions = Array.isArray(options) && options.length ? options.slice().sort((a, b) => a - b) : null;
    });

    ipcRenderer.on('settings:init-state', (event, state) => {
        console.log('[Renderer] Received init-state:', state);
        // Apply immediately since scrutinizer is already initialized
        if (state.radius) scrutinizer.updateFovealRadius(state.radius);
        if (state.blur) scrutinizer.updateBlurRadius(state.blur);
        if (state.enabled) toggleFoveal(true);
        if (state.showWelcome !== false) welcomePopup.style.display = 'flex';
    });

    // Menu IPC handlers
    ipcRenderer.on('menu:toggle-foveal', () => {
        if (scrutinizer) toggleFoveal();
    });

    ipcRenderer.on('menu:set-radius', (event, radius) => {
        if (scrutinizer) {
            scrutinizer.updateFovealRadius(radius);
            ipcRenderer.send('settings:radius-changed', radius);
        }
    });


    console.log('Scrutinizer initialized');
});
