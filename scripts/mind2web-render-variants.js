#!/usr/bin/env node
/**
 * Mind2Web variants renderer — render one MHTML through a grid of
 * (mode × radius) combinations, all at the action's prior-target fovea.
 *
 * No pool-stat extraction — this is purely for the replay study tool.
 * Output goes to data/mind2web-replay/<aid>/<idx>/m<mode>-r<radius>.png so
 * it doesn't touch the Arm-0 metric cache.
 *
 * Usage:
 *   node scripts/mind2web-render-variants.js \
 *     --action tmp/.../action.json --mhtml /path/to.mhtml \
 *     --modes 0,4,6,15 --radii 60,90,120
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
    const modesStr = getArg('modes', '0,4,6,15');
    const radiiStr = getArg('radii', '60,90,120');
    if (!actionPath || !mhtmlPath) {
        console.error('--action <json> --mhtml <mhtml> required');
        process.exit(2);
    }
    const modes = modesStr.split(',').map(s => parseInt(s, 10));
    const radii = radiiStr.split(',').map(s => parseInt(s, 10));
    const action = JSON.parse(fs.readFileSync(actionPath, 'utf-8'));
    const absMhtml = path.resolve(mhtmlPath);
    if (!fs.existsSync(absMhtml)) throw new Error(`MHTML not found: ${absMhtml}`);

    const cfg = hasher.loadConfig(path.join(REPO_ROOT, 'tests/validation/mind2web/arm-0-config.json'));
    const viewport = { w: cfg.viewing.viewport_w, h: cfg.viewing.viewport_h };
    const priorCenter = bbx.docBboxCenter(action.prior_target_bbox);
    const foveaScreen = bbx.docToScreen(priorCenter, 0, viewport);
    // Fractional fixation (capture-runner: targetX = width * shot.fixationX).
    const fxFrac = foveaScreen.x / viewport.w;
    const fyFrac = foveaScreen.y / viewport.h;

    const outDir = path.join(REPO_ROOT, 'data/mind2web-replay',
                             action.annotation_id, String(action.action_idx));
    fs.mkdirSync(outDir, { recursive: true });

    const MACOS_TITLEBAR_PX = 28;
    const specs = [];
    for (const mode of modes) {
        for (const radius of radii) {
            specs.push({
                filename: `m${mode}-r${radius}.png`,
                url: `file://${absMhtml}`,
                mode: String(mode),
                fixationX: fxFrac,
                fixationY: fyFrac,
                width: String(viewport.w),
                height: String(viewport.h + MACOS_TITLEBAR_PX),
                radius: String(radius),
                scrollY: 0,
                overlay: 'false',
                mobile: 'false',
            });
        }
    }
    console.log(`  ${action.website}/${action.annotation_id.slice(0, 8)}/${action.action_idx}  `
                + `→ ${specs.length} variants  fovea_frac=(${fxFrac.toFixed(3)}, ${fyFrac.toFixed(3)})`);
    const result = await runCapture(specs, {
        outputDir: outDir,
        appVersion: require(path.join(REPO_ROOT, 'package.json')).version,
        force: true,
    });
    if (result.failed > 0) console.error(`  ${result.failed} failed`);
    else console.log(`  ok → ${specs.length} files in ${outDir}/`);

    // Drop a small index.json for downstream lookup.
    fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({
        annotation_id: action.annotation_id,
        action_idx: action.action_idx,
        website: action.website,
        action_repr: action.action_repr,
        viewport,
        fovea_screen: { x: foveaScreen.x, y: foveaScreen.y },
        fixation_frac: { x: fxFrac, y: fyFrac },
        prior_target_bbox: action.prior_target_bbox,
        target_bbox: action.target.bbox,
        target_primitive: action.target.primitive,
        target_tag: action.target.tag,
        same_type_distractors: action.same_type_distractors,
        modes, radii,
        files: specs.map(s => s.filename),
    }, null, 2) + '\n');
}

main().catch(e => { console.error(e); process.exit(1); });
