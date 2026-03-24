#!/usr/bin/env node
/**
 * Compare Compute Textures: Tier 2.5 vs Tier 2.75
 *
 * Loads raw compute texture dumps from capture-compute-texture.js and produces:
 * 1. Per-eccentricity-ring variance comparison (structured vs uniform noise)
 * 2. Side-by-side strip PNG: [mode10] | [mode14]
 * 3. Alpha-masked comparison (only peripheral pixels where compute is active)
 *
 * Usage:
 *   node scripts/compare-compute-textures.js
 *   node scripts/compare-compute-textures.js --dir tests/compute-captures
 */

const path = require('path');
const fs = require('fs');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const INPUT_DIR = process.argv.includes('--dir')
    ? process.argv[process.argv.indexOf('--dir') + 1]
    : path.join(ROOT, 'tests', 'compute-captures');

// Eccentricity rings in pixels (at half-res, fovea radius ~22.5px)
const RINGS = [
    { name: 'fovea',       rMin: 0,   rMax: 22  },
    { name: 'parafovea',   rMin: 22,  rMax: 45  },
    { name: 'near-periph', rMin: 45,  rMax: 90  },
    { name: 'mid-periph',  rMin: 90,  rMax: 180 },
    { name: 'far-periph',  rMin: 180, rMax: 9999 },
];

function loadRaw(filePath) {
    const buf = fs.readFileSync(filePath);
    const width = buf.readUInt32LE(0);
    const height = buf.readUInt32LE(4);
    const data = new Uint8Array(buf.buffer, buf.byteOffset + 8, width * height * 4);
    return { width, height, data };
}

function pixelAt(img, x, y) {
    const i = (y * img.width + x) * 4;
    return {
        r: img.data[i],
        g: img.data[i + 1],
        b: img.data[i + 2],
        a: img.data[i + 3],
    };
}

function luminance(r, g, b) {
    return 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
}

// Per-ring stats: mean luminance, luminance variance, mean alpha, pixel count
function ringStats(img, cx, cy, rMin, rMax) {
    let sumLum = 0, sumLum2 = 0, sumAlpha = 0, count = 0;
    let sumR = 0, sumG = 0, sumB = 0;
    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            const dx = x - cx, dy = y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < rMin || dist >= rMax) continue;
            const p = pixelAt(img, x, y);
            if (p.a < 1) continue; // skip transparent (foveal passthrough)
            const lum = luminance(p.r, p.g, p.b);
            sumLum += lum;
            sumLum2 += lum * lum;
            sumAlpha += p.a / 255;
            sumR += p.r; sumG += p.g; sumB += p.b;
            count++;
        }
    }
    if (count === 0) return { meanLum: 0, varLum: 0, meanAlpha: 0, count: 0, meanR: 0, meanG: 0, meanB: 0 };
    const meanLum = sumLum / count;
    const varLum = (sumLum2 / count) - (meanLum * meanLum);
    return {
        meanLum: meanLum.toFixed(4),
        varLum: varLum.toFixed(6),
        meanAlpha: (sumAlpha / count).toFixed(3),
        count,
        meanR: (sumR / count).toFixed(1),
        meanG: (sumG / count).toFixed(1),
        meanB: (sumB / count).toFixed(1),
    };
}

// Mean absolute difference between two images in a ring
function ringMAD(img1, img2, cx, cy, rMin, rMax) {
    let sumDiff = 0, count = 0;
    for (let y = 0; y < img1.height; y++) {
        for (let x = 0; x < img1.width; x++) {
            const dx = x - cx, dy = y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < rMin || dist >= rMax) continue;
            const p1 = pixelAt(img1, x, y);
            const p2 = pixelAt(img2, x, y);
            if (p1.a < 1 && p2.a < 1) continue;
            const lum1 = luminance(p1.r, p1.g, p1.b);
            const lum2 = luminance(p2.r, p2.g, p2.b);
            sumDiff += Math.abs(lum1 - lum2);
            count++;
        }
    }
    return count > 0 ? (sumDiff / count) : 0;
}

function writeSideBySide(img1, img2, outPath) {
    const gap = 4;
    const w = img1.width + gap + img2.width;
    const h = Math.max(img1.height, img2.height);
    const png = new PNG({ width: w, height: h });

    // Fill with mid-gray gap
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            png.data[i] = png.data[i + 1] = png.data[i + 2] = 128;
            png.data[i + 3] = 255;
        }
    }

    // Copy img1 (left)
    for (let y = 0; y < img1.height; y++) {
        for (let x = 0; x < img1.width; x++) {
            const src = (y * img1.width + x) * 4;
            const dst = (y * w + x) * 4;
            png.data[dst] = img1.data[src];
            png.data[dst + 1] = img1.data[src + 1];
            png.data[dst + 2] = img1.data[src + 2];
            png.data[dst + 3] = 255;
        }
    }

    // Copy img2 (right)
    const xOff = img1.width + gap;
    for (let y = 0; y < img2.height; y++) {
        for (let x = 0; x < img2.width; x++) {
            const src = (y * img2.width + x) * 4;
            const dst = (y * w + (x + xOff)) * 4;
            png.data[dst] = img2.data[src];
            png.data[dst + 1] = img2.data[src + 1];
            png.data[dst + 2] = img2.data[src + 2];
            png.data[dst + 3] = 255;
        }
    }

    fs.writeFileSync(outPath, PNG.sync.write(png));
}

function main() {
    const mode10Path = path.join(INPUT_DIR, 'mode10_composite_compute.raw');
    const mode14Path = path.join(INPUT_DIR, 'mode14_composite_compute.raw');

    if (!fs.existsSync(mode10Path)) {
        console.error(`Missing: ${mode10Path}`);
        console.error('Run: node scripts/capture-compute-texture.js');
        process.exit(1);
    }
    if (!fs.existsSync(mode14Path)) {
        console.error(`Missing: ${mode14Path}`);
        console.error('Run: node scripts/capture-compute-texture.js');
        process.exit(1);
    }

    console.log('\n🔬 Compute Texture Comparison: Tier 2.5 vs Tier 2.75\n');

    const mode10 = loadRaw(mode10Path);
    const mode14 = loadRaw(mode14Path);

    console.log(`  Mode 10 (Tier 2.5):  ${mode10.width}x${mode10.height}`);
    console.log(`  Mode 14 (Tier 2.75): ${mode14.width}x${mode14.height}\n`);

    if (mode10.width !== mode14.width || mode10.height !== mode14.height) {
        console.error('Dimension mismatch — cannot compare.');
        process.exit(1);
    }

    const cx = Math.floor(mode10.width / 2);
    const cy = Math.floor(mode10.height / 2);

    // Per-ring analysis
    console.log('  Ring             │ Tier 2.5 var │ Tier 2.75 var │ MAD    │ Pixels');
    console.log('  ─────────────────┼──────────────┼───────────────┼────────┼───────');
    for (const ring of RINGS) {
        const s10 = ringStats(mode10, cx, cy, ring.rMin, ring.rMax);
        const s14 = ringStats(mode14, cx, cy, ring.rMin, ring.rMax);
        const mad = ringMAD(mode10, mode14, cx, cy, ring.rMin, ring.rMax);
        const padName = ring.name.padEnd(15);
        const v10 = parseFloat(s10.varLum).toFixed(5).padStart(11);
        const v14 = parseFloat(s14.varLum).toFixed(5).padStart(12);
        const madStr = mad.toFixed(5).padStart(7);
        const cnt = Math.max(s10.count, s14.count).toString().padStart(6);
        console.log(`  ${padName} │ ${v10} │ ${v14} │ ${madStr} │ ${cnt}`);
    }

    // Overall MAD
    const overallMAD = ringMAD(mode10, mode14, cx, cy, 0, 9999);
    console.log(`\n  Overall MAD (mean absolute luminance difference): ${overallMAD.toFixed(5)}`);

    if (overallMAD < 0.01) {
        console.log('\n  ⚠ Textures are nearly identical — cross-scale correlations may not be producing visible effect.');
    } else if (overallMAD < 0.03) {
        console.log('\n  ℹ Textures show modest differences — check side-by-side strip for perceptual impact.');
    } else {
        console.log('\n  ✓ Textures show significant differences — cross-scale correlations are producing visible structure.');
    }

    // Write side-by-side PNG
    const stripPath = path.join(INPUT_DIR, 'comparison_strip.png');
    writeSideBySide(mode10, mode14, stripPath);
    console.log(`\n  Side-by-side strip: ${stripPath}`);
    console.log('  Left = Tier 2.5 (oriented noise), Right = Tier 2.75 (pyramid synthesis)\n');
}

main();
