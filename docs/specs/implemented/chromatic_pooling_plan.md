---
planStatus:
  planId: plan-chromatic-pooling
  title: Chromatic Pooling — Per-Channel RG/YV Eccentricity Decay
  status: ready-for-development
  planType: feature
  priority: high
  owner: andyed
  tags:
    - perception
    - shader
    - v1.9
    - rosenholtz-meeting
  created: "2026-03-04"
  updated: "2026-03-04T15:23:11.000Z"
  progress: 0
---

# Chromatic Pooling — Per-Channel RG/YV Eccentricity Decay

## Goals
- Replace uniform Oklab chrominance reduction with biologically accurate per-channel chromatic pooling
- RG (red-green, Oklab `a`) decays ~2.5× faster than achromatic with eccentricity (k_e=0.059, pre-v2.0 detection threshold; current v2.5 default: 0.085)
- YV (blue-yellow, Oklab `b`) persists far into periphery and is frequency-dependent (k_e=0.004, pre-v2.0 detection threshold; current v2.5 default: 0.014; k_ef=0.008)
- Use existing DoG band decomposition to solve size dependence (small red text loses color fast; large blue background retains it)
- Ship as part of v1.9.0 alongside CMF fix and oriented DoG bands
- Demo-ready for Rosenholtz/Blauch meeting (~March 14)

## Overview

Current V4 pipeline applies a single `desaturationFactor` to both Oklab `a` and `b` channels. This is biologically incorrect — L-M (red-green) is a foveal specialization that loses spatial resolution rapidly, while S-(L+M) (blue-yellow) persists much further. At 15° eccentricity, RG threshold sensitivity retains only 29% while YV retains 79% (Bowers, Gegenfurtner & Goettker 2025) — and suprathreshold appearance is more forgiving still (Jiang, Shooner & Mullen 2022). Peripheral color is pooled over larger regions, not simply removed.

The DoG band decomposition already sorts content by spatial frequency. Per-band chromatic attenuation gives us size-dependent color decay for free: a small red icon at 10° loses its red, but a large blue hero section keeps its blue.

**Key meeting angle**: Ruth's TTM demos don't model chromatic asymmetry. This is a gap Scrutinizer fills.

## Implementation Details

### Step 1: Add shader uniforms (`peripheral.frag`)

Add after existing FOVI uniforms (line ~48):

```glsl
uniform float u_chromatic_pooling;  // 0=off (legacy uniform desat), 1=on
uniform float u_rg_decay;           // castleCSF k_e for RG (default 0.059 pre-v2.0 detection threshold; v2.5: 0.085)
uniform float u_yv_decay;           // castleCSF k_e for YV (default 0.004 pre-v2.0 detection threshold; v2.5: 0.014)
uniform float u_yv_freq_decay;      // castleCSF k_ef for YV (default 0.008)
```

### Step 2: Add `chromaticAttenuate()` helper function

Place near existing `rgbToOklab`/`oklabToRgb` functions (~line 329):

```glsl
vec4 chromaticAttenuate(vec4 color, float rg_atten, float yv_atten) {
    vec3 lab = rgbToOklab(color.rgb);
    lab.y *= rg_atten;   // a channel (red-green)
    lab.z *= yv_atten;   // b channel (blue-yellow)
    return vec4(oklabToRgb(lab), color.a);
}
```

### Step 3: Modify `sampleDoGReconstructed()`

After the existing reconstruction at line ~176 (`vec4 result = clamp(mip4 + band3*w3 + ...)`), add a chromatic branch:

```glsl
if (u_chromatic_pooling > 0.5) {
    // Convert normalized eccentricity to degrees
    // normEcc is eccentricity / fovea_radius; fovea ≈ 2° visual angle
    float ecc_deg = normEcc * 1.0;  // fovea_deg = 1.0 (1° foveal radius)

    // RG: frequency-independent steep decay (wiring constraint)
    float rg_atten = pow(10.0, -u_rg_decay * ecc_deg);

    // YV: frequency-dependent, per-band
    // Band spatial frequencies: band0≈4cpd, band1≈2cpd, band2≈1cpd, band3≈0.5cpd, residual≈0.25cpd
    float yv_atten_band0 = pow(10.0, -(u_yv_decay + u_yv_freq_decay * 4.0) * ecc_deg);
    float yv_atten_band1 = pow(10.0, -(u_yv_decay + u_yv_freq_decay * 2.0) * ecc_deg);
    float yv_atten_band2 = pow(10.0, -(u_yv_decay + u_yv_freq_decay * 1.0) * ecc_deg);
    float yv_atten_band3 = pow(10.0, -(u_yv_decay + u_yv_freq_decay * 0.5) * ecc_deg);
    float yv_atten_res   = pow(10.0, -(u_yv_decay + u_yv_freq_decay * 0.25) * ecc_deg);

    // Per-band chromatic attenuation via Oklab round-trips
    result = chromaticAttenuate(mip4,  rg_atten, yv_atten_res);
    result += chromaticAttenuate(band3, rg_atten, yv_atten_band3) * w3;
    result += chromaticAttenuate(band2, rg_atten, yv_atten_band2) * w2;
    result += chromaticAttenuate(band1, rg_atten, yv_atten_band1) * w1;
    result += chromaticAttenuate(band0, rg_atten, yv_atten_band0) * w0;
    result = clamp(result, 0.0, 1.0);
}
```

**Important**: This replaces the luminance-only reconstruction path when enabled. The existing V4 uniform chrominance reduction (lines 710-783) still runs downstream — need to decide whether chromatic pooling **replaces** V4 chrominance reduction or **supplements** it.

**Decision**: When `chromatic_pooling` is enabled, skip the V4 uniform pass (the per-band attenuation already handles chromatic spatial resolution loss). Add a guard:

```glsl
// In V4 desaturation section (~line 710):
if (u_chromatic_pooling > 0.5) {
    // Chromatic attenuation already applied in DoG reconstruction
    // Skip uniform chrominance reduction — but still apply Purkinje/rod effects if mode 1
}
```

For mode 1 (Biological/Purkinje), the Purkinje darkening of red objects should still apply on top of chromatic pooling — it's a separate photoreceptor effect (rod-cone transition), not redundant.

### Step 4: Renderer uniform plumbing (`webgl-renderer.js`)

**Declarations** (after FOVI uniforms ~line 91):
```javascript
this.chromaticPoolingLocation = null;
this.rgDecayLocation = null;
this.yvDecayLocation = null;
this.yvFreqDecayLocation = null;
```

**Config defaults** (in config object ~line 115):
```javascript
chromatic_pooling: false,
rg_decay: 0.059,  // pre-v2.0 detection threshold; v2.5 default: 0.085
yv_decay: 0.004,  // pre-v2.0 detection threshold; v2.5 default: 0.014
yv_freq_decay: 0.008,
```

**Uniform lookup** (in init() ~line 211):
```javascript
this.chromaticPoolingLocation = gl.getUniformLocation(this.program, "u_chromatic_pooling");
this.rgDecayLocation = gl.getUniformLocation(this.program, "u_rg_decay");
this.yvDecayLocation = gl.getUniformLocation(this.program, "u_yv_decay");
this.yvFreqDecayLocation = gl.getUniformLocation(this.program, "u_yv_freq_decay");
```

**Uniform upload** (in render() ~line 601):
```javascript
gl.uniform1f(this.chromaticPoolingLocation, this.config.chromatic_pooling ? 1.0 : 0.0);
gl.uniform1f(this.rgDecayLocation, this.config.rg_decay);
gl.uniform1f(this.yvDecayLocation, this.config.yv_decay);
gl.uniform1f(this.yvFreqDecayLocation, this.config.yv_freq_decay);
```

**Mode loading** (in updateConfigFromMode() ~line 440):
```javascript
this.config.chromatic_pooling = p.chromatic_pooling ?? defaults.chromatic_pooling;
this.config.rg_decay = p.rg_decay ?? defaults.rg_decay;
this.config.yv_decay = p.yv_decay ?? defaults.yv_decay;
this.config.yv_freq_decay = p.yv_freq_decay ?? defaults.yv_freq_decay;
```

### Step 5: Enable in modes.json

Enable chromatic pooling on the two research modes where DoG is active:

| Mode | Enable? | Rationale |
|------|---------|-----------|
| 0 (High-Key) | **Yes** | Default research mode, DoG enabled |
| 1 (Biological) | **Yes** | DoG enabled, Purkinje still applies on top |
| 2 (Frosted) | No | No DoG, different aesthetic |
| 3-5 (Presentation) | No | Artistic, not simulation |
| 6 (Log-Polar MIP) | No | FOVI standalone, no DoG bands to attenuate per-band |
| 7 (Legacy v1.6) | No | Frozen comparison baseline |
| 8 (Gaussian Desat) | No | Isolates curve shape, not channel |
| 9 (Congestion) | **Yes** | DoG enabled, research mode |

Add to mode 0, 1, and 9 pipeline objects:
```json
"chromatic_pooling": true,
"rg_decay": 0.059,  // pre-v2.0 detection threshold; v2.5 default: 0.085
"yv_decay": 0.004,  // pre-v2.0 detection threshold; v2.5 default: 0.014
"yv_freq_decay": 0.008
```

### Step 6: Menu toggle (optional but useful for demo)

Add a checkbox to the Simulation > Behavior submenu:
- Label: "Chromatic Pooling (RG/YV)"
- Toggles `chromatic_pooling` in config
- Allows quick A/B comparison during the meeting

**File**: `main-process/menu-builder.js` (or equivalent menu construction file)

## Files Modified

| File | Change |
|------|--------|
| `renderer/shaders/peripheral.frag` | Add 4 uniforms, `chromaticAttenuate()` function, per-band chromatic path in `sampleDoGReconstructed()`, V4 desat guard |
| `renderer/webgl-renderer.js` | Add 4 uniform locations, config defaults, lookup, upload, mode loading |
| `shared/modes.json` | Add `chromatic_pooling`, `rg_decay`, `yv_decay`, `yv_freq_decay` to modes 0, 1, 9 |
| `main-process/menu-builder.js` | Add "Chromatic Pooling" toggle checkbox (optional) |

## Performance

~150 additional ALU ops per fragment (5× Oklab round-trips: one per band + residual). At typical viewport: ~0.3ms overhead, well within 16ms frame budget.

No new textures, no new passes, no CPU-side computation. Pure fragment shader cost.

## Acceptance Criteria
- [ ] Red UI element at 10° eccentricity visibly loses red while blue element retains saturation
- [ ] Large blue background persists at 15°+ eccentricity
- [ ] Small red text at 5° loses chromatic identity while large green nav bar retains color (pooling preserves mean chromaticity)
- [ ] Toggle on/off produces visible A/B difference
- [ ] Mode 0 (High-Key) and Mode 1 (Biological) both work with chromatic pooling enabled
- [ ] Mode 7 (Legacy) is unaffected (frozen baseline)
- [ ] No visual regression on grayscale/achromatic content
- [ ] Builds and runs without shader compilation errors
- [ ] Frame time stays under 16ms on test pages

## Open Questions

1. **ecc_deg conversion**: Currently `normEcc * 1.0` uses fovea_deg = 1.0 (1° foveal radius). Should we pass actual fovea_deg as a uniform for accuracy? (Low priority — 1° radius is standard.)

2. **Interaction with saliency modulation**: When saliency modulation preserves detail in salient regions, should it also preserve color? Currently `u_desat_floor` gates the V4 chrominance path — if we're skipping V4 uniform path, we need an equivalent gate on the chromatic attenuation. Probably: `rg_atten = mix(rg_atten, 1.0, saliency * u_desat_floor)`.

3. **Mode 6 (Log-Polar MIP)**: No DoG bands, so per-band chromatic attenuation doesn't apply. Could add a simpler uniform chromatic decay (just RG/YV split without per-band frequency dependence) as a separate path. Deferred — not needed for meeting.

## Resolved Issues

### Threshold vs Suprathreshold (Mar 4 2026)

**Problem**: castleCSF k_e=0.059 is a *detection threshold* decay rate — the contrast at which you can just barely see a chromatic modulation. Applying this directly to suprathreshold color appearance (saturated UI colors) produces extreme red attenuation. A red button at 10° eccentricity became gray, which is perceptually wrong — you can still see it's red at suprathreshold contrasts, you just can't resolve fine red-green spatial detail.

**Root cause**: Conflation of threshold sensitivity with appearance. Jiang, Shooner & Mullen (2022) measured the relationship directly and found a power-law with exponent ~0.5-0.63 for RG at high contrasts.

**Fix**: Added `u_supra_exponent` uniform (default 0.5). All threshold attenuation values are raised to this power before application: `rg_atten = pow(threshold_atten, supra)`. At exponent 0.5, the effective decay at 10° becomes sqrt(0.257) = 0.507 instead of 0.257 — reds retain ~50% of their opponent signal rather than ~26%.

### Red Kill Switch Double-Attenuation (Mar 4 2026)

**Problem**: The "Red Kill Switch" in V4 (lines ~806-813 of peripheral.frag) applies up to 95% attenuation to Oklab `a` (red-green) channel in the far periphery. When chromatic pooling was also active, red got hit twice: once in sampleDoGReconstructed() and again in the Red Kill Switch.

**Fix**: Wrapped Red Kill Switch in `if (u_chromatic_pooling < 0.5)` guard, same pattern as the base V4 chrominance path.
