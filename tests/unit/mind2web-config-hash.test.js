/**
 * Tests for the Mind2Web Arm-0 config hash + live drift detectors.
 *
 * Guards against the failure modes that burned Scrutinizer before:
 * - silent MIP fallback (mode 15 ran it without reporting)
 * - config drift between runs (Brown-matching dead end)
 * - pipeline drift through unrelated edits to modes.json
 * - pooled-stat path drift through peripheral.frag edits
 */

'use strict';

const fs = require('fs');
const path = require('path');

const hasher = require(path.resolve(__dirname, '../../scripts/mind2web-config-hash.js'));
const REPO_ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.join(REPO_ROOT, 'tests/validation/mind2web/arm-0-config.json');
const MODES_PATH = path.join(REPO_ROOT, 'shared/modes.json');
const FRAG_PATH = path.join(REPO_ROOT, 'renderer/shaders/peripheral.frag');

const EXPECTED_HASH_PREFIX = '1702a0aa0d57';

describe('Mind2Web Arm-0 config hash', () => {
    let cfg;
    beforeAll(() => { cfg = hasher.loadConfig(CONFIG_PATH); });

    it('produces the expected pinned hash prefix', () => {
        // File-hash vs. published-hash consistency. If the config is edited and
        // this test fails, update the prefix here, in the memo, and in any
        // downstream artifact that cites it.
        expect(hasher.hashPrefix(cfg)).toBe(EXPECTED_HASH_PREFIX);
    });

    it('stable across top-level key order', () => {
        const keys = Object.keys(cfg);
        const reversed = {};
        for (let i = keys.length - 1; i >= 0; i--) reversed[keys[i]] = cfg[keys[i]];
        expect(hasher.hashConfig(reversed)).toBe(hasher.hashConfig(cfg));
    });

    it('changes on any load-bearing field edit', () => {
        const mutations = [
            // Metadata
            c => { c.created = '2030-01-01'; },
            c => { c.memo_commit = 'deadbeef'; },
            // Pipeline knobs
            c => { c.pipeline.dog_e2 = 0.14; },
            c => { c.pipeline.cmf_a = 2.79; },
            c => { c.pipeline.ecc_scaling = 0.76; },
            // Bootstrap / multiplicity
            c => { c.bootstrap.ci_level = 0.99; },
            c => { c.multiplicity.per_primitive_alpha = 0.0165; },
            // Split / caps (eccentricity_cap_deg is gated — covered in invariants test)
            c => { c.split.seed = 43; },
            c => { c.distractor_min_per_trial = 5; },
            // Metric / surround
            c => { c.metric.formula = 'S(c) = stats(c) - stats(surround(c))'; },
            // Pooled-stat path
            c => { c.pooled_stat_path.line = 188; },
            c => { c.pooled_stat_path.signature_prefix = 'vec4 sampleDoG('; },
            c => { c.pooled_stat_path.file_blob_sha = '0'.repeat(40); },
            // Drift pin
            c => { c.modes_json_drift_pin.file_blob_sha = '0'.repeat(40); },
            // Bins
            c => { c.eccentricity_bins_deg[1].high = 19; },
            // Primitives
            c => { c.exploratory_primitives.push('extra'); },
        ];
        const baseHash = hasher.hashConfig(cfg);
        for (const mutate of mutations) {
            const copy = JSON.parse(JSON.stringify(cfg));
            mutate(copy);
            expect(hasher.hashConfig(copy)).not.toBe(baseHash);
        }
    });

    it('rejects unknown top-level keys', () => {
        const bad = JSON.parse(JSON.stringify(cfg));
        bad.injected_secret = 'would_shift_hash_silently';
        expect(() => hasher.hashConfig(bad)).toThrow(/unknown top-level key/);
    });

    it('validate() enforces all pre-registered invariants', () => {
        const flips = [
            c => { c.mode_id = 20; },
            c => { c.dom_aware = true; },
            c => { c.ior = true; },
            c => { c.anisotropy_h = 1.2; },
            c => { c.pipeline.dog_enabled = false; },
            c => { c.viewing.viewport_w = 1920; },
            c => { c.viewing.px_per_deg = 30; },
            c => { c.viewing.reflow_allowed = true; },
            c => { c.bootstrap.type = 'unpaired'; },
            c => { c.bootstrap.n_resamples = 500; },
            c => { c.multiplicity.correction = 'holm'; },
            c => { c.multiplicity.n_primary = 4; },
            c => { c.eccentricity_cap_deg = 25; },
            c => { c.first_action_policy = 'include'; },
            c => { c.scroll_gaze_policy = 'pre_scroll_target'; },
            c => { c.surround.definition = 'fixed_radius_pixel_annulus'; },
            c => { c.primary_primitives = ['link', 'button', 'form_input']; },
            c => { c.pooled_stat_vector.dim = 4; },
            c => { c.pooled_stat_vector.channels = c.pooled_stat_vector.channels.slice(0, 4); },
            c => { c.pooled_stat_vector.channels[4].name = 'edge_density'; },
            c => { c.feature_congestion_path.sigma = 3.0; },
        ];
        for (const flip of flips) {
            const copy = JSON.parse(JSON.stringify(cfg));
            flip(copy);
            expect(() => hasher.hashConfig(copy)).toThrow();
        }
    });

    it('produces a 12-char lowercase hex prefix', () => {
        const prefix = hasher.hashPrefix(cfg);
        expect(prefix).toMatch(/^[0-9a-f]{12}$/);
        expect(hasher.hashPrefix(cfg)).toBe(prefix);
    });

    it('blobSha() matches git hash-object output', () => {
        // Spot-check: empty file blob SHA is a well-known constant.
        const emptyBlobSha = hasher.blobSha(Buffer.alloc(0));
        expect(emptyBlobSha).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    });
});

describe('validateLive — filesystem drift detectors', () => {
    let cfg;
    beforeAll(() => { cfg = hasher.loadConfig(CONFIG_PATH); });

    it('passes on the current tree', () => {
        expect(() => hasher.validateLive(cfg, REPO_ROOT)).not.toThrow();
    });

    it('fails on modes.json blob SHA drift', () => {
        const copy = JSON.parse(JSON.stringify(cfg));
        copy.modes_json_drift_pin.file_blob_sha = '0'.repeat(40);
        expect(() => hasher.validateLive(copy, REPO_ROOT)).toThrow(/modes\.json blob SHA drift/);
    });

    it('fails on peripheral.frag blob SHA drift', () => {
        const copy = JSON.parse(JSON.stringify(cfg));
        copy.pooled_stat_path.file_blob_sha = '0'.repeat(40);
        expect(() => hasher.validateLive(copy, REPO_ROOT)).toThrow(/peripheral\.frag blob SHA drift/);
    });

    it('fails on congestion-core.js blob SHA drift', () => {
        const copy = JSON.parse(JSON.stringify(cfg));
        copy.feature_congestion_path.file_blob_sha = '0'.repeat(40);
        expect(() => hasher.validateLive(copy, REPO_ROOT)).toThrow(/congestion-core\.js blob SHA drift/);
    });

    it('fails if congestion-core.js is missing a required FC function', () => {
        const copy = JSON.parse(JSON.stringify(cfg));
        copy.feature_congestion_path.functions_used = ['nonexistent_fc_fn'];
        expect(() => hasher.validateLive(copy, REPO_ROOT)).toThrow(/missing required function: nonexistent_fc_fn/);
    });

    it('fails if signature_prefix is absent at pinned line', () => {
        const copy = JSON.parse(JSON.stringify(cfg));
        copy.pooled_stat_path.signature_prefix = 'vec4 someOtherFunction(';
        // Bypass the blob SHA check by matching current file but mutating only
        // the pinned signature prefix — expect a signature-mismatch error.
        expect(() => hasher.validateLive(copy, REPO_ROOT)).toThrow(/signature_prefix/);
    });

    it('catches live modes.json pipeline divergence from Arm-0 snapshot', () => {
        const copy = JSON.parse(JSON.stringify(cfg));
        copy.pipeline.dog_e2 = 0.14;  // diverge from live modes.json
        expect(() => hasher.validateLive(copy, REPO_ROOT)).toThrow(/pipeline diverges/);
    });

    it('peripheral.frag line 187 still contains sampleDoGReconstructed', () => {
        // Belt-and-suspenders: independent of validateLive, assert the live
        // file at the pinned line contains the pinned function. If the file is
        // reformatted and the function moves, this test fails and the pin
        // must be refreshed deliberately.
        const frag = fs.readFileSync(FRAG_PATH, 'utf-8').split('\n');
        expect(frag[cfg.pooled_stat_path.line - 1]).toContain(cfg.pooled_stat_path.signature_prefix);
    });
});
