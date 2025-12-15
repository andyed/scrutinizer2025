# Saliency Map Improvement Roadmap

## Overview
This document outlines improvements to `color-saliency-map.js` based on computational neuroscience best practices and performance optimization for real-time VJ applications.

---

## Quick Wins (Implement Now)

### 1. ✅ Use True Perceptual Luminance
**Priority**: HIGH | **Effort**: LOW | **Impact**: HIGH

**Current**: `I = (R + G + B) / 3.0` (simple average)

**Improved**: Use ITU-R BT.709 standard luminance weights:
```javascript
I = 0.2126 * R + 0.7152 * G + 0.0722 * B
```

**Rationale**: Human vision is most sensitive to green (~72%), then red (~21%), then blue (~7%). This dramatically improves saliency accuracy for detecting text, UI elements, and natural scenes.

**Files**: `renderer/color-saliency-map.js:62`

---

### 2. ✅ Pre-Calculate Weight Multipliers
**Priority**: MEDIUM | **Effort**: LOW | **Impact**: MEDIUM

**Current**: Inline magic numbers in hot loop
```javascript
const val = 0.3 * I[i] + 0.35 * RG[i] + 0.35 * BY[i];
```

**Improved**: Define constants outside loop
```javascript
const W_I = 0.3;
const W_RG = 0.35;
const W_BY = 0.35;
```

**Rationale**: Reduces floating-point arithmetic overhead, improves code readability, and makes tuning easier.

**Files**: `renderer/color-saliency-map.js:75`

---

### 3. ✅ Expose Raw Saliency Data
**Priority**: HIGH | **Effort**: LOW | **Impact**: HIGH

**Current**: `computeFromImage` returns `undefined`, only writes to canvas

**Improved**: Return normalized `Float32Array`
```javascript
return { data: saliency, width: this.width, height: this.height, maxVal };
```

**Rationale**: Enables downstream processing (Gestalt closure, attention maps, procedural content generation) without re-computing or reading back from canvas.

**Files**: `renderer/color-saliency-map.js:37-103`

---

## Medium-Term Improvements

### 4. ✅ Merge Feature Extraction and Combination Loops
**Priority**: MEDIUM | **Effort**: MEDIUM | **Impact**: MEDIUM

**Current**: 2 passes (Extract+Combine → Normalize+Write)

**Improved**: 2 passes (Extract+Combine → Normalize+Write)

**Rationale**: Eliminates intermediate `Float32Array` allocations for `I`, `RG`, `BY`. Reduces memory bandwidth by ~30%.

**Estimated Performance Gain**: 15-20% reduction in compute time

**Files**: `renderer/color-saliency-map.js:56-78`

---

### 5. ✅ Adaptive Resolution Scaling  
**Priority**: LOW | ** Effort**: LOW | **Impact**: LOW

**Current**: Adaptive target max dimension (e.g., 256px)

**Improved**: Target maximum dimension (e.g., 256px)
```javascript
const maxDim = Math.max(width, height);
const scale = Math.min(1.0, 256 / maxDim);
```

**Rationale**: Ensures consistent processing complexity regardless of input resolution. Prevents over-processing small images and under-sampling large ones.

**Files**: `renderer/color-saliency-map.js:20,24`

---

## Long-Term / Research Goals---

### 6. ✅ Implement Center-Surround Mechanism
**Priority**: HIGH (for accuracy) | **Effort**: HIGH | **Impact**: VERY HIGH  
**Status**: ✅ COMPLETE (2025-12-11)

**Implementation**: Multi-scale Difference-of-Gaussians (DoG)
```javascript
For each feature map (I, RG, BY):
  1. Fine scale: Gaussian blur with σ=1.0
  2. Coarse scale: Gaussian blur with σ=3.0
  3. Center-surround: |Fine - Coarse|
  4. Combine: 0.3*cs_I + 0.35*cs_RG + 0.35*cs_BY
```

**Benefits Achieved:**
- Isolated objects "pop out" (high saliency)
- Uniform regions suppressed (low saliency)
- Edges and boundaries enhanced
- Biologically accurate attention mechanism

**Performance:**
- Separable Gaussian blur (O(2n) vs O(n²))
- Reusable buffers to minimize allocations
- Target: <5ms @ 256×256

**References**:
- Itti, Koch, & Niebur (1998) - "A Model of Saliency-Based Visual Attention for Rapid Scene Analysis"
- Walther & Koch (2006) - "Modeling attention to salient proto-objects"

**Implementation Notes**:
- Uses separable Gaussian blur for performance
- 2-scale pyramid (fine + coarse)
- Edge clamping for boundary handling

**Files**: `renderer/saliency-worker.js` (94 → 235 lines)

---

### 7. ✅ Web Workers for Off-Main-Thread Processing
**Priority**: MEDIUM | **Effort**: HIGH | **Impact**: HIGH (for frame rate)

**Current**: Saliency computation blocks main thread (~5-10ms)

**Improved**: Offload to Web Worker
```javascript
// main.js
worker.postMessage({ imageData }, [imageData.data.buffer]);

// worker.js
self.onmessage = (e) => {
  const saliency = computeSaliency(e.data.imageData);
  self.postMessage({ saliency }, [saliency.buffer]);
};
```

**Rationale**: Ensures smooth 60fps rendering even during saliency computation. Critical for VJ/live applications.

**Considerations**:
- Use `Transferable` objects to avoid memory copying
- Pipeline depth: Process frame N while rendering frame N-1
- Fallback for browsers without `OffscreenCanvas` support

**Files**: New `renderer/workers/saliency-worker.js`

---

## Weight Tuning Research

Current weights (`W_I = 0.3`, `W_RG = 0.35`, `W_BY = 0.35`) are heuristic. Consider A/B testing or user-configurable presets:

| Preset       | W_I | W_RG | W_BY | Use Case                          |
|--------------|-----|------|------|-----------------------------------|
| **Balanced** | 0.3 | 0.35 | 0.35 | Default (current)                 |
| **Colorful** | 0.1 | 0.45 | 0.45 | Emphasize hue over brightness     |
| **Edges**    | 0.6 | 0.2  | 0.2  | Prioritize contrast/text detection|

**Files**: Add to `renderer/config.js` as `saliencyWeights`

---

## Success Metrics

- **Performance**: Saliency computation < 3ms @ 1920x1080 (currently ~8ms)
- **Accuracy**: Saliency map correctly highlights:
  - Text on uniform backgrounds (e.g., blue hyperlinks)
  - UI buttons and controls
  - Faces and high-contrast objects
  - Does NOT highlight uniform colored regions

---

## Implementation Order

1. ✅ **Phase 1** (Completed): True luminance, expose data, pre-calc weights
2. ✅ **Phase 2** (Completed): Merge loops, adaptive scaling
3. ✅ **Phase 3** (Completed 2025-12-11): Center-surround mechanism (DoG)
4. ✅ **Phase 4** (Completed): Web Workers (Implemented in `renderer/saliency-worker.js`)
5. ⬜ **Phase 5** (Planned): Cognitive Alignment & Gated Saliency (Saliency-Structure Fusion)

**Status update**: Phase 1-4 complete. Phase 5 is the next major frontier.

---


---

## Phase 5: Cognitive Alignment (Planned)

### 8. ✅ Gated Semantic Saliency (Fusion) (Implemented v1.4.2)
**Priority**: CRITICAL | **Effort**: HIGH | **Impact**: VERY HIGH
**Status**: ✅ COMPLETE (2025-12-14)

**Problem**: Current additive model (`0.7*color + 0.3*structure`) allows noise to leak through.
**Solution**: Implement multiplicative "Gating" where structure defines the *potential* for saliency.
-   **Inhibitor Mask**: Silences noise/background texture.
-   **Excitor Mask**: Boosts UI controls regardless of contrast.
-   **Formula**: `Final = (RawSaliency * Inhibitor) + Excitor`

### 9. ✅ Gestalt Closure ("Blob Detection")
**Priority**: HIGH | **Effort**: MEDIUM | **Impact**: HIGH
**Status**: ✅ COMPLETE (2025-12-14)

**Problem**: Visualizing individual structure blocks looks like "ingredients" rather than a coherent "recipe" (UI component).
**Solution**: Implement **DBSCAN** or **Morphological Closing** to fuse nearby elements into organic "Gestalt Blobs" for the wireframe/closure mode.

### 10. ✅ Temporal Synchronization
**Priority**: MEDIUM | **Effort**: MEDIUM | **Impact**: HIGH (Usability)
**Status**: ✅ COMPLETE (2025-12-14)

**Problem**: Worker latency causes "scroll tearing" where the saliency map (old) misaligns with the structure map (new).
**Solution**: Snapshot `structureData` and pass it *with* the image to the worker. The worker generates masks locally, ensuring pixel-perfect alignment for that frame.
