/**
 * Application entry point
 * Initializes Scrutinizer and sets up UI event handlers
 */

let scrutinizer;
let webview;

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing Scrutinizer...');

    // IPC from main process
    const { ipcRenderer } = require('electron');
    let radiusOptions = null;

    // Get elements
    webview = document.getElementById('webview');
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
    };

    // Initialize Scrutinizer once webview is ready
    webview.addEventListener('dom-ready', () => {
        console.log('Webview ready (dom-ready fired)');
        
        if (!scrutinizer) {
            console.log('[Renderer] Initializing new Scrutinizer instance');
            scrutinizer = new Scrutinizer(webview, CONFIG);
            statusText.textContent = 'Ready - Press ESC or click Enable to start';

            // Apply pending state if any
            if (pendingInitState) {
                console.log('[Renderer] Applying pending init state:', pendingInitState);
                if (pendingInitState.radius) scrutinizer.updateFovealRadius(pendingInitState.radius);
                if (pendingInitState.blur) scrutinizer.updateBlurRadius(pendingInitState.blur);
                if (pendingInitState.enabled) {
                    console.log('[Renderer] Enabling foveal mode from pending state');
                    toggleFoveal(true);
                }
                if (pendingInitState.showWelcome !== false) welcomePopup.style.display = 'flex';
                pendingInitState = null;
            }
        } else {
            console.log('[Renderer] Scrutinizer already initialized, skipping re-init');
        }
    });

    // Navigation controls
    backBtn.addEventListener('click', () => {
        if (webview.canGoBack()) webview.goBack();
    });

    forwardBtn.addEventListener('click', () => {
        if (webview.canGoForward()) webview.goForward();
    });

    refreshBtn.addEventListener('click', () => {
        webview.reload();
    });

    // Toggle button click handler
    toggleBtn.addEventListener('click', () => toggleFoveal());

    // URL navigation
    const navigate = () => {
        if (navigateBtn.textContent === 'Stop') {
            webview.stop();
            return;
        }

        let url = urlInput.value.trim();
        if (!url) return;

        // Add protocol if missing
        if (!url.match(/^https?:\/\//)) {
            url = 'https://' + url;
        }

        webview.src = url;
    };

    navigateBtn.addEventListener('click', navigate);
    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') navigate();
    });

    // Update status and button when page loads
    webview.addEventListener('did-start-loading', () => {
        statusText.textContent = 'Loading...';
        statusText.classList.add('loading');
        navigateBtn.textContent = 'Stop';
    });

    // Intercept new windows (popups) from webview content
    webview.addEventListener('new-window', (e) => {
        e.preventDefault(); // Stop default Electron window
        if (e.url) {
            ipcRenderer.send('window:create', e.url);
        }
    });

    // Listen for keyboard events from webview (forwarded by preload.js)
    webview.addEventListener('ipc-message', (e) => {
        if (e.channel === 'keydown') {
            const keyEvent = e.args[0];
            handleKeyboardShortcut(keyEvent);
        }
    });

    webview.addEventListener('did-stop-loading', () => {
        statusText.textContent = 'Page loaded';
        statusText.classList.remove('loading');
        const url = webview.getURL();
        urlInput.value = url;
        navigateBtn.textContent = 'Go';
        
        // Save current page as start page for next launch
        if (url && url.startsWith('http')) {
            ipcRenderer.send('settings:page-changed', url);
        }
    });

    webview.addEventListener('did-fail-load', (event) => {
        if (event.errorCode !== -3) { // Ignore aborted loads
            statusText.textContent = 'Failed to load page';
            statusText.classList.remove('loading');
        }
        navigateBtn.textContent = 'Go';
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

    // IPC listeners for main process (menus, popups)
    ipcRenderer.on('settings:radius-options', (event, options) => {
        radiusOptions = Array.isArray(options) && options.length ? options.slice().sort((a, b) => a - b) : null;
    });

    // Initialize state from main process (new windows inherit settings)
    ipcRenderer.on('settings:init-state', (event, state) => {
        console.log('[Renderer] Received settings:init-state', state);
        if (scrutinizer) {
            console.log('[Renderer] Scrutinizer ready, applying settings immediately');
            if (state.radius) scrutinizer.updateFovealRadius(state.radius);
            if (state.blur) scrutinizer.updateBlurRadius(state.blur);
            
            // Apply enabled state
            if (state.enabled) {
                console.log('[Renderer] Enabling foveal mode');
                toggleFoveal(true);
            }

            // Show welcome popup if enabled
            if (state.showWelcome !== false) {
                welcomePopup.style.display = 'flex';
            }
        } else {
            console.log('[Renderer] Scrutinizer NOT ready, queuing settings');
            // Store for initialization
            pendingInitState = state;
        }
    });

    // Toggle foveal mode
    ipcRenderer.on('menu:toggle-foveal', () => {
        toggleFoveal();
    });

    // Listen for menu commands
    ipcRenderer.on('menu:set-radius', (event, value) => {
        scrutinizer.updateFovealRadius(value);
        // Notify main process to update menu checkmarks
        ipcRenderer.send('settings:radius-changed', value);
    });

    // Set blur radius from menu
    ipcRenderer.on('menu:set-blur', (event, value) => {
        scrutinizer.updateBlurRadius(value);
        // Notify main process to update menu checkmarks
        ipcRenderer.send('settings:blur-changed', value);
    });

    // Navigate popup windows: main process sends 'popup:navigate' with URL
    ipcRenderer.on('popup:navigate', (event, url) => {
        if (webview) {
            webview.loadURL(url);
        }
        if (urlInput) {
            urlInput.value = url;
        }
    });


    console.log('Scrutinizer initialized');
});
