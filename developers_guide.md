# Developers Guide: Peripheral Models

This guide outlines the process for implementing and testing new peripheral vision models (visual transforms) in Scrutinizer.

## Architecture Overview

Scrutinizer uses a custom WebGL renderer (`webgl-renderer.js`) to apply fragment shaders to captured browser content. The core logic resides in the fragment shader's `main` function, which determines how pixels are processed based on their distance from the fovea (mouse cursor).

### Key Components

1.  **`webgl-renderer.js`**: The main WebGL class. Contains the shader source code (`fsSource`) and handles uniform binding.
2.  **`scrutinizer.js`**: The high-level controller that manages the renderer, mouse tracking, and configuration.
3.  **`menu-template.js`**: Defines the application menu, including simulation settings.

## Adding a New Peripheral Model

To add a new visual effect (e.g., "Deep Texture Mongrel"):

### 1. Define the Mode
Add a new mode ID in `menu-template.js` and `webgl-renderer.js`.
-   **0.0**: Noise (Dynamic)
-   **1.0**: Shatter (Static)
-   **2.0**: [Your New Model]

### 2. Implement Shader Logic
In `webgl-renderer.js`, locate the `// === 3. MONGREL EFFECT SELECTION ===` block in the fragment shader. Add a new branch for your mode:

```glsl
if (u_mongrel_mode > 1.5) {
    // === MODE 2: YOUR NEW MODEL ===
    // Implement your texture sampling logic here
    // Output: vec4 color
}
```

**Best Practices:**
-   **Pixel Transforms > Color**: Focus on spatial distortions (UV manipulation) rather than just color filters.
-   **Performance**: Avoid heavy loops. Use `texture2D` lookups efficiently.
-   **Rod Vision**: The "Rod Vision" (Purkinje Shift) effect is applied *after* your model in step 7. Ensure your model outputs a valid RGB color that plays well with low-light simulation.

### 3. Expose in UI
Update `menu-template.js` to add a radio button for your new mode in the "Mongrel Mode" submenu.

```javascript
{
    label: 'My New Model',
    type: 'radio',
    click: () => sendToOverlays('menu:set-mongrel-mode', 2)
}
```

## Testing & Verification

1.  **Visual Inspection**: Use the "Debug: Show Boundary" option to see exactly where the fovea ends and your effect begins.
2.  **Performance**: Monitor the frame rate. Complex shaders can drop frames on high-resolution displays.
3.  **Edge Cases**: Check the browser scrollbar (right edge) to ensure it remains usable (excluded from effects).

## Future Roadmap: Abstraction

We plan to abstract the "Peripheral Model" into a pluggable system where shaders can be loaded dynamically or defined in separate files, making it easier to experiment with deep-learning-based texture synthesis models.
