#!/usr/bin/env node
/**
 * Mind2Web Step 3 v2 — render one action through Arm-0 using the authoritative
 * Multimodal-Mind2Web screenshot as the pixel source.
 *
 * Pivot from v1 (which loaded raw_html through BrowserView and got naked-DOM
 * pixels because Mind2Web strips all CSS): v2 feeds the pre-captured PNG
 * directly into Scrutinizer's peripheral shader via the capture-coco-periph
 * pattern — wrap the image in a minimal HTML page, let Scrutinizer's
 * BrowserView render it, let the shader filter the resulting frame.
 *
 * Usage:
 *   node scripts/mind2web-render-multimodal.js \\
 *     --action tmp/action-v2.json \\
 *     --screenshot tmp/action-v2-screenshot.png
 *
 * Output:
 *   data/mind2web-cache-<hash>/<annotation_id>/<action_idx>.png + .json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const REPO_ROOT = path.resolve(__dirname, '..');
const hasher = require(path.join(REPO_ROOT, 'scripts/mind2web-config-hash.js'));
const bbx = require(path.join(REPO_ROOT, 'scripts/mind2web-bbox-transform.js'));
const { run: runCapture } = require(path.join(REPO_ROOT, 'scripts/lib/capture-runner.js'));
const {
    gaussianBlur, computeLocalVariance, normalizeFeature,
} = require(path.join(REPO_ROOT, 'renderer/congestion-core.js'));

// Oklab I/|a|/|b| decomposition. Pinned copy of scripts/export-saliency.js:30-60.
function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearSrgbToOklab(r, g, b) {
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);
    return {
        L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    };
}

function computeFcChannels(png, sigma) {
    const { width: w, height: h, data } = png;
    const len = w * h;
    const I = new Float32Array(len);
    const RG = new Float32Array(len);
    const BY = new Float32Array(len);
    for (let i = 0; i < len; i++) {
        const rLin = srgbToLinear(data[i * 4] / 255.0);
        const gLin = srgbToLinear(data[i * 4 + 1] / 255.0);
        const bLin = srgbToLinear(data[i * 4 + 2] / 255.0);
        const lab = linearSrgbToOklab(rLin, gLin, bLin);
        I[i] = lab.L;
        RG[i] = Math.abs(lab.a);
        BY[i] = Math.abs(lab.b);
    }
    return {
        var_I:  normalizeFeature(computeLocalVariance(I,  w, h, sigma)),
        var_RG: normalizeFeature(computeLocalVariance(RG, w, h, sigma)),
        var_BY: normalizeFeature(computeLocalVariance(BY, w, h, sigma)),
        width: w, height: h,
    };
}

function sampleFeature(map, width, height, x, y) {
    const xi = Math.max(0, Math.min(width - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(height - 1, Math.round(y)));
    return map[yi * width + xi];
}

function annulusMeanFeature(map, width, height, x, y, r_inner, r_outer) {
    let sum = 0, n = 0;
    const x0 = Math.max(0, Math.floor(x - r_outer));
    const x1 = Math.min(width - 1, Math.ceil(x + r_outer));
    const y0 = Math.max(0, Math.floor(y - r_outer));
    const y1 = Math.min(height - 1, Math.ceil(y + r_outer));
    for (let yi = y0; yi <= y1; yi++) {
        for (let xi = x0; xi <= x1; xi++) {
            const dx = xi - x, dy = yi - y;
            const d = Math.hypot(dx, dy);
            if (d < r_inner || d > r_outer) continue;
            sum += map[yi * width + xi];
            n++;
        }
    }
    return n > 0 ? sum / n : null;
}

function samplePixel(png, x, y) {
    const xi = Math.max(0, Math.min(png.width - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(png.height - 1, Math.round(y)));
    const idx = (yi * png.width + xi) * 4;
    return [png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]];
}

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
    const seen = new Set();
    for (let i = 0; i < 16; i++) {
        const idx = Math.floor(Math.random() * png.width * png.height) * 4;
        seen.add(png.data[idx]);
        if (seen.size >= 2) return;
    }
    throw new Error('PNG looks uniform — silent render failure symptom.');
}

function getArg(name, def = null) {
    const prefix = `--${name}=`;
    const hit = process.argv.find(a => a.startsWith(prefix));
    if (hit) return hit.slice(prefix.length);
    const idx = process.argv.indexOf(`--${name}`);
    if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
    return def;
}

/**
 * Build the minimal HTML stub that frames the Mind2Web screenshot as a
 * full-viewport image inside Scrutinizer's BrowserView. Mirrors the
 * capture-coco-periph.js centered-image pattern, but sized to the pinned
 * 1280xH viewport with overflow: hidden so only the viewport-height region
 * is visible to the peripheral shader.
 */
function generateStimulusHtml(screenshotPath, scroll_y, viewport) {
    // Negative top offset shifts the image up by scroll_y pixels (so the
    // viewport reveals the target rows).
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; overflow: hidden; background: #fff; }
  body { width: ${viewport.w}px; height: ${viewport.h}px; position: relative; }
  img.stimulus {
    position: absolute;
    left: 0;
    top: ${-scroll_y}px;
    width: ${viewport.w}px;
    height: auto;
    image-rendering: auto;
  }
</style>
</head>
<body>
  <img class="stimulus" src="${screenshotPath}">
</body>
</html>`;
}

async function main() {
    const actionPath = getArg('action');
    const screenshotPath = getArg('screenshot');
    if (!actionPath || !screenshotPath) {
        console.error('--action <json> --screenshot <png> both required');
        process.exit(2);
    }
    const action = JSON.parse(fs.readFileSync(actionPath, 'utf-8'));
    const absScreenshot = path.resolve(screenshotPath);
    if (!fs.existsSync(absScreenshot)) throw new Error(`Screenshot not found: ${absScreenshot}`);

    // 1. Arm-0 config + live drift check.
    const cfgPath = path.join(REPO_ROOT, 'tests/validation/mind2web/arm-0-config.json');
    const cfg = hasher.loadConfig(cfgPath);
    hasher.validateLive(cfg, REPO_ROOT);
    const hashPrefix = hasher.hashPrefix(cfg);
    const viewport = { w: cfg.viewing.viewport_w, h: cfg.viewing.viewport_h };

    // 2. Compute scroll_y. For v2 minimum viable we require both target and
    //    prior to be in the first viewport (extractor enforces this), so
    //    scroll=0. Document the choice so the extension to scrolled cases is
    //    traceable.
    const scroll_y = 0;
    const priorCenter = bbx.docBboxCenter(action.prior_target_bbox);
    const foveaScreen = bbx.docToScreen(priorCenter, scroll_y, viewport);

    // 3. Build HTML stub wrapping the screenshot.
    const tmpDir = path.join(REPO_ROOT, 'tmp/mind2web-tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const htmlPath = path.join(tmpDir, `v2-${action.annotation_id}-${action.action_idx}.html`);
    const html = generateStimulusHtml(`file://${absScreenshot}`, scroll_y, viewport);
    fs.writeFileSync(htmlPath, html, 'utf-8');

    // 4. Output paths keyed by config_hash prefix.
    const cacheDir = path.join(REPO_ROOT, 'data', `mind2web-cache-${hashPrefix}`, action.annotation_id);
    fs.mkdirSync(cacheDir, { recursive: true });
    const pngFilename = `${action.action_idx}-v2.png`;
    const pngPath = path.join(cacheDir, pngFilename);
    const jsonPath = path.join(cacheDir, `${action.action_idx}-v2.json`);

    const MACOS_TITLEBAR_PX = 28;
    const spec = {
        filename: pngFilename,
        url: `file://${htmlPath}`,
        mode: String(cfg.mode_id),
        fixationX: String(Math.round(foveaScreen.x)),
        fixationY: String(Math.round(foveaScreen.y)),
        width: String(viewport.w),
        height: String(viewport.h + MACOS_TITLEBAR_PX),
        radius: String(cfg.viewing.px_per_deg),
        scrollY: 0,
        overlay: 'false',
        mobile: 'false',
    };

    console.log('━━━ Mind2Web v2 render (screenshot-source, Arm-0) ━━━');
    console.log(`  annotation_id: ${action.annotation_id}`);
    console.log(`  action_idx:    ${action.action_idx}/${action.n_actions_in_task - 1}  ${action.action_repr}`);
    console.log(`  website:       ${action.website}  domain: ${action.domain}`);
    console.log(`  config:        ${hashPrefix}`);
    console.log(`  screenshot:    ${path.relative(REPO_ROOT, absScreenshot)}`);
    console.log(`  viewport:      ${viewport.w}x${viewport.h}  scroll_y=${scroll_y}`);
    console.log(`  fovea:         screen=(${spec.fixationX}, ${spec.fixationY})`);
    console.log();

    const result = await runCapture([spec], {
        outputDir: cacheDir,
        appVersion: require(path.join(REPO_ROOT, 'package.json')).version,
        force: true,
    });
    if (result.failed > 0) throw new Error('capture failed');
    if (!fs.existsSync(pngPath)) throw new Error(`Expected PNG not written: ${pngPath}`);

    const png = PNG.sync.read(fs.readFileSync(pngPath));
    if (png.width !== viewport.w || png.height !== viewport.h) {
        throw new Error(`PNG dims ${png.width}x${png.height} != viewport ${viewport.w}x${viewport.h}`);
    }
    assertNotUniform(png);

    // 5. Compute FC + sample 7-D vectors (same as v1).
    const fcSigma = cfg.feature_congestion_path.sigma;
    console.log(`  Computing Feature Congestion (σ=${fcSigma}, 3 channels)...`);
    const fc = computeFcChannels(png, fcSigma);
    const surroundRadiusPx = cfg.viewing.px_per_deg;

    const candidates = [
        { role: 'target', primitive: action.target.primitive, tag: action.target.tag, bbox: action.target.bbox, is_target: true },
        ...action.same_type_distractors.map(d => ({
            role: 'distractor', primitive: d.primitive, tag: d.tag, bbox: d.bbox, is_target: false,
        })),
    ];

    const results = [];
    for (const c of candidates) {
        if (!bbx.bboxVisibleAfterScroll(c.bbox, scroll_y, viewport)) {
            results.push({ ...c, visible: false });
            continue;
        }
        const centerDoc = bbx.docBboxCenter(c.bbox);
        let centerScreen;
        try {
            centerScreen = bbx.docToScreen(centerDoc, scroll_y, viewport);
        } catch (e) {
            results.push({ ...c, visible: false, skipped_reason: 'center_outside_viewport' });
            continue;
        }
        const ecc = bbx.screenEccentricityPx(foveaScreen, centerScreen);

        const rgba_raw = samplePixel(png, centerScreen.x, centerScreen.y);
        const rgba_surround_raw = sampleAnnulusMean(png, centerScreen.x, centerScreen.y, surroundRadiusPx);
        const fcCenter = {
            var_I: sampleFeature(fc.var_I, fc.width, fc.height, centerScreen.x, centerScreen.y),
            var_RG: sampleFeature(fc.var_RG, fc.width, fc.height, centerScreen.x, centerScreen.y),
            var_BY: sampleFeature(fc.var_BY, fc.width, fc.height, centerScreen.x, centerScreen.y),
        };
        const fcSurround = {
            var_I:  annulusMeanFeature(fc.var_I,  fc.width, fc.height, centerScreen.x, centerScreen.y, surroundRadiusPx * 0.5, surroundRadiusPx),
            var_RG: annulusMeanFeature(fc.var_RG, fc.width, fc.height, centerScreen.x, centerScreen.y, surroundRadiusPx * 0.5, surroundRadiusPx),
            var_BY: annulusMeanFeature(fc.var_BY, fc.width, fc.height, centerScreen.x, centerScreen.y, surroundRadiusPx * 0.5, surroundRadiusPx),
        };

        const vector_center = [
            rgba_raw[0] / 255, rgba_raw[1] / 255, rgba_raw[2] / 255, rgba_raw[3] / 255,
            fcCenter.var_I, fcCenter.var_RG, fcCenter.var_BY,
        ];
        const vector_surround = rgba_surround_raw ? [
            rgba_surround_raw[0] / 255, rgba_surround_raw[1] / 255, rgba_surround_raw[2] / 255, rgba_surround_raw[3] / 255,
            fcSurround.var_I ?? 0, fcSurround.var_RG ?? 0, fcSurround.var_BY ?? 0,
        ] : null;
        const distinctiveness_l2 = vector_surround
            ? Math.sqrt(vector_center.reduce((s, v, i) => s + (v - vector_surround[i]) ** 2, 0))
            : null;

        results.push({
            ...c,
            visible: true,
            center_screen: { x: Math.round(centerScreen.x), y: Math.round(centerScreen.y) },
            eccentricity_px: ecc,
            eccentricity_deg: ecc / cfg.viewing.px_per_deg,
            vector_center, vector_surround, distinctiveness_l2,
        });
    }

    const cacheRecord = {
        schema_version: 3,
        pipeline_version: 'v2_screenshot_source',
        config_hash_prefix: hashPrefix,
        annotation_id: action.annotation_id,
        action_idx: action.action_idx,
        website: action.website,
        domain: action.domain,
        action_repr: action.action_repr,
        mode_id: cfg.mode_id,
        viewport, scroll_y,
        fovea_screen: { x: Number(spec.fixationX), y: Number(spec.fixationY) },
        fovea_doc: priorCenter,
        surround_radius_px: surroundRadiusPx,
        vector_channels: ['R', 'G', 'B', 'A', 'var_I', 'var_RG', 'var_BY'],
        fc_sigma: fcSigma,
        screenshot_source: path.relative(REPO_ROOT, absScreenshot),
        candidates: results,
    };
    fs.writeFileSync(jsonPath, JSON.stringify(cacheRecord, null, 2) + '\n', 'utf-8');

    console.log(`\n━━━ Cache written ━━━`);
    console.log(`  PNG:  ${path.relative(REPO_ROOT, pngPath)}`);
    console.log(`  JSON: ${path.relative(REPO_ROOT, jsonPath)}`);
    console.log(`\n  7-D distinctiveness per candidate:`);
    console.log(`    ${'role'.padEnd(11)} ${'tag'.padEnd(8)} ${'ecc'.padEnd(7)} ${'L2_7d'.padEnd(8)} ${'var_I_c'.padEnd(9)} ${'var_RG_c'.padEnd(10)} ${'var_BY_c'.padEnd(10)}`);
    for (const r of results) {
        if (!r.visible) {
            console.log(`    ${r.role.padEnd(11)} ${r.tag.padEnd(8)} [OFFSCREEN]`);
            continue;
        }
        const v = r.vector_center;
        console.log(`    ${r.role.padEnd(11)} ${r.tag.padEnd(8)} ${r.eccentricity_deg.toFixed(1).padStart(5)}°  ${r.distinctiveness_l2.toFixed(3).padStart(6)}  ${v[4].toFixed(4).padStart(8)}  ${v[5].toFixed(4).padStart(8)}  ${v[6].toFixed(4).padStart(8)}`);
    }

    const targetR = results.find(r => r.is_target);
    const distractors = results.filter(r => !r.is_target && r.visible);
    if (targetR && distractors.length > 0) {
        const targetL2 = targetR.distinctiveness_l2;
        const rankOfTarget = distractors.map(d => d.distinctiveness_l2).filter(l => l > targetL2).length;
        const auc = (distractors.length - rankOfTarget) / distractors.length;
        console.log(`\n  Target rank-by-distinctiveness: ${rankOfTarget + 1}/${distractors.length + 1}  (per-trial AUC = ${auc.toFixed(3)})`);
    }
}

main().catch(e => { console.error(e); process.exit(1); });
