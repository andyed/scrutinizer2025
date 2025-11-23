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
