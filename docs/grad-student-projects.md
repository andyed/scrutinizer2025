# Grad Student Project Backlog

Potential thesis/capstone projects for graduate students in HCI, Vision Science, UX Research, or Design. Each project builds on Scrutinizer's existing infrastructure — a real-time, gaze-contingent foveated rendering system running in Electron/WebGL.

**Architecture advantage**: The v1.6 de-monolith (GazeModel, VisualMemory, ContentAnalysis, pipeline orchestrator) means each module can be independently swapped, extended, or instrumented without touching the rest of the pipeline.

**IRB/Ethics note**: Projects marked with 👁 in the selection guide involve human participants and require IRB/ethics board approval before data collection. At most institutions this takes 1–3 months and is a hard prerequisite — factor it into semester timelines. Projects 2.2 and 2.3 involving remote participants (MTurk) may need separate protocol review.

**Shared instrumentation prerequisite**: Projects 2.1, 2.2, and 2.3 all require behavioral recording and GazeModel instrumentation. Rather than building this independently three times, a shared instrumentation layer (fixation logging, scan path metrics, event stream) should be built first — treat it as a foundational sprint similar to how 1.3 is foundational for vision-science projects.

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

### 1.4 Saccadic Dynamics & Inhibition of Return

**Discipline**: Vision Science, Cognitive Science
**Effort**: Medium | **Novelty**: Medium

The current GazeModel tracks velocity and detects fixations, but doesn't model saccadic dynamics beyond simple suppression. This project adds biologically plausible saccade generation: realistic main sequence (amplitude-velocity relationship), corrective saccades, express saccades, and inhibition of return (IOR) — the tendency to avoid re-fixating recently visited locations.

**Research question**: Does adding IOR to the visual memory decay model change user scanning patterns on information-dense pages?

**Deliverables**:
- Extended GazeModel with main sequence parameters
- IOR integration with VisualMemory (recently fixated regions decay faster or resist re-clearing)
- Behavioral study: compare scanning efficiency with/without IOR simulation (requires IRB approval)
- GazeModel is independently swappable — drop-in replacement

**Key references**: Rayner (1998), Klein (2000) IOR review

---

## 2. HCI & UX Research

### 2.1 Fixation Recording & Attention Flow Visualization

**Discipline**: HCI, UX Research
**Effort**: High (thesis-scale — see scoping note) | **Novelty**: Medium-High
**ROADMAP section**: Priority 6 — Fixation Recording & Visualization

Build a recording system that captures the sequence of fixations and generates visual artifacts showing how the page appeared at each fixation point. Multi-zone capture strategy: fovea at full resolution, parafovea at 75%, near periphery at 50%, with zone reuse for close fixations.

**Scoping note**: As listed, this project includes a recording system, interactive HTML export with scrubber, animated export pipeline (GIF/WebM), layered PSD output, *and* a comparison study against Tobii eye-tracking. Each is non-trivial; the comparison study alone requires participant recruitment, IRB approval, and statistical analysis. A realistic single-semester scope is the recording system + one export format. The comparison study is a separate semester or thesis chapter.

**Research question**: Can fixation sequence recordings with peripheral context replace or supplement eye-tracking for remote UX evaluation?

**Deliverables**:
- Recording system (start/stop, `.scrutinizer` archive format)
- Interactive HTML export with scrubber and saccade path overlay
- Animated export (GIF/WebM) for shareable attention flow demos
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

**Research question**: Can mouse-contingent scanning metrics predict subjective cognitive load (NASA-TLX) and task completion time on information-dense pages?

**Deliverables**:
- Instrumentation layer on GazeModel (fixation log, scan path metrics, revisitation graph)
- Experiment: N participants × M page layouts × 2 conditions (Scrutinizer on/off)
- Regression model: scanning metrics → NASA-TLX, task time, error rate
- Design guideline: "layouts that require >X fixations per task have excessive cognitive load"

**Key references**: Pirolli & Card (1999) Information Foraging, Rayner (1998), Whitney & Leib (2018)

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

### 3.1 Saliency-Driven Design Critique Tool

**Discipline**: Design, HCI
**Effort**: Medium | **Novelty**: Medium
**ROADMAP section**: Priority 3 — Saliency Map Design Tool
**Depends on**: IRB approval required for designer A/B study

Expose Scrutinizer's saliency map as a design critique tool. Overlay heatmap on any page showing "what draws the eye" based on bottom-up features (color contrast, edge density, motion). Add inverse saliency mode highlighting low-attention regions that may be missed.

**Research question**: Does real-time saliency feedback during design iteration improve visual hierarchy quality (measured by eye-tracking task performance)?

**Deliverables**:
- Saliency overlay mode with blend controls
- Inverse saliency mask (highlight dead zones)
- Threshold slider for binary masking
- Designer study: A/B — design with vs. without saliency feedback
- Before/after comparison of attention distribution on resulting designs

**Use cases**: Individual iteration, team critique, client presentation

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

## 4. Technical / Systems Projects

### 4.1 Real-Time Saliency Model Comparison Framework

**Discipline**: Computer Vision, HCI
**Effort**: Medium | **Novelty**: Medium

Scrutinizer's saliency worker uses a custom center-surround + face detection + structure-aware model. But many saliency models exist (Itti-Koch, DeepGaze II, GBVS, SAM). This project creates a modular saliency backend where different models can be hot-swapped, and their outputs compared against human attention data.

**Deliverables**:
- Saliency model interface (input: frame, output: heatmap)
- 3+ model implementations (current, Itti-Koch reimpl, DeepGaze via ONNX)
- Evaluation harness: compare model predictions vs. mouse-trajectory ground truth
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
| 2.1 Fixation Recording | Eng: yes; study: thesis-scale | Yes | None | 👁 | CHI / UIST |
| 2.2 Crowdsourced Attention | Yes | Yes | MTurk budget | 👁 (remote) | CHI |
| 2.3 Cognitive Load | No | Yes | Participant pool | 👁 | CHI / CogSci |
| 2.4 Accessibility | Yes | Yes | Participant pool | 👁 | ASSETS / CHI |
| 3.1 Saliency Critique | Yes | Partial | Designer pool | 👁 | DIS / CHI |
| 3.2 Goal-Directed Gating | No | Yes | Local LLM / GPU | 👁 | CHI / CogSci |
| 3.3 Eye Tracker | Yes | No | Tobii hardware | 👁 | ETRA |
| 3.4 Cross-Device | Yes | Yes | Multiple devices | 👁 | MobileHCI / CHI |
| 4.1 Saliency Comparison | Yes | Partial | None | — | ETRA / JOV |
| 4.2 OffscreenCanvas | Yes | No | None | — | None (engineering task) |

**Recommended starting points**:
- **Vision science track**: 1.3 (Calibrated Angles) → 1.1 (Oriented DoG) → 1.2 (Mongrel)
- **HCI/UX track**: 2.1 (Fixation Recording) → 2.3 (Cognitive Load) → 2.2 (Crowdsourced)
- **Design track**: 3.1 (Saliency Critique) → 3.2 (Goal-Directed Gating)
- **Accessibility track**: 1.3 (Calibrated Angles) → 2.4 (Accessibility Testing)

---

## Acknowledgments

This research backlog was initially authored by Claude (Anthropic, Opus 4.6) via Claude Code, working from the Scrutinizer v1.6.0 codebase, architecture documents, scientific literature review, and roadmap. Subsequently reviewed and corrected for terminological precision, effort calibration, reference accuracy, and practical feasibility (IRB timelines, shared infrastructure dependencies).

**Known limitations of the AI-generated first draft** (partially addressed):
- Reference lists skew toward canonical papers and lack 2020–2025 work — a supervising PI should verify against current literature
- Effort estimates were not calibrated against lived experience supervising graduate students
- Original version contained a hallucinated reference ("Eyeware FidelityFX fork") and a terminological error (Project 3.2 misnamed "Pre-Attentive" when describing top-down attentional guidance) — both corrected

**Source materials**: `docs/foveated-vision-model.md` (biological model), `docs/scientific_literature_review.md` (full references), `ROADMAP.md` (technical backlog).
