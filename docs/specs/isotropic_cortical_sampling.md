# Isotropic Cortical Sampling — FOVI-Derived Sector Geometry

> **Last updated:** 2026-03-19

**Status**: Geometry verified (19 tests); rendering shipped (sector-parameterized Bender+Cutter, V1 type 5). Default mode since 2026-03-19.
**Created**: 2026-03-13
**Dependencies**: `renderer/shaders/peripheral.frag` (computeMipLevel, BenderConfig/CutterConfig), `shared/modes.json`
**Based on**: Blauch, Alvarez & Konkle (2026), arxiv:2602.03766. Implementation is mathematically traceable to this formulation.
**Implementation journal**: `docs/specs/isotropic_implementation_journal.md` — detailed record of all rendering approaches tried and why each failed.
**Test suite**: `tests/unit/isotropic-sectors.test.js` — 19 tests verify sector math matches Blauch Python to 3 decimal places.

## Context

The key property from FOVI relevant to Scrutinizer is local isotropy: angular and radial sampling resolution should degrade together, not at different rates. FOVI's full contribution includes the 3D cortical manifold, kNN-convolution, and model adaptation — isotropic sampling is the sensing-stage property adopted here.

The existing `computePolarSector()` uses ad-hoc geometric ring spacing (`ef=1.007`, `bias=2.0`). This produces sectors that grow with eccentricity but are **not derived from the CMF** and are **not isotropic** — the radial:tangential aspect ratio is fixed at 2:1 regardless of eccentricity, and the ring boundaries don't correspond to uniform cortical sampling.

## What "Isotropic" Means Here

In log-polar sampling, the number of angular samples is constant at every ring. This means the arc length between neighboring samples grows with eccentricity while the radial spacing stays constant in cortical space. The result: cells are radially stretched in the periphery. Drawing a circle in visual space and mapping it to the sampling grid produces an elongated shape.

Isotropic sampling matches angular spacing to radial spacing at every eccentricity. Cells are approximately square in cortical space at every distance. A circle in visual space maps to approximately a circle in the sampling grid.

This is the difference between Schwartz (1980) log-polar and Blauch's (2026) isotropic manifold. In FOVI, isotropy is achieved via the 3D cylindrical cortical manifold. For 2D sampling (without the deep learning pipeline), the grid can be computed directly from the CMF without the 3D geometry.

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

## GLSL Implementation — Geometry (DONE)

### `computeCorticalSector()` — implemented and verified

The sector geometry function is implemented in `peripheral.frag` and verified against Blauch's Python to 3 decimal places. It coexists with the existing `computePolarSector()` — modes select which to use via `v1_distortion_type`.

```glsl
struct CorticalSector {
    float r;              // distance from fovea (aspect-corrected)
    float angle;          // polar angle (-PI to PI)
    float ring_inner;     // inner ring boundary (visual space)
    float ring_outer;     // outer ring boundary (visual space)
    float ring_center;    // ring center (visual space)
    float dr;             // half-width radial spacing: (r_{i+1} - r_{i-1}) / 2
    float spoke_count;    // isotropic spoke count at this ring
    float spoke_width;    // 2*PI / spoke_count
    float spoke_center;   // center angle of this spoke
    float n_idx;          // ring index
    vec2  sector_center;  // UV of sector center (ready for textureLod sampling)
    vec2  mouse_c;        // aspect-corrected mouse position (for UV reconstruction)
};
```

### Parameters (uniforms) — implemented

- `u_cmf_a`: Exists (default 2.78°)
- `u_cortical_max`: Exists
- `u_num_cortical_rings`: Exists (default 0, mode 12 sets 50)
- `u_show_sector_grid`: Exists (debug overlay, default off)

### Mode 12 entry in `modes.json` — implemented

```json
{
    "id": 12,
    "label": "FOVI Cortical Grid (Blauch)",
    "v1_distortion_type": 5,
    "v4_style_id": 0,
    "cmf_enabled": true,
    "cmf_a": 2.78,
    "dog_enabled": true,
    "dog_e2": 0.15,
    "num_cortical_rings": 50,
    "chromatic_pooling": true
}
```

Note: `v4_style_id` is 0 (standard DoG), not 9 (mongrel). `dog_enabled` is true — the DoG reconstruction is the primary rendering path; the question is how sector geometry modulates it.

## GLSL Implementation — Rendering (TBD)

### What the V1 type 5 block needs to do

The `computeCorticalSector()` function provides sector geometry. The V1 type 5 block must use this to produce peripheral degradation. The rendering question — what the sector geometry *drives* — is unresolved.

See next section.

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

## Implementation Attempt 1 (v2.5, 2026-03-15)

Seven rendering approaches were tried for the V1 type 5 block. All failed. Full details in `isotropic_implementation_journal.md`. Summary:

| Approach | Result | Root cause |
|----------|--------|------------|
| UV snap to sector center | Gray blobs | Averaging destroys contrast (text + bg = gray) |
| textureGrad with sector derivatives | Gray blobs | All DoG bands at same MIP → differences = 0 |
| Per-pixel hash jitter | No effect | 2.5px noise vs 20px letters — wrong scale |
| Simplex noise scaled by sector | Minimal effect | Smooth warp shifts letters rigidly, doesn't break identity |
| Sector-coherent scramble | Tile artifacts | Sector boundaries visible as hard edges |
| Discrete scramble (mode 0's cutter) | Pixel dust | 4px cells scatter individual pixels into wrong regions |
| Noise + sector lodFloor | Best but insufficient | lodFloor kills texture; text still readable |

### Key insights

1. **UV snap = spatial averaging = gray.** Any mechanism that converges pixels to a common point produces mean color. This is not peripheral vision — peripheral vision preserves local contrast and texture statistics (Rosenholtz TTM).

2. **Displacement must be coherent at feature scale.** Noise at 800+ cycles/UV creates ~2.5px cells. A 20px letter survives intact. Need ~10-20px coherent displacement, but that creates visible tiles.

3. **Mode 0's two-stage mechanism works.** "Bender" (smooth noise warp) shifts features around; "Cutter" (discrete scramble) breaks within-feature coherence. Neither alone is sufficient. Together they produce realistic peripheral degradation on typical web content.

4. **lodFloor is a dimmer switch, not a scalpel.** It removes spatial frequency bands uniformly — can't selectively destroy feature identity while preserving texture.

5. **The sector geometry is correct; the rendering question is what it drives.** The math matches Blauch. The problem is translating "approximately square cortical sampling" into a degradation mechanism that doesn't produce sector-shaped artifacts.

### Decision

Revert shader to v2.4.1 baseline. Work on peripheral color first (fix Oklab cube root UB, recalibrate YV decay, restore far-periphery color kill, extend DoG range). Then return to isotropic rendering with the revised approach below.

## Revised Approach: Color First, Then Isotropic

### Phase 1: Fix peripheral color (prerequisite)

These are bugs in the current pipeline that affect all modes, not just mode 12:

1. **Oklab cube root UB** — `chromaticAttenuate()` called on DoG bands with negative RGB; `pow(negative, 1/3)` undefined in GLSL ES 3.0. Per-band chromatic attenuation is currently a no-op.
2. **YV decay too gentle** — 0.004 (detection threshold) should be ~0.014 (suprathreshold appearance per Bowers 2025).
3. **Far-periphery color kill missing** — legacy 95% chrominance kill was removed when per-channel path was added; replacement is broken due to bugs 1-2.
4. **Suprathreshold exponent** — power-law 0.5 measured for luminance only; applying to RG/YV without evidence over-desaturates parafovea.
5. **Large swatch preservation** — color patches and images should retain hue longer than fine text; need size-aware chromatic decay.
6. **DoG range** — current bands top out at MIP 4.0; far periphery on wide screens exceeds this.

### Phase 2: Isotropic rendering (after color is correct)

The sector geometry drives degradation **rate** (where transitions happen), not degradation **mechanism** (how pixels change). This means:

1. **Use mode 0's proven noise+scramble mechanism** for UV displacement. The "bender" (smooth simplex warp) and "cutter" (discrete scramble) are proven, tuned, and visually acceptable.

2. **Sector geometry controls the spatial profile.** Instead of ad-hoc smoothstep transitions keyed to `fovea_radius` and `parafovea_radius`, derive transition eccentricities from sector size:
   - When sector size > feature scale → features fully scrambled
   - When sector size ≈ feature scale → partial scramble (transition zone)
   - When sector size < feature scale → no scramble (foveal protection)

3. **Sector-derived lodFloor as supplement (0.3-0.4x), not replacement.** A gentle lodFloor alongside noise+scramble softens the finest DoG bands without killing texture. The scramble handles feature destruction.

4. **Isotropy in DoG attenuation.** The DoG band rolloff profile should respect isotropic sector dimensions. Currently the rolloff is purely radial — tangential extent is ignored. With isotropic sectors, the rolloff can use sector area (radial × tangential) rather than just radial distance.

5. **Isotropy in MIP sampling.** The MIP level at each point should reflect isotropic sector size, not just eccentricity. For a correctly isotropic grid, these are the same — but this ensures the correspondence is explicit and traceable.

### What "isotropic mode 12" should look like

At equal eccentricity, degradation should be the same in all directions from fixation. The existing mode 0 is already close to this (it uses radial distance, which is rotationally symmetric). Mode 12's contribution is:

- **CMF-derived transition profile** instead of ad-hoc smoothstep thresholds
- **Principled DoG attenuation** where band rolloff traces to sector geometry
- **Traceable to Blauch** — the sector math, transition profile, and rolloff are all derivable from `w = log(r + a)` and the isotropy condition

Mode 12 should NOT look dramatically different from mode 0. It should look slightly more principled — smoother transitions, better calibrated to the CMF — but the visual character should be the same: text destroys into scrambled texture, not fog.

## What This Is and Isn't

**Is:** A real-time GPU implementation of FOVI's isotropic foveated sampling grid, using MIP-chain hardware for spatial averaging. The sector geometry is mathematically derived from the same CMF and isotropy condition as the FOVI paper.

**Is not:** The full FOVI pipeline. FOVI includes the 3D cortical manifold, kNN-CNN perception on that manifold, and learned representations. Scrutinizer implements the sensing/sampling stage only — the input transformation, not the perception model. This distinction should be stated clearly in any publication.

## Verification

### Geometry (DONE)

1. **Ring boundary check**: ✅ At `cmf_a=2.78`, `fov=30°`, `N=30` and `N=50` rings, ring radii match Blauch's Python to 3 decimal places. (`isotropic-sectors.test.js`)
2. **Spoke count check**: ✅ At each ring, `n_spokes` matches Blauch's Python output. (`isotropic-sectors.test.js`)
3. **Isotropy check**: ✅ Tangential/radial aspect ratio within 30% of 1.0 at eccentricities 2°, 5°, 8°, 12°, 15°. (`isotropic-sectors.test.js`)
4. **Spoke count at r_max**: ✅ N=30 → 85 spokes, N=50 → 142 spokes. (`isotropic-sectors.test.js`)

### Rendering (DONE — 2026-03-19, `scripts/validate-isotropic-rendering.js`)

5. **Angular isotropy**: ✅ Luminance stddev CV < 0.50 across quadrants at mid-periphery. Grid CV=0.13, dashboard CV=0.44, article CV=0.20.
6. **Readability destruction**: ✅ Mode 12 parafoveal stdDevL ≤ mode 0 (ratio = 1.000). Note: uses luminance stddev, not OCR — test suite needs strengthening (see validation agent report).
7. **Texture preservation**: ✅ Far-periph/fovea stdDevL ratio > 0.15. Grid=3.48, dashboard=0.56, article=2.10.
8. **Dark mode scatter**: ✅ 0/431,944 peripheral pixels above scatter threshold (0.000%). Note: currently tests mode 0 smoke capture, not mode 12 specifically — needs fix.
9. **Mode comparison**: ✅ Mode 12 vs mode 0: meanL ratio 1.000, stdDevL ratio 0.999-1.000.

**Validation gaps identified:** Tests are necessary but not sufficient. An identity transform would pass all 12 checks. No negative control, no structural comparison (SSIM), readability proxy is permutation-invariant. See `docs/specs/mode_graduation.md` for the broader test infrastructure plan.

## Open Questions for Nick

1. Does MIP-chain spatial averaging faithfully substitute for kNN Gaussian pooling? The MIP chain does box filtering at each level — is the receptive field shape difference (box vs Gaussian) significant?
2. ~~Should `n_spokes` be forced even?~~ **Resolved:** odd is fine; floor() produces both even and odd counts naturally.
3. ~~`u_num_cortical_rings` — principled value?~~ **Resolved:** 50 rings for N=50 at r_max=15°. Free parameter for renderer; Blauch's paper uses variable N.
4. ~~Hard vs soft sector boundaries?~~ **Resolved by failure:** hard boundaries (snap) produce sector-shaped artifacts. Soft blending or no boundaries needed. Revised approach avoids sector-level operations entirely — uses sector geometry to parameterize continuous degradation.
5. Is the "sector drives rate, not mechanism" approach a faithful adoption of the FOVI sensing stage? Mode 12 uses the sector geometry for transition profile calibration, but the rendering mechanism (noise warp + scramble) is not derived from FOVI.

## References

- Blauch, N. M., Alvarez, G. A., & Konkle, T. (2026). FOVI: A biologically-inspired foveated interface for deep vision models. arXiv:2602.03766.
- Schwartz, E. L. (1980). Computational anatomy and functional architecture of striate cortex: A mapping approach to perceptual coding. Vision Research, 20(8), 645-669.
- Rovamo, J. & Virsu, V. (1979). An estimation and application of the human cortical magnification factor. Experimental Brain Research, 37, 495-510.
