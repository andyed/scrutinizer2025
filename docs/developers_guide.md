# Developers Guide: Peripheral Models

This guide outlines the process for implementing and testing new peripheral vision models (visual transforms) in Scrutinizer.

> [!TIP]
> **Extensibility by Design**: Scrutinizer's pipeline is intentionally modular. Aesthetic modes are not just visual filters—they are **functional test cases** that validate the architecture. If you need to "hack" the shader to achieve a look, that hack often reveals a missing capability that should become an official feature.

## Architecture Overview

Scrutinizer uses a custom WebGL renderer (`webgl-renderer.js`) to apply fragment shaders to captured browser content. The core logic resides in the fragment shader's `main` function, which determines how pixels are processed based on their distance from the fovea (mouse cursor).

### Key Components

1.  **`webgl-renderer.js`**: The main WebGL class. Loads shaders from `renderer/shaders/` and handles uniform binding.
2.  **`scrutinizer.js`**: The **Pipeline Orchestrator** — a thin controller (~535 lines) that wires together the extracted domain modules (see below) and manages the render loop.
3.  **`gaze-model.js`**: **Oculomotor System Proxy** — velocity tracking, fixation detection, saccadic suppression, hysteresis smoothing.
4.  **`visual-memory.js`**: **Visuospatial Working Memory** — fixation buffer, mask rendering, memory decay.
5.  **`content-analysis.js`**: **Pre-Cortical Feature Extraction** — structure map scanning, saliency computation, DOM observation.
6.  **`menu-template.js`**: Defines the critical application menu, including simulation settings.
7.  **`docs/architecture-module-pattern.md`**: **CRITICAL** - Explains the hybrid CommonJS/Window module pattern used to prevent `ReferenceError`s. Read this before refactoring any class files.
8.  **`docs/coordinate_systems.md`**: **CRITICAL** - Explains the complex mapping between Screen, Window, WebGL, and SVG coordinate spaces. Read this if overlays are drifting or jumping.

> **Note (v1.6)**: `scrutinizer.js` was de-monolithed from a 969-line single file into the three domain modules above. Backward-compatible property proxies preserve access patterns for test HTML files and `overlay.js`.

### Module Dependency Graph (v1.6)

```
overlay.js
  └─→ scrutinizer.js (Pipeline Orchestrator, ~535 lines)
        ├─→ gaze-model.js (Oculomotor System, ~166 lines)
        │     └── Tracks mouse/gaze velocity, fixation vs saccade state
        │     └── Swappable: mouse proxy → eye tracker (Tobii, WebGazer)
        │
        ├─→ visual-memory.js (Visuospatial Sketchpad, ~254 lines)
        │     └── Records fixation locations with dwell-time gating
        │     └── Renders soft mask texture (u_maskTexture) for distortion bypass
        │     └── Time-decay & inhibition of return
        │
        ├─→ content-analysis.js (Pre-Cortical Feature Extraction, ~356 lines)
        │     ├── structure-map.js → DOM scanning → u_structureMap
        │     ├── gestalt-processor.js → Proximity/similarity grouping
        │     └── color-saliency-map.js → Chromatic attention → u_saliencyMap
        │
        └─→ webgl-renderer.js (WebGL2 Pipeline)
              └── peripheral.frag (LGN → V1 → V4 shader stages)
```

**Design principles:**
- Each module maps to a distinct biological subsystem (oculomotor, working memory, pre-cortical)
- Modules communicate via the orchestrator, not directly with each other
- `scrutinizer.js` exposes backward-compatible property proxies (e.g., `this.velocity` delegates to `this.gazeModel.velocity`) so existing callers (`overlay.js`, test harnesses) don't need changes
- Each module is independently testable — see `tests/unit/` for 120 tests across pure-function modules

**Swapping a module:** To replace the gaze input (e.g., eye tracker instead of mouse), implement the same interface as `GazeModel` (`update(mouseX, mouseY, timestamp)`, `getPosition()`, `getVelocity()`, `isSaccade()`) and inject it in the orchestrator constructor.

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

3.  **Debug Visualization Principles**:
    *   **NO Foveation**: Debug views should *never* exhibit foveal distortion or blur. The background must be the clean, undistorted source image (`sampleSource`).
    *   **Raw Data Only**: Debug overlays (Saliency, Structure) must visualize the **Raw Input Texture**, bypassing all LGN gating, inhibition, and visual memory logic.
    *   **Goal**: The debug view answers "What does the scanner see?", not "What does the user perceive?".

### 5. Dual Mouse Listening Strategy
**Problem**:
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

### 6. HUD Display Layer Stack (v1.4.2)

The HUD overlay window (`overlay.html`) uses a z-indexed layer stack for rendering. Understanding this is critical when adding new overlays:

| Layer | Element | z-index | Purpose |
| :--- | :--- | :---: | :--- |
| **Base** | `#overlay-canvas` | 100 | WebGL canvas for foveation/effects |
| **Debug SVG** | `#debug-overlay` | 101 | Vector overlays (fovea ring, radial grid) |
| **Annotations** | `#structure-annotations` | 102 | DOM text labels (lineHeight annotations) |

**Key Points:**
- All layers are `position: fixed` and `pointer-events: none`
- Canvas is set to `display: none` initially (enabled by Scrutinizer)
- SVG overlay is managed by `svg-overlay.js` (Group Translation pattern)
- Structure annotations are dynamically populated by `scrutinizer.js` when Structure Map debug is enabled

**Adding a New Overlay:**
1. Add a new container element in `overlay.html` with appropriate z-index
2. Manage visibility in `scrutinizer.js` (show/hide on toggle)
3. Populate content in response to data updates or user interaction

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
        *   **Noise (0)**: Fluid, continuous distortion with animation. Used by Double Vision mode.
        *   **Shatter (1)**: Slow wave distortion (legacy "Mongrel Approximation"). Used by default modes.
        *   **None (2)**: No geometric change. Used by Blueprint mode.
        *   **Pixelate (3)**: CMF-driven block quantization. Used by Minecraft/Wireframe.

3.  **Stage 3: V4 (Aesthetics & Style)**
    *   **Role**: The "Interpreter". Handles color, pooling, and stylistic rendering.
    *   **Function**: `processV4`
    *   **Logic**: Determines *what* the final pixel looks like. Includes peripheral spatial filtering and aesthetic processing.
    *   **Key Feature (v1.4)**: Hardware MIP-map sampling simulates biological receptive field growth.
    *   **Key Feature (v1.6)**: **DoG Band Decomposition** — decomposes MIP chain into approximate Laplacian pyramid bands (box/bilinear, not true Gaussian) with per-band M-scaling rolloff. Preserves low-frequency structure (layout, buttons) while filtering high-frequency detail (serifs, fine textures). Gated by `dog_enabled` uniform. See `foveated-vision-model.md` Section 5.1.
    *   **Examples**: High-Key ghosting, Neon colors, Wireframe overlays.

### Philosophy: Aesthetic Modes as Test Cases
In Scrutinizer, an "Aesthetic Mode" is not just a visual filter—it is a **functional test case** for the modularity of the pipeline. We encourage keeping "Work In Progress" (WIP) or experimental modes in the codebase because they often reveal missing architectural features.

*   **Double Vision (Mode 5)** is a test for **Stream Integration**. By bypassing LGN gating (`lgn_use_structure_mask = false`), it proves the pipeline can handle raw, ungated input without breaking.
*   **Blueprint (Mode 3)** is a test for **Edge Detection**. It forces V1 to use pixelated UVs (`Type 3`) and tests if V4 can run a Sobel filter on that distorted coordinate space.
*   **Minecraft (Mode 4)** is a test for **CMF Block Sizing**. Blocks sized to MIP level at each eccentricity (4-64px) with channel-independent neighbor averaging in Oklab. Demonstrates customizing the baseline — same CMF math, visible as block geometry.

**Guideline:** If you need to "hack" the shader to achieve a specific look, **do it**. If the hack persists, it likely means the V1 or V4 stage needs a new official capability (like a new `distortion_type` or `uniform`). Use the mode to drive the architecture, not the other way around.

### Adding a New Aesthetic Mode

Modes are now defined declaratively in `shared/modes.json`. This eliminates magic numbers and makes mode configuration self-documenting.

#### Step 1: Define the Mode in `modes.json`

Add a new entry to the `modes` object:

```json
{
    "my_new_mode": {
        "id": 6,
        "label": "My New Mode",
        "shortLabel": "NewMode",
        "category": "research",
        "description": "Description of what this mode simulates or demonstrates.",
        "pipeline": {
            "lgn_use_structure_mask": true,
            "lgn_use_saliency_gate": true,
            "lgn_ramp_end_mult": 2.5,
            "v1_distortion_type": 0,
            "v1_strength_mult": 2.0,
            "v1_animate": false,
            "v4_style_id": 6,
            "dog_enabled": false,
            "dog_e2": 2.5,
            "dog_sharpness": 0.0
        },
        "tests": ["what_this_mode_tests"],
        "architectural_purpose": "Why this mode exists as a stress-test",
        "citations": {
            "technique": "Academic reference for the technique",
            "biological_basis": "The science behind it"
        }
    }
}
```

#### Step 2: Add Menu Item in `menu-template.js`

```javascript
{
    label: 'My New Mode',
    type: 'radio',
    click: () => sendToOverlays('menu:set-aesthetic-mode', 6)
}
```

#### Step 3: Implement V4 Style in `peripheral.frag`

Add rendering logic in the `processV4` function:

```glsl
} else if (config.v4_style_id == 6) { // My New Mode
    // Custom style logic
    vec3 tint = vec3(1.0, 0.5, 0.0); // Orange
    return mix(col, tint, effectFactor);
}
```

#### Mode Registry Reference

The full mode registry lives in `shared/modes.json` and includes:
- **Pipeline configuration** (LGN, V1, V4 parameters)
- **Test cases** (what architectural capability this mode validates)
- **Citation metadata** (academic references embedded in exports)

### Aesthetic Modes Reference

The following table details the rendering characteristics of each built-in mode (as of v1.4):

| Mode | Stage | Configuration / Effect |
| :--- | :--- | :--- |
| **0: High-Key** | **LGN** | **Standard**: Structure Masking + Saliency Gating |
| *(Usability)* | **V1** | **Slow Wave**: 0.1Hz sine warp (Type 1). |
| | **V4** | **DoG Reconstruction** (E2=0.5): Preserves layout structure. **Chromatic Pooling**: Per-channel RG/YV attenuation (castleCSF + suprathreshold correction). **High-Key**: Mixed with Eigengrau for usability. |
| **1: Biological** | **LGN** | Standard |
| *(Purkinje)* | **V1** | Same as Baseline |
| | **V4** | **DoG Reconstruction** (E2=0.4, more aggressive): Preserves layout structure. **Purkinje Shift**: Red -> Black shadows. **Optical Vignette**: Contrast dimming at edges. |
| **2: Frosted** | **LGN** | Standard |
| | **V1** | Same as Baseline |
| | **V4** | **MIP Pooling** + Privacy blur (No Blue Shift). |
| **3: Wireframe** | **LGN** | Standard |
| | **V1** | **Quantized**: Pixelated UVs (Type 3). |
| | **V4** | **Gestalt**: Sobel Edge Detection on Distorted UVs (Cyan/White). |
| **4: Minecraft** | **LGN** | Standard |
| | **V1** | **CMF Block Sizing**: Blocks sized to MIP level (4-64px), fovea-relative grid (Type 3). |
| | **V4** | **Block Pooling**: Channel-independent neighbor averaging in Oklab + grid lines. |
| **5: Double Vision** | **LGN** | **Bypassed**: No Gating (Stream Integration). |
| | **V1** | **Flowing Wave**: High-amplitude animated sine wave (Type 0). |
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
- eccentricityScale ramps from 0.0 (inner parafovea, at 1.5× fovea_radius) to 0.15 (outer parafovea boundary) via smoothstep, then 0.15→1.0 into far periphery
- The 0.15 ceiling controls maximum parafoveal distortion — lower values preserve more geometry but reduce crowding simulation; higher values increase distortion but may destroy critical cues like underlines
- MIP pooling blend completes at 0.5× fovea_radius past the fovea edge (~75px) — adjust to control how quickly the sharp foveal sample fades

Additionally, jitter amplitude is reduced in parafovea to prevent dissolution of linear features:

```glsl
float baseJitter = isParafovea ? 0.008 : 0.04; // 5x reduction
```

**Second Pass Softening (v1.2)**:
The "Shatter" mode now uses a **Slow Wave** distortion (0.1Hz sine wave) instead of random jitter to reduce motion sickness.

**MIP-Based Pooling (v1.4, legacy)**:
The V4 stage uses **hardware MIP-maps** to simulate receptive field growth in the periphery:

```glsl
// Calculate MIP level based on eccentricity
float normalizedEcc = max(0.0, eccentricity) / fovea_radius;
float mipScaling = 2.5; // Tune: higher = faster pooling growth
float mipLevel = clamp(normalizedEcc * mipScaling, 0.0, 4.0);

// Sample using textureLod
vec4 pooled = textureLod(u_texture, uv, mipLevel);
```

**Benefits over previous blur approach:**
- True spatial averaging (not weighted samples)
- Hardware-accelerated (~0.1ms vs ~0.5ms)
- Biologically accurate receptive field doubling per MIP level

**DoG Band Decomposition (v1.6, replaces simple MIP in research modes)**:
The simple MIP approach uniformly blurs all spatial frequencies together. The DoG upgrade decomposes the same hardware MIP chain into an approximate Laplacian pyramid (hardware mipmaps use box/bilinear filtering, not Gaussian convolution, so band isolation has some spectral leakage) and attenuates each frequency band independently based on eccentricity (M-scaling). This preserves low-frequency structure (buttons, layout blocks) while filtering high-frequency detail (serifs, thin strokes).

```glsl
// 8 half-octave DoG bands from 9 MIP levels (LOD 0.0 to 4.0 in 0.5 steps)
vec4 band[8];
band[0] = mip[0] - mip[1];  // ~5.66 cpd: serifs
band[1] = mip[1] - mip[2];  // ~4.0 cpd:  thin strokes
// ... band[2] through band[7] at √2-spaced frequencies down to 0.5 cpd
// Per-band smoothstep rolloff: cutoff_k = E2 × (2^(k/2) - 1)
result = mip[8]; // residual (DC, always preserved)
for (int k = 0; k < 8; k++) { result += band[k] * w[k]; }
```

Controlled by three `modes.json` fields: `dog_enabled`, `dog_e2`, `dog_sharpness`. See `foveated-vision-model.md` Section 5.1 for full details.

**WebGL2 Requirements:**
```javascript
// Texture setup for MIP pooling
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);

// Generate MIP chain on each frame upload
gl.generateMipmap(gl.TEXTURE_2D);
```


**Magnocellular Contrast Preservation**: In `processV4`, luminance contrast is boosted to simulate the M-cell pathway:

```glsl
// 60% in parafovea, 30% in far periphery
float contrastPreservation = dist < 1.35 * fovea_radius ? 0.6 : 0.3;
col *= mix(1.0, lumaRatio, contrastPreservation);
```

### Performance Optimizations

#### 1. Saccadic Suppression (Performance Skip)
**Problem**: Processing heavy visual effects (saliency maps, texture uploads) during rapid eye movement (saccades) causes frame drops, making the foveal "snap" feel laggy when the eye stops.

**Solution**: We implement **Saccadic Suppression** in `scrutinizer.js`.
*   **Mechanism**: We track mouse velocity via `GazeModel`. If `velocity > 2.5 px/ms`, we skip the entire `processFrame()` render cycle.
*   **Exception**: When **Saccadic Blindness** is enabled (menu toggle), the performance skip is bypassed so the shader can render the fovea-shrink effect at high velocities.
*   **Result**: The system remains responsive during movement. The foveal image may briefly pause (simulating biological saccadic masking), but the critical "fixation" moment is processed instantly.

#### 1b. Saccadic Blindness (v1.9 — Shader Feature)
**Problem**: The performance skip above produces a frozen frame during fast movement, but doesn't simulate the biological reality: during a saccade, foveal processing is actively suppressed.

**Solution**: The shader shrinks `fovea_radius` and `parafovea_radius` proportionally to velocity via `smoothstep(4.0, 10.0, u_velocity)`. At 10+ px/ms, the fovea collapses to near-zero — the entire viewport renders as periphery.
*   **Menu**: Simulation → Saccadic Blindness (checkbox, off by default)
*   **Files**: `peripheral.frag`, `peripheral.frag` (uniform + fovea shrink), `webgl-renderer.js` (uniform binding), `scrutinizer.js` (`toggleSaccadicBlindness()` + suppression bypass)
*   **Limitation**: Mouse velocity is a noisy proxy for saccadic state. Real saccades are ballistic (200-500°/s, 30-80ms). The velocity thresholds are tuned for visual effect, not biological fidelity.

#### 1c. Velocity-Gated Metamer Freeze (v2.3.1)
**Problem**: The WebGPU compute metamer (Tier 2.5) resynthesizes oriented noise every 2nd frame. The noise is spatially deterministic (`hash21(px)`), but synthesis depends on gaze position — when gaze shifts, tile eccentricities change, producing a visibly different peripheral texture. During slow mouse movement this creates shimmer in the frequency band the peripheral magnocellular pathway detects (high temporal, low spatial). The tool generates false peripheral salience.

**Biology**: During fixation and smooth pursuit, the peripheral representation is **stable**. During saccades, visual processing is **suppressed** and the representation is rebuilt at landing (Sperry 1950, Burr 1994).

**Solution**: The compute dispatch in `scrutinizer.js` is gated by velocity state:
*   **Saccade landing detection**: Velocity crosses above `saccadicSuppressionThreshold` (2.5 px/ms) then drops below → `saccadeLanded = true` → resynthesize.
*   **Drift safety valve**: If gaze moves > 2× `fovealRadius` from last synthesis position, force resynthesis regardless of velocity. Handles sustained smooth pursuit that slowly accumulates displacement.
*   **First frame**: Always synthesize on initialization (`_metamerInitialized` flag).
*   **During fixation/pursuit**: Compute dispatch is skipped entirely — the last synthesized texture persists in TEXTURE5. The fragment shader's eccentricity ramp continues blending it smoothly.

**State fields** (initialized in constructor):
```javascript
this._metamerSaccading = false;     // true while velocity > threshold
this._metamerInitialized = false;   // first-frame gate
this._lastSynthGazeX = 0;          // half-res gaze at last synthesis
this._lastSynthGazeY = 0;
```

**Performance benefit**: Compute dispatch drops from every-2nd-frame to only on saccade landing or drift exceeded — measurable GPU reduction during reading/browsing. The `shouldCompute()` frame-skip in `webgpu-crowding-compute.js` remains as a secondary pacing gate (both conditions are `&&`-conjoined on the dispatch line). The saccade-landing flag is cleared *inside* the dispatch block so it persists across frame-skip frames.

**Saccade tracking and early return**: The `_metamerSaccading` flag is set *above* the saccadic suppression early return in `processFrame()`, so it tracks velocity even when the rest of the frame is skipped. This ensures saccade landing is detected on the first frame after velocity drops.

**Why no cross-dissolve**: The fragment shader already blends the compute texture with a smooth eccentricity ramp. The foveal region always shows original source; the compute texture only appears in the periphery where change detection is poor. Hard swap during saccade landing is invisible (saccadic suppression). Hard swap from drift exceeded happens after sustained pursuit — the boundary texture is low-resolution enough that the swap is below perceptual threshold.

#### 2. Web Worker Saliency
**Problem**: Computing saliency maps (pixel-by-pixel color analysis) on the main thread blocks the UI, causing stutter even during slow movements.

**Solution**: Saliency computation is offloaded to a **Web Worker** (`renderer/saliency-worker.js`).
*   **Tech**: Uses `OffscreenCanvas` for image resizing and `Transferable` objects (`ImageBitmap`, `ArrayBuffer`) for zero-copy data transfer.
*   **Benefit**: The main thread is never blocked by image analysis. Saliency maps update asynchronously (~4fps) without affecting the 60fps rendering loop.

#### 3. Multi-Resolution Processing (v1.4.2)
**Problem**: Small faces require higher resolution for reliable detection, but running the full saliency pipeline at high resolution is expensive.

**Solution**: The saliency worker uses **separate resolutions** for different tasks:

| Task | Max Dimension | Purpose |
|------|---------------|---------|
| **Saliency (DoG)** | 256px | Edges, contrast, color opposition |
| **Face Detection** | 640px | Reliable detection of small faces |

```javascript
// renderer/saliency-worker.js
const SALIENCY_MAX_DIM = 256;      // Fast: O(n²) pixel processing
const FACE_DETECT_MAX_DIM = 640;   // Accurate: Tiny Face Detector needs resolution
```

**Coordinate Mapping**: Face bounding boxes are detected in "Face Space" (640px) and mapped to "Saliency Space" (256px) before drawing the Gaussian blob:

```javascript
const scaleFactor = width / fWidth;  // 256 / 640
const scaledBox = {
    x: face.box.x * scaleFactor,
    y: face.box.y * scaleFactor,
    width: face.box.width * scaleFactor,
    height: face.box.height * scaleFactor
};
```

**Reuse Opportunity**: If other features (e.g., text detection, logo detection) need higher resolution, they can share the 640px canvas created for face detection.

### 4. UI Protection (Scrollbars)
**Problem**: Applying heavy geometric distortion (like the "Shatter" or "Double Vision" modes) to the entire window renders the native scrollbar unusable, as the user cannot accurately target the thumb or track.

**Solution**: The shader pipeline includes a hard **Scrollbar Override** controlled by the `u_scrollbarWidth` uniform (default: 20px).

*   **Logic**: This check occurs at the very end of the fragment shader. If `pixel_x > window_width - scrollbar_width`, we force the output to be the clean, undistorted source image (`sampleSource`).
*   **Robustness**: This overrides ALL other effects (LGN inhibition, V1 distortion, V4 styling, Visual Memory).
*   **Uniforms**:
    *   `u_scrollbarWidth`: Float, pixel width from right edge (configurable in `scrutinizer.js`).

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

## Citation-Ready Image Exports

All screenshots captured via the golden capture system (`npm run capture-golden`) automatically include embedded metadata for academic reproducibility.

### Embedded Metadata Fields

| Field | Example | Purpose |
|-------|---------|---------|
| `Scrutinizer:Version` | `1.4.5` | Software version |
| `Scrutinizer:Mode` | `Blueprint (Gestalt)` | Human-readable mode name |
| `Scrutinizer:ModeId` | `3` | Numeric mode ID |
| `Scrutinizer:FoveaRadius` | `180` | Foveal radius in pixels |
| `Scrutinizer:DegradationStrength` | `0.6` | Peripheral degradation strength (Reference = 0.6) |
| `Scrutinizer:URL` | `https://...` | Source page URL |
| `Scrutinizer:Timestamp` | `2026-01-19T...` | Capture timestamp |
| `Scrutinizer:CiteAs` | `Scrutinizer v1.4.5, Blueprint Mode (Captured 2026-01-19)` | Citation string |
| `Scrutinizer:Pipeline` | `{"lgn_use_structure_mask":true,...}` | Full pipeline config (JSON) |

### Extracting Metadata

```bash
# Using exiftool (macOS: brew install exiftool)
exiftool screenshot.png | grep Scrutinizer

# Using the built-in extractor (Node.js)
node -e "require('./renderer/citation-export').extractMetadata('test.png').then(m => console.log(m))"
```

### Programmatic Usage

```javascript
const { embedMetadata, extractMetadata, generateCitation } = require('./renderer/citation-export');

// Embed metadata into a PNG buffer
const annotatedBuffer = await embedMetadata(rawPngBuffer, {
    modeId: 3,
    modeName: 'Blueprint',
    foveaRadius: 180,
    intensity: 0.6,
    url: 'https://example.com'
});

// Extract from existing file
const metadata = await extractMetadata('screenshot.png');
console.log(metadata['Scrutinizer:CiteAs']);
```

### Best Practices for Academic Use

1. **Always capture with golden system** - Manual screenshots won't have metadata
2. **Include sidecar JSON** - Some tools can't read PNG tEXt chunks; the `.meta.json` sidecar is human-readable
3. **Reference the citation string** - Use `Scrutinizer:CiteAs` value in paper appendices

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

### Automated Visual Suite (Golden Images)
For reliable regression testing, we use a dedicated suite that spawns isolated Electron instances:

```bash
npm run capture-golden
```

This generates 19 screenshots across 5 reference pages (`dashboard`, `article`, `ecommerce`, `techmeme`, `grid`) in `tests/golden-captures/vX.X.X/`.

**Capture matrix (v1.6):**

| Page | Standard | Saliency | Structure | iPhone 14 | iPad Air |
|------|----------|----------|-----------|-----------|----------|
| dashboard | x | x | x | x | x |
| article | x | x | x | x | x |
| ecommerce | x | | | x | x |
| techmeme | x | x | x | x | x |
| grid | x | | | | |

**Artifacts**:
-   **Generated Images**: `tests/golden-captures/vX.X.X/*.png`
-   **Reference**: See [Test Suite Reference](test_suite_reference.md) for details on all scenarios.

### Validation Captures (Psychophysical Stimuli)

Dedicated capture scripts produce paired baseline/filtered screenshots of the four validation stimulus pages for the arxiv paper and regression testing:

| Script | Stimulus | Output |
|--------|----------|--------|
| `capture-color-search.js` | Chromatic decay (color-search.html) | `tests/golden-captures/validation/color-search/` |
| `capture-spatial-acuity.js` | Spatial frequency (spatial-acuity.html) | `tests/golden-captures/validation/spatial-acuity/` |
| `capture-crowding.js` | Crowding geometry (crowding.html + variants) | `tests/golden-captures/validation/crowding/` |
| `capture-saliency.js` | Saliency pop-out (saliency-popout.html) | `tests/golden-captures/validation/saliency/` |
| `capture-appendix-baselines.js` | All four stimuli, effects disabled | `docs/arxiv-paper/figures/baselines/` |

```bash
# Capture unfiltered baselines for paper figures (uses TEST_MODES=disabled)
node scripts/capture-appendix-baselines.js

# Capture filtered + baseline pairs for a specific wave
node scripts/capture-color-search.js --colors=red,blue --sizes=24
node scripts/capture-crowding.js
node scripts/capture-saliency.js

# Dry run (show what would be captured without launching Electron)
node scripts/capture-appendix-baselines.js --dry-run
```

The `disabled` mode captures from `mainWindow.scrutinizerView` (the content WebContentsView) instead of the HUD overlay, producing a true unfiltered screenshot of the HTML page. Other modes capture from the HUD where the WebGL canvas renders the pipeline output.

Analysis scripts in `scripts/analyze-*.js` and `scripts/validate-*.js` compare captured pixels against published psychophysical data. Results land in `tests/validation/results*/`.

### Browser ↔ Figma Golden Compare (Parity Harness)
- Capture browser goldens and compute SSIM/PSNR against Figma exports:
    ```bash
    npm run golden-compare -- --version=1.4.3
    ```
- Figma pairing: export plugin canvas PNGs with identical filenames into docs/golden/figma/v1.4.3, then rerun with `--skip-browser-capture` to avoid recapturing and generate summary-<version>.json.
- Flags: `--figma-only`, `--browser-only`, `--threshold-ssim=0.98`, `--threshold-psnr=35`. Storage layout and workflow are in docs/golden/README.md.
- Determinism: keep TEST_* env (seed, fixation, viewport) aligned between browser capture and Figma export for meaningful diffs.

### Manual Testing
To run the standard smoke test:
```bash
npm test
```
This executes the `tests/visual-test.html` logic in a headless mode.

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
- `TEST_MODES`: Comma-separated list of modes to capture:
  - `0`: High-Key Ghosting
  - `1`: Lab Mode
  - `2`: Frosted Glass
  - `3`: Blueprint
  - `4`: Minecraft (Block Pooling)
  - `5`: Trippy (Psychedelic + Curvy)
  - `disabled`: Effects off — captures raw page content from the content view (not the HUD). Equivalent to the eye icon toggle. Useful for unfiltered baseline screenshots.
  - `saliency`: Saliency debug heatmap
  - `structure`: Structure map debug overlay
  - `congestion_overlay`: Feature Congestion overlay
  - `congestion_solo`: Feature Congestion solo view
- `TEST_RADIUS`: Override foveal radius (pixels)
- `TEST_INTENSITY`: Override peripheral intensity (0.0-1.0)
- `TEST_MOBILE_EMULATION`: Device profile name (`iphone_14_pro`, `ipad_air_landscape`, etc.) or `true`/`false`
- `SCREENSHOT_MODE`: `date` (default) or `update`

**Custom Launch:**
You can also use these parameters to launch the app in a specific state without running the test loop:
```bash
TEST_URL=https://google.com TEST_RADIUS=50 npm start
```

**Debug Flags:**
You can force debug overlays from the command line:
- `--debug-saliency`: Shows the Saliency Heatmap (Blue->Red)
- `--debug-structure`: Shows the Structure Map (Red/Green Density)

```bash
# Launch with Saliency Map Debug
npm start -- --debug-saliency

# Launch with Structure Map Debug
npm start -- --debug-structure
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

### Release Tagging (TODO: Implement Consistently)

> [!WARNING]
> **Historical Gap**: Golden images have not been consistently tagged with releases. Starting with v1.4, we should follow this process.

**Per-Release Requirements:**
1. Before tagging a release, regenerate all golden images:
   ```bash
   # Capture all modes for reference sites
   TEST_URL=https://www.figma.com TEST_MODES=0,saliency,structure SCREENSHOT_MODE=update SAVE_SCREENSHOTS=true npm start
   TEST_URL=https://techmeme.com TEST_MODES=0,1,2,3,4,5 SCREENSHOT_MODE=update SAVE_SCREENSHOTS=true npm start
   
   # Run visual tests
   SAVE_SCREENSHOTS=true SCREENSHOT_MODE=update npm test
   
   # Copy to golden
   cp tests/screenshots/*.png tests/golden/
   ```

2. Commit golden images **before** creating the release tag:
   ```bash
   git add tests/golden/
   git commit -m "chore: update golden images for vX.Y.Z"
   git tag vX.Y.Z
   ```

3. **Historical Comparison in Release Notes**: Use GitHub's blob URL with tag to link to previous versions:
   ```markdown
   ![v1.3 Mode 0](https://github.com/USER/REPO/blob/v1.3.0/tests/golden/site_techmeme_com_mode_0.png?raw=true)
   ```

**Benefits:**
- Each release has a permanent visual snapshot
- Release notes can show before/after comparisons
- Regression detection across versions


---

## scrutinizer-audit — Headless Visual Complexity CLI & MCP Server

`cli/scrutinizer-audit.js` runs the same Feature Congestion + edge density pipeline that powers the ComplexityHUD, but headless — no Electron, no display server. It uses Playwright to capture pages in Chromium and `congestion-core.js` to score them.

### Quick Start

```bash
cd cli
npm install
npx playwright install chromium

# Score a single page
node scrutinizer-audit.js https://apple.com

# Score multiple pages with JSON output
node scrutinizer-audit.js https://apple.com https://wikipedia.org https://persci.mit.edu --json

# Mobile + desktop viewports
node scrutinizer-audit.js https://apple.com --viewport desktop,mobile

# Capture above-fold and first scroll position
node scrutinizer-audit.js https://apple.com --scroll above-fold,first-scroll

# CI gate — exit 1 if any page exceeds threshold
node scrutinizer-audit.js https://your-staging-site.com --fail-above 60
```

### Architecture

```
cli/
  scrutinizer-audit.js        # CLI entry point (bin script)
  lib/
    analyzer.js               # PNG buffer → metrics (wraps congestion-core.js)
    crawler.js                # Playwright screenshot capture
    reporter.js               # JSON / HTML / console table output
    sitemap-parser.js         # XML sitemap → URL list
    url-resolver.js           # --file, --sitemap, positional → URL[]
    viewport-profiles.js      # Desktop (1440×900) + Mobile (390×844) configs
    scroll-strategy.js        # above-fold, first-scroll positions
  mcp/
    server.js                 # MCP server (stdio transport)
  package.json
```

The analysis pipeline reuses the same shared modules as the Electron app:

```
renderer/congestion-core.js   ← computeEdgeDensity, computeCompositeScore, RATINGS
renderer/oklab-utils.js       ← srgbToLinear, linearSrgbToOklab
```

No code is duplicated. Scores from the CLI match the ComplexityHUD exactly.

### CLI Reference

```
scrutinizer-audit <url> [urls...] [options]

Input:
  <url> [urls...]           Positional URLs
  --sitemap <url>           Parse XML sitemap for URLs
  --file <path>             One URL per line (# comments allowed)

Viewport:
  --viewport <list>         desktop,mobile (default: desktop)

Scroll:
  --scroll <list>           above-fold,first-scroll (default: above-fold)

Output:
  --output <path>           Write .json or .html report
  --heatmaps                Save congestion + edge density heatmap PNGs
  --screenshots             Save raw page screenshots
  --json                    JSON to stdout (for piping)
  --quiet                   Suppress progress output

Analysis:
  --max-dim <n>             Analysis resolution (default: 1024)

CI/CD:
  --fail-above <n>          Exit 1 if any page exceeds threshold (0-100)

Comparison:
  --compare <before> <after>  Delta report from two JSON outputs
```

### Output Format

JSON output follows this schema (abbreviated):

```json
{
  "generator": "scrutinizer-audit",
  "version": "1.0.0",
  "timestamp": "2026-03-03T10:00:00Z",
  "summary": {
    "pagesAnalyzed": 3,
    "avgScore": 42,
    "maxScore": 53,
    "minScore": 0,
    "threshold": 75,
    "pass": true
  },
  "pages": [{
    "url": "https://example.com",
    "captures": [{
      "viewport": { "name": "desktop", "width": 1440, "height": 900 },
      "scrollPosition": "above-fold",
      "score": 42,
      "rating": "Medium",
      "congestion": { "mean": 0.18, "p90": 0.34, "quadrants": { ... } },
      "edgeDensity": { "mean": 0.12, "p90": 0.25, "quadrants": { ... } },
      "computeTimeMs": 342
    }]
  }]
}
```

### CI/CD Integration

Use `--fail-above` to gate builds on visual complexity:

```bash
# In GitHub Actions or similar
node cli/scrutinizer-audit.js https://staging.example.com --fail-above 60 --quiet
# Exit code 0 = all pages under threshold
# Exit code 1 = at least one page exceeded threshold
```

Compare before and after a design change:

```bash
# Before the change
node cli/scrutinizer-audit.js https://example.com --output before.json --quiet

# After the change
node cli/scrutinizer-audit.js https://example.com --output after.json --quiet

# Delta report
node cli/scrutinizer-audit.js --compare before.json after.json
```

### MCP Server (LLM Integration)

The MCP server exposes tools via stdio transport so AI assistants (Claude, Cursor, Windsurf) can query visual complexity on demand.

#### Setup Instructions

**1. Claude Desktop**
Add the following to your `claude_desktop_config.json` (usually at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):
```json
{
  "mcpServers": {
    "scrutinizer-audit": {
      "command": "node",
      "args": ["/absolute/path/to/scrutinizer2025/cli/mcp/server.js"]
    }
  }
}
```

**2. Cursor or Windsurf**
Go to Settings -> Features -> MCP (or MCP Servers) and add a new server:
- **Type**: `command`
- **Name**: `scrutinizer-audit`
- **Command**: `node /absolute/path/to/scrutinizer2025/cli/mcp/server.js`

**3. Claude Code (CLI)**
```bash
claude mcp add scrutinizer-audit -- node /absolute/path/to/scrutinizer2025/cli/mcp/server.js
```

#### Available Tools

| Tool | Input | Output |
|------|-------|--------|
| `analyze_url` | `{ url, viewport?, scroll? }` | Score, rating, congestion, edgeDensity |
| `analyze_urls` | `{ urls[], viewport? }` | Summary + per-page breakdown |
| `compare_pages` | `{ urlA, urlB, viewport? }` | Side-by-side metrics + delta |
| `capture_vision` | `{ url, x, y, radius, mode }` | Base64 PNG simulating foveated vision at the given point |

Example from Claude Desktop or Cursor:

```
> Use scrutinizer-audit to compare apple.com vs amazon.com
> Capture the vision of techmeme.com looking at the top-left logo (0.15, 0.15)
```

The MCP server launches headless Chromium, captures screenshots, runs the congestion pipeline, and returns structured JSON — same scores as the CLI and HUD.

### Scoring Formula

The composite score matches the ComplexityHUD exactly (shared via `congestion-core.js`):

$$\text{score} = \text{round}\!\left(\sqrt{\text{congestion}_{p90} \times 0.7 + \text{edgeDensity}_{p90} \times 0.3}\;\times 100\right)$$

| Score | Rating | Example |
|-------|--------|---------|
| 0–25 | Low | 404/empty pages (0), minimal landing pages |
| 26–50 | Medium | wikipedia.org (31), apple.com (46), blog posts |
| 51–75 | High | persci.mit.edu (53), news aggregators, dense dashboards |
| 76–100 | Extreme | arngren.net (~71), competing visual systems everywhere |

### Dependencies

The CLI has its own `package.json` in `cli/`:

- `playwright` — headless Chromium capture
- `@modelcontextprotocol/sdk` — MCP server
- `pngjs` — PNG decode (same as parent project)

No native binary dependencies. Runs on macOS, Linux, and Windows CI runners.

### Extending

**Adding a viewport profile:** Edit `cli/lib/viewport-profiles.js`. The `VIEWPORTS` object maps names to Playwright context options.

**Adding a scroll position:** Edit `cli/lib/scroll-strategy.js`. Each position has a `scrollFn(page)` that runs Playwright commands before screenshot.

**Adding output formats:** The `reporter.js` module dispatches on file extension. Add a new branch in `writeReport()` for formats like CSV or Markdown.

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


---

## Analytics (PostHog)

Scrutinizer uses PostHog for privacy-preserving usage analytics. Data capture is strictly opt-in via user settings.

### Events

#### `calibration_complete`
Triggered when a user successfully completes the Foveal Calibration process.

**Payload:**
- `radius`: (Number) The final calibrated foveal radius in pixels.
- `mode`: (String) "auto" or "manual".
- `trials`: (Number) Total reactions in the session.
- `reversals`: (Number) Count of reversals (hits to misses or vice versa).
- `window_width`: (Number) Inner width of the browser window.
- `window_height`: (Number) Inner height of the browser window.
- `screen_width`: (Number) Full screen width.
- `screen_height`: (Number) Full screen height.
- `device_pixel_ratio`: (Number) The DPR of the display.

**Note**: Screen and Window dimensions are captured to help correlate performance issues (e.g., Retina lag) with specific hardware configurations.

---

## Custom Overlays

Scrutinizer supports a custom SVG overlay system for drawing debug information, fixation points, or aesthetic elements like "reticles" or "grids" over the simulation.

### Architecture
*   **Renderer**: `svg-overlay.js` manages a decoupled SVG layer (separate from the canvas).
*   **Update Loop**: `scrutinizer.js` calls `overlay.update(x, y, radius...)` every frame.
*   **Coordinate System**: The SVG works in **Logical Pixels** (CSS), while the WebGL renderer works in **Physical Pixels**. You **MUST** divide physical coordinates by `scaleX` (or `dpr`) before passing them to the overlay. See `docs/coordinate_systems.md`.

### Adding a New Overlay

#### 1. Architecture: Static Implementation, Dynamic Transform
**CRITICAL PERFORMANCE RULE**: Do NOT update the `cx`, `cy`, or `x,y` attributes of individual elements every frame. This kills performance.

**The Correct Pattern**:
1.  **Create a Container Group**: Create a `<g>` that holds your entire overlay.
2.  **Translate the Group**: On `update()`, simply set `transform="translate(x, y)"` on the container.
3.  **Local Coordinates**: Draw your shapes relative to `(0,0)` inside the group.

#### 2. Implementation Steps
1.  **Modify `svg-overlay.js`**: Add a new group in `init()`.
    ```javascript
    this.elements.myOverlay = {
        group: this.createGroup('my-overlay-group'),
        // ... cached elements
    };
    ```
2.  **Build Logic**: If your overlay is complex (like a grid), build it **once** in a `buildMyOverlay()` method. Do not rebuild DOM nodes every frame.
3.  **Update Logic**:
    ```javascript
    update(x, y, ...) {
        if (this.config.showMyOverlay) {
            this.elements.myOverlay.group.style.removeProperty('display');
            // PERFORMANCE: Move the whole group
            this.elements.myOverlay.group.setAttribute('transform', `translate(${x}, ${y})`);
        }
    }
    ```
4.  **Filters**: Avoid applying filters (like Drop Shadows) to moving groups. Rasterizing filters on moving elements is extremely expensive. Apply filters to static elements only.

### Future Roadmap
We plan to support "Per-Mode Overlays" (e.g., a Minecraft block overlay for Mode 4, a Wireframe grid for Mode 3). See `ROADMAP.md`.


### Related Projects
- https://github.com/VARID-XR