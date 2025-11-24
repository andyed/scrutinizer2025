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
    const toolbar = document.getElementById('toolbar');
    
    // Initialize Scrutinizer for canvas rendering
    scrutinizer = new Scrutinizer(CONFIG);
    
    // Handle mouse events for click-through behavior
    // When mouse is over toolbar, capture events; otherwise forward to browser
    let mouseOverToolbar = false;
    
    const updateMouseForwarding = () => {
        if (mouseOverToolbar) {
            // Mouse over toolbar - capture events so toolbar buttons work
            ipcRenderer.send('hud:set-ignore-mouse-events', false);
        } else {
            // Mouse not over toolbar - forward to browser below
            ipcRenderer.send('hud:set-ignore-mouse-events', true, { forward: true });
        }
    };
    
    // Track when mouse enters/leaves toolbar
    toolbar.addEventListener('mouseenter', () => {
        mouseOverToolbar = true;
        updateMouseForwarding();
    });
    
    toolbar.addEventListener('mouseleave', () => {
        mouseOverToolbar = false;
        updateMouseForwarding();
    });
    
    // Track mouse globally to catch edge cases
    document.addEventListener('mousemove', (e) => {
        const overToolbar = toolbar && toolbar.contains(e.target);
        if (overToolbar !== mouseOverToolbar) {
            mouseOverToolbar = overToolbar;
            updateMouseForwarding();
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
        // ESC is now handled in main.js to toggle entire HUD window
        // No need to toggle toolbar visibility here anymore
        
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

    // HUD window is now separate - no need to forward mouse/wheel events
    // Browser window handles all interactions natively
    
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
    
    // Handle toolbar visibility toggle (from ESC key or menu)
    ipcRenderer.on('hud:toggle-toolbar', () => {
        const toolbarEl = document.getElementById('toolbar');
        if (toolbarEl) {
            toolbarEl.classList.toggle('hidden');
        }
    });
    
    console.log('[Overlay] Ready');
});
