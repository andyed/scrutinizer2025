# Developers Guide: Peripheral Models

This guide outlines the process for implementing and testing new peripheral vision models (visual transforms) in Scrutinizer.

## Architecture Overview

Scrutinizer uses a custom WebGL renderer (`webgl-renderer.js`) to apply fragment shaders to captured browser content. The core logic resides in the fragment shader's `main` function, which determines how pixels are processed based on their distance from the fovea (mouse cursor).

### Key Components

1.  **`webgl-renderer.js`**: The main WebGL class. Contains the shader source code (`fsSource`) and handles uniform binding.
2.  **`scrutinizer.js`**: The high-level controller that manages the renderer, mouse tracking, and configuration.
3.  **`menu-template.js`**: Defines the critical application menu, including simulation settings.
4.  **`docs/architecture-module-pattern.md`**: **CRITICAL** - Explains the hybrid CommonJS/Window module pattern used to prevent `ReferenceError`s. Read this before refactoring any class files.

## Adding a New Peripheral Model (WIP API)

Currently, adding a new visual effect involves modifying the core shader code. We are working on a plugin API to allow dynamic loading of effects.

### 1. Define the Mode
Add a new mode ID in `menu-template.js` and `webgl-renderer.js`.
-   **0.0**: High-Key Ghosting (Default)
-   **1.0**: Lab Mode (Scotopic)
-   **2.0**: Frosted Glass
-   **3.0**: Blueprint
-   **4.0**: Cyberpunk
-   **5.0**: [Your New Model]

### 2. Implement Shader Logic
In `webgl-renderer.js`, locate the `applyAestheticEffect` function in the fragment shader. Add a new branch for your mode:

```glsl
} else if (u_aesthetic_mode < 5.5) {
    // === 5: YOUR NEW MODEL ===
    // Implement your visual transform here
    
    // Example: Simple Red Tint
    vec3 redTint = vec3(1.0, 0.0, 0.0);
    vec3 final = mix(col, redTint, effectFactor);
    
    return mix(col, final, effectFactor);
}
```

**Best Practices:**
-   **Visual Scent**: The goal is to provide a "scent" of the content without full detail.
-   **Performance**: Avoid loops. Use `texture2D` lookups efficiently.
-   **Explicit Sequencing**: If using distortion, calculate the offset *once* and reuse it for all samples to save performance.

### 3. Expose in UI
Update `menu-template.js` to add a radio button for your new mode in the "Aesthetic Mode" submenu.

```javascript
{
    label: 'My New Model',
    type: 'radio',
    click: () => sendToOverlays('menu:set-aesthetic-mode', 5)
}
```

## Future Roadmap: Abstraction

We plan to abstract the "Peripheral Model" into a pluggable system where shaders can be loaded dynamically or defined in separate files, making it easier to experiment with deep-learning-based texture synthesis models.
