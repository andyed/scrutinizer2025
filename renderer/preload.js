const { ipcRenderer } = require('electron');

console.log('[Preload] ✅ Script loaded and executing');

window.addEventListener('DOMContentLoaded', () => {
    console.log('[Preload] DOMContentLoaded fired');
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

    // Track input/textarea changes for immediate visual feedback
    window.addEventListener('input', (e) => {
        console.log('[Preload] Input event:', e.target.tagName, e.target.type);
        // Only trigger for actual text input fields
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            console.log('[Preload] Sending input-change to host');
            ipcRenderer.sendToHost('input-change');
        }
    }, true);

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

    // Intercept clicks on links with target="_blank"
    window.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link && link.target === '_blank' && link.href) {
            e.preventDefault();
            console.log('[Preload] Intercepted target=_blank link:', link.href);
            ipcRenderer.sendToHost('open-new-window', link.href);
        }
    }, true); // Use capture phase to intercept before page handlers
});
