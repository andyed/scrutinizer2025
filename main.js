const { app, BrowserWindow, Menu, ipcMain, WebContentsView, globalShortcut, session } = require('electron');
const path = require('path');
const { buildMenuTemplate, RADIUS_OPTIONS } = require('./menu-template');
const settingsManager = require('./settings-manager');
const { CALIBRATION_URL } = require('./renderer/config');
// Auto-updater: graceful fallback if electron-updater not bundled
let autoUpdater = null;
try {
    ({ autoUpdater } = require('electron-updater'));
} catch (err) {
    console.warn('[Updater] electron-updater failed to load:', err.message || err);
}

let updateCheckInFlight = false;
let manualUpdateCheck = false;

// Track current settings for menu state and new windows
let currentRadius;
let currentBlur;
let currentIntensity;
let currentEnabled;
let currentShowWelcome;
let currentStartPage;


let currentVisualMemory;
let currentMobileEmulation;
let currentAestheticMode = 14;

// Tier 1 keyboard shortcut state (cycling modes)
let currentCongestionMode = 0;   // 0=Off, 1=Stats, 2=Heatmap, 3=Saliency vs Congestion
let currentEccentricityMode = 0; // 0=Off, 1=Fovea, 2=+Parafovea, 3=+Periphery
let currentSaliencyMapOn = false;
let currentStructureMapOn = false;
let currentSaliencyResolution = 256; // 256, 512, or 1024
let currentCongestionResolution = 512; // 256, 512, 1024, or 2048

let mainWindow;
let splashWindow;

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
    const menu = Menu.buildFromTemplate(buildMenuTemplate(sendToRenderer, sendToOverlays, radius, blur, currentMobileEmulation, currentAestheticMode, currentCongestionMode, currentEccentricityMode, currentSaliencyMapOn, currentStructureMapOn, currentSaliencyResolution, currentCongestionResolution));
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

ipcMain.on('settings:comfort-mode-changed', (event, enabled) => {
    settingsManager.set('comfortMode', enabled);
});

ipcMain.on('settings:page-changed', (event, url) => {
    if (url && url.startsWith('http')) {
        currentStartPage = url;
        settingsManager.set('startPage', url);
    }

});

// Aesthetic mode changed — rebuild menu to sync radio buttons across Behavior/Utility submenus
app.on('aesthetic-mode-changed', (mode) => {
    currentAestheticMode = mode;
    rebuildMenu();
});

// Sync Tier 1 shortcut state when changed via menu clicks
app.on('congestion-mode-changed', (mode) => {
    currentCongestionMode = mode;
    rebuildMenu();
});

app.on('eccentricity-mode-changed', (mode) => {
    currentEccentricityMode = mode;
    rebuildMenu();
});

app.on('saliency-map-changed', (on) => {
    currentSaliencyMapOn = on;
    rebuildMenu();
});

app.on('saliency-resolution-changed', (res) => {
    currentSaliencyResolution = res;
    settingsManager.set('saliencyResolution', res);
    rebuildMenu();
});

app.on('congestion-resolution-changed', (res) => {
    currentCongestionResolution = res;
    settingsManager.set('congestionResolution', res);
    rebuildMenu();
});

app.on('structure-map-changed', (on) => {
    currentStructureMapOn = on;
    rebuildMenu();
});

// Handle Touch Emulation Request
ipcMain.on('emulate-touch', async (event, { type, x, y }) => {
    if (!currentMobileEmulation) return;

    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerView && w.scrutinizerView.webContents === event.sender);

    if (win && win.scrutinizerView) {
        const wc = win.scrutinizerView.webContents;
        const width = win.scrutinizerView.getBounds().width;

        try {
            if (!wc.debugger.isAttached()) {
                wc.debugger.attach('1.3');
            }

            // Synthesize a touch event
            // Note: coordinates from renderer are likely client coordinates (relative to view)
            // Input.dispatchTouchEvent expects absolute coordinates relative to viewport? 
            // In a WebContentsView, client coordinates should be viewport coordinates.

            // We need to send a sequence: touchStart -> touchEnd to simulate a tap
            // Or just forward the specific event type requested

            // For a single "click" replacement, we usually want a full sequence.
            // But if we are forwarding mousedown/up, we should map them.

            const touchPoints = [{ x: x, y: y }];

            await wc.debugger.sendCommand('Input.dispatchTouchEvent', {
                type: type, // 'touchStart', 'touchEnd', 'touchMove'
                touchPoints: touchPoints
            });

        } catch (err) {
            console.warn('[Main] Touch simulation failed:', err.message);
        }
    }
});
// Helper to apply mobile emulation state
async function applyMobileEmulation(win, enabled) {
    if (!win || !win.scrutinizerView) return;
    const wc = win.scrutinizerView.webContents;
    const TOOLBAR_HEIGHT = 40;

    try {
        // Attach debugger if not already attached
        if (!wc.debugger.isAttached()) {
            try {
                wc.debugger.attach('1.3');
            } catch (err) {
                console.warn('[Main] Debugger attach warning:', err.message);
            }
        }

        // 'enabled' param can be boolean (legacy) or string (profile key)
        console.log(`[Main] applyMobileEmulation called with enabled=${enabled} (type: ${typeof enabled})`);
        const profileId = (typeof enabled === 'string') ? enabled : (enabled ? 'iphone_14_pro' : false);

        if (profileId) {
            const { DEVICE_PROFILES } = require('./shared/constants.json');
            const profile = DEVICE_PROFILES[profileId];

            if (!profile) {
                console.warn(`[Main] Mobile profile '${profileId}' not found. Falling back to iPhone 14 Pro.`);
            }
            const targetProfile = profile || DEVICE_PROFILES['iphone_14_pro'];

            console.log(`[Main] Enabling Mobile Emulation: ${targetProfile.label}`);

            // Apply Metrics
            await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
                width: targetProfile.width,
                height: targetProfile.height,
                deviceScaleFactor: targetProfile.scaleFactor,
                mobile: targetProfile.mobile
            });

            // Apply User Agent
            await wc.debugger.sendCommand('Network.setUserAgentOverride', {
                userAgent: targetProfile.userAgent
            });

            // Resize Window
            const width = targetProfile.width;
            const height = targetProfile.height + TOOLBAR_HEIGHT;

            win.setResizable(true); // Ensure we can resize first
            win.setSize(width, height, true);
            win.setResizable(false); // Lock size

        } else {
            console.log('[Main] Disabling Mobile Emulation');
            // Mobile Emulation OFF
            await wc.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');
            await wc.debugger.sendCommand('Network.setUserAgentOverride', { userAgent: '' });

            // Detach
            if (wc.debugger.isAttached()) {
                wc.debugger.detach();
            }

            // Restore
            win.setResizable(true);

            // Restore size from settings or default
            const bounds = settingsManager.get('windowBounds') || { width: 1200, height: 900 };
            const targetW = bounds.width < 500 ? 1200 : bounds.width;
            const targetH = bounds.height < 600 ? 900 : bounds.height;

            win.setSize(targetW, targetH, true);
        }
    } catch (err) {
        console.error('[Main] Mobile Emulation Verify Error:', err);
    }
}

// Handle Mobile Emulation Toggle
app.on('mobile-emulation', async (enabled) => {
    currentMobileEmulation = enabled;
    settingsManager.set('mobileEmulation', enabled);
    rebuildMenu();

    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
        if (win.scrutinizerView) {
            await applyMobileEmulation(win, enabled);
        }
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
        const [width, height] = win.getContentSize(); // Use getContentSize to exclude title bar
        event.reply('window-size', { width, height });
    }
});

// Legacy handler
ipcMain.on('get-window-size', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);
    if (win) {
        const [width, height] = win.getContentSize(); // Use getContentSize to exclude title bar
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
            // Performance Optimization: 1:1 Capture Fidelity
            // Explicitly specify capture bounds to ensure 1:1 pixel mapping
            // This eliminates scaling artifacts and improves text clarity
            const bounds = win.scrutinizerView.getBounds();
            const captureRect = {
                x: 0,
                y: 0,
                width: bounds.width,
                height: bounds.height
            };

            // Race capturePage against a timeout
            const capturePromise = win.scrutinizerView.webContents.capturePage(captureRect);
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Capture timed out')), 1000));

            let image;
            try {
                image = await Promise.race([capturePromise, timeoutPromise]);
            } catch (e) {
                // console.warn('[Main] View capture failed/timed out, falling back to window capture:', e.message);
                image = await win.capturePage(captureRect);
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
            // Performance Optimization: 1:1 Capture Fidelity (legacy handler)
            const bounds = win.scrutinizerView.getBounds();
            const captureRect = {
                x: 0,
                y: 0,
                width: bounds.width,
                height: bounds.height
            };

            const image = await win.scrutinizerView.webContents.capturePage(captureRect);
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
ipcMain.on('structure-update', (event, blocks, trigger) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerView && w.scrutinizerView.webContents === event.sender);
    if (win && win.scrutinizerHud && !win.scrutinizerHud.isDestroyed()) {
        console.log(`[Main] Forwarding ${blocks.length} structure blocks to HUD (${trigger || 'unknown'})`);
        win.scrutinizerHud.webContents.send('structure-update', blocks, trigger);
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

// Forward congestion processing state from overlay to toolbar (amber throbber)
ipcMain.on('overlay:congestion-processing', (event, processing) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);
    if (win && win.toolbarView && !win.toolbarView.webContents.isDestroyed()) {
        win.toolbarView.webContents.send('toolbar:congestion-processing', processing);
    }
});

// Toggle overlay window mouse passthrough for interactive HUD panels.
// With setIgnoreMouseEvents(true, { forward: true }), the overlay is click-through
// but still receives mousemove. When cursor enters an interactive panel, the panel
// asks us to disable ignore mode so clicks land. When cursor leaves, we restore.
ipcMain.on('overlay:set-interactive', (event, interactive) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);
    if (win && win.scrutinizerHud && !win.scrutinizerHud.isDestroyed()) {
        if (interactive) {
            win.scrutinizerHud.setIgnoreMouseEvents(false);
        } else {
            win.scrutinizerHud.setIgnoreMouseEvents(true, { forward: true });
        }
    }
});

ipcMain.on('toolbar:open-url-dialog', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.toolbarView && w.toolbarView.webContents === event.sender);

    if (win && win.scrutinizerView) {
        const currentURL = win.scrutinizerView.webContents.getURL();

        // Prevent multiple dialogs
        if (win.urlDialog && !win.urlDialog.isDestroyed()) {
            win.urlDialog.focus();
            return;
        }

        const dialog = new BrowserWindow({
            width: 500,
            height: 207,
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

        // Use absolute path for main process
        dialog.loadFile(path.join(__dirname, 'renderer', 'url-dialog.html'));

        dialog.once('ready-to-show', () => {
            dialog.show();
            dialog.webContents.send('set-url', currentURL);
        });

        win.urlDialog = dialog;
    }
});

function createScrutinizerWindow(startUrl) {
    console.log('[Main] Creating new Scrutinizer window (dual-window architecture)', startUrl ? 'with URL: ' + startUrl : '(default URL)');

    const TOOLBAR_HEIGHT = 40;

    // Determine initial bounds based on emulation state
    let initialWidth, initialHeight, initialResizable;

    // Get saved desktop bounds (TEST_WIDTH/TEST_HEIGHT override for golden captures)
    const savedBounds = settingsManager.get('windowBounds') || { width: 1200, height: 900 };
    if (process.env.TEST_WIDTH) savedBounds.width = parseInt(process.env.TEST_WIDTH, 10);
    if (process.env.TEST_HEIGHT) savedBounds.height = parseInt(process.env.TEST_HEIGHT, 10);

    if (currentMobileEmulation) {
        // Resolve profile
        const { DEVICE_PROFILES } = require('./shared/constants.json');
        const profileId = (typeof currentMobileEmulation === 'string') ? currentMobileEmulation : 'iphone_14_pro';
        const profile = DEVICE_PROFILES[profileId];

        if (profile) {
            console.log(`[Main] Initializing window with mobile profile: ${profile.label}`);
            initialWidth = profile.width;
            initialHeight = profile.height + TOOLBAR_HEIGHT;
            initialResizable = false;
        } else {
            // Fallback
            initialWidth = 390;
            initialHeight = 844 + TOOLBAR_HEIGHT;
            initialResizable = false;
        }
    } else {
        initialWidth = savedBounds.width;
        initialHeight = savedBounds.height;
        initialResizable = true;
    }

    // ===== MAIN BROWSER WINDOW =====
    // This window contains only the browser content (via WebContentsView)
    const win = new BrowserWindow({
        width: initialWidth,
        height: initialHeight,
        x: savedBounds.x, // Always use saved position
        y: savedBounds.y,
        resizable: initialResizable,
        show: false, // Wait for ready-to-show to prevent white flash
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
        if (currentMobileEmulation) return; // Don't save bounds during emulation
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

    // Show window when ready (Splash Screen handoff)
    win.once('ready-to-show', () => {
        // slight delay to ensure render process has painted at least one frame
        setTimeout(() => {
            win.show();
            if (splashWindow && !splashWindow.isDestroyed()) {
                splashWindow.close();
                splashWindow = null;
            }
        }, 500);
    });

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
    toolbarView.webContents.once('did-finish-load', () => {
        toolbarView.webContents.send('toolbar:set-version', app.getVersion());
    });

    // Add views to main window
    win.contentView.addChildView(toolbarView);
    win.contentView.addChildView(contentView);



    // Position views — use getContentSize() not getSize() because child view
    // bounds are relative to the content area (excludes title bar on macOS)
    const updateViewBounds = () => {
        const [width, height] = win.getContentSize();
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

    // HUD forwards mouse events by default (click-through to browser below).
    // Interactive overlays (e.g. ComplexityHUD) toggle this off when hovered.
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

        // Initialize Emulation State on Navigation
        if (currentMobileEmulation) {
            // Re-apply to ensure they stick on navigation/reload
            // Pass the actual currentMobileEmulation value (string ID), not just 'true'
            applyMobileEmulation(win, currentMobileEmulation);
        }

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
        // Force structure scan to ensure saliency map updates (Critical for initial load)
        contentView.webContents.send('browser:force-scan');

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
        // Force structure scan to ensure saliency map updates
        contentView.webContents.send('browser:force-scan');
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
            // Initial State for Renderer/HUD
            const enableSaliency = process.env.TEST_ENABLE_SALIENCY_MODULATION !== 'false';
            const initialState = {
                radius: currentRadius || 180,
                blur: currentBlur || 10,
                intensity: currentIntensity !== undefined ? currentIntensity : 1.0,
                enabled: currentEnabled !== undefined ? currentEnabled : true,
                visualMemory: currentVisualMemory || 20,
                comfortMode: settingsManager.get('comfortMode') || false,
                showWelcome: currentShowWelcome !== undefined ? currentShowWelcome : true,
                enableSaliencyModulation: enableSaliency
            };
            // Merge showWelcome into initialState based on isFirstWindow
            initialState.showWelcome = isFirstWindow ? initialState.showWelcome : false;

            console.log('[Main] Sending state to HUD:', JSON.stringify(initialState));
            hudWindow.webContents.send('hud:settings:init-state', initialState);
            hudWindow.webContents.send('settings:init-state', initialState); // Legacy
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

// Debug: Compute Texture Dump — receives raw RGBA8 data from renderer
// Used by capture-compute-texture.js for Tier 2.5 vs 2.75 comparison.
let _pendingComputeTextureResolve = null;
ipcMain.on('debug:compute-texture-data', (event, payload) => {
    if (_pendingComputeTextureResolve) {
        _pendingComputeTextureResolve(payload);
        _pendingComputeTextureResolve = null;
    }
});

// Citation-Ready Export Handler
// Captures the current HUD view and embeds metadata for academic reproducibility
ipcMain.on('export:citation-screenshot', async (event, options = {}) => {
    const { dialog } = require('electron');
    const fs = require('fs');
    const p = require('path');

    try {
        // Find the window that sent this request
        const windows = BrowserWindow.getAllWindows();
        const win = windows.find(w => w.scrutinizerHud &&
            w.scrutinizerHud.webContents === event.sender);

        if (!win || !win.scrutinizerHud) {
            console.error('[CitationExport] No valid HUD window found');
            event.reply('export:citation-screenshot:result', { success: false, error: 'No HUD window' });
            return;
        }

        // Capture the HUD
        const image = await win.scrutinizerHud.capturePage();
        const rawBuffer = image.toPNG();

        // Load citation-export module
        const citationExport = require('./renderer/citation-export');

        // Build metadata from current state
        // Auto-populate pipeline config for reproducibility when not explicitly passed
        const autoPipeline = {
            aestheticMode: currentAestheticMode,
            saliencyResolution: currentSaliencyResolution,
            congestionResolution: currentCongestionResolution,
            congestionMode: currentCongestionMode,
            eccentricityMode: currentEccentricityMode,
            saliencyMapOn: currentSaliencyMapOn,
            structureMapOn: currentStructureMapOn
        };

        const metadata = {
            modeId: options.modeId || currentAestheticMode || 0,
            modeName: options.modeName || null,
            foveaRadius: options.foveaRadius || currentRadius || 180,
            foveaAspect: options.foveaAspect || 1.33,
            degradationStrength: options.degradationStrength || options.intensity || currentIntensity || 0.6,
            caStrength: options.caStrength || 1.0,
            url: options.url || '',
            pipeline: options.pipeline || autoPipeline,
            customFields: options.customFields || {}
        };

        // Embed metadata into PNG
        const annotatedBuffer = await citationExport.embedMetadata(rawBuffer, metadata);

        // Show save dialog
        const defaultName = `scrutinizer_${options.modeName || 'capture'}_${Date.now()}.png`;
        const result = await dialog.showSaveDialog(win, {
            title: 'Export Citation-Ready Screenshot',
            defaultPath: defaultName,
            filters: [
                { name: 'PNG Images', extensions: ['png'] }
            ],
            properties: ['createDirectory']
        });

        if (result.canceled || !result.filePath) {
            event.reply('export:citation-screenshot:result', { success: false, canceled: true });
            return;
        }

        // Save PNG with metadata
        fs.writeFileSync(result.filePath, annotatedBuffer);

        // Generate JSON sidecar
        const sidecarPath = citationExport.generateSidecar(result.filePath, metadata);

        console.log(`[CitationExport] Saved: ${result.filePath}`);
        console.log(`[CitationExport] Sidecar: ${sidecarPath}`);

        // Get citation string for display
        const citation = citationExport.generateCitation({
            modeId: metadata.modeId,
            modeLabel: options.modeName
        });

        event.reply('export:citation-screenshot:result', {
            success: true,
            filePath: result.filePath,
            sidecarPath,
            citation
        });

    } catch (err) {
        console.error('[CitationExport] Error:', err);
        event.reply('export:citation-screenshot:result', { success: false, error: err.message });
    }
});

function createSplashWindow() {
    splashWindow = new BrowserWindow({
        width: 500,
        height: 300,
        transparent: false,
        frame: false,
        alwaysOnTop: true,
        resizable: false,
        movable: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    splashWindow.loadFile('renderer/splash.html');
    splashWindow.center();
    splashWindow.webContents.once('did-finish-load', () => {
        splashWindow.webContents.executeJavaScript(`
            const v = document.getElementById('version');
            if(v) v.innerText = 'v${app.getVersion()}';
        `).catch(e => console.error('Splash version injection failed', e));
    });
}

function createWindow() {
    // Show splash immediately
    createSplashWindow();
    // Initialize settings manager
    settingsManager.init();

    // Load saved settings with defaults
    currentRadius = settingsManager.get('radius');
    currentBlur = settingsManager.get('blur');
    currentIntensity = settingsManager.get('intensity');
    currentVisualMemory = settingsManager.get('visualMemory'); // Load saved visual memory setting
    currentSaliencyResolution = settingsManager.get('saliencyResolution') || 256;
    currentCongestionResolution = settingsManager.get('congestionResolution') || 512;
    currentMobileEmulation = settingsManager.get('mobileEmulation') || false;
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
    const testUrl = process.env.TEST_URL || `file://${require('path').join(__dirname, 'tests', 'visual-test.html')}`;
    const testModes = (process.env.TEST_MODES || '0').split(',').map(m => {
        const val = parseFloat(m.trim());
        return isNaN(val) ? m.trim() : val;
    });
    const testRadius = process.env.TEST_RADIUS ? parseFloat(process.env.TEST_RADIUS) : null;
    const testIntensity = process.env.TEST_INTENSITY ? parseFloat(process.env.TEST_INTENSITY) : null;
    const testFixationX = process.env.TEST_FIXATION_X ? parseFloat(process.env.TEST_FIXATION_X) : null;
    const testFixationY = process.env.TEST_FIXATION_Y ? parseFloat(process.env.TEST_FIXATION_Y) : null;
    const testSelector = process.env.TEST_SELECTOR || null;
    // Gaze trajectory: "startX,startY,endX,endY,durationMs,captureAtNorm"
    // Coordinates are normalized (0-1). captureAtNorm is optional (default 0.6 = capture at 60% of sweep).
    const testTrajectory = process.env.TEST_GAZE_TRAJECTORY || null;
    const testOverlay = process.env.TEST_OVERLAY === 'true';
    const testScanpath = process.env.TEST_SCANPATH || null; // Path to scanpath JSON for gazeplot replay
    const testVisualMemory = process.env.TEST_VISUAL_MEMORY ? parseInt(process.env.TEST_VISUAL_MEMORY) : null; // -1 = infinite
    const testAdserp = process.env.TEST_ADSERP_MODE === 'true'; // AdSERP live replay mode
    const testAdSerpSpeed = process.env.TEST_ADSERP_SPEED ? parseFloat(process.env.TEST_ADSERP_SPEED) : 1.0;
    const screenshotMode = process.env.SCREENSHOT_MODE || 'date';
    const outputFilename = process.env.TEST_OUTPUT_FILENAME || null;
    // Parse mobile emulation: accepts 'true', 'false', or a profile name string like 'iphone_14_pro'
    const testMobileEmulationRaw = process.env.TEST_MOBILE_EMULATION || 'false';
    const testMobileEmulation = testMobileEmulationRaw !== 'false' && testMobileEmulationRaw !== '';

    console.log(`[Main] Running INTEGRATION TEST`);
    console.log(`[Main] URL: ${testUrl}`);
    console.log(`[Main] Modes: ${testModes.join(', ')}`);
    console.log(`[Main] Selector: ${testSelector || 'None'}`);
    console.log(`[Main] Fixation: ${testFixationX}, ${testFixationY}`);
    console.log(`[Main] Mobile Emulation: ${testMobileEmulation ? testMobileEmulationRaw : 'disabled'}`);

    // Reset mobile emulation before createWindow to prevent persisted state from leaking.
    // Then enable only if this specific test requests it.
    const settingsManager = require('./settings-manager');
    settingsManager.init(); // Ensure settings loaded before we modify them
    if (testMobileEmulation) {
        console.log(`[Main] Forcing Mobile Emulation ON for test: ${testMobileEmulationRaw}`);
        // Store the profile name (or true) so createWindow picks it up
        settingsManager.set('mobileEmulation', testMobileEmulationRaw === 'true' ? true : testMobileEmulationRaw);
    } else {
        // Explicitly disable — prevents leaking from a previous session
        settingsManager.set('mobileEmulation', false);
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

        // Revert mobile emulation setting so it doesn't persist to user sessions
        // (The window is already created with the correct dimensions/mode)
        const settingsManager = require('./settings-manager');
        settingsManager.set('mobileEmulation', false);

        console.log(`[Test] Navigating to ${testUrl}...`);
        mainWindow.scrutinizerView.webContents.loadURL(testUrl);

        // Race did-finish-load against a timeout for heavy external pages
        const loadTimeoutMs = parseInt(process.env.TEST_LOAD_TIMEOUT || '15000', 10);
        let loadResolved = false;
        mainWindow.scrutinizerView.webContents.once('did-finish-load', () => onPageReady());
        setTimeout(() => {
            if (!loadResolved) {
                console.log(`[Test] Load timeout (${loadTimeoutMs}ms) — proceeding with current page state`);
                onPageReady();
            }
        }, loadTimeoutMs);

        const onPageReady = async () => {
            if (loadResolved) return;
            loadResolved = true;
            console.log('[Test] Page loaded. Waiting for effects to stabilize...');

            // Scroll to specified Y offset (default 0 = top of page)
            const scrollY = process.env.TEST_SCROLL_Y ? parseInt(process.env.TEST_SCROLL_Y, 10) : 0;
            {
                console.log(`[Test] Scrolling to Y offset: ${scrollY}px...`);
                await mainWindow.scrutinizerView.webContents.executeJavaScript(`
                    window.scrollTo(0, ${scrollY});
                `);
                // Wait for scroll to complete and re-render
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Determine Target Coordinates
            let targetX, targetY;
            const { width, height } = mainWindow.getContentBounds();

            if (testSelector) {
                console.log(`[Test] Locating element: "${testSelector}"...`);
                try {
                    const bounds = await mainWindow.scrutinizerView.webContents.executeJavaScript(`
                        (() => {
                            const el = document.querySelector('${testSelector}');
                            if (!el) return null;
                            const rect = el.getBoundingClientRect();
                            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                        })()
                    `);

                    if (bounds) {
                        targetX = bounds.x + (bounds.width / 2);
                        targetY = bounds.y + (bounds.height / 2);
                        console.log(`[Test] Element found at (${targetX}, ${targetY})`);
                    } else {
                        console.warn(`[Test] Warning: Selector "${testSelector}" not found. Falling back to explicit fixation or center.`);
                    }
                } catch (e) {
                    console.error('[Test] Error locating element:', e);
                }
            }

            // Fallback to explicit coords or center
            if (targetX === undefined || targetY === undefined) {
                targetX = testFixationX !== null ? width * testFixationX : Math.floor(width / 2);
                targetY = testFixationY !== null ? height * testFixationY : Math.floor(height / 2);
            }

            console.log(`[Test] Target Fixation: (${targetX}, ${targetY})`);

            // Wait for 5 seconds for page to settle and effects to render
            setTimeout(async () => {
                console.log('[Test] Positioning fovea...');

                // Convert content-relative coordinates to screen coordinates
                // browser:mousemove handler subtracts window.screenX/Y to get local coords
                const winBounds = mainWindow.getBounds();
                const screenTargetX = winBounds.x + targetX;
                const screenTargetY = winBounds.y + targetY;

                // Simulate mouse move to target (static fixation unless trajectory is set)
                if (!testTrajectory) {
                    mainWindow.scrutinizerHud.webContents.send('browser:mousemove', screenTargetX, screenTargetY, 1.0);
                }

                // Apply overrides if present
                if (testRadius !== null) {
                    mainWindow.scrutinizerHud.webContents.send('menu:set-foveal-radius', testRadius);
                }
                if (testIntensity !== null) {
                    mainWindow.scrutinizerHud.webContents.send('menu:set-intensity', testIntensity);
                }

                // Toggle Overlay if requested
                // Note: We need to implement 'menu:toggle-debug-overlay' in HUD or use existing property
                if (testOverlay) {
                    console.log('[Test] Enabling Overlay...');
                    // Use mode 2 (Parafovea) to show rings
                    mainWindow.scrutinizerHud.webContents.send('menu:set-debug-boundary', 2.0);
                }

                // Wait for fovea/params to update
                setTimeout(async () => {
                    // Iterate through modes
                    for (const mode of testModes) {
                        console.log(`[Test] Switching to Mode: ${mode}...`);

                        // Handle Debug Modes vs Aesthetic Modes
                        if (mode === 'disabled') {
                            // Toggle effects OFF — captures raw page content
                            if (currentEnabled) {
                                ipcMain.emit('toolbar:toggle-fovea', { sender: null });
                            }
                        } else if (mode === 'saliency') {
                            mainWindow.scrutinizerHud.webContents.send('menu:toggle-saliency-map', true);
                        } else if (mode === 'structure') {
                            mainWindow.scrutinizerHud.webContents.send('menu:toggle-structure-map', true);
                        } else if (mode === 'congestion_overlay') {
                            mainWindow.scrutinizerHud.webContents.send('menu:set-show-congestion', 1);
                        } else if (mode === 'congestion_solo') {
                            mainWindow.scrutinizerHud.webContents.send('menu:set-show-congestion', 2);
                        } else {
                            // Numeric Aesthetic Mode
                            mainWindow.scrutinizerHud.webContents.send('menu:set-aesthetic-mode', mode);
                        }

                        // Wait for mode switch to complete config reload before applying overrides
                        await new Promise(resolve => setTimeout(resolve, 500));

                        // Override chromatic pooling AFTER mode switch
                        // (mode switch reloads config from modes.json, overwriting manual toggle)
                        const chromaticPoolingOverride = process.env.TEST_CHROMATIC_POOLING;
                        if (chromaticPoolingOverride !== undefined) {
                            const enabled = chromaticPoolingOverride === 'true';
                            console.log(`[Test] Chromatic pooling override: ${enabled}`);
                            mainWindow.scrutinizerHud.webContents.send('menu:toggle-chromatic-pooling', enabled);
                        }

                        const gaussianBlurOverride = process.env.TEST_GAUSSIAN_BLUR;
                        if (gaussianBlurOverride !== undefined) {
                            const enabled = gaussianBlurOverride === 'true';
                            console.log(`[Test] Gaussian blur mode override: ${enabled}`);
                            mainWindow.scrutinizerHud.webContents.send('menu:toggle-gaussian-blur-mode', enabled);
                        }

                        const dogE2Override = process.env.TEST_DOG_E2;
                        if (dogE2Override !== undefined) {
                            const value = parseFloat(dogE2Override);
                            console.log(`[Test] DoG E2 override: ${value}`);
                            mainWindow.scrutinizerHud.webContents.send('menu:set-dog-e2', value);
                        }

                        const dogOrientedOverride = process.env.TEST_DOG_ORIENTED;
                        if (dogOrientedOverride !== undefined) {
                            const enabled = dogOrientedOverride === 'true';
                            console.log(`[Test] DoG oriented override: ${enabled}`);
                            mainWindow.scrutinizerHud.webContents.send('menu:toggle-dog-oriented', enabled);
                        }

                        const dogOrientBiasOverride = process.env.TEST_DOG_ORIENT_BIAS;
                        if (dogOrientBiasOverride !== undefined) {
                            const value = parseFloat(dogOrientBiasOverride);
                            console.log(`[Test] DoG orient bias override: ${value}`);
                            mainWindow.scrutinizerHud.webContents.send('menu:set-dog-orient-bias', value);
                        }

                        const readingSpanOverride = process.env.TEST_READING_SPAN;
                        if (readingSpanOverride !== undefined) {
                            const enabled = readingSpanOverride === 'true';
                            console.log(`[Test] Reading span override: ${enabled}`);
                            mainWindow.scrutinizerHud.webContents.send('menu:toggle-reading-span', enabled);
                        }

                        const debugLevelOverride = process.env.TEST_DEBUG_LEVEL;
                        if (debugLevelOverride !== undefined) {
                            const level = parseInt(debugLevelOverride, 10);
                            console.log(`[Test] Debug level override: ${level}`);
                            mainWindow.scrutinizerHud.webContents.send('menu:set-debug-level', level);
                        }

                        // Wait for render — 1500ms to ensure IPC settles after mode switch + overrides
                        await new Promise(resolve => setTimeout(resolve, 1500));

                        // === Gaze trajectory animation (reading span test) ===
                        // Captures screenshot MID-SWEEP while velocity is active.
                        // Sets trajectoryImage so the later screenshot section is skipped.
                        let trajectoryImage = null;
                        if (testTrajectory) {
                            const parts = testTrajectory.split(',').map(Number);
                            const [sx, sy, ex, ey, durMs, captureAt] = parts;
                            const duration = durMs || 2000;
                            const captureNorm = isNaN(captureAt) ? 0.6 : captureAt;
                            const { width: tw, height: th } = mainWindow.getContentBounds();
                            const wb = mainWindow.getBounds();
                            const frameMs = 16; // ~60fps
                            const totalFrames = Math.ceil(duration / frameMs);
                            const captureFrame = Math.floor(totalFrames * captureNorm);

                            console.log(`[Test] Running gaze trajectory: (${sx},${sy})→(${ex},${ey}) over ${duration}ms, capture at ${(captureNorm * 100).toFixed(0)}%`);

                            const sendGazePos = (px, py) => {
                                ipcMain.emit('browser:mousemove', { sender: mainWindow.scrutinizerView.webContents }, px, py, 1.0);
                            };

                            // Pre-position at start for 500ms so velocity starts from zero
                            const startScreenX = wb.x + sx * tw;
                            const startScreenY = wb.y + sy * th;
                            sendGazePos(startScreenX, startScreenY);
                            await new Promise(resolve => setTimeout(resolve, 500));

                            // Animate trajectory — capture screenshot at the capture point
                            for (let i = 0; i <= totalFrames; i++) {
                                const t = i / totalFrames;
                                const curX = wb.x + (sx + (ex - sx) * t) * tw;
                                const curY = wb.y + (sy + (ey - sy) * t) * th;
                                sendGazePos(curX, curY);

                                if (i === captureFrame) {
                                    console.log(`[Test] Trajectory capture point: t=${t.toFixed(2)}, pos=(${(sx + (ex - sx) * t).toFixed(3)}, ${(sy + (ey - sy) * t).toFixed(3)})`);
                                    // Wait 2 frames for the GPU to render with current velocity
                                    await new Promise(resolve => setTimeout(resolve, frameMs * 2));
                                    // Keep sending motion so velocity doesn't decay during capture
                                    const nextT = Math.min(1.0, (i + 3) / totalFrames);
                                    const nextX = wb.x + (sx + (ex - sx) * nextT) * tw;
                                    const nextY = wb.y + (sy + (ey - sy) * nextT) * th;
                                    sendGazePos(nextX, nextY);
                                    // Capture NOW while velocity is active
                                    const captureTarget = mainWindow.scrutinizerHud;
                                    trajectoryImage = await captureTarget.capturePage();
                                    console.log(`[Test] Screenshot captured mid-sweep (velocity active)`);
                                    break;
                                }

                                await new Promise(resolve => setTimeout(resolve, frameMs));
                            }
                        }

                        // === Scanpath gazeplot replay (visual memory accumulation) ===
                        // Walks through fixation sequence with visual memory enabled,
                        // dwelling at each fixation for its recorded duration.
                        // Captures screenshot of the FINAL accumulated state.
                        if (testScanpath && !trajectoryImage && !testAdserp) {
                            const fs = require('fs');
                            let scanpathData;
                            try {
                                scanpathData = JSON.parse(fs.readFileSync(testScanpath, 'utf8'));
                            } catch (e) {
                                console.error(`[Test] Failed to load scanpath: ${e.message}`);
                            }

                            if (scanpathData) {
                                // Extract fixations from either demo-sample or direct format
                                const subjectIdx = parseInt(process.env.TEST_SCANPATH_SUBJECT || '0');
                                let fixations;
                                if (scanpathData.scanpaths) {
                                    fixations = scanpathData.scanpaths[subjectIdx].fixations;
                                } else if (scanpathData.fixations) {
                                    fixations = scanpathData.fixations;
                                }

                                if (fixations && fixations.length > 0) {
                                    const displayW = scanpathData.displaySize ? scanpathData.displaySize.width : 1680;
                                    const displayH = scanpathData.displaySize ? scanpathData.displaySize.height : 1050;

                                    // Enable infinite visual memory (-1)
                                    const vmLimit = testVisualMemory !== null ? testVisualMemory : -1;
                                    console.log(`[Test] Scanpath replay: ${fixations.length} fixations, visual memory=${vmLimit}`);
                                    mainWindow.scrutinizerHud.webContents.send('menu:set-visual-memory', vmLimit);
                                    await new Promise(resolve => setTimeout(resolve, 200));

                                    const { width: tw, height: th } = mainWindow.getContentBounds();
                                    const wb = mainWindow.getBounds();

                                    for (let fi = 0; fi < fixations.length; fi++) {
                                        const fix = fixations[fi];
                                        const normX = fix.x / displayW;
                                        const normY = fix.y / displayH;
                                        const screenX = wb.x + normX * tw;
                                        const screenY = wb.y + normY * th;
                                        const duration = fix.tEnd - fix.tStart;

                                        // Rapidly send position to converge GazeModel smoothing.
                                        // GazeModel uses exponential lerp (maskSmoothness=0.4), so multiple
                                        // sends at the same position accelerate convergence and drop velocity.
                                        for (let pulse = 0; pulse < 10; pulse++) {
                                            mainWindow.scrutinizerHud.webContents.send('browser:mousemove', screenX, screenY, 1.0);
                                            await new Promise(resolve => setTimeout(resolve, 16)); // ~60fps
                                        }

                                        // Now dwell — velocity should be near zero, visual memory can register.
                                        // Need dwellTimeThreshold (150ms) of low velocity to record fixation.
                                        const dwellMs = Math.max(500, duration);
                                        await new Promise(resolve => setTimeout(resolve, dwellMs));

                                        // Query visual memory buffer size for debugging
                                        let vmSize = '?';
                                        try {
                                            vmSize = await mainWindow.scrutinizerHud.webContents.executeJavaScript(
                                                `window._scrutinizer && window._scrutinizer.visualMemory ? window._scrutinizer.visualMemory.buffer.length : -1`
                                            );
                                        } catch (e) {}
                                        console.log(`[Test]   Fix ${fi + 1}/${fixations.length}: (${normX.toFixed(3)}, ${normY.toFixed(3)}) ${duration}ms dwell=${dwellMs}ms vm_buf=${vmSize}`);
                                    }

                                    // Extra settle time for final visual memory render
                                    await new Promise(resolve => setTimeout(resolve, 300));

                                    // Debug: dump visual memory state at capture time
                                    try {
                                        const vmDebug = await mainWindow.scrutinizerHud.webContents.executeJavaScript(`
                                            (() => {
                                                const s = window._scrutinizer;
                                                const vm = s && s.visualMemory;
                                                if (!vm) return 'no visual memory';
                                                return JSON.stringify({
                                                    limit: vm.limit,
                                                    isActive: vm.isActive(),
                                                    bufferLen: vm.buffer.length,
                                                    maskSize: vm.maskCanvas ? vm.maskCanvas.width + 'x' + vm.maskCanvas.height : 'none',
                                                    enabled: s.enabled,
                                                    points: vm.buffer.map(p => ({x: Math.round(p.x), y: Math.round(p.y), r: Math.round(p.radius)}))
                                                });
                                            })()
                                        `);
                                        console.log(`[Test] VM state at capture: ${vmDebug}`);
                                    } catch (e) { console.log(`[Test] VM debug error: ${e.message}`); }
                                    console.log(`[Test] Scanpath replay complete — capturing accumulated state`);
                                }
                            }
                        }

                        // ── Full-page tile capture (after gazeplot walk) ──
                        // Scrolls through the page, shifting the VM buffer for each tile,
                        // then captures viewport-sized PNGs that can be stitched later.
                        const fullpageTiles = process.env.TEST_FULLPAGE_TILES ? parseInt(process.env.TEST_FULLPAGE_TILES) : 0;
                        const fullpageDocH = process.env.TEST_FULLPAGE_DOC_HEIGHT ? parseInt(process.env.TEST_FULLPAGE_DOC_HEIGHT) : 0;
                        if (fullpageTiles > 0 && testScanpath) {
                            const { width: tw, height: th } = mainWindow.getContentBounds();
                            console.log(`[Test] Full-page tile capture: ${fullpageTiles} tiles, viewport=${tw}x${th}`);

                            // Save original VM buffer positions (page-space, stored as screen-space during walk)
                            const origBuffer = await mainWindow.scrutinizerHud.webContents.executeJavaScript(`
                                (() => {
                                    const vm = window._scrutinizer && window._scrutinizer.visualMemory;
                                    if (!vm) return null;
                                    return vm.buffer.map(p => ({ x: p.x, y: p.y, radius: p.radius }));
                                })()
                            `);

                            if (origBuffer && origBuffer.length > 0) {
                                console.log(`[Test] VM buffer: ${origBuffer.length} points`);

                                // Load fixation data once (includes pageY for tile mapping)
                                const fs2 = require('fs');
                                const spData = JSON.parse(fs2.readFileSync(testScanpath, 'utf8'));
                                const fixations = spData.fixations || [];

                                // Disable sticky/fixed headers in the SERP so they don't
                                // repeat at the top of every tile when stitched
                                await mainWindow.scrutinizerView.webContents.executeJavaScript(`
                                    document.querySelectorAll('*').forEach(el => {
                                        const cs = getComputedStyle(el);
                                        if (cs.position === 'fixed' || cs.position === 'sticky') {
                                            el.style.position = 'absolute';
                                        }
                                    });
                                `);
                                await new Promise(r => setTimeout(r, 200));

                                for (let tile = 0; tile < fullpageTiles; tile++) {
                                    const scrollY = tile * th;

                                    // Scroll the content view
                                    await mainWindow.scrutinizerView.webContents.executeJavaScript(
                                        `window.scrollTo(0, ${scrollY})`
                                    );
                                    await new Promise(r => setTimeout(r, 300));

                                    // Rebuild VM buffer using page-space Y coordinates.
                                    // f.pageY is the original page-space position (before scroll correction).
                                    // For this tile at scrollY, convert to viewport position:
                                    //   viewportY = (pageY - scrollY) scaled to canvas
                                    const stimW = spData.meta.stimulusWidth || 1280;
                                    const stimH = spData.meta.stimulusHeight || 1024;
                                    const scaleX = tw / stimW;
                                    const scaleY = th / stimH;
                                    const shiftedPoints = fixations
                                        .filter(f => f.pageY !== undefined) // only AdSERP fixations have pageY
                                        .map(f => ({
                                            x: f.x * scaleX,
                                            y: (f.pageY - scrollY) * scaleY,
                                            radius: 45 * scaleX
                                        }))
                                        .filter(p => p.y > -100 && p.y < th + 100);

                                    await mainWindow.scrutinizerHud.webContents.executeJavaScript(`
                                        (() => {
                                            const vm = window._scrutinizer && window._scrutinizer.visualMemory;
                                            if (!vm) return;
                                            vm.buffer = ${JSON.stringify(shiftedPoints)};
                                            vm.maskDirty = true;
                                        })()
                                    `);

                                    await new Promise(r => setTimeout(r, 500)); // let render settle

                                    // Capture tile
                                    const tileImage = await mainWindow.scrutinizerHud.capturePage();
                                    const tileBuffer = tileImage.toPNG();
                                    const p = require('path');
                                    const packageVersion = require('./package.json').version.replace(/\.\d+$/, '');
                                    const capDir = p.join(__dirname, 'tests', 'golden-captures', `v${packageVersion}`);
                                    if (!fs2.existsSync(capDir)) fs2.mkdirSync(capDir, { recursive: true });
                                    const tileFile = outputFilename.replace('.png', `_tile${tile}.png`);
                                    fs2.writeFileSync(p.join(capDir, tileFile), tileBuffer);
                                    console.log(`[Test] Tile ${tile}/${fullpageTiles}: scroll=${scrollY} points=${shiftedPoints.length} → ${tileFile}`);
                                }

                                // Restore original VM buffer
                                await mainWindow.scrutinizerHud.webContents.executeJavaScript(`
                                    (() => {
                                        const vm = window._scrutinizer && window._scrutinizer.visualMemory;
                                        if (!vm) return;
                                        vm.buffer = ${JSON.stringify(origBuffer)};
                                        vm.maskDirty = true;
                                    })()
                                `);
                            }
                        }

                        // ── AdSERP live replay: load scanpath into renderer, start playback ──
                        if (testAdserp && testScanpath) {
                            const fs = require('fs');
                            let adSerpData;
                            try {
                                adSerpData = JSON.parse(fs.readFileSync(testScanpath, 'utf8'));
                            } catch (e) {
                                console.error(`[Test] Failed to load AdSERP scanpath: ${e.message}`);
                            }

                            if (adSerpData && adSerpData.fixations) {
                                console.log(`[Test] AdSERP replay: ${adSerpData.fixations.length} fixations, ` +
                                    `${(adSerpData.mouseTimeline || []).length} mouse events, ` +
                                    `${(adSerpData.scrollTimeline || []).length} scroll events, ` +
                                    `speed=${testAdSerpSpeed}x`);

                                // Load scanpath data into renderer's ScanpathPlayer
                                await mainWindow.scrutinizerHud.webContents.executeJavaScript(`
                                    (() => {
                                        const s = window._scrutinizer;
                                        if (!s) return 'no scrutinizer';
                                        s.loadScanpath(${JSON.stringify(adSerpData)});

                                        // Wire scroll callback to scroll the content view
                                        if (s.gazeModel.scrollTimeline) {
                                            s.gazeModel.onScroll = (scrollY) => {
                                                window._adSerpScrollY = scrollY;
                                            };
                                        }

                                        s.gazeModel.setSpeed(${testAdSerpSpeed});
                                        s.gazeModel.play();
                                        return 'playing';
                                    })()
                                `);

                                // Poll scroll position and sync content view
                                const scrollTimeline = adSerpData.scrollTimeline || [];
                                const totalDuration = adSerpData.fixations.length > 0
                                    ? adSerpData.fixations[adSerpData.fixations.length - 1].tEnd
                                    : 0;
                                const replayDuration = totalDuration / testAdSerpSpeed;

                                console.log(`[Test] AdSERP replay duration: ${(replayDuration / 1000).toFixed(1)}s`);

                                // Scroll sync loop — polls renderer for current scroll target
                                const scrollSyncInterval = setInterval(async () => {
                                    try {
                                        const scrollY = await mainWindow.scrutinizerHud.webContents.executeJavaScript(
                                            `window._adSerpScrollY || 0`
                                        );
                                        if (isFinite(scrollY)) {
                                            await mainWindow.scrutinizerView.webContents.executeJavaScript(
                                                `window.scrollTo(0, ${Math.round(scrollY)})`
                                            );
                                        }
                                    } catch (e) { /* window may have closed */ }
                                }, 50); // 20Hz scroll sync

                                // Wait for replay to complete
                                await new Promise((resolve) => {
                                    let pollCount = 0;
                                    const checkComplete = setInterval(async () => {
                                        try {
                                            const info = await mainWindow.scrutinizerHud.webContents.executeJavaScript(`
                                                (() => {
                                                    const s = window._scrutinizer;
                                                    if (!s || !s.gazeModel) return 'no-scrutinizer';
                                                    const gm = s.gazeModel;
                                                    return gm.state + '|t=' + Math.round(gm.playbackTime || 0)
                                                        + '|mouse=' + (gm.mousePlayer ? 'yes' : 'no');
                                                })()
                                            `);
                                            pollCount++;
                                            if (pollCount <= 5 || pollCount % 10 === 0) {
                                                console.log(`[Test] AdSERP poll #${pollCount}: ${info}`);
                                            }
                                            if (typeof info === 'string' && info.startsWith('complete')) {
                                                clearInterval(checkComplete);
                                                clearInterval(scrollSyncInterval);
                                                resolve();
                                            }
                                        } catch (e) {
                                            clearInterval(checkComplete);
                                            clearInterval(scrollSyncInterval);
                                            resolve();
                                        }
                                    }, 200);

                                    // Safety timeout: 2x expected duration + 10s buffer
                                    setTimeout(() => {
                                        clearInterval(checkComplete);
                                        clearInterval(scrollSyncInterval);
                                        console.log('[Test] AdSERP replay timeout — capturing current state');
                                        resolve();
                                    }, replayDuration + 10000);
                                });

                                console.log('[Test] AdSERP replay complete');
                            }
                        }

                        // Wait for congestion map if requested (Bouma-scaled gate needs MIP data)
                        if (process.env.TEST_WAIT_CONGESTION === 'true' && mode !== 'bypass' && mode !== 'disabled') {
                            console.log('[Test] Waiting for congestion map...');
                            const congestionTimeout = 15000; // 15s max
                            const pollInterval = 500;
                            const startWait = Date.now();
                            let congestionReady = false;
                            while (Date.now() - startWait < congestionTimeout) {
                                try {
                                    congestionReady = await mainWindow.scrutinizerHud.webContents.executeJavaScript(`
                                        (() => {
                                            const s = window._scrutinizer;
                                            return s && s.renderer && s.renderer._hasCongestionMapData === true;
                                        })()
                                    `);
                                } catch (e) { /* ignore */ }
                                if (congestionReady) break;
                                await new Promise(resolve => setTimeout(resolve, pollInterval));
                            }
                            if (congestionReady) {
                                console.log(`[Test] Congestion map ready (${Date.now() - startWait}ms)`);
                                // Extra render frames to let Bouma-scaled sampling use the new MIP data
                                await new Promise(resolve => setTimeout(resolve, 500));
                            } else {
                                console.warn(`[Test] Congestion map not ready after ${congestionTimeout}ms — capturing anyway`);
                            }
                        }

                        console.log(`[Test] Capturing screenshot for Mode ${mode}...`);
                        try {
                            // Use mid-sweep capture if trajectory already grabbed one
                            let image;
                            if (trajectoryImage) {
                                image = trajectoryImage;
                                console.log(`[Test] Using mid-sweep trajectory capture`);
                            } else {
                                // When disabled, capture raw content view (not the empty HUD overlay)
                                const captureTarget = (mode === 'disabled' && mainWindow.scrutinizerView)
                                    ? mainWindow.scrutinizerView.webContents
                                    : mainWindow.scrutinizerHud;
                                image = await captureTarget.capturePage();
                            }
                            let buffer = image.toPNG();

                            // Reuse save logic
                            const fs = require('fs');
                            const p = require('path');
                            // Dynamic path based on package version (strip patch: 1.9.1 → 1.9)
                            const packageVersion = require('./package.json').version.replace(/\.\d+$/, '');
                            const screenshotsDir = p.join(__dirname, 'tests', 'golden-captures', `v${packageVersion}`);
                            if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

                            let filename;
                            if (outputFilename) {
                                filename = outputFilename; // Use precise filename if provided
                            } else {
                                // Extract hostname for filename
                                let hostname = 'unknown';
                                try {
                                    hostname = new URL(testUrl).hostname.replace(/[^a-z0-9]/gi, '_');
                                } catch (e) { }

                                const baseName = `site_${hostname}_mode_${mode}`;

                                if (screenshotMode === 'update') {
                                    filename = `${baseName}.png`;
                                } else {
                                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                                    filename = `${baseName}_${timestamp}.png`;
                                }
                            }

                            // Embed citation metadata into PNG
                            try {
                                const citationExport = require('./renderer/citation-export');
                                buffer = await citationExport.embedMetadata(buffer, {
                                    modeId: typeof mode === 'number' ? mode : 0,
                                    modeName: String(mode),
                                    foveaRadius: testRadius || currentRadius || 180,
                                    degradationStrength: testIntensity || currentIntensity || 0.6,
                                    url: testUrl,
                                    pipeline: {
                                        aestheticMode: typeof mode === 'number' ? mode : currentAestheticMode,
                                        saliencyResolution: currentSaliencyResolution,
                                        congestionResolution: currentCongestionResolution,
                                        congestionMode: currentCongestionMode
                                    }
                                });
                                console.log(`[Test] Embedded citation metadata`);
                            } catch (metaErr) {
                                console.warn(`[Test] Could not embed metadata: ${metaErr.message}`);
                            }

                            const filePath = p.join(screenshotsDir, filename);
                            fs.writeFileSync(filePath, buffer);
                            console.log(`[Test] Saved screenshot: ${filePath}`);
                        } catch (err) {
                            console.error('❌ TEST FAILED during capture:', err);
                            app.exit(1);
                        }

                        // Cleanup Debug Modes
                        if (mode === 'disabled') {
                            // Re-enable effects for subsequent modes
                            if (!currentEnabled) {
                                ipcMain.emit('toolbar:toggle-fovea', { sender: null });
                            }
                        } else if (mode === 'saliency') {
                            mainWindow.scrutinizerHud.webContents.send('menu:toggle-saliency-map', false);
                        } else if (mode === 'structure') {
                            mainWindow.scrutinizerHud.webContents.send('menu:toggle-structure-map', false);
                        } else if (mode === 'congestion_overlay' || mode === 'congestion_solo') {
                            mainWindow.scrutinizerHud.webContents.send('menu:set-show-congestion', 0);
                        }
                    }

                    console.log('✅ INTEGRATION TEST PASSED');
                    app.exit(0);

                }, 1000);
            }, 5000);
        };
    }
}


/**
 * Batch capture mode: reads TEST_BATCH_FILE JSON, iterates shots in a single Electron instance.
 * Each shot spec has: { filename, url, mode, fixationX, fixationY, selector, overlay, radius,
 *                       width, height, mobile, outputDir, chromaticPooling? }
 * Shots in a batch share URL+viewport (grouped by capture-runner), so we navigate once
 * and iterate through modes/fixations/filenames.
 */
function runBatchCapture() {
    const batchFile = process.env.TEST_BATCH_FILE;
    const fs = require('fs');
    const p = require('path');

    let shots;
    try {
        shots = JSON.parse(fs.readFileSync(batchFile, 'utf-8'));
    } catch (e) {
        console.error(`[Batch] Failed to read batch file: ${e.message}`);
        app.exit(1);
        return;
    }

    console.log(`[Batch] Loaded ${shots.length} shots from ${batchFile}`);

    // Use first shot's shared properties for window setup
    const firstShot = shots[0];
    const testMobileEmulationRaw = firstShot.mobile || 'false';
    const testMobileEmulation = testMobileEmulationRaw !== 'false' && testMobileEmulationRaw !== '';

    const settingsManager = require('./settings-manager');
    settingsManager.init();
    if (testMobileEmulation) {
        settingsManager.set('mobileEmulation', testMobileEmulationRaw === 'true' ? true : testMobileEmulationRaw);
    } else {
        settingsManager.set('mobileEmulation', false);
    }

    createWindow();

    const checkWindow = setInterval(() => {
        if (mainWindow && mainWindow.scrutinizerView && mainWindow.scrutinizerHud) {
            clearInterval(checkWindow);
            startBatch();
        }
    }, 100);

    function startBatch() {
        settingsManager.set('mobileEmulation', false);

        // Navigate to the shared URL (all shots in batch have the same URL)
        const testUrl = firstShot.url;
        console.log(`[Batch] Navigating to ${testUrl}...`);
        mainWindow.scrutinizerView.webContents.loadURL(testUrl);

        const loadTimeoutMs = parseInt(process.env.TEST_LOAD_TIMEOUT || '15000', 10);
        let loadResolved = false;
        mainWindow.scrutinizerView.webContents.once('did-finish-load', () => onPageReady());
        setTimeout(() => {
            if (!loadResolved) {
                console.log(`[Batch] Load timeout (${loadTimeoutMs}ms) — proceeding`);
                onPageReady();
            }
        }, loadTimeoutMs);

        const onPageReady = async () => {
            if (loadResolved) return;
            loadResolved = true;
            console.log('[Batch] Page loaded. Starting shot sequence...');

            // Reset zoom to 100% — captures must be at consistent zoom regardless
            // of the user's interactive zoom level. Without this, text density varies
            // between capture sessions, invalidating Brown metamer comparisons.
            mainWindow.scrutinizerView.webContents.setZoomFactor(1.0);
            console.log('[Batch] Zoom reset to 1.0');

            // Handle scroll if specified
            const scrollY = firstShot.scrollY || 0;
            if (scrollY > 0) {
                await mainWindow.scrutinizerView.webContents.executeJavaScript(`window.scrollTo(0, ${scrollY});`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Wait for initial render
            await new Promise(resolve => setTimeout(resolve, 3000));

            const { width, height } = mainWindow.getContentBounds();
            const winBounds = mainWindow.getBounds();

            // Determine output directory — use per-shot outputDir or version-based default
            const packageVersion = require('./package.json').version.replace(/\.\d+$/, '');
            const defaultScreenshotsDir = p.join(__dirname, 'tests', 'golden-captures', `v${packageVersion}`);

            for (let i = 0; i < shots.length; i++) {
                const shot = shots[i];
                console.log(`[Batch] Shot ${i + 1}/${shots.length}: ${shot.filename} (mode=${shot.mode})`);

                // Position fixation for this shot
                let targetX, targetY;
                if (shot.selector) {
                    try {
                        const bounds = await mainWindow.scrutinizerView.webContents.executeJavaScript(`
                            (() => {
                                const el = document.querySelector('${shot.selector}');
                                if (!el) return null;
                                const rect = el.getBoundingClientRect();
                                return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                            })()
                        `);
                        if (bounds) {
                            targetX = bounds.x + (bounds.width / 2);
                            targetY = bounds.y + (bounds.height / 2);
                        }
                    } catch (e) { /* fall through */ }
                }
                if (targetX === undefined) {
                    targetX = shot.fixationX != null ? width * shot.fixationX : width / 2;
                    targetY = shot.fixationY != null ? height * shot.fixationY : height / 2;
                }

                const screenTargetX = winBounds.x + targetX;
                const screenTargetY = winBounds.y + targetY;
                mainWindow.scrutinizerHud.webContents.send('browser:mousemove', screenTargetX, screenTargetY, 1.0);

                // Apply radius override
                if (shot.radius) {
                    mainWindow.scrutinizerHud.webContents.send('menu:set-foveal-radius', parseFloat(shot.radius));
                }

                // Set mode
                const mode = shot.mode;
                if (mode === 'saliency') {
                    mainWindow.scrutinizerHud.webContents.send('menu:toggle-saliency-map', true);
                } else if (mode === 'structure') {
                    mainWindow.scrutinizerHud.webContents.send('menu:toggle-structure-map', true);
                } else if (mode === 'congestion_overlay') {
                    mainWindow.scrutinizerHud.webContents.send('menu:set-show-congestion', 1);
                } else if (mode === 'congestion_solo') {
                    mainWindow.scrutinizerHud.webContents.send('menu:set-show-congestion', 2);
                } else {
                    const modeNum = parseFloat(mode);
                    mainWindow.scrutinizerHud.webContents.send('menu:set-aesthetic-mode', isNaN(modeNum) ? mode : modeNum);
                }

                await new Promise(resolve => setTimeout(resolve, 500));

                // Apply per-shot overrides after mode switch
                if (shot.chromaticPooling !== undefined) {
                    mainWindow.scrutinizerHud.webContents.send('menu:toggle-chromatic-pooling', shot.chromaticPooling);
                }

                // Toggle overlay if requested
                if (shot.overlay) {
                    mainWindow.scrutinizerHud.webContents.send('menu:set-debug-boundary', 2.0);
                }

                // Wait for render
                await new Promise(resolve => setTimeout(resolve, 1500));

                // Capture
                try {
                    const captureTarget = mainWindow.scrutinizerHud;
                    const image = await captureTarget.capturePage();
                    let buffer = image.toPNG();

                    // Embed citation metadata
                    try {
                        const citationExport = require('./renderer/citation-export');
                        buffer = await citationExport.embedMetadata(buffer, {
                            modeId: typeof mode === 'number' ? mode : 0,
                            modeName: String(mode),
                            foveaRadius: parseFloat(shot.radius) || currentRadius || 180,
                            url: testUrl,
                            pipeline: { aestheticMode: parseFloat(mode) || currentAestheticMode }
                        });
                    } catch (metaErr) { /* non-fatal */ }

                    const screenshotsDir = shot.outputDir || defaultScreenshotsDir;
                    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

                    const filePath = p.join(screenshotsDir, shot.filename);
                    fs.writeFileSync(filePath, buffer);
                    console.log(`[Batch] ✓ ${shot.filename}`);

                    // Optional: dump raw compute texture alongside screenshot
                    if (shot.captureCompute) {
                        try {
                            const computePromise = new Promise((resolve) => {
                                _pendingComputeTextureResolve = resolve;
                                setTimeout(() => {
                                    if (_pendingComputeTextureResolve === resolve) {
                                        _pendingComputeTextureResolve = null;
                                        resolve({ error: 'timeout' });
                                    }
                                }, 5000);
                            });
                            // Wait for compute pipeline to stabilize before requesting readback
                            await new Promise(r => setTimeout(r, 1000));
                            mainWindow.scrutinizerHud.webContents.send('debug:dump-compute-texture');
                            let result = await computePromise;
                            // Retry once if readback returned null (pipeline may not have dispatched yet)
                            if (result.error === 'readback returned null') {
                                await new Promise(r => setTimeout(r, 2000));
                                const retryPromise = new Promise((resolve) => {
                                    _pendingComputeTextureResolve = resolve;
                                    setTimeout(() => { _pendingComputeTextureResolve = null; resolve({ error: 'timeout' }); }, 5000);
                                });
                                mainWindow.scrutinizerHud.webContents.send('debug:dump-compute-texture');
                                result = await retryPromise;
                            }
                            if (result.error) {
                                console.warn(`[Batch] Compute texture: ${result.error}`);
                            } else {
                                const computeFile = p.join(screenshotsDir,
                                    shot.filename.replace('.png', '_compute.raw'));
                                // Write raw RGBA8 + dimensions header (8 bytes: u32 width, u32 height)
                                const header = Buffer.alloc(8);
                                header.writeUInt32LE(result.width, 0);
                                header.writeUInt32LE(result.height, 4);
                                fs.writeFileSync(computeFile, Buffer.concat([header, Buffer.from(result.data)]));
                                console.log(`[Batch] ✓ ${shot.filename.replace('.png', '_compute.raw')} (${result.width}x${result.height}, tier=${result.tier})`);
                            }
                        } catch (computeErr) {
                            console.warn(`[Batch] Compute texture failed: ${computeErr.message}`);
                        }
                    }
                } catch (err) {
                    console.error(`[Batch] ✗ ${shot.filename}: ${err.message}`);
                }

                // Clean up mode state for next shot
                if (mode === 'saliency') {
                    mainWindow.scrutinizerHud.webContents.send('menu:toggle-saliency-map', false);
                } else if (mode === 'structure') {
                    mainWindow.scrutinizerHud.webContents.send('menu:toggle-structure-map', false);
                } else if (mode === 'congestion_overlay' || mode === 'congestion_solo') {
                    mainWindow.scrutinizerHud.webContents.send('menu:set-show-congestion', 0);
                }
                if (shot.overlay) {
                    mainWindow.scrutinizerHud.webContents.send('menu:set-debug-boundary', 0);
                }
            }

            console.log(`[Batch] ✅ All ${shots.length} shots complete`);
            app.exit(0);
        };
    }
}


// Register global shortcut for Open URL
// Register global shortcut for Open URL
app.whenReady().then(() => {
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

// Tier 1 keyboard shortcuts — visualization toggles & cycling modes
app.whenReady().then(() => {
    // Ctrl+Shift+S — Toggle Saliency Map
    globalShortcut.register('Ctrl+Shift+S', () => {
        currentSaliencyMapOn = !currentSaliencyMapOn;
        sendToOverlays('menu:toggle-saliency-map', currentSaliencyMapOn);
        rebuildMenu();
        console.log(`[Shortcut] Saliency Map: ${currentSaliencyMapOn ? 'ON' : 'OFF'}`);
    });

    // Ctrl+Shift+D — Toggle Structure Map (DOM)
    globalShortcut.register('Ctrl+Shift+D', () => {
        currentStructureMapOn = !currentStructureMapOn;
        sendToOverlays('menu:toggle-structure-map', currentStructureMapOn);
        rebuildMenu();
        console.log(`[Shortcut] Structure Map: ${currentStructureMapOn ? 'ON' : 'OFF'}`);
    });

    // Ctrl+Shift+C — Cycle Congestion Report (Off → Stats → Heatmap → Saliency vs Congestion → Off)
    globalShortcut.register('Ctrl+Shift+C', () => {
        currentCongestionMode = (currentCongestionMode + 1) % 4;
        sendToOverlays('menu:set-show-congestion', currentCongestionMode);
        rebuildMenu();
        const labels = ['Off', 'Stats', 'Heatmap', 'Saliency vs Congestion'];
        console.log(`[Shortcut] Congestion Report: ${labels[currentCongestionMode]}`);
    });

    // Ctrl+Shift+B — Cycle Eccentricity Overlay (Off → Fovea → +Para → +Periphery → Off)
    globalShortcut.register('Ctrl+Shift+B', () => {
        currentEccentricityMode = (currentEccentricityMode + 1) % 4;
        sendToOverlays('menu:set-debug-boundary', currentEccentricityMode);
        rebuildMenu();
        const labels = ['Off', 'Fovea Only', 'Fovea + Parafovea', 'Fovea + Parafovea + Periphery'];
        console.log(`[Shortcut] Eccentricity: ${labels[currentEccentricityMode]}`);
    });
});

// === Auto-Updater Setup ===

function setupAutoUpdater() {
    if (!autoUpdater) return;
    if (!app.isPackaged) return;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = require('electron-log');
    autoUpdater.logger.transports.file.level = 'info';

    autoUpdater.on('checking-for-update', () => {
        console.log('[Updater] Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
        console.log('[Updater] Update available:', info?.version || 'unknown');
    });

    autoUpdater.on('update-not-available', () => {
        console.log('[Updater] No updates available.');
        if (manualUpdateCheck) {
            const { dialog } = require('electron');
            dialog.showMessageBox({
                type: 'info',
                title: 'No Updates Available',
                message: `Scrutinizer v${app.getVersion()} is up to date.`,
                buttons: ['OK']
            });
        }
    });

    autoUpdater.on('error', (err) => {
        console.error('[Updater] Error:', err);
        if (manualUpdateCheck) {
            const { dialog } = require('electron');
            dialog.showErrorBox('Update Error', err.message || String(err));
        }
    });

    autoUpdater.on('update-downloaded', (info) => {
        const { dialog } = require('electron');
        const version = info?.version || 'the latest';
        dialog.showMessageBox({
            type: 'info',
            buttons: ['Restart Now', 'Later'],
            defaultId: 0,
            cancelId: 1,
            title: 'Update Ready',
            message: `Scrutinizer ${version} has been downloaded and is ready to install.`
        }).then(({ response }) => {
            if (response === 0) {
                autoUpdater.quitAndInstall();
            }
        }).catch((err) => {
            console.error('[Updater] Failed to show update dialog:', err);
        });
    });
}

function checkForAppUpdates({ manual = false } = {}) {
    const currentVersion = app.getVersion();

    // Auto-updater not bundled or running in dev
    if (!autoUpdater || !app.isPackaged) {
        if (manual) {
            const { dialog, shell } = require('electron');
            dialog.showMessageBox({
                type: 'info',
                title: 'Check for Updates',
                message: `Scrutinizer v${currentVersion}`,
                detail: 'Auto-update is disabled in development mode. Visit GitHub for the latest release.',
                buttons: ['Download Page', 'OK'],
                defaultId: 0,
                cancelId: 1
            }).then(({ response }) => {
                if (response === 0) {
                    shell.openExternal('https://github.com/andyed/scrutinizer2025/releases/latest');
                }
            });
        }
        return;
    }

    if (updateCheckInFlight) return;

    updateCheckInFlight = true;
    manualUpdateCheck = manual;

    if (manual) {
        console.log('[Updater] Manual update check initiated...');
    }

    autoUpdater.checkForUpdates().catch((err) => {
        console.error('[Updater] checkForUpdates failed:', err);
        if (manualUpdateCheck) {
            const { dialog } = require('electron');
            dialog.showErrorBox('Update Check Failed', err.message || String(err));
        }
    }).finally(() => {
        updateCheckInFlight = false;
        manualUpdateCheck = false;
    });
}

// App Startup Logic
app.whenReady().then(() => {
    if (process.env.TEST_MODE === 'true' && process.env.TEST_BATCH_FILE) {
        runBatchCapture();
    } else if (process.env.TEST_MODE === 'true') {
        runIntegrationTest();
    } else {
        createWindow();
    }

    // Initialize auto-updater with persistent event handlers
    setupAutoUpdater();

    // Silent update check 10s after startup
    setTimeout(() => checkForAppUpdates({ manual: false }), 10000);
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

// Cache Busting (Added per user request)
app.whenReady().then(() => {
    if (session && session.defaultSession) {
        session.defaultSession.clearCache()
            .then(() => console.log('[Main] Cache cleared successfully!'))
            .catch((err) => console.error('[Main] Failed to clear cache:', err));
    }
});

// Handle "New Window" menu action
app.on('create-new-window', () => {
    createScrutinizerWindow();
});

// Handle "Check for Updates" menu action (delegated from menu-template)
app.on('check-for-updates', () => {
    checkForAppUpdates({ manual: true });
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
