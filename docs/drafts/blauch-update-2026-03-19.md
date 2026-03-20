# Draft: Update to Nick Blauch — FOVI Adoption in Scrutinizer

> **Private draft — not for publication. For Andy to review and adapt.**
> **Date:** 2026-03-19

---

Hi Nick,

Following up on our March 13 conversation. I wanted to share where things landed with the isotropic implementation and be transparent about what we adopted, what we approximated, and where the open questions are.

## What shipped

Scrutinizer's default mode now uses FOVI-derived sector geometry to parameterize its peripheral distortion pipeline. The core math:

- **Ring boundaries** from uniform cortical sampling: `w = log(r + a)`, `r_i = exp(w_min + i * w_step) - a`
- **Radial spacing** via forward difference: `dr = (r + a) * (exp(w_step) - 1)`
- **Isotropy condition** from your formulation: `n_spokes = floor(2π * r / dr)`
- **Parameters**: `a = 2.78`, `N = 50` rings, `r_max = 15°`

A 19-test suite validates the JS reference implementation against your Python (`coords.py`) to 3 decimal places — ring radii, spoke counts, and isotropy ratios at N=30 and N=50.

Interactive visualization of the grid geometry: https://codepen.io/andy-edmonds/pen/019ced00-b472-7c33-8ebb-20982aa039ad — three panels showing uniform (control), rectangular MIP, and isotropic cortical grids side by side.

## What "adoption" means here — and what it doesn't

Your key insight from the meeting: the important property is local isotropy — degradation should be consistent in how it affects angular versus radial distances at every eccentricity. We took that seriously.

But we didn't adopt FOVI's rendering mechanism. Seven attempts to use sectors as the rendering primitive failed — snapping to sector centers, averaging within sectors, using sector boundaries as spatial gates all produced sector-shaped artifacts visible on uniform backgrounds. The implementation journal documents each attempt and why it failed.

What works: **sector geometry drives the transition rate (where and how fast degradation changes), not the rendering mechanism (how pixels change).** The distortion pipeline uses the same noise-warp + discrete-scramble architecture as before, but the noise frequency scales inversely with sector extent, and the scramble cell size tracks sector extent (capped at 12px to prevent grid artifacts). The 2:1 radial/tangential ratio from Toet & Levi (1992) is applied to displacement magnitude.

Concretely:
- **Bender frequency**: `150 * 7 / sectorPx` — inversely proportional to sector extent, matching your CMF curve
- **Cutter cell size**: `clamp(sectorPx * 0.5, 4, 12)` — tracks sector extent with a cap
- **Throw distance**: bounded by sector width in UV space, 2:1 radial bias

The visual result is subtle compared to the previous fixed-grid approach — fewer implausible long-range pixel scatters, smoother degradation profile — but it's not a dramatically different look. The difference is in the principled derivation, not the perceptual effect.

## What we got wrong before the meeting

I want to acknowledge: when you checked our references on March 13, the paper title and author order were inconsistent across our documentation. Some files had paraphrased titles ("Foveation for cortical magnification in visual AI", "Foveated vision in neural networks") instead of the actual title. One had incorrect author order. We've corrected all references to match the paper: "FOVI: A biologically-inspired foveated interface for deep vision models" (Blauch, Alvarez & Konkle, 2026).

The blog draft also overstated the implementation — claiming we "replaced the MIP sampling grid" when the MIP grid is unchanged. We're correcting this to accurately describe what sector geometry actually drives in the pipeline.

One specific failure mode worth naming: our AI coding assistant confabulated paper titles. The BibTeX entry had "Foveation of inputs as a way to model the biological periphery for vision models" — a plausible-sounding title that doesn't match your actual paper. Other files had "Foveation for cortical magnification in visual AI" and "Foveated vision in neural networks." None of these are your title. The correct title ("A biologically-inspired foveated interface for deep vision models") appeared in some references but not all, and the inconsistency wasn't caught until you flagged it. We've audited and corrected every reference across both repositories, but this is exactly the kind of AI accuracy concern you raised — confident-sounding citations that are subtly wrong.

## Known approximations

For transparency, these are the places where our implementation diverges from your formulation:

1. **Forward difference vs. central difference** for `dr`: the GLSL uses `(r + a) * (exp(w_step) - 1)` at all rings. Your Python uses central differences for interior rings. At N=50, the discrepancy is ~3%.

2. **Radial/tangential bias in screen coordinates**: the 2:1 ratio is applied as horizontal/vertical in screen space, not true radial/tangential relative to the gaze-to-pixel vector. This is consistent with the existing distortion pipeline but is an approximation for off-axis eccentricities.

3. **No full CorticalSector struct in the shader**: the type 5 block computes only sector extent (`dr_deg`, `sectorPx`) inline. Spoke count, ring boundaries, and sector centers are computed in the JS test suite but not in the GLSL. The shader only needs the extent to parameterize the Bender/Cutter.

4. **Progressive multiplier on throw distance**: at maximum eccentricity, the effective throw reaches ~3.25x sector width, exceeding the "bounded by 1 sector width" design target. This is the Bouma's law scaling — we haven't yet capped it.

## Open question from our conversation

You raised whether the "sector drives rate, not mechanism" approach is acceptable for co-authorship. Scrutinizer uses your sector geometry for transition profile calibration, but the rendering mechanism (noise warp + scramble) is not derived from FOVI. The rendering validation shows the implementation produces:
- Correct angular isotropy (CV < 0.5 across quadrants)
- No bright scatter artifacts on dark content
- Texture preservation in far periphery
- Comparable global statistics to the previous default

But the test suite has gaps — the validation agent identified that several tests are too lenient and wouldn't catch a broken renderer. We're working on tightening those.

I'd value your perspective on:
1. Whether the "sector drives rate" framing is an acceptable way to describe the adoption
2. Whether the forward-difference approximation matters for the claims we'd make
3. Whether there are specific validation tests you'd want to see before this goes into a publication

The mode is live as Scrutinizer's default. Happy to do a screen share to walk through the behavior on different content types.

Best,
Andy
