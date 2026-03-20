# Oblique Effect Validation

> **Last updated:** 2026-03-10 (v2.2)

Date: 2026-03-09
Status: IMPLEMENTED
Dependencies: Oriented DoG bands (v2.2, implemented), DoG band decomposition (v1.6)

## 1. Problem Statement

v2.2 shipped orientation-selective band attenuation (Phases 1-3 of the oriented DoG spec). During capture validation, two bugs were found:

1. **`cardinalFrac ≡ 0.5` (degenerate normalization)**: Phase 2's 4-channel energy decomposition summed overlapping projections. `energy_h + energy_v + energy_d45 + energy_d135 = 2(gx² + gy²)`, making the cardinal fraction always exactly 0.5 regardless of orientation. The feature was inert. **Fixed**: `max(H,V) / (max(H,V) + max(D45,D135))` gives 0.33–0.67 selectivity range.

2. **`edgeGate` too restrictive**: `smoothstep(0.02, 0.08, gradMag)` rejected all web UI borders. A 1px rule between `#fff` and `#e9ecef` produces `gradMag ≈ 0.01` at MIP level 1. **Fixed**: lowered to `smoothstep(0.005, 0.03)`.

With these fixes, the effect produces a 27% pixel difference on a dense data table (10K+ differing pixels, max delta 252). But the implementation is not yet validated against published psychophysical data.

### Missing: Eccentricity-dependent attenuation

The published literature reports a critical constraint we don't model:

| Source | Finding |
|--------|---------|
| Berkley, Kitterle & Watkins (1975) | Oblique effect disappears at 8–18° eccentricity for high spatial frequencies (acuity) |
| Essock (1990) | "Global oblique effect" persists to 40°+ for low-medium spatial frequencies |
| Barbot et al. (2021, eLife) | Horizontal-vertical anisotropy is 20–120% at 6°, not eliminated by M-scaling |
| **UNCITED — verify or remove** | 10.1% more cortical space for cardinal orientations in central MT, only 3.6% in peripheral MT |

The oblique effect has a **spatial frequency × eccentricity interaction**: it diminishes with eccentricity, and the rate of diminishment depends on spatial frequency. Fine spatial frequencies lose the cardinal advantage faster.

Our current implementation applies `orientBonus` uniformly across all eccentricities. A horizontal edge at 3° gets the same cardinal bonus as one at 15°. Berkley et al. (1975) says the bonus should be gone by 10–18° for fine detail.

---

## 2. Biological Model

### 2.1 Why the oblique effect diminishes with eccentricity

V1 neurons in the foveal representation have tight orientation tuning (bandwidth ~20–40°). As eccentricity increases, receptive fields grow and orientation tuning broadens. At 10–15°, tuning is broad enough that the population advantage for cardinal orientations no longer produces a measurable acuity difference at high spatial frequencies.

At lower spatial frequencies, the relevant receptive fields are already large in the fovea. The population-level cardinal bias (more cortical area for H/V; Furmanski & Engel 2000) still provides an advantage for coarse structure even at larger eccentricities.

### 2.2 Quantitative constraints from the literature

| Eccentricity | High SF (>4 cpd) | Mid SF (1–4 cpd) | Low SF (<1 cpd) |
|-------------|-------------------|-------------------|------------------|
| 0° (fovea) | 30–50% cardinal advantage (Appelle 1972) | 20–30% | ~10% |
| 3° | ~25% | ~20% | ~10% |
| 6° | ~10% | ~15% (Barbot 2021: HVA 20–120%) | ~10% |
| 10° | ~0% (Berkley 1975: disappears) | ~10% | ~8% |
| 15° | 0% | ~5% | ~5% (Essock 1990: persists) |
| 40° | 0% | 0% | ~3% (Essock 1990) |

Note: exact values are approximate. Berkley 1975 reports inter-subject variability of 8–18° for the disappearance point.

### 2.3 Mapping to DoG bands

Our 8 half-octave DoG bands map approximately to spatial frequency ranges:

| Band | MIP levels | Approx SF range | Oblique effect behavior |
|------|-----------|-----------------|------------------------|
| 0 (finest) | LOD 0.0–0.5 | >4 cpd | Strong at fovea, gone by ~10° |
| 1 | LOD 0.5–1.0 | 2–4 cpd | Strong at fovea, gone by ~12° |
| 2 | LOD 1.0–1.5 | 1–2 cpd | Moderate, persists to ~15° |
| 3 | LOD 1.5–2.0 | 0.5–1 cpd | Moderate, persists to ~20° |
| 4–5 | LOD 2.0–3.0 | 0.25–0.5 cpd | Weak, persists to ~30° |
| 6–7 (coarsest) | LOD 3.0–4.0 | <0.25 cpd | Minimal effect |

---

## 3. Proposed Implementation

### 3.1 Eccentricity attenuation of orientBonus

Add an eccentricity-dependent fade to the orientation bonus, with the fade rate depending on which band we're boosting:

```glsl
// Current code (v2.2):
for (int k = 0; k < 8; k++) {
    float boost = 1.0 + orientBonus * mix(0.5, 0.1, float(k) / 7.0);
    c[k] *= boost;
}

// Proposed (v2.2.1):
// visual_ecc_deg is the true eccentricity in degrees (already available)
for (int k = 0; k < 8; k++) {
    // Per-band fade: fine bands lose the bonus earlier than coarse bands
    // Band 0 (finest): fades from 3° to 10° (half-life ~6°)
    // Band 7 (coarsest): fades from 8° to 25° (half-life ~16°)
    float fadeStart = mix(3.0, 8.0, float(k) / 7.0);
    float fadeEnd   = mix(10.0, 25.0, float(k) / 7.0);
    float eccFade   = 1.0 - smoothstep(fadeStart, fadeEnd, visual_ecc_deg);

    float boost = 1.0 + orientBonus * eccFade * mix(0.5, 0.1, float(k) / 7.0);
    c[k] *= boost;
}
```

**Key parameters:**

| Parameter | Value | Source |
|-----------|-------|--------|
| Fine band fade start | 3° | Fovea edge — no attenuation needed inside fovea |
| Fine band fade end | 10° | Berkley 1975 lower bound (8–18° range) |
| Coarse band fade start | 8° | Oblique effect persists longer for low SF |
| Coarse band fade end | 25° | Essock 1990: persists to 40° for low SF, conservative estimate |

### 3.2 Why smoothstep, not linear

The cortical orientation tuning bandwidth broadens gradually with eccentricity — it's not a step function. `smoothstep` provides a sigmoidal transition that approximates the gradual loss of orientation selectivity. The transition width (fadeEnd - fadeStart) is ~7° for fine bands and ~17° for coarse, matching the broader tuning of larger receptive fields.

### 3.3 Uniform for eccentricity in degrees

The shader already receives `visual_ecc` (eccentricity in pixels from undistorted fovea position). Converting to degrees:

```glsl
float visual_ecc_deg = visual_ecc / u_px_per_deg;
```

If `u_px_per_deg` isn't available yet (see Roadmap: "Calibrated Visual Angles"), approximate from fovea radius:

```glsl
// fovea_radius ≈ 1° foveal radius → px_per_deg ≈ fovea_radius / 1.0
float approx_px_per_deg = max(fovea_radius / 1.0, 1.0);
float visual_ecc_deg = visual_ecc / approx_px_per_deg;
```

---

## 4. Validation Protocol

### 4.1 Stimulus: oblique-effect.html

Reference page with Gabor patches at 4 orientations × 5 eccentricity rings (1.7°, 3.3°, 5.6°, 8.3°, 11.1°). Spatial frequency configurable (1, 2, 4, 6 cpd).

**Measurement procedure:**
1. For each Gabor patch position, measure the pipeline's output contrast (RMS of luminance deviation from mean gray)
2. Compute cardinal/oblique contrast ratio at each eccentricity ring
3. Plot ratio vs eccentricity

**Expected result (pre-eccentricity-fade):**
- Flat cardinal advantage (~1.3–1.5×) at all eccentricities — doesn't match biology

**Expected result (post-eccentricity-fade):**
- Cardinal advantage ~1.3–1.5× at 2–4°
- Advantage diminishes to ~1.1× by 8°
- Advantage ~1.0× (no difference) by 12° for fine bands
- Coarse bands retain ~1.1× advantage to ~20°

### 4.2 Stimulus: dense-table.html

120-row issue tracker table. Fixation at top-left (15%, 12%) so table content spans 0–15° eccentricity.

**Measurement procedure:**
1. Capture isotropic vs oriented at identical fixation
2. Compute per-row mean luminance difference between isotropic and oriented captures
3. Plot row-level delta vs eccentricity (each row is at a known y-offset from fixation)

**Expected result (post-eccentricity-fade):**
- Rows near fixation: minimal delta (both conditions identical in fovea)
- Rows at 3–8° eccentricity: maximum delta (cardinal bonus active)
- Rows at 12°+ eccentricity: delta diminishes (eccentricity fade attenuates bonus)
- This should produce a characteristic "hump" profile peaking at ~5° eccentricity

### 4.3 Comparison against Berkley et al. (1975)

Berkley et al. measured acuity (highest resolvable spatial frequency) for H, V, and 45° gratings at eccentricities 0°, 2°, 5°, 8°, 12°, 18°. The cardinal/oblique acuity ratio was:
- ~1.3 at 0° (fovea)
- ~1.2 at 5°
- ~1.0 at 8–18° (disappears, subject-dependent)

We can measure the analogous quantity: at each eccentricity, what is the finest DoG band that retains >50% weight for a cardinal vs oblique edge? The ratio of those band indices is our "acuity advantage."

### 4.4 Comparison against Essock (1990)

Essock measured contrast sensitivity for H vs 45° gratings at 1 cpd along the horizontal meridian out to 40°. The cardinal advantage was ~10–15% at all tested eccentricities, including far peripheral.

We can validate by checking that coarse DoG bands (3-5, corresponding to ~0.5–1 cpd) still show a small cardinal bonus at 20–30° eccentricity with the eccentricity fade active.

---

## 5. Validation Report Format

Following the v2.2 Claim/Basis/Result structure:

### Claim 1: Cardinal edges survive further in the parafovea

**Claim:** At 3–6° eccentricity, cardinal (H/V) edges retain 30–50% more spatial detail than oblique edges.
**Basis:** Appelle (1972), Campbell et al. (1966) — oblique effect magnitude.
**Result:** _pending_

### Claim 2: The oblique effect diminishes by 10–18° for fine detail

**Claim:** At eccentricities >10°, fine DoG bands (0–2) show no cardinal advantage.
**Basis:** Berkley, Kitterle & Watkins (1975) — disappearance at 8–18°.
**Result:** _pending_

### Claim 3: Coarse structure retains cardinal advantage further

**Claim:** Coarse DoG bands (4–6) retain a small (~10%) cardinal advantage out to 20–30°.
**Basis:** Essock (1990) — global oblique effect persists at low SF.
**Result:** _pending_

### Claim 4: No orientation bonus in flat regions

**Claim:** Uniform-luminance regions show zero difference between isotropic and oriented modes.
**Basis:** Architecture — gradient magnitude gate rejects flat regions.
**Result:** _pending_

### Claim 5: Dense table shows "hump" profile

**Claim:** The isotropic-vs-oriented delta peaks at 4–7° eccentricity, not at the maximum eccentricity.
**Basis:** Eccentricity fade (Berkley 1975) combined with band rolloff (M-scaling).
**Result:** _pending_

---

## 6. Files

### Implementation
- `renderer/shaders/peripheral.frag` — eccentricity fade in band boost loop
- `renderer/webgl-renderer.js` — no changes needed (visual_ecc already passed)

### Validation stimuli
- `scrutinizer-www/src/reference-pages/oblique-effect.html` — Gabor patch rings
- `scrutinizer-www/src/reference-pages/dense-table.html` — 120-row issue tracker

### Validation reports (to be generated)
- `tests/validation/reports/oblique-effect-report.html` — Claim/Basis/Result with charts

---

## 7. References

1. **Appelle, S.** (1972). Perception and discrimination as a function of stimulus orientation: the "oblique effect" in man and animals. *Psychological Bulletin*, 78(4), 266-278. doi:10.1037/h0033117

2. **Berkley, M. A., Kitterle, F. L. & Watkins, D. W.** (1975). Grating visibility as a function of orientation and retinal eccentricity. *Vision Research*, 15(2), 239-244. doi:10.1016/0042-6989(75)90213-8

3. **Essock, E. A.** (1990). The influence of stimulus length on the oblique effect of contrast sensitivity. *Vision Research*, 30(8), 1243-1246. See also: Essock, E. A. (1996). Evidence of a global oblique effect in human extrafoveal vision. *Perception*, 25(5), 523-530. doi:10.1068/p250523

4. **Campbell, F. W., Kulikowski, J. J. & Levinson, J.** (1966). The effect of orientation on the visual resolution of gratings. *Journal of Physiology*, 187(2), 427-436.

5. **Furmanski, C. S. & Engel, S. A.** (2000). An oblique effect in human primary visual cortex. *Nature Neuroscience*, 3(6), 535-536. doi:10.1038/75702

6. **Barbot, A., Xue, S. & Carrasco, M.** (2021). Cortical magnification eliminates differences in contrast sensitivity across but not around the visual field. *eLife*, 10, e84205.

7. **Toet, A. & Levi, D. M.** (1992). The two-dimensional shape of spatial interaction zones in the parafovea. *Vision Research*, 32(7), 1349-1357.

8. **Hubel, D. H. & Wiesel, T. N.** (1962). Receptive fields, binocular interaction and functional architecture in the cat's visual cortex. *Journal of Physiology*, 160(1), 106-154.

9. **Li, B., Peterson, M. R. & Freeman, R. D.** (2003). Oblique effect: a neural basis in the visual cortex. *Journal of Neurophysiology*, 90(1), 204-217. doi:10.1152/jn.00954.2002
