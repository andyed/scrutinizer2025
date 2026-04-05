# Scrutinizer v1.8.0 Release Notes

**Release Date:** March 3, 2026

## Overview: Scientific Accuracy Audit + Feature Congestion

This release has two themes. First, a **scientific accuracy audit** tightening the biology behind the DoG band decomposition — replacing geometric cutoffs with linear M-scaling, recalibrating E2, and qualifying the "Laplacian pyramid" terminology across all documentation and shader comments. Second, **Feature Congestion** (Rosenholtz et al. 2007) lands as a new analytical capability: a dual-worker pipeline that computes visual clutter scores in real-time, displayed through an interactive ComplexityHUD overlay.

---

## 🔬 Scientific Accuracy Audit

### Linear M-Scaling (Rovamo & Virsu 1979)

The v1.6 DoG band cutoffs used a geometric 2x series (0.3, 0.6, 1.2, 2.4 × E2), which over-predicts resolution loss near fixation. Biological M-scaling predicts linear growth of minimum resolvable detail with eccentricity:

```
s_min(e) = s_0 × (1 + e/E2)  — Rovamo & Virsu 1979
```

New cutoffs derived from M-scaling: `E2 × (2^k − 1)`, giving **1, 3, 7, 15 × E2**. The perceptual effect: coarse structure (bands 2–3) now persists far into the periphery — you see *where* a button is but can't read its label. Fine detail (band 0) drops at the same rate as before.

### E2 Recalibration

E2 values were recalibrated to preserve the band-0 onset point under the new linear cutoff formula:

| Mode | Old E2 | New E2 |
| --- | --- | --- |
| High-Key (0) | 0.5 | 0.15 |
| Biological (1) | 0.4 | 0.12 |

### Approximate Laplacian Pyramid

Hardware MIP levels use box/bilinear downsampling, not Gaussian convolution. Every doc, shader comment, and paper reference that said "Laplacian pyramid" without qualification now says **"approximate Laplacian pyramid"** and notes the distinction. Band differences are Difference-of-Boxes with spectral leakage, not true Difference-of-Gaussians as in Burt & Adelson (1983). Added Burt & Adelson 1983 to `references.bib`.

### Output Clamping

Final color output is now clamped to [0,1] to prevent negative-going band artifacts from the DoG subtraction reaching the framebuffer.

---

## 📊 Feature Congestion Pipeline (Rosenholtz 2007)

### Algorithm

Simplified Rosenholtz et al. (2007) Feature Congestion computed in Oklab color space: local variance across L (lightness), |a| (red-green), and |b| (yellow-blue) channels using separable Gaussian blur. Combined with Sobel edge density for a composite complexity score.

**Fixed σ=2.5** — the key discovery. Auto-scaling σ with resolution (the standard approach for natural images) fails on web content because web pages at different resolutions are the same layout at different pixel densities, not the same scene at different zoom levels. Scaling σ up smears text, borders, and UI into indistinguishable blobs. Fixed σ keeps the neighborhood matched to the feature scale that matters.

| Resolution | Auto σ | Spearman ρ | Fixed σ=2.5 | Spearman ρ |
|---|---|---|---|---|
| 512px | 5.0 | 0.53 FAIL | 2.5 | 0.89 PASS |
| 768px | 7.5 | 0.60 FAIL | 2.5 | **0.93** PASS |
| 1024px | 10.0 | 0.65 FAIL | 2.5 | 0.92 PASS |

### Dual-Worker Architecture

| Worker | Resolution | Trigger | Purpose |
| --- | --- | --- | --- |
| Saliency worker | 256px | Every 15th frame | Real-time peripheral blur modulation |
| Congestion worker | 1024px | On-demand (menu toggle) | High-res diagnostics for the HUD |

The saliency map texture is now RGB-packed: R=saliency, G=congestion, B=edge density.

### Scoring Formula

```
score = sqrt(congestion_p90 × 0.7 + edgeDensity_p90 × 0.3) × 100
```

- **p90 percentile** captures the busy regions, ignores whitespace. A page with one cluttered hero and clean whitespace elsewhere has low mean but high p90 — the p90 answers "how bad are the busy parts?"
- **sqrt scaling** spreads [0,1] into a discriminative [0,100] range
- **70/30 weighting** — empirically tuned against test corpus; edge density alone over-weights text-heavy pages

### Validation

Three-script pipeline against Rosenholtz's reference implementation:
- `validate-congestion.py` — Python extraction via `visual-clutter` package
- `extract-congestion.js` — Scrutinizer's `congestion-core.js` in headless Node.js
- `compare-congestion.js` — Spearman rank correlation + per-pixel SSIM

**Result:** Spearman ρ = 0.93 at 768px. All fixed-σ resolutions pass (ρ ≥ 0.85). All auto-scaled resolutions fail.

---

## 🖥️ ComplexityHUD

Interactive draggable overlay panel replacing the toolbar URL-bar approach:

- **Score tab** — live congestion score with color-coded badge
- **Stats tab** — p50/p75/p90 breakdowns for congestion and edge density
- **Spatial tab** — congestion heatmap overlay on TEXTURE4 (blue → yellow → red)

Scroll and navigation-aware: heatmap hides immediately on scroll/nav to prevent stale overlay, restores when fresh worker results arrive. Amber throbber on the eye icon during congestion processing.

Entry detection uses the `browser:mousemove` IPC stream (reliable when the overlay window is in click-through mode on macOS); exit via DOM `mouseleave`.

---

## 🧪 Mode 9: Congestion-Gated Pooling

New mode that modulates peripheral pooling by local visual clutter. The shader multiplies `coupledEccentricity` by `1.0 + lgn.congestion` when active — high-congestion regions get up to 2× the MIP pooling level, making cluttered periphery degrade faster than sparse regions.

Selecting mode 9 auto-starts the high-res congestion worker (no need to enable the ComplexityHUD overlay separately). Congestion data recomputes on scroll and navigation, same as the HUD pipeline.

This tests Rosenholtz's (2012) prediction that visual clutter and crowding are manifestations of the same summary-statistic computation. On a cluttered news page, dense text columns and image-heavy sidebars pool more aggressively in the periphery than clean whitespace — matching the degraded feature access that occurs when peripheral receptive fields pool over diverse, competing features.

Tagged as `experimental` — the pipeline is functional, perceptual validation is ongoing.

---

## 🔧 Parafoveal Blur Band Fix

The removal of the parafoveal saturation boost (`mix(vec3(luma), col, 1.2)`) exposed a dead zone in the V1 displacement path. Two compounding issues:

1. **Flat eccentricityScale in the parafovea**: Every pixel between fovea_radius and 2.5× fovea_radius received `eccentricityScale = 0.15` — a flat 15% of full displacement. Noise mode's 800-cycle simplex noise at that strength produces 1–5px of nearly-random per-pixel jitter, indistinguishable from gaussian blur. Rayner (1998) establishes that parafoveal processing enables word-length perception and saccade planning — blurring those cues is biologically wrong.

2. **Abrupt fovea-to-pooled blend**: The MIP-pooled color blend completed within 10% of fovea radius (~15px), creating a visible step from sharp to soft.

**Fix:**
- `eccentricityScale` now ramps from **0.0** in the inner parafovea (fovea edge → 1.5× fovea_radius) to **0.15** at the outer parafovea boundary, via `smoothstep`. Inner parafovea stays sharp; distortion onset is gradual and intentional.
- MIP pooling blend widened from `fovea_radius × 0.1` (~15px) to `fovea_radius × 0.5` (~75px), retaining more of the sharp foveal sample through the inner parafovea.

---

## 🧹 Housekeeping

- **Golden captures** (348MB accumulated across v1.2.0–v1.6.0) removed from git tracking and gitignored. Curated mode-comparison captures live in `docs/golden/` instead.
- **.claude config** checked in: `settings.json` (permission allow-list), `skills/release/SKILL.md` (release workflow), `agent-memory/vision-scientist/` (DoG review findings, shader verification notes).

---

## What's Next

- **Per-channel chromatic pooling** — Peripheral color is pooled, not lost (Rosenholtz TTM): large colored regions preserve mean chromaticity far into the periphery, while small chromatic features lose color identity. The DoG bands already separate content by spatial scale — per-band RG/YV attenuation models both size-dependent preservation and the differential channel rates (RG foveal specialization fades ~2.5× faster than YV). Spec: `docs/specs/implemented/chromatic_pooling.md`. Key references: castleCSF (Ashraf et al. 2024), Jiang, Shooner & Mullen (2022), Abramov et al. (1991).
- **Oriented DoG bands (Oblique Effect)** — Cardinal (H/V) edges get M-scaling cutoffs pushed ~50% further, modeling the 30–50% acuity advantage for horizontal and vertical edges over oblique ones (Appelle 1972). Spec: `docs/specs/implemented/oriented_dog_bands.md`
- **Validation corpus expansion** — Current corpus is 10 images. Expanding to 20+ for statistical confidence in the Spearman correlation.

---

## Files Changed

| Area | Files |
| --- | --- |
| **M-Scaling** | `renderer/shaders/peripheral.frag`, `shared/modes.json`, `docs/foveated-vision-model.md` |
| **Laplacian Qualification** | `docs/arxiv-paper/scrutinizer-system-paper.tex`, `docs/arxiv-paper/references.bib`, `docs/foveated-vision-model.md`, `docs/developers_guide.md`, `docs/release_notes_v1.6.0.md`, `CHANGELOG.md`, `ROADMAP.md`, `renderer/shaders/peripheral.frag` |
| **Congestion Pipeline** | `renderer/congestion-core.js`, `renderer/congestion-worker.js`, `renderer/saliency-worker.js`, `renderer/content-analysis.js`, `renderer/shaders/peripheral.frag`, `renderer/webgl-renderer.js` |
| **ComplexityHUD** | `renderer/complexity-hud.js`, `renderer/overlay.html`, `renderer/overlay.js`, `renderer/scrutinizer.js`, `renderer/toolbar.js`, `renderer/styles.css`, `main.js` |
| **Mode 9** | `shared/modes.json`, `menu-template.js` |
| **Validation** | `scripts/validate-congestion.py`, `scripts/extract-congestion.js`, `scripts/compare-congestion.js`, `package.json`, `pyproject.toml` |
| **Golden Captures** | `.gitignore`, `docs/golden/mode-comparison/` |
| **Documentation** | `docs/congestion-journey.md`, `docs/scrutinizer-v1.8-congestion.md` |
| **Config** | `.claude/settings.json`, `.claude/skills/release/SKILL.md`, `.claude/agent-memory/` |
