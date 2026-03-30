#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PNG } = require('pngjs');

function getArg(prefix) {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.split('=')[1] : undefined;
}

const pkgVersion = require('../package.json').version;
const version = getArg('--version') || getArg('v') || pkgVersion;
const skipBrowserCapture = process.argv.includes('--skip-browser-capture');
const browserOnly = process.argv.includes('--browser-only');
const figmaOnly = process.argv.includes('--figma-only');
const regressionMode = process.argv.includes('--regression');
const regressionBase = getArg('--base');      // e.g., --base=pre-optionA
const regressionTarget = getArg('--target');  // e.g., --target=post-optionA
const pixelIdentical = process.argv.includes('--pixel-identical');

// --pixel-identical sets tight thresholds for structural refactors
const thresholdSSIM = pixelIdentical ? 0.9999 : (parseFloat(getArg('--threshold-ssim')) || 0.98);
const thresholdPSNR = pixelIdentical ? 55 : (parseFloat(getArg('--threshold-psnr')) || 35);
const thresholdMaxPixelDiff = pixelIdentical ? 1 : (parseInt(getArg('--threshold-max-diff')) || 255);

const ROOT = path.join(__dirname, '..');
const TEST_CAPTURE_DIR = path.join(ROOT, 'tests', 'golden-captures', `v${version}`);
const DOC_BROWSER_DIR = path.join(ROOT, 'docs', 'golden', 'browser', `v${version}`);
const DOC_FIGMA_DIR = path.join(ROOT, 'docs', 'golden', 'figma', `v${version}`);
const SUMMARY_PATH = path.join(ROOT, 'docs', 'golden', `summary-${version}.json`);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function runBrowserCapture() {
  console.log(`\n▶︎ Running browser capture (v${version})`);
  const result = spawnSync('node', [path.join('scripts', 'capture-golden.js'), `v=${version}`], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error('Browser capture failed.');
    process.exit(result.status || 1);
  }
}

function copyBrowserOutputs() {
  ensureDir(DOC_BROWSER_DIR);
  if (!fs.existsSync(TEST_CAPTURE_DIR)) {
    console.warn(`No test captures found at ${TEST_CAPTURE_DIR}`);
    return [];
  }
  const files = fs.readdirSync(TEST_CAPTURE_DIR).filter((f) => f.endsWith('.png'));
  files.forEach((file) => {
    fs.copyFileSync(path.join(TEST_CAPTURE_DIR, file), path.join(DOC_BROWSER_DIR, file));
  });
  return files;
}

function loadPng(filePath) {
  const data = fs.readFileSync(filePath);
  return PNG.sync.read(data);
}

function toLuma(png) {
  const out = new Float64Array(png.width * png.height);
  for (let i = 0; i < png.width * png.height; i++) {
    const idx = i * 4;
    const r = png.data[idx];
    const g = png.data[idx + 1];
    const b = png.data[idx + 2];
    out[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return out;
}

function metrics(aPng, bPng) {
  if (aPng.width !== bPng.width || aPng.height !== bPng.height) {
    throw new Error('Image dimensions differ');
  }
  const a = toLuma(aPng);
  const b = toLuma(bPng);
  const n = a.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  const mse = sum / n;
  const psnr = mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);

  const muA = a.reduce((acc, v) => acc + v, 0) / n;
  const muB = b.reduce((acc, v) => acc + v, 0) / n;
  let varA = 0;
  let varB = 0;
  let cov = 0;
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
  const ssim = ((2 * muA * muB + c1) * (2 * cov + c2)) / ((muA * muA + muB * muB + c1) * (varA + varB + c2));

  // Per-channel pixel diff metrics
  let maxPixelDiff = 0;
  let diffCountAbove1 = 0;
  let diffCountAbove5 = 0;
  const totalPixels = aPng.width * aPng.height;
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    for (let c = 0; c < 3; c++) { // R, G, B (skip alpha)
      const d = Math.abs(aPng.data[idx + c] - bPng.data[idx + c]);
      if (d > maxPixelDiff) maxPixelDiff = d;
      if (d > 1) diffCountAbove1++;
      if (d > 5) diffCountAbove5++;
    }
  }

  return { mse, psnr, ssim, maxPixelDiff, diffCountAbove1, diffCountAbove5 };
}

function comparePairs(browserFiles) {
  ensureDir(DOC_FIGMA_DIR);
  const results = [];
  browserFiles.forEach((file) => {
    const browserPath = path.join(DOC_BROWSER_DIR, file);
    const figmaPath = path.join(DOC_FIGMA_DIR, file);
    if (!fs.existsSync(figmaPath)) {
      results.push({ file, browserPath, figmaPath: null, status: 'missing-figma' });
      return;
    }
    try {
      const m = metrics(loadPng(browserPath), loadPng(figmaPath));
      const pass = m.ssim >= thresholdSSIM && m.psnr >= thresholdPSNR && m.maxPixelDiff <= thresholdMaxPixelDiff;
      results.push({ file, browserPath, figmaPath, ...m, pass, status: pass ? 'pass' : 'fail' });
    } catch (err) {
      results.push({ file, browserPath, figmaPath, status: 'error', error: err.message });
    }
  });
  return results;
}

function summarize(results) {
  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  const missing = results.filter((r) => r.status.startsWith('missing')).length;
  const errors = results.filter((r) => r.status === 'error').length;
  console.log('\nSummary');
  console.log(`  Pass:    ${pass}`);
  console.log(`  Fail:    ${fail}`);
  console.log(`  Missing: ${missing}`);
  console.log(`  Errors:  ${errors}`);

  if (pixelIdentical) {
    console.log(`\n  Thresholds (--pixel-identical):`);
    console.log(`    SSIM ≥ ${thresholdSSIM}, PSNR ≥ ${thresholdPSNR}, maxPixelDiff ≤ ${thresholdMaxPixelDiff}`);
  }

  // Show failures with detail
  const failures = results.filter((r) => r.status === 'fail');
  if (failures.length > 0) {
    console.log('\n  Failures:');
    failures.forEach((r) => {
      console.log(`    ${r.file}`);
      console.log(`      SSIM=${r.ssim.toFixed(6)} PSNR=${r.psnr.toFixed(1)} maxDiff=${r.maxPixelDiff} diffPx>1=${r.diffCountAbove1} diffPx>5=${r.diffCountAbove5}`);
    });
  }

  // Per-mode grouping (extract mode from filename pattern: *_modeN_*)
  const byMode = {};
  results.forEach((r) => {
    const modeMatch = r.file.match(/mode(\d+)/);
    const mode = modeMatch ? `mode ${modeMatch[1]}` : 'default';
    if (!byMode[mode]) byMode[mode] = { pass: 0, fail: 0 };
    byMode[mode][r.status === 'pass' ? 'pass' : 'fail']++;
  });
  if (Object.keys(byMode).length > 1) {
    console.log('\n  By mode:');
    Object.entries(byMode).sort().forEach(([mode, counts]) => {
      const status = counts.fail > 0 ? 'FAIL' : 'PASS';
      console.log(`    ${mode}: ${counts.pass} pass, ${counts.fail} fail — ${status}`);
    });
  }
}

function writeSummary(results, summaryPath) {
  const payload = {
    version,
    thresholds: { ssim: thresholdSSIM, psnr: thresholdPSNR, maxPixelDiff: thresholdMaxPixelDiff },
    generatedAt: new Date().toISOString(),
    results,
  };
  const outPath = summaryPath || SUMMARY_PATH;
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`\nSummary written: ${outPath}`);
}

/**
 * Regression comparison: compare two capture directories (base vs target).
 * Usage: node golden-compare.js --regression --base=pre-optionA --target=post-optionA [--pixel-identical]
 */
function runRegression() {
  const captureRoot = path.join(ROOT, 'tests', 'golden-captures');
  const baseDir = path.join(captureRoot, regressionBase);
  const targetDir = path.join(captureRoot, regressionTarget);

  if (!fs.existsSync(baseDir)) {
    console.error(`Base directory not found: ${baseDir}`);
    process.exit(1);
  }
  if (!fs.existsSync(targetDir)) {
    console.error(`Target directory not found: ${targetDir}`);
    process.exit(1);
  }

  console.log(`\nRegression comparison: ${regressionBase} → ${regressionTarget}`);
  if (pixelIdentical) console.log('  Mode: --pixel-identical');

  const baseFiles = fs.readdirSync(baseDir).filter((f) => f.endsWith('.png'));
  const results = [];

  baseFiles.forEach((file) => {
    const basePath = path.join(baseDir, file);
    const targetPath = path.join(targetDir, file);
    if (!fs.existsSync(targetPath)) {
      results.push({ file, status: 'missing-target' });
      return;
    }
    try {
      const m = metrics(loadPng(basePath), loadPng(targetPath));
      const pass = m.ssim >= thresholdSSIM && m.psnr >= thresholdPSNR && m.maxPixelDiff <= thresholdMaxPixelDiff;
      results.push({ file, ...m, pass, status: pass ? 'pass' : 'fail' });
    } catch (err) {
      results.push({ file, status: 'error', error: err.message });
    }
  });

  // Check for new files in target not in base
  const targetFiles = fs.readdirSync(targetDir).filter((f) => f.endsWith('.png'));
  const newFiles = targetFiles.filter((f) => !baseFiles.includes(f));
  if (newFiles.length > 0) {
    console.log(`\n  New files in target (not in base): ${newFiles.length}`);
    newFiles.forEach((f) => console.log(`    + ${f}`));
  }

  summarize(results);
  const summaryPath = path.join(captureRoot, `regression-${regressionBase}-vs-${regressionTarget}.json`);
  writeSummary(results, summaryPath);

  const failures = results.filter((r) => r.status === 'fail');
  if (failures.length > 0) process.exit(1);
}

(async () => {
  // Regression mode: compare two capture directories
  if (regressionMode) {
    if (!regressionBase || !regressionTarget) {
      console.error('Usage: --regression --base=<dir> --target=<dir> [--pixel-identical]');
      process.exit(1);
    }
    runRegression();
    return;
  }

  // Default: browser vs Figma comparison
  if (!figmaOnly && !skipBrowserCapture) {
    runBrowserCapture();
  }
  let browserFiles = [];
  if (!figmaOnly) {
    browserFiles = copyBrowserOutputs();
    console.log(`Copied ${browserFiles.length} browser captures to ${DOC_BROWSER_DIR}`);
    if (browserOnly) {
      console.log('Browser-only run complete.');
      process.exit(0);
    }
  } else {
    if (!fs.existsSync(DOC_BROWSER_DIR)) {
      console.error(`Browser directory missing: ${DOC_BROWSER_DIR}`);
      process.exit(1);
    }
    browserFiles = fs.readdirSync(DOC_BROWSER_DIR).filter((f) => f.endsWith('.png'));
  }

  const results = comparePairs(browserFiles);
  summarize(results);
  writeSummary(results);
})();
