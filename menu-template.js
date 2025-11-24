const { app } = require('electron');

const RADIUS_OPTIONS = [100, 180, 250];

function buildMenuTemplate(sendToRenderer, sendToOverlays, currentRadius = 180, currentBlur = 10) {
    const isMac = process.platform === 'darwin';
    const { BrowserWindow } = require('electron');

    return [
        ...(isMac ? [{
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }] : []),
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Window',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => {
                        const { dialog } = require('electron');
                        dialog.showMessageBox({
                            type: 'question',
                            message: 'New Window URL',
                            detail: 'Enter URL in the console for now (TODO: proper dialog)',
                            buttons: ['OK']
                        });
                    }
                },
                {
                    label: 'Open URL...',
                    // Accelerator shown but handled via globalShortcut in main.js
                    accelerator: 'CmdOrCtrl+L',
                    click: () => {
                        const win = BrowserWindow.getFocusedWindow();
                        if (!win || !win.scrutinizerView) return;
                        
                        const currentURL = win.scrutinizerView.webContents.getURL();
                        const path = require('path');
                        
                        // Create URL input dialog window
                        const dialog = new BrowserWindow({
                            width: 500,
                            height: 160,
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
        {
            label: 'Navigate',
            submenu: [
                {
                    label: 'Back',
                    accelerator: 'CmdOrCtrl+Left',
                    click: () => {
                        const win = BrowserWindow.getFocusedWindow();
                        if (win && win.scrutinizerView) {
                            win.scrutinizerView.webContents.goBack();
                        }
                    }
                },
                {
                    label: 'Forward',
                    accelerator: 'CmdOrCtrl+Right',
                    click: () => {
                        const win = BrowserWindow.getFocusedWindow();
                        if (win && win.scrutinizerView) {
                            win.scrutinizerView.webContents.goForward();
                        }
                    }
                },
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        const win = BrowserWindow.getFocusedWindow();
                        if (win && win.scrutinizerView) {
                            win.scrutinizerView.webContents.reload();
                        }
                    }
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Toggle Foveal Mode',
                    accelerator: 'CmdOrCtrl+F',
                    click: () => sendToOverlays('menu:toggle-foveal')
                },
                { type: 'separator' },
                {
                    label: 'Toggle Developer Tools',
                    accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
                    role: 'toggleDevTools'
                },
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    role: 'reload'
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
        }
    ];
}

module.exports = { buildMenuTemplate, RADIUS_OPTIONS };