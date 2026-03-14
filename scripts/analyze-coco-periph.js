#!/usr/bin/env node
/**
 * Analyze COCO-Periph captures for Wave 6 validation.
 *
 * Extracts annular patches at 4 eccentricities (5°, 10°, 15°, 20°) from
 * Scrutinizer captures and TTM reference images, computes SSIM, PSNR,
 * and DFT band energy for each.
 *
 * Reuses SSIM computation from compare-congestion.js and ring sampling
 * approach from analyze-spatial-acuity.js.
 *
 * Usage:
 *   node scripts/analyze-coco-periph.js
 *   node scripts/analyze-coco-periph.js --json
 *   node scripts/analyze-coco-periph.js --count=5   # first N images only
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
function getArg(name, def) {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}

const ROOT = path.join(__dirname, '..');
const COCO_DIR = path.join(ROOT, 'tests', 'validation', 'coco-periph');
const CAPTURES_DIR = path.join(COCO_DIR, 'scrutinizer_captures');
const MANIFEST_PATH = path.join(COCO_DIR, 'manifest.json');
const RESULTS_PATH = path.join(COCO_DIR, 'analysis_results.json');

const countLimit = parseInt(getArg('count', '0')) || Infinity;

// ── Scrutinizer parameters ──
const FOVEA_RADIUS = 90;   // px
const PPD = 45;             // pixels per degree
const VIEWPORT_W = 1920;
const VIEWPORT_H = 1080;
const ECCENTRICITIES = [5, 10, 15, 20];

// Patch size: 1° = 45px. We sample 45x45 patches at cardinal positions.
const PATCH_SIZE_PX = 45;
const RING_WIDTH_PX = 45; // 1° ring width

// Cardinal positions for patch extraction
const CARDINAL_POSITIONS = [
  { id: 'N', dx: 0, dy: -1 },
  { id: 'S', dx: 0, dy: 1 },
  { id: 'E', dx: 1, dy: 0 },
  { id: 'W', dx: -1, dy: 0 },
];


// ── Spearman rank correlation (from compare-congestion.js) ──

function computeRanks(values) {
  const n = values.length;
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);

  const ranks = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + j + 1) / 2;
    for (let k = i; k < j; k++) {
      ranks[indexed[k].i] = avgRank;
    }
    i = j;
  }
  return ranks;
}

function spearmanRho(x, y) {
  if (x.length !== y.length || x.length < 3) return NaN;
  const n = x.length;
  const rankX = computeRanks(x);
  const rankY = computeRanks(y);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) {
    const d = rankX[i] - rankY[i];
    sumD2 += d * d;
  }
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}


// ── SSIM for grayscale patches (from compare-congestion.js) ──

function computeSSIM(a, b) {
  if (a.length !== b.length) return NaN;

  const n = a.length;
  const muA = a.reduce((s, v) => s + v, 0) / n;
  const muB = b.reduce((s, v) => s + v, 0) / n;

  let varA = 0, varB = 0, cov = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - muA;
    const db = b[i] - muB;
    varA += da * da;
    varB += db * db;
    cov += da * db;
  }
  varA /= n;
  varB /= n;
  cov /= n;

  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;

  return ((2 * muA * muB + c1) * (2 * cov + c2)) /
         ((muA * muA + muB * muB + c1) * (varA + varB + c2));
}


// ── PSNR ──

function computePSNR(a, b) {
  if (a.length !== b.length || a.length === 0) return NaN;

  let mse = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    mse += d * d;
  }
  mse /= a.length;

  if (mse === 0) return Infinity;
  return 10 * Math.log10((255 * 255) / mse);
}


// ── DFT band energy (adapted from analyze-spatial-acuity.js) ──

/**
 * Compute band energy in a grayscale patch.
 * Returns energy in low (<2 cpd) and high (4-8 cpd) frequency bands.
 */
function computeBandEnergy(pixels, patchSize, ppd) {
  // 1D DFT along rows, average power spectrum
  const N = patchSize;
  const powerSpectrum = new Float64Array(Math.floor(N / 2) + 1);

  // Average DFT across all rows for stability
  const numRows = Math.min(patchSize, pixels.length / patchSize);

  for (let row = 0; row < numRows; row++) {
    const offset = row * patchSize;
    const rowMean = pixels.slice(offset, offset + patchSize).reduce((a, b) => a + b, 0) / N;

    for (let k = 0; k <= N / 2; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) {
        const phase = -2 * Math.PI * k * n / N;
        re += (pixels[offset + n] - rowMean) * Math.cos(phase);
        im += (pixels[offset + n] - rowMean) * Math.sin(phase);
      }
      powerSpectrum[k] += (re * re + im * im) / (N * N);
    }
  }

  // Normalize by number of rows
  for (let k = 0; k < powerSpectrum.length; k++) {
    powerSpectrum[k] /= numRows;
  }

  // Convert frequency bins to cpd
  // bin k corresponds to k cycles per patchSize pixels
  // cpd = k * ppd / patchSize
  let lowEnergy = 0;  // <2 cpd
  let highEnergy = 0; // 4-8 cpd
  let totalEnergy = 0;

  for (let k = 1; k < powerSpectrum.length; k++) {
    const cpd = k * ppd / patchSize;
    totalEnergy += powerSpectrum[k];

    if (cpd < 2) {
      lowEnergy += powerSpectrum[k];
    } else if (cpd >= 4 && cpd <= 8) {
      highEnergy += powerSpectrum[k];
    }
  }

  return { lowEnergy, highEnergy, totalEnergy };
}


// ── Patch extraction ──

/**
 * Load a PNG and return pixel data + dimensions.
 */
function loadPng(filePath) {
  const data = fs.readFileSync(filePath);
  return PNG.sync.read(data);
}

/**
 * Extract a grayscale patch at a given pixel position.
 * Returns Float64Array of luminance values, or null if out of bounds.
 */
function extractPatch(png, centerX, centerY, size) {
  const half = Math.floor(size / 2);
  const x0 = centerX - half;
  const y0 = centerY - half;
  const x1 = x0 + size;
  const y1 = y0 + size;

  // Check bounds
  if (x0 < 0 || y0 < 0 || x1 > png.width || y1 > png.height) {
    return null;
  }

  const pixels = new Float64Array(size * size);
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const idx = ((y0 + dy) * png.width + (x0 + dx)) * 4;
      // CIE luminance
      pixels[dy * size + dx] = 0.2126 * png.data[idx] +
                                0.7152 * png.data[idx + 1] +
                                0.0722 * png.data[idx + 2];
    }
  }

  return pixels;
}

/**
 * Extract patches at cardinal positions for a given eccentricity.
 * Returns array of { position, pixels } or empty if all out of bounds.
 */
function extractAnnularPatches(png, eccDeg, dpr) {
  const cx = png.width / 2;
  const cy = png.height / 2;
  const radiusPx = eccDeg * PPD * dpr;
  const patchPx = Math.round(PATCH_SIZE_PX * dpr);

  const patches = [];

  for (const pos of CARDINAL_POSITIONS) {
    const px = Math.round(cx + pos.dx * radiusPx);
    const py = Math.round(cy + pos.dy * radiusPx);

    const pixels = extractPatch(png, px, py, patchPx);
    if (pixels) {
      patches.push({ position: pos.id, pixels, size: patchPx });
    }
  }

  return patches;
}


// ── Per-image analysis ──

function analyzeImage(imageInfo) {
  const baseName = imageInfo.filename.replace(/\.\w+$/, '');

  // Load Scrutinizer captures
  const filteredPath = path.join(CAPTURES_DIR, `coco_${baseName}_filtered.png`);
  const baselinePath = path.join(CAPTURES_DIR, `coco_${baseName}_baseline.png`);

  if (!fs.existsSync(filteredPath)) {
    return { filename: imageInfo.filename, error: 'filtered capture not found' };
  }
  if (!fs.existsSync(baselinePath)) {
    return { filename: imageInfo.filename, error: 'baseline capture not found' };
  }

  const filtered = loadPng(filteredPath);
  const baseline = loadPng(baselinePath);
  const dpr = filtered.width / VIEWPORT_W;

  const eccentricityResults = [];

  for (const ecc of ECCENTRICITIES) {
    // Extract patches from Scrutinizer filtered output
    const filteredPatches = extractAnnularPatches(filtered, ecc, dpr);
    // Extract matching patches from baseline (unfiltered)
    const baselinePatches = extractAnnularPatches(baseline, ecc, dpr);

    if (filteredPatches.length === 0) {
      eccentricityResults.push({
        ecc_deg: ecc,
        error: 'all patches out of viewport bounds',
        coverage: 0,
      });
      continue;
    }

    // Load TTM reference for this eccentricity if available
    const ttmPath = path.join(COCO_DIR, `ttm_${ecc}deg`, imageInfo.filename);
    let ttmPng = null;
    if (fs.existsSync(ttmPath)) {
      try {
        ttmPng = loadPng(ttmPath);
      } catch (e) {
        // TTM images may be JPEG — pngjs can't read those
      }
    }

    // Compute metrics per patch, then average
    let ssimOrigScrut = 0, ssimOrigTtm = 0;
    let psnrOrigScrut = 0, psnrOrigTtm = 0;
    let lowEnergyFiltered = 0, lowEnergyTtm = 0;
    let highEnergyFiltered = 0, highEnergyTtm = 0;
    let patchCount = 0;
    let ttmPatchCount = 0;

    for (let p = 0; p < filteredPatches.length; p++) {
      const fp = filteredPatches[p];
      const bp = baselinePatches.find(x => x.position === fp.position);
      if (!bp) continue;

      // SSIM and PSNR: original (baseline) vs Scrutinizer (filtered)
      ssimOrigScrut += computeSSIM(bp.pixels, fp.pixels);
      psnrOrigScrut += computePSNR(bp.pixels, fp.pixels);

      // DFT band energy of filtered output
      const filteredBands = computeBandEnergy(fp.pixels, fp.size, PPD * dpr);
      lowEnergyFiltered += filteredBands.lowEnergy;
      highEnergyFiltered += filteredBands.highEnergy;

      patchCount++;

      // Compare against TTM if available
      // TTM images are at native resolution (768x768), not 1920x1080.
      // We need to extract patches from TTM at corresponding positions.
      if (ttmPng) {
        // Map patch position from viewport space to TTM image space
        // The COCO image is centered in the viewport. TTM image IS the COCO image.
        const ttmCx = ttmPng.width / 2;
        const ttmCy = ttmPng.height / 2;
        // TTM uses 32 ppd; eccentricity in TTM pixels
        const ttmPpd = 32;
        const ttmRadius = ecc * ttmPpd;
        const ttmPatchSize = Math.round(PATCH_SIZE_PX * (ttmPpd / PPD));

        const pos = CARDINAL_POSITIONS.find(c => c.id === fp.position);
        const ttmPx = Math.round(ttmCx + pos.dx * ttmRadius);
        const ttmPy = Math.round(ttmCy + pos.dy * ttmRadius);

        const ttmPixels = extractPatch(ttmPng, ttmPx, ttmPy, ttmPatchSize);
        if (ttmPixels) {
          // For SSIM comparison with original, extract original patch at same TTM position
          // Use baseline viewport patch as the "original" reference
          // We need to compare at matched resolution — resize if needed
          // Simpler: compare TTM patch against its own original (which we have as baseline)
          // Since TTM and baseline have different resolution, use the TTM patch stats
          const ttmBands = computeBandEnergy(ttmPixels, ttmPatchSize, ttmPpd);
          lowEnergyTtm += ttmBands.lowEnergy;
          highEnergyTtm += ttmBands.highEnergy;

          // SSIM of original vs TTM — need same-resolution patches
          // Resample the baseline patch to TTM patch size for fair comparison
          // For now, just record TTM band energy; SSIM comparison requires resolution matching
          ttmPatchCount++;
        }
      }
    }

    if (patchCount === 0) {
      eccentricityResults.push({
        ecc_deg: ecc,
        error: 'no valid patch pairs',
        coverage: filteredPatches.length / 4,
      });
      continue;
    }

    const result = {
      ecc_deg: ecc,
      coverage: filteredPatches.length / 4,
      patch_count: patchCount,
      ssim_orig_scrut: ssimOrigScrut / patchCount,
      psnr_orig_scrut: psnrOrigScrut / patchCount,
      low_energy_filtered: lowEnergyFiltered / patchCount,
      high_energy_filtered: highEnergyFiltered / patchCount,
    };

    if (ttmPatchCount > 0) {
      result.ttm_patch_count = ttmPatchCount;
      result.low_energy_ttm = lowEnergyTtm / ttmPatchCount;
      result.high_energy_ttm = highEnergyTtm / ttmPatchCount;
    }

    eccentricityResults.push(result);
  }

  return {
    filename: imageInfo.filename,
    id: imageInfo.id,
    congestion: imageInfo.congestion,
    quintile: imageInfo.quintile,
    eccentricities: eccentricityResults,
  };
}


// ── Main ──

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found: ${MANIFEST_PATH}`);
    console.error('Run: node scripts/download-coco-periph.js');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const images = manifest.images.slice(0, countLimit);

  console.log(`\nWave 6: COCO-Periph Analysis`);
  console.log(`  Images: ${images.length}`);
  console.log(`  Eccentricities: ${ECCENTRICITIES.join('°, ')}°`);
  console.log(`  Patch size: ${PATCH_SIZE_PX}px (${PATCH_SIZE_PX / PPD}°)`);
  console.log();

  const results = [];
  let analyzed = 0;
  let errors = 0;

  for (const img of images) {
    const result = analyzeImage(img);
    results.push(result);

    if (result.error) {
      errors++;
      if (!hasFlag('json')) {
        console.warn(`  [error] ${img.filename}: ${result.error}`);
      }
    } else {
      analyzed++;
      if (!hasFlag('json')) {
        const ssims = result.eccentricities
          .filter(e => e.ssim_orig_scrut !== undefined)
          .map(e => `${e.ecc_deg}°:${e.ssim_orig_scrut.toFixed(3)}`);
        console.log(`  ${img.filename} — SSIM: ${ssims.join(', ')}`);
      }
    }
  }

  // Compute aggregate statistics
  const aggregates = {};
  for (const ecc of ECCENTRICITIES) {
    const eccResults = results
      .filter(r => !r.error)
      .map(r => r.eccentricities.find(e => e.ecc_deg === ecc))
      .filter(e => e && !e.error);

    if (eccResults.length > 0) {
      aggregates[`${ecc}deg`] = {
        count: eccResults.length,
        mean_ssim: eccResults.reduce((s, e) => s + e.ssim_orig_scrut, 0) / eccResults.length,
        mean_psnr: eccResults.reduce((s, e) => s + e.psnr_orig_scrut, 0) / eccResults.length,
        mean_low_energy: eccResults.reduce((s, e) => s + e.low_energy_filtered, 0) / eccResults.length,
        mean_high_energy: eccResults.reduce((s, e) => s + e.high_energy_filtered, 0) / eccResults.length,
      };

      // TTM comparison if available
      const ttmResults = eccResults.filter(e => e.low_energy_ttm !== undefined);
      if (ttmResults.length > 0) {
        aggregates[`${ecc}deg`].ttm_count = ttmResults.length;
        aggregates[`${ecc}deg`].mean_low_energy_ttm = ttmResults.reduce((s, e) => s + e.low_energy_ttm, 0) / ttmResults.length;
        aggregates[`${ecc}deg`].mean_high_energy_ttm = ttmResults.reduce((s, e) => s + e.high_energy_ttm, 0) / ttmResults.length;
      }
    }
  }

  // Cross-eccentricity correlations
  const crossCorrelations = {};

  // For Check 4: SSIM degradation rate correlation
  const ssimRates = results.filter(r => !r.error).map(r => {
    const eccData = r.eccentricities.filter(e => !e.error && e.ssim_orig_scrut !== undefined);
    if (eccData.length < 2) return null;
    // Simple linear rate: (SSIM at max ecc - SSIM at min ecc) / (max ecc - min ecc)
    const sorted = eccData.sort((a, b) => a.ecc_deg - b.ecc_deg);
    return {
      filename: r.filename,
      rate: (sorted[sorted.length - 1].ssim_orig_scrut - sorted[0].ssim_orig_scrut) /
            (sorted[sorted.length - 1].ecc_deg - sorted[0].ecc_deg),
    };
  }).filter(Boolean);

  if (ssimRates.length >= 3) {
    crossCorrelations.ssim_degradation_rates = ssimRates;
  }

  const output = {
    generated: new Date().toISOString(),
    images_analyzed: analyzed,
    images_errored: errors,
    eccentricities: ECCENTRICITIES,
    parameters: {
      fovea_radius: FOVEA_RADIUS,
      ppd: PPD,
      viewport: `${VIEWPORT_W}x${VIEWPORT_H}`,
      patch_size_px: PATCH_SIZE_PX,
    },
    aggregates,
    cross_correlations: crossCorrelations,
    per_image: results,
  };

  fs.writeFileSync(RESULTS_PATH, JSON.stringify(output, null, 2));

  if (hasFlag('json')) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`\n── Aggregate Results ──`);
    for (const [key, agg] of Object.entries(aggregates)) {
      console.log(`  ${key}: SSIM=${agg.mean_ssim.toFixed(3)}, PSNR=${agg.mean_psnr.toFixed(1)}dB (n=${agg.count})`);
    }
    console.log(`\n${analyzed} images analyzed, ${errors} errors.`);
    console.log(`Results written to: ${RESULTS_PATH}`);
    console.log('Next: node scripts/validate-coco-periph.js');
  }
}

main();
