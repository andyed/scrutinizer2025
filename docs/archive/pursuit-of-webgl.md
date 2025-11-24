# Pursuit of WebGL (formerly WebContentsView Migration)

## Status: Pivot Required

**Current State (Nov 2025):**
We successfully migrated from `<webview>` to a dual-window architecture (Main Window + Hidden Content Window) using Electron's `paint` events.
- ✅ **Functional**: Foveal effect, scrolling, input forwarding, and navigation all work.
- ❌ **Performance**: ~25x slower than v1.0. The overhead of copying 1080p bitmaps from GPU -> CPU -> IPC -> CPU -> Canvas is too high for 60fps.

**Conclusion:**
The CPU-based offscreen rendering path is a dead end for high-performance visual effects. We must pivot to a **WebGL-based pipeline** where the captured frame is processed entirely on the GPU.

---

## The New Plan: WebGL Pipeline

### Why WebGL?
1.  **Zero-Copy (Ideal)**: If we can use "GPU Shared Texture" mode, the renderer can read the content window's texture directly without CPU involvement.
2.  **Parallel Processing**: The blur effect (currently a 3-pass box blur on CPU) is trivial for a fragment shader, running in <1ms.
3.  **Scalability**: Resolution independent performance.

### Architecture

```
[Hidden Content Window]
       |
       v (Shared Texture Handle / or fast IPC)
       |
[Main Window Renderer]
       |
    [WebGL Canvas]
       |
    [Fragment Shader]
    - Input: Raw Frame Texture
    - Input: Mouse Position (Uniform)
    - Input: Blur Radius (Uniform)
    - Logic:
        1. Sample texture
        2. Calculate distance from mouse
        3. Apply variable blur based on distance
        4. Apply desaturation/rod-color simulation
       |
    [Screen]
```

### Next Steps (WebGL Sprint)

1.  **Shader Implementation**:
    - Port `ImageProcessor.js` logic (blur, desaturation, masking) to GLSL.
    - **New Feature: "Mongrel" Receptive Field Simulation**:
        - Instead of simple Gaussian blur, use a Voronoi or Mosaic pass in the periphery.
        - Divide periphery into cells (simulating receptive fields).
        - Average color within each cell.
        - This biologically accurate model simulates the "blocky" nature of V1 cortex input.

2.  **Texture Transport**:
    - Investigate Electron's `useSharedTexture` option for `WebContentsView` (requires native module?).
    - Fallback: Optimize the current `paint` event -> Texture upload pipeline. Even with IPC, uploading to GPU and blurring there might be faster than CPU blur.

3.  **Optimization**:
    - Reduce IPC frequency if using software fallback.
    - Implement dirty region updates.

---

## Legacy Notes (WebContentsView Migration Attempt)

*Preserved for context on why we are here.*

## Attempt 2 (2025-11) – Successful OSR with BrowserWindow

We initially attempted to use `WebContentsView` with `offscreen: true`, but encountered significant issues:
1.  **"No content under offscreen mode"**: This error occurred when the view was added to the window hierarchy.
2.  **White Screen**: When removed from the hierarchy to fix the error, the view stopped loading content/generating paint events entirely.

### The Fix: Hidden BrowserWindow

To resolve this, we pivoted to using a **hidden `BrowserWindow`** for the content source, while keeping `WebContentsView` for the UI toolbar.

**Architecture:**
-   **Main Window**: Hosts the `WebContentsView` (Toolbar + Canvas Overlay).
-   **Content Window**: A separate, hidden `BrowserWindow` configured with `offscreen: true`.
-   **Pipeline**:
    1.  Content Window renders offscreen.
    2.  `paint` events capture frames (BGRA).
    3.  Frames are sent via IPC to the Main Window's Toolbar View.
    4.  Toolbar View renders frames to the `<canvas>` overlay.

This approach provides the stability of standard Electron OSR while maintaining the custom rendering pipeline required for the foveal effect.