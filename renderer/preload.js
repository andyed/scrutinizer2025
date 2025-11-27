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

        // 1. Text Nodes (unchanged - these are the most important)
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
                    const fontSize = parseFloat(style.fontSize);
                    lineHeight = isNaN(fontSize) ? 16 : fontSize * 1.2;
                }

                // Calculate Density (Mass)
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

        // 2. Media & Visual Elements - detect by tag type
        // (Images, video, canvas, SVG, etc. - these need explicit checks)
        const mediaElements = root.querySelectorAll('img, svg, video, canvas, iframe, picture, embed, object, meter, progress');
        for (const el of mediaElements) {
            const rect = el.getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
                continue;
            }

            if (rect.width > 0 && rect.height > 0) {
                blocks.push({
                    x: rect.left * zoom,
                    y: rect.top * zoom,
                    w: rect.width * zoom,
                    h: rect.height * zoom,
                    type: 0.5, // Media
                    density: 0.8,
                    lineHeight: 0
                });
            }
        }

        // 3. Interactive Elements - comprehensive detection
        // Instead of listing every possible interactive element, use semantic attributes
        const interactiveElements = root.querySelectorAll([
            // Form controls
            'button', 'input', 'textarea', 'select', 'option',
            // Links
            'a[href]',
            // ARIA interactive roles
            '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="tab"]',
            '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="slider"]',
            // Modal/Dialog/Overlay roles
            '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]',
            '[role="menu"]', '[role="listbox"]', '[role="combobox"]',
            // Editable content
            '[contenteditable="true"]',
            // Details/Summary (disclosure widgets)
            'summary', 'details',
            // Media controls
            'audio', 'video',
            // Any element with onclick or tabindex (indicating interactivity)
            '[onclick]', '[tabindex]:not([tabindex="-1"])'
        ].join(', '));

        for (const el of interactiveElements) {
            const rect = el.getBoundingClientRect();
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
                    density: 1.0,
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
    let scrollDebounceTimer = null;

    // Throttled scan function with differentiated handling for scroll vs mutations
    const scanAndSend = (isScrollEvent = false) => {
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
                // Faster throttle for scroll events (16ms ~60fps) vs mutations (100ms)
                const throttleMs = isScrollEvent ? 16 : 100;
                setTimeout(() => {
                    isScanning = false;
                }, throttleMs);
            }
        });
    };

    // Debounced final scan to capture scroll endpoint
    const scheduleFinalScan = () => {
        if (scrollDebounceTimer) {
            clearTimeout(scrollDebounceTimer);
        }
        scrollDebounceTimer = setTimeout(() => {
            // One final scan after scrolling stops to ensure we have the final position
            scanAndSend(true);
        }, 100); // Wait 100ms after last scroll event
    };

    // Trigger scans on relevant events
    if (domAdapter) {
        // Scroll needs fast updates for smooth tracking
        window.addEventListener('scroll', () => {
            scanAndSend(true); // Immediate throttled scan
            scheduleFinalScan(); // Schedule debounced final scan
        }, { passive: true });
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
    // Use capture phase (true) to ensure we catch events even over modals/popups
    let ticking = false;
    let mouseMoveCount = 0;
    window.addEventListener('mousemove', (e) => {
        if (!ticking) {
            window.requestAnimationFrame(() => {
                mouseMoveCount++;
                // Log every 60th event to verify flow
                if (mouseMoveCount % 60 === 0) {
                    console.log(`[Preload] Mouse at (${e.clientX}, ${e.clientY}), zoom=${webFrame.getZoomFactor()}`);
                }
                ipcRenderer.send('browser:mousemove', e.clientX, e.clientY, webFrame.getZoomFactor());
                ticking = false;
            });
            ticking = true;
        }
    }, true); // CAPTURE PHASE - important for catching events over modals

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
