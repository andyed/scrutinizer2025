# Scrutinizer v1.9.0 Release Notes

**Release Date:** March 2026

## In This Release

1. [Per-Channel Chromatic Pooling](#per-channel-chromatic-pooling-castlecsf) — Large colored regions preserve mean chromaticity; small features lose chromatic identity. Per-channel RG/YV decay with suprathreshold correction.
2. [Congestion-Gated Pooling (Mode 9)](#congestion-gated-pooling-mode-9) — Local clutter modulates peripheral spatial pooling strength. Tests the TTM prediction that clutter and crowding share summary-statistic computation.
3. [Saccadic Blindness](#saccadic-blindness) — Foveal region shrinks during rapid mouse movement, simulating saccadic suppression.
4. [Crowding Diagnostics](#crowding-diagnostics) — Reference pages and a simulation limitations doc exposing the density-independent crowding gap.
5. [Saliency vs Congestion Split View](#saliency-vs-congestion-split-view) — Side-by-side heatmap comparison: "What pops out?" vs "How cluttered?"
6. [Mode 8 Removed](#mode-8-removed) — Gaussian Desaturation removed; superseded by castleCSF per-channel pooling.
7. [Identified Simulation Gaps](#identified-simulation-gaps) — Two major gaps documented with specs and fix paths.
8. [scrutinizer-audit — CLI + MCP Server](#scrutinizer-audit--cli--mcp-server) — Headless congestion scoring pipeline for CI and AI-assisted design review.

---

## Per-Channel Chromatic Pooling (castleCSF)

Full spec: [`docs/specs/implemented/chromatic_pooling.md`](specs/implemented/chromatic_pooling.md)

### What It Does

Peripheral color is **pooled, not lost** (Rosenholtz TTM). The visual system averages chromaticity over progressively larger regions with eccentricity — a large colored panel retains its mean hue far into the periphery, while small colored text loses chromatic identity because it falls within a single pooling region. The previous uniform chrominance reduction missed both of these effects: it treated a full-width banner and 14px text identically, and it attenuated red-green and blue-yellow at the same rate.

The new pipeline models two biological asymmetries:

- **Size-dependent preservation:** The DoG bands already decompose content by spatial scale. Large color fields live in low-frequency bands where chromatic pooling preserves mean chromaticity. Small colored features live in high-frequency bands where chromatic spatial resolution is genuinely reduced. Per-band attenuation gives size-dependent color preservation for free — no explicit stimulus-size measurement needed.
- **Channel-dependent rates:** L-M (red-green) is a foveal specialization — midget ganglion cell wiring thins rapidly outside the fovea (castleCSF k_e = 0.059). S-(L+M) (blue-yellow) tracks close to achromatic (k_e = 0.004), persisting far into the periphery. Both channels have frequency-dependent per-band attenuation — YV strongly (k_ef = 0.008), RG weakly (k_ef = 0.003). castleCSF reports k_ef ≈ 0 for RG at detection threshold, but suprathreshold spatial summation means larger red-green stimuli integrate over more receptive fields, yielding better color constancy than small ones.

### Suprathreshold Correction

The castleCSF parameters are detection thresholds — the minimum visible chromatic contrast. Web colors are well above threshold. A follow-up commit added `u_supra_exponent` (default 0.5) applying power-law compression (Jiang, Shooner & Mullen 2022) to convert threshold sensitivity to perceived appearance. At 10° eccentricity, RG retains ~51% appearance instead of ~26% raw threshold.

**Needs calibration data:** The current exponent (0.5) is conservative. Jiang et al. report individual exponents ranging 0.39–0.84 with a mean of ~0.63. Raising `u_supra_exponent` to 0.6–0.65 would preserve more peripheral saturation, which the literature supports. This is a tuning decision — the parameter is exposed as a uniform for exactly this reason — but ground-truth calibration against gaze-contingent photographs or perceptual matching data would pin it down properly.

### What This Produces

| Scenario | Before (Uniform) | After (Per-Channel Pooling) |
|----------|-------------------|---------------------|
| Large blue background at 8° | ~50% color reduction | **~90% color preserved** — large field, low-freq band, slow YV decay |
| Full-width green nav bar at 10° | ~60% color reduction | **~80% preserved** — mean chromaticity pooled over large region |
| Small red button at 8° | ~50% color reduction | **~50% RG remaining** — small stimulus in high-freq band, fast RG decay |
| Teal sidebar at 15° | ~80% color reduction | Blue-yellow persists, red-green faded — perceived hue shifts toward blue |

### Implementation

6 uniforms: `u_chromatic_pooling`, `u_rg_decay`, `u_rg_freq_decay`, `u_yv_decay`, `u_yv_freq_decay`, `u_supra_exponent`. The `chromaticAttenuate()` helper splits each DoG band into Oklab luminance + chrominance, attenuates `a` (RG) and `b` (YV) independently per band, recombines. Both channels now have per-band frequency-dependent attenuation — YV strongly (k_ef=0.008), RG weakly (k_ef=0.003). When chromatic pooling is active, the legacy V4 uniform chrominance path and Red Kill Switch are bypassed.

Enabled on modes 0 (High-Key), 1 (Biological), 9 (Congestion). Menu toggle: Behavior → Chromatic Pooling (RG/YV).

Golden captures added for color-spectrum and dashboard pages with on/off variants.

References: Ashraf et al. 2024 (castleCSF), Bowers, Gegenfurtner & Goettker 2025, Jiang, Shooner & Mullen 2022, Abramov, Gordon & Chan 1991, Mullen & Kingdom 2002.

---

## Congestion-Gated Pooling (Mode 9)

### What It Does

Modulates the strength of peripheral spatial pooling based on local feature congestion. High-congestion regions (cluttered UI, dense text grids, product listings) get up to 2× stronger MIP pooling, while low-congestion regions (hero images, whitespace, isolated elements) receive standard eccentricity-only pooling.

```glsl
// peripheral2.frag — congestion boost applied before DoG reconstruction
float congestionBoost = 1.0 + lgn.congestion * 1.0;  // 1.0× – 2.0×
coupledEccentricity *= congestionBoost;
```

### Biological Rationale

Rosenholtz et al. (2012) argue that peripheral vision computes summary statistics over local pooling regions, and that clutter is what happens when those statistics are ambiguous — too many features packed into a pooling region makes the summary unreliable. This mode tests that prediction: if congestion already tells us which regions will be hardest to parse peripherally, we should see *more* degradation there (matching the biological outcome) rather than treating a clean sidebar and a dense data table identically.

### How It Works

Mode 9 inherits the full Mode 0 pipeline (LGN gating, V1 distortion, DoG reconstruction, chromatic pooling) and adds one multiplier. On mode selection, the high-resolution congestion worker auto-starts and recomputes on scroll/navigation events. The congestion map (1024px, TEXTURE4) provides the per-pixel congestion value that scales `coupledEccentricity`.

| Congestion | Pool Boost | Effect |
|------------|-----------|--------|
| 0.0 (clean) | 1.0× | Standard eccentricity-only pooling |
| 0.5 (moderate) | 1.5× | Fine detail filters out slightly earlier |
| 1.0 (dense) | 2.0× | Double pooling — text clusters become indistinct blocks |

### Tagged: Experimental

This is a hypothesis mode. The 1.0× congestion multiplier and linear boost curve are initial guesses. The prediction is testable: show observers gated vs. ungated peripheral renderings alongside ground-truth peripheral photographs and ask which simulation looks more realistic. Standard perceptual evaluation methods (forced-choice preference, similarity rating, image quality metrics like SSIM against gaze-contingent captures) would all work. If congestion gating consistently wins, it's doing real work. If observers can't tell the difference, congestion may not contribute additional pooling beyond what eccentricity already provides.

---

## Saccadic Blindness

During a saccade (rapid eye movement), the visual system suppresses foveal processing — you don't perceive the blur of the world sweeping across your retina. Scrutinizer simulates this by shrinking the foveal and parafoveal regions proportionally to mouse velocity.

```glsl
float saccadeFactor = smoothstep(4.0, 10.0, u_velocity);  // px/ms
fovea_radius *= (1.0 - saccadeFactor);
parafovea_radius *= (1.0 - saccadeFactor);
```

At velocities below 4 px/ms (normal tracking), the fovea is full-size. Between 4-10 px/ms, the fovea shrinks linearly. Above 10 px/ms (fast flick), the fovea collapses to near-zero — the entire viewport renders as periphery.

**Menu path:** Simulation → Saccadic Blindness (checkbox, off by default)

The feature is disabled by default because mouse velocity is a noisy proxy for saccadic state. Real saccades are ballistic (200-500°/s, 30-80ms) with distinct kinematics. Mouse movement is continuous and user-controlled. The simulation is directionally correct but the velocity thresholds are tuned for visual effect, not biological fidelity. Future: integrate with eye tracker input via the GazeModel module, where saccade detection uses acceleration profiles rather than velocity thresholds.

---

## Crowding Diagnostics

### Reference Pages (scrutinizer-www)

Two new reference pages published to GitHub Pages for testing crowding behavior:

**`crowding.html`** — Crowded-vs-isolated letter identification at three font sizes (16/28/48px) and three eccentricities (3°/6°/10°). Each row places a flanked target V next to an identical isolated V. Four golden fixation points for capture. Click to randomize flanker letters. Inter-letter gap scales quadratically with font size; inter-group gap scales linearly.

**`crowding-stimulus.html`** — Stimulus-specific crowding conditions from Pelli & Tillman (2008) and Rosenholtz et al. (2012): orientation (same vs orthogonal Gabor flankers), color grouping (monochrome vs color-differentiated target), complexity (house SVG vs circle SVG).

### Simulation Limitations Document

`docs/simulation-limitations.md` documents five known gaps between Scrutinizer's peripheral rendering and biological peripheral vision:

1. **Crowding is not density-dependent** (High) — V1 Lateral Smash is purely eccentricity-dependent; isolated and flanked letters receive identical displacement
2. **Crowding is not stimulus-specific** (Medium) — no concept of target-flanker similarity
3. **No transsaccadic integration** (Medium) — continuously degraded periphery overestimates disruption
4. **Chromatic pooling incomplete** (Partially addressed — this release)
5. **MIP pooling approximations** (Accepted tradeoff)

### Density-Gated Crowding Spec

`docs/specs/density_gated_crowding.md` proposes feeding the structure map's density channel into V1 strength via a sigmoid transfer function. Dense content (text clusters) gets full Lateral Smash distortion; isolated elements get reduced distortion (floor at 0.3 for residual acuity loss). Includes three options for density signal strength for team review. Status: planned, deferred pending feedback.

---

## Saliency vs Congestion Split View

### What It Does

Side-by-side rendering of both heatmaps in the overlay window. Left half: saliency (cool indigo-to-white palette). Right half: congestion (blue-yellow-red). Labels identify each side with the question it answers.

**Menu path:** Simulation → Utility → Congestion Report → Saliency vs Congestion

### Why Both Maps

These are complementary signals, not redundant ones:

- **Saliency** (center-surround DoG): "What pops out?" — items that differ from their surroundings
- **Congestion** (local feature variance): "How cluttered?" — areas with high simultaneous variation in color, lightness, and edges

A page with a clean hero and a dense product grid illustrates the difference. The saliency map lights up the hero headline (high contrast against a clean background). The congestion map lights up the product grid (high local variance regardless of contrast). Seeing them side by side makes this immediately clear.

### Implementation

| Component | Change |
|-----------|--------|
| `peripheral2.frag` | New `show_congestion == 2` branch: split-screen with separate palettes and divider line |
| `scrutinizer.js` | Congestion mode 3 → shader uniform 2. DOM labels overlay with "SALIENCY / What pops out?" and "CONGESTION / How cluttered?" |
| `menu-template.js` | New radio item in Congestion Report submenu |
| `webgl-renderer.js` | `show_congestion` uniform range extended to 0–2 |

The ComplexityHUD stays visible alongside the split view, so you can read the numerical score while visually comparing spatial distribution.

---

## Mode 8 Removed

**Mode 8 (Gaussian Desaturation)** has been removed from the mode registry, shader pipeline, and menu. Three reasons:

1. **Superseded.** castleCSF per-channel chromatic pooling (this release) provides biologically grounded differential decay rates per chromatic channel per spatial frequency band. The Gaussian vs smoothstep comparison Mode 8 was designed for is no longer the relevant question.

2. **Broken implementation.** Mode 8's config was missing `chromatic_pooling: true`, causing it to fall through to the legacy desaturation path + Red Kill Switch simultaneously — triple desaturation stacking on saturated content. Color-spectrum captures showed garbled text and banding artifacts.

3. **Wrong functional form.** The Gaussian decay `exp(-r/σ)` assumes monotonic exponential RG falloff. Bowers, Gegenfurtner & Goettker (2025) showed RG attenuation is biphasic — steep decline to ~15° eccentricity, then a shallower tail. A single-parameter exponential cannot capture this shape.

Gaussian color decay (`u_fovi_color_sigma`) remains in Mode 6 (FOVI standalone) where it models a different effect — FOVI's own peripheral color decay, orthogonal to the Scrutinizer DoG pipeline.

---

## Identified Simulation Gaps

Two major gaps exposed and documented this cycle, both with specs and reference pages for validation:

1. **Size-dependent color preservation.** Chromatic pooling (this release) models per-channel, per-band decay rates — both RG and YV channels now have frequency-dependent attenuation, so large colored regions preserve hue further than small ones for both channels (Abramov et al. 1991). The DoG bands provide discrete spatial frequency buckets, not continuous perceptive-field scaling. Full perceptive-field integration (Bouma-scaled pooling regions) remains future work.

2. **Density-independent crowding.** The V1 Lateral Smash displaces pixels based on eccentricity alone — an isolated letter and a densely flanked letter at the same eccentricity receive identical distortion. In biological vision, the isolated letter remains identifiable (Bouma 1970). The structure map carries a density channel that could gate V1 strength, but it's unused. Spec: [`docs/specs/density_gated_crowding.md`](specs/density_gated_crowding.md). Reference pages: `crowding.html`, `crowding-stimulus.html`. See also: `docs/simulation-limitations.md`.

---

## What's Next

### Rendering Pipeline
- **Density-gated crowding** — Sigmoid density gate on V1 strength so dense content gets full Lateral Smash while isolated elements are spared. Spec written, pending team review on density signal approach. Spec: [`docs/specs/density_gated_crowding.md`](specs/density_gated_crowding.md)
- **Oriented DoG bands (Oblique Effect)** — Cardinal edges persist ~50% further than oblique ones. Spec: `docs/specs/oriented_dog_bands.md`

### scrutinizer-audit
- **HTML report template** — Lighthouse-style visual report with per-page score cards
- **Watch mode** — `--watch http://localhost:3000` re-runs on dev server reload
- **Historical tracking** — `--output scores.jsonl --append` for longitudinal score tracking
- **GitHub Action** — Run in PR checks, post score table as PR comment
- **Full-fidelity mode** — `--full-fidelity` flag driving the full Electron pipeline (peripheral rendering + saliency) for research-grade captures

---

## scrutinizer-audit — CLI + MCP Server

### What It Does

Crawls web pages with headless Chromium (Playwright), captures screenshots, and runs the exact same Feature Congestion + edge density pipeline as the ComplexityHUD. Returns a 0–100 composite score per page.

```bash
# Score a page
node cli/scrutinizer-audit.js https://apple.com
# → Score: 46 (Medium)

# Multi-page, multi-viewport
node cli/scrutinizer-audit.js https://apple.com https://persci.mit.edu --viewport desktop,mobile

# CI gate
node cli/scrutinizer-audit.js --sitemap https://example.com/sitemap.xml --fail-above 60
# → exit 1 if any page exceeds threshold
```

### Shared Scoring Foundation

The scoring formula, rating thresholds, and edge density computation were extracted from `congestion-worker.js` and `complexity-hud.js` into `congestion-core.js` as shared functions:

| Function | Source | Now In |
|----------|--------|--------|
| `computeEdgeDensity()` | `congestion-worker.js:147–169` | `congestion-core.js` |
| `computeCompositeScore()` | `complexity-hud.js:361` | `congestion-core.js` |
| `RATINGS` | `complexity-hud.js:16–21` | `congestion-core.js` |

The ComplexityHUD, congestion worker, `extract-congestion.js`, and the CLI all call the same functions. Scores match exactly.

### CLI Features

| Feature | Flag |
|---------|------|
| Positional URLs | `scrutinizer-audit https://a.com https://b.com` |
| Sitemap parsing | `--sitemap https://example.com/sitemap.xml` |
| URL list from file | `--file urls.txt` |
| Desktop + mobile viewports | `--viewport desktop,mobile` |
| Scroll positions | `--scroll above-fold,first-scroll` |
| JSON to stdout | `--json` |
| HTML report | `--output report.html` |
| Congestion heatmap PNGs | `--heatmaps` |
| Raw screenshots | `--screenshots` |
| CI threshold gate | `--fail-above 60` (exit 1 if exceeded) |
| Before/after comparison | `--compare before.json after.json` |
| Analysis resolution | `--max-dim 1024` (default) |

### MCP Server

Three tools exposed via stdio transport for Claude Code integration:

| Tool | Purpose |
|------|---------|
| `analyze_url` | Score a single page |
| `analyze_urls` | Batch scoring with summary stats |
| `compare_pages` | Side-by-side delta between two URLs |

### Reference Scores

Captured with `scrutinizer-audit`, desktop viewport (1440×900), above-fold:

| Page | Score | Rating | Congestion p90 | Edge p90 |
|------|-------|--------|----------------|----------|
| example.com (near-empty) | 0 | Low | 0.000 | 0.000 |
| wikipedia.org | 31 | Medium | 0.084 | 0.116 |
| persci.mit.edu/gallery | 38 | Medium | 0.173 | 0.070 |
| apple.com | 46 | Medium | 0.262 | 0.082 |
| persci.mit.edu | 53 | High | 0.252 | 0.359 |
| persci.mit.edu/people/rosenholtz | 53 | High | 0.274 | 0.305 |
| apple.com (mobile 390×844) | 54 | High | 0.311 | 0.238 |

Rosenholtz's own page at MIT's Perceptual Science Group scores 53. The gallery page fares better (38) because image grids have more uniform local neighborhoods than text-heavy layouts.

---

## Engineering Details

### `extract-congestion.js` Upgrade

The existing headless validation script now uses the shared `computeEdgeDensity()` and `computeCompositeScore()` from `congestion-core.js`. Output includes:

- Composite scores and ratings alongside raw congestion stats
- Edge density heatmap PNGs (in addition to congestion heatmaps)
- Updated JSON structure with nested `congestion` and `edgeDensity` objects

### Dependencies

#### cli/ (new package)

| Package | Version | Purpose |
|---------|---------|---------|
| `playwright` | ^1.50.0 | Headless Chromium |
| `@modelcontextprotocol/sdk` | ^1.12.1 | MCP stdio server |
| `pngjs` | ^7.0.0 | PNG decode (same as parent) |

No new dependencies in the main Electron app.

### Documentation

- **Developer Guide** (`docs/developers_guide.md`): New section covering scrutinizer-audit CLI reference, output schema, CI integration, MCP server setup, and extension points.
- **Congestion Brief** (`scrutinizer-www/src/blog/congestion-score.html`): Added "Scores in the Wild" table with live results, CLI & MCP section, and saliency vs congestion split-view description.
- **Chromatic Pooling Spec** (`docs/specs/implemented/chromatic_pooling.md`): Full spec with castleCSF parameters, per-band attenuation derivation, suprathreshold correction, and validation plan.
- **Simulation Limitations** (`docs/simulation-limitations.md`): Five known gaps between the renderer and biological peripheral vision, with reference pages and fix paths.
- **Density-Gated Crowding Spec** (`docs/specs/density_gated_crowding.md`): Sigmoid density gate proposal for V1 strength, with three options for density signal approach.

### Files Changed

| Area | Files |
|------|-------|
| **Shared Scoring** | `renderer/congestion-core.js` (+`computeEdgeDensity`, `computeCompositeScore`, `RATINGS`) |
| **CLI** | `cli/scrutinizer-audit.js`, `cli/lib/analyzer.js`, `cli/lib/crawler.js`, `cli/lib/reporter.js`, `cli/lib/sitemap-parser.js`, `cli/lib/url-resolver.js`, `cli/lib/viewport-profiles.js`, `cli/lib/scroll-strategy.js`, `cli/package.json` |
| **MCP Server** | `cli/mcp/server.js` |
| **Split View** | `renderer/shaders/peripheral2.frag`, `renderer/scrutinizer.js`, `renderer/webgl-renderer.js`, `menu-template.js` |
| **Chromatic Pooling** | `renderer/shaders/peripheral2.frag` (+`chromaticAttenuate`, per-band RG/YV decay, decoupled `visual_ecc` for chromatic eccentricity), `renderer/webgl-renderer.js` (6 uniforms), `shared/modes.json`, `menu-template.js`, `main.js`, `renderer/scrutinizer.js`, `renderer/overlay.js` |
| **Saccadic Blindness** | `renderer/shaders/peripheral2.frag` (+`u_saccadic_blindness`, fovea shrink), `renderer/shaders/peripheral.frag` (same), `renderer/webgl-renderer.js` (uniform), `renderer/scrutinizer.js` (+`toggleSaccadicBlindness`), `renderer/overlay.js` (IPC handler), `menu-template.js` (checkbox) |
| **Crowding Diagnostics** | `scripts/capture-golden.js` (crowding capture tasks), `menu-template.js` (reference page menu items), `docs/simulation-limitations.md`, `docs/specs/density_gated_crowding.md` |
| **Reference Pages** | `scrutinizer-www/src/reference-pages/crowding.html`, `scrutinizer-www/src/reference-pages/crowding-stimulus.html` |
| **Validation** | `scripts/extract-congestion.js` (updated to use shared edge density + composite score), `scripts/capture-golden.js` (chromatic pooling on/off variants) |
| **Documentation** | `docs/developers_guide.md`, `docs/specs/implemented/chromatic_pooling.md`, `docs/release_notes_v1.9.0.md` |
