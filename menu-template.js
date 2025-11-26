const { app, shell } = require('electron');

const RADIUS_OPTIONS = [20, 45, 90, 160, 250];

function buildMenuTemplate(sendToRenderer, sendToOverlays, currentRadius = 180, currentBlur = 10) {
    const isMac = process.platform === 'darwin';
    const { BrowserWindow } = require('electron');

    // Helper to find closest radius option
    const isClosest = (target) => {
        const closest = RADIUS_OPTIONS.reduce((prev, curr) => {
            return (Math.abs(curr - currentRadius) < Math.abs(prev - currentRadius) ? curr : prev);
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
                { role: 'togglefullscreen' }
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
                        if (win && win.scrutinizerView) {
                            win.scrutinizerView.webContents.goBack();
                        }
                    }
                },
                {
                    label: 'Forward',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Right' : 'Alt+Right',
                    click: () => {
                        const win = BrowserWindow.getFocusedWindow();
                        if (win && win.scrutinizerView) {
                            win.scrutinizerView.webContents.goForward();
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
                }
            ]
        },
        // Simulation Menu (Custom)
        {
            label: 'Simulation',
            submenu: [
                {
                    label: 'Toggle Foveal Mode',
                    accelerator: 'CmdOrCtrl+F',
                    click: () => sendToOverlays('menu:toggle-foveal')
                },
                { type: 'separator' },
                {
                    label: 'Foveal Radius',
                    submenu: [
                        {
                            label: 'Extra Small (20px)',
                            type: 'radio',
                            checked: isClosest(RADIUS_OPTIONS[0]),
                            click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[0])
                        },
                        {
                            label: 'Small (45px)',
                            type: 'radio',
                            checked: isClosest(RADIUS_OPTIONS[1]),
                            click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[1])
                        },
                        {
                            label: 'Medium (90px)',
                            type: 'radio',
                            checked: isClosest(RADIUS_OPTIONS[2]),
                            click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[2])
                        },
                        {
                            label: 'Large (160px)',
                            type: 'radio',
                            checked: isClosest(RADIUS_OPTIONS[3]),
                            click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[3])
                        },
                        {
                            label: 'Extra Large (250px)',
                            type: 'radio',
                            checked: isClosest(RADIUS_OPTIONS[4]),
                            click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[4])
                        }
                    ]
                },
                {
                    label: 'Peripheral Intensity',
                    submenu: [
                        {
                            label: 'None (0%)',
                            type: 'radio',
                            checked: currentBlur === 0, // We might need to track intensity separately later, but for now 0 is 0
                            click: () => sendToOverlays('menu:set-intensity', 0.0)
                        },
                        {
                            label: 'Low (30%)',
                            type: 'radio',
                            click: () => sendToOverlays('menu:set-intensity', 0.3)
                        },
                        {
                            label: 'Medium (60%)',
                            type: 'radio',
                            checked: true, // Default
                            click: () => sendToOverlays('menu:set-intensity', 0.6)
                        },
                        {
                            label: 'High (100%)',
                            type: 'radio',
                            click: () => sendToOverlays('menu:set-intensity', 1.0)
                        },
                        {
                            label: 'Extreme (150%)',
                            type: 'radio',
                            click: () => sendToOverlays('menu:set-intensity', 1.5)
                        }
                    ]
                },
                {
                    label: 'Visual Memory',
                    submenu: [
                        {
                            label: 'Off (Default)',
                            type: 'radio',
                            checked: true, // Default
                            click: () => sendToOverlays('menu:set-visual-memory', 0)
                        },
                        {
                            label: 'Limited (5 items)',
                            type: 'radio',
                            click: () => sendToOverlays('menu:set-visual-memory', 5)
                        },
                        {
                            label: 'Extended (10 items)',
                            type: 'radio',
                            click: () => sendToOverlays('menu:set-visual-memory', 10)
                        },
                        {
                            label: 'Infinite (Fog of War)',
                            type: 'radio',
                            click: () => sendToOverlays('menu:set-visual-memory', -1)
                        }
                    ]
                },
                {
                    label: 'Mongrel Mode',
                    submenu: [
                        {
                            label: 'Shatter (Static)',
                            type: 'radio',
                            checked: true, // Default
                            click: () => sendToOverlays('menu:set-mongrel-mode', 1)
                        },
                        {
                            label: 'Noise (Dynamic)',
                            type: 'radio',
                            click: () => sendToOverlays('menu:set-mongrel-mode', 0)
                        }
                    ]
                },
                { type: 'separator' },
                {
                    label: 'Chromatic Aberration',
                    type: 'checkbox',
                    checked: true,
                    click: (menuItem) => sendToOverlays('menu:toggle-ca', menuItem.checked)
                },
                { type: 'separator' },
                {
                    label: 'Debug: Show Boundary',
                    type: 'checkbox',
                    checked: false,
                    click: (menuItem) => sendToOverlays('menu:toggle-debug-boundary', menuItem.checked)
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
                    label: 'Learn More',
                    click: async () => {
                        await shell.openExternal('https://github.com/andyed/scrutinizer2025');
                    }
                },
                {
                    label: 'Report Issue',
                    click: async () => {
                        await shell.openExternal('https://github.com/andyed/scrutinizer2025/issues');
                    }
                }
            ]
        }
    ];

    return template;
}

module.exports = { buildMenuTemplate, RADIUS_OPTIONS };