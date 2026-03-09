# Gaussian Blur Comparison: Frequency-Selective vs Uniform Degradation

**Status:** Not started
**Priority:** High — central claim in arxiv paper lacks direct evidence
**Tracks:** v2.1 validation gap

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

## Failure Modes

- If the MIP chain's discrete bands make DoG effectively Gaussian between band boundaries, the difference may be smaller than claimed
- If "matched total information loss" is hard to define, the comparison becomes apples-to-oranges
- If Gaussian with eccentricity-scaled radius already produces decent frequency selectivity (large Gaussian kernels naturally attenuate high frequencies more), the difference may be one of degree rather than kind

## References

- Rovamo, J. & Virsu, V. (1979). An estimation and application of the human cortical magnification factor. *Experimental Brain Research*, 37, 495-510.
- Geisler, W.S. & Perry, J.S. (1998). A real-time foveated multiresolution system for low-bandwidth video communication. *SPIE Human Vision*.
- Arxiv paper Section 4: Wave 2 spatial frequency results
- Arxiv paper Section 5: "Continuous cortical magnification" open problem
