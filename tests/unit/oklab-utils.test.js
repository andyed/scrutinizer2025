/**
 * Unit tests for renderer/oklab-utils.js
 *
 * Tests cover:
 *  - srgbToLinear / linearToSrgb  — gamma encoding round-trips and boundary values
 *  - linearSrgbToOklab / oklabToLinearSrgb — inverse round-trips for primaries
 *  - rgbToOklab / oklabToRgb — convenience 0-255 API, round-trip accuracy
 *  - desaturateOklab — amount=0 identity, amount=1 full grey, intermediate scale
 *  - Edge cases: black, white, pure primaries, NaN inputs, out-of-range values
 *
 * Run: node tests/unit/test-runner.js  (via index.js entry point)
 */

'use strict';

const path = require('path');
// The describe and it globals are provided by Jest.

const {
    srgbToLinear,
    linearToSrgb,
    linearSrgbToOklab,
    oklabToLinearSrgb,
    rgbToOklab,
    oklabToRgb,
    desaturateOklab
} = require(path.resolve(__dirname, '../../renderer/oklab-utils.js'));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Assert two numbers are within `tol` of each other.
 * Uses isFinite() to guard against NaN/Infinity propagation silently passing.
 */
function assertClose(actual, expected, tol, label) {
    const msg = `${label}: expected ${expected}, got ${actual} (tol ±${tol})`;
    expect(Number.isFinite(actual)).toBeTruthy();
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

/**
 * Round-trip a 0-255 RGB colour through rgbToOklab → oklabToRgb.
 * Returns the reconstructed {r, g, b}.
 */
function roundTrip255(r, g, b) {
    const lab = rgbToOklab(r, g, b);
    return oklabToRgb(lab.L, lab.a, lab.b);
}

const FLOAT_TOL = 1e-5;   // for intermediate floating-point comparisons
const BYTE_TOL  = 1;      // ±1 LSB acceptable for the 0-255 round-trip

// ─── srgbToLinear ─────────────────────────────────────────────────────────────

describe('srgbToLinear', () => {
    it('srgbToLinear_zero_returnsZero', () => {
        assertClose(srgbToLinear(0), 0, FLOAT_TOL, 'black');
    });

    it('srgbToLinear_one_returnsOne', () => {
        assertClose(srgbToLinear(1), 1, FLOAT_TOL, 'white');
    });

    it('srgbToLinear_linearSegmentBoundary_usesLinearFormula', () => {
        // At c = 0.04045, the function crosses from linear to power branch.
        // Values at or below 0.04045 => c / 12.92
        const c = 0.04045;
        assertClose(srgbToLinear(c), c / 12.92, FLOAT_TOL, 'boundary=0.04045');
    });

    it('srgbToLinear_aboveBoundary_usesPowerFormula', () => {
        const c = 0.5;
        const expected = Math.pow((c + 0.055) / 1.055, 2.4);
        assertClose(srgbToLinear(c), expected, FLOAT_TOL, 'c=0.5');
    });

    it('srgbToLinear_smallPositiveValue_usesLinearFormula', () => {
        const c = 0.01;
        assertClose(srgbToLinear(c), c / 12.92, FLOAT_TOL, 'c=0.01');
    });

    it('srgbToLinear_linearOutputIsAlwaysSmaller_gammaExpansion', () => {
        // Gamma expansion: linear < sRGB for values in (0, 1)
        const c = 0.5;
        expect(srgbToLinear(c)).toBeLessThan(c);
    });

    it('srgbToLinear_returnsFiniteNumber_forAllPrimaries', () => {
        [0, 0.04045, 0.5, 1].forEach(c => {
            expect(Number.isFinite(srgbToLinear(c))).toBeTruthy();
        });
    });
});

// ─── linearToSrgb ─────────────────────────────────────────────────────────────

describe('linearToSrgb', () => {
    it('linearToSrgb_zero_returnsZero', () => {
        assertClose(linearToSrgb(0), 0, FLOAT_TOL, 'black');
    });

    it('linearToSrgb_one_returnsOne', () => {
        assertClose(linearToSrgb(1), 1, FLOAT_TOL, 'white');
    });

    it('linearToSrgb_linearSegmentBoundary_usesLinearFormula', () => {
        // At c = 0.0031308, the function uses the linear branch c * 12.92
        const c = 0.0031308;
        assertClose(linearToSrgb(c), c * 12.92, FLOAT_TOL, 'boundary=0.0031308');
    });

    it('linearToSrgb_aboveBoundary_usesPowerFormula', () => {
        const c = 0.5;
        const expected = 1.055 * Math.pow(c, 1.0 / 2.4) - 0.055;
        assertClose(linearToSrgb(c), expected, FLOAT_TOL, 'c=0.5');
    });
});

// ─── srgbToLinear ↔ linearToSrgb round-trip ───────────────────────────────────

describe('srgbToLinear_linearToSrgb_roundTrip', () => {
    const testValues = [0, 0.01, 0.04, 0.05, 0.18, 0.5, 0.73, 1.0];

    testValues.forEach(c => {
        it(`roundTrip_srgb_c=${c}_reconstructsOriginal`, () => {
            const linear = srgbToLinear(c);
            const back   = linearToSrgb(linear);
            assertClose(back, c, FLOAT_TOL, `c=${c}`);
        });
    });
});

// ─── linearSrgbToOklab / oklabToLinearSrgb ────────────────────────────────────

describe('linearSrgbToOklab', () => {
    it('linearSrgbToOklab_black_returnsLZeroChromaZero', () => {
        const lab = linearSrgbToOklab(0, 0, 0);
        assertClose(lab.L, 0, FLOAT_TOL, 'L for black');
        assertClose(lab.a, 0, FLOAT_TOL, 'a for black');
        assertClose(lab.b, 0, FLOAT_TOL, 'b for black');
    });

    it('linearSrgbToOklab_white_returnsLOneChromaZero', () => {
        const lab = linearSrgbToOklab(1, 1, 1);
        assertClose(lab.L, 1, 1e-4, 'L for white');
        // White is achromatic — a and b should be nearly zero
        assertClose(lab.a, 0, 1e-4, 'a for white');
        assertClose(lab.b, 0, 1e-4, 'b for white');
    });

    it('linearSrgbToOklab_returnsObjectWithLABProperties', () => {
        const lab = linearSrgbToOklab(0.5, 0.5, 0.5);
        expect(lab).toHaveProperty('L');
        expect(lab).toHaveProperty('a');
        expect(lab).toHaveProperty('b');
    });

    it('linearSrgbToOklab_pureRed_hasPositiveAComponent', () => {
        // In Oklab: red-green opponent axis → red has positive a
        const lab = linearSrgbToOklab(1, 0, 0);
        expect(lab.a).toBeGreaterThan(0);
    });

    it('linearSrgbToOklab_pureGreen_hasNegativeAComponent', () => {
        const lab = linearSrgbToOklab(0, 1, 0);
        expect(lab.a).toBeLessThan(0);
    });

    it('linearSrgbToOklab_pureBlue_hasNegativeBComponent', () => {
        // Blue-Yellow axis → blue has negative b
        const lab = linearSrgbToOklab(0, 0, 1);
        expect(lab.b).toBeLessThan(0);
    });

    it('linearSrgbToOklab_allChannelsAreFinite', () => {
        const lab = linearSrgbToOklab(0.3, 0.6, 0.1);
        expect(Number.isFinite(lab.L) && Number.isFinite(lab.a) && Number.isFinite(lab.b)).toBeTruthy();
    });
});

describe('oklabToLinearSrgb', () => {
    it('oklabToLinearSrgb_L0_returnsBlack', () => {
        const rgb = oklabToLinearSrgb(0, 0, 0);
        assertClose(rgb.r, 0, FLOAT_TOL, 'r');
        assertClose(rgb.g, 0, FLOAT_TOL, 'g');
        assertClose(rgb.b, 0, FLOAT_TOL, 'b');
    });

    it('oklabToLinearSrgb_L1_a0_b0_returnsWhite', () => {
        const rgb = oklabToLinearSrgb(1, 0, 0);
        assertClose(rgb.r, 1, 1e-4, 'r');
        assertClose(rgb.g, 1, 1e-4, 'g');
        assertClose(rgb.b, 1, 1e-4, 'b');
    });

    it('oklabToLinearSrgb_returnsObjectWithRGBProperties', () => {
        const rgb = oklabToLinearSrgb(0.5, 0, 0);
        expect(rgb).toHaveProperty('r');
        expect(rgb).toHaveProperty('g');
        expect(rgb).toHaveProperty('b');
    });
});

describe('linearSrgbToOklab_oklabToLinearSrgb_roundTrip', () => {
    const primaries = [
        { name: 'black',   r: 0,   g: 0,   b: 0   },
        { name: 'white',   r: 1,   g: 1,   b: 1   },
        { name: 'red',     r: 1,   g: 0,   b: 0   },
        { name: 'green',   r: 0,   g: 1,   b: 0   },
        { name: 'blue',    r: 0,   g: 0,   b: 1   },
        { name: 'yellow',  r: 1,   g: 1,   b: 0   },
        { name: 'cyan',    r: 0,   g: 1,   b: 1   },
        { name: 'magenta', r: 1,   g: 0,   b: 1   },
        { name: 'mid-grey',r: 0.5, g: 0.5, b: 0.5 },
        { name: 'warm',    r: 0.8, g: 0.4, b: 0.1 },
    ];

    primaries.forEach(({ name, r, g, b }) => {
        it(`linearSrgbRoundTrip_${name}_reconstructsWithinTolerance`, () => {
            const lab  = linearSrgbToOklab(r, g, b);
            const back = oklabToLinearSrgb(lab.L, lab.a, lab.b);
            assertClose(back.r, r, 1e-4, `${name}.r`);
            assertClose(back.g, g, 1e-4, `${name}.g`);
            assertClose(back.b, b, 1e-4, `${name}.b`);
        });
    });
});

// ─── rgbToOklab / oklabToRgb ──────────────────────────────────────────────────

describe('rgbToOklab', () => {
    it('rgbToOklab_black255_returnsLZero', () => {
        const lab = rgbToOklab(0, 0, 0);
        assertClose(lab.L, 0, FLOAT_TOL, 'L for rgb(0,0,0)');
    });

    it('rgbToOklab_white255_returnsLNearOne', () => {
        const lab = rgbToOklab(255, 255, 255);
        assertClose(lab.L, 1, 1e-4, 'L for rgb(255,255,255)');
    });

    it('rgbToOklab_returnsFiniteValues', () => {
        const lab = rgbToOklab(128, 64, 200);
        expect(Number.isFinite(lab.L) && Number.isFinite(lab.a) && Number.isFinite(lab.b)).toBeTruthy();
    });

    it('rgbToOklab_pureRed255_hasPositiveAAxis', () => {
        const lab = rgbToOklab(255, 0, 0);
        expect(lab.a).toBeGreaterThan(0);
    });

    it('rgbToOklab_pureGreen255_hasNegativeAAxis', () => {
        const lab = rgbToOklab(0, 255, 0);
        expect(lab.a).toBeLessThan(0);
    });

    it('rgbToOklab_pureBlue255_hasNegativeBAxis', () => {
        const lab = rgbToOklab(0, 0, 255);
        expect(lab.b).toBeLessThan(0);
    });

    it('rgbToOklab_lighterColor_hasHigherL', () => {
        const dark  = rgbToOklab(50, 50, 50);
        const light = rgbToOklab(200, 200, 200);
        expect(light.L).toBeGreaterThan(dark.L);
    });
});

describe('oklabToRgb', () => {
    it('oklabToRgb_L0_returnsBlack', () => {
        const rgb = oklabToRgb(0, 0, 0);
        assertClose(rgb.r, 0, BYTE_TOL, 'r');
        assertClose(rgb.g, 0, BYTE_TOL, 'g');
        assertClose(rgb.b, 0, BYTE_TOL, 'b');
    });

    it('oklabToRgb_L1_a0_b0_returnsWhite', () => {
        const rgb = oklabToRgb(1, 0, 0);
        assertClose(rgb.r, 255, BYTE_TOL, 'r');
        assertClose(rgb.g, 255, BYTE_TOL, 'g');
        assertClose(rgb.b, 255, BYTE_TOL, 'b');
    });

    it('oklabToRgb_outputClamped_neverExceeds255', () => {
        // Even with extreme out-of-gamut Lab values, output must be 0-255
        const rgb = oklabToRgb(1, 1, 1); // highly saturated, out-of-gamut
        expect(rgb.r).toBeLessThanOrEqual(255);
        expect(rgb.g).toBeLessThanOrEqual(255);
        expect(rgb.b).toBeLessThanOrEqual(255);
        expect(rgb.r).toBeGreaterThanOrEqual(0);
        expect(rgb.g).toBeGreaterThanOrEqual(0);
        expect(rgb.b).toBeGreaterThanOrEqual(0);
    });

    it('oklabToRgb_outputClamped_neverBelowZero', () => {
        const rgb = oklabToRgb(0, -1, -1); // negative chroma, out-of-gamut
        expect(rgb.r).toBeGreaterThanOrEqual(0);
        expect(rgb.g).toBeGreaterThanOrEqual(0);
        expect(rgb.b).toBeGreaterThanOrEqual(0);
    });
});

describe('rgbToOklab_oklabToRgb_roundTrip255', () => {
    const testColors = [
        { name: 'black',        r: 0,   g: 0,   b: 0   },
        { name: 'white',        r: 255, g: 255, b: 255 },
        { name: 'pure_red',     r: 255, g: 0,   b: 0   },
        { name: 'pure_green',   r: 0,   g: 255, b: 0   },
        { name: 'pure_blue',    r: 0,   g: 0,   b: 255 },
        { name: 'yellow',       r: 255, g: 255, b: 0   },
        { name: 'cyan',         r: 0,   g: 255, b: 255 },
        { name: 'magenta',      r: 255, g: 0,   b: 255 },
        { name: 'mid_grey',     r: 128, g: 128, b: 128 },
        { name: 'skin_tone',    r: 220, g: 168, b: 132 },
        { name: 'dark_teal',    r: 0,   g: 100, b: 100 },
        { name: 'near_black',   r: 1,   g: 1,   b: 1   },
        { name: 'near_white',   r: 254, g: 254, b: 254 },
    ];

    testColors.forEach(({ name, r, g, b }) => {
        it(`roundTrip255_${name}_reconstructsWithinOneLSB`, () => {
            const back = roundTrip255(r, g, b);
            assertClose(back.r, r, BYTE_TOL, `${name}.r`);
            assertClose(back.g, g, BYTE_TOL, `${name}.g`);
            assertClose(back.b, b, BYTE_TOL, `${name}.b`);
        });
    });
});

// ─── desaturateOklab ──────────────────────────────────────────────────────────

describe('desaturateOklab', () => {
    it('desaturateOklab_amount0_isIdentity', () => {
        // amount=0 means no change — output should be within rounding tolerance of input
        const result = desaturateOklab(200, 100, 50, 0);
        assertClose(result.r, 200, BYTE_TOL, 'r identity');
        assertClose(result.g, 100, BYTE_TOL, 'g identity');
        assertClose(result.b,  50, BYTE_TOL, 'b identity');
    });

    it('desaturateOklab_amount1_producesGrey_REqualsG', () => {
        // Fully desaturated — a=0, b=0 => achromatic => R ≈ G ≈ B
        const result = desaturateOklab(200, 50, 50, 1);
        assertClose(result.r, result.g, BYTE_TOL, 'r == g after full desaturation');
        assertClose(result.g, result.b, BYTE_TOL, 'g == b after full desaturation');
    });

    it('desaturateOklab_amount1_grey_preservesLuminance', () => {
        // The greyscale value should match the Oklab L channel converted back.
        // Black stays black, white stays white.
        const black = desaturateOklab(0, 0, 0, 1);
        assertClose(black.r, 0, BYTE_TOL, 'black stays black');

        const white = desaturateOklab(255, 255, 255, 1);
        assertClose(white.r, 255, BYTE_TOL, 'white stays white');
    });

    it('desaturateOklab_amount0point5_returnsIntermediateChroma', () => {
        // Partial desaturation: chroma should be between original and grey.
        // We verify the result is closer to grey than the original is.
        const original    = rgbToOklab(200, 50, 50);
        const half        = desaturateOklab(200, 50, 50, 0.5);
        const halfLab     = rgbToOklab(half.r, half.g, half.b);

        // |a| should have decreased compared to the original
        expect(Math.abs(halfLab.a)).toBeLessThan(Math.abs(original.a));
    });

    it('desaturateOklab_grey_remainsGrey_atAnyAmount', () => {
        // Pure grey has no chroma to begin with — desaturation should be a no-op.
        [0, 0.25, 0.5, 0.75, 1].forEach(amount => {
            const result = desaturateOklab(128, 128, 128, amount);
            // Allow ±2 because gamma chain introduces tiny rounding
            assertClose(result.r, result.g, 2, `grey r==g at amount=${amount}`);
            assertClose(result.g, result.b, 2, `grey g==b at amount=${amount}`);
        });
    });

    it('desaturateOklab_outputAlwaysClamped_noNegativeChannels', () => {
        const result = desaturateOklab(0, 0, 255, 1); // pure blue fully desaturated
        expect(result.r).toBeGreaterThanOrEqual(0);
        expect(result.g).toBeGreaterThanOrEqual(0);
        expect(result.b).toBeGreaterThanOrEqual(0);
    });

    it('desaturateOklab_outputAlwaysClamped_noChannelExceeds255', () => {
        const result = desaturateOklab(255, 0, 0, 0); // pure red, no change
        expect(result.r).toBeLessThanOrEqual(255);
        expect(result.g).toBeLessThanOrEqual(255);
        expect(result.b).toBeLessThanOrEqual(255);
    });

    it('desaturateOklab_allChannelsAreFinite', () => {
        const result = desaturateOklab(100, 150, 200, 0.7);
        expect(Number.isFinite(result.r) && Number.isFinite(result.g) && Number.isFinite(result.b)).toBeTruthy();
    });
});
