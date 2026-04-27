# Scrutinizer TODO

Migrated from master backlog on 2026-03-25. Detailed tasks for the Scrutinizer foveated vision simulator.

---

## Codebase Cleanup

- [ ] **Rename `mongrelMode` -> `poolingMode`** -- "Mongrel" is academic; "pooling" describes the shader. ~42 files.
- [ ] **Rename peripheral2.frag -> peripheral.frag** -- peripheral2 is the active shader; peripheral.frag is dead code. Delete old, rename, update imports.
- [ ] **ContentAnalyzer interface** -- Formalize registry in PipelineOrchestrator for pluggable analyzers.
- [ ] **Evaluate removing legacy chromatic paths** -- `chromatic_pooling: true` is default (v2.5), legacy branches may be dead code.
- [ ] **Prepare CLAUDE.md for scrutinizer2025 repo**

## Validation & Science

- [ ] **Restore peripheral-OCR validation gate** -- `scripts/validate-peripheral-ocr.js` is currently unusable: tesseract.js returns 0 words on captures because the integration test pipeline now produces images at DPR 1 (1920×984), but the original baseline was DPR 2 (3840×1888) where text is large enough for reliable OCR. Two paths: (a) force the integration capture pipeline back to DPR 2, or (b) add a 2× upscale pre-OCR step in the validator. Either restores the only validation gate that meaningfully discriminates "text readable in periphery" from "no text anywhere" — the gap that allowed a regression to slip through smoke + temporal-variance + unit tests during v2.7.3 development. v2.7.3 release notes call this out as the next big bit.
- [ ] **Update eccentricity peripheral overlay to isotropic cortical grid** -- Current overlay uses simple concentric rings. Should render the FOVI isotropic grid (adaptive spoke count per ring, square cells in cortical space). Match `computeCorticalSector()` geometry from peripheral.frag / Blauch et al. 2026.
- [ ] **RFV usability testing recommendations doc** -- Practical guide for using Scrutinizer as Reduced Functional Field of View tool.
- [ ] **MIP chain explainer post update** -- Three sampling paths, DoG isotropy, box vs Gaussian tradeoff, v2.5 Jacobian fix.
- [ ] **Applied UI Saliency Validation** -- Survey applied saliency studies (Halverson/Hornof, UEyes, MIT300, HCEye). Design Wave 4b UI element protection validation.
- [ ] **LukeW Inline Validation Replication** -- Obtain stimulus materials, run through Scrutinizer at measured eccentricities.
- [ ] **"What Peripheral Vision Does to Your UI"** -- Real web content through validated pipeline. CHI/UIST paper potential.
- [ ] **D3 Brown et al. Ground Truth Validation** -- Run Brown metamer pipeline, per-eccentricity SSIM comparison. Scripts set up, needs execution.
- [ ] **Psychophysics Validation Suite** -- Phases 1-4: literature mining, synthesis, technology planning, progressive execution (Waves 1-5).
- [ ] **Covert Peripheral Attention Model** -- Option-hold zoom lens (Eriksen & St. James 1986).
- [ ] **Consumer-Hardware Calibration Pipeline** -- MediaPipe Iris distance + WebGazer gaze + Motion Silence staircase.
- [ ] **Continuous Chromatic Integration** -- Replace discrete DoG-band pooling with continuous perceptive-field integration via 2D LUT.
- [x] **Scanpath Replay & Validation** -- Common format, ScanpathPlayer, `scrutinizer-audit replay` CLI. Shipped v2.7.1: ScanpathPlayer, 3 importers (AdSERP, UEyes, COCO-Search18), replay-adserp.js CLI, fullpage gazeplot tile capture.
- [x] **Mouse Position Replay** -- MouseCursorPlayer renders cursor independently from gaze. Orange arrow cursor + click pulse in SVG overlay. Shipped v2.7.1.
- [ ] **Gaze Replay Blog Post** -- `scrutinizer-www/src/blog/drafts/2026-04-02-gaze-replay.html`. Needs: hero image (raw vs gazeplot side-by-side), 4-up gazeplot grid crops, task model SVG, interactive explorer screenshot. Fix image paths once assets are finalized.
- [x] **Fix scanpath coordinate alignment** -- FPOGX/FPOGY are screenshot-space at 1280px (confirmed by AdSERP authors). Render SERPs at screenWidth, map coordinates directly. Previously had wrong 1422px window-width rendering causing reflow drift.
- [ ] **Full-page gazeplot scroll offset** -- Tile capture scrolls by physical pixels (DPR-scaled) instead of CSS pixels. Tiles overlap or gap on some trials. Need `th` from CSS content bounds, not physical.
- [ ] **Suppress mouse during TEST_MODE captures** -- Physical mouse movement contaminates gazeplot renders. TEST_MODE should ignore real cursor events.
- [ ] **Golden Captures** -- Retroactive v1.8.0 captures, optimize capture suite performance.
- [ ] **FOVI Demo Page Redo** -- Fix flipped images, color decay, clean interactive demo.
- [ ] **Color Search Experiment** -- PostHog opt-in logging for color-search.html.
- [ ] **jsPsych Integration** -- Spec at `docs/JSPSYCH_INTEGRATION_SPEC.md`. Phases 1-3.

## Minecraft Mode Rework

- [ ] Block size = MIP level, color averaging, grid alignment, update modes.json/docs

## Mongrel Textures / PS Synthesis

- [ ] Ship Tier 2: contrast-preserving statistical MIP
- [ ] Ship Tier 3: tile atlas matching
- [ ] Async PS synthesis "Research" mode (WASM)
- [ ] Adopt log-polar warp from Brown et al. 2023
- [ ] End-stopped feature detection pass
- [ ] Generate ground truth mongrels offline
- [ ] Populate Tier 3 atlas via Brown et al.
- [ ] Pre-pool chromatic attenuation in crowding-synth.wgsl

## Blog -- Pending Posts

- [ ] **"Why Zebra Stripes Work"** -- Six reinforcing mechanisms. Concrete UI pattern, clear science.
- [ ] **"500 Million Years of Blue"** -- Evolutionary color vision history. Nature Brief.
- [ ] **"What Painters Already Knew"** -- Neuroscience -> design practice bridge. Design Brief. Includes EXIT sign showdown, school zone sign A/B.
- [ ] **"Your Color Palette Has a Viewing Distance"** -- UX color guidance is eccentricity-blind. Side-by-side captures of popular sites.
