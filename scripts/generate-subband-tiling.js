#!/usr/bin/env node
/**
 * Generate a tiled subband visualization for blog/demo.
 *
 * Takes a screenshot PNG and decomposes it into a Laplacian pyramid,
 * then renders all bands + residual as a tiled composite image.
 *
 * Layout:
 *   ┌──────────┬──────────┬──────────┐
 *   │ Band 0   │ Band 1   │ Band 2   │
 *   │ (high f) │ (mid-hi) │ (mid-lo) │
 *   ├──────────┼──────────┴──────────┘
 *   │ Band 3   │ Residual │ Original │
 *   │ (low f)  │  (DC)    │ (source) │
 *   └──────────┴──────────┴──────────┘
 *
 * Each band is contrast-stretched to [0,1] for visibility,
 * with the zero-crossing at mid-gray (0.5).
 *
 * Usage:
 *   node scripts/generate-subband-tiling.js [input.png] [output.png]
 *   node scripts/generate-subband-tiling.js  # uses default smoke capture
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const DEFAULT_INPUT = path.join(ROOT, 'tests', 'smoke-captures', 'smoke_dashboard_mode0.png');
const DEFAULT_OUTPUT = path.join(ROOT, 'docs', 'blog-assets', 'subband-tiling.png');

const PYRAMID_LEVELS = 4;

// ── Pyramid functions (match pyramid-decompose.test.js) ──

function gaussianBlur(data, width, height) {
    const sigma = 1.0, radius = 3;
    const kernelSize = radius * 2 + 1;
    const kernel = new Float64Array(kernelSize);
    let sum = 0;
    for (let i = 0; i < kernelSize; i++) {
        const x = i - radius;
        kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
        sum += kernel[i];
    }
    for (let i = 0; i < kernelSize; i++) kernel[i] /= sum;

    const temp = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let val = 0;
            for (let k = -radius; k <= radius; k++) {
                const sx = Math.min(Math.max(x + k, 0), width - 1);
                val += data[y * width + sx] * kernel[k + radius];
            }
            temp[y * width + x] = val;
        }
    }

    const out = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let val = 0;
            for (let k = -radius; k <= radius; k++) {
                const sy = Math.min(Math.max(y + k, 0), height - 1);
                val += temp[sy * width + x] * kernel[k + radius];
            }
            out[y * width + x] = val;
        }
    }
    return out;
}

function downsample2x(data, width, height) {
    const w2 = Math.floor(width / 2), h2 = Math.floor(height / 2);
    const out = new Float64Array(w2 * h2);
    for (let y = 0; y < h2; y++) {
        for (let x = 0; x < w2; x++) {
            const i = y * 2 * width + x * 2;
            out[y * w2 + x] = (data[i] + data[i + 1] + data[i + width] + data[i + width + 1]) / 4;
        }
    }
    return { data: out, width: w2, height: h2 };
}

function upsample2x(data, width, height, targetW, targetH) {
    const out = new Float64Array(targetW * targetH);
    for (let y = 0; y < targetH; y++) {
        for (let x = 0; x < targetW; x++) {
            const sy = Math.min(Math.floor(y / 2), height - 1);
            const sx = Math.min(Math.floor(x / 2), width - 1);
            out[y * targetW + x] = data[sy * width + sx];
        }
    }
    return out;
}

function buildPyramid(luma, width, height) {
    const bands = [];
    const gaussLevels = [{ data: luma, width, height }];
    let current = gaussLevels[0];

    for (let k = 0; k < PYRAMID_LEVELS; k++) {
        const blurred = gaussianBlur(current.data, current.width, current.height);
        const down = downsample2x(blurred, current.width, current.height);
        gaussLevels.push(down);
        current = down;
    }

    for (let k = 0; k < PYRAMID_LEVELS; k++) {
        const gk = gaussLevels[k];
        const gk1 = gaussLevels[k + 1];
        const up = upsample2x(gk1.data, gk1.width, gk1.height, gk.width, gk.height);
        const band = new Float64Array(gk.width * gk.height);
        for (let i = 0; i < band.length; i++) band[i] = gk.data[i] - up[i];
        bands.push({ data: band, width: gk.width, height: gk.height, level: k });
    }

    // Residual at lowest resolution
    const res = gaussLevels[PYRAMID_LEVELS];
    bands.push({ data: res.data, width: res.width, height: res.height, level: PYRAMID_LEVELS });

    return bands;
}

// ── Rendering ──

function contrastStretch(data) {
    // Map band values to [0,1] with zero-crossing at 0.5
    // Bands are zero-mean, so positive values → bright, negative → dark
    let maxAbs = 0;
    for (let i = 0; i < data.length; i++) {
        const a = Math.abs(data[i]);
        if (a > maxAbs) maxAbs = a;
    }
    if (maxAbs < 1e-10) maxAbs = 1;

    const out = new Float64Array(data.length);
    for (let i = 0; i < data.length; i++) {
        out[i] = 0.5 + (data[i] / maxAbs) * 0.5;
    }
    return out;
}

function blitScaled(src, srcW, srcH, dst, dstW, dstH, offsetX, offsetY, totalW) {
    // Nearest-neighbor scale src into a region of dst
    const scaleX = srcW / dstW;
    const scaleY = srcH / dstH;
    for (let y = 0; y < dstH; y++) {
        for (let x = 0; x < dstW; x++) {
            const sx = Math.min(Math.floor(x * scaleX), srcW - 1);
            const sy = Math.min(Math.floor(y * scaleY), srcH - 1);
            const val = src[sy * srcW + sx];
            const di = ((offsetY + y) * totalW + (offsetX + x)) * 4;
            const v = Math.round(Math.max(0, Math.min(1, val)) * 255);
            dst[di] = v;
            dst[di + 1] = v;
            dst[di + 2] = v;
            dst[di + 3] = 255;
        }
    }
}

function blitScaledRGB(srcPng, dstData, dstW, dstH, offsetX, offsetY, totalW) {
    const scaleX = srcPng.width / dstW;
    const scaleY = srcPng.height / dstH;
    for (let y = 0; y < dstH; y++) {
        for (let x = 0; x < dstW; x++) {
            const sx = Math.min(Math.floor(x * scaleX), srcPng.width - 1);
            const sy = Math.min(Math.floor(y * scaleY), srcPng.height - 1);
            const si = (sy * srcPng.width + sx) * 4;
            const di = ((offsetY + y) * totalW + (offsetX + x)) * 4;
            dstData[di] = srcPng.data[si];
            dstData[di + 1] = srcPng.data[si + 1];
            dstData[di + 2] = srcPng.data[si + 2];
            dstData[di + 3] = 255;
        }
    }
}

function drawLabel(dstData, totalW, offsetX, offsetY, cellW, label) {
    // Simple label: white text area at bottom of cell
    const barH = 24;
    const barY = offsetY + 4;
    for (let y = barY; y < barY + barH; y++) {
        for (let x = offsetX + 4; x < offsetX + Math.min(label.length * 9 + 12, cellW - 4); x++) {
            const di = (y * totalW + x) * 4;
            dstData[di] = 20;
            dstData[di + 1] = 20;
            dstData[di + 2] = 30;
            dstData[di + 3] = 220;
        }
    }
}

function main() {
    const inputPath = process.argv[2] || DEFAULT_INPUT;
    const outputPath = process.argv[3] || DEFAULT_OUTPUT;

    if (!fs.existsSync(inputPath)) {
        console.error(`Input not found: ${inputPath}`);
        console.error('Run: npm run capture-smoke');
        process.exit(1);
    }

    // Load and convert to luminance
    const png = PNG.sync.read(fs.readFileSync(inputPath));
    const w = png.width, h = png.height;
    console.log(`Input: ${inputPath} (${w}x${h})`);

    const luma = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const si = i * 4;
        luma[i] = (0.2126 * png.data[si] + 0.7152 * png.data[si + 1] + 0.0722 * png.data[si + 2]) / 255;
    }

    // Build pyramid
    console.log('Building Laplacian pyramid...');
    const bands = buildPyramid(luma, w, h);

    // Print band stats
    const labels = ['Band 0 (highest freq)', 'Band 1', 'Band 2', 'Band 3 (lowest freq)', 'Residual (DC)'];
    for (let k = 0; k < bands.length; k++) {
        const b = bands[k];
        let absSum = 0;
        for (let i = 0; i < b.data.length; i++) absSum += Math.abs(b.data[i]);
        console.log(`  ${labels[k]}: ${b.width}x${b.height}, mean|val|=${(absSum / b.data.length).toFixed(4)}`);
    }

    // Layout: 3 columns x 2 rows, each cell is w/3 x h/2
    const cellW = Math.floor(w / 3);
    const cellH = Math.floor(h / 2);
    const outW = cellW * 3;
    const outH = cellH * 2;
    const out = new PNG({ width: outW, height: outH });
    out.data.fill(0);
    for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;

    // Contrast-stretch each band
    const stretched = bands.map(b => contrastStretch(b.data));

    // Row 0: Band 0, 1, 2
    blitScaled(stretched[0], bands[0].width, bands[0].height, out.data, cellW, cellH, 0, 0, outW);
    blitScaled(stretched[1], bands[1].width, bands[1].height, out.data, cellW, cellH, cellW, 0, outW);
    blitScaled(stretched[2], bands[2].width, bands[2].height, out.data, cellW, cellH, cellW * 2, 0, outW);

    // Row 1: Band 3, Residual, Original
    blitScaled(stretched[3], bands[3].width, bands[3].height, out.data, cellW, cellH, 0, cellH, outW);
    blitScaled(stretched[4], bands[4].width, bands[4].height, out.data, cellW, cellH, cellW, cellH, outW);
    blitScaledRGB(png, out.data, cellW, cellH, cellW * 2, cellH, outW);

    // Labels
    const cellLabels = [
        'Band 0 — highest frequency',
        'Band 1 — mid-high',
        'Band 2 — mid-low',
        'Band 3 — lowest frequency',
        'Residual — DC content',
        'Original',
    ];
    for (let i = 0; i < 6; i++) {
        const col = i % 3;
        const row = Math.floor(i / 3);
        drawLabel(out.data, outW, col * cellW, row * cellH, cellW, cellLabels[i]);
    }

    // Save
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outputPath, PNG.sync.write(out));
    console.log(`\nSaved: ${outputPath}`);
    console.log(`  ${outW}x${outH}, ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(1)} MB`);
}

main();
