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
    
    // Create content WebContentsView (loads web pages)
    const contentView = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, 'renderer', 'preload.js')
            // offscreen: true  // TEMP: Disabled - "no content under offscreen mode" error
        }
    });

    // Add views to window (order matters for z-index)
    win.contentView.addChildView(contentView);  // Background
    win.contentView.addChildView(toolbarView);  // Foreground
    
    // Position views
    const toolbarHeight = 50;
    const updateViewBounds = () => {
        const [width, height] = win.getSize();
        toolbarView.setBounds({ x: 0, y: 0, width: width, height: toolbarHeight });
        contentView.setBounds({ x: 0, y: toolbarHeight, width: width, height: height - toolbarHeight });
    };
    updateViewBounds();
    
    // Load toolbar HTML into toolbar view
    toolbarView.webContents.loadFile('renderer/index.html');
    
    // Store references
    win.scrutinizerToolbar = toolbarView;
    win.scrutinizerView = contentView;

    // Keep view bounds in sync on window resize
    win.on('resize', updateViewBounds);

    // Since offscreen rendering doesn't work, use capturePage polling
    // Capture at 30fps when foveal mode is enabled
    let captureInterval = null;
    
    const startCapturing = async () => {
        if (captureInterval) return;
        
        captureInterval = setInterval(async () => {
            try {
                const image = await contentView.webContents.capturePage();
                const buffer = image.toBitmap();  // BGRA format
                const size = image.getSize();
                
                // Send to toolbar view (where app.js/scrutinizer live)
                toolbarView.webContents.send('frame-captured', {
                    buffer: buffer,
                    width: size.width,
                    height: size.height
                });
            } catch (err) {
                console.error('[Main] Capture error:', err);
            }
        }, 33); // ~30fps
    };
    
    const stopCapturing = () => {
        if (captureInterval) {
            clearInterval(captureInterval);
            captureInterval = null;
        }
    };
    
    // Listen for foveal mode state changes
    ipcMain.on('foveal:enabled', () => startCapturing());
    ipcMain.on('foveal:disabled', () => stopCapturing());

    // Forward IPC messages from content view preload to toolbar view
    contentView.webContents.on('ipc-message', (event, channel, ...args) => {
        if (channel === 'keydown') {
            toolbarView.webContents.send('webview:keydown', args[0]);
        } else if (channel === 'mousemove') {
            // Mouse events are handled by toolbar's own listeners
        } else if (channel === 'scroll' || channel === 'mutation' || channel === 'input-change') {
            // Trigger a capture when content changes
            if (captureInterval) {
                // Already capturing at interval
            }
        }
    });

    // Load start URL in the content view
    const urlToLoad = startUrl || currentStartPage || 'https://github.com/andyed/scrutinizer2025?tab=readme-ov-file#what-is-scrutinizer';
    contentView.webContents.loadURL(urlToLoad);

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
