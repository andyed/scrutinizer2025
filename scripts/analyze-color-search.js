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
const DOTS_PER_RING = 8;

// ── Seeded PRNG (mulberry32, same as color-search.html) ──
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

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

// ── Reconstruct dot positions (same logic as color-search.html static mode) ──
function getDotPositions(viewportW, viewportH) {
  const rng = mulberry32(SEED);
  const cx = viewportW / 2;
  const cy = viewportH / 2;
  const positions = [];

  for (let r = 0; r < RINGS.length; r++) {
    const radius = RINGS[r];
    const targetAngle = Math.floor(rng() * DOTS_PER_RING);

    for (let a = 0; a < DOTS_PER_RING; a++) {
      const baseAngle = (a / DOTS_PER_RING) * Math.PI * 2;
      const jitter = (rng() - 0.5) * 0.15;
      const angle = baseAngle + jitter;

      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      const isTarget = (a === targetAngle);

      positions.push({ ring: r, x: Math.round(x), y: Math.round(y), isTarget });
    }
  }
  return positions;
}

// ── Sample a 5x5 patch around a pixel from PNG data, return average Oklab ──
function samplePatch(png, x, y) {
  const radius = 2; // 5x5 patch
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

    const dots = getDotPositions(png.width, png.height);

    // Per ring: sample target and distractors, compute delta-C
    for (let r = 0; r < RINGS.length; r++) {
      const ringDots = dots.filter(d => d.ring === r);
      const target = ringDots.find(d => d.isTarget);
      const distractors = ringDots.filter(d => !d.isTarget);

      if (!target) continue;

      const targetOk = samplePatch(png, target.x, target.y);
      const targetChroma = chroma(targetOk);

      // Average distractor chroma
      let distSum = { L: 0, a: 0, b: 0 };
      for (const d of distractors) {
        const ok = samplePatch(png, d.x, d.y);
        distSum.L += ok.L; distSum.a += ok.a; distSum.b += ok.b;
      }
      const distAvg = {
        L: distSum.L / distractors.length,
        a: distSum.a / distractors.length,
        b: distSum.b / distractors.length,
      };
      const distChroma = chroma(distAvg);

      // Delta-C: chroma difference between target and average distractor
      const deltaA = targetOk.a - distAvg.a;
      const deltaB = targetOk.b - distAvg.b;
      const deltaC = Math.sqrt(deltaA * deltaA + deltaB * deltaB);

      results.push({
        file,
        color: parsed.color,
        size_px: parsed.size,
        condition: parsed.condition,
        ring: r + 1,
        dist_px: RINGS[r],
        target_L: Math.round(targetOk.L * 1000) / 1000,
        target_a: Math.round(targetOk.a * 1000) / 1000,
        target_b: Math.round(targetOk.b * 1000) / 1000,
        target_chroma: Math.round(targetChroma * 1000) / 1000,
        distractor_L: Math.round(distAvg.L * 1000) / 1000,
        distractor_a: Math.round(distAvg.a * 1000) / 1000,
        distractor_b: Math.round(distAvg.b * 1000) / 1000,
        distractor_chroma: Math.round(distChroma * 1000) / 1000,
        delta_C: Math.round(deltaC * 10000) / 10000,
      });
    }
  }

  // Compute retention: delta_C at ring N / delta_C at ring 1 (per color/size/condition)
  const groups = {};
  for (const r of results) {
    const key = `${r.color}_${r.size_px}_${r.condition}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }

  for (const entries of Object.values(groups)) {
    const ring1 = entries.find(e => e.ring === 1);
    if (!ring1 || ring1.delta_C === 0) continue;
    for (const e of entries) {
      e.retention = Math.round((e.delta_C / ring1.delta_C) * 10000) / 10000;
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
        console.log(`  Ring ${e.ring} (${e.dist_px}px): delta_C=${e.delta_C.toFixed(4)}  ${ret}`);
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
