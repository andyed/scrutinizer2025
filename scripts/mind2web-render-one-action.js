#!/usr/bin/env node
/**
 * Mind2Web Step 3 minimum viable — render one action through Arm-0 and write
 * per-candidate pooled-stat vectors to the cache.
 *
 * Usage:
 *   node scripts/mind2web-render-one-action.js --action tmp/action-v0.json
 *
 * Input: the JSON produced by scripts/mind2web-extract-action.py
 * Output:
 *   tmp/mind2web-tmp/<task>-<action>.html (raw_html written to disk)
 *   data/mind2web-cache-<hash12>/<task>/<action>.png  (Arm-0 render)
 *   data/mind2web-cache-<hash12>/<task>/<action>.json (pooled-stat vectors)
 *
 * v0 scope: scroll=0 only; target + distractors + fovea all fit in first
 * viewport (the extractor's --pick-first-valid filter enforces this).
 * Runtime MIP-fallback assertion is a Step 3 v1 follow-up; for v0 we check
 * post-render that the PNG is not uniform (one symptom of a silent MIP swap).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

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
    if (!actionPath) {
        console.error('--action <path-to-extracted-action.json> required');
        process.exit(2);
    }
    const action = JSON.parse(fs.readFileSync(actionPath, 'utf-8'));

    // 1. Load + validate Arm-0 config (drift detectors run).
    const cfgPath = path.join(REPO_ROOT, 'tests/validation/mind2web/arm-0-config.json');
    const cfg = hasher.loadConfig(cfgPath);
    hasher.validateLive(cfg, REPO_ROOT);
    const hashPrefix = hasher.hashPrefix(cfg);

    const viewport = { w: cfg.viewing.viewport_w, h: cfg.viewing.viewport_h };

    // 2. Write raw_html to temp file; capture-runner needs a file:// URL.
    const tmpDir = path.join(REPO_ROOT, 'tmp/mind2web-tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const htmlPath = path.join(tmpDir, `${action.task_id}-${action.action_idx}.html`);
    fs.writeFileSync(htmlPath, action.raw_html, 'utf-8');

    // 3. v0 fovea: prior target center at scroll=0, so doc-space == screen-space.
    const priorCenter = bbx.docBboxCenter(action.prior_target_bbox);
    const scroll_y = 0;
    const foveaScreen = bbx.docToScreen(priorCenter, scroll_y, viewport);

    // 4. Output paths keyed by config_hash prefix.
    const cacheDir = path.join(REPO_ROOT, 'data', `mind2web-cache-${hashPrefix}`, action.task_id);
    fs.mkdirSync(cacheDir, { recursive: true });
    const pngFilename = `${action.action_idx}.png`;
    const pngPath = path.join(cacheDir, pngFilename);
    const jsonPath = path.join(cacheDir, `${action.action_idx}.json`);

    // 5. Drive Scrutinizer through capture-runner.
    // Foveal-radius pixel size: at PX_PER_DEG=29, a 1-degree foveal radius is
    // 29px. Scrutinizer's capture pipeline uses the TEST_RADIUS env var or a
    // per-spec radius override. The default in capture-golden.js is 45px
    // (1° on MBP Retina @ 20"); we use 29 to match the Mind2Web PX_PER_DEG.
    const FOVEA_RADIUS_PX = cfg.viewing.px_per_deg;

    // macOS title-bar chrome compensation. In TEST_MODE main.js hides the
    // 40px Scrutinizer toolbar, but the native macOS title bar (28px) stays.
    // Request window height = content height + 28 so the rendered PNG is
    // exactly viewport.h pixels tall. Precedent: scripts/capture-fullpage-
    // gazeplot.js:131.
    const MACOS_TITLEBAR_PX = 28;
    const spec = {
        filename: pngFilename,
        url: `file://${htmlPath}`,
        mode: String(cfg.mode_id),
        fixationX: String(Math.round(foveaScreen.x)),
        fixationY: String(Math.round(foveaScreen.y)),
        width: String(viewport.w),
        height: String(viewport.h + MACOS_TITLEBAR_PX),
        radius: String(FOVEA_RADIUS_PX),
        scrollY: 0,
        overlay: 'false',
        mobile: 'false',
    };

    console.log('━━━ Mind2Web render (Arm-0) ━━━');
    console.log(`  task:      ${action.task_id}`);
    console.log(`  action:    ${action.action_idx}/${action.n_actions_in_task - 1}  ${action.action_repr}`);
    console.log(`  website:   ${action.website}`);
    console.log(`  config:    ${hashPrefix}`);
    console.log(`  viewport:  ${viewport.w}x${viewport.h}`);
    console.log(`  fovea:     screen=(${spec.fixationX}, ${spec.fixationY})  doc=(${priorCenter.x.toFixed(1)}, ${priorCenter.y.toFixed(1)})  scroll=${scroll_y}`);
    console.log(`  mode:      ${cfg.mode_id} (${cfg.mode_name})`);
    console.log(`  target:    ${action.target.primitive}/${action.target.tag}`);
    console.log(`  distractors (same-type, visible): ${countVisible(action.same_type_distractors, scroll_y, viewport)}/${action.same_type_distractors.length}`);
    console.log();

    const result = await runCapture([spec], {
        outputDir: cacheDir,
        appVersion: require(path.join(REPO_ROOT, 'package.json')).version,
        force: true,
    });
    if (result.failed > 0) throw new Error('capture failed');

    if (!fs.existsSync(pngPath)) {
        throw new Error(`Expected PNG not written: ${pngPath}`);
    }

    // 6. Sanity-check the PNG isn't uniform (silent-render failure symptom).
    const png = PNG.sync.read(fs.readFileSync(pngPath));
    if (png.width !== viewport.w || png.height !== viewport.h) {
        throw new Error(`PNG dims ${png.width}x${png.height} != viewport ${viewport.w}x${viewport.h}`);
    }
    assertNotUniform(png);

    // 7. Extract pooled-stat vectors (v0: 4-D RGBA at screen-space bbox center,
    //    primary metric per memo. Surround pool sample is a 29px annulus mean
    //    — placeholder for the Rosenholtz retinotopic pool; Step 3 v1 will
    //    derive the annulus radius from the shader's pool schedule).
    const surroundRadiusPx = cfg.viewing.px_per_deg;  // 1° as a v0 placeholder

    const candidates = [
        { role: 'target', primitive: action.target.primitive, tag: action.target.tag, bbox: action.target.bbox, is_target: true },
        ...action.same_type_distractors.map(d => ({
            role: 'distractor', primitive: d.primitive, tag: d.tag, bbox: d.bbox, is_target: false,
        })),
    ];

    const results = [];
    for (const c of candidates) {
        if (!bbx.bboxVisibleAfterScroll(c.bbox, scroll_y, viewport)) {
            results.push({ ...c, visible: false, center_rgba: null, surround_rgba: null, eccentricity_px: null });
            continue;
        }
        const centerDoc = bbx.docBboxCenter(c.bbox);
        const centerScreen = bbx.docToScreen(centerDoc, scroll_y, viewport);
        const ecc = bbx.screenEccentricityPx(foveaScreen, centerScreen);
        const center_rgba = samplePixel(png, centerScreen.x, centerScreen.y);
        const surround_rgba = sampleAnnulusMean(png, centerScreen.x, centerScreen.y, surroundRadiusPx);
        results.push({
            ...c,
            visible: true,
            center_screen: { x: Math.round(centerScreen.x), y: Math.round(centerScreen.y) },
            eccentricity_px: ecc,
            eccentricity_deg: ecc / cfg.viewing.px_per_deg,
            center_rgba,
            surround_rgba,
        });
    }

    const cacheRecord = {
        schema_version: 1,
        config_hash_prefix: hashPrefix,
        task_id: action.task_id,
        action_idx: action.action_idx,
        website: action.website,
        action_repr: action.action_repr,
        mode_id: cfg.mode_id,
        viewport,
        scroll_y,
        fovea_screen: { x: spec.fixationX, y: spec.fixationY },
        fovea_doc: priorCenter,
        surround_radius_px: surroundRadiusPx,
        surround_method: 'annulus_mean_v0_placeholder',
        candidates: results,
    };
    fs.writeFileSync(jsonPath, JSON.stringify(cacheRecord, null, 2) + '\n', 'utf-8');

    console.log(`\n━━━ Cache written ━━━`);
    console.log(`  PNG:  ${path.relative(REPO_ROOT, pngPath)}`);
    console.log(`  JSON: ${path.relative(REPO_ROOT, jsonPath)}`);
    console.log(`\n  Candidates:`);
    for (const r of results) {
        if (!r.visible) {
            console.log(`    ${r.role.padEnd(11)} ${r.tag.padEnd(8)} [OFFSCREEN]`);
            continue;
        }
        const rgba = r.center_rgba;
        const sur = r.surround_rgba;
        const l2 = Math.hypot(rgba[0] - sur[0], rgba[1] - sur[1], rgba[2] - sur[2]);
        console.log(`    ${r.role.padEnd(11)} ${r.tag.padEnd(8)} ecc=${r.eccentricity_deg.toFixed(1)}°  center_rgb=(${rgba[0]},${rgba[1]},${rgba[2]})  L2_vs_surround=${l2.toFixed(1)}`);
    }
}

function countVisible(bboxes, scroll_y, viewport) {
    return bboxes.filter(d => bbx.bboxVisibleAfterScroll(d.bbox, scroll_y, viewport)).length;
}

function samplePixel(png, x, y) {
    const xi = Math.max(0, Math.min(png.width - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(png.height - 1, Math.round(y)));
    const idx = (yi * png.width + xi) * 4;
    return [png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]];
}

// Mean RGBA in an annulus around (x, y). v0 placeholder for the Rosenholtz
// retinotopic pool — Step 3 v1 will replace with the shader's actual pool
// geometry derived from cmf_a + ecc_scaling.
function sampleAnnulusMean(png, x, y, radius) {
    const r_inner = radius * 0.5;
    const r_outer = radius;
    let sumR = 0, sumG = 0, sumB = 0, sumA = 0, n = 0;
    const x0 = Math.max(0, Math.floor(x - r_outer));
    const x1 = Math.min(png.width - 1, Math.ceil(x + r_outer));
    const y0 = Math.max(0, Math.floor(y - r_outer));
    const y1 = Math.min(png.height - 1, Math.ceil(y + r_outer));
    for (let yi = y0; yi <= y1; yi++) {
        for (let xi = x0; xi <= x1; xi++) {
            const dx = xi - x, dy = yi - y;
            const d = Math.hypot(dx, dy);
            if (d < r_inner || d > r_outer) continue;
            const idx = (yi * png.width + xi) * 4;
            sumR += png.data[idx]; sumG += png.data[idx + 1]; sumB += png.data[idx + 2]; sumA += png.data[idx + 3];
            n++;
        }
    }
    if (n === 0) return null;
    return [sumR / n, sumG / n, sumB / n, sumA / n];
}

function assertNotUniform(png) {
    // Cheap sentinel: sample 16 random pixels, assert at least two distinct
    // values across R channel. Silent-render failures produce uniform frames.
    const seen = new Set();
    for (let i = 0; i < 16; i++) {
        const idx = Math.floor(Math.random() * png.width * png.height) * 4;
        seen.add(png.data[idx]);
        if (seen.size >= 2) return;
    }
    throw new Error('PNG looks uniform — silent render failure symptom. Arm-0 may have fallen back to MIP or the render pipeline returned a blank frame.');
}

main().catch(e => { console.error(e); process.exit(1); });
