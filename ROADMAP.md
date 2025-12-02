# Scrutinizer 1.0 Roadmap

## Overview
This document outlines the path from current alpha to a production-ready 1.0 release.

---

## Priority 1: Core Functionality

### ✅ Already Complete
- [x] Foveal vision simulation with mouse tracking
- [x] Adjustable blur and radius controls
- [x] Keyboard shortcuts (Escape, Left/Right arrows)
- [x] Basic navigation (back/forward, URL bar)
- [x] Scroll and DOM mutation detection
- [x] Basic browser controls (open url, back, forward)
- [x] WebGL-based "Mongrel" rendering pipeline
- [x] "Rod Vision" (Eigengrau) simulation
- [x] Visual Memory (Fog of War) mechanics
- [x] **Scroll Compensation (CONFIDENT)**: Fixed alignment between structure map and content during scroll.
  - `preload.js`: Send `scrollX/Y` with structure update
  - `main.js`: Forward `browser:scroll` to HUD
  - `scrutinizer.js`: Calculate `scrollDeltaY`
  - `webgl-renderer.js`: Use `u_scroll_offset` in shader

### 🔴 High Priority Fixes
- [x] **DomAdapter Refinements**: Comprehensive semantic element detection (ARIA roles, media elements, interactive patterns)



---

## Priority 2: Aesthetic Pivot (The "Cinematic" Update)

**Goal**: Move from "Clinical/Horror" (simulating blindness/disease) to "Cinematic/Focus" (directing attention). The periphery should look "unimportant" rather than "broken."

### 🎨 New Aesthetic Directions

#### 1. The "Frosted Glass" Tweak (Apple/iOS Aesthetic)
*For Pitching & Client Demos*
- **Concept**: Treat the periphery as if it's behind textured privacy glass.
- **Implementation**:
    - Reduce high-frequency jitter (larger, softer shards).
    - Smooth, prismatic chromatic aberration.
    - Preserve luminance (no darkening).
    - **Why**: Feels like a UI state, not a rendering error.

#### 2. The "Blueprint" Tweak (UX Research Aesthetic)
*For Design Reviews & A/B Testing*
- **Concept**: "Visual Scent" - show layout/grid but hide content details.
- **Implementation**:
    - High-pass filter in periphery (edges only).
    - "Blueprint Blue" tint.
    - **Why**: Highlights Layout vs. Content. Proves the user sees the grid but misses the copy.
    ### Structure Map
- [x] Scroll performance: reduce lag during scroll (16ms throttle + debounced final scan)
- [x] HTML5 Tag Coverage: comprehensive semantic element detection (ARIA roles, modals, custom interactive)
- [ ] **Known Limitation**: Mouse tracking doesn't work over popup modals (Google account menu, etc.) - DOM events blocked
  - Future: Explore Electron screen.getCursorScreenPoint() polling, but needs careful coordinate validation
- [x] Blueprint mode functional
- [ ] Blueprint mode visual polish needed
- [ ] Debug red tint overlay issue visual polish
    - **Todos**:
        - [ ] Fix "Red Tint" visual overlay issue (whole page shows pink/red tint)
        - [ ] Tune opacity and blending for "UX Blueprint" look

### Structure Map: Figma Plugin Support (Prerequisite for Saliency)

**Goal**: Extend structure map abstraction to Figma's scene graph, enabling unified pipeline for both web and design tools.

**Why First**: Figma plugin is key distribution channel. Structure map must work there before adding saliency layer complexity.

**Implementation:**
- [ ] **Figma Scene Graph Adapter**
  - Create `FigmaAdapter` class parallel to `DomAdapter`
  - Extract layout blocks from Figma node tree via Plugin API
  - Map Figma node types to `StructureBlock` semantics:
    - Text nodes → `type: 'TEXT'`
    - Images/vectors → `type: 'IMAGE'`
    - Frames/components → `type: 'UI_CONTROL'`
  
- [ ] **Optimize for Figma's Node Structure**
  - Figma has explicit layout properties (no DOM quirks)
  - Leverage `node.absoluteBoundingBox` for precise geometry
  - Handle auto-layout containers differently than flex/grid
  - Respect component boundaries as semantic units

- [ ] **Unified Pipeline**
  - Same `StructureMap` rasterizer for both sources
  - Same shader consumption (`u_structureMap` texture)
  - Test that Blueprint mode works identically in Figma plugin

**Dependencies:**
- Review `scrutinizer-figma-plugin` codebase
- Ensure Plugin API access to node tree traversal
- Coordinate with existing capture pipeline

---

### Saliency Map: Design Tool + Core Simulation Enhancement

**Goal**: Dual-purpose saliency map - creative tool for visual effects AND biophysical accuracy for research.

**Priority Justification**: 
1. **Design Tool**: Exposes saliency as controllable layer for visual emphasis and critique
2. **Core Simulation**: Replaces distance-based distortion with attention-driven, clutter-sensitive model

#### 1. Saliency Map Generation Pipeline

**Implementation:**
- [ ] Generate saliency map from captured frame (web) or scene graph (Figma)
- [ ] Start simple: Edge detection + color contrast (bottom-up only)
- [ ] Upload as `u_saliencyMap` texture uniform to shader
- [ ] Add debug visualization mode to inspect saliency heatmap

**Shader Integration:**
```glsl
uniform sampler2D u_saliencyMap;
float saliency = texture2D(u_saliencyMap, uv).r;
```

#### 2. Design Tool Exposure

**Creative Controls:**
- [ ] **Saliency Overlay Mode**: Visualize heatmap directly (research/debugging)
- [ ] **Inverse Saliency Mask**: Use `1.0 - saliency` to highlight low-attention areas
- [ ] **Blend Modes**: Multiply/add saliency with other masks for layered effects
- [ ] **Threshold Controls**: Expose saliency cutoff sliders for binary masking

**Use Cases for Designers:**

**Individual Work:**
- Identify visual hierarchy issues in layouts during iteration
- Validate button/CTA prominence before handoff
- Assess color contrast and visual weight distribution

**Team Critique:**
- Objectively discuss "what draws the eye" in design reviews
- Debug attention flow in multi-screen workflows
- Compare design variants for attention capture

**Client Presentation:**
- Demonstrate intentional visual hierarchy to stakeholders
- Show data-driven rationale for design decisions
- Validate accessibility and scannability of interfaces



#### 2. Saliency-Driven Feature Aggregation (Crowding Model)

**Mechanism**: Model peripheral crowding where clutter prevents feature identification.

**Implementation:**
- **Clutter Strength Mask**: `ClutterStrength = 1.0 - SaliencyMap`
- **Low Saliency → High Distortion**:
  - Non-distinctive features (low saliency) = high clutter
  - Modulate domain warping: `warpStrength *= ClutterStrength`
  - Modulate jitter: `jitterAmount *= ClutterStrength`
  
**Biophysical Analogy**: High jitter/warping simulates brain mashing features together in peripheral clutter.

**Shader Integration:**
```glsl
float clutterStrength = 1.0 - texture2D(u_saliencyMap, uv).r;
float crowdingFactor = mix(1.0, clutterStrength, peripheralMask);
warpOffset *= crowdingFactor;
```

**Result**: Distortion driven by feature density/uniqueness rather than just eccentricity distance.

**Dependencies:**
- [ ] Research/select computational saliency model (e.g., Itti-Koch, DeepGaze)
- [ ] Implement WTA network with IOR
- [ ] Integrate clutter mask with existing shader pipeline
- [ ] Validate against eye-tracking datasets

#### 3. The "Cyberpunk/Neon" Tweak (VJ/Creative Aesthetic)
*For "Eye Candy" & Creative Coding*
- **Concept**: Hyper-spectral periphery. Fovea is "Real", Periphery is "Digital/Hallucinogenic".
- **Implementation**:
    - Aggressive RGB channel splitting.
    - Boost saturation of Cyan/Magenta in periphery.
    - Inverted Vignette: Edges fade to a "glow" (Deep Purple/Neon) instead of black.
    - **Why**: Makes the fovea feel hyper-real by contrast.

---

## Priority 3: Distribution & Release

### 🟡 Important for 1.0

#### Build System
**Priority**: High  
**Effort**: Low

Configure `electron-builder` for multi-platform builds:
- macOS: `.dmg` installer
- Windows: `.exe` installer  
- Linux: `.AppImage` and `.deb`

**Action items**:
- Add build configuration to `package.json`
- Create build scripts (`npm run build:mac`, `npm run build:win`, etc.)
- Test builds on each platform

---

#### Code Signing
**Priority**: Medium  
**Effort**: Medium (+ Cost)

**macOS**:
- Requires Apple Developer account ($99/year)
- Sign app with Developer ID certificate
- Notarize with Apple to avoid Gatekeeper warnings
- **Without signing**: Users must right-click > Open to bypass security

**Windows**:
- Optional but recommended
- Code signing certificate ($100-400/year from vendors like DigiCert)
- **Without signing**: SmartScreen warnings on first run

**Recommendation**: Start without signing, add in 1.1 if adoption warrants it

---

#### Release Notes & Documentation
**Priority**: High  
**Effort**: Low

Create:
- `CHANGELOG.md` - Version history
- `RELEASE_NOTES.md` - 1.0 release highlights
- Installation instructions for each platform
- Known issues and workarounds

---

## Priority 4: Learning Mode (The "Omelet" Update)

### 🧠 Visuospatial Memory Simulation
**Goal**: Simulate the "Visuospatial Sketchpad" of working memory. The screen "remembers" detail only where the user has foveated, and forgets it over time, mimicking biological cognitive load.

#### The Core Mechanic: "Visuospatial Decay"
**Biological Accuracy**: Human working memory is limited (Miller’s Law: 7 ± 2 items). We don't remember the footer just because we looked at it 10 seconds ago.

- **Interaction**: Saccades (scanning) act as "Data Fetching" operations.
- **Clarification**: As the fovea (cursor) moves, it "paints" clarity onto the canvas (removing the blur/noise).
- **The Twist (Decay)**: Once the user has "cleared" more than ~5 distinct chunks (or after ~10 seconds), the oldest cleared areas begin to "rot" (slowly return to the mongrel/noise state).
- **The Lesson**: Teaches Cognitive Load. If a user has to look back and forth frantically to keep the mental model "alive," the design is too dense.

#### Technical Implementation
- **Mask Texture**: A secondary, low-res offscreen `<canvas>` (heatmap of attention).
- **The Brush**: `requestAnimationFrame` loop draws a soft white circle at cursor coordinates onto the Mask.
- **Decay Shader**: Apply a global fade (alpha subtraction) to the Mask every frame to simulate memory loss.
- **Compositor**: 
  - Pass Mask pixel data to `blur-worker.js`.
  - Pixel Shader: `FinalPixel = mix(MongrelPixel, CleanPixel, MaskValue)`.

#### Variations & Settings
- **"Fog of War" (Permanent Cache)**: 
  - *Setting*: Memory Limit = Infinite.
  - *Mechanic*: "Gamified" scanning. Paint clarity that persists. 
  - *Metric*: "Comprehension Score" (% of page loaded).
- **"Change Blindness" Trap (The VJ Prank)**:
  - *Mechanic*: Change text in the "preserved" (peripheral) zones while the user is looking away.
  - *Reveal*: Show a replay of the "Confidence Path" proving they didn't notice the change.

---

## Priority 5: Edge Cases & Polish



#### CORS & Capture Failures
**Priority**: Medium  
**Effort**: Medium

**Issue**: Some sites block `html2canvas` due to CORS policies

**Solutions**:
- Graceful error handling with user notification
- Fallback: Disable foveal mode for incompatible sites
- Document known incompatible sites

---


## Priority 6: Future Enhancements (Post-1.0)

### 🔵 Version 1.1+

#### Preferences UI
- Persistent settings panel
- Default blur/radius values
- Capture quality settings
- Keyboard shortcut customization

#### Auto-Update
- Integrate `electron-updater`
- Check for updates on launch
- Background download and install

#### Advanced Features
- Multiple foveal profiles (reading, browsing, etc.)
- Eye tracker integration (Tobii, etc.)
- Session recording/playback
- Heatmap generation from usage data

#### Navigation polish (1.3)
- "Go" menu added with Home / Back / Forward entries for more discoverable navigation controls

#### Advanced Simulation Controls
**Priority**: Medium  
**Effort**: Medium

Add user-facing controls for progressive blur tuning:
- **Blur aggressiveness slider**: Adjusts pyramid level multipliers (0.3/0.7/1.3 → 0.5/1.0/2.0)
- **Zone transition radii**: Controls r1/r2/r3 multipliers for gradient zones
- **Presets**: "Gentle" (Magnocellular-preserving), "Standard", "Aggressive" (strict fidelity)
- **Real-time preview**: Live adjustment without recapture
- **Persistent profiles**: Save custom configurations

**Implementation notes**:
- Expose pyramid multipliers and zone radii as runtime config (not compile-time)
- Worker can rebuild pyramid with new multipliers
- Menu or panel UI for adjustment (possibly View → Simulation Fidelity submenu)
- Useful for researchers comparing different acuity models or designers stress-testing layouts



#### Capture Fidelity Improvements
**Priority**: Medium  
**Effort**: Medium

Improve how we sample the page for foveal/peripheral processing:
- Use `image.toBitmap()` / `toPNG()` and write pixels directly into an `ImageData` buffer.
- Draw once into canvas at **1:1 scale** (no scaling in `drawImage`) to avoid extra resampling.
- Evaluate impact on text clarity (especially small fonts and iconography) versus performance/memory.

### Simulation Fidelity

- **✅ Progressive eccentricity-based blur** (Implemented in 1.0)
  - ✅ Multi-resolution pyramid (3 levels: mild/moderate/heavy blur)
  - ✅ Gradual acuity falloff with radial gradient zones (0.3x/0.8x/1.5x fovealRadius)
  - ✅ Web Worker offloads blur computation for non-blocking UI
  - ✅ Binocular foveal overlay preserved (full color, 16:9 shape)
  - ✅ Gentler blur multipliers (0.3/0.7/1.3 × baseBlurRadius) preserve Magnocellular info
  - 🔵 **Future**: Calibrated visual-angle units with monitor distance/DPI calibration
  - 🔵 **Future**: User-adjustable blur aggressiveness and zone transition controls (see Advanced Simulation Controls)

- **✅ Magnocellular-preserving low-pass filter** (Implemented in 1.0)
  - ✅ Multi-level pyramid attenuates high spatial frequencies while preserving low frequencies
  - ✅ Icons and major layout regions remain distinguishable peripherally
  - ✅ Text becomes unreadable while gross shape/contrast preserved
  - 🔵 **Future**: Wavelet-based decomposition for more precise frequency-band control
  - 🔵 **Future**: Validation against psychophysical acuity curves

- **✅ Neural Processing Model ("Box Sampling with Noise")** (Implemented in Beta)
  - ✅ Parafoveal crowding with spatial jitter (feature migration) - 2px random offset
  - ✅ Block-based downsampling in periphery (photoreceptor density) - 3x3 and 5x5 blocks
  - ✅ Progressive desaturation (periphery is color-blind)
  - ✅ Replaces Gaussian blur with biologically-accurate spatial uncertainty
  - ✅ Improved peripheral simulation and shader pipeline landed in 1.3 (see `docs/foveated-vision-model.md` and inline shader comments for details)
  - 🔵 **Future (scrutinizer2025gl)**: Full "Mongrel Theory" implementation
    - 🔵 Summary statistics compression with texture synthesis
    - 🔵 Contrast boost in periphery (Magno/Parvo separation)
    - 🔵 Chromatic aberration (R/B channel splitting)
    - 🔵 Optional blind spot simulation at ~15° eccentricity
    - 🔵 Domain warping with WebGL shaders
    - 🔵 "Mongrel" visualization mode showing statistical texture compression

#### OffscreenCanvas Renderer (Worker Thread)
**Priority**: Low/Ambiguous
**Effort**: High

- Move WebGL context to a Web Worker using `OffscreenCanvas`.
- **Goal**: Decouple rendering from main thread to prevent UI jank.
- **Ambiguity**: High complexity refactor. Current performance is GPU-bound, so CPU offloading might yield diminishing returns for the effort required.

#### Upgrade to GLSL ES 3.0 / WebGL 2.0
**Priority**: Medium
**Effort**: Low

- **Goal**: Modernize rendering pipeline to use WebGL 2.0 features.
- **Benefits**:
  - Native `fwidth` support for crisp, resolution-independent vector graphics (debug boundaries).
  - Better performance and more advanced shader capabilities.
  - High compatibility across modern browsers.
- **Action Items**:
  - Update shader version string to `#version 300 es`.
  - Update shader syntax (attribute -> in, varying -> out/in, texture2D -> texture).
  - Verify context creation ensures `webgl2`.

---

## Refactoring Opportunities

### 🔧 Code Quality Improvements

#### Extract Shader to Separate File
**Priority**: Low  
**Effort**: Medium

- **Issue**: Fragment shader is 640+ lines embedded in `webgl-renderer.js`
- **Benefits**:
  - Better syntax highlighting in editors
  - Easier testing and validation
  - Cleaner separation of concerns
- **Implementation**: Move to `renderer/shaders/peripheral.frag` and load via `fs.readFileSync` or bundler

#### Consolidate Magic Numbers
**Priority**: Low  
**Effort**: Low

- **Issue**: Several hardcoded values scattered through codebase
- **Action**: Extract to named constants in `config.js`:
  - Scrollbar width (17px)
  - Fixation velocity threshold (20.0 px/ms)
  - Dwell time threshold (50ms)
  - Fovea bypass margin (0.5x radius)

#### Structure Map Scroll Tracking
**Priority**: Medium  
**Effort**: Medium

- **Issue**: Documentation describes throttled scroll tracking, but implementation relies on IPC events
- **Action**: Add scroll event listeners in `dom-adapter.js` or `preload.js` with:
  - Throttled scans (16ms) during scroll
  - Debounced final scan (100ms) after scroll ends

#### Saliency Modulation Expansion ✅
**Priority**: Low  
**Effort**: Low → Medium (required temporal smoothing foundation)

**Completed (2025-12-02)**:
- [x] **Temporal Smoothing**: Double-buffered saliency map (15% blend/frame) prevents flicker on dynamic content
- [x] **Gestalt Grouping**: Structure block quantization (1px text, 10px UI) stabilizes map against micro-layout shifts
- [x] **V1 Jitter Modulation**: Shatter mode jitter reduced by up to 25% near salient areas (far periphery only)
- [x] **V1 Warp Modulation**: Noise mode warp reduced by up to 25% near salient areas (far periphery only)
- [x] **V4 Rod Vision Modulation**: High-Key and Lab modes reduce desaturation by up to 15% near salient areas (far periphery only)

**Key Constraints**:
- **Parafoveal Isolation**: Foveal/parafoveal motion cannot affect far periphery
- **Conservative Depth**: 15-25% max effect to maintain illegibility
- **Spatial Gating**: Only applies beyond `parafovea_radius` (2.5x fovea)

#### Smooth Zone Transitions (Peripheral Stability)
**Priority**: Low  
**Effort**: Medium

- **Issue**: Hard boolean jumps between parafovea/periphery zones cause visible "popping" when fovea moves
- **Current**: `eccentricityScale = isFarPeriphery ? 1.0 : 0.15` (hard 6.7x jump)
- **Attempted Fix**: Using `smoothstep` for gradual transition caused "flash of readability" regression
- **Root Cause**: Smooth transitions interact poorly with the stable mouse hysteresis and frame timing
- **Future Approach**: 
  - Investigate temporal smoothing of zone transitions (per-pixel history)
  - Or accept hard jumps but ensure they're visually masked by the distortion itself
  - Consider velocity-gated transitions (only smooth when stationary)

#### Remove Dead Code
**Priority**: Low  
**Effort**: Low

- [x] Removed unused `saliency-map.js` (replaced by `color-saliency-map.js`)
- [ ] Review and remove commented-out code blocks
- [ ] Clean up unused uniform locations and config options

