# Scrutinizer v2.1.0 Release Notes

**Release Date:** March 2026

**Blog post:** [Measuring the Pipeline](https://andyed.github.io/scrutinizer-www/blog/2026-03-08-v2.1.html)
**Published data:** [tests/validation/published-data/](https://github.com/andyed/scrutinizer2025/tree/main/tests/validation/published-data) — Rovamo 1979, Hansen 2009, Mullen & Kingdom 2002, Bowers 2025
**Previous:** [v2.0 blog post](https://andyed.github.io/scrutinizer-www/blog/2026-03-07-v2.0.html)

## In This Release

1. [Psychophysical Validation Pipeline](#psychophysical-validation-pipeline) — Four-wave validation against published data: chromatic decay, spatial frequency, crowding geometry, saliency protection. 5 capture scripts, 5 analysis scripts, 15 reference pages, 25 golden captures.
2. [Shader Fixes from Validation](#shader-fixes-from-validation) — Polar sector R:T ratio corrected (1:1→2:1), V1 far-peripheral growth factor tuned (0.5→1.5), composite Rovamo correlation fix.
3. [Experimental Stimuli](#experimental-stimuli) — 15 HTML reference pages shipped as open-source psychophysical stimuli. Menu: Go → Reference Pages → Experimental Stimulus.
4. [Arxiv Paper Updates](#arxiv-paper-updates) — Walton 2021 contradiction fixed, WebGPU tiered roadmap added, mongrel Tier 2.5 spec.
5. [Wave 5: Halverson Mixed-Density Validation](#wave-5-halverson-mixed-density) — Behavioral validation of density gate against Halverson & Hornof (2011) UI visual search data. Stimulus page, capture script, analysis script.
6. [8 Half-Octave DoG Bands](#8-half-octave-dog-bands) — DoG (Difference of Gaussians — isolates spatial frequency bands by subtracting two blurred versions of an image) peripheral reconstruction upgraded from 4 octave-spaced to 8 half-octave bands. Smoother blur gradient, twice as many frequency transition steps.
7. [Capture Infrastructure](#capture-infrastructure) — `TEST_LOAD_TIMEOUT` for heavy external pages; appendix baseline capture script.

---

## Psychophysical Validation Pipeline

v2.1 ships the validation infrastructure that grounds the arxiv paper's claims. Four waves test the pipeline against published psychophysical data using screenshot-based measurement: known stimuli rendered through the full shader, output pixels measured, results compared against published human vision data.

### Why these four experiments

Each wave targets a different stage of the rendering pipeline and emulates a different class of psychophysical experiment:

**Wave 1 — Chromatic decay** emulates a *color naming task* (Hansen et al. 2009). Colored singletons on a neutral background at increasing eccentricity. The question: does the Oklab RG/YV decomposition predict which colors lose identity first? This tests the V4 chromatic processing stage — the castleCSF contrast sensitivity functions (Ashraf et al. 2024 — a model of how contrast detection thresholds vary with spatial frequency, eccentricity, and chromatic channel) and the suprathreshold correction (adjusting from bare detection thresholds to the perceived appearance of stimuli well above threshold, which is what web colors are). What matters is channel assignment: green tracks the RG decay curve, not BY. A hue-rotation model would get this wrong; Oklab opponent channels get it right.

**Wave 2 — Spatial frequency** emulates a *contrast sensitivity measurement* (Rovamo & Virsu 1979). Sine-wave gratings at known frequencies presented at increasing eccentricity. The question: does the DoG band decomposition attenuate each spatial frequency at the eccentricity predicted by M-scaling (the principle that spatial resolution scales with cortical magnification factor — more cortex per degree near the fovea, less in the periphery)? This tests the retinal ganglion cell stage — the MIP chain as a Laplacian pyramid. The key finding is that the pipeline is frequency-selective (high frequencies drop before low), not uniformly degrading (as Gaussian blur would be).

**Wave 3 — Crowding geometry** emulates a *flanked letter identification task* (Bouma 1970, Toet & Levi 1992). Target letters surrounded by flankers at parametric spacing and eccentricity. The question: does the V1 distortion stage produce crowding zones whose geometry matches published measurements? This tests two things: that polar sector elongation approximates the 2:1 radial:tangential aspect ratio, and that the density gate differentiates crowded from isolated targets. The architectural limit — no spacing-dependent Bouma curve — is documented.

**Wave 4 — Saliency protection** emulates a *visual search task* (Itti & Koch 2001) crossed with a *face detection task* (Hershler & Hochstein 2005). Singletons and faces at known locations, measured for preservation under peripheral rendering. The question: does the saliency-to-shader pipeline actually protect salient content? This tests the LGN gating stage end-to-end: bottom-up saliency (Oklab DoG), face detection (TinyFaceDetector), and the rendering bandwidth allocation.

The four waves map to the four biological stages: retinal GC (Wave 2), LGN gating (Wave 4), V1 crowding (Wave 3), V4 color (Wave 1).

### Validation Summary

| Wave | Domain | Published Basis | Tier 1 | Tier 2 | Tier 3 | Key Finding |
|------|--------|-----------------|--------|--------|--------|-------------|
| 1 | Chromatic decay | Mullen 2002, Hansen 2009, Bowers 2025 | 7/7 | 3/3 | 1/2 | Green tracks RG curve, not BY — hue-based models get this wrong |
| 2 | Spatial frequency | Rovamo & Virsu 1979 | 12/16 | 5/5 | 0/4 | DoG step functions at MIP boundaries vs smooth CSF |
| 3 | Crowding geometry | Bouma 1970, Toet & Levi 1992 | 7/7 | — | — | R:T bug found and fixed; density gate validated at 3.3:1 ratio |
| 4 | Saliency protection | Itti & Koch 2001, Hershler 2005 | 6/7 + 5/5 | — | — | Face saliency 4.79× control; protection ratio 0.283 |

**Tier definitions:**
- **Tier 1** (must pass): Properties that hold by construction — monotonic decay, correct ordering.
- **Tier 2** (should pass): Quantitative agreement within stated tolerances.
- **Tier 3** (stretch): Cross-study correlations where discrete GPU approximations meet continuous psychophysical functions.

### Systematic Failure Modes

Two patterns recur across all four waves:

**Discrete bands vs continuous CSF.** The 8-band DoG produces step functions at each MIP-level boundary. Rovamo's smooth decay curves correlate at r=0.600 but diverge quantitatively. All 4 Tier 3 Rovamo correlations fail for this reason. This is the price of using hardware MIP chains — the same issue documented in the arxiv paper's "Continuous cortical magnification" open problem.

**Strength vs spacing.** The density-gated crowding model modulates distortion strength as a function of eccentricity, not spacing as a function of flanker distance. The pipeline cannot differentiate flankers at 0.2× vs 0.5× eccentricity spacing. This is an architectural limit of per-pixel fragment shaders.

Both failure modes are documented in the arxiv paper (Section 5, Open Problems) and in the validation reports.

### Analysis Scripts

| Script | Wave | Input | Output |
|--------|------|-------|--------|
| `analyze-color-search.js` | 1 | color-search captures | Oklab chroma retention per ring, RG vs BY curves |
| `analyze-spatial-acuity.js` | 2 | spatial-acuity captures | DFT contrast retention per frequency per ring |
| `analyze-crowding.js` | 3 | crowding captures | Cyan cluster spread ratio, centroid displacement |
| `analyze-crowding-geometry.js` | 3 | (analytical — no captures) | MIP pooling vs Bouma, polar sector R:T |
| `analyze-saliency.js` | 4 | saliency captures | Pop-out peak detection, protection ratios |

---

## Shader Fixes from Validation

Three bugs found and fixed through the validation pipeline:

### Polar Sector R:T Ratio (Wave 3)
`peripheral.frag` computed spoke count from biased ring width, cancelling the intended 2:1 radial elongation. Fix: compute from unbiased width `s.ring_center * (ef - 1.0)`. `peripheral2.frag` already had the correct formula. Toet & Levi (1992) measured ~2:1 radial:tangential aspect ratio; the bug produced ~1:1.

### V1 Far-Peripheral Growth (Wave 3)
V1 displacement plateaued beyond the parafovea because eccentricity scaling stopped at the foveal boundary. Growth factor tuned from 0.5 to 1.5 via capture-analyze loop against crowding reference pages. The 6° eccentricity displacement now reaches ~69px for dense content (Bouma predicts 135px; ratio 0.51×).

### Composite Rovamo Correlation (Wave 2)
Per-band Spearman correlations failed because each band transitions 100%→0% at a single cutoff. Replaced with a composite frequency-weighted metric across all bands: r=0.600. Correct rank ordering, quantitatively aggressive.

---

## Experimental Stimuli

15 HTML reference pages ship with the repository as open-source psychophysical stimuli. Accessible via Go → Reference Pages → Experimental Stimulus in the app menu.

| Page | Wave | Tests |
|------|------|-------|
| `color-search.html` | 1 | Colored singletons at 5 eccentricity rings — chromatic decay |
| `color-spectrum.html` | 1 | Continuous gradient — visual chromatic pooling |
| `spatial-acuity.html` | 2 | Sine-wave gratings at 0.25–4 cpd — frequency-selective attenuation |
| `crowding.html` | 3 | Flanked letters at 3°, 6°, 10° — crowding zone measurement |
| `crowding-spacing.html` | 3 | Parametric Bouma spacing (0.2×–0.8× eccentricity) |
| `crowding-radial.html` | 3 | Radial vs tangential flanker arrangement (Toet & Levi geometry) |
| `crowding-stimulus.html` | 3 | Stimulus-specific crowding conditions |
| `saliency-popout.html` | 4 | Color/luminance singletons + face — saliency detection |
| `face-test.html` | 4 | Face detection saliency — protection validation |

Plus 6 general-purpose reference pages (dashboard, article, ecommerce, techmeme, grid, figma) for regression testing.

---

## Wave 5: Halverson Mixed-Density

v2.1 adds a fifth validation wave targeting the density gate — the first wave validated against behavioral data from a real UI search task rather than isolated psychophysical stimuli.

### Why this experiment

Halverson & Hornof (2011) built a model within the EPIC cognitive architecture (Executive Process/Interactive Control — a production-system framework for modeling human perception, cognition, and motor behavior) of visual search in HCI. Their Text-Encoding Error (TEE) model found that peripheral encoding accuracy depends on local text density: 90% accuracy for sparse text (nearest neighbor ≥ 0.15°), 50% for dense text (< 0.15°). The perception region stays constant at 1° — it's encoding quality that drops with density.

This is analogous to Scrutinizer's density gate: the rendered region doesn't change with density, but distortion increases in dense areas. Wave 5 tests whether Scrutinizer's pipeline predicts the same density-dependent degradation pattern that Halverson validated against 24 participants' eye-tracking data.

### Stimulus

`halverson-mixed-density.html` reproduces the mixed-density search task from Halverson & Hornof (2011, Figure 3):

- **6 word groups** in a 2×3 grid spanning 7.5° of visual angle
- **Sparse groups**: 5 words, 0.65° inter-word spacing, larger font
- **Dense groups**: 10 words, 0.33° inter-word spacing, smaller font
- **Three conditions**: all sparse, all dense, mixed (3 sparse + 3 dense)
- **Two modes**: interactive search task (RT collection) and static display (Scrutinizer capture)
- Configurable pixels-per-degree (default 38, matching CAT2000 viewing conditions)
- Word pool: 500+ common English nouns (original used 765 from MRC Psycholinguistic Database)

### Validation (pixel-based, v2.1)

| Tier | Test | Prediction |
|------|------|------------|
| T1.1 | Sparse availability > dense | Density gate assigns less distortion to sparse groups |
| T1.2 | Degradation increases with eccentricity | MIP-level and density gate both scale with distance from fixation |
| T1.3 | Dense groups lose more edge structure | Higher spatial frequency content in dense text is attenuated by DoG |
| T2.1 | Sparse/dense ratio > 1.2 | Matches H&H's 90%/50% encoding accuracy difference |
| T2.2 | Density × eccentricity interaction | Dense text degrades faster with eccentricity than sparse |
| T3.1 | Availability predicts search order | Sparse-first search matches higher peripheral availability |
| T3.2 | Availability gradient correlates with saccade distance | r > 0.7 with H&H observed data |

### Scripts

| Script | Purpose |
|--------|---------|
| `capture-halverson.js` | Captures 3 conditions × 2 modes (filtered + baseline) at central fixation |
| `analyze-halverson.js` | Per-group SSIM, edge density ratio, text contrast ratio, composite availability score |

### Future: Human subjects (post-v2.1)

The stimulus page includes an interactive search task mode collecting RT and accuracy. A future version will add counterbalanced Scrutinizer on/off conditions and structured data export for running the experiment with human participants. See `docs/specs/human_subjects_data_collection.md`.

### Reference

Halverson, T. & Hornof, A.J. (2011). A Computational Model of "Active Vision" for Visual Search in Human-Computer Interaction. *Human-Computer Interaction*, 26, 285-314. DOI: 10.1080/07370024.2011.625237

---

## Arxiv Paper Updates

- **Walton 2021 contradiction fixed.** Introduction and Open Problems now acknowledge Walton et al.'s real-time ventral metamers (SIGGRAPH 2021) while noting their compute-shader approach requires CUDA/DirectX, not available in WebGL2.
- **WebGPU tiered roadmap.** New "Tiered upgrade path via WebGPU" paragraph in Open Problems: Tier 2 (contrast-preserving pooling, WebGL2), Tier 2.5 (Walton smooth moments, WebGPU compute), Tier 3 (full TTM, WebGPU compute).
- **Mongrel textures spec.** Tier 2.5 section added to `docs/specs/mongrel_textures.md` with mechanism, performance estimates, and Vacher & Briand C++ reference for offline ground truth.
- **Grad student projects.** Project 1.2 (Mongrel Synthesis) updated: Walton 2021 and Vacher & Briand 2021 added to references, 5-phase approach aligned to tier hierarchy.

---

## 8 Half-Octave DoG Bands

The DoG peripheral reconstruction in `peripheral2.frag` now uses 8 half-octave bands instead of 4 octave-spaced bands.

### What changed

- **MIP sampling**: 5 levels (LOD 0–4) → 9 levels (LOD 0.0, 0.5, 1.0, ... 4.0). LOD = Level of Detail — which MIP level the GPU samples from, where higher LODs are blurrier. Half-integer LODs use hardware trilinear interpolation natively.
- **Band decomposition**: 4 bands (4, 2, 1, 0.5 cpd) → 8 bands (5.66, 4.0, 2.83, 2.0, 1.41, 1.0, 0.71, 0.5 cpd). Cpd = cycles per degree of visual angle — how many light-dark stripes fit in one degree. Higher cpd = finer detail. Geometric √2 spacing.
- **Cutoff eccentricities**: `cutoff_k = E2 × (2^(k/2) − 1)`. Odd-indexed cutoffs match the old 4-band values exactly — existing E2 tuning carries over.

### Why

With 4 octave-spaced bands, only 1–2 bands carried non-trivial weights at any eccentricity. The blur transition from fovea to periphery had 4 coarse steps. With 8 half-octave bands, the same transition has twice as many steps — each step is a half-octave frequency jump instead of a full octave. The blur gradient is perceptibly smoother.

### What didn't change

No JS changes, no new uniforms, no modes.json changes. All existing uniforms (`u_dog_e2`, `u_dog_sharpness`, `u_chromatic_pooling`, `u_rg_decay`, `u_rg_freq_decay`, `u_yv_decay`, `u_yv_freq_decay`, `u_supra_exponent`) preserved with unchanged semantics. The Gaussian blur path (`sampleMIPPooled`) is unaffected.

### Performance

9 `textureLod` calls vs 5 previously. Half-integer LODs cost 2 bilinear reads each (hardware trilinear), so 13 bilinear lookups total vs 5. The Oklab round-trips in the chromatic path (9 vs 5) dominate cost. Measured frame time delta < 1ms at 1080p.

### Validation

Band weight analysis (`scripts/analyze-dog-bands.js`) confirms the 8-band decomposition consistently produces +1 active band over the 4-band version across the full eccentricity range. The improvement is doubling transition resolution, not quadrupling simultaneous active bands — the smoothstep rolloff width means at most 2 bands are ever in their transition zone at once.

---

## Capture Infrastructure

- **`TEST_LOAD_TIMEOUT`** env var (default 15000ms). Heavy external pages (e.g., minecraft.net) that never fire `did-finish-load` now timeout gracefully and proceed with current page state. Prevents capture scripts from hanging indefinitely.
- **`capture-appendix-baselines.js`** — Captures unfiltered baseline screenshots for arxiv paper appendix figures. 4 stimuli (chromatic, spatial, crowding, saliency) in bypass mode.
- **Appendix figures** — `fig-a1-stimuli.png` and `fig-a2-pipeline-output.png` generated for arxiv paper.
