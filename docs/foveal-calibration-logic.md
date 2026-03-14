# Foveal Calibration Logic

This document details the psychophysical methodology used in the Scrutinizer Foveal Calibration tool.

## 1. Core Principle: Peripheral Motion Silence
The calibration relies on the **Motion Silence Illusion**. A field of objects (rotating crosses) appears to be static when viewed in the periphery, even though they are continuously rotating. This effect occurs because the peripheral visual system has lower spatial resolution and temporal sensitivity for specific types of crowding.

- **Foveal Vision**: High resolution. Can resolve individual rotating crosses.
- **Peripheral Vision**: Low resolution. Crosses crowd together; the rotation signal is lost or "silenced," appearing as static noise.

By adjusting the radius of the "silence zone," we can map the boundary of the user's high-acuity foveal/parafoveal region.

## 2. Visual Stimulus
- **Elements**: Tiny, rotating crosses (Arm length: 3 units).
- **Density**: High density (Spacing: 19 units) to force crowding effects.
- **Distribution**: **Golden Ratio** spiral distribution to ensure uniform coverage without perceivable grid patterns.
- **Layers**: 8 overlapping layers to create depth and complexity.
- **Color**: Heterogeneous palette generated using a **Nimitz Shader** algorithm (sinusoidal RGB phase shifts) to ensure broad spectral activation.
- **Cue**: A central cursor acts as the fixation target. It glows blue to signal the "attend" phase.

## 3. Interaction Protocol: Forced-Choice Staircase
We use a modified **Staircase Procedure** to converge on the user's threshold.

### The Cycle
1.  **Fixation**: User stares at the central cursor.
2.  **Motion Event**: At a random interval (variable start time), the entire field pauses (stops rotating).
3.  **Reaction**: The user must press **SPACEBAR** as soon as they detect the cessation of motion (or the resumption of motion).
4.  **Feedback**: The system validates the reaction time (RT) relative to the event window.

### Reaction Window
- **Duration**: 1.5 seconds.
- **Purpose**: A tight window forces rapid decision-making, increasing the pressure to create a valid $d'$ signal (separating true hits from false alarams).

### Latency-Weighted Scoring
Unlike standard binary (Hit/Miss) tasks, we weigh the magnitude of the threshold adjustment by the user's **Reaction Time (RT)**.

| RT Range | Classification | Logic | Adjustment |
| :--- | :--- | :--- | :--- |
| **< 500ms** | **Too Fast** | Likely anticipation or checking (False Alarm risk). | Small Penalty (-5px) or Ignore. |
| **500 - 1000ms** | **Fast Hit** | Motion detected, but signal might be ambiguous during ramp-up. | Standard Increase (+24px). |
| **1000 - 2000ms** | **Clear Hit** | The "Sweet Spot". Motion was clearly resolved. | **Speed Bonus**: Increase radius by `30 + (2000-RT)/50` (up to +50px). |
| **> 2000ms** | **Weak Signal** | User barely noticed the event. | Decrease Radius (-10px) to verify threshold. |
| **Timeout** | **Miss** | Signal was invisible (Motion Silence/Crowding effective). | Decrease Radius (-10px). |

## 4. Convergence & Termination
The system tracks **reversals** (points where the staircase changes direction from "increasing" to "decreasing" or vice versa).

- **Standard Termination**: 8 Reversals.
- **Smart Stablity**: If the range of the last 5 reversals is small (< 30px), confidence is set to 100% and the task terminates early.
- **Confidence Score**: A calculated % based on the number of reversals and the stability of the variance.

## 5. Artifacts
The tool generates a session history graph displaying:
- **X-Axis**: Trial Number
- **Y-Axis**: Radius (px)
- **Data Points**: Color-coded Hits/Misses with vertical error bars representing Reaction Time magnitude.

---

## 6. Robustness Mitigations (v1.3)

## 7. Calibration Reference: Foveal Size by Hardware

The fovea subtends a fixed angular diameter (~2°) regardless of screen. What changes is how many pixels that maps to, which depends on screen size, resolution, scaling factor, and viewing distance.

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
| Fovea radius (1°) | **45 CSS px** |
| Fovea diameter | 178 CSS px |
| Horizontal half-field | ~16.8° |
| Full screen diagonal | ~37° |

### MacBook Pro M3 (16-inch)

| Parameter | Value |
|-----------|-------|
| Native resolution | 3456 × 2234 |
| CSS resolution (2x) | 1728 × 1117 |
| Screen width | 13.6" (34.5cm) |
| Typical viewing distance | 18-22" (46-56cm) |
| px/deg @ 20" (50.8cm) | **44 CSS px** |
| Fovea radius (1°) | **45 CSS px** |
| Fovea diameter | 178 CSS px |
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
| Fovea diameter | 152 CSS px |
| Horizontal half-field | ~23.8° |
| Full screen diagonal | ~48° |

### Desktop Reference (27" 4K, 2x scaling)

| Parameter | Value |
|-----------|-------|
| Native resolution | 3840 × 2160 |
| CSS resolution (2x) | 1920 × 1080 |
| Screen width | 23.5" (59.8cm) |
| Typical viewing distance | 24-28" (60-70cm) |
| px/deg @ 26" (66cm) | **37 CSS px** |
| Fovea radius (1°) | **37 CSS px** |
| Fovea diameter | 148 CSS px |
| Horizontal half-field | ~24.3° |
| Full screen diagonal | ~50° |

### Current Default vs Reality

The default `foveaRadius: 45px` maps to a ~1° foveal radius on both MBP models, matching the anatomical fovea. This means:
- `normEcc` (used by DoG, chromatic pooling, crowding) scales correctly from the foveal edge
- Viewport edges reach ~19-24° eccentricity
- Peripheral effects are appropriately attenuated

See ROADMAP "Calibrated Visual Angles" for the planned fix: separating `px_per_deg` (calibration) from `foveaRadius` (comfort zone).

---

### Pop-Out Prevention
**Risk**: Cessation of motion might act as a "pop-out" cue if crosses stop in an aligned grid, creating a sudden regular pattern detectable even in periphery.

**Mitigation**:
- **Randomized Rotation Phases**: Each cross has a unique initial phase: `phase = seededRandom(seed + 100) * Math.PI * 2` (line 177)
- **Golden Ratio Distribution**: Crosses are positioned using Golden Ratio spiral (`offsetX/Y = (layer * goldenRatio) % 1 * spacing`), ensuring non-grid, low-discrepancy distribution
- **Multi-Layer Depth**: 15 overlapping layers with different offsets prevent any single "freeze frame" from creating a regular pattern

**Result**: When motion stops, crosses freeze at random angles in a quasi-random spatial distribution, eliminating grid-based pop-out cues.

### Anticipation Prevention
**Risk**: Users might learn the timing and anticipate motion events, reducing $d'$ signal validity.

**Mitigation**:
- **Wide ISI Randomization**: Inter-Stimulus Interval randomized over 2000-5000ms range (3000ms variance)
- **Variable Reaction Window**: 1.5s window creates time pressure, preventing "wait and guess" strategies
- **Latency-Weighted Scoring**: RT <500ms triggers "Too Fast" penalty, discouraging anticipatory responses

**Result**: Unpredictable event timing forces genuine perceptual detection rather than learned timing patterns.
