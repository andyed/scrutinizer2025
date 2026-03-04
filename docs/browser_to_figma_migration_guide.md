# Browser to Figma Migration Guide

This guide outlines the key differences and "gotchas" when porting code from the `scrutinizer-www` (Browser/Electron) codebase to `scrutinizer-figma`.

## 1. Coordinate Systems & Mouse Tracking

### Browser (Electron/DOM)
- **Origin**: Top-Left (0,0).
- **Y-Axis**: Increases downwards.
- **Mouse Events**: `e.clientX`, `e.clientY` map directly to screen pixels.

### WebGL (Shader)
- **Origin**: Bottom-Left (usually).
- **Y-Axis**: Increases upwards.
- **Standard Practice**: Usually requires flipping `u_mouse.y = height - mouse.y`.

### **Figma Plugin (The Trap)**
In the Figma plugin `ScrutinizerEngine.ts`:
- We calculate UVs based on a "Fit" logic (Scale/Center).
- We map `v_texCoord` (0 at top-left, 1 at bottom-right if standard plane) to these UVs.
- **CRITICAL**: Unlike standard WebGL apps that might flip Y, our structure maps and image uploads in Figma often treat **Top-Left as Origin (0,0)** for textures to match the Canvas layout.
- **Solution**: **DO NOT FLIP MOUSE Y** when passing to the shader if your UVs are 0-at-Top.
  ```typescript
  // CORRECT for Figma Plugin (Top-Origin UVs)
  gl.uniform2f(this.mouseLocation, mouseX, mouseY);
  
  // INCORRECT (Causes Inverted Movement)
  gl.uniform2f(this.mouseLocation, mouseX, height - mouseY);
  ```

## 2. Image Loading & Aspect Ratio

### Browser
- Images are loaded via `<img>` tags or captured via `desktopCapturer`.
- Aspect ratio is naturally handled by the DOM or CSS `object-fit`.

### Figma Plugin
- Images normally come as raw bytes or blobs from Figma.
- **Aspect Ratio Correction**: The shader acts as the "object-fit: contain".
- You must calculate `canvasAspect` vs `imageAspect` and adjust UVs accordingly.
- **Clipping Artifacts**:
  - *Recommendation*: Use **STRICT** clipping (`if (uv < 0 || uv > 1) discard/black`).
  - *Warning*: Using `clamp()` or "relaxed" clipping can cause edge pixels to "smear" across the empty space (streaking artifacts), which looks like a graphical glitch. If you see streaks, check your clamping.
  - *Gotcha*: If the aspect ratio logic is inverted (`width/height` vs `height/width`), you will get "stretched" or "squashed" images (e.g., vertical oval fovea).

### 2.1 Fovea Radius Normalization (Browser vs Figma)

- **Browser canonical behavior** (`peripheral.frag`):
  - Foveal geometry is computed in **canvas space**, not in image-fit UV space.
  - Distance is measured on a canvas-space coordinate system that is stretched by the canvas aspect, then corrected by a fovea aspect ratio:
    ```glsl
    float aspect = u_resolution.x / u_resolution.y;

    vec2 canvas_uv = v_texCoord;                    // 0..1 in X/Y on the canvas
    vec2 uv_corrected = vec2(canvas_uv.x * aspect,  // X scaled by aspect
                              canvas_uv.y);

    vec2 mouse_uv = u_mouse / u_resolution;         // mouse in 0..1 canvas space
    vec2 mouse_corrected = vec2(mouse_uv.x * aspect,
                                mouse_uv.y);

    vec2 delta = uv_corrected - mouse_corrected;
    delta.x /= u_fovea_aspect_ratio;                // final tweak for foveal shape
    float dist = length(delta);

    float radius_norm = u_foveaRadius / u_resolution.y; // normalized by height
    float fovea_radius    = radius_norm;
    float parafovea_radius = radius_norm * 2.5;
    ```
  - **Key point**: the *distance* is in the same (aspect-stretched) units for both `dist` and `fovea_radius`, so the fovea shape is consistent on screen.

- **Figma plugin behavior (ScrutinizerEngine.ts)**:
  - Uses the **same canvas-space geometry** for fovea distance and radius as the browser shader (the snippet above is effectively mirrored in the inlined shader).
  - Separately, the plugin applies an **image-fit transform** only for *sampling* the source texture/structure map:
    ```glsl
    float canvasAspect = u_resolution.x / u_resolution.y;
    float imageAspect  = u_imageAspect;
    vec2  scale        = vec2(1.0);

    if (canvasAspect > imageAspect) scale.x = canvasAspect / imageAspect;
    else                            scale.y = imageAspect / canvasAspect;

    // uv used for sampling source/structure maps (object-fit: contain)
    vec2 uv = (v_texCoord - 0.5) * scale + 0.5;
    ```
  - **Important**: fovea geometry (distances, radii, LGN/V1 gating) is driven by **canvas UVs** (`v_texCoord`), while image content is sampled with **fit UVs** (`uv`). The two pipelines are intentionally decoupled.

- **Why this still matters in Figma**:
  - If you accidentally:
    - Compute `dist` in the **fit UV** space (after scale/letterbox), or
    - Normalize `u_foveaRadius` differently from how `dist` is measured,
    - you will re-introduce elliptical/warped fovea shapes, especially on tall/narrow plugin windows.

- **Mental model**:
  - Fovea = **circle on the plugin canvas**.
  - Image/structure maps are **pasted into that canvas** via an object-fit style transform.
  - Always ask: “Am I measuring distance in the same coordinate system (and units) as the radius I compare it to?”

- **When porting shader changes**:
  - Treat the browser `peripheral.frag` `main()` as the **source of truth**.
  - In Figma, keep the following invariants:
    - Fovea distances use **canvas UVs** (`v_texCoord`) corrected by canvas aspect and `u_fovea_aspect_ratio`.
    - Radius uses `u_foveaRadius / u_resolution.y`, just like the browser.
    - Image sampling uses the aspect-fit `uv` derived from `v_texCoord`.
  - If you see a vertically stretched fovea or watermark in Figma but not in the browser:
    - Check that the distance + radius math is still bit-for-bit aligned with the browser,
    - and that you didn’t start mixing fit-UV space into the fovea distance calculation.

## 3. Shader Porting (`peripheral.frag`)

The `ScrutinizerEngine.ts` contains an **inlined** version of `peripheral.frag`. When porting updates:
1. **Copy** the logic functions (`processLGN`, `processV1`, `processV4`, `main`).
2. **Uniforms**: Ensure all new uniforms in the browser shader are added to:
   - The shader source string in `ScrutinizerEngine.ts`.
   - The `ScrutinizerEngine` class properties (locations).
   - The `init()` lookups.
   - The `render()` method updates.
   - The `VisualizerCanvas.tsx` props bridge.
   - The `App.tsx` state and UI controls.
3. **Texture Sampling**:
   - Browser uses `texture(u_texture, uv)`.
   - Figma plugin uses `sampleSource(uv)`.
   - **Important**: Figma plugin might need to swap channels (RBGA vs BGRA) depending on how the image data was read. Currently `sampleSource` is a pass-through, but keep an eye on colors.

## 4. State Management (React vs Vanilla)

- **Browser (`scrutinizer-www`)**: Often uses vanilla JS (`app.js`) or a light framework.
- **Figma Plugin**: Uses **React**.
- **Migration**:
  - Global variables in `app.js` (e.g., `AESTHETIC_MODE`) become `useState` in `App.tsx`.
  - Event listeners (keydown) need to be attached to `window` in `useEffect`.
  - UI Controls (Dropdowns, Sliders) need to pass their values down through `VisualizerCanvas` -> `ScrutinizerEngine`.

## 5. Build Process
- **Browser**: Electron build / Webpack.
- **Figma**: Vite + `esbuild.config.js`.
- **Command**: `npm run build`
- Always verify the build after porting shader code, as syntax errors in the inlined string won't be caught by TypeScript (they typically only show up as runtime WebGL errors, so check the console!).

## 6. Critical Pitfalls & Solutions (Lessons Learned)

### The "Black Screen" / INVALID_OPERATION Error
- **Symptom**: The plugin loads, controls appear, but the canvas is black. Console shows `WebGL: INVALID_OPERATION: texImage2D: no texture bound to target`.
- **Cause**: The main texture (`this.texture`) was never initialized with `gl.createTexture()`.
- **Fix**: Ensure `this.texture = gl.createTexture()` is called in `init()`.

### Initial Load Race Condition
- **Symptom**: When opening the plugin with an image already selected, it says "Select an image" (loading fails). Selecting *another* image works fine.
- **Cause**: The plugin backend (`code.ts`) sends the `update-image` message *before* the UI (`App.tsx`) has mounted and set up its listeners. The message is lost in the void.
- **Fix**: Implement a **Handshake Protocol**.
  1. `App.tsx`: On mount -> `parent.postMessage({ pluginMessage: { type: 'UI_READY' } }, '*')`
  2. `code.ts`: Listen for `UI_READY` -> Call `handleSelection()` to send the initial image.

### Window Resizing
- **Context**: Figma plugins do not have native window chrome resizing enabled by default in the same way standard windows do.
- **Consistent UI**: The Figma plugin now matches the `scrutinizer-www` aesthetic.
- **Solution**: You must implement a custom "Corner Resizer" in the UI.
  - Listen for drag events on a custom handle.
  - Send `{ type: 'RESIZE_UI', width, height }` to `code.ts`.
  - `code.ts` calls `figma.ui.resize(w, h)`.
- **Note**: Ensure your UI is responsive (e.g., scrollable toolbar) to handle small sizes gracefully.

## Work Log

For a detailed history of changes and updates, please refer to the release notes:
- [Release Notes v1.3](../docs/release_notes_v1.3.md)
- [Release Notes v1.4](../docs/release_notes_v1.4.md)
- [Release Notes v1.4.1](../docs/release_notes_v1.4.1.md)
- [Release Notes v1.4.2](../docs/release_notes_v1.4.2.md)
- [Release Notes v1.4.3](../docs/release_notes_v1.4.3.md)

---

## v1.4.x Migration Summary

This section provides a detailed breakdown of browser features introduced in v1.4.x and their Figma migration status.

### v1.4.1: "The Lateral Smash" & Automation

| Feature | Browser Implementation | Figma Status | Notes |
| --- | --- | --- | --- |
| **Micro-Warp ("The Melter")** | High-frequency (900Hz) Simplex gradients twist letter strokes | ✅ **Port shader** | Core distortion logic in `peripheral.frag` → inline in `ScrutinizerEngine.ts` |
| **Anisotropic Crowding** | 6x horizontal distortion multiplier | ✅ **Port shader** | Critical for reading simulation; single uniform change |
| **Coupled Pooling** | MIP level linked to warp strength | ✅ **Port shader** | Prevents "sparkle" artifacts |
| **Foveal Calibration Updates** | Top-left reading position (0.2, 0.2) | ✅ **Port logic** | Update calibration defaults |
| **Automated Golden Suite** | `npm run capture-golden` pipeline | ❌ **Out** | Electron-specific; use manual Figma exports |

### v1.4.2: Face Detection & Structure Annotations

| Feature | Browser Implementation | Figma Status | Notes |
| --- | --- | --- | --- |
| **Face Detection (Saliency)** | Face-API.js Tiny Face Detector in Web Worker | ⚠️ **TBD** | Evaluate plugin bundle budget; face channel weight = 0.5 |
| **Multi-Resolution Processing** | Face @ 640px, DoG @ 256px | ⚠️ **TBD** | Port if face detection is feasible |
| **Structure Map Annotations** | Line-height pills on text blocks | ✅ **Port via Figma API** | See "Figma DOM" section below |
| **Nuclear Scramble (Tier 3)** | Grid scramble, static decay, CA suppression | ⏸️ **Deferred** | After 1.0 stability |

### v1.4.3: Performance Optimization

| Feature | Browser Implementation | Figma Status | Notes |
| --- | --- | --- | --- |
| **Splash Screen** | Lightweight `splash.html` handoff | ❌ **Out** | Figma handles plugin launch |
| **Typing Debounce** | Suspend DOM scans during input | ❌ **Out** | No live DOM in Figma |
| **Input Latency Fixes** | `requestIdleCallback` for mutations | ❌ **Out** | Electron-specific optimization |
| **Dual-Window Architecture** | Browser + HUD coordination | ❌ **Out** | Figma is single-window |
| **Purkinje Darkening (Mode 1)** | Red -> Black shadows (Biological) | ✅ **Port shader** | Critical for "Simulation Mode". Ensure `processV4` divergence logic is ported. |
| **Chromatic Pooling (Mode 0)** | Per-channel RG/YV attenuation (Usability) + Mustard Fix | ✅ **Port shader** | Spatial-frequency-dependent chromatic pooling. Use `smoothstep` for progressive fade. |
| **Safe Global Vignette** | Contrast-based dimming (not black) | ✅ **Port shader** | Prevents "Tunnel Vision" on white Figma canvas. |

---

## Figma "DOM" (Node Tree Access)

**IMPORTANT**: Contrary to earlier assumptions, Figma DOES provide DOM-like access to its node tree! This means **Structure Map Debug Annotations** are feasible in Figma.

### Available Node Properties

Via the Figma Plugin API, you can traverse `figma.currentPage.selection` or `figma.root` and access:

| Node Type | Relevant Properties | Use Case |
| --- | --- | --- |
| `TEXT` | `fontSize`, `lineHeight`, `fontName`, `characters` | Structure Map annotations, rhythm analysis |
| `FRAME` / `GROUP` | `absoluteBoundingBox`, `children`, `layoutMode` | Bounding box extraction, hierarchy |
| `RECTANGLE` / `ELLIPSE` | `absoluteBoundingBox`, `fills` | Density estimation from visual weight |
| `INSTANCE` | `mainComponent`, `overrides` | Component-aware analysis |

### Structure Map from Figma Nodes

To generate a structure map equivalent:

1. **Traverse Selection/Frame**: Walk `figma.currentPage.selection[0]` recursively
2. **Extract Text Nodes**: For each `node.type === 'TEXT'`:
   - `rect`: `node.absoluteBoundingBox` (x, y, width, height)
   - `lineHeight`: `node.lineHeight.value` (if `type === 'PIXELS'`) or compute from `fontSize * 1.2`
   - `density`: Estimate from font weight or fill opacity
   - `type`: 1.0 for text (per existing schema)
3. **Paint to Canvas**: Same `drawBlock()` logic as browser
4. **Annotations**: React overlay can render line-height pills at node positions

### Implementation Hint

In `code.ts` (Figma plugin backend):

```typescript
function extractStructureBlocks(node: SceneNode): StructureBlock[] {
  const blocks: StructureBlock[] = [];
  
  function walk(n: SceneNode) {
    if (n.type === 'TEXT') {
      const lh = n.lineHeight.unit === 'PIXELS' 
        ? n.lineHeight.value 
        : n.fontSize * 1.2;
      blocks.push({
        x: n.absoluteBoundingBox.x,
        y: n.absoluteBoundingBox.y,
        w: n.absoluteBoundingBox.width,
        h: n.absoluteBoundingBox.height,
        type: 1.0,
        density: 0.5, // TODO: derive from fontWeight
        lineHeight: lh
      });
    }
    if ('children' in n) {
      n.children.forEach(walk);
    }
  }
  
  walk(node);
  return blocks;
}
```

---

## Checklist for Updates

### Per-Feature Porting Checklist
- [ ] **Identify shader changes** in `peripheral.frag` since last sync
- [ ] **Port shader logic functions** (`processLGN`, `processV1`, `processV4`, `main`)
- [ ] **Update uniform definitions** in TypeScript (`ScrutinizerEngine.ts`)
- [ ] **Connect new uniforms** in `render()` method
- [ ] **Add React state/controls** in `App.tsx` + `VisualizerCanvas.tsx` bridge
- [ ] **Check Coordinate System** (no mouse-Y flip in Figma!)
- [ ] **Verify Aspect Ratio logic** (canvas-UV for fovea, fit-UV for sampling)
- [ ] **Build & Test** (check console for WebGL errors—shader bugs only show at runtime!)

### v1.4.x Specific Checklist
- [x] Port Tier 1.8.1 "Lateral Smash" distortion (anisotropic 6x horizontal crowding, micro-warp 900Hz)
- [x] Port MIP-based pooling (replaces 5-tap blur with hardware MIP-maps)
- [x] ~~Port coupled MIP+warp~~ → **Decoupled for Figma** (see note below)
- [x] Port smooth eccentricity ramp (fixes parafovea/periphery ring artifact)
- [x] Port Mode 3 radial grid debug overlay (exponential rings + spokes)
- [x] Enable MIP-map generation in texture upload
- [x] **Figma MIP Adaptation**: Uses raw eccentricity instead of `v1.distortionStrength` for MIP level calculation.
  - **Why decoupled?** Browser version uses coupled `v1.distortionStrength * u_intensity * fovea_radius * blurMult`, but in Figma:
    1. No `u_blurRadius` uniform (no Hunt/Gather saccadic modes)
    2. `v1.distortionStrength` is low (~0.15-0.5) because Figma's distortion is subtle
    3. This resulted in near-zero MIP levels, making blur invisible
  - **Figma solution**: Use `eccentricity * blurMult` (blurMult=6.0, mipScaling=6.0, maxMipLevel=5.0)
  - **Trade-off**: Blur is no longer suppressed by saliency/density, but visible blur is P0 for Figma v1.4
- [x] Port foveal calibration defaults
- [ ] Evaluate Face-API.js bundle size for Figma
- [x] ~~Implement `extractStructureBlocks()` for Figma node tree~~ → **Done** via `FigmaAdapter.scan()`
- [ ] Add line-height annotation overlay in React
- [ ] Update golden compare workflow for v1.4.x parity testing

### Figma Specific Tuning (Lateral Smash - "Crunchy/Dry")
Unlike the browser version which balances blur and distortion, the Figma plugin targets a "Crunchy" text-heavy aesthetic due to static image rendering.
- **Tuning Values**:
  - `micro-warp`: **0.008** (Strength) @ **900Hz** (Frequency) - Creates fine-grain text melting.
  - `macro-wobble`: **0.005** (Very Low) - Keeps text lines straight to maintain readability.
  - `horizontal-bias`: **10.0** (Extreme) - Smashes letters horizontally ("Anisotropic Crowding").
  - `blurMult`: **0.0** - **Crucial**. MIP blur is disabled to prevent "underwater/glow" look. The effect relies purely on geometric distortion.
  - `grain`: **0.0** - No static noise.

### Lessons Learned: The "No Change" Trap
During the "Lateral Smash" migration, we encountered a persistent issue where distortion appeared inactive ("No Change").
1.  **Structure Mask Suppression**: The `u_has_structure` uniform was true (blank texture uploaded), but the texture was empty. The shader interpreted this as "all whitespace" and masked the distortion to 0.0.
    - **Fix**: Permanently disable `lgn_use_structure_mask` (0.0) in Figma shader config, or implement robust "Clear Texture" logic in App.tsx.
2.  **Vertical Flattening**: Missing `u_fovea_aspect_ratio` caused `uv_lateral.x` to multiply by 0, resulting in 1D vertical noise (straight text).
    - **Fix**: Hardcode `1.33` or ensure robust prop passing.
3.  **UV Artifacts**: High distortion strength pushed UVs < 0 or > 1. Without clamping, this caused edge streaking or "leopard print" artifacts.
    - **Fix**: Add `clamp(uv, 0.005, 0.995)` to all texture samplers (tighter margin than 0.001).
4.  **MIP Edge Sampling (v1.4.x)**: Even with clamped UVs, high MIP levels sample a wider footprint via hardware texture filtering. Near image edges (especially with aspect ratio letterboxing), this caused "leopard spots" as the MIP blur picked up the black canvas border.
    - **Fix**: Edge-aware MIP clamping in `sampleMIPPooled()`. Progressively reduce MIP level to 0 as sample position approaches the edge: `mipLevel *= smoothstep(0.0, edgeMargin, edgeDist)` where `edgeMargin = 0.15 + mipLevel * 0.03`.
    - **Fix (Preferred)**: Enable `ENABLE_AUTO_TRIM` in `App.tsx`. Auto-resizes the plugin window on image load to match the image aspect ratio, eliminating black letterbox bars entirely. This is the root-cause fix.

## Future Work / Retro
This migration highlighted the difficulty of manually porting complex shader logic and state management from Vanilla/Electron to React/Figma.
- **Goal**: Abstract the core visual model (shader + physics) into a framework-agnostic library (`@scrutinizer/core`) shared by both apps.
- **Documentation**: We need to perform a deeper audit of the browser "latest flows" and verify they are accurately reflected here before the next major feature push. This was the "2nd migration attempt gone south" due to drift between codebases.

---

## Feature Parity (Browser → Figma 1.0)

Visual fidelity is P0. Target parity for the core simulation; defer browser-only or non-applicable items.

| Feature area | Browser state (current) | Figma 1.0 plan | Notes |
| --- | --- | --- | --- |
| Core peripheral renderer | MIP-based pooling (Tier 1), coupled warp + MIP (Tier 1.5), Unbound Color (Tier 1.6), **Tier 1.8.1 Lateral Smash** | ✅ **Parity (v1.4)**. MIP pooling, Lateral Smash (6x anisotropic + 900Hz micro-warp), coupled eccentricity, smooth transitions. | Canvas-UV for fovea; aspect-fit for sampling. No mouse-Y flip. |
| Saliency map | Oklab saliency + face-channel weighting (Tiny Face Detector, worker) | **Planned parity** if worker/Face-API deps fit plugin budget; fallback to Oklab-only if not. | Verify worker bundling and model size; keep Oklab even without faces. |
| Visual overlay | Radial grid (Fovea + Parafovea + Periphery), variable stroke, linear spacing | **Ship parity** via React overlay layer. | Should not depend on DOM scanning; keep responsive to plugin resize. |
| Visual memory | Inhibition of Return (10 fixations) | **Planned parity**; needs UI control + state in React. | Mirror browser defaults and decay timing. |
| Structure map debug annotations | Text line-height pills on DOM elements | ✅ **Done** via `FigmaAdapter.scan()` | Extracts TEXT/IMAGE/UI from Figma node tree |
| Nuclear Scramble (Tier 3) | Scramble grid, CA suppression | **Deferred** until after 1.0 once core parity is stable. | Add only if performance budget allows. |
| Auto-update / dual-window / splash | Electron-only behaviors | **Out** for Figma. | Figma handles hosting/launch. |
| Aesthetic modes | Multiple visual themes | **Deferred** (v1.4); not exposed in Figma UX. | Shader supports v4_style_id but UI hidden. |
| Visual memory modes | Inhibition of Return, memory mask | **Deferred** (v1.4); not yet ported. | u_useMask paths not wired in Figma. |
| Linguistic pre-attentive layer | Spec only (v2) | **Future**; not in 1.0 scope. | Requires ONNX/WebGPU; re-evaluate later. |

### Acceptance for Figma 1.0 P0
- Canvas output visually matches browser for core pipeline (peripheral renderer + grid overlay) via golden compare (same image input, same params).
- Saliency heatmap matches browser within tolerance when enabled; if face channel is excluded, document the gap.
- UI controls exist for all shipped features (radius, intensity, warp, color bleed, saliency toggle, visual memory toggle) and correctly drive uniforms.
- Non-applicable browser features are explicitly marked as out-of-scope in UI/docs (no dead toggles).

## Golden Visual Compare Plan (Browser ↔ Figma)

Goal: prove P0 visual fidelity by comparing identical inputs/params across browser and Figma builds.

### Test Matrix
- View sizes: Small (640x480), Medium (1280x800), Tall (900x1400) to expose aspect/stretch issues.
- Inputs: 
  - High-contrast UI (Figma UI screenshot),
  - Text-heavy page (long-form article),
  - Face-rich scene (portraits) if saliency face channel enabled,
  - Low-contrast scene (pastel UI) to catch banding.
- Feature toggles: Base renderer on/off overlays; Saliency on/off; Visual memory on/off; Warp/Color bleed min/med/max; MIP intensity min/med/max.

### Procedure
1) Browser: load image, set params, capture canvas (PNG) with consistent seed/focus.
2) Figma: same image & params, capture canvas export.
3) Compare: pixel diff (SSIM/PSNR) + visual eyeball. Log seed, params, viewport.

### Tolerances / Pass Criteria
- Core renderer (no saliency, no memory): SSIM ≥ 0.98; no visible fovea stretch; ring spacing matches overlay.
- Saliency: heatmap alignment and relative intensities match; if faces disabled in Figma, note expected gap.
- Visual memory: suppression zones match positions and strength after identical fixation script.
- No unexpected clipping/smear at letterbox edges; mouse Y direction correct.

### Capture Tooling
- Prefer deterministic captures (fixed random seeds, deterministic mouse/fixation scripts).
- Save pairs under `docs/golden/browser/<case>.png` and `docs/golden/figma/<case>.png`; store params in adjacent JSON.
