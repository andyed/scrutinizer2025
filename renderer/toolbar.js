const { ipcRenderer } = require('electron');

const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');
const urlInput = document.getElementById('url-input');
const foveaToggleBtn = document.getElementById('fovea-toggle-btn');

// --- Event Listeners ---

backBtn.addEventListener('click', () => {
    ipcRenderer.send('toolbar:navigate-back');
});

forwardBtn.addEventListener('click', () => {
    ipcRenderer.send('toolbar:navigate-forward');
});

reloadBtn.addEventListener('click', () => {
    ipcRenderer.send('toolbar:reload');
});

foveaToggleBtn.addEventListener('click', () => {
    ipcRenderer.send('toolbar:toggle-fovea');
});

urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        let url = urlInput.value.trim();
        if (!url) return;

        // Simple protocol check
        if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
            // Check if it looks like a domain
            if (url.includes('.') && !url.includes(' ')) {
                url = 'https://' + url;
            } else {
                // Fallback to search (Google)
                url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
            }
        }

        ipcRenderer.send('toolbar:navigate-to', url);
        urlInput.blur(); // Remove focus after navigation
    }
});

// Select all text on focus for easy replacement
urlInput.addEventListener('focus', () => {
    urlInput.select();
});

// --- IPC Listeners ---

ipcRenderer.on('toolbar:update-url', (event, url) => {
    // Don't update if user is typing (focused) unless it's a new page load
    if (document.activeElement !== urlInput) {
        urlInput.value = url;
    }
});

ipcRenderer.on('toolbar:update-loading', (event, isLoading) => {
    if (isLoading) {
        foveaToggleBtn.classList.add('loading');
    } else {
        foveaToggleBtn.classList.remove('loading');
    }
});

ipcRenderer.on('toolbar:fovea-state', (event, isEnabled) => {
    if (isEnabled) {
        foveaToggleBtn.classList.add('active');
    } else {
        foveaToggleBtn.classList.remove('active');
    }
});

ipcRenderer.on('toolbar:update-nav-state', (event, { canGoBack, canGoForward }) => {
    backBtn.disabled = !canGoBack;
    forwardBtn.disabled = !canGoForward;
});
