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
const thresholdSSIM = parseFloat(getArg('--threshold-ssim')) || 0.98;
const thresholdPSNR = parseFloat(getArg('--threshold-psnr')) || 35;

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
  return { mse, psnr, ssim };
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
      const pass = m.ssim >= thresholdSSIM && m.psnr >= thresholdPSNR;
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
  const missing = results.filter((r) => r.status === 'missing-figma').length;
  const errors = results.filter((r) => r.status === 'error').length;
  console.log('\nSummary');
  console.log(`  Pass:    ${pass}`);
  console.log(`  Fail:    ${fail}`);
  console.log(`  Missing: ${missing}`);
  console.log(`  Errors:  ${errors}`);
}

function writeSummary(results) {
  const payload = {
    version,
    thresholds: { ssim: thresholdSSIM, psnr: thresholdPSNR },
    generatedAt: new Date().toISOString(),
    results,
  };
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(payload, null, 2));
  console.log(`\nSummary written: ${SUMMARY_PATH}`);
}

(async () => {
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
