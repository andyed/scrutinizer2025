#!/usr/bin/env node
/**
 * Full-page foveated gazeplot using Scrutinizer's real rendering pipeline.
 *
 * 1. Loads the SERP HTML in Scrutinizer with infinite visual memory
 * 2. Walks all fixations (scroll-corrected screen-space) through the pipeline
 * 3. After accumulation, captures tiles at each scroll position
 * 4. For each tile: shifts the VM buffer to match scroll offset, captures
 * 5. Stitches tiles into a full-page PNG
 *
 * Usage:
 *   node scripts/capture-fullpage-gazeplot.js --data=/path/to/AdSERP/data --trial=p029-b2-t10
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
function getArg(name, def) {
    const a = args.find(x => x.startsWith(`--${name}=`));
    return a ? a.split('=').slice(1).join('=') : def;
}

const ROOT = path.join(__dirname, '..');
const dataDir = path.resolve(getArg('data', ''));
const trialId = getArg('trial', null);
const modeId = getArg('mode', '0');

if (!dataDir || !trialId) {
    console.error('Usage: --data=<path> --trial=<id>');
    process.exit(1);
}

const adserp = require(path.join(ROOT, 'renderer', 'scanpath', 'importers', 'adserp-importer'));
const scanpathData = adserp.loadTrial(dataDir, trialId);
const meta = scanpathData.meta;
const serpPath = meta.serpHtmlPath;

if (!serpPath) { console.error('No SERP HTML'); process.exit(1); }

// Write scanpath JSON for the gazeplot walker
const tmpDir = path.join(ROOT, 'output', 'adserp-tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const scanpathFile = path.join(tmpDir, `${trialId}-gazeplot.json`);
fs.writeFileSync(scanpathFile, JSON.stringify(scanpathData));

const outputDir = path.join(ROOT, 'output', 'adserp-fullpage-gazeplots');
fs.mkdirSync(outputDir, { recursive: true });

// Viewport matches screen dims (fixation coordinate space)
const vpW = meta.screenWidth || 1280;
const vpH = meta.screenHeight || 1024;

// Document height for tile count
const docH = meta.documentHeight || 2642;
const tileCount = Math.ceil(docH / vpH);

console.log(`═══ Full-Page Gazeplot: ${trialId} ═══\n`);
console.log(`  Fixations: ${scanpathData.fixations.length}`);
console.log(`  Viewport:  ${vpW}x${vpH}`);
console.log(`  Document:  ${meta.documentWidth}x${docH}`);
console.log(`  Tiles:     ${tileCount} (${vpH}px each)`);
console.log(`  Mode:      ${modeId}`);
console.log();

// Launch Electron — walk fixations with visual memory, then capture tiles
const env = {
    ...process.env,
    TEST_MODE: 'true',
    TEST_URL: `file://${path.resolve(serpPath)}`,
    TEST_MODES: modeId,
    TEST_RADIUS: '45',
    TEST_WIDTH: String(vpW),
    TEST_HEIGHT: String(vpH),
    TEST_OVERLAY: 'false',
    TEST_SCANPATH: scanpathFile,
    TEST_VISUAL_MEMORY: '-1',
    TEST_WAIT_CONGESTION: 'false',
    // Use gazeplot path (walks fixations via IPC), NOT adserp live replay
    TEST_ADSERP_MODE: 'false',
    // Custom: after gazeplot walk, capture tiles instead of single screenshot
    TEST_FULLPAGE_TILES: String(tileCount),
    TEST_FULLPAGE_DOC_HEIGHT: String(docH),
    TEST_OUTPUT_FILENAME: `${trialId}_fullpage_gazeplot.png`,
    SCREENSHOT_MODE: 'update',
    ELECTRON_RUN_AS_NODE: undefined,
};

console.log('  Launching Scrutinizer...\n');

const child = spawn('npm', ['start'], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
});

child.on('close', async (code) => {
    try { fs.unlinkSync(scanpathFile); } catch (e) {}

    if (code !== 0) {
        console.error(`\n  Failed (exit ${code})`);
        process.exit(code);
        return;
    }

    const packageVersion = require(path.join(ROOT, 'package.json')).version.replace(/\.\d+$/, '');
    const capDir = path.join(ROOT, 'tests', 'golden-captures', `v${packageVersion}`);

    // Collect tile files
    const tilePaths = [];
    for (let i = 0; i < tileCount; i++) {
        const tilePath = path.join(capDir, `${trialId}_fullpage_gazeplot_tile${i}.png`);
        if (fs.existsSync(tilePath)) tilePaths.push(tilePath);
    }

    if (tilePaths.length === 0) {
        console.error('\n  No tiles captured');
        process.exit(1);
        return;
    }

    console.log(`\n  Stitching ${tilePaths.length} tiles...`);

    // Stitch tiles using Playwright canvas
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage();

    const tilesB64 = tilePaths.map(t => fs.readFileSync(t).toString('base64'));

    const stitchedB64 = await page.evaluate(async (data) => {
        const imgs = [];
        for (const b64 of data) {
            const img = new Image();
            img.src = 'data:image/png;base64,' + b64;
            await new Promise(r => img.onload = r);
            imgs.push(img);
        }
        const w = imgs[0].width, h = imgs[0].height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h * imgs.length;
        const ctx = canvas.getContext('2d');
        imgs.forEach((img, i) => ctx.drawImage(img, 0, i * h));
        return canvas.toDataURL('image/png').split(',')[1];
    }, tilesB64);

    await browser.close();

    const outPath = path.join(outputDir, `${trialId}_fullpage_gazeplot.png`);
    fs.writeFileSync(outPath, Buffer.from(stitchedB64, 'base64'));
    const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
    console.log(`  ✓ ${outPath} (${sizeMB}MB)`);

    // Clean up individual tiles
    tilePaths.forEach(t => { try { fs.unlinkSync(t); } catch (e) {} });
});
