/**
 * PeripheralCalibration — DOM-aware peripheral perception calibration registry.
 *
 * Per-primitive-type calibration functions produce three continuous parameters
 * in [0, 1] from primitive geometry + eccentricity:
 *
 *   identityFidelity  — probability the primitive's instance identity survives
 *                       peripheral degradation (which word, which icon).
 *   categoryFidelity  — probability the primitive's type survives (text vs icon
 *                       vs image vs UI chrome).
 *   extentPresence    — probability the primitive's bbox registers at gist level.
 *
 * Grounding (text primitive, v1):
 *   - Anstis 1974 / Strasburger, Rentschler & Jüttner 2011 — peripheral acuity:
 *     MAR ≈ 0.0875 × e + 0.0633 deg (gap resolution threshold).
 *   - Bouma 1970; Pelli & Tillman 2008 — crowding critical spacing:
 *     s_crit ≈ b × e, with b ≈ 0.5 (inter-observer range 0.3–0.5).
 *   - Oliva & Torralba 2006 — gist; rough extent threshold scales with
 *     eccentricity (starting constants calibrated conservatively, documented
 *     as research-question values in docs/dom-aware-perception-plan.md).
 *
 * See docs/dom-aware-perception-plan.md for the architecture and other
 * primitive types (icon, form_input, button, link, nav_item — not yet
 * registered here; they ship in Stages 6–8).
 */

(function (global) {
    'use strict';

    // --- Registry --------------------------------------------------------

    const registry = new Map();

    function registerPrimitiveCalibration(typeId, fn) {
        if (typeof typeId !== 'string' || typeof fn !== 'function') {
            throw new Error('registerPrimitiveCalibration: expected (typeId: string, fn: function)');
        }
        registry.set(typeId, fn);
    }

    function hasPrimitiveCalibration(typeId) {
        return registry.has(typeId);
    }

    function calibratePrimitive(typeId, block, eccDeg, viewportPpd) {
        const fn = registry.get(typeId);
        if (!fn) {
            // Unknown primitive types fall through with zero fidelity —
            // compositor treats as ui_surface / baseline-arm passthrough.
            return { identityFidelity: 0, categoryFidelity: 0, extentPresence: 0 };
        }
        return fn(block, eccDeg, viewportPpd);
    }

    // --- Helpers ---------------------------------------------------------

    function pxToDeg(px, pixelsPerDegree) {
        return px / Math.max(pixelsPerDegree || 0, 1);
    }

    function smoothstep(edge0, edge1, x) {
        if (edge1 === edge0) return x >= edge1 ? 1 : 0;
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
    }

    // --- Grounded calibration functions (exposed for per-type reuse) -----

    /**
     * Minimum angle of resolution (MAR) in degrees, at the given eccentricity.
     * Strasburger, Rentschler & Jüttner 2011, J Vision 11(5):13 fig 5.
     */
    function acuityThreshold(eccDeg) {
        return 0.0875 * Math.max(0, eccDeg) + 0.0633;
    }

    /**
     * Letter fidelity: 0 when x-height is below MAR, 1 when well above.
     * Smooth ~1-octave ramp around the MAR threshold.
     */
    function letterFidelity(xHeightDeg, eccDeg) {
        if (xHeightDeg <= 0) return 0;
        const mar = acuityThreshold(eccDeg);
        const octaves = Math.log2(xHeightDeg / mar);
        // -1 octave (x-height = MAR/2) → 0; +1 octave (x-height = 2×MAR) → 1.
        return smoothstep(-1, 1, octaves);
    }

    /**
     * Word coherence: 0 when inter-character spacing is below Bouma's
     * critical spacing (crowding merges letters), 1 when well above.
     * boumaB default 0.5 (Bouma 1970); Pelli & Tillman 2008 range 0.3–0.5.
     */
    function wordCoherence(spacingDeg, eccDeg, boumaB) {
        if (eccDeg <= 0) return 1.0;  // no peripheral crowding at fovea
        const b = typeof boumaB === 'number' ? boumaB : 0.5;
        const sCrit = b * eccDeg;
        if (sCrit <= 0) return 1.0;
        const ratio = spacingDeg / sCrit;
        if (ratio <= 0) return 0;
        const octaves = Math.log2(ratio);
        // ±0.6 octave ramp around the Bouma threshold.
        return smoothstep(-0.6, 0.6, octaves);
    }

    /**
     * Paragraph presence: 0 when bbox extent is below the gist-detection
     * threshold at this eccentricity, 1 when well above.
     * Conservative starting constants — treat as research-question values.
     */
    function paragraphPresence(bboxExtentDeg, eccDeg) {
        if (bboxExtentDeg <= 0) return 0;
        const extentThreshold = 0.2 + 0.03 * Math.max(0, eccDeg);
        const ratio = bboxExtentDeg / extentThreshold;
        // ratio = 1 (at threshold) → 0.125, ratio = 2 → 0.5, ratio ≥ 4 → 1.
        return smoothstep(0, 4, ratio);
    }

    // --- Text primitive calibrator --------------------------------------

    /**
     * Text primitive calibration.
     *   block:           { fontSizePx, xHeightPx?, spacingPx?, w, h, ... }
     *   eccDeg:          eccentricity of the primitive center from fovea, degrees.
     *   viewportPpd:     pixels per degree (~45 at standard 2x retina viewing).
     * Returns { identityFidelity, categoryFidelity, extentPresence }.
     */
    function textCalibrator(block, eccDeg, viewportPpd) {
        const ppd = Math.max(viewportPpd || 45, 1);
        // Latin typography: x-height ≈ 0.5 × font size (approximate; per-font
        // measurement is an option for Stage 2+ if needed).
        const xHeightPx = block.xHeightPx || (block.fontSizePx || 14) * 0.5;
        const spacingPx = block.spacingPx || (block.fontSizePx || 14) * 0.25;
        const extentPx = Math.max(block.w || 0, block.h || 0);

        const xHeightDeg = pxToDeg(xHeightPx, ppd);
        const spacingDeg = pxToDeg(spacingPx, ppd);
        const extentDeg = pxToDeg(extentPx, ppd);

        const lF = letterFidelity(xHeightDeg, eccDeg);
        const wC = wordCoherence(spacingDeg, eccDeg);
        const pP = paragraphPresence(extentDeg, eccDeg);

        // Monotone ordering: identity ≤ category ≤ extent.
        // identity requires BOTH acuity (letter shape resolvable) and uncrowded
        // spacing. category only needs one: resolvable x-height banding
        // (letterFidelity) OR resolvable word rhythm (wordCoherence). Earlier
        // max(identity, wC) collapsed to wC alone and killed the stripe-layer
        // weight — the compositor's L_categorical term never got a turn.
        const identityFidelity = Math.min(lF, wC);
        const categoryFidelity = Math.max(lF, wC);
        const extentPresence = Math.max(categoryFidelity, pP);

        return { identityFidelity, categoryFidelity, extentPresence };
    }

    registerPrimitiveCalibration('text', textCalibrator);

    // --- Export ----------------------------------------------------------

    const api = {
        registerPrimitiveCalibration,
        hasPrimitiveCalibration,
        calibratePrimitive,
        pxToDeg,
        smoothstep,
        acuityThreshold,
        letterFidelity,
        wordCoherence,
        paragraphPresence,
        textCalibrator,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.PeripheralCalibration = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
