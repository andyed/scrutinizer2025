# Wave 3: Crowding Zone Validation

> **Last updated:** 2026-03-07

**Status**: Proposed
**Created**: 2026-03-07
**Dependencies**: `renderer/shaders/peripheral.frag` (density-gated crowding, polar sectors), `renderer/config.js`, Wave 1-2 infrastructure, existing reference pages (`crowding.html`, `crowding-stimulus.html`)

## Context

Scrutinizer models crowding through three mechanisms:

1. **MIP pooling** (V4) — hardware MIP-maps approximate biological receptive field growth. `computeMipLevel()` maps eccentricity to MIP levels 0-4, each level doubling the averaging region.
2. **Polar sector quantization** (V1 type 4, V4 style 8) — polar grid with ring spacing `ef=1.007`, `bias=2.0`, producing sectors whose radial extent is ~2x tangential extent.
3. **Density-gated V1 distortion** (shipped v1.9.1) — sigmoid gate on structure map density. Dense content (text clusters) gets full Lateral Smash; isolated elements get 30% floor.

Wave 3 validates that these mechanisms collectively reproduce the spatial geometry of visual crowding as described by Bouma's law and the TTM (Rosenholtz et al. 2012).

## Bouma's Law: The Ground Truth

Bouma (1970) established that a target letter becomes unidentifiable when flankers fall within a **critical spacing** of approximately **0.5 x eccentricity** (in degrees). This has been refined but the 0.5 proportionality constant holds across most of the visual field:

| Eccentricity | Critical Spacing (Bouma) | At 45 ppd (90px fovea) |
|-------------|-------------------------|------------------------|
| 2° (fovea edge) | 1.0° | 45 px |
| 4° (parafovea) | 2.0° | 90 px |
| 6° | 3.0° | 135 px |
| 10° | 5.0° | 225 px |
| 15° | 7.5° | 338 px |

The critical spacing zone is **not circular** — it extends ~2x further radially than tangentially (Toet & Levi 1992), which Scrutinizer models via `u_crowding_radial_bias = 2.0`.

## 1. Falsifiable Predictions

### Prediction A: MIP pooling regions grow linearly with eccentricity

The MIP level computation `computeMipLevel()` (peripheral.frag:277-291) should produce pooling region sizes that grow approximately linearly with eccentricity, matching Bouma's proportional scaling.

Each MIP level doubles the averaging area: MIP 0 = 1px, MIP 1 = 2px, MIP 2 = 4px, MIP 3 = 8px, MIP 4 = 16px. The effective pooling diameter at eccentricity e should approximate:

```
pooling_diameter_px ≈ 2^mipLevel(e)
```

**Test**: Compute `2^computeMipLevel(e)` at eccentricities 2-15° and compare the pooling diameter (in degrees) to `0.5 * e`. The ratio `pooling_diameter / critical_spacing` should be between 0.3 and 2.0 — we're not claiming exact match, but the growth rate must be proportional.

### Prediction B: Polar sector radial extent matches Bouma critical spacing

The polar sector computation (peripheral.frag:310-349) produces sectors with:
- Ring width: `ring_outer - ring_inner = r * (ef^bias - 1)` where ef=1.007, bias=2.0
- At `r = parafovea_radius` (≈225px at medium): ring width ≈ 3.2px
- At `r = 0.3` (≈10° at medium): ring width ≈ 4.2px

**Test**: At each eccentricity, compute polar sector radial extent in degrees and compare to Bouma's 0.5 * eccentricity. The sectors are intentionally fine-grained (tracking CMF block sizes, not crowding zones), so the question is: how many sectors fit within one Bouma critical spacing zone? This ratio should be approximately constant across eccentricities (indicating proportional scaling).

### Prediction C: Density gating differentiates crowded vs isolated

The crowding reference page (`crowding.html`) places crowded (flanked) and isolated versions of the same letter at the same eccentricities. The density-gated sigmoid (peripheral.frag:599-604) should produce measurably different `crowdingFactor` values:

- **Crowded group** (density ~0.53): `crowdingFactor` → ~0.85-1.0
- **Isolated letter** (density ~0.44): `crowdingFactor` → ~0.35-0.50

**Test**: Capture `crowding.html` at fixation point 1 (center). Measure pixel variance within the target letter 'V' for crowded vs isolated conditions at each eccentricity (3°, 6°, 10°). The crowded V should show significantly higher distortion (lower letter contrast / higher position variance) than the isolated V.

### Prediction D: Radial-tangential asymmetry matches Toet & Levi

Toet & Levi (1992) found crowding zones are elliptical: ~2:1 radial:tangential ratio. Scrutinizer models this via `u_crowding_radial_bias = 2.0` in both the V1 Lateral Smash and polar sector computation.

**Test**: Create a new reference page (`crowding-radial.html`) with flankers placed at the same distance from the target but in radial vs tangential positions. At 6° eccentricity with flanker spacing at 0.4x eccentricity (inside Bouma for radial, outside for tangential):
- Radially-flanked target: should be heavily degraded
- Tangentially-flanked target: should be partially preserved

### Prediction E: Crowding onset matches Bouma threshold

At the transition point — flanker spacing exactly at 0.5x eccentricity — there should be a measurable drop in target identifiability compared to wider spacing. This tests whether the density gate + V1 distortion together produce the right spatial threshold.

**Test**: Use `crowding.html` with parametric flanker spacing (new feature). At 6° eccentricity, vary spacing from 0.2x to 0.8x eccentricity. Plot target letter contrast retention vs spacing. The curve should show a transition near 0.5x.

## 2. Stimulus Design

### Existing: `crowding.html` (letters)

Already built. Three font-size columns (16/28/48px), rows at 3°/6°/10° eccentricity, crowded (flanked) and isolated targets. Click to randomize.

**Enhancement needed**: Add URL parameter `?spacing=0.5` to control flanker spacing as a fraction of eccentricity. Current gap is quadratic `fontSize^2/200` which doesn't parameterize by Bouma ratio.

### Existing: `crowding-stimulus.html` (stimulus-specific)

Already built. Tests orientation (Gabor), color grouping, and complexity dimensions of crowding across three columns.

### New: `crowding-radial.html` — Radial vs tangential flanking

Tests Prediction D. Layout:

- Central fixation cross
- Target letters at 6° eccentricity, placed at 4 cardinal positions (up/down/left/right of fixation)
- Each target has two flanker conditions:
  - **Radial**: flankers placed along the radial axis (between target and fixation, and beyond target)
  - **Tangential**: flankers placed perpendicular to radial axis
- Flanker spacing: 0.4x eccentricity (2.4° at 6°) — inside Bouma for radial, borderline for tangential
- Font size: 28px (large enough to rule out acuity)
- Golden dots at center + each target position

### New: `crowding-spacing.html` — Parametric Bouma spacing

Tests Prediction E. Layout:

- Central fixation cross
- Target letter at 6° eccentricity (right of fixation)
- 7 rows at different flanker spacings: 0.2x, 0.3x, 0.4x, 0.5x, 0.6x, 0.7x, 0.8x eccentricity
- All rows use same font size (28px), same flanker count (1 left, 1 right)
- Labels at left edge showing spacing ratio
- Golden dots at fixation + target column

## 3. Analytical Validation

### `analyze-crowding.js` — Crowding zone measurement

Pixel-level analysis of crowding reference page screenshots.

**Inputs**: Golden captures of `crowding.html` at fixation point 1 (center)

**Measurements** at each eccentricity row (3°, 6°, 10°):

1. **Target letter contrast**: Sample pixels within the target letter bounding box. Compute RMS contrast between letter pixels and background.
   - `contrast_crowded` = RMS contrast of 'V' in crowded group
   - `contrast_isolated` = RMS contrast of 'V' in isolated position

2. **Crowding ratio**: `CR = contrast_crowded / contrast_isolated`
   - CR < 1.0 → crowding effect present (good)
   - CR ≈ 1.0 → no crowding differentiation (bad)

3. **Position scatter**: Sample 5x5 grid centered on expected target position. Compute variance of luminance — higher variance indicates more V1 Lateral Smash displacement.

### `analyze-crowding-geometry.js` — Pooling region size extraction

Computes Scrutinizer's effective pooling region sizes and compares to Bouma.

**Method**: Offline computation (no screenshots needed). Replicate `computeMipLevel()` and polar sector math in JavaScript:

```javascript
// Replicate shader's computeMipLevel with CMF
function computeMipLevel(eccentricity_px, fovea_radius, cmf_a, cortical_max, ecc_scaling) {
    const normalizedEcc = Math.max(0, eccentricity_px) / fovea_radius;
    const r_deg = normalizedEcc * 2.0;
    const cortical_dist = Math.log(1 + r_deg / cmf_a);
    const eccScale = ecc_scaling / 0.75;
    return Math.min(4.0, 4.0 * cortical_dist / cortical_max * eccScale);
}

// Pooling diameter in pixels at each MIP level
function poolingDiameter(mipLevel) {
    return Math.pow(2, mipLevel);
}

// Bouma critical spacing in pixels
function boumaCriticalSpacing(ecc_deg, ppd) {
    return 0.5 * ecc_deg * ppd;
}
```

**Output**: Table comparing pooling region sizes to Bouma at eccentricities 2-15°, plus a Bouma ratio (`pooling_diameter / critical_spacing`) at each point.

### `analyze-polar-sectors.js` — Sector geometry vs Bouma

Computes polar sector dimensions and compares to crowding zones.

**Method**: Replicate `computePolarSector()` in JavaScript. At each eccentricity:
- Compute ring width (radial extent of sector) in degrees
- Compute spoke width (tangential extent) in degrees
- Compare radial extent to Bouma critical spacing
- Compute radial:tangential ratio (should be ~2:1)

## 4. Published Comparison Data

### `tests/validation/published-data/bouma1970_critical_spacing.json`

```json
{
    "source": "Bouma (1970), Nature 226, 177-178",
    "note": "Critical spacing for letter identification. Proportionality constant varies 0.3-0.5 across studies.",
    "data": [
        { "eccentricity_deg": 1, "critical_spacing_deg": 0.5 },
        { "eccentricity_deg": 2, "critical_spacing_deg": 1.0 },
        { "eccentricity_deg": 3, "critical_spacing_deg": 1.5 },
        { "eccentricity_deg": 5, "critical_spacing_deg": 2.5 },
        { "eccentricity_deg": 7, "critical_spacing_deg": 3.5 },
        { "eccentricity_deg": 10, "critical_spacing_deg": 5.0 },
        { "eccentricity_deg": 15, "critical_spacing_deg": 7.5 }
    ]
}
```

### `tests/validation/published-data/toet_levi1992_asymmetry.json`

```json
{
    "source": "Toet & Levi (1992), Vision Research 32(7), 1349-1357",
    "note": "Radial:tangential critical spacing ratio at various eccentricities",
    "data": [
        { "eccentricity_deg": 2.5, "radial_tangential_ratio": 2.1 },
        { "eccentricity_deg": 5,   "radial_tangential_ratio": 2.0 },
        { "eccentricity_deg": 10,  "radial_tangential_ratio": 1.8 }
    ]
}
```

### `tests/validation/published-data/pelli_tillman2008_crowding.json`

```json
{
    "source": "Pelli & Tillman (2008), Nature Neuroscience 11(10), 1129-1135",
    "note": "Uncrowded window: critical spacing proportional to eccentricity, independent of target size",
    "data": [
        { "eccentricity_deg": 0, "critical_spacing_deg": 0.2, "note": "foveal floor" },
        { "eccentricity_deg": 4, "critical_spacing_deg": 1.6 },
        { "eccentricity_deg": 8, "critical_spacing_deg": 3.6 },
        { "eccentricity_deg": 12, "critical_spacing_deg": 5.4 }
    ]
}
```

## 5. Validation Tiers

### Tier 1: Must Pass

1. **Crowding ratio < 0.8 at 6° and 10°**: Crowded targets show measurably more degradation than isolated targets at the same eccentricity.
2. **Proportional MIP scaling**: The ratio `pooling_diameter / eccentricity` stays within 0.5x-2.0x of a constant across the 2-15° range (i.e., pooling grows linearly, not quadratically or sub-linearly).
3. **Polar sector radial > tangential**: Sector radial extent exceeds tangential extent by at least 1.5:1 at all measured eccentricities.

### Tier 2: Should Pass

4. **Bouma ratio within 3x**: Effective pooling diameter is within 0.15-1.5x of Bouma's 0.5*e at each measured eccentricity. (We expect to be smaller than Bouma because MIP pooling is one of several crowding mechanisms, not the sole one.)
5. **Density gate separation**: The crowding ratio at 10° (where density difference matters most) is at least 0.15 lower than at 3° (where crowding is mild regardless of density).
6. **Radial-tangential asymmetry 1.5:1 to 2.5:1**: Measured across polar sector geometry, consistent with Toet & Levi's ~2:1 finding.

### Tier 3: Stretch

7. **Pelli & Tillman size independence**: Crowding ratio is similar across the three font-size columns (16/28/48px) at matched eccentricity — crowding depends on spacing, not target size.
8. **Stimulus-specific crowding**: Using `crowding-stimulus.html`, same-orientation Gabor flankers produce stronger crowding than orthogonal flankers at matched spacing and eccentricity.
9. **Bouma transition sharpness**: Using `crowding-spacing.html`, the crowding ratio vs spacing curve shows a sigmoid-like transition centered near 0.5x eccentricity.

## 6. Capture Matrix

| Reference Page | Fixation | Conditions | Screenshots |
|---------------|----------|------------|-------------|
| `crowding.html` | center (dot 1) | filtered + baseline | 2 |
| `crowding.html` | crowded row (dot 2) | filtered + baseline | 2 |
| `crowding.html` | corner (dot 3) | filtered + baseline | 2 |
| `crowding.html` | isolated row (dot 4) | filtered + baseline | 2 |
| `crowding-stimulus.html` | center (dot 1) | filtered + baseline | 2 |
| `crowding-radial.html` (new) | center | filtered + baseline | 2 |
| `crowding-spacing.html` (new) | center | filtered + baseline | 2 |

**Total**: 14 screenshots (7 conditions x 2 filtered/baseline)

Plus analytical scripts that need no screenshots (geometry validation).

## 7. Implementation Plan

| File | Action | Est. Lines |
|------|--------|-----------|
| `tests/reference-pages/crowding-radial.html` | Create — radial vs tangential flanking stimulus | ~200 |
| `tests/reference-pages/crowding-spacing.html` | Create — parametric Bouma spacing stimulus | ~180 |
| `scripts/analyze-crowding.js` | Create — pixel-level crowding ratio from screenshots | ~200 |
| `scripts/analyze-crowding-geometry.js` | Create — pooling region size vs Bouma comparison | ~150 |
| `scripts/analyze-polar-sectors.js` | Create — sector geometry extraction and validation | ~120 |
| `scripts/validate-crowding.js` | Create — comparison orchestrator (tiers 1-3) | ~180 |
| `scripts/report-crowding.js` | Create — HTML report with tables and diagrams | ~150 |
| `tests/validation/published-data/bouma1970_critical_spacing.json` | Create | ~15 |
| `tests/validation/published-data/toet_levi1992_asymmetry.json` | Create | ~10 |
| `tests/validation/published-data/pelli_tillman2008_crowding.json` | Create | ~10 |

## 8. Key Numerical Anchors

These are the specific numbers the validation will test against, derived from the shader code:

### MIP Pooling (CMF path, default params: cmf_a=2.78, ecc_scaling=0.75)

| Eccentricity (deg) | normalizedEcc | r_deg | cortical_dist | mipLevel | Pooling (px) | Bouma (px@45ppd) | Ratio |
|----|----|----|----|----|----|----|----|
| 2 | 1.0 | 2.0 | 0.56 | ~1.3 | 2.5 | 45 | 0.055 |
| 4 | 2.0 | 4.0 | 0.93 | ~2.2 | 4.6 | 90 | 0.051 |
| 6 | 3.0 | 6.0 | 1.17 | ~2.7 | 6.5 | 135 | 0.048 |
| 10 | 5.0 | 10.0 | 1.46 | ~3.4 | 10.6 | 225 | 0.047 |
| 15 | 7.5 | 15.0 | 1.68 | ~3.9 | 14.9 | 338 | 0.044 |

The MIP pooling diameter is ~5% of Bouma critical spacing. This is expected — MIP pooling handles the frequency-domain averaging (what survives), not the spatial extent of interference (what crowds). The spatial extent of crowding is modeled by V1 Lateral Smash displacement, which operates at a larger scale.

### Polar Sectors (ef=1.007, bias=2.0)

Ring width at distance r: `r * (1.007^2.0 - 1) = r * 0.014`

| Distance (norm) | Ring Width (norm) | Ring Width (deg, @45ppd/90px fovea) | Bouma (deg) | Sectors per Bouma |
|----|----|----|----|
| parafovea (0.167) | 0.00234 | 0.047 | 1.0 | ~21 |
| 6° (0.333) | 0.00467 | 0.093 | 3.0 | ~32 |
| 10° (0.556) | 0.00778 | 0.156 | 5.0 | ~32 |

Polar sectors are much finer than Bouma zones (~30 sectors per critical spacing). This is by design — the sectors track CMF block sizes for rendering fidelity, not crowding zones. The density gate and V1 distortion amplitude handle the crowding spatial extent.

### V1 Lateral Smash (the actual crowding displacement)

The V1 distortion amplitude (warp in UV space) scales with:
```
strength = lgn.suppressionFactor * v1_strength_mult * eccentricityScale * crowdingFactor
```

Where `eccentricityScale = smoothstep(fovea_radius, parafovea_radius, dist)` and the warp amplitude is `strength * noise * warpAmplitude`. The effective displacement in pixels needs to be measured empirically from screenshots — this is what `analyze-crowding.js` does.

## 9. Success Criteria

- **Ship-blocking**: Tier 1 all pass (crowding differentiation, proportional scaling, radial > tangential)
- **Confidence**: Tier 2 majority pass (Bouma ratio range, density gate effect, asymmetry magnitude)
- **Publication-quality**: Tier 3 pass (size independence, stimulus specificity, transition sharpness)

## 10. Relationship to Existing Crowding Work

The density-gated crowding spec (`density_gated_crowding.md`) established the mechanism. This wave validates the *geometry* — whether the spatial extent and shape of Scrutinizer's crowding zones match published psychophysics. The two are complementary:

- Density gating (v1.9.1): **what** gets crowded (dense vs sparse) — qualitative
- Wave 3 (this spec): **where** crowding happens (spatial extent, shape, scaling) — quantitative

## References

- Bouma, H. (1970). Interaction effects in parafoveal letter recognition. *Nature*, 226, 177-178.
- Pelli, D. G., & Tillman, K. A. (2008). The uncrowded window of object recognition. *Nature Neuroscience*, 11(10), 1129-1135.
- Pelli, D. G., Palomares, M., & Majaj, N. J. (2004). Crowding is unlike ordinary masking: Distinguishing feature integration from detection. *Journal of Vision*, 4(12):12.
- Rosenholtz, R., Huang, J., Raj, A., Balas, B. J., & Ilie, L. (2012). A summary statistic representation in peripheral vision explains visual search. *Journal of Vision*, 12(4):14.
- Toet, A., & Levi, D. M. (1992). The two-dimensional shape of spatial interaction zones in the parafovea. *Vision Research*, 32(7), 1349-1357.
- Freeman, J., & Simoncelli, E. P. (2011). Metamers of the ventral stream. *Nature Neuroscience*, 14(9), 1195-1201.
- Levi, D. M. (2008). Crowding — An essential bottleneck for object recognition: A mini-review. *Vision Research*, 48(5), 635-654.
- Whitney, D., & Levi, D. M. (2011). Visual crowding: A fundamental limit on conscious perception and object recognition. *Trends in Cognitive Sciences*, 15(4), 160-168.
