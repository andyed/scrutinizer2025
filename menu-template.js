const { app, shell } = require('electron');

const { RADIUS_OPTIONS, ASPECT_OPTIONS, INTENSITY_OPTIONS } = require('./shared/constants.json');

function buildMenuTemplate(sendToRenderer, sendToOverlays, currentRadius = 180, currentBlur = 10, currentMobileEmulation = false, currentAestheticMode = 0) {
    const isMac = process.platform === 'darwin';
    const { BrowserWindow } = require('electron');

    // Helper to find closest option (works for radius, aspect, intensity)
    const isClosest = (target, type = 'radius') => {
        let options, currentValue;

        if (type === 'aspect') {
            options = ASPECT_OPTIONS;
            currentValue = 1.33; // Default aspect ratio
        } else if (type === 'intensity') {
            options = INTENSITY_OPTIONS;
            currentValue = 0.6; // Default intensity
        } else {
            options = RADIUS_OPTIONS;
            currentValue = currentRadius;
        }

        const closest = options.reduce((prev, curr) => {
            return (Math.abs(curr - currentValue) < Math.abs(prev - currentValue) ? curr : prev);
        });
        return closest === target;
    };

    const template = [
        // App Menu (macOS only)
        ...(isMac ? [{
            label: app.name,
            submenu: [
                {
                    label: 'About ' + app.name,
                    click: async () => {
                        await shell.openExternal('https://github.com/andyed/scrutinizer2025');
                    }
                },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }] : []),
        // File Menu
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Window',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => {
                        // Update Visual Memory Mask
                        const { dialog } = require('electron');
                        const win = BrowserWindow.getFocusedWindow();
                        if (win && win.scrutinizerView) {
                            app.emit('create-new-window');
                        }
                    }
                },
                {
                    label: 'Open URL...',
                    accelerator: 'CmdOrCtrl+L',
                    click: () => {
                        const win = BrowserWindow.getFocusedWindow();
                        if (!win || !win.scrutinizerView) return;

                        const currentURL = win.scrutinizerView.webContents.getURL();
                        const path = require('path');

                        const dialog = new BrowserWindow({
                            width: 500,
                            height: 207, // Increased by 15% (was 180) for better spacing
                            // Visual Memory Overlay
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

                        win.urlDialog = dialog;
                    }
                },
                { type: 'separator' },
                { role: 'close' }
            ]
        },
        // Edit Menu
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'pasteAndMatchStyle' },
                { role: 'delete' },
                { role: 'selectAll' },
                { type: 'separator' },
                {
                    label: 'Speech',
                    submenu: [
                        { role: 'startSpeaking' },
                        { role: 'stopSpeaking' }
                    ]
                }
            ]
        },
        // View Menu
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
                { type: 'separator' },
                {
                    label: 'Mobile Emulation',
                    submenu: [
                        {
                            label: 'Off',
                            type: 'radio',
                            checked: !currentMobileEmulation,
                            click: () => app.emit('mobile-emulation', false)
                        },
                        { type: 'separator' },
                        // Dynamic Device Profiles
                        ...Object.keys(require('./shared/constants.json').DEVICE_PROFILES).map(key => {
                            const profile = require('./shared/constants.json').DEVICE_PROFILES[key];
                            return {
                                label: profile.label,
                                type: 'radio',
                                checked: currentMobileEmulation === key || (currentMobileEmulation === true && key === 'iphone_14_pro'), // Handle legacy true
                                click: () => app.emit('mobile-emulation', key)
                            };
                        })
                    ]
                }
            ]
        },
        // Go Menu (navigation)
        {
            label: 'Go',
            submenu: [
                {
                    label: 'Refresh',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        const win = BrowserWindow.getFocusedWindow();
                        if (win && win.scrutinizerView) {
                            win.scrutinizerView.webContents.reload();
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Back',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Left' : 'Alt+Left',
                    click: () => {
                        const win = BrowserWindow.getFocusedWindow();
                        if (win && win.scrutinizerHud) {
                            // Send IPC to use the debounced navigation handler
                            win.scrutinizerHud.webContents.send('menu:navigate-back');
                        }
                    }
                },
                {
                    label: 'Forward',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Right' : 'Alt+Right',
                    click: () => {
                        const win = BrowserWindow.getFocusedWindow();
                        if (win && win.scrutinizerHud) {
                            // Send IPC to use the debounced navigation handler
                            win.scrutinizerHud.webContents.send('menu:navigate-forward');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Home',
                    accelerator: 'CmdOrCtrl+Shift+H',
                    click: () => {
                        const win = BrowserWindow.getFocusedWindow();
                        if (win && win.scrutinizerView) {
                            const defaultUrl = 'https://github.com/andyed/scrutinizer2025?tab=readme-ov-file#what-is-scrutinizer';
                            win.scrutinizerView.webContents.loadURL(defaultUrl);
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Reference Pages',
                    submenu: [
                        {
                            label: 'Dashboard',
                            click: () => {
                                const win = BrowserWindow.getFocusedWindow();
                                if (win && win.scrutinizerView) {
                                    win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/dashboard.html');
                                }
                            }
                        },
                        {
                            label: 'Article',
                            click: () => {
                                const win = BrowserWindow.getFocusedWindow();
                                if (win && win.scrutinizerView) {
                                    win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/article.html');
                                }
                            }
                        },
                        {
                            label: 'E-commerce',
                            click: () => {
                                const win = BrowserWindow.getFocusedWindow();
                                if (win && win.scrutinizerView) {
                                    win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/ecommerce.html');
                                }
                            }
                        },
                        { type: 'separator' },
                        {
                            label: 'Color Spectrum',
                            click: () => {
                                const win = BrowserWindow.getFocusedWindow();
                                if (win && win.scrutinizerView) {
                                    win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/color-spectrum.html');
                                }
                            }
                        },
                        { type: 'separator' },
                        {
                            label: 'Crowding (Letters)',
                            click: () => {
                                const win = BrowserWindow.getFocusedWindow();
                                if (win && win.scrutinizerView) {
                                    win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/crowding.html');
                                }
                            }
                        },
                        {
                            label: 'Crowding (Stimulus-Specific)',
                            click: () => {
                                const win = BrowserWindow.getFocusedWindow();
                                if (win && win.scrutinizerView) {
                                    win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/crowding-stimulus.html');
                                }
                            }
                        }
                    ]
                }
            ]
        },
        // Simulation Menu (Custom)
        {
            label: 'Simulation',
            submenu: [
                // === BEHAVIOR (cognitive processes being modeled) ===
                {
                    label: 'Behavior',
                    submenu: [
                        {
                            label: 'Visual Memory',
                            submenu: [
                                {
                                    label: 'Off (Default)',
                                    type: 'radio',
                                    checked: true,
                                    click: () => sendToOverlays('menu:set-visual-memory', 0)
                                },
                                {
                                    label: 'Limited (5 fixations)',
                                    type: 'radio',
                                    click: () => sendToOverlays('menu:set-visual-memory', 5)
                                },
                                {
                                    label: 'Extended (10 fixations)',
                                    type: 'radio',
                                    click: () => sendToOverlays('menu:set-visual-memory', 10)
                                },
                                {
                                    label: 'Infinite',
                                    type: 'radio',
                                    click: () => sendToOverlays('menu:set-visual-memory', -1)
                                },
                                { type: 'separator' },
                                {
                                    label: 'Inhibition of Return (10 fixations)',
                                    type: 'radio',
                                    click: () => sendToOverlays('menu:set-visual-memory', 20)
                                }
                            ]
                        },
                        { type: 'separator' },
                        {
                            label: 'Enable Structure Map',
                            type: 'checkbox',
                            checked: true,
                            click: (menuItem) => sendToOverlays('menu:toggle-enable-structure-map', menuItem.checked)
                        },
                        {
                            label: 'Enable Saliency Modulation',
                            type: 'checkbox',
                            checked: true,
                            click: (menuItem) => sendToOverlays('menu:toggle-saliency-modulation', menuItem.checked)
                        },
                        {
                            label: 'Chromatic Pooling (RG/YV)',
                            type: 'checkbox',
                            checked: true,
                            click: (menuItem) => sendToOverlays('menu:toggle-chromatic-pooling', menuItem.checked)
                        },
                        {
                            label: 'Saccadic Blindness',
                            type: 'checkbox',
                            checked: false,
                            click: (menuItem) => sendToOverlays('menu:toggle-saccadic-blindness', menuItem.checked)
                        },
                        { type: 'separator' },
                        // === EXPERIMENTAL MODELS (alternative simulation pipelines) ===
                        {
                            label: 'Control (Default Pipeline)',
                            type: 'radio',
                            checked: currentAestheticMode === 0 || (currentAestheticMode >= 1 && currentAestheticMode <= 5),
                            click: () => { sendToOverlays('menu:set-aesthetic-mode', 0); app.emit('aesthetic-mode-changed', 0); }
                        },
                        {
                            label: 'Log-Polar MIP (Blauch 2026)',
                            type: 'radio',
                            checked: currentAestheticMode === 6,
                            click: () => { sendToOverlays('menu:set-aesthetic-mode', 6); app.emit('aesthetic-mode-changed', 6); }
                        },
                        {
                            label: 'Legacy v1.6 (Comparison)',
                            type: 'radio',
                            checked: currentAestheticMode === 7,
                            click: () => { sendToOverlays('menu:set-aesthetic-mode', 7); app.emit('aesthetic-mode-changed', 7); }
                        },
                        { type: 'separator' },
                        {
                            label: 'Congestion-Gated Pooling',
                            type: 'radio',
                            checked: currentAestheticMode === 9,
                            click: () => { sendToOverlays('menu:set-aesthetic-mode', 9); app.emit('aesthetic-mode-changed', 9); }
                        }
                    ]
                },

                // === FOVEAL ===
                {
                    label: 'Foveal',
                    submenu: [
                        {
                            label: 'Toggle Foveal Mode',
                            accelerator: 'CmdOrCtrl+Shift+F',
                            click: () => sendToOverlays('menu:toggle-foveal')
                        },
                        { type: 'separator' },
                        {
                            label: 'Foveal Radius',
                            submenu: [
                                {
                                    label: 'Extra Small (20px)',
                                    type: 'radio',
                                    checked: isClosest(RADIUS_OPTIONS[0], 'radius'),
                                    click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[0])
                                },
                                {
                                    label: 'Small (45px)',
                                    type: 'radio',
                                    checked: isClosest(RADIUS_OPTIONS[1], 'radius'),
                                    click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[1])
                                },
                                {
                                    label: 'Medium (90px)',
                                    type: 'radio',
                                    checked: isClosest(RADIUS_OPTIONS[2], 'radius'),
                                    click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[2])
                                },
                                {
                                    label: 'Large (180px)',
                                    type: 'radio',
                                    checked: isClosest(RADIUS_OPTIONS[3], 'radius'),
                                    click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[3])
                                },
                                {
                                    label: 'Extra Large (300px)',
                                    type: 'radio',
                                    checked: isClosest(RADIUS_OPTIONS[4], 'radius'),
                                    click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[4])
                                },
                                {
                                    label: 'Huge (450px)',
                                    type: 'radio',
                                    checked: isClosest(RADIUS_OPTIONS[5], 'radius'),
                                    click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[5])
                                },
                                { type: 'separator' },
                                /*
                                {
                                    label: 'Calibrate Fovea...',
                                    click: () => app.emit('open-calibration-window')
                                },
                                */
                            ]
                        },
                        {
                            label: 'Foveal Shape',
                            submenu: [
                                {
                                    label: 'Circular (1:1)',
                                    type: 'radio',
                                    checked: isClosest(ASPECT_OPTIONS[0], 'aspect'),
                                    click: () => sendToOverlays('menu:set-aspect', ASPECT_OPTIONS[0])
                                },
                                {
                                    label: 'Standard (4:3)',
                                    type: 'radio',
                                    checked: isClosest(ASPECT_OPTIONS[1], 'aspect'),
                                    click: () => sendToOverlays('menu:set-aspect', ASPECT_OPTIONS[1])
                                },
                                {
                                    label: 'Wide (16:9)',
                                    type: 'radio',
                                    checked: isClosest(ASPECT_OPTIONS[2], 'aspect'),
                                    click: () => sendToOverlays('menu:set-aspect', ASPECT_OPTIONS[2])
                                },
                                {
                                    label: 'Ultra-Wide (21:9)',
                                    type: 'radio',
                                    checked: isClosest(ASPECT_OPTIONS[3], 'aspect'),
                                    click: () => sendToOverlays('menu:set-aspect', ASPECT_OPTIONS[3])
                                }
                            ]
                        }
                    ]
                },

                // === PERIPHERAL ===
                {
                    label: 'Peripheral',
                    submenu: [
                        {
                            label: 'Intensity',
                            submenu: [
                                {
                                    label: 'Off (0%)',
                                    type: 'radio',
                                    checked: isClosest(INTENSITY_OPTIONS[0], 'intensity'),
                                    click: () => sendToOverlays('menu:set-intensity', INTENSITY_OPTIONS[0])
                                },
                                {
                                    label: 'Subtle (30%)',
                                    type: 'radio',
                                    checked: isClosest(INTENSITY_OPTIONS[1], 'intensity'),
                                    click: () => sendToOverlays('menu:set-intensity', INTENSITY_OPTIONS[1])
                                },
                                {
                                    label: 'Moderate (60%)',
                                    type: 'radio',
                                    checked: isClosest(INTENSITY_OPTIONS[2], 'intensity'),
                                    click: () => sendToOverlays('menu:set-intensity', INTENSITY_OPTIONS[2])
                                },
                                {
                                    label: 'Strong (80%)',
                                    type: 'radio',
                                    checked: isClosest(INTENSITY_OPTIONS[3], 'intensity'),
                                    click: () => sendToOverlays('menu:set-intensity', INTENSITY_OPTIONS[3])
                                },
                                {
                                    label: 'Maximum (100%)',
                                    type: 'radio',
                                    checked: isClosest(INTENSITY_OPTIONS[4], 'intensity'),
                                    click: () => sendToOverlays('menu:set-intensity', INTENSITY_OPTIONS[4])
                                }
                            ]
                        },
                        {
                            label: 'Effect Type',
                            submenu: [
                                {
                                    label: 'Mongrel Approximation',
                                    type: 'radio',
                                    checked: true,
                                    click: () => sendToOverlays('menu:set-mongrel-mode', 1)
                                },
                                {
                                    label: 'Noise (Dynamic)',
                                    type: 'radio',
                                    click: () => sendToOverlays('menu:set-mongrel-mode', 0)
                                }
                            ]
                        },
                        {
                            label: 'Chromatic Aberration',
                            type: 'checkbox',
                            checked: true,
                            click: (menuItem) => sendToOverlays('menu:toggle-ca', menuItem.checked)
                        }
                    ]
                },

                { type: 'separator' },

                // === UTILITY (rendering modes & debug views) ===
                {
                    label: 'Utility',
                    submenu: [
                        {
                            label: 'High-Key Ghosting (Default)',
                            type: 'radio',
                            checked: currentAestheticMode === 0,
                            click: () => { sendToOverlays('menu:set-aesthetic-mode', 0); app.emit('aesthetic-mode-changed', 0); }
                        },
                        {
                            label: 'Test Modes',
                            submenu: [
                                {
                                    label: 'Biological (Purkinje Darkening)',
                                    type: 'radio',
                                    checked: currentAestheticMode === 1,
                                    click: () => { sendToOverlays('menu:set-aesthetic-mode', 1); app.emit('aesthetic-mode-changed', 1); }
                                },
                                {
                                    label: 'Frosted Glass (iOS)',
                                    type: 'radio',
                                    checked: currentAestheticMode === 2,
                                    click: () => { sendToOverlays('menu:set-aesthetic-mode', 2); app.emit('aesthetic-mode-changed', 2); }
                                },
                                {
                                    label: 'Wireframe (Gestalt)',
                                    type: 'radio',
                                    checked: currentAestheticMode === 3,
                                    click: () => { sendToOverlays('menu:set-aesthetic-mode', 3); app.emit('aesthetic-mode-changed', 3); }
                                },
                                {
                                    label: 'Minecraft (Block Pooling)',
                                    type: 'radio',
                                    checked: currentAestheticMode === 4,
                                    click: () => { sendToOverlays('menu:set-aesthetic-mode', 4); app.emit('aesthetic-mode-changed', 4); }
                                },
                                {
                                    label: 'Double Vision',
                                    type: 'radio',
                                    checked: currentAestheticMode === 5,
                                    click: () => { sendToOverlays('menu:set-aesthetic-mode', 5); app.emit('aesthetic-mode-changed', 5); }
                                }
                            ]
                        },
                        { type: 'separator' },
                        {
                            label: 'Show Structure Map',
                            type: 'checkbox',
                            checked: false,
                            click: (menuItem) => sendToOverlays('menu:toggle-structure-map', menuItem.checked)
                        },
                        {
                            label: 'Show Saliency Map',
                            type: 'checkbox',
                            checked: false,
                            click: (menuItem) => sendToOverlays('menu:toggle-saliency-map', menuItem.checked)
                        },
                        { type: 'separator' },
                        {
                            label: 'Congestion Report',
                            submenu: [
                                {
                                    label: 'Off',
                                    type: 'radio',
                                    checked: true,
                                    click: () => sendToOverlays('menu:set-show-congestion', 0)
                                },
                                {
                                    label: 'Stats',
                                    type: 'radio',
                                    checked: false,
                                    click: () => sendToOverlays('menu:set-show-congestion', 1)
                                },
                                {
                                    label: 'Heatmap',
                                    type: 'radio',
                                    checked: false,
                                    click: () => sendToOverlays('menu:set-show-congestion', 2)
                                },
                                {
                                    label: 'Saliency vs Congestion',
                                    type: 'radio',
                                    checked: false,
                                    click: () => sendToOverlays('menu:set-show-congestion', 3)
                                }
                            ]
                        }
                    ]
                },

                { type: 'separator' },
                {
                    label: 'Eccentricity Overlay',
                    submenu: [
                        {
                            label: 'Off',
                            type: 'radio',
                            checked: true,
                            click: () => sendToOverlays('menu:set-debug-boundary', 0)
                        },
                        {
                            label: 'Fovea Only',
                            type: 'radio',
                            checked: false,
                            click: () => sendToOverlays('menu:set-debug-boundary', 1)
                        },
                        {
                            label: 'Fovea + Parafovea',
                            type: 'radio',
                            checked: false,
                            click: () => sendToOverlays('menu:set-debug-boundary', 2)
                        },
                        {
                            label: 'Fovea + Parafovea + Periphery',
                            type: 'radio',
                            checked: false,
                            click: () => sendToOverlays('menu:set-debug-boundary', 3)
                        }
                    ]
                }
            ]
        },
        // Window Menu
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                { type: 'separator' },
                { role: 'front' },
                { type: 'separator' },
                { role: 'window' }
            ]
        },
        // Help Menu
        {
            role: 'help',
            submenu: [
                {
                    label: `Check for Updates... (v${app.getVersion()})`,
                    click: () => {
                        app.emit('check-for-updates');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Learn More',
                    click: async () => {
                        await shell.openExternal('https://github.com/andyed/scrutinizer2025');
                    }
                },
                {
                    label: 'Report Issue',
                    click: async () => {
                        const version = app.getVersion();
                        const body = encodeURIComponent(`\n\nVersion: ${version}`);
                        await shell.openExternal(`https://github.com/andyed/scrutinizer2025/issues/new?body=${body}`);
                    }
                }
            ]
        }
    ];

    return template;
}

module.exports = { buildMenuTemplate, RADIUS_OPTIONS };