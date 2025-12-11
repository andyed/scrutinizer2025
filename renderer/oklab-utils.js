/**
 * Oklab Color Space Conversion Utilities
 * 
 * Based on Björn Ottosson's Oklab specification:
 * https://bottosson.github.io/posts/oklab/
 * 
 * Oklab is a perceptual color space where:
 * - L: Lightness (0-1, separates luminance from chrominance)
 * - a: Green-Red opponent dimension
 * - b: Blue-Yellow opponent dimension
 * 
 * Benefits for peripheral vision simulation:
 * - Perceptually uniform desaturation (no muddy artifacts)
 * - Separates Magno (L) and Parvo (a,b) pathways biologically
 * - Natural rod vision simulation
 * 
 * License: Public Domain / MIT
 */

/**
 * Convert sRGB component to linear RGB
 * sRGB uses gamma 2.4 with a linear segment near black
 * @param {number} c - sRGB component (0-1)
 * @returns {number} Linear RGB component (0-1)
 */
function srgbToLinear(c) {
    if (c <= 0.04045) {
        return c / 12.92;
    } else {
        return Math.pow((c + 0.055) / 1.055, 2.4);
    }
}

/**
 * Convert linear RGB component to sRGB
 * @param {number} c - Linear RGB component (0-1)
 * @returns {number} sRGB component (0-1)
 */
function linearToSrgb(c) {
    if (c <= 0.0031308) {
        return c * 12.92;
    } else {
        return 1.055 * Math.pow(c, 1.0 / 2.4) - 0.055;
    }
}

/**
 * Convert linear sRGB to Oklab
 * @param {number} r - Linear red (0-1)
 * @param {number} g - Linear green (0-1)
 * @param {number} b - Linear blue (0-1)
 * @returns {{L: number, a: number, b: number}} Oklab coordinates
 */
function linearSrgbToOklab(r, g, b) {
    // Convert linear sRGB to LMS cone response
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

    // Apply non-linearity (cube root)
    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);

    // Convert to Lab coordinates
    return {
        L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    };
}

/**
 * Convert Oklab to linear sRGB
 * @param {number} L - Lightness (0-1)
 * @param {number} a - Green-Red opponent
 * @param {number} b - Blue-Yellow opponent
 * @returns {{r: number, g: number, b: number}} Linear RGB (0-1, may exceed range)
 */
function oklabToLinearSrgb(L, a, b) {
    // Convert Lab to LMS (inverse M2)
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

    // Apply inverse non-linearity (cube)
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    // Convert LMS to linear sRGB (inverse M1)
    return {
        r: +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        b: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    };
}

/**
 * Convert sRGB (0-255) to Oklab
 * Convenience function that handles gamma correction
 * @param {number} r - sRGB red (0-255)
 * @param {number} g - sRGB green (0-255)
 * @param {number} b - sRGB blue (0-255)
 * @returns {{L: number, a: number, b: number}} Oklab coordinates
 */
function rgbToOklab(r, g, b) {
    // Normalize to 0-1 and convert to linear
    const rLin = srgbToLinear(r / 255);
    const gLin = srgbToLinear(g / 255);
    const bLin = srgbToLinear(b / 255);

    return linearSrgbToOklab(rLin, gLin, bLin);
}

/**
 * Convert Oklab to sRGB (0-255)
 * Convenience function that handles gamma correction and clamping
 * @param {number} L - Lightness (0-1)
 * @param {number} a - Green-Red opponent
 * @param {number} b - Blue-Yellow opponent
 * @returns {{r: number, g: number, b: number}} sRGB (0-255, clamped)
 */
function oklabToRgb(L, a, b) {
    const linear = oklabToLinearSrgb(L, a, b);

    // Convert to sRGB and clamp
    return {
        r: Math.max(0, Math.min(255, linearToSrgb(linear.r) * 255)),
        g: Math.max(0, Math.min(255, linearToSrgb(linear.g) * 255)),
        b: Math.max(0, Math.min(255, linearToSrgb(linear.b) * 255))
    };
}

/**
 * Desaturate a color in Oklab space
 * Reduces chrominance (a, b) while preserving lightness (L)
 * @param {number} r - sRGB red (0-255)
 * @param {number} g - sRGB green (0-255)
 * @param {number} b - sRGB blue (0-255)
 * @param {number} amount - Desaturation amount (0-1, where 1 = full grayscale)
 * @returns {{r: number, g: number, b: number}} Desaturated sRGB (0-255)
 */
function desaturateOklab(r, g, b, amount) {
    const lab = rgbToOklab(r, g, b);

    // Reduce chrominance toward zero (gray)
    lab.a *= (1 - amount);
    lab.b *= (1 - amount);

    return oklabToRgb(lab.L, lab.a, lab.b);
}

// Export for use in Node.js or browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        srgbToLinear,
        linearToSrgb,
        linearSrgbToOklab,
        oklabToLinearSrgb,
        rgbToOklab,
        oklabToRgb,
        desaturateOklab
    };
}
