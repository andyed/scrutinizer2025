/**
 * Unit tests for renderer/peripheral-calibration.js
 *
 * Anchors the text-primitive calibration against published thresholds:
 *   - Anstis 1974 / Strasburger 2011 (acuity) for letterFidelity
 *   - Bouma 1970 / Pelli & Tillman 2008 (crowding) for wordCoherence
 *   - Oliva & Torralba 2006 (gist) for paragraphPresence
 *
 * Tolerances reflect the inter-observer variance documented in the sources
 * (notably Bouma's b ∈ [0.3, 0.5] per Pelli & Tillman). If these tests fail
 * it is either a code bug or an intentional re-calibration — in the latter
 * case update docs/dom-aware-perception-plan.md's validation table too.
 */

'use strict';

const cal = require('../../renderer/peripheral-calibration');

// Standard viewing: 45 px/deg (1° foveal radius ≈ 45px in Scrutinizer's
// default viewport — matches peripheral.frag's pixels-per-degree convention).
const PPD = 45;

describe('acuityThreshold — Strasburger 2011', () => {
    it('returns the foveal baseline MAR (~0.063 deg) at eccentricity 0', () => {
        expect(cal.acuityThreshold(0)).toBeCloseTo(0.0633, 3);
    });

    it('grows linearly with eccentricity (Anstis 1974 slope ≈ 0.0875)', () => {
        expect(cal.acuityThreshold(10)).toBeCloseTo(0.0875 * 10 + 0.0633, 3);
        expect(cal.acuityThreshold(20)).toBeCloseTo(0.0875 * 20 + 0.0633, 3);
    });

    it('is monotone non-decreasing', () => {
        let prev = -Infinity;
        for (let e = 0; e <= 30; e += 2) {
            const v = cal.acuityThreshold(e);
            expect(v).toBeGreaterThanOrEqual(prev);
            prev = v;
        }
    });

    it('clamps negative eccentricity to foveal baseline', () => {
        expect(cal.acuityThreshold(-5)).toBeCloseTo(0.0633, 3);
    });
});

describe('letterFidelity — acuity-driven text legibility', () => {
    it('is 1.0 at fovea for standard 14px body text', () => {
        // 14px font, x-height 7px at ppd=45 → ~0.156 deg. MAR at 0 = 0.063.
        // Ratio 2.5×, well above 2× MAR → smoothstep saturates to 1.
        expect(cal.letterFidelity(0.156, 0)).toBeGreaterThan(0.95);
    });

    it('is 0 when x-height is sub-acuity', () => {
        // Far periphery (20°, MAR ≈ 1.81°), 0.1° x-height → deeply sub-acuity.
        expect(cal.letterFidelity(0.1, 20)).toBeLessThan(0.05);
    });

    it('is near 0.5 when x-height equals MAR (threshold)', () => {
        const mar = cal.acuityThreshold(10);
        expect(cal.letterFidelity(mar, 10)).toBeCloseTo(0.5, 1);
    });

    it('returns 0 for non-positive x-height', () => {
        expect(cal.letterFidelity(0, 5)).toBe(0);
        expect(cal.letterFidelity(-0.1, 5)).toBe(0);
    });

    it('is monotone in x-height at fixed eccentricity', () => {
        let prev = -Infinity;
        for (let x = 0.01; x <= 1.0; x += 0.05) {
            const v = cal.letterFidelity(x, 10);
            expect(v).toBeGreaterThanOrEqual(prev - 1e-10);
            prev = v;
        }
    });

    it('is monotone non-increasing in eccentricity at fixed x-height', () => {
        const xHeightDeg = 0.2;
        let prev = Infinity;
        for (let e = 0; e <= 30; e += 2) {
            const v = cal.letterFidelity(xHeightDeg, e);
            expect(v).toBeLessThanOrEqual(prev + 1e-10);
            prev = v;
        }
    });
});

describe('wordCoherence — Bouma crowding', () => {
    it('is 1.0 at the fovea (no crowding by definition)', () => {
        expect(cal.wordCoherence(0.1, 0)).toBe(1.0);
    });

    it('is near 0.5 at Bouma threshold (spacing = b×e with b=0.5)', () => {
        const ecc = 10;
        const bouma = 0.5;
        const sCrit = bouma * ecc;
        // ratio = 1 → log2 = 0 → smoothstep(-0.6, 0.6, 0) = 0.5 exactly.
        expect(cal.wordCoherence(sCrit, ecc)).toBeCloseTo(0.5, 2);
    });

    it('is near 1.0 when spacing comfortably exceeds Bouma', () => {
        // 2× Bouma threshold → +1 octave → smoothstep saturates to 1.
        expect(cal.wordCoherence(10, 10)).toBeGreaterThan(0.95);
    });

    it('is near 0 when spacing is well below Bouma', () => {
        // 0.25× Bouma threshold at ecc=10: spacing=1.25°, sCrit=5° → -2 octaves.
        expect(cal.wordCoherence(1.25, 10)).toBeLessThan(0.05);
    });

    it('honors Pelli & Tillman 2008 inter-observer range for b ∈ [0.3, 0.5]', () => {
        const ecc = 10;
        const spacing = 3;  // 3° spacing at 10° ecc
        // b=0.5 → sCrit=5, ratio 0.6 → slightly below threshold → < 0.5
        // b=0.3 → sCrit=3, ratio 1.0 → at threshold → ≈ 0.5
        const tight = cal.wordCoherence(spacing, ecc, 0.5);
        const loose = cal.wordCoherence(spacing, ecc, 0.3);
        expect(loose).toBeGreaterThan(tight);
    });

    it('is monotone in spacing at fixed eccentricity', () => {
        let prev = -Infinity;
        for (let s = 0.1; s <= 10; s += 0.5) {
            const v = cal.wordCoherence(s, 10);
            expect(v).toBeGreaterThanOrEqual(prev - 1e-10);
            prev = v;
        }
    });

    it('is monotone non-increasing in eccentricity at fixed spacing', () => {
        const spacing = 1.0;
        let prev = Infinity;
        for (let e = 1; e <= 30; e += 2) {
            const v = cal.wordCoherence(spacing, e);
            expect(v).toBeLessThanOrEqual(prev + 1e-10);
            prev = v;
        }
    });
});

describe('paragraphPresence — gist-level extent detection', () => {
    it('is 0 for zero or negative extent', () => {
        expect(cal.paragraphPresence(0, 5)).toBe(0);
        expect(cal.paragraphPresence(-1, 5)).toBe(0);
    });

    it('is non-zero for large bboxes at any eccentricity', () => {
        expect(cal.paragraphPresence(10, 30)).toBeGreaterThan(0.5);
    });

    it('is monotone in extent at fixed eccentricity', () => {
        let prev = -Infinity;
        for (let x = 0.01; x <= 10; x += 0.2) {
            const v = cal.paragraphPresence(x, 10);
            expect(v).toBeGreaterThanOrEqual(prev - 1e-10);
            prev = v;
        }
    });
});

describe('textCalibrator — integration', () => {
    function makeTextBlock(fontSizePx, widthPx, heightPx) {
        return { fontSizePx, w: widthPx, h: heightPx };
    }

    it('produces all three parameters in [0, 1]', () => {
        const block = makeTextBlock(16, 200, 20);
        const r = cal.textCalibrator(block, 5, PPD);
        for (const k of ['identityFidelity', 'categoryFidelity', 'extentPresence']) {
            expect(r[k]).toBeGreaterThanOrEqual(0);
            expect(r[k]).toBeLessThanOrEqual(1);
        }
    });

    it('enforces monotone ordering: identity ≤ category ≤ extent', () => {
        const block = makeTextBlock(14, 300, 18);
        for (const ecc of [0, 2, 5, 10, 15, 20]) {
            const r = cal.textCalibrator(block, ecc, PPD);
            expect(r.identityFidelity).toBeLessThanOrEqual(r.categoryFidelity + 1e-10);
            expect(r.categoryFidelity).toBeLessThanOrEqual(r.extentPresence + 1e-10);
        }
    });

    it('foveal text is fully resolvable (all parameters near 1)', () => {
        const block = makeTextBlock(16, 400, 24);
        const r = cal.textCalibrator(block, 0, PPD);
        expect(r.identityFidelity).toBeGreaterThan(0.9);
        expect(r.categoryFidelity).toBeGreaterThan(0.9);
        expect(r.extentPresence).toBeGreaterThan(0.9);
    });

    it('far-peripheral small text loses identity first, then category', () => {
        const block = makeTextBlock(12, 150, 14);
        const r = cal.textCalibrator(block, 20, PPD);
        // At 20° with 12px body text, identity should be low; extent still high
        // (the paragraph is big enough to be detected at gist level).
        expect(r.identityFidelity).toBeLessThan(0.3);
        expect(r.extentPresence).toBeGreaterThan(r.identityFidelity);
    });

    it('uses default ppd=45 when viewportPpd omitted', () => {
        const block = makeTextBlock(16, 200, 20);
        const rExplicit = cal.textCalibrator(block, 5, 45);
        const rDefault = cal.textCalibrator(block, 5);
        expect(rDefault).toEqual(rExplicit);
    });
});

describe('registry', () => {
    it('has text registered by default', () => {
        expect(cal.hasPrimitiveCalibration('text')).toBe(true);
    });

    it('calibratePrimitive returns zeros for unknown types', () => {
        const r = cal.calibratePrimitive('nonexistent', {}, 10, PPD);
        expect(r).toEqual({ identityFidelity: 0, categoryFidelity: 0, extentPresence: 0 });
    });

    it('allows registering a new primitive type', () => {
        cal.registerPrimitiveCalibration('__test_stub__', () => ({
            identityFidelity: 0.42, categoryFidelity: 0.5, extentPresence: 0.6
        }));
        expect(cal.hasPrimitiveCalibration('__test_stub__')).toBe(true);
        const r = cal.calibratePrimitive('__test_stub__', {}, 10, PPD);
        expect(r.identityFidelity).toBe(0.42);
    });

    it('rejects invalid registration arguments', () => {
        expect(() => cal.registerPrimitiveCalibration(42, () => {})).toThrow();
        expect(() => cal.registerPrimitiveCalibration('x', 'not a fn')).toThrow();
    });
});
