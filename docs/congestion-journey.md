# Feature Congestion: Implementation Journey

*From Rosenholtz's 2007 paper to a real-time web complexity meter.*

---

## The Goal

Implement Feature Congestion (Rosenholtz, Li & Nakano, 2007) as a quantitative page-complexity signal in Scrutinizer. Feature Congestion measures visual clutter as the local variance of low-level visual features — where the brain's pre-attentive channels are all screaming at once, that's clutter. The original paper showed Spearman ρ=0.83 between the FC scalar and human clutter ratings across 25 natural scenes.

Scrutinizer uses this signal two ways:
1. **Pooling modifier** — the existing saliency pipeline uses a congestion channel to modulate MIP sampling (peripheral blur). Higher congestion = more aggressive simplification.
2. **Complexity report** — a toggleable HUD overlay showing per-page complexity scores, heatmap, and spatial breakdown.

---

## The Algorithm

Rosenholtz's original uses steerable pyramids across CIE L\*a\*b\*, computing covariance ellipsoid volume across channels. Scrutinizer implements a simplified version:

| Original (Rosenholtz 2007) | Scrutinizer Simplification |
|---|---|
| CIE L\*a\*b\* color space | Oklab (perceptually uniform, cheaper) |
| Multi-scale steerable pyramid | Single Gaussian local-variance (σ=2.5 at 256px) |
| Covariance ellipsoid volume | Sum of per-channel variance |
| 3 contrast levels × orientation bands | Single separable Gaussian blur |

The core math lives in `renderer/congestion-core.js`, extracted as a shared module so both the real-time Web Worker and headless Node.js validation scripts run the exact same code path.

**Pipeline:**
```
Input image → sRGB→linear→Oklab (L, |a|, |b|)
  → per-channel Gaussian blur (σ)
  → per-channel local variance = blur(x²) - blur(x)²
  → congestion = L_var + a_var + b_var
  → normalize to [0, 1]
```

The sigma scales proportionally with resolution: σ = baseSigma × (imageDim / baseDim), where baseSigma=2.5 at baseDim=256px. This keeps the spatial neighborhood physically consistent across resolutions.

---

## Validation Framework

Three scripts form a self-contained validation pipeline:

| Script | Role |
|---|---|
| `scripts/validate-congestion.py` | Python reference using `visual-clutter` package (faithful port of Rosenholtz MATLAB toolbox) |
| `scripts/extract-congestion.js` | Headless Node.js running Scrutinizer's `congestion-core.js` against the same images |
| `scripts/compare-congestion.js` | Spearman rank correlation + per-pixel SSIM between the two |

**Pass gate:** Spearman ρ ≥ 0.70 (ranks the same images in the same order as the reference implementation).

**Test corpus:** 10 images spanning the complexity spectrum:

| Image | Source | Character |
|---|---|---|
| `test.png` | Rosenholtz benchmark (visual-clutter repo) | Natural scene, medium clutter |
| `example_com.png` | Web screenshot | Near-empty page (floor) |
| `hero_product.png` | Web screenshot | Single product hero (low) |
| `product_keyboard.png` | Web screenshot | Product with detail (medium) |
| `product_smartwatch.png` | Web screenshot | Product with UI elements |
| `figma_com.png` | Web screenshot | Design tool landing page |
| `techmeme_com.png` | Web screenshot | Dense text aggregator |
| `blog_mozilla_org.png` | Web screenshot | Blog with mixed media |
| `article_hero.png` | Web screenshot | Article with hero image |
| `test9_color_grid.png` | Synthetic | Dense color grid (ceiling) |

---

## Resolution Sweep

The first major discovery: **sigma scaling matters more than resolution.**

Initial validation used auto-scaled sigma (σ = 2.5 × maxDim/256), which seemed reasonable — keep the spatial neighborhood proportional. The results were discouraging:

| Resolution | σ (auto-scaled) | Spearman ρ | Pass? |
|---|---|---|---|
| 256px | 2.5 | 0.6848 | fail |
| 512px | 5.0 | 0.5273 | fail |
| 768px | 7.5 | 0.6000 | fail |
| 1024px | 10.0 | 0.6485 | fail |
| Full (native) | varies | 0.7212 | PASS |

Only full-resolution barely passed. 512px was the *worst* — the auto-scaled σ=5.0 smeared page structure into mush.

### The Fix: Fixed σ=2.5

Re-running with fixed σ=2.5 regardless of resolution:

| Resolution | σ=2.5 fixed | vs auto-scaled |
|---|---|---|
| 512px | **ρ=0.8909** | was 0.5273 |
| 768px | **ρ=0.9273** | was 0.6000 |
| 1024px | **ρ=0.9152** | was 0.6485 |

All three pass comfortably. 768px with fixed σ=2.5 achieves ρ=0.93 — near-perfect rank agreement with the Python reference implementation.

### Why Auto-Scaling Fails for Web Content

The formula `σ = baseSigma × (maxDim / baseDim)` was designed for natural images at varying capture resolutions: a 1024px photo and a 512px photo of the same scene should produce the same congestion. But web screenshots aren't scaled versions of each other — a 512px capture and a 1024px capture are the same page at different pixel densities. Scaling sigma up with resolution just smears text, borders, and UI elements into indistinguishable blobs.

The `congestion-worker.js` already uses fixed σ=2.5 at all resolutions. The validation confusion arose from `extract-congestion.js` defaulting to auto-scaled sigma.

### Resolution Choice

768px is the sweet spot for rank correlation (ρ=0.93), but the worker defaults to 1024px for the heatmap overlay — more spatial detail visible when inspecting the map, at minimal ρ cost (0.92 vs 0.93). The resolution is runtime-configurable.

---

## Architecture Evolution

### Phase 1: Single Worker (256px)

The initial implementation packed congestion into the existing saliency worker's output texture:

```
capturePage → saliencyWorker (256px) → RGB texture
                                       R = saliency (center-surround)
                                       G = congestion (local variance)
                                       B = edge density (Sobel)
                                     → congestionStats → HUD
```

This was computationally efficient but produced low-quality congestion data. The 256px resolution was chosen for the saliency pipeline's latency budget (every 15th frame, <5ms target), not for congestion accuracy.

### Phase 2: Dedicated Worker (1024px)

The congestion report is a diagnostic tool — users toggle it on to assess page complexity, then toggle it off. Latency is tolerable (100-500ms). This enabled a clean architectural separation:

```
capturePage → saliencyWorker (256px)    → saliency texture (R channel)
                                        → 256px congestion for pooling modifier
           → congestionWorker (1024px)  → congestion texture (R=congestion, G=edgeDensity)
              on-demand, debounced       → high-res congestionStats → HUD
```

**Files introduced/modified:**

| File | Change |
|---|---|
| `renderer/congestion-worker.js` | **New** — Dedicated Web Worker, imports congestion-core.js |
| `renderer/content-analysis.js` | Added congestion worker lifecycle, dual-tier stats tracking |
| `renderer/webgl-renderer.js` | Added `u_congestionMap` texture on TEXTURE4 |
| `renderer/shaders/peripheral2.frag` | Reads from high-res texture when available |
| `renderer/scrutinizer.js` | Toggle flow, trigger-aware resubmission |
| `renderer/complexity-hud.js` | Pending state with spinner, score formula |
| `renderer/preload.js` | Tagged structure-update IPC with trigger type |
| `main.js` | Forwards trigger parameter through IPC |

**Key design decisions:**

1. The 256px congestion stays in the saliency worker for the pooling modifier — it doesn't need to be accurate, just directionally correct.
2. The new worker only runs when the congestion report is toggled on. Zero cost when off.
3. Resolution is runtime-configurable: `scrutinizer.setCongestionResolution(512 | 768 | 1024)`.
4. A generation counter pattern detects fresh async worker results in the synchronous render loop.

---

## Scoring Formula Evolution

### v1: Mean-based (low scores)

```javascript
const compositeScore = Math.round((c.mean * 0.7 + e.mean * 0.3) * 100);
```

**Problem:** Mean congestion is dragged down by whitespace margins, headers, and padding. A text-heavy page like Techmeme would score ~5-15/100 because the empty gutters average away the dense columns.

### v2: P90 + sqrt (current)

```javascript
const compositeScore = Math.round(Math.sqrt(c.p90 * 0.7 + e.p90 * 0.3) * 100);
```

**Rationale:**
- **P90** answers "how cluttered are the busy parts of this page?" — ignores the whitespace floor.
- **Sqrt** spreads the [0, 1] raw range into a more discriminating [0, 100] scale. Without it, most pages cluster between 0.01 and 0.15.
- **70/30 weighting** favors congestion (color variance) over edge density, matching Rosenholtz's finding that color variance is the dominant clutter predictor.

The same formula applies to spatial quadrant scores in the HUD's Spatial tab.

---

## Update Trigger Logic

The congestion worker recomputes on user-relevant events, not continuously:

| Trigger | Behavior | Debounce | HUD opacity |
|---|---|---|---|
| Toggle ON | Immediate submission | — | 1.0 |
| Navigation | Resubmit after page settles | 500ms | 0.35 (pending) |
| Scroll | Full pending, resubmit | 600ms | 0.35 |
| DOM mutation | Gentle pending, current score mostly valid | 5s cooldown | 0.7 |

The trigger type is threaded through a 3-layer IPC chain: `preload.js` tags each `structure-update` as `'scroll'` or `'mutation'`, `main.js` forwards it, and `scrutinizer.js` differentiates the response.

**Why differentiate:** A scroll changes the viewport entirely — the current congestion map is wrong. A DOM mutation (tooltip appearing, accordion expanding) usually doesn't invalidate the overall page score. The 5-second cooldown for mutations prevents the worker from thrashing on pages with continuous DOM activity (chat feeds, live tickers).

---

## Bugs Found Along the Way

### The Config Reset Bug

`webgl-renderer.js`'s `updateConfigFromMode()` runs every frame and does `this.config = { ...defaults }`, which resets `show_congestion` to 0 every frame. The user toggles congestion on → it's immediately turned off on the next frame. Fix: save and restore `show_congestion` across the per-frame config reset.

This was a pre-existing bug exposed by adding the congestion toggle.

### Shader Uninitialized Variable

`float congestion;` declared without initialization in the heatmap overlay section could produce driver-dependent behavior on some GPUs. Changed to `float congestion = 0.0;`.

---

## Open Questions

1. **Original Rosenholtz benchmark.** The 2007 paper validated against 25 printed maps (US and San Francisco Bay Area) rank-ordered by 20 human subjects (ρ=0.83 between FC scalar and human ratings). These maps were never publicly released. Reaching out to Ruth Rosenholtz at MIT CSAIL to obtain them — validating against human ground truth is the gold standard. The MATLAB toolbox is available from [MIT DSpace](http://dspace.mit.edu/handle/1721.1/37593) and the Simoncelli steerable pyramid from [matlabPyrTools](https://github.com/LabForComputationalVision/matlabPyrTools).

2. **Ranking metric: mean vs p90 for validation.** The comparison script ranks images by `mean` congestion (matching Rosenholtz's Minkowski p=1 mean over the clutter map). The HUD uses p90 for display. These are different questions: mean asks "how cluttered is this page overall?", p90 asks "how cluttered are the busy parts?" Both are useful; validation should probably continue using mean for Rosenholtz comparison.

3. **Multi-scale approach.** The simplification from steerable pyramids to a single Gaussian is the largest departure from Rosenholtz. A 2-scale pyramid (σ=2.5 + σ=5.0, combined) might capture both fine detail and broader structure without the computational cost of the full steerable pyramid.

4. **Corpus expansion.** 10 images is statistically thin for Spearman correlation. Expanding to 20-30 web screenshots spanning the full complexity range would make ρ more robust and reduce sensitivity to individual outliers (e.g., `test.png` is consistently the worst-ranked image, and it's the only natural scene in an otherwise all-web corpus).

---

## References

- Rosenholtz, R., Li, Y., & Nakano, L. (2007). Measuring visual clutter. *Journal of Vision*, 7(2), 17. https://doi.org/10.1167/7.2.17
- `visual-clutter` Python package: https://github.com/kargaranamir/visual-clutter
- `congestion-core.js` — shared pure-math module used by both workers and validation scripts
- `saliency_roadmap.md` — broader saliency pipeline history (Phases 1-5)
- `CHANGELOG.md` — release-level feature history

---

## Validation Results Directory

| Directory | σ | ρ | Notes |
|---|---|---|---|
| `results/` | auto (full res) | 0.7212 | Baseline — passes |
| `results-256/` | 2.5 | 0.6848 | Real-time worker resolution |
| `results-512/` | 5.0 auto | 0.5273 | Auto-scaled — worst |
| `results-512-fixed/` | 5.0 auto | 0.5273 | Misnamed — was NOT fixed sigma |
| `results-512-fixed-sigma/` | 2.5 fixed | 0.8909 | First true fixed-sigma test |
| `results-768/` | 7.5 auto | 0.6000 | Auto-scaled |
| `results-768-fixed-sigma/` | 2.5 fixed | 0.9273 | Best rank correlation |
| `results-1024/` | 10.0 auto | 0.6485 | Auto-scaled |
| `results-1024-fixed-sigma/` | 2.5 fixed | 0.9152 | Worker default resolution |

---

*Last updated: 2026-03-03*
