# Scrutinizer v2.3.0 Release Notes

**Release Date:** 2026-03-11
**Previous:** [v2.2.0 release notes](release_notes_v2.2.0.md)
**Blog post:** [Five Decades to Real Time](https://andyed.github.io/scrutinizer-www/blog/2026-03-11-luminance-metrics.html)

## In This Release

1. [WebGPU Compute Mongrel Pipeline (Tier 2.5)](#webgpu-compute-mongrel-pipeline-tier-25) — Real-time metamer texture synthesis via two WGSL compute passes. Oriented noise preserves luminance variance where MIP blur destroys it. ~900 lines, <0.3ms on integrated GPU.
2. [Bouma-Scaled Edge Density Gate](#bouma-scaled-edge-density-gate) — Congestion map MIP-sampled at the MIP level matching Bouma's critical spacing.
3. [Oklab Luminance Variance Metrics](#oklab-luminance-variance-metrics) — Perceptually uniform variance comparison between rendering modes, with H5/H6 hypothesis testing.
4. [Auto-Updater & Citation Metadata](#auto-updater--citation-metadata) — Upgraded electron-updater and embedded citation export metadata in captures.

---

## WebGPU Compute Mongrel Pipeline (Tier 2.5)

The Texture Tiling Model (Freeman & Simoncelli 2011, Rosenholtz 2016) says peripheral vision pools summary statistics — mean, variance, orientation energy — not blur. MIP blur implements one statistic (the mean) and discards the rest. The compute mongrel pipeline synthesizes textures that preserve all of them.

### Architecture

Two WGSL compute passes run alongside the existing WebGL renderer on a half-resolution copy of each frame:

- **Pass 1** (`crowding-stats.wgsl`): 8×8 workgroups extract per-tile Oklab statistics via parallel reduction — mean L, variance L, mean a/b, four orientation energies from central differences, CMF-derived MIP level. Output: 48-byte `TileStats` struct per tile.
- **Pass 2** (`crowding-synth.wgsl`): One thread per output pixel synthesizes oriented noise — four sine gratings weighted by orientation distribution, scaled by σ_L × 1.5, added to tile mean. Chrominance uses tile mean directly (peripheral vision pools color more aggressively than luminance). Output: RGBA8 with eccentricity-dependent alpha.

The result uploads to WebGL as `TEXTURE5`. The fragment shader blends it when `u_compute_tier > 2.0`.

### Safety Harness

Ported from Psychodeli+:
- `webgpu-probe.js`: Adapter capability query, 128MB storage buffer warning
- `webgpu-safety.js`: 60-frame rolling window monitor. 10 consecutive frames above 33ms → `onBudgetExceeded` → automatic fallback to MIP-only rendering

### Files

| File | Lines | Purpose |
|------|-------|---------|
| `renderer/webgpu-crowding-compute.js` | 316 | Pipeline manager: buffer lifecycle, two-pass dispatch, async readback |
| `renderer/shaders/crowding-stats.wgsl` | ~300 | Pass 1: tile statistics via shared-memory parallel reduction |
| `renderer/shaders/crowding-synth.wgsl` | ~280 | Pass 2: oriented noise synthesis from tile stats |
| `renderer/webgpu-probe.js` | ~60 | WebGPU adapter capability detection |
| `renderer/webgpu-safety.js` | ~80 | Frame budget monitor with auto-fallback |

### Mode 10: Peripheral Texture Synthesis (Default)

Now the default rendering mode. Requires WebGPU (`navigator.gpu`). Falls back gracefully to Tier 1.6 (MIP blur) on unsupported hardware. Temporal smoothing (EMA, blend factor 0.3) damps frame-to-frame tile stat jitter — only variance and orientation energies are smoothed; means pass through instantly to avoid color lag during cursor movement.

---

## Bouma-Scaled Edge Density Gate

The congestion map now gets MIP-sampled at the MIP level corresponding to Bouma's critical spacing (0.5 × eccentricity). The GPU MIP chain integrates edge density over a Bouma-sized neighborhood. V1 handles eccentricity-dependent displacement; MIP handles spacing-dependent pooling.

---

## Oklab Luminance Variance Metrics

`compare-crowding-modes.js` now computes Oklab L-channel variance in corresponding patches across rendering modes:

```
varianceRatio = var(mongrel_L) / var(mipBlur_L)
```

Two new hypotheses:
- **H5**: Oklab L variance ratio > 1.0 at ≥6° — **PASS** (avg 1.04). The compute mongrel preserves 3.5% more luminance contrast than MIP blur in the peripheral field.
- **H6**: Chrominance variance ratio ≈ 1.0 at ≥6° — **PASS** (avg 0.91). Both modes pool color similarly.

The 3° band straddles the foveal boundary (fovealRadius = 90px = 2.37°) and is classified as a transition zone, not passthrough.

---

## Auto-Updater & Citation Metadata

- Upgraded electron-updater for improved GitHub release detection
- Golden captures now embed citation metadata (version, mode, URL, timestamp) as PNG text chunks
