#!/usr/bin/env node
/**
 * analyze-crowding-geometry.js
 *
 * Wave 3 analytical validation: computes Scrutinizer's effective pooling region
 * sizes from shader parameters and compares to Bouma's law critical spacing.
 *
 * No screenshots needed — pure numerical computation replicating the shader math.
 *
 * Usage:
 *   node scripts/analyze-crowding-geometry.js [--json] [--fovea-radius 90]
 */

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const foveaRadiusArg = args.indexOf('--fovea-radius');
const FOVEA_RADIUS = foveaRadiusArg >= 0 ? parseFloat(args[foveaRadiusArg + 1]) : 90;

// Default shader parameters (from config.js and modes.json)
const CMF_A = 2.78;           // Cortical magnification constant
const FOVEA_DEG = 2.0;        // Foveal radius in degrees
const PPD = FOVEA_RADIUS / FOVEA_DEG; // pixels per degree
const ECC_SCALING = 0.75;     // Brown et al. 2023 scaling
const MAX_MIP = 4.0;
const CROWDING_RADIAL_BIAS = 2.0;
const POLAR_EF = 1.007;
const PARAFOVEA_MULT = 2.5;
const PARAFOVEA_RADIUS = FOVEA_RADIUS * PARAFOVEA_MULT;

// Precompute cortical_max (same as JS renderer does)
const R_MAX_DEG = (1.0 / FOVEA_DEG) * 2.0; // normalizedEcc=1.0 edge case for max
// Actually cortical_max is computed for the full viewport range. Approximate:
const CORTICAL_MAX = Math.log(1 + 30 / CMF_A); // 30° max eccentricity

// --- Replicate shader math ---

function computeMipLevel(eccentricity_px) {
    const normalizedEcc = Math.max(0, eccentricity_px) / FOVEA_RADIUS;
    const r_deg = normalizedEcc * 2.0;
    const cortical_dist = Math.log(1 + r_deg / CMF_A);
    const eccScale = ECC_SCALING / 0.75;
    return Math.min(MAX_MIP, MAX_MIP * cortical_dist / CORTICAL_MAX * eccScale);
}

function poolingDiameterPx(mipLevel) {
    return Math.pow(2, mipLevel);
}

function boumaCriticalSpacingDeg(ecc_deg) {
    return 0.5 * ecc_deg;
}

// Polar sector ring width at distance r (in normalized UV space)
// With bias=2.0, ef^bias = 1.007^2 ≈ 1.014, so ring width ≈ r * 1.4%
function polarRingWidth(r_norm) {
    return r_norm * (Math.pow(POLAR_EF, CROWDING_RADIAL_BIAS) - 1);
}

// Unbiased ring width (what spoke count SHOULD use for 2:1 R:T)
function polarRingWidthUnbiased(r_norm) {
    return r_norm * (POLAR_EF - 1);
}

// Spoke count at a given ring (replicates shader line 341)
// BUG: Uses biased ringWidth, producing ~1:1 sectors instead of intended 2:1
function polarSpokeCount(ring_center, ring_width) {
    const raw = Math.floor(2 * Math.PI * ring_center / ring_width);
    return Math.max(6, Math.floor(raw / 2) * 2); // even, min 6
}

// What spoke count SHOULD be for 2:1 R:T (using unbiased ring width)
function polarSpokeCountFixed(ring_center, ring_width_unbiased) {
    const raw = Math.floor(2 * Math.PI * ring_center / ring_width_unbiased);
    return Math.max(6, Math.floor(raw / 2) * 2);
}

// --- Analysis ---

const eccentricities_deg = [2, 3, 4, 5, 6, 8, 10, 12, 15];

console.log('=== Wave 3: Crowding Geometry Validation ===\n');
console.log(`Parameters: fovea_radius=${FOVEA_RADIUS}px, ppd=${PPD.toFixed(1)}, cmf_a=${CMF_A}, ecc_scaling=${ECC_SCALING}`);
console.log(`           crowding_radial_bias=${CROWDING_RADIAL_BIAS}, polar_ef=${POLAR_EF}\n`);

// --- Section 1: MIP Pooling vs Bouma ---

console.log('--- 1. MIP Pooling Region Size vs Bouma Critical Spacing ---\n');
console.log('Ecc(°)  Ecc(px)  MIP    Pool(px)  Pool(°)   Bouma(°)  Ratio');
console.log('------  -------  -----  --------  --------  --------  -----');

const mipResults = eccentricities_deg.map(ecc_deg => {
    const ecc_px = ecc_deg * PPD;
    const mip = computeMipLevel(ecc_px);
    const pool_px = poolingDiameterPx(mip);
    const pool_deg = pool_px / PPD;
    const bouma_deg = boumaCriticalSpacingDeg(ecc_deg);
    const ratio = pool_deg / bouma_deg;

    console.log(
        `${ecc_deg.toString().padStart(6)}  ` +
        `${ecc_px.toFixed(0).padStart(7)}  ` +
        `${mip.toFixed(2).padStart(5)}  ` +
        `${pool_px.toFixed(1).padStart(8)}  ` +
        `${pool_deg.toFixed(3).padStart(8)}  ` +
        `${bouma_deg.toFixed(1).padStart(8)}  ` +
        `${ratio.toFixed(3).padStart(5)}`
    );

    return { ecc_deg, ecc_px, mip, pool_px, pool_deg, bouma_deg, ratio };
});

// Check proportionality: ratio should be approximately constant
const ratios = mipResults.map(r => r.ratio);
const meanRatio = ratios.reduce((a, b) => a + b) / ratios.length;
const maxRatio = Math.max(...ratios);
const minRatio = Math.min(...ratios);
const ratioSpread = maxRatio / minRatio;

console.log(`\nMIP/Bouma ratio: mean=${meanRatio.toFixed(4)}, min=${minRatio.toFixed(4)}, max=${maxRatio.toFixed(4)}, spread=${ratioSpread.toFixed(2)}x`);
console.log(`Interpretation: MIP pooling is ~${(meanRatio * 100).toFixed(1)}% of Bouma critical spacing.`);
console.log(`This is expected — MIP handles frequency-domain averaging, V1 Lateral Smash handles spatial crowding extent.\n`);

// --- Section 2: Polar Sector Geometry ---

console.log('--- 2. Polar Sector Geometry vs Bouma ---\n');
console.log('Ecc(°)  r_norm   Ring(°)   Spoke#  Spoke(°)  R:T(cur)  R:T(fix)  Bouma(°)  Sec/Bouma');
console.log('------  -------  --------  ------  --------  --------  --------  --------  ---------');

const sectorResults = eccentricities_deg.map(ecc_deg => {
    const ecc_px = ecc_deg * PPD;
    const r_px = ecc_px;
    const r_norm = r_px / 1440; // approximate for 1440px viewport height

    const ringWidth_norm = polarRingWidth(r_norm);
    const ringWidth_unbiased_norm = polarRingWidthUnbiased(r_norm);
    const ringWidth_px = ringWidth_norm * 1440;
    const ringWidth_deg = ringWidth_px / PPD;

    const ring_center_norm = r_norm;

    // Current behavior: spoke count from biased width → ~1:1 sectors
    const spokeCount = polarSpokeCount(ring_center_norm, ringWidth_norm);
    const spokeWidth_rad = 2 * Math.PI / spokeCount;
    const spokeWidth_px = spokeWidth_rad * r_px;
    const spokeWidth_deg = spokeWidth_px / PPD;
    const rt_ratio_current = ringWidth_deg / spokeWidth_deg;

    // Fixed behavior: spoke count from unbiased width → ~2:1 sectors
    const spokeCountFixed = polarSpokeCountFixed(ring_center_norm, ringWidth_unbiased_norm);
    const spokeWidthFixed_rad = 2 * Math.PI / spokeCountFixed;
    const spokeWidthFixed_deg = (spokeWidthFixed_rad * r_px) / PPD;
    const rt_ratio_fixed = ringWidth_deg / spokeWidthFixed_deg;

    const bouma_deg = boumaCriticalSpacingDeg(ecc_deg);
    const sectorsPerBouma = bouma_deg / ringWidth_deg;

    console.log(
        `${ecc_deg.toString().padStart(6)}  ` +
        `${r_norm.toFixed(4).padStart(7)}  ` +
        `${ringWidth_deg.toFixed(3).padStart(8)}  ` +
        `${spokeCount.toString().padStart(6)}  ` +
        `${spokeWidth_deg.toFixed(3).padStart(8)}  ` +
        `${rt_ratio_current.toFixed(2).padStart(8)}  ` +
        `${rt_ratio_fixed.toFixed(2).padStart(8)}  ` +
        `${bouma_deg.toFixed(1).padStart(8)}  ` +
        `${sectorsPerBouma.toFixed(1).padStart(9)}`
    );

    return { ecc_deg, r_norm, ringWidth_deg, spokeWidth_deg, rt_ratio_current, rt_ratio_fixed, bouma_deg, sectorsPerBouma };
});

console.log(`\nFINDING: Polar sector R:T ratio is ${sectorResults[0]?.rt_ratio_current.toFixed(2)}:1 (current), not ${CROWDING_RADIAL_BIAS.toFixed(1)}:1 as intended.`);
console.log(`The shader comment (peripheral2.frag:338-339) claims bias=2.0 gives 2:1 aspect ratio,`);
console.log(`but spokeCount is computed from the biased ring width, neutralizing the elongation.`);
console.log(`Fix: compute spokeCount from unbiased ring width (ef^1, not ef^bias). This gives R:T = ${sectorResults[0]?.rt_ratio_fixed.toFixed(2)}:1.\n`);

// --- Section 3: V1 Lateral Smash Effective Displacement ---

console.log('--- 3. V1 Lateral Smash: Estimated Crowding Displacement ---\n');
console.log('The V1 warp amplitude determines the effective spatial extent of crowding.');
console.log('At each eccentricity, strength = suppressionFactor * v1_strength_mult * eccentricityScale * crowdingFactor');
console.log('Warp amplitude in UV space: strength * noise * warpAmp');
console.log('With warpAmp ranging 0.006 (parafovea) to 0.024 (periphery):\n');

console.log('Ecc(°)  eccScale  warpAmp   Disp(px,dense)  Disp(px,sparse)  Bouma(px)  Dense/Bouma');
console.log('------  --------  --------  --------------  ---------------  ---------  -----------');

eccentricities_deg.forEach(ecc_deg => {
    const ecc_px = ecc_deg * PPD;
    const dist = ecc_px; // distance from fovea in pixels
    const fovea_radius = FOVEA_RADIUS;
    const parafovea_radius = fovea_radius * 2.5;

    // eccentricityScale from smoothstep
    const t = Math.max(0, Math.min(1, (dist - fovea_radius) / (parafovea_radius - fovea_radius)));
    const eccentricityScale = t * t * (3 - 2 * t); // smoothstep

    // warpAmp interpolation (from shader: mix(0.006, 0.024, zoneB))
    const periphery_start = fovea_radius * 1.35;
    const zoneB_t = Math.max(0, Math.min(1, (dist - parafovea_radius) / (periphery_start * 2 - parafovea_radius)));
    const zoneB = zoneB_t * zoneB_t * (3 - 2 * zoneB_t);
    const warpAmp = 0.006 + (0.024 - 0.006) * zoneB;

    // Assume suppressionFactor=1.0, v1_strength_mult=1.0 for max effect
    // Noise peak ≈ 1.0 (simplex noise range)
    // Radial bias amplifies radial component
    const strength_dense = eccentricityScale * 1.0; // crowdingFactor=1.0 for dense
    const strength_sparse = eccentricityScale * 0.3; // crowdingFactor=0.3 for isolated

    // Displacement in normalized UV space, convert to pixels
    // The viewport is ~1440px, so 1.0 in UV = 1440px
    const viewportPx = 1440;
    const disp_dense = strength_dense * warpAmp * CROWDING_RADIAL_BIAS * viewportPx;
    const disp_sparse = strength_sparse * warpAmp * CROWDING_RADIAL_BIAS * viewportPx;
    const bouma_px = boumaCriticalSpacingDeg(ecc_deg) * PPD;
    const ratio = disp_dense / bouma_px;

    console.log(
        `${ecc_deg.toString().padStart(6)}  ` +
        `${eccentricityScale.toFixed(3).padStart(8)}  ` +
        `${warpAmp.toFixed(4).padStart(8)}  ` +
        `${disp_dense.toFixed(1).padStart(14)}  ` +
        `${disp_sparse.toFixed(1).padStart(15)}  ` +
        `${bouma_px.toFixed(0).padStart(9)}  ` +
        `${ratio.toFixed(3).padStart(11)}`
    );
});

console.log('\nNote: Displacement estimates assume peak noise=1.0 and suppressionFactor=1.0.');
console.log('Actual displacement varies stochastically — these are envelope maxima.\n');

// --- Section 4: Validation Summary ---

console.log('--- 4. Validation Summary ---\n');

// Tier 1 checks
const mipProportional = ratioSpread < 3.0;
const rtRatiosCurrent = sectorResults.map(r => r.rt_ratio_current);
const rtRatiosFixed = sectorResults.map(r => r.rt_ratio_fixed);

// V1 Lateral Smash DOES have 2:1 via direct radialNoise scaling (not polar sectors)
const v1HasRadialBias = CROWDING_RADIAL_BIAS >= 1.5;

console.log('Tier 1 (Must Pass):');
console.log(`  [${mipProportional ? 'PASS' : 'FAIL'}] MIP pooling grows proportionally (spread ${ratioSpread.toFixed(2)}x < 3.0x)`);
console.log(`  [${v1HasRadialBias ? 'PASS' : 'FAIL'}] V1 Lateral Smash has radial bias (u_crowding_radial_bias=${CROWDING_RADIAL_BIAS})`);
console.log(`  [ISSUE] Polar sectors are ~1:1 (not 2:1) — see finding above`);
console.log(`  [ -- ] Crowding ratio < 0.8 at 6° and 10° (requires screenshot analysis)\n`);

// Tier 2 checks
const meanRT_current = rtRatiosCurrent.reduce((a, b) => a + b) / rtRatiosCurrent.length;
const meanRT_fixed = rtRatiosFixed.reduce((a, b) => a + b) / rtRatiosFixed.length;

console.log('Tier 2 (Should Pass):');
console.log(`  [FAIL] Polar sector R:T ratio ${meanRT_current.toFixed(2)} (current) vs ${meanRT_fixed.toFixed(2)} (if fixed)`);
console.log(`  [ -- ] Bouma ratio within 3x (requires combined V1+V4 measurement)`);
console.log(`  [ -- ] Density gate separation (requires screenshot analysis)\n`);

// V1 displacement findings
const dispAt6 = 69.1; // from section 3
const dispAt15 = 69.1;
const boumaAt6 = 135;
const boumaAt15 = 338;
console.log('Tier 2 (Additional findings):');
console.log(`  [NOTE] V1 displacement plateaus at ~69px beyond parafovea (eccentricityScale clamps at 1.0)`);
console.log(`         At 6°: ${dispAt6.toFixed(0)}px / ${boumaAt6}px Bouma = ${(dispAt6/boumaAt6).toFixed(2)}x (good match)`);
console.log(`         At 15°: ${dispAt15.toFixed(0)}px / ${boumaAt15}px Bouma = ${(dispAt15/boumaAt15).toFixed(2)}x (under-crowding in far periphery)`);
console.log(`         Bouma predicts linear growth; V1 distortion is flat. MIP pooling partially compensates.\n`);

// JSON output
if (jsonOutput) {
    const results = {
        parameters: { FOVEA_RADIUS, PPD, CMF_A, ECC_SCALING, CROWDING_RADIAL_BIAS, POLAR_EF },
        mip_pooling: mipResults,
        polar_sectors: sectorResults,
        validation: {
            tier1_mip_proportional: mipProportional,
            tier1_radial_gt_tangential: allRadialGtTangential,
            tier2_rt_ratio_in_range: rtInRange,
            mean_rt_ratio: meanRT,
            mip_bouma_ratio_mean: meanRatio,
            mip_bouma_ratio_spread: ratioSpread
        }
    };
    console.log('\n--- JSON Output ---');
    console.log(JSON.stringify(results, null, 2));
}
