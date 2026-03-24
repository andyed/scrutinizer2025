# Tier 3 TTM Synthesis — Lessons Learned (2026-03-24)

## What we tried

Enabling mode 15 (TTM Tier 3) as default: eccentricity-scaled sector pooling replacing V1 displacement entirely. Three code changes:

1. **`useSectors = true`** in `webgpu-pyramid-compute.js` — enabled the sector assignment shader
2. **`maxSectors = 65536`** — fixed sector ID overflow (ring offsets need ~41K IDs)
3. **Fragment shader Tier 3 path** — full-strength blend, bypassed smooth content snap-back and magnocellular contrast restoration

## What happened

The compute pipeline worked correctly:
- Sector assignment shader ran, assigning ring-based sector IDs (4px→64px tiles by eccentricity)
- Stats extraction accumulated per-sector means and cross-scale correlations
- Synthesis produced valid RGBA output with 98%+ non-zero alpha
- Readback and WebGL upload succeeded

But the visual output showed **no visible degradation**. Text remained readable everywhere.

## Root causes (5 stacked issues)

### 1. Sector means too close to original on sparse content
Dashboard/web pages with lots of whitespace: a 64x64 sector containing "Wireless Headphones" on white background has a mean that's ~98% white. The text is a thin line representing <5% of sector pixels. The synthesis output (mean + weak bandpass noise) looks nearly identical to the original.

**This is actually correct TTM behavior for sparse content.** Isolated text on plain background IS readable in peripheral vision (low crowding). It's flanked/dense text that gets destroyed. The dashboard is too sparse to trigger crowding.

### 2. Blend factor capped at 60%
`blendFactor = baseBlend * u_intensity` where intensity=0.6 was tuned for displacement modes. With pooling-only (no displacement), 60% blend of near-identical content = invisible effect.

Even after fixing to 100% blend, the effect was subtle because of issue #1.

### 3. Smooth content snap-back
`pooledCol = mix(pooledCol, foveaCol, smoothContent)` at lines 1300-1302 — designed to prevent Mach bands on smooth gradients. In Tier 3, foveaCol is the ORIGINAL page (no V1 displacement), so any pooledCol close to the original gets snapped back to it. This killed ~80% of the remaining effect.

### 4. Magnocellular contrast preservation
`col *= mix(1.0, lumaRatio, contrastPreservation)` — restores luminance contrast from the clean source image. Partially undoes the contrast reduction from sector-mean pooling.

### 5. Bilinear texture upsampling
The compute texture at half-res (960x506) is upsampled to full canvas (3840x2024) via WebGL bilinear filtering. Sector boundaries (where mean colors change abruptly) get smoothed, making transitions gradual rather than showing distinct pooling blocks.

## What this means for the TTM plan

The tier3_ttm_synthesis_plan.md already identified the quality gap: "no cross-scale magnitude correlations. This is the statistic that makes text look like horizontal stripes instead of random noise." The current Tier 2.75/3.0 synthesis uses **tile mean + weak bandpass noise**, which is equivalent to MIP blur with extra steps.

### The real path forward

1. **Cross-scale correlations** (Phase 2 of TTM plan) are the quality leap. When the synthesis matches parent-child magnitude correlations, text regions produce horizontal-stripe-like textures instead of flat means. This is the difference between "blur" and "mongrel."

2. **Don't bypass displacement.** Tier 3's `v1_strength_mult: 0.0` removes the only visible degradation mechanism that works. Until the synthesis itself produces destructive output, V1 displacement should remain active. Consider a hybrid: Tier 2.75 pyramid synthesis WITH eccentricity-scaled sectors, keeping V1 displacement.

3. **Sector geometry works.** The sector assignment shader is functional, the ring-based eccentricity scaling produces correct sector IDs (with maxSectors bumped to 65K), and the stats/synth pipeline handles sector mode. The infrastructure is ready for better statistics.

4. **The fragment shader Tier 3 path works.** `u_compute_tier >= 3.0` gates correctly, compute texture is sampled, alpha blend is functional. The issues were all about the quality of what the compute texture contains, not the rendering pipeline.

## Key takeaway

Sector pooling alone ≠ visible degradation. The TTM quality comes from the **statistics being matched**, not from the pooling geometry. Sectors provide the correct spatial scale for pooling regions, but without cross-scale correlations and marginal statistics driving the synthesis, the output is just a slightly noisy block average — which, for clean web UI, looks like the original page.

## Files touched (all reverted)

- `renderer/webgpu-pyramid-compute.js` — useSectors parameter, maxSectors increase
- `renderer/scrutinizer.js` — isTier3 flag, sector dispatch, debug logging
- `renderer/shaders/peripheral.frag` — Tier 3 blend/bypass changes
