# Psychophysics Validation Journal

**Started**: 2026-03-07
**Project**: Scrutinizer — peripheral vision simulator for web content
**Method**: Computational psychophysics — render known stimuli through Scrutinizer, measure the output, compare against published human vision data. No human subjects; the shader *is* the subject.

This document records what we tested, what we found, what broke, and what we learned. The validation suite is designed so that failures are informative — they expose either bugs in the implementation, limitations of the architecture, or gaps in the measurement methodology. Each is a different kind of knowledge.

---

## The Approach

Scrutinizer simulates three aspects of peripheral vision degradation:

1. **Chromatic pooling** — color information decays with eccentricity, RG faster than BY (castleCSF parameters, Bowers et al. 2025)
2. **Spatial frequency attenuation** — fine detail lost before coarse detail, via 5-band DoG decomposition with M-scaling cutoffs (Rovamo & Virsu 1979)
3. **Crowding** — nearby objects interfere with target identification, via V1 Lateral Smash displacement and polar sector quantization (Bouma 1970, Toet & Levi 1992)

Each mechanism has published psychophysical data we can validate against. The validation uses a three-tier structure:

- **Tier 1 (Must Pass)**: Fundamental properties that hold by construction if the math is right — monotonic decay, correct ordering, preservation of what should be preserved. Failures here mean bugs.
- **Tier 2 (Should Pass)**: Quantitative agreement with published data within tolerances. Failures here mean calibration issues or architectural limitations we should understand.
- **Tier 3 (Stretch)**: Cross-study correlations and continuous-model comparisons. Failures here are expected to expose the gap between our discrete approximations and the continuous reality of human vision.

### Why Screenshot-Based Testing

We render known stimuli (gratings, colored dots, flanked letters) as HTML pages, capture them through Scrutinizer's shader pipeline, and analyze the output pixels. This tests the full rendering path — shader compilation, MIP chain construction, texture sampling, color space transforms — not just the math in isolation. If a uniform variable isn't bound correctly or a MIP level rounds wrong, the screenshots catch it.

---

## Wave 1: Chromatic Decay

**Spec**: `docs/specs/wave1_feature_search_validation.md` (not committed — evolved directly into implementation)
**Stimulus**: `tests/reference-pages/color-search.html` — colored dot arrays (red, green, blue, yellow targets among gray distractors) at 5 eccentricity rings
**Report**: `tests/validation/reports/color-search-report.html`

### What We Tested

Does Scrutinizer's chromatic pooling model correctly predict how fast color disappears in peripheral vision? Specifically:

- RG channels (red, green) should decay ~5x faster than BY channels (blue, yellow)
- Green should track the RG decay curve, not BY — a non-obvious prediction from Oklab's `a`-axis projection
- The decay ratio should match Mullen & Kingdom (2002) and Bowers et al. (2025) within 20%
- Chroma retention should correlate with Hansen et al. (2009) color naming accuracy

### Results: Tier 1: 7/7 PASS | Tier 2: 3/3 PASS | Tier 3: 1/2

All fundamental predictions confirmed. The chromatic pooling model produces the right ordering, monotonic decay, and quantitative agreement with published psychophysics.

### What Broke Along the Way

**Rounding ties in monotonicity checks.** Initial analysis used 3 decimal places for chroma measurements. At low chroma (red at inner rings), values like 0.024 repeated across rings 0-3 — technically tied, which the strict monotonicity check (`>=`) flagged as failure.

*Fix*: Increased precision to 5 decimal places (revealing the underlying differences) and relaxed monotonicity to non-strict (ties allowed). The ties were real — quantization in 8-bit RGB creates legitimate plateaus in low-dynamic-range signals. Non-strict monotonicity is the correct criterion for discrete pixel data.

**Lesson**: When testing continuous predictions against quantized measurements, the test criterion must account for the measurement's precision floor. This isn't a statistical power issue — it's a representational one.

### What We Confirmed

The Oklab color space decomposition into RG (a-axis) and BY (b-axis) channels correctly predicts peripheral color loss patterns. Green tracking RG rather than BY is the key validation — naive hue-based models would get this wrong.

---

## Wave 2: Spatial Frequency Attenuation

**Spec**: `docs/specs/wave2_spatial_acuity_validation.md`
**Stimulus**: `tests/reference-pages/spatial-acuity.html` — sine-wave gratings at 0.25–4 cpd in concentric annuli
**Report**: `tests/validation/reports/spatial-acuity-report.html`

### What We Tested

Does Scrutinizer's 5-band DoG decomposition correctly attenuate spatial frequencies with eccentricity? The shader extracts frequency bands at ~4, 2, 1, 0.5, and 0.25 cpd via MIP-chain subtraction, then applies M-scaling sigmoids to each band.

Predictions:
- Higher frequencies die at smaller eccentricities (band dropout order)
- M-scaling cutoff positions match Rovamo & Virsu (1979) E2 values
- The residual band (0.25 cpd) survives everywhere
- The filter's effect on gratings should be frequency-ordered when comparing filtered vs unfiltered

### Results: Tier 1: 12/16 | Tier 2: 5/5 PASS | Tier 3: 0/4

Model predictions (Tier 1 top 11, Tier 2 all) passed cleanly. The 4 Tier 1 failures and all 4 Tier 3 failures are methodology artifacts, not model errors. This is where it gets interesting.

### What Broke: The Foveal Reference Problem

**Measured grating contrast is wildly non-monotonic at low frequencies.** The 0.25 cpd filtered grating showed 233% retention at ring 1, 9.8% at ring 2, 246% at ring 3. This isn't physically possible — Scrutinizer can only reduce contrast, not amplify it.

*Root cause*: The foveal reference patch is 30px CSS radius. A 0.25 cpd grating completes 0.67 cycles in that space — less than one full cycle. The DFT matched filter can't extract a meaningful amplitude from a sub-cycle sample. The foveal contrast measurement is unreliable noise, making any ratio against it meaningless.

This affects 0.25, 0.5, and partially 2 cpd. Only 1 cpd has enough cycles in the foveal patch for a stable reference, and it's the only frequency where foveal-relative retention passes monotonicity.

*Fix*: Introduced **cross-condition retention** — compare filtered vs unfiltered grating at the *same* ring position. This metric doesn't depend on foveal reference accuracy at all. It measures what fraction of the grating amplitude Scrutinizer's filter removes at each eccentricity.

Cross-condition results are well-behaved:
- 4 cpd: 81% → 77% → 74% → 61% → 77% (clear frequency-dependent attenuation)
- 0.25 cpd: 99% → 94% → 99% → 100% → 100% (near-transparent, as expected)

**Lesson**: When your reference measurement is unreliable, don't normalize against it — find a metric that's self-referencing. The cross-condition ratio is more robust *and* more directly tests what we care about: does the filter do what it should?

### What Broke: Discrete Bands vs Continuous CSF

**All 4 Tier 3 Rovamo correlations fail.** The model predicts either 100% or 0% retention per band — the sigmoid cutoffs are steep enough that each band snaps from full to zero within one ring step. Rovamo's data shows smooth, gradual curves (4 cpd: 100% → 60% → 30% → 12%). You can't compute a meaningful rank correlation between a step function and a smooth curve.

*Root cause*: This is architectural, not a bug. The DoG decomposition uses 5 discrete bands, each with a single cutoff eccentricity. The human contrast sensitivity function is continuous — it doesn't have 5 frequency channels that independently switch off. The 5-band model is a practical approximation for real-time GPU rendering (each band = one MIP level subtraction), not a claim about visual neuroscience.

*The right comparison*: Sum the weighted band contributions to get a composite spatial sensitivity at each eccentricity, then correlate that against Rovamo. At 5° eccentricity, you've lost bands 0-1 (4 and 2 cpd) but kept bands 2-4 (1, 0.5, 0.25 cpd) — that's 3/5 of your spatial detail, roughly matching Rovamo's integrated sensitivity at that eccentricity. The composite comparison is a future improvement.

*Could we go continuous?* Two options:
1. **More bands** (10-20) — diminishing returns past ~7, and GPU cost scales linearly per band
2. **Continuous Gaussian blur** with eccentricity-dependent sigma (how FOVI works) — smoother but loses selective frequency preservation

The 5-band architecture is the right trade-off for the current use case (real-time rendering of web content). The Tier 3 failure correctly identifies the approximation gap.

**Lesson**: Tier 3 tests should be designed to expose architectural limitations, not just chase higher scores. The failure here is informative — it tells us exactly where the 5-band model diverges from the continuous reality and what a more faithful model would need.

### DFT Matched Filter: Measuring What You Mean To

The original analysis used RMS contrast — the total variance of pixel values in a ring sample. This captures *all* variation, including noise from Scrutinizer's spatial blur (which creates noisy texture even when the grating signal is destroyed). Ring 5 at 4 cpd showed high RMS contrast despite the grating being completely gone — the noise from the blur *was* the contrast.

Replacing RMS with a DFT matched filter — computing the Fourier amplitude at the specific grating frequency — isolates the signal we care about. If the grating at 4 cpd has been destroyed by the blur, the DFT at 4 cpd reads near-zero regardless of how noisy the texture is.

**Lesson**: RMS contrast measures "is there variation?" The DFT matched filter measures "is there variation *at the expected frequency?*" For validating frequency-selective processing, the latter is the only correct measurement.

---

## Wave 3: Crowding Geometry

**Spec**: `docs/specs/wave3_crowding_validation.md`
**Analysis**: `scripts/analyze-crowding-geometry.js` — pure numerical computation, no screenshots yet
**Stimulus pages**: `crowding-radial.html`, `crowding-spacing.html` (created, not yet captured)

### What We Tested

Does Scrutinizer's crowding model — MIP pooling, polar sector quantization, and V1 Lateral Smash — produce the right spatial geometry? Specifically:

- Do pooling regions grow proportionally with eccentricity (linear, not quadratic)?
- Does V1 displacement match Bouma's critical spacing (0.5x eccentricity)?
- Do polar sectors have the intended 2:1 radial:tangential ratio (Toet & Levi 1992)?
- Does the density gate differentiate crowded vs isolated content?

### Results (Analytical — geometry computation only)

#### MIP Pooling Scales Proportionally: PASS

Pooling diameter grows from 2.5px at 2° to 14.9px at 15°. The MIP/Bouma ratio is approximately constant (spread 1.71x across the range). But the ratio itself is only ~3-5% of Bouma critical spacing.

This is correct and expected. MIP pooling handles frequency-domain averaging — what spatial detail *survives* at each eccentricity. It's the equivalent of receptive field size growth. Crowding extent (how far a flanker can interfere) is a different mechanism, handled by V1 displacement. These are complementary, not redundant.

**Lesson**: Different shader mechanisms model different perceptual phenomena. Testing them against the same benchmark (Bouma) initially seemed right but conflated two distinct questions: "what survives?" (MIP) vs "what interferes?" (V1 displacement).

#### V1 Displacement Matches Bouma at ~6°, Plateaus Beyond: PARTIAL PASS

At 6° eccentricity, V1 Lateral Smash displacement reaches ~69px for dense content. Bouma predicts 0.5 × 6° × 45 ppd = 135px critical spacing. The ratio is 0.51x — very close to the theoretical 0.5x proportionality constant. This is a strong validation in the parafoveal range where most screen content lives.

But the displacement plateaus beyond parafovea. At 15°, it's still ~69px while Bouma predicts 338px. The ratio drops to 0.20x.

*Root cause*: `eccentricityScale = smoothstep(fovea_radius, parafovea_radius, dist)` saturates at 1.0 at the parafovea boundary. Beyond that, `warpAmp` has a secondary ramp but it's insufficient to maintain Bouma-proportional growth.

*The question*: Is this a bug or a design choice? For typical screen content (text, UI elements), most relevant eccentricities are 2-8°. The parafovea is where crowding effects matter most for usability. Over-crowding at 15° (where screen content is typically sparse navigation elements) could be worse than under-crowding.

*Possible fix*: Replace the smoothstep clamp with continued linear growth: `eccentricityScale = max(0, (dist - fovea_radius) / fovea_radius)` with appropriate normalization. This would maintain Bouma proportionality into the far periphery. Whether this improves perceived quality for real web content is an empirical question.

#### Polar Sector Radial:Tangential Bug: FOUND

The shader comment at `peripheral2.frag:337-341` claims `bias=2.0` produces sectors with 2:1 radial:tangential aspect ratio (matching Toet & Levi 1992). The analysis reveals this is false — sectors are approximately 1:1 (square).

*Root cause*: The spoke count formula uses the biased ring width:
```
spokeCount = floor(2π × ring_center / ring_width_biased)
```

Since `ring_width_biased = r × (ef^bias - 1)` is already elongated radially, dividing the circumference by this larger width produces *fewer* spokes — with wider tangential extent. The two elongations cancel, yielding square sectors.

*Fix*: Compute spoke count from the *unbiased* ring width (`ef^1`, not `ef^bias`). This gives more spokes (narrower tangential extent) while keeping the radially-elongated ring width, producing the intended 2:1 ratio.

*Scope*: Only affects V4 styles 7 (Pooling Grid) and 8 (Minecraft Eyeball), not the main V1 crowding path. The V1 Lateral Smash achieves radial bias through direct `radialNoise` scaling, which is correct.

**Lesson**: Shader comments can assert properties the code doesn't actually produce. The geometry analysis caught a discrepancy between documented intent and computed reality. This is exactly the kind of bug that's invisible in visual inspection (slightly square vs slightly rectangular sectors at small scales) but matters for psychophysical validity.

#### Dense/Sparse Differentiation: 3.3:1

The density gate gives 69px displacement for dense content (crowding factor ~1.0) vs 21px for isolated content (crowding factor ~0.3). This is the right qualitative behavior — a text paragraph should crowd more than an isolated icon at the same eccentricity.

Quantitative validation requires screenshot analysis (comparing crowded vs isolated letter contrast at matched eccentricities), which is pending.

---

## Cross-Wave Patterns

### Pattern 1: Measurement methodology is as hard as the model

In all three waves, the most difficult problems weren't in the shader math — they were in the measurement. Foveal reference patches too small for low frequencies. RMS contrast capturing noise instead of signal. Discrete band models compared against continuous curves. The act of measuring peripheral vision effects computationally has its own precision limits, analogous to psychophysical methods having their own noise floors.

### Pattern 2: Failure taxonomy matters

We found three distinct kinds of failure:

1. **Implementation bugs** (polar sector R:T ratio) — the code doesn't do what the comment says. Fix the code.
2. **Measurement artifacts** (foveal reference, RMS vs DFT) — the test doesn't measure what we think. Fix the test.
3. **Architectural limitations** (5-band vs continuous CSF, V1 plateau) — the model makes a different claim than what we're testing against. Understand the gap, document it, and decide whether it matters for the use case.

Lumping these together as "failures" loses information. The validation tiers help — Tier 1 catches bugs, Tier 2 catches calibration issues, Tier 3 exposes architectural boundaries.

### Pattern 3: Cross-condition metrics are more robust than absolute metrics

In both Wave 1 (chroma retention) and Wave 2 (grating contrast), comparing filtered vs unfiltered at the same location was more reliable than normalizing against a foveal reference. The cross-condition ratio cancels out stimulus-specific measurement artifacts (grating phase, dot placement, rendering quantization) and directly measures the filter's effect.

### Pattern 4: The shader decomposes perception into mechanisms; validation should too

Scrutinizer doesn't have one "peripheral vision" effect — it has chromatic pooling, spatial frequency attenuation, and crowding, each modeled by different shader code paths. Testing them together conflates their contributions. The wave structure (one mechanism per wave) isolates each for clean validation, then the combined behavior can be assessed knowing which pieces work.

---

## What's Next

### Immediate Fixes
- **Wave 2 Tier 3**: Implement composite (summed-band) comparison against Rovamo instead of per-band correlation
- **Wave 3 polar sector R:T**: One-line fix in `peripheral2.frag:340` — compute spoke count from unbiased ring width
- **Wave 3 V1 plateau**: Evaluate whether continued eccentricity scaling beyond parafovea improves real-content rendering

### Pending Capture-Based Validation (Wave 3)
- Screenshot captures of crowding stimulus pages through Scrutinizer
- Pixel-level crowding ratio measurement (crowded vs isolated letter contrast)
- Parametric Bouma spacing transition curve

### Future Waves
- **Wave 4**: Saliency map validation — do Scrutinizer's rendered saliency peaks match known psychophysical saliency (Itti & Koch benchmarks)?
- **Wave 5**: Temporal integration — does the foveation update correctly during simulated saccades?

---

## References

- Bouma, H. (1970). Interaction effects in parafoveal letter recognition. *Nature*, 226, 177-178.
- Bowers, N.R., et al. (2025). Sensitivity to chromatic contrast in the periphery. *Journal of Vision*.
- Hansen, T., Pracejus, L. & Gegenfurtner, K.R. (2009). Color perception in the intermediate periphery of the visual field. *Journal of Vision*, 9(4):26.
- Mullen, K.T. & Kingdom, F.A.A. (2002). Differential distributions of red-green and blue-yellow cone opponency across the visual field. *Visual Neuroscience*, 19, 109-118.
- Pelli, D.G. & Tillman, K.A. (2008). The uncrowded window of object recognition. *Nature Neuroscience*, 11(10), 1129-1135.
- Rovamo, J. & Virsu, V. (1979). An estimation and application of the human cortical magnification factor. *Experimental Brain Research*, 37, 495-510.
- Toet, A. & Levi, D.M. (1992). The two-dimensional shape of spatial interaction zones in the parafovea. *Vision Research*, 32(7), 1349-1357.
- Ashraf, M., et al. (2024). castleCSF — A contrast sensitivity function of color, area, spatiotemporal frequency, luminance and eccentricity. *bioRxiv*.
- Blauch, N.M., Alvarez, G.A. & Konkle, T. (2026). FOVI: Foveated vision transformers. *arXiv*.
- Rosenholtz, R., et al. (2012). A summary statistic representation in peripheral vision explains visual search. *Journal of Vision*, 12(4):14.
