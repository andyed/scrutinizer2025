/**
 * Unit tests for the FOVI cortical magnification → MIP level mapping.
 *
 * Tests the core formula:
 *   mipLevel = maxMip × log1p(r / a) / log1p(r_max / a)
 *
 * where:
 *   r      = eccentricity in degrees
 *   a      = CMF scale constant (degrees), default 2.78
 *   r_max  = half-FOV in degrees
 *   maxMip = log2(textureWidth), e.g. 10 for a 1024px texture
 *
 * Covers:
 *  - Endpoint anchoring (r=0 → MIP 0, r=r_max → maxMip)
 *  - Monotonicity — MIP level never decreases as eccentricity grows
 *  - Bounds — output always in [0, maxMip]
 *  - Analytic spot checks at known eccentricities
 *  - Regression guard — old log2 bug must produce different values
 *  - Inversion round-trip — eccentricity ↔ MIP level
 *
 * Run: node tests/unit/index.js
 */

'use strict';

// The describe and it globals are provided by Jest.

// ─── Reference implementation (mirrors the GLSL shader) ─────────────────────

/**
 * Corrected CMF → MIP mapping (log1p form, normalized to [0, maxMip]).
 */
function mipCorrect(r_deg, a, rMax, maxMip) {
    const cortical_max = Math.log1p(rMax / a);
    const cortical_dist = Math.log1p(r_deg / a);
    return Math.min(maxMip, maxMip * cortical_dist / cortical_max);
}

/**
 * Old buggy formula — unnormalized log2, over-pools ~48%.
 */
function mipBuggy(r_deg, a) {
    return Math.log2(Math.max(1.0, (r_deg + a) / a));
}

/**
 * Inverse: MIP level → eccentricity in degrees.
 *   r = a × (exp(mip/maxMip × cortical_max) − 1)
 */
function mipToEcc(mip, a, rMax, maxMip) {
    const cortical_max = Math.log1p(rMax / a);
    return a * (Math.exp(mip / maxMip * cortical_max) - 1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertClose(actual, expected, tol, label) {
    const msg = `${label}: expected ${expected}, got ${actual} (tol ±${tol})`;
    expect(Number.isFinite(actual)).toBeTruthy();
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

// ─── Default parameters ─────────────────────────────────────────────────────

const A       = 2.78;    // FOVI scale constant (degrees)
const FOV     = 30.0;    // field of view (degrees)
const R_MAX   = FOV / 2; // half-FOV = 15°
const MAX_MIP = 10;      // log2(1024)

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CMF → MIP level mapping', function () {

    // ── Endpoint anchoring ──────────────────────────────────────────────

    it('r = 0 → MIP 0 (fovea is always sharp)', function () {
        assertClose(mipCorrect(0, A, R_MAX, MAX_MIP), 0, 1e-10, 'mip(0)');
    });

    it('r = r_max → maxMip (edge of field)', function () {
        assertClose(mipCorrect(R_MAX, A, R_MAX, MAX_MIP), MAX_MIP, 1e-10, 'mip(r_max)');
    });

    // ── Monotonicity ────────────────────────────────────────────────────

    it('MIP level is strictly monotonically increasing with eccentricity', function () {
        let prev = -1;
        for (let r = 0; r <= R_MAX; r += 0.1) {
            const m = mipCorrect(r, A, R_MAX, MAX_MIP);
            expect(m).toBeGreaterThanOrEqual(prev);
            prev = m;
        }
    });

    // ── Bounds ──────────────────────────────────────────────────────────

    it('output is always in [0, maxMip] for any eccentricity in [0, r_max]', function () {
        for (let r = 0; r <= R_MAX; r += 0.05) {
            const m = mipCorrect(r, A, R_MAX, MAX_MIP);
            expect(m >= 0 && m <= MAX_MIP).toBeTruthy();
        }
    });

    it('eccentricity beyond r_max is clamped to maxMip', function () {
        // Formula clamps via Math.min, so overshooting r_max still yields maxMip
        const m = mipCorrect(R_MAX * 2, A, R_MAX, MAX_MIP);
        assertClose(m, MAX_MIP, 1e-10, 'mip(2×r_max)');
    });

    // ── Analytic spot checks ────────────────────────────────────────────

    it('matches analytic formula at r = 5°, 10°, 16°', function () {
        const cortical_max = Math.log1p(R_MAX / A);

        const cases = [
            { r: 5,  label: '5°'  },
            { r: 10, label: '10°' },
            { r: 16, label: '16°' },
        ];

        for (const { r, label } of cases) {
            const expected = MAX_MIP * Math.log1p(r / A) / cortical_max;
            const clamped = Math.min(MAX_MIP, expected);
            assertClose(mipCorrect(r, A, R_MAX, MAX_MIP), clamped, 1e-10, label);
        }
    });

    // ── Regression guard: old log2 bug ──────────────────────────────────

    it('old log2 formula diverges from corrected formula (regression check)', function () {
        // At any non-zero eccentricity, the buggy formula must differ
        const r = 10;
        const correct = mipCorrect(r, A, R_MAX, MAX_MIP);
        const buggy   = mipBuggy(r, A);
        const diff = Math.abs(correct - buggy);
        expect(diff > 0.5).toBeTruthy();
    });

    // ── Inversion round-trip ────────────────────────────────────────────

    it('eccentricity → MIP → eccentricity round-trips within tolerance', function () {
        const testPoints = [0, 1, 2.78, 5, 10, 14.99];
        for (const r of testPoints) {
            const mip = mipCorrect(r, A, R_MAX, MAX_MIP);
            const recovered = mipToEcc(mip, A, R_MAX, MAX_MIP);
            assertClose(recovered, r, 1e-8, `round-trip r=${r}`);
        }
    });

    // ── Parameter sensitivity ───────────────────────────────────────────

    it('smaller a produces steeper foveal falloff (more MIP at same eccentricity)', function () {
        const r = 5;
        const mip_steep = mipCorrect(r, 1.0, R_MAX, MAX_MIP);  // small a
        const mip_flat  = mipCorrect(r, 5.0, R_MAX, MAX_MIP);  // large a
        expect(mip_steep > mip_flat).toBeTruthy();
    });

    it('different maxMip scales output proportionally', function () {
        const r = 7;
        const mip8  = mipCorrect(r, A, R_MAX, 8);
        const mip12 = mipCorrect(r, A, R_MAX, 12);
        // Ratio should be 12/8 = 1.5
        assertClose(mip12 / mip8, 1.5, 1e-10, 'maxMip scaling');
    });
});
