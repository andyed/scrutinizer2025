# Scrutinizer v2.2.0 Release Notes

**Release Date:** 2026-03-09
**Previous:** [v2.1.0 release notes](release_notes_v2.1.0.md)

## In This Release

1. [Oriented DoG Bands (Phase 1-3)](#oriented-dog-bands-phase-1-3) — Orientation-selective band attenuation across three phases: oblique effect, 4-channel V1 energy decomposition, radial-tangential anisotropy. 3 uniforms, 4-tap gradient.
2. [Orientation Diagnostics](#orientation-diagnostics) — Debug levels 4 and 5 for visualizing orientation energy channels and band weights with fovea blend.
3. [Keyboard Shortcuts](#keyboard-shortcuts) — Direct keyboard access to visualization modes.
4. [Test Harness Improvements](#test-harness-improvements) — Env vars for oriented DoG testing, scroll-to-top fix, A/B capture script.
5. [Validation Report Format](#validation-report-format) — Claim/Basis/Result replacing Published/Validation/Result with badge pills.
6. [Docs](#docs) — README restructure, arxiv paper reframe, spec updates.
7. [MCP Server Expansion](#mcp-server-expansion) — Added new `capture_vision` tool for LLM agents to request foveated screenshots of URLs. Expanded setup documentation for Claude Desktop, Cursor, and Windsurf.

---

## Oriented DoG Bands (Phase 1-3)

The DoG peripheral reconstruction now modulates band attenuation by local edge orientation. Three phases, each adding a layer of biological fidelity:

### Phase 1: Oblique Effect (Appelle 1972)

Cardinal (horizontal/vertical) edges get their M-scaling cutoff eccentricities pushed ~50% further into the periphery than oblique edges. This matches the oblique effect — superior acuity for cardinal orientations, mediated by higher density of cardinally-tuned V1 simple cells (Appelle 1972).

Implementation: 4-tap MIP-1 gradient samples with BGRA-corrected luminance. Gradient magnitude gate prevents noise amplification in flat regions. Orientation angle mapped to a cardinal bias factor via `cos(2*theta)`.

### Phase 2: 4-Channel V1 Energy Decomposition (Hubel & Wiesel 1962)

Replaces the continuous `cos(2*theta)` orientation model with four discrete energy channels — horizontal, vertical, diagonal-45, diagonal-135 — matching V1 simple cell orientation columns.

Cardinal fraction `max(E_H, E_V) / (max(E_H, E_V) + max(E_D45, E_D135))` replaces `cos(2θ)`. The max-of-pairs formulation avoids the degenerate case where summing overlapping projections yields a constant 0.5 regardless of orientation. Same 4 texture lookups, ~5 extra ALU ops.

### Phase 3: Radial-Tangential Anisotropy (Toet & Levi 1992)

Edges tangential to the gaze direction (running along eccentricity iso-contours) get a +30% cutoff extension; radial edges (pointing toward/away from fixation) get a -15% reduction. This matches radial-tangential crowding asymmetry: tangential flankers interfere less than radial ones at the same eccentricity (Toet & Levi 1992).

Implementation: edge orientation compared to the gaze-relative radial direction at each fragment. The radial-tangential bias modulates the cardinal/oblique bias from Phase 1.

### Phase 4: Eccentricity-Dependent Fade (Berkley et al. 1975, Essock 1990)

The oblique effect diminishes with retinal eccentricity, and the rate depends on spatial frequency. Fine spatial frequencies lose the cardinal advantage by ~10° (Berkley et al. 1975 report disappearance at 8–18°). Coarse spatial frequencies retain a small advantage to 25°+ (Essock 1990).

Implementation: per-band `smoothstep` fade keyed to visual eccentricity in degrees. Fine bands (k=0) fade from 3° to 10°. Coarse bands (k=7) fade from 8° to 25°. Eccentricity in degrees derived from `fovea_radius / 2.0` (fovea ≈ 2° visual angle). When `u_px_per_deg` becomes available (see Roadmap: Calibrated Visual Angles), the approximation will be replaced.

### Uniforms

| Uniform | Default | Controls |
|---------|---------|----------|
| `u_dog_oriented` | 0.0 | Master enable for orientation-selective attenuation |
| `u_dog_orient_bias` | 1.0 | Cardinal vs oblique bias strength (1.0=biological ~50%, 2.0=exaggerated) |
| `u_dog_radial_bias` | 0.0 | Radial-tangential anisotropy strength |

Enabled by default in the primary visualization presets. Per-preset values configured in `modes.json`.

---

## Orientation Diagnostics

Two new debug visualization levels accessible via Simulation > Utility > Orientation Diagnostics:

- **Debug 4 — 4-Channel Energy**: Renders orientation energy as color channels. R = horizontal, G = vertical, B = diagonal (mean of D45 + D135). Useful for verifying the gradient tap is picking up correct edge directions.
- **Debug 5 — Band Weights + Orientation Tint**: Shows the per-band weight modulation with an orientation-dependent color tint, blended with a white fovea circle. Useful for verifying that cardinal edges retain weight further into the periphery than oblique edges.

---

## Keyboard Shortcuts

Visualization modes are now accessible via keyboard shortcuts. Added in the Simulation menu with standard accelerator bindings.

---

## Test Harness Improvements

- **`TEST_DOG_ORIENTED` env var**: Forces `u_dog_oriented` on or off in capture scripts, independent of mode config. Enables A/B comparison captures between oriented and isotropic DoG.
- **`TEST_DOG_ORIENT_BIAS` env var**: Overrides `u_dog_orient_bias` for parametric sweeps of cardinal bias strength.
- **Oriented DoG capture script**: Automated A/B capture comparing oriented vs isotropic DoG output across reference pages.
- **Scroll-to-top fix**: Capture scripts now scroll to page top before capture, eliminating scroll-position-dependent variation in golden captures.

---

## Validation Report Format

Validation reports across all waves now use a **Claim/Basis/Result** structure replacing the previous Published/Validation/Result format:

- **Claim**: What the pipeline should produce (stated as a testable prediction).
- **Basis**: The published psychophysical finding or analytical property grounding the claim.
- **Result**: Measured outcome with **pass** / **partial** / **fail** badge pills.

The format separates claims grounded in published data from those based on architectural properties.

---

## Docs

- **README restructured**: Added DOM-aware rendering rationale to pipeline docs. Pipeline table with LGN/V1/V4 deep links. Structure map clarified as DOM analysis. Validation case study and psychophysical validation section with published data table added to AI-assisted section.
- **Arxiv paper reframed**: Added Gaussian comparison conditions to saliency and color-search capture/analysis. Communications review fixes applied. Table overflow fix for two-column layout.
- **Specs updated**: Mongrel textures spec updated for v2.1. Timestamps added to all specs. Spec index table with status triage added to roadmap. Linguistic priming spec refreshed to v3, roadmap condensed.
- **Release notes (v2.1)**: Undefined technical terms defined inline. Blog post links, published validation data links, and grad student project cross-links added.

---

## MCP Server Expansion

New `capture_vision` tool in the MCP server. LLM agents can request a foveated screenshot of any URL, specifying fixation point `(x, y)`, foveal `radius`, and visualization preset. Returns a Base64 encoded PNG.

Added MCP setup docs for **Claude Desktop**, **Cursor**, and **Windsurf**.
