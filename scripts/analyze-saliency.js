#!/usr/bin/env node
/**
 * Analyze saliency captures for Wave 4 validation.
 *
 * Two modes:
 *   --popout   (Test 4A): Validates saliency map peaks at expected locations
 *   --protection (Test 4B): Validates saliency modulation protects content
 *
 * Usage:
 *   node scripts/analyze-saliency.js --popout --dir=tests/golden-captures/validation/saliency
 *   node scripts/analyze-saliency.js --protection --dir=tests/golden-captures/validation/saliency
 *   node scripts/analyze-saliency.js --popout --json
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

const ROOT = path.join(__dirname, '..');
const DEFAULT_DIR = path.join(ROOT, 'tests', 'golden-captures', 'validation', 'saliency');

function round1(v) { return Math.round(v * 10) / 10; }
function round3(v) { return Math.round(v * 1000) / 1000; }

// ── Load PNG ──
function loadPng(filepath) {
  if (!fs.existsSync(filepath)) return null;
  return PNG.sync.read(fs.readFileSync(filepath));
}

// ── DPR detection ──
function detectDpr(png) {
  return png.width > 2000 ? 2 : 1;
}

// ── Sample region: mean of R channel (saliency) over a CSS rect ──
// For saliency debug view, R channel encodes saliency intensity (0-255).
// For filtered/baseline images, returns mean RGB values.
function sampleRegion(png, cssCx, cssCy, cssW, cssH, channel) {
  const dpr = detectDpr(png);
  const cssFullW = png.width / dpr;
  const cssFullH = png.height / dpr;

  // Viewport is centered in the window (1200x900 viewport in larger window)
  const vpOffX = (cssFullW - 1200) / 2;
  const vpOffY = (cssFullH - 900) / 2;

  const pxLeft = Math.round((vpOffX + cssCx - cssW / 2) * dpr);
  const pxTop = Math.round((vpOffY + cssCy - cssH / 2) * dpr);
  const pxRight = Math.round((vpOffX + cssCx + cssW / 2) * dpr);
  const pxBottom = Math.round((vpOffY + cssCy + cssH / 2) * dpr);

  let sum = 0;
  let sumR = 0, sumG = 0, sumB = 0;
  let count = 0;

  for (let py = Math.max(0, pxTop); py < Math.min(png.height, pxBottom); py++) {
    for (let px = Math.max(0, pxLeft); px < Math.min(png.width, pxRight); px++) {
      const idx = (py * png.width + px) * 4;
      sumR += png.data[idx];
      sumG += png.data[idx + 1];
      sumB += png.data[idx + 2];
      count++;
    }
  }

  if (count === 0) return { r: 0, g: 0, b: 0, mean: 0 };

  return {
    r: sumR / count,
    g: sumG / count,
    b: sumB / count,
    mean: (sumR + sumG + sumB) / (count * 3),
  };
}

// ── Sample saliency (R channel only) ──
function sampleSaliency(png, cssCx, cssCy, cssW, cssH) {
  const s = sampleRegion(png, cssCx, cssCy, cssW, cssH);
  return s.r;  // R channel = saliency in debug view
}

// ── Compute deviation between two images at a region ──
function computeDeviation(pngA, pngB, cssCx, cssCy, cssW, cssH) {
  const dpr = detectDpr(pngA);
  const cssFullW = pngA.width / dpr;
  const vpOffX = (cssFullW - 1200) / 2;
  const vpOffY = (pngA.height / dpr - 900) / 2;

  const pxLeft = Math.round((vpOffX + cssCx - cssW / 2) * dpr);
  const pxTop = Math.round((vpOffY + cssCy - cssH / 2) * dpr);
  const pxRight = Math.round((vpOffX + cssCx + cssW / 2) * dpr);
  const pxBottom = Math.round((vpOffY + cssCy + cssH / 2) * dpr);

  let totalDelta = 0;
  let count = 0;

  for (let py = Math.max(0, pxTop); py < Math.min(pngA.height, pxBottom); py++) {
    for (let px = Math.max(0, pxLeft); px < Math.min(pngA.width, pxRight); px++) {
      const idx = (py * pngA.width + px) * 4;
      totalDelta += (
        Math.abs(pngA.data[idx] - pngB.data[idx]) +
        Math.abs(pngA.data[idx + 1] - pngB.data[idx + 1]) +
        Math.abs(pngA.data[idx + 2] - pngB.data[idx + 2])
      ) / 3;
      count++;
    }
  }

  return count > 0 ? totalDelta / count : 0;
}

// ── Stimulus regions (CSS viewport coords) ──
const REGIONS = {
  color:     { cx: 300, cy: 225, w: 40, h: 40, label: 'Color singleton',     expect: 'high' },
  luminance: { cx: 900, cy: 225, w: 40, h: 40, label: 'Luminance singleton', expect: 'high' },
  face:      { cx: 300, cy: 675, w: 40, h: 40, label: 'Face',                expect: 'high' },
  control:   { cx: 900, cy: 675, w: 40, h: 40, label: 'Control',             expect: 'low' },
  background:{ cx: 600, cy: 450, w: 40, h: 40, label: 'Background (center)', expect: 'low' },
};

// Face-test regions (face-test.html: face at ~50% X, ~40% Y of 1200x900)
const FACE_REGIONS = {
  face:       { cx: 600, cy: 360, w: 60, h: 60, label: 'Face center',    expect: 'high' },
  background: { cx: 100, cy: 100, w: 40, h: 40, label: 'Background',     expect: 'low' },
};

// ── Test 4A: Pop-Out Validation ──
function analyzePopout(dir) {
  const saliencyPng = loadPng(path.join(dir, 'popout_saliency.png'));
  if (!saliencyPng) {
    console.error('popout_saliency.png not found in ' + dir);
    console.error('Run: node scripts/capture-saliency.js --pages=popout');
    process.exit(1);
  }

  const dpr = detectDpr(saliencyPng);
  console.log(`=== Wave 4A: Saliency Pop-Out Validation ===`);
  console.log(`Source: ${dir}`);
  console.log(`Image: ${saliencyPng.width}×${saliencyPng.height}, DPR=${dpr}`);
  console.log();

  // Sample saliency at each region
  const measurements = {};
  console.log('Region                  Saliency(R)  Expected');
  console.log('----------------------  -----------  --------');

  for (const [key, region] of Object.entries(REGIONS)) {
    const saliency = sampleSaliency(saliencyPng, region.cx, region.cy, region.w, region.h);
    measurements[key] = round1(saliency);
    console.log(
      `${region.label.padEnd(22)}  ` +
      `${round1(saliency).toFixed(1).padStart(11)}  ` +
      `${region.expect}`
    );
  }

  console.log();

  // Also check face-test saliency if available
  const faceSaliencyPng = loadPng(path.join(dir, 'face_saliency.png'));
  if (faceSaliencyPng) {
    console.log('--- Face-test.html saliency ---\n');
    for (const [key, region] of Object.entries(FACE_REGIONS)) {
      const saliency = sampleSaliency(faceSaliencyPng, region.cx, region.cy, region.w, region.h);
      measurements[`face_page_${key}`] = round1(saliency);
      console.log(
        `${region.label.padEnd(22)}  ` +
        `${round1(saliency).toFixed(1).padStart(11)}  ` +
        `${region.expect}`
      );
    }
    console.log();
  }

  // ── Validation checks ──
  console.log('--- Validation ---\n');

  const colorS = measurements.color;
  const lumS = measurements.luminance;
  const faceS = measurements.face;
  const controlS = measurements.control;
  const bgS = measurements.background;

  // Absolute thresholds (preliminary — calibrate on first run)
  console.log(`[${colorS > 80 ? 'PASS' : 'FAIL'}] Color singleton saliency > 80 (${colorS})`);
  console.log(`[${lumS > 80 ? 'PASS' : 'FAIL'}] Luminance singleton saliency > 80 (${lumS})`);
  console.log(`[${faceS > 60 ? 'PASS' : 'FAIL'}] Face saliency > 60 (${faceS})`);
  console.log(`[${controlS < 40 ? 'PASS' : 'FAIL'}] Control saliency < 40 (${controlS})`);

  // Ratio checks (robust to renormalization)
  const colorRatio = controlS > 0 ? colorS / controlS : Infinity;
  const lumRatio = controlS > 0 ? lumS / controlS : Infinity;
  console.log(`[${colorRatio > 2 ? 'PASS' : 'FAIL'}] Color > 2× control (ratio=${round3(colorRatio)})`);
  console.log(`[${lumRatio > 2 ? 'PASS' : 'FAIL'}] Luminance > 2× control (ratio=${round3(lumRatio)})`);

  // Background check
  console.log(`[${bgS < 30 ? 'PASS' : 'FAIL'}] Background saliency < 30 (${bgS})`);

  if (hasFlag('json')) {
    console.log('\n' + JSON.stringify({ source: dir, measurements }, null, 2));
  }

  return measurements;
}

// ── Test 4B: Protection Validation ──
function analyzeProtection(dir) {
  // Load captures for both pages
  const pages = [
    {
      name: 'popout',
      modOn: 'popout_filtered_mod_on.png',
      modOff: 'popout_filtered_mod_off.png',
      baseline: 'popout_baseline.png',
      regions: REGIONS,
    },
    {
      name: 'face',
      modOn: 'face_filtered_mod_on.png',
      modOff: 'face_filtered_mod_off.png',
      baseline: null,  // face-test has no baseline capture in the matrix
      regions: FACE_REGIONS,
    },
  ];

  console.log(`=== Wave 4B: Saliency Protection Validation ===`);
  console.log(`Source: ${dir}`);
  console.log();

  const allResults = [];

  for (const page of pages) {
    const modOnPng = loadPng(path.join(dir, page.modOn));
    const modOffPng = loadPng(path.join(dir, page.modOff));
    const baselinePng = page.baseline ? loadPng(path.join(dir, page.baseline)) : null;

    if (!modOnPng || !modOffPng) {
      console.log(`Skipping ${page.name}: missing mod_on or mod_off captures`);
      continue;
    }

    console.log(`--- ${page.name} page ---\n`);
    const dpr = detectDpr(modOnPng);
    console.log(`Image: ${modOnPng.width}×${modOnPng.height}, DPR=${dpr}`);

    if (baselinePng) {
      // Full protection analysis with baseline comparison
      console.log();
      console.log('Region                  Dev(modON)  Dev(modOFF)  Protection  Expected');
      console.log('----------------------  ----------  -----------  ----------  --------');

      for (const [key, region] of Object.entries(page.regions)) {
        const devOn = computeDeviation(modOnPng, baselinePng, region.cx, region.cy, region.w, region.h);
        const devOff = computeDeviation(modOffPng, baselinePng, region.cx, region.cy, region.w, region.h);
        const protRatio = devOff > 0 ? devOn / devOff : null;

        const result = {
          page: page.name, region: key, label: region.label,
          devOn: round1(devOn), devOff: round1(devOff),
          protectionRatio: protRatio !== null ? round3(protRatio) : null,
          expect: region.expect,
        };
        allResults.push(result);

        const ratioStr = protRatio !== null ? round3(protRatio).toFixed(3) : '  N/A';
        console.log(
          `${region.label.padEnd(22)}  ` +
          `${round1(devOn).toFixed(1).padStart(10)}  ` +
          `${round1(devOff).toFixed(1).padStart(11)}  ` +
          `${ratioStr.padStart(10)}  ` +
          `${region.expect}`
        );
      }
    } else {
      // No baseline — compare mod_on vs mod_off directly
      console.log();
      console.log('Region                  Delta(ON-OFF)  Expected');
      console.log('----------------------  -------------  --------');

      for (const [key, region] of Object.entries(page.regions)) {
        const delta = computeDeviation(modOnPng, modOffPng, region.cx, region.cy, region.w, region.h);
        const result = {
          page: page.name, region: key, label: region.label,
          delta: round1(delta), expect: region.expect,
        };
        allResults.push(result);

        console.log(
          `${region.label.padEnd(22)}  ` +
          `${round1(delta).toFixed(1).padStart(13)}  ` +
          `${region.expect}`
        );
      }
    }
    console.log();
  }

  // ── Validation checks ──
  console.log('--- Validation ---\n');

  // Check: modulation changes pixels at high-saliency locations
  const popoutResults = allResults.filter(r => r.page === 'popout' && r.protectionRatio !== null);
  const highSalResults = popoutResults.filter(r => r.expect === 'high');
  const lowSalResults = popoutResults.filter(r => r.expect === 'low');

  if (highSalResults.length > 0) {
    // Modulation changes pixels
    const maxDevDelta = Math.max(...highSalResults.map(r => Math.abs(r.devOn - r.devOff)));
    console.log(`[${maxDevDelta > 5 ? 'PASS' : 'FAIL'}] Modulation changes pixels (max deviation delta=${round1(maxDevDelta)} at high-saliency)`);

    // Protection at high saliency: ratio < 0.85
    const protectedAny = highSalResults.some(r => r.protectionRatio < 0.85);
    const minProtRatio = Math.min(...highSalResults.map(r => r.protectionRatio));
    console.log(`[${protectedAny ? 'PASS' : 'FAIL'}] Protection at high saliency (ratio < 0.85, min=${round3(minProtRatio)})`);
  }

  if (lowSalResults.length > 0) {
    // No protection at low saliency: ratio >= 0.95
    const noProtection = lowSalResults.every(r => r.protectionRatio >= 0.95);
    const maxLowRatio = Math.max(...lowSalResults.map(r => r.protectionRatio));
    console.log(`[${noProtection ? 'PASS' : 'INFO'}] No protection at low saliency (ratio >= 0.95, max=${round3(maxLowRatio)})`);
  }

  // Consistency: protection ratio at singleton < ratio at control
  if (highSalResults.length > 0 && lowSalResults.length > 0) {
    const minHighRatio = Math.min(...highSalResults.map(r => r.protectionRatio));
    const maxLowRatio = Math.max(...lowSalResults.map(r => r.protectionRatio));
    const consistent = minHighRatio < maxLowRatio;
    console.log(`[${consistent ? 'PASS' : 'FAIL'}] Consistent: high-sal ratio (${round3(minHighRatio)}) < low-sal ratio (${round3(maxLowRatio)})`);
  }

  // Face page delta check
  const faceResults = allResults.filter(r => r.page === 'face' && r.delta !== undefined);
  const faceFaceResult = faceResults.find(r => r.region === 'face');
  const faceBgResult = faceResults.find(r => r.region === 'background');
  if (faceFaceResult && faceBgResult) {
    const faceProtected = faceFaceResult.delta > faceBgResult.delta;
    console.log(`[${faceProtected ? 'PASS' : 'INFO'}] Face modulation delta (${faceFaceResult.delta}) > background delta (${faceBgResult.delta})`);
  }

  if (hasFlag('json')) {
    console.log('\n' + JSON.stringify({ source: dir, results: allResults }, null, 2));
  }
}

// ── Main ──
try {
  const dir = getArg('dir', DEFAULT_DIR);

  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    console.error('Run capture-saliency.js first.');
    process.exit(1);
  }

  if (hasFlag('popout')) {
    analyzePopout(dir);
  } else if (hasFlag('protection')) {
    analyzeProtection(dir);
  } else {
    // Run both
    analyzePopout(dir);
    console.log('\n' + '='.repeat(60) + '\n');
    analyzeProtection(dir);
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}
