/**
 * Capture Runner — batch orchestrator for capture scripts.
 *
 * Accepts an array of shot specs, filters through the manifest (skip unchanged),
 * groups remaining shots by URL+viewport, writes batch JSON, spawns ONE Electron
 * per group, and updates the manifest on success.
 *
 * Usage:
 *   const { run } = require('./lib/capture-runner');
 *   await run(specs, { outputDir, appVersion, force });
 *
 * Each spec must have:
 *   { filename, url, mode, fixationX, fixationY, overlay, mobile, ...overrides }
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const manifest = require('./capture-manifest');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

/**
 * Group key for batching — shots with the same key share one Electron launch + navigation.
 */
function groupKey(spec) {
    return JSON.stringify({
        url: spec.url,
        width: spec.width || '1920',
        height: spec.height || '1080',
        mobile: spec.mobile || 'false',
        scrollY: spec.scrollY || 0
    });
}

/**
 * Run a batch of shots through a single Electron process.
 *
 * @param {object[]} shots - Array of shot specs for this batch
 * @param {object} opts - { outputDir }
 * @returns {Promise<{ success: string[], failed: string[] }>}
 */
function runBatch(shots, opts) {
    return new Promise((resolve, reject) => {
        // Write batch file to temp dir
        const batchFile = path.join(os.tmpdir(), `scrutinizer-batch-${Date.now()}.json`);
        fs.writeFileSync(batchFile, JSON.stringify(shots, null, 2));

        // Use the first shot's shared properties for the Electron env
        const firstShot = shots[0];

        const env = {
            ...process.env,
            TEST_MODE: 'true',
            TEST_BATCH_FILE: batchFile,
            TEST_WIDTH: firstShot.width || '1920',
            TEST_HEIGHT: firstShot.height || '1080',
            TEST_MOBILE_EMULATION: firstShot.mobile || 'false',
            SCREENSHOT_MODE: 'update',
            ELECTRON_RUN_AS_NODE: undefined
        };

        const child = spawn('npm', ['start'], {
            cwd: PROJECT_ROOT,
            env,
            stdio: 'inherit'
        });

        child.on('close', (code) => {
            // Clean up temp file
            try { fs.unlinkSync(batchFile); } catch {}

            if (code === 0) {
                resolve({ success: shots.map(s => s.filename), failed: [] });
            } else {
                // Batch failed — all shots in this batch are failed
                reject(new Error(`Batch Electron exited with code ${code}`));
            }
        });
    });
}

/**
 * Main entry point: filter, group, batch-run, update manifest.
 *
 * @param {object[]} specs - All shot specs
 * @param {object} opts
 * @param {string} opts.outputDir - Where PNGs go
 * @param {string} opts.appVersion - From package.json
 * @param {boolean} [opts.force=false] - Skip manifest checks
 * @returns {Promise<{ captured: number, skipped: number, failed: number }>}
 */
async function run(specs, opts) {
    const { outputDir, appVersion, force = false } = opts;
    let captured = 0, skipped = 0, failed = 0;

    // Phase 1: Filter through manifest
    const toCapture = [];
    for (const spec of specs) {
        const { skip, reason } = manifest.shouldSkip(
            outputDir, spec.filename, spec, appVersion, force
        );
        if (skip) {
            console.log(`⏭️  Skip: ${spec.filename} (${reason})`);
            skipped++;
        } else {
            if (reason !== 'forced') {
                console.log(`📋 Queue: ${spec.filename} (${reason})`);
            }
            toCapture.push(spec);
        }
    }

    if (toCapture.length === 0) {
        console.log(`\n✅ All ${specs.length} shots unchanged — nothing to capture.`);
        return { captured, skipped, failed };
    }

    console.log(`\n📸 Capturing ${toCapture.length} shots (${skipped} skipped)...\n`);

    // Phase 2: Group by URL+viewport for batch execution
    // Inject outputDir into each spec so runBatchTest knows where to save
    const groups = new Map();
    for (const spec of toCapture) {
        spec.outputDir = outputDir;
        const key = groupKey(spec);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(spec);
    }

    // Phase 3: Run each group as a batch
    let groupIdx = 0;
    for (const [key, shots] of groups) {
        groupIdx++;
        const parsed = JSON.parse(key);
        console.log(`━━━ Batch ${groupIdx}/${groups.size}: ${parsed.url} (${shots.length} shots) ━━━`);

        try {
            await runBatch(shots, opts);
            // Update manifest for each successful shot
            for (const spec of shots) {
                manifest.recordCapture(outputDir, spec.filename, spec, appVersion);
            }
            captured += shots.length;
        } catch (e) {
            console.error(`❌ Batch failed: ${e.message}`);
            // Fall back to individual captures
            console.log(`   Retrying ${shots.length} shots individually...`);
            for (const spec of shots) {
                try {
                    await runBatch([spec], opts);
                    manifest.recordCapture(outputDir, spec.filename, spec, appVersion);
                    captured++;
                } catch (e2) {
                    console.error(`   ❌ Failed: ${spec.filename}`);
                    failed++;
                }
            }
        }
    }

    return { captured, skipped, failed };
}

module.exports = { run, groupKey };
