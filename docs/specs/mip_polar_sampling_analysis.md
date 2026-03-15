# MIP/Polar Sampling Analysis — Foveal Boundary LOD Fix

> **Last updated:** 2026-03-14

**Status**: SHIPPED (commit a5982dc, branch `claude/fix-webgl-mip-sampling-3kHXs`)
**File**: `renderer/shaders/peripheral.frag` (processV4, sampleSourceGrad, sampleMIPPooledGrad)
**Related**: `docs/specs/cmf_mip_derivation.md`, `docs/specs/isotropic_cortical_sampling.md`

## Problem Statement

The peripheral blur uses a MIP chain for spatial frequency decomposition, but the `textureGrad` callers in `processV4` were passing screen-space derivatives of the **undistorted** UV while sampling at the **V1-distorted** UV. This is a Jacobian mismatch: the hardware LOD selection doesn't see the UV stretching introduced by the V1 crowding warp.

Near the foveal boundary where V1 distortion ramps in (the `parafoveaRamp` smoothstep), radial gradients diverge from tangential gradients. The undistorted `dFdx(uv)` / `dFdy(uv)` are spatially uniform, but the actual rate of change across screen pixels for `v1.distortedUV` is anisotropic — stretched radially by crowding. The hardware `textureGrad` picks LOD from the maximum gradient magnitude (per the OpenGL ES 3.0 spec §3.8.9), so it selects based on the wrong Jacobian.

**Symptom**: Over-blurring in the radial direction (toward/away from fixation) and under-blurring in the tangential direction at the foveal boundary annulus.

## Investigation: Three MIP Sampling Paths

The shader has three distinct sampling paths, each with different LOD behavior:

### Path 1: DoG band decomposition (primary path, `u_dog_enabled=1`)

```glsl
// sampleDoGReconstructed — 9 explicit textureLod calls
mip[0] = textureLod(u_texture, uv, 0.0);
mip[1] = textureLod(u_texture, uv, 0.5);
// ... through LOD 4.0
```

**LOD method**: Explicit `textureLod` at fixed half-octave LOD values (0.0, 0.5, 1.0, ..., 4.0). Hardware LOD selection is bypassed entirely. Band weights are computed from scalar eccentricity via `computeMipLevel()`.

**Isotropy**: **Not affected.** The 9 samples are all point-sampled at known LODs. The isotropic eccentricity→weight mapping is biologically correct — retinal ganglion cell receptive field sizes scale isotropically with eccentricity. Radial/tangential anisotropy in crowding is handled upstream in V1, not in the band decomposition.

### Path 2: Legacy MIP pooling (`u_dog_enabled=0`, no gradient mode)

```glsl
// sampleMIPPooled — single textureLod
float mipLevel = computeMipLevel(eccentricity, fovea_radius);
vec4 col = textureLod(u_texture, uv, mipLevel);
```

**LOD method**: Explicit `textureLod` with scalar eccentricity-derived LOD. Hardware LOD selection bypassed.

**Isotropy**: **Not affected** (same reasoning as DoG path).

### Path 3: Gradient-aware MIP pooling (legacy fallback)

```glsl
// sampleMIPPooledGrad — textureGrad with scaled derivatives
vec4 col = textureGrad(u_texture, uv,
    duvdx * pow(2.0, mipLevel),
    duvdy * pow(2.0, mipLevel));
```

**LOD method**: `textureGrad` with screen-space derivatives scaled by `2^mipLevel`. Hardware LOD selection is active and uses the provided gradients.

**Isotropy**: **AFFECTED.** If the input gradients are from `dFdx(uv)` (undistorted) but the sampling UV is `v1.distortedUV`, the Jacobian is wrong. Additionally, the isotropic scaling (`* pow(2.0, mipLevel)`) stretches both axes equally, which is correct for eccentricity-based resolution loss but ignores the V1 distortion anisotropy.

### Path 4: Foveal reference sample (all modes)

```glsl
// processV4 — foveal sample used in mix()
vec3 foveaCol = sampleSourceGrad(v1.distortedUV, duvdx, duvdy).rgb;
```

**LOD method**: `textureGrad` with raw screen-space derivatives. Hardware picks LOD from `max(|duvdx|, |duvdy|)`.

**Isotropy**: **AFFECTED.** This is the most impactful case. The foveal color is blended with the peripheral color via `mix(foveaCol, pooledCol, blendFactor)`. If `foveaCol` has incorrect LOD, the blend creates visible artifacts at the foveal boundary — the one region users look at most carefully.

## The Fix

Replace `dFdx(uv)` with `dFdx(v1.distortedUV)` for all `textureGrad` callers in `processV4`:

```glsl
// Before (incorrect):
vec2 duvdx = dFdx(uv);
vec2 duvdy = dFdy(uv);
vec3 foveaCol = sampleSourceGrad(v1.distortedUV, duvdx, duvdy).rgb;

// After (correct):
vec2 distDuvdx = dFdx(v1.distortedUV);
vec2 distDuvdy = dFdy(v1.distortedUV);
vec3 foveaCol = sampleSourceGrad(v1.distortedUV, distDuvdx, distDuvdy).rgb;
```

`dFdx(v1.distortedUV)` computes the screen-space derivative of the *distorted* UV, which correctly captures the Jacobian of the V1 crowding warp. Since `v1.distortedUV` is computed per-fragment in `processV1`, the GLSL `dFdx`/`dFdy` intrinsics automatically differentiate through the entire distortion pipeline — no manual Jacobian computation needed.

**Affected callers** (all in `processV4`):
1. Foveal reference sample (`sampleSourceGrad`)
2. Legacy gradient MIP path (`sampleMIPPooledGrad`)
3. Oklab chromatic attenuation neighbor samples (V4 style 6)

**Performance**: Zero cost. `dFdx`/`dFdy` on a varying is a single instruction on all GPUs (reads from the 2×2 quad helper lanes). Replacing one `dFdx(uv)` with `dFdx(v1.distortedUV)` changes which register is differenced, not the instruction count.

## What Was NOT Changed (and Why)

### DoG band weights remain isotropic

The `computeMipLevel()` function maps scalar eccentricity to LOD 0–4:

```glsl
float computeMipLevel(float eccentricity, float fovea_radius) {
    float normalizedEcc = max(0.0, eccentricity) / fovea_radius;
    // CMF: log(1 + r/a) normalized
    // Linear: normalizedEcc * 2.5
}
```

This is intentionally isotropic. Retinal ganglion cell receptive field sizes grow with eccentricity without radial/tangential bias. The anisotropy in peripheral vision comes from cortical crowding (V1/V2), not from resolution limits (retinal). Scrutinizer correctly separates these:
- **V1** (`processV1`): Applies directional crowding with `u_crowding_radial_bias` (2:1 radial:tangential, Toet & Levi 1992)
- **DoG** (`sampleDoGReconstructed`): Applies isotropic resolution loss via band attenuation

Introducing radial/tangential asymmetry into the band weights would conflate two distinct biological mechanisms.

### The `coupledEccentricity` indirection

`processV4` feeds `coupledEccentricity = v1.distortionStrength * u_intensity * fovea_radius * blurMult` into the DoG/MIP functions. This means the effective blur depends on how much V1 distorted the UV, not on raw eccentricity. This is an intentional design choice (attention-gated resolution, not purely position-dependent), though it diverges from strict retinal biology. See `dog-review-findings.md` item 4.

### Hardware MIP chain is box-filtered, not Gaussian

`gl.generateMipmap()` uses bilinear (box) downsampling, not Gaussian convolution. Band differences are "Difference of Boxes," not true DoG. This introduces spectral leakage between bands but is qualitatively acceptable. True Gaussian pyramids (Burt & Adelson 1983) would require a custom FBO downsample chain. This is a known limitation, not a bug to fix here.

## Validation

### Confirming the fix improves boundary quality

1. **Visual A/B**: Load a text-heavy page. Compare foveal boundary sharpness with the cursor positioned so text sits in the transition zone. The fix should reduce the "ghosting" or "halo" effect where the foveal reference bleeds into early peripheral blur.

2. **Spatial acuity capture**: Run the existing validation pipeline:
   ```bash
   node scripts/capture-spatial-acuity.js
   node scripts/analyze-spatial-acuity.js
   ```
   The M-scaling curve in far periphery should be unchanged (the fix only affects `textureGrad` callers, and the DoG path uses `textureLod`). Near the boundary (1–2° eccentricity), the effective resolution should improve slightly.

3. **Gaussian comparison control**: Toggle `u_gaussian_blur_mode=1.0`. This path uses `sampleMIPPooled` (explicit `textureLod`), bypassing `textureGrad` entirely. If boundary artifacts are present in DoG mode but absent in Gaussian mode at the same eccentricity, the issue was in gradient handling, not band weighting.

4. **Debug overlay**: Enable `u_debug_boundary=1.0` to render the band-weight diagnostic. The fix does not change band weights — only the foveal reference sample LOD — so the debug overlay should be identical pre/post.

### Confirming against Rovamo & Virsu (1979) data

The `scripts/analyze-dog-bands.js` validation harness computes band weights at fine eccentricity steps and reports `equivalentMipLevel()` — the effective Gaussian blur if bands were replaced with a single sample. This should match the cortical magnification prediction:

```
M(e) = M(0) / (1 + e/E₂)
```

where E₂ ≈ 2.5° for grating acuity (Rovamo & Virsu 1979, Table 1). Run:

```bash
node scripts/analyze-dog-bands.js --e2=2.5 --cmf
```

The `equivalentMipLevel` column should produce a smooth, monotonically increasing curve. If the fix introduced any band-weight discontinuity (it shouldn't — band weights are computed in `sampleDoGReconstructed` from scalar eccentricity, unaffected by gradient changes), it would appear as a step or plateau in this output.

## Future Work

- **Isotropic cortical sampling** (`docs/specs/isotropic_cortical_sampling.md`): Replace the ad-hoc `computePolarSector()` geometry with CMF-derived ring/spoke boundaries. This is orthogonal to the gradient fix but addresses a related concern — the current polar grid has fixed 2:1 aspect ratio instead of eccentricity-dependent isotropic cells.

- **Per-axis gradient scaling** in `sampleMIPPooledGrad`: The current `pow(2.0, mipLevel)` scaling is isotropic. A future enhancement could project gradients onto radial/tangential axes and scale independently, though this would only benefit the legacy (non-DoG) path.

## References

- Schwartz, E. L. (1980). Computational anatomy and functional architecture of striate cortex. *Vision Research*, 20(8), 645–669.
- Burt, P. J., & Adelson, E. H. (1983). The Laplacian pyramid as a compact image code. *IEEE Transactions on Communications*, 31(4), 532–540.
- Rovamo, J., & Virsu, V. (1979). An estimation and application of the human cortical magnification factor. *Experimental Brain Research*, 37(3), 495–510.
- Toet, A., & Levi, D. M. (1992). The two-dimensional shape of spatial interaction zones in the parafovea. *Vision Research*, 32(7), 1349–1357.
- Blauch, N. M., Alvarez, G. A., & Konkle, T. (2026). A model of foveated visual processing. *arXiv:2602.03766*.
- OpenGL ES 3.0 Specification, §3.8.9 — Texture Minification (LOD selection from implicit derivatives).
