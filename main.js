const { app, BrowserWindow, Menu, ipcMain, WebContentsView } = require('electron');
const path = require('path');
const { buildMenuTemplate, RADIUS_OPTIONS } = require('./menu-template');
const settingsManager = require('./settings-manager');

// Track current settings for menu state and new windows
let currentRadius;
let currentBlur;
let currentEnabled;
let currentShowWelcome;
let currentStartPage;

let mainWindow;

function sendToRenderer(channel, ...args) {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
        win.webContents.send(channel, ...args);
    }
}

function rebuildMenu() {
    // Ensure settings are initialized
    const radius = currentRadius || 180;
    const blur = currentBlur || 10;
    const menu = Menu.buildFromTemplate(buildMenuTemplate(sendToRenderer, radius, blur));
    Menu.setApplicationMenu(menu);
}

// Listen for settings changes from renderer to update menu (global listeners)
ipcMain.on('settings:radius-changed', (event, radius) => {
    currentRadius = radius;
    settingsManager.set('radius', radius);
    rebuildMenu();
});

ipcMain.on('settings:blur-changed', (event, blur) => {
    currentBlur = blur;
    settingsManager.set('blur', blur);
    rebuildMenu();
});

ipcMain.on('settings:enabled-changed', (event, enabled) => {
    currentEnabled = enabled;
    settingsManager.set('enabled', enabled);
    // rebuildMenu(); // If menu had a toggle state, we'd update it here
});

ipcMain.on('settings:welcome-changed', (event, show) => {
    currentShowWelcome = show;
    settingsManager.set('showWelcomePopup', show);
});

ipcMain.on('settings:page-changed', (event, url) => {
    if (url && url.startsWith('http')) {
        currentStartPage = url;
        settingsManager.set('startPage', url);
    }
});

// Allow overlay view to hand keyboard focus to the content view
ipcMain.on('overlay:focus-content', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerOverlay && w.scrutinizerOverlay.webContents === event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.focus();
    }
});

ipcMain.on('window:create', (event, url) => {
    console.log('[Main] Received window:create for:', url);
    createScrutinizerWindow(url);
});

// Navigation IPC handlers for WebContentsView
// Note: event.sender is the overlay view, we need to navigate the content view
ipcMain.on('navigate:back', (event) => {
    // Find window from overlay webContents
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerOverlay && w.scrutinizerOverlay.webContents === event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.goBack();
    }
});

ipcMain.on('navigate:forward', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerOverlay && w.scrutinizerOverlay.webContents === event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.goForward();
    }
});

ipcMain.on('navigate:reload', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerOverlay && w.scrutinizerOverlay.webContents === event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.reload();
    }
});

ipcMain.on('navigate:to', (event, url) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerOverlay && w.scrutinizerOverlay.webContents === event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.loadURL(url);
    }
});

// Content view is visible and receives input naturally - no forwarding needed!

// Send window dimensions to overlay for canvas sizing
ipcMain.on('get-window-size', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerOverlay && w.scrutinizerOverlay.webContents === event.sender);
    if (win) {
        const [width, height] = win.getSize();
        event.reply('window-size', { width, height });
    }
});

// Handle capture requests from overlay (for foveal effect)
ipcMain.on('capture:request', async (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerOverlay && w.scrutinizerOverlay.webContents === event.sender);
    
    if (win && win.scrutinizerView && win.scrutinizerOverlay) {
        try {
            const image = await win.scrutinizerView.webContents.capturePage();
            const buffer = image.toBitmap();
            const size = image.getSize();
            
            // Send back to overlay view (where canvas lives)
            win.scrutinizerOverlay.webContents.send('frame-captured', {
                buffer: buffer,
                width: size.width,
                height: size.height
            });
        } catch (err) {
            console.error('[Main] Capture error:', err);
        }
    }
});

// Handle new window requests from preload script (target="_blank" links)
ipcMain.on('open-new-window', (event, url) => {
    console.log('[Main] Received open-new-window request:', url);
    createScrutinizerWindow(url);
});

function createScrutinizerWindow(startUrl) {
    console.log('[Main] Creating new Scrutinizer window', startUrl ? 'with URL: ' + startUrl : '(default URL)');

    // Get bounds from settings if available
    const bounds = settingsManager.get('windowBounds') || { width: 1200, height: 900 };

    const win = new BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        webPreferences: {
            // Host window needs node access for app.js to use require('electron')
            nodeIntegration: true,
            contextIsolation: false,
            // Enable webview tag - embedded content runs isolated via preload.js
            webviewTag: true
        }
    });

    // Save bounds on resize/move (debounced)
    let saveTimeout;
    const saveBounds = () => {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            if (!win.isDestroyed()) {
                settingsManager.set('windowBounds', win.getBounds());
            }
        }, 500);
    };
    win.on('resize', saveBounds);
    win.on('move', saveBounds);

    // Create content WebContentsView (the actual browser - VISIBLE, FULL WINDOW)
    const contentView = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, 'renderer', 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Create overlay WebContentsView (toolbar UI + canvas - FULL WINDOW, transparent)
    const overlayView = new WebContentsView({
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    
    // Make overlay view transparent at native level
    overlayView.setBackgroundColor({ red: 0, green: 0, blue: 0, alpha: 0 });
    
    overlayView.webContents.once('did-finish-load', () => {
        console.log('[Main] Overlay loaded');
    });

    // Add views to window (order matters for z-index)
    win.contentView.addChildView(contentView);   // Layer 1: browser (bottom)
    win.contentView.addChildView(overlayView);   // Layer 2: overlay with toolbar + canvas (top)

    // Position views - BOTH AT (0, 0) FULL WINDOW
    const updateViewBounds = () => {
        const [width, height] = win.getSize();
        // Content view gets full window
        contentView.setBounds({ x: 0, y: 0, width: width, height: height });
        // Overlay view gets full window (toolbar floats via CSS)
        overlayView.setBounds({ x: 0, y: 0, width: width, height: height });
    };
    updateViewBounds();

    // Load HTML into overlay (has toolbar + canvas)
    overlayView.webContents.loadFile('renderer/overlay.html');
    
    overlayView.webContents.once('did-finish-load', () => {
        console.log('[Main] Overlay loaded');
    });

    // Open DevTools for the overlay (has UI)
    overlayView.webContents.openDevTools({ mode: 'detach' });

    // Store references
    win.scrutinizerView = contentView;
    win.scrutinizerOverlay = overlayView;

    // Keep view bounds in sync on window resize
    win.on('resize', updateViewBounds);

    // Content view is visible - no paint events needed, just capture when foveal mode is active
    // Capture will be done via capturePage() on demand from renderer

    contentView.webContents.on('did-start-loading', () => {
        console.log('[Main] ContentView did-start-loading');
        if (!overlayView.webContents.isDestroyed()) {
            overlayView.webContents.send('browser:did-start-loading');
        }
    });

    contentView.webContents.on('did-finish-load', () => {
        console.log('[Main] ContentView did-finish-load');
        if (!overlayView.webContents.isDestroyed()) {
            overlayView.webContents.send('browser:did-finish-load');
        }
    });

    contentView.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('[Main] ContentView did-fail-load:', errorCode, errorDescription);
    });

    // Forward navigation events to update URL bar
    const sendUrlUpdate = (url) => {
        if (!overlayView.webContents.isDestroyed()) {
            overlayView.webContents.send('browser:did-navigate', url);
        }
    };

    contentView.webContents.on('did-navigate', (event, url) => {
        sendUrlUpdate(url);
    });

    contentView.webContents.on('did-navigate-in-page', (event, url) => {
        sendUrlUpdate(url);
    });

    // Forward IPC messages from content view preload to overlay view
    contentView.webContents.on('ipc-message', (event, channel, ...args) => {
        if (channel === 'keydown') {
            if (!overlayView.webContents.isDestroyed()) {
                overlayView.webContents.send('webview:keydown', args[0]);
            }
        } else if (channel === 'mousemove') {
            // Mouse events are handled by overlay's own listeners
        } else if (channel === 'scroll' || channel === 'mutation' || channel === 'input-change') {
            // Trigger a capture when content changes
            // For now, we rely on regular capture interval
        } else if (channel === 'open-new-window') {
            // Handle target="_blank" links from preload script
            const url = args[0];
            console.log('[Main] Opening new window from preload:', url);
            createScrutinizerWindow(url);
        }
    });

    // Intercept target="_blank" links in content view
    contentView.webContents.setWindowOpenHandler(({ url }) => {
        console.log('[Main] Opening new window:', url);
        createScrutinizerWindow(url);
        return { action: 'deny' };
    });

    // Load start URL in the content view
    const urlToLoad = startUrl || currentStartPage || 'https://github.com/andyed/scrutinizer2025?tab=readme-ov-file#what-is-scrutinizer';
    contentView.webContents.loadURL(urlToLoad);

    // Send init state to overlay view once it loads
    overlayView.webContents.once('did-finish-load', () => {
        console.log('[Main] Overlay did-finish-load. Sending init-state.');
        overlayView.webContents.send('settings:radius-options', RADIUS_OPTIONS);
        // Pass current state to new window
        // Only show welcome popup on first window (when mainWindow doesn't exist yet)
        const isFirstWindow = !mainWindow || BrowserWindow.getAllWindows().length === 1;
        const state = {
            radius: currentRadius,
            blur: currentBlur,
            enabled: currentEnabled,
            showWelcome: isFirstWindow ? currentShowWelcome : false
        };
        console.log('[Main] Sending state to overlay:', JSON.stringify(state));
        overlayView.webContents.send('settings:init-state', state);
    });

    // Navigation will be handled via view.webContents.loadURL() instead of popup:navigate IPC

    win.on('closed', () => {
        // Let GC reclaim window; nothing else to do
    });

    return win;
}

function createWindow() {
    // Initialize settings manager
    settingsManager.init();

    // Load saved settings with defaults
    currentRadius = settingsManager.get('radius');
    currentBlur = settingsManager.get('blur');
    currentEnabled = settingsManager.get('enabled') !== undefined ? settingsManager.get('enabled') : false;
    currentShowWelcome = settingsManager.get('showWelcomePopup');
    currentStartPage = settingsManager.get('startPage');

    mainWindow = createScrutinizerWindow(currentStartPage);

    // Build and set application menu
    rebuildMenu();

    // Open DevTools for debugging
    mainWindow.webContents.openDevTools();

    // Intercept popups from the main window's web contents
    if (mainWindow && mainWindow.webContents && mainWindow.webContents.setWindowOpenHandler) {
        mainWindow.webContents.setWindowOpenHandler(({ url }) => {
            createScrutinizerWindow(url);
            return { action: 'deny' };
        });
    }

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

app.on('ready', createWindow);

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});
