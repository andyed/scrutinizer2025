# Isotropic Cortical Sampling — FOVI-Derived Sector Geometry

> **Last updated:** 2026-03-13

**Status**: Spec (not yet implemented)
**Created**: 2026-03-13
**Dependencies**: `renderer/shaders/peripheral.frag` (computeMipLevel, computePolarSector), `shared/modes.json`
**Collaboration**: Nicholas Blauch (Harvard/Kempner → NVIDIA), potential co-author. Implementation must be mathematically traceable to Blauch, Alvarez & Konkle (2026), arxiv:2602.03766.

## Context

In the 2026-03-13 meeting, Nick identified the key property from FOVI that Scrutinizer's sampling grid should adopt (FOVI's full contribution includes the 3D manifold, kNN-convolution, and model adaptation — isotropic sampling is the sensing-stage property relevant here):

> "The more important thing is the idea of local isotropy and having those — whatever is happening with the MIP-level falling off — you want it to be consistent in how it's affecting local angular versus radial distances."

> "We don't actually need the 3D model to do that isotropic sampling. [...] It's basically — first do your sampling along — figure out the distance between local radial samples as a function of eccentricity. [...] then you just kind of, in a discrete sense, at every eccentricity, you can locally compute the angular distance that would be the same as the average of the two radial distances around that point. And then from that, you can compute the number of angles that you would need."

The existing `computePolarSector()` uses ad-hoc geometric ring spacing (`ef=1.007`, `bias=2.0`). This produces sectors that grow with eccentricity but are **not derived from the CMF** and are **not isotropic** — the radial:tangential aspect ratio is fixed at 2:1 regardless of eccentricity, and the ring boundaries don't correspond to uniform cortical sampling.

## What "Isotropic" Means Here

In log-polar sampling, the number of angular samples is constant at every ring. This means the arc length between neighboring samples grows with eccentricity while the radial spacing stays constant in cortical space. The result: cells are radially stretched in the periphery. Drawing a circle in visual space and mapping it to the sampling grid produces an elongated shape.

Isotropic sampling matches angular spacing to radial spacing at every eccentricity. Cells are approximately square in cortical space at every distance. A circle in visual space maps to approximately a circle in the sampling grid.

This is the difference between Schwartz (1980) log-polar and Blauch's (2026) isotropic manifold. In FOVI, this is achieved via the 3D cylindrical cortical manifold, but Nick confirmed the 3D geometry is only needed for the deep learning perception pipeline — the sampling grid can be computed directly in 2D.

## Mathematical Derivation

### Step 1: Ring boundaries from uniform cortical sampling

The cortical magnification function (`manifold.py`):
```
M(r) = k / (r + a)
```
where `k` scales to cortical millimeters (default 10, irrelevant for sampling — `coords.py` drops it). Only `a` matters for grid geometry.

The cortical coordinate (integrated magnification):
```
w(r) = log(r + a)
```

Sample uniformly in `w`:
```
w_min = log(a)
w_max = log(r_max + a)
w_step = (w_max - w_min) / N_rings

w_i = w_min + i * w_step
r_i = exp(w_i) - a          // back-projection to visual space
```

This is Blauch's `_compute_isotropic_r_and_num_theta()` — the ring boundaries come from uniform sampling in cortical space, back-projected via `r = exp(w) - a`.

### Step 2: Isotropic spoke count at each ring

At ring `i`, the radial spacing in visual space is:
```
dr_i = r_{i+1} - r_{i-1}  (average of forward and backward differences)
      = (exp(w_{i+1}) - a) - (exp(w_{i-1}) - a)
      = exp(w_i + w_step) - exp(w_i - w_step)
```

The circumference at ring `i` is `2π * r_i`. For isotropic sampling, the arc length between spokes should equal `dr_i`:
```
n_spokes_i = floor(2π * r_i / dr_i)
```

At ring 0 (innermost), set `n_spokes = 1` (single sample at center).

This produces sectors that are approximately square in cortical coordinates at every eccentricity — Nick's "key contribution."

### Step 3: MIP level at sector center

The existing `computeMipLevel()` already uses Blauch's CMF:
```glsl
float cortical_dist = log(1.0 + r_deg / u_cmf_a);  // = log(r + a) - log(a)
return clamp(maxMipLevel * cortical_dist / u_cortical_max * eccScale, 0.0, maxMipLevel);
```

The MIP chain provides spatial averaging over the sector area. `textureLod()` at the sector center, at the MIP level corresponding to that eccentricity, pools pixel information the same way Blauch's kNN receptive fields pool from the input image — the GPU hardware does the Gaussian averaging.

## GLSL Implementation Plan

### New function: `computeCorticalSector()`

Replace the ad-hoc `computePolarSector()` with a CMF-derived version for modes that claim FOVI lineage:

```glsl
struct CorticalSector {
    float r;              // distance from fovea
    float angle;          // polar angle
    float ring_inner;     // inner ring boundary (visual space)
    float ring_outer;     // outer ring boundary (visual space)
    float ring_center;    // ring center (visual space)
    float spoke_count;    // isotropic spoke count at this ring
    float spoke_center;   // center angle of this spoke
    vec2  sector_center;  // UV of sector center (for textureLod sampling)
};

CorticalSector computeCorticalSector(vec2 uv, float fovea_radius) {
    // 1. Convert to gaze-relative polar coordinates
    // 2. Compute w = log(r_deg + cmf_a) in cortical space
    // 3. Quantize w to ring index: floor((w - w_min) / w_step)
    // 4. Back-project ring boundaries: r = exp(w) - cmf_a
    // 5. Compute isotropic spoke count: 2π * r_center / dr
    // 6. Snap angle to nearest spoke center
    // 7. Reconstruct sector center UV
}
```

### Parameters (uniforms)

- `u_cmf_a`: Already exists (default 2.78°)
- `u_cortical_max`: Already exists
- `u_num_cortical_rings`: New — controls grid resolution. ~50 rings for smooth appearance, ~20 for visible Minecraft-like blocks.

### New mode entry in `modes.json`

```json
{
    "id": 12,
    "label": "FOVI Isotropic",
    "v1_distortion_type": 5,
    "v4_style_id": 9,
    "cmf_enabled": true,
    "cmf_a": 2.78,
    "dog_enabled": false,
    "description": "Isotropic cortical sampling derived from Blauch, Alvarez & Konkle (2026). Ring spacing from uniform cortical sampling (w = log(r + a)), spoke count matched to radial spacing at each eccentricity. MIP chain provides spatial averaging within each sector."
}
```

### Relationship to existing modes

| Mode | Ring spacing | Spoke count | Isotropic? | Source |
|------|-------------|-------------|------------|--------|
| Polar Quantize (V1 type 4) | Geometric: `r0 * pow(1.007, n*bias)` | `2π * r / unbiasedWidth` | No (2:1 R:T by design) | Ad-hoc |
| Minecraft (V1 type 3) | Cartesian grid, `exp2(mipLevel + 2)` | N/A (Cartesian) | No (Cartesian) | CMF-sized |
| **FOVI Isotropic (new)** | CMF: `exp(w_min + n*w_step) - a` | `floor(2π * r / dr)` | **Yes** | Blauch 2026 |

## Correspondence Table: Blauch Python → Scrutinizer GLSL

For Nick's review — line-by-line traceability:

| Blauch Python (`coords.py`) | Scrutinizer GLSL | Notes |
|------|------|-------|
| `w = linspace(log(a), log(r_max+a), N)` | `w = w_min + floor(n) * w_step` | Uniform cortical sampling |
| `radius = exp(w) - a` | `ring_center = exp(w) - u_cmf_a` | Back-projection |
| `radius_diff = (r[i+1]-r[i-1])/2` | `dr = (exp(w+w_step) - exp(w-w_step)) / 2.0` | Average radial spacing |
| `n_angles = len(arange(0, 2π*r, dr))` | `spoke_count = floor(2π * r / dr)` | Isotropic angle count |
| `GaussianKNNGridSampler` | `textureLod(u_texture, sectorUV, mipLevel)` | GPU MIP ≈ kNN Gaussian pooling |
| `GaussianColorDecay(sigma)` | Oklab `rgFade`/`yvFade` smoothstep | Per-channel chromatic decay |

## What This Is and Isn't

**Is:** A real-time GPU implementation of FOVI's isotropic foveated sampling grid, using MIP-chain hardware for spatial averaging. The sector geometry is mathematically derived from the same CMF and isotropy condition as the FOVI paper.

**Is not:** The full FOVI pipeline. FOVI includes the 3D cortical manifold, kNN-CNN perception on that manifold, and learned representations. Scrutinizer implements the sensing/sampling stage only — the input transformation, not the perception model. This distinction should be stated clearly in any publication.

## Verification

1. **Ring boundary check**: At `cmf_a=2.78`, `fov=30°`, `N=30` rings, verify ring radii match Blauch's `_compute_isotropic_r_and_num_theta()` output to 3 decimal places.
2. **Spoke count check**: At each ring, verify `n_spokes` matches Blauch's Python output.
3. **Visual isotropy**: Render grid lines at ring/spoke boundaries. Cells should be approximately square at all eccentricities.
4. **Comparison capture**: Same COCO image through current polar quantize vs new FOVI isotropic mode — visually confirm the radial stretching is eliminated.

## Open Questions for Nick

1. Does MIP-chain spatial averaging faithfully substitute for kNN Gaussian pooling? The MIP chain does box filtering at each level — is the receptive field shape difference (box vs Gaussian) significant?
2. Should `n_spokes` be forced even (current polar quantize does this) or is odd acceptable?
3. The `u_num_cortical_rings` parameter controls grid granularity. Is there a principled value from the paper, or is this a free parameter for the renderer?
4. For the continuous (non-Minecraft) rendering mode: should sector boundaries be hard (snap to center) or soft (weighted blend across boundary)?

## References

- Blauch, N. M., Alvarez, G. A., & Konkle, T. (2026). FOVI: A biologically-inspired foveated interface for deep vision models. arXiv:2602.03766.
- Schwartz, E. L. (1980). Computational anatomy and functional architecture of striate cortex: A mapping approach to perceptual coding. Vision Research, 20(8), 645-669.
- Rovamo, J. & Virsu, V. (1979). An estimation and application of the human cortical magnification factor. Experimental Brain Research, 37, 495-510.
