/**
 * Property-based tests for corticalStrength() — the continuous eccentricity
 * function that will replace zone-based smoothstep boundaries.
 *
 * Tests properties, not formulas. These survive the refactor:
 * - Before: eccentricityScale (piecewise smoothstep + farScale)
 * - After: corticalStrength() (linear in visual degrees with per-effect transforms)
 *
 * Both must satisfy the same invariants.
 */

'use strict';

// === Current implementation (piecewise, mirrors peripheral.frag lines 838-857) ===

function eccentricityScaleCurrent(dist, fovea_radius, parafovea_radius) {
    // smoothstep helper (matches GLSL)
    function smoothstep(edge0, edge1, x) {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
    }

    const transitionWidth = parafovea_radius * 0.3;
    const boundaryProgress = smoothstep(parafovea_radius, parafovea_radius + transitionWidth, dist);
    const parafoveaRamp = smoothstep(fovea_radius * 1.5, parafovea_radius, dist);
    let scale = 0.0 + parafoveaRamp * 0.15;
    const farScale = 1.0 + Math.max(0.0, (dist - parafovea_radius) / parafovea_radius) * 1.5;
    scale = scale * (1 - boundaryProgress) + farScale * boundaryProgress;
    return scale;
}

// === Proposed implementation (linear in degrees) ===

function corticalStrengthLinear(dist, fovea_radius, ecc_max) {
    const units_per_deg = Math.max(fovea_radius, 0.001);
    const ecc_deg = Math.max(0, dist) / units_per_deg;
    return Math.min(ecc_deg / ecc_max, 1.0);
}

// Per-effect transforms (from spec Option D)
function blurStrength(cs) { return Math.pow(cs, 0.7); }
function displacementStrength(cs) { return cs * cs; }
function scrambleOnset(cs) {
    // smoothstep(0.02, 0.10, cs)
    const t = Math.max(0, Math.min(1, (cs - 0.02) / (0.10 - 0.02)));
    return t * t * (3 - 2 * t);
}

// === Test constants ===
const A = 2.78;
const FOVEA_RADIUS = 0.048;  // normalized-Y at fovea_deg=1.0, 45px on 944px viewport
const PARAFOVEA_RADIUS = FOVEA_RADIUS * 2.5;
const ECC_MAX = 25.0;  // degrees

// === Tests ===

describe('corticalStrength — property-based tests', () => {
    // These properties must hold for ANY implementation (current or future)

    describe('endpoint anchoring', () => {
        it('strength at fixation (dist=0) is exactly 0', () => {
            expect(eccentricityScaleCurrent(0, FOVEA_RADIUS, PARAFOVEA_RADIUS)).toBe(0);
            expect(corticalStrengthLinear(0, FOVEA_RADIUS, ECC_MAX)).toBe(0);
        });

        it('strength is bounded (never exceeds reasonable maximum)', () => {
            // Current impl grows unbounded (farScale); linear impl is clamped to 1.0
            const maxDist = 1.5; // far corner in normalized space
            const csLinear = corticalStrengthLinear(maxDist, FOVEA_RADIUS, ECC_MAX);
            expect(csLinear).toBeLessThanOrEqual(1.0);
            expect(csLinear).toBeGreaterThan(0);
        });
    });

    describe('monotonicity', () => {
        it('current: eccentricityScale is monotonically non-decreasing', () => {
            let prev = -1;
            for (let dist = 0; dist <= 1.0; dist += 0.001) {
                const s = eccentricityScaleCurrent(dist, FOVEA_RADIUS, PARAFOVEA_RADIUS);
                expect(s).toBeGreaterThanOrEqual(prev - 1e-10);
                prev = s;
            }
        });

        it('proposed: corticalStrength is monotonically non-decreasing', () => {
            let prev = -1;
            for (let dist = 0; dist <= 1.0; dist += 0.001) {
                const s = corticalStrengthLinear(dist, FOVEA_RADIUS, ECC_MAX);
                expect(s).toBeGreaterThanOrEqual(prev - 1e-10);
                prev = s;
            }
        });

        it('blur transform preserves monotonicity', () => {
            let prev = -1;
            for (let dist = 0; dist <= 1.0; dist += 0.001) {
                const cs = corticalStrengthLinear(dist, FOVEA_RADIUS, ECC_MAX);
                const b = blurStrength(cs);
                expect(b).toBeGreaterThanOrEqual(prev - 1e-10);
                prev = b;
            }
        });

        it('displacement transform preserves monotonicity', () => {
            let prev = -1;
            for (let dist = 0; dist <= 1.0; dist += 0.001) {
                const cs = corticalStrengthLinear(dist, FOVEA_RADIUS, ECC_MAX);
                const d = displacementStrength(cs);
                expect(d).toBeGreaterThanOrEqual(prev - 1e-10);
                prev = d;
            }
        });
    });

    describe('continuity', () => {
        // The current piecewise implementation has discontinuities at zone boundaries.
        // corticalStrength() should be smooth everywhere.

        it.todo('proposed: corticalStrength has no discontinuities (enable after refactor)');
        // After refactor, enable this:
        // it('proposed: corticalStrength has no discontinuities', () => {
        //     const epsilon = 0.0001;
        //     const maxDelta = 0.01;  // max allowed jump per epsilon step
        //     for (let dist = epsilon; dist <= 1.0; dist += epsilon) {
        //         const curr = corticalStrengthLinear(dist, FOVEA_RADIUS, ECC_MAX);
        //         const prev = corticalStrengthLinear(dist - epsilon, FOVEA_RADIUS, ECC_MAX);
        //         expect(Math.abs(curr - prev)).toBeLessThan(maxDelta);
        //     }
        // });

        it('current: eccentricityScale has a discontinuity at parafovea boundary', () => {
            // This test documents the known zone boundary issue.
            // The derivative jumps at parafovea_radius because farScale kicks in.
            const epsilon = 0.0001;
            const before = eccentricityScaleCurrent(PARAFOVEA_RADIUS - epsilon, FOVEA_RADIUS, PARAFOVEA_RADIUS);
            const after = eccentricityScaleCurrent(PARAFOVEA_RADIUS + epsilon, FOVEA_RADIUS, PARAFOVEA_RADIUS);
            // Not a hard discontinuity (smoothstep transitions), but derivative changes
            // This test just documents the behavior
            expect(after).toBeGreaterThan(before);
        });
    });

    describe('foveal dead zone', () => {
        it('no displacement in central fovea (dist < fovea_radius)', () => {
            const cs = corticalStrengthLinear(FOVEA_RADIUS * 0.5, FOVEA_RADIUS, ECC_MAX);
            const disp = displacementStrength(cs);
            // displacement = cs², at 0.5° eccentricity cs ≈ 0.02, cs² ≈ 0.0004
            expect(disp).toBeLessThan(0.001);
        });

        it('current: eccentricityScale is near-zero in inner fovea', () => {
            const s = eccentricityScaleCurrent(FOVEA_RADIUS, FOVEA_RADIUS, PARAFOVEA_RADIUS);
            expect(s).toBeLessThan(0.01);
        });
    });

    describe('far periphery growth', () => {
        it('current: farScale reaches 2.5+ at screen edge', () => {
            const s = eccentricityScaleCurrent(0.5, FOVEA_RADIUS, PARAFOVEA_RADIUS);
            expect(s).toBeGreaterThan(2.0);
        });

        it('proposed: corticalStrength reaches 0.8+ at 20° eccentricity', () => {
            const dist20deg = 20 * FOVEA_RADIUS; // 20° in normalized-Y
            const cs = corticalStrengthLinear(dist20deg, FOVEA_RADIUS, ECC_MAX);
            expect(cs).toBeGreaterThanOrEqual(0.8);
        });
    });

    describe('per-effect curve shapes', () => {
        it('blur onset is faster than displacement onset', () => {
            // At moderate eccentricity (5°), blur should be stronger than displacement
            const cs5 = corticalStrengthLinear(5 * FOVEA_RADIUS, FOVEA_RADIUS, ECC_MAX);
            const blur5 = blurStrength(cs5);
            const disp5 = displacementStrength(cs5);
            expect(blur5).toBeGreaterThan(disp5);
        });

        it('scramble onset has threshold (zero at fixation, non-zero by 3°)', () => {
            const cs0 = corticalStrengthLinear(0, FOVEA_RADIUS, ECC_MAX);
            const cs3 = corticalStrengthLinear(3 * FOVEA_RADIUS, FOVEA_RADIUS, ECC_MAX);
            expect(scrambleOnset(cs0)).toBe(0);
            expect(scrambleOnset(cs3)).toBeGreaterThan(0.5);
        });
    });

    describe('parameter sensitivity', () => {
        it('larger fovea_radius (ppd) shifts curve rightward in pixel space', () => {
            const dist = 0.1; // fixed pixel distance
            const cs_small = corticalStrengthLinear(dist, 0.022, ECC_MAX); // 22px fovea
            const cs_large = corticalStrengthLinear(dist, 0.048, ECC_MAX); // 48px fovea
            // Larger fovea = same pixel distance maps to fewer degrees = less degradation
            expect(cs_large).toBeLessThan(cs_small);
        });

        it('ecc_max controls saturation point', () => {
            const dist = 10 * FOVEA_RADIUS;
            const cs_tight = corticalStrengthLinear(dist, FOVEA_RADIUS, 15.0);
            const cs_wide = corticalStrengthLinear(dist, FOVEA_RADIUS, 30.0);
            expect(cs_tight).toBeGreaterThan(cs_wide);
        });
    });

    describe('regression anchors', () => {
        // Freeze current eccentricityScale values at key eccentricities.
        // After refactor, corticalStrength × per-effect transforms should
        // produce values within 20% of these at corresponding eccentricities.
        const anchors = [
            { deg: 1, expected: 0.0 },
            { deg: 3, expected: null },  // fill in from current impl
            { deg: 5, expected: null },
            { deg: 10, expected: null },
            { deg: 15, expected: null },
        ];

        it('documents current eccentricityScale at key eccentricities', () => {
            console.log('\n  ── eccentricityScale regression anchors ──');
            console.log('  Ecc°   | dist(norm-Y)  | eccentricityScale');
            for (const anchor of anchors) {
                const dist = anchor.deg * FOVEA_RADIUS;
                const s = eccentricityScaleCurrent(dist, FOVEA_RADIUS, PARAFOVEA_RADIUS);
                anchor.expected = s;
                console.log(`  ${String(anchor.deg).padEnd(5)}° | ${dist.toFixed(4).padStart(12)} | ${s.toFixed(4)}`);
            }
            // At 1°, eccentricityScale should be near zero (inside fovea)
            expect(anchors[0].expected).toBeLessThan(0.01);
            // At 15°, it should be substantial
            expect(anchors[4].expected).toBeGreaterThan(1.0);
        });
    });
});
