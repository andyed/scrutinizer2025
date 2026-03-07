# Scrutinizer Roadmap

## ✅ Completed Features (v2.0)

### v2.0: Explainer Modes & Density-Gated Crowding
**Date:** 2026-03-07

- [x] **Minecraft Mode (Block Pooling)** — CMF pipeline as discrete block geometry (4-64px)
- [x] **Minecraft Eyeball (Polar Pooling)** — Polar sectors sized by CMF, ~2:1 radial elongation
- [x] **Blueprint Mode (ARIA Wireframe)** — Role-colored bounding boxes from live DOM
- [x] **Density-Gated Crowding** — Sigmoid on structure density modulates V1 strength
- [x] **Chromatic Decay Recalibration** — Bowers et al. 2025 suprathreshold values
- [x] **Eccentricity Scaling** — `u_ecc_scaling` uniform (Brown et al. 2023)
- [x] **Toggle Effects menu item** — Cmd+E in Behavior menu
- [x] **Toolbar URL overflow fix**

## ✅ Completed Features (v1.0-v1.5)

### v1.5: Mobile Emulation & Usability
**Date:** 2026-01-30

- [x] **Mobile Emulation Mode**
  - Toggle via `View > Mobile Emulation`
  - Simulates iPhone viewport (390x844), scale (3x), and User Agent
  - Auto-resizes window and locks dimensions
- [x] **Touch Event Synthesis (Alpha)**
  - Option+Click in mobile mode triggers true `touchStart`/`touchEnd` events
  - *Note: Experimental feature*
- [x] **Toolbar 2.0**
  - Touch-friendly URL trigger button
  - Dedicated URL input dialog for better mobile UX


### v1.4.2: Reference Pages & Biology-Forward Docs

**Date:** 2025-12-14

- [x] **Go → Reference Pages menu**
  - Added `Go → Reference Pages → (Dashboard | Article | E-commerce)`
  - Loads local fixtures from `tests/reference-pages/*.html` directly into the Scrutinizer view
  - Makes it trivial to jump into standard test layouts used by golden captures and experiments

- [x] **Foveated Vision Model: receptor-to-cortex narrative**
  - New Section 1: "The Biology: From Photoreceptors to Perception"
  - Traces the path Retina → LGN → V1 → V4 with wiring diagrams and cortical magnification
  - Explicit mapping table: biological phenomena → shader implementation knobs

- [x] **Scientific Literature Review: pathway-structured rewrite**
  - Reorganized around the biological stages (Retina, LGN, V1, V4)
  - Added quick-reference tables (retinal architecture, crowding, gaze-contingent research)
  - Clarified that LGN/V1/V4 are architectural metaphors, not a full biophysical simulation

### v1.3: Perceptual Accuracy Update

#### Oklab Color Space Integration ✅
**Completed:** 2025-12-10

- [x] Created `oklab-utils.js` with RGB ↔ Oklab conversion functions
- [x] Updated `image-processor.js` to use Oklab for desaturation
- [x] Added GLSL Oklab functions to `peripheral.frag` shader
- [x] Converted High-Key and Lab modes to use Oklab
- [x] Eigengrau tinting in Oklab space
- [x] Ported Oklab to Figma plugin

**Benefits:**
- Perceptually uniform desaturation (no hue shifts)
- Cyan preservation in periphery (rod-sensitive wavelengths)
- More natural cold blue-gray appearance

**Reference:** Ottosson, B. (2020). "A perceptual color space for image processing"

#### Smooth Parafovea-Periphery Transitions ✅
**Completed:** 2025-12-10

- [x] Replaced piecewise blur with continuous exponential curve
- [x] Smooth contrast preservation gradient using `smoothstep`
- [x] Eliminated visual "kink" at parafovea boundary

**Formula:** `blur = 3.0 * exp(distFromPara * 2.0)` (capped at 20px)

#### WebGL 2.0 Upgrade ✅
**Completed:** 2025-12 (prior to Oklab work)

- [x] Updated shaders to `#version 300 es`
- [x] Migrated syntax: `attribute` → `in`, `varying` → `out/in`, `texture2D` → `texture`
- [x] WebGL 2 context creation in renderer
- [x] Native `fwidth` support for crisp debug boundaries

**Benefits:**
- Better performance and shader capabilities
- Resolution-independent vector graphics
- Modern rendering pipeline

#### Foveal Calibration Improvements ✅
**Completed:** 2025-12-10

- [x] Mobile support (fixed blank screen and control alignment)
- [x] Tap functionality as alternative to Spacebar
- [x] Menu integration (Simulation → Calibrate Foveal Size)
- [x] Widened ISI randomization (2000-5000ms) to prevent anticipation
- [x] Added professional branding (logo, footer)
- [x] Simplified instructions with instructional diagram
- [x] Hidden navbar during active calibration

### v1.0-v1.2: Core Features

#### Progressive Blur ✅
- [x] Multi-resolution pyramid (3 levels)
- [x] Gradual acuity falloff with radial gradient zones
- [x] Web Worker offloading for non-blocking UI
- [x] Gentler blur multipliers preserving Magnocellular info

#### Neural Processing Model ✅
- [x] Parafoveal crowding with spatial jitter
- [x] Block-based downsampling in periphery
- [x] Progressive desaturation
- [x] Improved shader pipeline (v1.3)

#### Saliency Modulation ✅
**Completed:** 2025-12-02

- [x] Temporal smoothing (double-buffered, 15% blend/frame)
- [x] Gestalt grouping (structure block quantization)
- [x] V1 jitter/warp modulation (up to 25% reduction near salient areas)
- [x] V4 rod vision modulation (up to 15% reduction)

#### Configuration Consolidation ✅
- [x] Extracted fixation detection constants to `config.js`
- [x] Removed magic numbers from shader code

#### Navigation Polish ✅
- [x] "Go" menu with Home/Back/Forward entries

---

## Overview


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

## Priority 1: Performance & Simulation Accuracy

### 🚀 High-Priority Optimizations (v1.4)

#### 1. Capture Fidelity: 1:1 Scale Rendering
**Priority**: HIGH  
**Effort**: MEDIUM  
**Impact**: HIGH (accuracy)  
**Performance Cost**: +10-15% memory, negligible CPU

**Goal**: Eliminate scaling artifacts and improve text clarity

**Current Issue:**
- Electron captures may have DPI/zoom scaling
- Potential resampling artifacts
- No explicit 1:1 guarantee for native resolution

**Proposed Implementation:**
```javascript
// Capture at native resolution (no scaling)
const nativeImage = await contents.capturePage({ 
    x: 0, y: 0, 
    width: actualWidth, 
    height: actualHeight 
});

// Use createImageBitmap for zero-copy transfer
const bitmap = await createImageBitmap(nativeImage);
```

**Benefits:**
- Sharper text rendering (especially small fonts)
- Better iconography clarity
- More accurate peripheral simulation
- Eliminates resampling artifacts

**Files to Modify:**
- `renderer/scrutinizer.js:298-348` (processFrame)
- `main.js` (capture logic)

**Testing:**
- Visual comparison of text clarity
- Memory usage profiling
- Frame time measurement

---

#### 2. Eliminate ImageData Allocations in Hot Path
**Priority**: HIGH  
**Effort**: LOW  
**Impact**: MEDIUM (performance)  
**Performance Gain**: 5-10% frame time reduction

**Goal**: Reduce GC pressure and memory allocations

**Current Issue:**
```javascript
// scrutinizer.js:312 - Creates new allocation EVERY FRAME (60fps)
const imageData = new ImageData(new Uint8ClampedArray(buffer), width, height);
```

**Proposed Implementation:**
```javascript
// Pre-allocate reusable buffer in constructor
this.imageDataBuffer = new Uint8ClampedArray(width * height * 4);
this.imageData = new ImageData(this.imageDataBuffer, width, height);

// In processFrame: Fast typed array copy
this.imageDataBuffer.set(buffer);
this.renderer.uploadTexture(this.imageData);
```

**Benefits:**
- Eliminates 60 allocations/sec
- Reduces GC pressure
- Faster memory reuse

**Files to Modify:**
- `renderer/scrutinizer.js:298-348`

**Testing:**
- Frame time profiling
- Memory allocation tracking
- GC pause measurement

---

### 🎯 v1.5 Planned Features

#### 1. Static Reference Pages for Visual Regression Testing
**Priority**: HIGH  
**Effort**: LOW  
**Impact**: HIGH (reliability, documentation)

**Goal**: Create stable, version-controlled HTML test pages for golden image comparisons.

**Problem Solved:**
- Live sites change, making historical comparisons unreliable
- Test harness uses different config than real app
- No consistent reference for design/scientific demonstrations

**Proposed:**
Create 2-3 static HTML pages in the repo featuring common web patterns:

```
tests/reference-pages/
├── dashboard.html     # Toolbar, sidebar, cards, tables, icons
├── article.html       # Headings, paragraphs, images, blockquotes
├── ecommerce.html     # Product grid, buttons, CTAs, thumbnails
```

**Benefits:**
- Version-controlled, never changes unexpectedly
- Showcases Scrutinizer for design audience
- Supports scientific reproducibility
- Can include edge cases (low contrast, small text, dense layouts)

**Files to Create:**
- `tests/reference-pages/*.html` (Bootstrap or Tailwind-based)
- `tests/golden-captures/v1.5.0/*.png` (captured from reference pages)

---

#### 2. "Check for Updates" Menu Item with Opt-Out
**Priority**: MEDIUM  
**Effort**: LOW  
**Impact**: MEDIUM (UX polish)

**Goal**: Give users control over update notifications.

**Proposed:**
- Add `Help > Check for Updates` menu item
- Add `Preferences > Auto-check for updates` toggle (default: ON)
- Store setting via `settingsManager`

**Implementation:**
```javascript
// Help menu
{ label: 'Check for Updates', click: () => autoUpdater.checkForUpdates() }

// Settings
settingsManager.get('autoCheckUpdates', true) // default enabled
```

---

#### 3. Fix Test Harness to Match App Defaults
**Priority**: LOW  
**Effort**: LOW  
**Impact**: MEDIUM (developer experience)

**Goal**: Ensure test screenshots match real app behavior.

**Current Issue:**
- Test passes `mongrelMode=0` instead of `1`
- Missing default values for several parameters

**Proposed:**
- Update `tests/visual-test.html` to use same defaults as `scrutinizer.js`
- Document expected test output in `developers_guide.md`

---

### 🔧 Medium-Priority Optimizations (v1.5)

#### 3. Shader Optimization
**Priority**: MEDIUM  
**Effort**: MEDIUM  
**Impact**: LOW-MEDIUM (performance)  
**Performance Gain**: 5-10% GPU time

**Current State:**
- 1041 lines in `peripheral.frag`
- Multiple texture lookups per pixel (4-5 reads)
- Complex Oklab conversions with matrix math

**Optimization Opportunities:**

**3a. Reduce Texture Lookups**
- Pack saliency + density + rhythm into single texture
- Reduces memory bandwidth by 25-30%

**3b. Simplify Oklab Conversions**
- Pre-compute for common cases
- Use lookup tables for gamma correction
- 10-15% faster color conversions

**3c. Branch Reduction**
- Replace `if/else` chains with `mix()` and `step()`
- Better GPU parallelism

**Files to Modify:**
- `renderer/shaders/peripheral.frag`

---

## Priority 2: Simulation Fidelity Improvements

### 🎯 Foundational: Calibrated Visual Angles
**Priority**: HIGH  
**Effort**: LOW  
**Impact**: HIGH (scientific accuracy)

**Goal**: Convert pixel-based measurements to true degree-based visual angles using calibration data.

**Current State:**
- Foveal radius in pixels (arbitrary, varies by monitor/distance)
- No biological accuracy guarantee
- Zone boundaries are pixel-based approximations

**Proposed:**
Leverage existing foveal calibration to derive pixels-per-degree ratio:

```javascript
// From calibration
const calibratedFovealRadiusPx = 92; // User's measured fovea
const fovealAngleDegrees = 2.0;      // Biological constant

// Derive conversion factor
const pixelsPerDegree = calibratedFovealRadiusPx / fovealAngleDegrees;

// Use biological constants for zones
const parafoveaRadius = degreesToPixels(5);   // True 5° boundary
const nearPeripheryRadius = degreesToPixels(10); // True 10°
const midPeripheryRadius = degreesToPixels(20);  // True 20°
```

**Benefits:**
- Scientifically accurate simulation
- Automatic adaptation to monitor size/DPI/distance
- No manual configuration needed
- Validates calibration quality

**Architecture: Separate Calibration from Comfort**

Currently `foveaRadius` controls both the clear-zone boundary (UX comfort) and the eccentricity denominator (scientific accuracy). Inflating it for comfort under-attenuates all downstream models (DoG, chromatic pooling, crowding). The clean split:

| Parameter | Role | Source |
|-----------|------|--------|
| `px_per_deg` | Physical calibration — pixels per degree of visual angle | Blind spot method, camera, or screen geometry |
| `foveaRadius` | Comfort clear zone — how large the unprocessed center feels | User preference (can be ≥ calibrated fovea) |
| `ecc_deg` | True eccentricity in degrees — `dist_px / px_per_deg` | Derived from calibration, NOT from foveaRadius |

This means a user can have a generous 180px clear zone without lying to the eccentricity models. The shader would compute `ecc_deg = dist_px / px_per_deg` (replacing `normEcc * fovea_deg`), with a separate mask for the comfort clear zone.

**Reference: Foveal Size by Setup**

| Setup | px/deg | Fovea radius (2°) | Viewport H-edge |
|-------|--------|-------------------|-----------------|
| 24" 1080p @ 60cm | 38 CSS px | 76 px | ~20° |
| 16" MBP Retina @ 20" (50.8cm) | 44 CSS px | 89 px | ~19° |
| 14" MBP Retina @ 20" | 44 CSS px | 89 px | ~16° |
| 27" 4K @ 60cm (2x) | 38 CSS px | 76 px | ~22° |

**Implementation:**
- [x] Foveal calibration tool exists (Motion Silence staircase, v1.3+)
- [ ] Separate `px_per_deg` from `foveaRadius` in config and shader
- [ ] Store pixels-per-degree in calibration data
- [ ] Update shader: `ecc_deg = dist_px / px_per_deg` (replace `normEcc * fovea_deg` in 6 places)
- [ ] Comfort clear zone as separate mask (uses `foveaRadius`, not `px_per_deg`)
- [ ] Update renderer to use degree-based zones
- [ ] Add validation (20-80 px/degree range check)
- [ ] Blind spot calibration as second anchor point (~15° eccentricity)
- [ ] Optional: Multi-monitor calibration support

**Files to Modify:**
- `renderer/shaders/peripheral2.frag` - Replace `fovea_deg` with `u_px_per_deg` uniform
- `renderer/webgl-renderer.js` - New uniform, comfort zone separation
- `renderer/scrutinizer.js` - Use calibrated visual angles
- `scrutinizer-www/src/js/foveal-calibration.js` - Save px/degree ratio
- `settings-manager.js` - Store calibration data

---

### 🔍 High-Impact: Center-Surround Saliency
**Priority**: HIGH
**Effort**: MEDIUM
**Impact**: VERY HIGH (realism)

**Goal**: Replace distance-only blur with clutter-sensitive distortion using center-surround mechanism.

**Partial Implementation (v1.6 — DoG Band Decomposition):**
- [x] **DoG in V4 pooling path**: Hardware MIP chain decomposed into approximate Laplacian pyramid bands (box/bilinear, not true Gaussian — some spectral leakage) with M-scaling rolloff per band. Replaces uniform MIP blur with frequency-selective attenuation.
- [x] **Per-mode gating**: `dog_enabled`, `dog_e2`, `dog_sharpness` in `modes.json`. Enabled for High-Key and Biological modes.
- [x] **Biological M-scaling**: Per-band cutoff eccentricities follow linear M-scaling (1, 3, 7, 15 × E2) per Rovamo & Virsu (1979).

**Next: Oriented DoG Bands (Specced):**
- [ ] **Orientation-selective band attenuation**: Cardinal (H/V) edges get M-scaling cutoffs pushed ~50% further, modeling the oblique effect (Appelle, 1972). Spec: `docs/specs/oriented_dog_bands.md`

**Remaining (saliency-driven DoG):**
The current DoG implementation operates on the *rendered content* (spatial frequency decomposition). The original vision of *saliency-driven* DoG (where clutter modulates distortion strength) is still open:

```glsl
// Multi-scale center-surround (saliency worker side)
for each feature map (I, RG, BY):
    fine = blur(feature, sigma=1)
    coarse = blur(feature, sigma=3)
    centerSurround = abs(fine - coarse)

// Modulate distortion by inverse saliency
clutterStrength = 1.0 - saliency
warpStrength *= clutterStrength
jitterAmount *= clutterStrength
```

**Remaining Implementation:**
- [ ] Implement DoG in saliency worker (separate from V4 band decomposition)
- [ ] Multi-scale pyramid (3-5 scales) for attention map
- [ ] Combine saliency-driven clutter with V4 DoG band weights
- [ ] Validate against eye-tracking data

**Dependencies:**
- Existing saliency worker ✅
- Temporal smoothing ✅
- V4 DoG band decomposition ✅
- Need: Saliency-side DoG and clutter integration

**Files to Modify:**
- `renderer/saliency-worker.js` - Add DoG for attention map
- `renderer/shaders/peripheral2.frag` - Clutter modulation of band weights
- `renderer/color-saliency-map.js` - Multi-scale processing

---

### 🎨 Advanced: Mongrel Texture Synthesis
**Priority**: MEDIUM  
**Effort**: VERY HIGH  
**Impact**: VERY HIGH (ultimate realism)

**Goal**: Replace blur with true feature scrambling to simulate peripheral crowding.

**Current Approach:**
- Blur + jitter = smooth gradients, recognizable shapes
- Doesn't capture "crowding" (unbound features)

**Mongrel Approach:**
- Feature scrambling: See curve of 'd', cross of 't' in wrong positions
- Summary statistics: Preserve average color, orientation, spatial frequency
- Unbound features: Detect edges but can't bind to objects

**Techniques (in order of complexity):**

**Phase 1: Simple Feature Scrambling**
```glsl
// Random pixel sampling within blocks
vec4 mongrel = vec4(0.0);
for (int i = 0; i < N; i++) {
    vec2 randomOffset = hash(blockId + i) * blockSize;
    mongrel += texture(u_texture, uv + randomOffset);
}
mongrel /= float(N);
```
- Effort: LOW
- Impact: MEDIUM
- Performance: GOOD

**Phase 2: Portilla-Simoncelli Texture Synthesis**
- Match summary statistics (mean, variance, correlations)
- Preserve spatial frequency content
- Effort: HIGH
- Impact: VERY HIGH
- Performance: EXPENSIVE (may need pre-computation)

**Phase 3: Neural Texture Synthesis**
- Gram matrix matching (style transfer lite)
- GPU-accelerated
- Effort: VERY HIGH
- Impact: VERY HIGH
- Performance: MEDIUM (with optimization)

**Recommendation:**
- Start with Phase 1 (simple scrambling) to validate concept
- Optimize shader performance first (free up GPU budget)
- Phase 2/3 only if Phase 1 proves valuable

**Implementation:**
- [ ] Prototype simple feature scrambling
- [ ] Measure performance impact
- [ ] User testing: Does it improve realism?
- [ ] If successful: Research Portilla-Simoncelli
- [ ] Optimize for real-time performance

**Files to Modify:**
- `renderer/shaders/peripheral.frag` - Add mongrel mode
- New: `renderer/shaders/texture-synthesis.glsl`
- `renderer/scrutinizer.js` - Mode switching

---

### 🔧 Supporting: Smooth Zone Transitions
**Priority**: LOW  
**Effort**: LOW  
**Impact**: MEDIUM (polish)

**Goal**: Eliminate "popping" artifacts when fovea crosses zone boundaries.

**Current State:**
- Mostly fixed with v1.3 smooth transitions
- Some residual hard jumps during rapid movement

**Proposed:**
- Temporal smoothing of zone transitions
- Velocity-gated transitions (smooth when stationary)
- Per-pixel transition history

**Implementation:**
- [ ] Add temporal smoothing buffer
- [ ] Velocity-based transition rate
- [ ] Test with rapid saccades

---

## Priority 3: Saliency Map - Design Tool + Core Simulation Enhancement

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

### Live Reference Targets (Replacements)
**Priority**: High
**Effort**: Low

**Issue**: Techmeme blocks bot traffic, and Figma is too complex for basic regression.
**Goal**: Identify 2-3 new, stable, bot-friendly live URLs for "wild" testing (e.g., Wikipedia, Hacker News).



## Priority 6: Future Enhancements

### Fixation Recording & Visualization
**Priority**: Medium  
**Effort**: High  
**Impact**: High (UX research, education, documentation)

**Goal**: Record sequences of eye fixations and generate visual artifacts showing attention flow and how the scene appeared at each fixation.

**Use Cases:**
- UX research: Show designers where users actually look
- Accessibility testing: Demonstrate peripheral vision effects on navigation
- Education: Teach about saccadic eye movements
- Documentation: Create "attention flow" diagrams for design reviews

#### Core Features

**Recording Mechanism:**
- Manual recording mode with keyboard shortcut (e.g., Cmd+R)
- Visual indicator when recording (red dot)
- Captures fixation sequence with timestamps and dwell times
- Configurable: record last N fixations or time-based duration

**Multi-Zone Capture Strategy:**
Biologically-accurate gradient capture instead of binary fovea/periphery:

```
Zone 1: Fovea (0-2°, ~180px radius)
  - Full resolution, no blur
  - Always captured per fixation
  
Zone 2: Parafovea (2-5°, ~180-450px)
  - 75% resolution, light blur
  - Captured if fixation moved >2°
  
Zone 3: Near Periphery (5-10°, ~450-720px)
  - 50% resolution, moderate blur  
  - Captured if fixation moved >5°
  
Zone 4: Mid Periphery (10-20°, ~720-1440px)
  - 25% resolution, heavy blur
  - Captured if fixation moved >10°
  
Zone 5: Far Periphery (>20°)
  - Static base layer (captured once)
  - Never updates during recording
```

**Optimization:** Reuse peripheral zones when fixations are close together, dramatically reducing storage requirements.

#### Output Formats

**Interactive HTML Export** (Phase 1):
- Self-contained HTML file with embedded data
- Scrubber to step through fixation sequence
- Toggle zones/layers on/off
- Show/hide saccade path visualization
- No external dependencies

**Animated Export** (Phase 2):
- GIF or WebM showing temporal sequence
- Smooth transitions between fixations
- Configurable playback speed
- Shareable on social media

**Layered Image Export** (Phase 3):
- PSD/XCF with separate layers per zone
- Vector layer for saccade path (numbered markers)
- Editable for design presentations
- Professional output for reports

#### Visualization Features

**Path Representation:**
- Numbered circles at fixation points (1, 2, 3...)
- Curved arrows showing saccade direction
- Dwell time encoded as circle size or color intensity
- Optional heatmap overlay showing cumulative attention

**Alternative Display Modes for Near-Foveal Content:**
- Highlight mode: Show parafoveal region with color overlay
- Comparison mode: Side-by-side foveal vs peripheral view
- Acuity gradient: Visualize the smooth falloff of visual acuity
- Zone boundaries: Toggle visibility of eccentricity zones

#### File Format

**`.scrutinizer` Archive:**
```
recording.scrutinizer/
├── metadata.json          # Fixation sequence, timestamps, settings
├── base.png              # Far peripheral base layer (static)
└── fixations/
    ├── 001/
    │   ├── fovea.png     # Zone 1
    │   ├── parafovea.png # Zone 2 (if captured)
    │   └── near.png      # Zone 3 (if captured)
    ├── 002/
    └── ...
```

Compressed as single `.scrutinizer` ZIP file.

#### Storage Estimates

**Example:** 1920×1080 page, 10 fixations
- Naive (10 full captures): ~80 MB
- Fovea-only: ~13 MB
- Multi-zone (optimal): ~25 MB
- **With zone reuse:** ~15-20 MB (close fixations)

#### Technical Implementation

**Dependencies:**
- Existing capture pipeline (1:1 fidelity)
- Visual memory mask system (can reuse for compositing)
- Structure map (for intelligent zone selection)

**Action Items:**
- [ ] Design recording UI (start/stop, indicator)
- [ ] Implement multi-zone capture system
- [ ] Create `.scrutinizer` file format spec
- [ ] Build HTML export with scrubber
- [ ] Add saccade path visualization
- [ ] Implement zone reuse optimization
- [ ] Create animated export (GIF/WebM)
- [ ] Add layered image export (PSD)

---

#### Preferences UI
- Persistent settings panel
- Default blur/radius values
- Capture quality settings

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
- **Pupil Dynamics**: Configuration for Saccadic Suppression (Velocity threshold, Reactivity, Min/Max Blur)
- **Real-time preview**: Live adjustment without recapture
- **Persistent profiles**: Save custom configurations

**Implementation notes**:
- Expose pyramid multipliers and zone radii as runtime config (not compile-time)
- Worker can rebuild pyramid with new multipliers
- Menu or panel UI for adjustment (possibly View → Simulation Fidelity submenu)
- Useful for researchers comparing different acuity models or designers stress-testing layouts
- [ ] **Custom SVG Overlays**: Allow aesthetic modes to define their own SVG overlays (e.g., Cyberpunk reticle, Wireframe grid) instead of the global debug overlay.



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

---

## Refactoring Opportunities

### 🔧 Code Quality Improvements


#### Consolidate Magic Numbers ✅
**Priority**: Low  
**Effort**: Low

**Completed**: Extracted fixation detection constants to `config.js`:
- [x] `fixationVelocityThreshold` (20.0 px/ms)
- [x] `dwellTimeThreshold` (50ms)
- [x] `saccadicSuppressionThreshold` (2.5 px/ms)
- [x] `velocityDecayMove` / `velocityDecayStop`
- [x] `foveaBypassMargin` (0.5x radius)


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

