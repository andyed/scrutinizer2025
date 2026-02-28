# Changelog

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
