# Wave 2: Spatial Acuity Validation

> **Last updated:** 2026-03-07

**Status**: Proposed
**Created**: 2026-03-07
**Dependencies**: `renderer/shaders/peripheral.frag` (DoG band decomposition), `shared/modes.json`, Wave 1 infrastructure (`scripts/analyze-*.js`, `scripts/validate-*.js`, `scripts/report-*.js`)

## Context

Scrutinizer's peripheral shader decomposes the rendered page into 5 spatial frequency bands via Difference-of-Gaussians (MIP chain subtraction) and attenuates each band based on eccentricity using M-scaling (Rovamo & Virsu 1979). Wave 2 validates that this band-selective blur matches published contrast sensitivity falloff data — does the shader correctly predict which spatial frequencies survive at each eccentricity?

## 1. Falsifiable Predictions

### The Shader's Spatial Model

The DoG decomposition in `peripheral.frag` (lines 164-176) extracts 5 bands:

| Band | MIP Levels | Spatial Freq | Content | Cutoff (norm_ecc) |
|------|-----------|-------------|---------|-------------------|
| band0 | mip0 - mip1 | ~4 cpd | Serifs, hairlines | 1 × E2 = 0.15 |
| band1 | mip1 - mip2 | ~2 cpd | Letter bodies | 3 × E2 = 0.45 |
| band2 | mip2 - mip3 | ~1 cpd | Words, UI elements | 7 × E2 = 1.05 |
| band3 | mip3 - mip4 | ~0.5 cpd | Buttons, cards | 15 × E2 = 2.25 |
| residual | mip4 | ~0.25 cpd | Backgrounds | Never (always preserved) |

Cutoff formula (M-scaling): `cutoff_norm = E2 × (2^k - 1)` where E2 = `dog_e2` = 0.15.

At `fovea_radius=90px`, `fovea_deg=2.0`, `ppd=45`:

| Band | Cutoff norm_ecc | Cutoff px | Cutoff deg |
|------|----------------|-----------|------------|
| band0 (4 cpd) | 0.15 | 13.5 | 0.30 |
| band1 (2 cpd) | 0.45 | 40.5 | 0.90 |
| band2 (1 cpd) | 1.05 | 94.5 | 2.10 |
| band3 (0.5 cpd) | 2.25 | 202.5 | 4.50 |
| residual (0.25 cpd) | Never | Never | Never |

### Prediction A: Band dropout order is frequency-ordered

At each eccentricity ring, higher spatial frequencies should show lower contrast retention than lower frequencies. The ordering band0 < band1 < band2 < band3 < residual must hold at every ring.

### Prediction B: M-scaling cutoff eccentricities

Each band's contrast should cross the 50% retention threshold near the predicted cutoff eccentricity (within ±30%). The transition should be gradual (`dog_sharpness=0.0`), not a cliff.

### Prediction C: Residual band always preserved

The lowest frequency band (~0.25 cpd) should retain >90% contrast at all rings, including ring 5 (12.44°). This matches the biological reality that large-scale luminance gradients are visible across the entire visual field.

### Prediction D: Chromatic × frequency interaction

Per-band chromatic decay compounds with spatial frequency falloff. At ring 3 (6.67°):
- Achromatic band1 (2 cpd): should retain moderate contrast
- RG-channel band1 (2 cpd): should retain significantly less (chromatic decay + frequency decay)
- BY-channel band1 (2 cpd): intermediate (slower chromatic decay)

This tests the multiplicative interaction between `chromaticAttenuate()` and DoG band weights.

### Prediction E: Contrast sensitivity falloff matches Rovamo & Virsu

Normalized contrast retention at each frequency should correlate (Spearman r > 0.9) with Rovamo & Virsu (1979) Fig 3: contrast sensitivity vs eccentricity at matched spatial frequencies.

## 2. Stimulus Design

### `spatial-acuity.html` — Sine-wave grating annuli

Concentric annuli (like Wave 1 bands mode) but each ring displays a sine-wave grating at a specific spatial frequency, rendered via `<canvas>`.

**Layout**: 5 concentric rings at distances [100, 200, 300, 420, 560] px from fixation. Each ring is a 60px-wide annulus filled with a horizontal sine-wave grating.

**Modes**:
- `?mode=single&freq=2` — All rings show the same frequency (for measuring retention vs eccentricity at one freq)
- `?mode=ladder` — Ring 1 = 4 cpd, Ring 2 = 2 cpd, Ring 3 = 1 cpd, Ring 4 = 0.5 cpd, Ring 5 = 0.25 cpd (frequency ladder, tests band selectivity)
- `?mode=bands` — Same as ladder but with foveal reference grating at center

**Parameters**: `?freq=2&contrast=1.0&orientation=0&chromatic=achromatic`
- `freq`: spatial frequency in cpd (0.25, 0.5, 1, 2, 4)
- `contrast`: Michelson contrast 0-1 (default 1.0)
- `orientation`: grating angle in degrees (default 0 = horizontal)
- `chromatic`: `achromatic` (default), `rg` (isoluminant red-green), `by` (isoluminant blue-yellow)

**Canvas rendering**: Each annulus is a `<canvas>` element clipped to the ring shape. The sine-wave grating:
```
luminance(x) = L_mean + contrast × L_mean × sin(2π × freq_px × x)
```
where `freq_px = freq_cpd / ppd` and `ppd = fovea_radius / fovea_deg`.

For chromatic gratings, modulate along Oklab a-axis (RG) or b-axis (BY) while holding L constant.

### Foveal reference

A grating patch at the center (inside the fovea) at the same frequency provides the 100% retention baseline, same approach as Wave 1.

## 3. Analysis: `analyze-spatial-acuity.js`

Extends the Wave 1 analysis pattern:

1. Read PNG screenshots from `tests/golden-captures/validation/spatial-acuity/`
2. At each ring, compute **local contrast** of the grating: sample along the grating axis, compute RMS contrast of the luminance profile
3. Compare filtered vs baseline contrast at each ring
4. Compute **contrast retention** = filtered_RMS / foveal_RMS

Key difference from Wave 1: instead of measuring chroma, we measure **luminance contrast** (or chromatic contrast for RG/BY gratings). Sample a horizontal line of pixels through each ring's center, compute the amplitude of the sinusoidal modulation via FFT or peak-to-trough measurement.

### Spatial frequency verification

Before comparing filtered vs baseline, verify that the grating spatial frequency in the screenshot matches the intended frequency (peak in FFT at expected bin). This catches rendering errors.

## 4. Published Comparison Data

### Rovamo & Virsu (1979) — Contrast sensitivity vs eccentricity

`tests/validation/published-data/rovamo_virsu1979_csf.json`

Contrast sensitivity (relative to fovea) at 0.5, 1, 2, 4 cpd as a function of eccentricity (0-30°). Digitized from Figure 3.

### Watson & Ahumada (2005) — Parametric CSF

`tests/validation/published-data/watson_ahumada2005_csf.json`

The standard CSF parameterization. Peak sensitivity, bandwidth, and cutoff frequency as a function of eccentricity.

### castleCSF (Ashraf et al. 2024) — The model itself

Since Scrutinizer implements castleCSF, we can compare our discrete DoG band decomposition against castleCSF's continuous predictions to verify the approximation quality.

## 5. Validation: `validate-spatial-acuity.js`

### Tier 1: Must Pass

1. **Frequency ordering preserved at every ring**: contrast_band0 ≤ contrast_band1 ≤ ... ≤ contrast_residual
2. **Monotonic contrast decrease with eccentricity**: for each frequency, retention at ring N+1 ≤ retention at ring N
3. **Residual band >90% retention at ring 5**: low-frequency content always visible

### Tier 2: Should Pass

4. **M-scaling cutoff within ±30%**: the 50% retention crossing for each band occurs within 30% of the predicted cutoff eccentricity
5. **Achromatic > BY > RG at matched frequency**: at ring 3, achromatic grating retains more contrast than BY, which retains more than RG (at the same spatial frequency)
6. **Rendered matches model within 20%**: measured contrast retention agrees with `chromatic-attenuation-table.js` predictions within 20% at each ring/frequency

### Tier 3: Stretch

7. **Rovamo & Virsu correlation**: Spearman r > 0.9 between model contrast retention and published CSF data at matched frequencies
8. **castleCSF continuous vs DoG discrete**: our 5-band approximation matches castleCSF continuous predictions within 15% RMSE across all tested eccentricities

## 6. Capture Matrix

| Frequency | Orientation | Chromatic | Conditions | Screenshots |
|-----------|------------|-----------|------------|-------------|
| 0.25 cpd | horizontal | achromatic | filtered + baseline | 2 |
| 0.5 cpd | horizontal | achromatic | filtered + baseline | 2 |
| 1 cpd | horizontal | achromatic | filtered + baseline | 2 |
| 2 cpd | horizontal | achromatic | filtered + baseline | 2 |
| 4 cpd | horizontal | achromatic | filtered + baseline | 2 |
| 1 cpd | horizontal | rg | filtered + baseline | 2 |
| 1 cpd | horizontal | by | filtered + baseline | 2 |

**Total**: 14 screenshots (7 conditions × 2 filtered/baseline)

Smoke test first: 1 cpd achromatic (2 screenshots), then expand.

## 7. Implementation Plan

| File | Action | Lines |
|------|--------|-------|
| `tests/reference-pages/spatial-acuity.html` | Create — canvas-based grating annuli | ~250 |
| `scripts/analyze-spatial-acuity.js` | Create — contrast measurement from screenshots | ~200 |
| `scripts/capture-spatial-acuity.js` | Create — capture automation | ~80 |
| `scripts/validate-spatial-acuity.js` | Create — comparison orchestrator | ~150 |
| `scripts/report-spatial-acuity.js` | Create — visual HTML report | ~100 (extend Wave 1 template) |
| `tests/validation/published-data/rovamo_virsu1979_csf.json` | Create — digitized data | ~30 |
| `scripts/chromatic-attenuation-table.js` | Extend — `--spatial-acuity` flag for per-band predictions | ~50 |
| `menu-template.js` | Extend — Experimental Stimulus submenu entries | ~20 |

## 8. Success Criteria

- **Ship-blocking**: Tier 1 all pass (frequency ordering, monotonic decrease, residual preservation)
- **Confidence**: Tier 2 majority pass (M-scaling cutoffs, chromatic interaction, model agreement)
- **Publication-quality**: Tier 3 pass (Rovamo & Virsu correlation, castleCSF approximation quality)

## References

- Rovamo, J. & Virsu, V. (1979). An estimation and application of the human cortical magnification factor. *Experimental Brain Research*, 37, 495-510.
- Watson, A.B. & Ahumada, A.J. (2005). A standard model for foveal detection of spatial contrast. *Journal of Vision*, 5(9), 6.
- Ashraf, M., et al. (2024). castleCSF — A contrast sensitivity function of color, area, spatiotemporal frequency, luminance and eccentricity. *bioRxiv*.
- Burt, P.J. & Adelson, E.H. (1983). The Laplacian pyramid as a compact image code. *IEEE Transactions on Communications*, 31(4), 532-540.
- Levi, D.M., Klein, S.A. & Aitsebaomo, A.P. (1985). Vernier acuity, crowding and cortical magnification. *Vision Research*, 25(7), 963-977.
- Campbell, F.W. & Robson, J.G. (1968). Application of Fourier analysis to the visibility of gratings. *The Journal of Physiology*, 197(3), 551-566.
