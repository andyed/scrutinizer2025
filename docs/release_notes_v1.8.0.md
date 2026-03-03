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

## 🧪 Mode 9: Congestion-Gated Pooling (Hypothesis)

New mode wired in `modes.json` with `category: "hypothesis"`. The shader reads `u_congestionMap` on TEXTURE4, but pooling modulation is not yet implemented. The hypothesis: cluttered regions should get stronger peripheral pooling — harder to read in periphery when there's more local feature variance.

This tests Rosenholtz's (2012) prediction that visual clutter and crowding are manifestations of the same summary-statistic computation. High-congestion areas would receive increased MIP pooling, simulating the degraded feature access that occurs when peripheral receptive fields pool over diverse, competing features.

Tagged as `hypothesis` to distinguish from the validated modes (0–8).

---

## 🧹 Housekeeping

- **Golden captures** (348MB accumulated across v1.2.0–v1.6.0) removed from git tracking and gitignored. Curated mode-comparison captures live in `docs/golden/` instead.
- **.claude config** checked in: `settings.json` (permission allow-list), `skills/release/SKILL.md` (release workflow), `agent-memory/vision-scientist/` (DoG review findings, shader verification notes).

---

## What's Next

- **Perceptive-field chromatic pooling** — Abramov et al. (1991) showed that peripheral color perception degrades differently than spatial resolution: the perceptive field for color is larger than for luminance, and S-cone signals degrade faster with eccentricity. This would add chromatic-specific pooling radii to the DoG bands.
- **Oriented DoG bands (Oblique Effect)** — Cardinal (H/V) edges get M-scaling cutoffs pushed ~50% further, modeling the 30–50% acuity advantage for horizontal and vertical edges over oblique ones (Appelle 1972). Spec: `docs/specs/oriented_dog_bands.md`
- **Validation corpus expansion** — Current corpus is 10 images. Expanding to 20+ for statistical confidence in the Spearman correlation.

---

## Files Changed

| Area | Files |
| --- | --- |
| **M-Scaling** | `renderer/shaders/peripheral2.frag`, `shared/modes.json`, `docs/foveated-vision-model.md` |
| **Laplacian Qualification** | `docs/arxiv-paper/scrutinizer-system-paper.tex`, `docs/arxiv-paper/references.bib`, `docs/foveated-vision-model.md`, `docs/developers_guide.md`, `docs/release_notes_v1.6.0.md`, `CHANGELOG.md`, `ROADMAP.md`, `renderer/shaders/peripheral2.frag` |
| **Congestion Pipeline** | `renderer/congestion-core.js`, `renderer/congestion-worker.js`, `renderer/saliency-worker.js`, `renderer/content-analysis.js`, `renderer/shaders/peripheral2.frag`, `renderer/webgl-renderer.js` |
| **ComplexityHUD** | `renderer/complexity-hud.js`, `renderer/overlay.html`, `renderer/overlay.js`, `renderer/scrutinizer.js`, `renderer/toolbar.js`, `renderer/styles.css`, `main.js` |
| **Mode 9** | `shared/modes.json`, `menu-template.js` |
| **Validation** | `scripts/validate-congestion.py`, `scripts/extract-congestion.js`, `scripts/compare-congestion.js`, `package.json`, `pyproject.toml` |
| **Golden Captures** | `.gitignore`, `docs/golden/mode-comparison/` |
| **Documentation** | `docs/congestion-journey.md`, `docs/scrutinizer-v1.8-congestion.md` |
| **Config** | `.claude/settings.json`, `.claude/skills/release/SKILL.md`, `.claude/agent-memory/` |
