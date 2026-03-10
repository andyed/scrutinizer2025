#!/usr/bin/env node
/**
 * Scrutinizer Audit MCP Server
 *
 * Exposes visual complexity analysis as MCP tools callable from Claude Code.
 * Uses stdio transport.
 *
 * Tools:
 *   analyze_url    — Score a single URL
 *   analyze_urls   — Score multiple URLs with summary
 *   compare_pages  — Side-by-side comparison of two URLs
 *
 * Setup:
 *   claude mcp add scrutinizer-audit -- node cli/mcp/server.js
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    CallToolRequestSchema,
    ListToolsRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');
const { chromium } = require('playwright');
const { analyzePng } = require('../lib/analyzer');

// ── Tool Definitions ────────────────────────────────────────────────────

const TOOLS = [
    {
        name: 'analyze_url',
        description: 'Analyze the visual complexity of a web page. Returns a composite score (0-100), rating (Low/Medium/High/Extreme), Feature Congestion stats, and edge density stats. Based on Rosenholtz et al. (2007) Feature Congestion.',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'URL to analyze'
                },
                viewport: {
                    type: 'string',
                    enum: ['desktop', 'mobile'],
                    description: 'Viewport to use (default: desktop)'
                },
                scroll: {
                    type: 'string',
                    enum: ['above-fold', 'first-scroll'],
                    description: 'Scroll position (default: above-fold)'
                }
            },
            required: ['url']
        }
    },
    {
        name: 'analyze_urls',
        description: 'Analyze visual complexity of multiple web pages. Returns per-page scores and an aggregate summary.',
        inputSchema: {
            type: 'object',
            properties: {
                urls: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'URLs to analyze'
                },
                viewport: {
                    type: 'string',
                    enum: ['desktop', 'mobile'],
                    description: 'Viewport to use (default: desktop)'
                }
            },
            required: ['urls']
        }
    },
    {
        name: 'compare_pages',
        description: 'Compare visual complexity of two web pages side by side. Shows score delta and metric differences.',
        inputSchema: {
            type: 'object',
            properties: {
                urlA: {
                    type: 'string',
                    description: 'First URL (before/reference)'
                },
                urlB: {
                    type: 'string',
                    description: 'Second URL (after/comparison)'
                },
                viewport: {
                    type: 'string',
                    enum: ['desktop', 'mobile'],
                    description: 'Viewport to use (default: desktop)'
                }
            },
            required: ['urlA', 'urlB']
        }
    },
    {
        name: 'capture_vision',
        description: 'Take a screenshot of a web page WITH the Scrutinizer visual effect (foveal blur, color degradation, etc) applied at a specific fixation point. Returns a base64 PNG image block. Use this when the user wants to SEE what a page looks like to someone with visual impairments.',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'URL to capture'
                },
                x: {
                    type: 'number',
                    description: 'Normalized X fixation point (0.0 to 1.0, e.g., 0.5 for center)'
                },
                y: {
                    type: 'number',
                    description: 'Normalized Y fixation point (0.0 to 1.0, e.g., 0.5 for center)'
                },
                mode: {
                    type: 'string',
                    description: 'Aesthetic mode ID (0=Default, 1=Red/Cyan, etc). Default is 0.'
                },
                radius: {
                    type: 'number',
                    description: 'Foveal radius in pixels. Default is 180.'
                }
            },
            required: ['url']
        }
    }
];

// ── Viewport configs ────────────────────────────────────────────────────

const VIEWPORT_CONFIGS = {
    desktop: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        isMobile: false
    },
    mobile: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
    }
};

// ── Capture + Analyze helper ────────────────────────────────────────────

async function captureAndAnalyze(browser, url, viewport, scroll) {
    const vpConfig = VIEWPORT_CONFIGS[viewport || 'desktop'];
    const context = await browser.newContext(vpConfig);
    const page = await context.newPage();

    try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(1000);

        if (scroll === 'first-scroll') {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            await page.waitForTimeout(500);
        }

        const png = await page.screenshot({ type: 'png' });
        const analysis = analyzePng(png, { maxDim: 1024 });

        return {
            url,
            viewport: viewport || 'desktop',
            scroll: scroll || 'above-fold',
            score: analysis.score,
            rating: analysis.rating,
            congestion: {
                mean: round4(analysis.congestion.mean),
                p90: round4(analysis.congestion.p90)
            },
            edgeDensity: {
                mean: round4(analysis.edgeDensity.mean),
                p90: round4(analysis.edgeDensity.p90)
            },
            computeTimeMs: analysis.computeTimeMs
        };
    } finally {
        await context.close();
    }
}

function round4(n) { return Math.round(n * 10000) / 10000; }

// ── Server setup ────────────────────────────────────────────────────────

const server = new Server(
    {
        name: 'scrutinizer-audit',
        version: '1.0.0'
    },
    {
        capabilities: {
            tools: {}
        }
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    let browser;
    try {
        browser = await chromium.launch({ headless: true });

        switch (name) {
            case 'analyze_url': {
                const result = await captureAndAnalyze(
                    browser, args.url, args.viewport, args.scroll
                );
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(result, null, 2)
                    }]
                };
            }

            case 'analyze_urls': {
                const results = [];
                let totalScore = 0;

                for (const url of args.urls) {
                    try {
                        const result = await captureAndAnalyze(
                            browser, url, args.viewport, 'above-fold'
                        );
                        results.push(result);
                        totalScore += result.score;
                    } catch (err) {
                        results.push({ url, error: err.message });
                    }
                }

                const scored = results.filter(r => !r.error);
                const summary = {
                    pagesAnalyzed: scored.length,
                    avgScore: scored.length > 0 ? Math.round(totalScore / scored.length) : 0,
                    maxScore: scored.length > 0 ? Math.max(...scored.map(r => r.score)) : 0,
                    minScore: scored.length > 0 ? Math.min(...scored.map(r => r.score)) : 0
                };

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ summary, pages: results }, null, 2)
                    }]
                };
            }

            case 'compare_pages': {
                const [resultA, resultB] = await Promise.all([
                    captureAndAnalyze(browser, args.urlA, args.viewport, 'above-fold'),
                    captureAndAnalyze(browser, args.urlB, args.viewport, 'above-fold')
                ]);

                const delta = {
                    score: resultB.score - resultA.score,
                    congestion_p90: round4(resultB.congestion.p90 - resultA.congestion.p90),
                    edgeDensity_p90: round4(resultB.edgeDensity.p90 - resultA.edgeDensity.p90)
                };

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            a: resultA,
                            b: resultB,
                            delta,
                            summary: `${args.urlA} scores ${resultA.score} (${resultA.rating}), ${args.urlB} scores ${resultB.score} (${resultB.rating}). Delta: ${delta.score > 0 ? '+' : ''}${delta.score}`
                        }, null, 2)
                    }]
                };
            }

            case 'capture_vision': {
                const { spawn } = require('child_process');
                const path = require('path');
                const fs = require('fs');

                const appDir = path.join(__dirname, '..', '..');
                const filename = `mcp_capture_${Date.now()}.png`;

                return new Promise((resolve) => {
                    const env = Object.assign({}, process.env, {
                        TEST_MODE: 'true',
                        TEST_URL: args.url,
                        TEST_FIXATION_X: args.x !== undefined ? String(args.x) : '0.5',
                        TEST_FIXATION_Y: args.y !== undefined ? String(args.y) : '0.5',
                        TEST_MODES: args.mode !== undefined ? String(args.mode) : '0',
                        TEST_RADIUS: args.radius !== undefined ? String(args.radius) : '180',
                        TEST_OUTPUT_FILENAME: filename,
                        ELECTRON_RUN_AS_NODE: undefined // Force execution as app
                    });

                    // Launch Electron to capture
                    const child = spawn('node', ['scripts/run-electron.js', '.'], {
                        cwd: appDir,
                        env: env,
                        stdio: 'ignore'
                    });

                    child.on('close', (code) => {
                        try {
                            const pkgVersion = require('../../package.json').version.replace(/\.\d+$/, '');
                            const outPath = path.join(appDir, 'tests', 'golden-captures', `v${pkgVersion}`, filename);

                            if (fs.existsSync(outPath)) {
                                const buffer = fs.readFileSync(outPath);
                                const base64 = buffer.toString('base64');
                                fs.unlinkSync(outPath); // Cleanup

                                resolve({
                                    content: [{
                                        type: 'image',
                                        data: base64,
                                        mimeType: 'image/png'
                                    }]
                                });
                            } else {
                                resolve({
                                    content: [{ type: 'text', text: `Error: capture output file not found at ${outPath}. Electron exited with code ${code}` }],
                                    isError: true
                                });
                            }
                        } catch (e) {
                            resolve({
                                content: [{ type: 'text', text: 'Error reading capture: ' + e.message }],
                                isError: true
                            });
                        }
                    });

                    setTimeout(() => {
                        child.kill();
                        resolve({
                            content: [{ type: 'text', text: 'Error: capture process timed out.' }],
                            isError: true
                        });
                    }, 25000);
                });
            }

            default:
                return {
                    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                    isError: true
                };
        }
    } catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    } finally {
        if (browser) await browser.close();
    }
});

// ── Start ───────────────────────────────────────────────────────────────

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('scrutinizer-audit MCP server running on stdio');
}

main().catch(err => {
    console.error('MCP server failed to start:', err);
    process.exit(1);
});
