# Case Study: Blueprint Mode

> **A practical guide to understanding how aesthetic modes work in Scrutinizer**

This document walks through the Blueprint mode implementation as an example of how to create, understand, and modify aesthetic modes. It covers three architectural patterns:

1. **V1 Bypass** - Disabling geometric distortion while keeping V4 aesthetics
2. **Edge Detection** - Box outlines from edges in the structure map, plus faint Sobel edges on the captured page content
3. **Saliency-Driven Rendering** - Modulating visual output based on attention maps

---

## What Blueprint Does

Blueprint (Mode 3) is a "presentation mode." In place of a peripheral-vision simulation, it shows the layout structure Scrutinizer detects (ARIA roles and the content blocks produced by the scanner's Gestalt grouping):

- **Content blocks** are drawn as bounding boxes color-coded by ARIA role (button, link, input, heading, nav, media, and so on) over a blueprint grid
- **High-saliency areas** glow brighter, and feature congestion sets how opaque the blueprint tint is
- **Fine image edges** (Sobel on the page content) are overlaid faintly
- **No geometric distortion** - the page layout remains intact, and the fovea shows the original page

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
    "label": "Blueprint (ARIA Wireframe)",
    "pipeline": {
        "lgn_use_structure_mask": true,
        "lgn_use_saliency_gate": true,
        "lgn_ramp_end_mult": 2.0,
        "v1_distortion_type": 2,        // ← KEY: Type 2 = "None"
        "v1_strength_mult": 1.0,
        "v1_animate": false,
        "v4_style_id": 3,                // ← V4 renders the wireframe
        "reading_span": true,
        "reading_span_strength": 1.0
    },
    "architectural_purpose": "ARIA-typed wireframe visualization — structure map alpha channel encodes role IDs (0–12), shader renders color-coded bounding boxes"
}
```

### What Each Setting Does

| Setting | Value | Effect |
|---------|-------|--------|
| `v1_distortion_type: 2` | None | **Bypasses V1 entirely** - UV coordinates pass through unchanged |
| `v4_style_id: 3` | Wireframe | V4 draws role-colored boxes from the structure map, plus faint Sobel edges of the page |
| `lgn_use_structure_mask: true` | On | Whitespace is protected (no rendering in empty areas) |
| `lgn_ramp_end_mult: 2.0` | 2x radius | Effect ramps up quickly outside fovea |

---

## Shader Implementation

The Blueprint logic is the `config.v4_style_id == 3` branch of `processV4()` in `renderer/shaders/peripheral.frag` (search for `Blueprint (ARIA Wireframe)`). Abridged:

```glsl
} else if (config.v4_style_id == 3) { // Blueprint (ARIA Wireframe)
    vec4 structure = texture(u_structureMap, v1.distortedUV);
    float type = structure.b;
    float density = structure.g;
    int roleId = int(structure.a * 12.0 + 0.5);   // ARIA role ID (0–12) in alpha

    vec4 salTex = texture(u_saliencyMap, v1.distortedUV);
    float saliency = salTex.r;
    // congestion: u_congestionMap when available, else salTex.g

    // 1. Box outlines: edges in the structure map's density (G) and type (B) channels
    float isEdge = smoothstep(0.02, 0.08, max(structEdge, typeEdge));

    // 2. Role-based color palette
    if (roleId == 1) roleColor = vec3(0.2, 0.8, 0.4);       // button: green
    else if (roleId == 2) roleColor = vec3(0.3, 0.6, 1.0);   // link: blue
    // ... input, heading, nav, media, list, menu, checkbox, dialog, header, footer

    // 3. Blueprint background: dimmed page plus grid; congestion darkens the tint
    vec3 bgColor = mix(pageGhost, vec3(0.06, 0.09, 0.18), congestion * 0.7);

    // 4. Compose: congestion sets fill strength, saliency brightens, outlines in role color
    wireframe = mix(wireframe, roleColor * (0.6 + saliency * 0.4), isEdge);

    // 5. Fine image edges (Sobel on the page content), at 30% weight
    float fineEdge = smoothstep(0.05, 0.15, sobel(v1.distortedUV));

    // 6. Fovea shows the original page; periphery fades to the wireframe
    float blueprintFade = smoothstep(fovea_radius * 0.3, fovea_radius * 1.2, dist);
    return mix(fovealBlend, wireframe, blueprintFade);
}
```

### Key Concepts Demonstrated

1. **Structure-Map Outlines and Role Colors**
   - Box outlines come from differences between neighboring structure-map texels in the density (G) and type (B) channels
   - An ARIA role ID (0–12) is stored in the alpha channel and selects the outline and fill color

2. **Sobel Edge Detection** (`sobel()` helper)
   - Detects intensity gradients (red channel) with a 3x3 kernel
   - Applied to the captured page content (`u_texture`), blended in at 30%

3. **Saliency Modulation** (`texture(u_saliencyMap, ...)`)
   - Salient areas (high attention) get brighter role-colored lines and fills
   - Low-saliency areas get darker, subtler lines

4. **V1 Bypass Pattern**
   - When `v4_style_id == 3`, `main()` forces `v1_distortion_type = 2`, so the V1 stage returns unchanged UVs
   - V4 receives clean coordinates to work with
   - This is a stress-test for the architecture: can V4 function independently?

---

## How to Modify Blueprint

### Example 1: Change the Button Color to Orange

In the Blueprint branch of `peripheral.frag`, find the role palette:

```glsl
// Before (green)
if (roleId == 1) roleColor = vec3(0.2, 0.8, 0.4);       // button: green

// After (orange)
if (roleId == 1) roleColor = vec3(1.0, 0.6, 0.2);       // button: orange
```

### Example 2: Thicker Outlines

Lower the `smoothstep` thresholds on the structure-map edge signal:

```glsl
// Before (thin outlines)
float isEdge = smoothstep(0.02, 0.08, max(structEdge, typeEdge));

// After (thicker outlines)
float isEdge = smoothstep(0.01, 0.04, max(structEdge, typeEdge));
```

### Example 3: Denser Grid

Blueprint already draws a grid (major lines every 100px, minor every 20px). To halve the major spacing:

```glsl
// Before
float gridMajor = step(0.97, max(fract(gridUV.x / 100.0), fract(gridUV.y / 100.0)));

// After
float gridMajor = step(0.97, max(fract(gridUV.x / 50.0), fract(gridUV.y / 50.0)));
```

---

## Testing Your Changes

Since GLSL changes require app restart (see "Known Limitations" below), use this workflow:

1. **Edit shader** in `renderer/shaders/peripheral.frag`
2. **Restart app**: `Ctrl+C` then `npm run dev`
3. **Toggle to Blueprint**: Menu → Simulation → Utility → Test Modes → Wireframe (Gestalt)
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

Blueprint also serves to **validate the architecture**:

> "Can V4 render meaningful output when V1 is completely bypassed?"

If Blueprint breaks, the pipeline has a hidden V1 dependency. Every mode can serve as a functional test of the stages it uses in the same way.

### 2. Decoupled Pipeline Stages

Blueprint shows that V4 can run with V1 bypassed:
- **LGN** provides gating/masking (still active)
- **V1** is bypassed (distortion_type=2)
- **V4** operates on clean UVs with full access to texture maps

### 3. Texture Map Usage

Blueprint reads two texture maps:
- `u_structureMap` - Used directly: role IDs (alpha), density (G) and type (B) are the inputs for the box outlines and colors
- `u_saliencyMap` - Used directly for line and fill brightness (and its G channel for congestion when no congestion map is available)

---

## Known Limitations

### Shader Monolith Problem

Currently, all shader code is in a single 2620-line file (`peripheral.frag`). The single file has these drawbacks:

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
✅ Structure-map outlines plus Sobel edges on captured content  
✅ Saliency-driven visual modulation  
✅ The `modes.json` registry pattern  
✅ The three-stage pipeline architecture  

Use this as a template when creating your own modes.

---

## Further Reading

- [Developer's Guide: Adding a New Aesthetic Mode](../developers_guide.md#adding-a-new-aesthetic-mode)
- [Foveated Vision Model](../foveated-vision-model.md) - The biological basis
- [Mode Registry Reference](../../shared/modes.json) - All mode configurations
