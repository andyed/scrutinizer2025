const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

if (process.argv.length < 3) {
    console.error('Usage: electron run-test.js <test-file.html>');
    app.exit(1);
}

const testFile = process.argv[2];

app.whenReady().then(() => {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            offscreen: true // Run headless-ish
        },
        show: false
    });

    // Handle logs
    ipcMain.on('log', (event, msg) => {
        console.log('[Test Log]', msg);
    });
    ipcMain.on('log:renderer', (event, msg) => {
        console.log('[Renderer Log]', msg);
    });

    // Handle results
    ipcMain.on('test-result', (event, result) => {
        if (result.success) {
            console.log('TEST PASSED:', result.message);
            app.exit(0);
        } else {
            console.error('TEST FAILED:', result.message);
            if (result.details) console.error(result.details);
            app.exit(1);
        }
    });

    // Handle screenshots (optional, mock for now)
    ipcMain.on('save-screenshot', (event, { name, dataUrl }) => {
        console.log(`[Screenshot] Saved ${name}`);
    });

    win.loadFile(path.resolve(process.cwd(), testFile));

    // Timeout
    setTimeout(() => {
        console.error('TEST TIMED OUT');
        app.exit(1);
    }, 10000);
});
