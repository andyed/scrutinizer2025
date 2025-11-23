const { app } = require('electron');

function buildMenuTemplate(sendToRenderer, currentRadius = 180, currentBlur = 10) {
    const isMac = process.platform === 'darwin';

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
            label: 'View',
            submenu: [
                {
                    label: 'Toggle Foveal Mode',
                    accelerator: 'Space',
                    click: () => sendToRenderer('menu:toggle-foveal')
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
                            checked: currentRadius === 100,
                            click: () => sendToRenderer('menu:set-radius', 100)
                        },
                        {
                            label: 'Medium (180px)',
                            type: 'radio',
                            checked: currentRadius === 180,
                            click: () => sendToRenderer('menu:set-radius', 180)
                        },
                        {
                            label: 'Large (250px)',
                            type: 'radio',
                            checked: currentRadius === 250,
                            click: () => sendToRenderer('menu:set-radius', 250)
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
                            click: () => sendToRenderer('menu:set-blur', 0)
                        },
                        {
                            label: 'Light (5px)',
                            type: 'radio',
                            checked: currentBlur === 5,
                            click: () => sendToRenderer('menu:set-blur', 5)
                        },
                        {
                            label: 'Medium (10px)',
                            type: 'radio',
                            checked: currentBlur === 10,
                            click: () => sendToRenderer('menu:set-blur', 10)
                        },
                        {
                            label: 'Heavy (20px)',
                            type: 'radio',
                            checked: currentBlur === 20,
                            click: () => sendToRenderer('menu:set-blur', 20)
                        },
                        {
                            label: 'Maximum (30px)',
                            type: 'radio',
                            checked: currentBlur === 30,
                            click: () => sendToRenderer('menu:set-blur', 30)
                        }
                    ]
                }
            ]
        }
    ];
}

module.exports = { buildMenuTemplate };