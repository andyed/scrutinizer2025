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
