# Release Notes v1.4.2

**Release Date:** December 16, 2025

## Highlights

### 👤 Face Detection (Saliency Integration)
Scrutinizer now uses **Face-API.js (Tiny Face Detector)** to detect faces in web content and heavily weight them in the saliency map.

- **Why?**: Humans are hard-wired to look at faces (the "Fusiform Face Area" effect). Standard color/contrast algorithms often miss them if they don't have high local contrast.
- **Implementation**: Runs in a Web Worker to avoid UI jank. Added as a "Face Channel" (weight: 0.5) to the Itti-Koch saliency model.
- **Verification**: Verified using Ada Lovelace test suite.

## Fixes
- **Worker Paths**: Resolved relative path resolution for worker scripts on packaged builds.
- **Stability**: Fixed memory management for image buffers during face detection.
