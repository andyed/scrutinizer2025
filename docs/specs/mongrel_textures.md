# Mongrel Textures Specification

## 1. Overview
"Mongrel" textures (Rosenholtz et al.) represent the statistical summary of visual information in the periphery.
Currently, Scrutinizer approximates this with the "Shatter" shader (random jitter).
This spec defines the roadmap for **Genuine Mongrel Synthesis** using "Massive Downsampling" and pooling regions.

### Core Concept
Instead of distorting pixels, we:
1.  **Pool** the image into large "summary regions" (growing with eccentricity).
2.  **Synthesize** a new texture for each region that preserves summary statistics (mean color, orientation, density) but discards position.

---

## 2. The "Massive Downsampling" Strategy

True texture synthesis is too expensive for real-time (60fps) WebGL.
We will approximate it using **MIP-Mapping and Pooling**.

### 2.1 The Pooling Pyramids
We create a custom mip-chain where each level represents a larger pooling region (simulating larger receptive fields in the periphery).

*   **Level 0**: Raw Image (Fovea)
*   **Level 1**: 2x2 Pool (Parafovea)
*   **Level 2**: 4x4 Pool
*   **Level 3**: 8x8 Pool (Mid Periphery)
*   **Level 4**: 16x16 Pool (Far Periphery)

### 2.2 The "Mongrel" Synthesis
Instead of just blurring (averaging), which destroys texture, we synthesize "Representative Texture" in each bucket.

**Algorithm:**
For each pooling region (e.g., 16x16 block):
1.  **Analyze**: Compute dominant orientation and contrast variance.
2.  **Replace**: Substitute the 16x16 block with a pre-computed "Texture Tile" that matches these stats.
    *   *High Variance + Horizontal*: text-like horizontal stripes.
    *   *High Variance + Vertical*: vertical edge.
    *   *Low Variance*: solid color (Average).

*Note: For the prototype, "Massive Downsampling" effectively means rendering the "Level 4" (16x16) mosaic in the far periphery, but maintaining contrast (Max/Min sampling) rather than Average (Blur).*

---

## 3. Impact on Blueprint Mods

The implementation of proper Mongrel Textures fundamentally changes the **"Blueprint" (Wireframe)** visualization mode.

### 3.1 From "DOM Blocks" to "Pooling Tiles"
Currently, Blueprint Mode visualizes the **DOM Structure** (rectangles for `div`, `p`, `button`).
With Mongrel Textures, Blueprint Mode should visualize the **Receptive Field Mosaic**.

### 3.2 New Sub-Mode: `Receptive Fields`
*   **Visual**: A Voronoi-like or Grid-like overlay showing the size of the "Mongrel Tiles".
*   **Center**: Small, dense tiles (Fovea).
*   **Periphery**: Huge, blocky tiles (Far Periphery).
*   **Contents**: Instead of the original image, show the *Statistics* of that tile (e.g., an arrow for orientation, a circle for contrast magnitude).

### 3.3 Integration with `blueprint_mods.md`
The `blueprint_mods.md` spec should be updated to include **"Mongrel Pooling"** as a visualization layer under **"The Logical Brain"** (or perhaps a new "Visual Brain" layer).
*   **Level 1**: Structure Map (DOM Truth).
*   **Level 2**: Mongrel Pooling (Retinal Truth). The AI sees the world as a collection of 16x16 summary tiles, not as DOM nodes.

---

## 4. Implementation Skeleton

### 4.1 Shader (`mongrel.frag`)
```glsl
// Sample the appropriate MIP level based on eccentricity
float level = log2(eccentricity * scaling_factor);
vec4 pooled_stat = textureLod(u_texture, uv, level);

// Decode statistics (e.g., R=Mean, G=Variance, B=Orientation)
// Synthesize a texture patch on the fly
vec3 mongrel_tex = generateStochasticBatch(uv, pooled_stat);
```

### 4.2 WebGL Pipeline
1.  **Compute Shader / GPGPU**: Generate the statistical mip-maps (Mean, Variance, Orientation) every frame.
2.  **Pass**: Bind this 'Statistics Texture' to the peripheral shader.
