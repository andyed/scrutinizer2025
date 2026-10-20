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

// Refreshed 2026-06-05: modes.json category relabel (modes 12/14/15) for the default-restore
// audit shifted the modes_json_drift_pin blob SHA. Arm-0 mode-16 pipeline is byte-unchanged.
// See docs/assessments/2026-06-05-post-isotropic-release-audit.md (B1).
// Refreshed 2026-07-11 (P0-3): mode 17 metadata edit (emptied phantom `tests` array, reworded
// architectural_purpose) shifted modes.json's blob SHA -> the modes_json_drift_pin in
// arm-0-config.json was refreshed -> the config's own hash moved. Arm-0 mode-16 pipeline,
// pixel source, and all knobs are byte-unchanged. See docs/sprucing/phase-0-science-verification.md P0-3.
// Refreshed 2026-07-11 (deep-periphery phantom-glyph suppression): peripheral.frag gained a
// far-periphery wash toward the local mean (RC-2.6 OCR fix) -> its blob SHA moved -> the
// pooled_stat_path.file_blob_sha pin in arm-0-config.json was refreshed -> the config's own hash
// moved. sampleDoGReconstructed still lives at the pinned line 283; Arm-0 mode-16 pipeline and all
// knobs are byte-unchanged.
// Refreshed 2026-10-01 (docs/comment fact pass): comment-only edits in peripheral.frag (citation
// fixes: FOVI author order, Pointer 1996, Jiang/Shooner/Mullen, detection-threshold wording) and
// label/citation-metadata edits in modes.json (mode 0/1 labels, rod-vision claims) moved both blob
// SHAs -> both pins in arm-0-config.json refreshed -> the config's own hash moved. Mode 16's
// pipeline knobs are unchanged (only its `citations` metadata changed); sampleDoGReconstructed
// still lives at the pinned line 283; validate() and validateLive() pass.
// Refreshed 2026-10-02 (reading-span sign fix): peripheral.frag's reading-span block now
// subtracts the shift from delta (the zone moves ahead of the reading direction). Its blob
// SHA moved -> pooled_stat_path.file_blob_sha refreshed -> the config's own hash moved. Arm-0
// runs mode 16 with reading_span false, so its pipeline is unaffected; sampleDoGReconstructed
// still lives at the pinned line 283; validate() and validateLive() pass.
// Refreshed 2026-10-20 (scroll registration): peripheral.frag gained per-texture scroll
// offset uniforms added at every content-texture lookup, plus an exposed-strip fill that only
// triggers when the frame offset is nonzero. Its blob SHA moved and the 14-line uniform block
// moved sampleDoGReconstructed from line 283 to 297 -> both pooled_stat_path pins refreshed ->
// the config's own hash moved. Arm-0 captures at rest, where every offset is 0. Measured: an
// at-rest mode-16 HUD capture (1920x1012) differed from v2.8.0 in 2 of 7.8M bytes, each by one
// level, against 0 between repeat captures of either build. validate() and validateLive() pass.
// Refreshed 2026-10-20 (scroll lock): peripheral.frag gained a scroll-lock rect array for fixed
// and stuck-sticky boxes; the content-texture lookups now add per-fragment offsets that equal the
// uniforms outside those boxes and zero inside. The 26 added lines moved sampleDoGReconstructed
// from line 297 to 323 and the blob SHA moved -> both pooled_stat_path pins refreshed -> the
// config's own hash moved. Measured: at-rest HUD captures (1920x1012; encoded page in mode 16,
// Wikipedia Fovea_centralis in modes 16 and 20) are byte-identical to v2.8.0. The uniform-offset
// form pinned above differed from v2.8.0 on that Wikipedia page in ~8.7k pixels, by one level.
// validate() and validateLive() pass.
// Refreshed 2026-10-20 (inner-scroller registration): peripheral.frag gained a pane rect and
// per-texture pane offsets; a fragment inside an overflow:auto pane adds the pane's nonzero
// offsets to its per-fragment offsets (a locked box over the pane holds still against them), and
// a pane's newly exposed strip gets the LOD-5 fill. The 34 added lines moved
// sampleDoGReconstructed from line 323 to 357 and the blob SHA moved -> both pooled_stat_path
// pins refreshed -> the config's own hash moved. Measured at rest (1920x1012, fresh launch per
// build): the encoded page in mode 16 is byte-identical to v2.8.0 and to the scroll-lock build.
// On a page with a registered idle pane, the pane's pixels match the scroll-lock build once both
// have rescanned the DOM. Wikipedia captures of the same build differ from launch to launch
// (~8.7k pixels by one level), and a paired capture of this build and the scroll-lock build
// matched byte for byte. validate() and validateLive() pass.
const EXPECTED_HASH_PREFIX = 'f06461883849';

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
            c => { c.pixel_source.format = 'PNG'; },
            c => { c.pathological_ui_filter.max_same_type_distractors_visible = 100; },
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
