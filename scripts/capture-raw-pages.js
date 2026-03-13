#!/usr/bin/env node
/**
 * Capture raw (unfiltered) page screenshots using Playwright.
 *
 * These bypass Scrutinizer entirely — just the HTML pages as rendered
 * by a standard Chromium browser. Used as input to Brown et al.'s
 * offline Portilla-Simoncelli metamer pipeline for D3 ground truth.
 *
 * Usage:
 *   node scripts/capture-raw-pages.js
 *   node scripts/capture-raw-pages.js --scale=0.5   # half-res for fast iteration
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = path.join(__dirname, '..', 'tests', 'golden-captures', 'raw');
const BASE_URL = process.env.BASE_URL || 'https://andyed.github.io/scrutinizer-www/reference-pages';

// Parse --scale arg (default 1.0 = full 1920x1080)
const scaleArg = process.argv.find(a => a.startsWith('--scale='));
const scale = scaleArg ? parseFloat(scaleArg.split('=')[1]) : 1.0;

const BASE_WIDTH = 1920;
const BASE_HEIGHT = 1080;
const VIEWPORT = {
  width: Math.round(BASE_WIDTH * scale),
  height: Math.round(BASE_HEIGHT * scale)
};

// Pages matching capture-golden.js page list + fixation definitions
const PAGES = [
  {
    id: 'dashboard',
    url: `${BASE_URL}/dashboard.html`,
    fixation: 'center',
    gaze: [0.5, 0.5],
    setup: async (page) => { await page.waitForTimeout(1500); }
  },
  {
    id: 'article',
    url: `${BASE_URL}/article.html`,
    fixation: 'center',
    gaze: [0.5, 0.5],
    setup: async (page) => { await page.waitForTimeout(1500); }
  },
  {
    id: 'ecommerce',
    url: `${BASE_URL}/ecommerce.html`,
    fixation: 'center',
    gaze: [0.5, 0.5],
    setup: async (page) => { await page.waitForTimeout(1500); }
  },
  {
    id: 'techmeme',
    url: `${BASE_URL}/techmeme.html`,
    fixation: 'center',
    gaze: [0.5, 0.5],
    setup: async (page) => { await page.waitForTimeout(1500); }
  },
  {
    id: 'crowding',
    url: `${BASE_URL}/crowding.html`,
    fixation: 'center',
    gaze: [0.5, 0.5],
    setup: async (page) => { await page.waitForTimeout(1000); }
  },
  {
    id: 'color-spectrum',
    url: `${BASE_URL}/color-spectrum.html`,
    fixation: 'center',
    gaze: [0.5, 0.5],
    setup: async (page) => { await page.waitForTimeout(1000); }
  }
];

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`Launching Chromium...`);
  console.log(`  Viewport: ${VIEWPORT.width}x${VIEWPORT.height} (scale=${scale})`);
  console.log(`  Output: ${OUTPUT_DIR}`);

  const browser = await chromium.launch({ headless: true });
  // deviceScaleFactor: 1 — match pixel dimensions exactly, no Retina scaling.
  // Golden captures at v2.3 may be 2x DPR; raw captures must be 1x for Brown pipeline.
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1
  });

  for (const pageConf of PAGES) {
    const page = await context.newPage();
    const filename = `${pageConf.id}_${pageConf.fixation}_raw.png`;
    console.log(`Capturing: ${filename}`);
    console.log(`  URL: ${pageConf.url}`);

    await page.goto(pageConf.url, { waitUntil: 'networkidle' });

    if (pageConf.setup) {
      await pageConf.setup(page);
    }

    const dest = path.join(OUTPUT_DIR, filename);
    await page.screenshot({ path: dest, fullPage: false });
    console.log(`  -> ${dest}`);

    await page.close();
  }

  // Write gaze manifest for batch processing by generate-brown-metamers.py
  const manifest = PAGES.map(p => ({
    page: p.id,
    fixation: p.fixation,
    gaze: p.gaze,
    file: `${p.id}_${p.fixation}_raw.png`,
    width: VIEWPORT.width,
    height: VIEWPORT.height
  }));
  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest: ${manifestPath}`);

  await browser.close();
  console.log('Done.');
}

main().catch(console.error);
