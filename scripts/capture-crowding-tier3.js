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
const CROWDING_PAGE = 'file://' + path.join(ROOT, 'tests', 'reference-pages', 'crowding-stimulus.html');

// Eccentricity target: 8° at 45 px/deg = 360px from fixation
// Fixation at center (960, 540 at 1920x1080)
// Letter placement: 360px to the right of fixation → x = 1320/1920 ≈ 0.6875
const LETTER_X_NORM = 0.6875;
const FIX_X = 0.5;
const FIX_Y = 0.5;

const force = process.argv.includes('--force');

// Stimulus conditions:
//   isolated=true  → single letter at 8°
//   isolated=false → letter flanked by 2 letters at Bouma spacing
const CONDITIONS = [
    { name: 'isolated', queryParam: 'flankers=0' },
    { name: 'flanked',  queryParam: 'flankers=2&spacing=bouma' },
];

// Modes to capture
const MODES = [
    { name: 'mode10', mode: 10, desc: 'Tier 2.5 (baseline)' },
    { name: 'mode14', mode: 14, desc: 'Tier 2.75 (pyramid synthesis)' },
    { name: 'mode12', mode: 12, desc: 'Tier 1.7 (displacement, default)' },
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
