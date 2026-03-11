/**
 * Oriented DoG regression tests — v2.2 orientation-selective band attenuation.
 *
 * Tests the mathematical model (cutoff boost, energy decomposition, radial-tangential
 * anisotropy, eccentricity fade) — not the GPU shader. Mirrors the formulas in
 * peripheral.frag lines 174–338.
 *
 * Validated against:
 *   Phase 1: Appelle 1972 (oblique effect — 30-50% cardinal acuity advantage)
 *   Phase 2: Hubel & Wiesel 1962 (V1 simple cell 4-channel orientation tuning)
 *   Phase 3: Toet & Levi 1992 (radial-tangential crowding asymmetry)
 *   Phase 4: Berkley et al. 1975, Essock 1990 (eccentricity-dependent fade)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Load parameters from modes.json (source of truth) ─────────────────────

const modesPath = path.join(__dirname, '../../shared/modes.json');
const modes = JSON.parse(fs.readFileSync(modesPath, 'utf8'));

const highkey = modes.modes['highkey'].pipeline;
const biological = modes.modes['biological'].pipeline;

const DOG_E2 = highkey.dog_e2;                     // 0.15
const ORIENT_BIAS = highkey.dog_orient_bias;        // 1.0
const RADIAL_BIAS = biological.dog_radial_bias;     // 0.5

// ─── Core formulas (mirrors peripheral.frag) ────────────────────────────────

/** Linear M-scaling cutoff: eccentricity where band k drops out. */
function linearCutoffs(e2) {
    return [
        e2 * 0.41421,   // k=0: sqrt(2) - 1
        e2 * 1.0,       // k=1
        e2 * 1.82843,   // k=2: 2*sqrt(2) - 1
        e2 * 3.0,       // k=3
        e2 * 4.65685,   // k=4: 4*sqrt(2) - 1
        e2 * 7.0,       // k=5
        e2 * 10.31371,  // k=6: 8*sqrt(2) - 1
        e2 * 15.0,      // k=7
    ];
}

/**
 * 4-channel V1 energy decomposition from gradient (gx, gy).
 * Returns { energy_h, energy_v, energy_d45, energy_d135, cardinalFrac, gradMag }.
 */
function v1EnergyDecomposition(gx, gy) {
    const energy_h = gy * gy;       // horizontal edges → vertical gradient
    const energy_v = gx * gx;       // vertical edges → horizontal gradient
    const gd1 = (gx + gy) * 0.7071;
    const gd2 = (gx - gy) * 0.7071;
    const energy_d45 = gd1 * gd1;
    const energy_d135 = gd2 * gd2;

    const cardinalMax = Math.max(energy_h, energy_v);
    const obliqueMax = Math.max(energy_d45, energy_d135);
    const cardinalFrac = cardinalMax / (cardinalMax + obliqueMax + 1e-6);

    const gradMag = Math.sqrt(gx * gx + gy * gy);

    return { energy_h, energy_v, energy_d45, energy_d135, cardinalFrac, gradMag };
}

/**
 * Gradient magnitude gate — flat regions get no bonus.
 * Mirrors shader: smoothstep(0.005, 0.03, gradMag)
 */
function edgeGate(gradMag) {
    if (gradMag <= 0.005) return 0.0;
    if (gradMag >= 0.03) return 1.0;
    const t = (gradMag - 0.005) / (0.03 - 0.005);
    return t * t * (3 - 2 * t);
}

/**
 * Orient bonus: cardinalFrac × edgeGate × orient_bias.
 * Mirrors shader line 214.
 */
function orientBonus(gx, gy, orient_bias) {
    const decomp = v1EnergyDecomposition(gx, gy);
    const gate = edgeGate(decomp.gradMag);
    return decomp.cardinalFrac * gate * orient_bias;
}

/**
 * Radial-tangential modulation of orient bonus.
 * Mirrors shader lines 220–242.
 */
function radialTangentialMod(edgeDirX, edgeDirY, radialDirX, radialDirY, radial_bias) {
    const tangDirX = -radialDirY;
    const tangDirY = radialDirX;
    const tangentialAlign = Math.abs(edgeDirX * tangDirX + edgeDirY * tangDirY);
    const radialPenalty = 1.0 - radial_bias * 0.15;
    const tangentialBonus = 1.0 + radial_bias * 0.3;
    return radialPenalty + (tangentialBonus - radialPenalty) * tangentialAlign;
}

/**
 * Per-band eccentricity fade.
 * Mirrors shader lines 326–328.
 */
function eccFade(k, visual_ecc_deg) {
    const fadeStart = 3.0 + (8.0 - 3.0) * (k / 7.0);
    const fadeEnd = 10.0 + (25.0 - 10.0) * (k / 7.0);
    if (visual_ecc_deg <= fadeStart) return 1.0;
    if (visual_ecc_deg >= fadeEnd) return 0.0;
    const t = (visual_ecc_deg - fadeStart) / (fadeEnd - fadeStart);
    return 1.0 - t * t * (3 - 2 * t);
}

/**
 * Per-band cutoff boost from orient bonus + eccFade.
 * Mirrors shader lines 336–337.
 */
function cutoffBoost(k, bonus, visual_ecc_deg, orient_bias) {
    const fade = orient_bias > 3.0 ? 1.0 : eccFade(k, visual_ecc_deg);
    const bandScale = 0.5 + (0.1 - 0.5) * (k / 7.0);  // mix(0.5, 0.1, k/7)
    return 1.0 + bonus * fade * bandScale;
}

/**
 * Smoothstep band weight.
 * Mirrors shader line 346.
 */
function bandWeight(normEcc, cutoff, sharpness) {
    const transMult = 0.4 + (0.05 - 0.4) * sharpness;
    const lo = cutoff - cutoff * transMult;
    const hi = cutoff + cutoff * transMult;
    if (normEcc <= lo) return 1.0;
    if (normEcc >= hi) return 0.0;
    const t = (normEcc - lo) / (hi - lo);
    return 1.0 - t * t * (3 - 2 * t);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function assertClose(actual, expected, tol, label) {
    const msg = `${label}: expected ${expected}, got ${actual} (tol ±${tol})`;
    expect(Number.isFinite(actual)).toBeTruthy();
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

// ─── Phase 1: Oblique Effect ────────────────────────────────────────────────

describe('Phase 1: Oblique effect (Appelle 1972)', function () {

    it('cardinal edges produce cardinalFrac ≈ 2/3', function () {
        // Claim: A purely horizontal edge (gy >> gx) is classified as cardinal.
        // Basis: V1 simple cells have narrow orientation tuning. The max-of-pairs
        //   formulation yields 2/3 for pure cardinal because the D45/D135 projections
        //   each pick up half the energy: max(D45,D135) = gy²/2, so
        //   cardinalFrac = gy² / (gy² + gy²/2) = 2/3.
        const horiz = v1EnergyDecomposition(0.0, 1.0);
        assertClose(horiz.cardinalFrac, 2/3, 0.01, 'horizontal cardinalFrac');

        const vert = v1EnergyDecomposition(1.0, 0.0);
        assertClose(vert.cardinalFrac, 2/3, 0.01, 'vertical cardinalFrac');
    });

    it('oblique edges produce cardinalFrac ≈ 1/3', function () {
        // Claim: A 45° diagonal (gx ≈ gy) is classified as oblique.
        // Basis: For a 45° gradient, max(H,V) = gy² = 0.5, max(D45,D135) = (gx+gy)²/2 = 1.0,
        //   so cardinalFrac = 0.5 / (0.5 + 1.0) = 1/3.
        const diag45 = v1EnergyDecomposition(0.7071, 0.7071);
        assertClose(diag45.cardinalFrac, 1/3, 0.01, '45° cardinalFrac');

        const diag135 = v1EnergyDecomposition(0.7071, -0.7071);
        assertClose(diag135.cardinalFrac, 1/3, 0.01, '135° cardinalFrac');
    });

    it('cardinal orient bonus pushes fine-band cutoffs ~33% further at bio bias', function () {
        // Claim: At biological bias (1.0), a pure cardinal edge (cardinalFrac ≈ 2/3)
        //   pushes band 0 cutoff by ~33%.
        // Basis: Appelle (1972) — 30-50% acuity advantage for cardinal orientations.
        //   orientBonus = 2/3 × 1.0 × 1.0 = 0.667; boost = 1 + 0.667 × 1.0 × 0.5 = 1.333
        const bonus = orientBonus(0.0, 1.0, ORIENT_BIAS);
        const boost_k0 = cutoffBoost(0, bonus, 0.0, ORIENT_BIAS);
        assertClose(boost_k0, 1.333, 0.02, 'fine band boost');
    });

    it('coarse bands get less boost than fine bands', function () {
        // Claim: Coarse layout (k=7) gets less boost than fine detail (k=0).
        // Basis: The oblique effect is strongest at high spatial frequencies.
        const bonus = orientBonus(0.0, 1.0, ORIENT_BIAS);
        const boost_k0 = cutoffBoost(0, bonus, 0.0, ORIENT_BIAS);
        const boost_k7 = cutoffBoost(7, bonus, 0.0, ORIENT_BIAS);
        expect(boost_k0).toBeGreaterThan(boost_k7);
        expect(boost_k7).toBeGreaterThan(1.0);  // still positive
        expect(boost_k7).toBeLessThan(1.15);    // but small
    });

    it('oblique edges get much less cutoff boost than cardinal', function () {
        // Claim: A 45° edge gets ~1/3 the orient bonus of a cardinal edge.
        // Basis: cardinalFrac ≈ 1/3 for oblique vs 2/3 for cardinal.
        const bonus_cardinal = orientBonus(0.0, 1.0, ORIENT_BIAS);
        const bonus_oblique = orientBonus(0.7071, 0.7071, ORIENT_BIAS);
        expect(bonus_cardinal).toBeGreaterThan(bonus_oblique * 1.8);
    });

    it('flat regions (no gradient) get no orient bonus', function () {
        // Claim: Gradient magnitude gate prevents noise amplification.
        // Basis: Below gradMag=0.005, edgeGate=0 — no boost regardless of angle.
        const bonus = orientBonus(0.001, 0.001, ORIENT_BIAS);
        expect(bonus).toBeLessThan(0.01);
    });

    it('orient bonus actually increases band weight at a given eccentricity', function () {
        // Claim: Cardinal orient bonus translates to higher retained weight in periphery.
        // Basis: Boosted cutoff → wider smoothstep → higher w[k] at same normEcc.
        const c = linearCutoffs(DOG_E2);
        // Use normEcc near band 0's cutoff where the smoothstep transition happens
        const normEcc = c[0] * 1.2;  // just past the isotropic cutoff

        // Isotropic: no boost
        const w_iso = bandWeight(normEcc, c[0], 0.0);

        // Oriented: full cardinal bonus at fovea (cardinalFrac=2/3, edgeGate=1)
        const bonus = orientBonus(0.0, 1.0, ORIENT_BIAS);
        const boost = cutoffBoost(0, bonus, 0.0, ORIENT_BIAS);
        const w_ori = bandWeight(normEcc, c[0] * boost, 0.0);

        expect(w_ori).toBeGreaterThan(w_iso);
    });
});

// ─── Phase 2: V1 Energy Decomposition ───────────────────────────────────────

describe('Phase 2: 4-channel V1 energy (Hubel & Wiesel 1962)', function () {

    it('energy channels sum to total gradient energy', function () {
        // Claim: H + V ≈ total energy (within numerical tolerance) for cardinal gradients.
        // Basis: Energy is conserved across the 4-channel decomposition.
        const gx = 0.3, gy = 0.7;
        const d = v1EnergyDecomposition(gx, gy);
        const totalEnergy = gx * gx + gy * gy;
        // H+V = gy²+gx² = total, D45+D135 = (gx+gy)²/2 + (gx-gy)²/2 = total
        // But they overlap — the decomposition is not a strict partition.
        // Key invariant: cardinalMax + obliqueMax covers the dominant energy.
        expect(d.energy_h + d.energy_v).toBeCloseTo(totalEnergy, 10);
    });

    it('horizontal edge: energy_h >> energy_v', function () {
        // Claim: A horizontal edge produces most energy in the H channel.
        // Basis: Horizontal edges have large |gy|, small |gx|.
        const d = v1EnergyDecomposition(0.0, 1.0);
        expect(d.energy_h).toBeGreaterThan(d.energy_v * 10);
        expect(d.energy_h).toBeGreaterThan(d.energy_d45);
        expect(d.energy_h).toBeGreaterThan(d.energy_d135);
    });

    it('vertical edge: energy_v >> energy_h', function () {
        const d = v1EnergyDecomposition(1.0, 0.0);
        expect(d.energy_v).toBeGreaterThan(d.energy_h * 10);
    });

    it('45° edge: energy_d45 >> energy_d135', function () {
        // A 45° edge has gradient perpendicular to it: gx = gy = 0.7071
        const d = v1EnergyDecomposition(0.7071, 0.7071);
        expect(d.energy_d45).toBeGreaterThan(d.energy_d135 * 100);
    });

    it('135° edge: energy_d135 >> energy_d45', function () {
        const d = v1EnergyDecomposition(0.7071, -0.7071);
        expect(d.energy_d135).toBeGreaterThan(d.energy_d45 * 100);
    });

    it('cardinalFrac varies continuously between cardinal and oblique', function () {
        // Claim: max(H,V) vs max(D45,D135) produces a useful gradient from 2/3
        //   (pure cardinal) to 1/3 (pure oblique), not a degenerate constant.
        // Basis: Phase 1 cos(2θ) summed overlapping projections → constant ~0.5.
        //   Phase 2 max-of-pairs gives a 2:1 ratio between endpoints.
        const cardinal = v1EnergyDecomposition(0.0, 1.0);
        const oblique = v1EnergyDecomposition(0.7071, 0.7071);

        // 15° from cardinal — should be closer to cardinal than oblique
        const angle15 = 15 * Math.PI / 180;
        const mid = v1EnergyDecomposition(Math.cos(angle15), Math.sin(angle15));

        expect(cardinal.cardinalFrac).toBeGreaterThan(mid.cardinalFrac);
        expect(mid.cardinalFrac).toBeGreaterThan(oblique.cardinalFrac);
    });
});

// ─── Phase 3: Radial-Tangential Anisotropy ──────────────────────────────────

describe('Phase 3: Radial-tangential anisotropy (Toet & Levi 1992)', function () {

    it('tangential edges get positive modulation', function () {
        // Claim: Edge running tangentially (perpendicular to gaze direction) gets bonus.
        // Basis: Toet & Levi (1992) — tangential flankers interfere less.
        // Setup: radial direction = (1,0), edge direction = (0,1) = tangential
        const mod = radialTangentialMod(0, 1, 1, 0, RADIAL_BIAS);
        expect(mod).toBeGreaterThan(1.0);
    });

    it('radial edges get negative modulation', function () {
        // Claim: Edge running radially (toward fixation) gets penalized.
        // Setup: radial direction = (1,0), edge direction = (1,0) = radial
        const mod = radialTangentialMod(1, 0, 1, 0, RADIAL_BIAS);
        expect(mod).toBeLessThan(1.0);
    });

    it('tangential bonus is +30% at radial_bias=1.0', function () {
        // Claim: Full tangential alignment with bias=1.0 gives 1.3× modulation.
        // Basis: Shader uses mix(1-bias*0.15, 1+bias*0.3, tangentialAlign).
        const mod = radialTangentialMod(0, 1, 1, 0, 1.0);
        assertClose(mod, 1.3, 0.01, 'tangential bonus at bias=1.0');
    });

    it('radial penalty is -15% at radial_bias=1.0', function () {
        const mod = radialTangentialMod(1, 0, 1, 0, 1.0);
        assertClose(mod, 0.85, 0.01, 'radial penalty at bias=1.0');
    });

    it('asymmetry ratio matches ~2:1 radial:tangential crowding (Toet & Levi 1992)', function () {
        // Claim: The tangential/radial modulation ratio approximates crowding asymmetry.
        // Basis: Radial flankers crowd ~2× more than tangential ones.
        const tang = radialTangentialMod(0, 1, 1, 0, 1.0);
        const rad = radialTangentialMod(1, 0, 1, 0, 1.0);
        const ratio = tang / rad;
        // 1.3 / 0.85 ≈ 1.53 — directional modulation, not full 2:1 (which crowding
        // distance handles). The bonus/penalty is applied to orient cutoffs, not crowding itself.
        expect(ratio).toBeGreaterThan(1.3);
        expect(ratio).toBeLessThan(2.0);
    });

    it('radial_bias=0 produces no modulation', function () {
        // Claim: Disabled radial-tangential anisotropy = no modulation.
        const mod = radialTangentialMod(0, 1, 1, 0, 0.0);
        assertClose(mod, 1.0, 1e-10, 'no modulation at bias=0');
    });
});

// ─── Phase 4: Eccentricity-Dependent Fade ───────────────────────────────────

describe('Phase 4: Eccentricity fade (Berkley 1975, Essock 1990)', function () {

    it('fine bands lose cardinal advantage by ~10° (Berkley et al. 1975)', function () {
        // Claim: Band 0 (finest, >4 cpd) fades to zero between 3° and 10°.
        // Basis: Berkley et al. (1975) — oblique effect disappears at 8-18° for fine gratings.
        const fade_0deg = eccFade(0, 0.0);
        const fade_3deg = eccFade(0, 3.0);
        const fade_10deg = eccFade(0, 10.0);
        assertClose(fade_0deg, 1.0, 0.01, 'band 0 at 0°');
        assertClose(fade_3deg, 1.0, 0.01, 'band 0 at 3° (start)');
        assertClose(fade_10deg, 0.0, 0.01, 'band 0 at 10° (end)');
    });

    it('coarse bands retain cardinal advantage to 25°+ (Essock 1990)', function () {
        // Claim: Band 7 (coarsest, <0.5 cpd) fades from 8° to 25°.
        // Basis: Essock (1990) — oblique effect persists for coarse gratings.
        const fade_8deg = eccFade(7, 8.0);
        const fade_25deg = eccFade(7, 25.0);
        const fade_15deg = eccFade(7, 15.0);
        assertClose(fade_8deg, 1.0, 0.01, 'band 7 at 8° (start)');
        assertClose(fade_25deg, 0.0, 0.01, 'band 7 at 25° (end)');
        expect(fade_15deg).toBeGreaterThan(0.3);
        expect(fade_15deg).toBeLessThan(0.9);
    });

    it('fade is monotonically decreasing with eccentricity', function () {
        for (const k of [0, 3, 7]) {
            let prev = 1.0;
            for (let ecc = 0; ecc <= 30; ecc += 1) {
                const fade = eccFade(k, ecc);
                expect(fade).toBeLessThanOrEqual(prev + 1e-10);
                prev = fade;
            }
        }
    });

    it('coarse bands retain advantage at eccentricities where fine bands have lost it', function () {
        // Claim: At 12°, band 7 still has orient fade but band 0 does not.
        // Basis: Frequency-dependent fade rates (Berkley 1975, Essock 1990).
        const fine_12 = eccFade(0, 12.0);
        const coarse_12 = eccFade(7, 12.0);
        expect(fine_12).toBeLessThan(0.1);   // band 0: gone by 10°
        expect(coarse_12).toBeGreaterThan(0.5);  // band 7: still active
    });

    it('exaggerated demo mode (bias > 3) bypasses eccFade', function () {
        // Claim: For captures/demos, eccFade is bypassed so orient effect is visible.
        // Basis: At viewport-scale eccentricities, eccFade crushes the effect to sub-pixel.
        const bonus = 1.0;
        const boost_bio = cutoffBoost(0, bonus, 20.0, 1.0);   // biological: faded
        const boost_demo = cutoffBoost(0, bonus, 20.0, 4.0);  // demo: bypassed

        expect(boost_demo).toBeGreaterThan(boost_bio);
        // bonus=1.0 (full cardinal), boost = 1 + 1.0 * 1.0 * 0.5 = 1.5
        assertClose(boost_demo, 1.5, 0.01, 'demo mode full boost at 20°');
    });
});

// ─── Parameter Sanity (modes.json regression guard) ─────────────────────────

describe('Oriented DoG parameter sanity (modes.json)', function () {

    it('highkey has dog_oriented enabled', function () {
        expect(highkey.dog_oriented).toBe(true);
    });

    it('biological has dog_oriented enabled', function () {
        expect(biological.dog_oriented).toBe(true);
    });

    it('orient_bias is biological range (0.5–2.0)', function () {
        expect(highkey.dog_orient_bias).toBeGreaterThanOrEqual(0.5);
        expect(highkey.dog_orient_bias).toBeLessThanOrEqual(2.0);
    });

    it('biological mode has radial_bias > 0 (Phase 3 active)', function () {
        expect(biological.dog_radial_bias).toBeGreaterThan(0);
    });

    it('highkey has radial_bias = 0 (Phase 3 off for default mode)', function () {
        expect(highkey.dog_radial_bias).toBe(0);
    });
});
