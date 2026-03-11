# Scanpath Replay: Import, Playback, Video Recording & Validation

Specification for importing published eye-tracking scanpath datasets, replaying them through Scrutinizer's foveated rendering pipeline, and recording the output for automated validation experiments.

**Status:** Draft
**Date:** 2026-03-05
**Author:** Andy Edmonds

---

## Motivation

`GazeModel` exposes `update(now)`, `getPosition()`, `getVelocity()` and is consumed by the render loop at `scrutinizer.js:352-354`. This clean interface is a branch point — any object implementing these four methods can drive the pipeline. Importing published scanpath data through a drop-in replacement enables:

### Dependent grad student projects

Phases 1–2 (common format + ScanpathPlayer) are prerequisites for:
- **Project 2.1** (Fixation Recording) — recording format and coordinate conversion
- **Project 2.3** (Cognitive Load) — behavioral baseline for mouse-vs-eye comparison
- **Project 4.1** (Saliency/Congestion Comparison) — Validation Experiment D
- See `docs/grad-student-projects.md` for full project descriptions.

### Pipeline validation integration

The v2.1 validation waves (`docs/release_notes_v2.1.0.md`) use static fixation captures. Scanpath replay enables dynamic validation — replaying published scanpaths (UEyes, MIT1003) through the pipeline and measuring temporal output against Wave 3 crowding predictions.

1. **Automated video demos** — deterministic, repeatable renderings for blog posts and presentations
2. **Perceptual validation** — compare Scrutinizer's output against known human fixation data
3. **Regression testing** — detect unintended pipeline changes by replaying identical scanpaths across versions

---

## 1. Common Scanpath Format

Internal representation shared by all importers.

### Types

**File:** `renderer/scanpath/scanpath-types.js`

```js
/**
 * A single fixation event.
 * Coordinates are physical canvas pixels (positive-down), matching GazeModel.getPosition().
 * Times are ms from start of recording.
 */
// Fixation: { x: number, y: number, tStart: number, tEnd: number }

/**
 * An interaction event recorded alongside gaze data.
 */
// ScanpathEvent: { type: "click"|"scroll", timestamp: number, data: any }

/**
 * Complete scanpath with metadata for coordinate conversion.
 */
// ScanpathData: {
//   meta: {
//     dataset: string,           // "ueyes"|"recgaze"|"mit1003"|"fixatons"|"onestop"
//     participantId: string,
//     stimulusId: string,
//     stimulusWidth: number,     // original stimulus pixels
//     stimulusHeight: number,
//     viewingDistanceCm?: number,
//     screenWidthCm?: number,
//   },
//   fixations: Fixation[],
//   events?: ScanpathEvent[]
// }
```

### Coordinate Convention

- Physical pixels, positive-down — matches `GazeModel.getPosition()` output
- `tStart`/`tEnd` pairs encode fixation duration; gaps between `tEnd[i]` and `tStart[i+1]` are saccade intervals
- If a dataset provides only fixation centers with durations (no explicit saccade gaps), the importer sets `tEnd = tStart + duration` and the player inserts synthetic saccades (see §3)

---

## 2. Per-Dataset Importers

Each importer lives in `renderer/scanpath/importers/`, exports `parse(fileContent, options) → ScanpathData[]`.

### Summary Table

| Dataset | Format | Coord System | Time | Parser Approach |
|---------|--------|-------------|------|----------------|
| **UEyes** | Gazepoint CSV | Normalized 0-1 | ms | JS CSV parse, multiply by stimulus dims |
| **RecGaze** | Tobii CSV | Pixels | mixed (ms fixations, s clicks) | JS CSV, extract scroll/click as events |
| **MIT1003** | MATLAB .mat | Pixels (1024×768) | ms | Python converter → JSON, JS reads JSON |
| **FixaTons** | NumPy .npy | Pixels, Y-inverted | s→ms | Python converter using `fixatons` API → JSON |
| **OneStop** | EyeLink CSV | Pixels | ms | JS CSV, accumulate durations for timing |

### 2.1 UEyes (Priority 1)

**Why first:** Simplest CSV format, web/UI stimuli (closest to Scrutinizer's target domain), largest coverage of page types.

- Source: Gazepoint CSV with columns `FPOGX`, `FPOGY` (normalized 0-1), `FPOGD` (duration ms)
- Importer: `importers/ueyes-importer.js`
- Coordinate conversion: multiply by `stimulusWidth`/`stimulusHeight` from metadata
- Fixation timing: `tStart` accumulated from durations, `tEnd = tStart + FPOGD`

### 2.2 RecGaze (Priority 2)

**Why second:** Interactive stimuli with scroll/click events — enables testing interaction-aware rendering.

- Source: Tobii CSV with fixation coordinates in pixels, timestamps in ms
- Click events in separate column with timestamps in seconds (convert × 1000)
- Scroll events encoded as delta values
- Importer: `importers/recgaze-importer.js`
- Events extracted into `ScanpathData.events[]`

### 2.3 MIT1003 (Priority 3)

**Why third:** Most widely benchmarked for saliency validation (Experiment D). Natural images at 1024×768.

- Source: MATLAB `.mat` files with fixation arrays
- **Python converter:** `scripts/convert-scanpath-mat.py`
  - Reads `.mat` via `scipy.io.loadmat`
  - Outputs JSON matching `ScanpathData` schema
  - Usage: `python scripts/convert-scanpath-mat.py --input fixations/ --output scanpaths/mit1003/`
- JS importer reads converted JSON: `importers/mit1003-importer.js`

### 2.4 FixaTons

- Source: NumPy `.npy` arrays via the `fixatons` Python package
- Y-axis inverted (flip: `y = stimulusHeight - y`)
- Time in seconds → convert to ms
- **Python converter:** `scripts/convert-fixatons.py`
  - Uses `fixatons` API to enumerate scanpaths
  - Outputs JSON per stimulus
- JS importer reads converted JSON: `importers/fixatons-importer.js`

### 2.5 OneStop

- Source: EyeLink ASCII CSV with fixation reports
- Coordinates in pixels, durations in ms
- Timing reconstructed by accumulating fixation durations + estimated saccade durations
- Importer: `importers/onestop-importer.js`

### 2.6 Coordinate Normalization Utility

**File:** `renderer/scanpath/coordinate-utils.js`

Shared functions used by all importers to convert dataset coordinates to canvas physical pixels:

```js
/**
 * Convert normalized 0-1 coordinates to physical canvas pixels.
 * @param {number} nx - Normalized x (0-1)
 * @param {number} ny - Normalized y (0-1)
 * @param {number} canvasWidth - Physical canvas width
 * @param {number} canvasHeight - Physical canvas height
 * @returns {{ x: number, y: number }}
 */
function normalizedToPixels(nx, ny, canvasWidth, canvasHeight)

/**
 * Scale stimulus-space pixels to canvas pixels.
 * Accounts for stimulus/canvas size ratio and devicePixelRatio.
 * @param {number} sx - Stimulus pixel x
 * @param {number} sy - Stimulus pixel y
 * @param {number} stimW - Original stimulus width
 * @param {number} stimH - Original stimulus height
 * @param {number} canvasW - Canvas physical width
 * @param {number} canvasH - Canvas physical height
 * @returns {{ x: number, y: number }}
 */
function stimulusToCanvas(sx, sy, stimW, stimH, canvasW, canvasH)

/**
 * Convert degrees of visual angle to pixels.
 * Requires viewing distance and screen geometry.
 * @param {number} degX - Horizontal degrees
 * @param {number} degY - Vertical degrees
 * @param {number} viewingDistanceCm
 * @param {number} screenWidthCm
 * @param {number} screenWidthPx - Physical pixel width
 * @returns {{ x: number, y: number }}
 */
function degreesToPixels(degX, degY, viewingDistanceCm, screenWidthCm, screenWidthPx)
```

---

## 3. ScanpathPlayer Class

**File:** `renderer/scanpath-player.js`

Drop-in replacement for `GazeModel` that replays imported scanpath data through the pipeline.

### Interface (GazeModel-compatible)

```js
class ScanpathPlayer {
    constructor(config, canvas) { ... }

    // ── GazeModel interface ────────────────────────────────
    handleMouseMove(event) { }   // no-op stub
    update(now) → { isSaccading }
    getPosition() → { x, y }
    getVelocity() → float       // px/ms
    getScale() → { scaleX, scaleY }

    // ── Playback API ───────────────────────────────────────
    load(scanpathData)           // ScanpathData object
    play()
    pause()
    step(n)                      // advance n fixations
    seek(timeMs)                 // jump to absolute time
    reset()                      // rewind to start
    setSpeed(multiplier)         // 0.5x, 1x, 2x, etc.
    getProgress() → {
        currentTime,             // ms into playback
        totalDuration,           // total scanpath duration
        fixationIndex,           // current fixation index
        totalFixations,          // fixation count
        state                    // "playing"|"paused"|"complete"
    }
}
```

### Saccade Interpolation

Between fixations, the player generates smooth saccadic trajectories using the **minimum-jerk profile** (Flash & Hogan 1985):

```
s(t) = 10t³ - 15t⁴ + 6t⁵     where t ∈ [0, 1]
```

This produces a bell-shaped velocity profile matching biological saccades — acceleration from zero, peak mid-flight, deceleration to zero at the new fixation.

**Saccade duration estimation:** If the dataset provides explicit inter-fixation gaps (`tEnd[i]` to `tStart[i+1]`), use those durations. Otherwise, insert synthetic saccades using the main sequence relationship (Bahill et al. 1975):

```
duration_ms = 2.2 × amplitude_deg + 21
```

Where `amplitude_deg` is the Euclidean distance between fixation centers converted to degrees of visual angle. This requires `viewingDistanceCm` and `screenWidthCm` in the metadata; if unavailable, fall back to a fixed 50ms saccade.

### Velocity Reporting

During fixation: velocity = 0 (or near-zero drift if microsaccade simulation is added later).

During saccade: velocity derived from the minimum-jerk trajectory's first derivative. The peak velocity for a given amplitude follows the main sequence: `peak_vel ≈ amplitude_deg × 500 deg/s` (Bahill et al. 1975).

This velocity feeds `scrutinizer.js:354` and drives saccadic suppression in the LGN shader stage when `velocity > saccadicSuppressionThreshold`.

### Integration Point

In `scrutinizer.js` constructor (~line 74), before the existing `GazeModel` instantiation:

```js
// ── Module Initialization ────────────────────────────────
// GazeModel: Oculomotor system proxy (mouse tracking, velocity, saccade detection)
if (config.scanpathReplay) {
    this.gazeModel = new ScanpathPlayer(this.config, this.canvas);
    this.gazeModel.load(config.scanpathData);
} else {
    this.gazeModel = new GazeModel(this.config, this.canvas);
}
```

No other changes to the render loop — `update(now)`, `getPosition()`, `getVelocity()` work identically.

---

## 4. CLI Replay & Video Recording

### Subcommand

```
scrutinizer-audit replay <scanpath-file> [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--url <url>` | Page to load and render | required |
| `--dataset <name>` | Importer to use: `ueyes\|recgaze\|mit1003\|fixatons\|onestop` | auto-detect from file |
| `--mode <mode-name>` | Scrutinizer aesthetic mode from `modes.json` | `"highkey"` |
| `--speed <multiplier>` | Playback speed multiplier | `1.0` |
| `--video` | Record output video | `false` |
| `--video-format <fmt>` | `mp4\|webm` | `webm` |
| `--output <path>` | Output file/directory | `./output/` |
| `--frames` | Save PNG per fixation | `false` |
| `--fixation-overlay` | Draw fixation markers + saccade paths | `false` |
| `--width <px>` | Viewport width | `1512` |
| `--height <px>` | Viewport height | `982` |

### Architecture

Must use **Electron** (not Playwright/Puppeteer) for full WebGL pipeline access. Launch in offscreen mode matching `tests/run-test.js` pattern:

```js
const win = new BrowserWindow({
    show: false,
    webPreferences: {
        offscreen: true,
        nodeIntegration: true,
        contextIsolation: false
    }
});
```

### IPC Protocol

| Direction | Channel | Payload |
|-----------|---------|---------|
| Main → Renderer | `scanpath:load` | `{ scanpathData, mode, options }` |
| Main → Renderer | `scanpath:play` | `{ speed }` |
| Main → Renderer | `scanpath:pause` | — |
| Main → Renderer | `scanpath:seek` | `{ timeMs }` |
| Renderer → Main | `scanpath:progress` | `{ currentTime, fixationIndex, totalFixations }` |
| Renderer → Main | `scanpath:fixation` | `{ index, x, y, duration }` |
| Renderer → Main | `scanpath:complete` | `{ totalDuration, fixationCount }` |

### Video Recording

Adapt Psychodeli+'s `VideoRecorder` (`~/Documents/dev/psychodeli-webgl-port/js/lib/video-recorder.js`) pattern:

```js
const stream = canvas.captureStream(60);  // 60 fps
const recorder = new MediaRecorder(stream, {
    mimeType: 'video/webm; codecs=vp9',
    videoBitsPerSecond: 8_000_000
});

const chunks = [];
recorder.ondataavailable = e => chunks.push(e.data);
recorder.onstop = () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    // Write to disk via Node fs (Electron renderer has access)
};
```

For MP4 output: record WebM first, then transcode via `ffmpeg` if available (warn if not installed).

**New file:** `cli/lib/replay-runner.js`

### Per-Fixation Frame Capture

When `--frames` is set, capture a PNG at each fixation midpoint:

```
output/
  frame_000_fixation_0345ms.png
  frame_001_fixation_0890ms.png
  ...
```

Uses `canvas.toDataURL('image/png')` → write via Node `fs`.

---

## 5. Validation Experiments

Each experiment module in `tests/validation/experiments/`, run via:

```
node tests/validation/run-validation.js --experiment <name>
```

All experiments share a common harness that loads a scanpath, configures the renderer, replays the scanpath, and captures per-frame metrics at specified eccentricity bands.

### Eccentricity Band Framework

Metrics are computed in concentric bands around the current fixation point:

| Band | Eccentricity | Biological Region |
|------|-------------|-------------------|
| 0 | 0–2° | Fovea |
| 1 | 2–5° | Parafovea |
| 2 | 5–10° | Near periphery |
| 3 | 10–15° | Mid periphery |
| 4 | 15–20° | Far periphery |

Band boundaries in pixels are computed from the display's `px_per_deg` (see FOV table in arxiv paper, §2 Foveal Calibration).

### Experiment A: DoG vs Gaussian Blur (Spatial Structure Preservation)

**Hypothesis:** DoG frequency-selective filtering preserves more low-frequency peripheral structure than equivalent-bandwidth Gaussian blur.

**Setup:**
- Stimuli: reference pages + UEyes web stimuli
- Conditions: DoG mode (`highkey`) vs legacy Gaussian blur
- Replay: UEyes scanpaths (same scanpath for both conditions)

**Metrics at 5°/10°/15°/20° eccentricity bands:**
- SSIM (full-spectrum)
- Low-frequency SSIM (4-cpd lowpass before comparison)
- Edge preservation index (Canny edge overlap ratio)

**Expected outcome:** DoG shows higher low-frequency SSIM at all eccentricities (preserves coarse structure), comparable high-frequency SSIM (both remove fine detail peripherally).

**File:** `tests/validation/experiments/dog-vs-gaussian.js`

### Experiment B: Chromatic Pooling Accuracy (castleCSF vs Psychophysics)

**Hypothesis:** Per-channel RG/YV castleCSF decay matches published chromatic sensitivity curves (Mullen & Kingdom 2002).

**Setup:**
- Stimuli: `color-spectrum.html`, `color-search.html`
- Conditions: castleCSF on vs uniform desaturation vs Bowers 2025 adjusted values

**Metrics at 5°/10°/15°/20° eccentricity:**
- Oklab `a` attenuation (RG decay curve)
- Oklab `b` attenuation (YV decay curve)
- RMS error against Mullen 2002 reference curves:
  - RG: 50% sensitivity at ~5° eccentricity
  - YV: 50% sensitivity at ~26° eccentricity
- CIEDE2000 color difference at each eccentricity

**Expected outcome:** castleCSF tracks psychophysical data within RMS < 0.1; Bowers adjustment shows less mid-periphery RG attenuation (flatter slope beyond ~40°, per Bowers 2025).

**File:** `tests/validation/experiments/chromatic-pooling.js`

### Experiment C: Congestion Gating (Clutter-Selective Degradation)

**Hypothesis:** Mode 9 (congestion-gated pooling) produces stronger attenuation in cluttered regions than sparse regions, while non-gated modes apply uniform attenuation.

**Setup:**
- Stimuli: `dashboard.html` (mixed density), `article.html` (text vs margin)
- Conditions: `congestion_pooling` mode vs `highkey` mode
- Segment each frame by congestion map values into high-congestion (>0.6) and low-congestion (<0.3) regions

**Metrics:**
- SSIM in high-congestion peripheral regions
- SSIM in low-congestion peripheral regions
- Key metric: `SSIM_low - SSIM_high` gap (higher = more selective degradation)

**Expected outcome:** The gap is larger with congestion gating than with highkey mode. Congestion gating preserves sparse regions while degrading cluttered regions more aggressively.

**File:** `tests/validation/experiments/congestion-gating.js`

### Experiment D: Saliency Prediction (Fixation Location)

**Hypothesis:** Scrutinizer's DOM+Oklab saliency map predicts UEyes fixation locations above chance.

**Setup:**
- Extract saliency map texture from renderer for each UEyes stimulus
- Compute saliency value at each recorded fixation location
- Compare against uniform random baseline and center-bias model

**Metrics:**
- **AUC-Judd** — Area under ROC curve (fixation locations as positives, uniform sampling as negatives)
- **NSS** (Normalized Scanpath Saliency) — Mean saliency at fixation locations, normalized by saliency map mean/std
- **Information Gain** — Bits above center-bias model

**Channel decomposition:**
- Oklab color DoG (bottom-up)
- Face detection (bottom-up)
- DOM structure (top-down)
- Test whether DOM channel adds incremental AUC beyond bottom-up alone

**Expected outcome:** AUC > 0.7 (above chance 0.5, below state-of-the-art DeepGaze II ~0.87). DOM channel should add 0.03-0.05 AUC on web stimuli where interactive elements drive fixations.

**File:** `tests/validation/experiments/saliency-prediction.js`

**Priority:** This is the lowest-cost, highest-signal experiment. Only requires saliency map extraction + fixation coordinate lookup — no per-frame rendering comparison. Start here.

---

## 6. CI Pipeline Integration — Automated Attention Auditing

*Concept contributed by Matt Queen, drawing on his work with icon discrimination
and industrial interface evaluation.*

### Motivation

Scrutinizer's pipeline already answers "where does the eye go?" for any web page.
The next step is embedding that answer into a build or release pipeline so teams can
track visual attention regressions the same way they track performance regressions.

This matters most for **industrial UI** — dashboards, control panels, analyst
workbenches — where the number of competing attention targets is high and the
cost of missing a critical element is real. Consumer UI benefits too, but
industrial UI is where frequency-based scoring has the clearest payoff because
the stimulus is dense and the task structure is well-defined.

### How it works

```
commit/PR → headless Scrutinizer → saliency + congestion maps → ROI scoring → report
```

1. **Trigger**: A CI step (GitHub Action, Jenkins stage, etc.) launches Scrutinizer
   in headless mode against one or more target URLs or local screenshots.
2. **ROI identification**: Scrutinizer scores each region using a combination of:
   - Frequency-domain energy (DoG band weights — already computed)
   - Congestion / clutter score (Feature Congestion metric)
   - DOM-aware element scoring (interactive elements, data displays, alerts)
   - Optional: face detection, motion onset for animated UI
3. **Report generation**: A JSON report listing identified ROIs ranked by predicted
   attention draw, with coordinates, scores, and thumbnails.
4. **Expected-ROI manifest**: Teams maintain a `scrutinizer-expected.json` that
   declares which elements *should* draw attention and their relative priority:
   ```json
   {
     "page": "ops-dashboard",
     "expected_rois": [
       { "label": "alert-banner", "selector": "#alert-banner", "priority": 1 },
       { "label": "kpi-grid",     "selector": ".kpi-grid",     "priority": 2 },
       { "label": "nav-sidebar",  "selector": "nav.sidebar",   "priority": 5 }
     ],
     "tolerance": 0.15
   }
   ```
5. **Offset measurement**: The report compares predicted attention rank against
   expected rank, flagging elements whose offset exceeds the tolerance threshold.
   A sidebar that jumps from priority 5 to predicted rank 1 after a redesign is a
   regression — it's stealing attention from the alert banner.

### ROI identification strategy

This is the core puzzle. Three complementary approaches:

| Strategy | Signal | Best for |
|----------|--------|----------|
| **Frequency scoring** | DoG band energy in pooling regions | Dense displays, data tables |
| **Congestion mapping** | Feature Congestion / Subband Entropy | Cluttered layouts, competing elements |
| **DOM structure** | Element type, size, color contrast, interactivity | Web apps with semantic markup |

The frequency approach reuses existing pipeline output — the per-band weights that
`sampleDoGReconstructed` computes are already a spatial frequency decomposition.
Regions with high energy in the mid-frequency bands (edges, text) that *also* have
high local contrast relative to surround are strong ROI candidates.

### CLI interface

```bash
# Generate attention audit report
scrutinizer audit --url https://internal-dashboard.example.com \
                  --expected scrutinizer-expected.json \
                  --output audit-report.json

# CI mode: exit non-zero if any ROI offset exceeds tolerance
scrutinizer audit --url https://internal-dashboard.example.com \
                  --expected scrutinizer-expected.json \
                  --ci --fail-on-regression
```

### Output format

```json
{
  "timestamp": "2026-03-10T...",
  "url": "https://internal-dashboard.example.com",
  "viewport": { "width": 1920, "height": 1080 },
  "predicted_rois": [
    { "rank": 1, "label": "alert-banner", "score": 0.87, "bbox": [100, 20, 800, 60] },
    { "rank": 2, "label": "kpi-grid",     "score": 0.72, "bbox": [100, 80, 800, 400] }
  ],
  "regressions": [],
  "pass": true
}
```

### Priority

This sits downstream of the core scanpath replay infrastructure. The saliency
prediction experiment (5D) provides the scoring foundation; the CLI replay
framework (phase 5) provides the headless execution model. Target: phase 8,
after the validation suite.

---

## 7. Priority Order

| Phase | Work | Rationale |
|-------|------|-----------|
| 1 | Common format + UEyes importer | Simplest CSV, web stimuli, enables all downstream work |
| 2 | ScanpathPlayer class | Core playback engine, drives everything else |
| 3 | Experiment D (saliency prediction) | Lowest implementation cost, highest scientific signal |
| 4 | RecGaze importer | Interactive events for interaction-aware testing |
| 5 | CLI replay + video recording | Automation, demo generation |
| 6 | MIT1003 importer + Python converter | Saliency benchmarking (most-cited dataset) |
| 7 | Experiments A, B, C | Full validation suite |
| 8 | CI pipeline audit (§6) | Requires saliency scoring + CLI headless; concept by Matt Queen |

---

## 8. File Manifest

### New Files

| File | Purpose |
|------|---------|
| `renderer/scanpath/scanpath-types.js` | Type documentation + JSDoc typedefs |
| `renderer/scanpath/coordinate-utils.js` | Coordinate normalization utilities |
| `renderer/scanpath/importers/ueyes-importer.js` | UEyes dataset parser |
| `renderer/scanpath/importers/recgaze-importer.js` | RecGaze dataset parser |
| `renderer/scanpath/importers/mit1003-importer.js` | MIT1003 JSON reader |
| `renderer/scanpath/importers/fixatons-importer.js` | FixaTons JSON reader |
| `renderer/scanpath/importers/onestop-importer.js` | OneStop dataset parser |
| `renderer/scanpath-player.js` | GazeModel-compatible scanpath replayer |
| `scripts/convert-scanpath-mat.py` | MATLAB → JSON converter for MIT1003 |
| `scripts/convert-fixatons.py` | FixaTons → JSON converter |
| `cli/lib/replay-runner.js` | CLI replay orchestrator |
| `tests/validation/run-validation.js` | Validation experiment runner |
| `tests/validation/experiments/dog-vs-gaussian.js` | Experiment A |
| `tests/validation/experiments/chromatic-pooling.js` | Experiment B |
| `tests/validation/experiments/congestion-gating.js` | Experiment C |
| `tests/validation/experiments/saliency-prediction.js` | Experiment D |
| `cli/lib/audit-runner.js` | CI attention audit orchestrator |
| `cli/lib/roi-scorer.js` | ROI identification from saliency + congestion + DOM |

### Modified Files

| File | Change |
|------|--------|
| `renderer/scrutinizer.js` | Conditional `ScanpathPlayer` instantiation (~line 74) |

---

## References

- Bahill, A. T., Clark, M. R., & Stark, L. (1975). The main sequence, a tool for studying human eye movements. *Mathematical Biosciences*, 24(3-4), 191-204.
- Blauch, N. M., Bao, P., Konkle, T., & Alvarez, G. A. (2026). FOVI: Foveated vision models for spatial resolution and receptive field asymmetries.
- Flash, T., & Hogan, N. (1985). The coordination of arm movements: an experimentally confirmed mathematical model. *Journal of Neuroscience*, 5(7), 1688-1703.
- Mullen, K. T., & Kingdom, F. A. (2002). Differential distributions of red-green and blue-yellow cone opponency across the visual field. *Visual Neuroscience*, 19(1), 109-118.
- Rosenholtz, R. (2012). Summary statistics and pooling regions. In *Oxford Handbook of Perceptual Organization*.
