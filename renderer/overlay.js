/**
 * Overlay view - handles toolbar UI + canvas rendering
 */

const { ipcRenderer } = require('electron');

let scrutinizer;
let captureInterval = null;
let fovealEnabled = false;

document.addEventListener('DOMContentLoaded', () => {
    console.log('[Overlay] Initializing');
    
    // Get UI elements
    const toggleBtn = document.getElementById('toggle-btn');
    const urlInput = document.getElementById('url-input');
    const navigateBtn = document.getElementById('go-btn');
    const backBtn = document.getElementById('back-btn');
    const forwardBtn = document.getElementById('forward-btn');
    
    // Initialize Scrutinizer for canvas rendering
    scrutinizer = new Scrutinizer(CONFIG);
    
    // Listen for frame data from main process
    ipcRenderer.on('frame-captured', (event, data) => {
        if (scrutinizer && data.width > 0 && data.height > 0) {
            const buffer = new Uint8Array(data.buffer);
            scrutinizer.processFrame(buffer, data.width, data.height);
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
    
    // Toggle foveal effect
    const toggleFoveal = (forceState = null) => {
        if (forceState !== null) {
            fovealEnabled = forceState;
        } else {
            fovealEnabled = !fovealEnabled;
        }

        toggleBtn.classList.toggle('active', fovealEnabled);
        
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
    
    // Toolbar event handlers
    toggleBtn.addEventListener('click', () => {
        toggleFoveal();
    });
    
    backBtn.addEventListener('click', () => {
        ipcRenderer.send('navigate:back');
    });

    forwardBtn.addEventListener('click', () => {
        ipcRenderer.send('navigate:forward');
    });

    navigateBtn.addEventListener('click', () => {
        const url = urlInput.value.trim();
        if (url) {
            const fullUrl = url.startsWith('http') ? url : 'https://' + url;
            ipcRenderer.send('navigate:to', fullUrl);
            ipcRenderer.send('settings:page-changed', fullUrl);
        }
    });

    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            navigateBtn.click();
        }
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Escape to toggle foveal
        if (e.code === 'Escape') {
            e.preventDefault();
            toggleFoveal();
            return;
        }

        // Backquote / Tilde to hide/show toolbar
        if (e.code === 'Backquote') {
            e.preventDefault();
            const toolbarEl = document.getElementById('toolbar');
            if (toolbarEl) {
                toolbarEl.classList.toggle('hidden');
            }
            return;
        }
        
        // Arrow keys to adjust radius (when enabled)
        if (fovealEnabled) {
            if (e.code === 'ArrowRight') {
                e.preventDefault();
                if (scrutinizer) scrutinizer.updateFovealRadius(10);
            } else if (e.code === 'ArrowLeft') {
                e.preventDefault();
                if (scrutinizer) scrutinizer.updateFovealRadius(-10);
            }
        }
    });

    // When clicking outside the toolbar, hand focus to the content view
    document.addEventListener('mousedown', (e) => {
        const toolbarEl = document.getElementById('toolbar');
        if (toolbarEl && !toolbarEl.contains(e.target)) {
            ipcRenderer.send('overlay:focus-content');
        }
    });
    
    // Listen for page load events to update UI
    ipcRenderer.on('browser:did-start-loading', () => {
        console.log('[Overlay] Page loading started');
        toggleBtn.classList.add('loading');
    });

    ipcRenderer.on('browser:did-finish-load', () => {
        console.log('[Overlay] Page loading finished');
        toggleBtn.classList.remove('loading');
    });

    ipcRenderer.on('browser:did-navigate', (event, url) => {
        // Update URL bar (unless it's focused)
        if (document.activeElement !== urlInput) {
            urlInput.value = url;
        }
        toggleBtn.classList.remove('loading');
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

    ipcRenderer.on('menu:set-radius', (event, radius) => {
        if (scrutinizer) scrutinizer.updateFovealRadius(radius);
    });
    
    console.log('[Overlay] Ready');
});
