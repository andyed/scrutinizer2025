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

## 2. Image Loading & aspect Ratio

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
- **Solution**: You must implement a custom "Corner Resizer" in the UI.
  - Listen for drag events on a custom handle.
  - Send `{ type: 'RESIZE_UI', width, height }` to `code.ts`.
  - `code.ts` calls `figma.ui.resize(w, h)`.
- **Note**: Ensure your UI is responsive (e.g., scrollable toolbar) to handle small sizes gracefully.

## Checklist for Updates
- [ ] Port shader logic functions.
- [ ] Update uniform definitions in TS.
- [ ] Connect new uniforms in `render()`.
- [ ] Add React state/controls in `App.tsx`.
- [ ] **Check Coordinate System** (Mouse Y).
- [ ] Verify Aspect Ratio logic.
- [ ] Build & Test.
