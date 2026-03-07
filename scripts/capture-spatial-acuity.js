#!/usr/bin/env node
/**
 * Capture spatial acuity screenshots for Wave 2 validation.
 *
 * Usage:
 *   node scripts/capture-spatial-acuity.js
 *   node scripts/capture-spatial-acuity.js --dry-run
 *   node scripts/capture-spatial-acuity.js --freqs=1  # single freq
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
function getArg(name, def) {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}
const hasFlag = (name) => args.includes(`--${name}`);

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'tests', 'golden-captures', 'validation', 'spatial-acuity');

const BASE_URL = process.env.BASE_URL || 'https://andyed.github.io/scrutinizer-www/reference-pages';

const CAPTURE_FOVEA_RADIUS = '90';
const CAPTURE_WIDTH = '1920';
const CAPTURE_HEIGHT = '1080';

// Capture matrix
const ALL_FREQS = [0.25, 0.5, 1, 2, 4];
const ALL_CHROMATICS = ['achromatic', 'rg', 'by'];

const freqs = getArg('freqs', ALL_FREQS.join(',')).split(',').map(Number);
const chromatics = getArg('chromatics', 'achromatic').split(',');
const dryRun = hasFlag('dry-run');

const CONDITIONS = [
  { id: 'filtered', chromaticPooling: 'true', mode: '0' },
  { id: 'baseline', chromaticPooling: 'false', mode: '0' },
];

function runCapture(freq, chromatic, condition) {
  return new Promise((resolve) => {
    const pageUrl = `${BASE_URL}/spatial-acuity.html?mode=single&freq=${freq}&chromatic=${chromatic}&contrast=1`;
    const filename = `${chromatic}_${freq}cpd_${condition.id}.png`;

    if (dryRun) {
      console.log(`[dry-run] ${filename}  →  ${pageUrl}`);
      return resolve();
    }

    console.log(`Capturing: ${filename}`);

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
      TEST_OUTPUT_FILENAME: filename,
      SCREENSHOT_MODE: 'update',
      ELECTRON_RUN_AS_NODE: undefined,
    };

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
  const total = freqs.length * chromatics.length * CONDITIONS.length;
  console.log(`\nWave 2 Spatial Acuity Capture`);
  console.log(`  Frequencies: ${freqs.join(', ')} cpd`);
  console.log(`  Chromatics: ${chromatics.join(', ')}`);
  console.log(`  Conditions: ${CONDITIONS.map(c => c.id).join(', ')}`);
  console.log(`  Total: ${total} screenshots`);
  console.log(`  Output: ${OUTPUT_DIR}`);
  console.log();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let captured = 0;
  for (const freq of freqs) {
    for (const chromatic of chromatics) {
      for (const condition of CONDITIONS) {
        await runCapture(freq, chromatic, condition);
        captured++;
        if (!dryRun) console.log(`  [${captured}/${total}]\n`);
      }
    }
  }

  if (dryRun) {
    console.log(`\n${total} captures would run. Remove --dry-run to execute.`);
  } else {
    console.log(`\nDone. ${captured} captures completed.`);
    console.log(`Run analysis: node scripts/analyze-spatial-acuity.js`);
  }
}

main();
