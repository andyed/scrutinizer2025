# Architecture Layer Stack

This document outlines the multi-process architecture of Scrutinizer 2025. The application uses a dual-window approach to separate the web content from the visual effects overlay.

## 1. Process Architecture

### Main Process (`main.js`)
*   **Role**: Orchestrator.
*   **Responsibilities**:
    *   Creates and manages `BrowserWindow` instances.
    *   Manages the application lifecycle.
    *   Routes IPC messages between the Content Layer and the Overlay Layer.
    *   Handles global shortcuts and menus.

### Content Layer (Main Window)
*   **Component**: `WebContentsView` attached to the Main Window.
*   **Role**: The "Browser". Displays the actual web page.
*   **Key Files**:
    *   `renderer/preload.js`: The bridge script injected into every web page.
    *   `renderer/dom-adapter.js`: Scans the DOM for structure data.
*   **Responsibilities**:
    *   Rendering web content.
    *   Capturing user input (Mouse, Keyboard, Scroll).
    *   Scanning the DOM for the Structure Map.

### Overlay Layer (HUD Window)
*   **Component**: Transparent `BrowserWindow` overlaying the Main Window.
*   **Role**: The "Visualizer". Renders the foveal/peripheral effects.
*   **Key Files**:
    *   `renderer/overlay.html`: The host page.
    *   `renderer/overlay.js`: Window management and IPC handling.
    *   `renderer/scrutinizer.js`: Core logic (State, Physics, Visual Memory).
    *   `renderer/webgl-renderer.js`: WebGL engine (Shaders, Textures).
    *   `renderer/structure-map.js`: Rasterizer for structure data.
*   **Properties**:
    *   `transparent: true`
    *   `clickThrough: true` (Ignores mouse events, forwards them to OS/Main Window).
    *   `alwaysOnTop`: Synced to move with the Main Window.

---

## 2. Event Flows

### A. Mouse Tracking Flow
Since the Overlay Window is click-through, it cannot natively detect mouse movement over the web content. We must capture it in the Content Layer and forward it.

1.  **Capture**: `preload.js` listens for `window.mousemove`.
2.  **Send**: `preload.js` sends `ipcRenderer.send('browser:mousemove', x, y, zoom)`.
3.  **Route**: `main.js` receives the message, finds the corresponding HUD window (by matching `webContents`), and forwards it via `win.scrutinizerHud.webContents.send('browser:mousemove', ...)`.
4.  **Receive**: `renderer/overlay.js` listens for `browser:mousemove`.
5.  **Update**: `overlay.js` calls `Scrutinizer.handleMouseMove`, which updates the internal state (`targetMouseX`, `targetMouseY`).
6.  **Render**: `Scrutinizer.render` updates `mouseX/Y` (smoothed) and passes them to `WebGLRenderer`. The Shader uses `u_mouse` for the distortion center.

### B. Structure Map Pipeline
This pipeline generates the "Structure Map" texture used for the "Wireframe" and "Simulation" modes.

1.  **Trigger**: `preload.js` detects `scroll`, `resize`, or `MutationObserver` events.
    - **Scroll Performance**: Dual-strategy approach ensures smooth tracking with ~60fps updates during scroll and accurate final position capture:
      - **Throttled scans** (16ms): Run continuously during scrolling for smooth visual tracking
      - **Debounced final scan** (100ms): Always runs after scrolling stops to capture exact final position
    - **Mutation handling**: Standard throttle (100ms) for DOM changes
2.  **Scan**: `DomAdapter.scan(document.body)` traverses the DOM and extracts `StructureBlock` objects (rect, type, density, lineHeight).
    - **Element Detection Strategy**: Uses semantic attributes instead of hardcoded tag lists:
      - **Text**: TreeWalker for text nodes (highest priority)
      - **Media**: Explicit tags (`img`, `svg`, `video`, `canvas`, `picture`, `embed`, `object`, `meter`, `progress`)
      - **Interactive**: Semantic detection via:
        - Form controls (`button`, `input`, `textarea`, `select`)
        - Links with href (`a[href]`)
        - ARIA roles (`[role="button"]`, `[role="link"]`, `[role="tab"]`, etc.)
        - Interactivity markers (`[onclick]`, `[tabindex]`, `[contenteditable]`)
    - This approach is robust to new HTML elements and modern web frameworks
3.  **Send**: `preload.js` sends `ipcRenderer.send('structure-update', blocks)`.
4.  **Route**: `main.js` forwards the data to the HUD window via `structure-update`.
5.  **Rasterize**: `Scrutinizer.handleStructureUpdate` receives the blocks and uses `StructureMap` to draw them onto an offscreen canvas (encoding data into RGBA channels at 50% resolution).
6.  **Upload**: `WebGLRenderer.uploadStructureMap` uploads the offscreen canvas to the GPU as a texture (`u_structureMap`).
7.  **Consume**: The Fragment Shader uses the texture to modulate distortion (clean whitespace) or draw wireframes.

### C. Frame Capture Loop (Visual Feed)
This loop captures the browser content to use as the source texture for the WebGL effects.

1.  **Loop**: `renderer/overlay.js` runs a self-clocking loop (`requestNextFrame`).
2.  **Request**: `overlay.js` sends `ipcRenderer.send('hud:capture:request')`.
3.  **Capture**: `main.js` calls `win.scrutinizerView.webContents.capturePage()`.
4.  **Send**: `main.js` sends the raw bitmap buffer back via `hud:frame-captured`.
5.  **Process**: `overlay.js` receives the buffer and calls `Scrutinizer.processFrame`.
6.  **Upload**:
    *   `WebGLRenderer.uploadTexture` uploads the bitmap to the GPU (`u_texture`).
    *   **Color Correction**: Electron captures are BGRA. The Fragment Shader's `sampleSource` helper handles the BGRA->RGBA swizzle centrally to ensure correct colors.

### D. Saliency Pipeline (Pixel-Based)
This pipeline generates the "Saliency Map" used to guide the user's attention (heatmaps) and modulate visual effects. It runs off the main thread to ensure 60fps rendering.

1.  **Input**: The `Scrutinizer` receives a new high-res frame from `processFrame`.
2.  **Dispatch**: The frame bitmap is cloned and posted to `saliency-worker.js`.
3.  **Process (Web Worker)**:
    - **Adaptive Scaling**: Use a target max dimension of 256px (e.g., 256x144) for consistent O(1) performance regardless of screen size.
    - **Feature Extraction**: Compute Intensity (I), Red-Green (RG), and Blue-Yellow (BY) features per pixel.
    - **Combination**: Fuse features into a single saliency scalar using pre-calculated weights (I=0.3, RG=0.35, BY=0.35).
    - **Normalization**: Normalize and apply contrast curve.
4.  **Send**: The worker transfers the processed `ImageData` back to the main thread.
5.  **Upload**:
    - `Scrutinizer` receives the data and draws it to `saliencyTargetCanvas`.
    - **Smoothing**: The render loop blends `saliencyCurrentCanvas` towards `target` over ~60 frames to remove flicker.
    - `WebGLRenderer` uploads existing smoothened canvas to the GPU (`u_saliencyMap`).

### E. WebGPU Compute Texture Synthesis (Tier 2.5)

When the active mode has `compute_tier >= 2.5`, a WebGPU compute pipeline generates texture-synthesized peripheral content alongside the MIP chain.

**Pipeline:**
1.  **Downsample**: `scrutinizer.js` downsamples the source frame to half-res CPU-side.
2.  **Upload + Dispatch**: `webgpu-crowding-compute.js` uploads to GPU, dispatches two passes (tile statistics → oriented noise synthesis).
3.  **Readback**: Async `mapAsync` copies results back to CPU (1-3 frames latency).
4.  **Upload to WebGL**: `uploadComputeTexture()` binds result to TEXTURE5.
5.  **Fragment Shader**: If `u_compute_tier > 2.0` AND `_hasComputeData`, shader blends TEXTURE5 with MIP fallback using alpha (0 at fovea, 1 at periphery).

**Gating**: Compute runs every 2nd frame (`shouldCompute()`). Resynthesis triggers on saccade landing, gaze drift beyond `fovealRadius * 2`, or `_metamerInitialized = false`.

#### Frame Synchronization Invariant

The MIP chain (TEXTURE0) is **synchronous** — `gl.texImage2D()` + `gl.generateMipmap()` complete before the draw call. TEXTURE0 always reflects the current frame.

The compute texture (TEXTURE5) is **asynchronous** — 2-5 frame latency from dispatch to readback. During this window, TEXTURE5 contains data from a previous frame.

**The invalidation pattern** prevents stale artifacts:

| Event | Action | Effect |
|-------|--------|--------|
| Navigation (`did-navigate`) | `invalidateComputeTexture()` + reset metamer state + `frameCounter = -1` | Shader falls back to MIP until fresh compute arrives |
| Scroll (`structure-update`, `trigger=scroll`) | `invalidateComputeTexture()` + `_metamerInitialized = false` | Same — MIP fallback during resynth |
| Readback complete (`.then()` callback) | `uploadComputeTexture()` sets `_hasComputeData = true` + `_metamerInitialized = false` | Shader uses fresh compute; forces another resynth next cycle for dynamic content |

`invalidateComputeTexture()` sets `_hasComputeData = false`. The shader uniform `u_compute_tier` is gated: `this._hasComputeData ? this._computeTier : 0.0`. When false, the shader ignores TEXTURE5 entirely and renders from the fresh MIP chain — the same path as mode 0.

**Design principle**: The compute texture is a **progressive enhancement**. When it's fresh, the periphery gets texture-synthesized content. When it's stale or pending, the system degrades gracefully to MIP-based rendering. The user sees clean content at all times; the metamer snaps in when available.

---

## 3. Key Data Structures

### StructureBlock
```javascript
{
    x: Number,      // Bounding box x
    y: Number,      // Bounding box y
    w: Number,      // Width
    h: Number,      // Height
    type: Number,   // 1.0=Text, 0.5=Image, 0.0=UI
    density: Number,// 0.0-1.0 (Visual mass)
    lineHeight: Number // px (For rhythm/wireframe bars)
}
```

### Visual Memory Buffer (State)
```javascript
// Array of remembered fixation points
[
    {
        x: Number,      // Canvas X
        y: Number,      // Canvas Y
        radius: Number, // Foveal radius at capture
        timestamp: Number // Time of capture
    },
    // ...
]
```

### Structure Map Encoding (RGBA)
*   **Red**: Rhythm (Line Height normalized).
*   **Green**: Density (Visual Mass).
*   **Blue**: Type (Semantic Category).
*   **Alpha**: 1.0 (Opaque).
