'use strict';

// Shared image analysis utilities for validation scripts.
// Extracted from analyze-artifacts.js for reuse across radial profile,
// OCR validation, and artifact checks.

function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function rgbToOklab(r, g, b) {
    const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
    const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
    const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
    const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
    const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
    return {
        L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    };
}

/**
 * Compute Oklab luminance stddev within an annular ring.
 * Returns { stdDevL, stdDevA, stdDevB, meanL, sampleCount }
 */
function annularStdDev(png, fixX, fixY, rMinPx, rMaxPx) {
    let sumL = 0, sumL2 = 0;
    let sumA = 0, sumA2 = 0;
    let sumB = 0, sumB2 = 0;
    let count = 0;

    const rMin2 = rMinPx * rMinPx;
    const rMax2 = rMaxPx * rMaxPx;

    // Sample every 2nd pixel for speed
    for (let y = 0; y < png.height; y += 2) {
        for (let x = 0; x < png.width; x += 2) {
            const dx = x - fixX;
            const dy = y - fixY;
            const dist2 = dx * dx + dy * dy;
            if (dist2 >= rMin2 && dist2 < rMax2) {
                const idx = (y * png.width + x) * 4;
                const ok = rgbToOklab(png.data[idx], png.data[idx + 1], png.data[idx + 2]);
                sumL += ok.L; sumL2 += ok.L * ok.L;
                sumA += ok.a; sumA2 += ok.a * ok.a;
                sumB += ok.b; sumB2 += ok.b * ok.b;
                count++;
            }
        }
    }

    if (count < 2) return { stdDevL: 0, stdDevA: 0, stdDevB: 0, meanL: 0, sampleCount: count };

    const meanL = sumL / count;
    return {
        stdDevL: Math.sqrt(Math.max(0, sumL2 / count - meanL * meanL)),
        stdDevA: Math.sqrt(Math.max(0, sumA2 / count - (sumA / count) ** 2)),
        stdDevB: Math.sqrt(Math.max(0, sumB2 / count - (sumB / count) ** 2)),
        meanL,
        sampleCount: count,
    };
}

module.exports = {
    srgbToLinear,
    rgbToOklab,
    annularStdDev,
};
