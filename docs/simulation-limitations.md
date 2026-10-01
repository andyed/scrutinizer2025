# Simulation Limitations

Known gaps between Scrutinizer's peripheral rendering and biological peripheral vision. Each entry includes the reference page or test that exposes the gap, what the renderer currently does, and what the biology predicts.

---

## 1. Crowding Asymmetry Is Not Reproduced

**Status**: Partially addressed (v1.9.1 density gate, v2.7 eccentricity-weighted congestion + saliency-aware scramble). Isolated elements receive reduced V1 distortion (floor 0.3×). Congestion-gated pooling now uses eccentricity-weighted clutter (foveal σ=2.5 vs peripheral σ=5.0) blended with Bouma-scaled edge density. Saliency-aware scramble zone preserves high-saliency content. **Remaining gap**: reproducing the crowding asymmetry (isolated vs flanked letters) requires summary-statistic pooling (Tier 3). Wave 7c tested this on 2026-07-11 and did not demonstrate it (see below).
**Exposed by**: `reference-pages/crowding.html`
**Severity**: High. Crowding is arguably the dominant bottleneck in peripheral object recognition (Pelli & Tillman 2008), more limiting than acuity loss.

### What happens

The crowding reference page places a target letter V flanked by random letters (crowded) next to an identical V in isolation, both at the same eccentricity from fixation. In real peripheral vision, the isolated V is easily identifiable while the crowded V is not, even when both are well above the acuity threshold.

In Scrutinizer, the flanked V receives more displacement than the isolated V (about 69 px vs 21 px at 6°, a 3.3:1 ratio; see `validation-journal.md`), but the identification asymmetry has not been demonstrated. In Wave 7c (2026-07-11, `tests/validation/wave7c-crowding.json`), OCR read both the isolated and the flanked letter in mode 12, and could not read the isolated letter in modes 14 and 15, so crowding was unscorable there.

### Why

Three renderer stages contribute:

**V1 Lateral Smash** (`peripheral.frag`, `crowdingFactor`): The anisotropic noise displacement is computed from `simplex(uv * frequency)`, a function of pixel position. Its strength is then scaled by a sigmoid of the blurred structure-map density (`softDensity`), with a floor of 0.3: dense content gets full displacement and isolated elements get 30%. The gate measures how much content surrounds a pixel. It does not measure target–flanker spacing, and displacement scatters an isolated letter's features as well as a flanked one's.

**V4 MIP Pooling** (`peripheral.frag`, `sampleBoumaEdgeDensity()`): Hardware mipmaps mix a crowded letter's features with flanker features, while an isolated letter mixes only with background. Since v2.2, modes with congestion-gated pooling enabled use a Bouma-scaled edge-density gate that increases pooling when edges fall within 0.5× eccentricity. The default mode 12 does not enable it. The spacing effect is measurable (distortion ratio ~0.65 at spacings ≤0.6× vs ~1.0 at ≥0.7×).

**Structure Mask** (`peripheral.frag`, LGN stage): The LGN-stage structure mask protects *whitespace* (`density < 0.1 → suppressionFactor = 0`). Content regions (density > 0.1) receive the same suppression factor; density-dependent scaling happens in the V1 gate above.

### What the biology predicts

Bouma's law: critical spacing ≈ 0.4–0.5× eccentricity. Flankers within this radius cause feature pooling in the target's pooling region, making it unidentifiable. Flankers outside this radius (or no flankers) leave the target intact.

Rosenholtz's TTM models this as summary statistic computation over pooling regions that grow with eccentricity. An isolated target's statistics are uncontaminated; a flanked target's statistics are averaged with flanker features, so orientation, frequency, and phase all blur together.

### Possible fix paths

1. **Density-modulated V1 strength** (implemented in v1.9.1 as the density gate above): The structure map's `density` channel scales Lateral Smash intensity. `density ≈ 1.0` (dense text/content) → full V1 distortion. `density ≈ 0.1` (isolated element on background) → reduced V1 distortion. This changes displacement strength but has not produced the identification asymmetry on its own.

2. **Reduce V1, rely on MIP pooling**: If the Lateral Smash amplitude is reduced, the subtler MIP pooling difference (crowded = letter+letter averaging, isolated = letter+background averaging) becomes the dominant visual signal. The MIP chain already produces this difference; the noise masks it.

3. **Content-aware pooling regions**: True TTM implementation where pooling region size adapts to local stimulus density. Dense regions get more aggressive pooling. This is the gold-standard fix but requires significant shader work.

### Verification

When the fix is working, the crowding reference page should show:
- **Crowded condition**: V unidentifiable in peripheral rendering (features merged with flankers)
- **Isolated condition**: V recognizable despite peripheral degradation (features merge only with uniform background)
- **Progressive**: The difference should increase with eccentricity (larger pooling regions)

Golden captures at all 4 fixation points should demonstrate this asymmetry.

---

## 2. Crowding Is Not Stimulus-Specific

**Status**: Active limitation (dependent on #1)
**Exposed by**: `reference-pages/crowding-stimulus.html`
**Severity**: Medium. It matters for accurate rendering of heterogeneous content (dashboards, mixed media).

### What happens

The stimulus-specific crowding page tests three dimensions from Pelli & Tillman (2008) and Rosenholtz et al. (2012):

1. **Orientation**: Same-angle Gabor flankers (hard) vs orthogonal flankers (easier: the target pops out via grouping)
2. **Color grouping**: Monochrome letters (hard) vs color-differentiated target (easier)
3. **Complexity**: Complex shapes crowd more than simple shapes

Scrutinizer treats all three conditions identically. The renderer does not compute target-flanker similarity.

### Why

The V1 distortion and MIP pooling are feature-agnostic. They don't compute summary statistics (mean orientation, color distribution) that would distinguish "similar flankers" from "dissimilar flankers." The noise displacement treats all pixel content equally.

### What the biology predicts

Crowding strength depends on target-flanker similarity along multiple feature dimensions (orientation, color, spatial frequency, shape complexity). Dissimilar flankers produce weaker crowding because they form a separate perceptual group, releasing the target from feature pooling.

### Possible fix paths

This is a harder problem than #1. True stimulus-specific crowding requires computing local feature statistics, in addition to spatial density, in pooling regions. The TTM computes summary statistics including mean orientation, variance, and correlations. Scrutinizer would need at least a simplified version of this.

A simpler approximation: use local contrast/variance in the MIP chain. Regions with high local variance (heterogeneous content = different orientations/colors) would pool less aggressively than regions with low variance (homogeneous content = similar features).

---

## 3. No Transsaccadic Integration

**Status**: Fundamental design constraint
**Documented in**: `ai-source/Founding - Foveal Vision Simulation Assessment.md` (Gemini Deep Research output; treat as raw input and do not quote it as canonical prose)
**Severity**: Medium. It causes the simulation to overestimate peripheral disruption.

The simulation presents a continuously degraded periphery that updates every frame. Visual Memory modes (Simulation → Behavior → Visual Memory; off by default) keep the last 5, 10 or all fixated regions clear, which approximates the spatial part of this accumulation. Human vision integrates information across saccades: the brain builds a stable scene representation by sampling different locations over time. This means:

- Scrutinizer overestimates how disruptive peripheral degradation is to task performance
- Users may over-design for peripheral legibility based on exaggerated difficulty
- Results describe "instantaneous snapshot" peripheral vision. They do not capture the full perceptual experience

---

## 4. Chromatic Pooling: First-Order Approximation

**Status**: Implemented in v1.9.0 as per-channel RG/YV decay with size-dependent attenuation via DoG bands
**Documented in**: `specs/implemented/chromatic_pooling.md`
**Exposed by**: `reference-pages/color-spectrum.html`

L-M (red-green) sensitivity decays ~2.5× faster than achromatic with eccentricity, while S-cone (blue-yellow) persists much further. Both channels now have per-band frequency-dependent attenuation: YV strongly (k_ef=0.008), RG weakly (k_ef=0.003). Large colored regions in low-frequency bands preserve hue further than small chromatic details in high-frequency bands, for both channels.

**Remaining gaps:** The DoG bands provide discrete spatial frequency buckets. Perceptive fields scale continuously with eccentricity (Abramov et al. 1991). True size-dependent color preservation would integrate chromaticity over Bouma-scaled regions that grow with eccentricity, which is closer to TTM summary statistics than band-filtered attenuation. The current approach is a good first-order approximation but may under-preserve color for medium-sized stimuli that straddle band boundaries.

---

## 5. MIP Pooling Approximations

**Status**: Accepted tradeoff (Tier 1)
**Documented in**: `mongrel_textures.md`

Hardware mipmaps use box/bilinear filtering. This produces spectral leakage between frequency bands. Tier 2.5 (tile-based Oklab statistics + oriented noise synthesis via WebGPU compute) shipped in v2.3, preserving 3–4% more luminance variance than MIP blur. Tier 2.75 (Laplacian pyramid with cross-scale correlations, WebGPU) shipped in v2.7.0. Tier 2 (WebGL2 fragment shader fallback) remains unimplemented, and Tier 3 (full TTM synthesis within isotropic sectors) exists only as research mode 15, which is not validated.

---

## 6. DOM Coverage Gap on Styled-Div Macro Features

**Status**: Known gap; pixel-derived structure prior is the principled defense, DOM signal is enhancement.
**Exposed by**: canonical dashboard fixture (`tests/reference-pages/dashboard.html`), 2026-04-26 PR-A diagnosis.

The renderer's structure map is populated by four DOM-scan passes in `renderer/preload.js` (text, media, interactive, landmarks). No pass emits a block for a dark sidebar implemented as `<div class="sidebar">` (with no `<nav>`, `<aside>`, `role` or `aria-*`); only the text rows *inside* it reach the structure map. The sidebar's solid dark mass between/around the text is structure-map-zero. Pages built with Bootstrap, Tailwind, or other class-based design systems frequently fall into this category.

**Implication for any peripheral-respect mechanism**: any signal that gates synthesis based on DOM structure (saliency-from-DOM, softDensity, primitive map) will fail to fire across the bulk of these macro features. The principled defense is a *pixel-derived* structure prior (luminance gradient on `u_texture` MIPs, local contrast normalization, or a surround-inhibition equivalent) that fires on luminance edges regardless of DOM markup. DOM signal is an enhancement layered on top of the pixel-derived primary signal.

**This was the diagnosis behind PR-A's reverted approach**: an early formulation used DOM-derived signals (saliency/edgeDensity/softDensity) and collapsed to zero protection across the dashboard sidebar interior. The pixel-derived (luminance-gradient) variant fixed coverage but created a new failure mode (bleed into text content) that prompted full revert. Both lessons still apply. DOM coverage is incomplete on common UI patterns, and any pixel-derived signal must distinguish macro-feature-scale luminance transitions from text-scale content variation.

---

## Reference Pages as Diagnostic Tools

| Reference Page | Tests | Expected Behavior (When Model Is Accurate) |
|---|---|---|
| `crowding.html` | Spacing × font size | Flanked V illegible, isolated V readable at same eccentricity |
| `crowding-stimulus.html` | Orientation, color grouping, complexity | Similar flankers → more crowding; dissimilar → less |
| `color-spectrum.html` | Chromatic decay by hue channel | Red-green fades fast, blue-yellow persists |
| `grid.html` | Geometric distortion | Radial regularity of displacement field |

---

*Created: 2026-03-04*
*References: Bouma (1970), Pelli & Tillman (2008), Rosenholtz et al. (2012), Pelli, Palomares & Majaj (2004)*
