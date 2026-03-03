/**
 * Scroll strategy — defines named scroll positions for capture.
 *
 * "above-fold" = no scrolling (default viewport).
 * "first-scroll" = one viewport-height down.
 */

const SCROLL_POSITIONS = {
    'above-fold': {
        name: 'above-fold',
        scrollFn: async () => {} // no-op
    },
    'first-scroll': {
        name: 'first-scroll',
        scrollFn: async (page) => {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            // Wait for any lazy-loaded content or scroll-triggered animations
            await page.waitForTimeout(500);
        }
    }
};

/**
 * Resolve scroll position names.
 * @param {string} input - Comma-separated scroll names (e.g. "above-fold,first-scroll")
 * @returns {object[]} Array of scroll position objects
 */
function resolveScrollPositions(input) {
    if (!input) return [SCROLL_POSITIONS['above-fold']];

    const names = input.split(',').map(s => s.trim().toLowerCase());
    const results = [];

    for (const name of names) {
        if (SCROLL_POSITIONS[name]) {
            results.push(SCROLL_POSITIONS[name]);
        } else {
            throw new Error(`Unknown scroll position: "${name}". Available: ${Object.keys(SCROLL_POSITIONS).join(', ')}`);
        }
    }

    return results.length > 0 ? results : [SCROLL_POSITIONS['above-fold']];
}

module.exports = { SCROLL_POSITIONS, resolveScrollPositions };
