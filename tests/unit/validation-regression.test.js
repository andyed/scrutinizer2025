/**
 * Regression tests encoding key findings from the five-wave psychophysical
 * validation (v2.1). These test the mathematical model — the attenuation
 * formulas and M-scaling cutoffs — not the GPU shader. If parameters in
 * modes.json change, these tests catch regressions against published data.
 *
 * Validated against:
 *   Wave 1: Mullen & Kingdom 2002, Hansen 2009, Bowers 2025 (chromatic decay)
 *   Wave 2: Rovamo & Virsu 1979 (spatial frequency / M-scaling)
 *   Wave 3: Bouma 1970, Toet & Levi 1992 (crowding geometry)
 *
 * Stimulus domain tags (see stimulus-domain.test.js for transfer analysis):
 *   Wave 1: LAB_COLORS — saturated suprathreshold colors on neutral background
 *   Wave 2: LAB_GRATINGS — horizontal sine-wave gratings (0.25–4 cpd)
 *   Wave 3: LAB_TEXT — crowded vs isolated letter stimuli
 *   Scrutinizer deploys on: SCREEN_UI — web pages, mixed content, UI widgets
 *
 * Transfer assumptions (Ruth Rosenholtz, 2026 review):
 *   Lab stimuli establish biological mechanisms; transfer to screen content
 *   depends on how well screen Fourier statistics match lab conditions.
 *   See stimulus-domain.test.js for quantitative analysis.
 *
 * Run: node tests/unit/index.js
 */

'use strict';

// The describe and it globals are provided by Jest.
const fs = require('fs');
const path = require('path');

// ─── Load parameters from modes.json (source of truth) ─────────────────────

const modesPath = path.join(__dirname, '../../shared/modes.json');
const modes = JSON.parse(fs.readFileSync(modesPath, 'utf8'));

// Use highkey (the default mode) — the primary validation target
const mode0 = modes.modes['highkey'];
const pipeline = mode0.pipeline;

const RG_DECAY      = pipeline.rg_decay;           // 0.054 (fast, <knee)
const RG_DECAY_SLOW = pipeline.rg_decay_slow;      // 0.014 (slow, >knee)
const RG_KNEE_DEG   = pipeline.rg_knee_deg;        // 15.0
const RG_FREQ_DECAY = pipeline.rg_freq_decay;      // 0.003
const YV_DECAY      = pipeline.yv_decay;           // 0.014
const YV_FREQ_DECAY = pipeline.yv_freq_decay;      // 0.008
const SUPRA         = pipeline.supra_exponent;     // 0.5

const CROWDING_THRESHOLD = pipeline.crowding_density_threshold;  // 0.6
const CROWDING_STEEPNESS = pipeline.crowding_density_steepness;  // 20.0

// ─── Load published data ────────────────────────────────────────────────────

const bowersPath = path.join(__dirname, '../validation/published-data/bowers2025_sensitivity.json');
const bowers = JSON.parse(fs.readFileSync(bowersPath, 'utf8'));

// ─── Core formulas (mirrors chromatic-attenuation-table.js & shader) ────────

/**
 * Per-channel chromatic attenuation with optional biphasic decay.
 * Base decay: k_e × min(ecc, knee) + k_slow × max(0, ecc - knee)
 * Freq term: k_ef × freq × ecc (linear, not biphasic)
 * threshold = 10^(-(base + freq_term))
 * appearance = threshold^supra
 */
function attenuation(k_e, k_ef, freq, ecc_deg, supra, k_slow, knee) {
    let base;
    if (k_slow != null && knee != null && ecc_deg > knee) {
        base = k_e * knee + k_slow * (ecc_deg - knee);
    } else {
        base = k_e * ecc_deg;
    }
    const threshold = Math.pow(10, -(base + k_ef * freq * ecc_deg));
    return Math.pow(threshold, supra);
}

/** Density-gated crowding sigmoid (mirrors peripheral.frag). */
function crowdingSigmoid(density, threshold, steepness) {
    const gate = 1.0 / (1.0 + Math.exp(-steepness * (density - threshold)));
    return 0.3 + 0.7 * gate;  // mix(0.3, 1.0, gate)
}

/** M-scaling cutoff: eccentricity (normalized) at which a band drops out. */
function mScalingCutoff(freq_cpd, e2_base) {
    // E2 halving eccentricity scales inversely with frequency
    // cutoff = e2_base / freq gives normalized eccentricity where band attenuates
    return e2_base / freq_cpd;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function assertClose(actual, expected, tol, label) {
    const msg = `${label}: expected ${expected}, got ${actual} (tol ±${tol})`;
    expect(Number.isFinite(actual)).toBeTruthy();
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

// ─── Wave 1: Chromatic Decay ────────────────────────────────────────────────
// STIMULUS DOMAIN: LAB_COLORS
// Source studies used saturated color patches (Bowers 2025) and low-contrast
// gratings (Mullen 2002) on neutral gray backgrounds, filling the test field.
// Screen UI uses comparably saturated accents (brand colors, error reds, link
// blues, syntax highlighting) but these are spatially sparse amid achromatic
// text and whitespace. Suprathreshold correction (supra_exponent=0.5) addresses
// the threshold→appearance gap; the coverage gap remains.
// Transfer risk: MODERATE — per-pixel mechanism is correct; aggregate impact
// differs by chromatic coverage, not peak saturation.

describe('Wave 1: Chromatic decay (Mullen 2002, Hansen 2009, Bowers 2025)', function () {

    const ECCS = [2, 5, 10, 15, 30, 50, 75];
    const FREQ = 1.0; // representative mid-band frequency

    it('RG retention monotonically decreases with eccentricity', function () {
        let prev = 1.0;
        for (const ecc of ECCS) {
            const val = attenuation(RG_DECAY, RG_FREQ_DECAY, FREQ, ecc, SUPRA, RG_DECAY_SLOW, RG_KNEE_DEG);
            expect(val).toBeLessThanOrEqual(prev + 1e-10);
            prev = val;
        }
    });

    it('BY retention monotonically decreases with eccentricity', function () {
        let prev = 1.0;
        for (const ecc of ECCS) {
            const val = attenuation(YV_DECAY, YV_FREQ_DECAY, FREQ, ecc, SUPRA);
            expect(val).toBeLessThanOrEqual(prev + 1e-10);
            prev = val;
        }
    });

    it('BY retention >= 1.5× RG at 15° (Mullen & Kingdom 2002)', function () {
        // Validation report: blue=73.5% / red=43.1% = 1.70×
        const rg = attenuation(RG_DECAY, RG_FREQ_DECAY, FREQ, 15, SUPRA, RG_DECAY_SLOW, RG_KNEE_DEG);
        const by = attenuation(YV_DECAY, YV_FREQ_DECAY, FREQ, 15, SUPRA);
        const ratio = by / rg;
        expect(ratio).toBeGreaterThanOrEqual(1.5);
    });

    it('BY always ranks above RG at every eccentricity', function () {
        // Validation report: 20/20 correct (100%)
        for (const ecc of ECCS) {
            const rg = attenuation(RG_DECAY, RG_FREQ_DECAY, FREQ, ecc, SUPRA, RG_DECAY_SLOW, RG_KNEE_DEG);
            const by = attenuation(YV_DECAY, YV_FREQ_DECAY, FREQ, ecc, SUPRA);
            expect(by).toBeGreaterThanOrEqual(rg);
        }
    });

    it('green chroma closer to red than blue (opponent-channel split)', function () {
        // Green in Oklab: a* ≈ -0.14 (RG axis), b* ≈ 0.11 (BY axis)
        // ~57% RG, ~43% BY — so green tracks red more than blue
        const ecc = 15;
        const a_green = -0.14;
        const b_green = 0.11;
        const chroma_orig = Math.sqrt(a_green * a_green + b_green * b_green);

        const rg_atten = attenuation(RG_DECAY, RG_FREQ_DECAY, FREQ, ecc, SUPRA, RG_DECAY_SLOW, RG_KNEE_DEG);
        const by_atten = attenuation(YV_DECAY, YV_FREQ_DECAY, FREQ, ecc, SUPRA);

        const chroma_after = Math.sqrt(
            (a_green * rg_atten) ** 2 + (b_green * by_atten) ** 2
        );
        const green_retention = chroma_after / chroma_orig;

        // Red is pure RG axis, blue is pure BY axis
        const red_retention = rg_atten;
        const blue_retention = by_atten;

        const gap_to_red = Math.abs(green_retention - red_retention);
        const gap_to_blue = Math.abs(green_retention - blue_retention);

        expect(gap_to_red).toBeLessThan(gap_to_blue);
    });

    it('BY/RG threshold ratio within 30% of Bowers et al. 2025 at 15°', function () {
        // Bowers: BY=79%, RG=29% at 15° → ratio 2.72 (THRESHOLD, not appearance)
        // Compare at threshold level (supra=1.0) since Bowers measured thresholds.
        const rg = attenuation(RG_DECAY, RG_FREQ_DECAY, FREQ, 15, 1.0, RG_DECAY_SLOW, RG_KNEE_DEG);
        const by = attenuation(YV_DECAY, YV_FREQ_DECAY, FREQ, 15, 1.0);
        const model_ratio = by / rg;

        const bowers_rg = bowers.channels.rg.sensitivity_pct[1] / 100;
        const bowers_by = bowers.channels.by.sensitivity_pct[1] / 100;
        const bowers_ratio = bowers_by / bowers_rg;

        const pct_off = Math.abs(model_ratio - bowers_ratio) / bowers_ratio;
        expect(pct_off).toBeLessThan(0.30);
    });

    // ── Biphasic RG decay (Bowers et al. 2025) ──

    it('biphasic RG: threshold matches Bowers at 15° and 75° (normalized to 5°)', function () {
        // Bowers: RG threshold retention = 29% at 15°, 4% at 75° (relative to 5°)
        function thresholdNorm(ecc) {
            // threshold = 10^(-base), normalized to 5° baseline
            const base_ecc = RG_DECAY * Math.min(ecc, RG_KNEE_DEG)
                           + RG_DECAY_SLOW * Math.max(0, ecc - RG_KNEE_DEG);
            const base_5   = RG_DECAY * Math.min(5, RG_KNEE_DEG);
            return Math.pow(10, -(base_ecc - base_5));
        }
        assertClose(thresholdNorm(15), 0.29, 0.02, 'RG threshold at 15°');
        assertClose(thresholdNorm(75), 0.04, 0.01, 'RG threshold at 75°');
    });

    it('biphasic RG: continuity at knee — no jump in attenuation', function () {
        const just_below = attenuation(RG_DECAY, RG_FREQ_DECAY, FREQ, RG_KNEE_DEG - 0.01, SUPRA, RG_DECAY_SLOW, RG_KNEE_DEG);
        const just_above = attenuation(RG_DECAY, RG_FREQ_DECAY, FREQ, RG_KNEE_DEG + 0.01, SUPRA, RG_DECAY_SLOW, RG_KNEE_DEG);
        // Should be continuous — difference should be tiny
        expect(Math.abs(just_above - just_below)).toBeLessThan(0.005);
    });

    it('biphasic RG: far-periphery retention > 1% at 75° (not near-zero)', function () {
        // Old exponential model gave ~0.2% at 75° — biphasic should give ~4% threshold, ~20% appearance
        const rg_75 = attenuation(RG_DECAY, RG_FREQ_DECAY, FREQ, 75, SUPRA, RG_DECAY_SLOW, RG_KNEE_DEG);
        expect(rg_75).toBeGreaterThan(0.01); // Must be > 1%
        expect(rg_75).toBeLessThan(0.50);    // But not too high
    });

    it('attenuation is always in [0, 1]', function () {
        for (const ecc of [0, 1, 5, 15, 45, 75]) {
            for (const freq of [0.25, 0.5, 1.0, 2.0, 4.0]) {
                const rg = attenuation(RG_DECAY, RG_FREQ_DECAY, freq, ecc, SUPRA, RG_DECAY_SLOW, RG_KNEE_DEG);
                const by = attenuation(YV_DECAY, YV_FREQ_DECAY, freq, ecc, SUPRA);
                expect(rg).toBeGreaterThanOrEqual(0);
                expect(rg).toBeLessThanOrEqual(1);
                expect(by).toBeGreaterThanOrEqual(0);
                expect(by).toBeLessThanOrEqual(1);
            }
        }
    });

    it('fovea (ecc=0) has full retention', function () {
        const rg = attenuation(RG_DECAY, RG_FREQ_DECAY, 4.0, 0, SUPRA, RG_DECAY_SLOW, RG_KNEE_DEG);
        const by = attenuation(YV_DECAY, YV_FREQ_DECAY, 4.0, 0, SUPRA);
        assertClose(rg, 1.0, 1e-10, 'RG at fovea');
        assertClose(by, 1.0, 1e-10, 'BY at fovea');
    });

    it('higher frequency decays faster at same eccentricity', function () {
        const ecc = 10;
        const rg_high = attenuation(RG_DECAY, RG_FREQ_DECAY, 4.0, ecc, SUPRA, RG_DECAY_SLOW, RG_KNEE_DEG);
        const rg_low  = attenuation(RG_DECAY, RG_FREQ_DECAY, 0.5, ecc, SUPRA, RG_DECAY_SLOW, RG_KNEE_DEG);
        expect(rg_low).toBeGreaterThan(rg_high);
    });
});

// ─── Wave 2: Spatial Frequency / M-Scaling ──────────────────────────────────
// STIMULUS DOMAIN: LAB_GRATINGS
// Source study used horizontal sine-wave gratings at controlled contrasts.
// Screen content has broadband spectra with energy peaks at text spatial
// frequencies (~3–6 cpd for body text) and flat regions (backgrounds).
// Natural images follow ~1/f; web UI does NOT — it has sharper spectral peaks.
// Transfer risk: LOW for M-scaling mechanism, MODERATE for absolute cutoffs.

describe('Wave 2: Spatial frequency ordering (Rovamo & Virsu 1979)', function () {

    // DoG band frequencies (8 half-octave bands, v2.1)
    const BANDS = [5.66, 4.0, 2.83, 2.0, 1.41, 1.0, 0.71, 0.5];
    const ECCS = [2, 5, 10, 15, 30];

    it('frequency ordering preserved: higher freq <= lower freq at all eccentricities', function () {
        for (const ecc of ECCS) {
            let prev_retention = 0;
            // Walk from highest freq (most degraded) to lowest (most preserved)
            for (let i = 0; i < BANDS.length; i++) {
                const freq = BANDS[i];
                const retention = attenuation(RG_DECAY, RG_FREQ_DECAY, freq, ecc, SUPRA, RG_DECAY_SLOW, RG_KNEE_DEG);
                expect(retention).toBeGreaterThanOrEqual(prev_retention - 1e-10);
                prev_retention = retention;
            }
        }
    });

    it('coarse structure (0.25 cpd) retains more than fine detail (4 cpd) at 15°', function () {
        // The chromatic attenuation model applies k_e + k_ef×freq, so even
        // low frequencies lose signal at high eccentricity. The key invariant
        // is that coarse retains MORE than fine, not that it's fully preserved
        // (MIP pooling separately preserves spatial structure).
        const coarse = attenuation(RG_DECAY, RG_FREQ_DECAY, 0.25, 15, SUPRA, RG_DECAY_SLOW, RG_KNEE_DEG);
        const fine = attenuation(RG_DECAY, RG_FREQ_DECAY, 4.0, 15, SUPRA, RG_DECAY_SLOW, RG_KNEE_DEG);
        expect(coarse).toBeGreaterThan(fine);
    });

    it('fine detail (4+ cpd) decays more than coarse at moderate eccentricity', function () {
        // At 10°, 4cpd RG should show significant loss
        const retention = attenuation(RG_DECAY, RG_FREQ_DECAY, 4.0, 10, SUPRA, RG_DECAY_SLOW, RG_KNEE_DEG);
        expect(retention).toBeLessThan(0.5);
    });

    it('each band shows monotonic decrease across eccentricity', function () {
        for (const freq of BANDS) {
            let prev = 1.0;
            for (const ecc of ECCS) {
                const val = attenuation(RG_DECAY, RG_FREQ_DECAY, freq, ecc, SUPRA, RG_DECAY_SLOW, RG_KNEE_DEG);
                expect(val).toBeLessThanOrEqual(prev + 1e-10);
                prev = val;
            }
        }
    });
});

// ─── Wave 3: Crowding / Density Gate ────────────────────────────────────────
// STIMULUS DOMAIN: LAB_TEXT
// Source study used isolated letter targets flanked by distractor letters.
// Screen UI has structured element grouping (Gestalt proximity, common region)
// that may reduce effective crowding vs random letter arrays. The density gate
// (congestion map) partially bridges this gap by measuring local complexity.
// Transfer risk: MODERATE — Bouma spacing is well-established but UI elements
// have regularity/structure that isolated letters lack.

describe('Wave 3: Density-gated crowding (Bouma 1970)', function () {

    it('dense content (density=1.0) gets full distortion', function () {
        const factor = crowdingSigmoid(1.0, CROWDING_THRESHOLD, CROWDING_STEEPNESS);
        assertClose(factor, 1.0, 0.01, 'dense crowding factor');
    });

    it('sparse content (density=0.0) gets floor distortion (0.3)', function () {
        const factor = crowdingSigmoid(0.0, CROWDING_THRESHOLD, CROWDING_STEEPNESS);
        assertClose(factor, 0.3, 0.01, 'sparse crowding factor');
    });

    it('crowding factor monotonically increases with density', function () {
        let prev = 0;
        for (let d = 0; d <= 1.0; d += 0.05) {
            const factor = crowdingSigmoid(d, CROWDING_THRESHOLD, CROWDING_STEEPNESS);
            expect(factor).toBeGreaterThanOrEqual(prev - 1e-10);
            prev = factor;
        }
    });

    it('sigmoid inflection point is at the configured threshold', function () {
        // At the threshold, sigmoid output should be 0.5 → crowding factor = 0.65
        const factor = crowdingSigmoid(CROWDING_THRESHOLD, CROWDING_THRESHOLD, CROWDING_STEEPNESS);
        assertClose(factor, 0.65, 0.01, 'inflection point');
    });

    it('dense/sparse ratio >= 3:1 (validated at 3.3:1 in v2.1)', function () {
        // Validation report: density gate validated at 3.3:1 ratio
        const dense = crowdingSigmoid(1.0, CROWDING_THRESHOLD, CROWDING_STEEPNESS);
        const sparse = crowdingSigmoid(0.0, CROWDING_THRESHOLD, CROWDING_STEEPNESS);
        const ratio = dense / sparse;
        expect(ratio).toBeGreaterThanOrEqual(3.0);
    });

    it('crowding factor is always in [0.3, 1.0]', function () {
        for (let d = -0.5; d <= 1.5; d += 0.1) {
            const factor = crowdingSigmoid(d, CROWDING_THRESHOLD, CROWDING_STEEPNESS);
            expect(factor).toBeGreaterThanOrEqual(0.29);
            expect(factor).toBeLessThanOrEqual(1.01);
        }
    });
});

// ─── Cross-wave: Parameter Sanity ───────────────────────────────────────────

describe('Parameter sanity (modes.json regression guard)', function () {

    it('RG decays faster than BY (rg_decay > yv_decay)', function () {
        expect(RG_DECAY).toBeGreaterThan(YV_DECAY);
    });

    it('supra exponent is in (0, 1) — converts threshold to appearance', function () {
        expect(SUPRA).toBeGreaterThan(0);
        expect(SUPRA).toBeLessThan(1);
    });

    it('crowding steepness is positive', function () {
        expect(CROWDING_STEEPNESS).toBeGreaterThan(0);
    });

    it('crowding threshold is in (0, 1)', function () {
        expect(CROWDING_THRESHOLD).toBeGreaterThan(0);
        expect(CROWDING_THRESHOLD).toBeLessThan(1);
    });
});
