#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALLOWED_TOP_LEVEL_KEYS = new Set([
    'schema_version', 'memo_commit', 'created', 'purpose',
    'mode_id', 'mode_name',
    'dom_aware', 'ior', 'anisotropy_h',
    'viewing', 'pipeline', 'pooled_stat_path', 'modes_json_drift_pin',
    'pool_constants_note', 'surround',
    'metric', 'bootstrap', 'multiplicity',
    'eccentricity_bins_deg', 'eccentricity_cap_deg',
    'primary_primitives', 'exploratory_primitives',
    'first_action_policy', 'scroll_gaze_policy',
    'distractor_min_per_trial', 'split'
]);

function canonicalize(v) {
    if (Array.isArray(v)) return v.map(canonicalize);
    if (v !== null && typeof v === 'object') {
        const out = {};
        for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k]);
        return out;
    }
    return v;
}

// Pure-logic validation. Safe to run on in-memory configs; no filesystem I/O.
function validate(cfg) {
    for (const k of Object.keys(cfg)) {
        if (!ALLOWED_TOP_LEVEL_KEYS.has(k)) {
            throw new Error(`arm-0-config.json contains unknown top-level key: ${k}`);
        }
    }
    if (cfg.mode_id !== 16) throw new Error(`Arm-0 must be mode 16, got ${cfg.mode_id}`);
    if (cfg.dom_aware !== false) throw new Error(`Arm-0 requires dom_aware=false`);
    if (cfg.ior !== false) throw new Error(`Arm-0 requires ior=false`);
    if (cfg.anisotropy_h !== 1.0) throw new Error(`Arm-0 requires isotropic (h=1.0)`);
    if (cfg.pipeline?.dog_enabled !== true) {
        throw new Error(`Arm-0 pipeline.dog_enabled must be true (guards MIP fallback)`);
    }
    if (cfg.viewing?.viewport_w !== 1280 || cfg.viewing?.viewport_h !== 768) {
        throw new Error(`Arm-0 viewport must be 1280x768 (Mind2Web raw_html provenance)`);
    }
    if (cfg.viewing?.px_per_deg !== 29) {
        throw new Error(`Arm-0 viewing.px_per_deg must be 29 (memo pre-registration)`);
    }
    if (cfg.viewing?.reflow_allowed !== false) {
        throw new Error(`Arm-0 viewing.reflow_allowed must be false`);
    }
    if (cfg.bootstrap?.type !== 'paired') {
        throw new Error(`Arm-0 bootstrap.type must be 'paired' (memo pre-registration)`);
    }
    if (cfg.bootstrap?.n_resamples !== 1000) {
        throw new Error(`Arm-0 bootstrap.n_resamples must be 1000`);
    }
    if (cfg.multiplicity?.correction !== 'bonferroni') {
        throw new Error(`Arm-0 multiplicity.correction must be 'bonferroni'`);
    }
    if (cfg.multiplicity?.n_primary !== 3) {
        throw new Error(`Arm-0 multiplicity.n_primary must be 3 (button, link, form_input)`);
    }
    if (cfg.eccentricity_cap_deg !== 30) {
        throw new Error(`Arm-0 eccentricity_cap_deg must be 30`);
    }
    if (cfg.first_action_policy !== 'exclude_from_primary') {
        throw new Error(`Arm-0 first_action_policy must be 'exclude_from_primary'`);
    }
    if (cfg.scroll_gaze_policy !== 'post_scroll_viewport_center') {
        throw new Error(`Arm-0 scroll_gaze_policy must be 'post_scroll_viewport_center'`);
    }
    if (cfg.surround?.definition !== 'rosenholtz_pool_at_retinotopic_location') {
        throw new Error(`Arm-0 surround.definition must be 'rosenholtz_pool_at_retinotopic_location'`);
    }
    const expectedPrimitives = JSON.stringify(['button', 'link', 'form_input']);
    if (JSON.stringify(cfg.primary_primitives) !== expectedPrimitives) {
        throw new Error(`Arm-0 primary_primitives must be ["button","link","form_input"] in that order`);
    }
}

// Live drift-detection. Reads the filesystem at repoRoot. Use in CLI and in
// the integration test. Does NOT run inside hashConfig — hashing must stay
// pure so unit tests can pass in-memory configs without a repo context.
function validateLive(cfg, repoRoot) {
    validate(cfg);

    // 1. Re-hash shared/modes.json, compare to pinned blob SHA, and verify
    //    mode 16's pipeline byte-for-byte matches cfg.pipeline.
    const modesPath = path.join(repoRoot, 'shared/modes.json');
    const modesSha = blobSha(fs.readFileSync(modesPath));
    if (cfg.modes_json_drift_pin?.file_blob_sha !== modesSha) {
        throw new Error(`shared/modes.json blob SHA drift: pinned ${cfg.modes_json_drift_pin?.file_blob_sha}, actual ${modesSha}. Either the pipeline is unchanged and the pin needs refreshing, or the pipeline has drifted — compare mode 16 to Arm-0 before refreshing.`);
    }
    const modes = JSON.parse(fs.readFileSync(modesPath, 'utf-8'));
    const livePipeline = modes.modes?.text_baseline_m16?.pipeline;
    if (!livePipeline) throw new Error(`shared/modes.json is missing modes.text_baseline_m16.pipeline`);
    if (!pipelinesEqual(cfg.pipeline, livePipeline)) {
        throw new Error(`Arm-0 cfg.pipeline diverges from shared/modes.json text_baseline_m16.pipeline`);
    }

    // 2. Re-hash peripheral.frag, compare to pinned blob SHA, and verify the
    //    sampleDoGReconstructed function still exists at the pinned line with
    //    the pinned signature prefix.
    const fragPath = path.join(repoRoot, 'renderer/shaders/peripheral.frag');
    const fragBuf = fs.readFileSync(fragPath);
    const fragSha = blobSha(fragBuf);
    if (cfg.pooled_stat_path?.file_blob_sha !== fragSha) {
        throw new Error(`peripheral.frag blob SHA drift: pinned ${cfg.pooled_stat_path?.file_blob_sha}, actual ${fragSha}. Review the diff before refreshing the pin.`);
    }
    const fragLines = fragBuf.toString('utf-8').split('\n');
    const pinnedLine = cfg.pooled_stat_path?.line;
    const sigPrefix = cfg.pooled_stat_path?.signature_prefix;
    if (!pinnedLine || !sigPrefix) throw new Error(`pooled_stat_path.line and .signature_prefix must be set`);
    const lineText = fragLines[pinnedLine - 1] || '';
    if (!lineText.includes(sigPrefix)) {
        throw new Error(`peripheral.frag line ${pinnedLine} does not contain signature_prefix "${sigPrefix}". Got: "${lineText.trim().slice(0, 80)}"`);
    }
}

function pipelinesEqual(a, b) {
    if (Object.keys(a).length !== Object.keys(b).length) return false;
    for (const k of Object.keys(a)) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
    }
    return true;
}

// Git blob SHA: same algorithm `git hash-object` uses, so pinned values can
// be produced by `git hash-object <path>` at freeze time.
function blobSha(buf) {
    const header = Buffer.from(`blob ${buf.length}\0`);
    return crypto.createHash('sha1').update(Buffer.concat([header, buf])).digest('hex');
}

function hashConfig(cfg) {
    validate(cfg);
    const canonical = JSON.stringify(canonicalize(cfg));
    return crypto.createHash('sha256').update(canonical).digest('hex');
}

function hashPrefix(cfg, n = 12) {
    return hashConfig(cfg).slice(0, n);
}

function loadConfig(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

module.exports = {
    canonicalize, validate, validateLive, hashConfig, hashPrefix, loadConfig,
    blobSha, ALLOWED_TOP_LEVEL_KEYS,
};

if (require.main === module) {
    const repoRoot = path.resolve(__dirname, '..');
    const defaultPath = path.join(repoRoot, 'tests/validation/mind2web/arm-0-config.json');
    const configPath = process.argv.find(a => a.endsWith('.json')) || defaultPath;
    const wantFull = process.argv.includes('--full');
    const skipLive = process.argv.includes('--no-live-check');
    const cfg = loadConfig(configPath);
    if (!skipLive) validateLive(cfg, repoRoot);
    const h = hashConfig(cfg);
    process.stdout.write(wantFull ? h + '\n' : h.slice(0, 12) + '\n');
}
