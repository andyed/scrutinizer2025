# Menu and Settings Implementation (Work-in-Progress)

This document captures the menu and settings persistence implementation that was in-progress before reverting runtime changes.

## menu-template.js (current version)

```js
const { app } = require('electron');

function buildMenuTemplate(currentSettings, sendToRenderer) {
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
            label: 'File',
            submenu: [
                {
                    label: 'New Window',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => sendToRenderer('menu:new-window')
                },
                {
                    label: 'Close Window',
                    accelerator: 'CmdOrCtrl+W',
                    role: 'close'
                },
                { type: 'separator' },
                isMac ? { role: 'close' } : { role: 'quit' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Toggle Foveal Mode',
                    // NOTE: Space accelerator removed in current builds to
                    // avoid conflicts with native page scrolling.
                    click: () => sendToRenderer('menu:toggle-foveal')
                },
                { type: 'separator' },
                {
                    label: 'Foveal Radius',
                    submenu: [
                        {
                            label: 'Small (100px)',
                            type: 'radio',
                            checked: currentSettings.fovealRadius === 100,
                            click: () => sendToRenderer('menu:set-radius', 100)
                        },
                        {
                            label: 'Medium (180px)',
                            type: 'radio',
                            checked: currentSettings.fovealRadius === 180,
                            click: () => sendToRenderer('menu:set-radius', 180)
                        },
                        {
                            label: 'Large (250px)',
                            type: 'radio',
                            checked: currentSettings.fovealRadius === 250,
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
                            checked: currentSettings.blurRadius === 0,
                            click: () => sendToRenderer('menu:set-blur', 0)
                        },
                        {
                            label: 'Light (5px)',
                            type: 'radio',
                            checked: currentSettings.blurRadius === 5,
                            click: () => sendToRenderer('menu:set-blur', 5)
                        },
                        {
                            label: 'Medium (10px)',
                            type: 'radio',
                            checked: currentSettings.blurRadius === 10,
                            click: () => sendToRenderer('menu:set-blur', 10)
                        },
                        {
                            label: 'Heavy (20px)',
                            type: 'radio',
                            checked: currentSettings.blurRadius === 20,
                            click: () => sendToRenderer('menu:set-blur', 20)
                        },
                        {
                            label: 'Maximum (30px)',
                            type: 'radio',
                            checked: currentSettings.blurRadius === 30,
                            click: () => sendToRenderer('menu:set-blur', 30)
                        }
                    ]
                },
                { type: 'separator' },
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => sendToRenderer('menu:reload')
                },
                {
                    label: 'Toggle Developer Tools',
                    accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
                    click: (item, focusedWindow) => {
                        if (focusedWindow) focusedWindow.webContents.toggleDevTools();
                    }
                }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Documentation',
                    click: () => sendToRenderer('menu:open-docs')
                },
                {
                    label: 'Keyboard Shortcuts',
                    click: () => sendToRenderer('menu:show-shortcuts')
                },
                { type: 'separator' },
                {
                    label: 'About Scrutinizer',
                    click: () => sendToRenderer('menu:about')
                }
            ]
        }
    ];
}

module.exports = { buildMenuTemplate };
```

## main.js menu wiring (current version)

```js
const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const { buildMenuTemplate } = require('./menu-template');
app.disableHardwareAcceleration();

let mainWindow;
let Store;
let store;

async function initStore() {
  const module = await import('electron-store');
  Store = module.default;
  store = new Store();
}

function sendToRenderer(channel, ...args) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function updateMenu() {
  if (!store) return;

  const currentSettings = {
    fovealRadius: store.get('fovealRadius', 180),
    blurRadius: store.get('blurRadius', 10)
  };

  const template = buildMenuTemplate(currentSettings, sendToRenderer);
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function createWindow() {
  await initStore();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 1000,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true
    }
  });

  const indexPath = path.join(__dirname, 'renderer', 'index.html');
  mainWindow.loadFile(indexPath);
  console.log('Loaded index.html');

  updateMenu();

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

ipcMain.on('settings-changed', () => {
  updateMenu();
});

app.on('ready', createWindow);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});
```

## renderer settings store (current version)

```js
let store;

async function init() {
    if (store) return;

    const Store = (await import('electron-store')).default;
    store = new Store({
        defaults: {
            fovealRadius: 180,
            blurRadius: 10,
            desaturationAmount: 1.0
        }
    });
}

function get(key) {
    if (!store) return undefined;
    return store.get(key);
}

function set(key, value) {
    if (!store) return;
    store.set(key, value);
}

function getAll() {
    if (!store) return {};
    return store.store;
}

function reset() {
    if (!store) return;
    store.clear();
}

module.exports = {
    init,
    get,
    set,
    getAll,
    reset
};
```

This doc can be used to reintroduce the menu and settings logic later after reverting the runtime changes to a known-good git state.
