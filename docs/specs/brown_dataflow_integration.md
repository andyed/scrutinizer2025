# Brown et al. Dataflow Integration Spec

**Source:** Brown, DuTell, Walter, Rosenholtz, Shirley, McGuire, Luebke (2023). "Efficient Dataflow Modeling of Peripheral Encoding in the Human Visual System." ACM TAP. [doi:10.1145/3564605](https://dl.acm.org/doi/full/10.1145/3564605)
**Code:** [PooledStatisticsMetamers](https://github.com/ProgramofComputerGraphics/PooledStatisticsMetamers) (Python/PyTorch, MIT license)
**Related:** Vacher & Briand (2021). PS C++ implementation. [IPOL](https://www.ipol.im/pub/art/2021/324/) (BSD-3)
**Parent spec:** `mongrel_textures.md`

---

## Context

Brown et al. is Rosenholtz's own team (with NVIDIA rendering researchers) reformulating TTM for graphics applications. The key architectural insight: warp the image into log-polar space so all pooling regions become uniform size, run cheap uniform convolution, unwarp. This avoids per-region convolutions at each eccentricity.

Scrutinizer currently uses two MIP level selection paths: legacy linear scaling (`normalizedEcc * 2.5`) and CMF logarithmic scaling (`log(1 + r/a)`). The Brown et al. pipeline does something architecturally different: it warps the image into log-polar space, runs a uniform convolution, and unwarps. The warp math is relevant to our MIP computation, but the full warp-convolve-unwarp pipeline is a separate capability needed only for statistics-based synthesis (D5/Tier 3). This distinction matters and was previously conflated in D1.

---

## Deliverables

### D1. Log-Polar Pooling Integration

#### D1a. MIP Level Selection vs UV Warp — What We Have vs What Brown et al. Does

Two fundamentally different operations that the original D1 spec conflated:

**What Scrutinizer does today (CMF path):**
```glsl
// peripheral2.frag:266-267 (sampleMIPPooled), also :293-294 (sampleMIPPooledGrad)
float cortical_dist = log(1.0 + r_deg / u_cmf_a);
mipLevel = clamp(maxMipLevel * cortical_dist / u_cortical_max, 0.0, maxMipLevel);
// Then: textureLod(u_texture, uv, mipLevel)  — SAME UV, different blur
```
This controls **how much blur** at each eccentricity. Higher MIP = larger Gaussian kernel = more spatial averaging. But the UV coordinates are unchanged — every source pixel maps 1:1 to an output pixel. No spatial compression occurs.

The JS side precomputes `cortical_max` from screen geometry (`webgl-renderer.js:617-621`):
```js
const rMaxDeg = (halfDiag / foveaRadius) * foveaDeg;  // :619
const cmfA = this.config.cmf_a || 2.78;               // :620
const corticalMax = Math.log1p(rMaxDeg / cmfA);         // :621
```

DoG band cutoffs are derived from the same CMF by inverting the MIP formula (`peripheral2.frag:162-171`):
```glsl
float scale = u_cortical_max / maxMipLevel;
c0 = u_cmf_a * (exp(1.0 * scale) - 1.0) / fovea_deg;  // MIP 1 boundary
c1 = u_cmf_a * (exp(2.0 * scale) - 1.0) / fovea_deg;  // MIP 2 boundary
c2 = u_cmf_a * (exp(3.0 * scale) - 1.0) / fovea_deg;  // MIP 3 boundary
c3 = u_cmf_a * (exp(4.0 * scale) - 1.0) / fovea_deg;  // MIP 4 boundary
```

**What Brown et al. does (log-polar warp):**
```python
# gazewarp.py — warp THEN convolve THEN unwarp
warped_uv = log_polar_transform(uv, gaze)  # compress periphery spatially
output = uniform_convolution(warped_image)   # same kernel everywhere
result = inverse_warp(output)                # back to Cartesian
```
This **spatially remaps** the image: peripheral pixels get compressed into fewer output pixels. Then a uniform (constant-size) convolution in warped space produces eccentricity-scaled pooling in the original space. The warp IS the mechanism — the convolution kernel doesn't need to vary.

**Why MIP-level blur is a valid real-time approximation:**

MIP sampling averages texels within the MIP kernel, destroying high-frequency detail at a rate that scales with eccentricity (when the MIP level is derived from a log CMF). The perceptual effect is similar to spatial pooling: fine detail is lost, coarse structure survives. The CMF path already implements this with the correct logarithmic falloff from Blauch, Konkle & Alvarez (2026).

**Where MIP-level blur breaks down:**

It preserves the spatial layout — every pixel still has a unique UV. True log-polar warping compresses many source locations into the same output location, which is closer to what cortical magnification actually does (many retinal ganglion cell receptive fields → same cortical area). This matters for statistics-based synthesis (D5), where uniform patch sizes in warped space enable efficient PS computation. It does not matter for MIP-based blur.

| Approach | Spatial downsampling? | Blur control? | Stat replacement? | Perf cost |
|----------|----------------------|---------------|-------------------|-----------|
| Current CMF MIP | No — same UV | Yes — via MIP level | No | Zero (same `textureLod` call) |
| Brown et al. warp | Yes — log-polar UV remap | Yes — uniform post-warp | Enables it | Extra pass (warp + unwarp) |

---

#### D1b. Default the CMF Log Path for Modes 0 and 1

**Status:** SHIPPED. Modes 0, 1, 4, 6, and 8 all use `cmf_enabled: true`.

**Problem:** The linear path produces MIP levels that grow linearly with eccentricity. Cortical magnification follows a logarithmic curve. The discrepancy is most visible at mid-periphery (5-10 degrees): linear scaling over-blurs relative to biological acuity falloff, while slightly under-blurring at far periphery.

**Change:** Set `cmf_enabled: true` for Modes 0 and 1 in `shared/modes.json`.

**Exact edits:**
```json
// modes.json, Mode 0 "highkey" pipeline (currently line 21):
"cmf_enabled": true,    // was: false

// modes.json, Mode 1 "biological" pipeline (currently line 58):
"cmf_enabled": true,    // was: false
```

**No shader change required.** The CMF code path already exists in both `sampleMIPPooled` (line 261) and `sampleMIPPooledGrad` (line 288). The DoG band cutoff inversion (line 161) also already branches on `u_cmf_enabled`.

**Rollback:** Flip the flag back to `false`. Mode 7 (`legacy_v16`) retains `cmf_enabled: false` as a frozen comparison baseline.

**Risk:** Low. The CMF path has been shipping in Mode 6 since v1.8. The only behavioral difference is the MIP curve shape — no new code executes.

---

#### D1c. Add `u_ecc_scaling` Uniform

**Status:** SHIPPED. Uniform added to `peripheral2.frag`, wired in `webgl-renderer.js`, defaults set in all CMF-enabled modes.

**What:** Brown et al. parameterize pooling zone growth as `scaling × eccentricity` where `scaling = 0.75` (their default, derived from Bouma's law). Expose this as a tunable uniform that scales MIP output, allowing per-mode control of how aggressively blur increases with eccentricity.

**Uniform declaration** (add to `peripheral2.frag` after line 47):
```glsl
uniform float u_ecc_scaling;      // Pooling growth rate (Bouma scaling, default 0.75)
```

**Shader integration** — modify MIP computation in both `sampleMIPPooled` (line 267) and `sampleMIPPooledGrad` (line 294):
```glsl
// Current:
mipLevel = clamp(maxMipLevel * cortical_dist / u_cortical_max, 0.0, maxMipLevel);

// With eccentricity scaling:
mipLevel = clamp(maxMipLevel * cortical_dist / u_cortical_max * (u_ecc_scaling / 0.75), 0.0, maxMipLevel);
```

The `/ 0.75` normalizes so that the default value (0.75) produces no change from current behavior. Values > 0.75 increase peripheral blur (larger pooling zones); values < 0.75 decrease it.

**DoG band cutoff propagation** — the CMF-derived cutoffs at `peripheral2.frag:167-171` must also scale:
```glsl
// Current:
float scale = u_cortical_max / maxMipLevel;

// With eccentricity scaling:
float scale = u_cortical_max / maxMipLevel / (u_ecc_scaling / 0.75);
```

This ensures DoG bands drop out at eccentricities consistent with the scaled MIP levels. When `u_ecc_scaling` is high (aggressive blur), bands drop out sooner (closer to fovea); when low, they persist further.

**JS-side setup** (add to `webgl-renderer.js` near line 639):
```js
// After cmfEnabledLocation upload:
gl.uniform1f(this.eccScalingLocation, this.config.ecc_scaling || 0.75);
```

Requires adding to uniform location lookup (near line 224):
```js
this.eccScalingLocation = gl.getUniformLocation(this.program, "u_ecc_scaling");
```

And null init (near line 87):
```js
this.eccScalingLocation = null;
```

**modes.json entries:**
```json
// Add to pipeline object for each mode that uses cmf_enabled: true:
"ecc_scaling": 0.75
```

| Mode | `ecc_scaling` | Rationale |
|------|--------------|-----------|
| 0 (highkey) | 0.75 | Brown et al. default |
| 1 (biological) | 0.75 | Brown et al. default |
| 6 (log_polar_mip) | 0.75 | Brown et al. default |

All modes start at the same value. Per-mode tuning comes after D3 ground truth comparison.

**Performance:** Zero — one additional multiply in the MIP computation.

---

#### D1d. Log-Polar UV Warp (Future — NOT Initial Implementation)

**Architecture for warp pass, if justified by D5 or Tier 3:**

A two-pass approach:
1. **Warp pass:** Render source image into a log-polar FBO. Each output texel samples from a Cartesian UV computed by the inverse warp. Peripheral regions compress into fewer output pixels.
2. **Process pass:** Run uniform-kernel operations (convolution, PS synthesis) on the warped FBO. Because all pooling regions are the same size in warped space, a single kernel size works everywhere.
3. **Unwarp pass:** Sample from the processed warped FBO using the forward warp to produce the final Cartesian output.

```
Source FBO ──[warp shader]──→ Log-Polar FBO ──[uniform conv]──→ Processed FBO ──[unwarp shader]──→ Output
```

**When this becomes necessary:**
- D5 async PS synthesis needs uniform patch sizes to run efficient FFT-based statistics. The warp provides this for free.
- Tier 3 atlas matching benefits from uniform pooling regions — each atlas entry covers the same angular/radial extent in warped space.

**When it is NOT necessary:**
- MIP-based blur (D1b, D1c). The CMF log curve already gives the correct blur growth rate without spatial remapping.
- DoG band filtering. Band cutoffs are derived from the same CMF and don't require UV warping.

**Status:** Spec only. Requires D5 or Tier 3 atlas work to justify the extra render pass. Do not implement until a concrete consumer of the warped FBO exists.

---

#### D1e. Meeting Question — CMF vs Bouma Scaling

Two related but distinct biological quantities control different aspects of peripheral rendering:

**CMF (Cortical Magnification Factor):** How many cortical neurons are allocated per degree of visual field. Determines **resolution** — how much spatial detail is available. Parameterized by `u_cmf_a` (default 2.78, from Blauch et al. 2026). Currently drives MIP level selection.

**Bouma scaling:** How large the "crowding zone" is at each eccentricity — approximately `0.5 × eccentricity` (Bouma 1970), with Brown et al. using 0.75. Determines **pooling region size** — how large an area gets averaged into a single perceptual summary. This is what `u_ecc_scaling` (D1c) parameterizes.

These are correlated (both fall off with eccentricity) but not identical. CMF tells you the sampling density; Bouma tells you the integration area for crowding. A pixel at 10 degrees eccentricity has low CMF (few cortical neurons) AND a large Bouma zone (features within 7.5 degrees interact). But they scale differently: CMF follows `1/(r+a)`, Bouma follows `0.5r` to `0.75r` linearly.

**Questions for March 13:**
1. For web content perception, which matters more — resolution falloff (CMF) or crowding zone size (Bouma)? MIP blur approximates both, but they produce different curves.
2. Is MIP-level blur an acceptable approximation of spatial pooling, or does the preservation of spatial layout (every pixel retains a unique UV) invalidate the perceptual simulation at mid-periphery?
3. Should `u_ecc_scaling` modulate the CMF curve (as proposed in D1c) or should it independently control a separate pooling mechanism?

---

### D2. End-Stopped Feature Detection

**What:** Single compute pass detecting where edges terminate. Modulates Melter distortion strength.

**Source:** `autodifference.py` in Brown et al. -- computes `image - shift(image, offset)` at oriented offsets. Where the difference is large along the edge but small perpendicular, you have an end-stopped feature.

**Why it matters:** End-stopped cells respond to line terminators and corners. Crowding is strongest at these locations (features pool together). The Melter should increase lateral smash at end-stops and reduce it along continuous contours.

**Implementation approach:**
```glsl
// Sample at oriented offsets
vec3 center = texture(u_texture, uv).rgb;
vec3 along_edge = texture(u_texture, uv + orientation_offset).rgb;
vec3 perp_edge = texture(u_texture, uv + perpendicular_offset).rgb;

// End-stopped: high difference along edge direction, low perpendicular
float end_stop_signal = length(center - along_edge) - length(center - perp_edge);
end_stop_signal = clamp(end_stop_signal, 0.0, 1.0);

// Modulate Melter: stronger distortion at end-stops
float lateralSmash = mix(BASE_SMASH, MAX_SMASH, end_stop_signal);
```

**Effort:** Medium. Needs orientation estimation per-pixel (from existing DoG bands or structure tensor). Could run at half-res for performance.

**Performance budget:** ~0.5-1ms as a separate pass, or folded into existing Melter pass.

---

### D3. Ground Truth Mongrel Generation (Offline)

**What:** Run Brown et al.'s full Python pipeline on Scrutinizer's test pages to produce reference PS metamer images. Use for validation, paper figures, and perceptual gap quantification.

**Process:**
1. Capture Scrutinizer test pages at known gaze positions (color-spectrum, dashboard, news sites)
2. Run `make_gaze_metamer.py` with matched parameters:
   - `scaling=0.75`
   - `target_pooling_size=96`
   - `iterations=300`
   - Gaze point = center (matching Scrutinizer's default)
3. Compare against Scrutinizer Tier 1/1.8/2 output at same gaze point
4. Quantify differences: SSIM per eccentricity band, statistics divergence per pooling region

**Output:** Reference images stored in `tests/golden-captures/brown-metamers/` with comparison composites.

**Effort:** Low (scripting). Runtime: minutes per image (offline, not a concern).

**Value:** Paper figures showing "ground truth TTM metamer vs. our real-time approximation at 60fps." This is the validation story.

---

### D4. Atlas Population via Brown et al.

**What:** Use the gaze-centric pipeline to pre-compute mongrel texture tiles for Tier 3's atlas.

**Approach:**
1. Cluster common web content patches by their PS statistics (mean, variance, orientation, spatial frequency)
2. For each cluster centroid, run Brown et al. synthesis to generate a canonical mongrel patch
3. Pack into a texture atlas (16x16 tiles, 256 entries)
4. At runtime, Tier 3 compute shader matches each pooling region to nearest atlas entry (existing spec)

**Advantage over hand-designed atlas:** The procedural tiles in the current Tier 3 spec (stripes, noise, solids) are intuitive but arbitrary. Atlas entries generated from actual PS synthesis are statistically grounded -- each tile IS a mongrel texture for its statistics bin.

**Effort:** Medium. Clustering pipeline + synthesis runs. One-time offline cost.

---

### D5. Async PS Synthesis "Research" Mode

**What:** Live (non-real-time) PS synthesis in the browser for scientific validation and demos.

**Architecture:**
```
Main thread (60fps)     Web Workers (async, ~2-3 Hz)
  |                       |
  | Capture frame ------> | Worker 1: synthesize patches 0-4
  |                       | Worker 2: synthesize patches 5-9
  |                       | Worker 3: synthesize patches 10-14
  |                       | Worker 4: synthesize patches 15-19
  |                       |
  | <--- completed ------  |
  | Cross-fade to new     |
  | mongrel textures      |
```

**Implementation options (ranked by feasibility):**

| Option | Runtime per 32x32 patch (5 iter) | Effort | Notes |
|--------|----------------------------------|--------|-------|
| Vacher & Briand C++ via WASM | ~60-80ms | High (FFTW3 dependency) | Best perf, hardest build |
| Brown et al. Python via Pyodide | ~200-400ms | Medium | Heavy runtime (~40MB), but code works as-is |
| JS port of PS core | ~100-200ms | High | No dependencies, but significant porting effort |

**Key constraint:** FFTW3 compiled to WASM loses SIMD optimizations (~4x slowdown). Alternative: use a WASM-native FFT (e.g., KissFFT, much simpler to compile).

**20 patches x 4 workers = ~300-400ms full update.** Cross-fade over 500ms. Web content barely changes frame-to-frame in the periphery, so ~2-3 Hz update rate is likely imperceptible.

**UI:** Toggle in mode selector: "Research: Live Mongrel Synthesis (slow)". Show update indicator. Useful for demos and paper screenshots, not everyday use.

---

## Priority Order

| # | Deliverable | Effort | Impact | Ship target |
|---|-------------|--------|--------|-------------|
| 1a | D1a: MIP-vs-warp clarification | None (spec only) | High (correctness of mental model) | Done |
| 1b | D1b: CMF default for Modes 0/1 | Trivial (2 JSON fields) | High (all research modes use log CMF) | SHIPPED |
| 1c | D1c: `u_ecc_scaling` uniform | Low (1 uniform, 4 line changes) | Medium (Bouma tuning knob) | SHIPPED |
| 1d | D1d: Log-polar UV warp | High (new render pass) | Low until D5/Tier 3 | Deferred |
| 2 | D3: Ground truth generation | Low | High (paper) | Pre-submission |
| 3 | D2: End-stopped detection | Medium | Medium (crowding fidelity) | v1.11 |
| 4 | D4: Atlas population | Medium | Medium (Tier 3 quality) | With Tier 3 |
| 5 | D5: Async research mode | High | Low (demo/validation) | Stretch |

---

## Open Questions for March 13 Meeting

1. **CMF vs Bouma for web content** (see D1e): For web page viewing at ~60cm (~15-20 degree useful field), does resolution falloff (CMF) or crowding zone size (Bouma 0.75) matter more for peripheral perception? MIP blur approximates both but they produce different curves.
2. **MIP blur as pooling proxy:** Does the preservation of spatial layout (every pixel retains a unique UV in MIP-based blur) invalidate the perceptual simulation? Or is the texture averaging within MIP kernels sufficient to approximate pooled statistics at each eccentricity?
3. **Which PS statistics matter for web content?** Web pages are not natural images -- they have flat color, text, hard edges, photos in boxes. Can we drop cross-scale phase correlations (group vi) entirely? What about cross-orientation at same scale (group iv)?
4. **End-stopped features in web layouts:** Are line terminators (where a border ends, where a heading stops) actually the primary crowding sites in web UIs, or does web content crowd differently than natural scenes?
5. **Validation methodology:** Is SSIM-per-eccentricity-band the right metric for comparing our approximation against Brown et al. metamers? Or is there a perceptual metric they'd recommend?
6. **`ecc_scaling` 0.75 default:** Brown et al. use 0.75 for their pooling growth rate. Should this modulate the CMF MIP curve directly (as D1c proposes), or should it control a separate pooling mechanism independent of CMF?

---

## References

- Brown et al. (2023). "Efficient Dataflow Modeling of Peripheral Encoding." ACM TAP. [doi:10.1145/3564605](https://dl.acm.org/doi/full/10.1145/3564605)
- Vacher & Briand (2021). "The Portilla-Simoncelli Texture Model." IPOL. [doi:10.5201/ipol.2021.324](https://doi.org/10.5201/ipol.2021.324)
- Portilla & Simoncelli (2000). "A parametric texture model." Int. J. Computer Vision.
- Freeman & Simoncelli (2011). "Metamers of the ventral stream." Nature Neuroscience.
- Rosenholtz et al. (2012). "Rethinking the role of top-down attention." Frontiers in Psychology.
- Blauch, Konkle & Alvarez (2026). "Foveated vision in neural networks." arXiv:2602.03766.
- Bouma (1970). "Interaction effects in parafoveal letter recognition." Nature.
- Schwartz (1980). "Computational anatomy and functional architecture of striate cortex." Vision Research.
- Parent spec: `mongrel_textures.md` (Tiers 1-3)
- Related spec: `cmf_mip_derivation.md` (cortical magnification mapping)
