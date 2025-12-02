# Scrutinizer Foveated Vision Model

This document explains how Scrutinizer simulates human foveal / peripheral vision, and how the underlying shader parameters map to the visual effect. It is intended for advanced users and developers who want to reason about (and eventually tune) the non‑foveal disruption profile.

---

## 1. Coordinate system and foveal radius

The WebGL renderer receives:

- `u_resolution`: canvas size in pixels.
- `u_mouse`: foveal center in pixels (canvas coordinates).
- `u_foveaRadius`: foveal radius in pixels.

In the fragment shader:

- Texture coordinates `uv` are corrected for aspect ratio and squashed in X to approximate an elliptical (4:3) foveal footprint.
- A normalized distance `dist` is computed from the foveal center in this corrected space.
- A normalized radius is defined as:
  
  - `radius_norm = u_foveaRadius / u_resolution.y`

This allows us to express all zones as **fractions of the configured foveal radius**, independent of actual pixel resolution.

Biologically, the fovea is approximately circular. For screen-based reading and text layouts, we deliberately apply an **elliptical aspect correction** (default 4:3) so that the “usable” sharp region better matches the horizontally biased saccades you make across lines of text.

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

## 2. Three spatial zones

All non‑foveal processing is defined in terms of three concentric zones, expressed as multiples of `radius_norm`.

- **Fovea**  
  - Range: `0 → 1.0 × radius_norm`  
  - Visual: crystal‑clear, full color, no positional warping or jitter.

- **Parafovea**  
  - Range: `1.0 × radius_norm → 2.5 × radius_norm` (biological macula: 0-5°)
  - Visual: increasing domain warp and high‑frequency jitter. Features are present but positions are uncertain ("heat‑haze crowding").

- **Far periphery**  
  - Starts at: `1.2 × radius_norm` and beyond  
  - Visual: stronger warp/jitter, rod‑like desaturation and tint, and pixel scatter.

Key constants in the shader:

- `fovea_radius = radius_norm`
- `parafovea_radius = radius_norm * 2.5`

The parafoveal region (2-5°) represents the **macular zone** where users can perceive holistic information without direct fixation.

The **debug boundary overlay** is drawn exactly at `dist == fovea_radius`, so the visible grey ring matches the true edge of the sharp foveal zone.

---

## 3. Strength masks (distance → effect curves)

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

## 4. Domain warping (positional uncertainty)

The shader models the growth of receptive field size with eccentricity using **domain warping**:

1. A coarse multi‑octave noise field (`warpVector`) is sampled in an aspect‑corrected space.
2. The amplitude of this warp is increased in the periphery but kept small and vertically “crushed” in the parafovea to preserve rough baselines and vertical strokes.
3. This warp is multiplied by `warpStrength` and the global intensity.

Intuition:

- In the parafovea, text looks like it is seen through shimmering heat haze.
- In the far periphery, letters collide and smear, but the image does not completely melt.

---

## 5. Universal Structure Map Pipeline (New in v2.0)

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
These blocks are painted onto an off-screen `<canvas>` (50% resolution) to create the `u_structureMap` texture. This texture encodes semantic data into RGBA channels:

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

## 6. High‑frequency jitter (Bouma breaker)

To disrupt word‑shape (“Bouma”) recognition, the shader adds very high‑frequency jitter:

1. Fine‑scale noise is sampled on top of the warped coordinates.
2. Jitter amplitude ramps from subtle at the inner parafovea to aggressive at the outer parafovea.
3. In far periphery, jitter amplitudes are highest.

The final lookup position is:

- `newUV = uv + warpVector + jitterVector`

This combination ensures:

- Just outside the fovea, characters wobble enough to be hard to parse but not fully pixelated.
- Further out, both local letter structure and global word envelopes are heavily disrupted.

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

### 1. Saliency Map Generation
**File**: `renderer/saliency-map.js`

**Algorithm**:
1. **Luminance Extraction**: RGB → grayscale (`0.299*R + 0.587*G + 0.114*B`)
2. **Sobel Edge Detection**: 3×3 convolution for gradient magnitude
3. **Gaussian Blur**: 3-pass box blur (radius=5px) for smooth gradients
4. **Normalization**: Map to 0-255 grayscale range

**Resolution**: 25% of screen (interpolated by GPU for performance)

### 2. Texture Pipeline
- **GL_TEXTURE3**: Separate saliency texture (grayscale)
- **Upload**: Computed from source browser capture each frame
- **Sampling**: `float saliency = texture2D(u_saliencyMap, uv).r;`

### 3. Fidelity Bias Formula
**File**: `renderer/webgl-renderer.js` (line ~454)

```glsl
// Sample saliency at current pixel
float saliency = texture2D(u_saliencyMap, uv).r;

// Modulate warp strength (reduce distortion near salient areas)
if (u_enable_saliency_modulation > 0.5) {
    warpStrength *= (1.0 - saliency); // High saliency = less distortion
}
```

**Effect**:
- `saliency = 0.0` (low) → `warpStrength` unchanged (full degradation)
- `saliency = 1.0` (high) → `warpStrength = 0` (no distortion, sharp)
- Smooth gradient between extremes

### 4. Validation Results

**Observed Behavior** (confirmed via A/B comparison):
- **Social media icons** (Twitter, etc.): Visibly clearer than surrounding text
- **Logos** (Bitrix24): Resist warping/jitter compared to background
- **UI elements**: Retain structural integrity for saccade guidance
- **Body text**: Full peripheral degradation applied normally

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

## Future Enhancements

From specification, not yet implemented:
1. **Jitter Suppression**: `jitterVector *= (1.0 - saliency)`
2. **Rod Vision Modulation**: `rodStrength *= (1.0 - saliency * 0.5)` (partial color preservation)
3. **Multi-scale Saliency**: Combine detection at multiple blur levels
4. **Temporal Coherence**: Smooth saliency across frames
5. **Inhibition of Return**: Reduce saliency in recently-viewed areas

## Technical Details

### Performance
- **Saliency computation**: ~2-5ms at 1920×1080 (25% resolution)
- **GPU texture**: +1 texture unit (3 of 32 used)
- **Memory overhead**: ~1MB at 1080p (RGBA8 texture)

### Edge Cases
- **Blank pages**: Uniform low saliency (full degradation)
- **High-contrast text**: Edges highlighted, readability preserved
- **Images**: Strong edges detected, structural forms maintained
- **UI elements**: Buttons, icons remain clear for interaction
---

## 7. Chromatic aberration (lens split)

Chromatic aberration is modeled by sampling the warped position three times:

- Red sample: shifted slightly **toward** the fovea.
- Green sample: at the base warped position.
- Blue sample: shifted slightly **away** from the fovea.

The shift magnitude is:

- `aberrationAmt = 0.02 * caStrength * u_intensity * u_ca_strength`

This creates colored fringes in the periphery, supporting illegibility without needing extremely large blurs.

---

## 7. Rod vision: desaturation, contrast, grain, tint

Beyond the fovea, the shader gradually:

- Reduces saturation using an **exponential falloff** (`1.0 - sqrt(dist)`), making the far periphery effectively monochrome.
- Increases contrast.
- Adds high‑frequency grain.
- Applies a **"Eigengrau" (Brain Grey)** tint (cold dark blue) in darker regions.

This is blended based on both `rodStrength` and the local luminance, yielding a peripheral appearance that is:

- Cold, colorless, and grainy.
- Shifted towards a dark blue-grey, mimicking the lack of color data in the rod-dominated periphery.

---

## 8. Scrollbar preservation

A thin band near the right edge of the screen is excluded from peripheral processing, so operating system scrollbars and similar UI affordances remain sharp and usable.

- Region: approximately 17 px from the right edge.

This acts as a **Fitts's-law safe zone** for precise pointer targeting. The mask is currently a **hard cutoff** (inside this band, peripheral effects are disabled entirely). A future refinement could turn this into a short gradient band so that, under very strong distortion, the visual handoff into the safe zone is also perceptually smooth.

---

## 9. Debug boundary overlay

When enabled from the menu, the shader draws a subtle grey ring at the true foveal edge:

- Location: `dist == fovea_radius`.
- Purpose: visualization only – it does not change sampling or strength masks.

---

## 10. Future tuning knobs

The current implementation hard‑codes the key ratios:

- `parafovea_radius / fovea_radius ≈ 1.35`
- `periphery_start / fovea_radius ≈ 1.2`

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

## 11. Neuro-Architecture Pipeline

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
    -   **Noise**: Fluid, continuous distortion (e.g., Trippy).
    -   **Shatter**: Blocky, discontinuous displacement (e.g., Default).
    -   **None**: No distortion (e.g., Blueprint, Cyberpunk).

### Stage 3: V4 (Aesthetics & Style)
The "Interpreter" stage determines *what* the final pixel looks like.
-   **Inputs**: `distortedUV`, `ModeConfig`.
-   **Operation**: Applies color grading and pixel effects.
-   **Styles**:
    -   **High-Key**: Desaturated, ghosting (Default).
    -   **Lab**: Scotopic, dark blue-grey.
    -   **Frosted**: Low contrast, milky.
    -   **Blueprint**: Wireframe, scanlines.
    -   **Cyberpunk**: Neon, pixelated blocks.
    -   **Trippy**: Psychedelic, rainbow cycling.

### Saccadic Suppression
To prevent distracting "shimmering" during rapid eye movements, the renderer tracks mouse velocity. When velocity exceeds a threshold (>4000px/s), the V4 stage washes out the periphery, mimicking the brain's natural suppression of visual input during saccades.

### Architectural Guarantee: Foveal Integrity
The pipeline enforces a strict "Do No Harm" policy for the fovea.
-   **Hard Bypass**: Pixels within `dist < 0.25` are strictly excluded from V1 distortion and V4 aesthetic processing.
-   **True Color Sampling**: A centralized `sampleSource(uv)` helper ensures that the fovea (and any "clear" view) always receives the raw, correctly color-swizzled (BGRA->RGBA) image from the capture buffer. This prevents accidental color shifts or darkening in the critical vision area.

---

## 12. Visual Memory (Persistence)

To simulate the brain's ability to "hold" visual information, Scrutinizer implements a **Visual Memory** system.

### Mechanics
-   **Dwell Activation**: When the user fixates (velocity < 0.5 px/ms) on a spot for >2000ms, that region is "committed" to memory.
-   **Buffer System**: Remembered spots are stored in a FIFO buffer (`visualMemoryBuffer`).
-   **Capacity**: The buffer size is configurable (`visualMemoryLimit`). When full, the oldest memory fades out.
-   **Rendering**:
    -   The buffer is rendered to a **Visual Memory Mask** (`u_maskTexture`).
    -   This mask is used in the fragment shader to mix between the processed peripheral view and the clear source image.
    -   **Blend Mode**: `Screen` blending is used to accumulate memories, ensuring that overlapping memories remain visible and don't darken each other.

