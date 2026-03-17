#!/usr/bin/env node
/**
 * Artifact detection for smoke test captures.
 *
 * Checks rendered screenshots for known artifact patterns:
 * 1. Color shift — achromatic surfaces should stay achromatic
 * 2. Fog — peripheral regions should retain luminance contrast
 *
 * Usage:
 *   node scripts/analyze-artifacts.js --dir=tests/smoke-captures
 *   require('./analyze-artifacts').analyzeArtifacts(dir)  // from smoke script
 */

const path = require('path');
const fs = require('fs');
const { PNG } = require('pngjs');

// ── sRGB → Oklab ──
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

function samplePatch(png, cx, cy, radius) {
  const x0 = Math.max(0, cx - radius);
  const y0 = Math.max(0, cy - radius);
  const x1 = Math.min(png.width - 1, cx + radius);
  const y1 = Math.min(png.height - 1, cy + radius);
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

function patchStdDev(png, cx, cy, radius) {
  const x0 = Math.max(0, cx - radius);
  const y0 = Math.max(0, cy - radius);
  const x1 = Math.min(png.width - 1, cx + radius);
  const y1 = Math.min(png.height - 1, cy + radius);
  let sumL = 0, sumL2 = 0, count = 0;
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const idx = (py * png.width + px) * 4;
      const ok = rgbToOklab(png.data[idx], png.data[idx + 1], png.data[idx + 2]);
      sumL += ok.L; sumL2 += ok.L * ok.L;
      count++;
    }
  }
  const mean = sumL / count;
  return Math.sqrt(Math.max(0, sumL2 / count - mean * mean));
}

// ── Check 1: Color shift on achromatic surface ──
function checkColorShift(dir) {
  const file = path.join(dir, 'smoke_gray_chromatic.png');
  if (!fs.existsSync(file)) return { name: 'color-shift', pass: true, reason: 'skipped (no capture)' };

  const png = PNG.sync.read(fs.readFileSync(file));
  const cx = Math.round(png.width / 2);
  const cy = Math.round(png.height / 2);

  // Sample 9 points in a 3x3 grid at 100, 300, 500px from center
  const results = [];
  for (const dist of [100, 300, 500]) {
    for (const angle of [0, 2.094, 4.189]) { // 0°, 120°, 240°
      const x = Math.round(cx + dist * Math.cos(angle));
      const y = Math.round(cy + dist * Math.sin(angle));
      if (x < 0 || x >= png.width || y < 0 || y >= png.height) continue;
      const ok = samplePatch(png, x, y, 4);
      const chroma = Math.sqrt(ok.a * ok.a + ok.b * ok.b);
      results.push({ dist, chroma });
    }
  }

  const maxChroma = Math.max(...results.map(r => r.chroma));
  // 0.012 threshold: below perceptual threshold (~0.02 Oklab) but catches
  // gross BGRA swap errors. Known: slight blue bias (~0.009) from Oklab round-trip.
  const pass = maxChroma < 0.012;
  return {
    name: 'color-shift',
    pass,
    reason: pass
      ? `max chroma ${maxChroma.toFixed(4)} < 0.012`
      : `max chroma ${maxChroma.toFixed(4)} >= 0.012 (achromatic surface has color)`,
  };
}

// ── Check 2: Fog detection on dashboard ──
function checkFog(dir) {
  const file = path.join(dir, 'smoke_dashboard_mode0.png');
  if (!fs.existsSync(file)) return { name: 'fog', pass: true, reason: 'skipped (no capture)' };

  const png = PNG.sync.read(fs.readFileSync(file));
  const cx = Math.round(png.width / 2);
  const cy = Math.round(png.height / 2);

  // Sample luminance contrast at 8 points around fixation at 250-400px.
  // Use multiple angles to avoid hitting empty whitespace on any one axis.
  const contrasts = [];
  for (const dist of [250, 350]) {
    for (const angle of [0, 1.571, 3.142, 4.712]) { // 0°, 90°, 180°, 270°
      const x = Math.round(cx + dist * Math.cos(angle));
      const y = Math.round(cy + dist * Math.sin(angle));
      if (x < 16 || x >= png.width - 16 || y < 16 || y >= png.height - 16) continue;
      const stddev = patchStdDev(png, x, y, 16);
      contrasts.push({ dist, angle, stddev });
    }
  }

  // Use median contrast — some probe points may hit whitespace, which is valid.
  // Fog means ALL probe points lose texture, not just one.
  const sorted = contrasts.map(c => c.stddev).sort((a, b) => a - b);
  const medianContrast = sorted[Math.floor(sorted.length / 2)];
  // 0.003: catches genuine fog (all texture erased) but allows naturally
  // low-contrast content like light-background pages with faint text.
  const pass = medianContrast >= 0.003;
  return {
    name: 'fog',
    pass,
    reason: pass
      ? `median peripheral contrast ${medianContrast.toFixed(4)} >= 0.003`
      : `median peripheral contrast ${medianContrast.toFixed(4)} < 0.003 (texture structure lost)`,
  };
}

// ── Main ──
function analyzeArtifacts(dir) {
  const checks = [
    checkColorShift(dir),
    checkFog(dir),
  ];

  const failures = checks.filter(c => !c.pass).length;
  return { failures, details: checks };
}

// CLI mode
if (require.main === module) {
  const args = process.argv.slice(2);
  const dirArg = args.find(a => a.startsWith('--dir='));
  const dir = dirArg ? dirArg.split('=')[1] : path.join(__dirname, '..', 'tests', 'smoke-captures');

  const result = analyzeArtifacts(dir);
  for (const c of result.details) {
    console.log(`${c.pass ? '✓' : '✗'} ${c.name}: ${c.reason}`);
  }
  process.exit(result.failures > 0 ? 1 : 0);
}

module.exports = { analyzeArtifacts };
