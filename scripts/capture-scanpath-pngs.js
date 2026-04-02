#!/usr/bin/env node
/**
 * Capture full-page PNGs of scanpath diagram HTMLs using Playwright.
 *
 * Handles two formats:
 *   1. Iframe-based diagrams (two-layer blur) — captures the .container element
 *   2. Image-based diagrams (Scrutinizer gazeplot) — captures the .container element
 *
 * Also captures the interactive explorer HTMLs if present.
 *
 * Usage:
 *   node scripts/capture-scanpath-pngs.js [--interactive]
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const hasFlag = (name) => process.argv.includes(`--${name}`);
const doInteractive = hasFlag('interactive');

const ROOT = path.join(__dirname, '..');
const diagramDir = path.join(ROOT, 'output', 'adserp-scanpath-diagrams');
const interactiveDir = path.join(ROOT, 'output', 'adserp-interactive');
const pngDir = path.join(ROOT, 'output', 'adserp-scanpath-pngs');
fs.mkdirSync(pngDir, { recursive: true });

// Collect HTML files to capture
const files = [];

// Scanpath diagrams
if (fs.existsSync(diagramDir)) {
    fs.readdirSync(diagramDir)
        .filter(f => f.endsWith('-scanpath.html'))
        .sort()
        .forEach(f => files.push({
            src: path.join(diagramDir, f),
            name: f.replace('-scanpath.html', '') + '-diagram',
            type: 'diagram'
        }));
}

// Interactive explorers
if (doInteractive && fs.existsSync(interactiveDir)) {
    fs.readdirSync(interactiveDir)
        .filter(f => f.endsWith('-explorer.html'))
        .sort()
        .forEach(f => files.push({
            src: path.join(interactiveDir, f),
            name: f.replace('-explorer.html', '') + '-explorer',
            type: 'explorer'
        }));
}

if (files.length === 0) {
    console.error('No HTML files found. Run generate-scanpath-diagram.js first.');
    process.exit(1);
}

async function main() {
    console.log(`═══ Capturing ${files.length} scanpath PNGs ═══\n`);

    const browser = await chromium.launch();
    const context = await browser.newContext({
        viewport: { width: 1320, height: 1024 }, // slightly wider than 1280 for padding
        deviceScaleFactor: 2,
    });

    for (const file of files) {
        const pngPath = path.join(pngDir, `${file.name}.png`);

        const page = await context.newPage();
        await page.goto(`file://${file.src}`, { waitUntil: 'networkidle' });

        // Wait for iframes and images to load
        await page.waitForTimeout(3000);

        // For explorers: make sure all fixations are shown (default state)
        if (file.type === 'explorer') {
            // The explorer defaults to showing all fixations, so just capture
            await page.waitForTimeout(1000);
        }

        // Capture the .container or .serp-container element for tight framing,
        // or fall back to full page
        let element = await page.$('.container') || await page.$('.serp-container');
        if (element) {
            await element.screenshot({ path: pngPath });
        } else {
            await page.screenshot({ path: pngPath, fullPage: true });
        }

        const stat = fs.statSync(pngPath);
        console.log(`  ✓ ${file.name} → ${(stat.size / 1024 / 1024).toFixed(1)}MB`);

        await page.close();
    }

    await browser.close();
    console.log(`\n  PNGs: ${pngDir}/`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
