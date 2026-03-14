#!/usr/bin/env node
/**
 * Capture COCO-Periph images through Scrutinizer's pipeline for Wave 6.
 *
 * Loads each original COCO image as a centered <img> element on a neutral
 * background, captures Scrutinizer's filtered output (mode 0 = MIP+DoG)
 * and a bypass baseline.
 *
 * Follows the capture-crowding.js Electron spawn pattern.
 *
 * Usage:
 *   node scripts/capture-coco-periph.js
 *   node scripts/capture-coco-periph.js --dry-run
 *   node scripts/capture-coco-periph.js --count=5          # first N images only
 *   node scripts/capture-coco-periph.js --mode=10          # custom mode
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
const COCO_DIR = path.join(ROOT, 'tests', 'validation', 'coco-periph');
const OUTPUT_DIR = path.join(COCO_DIR, 'scrutinizer_captures');
const MANIFEST_PATH = path.join(COCO_DIR, 'manifest.json');

const CAPTURE_WIDTH = '1920';
const CAPTURE_HEIGHT = '1080';
const CAPTURE_FOVEA_RADIUS = '90';

const dryRun = hasFlag('dry-run');
const countLimit = parseInt(getArg('count', '0')) || Infinity;
const modeId = getArg('mode', '0');

// The stimulus page loads a COCO image centered on a neutral gray background.
// We generate a minimal HTML file that does this.
const STIMULUS_DIR = path.join(COCO_DIR, 'stimulus_pages');

function generateStimulusPage(imagePath, imageFilename) {
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>COCO-Periph Stimulus: ${imageFilename}</title>
<style>
  * { margin: 0; padding: 0; }
  body {
    width: 1920px;
    height: 1080px;
    background: #808080;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  img {
    max-width: 768px;
    max-height: 768px;
    image-rendering: auto;
  }
</style>
</head>
<body>
  <img src="${imagePath}" alt="${imageFilename}">
</body>
</html>`;

  fs.mkdirSync(STIMULUS_DIR, { recursive: true });
  const pagePath = path.join(STIMULUS_DIR, `stimulus_${imageFilename.replace(/\.\w+$/, '.html')}`);
  fs.writeFileSync(pagePath, html);
  return pagePath;
}

function runCapture(stimulusUrl, outputFilename, mode) {
  return new Promise((resolve) => {
    if (dryRun) {
      console.log(`  [dry-run] ${outputFilename}`);
      return resolve(true);
    }

    const env = {
      ...process.env,
      TEST_MODE: 'true',
      TEST_URL: stimulusUrl,
      TEST_MODES: mode,
      TEST_RADIUS: CAPTURE_FOVEA_RADIUS,
      TEST_WIDTH: CAPTURE_WIDTH,
      TEST_HEIGHT: CAPTURE_HEIGHT,
      TEST_FIXATION_X: '0.5',
      TEST_FIXATION_Y: '0.5',
      TEST_OVERLAY: 'false',
      TEST_OUTPUT_FILENAME: outputFilename,
      TEST_WAIT_CONGESTION: 'false',
      SCREENSHOT_MODE: 'update',
      ELECTRON_RUN_AS_NODE: undefined,
    };

    const child = spawn('npm', ['start'], {
      cwd: ROOT,
      env,
      stdio: 'pipe', // suppress Electron output noise
    });

    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code === 0) {
        // Move screenshot from golden-captures to our output dir
        const packageVersion = require(path.join(ROOT, 'package.json')).version.replace(/\.\d+$/, '');
        const src = path.join(ROOT, 'tests', 'golden-captures', `v${packageVersion}`, outputFilename);
        const dest = path.join(OUTPUT_DIR, outputFilename);

        if (fs.existsSync(src)) {
          fs.renameSync(src, dest);
          resolve(true);
        } else {
          console.warn(`  Warning: screenshot not found at ${src}`);
          resolve(false);
        }
      } else {
        console.error(`  Capture failed (exit ${code})`);
        if (stderr.length > 0) {
          console.error(`  stderr: ${stderr.slice(0, 200)}`);
        }
        resolve(false);
      }
    });
  });
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found: ${MANIFEST_PATH}`);
    console.error('Run: node scripts/download-coco-periph.js');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const images = manifest.images.slice(0, countLimit);

  // Each image gets two captures: filtered (mode 0) and baseline (bypass)
  const conditions = [
    { id: 'filtered', mode: modeId },
    { id: 'baseline', mode: 'bypass' },
  ];

  const total = images.length * conditions.length;

  console.log('\nWave 6: COCO-Periph Capture');
  console.log(`  Images: ${images.length}`);
  console.log(`  Conditions: ${conditions.map(c => c.id).join(', ')} (mode=${modeId})`);
  console.log(`  Total: ${total} screenshots`);
  console.log(`  Output: ${OUTPUT_DIR}`);
  if (dryRun) console.log('  Mode: dry-run');
  console.log();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let captured = 0;
  let failed = 0;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const origPath = path.join(COCO_DIR, 'original', img.filename);

    if (!fs.existsSync(origPath)) {
      console.warn(`  Skipping ${img.filename}: original not found`);
      failed += conditions.length;
      continue;
    }

    // Generate stimulus HTML page
    const absOrigPath = path.resolve(origPath);
    const stimulusPage = generateStimulusPage(`file://${absOrigPath}`, img.filename);
    const stimulusUrl = `file://${stimulusPage}`;

    for (const condition of conditions) {
      const baseName = img.filename.replace(/\.\w+$/, '');
      const outputFilename = `coco_${baseName}_${condition.id}.png`;

      // Skip if already captured
      const destPath = path.join(OUTPUT_DIR, outputFilename);
      if (fs.existsSync(destPath) && !hasFlag('force')) {
        console.log(`  [skip] ${outputFilename} (exists)`);
        captured++;
        continue;
      }

      console.log(`  [${captured + failed + 1}/${total}] ${outputFilename}`);
      const success = await runCapture(stimulusUrl, outputFilename, condition.mode);

      if (success) {
        captured++;
      } else {
        failed++;
      }
    }
  }

  console.log(`\nDone. ${captured} captured, ${failed} failed.`);
  if (!dryRun) {
    console.log('Next: node scripts/analyze-coco-periph.js');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
