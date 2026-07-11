#!/usr/bin/env node
/**
 * Controlled-stimulus radial capture — companion to validate-radial-profile.js.
 *
 * Renders the app's DEFAULT aesthetic mode (12) over stimuli with KNOWN,
 * radially-uniform spatial statistics, so a radial contrast profile isolates
 * the RENDERER's behavior from the dashboard's content layout.
 *
 * Output in tests/smoke-captures/ so validate-radial-profile.js can read it.
 */
const path = require('path');
const fs = require('fs');
const { run } = require('./lib/capture-runner');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'tests', 'smoke-captures');
const fullVersion = require('../package.json').version;
const REF = `file://${path.join(ROOT, 'tests', 'reference-pages')}`;

const base = {
    mode: '12', fixationX: 0.5, fixationY: 0.5,
    selector: '', overlay: false,
    radius: '45', width: '1920', height: '1080', mobile: 'false',
};

const SPECS = [
    // Flat achromatic field — no content anywhere. Any stdDev > ~0 in the
    // periphery here is pure render-injected structure (RC-2.6 target).
    { ...base, filename: 'ctrl_flatgray_mode12.png', url: `${REF}/chroma-uniform.html?color=gray` },
    // Full-field noise, uniform statistics. A correct degradation curve should
    // decline monotonically; a peripheral hump is a render defect.
    { ...base, filename: 'ctrl_noise_mode12.png', url: `${REF}/uniform-noise.html?cell=3&amp=0.5&seed=12345` },
    // Coarser noise (energy at lower spatial frequency, robust to downsampling).
    { ...base, filename: 'ctrl_noise8_mode12.png', url: `${REF}/uniform-noise.html?cell=8&amp=0.5&seed=777` },
    // Full-viewport periodic grid — stationary statistics across the field.
    { ...base, filename: 'ctrl_grid_mode12.png', url: `${REF}/grid.html` },
];

async function main() {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const force = process.argv.includes('--force');
    const result = await run(SPECS, { outputDir: OUTPUT_DIR, appVersion: fullVersion, force });
    console.log(`\nControlled capture: captured ${result.captured}, skipped ${result.skipped}, failed ${result.failed}`);
    if (result.failed > 0) process.exit(1);
}
main();
