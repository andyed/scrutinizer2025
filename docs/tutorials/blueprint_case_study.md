# Case Study: Blueprint Mode

> **A practical guide to understanding how aesthetic modes work in Scrutinizer**

This document walks through the Blueprint mode implementation as an example of how to create, understand, and modify aesthetic modes. Blueprint serves as an excellent case study because it demonstrates key architectural patterns:

1. **V1 Bypass** - Disabling geometric distortion while keeping V4 aesthetics
2. **Edge Detection** - Using Sobel filters on structure map data
3. **Saliency-Driven Rendering** - Modulating visual output based on attention maps

---

## What Blueprint Does

Blueprint (Mode 3) is a "presentation mode" designed to visualize **Gestalt principles** in UI design. Instead of simulating biological peripheral vision, it reveals the underlying structure that Scrutinizer detects:

- **Edges between content blocks** are rendered as cyan wireframes
- **High-saliency areas** (faces, images, call-to-actions) glow brighter
- **No geometric distortion** - the page layout remains intact

**Use Case:** Design reviews, explaining visual hierarchy to stakeholders.

---

## Architecture: The Three-Stage Pipeline

Every mode in Scrutinizer flows through three stages:

```
LGN (Gating) → V1 (Geometry) → V4 (Aesthetics)
```

### Blueprint's Pipeline Configuration

From `shared/modes.json`:

```json
"blueprint": {
    "id": 3,
    "label": "Wireframe (Gestalt)",
    "pipeline": {
        "lgn_use_structure_mask": true,
        "lgn_use_saliency_gate": true,
        "lgn_ramp_end_mult": 2.0,
        "v1_distortion_type": 2,        // ← KEY: Type 2 = "None"
        "v1_strength_mult": 1.0,
        "v1_animate": false,
        "v4_style_id": 3                 // ← V4 renders the wireframe
    },
    "architectural_purpose": "Stress-test for V1 bypass while V4 renders from texture data"
}
```

### What Each Setting Does

| Setting | Value | Effect |
|---------|-------|--------|
| `v1_distortion_type: 2` | None | **Bypasses V1 entirely** - UV coordinates pass through unchanged |
| `v4_style_id: 3` | Wireframe | V4 runs Sobel edge detection on the structure map |
| `lgn_use_structure_mask: true` | On | Whitespace is protected (no rendering in empty areas) |
| `lgn_ramp_end_mult: 2.0` | 2x radius | Effect ramps up quickly outside fovea |

---

## Shader Implementation

The Blueprint logic lives in `renderer/shaders/peripheral.frag` (line ~821):

```glsl
} else if (config.v4_style_id == 3) { // Wireframe (Gestalt)
    // === QUANTIZED WIREFRAME (Gestalt) ===
    // V1 is forced to Type 2 (None), so v1.distortedUV equals original UV.
    
    // 1. Detect Edges on the UVs
    float edge = sobel(v1.distortedUV);
    
    // 2. Compute Edge Intensity (crisp lines)
    float edgeIntensity = smoothstep(0.05, 0.1, edge);
    
    // 3. Aesthetic Coloring
    vec3 baseColor = col; // Original (potentially blurred) color
    
    // Lines: Cyan/White, brighter in salient areas
    float s = texture(u_saliencyMap, v1.distortedUV).r; 
    vec3 lineCol = mix(vec3(0.0, 0.4, 0.6), vec3(0.5, 0.9, 1.0), s);
    
    // Overlay lines on base color
    return mix(baseColor, lineCol, edgeIntensity);
}
```

### Key Concepts Demonstrated

1. **Sobel Edge Detection** (`sobel()` function at line 153)
   - Detects luminance gradients using 3x3 kernel
   - Applied to the captured page content

2. **Saliency Modulation** (`texture(u_saliencyMap, ...)`)
   - Salient areas (high attention) get brighter cyan lines
   - Low-saliency areas get darker, subtler lines

3. **V1 Bypass Pattern**
   - When `v1_distortion_type == 2`, the V1 stage returns unchanged UVs
   - V4 receives clean coordinates to work with
   - This is a stress-test for the architecture: can V4 function independently?

---

## How to Modify Blueprint

### Example 1: Change Line Color to Orange

In `peripheral.frag`, find line ~842:

```glsl
// Before (Cyan)
vec3 lineCol = mix(vec3(0.0, 0.4, 0.6), vec3(0.5, 0.9, 1.0), s);

// After (Orange)
vec3 lineCol = mix(vec3(0.6, 0.3, 0.0), vec3(1.0, 0.6, 0.2), s);
```

### Example 2: Thicker Lines

Adjust the `smoothstep` threshold at line ~831:

```glsl
// Before (thin lines)
float edgeIntensity = smoothstep(0.05, 0.1, edge);

// After (thicker lines)
float edgeIntensity = smoothstep(0.02, 0.05, edge);
```

### Example 3: Add Grid Overlay

Add a subtle grid pattern:

```glsl
// After computing edgeIntensity, add:
vec2 gridUV = uv * u_resolution;
float grid = step(0.95, fract(gridUV.x / 50.0)) + step(0.95, fract(gridUV.y / 50.0));
edgeIntensity = max(edgeIntensity, grid * 0.3);
```

---

## Testing Your Changes

Since GLSL changes require app restart (see "Known Limitations" below), use this workflow:

1. **Edit shader** in `renderer/shaders/peripheral.frag`
2. **Restart app**: `Ctrl+C` then `npm run dev`
3. **Toggle to Blueprint**: Menu → Simulation → Behavior → Aesthetic Mode → Wireframe
4. **Navigate to test page**: Use a complex page like `file:///...tests/reference-pages/techmeme.html`

### Golden Capture Verification

After changes, regenerate golden captures to verify:

```bash
npm run capture-golden
```

Compare new images in `tests/golden-captures/v{version}/` to previous versions.

---

## Architectural Lessons from Blueprint

### 1. Modes as Test Cases

Blueprint exists not just for user utility, but to **validate the architecture**:

> "Can V4 render meaningful output when V1 is completely bypassed?"

If Blueprint breaks, it means the pipeline has a hidden V1 dependency. This principle applies to all modes - they're functional tests disguised as features.

### 2. Decoupled Pipeline Stages

Blueprint proves the stages are truly independent:
- **LGN** provides gating/masking (still active)
- **V1** is bypassed (distortion_type=2)
- **V4** operates on clean UVs with full access to texture maps

### 3. Texture Map Usage

Blueprint demonstrates proper texture map access:
- `u_structureMap` - Used indirectly via edge detection on content
- `u_saliencyMap` - Used directly for line brightness modulation

---

## Known Limitations

### Shader Monolith Problem

Currently, all shader code lives in a single 1160-line file (`peripheral.frag`). This creates challenges:

| Problem | Impact |
|---------|--------|
| **Merge conflicts** | Multiple researchers editing the same file |
| **Cognitive overload** | Finding the right function requires extensive scrolling |
| **No hot-reloading** | Must restart app for every GLSL change |
| **Testing difficulty** | Can't unit-test individual functions |

**Future Work:** Consider modular shader includes:

```
shaders/
├── common/noise.glsl
├── common/oklab.glsl
├── stages/lgn.glsl
├── stages/v1.glsl
├── stages/v4.glsl
├── modes/blueprint.glsl    ← Blueprint logic here
└── main.frag               ← Assembles all
```

This would allow researchers to add modes without touching the main shader.

---

## Summary

Blueprint demonstrates:

✅ How to bypass V1 while using V4  
✅ Edge detection on captured content  
✅ Saliency-driven visual modulation  
✅ The `modes.json` registry pattern  
✅ The three-stage pipeline architecture  

Use this as a template when creating your own modes. Modes are architectural stress-tests, not just visual filters.

---

## Further Reading

- [Developer's Guide: Adding a New Aesthetic Mode](developers_guide.md#adding-a-new-aesthetic-mode)
- [Foveated Vision Model](foveated-vision-model.md) - The biological basis
- [Mode Registry Reference](../shared/modes.json) - All mode configurations
