const { app, BrowserWindow, Menu, ipcMain, WebContentsView, globalShortcut } = require('electron');
const path = require('path');
const { buildMenuTemplate, RADIUS_OPTIONS } = require('./menu-template');
const settingsManager = require('./settings-manager');

// Track current settings for menu state and new windows
let currentRadius;
let currentBlur;
let currentEnabled;
let currentShowWelcome;
let currentStartPage;
let currentVisualMemory;

let mainWindow;

function sendToRenderer(channel, ...args) {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
        win.webContents.send(channel, ...args);
    }
}

const sendToOverlays = (channel, ...args) => {
    const windows = BrowserWindow.getAllWindows();
    let sentCount = 0;
    windows.forEach(win => {
        if (win.scrutinizerHud) {
            win.scrutinizerHud.webContents.send(channel, ...args);
            sentCount++;
        }
    });
    console.log(`[Main] sendToOverlays: Sent '${channel}' to ${sentCount} windows`);
};

function rebuildMenu() {
    // Ensure settings are initialized
    const radius = currentRadius || 180;
    const blur = currentBlur || 10;
    const menu = Menu.buildFromTemplate(buildMenuTemplate(sendToRenderer, sendToOverlays, radius, blur));
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

ipcMain.on('settings:visual-memory-changed', (event, value) => {
    currentVisualMemory = value;
    settingsManager.set('visualMemory', value);
    // rebuildMenu(); // If we want to update checked state
});

ipcMain.on('settings:page-changed', (event, url) => {
    if (url && url.startsWith('http')) {
        currentStartPage = url;
        settingsManager.set('startPage', url);
    }
});

// Handle Home navigation requests from renderer (Go → Home)
ipcMain.on('navigate:home', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);
    if (!win || !win.scrutinizerView) return;

    const urlToLoad = currentStartPage || 'https://github.com/andyed/scrutinizer2025?tab=readme-ov-file#what-is-scrutinizer';
    win.scrutinizerView.webContents.loadURL(urlToLoad);
});

// No longer needed - HUD window doesn't intercept wheel events
// Browser window handles scroll natively

// No longer needed - browser window handles focus natively

ipcMain.on('window:create', (event, url) => {
    console.log('[Main] Received window:create for:', url);
    createScrutinizerWindow(url);
});

// Navigation IPC handlers from HUD window
ipcMain.on('hud:navigate:back', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.goBack();
    }
});

// Legacy handler for backward compatibility
ipcMain.on('navigate:back', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.goBack();
    }
});

ipcMain.on('hud:navigate:forward', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.goForward();
    }
});

// Legacy handler
ipcMain.on('navigate:forward', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.goForward();
    }
});

ipcMain.on('hud:navigate:reload', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.reload();
    }
});

// Legacy handler
ipcMain.on('navigate:reload', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.reload();
    }
});

ipcMain.on('hud:navigate:to', (event, url) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.loadURL(url);
    }
});

// Legacy handler
ipcMain.on('navigate:to', (event, url) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.loadURL(url);
    }
});

// Send window dimensions to HUD for canvas sizing
ipcMain.on('hud:request:window-bounds', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);
    if (win) {
        const [width, height] = win.getSize();
        event.reply('window-size', { width, height });
    }
});

// Legacy handler
ipcMain.on('get-window-size', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);
    if (win) {
        const [width, height] = win.getSize();
        event.reply('window-size', { width, height });
    }
});

// Handle capture requests from HUD (for foveal effect)
// Handle capture requests from HUD (for foveal effect)
ipcMain.on('hud:capture:request', async (event) => {
    // console.log('[Main] Received hud:capture:request'); // Keep this commented to avoid spam if loop is fast
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);

    if (win && win.scrutinizerView && win.scrutinizerHud) {
        try {
            const image = await win.scrutinizerView.webContents.capturePage();
            const buffer = image.toBitmap();
            const size = image.getSize();

            // Send back to HUD window (where canvas lives)
            // Log every 60th frame to avoid spam, or just once to verify
            if (Math.random() < 0.05) {
                console.log(`[Main] Captured frame: ${size.width}x${size.height}, Buffer: ${buffer.length}`);
            }

            win.scrutinizerHud.webContents.send('hud:frame-captured', {
                buffer: buffer,
                width: size.width,
                height: size.height
            });
        } catch (err) {
            console.error('[Main] Capture error:', err);
        }
    } else {
        console.warn('[Main] hud:capture:request failed: Could not find matching window for sender');
    }
});

// Legacy handler
ipcMain.on('capture:request', async (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);

    if (win && win.scrutinizerView && win.scrutinizerHud) {
        try {
            const image = await win.scrutinizerView.webContents.capturePage();
            const buffer = image.toBitmap();
            const size = image.getSize();

            // Send back to HUD window (where canvas lives)
            win.scrutinizerHud.webContents.send('frame-captured', {
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

// Forward browser mouse position to HUD for foveal effect tracking
let mouseEventCount = 0;
ipcMain.on('browser:mousemove', (event, x, y, zoom = 1.0) => {
    mouseEventCount++;
    // Log every 60th event
    if (mouseEventCount % 60 === 0) {
        console.log(`[Main] Received mousemove: (${x}, ${y}), zoom=${zoom}`);
    }
    const windows = BrowserWindow.getAllWindows();
    // Find the window that owns this content view
    const win = windows.find(w => w.scrutinizerView && w.scrutinizerView.webContents === event.sender);
    if (win && win.scrutinizerHud && !win.scrutinizerHud.isDestroyed()) {
        win.scrutinizerHud.webContents.send('browser:mousemove', x, y, zoom);
    }
});

ipcMain.on('browser:zoom-changed', (event, zoom) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerView && w.scrutinizerView.webContents === event.sender);
    if (win && win.scrutinizerHud && !win.scrutinizerHud.isDestroyed()) {
        win.scrutinizerHud.webContents.send('browser:zoom-changed', zoom);
    }
});

// Forward structure map updates from content to HUD
ipcMain.on('structure-update', (event, blocks) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerView && w.scrutinizerView.webContents === event.sender);
    if (win && win.scrutinizerHud && !win.scrutinizerHud.isDestroyed()) {
        console.log(`[Main] Forwarding ${blocks.length} structure blocks to HUD`);
        win.scrutinizerHud.webContents.send('structure-update', blocks);
    }
});

// Handle URL dialog responses
ipcMain.on('url-dialog:go', (event, url) => {
    const windows = BrowserWindow.getAllWindows();
    const parentWin = windows.find(w => w.urlDialog && w.urlDialog.webContents === event.sender);
    if (parentWin && parentWin.scrutinizerView) {
        parentWin.scrutinizerView.webContents.loadURL(url);
        parentWin.urlDialog.close();
        delete parentWin.urlDialog;
    }
});

ipcMain.on('url-dialog:cancel', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const parentWin = windows.find(w => w.urlDialog && w.urlDialog.webContents === event.sender);
    if (parentWin && parentWin.urlDialog) {
        parentWin.urlDialog.close();
        delete parentWin.urlDialog;
    }
});

// Keyboard shortcuts forwarded from browser content (preload)
// Used to support navigation and foveal toggling when focus is in the page.
ipcMain.on('keydown', (event, keyEvent) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerView && w.scrutinizerView.webContents === event.sender);
    if (!win) return;

    const { code, altKey, ctrlKey, metaKey } = keyEvent || {};

    // Platform helpers
    const isMac = process.platform === 'darwin';
    const cmdOrCtrl = isMac ? metaKey : ctrlKey;

    // Navigation: Back / Forward
    if (code === 'ArrowLeft' && (cmdOrCtrl || altKey)) {
        if (win.scrutinizerView) {
            win.scrutinizerView.webContents.goBack();
        }
        return;
    }

    if (code === 'ArrowRight' && (cmdOrCtrl || altKey)) {
        if (win.scrutinizerView) {
            win.scrutinizerView.webContents.goForward();
        }
        return;
    }

    // Forward Escape and bare arrow keys to HUD/overlay for foveal controls
    if (code === 'Escape' || code === 'ArrowLeft' || code === 'ArrowRight') {
        if (win.scrutinizerHud && !win.scrutinizerHud.isDestroyed()) {
            win.scrutinizerHud.webContents.send('webview:keydown', keyEvent);
        }
    }
});

function createScrutinizerWindow(startUrl) {
    console.log('[Main] Creating new Scrutinizer window (dual-window architecture)', startUrl ? 'with URL: ' + startUrl : '(default URL)');

    // Get bounds from settings if available
    const bounds = settingsManager.get('windowBounds') || { width: 1200, height: 900 };

    // ===== MAIN BROWSER WINDOW =====
    // This window contains only the browser content (via WebContentsView)
    const win = new BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        show: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Save bounds on resize/move (debounced)
    let saveTimeout;
    const saveBounds = () => {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            if (!win.isDestroyed()) {
                const newBounds = win.getBounds();
                settingsManager.set('windowBounds', newBounds);
            }
        }, 100);
    };
    win.on('resize', saveBounds);
    win.on('move', saveBounds);

    // Create content WebContentsView (the actual browser content)
    const contentView = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, 'renderer', 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Add content view to main window
    win.contentView.addChildView(contentView);

    // Position content view to fill the window
    const updateViewBounds = () => {
        const [width, height] = win.getSize();
        contentView.setBounds({ x: 0, y: 0, width: width, height: height });
    };
    updateViewBounds();
    win.on('resize', updateViewBounds);

    // ===== HUD WINDOW =====
    // Separate transparent window for toolbar + canvas
    // Position it to match the content area of main window (not including title bar)
    const contentBounds = win.getContentBounds();
    const hudWindow = new BrowserWindow({
        parent: win, // Attach to main window so it stays on top of it
        width: contentBounds.width,
        height: contentBounds.height,
        x: contentBounds.x,
        y: contentBounds.y,
        transparent: true,
        frame: false,
        modal: false, // Not modal, but stays above parent
        show: true, // Show by default for now (can toggle with ESC)
        hasShadow: false,
        focusable: false, // Don't steal keyboard focus from browser
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // HUD always forwards events - no toolbar to click
    hudWindow.setIgnoreMouseEvents(true, { forward: true });

    // Load HUD content (just canvas, no toolbar)
    hudWindow.loadFile('renderer/overlay.html');

    // Open DevTools for HUD debugging
    // hudWindow.webContents.openDevTools({ mode: 'detach' });

    // Store references
    win.scrutinizerView = contentView;
    win.scrutinizerHud = hudWindow;
    hudWindow.mainBrowserWindow = win; // Reverse reference

    // Sync HUD position/size with main window
    // Use getContentBounds to account for title bar
    const syncHudBounds = () => {
        if (!win.isDestroyed() && !hudWindow.isDestroyed()) {
            const contentBounds = win.getContentBounds();
            hudWindow.setBounds(contentBounds);
        }
    };
    win.on('move', syncHudBounds);
    win.on('resize', syncHudBounds);

    // Initial sync
    syncHudBounds();

    // Clean up when window closes
    win.on('closed', () => {
        if (!hudWindow.isDestroyed()) {
            hudWindow.close();
        }
    });

    // Content view loading events - forward to HUD
    contentView.webContents.on('did-start-loading', () => {
        console.log('[Main] ContentView did-start-loading');
        if (!hudWindow.isDestroyed() && hudWindow.webContents && !hudWindow.webContents.isDestroyed()) {
            hudWindow.webContents.send('hud:browser:did-start-loading');
            hudWindow.webContents.send('browser:did-start-loading'); // Legacy
        }
    });

    contentView.webContents.on('did-finish-load', () => {
        console.log('[Main] ContentView did-finish-load');
        if (!hudWindow.isDestroyed() && hudWindow.webContents && !hudWindow.webContents.isDestroyed()) {
            hudWindow.webContents.send('hud:browser:did-finish-load');
            hudWindow.webContents.send('browser:did-finish-load'); // Legacy
        }
    });

    contentView.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('[Main] ContentView did-fail-load:', errorCode, errorDescription);
    });

    // Reset visual memory on navigation
    contentView.webContents.on('did-start-navigation', () => {
        console.log('[Main] Navigation started, resetting visual memory');
        if (!hudWindow.isDestroyed() && hudWindow.webContents && !hudWindow.webContents.isDestroyed()) {
            hudWindow.webContents.send('hud:reset-visual-memory');
        }
    });

    // Forward navigation events to update HUD URL bar
    const sendUrlUpdate = (url) => {
        if (!hudWindow.isDestroyed() && hudWindow.webContents && !hudWindow.webContents.isDestroyed()) {
            hudWindow.webContents.send('hud:browser:did-navigate', url);
            hudWindow.webContents.send('browser:did-navigate', url); // Legacy
        }
    };

    contentView.webContents.on('did-navigate', (event, url) => {
        sendUrlUpdate(url);
    });

    contentView.webContents.on('did-navigate-in-page', (event, url) => {
        sendUrlUpdate(url);
    });

    // Intercept target="_blank" links
    contentView.webContents.setWindowOpenHandler(({ url }) => {
        console.log('[Main] Opening new window:', url);
        createScrutinizerWindow(url);
        return { action: 'deny' };
    });

    // Load start URL in the content view
    const urlToLoad = startUrl || currentStartPage || 'https://github.com/andyed/scrutinizer2025?tab=readme-ov-file#what-is-scrutinizer';
    contentView.webContents.loadURL(urlToLoad);

    // Send init state to HUD once it loads
    hudWindow.webContents.once('did-finish-load', () => {
        if (!hudWindow.isDestroyed() && hudWindow.webContents && !hudWindow.webContents.isDestroyed()) {
            console.log('[Main] HUD loaded. Sending init-state.');
            hudWindow.webContents.send('hud:settings:radius-options', RADIUS_OPTIONS);
            hudWindow.webContents.send('settings:radius-options', RADIUS_OPTIONS); // Legacy

            // Pass current state to new window
            // Only show welcome popup on first window (when mainWindow doesn't exist yet)
            const isFirstWindow = !mainWindow || BrowserWindow.getAllWindows().filter(w => !w.mainBrowserWindow).length === 1;
            const state = {
                radius: currentRadius,
                blur: currentBlur,
                enabled: currentEnabled,
                visualMemory: currentVisualMemory,
                showWelcome: isFirstWindow ? currentShowWelcome : false
            };
            console.log('[Main] Sending state to HUD:', JSON.stringify(state));
            hudWindow.webContents.send('hud:settings:init-state', state);
            hudWindow.webContents.send('settings:init-state', state); // Legacy
        }
    });



    // MOUSE TRACKING FALLBACK: Poll global mouse position
    // This works even when DOM events are blocked by modals/popups
    let mousePollingInterval = null;

    const startMousePolling = () => {
        if (mousePollingInterval) return; // Already polling

        mousePollingInterval = setInterval(() => {
            if (win.isDestroyed() || !win.isFocused()) return;

            try {
                const { screen } = require('electron');
                const cursorPos = screen.getCursorScreenPoint();
                const winBounds = win.getBounds();
                const contentBounds = contentView.getBounds();

                // Convert screen coords to window-relative coords
                const x = cursorPos.x - winBounds.x - contentBounds.x;
                const y = cursorPos.y - winBounds.y - contentBounds.y;

                // Only send if cursor is within content view bounds
                if (x >= 0 && x < contentBounds.width && y >= 0 && y < contentBounds.height) {
                    const zoom = contentView.webContents.getZoomFactor();
                    if (win.scrutinizerHud && !win.scrutinizerHud.isDestroyed()) {
                        win.scrutinizerHud.webContents.send('browser:mousemove', x, y, zoom);
                    }
                }
            } catch (err) {
                console.error('[Main] Mouse polling error:', err);
            }
        }, 16); // ~60fps
    };

    const stopMousePolling = () => {
        if (mousePollingInterval) {
            clearInterval(mousePollingInterval);
            mousePollingInterval = null;
        }
    };

    // Start/stop polling based on window focus
    win.on('focus', startMousePolling);
    win.on('blur', stopMousePolling);
    win.on('closed', stopMousePolling);

    // Start immediately if window is focused
    if (win.isFocused()) {
        startMousePolling();
    }

    return win;
}

// Add this outside createScrutinizerWindow to ensure it's registered once
ipcMain.on('log:renderer', (event, message) => {
    console.log('[Renderer]', message);
});

function createWindow() {
    // Initialize settings manager
    settingsManager.init();

    // Load saved settings with defaults
    currentRadius = settingsManager.get('radius');
    currentBlur = settingsManager.get('blur');
    currentEnabled = true; // Force enabled for debugging
    // currentEnabled = settingsManager.get('enabled') !== undefined ? settingsManager.get('enabled') : true; // Default to true for debugging
    currentShowWelcome = settingsManager.get('showWelcomePopup');
    currentStartPage = settingsManager.get('startPage');

    mainWindow = createScrutinizerWindow(currentStartPage);

    // Build and set application menu
    rebuildMenu();

    // Open DevTools for main window debugging
    // mainWindow.webContents.openDevTools();

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

app.commandLine.appendSwitch('ignore-gpu-blacklist');
app.commandLine.appendSwitch('enable-transparent-visuals');

app.on('ready', () => {
    createWindow();

    // Register global shortcut for Open URL
    globalShortcut.register('CommandOrControl+L', () => {
        const win = BrowserWindow.getFocusedWindow();
        if (win && win.scrutinizerView) {
            // Trigger the menu item action
            const currentURL = win.scrutinizerView.webContents.getURL();

            // Create URL input dialog window
            const dialog = new BrowserWindow({
                width: 500,
                height: 200,
                parent: win,
                modal: true,
                show: false,
                resizable: false,
                minimizable: false,
                maximizable: false,
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false
                }
            });

            dialog.loadFile(path.join(__dirname, 'renderer', 'url-dialog.html'));

            dialog.once('ready-to-show', () => {
                dialog.show();
                dialog.webContents.send('set-url', currentURL);
            });

            // Store reference for IPC handlers
            win.urlDialog = dialog;
        }
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    // Unregister all global shortcuts
    globalShortcut.unregisterAll();
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});
