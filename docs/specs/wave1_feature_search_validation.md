# Wave 1: Feature Search Color Singleton Validation

> **Last updated:** 2026-03-07

**Status**: Proposed
**Created**: 2026-03-07
**Dependencies**: `tests/reference-pages/color-search.html`, `scripts/chromatic-attenuation-table.js`, castleCSF chromatic pooling (v1.8.0+)

## Context

Scrutinizer's chromatic decay model uses castleCSF parameters (Ashraf et al. 2024) with Bowers et al. (2025) suprathreshold corrections to attenuate color per-channel across eccentricity. The `color-search.html` reference page already implements a visual search task with colored singleton targets on gray distractors at 5 eccentricity rings. Wave 1 validates the shader's chromatic predictions against published psychometric data computationally — no human subjects, just pixel-level comparison of rendered output against published thresholds.

## 1. Falsifiable Predictions

All predictions derived from the shader attenuation formula in `renderer/shaders/peripheral.frag` (lines 232-243):

```
appearance = pow(10^(-(k_e + k_ef * freq) * ecc_deg), supra_exponent)
```

Parameters from `shared/modes.json` (castleCSF Chromatic Pooling mode):

| Parameter | Value | Source |
|-----------|-------|--------|
| `rg_decay` (k_e) | 0.085 | Bowers et al. 2025, suprathreshold |
| `rg_freq_decay` (k_ef) | 0.003 | Conservative estimate (~1/3 of YV) |
| `yv_decay` (k_e) | 0.014 | Bowers et al. 2025, suprathreshold |
| `yv_freq_decay` (k_ef) | 0.008 | castleCSF spatial frequency interaction |
| `supra_exponent` | 0.5 | Jiang, Shooner & Mullen 2022 (foveal measurement, extrapolated to periphery) |

Eccentricity mapping at `fovea_radius=45px`, `fovea_deg=1.0`, `ppd=45`:

| Ring | Distance (px) | norm_ecc | ecc (deg) |
|------|--------------|----------|-----------|
| 1 | 100 | 2.22 | 2.22 |
| 2 | 200 | 4.44 | 4.44 |
| 3 | 300 | 6.67 | 6.67 |
| 4 | 420 | 9.33 | 9.33 |
| 5 | 560 | 12.44 | 12.44 |

### Prediction A: RG collapses ~5x faster than BY

The decay rate ratio is `rg_decay / yv_decay = 0.085 / 0.014 = 6.07`. At 1 cpd (representative of 24px dots at 45 ppd), predicted appearance retention:

| Ring | ecc (deg) | RG retention | BY retention | BY/RG ratio |
|------|-----------|-------------|-------------|-------------|
| 1 | 2.22 | 82.6% | 94.5% | 1.14 |
| 2 | 4.44 | 68.1% | 89.4% | 1.31 |
| 3 | 6.67 | 56.2% | 84.5% | 1.50 |
| 4 | 9.33 | 44.7% | 79.0% | 1.77 |
| 5 | 12.44 | 34.1% | 73.0% | 2.14 |

Both channels decrease monotonically. The BY/RG ratio grows with eccentricity — from 1.14 at ring 1 to 2.14 at ring 5. BY retention is >= 1.5x RG from ring 3 outward.

### Prediction B: Larger targets retain color further into periphery

Dot size determines characteristic spatial scale: `freq_cpd ≈ ppd / (2 * diameter_px)` where `ppd ≈ 45` at the default calibration. This is the half-period of a square wave at the dot diameter — an upper-bound approximation. A filled disc's actual energy (Airy/jinc function) peaks at DC with non-DC energy broadly distributed below `1.22/diameter`, roughly 0.5-0.8x the estimate here. The difference is negligible for RG (small `k_ef`) and ~1.5% for BY at ring 5. The `k_ef * freq` term in the exponent means higher spatial frequency (smaller dots) decay faster.

Predicted retention at ring 5 (12.44 deg) by dot size:

| Dot size (px) | freq (cpd) | RG retention | BY retention |
|---------------|-----------|-------------|-------------|
| 16 | 1.41 | 33.6% | 69.7% |
| 20 | 1.13 | 33.8% | 71.2% |
| 24 | 0.94 | 34.1% | 73.0% |
| 32 | 0.70 | 34.3% | 74.6% |
| 48 | 0.47 | 34.9% | 77.5% |

The size effect is small for RG (33.6% to 34.9%) because `rg_freq_decay` is low (0.003). For BY, the spread is larger (69.7% to 77.5%) because `yv_freq_decay` is nearly 3x higher (0.008). This means dot size matters more for blue/yellow detection boundaries than for red/green.

### Prediction C: Green tracks RG more than BY, but with a BY residual

In Oklab color space, green maps primarily to negative values on the `a` axis — the same L-M opponent channel as red (positive `a`). The shader applies `rg_decay` to the `a` channel and `yv_decay` to the `b` channel regardless of sign.

However, green carries significant energy on both axes: `a = -0.144`, `b = +0.108` (ratio `|a|/|b| = 1.33`). This means ~43% of green's chroma is on the `b` (BY) axis.

**Composite chroma prediction at ring 5 (12.44 deg):**

| Color | a (orig) | a (ring 5) | b (orig) | b (ring 5) | Composite chroma retention |
|-------|---------|-----------|---------|-----------|---------------------------|
| Red | +0.152 | +0.052 | +0.067 | +0.049 | 42.9% |
| Green | -0.144 | -0.049 | +0.108 | +0.079 | 51.6% |
| Blue | -0.004 | -0.001 | -0.173 | -0.126 | 73.0% |
| Yellow | -0.026 | -0.009 | +0.143 | +0.104 | 73.2% |

Green retains 51.6% composite chroma vs red's 42.9% — an 8.7pp gap. Green does track closer to RG than BY (which retains ~73%), but the surviving green signal at high eccentricity is dominated by its `b` component (the part that decays slowly). Green won't just desaturate — it will shift toward yellow-green as the `a` component collapses while `b` persists.

This is a non-obvious prediction: people intuitively group green with blue (cool colors), but opponent color processing groups green with red (L-M channel). The shader's per-channel Oklab attenuation makes this testable — green's total chroma loss should be intermediate between pure-RG (red) and pure-BY (blue/yellow), but closer to RG.

### Prediction D: Saliency map peak tracks chromatic contrast

The saliency map's color channel computes delta-C (Oklab chroma difference) between target and surround. As eccentricity increases and chromatic contrast decays:

- Target-vs-distractor delta-C decreases monotonically
- RG targets (red, green) cross the saliency detection floor before BY targets (yellow, blue)
- At ring 5, RG saliency should be < 50% of ring 1 saliency; BY should retain > 70%

## 2. Stimulus Design

### Modifications to `color-search.html`

Add URL parameter support for automated capture (no trial loop needed):

```
?color=red&size=24&mode=static
?color=yellow&size=32&mode=static
```

| Parameter | Values | Default | Purpose |
|-----------|--------|---------|---------|
| `color` | red, blue, green, yellow | red | Target color |
| `size` | 16, 20, 24, 32, 48 | 24 | Dot diameter in px |
| `mode` | trial, static | trial | `static` renders all dots simultaneously, no click interaction |

Changes needed:
- Add `yellow` to `TARGET_COLORS` map (isolates BY channel: Oklab `a ≈ 0`, `b ≈ 0.12`)
- Parse URL params with `URLSearchParams`
- In `mode=static`: skip intro, render one target per ring simultaneously (5 targets visible), disable click handlers
- Each ring gets one target at a random but seeded angle (use `?seed=N` for reproducibility)

Estimated: ~50 lines added to existing file.

### Color Specifications

Luminance-matched targets and their Oklab chromatic profiles:

| Color | RGB | Oklab L | Oklab a | Oklab b | Primary channel |
|-------|-----|---------|---------|---------|-----------------|
| Red | rgb(200, 70, 70) | 0.575 | +0.152 | +0.067 | RG (a-axis, 69% of chroma) |
| Green | rgb(70, 180, 70) | 0.683 | -0.144 | +0.108 | RG (a-axis, 57% of chroma) |
| Blue | rgb(70, 100, 210) | 0.541 | -0.004 | -0.173 | BY (b-axis, 98% of chroma) |
| Yellow | rgb(210, 190, 60) | 0.796 | -0.026 | +0.143 | BY (b-axis, 98% of chroma) |
| Gray | luminance-matched per target | varies | 0.000 | 0.000 | — |

**Luminance note:** Current `color-search.html` luminance-matches targets using BT.601 coefficients (`0.299R + 0.587G + 0.114B`), not Oklab L. This introduces a lightness confound: yellow (L=0.796) vs blue (L=0.541) differ by 0.255 in Oklab lightness from their respective gray distractors. Cross-color comparisons should account for this. A future improvement would match targets in Oklab L space.

**Baseline capture:** Each color/size combination should also be captured without Scrutinizer active (unfiltered) to verify the input stimulus has the expected Oklab values before the shader transforms them.

## 3. Comparison Methodology

### Step 1: Generate model predictions (JSON)

Extend `scripts/chromatic-attenuation-table.js` to accept `--json` flag and output structured predictions.

**Stale parameters:** The script currently hardcodes `rg_decay=0.059, yv_decay=0.004` (pre-v2.0 detection threshold values). Must update to read from `shared/modes.json` or accept `--mode=castleCSF` to use current v2.5 parameters (0.085/0.014).

**Bowers derivation note:** The `k_e` values (0.085 RG, 0.014 YV; previously 0.072 RG pre-v2.5) were fit to Bowers et al. (2025) suprathreshold data, but the fit uses a different baseline normalization than Bowers' published table (which normalizes to 5 deg). At 15 deg with `supra=1.0`, the threshold model gives RG=7.5% vs Bowers' 29% — a gap explained by the suprathreshold correction (`supra=0.5` gives 27.4%, close to Bowers). The validation should compare model appearance (supra=0.5) against Bowers' suprathreshold measurements, not raw threshold.

Output format:

```json
{
  "parameters": { "rg_decay": 0.085, "rg_freq_decay": 0.003, ... },
  "predictions": [
    { "color": "red", "size_px": 24, "freq_cpd": 0.94, "ring": 1, "ecc_deg": 2.22,
      "rg_retention": 0.826, "yv_retention": 0.945, "primary_channel": "rg" }
  ]
}
```

### Step 2: Capture rendered output

Use `scripts/capture-golden.js` pattern — launch Scrutinizer pointed at `color-search.html?mode=static&color=red&size=24`, capture screenshot at center fixation. Repeat for each color/size combination. Output to `tests/golden-captures/validation/color-search/`.

**Capture requirements:**
- PNG format only (JPEG chroma subsampling at 4:2:0 would smear color across 2x2 blocks, invalidating delta-C measurements)
- sRGB color profile (macOS P3 displays may apply gamut mapping via ColorSync — force `--color-profile=srgb` or equivalent)
- Log actual `fovea_radius` used and verify it matches prediction parameters (45px)
- Capture both filtered (Scrutinizer active) and unfiltered (baseline) for each condition

Capture matrix: 4 colors x 5 sizes x 2 conditions (filtered/baseline) = 40 screenshots.

### Step 3: Analyze screenshots

New script `scripts/analyze-color-search.js` (~150 lines):

1. Load each screenshot
2. At each ring, sample pixels at the known target location and at 3 adjacent distractor locations
3. Convert sampled RGB to Oklab
4. Compute delta-C (chroma difference) between target and distractor samples
5. Output JSON: measured retention = `delta_C_at_ring_N / delta_C_at_ring_1`

This avoids any saliency worker dependency — compute Oklab directly from screenshot pixels.

### Step 4: Compare against published data

Digitize key published datasets as small JSON files in `tests/validation/published-data/`:

| File | Source | Data | Size |
|------|--------|------|------|
| `hansen2009_color_naming.json` | Hansen et al. (2009) | Color naming accuracy x eccentricity (2-50 deg), 11 hues | ~5 KB |
| `mullen_kingdom2002_rg_by.json` | Mullen & Kingdom (2002) | RG vs BY contrast sensitivity x eccentricity (0-30 deg) | ~3 KB |
| `bowers2025_sensitivity.json` | Bowers et al. (2025) | RG/BY/achromatic detection threshold at 5/15/75 deg | ~2 KB |

Total: ~10-15 KB. All values digitized from published figures with source figure numbers noted.

### Step 5: Orchestrate and report

New script `scripts/validate-color-search.js` (~100 lines):

1. Run `chromatic-attenuation-table.js --json` to get model predictions
2. Run `analyze-color-search.js` on captured screenshots
3. Load published JSON datasets
4. Compute correlations (Spearman rank) between model, rendered, and published
5. Output markdown report to `tests/validation/reports/color-search-report.md`

## 4. Implementation Plan

| File | Action | Lines | Description |
|------|--------|-------|-------------|
| `tests/reference-pages/color-search.html` | Modify | ~50 | URL params, yellow target, static mode |
| `scripts/chromatic-attenuation-table.js` | Modify | ~30 | Update params from modes.json, `--json` output for color-search rings |
| `scripts/analyze-color-search.js` | Create | ~150 | Pixel sampling and Oklab delta-C analysis |
| `scripts/validate-color-search.js` | Create | ~100 | Orchestrator, correlation, markdown report |
| `tests/validation/published-data/*.json` | Create | ~15 KB | Digitized published psychometric data |

No saliency worker changes needed. Delta-C computation from screenshots is sufficient for validating chromatic predictions.

## 5. Success Criteria

### Tier 1 (must pass)
- RG and BY retention both decrease monotonically across rings 1-5
- BY retention >= 1.5x RG retention at ring 5
- Both rendered measurements and model predictions agree on monotonic decrease

### Tier 2 (should pass)
- RG/BY retention ratio matches Bowers et al. (2025) within 20% at comparable eccentricities
- Green composite chroma retention closer to red (within 15pp) than to blue/yellow (see Prediction C worked example: 51.6% vs red's 42.9% vs blue's 73.0%)
- Rendered delta-C matches `chromatic-attenuation-table.js` predictions within 15% (verifies shader fidelity)

### Tier 3 (stretch)
- Detection boundary (eccentricity where delta-C drops below JND) correlates with Hansen et al. (2009) color naming accuracy drop-off, Spearman r > 0.8
- Size x eccentricity interaction matches Mullen & Kingdom (2002) spatial frequency scaling for both RG and BY channels
- Model predicts correct rank ordering of all 4 colors at all 5 rings (20 measurements, Kendall tau > 0.9)

## 6. References

- Ashraf, M. & Mantiuk, R. K. (2024). castleCSF — A contrast sensitivity function of color, area, spatiotemporal frequency, luminance, and eccentricity. *Journal of Vision*, 24(4):5.
- Bowers, N. R., Gegenfurtner, K. R., & Goettker, A. (2025). Chromatic sensitivity across the visual field. *Journal of Vision*, 25.
- Hansen, T., Pracejus, L., & Gegenfurtner, K. R. (2009). Color perception in the intermediate periphery of the visual field. *Journal of Vision*, 9(4), 26.
- Jiang, Y., Shooner, C., & Mullen, K. T. (2022). Suprathreshold chromatic contrast perception across the visual field. *Journal of Vision*, 22(14):4319.
  <!-- NOTE: BibTeX (references.bib) title is "Suprathreshold chromatic contrast perception across the visual field" but the PMC-linked version in chromatic_pooling.md (PMC9639675) gives "Achromatic and chromatic perceived contrast are reduced in the visual periphery." Verify which is the ARVO abstract vs the full paper. -->
- Mullen, K. T. & Kingdom, F. A. A. (2002). Differential distributions of red-green and blue-yellow cone opponency across the visual field. *Visual Neuroscience*, 19, 109-118.
- Rosenholtz, R. (2001). Search asymmetries? What search asymmetries? *Perception & Psychophysics*, 63(3), 476-489.
- Treisman, A. M. & Gelade, G. (1980). A feature-integration theory of attention. *Cognitive Psychology*, 12(1), 97-136.
