#!/usr/bin/env node
/**
 * scrutinizer-audit — Visual complexity CLI
 *
 * Lighthouse for visual clutter. Crawls web pages with headless Chromium,
 * computes Feature Congestion (Rosenholtz 2007) + edge density, returns a
 * composite complexity score (0-100).
 *
 * Usage:
 *   scrutinizer-audit <url> [urls...] [options]
 *   scrutinizer-audit --sitemap https://example.com/sitemap.xml
 *   scrutinizer-audit --file urls.txt --viewport desktop,mobile
 *   scrutinizer-audit https://example.com --fail-above 50 --json
 */

const fs = require('fs');
const path = require('path');
const { resolveUrls } = require('./lib/url-resolver');
const { resolveViewports } = require('./lib/viewport-profiles');
const { resolveScrollPositions } = require('./lib/scroll-strategy');
const { capturePages } = require('./lib/crawler');
const { analyzePng, saveHeatmapPng } = require('./lib/analyzer');
const { buildReport, printTable, writeReport, buildComparisonReport } = require('./lib/reporter');

// ── Argument parsing ────────────────────────────────────────────────────

function parseArgs(argv) {
    const args = {
        urls: [],
        sitemap: null,
        file: null,
        viewport: null,
        scroll: null,
        output: null,
        heatmaps: false,
        screenshots: false,
        json: false,
        quiet: false,
        maxDim: 1024,
        failAbove: null,
        compare: null,
        help: false
    };

    let i = 0;
    while (i < argv.length) {
        const arg = argv[i];

        if (arg === '--help' || arg === '-h') {
            args.help = true;
        } else if (arg === '--sitemap') {
            args.sitemap = argv[++i];
        } else if (arg === '--file') {
            args.file = argv[++i];
        } else if (arg === '--viewport') {
            args.viewport = argv[++i];
        } else if (arg === '--scroll') {
            args.scroll = argv[++i];
        } else if (arg === '--output') {
            args.output = argv[++i];
        } else if (arg === '--heatmaps') {
            args.heatmaps = true;
        } else if (arg === '--screenshots') {
            args.screenshots = true;
        } else if (arg === '--json') {
            args.json = true;
        } else if (arg === '--quiet') {
            args.quiet = true;
        } else if (arg === '--max-dim') {
            args.maxDim = parseInt(argv[++i], 10);
        } else if (arg === '--fail-above') {
            args.failAbove = parseInt(argv[++i], 10);
        } else if (arg === '--compare') {
            args.compare = [argv[++i], argv[++i]];
        } else if (!arg.startsWith('-')) {
            args.urls.push(arg);
        } else {
            console.error(`Unknown option: ${arg}`);
            process.exit(1);
        }

        i++;
    }

    return args;
}

function printHelp() {
    console.log(`
scrutinizer-audit — Visual complexity CLI

Usage:
  scrutinizer-audit <url> [urls...] [options]

Input:
  <url> [urls...]           Positional URLs
  --sitemap <url>           Parse XML sitemap for URLs
  --file <path>             One URL per line

Viewport:
  --viewport <list>         desktop,mobile (default: desktop)

Scroll:
  --scroll <list>           above-fold,first-scroll (default: above-fold)

Output:
  --output <path>           Write .json or .html report
  --heatmaps                Save congestion heatmap PNGs
  --screenshots             Save raw page screenshots
  --json                    JSON to stdout (for piping)
  --quiet                   Suppress progress output

Analysis:
  --max-dim <n>             Analysis resolution (default: 1024)

CI/CD:
  --fail-above <n>          Exit 1 if any page exceeds threshold (0-100)

Comparison:
  --compare <before> <after>  Delta report from two JSON outputs
`);
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
        printHelp();
        process.exit(0);
    }

    // --compare mode: diff two JSON reports
    if (args.compare) {
        const [beforePath, afterPath] = args.compare;
        const before = JSON.parse(fs.readFileSync(beforePath, 'utf-8'));
        const after = JSON.parse(fs.readFileSync(afterPath, 'utf-8'));
        const comparison = buildComparisonReport(before, after);
        if (args.json) {
            console.log(JSON.stringify(comparison, null, 2));
        } else {
            console.log('\nComparison Report:');
            console.table(comparison.deltas.map(d => ({
                URL: d.url.slice(0, 50),
                Viewport: d.viewport,
                Before: d.before !== null ? d.before : '—',
                After: d.after,
                Delta: d.delta !== null ? (d.delta > 0 ? '+' + d.delta : d.delta) : 'new'
            })));
        }
        if (args.output) {
            writeReport(comparison, args.output);
            if (!args.quiet) console.error(`Report written to ${args.output}`);
        }
        process.exit(0);
    }

    // Resolve URLs
    const urls = await resolveUrls({
        positional: args.urls,
        file: args.file,
        sitemap: args.sitemap
    });

    if (urls.length === 0) {
        console.error('No URLs specified. Use --help for usage.');
        process.exit(1);
    }

    // Resolve viewports and scroll positions
    const viewports = resolveViewports(args.viewport);
    const scrollPositions = resolveScrollPositions(args.scroll);

    if (!args.quiet) {
        console.error(`scrutinizer-audit: ${urls.length} URL(s), ${viewports.map(v => v.name).join('+')} viewport(s), ${scrollPositions.map(s => s.name).join('+')} scroll(s)`);
    }

    // Capture screenshots
    const captures = await capturePages(urls, {
        viewports,
        scrollPositions,
        quiet: args.quiet
    });

    // Analyze each capture
    const analyzed = new Map();
    const outputDir = args.output ? path.dirname(path.resolve(args.output)) : process.cwd();

    for (const [url, pageCaps] of captures) {
        const results = [];

        for (const cap of pageCaps) {
            if (cap.error) {
                results.push(cap);
                continue;
            }

            const analysis = analyzePng(cap.png, { maxDim: args.maxDim });
            cap.analysis = analysis;
            results.push(cap);

            // Save heatmaps if requested
            if (args.heatmaps) {
                const slug = urlToSlug(url);
                const prefix = `${slug}_${cap.viewport.name}_${cap.scrollPosition}`;

                const congPng = saveHeatmapPng(analysis._congestionMap, analysis.width, analysis.height);
                fs.writeFileSync(path.join(outputDir, `${prefix}_congestion.png`), congPng);

                const edgePng = saveHeatmapPng(analysis._edgeDensityMap, analysis.width, analysis.height);
                fs.writeFileSync(path.join(outputDir, `${prefix}_edgedensity.png`), edgePng);
            }

            // Save screenshots if requested
            if (args.screenshots) {
                const slug = urlToSlug(url);
                const prefix = `${slug}_${cap.viewport.name}_${cap.scrollPosition}`;
                fs.writeFileSync(path.join(outputDir, `${prefix}_screenshot.png`), cap.png);
            }
        }

        analyzed.set(url, results);
    }

    // Build report
    const report = buildReport(analyzed, { failAbove: args.failAbove });

    // Output
    if (args.json) {
        console.log(JSON.stringify(report, null, 2));
    } else if (!args.quiet) {
        printTable(report);
    }

    if (args.output) {
        writeReport(report, args.output);
        if (!args.quiet) console.error(`\nReport written to ${args.output}`);
    }

    // Exit code for CI
    if (args.failAbove !== null && !report.summary.pass) {
        process.exit(1);
    }
}

function urlToSlug(url) {
    return url
        .replace(/^https?:\/\//, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/_+$/, '')
        .slice(0, 80);
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(2);
});
