#!/usr/bin/env node
/**
 * Capture crowding screenshots for Wave 3 validation.
 *
 * Captures three stimulus pages through Scrutinizer's filter and without it,
 * producing paired screenshots for crowding analysis.
 *
 * Pages:
 *   - crowding.html: letters at 3°, 6°, 10° with crowded + isolated conditions
 *   - crowding-spacing.html: Bouma parametric (0.2x to 0.8x spacing at 6°)
 *   - crowding-stimulus.html: orientation, color, complexity conditions
 *
 * Usage:
 *   node scripts/capture-crowding.js
 *   node scripts/capture-crowding.js --dry-run
 *   node scripts/capture-crowding.js --pages=spacing  # just Bouma parametric
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
function getArg(name, def) {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'tests', 'golden-captures', 'validation', 'crowding');
const BASE_URL = process.env.BASE_URL || 'https://andyed.github.io/scrutinizer-www/reference-pages';

const CAPTURE_FOVEA_RADIUS = '90';
const CAPTURE_WIDTH = '1920';
const CAPTURE_HEIGHT = '1080';

const dryRun = hasFlag('dry-run');
const pagesFilter = getArg('pages', 'all');

// Capture matrix: page × fixation × condition (filtered vs baseline)
// Fixation coordinates are normalized (0-1) for the capture viewport.
const PAGES = [
  {
    id: 'crowding',
    page: 'crowding.html',
    fixations: [
      // Center fixation — targets at 3°, 6°, 10° above and below
      { id: 'center', x: 0.5, y: 0.5 },
    ]
  },
  {
    id: 'spacing',
    page: 'crowding-spacing.html',
    fixations: [
      // Center fixation — target at 6° right, spacing varies vertically
      { id: 'center', x: 0.5, y: 0.5 },
    ]
  },
  {
    id: 'stimulus',
    page: 'crowding-stimulus.html',
    fixations: [
      { id: 'center', x: 0.5, y: 0.5 },
    ]
  },
];

const CONDITIONS = [
  { id: 'filtered', mode: '0' },
  { id: 'baseline', mode: 'bypass' },
];

function runCapture(pageConf, fixation, condition) {
  return new Promise((resolve) => {
    const pageUrl = `${BASE_URL}/${pageConf.page}`;
    const filename = `${pageConf.id}_${fixation.id}_${condition.id}.png`;

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
      TEST_FIXATION_X: String(fixation.x),
      TEST_FIXATION_Y: String(fixation.y),
      TEST_OVERLAY: 'false',
      TEST_OUTPUT_FILENAME: filename,
      TEST_WAIT_CONGESTION: 'true',
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
  const pages = PAGES.filter(p => pagesFilter === 'all' || p.id === pagesFilter);
  const total = pages.reduce((n, p) => n + p.fixations.length * CONDITIONS.length, 0);

  console.log(`\nWave 3 Crowding Capture`);
  console.log(`  Pages: ${pages.map(p => p.id).join(', ')}`);
  console.log(`  Conditions: ${CONDITIONS.map(c => c.id).join(', ')}`);
  console.log(`  Total: ${total} screenshots`);
  console.log(`  Output: ${OUTPUT_DIR}`);
  console.log();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let captured = 0;
  for (const page of pages) {
    for (const fixation of page.fixations) {
      for (const condition of CONDITIONS) {
        await runCapture(page, fixation, condition);
        captured++;
        if (!dryRun) console.log(`  [${captured}/${total}]\n`);
      }
    }
  }

  if (dryRun) {
    console.log(`\n${total} captures would run. Remove --dry-run to execute.`);
  } else {
    console.log(`\nDone. ${captured} captures completed.`);
    console.log(`Run analysis: node scripts/analyze-crowding.js`);
  }
}

main();
