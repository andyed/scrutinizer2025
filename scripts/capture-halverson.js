#!/usr/bin/env node
/**
 * Capture Halverson mixed-density screenshots for Wave 5 validation.
 *
 * Renders the mixed-density stimulus (Halverson & Hornof 2011) through
 * Scrutinizer's pipeline at central fixation, producing paired screenshots
 * (filtered vs baseline) for each density condition.
 *
 * Pages:
 *   - halverson-mixed-density.html?static=true&condition=sparse
 *   - halverson-mixed-density.html?static=true&condition=dense
 *   - halverson-mixed-density.html?static=true&condition=mixed
 *
 * Usage:
 *   node scripts/capture-halverson.js
 *   node scripts/capture-halverson.js --dry-run
 *   node scripts/capture-halverson.js --conditions=mixed  # just one condition
 *   node scripts/capture-halverson.js --ppd=38            # pixels per degree
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
const OUTPUT_DIR = path.join(ROOT, 'tests', 'golden-captures', 'validation', 'halverson');
const REF_PAGE_DIR = path.join(ROOT, 'tests', 'reference-pages');

const PPD = getArg('ppd', '38');
const CAPTURE_WIDTH = '1280';
const CAPTURE_HEIGHT = '720';
// Default fovea radius. 90px at 38 PPD ≈ 2.37°.
// H&H's EPIC model uses 1° (38px) but that's too aggressive for Mode 0.
// Mode 9 (congestion-gated) should handle density discrimination at any radius.
const CAPTURE_FOVEA_RADIUS = getArg('radius', '90');

const dryRun = hasFlag('dry-run');
const conditionsFilter = getArg('conditions', 'all');

// Density conditions from the paper
const DENSITY_CONDITIONS = ['sparse', 'dense', 'mixed'];

// Rendering conditions: Mode 0 (standard), Mode 9 (congestion-gated), baseline (bypass)
const RENDER_CONDITIONS = [
  { id: 'filtered', mode: '0' },
  { id: 'congestion', mode: '9' },
  { id: 'baseline', mode: 'bypass' },
];

function runCapture(densityCond, renderCond) {
  return new Promise((resolve) => {
    const pageUrl = `file://${path.join(REF_PAGE_DIR, 'halverson-mixed-density.html')}?static=true&condition=${densityCond}&ppd=${PPD}&seed=42`;
    const filename = `halverson_${densityCond}_${renderCond.id}.png`;

    if (dryRun) {
      console.log(`[dry-run] ${filename}  →  ${pageUrl}`);
      return resolve();
    }

    console.log(`Capturing: ${filename}`);

    const env = {
      ...process.env,
      TEST_MODE: 'true',
      TEST_URL: pageUrl,
      TEST_MODES: renderCond.mode,
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
        // Screenshots land in the golden-captures/vX.Y directory; move to our output dir
        const packageVersion = require(path.join(ROOT, 'package.json')).version.replace(/\.\d+$/, '');
        const src = path.join(ROOT, 'tests', 'golden-captures', `v${packageVersion}`, filename);
        const dest = path.join(OUTPUT_DIR, filename);
        if (fs.existsSync(src)) {
          fs.renameSync(src, dest);
          console.log(`  → ${dest}`);
        } else {
          console.warn(`  Warning: expected screenshot not found at ${src}`);
          // Try alternate location
          const altSrc = path.join(ROOT, 'tests', 'golden-captures', filename);
          if (fs.existsSync(altSrc)) {
            fs.renameSync(altSrc, dest);
            console.log(`  → ${dest} (from alt location)`);
          }
        }
      } else {
        console.error(`  ✗ Exit code ${code} for ${filename}`);
      }
      resolve();
    });
  });
}

async function main() {
  console.log(`\nHalverson Mixed-Density Capture (Wave 5)`);
  console.log(`  Conditions: ${conditionsFilter}`);
  console.log(`  PPD: ${PPD}`);
  console.log(`  Output: ${OUTPUT_DIR}\n`);

  if (!dryRun) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let count = 0;
  for (const densityCond of DENSITY_CONDITIONS) {
    if (conditionsFilter !== 'all' && conditionsFilter !== densityCond) continue;
    for (const renderCond of RENDER_CONDITIONS) {
      await runCapture(densityCond, renderCond);
      count++;
    }
  }

  console.log(`\nDone. ${count} captures.`);
  console.log(`Run analysis: node scripts/analyze-halverson.js`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
