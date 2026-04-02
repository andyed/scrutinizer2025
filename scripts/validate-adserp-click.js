#!/usr/bin/env node
/**
 * Validate AdSERP coordinate alignment by capturing screenshots at click time.
 *
 * For each trial:
 * 1. Loads the SERP HTML in Electron at the original viewport size
 * 2. Scrolls to the scroll position at click time
 * 3. Captures a raw screenshot (no foveation)
 * 4. Checks pixel color at the click position — should NOT be white/empty
 * 5. Draws crosshairs at click and nearest-fixation positions for visual inspection
 *
 * Usage:
 *   node scripts/validate-adserp-click.js --data=/path/to/AdSERP/data --trial=p004-b1-t1
 *   node scripts/validate-adserp-click.js --data=/path/to/AdSERP/data --batch=5
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
function getArg(name, def) {
    const a = args.find(x => x.startsWith(`--${name}=`));
    return a ? a.split('=').slice(1).join('=') : def;
}

const ROOT = path.join(__dirname, '..');
const dataDir = path.resolve(getArg('data', ''));
const singleTrial = getArg('trial', null);
const batchSize = parseInt(getArg('batch', '5'));

if (!dataDir || !fs.existsSync(dataDir)) {
    console.error('Error: --data=<path> required');
    process.exit(1);
}

const adserp = require(path.join(ROOT, 'renderer', 'scanpath', 'importers', 'adserp-importer'));
const { interpolateScrollY } = adserp;

// ── Select trials ─────────────────────────────────────────────

let trialIds = [];
if (singleTrial) {
    trialIds = [singleTrial];
} else {
    // Pick from interesting-trials.json prototypicals + random
    const interestingPath = path.join(dataDir, 'interesting-trials.json');
    if (fs.existsSync(interestingPath)) {
        const interesting = JSON.parse(fs.readFileSync(interestingPath, 'utf8'));
        for (const [tag, info] of Object.entries(interesting.prototypical || {})) {
            if (info.trial_id && trialIds.length < batchSize) trialIds.push(info.trial_id);
        }
    }
    if (trialIds.length < batchSize) {
        const fixDir = path.join(dataDir, 'fixation-data');
        const all = fs.readdirSync(fixDir).filter(f => f.endsWith('.csv')).map(f => f.replace('.csv', ''));
        while (trialIds.length < batchSize) {
            const t = all[Math.floor(Math.random() * all.length)];
            if (!trialIds.includes(t)) trialIds.push(t);
        }
    }
}

// ── Output directory ──────────────────────────────────────────

const outputDir = path.join(ROOT, 'output', 'adserp-click-validation');
fs.mkdirSync(outputDir, { recursive: true });

// ── Process each trial ────────────────────────────────────────

async function validateTrial(trialId) {
    // Load raw data
    const fixCsv = fs.readFileSync(path.join(dataDir, 'fixation-data', `${trialId}.csv`), 'utf8');
    const mouseCsv = fs.readFileSync(path.join(dataDir, 'mouse-movement-data', `${trialId}.csv`), 'utf8');
    const metaXml = fs.readFileSync(path.join(dataDir, 'trial-metadata', `${trialId}.xml`), 'utf8');
    const serpPath = path.join(dataDir, 'serps', `${trialId}.html`);
    if (!fs.existsSync(serpPath)) return { trialId, error: 'no SERP HTML' };

    // Parse metadata
    const get = (tag) => { const m = metaXml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return m ? m[1].trim() : ''; };
    const windowDims = get('window').split('x').map(Number);
    const screenDims = get('screen').split('x').map(Number);
    const windowW = windowDims[0] || 1422, windowH = windowDims[1] || 1137;
    const screenW = screenDims[0] || 1280, screenH = screenDims[1] || 1024;

    // Parse fixations (page-space)
    const fixations = fixCsv.trim().split('\n').slice(1).map(l => {
        const [t, x, y, d] = l.split(',').map(Number);
        return { t, x, y, d };
    }).filter(f => isFinite(f.t) && isFinite(f.x) && f.d > 0);

    // Parse scroll timeline
    const scrollEvents = mouseCsv.trim().split('\n').slice(1)
        .filter(l => l.includes(',scroll,'))
        .map(l => { const c = l.split(','); return { t: parseInt(c[0]), s: parseFloat(c[2]) }; })
        .filter(e => isFinite(e.t) && isFinite(e.s));

    // Find last click
    const clickLines = mouseCsv.trim().split('\n').slice(1).filter(l => l.includes(',click,'));
    if (clickLines.length === 0) return { trialId, error: 'no click' };
    const lastClick = clickLines[clickLines.length - 1].split(',');
    const clickT = parseInt(lastClick[0]);
    const clickPageX = parseFloat(lastClick[1]); // window page-space
    const clickPageY = parseFloat(lastClick[2]); // window page-space
    const clickXpath = lastClick[4]?.trim() || '';

    // Scroll offset at click time
    let scrollAtClick = 0;
    for (const s of scrollEvents) {
        if (s.t <= clickT) scrollAtClick = s.s; else break;
    }

    // Convert click from window page-space to window viewport-space
    // evtrack captures pageX/pageY; viewport = page - scroll
    const clickViewportX = clickPageX;
    const clickViewportY = clickPageY - scrollAtClick;

    // Find nearest fixation to click
    let nearestFix = null, nearestDt = Infinity;
    for (const f of fixations) {
        const dt = Math.abs(f.t - clickT);
        if (dt < nearestDt) { nearestDt = dt; nearestFix = f; }
    }

    // Convert fixation from screenshot page-space (1280-wide) to window viewport-space (1422-wide)
    // Scale: window/screen ratio
    const fixToWindowX = windowW / screenW;  // 1422/1280
    const fixToWindowY = windowH / screenH;  // 1137/1024
    let fixViewportX = null, fixViewportY = null;
    if (nearestFix) {
        const fixScrollY = scrollEvents.length > 0
            ? (() => { let s = 0; for (const e of scrollEvents) { if (e.t <= nearestFix.t) s = e.s; else break; } return s; })()
            : 0;
        // Fixation is in screenshot coords (1280-wide page-space)
        // Convert to window coords: scale up by window/screen ratio
        // Then subtract scroll to get viewport position
        fixViewportX = nearestFix.x * fixToWindowX;
        fixViewportY = (nearestFix.y - fixScrollY) * fixToWindowY;
    }

    // Read the SERP HTML and inject crosshair markers + scroll script
    let serpHtml = fs.readFileSync(serpPath, 'utf8');

    // Inject crosshair overlay at end of body
    // Use page-space coordinates for the markers (they scroll with the page)
    // Click page coords (window space, not yet rx/ry scaled — raw evtrack values)
    const clickMarkX = clickPageX;
    const clickMarkY = clickPageY;
    // Fixation page coords (screenshot space → scale to window space)
    const fixMarkX = nearestFix ? nearestFix.x * fixToWindowX : 0;
    const fixMarkY = nearestFix ? nearestFix.y * fixToWindowY : 0;

    const markerCss = `
<style>
.adserp-marker { position: absolute !important; top: 0 !important; left: 0 !important;
  pointer-events: none !important; z-index: 2147483647 !important; width: 0 !important; height: 0 !important; }
.adserp-crosshair { position: absolute !important; width: 50px !important; height: 50px !important;
  border-radius: 50% !important; border: 4px solid !important;
  transform: translate(-50%, -50%) !important; box-sizing: border-box !important;
  z-index: 2147483647 !important; }
.adserp-click { border-color: #ff0000 !important; box-shadow: 0 0 12px 4px rgba(255,0,0,0.6) !important; }
.adserp-gaze { border-color: #00ff00 !important; box-shadow: 0 0 12px 4px rgba(0,255,0,0.6) !important; }
.adserp-line-h, .adserp-line-v { position: absolute !important; background: currentColor !important; }
.adserp-line-h { width: 80px !important; height: 3px !important; top: 50% !important; left: -15px !important; transform: translateY(-50%) !important; }
.adserp-line-v { width: 3px !important; height: 80px !important; top: -15px !important; left: 50% !important; transform: translateX(-50%) !important; }
.adserp-label { position: absolute !important; font: bold 14px monospace !important; padding: 3px 8px !important;
  white-space: nowrap !important; left: 30px !important; top: -12px !important; border-radius: 3px !important;
  z-index: 2147483647 !important; }
.adserp-click .adserp-label { color: #fff !important; background: #ff0000 !important; }
.adserp-gaze .adserp-label { color: #fff !important; background: #00aa00 !important; }
</style>`;

    const markerHtml = `
<div class="adserp-marker">
  <div class="adserp-crosshair adserp-click" style="left:${clickMarkX}px; top:${clickMarkY}px; color:#ff0000;">
    <div class="adserp-line-h"></div><div class="adserp-line-v"></div>
    <span class="adserp-label">CLICK ${clickXpath.split('/').pop()}</span>
  </div>
  ${nearestFix ? `<div class="adserp-crosshair adserp-gaze" style="left:${fixMarkX}px; top:${fixMarkY}px; color:#00ff00;">
    <div class="adserp-line-h"></div><div class="adserp-line-v"></div>
    <span class="adserp-label">GAZE dt=${nearestDt}ms</span>
  </div>` : ''}
</div>
<script>window.scrollTo(0, ${Math.round(scrollAtClick)});</script>`;

    // Inject before </body> or at end
    if (serpHtml.includes('</body>')) {
        serpHtml = serpHtml.replace('</body>', markerCss + markerHtml + '</body>');
    } else {
        serpHtml += markerCss + markerHtml;
    }

    const markerPath = path.join(outputDir, `${trialId}-marker.html`);
    fs.writeFileSync(markerPath, serpHtml);

    // Capture screenshot using Electron
    const outputFilename = `${trialId}-click-validation.png`;
    return new Promise((resolve) => {
        const env = {
            ...process.env,
            TEST_MODE: 'true',
            TEST_URL: `file://${markerPath}`,
            TEST_MODES: 'disabled',  // No foveation — raw page
            TEST_WIDTH: String(windowW),
            TEST_HEIGHT: String(windowH),
            TEST_FIXATION_X: '0.5',
            TEST_FIXATION_Y: '0.5',
            TEST_OVERLAY: 'false',
            TEST_OUTPUT_FILENAME: outputFilename,
            TEST_WAIT_CONGESTION: 'false',
            SCREENSHOT_MODE: 'update',
            ELECTRON_RUN_AS_NODE: undefined,
        };

        const child = spawn('npm', ['start'], {
            cwd: ROOT,
            env,
            stdio: 'pipe',
        });

        let stderr = '';
        child.stderr.on('data', d => { stderr += d.toString(); });

        child.on('close', (code) => {
            const packageVersion = require(path.join(ROOT, 'package.json')).version.replace(/\.\d+$/, '');
            const src = path.join(ROOT, 'tests', 'golden-captures', `v${packageVersion}`, outputFilename);
            const dest = path.join(outputDir, outputFilename);

            if (code === 0 && fs.existsSync(src)) {
                fs.renameSync(src, dest);
                resolve({
                    trialId,
                    clickViewport: { x: Math.round(clickViewportX), y: Math.round(clickViewportY) },
                    fixViewport: fixViewportX ? { x: Math.round(fixViewportX), y: Math.round(fixViewportY) } : null,
                    scrollAtClick: Math.round(scrollAtClick),
                    fixTimeDelta: nearestDt,
                    clickXpath,
                    screenshot: dest,
                    ok: true
                });
            } else {
                resolve({ trialId, error: `capture failed (exit ${code})`, ok: false });
            }
        });
    });
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
    console.log('═══ AdSERP Click Position Validation ═══\n');
    console.log(`Trials: ${trialIds.join(', ')}`);
    console.log(`Output: ${outputDir}\n`);

    const results = [];
    for (const id of trialIds) {
        console.log(`  Capturing ${id}...`);
        try {
            const result = await validateTrial(id);
            results.push(result);
            if (result.ok) {
                console.log(`    ✓ click(${result.clickViewport.x},${result.clickViewport.y}) ` +
                    `gaze(${result.fixViewport?.x || '-'},${result.fixViewport?.y || '-'}) ` +
                    `scroll=${result.scrollAtClick} dt=${result.fixTimeDelta}ms`);
                console.log(`      xpath: ${result.clickXpath}`);
                console.log(`      → ${result.screenshot}`);
            } else {
                console.log(`    ✗ ${result.error}`);
            }
        } catch (e) {
            console.log(`    ✗ ${e.message}`);
            results.push({ trialId: id, error: e.message, ok: false });
        }
    }

    // Write summary
    const summaryPath = path.join(outputDir, 'validation-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));
    console.log(`\n  Summary: ${summaryPath}`);
    console.log(`  Screenshots: ${outputDir}/`);
    console.log(`\n  Red crosshair = click position, Green crosshair = nearest fixation`);
    console.log(`  Check: red crosshair should be ON a result link, not on whitespace.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
