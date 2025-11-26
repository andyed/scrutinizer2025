# Scrutinizer Foveated Vision Model

This document explains how Scrutinizer simulates human foveal / peripheral vision, and how the underlying shader parameters map to the visual effect. It is intended for advanced users and developers who want to reason about (and eventually tune) the non‑foveal disruption profile.

---

## 1. Coordinate system and foveal radius

The WebGL renderer receives:

- `u_resolution`: canvas size in pixels.
- `u_mouse`: foveal center in pixels (canvas coordinates).
- `u_foveaRadius`: foveal radius in pixels.

In the fragment shader:

- Texture coordinates `uv` are corrected for aspect ratio and squashed in X to approximate an elliptical (16:9) foveal footprint.
- A normalized distance `dist` is computed from the foveal center in this corrected space.
- A normalized radius is defined as:
  
  - `radius_norm = u_foveaRadius / u_resolution.y`

This allows us to express all zones as **fractions of the configured foveal radius**, independent of actual pixel resolution.

Biologically, the fovea is approximately circular. For screen-based reading and 16:9 layouts, we deliberately apply an **elliptical aspect correction** so that the “usable” sharp region better matches the horizontally biased saccades you make across lines of text.

---

## 2. Three spatial zones

All non‑foveal processing is defined in terms of three concentric zones, expressed as multiples of `radius_norm`.

- **Fovea**  
  - Range: `0 → 1.0 × radius_norm`  
  - Visual: crystal‑clear, full color, no positional warping or jitter.

- **Parafovea**  
  - Range: `1.0 × radius_norm → 1.35 × radius_norm`  
  - Visual: increasing domain warp and high‑frequency jitter. Features are present but positions are uncertain (“heat‑haze crowding”).

- **Far periphery**  
  - Starts at: `1.2 × radius_norm` and beyond  
  - Visual: stronger warp/jitter, rod‑like desaturation and tint, and pixel scatter.

Key constants in the shader:

- `fovea_radius = radius_norm`
- `parafovea_radius = radius_norm * 1.35`
- `periphery_start = radius_norm * 1.2`

There is a deliberate **Transition Band** between `1.2 × radius_norm` and `1.35 × radius_norm` where parafoveal and periphery effects **overlap**. In this region, the “heat-haze” warp and the more aggressive “digital noise” / scatter coexist. This shared band removes a hard handoff between zones and prevents a visible seam at any single radius.

The **debug boundary overlay** is drawn exactly at `dist == fovea_radius`, so the visible grey ring matches the true edge of the sharp foveal zone.

---

## 3. Strength masks (distance → effect curves)

The shader defines several scalar “strength” values derived from the distance `dist`. These are smoothstep curves that go from 0 to 1 across a band of radii.

- **Warp strength** (positional warp envelope)
  - Formula: `warpStrength = smoothstep(fovea_radius, parafovea_radius, dist)`
  - Interpretation: 0 in the fovea, ramps up across the parafovea, and stays high into the periphery.

- **Chromatic aberration strength**
  - Uses a dithered distance: `distDithered = dist + noise * 0.3`.
  - Formula: `caStrength = smoothstep(periphery_start, periphery_start + 0.25, distDithered)`
  - Interpretation: chromatic splitting only beyond the near periphery. The added noise **breaks the perfectly geometric CA ring**, eliminating a “curtain effect” and creating an organic, ragged transition instead of a hard lens-filter edge.

- **Rod vision strength** (desaturation / tint / grain)
  - Formula: `rodStrength = smoothstep(fovea_radius, periphery_start, dist)`
  - Interpretation: begins just outside the fovea, increases through parafovea, and saturates into periphery.

- **Scatter strength** (pixelation envelope)
  - Formula: `scatterStrength = smoothstep(periphery_start, periphery_start + 0.2, dist)`
  - Interpretation: only active in far periphery, where the visual field becomes noisy and blocky.

Boolean helpers:

- `isParafovea = dist > fovea_radius && dist <= periphery_start`
- `isFarPeriphery = dist > periphery_start`

These flags are used to select different amplitudes for warp and jitter.

For intuition, you can think of each effect as a 1D curve over radius:

```text
Effect strength
1.0 |           _________ Rod Vision
    |          /
    |         /    _____ Scatter / Pixelation
    |        /    /
0.0 |_______/____/___________________________
     0.0   1.0  1.2   1.35               dist
        Fovea   Para   Transition → Periphery
```

---

## 4. Domain warping (positional uncertainty)

The shader models the growth of receptive field size with eccentricity using **domain warping**:

1. A coarse multi‑octave noise field (`warpVector`) is sampled in an aspect‑corrected space.
2. The amplitude of this warp is increased in the periphery but kept small and vertically “crushed” in the parafovea to preserve rough baselines and vertical strokes.
3. This warp is multiplied by `warpStrength` and the global intensity.

Intuition:

- In the parafovea, text looks like it is seen through shimmering heat haze.
- In the far periphery, letters collide and smear, but the image does not completely melt.

---

## 5. High‑frequency jitter (Bouma breaker)

To disrupt word‑shape (“Bouma”) recognition, the shader adds very high‑frequency jitter:

1. Fine‑scale noise is sampled on top of the warped coordinates.
2. Jitter amplitude ramps from subtle at the inner parafovea to aggressive at the outer parafovea.
3. In far periphery, jitter amplitudes are highest.

The final lookup position is:

- `newUV = uv + warpVector + jitterVector`

This combination ensures:

- Just outside the fovea, characters wobble enough to be hard to parse but not fully pixelated.
- Further out, both local letter structure and global word envelopes are heavily disrupted.

---

## 6. Chromatic aberration (lens split)

Chromatic aberration is modeled by sampling the warped position three times:

- Red sample: shifted slightly **toward** the fovea.
- Green sample: at the base warped position.
- Blue sample: shifted slightly **away** from the fovea.

The shift magnitude is:

- `aberrationAmt = 0.02 * caStrength * u_intensity * u_ca_strength`

This creates colored fringes in the periphery, supporting illegibility without needing extremely large blurs.

---

## 7. Rod vision: desaturation, contrast, grain, tint

Beyond the fovea, the shader gradually:

- Reduces saturation using an **exponential falloff** (`1.0 - sqrt(dist)`), making the far periphery effectively monochrome.
- Increases contrast.
- Adds high‑frequency grain.
- Applies a **"Eigengrau" (Brain Grey)** tint (cold dark blue) in darker regions.

This is blended based on both `rodStrength` and the local luminance, yielding a peripheral appearance that is:

- Cold, colorless, and grainy.
- Shifted towards a dark blue-grey, mimicking the lack of color data in the rod-dominated periphery.

---

## 8. Scrollbar preservation

A thin band near the right edge of the screen is excluded from peripheral processing, so operating system scrollbars and similar UI affordances remain sharp and usable.

- Region: approximately 17 px from the right edge.

This acts as a **Fitts's-law safe zone** for precise pointer targeting. The mask is currently a **hard cutoff** (inside this band, peripheral effects are disabled entirely). A future refinement could turn this into a short gradient band so that, under very strong distortion, the visual handoff into the safe zone is also perceptually smooth.

---

## 9. Debug boundary overlay

When enabled from the menu, the shader draws a subtle grey ring at the true foveal edge:

- Location: `dist == fovea_radius`.
- Purpose: visualization only – it does not change sampling or strength masks.

This allows you to align text or UI elements exactly at the transition between crystal‑clear and disrupted vision when evaluating presets.

---

## 10. Future tuning knobs

The current implementation hard‑codes the key ratios:

- `parafovea_radius / fovea_radius ≈ 1.35`
- `periphery_start / fovea_radius ≈ 1.2`

In future versions, these can be exposed as user‑tunable parameters by mapping UI sliders to:

- Zone boundaries:
  - Inner / outer parafovea extents.
  - Far‑periphery onset.
- Strength curves:
  - Warp and jitter amplitude envelopes by zone.
  - Rod strength onset and saturation.
  - Chromatic aberration strength.

Those sliders would effectively reshape the smoothstep curves described above, allowing different “profiles” of peripheral disruption while preserving the same underlying model.
