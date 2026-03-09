# Continuous Chromatic MIP Sampling

> **Last updated:** 2026-03-07

Date: 2026-03-05
Revised: 2026-03-05
Status: Phase 1 (pow fix) SHIPPED v1.9.0; Phase 2 (decay recalibration) IN PROGRESS; Phase 3 (continuous size dependence) DEFERRED
Dependencies: Per-channel chromatic pooling (v1.9.0, implemented), DoG band decomposition (v1.6, implemented)

## Problem

The v1.9.0 chromatic pooling implementation attenuates chrominance per DoG band — 4 discrete spatial frequency buckets with step-function transitions. A full-width banner and a 200px button both land in the same low-frequency band and get identical chromatic treatment. The biology is continuous: chromatic spatial resolution degrades smoothly with eccentricity, and the pooling region size grows smoothly with stimulus scale.

The 4-band approach gets the channel asymmetry right (RG fast, YV slow) but gets the size dependence wrong — it's a step function where it should be a smooth curve.

## Failed Approach: Cross-Resolution Oklab Composition

### What we tried

Replace per-band `chromaticAttenuate()` calls with 2 extra `textureLod` samples at per-channel MIP levels. Take L (luminance) from the DoG reconstruction, Oklab `a` from an RG MIP sample, Oklab `b` from a YV MIP sample. Continuous size dependence falls out of the hardware MIP chain's spatial averaging.

```glsl
vec3 achLab = rgbToOklab(dogResult.rgb);       // L from DoG
vec3 rgLab  = rgbToOklab(textureLod(..., rgMip));  // a from RG resolution
vec3 yvLab  = rgbToOklab(textureLod(..., yvMip));  // b from YV resolution
vec3 finalLab = vec3(achLab.x, rgLab.y * rgAtten, yvLab.z * yvAtten);
```

### Why it failed

**Out-of-gamut Oklab triples.** The valid range of `a` and `b` in Oklab depends on `L`. Taking L from one spatial resolution and chrominance from different resolutions creates (L, a, b) triples that don't correspond to any real sRGB color. After `oklabToRgb` and clamping, the result washes toward white — especially where the DoG reconstruction's averaged luminance (moderate-to-high L) is paired with chrominance from differently-blurred samples.

The color spectrum page went almost entirely white. The dashboard retained layout but lost nearly all peripheral effects.

### Constraint discovered

> **L, a, b must come from the same spatial source to produce valid Oklab colors.**
>
> Any approach that composes Oklab channels from different spatial resolutions will produce out-of-gamut results. The Oklab color space is not separable in the way this architecture assumed.

## Existing Implementation: Deeper Problems

Investigation of the "understated desaturation" in the v1.9.0 comparison revealed three issues in the current per-band approach that compound to make chromatic pooling visually too gentle.

### Bug 1: `pow(negative, 1.0/3.0)` is undefined in GLSL

`chromaticAttenuate()` is called on DoG bands — differences between adjacent MIP levels (e.g., `band0 = mip0 - mip1`). These have negative RGB components. The Oklab conversion (`linearSrgbToOklab`, line 367) computes LMS via matrix multiply, then takes cube roots: `pow(l, 1.0/3.0)`. When `l < 0`, this is **undefined behavior** per GLSL ES 3.0 spec §8.2.

On macOS Metal, `pow(negative, fractional)` likely returns 0 or NaN. Either way, `chromaticAttenuate()` returns black (or garbage) for all band inputs. **Only the residual (mip4) actually contributes chrominance.** The per-band frequency-dependent attenuation — the entire architectural premise of v1.9.0 chromatic pooling — is a no-op.

**Fix:** Use sign-preserving cube root: `sign(x) * pow(abs(x), 1.0/3.0)` in `linearSrgbToOklab`. Or restructure to avoid Oklab on band differences entirely.

### Bug 2: YV decay calibrated to detection threshold, not appearance

`u_yv_decay = 0.004` is castleCSF's detection threshold k_e for the S-(L+M) channel. At suprathreshold contrasts (saturated UI colors), chromatic appearance decays faster than detection threshold predicts.

Bowers, Gegenfurtner & Goettker (2025) measured suprathreshold YV at **79% at 15°**. Back-computing with supra=0.5:

```
0.79 = pow(10^(-k_yv × 15), 0.5)
10^(-k_yv × 15) = 0.624
k_yv = 0.014
```

The suprathreshold-corrected YV decay should be **~0.014**, not 0.004 — a 3.5× increase.

| Eccentricity | k_yv=0.004 (current) | k_yv=0.014 (corrected) |
|-------------|---------------------|----------------------|
| 7° (300px)  | 95% retained        | 89% retained         |
| 15° (640px) | 91% retained        | 79% retained         |
| 21° (edge)  | 87% retained        | 71% retained         |

YV is still the gentlest channel (biologically correct), but the current value barely attenuates at all.

### Bug 3: Red Kill Switch disabled without equivalent replacement

Lines 820-828: the legacy path applies a **95% chrominance kill** in the far periphery via `desatStrength = peripheralFade * 0.95`. When `u_chromatic_pooling > 0.5`, this is skipped entirely. The per-band attenuation was supposed to replace it, but due to Bug 1 (pow UB), only the residual contributes chrominance, and due to Bug 2 (YV too gentle), even that attenuation is insufficient.

Net result at screen edge (~21°):

| Path | RG retained | YV retained |
|------|------------|-------------|
| Legacy (chromatic OFF) | ~2% | ~2% |
| Per-channel (chromatic ON) | ~10% | ~34% |
| Per-channel (bugs fixed, est.) | ~5% | ~15% |

The legacy path is overly aggressive (Rosenholtz is right that uniform gray is wrong), but the per-channel path overshoots in the other direction.

## Revised Approach

Three changes, in priority order. Each is independently shippable.

### Phase 1: Fix the pow() UB (prerequisite for everything else)

Replace the cube root in `linearSrgbToOklab` with a sign-preserving version:

```glsl
// Current (line 371) — undefined for negative LMS:
float l_ = pow(l, 1.0 / 3.0);

// Fixed — handles negative band differences:
float l_ = sign(l) * pow(abs(l), 1.0 / 3.0);
```

Apply to all three components (l, m, s). This makes `chromaticAttenuate()` actually work on band data for the first time. The per-band frequency-dependent attenuation that was designed in v1.9.0 will finally take effect.

**Risk:** Enabling band chrominance may make the output MORE colorful (more chrominance sources contributing). Need to recapture and evaluate before Phase 2 tuning.

Cost: 6 extra ALU ops (3× sign, 3× abs). Negligible.

### Phase 2: Calibrate YV decay to suprathreshold

Change `u_yv_decay` default from **0.004 → 0.014**. This aligns with Bowers et al. 2025 suprathreshold measurements.

Optionally calibrate `u_rg_decay` too. Current 0.059 is threshold. Bowers reports RG at 29% at 15°:

```
0.29 = pow(10^(-k_rg × 15), 0.5)
10^(-k_rg × 15) = 0.084
k_rg = 0.072
```

Modest increase: 0.059 → 0.072. The RG channel was already reasonably aggressive; YV is the bigger gap.

| Parameter | Current (threshold) | Revised (suprathreshold) | Source |
|-----------|-------------------|------------------------|--------|
| u_rg_decay | 0.059 | 0.072 | Bowers 2025: 29% at 15° |
| u_yv_decay | 0.004 | 0.014 | Bowers 2025: 79% at 15° |

### Phase 3: Continuous size dependence (deferred)

The original motivation — size-dependent chromatic pooling — remains valid. But the cross-resolution Oklab approach is ruled out. Two viable alternatives:

**Option A: Per-MIP-level attenuation (pre-band)**

Attenuate chrominance on MIP levels *before* computing band differences. Each MIP level is a valid RGB image, so the Oklab round-trip is safe. Band differences are then computed from chromatically-attenuated MIP levels.

```glsl
// Attenuate each MIP level's chrominance before banding
vec4 mip0_c = chromaticAttenuate(mip0.bgra, rg_atten_mip0, yv_atten_mip0);
vec4 mip1_c = chromaticAttenuate(mip1.bgra, rg_atten_mip1, yv_atten_mip1);
// ... etc
// Then compute bands from attenuated MIPs
vec4 band0_c = mip0_c - mip1_c;
// Reconstruct with weights
result = mip4_c + band3_c * w3 + band2_c * w2 + band1_c * w1 + band0_c * w0;
```

Same cost as current approach (5 Oklab round-trips) but attenuation operates on valid RGB, and size dependence comes naturally from MIP spatial averaging: a 200px button at MIP 4 is a 12px blob (diluted color), while a full-width banner at MIP 4 is 120px (retains color). Different chromatic content → different appearance after attenuation.

**Option B: Single-pass post-reconstruction**

One Oklab round-trip on the fully reconstructed DoG result. Attenuate `a` and `b` with continuous eccentricity-dependent factors. Loses per-band frequency dependence but gains simplicity. Since Bug 1 means per-band was effectively single-pass anyway (only residual contributed), this formalizes what was accidentally happening.

```glsl
result = clamp(mip4 + band3*w3 + band2*w2 + band1*w1 + band0*w0, 0.0, 1.0);
result = result.bgra;
vec3 lab = rgbToOklab(result.rgb);
lab.y *= rgAtten;  // continuous function of eccentricity
lab.z *= yvAtten;
result = vec4(oklabToRgb(lab), result.a);
```

Cost: 1 Oklab round-trip (down from 5). Significant perf win.

**Recommendation:** Ship Phases 1+2 first. Evaluate whether the now-functional per-band attenuation provides sufficient differentiation. If not, pursue Option A for Phase 3.

## What Does NOT Change

- DoG band decomposition and M-scaling weights (achromatic spatial resolution)
- V1 distortion, LGN gating, saliency modulation
- Base desaturation in V4 (smoothstep ramp, complementary to per-channel)
- Saccadic blindness
- `u_chromatic_pooling` toggle — still gates per-channel vs legacy
- Red Kill Switch gating logic (disabled when chromatic pooling ON — revisit if Phase 1+2 insufficient)

## Predictions After Phase 1+2

| Scenario | Current (buggy) | After fixes |
|----------|----------------|-------------|
| Red text at 10° | Mild desaturation (residual only) | Stronger: band-level RG attenuation now functional |
| Blue sidebar at 15° | Almost full color (YV=91%) | Moderate: YV=79% (matches Bowers measurement) |
| Full-width banner vs 200px button | Nearly identical | Still similar (Phase 3 needed for size dependence) |
| Overall peripheral color | Feels understated | Closer to calibrated — between legacy gray and current overshoot |

## Validation

1. Fix pow UB → recapture color-spectrum chromatic comparison
2. A/B with legacy: right panel should show clear desaturation, with visible RG/YV asymmetry
3. Compare against Bowers et al. 2025 Figure 2: RG≈29%, YV≈79% at 15°
4. Dashboard: blue sidebar should retain more identity than red badges at equal eccentricity
5. Recapture all chromatic golden shots after each phase

## References

- Abramov, Gordon & Chan (1991) — perceptive fields for color: size-dependent appearance
- Ashraf et al. (2024) — castleCSF: k_e and k_ef parameters per channel (detection threshold)
- Bowers, Gegenfurtner & Goettker (2025) — chromatic CSF to 90°, biphasic RG decay (suprathreshold)
- Jiang, Shooner & Mullen (2022) — suprathreshold compression exponent
- GLSL ES 3.0 spec §8.2 — pow(x, y) undefined for x < 0, non-integer y
