#!/usr/bin/env node
/**
 * Capture color-search screenshots for Wave 1 validation.
 *
 * Launches Scrutinizer in test mode for each color/size combination,
 * capturing both filtered (chromatic pooling active) and baseline
 * (chromatic pooling off) screenshots.
 *
 * Usage:
 *   node scripts/capture-color-search.js
 *   node scripts/capture-color-search.js --sizes=24     # single size
 *   node scripts/capture-color-search.js --colors=red,blue  # subset
 *   node scripts/capture-color-search.js --dry-run      # show what would run
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
const OUTPUT_DIR = path.join(ROOT, 'tests', 'golden-captures', 'validation', 'color-search');

// Reference page URL — GitHub Pages or local override
const BASE_URL = process.env.BASE_URL || 'https://andyed.github.io/scrutinizer-www/reference-pages';

// Capture geometry — must match spec predictions (fovea_radius=90, 1920x1080)
const CAPTURE_FOVEA_RADIUS = '90';
const CAPTURE_WIDTH = '1920';
const CAPTURE_HEIGHT = '1080';
const SEED = '42';

// Capture matrix from spec
const ALL_COLORS = ['red', 'green', 'blue', 'yellow'];
const ALL_SIZES = [16, 20, 24, 32, 48];

const colors = getArg('colors', ALL_COLORS.join(',')).split(',');
const sizes = getArg('sizes', ALL_SIZES.join(',')).split(',').map(Number);
const dryRun = hasFlag('dry-run');

// Two conditions: filtered (Scrutinizer active with chromatic pooling) and baseline (off)
const CONDITIONS = [
  { id: 'filtered', chromaticPooling: 'true', mode: '0' },
  { id: 'baseline', chromaticPooling: 'false', mode: '0' },
];

function runCapture(color, size, condition) {
  return new Promise((resolve, reject) => {
    const pageUrl = `${BASE_URL}/color-search.html?color=${color}&size=${size}&mode=static&seed=${SEED}`;
    const filename = `${color}_${size}px_${condition.id}.png`;

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
        // Screenshots land in tests/golden-captures/v{major.minor}/ — move to validation dir
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
        resolve(); // Don't reject — continue with remaining captures
      }
    });
  });
}

async function main() {
  const total = colors.length * sizes.length * CONDITIONS.length;
  console.log(`\nWave 1 Color Search Capture`);
  console.log(`  Colors: ${colors.join(', ')}`);
  console.log(`  Sizes: ${sizes.join(', ')}px`);
  console.log(`  Conditions: ${CONDITIONS.map(c => c.id).join(', ')}`);
  console.log(`  Total: ${total} screenshots`);
  console.log(`  Output: ${OUTPUT_DIR}`);
  console.log(`  Fovea radius: ${CAPTURE_FOVEA_RADIUS}px, Window: ${CAPTURE_WIDTH}x${CAPTURE_HEIGHT}`);
  console.log();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let captured = 0;
  for (const color of colors) {
    for (const size of sizes) {
      for (const condition of CONDITIONS) {
        await runCapture(color, size, condition);
        captured++;
        if (!dryRun) {
          console.log(`  [${captured}/${total}]\n`);
        }
      }
    }
  }

  if (dryRun) {
    console.log(`\n${total} captures would run. Remove --dry-run to execute.`);
  } else {
    console.log(`\nDone. ${captured} captures completed.`);
    console.log(`Run validation: node scripts/validate-color-search.js`);
  }
}

main();
