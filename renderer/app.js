/**
 * Toolbar UI handler
 * Manages navigation controls and forwards commands to overlay view
 */

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing toolbar UI...');

    // IPC from main process
    const { ipcRenderer } = require('electron');

    // Get elements (no webview element anymore)
    const toggleBtn = document.getElementById('toggle-btn');
    const urlInput = document.getElementById('url-input');
    const navigateBtn = document.getElementById('go-btn');
    const backBtn = document.getElementById('back-btn');
    const forwardBtn = document.getElementById('forward-btn');

    // Welcome popup removed - using custom start page instead

    // Track enabled state locally (overlay has the actual Scrutinizer)
    let fovealEnabled = false;
    
    const toggleFoveal = (forceState = null) => {
        if (forceState !== null) {
            fovealEnabled = forceState;
        } else {
            fovealEnabled = !fovealEnabled;
        }

        toggleBtn.classList.toggle('active', fovealEnabled);
        
        // Notify main process of state change
        ipcRenderer.send('settings:enabled-changed', fovealEnabled);
        
        // Tell overlay view to enable/disable (it will show/hide canvas)
        ipcRenderer.send(fovealEnabled ? 'overlay:enable' : 'overlay:disable');
        // Tell main process to start/stop capturing frames
        ipcRenderer.send(fovealEnabled ? 'foveal:enabled' : 'foveal:disabled');
    };

    // Add missing click handler for toggle button
    toggleBtn.addEventListener('click', () => {
        toggleFoveal();
    });

    // Scrutinizer is now in the overlay view, not here

    // Capture loop is now handled by overlay view
    
    // Remove loading class when page loads
    ipcRenderer.on('browser:did-finish-load', () => {
        console.log('[App] Page loading finished');
        toggleBtn.classList.remove('loading');
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

        // Safety timeout: remove loading class after 5s if did-finish-load doesn't fire
        setTimeout(() => {
            if (toggleBtn.classList.contains('loading')) {
                console.log('[App] Safety timeout - removing stuck loading class');
                toggleBtn.classList.remove('loading');
            }
        }, 5000);
    });

    // (browser:did-finish-load handler is above with startCapturing)

    // Navigation controls - send to main process which controls the WebContentsView
    backBtn.addEventListener('click', () => {
        ipcRenderer.send('navigate:back');
    });

    forwardBtn.addEventListener('click', () => {
        ipcRenderer.send('navigate:forward');
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
            if (e.preventDefault) e.preventDefault();
            toggleFoveal();
            return;
        }

        // Left/Right arrows - handled by overlay view now
        // (Overlay listens for keyboard events and adjusts radius)
    };

    // Keyboard shortcuts from document (when focus is on toolbar/UI)
    document.addEventListener('keydown', handleKeyboardShortcut);

    // Listen for keyboard shortcuts forwarded from content view
    ipcRenderer.on('webview:keydown', (event, keyEvent) => {
        handleKeyboardShortcut(keyEvent);
    });

    // IPC listeners for main process (menus, settings)
    ipcRenderer.on('settings:init-state', (event, state) => {
        console.log('[Renderer] Received init-state:', state);
        // Forward state to overlay view
        if (state.enabled) toggleFoveal(true);
        // Radius and blur are sent to overlay via IPC
    });

    // Menu IPC handlers
    ipcRenderer.on('menu:toggle-foveal', () => {
        toggleFoveal();
    });

    ipcRenderer.on('menu:set-radius', (event, radius) => {
        // Forward to overlay view
        ipcRenderer.send('overlay:set-radius', radius);
    });


    console.log('Scrutinizer initialized');
});
