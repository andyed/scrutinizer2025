# Changelog

## [2.2.0] - 2026-03-09

### Added
- **Oriented DoG Bands (Phase 1-3)**: Orientation-selective band attenuation in `peripheral.frag`. Phase 1: oblique effect — cardinal edges get M-scaling cutoffs pushed ~50% further (Appelle 1972). Phase 2: 4-channel V1 simple cell energy decomposition (H/V/D45/D135) replacing `cos(2θ)` (Hubel & Wiesel 1962). Phase 3: radial-tangential anisotropy — tangential edges +30%, radial -15% (Toet & Levi 1992). 3 uniforms: `u_dog_oriented`, `u_dog_orient_bias`, `u_dog_radial_bias`. 4-tap MIP-1 gradient with BGRA-corrected luminance, gradient magnitude gate. Enabled on modes 0 and 1.
- **Orientation Diagnostics**: Debug level 4 (4-channel energy: R=H, G=V, B=diagonal) and debug level 5 (band weights + orientation tint with fovea blend). Menu: Simulation → Utility → Orientation Diagnostics.
- **Keyboard Shortcuts**: Direct keyboard access to visualization modes via Simulation menu accelerators.
- **Oriented DoG Capture Script**: A/B capture comparing oriented vs isotropic DoG output across reference pages. `TEST_DOG_ORIENTED` and `TEST_DOG_ORIENT_BIAS` env vars for parametric testing.
- **Validation Report Format**: Claim/Basis/Result structure with pass/partial/fail badge pills, replacing Published/Validation/Result.
- **Validation Regression Tests**: 23 Jest tests encoding psychophysical validation findings (Waves 1–3: chromatic decay, spatial frequency ordering, density-gated crowding) as automated guards against `modes.json` parameter regressions. Loads parameters from source of truth and validates against Bowers 2025 published data.

### Changed
- **Mongrel textures spec**: Updated for v2.1 with timestamps added to all specs.
- **Roadmap**: Spec index table with status triage added. Linguistic priming spec refreshed to v3, roadmap condensed.

### Fixed
- **Debug 5 fovea circle**: White fovea circle in orientation diagnostics mode corrected.
- **Toolbar clipping**: Fixed toolbar clipping in visualization mode keyboard shortcut additions.
- **Scroll-to-top in captures**: Capture scripts now scroll to page top before capture, eliminating scroll-position variation.
- **Arxiv table overflow**: Fixed table overflow in two-column layout.

### Docs
- README: DOM-aware rendering rationale, LGN/V1/V4 pipeline table with deep links, structure map as DOM analysis, validation case study, psychophysical validation section with published data table.
- Arxiv paper: Gaussian comparison conditions added to saliency and color-search analysis. Communications review fixes.
- Release notes (v2.1): Undefined technical terms defined inline. Blog post links, published data links, grad student project cross-links added.

## [2.1.0] - 2026-03-08

### Added
- **8 Half-Octave DoG Bands**: `peripheral.frag` upgraded from 4 octave-spaced to 8 half-octave bands. 9 MIP levels (LOD 0.0–4.0), √2 frequency spacing, smoother blur gradient. Half-integer LODs use hardware trilinear interpolation natively.
- **Five-Wave Psychophysical Validation**: Automated test suite against published data — chromatic decay (Hansen 2009), spatial frequency (Rovamo 1979), crowding geometry (Bouma 1970), saliency protection (Itti & Koch 2001), mixed-density UI (Halverson & Hornof 2011). 5 capture scripts, 5 analysis scripts, 25+ golden captures.
- **15 Experimental Stimulus Pages**: Open-source HTML psychophysical stimuli (color-search, spatial-acuity, crowding variants, saliency-popout, face-test, halverson-mixed-density). Menu: Go → Reference Pages → Experimental Stimulus.
- **Capture Infrastructure**: `TEST_LOAD_TIMEOUT` for heavy external pages, `capture-appendix-baselines.js`, appendix figures (fig-a1, fig-a2).
- **Band Weight Analysis**: `scripts/analyze-dog-bands.js` — pure math analysis of DoG band weights across eccentricity for both linear and CMF paths.

### Fixed
- **Toolbar clipping**: `getSize()` → `getContentSize()` for child view bounds. Title bar height was eating into toolbar, cropping URL bar and eye toggle.
- **Polar sector R:T ratio**: `peripheral.frag` spoke count computed from biased ring width, cancelling 2:1 radial elongation. Fixed to use unbiased width.
- **V1 far-peripheral growth**: Growth factor tuned 0.5→1.5 via capture-analyze loop against crowding reference pages.
- **Composite Rovamo correlation**: Replaced per-band Spearman with frequency-weighted composite metric (r=0.600).

### Docs
- Arxiv paper: Walton 2021 contradiction fixed, WebGPU tiered roadmap, band equations updated to half-octave.
- Developer guide, primer, foveated vision model, oriented DoG spec all updated for 8-band architecture.

## [2.0.0] - 2026-03-07

### Added
- **Minecraft Mode (Mode 4)**: CMF-driven block quantization (4-64px) with per-channel Oklab neighbor averaging. Fovea-relative grid, RG boundaries merge while YV stays sharp.
- **Minecraft Eyeball (Mode 8)**: Polar variant — wedge-shaped sectors sized by CMF, radially elongated ~2:1 approximating TTM-predicted pooling geometry. Same Oklab chromatic decay.
- **Blueprint Mode (Mode 3)**: ARIA-typed wireframe from live DOM. Structure map alpha encodes role IDs (0–12), shader renders color-coded bounding boxes. Fovea shows original content, periphery transitions to blueprint wireframe.
- **Density-Gated Crowding**: Sigmoid gate on structure map density modulates V1 distortion strength. Dense content gets full crowding; isolated elements spared (0.3× floor). Threshold=0.6, steepness=20.0.
- **Eccentricity Scaling**: `u_ecc_scaling` uniform (default 0.75, Brown et al. 2023) modulates pooling growth rate across all CMF-enabled modes.
- **Toggle Effects On/Off**: Simulation → Behavior → Toggle Effects (Cmd+E). Provides menu access to the toolbar eye button toggle.

### Changed
- **Chromatic decay recalibrated**: RG decay 0.059→0.072, YV decay 0.004→0.014 (Bowers et al. 2025 suprathreshold measurements).
- **Mode count**: 9→10 modes (4 research, 4 presentation, 1 experimental).

### Fixed
- **Toolbar URL overflow**: Long URLs now truncate with ellipsis instead of pushing the eye toggle off-screen.
- **Toolbar icon alignment**: Eye toggle and version label vertically centered in 40px toolbar.

### Docs
- Arxiv paper synced with shipped features; new Open Questions section.
- 6 stale doc status lines updated (Planned→Shipped).

## [1.9.0] - 2026-03-04

### Added
- **Per-Channel Chromatic Pooling (castleCSF)**: Replaces uniform chrominance reduction with biologically accurate per-channel decay in DoG band reconstruction. RG (red-green) attenuates ~2.5× faster than achromatic; YV (blue-yellow) persists into far periphery. Both channels now have per-band frequency-dependent attenuation — large colored regions preserve hue further than small ones for both RG (k_ef=0.003) and YV (k_ef=0.008). Suprathreshold correction (`u_supra_exponent = 0.5`) converts castleCSF detection thresholds to appearance (Jiang, Shooner & Mullen 2022). 6 uniforms. Enabled on modes 0, 1, 9.
- **Chromatic pooling on Mode 9 (Congestion-Gated Pooling)**: Mode 9 now inherits full per-channel RG/YV chromatic pooling from Mode 0.
- **Saliency vs Congestion Split View**: Side-by-side heatmap rendering — saliency (indigo-white, "What pops out?") and congestion (blue-yellow-red, "How cluttered?") with labeled divider. Menu: Simulation → Utility → Congestion Report.
- **scrutinizer-audit CLI + MCP Server**: Headless analysis pipeline (Playwright) reusing congestion-core.js scoring. CLI: positional URLs, sitemap parsing, desktop+mobile viewports, JSON/HTML output, CI fail-above gate. MCP: `analyze_url`, `analyze_urls`, `compare_pages` tools.
- **Crowding Diagnostics**: Two reference pages (`crowding.html`, `crowding-stimulus.html`), simulation limitations doc, density-gated crowding spec.
- **Saccadic Blindness**: Foveal/parafoveal regions shrink proportionally to mouse velocity (`smoothstep(4, 10, velocity)`), simulating saccadic suppression. Menu toggle, off by default. Both shaders (peripheral.frag, peripheral.frag).
- **Golden captures**: Chromatic pooling on/off variants for color-spectrum (modes 0, 1) and dashboard pages.
- **CMF MIP mapping unit tests**: Validate logarithmic CMF→MIP level conversion.

### Fixed
- **Chromatic eccentricity decoupling**: Per-band RG/YV decay now uses true gaze eccentricity (`visual_ecc`) instead of V1 distortion-coupled eccentricity. A pixel at 15° was previously seen as ~0.6° by the chromatic path — castleCSF decay was near-zero. Spatial band weights (w0-w3) still use `coupledEccentricity`.
- **Suprathreshold chromatic correction**: castleCSF k_e values are detection thresholds, not appearance. Added power-law compression (exponent 0.5) — reds at 10° retain ~51% instead of ~26%.
- **Red Kill Switch gating**: Guarded with `u_chromatic_pooling < 0.5 || u_dog_enabled < 0.5` — per-band RG decay at correct eccentricity handles red suppression. Base desaturation always runs (complementary, not alternative).
- **Chromatic pooling override**: `_chromaticPoolingOverride` flag pattern prevents `updateConfigFromMode()` from clobbering manual toggle on every frame.
- **CMF→MIP mapping**: Corrected to `ln(r+a) - ln(a)` with `cortical_max` normalization (commit 5be3b2b).

### Removed
- **Mode 8 (Gaussian Desaturation)**: Removed. castleCSF per-channel pooling (v1.9.0) supersedes the Gaussian vs smoothstep desaturation comparison. The mode was also broken — missing `chromatic_pooling` in config caused triple desaturation stacking on saturated content. The Gaussian functional form (exp(-r/σ)) is wrong for RG decay: Bowers, Gegenfurtner & Goettker (2025) showed RG attenuation is biphasic (steep to ~15°, then shallower), not pure exponential. Gaussian color decay remains in Mode 6 (CMF standalone) where it serves a different purpose.

### Changed
- **Mode 4: Cyberpunk → Minecraft (Block Pooling)**: Blocks sized to CMF MIP level (4-64px), fovea-relative grid, channel-independent neighbor color averaging in Oklab. Demonstrates customizing the baseline simulation — same CMF math, visible as block geometry.
- **Rename `fovi_*` → `cmf_*`**: Config keys, shader uniforms, and JS variables renamed from `fovi_` prefix to `cmf_`. "FOVI" is the name of a specific model; the feature is cortical magnification function (CMF) — not FOVI-specific.
- **CMF log path default for Modes 0 and 1**: Research modes now use logarithmic MIP scaling via CMF instead of legacy linear `normalizedEcc * 2.5`. Mode 7 retains `cmf_enabled: false` as frozen comparison baseline.
- **Doc terminology scrub**: Replaced "desaturation" with "chromatic pooling" / "chrominance reduction" across 8 docs where describing biology. Peripheral color is pooled (mean chromaticity preserved), not lost.
- **Hansen et al. 2009 citation correction**: Paper measures detection thresholds only, not suprathreshold appearance. Separated from Jiang et al. 2022 citation. PDF archived in `docs/research/`.

## [1.8.0] - 2026-03-03

### Added
- **Feature Congestion Pipeline (Rosenholtz 2007)**: Simplified Oklab-space Feature Congestion — local variance across L, |a|, |b| channels with fixed σ=2.5. Dual-worker architecture: saliency (256px real-time) + congestion (1024px on-demand). Scoring: `sqrt(congestion_p90 × 0.7 + edgeDensity_p90 × 0.3) × 100`. Validated against Python reference (Spearman ρ = 0.93 at 768px).
- **ComplexityHUD**: Interactive draggable overlay with Score / Stats / Spatial tabs. Congestion heatmap on TEXTURE4 (blue → yellow → red). Scroll/navigation-aware — hides on scroll, restores when fresh results arrive.
- **Mode 9: Congestion-Gated Pooling**: High-congestion regions get up to 2× MIP pooling boost via `coupledEccentricity × (1 + congestion)`. Auto-starts high-res congestion worker on mode selection; recomputes on scroll/navigation. Tests Rosenholtz (2012) prediction that clutter and crowding share the same summary-statistic computation. Tagged `experimental` category.
- **Validation pipeline**: Three-script architecture (`validate-congestion.py`, `extract-congestion.js`, `compare-congestion.js`) for Spearman rank correlation against Rosenholtz reference.

### Fixed
- **Parafoveal blur band**: Replaced flat `eccentricityScale = 0.15` across the entire parafovea with a `smoothstep` ramp from 0.0 (inner) to 0.15 (outer boundary). Inner parafovea stays sharp — word-length cues survive per Rayner (1998). Widened fovea-to-pooled MIP blend from `fovea_radius × 0.1` to `× 0.5` to eliminate the abrupt soft step.

### Changed
- **Linear M-scaling**: Replaced geometric 2x band cutoffs (0.3, 0.6, 1.2, 2.4 × E2) with Rovamo & Virsu (1979) formula. New cutoffs: `E2 × (2^k − 1)` giving 1, 3, 7, 15 × E2. Coarse structure persists further into periphery.
- **E2 recalibration**: High-Key 0.5→0.15, Biological 0.4→0.12 to preserve band-0 onset under linear cutoffs.
- **Approximate Laplacian pyramid**: Qualified "Laplacian pyramid" terminology across all docs, arxiv paper, and shader comments. Hardware MIP uses box/bilinear, not Gaussian (Burt & Adelson 1983). Added citation to `references.bib`.
- **Output clamping**: Final color clamped to [0,1] to prevent negative-going band artifacts.
- **Golden captures**: Removed 348MB bulk captures from tracking, gitignored. Curated mode-comparison captures in `docs/golden/`.
- **.claude config**: Checked in settings, skills, and agent memory.

## [1.7.1] - 2026-02-28

### Changed
- **Simulation Menu Reorganization**: Restructured the Simulation menu to foreground behavioral simulation over rendering presentation.
    - **Behavior** submenu is now first — contains Visual Memory, Enable Structure Map, Enable Saliency Modulation (the cognitive processes being modeled).
    - Experimental simulation models (FOVI, Legacy v1.6, Gaussian Desaturation) moved from Utility to Behavior — these are alternative pipelines for testing, not rendering styles.
    - **Utility** submenu replaces the old "Aesthetic Mode" nesting — contains the 6 rendering/presentation modes plus Show Structure Map / Show Saliency Map debug views.
    - **Content Analysis** submenu removed — its items redistributed to Behavior (Enable toggles) and Utility (Show toggles).
    - Foveal, Peripheral, and Visual Overlay submenus unchanged.
    - Aesthetic mode radio buttons now sync across Behavior and Utility submenus via menu rebuild on selection.
    - No shader or modes.json changes — purely a menu organization change.

## [1.7.0] - 2026-02-28

### Added
- **FOVI Cortical Magnification Function**: Added FOVI's CMF (Blauch, Alvarez & Konkle, 2026, arxiv:2602.03766) as a switchable MIP-sampling mode. This implements one component of FOVI — the spatial resolution falloff — not the full kNN sensor manifold or neural network pipeline.
    - New uniforms: `u_cmf_enabled`, `u_cmf_a`, `u_cmf_color_sigma`.
    - When enabled: logarithmic MIP scaling via CMF (log2((r_deg + a) / a)) and CMF-derived DoG band cutoffs.
    - Modes 0 & 1 retain legacy pipeline (`cmf_enabled: false`) — FOVI's CMF models cortical magnification only, not the full peripheral detail loss (crowding, RF growth, contrast sensitivity). Existing parameters already approximate the combined perceptual effect.
- **Mode 6: FOVI (Cortical Magnification)**: FOVI's CMF as a standalone MIP-sampling mode, orthogonal to Scrutinizer pipeline.
    - Single CMF-driven MIP blur (no DoG band decomposition).
    - Gaussian color decay (V4 style 6) is Scrutinizer's own addition for perceptual comparison — not from FOVI, which is purely spatial.
    - No LGN gating or V1 distortion — clean comparison baseline.
- **Mode 7: Legacy v1.6 (Comparison)**: Frozen v1.6 pipeline snapshot for A/B dogfooding.
    - Linear MIP scaling, hand-tuned DoG cutoffs, `cmf_enabled: false`.
    - Identical to pre-v1.7 mode 0 behavior.
- **Mode 8: Gaussian Desaturation (Experimental)**: Controlled experiment isolating desaturation curve shape.
    - Identical pipeline to mode 0 (same DoG, LGN gating, V1 distortion, MIP).
    - Replaces smoothstep ramp with Gaussian exponential decay: `1 - exp(-r_deg / sigma)`.
    - Single variable changed for perceptual matching study: which curve better models the rod-cone transition?
    - Sigma (4.0 default) maps to effective cone density falloff distance in degrees.

### Changed
- modes.json metadata version bumped to 2.0.0 (new `cmf_*` pipeline params).

## [1.6.0] - 2026-02-28

### Changed
- **De-Monolith Refactor**: Extracted three domain modules from the 969-line `scrutinizer.js` monolith:
    - `gaze-model.js` (166 lines) — oculomotor system proxy (velocity tracking, fixation detection, saccadic suppression)
    - `visual-memory.js` (254 lines) — visuospatial working memory (fixation buffer, mask rendering, decay)
    - `content-analysis.js` (356 lines) — pre-cortical feature extraction (structure map scanning, saliency, DOM observation)
    - `scrutinizer.js` is now a thin Pipeline Orchestrator (535 lines) with backward-compatible property proxies.
- **Unit Tests**: Added 138 unit tests for pure-function modules (oklab-utils: 73, gestalt-processor: 41, color-saliency-map: 24).

### Added
- **DoG Peripheral Reconstruction**: New biologically-inspired peripheral rendering mode replacing simple MIP pooling with Difference-of-Gaussians band decomposition.
    - Decomposes hardware MIP chain into 4 approximate Laplacian pyramid bands (box/bilinear, not true Gaussian) with M-scaling rolloff per band.
    - Preserves low-frequency structure (layout, buttons, large text) while filtering high-frequency detail (serifs, fine textures).
    - Gated by `dog_enabled` uniform — legacy MIP pooling preserved when disabled.
    - New uniforms: `u_dog_enabled`, `u_dog_e2` (M-scaling half-resolution eccentricity), `u_dog_sharpness` (band rolloff sharpness).
    - Enabled by default in High-Key and Biological modes; other modes unchanged.
    - Near-zero additional cost: reuses existing hardware MIP chain from `gl.generateMipmap()`.

## [1.5.0] - 2026-01-30

### Added
- **Mobile Emulation**: New "Mobile Emulation" submenu in View menu.
    - Simulates iPhone viewport (390x844), scale factor (3.0), and User Agent.
    - Automatically resizes and locks window to phone dimensions.
    - Restores previous window size and desktop mode when disabled.
- **Touch Simulation (Alpha)**: Added support for synthesizing touch events.
    - Hold `Option` (Alt) + Click while in Mobile Emulation mode to trigger `touchStart` sequence instead of mouse events.
    - *Note: This is an experimental feature to unblock testing of touch-only interactions.*
- **Responsive Toolbar**: Redesigned toolbar URL input for better usability on narrow (mobile) screens.
    - Replaced inline text input with a clickable trigger button.
    - Added dedicated URL entry dialog window.

### Changed
- **Window Management**: Adjusted window bounds saving logic to ignore mobile emulation resizing, preserving user's desktop window preference.
- **Toolbar**: Updated toolbar layout to prevent overflow artifacts in small windows.
