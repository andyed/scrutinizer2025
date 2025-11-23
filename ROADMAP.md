# Scrutinizer 1.0 Roadmap

## Overview
This document outlines the path from current alpha to a production-ready 1.0 release.

---

## Priority 1: Core Functionality

### ✅ Already Complete
- [x] Foveal vision simulation with mouse tracking
- [x] Adjustable blur and radius controls
- [x] Keyboard shortcuts (Space, Escape, Wheel)
- [x] Basic navigation (back/forward, URL bar)
- [x] Scroll and DOM mutation detection

### 🔴 Critical for 1.0

#### Application Menus
**Priority**: High  
**Effort**: Medium

Implement native menu bar with:
- **File Menu**: 
  - New Window
  - Close Window
  - Quit
- **Edit Menu**:
  - Copy/Paste (standard shortcuts)
- **View Menu**:
  - Toggle Foveal Mode
  - Actual Size / Zoom In / Zoom Out
  - Toggle DevTools
- **Bookmarks Menu**:
  - Add Bookmark
  - Show All Bookmarks
  - Bookmark list
- **Help Menu**:
  - Documentation
  - Keyboard Shortcuts
  - About Scrutinizer

**Implementation**: Use Electron's `Menu` API in `main.js`

---

#### Bookmarking System
**Priority**: High  
**Effort**: Medium

Simple bookmark management:
- Add current page to bookmarks (Cmd/Ctrl+D)
- Bookmark manager UI (simple list)
- Persist bookmarks to JSON file
- Quick access from menu bar

**Files to create**:
- `renderer/bookmarks.js` - Bookmark logic
- `renderer/bookmarks.html` - Bookmark manager UI
- Store in user data directory via `app.getPath('userData')`

---

#### Homepage Configuration
**Priority**: High  
**Effort**: Low

- Add "Set as Homepage" option in menu
- Persist homepage URL to config file
- Load homepage on startup instead of hardcoded URL
- Settings UI to edit homepage

**Implementation**: Extend `config.js` with persistent storage

---

## Priority 2: Distribution & Release

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

## Priority 3: Edge Cases & Polish

### 🟢 Nice-to-have for 1.0

#### Popup Handling
**Priority**: Medium  
**Effort**: Medium

**Current issue**: `allowpopups` on webview may open popups uncontrolled

**Solutions**:
- Intercept `new-window` events on webview
- Show popup in new Scrutinizer window (with foveal mode)
- Or open in system browser with user confirmation

---

#### Embedded Video Support
**Priority**: Medium  
**Effort**: Low (Testing)

**Test cases**:
- YouTube embedded players
- Vimeo, other video platforms
- HTML5 `<video>` elements

**Known limitation**: Canvas capture may not capture video frames (security restriction)

**Potential workaround**: Detect video elements and exclude from blur region

---

#### CORS & Capture Failures
**Priority**: Medium  
**Effort**: Medium

**Issue**: Some sites block `html2canvas` due to CORS policies

**Solutions**:
- Graceful error handling with user notification
- Fallback: Disable foveal mode for incompatible sites
- Document known incompatible sites

---

#### Performance Optimization
**Priority**: Medium  
**Effort**: Medium

For large/complex pages:
- Implement progressive capture (viewport only)
- Reduce capture frequency for static content
- Add loading indicator during capture
- Optimize blur algorithm (consider WebGL shader)

---

## Priority 4: Future Enhancements (Post-1.0)

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

#### Analytics (Optional)
- Anonymous usage statistics
- Crash reporting (Sentry, etc.)
- Opt-in telemetry

---

## Testing Checklist

Before 1.0 release, verify:

- [ ] All keyboard shortcuts work (Alt+Space, Alt+wheel)
- [ ] Navigation (back/forward/refresh) works correctly
- [ ] Foveal mode toggles properly
- [ ] Menu controls update values in real-time
- [ ] Scroll tracking maintains alignment
- [ ] Bookmarks save and load correctly
- [ ] Homepage setting persists across restarts
- [ ] Builds successfully on macOS, Windows, Linux
- [ ] App launches without errors on fresh install
- [ ] Memory usage is reasonable (<500MB for typical page)
- [ ] No console errors in production build

---

## Release Timeline Estimate

| Phase | Duration | Tasks |
|-------|----------|-------|
| **Phase 1**: Core Features | 1-2 weeks | Menus, bookmarks, homepage |
| **Phase 2**: Build & Package | 3-5 days | electron-builder config, test builds |
| **Phase 3**: Testing & Polish | 1 week | Edge cases, documentation, bug fixes |
| **Phase 4**: Release | 1-2 days | Final builds, GitHub release, announcements |

**Total estimated time**: 3-4 weeks for solo developer

---

## Open Questions

1. **Target platforms**: All three (macOS/Windows/Linux) or start with one?
2. **Code signing**: Worth the cost for 1.0 or defer to 1.1?
3. **Distribution**: GitHub releases only, or also submit to app stores?
4. **Monetization**: Free and open source, or paid app?
5. **Support**: GitHub issues only, or dedicated support channel?

---

## Success Metrics for 1.0

- App launches successfully on all target platforms
- Core foveal simulation works on 90%+ of websites
- No critical bugs in basic navigation/interaction
- Documentation is clear enough for non-technical users
- At least 10 beta testers provide positive feedback
