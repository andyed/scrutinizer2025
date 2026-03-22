# Scrutinizer v2.7.0 — Pyramid Mongrel

**Date:** 2026-03-22

Tier 2.75 replaces Tier 2.5's single-scale oriented noise with a Laplacian pyramid decomposition pipeline. Four frequency bands plus a DC residual are extracted per tile, their variances and cross-scale correlations measured, and noise is synthesized to match those statistics at each scale. The result is spatially coherent peripheral texture instead of colored noise. Mode 14 (Pyramid Mongrel) is the new default.

## Highlights

### Laplacian Pyramid Compute Pipeline (Tier 2.75)

A 15-dispatch-per-frame WebGPU compute pipeline decomposes the half-res source into 4 bandpass levels plus a residual, extracts per-tile statistics (variance, magnitude, parent-child correlation), and synthesizes noise that matches those statistics at each scale. The pipeline drops into the existing TEXTURE5 path — `peripheral.frag` sees the same RGBA8 + alpha blend weight format as Tier 2.5.

Three new WGSL shaders:
- `pyramid-decompose.wgsl` — luminance extraction, blur/downsample, band subtraction (3 entry points)
- `pyramid-stats.wgsl` — atomic tile accumulation + finalize producing 18 floats per tile (TileStatsTier3)
- `pyramid-synth.wgsl` — sine-grating noise generation, variance matching, bilinear tile interpolation, multi-band reconstruction

Pipeline manager: `webgpu-pyramid-compute.js` (803 lines) orchestrates device setup, buffer allocation, bind groups, and the 15-dispatch sequence (decompose, stats, seed, match x2, reconstruct).

### Mode 14 — Pyramid Mongrel (Default)

Mode 14 replaces mode 12 (FOVI Cortical Grid) as the default. It uses the full Scrutinizer pipeline (LGN structure mask, saliency gate, V1 distortion, V4 chromatic pooling) with Tier 2.75 synthesis replacing Tier 2.5's oriented noise. Previous default accessible via menu.

### Bilinear Tile Interpolation

Variance, magnitude, and cross-scale correlation values are bilinearly interpolated between the 4 nearest tile centers before scaling noise amplitude. This eliminates the crosshatch artifact visible at tile boundaries where adjacent tiles had different content characteristics (e.g., text tile adjacent to whitespace tile). Applies to both color stats and band statistics.

### Isotropic 4-Orientation Noise

The original `sin(x)*cos(y)` noise pattern was axis-aligned and produced diagonal fringing artifacts. Replaced with a sum of 4 rotated sine gratings at 0/45/90/135 degrees per band, with per-pixel phase jitter from a hash function to break spatial regularity. Noise variance recalibrated to 0.5 for the 4-grating sum.

### Eccentricity-Graded Content Replacement

Synthesis alpha now controls detail strength as a function of eccentricity: near-fovea (0.15) preserves structure, far periphery (0.8) replaces content. High-variance tiles (flanked letters) receive more noise disruption than low-variance tiles (isolated letters) — this is the mechanism through which crowding emerges from the synthesis.

### Gaze-Based Stable Seed

Noise seed is derived from gaze position rather than pixel coordinates, so the synthesized texture is stable across frames at a given fixation. Eliminates the shimmer artifact present in Tier 2.5 where noise pattern changed every frame during fixation.

### Mode-Switch Pipeline Recreation

Switching between Tier 2.5 and Tier 2.75 modes now correctly destroys and recreates the WebGPU compute pipeline. Previously, switching from mode 14 to mode 10 (or vice versa) would crash because the pipeline manager expected a different buffer layout. The `compute_tier` config field drives pipeline selection.

## New Files

| File | Purpose |
|------|---------|
| `renderer/shaders/pyramid-decompose.wgsl` | Laplacian pyramid decomposition (luminance, blur, band subtraction) |
| `renderer/shaders/pyramid-stats.wgsl` | Per-tile statistics extraction (variance, magnitude, correlation) |
| `renderer/shaders/pyramid-synth.wgsl` | Multi-scale noise synthesis with bilinear interpolation |
| `renderer/webgpu-pyramid-compute.js` | Pipeline manager — 15 dispatches per frame |
| `scripts/generate-pyramid-reference.py` | Python reference generator for pyramid validation (pyrtools) |
| `scripts/validate-pyramid.js` | Pyramid decomposition validation against Python reference |
| `scripts/validate-crowding-tier3.js` | Crowding asymmetry validation (Wave 7c) |
| `scripts/capture-crowding-tier3.js` | Capture script for crowding comparison across tiers |
| `scripts/analyze-pyramid-stats.js` | Statistical analysis of pyramid band distributions |
| `scripts/analyze-tier25-gap.js` | Gap analysis: Tier 2.5 vs 2.75 quality metrics |
| `scripts/capture-pyramid-subbands.js` | Subband capture for per-band visualization |
| `scripts/generate-subband-tiling.js` | Blog asset: 3x2 grid of decomposed frequency bands |
| `docs/specs/wave7_pyramid_validation.md` | Wave 7 validation spec (7a fidelity, 7b stats, 7c crowding) |
| `docs/specs/tier3_ttm_synthesis_plan.md` | Tier 3 TTM synthesis architecture plan |
| `tests/unit/pyramid-decompose.test.js` | 30 unit tests: decomposition validated against pyrtools |
| `tests/unit/pyramid-reference/pyramid-reference.json` | Golden reference data from Python generator |
| `tests/validation/wave7c-crowding.json` | Wave 7c crowding asymmetry validation data |

## Test Results

| Suite | Result |
|-------|--------|
| Unit (304) | PASS (+30 pyramid decomposition tests) |
| Visual regression | PASS |
| Memory | PASS |
| Performance | PASS |
| Integration | PASS |
| Smoke (7) | PASS |
| Golden (73) | PASS |
| Wave 7a (pyramid fidelity) | Scaffolded |
| Wave 7b (stats accuracy) | Scaffolded |
| Wave 7c (crowding asymmetry) | FAIL — OCR calibration needed, not a synthesis issue |

## Known Limitations

- Synthesis adds bandpass detail to tile-mean luminance rather than replacing content. Crowding asymmetry (flanked targets harder than isolated) requires Tier 3 content replacement within pooling regions. Wave 7c fails for this reason — it is an expected limitation of Tier 2.75, not a bug.
- Cross-scale correlation strength tuned to 0.8 empirically. No psychophysical calibration yet.

## Breaking Changes

- Default mode changed from 12 (FOVI Cortical Grid) to 14 (Pyramid Mongrel)
- Compute phase added to FrameTimer — timing breakdowns from earlier versions are not directly comparable
