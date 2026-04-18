const { ipcRenderer, webFrame } = require('electron');
const { classifyPrimitive } = require('./dom-primitive-classifier');

console.log('[Preload] ✅ Script loaded and executing');

// --- INLINED DomAdapter ---
class DomAdapter {
    constructor() {
        // Cache for performance optimization could go here
    }

    /**
     * Classify an element's ARIA/semantic role into a numeric ID (0–12).
     * Used by Blueprint mode to color-code bounding boxes by role type.
     */
    classifyRole(el) {
        const tag = el.tagName?.toLowerCase();
        const role = el.getAttribute?.('role');
        const type = el.getAttribute?.('type');

        // Explicit ARIA roles take priority
        if (role === 'button') return 1;
        if (role === 'link') return 2;
        if (role === 'searchbox' || role === 'combobox') return 3;
        if (role === 'heading') return 4;
        if (role === 'navigation' || role === 'menubar') return 5;
        if (role === 'list' || role === 'listbox') return 7;
        if (role === 'menu' || role === 'menuitem' || role === 'tab' || role === 'tablist') return 8;
        if (role === 'checkbox' || role === 'radio' || role === 'switch') return 9;
        if (role === 'dialog' || role === 'alertdialog') return 10;
        if (role === 'banner' || role === 'toolbar') return 11;
        if (role === 'contentinfo') return 12;

        // Tag-based fallback
        if (tag === 'button' || (tag === 'input' && (type === 'submit' || type === 'reset' || type === 'button'))) return 1;
        if (tag === 'a') return 2;
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return 3;
        if (/^h[1-6]$/.test(tag)) return 4;
        if (tag === 'nav') return 5;
        if (tag === 'img' || tag === 'svg' || tag === 'video' || tag === 'canvas' || tag === 'picture') return 6;
        if (tag === 'ul' || tag === 'ol') return 7;
        if (tag === 'menu') return 8;
        if (tag === 'dialog') return 10;
        if (tag === 'header') return 11;
        if (tag === 'footer') return 12;

        return 0;
    }

    /**
     * Classify an element into one of 8 perceptual primitive types for the
     * DOM-aware peripheral perception path. Delegates to the standalone
     * classifier module so Jest can test the logic without electron stubs.
     * See renderer/dom-primitive-classifier.js and
     * docs/dom-aware-perception-plan.md.
     *
     * @param {HTMLElement} el
     * @returns {string} one of text|link|heading|icon|form_input|button|nav_item|image|ui_surface
     */
    classifyPrimitive(el) {
        return classifyPrimitive(el);
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
        const styleCache = new Map();

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
                // Optimization: Check visibility of first rect before computing style
                // If the first rect is completely off-screen, it's likely the others are too or don't matter enough to block
                const firstRect = rects[0];
                if (firstRect.bottom < 0 || firstRect.top > window.innerHeight || firstRect.right < 0 || firstRect.left > window.innerWidth) {
                    // Check if *any* rect is visible before skipping
                    let anyVisible = false;
                    for (let i = 0; i < rects.length; i++) {
                        const r = rects[i];
                        if (!(r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth)) {
                            anyVisible = true;
                            break;
                        }
                    }
                    if (!anyVisible) continue;
                }

                const parent = node.parentElement;
                if (!parent) continue;

                let styleData = styleCache.get(parent);

                if (!styleData) {
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

                    styleData = {
                        density,
                        lineHeight,
                        primitiveType: classifyPrimitive(parent)
                    };
                    styleCache.set(parent, styleData);
                }

                // Classify role from parent element (headings, nav text, etc.)
                const ariaRole = this.classifyRole(parent);

                // Add blocks for each line rect
                for (let i = 0; i < rects.length; i++) {
                    const rect = rects[i];
                    // Skip if off-screen (optimization)
                    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
                        continue;
                    }

                    blocks.push({
                        x: rect.left * zoom,
                        y: rect.top * zoom,
                        w: rect.width * zoom,
                        h: rect.height * zoom,
                        type: 1.0, // Text
                        density: styleData.density,
                        lineHeight: styleData.lineHeight * zoom,
                        ariaRole,
                        primitiveType: styleData.primitiveType
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
                    lineHeight: 0,
                    ariaRole: 6,
                    primitiveType: classifyPrimitive(el)
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
                    lineHeight: 0,
                    ariaRole: this.classifyRole(el),
                    primitiveType: classifyPrimitive(el)
                });
            }
        }

        // 4. Landmark elements — large bounding boxes for zone visualization (Blueprint mode)
        const landmarkElements = root.querySelectorAll([
            'header', 'footer', 'nav', 'main', 'aside',
            '[role="banner"]', '[role="contentinfo"]', '[role="navigation"]',
            '[role="main"]', '[role="complementary"]'
        ].join(', '));

        for (const el of landmarkElements) {
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
                    type: 0.0,
                    density: 0.3,
                    lineHeight: 0,
                    ariaRole: this.classifyRole(el),
                    primitiveType: classifyPrimitive(el)
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
    let typingDebounceTimer = null;

    // Throttled scan function with differentiated handling for scroll vs mutations
    // Throttled scan function with differentiated handling for scroll vs mutations
    const scanAndSend = (isScrollEvent = false) => {
        if (!domAdapter || isScanning) return;

        // Strategy: 
        // Scroll = High Priority (RAF) -> 16ms throttle
        // Mutation = Low Priority (IdleCallback) -> 300ms debounce/throttle

        if (isScrollEvent) {
            lastScanTrigger = 'scroll';
            isScanning = true;
            requestAnimationFrame(() => {
                performScan();
                setTimeout(() => { isScanning = false; }, 16);
            });
        } else {
            lastScanTrigger = 'mutation';
            // Check if user is typing (active element is input)
            const active = document.activeElement;
            const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);

            // FIX: Robust debounce for any input interaction
            // Previously this erroneously depended on scrollDebounceTimer being active
            if (isTyping) {
                if (typingDebounceTimer) clearTimeout(typingDebounceTimer);

                // Debounce scan for 1.5s after last typing activity to prevent layout thrashing
                // This completely yields the main thread to the input/UI
                typingDebounceTimer = setTimeout(() => {
                    typingDebounceTimer = null;
                    scanAndSend(); // Trigger a scan when done typing
                }, 1500);

                return; // Abort immediate scan
            }

            isScanning = true;
            window.requestIdleCallback(() => {
                performScan();
                // Relaxed throttle for mutations
                setTimeout(() => { isScanning = false; }, 300);
            }, { timeout: 1000 });
        }
    };

    // Track whether current scan was triggered by scroll or DOM mutation
    let lastScanTrigger = 'mutation';

    const performScan = () => {
        try {
            const blocks = domAdapter.scan(document.body);
            ipcRenderer.send('structure-update', blocks, lastScanTrigger);
        } catch (err) {
            console.error('[Preload] Scan failed:', err);
        }
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
                    ipcRenderer.send('log:renderer', `[Preload] Mouse: Screen(${e.screenX}, ${e.screenY}), Client(${e.clientX}, ${e.clientY}), Zoom=${webFrame.getZoomFactor()}, DPR=${window.devicePixelRatio}`);
                }
                // PIPELINE CHANGE: Send Screen Coordinates to avoid Zoom scaling issues
                ipcRenderer.send('browser:mousemove', e.screenX, e.screenY, webFrame.getZoomFactor());
                ticking = false;
            });
            ticking = true;
        }
    }); // CAPTURE PHASE - important for catching events over modals

    // Touch Emulation (Option+Click)
    window.addEventListener('mousedown', (e) => {
        if (e.altKey) {
            // Emulate touch
            console.log('[Preload] Option+Click intercepted: Emulating touch');
            // e.preventDefault();
            // e.stopPropagation();

            const x = e.clientX;
            const y = e.clientY;

            // Send sequence: touchStart, then touchEnd
            ipcRenderer.send('emulate-touch', { type: 'touchStart', x, y });

            // Short delay for touchEnd to simulate tap
            setTimeout(() => {
                ipcRenderer.send('emulate-touch', { type: 'touchEnd', x, y });
            }, 50);
        }
    }, true);

    // Track zoom/resize changes
    window.addEventListener('resize', () => {
        ipcRenderer.send('browser:zoom-changed', webFrame.getZoomFactor());
    });

    // Forced Scan (e.g. from Main Process on navigation finish)
    ipcRenderer.on('browser:force-scan', () => {
        console.log('[Preload] Forced scan requested');
        scanAndSend(true);
    });

    // Forward keyboard events to main process for shortcuts
    // Forward keyboard events to main process for shortcuts and modifier tracking
    const forwardKeyEvent = (e, type) => {
        // Forward Escape, Arrows, and Modifiers (Shift, Cmd/Meta, Ctrl, Alt)
        const isModifier = ['Shift', 'Meta', 'Control', 'Alt'].includes(e.key);
        const isNavKey = ['Escape', 'ArrowLeft', 'ArrowRight'].includes(e.code);

        if (isModifier || isNavKey) {
            // console.log(`[Preload] Forwarding ${type}:`, e.code);
            ipcRenderer.send(type, {
                code: e.code,
                key: e.key,
                altKey: e.altKey,
                ctrlKey: e.ctrlKey,
                metaKey: e.metaKey,
                shiftKey: e.shiftKey
            });
        }
    };

    window.addEventListener('keydown', (e) => forwardKeyEvent(e, 'keydown'), true);
    window.addEventListener('keyup', (e) => forwardKeyEvent(e, 'keyup'), true);

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
