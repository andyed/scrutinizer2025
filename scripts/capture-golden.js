#!/usr/bin/env node
/**
 * Golden Capture Script
 *
 * Captures screenshots of reference pages for visual regression testing.
 * Uses batch mode to reuse Electron instances across same-URL shots,
 * and manifest-based caching to skip unchanged shots.
 *
 * Usage:
 *   npm run capture-golden                    # Capture current version (incremental)
 *   npm run capture-golden -- --version=1.4.3 # Capture specific version
 *   npm run capture-golden -- --force         # Recapture all shots
 */

const path = require('path');
const fs = require('fs');
const { run } = require('./lib/capture-runner');

// Get version from args or package.json (strip patch for folder: 1.9.1 → 1.9)
const versionArg = process.argv.find(arg => arg.startsWith('v='));
const fullVersion = versionArg
    ? versionArg.split('=')[1]
    : require('../package.json').version;
const version = fullVersion.replace(/\.\d+$/, '');
const force = process.argv.includes('--force');

const OUTPUT_DIR = path.join(__dirname, '..', 'tests', 'golden-captures', `v${version}`);

// Reference page base URL — GitHub Pages (scrutinizer-www).
// Override with BASE_URL env var for local development.
const BASE_URL = process.env.BASE_URL || 'https://andyed.github.io/scrutinizer-www/reference-pages';

// Foveal radius for captures — 45px = 1° radius (2° diameter fovea) on MBP Retina @ 20".
// See docs/foveal-calibration-logic.md §7 for derivation.
const CAPTURE_FOVEA_RADIUS = process.env.TEST_RADIUS || '45';

// Window size for captures — fixed at 1920×1080 for cross-machine reproducibility.
const CAPTURE_WIDTH = process.env.CAPTURE_WIDTH || '1920';
const CAPTURE_HEIGHT = process.env.CAPTURE_HEIGHT || '1080';

// fixation: 'center' | 'top_left' | 'sidebar'
const FIXATION_COORDS = {
    'center': { x: 0.5, y: 0.5 },
    'top_left': { x: 0.2, y: 0.2 },
    'sidebar': { x: 0.15, y: 0.5 }
};

// Debug variants for standard pages
const DEBUG_VARIANTS = [
    { id: 'standard', mode: '0', overlay: false },
    { id: 'mode12_isotropic', mode: '12', overlay: false },
    { id: 'saliency', mode: 'saliency' },
    { id: 'structure', mode: 'structure' },
    { id: 'congestion_overlay', mode: 'congestion_overlay' },
    { id: 'congestion_solo', mode: 'congestion_solo' }
];

// Mobile/tablet variants appended to desktop captures (never replacing them)
const MOBILE_VARIANTS = [
    { id: 'iphone14', mode: '0', overlay: false, mobile: 'iphone_14_pro' },
    { id: 'ipad_air', mode: '0', overlay: false, mobile: 'ipad_air_landscape' }
];

const CAPTURE_TASKS = [
    // --- DASHBOARD ---
    {
        page: 'dashboard',
        fixations: ['center'],
        variants: [
            ...DEBUG_VARIANTS,
            ...MOBILE_VARIANTS
        ]
    },

    // --- ARTICLE ---
    {
        page: 'article',
        fixations: ['center'],
        variants: [
            ...DEBUG_VARIANTS,
            ...MOBILE_VARIANTS
        ]
    },

    // --- ECOMMERCE ---
    {
        page: 'ecommerce',
        fixations: ['product_image'],
        variants: [
            { id: 'standard', mode: '0', overlay: false },
            ...MOBILE_VARIANTS
        ],
        selectors: {
            'product_image': '.product-image'
        }
    },

    // --- TECHMEME (Text Density) ---
    {
        page: 'techmeme',
        fixations: ['center'],
        variants: [
            ...DEBUG_VARIANTS,
            ...MOBILE_VARIANTS
        ]
    },

    // --- GRID (Distortion Check) ---
    { page: 'grid', fixations: ['center'] },

    // --- COLOR SPECTRUM (Desaturation Diagnostic) ---
    {
        page: 'color-spectrum',
        fixations: ['center'],
        variants: [
            { id: 'mode0_smoothstep', mode: '0', overlay: false },
            { id: 'mode1_purkinje', mode: '1', overlay: false },
            { id: 'mode6_cmf', mode: '6', overlay: false },
            { id: 'mode7_legacy', mode: '7', overlay: false },
            { id: 'mode0_chromatic_on', mode: '0', overlay: false, chromaticPooling: true },
            { id: 'mode0_chromatic_off', mode: '0', overlay: false, chromaticPooling: false },
            { id: 'mode1_chromatic_on', mode: '1', overlay: false, chromaticPooling: true },
            { id: 'mode1_chromatic_off', mode: '1', overlay: false, chromaticPooling: false }
        ]
    },


    // --- CROWDING (Letters) ---
    {
        page: 'crowding',
        fixations: ['center', 'crowded_row2', 'corner', 'isolated_row1'],
        variants: [
            ...DEBUG_VARIANTS,
            { id: 'mode10_mongrel', mode: '10', overlay: false }
        ],
        coordinates: {
            'center': { x: 600, y: 450 },
            'crowded_row2': { x: 500, y: 222 },
            'corner': { x: 40, y: 860 },
            'isolated_row1': { x: 700, y: 564 }
        }
    },

    // --- CROWDING (Stimulus-Specific) ---
    {
        page: 'crowding-stimulus',
        fixations: ['center'],
        variants: [
            ...DEBUG_VARIANTS,
            { id: 'mode10_mongrel', mode: '10', overlay: false }
        ]
    },

    // --- DASHBOARD (Chromatic Pooling A/B) ---
    {
        page: 'dashboard',
        fixations: ['center'],
        variants: [
            { id: 'mode0_chromatic_on', mode: '0', overlay: false, chromaticPooling: true },
            { id: 'mode0_chromatic_off', mode: '0', overlay: false, chromaticPooling: false }
        ]
    }
];

/**
 * Flatten CAPTURE_TASKS into an array of shot specs for capture-runner.
 */
function buildSpecs() {
    const specs = [];

    for (const task of CAPTURE_TASKS) {
        const variants = task.variants || [{ id: 'standard', overlay: false }];

        for (const fixation of task.fixations) {
            for (const variant of variants) {
                let filename = `${task.page}_${fixation}`;
                if (variant.id !== 'standard') {
                    filename += `_${variant.id}`;
                }
                if (variant.mobile === true) {
                    filename += '_mobile';
                }
                filename += '.png';

                const fixationDef = FIXATION_COORDS[fixation] || { x: 0.5, y: 0.5 };
                const selector = task.selectors?.[fixation] || '';

                const queryStr = variant.query ? `?${variant.query}` : '';
                const spec = {
                    filename,
                    url: `${BASE_URL}/${task.page}.html${queryStr}`,
                    mode: variant.mode || '0',
                    fixationX: fixationDef.x,
                    fixationY: fixationDef.y,
                    selector,
                    overlay: variant.overlay || false,
                    radius: CAPTURE_FOVEA_RADIUS,
                    width: CAPTURE_WIDTH,
                    height: CAPTURE_HEIGHT,
                    mobile: variant.mobile
                        ? (typeof variant.mobile === 'string' ? variant.mobile : 'true')
                        : 'false',
                };

                // Optional overrides
                if (variant.chromaticPooling !== undefined) {
                    spec.chromaticPooling = variant.chromaticPooling;
                }


                specs.push(spec);
            }
        }
    }

    return specs;
}

async function main() {
    console.log(`\n🎯 Golden Capture Script (Batch)`);
    console.log(`   Version: v${version}`);
    console.log(`   Window: ${CAPTURE_WIDTH}×${CAPTURE_HEIGHT}`);
    console.log(`   Output: ${OUTPUT_DIR}`);
    if (force) console.log(`   Mode: --force (recapture all)`);
    console.log('');

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const specs = buildSpecs();
    console.log(`   Total shots: ${specs.length}\n`);

    const result = await run(specs, {
        outputDir: OUTPUT_DIR,
        appVersion: fullVersion,
        force
    });

    console.log(`\n🎉 Golden captures complete.`);
    console.log(`   Captured: ${result.captured}, Skipped: ${result.skipped}, Failed: ${result.failed}`);

    if (result.failed > 0) {
        process.exit(1);
    }
}

main();
