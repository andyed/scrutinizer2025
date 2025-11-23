const { app } = require('electron');

function buildMenuTemplate(sendToRenderer) {
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
                    label: 'Foveal Radius',
                    submenu: [
                        {
                            label: 'Small (100px)',
                            click: () => sendToRenderer('menu:set-radius', 100)
                        },
                        {
                            label: 'Medium (180px)',
                            click: () => sendToRenderer('menu:set-radius', 180)
                        },
                        {
                            label: 'Large (250px)',
                            click: () => sendToRenderer('menu:set-radius', 250)
                        }
                    ]
                },
                {
                    label: 'Blur Amount',
                    submenu: [
                        {
                            label: 'None (0px)',
                            click: () => sendToRenderer('menu:set-blur', 0)
                        },
                        {
                            label: 'Light (5px)',
                            click: () => sendToRenderer('menu:set-blur', 5)
                        },
                        {
                            label: 'Medium (10px)',
                            click: () => sendToRenderer('menu:set-blur', 10)
                        },
                        {
                            label: 'Heavy (20px)',
                            click: () => sendToRenderer('menu:set-blur', 20)
                        },
                        {
                            label: 'Maximum (30px)',
                            click: () => sendToRenderer('menu:set-blur', 30)
                        }
                    ]
                }
            ]
        }
    ];
}

module.exports = { buildMenuTemplate };