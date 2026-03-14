# Scrutinizer Roadmap

Last updated: 2026-03-13 (v2.4)

## Specs

Active design documents in [`docs/specs/`](docs/specs/). Completed specs are in `docs/specs/implemented/`.

| Spec | Topic | Status |
|------|-------|--------|
| [linguistic_priming.md](docs/specs/linguistic_priming.md) | Goal embeddings → scent map → saliency gating | **Planned** |
| [oriented_dog_bands.md](docs/specs/oriented_dog_bands.md) | Orientation-selective band attenuation, radial-tangential bias | **Shipped** (v2.2) |
| [ratio_reconstruction.md](docs/specs/ratio_reconstruction.md) | Dual-LOD structure map sampling for margin soft-edge | **Shipped** (v2.3) |
| [isotropic_cortical_sampling.md](docs/specs/isotropic_cortical_sampling.md) | Isotropic log-polar sampling | **Planned** |
| [metamer_mode.md](docs/specs/metamer_mode.md) | Structure-locked adaptive grid V1 distortion | **Planned** |
| [mongrel_textures.md](docs/specs/mongrel_textures.md) | Statistical texture synthesis (WebGPU tiered path) | **Tier 2.5 Shipped** (v2.3) |
| [wave6_coco_periph_validation.md](docs/specs/wave6_coco_periph_validation.md) | COCO-Periph system-level peripheral encoding validation | **Scaffolding** (v2.4) |
| [congestion_text_density.md](docs/specs/congestion_text_density.md) | Congestion gate enhancement for text density | **Planned** |
| [gaussian_blur_comparison.md](docs/specs/gaussian_blur_comparison.md) | DoG vs Gaussian frequency/saliency comparison | In progress |
| [halverson_hornof_validation.md](docs/specs/halverson_hornof_validation.md) | Active vision behavioral validation | In progress |
| [continuous_chromatic_mip.md](docs/specs/continuous_chromatic_mip.md) | Continuous chromatic MIP sampling per channel | In progress |
| [human_subjects_data_collection.md](docs/specs/human_subjects_data_collection.md) | Human subjects experiment platform | **Planned** (post-v2.2) |
| [keyboard_shortcuts.md](docs/specs/keyboard_shortcuts.md) | Keyboard shortcuts for visualization modes | In progress |
| [browser-features-and-extensions.md](docs/specs/browser-features-and-extensions.md) | Chrome extension support, browser niceties | **Planned** |

<details>
<summary>Completed / shipped specs</summary>

| Spec | Shipped |
|------|---------|
| [density_gated_crowding.md](docs/specs/density_gated_crowding.md) | v1.9.1 |
| [cmf_mip_derivation.md](docs/specs/cmf_mip_derivation.md) | v1.8 |
| [blueprint_mods.md](docs/specs/blueprint_mods.md) | v2.0 |
| [implemented/chromatic_pooling.md](docs/specs/implemented/chromatic_pooling.md) | v1.9 |

</details>

---

## Completed

### v2.4: Reading Span & Fovea Degree Correction (2026-03-13)
- Reading span: asymmetric foveal envelope during reading (Rayner 1998)
- Fovea degree correction: fovea_deg 2.0→1.0, default radius 90→45px
- Saccadic blindness default ON
- Wave 6 COCO-Periph validation scaffolding (Harrington et al. 2024)
- Citation export: foveaDeg + pxPerDeg metadata fields
- Mid-sweep trajectory screenshot timing for reading span captures

### v2.3: WebGPU Compute Mongrel Synthesis (2026-03-11)
- Tier 2.5 mongrel pipeline: tile-based Oklab statistics + oriented noise synthesis via WebGPU compute
- Two WGSL compute passes (~900 lines), under 0.3ms on integrated GPU
- Implementation uses oriented sine gratings, not Walton's steerable filter approach — simpler and faster
- Oklab luminance/chrominance variance metrics for quantitative comparison
- Seeded flanker RNG (mulberry32) for reproducible crowding captures
- Auto-fallback safety harness (60-frame rolling window, 30fps floor)
- Ratio reconstruction: dual-LOD structure map sampling (sharp LOD 0 + blurred LOD 4) for smooth V1 taper at content edges
- Soft density gate: crowding sigmoid uses blurred density so V1 strength tapers at DOM boundaries instead of cliff-edging
- Fovea radius granularity: 70/110/130px options around the 90px sweet spot

### v2.1: Psychophysical Validation & 8-Band DoG (2026-03-08)
- 8 half-octave DoG bands (9 MIP levels at √2 spacing)
- Four-wave psychophysical validation (chromatic, spatial, crowding, saliency)
- Gaussian blur comparison — 5–10× saliency preservation advantage
- 15 open-source HTML stimulus pages
- Polar sector R:T ratio fix (2:1 radial elongation)
- Toolbar clipping fix, capture infrastructure

### v2.0: Explainer Modes & Density-Gated Crowding (2026-03-07)
- Minecraft Mode (block pooling, CMF-sized 4–64px blocks)
- Minecraft Eyeball (polar sectors, ~2:1 radial elongation)
- Blueprint Mode (ARIA role wireframe from live DOM)
- Density-gated crowding (sigmoid on structure density → V1 strength)
- Chromatic decay recalibration (Bowers et al. 2025 suprathreshold values)
- castleCSF per-channel contrast sensitivity (Ashraf et al. 2024)
- Eccentricity scaling uniform, Cmd+E toggle, toolbar URL overflow fix

### v1.5–v1.9 (2025-12 → 2026-02)
- Mobile emulation mode (iPhone viewport, touch synthesis)
- Toolbar 2.0 (URL dialog, touch-friendly)
- Reference pages (dashboard, article, e-commerce)
- Oklab color space (perceptually uniform desaturation)
- WebGL 2.0 / GLSL ES 3.0 upgrade
- DoG band decomposition via hardware MIP chain
- Feature Congestion scoring (Rosenholtz 2007, ρ=0.93 vs MATLAB)
- Face detection saliency (face-api.js TinyFaceDetector)
- DOM structure extraction (text, media, interactive + ARIA)
- LGN saliency gating (structure-aware inhibitor/excitor masks)
- Foveal calibration tool (motion silence staircase)
- 10 pipeline modes in declarative JSON registry
- Saliency modulation (temporal smoothing, gestalt grouping, V1/V4 modulation)

---

## Open — Tier 1 (High Impact)

### Calibrated Visual Angles
**Status:** Partially implemented (calibration tool exists, separation not done)

Separate physical calibration from comfort zone:

| Parameter | Role | Source |
|-----------|------|--------|
| `px_per_deg` | Pixels per degree of visual angle | Blind spot method or screen geometry |
| `foveaRadius` | Comfort clear zone (can exceed calibrated fovea) | User preference |
| `ecc_deg` | True eccentricity: `dist_px / px_per_deg` | Derived, NOT from foveaRadius |

This means a user can have a generous 180px clear zone without lying to the eccentricity models.

**Work:**
- [ ] Store `px_per_deg` from calibration data
- [ ] Shader: `ecc_deg = dist_px / u_px_per_deg` (replace `normEcc * fovea_deg` in 6 places)
- [ ] Separate comfort clear zone mask from eccentricity computation
- [ ] Blind spot calibration as second anchor point (~15° eccentricity)

**Files:** `peripheral.frag`, `webgl-renderer.js`, `scrutinizer.js`, `foveal-calibration.js`, `settings-manager.js`

---

### Semantic Guidance (Information Scent)
**Status:** Spec complete ([`docs/specs/linguistic_priming.md`](docs/specs/linguistic_priming.md) v3)

Top-down attentional control via goal embeddings. User specifies intent ("find the price"), DOM text nodes are embedded via Transformers.js v3 (in-browser, no external servers), cosine similarity scores flow into the existing saliency texture R channel.

**Key integration points:**
- `dom-adapter.js` already extracts text nodes with bounding rects — extend to export text content
- Scent scores write into the existing `saliency` field of StructureBlocks
- `saliency-worker.js` R channel carries the blended signal
- No shader changes — enters through existing LGN saliency gate
- New `scent_gated` mode in `modes.json` (declarative, zero code)

**Work:**
- [ ] `scent-worker.js` — Web Worker wrapping Transformers.js v3
- [ ] Extend `dom-adapter.js` to export text content per block
- [ ] Goal embedding UI (toolbar text field + preset intents)
- [ ] Legibility gating (E₂-based suppression of illegible scent)
- [ ] Exploration/exploitation controller (dynamic α/β weighting)
- [ ] Scent map overlay visualization
- [ ] `scrutinizer-audit --goal` CLI integration

**Dependencies:** `@huggingface/transformers` v3, `all-MiniLM-L6-v2` ONNX int8 (~23 MB)

---

### Oriented DoG Bands
**Status:** Shipped v2.2 ([`docs/specs/oriented_dog_bands.md`](docs/specs/oriented_dog_bands.md))

Cardinal (H/V) edges get M-scaling cutoffs pushed ~50% further than oblique edges, modeling the oblique effect (Appelle, 1972). Radial-tangential bias: tangential content persists further per Toet & Levi (1992).

**Work:**
- [x] Phase 1: Oblique effect — 4-tap MIP-1 gradient, cos(2θ) cardinal alignment, gradient magnitude gate
- [x] Phase 2: 4-channel V1 energy decomposition (H/V/D45/D135) replacing cos(2θ)
- [x] Phase 3: Radial-tangential anisotropy — tangential +30%, radial -15%
- [x] Debug overlays (levels 4, 5) + menu integration
- [ ] Validation against oblique effect psychophysical data

---

## Open — Tier 2 (Medium Impact)

### Axis Bias: Radial-Tangential V1 Displacement Weighting
**Status:** TODO (cherry-pick from `metamer` branch)

V1 displacement currently has no directional bias — noise scramble applies isotropic displacement regardless of content type or radial orientation. Toet & Levi (1992) show crowding is ~2:1 stronger along the radial axis. The metamer branch demonstrated a simple per-fragment axis bias that improves perceptual plausibility:

- **Text** (`type > 0.8`): `vec2(1.8, 0.15)` — strong horizontal displacement, minimal vertical. Preserves the "lines of text" gestalt while making words unreadable. Horizontal dominates because text lines run horizontally and radial crowding exceeds tangential.
- **Image/UI** (`type ≤ 0.8`): `vec2(0.8, 0.8)` — roughly isotropic, slight reduction from 1.0 to avoid over-displacement on structured UI.

This maps directly to the radial-tangential anisotropy already implemented in the DoG bands (v2.2), but applied to V1 displacement rather than V4 frequency attenuation. The two are complementary — DoG bands control *what spatial frequencies survive*, axis bias controls *how the surviving content is scrambled*.

**Work:**
- [ ] Add axis bias vector to V1 displacement calculation (noise scramble path, type 0)
- [ ] Derive bias from structure map type channel (text vs image vs UI)
- [ ] Test interaction with existing radial-tangential DoG band attenuation
- [ ] Validate: crowding-radial stimulus should show stronger radial spread with axis bias enabled

**Files:** `peripheral.frag` (processV1), `shared/modes.json` (optional per-mode toggle)

---

### Mongrel Texture Synthesis (WebGPU Tiered Path)
**Status:** Tier 2.5 shipped (v2.3); Tiers 2 and 3 remain planned

The arxiv paper defines a three-tier upgrade path:
- **Tier 2:** Contrast-preserving statistical pooling within WebGL2 fragment shader (~2 ms) — planned
- **Tier 2.5:** WebGPU compute mongrel synthesis (~0.3 ms) — **shipped v2.3**
- **Tier 3:** Full TTM pooling-region statistical replacement via WebGPU compute — planned

The v2.3 implementation diverges from the original spec: oriented sine gratings replace Walton's steerable filter decomposition. The result is simpler, faster (under 0.3ms vs the spec's 2-3ms estimate), and sufficient for the tile-based statistics the pipeline requires. Walton's full steerable pyramid remains an option for Tier 3 if perceptual fidelity demands it.

**Work:**
- [x] WebGPU compute shader path for Tier 2.5 (two-pass: stats extraction + oriented noise synthesis)
- [x] Benchmark against current simplex noise + grid scramble
- [ ] Prototype Tier 2 statistical pooling in current fragment shader
- [ ] TTM integration through crowding branch point (Tier 3)

---

### Spacing-Dependent Crowding
**Status:** Architectural limit documented

Current V1 stage modulates distortion *strength* by density, not *spacing* by flanker distance. Bouma's rule predicts critical spacing as ~0.5× eccentricity; our sigmoid gate responds to density, not inter-element distance.

Requires pooling-region computation that the single-pass fragment shader cannot express. The crowding branch point accepts new implementations; the missing piece is a pooling-region pass.

---

### Saliency Resolution Upgrade
**Status:** Known limitation

Bottom-up saliency worker operates at 256px — cannot resolve UI elements smaller than ~60px. Face detection at 640px provides dominant protection signal.

**Options:**
- [ ] Increase worker resolution (512px) with performance budget analysis
- [ ] Add dedicated small-element detector for buttons/icons
- [ ] Multi-resolution saliency (coarse + fine pass)

---

### Suprathreshold Correction Across Channels {#suprathreshold-correction}
**Status:** Open question from validation — [Wave 1 chart 2](tests/validation/reports/color-search-report.html)

Power-law exponent (0.5) from Jiang et al. 2022 was measured for luminance contrast. Applied to chromatic channels without evidence the same exponent holds. Bowers 2025 decay constants partially compensate, but the interaction is untested.

**Validation finding (v2.1):** Bowers 2025 and Mullen & Kingdom 2002 diverge in the near-periphery. At 5°, Bowers (suprathreshold appearance) shows ~95-100% retention for both RG and BY, while Mullen & Kingdom (threshold sensitivity) and our model both predict meaningful decay. At 15°, the Bowers BY/RG ratio is 21% off the model prediction (threshold=20%). The model sides with Mullen & Kingdom because it uses threshold-derived decay constants, then applies a flat suprathreshold correction — but the correction is insufficient in the parafovea (2-8°).

**Implication:** The `supra=0.5` exponent may need to be eccentricity-dependent rather than flat. Near-peripheral color appearance is more robust than threshold sensitivity predicts (contrast constancy). The parafovea is where most UI interaction happens — over-desaturating it is the highest-cost error the model can make.

**Possible fixes:**
- [ ] Eccentricity-dependent suprathreshold exponent: stronger compression (higher effective exponent) at small eccentricities, converging to current 0.5 in far-periphery
- [ ] Separate chromatic suprathreshold exponents for RG vs BY (Jiang 2022 measured luminance only)
- [ ] Fit suprathreshold curve directly to Bowers data points (5°, 15°, 75°) rather than deriving from threshold

**Discussion:** Queued for Rosenholtz/Blauch meeting

---

## Open — Tier 3 (Polish / Future)

### Performance Optimizations
- [ ] Pre-allocate ImageData buffer (eliminate 60 allocations/sec in `processFrame`)
- [ ] Pack saliency + density into single texture (reduce texture lookups by 25–30%)
- [ ] Simplify Oklab conversions (lookup tables for gamma correction)
- [ ] OffscreenCanvas renderer (move WebGL to worker thread) — high effort, unclear benefit since GPU-bound

### Fixation Recording & Export
- [ ] Record fixation sequences with timestamps and dwell times
- [ ] Multi-zone capture (fovea/parafovea/periphery at different resolutions)
- [ ] Interactive HTML export with scrubber
- [ ] Animated export (GIF/WebM)
- [ ] `.scrutinizer` archive format

### Visuospatial Memory Simulation
Model the visuospatial sketchpad of working memory. Foveated regions "decay" back to peripheral state after ~10s or when cognitive load exceeds ~5 chunks. Teaches cognitive load — if a user scans frantically to keep the mental model alive, the design is too dense.

- [ ] Secondary mask texture for attention history
- [ ] Decay shader (global alpha subtraction per frame)
- [ ] Compositor: `FinalPixel = mix(MongrelPixel, CleanPixel, MaskValue)`

### Distribution
- [ ] `electron-builder` multi-platform builds (macOS .dmg, Windows .exe, Linux .AppImage)
- [ ] macOS code signing + notarization (currently signed, not notarized)
- [ ] Auto-update via `electron-updater`

### Mouse Proxy Error Distribution
Mouse position is a poor stand-in for gaze during reading and visual search. Need quantitative data on how eccentricity error differs across task types. Informs how much to trust the current proxy model.

### Far-Periphery Chromatic Correction
Bowers 2025 shows RG sensitivity decline slows beyond ~40°, while castleCSF's exponential continues predicting aggressive attenuation. Not visible at desktop viewing distances (<30°), but needed for VR/AR extension.

---

## Code Cleanup
- [ ] Remove commented-out code blocks
- [ ] Clean up unused uniform locations in `webgl-renderer.js`
- [ ] Audit dead config options in `settings-manager.js`
