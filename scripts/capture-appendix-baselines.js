#!/usr/bin/env node
/**
 * Capture unfiltered baseline screenshots for arxiv paper appendix figures.
 *
 * All captures use mode='disabled' (effects toggled off via eye icon) to show
 * the raw HTML stimuli as they appear without any pipeline processing.
 *
 * Usage:
 *   node scripts/capture-appendix-baselines.js
 *   node scripts/capture-appendix-baselines.js --dry-run
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'docs', 'arxiv-paper', 'figures', 'baselines');
const BASE_URL = process.env.BASE_URL || 'https://andyed.github.io/scrutinizer-www/reference-pages';

const CAPTURE_WIDTH = '1920';
const CAPTURE_HEIGHT = '1080';
const CAPTURE_FOVEA_RADIUS = '90';

// All four validation stimuli with effects disabled (eye icon toggle off)
const CAPTURES = [
  {
    id: 'chromatic_baseline',
    url: `${BASE_URL}/color-search.html?color=red&size=24&mode=bands&seed=42`,
    mode: 'disabled',
  },
  {
    id: 'spatial_baseline',
    url: `${BASE_URL}/spatial-acuity.html?mode=single&freq=1&chromatic=achromatic&contrast=1`,
    mode: 'disabled',
  },
  {
    id: 'crowding_baseline',
    url: `${BASE_URL}/crowding.html`,
    mode: 'disabled',
  },
  {
    id: 'saliency_baseline',
    url: `${BASE_URL}/saliency-face.html`,
    mode: 'disabled',
  },
];

function runCapture(capture) {
  return new Promise((resolve) => {
    const filename = `${capture.id}.png`;

    if (dryRun) {
      console.log(`[dry-run] ${filename}  →  ${capture.url}`);
      return resolve();
    }

    console.log(`Capturing: ${filename}`);
    console.log(`  URL: ${capture.url}`);

    const env = {
      ...process.env,
      TEST_MODE: 'true',
      TEST_URL: capture.url,
      TEST_MODES: capture.mode,
      TEST_RADIUS: CAPTURE_FOVEA_RADIUS,
      TEST_WIDTH: CAPTURE_WIDTH,
      TEST_HEIGHT: CAPTURE_HEIGHT,
      TEST_FIXATION_X: '0.5',
      TEST_FIXATION_Y: '0.5',
      TEST_OVERLAY: 'false',
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
        // Screenshots land in tests/golden-captures/v{major.minor}/ — move to output dir
        const packageVersion = require(path.join(ROOT, 'package.json')).version.replace(/\.\d+$/, '');
        const src = path.join(ROOT, 'tests', 'golden-captures', `v${packageVersion}`, filename);
        const dest = path.join(OUTPUT_DIR, filename);
        if (fs.existsSync(src)) {
          fs.renameSync(src, dest);
          console.log(`  → ${dest}`);
        } else {
          console.warn(`  Warning: expected screenshot not found at ${src}`);
          // Check alternate locations
          const altSrc = path.join(ROOT, 'tests', 'golden-captures', filename);
          if (fs.existsSync(altSrc)) {
            fs.renameSync(altSrc, dest);
            console.log(`  → ${dest} (from alternate location)`);
          }
        }
      } else {
        console.error(`  Failed (exit ${code}), continuing...`);
      }
      resolve();
    });
  });
}

async function main() {
  console.log(`\nAppendix Baseline Captures (effects disabled)`);
  console.log(`  Total: ${CAPTURES.length} screenshots`);
  console.log(`  Output: ${OUTPUT_DIR}`);
  console.log(`  Window: ${CAPTURE_WIDTH}x${CAPTURE_HEIGHT}`);
  console.log();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (let i = 0; i < CAPTURES.length; i++) {
    await runCapture(CAPTURES[i]);
    if (!dryRun) console.log(`  [${i + 1}/${CAPTURES.length}]\n`);
  }

  console.log('Done.');
}

main().catch(console.error);
