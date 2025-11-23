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

ipcMain.on('window:create', (event, url) => {
    console.log('[Main] Received window:create for:', url);
    createScrutinizerWindow(url);
});

// Navigation IPC handlers for WebContentsView
// Note: event.sender is the toolbar view, we need to navigate the content view
ipcMain.on('navigate:back', (event) => {
    // Find window from toolbar webContents
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerToolbar && w.scrutinizerToolbar.webContents === event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.goBack();
    }
});

ipcMain.on('navigate:forward', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerToolbar && w.scrutinizerToolbar.webContents === event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.goForward();
    }
});

ipcMain.on('navigate:reload', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerToolbar && w.scrutinizerToolbar.webContents === event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.reload();
    }
});

ipcMain.on('navigate:to', (event, url) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerToolbar && w.scrutinizerToolbar.webContents === event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.loadURL(url);
    }
});

ipcMain.on('input:wheel', (event, data) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerToolbar && w.scrutinizerToolbar.webContents === event.sender);

    if (!win) {
        console.warn('[Main] Could not find window for event sender');
        return;
    }

    if (win && win.scrutinizerView && !win.scrutinizerView.isDestroyed()) {
        win.scrutinizerView.webContents.sendInputEvent({
            type: 'mouseWheel',
            x: data.x,
            y: data.y,
            deltaX: 0, // Electron requires deltaX/Y to be 0 for mouseWheel event? No, wait.
            deltaY: 0, // Actually, for 'mouseWheel', it uses accelerationRatio and wheelTicks?
            // Let's try passing deltas as is, but maybe inverted?
            // Electron docs: "deltaX Integer - The amount to scroll horizontally."
            // "deltaY Integer - The amount to scroll vertically."
            deltaX: data.deltaX,
            deltaY: data.deltaY,
            wheelTicksX: data.deltaX / 120,
            wheelTicksY: data.deltaY / 120,
            accelerationRatioX: 1,
            accelerationRatioY: 1,
            hasPreciseScrollingDeltas: true,
            canScroll: true
        });
    } else {
        console.warn('[Main] Content view not found or destroyed');
    }
});

ipcMain.on('input:mouse', (event, data) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerToolbar && w.scrutinizerToolbar.webContents === event.sender);
    if (win && win.scrutinizerView && !win.scrutinizerView.isDestroyed()) {
        win.scrutinizerView.webContents.sendInputEvent({
            type: data.type,
            x: data.x,
            y: data.y,
            button: data.button,
            clickCount: data.clickCount
        });
    }
});

ipcMain.on('input:keyboard', (event, data) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerToolbar && w.scrutinizerToolbar.webContents === event.sender);
    if (win && win.scrutinizerView && !win.scrutinizerView.isDestroyed()) {
        win.scrutinizerView.webContents.sendInputEvent({
            type: data.type,
            keyCode: data.keyCode
        });
    }
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

    // Create toolbar WebContentsView (loads the UI HTML)
    const toolbarView = new WebContentsView({
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // Create content BrowserWindow (hidden, offscreen)
    // This replaces WebContentsView which had issues loading when detached
    const contentWin = new BrowserWindow({
        width: 1200,
        height: 850,
        show: false, // Hidden
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'renderer', 'preload.js'),
            offscreen: true,
            backgroundThrottling: false // Keep running when hidden
        }
    });

    // Add views to window (order matters for z-index)
    // win.contentView.addChildView(contentView);  // Background - REMOVED
    win.contentView.addChildView(toolbarView);  // Foreground

    // Position views
    const toolbarHeight = 50;
    const updateViewBounds = () => {
        const [width, height] = win.getSize();
        // Toolbar view now covers the WHOLE window to display the canvas overlay
        toolbarView.setBounds({ x: 0, y: 0, width: width, height: height });

        // Resize the offscreen window to match the content area
        if (!contentWin.isDestroyed()) {
            contentWin.setSize(width, height - toolbarHeight);
        }
    };
    updateViewBounds();

    // Load toolbar HTML into toolbar view
    toolbarView.webContents.loadFile('renderer/index.html');

    // Open DevTools for the UI
    toolbarView.webContents.openDevTools({ mode: 'detach' });

    // Store references
    win.scrutinizerToolbar = toolbarView;
    win.scrutinizerView = contentWin; // Store window reference

    // Keep view bounds in sync on window resize
    win.on('resize', updateViewBounds);

    // Handle offscreen rendering paint events
    contentWin.webContents.on('paint', (event, dirty, image) => {
        // console.log('[Main] Paint event:', dirty); // Uncomment for verbose logging

        // Only process if we have a valid image
        if (!image) return;

        // Get raw bitmap buffer (BGRA format)
        const buffer = image.toBitmap();
        const size = image.getSize();

        // Send to toolbar view (where app.js/scrutinizer live)
        if (!toolbarView.webContents.isDestroyed()) {
            toolbarView.webContents.send('frame-captured', {
                buffer: buffer,
                width: size.width,
                height: size.height,
                dirty: dirty
            });
        }
    });

    contentWin.webContents.on('did-start-loading', () => {
        console.log('[Main] ContentWin did-start-loading');
        if (!toolbarView.webContents.isDestroyed()) {
            toolbarView.webContents.send('browser:did-start-loading');
        }
    });

    contentWin.webContents.on('did-finish-load', () => {
        console.log('[Main] ContentWin did-finish-load');
    });

    contentWin.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('[Main] ContentWin did-fail-load:', errorCode, errorDescription);
    });

    // Forward navigation events to update URL bar
    const sendUrlUpdate = (url) => {
        if (!toolbarView.webContents.isDestroyed()) {
            toolbarView.webContents.send('browser:did-navigate', url);
        }
    };

    contentWin.webContents.on('did-navigate', (event, url) => {
        sendUrlUpdate(url);
    });

    contentWin.webContents.on('did-navigate-in-page', (event, url) => {
        sendUrlUpdate(url);
    });

    // Set frame rate for offscreen rendering
    contentWin.webContents.setFrameRate(60);

    // Listen for foveal mode state changes to optimize frame rate
    ipcMain.on('foveal:enabled', () => {
        if (!contentWin.isDestroyed()) contentWin.webContents.setFrameRate(60);
    });

    ipcMain.on('foveal:disabled', () => {
        // Lower frame rate when not in foveal mode to save resources
        if (!contentWin.isDestroyed()) contentWin.webContents.setFrameRate(10);
    });

    // Forward IPC messages from content view preload to toolbar view
    contentWin.webContents.on('ipc-message', (event, channel, ...args) => {
        if (channel === 'keydown') {
            if (!toolbarView.webContents.isDestroyed()) {
                toolbarView.webContents.send('webview:keydown', args[0]);
            }
        } else if (channel === 'mousemove') {
            // Mouse events are handled by toolbar's own listeners
        } else if (channel === 'scroll' || channel === 'mutation' || channel === 'input-change') {
            // Trigger a capture when content changes
            // This logic was for WebContentsView, might need adjustment for BrowserWindow
            // For now, we rely on paint events for capture.
        }
    });

    // Load start URL in the content view
    const urlToLoad = startUrl || currentStartPage || 'https://github.com/andyed/scrutinizer2025?tab=readme-ov-file#what-is-scrutinizer';
    contentWin.loadURL(urlToLoad);

    // Send init state to toolbar view once it loads
    toolbarView.webContents.once('did-finish-load', () => {
        console.log('[Main] Toolbar did-finish-load. Sending init-state.');
        toolbarView.webContents.send('settings:radius-options', RADIUS_OPTIONS);
        // Pass current state to new window
        const state = {
            radius: currentRadius,
            blur: currentBlur,
            enabled: currentEnabled,
            showWelcome: currentShowWelcome
        };
        console.log('[Main] Sending state to toolbar:', JSON.stringify(state));
        toolbarView.webContents.send('settings:init-state', state);
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
