# Scrutinizer v2.5.0 Release Notes

**Release Date:** 2026-03-16
**Previous:** [v2.4.0 release notes](release_notes_v2.4.0.md)

## In This Release

1. [12-Band DoG Decomposition](#12-band-dog-decomposition) — Extended from 8 to 12 half-octave bands (LOD 0.0–6.0), covering panel backgrounds and page-level color regions where peripheral color perception is strongest.
2. [Chromatic Pipeline Calibration](#chromatic-pipeline-calibration) — RG decay tuned to Bowers et al. (2025), base desaturation ramp widened from 1°–2° to 1°–6°, swatch-aware chromatic preservation.
3. [Color Search Validation](#color-search-validation) — Three-tier validation suite against published psychophysics. Tier 1: 9/9, Tier 2: 2/3, Tier 3: 3/3.
4. [Capture & Test Infrastructure](#capture--test-infrastructure) — Smoke test pipeline, manifest-based capture caching, 258 unit tests across 11 suites.

---

## 12-Band DoG Decomposition

The Difference-of-Gaussians frequency decomposition extended from 8 half-octave bands (LOD 0.0–4.0, 5.66–0.35 cpd) to 12 bands (LOD 0.0–6.0, 5.66–0.088 cpd). Four new low-frequency bands cover content that the old range missed entirely:

| Band | Frequency | Content at this scale |
|------|-----------|----------------------|
| 8 | 0.354 cpd | Card borders, list separators |
| 9 | 0.250 cpd | Panel backgrounds |
| 10 | 0.177 cpd | Hero images, banners |
| 11 | 0.125 cpd | Page-level color regions |
| residual | 0.088 cpd | DC: overall page tone |

These are the scales where peripheral color perception is strongest. S-cone signals pool spatially over large areas, and low-frequency chromatic contrast sensitivity falls off slowly with eccentricity.

### Files

| File | Change |
|------|--------|
| `renderer/shaders/peripheral.frag` | 13 MIP samples, 12 DoG bands, extended cutoff/weight/attenuation arrays |
| `renderer/shaders/crowding-stats.wgsl` | `max_mip: 4.0` → `6.0` |
| `scripts/chromatic-attenuation-table.js` | 13-band frequency table |

---

## Chromatic Pipeline Calibration

Three changes to the chromatic attenuation pipeline, each addressing a specific gap between the old implementation and the biology.

### RG Decay Calibration

`rg_decay` increased from 0.072 to 0.085. At ring 5 (12.4°), the BY/RG sensitivity ratio is 1.86×, monotonically separating from 1.05× at 2.5°. The single-exponential decay cannot fully capture the biphasic RG falloff that Bowers et al. (2025) measured (steep to ~15°, then slowing), but the rank ordering and channel separation are correct across the measured range.

### Base Desaturation Ramp

`lgn_ramp_end_mult` widened from 2.0 to 6.0 for mode 0, extending the smoothstep transition from 1°–2° to 1°–6°. The old ramp created a color cliff at the parafoveal boundary. When per-band chromatic pooling is active, the base ramp reduces to 40% strength to prevent multiplicative over-desaturation.

### Swatch-Aware Preservation

`mip[12]` at LOD 6.0 averages ~64×64 source pixels. Its Oklab chrominance magnitude distinguishes large uniform color regions (high chroma) from mixed/text content (low chroma). Swatches retain up to 30% more color than text at the same eccentricity. The boost applies only to frequency bands — not the DC residual — to prevent color halos at region boundaries.

### Files

| File | Change |
|------|--------|
| `shared/modes.json` | `rg_decay` 0.072→0.085 (all chromatic modes), `lgn_ramp_end_mult` 2.0→6.0 (mode 0) |
| `renderer/shaders/peripheral.frag` | Swatch detection block, base ramp reduction, forward declarations for `rgbToOklab` and `chromaticAttenuate` |

---

## Color Search Validation

Wave 1 validation places 24px colored dots (~0.94 cpd at 45 ppd) at five eccentricity rings (2.5°–12.4°) and measures chromatic retention through the pipeline.

| Tier | Passed | Tests |
|------|--------|-------|
| Tier 1 (must) | 9/9 | Monotonic decrease all colors, BY ≥ 1.5× RG, rendered measurements monotonic |
| Tier 2 (should) | 2/3 | Bowers BY/RG ratio 5% off (pass), green tracks red (pass), rendered-vs-model 5/20 (fail) |
| Tier 3 (stretch) | 3/3 | Hansen naming correlation r=1.000, BY > RG every ring |

The Tier 2 miss (rendered-vs-model pixel agreement) reflects MIP chain quantization and base ramp effects that the analytical model does not predict. Rank ordering is correct; absolute values diverge.

### Analyzer Fix

`analyze-color-search.js` was sampling at `RINGS[r] + halfBand` (outer edge of band) instead of `RINGS[r]` (band center). At outer rings the sample landed in the gap between bands, causing spurious monotonicity failures. Verified by pixel probing.

---

## Capture & Test Infrastructure

### Smoke Test Pipeline

`npm run capture-smoke` — 6-shot sanity check across 3 Electron batches (~40s full, <1s incremental). Covers: basic render, mode switch, saliency debug, scroll, off-center fixation.

### Capture Infrastructure

- **Manifest-based caching** (`scripts/lib/capture-manifest.js`): Hashes capture config to skip unchanged shots.
- **Batch orchestrator** (`scripts/lib/capture-runner.js`): Groups shots by URL, reuses Electron instances.
- **Release skill staleness check**: Compares capture timestamps against shader/mode file timestamps.

### Test Growth

258 unit tests across 11 suites (was 138 in v1.6). New suites:

| Suite | Tests | Coverage |
|-------|-------|----------|
| `mip-fidelity.test.js` | DoG band reconstruction vs pure rect sampling |
| `isotropic-sectors.test.js` | Cortical grid geometry, mode 12 config |
| `stimulus-domain.test.js` | Spectral mismatch, color gamut, crowding geometry |
| `validation-regression.test.js` | Bowers 2025 calibration, psychophysical regression guards |

### New Reference Pages

- `color-spectrum-v2.html` — improved spectrum with floating color patches
- `chroma-uniform.html` — uniform chromaticity stimulus for BY/RG testing
- `grid-comparison.html` — MIP vs cortical grid side-by-side
- `ocr-text-grid.html` — text grid for OCR readability measurement

---

## References

- Bowers, N. R., Boehm, A. E., Tuten, W. S., Roorda, A., Gegenfurtner, K. R. & Goettker, A. (2025). Spatial contrast sensitivity across the visual field. *Journal of Vision*, 25(3):15.
- Mullen, K. T. & Kingdom, F. A. A. (2002). Differential distributions of red-green and blue-yellow cone opponency across the visual field. *Visual Neuroscience*, 19, 109–118.
- Hansen, T., Pracejus, L. & Gegenfurtner, K. R. (2009). Color perception in the intermediate periphery of the visual field. *Journal of Vision*, 9(4):26.
- Reynaud, A. & Hess, R. F. (2023). castleCSF — A comprehensive model for contrast sensitivity. *Journal of Vision*, 23(1):7.
