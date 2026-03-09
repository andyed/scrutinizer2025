#!/usr/bin/env node
/**
 * Capture raw (unfiltered) stimulus screenshots using Playwright.
 *
 * These bypass Scrutinizer entirely — just the HTML pages as rendered
 * by a standard Chromium browser. For arxiv paper appendix Figure A1.
 *
 * Usage:
 *   npx playwright test scripts/capture-raw-stimuli.js
 *   -- or --
 *   node scripts/capture-raw-stimuli.js
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'arxiv-paper', 'figures', 'baselines');
const BASE_URL = process.env.BASE_URL || 'https://andyed.github.io/scrutinizer-www/reference-pages';

const VIEWPORT = { width: 1920, height: 1080 };

const PAGES = [
  {
    id: 'chromatic_raw',
    url: `${BASE_URL}/color-search.html?color=red&size=24&mode=bands&seed=42`,
    // color-search has an intro panel — need to click to start
    setup: async (page) => {
      // Wait for the intro panel, then click to dismiss
      await page.waitForTimeout(1000);
      // Click anywhere to start the trial
      await page.click('body');
      await page.waitForTimeout(500);
    },
  },
  {
    id: 'spatial_raw',
    url: `${BASE_URL}/spatial-acuity.html?mode=single&freq=1&chromatic=achromatic&contrast=1`,
    setup: async (page) => {
      await page.waitForTimeout(1500); // Canvas needs time to render
    },
  },
  {
    id: 'crowding_raw',
    url: `${BASE_URL}/crowding.html`,
    setup: async (page) => {
      await page.waitForTimeout(1000);
    },
  },
  {
    id: 'saliency_raw',
    url: `${BASE_URL}/saliency-popout.html`,
    setup: async (page) => {
      await page.waitForTimeout(1500); // Face image needs to load
    },
  },
];

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('Launching Chromium...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2, // Retina-equivalent
  });

  for (const pageConf of PAGES) {
    const page = await context.newPage();
    console.log(`Capturing: ${pageConf.id}`);
    console.log(`  URL: ${pageConf.url}`);

    await page.goto(pageConf.url, { waitUntil: 'networkidle' });

    if (pageConf.setup) {
      await pageConf.setup(page);
    }

    const dest = path.join(OUTPUT_DIR, `${pageConf.id}.png`);
    await page.screenshot({ path: dest, fullPage: false });
    console.log(`  → ${dest}`);

    await page.close();
  }

  await browser.close();
  console.log('Done.');
}

main().catch(console.error);
