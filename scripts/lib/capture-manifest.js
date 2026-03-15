/**
 * Capture Manifest — skip unchanged shots.
 *
 * Reads/writes `.capture-manifest.json` alongside each output directory.
 * A shot is skipped when:
 *   1. Output file exists on disk
 *   2. Manifest entry exists with matching specHash
 *   3. App version matches
 *
 * --force flag bypasses all skip logic.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MANIFEST_FILENAME = '.capture-manifest.json';

/**
 * Deterministic hash of a shot spec object.
 * Sorts keys so insertion order doesn't matter.
 * Excludes outputDir (infrastructure, not capture config).
 */
function specHash(spec) {
    const { outputDir, ...captureSpec } = spec;
    const normalized = JSON.stringify(captureSpec, Object.keys(captureSpec).sort());
    return 'sha256:' + crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Load manifest from an output directory.
 * Returns { appVersion, shots: {} } or empty structure if missing/corrupt.
 */
function load(outputDir) {
    const manifestPath = path.join(outputDir, MANIFEST_FILENAME);
    try {
        const raw = fs.readFileSync(manifestPath, 'utf-8');
        const data = JSON.parse(raw);
        return {
            appVersion: data.appVersion || null,
            shots: data.shots || {}
        };
    } catch {
        return { appVersion: null, shots: {} };
    }
}

/**
 * Save manifest to an output directory.
 */
function save(outputDir, manifest) {
    const manifestPath = path.join(outputDir, MANIFEST_FILENAME);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

/**
 * Check whether a shot can be skipped.
 *
 * @param {string} outputDir - Directory where PNGs are saved
 * @param {string} filename - e.g. "dashboard_center_standard.png"
 * @param {object} spec - The shot config (mode, url, fixation, etc.)
 * @param {string} appVersion - Current app version from package.json
 * @param {boolean} force - If true, never skip
 * @returns {{ skip: boolean, reason: string }}
 */
function shouldSkip(outputDir, filename, spec, appVersion, force) {
    if (force) {
        return { skip: false, reason: 'forced' };
    }

    // 1. Output file must exist
    const filePath = path.join(outputDir, filename);
    if (!fs.existsSync(filePath)) {
        return { skip: false, reason: 'file missing' };
    }

    // 2. Manifest entry must exist with matching hash
    const manifest = load(outputDir);
    const entry = manifest.shots[filename];
    if (!entry) {
        return { skip: false, reason: 'no manifest entry' };
    }

    const currentHash = specHash(spec);
    if (entry.specHash !== currentHash) {
        return { skip: false, reason: 'spec changed' };
    }

    // 3. App version must match
    if (manifest.appVersion !== appVersion) {
        return { skip: false, reason: 'version changed' };
    }

    return { skip: true, reason: 'unchanged' };
}

/**
 * Record a successful capture in the manifest.
 */
function recordCapture(outputDir, filename, spec, appVersion) {
    const manifest = load(outputDir);
    manifest.appVersion = appVersion;
    manifest.shots[filename] = {
        capturedAt: new Date().toISOString(),
        specHash: specHash(spec),
        spec
    };
    save(outputDir, manifest);
}

module.exports = { load, save, specHash, shouldSkip, recordCapture };
