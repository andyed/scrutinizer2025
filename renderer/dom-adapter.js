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

        // Helper to adjust rects by scroll position if needed
        // getBoundingClientRect returns coordinates relative to the viewport.
        // StructureMap expects coordinates relative to the viewport (since it overlays the screen).
        // So we don't need to add scroll offsets if we just want to paint what's on screen.
        // However, if we want to cache the whole page, we would need absolute coords.
        // The plan says "StructureMap paints these blocks into an off-screen <canvas> (25% resolution)".
        // And "The WebGL renderer receives... u_structureMap".
        // The WebGL renderer renders the *viewport*.
        // So StructureMap should match the *viewport*.
        // So getBoundingClientRect is exactly what we want.

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

                    styleData = { density, lineHeight };
                    styleCache.set(parent, styleData);
                }

                // Calculate Saliency (TEMP: Always 1.0)
                let saliency = 1.0;

                // Add blocks for each line rect
                for (let i = 0; i < rects.length; i++) {
                    const rect = rects[i];
                    // Skip if off-screen (optimization)
                    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
                        continue;
                    }

                    blocks.push({
                        x: rect.left,
                        y: rect.top,
                        w: rect.width,
                        h: rect.height,
                        type: 1.0, // Text
                        density: styleData.density,
                        lineHeight: styleData.lineHeight,
                        saliency: saliency
                    });
                }
            }
        }

        // 2. Media Elements (Visual elements require tag-based detection)
        const images = root.querySelectorAll('img, svg, video, canvas, picture, embed, object, meter, progress');
        for (const img of images) {
            const rect = img.getBoundingClientRect();
            // Skip if off-screen
            if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
                continue;
            }

            if (rect.width > 0 && rect.height > 0) {
                blocks.push({
                    x: rect.left,
                    y: rect.top,
                    w: rect.width,
                    h: rect.height,
                    type: 0.5, // Image
                    density: 0.8, // High density for images
                    lineHeight: 0,
                    saliency: 1.0 // TEMP: Always 1.0
                });
            }
        }

        // 3. Interactive Elements (Semantic Attributes)
        // Form controls, links, ARIA roles, editable, custom interactivity
        const uiElements = root.querySelectorAll(`
            button, input, textarea, select, option,
            a[href],
            [role="button"], [role="link"], [role="menuitem"], [role="tab"],
            [role="checkbox"], [role="radio"], [role="switch"], [role="slider"],
            [contenteditable="true"],
            [onclick], [tabindex]:not([tabindex="-1"])
        `);
        for (const el of uiElements) {
            const rect = el.getBoundingClientRect();
            // Skip if off-screen
            if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
                continue;
            }

            if (rect.width > 0 && rect.height > 0) {
                blocks.push({
                    x: rect.left,
                    y: rect.top,
                    w: rect.width,
                    h: rect.height,
                    type: 0.0, // UI
                    density: 1.0, // Solid
                    lineHeight: 0,
                    saliency: 1.0 // TEMP: Always 1.0
                });
            }
        }

        return blocks;
    }
}

module.exports = DomAdapter;
