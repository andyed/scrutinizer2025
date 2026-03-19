#!/usr/bin/env node
/**
 * Subband Entropy (SE) Degradation Curve
 *
 * Content-independent validation of peripheral degradation quality.
 * Computes spatial frequency content (via Laplacian pyramid) at annular
 * rings from fixation. A working foveal simulation should produce:
 *   - High SE near fixation (spatial detail preserved)
 *   - Monotonically declining SE toward the periphery
 *   - No SE collapse to zero (fog artifact)
 *
 * Optionally compares filtered vs unfiltered captures for ratio metrics,
 * and correlates with Feature Congestion for biological plausibility.
 *
 * Usage:
 *   node scripts/validate-subband-entropy.js --filtered tests/smoke-captures/smoke_dashboard_mode0.png
 *   node scripts/validate-subband-entropy.js --filtered smoke_mode0.png --unfiltered smoke_unfiltered.png
 *
 * Exit codes:
 *   0 = all checks pass
 *   1 = validation failed
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// ── Configuration ──

const PYRAMID_LEVELS = 4;  // 4 octave bands (matches visual-clutter's 3 scales + residual)
const NUM_ORIENTATIONS = 4; // 0°, 45°, 90°, 135° (matches Rosenholtz FC)

// Annular rings (same as OCR test for comparability)
const RINGS = [
  { name: 'fovea',       rMin: 0,    rMax: 0.75 },
  { name: 'parafovea',   rMin: 0.75, rMax: 1.5 },
  { name: 'near_periph', rMin: 1.5,  rMax: 3.0 },
  { name: 'mid_periph',  rMin: 3.0,  rMax: 5.0 },
  { name: 'far_periph',  rMin: 5.0,  rMax: 8.0 },
];

// ── Image math ──

function getLuminance(png, x, y) {
  const idx = (y * png.width + x) * 4;
  // Rec. 709 luminance
  return 0.2126 * png.data[idx] + 0.7152 * png.data[idx + 1] + 0.0722 * png.data[idx + 2];
}

function extractLuminance(png) {
  const w = png.width, h = png.height;
  const lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      lum[y * w + x] = getLuminance(png, x, y);
    }
  }
  return { data: lum, width: w, height: h };
}

// Box-filter downsample by 2
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

// Bilinear upsample by 2 to target dimensions
function upsample(img, tw, th) {
  const out = new Float32Array(tw * th);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const sx = (x / tw) * img.width;
      const sy = (y / th) * img.height;
      const x0 = Math.min(Math.floor(sx), img.width - 1);
      const y0 = Math.min(Math.floor(sy), img.height - 1);
      const x1 = Math.min(x0 + 1, img.width - 1);
      const y1 = Math.min(y0 + 1, img.height - 1);
      const fx = sx - x0, fy = sy - y0;
      out[y * tw + x] =
        img.data[y0 * img.width + x0] * (1 - fx) * (1 - fy) +
        img.data[y0 * img.width + x1] * fx * (1 - fy) +
        img.data[y1 * img.width + x0] * (1 - fx) * fy +
        img.data[y1 * img.width + x1] * fx * fy;
    }
  }
  return { data: out, width: tw, height: th };
}

// ── Laplacian Pyramid ──
// Each band = difference between adjacent Gaussian levels (upsampled to original size).
// Band k captures spatial frequencies at octave k.
// Residual = lowest-frequency content.

function buildLaplacianPyramid(lum) {
  const bands = [];
  let current = lum;

  for (let k = 0; k < PYRAMID_LEVELS; k++) {
    const down = downsample(current);
    const up = upsample(down, current.width, current.height);
    // Band = current - upsampled(downsampled(current))
    const band = new Float32Array(current.width * current.height);
    for (let i = 0; i < band.length; i++) {
      band[i] = current.data[i] - up.data[i];
    }
    bands.push({ data: band, width: current.width, height: current.height, level: k });
    current = down;
  }

  // Residual (DC component)
  const residual = upsample(current, lum.width, lum.height);
  bands.push({ data: residual.data, width: lum.width, height: lum.height, level: PYRAMID_LEVELS });

  return bands;
}

// ── Oriented energy (simplified) ──
// Compute gradient magnitude at 4 orientations using Sobel-like kernels.
// Returns per-pixel orientation energy for FC-like analysis.

function computeOrientedEnergy(lum) {
  const w = lum.width, h = lum.height;
  const energy = new Float32Array(w * h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      // Horizontal gradient (0°)
      const gx = lum.data[idx + 1] - lum.data[idx - 1];
      // Vertical gradient (90°)
      const gy = lum.data[(y + 1) * w + x] - lum.data[(y - 1) * w + x];
      // Diagonal gradients (45°, 135°)
      const g45 = lum.data[(y - 1) * w + x + 1] - lum.data[(y + 1) * w + x - 1];
      const g135 = lum.data[(y - 1) * w + x - 1] - lum.data[(y + 1) * w + x + 1];

      energy[idx] = Math.sqrt(gx * gx + gy * gy + g45 * g45 + g135 * g135) / 4;
    }
  }
  return { data: energy, width: w, height: h };
}

// ── Shannon Entropy ──
// Histogram-based entropy of pixel values within a region.

function shannonEntropy(values) {
  if (values.length === 0) return 0;

  // Quantize to 64 bins (enough resolution, stable with moderate sample sizes)
  const NUM_BINS = 64;
  let min = Infinity, max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (range < 1e-8) return 0;  // uniform region

  const bins = new Uint32Array(NUM_BINS);
  for (const v of values) {
    const bin = Math.min(NUM_BINS - 1, Math.floor((v - min) / range * NUM_BINS));
    bins[bin]++;
  }

  let entropy = 0;
  const n = values.length;
  for (let i = 0; i < NUM_BINS; i++) {
    if (bins[i] === 0) continue;
    const p = bins[i] / n;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// ── Feature Congestion (simplified) ──
// Approximation of Rosenholtz FC: contrast energy std dev within a region.
// Uses the Laplacian band energy as a proxy for the full FC decomposition.

function featureCongestion(bandValues) {
  if (bandValues.length === 0) return 0;
  const absValues = bandValues.map(Math.abs);
  const mean = absValues.reduce((a, b) => a + b, 0) / absValues.length;
  const variance = absValues.reduce((a, v) => a + (v - mean) ** 2, 0) / absValues.length;
  return Math.sqrt(variance);
}

// ── Ring sampling ──

function sampleRing(img, fixX, fixY, foveaRadius, ring) {
  const values = [];
  const rMinPx = ring.rMin * foveaRadius;
  const rMaxPx = ring.rMax * foveaRadius;

  // Sample every 2nd pixel for speed (plenty for entropy estimation)
  for (let y = 0; y < img.height; y += 2) {
    for (let x = 0; x < img.width; x += 2) {
      const dx = x - fixX;
      const dy = y - fixY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= rMinPx && dist < rMaxPx) {
        values.push(img.data[y * img.width + x]);
      }
    }
  }
  return values;
}

// ── Main ──

function main() {
  const args = process.argv.slice(2);
  let filteredPath = null;
  let unfilteredPath = null;
  let fixX = 0.5, fixY = 0.5;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--filtered' && args[i + 1]) filteredPath = args[++i];
    else if (args[i] === '--unfiltered' && args[i + 1]) unfilteredPath = args[++i];
    else if (args[i] === '--fixation-x' && args[i + 1]) fixX = parseFloat(args[++i]);
    else if (args[i] === '--fixation-y' && args[i + 1]) fixY = parseFloat(args[++i]);
    else if (!filteredPath) filteredPath = args[i];  // positional
  }

  // Default to dashboard smoke capture
  if (!filteredPath) {
    filteredPath = path.join(__dirname, '..', 'tests', 'smoke-captures', 'smoke_dashboard_mode0.png');
  }

  if (!fs.existsSync(filteredPath)) {
    console.error(`File not found: ${filteredPath}`);
    process.exit(1);
  }

  console.log('Loading filtered image...');
  const filteredPng = PNG.sync.read(fs.readFileSync(filteredPath));
  const fixPxX = Math.round(fixX * filteredPng.width);
  const fixPxY = Math.round(fixY * filteredPng.height);
  const foveaRadius = 360; // px in retina coords (matches OCR test)

  // Build Laplacian pyramid
  console.log('Building Laplacian pyramid...');
  const filteredLum = extractLuminance(filteredPng);
  const filteredBands = buildLaplacianPyramid(filteredLum);
  const filteredOriented = computeOrientedEnergy(filteredLum);

  // Optional: unfiltered reference
  let unfilteredBands = null;
  let unfilteredOriented = null;
  if (unfilteredPath && fs.existsSync(unfilteredPath)) {
    console.log('Loading unfiltered reference...');
    const unfilteredPng = PNG.sync.read(fs.readFileSync(unfilteredPath));
    const unfilteredLum = extractLuminance(unfilteredPng);
    unfilteredBands = buildLaplacianPyramid(unfilteredLum);
    unfilteredOriented = computeOrientedEnergy(unfilteredLum);
  }

  // Compute SE per ring
  console.log('Computing subband entropy per ring...\n');

  const results = [];

  for (const ring of RINGS) {
    // Aggregate SE across all Laplacian bands
    let totalSE = 0;
    const bandEntropies = [];

    for (const band of filteredBands) {
      const values = sampleRing(band, fixPxX, fixPxY, foveaRadius, ring);
      const se = shannonEntropy(values);
      bandEntropies.push(se);
      totalSE += se;
    }

    // Oriented energy entropy (captures orientation variety — the FC orientation component)
    const orientValues = sampleRing(filteredOriented, fixPxX, fixPxY, foveaRadius, ring);
    const orientSE = shannonEntropy(orientValues);
    totalSE += orientSE * 0.5;  // lower weight, matches FC orientation weight

    // Feature Congestion proxy (contrast energy variance in band 1-2)
    const fcBand1 = sampleRing(filteredBands[1], fixPxX, fixPxY, foveaRadius, ring);
    const fc = featureCongestion(fcBand1);

    // Unfiltered reference SE (if available)
    let refSE = null;
    let seRatio = null;
    if (unfilteredBands) {
      let refTotal = 0;
      for (const band of unfilteredBands) {
        const values = sampleRing(band, fixPxX, fixPxY, foveaRadius, ring);
        refTotal += shannonEntropy(values);
      }
      const refOrient = sampleRing(unfilteredOriented, fixPxX, fixPxY, foveaRadius, ring);
      refTotal += shannonEntropy(refOrient) * 0.5;
      refSE = refTotal;
      seRatio = refTotal > 0 ? totalSE / refTotal : null;
    }

    const sampleCount = sampleRing(filteredLum, fixPxX, fixPxY, foveaRadius, ring).length;

    results.push({
      ring: ring.name,
      rMin: ring.rMin,
      rMax: ring.rMax,
      sampleCount,
      totalSE,
      bandEntropies,
      orientSE,
      fc,
      refSE,
      seRatio,
    });
  }

  // ── Report ──

  console.log('═══ Subband Entropy Degradation Curve ═══\n');
  console.log(`Image: ${filteredPng.width}×${filteredPng.height}px`);
  console.log(`Fixation: (${fixPxX}, ${fixPxY})`);
  console.log(`Fovea radius: ${foveaRadius}px`);
  console.log(`Pyramid levels: ${PYRAMID_LEVELS}\n`);

  const hasRef = results[0].refSE !== null;
  const header = hasRef
    ? `  ${'Ring'.padEnd(14)} ${'Samples'.padStart(7)}  ${'SE'.padStart(7)}  ${'Ref SE'.padStart(7)}  ${'Ratio'.padStart(7)}  ${'FC'.padStart(7)}`
    : `  ${'Ring'.padEnd(14)} ${'Samples'.padStart(7)}  ${'SE'.padStart(7)}  ${'FC'.padStart(7)}`;
  console.log(header);
  console.log('  ' + '─'.repeat(header.length - 2));

  for (const r of results) {
    const bar = '█'.repeat(Math.round(r.totalSE * 3));
    if (hasRef) {
      console.log(`  ${r.ring.padEnd(14)} ${String(r.sampleCount).padStart(7)}  ${r.totalSE.toFixed(2).padStart(7)}  ${(r.refSE || 0).toFixed(2).padStart(7)}  ${((r.seRatio || 0) * 100).toFixed(1).padStart(6)}%  ${r.fc.toFixed(3).padStart(7)}  ${bar}`);
    } else {
      console.log(`  ${r.ring.padEnd(14)} ${String(r.sampleCount).padStart(7)}  ${r.totalSE.toFixed(2).padStart(7)}  ${r.fc.toFixed(3).padStart(7)}  ${bar}`);
    }
  }

  // ── Per-band report ──

  console.log('\n═══ Per-Band SE (high-freq bands should lose entropy in periphery) ═══\n');
  const bandLabels = [...Array(PYRAMID_LEVELS).keys()].map(k => `B${k}`).concat(['DC']);
  console.log(`  ${'Ring'.padEnd(14)} ${bandLabels.map(b => b.padStart(6)).join('')}  ${'HF/LF'.padStart(7)}`);
  console.log('  ' + '─'.repeat(14 + bandLabels.length * 6 + 9));
  for (const r of results) {
    const bandStr = r.bandEntropies.map(se => se.toFixed(2).padStart(6)).join('');
    // HF = bands 0-1, LF = bands 2-3+DC
    const hf = (r.bandEntropies[0] + r.bandEntropies[1]) / 2;
    const lf = (r.bandEntropies[2] + r.bandEntropies[3] + r.bandEntropies[4]) / 3;
    r.hfLfRatio = lf > 0 ? hf / lf : 0;
    console.log(`  ${r.ring.padEnd(14)} ${bandStr}  ${r.hfLfRatio.toFixed(3).padStart(7)}`);
  }

  // ── Validation checks ──

  console.log('\n═══ Validation ═══\n');

  const checks = [];
  const populated = results.filter(r => r.sampleCount >= 100);

  // 6.1a: HF/LF ratio monotonically decreases (content-independent!)
  // High-frequency bands (fine detail) should lose energy faster than low-frequency.
  // The RATIO captures degradation quality regardless of what content is at each ring.
  let hfLfMonotonic = true;
  for (let i = 1; i < populated.length; i++) {
    if (populated[i].hfLfRatio > populated[i - 1].hfLfRatio + 0.05) { // 0.05 tolerance
      hfLfMonotonic = false;
      checks.push({ name: '6.1a HF/LF ratio monotonic', pass: false,
        reason: `${populated[i].ring} (${populated[i].hfLfRatio.toFixed(3)}) > ${populated[i-1].ring} (${populated[i-1].hfLfRatio.toFixed(3)})` });
    }
  }
  if (hfLfMonotonic) {
    checks.push({ name: '6.1a HF/LF ratio monotonic', pass: true,
      reason: 'high-freq/low-freq ratio decreases from fovea to periphery' });
  }

  // 6.1b: High-frequency SE (bands 0-1) decreases with eccentricity
  const hfSE = populated.map(r => (r.bandEntropies[0] + r.bandEntropies[1]) / 2);
  let hfMonotonic = true;
  for (let i = 1; i < hfSE.length; i++) {
    if (hfSE[i] > hfSE[i - 1] + 0.15) {
      hfMonotonic = false;
    }
  }
  checks.push({ name: '6.1b HF SE monotonic', pass: hfMonotonic,
    reason: hfMonotonic
      ? `HF entropy: ${hfSE.map(s => s.toFixed(2)).join(' → ')}`
      : `HF non-monotonic: ${hfSE.map(s => s.toFixed(2)).join(' → ')}` });

  // 6.4: No fog — low-freq bands should retain entropy everywhere
  const lfSE = populated.map(r => (r.bandEntropies[3] + r.bandEntropies[4]) / 2);
  const lfMin = Math.min(...lfSE);
  const lfMax = Math.max(...lfSE);
  const lfRetention = lfMax > 0 ? lfMin / lfMax : 1;
  checks.push({ name: '6.4 No fog (LF retention)', pass: lfRetention >= 0.3,
    reason: `LF min/max = ${(lfRetention * 100).toFixed(1)}% (threshold: ≥30%)` });

  // 6.5: HF/LF ratio correlates with eccentricity
  const ringDistances = populated.map((_, i) => i);
  const hfLfValues = populated.map(r => r.hfLfRatio);
  const spearman = spearmanCorrelation(ringDistances, hfLfValues);
  checks.push({ name: '6.5 HF/LF-ecc correlation', pass: spearman < -0.7,
    reason: `Spearman ρ = ${spearman.toFixed(3)} (threshold: ρ < -0.7)` });

  // 6.6: FC predicts HF/LF drop
  const fcRings = populated.filter(r => r.fc > 0.001);
  if (fcRings.length >= 3) {
    const fcValues = fcRings.map(r => r.fc);
    const hfLfDrops = fcRings.map(r => results[0].hfLfRatio > 0 ? 1 - r.hfLfRatio / results[0].hfLfRatio : 0);
    const fcCorr = spearmanCorrelation(fcValues, hfLfDrops);
    checks.push({ name: '6.6 FC→HF/LF correlation', pass: fcCorr > 0.3,
      reason: `Spearman ρ = ${fcCorr.toFixed(3)} (threshold: ρ > 0.3)` });
  }

  // Ratio checks (only if unfiltered reference provided)
  if (hasRef) {
    const fovealRatio = results[0].seRatio || 0;
    checks.push({ name: '6.2 Foveal SE preserved', pass: fovealRatio >= 0.9,
      reason: `ratio = ${(fovealRatio * 100).toFixed(1)}% (threshold: ≥90%)` });

    const farRatio = results[results.length - 1].seRatio || 0;
    checks.push({ name: '6.3 Far-periph reduced', pass: farRatio <= 0.3,
      reason: `ratio = ${(farRatio * 100).toFixed(1)}% (threshold: ≤30%)` });
  }

  // Report
  let failures = 0;
  for (const c of checks) {
    const icon = c.pass ? '✓' : '✗';
    console.log(`  ${icon} ${c.name}: ${c.reason}`);
    if (!c.pass) failures++;
  }

  // Save results
  const resultsPath = path.join(__dirname, '..', 'tests', 'validation', 'subband-entropy-curve.json');
  const resultsDir = path.dirname(resultsPath);
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  fs.writeFileSync(resultsPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    filtered: path.basename(filteredPath),
    unfiltered: unfilteredPath ? path.basename(unfilteredPath) : null,
    fixation: { x: fixX, y: fixY },
    foveaRadius,
    pyramidLevels: PYRAMID_LEVELS,
    rings: results,
    checks,
  }, null, 2));
  console.log(`\nResults saved to: ${resultsPath}`);

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${checks.length - failures}/${checks.length} checks passed.`);
  process.exit(failures > 0 ? 1 : 0);
}

// ── Spearman rank correlation ──

function spearmanCorrelation(x, y) {
  if (x.length !== y.length || x.length < 3) return 0;
  const n = x.length;
  const rankX = toRanks(x);
  const rankY = toRanks(y);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) {
    const d = rankX[i] - rankY[i];
    sumD2 += d * d;
  }
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

function toRanks(arr) {
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  for (let i = 0; i < indexed.length; i++) {
    ranks[indexed[i].i] = i + 1;
  }
  return ranks;
}

main();
