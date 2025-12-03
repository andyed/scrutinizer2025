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
    // Handle screenshots
    ipcMain.on('save-screenshot', (event, { name, dataUrl }) => {
        const fs = require('fs');
        const screenshotsDir = path.join(__dirname, 'screenshots');
        if (!fs.existsSync(screenshotsDir)) {
            fs.mkdirSync(screenshotsDir);
        }
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
        const filePath = path.join(screenshotsDir, `${name}.png`);
        fs.writeFileSync(filePath, base64Data, 'base64');
        console.log(`[Screenshot] Saved ${name} to ${filePath}`);
    });

    win.loadFile(path.resolve(process.cwd(), testFile));

    // Timeout
    setTimeout(() => {
        console.error('TEST TIMED OUT');
        app.exit(1);
    }, 10000);
});
