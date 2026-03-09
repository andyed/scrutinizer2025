#!/usr/bin/env node
/**
 * Analyze Gaussian blur vs DoG comparison captures.
 *
 * Key metric: cross-frequency discrimination slope.
 * At each eccentricity ring, fits log(retention) vs log(frequency).
 *   - Steep negative slope → frequency-selective (DoG)
 *   - Flat slope → uniform degradation (Gaussian)
 *
 * Supports E2 sweep: captures with _e2{val} suffix are grouped by E2.
 *
 * Usage:
 *   node scripts/analyze-gaussian-comparison.js
 *   node scripts/analyze-gaussian-comparison.js --json
 */

const path = require('path');
const fs = require('fs');
const { PNG } = require('pngjs');

const args = process.argv.slice(2);
function getArg(name, def) {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}
const hasFlag = (name) => args.includes(`--${name}`);

const DIR = getArg('dir', path.join(__dirname, '..', 'tests', 'golden-captures', 'validation', 'gaussian-comparison'));

// Ring geometry matches capture-spatial-acuity.js
const RINGS = [100, 200, 300, 420, 560];
const BAND_WIDTH = 60;
const CSS_WIDTH = parseInt(getArg('css-width', '1920'));
const BG_GRAY = 128;

const FOVEA_RADIUS = 90;
const FOVEA_DEG = 2.0;
const PPD = FOVEA_RADIUS / FOVEA_DEG;

// ── Parse filename: achromatic_{freq}cpd_{dog|gaussian|baseline}[_e2{val}].png ──
function parseFilename(name) {
  const m = name.match(/^achromatic_([\d.]+)cpd_(dog|gaussian|baseline)(?:_e2([\d.]+))?\.png$/);
  if (!m) return null;
  return { freq: parseFloat(m[1]), condition: m[2], e2: m[3] ? parseFloat(m[3]) : null };
}

// ── DFT matched-filter amplitude at target frequency ──
function measureGratingAmplitude(luminances, freq_cpd, dpr) {
  const N = luminances.length;
  if (N < 4) return { amplitude: 0, rms: 0, mean: BG_GRAY, contrast: 0, samples: 0 };

  const mean = luminances.reduce((a, b) => a + b, 0) / N;
  const freq_px = freq_cpd / (PPD * dpr);

  let cosSum = 0, sinSum = 0;
  for (let i = 0; i < N; i++) {
    const phase = 2 * Math.PI * freq_px * i;
    cosSum += (luminances[i] - mean) * Math.cos(phase);
    sinSum += (luminances[i] - mean) * Math.sin(phase);
  }
  const amplitude = 2 * Math.sqrt(cosSum * cosSum + sinSum * sinSum) / N;
  const rms = Math.sqrt(luminances.reduce((s, l) => s + (l - mean) ** 2, 0) / N);
  const contrast = mean > 0 ? amplitude / mean : 0;

  return {
    amplitude: Math.round(amplitude * 100000) / 100000,
    rms: Math.round(rms * 100000) / 100000,
    mean: Math.round(mean * 100) / 100,
    contrast: Math.round(contrast * 100000) / 100000,
    samples: N,
  };
}

// ── Sample luminances along horizontal band through a ring ──
function sampleRingLuminances(png, ringIndex, dpr) {
  const cx = png.width / 2;
  const cy = png.height / 2;
  const innerPx = RINGS[ringIndex] * dpr;
  const outerPx = (RINGS[ringIndex] + BAND_WIDTH) * dpr;
  const bandCenterPx = (innerPx + outerPx) / 2;
  const halfBandPx = (outerPx - innerPx) / 4;

  const y = Math.round(cy);
  const xStart = Math.round(cx + bandCenterPx - halfBandPx);
  const xEnd = Math.round(cx + bandCenterPx + halfBandPx);

  const luminances = [];
  for (let x = xStart; x <= xEnd; x++) {
    if (x < 0 || x >= png.width) continue;
    const idx = (y * png.width + x) * 4;
    const lum = 0.2126 * png.data[idx] + 0.7152 * png.data[idx + 1] + 0.0722 * png.data[idx + 2];
    luminances.push(lum);
  }
  return luminances;
}

// ── Sample foveal luminances ──
function sampleFovealLuminances(png, dpr) {
  const cx = png.width / 2;
  const cy = png.height / 2;
  const halfBandPx = (BAND_WIDTH / 2) * dpr * 0.5;

  const y = Math.round(cy);
  const xStart = Math.round(cx - halfBandPx);
  const xEnd = Math.round(cx + halfBandPx);

  const luminances = [];
  for (let x = xStart; x <= xEnd; x++) {
    if (x < 0 || x >= png.width) continue;
    const idx = (y * png.width + x) * 4;
    const lum = 0.2126 * png.data[idx] + 0.7152 * png.data[idx + 1] + 0.0722 * png.data[idx + 2];
    luminances.push(lum);
  }
  return luminances;
}

// ── Least-squares linear regression ──
function linearRegression(xs, ys) {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };

  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;

  let ssxx = 0, ssxy = 0, ssyy = 0;
  for (let i = 0; i < n; i++) {
    ssxx += (xs[i] - mx) ** 2;
    ssxy += (xs[i] - mx) * (ys[i] - my);
    ssyy += (ys[i] - my) ** 2;
  }

  const slope = ssxx > 0 ? ssxy / ssxx : 0;
  const intercept = my - slope * mx;
  const r2 = (ssxx > 0 && ssyy > 0) ? (ssxy * ssxy) / (ssxx * ssyy) : 0;

  return { slope: Math.round(slope * 10000) / 10000, intercept: Math.round(intercept * 10000) / 10000, r2: Math.round(r2 * 10000) / 10000 };
}

// ── Main ──
function analyze() {
  if (!fs.existsSync(DIR)) {
    console.error(`Directory not found: ${DIR}`);
    console.error('Run capture-gaussian-comparison.js first.');
    process.exit(1);
  }

  const pngFiles = fs.readdirSync(DIR).filter(f => f.endsWith('.png'));
  if (pngFiles.length === 0) {
    console.error(`No PNG files found in ${DIR}`);
    process.exit(1);
  }

  // Measure all ring contrasts
  const measurements = [];

  for (const file of pngFiles) {
    const parsed = parseFilename(file);
    if (!parsed) {
      if (!file.endsWith('.json')) console.warn(`Skipping unrecognized filename: ${file}`);
      continue;
    }

    const pngData = fs.readFileSync(path.join(DIR, file));
    const png = PNG.sync.read(pngData);
    const dpr = png.width / CSS_WIDTH;

    // Foveal reference
    const fovealLums = sampleFovealLuminances(png, dpr);
    const foveal = measureGratingAmplitude(fovealLums, parsed.freq, dpr);

    measurements.push({
      file, freq: parsed.freq, condition: parsed.condition, e2: parsed.e2,
      ring: 0, dist_px: 0, ecc_deg: 0, ...foveal,
    });

    for (let r = 0; r < RINGS.length; r++) {
      const lums = sampleRingLuminances(png, r, dpr);
      const meas = measureGratingAmplitude(lums, parsed.freq, dpr);
      const ecc_deg = (RINGS[r] + BAND_WIDTH / 2) / PPD;
      measurements.push({
        file, freq: parsed.freq, condition: parsed.condition, e2: parsed.e2,
        ring: r + 1, dist_px: RINGS[r], ecc_deg: Math.round(ecc_deg * 10) / 10,
        ...meas,
      });
    }
  }

  // Compute retention relative to baseline at same freq + ring
  const baselineMap = {};
  for (const m of measurements) {
    if (m.condition === 'baseline') {
      baselineMap[`${m.freq}_${m.ring}`] = m.contrast;
    }
  }
  for (const m of measurements) {
    const baseContrast = baselineMap[`${m.freq}_${m.ring}`];
    m.retention = (baseContrast && baseContrast > 0)
      ? Math.round((m.contrast / baseContrast) * 100000) / 100000
      : null;
  }

  // Group by E2 value for analysis
  const e2Values = [...new Set(measurements.map(m => m.e2))].sort((a, b) => (a ?? -1) - (b ?? -1));

  // Cross-frequency discrimination slope per E2, condition, ring
  const slopeResults = [];
  for (const e2 of e2Values) {
    for (const condition of ['dog', 'gaussian']) {
      const condLabel = e2 !== null ? `${condition}_e2${e2}` : condition;
      for (let r = 1; r <= RINGS.length; r++) {
        const ringMeas = measurements.filter(m =>
          m.condition === condition && m.e2 === e2 && m.ring === r &&
          m.retention !== null && m.retention > 0
        );
        if (ringMeas.length < 2) continue;

        const logFreqs = ringMeas.map(m => Math.log(m.freq));
        const logRets = ringMeas.map(m => Math.log(m.retention));
        const reg = linearRegression(logFreqs, logRets);

        const ecc_deg = ringMeas[0].ecc_deg;
        const lowFreqRet = ringMeas.find(m => m.freq === 0.25)?.retention;

        slopeResults.push({
          e2, condition, condLabel, ring: r, ecc_deg,
          slope: reg.slope, r2: reg.r2,
          low_freq_ret: lowFreqRet ? Math.round(lowFreqRet * 1000) / 1000 : null,
          n_freqs: ringMeas.length,
        });
      }
    }
  }

  if (hasFlag('json')) {
    console.log(JSON.stringify({
      screenshots_analyzed: pngFiles.length,
      measurements,
      slope_analysis: slopeResults,
    }, null, 2));
    return;
  }

  // Table output
  console.log(`Analyzed ${pngFiles.length} screenshots from ${DIR}\n`);

  // Slope comparison table per E2
  for (const e2 of e2Values) {
    const label = e2 !== null ? `E2=${e2}` : 'mode default';
    console.log(`=== SLOPE COMPARISON (${label}) ===`);
    console.log(`  ${'Ring'.padEnd(6)} ${'Ecc(°)'.padStart(7)}  ${'DoG_slope'.padStart(10)} ${'Gauss_slope'.padStart(12)} ${'Δslope'.padStart(8)}  ${'DoG_0.25ret'.padStart(11)} ${'Gauss_0.25ret'.padStart(13)}`);

    for (let r = 1; r <= RINGS.length; r++) {
      const dogSlope = slopeResults.find(s => s.condition === 'dog' && s.e2 === e2 && s.ring === r);
      const gaussSlope = slopeResults.find(s => s.condition === 'gaussian' && s.e2 === e2 && s.ring === r);
      if (!dogSlope && !gaussSlope) continue;

      const ecc = dogSlope?.ecc_deg || gaussSlope?.ecc_deg || 0;
      const ds = dogSlope?.slope ?? NaN;
      const gs = gaussSlope?.slope ?? NaN;
      const delta = isFinite(ds) && isFinite(gs) ? ds - gs : NaN;
      const dogLow = dogSlope?.low_freq_ret;
      const gaussLow = gaussSlope?.low_freq_ret;

      console.log(`  ${(`ring_${r}`).padEnd(6)} ${String(ecc).padStart(7)}  ${(isFinite(ds) ? ds.toFixed(4) : '---').padStart(10)} ${(isFinite(gs) ? gs.toFixed(4) : '---').padStart(12)} ${(isFinite(delta) ? delta.toFixed(4) : '---').padStart(8)}  ${(dogLow !== null ? (dogLow * 100).toFixed(1) + '%' : '---').padStart(11)} ${(gaussLow !== null ? (gaussLow * 100).toFixed(1) + '%' : '---').padStart(13)}`);
    }
    console.log();
  }

  // Summary: mean |Δslope| per E2
  if (e2Values.length > 1) {
    console.log(`=== E2 SWEEP SUMMARY ===`);
    console.log(`  ${'E2'.padEnd(6)} ${'mean|Δslope|'.padStart(13)} ${'max|Δslope|'.padStart(12)} ${'ring_of_max'.padStart(11)}`);
    for (const e2 of e2Values) {
      if (e2 === null) continue;
      const deltas = [];
      for (let r = 1; r <= RINGS.length; r++) {
        const ds = slopeResults.find(s => s.condition === 'dog' && s.e2 === e2 && s.ring === r)?.slope;
        const gs = slopeResults.find(s => s.condition === 'gaussian' && s.e2 === e2 && s.ring === r)?.slope;
        if (ds !== undefined && gs !== undefined) deltas.push({ ring: r, delta: ds - gs });
      }
      if (deltas.length === 0) continue;
      const absDelta = deltas.map(d => Math.abs(d.delta));
      const meanDelta = absDelta.reduce((a, b) => a + b, 0) / absDelta.length;
      const maxIdx = absDelta.indexOf(Math.max(...absDelta));
      console.log(`  ${String(e2).padEnd(6)} ${meanDelta.toFixed(4).padStart(13)} ${absDelta[maxIdx].toFixed(4).padStart(12)} ${(`ring_${deltas[maxIdx].ring}`).padStart(11)}`);
    }
  }

  console.log(`\nInterpretation:`);
  console.log(`  Δslope < 0 → DoG is MORE frequency-selective (steeper negative slope)`);
  console.log(`  Δslope ≈ 0 → both degrade similarly across frequencies`);
  console.log(`  Larger |Δslope| at higher E2 → band separation emerges when bands survive to measurement rings`);
}

try {
  analyze();
} catch (err) {
  console.error(err);
  process.exit(1);
}
