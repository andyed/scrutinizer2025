#!/usr/bin/env node
/**
 * Analyze spatial-acuity screenshots for Wave 2 validation.
 *
 * Reads PNG screenshots, measures RMS contrast of grating patterns
 * at each ring annulus, and computes contrast retention curves.
 *
 * Usage:
 *   node scripts/analyze-spatial-acuity.js
 *   node scripts/analyze-spatial-acuity.js --json
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

const DIR = getArg('dir', path.join(__dirname, '..', 'tests', 'golden-captures', 'validation', 'spatial-acuity'));

const RINGS = [100, 200, 300, 420, 560];
const BAND_WIDTH = 60;
const CSS_WIDTH = parseInt(getArg('css-width', '1920'));
const BG_GRAY = 128;

// ── Parse filename: chromatic_freqcpd_condition.png ──
function parseFilename(name) {
  const m = name.match(/^(\w+)_([\d.]+)cpd_(filtered|baseline)\.png$/);
  if (!m) return null;
  return { chromatic: m[1], freq: parseFloat(m[2]), condition: m[3] };
}

// ── Constants for analysis ──
const FOVEA_RADIUS = 90;
const FOVEA_DEG = 2.0;
const PPD = FOVEA_RADIUS / FOVEA_DEG;

// ── Frequency-specific contrast via matched filter (DFT at target freq) ──
// Measures the amplitude of the grating signal at the expected frequency,
// ignoring noise at other frequencies (unlike RMS which captures all noise).
function measureGratingAmplitude(luminances, freq_cpd, dpr) {
  const N = luminances.length;
  if (N < 4) return { amplitude: 0, rms: 0, mean: BG_GRAY, samples: 0 };

  const mean = luminances.reduce((a, b) => a + b, 0) / N;

  // Grating frequency in pixels (at current DPR)
  const freq_px = freq_cpd / (PPD * dpr); // cycles per pixel in screenshot

  // Matched filter: compute DFT amplitude at target frequency
  let cosSum = 0, sinSum = 0;
  for (let i = 0; i < N; i++) {
    const phase = 2 * Math.PI * freq_px * i;
    cosSum += (luminances[i] - mean) * Math.cos(phase);
    sinSum += (luminances[i] - mean) * Math.sin(phase);
  }
  const amplitude = 2 * Math.sqrt(cosSum * cosSum + sinSum * sinSum) / N;

  // Also compute total RMS for comparison
  const rms = Math.sqrt(luminances.reduce((s, l) => s + (l - mean) ** 2, 0) / N);

  // Michelson contrast from amplitude: amplitude / mean
  const contrast = mean > 0 ? amplitude / mean : 0;

  return {
    amplitude: Math.round(amplitude * 100000) / 100000,
    rms: Math.round(rms * 100000) / 100000,
    mean: Math.round(mean * 100) / 100,
    contrast: Math.round(contrast * 100000) / 100000,
    samples: N,
  };
}

// ── Sample luminances along a horizontal line through a ring ──
function sampleRingLuminances(png, ringIndex, dpr) {
  const cx = png.width / 2;
  const cy = png.height / 2;
  const innerCSS = RINGS[ringIndex];
  const outerCSS = innerCSS + BAND_WIDTH;
  const innerPx = innerCSS * dpr;
  const outerPx = outerCSS * dpr;
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

function measureRingContrast(png, ringIndex, dpr, freq_cpd) {
  const luminances = sampleRingLuminances(png, ringIndex, dpr);
  return measureGratingAmplitude(luminances, freq_cpd, dpr);
}

function measureFovealContrast(png, dpr, freq_cpd) {
  const luminances = sampleFovealLuminances(png, dpr);
  return measureGratingAmplitude(luminances, freq_cpd, dpr);
}

// ── For chromatic gratings, measure chroma contrast instead ──
function measureRingChromaContrast(png, ringIndex, dpr, channel) {
  const cx = png.width / 2;
  const cy = png.height / 2;
  const innerCSS = RINGS[ringIndex];
  const outerCSS = innerCSS + BAND_WIDTH;
  const innerPx = innerCSS * dpr;
  const outerPx = outerCSS * dpr;
  const bandCenterPx = (innerPx + outerPx) / 2;
  const halfBandPx = (outerPx - innerPx) / 4;

  const y = Math.round(cy);
  const xStart = Math.round(cx + bandCenterPx - halfBandPx);
  const xEnd = Math.round(cx + bandCenterPx + halfBandPx);

  const values = [];
  for (let x = xStart; x <= xEnd; x++) {
    if (x < 0 || x >= png.width) continue;
    const idx = (y * png.width + x) * 4;
    const r = png.data[idx], g = png.data[idx + 1], b = png.data[idx + 2];
    // Channel difference as proxy for chromatic contrast
    if (channel === 'rg') values.push(r - g);
    else if (channel === 'by') values.push(b - (r + g) / 2);
  }

  if (values.length < 4) return { rms: 0, mean: 0, contrast: 0, samples: 0 };

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const rms = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);

  return {
    rms: Math.round(rms * 100000) / 100000,
    mean: Math.round(mean * 100) / 100,
    contrast: Math.round(rms * 100000) / 100000, // use RMS directly for chromatic
    samples: values.length,
  };
}

// ── Main ──
function analyze() {
  if (!fs.existsSync(DIR)) {
    console.error(`Directory not found: ${DIR}`);
    console.error('Run capture-spatial-acuity.js first.');
    process.exit(1);
  }

  const pngFiles = fs.readdirSync(DIR).filter(f => f.endsWith('.png'));
  if (pngFiles.length === 0) {
    console.error(`No PNG files found in ${DIR}`);
    process.exit(1);
  }

  const results = [];

  for (const file of pngFiles) {
    const parsed = parseFilename(file);
    if (!parsed) {
      console.warn(`Skipping unrecognized filename: ${file}`);
      continue;
    }

    const pngData = fs.readFileSync(path.join(DIR, file));
    const png = PNG.sync.read(pngData);
    const dpr = png.width / CSS_WIDTH;

    const isChromatic = parsed.chromatic !== 'achromatic';
    const measureFn = isChromatic
      ? (ri) => measureRingChromaContrast(png, ri, dpr, parsed.chromatic)
      : (ri) => measureRingContrast(png, ri, dpr, parsed.freq);

    // Foveal reference
    const foveal = isChromatic
      ? { rms: 0, mean: 0, contrast: 0, amplitude: 0, samples: 0 }
      : measureFovealContrast(png, dpr, parsed.freq);

    results.push({
      file,
      chromatic: parsed.chromatic,
      freq_cpd: parsed.freq,
      condition: parsed.condition,
      ring: 0,
      dist_px: 0,
      label: 'foveal_ref',
      ...foveal,
    });

    // Each ring
    for (let r = 0; r < RINGS.length; r++) {
      const meas = measureFn(r);
      results.push({
        file,
        chromatic: parsed.chromatic,
        freq_cpd: parsed.freq,
        condition: parsed.condition,
        ring: r + 1,
        dist_px: RINGS[r],
        label: `ring_${r + 1}`,
        ...meas,
      });
    }
  }

  // Compute retention two ways:
  // 1. Within-condition: ring contrast / foveal contrast (same screenshot)
  // 2. Cross-condition: filtered ring / baseline ring (paired comparison)
  const groups = {};
  for (const r of results) {
    const key = `${r.chromatic}_${r.freq_cpd}_${r.condition}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }

  // Within-condition retention (foveal-relative)
  for (const entries of Object.values(groups)) {
    const foveal = entries.find(e => e.ring === 0);
    if (!foveal || foveal.contrast === 0) continue;
    for (const e of entries) {
      e.retention = Math.round((e.contrast / foveal.contrast) * 100000) / 100000;
    }
  }

  // Cross-condition retention (filtered / baseline per ring)
  const crossGroups = {};
  for (const r of results) {
    const key = `${r.chromatic}_${r.freq_cpd}`;
    if (!crossGroups[key]) crossGroups[key] = [];
    crossGroups[key].push(r);
  }
  for (const entries of Object.values(crossGroups)) {
    const filtered = entries.filter(e => e.condition === 'filtered');
    const baseline = entries.filter(e => e.condition === 'baseline');
    for (const f of filtered) {
      const b = baseline.find(e => e.ring === f.ring);
      if (b && b.contrast > 0) {
        f.cross_retention = Math.round((f.contrast / b.contrast) * 100000) / 100000;
      }
    }
  }

  if (hasFlag('json')) {
    console.log(JSON.stringify({ screenshots_analyzed: pngFiles.length, measurements: results }, null, 2));
  } else {
    console.log(`Analyzed ${pngFiles.length} screenshots from ${DIR}\n`);
    for (const [key, entries] of Object.entries(groups)) {
      console.log(`--- ${key} ---`);
      for (const e of entries.sort((a, b) => a.ring - b.ring)) {
        const ret = e.retention !== undefined ? `fov_ret=${(e.retention * 100).toFixed(1)}%` : '';
        const xret = e.cross_retention !== undefined ? `filt/base=${(e.cross_retention * 100).toFixed(1)}%` : '';
        console.log(`  ${e.label.padEnd(12)} (${String(e.dist_px).padStart(3)}px): contrast=${e.contrast.toFixed(5)}  ${ret}  ${xret}`);
      }
      console.log();
    }
  }
}

try {
  analyze();
} catch (err) {
  console.error(err);
  process.exit(1);
}
