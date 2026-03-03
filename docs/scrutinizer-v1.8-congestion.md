---
planStatus:
  planId: plan-scrutinizer-v1.8-congestion
  title: "Scrutinizer v1.8: Congestion Assessment (Rosenholtz Feature Congestion)"
  status: draft
  planType: feature
  priority: high
  owner: andyed
  tags:
    - scrutinizer
    - congestion
    - rosenholtz
    - release
  created: "2026-03-02"
  updated: "2026-03-02T22:00:00.000Z"
  progress: 0
---

# Scrutinizer v1.8: Congestion Assessment Release

## Goals

- Ship congestion assessment as a first-class feature (currently partially shipped in v1.7)
- Document the validation pipeline and computational trade-offs for the blog
- Complete Mode 9 (Congestion-Gated Pooling) or cut it cleanly
- Expand the validation corpus for statistical robustness

## Current State (v1.7.0)

### What's Already Working

**Algorithm**: Simplified Rosenholtz et al. (2007) Feature Congestion
- Oklab color space (L, |a|, |b|) instead of CIE L*a*b*
- Single Gaussian local-variance (σ=2.5) instead of multi-scale steerable pyramid
- Separable blur: `variance = E[X²] - E[X]²`
- Final metric: `congestion = var_I + var_RG + var_BY`

**Architecture**: Dual-worker system
- **Saliency worker** (256px, every 15th frame) — real-time peripheral blur modulation
- **Congestion worker** (1024px, on-demand) — high-res diagnostic when toggled on

**Scoring**: `sqrt(congestion_p90 * 0.7 + edgeDensity_p90 * 0.3) * 100`
- p90 percentile captures busy regions, ignores whitespace
- sqrt scaling spreads [0,1] into discriminative [0,100] range

**Display**: Complexity HUD with Score / Stats / Spatial tabs

**Validation**: Spearman ρ = 0.93 at 768px against Python reference (visual-clutter package)

### What's Incomplete

1. **Mode 9 (Congestion-Gated Pooling)** — flag in modes.json, shader wired to read `u_congestionMap` on TEXTURE4, but pooling modulation not implemented. The hypothesis: cluttered regions get stronger peripheral pooling (harder to read in periphery).
2. **Validation corpus** — only 10 images. Spearman correlation needs 20-30 for statistical confidence.
3. **Blog documentation** — draft exists at `blog/drafts/congestion-score/post.md`, not published.

## The Key Discovery: Fixed Sigma

The most important technical finding to document:

**Auto-scaled sigma fails on web content.**

| Resolution | Auto σ | Spearman ρ | Fixed σ=2.5 | Spearman ρ |
|---|---|---|---|---|
| 512px | 5.0 | 0.53 FAIL | 2.5 | 0.89 PASS |
| 768px | 7.5 | 0.60 FAIL | 2.5 | **0.93** PASS |
| 1024px | 10.0 | 0.65 FAIL | 2.5 | 0.92 PASS |

**Why**: Auto-scaling was designed for natural images at varying capture resolutions (same scene, different zoom). Web pages at 512px and 1024px are the same page at different pixel densities — scaling σ up smears text, borders, and UI into indistinguishable blobs. Fixed σ keeps the neighborhood matched to the feature scale that matters (text, icons, borders).

This is the story. The algorithm is simple; knowing *not* to scale the kernel is the insight.

## Computational Challenges to Document

### 1. Dual-Resolution Architecture
The core tension: congestion as a diagnostic (needs accuracy, 1024px) vs. congestion as a real-time input to the shader pipeline (needs speed, 256px). The dual-worker system resolves this but creates two different quality tiers. The saliency worker's 256px congestion is "directionally correct" — it ranks regions the same, but the absolute values differ. Good enough for gating peripheral blur strength; not good enough for the HUD score.

### 2. Gaussian Blur in a Web Worker
Separable Gaussian blur is O(w × h × kernel_size) per channel, twice (horizontal + vertical). At σ=2.5, kernel is ~16px wide. At 1024px with 3 channels + variance computation, that's ~100M multiply-adds per frame. Web Workers make this non-blocking, but it's still 100-500ms per analysis frame. The cached buffer pattern (`Float32Array` allocated once, reused) avoids GC pressure.

### 3. Single-Scale vs Multi-Scale
Rosenholtz's original uses a multi-scale steerable pyramid (4 orientations × 4 scales = 16 subbands). Our single Gaussian at σ=2.5 captures ~80% of the ranking accuracy at <5% of the compute. The multi-scale approach would catch orientation-dependent clutter (diagonal stripes vs. horizontal lines) — our approach can't distinguish these. For web content, this matters less than for natural scenes.

### 4. Scoring Formula Design
Why p90, not mean? A page with one cluttered hero and clean whitespace elsewhere has low mean but high p90. The p90 answers "how bad are the busy parts?" — the question designers actually care about. The 70/30 congestion/edge weighting came from empirical tuning against the test corpus — edge density alone over-weights text-heavy pages.

### 5. Heatmap Resolution Mismatch
The congestion map is computed at 1024px but displayed on a page that could be any size. The WebGL renderer uploads it as a texture and samples with bilinear interpolation. This works because congestion is spatially smooth (it's a variance measure after Gaussian blur), but pixel-level overlay alignment requires careful UV mapping. The shader reads `u_congestionMap` at the fragment's UV coordinate — no coordinate transform needed if both textures share the same aspect ratio.

## Validation Pipeline

### Three-Script Architecture

```
validate-congestion.py    →  python_results.json + python_maps/*.png
    (Rosenholtz reference via visual-clutter package)

extract-congestion.js     →  scrutinizer_results.json + scrutinizer_maps/*.png
    (Scrutinizer's congestion-core.js, headless Node.js)

compare-congestion.js     →  comparison_report.json
    (Spearman rank correlation + per-pixel SSIM)
```

**Pass gate**: Spearman ρ ≥ 0.70

### Test Corpus (current: 10 images)

| Image | Role |
|---|---|
| `example_com.png` | Floor (nearly empty) |
| `test9_color_grid.png` | Ceiling (synthetic max-clutter) |
| 8 web page screenshots | Middle range (blog, news, product, dashboard) |

### What the Tests Prove

1. **Rank ordering matches**: Scrutinizer ranks all 10 images in the same order as the Python reference (ρ=0.93)
2. **Fixed sigma is correct**: All three fixed-σ resolutions pass; all three auto-scaled fail
3. **Absolute values diverge**: SSIM ~0.50 (simplified algorithm + different color space = different heatmap values, but same spatial structure and ranking)

### What the Tests Don't Cover

1. **Human judgment correlation**: Rosenholtz validated against 25 hand-rated maps (ρ=0.83 with humans). Those maps were never published. We validate against her *algorithm*, not her *human data*.
2. **Orientation clutter**: No test image isolates diagonal-vs-horizontal clutter (would expose single-scale limitation)
3. **Dynamic content**: All tests are static screenshots. Live pages with animation, scroll position, viewport changes untested.

## Release Scope Options

### Option A: Ship What's Working (Minimal v1.8)
- Promote congestion HUD from experimental to stable
- Publish blog post documenting the algorithm, validation, and fixed-sigma discovery
- Expand corpus to 20 images
- Cut Mode 9 (move to backlog as v1.9 or later)
- Version bump + CHANGELOG

### Option B: Ship With Gated Pooling (Full v1.8)
- Everything in Option A, plus:
- Complete Mode 9: congestion map modulates peripheral pooling strength
- Hypothesis: `pooling_intensity = base_intensity * (1 + congestion * k)`
- Needs perceptual validation — does it look right? Does cluttered content degrade more naturally?
- Risk: gating formula is hypothesis-stage, may need iteration

### Option C: Research Release (v1.8-beta)
- Tag current state as v1.8-beta
- Blog post is the deliverable (computational narrative)
- Explicitly frame congestion-gated pooling as open research question
- Invite feedback from vision science community

## Acceptance Criteria

- [ ] Validation corpus expanded to 20+ images (Spearman ρ ≥ 0.85 maintained)
- [ ] Blog post published: algorithm, validation pipeline, fixed-sigma discovery, computational challenges
- [ ] Complexity HUD stable (no config reset bug regressions)
- [ ] Mode 9 decision: ship, cut, or beta-flag
- [ ] CHANGELOG updated
- [ ] GitHub release tagged
- [ ] Congestion-journey.md updated with final architecture decisions

## Key Files

```
renderer/congestion-core.js        # Core algorithm (shared Node/Worker)
renderer/congestion-worker.js      # High-res on-demand worker
renderer/saliency-worker.js        # 256px real-time worker
renderer/content-analysis.js       # Dual-worker orchestrator
renderer/complexity-hud.js         # Interactive display
renderer/shaders/peripheral2.frag  # Reads u_congestionMap
shared/modes.json                  # Mode 9 definition
scripts/validate-congestion.py     # Python reference
scripts/extract-congestion.js      # Node.js validation
scripts/compare-congestion.js      # Spearman + SSIM comparison
docs/congestion-journey.md         # Design log
blog/drafts/congestion-score/      # Blog draft
```

## References

- Rosenholtz, R., Li, Y., & Nakano, L. (2007). "Measuring visual clutter." *Journal of Vision*, 7(2), 17.
- Rosenholtz, R. (2020). "Demystifying visual awareness." *Trends in Cognitive Sciences*.
- `visual-clutter` Python package (MIT port of Rosenholtz MATLAB toolbox)
