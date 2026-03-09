#!/usr/bin/env node
/**
 * Capture saliency screenshots for Wave 4 validation.
 *
 * Captures popout and face-test pages through Scrutinizer in multiple modes:
 *   - saliency debug view (R channel = saliency intensity)
 *   - filtered with saliency modulation ON
 *   - filtered with saliency modulation OFF
 *   - baseline (bypass, unfiltered)
 *
 * Usage:
 *   node scripts/capture-saliency.js
 *   node scripts/capture-saliency.js --dry-run
 *   node scripts/capture-saliency.js --pages=popout   # just popout page
 *   node scripts/capture-saliency.js --pages=face      # just face page
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
const OUTPUT_DIR = path.join(ROOT, 'tests', 'golden-captures', 'validation', 'saliency');
const BASE_URL = process.env.BASE_URL || 'https://andyed.github.io/scrutinizer-www/reference-pages';

const CAPTURE_FOVEA_RADIUS = '90';
const CAPTURE_WIDTH = '1920';
const CAPTURE_HEIGHT = '1080';

const dryRun = hasFlag('dry-run');
const pagesFilter = getArg('pages', 'all');

const onlyGaussian = hasFlag('gaussian-only');

// Capture matrix: 11 captures across 2 pages × multiple conditions
// Gaussian conditions added for DoG vs Gaussian comparison (uniform blur, no saliency gating)
const CAPTURES = [
  // Test 4A: Saliency debug view of popout stimulus
  {
    id: 'popout_saliency',
    page: 'saliency-popout.html',
    mode: 'saliency',
    saliencyMod: null,    // default
    gaussianBlur: 'false',
    group: 'popout',
  },
  // Test 4B: Protection captures for popout
  {
    id: 'popout_filtered_mod_on',
    page: 'saliency-popout.html',
    mode: '0',
    saliencyMod: 'true',
    gaussianBlur: 'false',
    group: 'popout',
  },
  {
    id: 'popout_filtered_mod_off',
    page: 'saliency-popout.html',
    mode: '0',
    saliencyMod: 'false',
    gaussianBlur: 'false',
    group: 'popout',
  },
  {
    id: 'popout_baseline',
    page: 'saliency-popout.html',
    mode: 'bypass',
    saliencyMod: null,
    gaussianBlur: 'false',
    group: 'popout',
  },
  // Test 4C: Gaussian blur on popout — same eccentricity scaling, no saliency gating
  {
    id: 'popout_gaussian',
    page: 'saliency-popout.html',
    mode: '0',
    saliencyMod: 'false',
    gaussianBlur: 'true',
    group: 'popout',
  },
  // Face-test saliency + protection
  {
    id: 'face_saliency',
    page: 'saliency-face.html',
    mode: 'saliency',
    saliencyMod: null,
    gaussianBlur: 'false',
    group: 'face',
  },
  {
    id: 'face_filtered_mod_on',
    page: 'saliency-face.html',
    mode: '0',
    saliencyMod: 'true',
    gaussianBlur: 'false',
    group: 'face',
  },
  {
    id: 'face_filtered_mod_off',
    page: 'saliency-face.html',
    mode: '0',
    saliencyMod: 'false',
    gaussianBlur: 'false',
    group: 'face',
  },
  // Test 4D: Gaussian blur on face — same eccentricity scaling, no saliency gating
  {
    id: 'face_gaussian',
    page: 'saliency-face.html',
    mode: '0',
    saliencyMod: 'false',
    gaussianBlur: 'true',
    group: 'face',
  },
];

function runCapture(capture) {
  return new Promise((resolve) => {
    const pageUrl = `${BASE_URL}/${capture.page}`;

    const filename = `${capture.id}.png`;

    if (dryRun) {
      console.log(`[dry-run] ${filename}  →  mode=${capture.mode}, saliencyMod=${capture.saliencyMod || 'default'}  ${pageUrl}`);
      return resolve();
    }

    console.log(`Capturing: ${filename} (mode=${capture.mode}, saliencyMod=${capture.saliencyMod || 'default'})`);

    const env = {
      ...process.env,
      TEST_MODE: 'true',
      TEST_URL: pageUrl,
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

    // Set saliency modulation if specified
    if (capture.saliencyMod !== null) {
      env.TEST_ENABLE_SALIENCY_MODULATION = capture.saliencyMod;
    }

    // Gaussian blur comparison mode
    if (capture.gaussianBlur) {
      env.TEST_GAUSSIAN_BLUR = capture.gaussianBlur;
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
  let captures = CAPTURES.filter(c =>
    pagesFilter === 'all' || c.group === pagesFilter
  );
  if (onlyGaussian) {
    captures = captures.filter(c => c.gaussianBlur === 'true');
  }

  console.log(`\nWave 4 Saliency Capture`);
  console.log(`  Pages: ${[...new Set(captures.map(c => c.group))].join(', ')}`);
  console.log(`  Total: ${captures.length} screenshots`);
  console.log(`  Output: ${OUTPUT_DIR}`);
  console.log();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let captured = 0;
  for (const capture of captures) {
    await runCapture(capture);
    captured++;
    if (!dryRun) console.log(`  [${captured}/${captures.length}]\n`);
  }

  if (dryRun) {
    console.log(`\n${captures.length} captures would run. Remove --dry-run to execute.`);
  } else {
    console.log(`\nDone. ${captured} captures completed.`);
    console.log(`Run analysis:`);
    console.log(`  node scripts/analyze-saliency.js --popout --dir=${OUTPUT_DIR}`);
    console.log(`  node scripts/analyze-saliency.js --protection --dir=${OUTPUT_DIR}`);
  }
}

main();
