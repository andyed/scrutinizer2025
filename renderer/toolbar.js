const { ipcRenderer } = require('electron');

const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');
const urlTrigger = document.getElementById('url-trigger');
const foveaToggleBtn = document.getElementById('fovea-toggle-btn');
// --- Event Listeners ---
backBtn.addEventListener('click', () => { ipcRenderer.send('toolbar:navigate-back'); });
forwardBtn.addEventListener('click', () => { ipcRenderer.send('toolbar:navigate-forward'); });
reloadBtn.addEventListener('click', () => { ipcRenderer.send('toolbar:reload'); });
foveaToggleBtn.addEventListener('click', () => { ipcRenderer.send('toolbar:toggle-fovea'); });

// Open URL Dialog
urlTrigger.addEventListener('click', () => {
    ipcRenderer.send('toolbar:open-url-dialog');
});

// --- IPC Listeners ---

ipcRenderer.on('toolbar:update-url', (event, url) => {
    urlTrigger.textContent = url || 'Enter URL or search...';
    urlTrigger.title = url || 'Click to edit URL';
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

ipcRenderer.on('toolbar:set-version', (event, version) => {
    const el = document.getElementById('app-version');
    if (el) el.innerText = `v${version}`;
});
