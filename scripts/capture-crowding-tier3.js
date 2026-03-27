#!/usr/bin/env node
/**
 * Wave 7c: Capture Crowding Stimuli Through Tier 2.75/3 Pipeline
 *
 * Generates the key diagnostic captures for crowding asymmetry:
 *   - Isolated letter at 8° eccentricity
 *   - Flanked letter at 8° eccentricity (same letter, with flankers)
 *   - Both through Tier 2.75 (mode 14) and Tier 2.5 (mode 10) for comparison
 *
 * The crowding asymmetry test is the scientific milestone for Tier 3:
 * if synthesis destroys flanked-letter identity but preserves isolated-letter
 * identity, the pooling mechanism is producing crowding as an emergent property.
 *
 * Usage:
 *   node scripts/capture-crowding-tier3.js
 *   node scripts/capture-crowding-tier3.js --force
 *
 * Exit codes:
 *   0 = captures written
 *   1 = capture failed
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { run } = require('./lib/capture-runner');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'tests', 'crowding-captures', 'tier3');
// Minimal OCR crowding test page (not the research grid — that's crowding-stimulus.html)
const WWW_ROOT = path.join(ROOT, '..', 'scrutinizer-www', 'src', 'reference-pages');
const CROWDING_PAGE = 'file://' + path.join(WWW_ROOT, 'crowding-ocr-test.html');

// Eccentricity target: 8° at 45 px/deg = 360px from fixation
// Fixation at center (960, 506 at 1920x1012 frame)
const FIX_X = 0.5;
const FIX_Y = 0.5;

const force = process.argv.includes('--force');

// Stimulus conditions:
//   isolated → single letter at 8° (flankers=0)
//   flanked  → letter with 2 flankers at Bouma spacing
// seed=42 for reproducible letter selection across captures
const CONDITIONS = [
    { name: 'isolated', queryParam: 'flankers=0&ecc=8&seed=42&letter=H' },
    { name: 'flanked',  queryParam: 'flankers=2&ecc=8&spacing=bouma&seed=42&letter=H' },
];

// Modes to capture — displacement, tiles, sectors
const MODES = [
    { name: 'mode12', mode: 12, desc: 'Displacement only (control — no pooling)' },
    { name: 'mode14', mode: 14, desc: 'Pyramid Mongrel (tiles, Tier 2.75)' },
    { name: 'mode15', mode: 15, desc: 'TTM Synthesis (sectors, Tier 3)' },
];

async function main() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const specs = [];

    for (const cond of CONDITIONS) {
        for (const mode of MODES) {
            specs.push({
                filename: `crowding_${cond.name}_${mode.name}.png`,
                url: `${CROWDING_PAGE}?${cond.queryParam}`,
                mode: mode.mode,
                fixationX: FIX_X,
                fixationY: FIX_Y,
                width: 1920,
                height: 1080,
            });
        }
    }

    // Also capture unfiltered (raw) for reference
    for (const cond of CONDITIONS) {
        specs.push({
            filename: `crowding_${cond.name}_raw.png`,
            url: `${CROWDING_PAGE}?${cond.queryParam}`,
            mode: 'off',
            fixationX: FIX_X,
            fixationY: FIX_Y,
            width: 1920,
            height: 1080,
        });
    }

    console.log(`Capturing ${specs.length} crowding stimuli (${CONDITIONS.length} conditions × ${MODES.length + 1} modes)...`);

    try {
        await run(specs, {
            outputDir: OUTPUT_DIR,
            appVersion: 'crowding-tier3',
            force,
        });
    } catch (err) {
        console.error('Capture failed:', err.message);
        process.exit(1);
    }

    const captured = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.png'));
    console.log(`\nCaptured ${captured.length} files to ${OUTPUT_DIR}/`);
    for (const f of captured) {
        console.log(`  ${f}`);
    }

    console.log('\nNext: node scripts/validate-crowding-tier3.js');
    process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
