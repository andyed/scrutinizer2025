# Mongrel Textures Specification

> **Last updated:** 2026-03-11 (v2.3)

## 1. Overview

"Mongrel" textures (Rosenholtz et al.) represent the **statistical summary** of visual information as processed by the peripheral visual system. The brain does not "see" individual pixels in the periphery—it perceives pooled statistics: average color, texture orientation, contrast variance, and density.

### Current State (v2.3)

Scrutinizer implements Tiers 1 through 2.5 of the mongrel pipeline. Tier 2.5 shipped in v2.3 as a two-pass WebGPU compute pipeline: tile-based Oklab statistics extraction followed by oriented noise synthesis. The implementation uses oriented sine gratings rather than Walton's steerable filter decomposition — simpler and faster, running under 0.3ms on integrated GPU. Five V1 distortion types are available in `shared/modes.json`, selectable per aesthetic mode. Tier 2 (contrast-preserving pooling in WebGL2) and Tier 3 (full TTM synthesis) remain future work.

| Tier | Status | Strategy |
|------|--------|----------|
| **Tier 0** (Legacy) | Removed | Shatter jitter — replaced by Slow Wave (v1.4.1) |
| **Tier 1** | Implemented (v1.4) | Eccentricity-based MIP sampling |
| **Tier 1.5** | Implemented (v2.0) | Density-gated crowding + anisotropic noise |
| **Tier 1.6** | Reimplemented (v1.9) | Per-channel chromatic pooling (castleCSF) |
| **Tier 2** | Planned | Contrast-preserving pooling (WebGL2) |
| **Tier 2.5** | **Shipped (v2.3)** | Tile-based Oklab statistics + oriented noise synthesis (WebGPU compute) |
| **Tier 3** | Planned | Full statistical texture replacement (WebGPU compute) |

### Goal
This spec defines a **tiered improvement roadmap** that:
1. Improves scientific accuracy progressively
2. Maintains 60fps performance on target hardware
3. Uses **WebGL2** as baseline with **WebGPU** as acceleration path

---

## 2. Scientific Foundation

### 2.1 The Pooling Model (Rosenholtz et al.)
The peripheral visual system compresses information through **receptive field pooling**:
- **Fovea (0-2°)**: Tiny receptive fields (~1 pixel). Full resolution.
- **Parafovea (2-5°)**: Growing fields (~4-8 pixels). Position becomes uncertain.
- **Periphery (5°+)**: Large fields (~16-64+ pixels). Only summary statistics survive.

### 2.2 What Statistics Survive Pooling?
Research identifies these as the key preserved features:

| Statistic | Description | Visual Effect |
|-----------|-------------|---------------|
| **Mean Luminance** | Average brightness | Preserved (we still see "brightness") |
| **Contrast Energy** | Local variance (σ²) | Texture vs. flat regions |
| **Dominant Orientation** | Edge direction (0°, 45°, 90°, 135°) | Text looks "stripey", edges retain angle |
| **Spatial Frequency** | Fine vs. coarse texture | Fine detail lost, coarse patterns remain |
| **Color (low precision)** | Hue category (not exact) | "Reddish blob" not "RGB(255,100,100)" |

### 2.3 What Is Destroyed?
- **Exact position** of features within the pooling region
- **Letter identity** (hence crowding/illegibility)
- **Fine spatial frequency** (sharp edges become fuzzy)

---

## 3. Implemented Tiers

### Performance Budget
| Tier | Target GPU Cost | Strategy | Status |
|------|-----------------|----------|--------|
| **Tier 1** | ~0.3ms | Eccentricity-based MIP sampling | ✅ **Implemented (v1.4)** |
| **Tier 1.5** | ~0.5ms | Density-gated crowding + anisotropic V1 noise | ✅ **Implemented (v2.0)** |
| **Tier 1.6** | ~0.3ms | Per-channel chromatic decay (castleCSF) | ✅ **Reimplemented (v1.9)** |
| **Tier 2** | ~2.0ms | Contrast-preserving pooling (WebGL2) | 📋 Planned |
| **Tier 2.5** | ~0.3ms | Tile-based Oklab statistics + oriented noise synthesis (WebGPU compute) | **Shipped (v2.3)** |
| **Tier 3** | ~3-4ms | Full statistical texture replacement (WebGPU compute) | 📋 Future |

---

### Tier 1: Eccentricity-Based MIP Sampling ✅ IMPLEMENTED (v1.4)

**Goal**: Replace uniform blur with biologically-motivated pooling that grows with eccentricity.

**Mechanism**: Use `textureLod()` with MIP level driven by distance from fovea.

**WebGL2 Implementation** (`peripheral.frag:166–192`):

```glsl
vec4 sampleMIPPooled(vec2 uv, float eccentricity, float fovea_radius) {
    float normalizedEcc = max(0.0, eccentricity) / fovea_radius;
    float mipScaling = 2.5;
    float maxMipLevel = 4.0;
    float mipLevel = clamp(normalizedEcc * mipScaling, 0.0, maxMipLevel);
    vec4 col = textureLod(u_texture, uv, mipLevel);
    // BGRA -> RGBA swap
    float temp = col.r; col.r = col.b; col.b = temp;
    return col;
}
```

**V4 Stage: Coupled Pooling + Smooth Blend** (`peripheral.frag:693–711`):
```glsl
// Tier 1.8: Coupled pooling — blur radius linked to V1 distortion strength.
// If LGN suppresses the warp, blur also vanishes.
float blurMult = 1.0 + (u_blurRadius * 0.3);
float coupledEccentricity = v1.distortionStrength * u_intensity * fovea_radius * blurMult;
vec3 pooledCol = sampleMIPPooled(v1.distortedUV, coupledEccentricity, fovea_radius).rgb;

// 10% transition band to eliminate visible boundary
float baseBlend = smoothstep(0.0, fovea_radius * 0.1, eccentricity);
float blendFactor = baseBlend * u_intensity;
vec3 col = mix(foveaCol, pooledCol, blendFactor);
```

**Tunable Parameters**:
- `mipScaling = 2.5`: How quickly pooling grows with eccentricity
- `maxMipLevel = 4.0`: Maximum pooling (level 4 = 16×16 blocks)
- Blend zone = `fovea_radius * 0.1`: Width of smooth transition
- `u_blurRadius`: Saccadic state modulation (2.0 Gather → 10.0 Hunt)

---

### Tier 1.5: Density-Gated Crowding ✅ IMPLEMENTED (v2.0)

**Goal**: Modulate V1 distortion strength by local element density. Dense content (text blocks, icon grids) gets full crowding; isolated elements (buttons, logos in whitespace) get minimal distortion.

**Scientific basis**: Bouma (1970) — crowding is a function of element spacing relative to eccentricity. Isolated targets in the periphery remain identifiable; crowded targets do not.

**Implementation** (`peripheral.frag:498–502`):
```glsl
// Sigmoid gate on structure map density
float densityCrowding = 1.0 / (1.0 + exp(-u_crowding_density_steepness *
                        (lgn.density - u_crowding_density_threshold)));
float crowdingFactor = mix(0.3, 1.0, densityCrowding);
strength *= crowdingFactor;
```

**Parameters** (uniforms):
- `u_crowding_density_threshold = 0.2`: Density below this → minimal crowding
- `u_crowding_density_steepness = 10.0`: Sigmoid sharpness
- Floor = 0.3: Even isolated elements get some distortion (never fully sharp in periphery)

**What this replaced**: The v1.4.1 "Lateral Smash" (fixed 6.0× X-axis distortion multiplier) was a blunt instrument — it applied uniformly regardless of content. Density gating makes the same biological prediction (crowding destroys identity) but gates it on actual content structure.

---

### V1 Distortion Types (Current)

The old spec described a single "Melter" mechanism. As of v2.0, there are **five distortion types** registered in `shared/modes.json`, selectable per aesthetic mode:

| Type ID | Name | Description | Used By |
|---------|------|-------------|---------|
| 0 | `noise` | Radial/tangential anisotropic crowding (animated simplex) | Natural, Frosted |
| 1 | `shatter` | Slow Wave — 0.1Hz sine warp (comfort mode) | Standard, Calm |
| 2 | `none` | No geometric distortion | Blueprint |
| 3 | `pixelate` | Saliency-guided block quantization (powers-of-2 block sizes) | Minecraft |
| 4 | `polar_quantize` | Radial sector snapping (CMF-driven ring spacing, TTM-style) | Polar/Research |

#### Type 0: Anisotropic Crowding (Default)
The primary distortion mode. Replaced the v1.4.1 Lateral Smash.

```glsl
// Independent radial and tangential noise
float microR = snoise(uv * 900.0 + vec2(t * 5.0));
float macroR = snoise(uv * 20.0 + vec2(t * 0.1));
float radialNoise = (microR * 0.004 + macroR * 0.01) * u_crowding_radial_bias;

float microT = snoise(uv * 900.0 + vec2(t * 5.0, 43.17));
float macroT = snoise(uv * 20.0 + vec2(t * 0.1, 71.91));
float tangentialNoise = microT * 0.004 + macroT * 0.01;

vec2 warp = radDir_uv * radialNoise + tanDir_uv * tangentialNoise;
```

Key differences from the old "Melter":
- **Radial/tangential decomposition** (Toet & Levi 1992) — crowding is ~2:1 stronger radially than tangentially, controlled by `u_crowding_radial_bias`
- **No fixed lateral multiplier** — anisotropy is directional relative to the fovea, not a flat X-axis boost
- **Animated** via `u_v1_animate` uniform

#### Type 3: Pixelate (Saliency-Guided)
Quantizes UV space into power-of-2 blocks. Block size grows with eccentricity, shrinks with saliency/density. Includes velocity-gated glitch displacement for motion effects.

#### Type 4: Polar Quantize
TTM-style pooling regions: concentric rings with spoke sectors, sized by CMF. Per-sector MIP pooling with per-channel Oklab chromatic decay. Ring/spoke grid lines rendered at 6% darkening.

---

### Tier 1.6: Per-Channel Chromatic Pooling ✅ REIMPLEMENTED (v1.9)

**Goal**: Simulate differential color channel resolution loss in the periphery.

**Previous approach (v1.4.1)**: Simple chromatic aberration — radial offset with MIP+2.0 on chroma channels ("Unbound Color"). Produced ghost images.

**Current approach (v1.9+)**: Per-channel decay based on contrast sensitivity measurements. Implemented in Oklab color space for perceptual uniformity.

**Implementation** (`peripheral.frag:1134–1137`, polar quantize path):
```glsl
// Per-channel chromatic decay — tightened ranges for desktop viewing
float ecc_deg = normEcc * 2.0;  // Convert to approximate degrees
blended.y *= (1.0 - smoothstep(1.0, 12.0, ecc_deg) * 0.7);   // a* (RG) — decays faster
blended.z *= (1.0 - smoothstep(3.0, 20.0, ecc_deg) * 0.35);  // b* (YV) — decays slower
```

**Scientific basis**:
- RG (red-green) chromatic channel decays faster than YV (blue-yellow) — Mullen & Kingdom (2002)
- Suprathreshold decay rates from Bowers et al. (2025)
- castleCSF contrast sensitivity function provides per-band, per-channel frequency-dependent decay

**Cross-reference**: See `docs/specs/implemented/chromatic_pooling.md` for the full chromatic pipeline spec.

---

## 4. Integration with Existing Pipeline

### 4.1 Where It Fits
The Mongrel system operates across **V1 (Geometry)** and **V4 (Aesthetics)** stages:

```
LGN (Gating) → V1 (Geometry) → V4 (Aesthetics)
                    ↑                 ↑
              Distortion types    MIP pooling,
              (noise, pixelate,   chromatic decay,
               polar, etc.)      contrast preservation
```

V1 produces geometric distortion (UV warping). V4 applies MIP-based pooling driven by V1's distortion strength (coupled pooling). Chromatic decay is applied in V4.

### 4.2 Mode Selection
Distortion type is selected per aesthetic mode in `shared/modes.json`:

```json
{
  "v1_distortion_types": {
    "0": { "name": "noise", "label": "Noise (Dynamic)" },
    "1": { "name": "shatter", "label": "Slow Wave (Mongrel)" },
    "2": { "name": "none", "label": "None" },
    "3": { "name": "pixelate", "label": "Pixelate (Saliency-Guided)" },
    "4": { "name": "polar_quantize", "label": "Polar Quantize (Radial Sectors)" }
  }
}
```

Each mode's `render_config` specifies `v1_distortion_type` (integer ID) along with `v1_strength_mult` and other pipeline parameters.

### 4.3 Structure Map Interaction ✅ IMPLEMENTED (v2.0)
Density-gated crowding reads the structure map's density channel to modulate V1 strength. See Tier 1.5 above.

Additionally, saliency modulation dampens distortion in high-saliency regions:
```glsl
if (u_enable_saliency_modulation > 0.5) {
    waveDampener = 1.0 - (lgn.saliency * 0.9);
}
```

---

## 5. Future Tiers

### Tier 2: Contrast-Preserving Pooling (Medium Cost) — 📋 PLANNED

**Goal**: Maintain local contrast variance while pooling, preventing the "washed out" look of standard MIP blur.

**Mechanism**: Generate a **custom MIP chain** that encodes statistics, not just averages.

#### 2a. Statistical MIP Texture (CPU/Worker)
On frame capture (or throttled to every N frames), generate a secondary texture:

| MIP Level | Resolution | Encoding |
|-----------|------------|----------|
| 0 | Full | Original image (or skip) |
| 1 | 1/2 | R: Mean L*, G: Std Dev, B: unused, A: 1.0 |
| 2 | 1/4 | Same encoding |
| 3 | 1/8 | Same encoding |
| 4 | 1/16 | Same encoding |

#### 2b. Shader Reconstruction
```glsl
uniform sampler2D u_statTexture;
float mipLevel = eccentricity * 4.0;
vec4 stats = textureLod(u_statTexture, uv, mipLevel);

float meanL = stats.r;
float contrast = stats.g;
float orientation = stats.b;

vec3 meanColor = textureLod(u_texture, uv, mipLevel).rgb;
float noise = orientedNoise(uv * 100.0, orientation);
vec3 mongrelColor = meanColor + (noise * contrast * 0.5);
```

**Performance**: ~1-2ms (stat MIP generation can be throttled to every 3-5 frames).

---

### Tier 2.5: WebGPU Compute Mongrel Synthesis — SHIPPED (v2.3)

**Goal**: Real-time metamer texture synthesis via WebGPU compute, replacing simplex noise with statistically-informed oriented textures.

**Original spec** called for Walton-style smooth moment synthesis using steerable filter decomposition (4 orientations x 4 scales). The shipped implementation takes a more direct approach: tile-based Oklab statistics extraction followed by oriented sine grating synthesis. This trades the full steerable pyramid for a simpler two-pass pipeline that achieves the core goal — texture replacement informed by local image statistics — at a fraction of the compute cost.

**Mechanism (as shipped)**:
1. **Pass 1 — Tile statistics**: Extract per-tile Oklab luminance mean, luminance variance, and chrominance variance
2. **Pass 2 — Oriented noise synthesis**: Generate oriented sine gratings parameterized by the extracted statistics

**Why WebGPU?**: Fragment shaders cannot accumulate statistics over pooling regions. Compute shaders provide workgroup shared memory for parallel reduction and read-write storage buffers.

**Implementation divergence**: Oriented sine gratings vs Walton's steerable filters. The steerable approach would provide better perceptual fidelity to the TTM's summary statistics, but the sine grating approach is sufficient for the current pipeline and runs under 0.3ms on integrated GPU (vs the original 2-3ms estimate). Walton's full approach remains an option for Tier 3 if needed.

**Performance**: Under 0.3ms on integrated GPU. Auto-fallback safety harness monitors a 60-frame rolling window and disables the compute path if sustained frame time exceeds the 30fps floor.

**Files**:
- `renderer/webgpu-crowding-compute.js` — pipeline manager (device init, buffer allocation, bind groups, dispatch)
- `renderer/shaders/crowding-stats.wgsl` — pass 1: tile statistics extraction
- `renderer/shaders/crowding-synth.wgsl` — pass 2: oriented noise synthesis
- `renderer/webgpu-probe.js` — WebGPU capability detection and feature negotiation
- `renderer/webgpu-safety.js` — frame budget monitor with auto-fallback to fragment shader path

**Prior art**: Walton et al. (2021) in CUDA/DirectX for VR foveated rendering. Vacher & Briand (2021) provide CPU reference for offline ground truth.

---

### Tier 3: Statistical Texture Replacement (WebGPU Path) — 📋 FUTURE

**Goal**: True Rosenholtz-style synthesis — replace pooling regions with procedural textures matching summary statistics.

**Mechanism**: Compute shader analyzes each pooling tile and selects/generates a matching procedural texture from a pre-generated atlas.

**Visual Effect**:
- Text becomes horizontal stripes. Faces become blobs. Logos become colored shapes.
- Closest to Rosenholtz et al.'s published mongrel images

**Performance**: ~3-4ms on modern discrete GPU.

**Migration Path**:
1. WebGPU feature detection: `if (navigator.gpu)`
2. Load Tier 3 compute pipeline when available
3. Graceful fallback to Tier 2 on non-WebGPU browsers

---

## 6. Blueprint Mode Enhancement

### 6.1 Receptive Field Grid (Partially realized via Polar Quantize)
The Polar Quantize distortion type (Type 4) now renders fovea-relative rings and spokes, visualizing pooling structure directly. Grid lines at 6% darkening show sector boundaries.

### 6.2 "Retinal Truth" Layer

| Layer | Name | Description |
|-------|------|-------------|
| 0 | DOM Truth | What the browser renders |
| 1 | Structure Map | Semantic layout (text, image, interactive) |
| 2 | **Retinal Truth** | Mongrel pooling — what the visual system actually perceives |

---

## 7. Performance Validation Plan

| Test | Tier 1 | Tier 1.5 | Tier 2 | Tier 3 |
|------|--------|----------|--------|--------|
| MacBook Pro M1 (WebGL2) | <1ms | <1ms | Target <2ms | N/A |
| MacBook Pro M1 (WebGPU) | - | - | - | Target <3ms |
| Windows/Chrome (integrated) | <1ms | <1ms | <2.5ms | <4ms |
| Windows/Chrome (discrete) | <0.5ms | <0.5ms | <1ms | <2ms |

**Measurement Method**: `EXT_disjoint_timer_query_webgl2` or `GPUComputePassTimestampWrites`.

---

## 8. References

1. **Rosenholtz, R., Huang, J., & Ehinger, K. A.** (2012). *Rethinking the role of top-down attention in vision: Effects attributable to a lossy representation in peripheral vision*. Frontiers in Psychology.
2. **Freeman, J., & Simoncelli, E. P.** (2011). *Metamers of the ventral stream*. Nature Neuroscience.
3. **Balas, B., Nakano, L., & Rosenholtz, R.** (2009). *A summary-statistic representation in peripheral vision explains visual crowding*. Journal of Vision.
4. **Walton, D. R., Dos Anjos, R. K., Friston, S., Swapp, D., Akşit, K., Steed, A., & Ritschel, T.** (2021). *Beyond Blur: Real-time Ventral Metamers for Foveated Rendering*. SIGGRAPH.
5. **Portilla, J. & Simoncelli, E. P.** (2000). *A Parametric Texture Model Based on Joint Statistics of Complex Wavelet Coefficients*. IJCV.
6. **Vacher, J. & Briand, T.** (2021). *Portilla-Simoncelli Texture Synthesis*. IPOL. C++ reference (BSD-3). See `tbriand/portilla-simoncelli-ipol`.
7. **Bouma, H.** (1970). *Interaction effects in parafoveal letter recognition*. Nature. Foundation for critical spacing / crowding distance.
8. **Toet, A. & Levi, D. M.** (1992). *The two-dimensional shape of spatial interaction zones in the parafovea*. Vision Research. Radial/tangential crowding anisotropy (~2:1).
9. **Mullen, K. T. & Kingdom, F. A. A.** (2002). *Differential distributions of red-green and blue-yellow cone opponency across the visual field*. Visual Neuroscience. Chromatic channel eccentricity-dependent decay.
10. **Bowers, N. R. et al.** (2025). Suprathreshold chromatic contrast sensitivity measurements. Basis for castleCSF-derived decay rates.
