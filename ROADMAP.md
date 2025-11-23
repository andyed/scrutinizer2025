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

### Simulation Fidelity

- **Progressive eccentricity-based blur**
  - Replace the hard transition between sharp foveal region and uniformly blurred periphery with a gradual acuity falloff that better matches empirical eccentricity curves.
  - Use a radial weight field centered on the current fixation to blend multiple resolution layers (sharp + low-pass images), so blur strength increases with distance from the fovea.
  - Parameterize inner/outer radii in visual-angle terms once calibration exists.

- **Magnocellular-preserving low-pass filter**
  - Ensure the peripheral filter behaves like a Magnocellular-preserving low-pass, not a generic blur that wipes out all structure.
  - Specifically attenuate high spatial frequencies (fine detail, text) while preserving low spatial frequencies (gross shape and luminance contrast) that drive peripheral guidance.
  - Explore multi-scale decompositions (e.g., Laplacian/wavelet-style pyramids) to suppress higher bands while retaining low-frequency content, guided by psychophysical data.

#### Analytics (Optional)
- Anonymous usage statistics
- Crash reporting (Sentry, etc.)
- Opt-in telemetry

---

## Testing Checklist

Before 1.0 release, verify:

- [ ] All keyboard shortcuts work
- [ ] Navigation (back/forward/refresh) works correctly
- [ ] Foveal mode toggles properly
- [ ] Sliders update values in real-time
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
