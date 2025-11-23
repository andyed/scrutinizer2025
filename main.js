const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const { buildMenuTemplate, RADIUS_OPTIONS } = require('./menu-template');
const settingsManager = require('./settings-manager');

// Track current settings for menu state and new windows
let currentRadius;
let currentBlur;
let currentEnabled;

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

function createScrutinizerWindow(startUrl) {
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

    win.webContents.once('did-finish-load', () => {
        win.webContents.send('settings:radius-options', RADIUS_OPTIONS);
        // Pass current state to new window
        win.webContents.send('settings:init-state', {
            radius: currentRadius,
            blur: currentBlur,
            enabled: currentEnabled
        });
    });

    if (startUrl) {
        win.webContents.once('did-finish-load', () => {
            win.webContents.send('popup:navigate', startUrl);
        });
    }

    win.on('closed', () => {
        // Let GC reclaim window; nothing else to do
    });

    return win;
}

function createWindow() {
    // Initialize settings manager
    settingsManager.init();
    
    // Load saved settings
    currentRadius = settingsManager.get('radius');
    currentBlur = settingsManager.get('blur');
    currentEnabled = settingsManager.get('enabled');

    mainWindow = createScrutinizerWindow();

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
