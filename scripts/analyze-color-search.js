#!/usr/bin/env node
/**
 * Analyze color-search screenshots for chromatic retention validation.
 *
 * Reads PNG screenshots captured through Scrutinizer's chromatic pooling,
 * samples pixels at known target/distractor locations per ring, converts
 * to Oklab, and computes delta-C (chroma difference) retention curves.
 *
 * Usage:
 *   node scripts/analyze-color-search.js --dir=tests/golden-captures/validation/color-search
 *   node scripts/analyze-color-search.js --dir=... --json
 *
 * Expects filenames like: red_24px_filtered.png, blue_32px_baseline.png
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

const DIR = getArg('dir', path.join(__dirname, '..', 'tests', 'golden-captures', 'validation', 'color-search'));
const SEED = 42; // Must match color-search.html default seed

// ── Ring geometry (must match color-search.html) ──
const RINGS = [100, 200, 300, 420, 560];
const BAND_WIDTH = 60; // px CSS — must match color-search.html

// ── sRGB → Oklab conversion ──
function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function rgbToOklab(r, g, b) {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}

function chroma(ok) {
  return Math.sqrt(ok.a * ok.a + ok.b * ok.b);
}

// ── Band sampling positions ──
// Bands mode renders concentric color annuli at each ring distance.
// Sample at the band center along the RIGHT horizontal axis (angle=0)
// where the band is cleanest (no corner effects). Also sample the
// foveal reference patch at center and the background between rings.
const CSS_WIDTH = parseInt(getArg('css-width', '1920'));

function getBandSamplePositions(pixelW, pixelH) {
  const dpr = pixelW / CSS_WIDTH;
  // Page center is window.innerWidth/2, window.innerHeight/2
  const cssCx = pixelW / 2;
  const cssCy = pixelH / 2;
  const halfBand = BAND_WIDTH / 2; // CSS px
  const positions = [];

  // Foveal reference patch (at center, should be unaffected by decay)
  positions.push({
    ring: 0,
    label: 'foveal_ref',
    x: Math.round(cssCx),
    y: Math.round(cssCy),
    isTarget: true,
  });

  // Sample each ring band along the RIGHT horizontal axis.
  // CSS border extends OUTWARD from the ring radius, so band center
  // is at RINGS[r] + BAND_WIDTH/2 from the page center.
  // Also sample at 4 cardinal directions to average out any asymmetry.
  for (let r = 0; r < RINGS.length; r++) {
    const bandCenterCSS = RINGS[r] + halfBand; // center of the 60px band
    const bandCenterPx = bandCenterCSS * dpr;
    positions.push({
      ring: r + 1,
      label: `ring_${r + 1}`,
      x: Math.round(cssCx + bandCenterPx), // right
      y: Math.round(cssCy),
      isTarget: true,
    });
  }

  // Background sample points (midway between bands)
  for (let r = 0; r < RINGS.length; r++) {
    const outerEdge = RINGS[r] + BAND_WIDTH;
    const nextInner = r < RINGS.length - 1 ? RINGS[r + 1] : outerEdge + 100;
    const bgCSS = (outerEdge + nextInner) / 2;
    positions.push({
      ring: r + 1,
      label: `bg_${r + 1}`,
      x: Math.round(cssCx + bgCSS * dpr),
      y: Math.round(cssCy),
      isTarget: false,
    });
  }

  return positions;
}

// ── Sample a 5x5 patch around a pixel from PNG data, return average Oklab ──
function samplePatch(png, x, y) {
  const radius = 8; // 17x17 patch — large enough to average over blur artifacts at 2x DPR
  const x0 = Math.max(0, x - radius);
  const y0 = Math.max(0, y - radius);
  const x1 = Math.min(png.width - 1, x + radius);
  const y1 = Math.min(png.height - 1, y + radius);

  let sumL = 0, sumA = 0, sumB = 0, count = 0;

  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const idx = (py * png.width + px) * 4;
      const ok = rgbToOklab(png.data[idx], png.data[idx + 1], png.data[idx + 2]);
      sumL += ok.L; sumA += ok.a; sumB += ok.b;
      count++;
    }
  }

  return { L: sumL / count, a: sumA / count, b: sumB / count };
}

// ── Parse filename: color_sizepx_condition.png ──
function parseFilename(name) {
  const m = name.match(/^(\w+)_(\d+)px_(filtered|baseline)\.png$/);
  if (!m) return null;
  return { color: m[1], size: parseInt(m[2]), condition: m[3] };
}

// ── Main ──
function analyze() {
  if (!fs.existsSync(DIR)) {
    console.error(`Directory not found: ${DIR}`);
    console.error('Run capture-golden.js with color-search tasks first.');
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

    const samples = getBandSamplePositions(png.width, png.height);
    const bandSamples = samples.filter(s => s.isTarget);
    const bgSamples = samples.filter(s => !s.isTarget);

    // Sample each band and its nearest background
    for (const band of bandSamples) {
      const bandOk = samplePatch(png, band.x, band.y);
      const bandChroma = chroma(bandOk);

      // Find matching background sample for this ring
      const bg = bgSamples.find(b => b.ring === band.ring);
      let bgOk = { L: 0, a: 0, b: 0 };
      if (bg) bgOk = samplePatch(png, bg.x, bg.y);
      const bgChroma = chroma(bgOk);

      // Delta-C: chroma difference between band and background
      const deltaA = bandOk.a - bgOk.a;
      const deltaB = bandOk.b - bgOk.b;
      const deltaC = Math.sqrt(deltaA * deltaA + deltaB * deltaB);

      results.push({
        file,
        color: parsed.color,
        size_px: parsed.size,
        condition: parsed.condition,
        ring: band.ring,
        dist_px: band.ring === 0 ? 0 : RINGS[band.ring - 1],
        label: band.label,
        sample_x: band.x,
        sample_y: band.y,
        band_L: Math.round(bandOk.L * 100000) / 100000,
        band_a: Math.round(bandOk.a * 100000) / 100000,
        band_b: Math.round(bandOk.b * 100000) / 100000,
        band_chroma: Math.round(bandChroma * 100000) / 100000,
        bg_L: Math.round(bgOk.L * 100000) / 100000,
        bg_a: Math.round(bgOk.a * 100000) / 100000,
        bg_b: Math.round(bgOk.b * 100000) / 100000,
        delta_C: Math.round(deltaC * 100000) / 100000,
      });
    }
  }

  // Compute retention: band chroma at ring N / foveal reference chroma (per color/size/condition)
  const groups = {};
  for (const r of results) {
    const key = `${r.color}_${r.size_px}_${r.condition}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }

  for (const entries of Object.values(groups)) {
    const fovealRef = entries.find(e => e.ring === 0);
    if (!fovealRef || fovealRef.band_chroma === 0) continue;
    for (const e of entries) {
      e.retention = Math.round((e.band_chroma / fovealRef.band_chroma) * 100000) / 100000;
    }
  }

  if (hasFlag('json')) {
    console.log(JSON.stringify({ screenshots_analyzed: pngFiles.length, measurements: results }, null, 2));
  } else {
    // Human-readable summary
    console.log(`Analyzed ${pngFiles.length} screenshots from ${DIR}\n`);
    for (const [key, entries] of Object.entries(groups)) {
      console.log(`--- ${key} ---`);
      for (const e of entries.sort((a, b) => a.ring - b.ring)) {
        const ret = e.retention !== undefined ? `retention=${(e.retention * 100).toFixed(1)}%` : '';
        console.log(`  ${e.label.padEnd(12)} (${String(e.dist_px).padStart(3)}px): chroma=${e.band_chroma.toFixed(4)}  delta_C=${e.delta_C.toFixed(4)}  ${ret}`);
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
