const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const { buildMenuTemplate, RADIUS_OPTIONS } = require('./menu-template');

// Track current settings for menu state
let currentRadius = 180;
let currentBlur = 10;

let mainWindow;

function sendToRenderer(channel, ...args) {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
        win.webContents.send(channel, ...args);
    }
}

function rebuildMenu() {
    const menu = Menu.buildFromTemplate(buildMenuTemplate(sendToRenderer, currentRadius, currentBlur));
    Menu.setApplicationMenu(menu);
}

// Listen for settings changes from renderer to update menu (global listeners)
ipcMain.on('settings:radius-changed', (event, radius) => {
    currentRadius = radius;
    rebuildMenu();
});

ipcMain.on('settings:blur-changed', (event, blur) => {
    currentBlur = blur;
    rebuildMenu();
});

function createScrutinizerWindow(startUrl) {
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true
    }
  });

  win.loadFile('renderer/index.html');

  win.webContents.once('did-finish-load', () => {
    win.webContents.send('settings:radius-options', RADIUS_OPTIONS);
  });

  // Once renderer is ready, tell it to navigate the webview
  if (startUrl) {
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('popup:navigate', startUrl);
    });
  }

  win.on('closed', () => {
    // Let GC reclaim window; nothing else to do
  });

  return win;
}

function createWindow() {
  mainWindow = createScrutinizerWindow();

  // Build and set application menu
  rebuildMenu();

  // Open DevTools for debugging
  mainWindow.webContents.openDevTools();

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
