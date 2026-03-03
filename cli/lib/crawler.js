/**
 * Crawler — Playwright page capture orchestrator.
 *
 * Launches headless Chromium, navigates to URLs, captures screenshots
 * at specified viewports and scroll positions, returns PNG buffers.
 */

const { chromium } = require('playwright');

/**
 * Capture screenshots for a list of URLs across viewports and scroll positions.
 *
 * @param {string[]} urls
 * @param {{ viewports: object[], scrollPositions: object[], quiet?: boolean, screenshots?: boolean }} opts
 * @returns {Promise<Map<string, object[]>>} Map of url → array of { viewport, scrollPosition, png, screenshotPng? }
 */
async function capturePages(urls, opts) {
    const { viewports, scrollPositions, quiet } = opts;
    const results = new Map();

    const browser = await chromium.launch({ headless: true });

    try {
        // Process URLs concurrently with bounded parallelism
        const concurrency = Math.min(urls.length, 4);
        const queue = [...urls];
        const workers = [];

        for (let i = 0; i < concurrency; i++) {
            workers.push((async () => {
                while (queue.length > 0) {
                    const url = queue.shift();
                    if (!url) break;

                    const captures = [];

                    for (const vp of viewports) {
                        const contextOpts = {
                            viewport: { width: vp.width, height: vp.height },
                            deviceScaleFactor: vp.deviceScaleFactor || 1,
                            isMobile: vp.isMobile || false,
                            hasTouch: vp.hasTouch || false
                        };
                        if (vp.userAgent) {
                            contextOpts.userAgent = vp.userAgent;
                        }

                        const context = await browser.newContext(contextOpts);
                        const page = await context.newPage();

                        try {
                            if (!quiet) process.stderr.write(`  ${url} [${vp.name}] `);

                            await page.goto(url, {
                                waitUntil: 'networkidle',
                                timeout: 30000
                            });

                            // Wait a bit for late-rendering JS
                            await page.waitForTimeout(1000);

                            for (const sp of scrollPositions) {
                                // Reset scroll to top before each position
                                await page.evaluate(() => window.scrollTo(0, 0));
                                await sp.scrollFn(page);

                                const png = await page.screenshot({ type: 'png' });

                                captures.push({
                                    viewport: vp,
                                    scrollPosition: sp.name,
                                    png
                                });

                                if (!quiet) process.stderr.write('.');
                            }

                            if (!quiet) process.stderr.write(' ok\n');
                        } catch (err) {
                            if (!quiet) process.stderr.write(` error: ${err.message}\n`);
                            captures.push({
                                viewport: vp,
                                scrollPosition: scrollPositions[0].name,
                                error: err.message
                            });
                        } finally {
                            await context.close();
                        }
                    }

                    results.set(url, captures);
                }
            })());
        }

        await Promise.all(workers);
    } finally {
        await browser.close();
    }

    return results;
}

module.exports = { capturePages };
