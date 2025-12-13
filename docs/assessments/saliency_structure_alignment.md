# Saliency & Structure Map Alignment Assessment

## 1. Current Architecture
*   **Structure Map** (`renderer/structure-map.js`): Renders semantic blocks (Text, Image, UI) with attributes for Rhythm and Mass. It currently ignores saliency input.
*   **Saliency Map** (`renderer/saliency-worker.js`): Computes "Bottom-Up" saliency using biologically plausible Color Opponency and Center-Surround (scale changes). It operates purely on pixel data, unaware of the semantic structure.

## 2. Recommendation: Semantic Saliency & Top-Down Modulation
**Verdict: Implement "Gated" Semantic Saliency.**

### The Limitation of Simple Addition
A simple weighted average (e.g., `0.7 * color + 0.3 * structure`) is insufficient. If the Structure Map identifies a region as pure noise, an additive model would still allow 70% of the distracting background texture to pass through.

### The Solution: Multiplicative Inhibition & Additive Excitation
We will separate the Structure Map's influence into two dynamic masks:
1.  **The Inhibitor Mask ($M_{inh}$)**: Maps "noise/background" to near 0.0 and content to 1.0. This acts as a **Gate**.
2.  **The Excitor Mask ($M_{exc}$)**: Maps critical UI (Buttons, Inputs) to high values. This acts as a **Boost**.

**Implementation Logic**:
```javascript
// 1. Bottom-up Calculation (The Lizard Brain)
let rawSaliency = calculateColorOpponency() + calculateCenterSurround();

// 2. Apply Inhibition (Gating) - SILENCE the noise
// Multiplicative turns the structure map into a gate.
let gatedSaliency = rawSaliency * structureInhibitorMask;

// 3. Apply Excitation (Boosting) - HIGHLIGHT the controls
// Add extra weight to known interactive elements regardless of their pixel contrast.
let finalSaliency = gatedSaliency + (structureExcitorMask * boostFactor);
```

This ensures a high-contrast background pattern is ignored (Inhibited), while a low-contrast "Cancel" button is still detected (Excited+Boosted).

## 3. Recommendation: Gestalt Closure as a Post-Process
**Verdict: Implement Closure via Clustering (not Pixels).**

### "Wireframe Mode" vs. Gestalt
Visualizing the Structure Map (the "Ingredients") is different from visualizing Gestalt Closure (the "Recipe").
*   **Structure**: "I see 5 crisp rectangles."
*   **Gestalt**: "I see a Navigation Bar."

To achieve the "organic blob" or "convex hull" visualization that represents true closure, we should not operate on pixels, but on the semantic bounding boxes from the Structure Map.

### Recommended Algorithms
1.  **DBSCAN (Density-Based Spatial Clustering)**:
    *   **Why**: Unlike K-Means, it doesn't need a target count. It finds groups based on density (proximity).
    *   **Implementation**: Feed center points of Structure nodes. If nodes are within threshold $\epsilon$ (epsilon), they bond.
2.  **Morphological Closing (Raster Approach)**:
    *   **Why**: Simple and effective for generating "blobs".
    *   **Implementation**: Decrease resolution of Structure Map -> Dilate (expand white) -> Erode (shrink white). The result connects nearby elements into unified organic shapes.

## 4. Engineering Challenge: Temporal Synchronization
**The Problem**:
*   **Structure Map**: Instant (DOM-based).
*   **Saliency Map**: Latent (Worker-based, ~100-300ms delay).

If we modulate the Saliency Map using the *current* Structure Map, but the Saliency Map is from a screenshot taken 200ms ago (and the user scrolled), the masks will misalign.

**Strategy: Snapshotting**
When a screenshot is captured for the Saliency Worker, we must simultaneously capture the state of the Structure Map (or a lightweight serialization of it).
1.  **Main Thread**: Capture `screenshot` + `structureData`.
2.  **Worker**: Receive both. Use `structureData` to generate $M_{inh}$ and $M_{exc}$ locally.
3.  **Result**: The returned Saliency Map is internally consistent, even if it arrives 200ms late. It can then be composited or re-projected if necessary, but the modulation *itself* was accurate to the pixels.

## Summary of Action Plan
1.  **Update Saliency Worker**: Accept `structureData` payload.
2.  **Implement Masks**: Code the `Inhibitor` and `Excitor` generation logic inside the worker.
3.  **Implement Clustering**: Add a DBSCAN or Morphological pass for the distinct "Closure Mode" visualization.
4.  **Enforce Sync**: Ensure `structureData` is passed *with* the image message to avoid scroll tearing.
