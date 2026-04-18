#!/usr/bin/env node
/**
 * Temporal Variance Capture
 *
 * Captures N frames at incrementing gaze positions along a short horizontal
 * sweep, for each mode being compared. Purpose: quantify how much the
 * compositor output changes frame-to-frame in the parafovea and near
 * periphery as gaze drifts. Mode 20's procedural stripe field has sharper
 * spatial edges than mode 15/16's pooled peripheral output, so any shift
 * in blend weights driven by small gaze changes can produce motion-onset
 * artifacts that capture peripheral attention (Abrams & Christ 2003;
 * Franconeri & Simons 2003). A test is needed to bound this empirically.
 *
 * Output: PNG stack per mode, plus capture-metadata.json for the analyzer
 * (scripts/validate-temporal-variance.py).
 *
 * Usage:
 *   node scripts/capture-temporal-variance.js
 *   BASE_URL=http://localhost:8080 node scripts/capture-temporal-variance.js
 */

const path = require('path');
const fs = require('fs');
const { run } = require('./lib/capture-runner');

const BASE_URL = process.env.BASE_URL || 'https://andyed.github.io/scrutinizer-www/reference-pages';
const OUTPUT_DIR = path.join(__dirname, '..', 'tests', 'temporal-variance');

const VIEWPORT_WIDTH  = Number(process.env.CAPTURE_WIDTH  || 1920);
const VIEWPORT_HEIGHT = Number(process.env.CAPTURE_HEIGHT || 1080);
const FOVEA_RADIUS_PX = String(process.env.CAPTURE_FOVEA_RADIUS || 45); // = ppd

const FIXTURE = {
    slug: 'dashboard',
    url:  `${BASE_URL}/dashboard.html`,
};

// 10 frames × 3 px per step = 30 px sweep ≈ 0.67° at ppd=45. Short enough
// that a pixel stays in roughly the same eccentricity band throughout;
// long enough that blend-weight shifts are detectable above frame jitter.
const SWEEP = {
    centerX:   0.50,
    centerY:   0.50,
    stepPx:    3,
    frameCount: 10,
};

// Mode 20 = DOM-aware procedural compositor (under audit).
// Mode 16 = pre-DOM-aware baseline arm (High-Key clone); same pipeline, no
//           compositor. Serves as the baseline for the motion-ratio test.
// Mode 15 = TTM Tier 3 (pooling-based peripheral); secondary reference.
const MODES = ['16', '15', '20'];

function buildSpecs() {
    const specs = [];
    for (const mode of MODES) {
        // Center the sweep at SWEEP.centerX — frame i offsets by (i - (N-1)/2) * stepPx.
        const centerFrame = (SWEEP.frameCount - 1) / 2;
        for (let i = 0; i < SWEEP.frameCount; i++) {
            const dxPx = (i - centerFrame) * SWEEP.stepPx;
            const fixationX = SWEEP.centerX + dxPx / VIEWPORT_WIDTH;
            const filename = path.join(
                OUTPUT_DIR,
                `${FIXTURE.slug}_mode${mode}_frame${String(i).padStart(2, '0')}.png`
            );
            specs.push({
                filename,
                url:        FIXTURE.url,
                mode,
                fixationX,
                fixationY:  SWEEP.centerY,
                radius:     FOVEA_RADIUS_PX,
                overlay:    false,
                width:      String(VIEWPORT_WIDTH),
                height:     String(VIEWPORT_HEIGHT),
            });
        }
    }
    return specs;
}

async function main() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const specs = buildSpecs();
    console.log(
        `[TempVar] Capturing ${specs.length} frames ` +
        `(${SWEEP.frameCount} frames × ${MODES.length} modes) ` +
        `sweep ±${(SWEEP.frameCount - 1) * SWEEP.stepPx / 2}px around ` +
        `(${SWEEP.centerX}, ${SWEEP.centerY})`
    );

    // Metadata for the Python analyzer — includes centerX (in pixels)
    // for eccentricity binning and ppd so the analyzer doesn't have to
    // guess.
    const meta = {
        fixture:     FIXTURE,
        sweep:       SWEEP,
        modes:       MODES,
        viewport:    { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
        ppd:         Number(FOVEA_RADIUS_PX),
        centerPx:    {
            x: SWEEP.centerX * VIEWPORT_WIDTH,
            y: SWEEP.centerY * VIEWPORT_HEIGHT
        },
        frames: specs.map(s => ({
            mode:      s.mode,
            fixationX: s.fixationX,
            fixationY: s.fixationY,
            filename:  path.basename(s.filename),
        })),
    };
    fs.writeFileSync(
        path.join(OUTPUT_DIR, 'capture-metadata.json'),
        JSON.stringify(meta, null, 2)
    );

    await run(specs, {
        outputDir:   OUTPUT_DIR,
        appVersion:  'temporal-variance',
        force:       true,
    });

    console.log('');
    console.log('[TempVar] Capture complete.');
    console.log('[TempVar] Next: uv run --python 3.12 scripts/validate-temporal-variance.py');
}

main().catch(err => {
    console.error('[TempVar] Capture failed:', err);
    process.exit(1);
});
