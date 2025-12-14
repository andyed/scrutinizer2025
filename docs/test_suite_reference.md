# Visual Test Suite Reference

This document outlines the standard test pages and scenarios used in the automated visual regression suite (`npm run capture-golden`).

## Reference Pages

The suite targets a set of local HTML files representing common web UI archetypes. These are located in `tests/reference-pages/`.

| Page | Archetype | Key Features to Observe |
|:-----|:----------|:------------------------|
| **techmeme.html** | Dense Text Media | Multi-column, high-density text. Critical for verifying "crowding" and legibility limits. |
| **dashboard.html** | SaaS / App UI | "Google Search" style list. Sidebar + Main content. Good for testing Lateral Smash on list items. |
| **ecommerce.html** | Retail Grid | Image heavy, grid layout. Product cards. Verifies image preservation + text distortion. |
| **article.html** | Reading Layout | Long-form centered text. Standard blog/news reading experience. |
| **figma.html** | Complex App | Mimics Figma UI. Toolbars, canvas, dense panels. Verifies UI element stability (Type 3 Distortion). |
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

### Overlay (`_overlay.png`)
*   **Enabled For**: `techmeme`, `figma` (specifically)
*   **Description**: Draws the **Parafoveal Debug Rings** (Mode 2.0).
*   **Purpose**: Visual verification of the "Fovea vs. Parafovea" boundaries against the actual content.

## Automated Capture

Run the following command to regenerate all golden images:

```bash
npm run capture-golden
```

**Artifacts Location**: `tests/golden-captures/v1.4.1/`
