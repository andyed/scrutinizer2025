# Metamer Mode: Structure-Locked Peripheral Crowding

**Status:** Tier 2.5 shipped in v2.3.0 (WebGPU compute), default as of v2.3.0 re-release. Fragment-shader approach (V1 type 4) remains planned but deprioritized.
**Files:** `renderer/webgpu-crowding-compute.js`, `renderer/shaders/crowding-stats.wgsl`, `renderer/shaders/crowding-synth.wgsl`, `renderer/webgpu-probe.js`, `renderer/webgpu-safety.js`

## Motivation

Main's V1 distortion uses simplex noise to displace peripheral texels. This produces texture that looks distorted but doesn't look like *content*. Peripheral vision doesn't see noise — it sees **metamers**: textures that preserve certain summary statistics of the original while losing spatial arrangement (Rosenholtz 2012, Freeman & Simoncelli 2011).

The metamer branch demonstrated that a structure-map-locked grid with content-adaptive cell sizing, wobbly boundaries, and axis-biased displacement produces output that reads as "text I can't quite make out" rather than "blurry smeared pixels." That's closer to the subjective peripheral experience.

## Architecture

New V1 distortion type (`v1_distortion_type: 4`) sitting alongside existing types:

| Type | Name | Description |
|------|------|-------------|
| 0 | Noise scramble | Simplex noise displacement (current default) |
| 1 | Mongrel/shatter | Grid-based scramble |
| 2 | None | V1 bypass (blur only) |
| 3 | Pixelate | Block quantization |
| **4** | **Metamer** | **Structure-locked adaptive grid** |

## Algorithm

### Step 1: Content-Adaptive Grid

Grid cell frequency derived from structure map rhythm channel:

```glsl
float safeRhythm = max(effectiveRhythm, 0.02);  // min 2px line height
float vFreq = 1.0 / safeRhythm;   // vertical: matches text line spacing
float hFreq = vFreq / 0.35;        // horizontal: ~3x wider (word-width aspect ratio)
vec2 textFreq = vec2(hFreq, vFreq);
vec2 fallbackFreq = vec2(20.0);    // uniform grid for non-text regions

float isTextSignal = smoothstep(0.005, 0.02, effectiveRhythm);
vec2 cellFreq = mix(fallbackFreq, textFreq, isTextSignal);
```

Text regions get a grid matched to actual typography. Image regions get uniform cells. The smooth blend prevents hard seams.

### Step 2: Eccentricity-Scaled Cells (Bouma Zone)

Grid cells grow with eccentricity, matching Bouma's critical spacing:

```glsl
float eccentricity = max(0.0, dist - fovea_radius);
float logScale = 1.0 / (1.0 + eccentricity * 2.0);
vec2 effectiveGrid = cellFreq * logScale;
```

Near-foveal cells are small (fine scramble). Far-peripheral cells are large (coarse pooling). The `logScale` factor compresses the grid logarithmically — matching cortical magnification's log-polar mapping.

### Step 3: Wobbly Grid (Organic Boundaries)

Simplex noise phase shifts break rectilinear grid lines into organic cell boundaries:

```glsl
vec2 wobble = vec2(
    snoise(uv.yx * 8.0),   // Y-driven X-shift: breaks vertical lines
    snoise(uv.xy * 8.0)    // X-driven Y-shift: breaks horizontal lines
) * 2.5;

vec2 gridUV = vec2(uv_corrected.x * effectiveGrid.x, uv.y * effectiveGrid.y) + wobble;
vec2 gridID = floor(gridUV);
```

This is the "chicken wire" effect — each cell boundary meanders organically instead of cutting straight through content. Critical for perceptual plausibility.

### Step 4: Stable Hash Jitter

Each grid cell gets a deterministic displacement via a hash function:

```glsl
vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
vec2 jitter = hash2(gridID);
```

Stable across frames (no temporal flicker). Content chunks stay in their displaced positions until gaze moves.

### Step 5: Axis Bias

Displacement weighted by content type (see axis bias TODO below):

```glsl
vec2 axisBias = (type > 0.8)
    ? vec2(1.8, 0.15)   // text: strong horizontal, minimal vertical
    : vec2(0.8, 0.8);   // image: isotropic
```

### Step 6: Micro-Turbulence

High-frequency continuous warp inside grid cells prevents chunks from looking crisp:

```glsl
vec2 microWarp = vec2(
    snoise(uv * 30.0),
    snoise(uv * 30.0 + 12.5)
);
displacement += microWarp * crowdingStrength * 0.1;  // 10% of main displacement
```

This bends content *within* the chunks — the "wet paper" effect. Without it, the grid produces clean rectangular fragments that look synthetic.

### Step 7: Density-Aware MIP Blur

Dense regions get pushed into lower MIP levels faster:

```glsl
float densityBias = 1.0 + (density * 3.0);
float confusion = crowdingStrength * 60.0 * densityBias;
float targetLOD = log2(1.0 + confusion * 1.5);
vec4 color = textureLod(u_texture, distortedUV, targetLOD);
```

## Mode Configuration

```json
{
  "metamer": {
    "label": "Metamer Crowding",
    "v1_distortion_type": 4,
    "v1_strength_mult": 1.0,
    "v4_style_id": 0,
    "lgn_use_structure_mask": true,
    "lgn_use_saliency_gate": true,
    "lgn_ramp_end_mult": 4.0
  }
}
```

## Open Questions

1. **Which summary statistics matter?** The metamer branch preserves spatial frequency (via grid sizing) and orientation (via axis bias) but not luminance variance, color statistics, or feature correlations. A conversation with Rosenholtz could identify which statistics are load-bearing for the web content domain.

2. **Interaction with existing V4 styles.** The metamer V1 distortion should compose with High-Key desaturation, rod vision, and chromatic aberration. Need to verify the V4 stage doesn't fight the V1 displacement.

3. **Validation target.** What does "correct" look like for a metamer? Main's validation uses psychophysical stimuli with measurable outcomes (spread ratio, color naming, acuity). Metamer correctness is harder to quantify — possibly compare against TTM mongrel images as ground truth.

4. **Performance.** The wobbly grid adds 2 snoise evaluations + 1 hash per fragment. Micro-turbulence adds 2 more snoise calls. Total: ~5 noise evaluations per fragment beyond current pipeline. Profile on target hardware.

---

## Tier 2.5: WebGPU Compute Pipeline (Shipped v2.3.0)

The shipped implementation takes a different path from the fragment-shader approach above. Instead of displacing texels via a grid, two WGSL compute passes synthesize oriented noise that matches per-tile summary statistics.

### Architecture

- **Pass 1** (`crowding-stats.wgsl`): 8×8 workgroups extract per-tile Oklab statistics — mean L, σ_L, mean a/b, four orientation energies, CMF-derived MIP level. Output: 48-byte `TileStats` struct per tile to a storage buffer.
- **Pass 2** (`crowding-synth.wgsl`): One thread per output pixel synthesizes oriented noise — four sine gratings weighted by orientation distribution, scaled by σ_L × 1.5. Chrominance uses tile mean directly. Output: RGBA8 with eccentricity-dependent alpha.

Result uploads to WebGL as `TEXTURE5`. The fragment shader blends it when `u_compute_tier > 2.0`.

### Temporal Smoothing (v2.3.0)

**Problem:** The synthesis shader generates noise from tile statistics each frame. Even on static content, subpixel rendering differences and compositor timing cause small tile-to-tile stat fluctuations. Because the noise amplitude scales with σ_L, these fluctuations produce coherent luminance transients across entire tiles — exactly the kind of large, low-contrast temporal change that the magnocellular pathway detects in peripheral vision.

For a vision science simulator, this is a critical failure mode: **the simulation triggers peripheral motion detection that the original content does not.** A usability practitioner viewing a page through Scrutinizer would have their foveal attention repeatedly pulled to peripheral "shimmer" artifacts that don't exist in the actual viewing experience. This makes the tool worse than a simpler MIP blur for the practitioner use case, even though the mongrel texture is theoretically more accurate.

**Solution:** Double-buffered tile statistics with exponential moving average (EMA). After each frame, `statsBuffer` is copied to `prevStatsBuffer`. On the next frame, Pass 1 blends:

```
smoothed_sigma = mix(prev.sigma_L, current.sigma_L, temporal_blend)
smoothed_energy = mix(prev.energy_*, current.energy_*, temporal_blend)
```

Only σ_L and orientation energies are smoothed — the noise-driving statistics. Mean L, mean a, mean b pass through instantly so that cursor movement doesn't produce lagging color ripples. Eccentricity and MIP level are geometric (computed from cursor position), not smoothed.

`temporal_blend = 0.3` — converges in ~7 frames (~120ms at 60fps). Fast enough to track scrolling, slow enough to damp frame-to-frame jitter.

### Design Constraint: Restricted Foveal Viewing

Scrutinizer is not a pure vision science simulation — it's a tool for evaluating interfaces under simulated peripheral viewing. This distinction matters for the compute pipeline:

- **Vision science simulation** can tolerate temporal noise in peripheral metamers (the visual system does pool noisy statistics in real peripheral viewing).
- **Restricted foveal viewing tool** cannot, because peripheral artifacts compete with the user's foveal task. The periphery's job in real vision is to alert the fovea to change. A simulation that generates spurious peripheral transients disrupts the user's ability to evaluate the page.

This constraint — don't trigger peripheral motion detection — is not present in TTM reference implementations that aim for perceptual fidelity alone. It's specific to Scrutinizer's use case as a design evaluation tool.

### Safety Harness

- `webgpu-probe.js`: Adapter capability query, 128MB storage buffer warning
- `webgpu-safety.js`: 60-frame rolling window monitor. 10 consecutive frames above 33ms → `onBudgetExceeded` → automatic fallback to MIP-only rendering

### Performance

- <0.3ms on Apple M1 integrated GPU (two dispatches + async readback)
- Runs every 2nd frame (`FRAME_INTERVAL = 2`)
- Half-resolution source frame

## Origin

Derived from the `metamer` branch (commits ab4d7f7..f00b979). The branch implemented this as the sole rendering mode with all validation/analysis infrastructure removed. This spec integrates it as one mode option within main's validated pipeline.
