# Tier 3: TTM-Style Summary Statistic Synthesis

## Context

Scrutinizer's WebGPU compute pipeline (Tier 2.5, shipped v2.3) produces "colored noise" in the periphery — per-tile Oklab statistics + oriented sine gratings. The core problem: no cross-scale magnitude correlations. This is the statistic that makes text look like horizontal stripes instead of random noise, faces look like skin-toned blobs instead of speckle.

The v2.6 blog post identifies the gap. This plan closes it: real-time TTM-style mongrel texture synthesis validated against published psychophysics, with each phase producing a blog-ready visual artifact.

**Key insight from science review**: The quality bottleneck is the synthesis algorithm + multi-scale statistics, not the sector geometry. Isotropic sectors (v2.6) provide correct pooling region shapes but don't improve output quality alone. We prototype on the existing 8x8 tile grid first, upgrade to sector-aware binning after quality is proven.

**Pragmatic path**: Start with **Tier 2.75** (Laplacian pyramid + cross-scale correlations) before full steerable pyramid. The Laplacian pyramid already exists in `validate-subband-entropy.js`. Cross-scale correlations are the quality leap. If Tier 2.75 works, upgrade to steerable for orientation selectivity.

## Phase 0: Ground Truth Gap Analysis

**Goal**: Quantify exactly how far Tier 2.5 is from Brown/Rosenholtz metamers. Establishes the baseline we're improving against.

**Create**:
- `scripts/analyze-tier25-gap.js` — Capture mode 10 output + Brown metamer for same source images. Compare per-eccentricity-band SSIM. Output JSON + markdown.

**Uses existing**:
- `scripts/generate-brown-metamers.py` (ground truth)
- `scripts/compare-brown-metamers.js` (comparison infra)
- `tests/golden-captures/raw/` (source screenshots)

**Pass/fail**: No pass/fail — this is a baseline measurement. Expected: foveal SSIM ~0.95+, far peripheral ~0.3-0.5.

**Blog artifact**: Side-by-side strip — original | Tier 2.5 | Brown metamer — at 3 eccentricities. The "here's the gap" image.

## Phase 1: Multi-Scale Decomposition (validation-first)

### 1a. Python reference generator

**Create**: `scripts/generate-pyramid-reference.py`
- Decompose test images using pyrtools (Simoncelli's steerable pyramid)
- Save per-subband as float32 binary + metadata JSON
- Test images: solid gray, 4 oriented gratings (0/45/90/135°), crowding stimulus, dashboard screenshot
- Also generates Laplacian pyramid reference for Tier 2.75 comparison

### 1b. WGSL Laplacian pyramid decomposition (Tier 2.75 path)

**Create**: `renderer/shaders/pyramid-decompose.wgsl`
- 4-scale Laplacian pyramid via compute shader
- Each scale: Gaussian blur (separable, shared memory) → downsample → subtract to get bandpass
- Output: 4 band textures (at decreasing resolutions) + lowpass residual
- Format: `r16float` per texel (luminance only for Tier 2.75; expand to `rgba16float` for color in Tier 3)
- Memory: ~1.33x base resolution total (geometric series). At half-res 960x506: ~5MB.

### 1c. Pyramid validation (Wave 7a)

**Create**:
- `tests/unit/pyramid-decompose.test.js` — JS reference Laplacian pyramid (adapted from `validate-subband-entropy.js:buildLaplacianPyramid`), compare against pyrtools output
- `scripts/capture-pyramid-subbands.js` — Run decompose pass only, readback per-band textures
- `scripts/validate-pyramid.js` — Compare WGSL output vs JS/pyrtools reference
- `docs/specs/wave7_pyramid_validation.md`

**Validation criteria**:
- **Tier 1 (must)**: Solid gray → near-zero bands (all energy in residual), MSE < 0.001
- **Tier 1 (must)**: Perfect reconstruction: sum(bands) + residual = original, MSE < 0.005
- **Tier 2 (should)**: Per-band MSE vs pyrtools Laplacian < 0.005
- **Tier 3 (nice)**: Energy conservation: sum of band energies = total image energy ± 2%

**Blog artifact**: Tiled subband visualization — the 4-band + residual decomposition of a web page screenshot. Classic pyramid image, immediately publishable. Caption: "What the peripheral visual system decomposes before pooling."

## Phase 2: Cross-Scale Statistics Extraction

### 2a. Enhanced stats extraction shader

**Create**: `renderer/shaders/pyramid-stats.wgsl`

Per tile (reusing 8x8 grid initially), extract from the pyramid bands:
- **Per-band magnitude**: mean |band_k| for k=0..3 (4 values)
- **Per-band variance**: var(band_k) (4 values)
- **Cross-scale magnitude correlations**: corr(|band_k|, |band_{k+1}|) for k=0..2 (3 values) — **the key statistic**
- **Mean color**: mean L, a, b in Oklab (3 values, carried from Tier 2.5)
- **Marginal skewness**: skew(band_k) for k=0..3 (4 values)

Total: ~18 floats per tile. Struct: `TileStatsTier3`.

Reduction: Same binary-tree pattern as current `crowding-stats.wgsl` but operating on pyramid bands instead of raw pixels. Two sub-passes:
- Sub-pass A: Accumulate raw sums (sum, sum², sum_cross) per tile
- Sub-pass B: Finalize (mean, variance, correlation from accumulated sums)

### 2b. Statistics validation (Wave 7b)

**Create**:
- `scripts/analyze-pyramid-stats.js` — Readback tile stats, compare against Python reference
- Reference: pyrtools decompose → numpy per-tile stats (add to `generate-pyramid-reference.py`)

**Validation criteria**:
- **Tier 1**: Mean magnitude per band per tile within 5% of reference
- **Tier 2**: Cross-scale correlation sign matches reference (if ref says positive, ours says positive)
- **Tier 2**: Correlation magnitude within 0.15 of reference
- **Tier 3**: Skewness within 0.2 of reference

**Blog artifact**: Cross-scale correlation heatmap overlaid on the original page. Hot = high correlation (edges, text strokes, UI borders). Cold = low correlation (flat backgrounds, noise). Caption: "Where the visual system detects structure across spatial scales."

## Phase 3: Synthesis from Statistics

### 3a. Spectrum-matching synthesis shader

**Create**: `renderer/shaders/pyramid-synth.wgsl`

Replace oriented sine gratings with multi-scale noise matching:

1. **Initialize**: Seeded white noise per band (hash-based, deterministic per tile for temporal stability)
2. **Magnitude matching**: Scale noise band_k so mean|noise_k| = target mean|band_k|, variance matches target
3. **Cross-scale correlation injection**: For each parent-child pair (k, k+1), adjust child magnitudes conditioned on parent magnitude. If target correlation is high and parent has strong energy → boost child. If low → leave independent. This is a linear approximation inspired by Walton et al. (2021); their full approach uses histogram matching on steerable pyramid subbands, which is a Tier 3 target.
4. **Marginal adjustment**: Shift distribution to match target skewness (power-law transform)
5. **Reconstruct**: Sum adjusted noise bands + original lowpass residual → output image

Iterations: 2-3 passes (Walton reports convergence in 3). Each iteration is a separate compute dispatch.

### 3b. Composite shader

**Modify**: `renderer/shaders/pyramid-composite.wgsl` (or extend existing synth)
- Sum synthesized bands + original lowpass residual
- Convert Oklab → sRGB
- Alpha blend: foveal passthrough (mip < 0.5), smooth ramp to full synthesis
- Same alpha encoding as Tier 2.5 for fragment shader compatibility

### 3c. Crowding asymmetry validation (Wave 7c — the scientific milestone)

**Create**:
- `scripts/capture-crowding-tier3.js` — Capture crowding stimulus through Tier 2.75/3 pipeline
- `scripts/validate-crowding-tier3.js` — OCR comparison: isolated vs flanked letters

**Validation criteria**:
- **Tier 1 (must)**: Isolated letter at 8° — OCR recognizes it (structure preserved without flankers)
- **Tier 1 (must)**: Flanked letter at 8° — OCR fails (crowding destroys identity via statistical pooling)
- **Tier 2 (should)**: Asymmetry ratio > 2x (isolated recognition / flanked recognition)
- **Tier 3 (nice)**: Critical spacing tracks Bouma's 0.5 × eccentricity within 20%

This is **simulation limitation #1** from `simulation-limitations.md` — the gap displacement can't close. If synthesis produces it, that's a publishable result and the scientific justification for the entire Tier 3 effort.

**Blog artifact**: The money shot — same letter, same eccentricity, isolated vs flanked, through Tier 3. Side-by-side with Tier 2.5 (no asymmetry) and Brown metamer (ground truth asymmetry).

## Phase 4: Integration

### 4a. Pipeline manager expansion

**Modify**: `renderer/webgpu-crowding-compute.js`
- Extend from 2-pass to N-pass (decompose → stats → synth iterations → composite)
- New buffer management: pyramid band textures (`r16float`, 4 scales + residual)
- Stats buffer with `TileStatsTier3` struct
- Dispatch ordering within single command encoder

### 4b. Tiered fallback

**Modify**: `renderer/webgpu-safety.js`
- Tier 3 > 4ms → fall back to Tier 2.5 (current 2-pass)
- Tier 2.5 > 2ms → fall back to Tier 1 (fragment shader only)
- Existing 30fps floor / 10-frame trigger unchanged

### 4c. Mode configuration

**Modify**: `shared/modes.json`
- New mode or upgrade mode 10: `compute_tier: 3.0`, `pyramid_scales: 4`, `synth_iterations: 3`

### 4d. Debug visualization

**Add to**: `renderer/webgpu-crowding-compute.js`
- Debug readback for intermediate buffers (pyramid bands, stats heatmaps, synthesis stages)
- Keyboard shortcut to dump intermediates as PNGs
- Feeds blog content directly

### 4e. Spec + docs update

**Modify**: `docs/specs/mongrel_textures.md` — Update tier table, mark Tier 2.75/3 as shipped

## Performance Budget

| Component | Estimated Cost | Notes |
|-----------|---------------|-------|
| Laplacian decompose (4 scales) | 0.3ms | Separable blur + subtract, geometric shrink |
| Stats extraction (2 sub-passes) | 0.4ms | Same reduction as Tier 2.5, more floats |
| Synthesis (3 iterations) | 1.5ms | Per-band noise adjustment, 4 bands × 3 iters |
| Composite | 0.2ms | Band summation + color convert |
| **Total Tier 2.75** | **~2.4ms** | Within 3-4ms budget |

Fallback: If > 4ms on integrated GPU, safety harness drops to Tier 2.5 (0.3ms).

## Implementation Order

```
Phase 0 (gap baseline)         ~1 session
    ↓
Phase 1a (Python reference)    ~1 session
Phase 1b (WGSL decompose)      ~2 sessions
Phase 1c (pyramid validation)  ~1 session
    ↓
Phase 2a (stats shader)        ~2 sessions
Phase 2b (stats validation)    ~1 session
    ↓
Phase 3a (synthesis shader)    ~3 sessions  ← hardest part
Phase 3b (composite)           ~1 session
Phase 3c (crowding test)       ~1 session   ← scientific milestone
    ↓
Phase 4 (integration)          ~2 sessions
```

Phase 1b and 1c can overlap. Phase 0 is independent. Debug viz (4d) is parallel with anything.

## Critical Files

| File | Action | Purpose |
|------|--------|---------|
| `renderer/shaders/pyramid-decompose.wgsl` | Create | Laplacian pyramid in compute |
| `renderer/shaders/pyramid-stats.wgsl` | Create | Cross-scale statistics extraction |
| `renderer/shaders/pyramid-synth.wgsl` | Create | Spectrum-matching synthesis |
| `renderer/webgpu-crowding-compute.js` | Major modify | N-pass pipeline manager |
| `scripts/generate-pyramid-reference.py` | Create | pyrtools ground truth |
| `scripts/validate-pyramid.js` | Create | Wave 7a decomposition fidelity |
| `scripts/validate-crowding-tier3.js` | Create | Wave 7c crowding asymmetry |
| `tests/unit/pyramid-decompose.test.js` | Create | Decomposition unit tests |
| `docs/specs/wave7_pyramid_validation.md` | Create | Validation spec |
| `docs/specs/mongrel_textures.md` | Modify | Update tier status |
| `renderer/webgpu-safety.js` | Minor modify | Tiered fallback thresholds |
| `shared/modes.json` | Modify | Mode 13 or upgraded mode 10 |

## Verification

After each phase, run the validation wave:
```bash
# Phase 1: Pyramid fidelity
npm run wave7a:validate

# Phase 2: Statistics accuracy
npm run wave7b:validate

# Phase 3: Crowding asymmetry (the milestone)
npm run wave7c:validate

# Regression: existing waves still pass
npm test
npm run validate-congestion
```

Visual inspection: Compare Tier 2.75 output against Brown metamers at the same source images and gaze points. The peripheral rendering should show texture structure (stripes for text, blobs for images) rather than colored noise.
