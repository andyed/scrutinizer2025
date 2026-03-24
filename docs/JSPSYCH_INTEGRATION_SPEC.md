# Scrutinizer × jsPsych Integration Spec

**Date:** 2026-03-21
**Status:** Proposal
**Author:** Andy Edmonds

---

## Motivation

Scrutinizer simulates foveated vision in the browser using WebGL. jsPsych runs behavioral experiments in the browser using JavaScript. Combining them creates the first browser-based gaze-contingent experimental tool — a gap in the field.

The lineage: PsyScope (1990s, Mac, Macintosh Common Lisp) → PsychoPy (2000s, Python, OpenGL) → jsPsych (2010s, JavaScript, browser). Each generation moved toward accessibility. Scrutinizer adds what none of them have: real-time foveation simulation as a stimulus manipulation, not just a post-hoc analysis.

### What PsychoPy Does (and Doesn't)

PsychoPy (Peirce et al., 2019) is the current standard for desktop psychophysics experiments. It handles monitor calibration, stimulus timing, and response collection with sub-millisecond precision via OpenGL. It supports gaze-contingent paradigms through eye tracker integration (SR Research, Tobii).

What PsychoPy doesn't do:
- Run in browsers (Pavlovia exports are limited)
- Simulate foveated vision as a stimulus manipulation
- Work without dedicated eye tracking hardware

PsychoPy should be cited in the arxiv paper as the primary prior art for experimental stimulus control. The relevant citation:

```bibtex
@article{peirce2019,
  author  = {Peirce, Jonathan and Gray, Jeremy R. and Simpson, Sol and MacAskill, Michael and H{\"o}chenberger, Richard and Sogo, Hiroyuki and Kastman, Erik and Lindel{\o}v, Jonas Kristoffer},
  title   = {{PsychoPy2}: Experiments in behavior made easy},
  journal = {Behavior Research Methods},
  volume  = {51},
  number  = {1},
  pages   = {195--203},
  year    = {2019},
  doi     = {10.3758/s13428-018-01193-y}
}
```

### Historical Context

PsyScope (Cohen, MacWhinney, Flatt & Provost, 1993) was built at CMU in Macintosh Common Lisp. Andy worked on the parallel version (~1990). jsPsych is the spiritual successor for the browser era — same design philosophy (trial-based, timeline-driven, plugin architecture) but accessible to anyone with a web browser.

```bibtex
@article{cohen1993,
  author  = {Cohen, Jonathan D. and MacWhinney, Brian and Flatt, Matthew and Provost, Jefferson},
  title   = {{PsyScope}: A new graphic interactive environment for designing psychology experiments},
  journal = {Behavior Research Methods, Instruments, \& Computers},
  volume  = {25},
  number  = {2},
  pages   = {257--271},
  year    = {1993},
  doi     = {10.3758/BF03204507}
}
```

---

## Architecture: jspsych-scrutinizer Plugin

### Overview

A jsPsych extension that applies Scrutinizer's WebGL foveation shader to experiment stimuli in real time. Gaze position comes from mouse tracking (MouseView.js paradigm) or webcam-based estimation.

```
jsPsych Timeline
  ├── fixation cross (standard)
  ├── stimulus + scrutinizer overlay (foveated)
  │     ├── gaze input: mouse position OR webcam
  │     ├── foveation: Scrutinizer WebGL shader
  │     └── response collection: keyboard/mouse
  └── ITI (standard)
```

### Gaze Input Tiers

Three tiers of gaze input, each with different precision/accessibility tradeoffs. The plugin supports all three through a common interface.

#### Tier 1: Webcam Gaze Estimation (Primary)

**MediaPipe FaceMesh + Iris** (Apache-2.0) via TensorFlow.js — actual gaze tracking using a standard webcam.

MediaPipe's face landmarks model tracks 468 facial landmarks including iris center coordinates. Combined with head pose estimation and a calibration routine, this provides screen-point gaze estimation. The underlying models (FaceMesh, Iris) are Apache-2.0 licensed. Runs in-browser, CPU-based (no GPU required, though WebGL backend available for acceleration). ~3MB model weights.

Note: Google's official position is that iris tracking "does not infer the location at which people are looking." This is true of the raw model output. The calibration step (mapping iris position + head pose → screen coordinates) is what makes it gaze estimation. WebGazer.js does this calibration but adds a GPL license. Building a permissive-license calibration layer on top of Apache-2.0 MediaPipe models is the path.

**remote-calibrator** (EasyEyes/Pelli lab, MIT) provides the calibration infrastructure — viewing distance estimation, screen size measurement, and basic gaze direction. Critical because Scrutinizer's eccentricity calculations depend on knowing the viewing distance.

Advantages:
- Real gaze tracking — measures where the eyes point, not where the hand moves
- No dedicated hardware required
- All Apache-2.0 / MIT — no GPL
- ~30ms update rate (vs ~200ms for mouse movements)

Limitations:
- Requires webcam permission
- Accuracy ~2-4° visual angle (vs <1° for hardware eye trackers)
- Calibration step required (9-point or 5-point)
- Lighting-dependent

```bibtex
@misc{remotecalibrator,
  author = {Li, Peiling and Pelli, Denis G.},
  title  = {remote-calibrator: Measure screen size, track viewing distance and gaze},
  year   = {2023},
  url    = {https://github.com/EasyEyes/remote-calibrator},
  note   = {MIT License}
}
```

#### Tier 2: Mouse-Contingent Aperture (Attention Tracking)

**MouseView.js** (Anwyl-Irvine et al., 2021) — MIT licensed, already cited in the arxiv paper.

This is **not gaze tracking**. It measures attentional allocation through motor behavior — where participants choose to move the cursor to reveal content. Different signal, different timescale. The mouse moves where attention *decides* to go; the eyes move where attention *is pulled* before conscious decision.

Useful for a different class of experiments: measuring deliberate information-seeking strategy rather than reflexive visual attention.

Advantages:
- No hardware or permissions required
- No calibration
- Works in any browser
- Published validation (Anwyl-Irvine et al., 2021; BRM)

Limitations:
- Not gaze — measures voluntary motor behavior, not involuntary eye movements
- ~200ms motor latency vs ~30ms saccadic latency
- Reveals strategy, not perception

#### Tier 3: Hardware Eye Tracker (Gold Standard)

WebSocket bridge to Tobii, SR Research, or Pupil Labs hardware. Sub-degree accuracy, 60-1000Hz sampling. Required for publication-grade psychophysics. Out of scope for Phase 1 but the plugin API should accommodate it.

```javascript
gazeSource: 'webcam'    // Tier 1: MediaPipe + calibration
gazeSource: 'mouse'     // Tier 2: MouseView.js aperture (attention, not gaze)
gazeSource: 'hardware'  // Tier 3: WebSocket to eye tracker
```

### What Scrutinizer Provides

The existing Scrutinizer WebGL pipeline:
1. **Cortical magnification function** — maps eccentricity to blur radius (Rovamo & Virsu, 1979; Schwartz, 1980)
2. **Chromatic degradation** — color perception loss in periphery (Mullen & Kingdom, 2002; Hansen et al., 2009)
3. **Crowding simulation** — feature averaging beyond Bouma's limit (Bouma, 1970; Pelli & Tillman, 2008)
4. **Metamerism** — texture synthesis for peripheral appearance (Freeman & Simoncelli, 2011; Walton et al., 2021)

All of these are already implemented as WebGL shaders. The jsPsych plugin exposes them as experimental manipulations.

---

## Plugin API

```javascript
// Initialize the extension
const scrutinizerExtension = {
  type: jsPsychExtensionScrutinizer,
  params: {
    // Foveation model
    foveationModel: 'cortical_magnification', // or 'gaussian_blur', 'metamer'

    // Gaze input
    gazeSource: 'mouse',  // or 'webcam' (requires remote-calibrator)

    // Visual parameters
    viewingDistanceCm: 60,     // default, overridden by remote-calibrator if available
    screenWidthCm: 34,         // auto-detected if possible
    pixelsPerDegree: null,     // calculated from above

    // Foveation parameters
    fovealRadiusDeg: 2.0,      // central clear region (default: ~2° fovea)
    maxBlurDeg: 30,            // eccentricity at max blur

    // Data collection
    recordGazeData: true,      // log gaze/mouse coordinates per frame
    sampleRateMs: 16,          // ~60fps sampling
  }
};

// Use in a trial
const trial = {
  type: jsPsychImageKeyboardResponse,
  stimulus: 'scene.jpg',
  extensions: [scrutinizerExtension],
  data: {
    condition: 'foveated'  // vs 'normal' in control trials
  }
};
```

### Data Output

Each trial with the extension active records:
```javascript
{
  // Standard jsPsych fields
  rt: 1234,
  response: 'f',

  // Scrutinizer extension data
  scrutinizer_gaze_data: [
    { t: 0, x: 512, y: 384, eccentricityDeg: 0 },
    { t: 16, x: 520, y: 380, eccentricityDeg: 0.3 },
    // ... per-frame samples
  ],
  scrutinizer_model: 'cortical_magnification',
  scrutinizer_gaze_source: 'mouse',
  scrutinizer_viewing_distance_cm: 58.2,  // from remote-calibrator
  scrutinizer_foveal_radius_deg: 2.0
}
```

---

## Experiment Designs Enabled

### 1. Foveated Usability Testing
Run standard usability tasks (card sorting, visual search, navigation) through the foveation overlay. Measure performance delta between foveated and normal conditions. Validates whether UI elements are visible in peripheral vision.

### 2. Peripheral Object Detection
Present COCO images (or COCO-Periph stimuli) through foveation model. Measure detection accuracy as a function of eccentricity. Compares human peripheral detection to model predictions.

### 3. Crowding Threshold Measurement
Present letter identification tasks at varying eccentricities with and without flankers. The foveation overlay makes crowding visible — participants experience what their visual system actually processes.

### 4. Attention Allocation Studies
Track where participants "look" (via mouse) when viewing web pages, data visualizations, or UI designs under foveated conditions. Reveals attentional strategies that normal viewing obscures.

### 5. Reading Under Foveation
Combine with iBlipper (RSVP) — present text through foveation overlay. Measure reading speed and comprehension as a function of foveal radius. Tests whether the Stroop-effect-based reading model holds under degraded peripheral vision.

---

## Implementation Phases

### Phase 1: Core Plugin (MVP)
- jsPsych extension that applies Gaussian blur based on mouse distance
- Mouse-contingent aperture (MouseView.js paradigm)
- Basic data logging (gaze coordinates, eccentricity)
- Works with `jsPsych-image-keyboard-response` and `jsPsych-html-keyboard-response`

### Phase 2: Full Foveation Model
- Port Scrutinizer's cortical magnification shader into the plugin
- Add chromatic degradation
- Integrate remote-calibrator for viewing distance
- Proper pixels-per-degree calculation

### Phase 3: Advanced Stimuli
- Support for video stimuli (foveated video viewing)
- Integration with COCO-Periph benchmark
- Crowding-specific trials with Bouma's law validation
- Export to Pavlovia for online data collection

---

## Dependencies & Licensing

| Component | License | Role |
|-----------|---------|------|
| Scrutinizer WebGL shaders | BSD | Foveation rendering |
| jsPsych | MIT | Experiment framework |
| MediaPipe FaceMesh + Iris | Apache-2.0 | Webcam gaze estimation (Tier 1) |
| TensorFlow.js | Apache-2.0 | ML runtime for MediaPipe models |
| remote-calibrator | MIT | Viewing distance, screen calibration |
| MouseView.js | MIT | Mouse-contingent attention tracking (Tier 2, not gaze) |

All MIT/BSD/Apache — no GPL contamination.

---

## References (to add to references.bib)

```bibtex
@article{peirce2019,
  author  = {Peirce, Jonathan and Gray, Jeremy R. and Simpson, Sol and MacAskill, Michael and H{\"o}chenberger, Richard and Sogo, Hiroyuki and Kastman, Erik and Lindel{\o}v, Jonas Kristoffer},
  title   = {{PsychoPy2}: Experiments in behavior made easy},
  journal = {Behavior Research Methods},
  volume  = {51},
  number  = {1},
  pages   = {195--203},
  year    = {2019},
  doi     = {10.3758/s13428-018-01193-y}
}

@article{deleeuw2015,
  author  = {de Leeuw, Joshua R.},
  title   = {{jsPsych}: A {JavaScript} library for creating behavioral experiments in a web browser},
  journal = {Behavior Research Methods},
  volume  = {47},
  number  = {1},
  pages   = {1--12},
  year    = {2015},
  doi     = {10.3758/s13428-014-0458-y}
}

@article{cohen1993,
  author  = {Cohen, Jonathan D. and MacWhinney, Brian and Flatt, Matthew and Provost, Jefferson},
  title   = {{PsyScope}: A new graphic interactive environment for designing psychology experiments},
  journal = {Behavior Research Methods, Instruments, \& Computers},
  volume  = {25},
  number  = {2},
  pages   = {257--271},
  year    = {1993},
  doi     = {10.3758/BF03204507}
}

@misc{remotecalibrator,
  author = {Li, Peiling and Pelli, Denis G.},
  title  = {remote-calibrator: Measure screen size, track viewing distance and gaze},
  year   = {2023},
  url    = {https://github.com/EasyEyes/remote-calibrator},
  note   = {MIT License}
}
```

---

## Connection to Existing Work

This plugin sits at the intersection of three Scrutinizer threads:

1. **The arxiv paper** — validates the foveation model by showing it produces measurable behavioral effects in controlled experiments
2. **The RFV lineage** — Restricted Focus Viewer (Jansen et al., 2003) → ScreenMasker (Orlov & Bednarik, 2016) → Scrutinizer (Edmonds, 2007/2025). Each generation added fidelity; the jsPsych plugin adds experimental control.
3. **BubbleView connection** — Kim et al. (2017) showed click-contingent apertures can approximate eye tracking for importance maps. MouseView.js extended this. Scrutinizer adds biologically grounded foveation instead of simple Gaussian blur.

---

*This spec is a living document. Implementation begins with Phase 1 (core plugin + mouse tracking).*
