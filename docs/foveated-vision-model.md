# Scrutinizer Foveated Vision Model

This document explains how Scrutinizer simulates human foveal / peripheral vision, and how the underlying shader parameters map to the visual effect. It is intended for advanced users and developers who want to reason about (and eventually tune) the non‑foveal disruption profile.

---

## 1. The Biology: From Photoreceptors to Perception

Foveal and peripheral vision differ because of the architecture of the visual system, from the retina to the cortex. This section covers that biology before the shader parameters.

### 1.1 The Retina: Two Receptor Systems

The human retina contains two photoreceptor types, each optimized for different tasks:

#### Cones
- **~6 million** total, concentrated in the **fovea** (central 2° of vision)
- **Three types** (L, M, S) enable color vision
- **High temporal resolution** for fine detail and motion
- **1:1 wiring** in the fovea: each cone connects to its own ganglion cell
- **Peak density**: ~200,000 cones/mm² at the foveal center

#### Rods
- **~120 million** total, distributed across the **periphery**
- **Single type** (no color discrimination)
- **Peak sensitivity at ~505nm** (cyan/blue-green); very low sensitivity to long-wavelength (red) light
- **Little role at display luminances**: screen viewing is photopic, so peripheral color loss on screen is a cone-pathway effect (Section 9)
- **Convergent wiring**: ~100 rods share a single ganglion cell
- **Peak density**: ~160,000 rods/mm² at ~20° eccentricity

The distribution reflects a trade-off between resolution and sensitivity. The fovea sacrifices sensitivity for resolution (1:1 wiring). The periphery sacrifices resolution for sensitivity (100:1 convergence).

### 1.2 The Wiring: Why Periphery is "Blurry"

The resolution each region can deliver depends on **how receptors connect to the brain** as well as on receptor density.

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

This retinal pooling limits peripheral acuity. The texture-like appearance of peripheral text comes mainly from crowding, which is cortical (Section 1.3; Pelli 2008).

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
│  • Retina supplies ~5-10% of inputs; V1 FEEDBACK supplies ~30%      │
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
│        ↓                                                            │
│  Higher Areas (IT, FFA, PPA...) — Object/Face/Scene recognition     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.4 Cortical Magnification

Cortical magnification is highest at the fovea and falls with eccentricity: the central 10° of the visual field occupies roughly half of V1's surface area (Horton & Hoyt 1991, *Archives of Ophthalmology*, doi:10.1001/archopht.1991.01080060080030). This "cortical magnification" means:

- Foveal signals get more neurons, more processing, more bandwidth
- Peripheral signals are compressed into fewer neurons

> **Scrutinizer's Pipeline Names**: Our LGN → V1 → V4 shader stages are named after these biological areas. The names are software labels for each stage's role: the LGN stage computes gating, the V1 stage geometric distortion, and the V4 stage color and style (see Section 13). The stages do not simulate those brain areas.

### 1.5 What This Means for Peripheral Vision

The biological architecture produces several emergent properties that Scrutinizer simulates:

| Biological Phenomenon | Cause | Scrutinizer Implementation |
|----------------------|-------|---------------------------|
| **Resolution loss** | Receptor pooling (100:1) | Approximate DoG band decomposition (MIP-derived, box/bilinear not Gaussian) with M-scaling rolloff; legacy: simple MIP pooling |
| **Chromatic pooling** | Reduced chromatic spatial resolution; mean chromaticity preserved over large regions (Rosenholtz TTM) | Per-channel RG/YV attenuation in DoG bands (castleCSF). Spec: `docs/specs/implemented/chromatic_pooling.md`. Validated: Wave 1 (Hansen 2009, Mullen 2002). |
| **Crowding** | Receptive field overlap | Density-gated V1 distortion (sigmoid on structure density). Spec: `docs/specs/implemented/density_gated_crowding.md`. Validated: Wave 3 (Bouma 1970). Wave 5 (Halverson & Hornof 2011): density discrimination not met, gate too coarse (`docs/specs/implemented/halverson_hornof_validation.md`). Future: mongrel texture synthesis (`docs/specs/implemented/mongrel_textures.md`). |
| **Motion sensitivity** | Magnocellular pathway | Preserved contrast in periphery |
| **Positional uncertainty** | Large receptive fields | Simplex noise displacement |

---

## 2. Coordinate System and Foveal Radius

This section maps the biological constraints above to shader parameters.

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

### Biological Calibration

At the default calibration (45 px ≈ 1° on a MacBook Pro Retina at ~50 cm; see [`foveal-calibration-logic.md`](foveal-calibration-logic.md) §7):

- **Foveal radius (1°)**: 45px (2° diameter)
- **Parafovea boundary (5° eccentricity)**: ~225px radius. Reading research conventionally places the parafovea out to 5° from fixation (Rayner 1998).
- **Shader parafovea boundary**: `parafovea_radius` is fixed at 2.5 × the foveal radius, which is ~113px (2.5°) at the default calibration. The shader's parafovea band (1°–2.5°) is narrower than the 5° reading-research parafovea.

The parafovea is where users can perceive holistic information and spatial cues without making a saccade. Parafoveal processing handles:
- Word length perception (saccade planning)
- Link detection (contrast + geometric cues)
- Layout structure (spatial relationships)

**Foveal Radius Presets** (Simulation > Foveal > Foveal Radius):

| Preset | Foveal Radius | Shader Parafovea Boundary (2.5x) |
|--------|---------------|----------------------------------|
| Extra Small | 20px | 50px |
| **Medium (default)** | **45px** | **113px** |
| Relaxed | 70px | 175px |
| Wide | 90px | 225px |
| Large | 110px | 275px |
| Extra Large | 130px | 325px |
| Huge | 180px | 450px |
| Extreme | 300px | 750px |
| Full Screen | 450px | 1125px |

**Recommended Setting**: **Medium (45px)**, the default, gives a 1° foveal radius at the reference calibration. Larger presets widen the clear zone for demos and design review.

---

## 3. Three Spatial Zones

All non‑foveal processing is defined in terms of three concentric zones, expressed as multiples of `radius_norm`.

- **Fovea**  
  - Range: `0 → 1.0 × radius_norm`  
  - Visual: crystal‑clear, full color, no positional warping or jitter.

- **Parafovea**  
  - Range: `1.0 × radius_norm → 2.5 × radius_norm` (1°–2.5° at the default calibration)
  - Visual: increasing domain warp and high‑frequency jitter. Features are present but positions are uncertain ("heat‑haze crowding").

- **Far periphery**  
  - Starts at: `2.5 × radius_norm` and beyond  
  - Visual: stronger warp/jitter, rod‑like desaturation and tint, and pixel scatter.

Key constants in the shader:

- `fovea_radius = radius_norm`
- `parafovea_radius = radius_norm * 2.5`

At the default calibration the shader's parafovea band spans 1°–2.5° eccentricity, the inner part of the 5° reading-research parafovea.

The **debug boundary overlay** is drawn exactly at `dist == fovea_radius`, so the visible grey ring matches the true edge of the sharp foveal zone.

---

## 4. Strength Masks (Distance → Effect Curves)

The V4 stage derives its effect strengths from one master curve over eccentricity beyond the foveal edge, `eccentricity = max(0, dist − fovea_radius)`:

- **Master blend** `t = smoothstep(0, 4 × fovea_radius, eccentricity)`
  - Interpretation: the fovea-to-pooled spatial blend (`blendFactor = t × u_intensity`). 0 at the foveal edge, 1 at four foveal radii beyond it.

- **Color effects** `t²`
  - Interpretation: onset of chromatic aberration (Section 8), deferred relative to the spatial blend.

- **Rod desaturation** `t³`
  - Interpretation: base chroma reduction and tint, deferred further toward the far periphery.

V1 distortion strength follows a separate curve. In `processV1()`, `corticalStrength = clamp(ecc_deg / ecc_max, 0, 1)` (with `ecc_max` derived from the viewport extent through the CMF), and strength = LGN suppression factor × `v1_strength_mult` × `0.4 × corticalStrength² × ecc_max`, scaled further by the density gate (Section 5.2) and Visual Memory.

Boolean helpers:

- `isParafovea = dist_stable > fovea_radius && dist_stable <= parafovea_radius`
- `isFarPeriphery = dist_stable > parafovea_radius`

These flags are used to select different amplitudes for warp and jitter.

For intuition: at mid-transition (`t = 0.5`), color effects are at 0.25 and rod desaturation at 0.125, so color and rod effects arrive later than the spatial blend.

---

## 5. Domain Warping & Mipmap Pooling (Crowding)

The shader models the growth of receptive field size with eccentricity using **domain warping** and **pooling**:

1. A coarse multi‑octave noise field (`warpVector`) is sampled in an aspect‑corrected space.
2. The amplitude of this warp is increased in the periphery but kept small and vertically “crushed” in the parafovea to preserve rough baselines and vertical strokes.
3. This warp is multiplied by the V1 distortion strength (Section 4) and the global intensity, with a 2:1 horizontal bias.

**Mipmap Bias Pooling (fallback path)**:
When `dog_enabled` is false, the shader increases the texture LOD (Level of Detail) bias with eccentricity, so the GPU samples a lower-resolution local average of the texture. Modes with `dog_enabled: true`, which include the default mode and most research modes, use DoG band decomposition instead (Section 5.1). A MIP level is a local mean. It is not a summary-statistic (TTM) representation. Combined with domain warping, it approximates crowding: features from adjacent letters merge, preserving word shape while destroying legibility.

Intuition:

- In the parafovea, text looks like it is seen through shimmering heat haze.
- In the far periphery, letters collide and smear (mongrelize), but the image does not completely melt.

### 5.1 DoG Band Decomposition (v1.6+)

The simple MIP pooling approach uniformly blurs content, progressively destroying spatial structure. Peripheral vision is more selective: low-frequency structure (layout, button shapes, large text) persists while high-frequency detail (letter serifs, fine textures) drops off first. This is because retinal ganglion cells have **center-surround receptive fields** that are well-modeled by Difference-of-Gaussians (DoG) filters, and their size grows with eccentricity (**M-scaling**).

The hardware MIP chain (generated every frame by `gl.generateMipmap()`) provides an approximate multi-scale decomposition using box/bilinear filtering (not true Gaussian convolution as in Burt & Adelson 1983). Subtracting adjacent MIP levels gives **approximate Laplacian pyramid bands** that function analogously to DoG, with some spectral leakage between bands:

```glsl
// 13 MIP levels at half-octave spacing (LOD 0.0 to 6.0 in 0.5 steps)
// Half-integer LODs use hardware trilinear interpolation natively
vec4 mip[13];
mip[0] = textureLod(tex, uv, 0.0);
mip[1] = textureLod(tex, uv, 0.5);
// ... mip[2] through mip[11] at LOD 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5
mip[12] = textureLod(tex, uv, 6.0);

// 12 half-octave DoG bands — geometric √2 spacing
vec4 band[12];
band[0] = mip[0] - mip[1];  // ~5.66 cpd: finest detail, serifs
band[1] = mip[1] - mip[2];  // ~4.0 cpd:  thin strokes
band[2] = mip[2] - mip[3];  // ~2.83 cpd: letter bodies
// ... band[3] through band[11] down to ~0.125 cpd (large-scale structure)
// residual = mip[12]        // ~0.088 cpd: DC, always preserved
```

Each band is attenuated by a **smoothstep rolloff** based on normalized eccentricity. On the linear path (`cmf_enabled: false`), cutoff distances are derived from **linear M-scaling** (Rovamo & Virsu 1979, Levi, Klein & Aitsebaomo 1985):

The minimum resolvable spatial detail grows linearly with eccentricity: **s_min(e) = s₀ × (1 + e/E₂)**. Band k (0-indexed, spatial scale 2^((k+1)/2) px at half-octave spacing) drops out when s_min(e) exceeds that scale, giving cutoff eccentricity = E₂ × (2^((k+1)/2) − 1):

| Band | Freq (cpd) | Cutoff (× E₂) | Content Preserved |
|------|-----------|----------------|-------------------|
| band[0] | 5.66 | 0.414 | Finest detail, serifs |
| band[1] | 4.0  | 1.0   | Thin strokes |
| band[2] | 2.83 | 1.828 | Letter bodies |
| band[3] | 2.0  | 3.0   | Small icons |
| band[4] | 1.41 | 4.657 | Words, UI labels |
| band[5] | 1.0  | 7.0   | Word groups |
| band[6] | 0.71 | 10.314 | Buttons, panels |
| band[7] | 0.5  | 15.0  | Layout blocks |
| band[8] | 0.354 | 21.627 | Large panels |
| band[9] | 0.25 | 31.0 | Page sections |
| band[10] | 0.177 | 44.255 | Half-page regions |
| band[11] | 0.125 | 63.0 | Full-width color fields |
| residual | 0.088 | Always | DC: overall color/luminance |

When `cmf_enabled` is true (most shipped modes, including the default), the cutoffs follow the Schwartz log-CMF form instead: `c[k] = cmf_a × (exp((k+1) × 0.5 × scale) − 1) / fovea_deg`, with `scale` derived from the viewport's cortical extent (`u_cortical_max`) and `fovea_deg = 1`. `dog_e2` applies only to the linear path.

The non-uniform spacing follows from M-scaling: coarse structure (bands 2–3) persists far into the periphery while fine detail (band 0) drops quickly. You can see *where* a button is without being able to read its label, which matches the subjective experience of peripheral vision.

**Parameters** (configurable per mode in `modes.json`):
- `dog_e2`: M-scaling half-rate eccentricity (linear path only). The eccentricity (in normalized screen coordinates) at which the resolution threshold doubles. Units are **normalized screen coordinates** (eccentricity / fovea_radius). The value is not in degrees of visual angle. Calibrated to the effective `normEcc` range (~0–0.8) produced by the V4 coupled eccentricity pipeline. Lower = more aggressive filtering. Default: 0.15 (High-Key), 0.12 (Biological).
- `dog_sharpness`: Band transition sharpness. 0.0 = gradual rolloff (wider transitions), 1.0 = sharp cutoff (narrow transitions).
- `dog_enabled`: Boolean gate. When false, falls back to legacy simple MIP pooling.

**Caveats and design choices**:
- The DoG input (`coupledEccentricity`) is modulated by V1 distortion strength and intensity, making it **attention-gated** as well as position-dependent. This diverges from biology, where RF size is fixed by retinal position, but produces a more usable result for the simulation's interactive context.
- Band differences (mip_k − mip_{k+1}) can be negative. The shader clamps the final reconstruction to [0,1] to prevent out-of-range artifacts.

With DoG bands, parafoveal text has a "frosted glass" quality: letter shapes and word boundaries remain visible, but the text cannot be read. Simple MIP pooling produces a uniform fog instead.

### 5.2 Density-Gated Crowding

The V1 Lateral Smash (domain warping) and DoG pooling depend on eccentricity. Without a density term, an isolated letter and a densely flanked letter at the same eccentricity would receive identical displacement and pooling. In biological vision, the isolated letter remains identifiable while the flanked letter does not (Bouma 1970; Pelli & Tillman 2008).

The structure map stores a density channel (`structure.g`), which the LGN signal passes on. Density gates the simulation twice: below 0.1 it sets the LGN suppression factor to 0 (the whitespace gate), and a sigmoid on blurred density scales V1 distortion strength, so dense content gets full Lateral Smash and isolated elements get reduced distortion (floor at 0.3 for residual acuity loss). Parameters are set per mode in `modes.json`: `crowding_density_threshold` 0.3 and `crowding_density_steepness` 20.0.

- **Diagnostic pages:** `reference-pages/crowding.html` (crowded-vs-isolated letters), `reference-pages/crowding-stimulus.html` (orientation, color grouping, complexity)
- **Spec:** [`docs/specs/implemented/density_gated_crowding.md`](specs/implemented/density_gated_crowding.md)
- **Full gap analysis:** [`docs/simulation-limitations.md`](simulation-limitations.md)

---

## 6. Universal Structure Map Pipeline (New in v2.0)

### Why the renderer reads the DOM

Pixel-only foveated renderers treat a paragraph of 14px text and a solid-color banner identically at the same eccentricity, since both are luminance and chrominance values. The visual system does not. Rosenholtz's Texture Tiling Model (2012) predicts that peripheral vision computes summary statistics over pooling regions that grow with eccentricity. The statistics depend on the *content* of those regions. A pooling region covering dense text contains high local feature variance (many edges, mixed orientations, heterogeneous spacing), while one covering a banner contains low variance. The summary statistics differ, so peripheral discriminability differs.

Unlike pixel-only renderers, Scrutinizer has access to the DOM. The scanner reads whether a block is text, along with its line height, font weight, and spacing to neighbors. It groups adjacent text nodes into paragraph clusters using Gestalt proximity before the shader runs. The density channel is computed from these groups of DOM nodes and is the input to the V1 stage's crowding gate. Dense text clusters get full displacement, and isolated elements are spared.

To unify this across the Open Web (DOM) and Figma (Scene Graph), v2.0 introduces an **Abstract Layout Provider** architecture. The renderer consumes a normalized data stream of layout blocks.

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

With this approach, visual tracking stays smooth during scroll, with no lag or "snap-to-position" artifacts when scrolling stops.

### Element Detection: Semantic Approach
The scanner detects elements by **semantic characteristics**, which avoids maintaining brittle lists of HTML tags:

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

This approach is **framework-agnostic** and detects modern web patterns (e.g., `<div role="button">`) without maintaining exhaustive tag lists.

### The Rasterizer: `StructureMap`
These blocks are painted onto an off-screen `<canvas>` (50% resolution for Structure Map, 25% for Saliency Map) to create the `u_structureMap` texture. Semantic data is encoded in its RGBA channels:

| Channel | Data | Description |
| :--- | :--- | :--- |
| **Red** | **Rhythm** | `lineHeight / 100.0`. Defines the vertical cadence of the content. |
| **Green** | **Mass** | `density` (0.0-1.0). Defines visual weight (font weight, image brightness). |
| **Blue** | **Semantics** | **Legacy (Stable)**: Type ID: Text (1.0), Image (0.5), UI (0.0). <br> **Experimental (v1.4.2)**: Packed Type + Phase. *See warning below.* |
| **Alpha** | **Role** | ARIA role ID (0–12) / 12, used by Blueprint mode. Interaction is encoded in Blue (Text=1.0 vs UI=0.0). |

> ⚠️ **Implementation Warning: Blue Channel Packing**
> In v1.4.2, we attempted to pack both **Type** and **Phase** (text y-alignment) into the Blue channel using 8-bit quantization (0-10 for Type, 11-255 for Phase).
> **Result**: This caused significant artifacts where Images (Type 0.5) were misread as Text Phase, leading to "shredded" visual noise.
> **Lesson**: Do not overload 8-bit channels with discontinuous data types. Use a separate texture for Phase or ensure Type codes are completely distinct from Phase ranges with a large safety margin.

### Shader Consumption
The fragment shader reads this map in two distinct modes:

#### Mode A: Wireframe ("Blueprint")
Uses the **Alpha Channel (Role)** to color-code bounding boxes by ARIA role, with box outlines from edges in the Green (density) and Blue (type) channels.
-   **Logic**: `roleId = int(structure.a * 12.0 + 0.5)` selects the color; `isEdge` comes from neighboring-texel differences in `structure.g` and `structure.b`.
-   **Result**: A wireframe overlay that reveals the underlying layout structure over a blueprint grid. See [`tutorials/blueprint_case_study.md`](tutorials/blueprint_case_study.md).

#### Mode B: Simulation ("Natural")
Uses the **Green Channel (Mass)** to gate the biological simulation.
-   **Logic**: `density < 0.1` sets the LGN suppression factor to 0 (whitespace gate), and a sigmoid on density scales V1 distortion strength (Section 5.2).
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
Based on user feedback, the following tunings were applied to stabilize the effect:

1.  **Static Mode (Animation Killed)**
    *   *Problem*: Previous versions used animated noise (`u_time`), creating a "boiling" or "broken TV" effect that attracted attention.
    *   *Fix*: All time dependencies were removed from the distortion noise. The periphery is now spatially distorted but **temporally stable**. This allows the user to saccade to a "ghost" they saw, only to find it wasn't what they thought, a key property of peripheral vision.

2.  **Chromatic Aberration (CA) Suppression**
    *   *Problem*: High-contrast text edges, when scrambled, created thousands of artificial sharp edges. The CA shader applied color fringing to *every single cut*, turning the text into messy "glitch art."
    *   *Fix*: CA is now **linearly suppressed** as the Scramble effect fades in. By the time the text is fully shredded, CA is zero. The result is a monochromatic texture.

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

The **Saliency Map** implements computational visual attention, predicting where the eye is drawn based on contrast, edges, and visual "attractiveness." The map is the input to **saliency gating**, in which the shader's LGN stage allocates more processing bandwidth to salient peripheral content. The design is loosely motivated by the limited bandwidth of the visual pathway (the human optic nerve is estimated to carry roughly 10⁷ bits/sec; Koch et al. 2006, *Current Biology*, doi:10.1016/j.cub.2006.05.056).

## Cognitive vs Retinal Constraint

### Retinal Constraint (Saliency Modulation OFF)
- Filtering is **purely distance-based** (radial from fovea)
- All content at same eccentricity receives equal filtering
- Geometric, homogeneous "heat-haze" effect
- **No cognitive priority**: logos treated same as body text

### Cognitive Constraint (Saliency Modulation ON)
- Filtering is **content-aware** and non-uniform
- High-saliency areas (logos, icons, edges) receive **more bandwidth** in periphery
- M-channel cues allocated for saccadic targeting
- **Brain-like prioritization**: important elements receive more resources

## Implementation

### 1. Gestalt Grouping (Proximity)
**File**: `renderer/scrutinizer.js`

Before the structure map is rasterized, raw layout blocks pass through a grouping stage that implements Gestalt proximity. The density channel is the input to the V1 crowding gate, so it should reflect perceptual groups. A paragraph of thirty text nodes should count as one dense cluster.

-   **Text Merging**: Vertically adjacent text blocks are merged into single "paragraph" clusters. Two text blocks merge when their vertical gap is within 1.5× the current line height and they are horizontally aligned (x within 20px, width within 50px). The merged block inherits the combined bounding box.
-   **Quantization**: Block coordinates are snapped to a grid (1px for text, 10px for UI) to prevent sub-pixel jitter from causing "flicker" in the periphery during micro-layout shifts.

The grouping runs on every structure map scan (~60fps during scroll). The merge criteria are deliberately loose. False merges (joining two unrelated text blocks) produce a slightly larger density region, which biases toward more crowding. False splits (failing to merge a paragraph) produce isolated blocks that get less crowding than they should. Loose criteria make the conservative error, a false merge, more likely than a false split.

### 2. Saliency Map Generation (Phase 5: Gated Saliency)
**File**: `renderer/saliency-worker.js`

The Saliency Map system has been upgraded to a **Cognitive Alignment** model. It combines biophysical contrast detection with top-down semantic gating.

**The Formula**:
`FinalSaliency = (RawContrast + 2.0 * Face) * (0.1 + 0.9 * Inhibitor) * (1 + 0.3 * Excitor)`

1.  **Raw Contrast (Bottom-Up)**:
    *   Uses **Difference-of-Gaussians** on Oklab channels (Intensity, Red-Green, Blue-Yellow), weighted 0.3 / 0.35 / 0.35.
    *   Detects edges, color contrast, and luminance shifts.

2.  **Inhibitor Mask (Silence Noise)**:
    *   Generated from the **Structure Map**.
    *   **Logic**: The mask is 1.0 inside structure blocks and 0 elsewhere, so areas with NO semantic structure (text or image) keep only `0.1` of their saliency.
    *   **Effect**: Suppresses paper textures, compression artifacts, and distinct-but-irrelevant gradients.

3.  **Excitor Mask (Media and UI Gain)**:
    *   Generated from the **Structure Map** (non-text blocks: images, media, UI controls).
    *   **Logic**: Multiplies the saliency signal by `1.3` inside those blocks.
    *   **Effect**: Raises the priority of media and controls relative to text of the same contrast. The gain is multiplicative, so featureless regions stay low.

4.  **Face Channel (Social Bias)** (New in v1.4.2):
    *   **Detection**: Uses `face-api.js` (Tiny Face Detector) in a background worker.
    *   **Logic**: Adds `2.0 ×` a Gaussian blob over each detected face region.
    *   **Effect**: Approximates the attentional priority of faces: observers fixate faces early and often in free viewing, even when they start in the periphery.

**Key Properties**:
- **Noise Suppression**: Blank pages now generate a blank saliency map (unlike v1.4 where noise created false positives).
- **Scroll Synchronization**: Structure data is passed to the worker every frame, which keeps the heatmap aligned with the content.
- **Structure Gating**: DOM structure suppresses saliency in empty regions. This is a top-down filter applied to a bottom-up map. It does not model predictive coding.

**Performance**:
- Separable Gaussian blur: O(2n) complexity
- Adaptive resolution scaling (target 256px max dimension)
- Runs in Web Worker (off main thread)
- Target: <5ms @ 256×256

**Temporal Smoothing**:
To prevent "flicker" and "dropouts" during rapid content updates (e.g., video playback), the saliency map uses a **double-buffered** approach with temporal blending.
-   **Target Buffer**: Renders the new state immediately.
-   **Current Buffer**: Blends towards the Target by ~15% per frame.
-   **Result**: Attention shifts blend in over several frames.

**References**:
- Itti, Koch, & Niebur (1998) - "A Model of Saliency-Based Visual Attention for Rapid Scene Analysis"
- Walther & Koch (2006) - "Modeling attention to salient proto-objects"

### 3. Texture Pipeline
-   **GL_TEXTURE3**: Saliency texture (Red channel = intensity).
-   **Upload**: The smoothed "Current" buffer is uploaded to the GPU every frame.
-   **Sampling**: `float saliency = texture2D(u_saliencyMap, uv).r;`

### 4. Saliency Gating Formula
**File**: `renderer/shaders/peripheral.frag` (in `processLGN` function)

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

### 5. Observed Behavior (Informal)

**Observed Behavior** :
-   **Social media icons** (Twitter, etc.): Visibly clearer than surrounding text (pop-out effect)
-   **Logos** (Bitrix24): Receive more bandwidth, resist warping/jitter
-   **UI elements**: Retain structural integrity for saccade guidance
-   **Body text**: Full peripheral filtering applied (minimum bandwidth)

**Interpretation**: These are informal observations from screenshots; they have not been validated against human data. They show the shift from a purely distance-based (optical) filter to a content-aware one.

## Usage

### Menu Controls
- **Simulation > Utility > Show Saliency Map**: Visualize saliency heatmap (Blue→Cyan→Green→Yellow→Red)
- **Simulation > Behavior > Enable Saliency Modulation**: Toggle saliency-based bandwidth allocation

### Config
```javascript
{
    enableSaliencyModulation: true  // Enable/disable saliency gating
}
```

### 6. Extended Modulation (V1 & V4)

Beyond the LGN suppression factor, saliency now modulates additional pipeline stages **in the far periphery only**, with temporal smoothing to prevent flicker on dynamic content.

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
> **Update (v1.4.3)**: Saliency modulation was removed from the color/chrominance stage. Peripheral chromatic attenuation applies regardless of saliency. A bright red logo in the periphery has its chrominance attenuated like any other content, preventing it from artificially "popping" and competing with the fovea.
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

Chromatic aberration is a lens effect (lateral chromatic aberration), used as a visual cue. It does not model a neural process. The V4 stage applies it to the processed output by shifting the fovea-to-periphery blend boundary per channel:

- Red: blends toward the pooled image slightly **later** (boundary shifted outward).
- Green: at the base boundary (master curve `t`).
- Blue: blends slightly **earlier** (boundary shifted inward).

The shift magnitude is:

- `offset = 0.005 * caFactor`, applied as `± offset * fovea_radius * 4.0` to the eccentricity, where `caFactor` is the color-effects curve (`t²`, Section 4) scaled by intensity and saliency/density protection.

`caFactor` is multiplied by `1 − scrambleZone`, so CA fades out where the grid scramble takes over. It runs only in the High-Key and Biological V4 styles (`v4_style_id` 0 or 1). The result is a color fringe along the fovea/periphery transition, supporting illegibility without very large blurs.

---

## 9. Peripheral Color: Chromatic Pooling & Oklab Pipeline

**v1.3:** Peripheral color processing upgraded from RGB to **Oklab** (perceptually uniform).
**v1.9:** Per-channel RG/YV chromatic pooling replaces uniform chrominance reduction (see [`docs/specs/implemented/chromatic_pooling.md`](specs/implemented/chromatic_pooling.md)).

### The Biology

Peripheral color is **pooled** (Rosenholtz TTM). The visual system averages chromaticity over increasingly large regions with eccentricity, preserving mean color while losing spatial chromatic detail. The RG (red-green) opponent channel, a foveal specialization, loses spatial resolution faster than YV (blue-yellow), which persists into the far periphery. This is a wiring constraint (sparse L-M midget cells beyond the fovea).

Historical claims of peripheral "color blindness" overstated the effect by conflating detection thresholds with suprathreshold appearance. Cone-opponent mechanisms persist to at least 50° eccentricity when stimuli are sufficiently large (Hansen, Pracejus & Gegenfurtner 2009, threshold data only; Bowers, Gegenfurtner & Goettker 2025). At typical display contrasts, suprathreshold color appearance shows partial constancy: perceived saturation declines less steeply than detection thresholds predict (Jiang, Shooner & Mullen 2022, power-law exponent ~0.5).

### Why Oklab?

RGB color space is not perceptually uniform: equal numeric changes in RGB values do not correspond to equal perceived color differences. Reducing chrominance in RGB space produces "muddy" artifacts, especially for saturated reds and blues.

**Oklab** (Ottosson, 2020) is a perceptual color space where:
- **L** (Lightness): Separates luminance from chrominance (0-1 range)
- **a** (Green-Red): Opponent color dimension
- **b** (Blue-Yellow): Opponent color dimension

This separation is loosely analogous to post-receptoral channels: one achromatic channel and two cone-opponent channels. The mapping onto pathways is not one-to-one. The parvocellular pathway carries red-green opponent signals and also fine luminance detail, and blue-yellow (S-cone) signals run largely through the koniocellular pathway (Hendry & Reid 2000, *Annual Review of Neuroscience*, doi:10.1146/annurev.neuro.23.1.127). Oklab is fit to perceptual color-difference data.

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
To prevent "mustard" artifacts (where removing red leaves yellow). This path runs only when chromatic pooling or DoG is disabled:

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
// Chromatic decay uses visual_ecc (true gaze eccentricity), NOT coupledEccentricity
// (V1 distortion-strength-scaled). Spatial band weights still use coupledEccentricity.
float chromNormEcc = max(0.0, visual_ecc) / max(fovea_radius, 0.001);
float fovea_deg = 1.0;  // 1° foveal radius (2° diameter)
float ecc_deg = chromNormEcc * fovea_deg;  // CMF-enabled modes then remap to cortical (log) eccentricity

// RG: frequency-independent steep decay (castleCSF k_e = 0.085)
float rg_atten = pow(pow(10.0, -u_rg_decay * ecc_deg), supra);

// Per-band frequency-dependent decay — large color fields persist
// 12 bands + residual, frequencies from 5.66 cpd (serifs) to 0.088 cpd (DC)
const float bandFreq[13] = float[13](5.657, 4.0, 2.828, 2.0, 1.414, 1.0, 0.707, 0.5, 0.354, 0.25, 0.177, 0.125, 0.088);
float rg_atten[13], yv_atten[13];
for (int k = 0; k < 13; k++) {
    rg_atten[k] = pow(pow(10.0, -(u_rg_decay + u_rg_freq_decay * bandFreq[k]) * ecc_deg), supra);
    yv_atten[k] = pow(pow(10.0, -(u_yv_decay + u_yv_freq_decay * bandFreq[k]) * ecc_deg), supra);
}

// Each band: split into Oklab luminance + chrominance, attenuate independently
result += chromaticAttenuate(band_k, rg_atten, yv_atten_band_k) * w_k;

vec4 chromaticAttenuate(vec4 color, float rg_atten, float yv_atten) {
    vec3 lab = rgbToOklab(color.rgb);
    lab.y *= rg_atten;   // a channel (red-green)
    lab.z *= yv_atten;   // b channel (blue-yellow)
    return vec4(oklabToRgb(lab), color.a);
}
```

**Base desaturation (always active):**
```glsl
// Convert to Oklab
vec3 lab = rgbToOklab(col);

// Uniform chrominance reduction — both channels attenuated equally
// Runs regardless of chromatic pooling — complementary, not alternative.
// Per-band handles frequency-dependent differential (RG faster than YV).
// Base desat ensures sufficient total chroma loss (rod dominance).
// Combined at corner (~10°): per-band (50%) × base (20%) ≈ 10% residual.
lab.y *= (1.0 - desaturationFactor); // a component
lab.z *= (1.0 - desaturationFactor); // b component

// Convert back to RGB
vec3 desaturatedColor = oklabToRgb(lab);
```

When chromatic pooling is active, the Red Kill Switch is bypassed (per-band RG decay at correct eccentricity handles red-specific suppression). Base desaturation always runs. It provides the overall cone-density-driven chroma floor that the castleCSF threshold model alone undershoots at suprathreshold contrasts.

**Rod tint** in Oklab space (High-Key style):
```glsl
// Lightness kept (slightly dimmed), chroma removed, slight blue shift
vec3 rodColorLab = vec3(0.96 * lab.x, 0.0, -0.05);
vec3 rodColor = oklabToRgb(rodColorLab);
// ...plus contrast-gated grain, then mixed in at 30% of the desaturation factor
return mix(finalCol, rodColor, desaturationFactor * 0.3);
```

### Benefits

1. **Perceptually uniform desaturation** - No muddy artifacts
2. **Opponent-style axes** - a and b approximate red-green and blue-yellow dimensions, so RG and YV can be attenuated separately
3. **Natural grayscale** - Preserves perceived brightness
4. **Simple rod tint** - A fixed slight blue shift in Oklab b (−0.05), used as a visual cue. It does not model rod spectral sensitivity

### Gamma Correction

Oklab requires linear RGB input. The implementation handles sRGB gamma correction:
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

- `parafovea_radius / fovea_radius = 2.5` (2.5° at the default calibration)

> **Note**: "Calibrated Visual Angles" (separating a measured pixels-per-degree value from the foveal radius) is not yet implemented; see ROADMAP. The Foveal Calibration tool measures a perceptual foveal radius in pixels, and the shader treats that radius as 1°.

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

Those sliders would reshape the smoothstep curves described above, allowing different “profiles” of peripheral disruption while preserving the same underlying model.

---

## 13. Neuro-Architecture Pipeline

The renderer organizes these effects into a modular pipeline inspired by the human visual system.

> **Note:** The terms "LGN", "V1", and "V4" are used here as software architectural labels to group related operations (Gating, Geometry, Aesthetics). They are not intended to represent a rigorous biological simulation of these brain areas.

### Stage 1: LGN (Gating & Masking)
This stage computes where effects apply.
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
- **`lgn.saliency`**: High-contrast, colorful regions (computed from pixels via Itti-Koch color opponency)
- **`lgn.density`**: Structural regions from DOM/node tree (TEXT blocks, images, UI controls)

**Rationale**: With `max()`, bandwidth is allocated if *either* signal detects important content:
- **Text in live DOM** → High structure density, even if low contrast (light gray text)
- **Text in bitmaps/screenshots** → High saliency from contrast, even without structure data
- **Colorful logos/icons** → High saliency from color opponency

Bandwidth is therefore allocated for both live DOM content (browser) and flattened bitmap exports (Figma plugin).

### Stage 2: V1 (Geometry & Distortion)
This stage computes how the image is warped.
-   **Inputs**: `suppressionFactor` (from LGN), `ModeConfig`.
-   **Operation**: Calculates `distortedUV` and `displacement`.
-   **Modes**:
    -   **Noise**: Fluid, continuous distortion (e.g., Drunken Reading).
    -   **Mongrel Approximation** (formerly "Shatter"): Blocky, discontinuous displacement (e.g., Default).
        > **Note:** This displacement mode is a coarse approximation of the "Mongrel" texture account. Summary-statistic texture synthesis runs separately on WebGPU in the compute modes (Tier 2.5 and up, e.g. modes 10 and 14).
    -   **None**: No distortion (e.g., Blueprint).

### Stage 3: V4 (Aesthetics & Style)
This stage computes the final color of each pixel. It also demonstrates how the core foveated pipeline can be customized to achieve different research or artistic goals.

-   **Inputs**: `distortedUV`, `ModeConfig`.
*   **Operation**: Applies color grading and pixel effects.
*   **Customization Examples (Architectural Stress Tests)**:
    -   **High-Key (Default)**: Standard peripheral bandwidth filtering with chromatic pooling and ghosting.
    -   **Biological (Purkinje Darkening)**: An approximation of scotopic (rod) vision, where red objects darken toward black as in the Purkinje shift and luminance drops significantly.
    -   **Frosted**: A low-contrast, milky aesthetic useful for simulating cataracts or foggy conditions.
    -   **Blueprint**: A "wireframe" mode that draws the layout structure detected by the engine as bounding boxes color-coded by ARIA role.
    -   **Drunken Reading**: A fluid, wave-based distortion that simulates temporary visual impairments or disorienting states.

### Saccadic Blindness (Velocity-Dependent Fovea)
When **Saccadic Blindness** is enabled (Simulation > Behavior), the shader shrinks `fovea_radius` and `parafovea_radius` as pointer velocity rises: `saccadeFactor = smoothstep(4.0, 10.0, u_velocity)` (px/ms), and both radii are multiplied by `1 − saccadeFactor`. At 10 px/ms and above, the whole viewport renders as periphery.

This is a design heuristic loosely motivated by saccadic suppression, the reduced visual sensitivity during saccades (Ross, Morrone, Goldberg & Burr 2001, *Trends in Neurosciences*, doi:10.1016/S0166-2236(00)01685-4). Pointer velocity is a noisy proxy for saccadic state, and the thresholds are tuned for visual effect. See [`developers_guide.md`](developers_guide.md) (Saccadic Blindness).

The `u_blurRadius` uniform in `peripheral.frag` (a velocity-driven "pupil aperture" blur) is set only by the legacy `renderer/scrutinizer-visualizer.js`, which the app does not load. The live renderer leaves it at 0.

### Foveal Integrity
Two mechanisms keep the fovea unprocessed.
-   **Hard Bypass**: Pixels within `dist < fovea_radius * 0.5` are strictly excluded from V1 distortion and V4 aesthetic processing.
-   **True Color Sampling**: A centralized `sampleSource(uv)` helper ensures that the fovea (and any "clear" view) always receives the raw, correctly color-swizzled (BGRA->RGBA) image from the capture buffer. This prevents accidental color shifts or darkening in the fovea.

---

## 14. Visual Memory (Persistence)

Scrutinizer's **Visual Memory** setting keeps previously fixated regions clear after the pointer moves on, as an operational display aid.

### Mechanics
-   **Dwell Activation**: When the pointer stays nearly still (velocity < 0.1 px/ms) on a spot for >50ms, that region is "committed" to memory.
-   **Buffer System**: Remembered spots are stored in a FIFO buffer (`visualMemoryBuffer`).
-   **Capacity**: The buffer size is configurable (`visualMemoryLimit`). When full, the oldest memory fades out.
-   **Rendering**:
    -   The buffer is rendered to a **Visual Memory Mask** (`u_maskTexture`).
    -   This mask is used in the fragment shader to modulate distortion signals.
    -   **Blend Mode**: `Screen` blending is used to accumulate memories, ensuring that overlapping memories remain visible and don't darken each other.

### Modes

#### 1. Standard Persistence (Foveal Protection)
*   **Default Behavior**: Remembered areas are rendered *clearly*, creating a "clean" overlay on top of the distorted periphery.
*   **Biological Mechanism**: Loosely motivated by memory for previously fixated locations. It does not model human visual memory: iconic memory lasts a few hundred milliseconds (Sperling 1960), and detail carried across saccades is sparse and low-fidelity, as change blindness shows (Irwin 1991; Rensink, O'Regan & Clark 1997). The clear trail is an operational setting.
*   **Implementation**: `u_useMask = 1.0`. The mask reduces distortion strength: `strength *= (1.0 - memoryStrength)`.

#### 2. Inhibition of Return (Saliency Suppression)
*   **Behavior**: Recently visited areas are rendered with *increased* distortion or lower saliency.
*   **Biological Mechanism**: Mimics the "Inhibition of Return" phenomenon, where the attention system discourages re-orienting to a recently visited location to facilitate efficient foraging/search.
*   **Implementation**: `u_useMask = 2.0`. The mask suppresses LGN signals (Saliency, Density) but *not* V1 distortion. This effectively zeroes out the visited area's bandwidth allocation, reverting it to minimum-bandwidth peripheral filtering.

