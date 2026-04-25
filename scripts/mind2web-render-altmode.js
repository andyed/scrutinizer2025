#!/usr/bin/env node
/**
 * Sanity-check renderer: load one MHTML, render it in N modes for visual
 * comparison. Outputs to tmp/sanity-modes/{annotation_id}/{action_idx}-mode{N}.png.
 *
 * Pixel sampling / pool-stat extraction is intentionally skipped — this is
 * purely "what does eccentricity-proportional degradation look like in mode X
 * vs Y?".
 *
 * Usage:
 *   node scripts/mind2web-render-altmode.js \
 *     --action tmp/replay/<aid>/<idx>-action.json \
 *     --mhtml data/mind2web-mhtml/<aid>/<uid>_before.mhtml \
 *     --modes 0,14,15,16
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const hasher = require(path.join(REPO_ROOT, 'scripts/mind2web-config-hash.js'));
const bbx = require(path.join(REPO_ROOT, 'scripts/mind2web-bbox-transform.js'));
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
    const actionPath = getArg('action');
    const mhtmlPath = getArg('mhtml');
    const modesStr = getArg('modes', '0,14,15,16');
    if (!actionPath || !mhtmlPath) {
        console.error('--action <json> --mhtml <mhtml> required');
        process.exit(2);
    }
    const modes = modesStr.split(',').map(s => parseInt(s, 10));
    const action = JSON.parse(fs.readFileSync(actionPath, 'utf-8'));
    const absMhtml = path.resolve(mhtmlPath);

    const cfg = hasher.loadConfig(path.join(REPO_ROOT, 'tests/validation/mind2web/arm-0-config.json'));
    const viewport = { w: cfg.viewing.viewport_w, h: cfg.viewing.viewport_h };
    const priorCenter = bbx.docBboxCenter(action.prior_target_bbox);
    const foveaScreen = bbx.docToScreen(priorCenter, 0, viewport);

    const outDir = path.join(REPO_ROOT, 'tmp/sanity-modes', action.annotation_id);
    fs.mkdirSync(outDir, { recursive: true });
    const MACOS_TITLEBAR_PX = 28;

    for (const mode of modes) {
        const filename = `${action.action_idx}-mode${mode}.png`;
        const spec = {
            filename,
            url: `file://${absMhtml}`,
            mode: String(mode),
            fixationX: String(Math.round(foveaScreen.x)),
            fixationY: String(Math.round(foveaScreen.y)),
            width: String(viewport.w),
            height: String(viewport.h + MACOS_TITLEBAR_PX),
            radius: String(cfg.viewing.px_per_deg),
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
    console.log(`\n  fovea: (${Math.round(foveaScreen.x)}, ${Math.round(foveaScreen.y)})  ecc target: ${action.target.bbox ? '?' : 'n/a'}`);
    console.log(`  outputs in tmp/sanity-modes/${action.annotation_id}/`);
}

main().catch(e => { console.error(e); process.exit(1); });
