# Changelog

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
    - New uniforms: `u_fovi_enabled`, `u_cmf_a`, `u_fovi_color_sigma`.
    - When enabled: logarithmic MIP scaling via CMF (log2((r_deg + a) / a)) and CMF-derived DoG band cutoffs.
    - Modes 0 & 1 retain legacy pipeline (`fovi_enabled: false`) — FOVI's CMF models cortical magnification only, not the full peripheral detail loss (crowding, RF growth, contrast sensitivity). Existing parameters already approximate the combined perceptual effect.
- **Mode 6: FOVI (Cortical Magnification)**: FOVI's CMF as a standalone MIP-sampling mode, orthogonal to Scrutinizer pipeline.
    - Single CMF-driven MIP blur (no DoG band decomposition).
    - Gaussian color decay (V4 style 6) is Scrutinizer's own addition for perceptual comparison — not from FOVI, which is purely spatial.
    - No LGN gating or V1 distortion — clean comparison baseline.
- **Mode 7: Legacy v1.6 (Comparison)**: Frozen v1.6 pipeline snapshot for A/B dogfooding.
    - Linear MIP scaling, hand-tuned DoG cutoffs, `fovi_enabled: false`.
    - Identical to pre-v1.7 mode 0 behavior.
- **Mode 8: Gaussian Desaturation (Experimental)**: Controlled experiment isolating desaturation curve shape.
    - Identical pipeline to mode 0 (same DoG, LGN gating, V1 distortion, MIP).
    - Replaces smoothstep ramp with Gaussian exponential decay: `1 - exp(-r_deg / sigma)`.
    - Single variable changed for perceptual matching study: which curve better models the rod-cone transition?
    - Sigma (4.0 default) maps to effective cone density falloff distance in degrees.

### Changed
- modes.json metadata version bumped to 2.0.0 (new `fovi_*` pipeline params).

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
    - Decomposes hardware MIP chain into 4 Laplacian pyramid bands with M-scaling rolloff per band.
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
