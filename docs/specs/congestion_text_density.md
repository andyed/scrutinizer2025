# Congestion Gate: Text Density Enhancement

**Status:** Spec (v2.2 target)
**Depends on:** Wave 5 Halverson findings (v2.1)
**Goal:** Graduate Mode 9 (Congestion-Gated Pooling) from experimental to default

## Problem

The congestion gate (Rosenholtz Feature Congestion) does not respond to text density. The Halverson mixed-density stimulus — 5 sparse words vs 10 dense words at matched eccentricities — registers as **0/100 congestion** across the entire layout. Dense and sparse groups produce identical congestion values because Feature Congestion measures color variance, luminance contrast, and orientation energy, not character packing.

### v2.1 evidence

| Metric | Sparse groups | Dense groups | Expected |
|--------|--------------|-------------|----------|
| Congestion score | ~0 | ~0 | Dense >> Sparse |
| SSIM (Mode 0, r=60) | 0.985 | 0.986 | Sparse > Dense |
| SSIM (Mode 9, r=60) | 0.986 | 0.987 | Sparse > Dense |
| Mode 9 vs Mode 0 | +0.1% discrimination | — | Significant |
| OCR legibility | 100% both | 100% both | Sparse > Dense |

The density gate operates at DOM structure block level. A sparse group (5 words, 0.65° spacing) and a dense group (10 words, 0.33° spacing) register as similar-sized blocks. The intra-group text density that Halverson & Hornof found critical (nearest-neighbor < 0.15° threshold) is below the resolution of the structure map.

## What "text density" means

Halverson's TEE model defines density by **nearest-neighbor distance** between text items:
- Sparse: nearest neighbor ≥ 0.15° → 90% encoding accuracy
- Dense: nearest neighbor < 0.15° → 50% encoding accuracy

This is not visual complexity (Feature Congestion). It's spatial packing of discrete readable elements. The biological basis: crowding in peripheral vision scales with the number of items competing for the same pooling region, not with the visual richness of those items.

## Proposed approaches

### Option A: Pixel-level edge density in shader (preferred)

Compute local edge density directly from the source texture within the fragment shader. No DOM dependency, no content analysis latency.

**Mechanism:**
1. Sample a local neighborhood (e.g., 8×8 pixel kernel) around the current fragment
2. Count high-gradient transitions (Sobel or simple luminance differences)
3. Normalize to edges-per-degree² using the known PPD
4. Feed into the congestion gate as a `textDensity` signal alongside Feature Congestion

**Shader pseudocode:**
```glsl
float localEdgeDensity(vec2 uv, float kernelSizePx) {
    float edges = 0.0;
    vec2 texel = 1.0 / u_resolution;
    for (int dy = -4; dy <= 4; dy++) {
        for (int dx = -4; dx <= 4; dx++) {
            float here = luminance(texture(u_texture, uv + vec2(dx, dy) * texel).rgb);
            float right = luminance(texture(u_texture, uv + vec2(dx+1, dy) * texel).rgb);
            float below = luminance(texture(u_texture, uv + vec2(dx, dy+1) * texel).rgb);
            edges += step(0.1, abs(here - right) + abs(here - below));
        }
    }
    return edges / 81.0; // normalize to [0, 1]
}
```

**Integration with congestion gate:**
```glsl
float congestionBoost = 1.0 + max(lgn.congestion, localEdgeDensity) * 1.0;
```

**Pros:** Real-time, no pipeline dependency, responds to actual pixel content not DOM abstractions.
**Cons:** Expensive (81 texture fetches per fragment). Mitigate with: MIP-level sampling at lower resolution, or precompute into a texture in a separate pass.

### Option B: Content analysis text detector

Add a text density channel to the content analysis pipeline (runs in overlay.js).

**Mechanism:**
1. In the existing structure map computation, count DOM text nodes per spatial cell
2. Weight by inverse inter-element spacing (closer = denser)
3. Write to an unused channel of the structure map or congestion map

**Pros:** Leverages existing DOM analysis, semantically accurate (knows what's text vs image).
**Cons:** Same DOM block-level granularity problem — unless we switch to per-character bounding boxes via `Range.getClientRects()`.

### Option C: Hybrid — precomputed edge density texture

Run edge density as a separate compute pass (like the congestion worker) on the captured frame.

**Mechanism:**
1. Downsample the capture to 256×256
2. Compute Sobel magnitude per pixel
3. Box-blur to get local edge density field
4. Upload as a texture channel

**Pros:** Cheap (one pass), resolution-independent, doesn't fight the fragment shader budget.
**Cons:** Adds another async texture upload; latency on first frame.

## Validation protocol

Re-run the Halverson pipeline with the text density enhancement:

1. **Capture** mixed condition at radius=60-90px with enhanced congestion gate
2. **Measure** per-group SSIM and OCR legibility (baseline infrastructure from v2.1)
3. **Target:** sparse/dense SSIM ratio > 1.05 (sparse better preserved than dense)
4. **Stretch:** OCR legibility ratio matches H&H's 90%/50% encoding accuracy pattern

### Graduation criteria for Mode 9 → default

| Criterion | Threshold | Rationale |
|-----------|-----------|-----------|
| Text density discrimination | Sparse/dense SSIM ratio > 1.05 on Halverson | Matches H&H behavioral prediction |
| No regression on existing waves | Wave 1-4 Tier 1 tests still pass | Don't break what works |
| Performance | < 2ms additional GPU time per frame | Must stay real-time on integrated GPU |
| UEyes benchmark | Higher correlation with fixation density than Mode 0 | External validation on real UI layouts |

## Biological grounding

The text density signal maps to **crowding zone occupancy** — how many items fall within the critical spacing (Bouma's law: ~0.5× eccentricity). Pelli et al. (2004) showed that crowding is the primary limit on peripheral letter recognition, and it depends on the number of flanking items, not their visual complexity. Feature Congestion captures clutter (visual complexity); text density captures crowding (spatial packing). Both matter; the current pipeline only has the first.

## References

- Halverson & Hornof (2011). A Computational Model of "Active Vision" for Visual Search in HCI. *HCI*, 26, 285-314.
- Rosenholtz, Li & Nakano (2007). Measuring visual clutter. *JoV*, 7(2):17.
- Pelli, Palomares & Majaj (2004). Crowding is unlike ordinary masking. *JoV*, 4(12):12.
- Bouma (1970). Interaction effects in parafoveal letter recognition. *Nature*, 226, 177-178.
