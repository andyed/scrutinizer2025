# Per-Channel Chromatic Pooling Across Eccentricity

Date: 2026-03-03
Status: IMPLEMENTED (v1.9.0)
Commits: a9051e3, aad22cf, 276e8de
Dependencies: DoG band decomposition (v1.6, implemented), Oklab color pipeline (v1.4+, implemented)

## 1. Problem Statement

### The Uniform Chrominance Reduction Problem

The current V4 pipeline reduces all chrominance equally with eccentricity. A single `desaturationFactor` ramps from 0 (fovea) to 1 (far periphery) and attenuates Oklab opponent channels uniformly:

```glsl
// peripheral2.frag ~line 695
vec3 lab = rgbToOklab(col);
float fade = desaturationFactor * bypassTransition;
// Both a and b channels attenuated by the same factor
lab.y *= (1.0 - fade);  // a (red-green)
lab.z *= (1.0 - fade);  // b (blue-yellow)
```

This is wrong in two ways:

1. **Red-green and blue-yellow don't decay at the same rate.** L-M (red-green) opponency is a foveal specialization — it drops ~2x faster than achromatic sensitivity with eccentricity. S-(L+M) (blue-yellow) tracks close to achromatic, persisting far into the periphery. Treating them equally over-attenuates blue-yellow and under-attenuates red-green.

2. **The decay ignores feature size.** A small red letter and a large red hero background get the same chrominance reduction at the same eccentricity. But peripheral color perception is strongly size-dependent (Abramov et al. 1991): large color fields retain mean chromaticity out to 20+ degrees — the visual system pools color over larger regions (Rosenholtz TTM), preserving average hue while losing spatial chromatic detail. Small chromatic stimuli lose color identity rapidly because they fall within a single pooling region. The current shader treats a full-width colored banner the same as 12px colored text.

### What This Causes

| Scenario | Current (Uniform) | Proposed (Per-Channel + Size) |
|----------|-------------------|-------------------------------|
| Red button at 8° ecc | Loses ~50% chrominance | RG opponent attenuated ~50% (small stimulus) |
| Blue background at 8° ecc | Loses ~50% chrominance | Retains ~90% YV signal (large field, pooled) |
| Teal sidebar at 15° ecc | Loses ~80% chrominance | Blue-yellow persists, red-green attenuated |
| Red text on white at 5° ecc | Slightly reduced | Red chromatic identity weakened (fine spatial detail) |
| Large green hero at 5° ecc | Slightly reduced | Green largely preserved (mean chromaticity pooled over large region) |

### Biological Reality

The three post-receptoral channels have fundamentally different eccentricity profiles:

**L-M (Red-Green) — Foveal Specialization**
- Depends on 1:1 midget ganglion cell wiring that only exists in the fovea
- As dendritic fields grow with eccentricity, midget cells receive mixed L and M input → opponency collapses
- 50% sensitivity loss at ~5° (temporal field)
- 90% loss by ~17°
- At detection threshold, falloff is essentially independent of spatial frequency (castleCSF: k_ef ≈ 0)
- At suprathreshold contrasts, larger stimuli benefit from spatial summation over more receptive fields → weak frequency dependence (k_ef = 0.003)
- This is a wiring problem, not an optical one

**S-(L+M) (Blue-Yellow) — Retina-Wide**
- S-cones have dedicated bistratified ganglion cells with retina-wide coverage
- Under purifying selection for 500+ million years — the oldest color channel
- 50% sensitivity loss at ~26° (at 1 cpd)
- Tracks close to achromatic falloff
- Spatial-frequency dependent: large blue fields persist much further than small ones

**Achromatic (L+M) — Reference**
- 50% sensitivity at ~7° (1 cpd)
- Already modeled by the DoG band decomposition (M-scaling)
- Spatial resolution falls linearly with eccentricity

### The Size Dependence

Abramov, Gordon & Chan (1991) measured "perceptive fields" — the stimulus size needed to achieve fovea-like color appearance at each eccentricity. Key findings:

- All chromatic perceptive fields **increase with eccentricity**
- With sufficiently large stimuli, fovea-like color vision is achievable to **20 degrees**
- Even the largest stimuli fail to produce fully saturated hues at **40 degrees**
- Perceptive fields for color are **larger than anatomical receptive field estimates** — the neural pooling required for color appearance exceeds what single-cell measurements predict

For web rendering, this means: a full-width colored banner (spanning 30°+ of visual angle) retains its chromatic identity much further into the periphery than a 14px colored label. The DoG bands already decompose content by spatial frequency — the same decomposition can drive per-band chromatic attenuation.

## 2. Quantitative Parameters

### Eccentricity Decay Constants (castleCSF model, temporal field)

The castleCSF model (Ashraf et al. 2024) parameterizes sensitivity as:

```
S(ecc, ρ) = S_foveal × 10^(-(k_e + ρ × k_ef) × ecc)
```

| Parameter | Achromatic | Red-Green (L-M) | Blue-Yellow S-(L+M) |
|-----------|:----------:|:---------------:|:-------------------:|
| k_e (base decay) | 0.024 | **0.059** | 0.004 |
| k_ef (freq-dependent) | 0.019 | ~0 (threshold); **0.003** (suprathreshold) | 0.008 |

The RG channel decays 2.5× faster than achromatic and **15× faster** than YV at low spatial frequencies.

### Derived Half-Life Eccentricities

| Channel | At 0.5 cpd | At 1 cpd | At 2 cpd | At 4 cpd |
|---------|:----------:|:--------:|:--------:|:--------:|
| **RG** 50% | 5.0° | 4.9° | 4.6° | 4.2° |
| **RG** 90% loss | 16.5° | 16.1° | 15.4° | 14.1° |
| **YV** 50% | 39.6° | 25.9° | 15.3° | 8.4° |
| **YV** 90% loss | 131° | 85.9° | 50.8° | 27.9° |
| **Ach** 50% | 9.0° | 7.0° | 4.9° | 3.0° |
| **Ach** 90% loss | 29.9° | 23.3° | 16.2° | 10.0° |

Both channels have frequency-dependent decay, but at different rates. YV decay is strongly frequency-dependent (k_ef = 0.008) — large blue-yellow patterns persist far into the periphery while small ones fade. RG has a weaker frequency dependence (k_ef = 0.003) — castleCSF reports k_ef ≈ 0 at detection threshold, but suprathreshold spatial summation means larger red-green stimuli integrate over more receptive fields, yielding better color constancy than small ones. This gives size-dependent color preservation for both channels.

### Empirical Confirmation (Bowers, Gegenfurtner & Goettker 2025)

Measured from 5° to 90°, normalized to 5°:

| Eccentricity | Achromatic | Red-Green | Blue-Yellow |
|:---:|:---:|:---:|:---:|
| 5° | 100% | 100% | 100% |
| 15° | 76% | **29%** | 79% |
| 75° | 12% | **4%** | 18% |

At 15°, red-green has lost 71% of its sensitivity while blue-yellow has only lost 21%.

## 3. Implementation Strategy

### Approach: Per-Band Chromatic Attenuation in DoG Reconstruction

The DoG bands already separate content by spatial scale. Instead of reconstructing bands as full-color RGB, attenuate the chromatic components of each band independently based on eccentricity:

```
band_k_output = luminance(band_k) + chromatic_RG(band_k) × w_rg(ecc) + chromatic_YV(band_k) × w_yv(ecc, k)
```

Where:
- `w_rg(ecc, k)` = RG attenuation, band-dependent (fast base decay, weak frequency dependence k_ef=0.003)
- `w_yv(ecc, k)` = YV attenuation, band-dependent (slow base decay, strong frequency dependence k_ef=0.008)

The achromatic (luminance) component of each band keeps the existing M-scaling rolloff unchanged. Only the chrominance gets the new differential treatment.

### Why DoG Bands Solve the Size Problem

The spec doesn't need an explicit "stimulus size" measurement. The DoG band decomposition already sorts content by spatial frequency:

| Band | Spatial Scale | Maps To |
|------|--------------|---------|
| band0 | 1-2px | Small colored text, thin borders |
| band1 | 2-4px | Icons, medium text |
| band2 | 4-8px | UI elements, headings |
| band3 | 8-16px | Buttons, cards |
| residual | 16px+ | Backgrounds, hero sections, large color fields |

Large color fields live in the residual and band3. Small chromatic details live in band0-1. By applying different chromatic decay rates per band, the size-dependent color preservation falls out naturally:

- **Residual (large fields):** YV barely attenuates at all. RG attenuates but slowly (large RG patches are partly rescued by spatial summation).
- **Band0 (fine detail):** Both RG and YV attenuate aggressively — matching the psychophysics that small chromatic stimuli lose identity fast.

### Shader Pseudocode

```glsl
vec4 sampleDoGReconstructedChromatic(vec2 uv, float eccentricity, float fovea_radius,
                                      float dog_e2, float dog_sharpness, float visual_ecc) {
    // Two eccentricity scales (decoupled since v1.9.1):
    //   normEcc: from coupledEccentricity (V1 distortion-strength-scaled) — drives spatial band weights
    //   chromNormEcc: from visual_ecc (true gaze distance) — drives chromatic decay
    // Before decoupling, chromatic decay saw ~0.6° at 15° true eccentricity (nearly foveal).
    float normEcc = max(0.0, eccentricity) / max(fovea_radius, 0.001);
    float chromNormEcc = max(0.0, visual_ecc) / max(fovea_radius, 0.001);

    // ── Existing: sample 5 MIP levels, compute bands ──
    vec4 mip0 = textureLod(u_texture, uv, 0.0);
    vec4 mip1 = textureLod(u_texture, uv, 1.0);
    vec4 mip2 = textureLod(u_texture, uv, 2.0);
    vec4 mip3 = textureLod(u_texture, uv, 3.0);
    vec4 mip4 = textureLod(u_texture, uv, 4.0);

    vec4 band0 = mip0 - mip1;
    vec4 band1 = mip1 - mip2;
    vec4 band2 = mip2 - mip3;
    vec4 band3 = mip3 - mip4;

    // ── Existing: per-band luminance weights (M-scaling, uses normEcc) ──
    float w0 = 1.0 - smoothstep(...);  // unchanged — driven by coupledEccentricity
    float w1 = 1.0 - smoothstep(...);
    float w2 = 1.0 - smoothstep(...);
    float w3 = 1.0 - smoothstep(...);

    // ── Per-channel chromatic weights (uses chromNormEcc) ──
    // Chromatic decay driven by true gaze eccentricity, not V1 distortion strength
    float ecc_deg = chromNormEcc * 2.0;  // fovea ≈ 2° radius

    // RG attenuation: per-band, steep base + weak frequency dependence
    // castleCSF k_e = 0.059 (base), k_ef = 0.003 (suprathreshold spatial summation)
    float rg_atten_band0 = pow(10.0, -(0.059 + 0.003 * 4.0) * ecc_deg);  // 4cpd
    float rg_atten_band1 = pow(10.0, -(0.059 + 0.003 * 2.0) * ecc_deg);  // 2cpd
    float rg_atten_band2 = pow(10.0, -(0.059 + 0.003 * 1.0) * ecc_deg);  // 1cpd
    float rg_atten_band3 = pow(10.0, -(0.059 + 0.003 * 0.5) * ecc_deg);  // 0.5cpd
    float rg_atten_res   = pow(10.0, -(0.059 + 0.003 * 0.25) * ecc_deg); // 0.25cpd

    // YV attenuation: frequency-dependent, shallow
    // Map bands to approximate spatial frequencies (cpd)
    // band0 ~ 4cpd, band1 ~ 2cpd, band2 ~ 1cpd, band3 ~ 0.5cpd, residual ~ 0.25cpd
    float yv_atten_band0 = pow(10.0, -(0.004 + 0.008 * 4.0) * ecc_deg);
    float yv_atten_band1 = pow(10.0, -(0.004 + 0.008 * 2.0) * ecc_deg);
    float yv_atten_band2 = pow(10.0, -(0.004 + 0.008 * 1.0) * ecc_deg);
    float yv_atten_band3 = pow(10.0, -(0.004 + 0.008 * 0.5) * ecc_deg);
    float yv_atten_res   = pow(10.0, -(0.004 + 0.008 * 0.25) * ecc_deg);

    // ── Per-band chromatic decomposition + selective attenuation ──
    // For each band: split into luminance + chrominance in Oklab,
    // attenuate a (RG) and b (YV) independently, recombine

    vec4 result = chromaticAttenuate(mip4, rg_atten_res, yv_atten_res);  // residual
    result += chromaticAttenuate(band3, rg_atten_band3, yv_atten_band3) * w3;
    result += chromaticAttenuate(band2, rg_atten_band2, yv_atten_band2) * w2;
    result += chromaticAttenuate(band1, rg_atten_band1, yv_atten_band1) * w1;
    result += chromaticAttenuate(band0, rg_atten_band0, yv_atten_band0) * w0;

    return clamp(result, 0.0, 1.0);
}

// Split a color into luminance + chrominance, attenuate channels independently
vec4 chromaticAttenuate(vec4 color, float rg_atten, float yv_atten) {
    vec3 lab = rgbToOklab(color.rgb);
    lab.y *= rg_atten;   // a channel (red-green)
    lab.z *= yv_atten;   // b channel (blue-yellow)
    return vec4(oklabToRgb(lab), color.a);
}
```

### New Uniforms

| Uniform | Type | Default | Purpose |
|---------|------|---------|---------|
| `u_chromatic_pooling` | float | 0.0 | 0=off (legacy uniform desat), 1=on (per-channel per-band) |
| `u_rg_decay` | float | 0.059 | RG base eccentricity decay (castleCSF k_e) |
| `u_rg_freq_decay` | float | 0.003 | RG frequency-dependent decay (suprathreshold spatial summation) |
| `u_yv_decay` | float | 0.004 | YV base eccentricity decay (castleCSF k_e) |
| `u_yv_freq_decay` | float | 0.008 | YV frequency-dependent decay (castleCSF k_ef) |

Expose in `modes.json` per-mode, alongside existing `dog_e2` and `dog_sharpness`.

### Interaction with Existing V4 Chrominance Path

The rod-vision path (eigengrau tint, Purkinje shift) runs **after** V4 pooling. With chromatic pooling enabled:

1. DoG reconstruction handles per-band, per-channel attenuation using **true gaze eccentricity** (`visual_ecc`), decoupled from V1 distortion strength
2. Base desaturation (uniform Oklab chrominance reduction) **always runs** — it provides the cone-density-driven chroma floor that the castleCSF threshold model alone undershoots at suprathreshold web-color contrasts. Per-band and base desat are complementary: per-band handles differential RG/YV decay, base desat ensures sufficient total chroma loss.
3. The **Red Kill Switch is gated off** when chromatic pooling + DoG are active — per-band RG decay at correct eccentricity handles red-specific suppression without the blunt 95% kill
4. The rod-vision path handles the far periphery where scotopic vision dominates (eigengrau tint, Purkinje shift)

Combined at corner (~10°): per-band (50% RG retention) × base desat (20% remaining) ≈ 10% residual warmth — perceptible but not salient.

When `u_chromatic_pooling = 0`, behavior is identical to legacy (uniform chrominance reduction + Red Kill Switch). This is a strict superset.

## 4. What This Predicts

With chromatic pooling enabled, the simulation should produce these perceptual effects:

1. **A red "Buy Now" button at 10° eccentricity** — button shape preserved (DoG band3 persists), but the red-green opponent signal is attenuated (RG appearance at 10° ≈ 51% with suprathreshold correction). The button retains some redness but you may not be confident it's red vs. another warm color without foveating.

2. **A blue hero background at 10°** — the blue is clearly visible (YV channel at 10° for the residual band ≈ 97% preserved). Large blue fields don't need foveal fixation to perceive.

3. **Teal sidebar navigation at 15°** — the blue-green hue shifts toward blue. The green component (L-M) has collapsed (29% remaining), but the blue component (S-cone) persists. This matches the common subjective experience that peripheral colors "look blue."

4. **Red text on white at 5°** — the text is readable (DoG band1-2 preserved at 5°) but the red color is ambiguous (RG at 5° ≈ 50%). You might not be sure if it's red or dark gray without foveating.

5. **A large green navigation bar spanning the viewport** — green is preserved substantially because the large spatial extent means it lives in the residual/band3 where YV attenuation is minimal, and even the RG component benefits from spatial summation at that scale.

## 5. Performance Considerations

The per-band Oklab conversion adds 5 × (rgbToOklab + oklabToRgb) calls inside the DoG reconstruction. Each conversion is ~15 arithmetic ops. Total: ~150 additional ALU ops per fragment.

At 1024px analysis resolution: ~1M fragments × 150 ops = 150M extra ops. On integrated GPU at ~500 GFLOPS, this adds ~0.3ms. Within the 16ms frame budget.

**Optimization if needed:** The Oklab `a` and `b` channels map approximately to the opponent channels we want to attenuate. Instead of full Oklab round-trip per band, compute luminance as `dot(rgb, vec3(0.2126, 0.7152, 0.0722))`, decompose `chrominance = rgb - luminance`, and split chrominance into approximate RG/YV components using a 2×3 projection. Avoids the cube root in Oklab conversion. Profile before optimizing.

## 6. Validation Plan

1. **Qualitative:** Load a page with mixed chromatic content (red buttons, blue backgrounds, colored text). Enable chromatic pooling. Verify that large blue/teal regions retain color further into the periphery than small red UI elements.

2. **Screenshot comparison:** Capture golden images with chromatic pooling on/off. The difference image should show that RG chrominance is selectively removed in small features while YV chrominance persists in large ones.

3. **Parameter sweep:** Vary `u_rg_decay` from 0.03 to 0.09 and `u_yv_decay` from 0.002 to 0.01. Verify the crossover behavior matches the published ratios (RG opponent should attenuate 2-3× faster than YV).

4. **Suprathreshold correction (IMPLEMENTED):** The castleCSF parameters are detection thresholds — the minimum visible chromatic contrast. At suprathreshold contrasts (saturated web colors), perceived saturation follows a compressive power-law (Jiang, Shooner & Mullen 2022, exponent ~0.5). The `u_supra_exponent` uniform (default 0.5) applies this compression: `appearance_atten = pow(threshold_atten, supra)`. This is the key distinction between "how sensitive is the system" and "how colorful does it look" — peripheral color is pooled over larger regions with reduced chromatic spatial resolution, not simply desaturated (Rosenholtz TTM).

## 7. References

- **Abramov, Gordon & Chan (1991)** — "Color appearance in the peripheral retina: effects of stimulus size." *JOSA A* 8:404-414. [DOI](https://doi.org/10.1364/JOSAA.8.000404)
- **Ashraf et al. (2024)** — "castleCSF — A contrast sensitivity function of color, area, spatiotemporal frequency, luminance and eccentricity." *Journal of Vision* 24(4):5. [DOI](https://doi.org/10.1167/jov.24.4.5)
- **Bowers, Gegenfurtner & Goettker (2025)** — "Chromatic and achromatic contrast sensitivity in the far periphery." *Journal of Vision*. [bioRxiv](https://doi.org/10.1101/2025.03.22.644503)
- **Hansen, Pracejus & Gegenfurtner (2009)** — "Color perception in the intermediate periphery of the visual field." *Journal of Vision* 9(4):26. [DOI](https://doi.org/10.1167/9.4.26)
- **Jiang, Shooner & Mullen (2022)** — "Achromatic and chromatic perceived contrast are reduced in the visual periphery." *Journal of Vision*. [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC9639675/)
- **Mullen (1985)** — "The contrast sensitivity of human colour vision to red-green and blue-yellow chromatic gratings." *Journal of Physiology* 359:381-400.
- **Mullen (1991)** — "Colour vision as a post-receptoral specialization of the central visual field." *Vision Research* 31:119-130.
- **Mullen & Kingdom (2002)** — "Differential distributions of red-green and blue-yellow cone opponency across the visual field." *Visual Neuroscience* 19:109-118.
- **Mullen & Kingdom (2005)** — "Does L/M cone opponency disappear in human periphery?" *Perception* 34:475-483.
