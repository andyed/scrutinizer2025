#!/usr/bin/env node
/**
 * Mind2Web Step 3 v3 — render one action through Arm-0 using a
 * Mind2Web-raw-dump MHTML snapshot as the pixel source.
 *
 * Pivot from v2 (which wrapped the Multimodal-Mind2Web screenshot in a
 * minimal HTML stub): v3 loads the _before.mhtml directly into BrowserView.
 * Electron/Chromium rehydrates CSS + images from the MHTML bundle, so the
 * shader sees a *live DOM* of the captured page — unlocking preload.js
 * primitive classification and therefore future Arm-1 (DOM-aware) validation.
 * For Arm-0 headline runs (mode 16), the classifier's output is ignored, so
 * the only thing that matters here is that the pixels match the authoritative
 * Multimodal screenshot (smoke-tested separately via
 * mind2web-mhtml-rehydrate-test.js).
 *
 * Usage:
 *   node scripts/mind2web-render-mhtml.js \\
 *     --action tmp/action-v3.json \\
 *     --mhtml ~/Downloads/<action_uid>_before.mhtml
 *
 * Output:
 *   data/mind2web-cache-<hash>/<annotation_id>/<action_idx>-v3.png + .json
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

async function main() {
    const actionPath = getArg('action');
    const mhtmlPath = getArg('mhtml');
    if (!actionPath || !mhtmlPath) {
        console.error('--action <json> --mhtml <mhtml> both required');
        process.exit(2);
    }
    const action = JSON.parse(fs.readFileSync(actionPath, 'utf-8'));
    const absMhtml = path.resolve(mhtmlPath);
    if (!fs.existsSync(absMhtml)) throw new Error(`MHTML not found: ${absMhtml}`);

    // 1. Arm-0 config + live drift check.
    const cfgPath = path.join(REPO_ROOT, 'tests/validation/mind2web/arm-0-config.json');
    const cfg = hasher.loadConfig(cfgPath);
    hasher.validateLive(cfg, REPO_ROOT);
    const hashPrefix = hasher.hashPrefix(cfg);
    const viewport = { w: cfg.viewing.viewport_w, h: cfg.viewing.viewport_h };

    // 2. v3 scroll = 0 (matching v2 v0-constraints extractor). Prior-action
    //    target and current target are both in first 768 doc-pixels.
    const scroll_y = 0;
    const priorCenter = bbx.docBboxCenter(action.prior_target_bbox);
    const foveaScreen = bbx.docToScreen(priorCenter, scroll_y, viewport);

    // 3. Output paths keyed by config_hash prefix.
    const cacheDir = path.join(REPO_ROOT, 'data', `mind2web-cache-${hashPrefix}`, action.annotation_id);
    fs.mkdirSync(cacheDir, { recursive: true });
    const pngFilename = `${action.action_idx}-v3.png`;
    const pngPath = path.join(cacheDir, pngFilename);
    const jsonPath = path.join(cacheDir, `${action.action_idx}-v3.json`);

    const MACOS_TITLEBAR_PX = 28;
    // capture-runner expects fractional fixation (`targetX = width *
    // shot.fixationX`). Passing pixel values puts the fovea off-screen.
    // Bug found via Gabor-card characterization 2026-04-24 — earlier renders
    // in this cache had fixation in pixel units and were effectively
    // unfoveated at the intended location.
    const spec = {
        filename: pngFilename,
        url: `file://${absMhtml}`,
        mode: String(cfg.mode_id),
        fixationX: foveaScreen.x / viewport.w,
        fixationY: foveaScreen.y / viewport.h,
        width: String(viewport.w),
        height: String(viewport.h + MACOS_TITLEBAR_PX),
        radius: String(cfg.viewing.px_per_deg),
        scrollY: 0,
        overlay: 'false',
        mobile: 'false',
    };

    console.log('━━━ Mind2Web v3 render (MHTML source, live DOM, Arm-0) ━━━');
    console.log(`  annotation_id: ${action.annotation_id}`);
    console.log(`  action_idx:    ${action.action_idx}/${action.n_actions_in_task - 1}  ${action.action_repr}`);
    console.log(`  website:       ${action.website}  domain: ${action.domain}`);
    console.log(`  config:        ${hashPrefix}`);
    console.log(`  mhtml:         ${path.relative(process.env.HOME || '/', absMhtml)}`);
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
            // bbox overlaps viewport but its center is outside (straddles edge).
            // Skip — we sample at centers, not edges.
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
        pipeline_version: 'v3_mhtml_source',
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
        mhtml_source: path.basename(absMhtml),
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
