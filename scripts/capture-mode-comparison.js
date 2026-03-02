#!/usr/bin/env node
/**
 * Mode Comparison Capture
 *
 * Captures the same page under modes 0 (smoothstep), 6 (Log-Polar MIP), and 8 (Gaussian)
 * for side-by-side comparison in the blog post.
 *
 * Usage:
 *   node scripts/capture-mode-comparison.js
 *   node scripts/capture-mode-comparison.js --page=dashboard
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'docs', 'golden', 'mode-comparison');

const pageArg = process.argv.find(a => a.startsWith('--page='));
const pages = pageArg ? [pageArg.split('=')[1]] : ['dashboard', 'article'];

const MODES = [
  { id: 'mode0_smoothstep', mode: '0', label: 'Mode 0 — Smoothstep (High-Key)' },
  { id: 'mode6_logpolar',   mode: '6', label: 'Mode 6 — Log-Polar MIP (Blauch 2026)' },
  { id: 'mode7_legacy',     mode: '7', label: 'Mode 7 — Legacy v1.6' },
  { id: 'mode8_gaussian',   mode: '8', label: 'Mode 8 — Gaussian Desaturation' },
];

console.log(`\n🎯 Mode Comparison Capture`);
console.log(`   Pages: ${pages.join(', ')}`);
console.log(`   Modes: ${MODES.map(m => m.id).join(', ')}`);
console.log(`   Output: ${OUTPUT_DIR}\n`);

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function runCapture(page, modeConfig) {
  return new Promise((resolve, reject) => {
    const BASE_URL = process.env.BASE_URL || 'https://andyed.github.io/scrutinizer-www/reference-pages';
    const pageUrl = `${BASE_URL}/${page}.html`;
    const filename = `${page}_center_${modeConfig.id}.png`;

    console.log(`📸 ${modeConfig.label}`);
    console.log(`   → ${filename}`);

    const env = {
      ...process.env,
      TEST_MODE: 'true',
      TEST_URL: pageUrl,
      TEST_MODES: modeConfig.mode,
      TEST_FIXATION_X: '0.5',
      TEST_FIXATION_Y: '0.5',
      TEST_OVERLAY: 'true',
      TEST_MOBILE_EMULATION: 'false',
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
        // Copy from test captures to comparison dir
        const src = path.join(ROOT, 'tests', 'golden-captures', `v1.7.0`, filename);
        const dest = path.join(OUTPUT_DIR, filename);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
          console.log(`   ✅ ${filename}\n`);
        } else {
          console.log(`   ⚠️  Output not found at ${src}\n`);
        }
        resolve();
      } else {
        console.error(`   ❌ Failed (exit ${code})\n`);
        reject(new Error(`Exit code ${code}`));
      }
    });
  });
}

async function main() {
  for (const page of pages) {
    console.log(`\n━━━ ${page.toUpperCase()} ━━━`);
    for (const modeConfig of MODES) {
      try {
        await runCapture(page, modeConfig);
      } catch (e) {
        console.error(`Skipping ${page}/${modeConfig.id}, continuing...`);
      }
    }
  }

  console.log(`\n🎉 Comparison captures complete.`);
  console.log(`   Files in: ${OUTPUT_DIR}`);
  console.log(`\n   Copy to www for blog post:`);
  console.log(`   cp ${OUTPUT_DIR}/*.png ../scrutinizer-www/src/blog/images/`);
}

main();
