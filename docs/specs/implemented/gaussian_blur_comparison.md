# Gaussian Blur Comparison: Frequency-Selective vs Uniform Degradation

> **Last updated:** 2026-03-11

**Status:** Saliency comparison complete and integrated into arxiv paper (Section 4.4, Table 5). Oriented DoG (v2.2) adds orientation-selective differentiation not yet captured in comparison data.
**Priority:** Medium — core saliency finding is published; oriented DoG comparison is the remaining gap
**Tracks:** v2.1 validation gap → v2.2 oriented DoG extension

## The Problem

The arxiv paper's central differentiation claim is that Scrutinizer's DoG band decomposition produces **frequency-selective** peripheral degradation (high frequencies attenuate before low), unlike Gaussian blur which degrades **uniformly** across all spatial frequencies. Wave 2 (spatial acuity) confirmed the pipeline is frequency-selective. But we never rendered the same stimuli through a matched Gaussian blur pipeline and measured the difference.

Without this comparison, the claim rests on theoretical argument ("Gaussian blur is uniform, our DoG is selective") rather than empirical measurement on identical stimuli.

## What "Matched" Means

The Gaussian blur comparison must be **perceptually matched**, not parameter-matched:

1. **Same total information loss** — at each eccentricity, the Gaussian blur kernel should remove approximately the same total contrast energy as the DoG pipeline. Otherwise we're comparing "a lot of blur" to "a little of selective degradation."
2. **Same eccentricity scaling** — blur radius should grow with eccentricity following the same M-scaling curve the DoG bands use (Rovamo & Virsu 1979).
3. **Same stimuli** — use the Wave 2 spatial-acuity reference page (sine gratings at 0.25, 0.5, 1.0, 2.0, 4.0 cpd).

## Measurement Protocol

### Stimuli
- `spatial-acuity.html` — 5 spatial frequencies × 5 eccentricity rings
- `color-search.html` — colored singletons (tests whether blur preserves chromatic identity differently)
- 1-2 real web pages (dashboard, article) for ecological validity

### Conditions
1. **DoG pipeline** (current Scrutinizer Mode 0) — capture at each eccentricity ring
2. **Matched Gaussian blur** — same eccentricity-scaled degradation as a single Gaussian kernel per ring
3. **Unfiltered baseline** — bypass mode

### Metrics (per eccentricity ring, per spatial frequency)
- **DFT contrast retention** — ratio of output amplitude to input amplitude at each grating frequency (reuse `analyze-spatial-acuity.js` infrastructure)
- **Chromatic retention** — Oklab chroma ratio (reuse `analyze-color-search.js`)
- **SSIM** — structural similarity between filtered and baseline
- **Cross-frequency discrimination** — the key metric: at each eccentricity, does the DoG pipeline show a steeper slope across frequencies than Gaussian? If both produce the same slope, the claim fails.

### Expected Results
- **DoG**: step-function attenuation — high frequencies drop to 0 at nearer eccentricities than low frequencies (already confirmed in Wave 2)
- **Gaussian**: all frequencies attenuate together — the slope across frequencies should be flatter at each eccentricity
- **The difference**: DoG preserves low-frequency structure (edges, large shapes) at eccentricities where Gaussian has already destroyed them

## Implementation

### Option A: Shader-based (preferred)
Add a `GAUSSIAN_BLUR_MODE` uniform to `peripheral.frag` that bypasses the DoG band decomposition and applies a single Gaussian kernel scaled by eccentricity. This keeps everything else identical (same eccentricity calculation, same M-scaling curve, same MIP chain for kernel size).

```glsl
// In peripheral.frag, after computing eccentricity:
if (u_gaussian_blur_mode) {
    // Single Gaussian kernel, radius = f(eccentricity)
    float blur_radius = eccentricity * u_blur_scale;
    vec4 blurred = textureLod(u_texture, uv, blur_radius);
    // Skip DoG band decomposition entirely
} else {
    // Existing DoG pipeline
}
```

Expose via `modes.json` as a hidden comparison mode or via env var for capture scripts only.

### Option B: Post-hoc (simpler but less controlled)
Apply Gaussian blur to baseline captures using ImageMagick/Sharp at matched kernel sizes. Less controlled because the blur happens in sRGB not linear, and doesn't go through the same MIP chain.

### Capture Script
`scripts/capture-gaussian-comparison.js` — renders each stimulus through both pipelines at 5 eccentricity fixation points, outputs paired captures for analysis.

### Analysis Script
`scripts/analyze-gaussian-comparison.js` — runs DFT contrast retention on both conditions, produces:
- Per-frequency × per-eccentricity contrast retention curves (DoG vs Gaussian)
- Cross-frequency slope comparison at each eccentricity
- Summary: "At X° eccentricity, DoG preserves Y% of 0.25 cpd contrast while Gaussian preserves Z%"

## Success Criteria

The comparison succeeds if:
1. **DoG shows frequency-selective attenuation** (already confirmed) — high frequencies drop before low
2. **Gaussian shows uniform attenuation** — all frequencies drop together
3. **The difference is measurable** — at intermediate eccentricities (5-15°), DoG retains significantly more low-frequency contrast than Gaussian at matched total information loss
4. **Real web content** shows visible structural preservation under DoG that Gaussian destroys

## Findings: Spatial Frequency Alone Is Insufficient

**2026-03-08**: First capture run (48 screenshots, 5 frequencies × 5 E2 values × {DoG, Gaussian, baseline}) shows DoG and Gaussian produce **near-identical** contrast retention slopes on achromatic gratings. At ring 4 (10°): DoG slope = -0.4675, Gaussian slope = -0.4675. At ring 5 (13.1°): DoG = -0.3592, Gaussian = -0.3601.

**Root cause**: The MIP chain is itself a Gaussian pyramid. `sampleMIPPooled()` (Gaussian mode) and `sampleDoGReconstructed()` (DoG mode) both sample from the same MIP levels — the band decomposition and reconstruction produces effectively the same total attenuation as a single MIP sample at the same eccentricity-scaled level. The difference between them is one of pathway (8 weighted bands vs 1 MIP sample) not of information content on single-frequency stimuli.

**Implication**: The differentiation argument cannot rest on spatial frequency selectivity alone. It must include the dimensions where the full Scrutinizer pipeline differs from pure Gaussian blur:

1. **Chromatic channel separation** — per-band RG/YV decay rates (castleCSF) that Gaussian blur cannot reproduce
2. **Saliency protection** — eccentricity modulated by saliency map, reducing degradation at salient regions
3. **Density-gated crowding** — V1 distortion strength modulated by DOM structure map density
4. **Congestion pooling** — Rosenholtz Feature Congestion boosting pooling in cluttered regions
5. **Orientation selectivity** (v2.2) — oriented DoG bands preserve cardinal-aligned edges ~50% further than oblique edges, and tangential edges persist further than radial ones (Toet & Levi 1992). Gaussian blur is isotropic and cannot reproduce any of this.

## Expanded Comparison: Multi-Dimensional

### Capture Scripts (updated)
- `capture-color-search.js` — now includes `gaussian` condition alongside `filtered` and `baseline`
  - Run `--gaussian-only` to add Gaussian captures to existing dataset
- `capture-saliency.js` — now includes `popout_gaussian` and `face_gaussian` conditions
  - Run `--gaussian-only` for incremental capture

### Analysis Scripts (updated)
- `analyze-color-search.js` — now parses `gaussian` condition, outputs DoG vs Gaussian chroma retention comparison table
- `analyze-saliency.js` — now computes DoG vs Gaussian deviation from baseline at each stimulus region

### Expected Multi-Dimensional Results
| Dimension | DoG pipeline | Gaussian | Why Gaussian fails |
|-----------|-------------|----------|--------------------|
| Chromatic (color-search) | RG decays faster than YV per band | Uniform desaturation | No opponent-channel separation |
| Saliency (popout/face) | Salient regions get reduced degradation | Same blur everywhere | No saliency gating |
| Crowding (halverson) | Dense text gets stronger V1 distortion | Same blur regardless | No DOM awareness |
| Congestion (halverson, congestion-gated) | High-clutter = stronger pooling | Same blur everywhere | No congestion signal |
| Orientation (v2.2) | Cardinal edges preserved ~50% further; radial edges fade faster than tangential | Isotropic — all orientations degraded equally | No V1 simple cell selectivity |

## Results: Saliency Protection (2026-03-08)

22 new captures (20 color-search + 2 saliency) with `u_gaussian_blur_mode = true`.

### Saliency: DoG+saliency vs Gaussian blur

Deviation from unfiltered baseline, measured as mean absolute pixel difference across each stimulus region. Lower = closer to original = better preservation.

| Region | Saliency channel | DoG+saliency dev | Gaussian dev | Ratio | Effect |
|--------|-----------------|-----------------|-------------|-------|--------|
| Face | Face detector (640px) | 2.9 | 23.9 | 0.121 | **8.2× better** |
| Luminance singleton | Bottom-up DoG (256px) | 1.3 | 14.0 | 0.094 | **10.8× better** |
| Color singleton | Bottom-up DoG (256px) | 1.2 | 6.7 | 0.173 | **5.6× better** |
| Control | — | 4.9 | 15.5 | 0.318 | 3.2× better |
| Background (center) | — | 0.0 | 0.0 | N/A | Both preserve fovea |

**Key finding**: The full Scrutinizer pipeline preserves salient content 5–10× better than eccentricity-matched Gaussian blur. This is not a tuning difference — Gaussian blur has no saliency signal, so it cannot modulate degradation by content importance.

The control region also shows a 3.2× advantage, which is expected: the control region sits in the periphery where mode 0's V1 distortion and chromatic pooling produce less total deviation than Gaussian's uniform MIP blur at the same eccentricity. The control advantage is smaller than the high-saliency advantage, confirming the saliency gating is doing differential work.

### Face page (no baseline available)

Direct DoG-vs-Gaussian pixel comparison (not deviation from baseline):

| Region | Delta (DoG vs Gaussian) |
|--------|------------------------|
| Face center | 107.7 |
| Background | 111.5 |

Both show large deltas, confirming the two pipelines produce visibly different output. The face delta is slightly smaller than background, suggesting the DoG pipeline preserved more face structure — but without a baseline this is not a clean protection metric.

### Validation checks (all PASS)

```
[PASS] Color singleton: DoG preserves salient content better (dev=1.2 vs Gaussian=6.7)
[PASS] Luminance singleton: DoG preserves salient content better (dev=1.3 vs Gaussian=14)
[PASS] Face: DoG preserves salient content better (dev=2.9 vs Gaussian=23.9)
```

## arxiv Integration

Integrated into `scrutinizer-system-paper.tex` at lines 244–265 (Section 4.4, after Table 5). The LaTeX below is the published version.

```latex
\textbf{Gaussian comparison.} A matched eccentricity-scaled Gaussian blur
(\texttt{u\_gaussian\_blur\_mode}), using the same MIP chain and M-scaling
curve but without band decomposition, saliency gating, or chromatic
separation, was applied to the same stimulus. Table~\ref{tab:gaussian_saliency}
reports mean absolute pixel deviation from the unfiltered baseline at each
region. The full pipeline preserves salient content 5--10$\times$ better
than Gaussian blur.

\begin{table}[t]
\centering
\caption{DoG+saliency vs.\ Gaussian blur: deviation from unfiltered baseline (lower = better preservation). Ratio $< 1$ means the full pipeline preserves more content.}\vspace{-2pt}
\label{tab:gaussian_saliency}
\footnotesize
\begin{tabular}{@{}lcccl@{}}
\toprule
\textbf{Region} & \textbf{DoG+sal} & \textbf{Gaussian} & \textbf{Ratio} & \textbf{Effect} \\
\midrule
Face              & 2.9  & 23.9 & 0.121 & 8.2$\times$ \\
Luminance single. & 1.3  & 14.0 & 0.094 & 10.8$\times$ \\
Color singleton   & 1.2  &  6.7 & 0.173 & 5.6$\times$ \\
Control           & 4.9  & 15.5 & 0.318 & 3.2$\times$ \\
\bottomrule
\end{tabular}
\end{table}

This is not a parameter-tuning advantage. Gaussian blur has no saliency
signal; it structurally cannot modulate degradation by content importance.
The control region also shows a 3.2$\times$ advantage because mode~0's
biological pipeline (V1 distortion, Oklab chromatic pooling) produces less total
deviation than uniform MIP blur at matched eccentricity---but the
high-saliency advantage (5--10$\times$) exceeds the control advantage
(3.2$\times$), confirming the saliency gate is doing differential work.

The spatial-frequency comparison (Section~\ref{sec:validation}.2) showed
DoG and Gaussian produce near-identical contrast retention slopes on
achromatic gratings (ring~4: both $-0.4675$; ring~5: $-0.3592$ vs.\
$-0.3601$). Both pipelines sample from the same MIP chain, so the band
decomposition does not add frequency selectivity beyond what the MIP
pyramid already provides. The differentiation is architectural: saliency
gating, chromatic channel separation, and density-gated crowding are
pipeline stages that Gaussian blur lacks entirely.
```

### Paper integration status

- [x] Table 5 + text inserted after saliency protection discussion (lines 244–265)
- [x] Abstract softened — differentiation framed as pipeline architecture, not DoG bands alone
- [x] Introduction claim ("uniformly destroying spatial structure") now empirically supported (5–10×)
- [x] Open Problems notes DoG/Gaussian spatial-frequency equivalence as characterized limitation

### Remaining work
- [ ] **Oriented DoG comparison** — v2.2's radial-tangential anisotropy and cardinal edge bonus need a Gaussian comparison capture run. This is the strongest structural differentiator: Gaussian blur is isotropic by definition.
- [ ] Chromatic comparison reframing (DoG+chromatic pooling produces differential RG/YV decay; Gaussian does not)
- [ ] Visual figure: side-by-side DoG vs Gaussian on popout stimulus

## Failure Modes

- If the MIP chain's discrete bands make DoG effectively Gaussian between band boundaries, the difference may be smaller than claimed — **CONFIRMED on spatial frequency stimuli**
- If "matched total information loss" is hard to define, the comparison becomes apples-to-oranges
- If Gaussian with eccentricity-scaled radius already produces decent frequency selectivity (large Gaussian kernels naturally attenuate high frequencies more), the difference may be one of degree rather than kind — **CONFIRMED: both use MIP chain, so both are inherently Gaussian**
- The multi-dimensional comparison avoids these failure modes because saliency gating, chromatic separation, density-gated crowding, and orientation selectivity (v2.2) are architectural features that Gaussian blur lacks by design

## References

- Rovamo, J. & Virsu, V. (1979). An estimation and application of the human cortical magnification factor. *Experimental Brain Research*, 37, 495-510.
- Geisler, W.S. & Perry, J.S. (1998). A real-time foveated multiresolution system for low-bandwidth video communication. *SPIE Human Vision*.
- Itti, L., Koch, C. & Niebur, E. (1998). A model of saliency-based visual attention. *IEEE Trans PAMI*, 20(11), 1254-1259.
- Toet, A. & Levi, D.M. (1992). The two-dimensional shape of spatial interaction zones in the parafovea. *Vision Research*, 32(7), 1349-1357.
- `scrutinizer-system-paper.tex` Section 4.4 (saliency comparison, Table 5) and Section 5 (open problems)
