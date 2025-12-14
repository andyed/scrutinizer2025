# Mongrel Textures Specification

## 1. Overview

"Mongrel" textures (Rosenholtz et al.) represent the **statistical summary** of visual information as processed by the peripheral visual system. The brain does not "see" individual pixels in the periphery—it perceives pooled statistics: average color, texture orientation, contrast variance, and density.

### Current State: "Shatter" Approximation
Scrutinizer's current peripheral simulation uses **positional jitter** (the "Shatter" mode) to break legibility. While effective at disrupting word shapes, it does not accurately model how the peripheral visual system compresses information.

| Aspect | Shatter (Current) | True Mongrel |
|--------|-------------------|--------------|
| Breaks legibility | ✅ Yes | ✅ Yes |
| Preserves local contrast | ❌ Lost in jitter | ✅ Yes |
| Preserves texture orientation | ❌ No | ✅ Yes |
| Pooling region size grows with eccentricity | ❌ No | ✅ Yes |
| Performance | ✅ Excellent | ⚠️ Depends on tier |

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

## 3. Tiered Implementation Strategy

### Performance Budget
| Tier | Target GPU Cost | Strategy | Status |
|------|-----------------|----------|--------|
| **Tier 0** (Legacy) | ~0.5ms | Shatter jitter | ⚠️ Deprecated |
| **Tier 1** | ~0.3ms | Eccentricity-based MIP sampling | ✅ **Implemented (v1.4)** |
| **Tier 2** | ~2.0ms | Contrast-preserving pooling | 📋 Planned |
| **Tier 3** | ~3-4ms | Statistical texture replacement (WebGPU) | 📋 Future |

---

### Tier 1: Eccentricity-Based MIP Sampling (Low Cost) ✅ IMPLEMENTED

**Goal**: Replace uniform blur with biologically-motivated pooling that grows with eccentricity.

**Mechanism**: Use `textureLod()` with MIP level driven by distance from fovea.

**WebGL2 Implementation** (`peripheral.frag`):

```glsl
// === HELPER: MIP-BASED POOLING ===
vec4 sampleMIPPooled(vec2 uv, float eccentricity, float fovea_radius) {
    float normalizedEcc = max(0.0, eccentricity) / fovea_radius;
    
    // Biological: receptive field size doubles every ~2° of eccentricity
    float mipScaling = 2.5; // Tune: higher = faster pooling growth
    float maxMipLevel = 4.0; // Cap at 16x16 pooling (level 4)
    
    float mipLevel = clamp(normalizedEcc * mipScaling, 0.0, maxMipLevel);
    
    // Sample using textureLod with computed MIP level
    vec4 col = textureLod(u_texture, uv, mipLevel);
    
    // Apply BGRA -> RGBA swap
    float temp = col.r;
    col.r = col.b;
    col.b = temp;
    
    return col;
}

// === V4 STAGE: Smooth Blend Zone ===
vec3 foveaCol = sampleSource(v1.distortedUV).rgb;
vec3 pooledCol = sampleMIPPooled(v1.distortedUV, eccentricity, fovea_radius).rgb;

// 10% transition band to eliminate visible boundary
float blendFactor = smoothstep(0.0, fovea_radius * 0.1, eccentricity);
vec3 col = mix(foveaCol, pooledCol, blendFactor);
```

**WebGL2 Renderer** (`webgl-renderer.js`):
```javascript
// Texture setup: Enable MIP-map generation
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);

// On frame upload: Generate MIP chain
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
gl.generateMipmap(gl.TEXTURE_2D);
```

**Visual Effect**:
- Progressive pooling that increases smoothly with eccentricity
- No visible boundary at fovea edge (smooth blend zone)
- MIP level transitions are invisible (trilinear filtering)

**Performance**: ~0.1-0.2ms (trivial—MIP sampling is hardware-accelerated, blend is a single `mix()`).

**Tunable Parameters**:
- `mipScaling = 2.5`: How quickly pooling grows with eccentricity
- `maxMipLevel = 4.0`: Maximum pooling (level 4 = 16×16 blocks)
- Blend zone = `fovea_radius * 0.1`: Width of smooth transition

---

### Tier 1.8: Coherent Micro-Warp & Lateral Smash (The "Melter") ✅ IMPLEMENTED (v1.4.1)

**Goal**: Replace "Shatter" jitter with coherent distortion that targets stroke width. This is the new baseline for peripheral distortion.

**Mechanism**:
- **Simplex Noise (High Freq)**: ~900Hz noise twists detailed strokes.
- **Simplex Noise (Low Freq)**: ~20Hz noise wobbles word shapes.
- **Lateral Smash**: X-axis distortion is multiplied by 6.0x to force horizontal letter collisions.
- **Coupled Pooling**: MIP level is driven by the warp strength.

**Shader Implementation**:
```glsl
// Tier 1.8.1: Lateral Smash
float micro = snoise(uv * 900.0) * 0.004;
float macro = snoise(uv * 20.0) * 0.01;
vec2 warp = vec2(micro + macro);
warp.x *= 6.0; // Lateral Smash
vec4 color = textureLod(u_texture, uv + warp, mipLevel_from_warp);
```
**Why This Is Better**:
1. **No "Snow"**: Unlike jitter, this doesn't look like static. It looks like melted glass.
2. **Bouma Breaking**: The lateral smash destroys the word shape while keeping the specific "text-like" texture.


---

### Tier 1.6: Unbound Color (Low Cost) ✅ IMPLEMENTED (v1.4.1)

**Goal**: Simulate the "Magno/Parvo Split" where color (Parvo) resolution drops faster than luminance (Magno) resolution in the periphery.

**Implementation**:
- **Radial Offset**: Chromatic aberration pushes radially outward from the fovea (screen-space direction).
- **Unbound Blur**: Chromatic channels are sampled at a higher MIP level (+2.0) than the luminance channel.
- **Effect**: "Ghost" images appear as soft, watercolor-like bleeds, reducing the "sharp double image" artifact.

---

### Tier 2: Contrast-Preserving Pooling (Medium Cost)

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

**JavaScript (in `image-processor.js` or worker)**:
```javascript
function generateStatMIP(sourceCanvas, level) {
  const blockSize = Math.pow(2, level); // 2, 4, 8, 16
  const w = Math.ceil(sourceCanvas.width / blockSize);
  const h = Math.ceil(sourceCanvas.height / blockSize);
  
  const statData = new Float32Array(w * h * 4);
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const block = getBlock(sourceCanvas, x * blockSize, y * blockSize, blockSize);
      const mean = computeMean(block);      // Average luminance
      const stdDev = computeStdDev(block);  // Contrast energy
      const orientation = computeOrientation(block); // Dominant edge direction
      
      const idx = (y * w + x) * 4;
      statData[idx + 0] = mean;        // R: Mean luminance (0-1)
      statData[idx + 1] = stdDev;      // G: Contrast (0-1 normalized)
      statData[idx + 2] = orientation; // B: Orientation (0-1 = 0°-180°)
      statData[idx + 3] = 1.0;
    }
  }
  return statData;
}
```

#### 2b. Shader Reconstruction
```glsl
uniform sampler2D u_statTexture;  // Statistical MIP texture

// Sample statistics at current eccentricity
float mipLevel = eccentricity * 4.0;
vec4 stats = textureLod(u_statTexture, uv, mipLevel);

float meanL = stats.r;
float contrast = stats.g;
float orientation = stats.b;

// Reconstruct: Apply mean color, then modulate with noise scaled by contrast
vec3 meanColor = textureLod(u_texture, uv, mipLevel).rgb;

// Add oriented noise to restore "texture feel"
float noise = orientedNoise(uv * 100.0, orientation);
vec3 mongrelColor = meanColor + (noise * contrast * 0.5);
```

**Visual Effect**:
- High-contrast regions (text, edges) remain "contrasty" even when pooled
- Low-contrast regions (sky, backgrounds) stay smooth
- Orientation-aligned noise hints at edge direction

**Performance**: ~1-2ms (stat MIP generation can be throttled to every 3-5 frames and still look smooth due to temporal coherence).

---

### Tier 3: Statistical Texture Replacement (WebGPU Path)

**Goal**: True Rosenholtz-style synthesis—replace pooling regions with procedural textures that match summary statistics.

**Mechanism**: Compute shader analyzes each pooling tile and selects/generates a matching procedural texture.

**Why WebGPU?**: Compute shaders allow efficient parallel processing of thousands of tiles. WebGL2 would require expensive GPGPU workarounds (render-to-texture ping-pong).

#### 3a. Tile Atlas
Pre-generate a **texture atlas** of procedural patterns:

| Tile ID | Description | When Used |
|---------|-------------|-----------|
| 0 | Solid color | Low contrast (σ < 0.05) |
| 1-4 | Horizontal stripes (various freq) | Orientation ~0°, high contrast |
| 5-8 | Vertical stripes | Orientation ~90°, high contrast |
| 9-12 | Diagonal stripes (45°, 135°) | Orientation ~45°/135° |
| 13-16 | Noise patches (various freq) | High contrast, no dominant orientation |

#### 3b. WebGPU Compute Shader (Pseudocode)
```wgsl
@compute @workgroup_size(8, 8)
fn analyzeTile(@builtin(global_invocation_id) id: vec3<u32>) {
    let tileX = id.x;
    let tileY = id.y;
    let tileSize = getTileSizeForEccentricity(tileX, tileY); // 4, 8, 16, 32...
    
    // Analyze tile
    let stats = computeTileStats(tileX, tileY, tileSize);
    // stats.mean, stats.variance, stats.orientation, stats.frequency
    
    // Select best-matching atlas tile
    let atlasIndex = matchToAtlas(stats);
    
    // Write to output: (atlasIndex, tint color, noise seed)
    tileMap[tileY * tilesX + tileX] = vec4(atlasIndex, stats.mean, randomSeed, 1.0);
}
```

#### 3c. Fragment Shader Consumption
```glsl
// Read tile assignment
vec4 tileInfo = texelFetch(u_tileMap, tileCoord, 0);
int atlasIndex = int(tileInfo.r);
vec3 tintColor = vec3(tileInfo.g); // Mean color
float seed = tileInfo.b;

// Sample procedural texture from atlas
vec2 atlasUV = getAtlasUV(atlasIndex, localUV, seed);
vec3 proceduralTex = texture(u_atlas, atlasUV).rgb;

// Tint with mean color
vec3 mongrelColor = proceduralTex * tintColor;
```

**Visual Effect**:
- Peripheral regions genuinely look like "texture summaries"
- Text becomes horizontal stripes. Faces become blobs. Logos become colored shapes.
- Closest to Rosenholtz et al.'s published mongrel images

**Performance**: ~3-4ms on modern discrete GPU. May need LOD/throttling on integrated graphics.

**Migration Path**:
1. Implement Tier 1 & 2 in WebGL2 (current stack)
2. Add WebGPU feature detection: `if (navigator.gpu)`
3. Load Tier 3 compute pipeline when available
4. Graceful fallback to Tier 2 on non-WebGPU browsers

---

## 4. Integration with Existing Pipeline

### 4.1 Where It Fits
The Mongrel system operates in **V1 (Geometry)** stage of the neuro-architecture pipeline:

```
LGN (Gating) → V1 (Geometry/Mongrel) → V4 (Aesthetics)
                     ↑
              This is where Mongrel lives
```

### 4.2 Mode Selection
Update `ModeConfig` to include Mongrel tier:

```typescript
interface ModeConfig {
  v1_distortion: 'none' | 'noise' | 'shatter' | 'mongrel_t1' | 'mongrel_t2' | 'mongrel_t3';
  // ...
}

// Mode mappings
const MODES = {
  'Natural': { v1_distortion: 'mongrel_t2' },  // Upgrade from 'shatter'
  'Blueprint': { v1_distortion: 'none' },
  'Research': { v1_distortion: 'mongrel_t3' }, // When WebGPU available
};
```

### 4.3 Structure Map Interaction
Mongrel pooling should respect the **Structure Map** density signal:
- **Dense text regions**: Smaller effective tile size (more detail preserved)
- **Empty whitespace**: Skip processing entirely (no visible change)

```glsl
float density = texture(u_structureMap, uv).g;
float adjustedMipLevel = mipLevel * (1.0 - density * 0.3); // Dense areas get finer sampling
```

---

## 5. Blueprint Mode Enhancement

### 5.1 New Sub-Mode: "Receptive Field Grid"
Visualize the pooling structure itself:

- **Fovea**: Tiny grid (or no grid—"I see everything")
- **Parafovea**: 4x4 tile grid overlay
- **Periphery**: 16x16 or larger tiles

**Implementation**: Render tile boundaries as thin lines, color-coded by:
- **Red intensity**: Contrast variance of tile
- **Hue rotation**: Dominant orientation (horizontal = red, vertical = cyan)

### 5.2 "Retinal Truth" Layer
Add to `blueprint_mods.md`:

| Layer | Name | Description |
|-------|------|-------------|
| 0 | DOM Truth | What the browser renders |
| 1 | Structure Map | Semantic layout (text, image, interactive) |
| 2 | **Retinal Truth** | Mongrel pooling—what the visual system actually perceives |

---

## 6. Performance Validation Plan

| Test | Tier 1 | Tier 2 | Tier 3 |
|------|--------|--------|--------|
| MacBook Pro M1 (WebGL2) | Target <1ms | Target <2ms | N/A (WebGPU TBD) |
| MacBook Pro M1 (WebGPU) | - | - | Target <3ms |
| Windows/Chrome (integrated) | <1ms | <2.5ms | <4ms |
| Windows/Chrome (discrete) | <0.5ms | <1ms | <2ms |

**Measurement Method**: `EXT_disjoint_timer_query_webgl2` or `GPUComputePassTimestampWrites`.

---

## 7. References

1. **Rosenholtz, R., Huang, J., & Ehinger, K. A.** (2012). *Rethinking the role of top-down attention in vision: Effects attributable to a lossy representation in peripheral vision*. Frontiers in Psychology.
2. **Freeman, J., & Simoncelli, E. P.** (2011). *Metamers of the ventral stream*. Nature Neuroscience.
3. **Balas, B., Nakano, L., & Rosenholtz, R.** (2009). *A summary-statistic representation in peripheral vision explains visual crowding*. Journal of Vision.
