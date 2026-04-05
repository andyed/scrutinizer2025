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
 *   node scripts/capture-fullpage-gazeplot.js --data=/path/to/AdSERP/data --trial=p029-b2-t10 --single
 *   node scripts/capture-fullpage-gazeplot.js --data=/path/to/AdSERP/data --trial=p029-b2-t10 --batch
 *
 * --batch: Fast mode. Bulk-loads ALL fixations into the visual memory buffer
 *   at once instead of walking them one-by-one through the render loop.
 *   Minutes → seconds. Same tile capture + stitch pipeline.
 *
 * --single: Capture the full page in one shot (no tiling). Sets the Electron
 *   window height to the full document height. Produces a single PNG at
 *   1280×docHeight — same dimensions as the Playwright SERP render.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
function getArg(name, def) {
    const a = args.find(x => x.startsWith(`--${name}=`));
    return a ? a.split('=').slice(1).join('=') : def;
}
const hasFlag = (name) => args.includes(`--${name}`);

const ROOT = path.join(__dirname, '..');
const dataDir = path.resolve(getArg('data', ''));
const trialId = getArg('trial', null);
const modeId = getArg('mode', '0');
const singleMode = hasFlag('single');
const batchMode = hasFlag('batch');
const layoutFreezePath = getArg('layout-freeze', null);
const docHeightOverride = getArg('doc-height', null);
const anchorFilePath = getArg('anchors', null);

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

// Viewport matches SCREEN dims (screenshot coordinate space).
// FPOGX/FPOGY are "relative to the top-left corner of the screenshot in pixels"
// (AdSERP docs). The screenshot is at screenWidth (1280px).
const vpW = meta.screenWidth || 1280;
const vpH = meta.screenHeight || 1024;

// Document height for tile count
const docH = docHeightOverride ? parseInt(docHeightOverride) : (meta.documentHeight || 2642);
// Add 1 extra tile to account for capture height < viewport height
// (title bar/chrome reduces actual capture area by ~40px)
const tileCount = singleMode ? 0 : Math.ceil(docH / vpH) + 1;

console.log(`═══ Full-Page Gazeplot: ${trialId} ═══\n`);
console.log(`  Fixations: ${scanpathData.fixations.length}`);
console.log(`  Window:    ${vpW}x${vpH} (layout viewport)`);
console.log(`  Screen:    ${meta.screenWidth}x${meta.screenHeight} (fixation coord space)`);
console.log(`  Document:  ${meta.documentWidth}x${docH}`);
console.log(`  Mode:      ${batchMode ? 'BATCH (bulk-load VM)' : singleMode ? 'single (full-height)' : `tiled (${tileCount} × ${vpH}px)`}`);
console.log(`  Render:    ${modeId}`);
console.log();

// Layout freeze: inject CSS to hold original element dimensions
let layoutFreezeCSS = '';
if (layoutFreezePath && fs.existsSync(layoutFreezePath)) {
    const entries = JSON.parse(fs.readFileSync(layoutFreezePath, 'utf8'));
    layoutFreezeCSS = entries.map(e =>
        `${e.selector} { min-width: ${e.width}px !important; min-height: ${e.height}px !important; max-height: ${e.height}px !important; }`
    ).join('\n');
    console.log(`  Layout freeze: ${entries.length} elements from ${path.basename(layoutFreezePath)}`);
}

// Launch Electron — walk fixations with visual memory, then capture
const env = {
    ...process.env,
    TEST_MODE: 'true',
    TEST_URL: `file://${path.resolve(serpPath)}`,
    TEST_MODES: modeId,
    TEST_RADIUS: '45',
    TEST_WIDTH: String(vpW),
    // Add 68px to compensate for macOS title bar (28px) + Electron toolbar offset (40px).
    // The HUD capture area ends up exactly vpH pixels tall.
    TEST_HEIGHT: singleMode ? String(docH) : String(vpH + 68),
    TEST_OVERLAY: 'false',
    TEST_SCANPATH: scanpathFile,
    TEST_VISUAL_MEMORY: '-1',
    TEST_WAIT_CONGESTION: 'false',
    // Use gazeplot path (walks fixations via IPC), NOT adserp live replay
    TEST_ADSERP_MODE: 'false',
    // Batch mode: bulk-load all fixations into VM at once (skips per-fixation walk)
    ...(batchMode ? { TEST_BATCH_GAZEPLOT: 'true', TEST_BATCH_GAZEPLOT_DOC_HEIGHT: String(docH) } : {}),
    TEST_OUTPUT_FILENAME: `${trialId}_fullpage_gazeplot.png`,
    SCREENSHOT_MODE: 'update',
    ELECTRON_RUN_AS_NODE: undefined,
    ...(layoutFreezeCSS ? { TEST_INJECT_CSS: scanpathFile.replace('.json', '-freeze.css') } : {}),
    ...(anchorFilePath ? { TEST_ANCHOR_FILE: path.resolve(anchorFilePath) } : {}),
    // Tiled mode only: capture tiles at each scroll position and stitch
    ...(singleMode ? {} : {
        TEST_FULLPAGE_TILES: String(tileCount),
        TEST_FULLPAGE_DOC_HEIGHT: String(docH),
    }),
};

// Write layout freeze CSS to temp file for Electron to inject
if (layoutFreezeCSS) {
    const cssPath = scanpathFile.replace('.json', '-freeze.css');
    fs.writeFileSync(cssPath, layoutFreezeCSS);
}

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
    const outPath = path.join(outputDir, `${trialId}_fullpage_gazeplot.png`);

    if (singleMode) {
        // Single capture: find the one PNG, scale from 2× DPR to 1×
        const captureName = `${trialId}_fullpage_gazeplot.png`;
        const capturePath = path.join(capDir, captureName);
        if (!fs.existsSync(capturePath)) {
            console.error(`\n  No capture found at ${capturePath}`);
            process.exit(1);
            return;
        }

        console.log('\n  Scaling 2× DPR capture to 1×...');
        const { chromium } = require('playwright');
        const browser = await chromium.launch();
        const page = await browser.newPage();

        const srcB64 = fs.readFileSync(capturePath).toString('base64');
        const scaledB64 = await page.evaluate(async (b64) => {
            const img = new Image();
            img.src = 'data:image/png;base64,' + b64;
            await new Promise(r => img.onload = r);
            // 2× DPR → 1× resolution
            const outW = Math.round(img.width / 2);
            const outH = Math.round(img.height / 2);
            const canvas = document.createElement('canvas');
            canvas.width = outW;
            canvas.height = outH;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, outW, outH);
            return canvas.toDataURL('image/png').split(',')[1];
        }, srcB64);

        await browser.close();

        fs.writeFileSync(outPath, Buffer.from(scaledB64, 'base64'));
        const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
        console.log(`  ✓ ${outPath} (${sizeMB}MB)`);

        // Clean up the 2× capture
        try { fs.unlinkSync(capturePath); } catch (e) {}

    } else {
        // Tiled mode: collect tiles, stitch, and crop to exact docH
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

        console.log(`\n  Stitching ${tilePaths.length} tiles → crop to ${docH}px...`);

        const { chromium } = require('playwright');
        const browser = await chromium.launch();
        const page = await browser.newPage();

        const tilesB64 = tilePaths.map(t => fs.readFileSync(t).toString('base64'));

        // Stitch tiles and crop to exact docH.
        // Detect DPR: if tile width > vpW, tiles are 2x DPR and need halving.
        const stitchedB64 = await page.evaluate(async ({ tiles, targetH, expectedW }) => {
            const imgs = [];
            for (const b64 of tiles) {
                const img = new Image();
                img.src = 'data:image/png;base64,' + b64;
                await new Promise(r => img.onload = r);
                imgs.push(img);
            }
            const srcW = imgs[0].width, srcH = imgs[0].height;
            const dpr = srcW > expectedW ? Math.round(srcW / expectedW) : 1;
            const outW = Math.round(srcW / dpr);
            const tileH = Math.round(srcH / dpr);
            const canvas = document.createElement('canvas');
            canvas.width = outW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');
            imgs.forEach((img, i) => ctx.drawImage(img, 0, i * tileH, outW, tileH));
            return canvas.toDataURL('image/png').split(',')[1];
        }, { tiles: tilesB64, targetH: docH, expectedW: vpW });

        await browser.close();

        fs.writeFileSync(outPath, Buffer.from(stitchedB64, 'base64'));
        const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
        console.log(`  ✓ ${outPath} (${sizeMB}MB, cropped to ${docH}px)`);

        // Clean up individual tiles
        tilePaths.forEach(t => { try { fs.unlinkSync(t); } catch (e) {} });
    }

    // Copy capture metadata JSON if it exists (written by batch mode in main.js)
    const metaName = `${trialId}_fullpage_gazeplot_meta.json`;
    const metaSrc = path.join(capDir, metaName);
    if (fs.existsSync(metaSrc)) {
        const metaDst = path.join(outputDir, metaName);
        fs.copyFileSync(metaSrc, metaDst);
        console.log(`  Meta: ${metaDst}`);
    }
});
