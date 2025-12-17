# Release Notes v1.4.2

**Release Date:** December 16, 2025

## Highlights

### 👤 Face Detection (Saliency Integration)
Scrutinizer now uses **Face-API.js (Tiny Face Detector)** to detect faces in web content and heavily weight them in the saliency map.

- **Why?**: Humans are hard-wired to look at faces (the "Fusiform Face Area" effect). Standard color/contrast algorithms often miss them if they don't have high local contrast.
- **Implementation**: Runs in a Web Worker to avoid UI jank. Added as a "Face Channel" (weight: 0.5) to the Itti-Koch saliency model.
- **Multi-Resolution Processing**: Face detection runs at 640px max for accuracy; saliency DoG runs at 256px for speed.
- **Verification**: Verified using Ada Lovelace test suite and `verify-saliency-pixels.js` pixel-level tests.

### 📏 Structure Map Debug Annotations
When viewing the Structure Map debug overlay, text blocks now display their `lineHeight` value as a small label.

- **Visible Labels**: Dark pill-style annotations at the right edge of text blocks
- **Performance Optimized**: Max 50 annotations to prevent UI slowdown
- **Use Case**: Designers and researchers can quickly audit typography rhythm across a page

## Developer Notes
- **HUD Display Layer Stack**: New section in `developers_guide.md` documenting the z-index layering system (canvas z-100, SVG z-101, annotations z-102)

## Fixes
- **Worker Paths**: Resolved relative path resolution for worker scripts on packaged builds.
- **Stability**: Fixed memory management for image buffers during face detection.

### ☢️ Nuclear Scramble (Tier 3.0)
The peripheral distortion model enters "Tier 3" with a complete overhaul of how visual information degrades.
- **The Shredder**: Replacing smooth "heat haze" with a discrete grid scramble that physically severs vertical stems of letters.
- **Static Decay**: Animation has been completely removed. The periphery is now a static, broken texture—allowing users to saccade to a "ghost" that remains motionless.
- **Linear Progression**: Distortion scales linearly from a clean near-parafovea to a totally disintegrated far-periphery.
- **CA Suppression**: Chromatic Aberration is now suppressed in the scramble zone to prevent "glitch art" artifacts.

### 🔧 Fixes & Improvements
- **Cache Busting**: Implemented automatic cache clearing on startup to ensure shader updates are immediately applied.
- **Startup Reliability**: Fixed a race condition in `app.whenReady` that could cause the app to stall on launch.
