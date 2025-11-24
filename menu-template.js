const { app, shell } = require('electron');

const RADIUS_OPTIONS = [100, 180, 250];

function buildMenuTemplate(sendToRenderer, sendToOverlays, currentRadius = 180, currentBlur = 10) {
    const isMac = process.platform === 'darwin';
    const { BrowserWindow } = require('electron');

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
                        // Trigger the same flow as open-new-window
                        const win = BrowserWindow.getFocusedWindow();
                        if (win && win.scrutinizerView) {
                            // For now, just open default
                            const { ipcMain } = require('electron');
                            // This is a bit hacky to reach back to main, but we can just emit an event or use the exposed function if we had it.
                            // Better: just use the existing IPC handler if possible, or replicate logic.
                            // Since we don't have direct access to createScrutinizerWindow here, we'll send an IPC to main
                            // But wait, we are IN the main process here (menu template is used by main).
                            // We can't easily call createScrutinizerWindow from here without circular deps or passing it in.
                            // Let's stick to the existing behavior or improve it.
                            // The previous implementation showed a message box. Let's keep it simple or improve.
                            // Let's actually make it useful: Open the URL dialog for a NEW window?
                            // Or just open a new default window.

                            // Let's try to send a signal to the main process to open a new window.
                            // Since we are in main process, we can use a global event emitter or just require main? No, circular dependency.
                            // We'll stick to the previous "New Window" behavior for now but maybe just open a default one?
                            // Actually, the previous code showed a dialog. Let's just open a new window with default URL.
                            // We can emit an event on the app object?
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

                        // Create URL input dialog window
                        const dialog = new BrowserWindow({
                            width: 500,
                            height: 180, // Increased height for better spacing
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
                            label: 'Small (100px)',
                            type: 'radio',
                            checked: currentRadius === RADIUS_OPTIONS[0],
                            click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[0])
                        },
                        {
                            label: 'Medium (180px)',
                            type: 'radio',
                            checked: currentRadius === RADIUS_OPTIONS[1],
                            click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[1])
                        },
                        {
                            label: 'Large (250px)',
                            type: 'radio',
                            checked: currentRadius === RADIUS_OPTIONS[2],
                            click: () => sendToOverlays('menu:set-radius', RADIUS_OPTIONS[2])
                        }
                    ]
                },
                {
                    label: 'Blur Amount',
                    submenu: [
                        {
                            label: 'None (0px)',
                            type: 'radio',
                            checked: currentBlur === 0,
                            click: () => sendToOverlays('menu:set-blur', 0)
                        },
                        {
                            label: 'Light (5px)',
                            type: 'radio',
                            checked: currentBlur === 5,
                            click: () => sendToOverlays('menu:set-blur', 5)
                        },
                        {
                            label: 'Medium (10px)',
                            type: 'radio',
                            checked: currentBlur === 10,
                            click: () => sendToOverlays('menu:set-blur', 10)
                        },
                        {
                            label: 'Heavy (20px)',
                            type: 'radio',
                            checked: currentBlur === 20,
                            click: () => sendToOverlays('menu:set-blur', 20)
                        },
                        {
                            label: 'Maximum (30px)',
                            type: 'radio',
                            checked: currentBlur === 30,
                            click: () => sendToOverlays('menu:set-blur', 30)
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