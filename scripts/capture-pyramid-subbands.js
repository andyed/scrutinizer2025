#!/usr/bin/env node
/**
 * Phase 1c: Capture Pyramid Subband Decomposition
 *
 * Runs the Tier 2.75 pyramid decomposition pass only and reads back
 * per-band textures for validation against Python/JS reference.
 *
 * Outputs: 4 band PNGs + 1 residual PNG per source image.
 * These feed into validate-pyramid.js for fidelity checks.
 *
 * Usage:
 *   node scripts/capture-pyramid-subbands.js
 *   node scripts/capture-pyramid-subbands.js --source tests/golden-captures/raw/dashboard_raw.png
 *
 * Exit codes:
 *   0 = captures written
 *   1 = capture failed
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { run } = require('./lib/capture-runner');

const ROOT = path.join(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'tests', 'golden-captures', 'raw');
const OUTPUT_DIR = path.join(ROOT, 'tests', 'pyramid-captures');

// Default sources — use raw golden captures
const DEFAULT_SOURCES = [
    'dashboard_raw.png',
    'article_raw.png',
    'ecommerce_raw.png',
];

// Pages matching our raw captures
const SOURCE_TO_URL = {
    'dashboard_raw.png':  'file://' + path.join(ROOT, 'tests', 'reference-pages', 'dashboard.html'),
    'article_raw.png':    'file://' + path.join(ROOT, 'tests', 'reference-pages', 'article.html'),
    'ecommerce_raw.png':  'file://' + path.join(ROOT, 'tests', 'reference-pages', 'ecommerce.html'),
};

async function main() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    // Parse --source flag for single-file mode
    const sourceArg = process.argv.find((a, i) => process.argv[i - 1] === '--source');
    const sources = sourceArg ? [path.basename(sourceArg)] : DEFAULT_SOURCES;

    const specs = [];
    for (const src of sources) {
        const url = SOURCE_TO_URL[src];
        if (!url) {
            console.log(`  [SKIP] ${src}: no URL mapping`);
            continue;
        }

        const baseName = src.replace('_raw.png', '');

        // Capture mode 14 (pyramid_mongrel) with debug readback
        // The debug capture mode writes intermediate pyramid bands as separate PNGs
        specs.push({
            filename: `${baseName}_pyramid_mode14.png`,
            url,
            mode: 14,
            fixationX: 0.5,
            fixationY: 0.5,
            // Enable pyramid debug readback via env
            pyramidDebug: true,
        });
    }

    if (specs.length === 0) {
        console.log('No sources found. Check tests/golden-captures/raw/');
        process.exit(1);
    }

    console.log(`Capturing ${specs.length} pyramid decompositions...`);

    try {
        await run(specs, {
            outputDir: OUTPUT_DIR,
            appVersion: 'pyramid-capture',
            force: true,
            env: {
                PYRAMID_DEBUG_READBACK: 'true',
                PYRAMID_OUTPUT_DIR: OUTPUT_DIR,
            },
        });
    } catch (err) {
        console.error('Capture failed:', err.message);
        console.log('\nNote: Pyramid captures require Tier 2.75 code (webgpu-pyramid-compute.js).');
        console.log('If mode 14 is not available, the capture will fall back to mode 12.');
        process.exit(1);
    }

    // Verify outputs exist
    const captured = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.png'));
    console.log(`\nCaptured ${captured.length} files to ${OUTPUT_DIR}/`);
    for (const f of captured) {
        console.log(`  ${f}`);
    }

    // Also generate JS reference pyramid for comparison
    console.log('\nGenerating JS reference pyramid...');
    for (const src of sources) {
        const rawPath = path.join(RAW_DIR, src);
        if (!fs.existsSync(rawPath)) continue;

        const baseName = src.replace('_raw.png', '');
        generateReferencePyramid(rawPath, baseName);
    }

    process.exit(0);
}

/**
 * Generate a JS-side Laplacian pyramid from a raw PNG.
 * This is the reference implementation from validate-subband-entropy.js,
 * output as separate band images for comparison with WGSL output.
 */
function generateReferencePyramid(pngPath, baseName) {
    const data = fs.readFileSync(pngPath);
    const png = PNG.sync.read(data);
    const w = png.width, h = png.height;

    // Extract luminance
    const lum = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            lum[y * w + x] = 0.2126 * png.data[idx] + 0.7152 * png.data[idx + 1] + 0.0722 * png.data[idx + 2];
        }
    }

    // 4-scale Laplacian pyramid
    const SCALES = 4;
    let current = { data: lum, width: w, height: h };
    const bands = [];

    for (let s = 0; s < SCALES; s++) {
        const down = downsample(current);
        const up = upsample(down, current.width, current.height);

        // Band = current - upsampled(downsampled(current))
        const band = new Float32Array(current.width * current.height);
        for (let i = 0; i < band.length; i++) {
            band[i] = current.data[i] - up.data[i];
        }
        bands.push({ data: band, width: current.width, height: current.height });

        // Write band as PNG (normalize to [0,255] with zero at 128)
        writeBandPng(band, current.width, current.height,
            path.join(OUTPUT_DIR, `${baseName}_jsref_band${s}.png`));

        current = down;
    }

    // Residual (lowpass)
    writeBandPng(current.data, current.width, current.height,
        path.join(OUTPUT_DIR, `${baseName}_jsref_residual.png`),
        true /* absolute, not centered */);

    console.log(`  ${baseName}: ${SCALES} bands + residual written`);
}

function downsample(img) {
    const w2 = Math.floor(img.width / 2);
    const h2 = Math.floor(img.height / 2);
    const out = new Float32Array(w2 * h2);
    for (let y = 0; y < h2; y++) {
        for (let x = 0; x < w2; x++) {
            const sx = x * 2, sy = y * 2;
            out[y * w2 + x] = (
                img.data[sy * img.width + sx] +
                img.data[sy * img.width + sx + 1] +
                img.data[(sy + 1) * img.width + sx] +
                img.data[(sy + 1) * img.width + sx + 1]
            ) / 4;
        }
    }
    return { data: out, width: w2, height: h2 };
}

function upsample(img, targetW, targetH) {
    const out = new Float32Array(targetW * targetH);
    for (let y = 0; y < targetH; y++) {
        for (let x = 0; x < targetW; x++) {
            // Bilinear interpolation from half-res
            const sx = (x / targetW) * img.width;
            const sy = (y / targetH) * img.height;
            const x0 = Math.floor(sx), y0 = Math.floor(sy);
            const x1 = Math.min(x0 + 1, img.width - 1);
            const y1 = Math.min(y0 + 1, img.height - 1);
            const fx = sx - x0, fy = sy - y0;
            out[y * targetW + x] =
                img.data[y0 * img.width + x0] * (1 - fx) * (1 - fy) +
                img.data[y0 * img.width + x1] * fx * (1 - fy) +
                img.data[y1 * img.width + x0] * (1 - fx) * fy +
                img.data[y1 * img.width + x1] * fx * fy;
        }
    }
    return { data: out, width: targetW, height: targetH };
}

function writeBandPng(data, width, height, filepath, absolute = false) {
    const png = new PNG({ width, height });
    for (let i = 0; i < data.length; i++) {
        let val;
        if (absolute) {
            val = Math.round(Math.max(0, Math.min(255, data[i])));
        } else {
            // Center at 128, scale ±127
            val = Math.round(128 + Math.max(-127, Math.min(127, data[i])));
        }
        const idx = i * 4;
        png.data[idx] = png.data[idx + 1] = png.data[idx + 2] = val;
        png.data[idx + 3] = 255;
    }
    fs.writeFileSync(filepath, PNG.sync.write(png));
}

main().catch(err => { console.error(err); process.exit(1); });
