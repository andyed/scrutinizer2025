const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
    // Track mouse movement and send to host
    window.addEventListener('mousemove', (e) => {
        ipcRenderer.sendToHost('mousemove', e.clientX, e.clientY);
    });

    // Track scroll events
    window.addEventListener('scroll', () => {
        ipcRenderer.sendToHost('scroll');
    });

    // Forward keyboard events to host for shortcuts
    window.addEventListener('keydown', (e) => {
        // Forward Escape and Left/Right arrow keys
        if (e.code === 'Escape' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
            ipcRenderer.sendToHost('keydown', {
                code: e.code,
                key: e.key,
                altKey: e.altKey,
                ctrlKey: e.ctrlKey,
                metaKey: e.metaKey,
                shiftKey: e.shiftKey
            });
        }
    }, true); // Use capture phase to get events before page handlers

    // Track DOM mutations
    const observer = new MutationObserver(() => {
        ipcRenderer.sendToHost('mutation');
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
    });
});
