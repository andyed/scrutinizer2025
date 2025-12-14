# Release Notes v1.4.1: The "Lateral Smash" & Automation

**Release Date:** December 13, 2025

This patch release achieves a major milestone in simulating biological "Crowding" and lays the foundation for reliable, long-term testing.

## Highlights

### 💥 Tier 1.8.1: "The Lateral Smash" (Coherent Crowding)
We have successfully eliminated the "broken TV" digital artifacts of previous versions and replaced them with a physically cohesive crowding model that targets the **horizontal nature of reading**.

*   **Micro-Warp ("The Melter")**: Instead of pixel-level white noise, we now use high-frequency (900Hz) Simplex gradients to "twist" the individual strokes of letters and icons.
*   **Anisotropic Crowding**: Reading is a horizontal task. We now multiply horizontal distortion by **6.0x**. This forces letters to "slide" into their neighbors, merging separate glyphs into a single "mongrel" blob while preserving vertical structure (lists, paragraphs).
*   **Coupled Pooling**: The blur radius (MIP level) is now physically linked to the warp strength. If details are smashed, they are also blurred, preventing "sparkle" artifacts.

### 🤖 Automated Visual Test Suite
The days of manual regression testing are over. We've introduced a fully automated "Golden Image" pipeline (`npm run capture-golden`) that:
1.  Spawns isolated Electron instances for clean-room testing.
2.  Captures 18 critical scenarios across 6 archetypal "Reference Pages" (from "Google-style Lists" to "Dense News Sites").
3.  Verifies fixation at Center, Top-Left (Reading), and Sidebar.

This suite is the bedrock for our upcoming **Auto-Update** reliability testing.

### 📏 Foveal Calibration
Updated the calibration logic to support "Real-World" fixation behaviors:
*   **Reading Position**: Top-Left fixation is now calibrated to `(0.2, 0.2)` instead of `(0.0, 0.0)` to better reflect human gaze entry points.
*   **Debug Accuracy**: The `TEST_OVERLAY` modes now correctly use IPC commands to show the true foveal/parafoveal boundaries during testing.

## Developer Notes
*   **New Doc**: `docs/test_suite_reference.md` details all standard test cases and what to look for in regressions.
*   **Spec Update**: `docs/specs/mongrel_textures.md` now documents the Tier 1.8.1 implementation.
*   **Shader**: The core logic is in `peripheral.frag` under the `config.v1_distortion_type == 0` block.
