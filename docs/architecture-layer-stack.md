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
6.  **Upload**: `WebGLRenderer.uploadTexture` uploads the bitmap to the GPU (`u_texture`).

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

### Structure Map Encoding (RGBA)
*   **Red**: Rhythm (Line Height normalized).
*   **Green**: Density (Visual Mass).
*   **Blue**: Type (Semantic Category).
*   **Alpha**: 1.0 (Opaque).
