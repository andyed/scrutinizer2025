# Scrutinizer Roadmap

Last updated: 2026-03-30 (v2.7.1 + Option A)

## What's implemented

Scrutinizer is a Restricted Focus Viewer that replaces Gaussian blur with a biologically-grounded peripheral pipeline. The architecture table shows what each pipeline stage implements and where it comes from:

| Biology | Computation | Source | Since |
|---------|-------------|--------|-------|
| Oculomotor | Velocity, fixation, saccade detection | — | v1.0 |
| Retinal GC | 12-band DoG via hardware MIP chain | Kuffler 1953, Rodieck 1965 | v1.5 |
| LGN gating | Structure + saliency gate | McAlonan et al. 2008 | v1.6 |
| V1 crowding | Density-gated noise displacement | Pelli 2008 | v1.9 |
| Chromatic decay | Per-channel castleCSF attenuation (Oklab) | Ashraf et al. 2024, Bowers et al. 2025 | v2.0 |
| Oblique effect | Oriented DoG band attenuation | Appelle 1972, Furmanski & Engel 2000 | v2.2 |
| V1/V2 texture | Oriented noise synthesis (WebGPU compute) | Freeman & Simoncelli 2011 | v2.3 |
| Clutter | Feature Congestion scoring | Rosenholtz et al. 2007 | v1.8 |
| CMF geometry | Isotropic cortical sectors (FOVI) | Blauch, Alvarez & Konkle 2026 | v2.6 |
| Reading span | Asymmetric foveal envelope | Rayner 1998 | v2.4 |
| Saliency | Oklab DoG + face detection + DOM structure | Itti et al. 2001 | v1.7 |
| Acuity-gated saliency | Resolution-dependent protection decay | Strasburger et al. 2011 | v2.7 |
| Eccentricity congestion | Two-scale Feature Congestion (foveal + peripheral) | Rosenholtz 2007, Pelli & Tillman 2008 | v2.7 |
| Pyramid synthesis | Laplacian pyramid + cross-scale correlations (Tier 2.75) | Portilla & Simoncelli 2000, Walton 2021 | v2.7 |
| V4 decouple | Eccentricity-direct V4 effects, independent of V1 displacement | Mullen 1991, Curcio 1990 | v2.7.1 |

### What the pipeline preserves vs Gaussian blur

The full pipeline preserves salient content up to 10× better than eccentricity-matched Gaussian blur (the model used by BubbleView, ViewSer, ScreenMasker, and mouseview.js). The 3× baseline advantage comes from the DoG band architecture; the additional 5–8× comes from saliency gating.

## Specs

Active design documents in [`docs/specs/`](docs/specs/). Completed specs are in `docs/specs/implemented/`.

| Spec | Status |
|------|--------|
| [isotropic_cortical_sampling.md](docs/specs/isotropic_cortical_sampling.md) | **Shipped** (v2.6) |
| [oriented_dog_bands.md](docs/specs/oriented_dog_bands.md) | **Shipped** (v2.2) |
| [ratio_reconstruction.md](docs/specs/ratio_reconstruction.md) | **Shipped** (v2.3) |
| [option_a_decouple_spec.md](docs/specs/option_a_decouple_spec.md) | **Shipped** (v2.7.1) — V4 decoupled from V1 |
| [mongrel_textures.md](docs/specs/mongrel_textures.md) | **Tier 2.5 shipped** (v2.3); Tier 3 unblocked by Option A |
| [oblique_effect_validation.md](docs/specs/oblique_effect_validation.md) | Validation in progress |
| [gaussian_blur_comparison.md](docs/specs/gaussian_blur_comparison.md) | **Shipped** (v2.1) |
| [wave6_coco_periph_validation.md](docs/specs/wave6_coco_periph_validation.md) | Scaffolding (v2.4) |
| [linguistic_priming.md](docs/specs/linguistic_priming.md) | **Planned** — information scent via goal embeddings |
| [metamer_mode.md](docs/specs/metamer_mode.md) | **Planned** — summary-statistic pooling |
| [scanpath-replay-spec.md](docs/specs/scanpath-replay-spec.md) | **Planned** — replay recorded mouse/gaze data |
| [human_subjects_data_collection.md](docs/specs/human_subjects_data_collection.md) | **Planned** |
| [brown_dataflow_integration.md](docs/specs/brown_dataflow_integration.md) | Reference — Brown et al. 2023 dataflow architecture |
| [halverson_hornof_validation.md](docs/specs/halverson_hornof_validation.md) | In progress |
| [continuous_chromatic_mip.md](docs/specs/continuous_chromatic_mip.md) | In progress |

<details>
<summary>Completed / shipped specs</summary>

| Spec | Shipped |
|------|---------|
| [implemented/chromatic_pooling.md](docs/specs/implemented/chromatic_pooling.md) | v1.9, updated v2.0 |
| [density_gated_crowding.md](docs/specs/density_gated_crowding.md) | v1.9.1 |
| [cmf_mip_derivation.md](docs/specs/cmf_mip_derivation.md) | v1.8 |
| [blueprint_mods.md](docs/specs/blueprint_mods.md) | v2.0 |
| [isotropic_cortical_sampling.md](docs/specs/isotropic_cortical_sampling.md) | v2.6 |

</details>

---

## Open work

### Biological fidelity

**Full texture-statistics pooling (Tier 3).** The WebGPU compute path synthesizes oriented noise but not full summary statistics per Rosenholtz 2012. Covariance computation within isotropic sectors is feasible on WebGPU but not yet implemented. This is the gap between "preserves luminance variance" and "perceptually indistinguishable from originals in the periphery."

**Suprathreshold correction across channels.** The power-law exponent (0.5) from Jiang et al. 2022 was measured for luminance. Applied to chromatic channels without evidence the same exponent holds. The parafovea (2–8°) is where most UI interaction happens — over-desaturating it is the highest-cost error the model can make. Eccentricity-dependent exponents or channel-specific fits to Bowers 2025 data are the likely fix.

**Visual memory mask gradient.** The memory mask uses a 3-stop radial gradient (1.0→0.5→0.0) with a hard `memoryStrength > 0.7` bypass threshold in the shader. This creates visible circular splotches at recalled fixation locations — the boundary between "clear original" and "pipeline processed" is too abrupt. Fix: soften the gradient tail and lower the bypass threshold, or replace the binary bypass with a smooth blend across the full memoryStrength range.

**Spacing-dependent crowding.** Current V1 stage modulates distortion *strength* by density, not *spacing* by flanker distance. Bouma's rule predicts critical spacing as ~0.5× eccentricity. Requires a pooling-region pass that the single-pass fragment shader cannot express.

### Mouse-gaze coordination

**Gaze-cursor coordination as cognitive signal.** Recent work (Stone & Chapman 2023, Zhu et al. 2023) shows that the relationship between gaze and cursor carries richer signal than either alone — coordination breakdown indicates UX friction, cross-modal fusion improves activity classification by 7.4%. Eye-tracker integration via the gaze-input branch point would let Scrutinizer capture this coordination signal alongside the peripheral rendering.

**Scanpath replay.** Replay recorded mouse or gaze data through the pipeline for offline analysis. mouseview.js records position data but has no replay capability. Spec: [`scanpath-replay-spec.md`](docs/specs/scanpath-replay-spec.md).

### Integration

**Experiment framework integration.** mouseview.js (Anwyl-Irvine et al. 2021) demonstrated that cursor-directed apertures integrate with jsPsych, PsychoJS, and Gorilla for web-based experiments. Scrutinizer's richer peripheral model could serve the same role — a jsPsych plugin would let researchers compare biologically-grounded filtering against Gaussian blur within standard experiment frameworks.

**Semantic guidance (information scent).** Top-down attentional control via goal embeddings. User specifies intent, DOM text nodes are embedded via Transformers.js, cosine similarity scores flow into the saliency texture. No shader changes — enters through existing LGN saliency gate. Spec: [`linguistic_priming.md`](docs/specs/linguistic_priming.md).

**Cognitive architecture integration.** The saliency branch point accepts any bitmap as attentional input, making Scrutinizer a rendering front-end for cognitive models such as SNIF-ACT (Fu & Pirolli 2007) and ACT-R's vision module (Salvucci 2001).

### CLI & build pipeline

**scrutinizer-audit CLI.** Headless Feature Congestion scoring via Puppeteer — batch-score URLs, sitemap crawling, CI integration (`--fail-above` threshold). Shipped in v1.9 (`cli/scrutinizer-audit.js`). Planned: integrate isotropic sampling metrics, OCR readability scores, and saliency protection ratios into the audit output.

**MCP server.** The audit tool exposes an MCP server for Claude Code integration — score pages during design review sessions without launching the Electron renderer. Shipped v1.9.

**Cross-platform builds.** macOS signed. `electron-builder` for Windows (.exe) and Linux (.AppImage) not yet configured. Auto-update via `electron-updater` planned.

### Infrastructure

**Calibrated visual angles.** Separate physical calibration (`px_per_deg` from blind spot method) from comfort zone (`foveaRadius` from user preference). v2.4 added foveal radius presets; the calibration separation is not yet implemented.

**Saliency resolution upgrade.** Bottom-up saliency worker at 256px cannot resolve UI elements <60px. Face detection at 640px is the dominant signal. Options: higher worker resolution, dedicated small-element detector, or multi-resolution pass.

**Distribution.** macOS signed. Cross-platform builds (Windows, Linux), notarization, and auto-update not yet implemented.

---

## Release history

### v2.7.1: Chromatic Fidelity & Scanpath Replay (2026-03-25)
- Unified eccentricity master curve: 6 overlapping smoothsteps → 1 C2-continuous curve + power functions, eliminating Mach bands in parafoveal color transitions
- Luma/chroma split foveal blend (Mullen 1991): progressive chromatic decay visible on uniform surfaces
- Rod desaturation deferred to far periphery when castleCSF active (t³ onset)
- Visual memory: parafoveal radius (2.5× fovea) for recalled fixation footprint
- Visual memory: V4 color effect suppression in remembered regions (memoryStrength → processV4)
- Comfort Mode: +1° clear zone via shader distance offset (microsaccade envelope)
- Scanpath replay: ScanpathPlayer (GazeModel drop-in), COCO-Search18 importer, CLI replay + visualization
- Gazeplot mode: visual memory accumulation across fixation sequence

### v2.7.0: Pyramid Mongrel + Acuity Saliency (2026-03-24)

### v2.6: Isotropic Cortical Sampling (2026-03-20)
- FOVI-derived isotropic sector geometry as default for all modes
- Jacobian-corrected LOD selection (textureGrad with distorted UV derivatives)
- 19-test geometry validation suite
- OCR readability validation (Tesseract)
- All BibTeX entries audited and corrected; DOIs added
- arXiv draft updated (new Section 4.6, RFV framing)

### v2.4: Reading Span & Fovea Degree Correction (2026-03-13)
- Reading span: asymmetric foveal envelope during reading (Rayner 1998)
- Fovea degree correction: fovea_deg 2.0→1.0, default radius 90→45px
- Saccadic blindness default ON
- Wave 6 COCO-Periph validation scaffolding
- Citation export metadata fields

### v2.3: WebGPU Compute Mongrel Synthesis (2026-03-11)
- Tier 2.5 mongrel pipeline: tile-based Oklab statistics + oriented noise synthesis
- Two WGSL compute passes (~900 LOC), under 0.3ms on integrated GPU
- Auto-fallback safety harness
- Ratio reconstruction: dual-LOD structure map sampling
- Soft density gate

### v2.1: Psychophysical Validation & DoG Bands (2026-03-08)
- 12 half-octave DoG bands
- Five-wave psychophysical validation
- Gaussian blur comparison — 5–10× saliency preservation advantage
- 15 open-source HTML stimulus pages

### v2.0: Explainer Modes & Density-Gated Crowding (2026-03-07)
- Minecraft Mode, Blueprint Mode
- Density-gated crowding
- Chromatic decay recalibration (castleCSF)

### v1.5–v1.9 (2025-12 → 2026-02)
- DoG band decomposition via hardware MIP chain
- Feature Congestion scoring (ρ=0.93 vs MATLAB)
- Face detection saliency, DOM structure extraction, LGN gating
- Oklab color space, WebGL 2.0 upgrade
- 10 pipeline modes in declarative JSON registry
