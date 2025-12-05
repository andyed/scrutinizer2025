# Developers Guide: Peripheral Models

This guide outlines the process for implementing and testing new peripheral vision models (visual transforms) in Scrutinizer.

## Architecture Overview

Scrutinizer uses a custom WebGL renderer (`webgl-renderer.js`) to apply fragment shaders to captured browser content. The core logic resides in the fragment shader's `main` function, which determines how pixels are processed based on their distance from the fovea (mouse cursor).

### Key Components

1.  **`webgl-renderer.js`**: The main WebGL class. Contains the shader source code (`fsSource`) and handles uniform binding.
2.  **`scrutinizer.js`**: The high-level controller that manages the renderer, mouse tracking, and configuration.
3.  **`menu-template.js`**: Defines the critical application menu, including simulation settings.
4.  **`docs/architecture-module-pattern.md`**: **CRITICAL** - Explains the hybrid CommonJS/Window module pattern used to prevent `ReferenceError`s. Read this before refactoring any class files.

### 4. Visual Memory & Input Layers
Scrutinizer now supports a **Visual Memory** system. This uses a secondary texture (`u_maskTexture`) to represent areas the user has "fixated" on, which bypass distortion.

**Lesson Learned (The "Blue Tint" Incident):**
Platform-specific quirks (like Electron's `desktopCapturer` returning BGRA textures instead of RGBA) should **never** leak into the core scientific model.

**Best Practice:**
Implement a dedicated **Input Normalization** stage at the very beginning of the shader pipeline.
*   **Color Correction**: Swizzle BGRA to RGBA immediately.
*   **Coordinate Correction**: Flip Y-axis if needed.
*   **Range Normalization**: Ensure all inputs are 0.0-1.0.

This ensures that the LGN, V1, and V4 stages operate on **ideal, platform-agnostic data**. If we switch capture methods or engines later, we only update the Normalization Layer, not the visual effects.

### 5. Dual Mouse Listening Strategy
**Problem:**
Relying solely on DOM `mousemove` events fails when the cursor hovers over native UI elements (like `<select>` dropdowns), system menus, or when the main thread is blocked. This causes the fovea to "stick" or disappear.

**Solution:**
We implement a **Dual Strategy** in `main.js`:

1.  **Primary (DOM Events)**:
    *   **Source**: `ipcMain.on('browser:mousemove')` from the renderer.
    *   **Pros**: High frequency, perfectly synced with content, provides element context.
    *   **Cons**: Blocked by native UI/heavy load.
    *   **Priority**: Always preferred when available.

2.  **Fallback (Global Polling)**:
    *   **Source**: `screen.getCursorScreenPoint()` polled every 16ms in `main.js`.
    *   **Trigger**: Activates when no DOM events are received for >20ms.
    *   **Pros**: Works everywhere (system-wide), immune to DOM blocking.
    *   **Cons**: Lower fidelity, requires manual coordinate mapping.
    *   **Critical Detail**: When calculating Y-coordinate, we MUST subtract the `TOOLBAR_HEIGHT` (40px) because the visual overlay's origin is offset from the window's content origin.

## Neuro-Architecture Pipeline

The shader uses a modular architecture inspired by the human visual system to organize visual effects. While we use biological terms (LGN, V1, V4) as convenient labels for the pipeline stages, this is a **software architecture pattern**, not a rigorous biological simulation.

### The Pipeline Stages

1.  **Stage 1: LGN (Gating & Masking)**
    *   **Role**: The "Gatekeeper". Handles content analysis and signal suppression.
    *   **Function**: `processLGN`
    *   **Logic**: Determines *where* effects should be applied. It reads the Structure and Saliency maps to create a `suppressionFactor`.
    *   **Example**: "Don't distort text (High Structure Density)" or "Don't blur the fovea".

2.  **Stage 2: V1 (Geometry & Distortion)**
    *   **Role**: The "Feature Extractor". Handles geometric displacement.
    *   **Function**: `processV1`
    *   **Logic**: Determines *how* the image is warped. It uses the signal from the LGN to apply displacement.
    *   **Types**:
        *   **Noise**: Fluid, continuous distortion (e.g., Double Vision mode).
        *   **Shatter**: Blocky, discontinuous displacement (e.g., default peripheral blur).
        *   **None**: No geometric change (e.g., Blueprint mode).

3.  **Stage 3: V4 (Aesthetics & Style)**
    *   **Role**: The "Interpreter". Handles color and stylistic rendering.
    *   **Function**: `processV4`
    *   **Logic**: Determines *what* the final pixel looks like. It applies color grading, overlays, and pixel-level effects.
    *   **Examples**: High-Key ghosting, Neon colors, Wireframe overlays.

### Philosophy: Aesthetic Modes as Test Cases
In Scrutinizer, an "Aesthetic Mode" is not just a visual filter—it is a **functional test case** for the modularity of the pipeline. We encourage keeping "Work In Progress" (WIP) or experimental modes in the codebase because they often reveal missing architectural features.

*   **Double Vision (Mode 5)** is a test for **Stream Integration**. By bypassing LGN gating (`lgn_use_structure_mask = false`), it proves the pipeline can handle raw, ungated input without breaking.
*   **Blueprint (Mode 3)** is a test for **Edge Detection**. It forces V1 to use pixelated UVs (`Type 3`) and tests if V4 can run a Sobel filter on that distorted coordinate space.
*   **Cyberpunk (Mode 4)** is a test for **Variable Quantization**. It pushes the V1 block size logic to extreme limits (1200px) to verify that the coordinate system doesn't collapse at high scales.

**Guideline:** If you need to "hack" the shader to achieve a specific look, **do it**. If the hack persists, it likely means the V1 or V4 stage needs a new official capability (like a new `distortion_type` or `uniform`). Use the mode to drive the architecture, not the other way around.

### Adding a New Aesthetic Mode

To add a new mode, you no longer write a monolithic `if/else` block. Instead, you define a **Configuration** for the pipeline.

1.  **Register the Mode**: Add a new ID in `menu-template.js` (e.g., `6.0`).
2.  **Configure the Pipeline**: In `webgl-renderer.js` (inside `updateConfigFromMode`), add a configuration block:

```javascript
// Inside updateConfigFromMode(modeId)
} else if (modeId > 5.5) { // Mode 6: My New Mode
    this.config.lgn_use_structure_mask = true;  // Protect text?
    this.config.v1_distortion_type = 0;         // 0=Noise, 1=Shatter, 2=None
    this.config.v1_strength_mult = 2.0;         // Double distortion?
    this.config.v4_style_id = 6;                // Custom Style ID
}
```

3.  **Implement the Style**: In `processV4`, add the rendering logic for your `style_id`:

```glsl
if (config.v4_style_id == 6) {
    // My Custom Style
    vec3 tint = vec3(1.0, 0.5, 0.0); // Orange
    return mix(col, tint, effectFactor);
}
```

### Aesthetic Modes Reference

The following table details the rendering characteristics of each built-in mode (as of v1.2):

| Mode | Stage | Configuration / Effect |
| :--- | :--- | :--- |
| **0: High-Key** | **LGN** | **Standard**: Structure Masking + Saliency Gating |
| *(Baseline)* | **V1** | **Mongrel / Shatter**: Slow Wave Distortion (0.1Hz). *Controlled by Mongrel Mode toggle.* |
| | **V4** | **Rod Vision**: Desaturation + "Eigengrau" Blue Shift + Contrast Boost. |
| **1: Lab** | **LGN** | Standard |
| | **V1** | Same as Baseline |
| | **V4** | **Clinical**: High-contrast Grayscale + Red Overlay. |
| **2: Frosted** | **LGN** | Standard |
| | **V1** | Same as Baseline |
| | **V4** | **Privacy**: Simple Gaussian Blur (No Blue Shift/Tint). |
| **3: Wireframe** | **LGN** | Standard |
| | **V1** | **Quantized**: Pixelated UVs (Type 3). |
| | **V4** | **Gestalt**: Sobel Edge Detection on Distorted UVs (Cyan/White). |
| **4: Cyberpunk** | **LGN** | Standard |
| | **V1** | **Massive Pixelate**: Up to 1200px blocks (Type 3). |
| | **V4** | **Neon**: Progressive Contrast (1.0->2.5) + Halftone Texture. |
| **5: Double Vision** | **LGN** | **Bypassed**: No Gating (Stream Integration). |
| | **V1** | **Flowing Wave**: High-amplitude Sine Wave (Custom). |
| | **V4** | **Vibrant**: Saturation Boost + Subtle Fractal Noise. |

### Eccentricity-Based Scaling (Parafovea vs Far Periphery)

**Problem**: The 3-5° parafovea should preserve geometric cues and luminance contrast (magnocellular pathway), but applying the same distortion strength as the far periphery (>8°) destroys underlines, contrast, and low-frequency features.

**Solution**: In `processV1`, distortion strength is scaled by visual eccentricity:

```glsl
// Parafovea (3-5°): 85% reduction in strength
// Far Periphery (>8°): Full strength
float eccentricityScale = isFarPeriphery ? 1.0 : 0.15;
float strength = lgn.suppressionFactor * config.v1_strength_mult * eccentricityScale;
```

**Tuning for Research**:
- Adjust `0.15` (parafovea scale) to control how much distortion is applied in the near periphery
- Lower values (e.g., `0.05`) preserve more geometry but reduce crowding simulation
- Higher values (e.g., `0.4`) increase distortion but may destroy critical cues like underlines

Additionally, jitter amplitude is reduced in parafovea to prevent dissolution of linear features:

```glsl
float baseJitter = isParafovea ? 0.008 : 0.04; // 5x reduction
```

**Second Pass Softening (v1.2)**:
The "Shatter" mode now uses a **Slow Wave** distortion (0.1Hz sine wave) instead of random jitter to reduce motion sickness. A `sampleBlurred` helper function applies a variable Gaussian blur (up to 15px) in the periphery to replace blocky artifacts.


**Magnocellular Contrast Preservation**: In `processV4`, luminance contrast is boosted to simulate the M-cell pathway:

```glsl
// 60% in parafovea, 30% in far periphery
float contrastPreservation = dist < 1.35 * fovea_radius ? 0.6 : 0.3;
col *= mix(1.0, lumaRatio, contrastPreservation);
```

// 60% in parafovea, 30% in far periphery
float contrastPreservation = dist < 1.35 * fovea_radius ? 0.6 : 0.3;
col *= mix(1.0, lumaRatio, contrastPreservation);
```

### Performance Optimizations

#### 1. Saccadic Blindness (Saccadic Suppression)
**Problem**: Processing heavy visual effects (saliency maps, texture uploads) during rapid eye movement (saccades) causes frame drops, making the foveal "snap" feel laggy when the eye stops.

**Solution**: We implement **Saccadic Suppression** in `scrutinizer.js`.
*   **Mechanism**: We track mouse velocity. If `velocity > 2.5 px/ms`, we skip expensive operations (texture uploads, saliency updates).
*   **Result**: The system remains responsive during movement. The foveal image may briefly pause/blur (simulating biological saccadic masking), but the critical "fixation" moment is processed instantly.

#### 2. Web Worker Saliency
**Problem**: Computing saliency maps (pixel-by-pixel color analysis) on the main thread blocks the UI, causing stutter even during slow movements.

**Solution**: Saliency computation is offloaded to a **Web Worker** (`renderer/saliency-worker.js`).
*   **Tech**: Uses `OffscreenCanvas` for image resizing and `Transferable` objects (`ImageBitmap`, `ArrayBuffer`) for zero-copy data transfer.
*   **Benefit**: The main thread is never blocked by image analysis. Saliency maps update asynchronously (~4fps) without affecting the 60fps rendering loop.

## Future Roadmap: Abstraction

We plan to abstract the "Peripheral Model" into a pluggable system where shaders can be loaded dynamically or defined in separate files, making it easier to experiment with deep-learning-based texture synthesis models.

---

## Working with Texture-Based Pipelines

Scrutinizer provides auxiliary texture maps that encode semantic and perceptual information about the content. These textures can be sampled in your shader to create content-aware effects.

### Available Texture Uniforms

#### 1. Structure Map (`u_structureMap`)

**Purpose**: Encodes layout semantics (rhythm, mass, element type) for content-aware distortion.

**RGBA Channels:**
- **Red**: `lineHeight / 100.0` - Vertical rhythm of text
- **Green**: `density (0.0-1.0)` - Visual weight (font weight, image brightness)
- **Blue**: `semantics` - Element type: Text (1.0), Image (0.5), UI (0.0)
- **Alpha**: `1.0` for content, `0.0` for whitespace

**Usage Example:**
```glsl
uniform sampler2D u_structureMap;

vec4 structure = texture2D(u_structureMap, uv);
float rhythm = structure.r * 100.0; // lineHeight in pixels
float mass = structure.g;           // 0.0 = light, 1.0 = heavy
float isText = structure.b;         // 1.0 = text, 0.0 = UI

// Example: Only blur images, not text
float blurAmount = mix(0.0, 10.0, 1.0 - isText);

// Example: Distort based on visual mass
float warpStrength = mass * 5.0;
```

**Source**: Generated by `DomAdapter` (web) or `FigmaAdapter` (Figma plugin) via structure map pipeline.

#### 2. Saliency Map (`u_saliencyMap`) - *Coming Soon*

**Purpose**: Bottom-up attention map for clutter-driven distortion and creative effects.

**Channel:**
- **Red**: `saliency (0.0-1.0)` - High = distinctive features, Low = visual clutter

**Usage Example:**
```glsl
uniform sampler2D u_saliencyMap;

float saliency = texture2D(u_saliencyMap, uv).r;
float clutterStrength = 1.0 - saliency; // Inverse saliency

// Example: Crowding model - high distortion in clutter
float crowdingFactor = mix(1.0, clutterStrength, peripheralMask);
warpOffset *= crowdingFactor;

// Example: Design spotlight - emphasize high-saliency regions
vec3 glowColor = vec3(1.0, 0.8, 0.2);
vec3 spotlight = col + glowColor * saliency * 0.3;
```

**Dual Purpose:**
1. **Design Tool**: Visual emphasis layer for designers and researchers
2. **Core Simulation**: Biophysical accuracy (attention-driven distortion)

### Best Practices for Texture Sampling

**Performance:**
- Sample textures once per fragment, store in variables
- Avoid multiple `texture2D` calls with same UV

**Coordinate Spaces:**
- Structure map is in viewport space (same as `uv`)
- Distorted lookups: Use original `uv` for structure map, distorted `uv` for source image

**Combining Maps:**
```glsl
// Sample both maps
vec4 structure = texture2D(u_structureMap, uv);
float saliency = texture2D(u_saliencyMap, uv).r;

// Combine for hybrid effect
float combinedMask = structure.g * (1.0 - saliency); // Heavy, low-attention areas
float distortionStrength = combinedMask * peripheralMask;
```

### Debugging Texture Maps

Add debug visualization modes to inspect map contents:

```glsl
// Toggle via u_debug_mode uniform
if (u_debug_mode == 1.0) {
    // Visualize structure map channels
    vec4 structure = texture2D(u_structureMap, uv);
    gl_FragColor = vec4(structure.rgb, 1.0);
    return;
} else if (u_debug_mode == 2.0) {
    // Visualize saliency heatmap (Blue -> Green -> Red)
    float saliency = texture2D(u_saliencyMap, uv).r;
    vec3 heatmap = vec3(0.0);
    if (saliency < 0.5) heatmap = mix(vec3(0.0, 0.0, 1.0), vec3(0.0, 1.0, 0.0), saliency * 2.0);
    else heatmap = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), (saliency - 0.5) * 2.0);
    gl_FragColor = vec4(heatmap, 1.0);
    return;
}
```

---

## Contributing New Effects

When developing new models that use these textures:

1. **Document channel usage** in code comments
2. **Add debug modes** to visualize intermediate maps
3. **Test both web and Figma** to ensure unified pipeline works
4. **Consider performance** - texture lookups are fast, but avoid redundancy

See `ROADMAP.md` for upcoming saliency map integration details.

---

## Troubleshooting

### App won't launch / Stuck processes
If the app refuses to launch or visual effects are missing, you may have zombie Electron processes running. Run this command to kill them all:

```bash
pkill -f Electron
```

### "ipcMain is undefined" Error
If you see `TypeError: Cannot read properties of undefined (reading 'on')`, it means the environment variable `ELECTRON_RUN_AS_NODE` is set. The `npm run dev` script handles this automatically, but if you run electron directly, ensure you unset it:

```bash
unset ELECTRON_RUN_AS_NODE
```

### Checking Notarization Status

If you did not use the `--wait` flag during submission, you can check the status using the submission ID you received after the initial upload.

To check the status, use:
```bash
xcrun notarytool info "YOUR_SUBMISSION_ID" --apple-id "YOUR_APPLE_ID" --password "YOUR_APP_PASSWORD"
```

To view detailed logs, especially for rejections, use:
```bash
xcrun notarytool log "YOUR_SUBMISSION_ID" --keychain-profile "YourNotaryProfile"
```

---

## Testing

Scrutinizer includes an automated visual smoke test to ensure the renderer is functioning correctly and producing expected visual output.

### Running Tests
To run the automated tests:

```bash
npm test
```

This command launches Electron in a special test mode (`TEST_MODE=true`), which executes the test suite defined in `tests/visual-test.html`.

### Generating Screenshots
To automatically generate screenshots of every test case (useful for visual regression testing or documentation):

```bash
# Mode 1: Timestamped (Default) - Good for history, ignored by git
SAVE_SCREENSHOTS=true npm test
# OR
SCREENSHOT_MODE=date SAVE_SCREENSHOTS=true npm test

# Mode 2: Update Reference (Clean filenames) - Overwrites existing files, commit these
SCREENSHOT_MODE=update SAVE_SCREENSHOTS=true npm test
```

- **Date Mode**: Saves as `testname_TIMESTAMP.png`. These are ignored by git.
- **Update Mode**: Saves as `testname.png`. These should be committed as reference images.

### Integration Tests
To run full app integration tests (e.g., loading external sites):

```bash
# Test loading Figma.com, capturing modes 0 (Default) and 3 (Blueprint)
TEST_URL=https://www.figma.com TEST_MODES=0,3 npm start
```

**Parameters:**
- `TEST_URL`: The URL to load (Required)
- `TEST_MODES`: Comma-separated list of aesthetic modes to capture:
  - `0`: High-Key Ghosting
  - `1`: Lab Mode
  - `2`: Frosted Glass
  - `3`: Blueprint
  - `4`: Cyberpunk (Neon + Blocky)
  - `5`: Trippy (Psychedelic + Curvy)
- `TEST_RADIUS`: Override foveal radius (pixels)
- `TEST_INTENSITY`: Override peripheral intensity (0.0-1.0)
- `SCREENSHOT_MODE`: `date` (default) or `update`

**Custom Launch:**
You can also use these parameters to launch the app in a specific state without running the test loop:
```bash
TEST_URL=https://google.com TEST_RADIUS=50 npm start
```

### Test Suite

The test suite performs the following checks:

1.  **Basic Visibility**: Verifies that the renderer produces non-black pixels (i.e., the shader is compiling and drawing).
2.  **Distortion Application**: Verifies that changing the `intensity` parameter significantly alters the rendered image (ensures effects are being applied).
3.  **Motion Responsiveness**: Verifies that moving the mouse position significantly alters the rendered image (ensures the fovea is tracking).

### Adding New Tests

To add new visual tests:
1.  Open `tests/visual-test.html`.
2.  Add a new test block following the existing pattern.
3.  Use the `captureFrame()` and `compareFrames()` helpers to analyze the output.
4.  Report success/failure via `ipcRenderer.send('test-result', ...)` or throw an error.

---

## Golden Methodology (Regression Prevention)

To prevent "AI Hubris" and accidental regressions (like the "Blue Tint" or "Saliency Heatmap" incidents), we strictly adhere to a **Golden Image** workflow.

### The Philosophy
1.  **Chesterton's Fence**: Never change a visualization that looks "intentional" without checking git history first.
2.  **Visual Contracts**: We treat the current visual output as a "contract". Any change to it is a breaking change unless explicitly desired.

### The Workflow

1.  **Establish Baseline**:
    Before making *any* changes to the renderer, run the integration test to capture the current state:
    ```bash
    TEST_URL=https://www.figma.com TEST_MODES=0,saliency,structure npm start
    ```
    This saves screenshots to `tests/screenshots/`.

2.  **Verify Against Golden**:
    Compare these new screenshots against the "Golden Images" stored in `tests/golden/`.
    *   If they match: You are safe to proceed.
    *   If they differ: **STOP**. You have broken something. Revert immediately.

3.  **Intentional Changes**:
    If you are *intentionally* changing the visualization (e.g., a new aesthetic mode):
    1.  Implement the change.
    2.  Run the tests again.
    3.  Verify the new output is correct.
    4.  **Update Golden**: Copy the new screenshots to `tests/golden/` to establish the new baseline.
    ```bash
    cp tests/screenshots/*.png tests/golden/
    ```
    5.  Commit the new golden images with your code.

### Golden Artifacts
*   `tests/golden/`: Source of truth. Committed to git.
*   `tests/screenshots/`: Ephemeral test output. Ignored by git.


---

## Release & Builds

### Building for macOS
To create a signed and notarized `.dmg`:
```bash
npm run build
```
*   **Signature**: Handled automatically by `electron-builder` using Apple ID env vars.
*   **Notarization**: Handled by `scripts/notarize.js`.

### Building for Windows
To create an installer (`.exe`) and ZIP:
```bash
# 1. Install dependencies (on a Windows machine)
npm install

# 2. Build Release
npm run build:win
```
*   **Output**: `dist/Scrutinizer Setup 1.2.0.exe` (NSIS Installer) + `dist/Scrutinizer-1.2.0-win.zip`.
*   **Certificates**: Windows signing configuration is in `package.json` (`cscLink`), but typically requires a manual setup for the first run if keys are missing.
