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

const REFERENCE_PAGES = ['dashboard', 'article', 'ecommerce', 'techmeme', 'figma', 'grid'];
const FIXATIONS = ['center', 'top_left', 'sidebar']; // Fixation points
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
console.log(`   3. Use naming: {page}_{fixation}.png\n`);

REFERENCE_PAGES.forEach(page => {
    const pagePath = path.resolve(__dirname, '..', 'tests', 'reference-pages', `${page}.html`);
    const fileUrl = `file://${pagePath}`;

    console.log(`\n📄 ${page.toUpperCase()}`);
    console.log(`   URL: ${fileUrl}`);
    console.log(`   Expected files:`);
    FIXATIONS.forEach(fixation => {
        const filename = `${page}_${fixation}.png`;
        const fullPath = path.join(OUTPUT_DIR, filename);
        const exists = fs.existsSync(fullPath);
        console.log(`   ${exists ? '✅' : '⬜'} ${filename}`);

        // Subset for Overlay Variants (Techmeme & Figma only)
        if (page === 'techmeme' || page === 'figma') {
            const overlayFilename = `${page}_${fixation}_overlay.png`;
            const overlayPath = path.join(OUTPUT_DIR, overlayFilename);
            const overlayExists = fs.existsSync(overlayPath);
            console.log(`   ${overlayExists ? '✅' : '⬜'} ${overlayFilename} (with debug overlay)`);
        }
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
console.log(`   - Move mouse to fixation point (Center, Top-Left, Sidebar)`);
console.log(`   - Screenshot: Cmd+Shift+4 (macOS)\n`);

// Check completion
const completed = REFERENCE_PAGES.every(page =>
    FIXATIONS.every(fixation => {
        const base = fs.existsSync(path.join(OUTPUT_DIR, `${page}_${fixation}.png`));
        if (page === 'techmeme' || page === 'figma') {
            return base && fs.existsSync(path.join(OUTPUT_DIR, `${page}_${fixation}_overlay.png`));
        }
        return base;
    })
);

if (completed) {
    console.log(`✅ All golden captures complete for v${version}!\n`);
} else {
    console.log(`⏳ Waiting for captures... Run this script again to check progress.\n`);
}
