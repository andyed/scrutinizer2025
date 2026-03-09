#!/usr/bin/env node
/**
 * Capture Gaussian blur vs DoG comparison screenshots.
 *
 * Default: 3 conditions × 5 frequencies = 15 captures (at mode's native E2).
 * With --sweep-e2: 2 conditions × 5 frequencies × N e2 values + baselines.
 *
 * Usage:
 *   node scripts/capture-gaussian-comparison.js
 *   node scripts/capture-gaussian-comparison.js --dry-run
 *   node scripts/capture-gaussian-comparison.js --freqs=1,2
 *   node scripts/capture-gaussian-comparison.js --sweep-e2        # default e2 sweep
 *   node scripts/capture-gaussian-comparison.js --sweep-e2=0.15,0.3,0.5,0.75,1.0
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
function getArg(name, def) {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}
const hasFlag = (name) => args.some(a => a === `--${name}` || a.startsWith(`--${name}=`));

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'tests', 'golden-captures', 'validation', 'gaussian-comparison');

const BASE_URL = process.env.BASE_URL || 'https://andyed.github.io/scrutinizer-www/reference-pages';

const CAPTURE_FOVEA_RADIUS = '90';
const CAPTURE_WIDTH = '1920';
const CAPTURE_HEIGHT = '1080';

const ALL_FREQS = [0.25, 0.5, 1, 2, 4];
const freqs = getArg('freqs', ALL_FREQS.join(',')).split(',').map(Number);
const dryRun = hasFlag('dry-run');
const sweepE2 = hasFlag('sweep-e2');
const e2Values = sweepE2
  ? getArg('sweep-e2', '0.15,0.3,0.5,0.75,1.0').split(',').map(Number)
  : [null]; // null = use mode default

function buildConditions(e2) {
  const suffix = e2 !== null ? `_e2${e2}` : '';
  return [
    { id: `dog${suffix}`,      gaussianBlur: 'false', mode: '0', chromaticPooling: 'false', dogE2: e2 },
    { id: `gaussian${suffix}`, gaussianBlur: 'true',  mode: '0', chromaticPooling: 'false', dogE2: e2 },
    // Baseline only needed once (no E2 dependence)
    ...(e2 === null || e2 === e2Values[0]
      ? [{ id: 'baseline', gaussianBlur: 'false', mode: 'disabled', chromaticPooling: 'false', dogE2: null }]
      : []),
  ];
}

function runCapture(freq, condition) {
  return new Promise((resolve) => {
    const pageUrl = `${BASE_URL}/spatial-acuity.html?mode=single&freq=${freq}&chromatic=achromatic&contrast=1`;
    const filename = `achromatic_${freq}cpd_${condition.id}.png`;

    if (dryRun) {
      console.log(`[dry-run] ${filename}  →  ${pageUrl}${condition.dogE2 !== null ? `  (E2=${condition.dogE2})` : ''}`);
      return resolve();
    }

    console.log(`Capturing: ${filename}${condition.dogE2 !== null ? `  (E2=${condition.dogE2})` : ''}`);

    const env = {
      ...process.env,
      TEST_MODE: 'true',
      TEST_URL: pageUrl,
      TEST_MODES: condition.mode,
      TEST_RADIUS: CAPTURE_FOVEA_RADIUS,
      TEST_WIDTH: CAPTURE_WIDTH,
      TEST_HEIGHT: CAPTURE_HEIGHT,
      TEST_FIXATION_X: '0.5',
      TEST_FIXATION_Y: '0.5',
      TEST_OVERLAY: 'false',
      TEST_CHROMATIC_POOLING: condition.chromaticPooling,
      TEST_GAUSSIAN_BLUR: condition.gaussianBlur,
      TEST_OUTPUT_FILENAME: filename,
      SCREENSHOT_MODE: 'update',
      ELECTRON_RUN_AS_NODE: undefined,
    };

    // Only set TEST_DOG_E2 when explicitly overriding
    if (condition.dogE2 !== null) {
      env.TEST_DOG_E2 = String(condition.dogE2);
    }

    const child = spawn('npm', ['start'], {
      cwd: ROOT,
      env,
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      if (code === 0) {
        const packageVersion = require(path.join(ROOT, 'package.json')).version.replace(/\.\d+$/, '');
        const src = path.join(ROOT, 'tests', 'golden-captures', `v${packageVersion}`, filename);
        const dest = path.join(OUTPUT_DIR, filename);
        if (fs.existsSync(src)) {
          fs.renameSync(src, dest);
          console.log(`  → ${dest}`);
        } else {
          console.warn(`  Warning: expected screenshot not found at ${src}`);
        }
        resolve();
      } else {
        console.error(`  Failed (exit ${code}), continuing...`);
        resolve();
      }
    });
  });
}

async function main() {
  // Build full condition list
  const allConditions = [];
  for (const e2 of e2Values) {
    for (const cond of buildConditions(e2)) {
      allConditions.push(cond);
    }
  }

  const total = freqs.length * allConditions.length;
  console.log(`\nGaussian Blur vs DoG Comparison Capture`);
  console.log(`  Frequencies: ${freqs.join(', ')} cpd`);
  if (sweepE2) console.log(`  E2 sweep: ${e2Values.join(', ')}`);
  console.log(`  Conditions: ${allConditions.map(c => c.id).join(', ')}`);
  console.log(`  Total: ${total} screenshots`);
  console.log(`  Output: ${OUTPUT_DIR}`);
  console.log();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let captured = 0;
  for (const freq of freqs) {
    for (const condition of allConditions) {
      await runCapture(freq, condition);
      captured++;
      if (!dryRun) console.log(`  [${captured}/${total}]\n`);
    }
  }

  if (dryRun) {
    console.log(`\n${total} captures would run. Remove --dry-run to execute.`);
  } else {
    console.log(`\nDone. ${captured} captures completed.`);
    console.log(`Run analysis: node scripts/analyze-gaussian-comparison.js`);
  }
}

main();
