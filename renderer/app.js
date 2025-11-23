/**
 * Application entry point
 * Initializes Scrutinizer and sets up UI event handlers
 */

let scrutinizer;
let webview;

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing Scrutinizer...');

    // Get elements
    webview = document.getElementById('webview');
    const toggleBtn = document.getElementById('toggle-btn');
    const urlInput = document.getElementById('url-input');
    const navigateBtn = document.getElementById('go-btn');
    const backBtn = document.getElementById('back-btn');
    const forwardBtn = document.getElementById('forward-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const radiusSlider = document.getElementById('radius-slider');
    const radiusValue = document.getElementById('radius-value');
    const statusText = document.getElementById('status-text');

    // Initialize Scrutinizer once webview is ready
    webview.addEventListener('dom-ready', () => {
        console.log('Webview ready');
        scrutinizer = new Scrutinizer(webview, CONFIG);
        statusText.textContent = 'Ready - Press Option+Space or click Enable to start';
    });

    // Navigation controls
    backBtn.addEventListener('click', () => {
        if (webview.canGoBack()) webview.goBack();
    });

    forwardBtn.addEventListener('click', () => {
        if (webview.canGoForward()) webview.goForward();
    });

    refreshBtn.addEventListener('click', () => {
        webview.reload();
    });

    // Toggle button
    toggleBtn.addEventListener('click', async () => {
        const enabled = await scrutinizer.toggle();
        // toggleBtn.textContent = enabled ? 'Disable Foveal Mode' : 'Enable Foveal Mode'; // Keep icon only
        toggleBtn.classList.toggle('active', enabled);
        statusText.textContent = enabled ? 'Foveal mode active' : 'Foveal mode disabled';
    });

    // URL navigation
    const navigate = () => {
        if (navigateBtn.textContent === 'Stop') {
            webview.stop();
            return;
        }

        let url = urlInput.value.trim();
        if (!url) return;

        // Add protocol if missing
        if (!url.match(/^https?:\/\//)) {
            url = 'https://' + url;
        }

        webview.src = url;
    };

    navigateBtn.addEventListener('click', navigate);
    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') navigate();
    });

    // Update status and button when page loads
    webview.addEventListener('did-start-loading', () => {
        statusText.textContent = 'Loading...';
        statusText.classList.add('loading');
        navigateBtn.textContent = 'Stop';
    });

    webview.addEventListener('did-stop-loading', () => {
        statusText.textContent = 'Page loaded';
        statusText.classList.remove('loading');
        urlInput.value = webview.getURL();
        navigateBtn.textContent = 'Go';
    });

    webview.addEventListener('did-fail-load', (event) => {
        if (event.errorCode !== -3) { // Ignore aborted loads
            statusText.textContent = 'Failed to load page';
            statusText.classList.remove('loading');
        }
        navigateBtn.textContent = 'Go';
    });

    // Foveal radius slider
    radiusSlider.addEventListener('input', (e) => {
        const radius = parseInt(e.target.value);
        radiusValue.textContent = radius + 'px';
        if (scrutinizer) {
            scrutinizer.config.fovealRadius = radius;
        }
    });

    // Blur radius slider
    const blurSlider = document.getElementById('blur-slider');
    const blurValue = document.getElementById('blur-value');

    blurSlider.addEventListener('input', (e) => {
        const radius = parseInt(e.target.value);
        blurValue.textContent = radius + 'px';
        if (scrutinizer) {
            scrutinizer.updateBlurRadius(radius);
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Space to toggle
        if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
            e.preventDefault();
            toggleBtn.click();
        }

        // Escape to disable
        if (e.code === 'Escape' && scrutinizer && scrutinizer.enabled) {
            toggleBtn.click();
        }
    });

    // Mouse wheel to adjust foveal size
    document.addEventListener('wheel', (e) => {
        if (scrutinizer && scrutinizer.enabled && e.altKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -5 : 5;
            scrutinizer.updateFovealRadius(delta);
            radiusSlider.value = scrutinizer.config.fovealRadius;
            radiusValue.textContent = scrutinizer.config.fovealRadius + 'px';
        }
    }, { passive: false });

    console.log('Scrutinizer initialized');
});
