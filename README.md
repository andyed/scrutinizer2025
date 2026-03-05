# <img src="renderer/assets/scrutinizer_128x128_icon.png" width="48" height="48" align="middle"> Scrutinizer — Foveated Vision Simulator

[![Electron](https://img.shields.io/badge/Electron-28.0-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![WebGL](https://img.shields.io/badge/WebGL-2.0-990000?style=flat-square&logo=webgl&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

Live site: **[scrutinizer.app](https://andyed.github.io/scrutinizer-www/)** | [Blog](https://andyed.github.io/scrutinizer-www/blog/) | [YouTube](https://www.youtube.com/@scrutinizer-app/playlists)

macOS Installer: **[Download v1.8.0](https://github.com/andyed/scrutinizer2025/releases/tag/v1.8.0)** | [Changelog](CHANGELOG.md)

---

## What Scrutinizer Does

Scrutinizer simulates the information constraints imposed by retinal and early cortical processing — the spatial pooling, chromatic filtering, and resolution falloff that shape what you actually perceive before the brain reconstructs a coherent scene. It renders any web page through a model of eccentricity-dependent degradation bound to the mouse cursor, revealing the visual hierarchy that exists in a glance rather than in a screenshot.

Foveated rendering is a well-established technique in VR and game engines, where the goal is performance: degrade what the user won't notice to save GPU cycles. Scrutinizer inverts that goal. The degradation is the point — it represents the information the visual system actually has access to when navigating an interface. The question isn't "where can we cut corners?" but "what does the brain have to work with before the first saccade lands?"

Every saccade is a micro-economic decision: commit the fovea to this target, forgo everything else for ~200ms. That makes foveal allocation the most constrained resource in the attention economy — and the one designers have the least visibility into. Information foraging theory (Pirolli & Card, 1999) models users as optimal foragers navigating information patches; Scrutinizer makes the cost structure of each fixation visible, showing what the periphery can and cannot evaluate before the eyes move.

> [!TIP]
> **For usability practitioners:** Scrutinizer works as a [Restricted Focus Viewer](https://pubmed.ncbi.nlm.nih.gov/12078741/) — a tool for evaluating peripheral discoverability, color reliance, and layout hierarchy without eye tracking hardware. Point your mouse where a user would fixate and ask: can the periphery guide the next saccade?

The simulation is grounded in vision science: cortical magnification functions, contrast sensitivity models, and feature congestion scoring. It serves designers studying visual hierarchy, researchers conducting attention studies with mouse-contingent viewing (see [Restricted Focus Viewer](https://pubmed.ncbi.nlm.nih.gov/12078741/) lineage), and vision scientists validating peripheral models against rendered output.

![Progressive Grid](screenshots/onedotone_progressive_grid.png)

*Fourteen fixation steps from far periphery to fovea. Spatial pooling narrows, chromatic detail returns, and semantic content resolves — the mechanics of a single glance.*

---

## An Experiment in AI-Assisted Vision Science

Scrutinizer is built with AI coding tools (primarily Claude Code and Gemini) as research partners. AI accelerates literature synthesis and drafts implementations; the human evaluates whether the result is scientifically defensible. So far the approach is working — the chromatic pooling model, for example, required synthesizing castleCSF threshold data (Ashraf & Mantiuk 2024), suprathreshold appearance corrections (Jiang, Shooner & Mullen 2022), and per-band decay curves across domains no single paper covers. Key papers and conversation threads are captured in a research log for auditability.

The `.claude/` directory is committed to the repository. A [vision-scientist agent](.claude/agent-memory/vision-scientist/) carries persistent memory of review findings, parameter derivations, and open questions across sessions. A [release skill](.claude/skills/release/) automates the build-sign-notarize-ship pipeline.

---

## Model Architecture

Scrutinizer's rendering pipeline maps biological mechanisms to GPU-accelerated shader stages. Each stage has a defined scientific reference and a known gap between the model and the biology.

```
  Page Capture (BrowserView → texture)
       │
       ▼
  ┌─────────────────────────────────────────────┐
  │  Spatial Decomposition                      │
  │  DoG band decomposition via MIP chain       │
  │  Ref: Rovamo & Virsu (1979) M-scaling       │
  └────────────────┬────────────────────────────┘
                   │
       ▼                       ▼
  ┌──────────────────┐  ┌──────────────────────┐
  │  Cortical         │  │  Chromatic            │
  │  Magnification    │  │  Attenuation          │
  │  FOVI CMF         │  │  Per-channel RG/YV    │
  │  Schwartz 1980,   │  │  frequency-dependent  │
  │  Blauch+ 2026     │  │  decay (castleCSF)    │
  └────────┬─────────┘  └────────┬─────────────┘
           │                     │
           └──────────┬──────────┘
                      ▼
  ┌─────────────────────────────────────────────┐
  │  Feature Congestion Scoring                 │
  │  Oklab local variance, edge density         │
  │  Ref: Rosenholtz, Li & Nakano (2007)        │
  └────────────────┬────────────────────────────┘
                   │
                   ▼
  ┌─────────────────────────────────────────────┐
  │  Calibration Layer                          │
  │  Motion Silence staircase                   │
  │  Ref: Suchow & Alvarez (2011)              │
  └─────────────────────────────────────────────┘
```

**Spatial decomposition.** The hardware [MIP chain](https://andyed.github.io/scrutinizer-www/blog/mip-chain-explainer.html) provides progressive spatial pooling at each eccentricity band. MIP levels are selected per-fragment based on cortical magnification, approximating the growth of receptive field size with distance from fixation. Band cutoff frequencies follow Rovamo & Virsu's linear M-scaling.

**Cortical magnification.** Scrutinizer has modeled eccentricity-dependent falloff since v1.0 — the concept is foundational. The v1.6 implementation used a hand-tuned smoothstep that approximated the right shape but lacked analytical grounding. Comparing our curves against the [FOVI model](https://andyed.github.io/scrutinizer-www/blog/2026-02-28-fovi.html) (Blauch, Konkle & Alvarez, 2026) gave us the clean parameterization we were already targeting: *w = k · log(e + e₂)* (Schwartz 1980) with empirically fitted constants. The comparison also exposed a bug in our eccentricity mapping. The v1.7 pipeline adopts the same Schwartz parameterization used by FOVI, calibrated against their published constants.

**Chromatic attenuation.** Peripheral color is chromatically filtered, not lost — cone signals are pooled over widening regions, reducing chromatic contrast at spatial frequencies the periphery cannot resolve. The model derives [RG and YV channel decay rates](https://andyed.github.io/scrutinizer-www/blog/2026-02-28-fovi.html) from castleCSF threshold data with suprathreshold appearance correction.

**Feature Congestion.** A real-time implementation of Rosenholtz, Li & Nakano's (2007) visual clutter metric, computed in Oklab color space. Local variance (σ=2.5) across color, orientation, and luminance contrast channels produces a [0–100 complexity score](https://andyed.github.io/scrutinizer-www/blog/congestion-score.html). Validated against the Python reference implementation (Spearman ρ=0.93). See [congestion-journey.md](docs/congestion-journey.md).

**Calibration.** A Motion Silence staircase (Suchow & Alvarez, 2011) measures the eccentricity at which the user detects peripheral motion, establishing a perceptual anchor for the simulation parameters. See [Foveal Calibration Logic](docs/foveal-calibration-logic.md).

---

## Features

### Rendering Pipeline (v1.8)
- **Foveal/peripheral simulation** — eccentricity-dependent spatial pooling and chromatic filtering bound to cursor position
- **[Analytical cortical magnification](https://andyed.github.io/scrutinizer-www/blog/2026-02-28-fovi.html)** — eccentricity falloff using the Schwartz (1980) log-mapping parameterization (mode 6), alongside legacy (mode 7) and Gaussian desaturation (mode 8) for comparison
- **[Feature Congestion](https://andyed.github.io/scrutinizer-www/blog/congestion-score.html) pipeline** — real-time visual clutter scoring with ComplexityHUD overlay (Score / Stats / Spatial tabs)
- **Congestion-gated pooling** (mode 9) — peripheral attenuation weighted by local visual complexity
- **Saliency modulation** — allocates more peripheral bandwidth to salient regions (edges, contrast, high-importance areas)
- **Structure map analysis** — layout detection (text rhythm, density, semantic type) feeding the rendering pipeline
- **Visual memory simulation** — iconic memory decay across 5 modes (Off, Limited, Extended, Infinite, Fixation Buffer)

### Tools
- **Foveal Calibrator** — [online tool](https://andyed.github.io/scrutinizer-www/foveal-calibration.html) measuring perceptual foveal spread via Motion Silence psychophysics
- **scrutinizer-audit CLI** — headless Playwright-based site auditor: Feature Congestion scoring, batch URL evaluation, sitemap crawling, CI gating (`--fail-above N`), heatmap export
- **MCP server** — AI-assisted design review via `analyze_url`, `analyze_urls`, `compare_pages` tools for Claude Code integration
- **Golden capture pipeline** — automated screenshot capture and SSIM/PSNR regression testing across versions

### Interface
- **Extensibility modes** — modular shader pipeline supports custom visual effects (Frosted Glass, Wireframe, Cyberpunk, Double Vision are included as test cases; see [Developer's Guide](docs/developers_guide.md))
- **Simulation menu** — organized into Behavior (cognitive), Foveal (spatial), Peripheral (rendering), and Utility (debug) groups
- **Eccentricity overlay** — boundary ring visualization for foveal/parafoveal/peripheral zones

### Platform
- **macOS**: Signed and notarized (v1.3+), Apple Silicon native
- **Figma plugin**: [Scrutinizer Pro](https://www.figma.com/community/plugin/1579671593390938191/scrutinizer-pro) — free with watermark, uses Figma DOM for prototype support

---

## Validation & Reproducibility

Scrutinizer maintains a validation infrastructure to catch regressions and cross-check against reference implementations.

**Golden captures.** Automated screenshots at fixed viewport/URL/mode combinations, compared across versions using SSIM (≥0.98) and PSNR (≥35 dB) thresholds. The capture pipeline runs headlessly and produces paired comparison images stored in [`docs/golden/`](docs/golden/).

```bash
npm run capture-golden          # Generate reference captures
npm run golden-compare          # Compare current output against references
```

**[Feature Congestion](https://andyed.github.io/scrutinizer-www/blog/congestion-score.html) validation.** The JavaScript implementation is cross-validated against the Python reference (Rosenholtz lab toolbox) on matched test images. Spearman rank correlation ρ=0.93. Both pipelines can be run:

```bash
npm run validate:python         # Run Python reference (requires uv + Python 3.12)
npm run validate:scrutinizer    # Run Scrutinizer's JS implementation
```

**Attenuation table.** Per-eccentricity-band attenuation values are logged and compared against the FOVI-derived cortical magnification curve to verify the MIP-level selection produces the expected spatial frequency cutoffs.

**Methodology note.** Following the cross-validation approach advocated by Bowers et al. (2025), each pipeline stage is tested against its reference independently before integration. The simulation does not claim biological accuracy — it claims fidelity to the cited models, which are themselves approximations.

---

## Calibration

**The problem.** The simulation uses a hardcoded `fovea_deg = 2.0` that maps screen pixels to visual angle with a fixed ratio. On most displays at typical viewing distances, this underestimates actual eccentricity — viewport edges reach ~8–10° instead of the ~19–22° they subtend in practice. The result: peripheral attenuation is weaker than it should be.

**Our tool.** The [Foveal Calibrator](https://andyed.github.io/scrutinizer-www/foveal-calibration.html) uses a Motion Silence staircase (Suchow & Alvarez, 2011) to measure perceived foveal extent. This gives a perceptually anchored radius but doesn't yet separate pixels-per-degree from comfort radius.

**The planned fix.** Split `foveaRadius` (comfort setting) from `px_per_deg` (calibration output). The calibrated value drives eccentricity computation in the shader; the comfort value controls the unfiltered foveal region. See [ROADMAP](ROADMAP.md) and [Project 1.3](docs/grad-student-projects.md).

**Reference viewing distances:**

| Display | Resolution | Typical Distance | Visual Angle (horizontal) |
|---------|-----------|------------------|--------------------------|
| MacBook Pro 14" | 3024×1964 | 45–55 cm | ~33° |
| MacBook Pro 16" | 3456×2234 | 50–60 cm | ~35° |
| Desktop 24" 1080p | 1920×1080 | 55–70 cm | ~33° |
| Desktop 27" 4K | 3840×2160 | 60–80 cm | ~35° |

Related: [Li et al. (2020) Virtual Chinrest](https://doi.org/10.3758/s13428-019-01314-3), [MediaPipe Iris](https://ai.googleblog.com/2020/08/mediapipe-iris-real-time-iris-tracking.html), [WebGazer.js](https://webgazer.cs.brown.edu/)

---

## Research Opportunities

Scrutinizer's modular architecture and open specs make it a platform for graduate-level research projects. Seventeen projects are specified in [**grad-student-projects.md**](docs/grad-student-projects.md), organized by discipline:

| Category | Projects | Example |
|----------|----------|---------|
| **Vision Science** | 1.1–1.5 | Oriented DoG band decomposition, calibrated visual angles, congestion-gated evaluation |
| **HCI / UX** | 2.1–2.4 | Fixation recording and heatmap comparison, cognitive load inference from scan patterns |
| **Design Tools** | 3.1–3.6 | Eye tracker integration, AI-assisted design review via MCP, web-scale clutter census |
| **Technical Systems** | 4.1–4.2 | Saliency framework comparison, OffscreenCanvas worker renderer |

Each project specifies effort level, novelty, IRB requirements, and learning path.

**Five open specs** that define the next layer of biological fidelity:

1. **Oriented DoG bands** (Project 1.1) — replace isotropic MIP pooling with orientation-selective decomposition
2. **Texture synthesis** (Project 1.2) — Portilla-Simoncelli statistics or neural synthesis in spatial pooling regions
3. **Calibrated visual angles** (Project 1.3) — `px_per_deg` separation from `foveaRadius`
4. **Saccadic dynamics** (Project 1.4) — fixation-triggered suppression and transsaccadic integration
5. **Eye tracker integration** (Project 3.3) — gaze-contingent rendering via Tobii/Pupil Labs

Contributions welcome. See the [Developer's Guide](docs/developers_guide.md) for architecture and extension patterns.

---

## Known Limitations

These are research questions, not apologies. Each gap represents a measurable distance between the current model and the biology.

1. **Calibration gap.** Hardcoded pixels-per-degree produces under-attenuated periphery on most displays. The viewport edges render at ~10° eccentricity when they should be ~20°. Simulation results are qualitatively correct but quantitatively compressed. *Fix path: [Project 1.3](docs/grad-student-projects.md) — px_per_deg/foveaRadius separation.*

2. **Approximate spatial pooling.** The [MIP chain](https://andyed.github.io/scrutinizer-www/blog/mip-chain-explainer.html) provides box/bilinear averaging, not Gaussian pooling. No texture synthesis is performed — pooling regions lose feature statistics rather than preserving summary statistics as the Texture Tiling Model predicts. Peripheral representations are therefore more degraded than biological peripheral vision. *Fix path: [Project 1.2](docs/grad-student-projects.md) — Portilla-Simoncelli or neural texture synthesis.*

3. **Sequential chromatic-spatial pipeline.** MIP averaging dilutes chroma before the chromatic attenuation stage applies per-channel decay. The biological system processes spatial and chromatic channels in parallel (parvocellular vs. magnocellular pathways). The result: chromatic contrast in mid-periphery may be more attenuated than predicted. *Fix path: dual-pathway architecture spec in [ROADMAP](ROADMAP.md).*

4. **No transsaccadic integration.** There is no model of how the brain accumulates information across fixations. The [Visual Memory modes](docs/simulation-limitations.md) (Limited, Extended, Fixation Buffer) approximate accumulation by preserving previously foveated regions, but this is a display-level effect — it retains rendered pixels, not the summary statistics or object representations that transsaccadic memory actually maintains. *See: [simulation-limitations.md](docs/simulation-limitations.md).*

5. **Mouse-contingent, not gaze-contingent.** Cursor-tracking latency is ~200ms vs. ~10ms for research-grade eye trackers. Mouse position approximates but does not replicate gaze fixation — users learn to "park" the cursor differently than they fixate. *Fix path: [Project 3.3](docs/grad-student-projects.md) — Tobii/Pupil Labs integration.*

For a detailed catalog of all known gaps, see [simulation-limitations.md](docs/simulation-limitations.md).

---

## Installation

### Download (v1.8.0)

> Scrutinizer for macOS is **Signed & Notarized** — no security warnings.

*   **macOS (Apple Silicon):** [**Download Scrutinizer-1.8.0.dmg**](https://github.com/andyed/scrutinizer2025/releases/tag/v1.8.0)
*   **Windows:** Manual build required (see [Releases Page](https://github.com/andyed/scrutinizer2025/releases))

[**View All Releases & Changelogs**](https://github.com/andyed/scrutinizer2025/releases)

<details>
<summary><strong>Troubleshooting macOS Warnings (Manual/Unsigned Builds Only)</strong></summary>

> The official release v1.3.0+ is signed and notarized. These steps only apply to source builds or older versions.

1.  Right-click `Scrutinizer.app` → **Open**.
2.  Click **Open** when warned about the unidentified developer.
3.  If blocked, go to **System Settings → Privacy & Security** and click **Open Anyway**.
4.  Advanced: `xattr -dr com.apple.quarantine /Applications/Scrutinizer.app`.
</details>

<details>
<summary><strong>Troubleshooting Windows SmartScreen</strong></summary>

1.  Run the installer.
2.  If SmartScreen appears, click **More info** → **Run anyway**.
</details>

### Developer Setup

```bash
npm install
npm start                       # Development mode
npm run build                   # Signed DMG (macOS)
npm test                        # Run test suite
```

### CLI Setup

```bash
# scrutinizer-audit — headless visual complexity auditor
node cli/scrutinizer-audit.js https://example.com
node cli/scrutinizer-audit.js --sitemap https://example.com/sitemap.xml --fail-above 70

# MCP server — AI-assisted design review
claude mcp add scrutinizer-audit -- node cli/mcp/server.js
```

---

## Usage & Controls

### Basic Navigation
1. **Navigate** — use the toolbar URL bar to enter URLs or search terms
2. **Toggle simulation** — click the eye icon, press `Cmd+Shift+F`, or use Simulation → Foveal → Toggle
3. **Adjust radius** — Left/Right arrow keys, or use Simulation → Foveal → Radius
4. **Calibrate** — use the [Foveal Calibrator](https://andyed.github.io/scrutinizer-www/foveal-calibration.html) to measure your actual foveal spread

### Menu Structure

| Menu Group | Contents |
|------------|----------|
| **Behavior** | Visual Memory (5 modes), Structure Map, Saliency Modulation |
| **Foveal** | Toggle, Radius (6 sizes), Shape (4 aspect ratios) |
| **Peripheral** | Intensity (5 levels), Effect Type, Chromatic Aberration |
| **Utility** | Rendering modes, Structure Map view, Saliency Map view, Eccentricity Overlay |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Cmd+Shift+F` | Toggle foveal simulation |
| `Right Arrow` | Increase foveal radius |
| `Left Arrow` | Decrease foveal radius |
| `Cmd+L` | Focus URL bar |

---

## Scientific Foundation

### Key Citations

| Reference | What It Grounds |
|-----------|----------------|
| Rosenholtz, Huang, Raj, Balas & Ilie (2012) JOV | Texture Tiling Model — peripheral vision as summary statistics pooled over growing regions |
| Schwartz (1980) Vision Research | Cortical magnification: *w = log(z + a)*, the conformal mapping from retina to V1 |
| Blauch, Konkle & Alvarez (2026) arXiv | FOVI — parameterized cortical magnification function for foveated vision models |
| Rovamo & Virsu (1979) Exp Brain Res | Linear M-scaling: spatial frequency cutoffs scale with inverse magnification factor |
| Ashraf, Mantiuk et al. (2024) castleCSF | RG/YV chromatic contrast sensitivity threshold parameters |
| Jiang, Shooner & Mullen (2022) JOV | Suprathreshold chromatic appearance: peripheral color doesn't vanish at threshold |
| Rosenholtz, Li & Nakano (2007) JOV | Feature Congestion — visual clutter metric from color, orientation, luminance contrast |
| Curcio, Sloan, Kalina & Hendrickson (1990) J Comp Neurol | Retinal photoreceptor topography: cone/rod density distributions grounding eccentricity models |

### Documentation

- [Biological Model](docs/foveated-vision-model.md) — receptor-to-cortex narrative, shader stage mapping
- [Scientific Literature Review](docs/scientific_literature_review.md) — full research foundations
- [Feature Congestion Journey](docs/congestion-journey.md) — implementation and validation log
- [How GPU MIP Chains Simulate Peripheral Vision](https://andyed.github.io/scrutinizer-www/blog/mip-chain-explainer.html) — blog post explaining the spatial decomposition pipeline
- [FOVI & Cortical Magnification](https://andyed.github.io/scrutinizer-www/blog/2026-02-28-fovi.html) — blog post on the v1.7 CMF integration and chromatic attenuation
- [Feature Congestion Scoring](https://andyed.github.io/scrutinizer-www/blog/congestion-score.html) — blog post on the clutter metric
- [v1.8: Scientific Accuracy Audit](https://andyed.github.io/scrutinizer-www/blog/2026-03-03-v1.8.html) — blog post on M-scaling corrections and Feature Congestion launch
- [Foveal Calibration Logic](docs/foveal-calibration-logic.md) — psychophysics of the calibration tool
- [Simulation Limitations](docs/simulation-limitations.md) — detailed gap analysis
- [Developer's Guide](docs/developers_guide.md) — architecture, extension patterns, adding custom modes

---

## License

Copyright (c) 2012–2026, Andy Edmonds. All rights reserved.
Licensed under the [MIT License](LICENSE).
