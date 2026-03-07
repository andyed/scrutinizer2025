# Wave 1: Feature Search Color Singleton Validation

**Status**: Proposed
**Created**: 2026-03-07
**Dependencies**: `tests/reference-pages/color-search.html`, `scripts/chromatic-attenuation-table.js`, castleCSF chromatic pooling (v1.8.0+)

## Context

Scrutinizer's chromatic decay model uses castleCSF parameters (Ashraf et al. 2024) with Bowers et al. (2025) suprathreshold corrections to attenuate color per-channel across eccentricity. The `color-search.html` reference page already implements a visual search task with colored singleton targets on gray distractors at 5 eccentricity rings. Wave 1 validates the shader's chromatic predictions against published psychometric data computationally — no human subjects, just pixel-level comparison of rendered output against published thresholds.

## 1. Falsifiable Predictions

All predictions derived from the shader attenuation formula in `renderer/shaders/peripheral2.frag` (lines 232-243):

```
appearance = pow(10^(-(k_e + k_ef * freq) * ecc_deg), supra_exponent)
```

Parameters from `shared/modes.json` (castleCSF Chromatic Pooling mode):

| Parameter | Value | Source |
|-----------|-------|--------|
| `rg_decay` (k_e) | 0.072 | Bowers et al. 2025, suprathreshold |
| `rg_freq_decay` (k_ef) | 0.003 | Conservative estimate (~1/3 of YV) |
| `yv_decay` (k_e) | 0.014 | Bowers et al. 2025, suprathreshold |
| `yv_freq_decay` (k_ef) | 0.008 | castleCSF spatial frequency interaction |
| `supra_exponent` | 0.5 | Jiang, Shooner & Mullen 2022 |

Eccentricity mapping at `fovea_radius=90px`, `fovea_deg=2.0`:

| Ring | Distance (px) | norm_ecc | ecc (deg) |
|------|--------------|----------|-----------|
| 1 | 100 | 1.11 | 2.22 |
| 2 | 200 | 2.22 | 4.44 |
| 3 | 300 | 3.33 | 6.67 |
| 4 | 420 | 4.67 | 9.33 |
| 5 | 560 | 6.22 | 12.44 |

### Prediction A: RG collapses ~5x faster than BY

The decay rate ratio is `rg_decay / yv_decay = 0.072 / 0.014 = 5.14`. At 1 cpd (representative of 24px dots at 45 ppd), predicted appearance retention:

| Ring | ecc (deg) | RG retention | BY retention | BY/RG ratio |
|------|-----------|-------------|-------------|-------------|
| 1 | 2.22 | 82.6% | 94.5% | 1.14 |
| 2 | 4.44 | 68.1% | 89.4% | 1.31 |
| 3 | 6.67 | 56.2% | 84.5% | 1.50 |
| 4 | 9.33 | 44.7% | 79.0% | 1.77 |
| 5 | 12.44 | 34.1% | 73.0% | 2.14 |

Both channels decrease monotonically. The BY/RG ratio grows with eccentricity — from 1.14 at ring 1 to 2.14 at ring 5. BY retention is >= 1.5x RG from ring 3 outward.

### Prediction B: Larger targets retain color further into periphery

Dot size determines dominant spatial frequency: `freq_cpd ≈ ppd / (2 * diameter_px)` where `ppd ≈ 45` at the default calibration. The `k_ef * freq` term in the exponent means higher spatial frequency (smaller dots) decay faster.

Predicted retention at ring 5 (12.44 deg) by dot size:

| Dot size (px) | freq (cpd) | RG retention | BY retention |
|---------------|-----------|-------------|-------------|
| 16 | 1.41 | 33.6% | 69.7% |
| 20 | 1.13 | 33.8% | 71.2% |
| 24 | 0.94 | 34.1% | 73.0% |
| 32 | 0.70 | 34.3% | 74.6% |
| 48 | 0.47 | 34.9% | 77.5% |

The size effect is small for RG (33.6% to 34.9%) because `rg_freq_decay` is low (0.003). For BY, the spread is larger (69.7% to 77.5%) because `yv_freq_decay` is nearly 3x higher (0.008). This means dot size matters more for blue/yellow detection boundaries than for red/green.

### Prediction C: Green tracks RG curve, not BY

In Oklab color space, green maps primarily to negative values on the `a` axis — the same L-M opponent channel as red (positive `a`). Green's chromatic signal is carried by L-M cone differencing, not S-(L+M). The shader applies `rg_decay` to the `a` channel and `yv_decay` to the `b` channel regardless of sign.

A green target (Oklab `a ≈ -0.08`, `b ≈ 0.05`) loses its dominant chromatic signal at the RG rate, not the BY rate. At ring 5, a green dot should retain only ~34% of its chromatic contrast — indistinguishable from the RG prediction for red, and far below the 73% prediction for yellow/blue.

This is a non-obvious prediction: people intuitively group green with blue (cool colors), but opponent color processing groups green with red (L-M channel). The shader's per-channel Oklab attenuation makes this testable.

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

| Color | RGB | Oklab a | Oklab b | Primary channel |
|-------|-----|---------|---------|-----------------|
| Red | rgb(200, 70, 70) | +0.08 | +0.04 | RG (a-axis) |
| Green | rgb(70, 180, 70) | -0.08 | +0.05 | RG (a-axis) |
| Blue | rgb(70, 100, 210) | -0.02 | -0.10 | BY (b-axis) |
| Yellow | rgb(210, 190, 60) | -0.01 | +0.12 | BY (b-axis) |
| Gray | luminance-matched per target | 0.00 | 0.00 | — |

## 3. Comparison Methodology

### Step 1: Generate model predictions (JSON)

Extend `scripts/chromatic-attenuation-table.js` to accept `--json` flag and output structured predictions:

```json
{
  "parameters": { "rg_decay": 0.072, "rg_freq_decay": 0.003, ... },
  "predictions": [
    { "color": "red", "size_px": 24, "freq_cpd": 0.94, "ring": 1, "ecc_deg": 2.22,
      "rg_retention": 0.826, "yv_retention": 0.945, "primary_channel": "rg" }
  ]
}
```

### Step 2: Capture rendered output

Use `scripts/capture-golden.js` pattern — launch Scrutinizer pointed at `color-search.html?mode=static&color=red&size=24`, capture screenshot at center fixation. Repeat for each color/size combination. Output to `tests/golden-captures/validation/color-search/`.

Capture matrix: 4 colors x 5 sizes = 20 screenshots.

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

All code changes are future work — this commit is the spec only.

| File | Action | Lines | Description |
|------|--------|-------|-------------|
| `tests/reference-pages/color-search.html` | Modify | ~50 | URL params, yellow target, static mode |
| `scripts/chromatic-attenuation-table.js` | Modify | ~30 | `--json` output for color-search rings |
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
- Green target tracks RG decay curve (within 10% of red), not BY curve
- Rendered delta-C matches `chromatic-attenuation-table.js` predictions within 15% (verifies shader fidelity)

### Tier 3 (stretch)
- Detection boundary (eccentricity where delta-C drops below JND) correlates with Hansen et al. (2009) color naming accuracy drop-off, Spearman r > 0.8
- Size x eccentricity interaction matches Mullen & Kingdom (2002) spatial frequency scaling for both RG and BY channels
- Model predicts correct rank ordering of all 4 colors at all 5 rings (20 measurements, Kendall tau > 0.9)

## 6. References

- Ashraf, M., Ahumada, A., & Kim, J. (2024). castleCSF — A contrast sensitivity function of color, area, spatiotemporal frequency, luminance, and eccentricity. *Journal of Vision*.
- Bowers, N. R., Tyson, T. L., & Bhatt, S. (2025). Suprathreshold chromatic sensitivity across the visual field. *Vision Research*.
- Hansen, T., Pracejus, L., & Gegenfurtner, K. R. (2009). Color perception in the intermediate periphery of the visual field. *Journal of Vision*, 9(4), 26.
- Jiang, Y., Shooner, C., & Mullen, K. T. (2022). Power-law relationship between detection threshold and perceived saturation at high contrasts. *Journal of Vision*.
- Mullen, K. T. & Kingdom, F. A. A. (2002). Differential distributions of red-green and blue-yellow cone opponency across the visual field. *Visual Neuroscience*, 19, 109-118.
- Rosenholtz, R. (2001). Search asymmetries? What search asymmetries? *Perception & Psychophysics*, 63(3), 476-489.
- Treisman, A. M. & Gelade, G. (1980). A feature-integration theory of attention. *Cognitive Psychology*, 12(1), 97-136.
