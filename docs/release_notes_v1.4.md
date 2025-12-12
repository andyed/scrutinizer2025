# Release Notes v1.4

**Release Date:** December 11, 2025

## Highlights

### 🎨 Visual Overlay Refinement
The debug boundary system has been overhauled and renamed to **Visual Overlay**.
- **Renamed Options**: "Grid (Hi-Tech)" is now clearly labeled "**Fovea + Parafovea + Periphery**".
- **Linear Spacing**: The radial grid now uses evenly spaced rings to match linear acuity reduction, replacing the previous exponential spacing.
- **Variable Stroke Width**: Grid lines now become thinner as they move further from the fovea, adding depth and reducing visual clutter in the far periphery.

### ⚡️ 10x Performance Boost for Overlays
We addressed significant lag in the Radial Grid overlay.
- **Group Translation**: The grid is now treated as a single rigid object, transforming the entire group instead of 50+ individual elements per frame.
- **Smart Filtering**: Expensive drop-shadow filters are now automatically disabled when the complex grid is active, eliminating compositor lag.

### 🌈 Oklab Saliency (Biological Accuracy)
The feature extraction engine for our Saliency Maps now uses the **Oklab** color space instead of RGB.
- **Why?**: Standard RGB is not perceptually uniform. Oklab separates Lightness (L) from Color (a, b) in a way that perfectly mimics the human eye's Magnocellular (Luminance) and Parvocellular (Color) pathways.
- **Benefit**: Saliency detection is now more stable and matches the "rod vision" simulation used in the main renderer.

### 🚫 Inhibition of Return
A new Visual Memory mode that mimics the brain's tendency to de-prioritize recently visited locations.
- **New Mode**: Available under `Visual Memory > Inhibition of Return (10 fixations)`.
- **Function**: Recently fixated areas become **suppressed** (more distorted) rather than cleared, simulating a drop in saliency. This forces the user to seek new information rather than re-fixating on old content.


### 💅 UI Polish
- **Less Distracting URL Bar**: The toolbar URL input is now dimmer and semi-transparent by default, reducing visual competition with the canvas. It automatically brightens on hover or focus.
- **Menu Terminology**: "Mongrel Mode" has been renamed to "**Effect Type**" to better reflect its function. "Shatter" is now "**Mongrel Approximation**".

## Developer Notes
- **Custom Overlays Guide**: Added a new section to `docs/developers_guide.md` explaining how to implement high-performance custom overlays using the new Group Translation pattern.
