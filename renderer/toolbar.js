const { ipcRenderer } = require('electron');

const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');
const urlTrigger = document.getElementById('url-trigger');
const foveaToggleBtn = document.getElementById('fovea-toggle-btn');
const studyContainer = document.getElementById('study-container');
const studyLabel = document.getElementById('study-label');
const studyInstruction = document.getElementById('study-instruction');
const studyOrigin = document.getElementById('study-origin');
const studyDone = document.getElementById('study-done');
const browseElements = Array.from(document.querySelectorAll('.browse-only'));

const viewState = {
    mode: 'browse',
    taskId: null,
    instructions: null,
    currentUrl: '',
    showingUrl: false
};

function currentOrigin() {
    try {
        return new URL(viewState.currentUrl).origin;
    } catch {
        return 'Task page';
    }
}

function renderToolbar() {
    const studying = viewState.mode === 'study';
    browseElements.forEach((element) => element.classList.toggle('hidden', studying));
    studyContainer.classList.toggle('hidden', !studying);
    if (!studying) return;

    const instructions = viewState.instructions || 'Explore this page in Scrutinizer.';
    const centerText = viewState.showingUrl ? viewState.currentUrl : instructions;
    studyLabel.textContent = 'Task';
    studyLabel.title = viewState.taskId ? `Task ID: ${viewState.taskId}` : 'Study task';
    studyInstruction.textContent = centerText;
    studyInstruction.title = centerText;
    studyInstruction.setAttribute(
        'aria-label',
        viewState.showingUrl ? `Task URL: ${centerText}` : `Task instructions: ${centerText}`
    );
    studyOrigin.textContent = `${currentOrigin()} ▾`;
    studyOrigin.title = viewState.showingUrl ? 'Show task instructions' : 'Show full task URL';
    studyOrigin.setAttribute('aria-label', studyOrigin.title);
}

backBtn.addEventListener('click', () => { ipcRenderer.send('toolbar:navigate-back'); });
forwardBtn.addEventListener('click', () => { ipcRenderer.send('toolbar:navigate-forward'); });
reloadBtn.addEventListener('click', () => { ipcRenderer.send('toolbar:reload'); });
foveaToggleBtn.addEventListener('click', () => { ipcRenderer.send('toolbar:toggle-fovea'); });

urlTrigger.addEventListener('click', () => {
    ipcRenderer.send('toolbar:open-url-dialog');
});
studyOrigin.addEventListener('click', () => {
    viewState.showingUrl = !viewState.showingUrl;
    renderToolbar();
});
studyDone.addEventListener('click', () => {
    ipcRenderer.send('toolbar:study-done');
});

ipcRenderer.on('toolbar:update-url', (event, url) => {
    viewState.currentUrl = url || viewState.currentUrl;
    if (viewState.mode === 'study') {
        renderToolbar();
    } else {
        urlTrigger.textContent = url || 'Enter URL or search...';
        urlTrigger.title = url || 'Click to edit URL';
    }
});

ipcRenderer.on('toolbar:enter-study', (event, state) => {
    viewState.mode = 'study';
    viewState.taskId = state.taskId || null;
    viewState.instructions = state.instructions || null;
    viewState.currentUrl = state.currentUrl || '';
    viewState.showingUrl = false;
    renderToolbar();
});

ipcRenderer.on('toolbar:show-study-url', () => {
    if (viewState.mode !== 'study') return;
    viewState.showingUrl = !viewState.showingUrl;
    renderToolbar();
});

ipcRenderer.on('toolbar:exit-study', () => {
    viewState.mode = 'browse';
    viewState.taskId = null;
    viewState.instructions = null;
    viewState.showingUrl = false;
    urlTrigger.textContent = viewState.currentUrl || 'Enter URL or search...';
    urlTrigger.title = viewState.currentUrl || 'Click to edit URL';
    renderToolbar();
});

ipcRenderer.on('toolbar:update-loading', (event, isLoading) => {
    foveaToggleBtn.classList.toggle('loading', isLoading);
});

ipcRenderer.on('toolbar:fovea-state', (event, isEnabled) => {
    foveaToggleBtn.classList.toggle('active', isEnabled);
});

ipcRenderer.on('toolbar:update-nav-state', (event, { canGoBack, canGoForward }) => {
    backBtn.disabled = !canGoBack;
    forwardBtn.disabled = !canGoForward;
});

ipcRenderer.on('toolbar:set-version', (event, version) => {
    const el = document.getElementById('app-version');
    if (el) el.innerText = `v${version}`;
});

ipcRenderer.on('toolbar:congestion-processing', (event, processing) => {
    foveaToggleBtn.classList.toggle('processing', processing);
});

renderToolbar();
