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

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Get version from args or package.json
const versionArg = process.argv.find(arg => arg.startsWith('v='));
const version = versionArg
    ? versionArg.split('=')[1]
    : require('../package.json').version;

const OUTPUT_DIR = path.join(__dirname, '..', 'tests', 'golden-captures', `v${version}`);

// Configuration for all captures
// fixation: 'center' | 'top_left' | 'sidebar'
const FIXATION_COORDS = {
    'center': { x: 0.5, y: 0.5 },
    'top_left': { x: 0.2, y: 0.2 }, // Adjusted to 20% in for realism
    'sidebar': { x: 0.15, y: 0.5 } // Generic sidebar left
};

const CAPTURE_TASKS = [
    // --- DASHBOARD ---
    { page: 'dashboard', fixations: ['center', 'top_left', 'sidebar'] },

    // --- ARTICLE ---
    { page: 'article', fixations: ['center', 'top_left', 'sidebar'] },

    // --- ECOMMERCE ---
    {
        page: 'ecommerce',
        fixations: ['product_image', 'add_to_cart', 'price_tag'],
        selectors: {
            'product_image': '.product-image', // CSS Selector
            'add_to_cart': '.add-to-cart-btn',
            'price_tag': '.price-tag'
        }
    },

    // --- TECHMEME (Dense Text) ---
    // Includes overlay variants
    {
        page: 'techmeme',
        fixations: ['center', 'top_left', 'sidebar'],
        variants: [
            { id: 'standard', overlay: false },
            { id: 'overlay', overlay: true } // Creates _overlay.png
        ]
    },

    // --- FIGMA (Complex UI) ---
    // Includes overlay variants
    {
        page: 'figma',
        fixations: ['center', 'top_left', 'sidebar'],
        variants: [
            { id: 'standard', overlay: false },
            { id: 'overlay', overlay: true }
        ]
    },

    // --- GRID (Distortion Check) ---
    { page: 'grid', fixations: ['center', 'top_left', 'sidebar'] }
];

console.log(`\n🎯 Golden Capture Script (Automated)`);
console.log(`   Version: v${version}`);
console.log(`   Output: ${OUTPUT_DIR}\n`);

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function runCapture(task, fixation, variant = { id: 'standard', overlay: false }) {
    return new Promise((resolve, reject) => {
        const pagePath = path.resolve(__dirname, '..', 'tests', 'reference-pages', `${task.page}.html`);
        const fileUrl = `file://${pagePath}`;

        let filename = `${task.page}_${fixation}`;
        if (variant.id !== 'standard') {
            filename += `_${variant.id}`; // e.g., techmeme_center_overlay
        }
        filename += '.png';

        const fixationDef = FIXATION_COORDS[fixation] || { x: 0.5, y: 0.5 }; // Default fallback
        const selector = task.selectors?.[fixation];

        console.log(`📸 Capturing: ${filename}`);
        console.log(`   URL: ${fileUrl}`);
        if (selector) {
            console.log(`   Fixation: Selector "${selector}"`);
        } else {
            console.log(`   Fixation: Coords (${fixationDef.x}, ${fixationDef.y})`);
        }
        if (variant.overlay) console.log(`   Overlay: ENABLED`);

        const env = {
            ...process.env,
            TEST_URL: fileUrl,
            TEST_MODES: '0', // Standard High-Key mode for now
            TEST_FIXATION_X: fixationDef.x,
            TEST_FIXATION_Y: fixationDef.y,
            TEST_SELECTOR: selector || '', // Pass selector
            TEST_OVERLAY: variant.overlay ? 'true' : 'false',
            TEST_OUTPUT_FILENAME: filename,
            SCREENSHOT_MODE: 'update', // Force precise naming
            ELECTRON_RUN_AS_NODE: undefined // Ensure Electron runs as app
        };

        const child = spawn('npm', ['start'], {
            cwd: path.join(__dirname, '..'),
            env: env,
            stdio: 'inherit' // Pipe output to see test logs
        });

        child.on('close', (code) => {
            if (code === 0) {
                console.log(`✅ Success: ${filename}\n`);
                resolve();
            } else {
                console.error(`❌ Failed: ${filename} (Exit Code: ${code})\n`);
                reject(new Error(`Exit code ${code}`));
            }
        });
    });
}

async function main() {
    for (const task of CAPTURE_TASKS) {
        const variants = task.variants || [{ id: 'standard', overlay: false }];

        for (const fixation of task.fixations) {
            for (const variant of variants) {
                try {
                    await runCapture(task, fixation, variant);
                } catch (e) {
                    console.error('⚠️ Capture skipped/failed for task, continuing sequence...');
                }
            }
        }
    }
    console.log('🎉 All captures completed.');
}

main();
