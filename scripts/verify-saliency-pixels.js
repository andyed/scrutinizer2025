#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const PNG = require('pngjs').PNG;

const OUTPUT_DIR = path.join(__dirname, '..', 'tests', 'verification');

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Pixel analysis helper
function getPixel(png, x, y) {
    const idx = (png.width * y + x) << 2;
    return {
        r: png.data[idx],
        g: png.data[idx + 1],
        b: png.data[idx + 2],
        a: png.data[idx + 3]
    };
}

function analyzeImage(filepath, checkType) {
    return new Promise((resolve, reject) => {
        fs.createReadStream(filepath)
            .pipe(new PNG({ filterType: 4 }))
            .on('parsed', function () {
                try {
                    const width = this.width;
                    const height = this.height;
                    console.log(`Analyzing ${path.basename(filepath)} (${width}x${height})...`);

                    if (checkType === 'saliency-hotspot') {
                        // Coordinates for Ada's face in face-test.html (approx center-right)
                        // Canvas layout: 3372x2024 (Retina) or similar.
                        // Face is at ~50% X, ~40% Y.
                        const x = Math.floor(width * 0.5);
                        const y = Math.floor(height * 0.4);

                        const pixel = getPixel(this, x, y);
                        console.log(`Face Pixel at (${x}, ${y}): R=${pixel.r}, G=${pixel.g}, B=${pixel.b}`);

                        // Saliency Map is Grayscale (R=G=B).
                        // Expect high value (hotspot) due to face detection.
                        if (pixel.r > 100) {
                            console.log('✅ Face Saliency Hotspot Verified (Value > 100)');
                            resolve(true);
                        } else {
                            console.error('❌ Face Saliency FAIL: Pixel value too low.');
                            resolve(false);
                        }

                    } else if (checkType === 'modulation-delta') {
                        // This requires comparing two images, which is complex for this single-pass function.
                        // We will rely on the caller to handle comparison if needed, or simplfy to visual check for now.
                        resolve(true);
                    }
                } catch (e) {
                    reject(e);
                }
            })
            .on('error', (err) => reject(err));
    });
}

async function runElectronTest(filename, envVars) {
    return new Promise((resolve, reject) => {
        const pagePath = path.resolve(__dirname, '..', 'tests', 'reference-pages', 'face-test.html');
        const fileUrl = `file://${pagePath}`;

        console.log(`\n🧪 Running Test Case: ${filename}`);

        const env = {
            ...process.env,
            TEST_URL: fileUrl,
            TEST_OUTPUT_FILENAME: filename,
            TEST_OUTPUT_DIR: OUTPUT_DIR,
            SCREENSHOT_MODE: 'update',
            ELECTRON_RUN_AS_NODE: undefined,
            ...envVars
        };

        const child = spawn('npm', ['start'], {
            cwd: path.join(__dirname, '..'),
            env: env,
            stdio: 'inherit'
        });

        child.on('close', (code) => {
            if (code === 0) resolve(path.join(OUTPUT_DIR, filename));
            else reject(`Electron exited with code ${code}`);
        });
    });
}

async function main() {
    try {
        // Test 1: Saliency Map Validation
        console.log("=== TEST 1: Saliency Map Hotspot Validation ===");

        // Note: main.js saves to 'tests/golden-captures/v1.4.2/' regardless of TEST_OUTPUT_DIR env var in some modes.
        // We will try running it, and then check where it actually LANDED.

        const filename = 'test_saliency_map.png';
        const version = require('../package.json').version;
        const goldenDir = path.join(__dirname, '..', 'tests', 'golden-captures', `v${version}`);
        const expectedPath = path.join(goldenDir, filename);

        await runElectronTest(filename, {
            TEST_MODES: 'saliency', // Force Saliency Debug View
            TEST_FIXATION_X: '0.5',
            TEST_FIXATION_Y: '0.5'
        });

        if (!fs.existsSync(expectedPath)) {
            console.error(`File not found at: ${expectedPath}`);
            process.exit(1);
        }

        const saliencyPassed = await analyzeImage(expectedPath, 'saliency-hotspot');

        if (!saliencyPassed) {
            console.error("Test 1 Failed. Exiting.");
            process.exit(1);
        }

        // Test 2: Modulation Delta
        console.log("\n=== TEST 2: Saliency Modulation Delta Validation ===");

        // Run 1: Modulation OFF
        const modOffFile = "test_mod_off.png";
        await runElectronTest(modOffFile, {
            TEST_MODES: 'foveated', // Normal mode
            TEST_FIXATION_X: '0.1', // Look away from face (face at 0.5, 0.4)
            TEST_FIXATION_Y: '0.1',
            TEST_ENABLE_SALIENCY_MODULATION: 'false'
        });

        // Run 2: Modulation ON
        const modOnFile = "test_mod_on.png";
        await runElectronTest(modOnFile, {
            TEST_MODES: 'foveated',
            TEST_FIXATION_X: '0.1',
            TEST_FIXATION_Y: '0.1',
            TEST_ENABLE_SALIENCY_MODULATION: 'true'
        });


        // Compare
        const pathOff = path.join(goldenDir, modOffFile);
        const pathOn = path.join(goldenDir, modOnFile);

        console.log(`Comparing ${modOffFile} vs ${modOnFile}...`);

        const pngOff = fs.createReadStream(pathOff).pipe(new PNG()).on('parsed', () => { });
        const pngOn = fs.createReadStream(pathOn).pipe(new PNG()).on('parsed', () => { });

        // Wait for both to parse (simple promise wrapper)
        const loadPng = (p) => new Promise((r, j) => {
            fs.createReadStream(p).pipe(new PNG()).on('parsed', function () { r(this); }).on('error', j);
        });

        const [imgOff, imgOn] = await Promise.all([loadPng(pathOff), loadPng(pathOn)]);

        // Check delta at Face location (1686, 777)
        // With modulation ON, face should be sharper (different pixel values) than OFF (blurry).
        const x = 1686, y = 777;
        const p1 = getPixel(imgOff, x, y);
        const p2 = getPixel(imgOn, x, y);

        const delta = Math.abs(p1.r - p2.r) + Math.abs(p1.g - p2.g) + Math.abs(p1.b - p2.b);
        console.log(`Face Pixel Delta at (${x}, ${y}): ${delta}`);
        console.log(`OFF: ${JSON.stringify(p1)}`);
        console.log(`ON:  ${JSON.stringify(p2)}`);

        if (delta > 5) {
            console.log('✅ Saliency Modulation Verified (Pixels changed)');
        } else {
            console.error('❌ Saliency Modulation FAIL: No significant pixel change.');
            process.exit(1);
        }

        console.log("\n✅ ALL PIXEL VERIFICATIONS PASSED");

    } catch (err) {
        console.error("Test Failed:", err);
        process.exit(1);
    }
}

main();
