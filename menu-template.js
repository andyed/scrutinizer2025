const { app, shell } = require('electron');

const { RADIUS_OPTIONS, ASPECT_OPTIONS, INTENSITY_OPTIONS } = require('./shared/constants.json');

function buildMenuTemplate(sendToRenderer, sendToOverlays, currentRadius = 180, currentBlur = 10, currentMobileEmulation = false, currentAestheticMode = 0, currentCongestionMode = 0, currentEccentricityMode = 0, currentSaliencyMapOn = false, currentStructureMapOn = false, currentSaliencyResolution = 256, currentCongestionResolution = 512, currentVisualMemory = 0) {
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
                            label: 'Figma (UI Density)',
                            click: () => {
                                const win = BrowserWindow.getFocusedWindow();
                                if (win && win.scrutinizerView) {
                                    win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/figma.html');
                                }
                            }
                        },
                        {
                            label: 'Techmeme (Dense Text)',
                            click: () => {
                                const win = BrowserWindow.getFocusedWindow();
                                if (win && win.scrutinizerView) {
                                    win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/techmeme.html');
                                }
                            }
                        },
                        {
                            label: 'Face Detection Test',
                            click: () => {
                                const win = BrowserWindow.getFocusedWindow();
                                if (win && win.scrutinizerView) {
                                    win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/face-test.html');
                                }
                            }
                        },
                        {
                            label: 'Halverson Mixed Density',
                            click: () => {
                                const win = BrowserWindow.getFocusedWindow();
                                if (win && win.scrutinizerView) {
                                    win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/halverson-mixed-density.html');
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
                        {
                            label: 'Color Spectrum v2 (Desaturation)',
                            click: () => {
                                const win = BrowserWindow.getFocusedWindow();
                                if (win && win.scrutinizerView) {
                                    win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/color-spectrum-v2.html');
                                }
                            }
                        },
                        {
                            label: 'Chromatically Uniform Stimulus',
                            click: () => {
                                const win = BrowserWindow.getFocusedWindow();
                                if (win && win.scrutinizerView) {
                                    win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/chroma-uniform.html');
                                }
                            }
                        },
                        { type: 'separator' },
                        {
                            label: 'Grid (Distortion Check)',
                            click: () => {
                                const win = BrowserWindow.getFocusedWindow();
                                if (win && win.scrutinizerView) {
                                    win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/grid.html');
                                }
                            }
                        },
                        {
                            label: 'Grid Comparison (MIP vs Cortical)',
                            click: () => {
                                const win = BrowserWindow.getFocusedWindow();
                                if (win && win.scrutinizerView) {
                                    win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/grid-comparison.html');
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
                        },
                        { type: 'separator' },
                        {
                            label: 'Experimental Stimulus',
                            submenu: [
                                {
                                    label: 'Color Search — Bands (Red)',
                                    click: () => {
                                        const win = BrowserWindow.getFocusedWindow();
                                        if (win && win.scrutinizerView) {
                                            win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/color-search.html?color=red&size=24&mode=bands&seed=42');
                                        }
                                    }
                                },
                                {
                                    label: 'Color Search — Bands (Green)',
                                    click: () => {
                                        const win = BrowserWindow.getFocusedWindow();
                                        if (win && win.scrutinizerView) {
                                            win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/color-search.html?color=green&size=24&mode=bands&seed=42');
                                        }
                                    }
                                },
                                {
                                    label: 'Color Search — Bands (Blue)',
                                    click: () => {
                                        const win = BrowserWindow.getFocusedWindow();
                                        if (win && win.scrutinizerView) {
                                            win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/color-search.html?color=blue&size=24&mode=bands&seed=42');
                                        }
                                    }
                                },
                                {
                                    label: 'Color Search — Bands (Yellow)',
                                    click: () => {
                                        const win = BrowserWindow.getFocusedWindow();
                                        if (win && win.scrutinizerView) {
                                            win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/color-search.html?color=yellow&size=24&mode=bands&seed=42');
                                        }
                                    }
                                },
                                { type: 'separator' },
                                {
                                    label: 'Color Search — Dots (Red)',
                                    click: () => {
                                        const win = BrowserWindow.getFocusedWindow();
                                        if (win && win.scrutinizerView) {
                                            win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/color-search.html?color=red&size=24&mode=static&seed=42');
                                        }
                                    }
                                },
                                {
                                    label: 'Color Search — Dots (Green)',
                                    click: () => {
                                        const win = BrowserWindow.getFocusedWindow();
                                        if (win && win.scrutinizerView) {
                                            win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/color-search.html?color=green&size=24&mode=static&seed=42');
                                        }
                                    }
                                },
                                {
                                    label: 'Color Search — Dots (Blue)',
                                    click: () => {
                                        const win = BrowserWindow.getFocusedWindow();
                                        if (win && win.scrutinizerView) {
                                            win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/color-search.html?color=blue&size=24&mode=static&seed=42');
                                        }
                                    }
                                },
                                {
                                    label: 'Color Search — Dots (Yellow)',
                                    click: () => {
                                        const win = BrowserWindow.getFocusedWindow();
                                        if (win && win.scrutinizerView) {
                                            win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/color-search.html?color=yellow&size=24&mode=static&seed=42');
                                        }
                                    }
                                },
                                { type: 'separator' },
                                {
                                    label: 'Color Search — Interactive (Red)',
                                    click: () => {
                                        const win = BrowserWindow.getFocusedWindow();
                                        if (win && win.scrutinizerView) {
                                            win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/color-search.html?color=red&size=24');
                                        }
                                    }
                                },
                                {
                                    label: 'Color Search — Interactive (Blue)',
                                    click: () => {
                                        const win = BrowserWindow.getFocusedWindow();
                                        if (win && win.scrutinizerView) {
                                            win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/color-search.html?color=blue&size=24');
                                        }
                                    }
                                },
                                { type: 'separator' },
                                {
                                    label: 'Spatial Acuity — 4 cpd (fine)',
                                    click: () => {
                                        const win = BrowserWindow.getFocusedWindow();
                                        if (win && win.scrutinizerView) {
                                            win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/spatial-acuity.html?mode=single&freq=4&contrast=1');
                                        }
                                    }
                                },
                                {
                                    label: 'Spatial Acuity — 1 cpd (medium)',
                                    click: () => {
                                        const win = BrowserWindow.getFocusedWindow();
                                        if (win && win.scrutinizerView) {
                                            win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/spatial-acuity.html?mode=single&freq=1&contrast=1');
                                        }
                                    }
                                },
                                {
                                    label: 'Spatial Acuity — 0.25 cpd (coarse)',
                                    click: () => {
                                        const win = BrowserWindow.getFocusedWindow();
                                        if (win && win.scrutinizerView) {
                                            win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/spatial-acuity.html?mode=single&freq=0.25&contrast=1');
                                        }
                                    }
                                },
                                {
                                    label: 'Spatial Acuity — Frequency Ladder',
                                    click: () => {
                                        const win = BrowserWindow.getFocusedWindow();
                                        if (win && win.scrutinizerView) {
                                            win.scrutinizerView.webContents.loadURL('https://andyed.github.io/scrutinizer-www/reference-pages/spatial-acuity.html?mode=ladder&contrast=1');
                                        }
                                    }
                                }
                            ]
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
                            label: 'Toggle Effects On/Off',
                            accelerator: 'CmdOrCtrl+E',
                            click: () => {
                                // Emit the same IPC that toolbar eye button uses
                                const { ipcMain } = require('electron');
                                ipcMain.emit('toolbar:toggle-fovea', { sender: null });
                            }
                        },
                        { type: 'separator' },
                        {
                            label: 'Visual Memory',
                            // Radios are synced to currentVisualMemory via rebuildMenu() —
                            // hardcoding `checked: true` on Off (as this used to) made the
                            // menu lie when settings persisted a non-zero value across launches.
                            submenu: [
                                {
                                    label: 'Off (Default)',
                                    type: 'radio',
                                    checked: currentVisualMemory === 0,
                                    click: () => sendToOverlays('menu:set-visual-memory', 0)
                                },
                                {
                                    label: 'Limited (5 fixations)',
                                    type: 'radio',
                                    checked: currentVisualMemory === 5,
                                    click: () => sendToOverlays('menu:set-visual-memory', 5)
                                },
                                {
                                    label: 'Extended (10 fixations)',
                                    type: 'radio',
                                    checked: currentVisualMemory === 10,
                                    click: () => sendToOverlays('menu:set-visual-memory', 10)
                                },
                                {
                                    label: 'Infinite',
                                    type: 'radio',
                                    checked: currentVisualMemory === -1,
                                    click: () => sendToOverlays('menu:set-visual-memory', -1)
                                },
                                { type: 'separator' },
                                {
                                    label: 'Inhibition of Return (10 fixations)',
                                    type: 'radio',
                                    checked: currentVisualMemory === 20,
                                    click: () => sendToOverlays('menu:set-visual-memory', 20)
                                }
                            ]
                        },
                        {
                            label: 'Comfort Mode (+1° clear zone)',
                            type: 'checkbox',
                            checked: false,
                            click: (menuItem) => sendToOverlays('menu:toggle-comfort-mode', menuItem.checked)
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
                            checked: true,
                            click: (menuItem) => sendToOverlays('menu:toggle-saccadic-blindness', menuItem.checked)
                        },
                        {
                            label: 'Foveal Passthrough (Band 0 invariant)',
                            type: 'checkbox',
                            checked: true,
                            click: (menuItem) => sendToOverlays('menu:toggle-fovea-protect', menuItem.checked)
                        },
                        {
                            label: 'Reading Span (Rayner)',
                            type: 'checkbox',
                            checked: true,
                            click: (menuItem) => sendToOverlays('menu:toggle-reading-span', menuItem.checked)
                        },
                        {
                            label: 'Congestion-Gated Pooling',
                            type: 'checkbox',
                            checked: true,
                            click: (menuItem) => sendToOverlays('menu:toggle-congestion-pooling', menuItem.checked)
                        },
                        { type: 'separator' },
                        // === EXPERIMENTAL MODELS (alternative simulation pipelines) ===
                        {
                            label: 'Control (Smoothstep)',
                            type: 'radio',
                            checked: currentAestheticMode === 0 || (currentAestheticMode >= 1 && currentAestheticMode <= 5),
                            click: () => { sendToOverlays('menu:set-aesthetic-mode', 0); app.emit('aesthetic-mode-changed', 0); }
                        },
                        {
                            label: 'Legacy v1.6 (Comparison)',
                            type: 'radio',
                            checked: currentAestheticMode === 7,
                            click: () => { sendToOverlays('menu:set-aesthetic-mode', 7); app.emit('aesthetic-mode-changed', 7); }
                        },
                        {
                            label: 'Peripheral Texture Synthesis (Tier 2.5)',
                            type: 'radio',
                            checked: currentAestheticMode === 10,
                            click: () => { sendToOverlays('menu:set-aesthetic-mode', 10); app.emit('aesthetic-mode-changed', 10); }
                        },
                        {
                            label: 'Pyramid Mongrel (Tier 2.75)',
                            type: 'radio',
                            checked: currentAestheticMode === 14,
                            click: () => { sendToOverlays('menu:set-aesthetic-mode', 14); app.emit('aesthetic-mode-changed', 14); }
                        },
                        {
                            label: 'TTM Synthesis (Tier 3)',
                            type: 'radio',
                            checked: currentAestheticMode === 15,
                            click: () => { sendToOverlays('menu:set-aesthetic-mode', 15); app.emit('aesthetic-mode-changed', 15); }
                        },
                        {
                            label: 'Text Baseline (Pre-DOM-Aware)',
                            type: 'radio',
                            checked: currentAestheticMode === 16,
                            click: () => { sendToOverlays('menu:set-aesthetic-mode', 16); app.emit('aesthetic-mode-changed', 16); }
                        },
                        {
                            label: 'Structural Chrome Suppression (V1 length-tuning)',
                            type: 'radio',
                            checked: currentAestheticMode === 17,
                            click: () => { sendToOverlays('menu:set-aesthetic-mode', 17); app.emit('aesthetic-mode-changed', 17); }
                        },
                        {
                            label: 'DOM-Aware Text (Procedural)',
                            type: 'radio',
                            checked: currentAestheticMode === 20,
                            click: () => { sendToOverlays('menu:set-aesthetic-mode', 20); app.emit('aesthetic-mode-changed', 20); }
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
                                    label: 'Extra Small (20px radius, 20 px/°)',
                                    type: 'radio',
                                    checked: isClosest(RADIUS_OPTIONS[0], 'radius'),
                                    click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[0])
                                },
                                {
                                    label: 'Medium (45px radius, 45 px/°)',
                                    type: 'radio',
                                    checked: isClosest(RADIUS_OPTIONS[1], 'radius'),
                                    click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[1])
                                },
                                {
                                    label: 'Relaxed (70px radius, 70 px/°)',
                                    type: 'radio',
                                    checked: isClosest(RADIUS_OPTIONS[2], 'radius'),
                                    click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[2])
                                },
                                {
                                    label: 'Wide (90px radius, 90 px/°)',
                                    type: 'radio',
                                    checked: isClosest(RADIUS_OPTIONS[3], 'radius'),
                                    click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[3])
                                },
                                {
                                    label: 'Large (110px radius, 110 px/°)',
                                    type: 'radio',
                                    checked: isClosest(RADIUS_OPTIONS[4], 'radius'),
                                    click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[4])
                                },
                                {
                                    label: 'Extra Large (130px radius, 130 px/°)',
                                    type: 'radio',
                                    checked: isClosest(RADIUS_OPTIONS[5], 'radius'),
                                    click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[5])
                                },
                                {
                                    label: 'Huge (180px radius, 180 px/°)',
                                    type: 'radio',
                                    checked: isClosest(RADIUS_OPTIONS[6], 'radius'),
                                    click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[6])
                                },
                                {
                                    label: 'Extreme (300px radius, 300 px/°)',
                                    type: 'radio',
                                    checked: isClosest(RADIUS_OPTIONS[7], 'radius'),
                                    click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[7])
                                },
                                {
                                    label: 'Full Screen (450px radius, 450 px/°)',
                                    type: 'radio',
                                    checked: isClosest(RADIUS_OPTIONS[8], 'radius'),
                                    click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[8])
                                },
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
                            label: 'Degradation Strength',
                            submenu: [
                                {
                                    label: 'Off',
                                    type: 'radio',
                                    checked: isClosest(INTENSITY_OPTIONS[0], 'intensity'),
                                    click: () => sendToOverlays('menu:set-intensity', INTENSITY_OPTIONS[0])
                                },
                                {
                                    label: 'Reduced',
                                    type: 'radio',
                                    checked: isClosest(INTENSITY_OPTIONS[1], 'intensity'),
                                    click: () => sendToOverlays('menu:set-intensity', INTENSITY_OPTIONS[1])
                                },
                                {
                                    label: 'Reference',
                                    type: 'radio',
                                    checked: isClosest(INTENSITY_OPTIONS[2], 'intensity'),
                                    click: () => sendToOverlays('menu:set-intensity', INTENSITY_OPTIONS[2])
                                },
                                {
                                    label: 'Amplified',
                                    type: 'radio',
                                    checked: isClosest(INTENSITY_OPTIONS[3], 'intensity'),
                                    click: () => sendToOverlays('menu:set-intensity', INTENSITY_OPTIONS[3])
                                },
                                {
                                    label: 'Maximum',
                                    type: 'radio',
                                    checked: isClosest(INTENSITY_OPTIONS[4], 'intensity'),
                                    click: () => sendToOverlays('menu:set-intensity', INTENSITY_OPTIONS[4])
                                }
                            ]
                        },
                        // Effect Type disabled — mongrelMode is set per-mode via modes.json,
                        // manual toggle was confusing and overridden on mode switch anyway.
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
                            label: 'DOM-Aware Text (Procedural)',
                            type: 'radio',
                            checked: currentAestheticMode === 20,
                            click: () => { sendToOverlays('menu:set-aesthetic-mode', 20); app.emit('aesthetic-mode-changed', 20); }
                        },
                        {
                            label: 'Text Baseline (Pre-DOM-Aware)',
                            type: 'radio',
                            checked: currentAestheticMode === 16,
                            click: () => { sendToOverlays('menu:set-aesthetic-mode', 16); app.emit('aesthetic-mode-changed', 16); }
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
                                    label: 'Minecraft Eyeball (Polar Pooling)',
                                    type: 'radio',
                                    checked: currentAestheticMode === 8,
                                    click: () => { sendToOverlays('menu:set-aesthetic-mode', 8); app.emit('aesthetic-mode-changed', 8); }
                                },
                                {
                                    label: 'Drunken Reading',
                                    type: 'radio',
                                    checked: currentAestheticMode === 5,
                                    click: () => { sendToOverlays('menu:set-aesthetic-mode', 5); app.emit('aesthetic-mode-changed', 5); }
                                },
                                {
                                    label: 'FOVI Cortical Grid (Blauch) (Default)',
                                    type: 'radio',
                                    checked: currentAestheticMode === 12,
                                    click: () => { sendToOverlays('menu:set-aesthetic-mode', 12); app.emit('aesthetic-mode-changed', 12); }
                                }
                            ]
                        },
                        { type: 'separator' },
                        {
                            label: 'Show Structure Map',
                            type: 'checkbox',
                            checked: currentStructureMapOn,
                            accelerator: 'Ctrl+Shift+D',
                            click: (menuItem) => { sendToOverlays('menu:toggle-structure-map', menuItem.checked); app.emit('structure-map-changed', menuItem.checked); }
                        },
                        {
                            label: 'Show Saliency Map',
                            type: 'checkbox',
                            checked: currentSaliencyMapOn,
                            accelerator: 'Ctrl+Shift+S',
                            click: (menuItem) => { sendToOverlays('menu:toggle-saliency-map', menuItem.checked); app.emit('saliency-map-changed', menuItem.checked); }
                        },
                        { type: 'separator' },
                        {
                            label: 'Orientation Diagnostics',
                            submenu: [
                                {
                                    label: 'Off',
                                    type: 'radio',
                                    checked: true,
                                    click: () => { sendToOverlays('menu:set-debug-level', 0); }
                                },
                                {
                                    label: '4-Channel Energy (R=H, G=V, B=Diag)',
                                    type: 'radio',
                                    click: () => { sendToOverlays('menu:set-debug-level', 4); }
                                },
                                {
                                    label: 'Band Weights + Orientation Bonus',
                                    type: 'radio',
                                    click: () => { sendToOverlays('menu:set-debug-level', 5); }
                                }
                            ]
                        },
                        { type: 'separator' },
                        {
                            label: 'Congestion Report',
                            submenu: [
                                {
                                    label: 'Off',
                                    type: 'radio',
                                    checked: currentCongestionMode === 0,
                                    click: () => { sendToOverlays('menu:set-show-congestion', 0); app.emit('congestion-mode-changed', 0); }
                                },
                                {
                                    label: 'Stats',
                                    type: 'radio',
                                    checked: currentCongestionMode === 1,
                                    click: () => { sendToOverlays('menu:set-show-congestion', 1); app.emit('congestion-mode-changed', 1); }
                                },
                                {
                                    label: 'Heatmap',
                                    type: 'radio',
                                    checked: currentCongestionMode === 2,
                                    click: () => { sendToOverlays('menu:set-show-congestion', 2); app.emit('congestion-mode-changed', 2); }
                                },
                                {
                                    label: 'Saliency vs Congestion',
                                    type: 'radio',
                                    checked: currentCongestionMode === 3,
                                    click: () => { sendToOverlays('menu:set-show-congestion', 3); app.emit('congestion-mode-changed', 3); }
                                }
                            ]
                        },
                        {
                            label: 'Saliency Resolution',
                            submenu: [
                                {
                                    label: '256px (fast)',
                                    type: 'radio',
                                    checked: currentSaliencyResolution === 256,
                                    click: () => { sendToOverlays('menu:set-saliency-resolution', 256); app.emit('saliency-resolution-changed', 256); }
                                },
                                {
                                    label: '512px',
                                    type: 'radio',
                                    checked: currentSaliencyResolution === 512,
                                    click: () => { sendToOverlays('menu:set-saliency-resolution', 512); app.emit('saliency-resolution-changed', 512); }
                                },
                                {
                                    label: '1024px (detailed)',
                                    type: 'radio',
                                    checked: currentSaliencyResolution === 1024,
                                    click: () => { sendToOverlays('menu:set-saliency-resolution', 1024); app.emit('saliency-resolution-changed', 1024); }
                                }
                            ]
                        },
                        {
                            label: 'Congestion Resolution',
                            submenu: [
                                {
                                    label: '256px (fast)',
                                    type: 'radio',
                                    checked: currentCongestionResolution === 256,
                                    click: () => { sendToOverlays('menu:set-congestion-resolution', 256); app.emit('congestion-resolution-changed', 256); }
                                },
                                {
                                    label: '512px',
                                    type: 'radio',
                                    checked: currentCongestionResolution === 512,
                                    click: () => { sendToOverlays('menu:set-congestion-resolution', 512); app.emit('congestion-resolution-changed', 512); }
                                },
                                {
                                    label: '1024px',
                                    type: 'radio',
                                    checked: currentCongestionResolution === 1024,
                                    click: () => { sendToOverlays('menu:set-congestion-resolution', 1024); app.emit('congestion-resolution-changed', 1024); }
                                },
                                {
                                    label: '2048px (detailed)',
                                    type: 'radio',
                                    checked: currentCongestionResolution === 2048,
                                    click: () => { sendToOverlays('menu:set-congestion-resolution', 2048); app.emit('congestion-resolution-changed', 2048); }
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
                            checked: currentEccentricityMode === 0,
                            click: () => { sendToOverlays('menu:set-debug-boundary', 0); app.emit('eccentricity-mode-changed', 0); }
                        },
                        {
                            label: 'Fovea Only',
                            type: 'radio',
                            checked: currentEccentricityMode === 1,
                            click: () => { sendToOverlays('menu:set-debug-boundary', 1); app.emit('eccentricity-mode-changed', 1); }
                        },
                        {
                            label: 'Fovea + Parafovea',
                            type: 'radio',
                            checked: currentEccentricityMode === 2,
                            click: () => { sendToOverlays('menu:set-debug-boundary', 2); app.emit('eccentricity-mode-changed', 2); }
                        },
                        {
                            label: 'Fovea + Parafovea + Periphery',
                            type: 'radio',
                            checked: currentEccentricityMode === 3,
                            click: () => { sendToOverlays('menu:set-debug-boundary', 3); app.emit('eccentricity-mode-changed', 3); }
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