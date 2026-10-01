# Foveal Calibration Logic

This document details the psychophysical methodology used in the Scrutinizer Foveal Calibration tool.

## 1. Core Principle: Peripheral Motion Silence
The calibration relies on an effect the tool calls **Motion Silence**: a dense field of tiny rotating crosses looks nearly static in the periphery even though the crosses keep rotating. The working explanation is crowding. Peripheral vision cannot resolve the orientation of small, closely spaced elements, so their rotation produces little visible change. The name is the tool's own label. Suchow & Alvarez (2011, *Current Biology*, doi:10.1016/j.cub.2010.12.019) use "motion silencing" for a different effect, in which motion suppresses awareness of changes in an object's color, luminance, size or shape.

- **Foveal Vision**: High resolution. Can resolve individual rotating crosses.
- **Peripheral Vision**: Low resolution. Crosses crowd together; the rotation signal is lost or "silenced," appearing as static noise.

By adjusting the radius of the "silence zone," we can map the boundary of the user's high-acuity foveal/parafoveal region.

## 2. Visual Stimulus
- **Elements**: Tiny, rotating crosses (Arm length: 3 units).
- **Density**: High density (Spacing: 19 units) to force crowding effects.
- **Distribution**: Each layer's grid is offset by a **golden-ratio** step, with small random jitter per cross, to ensure uniform coverage without perceivable grid patterns.
- **Layers**: 15 overlapping layers to create depth and complexity.
- **Color**: Heterogeneous palette generated using a **Nimitz Shader** algorithm (sinusoidal RGB phase shifts) to ensure broad spectral activation.
- **Cue**: A central cursor acts as the fixation target. It glows blue to signal the "attend" phase.

## 3. Interaction Protocol: Forced-Choice Staircase
We use a modified **Staircase Procedure** to converge on the user's threshold.

### The Cycle
1.  **Fixation**: User stares at the central cursor.
2.  **Motion Event**: After a random inter-stimulus interval (2–5 s), the crosses outside the current test radius stop rotating; crosses inside it keep rotating. After a further random 0–2 s the outer field starts rotating again, with an 800 ms ease-in.
3.  **Reaction**: The user presses **SPACEBAR** as soon as they detect the outer field moving again. A press outside the reaction window counts as a false alarm and gets feedback only.
4.  **Feedback**: The system scores the reaction time (RT), measured from the restart of motion, within the event window.

### Reaction Window
- **Duration**: 1.5 seconds, opening when motion restarts.
- **Purpose**: A tight window forces rapid decisions and limits late presses that could be guesses, which keeps hits separable from false alarms.

### Latency-Weighted Scoring
Each threshold adjustment is weighted by the user's **Reaction Time (RT)**, in addition to the binary hit/miss outcome. A hit moves the boundary outward (harder); a miss moves it inward.

| RT Range | Classification | Logic | Adjustment |
| :--- | :--- | :--- | :--- |
| **< 150ms** | **Too Fast** | Physiologically improbable; likely anticipation. | Small penalty (-5px). |
| **150 - 1000ms** | **Clear Hit** | Motion detected promptly. | Increase radius (+30px). |
| **1000 - 2000ms** | **Hit** | Slower detection. | Increase radius (+15px). |
| **≥ 2000ms** | **Weak Hit** | Not reachable with the 1.5 s window. | Increase radius (+5px). |
| **Timeout** | **Miss** | Signal was invisible (Motion Silence/Crowding effective). | Decrease radius by 10-20px (10px plus random 0-10px). |

## 4. Convergence & Termination
The system tracks **reversals** (points where the staircase changes direction from "increasing" to "decreasing" or vice versa).

- **Standard Termination**: 8 Reversals.
- **Smart Stability**: If the range of the last 5 reversals is small (< 30px), confidence is set to 100% and the task terminates early.
- **Confidence Score**: A calculated % based on the number of reversals and the stability of the variance.

## 5. Artifacts
The tool generates a session history graph displaying:
- **X-Axis**: Trial Number
- **Y-Axis**: Radius (px)
- **Data Points**: Color-coded Hits/Misses with vertical error bars representing Reaction Time magnitude.

---

## 6. Robustness Mitigations (v1.3)

### Pop-Out Prevention
**Risk**: Cessation of motion might act as a "pop-out" cue if crosses stop in an aligned grid, creating a sudden regular pattern detectable even in periphery.

**Mitigation**:
- **Randomized Rotation Phases**: Each cross has a unique initial phase: `phase = seededRandom(seed + 100) * Math.PI * 2` (scrutinizer-www `src/js/foveal-calibration.js`)
- **Golden Ratio Distribution**: Each layer's grid is offset by a golden-ratio step (`offsetX = (layer * goldenRatio) % 1 * spacing`, `offsetY` with `2 * goldenRatio`), ensuring non-grid, low-discrepancy distribution
- **Multi-Layer Depth**: 15 overlapping layers with different offsets prevent any single "freeze frame" from creating a regular pattern

**Result**: When motion stops, crosses freeze at random angles in a quasi-random spatial distribution, eliminating grid-based pop-out cues.

### Anticipation Prevention
**Risk**: Users might learn the timing and anticipate motion events, producing hits without detection.

**Mitigation**:
- **Wide ISI Randomization**: Inter-Stimulus Interval randomized uniformly over 2000-5000ms
- **Fixed Reaction Window**: 1.5s window creates time pressure, preventing "wait and guess" strategies
- **Latency-Weighted Scoring**: RT <150ms triggers "Too Fast" penalty, discouraging anticipatory responses

**Result**: Event timing is unpredictable, so a well-timed response requires detecting the motion.

---

## 7. Calibration Reference: Foveal Size by Hardware

The fovea subtends a fixed angular diameter (~2°) regardless of screen. The number of pixels it covers depends on screen size, resolution, scaling factor, and viewing distance.

**Formula:**
```
px_per_deg = (resolution_css / screen_width_cm) × 2 × D_cm × tan(0.5°)
fovea_radius_px = px_per_deg × 1.0   (for 1° foveal radius)
```

Where `D_cm` is viewing distance in cm, `resolution_css` is CSS pixels (native ÷ devicePixelRatio).

### MacBook Pro M3 (14-inch)

| Parameter | Value |
|-----------|-------|
| Native resolution | 3024 × 1964 |
| CSS resolution (2x) | 1512 × 982 |
| Screen width | 12.1" (30.7cm) |
| Typical viewing distance | 18-22" (46-56cm) |
| px/deg @ 20" (50.8cm) | **44 CSS px** |
| Fovea radius (1°) | **44 CSS px** |
| Fovea diameter | 87 CSS px |
| Horizontal half-field | ~16.8° |
| Full screen diagonal | ~40° |

### MacBook Pro M3 (16-inch)

| Parameter | Value |
|-----------|-------|
| Native resolution | 3456 × 2234 |
| CSS resolution (2x) | 1728 × 1117 |
| Screen width | 13.6" (34.5cm) |
| Typical viewing distance | 18-22" (46-56cm) |
| px/deg @ 20" (50.8cm) | **44 CSS px** |
| Fovea radius (1°) | **44 CSS px** |
| Fovea diameter | 89 CSS px |
| Horizontal half-field | ~18.8° |
| Full screen diagonal | ~44° |

### Desktop Reference (24" 1080p)

| Parameter | Value |
|-----------|-------|
| Native resolution | 1920 × 1080 |
| Screen width | 20.9" (53.1cm) |
| Typical viewing distance | 22-26" (56-66cm) |
| px/deg @ 24" (60cm) | **38 CSS px** |
| Fovea radius (1°) | **38 CSS px** |
| Fovea diameter | 76 CSS px |
| Horizontal half-field | ~23.9° |
| Full screen diagonal | ~54° |

### Desktop Reference (27" 4K, 2x scaling)

| Parameter | Value |
|-----------|-------|
| Native resolution | 3840 × 2160 |
| CSS resolution (2x) | 1920 × 1080 |
| Screen width | 23.5" (59.8cm) |
| Typical viewing distance | 24-28" (60-70cm) |
| px/deg @ 26" (66cm) | **37 CSS px** |
| Fovea radius (1°) | **37 CSS px** |
| Fovea diameter | 74 CSS px |
| Horizontal half-field | ~24.4° |
| Full screen diagonal | ~55° |

### Current Default vs Reality

The default `foveaRadius: 45px` maps to a ~1° foveal radius on both MBP models, matching the anatomical fovea. This means:
- `normEcc` (used by DoG, chromatic pooling, crowding) scales correctly from the foveal edge
- Viewport edges reach ~19-24° eccentricity
- Peripheral effects are appropriately attenuated

See ROADMAP "Calibrated Visual Angles" for the planned fix: separating `px_per_deg` (calibration) from `foveaRadius` (comfort zone).
