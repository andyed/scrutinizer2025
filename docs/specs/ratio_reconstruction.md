# Ratio Reconstruction: Dual-LOD Structure Map Sampling

**Status:** Shipped (v2.3)
**Priority:** High. Fixes margin cliff-edge artifact with minimal risk.
**Difficulty:** Low (~1 hour). Two files, ~15 lines changed, no new uniforms or modes.
**Files:** `peripheral.frag`, `webgl-renderer.js`

## Effect on Whitespace

Scrutinizer is meant to show a layout the way users see it. Before v2.3, the rendering failed at every content boundary. When peripheral effects cliff-edge at DOM bounding boxes, the tool injects false salience: sharp transitions that don't exist in actual peripheral vision. A designer looking at their layout through Scrutinizer sees gutters, margins, and column gaps as sharp separators drawn at DOM bounding boxes, although at 10°+ eccentricity a 40px gap lies well inside the crowding zone of the text on either side. The tool therefore misrepresents whitespace, the most designable property of a layout.

Ratio reconstruction fixes this. Peripheral effects taper smoothly across content boundaries instead of stopping at the bounding box edge. The taper is a fixed 16×16-texel window (LOD 4) at every eccentricity, so it does not reproduce the crowding zone, which grows with eccentricity (Bouma's critical spacing at 10° is ~5°/~190px); see [WebGPU Pooling Alternative](#webgpu-pooling-alternative). A 40px gutter between dense columns no longer renders as a sharp separator in the periphery. By Bouma's law, *at this eccentricity the gutter is narrower than the crowding zone, so separating the columns needs more than spacing.*

This also unblocks the metamer mode spec, because content-adaptive grid sizing requires stable rhythm estimates that extend into margins, which is exactly what the ratio provides.

## Problem

The structure map has hard edges at content block boundaries. When a DOM element ends, density drops from ~0.8 to 0.0 over 1–2 pixels. The LGN stage reads this as "no content here" and kills distortion immediately, producing a visible seam where peripheral effects cliff-edge at the edge of detected content.

This is wrong perceptually, because crowding zones extend beyond the physical extent of content. Text at the edge of a block still crowds items on the far side of the adjacent whitespace.

## Approach

Sample the structure map at two MIP levels:

| Sample | LOD | Purpose |
|--------|-----|---------|
| Sharp | 0.0 | Type (text/image/UI) and density discrimination (needs per-block precision) |
| Blurred | 4.0 | Rhythm reconstruction (bleeds structure signal into margins) |

The blurred sample naturally extends content signals into surrounding whitespace via the GPU MIP chain. But raw blurred values are ambiguous: a density of 0.3 at LOD 4 could mean "sparse content everywhere" or "dense content nearby that's been averaged down."

**Ratio reconstruction** recovers the original rhythm by normalizing against the density channel at the same LOD:

```glsl
vec4 structureSharp = textureLod(u_structureMap, uv, 0.0);
vec4 structureBlur  = textureLod(u_structureMap, uv, 4.0);

float type    = structureSharp.b;   // sharp: text vs image
float density = structureSharp.g;   // sharp: is there content here?

// Ratio reconstruction: rhythm / density at matched LOD
// Both channels blur proportionally, so the ratio stays stable
float effectiveRhythm = structureBlur.r / max(structureBlur.g, 0.0005);
effectiveRhythm = clamp(effectiveRhythm, 0.0, 1.0);
```

The ratio works because rhythm (R) and density (G) are correlated: text blocks have both, and empty space has neither. When the MIP chain averages them down, both decay at the same rate, so their ratio is preserved deep into the blur halo. The `0.0005` floor prevents division-by-zero in empty regions.

## Changes Required

### 1. Enable MIP generation on structure map texture

`webgl-renderer.js`: structure map currently uses `gl.LINEAR` (no MIPs). Change to `LINEAR_MIPMAP_LINEAR` and call `generateMipmap()` after each upload:

```javascript
// Init (constructor)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

// uploadStructureMap()
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
gl.generateMipmap(gl.TEXTURE_2D);
```

Cost: one `generateMipmap()` per structure map upload (about once per content scan). Negligible.

### 2. Dual sampling in processLGN

`peripheral.frag`: replace the single `texture(u_structureMap, uv)` with dual `textureLod` calls:

```glsl
// Current (line ~696):
vec4 structure = texture(u_structureMap, uv);
signal.density = structure.g;
signal.rhythm  = structure.r;
signal.type    = structure.b;

// Proposed:
vec4 structureSharp = textureLod(u_structureMap, uv, 0.0);
vec4 structureBlur  = textureLod(u_structureMap, uv, 4.0);

signal.type    = structureSharp.b;
signal.density = structureSharp.g;

// Ratio reconstruction: stable rhythm estimate that bleeds into margins
float rawRhythm = structureBlur.r / max(structureBlur.g, 0.0005);
signal.rhythm  = clamp(rawRhythm, 0.0, 1.0);

// Blurred density for soft-edge gating (optional: expose as separate field)
signal.blurredDensity = structureBlur.g;
```

### 3. Soft-edge density gate (optional enhancement)

The V1 density-gated crowding (line ~773) currently uses sharp density, which also cliff-edges. The blurred density could provide a softer gate:

```glsl
// Blend sharp and blurred density for crowding gate
float gateDensity = max(signal.density, signal.blurredDensity * 2.0);
float densityCrowding = 1.0 / (1.0 + exp(-steepness * (gateDensity - threshold)));
```

This is optional and should be tested separately, because it changes the crowding validation results.

## WebGPU Pooling Alternative

The MIP-chain approach described above is a cheap approximation. The GPU MIP chain uses fixed 2× box-filter downsampling at each level and does not account for Bouma's law, eccentricity, or content semantics. LOD 4 averages over a 16×16 texel window regardless of where you are in the visual field.

The WebGPU compute pooling layer (in progress) can do this correctly:

| Property | MIP Chain (this spec) | WebGPU Pooling |
|----------|-----------------------|----------------|
| Pooling kernel | Fixed 2× box filter per level | Bouma-scaled Gaussian, eccentricity-dependent |
| Kernel size | Powers of 2 only (LOD 0–9) | Continuous, matched to 0.5× eccentricity |
| Content awareness | None (averages all channels uniformly) | Could weight by density, skip empty regions |
| Ratio reconstruction | Needed (raw blurred values are ambiguous) | Optional (pooling regions can be content-masked) |
| Implementation | Fragment shader `textureLod()` | Compute shader writes to intermediate texture |

**Decision point:** If the WebGPU pooling layer outputs a blurred structure map with Bouma-scaled kernels, ratio reconstruction applies directly to that output (ratio of pooled rhythm to pooled density). The math is identical; only the source of the blurred sample changes from `textureLod(LOD 4)` to `texture(u_pooledStructure)`.

If the pooling layer instead outputs pre-computed effective rhythm per pooling region (already ratio-corrected), then this spec's shader-side ratio division is unnecessary.

**Recommendation:** Wait for the pooling layer design to settle. If it outputs raw pooled channels → use ratio reconstruction on those. If it outputs derived signals → this spec reduces to "read the pooled output."

## What This Does NOT Do

- Does not change the V1 distortion algorithm (noise, grid, etc.)
- Does not add new uniforms or modes
- Does not affect the V4 MIP pooling / Bouma gate
- Does not require congestion map or saliency changes

## Validation

The margin cliff-edge is visible in golden captures. Look for abrupt transitions at paragraph/column edges. Before/after comparison at content boundaries is sufficient. No psychophysical stimulus was used. This validates the rendering artifact fix only; the gutter statements in [Effect on Whitespace](#effect-on-whitespace) rest on Bouma's law and are not tested here.

## Origin

Cherry-picked from the `metamer` branch (commit ab4d7f7). The metamer branch used this technique for its content-adaptive grid, but ratio reconstruction is independent of the grid system and applies directly to main's existing pipeline.
