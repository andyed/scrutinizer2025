const { app } = require('electron');

const RADIUS_OPTIONS = [100, 180, 250];

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
                            checked: currentRadius === RADIUS_OPTIONS[0],
                            click: () => sendToRenderer('menu:set-radius', RADIUS_OPTIONS[0])
                        },
                        {
                            label: 'Medium (180px)',
                            type: 'radio',
                            checked: currentRadius === RADIUS_OPTIONS[1],
                            click: () => sendToRenderer('menu:set-radius', RADIUS_OPTIONS[1])
                        },
                        {
                            label: 'Large (250px)',
                            type: 'radio',
                            checked: currentRadius === RADIUS_OPTIONS[2],
                            click: () => sendToRenderer('menu:set-radius', RADIUS_OPTIONS[2])
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

module.exports = { buildMenuTemplate, RADIUS_OPTIONS };