const { app, BrowserWindow, Menu, ipcMain, WebContentsView, globalShortcut } = require('electron');
const path = require('path');
const { buildMenuTemplate, RADIUS_OPTIONS } = require('./menu-template');
const settingsManager = require('./settings-manager');
const { CALIBRATION_URL } = require('./renderer/config');

// Track current settings for menu state and new windows
let currentRadius;
let currentBlur;
let currentIntensity;
let currentEnabled;
let currentShowWelcome;
let currentStartPage;
let currentVisualMemory;

let mainWindow;

// Track modifier keys for screenshot detection (Cmd+Shift+4)
let isCmdPressed = false;
let isShiftPressed = false;

// Handle EPIPE errors globally (common when piping output or closing terminals)
process.on('uncaughtException', (err) => {
    if (err.code === 'EPIPE') {
        // Ignore EPIPE errors
        return;
    }
    console.error('Uncaught Exception:', err);
    process.exit(1);
});

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

    // Explicitly set for all non-HUD windows (Windows/Linux)
    if (process.platform !== 'darwin') {
        BrowserWindow.getAllWindows().forEach(win => {
            if (!win.scrutinizerHud && !win.isDestroyed()) {
                win.setMenu(menu);
            }
        });
    }
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

ipcMain.on('settings:intensity-changed', (event, intensity) => {
    currentIntensity = intensity;
    settingsManager.set('intensity', intensity);
    // rebuildMenu(); // If menu needs update
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

// Navigation debounce to prevent double-firing (e.g., keyboard + button click)
const navigationDebounce = new Map(); // Map of window ID -> timestamp
const NAVIGATION_DEBOUNCE_MS = 300;

const canNavigate = (windowId, direction) => {
    const key = `${windowId}-${direction}`;
    const now = Date.now();
    const lastNavTime = navigationDebounce.get(key) || 0;

    if (now - lastNavTime < NAVIGATION_DEBOUNCE_MS) {
        console.log(`[Main] Debouncing ${direction} navigation (${now - lastNavTime}ms since last)`);
        return false;
    }

    navigationDebounce.set(key, now);
    return true;
};

// Navigation IPC handlers from HUD window
ipcMain.on('hud:navigate:back', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);
    if (win && win.scrutinizerView) {
        if (canNavigate(win.id, 'back')) {
            console.log('[Main] Navigating back (from HUD IPC)');
            win.scrutinizerView.webContents.goBack();
        }
    }
});

// Legacy handler for backward compatibility
ipcMain.on('navigate:back', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);
    if (win && win.scrutinizerView) {
        if (canNavigate(win.id, 'back')) {
            console.log('[Main] Navigating back (from legacy IPC)');
            win.scrutinizerView.webContents.goBack();
        }
    }
});

ipcMain.on('hud:navigate:forward', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);
    if (win && win.scrutinizerView) {
        if (canNavigate(win.id, 'forward')) {
            console.log('[Main] Navigating forward (from HUD IPC)');
            win.scrutinizerView.webContents.goForward();
        }
    }
});

// Legacy handler
ipcMain.on('navigate:forward', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);
    if (win && win.scrutinizerView) {
        if (canNavigate(win.id, 'forward')) {
            console.log('[Main] Navigating forward (from legacy IPC)');
            win.scrutinizerView.webContents.goForward();
        }
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
// Capture request from overlay
let captureRequestCount = 0;
ipcMain.on('hud:capture:request', async (event) => {
    captureRequestCount++;
    // Only log every 100th request to reduce console spam
    if (captureRequestCount % 100 === 0) {
        console.log(`[Main] Received hud:capture:request (#${captureRequestCount})`);
    }
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);

    if (win && win.scrutinizerView && win.scrutinizerHud) {
        try {
            // Race capturePage against a timeout
            const capturePromise = win.scrutinizerView.webContents.capturePage();
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Capture timed out')), 1000));

            let image;
            try {
                image = await Promise.race([capturePromise, timeoutPromise]);
            } catch (e) {
                // console.warn('[Main] View capture failed/timed out, falling back to window capture:', e.message);
                image = await win.capturePage();
            }

            const buffer = image.toBitmap();
            const size = image.getSize();

            // Send back to HUD window (where canvas lives)
            // Log every 60th frame to avoid spam, or just once to verify
            if (Math.random() < 0.05) {
                // console.log(`[Main] Captured frame: ${size.width}x${size.height}, Buffer: ${buffer.length}`);
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

    const { code, altKey, ctrlKey, metaKey, key, shiftKey } = keyEvent || {};

    // Track modifiers
    if (key === 'Meta') isCmdPressed = true;
    if (key === 'Shift') isShiftPressed = true;
    // console.log(`[Main] KeyDown: ${key}, Cmd=${isCmdPressed}, Shift=${isShiftPressed}`);

    // Platform helpers
    const isMac = process.platform === 'darwin';
    const cmdOrCtrl = isMac ? metaKey : ctrlKey;

    // Navigation: Back / Forward (with debouncing)
    if (code === 'ArrowLeft' && (cmdOrCtrl || altKey)) {
        if (win.scrutinizerView && canNavigate(win.id, 'back')) {
            console.log('[Main] Navigating back (from keyboard shortcut)');
            win.scrutinizerView.webContents.goBack();
        }
        return;
    }

    if (code === 'ArrowRight' && (cmdOrCtrl || altKey)) {
        if (win.scrutinizerView && canNavigate(win.id, 'forward')) {
            console.log('[Main] Navigating forward (from keyboard shortcut)');
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

ipcMain.on('keyup', (event, keyEvent) => {
    const { key } = keyEvent || {};
    if (key === 'Meta') isCmdPressed = false;
    if (key === 'Shift') isShiftPressed = false;
    // console.log(`[Main] KeyUp: ${key}, Cmd=${isCmdPressed}, Shift=${isShiftPressed}`);
});

// Toolbar IPC handlers
ipcMain.on('toolbar:navigate-back', (event) => {
    const windows = BrowserWindow.getAllWindows();
    // Find window where toolbarView is the sender
    const win = windows.find(w => w.toolbarView && w.toolbarView.webContents === event.sender);
    if (win && win.scrutinizerView && win.scrutinizerView.webContents.canGoBack()) {
        win.scrutinizerView.webContents.goBack();
    }
});

ipcMain.on('toolbar:navigate-forward', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.toolbarView && w.toolbarView.webContents === event.sender);
    if (win && win.scrutinizerView && win.scrutinizerView.webContents.canGoForward()) {
        win.scrutinizerView.webContents.goForward();
    }
});

ipcMain.on('toolbar:reload', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.toolbarView && w.toolbarView.webContents === event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.reload();
    }
});

ipcMain.on('toolbar:navigate-to', (event, url) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.toolbarView && w.toolbarView.webContents === event.sender);
    if (win && win.scrutinizerView) {
        win.scrutinizerView.webContents.loadURL(url);
    }
});

ipcMain.on('toolbar:toggle-fovea', (event) => {
    currentEnabled = !currentEnabled;
    settingsManager.set('enabled', currentEnabled);

    // Notify all windows/HUDs
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
        if (win.scrutinizerHud && !win.scrutinizerHud.isDestroyed()) {
            win.scrutinizerHud.webContents.send('settings:enabled-changed', currentEnabled);
        }
        if (win.toolbarView && !win.toolbarView.webContents.isDestroyed()) {
            win.toolbarView.webContents.send('toolbar:fovea-state', currentEnabled);
        }
    });
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

    // Explicitly set menu for Windows/Linux
    if (process.platform !== 'darwin') {
        const menu = Menu.getApplicationMenu();
        if (menu) win.setMenu(menu);
    }

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

    // Create Toolbar WebContentsView
    const toolbarView = new WebContentsView({
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    toolbarView.webContents.loadFile('renderer/toolbar.html');

    // Add views to main window
    win.contentView.addChildView(toolbarView);
    win.contentView.addChildView(contentView);

    const TOOLBAR_HEIGHT = 40;

    // Position views
    const updateViewBounds = () => {
        const [width, height] = win.getSize();
        // Toolbar at top
        toolbarView.setBounds({ x: 0, y: 0, width: width, height: TOOLBAR_HEIGHT });
        // Content below toolbar
        contentView.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width: width, height: height - TOOLBAR_HEIGHT });
    };
    updateViewBounds();
    win.on('resize', updateViewBounds);

    // ===== HUD WINDOW =====
    // Separate transparent window for toolbar + canvas
    // Position it to match the content area of main window (not including title bar AND toolbar)
    const contentBounds = win.getContentBounds();
    // Adjust for toolbar
    const hudY = contentBounds.y + TOOLBAR_HEIGHT;
    const hudHeight = contentBounds.height - TOOLBAR_HEIGHT;

    const hudWindow = new BrowserWindow({
        parent: win, // Attach to main window so it stays on top of it
        width: contentBounds.width,
        height: hudHeight,
        x: contentBounds.x,
        y: hudY,
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
    win.toolbarView = toolbarView;
    win.scrutinizerHud = hudWindow;
    hudWindow.mainBrowserWindow = win; // Reverse reference

    // Sync HUD position/size with main window
    // Use getContentBounds to account for title bar
    const syncHudBounds = () => {
        if (!win.isDestroyed() && !hudWindow.isDestroyed()) {
            const contentBounds = win.getContentBounds();
            // Adjust for toolbar
            hudWindow.setBounds({
                x: contentBounds.x,
                y: contentBounds.y + TOOLBAR_HEIGHT,
                width: contentBounds.width,
                height: contentBounds.height - TOOLBAR_HEIGHT
            });
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
        // Update Toolbar
        if (toolbarView.webContents && !toolbarView.webContents.isDestroyed()) {
            toolbarView.webContents.send('toolbar:update-loading', true);
            // Ensure fovea state is synced
            toolbarView.webContents.send('toolbar:fovea-state', currentEnabled);
        }
    });

    contentView.webContents.on('did-finish-load', () => {
        console.log('[Main] ContentView did-finish-load');
        if (!hudWindow.isDestroyed() && hudWindow.webContents && !hudWindow.webContents.isDestroyed()) {
            hudWindow.webContents.send('hud:browser:did-finish-load');
            hudWindow.webContents.send('browser:did-finish-load'); // Legacy
        }
        // Update Toolbar
        if (toolbarView.webContents && !toolbarView.webContents.isDestroyed()) {
            toolbarView.webContents.send('toolbar:update-loading', false);
            toolbarView.webContents.send('toolbar:update-nav-state', {
                canGoBack: contentView.webContents.canGoBack(),
                canGoForward: contentView.webContents.canGoForward()
            });
        }
    });

    // Also listen for did-stop-loading
    contentView.webContents.on('did-stop-loading', () => {
        console.log('[Main] ContentView did-stop-loading');
        if (toolbarView.webContents && !toolbarView.webContents.isDestroyed()) {
            toolbarView.webContents.send('toolbar:update-loading', false);
        }
    });

    contentView.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('[Main] ContentView did-fail-load:', errorCode, errorDescription);
        if (toolbarView.webContents && !toolbarView.webContents.isDestroyed()) {
            toolbarView.webContents.send('toolbar:update-loading', false);
        }
    });

    // Reset visual memory on navigation
    contentView.webContents.on('did-start-navigation', (event, url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) {
            console.log('[Main] Navigation started:', url);
            if (!hudWindow.isDestroyed() && hudWindow.webContents && !hudWindow.webContents.isDestroyed()) {
                hudWindow.webContents.send('hud:reset-visual-memory');
            }
        } else {
            console.log('[Main] In-page navigation (ignored for memory reset):', url);
        }
    });

    // Forward navigation events to update HUD URL bar
    const sendUrlUpdate = (url, eventType) => {
        console.log(`[Main] ${eventType}: ${url}`);
        if (!hudWindow.isDestroyed() && hudWindow.webContents && !hudWindow.webContents.isDestroyed()) {
            hudWindow.webContents.send('hud:browser:did-navigate', url);
            hudWindow.webContents.send('browser:did-navigate', url); // Legacy
        }
        // Update Toolbar
        if (toolbarView.webContents && !toolbarView.webContents.isDestroyed()) {
            toolbarView.webContents.send('toolbar:update-url', url);
            toolbarView.webContents.send('toolbar:update-nav-state', {
                canGoBack: contentView.webContents.canGoBack(),
                canGoForward: contentView.webContents.canGoForward()
            });
        }
    };

    // Only listen to did-navigate for main frame navigations
    // did-navigate-in-page is for hash changes and single-page app navigations
    contentView.webContents.on('did-navigate', (event, url) => {
        sendUrlUpdate(url, 'did-navigate');
    });

    // Note: Removed did-navigate-in-page listener to avoid duplicate URL updates
    // Hash changes and SPA navigations are handled by did-navigate

    // Intercept target="_blank" links
    contentView.webContents.setWindowOpenHandler(({ url }) => {
        console.log('[Main] Opening new window:', url);
        createScrutinizerWindow(url);
        return { action: 'deny' };
    });

    // Sync window title with page title
    const updateTitle = () => {
        const title = contentView.webContents.getTitle();
        if (title) win.setTitle(title);
    };

    contentView.webContents.on('page-title-updated', (event, title) => {
        if (title) win.setTitle(title);
    });

    contentView.webContents.on('did-navigate', updateTitle);
    contentView.webContents.on('did-finish-load', updateTitle);

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
                intensity: currentIntensity,
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
    // This works as a FALLBACK when DOM events are blocked by modals/popups
    // We still prefer DOM events when available (they carry element context)
    let mousePollingInterval = null;
    let lastDOMEventTime = Date.now();
    let mouseEventCount = 0; // Added for logging, as used in the provided snippet

    // Listen for DOM events and update timestamp
    ipcMain.on('browser:mousemove', (event, x, y, zoom = 1.0) => {
        lastDOMEventTime = Date.now();
        mouseEventCount++;
        // Log every 60th event
        if (mouseEventCount % 60 === 0) {
            console.log(`[Main] Received DOM mousemove: (${x}, ${y}), zoom=${zoom}`);
        }
        const windows = BrowserWindow.getAllWindows();
        const win = windows.find(w => w.scrutinizerView && w.scrutinizerView.webContents === event.sender);
        if (win && win.scrutinizerHud && !win.scrutinizerHud.isDestroyed()) {
            win.scrutinizerHud.webContents.send('browser:mousemove', x, y, zoom);
        }
    });

    const startMousePolling = () => {
        if (mousePollingInterval) {
            console.log('[Main] Polling already running');
            return; // Already polling
        }

        console.log('[Main] Starting mouse polling fallback');

        mousePollingInterval = setInterval(() => {
            if (win.isDestroyed()) {
                console.log('[Main] Polling stopped - window destroyed');
                return;
            }
            if (!win.isFocused()) {
                console.log('[Main] Polling skipped - window not focused');
                return;
            }

            // Check for screenshot shortcut (Cmd+Shift) on macOS
            // If user is taking a screenshot, we MUST stop updating the fovea
            // so the system cursor freeze works as expected.
            if (process.platform === 'darwin' && isCmdPressed && isShiftPressed) {
                // console.log('[Main] Polling skipped - Screenshot mode detected (Cmd+Shift)');
                return;
            }

            // Only use polling if DOM hasn't sent events recently (modal blocking)
            const timeSinceDOM = Date.now() - lastDOMEventTime;
            if (timeSinceDOM < 20) return; // Reduced from 100ms for faster dropdown response

            try {
                const { screen } = require('electron');
                const cursorPos = screen.getCursorScreenPoint();
                const contentBounds = win.getContentBounds();

                const x = cursorPos.x;
                const y = cursorPos.y;

                // FIX: Coordinate System Unification
                // preload.js sends Screen Coordinates.
                // overlay.js expects Screen Coordinates (and subtracts window.screenX itself).
                // Formerly, this fallback calculated Local Coordinates. Mixing them caused massive jumps.
                // We now send raw Screen Coordinates to match the primary pipeline.

                // Bounds check still needs local coords
                const localX = cursorPos.x - contentBounds.x;
                const localY = cursorPos.y - contentBounds.y - 40;

                if (localX >= 0 && localX < contentBounds.width && localY >= 0 && localY < contentBounds.height) {
                    // Send zoom=1.0 since coords are already window-relative
                    if (win.scrutinizerHud && !win.scrutinizerHud.isDestroyed()) {
                        win.scrutinizerHud.webContents.send('browser:mousemove', x, y, 1.0);
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
    try {
        console.log('[Renderer]', message);
    } catch (e) {
        // Ignore EPIPE errors from logging
    }
});

function createWindow() {
    // Initialize settings manager
    settingsManager.init();

    // Load saved settings with defaults
    currentRadius = settingsManager.get('radius');
    currentBlur = settingsManager.get('blur');
    currentIntensity = settingsManager.get('intensity');
    currentVisualMemory = settingsManager.get('visualMemory'); // Load saved visual memory setting
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

// Test Mode Handler
function runTestMode() {
    console.log('[Main] Running in TEST MODE');
    const testWindow = new BrowserWindow({
        width: 800,
        height: 600,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            offscreen: true
        }
    });

    const testFile = process.env.TEST_FILE || path.join('tests', 'visual-test.html');
    testWindow.loadFile(path.join(__dirname, testFile));

    ipcMain.on('test-result', (event, result) => {
        if (result.success) {
            console.log('✅ TEST PASSED:', result.message);
            app.exit(0);
        } else {
            console.error('❌ TEST FAILED:', result.message);
            if (result.details) console.error('Details:', result.details);
            app.exit(1);
        }
    });

    // Handle logs from renderer during test
    ipcMain.on('log', (event, msg) => {
        console.log('[Test Renderer]', msg);
    });

    ipcMain.on('save-screenshot', (event, { name, dataUrl }) => {
        const fs = require('fs');
        const p = require('path'); // Use p to avoid conflict if path is already defined
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
        const screenshotsDir = p.join(__dirname, 'tests', 'screenshots');

        if (!fs.existsSync(screenshotsDir)) {
            fs.mkdirSync(screenshotsDir, { recursive: true });
        }

        // SCREENSHOT_MODE: 'update' (clean filenames) or 'date' (timestamped)
        // Default to 'date' if SAVE_SCREENSHOTS is true but no mode specified
        const mode = process.env.SCREENSHOT_MODE || 'date';

        let filename;
        if (mode === 'update') {
            filename = `${name}.png`;
        } else {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            filename = `${name}_${timestamp}.png`;
        }

        const filePath = p.join(screenshotsDir, filename);
        fs.writeFileSync(filePath, base64Data, 'base64');
        console.log(`[Test] Saved screenshot: ${filePath}`);
    });

    testWindow.webContents.on('crashed', () => {
        console.error('❌ TEST FAILED: Renderer process crashed');
        app.exit(1);
    });
}

function runIntegrationTest() {
    const testUrl = process.env.TEST_URL;
    const testModes = (process.env.TEST_MODES || '0').split(',').map(m => {
        const val = parseFloat(m.trim());
        return isNaN(val) ? m.trim() : val;
    });
    const testRadius = process.env.TEST_RADIUS ? parseFloat(process.env.TEST_RADIUS) : null;
    const testIntensity = process.env.TEST_INTENSITY ? parseFloat(process.env.TEST_INTENSITY) : null;

    console.log(`[Main] Running INTEGRATION TEST`);
    console.log(`[Main] URL: ${testUrl}`);
    console.log(`[Main] Modes: ${testModes.join(', ')}`);

    if (!testUrl) {
        console.error('❌ TEST FAILED: TEST_URL env var is required');
        app.exit(1);
        return;
    }

    // Create window normally
    createWindow();

    // Wait for window to be ready
    const checkWindow = setInterval(() => {
        if (mainWindow && mainWindow.scrutinizerView && mainWindow.scrutinizerHud) {
            clearInterval(checkWindow);
            startScenario();
        }
    }, 100);

    function startScenario() {
        console.log(`[Test] Navigating to ${testUrl}...`);
        mainWindow.scrutinizerView.webContents.loadURL(testUrl);

        mainWindow.scrutinizerView.webContents.once('did-finish-load', async () => {
            console.log('[Test] Page loaded. Waiting for effects to stabilize...');

            // Scroll to specified Y offset if TEST_SCROLL_Y is set
            const scrollY = process.env.TEST_SCROLL_Y ? parseInt(process.env.TEST_SCROLL_Y, 10) : 0;
            if (scrollY > 0) {
                console.log(`[Test] Scrolling to Y offset: ${scrollY}px...`);
                await mainWindow.scrutinizerView.webContents.executeJavaScript(`
                    window.scrollTo(0, ${scrollY});
                `);
                // Wait for scroll to complete and re-render
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Wait for 5 seconds for page to settle and effects to render
            setTimeout(async () => {
                console.log('[Test] Positioning fovea in center...');
                const { width, height } = mainWindow.getContentBounds();
                const centerX = Math.floor(width / 2);
                const centerY = Math.floor(height / 2);

                // Simulate mouse move to center
                mainWindow.scrutinizerHud.webContents.send('browser:mousemove', centerX, centerY, 1.0);

                // Apply overrides if present
                if (testRadius !== null) {
                    mainWindow.scrutinizerHud.webContents.send('menu:set-foveal-radius', testRadius);
                }
                if (testIntensity !== null) {
                    mainWindow.scrutinizerHud.webContents.send('menu:set-intensity', testIntensity);
                }

                // Wait for fovea/params to update
                setTimeout(async () => {
                    // Iterate through modes
                    for (const mode of testModes) {
                        console.log(`[Test] Switching to Mode: ${mode}...`);

                        // Handle Debug Modes vs Aesthetic Modes
                        if (mode === 'saliency') {
                            mainWindow.scrutinizerHud.webContents.send('menu:toggle-saliency-map', true);
                        } else if (mode === 'structure') {
                            mainWindow.scrutinizerHud.webContents.send('menu:toggle-structure-map', true);
                        } else {
                            // Numeric Aesthetic Mode
                            mainWindow.scrutinizerHud.webContents.send('menu:set-aesthetic-mode', mode);
                        }

                        // Wait for render
                        await new Promise(resolve => setTimeout(resolve, 500));

                        console.log(`[Test] Capturing screenshot for Mode ${mode}...`);
                        try {
                            const image = await mainWindow.scrutinizerHud.capturePage();
                            const buffer = image.toPNG();

                            // Reuse save logic
                            const fs = require('fs');
                            const p = require('path');
                            const screenshotsDir = p.join(__dirname, 'tests', 'screenshots');
                            if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

                            const screenshotMode = process.env.SCREENSHOT_MODE || 'date';

                            // Extract hostname for filename
                            let hostname = 'unknown';
                            try {
                                hostname = new URL(testUrl).hostname.replace(/[^a-z0-9]/gi, '_');
                            } catch (e) { }

                            const baseName = `site_${hostname}_mode_${mode}`;
                            let filename;

                            if (screenshotMode === 'update') {
                                filename = `${baseName}.png`;
                            } else {
                                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                                filename = `${baseName}_${timestamp}.png`;
                            }

                            const filePath = p.join(screenshotsDir, filename);
                            fs.writeFileSync(filePath, buffer);
                            console.log(`[Test] Saved screenshot: ${filePath}`);
                        } catch (err) {
                            console.error('❌ TEST FAILED during capture:', err);
                            app.exit(1);
                        }

                        // Cleanup Debug Modes
                        if (mode === 'saliency') {
                            mainWindow.scrutinizerHud.webContents.send('menu:toggle-saliency-map', false);
                        } else if (mode === 'structure') {
                            mainWindow.scrutinizerHud.webContents.send('menu:toggle-structure-map', false);
                        }
                    }

                    console.log('✅ INTEGRATION TEST PASSED');
                    app.exit(0);

                }, 1000);
            }, 5000);
        });
    }
}

app.whenReady().then(() => {
    if (process.env.TEST_URL && process.env.TEST_MODES) {
        // If TEST_MODES is present, assume we want to run the capture loop
        runIntegrationTest();
    } else if (process.env.TEST_MODE === 'true') {
        runTestMode();
    } else {
        createWindow();

        // Auto-open calibration if --calibrate flag is passed
        if (process.argv.includes('--calibrate')) {
            console.log('[Main] --calibrate flag detected, opening calibration window...');
            setTimeout(() => startWebCalibration(), 1000); // Delay to ensure main window is ready
        }
    }

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

// Handle "New Window" menu action
app.on('create-new-window', () => {
    createScrutinizerWindow();
});

// === Calibration Window Logic ===
// Web-based calibration: Navigate to working web version with distortion disabled



function startWebCalibration() {
    console.log('[Main] Starting Web-Based Calibration');

    // Find the main window with scrutinizerView
    const windows = BrowserWindow.getAllWindows();
    const mainWin = windows.find(w => w.scrutinizerView);

    if (!mainWin) {
        console.error('[Main] No window with scrutinizerView found');
        return;
    }

    // Disable visual distortion during calibration using existing mechanism
    currentEnabled = false;
    settingsManager.set('enabled', currentEnabled);

    // Notify HUD and toolbar of disabled state
    if (mainWin.scrutinizerHud && !mainWin.scrutinizerHud.isDestroyed()) {
        mainWin.scrutinizerHud.webContents.send('settings:enabled-changed', currentEnabled);
    }
    if (mainWin.toolbarView && !mainWin.toolbarView.webContents.isDestroyed()) {
        mainWin.toolbarView.webContents.send('toolbar:fovea-state', currentEnabled);
    }
    console.log('[Main] Disabled foveal simulation for calibration');

    // Navigate to calibration URL
    // Navigate to calibration URL
    mainWin.scrutinizerView.webContents.loadURL(CALIBRATION_URL);
    console.log('[Main] Navigated to calibration URL:', CALIBRATION_URL);

    // Listen for postMessage from the calibration page
    mainWin.scrutinizerView.webContents.on('console-message', (event, level, message) => {
        // Check if this is our calibration message
        if (message.includes('scrutinizer-calibration-complete')) {
            const match = message.match(/radius['":\s]+(\d+)/);
            if (match) {
                const radius = parseInt(match[1], 10);
                handleCalibrationComplete(mainWin, radius);
            }
        }
    });

    // Also inject a script to forward postMessage to console.log for capture
    mainWin.scrutinizerView.webContents.on('did-finish-load', () => {
        mainWin.scrutinizerView.webContents.executeJavaScript(`
            window.addEventListener('message', function(e) {
                if (e.data && e.data.type === 'scrutinizer-calibration-complete') {
                    console.log('scrutinizer-calibration-complete radius:' + e.data.radius);
                }
            });
        `);
    });
}

function handleCalibrationComplete(win, radius) {
    console.log('[Main] Calibration Complete from web:', radius, 'px');

    // Save the radius
    currentRadius = radius;
    settingsManager.set('radius', radius);

    // Re-enable distortion with new radius using existing mechanism
    currentEnabled = true;
    settingsManager.set('enabled', currentEnabled);

    // Notify all windows of new state
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(w => {
        if (w.scrutinizerHud && !w.scrutinizerHud.isDestroyed()) {
            w.scrutinizerHud.webContents.send('settings:radius-changed', radius);
            w.scrutinizerHud.webContents.send('settings:enabled-changed', currentEnabled);
        }
        if (w.toolbarView && !w.toolbarView.webContents.isDestroyed()) {
            w.toolbarView.webContents.send('toolbar:fovea-state', currentEnabled);
        }
    });
    console.log('[Main] Re-enabled foveal simulation with new radius:', radius);
}

// Event from Menu
app.on('open-calibration-window', () => {
    startWebCalibration();
});

// Event from Calibration Page
ipcMain.on('calibration-complete', (event, radius) => {
    console.log(`[Main] Calibration Complete: ${radius}px`);
    currentRadius = radius;
    settingsManager.set('radius', radius);

    // Notify all windows
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
        if (win.scrutinizerHud && !win.scrutinizerHud.isDestroyed()) {
            win.scrutinizerHud.webContents.send('settings:radius-changed', radius);
        }
    });

    // Update Menu
    rebuildMenu();

    // Close the calibration window (event.sender)
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
});
