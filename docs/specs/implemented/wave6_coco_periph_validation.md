# Wave 6: COCO-Periph Peripheral Encoding Validation

> **Last updated:** 2026-03-13

**Status**: In progress
**Created**: 2026-03-13
**Dependencies**: Waves 1-4 infrastructure (SSIM, DFT, ring sampling, tier framework), renderer pipeline (MIP + DoG + crowding + chromatic decay)

## Context

Waves 1-4 validated individual mechanisms (chromatic decay, spatial frequency, crowding geometry, saliency) using synthetic HTML stimuli. Wave 6 is the first **system-level** validation: natural images processed through Scrutinizer's complete pipeline, compared against the Texture Tiling Model (TTM) reference from COCO-Periph (Harrington et al., ICLR 2024).

COCO-Periph provides TTM-transformed COCO images at 4 eccentricities (5°, 10°, 15°, 20°), human psychophysics data, and a tractable TTM implementation — all MIT licensed, hosted at `data.csail.mit.edu/coco_periph/`.

The question: does MIP blur + DoG + crowding + chromatic decay collectively approximate what full statistical pooling produces?

## Method

### Image Selection

50 images curated from the COCO-Periph dataset, spanning the congestion range:
- Compute Feature Congestion for each original image using `congestion-core.js`
- Sort by congestion score, divide into 5 quintiles
- Select 10 images per quintile → 50 total

This ensures we test Scrutinizer against TTM across the full range of visual complexity, from sparse scenes to dense clutter.

### Annular Ring Sampling

Scrutinizer applies radial eccentricity-dependent processing; COCO-Periph TTM images apply uniform processing at a single eccentricity. To compare:

1. Load original COCO image as an HTML `<img>` at center of 1920×1080 viewport
2. Capture Scrutinizer's filtered output with center fixation
3. Extract rectangular patches (45×45px = 1° at 45 ppd) at N/S/E/W cardinal positions at each target eccentricity ring
4. Compare patches via SSIM, PSNR, and DFT band energy

| Eccentricity | Ring radius (px) | Viewport coverage |
|-------------|-----------------|-------------------|
| 5° | 225 | Full |
| 10° | 450 | Vertical edge |
| 15° | 675 | Horizontal only |
| 20° | 900 | Partial horizontal, ≥25% ring fill required |

### Metrics

- **SSIM**: Structural Similarity Index between original and processed patches
- **PSNR**: Peak Signal-to-Noise Ratio (complementary to SSIM)
- **DFT band energy**: Low-frequency (<2 cpd) and high-frequency (4-8 cpd) band energy in annular patches
- **Spearman ρ**: Rank correlations between Scrutinizer and TTM metrics across images

## Falsifiable Predictions

### Tier 1: Must Pass

| # | Prediction | Threshold | Rationale |
|---|-----------|-----------|-----------|
| 1 | SSIM(original, Scrutinizer) decreases monotonically with eccentricity | ≥90% of images show monotonic decrease | MIP chain + DoG + crowding all increase with eccentricity — monotonic degradation is a construction property |
| 2 | Scrutinizer preserves more at 5° than TTM: SSIM(orig, Scrut) > SSIM(orig, TTM) | ≥70% of images | At 5°, Scrutinizer is barely into MIP level 1; TTM applies full statistical pooling. Scrutinizer should be closer to original. |
| 3 | Low-frequency band energy (<2 cpd) correlates between Scrutinizer and TTM outputs | r > 0.5 at each eccentricity | Both models preserve low spatial frequencies in periphery. The coarse structure should agree even when fine details differ. |

### Tier 2: Should Pass

| # | Prediction | Threshold | Rationale |
|---|-----------|-----------|-----------|
| 4 | SSIM degradation rate across eccentricities correlates between models | Spearman ρ > 0.4 | Images that degrade faster under TTM should also degrade faster under Scrutinizer — both respond to the same spatial complexity. |
| 5 | Congestion score predicts Scrutinizer-vs-TTM SSIM divergence at 15-20° | Rank correlation > 0.3 | High-congestion images have more texture that TTM statistical pooling preserves but MIP blur destroys. |
| 6 | Crossover eccentricity exists where TTM retains more than Scrutinizer | Median crossover between 10-20° | At near periphery Scrutinizer preserves more (less aggressive blur). At far periphery TTM's texture synthesis preserves structure that blur cannot. |

### Tier 3: Stretch

| # | Prediction | Threshold | Rationale |
|---|-----------|-----------|-----------|
| 7 | High-frequency band (4-8 cpd) ratio TTM/Scrutinizer grows with eccentricity | Ratio > 1.5 at 20° | TTM synthesizes high-frequency texture that matches summary statistics; MIP blur simply removes it. |
| 8 | Object detection AP falloff curves correlate (deferred — needs Python detector) | Spearman ρ > 0.7 | Functional equivalence: if both models impair recognition similarly, they model the same information loss. |
| 9 | Per-image SSIM rank order preserved across models at 10° | Spearman ρ > 0.5 | Images that are "easy" for one model (high SSIM retention) should be easy for the other. |

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/download-coco-periph.js` | Fetch COCO images + TTM versions, select by congestion |
| `scripts/capture-coco-periph.js` | Load originals in Scrutinizer, capture filtered output |
| `scripts/analyze-coco-periph.js` | Annular SSIM, PSNR, DFT band energy per eccentricity |
| `scripts/validate-coco-periph.js` | Tier evaluation, markdown report |

## Verification

1. `node scripts/download-coco-periph.js --count=5` — downloads 5 images + TTM versions
2. `node scripts/capture-coco-periph.js` — captures Scrutinizer output for each
3. `node scripts/analyze-coco-periph.js --json` — produces per-image, per-eccentricity metrics
4. `node scripts/validate-coco-periph.js` — Check 1-9 evaluated, tier summary printed
5. Spot-check: at 5° eccentricity, SSIM(orig, Scrutinizer) should be ~0.7-0.9; at 20°, ~0.3-0.5

## References

- Harrington, C., Pepe, A., Ling, S., & Rosenholtz, R. (2024). COCO-Periph: Bridging the gap between human and machine perception with a peripheral vision benchmark. ICLR 2024.
- Rosenholtz, R., Huang, J., Raj, A., Balas, B., & Ilie, L. (2012). A summary statistic representation in peripheral vision explains visual search. Journal of Vision, 12(4):14.
- Rosenholtz, R., Li, Y., & Nakano, L. (2007). Measuring visual clutter. Journal of Vision, 7(2):17.
