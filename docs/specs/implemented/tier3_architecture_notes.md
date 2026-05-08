# Tier 3 Architecture Notes — Lessons from Tier 2.75

> Written: 2026-03-22
> Context: Full day attempting to make pyramid synthesis work as both
> a compute-side improvement and a standalone degradation mechanism.

## The architectural problem

The fragment shader (`peripheral.frag`) has a deep dependency chain:

```
V1 displacement → distortionStrength → coupledEccentricity → MIP blur level
                                     → blend factor
                                     → chromatic decay strength
                                     → desaturation strength
                                     → contrast preservation
```

Everything downstream of V1 scales by `distortionStrength`. Setting it to
zero kills the entire rendering pipeline. The compute texture compositing
(`TEXTURE5`) is designed to REPLACE the MIP pooling output, not the entire
pipeline. It was built for Tier 2.5's oriented noise, which is visually
distinct from the source — so replacing MIP with it produces visible
degradation.

The pyramid synthesis compute texture contains tile-mean content + noise.
Tile-mean at 8x8 is visually close to the original image (letters are
still recognizable). When the fragment shader composites this at high
alpha, it pulls the output back toward the undistorted source, undoing
the displacement.

## What Tier 3 needs to change

### Option A: Fragment shader refactor (recommended)

Decouple the degradation pipeline from V1 displacement:

1. **Eccentricity-driven blend**, not distortionStrength-driven. The blend
   factor, chromatic decay, desaturation should all key off `eccentricity`
   (distance from gaze) directly. V1 displacement becomes optional — one
   of several degradation mechanisms, not the gateway to all others.

2. **Compute texture as primary output.** When `compute_tier >= 3.0`, the
   fragment shader should:
   - Skip V1 displacement entirely
   - Use the compute texture RGB as `pooledCol` directly
   - Apply chromatic decay, desaturation, contrast effects based on
     eccentricity (not distortionStrength)
   - The compute texture IS the peripheral representation

3. **Compute texture must produce degraded content.** The pyramid synthesis
   needs to output content that is already unreadable — not tile-mean +
   noise (which looks like the original), but actual spatial pooling that
   destroys letter identity. This means:
   - Larger effective pooling regions in far periphery (not fixed 8x8)
   - Actual Gaussian blur within the pooling region (rather than tile mean alone)
   - The tile-mean approach preserves too much structure

### Option B: Compute-side blur (simpler)

Instead of refactoring the fragment shader, make the compute texture
contain already-degraded content:

1. Add a Gaussian blur pass in the WebGPU pipeline, after decomposition
   but before stats/synthesis. The blur radius scales with eccentricity.
2. Extract stats from the blurred content, not the original.
3. Synthesize from the blurred stats.

The output would be: blurred content + texture noise — visually distinct
from the source, so the fragment shader's compositing doesn't undo
the degradation.

This is simpler than Option A but less architecturally clean. It means
the compute shader does its own blur (duplicating what MIP already does
in the fragment shader), and the fragment shader's displacement still
runs underneath.

### Option C: Eccentricity-scaled tiles (medium)

Instead of fixed 8x8 tiles, scale tile size with eccentricity:
- Fovea: 4x4 (fine detail preserved)
- Parafovea: 8x8 (current)
- Near periphery: 16x16 (text starts to blur)
- Far periphery: 32x32 or 64x64 (content unrecognizable)

At 64x64 (half-res), the tile mean of a text region is uniform grey.
The synthesis output would be grey + texture noise — visually degraded
without needing fragment shader changes.

This connects back to the isotropic sector geometry from v2.6 — sectors
grow with eccentricity, which is exactly this scaling. But implementing
variable-size tiles in the compute pipeline requires restructuring the
accumulation (can't use fixed workgroup = fixed tile).

## Recommendation

**Option C first, then Option A.** ✅ Both shipped.

Option C (eccentricity-scaled sectors) shipped v2.7.1:
- CMF-based sector assignment (Blauch et al. 2026), ~3,200 sectors
- Activated via `num_cortical_rings: 50` in mode config
- SSIM dropped from ~1.0 to 0.37 on dense content

Option A (fragment shader decouple) shipped 2026-03-30:
- V1_Signal extended with v4PoolingStrength / v4EffectStrength
- EccentricityProfile struct centralizes master curve (t, t², t³)
- `u_v4_eccentricity_source` uniform: 0.0=v1_coupled, 1.0=eccentricity
- Mode 15 uses eccentricity-direct path with v1_strength_mult: 0.0
- See `option_a_decouple_spec.md` for full spec and incremental plan

## Performance notes

Current Tier 2.75 pipeline: ~15 dispatches, measured stable (no safety
harness fallbacks on M3). Adding eccentricity-scaled tiles would not
increase dispatch count — just change the tile-to-pixel mapping in the
stats extraction pass.

## Files to modify for each option

### Option C (eccentricity-scaled tiles)
- `renderer/shaders/pyramid-stats.wgsl` — variable tile sizes per pixel
- `renderer/webgpu-pyramid-compute.js` — sector-aware buffer allocation
- `tests/unit/isotropic-sectors.test.js` — reference for sector geometry

### Option A (fragment shader refactor)
- `renderer/shaders/peripheral.frag` — decouple from distortionStrength
- `renderer/webgl-renderer.js` — new uniforms for eccentricity-driven effects
- `shared/modes.json` — new mode with compute_tier: 3.0
