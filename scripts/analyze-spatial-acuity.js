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

// ── Measure RMS contrast along a horizontal stripe through a ring ──
// Sample a band of pixels through the ring center (right side, along horizontal axis)
// and compute RMS contrast of the luminance profile.
function measureRingContrast(png, ringIndex, dpr) {
  const cx = png.width / 2;
  const cy = png.height / 2;
  const innerCSS = RINGS[ringIndex];
  const outerCSS = innerCSS + BAND_WIDTH;
  const innerPx = innerCSS * dpr;
  const outerPx = outerCSS * dpr;
  const bandCenterPx = (innerPx + outerPx) / 2;
  const halfBandPx = (outerPx - innerPx) / 4; // sample middle half of band

  // Sample horizontal line through band center on the RIGHT side
  const y = Math.round(cy);
  const xStart = Math.round(cx + bandCenterPx - halfBandPx);
  const xEnd = Math.round(cx + bandCenterPx + halfBandPx);

  const luminances = [];
  for (let x = xStart; x <= xEnd; x++) {
    if (x < 0 || x >= png.width) continue;
    const idx = (y * png.width + x) * 4;
    // Relative luminance (approximate)
    const lum = 0.2126 * png.data[idx] + 0.7152 * png.data[idx + 1] + 0.0722 * png.data[idx + 2];
    luminances.push(lum);
  }

  if (luminances.length < 4) return { rms: 0, mean: BG_GRAY, samples: 0 };

  const mean = luminances.reduce((a, b) => a + b, 0) / luminances.length;
  const rms = Math.sqrt(luminances.reduce((s, l) => s + (l - mean) ** 2, 0) / luminances.length);

  // Michelson contrast approximation: RMS / mean
  const contrast = mean > 0 ? rms / mean : 0;

  return {
    rms: Math.round(rms * 100000) / 100000,
    mean: Math.round(mean * 100) / 100,
    contrast: Math.round(contrast * 100000) / 100000,
    samples: luminances.length,
  };
}

// ── Measure foveal reference (center of image) ──
function measureFovealContrast(png, dpr) {
  const cx = png.width / 2;
  const cy = png.height / 2;
  const halfBandPx = (BAND_WIDTH / 2) * dpr * 0.5; // middle half of foveal patch

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

  if (luminances.length < 4) return { rms: 0, mean: BG_GRAY, samples: 0 };

  const mean = luminances.reduce((a, b) => a + b, 0) / luminances.length;
  const rms = Math.sqrt(luminances.reduce((s, l) => s + (l - mean) ** 2, 0) / luminances.length);
  const contrast = mean > 0 ? rms / mean : 0;

  return {
    rms: Math.round(rms * 100000) / 100000,
    mean: Math.round(mean * 100) / 100,
    contrast: Math.round(contrast * 100000) / 100000,
    samples: luminances.length,
  };
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
      : (ri) => measureRingContrast(png, ri, dpr);

    // Foveal reference
    const foveal = isChromatic
      ? { rms: 0, mean: 0, contrast: 0, samples: 0 } // TODO: chromatic foveal
      : measureFovealContrast(png, dpr);

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

  // Compute retention: ring contrast / foveal contrast (per file group)
  const groups = {};
  for (const r of results) {
    const key = `${r.chromatic}_${r.freq_cpd}_${r.condition}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }

  for (const entries of Object.values(groups)) {
    const foveal = entries.find(e => e.ring === 0);
    if (!foveal || foveal.contrast === 0) continue;
    for (const e of entries) {
      e.retention = Math.round((e.contrast / foveal.contrast) * 100000) / 100000;
    }
  }

  if (hasFlag('json')) {
    console.log(JSON.stringify({ screenshots_analyzed: pngFiles.length, measurements: results }, null, 2));
  } else {
    console.log(`Analyzed ${pngFiles.length} screenshots from ${DIR}\n`);
    for (const [key, entries] of Object.entries(groups)) {
      console.log(`--- ${key} ---`);
      for (const e of entries.sort((a, b) => a.ring - b.ring)) {
        const ret = e.retention !== undefined ? `retention=${(e.retention * 100).toFixed(1)}%` : '';
        console.log(`  ${e.label.padEnd(12)} (${String(e.dist_px).padStart(3)}px): contrast=${e.contrast.toFixed(5)}  rms=${e.rms.toFixed(2)}  ${ret}`);
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
