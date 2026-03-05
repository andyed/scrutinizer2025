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

This distribution is not a design flaw — it's an optimization. The fovea sacrifices sensitivity for resolution (1:1 wiring). The periphery sacrifices resolution for sensitivity (100:1 convergence). You can't have both.

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
| **Resolution loss** | Receptor pooling (100:1) | Approximate DoG band decomposition (MIP-derived, box/bilinear not Gaussian) with M-scaling rolloff; legacy: simple MIP pooling |
| **Chromatic pooling** | Reduced chromatic spatial resolution; mean chromaticity preserved over large regions (Rosenholtz TTM) | Per-channel RG/YV attenuation in DoG bands (castleCSF); legacy: uniform Oklab chrominance reduction + cyan tint |
| **Crowding** | Receptive field overlap | Fractal Crowding (Tier 2.0) + vertical chop. **Known gap:** distortion is eccentricity-only, not density-dependent — isolated and flanked targets degrade equally (see `docs/simulation-limitations.md`, `docs/specs/density_gated_crowding.md`) |
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

This ~462px diameter zone is where users can rapidly perceive holistic information and spatial cues without making a saccade. Parafoveal processing handles:
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

### 5.1 DoG Band Decomposition (v1.6+)

The simple MIP pooling approach uniformly blurs content, progressively destroying spatial structure. Real peripheral vision is more selective: low-frequency structure (layout, button shapes, large text) persists while high-frequency detail (letter serifs, fine textures) drops off first. This is because retinal ganglion cells have **center-surround receptive fields** that are well-modeled by Difference-of-Gaussians (DoG) filters, and their size grows with eccentricity (**M-scaling**).

**Key insight**: The hardware MIP chain (generated every frame by `gl.generateMipmap()`) provides an approximate multi-scale decomposition using box/bilinear filtering (not true Gaussian convolution as in Burt & Adelson 1983). Subtracting adjacent MIP levels gives **approximate Laplacian pyramid bands** that function analogously to DoG, with some spectral leakage between bands:

```glsl
// DoG bands from existing MIP chain — no new textures needed
vec4 band0 = textureLod(tex, uv, 0.0) - textureLod(tex, uv, 1.0);  // 1-2px: serifs, thin strokes
vec4 band1 = textureLod(tex, uv, 1.0) - textureLod(tex, uv, 2.0);  // 2-4px: letter bodies, icons
vec4 band2 = textureLod(tex, uv, 2.0) - textureLod(tex, uv, 3.0);  // 4-8px: words, UI elements
vec4 band3 = textureLod(tex, uv, 3.0) - textureLod(tex, uv, 4.0);  // 8-16px: buttons, layout
// residual = textureLod(tex, uv, 4.0)                               // DC: overall luminance
```

Each band is attenuated by a **smoothstep rolloff** based on normalized eccentricity, with cutoff distances derived from **linear M-scaling** (Rovamo & Virsu 1979, Levi, Klein & Aitsebaomo 1985):

The minimum resolvable spatial detail grows linearly with eccentricity: **s_min(e) = s₀ × (1 + e/E₂)**. Band k (spatial scale 2^k px) drops out when s_min(e) > 2^k, giving cutoff eccentricity = E₂ × (2^k − 1):

| Band | Spatial Scale | Cutoff (× E₂) | Content Preserved |
|------|--------------|----------------|-------------------|
| band0 | 1-2px | 1 | Serifs, hairlines |
| band1 | 2-4px | 3 | Letter bodies, small icons |
| band2 | 4-8px | 7 | Words, UI elements |
| band3 | 8-16px | 15 | Buttons, layout blocks |
| residual | 16px+ | Always | Overall color/luminance |

The non-uniform spacing is biologically correct: coarse structure (bands 2–3) persists far into the periphery while fine detail (band 0) drops quickly. You can see *where* a button is without being able to read its label — matching the subjective experience of peripheral vision.

**Parameters** (configurable per mode in `modes.json`):
- `dog_e2` — M-scaling half-rate eccentricity. The eccentricity (in normalized screen coordinates) at which the resolution threshold doubles. Operates in **normalized screen coordinates** (eccentricity / fovea_radius), not degrees of visual angle. Calibrated to the effective `normEcc` range (~0–0.8) produced by the V4 coupled eccentricity pipeline. Lower = more aggressive filtering. Default: 0.15 (High-Key), 0.12 (Biological).
- `dog_sharpness` — Band transition sharpness. 0.0 = gradual rolloff (wider transitions), 1.0 = sharp cutoff (narrow transitions).
- `dog_enabled` — Boolean gate. When false, falls back to legacy simple MIP pooling.

**Caveats and design choices**:
- The DoG input (`coupledEccentricity`) is modulated by V1 distortion strength and intensity, making it **attention-gated** rather than purely position-dependent. This diverges from biology (where RF size is fixed by retinal position) but produces a more usable result for the simulation's interactive context.
- Band differences (mip_k − mip_{k+1}) can be negative. The shader clamps the final reconstruction to [0,1] to prevent out-of-range artifacts.

**Result**: Parafoveal text shows a "frosted glass" quality—letter shapes and word boundaries remain visible but unreadable—rather than the uniform fog of simple MIP pooling. This better matches the subjective experience of peripheral vision.

### 5.2 Known Limitation: Density-Independent Crowding

The V1 Lateral Smash (domain warping) and MIP pooling are both purely eccentricity-dependent. An isolated letter and a densely flanked letter at the same eccentricity receive identical displacement and pooling. In biological vision, the isolated letter remains identifiable while the flanked letter does not (Bouma 1970; Pelli & Tillman 2008).

The structure map carries a density channel (`structure.g`) through the LGN signal, but it's currently used only for the whitespace gate (`density < 0.1 → suppressionFactor = 0`), not for scaling V1 distortion strength. A planned fix gates V1 strength with a sigmoid transfer on density — dense content gets full Lateral Smash, isolated elements get reduced distortion (floor at 0.3 for residual acuity loss).

- **Diagnostic pages:** `reference-pages/crowding.html` (crowded-vs-isolated letters), `reference-pages/crowding-stimulus.html` (orientation, color grouping, complexity)
- **Spec:** [`docs/specs/density_gated_crowding.md`](specs/density_gated_crowding.md)
- **Full gap analysis:** [`docs/simulation-limitations.md`](simulation-limitations.md)

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
| **Blue** | **Semantics** | **Legacy (Stable)**: Type ID: Text (1.0), Image (0.5), UI (0.0). <br> **Experimental (v1.4.2)**: Packed Type + Phase. *See warning below.* |
| **Alpha** | **Interaction** | 1.0 = Content. Interaction is encoded in Blue (Text=1.0 vs UI=0.0). |

> ⚠️ **Implementation Warning: Blue Channel Packing**
> In v1.4.2, we attempted to pack both **Type** and **Phase** (text y-alignment) into the Blue channel using 8-bit quantization (0-10 for Type, 11-255 for Phase).
> **Result**: This caused significant artifacts where Images (Type 0.5) were misread as Text Phase, leading to "shredded" visual noise.
> **Lesson**: Do not overload 8-bit channels with discontinuous data types. Use a separate texture for Phase or ensure Type codes are completely distinct from Phase ranges with a large safety margin.

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

## 7. Nuclear Scramble & Static Disintegration (Tier 3.0)

### The Problem: Saliency Gating & "Ghosting"
In v1.4, we introduced saliency gating to allocate more bandwidth to high-contrast elements. This inadvertently allocated too much bandwidth to large text headers, keeping them *more* readable in the far periphery than intended. Additionally, the "Magnocellular Contrast Preservation" (which keeps edge contrast high for motion detection) was making these letters look crisp and legible, rather than "ghostly."

### The Solution: Tier 3 "Nuclear Scramble"
Tier 3 introduces a more aggressive, topology-breaking model that specifically targets letter recognition while maintaining biological plausibility.

#### Core Mechanic: The "Bender" vs. The "Shredder"
The peripheral field is divided into two distinct zones with linear progression:

1.  **Parafovea ("The Bender")**: 
    *   **Effect**: Fractal Domain Warping.
    *   **Mechanism**: Low-frequency Simplex noise bends the coordinate space.
    *   **Tuning**: 
        *   **Amplitude**: Reduced base amplitude (0.003 -> 0.0024) for a cleaner near-periphery.
        *   **Bias**: Reduced horizontal bias (2x) prevents "smearing" and keeps the distortion structural.

2.  **Far Periphery ("The Shredder")**:
    *   **Effect**: Discrete Grid Scrambling.
    *   **Mechanism**: The screen is divided into a fine grid (~400x300 cells). Each cell receives a random, static offset vector derived from "Gold Noise."
    *   **Tuning**:
        *   **Progressive Scaling**: Scramble amplitude scales linearly with distance (1.0x at start, >2.0x at far edge) to prevent plateauing.
        *   **Base Intensity**: 0.8% horizontal (reduced from 1.0%) for a balanced global profile.

### Regression Fixes & Refinements (v1.4.2)
Based on user feedback, the following critical tunings were applied to stabilize the effect:

1.  **Static Mode (Animation Killed)**
    *   *Problem*: Previous versions used animated noise (`u_time`), creating a "boiling" or "broken TV" effect that attracted attention.
    *   *Fix*: All time dependencies were removed from the distortion noise. The periphery is now spatially distorted but **temporally stable**. This allows the user to saccade to a "ghost" they saw, only to find it wasn't what they thought—a key property of peripheral vision.

2.  **Chromatic Aberration (CA) Suppression**
    *   *Problem*: High-contrast text edges, when scrambled, created thousands of artificial sharp edges. The CA shader applied color fringing to *every single cut*, turning the text into messy "glitch art."
    *   *Fix*: CA is now **linearly suppressed** as the Scramble effect fades in. By the time the text is fully shredded, CA is zero. The result is monochromatic "texture" rather than colored noise.

3.  **Linear Distortion Progression**
    *   *Problem*: "Inverse Valley" effect where the Parafovea (Wrap) felt stronger than the Periphery (Scramble).
    *   *Fix*: Amplitudes were rebalanced for a smooth ramp:
        *   **Parafovea**: Tuned down (cleaner start).
        *   **Periphery**: Tuned up (progressive growth).

4.  **Ghosting (Contrast Killing)**
    *   *Problem*: Magnocellular distinction kept text "black."
    *   *Fix*: Contrast preservation is disabled in the far periphery, forcing the text to blend with the background luminance ("ghosting"), simulating signal loss.

### Validation Status
| Metric | Status | Observation |
|:-------|:-------|:------------|
| **Legibility** | ✅ Destroyed | "Wikipedia" header is unreadable in periphery. |
| **Stability** | ✅ Static | No shimmering or boiling. |
| **Artifacts** | ✅ Clean | No "fuzz" or "white noise" grain (frequencies reduced 800->150). |
| **CA Fringing** | ✅ Suppressed | Shredded text is monochromatic/textural. |

---

# Saliency Map & Bandwidth Allocation

## Overview

The **Saliency Map** implements computational visual attention, predicting where the eye is drawn based on contrast, edges, and visual "attractiveness." This enables **saliency gating** — the LGN allocates more processing bandwidth to salient peripheral content, the same compute demand management strategy the biological visual system uses (retina captures ~10⁷ bits/sec, optic nerve transmits ~10⁶).

## Cognitive vs Retinal Constraint

### Retinal Constraint (Saliency Modulation OFF)
- Filtering is **purely distance-based** (radial from fovea)
- All content at same eccentricity receives equal filtering
- Geometric, homogeneous "heat-haze" effect
- **No cognitive priority** — logos treated same as body text

### Cognitive Constraint (Saliency Modulation ON)
- Filtering is **content-aware** and non-uniform
- High-saliency areas (logos, icons, edges) receive **more bandwidth** in periphery
- M-channel cues allocated for saccadic targeting
- **Brain-like prioritization** — important elements receive more resources

## Implementation

## Implementation

### 1. Gestalt Grouping (Proximity)
**File**: `renderer/scrutinizer.js`

To simulate the brain's pre-attentive grouping of visual elements, the renderer processes the raw layout stream before generating maps.
-   **Text Merging**: Vertically adjacent text blocks are merged into single "paragraph" clusters.
-   **Quantization**: Block coordinates are snapped to a grid (1px for text, 10px for UI) to prevent sub-pixel jitter from causing "flicker" in the periphery during micro-layout shifts.

### 2. Saliency Map Generation (Phase 5: Gated Saliency)
**File**: `renderer/saliency-worker.js`

The Saliency Map system has been upgraded to a **Cognitive Alignment** model. It combines biophysical contrast detection with top-down semantic gating.

**The Formula**:
`FinalSaliency = (RawContrast * Inhibitor) + (Excitor * Boost)`

1.  **Raw Contrast (Bottom-Up)**:
    *   Uses **Difference-of-Gaussians** on Oklab channels (Intensity, Red-Green, Blue-Yellow).
    *   Detects edges, color contrast, and luminance shifts.

2.  **Inhibitor Mask (Silence Noise)**:
    *   Generated from the **Structure Map**.
    *   **Logic**: If an area contains NO semantic structure (text or image), the Inhibitor is `0.1`.
    *   **Effect**: Suppresses paper textures, compression artifacts, and distinct-but-irrelevant gradients.

    *   **Logic**: Adds `+0.8` to the saliency signal.
    *   **Effect**: Ensures low-contrast controls (e.g., light gray "Cancel" buttons) remain visible in the periphery, simulating the brain's knowledge of where tools are.

4.  **Face Channel (Social Bias)** (New in v1.4.2):
    *   **Detection**: Uses `face-api.js` (Tiny Face Detector) in a background worker.
    *   **Logic**: Adds `+0.5` weighting to detected face regions.
    *   **Effect**: Simulates the fusiform face area's (FFA) impact on attention—humans are hard-wired to look at faces, even in the periphery.

**Key Properties**:
- **Noise Suppression**: Blank pages now generate a blank saliency map (unlike v1.4 where noise created false positives).
- **Scroll Synchronization**: Structure data is passed to the worker every frame effectively locking the heatmap to the content.
- **Biologically Accurate**: Simulates "Predictive Coding" (the brain uses knowledge to filter retinal input).

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

### 4. Saliency Gating Formula
**File**: `renderer/shaders/peripheral2.frag` (in `processLGN` function)

```glsl
// Sample saliency at current pixel
float saliency = texture(u_saliencyMap, uv).r;

// Allocate bandwidth: high saliency → more signal passes through
if (u_enable_saliency_modulation > 0.5) {
    signal.suppressionFactor *= mix(1.0, 0.3, saliency);
}
```

**Effect**:
-   `saliency = 0.0` (low) → full peripheral filtering (minimum bandwidth)
-   `saliency = 1.0` (high) → suppression drops to 0.3 (70% bandwidth allocated)
-   Smooth gradient between extremes

### 5. Validation Results

**Observed Behavior** :
-   **Social media icons** (Twitter, etc.): Visibly clearer than surrounding text (pop-out effect)
-   **Logos** (Bitrix24): Receive more bandwidth, resist warping/jitter
-   **UI elements**: Retain structural integrity for saccade guidance
-   **Body text**: Full peripheral filtering applied (minimum bandwidth)

**Interpretation**: Successfully demonstrates shift from optical model to cognitive model, reflecting the brain's resource allocation strategy for salient targets.

## Usage

### Menu Controls
- **Simulation > Content Signals > Show Saliency Map**: Visualize saliency heatmap (Blue→Cyan→Green→Yellow→Red)
- **Simulation > Content Signals > Use Saliency Modulation**: Toggle saliency-based bandwidth allocation

### Config
```javascript
{
    enableSaliencyModulation: true  // Enable/disable saliency gating
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
**V4 (Aesthetics) Modulation**:
> **Update (v1.4.3)**: Saliency modulation was removed from the color/chrominance stage. Rod-vision constraints apply regardless of saliency — rods are colorblind. A bright red logo in the periphery has its chrominance attenuated to match rod sensitivity, preventing it from artificially "popping" and competing with the fovea.
> **Update (v1.9)**: Per-channel chromatic pooling (castleCSF) replaces uniform chrominance reduction when enabled. RG and YV opponent channels attenuate at different rates with eccentricity, and attenuation is spatial-frequency-dependent (small features lose chromatic identity faster than large regions). Suprathreshold compression (exponent 0.5) corrects for the historical over-estimation of peripheral color loss from threshold-based studies.

**Effect**: Salient areas (logos, icons, UI elements) in the far periphery retain slightly more geometric stability and color, making them more recognizable for saccade guidance without compromising illegibility.

**Key Design Constraints**:
-   **Parafoveal Isolation**: Foveal and parafoveal motion cannot affect far periphery distortion
-   **Conservative Modulation**: 15-25% max effect, keeping peripheral filtering active
-   **Temporal Smoothing**: Double-buffered saliency (15% blend/frame) prevents flicker on live video

### 7. Saliency Stabilization (Movie Mode)
To mitigate "breathing" artifacts on full-motion video, the Saliency Map is used to **stabilize** the "Slow Wave" distortion.
-   **Logic**: `waveOffset *= (1.0 - saliency * 0.9)`
-   **Effect**: High-saliency areas (faces, text) in the periphery remain relatively static, while the background continues to wave organically. This creates "islands of stability" that reduce distraction without breaking the overall effect.

## Future Enhancements

1. **Multi-scale Saliency**: Combine detection at multiple blur levels
2. **Inhibition of Return**: Reduce saliency in recently-viewed areas
3. **Parafoveal Band Modulation**: ✅ (v1.8.0) eccentricityScale ramps 0.0→0.15 through parafovea via smoothstep; MIP blend widened to 0.5× fovea_radius. ✅ (v1.9.0) Per-channel chromatic pooling implemented. Future: oriented DoG bands for further parafoveal refinement
4. **Far Periphery Distortion Boost**: ✅ (Implemented in Browser & Figma v1.4.x) A linear increase in distortion strength (2.5x slope) beyond the transition zone creates more distinct peripheral filtering at the far edges of the screen, preventing the effect from plateauing.

## Technical Details

### Performance
- **Saliency Computation**: Separable Gaussian Blur (O(2n) complexity).
- **Latency**: <5ms @ 256x256 resolution (running in Web Worker).
- **Memory**: Double-buffered architecture prevents read/write hazards.

### Edge Cases
- **Blank pages**: Uniform low saliency (full peripheral filtering, minimum bandwidth)
- **High-contrast text**: Edges highlighted, bandwidth allocated for saccade targets
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

## 9. Peripheral Color: Chromatic Pooling & Oklab Pipeline

**v1.3:** Peripheral color processing upgraded from RGB to **Oklab** (perceptually uniform).
**v1.9:** Per-channel RG/YV chromatic pooling replaces uniform chrominance reduction (see [`docs/specs/implemented/chromatic_pooling.md`](specs/implemented/chromatic_pooling.md)).

### The Biological Reality

Peripheral color is **pooled, not lost** (Rosenholtz TTM). The visual system averages chromaticity over increasingly large regions with eccentricity, preserving mean color while losing spatial chromatic detail. The RG (red-green) opponent channel — a foveal specialization — loses spatial resolution faster than YV (blue-yellow), which persists into the far periphery. This is a wiring constraint (sparse L-M midget cells beyond the fovea), not an optical one.

Historical claims of peripheral "color blindness" overstated the effect by conflating detection thresholds with suprathreshold appearance. Cone-opponent mechanisms persist to at least 50° eccentricity when stimuli are sufficiently large (Hansen, Pracejus & Gegenfurtner 2009 — threshold data only; Bowers, Gegenfurtner & Goettker 2025). At typical display contrasts, suprathreshold color appearance shows partial constancy — perceived saturation declines less steeply than detection thresholds predict (Jiang, Shooner & Mullen 2022, power-law exponent ~0.5).

### Why Oklab?

RGB color space is not perceptually uniform — equal numeric changes in RGB values do not correspond to equal perceived color differences. Reducing chrominance in RGB space produces "muddy" artifacts, especially for saturated reds and blues.

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

The blur worker uses Oklab for chrominance reduction in the multi-resolution pyramid:

```javascript
// Convert RGB → Oklab
const lab = rgbToOklab(r, g, b);

// Reduce chrominance (legacy uniform path)
lab.a *= (1 - desaturationAmount);
lab.b *= (1 - desaturationAmount);

// Preserve lightness (L) for perceptual uniformity
// Convert back Oklab → RGB
const rgb = oklabToRgb(lab.L, lab.a, lab.b);
```

**Rod-sensitive chrominance path (v1.4.3 "Usability Mode")**:
To prevent "mustard" artifacts (where removing red leaves yellow) and simulate rod blindness to long wavelengths:

```javascript
// Progressive Red Crush
// If we are in the periphery and the pixel is Red, we crush BOTH 'a' and 'b'.
if (dist > parafovea && lab.a > 0) {
    // Progressive fade calculation
    const factor = smoothstep(parafovea, far_periphery, dist) * 0.95; 
    
    lab.a = mix(lab.a, 0.0, factor); // Kill Red
    lab.b = mix(lab.b, 0.0, factor); // Kill Yellow (prevent mustard artifact)
}
// Lightness (L) is preserved, ensuring the button remains visible as a grey form.
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

**Per-channel chromatic pooling (v1.9+, `u_chromatic_pooling = 1`):**
```glsl
// In DoG band reconstruction — per-band, per-channel attenuation
// RG: frequency-independent steep decay (castleCSF k_e = 0.059)
float rg_atten = pow(pow(10.0, -u_rg_decay * ecc_deg), supra);

// YV: per-band frequency-dependent decay — large color fields persist
float yv_atten_band0 = pow(pow(10.0, -(u_yv_decay + u_yv_freq_decay * 4.0) * ecc_deg), supra);
// ... band1 (×2.0), band2 (×1.0), band3 (×0.5), residual (×0.25)

// Each band: split into Oklab luminance + chrominance, attenuate independently
result += chromaticAttenuate(band_k, rg_atten, yv_atten_band_k) * w_k;

vec4 chromaticAttenuate(vec4 color, float rg_atten, float yv_atten) {
    vec3 lab = rgbToOklab(color.rgb);
    lab.y *= rg_atten;   // a channel (red-green)
    lab.z *= yv_atten;   // b channel (blue-yellow)
    return vec4(oklabToRgb(lab), color.a);
}
```

**Legacy uniform path (`u_chromatic_pooling = 0`):**
```glsl
// Convert to Oklab
vec3 lab = rgbToOklab(col);

// Uniform chrominance reduction — both channels attenuated equally
lab.y *= (1.0 - desaturationFactor); // a component
lab.z *= (1.0 - desaturationFactor); // b component

// Convert back to RGB
vec3 desaturatedColor = oklabToRgb(lab);
```

When chromatic pooling is active, the V4 uniform desaturation path and the Red Kill Switch are bypassed — per-band attenuation already handles differential RG/YV decay.

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
- Fractal parameters:
  - Fractal Octaves (Detail density).
  - Shear vs. Chop Blend (Discontinuity hardness).

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
    -   **Saliency Gating**: Allocates bandwidth to high-saliency areas.

#### Combined Bandwidth Signal
For effects like Chromatic Aberration, the shader uses a **dual-source bandwidth signal** that combines both saliency and structure information:

```glsl
float bandwidth = max(lgn.saliency, lgn.density);
```

This takes the maximum of:
- **`lgn.saliency`** — High-contrast, colorful regions (computed from pixels via Itti-Koch color opponency)
- **`lgn.density`** — Structural regions from DOM/node tree (TEXT blocks, images, UI controls)

**Rationale**: Using `max()` ensures bandwidth is allocated if *either* signal detects important content:
- **Text in live DOM** → High structure density, even if low contrast (light gray text)
- **Text in bitmaps/screenshots** → High saliency from contrast, even without structure data
- **Colorful logos/icons** → High saliency from color opponency

This dual-source approach provides robust bandwidth allocation across both live DOM content (browser) and flattened bitmap exports (Figma plugin).

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
    -   **High-Key (Default)**: Standard peripheral bandwidth filtering with chromatic pooling and ghosting.
    -   **Biological (Purkinje Darkening)**: A rigorously accurate simulation of rod vision, where red objects fade to black shadows (Protanopia) and luminance drops significantly.
    -   **Frosted**: A low-contrast, milky aesthetic useful for simulating cataracts or foggy conditions.
    -   **Blueprint**: A "wireframe" mode that visualizes the underlying Gestalt structure (rhythm/mass) detected by the engine.
    -   **Cyberpunk**: An exaggerated "glitch" aesthetic using neon colors and blocky artifacts.
    -   **Double Vision**: A fluid, wave-based distortion that simulates temporary visual impairments or disorienting states.

### Saccadic Suppression (The "Pupil Dilation" Model)
To naturally simulate biological response to eye movement, the renderer maps **Mouse Velocity** to a simulated **"Pupil Aperture"** (Blur Radius).

This model mimics the **"Hunt vs. Gather"** cycle of the eye:

1.  **The Hunt (High Velocity)**:
    *   **Action**: Mouse moves fast (>5px/frame).
    *   **Response**: Pupil Dilates (Max Aperture).
    *   **Effect**: Depth of field drops. The periphery blurs out (Tunnel Vision).
    *   **Biological Analog**: Saccadic Suppression (brain cuts off processing during motion).

2.  **The Gather (Zero Velocity)**:
    *   **Action**: Mouse stops (Fixation).
    *   **Response**: Pupil Constricts (Min Aperture).
    *   **Effect**: Depth of field increases. The periphery sharpens.
    *   **Biological Analog**: Accommodation (eye locks onto target, analyzing detail).

**Implementation Details**:
*   The visualizer calculates velocity and smooths the "Current Blur" state (Reactivity: 0.1).
*   The shader scales the **peripheral pooling strength** (DoG band reconstruction or legacy MIP pooling) based on this blur radius.
*   **Result**: The screen "breathes"—blurring during movement and sharpening during rest—rewarding the user for paying attention.

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
*   **Implementation**: `u_useMask = 2.0`. The mask suppresses LGN signals (Saliency, Density) but *not* V1 distortion. This effectively zeroes out the visited area's bandwidth allocation, reverting it to minimum-bandwidth peripheral filtering.

