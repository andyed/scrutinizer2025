/**
 * Viewport profiles for Playwright capture.
 *
 * Desktop profile is the default. Mobile profiles pull dimensions from
 * shared/constants.json DEVICE_PROFILES but adapt for Playwright's API.
 */

const VIEWPORTS = {
    desktop: {
        name: 'desktop',
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        userAgent: undefined // use Playwright default
    },
    mobile: {
        name: 'mobile',
        width: 390,
        height: 844,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
    }
};

/**
 * Resolve viewport names to profile objects.
 * @param {string} input - Comma-separated viewport names (e.g. "desktop,mobile")
 * @returns {object[]} Array of viewport profile objects
 */
function resolveViewports(input) {
    if (!input) return [VIEWPORTS.desktop];

    const names = input.split(',').map(s => s.trim().toLowerCase());
    const results = [];

    for (const name of names) {
        if (VIEWPORTS[name]) {
            results.push(VIEWPORTS[name]);
        } else {
            throw new Error(`Unknown viewport: "${name}". Available: ${Object.keys(VIEWPORTS).join(', ')}`);
        }
    }

    return results.length > 0 ? results : [VIEWPORTS.desktop];
}

module.exports = { VIEWPORTS, resolveViewports };
