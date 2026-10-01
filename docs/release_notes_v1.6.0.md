# Scrutinizer v1.6.0 Release Notes

**Release Date:** February 28, 2026

## Overview: Architecture & Peripheral Vision Overhaul

This release has two parts: a major **architectural refactor** of the renderer and a new **biologically-motivated peripheral rendering model**. The monolithic `scrutinizer.js` has been decomposed into domain modules aligned with the neuroscience they simulate, and the peripheral vision pipeline now uses Difference-of-Gaussians (DoG) band decomposition instead of simple MIP pooling. The simulation allocates processing bandwidth selectively, as the visual system does: low-frequency structure (layout, buttons, large text) passes through while high-frequency detail (serifs, fine textures) is filtered. The model is motivated by the retina-to-optic-nerve bottleneck behind peripheral vision's loss of detail.

---

## 🧠 De-Monolith: Biologically-Motivated Module Architecture

The 969-line `scrutinizer.js` monolith has been decomposed into three domain modules, each paired with the biological system it simulates or feeds:

| Module | Lines | Biological Analog | Responsibility |
| --- | --- | --- | --- |
| `gaze-model.js` | 166 | Oculomotor system | Velocity tracking, fixation detection, saccadic suppression |
| `visual-memory.js` | 254 | Visuospatial sketchpad (Baddeley & Hitch, 1974) | Fixation buffer, mask rendering, time-decay |
| `content-analysis.js` | 356 | None direct; computes the inputs to the shader's LGN gating stage | Structure map, saliency map, DOM observation |

`scrutinizer.js` is now a thin **Pipeline Orchestrator** (535 lines) that wires these modules together with backward-compatible property proxies, so existing callers see no API changes.

Each module is independently testable and swappable. To replace the mouse-based gaze proxy with a Tobii eye tracker, swap `GazeModel`. To experiment with a different saliency algorithm, replace the analyzer in `ContentAnalysis`. Researchers can change one part of the simulation without understanding the full pipeline.

### Unit Test Coverage

138 new unit tests for pure-function modules:
- `oklab-utils`: 73 tests (perceptual color space transforms)
- `gestalt-processor`: 41 tests (proximity/similarity grouping)
- `color-saliency-map`: 24 tests (chromatic attention weighting)

---

## 🔬 DoG Peripheral Reconstruction (V4 MIP Replacement)

### The Problem with MIP Pooling

The previous peripheral rendering used hardware MIP levels directly (`textureLod(tex, uv, level)` with level increasing with eccentricity). This uniformly blurs content, destroying *all* spatial structure progressively. Peripheral vision keeps coarse structure: you can see *where* a button is (low-frequency shape) even when you can't read its label (high-frequency detail).

### The DoG Approach

Retinal ganglion cells have center-surround receptive fields that are well-modeled as Difference-of-Gaussians (DoG) filters. Field size grows with eccentricity (M-scaling). We approximate this by decomposing the hardware MIP chain into band differences, an approximate Laplacian pyramid (hardware mipmaps use box/bilinear filtering where Burt & Adelson 1983 use Gaussian convolution, so there is spectral leakage between bands):

```
band_k = textureLod(tex, uv, k) - textureLod(tex, uv, k+1)
```

Each band covers a different spatial frequency range:

| Band | MIP Levels | Scale | Content |
| --- | --- | --- | --- |
| Band 0 | 0 - 1 | 1-2px | Serifs, thin strokes, fine textures |
| Band 1 | 1 - 2 | 2-4px | Letter bodies, small icons |
| Band 2 | 2 - 3 | 4-8px | Words, UI element outlines |
| Band 3 | 3 - 4 | 8-16px | Buttons, layout blocks |
| Residual | 4 | 16px+ | Overall color/luminance (DC) |

Each band is weighted by a smoothstep rolloff based on eccentricity, with cutoff eccentricities following a geometric progression (M-scaling approximation). The system filters frequency bands selectively: high-frequency bands (Band 0) are filtered first as eccentricity increases, while low-frequency bands (Band 3) pass through furthest into the periphery. This parallels the biological bottleneck. Ganglion cell receptive fields grow with eccentricity, so low-frequency structure passes and fine detail is lost.

### Parameters

| Parameter | Default | Description |
| --- | --- | --- |
| `dog_enabled` | `false` | Toggle DoG vs legacy MIP pooling |
| `dog_e2` | `0.5` | M-scaling half-resolution eccentricity (lower = more aggressive filtering) |
| `dog_sharpness` | `0.0` | Band rolloff transition width (0 = biological/gradual, 1 = sharp cutoff) |

### Mode Enablement

DoG is enabled by default in research-oriented modes:

| Mode | dog_enabled | dog_e2 | Rationale |
| --- | --- | --- | --- |
| High-Key (0) | true | 0.5 | Standard M-scaling |
| Biological (1) | true | 0.4 | More aggressive filtering, Purkinje mode |
| Frosted (2) | false | — | Not biologically motivated |
| Blueprint (3) | false | — | Uses Sobel edges, not pooling |
| Cyberpunk (4) | false | — | Uses pixelation, not pooling |
| Double Vision (5) | false | — | Artistic mode |

### Performance

5 `textureLod()` calls per fragment vs 1, but near-zero practical cost:
- Higher MIP levels are cheaper (fewer texels)
- MIP chain already in texture cache from `gl.generateMipmap()`
- No dependent texture reads (same UV for all samples)
- Arithmetic is trivial (4 smoothsteps, 4 multiplies, 4 adds)

---

## 📸 Golden Capture Improvements

- **Mobile/tablet coverage**: iPhone 14 Pro (390x844) and iPad Air Landscape (1180x820) captures now included alongside desktop for all reference pages.
- **Settings isolation**: Fixed a bug where persisted mobile emulation settings from previous manual sessions could leak into golden captures.
- **Expanded matrix**: 19 captures per version (up from ~8), covering standard, saliency, structure, and device variants.

## 🐛 Bug Fixes

- **Golden capture crash**: Fixed `TypeError: Cannot set properties of null` when the settings manager was accessed before initialization in test mode.
- **Mobile emulation leakage**: Test captures now explicitly reset mobile emulation state before each run, preventing desktop captures from rendering at phone dimensions.

---

## What's Next

Two directions under consideration for v1.7:

- **Oriented DoG Bands (Oblique Effect):** The current DoG decomposition is isotropic: all edge orientations attenuate equally. Real V1 cells are orientation-selective, and humans have ~30-50% better acuity for cardinal (H/V) edges than oblique ones. This would add a 4-tap gradient analysis to modulate per-band M-scaling cutoffs by local edge orientation, so horizontal text strokes would persist ~50% further into the periphery than diagonal noise. Cost: +4 texture lookups, ~0.2ms. Spec: `docs/specs/implemented/oriented_dog_bands.md`

- **Pre-Attentive Semantic Simulation:** Real-time comparison of user goal embeddings against page content embeddings to model pre-attentive semantic filtering. Peripheral vision loses semantic access as well as spatial resolution. Goal-relevant content (a "Buy" button when you're shopping) still receives more attentional bandwidth than irrelevant content. This would embed page elements and a user-specified goal via a local LLM, then modulate the processing budget by cosine similarity, so goal-aligned content receives more of the rendering pipeline even in the periphery.

---

## Files Changed

| Area | Files |
| --- | --- |
| **Architecture** | `renderer/scrutinizer.js`, `renderer/gaze-model.js`, `renderer/visual-memory.js`, `renderer/content-analysis.js` |
| **DoG Shader** | `renderer/shaders/peripheral.frag` |
| **DoG Plumbing** | `renderer/webgl-renderer.js`, `renderer/config.js`, `shared/modes.json` |
| **Golden Captures** | `scripts/capture-golden.js`, `main.js` |
| **Documentation** | `docs/foveated-vision-model.md`, `docs/developers_guide.md`, `ROADMAP.md` |
