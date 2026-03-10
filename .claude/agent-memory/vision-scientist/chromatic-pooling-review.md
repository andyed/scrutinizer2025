# Chromatic Pooling Review — Threshold vs. Appearance

Date: 2026-03-04

## Core Problem

The shader applies castleCSF detection threshold decay rates (k_e=0.059 for RG) directly as
suprathreshold appearance multipliers. This conflates "minimum detectable contrast modulation"
with "perceived saturation of a well-above-threshold stimulus." A saturated red button 20-40x
above threshold should not lose 74% of its perceived redness at 10 degrees eccentricity.

## castleCSF Parameter Verification

From GitHub source (CSF_castleCSF.m, CSF_castleCSF_chrom.m):

| Parameter | Achromatic | RG (L-M) | YV (S-(L+M)) |
|-----------|-----------|----------|--------------|
| ecc_drop (k_e) | 0.0240 | 0.0591 | 0.00357 |
| ecc_drop_f (k_ef) | 0.0189 | ~0 (2e-69) | 0.00807 |

Equation: S_ecc = 10^(-(ecc_drop + rho * ecc_drop_f) * e)

These are THRESHOLD sensitivity values. The model explicitly says "smallest contrast that can be detected."

## Suprathreshold Correction Literature

### Jiang, Shooner & Mullen 2022 (JOV)
- Measured foveal-to-peripheral contrast matching for RG, YV, and achromatic at 12 and 18 degrees
- Power-law relationship: C_match = a * C_ref^b
- Exponents (Table 1) at 12 degrees for RG: 0.39, 0.47, 0.76, 0.84, 0.70 (5 observers)
- Mean approximately 0.63
- KEY: "when equated for similar sensitivity losses, no difference between chromatic and achromatic"
- Contrast constancy holds at highest contrasts; breaks at low/mid contrast
- Implication: threshold decay rates over-predict appearance loss by roughly sqrt(threshold) factor

### Gegenfurtner group preprint (Feb 2025, bioRxiv)
- "Colour desaturation in the periphery is explained by general mechanisms of contrast sensitivity and constancy"
- Confirms threshold-to-appearance link follows contrast constancy
- Desaturation less dramatic than threshold CSF predicts, especially for high-contrast stimuli
- Web content is typically high-contrast chromatic, so constancy partially applies

### Bowers, Gegenfurtner & Goettker 2025 (JOV)
- Measured CSF at 5, 15, 30, 45, 60, 75, 90 degrees
- "The quick decay in sensitivity observed for red-green stimuli slows down in the periphery"
- Exponential model (castleCSF) over-predicts RG decay beyond ~20 degrees
- Achromatic sensitivity UNDERESTIMATED by current models in far periphery
- YV decay roughly matches achromatic

## Two Bugs in Current Implementation

### Bug 1: Red Kill Switch not guarded by chromatic pooling flag
Lines 806-813 of peripheral.frag apply up to 95% additional RG/YV attenuation in mode 0,
even when chromatic pooling is already handling differential decay. The guard on line 794
only protects the uniform desaturation path, not the Red Kill Switch.

### Bug 2: Raw threshold decay applied as appearance multiplier
No suprathreshold correction applied. The spec's Section 6.4 even flags this as a known issue
but the implementation did not address it.

## Recommended Fix (Implemented 2026-03-04)

Option A was implemented: suprathreshold exponent uniform, default 0.5.

## Updated Recommendations (2026-03-04 Literature Review)

### Key new finding: Peripheral desaturation is NOT color-specific
Rozman & Martinovic (2025, bioRxiv): "The appearance of colour and luminance in the periphery
is affected similarly, governed by general laws of contrast sensitivity and constancy."
Once achromatic stimuli are matched for distance-from-threshold, they show identical "desaturation."
This converges with Jiang et al. 2022: "no difference between chromatic and achromatic contrast responses."

### Bowers, Gegenfurtner & Goettker 2025 (JOV 25(11):7)
- RG decay is NON-EXPONENTIAL: biphasic (steep to ~15 dva, then slows)
- castleCSF exponential model OVER-PREDICTS RG loss beyond ~20 deg
- Color vision persists to 75 dva (contradicts older "attenuated at 40 dva" claims)
- castleCSF "cannot successfully capture the now available empirical data"

### Recommended parameter changes:
1. **Make RG decay frequency-dependent** (NEW — aligns with TTM pooling model)
   - Add u_rg_freq_decay ~0.007 (half of YV freq decay)
   - Residual band keeps nearly full RG; band0 (4cpd) loses most
   - Biological basis: midget ganglion cell RF enlargement is inherently spatial
2. **Raise supra_exponent to 0.65** (from 0.5)
   - Jiang et al. mean exponents: RG=0.63, YV=0.73, Ach=0.66
   - 0.5 was at low end; 0.65 better represents mean observer with supra content
3. Keep base k_e values (0.059 RG, 0.004 YV) — correct threshold values
4. Keep YV freq decay at 0.008 — already well-calibrated

### Rosenholtz/TTM interpretation
TTM first-order color statistics (mean, variance) survive pooling.
Large colored regions retain saturation; only fine chromatic detail is lost.
Per-band chromatic attenuation with frequency dependence is the computational
equivalent of TTM's pooling prediction for color.

### Tyler (2015, i-Perception) — Peripheral Color Demo
Eccentricity-scaled colored disks appear vivid in periphery.
Demonstrates that peripheral color loss is size-dependent, not absolute.
