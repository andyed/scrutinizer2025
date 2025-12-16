# Visual Test Suite Reference

This document outlines the standard test pages and scenarios used in the automated visual regression suite (`npm run capture-golden`).

## Reference Pages

The suite targets a set of local HTML files representing common web UI archetypes. These are located in `tests/reference-pages/`.

| Page | Archetype | Key Features to Observe |
|:-----|:----------|:------------------------|
| **dashboard.html** | SaaS / App UI | "Google Search" style list. Sidebar + Main content. Good for testing Lateral Smash on list items. |
| **article.html** | Reading Layout | Long-form centered text. Standard blog/news reading experience. |
| **ecommerce.html** | Retail Grid | Image heavy, grid layout. Product cards. Verifies image preservation + text distortion. |
| **grid.html** | Geometric Calibration | Pure grid of circles/lines. Used for verifying geometric warp linearity and overlay alignment. |

## Test Scenarios (Fixations)

For each page, the suite captures screenshots with the fovea positioned at three critical points to verify different eccentricities.

### 1. Center (`_center.png`)
*   **Coordinates**: `0.5, 0.5` (Mid-screen)
*   **Purpose**: Standard viewing. Verifies foveal clarity in the middle of content and peripheral degradation at edges.

### 2. Top-Left (`_top_left.png`)
*   **Coordinates**: `0.2, 0.2` (Reading start)
*   **Purpose**: Simulates reading or navigating headers. Verifies that the bottom-right periphery distorts correctly without breaking the layout.

### 3. Sidebar (`_sidebar.png`)
*   **Coordinates**: `0.15, 0.5` (Navigation focus)
*   **Purpose**: Mimics looking at a sidebar menu. Verifies that the main content area (now in periphery) is degraded but structurally present.

## Variants

### Saliency Map (`_saliency.png`)
*   **Description**: Raw **Saliency Texture** debug view.
*   **Purpose**: Verify the heatmap integrity (Blue→Green→Red). **Critical Regression Check**: Ensure it is not solid red.

### Structure Map (`_structure.png`)
*   **Description**: Raw **Structure Texture** debug view.
*   **Purpose**: Verify density clustering and type packing. **Critical Regression Check**: Ensure individual blocks are visible and not "over-painted".

## Automated Capture

Run the following command to regenerate all golden images:

```bash
npm run capture-golden
```

**Artifacts Location**: `tests/golden-captures/v1.4.2/`

## Debug Verification (CLI Flags)

You can force specific debug modes using CLI arguments. This is critical for verifying the underlying feature maps before running a full regression suite.

| Flag | Effect | Pass Criteria (What to look for) | Fail Criteria (Red Flags) |
|:-----|:-------|:---------------------------------|:--------------------------|
| `--debug-saliency` | Shows Saliency Heatmap | **Blue/Green/Red Gradient**. Text/Edges should be Red. Background should be Blue. | **Solid Red Screen** (Data corruption/overflow). **Solid Blue** (Empty map). |
| `--debug-saliency` | Shows Saliency Heatmap | **Blue/Green/Red Gradient**. Text/Edges should be Red. Background should be Blue. | **Solid Red Screen** (Data corruption/overflow). **Solid Blue** (Empty map). |
| `--debug-structure` | Shows Structure Map | **Red Overlay**. Density determines opacity. Blocks should match page content. | **"Shredded" Noise** (Byte packing error). **Invisible** (Alpha channel issue). |

## Verification Patterns

We use two distinct testing patterns depending on the scope of the feature.

### 1. Targeted Verification Scripts
**When to use:** For specific, isolated features (like **Face Detection**) where a full regression suite is overkill or where custom setup (e.g., specific loading time, specific image content) is required.

*   **Pattern**: Create a standalone Node.js script in `scripts/` (e.g., `scripts/verify-face-detection.js`) that launches Electron with specific flags and captures a single output.
*   **Pros**: Fast iteration, isolated environment.
*   **Cons**: Does not test integration with other pages.

### 2. Full Regression Suite
**When to use:** Before any release or major merge.

*   **Pattern**: `npm run capture-golden`
*   **Pros**: Tests all reference pages and fixations.
*   **Cons**: Slow (~2-3 mins).

## Face Detection Verification

A targeted test exists to verify the "Face Channel" integration. This test loads a page with a known face (`text/reference-pages/face-test.html`) and captures the saliency map.

### Running the Test
```bash
node scripts/verify-face-detection.js
```

### Pass Criteria
*   The output image (`tests/verification/face_detection_result.png`) must show a **bright red/white hotspot** directly over the face.
*   The hotspot should be roughly Gaussian (soft circular blob).

### Example Usage
```bash
# Verify Saliency Map is working
npm start -- --debug-saliency

# Verify Structure Map packing
npm start -- --debug-structure
```

## Critical Verification Checklist
Before shipping ANY change to `structure-map.js` or `peripheral.frag`, you MUST manualy verify:

1.  **Saliency Map Integrity**: Run `--debug-saliency`. If it looks like a solid color, **STOP**. You have broken the mapping.
2.  **Blueprint Mode Clarity**: Run `--blueprint`. Images should be **solid blocks**, not "fuzz". Text should be "schematic lines".
3.  **Red Saliency Regression**: We have hit this twice. Always check that the saliency map is NOT full-red.

