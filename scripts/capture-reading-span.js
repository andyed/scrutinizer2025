#!/usr/bin/env node
/**
 * Reading Span Capture
 *
 * Tests the asymmetric foveal envelope (Rayner 1998) by animating a horizontal
 * gaze trajectory over text content. Captures at mid-sweep so GazeModel has
 * built up directional velocity, revealing the fovea shift.
 *
 * Produces 5 captures per page:
 *   1. Static fixation (baseline: symmetric fovea)
 *   2. Left-to-right sweep (reading direction: protection should extend RIGHT)
 *   3. Left-to-right sweep with reading_span OFF (control)
 *   4. Right-to-left sweep (reverse: protection should extend LEFT)
 *   5. Right-to-left sweep with reading_span OFF (control)
 *
 * It also writes reading-span-manifest.json (trajectories and filenames) for
 * scripts/check-reading-span-direction.js, which asserts the direction.
 *
 * The pointer must be over body text at the capture point, or the shader's
 * text gate keeps reading span off and every capture looks like its control.
 * The defaults land on the bullet list of tests/reference-pages/article.html at
 * the default window size; override with READING_SPAN_Y / READING_SPAN_X0 /
 * READING_SPAN_X1 (normalized 0-1) if the layout changes.
 *
 * Usage:
 *   node scripts/capture-reading-span.js
 *   node scripts/capture-reading-span.js --page=article
 *   node scripts/check-reading-span-direction.js
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'tests', 'golden-captures', 'reading-span');

const pageArg = process.argv.find(a => a.startsWith('--page='));
const page = pageArg ? pageArg.split('=')[1] : 'article';

// Body-text row and the horizontal extent of the text column (normalized).
// Checked 2026-10-02: y=0.883 is a bullet-list line; x 0.24-0.50 stays inside
// the column. The 2026-03 values (y=0.85, x 0.15-0.85) put the capture point on
// the byline row or past the end of the text, so reading span never activated.
const TEXT_Y = parseFloat(process.env.READING_SPAN_Y || '0.883');
const X0 = parseFloat(process.env.READING_SPAN_X0 || '0.24');
const X1 = parseFloat(process.env.READING_SPAN_X1 || '0.50');
// 1500 ms over the span gives ~0.2 px/ms, inside the shader's pursuit speed gate.
const SWEEP_MS = 1500;
const CAPTURE_AT = 0.55;

const LTR = `${X0},${TEXT_Y},${X1},${TEXT_Y},${SWEEP_MS},${CAPTURE_AT}`;
const RTL = `${X1},${TEXT_Y},${X0},${TEXT_Y},${SWEEP_MS},${CAPTURE_AT}`;

const SCENARIOS = [
  {
    id: 'static_center',
    label: 'Static fixation (baseline)',
    trajectory: null,
    fixationX: (X0 + X1) / 2,
    fixationY: TEXT_Y,
    readingSpan: 'true',
  },
  {
    id: 'sweep_ltr',
    label: 'Left-to-right sweep (reading span should extend RIGHT)',
    // startX,startY,endX,endY,durationMs,captureAtNorm
    trajectory: LTR,
    readingSpan: 'true',
  },
  {
    id: 'sweep_ltr_disabled',
    label: 'Left-to-right sweep, reading span OFF (control)',
    trajectory: LTR,
    readingSpan: 'false',
  },
  {
    id: 'sweep_rtl',
    label: 'Right-to-left sweep (reading span should extend LEFT)',
    trajectory: RTL,
    readingSpan: 'true',
  },
  {
    id: 'sweep_rtl_disabled',
    label: 'Right-to-left sweep, reading span OFF (control)',
    trajectory: RTL,
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

  const manifest = {
    page,
    created: new Date().toISOString(),
    text_y: TEXT_Y, x0: X0, x1: X1, sweep_ms: SWEEP_MS, capture_at: CAPTURE_AT,
    files: Object.fromEntries(SCENARIOS.map(s => [s.id, `${page}_${s.id}.png`])),
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'reading-span-manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\nReading span captures complete.`);
  console.log(`Files in: ${OUTPUT_DIR}`);
  console.log(`\nExpected results:`);
  console.log(`  static_center:       Symmetric fovea (no motion)`);
  console.log(`  sweep_ltr:           Fovea protection extends RIGHT (ahead of reading)`);
  console.log(`  sweep_rtl:           Fovea protection extends LEFT (ahead of reverse)`);
  console.log(`  sweep_ltr_disabled:  Symmetric fovea despite motion (control)`);
  console.log(`  sweep_rtl_disabled:  Symmetric fovea despite motion (control)`);
  console.log(`\nCheck the direction: node scripts/check-reading-span-direction.js`);
}

main();
