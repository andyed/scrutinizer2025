#!/usr/bin/env node
/**
 * Per-eccentricity-band comparison of Brown et al. metamers vs Scrutinizer output.
 *
 * Three-way comparison for each page:
 *   1. Raw -> Brown metamer (ground truth peripheral encoding)
 *   2. Raw -> Scrutinizer output (our real-time approximation)
 *   3. Brown metamer -> Scrutinizer output (the validation gap)
 *
 * Eccentricity bands (from gaze center, matching CMF-derived DoG cutoffs):
 *   Band 0: 0-90px   (0-2 deg)   Fovea — should be identical
 *   Band 1: 90-180px  (2-4 deg)   Parafovea
 *   Band 2: 180-360px (4-8 deg)   Near periphery
 *   Band 3: 360-720px (8-16 deg)  Mid periphery
 *   Band 4: 720+px    (16+ deg)   Far periphery
 *
 * Usage:
 *   node scripts/compare-brown-metamers.js
 *   node scripts/compare-brown-metamers.js --manifest=tests/golden-captures/brown-metamers/manifest.json
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const DEFAULT_MANIFEST = path.join(ROOT, 'tests', 'golden-captures', 'brown-metamers', 'manifest.json');

const manifestArg = process.argv.find(a => a.startsWith('--manifest='));
const MANIFEST_PATH = manifestArg ? manifestArg.split('=')[1] : DEFAULT_MANIFEST;

// Eccentricity bands in pixels (from gaze center)
const BANDS = [
  { id: 0, label: 'fovea',          rMin: 0,   rMax: 90,   eccRange: '0-2 deg' },
  { id: 1, label: 'parafovea',      rMin: 90,  rMax: 180,  eccRange: '2-4 deg' },
  { id: 2, label: 'near_periphery', rMin: 180, rMax: 360,  eccRange: '4-8 deg' },
  { id: 3, label: 'mid_periphery',  rMin: 360, rMax: 720,  eccRange: '8-16 deg' },
  { id: 4, label: 'far_periphery',  rMin: 720, rMax: Infinity, eccRange: '16+ deg' },
];

function loadPng(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const data = fs.readFileSync(filePath);
  return PNG.sync.read(data);
}

function toLuma(png) {
  const out = new Float64Array(png.width * png.height);
  for (let i = 0; i < png.width * png.height; i++) {
    const idx = i * 4;
    out[i] = 0.299 * png.data[idx] + 0.587 * png.data[idx + 1] + 0.114 * png.data[idx + 2];
  }
  return out;
}

/**
 * Compute SSIM, PSNR, MSE for pixels within a given annular band.
 * gazeX, gazeY are in pixel coordinates.
 */
// Align two images to the same dimensions.
// Scrutinizer captures are 2x retina frame-only (3840x2024 = 1920x1012 @ 2x).
// Raw/Brown captures are 1x full viewport (1920x1080).
// Strategy: crop the taller image to match the shorter's aspect, then downsample.
function alignImages(aPng, bPng) {
  if (aPng.width === bPng.width && aPng.height === bPng.height) return [aPng, bPng];

  // Determine which is the Scrutinizer capture (2x, smaller height ratio)
  const aRatio = aPng.width / aPng.height;
  const bRatio = bPng.width / bPng.height;

  // If one is exactly 2x width of the other, it's the retina capture
  let hiRes, loRes, hiIsA;
  if (Math.abs(aPng.width - bPng.width * 2) < 10) {
    hiRes = aPng; loRes = bPng; hiIsA = true;
  } else if (Math.abs(bPng.width - aPng.width * 2) < 10) {
    hiRes = bPng; loRes = aPng; hiIsA = false;
  } else {
    // Not a 2x relationship — naive resize to smaller
    const tw = Math.min(aPng.width, bPng.width);
    const th = Math.min(aPng.height, bPng.height);
    return [resizePng(aPng, tw, th), resizePng(bPng, tw, th)];
  }

  // Crop the 1x image to match the 2x frame area.
  // 2x frame height / 2 = 1x frame height (e.g. 2024/2 = 1012).
  // Crop 1x image from top to that height (toolbar area is at the top in Scrutinizer,
  // but the raw capture has no toolbar — content starts at y=0 in both).
  const frameH1x = Math.round(hiRes.height / 2);
  const croppedLo = cropPng(loRes, 0, 0, loRes.width, frameH1x);
  const downHi = resizePng(hiRes, loRes.width, frameH1x);

  return hiIsA ? [downHi, croppedLo] : [croppedLo, downHi];
}

function cropPng(png, x, y, w, h) {
  if (x === 0 && y === 0 && w === png.width && h === png.height) return png;
  const out = new PNG({ width: w, height: h });
  for (let row = 0; row < h; row++) {
    const srcOff = ((y + row) * png.width + x) * 4;
    const dstOff = row * w * 4;
    png.data.copy(out.data, dstOff, srcOff, srcOff + w * 4);
  }
  return out;
}

function resizePng(png, targetW, targetH) {
  if (png.width === targetW && png.height === targetH) return png;
  const out = new PNG({ width: targetW, height: targetH });
  const sx = png.width / targetW;
  const sy = png.height / targetH;
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const srcX = Math.min(Math.floor(x * sx), png.width - 1);
      const srcY = Math.min(Math.floor(y * sy), png.height - 1);
      const si = (srcY * png.width + srcX) * 4;
      const di = (y * targetW + x) * 4;
      out.data[di] = png.data[si];
      out.data[di+1] = png.data[si+1];
      out.data[di+2] = png.data[si+2];
      out.data[di+3] = png.data[si+3];
    }
  }
  return out;
}

function bandMetrics(aPng, bPng, gazeX, gazeY, rMin, rMax) {
  // Align dimensions: handles 2x retina + toolbar chrome offset
  [aPng, bPng] = alignImages(aPng, bPng);

  const w = aPng.width;
  const h = aPng.height;
  const aLuma = toLuma(aPng);
  const bLuma = toLuma(bPng);

  // Collect pixel values within the band
  const aVals = [];
  const bVals = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - gazeX;
      const dy = y - gazeY;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r >= rMin && r < rMax) {
        const idx = y * w + x;
        aVals.push(aLuma[idx]);
        bVals.push(bLuma[idx]);
      }
    }
  }

  if (aVals.length === 0) return null;

  const n = aVals.length;

  // MSE
  let sumSqDiff = 0;
  for (let i = 0; i < n; i++) {
    const d = aVals[i] - bVals[i];
    sumSqDiff += d * d;
  }
  const mse = sumSqDiff / n;
  const psnr = mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);

  // SSIM
  let muA = 0, muB = 0;
  for (let i = 0; i < n; i++) {
    muA += aVals[i];
    muB += bVals[i];
  }
  muA /= n;
  muB /= n;

  let varA = 0, varB = 0, cov = 0;
  for (let i = 0; i < n; i++) {
    const da = aVals[i] - muA;
    const db = bVals[i] - muB;
    varA += da * da;
    varB += db * db;
    cov += da * db;
  }
  varA /= n;
  varB /= n;
  cov /= n;

  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  const ssim = ((2 * muA * muB + c1) * (2 * cov + c2)) /
               ((muA * muA + muB * muB + c1) * (varA + varB + c2));

  return { ssim, psnr, mse, pixelCount: n };
}

/**
 * Create a side-by-side composite image: Raw | Brown | Scrutinizer
 */
function createComposite(images, outputPath) {
  // Filter to only images that loaded successfully
  const loaded = images.filter(img => img.png !== null);
  if (loaded.length === 0) return;

  const w = loaded[0].png.width;
  const h = loaded[0].png.height;
  const totalWidth = w * loaded.length;
  const labelHeight = 30;
  const compositeHeight = h + labelHeight;

  const composite = new PNG({ width: totalWidth, height: compositeHeight });
  // Fill with black
  composite.data.fill(0);
  // Set alpha to 255
  for (let i = 3; i < composite.data.length; i += 4) {
    composite.data[i] = 255;
  }

  loaded.forEach((img, col) => {
    const offsetX = col * w;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const srcIdx = (y * w + x) * 4;
        const dstIdx = ((y + labelHeight) * totalWidth + offsetX + x) * 4;
        composite.data[dstIdx] = img.png.data[srcIdx];
        composite.data[dstIdx + 1] = img.png.data[srcIdx + 1];
        composite.data[dstIdx + 2] = img.png.data[srcIdx + 2];
        composite.data[dstIdx + 3] = 255;
      }
    }

    // Simple text label as white bar with label initials
    // (Full text rendering would need canvas; this just marks the sections)
    const labelChar = img.label.charAt(0).toUpperCase();
    for (let y = 0; y < labelHeight; y++) {
      for (let x = 0; x < w; x++) {
        const dstIdx = (y * totalWidth + offsetX + x) * 4;
        // Dark gray background
        composite.data[dstIdx] = 40;
        composite.data[dstIdx + 1] = 40;
        composite.data[dstIdx + 2] = 40;
        composite.data[dstIdx + 3] = 255;
      }
      // White marker line at the left edge of each panel
      const dstIdx = (y * totalWidth + offsetX) * 4;
      composite.data[dstIdx] = 255;
      composite.data[dstIdx + 1] = 255;
      composite.data[dstIdx + 2] = 255;
    }
  });

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputPath, PNG.sync.write(composite));
  console.log(`  Composite: ${outputPath}`);
}

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found: ${MANIFEST_PATH}`);
    console.error('Create it or run capture + generation steps first.');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  const brownDir = path.dirname(MANIFEST_PATH);
  const capturesDir = path.join(ROOT, 'tests', 'golden-captures');

  const allResults = [];

  for (const entry of manifest.comparisons) {
    console.log(`\nComparing: ${entry.page} (${entry.fixation})`);

    const gazeX = entry.gaze[0];
    const gazeY = entry.gaze[1];

    // Load images — prefer raw-electron (same renderer) over raw-playwright
    const rawElectronPath = path.join(capturesDir, 'raw-electron', `${entry.page}_center_raw.png`);
    const rawPlaywrightPath = path.join(brownDir, entry.raw);
    const rawPath = fs.existsSync(rawElectronPath) ? rawElectronPath : rawPlaywrightPath;
    const rawSource = rawPath === rawElectronPath ? 'electron' : 'playwright';

    const brownPath = path.join(brownDir, entry.brown);
    const scrutinizerMode0Path = entry.scrutinizer_mode0
      ? path.join(capturesDir, entry.scrutinizer_mode0.replace(/^\.\.\//, ''))
      : null;
    const scrutinizerMode10Path = entry.scrutinizer_mode10
      ? path.join(capturesDir, entry.scrutinizer_mode10.replace(/^\.\.\//, ''))
      : null;

    const rawPng = loadPng(rawPath);
    const brownPng = loadPng(brownPath);
    const scrut0Png = scrutinizerMode0Path ? loadPng(scrutinizerMode0Path) : null;
    const scrut10Png = scrutinizerMode10Path ? loadPng(scrutinizerMode10Path) : null;

    if (!rawPng) { console.log(`  SKIP: raw not found (${rawPath})`); continue; }
    if (!brownPng) { console.log(`  SKIP: Brown metamer not found (${brownPath})`); continue; }
    if (rawSource === 'electron') {
      console.log(`  Raw source: Electron (pixel-matched to Scrutinizer)`);
    }

    // Gaze in pixel coordinates. For Electron raw captures (same dimensions as
    // Scrutinizer golden captures), gaze is simply normalized × image dims.
    // For Playwright raw (1920x1080 vs Scrutinizer 3840x2024), use frame height.
    const gazePixelX = gazeX * rawPng.width;
    const gazePixelY = gazeY * rawPng.height;

    const pageResult = {
      page: entry.page,
      fixation: entry.fixation,
      gaze: entry.gaze,
      dimensions: { width: rawPng.width, height: rawPng.height },
      bands: []
    };

    for (const band of BANDS) {
      const bandResult = {
        band: band.id,
        label: band.label,
        eccRange: band.eccRange,
        rMin: band.rMin,
        rMax: band.rMax === Infinity ? 'Inf' : band.rMax,
        comparisons: {}
      };

      // Raw vs Brown (ground truth change from original)
      const rawVsBrown = bandMetrics(rawPng, brownPng, gazePixelX, gazePixelY, band.rMin, band.rMax);
      if (rawVsBrown) bandResult.comparisons.raw_vs_brown = rawVsBrown;

      // Raw vs Scrutinizer Mode 0 (our approximation change from original)
      if (scrut0Png) {
        try {
          const rawVsScrut0 = bandMetrics(rawPng, scrut0Png, gazePixelX, gazePixelY, band.rMin, band.rMax);
          if (rawVsScrut0) bandResult.comparisons.raw_vs_scrutinizer_mode0 = rawVsScrut0;
        } catch (e) {
          bandResult.comparisons.raw_vs_scrutinizer_mode0 = { error: e.message };
        }
      }

      // Brown vs Scrutinizer Mode 0 (the validation gap)
      if (scrut0Png) {
        try {
          const brownVsScrut0 = bandMetrics(brownPng, scrut0Png, gazePixelX, gazePixelY, band.rMin, band.rMax);
          if (brownVsScrut0) bandResult.comparisons.brown_vs_scrutinizer_mode0 = brownVsScrut0;
        } catch (e) {
          bandResult.comparisons.brown_vs_scrutinizer_mode0 = { error: e.message };
        }
      }

      // Raw vs Scrutinizer Mode 10 (mongrel comparison)
      if (scrut10Png) {
        try {
          const rawVsScrut10 = bandMetrics(rawPng, scrut10Png, gazePixelX, gazePixelY, band.rMin, band.rMax);
          if (rawVsScrut10) bandResult.comparisons.raw_vs_scrutinizer_mode10 = rawVsScrut10;
        } catch (e) {
          bandResult.comparisons.raw_vs_scrutinizer_mode10 = { error: e.message };
        }
      }

      // Brown vs Scrutinizer Mode 10
      if (scrut10Png) {
        try {
          const brownVsScrut10 = bandMetrics(brownPng, scrut10Png, gazePixelX, gazePixelY, band.rMin, band.rMax);
          if (brownVsScrut10) bandResult.comparisons.brown_vs_scrutinizer_mode10 = brownVsScrut10;
        } catch (e) {
          bandResult.comparisons.brown_vs_scrutinizer_mode10 = { error: e.message };
        }
      }

      // Print summary for this band
      if (rawVsBrown) {
        let line = `  Band ${band.id} (${band.label}): Raw->Brown SSIM=${rawVsBrown.ssim.toFixed(4)}`;
        if (bandResult.comparisons.raw_vs_scrutinizer_mode0) {
          line += ` | Raw->Scrut SSIM=${bandResult.comparisons.raw_vs_scrutinizer_mode0.ssim.toFixed(4)}`;
        }
        if (bandResult.comparisons.brown_vs_scrutinizer_mode0) {
          line += ` | Brown->Scrut SSIM=${bandResult.comparisons.brown_vs_scrutinizer_mode0.ssim.toFixed(4)}`;
        }
        console.log(line);
      }

      pageResult.bands.push(bandResult);
    }

    allResults.push(pageResult);

    // Create composite image
    const compositeDir = path.join(brownDir, 'composites');
    const compositeImages = [
      { label: 'Raw', png: rawPng },
      { label: 'Brown', png: brownPng },
    ];
    if (scrut0Png) compositeImages.push({ label: 'Scrutinizer Mode 0', png: scrut0Png });
    if (scrut10Png) compositeImages.push({ label: 'Scrutinizer Mode 10', png: scrut10Png });

    // Only create composite if dimensions match (they may not if DPR differs)
    const allSameSize = compositeImages.every(img =>
      img.png && img.png.width === rawPng.width && img.png.height === rawPng.height
    );
    if (allSameSize) {
      createComposite(compositeImages, path.join(compositeDir, `${entry.page}_composite.png`));
    } else {
      console.log(`  SKIP composite: dimension mismatch across images`);
    }
  }

  // Write summary
  const summary = {
    generatedAt: new Date().toISOString(),
    parameters: manifest.parameters,
    bands: BANDS.map(b => ({ ...b, rMax: b.rMax === Infinity ? 'Inf' : b.rMax })),
    results: allResults
  };
  const summaryPath = path.join(brownDir, 'comparison-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\nSummary: ${summaryPath}`);
}

main();
