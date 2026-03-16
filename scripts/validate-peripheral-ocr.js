#!/usr/bin/env node
/**
 * Peripheral Degradation OCR Validation
 *
 * Measures text legibility as a function of eccentricity from the fixation point.
 * A working foveal simulation should produce:
 *   - High OCR confidence in the foveal region
 *   - Monotonically declining confidence toward the periphery
 *
 * Uses tesseract.js (WASM-based, no native deps) to OCR a mode 13 screenshot,
 * then partitions recognized characters by distance from fixation into annular
 * rings and reports per-ring confidence.
 *
 * Usage:
 *   node scripts/validate-peripheral-ocr.js [--screenshot path/to/png] [--fixation-x 0.5] [--fixation-y 0.5]
 *
 * If no screenshot is provided, runs the integration test to capture one first.
 *
 * Exit codes:
 *   0 = monotonic decline confirmed
 *   1 = validation failed (non-monotonic or insufficient data)
 */

'use strict';

const fs = require('fs');
const path = require('path');

async function main() {
    const args = process.argv.slice(2);
    let screenshotPath = null;
    let fixationX = 0.5; // normalized
    let fixationY = 0.5;

    // Parse args
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--screenshot' && args[i + 1]) {
            screenshotPath = args[++i];
        } else if (args[i] === '--fixation-x' && args[i + 1]) {
            fixationX = parseFloat(args[++i]);
        } else if (args[i] === '--fixation-y' && args[i + 1]) {
            fixationY = parseFloat(args[++i]);
        }
    }

    // Find a screenshot if none provided
    if (!screenshotPath) {
        const packageVersion = require('../package.json').version.replace(/\.\d+$/, '');
        const captureDir = path.join(__dirname, '..', 'tests', 'golden-captures', `v${packageVersion}`);

        if (fs.existsSync(captureDir)) {
            const files = fs.readdirSync(captureDir)
                .filter(f => f.includes('mode_13') && f.endsWith('.png'))
                .sort()
                .reverse();
            if (files.length > 0) {
                screenshotPath = path.join(captureDir, files[0]);
                console.log(`Using most recent mode 13 capture: ${screenshotPath}`);
            }
        }

        if (!screenshotPath) {
            console.error('No mode 13 screenshot found. Run the integration test first:');
            console.error('  TEST_MODES=13 npm run test:integration');
            process.exit(1);
        }
    }

    if (!fs.existsSync(screenshotPath)) {
        console.error(`Screenshot not found: ${screenshotPath}`);
        process.exit(1);
    }

    // Load tesseract.js
    let Tesseract;
    try {
        Tesseract = require('tesseract.js');
    } catch (e) {
        console.error('tesseract.js not installed. Run:');
        console.error('  npm install --save-dev tesseract.js');
        process.exit(1);
    }

    console.log('Loading OCR engine...');
    const worker = await Tesseract.createWorker('eng');

    console.log(`Running OCR on ${path.basename(screenshotPath)}...`);
    const { data } = await worker.recognize(screenshotPath);

    await worker.terminate();

    if (!data.words || data.words.length === 0) {
        console.error('No text recognized in screenshot.');
        process.exit(1);
    }

    // Get image dimensions from the PNG
    const { PNG } = require('pngjs');
    const png = PNG.sync.read(fs.readFileSync(screenshotPath));
    const imgW = png.width;
    const imgH = png.height;

    // Fixation point in pixels
    const fixPxX = fixationX * imgW;
    const fixPxY = fixationY * imgH;

    // Fovea radius estimate — use 180px CSS * 2 DPR as default
    const foveaRadiusPx = 360;

    // Define annular rings
    const rings = [
        { name: 'fovea',       rMin: 0,   rMax: 0.75, words: [], confidences: [] },
        { name: 'parafovea',   rMin: 0.75, rMax: 1.5,  words: [], confidences: [] },
        { name: 'near_periph', rMin: 1.5, rMax: 3.0,  words: [], confidences: [] },
        { name: 'far_periph',  rMin: 3.0, rMax: 8.0,  words: [], confidences: [] },
    ];

    // Partition recognized words by distance from fixation
    for (const word of data.words) {
        const bbox = word.bbox;
        const wordCenterX = (bbox.x0 + bbox.x1) / 2;
        const wordCenterY = (bbox.y0 + bbox.y1) / 2;
        const dx = wordCenterX - fixPxX;
        const dy = wordCenterY - fixPxY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const normDist = dist / foveaRadiusPx;

        for (const ring of rings) {
            if (normDist >= ring.rMin && normDist < ring.rMax) {
                ring.words.push(word.text);
                ring.confidences.push(word.confidence);
                break;
            }
        }
    }

    // Report results
    console.log('\n═══ Peripheral OCR Accuracy Curve ═══\n');
    console.log(`Image: ${imgW}×${imgH}px`);
    console.log(`Fixation: (${fixPxX.toFixed(0)}, ${fixPxY.toFixed(0)})`);
    console.log(`Fovea radius: ${foveaRadiusPx}px`);
    console.log(`Total words recognized: ${data.words.length}\n`);

    const ringResults = [];
    for (const ring of rings) {
        const avgConf = ring.confidences.length > 0
            ? ring.confidences.reduce((a, b) => a + b, 0) / ring.confidences.length
            : null;
        const wordCount = ring.words.length;

        ringResults.push({
            ring: ring.name,
            rMin: ring.rMin,
            rMax: ring.rMax,
            wordCount,
            avgConfidence: avgConf,
        });

        const confStr = avgConf !== null ? `${avgConf.toFixed(1)}%` : 'N/A';
        const bar = avgConf !== null ? '█'.repeat(Math.round(avgConf / 2)) : '';
        console.log(`  ${ring.name.padEnd(14)} ${String(wordCount).padStart(4)} words  conf: ${confStr.padStart(7)}  ${bar}`);
    }

    // Write JSON results for tracking
    const resultsPath = path.join(__dirname, '..', 'tests', 'validation', 'ocr-accuracy-curve.json');
    const resultsDir = path.dirname(resultsPath);
    if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

    fs.writeFileSync(resultsPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        screenshot: path.basename(screenshotPath),
        fixation: { x: fixationX, y: fixationY },
        foveaRadiusPx,
        totalWords: data.words.length,
        rings: ringResults,
    }, null, 2));
    console.log(`\nResults saved to: ${resultsPath}`);

    // Validate monotonic decline
    console.log('\n═══ Validation ═══\n');
    const populated = ringResults.filter(r => r.avgConfidence !== null && r.wordCount >= 3);

    if (populated.length < 2) {
        console.warn('Insufficient data for monotonic decline check (need >= 2 rings with >= 3 words each).');
        process.exit(1);
    }

    let monotonic = true;
    for (let i = 1; i < populated.length; i++) {
        if (populated[i].avgConfidence > populated[i - 1].avgConfidence + 2.0) {
            // Allow 2% tolerance for noise
            console.error(`Non-monotonic: ${populated[i].ring} (${populated[i].avgConfidence.toFixed(1)}%) > ${populated[i - 1].ring} (${populated[i - 1].avgConfidence.toFixed(1)}%)`);
            monotonic = false;
        }
    }

    if (monotonic) {
        console.log('PASS: OCR confidence shows monotonic decline from fovea to periphery.');
        process.exit(0);
    } else {
        console.error('FAIL: OCR confidence does not decline monotonically.');
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
