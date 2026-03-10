# Oriented DoG Band Decomposition

> **Last updated:** 2026-03-08

Date: 2026-02-28
Status: COMPLETE (Phase 1-3 implemented)
Dependencies: DoG band decomposition (v1.6, implemented), V1 crowding pipeline (implemented)

## 1. Problem Statement

### The Isotropic Assumption

The current DoG band decomposition in `peripheral2.frag:92-143` treats all orientations equally — each band's weight is a single scalar rolloff based on eccentricity:

```glsl
float w0 = 1.0 - smoothstep(c0 - c0*transMult, c0 + c0*transMult, normEcc);
float w1 = 1.0 - smoothstep(c1 - c1*transMult, c1 + c1*transMult, normEcc);
// ... same function, same cutoffs, regardless of edge orientation
```

This means a **horizontal text stroke** (H/V-aligned, informationally dense) loses fidelity at the same eccentricity as **diagonal noise** (oblique, informationally sparse). That's biologically wrong.

### Biological Reality: Orientation Selectivity

V1 simple cells are orientation-tuned (Hubel & Wiesel, 1962). Key facts:

1. **The Oblique Effect** (Appelle, 1972): Humans have ~30-50% better acuity for cardinal (H/V) orientations than oblique (45/135°). This is measurable even in contrast sensitivity functions (Campbell et al., 1966).

2. **Cortical Magnification Anisotropy**: More cortical area is devoted to cardinal orientations (Furmanski & Engel, 2000). Cardinal-tuned neurons are more numerous and have smaller receptive fields.

3. **Crowding Asymmetry**: The V1 distortion code already models horizontal crowding asymmetry — `fractalWarp.x *= 2.0` at `peripheral2.frag:401`. But the V4 DoG pooling path doesn't match. A horizontal word boundary that survives V1 distortion gets isotropically blurred in V4, negating the asymmetry.

4. **Radial-Tangential Anisotropy** (Toet & Levi, 1992): Crowding is stronger for flankers arranged along the radial axis (toward/away from fovea) than the tangential axis. Content aligned tangentially to the fovea persists further into the periphery.

### What This Causes

| Scenario | Current (Isotropic) | Proposed (Oriented) |
|----------|---------------------|---------------------|
| Horizontal text at 3° ecc | Band 0-1 killed | Band 0-1 **preserved ~50% further** |
| Diagonal texture at 3° ecc | Band 0-1 killed | Band 0-1 killed (unchanged) |
| Vertical sidebar edge at 5° | Fades with distance | **Persists further** (cardinal bonus) |
| Random noise at 5° | Fades with distance | Fades with distance (unchanged) |
| Button edge radial to fovea | Same as tangential | **Fades faster** (radial penalty) |

---

## 2. Current vs Proposed

| Aspect | Current (v1.6) | Phase 1 | Phase 2 | Phase 3 |
|--------|---------------|---------|---------|---------|
| Band weights | Isotropic scalar | H/V cardinal bonus | 4-orientation (0/45/90/135°) | + Radial/tangential bias |
| Orientation info | None | 4-tap gradient at MIP 1 | Same | + eccentricity angle |
| Uniforms | 3 (`dog_enabled/e2/sharpness`) | +3 new | Same | +1 new |
| Extra tex lookups | 0 | 4 | 4 | 4 |
| Extra ALU | 0 | ~10 ops | ~15 ops | ~20 ops |
| Est. cost (M1) | — | +0.2ms | +0.25ms | +0.3ms |
| Biological model | M-scaling only | + oblique effect | + 4-channel V1 | + radial anisotropy |

---

## 3. Tiered Implementation

### Phase 0: Current Baseline (v1.6) — No Changes

Isotropic DoG as implemented. Serves as comparison target.

```glsl
// peripheral2.frag — current code (v2.1: 8 half-octave bands)
vec4 sampleDoGReconstructed(vec2 uv, float eccentricity, float fovea_radius,
                             float dog_e2, float dog_sharpness, float visual_ecc) {
    // ... 9 MIP samples (LOD 0.0–4.0 in 0.5 steps), 8 bands, smoothstep rolloff ...
    // cutoff_k = E2 × (2^(k/2) - 1) for k=1..8
    result = mip[8];
    for (int k = 0; k < 8; k++) { result += band[k] * w[k]; }
    return result;
}
```

---

### Phase 1: H/V Cardinal Bonus (The Oblique Effect)

**Goal**: Horizontal and vertical edge content gets its M-scaling cutoffs pushed ~50% further into the periphery. Oblique content unchanged.

**Mechanism**:
1. Compute local gradient direction from a 4-tap cross pattern at MIP level 1
2. Determine H/V alignment via `abs(cos(2θ))`
3. Modulate per-band cutoffs by alignment factor
4. Gate bonus by gradient magnitude (prevents noise amplification)

```glsl
vec4 sampleDoGOriented(vec2 uv, float eccentricity, float fovea_radius,
                        float dog_e2, float dog_sharpness,
                        float orient_enabled, float orient_bias) {
    float normEcc = max(0.0, eccentricity) / max(fovea_radius, 0.001);

    // --- Phase 1: Local gradient from 4-tap cross at MIP 1 ---
    // MIP 1 gives 2px-averaged gradient — robust to pixel noise,
    // captures stroke-level orientation
    vec2 px = 2.0 / u_resolution;  // MIP 1 texel size
    float lum_r = dot(textureLod(u_texture, uv + vec2(px.x, 0.0), 1.0).rgb, vec3(0.299, 0.587, 0.114));
    float lum_l = dot(textureLod(u_texture, uv - vec2(px.x, 0.0), 1.0).rgb, vec3(0.299, 0.587, 0.114));
    float lum_t = dot(textureLod(u_texture, uv + vec2(0.0, px.y), 1.0).rgb, vec3(0.299, 0.587, 0.114));
    float lum_b = dot(textureLod(u_texture, uv - vec2(0.0, px.y), 1.0).rgb, vec3(0.299, 0.587, 0.114));

    float gx = lum_r - lum_l;
    float gy = lum_t - lum_b;
    float gradMag = sqrt(gx * gx + gy * gy);

    // Gradient angle: atan2(gy, gx) gives edge-perpendicular direction.
    // Edge orientation = θ + 90°. We want alignment with H or V axes.
    // cos(2θ) = 1 for H/V edges, 0 for 45° oblique edges.
    // Using double-angle identity: cos(2θ) = (gx²-gy²)/(gx²+gy²)
    float g2 = gx * gx + gy * gy;
    float cos2theta = (g2 > 1e-6) ? abs(gx * gx - gy * gy) / g2 : 0.0;

    // Cardinal alignment: 0 = oblique/isotropic, 1 = perfectly H or V
    float cardinalAlign = cos2theta;

    // Gate by gradient magnitude — flat regions (gradMag ≈ 0) get no bonus.
    // This prevents noise amplification in uniform areas.
    // Threshold at ~2% contrast, saturate at ~8%.
    float edgeGate = smoothstep(0.02, 0.08, gradMag);

    // Effective orientation bonus: 0..1
    float orientBonus = cardinalAlign * edgeGate * orient_enabled * orient_bias;

    // --- Standard DoG band decomposition (unchanged) ---
    // 9 MIP levels at half-octave spacing
    vec4 mip[9];
    mip[0] = textureLod(u_texture, uv, 0.0);
    mip[1] = textureLod(u_texture, uv, 0.5);
    // ... mip[2]–mip[7] at LOD 1.0, 1.5, 2.0, 2.5, 3.0, 3.5
    mip[8] = textureLod(u_texture, uv, 4.0);

    // 8 half-octave bands
    vec4 band[8];
    for (int k = 0; k < 8; k++) { band[k] = mip[k] - mip[k+1]; }

    // --- Per-band cutoffs with orientation-modulated M-scaling ---
    float e2 = max(dog_e2, 0.1);

    // Base cutoffs: half-octave M-scaling, c_k = E2 × (2^(k/2) - 1)
    float c_base[8];
    float mults[8] = float[8](0.41421, 1.0, 1.82843, 3.0, 4.65685, 7.0, 10.31371, 15.0);
    for (int k = 0; k < 8; k++) { c_base[k] = e2 * mults[k]; }

    // Push cutoffs outward for cardinal-aligned content.
    // 1.5x = "50% further into periphery" for perfectly H/V edges.
    // Higher bands (coarser) get less bonus — they're already robust.
    // Bonus tapers linearly from 0.5 (finest) to 0.1 (coarsest)
    float c[8];
    for (int k = 0; k < 8; k++) {
        float boost = 1.0 + orientBonus * mix(0.5, 0.1, float(k) / 7.0);
        c[k] = c_base[k] * boost;
    }

    // Transition width (unchanged)
    float transMult = mix(0.4, 0.05, dog_sharpness);

    // Per-band weights via smoothstep rolloff
    float w[8];
    for (int k = 0; k < 8; k++) {
        w[k] = 1.0 - smoothstep(c[k] - c[k] * transMult, c[k] + c[k] * transMult, normEcc);
    }

    // Reconstruct
    result = mip[8];
    for (int k = 0; k < 8; k++) { result += band[k] * w[k]; }
    result = clamp(result, 0.0, 1.0);

    // BGRA → RGBA (Electron capture quirk)
    float temp = result.r;
    result.r = result.b;
    result.b = temp;

    return result;
}
```

**Key design decisions**:
- **MIP level 1 for gradient**: Level 0 is noisy (individual pixels). Level 1 averages 2x2 blocks, giving stroke-level orientation without aliasing artifacts.
- **Luminance-only gradient**: Color gradients (e.g. red→green) shouldn't trigger orientation bonus. Only luminance edges (structural) matter.
- **Double-angle trick**: `cos(2θ)` maps both 0° and 90° to the same value (1.0), and 45°/135° to 0.0. This avoids needing to distinguish H from V — both get the same bonus.
- **Gradient magnitude gate**: Critical. Without this, flat regions (sky, backgrounds) would get random orientation from noise and receive undeserved bonuses.

---

### Phase 2: 4-Orientation Channels (V1 Simple Cell Model)

**Goal**: Distinguish H, V, and two diagonal orientations independently. This enables asymmetric treatment: H edges (text lines) can get a stronger bonus than V edges (column borders).

```glsl
// Replace the single cos2theta with 4-channel energy decomposition.
// Each channel measures energy aligned with one of 0°, 45°, 90°, 135°.
// Uses the same 4-tap gradient — no additional texture lookups.

// Gradient components from Phase 1 (gx, gy already computed)
float energy_h = gy * gy;           // Horizontal edges → vertical gradient
float energy_v = gx * gx;           // Vertical edges → horizontal gradient
float gd1 = (gx + gy) * 0.7071;    // 45° projection (1/sqrt(2))
float gd2 = (gx - gy) * 0.7071;    // 135° projection
float energy_d45  = gd1 * gd1;
float energy_d135 = gd2 * gd2;

// Normalize energies
float totalEnergy = energy_h + energy_v + energy_d45 + energy_d135 + 1e-6;
float norm_h    = energy_h / totalEnergy;
float norm_v    = energy_v / totalEnergy;
float norm_d45  = energy_d45 / totalEnergy;
float norm_d135 = energy_d135 / totalEnergy;

// Cardinal advantage: H/V channels weighted higher
// orient_bias controls the magnitude of the oblique effect
float orientBonus = (norm_h + norm_v) * orient_bias * edgeGate * orient_enabled;

// Per-band boost (same structure as Phase 1, now using decomposed energy)
float boost0 = 1.0 + orientBonus * 0.5;
// ... (same cascade)
```

**Why this matters**: Text-heavy pages have predominantly horizontal edges (text baselines, ascender/descender lines). Phase 2 lets us weight horizontal edges more heavily than vertical ones if desired, matching the asymmetric crowding data (Pelli et al., 2007).

---

### Phase 3: Radial-Tangential Bias

**Goal**: Content aligned tangentially to the fovea (perpendicular to the eccentricity vector) persists further than radially-aligned content.

**Biological basis**: Toet & Levi (1992) showed crowding extent is ~2x larger in the radial direction. Tangential flankers crowd less. This means tangential edges should survive further into the periphery.

```glsl
// Compute radial direction from fovea (passed as uniform or computed in main)
vec2 radialDir = normalize(uv - mouse_uv);

// Edge orientation vector (perpendicular to gradient)
vec2 edgeDir = vec2(-gy, gx);  // 90° rotation of gradient
float edgeMag = length(edgeDir);
edgeDir = (edgeMag > 1e-6) ? edgeDir / edgeMag : vec2(0.0);

// Tangential alignment: how much does the edge align with the tangential
// direction (perpendicular to radial)?
// dot(edgeDir, tangentialDir) where tangentialDir = vec2(-radialDir.y, radialDir.x)
vec2 tangentialDir = vec2(-radialDir.y, radialDir.x);
float tangentialAlign = abs(dot(edgeDir, tangentialDir));

// Radial alignment = 1 - tangential
float radialAlign = 1.0 - tangentialAlign;

// Radial penalty: radially-aligned content loses its bonus
// Tangential bonus: tangentially-aligned content gains extra persistence
float radialBias = mix(1.0, 1.0 + radial_bias * 0.3, tangentialAlign)
                 * mix(1.0, 1.0 - radial_bias * 0.15, radialAlign);

// Apply to cutoffs (multiplicative with orientation bonus)
float c0 = c0_base * boost0 * radialBias;
// ... same for c1, c2, c3
```

**Key considerations**:
- `radialDir` can be computed in `main()` and passed in, since `u_mouse` and `uv` are already available.
- The radial bias is multiplicative with the orientation bonus, not additive. A tangential H edge gets both the cardinal bonus AND the tangential bonus.
- `u_dog_radial_bias` defaults to 0.0 (off) to allow incremental validation.

---

## 4. New Uniforms

| Uniform | Type | Default | Range | Description |
|---------|------|---------|-------|-------------|
| `u_dog_oriented` | float | 0.0 | 0.0-1.0 | Enable oriented DoG (0=isotropic/legacy, 1=oriented) |
| `u_dog_orient_bias` | float | 1.0 | 0.0-2.0 | Strength of the oblique effect (0=no cardinal advantage, 1=biological, 2=exaggerated) |
| `u_dog_radial_bias` | float | 0.0 | 0.0-1.0 | Radial-tangential anisotropy strength (Phase 3, 0=off) |

**Design rationale**:
- `u_dog_oriented` as a float (not bool) allows smooth transition between isotropic and oriented modes during A/B testing.
- `u_dog_orient_bias` at 1.0 gives ~50% cutoff extension for cardinal edges, matching psychophysical data. Values >1.0 exaggerate the effect for presentation/demonstration.
- All three default to off/neutral to preserve backward compatibility.

---

## 5. Integration Points

### 5.1 `renderer/shaders/peripheral2.frag`

| Location | Change |
|----------|--------|
| Lines 38-41 (uniforms) | Add 3 new uniform declarations |
| Lines 92-143 (`sampleDoGReconstructed`) | Replace with `sampleDoGOriented` (superset, falls back to isotropic when `orient_enabled=0`) |
| Line 543-546 (V4 call site) | Update function call to pass new uniforms |

The new function signature:
```glsl
vec4 sampleDoGOriented(vec2 uv, float eccentricity, float fovea_radius,
                        float dog_e2, float dog_sharpness,
                        float orient_enabled, float orient_bias);
```

When `orient_enabled ≈ 0.0`, `orientBonus` is zero and all cutoff boosts are 1.0 — the function produces identical output to the current `sampleDoGReconstructed`. This means the replacement is safe even before modes.json is updated.

### 5.2 `renderer/webgl-renderer.js`

| Location | Change |
|----------|--------|
| ~Line 95-97 (defaults) | Add `dog_oriented: false, dog_orient_bias: 1.0, dog_radial_bias: 0.0` |
| ~Line 179-181 (uniform lookup) | Add `gl.getUniformLocation` for 3 new uniforms |
| ~Line 350-355 (mode apply) | Plumb new config keys from mode pipeline |
| ~Line 487-489 (draw) | Upload 3 new uniforms via `gl.uniform1f` |

### 5.3 `shared/modes.json`

Add to `highkey` and `biological` pipeline blocks:

```json
{
    "dog_oriented": true,
    "dog_orient_bias": 1.0,
    "dog_radial_bias": 0.0
}
```

| Mode | `dog_oriented` | `dog_orient_bias` | `dog_radial_bias` | Rationale |
|------|---------------|-------------------|-------------------|-----------|
| High-Key (0) | `true` | `1.0` | `0.0` | Standard oblique effect (Phase 1) |
| Biological (1) | `true` | `1.0` | `0.5` | Full biological model (Phase 3 when ready) |
| Frosted (2) | `false` | — | — | Not biologically motivated |
| Blueprint (3) | `false` | — | — | Uses Sobel edges |
| Cyberpunk (4) | `false` | — | — | Uses pixelation |
| Double Vision (5) | `false` | — | — | Artistic mode |

---

## 6. Cost Analysis

### Texture Lookups

| Component | Lookups | Notes |
|-----------|---------|-------|
| Current DoG (Phase 0) | 5 (`textureLod` at MIP 0-4) | Already paid |
| Phase 1 gradient | +4 (`textureLod` at MIP 1, 4 offsets) | Cross pattern for gx, gy |
| **Total Phase 1** | **9** | MIP 1 lookups are cheaper (1/4 texels) |
| Phase 2 | +0 (reuses Phase 1 gradient) | Pure ALU |
| Phase 3 | +0 (reuses gradient + radial from `main()`) | Pure ALU |

### ALU Operations (Per Fragment)

| Phase | Extra Ops | Description |
|-------|-----------|-------------|
| Phase 1 | ~10 | 4 dot products (luma), 2 sub, 1 sqrt, 1 div, 1 abs, 1 smoothstep, 4 mul |
| Phase 2 | ~5 more | 4 sq, 2 mul, 1 add, normalize |
| Phase 3 | ~5 more | normalize, dot, 2 mix |

### Estimated Performance Impact (M1 MacBook)

| Metric | Current | Phase 1 | Phase 2 | Phase 3 |
|--------|---------|---------|---------|---------|
| Fragment cost | ~0.8ms | ~1.0ms | ~1.05ms | ~1.1ms |
| Delta | — | +0.2ms | +0.05ms | +0.05ms |
| FPS impact (60fps budget) | — | -1.2% | -0.3% | -0.3% |

The 4 extra MIP-1 lookups dominate cost. MIP level 1 texels are 4x smaller than level 0, so cache behavior is excellent. The ALU overhead is negligible on modern GPUs (shader-bound at the texture unit, not ALU).

---

## 7. Debug Visualization

### Gradient Field Overlay (Debug Mode Extension)

Add a new debug level to the existing `u_debug_structure` system:

```glsl
// In main(), after existing debug levels (0.5, 1.5, 2.5):
if (debugLevel > 3.5) {
    // Gradient orientation field visualization
    vec2 px = 2.0 / u_resolution;
    float lum_r = dot(textureLod(u_texture, uv + vec2(px.x, 0.0), 1.0).rgb, vec3(0.299, 0.587, 0.114));
    float lum_l = dot(textureLod(u_texture, uv - vec2(px.x, 0.0), 1.0).rgb, vec3(0.299, 0.587, 0.114));
    float lum_t = dot(textureLod(u_texture, uv + vec2(0.0, px.y), 1.0).rgb, vec3(0.299, 0.587, 0.114));
    float lum_b = dot(textureLod(u_texture, uv - vec2(0.0, px.y), 1.0).rgb, vec3(0.299, 0.587, 0.114));

    float gx = lum_r - lum_l;
    float gy = lum_t - lum_b;
    float mag = sqrt(gx*gx + gy*gy);
    float g2 = gx*gx + gy*gy;
    float cos2theta = (g2 > 1e-6) ? abs(gx*gx - gy*gy) / g2 : 0.0;

    // Encode: R = gradient magnitude, G = cardinal alignment, B = oblique alignment
    color.rgb = vec3(
        smoothstep(0.0, 0.15, mag),           // R: edge strength
        cos2theta * smoothstep(0.02, 0.08, mag), // G: cardinal edges (bright green = H/V)
        (1.0 - cos2theta) * smoothstep(0.02, 0.08, mag)  // B: oblique edges (bright blue = diagonal)
    );
}
```

**Visual interpretation**:
- **Green regions**: Cardinal (H/V) edges → these get the orientation bonus
- **Blue regions**: Oblique (diagonal) edges → no bonus
- **Dark regions**: Flat areas (no edges) → no bonus (gradient gate active)
- **Red intensity**: Overall edge strength

### Band Weight Overlay

A second debug mode showing effective per-band cutoff modulation:

```glsl
if (debugLevel > 4.5) {
    // Show which band is the "last survivor" at this eccentricity
    // Brighter = more bands preserved
    float bandCount = w0 + w1 + w2 + w3;  // 0-4
    color.rgb = vec3(bandCount * 0.25);     // 0=black (all killed), 1=white (all preserved)
    // Tint by orientation bonus: green = boosted, gray = baseline
    color.g += orientBonus * 0.3;
}
```

---

## 8. Testing Strategy

### 8.1 Golden Captures (Regression)

Extend the existing golden capture suite (`tests/golden-captures/`) with oriented DoG variants:

| Capture | Page | Config | Validates |
|---------|------|--------|-----------|
| `highkey_oriented_dashboard.png` | Dashboard | `dog_oriented=true, orient_bias=1.0` | Text legibility at parafovea boundary |
| `highkey_isotropic_dashboard.png` | Dashboard | `dog_oriented=false` | Baseline comparison |
| `biological_oriented_article.png` | Article | `dog_oriented=true, orient_bias=1.0, radial_bias=0.5` | Body text vs sidebar asymmetry |
| `biological_isotropic_article.png` | Article | `dog_oriented=false` | Baseline comparison |
| `debug_gradient_field.png` | Article | `debug_structure=4` | Gradient field correctness |
| `debug_band_weights.png` | Article | `debug_structure=5` | Band modulation visualization |

**Comparison method**: Side-by-side isotropic vs oriented at same eccentricity. Text regions should show measurably higher band preservation in oriented mode.

### 8.2 Performance Measurement

```javascript
// In webgl-renderer.js, bracket the draw call with EXT_disjoint_timer_query_webgl2
const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
const query = gl.createQuery();
gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
// ... draw call ...
gl.endQuery(ext.TIME_ELAPSED_EXT);
```

**Acceptance criteria**:
- Phase 1 adds ≤ 0.3ms on M1 MacBook (measured over 1000 frames)
- No measurable impact when `dog_oriented = 0` (early-out path)
- No FPS drop below 55fps on any reference page at default settings

### 8.3 Perceptual A/B Testing

**Protocol** (manual, with golden captures):

1. Display reference page at fixed fovea position
2. Capture both isotropic and oriented DoG at identical eccentricity
3. Crop a horizontal strip at parafovea boundary (~3° eccentricity)

**Expected results**:
- Oriented mode: horizontal text strokes partially legible at parafovea boundary
- Isotropic mode: same text fully pooled/illegible
- Both modes: diagonal noise equally degraded
- Both modes: flat background regions identical

### 8.4 Unit Tests (Shader Logic)

The gradient computation and orientation classification can be tested independently by rendering synthetic inputs:

| Test | Input | Expected |
|------|-------|----------|
| Horizontal edge | White-top / black-bottom | `cos2theta ≈ 1.0`, `energy_h >> energy_v` |
| Vertical edge | White-left / black-right | `cos2theta ≈ 1.0`, `energy_v >> energy_h` |
| 45° diagonal | Diagonal gradient | `cos2theta ≈ 0.0`, `energy_d45 >> others` |
| Flat field | Uniform gray | `gradMag ≈ 0`, `edgeGate ≈ 0` (no bonus) |
| Noise | Random pixels | `cos2theta` varies, `edgeGate` moderate, bonus averages out |

---

## 9. References

1. **Hubel, D. H. & Wiesel, T. N.** (1962). Receptive fields, binocular interaction and functional architecture in the cat's visual cortex. *Journal of Physiology*, 160(1), 106-154. — V1 orientation selectivity.

2. **Appelle, S.** (1972). Perception and discrimination as a function of stimulus orientation: the "oblique effect" in man and animals. *Psychological Bulletin*, 78(4), 266-278. — Cardinal superiority in acuity.

3. **Campbell, F. W., Kulikowski, J. J. & Levinson, J.** (1966). The effect of orientation on the visual resolution of gratings. *Journal of Physiology*, 187(2), 427-436. — Orientation-dependent contrast sensitivity.

4. **Furmanski, C. S. & Engel, S. A.** (2000). An oblique effect in human primary visual cortex. *Nature Neuroscience*, 3(6), 535-536. — fMRI evidence for cardinal overrepresentation in V1.

5. **Toet, A. & Levi, D. M.** (1992). The two-dimensional shape of spatial interaction zones in the parafovea. *Vision Research*, 32(7), 1349-1357. — Radial-tangential crowding asymmetry.

6. **Pelli, D. G., Tillman, K. A., Freeman, J., Su, M., Berger, T. D., & Majaj, N. J.** (2007). Crowding and eccentricity determine reading rate. *Journal of Vision*, 7(2), 20. — Crowding destroys letter recognition in periphery.

7. **Rosenholtz, R., Huang, J. & Ehinger, K. A.** (2012). Rethinking the role of top-down attention in vision: effects attributable to a lossy representation in peripheral vision. *Frontiers in Psychology*, 3, 13. — Pooling model of peripheral vision.

8. **Freeman, J. & Simoncelli, E. P.** (2011). Metamers of the ventral stream. *Nature Neuroscience*, 14(9), 1195-1201. — Texture synthesis based on pooled statistics.

9. **Greenwood, J. A., Szinte, M., Sayim, B. & Cavanagh, P.** (2017). Variations in crowding, saccadic precision, and spatial localization reveal the shared topology of spatial vision. *PNAS*, 114(17), E3573-E3582. — Unified crowding model linking radial/tangential anisotropy to cortical architecture.
