# Scrutinizer Foveated Vision Model

This document explains how Scrutinizer simulates human foveal / peripheral vision, and how the underlying shader parameters map to the visual effect. It is intended for advanced users and developers who want to reason about (and eventually tune) the non‑foveal disruption profile.

---

## 1. The Biology: From Photoreceptors to Perception

Before diving into shader parameters, it helps to understand *why* foveal and peripheral vision differ so dramatically. The answer lies in the architecture of the visual system itself—from the retina to the cortex.

### 1.1 The Retina: Two Receptor Systems

The human retina contains two fundamentally different photoreceptor types, each optimized for different tasks:

#### Cones (The "What" System)
- **~6 million** total, concentrated in the **fovea** (central 2° of vision)
- **Three types** (L, M, S) enable color vision
- **High temporal resolution** for fine detail and motion
- **1:1 wiring** in the fovea—each cone connects to its own ganglion cell
- **Peak density**: ~200,000 cones/mm² at the foveal center

#### Rods (The "Where" System)
- **~120 million** total, distributed across the **periphery**
- **Single type** (no color discrimination)
- **Peak sensitivity at 505nm** (cyan/blue-green)—blind to red light
- **Convergent wiring**: ~100 rods share a single ganglion cell
- **Peak density**: ~160,000 rods/mm² at ~20° eccentricity

> **The Key Insight**: This distribution is not a design flaw—it's an optimization. The fovea sacrifices sensitivity for resolution (1:1 wiring). The periphery sacrifices resolution for sensitivity (100:1 convergence). You can't have both.

### 1.2 The Wiring: Why Periphery is "Blurry"

The critical difference isn't just receptor density—it's **how receptors connect to the brain**.

```
FOVEA (1:1 Wiring)              PERIPHERY (Convergent Wiring)
                                
  Cone → Bipolar → Ganglion       Rod ─┐
  Cone → Bipolar → Ganglion       Rod ─┼→ Bipolar → Ganglion
  Cone → Bipolar → Ganglion       Rod ─┤
                                  Rod ─┘
                                  
  = 3 signals to brain            = 1 signal to brain (averaged)
```

In the periphery, **receptive fields grow with eccentricity**. A single ganglion cell might pool signals from hundreds of photoreceptors. This pooling:
- **Destroys spatial detail** (you can't know *which* rod fired)
- **Preserves statistical summaries** (average brightness, texture energy)
- **Enables motion detection** (any rod in the pool triggers the cell)

This is why peripheral vision sees "textures" rather than "letters"—the wiring physically prevents high-resolution readout.

### 1.3 The Pathway: Retina → LGN → V1 → V4

Visual information flows through a hierarchical pipeline, with each stage adding abstraction:

```
┌─────────────────────────────────────────────────────────────────────┐
│  RETINA                                                             │
│  ┌─────────────┐                                                    │
│  │ Photoreceptors (Rods/Cones)                                      │
│  │      ↓                                                           │
│  │ Bipolar Cells (ON/OFF channels)                                  │
│  │      ↓                                                           │
│  │ Ganglion Cells → Optic Nerve                                     │
│  └─────────────┘                                                    │
│        ↓                                                            │
├─────────────────────────────────────────────────────────────────────┤
│  LGN (Lateral Geniculate Nucleus) — "The Gatekeeper"                │
│  • Receives 10-20% input from retina, 30-40% from V1 FEEDBACK       │
│  • Implements attentional gating (what gets through to cortex)      │
│  • Separates Magnocellular (motion/luminance) from Parvocellular    │
│    (color/detail) streams                                           │
│        ↓                                                            │
├─────────────────────────────────────────────────────────────────────┤
│  V1 (Primary Visual Cortex) — "The Feature Extractor"               │
│  • Orientation-selective neurons (Hubel & Wiesel)                   │
│  • Spatial frequency channels (fine vs coarse detail)               │
│  • Retinotopic map: fovea gets MASSIVE cortical magnification       │
│  • Crowding emerges here: adjacent features interfere               │
│        ↓                                                            │
├─────────────────────────────────────────────────────────────────────┤
│  V4 (Visual Area 4) — "The Interpreter"                             │
│  • Color constancy and surface perception                           │
│  • Shape recognition (curves, contours)                             │
│  • Aesthetic processing begins here                                 │
│        ↓                                                            │
│  Higher Areas (IT, FFA, PPA...) — Object/Face/Scene recognition     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.4 Cortical Magnification: The Fovea's Unfair Advantage

Even though the fovea covers only **2° of visual angle** (~1% of the visual field), it commands **~50% of V1's cortical surface area**. This "cortical magnification" means:

- Foveal signals get more neurons, more processing, more bandwidth
- Peripheral signals are compressed into fewer neurons
- The brain literally allocates more "compute" to the center

> **Scrutinizer's Pipeline Mirrors This**: Our LGN → V1 → V4 shader stages are named after these biological areas. While not a rigorous simulation, the architecture reflects the same principle: gating (LGN), geometric distortion (V1), and aesthetic rendering (V4).

### 1.5 What This Means for Peripheral Vision

The biological architecture produces several emergent properties that Scrutinizer simulates:

| Biological Phenomenon | Cause | Scrutinizer Implementation |
|----------------------|-------|---------------------------|
| **Resolution loss** | Receptor pooling (100:1) | MIP-based pooling (textureLod) |
| **Color blindness** | Rod dominance (no color) | Oklab desaturation + cyan tint |
| **Crowding** | Receptive field overlap | Domain warping + lateral smash |
| **Motion sensitivity** | Magnocellular pathway | Preserved contrast in periphery |
| **Positional uncertainty** | Large receptive fields | Simplex noise displacement |

---

## 2. Coordinate System and Foveal Radius

Now that we understand *why* foveal and peripheral vision differ, we can map these biological constraints to shader parameters.

The WebGL renderer receives:

- `u_resolution`: canvas size in pixels
- `u_mouse`: foveal center in pixels (canvas coordinates)
- `u_foveaRadius`: foveal radius in pixels

In the fragment shader:

- Texture coordinates `uv` are corrected for aspect ratio and squashed in X to approximate an elliptical (4:3) foveal footprint
- A normalized distance `dist` is computed from the foveal center in this corrected space
- A normalized radius is defined as: `radius_norm = u_foveaRadius / u_resolution.y`

This allows us to express all zones as **fractions of the configured foveal radius**, independent of actual pixel resolution.

Biologically, the fovea is approximately circular. For screen-based reading and text layouts, we deliberately apply an **elliptical aspect correction** (default 4:3) so that the "usable" sharp region better matches the horizontally biased saccades you make across lines of text.

### Biological Calibration: The 5° Macular Region

The **parafoveal region** (fovea + parafovea combined) corresponds to the **5° macular zone** in biological vision. On a high-density display at typical viewing distance (~60cm), this translates to approximately:

- **Macular (0-5°) diameter**: ~462px
- **Macular (0-5°) radius**: ~231px
- **Foveal (0-2°) radius**: ~92px
- **Ratio**: 231/92 = **2.5x**

**Key Insight**: This ~462px diameter zone is where users can rapidly perceive holistic information and spatial cues without making a saccade (direct eye movement). Optimizing web layouts for this region leverages the brain's parafoveal processing for key tasks like:
- Word length perception (saccade planning)
- Link detection (contrast + geometric cues)
- Layout structure (spatial relationships)

**Parafoveal Boundaries by Foveal Setting**:

| Foveal Setting | Foveal Radius | Parafoveal Boundary (2.5x) | Biological Mapping |
|----------------|---------------|----------------------------|-------------------|
| Extra Small    | 20px          | 50px                       | -                 |
| Small          | 45px          | 113px                      | -                 | 
| Medium         | 90px          | 225px                      | ~5° macula        |
| **Large**      | **180px**     | **450px**                  | Exaggerated       |
| Extra Large    | 300px         | 750px                      | Demo/presentation |
| Huge           | 450px         | 1125px                     | Extreme demo      |

**Recommended Setting**: **Medium (90px)** provides the closest match to biological reality (~231px macular boundary).

---

## 3. Three Spatial Zones

All non‑foveal processing is defined in terms of three concentric zones, expressed as multiples of `radius_norm`.

- **Fovea**  
  - Range: `0 → 1.0 × radius_norm`  
  - Visual: crystal‑clear, full color, no positional warping or jitter.

- **Parafovea**  
  - Range: `1.0 × radius_norm → 2.5 × radius_norm` (biological macula: 0-5°)
  - Visual: increasing domain warp and high‑frequency jitter. Features are present but positions are uncertain ("heat‑haze crowding").

- **Far periphery**  
  - Starts at: `2.5 × radius_norm` and beyond  
  - Visual: stronger warp/jitter, rod‑like desaturation and tint, and pixel scatter.

Key constants in the shader:

- `fovea_radius = radius_norm`
- `parafovea_radius = radius_norm * 2.5`

The parafoveal region (2-5°) represents the **macular zone** where users can perceive holistic information without direct fixation.

The **debug boundary overlay** is drawn exactly at `dist == fovea_radius`, so the visible grey ring matches the true edge of the sharp foveal zone.

---

## 4. Strength Masks (Distance → Effect Curves)

The shader defines several scalar “strength” values derived from the distance `dist`. These are smoothstep curves that go from 0 to 1 across a band of radii.

- **Warp strength** (positional warp envelope)
  - Formula: `warpStrength = smoothstep(fovea_radius, parafovea_radius, dist)`
  - Interpretation: 0 in the fovea, ramps up across the parafovea, and stays high into the periphery.

- **Chromatic aberration strength**
  - Uses a dithered distance: `distDithered = dist + noise * 0.3`.
  - Formula: `caStrength = smoothstep(periphery_start, periphery_start + 0.25, distDithered)`
  - Interpretation: chromatic splitting only beyond the near periphery. The added noise **breaks the perfectly geometric CA ring**, eliminating a “curtain effect” and creating an organic, ragged transition instead of a hard lens-filter edge.

- **Rod vision strength** (desaturation / tint / grain)
  - Formula: `rodStrength = smoothstep(fovea_radius, periphery_start, dist)`
  - Interpretation: begins just outside the fovea, increases through parafovea, and saturates into periphery.

- **Scatter strength** (pixelation envelope)
  - Formula: `scatterStrength = smoothstep(periphery_start, periphery_start + 0.2, dist)`
  - Interpretation: only active in far periphery, where the visual field becomes noisy and blocky.

Boolean helpers:

- `isParafovea = dist > fovea_radius && dist <= periphery_start`
- `isFarPeriphery = dist > periphery_start`

These flags are used to select different amplitudes for warp and jitter.

For intuition, you can think of each effect as a 1D curve over radius:

```text
Effect strength
1.0 |           _________ Rod Vision
    |          /
    |         /    _____ Scatter / Pixelation
    |        /    /
0.0 |_______/____/___________________________
     0.0   1.0  1.2   1.35               dist
        Fovea   Para   Transition → Periphery
```

---

## 5. Domain Warping & Mipmap Pooling (Crowding)

The shader models the growth of receptive field size with eccentricity using **domain warping** and **pooling**:

1. A coarse multi‑octave noise field (`warpVector`) is sampled in an aspect‑corrected space.
2. The amplitude of this warp is increased in the periphery but kept small and vertically “crushed” in the parafovea to preserve rough baselines and vertical strokes.
3. This warp is multiplied by `warpStrength` and the global intensity.

**Crowding Simulation (Mipmap Bias Pooling)**:
In v1.3+, we introduced **Mipmap Bias Pooling**. Instead of simply distorting pixel coordinates (which preserves high-frequency detail in the wrong place), the shader now increases the Texture LOD (Level of Detail) bias based on eccentricity. This forces the GPU to sample a lower-resolution 'summary statistic' of the texture. When combined with domain warping, this physically simulates **interactional crowding**: features from adjacent letters merge into a 'mongrel' texture, preserving the word shape while destroying legibility.

Intuition:

- In the parafovea, text looks like it is seen through shimmering heat haze.
- In the far periphery, letters collide and smear (mongrelize), but the image does not completely melt.

---

## 6. Universal Structure Map Pipeline (New in v2.0)

To unify rendering across the Open Web (DOM) and Figma (Scene Graph), Scrutinizer v2.0 introduces an **Abstract Layout Provider** architecture. Instead of relying on ad-hoc heuristics, the renderer consumes a normalized data stream of layout blocks.

### The Data Model: `StructureBlock`
Layout data is extracted into a flat array of lightweight objects:
```typescript
interface StructureBlock {
  x: number; y: number; w: number; h: number; // Viewport Geometry
  type: 'TEXT' | 'IMAGE' | 'UI_CONTROL';      // Semantic Type
  lineHeight: number;                         // Rhythm (px)
  density: number;                            // Mass (0.0-1.0)
  interaction: boolean;                       // Clickable?
}
```

### Performance Optimization: Scroll Tracking
The structure map must stay synchronized with content during scrolling. The implementation uses a **dual-strategy approach**:

- **Throttled scans** (16ms): Continuous updates during scroll for ~60fps tracking
- **Debounced final scan** (100ms): Guarantees capture of exact final scroll position
- **Mutation throttle** (100ms): Efficient handling of DOM changes

This ensures smooth visual tracking during scroll with no lag or "snap-to-position" artifacts when scrolling stops.

### Element Detection: Semantic Approach
Instead of maintaining brittle lists of HTML tags, the scanner detects elements by **semantic characteristics**:

**Text Detection** (TreeWalker):
- Traverses all text nodes with non-empty content
- Captures line height and font weight for rhythm/density encoding

**Media Elements** (Explicit Tags):
- Visual elements require tag-based detection: `img`, `svg`, `video`, `canvas`, `picture`, `embed`, `object`, `meter`, `progress`

**Interactive Elements** (Semantic Attributes):
- Form controls: `button`, `input`, `textarea`, `select`, `option`
- Links: `a[href]`
- ARIA roles: `[role="button"]`, `[role="link"]`, `[role="menuitem"]`, `[role="tab"]`, `[role="checkbox"]`, `[role="radio"]`, `[role="switch"]`, `[role="slider"]`
- Editable: `[contenteditable="true"]`
- Custom interactivity: `[onclick]`, `[tabindex]:not([tabindex="-1"])`

This approach is **framework-agnostic** and captures modern web patterns (e.g., `<div role="button">`) without maintaining exhaustive tag lists.

### The Rasterizer: `StructureMap`
These blocks are painted onto an off-screen `<canvas>` (50% resolution for Structure Map, 25% for Saliency Map) to create the `u_structureMap` texture. This texture encodes semantic data into RGBA channels:

| Channel | Data | Description |
| :--- | :--- | :--- |
| **Red** | **Rhythm** | `lineHeight / 100.0`. Defines the vertical cadence of the content. |
| **Green** | **Mass** | `density` (0.0-1.0). Defines visual weight (font weight, image brightness). |
| **Blue** | **Semantics** | Type ID: Text (1.0), Image (0.5), UI (0.0). |
| **Alpha** | **Interaction** | 1.0 = Content. Interaction is encoded in Blue (Text=1.0 vs UI=0.0). |

### Shader Consumption
The fragment shader reads this map to drive two distinct modes:

#### Mode A: Wireframe ("Blueprint" / "Cyberpunk")
Uses the **Red Channel (Rhythm)** to generate procedural geometry.
-   **Logic**: `if (lineHeight > 0) draw_bar(height=lineHeight)`
-   **Result**: A "Terminator-vision" overlay that reveals the underlying grid structure, ignoring the actual pixels.

#### Mode B: Simulation ("Natural")
Uses the **Green Channel (Mass)** to modulate the biological simulation.
-   **Logic**: `finalNoise = baseNoise * density`
-   **Result**: Noise and blur are only applied where there is actual content. Empty whitespace remains clean, preventing the "dirty screen" effect and improving realism.

---

## 7. Coherent Crowding ("The Melter")

### Tier 1.8 & 1.8.1: Structural Melting & Lateral Smash

Earlier versions (v1.2-1.3) used "jitter" (random positional noise) to disrupt recognition. This created a "broken TV" aesthetic that felt like digital glitches rather than biological vision loss.

**Tier 1.8** replaces this with **Coherent Micro-Warping**, targeting the stroke width of text rather than the word shape.

1.  **Micro-Warp (The "Melter")**:
    *   High-frequency Simplex noise (freq ~900.0) matches the width of letter stems.
    *   This "twists" the strokes, breaking the clean vertical lines of ascenders/descenders.

2.  **Lateral Smash (Anisotropic Crowding)** (Tier 1.8.1):
    *   Reading is a horizontal task. To break it, we must smash letters into their neighbors.
    *   **X-Bias**: The horizontal distortion is multiplied by **6.0x**.
    *   **Effect**: Letters slide sideways into each other, merging into a "mongrel" blob, while the vertical structure (the list or paragraph shape) remains intact.

3.  **Coupled Pooling**:
    *   The warp strength drives the MIP level selection. Stronger warp = larger pooling region.
    *   This ensures that as letters collide, they also blur together, physically simulating "Feature Integration Failure."


### Second Pass Softening (v1.2) and Smooth Transitions (v1.3)

**v1.2:** To improve perceptual comfort and reduce motion sickness, the "Second Pass" update introduced:
1. **Variable Gaussian Blur**: Replaces blocky pixelation with a smooth blur that increases exponentially with eccentricity (0px → 3px → 15px+).
2. **Slow Wave Distortion**: Replaces high-frequency "glitch" jitter with a slow (0.1Hz), smooth sine-wave warp. This maintains the "underwater" feel without the rapid, distracting shaking.

**v1.3:** Smoothed the parafovea-periphery transition to eliminate abrupt visual "kinks":

**Previous implementation (v1.2):**
- Parafovea: Linear blur ramp (0px → 3px)
- Periphery: Steep exponential (`3px + distFromPara * 40.0`)
- **Problem:** Hard slope change at boundary created visible discontinuity

**New implementation (v1.3):**
```glsl
// Continuous exponential blur curve
float eccentricity = dist - fovea_radius;
blurRadius = 8.0 * (exp(eccentricity * 2.0) - 1.0);
blurRadius = min(blurRadius, 20.0); // Cap maximum
```

**Benefits:**
- No hard boundary at parafovea edge
- Smooth acceleration from parafovea to periphery
- Natural visual transition

**Contrast preservation** also uses smooth gradient:
```glsl
// Gradual falloff instead of hard switch
float contrastPreservation = mix(0.6, 0.3, 
    smoothstep(0.0, parafovea_radius - fovea_radius, eccentricity));
```

### MIP-Based Pooling (v1.4)

**v1.4:** Replaced the 5-tap Gaussian blur approximation with **hardware MIP-based pooling**, which more accurately models how the peripheral visual system compresses information into "pooling regions."

**Key Insight (Rosenholtz et al.):** The peripheral visual system doesn't just blur the image—it computes summary statistics over pooling regions that grow with eccentricity. Each MIP level doubles the pooling region size, naturally modeling receptive field growth.

**Implementation:**
```glsl
// Calculate MIP level based on eccentricity
float normalizedEcc = max(0.0, eccentricity) / fovea_radius;
float mipScaling = 2.5; // Tune: higher = faster pooling growth
float maxMipLevel = 4.0; // Cap at 16x16 pooling (level 4)
float mipLevel = clamp(normalizedEcc * mipScaling, 0.0, maxMipLevel);

// Sample using textureLod with computed MIP level
vec4 col = textureLod(u_texture, uv, mipLevel);
```

**Smooth Transition:** To eliminate visible boundaries at the fovea edge, a smooth blend zone is applied:
```glsl
vec3 foveaCol = sampleSource(v1.distortedUV).rgb;
vec3 pooledCol = sampleMIPPooled(v1.distortedUV, eccentricity, fovea_radius).rgb;
float blendFactor = smoothstep(0.0, fovea_radius * 0.1, eccentricity);
vec3 col = mix(foveaCol, pooledCol, blendFactor);
```

**Benefits:**
- **Biologically accurate**: Models receptive field pooling, not just blur
- **Performance**: Hardware-accelerated MIP sampling is essentially free
- **Consistent**: Same `textureLod()` function used throughout pipeline

---

# Saliency Map & Fidelity Bias

## Overview

The **Saliency Map** implements computational visual attention, predicting where the eye is drawn based on contrast, edges, and visual "attractiveness." This enables **Fidelity Bias** - the biological principle that periphery degrades less around salient targets to preserve detail for accurate saccade guidance.

## Cognitive vs Retinal Constraint

### Retinal Constraint (Saliency Modulation OFF)
- Degradation is **purely distance-based** (radial from fovea)
- All content at same eccentricity receives equal warping/jitter
- Geometric, homogeneous "heat-haze" effect
- **No cognitive priority** - logos treated same as body text

### Cognitive Constraint (Saliency Modulation ON)
- Degradation is **content-aware** and non-uniform
- High-saliency areas (logos, icons, edges) remain **clearer** in periphery
- M-channel cues preserved for saccadic targeting
- **Brain-like prioritization** - important elements stand out

## Implementation

## Implementation

### 1. Gestalt Grouping (Proximity)
**File**: `renderer/scrutinizer.js`

To simulate the brain's pre-attentive grouping of visual elements, the renderer processes the raw layout stream before generating maps.
-   **Text Merging**: Vertically adjacent text blocks are merged into single "paragraph" clusters.
-   **Quantization**: Block coordinates are snapped to a grid (1px for text, 10px for UI) to prevent sub-pixel jitter from causing "flicker" in the periphery during micro-layout shifts.

### 2. Saliency Map Generation
**File**: `renderer/saliency-worker.js`

The Saliency Map is generated using a **center-surround mechanism** (Difference-of-Gaussians) for biologically accurate attention detection.

**Algorithm** (Itti-Koch-Niebur Model - Oklab Adapted):
1. **Feature Extraction**: Convert to Oklab space:
   - **Intensity (I)**: Oklab `L` Channel (Lightness).
   - **Red-Green (RG)**: Oklab `a` Channel Magnitude (`|a|`).
   - **Blue-Yellow (BY)**: Oklab `b` Channel Magnitude (`|b|`).
2. **Multi-Scale Gaussian Pyramid**: 
   - Fine scale: σ=1.0 (captures details)
   - Coarse scale: σ=3.0 (captures context)
3. **Center-Surround**: For each feature, compute `|Fine - Coarse|`
4. **Feature Combination**: `saliency = 0.3*cs_I + 0.35*cs_RG + 0.35*cs_BY`

**Key Properties**:
- **Isolated objects "pop out"**: High center-surround response
- **Uniform regions suppressed**: Low center-surround response (prevents blank pages from being salient)
- **Edges enhanced**: Strong response at boundaries
- **Biologically accurate**: Matches V1 cortical processing

**Performance**:
- Separable Gaussian blur: O(2n) complexity
- Adaptive resolution scaling (target 256px max dimension)
- Runs in Web Worker (off main thread)
- Target: <5ms @ 256×256

**Temporal Smoothing**:
To prevent "flicker" and "dropouts" during rapid content updates (e.g., video playback), the saliency map uses a **double-buffered** approach with temporal blending.
-   **Target Buffer**: Renders the new state immediately.
-   **Current Buffer**: Blends towards the Target by ~15% per frame.
-   **Result**: Attention shifts feel organic and fluid, rather than snapping instantly.

**References**:
- Itti, Koch, & Niebur (1998) - "A Model of Saliency-Based Visual Attention for Rapid Scene Analysis"
- Walther & Koch (2006) - "Modeling attention to salient proto-objects"

### 3. Texture Pipeline
-   **GL_TEXTURE3**: Saliency texture (Red channel = intensity).
-   **Upload**: The smoothed "Current" buffer is uploaded to the GPU every frame.
-   **Sampling**: `float saliency = texture2D(u_saliencyMap, uv).r;`

### 4. Fidelity Bias Formula
**File**: `renderer/webgl-renderer.js` (in `processLGN` function)

```glsl
// Sample saliency at current pixel
float saliency = texture2D(u_saliencyMap, uv).r;

// Modulate warp strength (reduce distortion near salient areas)
if (u_enable_saliency_modulation > 0.5) {
    warpStrength *= (1.0 - saliency); // High saliency = less distortion
}
```

**Effect**:
-   `saliency = 0.0` (low) → `warpStrength` unchanged (full degradation)
-   `saliency = 1.0` (high) → `warpStrength = 0` (no distortion, sharp)
-   Smooth gradient between extremes

### 5. Validation Results

**Observed Behavior** :
-   **Social media icons** (Twitter, etc.): Visibly clearer than surrounding text (verified pop-out effect)
-   **Logos** (Bitrix24): Resist warping/jitter compared to background
-   **UI elements**: Retain structural integrity for saccade guidance
-   **Body text**: Full peripheral degradation applied normally

**Interpretation**: Successfully demonstrates shift from optical model to cognitive model, reflecting brain's prioritization of salient targets.

## Usage

### Menu Controls
- **Simulation > Content Signals > Show Saliency Map**: Visualize saliency heatmap (Blue→Cyan→Green→Yellow→Red)
- **Simulation > Content Signals > Use Saliency Modulation**: Toggle fidelity bias on/off

### Config
```javascript
{
    enableSaliencyModulation: true  // Enable/disable fidelity bias
}
```

### 6. Extended Modulation (V1 & V4)

Beyond the LGN suppression factor, saliency now modulates additional pipeline stages **in the far periphery only**, leveraging temporal smoothing to prevent flicker on dynamic content.

**V1 (Geometry) Modulation**:
```glsl
// Shatter mode: Reduce jitter near salient areas (far periphery only)
float saliencyJitterMod = 1.0;
if (u_enable_saliency_modulation > 0.5 && isFarPeriphery) {
    float s = lgn.saliency;
    saliencyJitterMod = mix(1.0, 0.75, s); // 25% max reduction
}
jitterScale *= saliencyJitterMod;

// Noise mode: Reduce warp near salient areas (far periphery only)
float saliencyWarpMod = 1.0;
if (u_enable_saliency_modulation > 0.5 && isFarPeriphery) {
    float s = lgn.saliency;
    saliencyWarpMod = mix(1.0, 0.75, s); // 25% max reduction
}
warpVector *= saliencyWarpMod;
```

**V4 (Aesthetics) Modulation**:
```glsl
// Rod vision: Reduce desaturation near salient areas (far periphery only)
if (u_enable_saliency_modulation > 0.5 && dist > parafovea_radius) {
    float s = lgn.saliency;
    float rodMod = mix(1.0, 0.85, s); // 15% max reduction
    desaturationFactor *= rodMod;
}
```

**Effect**: Salient areas (logos, icons, UI elements) in the far periphery retain slightly more geometric stability and color, making them more recognizable for saccade guidance without compromising illegibility.

**Key Design Constraints**:
-   **Parafoveal Isolation**: Foveal and parafoveal motion cannot affect far periphery distortion
-   **Conservative Modulation**: 15-25% max effect, ensuring periphery stays degraded
-   **Temporal Smoothing**: Double-buffered saliency (15% blend/frame) prevents flicker on live video

### 7. Saliency Stabilization (Movie Mode)
To mitigate "breathing" artifacts on full-motion video, the Saliency Map is used to **stabilize** the "Slow Wave" distortion.
-   **Logic**: `waveOffset *= (1.0 - saliency * 0.9)`
-   **Effect**: High-saliency areas (faces, text) in the periphery remain relatively static, while the background continues to wave organically. This creates "islands of stability" that reduce distraction without breaking the overall effect.

## Future Enhancements

1. **Multi-scale Saliency**: Combine detection at multiple blur levels
2. **Inhibition of Return**: Reduce saliency in recently-viewed areas
3. **Parafoveal Band Modulation**: Extend V1/V4 modulation into parafovea with tighter constraints

## Technical Details

### Performance
- **Saliency Computation**: Separable Gaussian Blur (O(2n) complexity).
- **Latency**: <5ms @ 256x256 resolution (running in Web Worker).
- **Memory**: Double-buffered architecture prevents read/write hazards.

### Edge Cases
- **Blank pages**: Uniform low saliency (full degradation)
- **High-contrast text**: Edges highlighted, readability preserved
- **Images**: Strong edges detected, structural forms maintained
- **UI elements**: Buttons, icons remain clear for interaction
---

## 8. Chromatic Aberration (Lens Split)

Chromatic aberration is modeled by sampling the warped position three times:

- Red sample: shifted slightly **toward** the fovea.
- Green sample: at the base warped position.
- Blue sample: shifted slightly **away** from the fovea.

The shift magnitude is:

- `aberrationAmt = 0.02 * caStrength * u_intensity * u_ca_strength`

This creates colored fringes in the periphery, supporting illegibility without needing extremely large blurs.

---

## 9. Rod Vision: Oklab Color Space Desaturation

**New in v1.3:** Peripheral vision color processing has been upgraded from RGB to **Oklab**, a perceptually uniform color space designed for image processing.

### Why Oklab?

RGB color space is not perceptually uniform - equal numeric changes in RGB values do not correspond to equal perceived color differences. When desaturating colors in RGB space, this can produce "muddy" artifacts, especially for saturated colors like reds and blues.

**Oklab** (Ottosson, 2020) is a perceptual color space where:
- **L** (Lightness): Separates luminance from chrominance (0-1 range)
- **a** (Green-Red): Opponent color dimension
- **b** (Blue-Yellow): Opponent color dimension

This separation directly maps to the biological visual system:
- **Magnocellular pathway** (M-cells): Processes luminance (L channel)
- **Parvocellular pathway** (P-cells): Processes chrominance (a, b channels)

### Implementation

#### JavaScript (CPU-side)
**File:** `renderer/oklab-utils.js`, `renderer/image-processor.js`

The blur worker uses Oklab for desaturating the multi-resolution pyramid:

```javascript
// Convert RGB → Oklab
const lab = rgbToOklab(r, g, b);

// Desaturate by reducing chrominance toward zero
lab.a *= (1 - desaturationAmount);
lab.b *= (1 - desaturationAmount);

// Preserve lightness (L) for perceptual uniformity
// Convert back Oklab → RGB
const rgb = oklabToRgb(lab.L, lab.a, lab.b);
```

**Rod-sensitive desaturation** preserves cyan (505nm peak rod sensitivity):
```javascript
// Detect cyan in Oklab space (positive b, negative a)
const isCyan = (lab.b > 0.05 && lab.a < 0);

// Less desaturation for cyan
const desatAmount = isCyan ? 0.7 : 1.0;
lab.a *= (1 - desatAmount);
lab.b *= (1 - desatAmount);
```

#### GLSL (GPU-side)
**File:** `renderer/shaders/peripheral.frag`

The shader includes Oklab conversion functions for real-time processing:

```glsl
// Convert sRGB to Oklab
vec3 rgbToOklab(vec3 srgb);

// Convert Oklab to sRGB
vec3 oklabToRgb(vec3 lab);
```

**High-Key mode** (v4_style_id == 0):
```glsl
// Convert to Oklab
vec3 lab = rgbToOklab(col);

// Desaturate by reducing chrominance
lab.y *= (1.0 - desaturationFactor); // a component
lab.z *= (1.0 - desaturationFactor); // b component

// Convert back to RGB
vec3 desaturatedColor = oklabToRgb(lab);
```

**Eigengrau tinting** in Oklab space:
```glsl
// Eigengrau (dark blue-gray) in Oklab
vec3 eigengrauLab = vec3(0.1, 0.0, -0.05); // Low L, blue shift
vec3 whiteLab = vec3(1.0, 0.0, 0.0);

// Map lightness: dark → eigengrau, bright → white
vec3 rodColorLab = mix(eigengrauLab, whiteLab, L_contrasted);
```

### Benefits

1. **Perceptually uniform desaturation** - No muddy artifacts
2. **Biologically accurate** - Matches Magno/Parvo pathway separation
3. **Natural grayscale** - Preserves perceived brightness
4. **Better rod vision** - Accurate cyan sensitivity (505nm peak)

### Gamma Correction

Oklab requires linear RGB input. The implementation properly handles sRGB gamma correction:
- **sRGB → Linear:** Inverse gamma (2.4 with linear segment)
- **Linear → sRGB:** Forward gamma for display

### Performance

Oklab conversion requires:
- 2 matrix multiplications (3×3)
- 3 cube roots (forward) + 3 cubes (reverse)
- Gamma correction (power functions)

GLSL has hardware-accelerated `pow()` and matrix operations, making the overhead negligible on modern GPUs.

### Scientific Reference

Ottosson, B. (2020). "A perceptual color space for image processing." https://bottosson.github.io/posts/oklab/

---

## 10. Scrollbar Preservation

A thin band near the right edge of the screen is excluded from peripheral processing, so operating system scrollbars and similar UI affordances remain sharp and usable.

- Region: approximately 17 px from the right edge.

This acts as a **Fitts's-law safe zone** for precise pointer targeting. The mask is currently a **hard cutoff** (inside this band, peripheral effects are disabled entirely). A future refinement could turn this into a short gradient band so that, under very strong distortion, the visual handoff into the safe zone is also perceptually smooth.

---

## 11. Debug Boundary Overlay

When enabled from the menu, the shader draws a subtle grey ring at the true foveal edge:

- Location: `dist == fovea_radius`.
- Purpose: visualization only – it does not change sampling or strength masks.

---

## 12. Future Tuning Knobs

The current implementation hard‑codes the key ratios:

- `parafovea_radius / fovea_radius = 2.5` (biological macula: 0-5°)
- `periphery_start / fovea_radius = 2.5` (same as parafovea boundary)

> **Note**: "Calibrated Visual Angles" (Pixels Per Degree) is now implemented via the Foveal Calibration tool, allowing the simulation to adapt to physical monitor size rather than just arbitrary pixel radii.

In future versions, these can be exposed as user‑tunable parameters by mapping UI sliders to:

- Zone boundaries:
  - Inner / outer parafovea extents.
  - Far‑periphery onset.
- Strength curves:
  - Warp and jitter amplitude envelopes by zone.
  - Rod strength onset and saturation.
  - Chromatic aberration strength.

Those sliders would effectively reshape the smoothstep curves described above, allowing different “profiles” of peripheral disruption while preserving the same underlying model.

---

## 13. Neuro-Architecture Pipeline

The renderer organizes these effects into a modular pipeline inspired by the human visual system.

> **Note:** The terms "LGN", "V1", and "V4" are used here as software architectural labels to group related operations (Gating, Geometry, Aesthetics). They are not intended to represent a rigorous biological simulation of these brain areas.

### Stage 1: LGN (Gating & Masking)
The "Gatekeeper" stage determines *where* effects are applied.
-   **Inputs**: Structure Map, Saliency Map, Foveal Distance.
-   **Operation**: Calculates a `suppressionFactor`.
-   **Logic**:
    -   **Foveal Protection**: Masks out the fovea.
    -   **Structure Masking**: Masks out whitespace (if enabled).
    -   **Saliency Gating**: Masks out high-saliency areas (Fidelity Bias).

### Stage 2: V1 (Geometry & Distortion)
The "Feature Extractor" stage determines *how* the image is warped.
-   **Inputs**: `suppressionFactor` (from LGN), `ModeConfig`.
-   **Operation**: Calculates `distortedUV` and `displacement`.
-   **Modes**:
    -   **Noise**: Fluid, continuous distortion (e.g., Double Vision).
    -   **Mongrel Approximation** (formerly "Shatter"): Blocky, discontinuous displacement (e.g., Default).
        > **Note:** This is a statistical approximation of the "Mongrel" texture theory. We aspire to full texture synthesis, but it is currently too expensive for real-time performance.
    -   **None**: No distortion (e.g., Blueprint, Cyberpunk).

### Stage 3: V4 (Aesthetics & Style)
The "Interpreter" stage determines *what* the final pixel looks like. This stage demonstrates how the core foveated pipeline can be customized to achieve different research or artistic goals.

-   **Inputs**: `distortedUV`, `ModeConfig`.
*   **Operation**: Applies color grading and pixel effects.
*   **Customization Examples (Architectural Stress Tests)**:
    *These modes not only demonstrate visual possibilities but also serve as stress-tests for the pipeline's flexibility.*
    -   **High-Key (Default)**: Simulates standard peripheral degradation with desaturation and ghosting.
    -   **Lab (Scotopic)**: A "night vision" model (dark blue-grey) simulating rod-dominated vision in low light.
    -   **Frosted**: A low-contrast, milky aesthetic useful for simulating cataracts or foggy conditions.
    -   **Blueprint**: A "wireframe" mode that visualizes the underlying Gestalt structure (rhythm/mass) detected by the engine.
    -   **Cyberpunk**: An exaggerated "glitch" aesthetic using neon colors and blocky artifacts.
    -   **Double Vision**: A fluid, wave-based distortion that simulates temporary visual impairments or disorienting states.

### Saccadic Suppression
To prevent distracting "shimmering" during rapid eye movements, the renderer tracks mouse velocity. When velocity exceeds a threshold (>4000px/s), the V4 stage washes out the periphery, mimicking the brain's natural suppression of visual input during saccades.

### Architectural Guarantee: Foveal Integrity
The pipeline enforces a strict "Do No Harm" policy for the fovea.
-   **Hard Bypass**: Pixels within `dist < fovea_radius * 0.5` are strictly excluded from V1 distortion and V4 aesthetic processing.
-   **True Color Sampling**: A centralized `sampleSource(uv)` helper ensures that the fovea (and any "clear" view) always receives the raw, correctly color-swizzled (BGRA->RGBA) image from the capture buffer. This prevents accidental color shifts or darkening in the critical vision area.

---

## 14. Visual Memory (Persistence)

To simulate the brain's ability to "hold" visual information, Scrutinizer implements a **Visual Memory** system.

### Mechanics
-   **Dwell Activation**: When the user fixates (velocity < 20.0 px/ms) on a spot for >50ms, that region is "committed" to memory.
-   **Buffer System**: Remembered spots are stored in a FIFO buffer (`visualMemoryBuffer`).
-   **Capacity**: The buffer size is configurable (`visualMemoryLimit`). When full, the oldest memory fades out.
-   **Rendering**:
    -   The buffer is rendered to a **Visual Memory Mask** (`u_maskTexture`).
    -   This mask is used in the fragment shader to modulate distortion signals.
    -   **Blend Mode**: `Screen` blending is used to accumulate memories, ensuring that overlapping memories remain visible and don't darken each other.

### Modes

#### 1. Standard Persistence (Foveal Protection)
*   **Default Behavior**: Remembered areas are rendered *clearly*, creating a "clean" overlay on top of the distorted periphery.
*   **Biological Mechanism**: Mimics short-term memory (iconic memory) where the brain retains high-fidelity details of recently visited locations to stitch together a coherent scene.
*   **Implementation**: `u_useMask = 1.0`. The mask reduces distortion strength: `strength *= (1.0 - memoryStrength)`.

#### 2. Inhibition of Return (Saliency Suppression)
*   **Behavior**: Recently visited areas are rendered with *increased* distortion or lower saliency.
*   **Biological Mechanism**: Mimics the "Inhibition of Return" phenomenon, where the attention system discourages re-orienting to a recently visited location to facilitate efficient foraging/search.
*   **Implementation**: `u_useMask = 2.0`. The mask suppresses LGN signals (Saliency, Density) but *not* V1 distortion. This effectively "masks out" the visited area from the Saliency/Structure maps, causing it to lose any protection it might have had (e.g., text protection), forcing it to be processed by the raw peripheral distortion.

