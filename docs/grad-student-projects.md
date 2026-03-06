# Grad Student Project Backlog

Potential thesis/capstone projects for graduate students in HCI, Vision Science, UX Research, or Design. Each project builds on Scrutinizer's existing infrastructure — a real-time, gaze-contingent foveated rendering system running in Electron/WebGL2.

The modular pipeline (GazeModel, VisualMemory, ContentAnalysis, pipeline orchestrator) means each module can be independently swapped, extended, or instrumented without touching the rest. As of v1.8, the system includes:
- **Dual-worker content analysis**: Saliency worker (256 px, continuous ~4 Hz) + Congestion worker (1024 px, on-demand) running in Web Workers
- **Feature Congestion scoring**: Rosenholtz et al. (2007) with fixed σ=2.5, validated at Spearman ρ=0.93 against the MIT reference implementation
- **Congestion-gated pooling**: Rendering mode where high-congestion regions receive more aggressive peripheral simplification
- **Visual Memory with Inhibition of Return**: Fixation-history masking with configurable decay
- **8 aesthetic modes** with granular pipeline configuration (LGN gating → V1 distortion → V4 rendering)
- **`scrutinizer-audit` CLI**: Headless Playwright-based batch scoring with sitemap support, CI gating (`--fail-above`), and before/after comparison
- **MCP server**: Exposes `analyze_url`, `analyze_urls`, `compare_pages` tools for AI-assisted design review via Model Context Protocol
- **Scanpath replay** (spec: `docs/scanpath-replay-spec.md`): Common `ScanpathData` format with importers for 5 published eye-tracking datasets (UEyes, RecGaze, MIT1003, FixaTons, OneStop), `ScanpathPlayer` as a drop-in `GazeModel` replacement with minimum-jerk saccade interpolation, CLI replay with video recording, and 4 validation experiments

**IRB/Ethics note**: Projects marked with 👁 in the selection guide involve human participants and require IRB/ethics board approval before data collection. At most institutions this takes 1–3 months and is a hard prerequisite — factor it into semester timelines. Projects 2.2 and 2.3 involving remote participants (MTurk) may need separate protocol review.

**Shared instrumentation prerequisite**: Projects 2.1, 2.2, and 2.3 all require behavioral recording and GazeModel instrumentation. The **Scanpath Replay** infrastructure (`docs/scanpath-replay-spec.md`) provides this: `ScanpathData` format with fixation timing, `ScanpathPlayer` as a drop-in GazeModel replacement, coordinate normalization utilities, and CLI replay with video recording. Treat Phase 1–2 of the scanpath spec (common format + ScanpathPlayer) as the foundational sprint, similar to how 1.3 is foundational for vision-science projects.

**References caveat**: The reference lists in this document were AI-generated and skew toward canonical, highly-cited papers. They lack recent work (2020–2025) that may have partially addressed these research questions, and contain no methodological references for proposed psychophysical experiments. A supervising PI should validate references against current literature before a student begins work.

---

## 1. Vision Science & Perception

### 1.1 Oriented DoG Bands (Oblique Effect)

**Discipline**: Vision Science, Computational Neuroscience
**Effort**: Medium | **Novelty**: Medium-High
**Spec exists**: `docs/specs/oriented_dog_bands.md`
**Depends on**: 1.3 (Calibrated Visual Angles) for publishable psychophysical results

The current DoG band decomposition is isotropic — all edge orientations attenuate equally with eccentricity. Real V1 cells are orientation-selective, and humans show ~30–50% better acuity for cardinal (horizontal/vertical) edges than oblique ones (Appelle, 1972). This project adds a 4-tap gradient analysis to modulate per-band M-scaling cutoffs by local edge orientation. Horizontal text strokes would persist ~50% further into the periphery than diagonal noise.

**Research question**: Does orientation-selective band filtering improve peripheral text legibility prediction compared to isotropic DoG?

**Deliverables**:
- Shader extension: 4 texture lookups for local gradient, orientation-dependent M-scaling
- Performance characterization (<0.5ms budget on integrated GPU)
- Psychophysical validation: Measure peripheral letter identification with/without oblique effect (separate semester — stimulus design, piloting, IRB, participant running, and analysis are substantial on their own)

**Key references**: Appelle (1972), Campbell & Robson (1968), Hubel & Wiesel (1962)

---

### 1.2 Mongrel Texture Synthesis for Peripheral Crowding

**Discipline**: Vision Science, Computer Graphics
**Effort**: Very High | **Novelty**: High
**ROADMAP section**: Priority 2 — Mongrel Texture Synthesis

Replace blur-based peripheral rendering with texture synthesis that preserves summary statistics (mean color, orientation distribution, spatial frequency content) while destroying feature identity. This is the "gold standard" for simulating crowding (Rosenholtz et al., 2012) but has never been done in real-time for arbitrary web content.

**Research question**: Can a Portilla-Simoncelli-inspired summary statistic renderer run at 60fps on consumer GPUs for web content?

**Phased approach**:
1. Simple feature scrambling within blocks (shader-only, ~2 weeks)
2. Summary statistics matching per pooling region (~1 semester)
3. Neural texture synthesis via gram matrix matching (~thesis-scale)

**Deliverables**:
- Real-time mongrel renderer (Phase 1 minimum)
- Perceptual comparison: blur vs. mongrel vs. human crowding data
- Publication target: SIGGRAPH, JOV, or ETRA

**Key references**: Rosenholtz et al. (2012), Portilla & Simoncelli (2000), Fridman et al. (2017) FGN, Shumikhin (2020) pix2pixHD

---

### 1.3 Calibrated Visual Angle Pipeline

**Discipline**: Vision Science, HCI
**Effort**: Low-Medium | **Novelty**: Low (but a hard prerequisite for all vision-science projects — without it, results are in arbitrary pixel units that can't be compared to published psychophysical data)
**ROADMAP section**: Priority 2 — Calibrated Visual Angles

Scrutinizer currently works in pixel units. Real peripheral vision research requires degree-based visual angles calibrated to the user's monitor size and viewing distance. The foveal calibration tool already exists — this project connects it to a pixels-per-degree conversion that propagates through all zone boundaries, DoG cutoffs, and crowding parameters.

**Research question**: How much do uncalibrated pixel-based boundaries deviate from true visual angle boundaries across common monitor/distance configurations?

**Deliverables**:
- Calibration pipeline: foveal measurement → px/degree → degree-based zone boundaries
- Validation against known visual angle displays (e.g., EasyEyes Remote Calibrator)
- Multi-monitor support (different DPI/size per screen)
- Error analysis: sensitivity to viewing distance drift

**Key references**: EasyEyes Remote Calibrator, Curcio et al. (1990)

---

### 1.4 Saccadic Dynamics (Beyond IoR)

**Discipline**: Vision Science, Cognitive Science
**Effort**: Medium | **Novelty**: Medium

**Status**: IoR is now implemented in VisualMemory (v1.7+) as a fixation-history mask with configurable decay — recently fixated regions are suppressed. The remaining work is saccadic dynamics proper.

The current GazeModel tracks velocity and detects fixations, but doesn't model saccadic dynamics beyond simple suppression. This project adds biologically plausible saccade generation: corrective saccades, express saccades, and microsaccadic drift during fixations.

**Note**: The **ScanpathPlayer** (`docs/scanpath-replay-spec.md`) already implements minimum-jerk saccade interpolation (Flash & Hogan 1985) and main sequence duration estimation (Bahill et al. 1975) for replaying published datasets. This project extends that foundation with *generative* saccade models — corrective saccades, express saccades, microsaccadic drift — that produce biologically plausible behavior rather than replaying recorded data. The ScanpathPlayer's velocity reporting and saccadic state detection provide the baseline against which generative models are compared.

**Research question**: Does biologically plausible saccade modeling (corrective saccades, microsaccadic drift) combined with the existing IoR change user scanning patterns on information-dense pages?

**Deliverables**:
- Extended GazeModel with corrective saccade generation for near-target fixation refinement
- Microsaccadic drift during fixation (subtle jitter that refreshes visual processing)
- Express saccade pathway for high-salience targets
- Behavioral study: compare scanning efficiency across saccade model fidelity levels (requires IRB approval)
- Validation: replay published scanpaths (UEyes, MIT1003) through generative model and compare trajectory statistics against recorded data
- GazeModel is independently swappable — drop-in replacement

**Key references**: Rayner (1998), Klein (2000) IOR review, Bahill et al. (1975) main sequence, Flash & Hogan (1985) minimum-jerk

---

### 1.5 Congestion-Modulated Peripheral Rendering Evaluation

**Discipline**: Vision Science, HCI
**Effort**: Medium | **Novelty**: High
**Depends on**: IRB approval required

Scrutinizer v1.8 ships a congestion-gated pooling mode where high-congestion regions receive more aggressive peripheral simplification — matching the biological observation that cluttered regions are already pooled by peripheral vision. But does spatially-varying rendering actually change user behavior compared to uniform rendering? This is an A/B study using the existing infrastructure; no new engineering is needed.

**Scanpath replay integration**: Validation Experiment C in the scanpath replay spec (`docs/scanpath-replay-spec.md`) provides automated perceptual metrics (SSIM in high-congestion vs. low-congestion regions) that can serve as pilot data before running the behavioral study. Run Experiment C first to confirm that the rendering difference is perceptually meaningful, then use those results to power-analyze the human study. The scanpath replay CLI can also generate side-by-side video comparisons (congestion-gated vs. highkey mode replaying UEyes scanpaths) for study materials and presentations.

**Research question**: Does congestion-modulated peripheral rendering improve information foraging efficiency (fewer fixations, shorter scan paths) on heterogeneous pages compared to uniform peripheral rendering?

**Deliverables**:
- Automated perceptual comparison (Experiment C from scanpath spec) as pilot validation
- Experiment design: N participants × M pages (spanning low-to-high congestion) × 2 conditions (uniform vs. congestion-gated)
- Pre-score all stimulus pages with `scrutinizer-audit` to select pages spanning the congestion range
- Behavioral measures: fixation count, scan path length, task completion time, revisitation rate
- Analysis: does the congestion-gated condition help more on high-congestion pages? Is there a threshold?
- Design guideline: when congestion-gated rendering helps vs. when uniform rendering is sufficient

**Key references**: Rosenholtz et al. (2007, 2012), Pirolli & Card (1999) Information Foraging

---

## 2. HCI & UX Research

### 2.1 Fixation Recording & Attention Flow Visualization

**Discipline**: HCI, UX Research
**Effort**: High (thesis-scale — see scoping note) | **Novelty**: Medium-High
**ROADMAP section**: Priority 6 — Fixation Recording & Visualization

Build a recording system that captures the sequence of fixations and generates visual artifacts showing how the page appeared at each fixation point. Multi-zone capture strategy: fovea at full resolution, parafovea at 75%, near periphery at 50%, with zone reuse for close fixations.

**Scanpath replay integration**: The scanpath replay infrastructure (`docs/scanpath-replay-spec.md`) provides the recording format (`ScanpathData`), coordinate normalization, and CLI video recording (`scrutinizer-audit replay --video`). This project builds *on top of* that foundation: the recording system writes `ScanpathData` (same format used by UEyes/MIT1003 importers), and the CLI video recorder handles the animated export. The remaining work is the interactive HTML scrubber, multi-zone capture strategy, and the comparison study.

**Scoping note**: With the scanpath replay foundation in place, the recording system and animated export are substantially de-risked. A realistic single-semester scope is the multi-zone capture + interactive HTML scrubber. The comparison study is a separate semester or thesis chapter.

**Research question**: Can fixation sequence recordings with peripheral context replace or supplement eye-tracking for remote UX evaluation?

**Deliverables**:
- Recording system writing `ScanpathData` format (start/stop, `.scrutinizer` archive)
- Multi-zone capture at fixation points (fovea full-res, parafovea 75%, near periphery 50%)
- Interactive HTML export with scrubber and saccade path overlay
- Animated export via `scrutinizer-audit replay --video` (uses existing CLI)
- Comparison study: Scrutinizer recordings vs. Tobii eye-tracking for the same pages

**Output formats** (phased):
1. Interactive HTML with fixation scrubber
2. Animated GIF/WebM with temporal playback
3. Layered PSD with numbered saccade path

**Key references**: Kim et al. (2017) BubbleView, Lagun & Agichtein (2011) ViewSer

---

### 2.2 Crowdsourced Peripheral Attention Maps (BubbleView Extension)

**Discipline**: HCI, UX Research
**Effort**: Medium | **Novelty**: Medium
**Depends on**: Shared instrumentation layer (see top-level note); IRB approval required; MTurk studies may need separate protocol

Kim et al. (2017) showed that click-to-reveal "bubbles" on blurred images produce attention maps that correlate 0.9 with eye-tracking fixations. Scrutinizer already implements the underlying gaze-contingent display — this project adds a structured evaluation mode where participants explore pages under peripheral rendering, and their mouse trajectories are recorded as proxy fixation data.

**Research question**: Do attention maps generated under biologically-motivated peripheral rendering (DoG + crowding) differ systematically from those generated under simple Gaussian blur?

**Deliverables**:
- Evaluation mode: structured task with recording (find X, compare A vs B)
- Aggregated attention heatmap generation from N participants
- Statistical comparison: Scrutinizer-derived maps vs. BubbleView maps vs. eye-tracking ground truth
- Web deployment for remote/Mechanical Turk studies

**Key references**: Kim et al. (2017) BubbleView, Bednarik & Tukiainen (2007) RFV validation

---

### 2.3 Cognitive Load Measurement via Scanning Behavior

**Discipline**: HCI, Cognitive Psychology
**Effort**: Medium | **Novelty**: Medium (mouse-tracking as cognitive load proxy is well-explored; the forced-externalization via peripheral rendering adds a wrinkle but doesn't justify "High")
**Depends on**: Shared instrumentation layer (see top-level note); IRB approval required

Scrutinizer forces users to externalize their visual attention via mouse movements. This project instruments the scanning behavior (fixation count, scan path length, revisitation rate, information foraging efficiency) as a proxy measure for cognitive load. High-load layouts should produce more fixations, longer scan paths, and more revisits.

Feature Congestion scoring (v1.8+) provides a validated, objective measure of layout complexity (ρ=0.93 against the Rosenholtz reference). This gives the study an independent variable that isn't self-reported — correlate scanning metrics against congestion score rather than relying solely on "low/medium/high complexity" categories.

**Research question**: Can mouse-contingent scanning metrics predict subjective cognitive load (NASA-TLX) and task completion time? Does Feature Congestion score predict scanning difficulty better than subjective complexity ratings?

**Deliverables**:
- Instrumentation layer on GazeModel (fixation log, scan path metrics, revisitation graph)
- Feature Congestion scoring of all stimulus pages via `scrutinizer-audit` CLI
- Experiment: N participants × M page layouts (spanning congestion score range) × 2 conditions (Scrutinizer on/off)
- Regression model: scanning metrics + congestion score → NASA-TLX, task time, error rate
- Design guideline: "layouts that require >X fixations per task have excessive cognitive load"

**Key references**: Pirolli & Card (1999) Information Foraging, Rayner (1998), Whitney & Leib (2018), Rosenholtz et al. (2007) Feature Congestion

---

### 2.4 Accessibility Testing Through Peripheral Simulation

**Discipline**: HCI, Accessibility
**Effort**: Medium | **Novelty**: High
**Depends on**: IRB approval required for designer study

Low vision conditions (macular degeneration, glaucoma, diabetic retinopathy) alter the foveal/peripheral balance. This project creates configurable "low vision profiles" that modify Scrutinizer's rendering to simulate specific conditions — scotomas (blind spots), reduced contrast sensitivity, tunnel vision — allowing designers to experience their interfaces as low-vision users do.

**Research question**: Does simulated low-vision testing change designer decision-making about navigation, typography, and color contrast?

**Deliverables**:
- Low vision profiles: central scotoma, peripheral field loss, reduced contrast
- Configurable parameters mapped to clinical severity scales
- Designer study: evaluate layouts with/without low-vision simulation
- Comparison with WCAG 2.1 compliance tools

**Key references**: WHO Vision Impairment classifications, WCAG 2.1

---

## 3. Design Tools & Applied Research

### 3.1 Design Critique Evaluation Study

**Discipline**: Design, HCI
**Effort**: Medium | **Novelty**: Medium
**Depends on**: IRB approval required for designer A/B study

**Status**: The visualization tools are built (saliency overlay, congestion heatmap, side-by-side comparison, spatial quadrant breakdown, CLI batch scoring). This project is now a behavioral study — does any of this actually improve design outcomes? The only remaining tool work is an inverse saliency mode highlighting low-attention dead zones.

**Research question**: Does real-time saliency/congestion feedback during design iteration improve visual hierarchy quality (measured by eye-tracking task performance)? Which feedback modality — saliency overlay, congestion heatmap, numerical score, or side-by-side comparison — produces the largest effect?

**Deliverables**:
- Inverse saliency/congestion mask (highlight dead zones — the one missing tool feature)
- Designer study: 4 conditions (no feedback, saliency only, congestion score only, full suite)
- Before/after congestion scoring via CLI to measure objective improvement
- Eye-tracking validation: do designs improved under feedback also perform better for naive users?
- Design guideline: which feedback modality to use when

**Use cases**: Individual iteration, team critique, client presentation, CI gating

---

### 3.2 Goal-Directed Attentional Gating

**Discipline**: AI + HCI, Cognitive Science
**Effort**: Very High | **Novelty**: Very High
**v1.6 release notes**: "What's Next" section

Peripheral vision doesn't just lose spatial resolution — it also loses semantic access. But goal-relevant content (a "Buy" button when you're shopping) receives more attentional bandwidth than irrelevant content. This is top-down attentional guidance — Wolfe's (2021) guided search framework, where task goals bias feature-level selection. This project embeds page elements and a user-specified goal via a local LLM, then modulates the rendering budget by cosine similarity — goal-aligned content gets more bandwidth even in the periphery.

**Note on terminology**: This is *not* pre-attentive processing (which refers to features processed before attentional selection, e.g. color pop-out). This is the opposite: top-down modulation of what gets selected. The distinction matters for framing, venue selection, and reviewer credibility.

**Open implementation questions**: How do DOM elements get meaningfully embedded — a paragraph, a button label, an image alt-text? How does embedding granularity interact with rendering resolution? What happens when elements have no textual content? These need prototyping before the behavioral study is feasible.

**Research question**: Does goal-directed attentional gating change information foraging behavior compared to purely spatial (bottom-up) saliency gating?

**Deliverables**:
- Local embedding pipeline (page elements → vectors, goal → vector)
- Cosine similarity → per-element bandwidth modulation
- Integration with existing saliency gating uniform
- Behavioral study: task completion with spatial-only vs. goal-weighted periphery

**Key references**: Wolfe (2021) guided search, Pirolli & Card (1999) Information Foraging, Desimone & Duncan (1995) biased competition

---

### 3.3 Eye Tracker Integration (Tobii/Webcam)

**Discipline**: HCI, Engineering
**Effort**: Medium-High | **Novelty**: Low (but high utility)
**ROADMAP section**: Priority 6 — Eye tracker integration
**Depends on**: IRB approval for comparison study; Tobii hardware access

Replace the mouse-based gaze proxy with real gaze data from a Tobii eye tracker or webcam-based tracker (e.g., Eyeware Beam, WebGazer.js). The v1.6 GazeModel module is designed to be swappable — this project implements the adapter.

**Research question**: How do scanning patterns and task performance differ between mouse-contingent and gaze-contingent rendering?

**Deliverables**:
- GazeModel adapter for Tobii SDK (native) or WebGazer.js (webcam)
- Calibration integration with existing foveal calibration tool
- Latency characterization (mouse ~16ms, eye tracker ~33ms, webcam ~100ms)
- Comparison study: mouse vs. gaze × 3 page types

**Key references**: Tobii Pro SDK documentation, WebGazer.js (Papoutsaki et al., 2016), EasyEyes Remote Calibrator

---

### 3.4 Cross-Device Peripheral Comparison (Desktop vs. Mobile vs. Tablet)

**Discipline**: HCI, UX Research
**Effort**: Medium | **Novelty**: Medium
**Depends on**: IRB approval; access to multiple device form factors

Scrutinizer already supports mobile emulation (v1.5). This project systematically compares how peripheral rendering affects task performance across device form factors. On mobile, the entire viewport is closer to foveal size — does peripheral simulation still matter?

**Research question**: At what screen size / viewing distance does peripheral rendering cease to meaningfully affect information foraging behavior?

**Deliverables**:
- Controlled experiment: desktop (27") vs. laptop (14") vs. tablet (10") vs. phone (6")
- Task battery: search, comparison, navigation on matched content
- Critical threshold: minimum angular viewport size where periphery matters
- Design guidelines per device class

---

### 3.5 AI-Assisted Design Iteration via MCP

**Discipline**: HCI, AI + Design
**Effort**: Medium | **Novelty**: Very High
**Depends on**: IRB approval required for designer study

Scrutinizer's MCP server lets an LLM agent score a page's visual complexity, suggest changes, and re-score. The server exposes `analyze_url` (single-page scoring), `analyze_urls` (batch), and `compare_pages` (before/after delta). An agent can interpret the congestion/saliency breakdown, propose CSS or layout changes, and verify the result. This project studies whether that closed loop produces measurably better outcomes than unaided iteration or static feedback (a score with no agent suggestions).

**Research question**: Does AI-assisted design iteration with quantitative visual complexity feedback produce lower-congestion, higher-performing layouts compared to (a) unaided designer iteration, or (b) designer + congestion score without AI suggestions?

**Deliverables**:
- Study protocol: 3 conditions — designer alone, designer + congestion score, designer + AI agent with MCP
- Task: redesign 3 high-congestion pages (congestion score > 55) to reduce clutter while preserving content
- Measures: congestion score delta, task completion time, designer satisfaction (Likert), naive-user eye-tracking on resulting designs
- Analysis of AI suggestion quality: which suggestions actually reduce congestion? Which are rejected and why?
- Ethical considerations: does AI-assisted design homogenize visual style?

**Key references**: Rosenholtz et al. (2007), Mozannar et al. (2024) on AI-human co-creation, MCP (Model Context Protocol)

---

### 3.6 Web-Scale Visual Clutter Census

**Discipline**: HCI, Data Science, Design
**Effort**: Low-Medium | **Novelty**: Medium-High

The `scrutinizer-audit` CLI can score hundreds of pages per hour. This project runs it against a large sample — Alexa/Tranco top 10K, category verticals, or a curated corpus — to build a large-scale visual complexity dataset using Feature Congestion. Reinecke et al. (2013) collected subjective complexity ratings; this would be the algorithmic complement. No human participants needed.

**Research question**: How does visual complexity distribute across the web? Do industry verticals (news, e-commerce, SaaS, government) cluster at different congestion levels? Has web clutter increased or decreased over time (using Wayback Machine snapshots)?

**Deliverables**:
- Crawling pipeline: `scrutinizer-audit` with sitemap parsing, retry logic, viewport variants (desktop + mobile)
- Dataset: congestion score, edge density, spatial breakdown for N≥1000 pages
- Statistical analysis: distribution by vertical, device, above-fold vs. first-scroll
- Temporal analysis (stretch goal): same pages scored across Wayback Machine snapshots to measure complexity trends
- Public dataset release for other researchers

**Key references**: Rosenholtz et al. (2007), Web Almanac (HTTP Archive), Reinecke et al. (2013) visual complexity ratings

---

## 4. Technical / Systems Projects

### 4.1 Saliency & Congestion Model Comparison Framework

**Discipline**: Computer Vision, HCI
**Effort**: Medium | **Novelty**: Medium

Scrutinizer's saliency worker uses a custom center-surround + face detection + structure-aware model, and the congestion worker implements Rosenholtz Feature Congestion at fixed σ=2.5. But many saliency models exist (Itti-Koch, DeepGaze II, GBVS, SAM), and the congestion implementation uses a single-scale Gaussian where the original uses multi-scale steerable pyramids. This project creates a modular backend where different models can be hot-swapped, and their outputs compared against human attention data.

**Scanpath replay integration**: Validation Experiment D in the scanpath replay spec (`docs/scanpath-replay-spec.md`) provides the evaluation framework for this project. It computes AUC-Judd, NSS, and Information Gain for Scrutinizer's saliency map against UEyes fixation data, decomposed by channel (Oklab DoG, face detection, DOM structure). This project extends Experiment D to compare *multiple* saliency backends against the same fixation ground truth — the scanpath replay infrastructure provides the fixation data, coordinate conversion, and per-frame extraction harness. Start by running Experiment D with the current model to establish a baseline, then swap in alternative backends.

The dual-worker architecture already defines clean input/output contracts (PNG buffer → heatmap texture). The CLI enables batch evaluation across page sets, and the side-by-side shader comparison mode can be extended to show any two model outputs.

**Deliverables**:
- Saliency model interface (input: frame, output: heatmap)
- 3+ saliency implementations (current, Itti-Koch reimpl, DeepGaze via ONNX)
- Multi-scale congestion comparison: current single-scale σ=2.5 vs. steerable pyramid approximation
- Evaluation harness: extend Experiment D to compare model predictions vs. UEyes/MIT1003 fixation ground truth (AUC-Judd, NSS, IG)
- Batch evaluation: run model comparison across 50+ pages via CLI with scanpath replay
- Performance profiling per model (latency, accuracy, GPU cost)

---

### 4.2 OffscreenCanvas Worker Thread Renderer

**Discipline**: Systems, Computer Graphics
**Effort**: High | **Novelty**: Low (engineering only — no publication potential)
**ROADMAP section**: OffscreenCanvas Renderer

**Note**: This is a developer task, not a research contribution. A student choosing this project gets engineering experience but no thesis chapter or publication. Consider assigning to an undergraduate or treating as infrastructure work rather than a grad research project.

Move the WebGL rendering context to a Web Worker using OffscreenCanvas, decoupling the rendering pipeline from the main thread entirely. Currently the rendering is GPU-bound, so the main thread isn't the bottleneck — but this changes when saliency computation, structure analysis, and visual memory updates all compete for main thread time.

**Deliverables**:
- OffscreenCanvas WebGL context in dedicated worker
- Message-passing protocol for uniform updates, texture uploads
- Performance comparison: main-thread vs. worker rendering
- Latency characterization under heavy DOM analysis load

---

## Project Selection Guide

| Project | Semester | Thesis | Lab Resources | IRB | Publication Potential |
|---------|----------|--------|--------------|-----|----------------------|
| 1.1 Oriented DoG | Eng: yes; validation: separate | No | None | 👁 for validation | Workshop paper |
| 1.2 Mongrel Synthesis | No | Yes | GPU cluster | 👁 for comparison | SIGGRAPH / JOV |
| 1.3 Calibrated Angles | Yes | No | None | — | **Prerequisite** for 1.1, 1.4 |
| 1.4 Saccadic Dynamics | Yes | Partial | None | 👁 | JOV / ETRA |
| 1.5 Congestion-Gated Eval | Yes | Yes | Participant pool | 👁 | CHI / JOV |
| 2.1 Fixation Recording | Eng: yes; study: thesis-scale | Yes | None | 👁 | CHI / UIST |
| 2.2 Crowdsourced Attention | Yes | Yes | MTurk budget | 👁 (remote) | CHI |
| 2.3 Cognitive Load | No | Yes | Participant pool | 👁 | CHI / CogSci |
| 2.4 Accessibility | Yes | Yes | Participant pool | 👁 | ASSETS / CHI |
| 3.1 Design Critique Eval | Yes (study only) | Yes | Designer pool | 👁 | DIS / CHI |
| 3.2 Goal-Directed Gating | No | Yes | Local LLM / GPU | 👁 | CHI / CogSci |
| 3.3 Eye Tracker | Yes | No | Tobii hardware | 👁 | ETRA |
| 3.4 Cross-Device | Yes | Yes | Multiple devices | 👁 | MobileHCI / CHI |
| 3.5 AI-Assisted Design | Yes | Yes | None (MCP built) | 👁 | CHI / DIS |
| 3.6 Clutter Census | Yes | No | None (CLI built) | — | CHI / Web Conf |
| 4.1 Saliency/Congestion Comparison | Yes | Partial | None | — | ETRA / JOV |
| 4.2 OffscreenCanvas | Yes | No | None | — | None (engineering task) |

**Recommended starting points**:
- **Vision science track**: 1.3 (Calibrated Angles) → 1.1 (Oriented DoG) → 1.2 (Mongrel)
- **HCI/UX track**: 2.1 (Fixation Recording) → 2.3 (Cognitive Load) → 2.2 (Crowdsourced)
- **Design track**: 3.1 (Design Critique Eval) → 3.5 (AI-Assisted Design) → 3.2 (Goal-Directed Gating)
- **Validation track**: Scanpath Replay Phases 1-2 (`docs/scanpath-replay-spec.md`) → 4.1 (Saliency Comparison via Experiment D) → 1.5 (Congestion-Gated Eval via Experiment C) — no IRB for the automated experiments, uses published datasets, builds toward behavioral studies
- **Accessibility track**: 1.3 (Calibrated Angles) → 2.4 (Accessibility Testing)
- **Low-barrier entry**: 3.6 (Clutter Census) — no IRB, no participants, uses existing CLI. Good for a semester project or as a warm-up before a thesis-scale study
- **Congestion track**: 3.6 (Clutter Census) → 1.5 (Congestion-Gated Eval) → 2.3 (Cognitive Load)

---

## Acknowledgments

This research backlog was initially authored by Claude (Anthropic, Opus 4.6) via Claude Code, working from the Scrutinizer v1.6.0 codebase, architecture documents, scientific literature review, and roadmap. Updated for v1.8+ (Feature Congestion, CLI/MCP, congestion-gated pooling). Reviewed and corrected for terminological precision, effort calibration, reference accuracy, and practical feasibility (IRB timelines, shared infrastructure dependencies).

**Known limitations of the AI-generated first draft** (partially addressed):
- Reference lists skew toward canonical papers and lack 2020–2025 work — a supervising PI should verify against current literature
- Effort estimates were not calibrated against lived experience supervising graduate students
- Original version contained a hallucinated reference ("Eyeware FidelityFX fork") and a terminological error (Project 3.2 misnamed "Pre-Attentive" when describing top-down attentional guidance) — both corrected

**Source materials**: `docs/foveated-vision-model.md` (biological model), `docs/scientific_literature_review.md` (full references), `ROADMAP.md` (technical backlog), `docs/congestion-journey.md` (Feature Congestion implementation & validation log), `cli/` (scrutinizer-audit CLI & MCP server source).
