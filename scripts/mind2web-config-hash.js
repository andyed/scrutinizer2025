#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALLOWED_TOP_LEVEL_KEYS = new Set([
    'schema_version', 'memo_commit', 'created', 'purpose',
    'mode_id', 'mode_name',
    'dom_aware', 'ior', 'anisotropy_h',
    'viewing', 'pipeline', 'pooled_stat_path', 'surround',
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
    if (cfg.multiplicity?.correction !== 'bonferroni') {
        throw new Error(`Arm-0 multiplicity.correction must be 'bonferroni'`);
    }
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
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
}

module.exports = { canonicalize, validate, hashConfig, hashPrefix, loadConfig, ALLOWED_TOP_LEVEL_KEYS };

if (require.main === module) {
    const defaultPath = path.resolve(__dirname, '..', 'tests', 'validation', 'mind2web', 'arm-0-config.json');
    const configPath = process.argv.find(a => a.endsWith('.json')) || defaultPath;
    const wantFull = process.argv.includes('--full');
    const cfg = loadConfig(configPath);
    const h = hashConfig(cfg);
    process.stdout.write(wantFull ? h + '\n' : h.slice(0, 12) + '\n');
}
