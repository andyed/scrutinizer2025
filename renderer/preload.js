const { ipcRenderer } = require('electron');

console.log('[Preload] ✅ Script loaded and executing');

window.addEventListener('DOMContentLoaded', () => {
    console.log('[Preload] DOMContentLoaded fired');
    
    // Forward keyboard events to main process for shortcuts
    window.addEventListener('keydown', (e) => {
        // Forward Escape and Left/Right arrow keys
        if (e.code === 'Escape' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
            console.log('[Preload] Forwarding key:', e.code);
            ipcRenderer.send('keydown', {
                code: e.code,
                key: e.key,
                altKey: e.altKey,
                ctrlKey: e.ctrlKey,
                metaKey: e.metaKey,
                shiftKey: e.shiftKey
            });
        }
    }, true); // Use capture phase to get events before page handlers

    // Intercept clicks on links with target="_blank"
    window.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link && link.target === '_blank' && link.href) {
            e.preventDefault();
            console.log('[Preload] Intercepted target=_blank link:', link.href);
            // Use 'send' instead of 'sendToHost' for BrowserWindow
            ipcRenderer.send('open-new-window', link.href);
        }
    }, true); // Use capture phase to intercept before page handlers
});
