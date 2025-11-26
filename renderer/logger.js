const { ipcRenderer } = require('electron');

const Logger = {
    log: (...args) => {
        const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
        console.log(...args);
        ipcRenderer.send('log:renderer', msg);
    },
    error: (...args) => {
        const msg = '[ERROR] ' + args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
        console.error(...args);
        ipcRenderer.send('log:renderer', msg);
    },
    warn: (...args) => {
        const msg = '[WARN] ' + args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
        console.warn(...args);
        ipcRenderer.send('log:renderer', msg);
    }
};

module.exports = Logger;
