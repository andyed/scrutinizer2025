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
ipcMain.on('navigate:back', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.goBack();
    }
});

ipcMain.on('navigate:forward', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.goForward();
    }
});

ipcMain.on('navigate:reload', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.reload();
    }
});

ipcMain.on('navigate:to', (event, url) => {
    const win = BrowserWindow.fromWebContents(event.sender);
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

    win.loadFile('renderer/index.html');

    // Create WebContentsView for page content (replaces <webview> tag)
    const view = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, 'renderer', 'preload.js'),
            offscreen: true  // Enable offscreen rendering for paint events
        }
    });

    // Attach view to window
    win.contentView.addChildView(view);

    // Position view below toolbar (50px height from CSS)
    const updateViewBounds = () => {
        const [width, height] = win.getSize();
        view.setBounds({ x: 0, y: 50, width: width, height: height - 50 });
    };
    updateViewBounds();

    // Keep view bounds in sync on window resize
    win.on('resize', updateViewBounds);

    // Listen for paint events from offscreen rendering
    view.webContents.on('paint', (event, dirty, image) => {
        // Get frame buffer and size
        const buffer = image.toBitmap();  // BGRA format
        const size = image.getSize();
        
        // Send to renderer for foveal processing
        win.webContents.send('frame-captured', {
            buffer: buffer,
            width: size.width,
            height: size.height,
            dirty: dirty
        });
    });

    // Forward IPC messages from WebContentsView preload to renderer
    view.webContents.on('ipc-message', (event, channel, ...args) => {
        if (channel === 'keydown') {
            win.webContents.send('webview:keydown', args[0]);
        } else if (channel === 'mousemove') {
            // Mouse events are handled by renderer's own listeners
        } else if (channel === 'scroll' || channel === 'mutation' || channel === 'input-change') {
            // These events trigger paint automatically, no need to forward
        }
    });

    // Set frame rate (60fps for smooth tracking)
    view.webContents.setFrameRate(60);

    // Load start URL in the view
    const urlToLoad = startUrl || currentStartPage || 'https://github.com/andyed/scrutinizer2025?tab=readme-ov-file#what-is-scrutinizer';
    view.webContents.loadURL(urlToLoad);

    // Store view reference for navigation commands
    win.scrutinizerView = view;

    win.webContents.once('did-finish-load', () => {
        console.log('[Main] Window did-finish-load. Sending init-state.');
        win.webContents.send('settings:radius-options', RADIUS_OPTIONS);
        // Pass current state to new window
        const state = {
            radius: currentRadius,
            blur: currentBlur,
            enabled: currentEnabled,
            showWelcome: currentShowWelcome
        };
        console.log('[Main] Sending state to new window:', JSON.stringify(state));
        win.webContents.send('settings:init-state', state);
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
