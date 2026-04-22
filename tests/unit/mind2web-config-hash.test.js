/**
 * Tests for the Mind2Web Arm-0 config hash.
 *
 * Guards against the failure modes that burned Scrutinizer before:
 * - silent MIP fallback (mode 15 ran it without reporting)
 * - config drift between runs (Brown-matching dead end)
 * - pipeline drift through unrelated edits to modes.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const hasher = require(path.resolve(__dirname, '../../scripts/mind2web-config-hash.js'));
const CONFIG_PATH = path.resolve(__dirname, '../validation/mind2web/arm-0-config.json');
const MODES_PATH = path.resolve(__dirname, '../../shared/modes.json');

describe('Mind2Web Arm-0 config hash', () => {
    let cfg;
    beforeAll(() => { cfg = hasher.loadConfig(CONFIG_PATH); });

    it('stable across key order', () => {
        // Rebuild cfg with top-level keys in reverse order; canonicalize should normalize.
        const keys = Object.keys(cfg);
        const reversed = {};
        for (let i = keys.length - 1; i >= 0; i--) reversed[keys[i]] = cfg[keys[i]];
        expect(hasher.hashConfig(reversed)).toBe(hasher.hashConfig(cfg));
    });

    it('changes on any non-gated field edit', () => {
        // Mutations that remain valid configs — hash must still change.
        // Gated-field mutations are exercised in the "invariants" test below.
        const mutations = [
            c => { c.created = '2030-01-01'; },
            c => { c.memo_commit = 'deadbeef'; },
            c => { c.pipeline.dog_e2 = 0.14; },
            c => { c.pipeline.cmf_a = 2.79; },
            c => { c.bootstrap.n_resamples = 500; },
            c => { c.multiplicity.per_primitive_alpha = 0.0165; },
            c => { c.split.seed = 43; },
            c => { c.eccentricity_cap_deg = 25; },
            c => { c.distractor_min_per_trial = 5; },
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

    it('asserts Arm-0 invariants — mode 16, DOM-off, IOR-off, isotropic, dog_enabled', () => {
        // These are the specific silent-failure modes that burned mode 15.
        expect(cfg.mode_id).toBe(16);
        expect(cfg.dom_aware).toBe(false);
        expect(cfg.ior).toBe(false);
        expect(cfg.anisotropy_h).toBe(1.0);
        expect(cfg.pipeline.dog_enabled).toBe(true);

        // Flipping any of these should fail validation
        const flips = [
            c => { c.mode_id = 20; },
            c => { c.dom_aware = true; },
            c => { c.ior = true; },
            c => { c.anisotropy_h = 1.2; },
            c => { c.pipeline.dog_enabled = false; },
        ];
        for (const flip of flips) {
            const copy = JSON.parse(JSON.stringify(cfg));
            flip(copy);
            expect(() => hasher.hashConfig(copy)).toThrow();
        }
    });

    it('viewport is 1280x768, px_per_deg is 29, reflow off', () => {
        expect(cfg.viewing.viewport_w).toBe(1280);
        expect(cfg.viewing.viewport_h).toBe(768);
        expect(cfg.viewing.px_per_deg).toBe(29);
        expect(cfg.viewing.reflow_allowed).toBe(false);
    });

    it('pipeline matches shared/modes.json text_baseline_m16 (drift detector)', () => {
        // If someone edits mode 16 in shared/modes.json without updating this
        // snapshot, Arm-0 silently diverges from what the validation memo names.
        // This test forces a deliberate update when that happens.
        const modes = JSON.parse(fs.readFileSync(MODES_PATH, 'utf-8'));
        const live = modes.modes.text_baseline_m16.pipeline;
        expect(cfg.pipeline).toEqual(live);
    });

    it('bootstrap is paired with Bonferroni-adjusted alpha for 3 primary primitives', () => {
        expect(cfg.bootstrap.type).toBe('paired');
        expect(cfg.bootstrap.statistic).toBe('per_trial_auc_arm0_minus_auc_distance_only');
        expect(cfg.multiplicity.correction).toBe('bonferroni');
        expect(cfg.multiplicity.n_primary).toBe(3);
        // per-primitive α = 0.05/3 ≈ 0.0167
        expect(cfg.multiplicity.per_primitive_alpha).toBeCloseTo(0.05 / 3, 3);
    });

    it('produces a stable 12-char prefix', () => {
        const prefix = hasher.hashPrefix(cfg);
        expect(prefix).toMatch(/^[0-9a-f]{12}$/);
        // Same config, same prefix across runs
        expect(hasher.hashPrefix(cfg)).toBe(prefix);
    });
});
