const { ipcRenderer, webFrame } = require('electron');

console.log('[Preload] ✅ Script loaded and executing');

// --- INLINED DomAdapter ---
class DomAdapter {
    constructor() {
        // Cache for performance optimization could go here
    }

    /**
     * Scan the DOM and return a list of StructureBlocks.
     * @param {HTMLElement} root - Root element to scan (usually document.body)
     * @param {number} scrollX - Current scroll X
     * @param {number} scrollY - Current scroll Y
     * @returns {Array} List of blocks
     */
    scan(root, scrollX = 0, scrollY = 0) {
        const blocks = [];
        const zoom = webFrame.getZoomFactor();

        // 1. Text Nodes
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        let node;
        while (node = walker.nextNode()) {
            const range = document.createRange();
            range.selectNodeContents(node);
            const rects = range.getClientRects();

            if (rects.length > 0) {
                const parent = node.parentElement;
                if (!parent) continue;

                const style = window.getComputedStyle(parent);

                // Parse Line Height
                let lineHeight = parseFloat(style.lineHeight);
                if (isNaN(lineHeight)) {
                    // Normal line height is roughly 1.2 * fontSize
                    const fontSize = parseFloat(style.fontSize);
                    lineHeight = isNaN(fontSize) ? 16 : fontSize * 1.2;
                }

                // Calculate Density (Mass)
                // Font weight: 100-900. Map to 0.2 - 1.0
                const weight = parseFloat(style.fontWeight) || 400;
                const density = Math.min(1.0, Math.max(0.2, weight / 900));

                // Add blocks for each line rect
                for (let i = 0; i < rects.length; i++) {
                    const rect = rects[i];
                    blocks.push({
                        x: rect.left * zoom,
                        y: rect.top * zoom,
                        w: rect.width * zoom,
                        h: rect.height * zoom,
                        type: 1.0, // Text
                        density: density,
                        lineHeight: lineHeight * zoom
                    });
                }
            }
        }

        // 2. Images & Iframes
        const images = root.querySelectorAll('img, svg, video, canvas, iframe');
        for (const img of images) {
            const rect = img.getBoundingClientRect();
            // Skip if off-screen
            if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
                continue;
            }

            if (rect.width > 0 && rect.height > 0) {
                blocks.push({
                    x: rect.left * zoom,
                    y: rect.top * zoom,
                    w: rect.width * zoom,
                    h: rect.height * zoom,
                    type: 0.5, // Image
                    density: 0.8, // High density for images
                    lineHeight: 0
                });
            }
        }

        // 3. UI Elements (Buttons, Inputs, Textareas)
        const uiElements = root.querySelectorAll('button, input, textarea, select, a.button, [role="button"], [contenteditable="true"]');
        for (const el of uiElements) {
            const rect = el.getBoundingClientRect();
            // Skip if off-screen
            if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
                continue;
            }

            if (rect.width > 0 && rect.height > 0) {
                blocks.push({
                    x: rect.left * zoom,
                    y: rect.top * zoom,
                    w: rect.width * zoom,
                    h: rect.height * zoom,
                    type: 0.0, // UI
                    density: 1.0, // Solid
                    lineHeight: 0
                });
            }
        }

        return blocks;
    }
}
// --- END INLINED DomAdapter ---

window.addEventListener('DOMContentLoaded', () => {
    console.log('[Preload] DOMContentLoaded fired');

    // Initialize DomAdapter safely
    let domAdapter = null;
    try {
        domAdapter = new DomAdapter();
        console.log('[Preload] DomAdapter initialized successfully');
    } catch (err) {
        console.error('[Preload] Failed to initialize DomAdapter:', err);
    }

    let isScanning = false;

    // Throttled scan function
    const scanAndSend = () => {
        if (!domAdapter || isScanning) return;
        isScanning = true;

        // Run in next frame to avoid blocking main thread immediately
        requestAnimationFrame(() => {
            try {
                // Scan the DOM
                const blocks = domAdapter.scan(document.body);
                ipcRenderer.send('structure-update', blocks);
            } catch (err) {
                console.error('[Preload] Scan failed:', err);
            } finally {
                // Simple throttle: wait 100ms before allowing next scan
                setTimeout(() => {
                    isScanning = false;
                }, 100);
            }
        });
    };

    // Trigger scans on relevant events
    if (domAdapter) {
        window.addEventListener('scroll', scanAndSend, { passive: true });
        window.addEventListener('resize', scanAndSend, { passive: true });

        // Observer for DOM mutations
        const observer = new MutationObserver((mutations) => {
            scanAndSend();
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
        });

        // Initial scan
        setTimeout(scanAndSend, 500); // Wait a bit for layout to settle
    }

    // Track mouse movement for foveal effect
    let ticking = false;
    window.addEventListener('mousemove', (e) => {
        if (!ticking) {
            window.requestAnimationFrame(() => {
                ipcRenderer.send('browser:mousemove', e.clientX, e.clientY, webFrame.getZoomFactor());
                ticking = false;
            });
            ticking = true;
        }
    });

    // Track zoom/resize changes
    window.addEventListener('resize', () => {
        ipcRenderer.send('browser:zoom-changed', webFrame.getZoomFactor());
    });

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
