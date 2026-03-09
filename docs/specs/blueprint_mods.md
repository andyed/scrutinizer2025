# Blueprint Mods: Diagnostic Suite Specification

> **Last updated:** 2025-12-13

## 1. Overview
**Blueprint Mods** are a collection of practical diagnostic visualization modes designed for Vision Researchers, UI Designers, and UX Professionals.

Rather than simulating the *user's experience* (Human Vision), Blueprint Mods visualize the *diagnostic data* underlying the simulation. They answer the question: *"Why is the AI reacting this way?"* making them a practical tool for tuning designs and parameters.

### Core Philosophy
*   **Transparency**: Every internal buffer (Saliency, Structure, Inhibition) must be visualizable.
*   **Aesthetics**: Even debug views should look "sci-fi" and polished (The "Wireframe" aesthetic).
*   **Utility**: Research modes must be useful for tuning the core simulation parameters.

---

## 2. The Visualization Layers

We define four new *sub-modes* for the Blueprint aesthetic.

### A. The "Lizard Brain" (Saliency & Attention)
Visualizes the bottom-up attention mechanism and the modulation masks.
*   **Visual**: Heatmap overlay.
*   **Channels**:
    *   **Raw Saliency**: Grayscale intensity.
    *   **Inhibition Mask ($M_{inh}$)**: Red tint (Showing what is suppressed/ignored).
    *   **Excitation Mask ($M_{exc}$)**: Green tint (Showing what is boosted).
*   **Goal**: Verify that the "Cancel" button is Green (Excited) and the background noise is Red (Inhibited).

### B. The "Logical Brain" (Structure Map)
Visualizes the raw semantic scaffolding provided by the DOM scanner.
*   **Visual**: Semi-transparent colored bars/blocks.
*   **Encoding**:
    *   **Text**: Cyan blocks (Height = Rhythm).
    *   **Images**: Purple blocks.
    *   **UI/Controls**: Orange blocks (High importance).
*   **Goal**: Debug the `StructureMap` rasterization. If a button isn't orange, the scanner is broken.

### C. The "Gestalt Brain" (Closure & Grouping)
Visualizes the "Perceived Groups" formed by clustering nearby structure blocks.
*   **Visual**: Organic "blobs" or convex hulls wrapping groups of elements.
*   **Algorithm**: DBSCAN + Convex Hull or Morphological Closing.
*   **Goal**: Verify "Object-Based Distortion". If the AI sees a paragraph as 5 separate lines, the distortion will tear it apart. If it sees 1 blob, the distortion will move it coherently.

<!-- Section D (Mongrel Textures) Removed per feedback -->

---

## 3. Architecture & Data Flow

### 3.1 Data Pipeline Changes
Currently, the Saliency Worker returns a single `ImageData` buffer.
**New Protocol**: The worker returns a composite payload.

```javascript
// Worker Response
{
  saliencyMap: Float32Array,  // The raw priority map
  gestaltClusters: Array<Polygon>, // Convex hulls of detected groups
  masks: {
    inhibition: Float32Array, // The gating mask
    excitation: Float32Array  // The boosting mask
  }
}
```

### 3.2 Texture Packing (Debug Pathway)
**Important**: This packing strategy is *specifically* for the specialized debug visualization. The main simulation pipeline may continue to use a single-channel saliency texture for performance, or read only the relevant channels.

**Texture 3 (`u_saliencyMap`) Repurpose for Debug**:
*   **R**: Final Saliency (Standard)
*   **G**: Inhibition Mask $M_{inh}$ (Debug Overlay)
*   **B**: Excitation Mask $M_{exc}$ (Debug Overlay)
*   **A**: Unused

### 3.3 Shader Implementation (`peripheral.frag`)
We extend the `v4_style_id == 3` (Wireframe) bucket to support sub-modes via a new uniform `u_blueprint_submode`.

```glsl
if (u_v4_style_id == 3) { // Blueprint Mode
    if (u_blueprint_submode == 0) {
        // Render Saliency Heatmap (Lizard)
        // Uses G and B channels for Red/Green tints
        return renderLizardBrain(saliency); 
    } else if (u_blueprint_submode == 1) {
        // Render Structure Blocks (Logical)
        return renderStructureOverlay(structureMap);
    } else if (u_blueprint_submode == 2) {
        // Render Gestalt Blobs (Gestalt)
        return renderGestaltBlobs(uv); 
    }
}
```

---

## 4. Graduation to Core (The "Why")
These visuals are not just for show. They validate the components needed for **Next-Gen features**:

1.  **Object-Based Distortion**: Once Gestalt Blobs are validated visually, we use them to mask V1 distortion. Instead of warping *pixels*, we warp *blobs*. This prevents text tearing.
2.  **Semantic Saliency**: Once we prove the Inhibitor mask correctly targets background noise, we enable it by default to fix the "distracting wallpaper" bug.
3.  **Adaptive Fidelity**: Using the Excitor mask to dynamically adjust the Foveal Radius (e.g., expand fovea when looking at a complex UI menu).

## 5. Implementation Roadmap

### Phase 1: Worker Masks & Sync
*   **Task**: Modify `SaliencyWorker` to compute Inhibition/Excitation masks.
*   **Sync Strategy**: Implement **Snapshotting**.
    *   Main thread captures `screenshot` + `structureData` (serialized list of blocks) together.
    *   Both are sent to Worker in one message.
    *   Worker computes saliency on pixels, masks on structure data.
    *   Result is perfectly aligned time-wise.

### Phase 2: Debug Overlay Shader
*   **Task**: Update `peripheral.frag` to visualize the G/B channels.
*   **Visual**: Red tint for Inhibition ($M_{inh} < 0.1$), Green tint for Excitation ($M_{exc} > 0.8$).

### Phase 3: Gestalt Clustering
*   **Task**: Implement DBSCAN in `SaliencyWorker`.
*   **Parameters**:
    *   `epsilon`: Adaptive based on element density or viewport width (e.g., `viewportWidth * 0.02`).
    *   `minPts`: Fixed at 1 or 2 to allow small isolated groups.
*   **Output**: List of convex hull polygons.

### Phase 4: Canvas Overlay (Gestalt)
*   **Decision**: We will use a **Canvas 2D Overlay** for visualizing Gestalt blobs.
    *   *Why?* Calculating convex hulls and rendering arbitrary polygons is complex and expensive in a fragment shader (SDF approach). Drawing them on a 2D canvas on top of the WebGL canvas is trivial, performant for debug, and allows "organic" styling (Bezier curves).

## 6. Engineering Requirements
*   **Performance**: All debug calculations (clustering) must happen in the Worker.
*   **Sync**: Strict adherence to the Snapshotting strategy.
*   **Platform**: Must work in Electron (Node integration) and Standard Web (OffscreenCanvas).
