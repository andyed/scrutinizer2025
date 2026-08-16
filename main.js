const { app, BrowserWindow, Menu, ipcMain, WebContentsView, globalShortcut, session } = require('electron');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { buildMenuTemplate, RADIUS_OPTIONS } = require('./menu-template');
const settingsManager = require('./settings-manager');
const { CALIBRATION_URL } = require('./renderer/config');
const modesRegistry = require('./shared/modes.json');
const { STUDY_SCHEME, parseStudyDeepLink } = require('./shared/study-deep-link');
const { buildStudyRuntimeState } = require('./shared/study-runtime-state');
const { resolveTaskRuntimeState, buildSessionSummary, summaryFileName } = require('./shared/study-session');
const {
    buildEnvelope,
    stimulusFileName
} = require('./shared/session-capture');
const { writeSessionDirectory, pngDimensions } = require('./shared/session-directory-writer');
const {
    compareStimuli,
    closeStimulusDiffWorker
} = require('./shared/stimulus-diff');
const { rowsToScanpathData } = require('./renderer/instrumentation/event-capture');
const inputGating = require('./shared/input-gating');

// Session interstitial: the content view has no node integration, so the
// bundled screen signals "Begin" by navigating to a sentinel URL that
// will-navigate intercepts and cancels. The .invalid TLD never resolves.
const STUDY_BEGIN_URL = 'https://begin.study.scrutinizer.invalid/';
const STUDY_INTERSTITIAL_URL = require('url').pathToFileURL(path.join(__dirname, 'renderer', 'study-interstitial.html')).toString();
const STUDY_CAPTURE_WORLD_ID = 1004;
const STUDY_CAPTURE_GLOBAL = '__scrutinizerStudyEventCapture';
const STUDY_CAPTURE_QUIET_MS = 500;
const STUDY_CAPTURE_SETTLE_MAX_MS = 2000;
const STUDY_CAPTURE_SCREENSHOT_TIMEOUT_MS = 5000;
const STUDY_STIMULUS_DIFF_TIMEOUT_MS = 2500;
const BROWSE_TOOLBAR_HEIGHT = 40;
const STUDY_TOOLBAR_HEIGHT = 104;

const STUDY_MODE_IDS = Object.values(modesRegistry.modes).map((mode) => mode.id);
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
let currentComfortMode;
let currentShowWelcome;
let currentStartPage;


let currentVisualMemory;
let currentMobileEmulation;
let currentAestheticMode = 12; // FOVI Cortical Grid (Blauch) — isotropic cortical sampling, the v2.6.0 scientific anchor. Restored as default (was 14/Pyramid Mongrel); see docs/assessments/2026-06-05-post-isotropic-release-audit.md (B1).

// Tier 1 keyboard shortcut state (cycling modes)
let currentCongestionMode = 0;   // 0=Off, 1=Stats, 2=Heatmap, 3=Saliency vs Congestion
let currentEccentricityMode = 0; // 0=Off, 1=Fovea, 2=+Parafovea, 3=+Periphery
let currentSaliencyMapOn = false;
let currentStructureMapOn = false;
let currentSaliencyResolution = 256; // 256, 512, or 1024
let currentCongestionResolution = 512; // 256, 512, 1024, or 2048

let mainWindow;
let splashWindow;
let pendingStudyLaunch = null;
let pendingStudyError = null;
let activeStudy = null;

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
    if (activeStudy && channel.startsWith('menu:')) return;
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
        win.webContents.send(channel, ...args);
    }
}

const sendToOverlays = (channel, ...args) => {
    if (activeStudy && channel.startsWith('menu:')) return;
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

function isStudyWindow(win) {
    return Boolean(win && !win.isDestroyed() && (win.studyMode === true || (activeStudy && activeStudy.windowId === win.id)));
}

function toolbarHeightForWindow(win) {
    return isStudyWindow(win) ? STUDY_TOOLBAR_HEIGHT : BROWSE_TOOLBAR_HEIGHT;
}

function activeHistoryIndex(webContents) {
    const history = webContents && webContents.navigationHistory;
    if (!history || typeof history.getActiveIndex !== 'function') return null;
    const index = history.getActiveIndex();
    return Number.isInteger(index) ? index : null;
}

function studyTaskHistoryActive(win) {
    if (!isStudyWindow(win) || !activeStudy || activeStudy.windowId !== win.id) return false;
    return activeStudy.kind !== 'session' || activeStudy.phase === 'task';
}

function canNavigateHistory(win, direction) {
    if (!win || win.isDestroyed() || !win.scrutinizerView ||
        win.scrutinizerView.webContents.isDestroyed()) return false;
    const wc = win.scrutinizerView.webContents;
    if (!isStudyWindow(win)) {
        return direction === 'back' ? wc.canGoBack() : wc.canGoForward();
    }
    if (!studyTaskHistoryActive(win)) return false;
    if (direction === 'forward') return wc.canGoForward();
    const activeIndex = activeHistoryIndex(wc);
    return Number.isInteger(activeIndex) && Number.isInteger(win.studyHistoryFloorIndex) &&
        activeIndex > win.studyHistoryFloorIndex;
}

function navigateHistory(win, direction) {
    if (!canNavigateHistory(win, direction)) return false;
    const wc = win.scrutinizerView.webContents;
    const activeIndex = activeHistoryIndex(wc);
    if (Number.isInteger(activeIndex) && typeof wc.goToIndex === 'function') {
        wc.goToIndex(activeIndex + (direction === 'back' ? -1 : 1));
    } else if (direction === 'back') {
        wc.goBack();
    } else {
        wc.goForward();
    }
    return true;
}

function toolbarNavigationState(win) {
    return {
        canGoBack: canNavigateHistory(win, 'back'),
        canGoForward: canNavigateHistory(win, 'forward')
    };
}

function armStudyHistoryFloor(win) {
    if (!win || win.isDestroyed() || !win.scrutinizerView) return;
    win.studyHistoryFloorIndex = null;
    win.studyHistoryFloorPending = true;
}

function isStudySender(sender) {
    if (!activeStudy || !sender) return false;
    return BrowserWindow.getAllWindows().some((win) => isStudyWindow(win) && (
        win.webContents === sender ||
        (win.toolbarView && win.toolbarView.webContents === sender) ||
        (win.scrutinizerView && win.scrutinizerView.webContents === sender) ||
        (win.scrutinizerHud && win.scrutinizerHud.webContents === sender)
    ));
}

function showStudyLinkError(error) {
    const safeError = error || { message: 'The study link is invalid.' };
    const show = () => {
        const { dialog } = require('electron');
        dialog.showMessageBox({
            type: 'error',
            title: 'Couldn\'t Open Study Task',
            message: 'Scrutinizer couldn\'t open this study task.',
            detail: safeError.message,
            buttons: ['OK']
        }).catch((err) => console.error('[Study] Failed to show link error:', err));
    };

    if (app.isReady()) show();
    else pendingStudyError = safeError;
}

function receiveStudyDeepLink(rawUrl) {
    const result = parseStudyDeepLink(rawUrl, {
        radiusOptions: RADIUS_OPTIONS,
        modeIds: STUDY_MODE_IDS
    });

    if (!result.ok) {
        console.warn(`[Study] Rejected deep link (${result.error.code})`);
        showStudyLinkError(result.error);
        return;
    }

    const loggedTarget = result.value.route === 'session/start'
        ? `${result.value.tasks.length} tasks`
        : result.value.task.origin;
    console.log(`[Study] Received ${result.value.route} (${loggedTarget})`);
    if (!app.isReady()) {
        pendingStudyLaunch = result.value;
        return;
    }

    // Once ready, applyStudyLaunch owns the no-window case (it creates the
    // window itself). Buffering here instead would strand the link: the only
    // pendingStudyLaunch consumer in whenReady has already run.
    applyStudyLaunch(result.value);
}

app.on('open-url', (event, url) => {
    event.preventDefault();
    receiveStudyDeepLink(url);
});

// Argv intake: Windows cold-launch delivers the deep link as a bare argv
// entry (per the v1 spec's Windows boundary), and --study-link=<url> gives
// dev/test launches a protocol-free path (macOS registration only works
// packaged). Runs before app ready, so the link buffers via pendingStudyLaunch.
(function receiveArgvStudyLink(argv) {
    for (const arg of argv.slice(1)) {
        const raw = arg.startsWith('--study-link=') ? arg.slice('--study-link='.length) : arg;
        if (raw.startsWith(`${STUDY_SCHEME}://`)) {
            receiveStudyDeepLink(raw);
            return; // latest-valid-wins buffering makes >1 argv link moot
        }
    }
})(process.argv);

function rebuildMenu() {
    // Ensure settings are initialized
    const radius = currentRadius || 180;
    const blur = currentBlur || 10;
    const menu = Menu.buildFromTemplate(buildMenuTemplate(sendToRenderer, sendToOverlays, radius, blur, currentMobileEmulation, currentAestheticMode, currentCongestionMode, currentEccentricityMode, currentSaliencyMapOn, currentStructureMapOn, currentSaliencyResolution, currentCongestionResolution, currentVisualMemory !== undefined ? currentVisualMemory : 0, activeStudy ? activeStudy.kind : false));
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
    if (isStudySender(event.sender)) return;
    currentRadius = radius;
    settingsManager.set('radius', radius);
    rebuildMenu();
});

ipcMain.on('settings:blur-changed', (event, blur) => {
    if (isStudySender(event.sender)) return;
    currentBlur = blur;
    settingsManager.set('blur', blur);
    rebuildMenu();
});

ipcMain.on('settings:intensity-changed', (event, intensity) => {
    if (isStudySender(event.sender)) return;
    currentIntensity = intensity;
    settingsManager.set('intensity', intensity);
    // rebuildMenu(); // If menu needs update
});

ipcMain.on('settings:enabled-changed', (event, enabled) => {
    if (isStudySender(event.sender)) return;
    currentEnabled = enabled;
    settingsManager.set('enabled', enabled);
    // rebuildMenu(); // If menu had a toggle state, we'd update it here
});

ipcMain.on('settings:welcome-changed', (event, show) => {
    if (isStudySender(event.sender)) return;
    currentShowWelcome = show;
    settingsManager.set('showWelcomePopup', show);
});

ipcMain.on('settings:visual-memory-changed', (event, value) => {
    if (isStudySender(event.sender)) return;
    currentVisualMemory = value;
    settingsManager.set('visualMemory', value);
    // Sync the Visual Memory radio group — otherwise the menu lies across
    // launches when a non-zero value persists (the cause of v2.7.2 and its
    // re-regression via menu state on 2026-04-12).
    rebuildMenu();
});

ipcMain.on('settings:comfort-mode-changed', (event, enabled) => {
    if (isStudySender(event.sender)) return;
    currentComfortMode = enabled;
    settingsManager.set('comfortMode', enabled);
});

ipcMain.on('settings:page-changed', (event, url) => {
    if (isStudySender(event.sender)) return;
    if (url && url.startsWith('http')) {
        currentStartPage = url;
        settingsManager.set('startPage', url);
    }

});

// Aesthetic mode changed — rebuild menu to sync radio buttons across Behavior/Utility submenus
app.on('aesthetic-mode-changed', (mode) => {
    if (activeStudy) return;
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
            const height = targetProfile.height + toolbarHeightForWindow(win);

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
    if (!win || isStudyWindow(win) || !win.scrutinizerView) return;

    const urlToLoad = currentStartPage || 'https://github.com/andyed/scrutinizer2025?tab=readme-ov-file#what-is-scrutinizer';
    win.scrutinizerView.webContents.loadURL(urlToLoad);
});

// No longer needed - HUD window doesn't intercept wheel events
// Browser window handles scroll natively

// No longer needed - browser window handles focus natively

ipcMain.on('window:create', (event, url) => {
    console.log('[Main] Received window:create for:', url);
    const sourceWindow = BrowserWindow.getAllWindows().find(w =>
        (w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender) ||
        (w.scrutinizerView && w.scrutinizerView.webContents === event.sender)
    );
    if (isStudyWindow(sourceWindow)) sourceWindow.scrutinizerView.webContents.loadURL(url);
    else createScrutinizerWindow(url);
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
    if (win && win.scrutinizerHud && !win.scrutinizerHud.isDestroyed()) {
        const [width, height] = win.scrutinizerHud.getContentSize();
        event.reply('window-size', { width, height });
    }
});

// Legacy handler
ipcMain.on('get-window-size', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender);
    if (win && win.scrutinizerHud && !win.scrutinizerHud.isDestroyed()) {
        const [width, height] = win.scrutinizerHud.getContentSize();
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
            const frameSequence = (win.captureFrameSequence || 0) + 1;
            win.captureFrameSequence = frameSequence;
            const capturedScroll = win.latestBrowserScroll || { x: 0, y: 0 };
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
                height: size.height,
                frameSequence,
                scrollX: capturedScroll.x,
                scrollY: capturedScroll.y
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
    const sourceWindow = BrowserWindow.getAllWindows().find(w =>
        (w.scrutinizerHud && w.scrutinizerHud.webContents === event.sender) ||
        (w.scrutinizerView && w.scrutinizerView.webContents === event.sender)
    );
    if (isStudyWindow(sourceWindow)) sourceWindow.scrutinizerView.webContents.loadURL(url);
    else createScrutinizerWindow(url);
});

/**
 * Send a pointer position to a window's HUD, subject to the input-gating policy.
 *
 * Every path that moves the fovea — real device, polling fallback, test driver —
 * goes through here so `SCRUTINIZER_PHYSICAL_POINTER` / `SCRUTINIZER_SCRIPTED_POINTER`
 * mean the same thing everywhere. See shared/input-gating.js.
 *
 * @param {BrowserWindow} win - Window owning the HUD
 * @param {number} x - Screen-space x
 * @param {number} y - Screen-space y
 * @param {number} zoom
 * @param {string} source - inputGating.PHYSICAL or inputGating.SCRIPTED
 * @returns {boolean} true if the event was forwarded
 */
function forwardPointerToHud(win, x, y, zoom, source) {
    if (!inputGating.acceptsPointer(source)) return false;
    if (!win || !win.scrutinizerHud || win.scrutinizerHud.isDestroyed()) return false;
    win.scrutinizerHud.webContents.send('browser:mousemove', x, y, zoom);
    return true;
}

console.log(`[Main] Pointer input policy: ${inputGating.describe()}`);

// Forward browser mouse position to HUD for foveal effect tracking
let mouseEventCount = 0;
ipcMain.on('browser:mousemove', (event, x, y, zoom = 1.0, meta = null) => {
    mouseEventCount++;
    // Log every 60th event
    if (mouseEventCount % 60 === 0) {
        console.log(`[Main] Received mousemove: (${x}, ${y}), zoom=${zoom}`);
    }
    const windows = BrowserWindow.getAllWindows();
    // Find the window that owns this content view
    const win = windows.find(w => w.scrutinizerView && w.scrutinizerView.webContents === event.sender);
    forwardPointerToHud(win, x, y, zoom, inputGating.pointerSource(meta));
});

ipcMain.on('browser:zoom-changed', (event, zoom) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerView && w.scrutinizerView.webContents === event.sender);
    if (win && win.scrutinizerHud && !win.scrutinizerHud.isDestroyed()) {
        win.scrutinizerHud.webContents.send('browser:zoom-changed', zoom);
    }
});

// Keep the visualization synchronized with native BrowserView scrolling. The
// HUD uses this immediately to suppress stale captured pixels until a frame at
// the settled scroll position arrives.
ipcMain.on('browser:scroll', (event, x, y) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.scrutinizerView && w.scrutinizerView.webContents === event.sender);
    if (!win) return;
    const position = {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0
    };
    win.latestBrowserScroll = position;
    if (win.scrutinizerHud && !win.scrutinizerHud.isDestroyed()) {
        win.scrutinizerHud.webContents.send('browser:scroll', position);
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
        if (canNavigateHistory(win, 'back') && canNavigate(win.id, 'back')) {
            console.log('[Main] Navigating back (from keyboard shortcut)');
            navigateHistory(win, 'back');
        }
        return;
    }

    if (code === 'ArrowRight' && (cmdOrCtrl || altKey)) {
        if (canNavigateHistory(win, 'forward') && canNavigate(win.id, 'forward')) {
            console.log('[Main] Navigating forward (from keyboard shortcut)');
            navigateHistory(win, 'forward');
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
    if (win && canNavigateHistory(win, 'back') && canNavigate(win.id, 'back')) {
        navigateHistory(win, 'back');
    }
});

ipcMain.on('toolbar:navigate-forward', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.toolbarView && w.toolbarView.webContents === event.sender);
    if (win && canNavigateHistory(win, 'forward') && canNavigate(win.id, 'forward')) {
        navigateHistory(win, 'forward');
    }
});

ipcMain.on('toolbar:reload', (event) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.toolbarView && w.toolbarView.webContents === event.sender);
    if (win && !isStudyWindow(win) && win.scrutinizerView) {
        win.scrutinizerView.webContents.reload();
    }
});

ipcMain.on('toolbar:navigate-to', (event, url) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows.find(w => w.toolbarView && w.toolbarView.webContents === event.sender);
    if (win && !isStudyWindow(win) && win.scrutinizerView) {
        win.scrutinizerView.webContents.loadURL(url);
    }
});

ipcMain.on('toolbar:toggle-fovea', (event) => {
    const sourceWindow = BrowserWindow.getAllWindows().find(w => w.toolbarView && w.toolbarView.webContents === event.sender);
    if (isStudyWindow(sourceWindow)) return;
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

    if (win && isStudyWindow(win)) {
        win.toolbarView.webContents.send('toolbar:show-study-url');
        return;
    }

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

ipcMain.on('toolbar:study-done', (event) => {
    const win = BrowserWindow.getAllWindows().find(w => w.toolbarView && w.toolbarView.webContents === event.sender);
    if (!isStudyWindow(win)) return;
    if (activeStudy && activeStudy.kind === 'session') {
        void advanceStudySession(win).catch((err) => failActiveStudyCapture(win, err));
    }
    else exitStudyMode();
});

// The isolated capture world can only deliver to the active study's content
// WebContents. Returning an acknowledgement lets the adapter surface a
// collector failure instead of silently treating a dropped row as captured.
ipcMain.on('study:capture-row', (event, payload) => {
    const win = BrowserWindow.getAllWindows().find(candidate =>
        candidate.scrutinizerView && candidate.scrutinizerView.webContents === event.sender
    );
    event.returnValue = Boolean(isStudyWindow(win) && appendStudyCaptureRow(payload));
});

ipcMain.on('study:capture-bridge-error', (event, payload) => {
    const win = BrowserWindow.getAllWindows().find(candidate =>
        candidate.scrutinizerView && candidate.scrutinizerView.webContents === event.sender
    );
    if (!win || !isStudyWindow(win)) return;
    win.studyCaptureBridgeError = payload && typeof payload.message === 'string'
        ? payload.message : 'Capture bridge initialization failed.';
});

function createScrutinizerWindow(startUrl, options = {}) {
    const study = options.study || null;
    const loggedTarget = study
        ? (study.kind === 'session' ? `${study.tasks.length}-task session` : study.launch.task.origin)
        : startUrl;
    console.log('[Main] Creating new Scrutinizer window (dual-window architecture)', loggedTarget ? 'with target: ' + loggedTarget : '(default URL)');

    const initialToolbarHeight = study ? STUDY_TOOLBAR_HEIGHT : BROWSE_TOOLBAR_HEIGHT;
    const isTestMode = process.env.TEST_MODE === 'true';

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
            initialHeight = profile.height + initialToolbarHeight;
            initialResizable = false;
        } else {
            // Fallback
            initialWidth = 390;
            initialHeight = 844 + initialToolbarHeight;
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
        useContentSize: false,
        x: savedBounds.x, // Always use saved position
        y: savedBounds.y,
        resizable: initialResizable,
        show: false, // Wait for ready-to-show to prevent white flash
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    win.studyMode = Boolean(study);
    win.toolbarReady = false;
    win.hudReady = false;
    win.latestBrowserScroll = { x: 0, y: 0 };
    win.captureFrameSequence = 0;
    win.studyHistoryFloorIndex = null;
    win.studyHistoryFloorPending = false;

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

    contentView.webContents.on('before-input-event', (event, input) => {
        if (!isStudyWindow(win) || input.type !== 'keyDown') return;

        const commandKey = process.platform === 'darwin' ? input.meta : input.control;
        const key = String(input.key || '').toLowerCase();
        const navigationArrow = (commandKey || input.alt) && (key === 'arrowleft' || key === 'arrowright');
        const lockedCommand = commandKey && ['l', 'n', 'r'].includes(key);
        if (!navigationArrow && !lockedCommand) return;

        event.preventDefault();
        if (navigationArrow) {
            const direction = key === 'arrowleft' ? 'back' : 'forward';
            if (canNavigateHistory(win, direction) && canNavigate(win.id, direction)) {
                navigateHistory(win, direction);
            }
            return;
        }
        if (commandKey && key === 'l' && win.toolbarReady) {
            win.toolbarView.webContents.send('toolbar:show-study-url');
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
        win.toolbarReady = true;
        toolbarView.webContents.send('toolbar:set-version', app.getVersion());
        sendStudyToolbarState(win);
    });

    // Add views to main window
    win.contentView.addChildView(toolbarView);
    win.contentView.addChildView(contentView);



    // Position views — use getContentSize() not getSize() because child view
    // bounds are relative to the content area (excludes title bar on macOS)
    let toolbarOffset = isTestMode ? 0 : initialToolbarHeight;
    const updateViewBounds = () => {
        const [width, height] = win.getContentSize();
        if (isTestMode) {
            // TEST_MODE: hide toolbar, content gets full window height.
            toolbarView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
            contentView.setBounds({ x: 0, y: 0, width: width, height: height });
        } else {
            toolbarOffset = toolbarHeightForWindow(win);
            // Toolbar at top
            toolbarView.setBounds({ x: 0, y: 0, width: width, height: toolbarOffset });
            // Content below toolbar
            contentView.setBounds({
                x: 0,
                y: toolbarOffset,
                width,
                height: Math.max(0, height - toolbarOffset)
            });
        }
    };
    updateViewBounds();
    win.on('resize', updateViewBounds);

    // ===== HUD WINDOW =====
    // Separate transparent window for toolbar + canvas
    // Position it to match the content area of main window (not including title bar AND toolbar)
    const contentBounds = win.getContentBounds();
    // In TEST_MODE, no toolbar offset — HUD matches full content area
    const hudY = contentBounds.y + toolbarOffset;
    const hudHeight = contentBounds.height - toolbarOffset;
    if (isTestMode) {
        console.log(`[Main] TEST_MODE HUD: contentBounds=${JSON.stringify(contentBounds)} toolbarOffset=${toolbarOffset} hudY=${hudY} hudHeight=${hudHeight}`);
    }

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
            toolbarOffset = isTestMode ? 0 : toolbarHeightForWindow(win);
            hudWindow.setBounds({
                x: contentBounds.x,
                y: contentBounds.y + toolbarOffset,
                width: contentBounds.width,
                height: Math.max(0, contentBounds.height - toolbarOffset)
            });
        }
    };
    win.on('move', syncHudBounds);
    win.on('resize', syncHudBounds);

    // Initial sync
    syncHudBounds();
    win.updateScrutinizerBounds = () => {
        updateViewBounds();
        syncHudBounds();
    };

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

    contentView.webContents.on('did-finish-load', async () => {
        console.log('[Main] ContentView did-finish-load');

        // Inject layout-freeze CSS if provided (for deterministic rendering)
        if (process.env.TEST_INJECT_CSS) {
            try {
                const cssPath = process.env.TEST_INJECT_CSS;
                if (require('fs').existsSync(cssPath)) {
                    const css = require('fs').readFileSync(cssPath, 'utf8');
                    await contentView.webContents.insertCSS(css);
                    console.log(`[Main] Injected layout-freeze CSS (${css.length} bytes)`);
                }
            } catch (e) {
                console.warn('[Main] Failed to inject CSS:', e.message);
            }
        }

        // Force structure scan to ensure saliency map updates (Critical for initial load)
        contentView.webContents.send('browser:force-scan');

        if (!hudWindow.isDestroyed() && hudWindow.webContents && !hudWindow.webContents.isDestroyed()) {
            hudWindow.webContents.send('hud:browser:did-finish-load');
            hudWindow.webContents.send('browser:did-finish-load'); // Legacy
        }
        // Update Toolbar
        if (toolbarView.webContents && !toolbarView.webContents.isDestroyed()) {
            toolbarView.webContents.send('toolbar:update-loading', false);
            toolbarView.webContents.send('toolbar:update-nav-state', toolbarNavigationState(win));
        }

        if (activeStudy && activeStudy.kind === 'session' &&
            activeStudy.phase === 'task' && isStudyWindow(win)) {
            // A second navigation can start before the prior document's
            // did-finish-load callback runs. Do not inject a tracker into that
            // already-unloading document; the newer load owns the next anchor.
            const record = openTaskRecord();
            if (record && (record.captureCommittedNavigationSequence !==
                record.captureNavigationSequence ||
                record.captureCommittedUrl !== contentView.webContents.getURL())) {
                console.log('[StudyCapture] Skipped superseded did-finish-load.');
                return;
            }
            try {
                await captureStudyPageVisit(win, { restartTracker: true });
            } catch (err) {
                failActiveStudyCapture(win, err);
            }
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
            win.latestBrowserScroll = { x: 0, y: 0 };
            if (isStudyWindow(win)) {
                const record = openTaskRecord();
                closeOpenPageVisit(record);
                if (record) {
                    initializeTaskCapture(record);
                    // Supersede any settle/screenshot work tied to the document
                    // that navigation just destroyed, before the next page's
                    // did-finish-load event has a chance to enqueue its anchor.
                    record.captureRequestSequence += 1;
                    record.captureNavigationSequence += 1;
                }
            }
            if (!hudWindow.isDestroyed() && hudWindow.webContents && !hudWindow.webContents.isDestroyed()) {
                hudWindow.webContents.send('browser:scroll', win.latestBrowserScroll);
                hudWindow.webContents.send('hud:reset-visual-memory');
            }
        } else {
            console.log('[Main] In-page navigation (ignored for memory reset):', url);
        }
    });

    // The interstitial's Begin button navigates to a sentinel URL because the
    // content view has no IPC path. Cancel it and start the pending task.
    // beginCurrentSessionTask guards on phase, so task-page content
    // navigating to the sentinel cannot skip or restart tasks.
    contentView.webContents.on('will-navigate', (event, url) => {
        if (url === STUDY_BEGIN_URL || url.startsWith(STUDY_BEGIN_URL)) {
            event.preventDefault();
            beginCurrentSessionTask(win);
        }
    });

    // Forward navigation events to update HUD URL bar
    const sendUrlUpdate = (url, eventType) => {
        // The bundled interstitial is app chrome — its file:// URL must never
        // surface in the toolbar or HUD as if it were the task page.
        if (url && url.startsWith(STUDY_INTERSTITIAL_URL)) return;
        console.log(`[Main] ${eventType}: ${url}`);
        if (!hudWindow.isDestroyed() && hudWindow.webContents && !hudWindow.webContents.isDestroyed()) {
            hudWindow.webContents.send('hud:browser:did-navigate', url);
            hudWindow.webContents.send('browser:did-navigate', url); // Legacy
        }
        // Update Toolbar
        if (toolbarView.webContents && !toolbarView.webContents.isDestroyed()) {
            toolbarView.webContents.send('toolbar:update-url', url);
            toolbarView.webContents.send('toolbar:update-nav-state', toolbarNavigationState(win));
        }
    };

    // Only listen to did-navigate for main frame navigations
    // did-navigate-in-page is for hash changes and single-page app navigations
    contentView.webContents.on('did-navigate', (event, url) => {
        if (win.studyHistoryFloorPending && studyTaskHistoryActive(win)) {
            win.studyHistoryFloorIndex = activeHistoryIndex(contentView.webContents);
            win.studyHistoryFloorPending = false;
        }
        if (isStudyWindow(win)) {
            const record = openTaskRecord();
            if (record) {
                initializeTaskCapture(record);
                record.captureCommittedNavigationSequence = record.captureNavigationSequence;
                record.captureCommittedUrl = url;
            }
        }
        sendUrlUpdate(url, 'did-navigate');
        // Force structure scan to ensure saliency map updates
        contentView.webContents.send('browser:force-scan');
    });

    // An SPA route or hash change is a new replay anchor while preserving the
    // current tracker instance. Screenshot it without starting a second row
    // stream on the same document.
    contentView.webContents.on('did-navigate-in-page', (event, url, isMainFrame) => {
        if (!isMainFrame) return;
        sendUrlUpdate(url, 'did-navigate-in-page');
        if (activeStudy && activeStudy.kind === 'session' &&
            activeStudy.phase === 'task' && isStudyWindow(win)) {
            const record = openTaskRecord();
            if (record) {
                initializeTaskCapture(record);
                record.captureNavigationSequence += 1;
                record.captureCommittedNavigationSequence = record.captureNavigationSequence;
                record.captureCommittedUrl = url;
            }
            void captureStudyPageVisit(win, { restartTracker: false })
                .catch((err) => failActiveStudyCapture(win, err));
        }
    });

    // Intercept target="_blank" links
    contentView.webContents.setWindowOpenHandler(({ url }) => {
        console.log('[Main] Opening new window:', url);
        if (isStudyWindow(win)) {
            contentView.webContents.loadURL(url);
        } else {
            createScrutinizerWindow(url);
        }
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
    if (study && (study.kind !== 'session' || study.phase === 'task')) {
        armStudyHistoryFloor(win);
    }
    contentView.webContents.loadURL(urlToLoad);

    // Send init state to HUD once it loads
    hudWindow.webContents.once('did-finish-load', () => {
        win.hudReady = true;
        if (!hudWindow.isDestroyed() && hudWindow.webContents && !hudWindow.webContents.isDestroyed()) {
            console.log('[Main] HUD loaded. Sending init-state.');
            hudWindow.webContents.send('browser:scroll', win.latestBrowserScroll);
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
                visualMemory: currentVisualMemory !== undefined ? currentVisualMemory : 0,
                comfortMode: currentComfortMode !== undefined ? currentComfortMode : false,
                aestheticMode: currentAestheticMode,
                studyActive: Boolean(study),
                showWelcome: study ? false : (currentShowWelcome !== undefined ? currentShowWelcome : true),
                enableSaliencyModulation: enableSaliency
            };
            // Merge showWelcome into initialState based on isFirstWindow
            initialState.showWelcome = isFirstWindow ? initialState.showWelcome : false;

            console.log('[Main] Sending state to HUD:', JSON.stringify(initialState));
            hudWindow.webContents.send('hud:settings:init-state', initialState);
            hudWindow.webContents.send('settings:init-state', initialState); // Legacy
            sendStudyRuntimeState(win, { resetMemory: false });
        }
    });



    // MOUSE TRACKING FALLBACK: Poll global mouse position
    // This works as a FALLBACK when DOM events are blocked by modals/popups
    // We still prefer DOM events when available (they carry element context)
    let mousePollingInterval = null;
    let lastDOMEventTime = Date.now();
    let mouseEventCount = 0; // Added for logging, as used in the provided snippet

    // Listen for DOM events and update timestamp
    ipcMain.on('browser:mousemove', (event, x, y, zoom = 1.0, meta = null) => {
        lastDOMEventTime = Date.now();
        mouseEventCount++;
        // Log every 60th event
        if (mouseEventCount % 60 === 0) {
            console.log(`[Main] Received DOM mousemove: (${x}, ${y}), zoom=${zoom}`);
        }
        const windows = BrowserWindow.getAllWindows();
        const win = windows.find(w => w.scrutinizerView && w.scrutinizerView.webContents === event.sender);
        forwardPointerToHud(win, x, y, zoom, inputGating.pointerSource(meta));
    });

    const startMousePolling = () => {
        if (mousePollingInterval) {
            console.log('[Main] Polling already running');
            return; // Already polling
        }

        // The polling fallback reads the real device, so it is physical input by
        // definition — never start it when physical input is suppressed.
        if (!inputGating.acceptsPointer(inputGating.PHYSICAL)) {
            console.log('[Main] Polling skipped - physical pointer input is suppressed');
            return;
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
                const localY = cursorPos.y - contentBounds.y - toolbarOffset;
                const contentHeight = Math.max(0, contentBounds.height - toolbarOffset);

                if (localX >= 0 && localX < contentBounds.width && localY >= 0 && localY < contentHeight) {
                    // Send zoom=1.0 since coords are already window-relative
                    forwardPointerToHud(win, x, y, 1.0, inputGating.PHYSICAL);
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
            // Nullish coalescing (??) preserves explicit 0 values for params where
            // 0 is a valid user choice (mode 0 = High-Key Ghosting default,
            // intensity 0 = no degradation, caStrength 0 = no chromatic aberration).
            // The v2.7.2 visualMemory bug taught us not to use || on mode-like ids.
            modeId: options.modeId ?? currentAestheticMode ?? 0,
            modeName: options.modeName || null,
            foveaRadius: options.foveaRadius || currentRadius || 180,
            foveaAspect: options.foveaAspect || 1.33,
            degradationStrength: options.degradationStrength ?? options.intensity ?? currentIntensity ?? 0.6,
            caStrength: options.caStrength ?? 1.0,
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

function captureRuntimeState() {
    return {
        radius: currentRadius,
        blur: currentBlur,
        intensity: currentIntensity,
        enabled: currentEnabled,
        visualMemory: currentVisualMemory,
        comfortMode: currentComfortMode,
        mode: currentAestheticMode
    };
}

function applyRuntimeStateToGlobals(state) {
    currentRadius = state.radius;
    currentBlur = state.blur;
    currentIntensity = state.intensity;
    currentEnabled = state.enabled;
    currentVisualMemory = state.visualMemory;
    currentComfortMode = state.comfortMode;
    currentAestheticMode = state.mode;
}

function runtimePayload(state) {
    return {
        radius: state.radius,
        intensity: state.intensity,
        enabled: state.enabled,
        visualMemory: state.visualMemory,
        comfortMode: state.comfortMode,
        aestheticMode: state.mode
    };
}

function currentStudyTask() {
    if (!activeStudy) return null;
    if (activeStudy.kind === 'session') return activeStudy.tasks[activeStudy.taskIndex] || null;
    return activeStudy.launch.task;
}

function studyWindow() {
    if (!activeStudy) return null;
    return BrowserWindow.getAllWindows().find((win) => win.id === activeStudy.windowId) || mainWindow;
}

function sendStudyToolbarState(win) {
    if (!win || win.isDestroyed() || !win.toolbarReady || !activeStudy || !isStudyWindow(win)) return;
    const task = currentStudyTask();
    if (!task) return;
    // During an interstitial the content view holds the bundled screen, not
    // the task page — the toolbar should show the upcoming task's URL.
    const onTaskPage = activeStudy.kind !== 'session' || activeStudy.phase === 'task';
    const liveUrl = onTaskPage ? win.scrutinizerView.webContents.getURL() : '';
    const completed = activeStudy.kind === 'session' && activeStudy.phase === 'complete';
    win.toolbarView.webContents.send('toolbar:enter-study', {
        taskId: task.id,
        instructions: completed ? 'Session complete — press Done to finish.' : task.instructions,
        currentUrl: liveUrl || task.targetUrl,
        taskNumber: activeStudy.kind === 'session' ? activeStudy.taskIndex + 1 : null,
        taskCount: activeStudy.kind === 'session' ? activeStudy.tasks.length : null
    });
    win.toolbarView.webContents.send('toolbar:update-nav-state', toolbarNavigationState(win));
}

function studyRuntimePayload(study) {
    const payload = runtimePayload(study.runtimeState);
    // Interstitial and completion screens are meta-task chrome: their text
    // must be readable unfoveated regardless of task settings (spec
    // usability-study-multi-task-sessions.md §Interstitial).
    if (study.kind === 'session' && study.phase !== 'task') payload.enabled = false;
    return payload;
}

function sendStudyRuntimeState(win, { resetMemory = true } = {}) {
    if (!win || win.isDestroyed() || !win.hudReady || !activeStudy || !isStudyWindow(win)) return;
    if (resetMemory) win.scrutinizerHud.webContents.send('study:reset-visual-memory');
    win.scrutinizerHud.webContents.send('study:apply-runtime-settings', {
        ...studyRuntimePayload(activeStudy),
        studyActive: true
    });
}

function buildActiveStudy(launch) {
    const previousRuntimeState = activeStudy
        ? activeStudy.previousRuntimeState
        : captureRuntimeState();

    if (launch.route === 'session/start') {
        return {
            kind: 'session',
            launch,
            session: launch.session,
            tasks: launch.tasks,
            taskIndex: 0,
            phase: 'interstitial',
            taskRecords: [],
            nextPageVisitIndex: 1,
            captureTransition: false,
            captureFailed: false,
            summaryWritten: false,
            previousRuntimeState,
            runtimeState: resolveTaskRuntimeState(previousRuntimeState, launch.session.defaults, launch.tasks[0].overrides),
            windowId: null,
            startedAt: Date.now()
        };
    }

    return {
        kind: 'task',
        launch,
        previousRuntimeState,
        runtimeState: buildStudyRuntimeState(previousRuntimeState, launch.overrides),
        windowId: null,
        startedAt: Date.now()
    };
}

function studyEntryUrl(study) {
    if (study.kind !== 'session') return study.launch.task.targetUrl;
    // Re-created window mid-task resumes the task page; otherwise the
    // session (re)enters through the current task's interstitial.
    return study.phase === 'task'
        ? study.tasks[study.taskIndex].targetUrl
        : studyInterstitialUrl(study);
}

function studyInterstitialUrl(study, state = 'next') {
    const url = new URL(STUDY_INTERSTITIAL_URL);
    if (state === 'complete') {
        url.searchParams.set('state', 'complete');
        return url.toString();
    }
    const task = study.tasks[study.taskIndex];
    url.searchParams.set('state', 'next');
    url.searchParams.set('number', String(study.taskIndex + 1));
    url.searchParams.set('count', String(study.tasks.length));
    if (task.instructions) url.searchParams.set('instructions', task.instructions);
    url.searchParams.set('origin', task.origin);
    return url.toString();
}

let studyCaptureSources = null;

function loadStudyCaptureSources() {
    if (studyCaptureSources) return studyCaptureSources;
    const read = (relativePath) => fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
    studyCaptureSources = {
        trackLib: read('renderer/instrumentation/vendor/evtrack/tracklib.js'),
        trackUi: read('renderer/instrumentation/vendor/evtrack/trackui.js'),
        adapter: read('renderer/instrumentation/event-capture.js')
    };
    return studyCaptureSources;
}

function openTaskRecord() {
    if (!activeStudy || activeStudy.kind !== 'session' || activeStudy.phase !== 'task') return null;
    return activeStudy.taskRecords[activeStudy.taskRecords.length - 1] || null;
}

function taskElapsedMs(record, at = Date.now()) {
    return record && Number.isFinite(record.startedAtMs)
        ? Math.max(0, at - record.startedAtMs) : 0;
}

function initializeTaskCapture(record) {
    if (!record.captureToken) record.captureToken = crypto.randomUUID();
    if (!Array.isArray(record.captureRows)) record.captureRows = [];
    if (!(record.captureRowKeys instanceof Set)) record.captureRowKeys = new Set();
    if (!(record.captureSegmentOffsets instanceof Map)) record.captureSegmentOffsets = new Map();
    if (!(record.captureRowsBySegment instanceof Map)) record.captureRowsBySegment = new Map();
    if (!Number.isFinite(record.captureDeliveryFailureCount)) record.captureDeliveryFailureCount = 0;
    if (!Array.isArray(record.pageVisits)) record.pageVisits = [];
    if (!(record.stimuliByPageVisitId instanceof Map)) record.stimuliByPageVisitId = new Map();
    if (!Number.isFinite(record.captureRequestSequence)) record.captureRequestSequence = 0;
    if (!Number.isFinite(record.captureNavigationSequence)) record.captureNavigationSequence = 0;
    if (!(record.capturePostProcessPromises instanceof Set)) record.capturePostProcessPromises = new Set();
    if (record.captureClosing !== true) record.captureClosing = false;
    return record;
}

function closeOpenPageVisit(record, at = Date.now()) {
    if (!record || !Array.isArray(record.pageVisits)) return;
    const visit = record.pageVisits[record.pageVisits.length - 1];
    if (visit && visit.tEnd === null) {
        visit.tEnd = Math.max(visit.tStart, taskElapsedMs(record, at));
    }
}

function beginPageVisit(study, record, url, at = Date.now()) {
    initializeTaskCapture(record);
    closeOpenPageVisit(record, at);
    const pageVisitId = `pv-${String(study.nextPageVisitIndex).padStart(3, '0')}`;
    study.nextPageVisitIndex += 1;
    const visit = {
        pageVisitId,
        taskId: record.taskId,
        url,
        tStart: taskElapsedMs(record, at),
        tEnd: null,
        screenshot: stimulusFileName(pageVisitId),
        stimulusWidth: null,
        stimulusHeight: null
    };
    record.pageVisits.push(visit);
    return visit;
}

function normalizeStreamedRow(row, offsetMs) {
    if (!row || typeof row !== 'object' || !Number.isFinite(row.t)) return null;
    const normalized = Object.assign({}, row, {
        t: Math.max(0, offsetMs + row.t)
    });
    return normalized;
}

function appendStudyCaptureRow(payload) {
    const record = openTaskRecord();
    if (!record || !payload || payload.token !== record.captureToken ||
        payload.taskId !== record.taskId || typeof payload.segmentId !== 'string') {
        return false;
    }
    initializeTaskCapture(record);
    const reject = () => {
        record.captureDeliveryFailureCount += 1;
        return false;
    };
    if (!Number.isFinite(payload.rowIndex) ||
        !record.captureSegmentOffsets.has(payload.segmentId)) return reject();
    const key = `${payload.segmentId}:${payload.rowIndex}`;
    if (record.captureRowKeys.has(key)) return true;
    const row = normalizeStreamedRow(
        payload.row,
        record.captureSegmentOffsets.get(payload.segmentId)
    );
    if (!row) return reject();
    record.captureRowKeys.add(key);
    record.captureRows.push(row);
    record.captureRowsBySegment.set(
        payload.segmentId,
        (record.captureRowsBySegment.get(payload.segmentId) || 0) + 1
    );
    return true;
}

async function injectStudyCapture(win, record) {
    initializeTaskCapture(record);
    if (win.studyCaptureBridgeError) {
        const error = new Error(win.studyCaptureBridgeError);
        error.code = 'capture_bridge_failed';
        throw error;
    }
    const wc = win.scrutinizerView.webContents;
    const sources = loadStudyCaptureSources();
    const segmentId = crypto.randomUUID();
    const offsetMs = taskElapsedMs(record);
    record.captureSegmentOffsets.set(segmentId, offsetMs);
    record.captureRowsBySegment.set(segmentId, 0);

    const tokenJson = JSON.stringify(record.captureToken);
    const taskJson = JSON.stringify(record.taskId);
    const segmentJson = JSON.stringify(segmentId);
    const appVersionJson = JSON.stringify(app.getVersion());
    const platformJson = JSON.stringify(process.platform);
    const globalJson = JSON.stringify(STUDY_CAPTURE_GLOBAL);
    const bootstrap = `
        (function () {
            var module = { exports: {} };
            var require = function (id) {
                var name = String(id);
                if (name.indexOf('trackui') !== -1) return { TrackUI: window.TrackUI };
                if (name.indexOf('tracklib') !== -1) return { TrackLib: window.TrackLib };
                throw new Error('unsupported capture dependency: ' + name);
            };
            ${sources.adapter}
            var bridge = window.scrutinizerStudyCaptureBridge;
            if (!bridge || typeof bridge.emitRow !== 'function') {
                return {
                    started: false,
                    health: {
                        status: 'failed',
                        code: 'capture_bridge_unavailable',
                        message: 'The isolated capture bridge is unavailable.',
                        rowCount: 0
                    }
                };
            }
            var rowIndex = 0;
            var capture = module.exports.createEventCapture({
                window: window,
                onRow: function (row) {
                    var delivered = bridge.emitRow({
                        token: ${tokenJson},
                        taskId: ${taskJson},
                        segmentId: ${segmentJson},
                        rowIndex: rowIndex++,
                        row: row
                    });
                    if (delivered !== true) {
                        throw new Error('The main-process DataCollector rejected a capture row.');
                    }
                }
            });
            window[${globalJson}] = capture;
            var started = capture.start({ taskId: ${taskJson} });
            return {
                started: started,
                health: capture.health(),
                meta: capture.captureMeta({
                    appVersion: ${appVersionJson},
                    platform: ${platformJson}
                })
            };
        })();
    `;
    // Electron returns one evaluation result for the call, not one result per
    // WebSource. Keep vendor setup and bootstrap in one source so the returned
    // value is unambiguously the readiness handshake.
    let result;
    try {
        result = await wc.executeJavaScriptInIsolatedWorld(
            STUDY_CAPTURE_WORLD_ID,
            [{ code: `${sources.trackLib}\n${sources.trackUi}\n${bootstrap}` }]
        );
    } catch (err) {
        err.captureSegmentId = segmentId;
        throw err;
    }
    if (!result || result.started !== true) {
        console.error('[StudyCapture] Readiness handshake returned:', result);
        const health = result && result.health ? result.health : {};
        const error = new Error(health.message || 'Study capture did not become ready.');
        error.code = health.code || 'capture_start_failed';
        error.health = health;
        throw error;
    }
    record.captureMeta = record.captureMeta || result.meta;
    record.captureHealth = result.health;
    record.activeCaptureSegmentId = segmentId;
    return result;
}

async function stopInjectedStudyCapture(win) {
    if (!win || win.isDestroyed() || !win.scrutinizerView ||
        win.scrutinizerView.webContents.isDestroyed()) return null;
    const script = `
        (function () {
            var capture = window[${JSON.stringify(STUDY_CAPTURE_GLOBAL)}];
            if (!capture) return null;
            capture.stop();
            return { health: capture.health(), meta: capture.captureMeta() };
        })();
    `;
    return win.scrutinizerView.webContents.executeJavaScriptInIsolatedWorld(
        STUDY_CAPTURE_WORLD_ID,
        [{ code: script }]
    );
}

function withStudyCaptureTimeout(promise, timeoutMs, code, message) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
            const error = new Error(message);
            error.code = code;
            reject(error);
        }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function captureFullPageStimulus(webContents, devicePixelRatio) {
    let attachedHere = false;
    if (!webContents.debugger.isAttached()) {
        webContents.debugger.attach('1.3');
        attachedHere = true;
    }
    try {
        const deadline = Date.now() + STUDY_CAPTURE_SCREENSHOT_TIMEOUT_MS;
        const send = (method, params) => withStudyCaptureTimeout(
            webContents.debugger.sendCommand(method, params),
            Math.max(1, deadline - Date.now()),
            'stimulus_capture_timeout',
            `Full-page stimulus capture exceeded ${STUDY_CAPTURE_SCREENSHOT_TIMEOUT_MS} ms.`
        );
        await send('Page.enable');
        const metrics = await send('Page.getLayoutMetrics');
        const size = metrics && (metrics.cssContentSize || metrics.contentSize);
        const cssWidth = size && Number.isFinite(size.width) ? Math.ceil(size.width) : 0;
        const cssHeight = size && Number.isFinite(size.height) ? Math.ceil(size.height) : 0;
        const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
            ? devicePixelRatio : 1;
        if (cssWidth <= 0 || cssHeight <= 0) {
            const error = new Error('The page did not report a capturable layout size.');
            error.code = 'stimulus_size_invalid';
            throw error;
        }
        if (cssWidth * cssHeight * dpr * dpr > 100000000) {
            const error = new Error(
                `Full-page stimulus would exceed the 100 megapixel safety limit (${cssWidth}×${cssHeight} CSS px at DPR ${dpr}).`
            );
            error.code = 'stimulus_too_large';
            throw error;
        }
        const shot = await send('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: true,
            clip: { x: 0, y: 0, width: cssWidth, height: cssHeight, scale: dpr }
        });
        const buffer = Buffer.from(shot.data, 'base64');
        const imageSize = pngDimensions(buffer);
        if (!imageSize) {
            const error = new Error('Chromium returned an invalid PNG stimulus.');
            error.code = 'stimulus_png_invalid';
            throw error;
        }
        const expectedWidth = Math.round(cssWidth * dpr);
        const expectedHeight = Math.round(cssHeight * dpr);
        if (imageSize.width !== expectedWidth || imageSize.height !== expectedHeight) {
            const error = new Error(
                `Full-page stimulus scale mismatch: expected ${expectedWidth}×${expectedHeight}, got ${imageSize.width}×${imageSize.height}.`
            );
            error.code = 'stimulus_scale_mismatch';
            throw error;
        }
        return { buffer, width: imageSize.width, height: imageSize.height };
    } finally {
        if (attachedHere && webContents.debugger.isAttached()) webContents.debugger.detach();
    }
}

async function waitForStudyCaptureSettle(webContents) {
    const script = `
        new Promise(function (resolve) {
            var startedAt = Date.now();
            var finished = false;
            var quietTimer = null;
            var hardTimer = null;
            var observer = null;
            var finish = function (reason) {
                if (finished) return;
                finished = true;
                if (quietTimer !== null) clearTimeout(quietTimer);
                if (hardTimer !== null) clearTimeout(hardTimer);
                if (observer) observer.disconnect();
                resolve({ reason: reason, elapsedMs: Date.now() - startedAt });
            };
            var armQuietWindow = function () {
                if (finished) return;
                if (quietTimer !== null) clearTimeout(quietTimer);
                quietTimer = setTimeout(function () {
                    finish('quiet');
                }, ${STUDY_CAPTURE_QUIET_MS});
            };
            var afterFonts = function () {
                if (finished) return;
                requestAnimationFrame(function () {
                    requestAnimationFrame(function () {
                        if (finished) return;
                        observer = new MutationObserver(armQuietWindow);
                        if (document.documentElement) {
                            observer.observe(document.documentElement, {
                                subtree: true,
                                childList: true,
                                attributes: true,
                                characterData: true
                            });
                        }
                        armQuietWindow();
                    });
                });
            };
            hardTimer = setTimeout(function () {
                finish('deadline');
            }, ${STUDY_CAPTURE_SETTLE_MAX_MS});
            var fontsReady = document.fonts && document.fonts.ready
                ? document.fonts.ready : Promise.resolve();
            Promise.resolve(fontsReady).catch(function () {}).then(afterFonts);
        });
    `;
    return withStudyCaptureTimeout(
        webContents.executeJavaScriptInIsolatedWorld(
            STUDY_CAPTURE_WORLD_ID,
            [{ code: script }]
        ),
        STUDY_CAPTURE_SETTLE_MAX_MS + 500,
        'stimulus_settle_timeout',
        `Stimulus settling exceeded ${STUDY_CAPTURE_SETTLE_MAX_MS + 500} ms.`
    );
}

function enqueueStudyCapture(record, operation) {
    const previous = record.captureQueuePromise || Promise.resolve();
    const queued = previous.catch(() => null).then(operation);
    record.captureQueuePromise = queued;
    queued.then(
        () => {
            if (record.captureQueuePromise === queued) record.captureQueuePromise = null;
        },
        (err) => {
            if (!record.captureQueueError) record.captureQueueError = err;
            if (record.captureQueuePromise === queued) record.captureQueuePromise = null;
        }
    );
    return queued;
}

function trackStudyCapturePostProcess(record, operation) {
    const pending = Promise.resolve().then(operation);
    record.capturePostProcessPromises.add(pending);
    pending.then(
        () => record.capturePostProcessPromises.delete(pending),
        (err) => {
            if (!record.capturePostProcessError) record.capturePostProcessError = err;
            record.capturePostProcessPromises.delete(pending);
        }
    );
    return pending;
}

async function drainStudyCapturePostProcessing(record) {
    while (record.capturePostProcessPromises.size > 0) {
        await Promise.allSettled([...record.capturePostProcessPromises]);
    }
}

function isActiveStudyCaptureRecord(study, record) {
    return activeStudy === study && study.phase === 'task' &&
        openTaskRecord() === record;
}

function isCurrentStudyCaptureRequest(study, record, requestSequence, { allowClosing = false } = {}) {
    return isActiveStudyCaptureRecord(study, record) &&
        (allowClosing || !record.captureClosing) &&
        requestSequence === record.captureRequestSequence;
}

function unanchoredSegmentHasRows(record, err) {
    return Boolean(err && typeof err.captureSegmentId === 'string' &&
        record.captureRowsBySegment instanceof Map &&
        (record.captureRowsBySegment.get(err.captureSegmentId) || 0) > 0);
}

function supersededAnchorError(url) {
    const error = new Error(`The page changed before its required stimulus anchor completed: ${url}`);
    error.code = 'stimulus_anchor_superseded';
    return error;
}

async function preserveSettledStudyCandidate(study, record, provisionalVisit, candidate) {
    const provisionalBuffer = record.stimuliByPageVisitId.get(provisionalVisit.pageVisitId);
    const difference = await compareStimuli(provisionalBuffer, candidate.buffer, {
        timeoutMs: STUDY_STIMULUS_DIFF_TIMEOUT_MS
    });
    if (!difference.material) {
        console.log(`[StudyCapture] Discarded unchanged settled candidate (${difference.reason}).`);
        return provisionalVisit;
    }

    const provisionalIndex = record.pageVisits.indexOf(provisionalVisit);
    if (provisionalIndex < 0 || !study.taskRecords.includes(record)) {
        const error = new Error('The provisional visit disappeared before its settled anchor was indexed.');
        error.code = 'stimulus_settled_anchor_lost';
        throw error;
    }
    const candidateStart = Math.max(
        provisionalVisit.tStart,
        taskElapsedMs(record, candidate.capturedAt)
    );
    const priorEnd = provisionalVisit.tEnd;
    const tStart = Number.isFinite(priorEnd)
        ? Math.min(priorEnd, candidateStart)
        : candidateStart;
    const settledVisit = {
        pageVisitId: candidate.pageVisitId,
        taskId: record.taskId,
        url: candidate.url,
        tStart,
        tEnd: priorEnd,
        screenshot: stimulusFileName(candidate.pageVisitId),
        stimulusWidth: candidate.width,
        stimulusHeight: candidate.height
    };
    provisionalVisit.tEnd = tStart;
    record.pageVisits.splice(provisionalIndex + 1, 0, settledVisit);
    record.stimuliByPageVisitId.set(settledVisit.pageVisitId, candidate.buffer);
    console.log(`[StudyCapture] Preserved changed settled anchor (${difference.reason}).`);
    return settledVisit;
}

async function captureStudyPageVisit(win, { restartTracker = true } = {}) {
    const study = activeStudy;
    const record = openTaskRecord();
    if (!study || !record || !win || win.isDestroyed()) return null;
    initializeTaskCapture(record);
    if (record.captureClosing) return null;

    const wc = win.scrutinizerView.webContents;
    const requestedAt = Date.now();
    const requestedUrl = wc.getURL();
    const requestSequence = ++record.captureRequestSequence;
    // Starting the tracker is deliberately outside the screenshot queue: the
    // live DOM host must begin emitting rows as soon as load completes. Only
    // PNG work is serialized; settling happens outside the queue so a newer
    // page can acquire its provisional anchor without waiting for the older
    // page's quiet window.
    const trackerReady = restartTracker ? injectStudyCapture(win, record) : Promise.resolve();
    if (restartTracker) {
        record.captureTrackerReadyPromise = trackerReady;
        // The provisional queue may still be draining an older page when a
        // destroyed document rejects readiness. Its queued await remains the
        // authoritative handler; this prevents an interim unhandled rejection.
        void trackerReady.catch(() => null);
    }

    const provisional = enqueueStudyCapture(record, async () => {
        try {
            await trackerReady;
        } catch (err) {
            if (!isActiveStudyCaptureRecord(study, record)) return null;
            if (!isCurrentStudyCaptureRequest(study, record, requestSequence, { allowClosing: true }) &&
                !unanchoredSegmentHasRows(record, err)) return null;
            throw err;
        }
        if (!isActiveStudyCaptureRecord(study, record)) return null;
        if (!isCurrentStudyCaptureRequest(study, record, requestSequence, { allowClosing: true })) {
            throw supersededAnchorError(requestedUrl);
        }
        if (wc.isDestroyed() || wc.getURL() !== requestedUrl) throw supersededAnchorError(requestedUrl);
        const meta = record.captureMeta || {};
        const stimulus = await captureFullPageStimulus(wc, meta.devicePixelRatio);
        if (!isActiveStudyCaptureRecord(study, record)) return null;
        if (!isCurrentStudyCaptureRequest(study, record, requestSequence, { allowClosing: true }) ||
            wc.isDestroyed() || wc.getURL() !== requestedUrl) throw supersededAnchorError(requestedUrl);
        const visit = beginPageVisit(study, record, requestedUrl, requestedAt);
        visit.stimulusWidth = stimulus.width;
        visit.stimulusHeight = stimulus.height;
        record.stimuliByPageVisitId.set(visit.pageVisitId, stimulus.buffer);
        return visit;
    });

    const visit = await provisional;
    if (!visit || !isCurrentStudyCaptureRequest(study, record, requestSequence)) return visit;
    try {
        await waitForStudyCaptureSettle(wc);
    } catch (err) {
        if (isCurrentStudyCaptureRequest(study, record, requestSequence)) {
            console.warn('[StudyCapture] Settle refresh unavailable; preserving provisional anchor:',
                err && err.message ? err.message : err);
        }
        return visit;
    }
    if (!isCurrentStudyCaptureRequest(study, record, requestSequence) ||
        wc.isDestroyed() || wc.getURL() !== requestedUrl) return visit;

    const settled = await enqueueStudyCapture(record, async () => {
        if (!isCurrentStudyCaptureRequest(study, record, requestSequence) ||
            wc.isDestroyed() || wc.getURL() !== requestedUrl) return null;
        try {
            const meta = record.captureMeta || {};
            const stimulus = await captureFullPageStimulus(wc, meta.devicePixelRatio);
            if (!isCurrentStudyCaptureRequest(study, record, requestSequence) ||
                wc.isDestroyed() || wc.getURL() !== requestedUrl) return null;
            const pageVisitId = `pv-${String(study.nextPageVisitIndex).padStart(3, '0')}`;
            study.nextPageVisitIndex += 1;
            const candidate = Object.assign({
                capturedAt: Date.now(),
                pageVisitId,
                url: requestedUrl
            }, stimulus);
            candidate.postProcessPromise = trackStudyCapturePostProcess(
                record,
                () => preserveSettledStudyCandidate(study, record, visit, candidate)
            );
            return candidate;
        } catch (err) {
            console.warn('[StudyCapture] Settled PNG unavailable; preserving provisional anchor:',
                err && err.message ? err.message : err);
            return null;
        }
    });
    return settled ? settled.postProcessPromise : visit;
}

async function captureDoneStimulusIfChanged(win, study, record, doneAt) {
    if (!win || win.isDestroyed() || !win.scrutinizerView ||
        win.scrutinizerView.webContents.isDestroyed()) return null;
    const wc = win.scrutinizerView.webContents;
    const doneUrl = typeof record.doneUrl === 'string' ? record.doneUrl : wc.getURL();
    const captureSequence = record.captureRequestSequence;
    if (wc.getURL() !== doneUrl) {
        console.warn('[StudyCapture] Done anchor skipped because the page navigated after Done.');
        return null;
    }
    const baselineVisit = [...record.pageVisits].reverse().find((visit) =>
        record.stimuliByPageVisitId.has(visit.pageVisitId)
    );
    const baseline = baselineVisit
        ? record.stimuliByPageVisitId.get(baselineVisit.pageVisitId) : null;
    try {
        const meta = record.captureMeta || {};
        const stimulus = await captureFullPageStimulus(wc, meta.devicePixelRatio);
        if (wc.isDestroyed() || wc.getURL() !== doneUrl ||
            record.captureRequestSequence !== captureSequence) {
            console.warn('[StudyCapture] Done candidate discarded after navigation during capture.');
            return null;
        }
        let difference = { material: true, fallback: true, reason: 'baseline_missing' };
        if (baseline) {
            try {
                difference = await compareStimuli(baseline, stimulus.buffer, {
                    timeoutMs: STUDY_STIMULUS_DIFF_TIMEOUT_MS
                });
            } catch (err) {
                difference = {
                    material: true,
                    fallback: true,
                    reason: 'comparison_error',
                    detail: err && err.message ? err.message : String(err)
                };
            }
        }
        record.doneStimulusDifference = difference;
        if (!difference.material) {
            console.log(`[StudyCapture] Discarded unchanged Done candidate (${difference.reason}).`);
            return null;
        }

        const visit = beginPageVisit(study, record, doneUrl, doneAt);
        visit.stimulusWidth = stimulus.width;
        visit.stimulusHeight = stimulus.height;
        record.stimuliByPageVisitId.set(visit.pageVisitId, stimulus.buffer);
        closeOpenPageVisit(record, doneAt);
        console.log(`[StudyCapture] Preserved changed Done anchor (${difference.reason}).`);
        return visit;
    } catch (err) {
        // The Done anchor is additive evidence. A valid entry/navigation anchor
        // remains admissible if this best-effort terminal snapshot cannot run.
        console.warn('[StudyCapture] Done anchor unavailable:', err && err.message ? err.message : err);
        return null;
    }
}

function capturedRowsForRecord(record) {
    const rows = Array.isArray(record.captureRows) ? record.captureRows : [];
    if (!Number.isFinite(record.captureCutoffMs)) return rows.slice();
    return rows.filter((row) => Number.isFinite(row.t) && row.t <= record.captureCutoffMs);
}

function finalCaptureHealth(record, rendererHealth, stopError) {
    const rawRows = Array.isArray(record.captureRows) ? record.captureRows.length : 0;
    const rows = capturedRowsForRecord(record).length;
    const reportedRows = rendererHealth && Number.isFinite(rendererHealth.rowCount)
        ? rendererHealth.rowCount : null;
    const activeSegmentRows = record.captureRowsBySegment instanceof Map &&
        typeof record.activeCaptureSegmentId === 'string'
        ? (record.captureRowsBySegment.get(record.activeCaptureSegmentId) || 0)
        : rawRows;
    const rendererDeliveryFailures = rendererHealth &&
        Number.isFinite(rendererHealth.deliveryFailureCount)
        ? rendererHealth.deliveryFailureCount : 0;
    const collectorDeliveryFailures = Number.isFinite(record.captureDeliveryFailureCount)
        ? record.captureDeliveryFailureCount : 0;
    const deliveryFailures = Math.max(rendererDeliveryFailures, collectorDeliveryFailures);
    const deliveryMismatch = reportedRows !== null && reportedRows !== activeSegmentRows;
    const deliveryFailed = deliveryFailures > 0 || deliveryMismatch;
    const health = Object.assign({}, rendererHealth || record.captureHealth || {}, {
        status: stopError || deliveryFailed ? 'failed' : (rows > 0 ? 'stopped' : 'empty'),
        code: stopError ? (stopError.code || 'capture_stop_failed')
            : (deliveryFailed ? 'row_delivery_failed' : (rows > 0 ? null : 'empty_trail')),
        message: stopError
            ? stopError.message
            : (deliveryFailed
                ? (deliveryMismatch
                    ? `The active renderer segment recorded ${reportedRows} rows but the DataCollector retained ${activeSegmentRows}.`
                    : 'One or more capture rows were rejected by the DataCollector.')
                : (rows > 0 ? null : 'Capture stopped without receiving any tracker rows.')),
        rowCount: rows,
        deliveryFailureCount: deliveryFailures,
        taskId: record.taskId
    });
    if (!Number.isFinite(health.pollMs)) health.pollMs = 16;
    if (!Number.isFinite(health.deliveryFailureCount)) health.deliveryFailureCount = 0;
    return health;
}

function buildTaskTrail(study, record) {
    initializeTaskCapture(record);
    const capturedRows = capturedRowsForRecord(record)
        .sort((left, right) => left.t - right.t);
    const firstVisit = record.pageVisits[0] || {};
    const meta = record.captureMeta || {};
    record.captureTrail = rowsToScanpathData(capturedRows, {
        participantId: study.session.participantId,
        stimulusId: firstVisit.pageVisitId || null,
        stimulusWidth: firstVisit.stimulusWidth || null,
        stimulusHeight: firstVisit.stimulusHeight || null,
        taskId: record.taskId,
        pollMs: meta.pollMs || 16,
        devicePixelRatio: meta.devicePixelRatio || 1,
        startedAt: new Date(record.startedAtMs).toISOString(),
        captureHealth: record.captureHealth
    });
    return record.captureTrail;
}

async function finalizeCurrentTaskCapture(win) {
    const study = activeStudy;
    const record = openTaskRecord();
    if (!study || !record) return null;
    initializeTaskCapture(record);
    record.captureClosing = true;
    const doneAt = Number.isFinite(record.doneAtMs) ? record.doneAtMs : Date.now();
    record.captureCutoffMs = taskElapsedMs(record, doneAt);
    let result = null;
    let stopError = null;
    if (record.captureTrackerReadyPromise) {
        try {
            await record.captureTrackerReadyPromise;
        } catch (err) {
            stopError = err;
        }
    }
    try {
        result = await stopInjectedStudyCapture(win);
        if (!result || !result.health) {
            const error = new Error('The active capture segment was unavailable during stop.');
            error.code = 'capture_stop_missing';
            throw error;
        }
    } catch (err) {
        if (!stopError) stopError = err;
    }
    // Let row IPC already emitted by the isolated world drain before the
    // canonical trail snapshot is assembled, including a failed stop path.
    await new Promise((resolve) => setImmediate(resolve));
    if (record.captureQueuePromise) {
        try {
            await record.captureQueuePromise;
        } catch (err) {
            if (!stopError) stopError = err;
        }
    }
    await drainStudyCapturePostProcessing(record);
    if (!stopError && record.captureQueueError) stopError = record.captureQueueError;
    if (!stopError && record.capturePostProcessError) stopError = record.capturePostProcessError;
    await captureDoneStimulusIfChanged(win, study, record, doneAt);
    closeOpenPageVisit(record, doneAt);
    record.captureHealth = finalCaptureHealth(
        record,
        result && result.health,
        stopError
    );
    if (record.captureMeta) record.captureMeta.health = record.captureHealth;
    return buildTaskTrail(study, record);
}

function finalizeBufferedTaskCapture(study, record, reason) {
    if (!study || !record) return null;
    initializeTaskCapture(record);
    closeOpenPageVisit(record);
    const rows = capturedRowsForRecord(record).length;
    record.captureHealth = finalCaptureHealth(record, {
        status: rows > 0 ? 'stopped' : 'empty',
        code: reason || null,
        message: reason ? 'Capture ended before the renderer stop handshake completed.' : null,
        rowCount: rows
    }, null);
    if (reason && rows > 0) {
        record.captureHealth.code = reason;
        record.captureHealth.message = 'Capture ended before the renderer stop handshake completed.';
    }
    if (record.captureMeta) record.captureMeta.health = record.captureHealth;
    return buildTaskTrail(study, record);
}

function captureEnvelopeForStudy(study, summary) {
    const taskRecords = study.taskRecords.map((record, index) => Object.assign(
        {},
        summary.tasks[index],
        {
            events: Array.isArray(record.events) ? record.events : [],
            captureHealth: record.captureHealth || null
        }
    ));
    const pageVisits = study.taskRecords.flatMap((record) => record.pageVisits || []);
    const firstMetaRecord = study.taskRecords.find((record) => record.captureMeta);
    const capture = firstMetaRecord ? Object.assign({}, firstMetaRecord.captureMeta) : {};
    const healthRecords = study.taskRecords
        .map(record => record.captureHealth)
        .filter(Boolean);
    if (healthRecords.length > 0) {
        const failed = healthRecords.find(health => health.status === 'failed');
        const empty = healthRecords.find(health =>
            health.status === 'empty' || health.code === 'empty_trail'
        );
        const representative = failed || empty || healthRecords[healthRecords.length - 1];
        capture.health = Object.assign({}, representative, {
            status: failed ? 'failed' : (empty ? 'empty' : 'stopped'),
            code: failed ? (failed.code || 'capture_failed')
                : (empty ? 'empty_trail' : null),
            message: failed ? failed.message
                : (empty ? 'At least one task stopped without tracker rows.' : null),
            rowCount: healthRecords.reduce((sum, health) =>
                sum + (Number.isFinite(health.rowCount) ? health.rowCount : 0), 0),
            deliveryFailureCount: healthRecords.reduce((sum, health) =>
                sum + (Number.isFinite(health.deliveryFailureCount)
                    ? health.deliveryFailureCount : 0), 0),
            taskId: null
        });
    } else {
        capture.health = null;
    }
    return buildEnvelope({
        sessionId: summary.sessionId,
        participantId: summary.participantId,
        appVersion: summary.appVersion,
        platform: summary.platform,
        startedAt: summary.startedAt,
        endedAt: summary.endedAt,
        endReason: summary.endReason,
        defaults: summary.defaults,
        tasks: taskRecords,
        capture,
        pageVisits
    });
}

function writeCompleteStudyCapture(study, summary) {
    const envelope = captureEnvelopeForStudy(study, summary);
    const trailsByTaskId = new Map();
    const stimuliByPageVisitId = new Map();
    for (const record of study.taskRecords) {
        if (record.captureTrail) trailsByTaskId.set(record.taskId, record.captureTrail);
        if (record.stimuliByPageVisitId instanceof Map) {
            for (const [pageVisitId, buffer] of record.stimuliByPageVisitId) {
                stimuliByPageVisitId.set(pageVisitId, buffer);
            }
        }
    }
    return writeSessionDirectory({
        rootDir: path.join(app.getPath('userData'), 'study-sessions'),
        envelope,
        trailsByTaskId,
        stimuliByPageVisitId
    });
}

function failActiveStudyCapture(win, err) {
    if (!activeStudy || activeStudy.kind !== 'session' || activeStudy.phase !== 'task' ||
        activeStudy.captureFailed) return;
    activeStudy.captureFailed = true;
    const record = openTaskRecord();
    if (record) {
        record.captureHealth = Object.assign({
            status: 'failed',
            code: err && err.code ? err.code : 'capture_setup_failed',
            message: err && err.message ? err.message : 'Study capture setup failed.',
            rowCount: Array.isArray(record.captureRows) ? record.captureRows.length : 0,
            taskId: record.taskId,
            pollMs: 16,
            deliveryFailureCount: 0,
            trackerSource: null,
            trackerBinding: null
        }, err && err.health ? err.health : {});
        initializeTaskCapture(record);
        closeOpenPageVisit(record);
        if (record.captureMeta) record.captureMeta.health = record.captureHealth;
        buildTaskTrail(activeStudy, record);
    }
    console.error('[StudyCapture] Capture gate failed:', err && err.message ? err.message : err);
    closeOpenTaskRecord('session_ended');
    finishStudySession(win, 'capture_failed');
}

// Stamps end data onto the in-flight task record, if any.
function closeOpenTaskRecord(outcome, at = Date.now()) {
    if (!activeStudy || activeStudy.kind !== 'session' || activeStudy.phase !== 'task') return;
    const record = activeStudy.taskRecords[activeStudy.taskRecords.length - 1];
    if (!record || record.endedAtMs !== undefined) return;
    record.endedAtMs = at;
    record.outcome = outcome;
    if (outcome === 'done' && !record.events.some(event => event.type === 'done')) {
        record.events.push({
            type: 'done',
            t: taskElapsedMs(record, record.endedAtMs),
            at: new Date(record.endedAtMs).toISOString()
        });
    }
    const win = studyWindow();
    if (outcome === 'done' && typeof record.doneUrl === 'string') {
        record.finalUrl = record.doneUrl;
        return;
    }
    try {
        record.finalUrl = win && !win.isDestroyed() ? win.scrutinizerView.webContents.getURL() : null;
    } catch {
        record.finalUrl = null;
    }
}

function writeSessionSummary(study, endReason) {
    if (study.summaryWritten) return;
    study.summaryWritten = true;
    try {
        const summary = buildSessionSummary(study, {
            endReason,
            endedAt: Date.now(),
            appVersion: app.getVersion(),
            platform: process.platform
        });
        try {
            const capture = writeCompleteStudyCapture(study, summary);
            console.log(`[StudyCapture] Complete session directory written: ${capture.directoryPath}`);
        } catch (captureErr) {
            // A legacy summary preserves task timing, but it is intentionally
            // not admission-shaped and cannot be mistaken for replay evidence.
            const dir = path.join(app.getPath('userData'), 'study-sessions');
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, summaryFileName(summary));
            fs.writeFileSync(file, JSON.stringify(summary, null, 2), { mode: 0o600 });
            console.warn('[StudyCapture] Complete capture unavailable; wrote timing summary only:',
                captureErr && captureErr.message ? captureErr.message : captureErr);
            console.log(`[Study] Session summary written: ${file}`);
        }
    } catch (err) {
        console.error('[Study] Failed to write session summary:', err);
    }
}

// Ensures an interrupted session's timing data is not silently lost when the
// session is replaced by a new link, or the app quits mid-session.
function finalizeInterruptedSession(endReason) {
    if (!activeStudy || activeStudy.kind !== 'session' || activeStudy.summaryWritten) return;
    const study = activeStudy;
    const record = openTaskRecord();
    closeOpenTaskRecord('session_ended');
    if (record && !record.captureTrail) {
        finalizeBufferedTaskCapture(study, record, 'capture_interrupted');
    }
    writeSessionSummary(study, endReason);
}

// will-navigate sentinel handler: the interstitial's Begin button.
function beginCurrentSessionTask(win) {
    if (!activeStudy || activeStudy.kind !== 'session' || activeStudy.phase !== 'interstitial') return;
    if (!win || win.isDestroyed() || !isStudyWindow(win)) return;
    const study = activeStudy;
    const task = study.tasks[study.taskIndex];

    study.phase = 'task';
    study.runtimeState = resolveTaskRuntimeState(study.previousRuntimeState, study.session.defaults, task.overrides);
    applyRuntimeStateToGlobals(study.runtimeState);
    study.taskRecords.push({
        index: study.taskIndex + 1,
        taskId: task.id,
        targetUrl: task.targetUrl,
        startedAtMs: Date.now(),
        outcome: null,
        runtimeState: study.runtimeState,
        events: []
    });

    sendStudyRuntimeState(win); // resets Visual Memory + applies the task condition
    sendStudyToolbarState(win);
    armStudyHistoryFloor(win);
    win.scrutinizerView.webContents.loadURL(task.targetUrl);
    rebuildMenu();
}

function finishStudySession(win, endReason) {
    const study = activeStudy;
    if (study.phase === 'complete') return;
    study.phase = 'complete';
    writeSessionSummary(study, endReason);
    if (!win || win.isDestroyed()) {
        exitStudyMode();
        return;
    }
    // Stay in Study mode while the completion screen shows: restoring the
    // participant's baseline here would re-enable foveation over the
    // "session complete" text. Done (or the menu escape) performs the
    // actual restore + exit from the completion screen.
    sendStudyRuntimeState(win, { resetMemory: false });
    sendStudyToolbarState(win);
    win.scrutinizerView.webContents.loadURL(studyInterstitialUrl(study, 'complete'));
}

// Done during a session: advance, or finish after the last task. Done while
// an interstitial is showing has no task to complete — skipping isn't
// supported, so it deliberately ends the session with the records so far.
// Done on the completion screen performs the deferred restore + exit.
async function advanceStudySession(win) {
    const study = activeStudy;
    if (!study || study.captureTransition) return;
    if (study.phase === 'complete') {
        exitStudyMode();
        return;
    }
    if (study.phase !== 'task') {
        finishStudySession(win, 'ended_early');
        return;
    }
    study.captureTransition = true;
    const record = openTaskRecord();
    const doneAt = Date.now();
    if (record) {
        record.doneAtMs = doneAt;
        record.captureClosing = true;
        record.captureCutoffMs = taskElapsedMs(record, doneAt);
        try {
            record.doneUrl = win && !win.isDestroyed()
                ? win.scrutinizerView.webContents.getURL() : null;
        } catch {
            record.doneUrl = null;
        }
        // Clamp the evidence interval at the participant action before any
        // bounded stop/screenshot/diff work can observe a later navigation.
        closeOpenPageVisit(record, doneAt);
    }
    if (record && !record.events.some(event => event.type === 'done')) {
        record.events.push({
            type: 'done',
            t: taskElapsedMs(record, doneAt),
            at: new Date(doneAt).toISOString()
        });
    }
    try {
        await finalizeCurrentTaskCapture(win);
        closeOpenTaskRecord('done', doneAt);
        if (study.taskIndex < study.tasks.length - 1) {
            study.taskIndex += 1;
            study.phase = 'interstitial';
            // Foveation off on the interstitial; Visual Memory resets at Begin.
            sendStudyRuntimeState(win, { resetMemory: false });
            sendStudyToolbarState(win);
            await win.scrutinizerView.webContents.loadURL(studyInterstitialUrl(study));
            return;
        }
        finishStudySession(win, 'completed');
    } finally {
        study.captureTransition = false;
    }
}

function applyStudyLaunch(launch) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        if (app.isReady()) {
            pendingStudyLaunch = null;
            createWindow(launch);
        } else {
            pendingStudyLaunch = launch;
        }
        return;
    }

    // A new link replaces the whole active study; write the interrupted
    // session's partial summary first so its timing data survives.
    finalizeInterruptedSession('replaced');

    const study = buildActiveStudy(launch);
    activeStudy = study;
    study.windowId = mainWindow.id;
    applyRuntimeStateToGlobals(study.runtimeState);
    mainWindow.studyMode = true;
    if (typeof mainWindow.updateScrutinizerBounds === 'function') {
        mainWindow.updateScrutinizerBounds();
    }

    sendStudyRuntimeState(mainWindow);
    sendStudyToolbarState(mainWindow);
    if (study.kind !== 'session' || study.phase === 'task') {
        armStudyHistoryFloor(mainWindow);
    }
    mainWindow.scrutinizerView.webContents.loadURL(studyEntryUrl(study));
    rebuildMenu();

    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
}

function exitStudyMode() {
    if (!activeStudy) return;

    const study = activeStudy;
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.id === study.windowId) || mainWindow;
    applyRuntimeStateToGlobals(study.previousRuntimeState);

    if (win && !win.isDestroyed()) {
        if (win.hudReady) {
            win.scrutinizerHud.webContents.send('study:reset-visual-memory');
            win.scrutinizerHud.webContents.send('study:apply-runtime-settings', {
                ...runtimePayload(study.previousRuntimeState),
                studyActive: false
            });
        }
        if (win.toolbarReady) win.toolbarView.webContents.send('toolbar:exit-study');
        win.studyMode = false;
        win.studyHistoryFloorIndex = null;
        win.studyHistoryFloorPending = false;
    }

    activeStudy = null;
    if (win && !win.isDestroyed() && typeof win.updateScrutinizerBounds === 'function') {
        win.updateScrutinizerBounds();
    }
    rebuildMenu();
}

function createWindow(studyLaunch = null) {
    // Show splash immediately
    createSplashWindow();
    // Initialize settings manager
    settingsManager.init();

    // Load saved settings with defaults
    currentRadius = settingsManager.get('radius');
    currentBlur = settingsManager.get('blur');
    currentIntensity = settingsManager.get('intensity');
    currentVisualMemory = settingsManager.get('visualMemory'); // Load saved visual memory setting
    currentComfortMode = settingsManager.get('comfortMode') || false;
    currentSaliencyResolution = settingsManager.get('saliencyResolution') || 256;
    currentCongestionResolution = settingsManager.get('congestionResolution') || 512;
    currentMobileEmulation = settingsManager.get('mobileEmulation') || false;
    currentEnabled = true; // Force enabled for debugging
    // currentEnabled = settingsManager.get('enabled') !== undefined ? settingsManager.get('enabled') : true; // Default to true for debugging
    currentShowWelcome = settingsManager.get('showWelcomePopup');
    currentStartPage = settingsManager.get('startPage');

    let study = null;
    if (studyLaunch) {
        if (activeStudy && activeStudy.launch === studyLaunch) {
            // Window re-creation for an in-flight study (macOS activate after
            // the window was closed): keep progress, don't rebuild.
            study = activeStudy;
        } else {
            finalizeInterruptedSession('replaced');
            study = buildActiveStudy(studyLaunch);
            activeStudy = study;
        }
        applyRuntimeStateToGlobals(study.runtimeState);
    }

    mainWindow = createScrutinizerWindow(
        study ? studyEntryUrl(study) : currentStartPage,
        { study }
    );
    if (study) {
        study.windowId = mainWindow.id;
        mainWindow.studyMode = true;
    }

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

// Pin device pixel ratio for TEST_MODE captures so OCR/golden baselines and processed
// runs share geometry regardless of the host display's DPR. Without this the OCR gate's
// baseline (DPR-2) and processed (DPR-1 on a non-retina host) diverged and read 0 chars.
// force-device-scale-factor is OS-level, so it governs capturePage() output directly.
// (audit 2026-06-05, OCR L2)
if (process.env.TEST_MODE === 'true') {
    app.commandLine.appendSwitch('force-device-scale-factor', process.env.TEST_DPR || '2');
}

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
    const testBatchGazeplot = process.env.TEST_BATCH_GAZEPLOT === 'true'; // Fast batch: bulk-load VM, skip per-fixation walk
    const testBatchDocHeight = process.env.TEST_BATCH_GAZEPLOT_DOC_HEIGHT ? parseInt(process.env.TEST_BATCH_GAZEPLOT_DOC_HEIGHT) : 0;
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

                // Simulate mouse move to target (static fixation unless trajectory is set).
                // Pulse the SAME position to converge GazeModel smoothing and drop velocity to
                // ~0 — a single move leaves velocity frozen in the saccadic band (>4 px/ms), so
                // velocity-gated foveal stabilization (mode 12 / cortical modes) never engages and
                // the fovea renders scrambled, while mode 0's hard foveal bypass stays sharp. This
                // mirrors the scanpath dwell loop below; without it the OCR gate read 0 foveal
                // chars for mode 12 from a capture artifact, not a real defect. (audit 2026-06-06)
                if (!testTrajectory) {
                    for (let pulse = 0; pulse < 10; pulse++) {
                        forwardPointerToHud(mainWindow, screenTargetX, screenTargetY, 1.0, inputGating.SCRIPTED);
                        await new Promise(resolve => setTimeout(resolve, 16)); // ~60fps
                    }
                    await new Promise(resolve => setTimeout(resolve, 200)); // dwell so velocity settles to ~0
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
                                ipcMain.emit('browser:mousemove', { sender: mainWindow.scrutinizerView.webContents },
                                    px, py, 1.0, { source: inputGating.SCRIPTED });
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

                        // === Batch gazeplot: bulk-load ALL fixations into VM at once ===
                        // Skips the per-fixation walk entirely. Loads fixation list into
                        // the visual memory buffer in one shot, triggers a single render,
                        // then falls through to tile capture + screenshot.
                        if (testBatchGazeplot && testScanpath && !trajectoryImage) {
                            const fs = require('fs');
                            let scanpathData;
                            try {
                                scanpathData = JSON.parse(fs.readFileSync(testScanpath, 'utf8'));
                            } catch (e) {
                                console.error(`[Test] Failed to load scanpath: ${e.message}`);
                            }

                            if (scanpathData) {
                                const fixations = scanpathData.fixations || [];
                                if (fixations.length > 0) {
                                  try {
                                    // Hide scrollbar so content width matches viewport exactly
                                    await mainWindow.scrutinizerView.webContents.executeJavaScript(`
                                        (() => {
                                            const s = document.createElement('style');
                                            s.textContent = 'html { overflow-y: scroll; scrollbar-width: none; } ::-webkit-scrollbar { display: none; }';
                                            document.head.appendChild(s);
                                            return 'ok';
                                        })()
                                    `);
                                    await new Promise(resolve => setTimeout(resolve, 200));

                                    // Enable infinite visual memory
                                    const vmLimit = testVisualMemory !== null ? testVisualMemory : -1;
                                    console.log(`[Test] Batch gazeplot: ${fixations.length} fixations, visual memory=${vmLimit}`);
                                    mainWindow.scrutinizerHud.webContents.send('menu:set-visual-memory', vmLimit);
                                    await new Promise(resolve => setTimeout(resolve, 200));

                                    // ── Pre-resolved positions (single source of truth from Playwright) ──
                                    // build-gh-pages.js resolves anchors and writes fixation-resolved/{trial}.json.
                                    // Use those directly — no re-resolution in Electron.
                                    const resolvedPath = process.env.TEST_RESOLVED_FILE;
                                    const anchorPath = process.env.TEST_ANCHOR_FILE;
                                    let resolvedPositions = null;
                                    if (resolvedPath && require('fs').existsSync(resolvedPath)) {
                                        resolvedPositions = JSON.parse(require('fs').readFileSync(resolvedPath, 'utf8'));
                                        const snapped = resolvedPositions.filter(r => r).length;
                                        console.log(`[Test] Using pre-resolved positions: ${snapped}/${resolvedPositions.length} (from Playwright)`);
                                    } else if (anchorPath && require('fs').existsSync(anchorPath)) {
                                        // Fallback: resolve anchors in Electron (may differ from Playwright)
                                        const anchors = JSON.parse(require('fs').readFileSync(anchorPath, 'utf8'));
                                        resolvedPositions = await mainWindow.scrutinizerView.webContents.executeJavaScript(`
                                            (async (anchors) => {
                                                const results = [];
                                                for (const a of anchors) {
                                                    if (!a) { results.push(null); continue; }
                                                    const el = document.querySelector(a.selector);
                                                    if (!el) { results.push(null); continue; }
                                                    el.scrollIntoView({ block: 'center' });
                                                    await new Promise(r => setTimeout(r, 5));
                                                    const rect = el.getBoundingClientRect();
                                                    results.push({
                                                        x: rect.left + a.offsetX,
                                                        y: rect.top + window.scrollY + a.offsetY,
                                                    });
                                                }
                                                window.scrollTo(0, 0);
                                                return results;
                                            })(${JSON.stringify(anchors)})
                                        `);
                                        const snapped = resolvedPositions.filter(r => r).length;
                                        console.log(`[Test] DOM anchor resolution (Electron fallback): ${snapped}/${anchors.length} resolved`);
                                    }

                                    // Get physical capture size for coordinate scaling.
                                    // FPOGX/FPOGY are "relative to the top-left corner of the screenshot"
                                    // (AdSERP docs). Screenshot is at screenWidth (1280px). Viewport
                                    // matches screenWidth, so scale is simply physical/screen.
                                    const testCapture = await mainWindow.scrutinizerHud.capturePage();
                                    const physSize = testCapture.getSize();
                                    const meta = scanpathData.meta || {};
                                    const stimW = meta.stimulusWidth || meta.screenWidth || 1280;
                                    const stimH = meta.stimulusHeight || meta.screenHeight || 1024;
                                    const scaleX = physSize.width / stimW;
                                    const scaleY = physSize.height / stimH;
                                    console.log(`[Test] Batch coord mapping: stim=${stimW}x${stimH} phys=${physSize.width}x${physSize.height} scale=${scaleX.toFixed(2)}x${scaleY.toFixed(2)}`);

                                    // Build full VM buffer in physical canvas pixels.
                                    // Use DOM-resolved positions when available, fall back to raw coords.
                                    const vmPoints = fixations
                                        .filter(f => f.pageY !== undefined || f.y !== undefined)
                                        .map((f, i) => {
                                            const resolved = resolvedPositions && resolvedPositions[i];
                                            const x = resolved ? resolved.x : f.x;
                                            const y = resolved ? resolved.y : (f.pageY !== undefined ? f.pageY : f.y);
                                            return {
                                                x: x * scaleX,
                                                y: y * scaleY,
                                                radius: (f.radius || 45) * scaleX,
                                                vdx: f.vdx || 0,
                                                vdy: f.vdy || 0,
                                            };
                                        });

                                    // Bulk-load into VM buffer and trigger one render pass
                                    await mainWindow.scrutinizerHud.webContents.executeJavaScript(`
                                        (() => {
                                            const vm = window._scrutinizer && window._scrutinizer.visualMemory;
                                            if (!vm) return 'no visual memory';
                                            vm.buffer = ${JSON.stringify(vmPoints)};
                                            vm.maskDirty = true;
                                            return 'loaded ' + vm.buffer.length + ' points';
                                        })()
                                    `);

                                    // Wait for render to settle (2 frames)
                                    await new Promise(resolve => setTimeout(resolve, 100));
                                    console.log(`[Test] Batch gazeplot: bulk-loaded ${vmPoints.length} points`);

                                    // ── Tile capture (reuses existing tile logic) ──
                                    const fullpageTiles = process.env.TEST_FULLPAGE_TILES ? parseInt(process.env.TEST_FULLPAGE_TILES) : 0;
                                    if (fullpageTiles > 0) {
                                        const cssViewportH = await mainWindow.scrutinizerView.webContents.executeJavaScript(
                                            'window.innerHeight'
                                        );
                                        console.log(`[Test] Batch tile capture: ${fullpageTiles} tiles, cssViewportH=${cssViewportH}px`);

                                        // Disable sticky/fixed headers
                                        await mainWindow.scrutinizerView.webContents.executeJavaScript(`
                                            (() => {
                                                document.querySelectorAll('*').forEach(el => {
                                                    const cs = getComputedStyle(el);
                                                    if (cs.position === 'fixed' || cs.position === 'sticky') {
                                                        el.style.position = 'absolute';
                                                    }
                                                });
                                                return 'ok';
                                            })()
                                        `);
                                        await new Promise(r => setTimeout(r, 200));

                                        const fs2 = require('fs');
                                        const p = require('path');
                                        const packageVersion = require('./package.json').version.replace(/\.\d+$/, '');
                                        const capDir = p.join(__dirname, 'tests', 'golden-captures', `v${packageVersion}`);
                                        if (!fs2.existsSync(capDir)) fs2.mkdirSync(capDir, { recursive: true });

                                        for (let tile = 0; tile < fullpageTiles; tile++) {
                                            const scrollY = tile * cssViewportH;

                                            // Scroll the content view
                                            await mainWindow.scrutinizerView.webContents.executeJavaScript(
                                                `window.scrollTo(0, ${scrollY})`
                                            );
                                            await new Promise(r => setTimeout(r, 300));

                                            // Remap VM buffer for this tile's scroll offset.
                                            // Remap VM buffer for this tile's scroll offset.
                                            // Coordinates are screenshot-space → physical canvas.
                                            const shiftedPoints = fixations
                                                .filter(f => f.pageY !== undefined)
                                                .map(f => ({
                                                    x: f.x * scaleX,
                                                    y: (f.pageY - scrollY) * scaleY,
                                                    radius: (f.radius || 45) * scaleX,
                                                    vdx: f.vdx || 0,
                                                    vdy: f.vdy || 0,
                                                }))
                                                .filter(p => p.y > -100 && p.y < physSize.height + 100);

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
                                            const tileFile = outputFilename.replace('.png', `_tile${tile}.png`);
                                            fs2.writeFileSync(p.join(capDir, tileFile), tileBuffer);
                                            console.log(`[Test] Batch tile ${tile}/${fullpageTiles}: scroll=${scrollY} points=${shiftedPoints.length} → ${tileFile}`);
                                        }
                                    }

                                    // Write capture metadata so the build script can
                                    // compute the correct Y scaling (physH ≠ windowH
                                    // due to macOS title bar eating viewport height).
                                    const metaJson = {
                                        physWidth: physSize.width,
                                        physHeight: physSize.height,
                                        stimWidth: stimW,
                                        stimHeight: stimH,
                                    };
                                    const _fs = require('fs');
                                    const _p = require('path');
                                    const _ver = require('./package.json').version.replace(/\.\d+$/, '');
                                    const _capDir = _p.join(__dirname, 'tests', 'golden-captures', `v${_ver}`);
                                    const metaFile = outputFilename.replace('.png', '_meta.json');
                                    _fs.writeFileSync(_p.join(_capDir, metaFile), JSON.stringify(metaJson));
                                    console.log(`[Test] Wrote capture metadata: ${metaFile}`);
                                    console.log(`[Test] Batch gazeplot complete`);
                                  } catch (batchErr) {
                                    console.error(`[Test] Batch gazeplot error: ${batchErr.message}`);
                                    console.error(batchErr.stack);
                                  }
                                }
                            }
                        }

                        // === Scanpath gazeplot replay (visual memory accumulation) ===
                        // Walks through fixation sequence with visual memory enabled,
                        // dwelling at each fixation for its recorded duration.
                        // Captures screenshot of the FINAL accumulated state.
                        if (testScanpath && !trajectoryImage && !testAdserp && !testBatchGazeplot) {
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
                                    const displayW = scanpathData.displaySize ? scanpathData.displaySize.width
                                        : (scanpathData.meta && scanpathData.meta.stimulusWidth) || 1680;
                                    const displayH = scanpathData.displaySize ? scanpathData.displaySize.height
                                        : (scanpathData.meta && scanpathData.meta.stimulusHeight) || 1050;

                                    // Hide scrollbar in content view so content width matches viewport exactly.
                                    // Without this, the scrollbar shifts content right by ~14px, misaligning
                                    // the foveated render with fixation coordinates.
                                    await mainWindow.scrutinizerView.webContents.executeJavaScript(`
                                        const s = document.createElement('style');
                                        s.textContent = 'html { overflow-y: scroll; scrollbar-width: none; } ::-webkit-scrollbar { display: none; }';
                                        document.head.appendChild(s);
                                    `);
                                    await new Promise(resolve => setTimeout(resolve, 200));

                                    // Enable infinite visual memory (-1)
                                    const vmLimit = testVisualMemory !== null ? testVisualMemory : -1;
                                    console.log(`[Test] Scanpath replay: ${fixations.length} fixations, visual memory=${vmLimit}`);
                                    mainWindow.scrutinizerHud.webContents.send('menu:set-visual-memory', vmLimit);
                                    await new Promise(resolve => setTimeout(resolve, 200));

                                    // Use content bounds (not window outer bounds) to match HUD positioning.
                                    // The HUD is offset by the active toolbar height from content top.
                                    // screenX/Y must land in HUD coordinates after overlay.js subtracts window.screenX/Y.
                                    const cb = mainWindow.getContentBounds();
                                    // HUD position: x = cb.x, y = cb.y + toolbarOffset
                                    // HUD size: cb.width x (cb.height - toolbarOffset)
                                    const hudW = cb.width;
                                    const hudH = cb.height - toolbarOffset;
                                    console.log(`[Test] Gazeplot walk: displayW=${displayW} displayH=${displayH} contentBounds=${cb.x},${cb.y},${cb.width}x${cb.height} hudOffset=${toolbarOffset} hudSize=${hudW}x${hudH}`);

                                    for (let fi = 0; fi < fixations.length; fi++) {
                                        const fix = fixations[fi];
                                        const normX = fix.x / displayW;
                                        const normY = fix.y / displayH;
                                        // Target HUD local position: (normX * hudW, normY * hudH)
                                        // overlay.js computes: localX = screenX - window.screenX
                                        // where window.screenX = cb.x (HUD x position)
                                        // So: screenX = cb.x + normX * hudW
                                        const screenX = cb.x + normX * hudW;
                                        const screenY = (cb.y + toolbarOffset) + normY * hudH;
                                        const duration = fix.tEnd - fix.tStart;

                                        // Rapidly send position to converge GazeModel smoothing.
                                        // GazeModel uses exponential lerp (maskSmoothness=0.4), so multiple
                                        // sends at the same position accelerate convergence and drop velocity.
                                        for (let pulse = 0; pulse < 10; pulse++) {
                                            forwardPointerToHud(mainWindow, screenX, screenY, 1.0, inputGating.SCRIPTED);
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
                        if (fullpageTiles > 0 && testScanpath && !testBatchGazeplot) {
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

                                // Determine tile height for scrolling.
                                // CRITICAL: scroll uses CSS pixels, but capturePage() returns physical pixels (DPR-scaled).
                                // We need CSS pixels for window.scrollTo(). Get the actual viewport height
                                // from the content view, not from the capture dimensions.
                                const cssViewportH = await mainWindow.scrutinizerView.webContents.executeJavaScript(
                                    'window.innerHeight'
                                );
                                // Also get physical capture size for logging
                                const testCapture = await mainWindow.scrutinizerHud.capturePage();
                                const physSize = testCapture.getSize();
                                console.log(`[Test] Content bounds: ${tw}x${th}, CSS viewport: ${cssViewportH}px, capture: ${physSize.width}x${physSize.height}px (DPR=${(physSize.height/cssViewportH).toFixed(1)})`);

                                for (let tile = 0; tile < fullpageTiles; tile++) {
                                    const scrollY = tile * cssViewportH;

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
                                    // VM buffer operates in physical canvas pixels.
                                    // Scale from stimulus-space to physical capture space.
                                    const scaleX = physSize.width / stimW;
                                    const scaleY = physSize.height / stimH;
                                    const shiftedPoints = fixations
                                        .filter(f => f.pageY !== undefined)
                                        .map(f => ({
                                            x: f.x * scaleX,
                                            y: (f.pageY - scrollY) * scaleY,
                                            radius: 45 * scaleX
                                        }))
                                        .filter(p => p.y > -100 && p.y < physSize.height + 100);

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
                forwardPointerToHud(mainWindow, screenTargetX, screenTargetY, 1.0, inputGating.SCRIPTED);

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

                // Force a DOM scan so the DOM-aware compositor (mode 20+) has
                // a populated primitive-map before capture. Live sessions get
                // this via mutation/scroll/load triggers; batch capture can't
                // rely on those firing inside the per-shot window.
                if (mainWindow.scrutinizerView &&
                    mainWindow.scrutinizerView.webContents &&
                    !mainWindow.scrutinizerView.webContents.isDestroyed()) {
                    mainWindow.scrutinizerView.webContents.send('scrutinizer:force-scan');
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

                    // Stamp compute-tier provenance next to the capture (P1-5):
                    // record the ACTUAL rendered tier + cortical-pooling status so
                    // a mode that silently fell back to Tier 1.6 (or lost pooling
                    // on an 8-buffer GPU) can't be mislabeled as a full-tier figure.
                    // Enforcement of --require-tier happens on the Node side by
                    // reading these sidecars after the batch completes.
                    try {
                        const tierState = await mainWindow.scrutinizerHud.webContents.executeJavaScript(
                            'window.__scrutinizerTierState ? window.__scrutinizerTierState() : null'
                        );
                        if (tierState) {
                            const tierFile = p.join(screenshotsDir, shot.filename.replace(/\.png$/, '.tier.json'));
                            fs.writeFileSync(tierFile, JSON.stringify({ filename: shot.filename, mode: shot.mode, ...tierState }, null, 2));
                            const degraded = tierState.requestedComputeTier >= 2.5 &&
                                tierState.activeComputeTier < tierState.requestedComputeTier;
                            console.log(`[Batch] tier: req ${tierState.requestedComputeTier} / active ${tierState.activeComputeTier} / pooling ${tierState.corticalPoolingAvailable}${degraded ? ' ⚠ DEGRADED (fell back)' : ''}`);
                        }
                    } catch (tierErr) {
                        console.warn(`[Batch] tier stamp failed: ${tierErr.message}`);
                    }

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
            if (isStudyWindow(win)) {
                if (win.toolbarReady) win.toolbarView.webContents.send('toolbar:show-study-url');
                return;
            }
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
        const launch = pendingStudyLaunch;
        pendingStudyLaunch = null;
        createWindow(launch);
    }

    if (app.isPackaged && !app.setAsDefaultProtocolClient(STUDY_SCHEME)) {
        console.warn(`[Study] Failed to register ${STUDY_SCHEME}:// as the default protocol client`);
    }

    if (pendingStudyError) {
        const error = pendingStudyError;
        pendingStudyError = null;
        showStudyLinkError(error);
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
    // Quit mid-session: flush the partial summary so timing data survives.
    finalizeInterruptedSession('quit');
    void closeStimulusDiffWorker();
});

app.on('activate', function () {
    if (mainWindow === null) {
        // A deep link buffered before ready outranks a stale activeStudy —
        // "latest valid link wins" (spec §launch ordering).
        const launch = pendingStudyLaunch || (activeStudy ? activeStudy.launch : null);
        pendingStudyLaunch = null;
        createWindow(launch);
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
    if (activeStudy) return;
    createScrutinizerWindow();
});

// Handle "Exit Study Mode" / "End Study Session" menu action — the
// moderator's escape hatch when the study toolbar itself is unusable.
app.on('exit-study-mode', () => {
    if (activeStudy && activeStudy.kind === 'session' && activeStudy.phase !== 'complete') {
        closeOpenTaskRecord('session_ended');
        finishStudySession(studyWindow(), 'ended_early');
        return;
    }
    exitStudyMode();
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
