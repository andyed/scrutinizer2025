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
