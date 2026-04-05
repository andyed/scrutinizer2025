# Eccentricity-Weighted Congestion & Resolution-Gated Saliency

> **Status:** Shipped (v2.7.1)
> **Date:** 2026-03-22
> **Addresses:** Simulation limitation #1 (crowding not density-dependent) and peripheral saliency over-protection.

## Motivation

Scrutinizer's congestion and saliency pipelines computed uniformly — same resolution, same parameters at every eccentricity. But clutter impact and feature detectability are eccentricity-dependent:

- **Congestion:** A cluttered sidebar at 15° is irrelevant because the visual system can't resolve the features that make it cluttered. Fine-grained Feature Congestion (σ=2.5) overestimates peripheral clutter.
- **Saliency:** A salient icon at 15° can't drive a saccade if it's below the cortical resolution floor. Uniform saliency over-protects far-peripheral content from degradation.

The v2.6 isotropic cortical sectors provide the geometry. These features add eccentricity-awareness to the two pipelines that evaluate *what matters* at each location.

## Resolution-Gated Saliency

### Mechanism

Acuity decay applied in the shader (not the worker — acuity is a viewing-geometry property, not an image property):

```glsl
acuity(ecc) = 1 / (1 + ecc / E2)
signal.saliency = salTex.r * acuity
```

E2 = 8.0° (half-sensitivity eccentricity). Strasburger, Rentschler & Jüttner (2011) report E2 from 2° (Vernier) to 10° (letter acuity) — 8° is within the biological range for feature detection. Initial value of 6.0 caused blue scatter artifacts by removing too much saliency protection in the far periphery.

### Saliency-aware scramble zone

The scramble zone override (V1 displacement) now gates on saliency instead of forcing full displacement:
```glsl
signal.distortionStrength = mix(strength, 1.0, 1.0 - lgn.saliency);
```
High-saliency content (product images, faces) retains protection even in the scramble zone. `lgn.saliency` already includes acuity gating, so protection naturally weakens with eccentricity.

### Acuity profile (E2=8.0)

| Eccentricity | Acuity | Saliency retained |
|-------------|--------|-------------------|
| 2° | 0.80 | 80% |
| 4° | 0.67 | 67% |
| 8° | 0.50 | 50% |
| 15° | 0.35 | 35% |

Parafoveal search preserved. Far-peripheral over-protection eliminated without blue scatter artifacts.

### Uniform

`u_saliency_acuity_e2` (float, default 8.0). Set to 999.0 to effectively disable.

## Eccentricity-Weighted Congestion

### Mechanism

The congestion worker now computes Feature Congestion at two scales:

1. **Foveal** (existing): up to 1024px, σ=2.5 → R channel
2. **Peripheral** (new): 128px, σ=5.0 → B channel

The shader blends between them based on eccentricity:

```glsl
t = smoothstep(3.0, 8.0, ecc_deg)
congestion = mix(fovealCong, periphCong, t)
```

The congestion pooling gate now uses 50/50 blend of Bouma-scaled edge density and eccentricity-weighted congestion:

```glsl
congestionBoost = 1.0 + (boumaEdge * 0.5 + eccCong * 0.5)
```

### Texture packing

| Channel | Content | Resolution | σ |
|---------|---------|-----------|---|
| R | Foveal congestion | 512-1024px | 2.5 |
| G | Edge density (unchanged) | 512-1024px | 3.0 |
| B | Peripheral congestion | 128px (upscaled) | 5.0 |
| A | 255 (opaque) | — | — |

### Safety properties

- R channel unchanged → Rosenholtz benchmark (ρ=0.93) unaffected
- G channel unchanged → `sampleBoumaEdgeDensity()` reads `.g` only
- B channel was 0 → no existing code regression

## Files modified

| File | Change |
|------|--------|
| `renderer/shaders/peripheral.frag` | `u_saliency_acuity_e2` uniform, acuity decay in processLGN, `sampleEccentricityCongestion()`, modified congestion pooling gate |
| `renderer/webgl-renderer.js` | Uniform location + setting + config default |
| `renderer/congestion-worker.js` | Peripheral pass (128px, σ=5.0), B channel packing |

## Validation

1. `npm run validate-congestion` — Spearman ρ ≥ 0.93 (R channel regression)
2. Worker `computeTimeMs` < 120ms (baseline ~80ms)
3. Toggle E2: 6.0 vs 999.0 to visualize saliency gating effect
4. `npm run capture-smoke` — no visual regressions
5. Debug overlay (`u_show_congestion=1`): B channel shows smoother, broader congestion than R

## References

- Rosenholtz, R., Li, Y., & Nakano, L. (2007). Measuring visual clutter. *JOV*, 7(2):17.
- Strasburger, H., Rentschler, I., & Jüttner, M. (2011). Peripheral vision and pattern recognition. *JOV*, 11(5):13.
- Pelli, D. G. & Tillman, K. A. (2008). The uncrowded window of object recognition. *Nature Neuroscience*, 11(10):1129-1135.
- Bowers, N. R. et al. (2025). Suprathreshold chromatic sensitivity across eccentricity.
