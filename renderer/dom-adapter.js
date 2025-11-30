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
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
                    // Optimization: Check if node is roughly in viewport?
                    // For now, scan everything to be safe, or maybe just what's visible.
                    // Scanning everything is safer for correctness but slower.
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

                // Calculate Saliency
                // Base: 0.2 (Body text)
                // Boost by size: >20px -> +0.3, >30px -> +0.5
                // Boost by weight: >600 -> +0.2
                // TODO: Saliency temporarily disabled (alpha < 1.0 breaks structure map)
                // See: https://github.com/andyed/scrutinizer2025/issues/XXX
                let saliency = 1.0; // TEMP: Always 1.0 until we move to packed R channel

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
                        density: density,
                        lineHeight: lineHeight,
                        saliency: saliency
                    });
                }
            }
        }

        // 2. Images
        const images = root.querySelectorAll('img, svg, video, canvas');
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

        // 3. UI Elements (Buttons, Inputs)
        const uiElements = root.querySelectorAll('button, input, select, a.button, [role="button"]');
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
