#!/usr/bin/env node
/**
 * Peripheral Degradation OCR Validation — Relative Recognition Rate
 *
 * Compares character recognition between a processed screenshot and a frozen
 * baseline to measure how much text the shader destroys at each eccentricity.
 *
 * Metric: recognition_rate = scrambled_chars / baseline_chars per ring.
 * A working simulation should produce:
 *   - Fovea: rate >= foveal threshold (text preserved; RC-2.1)
 *   - A declining recognition trend toward the periphery (RC-2.2; crowding is
 *     content-dependent, so a strict per-ring monotone is NOT required)
 *   - Far-periph rate <= 55% (RC-2.3): periphery degraded — far-peripheral text is
 *     correctly near-unreadable (humans cannot read at 10-30 deg eccentricity)
 *   - Parafovea >= 10% (RC-2.5): the near-fovea transition is not obliterated
 *     (gracefully degraded, not an immediate cliff to ~0)
 *
 * The baseline is frozen: OCR'd once from a disabled-mode capture at a pinned
 * viewport (1920x1012), saved to tests/validation/ocr-baseline.json. This
 * eliminates variance from viewport differences between captures.
 *
 * Usage:
 *   node scripts/validate-peripheral-ocr.js [options]
 *     --screenshot <path>   Processed screenshot (default: capture mode 0)
 *     --capture             Force re-capture of processed screenshot
 *     --freeze-baseline     Re-capture and freeze a new baseline
 *     --fixation-x <0-1>    Horizontal fixation point (default: 0.5)
 *     --fixation-y <0-1>    Vertical fixation point (default: 0.5)
 *
 * Exit codes:
 *   0 = all criteria pass
 *   1 = validation FAILED (a real preservation/degradation criterion not met)
 *   2 = INVALID measurement (DPR/mode mismatch, zero read, or unreadable fovea —
 *       the gate refuses to score it rather than emit a bogus 0% curve)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Annular ring definitions (in fovea-radius units)
// Ring boundaries in multiples of fovea radius (45 CSS px = ~1° visual angle).
// Fovea: 0–2° (0–2× radius), parafovea: 2–5° (2–5×), near: 5–10° (5–10×), far: 10°+
// At 90px fovea (2x DPR): fovea=0-180px, parafovea=180-450px, near=450-900px, far=900+
const RING_DEFS = [
    { name: 'fovea',       rMin: 0,   rMax: 2.0  },
    { name: 'parafovea',   rMin: 2.0, rMax: 5.0  },
    { name: 'near_periph', rMin: 5.0, rMax: 10.0 },
    { name: 'far_periph',  rMin: 10.0, rMax: 30.0 },
];

// Fovea radius: 45px CSS on a 1012px CSS viewport = 0.0445 normalized.
// Multiply by actual image height to get pixel radius for any DPR.
const FOVEA_RADIUS_NORM = 45 / 1012;

// Pinned viewport — all captures use this size for consistency
const VIEWPORT_WIDTH = 1920;
const VIEWPORT_HEIGHT = 1012;

const OCR_TEST_PAGE = path.join(__dirname, '..', 'tests', 'ocr-test-page.html');
const BASELINE_PATH = path.join(__dirname, '..', 'tests', 'validation', 'ocr-baseline.json');

// eng.traineddata ships at the repo root, so the gate reads text offline and
// reproducibly instead of fetching the model from a CDN on every run.
const TESSERACT_LANG_PATH = path.join(__dirname, '..');

/**
 * Create a Tesseract worker that loads the repo-local eng.traineddata (no network)
 * and reads sparse, scattered text. The foveated page is not a clean column — words
 * survive wherever the shader left them legible — so PSM.SPARSE_TEXT fits better than
 * the default page-segmentation mode.
 */
async function createOcrWorker() {
    const Tesseract = require('tesseract.js');
    const worker = await Tesseract.createWorker('eng', 1 /* OEM.LSTM_ONLY */, {
        langPath: TESSERACT_LANG_PATH,
        gzip: false,           // repo ships uncompressed eng.traineddata, not .gz
        cacheMethod: 'none',
    });
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
    return worker;
}

/**
 * Find the most recent golden capture matching a mode pattern.
 */
function findCapture(captureDir, modePattern) {
    if (!fs.existsSync(captureDir)) return null;
    const files = fs.readdirSync(captureDir)
        .filter(f => f.includes(modePattern) && f.endsWith('.png'))
        .sort()
        .reverse();
    return files.length > 0 ? path.join(captureDir, files[0]) : null;
}

/**
 * Capture a screenshot at the pinned viewport size.
 */
function captureMode(captureDir, mode) {
    const testUrl = `file://${OCR_TEST_PAGE}`;
    console.log(`  Capturing mode ${mode} (${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT})...`);

    const env = {
        ...process.env,
        TEST_MODE: 'true',
        TEST_MODES: mode,
        TEST_URL: testUrl,
        TEST_FIXATION_X: '0.5',
        TEST_FIXATION_Y: '0.5',
        TEST_WIDTH: String(VIEWPORT_WIDTH),
        TEST_HEIGHT: String(VIEWPORT_HEIGHT),
        TEST_DPR: process.env.TEST_DPR || '2', // pin DPR-2 so captures match the DPR-2 baseline (audit 2026-06-05)
    };

    try {
        execSync('node scripts/run-electron.js .', {
            cwd: path.join(__dirname, '..'),
            env,
            stdio: 'pipe',
            timeout: 60000,
        });
    } catch (e) {
        const stderr = e.stderr ? e.stderr.toString() : '';
        if (stderr && !stderr.includes('INTEGRATION TEST PASSED')) {
            console.warn(`  Warning: capture exited with error: ${stderr.slice(0, 200)}`);
        }
    }

    const modePattern = mode === 'disabled' ? 'mode_disabled' : `mode_${mode}`;
    const found = findCapture(captureDir, modePattern);
    if (!found) {
        console.error(`  Failed to capture mode ${mode} screenshot.`);
        process.exit(1);
    }
    console.log(`  Captured: ${path.basename(found)}`);
    return found;
}

/**
 * Run OCR and partition recognized characters into annular rings.
 */
async function ocrByRing(worker, screenshotPath, fixPxX, fixPxY, foveaRadiusPx) {
    // tesseract.js v7: per-word data lives in data.blocks[].paragraphs[].lines[].words[];
    // there is NO flat data.words (the v6 shape), and blocks are only populated when the
    // recognize() call explicitly requests them. The old `worker.recognize(path)` returned
    // data.words === undefined, so this read 0 chars for EVERY image — including a perfect
    // baseline. That, not the DPR mismatch, was the gate's structural killer. (audit 2026-06-05)
    const { data } = await worker.recognize(screenshotPath, {}, { blocks: true });

    const rings = RING_DEFS.map(r => ({ ...r, charCount: 0, wordCount: 0, words: [], confSum: 0 }));

    // Flatten the v7 block tree to a flat word list (each word carries bbox + confidence).
    const words = [];
    for (const block of (data.blocks || []))
        for (const para of (block.paragraphs || []))
            for (const line of (para.lines || []))
                for (const word of (line.words || [])) words.push(word);
    if (!words.length) return { totalChars: 0, rings };

    // Drop low-confidence tokens: shader-scrambled periphery yields garbage "words" that
    // must not count as readable text, and a confident foveal read is exactly what we
    // measure. Absence of a confident read is degradation — never a free pass.
    const CONF_FLOOR = 60;
    let totalChars = 0;
    for (const word of words) {
        if ((word.confidence ?? 0) < CONF_FLOOR) continue;
        const cx = (word.bbox.x0 + word.bbox.x1) / 2;
        const cy = (word.bbox.y0 + word.bbox.y1) / 2;
        const dist = Math.sqrt((cx - fixPxX) ** 2 + (cy - fixPxY) ** 2);
        const normDist = dist / foveaRadiusPx;
        const chars = word.text.replace(/[^a-zA-Z0-9]/g, '').length;
        totalChars += chars;

        for (const ring of rings) {
            if (normDist >= ring.rMin && normDist < ring.rMax) {
                ring.charCount += chars;
                ring.wordCount++;
                ring.confSum += word.confidence;
                ring.words.push(word.text);
                break;
            }
        }
    }

    return { totalChars, rings };
}

/**
 * Freeze a new baseline: capture disabled mode, OCR it, save ring char counts.
 */
async function freezeBaseline(captureDir, fixationX, fixationY) {
    console.log('Freezing new OCR baseline...');
    const baselineScreenshot = captureMode(captureDir, 'disabled');

    const { PNG } = require('pngjs');
    const png = PNG.sync.read(fs.readFileSync(baselineScreenshot));
    const foveaRadiusPx = Math.round(FOVEA_RADIUS_NORM * png.height);
    const fixPxX = fixationX * png.width;
    const fixPxY = fixationY * png.height;

    console.log(`  Image: ${png.width}x${png.height}px, fovea radius: ${foveaRadiusPx}px`);

    const worker = await createOcrWorker();
    const result = await ocrByRing(worker, baselineScreenshot, fixPxX, fixPxY, foveaRadiusPx);
    await worker.terminate();

    const baselineData = {
        timestamp: new Date().toISOString(),
        screenshot: path.basename(baselineScreenshot),
        viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
        fixation: { x: fixationX, y: fixationY },
        foveaRadiusPx,
        imageSize: { width: png.width, height: png.height },
        dpr: +(png.width / VIEWPORT_WIDTH).toFixed(2),
        mode: 'disabled',
        totalChars: result.totalChars,
        rings: result.rings.map(r => ({
            name: r.name, rMin: r.rMin, rMax: r.rMax,
            charCount: r.charCount, wordCount: r.wordCount,
        })),
    };

    const dir = path.dirname(BASELINE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(baselineData, null, 2));

    console.log(`\n  Baseline frozen: ${result.totalChars} chars total`);
    for (const r of result.rings) {
        console.log(`    ${r.name.padEnd(14)} ${String(r.charCount).padStart(5)} ch  (${r.wordCount} words)`);
    }
    console.log(`  Saved to: ${BASELINE_PATH}\n`);

    return baselineData;
}

async function main() {
    const args = process.argv.slice(2);
    let screenshotPath = null;
    let fixationX = 0.5;
    let fixationY = 0.5;
    let forceCapture = false;
    let doFreezeBaseline = false;
    let mode = '0'; // render mode to capture/validate; 0 is the reference, 12 is the restored default

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--screenshot' && args[i + 1]) screenshotPath = args[++i];
        else if (args[i] === '--fixation-x' && args[i + 1]) fixationX = parseFloat(args[++i]);
        else if (args[i] === '--fixation-y' && args[i + 1]) fixationY = parseFloat(args[++i]);
        else if (args[i] === '--capture') forceCapture = true;
        else if (args[i] === '--freeze-baseline') doFreezeBaseline = true;
        else if (args[i] === '--mode' && args[i + 1]) mode = args[++i];
    }

    const packageVersion = require('../package.json').version.replace(/\.\d+$/, '');
    const captureDir = path.join(__dirname, '..', 'tests', 'golden-captures', `v${packageVersion}`);

    // Load tesseract.js
    let Tesseract;
    try {
        Tesseract = require('tesseract.js');
    } catch (e) {
        console.error('tesseract.js not installed. Run:');
        console.error('  npm install --save-dev tesseract.js');
        process.exit(1);
    }

    // Freeze baseline if requested or if none exists
    if (doFreezeBaseline || !fs.existsSync(BASELINE_PATH)) {
        if (!fs.existsSync(BASELINE_PATH)) {
            console.log('No frozen baseline found — creating one...');
        }
        await freezeBaseline(captureDir, fixationX, fixationY);
        if (doFreezeBaseline && !forceCapture && !screenshotPath) {
            console.log('Baseline frozen. Run again without --freeze-baseline to validate.');
            process.exit(0);
        }
    }

    // Load frozen baseline
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    console.log(`Baseline: ${baseline.screenshot} (${baseline.totalChars} chars, frozen ${baseline.timestamp.split('T')[0]})`);

    // Get or capture processed screenshot
    if (!screenshotPath) {
        screenshotPath = forceCapture ? null : findCapture(captureDir, `mode_${mode}`);
        if (!screenshotPath) {
            console.log('Capturing processed screenshot...');
            screenshotPath = captureMode(captureDir, mode);
        } else {
            console.log(`Processed: ${path.basename(screenshotPath)}`);
        }
    }

    if (!fs.existsSync(screenshotPath)) {
        console.error(`File not found: ${screenshotPath}`);
        process.exit(1);
    }

    // OCR the processed screenshot using baseline's fixation point
    const { PNG } = require('pngjs');
    const png = PNG.sync.read(fs.readFileSync(screenshotPath));
    const imgW = png.width;
    const imgH = png.height;
    const foveaRadiusPx = Math.round(FOVEA_RADIUS_NORM * imgH);
    const fixPxX = baseline.fixation.x * imgW;
    const fixPxY = baseline.fixation.y * imgH;

    console.log(`\nImage: ${imgW}x${imgH}px  Fixation: (${fixPxX.toFixed(0)}, ${fixPxY.toFixed(0)})  Fovea: ${foveaRadiusPx}px`);

    // HARD-FAIL on DPR/size mismatch (audit 2026-06-05, B4). Scoring a half-size (DPR-1)
    // capture against a DPR-2 baseline is exactly what zeroed this gate out for weeks:
    // glyphs drop below Tesseract's resolution floor, every ring reads 0, and the old
    // code recorded that 0 as a "measurement" instead of refusing. Exit 2 = INVALID.
    if (baseline.imageSize && (imgW !== baseline.imageSize.width || imgH !== baseline.imageSize.height)) {
        console.error(`  ✗ INVALID: capture DPR/size mismatch.`);
        console.error(`    processed: ${imgW}x${imgH}   baseline: ${baseline.imageSize.width}x${baseline.imageSize.height}`);
        console.error(`    Re-capture at TEST_DPR=2 (force-device-scale-factor=2); the gate refuses to score half-size text.`);
        process.exit(2);
    }

    console.log('\nLoading OCR engine...');
    const worker = await createOcrWorker();
    console.log('OCR processed...');
    const scrambled = await ocrByRing(worker, screenshotPath, fixPxX, fixPxY, foveaRadiusPx);
    await worker.terminate();

    // INVALID guards (audit 2026-06-05, B4): a zero read, or a fovea that lost most of its
    // text, means the MEASUREMENT failed (scale / mode / contrast) — it is not evidence of
    // peripheral degradation. Refuse rather than emit a bogus all-zeros curve.
    if (scrambled.totalChars === 0) {
        console.error('  ✗ INVALID: OCR read zero characters from the processed capture (suspect DPR / mode / contrast).');
        process.exit(2);
    }
    {
        const foveaBaseChars = baseline.rings[0].charCount;
        const foveaReadChars = scrambled.rings[0].charCount;
        if (foveaBaseChars >= 5 && foveaReadChars < 0.5 * foveaBaseChars) {
            console.error(`  ✗ INVALID: foveal text unreadable (${foveaReadChars}/${foveaBaseChars} chars) — suspect scale/mode mismatch, not degradation.`);
            process.exit(2);
        }
    }

    // Compute per-ring recognition rate against frozen baseline
    console.log('\n═══ Peripheral OCR Recognition Rate ═══\n');
    console.log(`  ${'Ring'.padEnd(14)} ${'Baseline'.padStart(8)} ${'Processed'.padStart(9)} ${'Rate'.padStart(7)}  Visual`);
    console.log(`  ${'─'.repeat(60)}`);

    const ringResults = [];
    for (let i = 0; i < RING_DEFS.length; i++) {
        const b = baseline.rings[i];
        const s = scrambled.rings[i];
        const rate = b.charCount > 0 ? s.charCount / b.charCount : null;

        ringResults.push({
            ring: b.name,
            rMin: b.rMin,
            rMax: b.rMax,
            baselineChars: b.charCount,
            scrambledChars: s.charCount,
            recognitionRate: rate,
        });

        const rateStr = rate !== null ? `${(rate * 100).toFixed(1)}%` : 'N/A';
        const bar = rate !== null ? '█'.repeat(Math.round(rate * 40)) : '';
        console.log(`  ${b.name.padEnd(14)} ${String(b.charCount).padStart(5)} ch ${String(s.charCount).padStart(5)} ch ${rateStr.padStart(7)}  ${bar}`);
    }

    console.log(`\n  Total: baseline ${baseline.totalChars} chars, processed ${scrambled.totalChars} chars`);
    if (baseline.totalChars > 0) {
        console.log(`  Overall recognition rate: ${((scrambled.totalChars / baseline.totalChars) * 100).toFixed(1)}%`);
    }

    // Write JSON results
    const resultsPath = path.join(__dirname, '..', 'tests', 'validation', 'ocr-accuracy-curve.json');
    const resultsDir = path.dirname(resultsPath);
    if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

    fs.writeFileSync(resultsPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        processed: path.basename(screenshotPath),
        baseline: baseline.screenshot,
        baselineFrozen: baseline.timestamp,
        fixation: baseline.fixation,
        foveaRadiusPx,
        dpr: +(imgW / VIEWPORT_WIDTH).toFixed(2),
        mode,
        baselineFoveaRadiusPx: baseline.foveaRadiusPx,
        baselineTotalChars: baseline.totalChars,
        processedTotalChars: scrambled.totalChars,
        rings: ringResults,
    }, null, 2));
    console.log(`\nResults saved to: ${resultsPath}`);

    // Validation
    console.log('\n═══ Validation ═══\n');
    let pass = true;

    // RC-2.1: Foveal text preserved (>= 85%)
    const foveaResult = ringResults[0];
    if (foveaResult.recognitionRate !== null && foveaResult.baselineChars >= 5) {
        const foveaPct = (foveaResult.recognitionRate * 100).toFixed(1);
        // Threshold 70%: v2.3 (gold standard) scores 76% at 2x DPR due to
        // rendering pipeline differences between disabled and HUD captures.
        if (foveaResult.recognitionRate >= 0.70) {
            console.log(`  ✓ RC-2.1 Foveal recognition: ${foveaPct}% (threshold: >= 70%)`);
        } else {
            console.error(`  ✗ RC-2.1 Foveal recognition: ${foveaPct}% (threshold: >= 70%)`);
            pass = false;
        }
    } else {
        console.warn(`  ? RC-2.1 Foveal recognition: insufficient baseline chars in fovea (${foveaResult.baselineChars})`);
    }

    // RC-2.2: declining recognition TREND toward the periphery. Crowding is
    // content-dependent (Bouma), so a strict per-ring monotone is the wrong test — the
    // old +0.05-tolerant check let the prose profile's 60→62 rise pass while still
    // printing "monotonically declines". Fit a line over the populated rings and require
    // a negative slope.
    const populated = ringResults.filter(r => r.recognitionRate !== null && r.baselineChars >= 5);
    if (populated.length >= 3) {
        const ys = populated.map(r => r.recognitionRate);
        const n = ys.length;
        const sx = (n - 1) * n / 2;
        const sxx = (n - 1) * n * (2 * n - 1) / 6;
        const sy = ys.reduce((a, b) => a + b, 0);
        const sxy = ys.reduce((a, y, i) => a + i * y, 0);
        const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
        if (slope < 0) {
            console.log(`  ✓ RC-2.2 Declining recognition trend (slope ${slope.toFixed(3)} per ring)`);
        } else {
            console.error(`  ✗ RC-2.2 No declining trend (slope ${slope.toFixed(3)} per ring)`);
            pass = false;
        }
    } else {
        console.warn(`  ? RC-2.2 Trend check: only ${populated.length} ring(s) with >= 5 baseline chars`);
    }

    // Far peripheral degradation
    const farResult = ringResults[3]; // far_periph
    if (farResult.recognitionRate !== null && farResult.baselineChars >= 5) {
        const farPct = (farResult.recognitionRate * 100).toFixed(1);
        if (farResult.recognitionRate <= 0.55) {
            console.log(`  ✓ RC-2.3 Far-periph degradation: ${farPct}% (threshold: <= 55%)`);
        } else {
            console.error(`  ✗ RC-2.3 Far-periph degradation: ${farPct}% (threshold: <= 55%)`);
            pass = false;
        }
    }

    // RC-2.5: the PARAFOVEA (near-fovea transition) must not be totally destroyed —
    // degradation there should be graceful, not a cliff to zero. Scoped to the parafovea
    // on purpose: near/far-peripheral text being near-unreadable is biologically correct
    // (humans cannot read at 10-30 deg eccentricity), so a floor out there would wrongly
    // fail every faithful foveation model. (Calibrated 2026-06-06 against the first real
    // OCR curves — both mode 0 and mode 12 correctly read ~0% in the far periphery.)
    // The floor is 10%, NOT a precise parafoveal target: the parafovea is a noisy,
    // borderline ring (the validated mode-12 default measured 15-24% across DPR-1/DPR-2
    // captures), so a higher floor would flip pass/fail on capture noise. 10% cleanly
    // separates graceful degradation (15%+) from obliteration (near/far sit at ~0-1%).
    const parafoveaResult = ringResults[1];
    if (parafoveaResult.recognitionRate !== null && parafoveaResult.baselineChars >= 5) {
        const paraPct = (parafoveaResult.recognitionRate * 100).toFixed(1);
        if (parafoveaResult.recognitionRate >= 0.10) {
            console.log(`  ✓ RC-2.5 Parafovea not obliterated: ${paraPct}% (floor: >= 10%)`);
        } else {
            console.error(`  ✗ RC-2.5 Over-degraded: parafovea ${paraPct}% < 10% floor (cliff to ~0 immediately outside the fovea).`);
            pass = false;
        }
    }

    // Overall drop
    if (populated.length >= 2) {
        const outermost = populated[populated.length - 1];
        const innermost = populated[0];
        const drop = innermost.recognitionRate - outermost.recognitionRate;
        if (drop > 0.2) {
            console.log(`  ✓ Peripheral degradation: ${(drop * 100).toFixed(1)}pp drop from ${innermost.ring} to ${outermost.ring}`);
        } else {
            console.error(`  ✗ Insufficient peripheral degradation: only ${(drop * 100).toFixed(1)}pp drop`);
            pass = false;
        }
    }

    console.log('');
    if (pass) {
        console.log('PASS: OCR recognition rate validates foveal preservation + peripheral degradation.');
        process.exit(0);
    } else {
        console.error('FAIL: OCR recognition rate validation did not meet criteria.');
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
