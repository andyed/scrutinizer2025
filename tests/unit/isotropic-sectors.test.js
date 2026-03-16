/**
 * Unit tests for isotropic cortical sector computation.
 *
 * Verifies:
 *   - JS reference implementation of compute_sector() matches expected math
 *   - Mode 12 config enables isotropic sectors (num_cortical_rings > 0)
 *   - Mode 10 config does NOT enable isotropic sectors
 *   - Sector properties: isotropy (square in cortical space), spoke count growth
 *   - Config defaults: num_cortical_rings = 0 for modes that don't specify it
 *
 * Run: npx jest tests/unit/isotropic-sectors.test.js
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ─── Reference implementation (mirrors GLSL computeCorticalSector) ──────────

const CMF_A = 2.78;

/**
 * Compute cortical sector for a point at (r_deg) degrees eccentricity.
 * Returns { ring_idx, spoke_count, r_center_deg, dr_deg, sector_area_ratio }
 */
function computeSector(r_deg, numRings, corticalMax) {
    const a = CMF_A;
    const w_min = Math.log(a);
    const N = Math.max(numRings, 2);
    const w_step = corticalMax / (N - 1);

    const w = Math.log(r_deg + a);
    const n_cont = (w - w_min) / w_step;
    const n_idx = Math.min(Math.max(Math.round(n_cont), 0), N - 1);

    // Ring center
    const w_i = w_min + n_idx * w_step;
    const r_i_deg = Math.exp(w_i) - a;

    // Half-width radial spacing
    let dr_deg;
    if (n_idx === 0) {
        const w_next = w_min + 1 * w_step;
        dr_deg = Math.exp(w_next) - Math.exp(w_min);
    } else if (n_idx === N - 1) {
        const w_prev = w_min + (N - 2) * w_step;
        const w_cur = w_min + (N - 1) * w_step;
        dr_deg = Math.exp(w_cur) - Math.exp(w_prev);
    } else {
        const w_prev = w_min + (n_idx - 1) * w_step;
        const w_next = w_min + (n_idx + 1) * w_step;
        dr_deg = (Math.exp(w_next) - Math.exp(w_prev)) / 2;
    }

    // Spoke count
    let spoke_count;
    if (n_idx === 0) {
        spoke_count = 1;
    } else {
        spoke_count = Math.max(1, Math.floor(2 * Math.PI * r_i_deg / dr_deg));
    }

    // Sector area ratio: tangential_extent / radial_extent
    // For isotropy this should be ~1.0
    const tangential_extent = 2 * Math.PI * r_i_deg / spoke_count;
    const sector_area_ratio = spoke_count > 1 ? tangential_extent / dr_deg : 1.0;

    return { n_idx, spoke_count, r_center_deg: r_i_deg, dr_deg, sector_area_ratio };
}

// ─── Load modes.json ────────────────────────────────────────────────────────

const modesPath = path.resolve(__dirname, '../../shared/modes.json');
const modes = JSON.parse(fs.readFileSync(modesPath, 'utf-8'));

function getModePipeline(modeKey) {
    return modes.modes[modeKey]?.pipeline;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Isotropic cortical sector computation', () => {
    const R_MAX = 15; // degrees, typical half-FOV
    const corticalMax = Math.log(R_MAX / CMF_A + 1);
    const NUM_RINGS = 50;

    describe('sector math', () => {
        it('ring 0 has spoke_count = 1 (foveal singularity)', () => {
            const s = computeSector(0, NUM_RINGS, corticalMax);
            expect(s.n_idx).toBe(0);
            expect(s.spoke_count).toBe(1);
        });

        it('ring indices increase monotonically with eccentricity', () => {
            let prevIdx = -1;
            for (let r = 0; r <= R_MAX; r += 0.5) {
                const s = computeSector(r, NUM_RINGS, corticalMax);
                expect(s.n_idx).toBeGreaterThanOrEqual(prevIdx);
                prevIdx = s.n_idx;
            }
        });

        it('spoke count increases with eccentricity', () => {
            const s2 = computeSector(2, NUM_RINGS, corticalMax);
            const s10 = computeSector(10, NUM_RINGS, corticalMax);
            expect(s10.spoke_count).toBeGreaterThan(s2.spoke_count);
        });

        it('sectors are approximately isotropic (aspect ratio ≈ 1.0)', () => {
            // Check isotropy at several eccentricities (skip ring 0)
            for (const r of [2, 5, 8, 12, 15]) {
                const s = computeSector(r, NUM_RINGS, corticalMax);
                if (s.spoke_count > 1) {
                    // Tangential/radial ratio should be within 30% of 1.0
                    expect(s.sector_area_ratio).toBeGreaterThan(0.7);
                    expect(s.sector_area_ratio).toBeLessThan(1.3);
                }
            }
        });

        it('outermost ring covers r_max', () => {
            const s = computeSector(R_MAX, NUM_RINGS, corticalMax);
            expect(s.n_idx).toBe(NUM_RINGS - 1);
        });

        it('spoke count converges (does not grow unboundedly)', () => {
            const s = computeSector(R_MAX, NUM_RINGS, corticalMax);
            // Spoke count should be bounded by ~2*PI/sinh(w_step) ≈ 125-130
            expect(s.spoke_count).toBeLessThan(200);
            expect(s.spoke_count).toBeGreaterThan(50);
        });
    });
});

describe('Mode config: isotropic sector enablement', () => {
    it('mode 12 (fovi_isotropic) has num_cortical_rings = 50', () => {
        const pipeline = getModePipeline('fovi_isotropic');
        expect(pipeline).toBeDefined();
        expect(pipeline.num_cortical_rings).toBe(50);
    });

    it('mode 12 (fovi_isotropic) has v1_distortion_type 5', () => {
        const pipeline = getModePipeline('fovi_isotropic');
        expect(pipeline.v1_distortion_type).toBe(5);
    });

    it('mode 12 uses V4 style 0 (not style 9)', () => {
        const pipeline = getModePipeline('fovi_isotropic');
        expect(pipeline.v4_style_id).toBe(0);
    });

    it('mode 10 (compute_mongrel) does NOT specify num_cortical_rings', () => {
        const pipeline = getModePipeline('compute_mongrel');
        expect(pipeline).toBeDefined();
        expect(pipeline.num_cortical_rings).toBeUndefined();
    });
});

describe('Config defaults prevent accidental isotropic activation', () => {
    it('modes without explicit num_cortical_rings should default to 0', () => {
        const nonIsotropicModes = [
            'smoothstep', 'purkinje', 'saliency_blocks', 'drunken_reading',
            'fovi_blur', 'legacy_like', 'cmf_polar', 'highkey', 'compute_mongrel'
        ];
        for (const key of nonIsotropicModes) {
            const pipeline = modes.modes[key]?.pipeline;
            if (pipeline) {
                const rings = pipeline.num_cortical_rings;
                expect(rings === undefined || rings === 0).toBe(true);
            }
        }
    });
});

// ─── Blauch reference values ────────────────────────────────────────────────
// Generated from Blauch's _compute_isotropic_r_and_num_theta() formulation:
//   w = linspace(log(a), log(r_max+a), N)
//   r = exp(w) - a
//   dr = central_difference(r)
//   n_spokes = floor(2π·r/dr)
//
// These are the ground-truth values the spec requires us to match to 3 decimal
// places (docs/specs/isotropic_cortical_sampling.md, Verification item 1–2).

function blauchReference(N, rMax, a) {
    const w_min = Math.log(a);
    const w_max = Math.log(rMax + a);
    const rs = [], drs = [], spokes = [];
    for (let i = 0; i < N; i++) {
        const w = w_min + i * (w_max - w_min) / (N - 1);
        rs.push(Math.exp(w) - a);
    }
    for (let i = 0; i < N; i++) {
        if (i === 0) drs.push(rs[1] - rs[0]);
        else if (i === N - 1) drs.push(rs[N - 1] - rs[N - 2]);
        else drs.push((rs[i + 1] - rs[i - 1]) / 2);
    }
    for (let i = 0; i < N; i++) {
        if (i === 0) spokes.push(1);
        else spokes.push(Math.max(1, Math.floor(2 * Math.PI * rs[i] / drs[i])));
    }
    return { rs, drs, spokes };
}

describe('Blauch traceability (spec verification items 1–2)', () => {
    // N=30, r_max=15° — the spec's verification parameters
    const N_SPEC = 30;
    const R_MAX_SPEC = 15;
    const corticalMax_spec = Math.log(R_MAX_SPEC / CMF_A + 1);
    const ref30 = blauchReference(N_SPEC, R_MAX_SPEC, CMF_A);

    // N=50, r_max=15° — mode 12's actual parameters
    const N_MODE12 = 50;
    const corticalMax_mode12 = Math.log(R_MAX_SPEC / CMF_A + 1);
    const ref50 = blauchReference(N_MODE12, R_MAX_SPEC, CMF_A);

    it('ring radii match Blauch Python to 3 decimal places (N=30, spec)', () => {
        for (let i = 0; i < N_SPEC; i++) {
            const s = computeSector(ref30.rs[i], N_SPEC, corticalMax_spec);
            expect(s.n_idx).toBe(i);
            expect(s.r_center_deg).toBeCloseTo(ref30.rs[i], 3);
        }
    });

    it('radial spacing (dr) matches Blauch central difference (N=30, spec)', () => {
        for (let i = 0; i < N_SPEC; i++) {
            const s = computeSector(ref30.rs[i], N_SPEC, corticalMax_spec);
            expect(s.dr_deg).toBeCloseTo(ref30.drs[i], 3);
        }
    });

    it('spoke counts match Blauch Python (N=30, spec)', () => {
        for (let i = 0; i < N_SPEC; i++) {
            const s = computeSector(ref30.rs[i], N_SPEC, corticalMax_spec);
            expect(s.spoke_count).toBe(ref30.spokes[i]);
        }
    });

    it('ring radii match Blauch Python to 3 decimal places (N=50, mode 12)', () => {
        for (let i = 0; i < N_MODE12; i++) {
            const s = computeSector(ref50.rs[i], N_MODE12, corticalMax_mode12);
            expect(s.n_idx).toBe(i);
            expect(s.r_center_deg).toBeCloseTo(ref50.rs[i], 3);
        }
    });

    it('spoke counts match Blauch Python (N=50, mode 12)', () => {
        for (let i = 0; i < N_MODE12; i++) {
            const s = computeSector(ref50.rs[i], N_MODE12, corticalMax_mode12);
            expect(s.spoke_count).toBe(ref50.spokes[i]);
        }
    });

    it('spoke count at r_max matches expected (N=30: 85, N=50: 142)', () => {
        const s30 = computeSector(R_MAX_SPEC, N_SPEC, corticalMax_spec);
        expect(s30.spoke_count).toBe(85);

        const s50 = computeSector(R_MAX_SPEC, N_MODE12, corticalMax_mode12);
        expect(s50.spoke_count).toBe(142);
    });
});

describe('V1 distortion types enum', () => {
    it('type 5 is cortical_isotropic', () => {
        const type5 = modes.v1_distortion_types['5'];
        expect(type5).toBeDefined();
        expect(type5.name).toBe('cortical_isotropic');
    });

    it('type 5 references FOVI in label', () => {
        const type5 = modes.v1_distortion_types['5'];
        expect(type5.label).toMatch(/FOVI/i);
    });
});
