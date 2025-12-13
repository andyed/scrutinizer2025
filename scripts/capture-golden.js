#!/usr/bin/env node
/**
 * Golden Capture Script
 * 
 * Captures screenshots of reference pages for visual regression testing.
 * 
 * Usage:
 *   npm run capture-golden                    # Capture current version
 *   npm run capture-golden -- --version=1.5.0 # Capture specific version
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Get version from args or package.json
const args = process.argv.slice(2);
const versionArg = args.find(a => a.startsWith('--version='));
const version = versionArg
    ? versionArg.split('=')[1]
    : require('../package.json').version;

const REFERENCE_PAGES = ['dashboard', 'article', 'ecommerce'];
const MODES = [0]; // Default mode only, add more as needed
const OUTPUT_DIR = path.join(__dirname, '..', 'tests', 'golden-captures', `v${version}`);

console.log(`\n🎯 Golden Capture Script`);
console.log(`   Version: v${version}`);
console.log(`   Output: ${OUTPUT_DIR}\n`);

// Create output directory
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`📁 Created directory: ${OUTPUT_DIR}`);
}

console.log(`\n📋 Instructions:`);
console.log(`   1. For each page below, capture a screenshot manually`);
console.log(`   2. Save to: ${OUTPUT_DIR}/`);
console.log(`   3. Use naming: {page}_mode{N}.png\n`);

REFERENCE_PAGES.forEach(page => {
    const pagePath = path.resolve(__dirname, '..', 'tests', 'reference-pages', `${page}.html`);
    const fileUrl = `file://${pagePath}`;

    console.log(`\n📄 ${page.toUpperCase()}`);
    console.log(`   URL: ${fileUrl}`);
    console.log(`   Expected files:`);
    MODES.forEach(mode => {
        const filename = `${page}_mode${mode}.png`;
        const fullPath = path.join(OUTPUT_DIR, filename);
        const exists = fs.existsSync(fullPath);
        console.log(`   ${exists ? '✅' : '⬜'} ${filename}`);
    });
});

// Print npm start command
console.log(`\n🚀 Quick Start Commands:`);
REFERENCE_PAGES.forEach(page => {
    const pagePath = path.resolve(__dirname, '..', 'tests', 'reference-pages', `${page}.html`);
    console.log(`   npm start -- "file://${pagePath}"`);
});

console.log(`\n💡 Tips:`);
console.log(`   - Enable foveal mode: Cmd+Shift+F`);
console.log(`   - Set aesthetic mode: Simulation > Behavior > Aesthetic Mode`);
console.log(`   - Screenshot: Cmd+Shift+4 (macOS)\n`);

// Check completion
const completed = REFERENCE_PAGES.every(page =>
    MODES.every(mode => fs.existsSync(path.join(OUTPUT_DIR, `${page}_mode${mode}.png`)))
);

if (completed) {
    console.log(`✅ All golden captures complete for v${version}!\n`);
} else {
    console.log(`⏳ Waiting for captures... Run this script again to check progress.\n`);
}
