#!/usr/bin/env node
/**
 * Reading Span Capture
 *
 * Tests the asymmetric foveal envelope (Rayner 1998) by animating a horizontal
 * gaze trajectory over text content. Captures at mid-sweep so GazeModel has
 * built up directional velocity, revealing the fovea shift.
 *
 * Produces 4 captures per page:
 *   1. Static fixation (baseline — symmetric fovea)
 *   2. Left-to-right sweep (reading direction — fovea should extend RIGHT)
 *   3. Right-to-left sweep (reverse — fovea should extend LEFT)
 *   4. Left-to-right with reading_span OFF (control — symmetric despite motion)
 *
 * Usage:
 *   node scripts/capture-reading-span.js
 *   node scripts/capture-reading-span.js --page=article
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'tests', 'golden-captures', 'reading-span');

const pageArg = process.argv.find(a => a.startsWith('--page='));
const page = pageArg ? pageArg.split('=')[1] : 'article';

// Y position: 0.85 lands in the article body paragraphs
// (nav + padding + hero + breadcrumb + h1 + byline + lead ≈ 780px)
// At 1012px viewport: 0.85 = ~860px, squarely in body text
const TEXT_Y = 0.85;

const SCENARIOS = [
  {
    id: 'static_center',
    label: 'Static fixation (baseline)',
    trajectory: null,
    fixationX: 0.5,
    fixationY: TEXT_Y,
    readingSpan: 'true',
  },
  {
    id: 'sweep_ltr',
    label: 'Left-to-right sweep (reading span should extend RIGHT)',
    // startX,startY,endX,endY,durationMs,captureAtNorm
    trajectory: `0.15,${TEXT_Y},0.85,${TEXT_Y},2500,0.55`,
    readingSpan: 'true',
  },
  {
    id: 'sweep_rtl',
    label: 'Right-to-left sweep (reading span should extend LEFT)',
    trajectory: `0.85,${TEXT_Y},0.15,${TEXT_Y},2500,0.55`,
    readingSpan: 'true',
  },
  {
    id: 'sweep_ltr_disabled',
    label: 'Left-to-right sweep, reading span OFF (control)',
    trajectory: `0.15,${TEXT_Y},0.85,${TEXT_Y},2500,0.55`,
    readingSpan: 'false',
  },
];

console.log(`\n--- Reading Span Capture ---`);
console.log(`  Page: ${page}`);
console.log(`  Scenarios: ${SCENARIOS.length}`);
console.log(`  Output: ${OUTPUT_DIR}\n`);

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function runCapture(scenario) {
  return new Promise((resolve, reject) => {
    const pageUrl = `file://${path.join(ROOT, 'tests', 'reference-pages', `${page}.html`)}`;
    const filename = `${page}_${scenario.id}.png`;

    console.log(`  ${scenario.label}`);
    console.log(`    -> ${filename}`);

    const env = {
      ...process.env,
      TEST_MODE: 'true',
      TEST_URL: pageUrl,
      TEST_MODES: '10', // compute_mongrel (default mode with reading_span=true)
      TEST_OVERLAY: 'true',
      TEST_MOBILE_EMULATION: 'false',
      TEST_RADIUS: '90', // Larger fovea makes the shift more visible
      TEST_OUTPUT_FILENAME: filename,
      SCREENSHOT_MODE: 'update',
      ELECTRON_RUN_AS_NODE: undefined,
    };

    // Static fixation or trajectory
    if (scenario.trajectory) {
      env.TEST_GAZE_TRAJECTORY = scenario.trajectory;
    } else {
      env.TEST_FIXATION_X = String(scenario.fixationX);
      env.TEST_FIXATION_Y = String(scenario.fixationY);
    }

    // Reading span override
    env.TEST_READING_SPAN = scenario.readingSpan;

    const child = spawn('npm', ['start'], {
      cwd: ROOT,
      env,
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      if (code === 0) {
        // Find the output file
        const packageVersion = require(path.join(ROOT, 'package.json')).version.replace(/\.\d+$/, '');
        const src = path.join(ROOT, 'tests', 'golden-captures', `v${packageVersion}`, filename);
        const dest = path.join(OUTPUT_DIR, filename);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
          console.log(`    OK: ${filename}\n`);
        } else {
          console.log(`    Warning: output not found at ${src}\n`);
        }
        resolve();
      } else {
        console.error(`    FAILED (exit ${code})\n`);
        reject(new Error(`Exit code ${code}`));
      }
    });
  });
}

async function main() {
  for (const scenario of SCENARIOS) {
    try {
      await runCapture(scenario);
    } catch (e) {
      console.error(`  Skipping ${scenario.id}: ${e.message}`);
    }
  }

  console.log(`\nReading span captures complete.`);
  console.log(`Files in: ${OUTPUT_DIR}`);
  console.log(`\nExpected results:`);
  console.log(`  static_center:       Symmetric fovea (no motion)`);
  console.log(`  sweep_ltr:           Fovea protection extends RIGHT (ahead of reading)`);
  console.log(`  sweep_rtl:           Fovea protection extends LEFT (ahead of reverse)`);
  console.log(`  sweep_ltr_disabled:  Symmetric fovea despite motion (control)`);
}

main();
