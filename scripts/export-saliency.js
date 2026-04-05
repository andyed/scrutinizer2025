#!/usr/bin/env node
/**
 * export-saliency.js — CLI to export per-coordinate saliency and congestion values.
 *
 * Uses the same Oklab DoG + Rosenholtz congestion pipeline as saliency-worker.js,
 * but runs in Node.js without Electron or GPU. Reuses congestion-core.js directly.
 *
 * Usage:
 *   node scripts/export-saliency.js \
 *     --input serp.png \
 *     --coordinates coords.json \
 *     --output saliency.json \
 *     [--metrics saliency,congestion,edge] \
 *     [--radius 60] \
 *     [--resolution 256]
 *
 * Batch mode:
 *   node scripts/export-saliency.js \
 *     --input-dir renders/ \
 *     --coordinates-dir coords/ \
 *     --output-dir saliency/
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// Reuse Scrutinizer's exact math
const {
    gaussianBlur,
    computeLocalVariance,
    normalizeFeature,
    computeStats,
    computeEdgeDensity,
    computeCompositeScore,
} = require('../renderer/congestion-core.js');

// ── Oklab color conversion (from saliency-worker.js) ─────────────────────

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

// ── Center-surround (DoG) ────────────────────────────────────────────────

function computeCenterSurround(feature, width, height) {
    const fine = gaussianBlur(new Float32Array(feature), width, height, 1.0);
    const fineCopy = new Float32Array(fine);
    const coarse = gaussianBlur(new Float32Array(feature), width, height, 3.0);
    const result = new Float32Array(width * height);
    for (let i = 0; i < result.length; i++) {
        result[i] = Math.abs(fineCopy[i] - coarse[i]);
    }
    return result;
}

// ── Core saliency computation ────────────────────────────────────────────

function computeSaliencyMaps(pixels, width, height) {
    const len = width * height;

    // Extract Oklab features
    const I = new Float32Array(len);
    const RG = new Float32Array(len);
    const BY = new Float32Array(len);

    for (let i = 0; i < len; i++) {
        const rLin = srgbToLinear(pixels[i * 4] / 255.0);
        const gLin = srgbToLinear(pixels[i * 4 + 1] / 255.0);
        const bLin = srgbToLinear(pixels[i * 4 + 2] / 255.0);
        const lab = linearSrgbToOklab(rLin, gLin, bLin);
        I[i] = lab.L;
        RG[i] = Math.abs(lab.a);
        BY[i] = Math.abs(lab.b);
    }

    // Center-surround + normalize
    const norm_I = normalizeFeature(computeCenterSurround(I, width, height));
    const norm_RG = normalizeFeature(computeCenterSurround(RG, width, height));
    const norm_BY = normalizeFeature(computeCenterSurround(BY, width, height));

    // Feature congestion (Rosenholtz)
    const sigma = 2.5;
    const var_I = computeLocalVariance(I, width, height, sigma);
    const var_RG = computeLocalVariance(RG, width, height, sigma);
    const var_BY = computeLocalVariance(BY, width, height, sigma);
    const congestion = new Float32Array(len);
    for (let i = 0; i < len; i++) {
        congestion[i] = var_I[i] + var_RG[i] + var_BY[i];
    }

    // Edge density
    const edgeDensity = computeEdgeDensity(I, width, height, 3.0);

    // Combine saliency (no face detection or structure gating in CLI mode)
    const W_I = 0.3, W_RG = 0.35, W_BY = 0.35;
    const saliency = new Float32Array(len);
    let maxVal = 0;
    for (let i = 0; i < len; i++) {
        saliency[i] = W_I * norm_I[i] + W_RG * norm_RG[i] + W_BY * norm_BY[i];
        if (saliency[i] > maxVal) maxVal = saliency[i];
    }
    if (maxVal < 0.001) maxVal = 1.0;
    for (let i = 0; i < len; i++) {
        saliency[i] = Math.pow(saliency[i] / maxVal, 0.8);
    }

    // Normalize congestion and edge density
    const norm_congestion = normalizeFeature(congestion);
    const norm_edgeDensity = normalizeFeature(edgeDensity);

    return {
        saliency,
        congestion: norm_congestion,
        edgeDensity: norm_edgeDensity,
        width,
        height,
        congestionStats: computeStats(norm_congestion, width, height),
        edgeDensityStats: computeStats(norm_edgeDensity, width, height),
    };
}

// ── Coordinate sampling ──────────────────────────────────────────────────

function sampleAtCoordinate(map, mapW, mapH, x, y, radius, srcW, srcH) {
    // Map from source image coords to saliency map coords
    const scaleX = mapW / srcW;
    const scaleY = mapH / srcH;
    const cx = Math.round(x * scaleX);
    const cy = Math.round(y * scaleY);
    const r = Math.max(1, Math.round(radius * Math.min(scaleX, scaleY)));

    let sum = 0, max = -Infinity, count = 0;
    const r2 = r * r;

    for (let dy = -r; dy <= r; dy++) {
        const py = cy + dy;
        if (py < 0 || py >= mapH) continue;
        for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > r2) continue;
            const px = cx + dx;
            if (px < 0 || px >= mapW) continue;
            const val = map[py * mapW + px];
            sum += val;
            if (val > max) max = val;
            count++;
        }
    }

    return {
        mean: count > 0 ? sum / count : 0,
        max: count > 0 ? max : 0,
        n_samples: count,
    };
}

// ── PNG loading ──────────────────────────────────────────────────────────

function loadPNG(filePath) {
    const data = fs.readFileSync(filePath);
    const png = PNG.sync.read(data);
    return { pixels: png.data, width: png.width, height: png.height };
}

// ── Process a single image ───────────────────────────────────────────────

function processImage(imagePath, coordinates, opts) {
    const { pixels, width: srcW, height: srcH } = loadPNG(imagePath);
    const maxDim = opts.resolution || 256;

    // Scale down for saliency computation (matches saliency-worker.js behavior)
    const scale = Math.min(1.0, maxDim / Math.max(srcW, srcH));
    const sW = Math.floor(srcW * scale);
    const sH = Math.floor(srcH * scale);

    // Downsample via nearest-neighbor (good enough for saliency — worker uses canvas drawImage)
    const downPixels = new Uint8Array(sW * sH * 4);
    for (let y = 0; y < sH; y++) {
        const srcY = Math.min(Math.floor(y / scale), srcH - 1);
        for (let x = 0; x < sW; x++) {
            const srcX = Math.min(Math.floor(x / scale), srcW - 1);
            const di = (y * sW + x) * 4;
            const si = (srcY * srcW + srcX) * 4;
            downPixels[di] = pixels[si];
            downPixels[di + 1] = pixels[si + 1];
            downPixels[di + 2] = pixels[si + 2];
            downPixels[di + 3] = pixels[si + 3];
        }
    }

    const maps = computeSaliencyMaps(downPixels, sW, sH);
    const radius = opts.radius || 60;
    const metrics = opts.metrics || ['saliency', 'congestion', 'edge'];

    const results = coordinates.map(coord => {
        const result = { id: coord.id, x: coord.x, y: coord.y };

        if (metrics.includes('saliency')) {
            const s = sampleAtCoordinate(maps.saliency, sW, sH, coord.x, coord.y, radius, srcW, srcH);
            result.saliency_mean = parseFloat(s.mean.toFixed(4));
            result.saliency_max = parseFloat(s.max.toFixed(4));
        }
        if (metrics.includes('congestion')) {
            const c = sampleAtCoordinate(maps.congestion, sW, sH, coord.x, coord.y, radius, srcW, srcH);
            result.congestion_mean = parseFloat(c.mean.toFixed(4));
            result.congestion_max = parseFloat(c.max.toFixed(4));
        }
        if (metrics.includes('edge')) {
            const e = sampleAtCoordinate(maps.edgeDensity, sW, sH, coord.x, coord.y, radius, srcW, srcH);
            result.edge_density_mean = parseFloat(e.mean.toFixed(4));
            result.edge_density_max = parseFloat(e.max.toFixed(4));
        }

        return result;
    });

    const { score, rating } = computeCompositeScore(maps.congestionStats, maps.edgeDensityStats);

    return {
        image: path.basename(imagePath),
        image_width: srcW,
        image_height: srcH,
        saliency_resolution: `${sW}x${sH}`,
        foveal_radius: radius,
        complexity_score: score,
        complexity_rating: rating.label,
        coordinates: results,
    };
}

// ── CLI argument parsing ─────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {};
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--input': opts.input = args[++i]; break;
            case '--coordinates': opts.coordinates = args[++i]; break;
            case '--output': opts.output = args[++i]; break;
            case '--input-dir': opts.inputDir = args[++i]; break;
            case '--coordinates-dir': opts.coordinatesDir = args[++i]; break;
            case '--output-dir': opts.outputDir = args[++i]; break;
            case '--metrics': opts.metrics = args[++i].split(','); break;
            case '--radius': opts.radius = parseInt(args[++i], 10); break;
            case '--resolution': opts.resolution = parseInt(args[++i], 10); break;
            case '--help': case '-h':
                console.log(`Usage:
  Single:  node export-saliency.js --input <png> --coordinates <json> --output <json>
  Batch:   node export-saliency.js --input-dir <dir> --coordinates-dir <dir> --output-dir <dir>

Options:
  --metrics <list>      Comma-separated: saliency,congestion,edge (default: all)
  --radius <px>         Foveal sampling radius in source pixels (default: 60)
  --resolution <px>     Max saliency map dimension (default: 256)`);
                process.exit(0);
        }
    }
    return opts;
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
    const opts = parseArgs();

    if (opts.input) {
        // Single file mode
        if (!opts.coordinates) {
            console.error('Error: --coordinates required in single file mode');
            process.exit(1);
        }
        const coords = JSON.parse(fs.readFileSync(opts.coordinates, 'utf-8'));
        const t0 = Date.now();
        const result = processImage(opts.input, coords, opts);
        const elapsed = Date.now() - t0;

        if (opts.output) {
            fs.writeFileSync(opts.output, JSON.stringify(result, null, 2));
            console.log(`Wrote ${opts.output} (${elapsed}ms)`);
        } else {
            console.log(JSON.stringify(result, null, 2));
        }

    } else if (opts.inputDir) {
        // Batch mode
        const coordsDir = opts.coordinatesDir || opts.inputDir;
        const outDir = opts.outputDir;
        if (!outDir) {
            console.error('Error: --output-dir required in batch mode');
            process.exit(1);
        }
        fs.mkdirSync(outDir, { recursive: true });

        const pngs = fs.readdirSync(opts.inputDir).filter(f => f.endsWith('.png'));
        console.log(`Processing ${pngs.length} images...`);

        let processed = 0, skipped = 0;
        const t0 = Date.now();

        for (const png of pngs) {
            const stem = path.basename(png, '.png');
            const coordFile = path.join(coordsDir, `${stem}.json`);
            if (!fs.existsSync(coordFile)) {
                skipped++;
                continue;
            }

            const coords = JSON.parse(fs.readFileSync(coordFile, 'utf-8'));
            const result = processImage(path.join(opts.inputDir, png), coords, opts);
            fs.writeFileSync(path.join(outDir, `${stem}.json`), JSON.stringify(result, null, 2));
            processed++;

            if (processed % 50 === 0) {
                console.log(`  ${processed}/${pngs.length}...`);
            }
        }

        const elapsed = Date.now() - t0;
        console.log(`Done: ${processed} processed, ${skipped} skipped (no coordinates), ${elapsed}ms total`);

    } else {
        console.error('Error: --input or --input-dir required. Use --help for usage.');
        process.exit(1);
    }
}

main();
