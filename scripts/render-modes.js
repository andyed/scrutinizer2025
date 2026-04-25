#!/usr/bin/env node
/**
 * Mode-sweep renderer — load a URL into BrowserView, render through each
 * specified mode at given fixation, capture PNG per mode. Generic; not
 * tied to MHTML or to a particular validation pipeline.
 *
 * Usage:
 *   node scripts/render-modes.js \
 *     --url file://$(pwd)/tmp/gabor-card/card.html \
 *     --modes 0,1,4,6,14,15,16,20 \
 *     --fixation 640,384 \
 *     --width 1280 --height 768 \
 *     --out tmp/gabor-card/renders
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const { run: runCapture } = require(path.join(REPO_ROOT, 'scripts/lib/capture-runner.js'));

function getArg(name, def = null) {
    const prefix = `--${name}=`;
    const hit = process.argv.find(a => a.startsWith(prefix));
    if (hit) return hit.slice(prefix.length);
    const idx = process.argv.indexOf(`--${name}`);
    if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
    return def;
}

async function main() {
    const url = getArg('url');
    const modesStr = getArg('modes', '0');
    // Fixation is FRACTIONAL of viewport (capture-runner: targetX = width*fx).
    // Default = center.
    const fixStr = getArg('fixation', '0.5,0.5');
    const width = parseInt(getArg('width', '1280'), 10);
    const height = parseInt(getArg('height', '768'), 10);
    // radius = foveal radius IN PIXELS (not px-per-deg). 90 is the value
    // capture-coco-periph.js:36 uses for 1920×1080 captures.
    const radius = getArg('radius', '90');
    const outDir = path.resolve(getArg('out', 'tmp/render-modes'));
    if (!url) {
        console.error('--url required');
        process.exit(2);
    }
    const [fxStr, fyStr] = fixStr.split(',');
    const fx = parseFloat(fxStr);
    const fy = parseFloat(fyStr);
    const modes = modesStr.split(',').map(s => parseInt(s, 10));

    fs.mkdirSync(outDir, { recursive: true });
    const MACOS_TITLEBAR_PX = 28;

    for (const mode of modes) {
        const filename = `mode${String(mode).padStart(2, '0')}.png`;
        const spec = {
            filename,
            url,
            mode: String(mode),
            // FRACTIONAL of viewport, NOT pixels.
            fixationX: fx,
            fixationY: fy,
            width: String(width),
            height: String(height + MACOS_TITLEBAR_PX),
            radius: String(radius),
            scrollY: 0,
            overlay: 'false',
            mobile: 'false',
        };
        console.log(`\n→ rendering mode ${mode} → ${filename}`);
        const result = await runCapture([spec], {
            outputDir: outDir,
            appVersion: require(path.join(REPO_ROOT, 'package.json')).version,
            force: true,
        });
        if (result.failed > 0) {
            console.error(`  FAILED mode ${mode}`);
        } else {
            console.log(`  ok → ${path.join(outDir, filename)}`);
        }
    }
    console.log(`\n  fixation: (${fx}, ${fy})  viewport: ${width}×${height}`);
    console.log(`  outputs: ${outDir}/`);
}

main().catch(e => { console.error(e); process.exit(1); });
