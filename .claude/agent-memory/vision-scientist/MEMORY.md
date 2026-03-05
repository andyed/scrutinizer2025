# Vision Scientist Agent Memory

## Scrutinizer Project Architecture
- Foveated vision renderer in WebGL (fragment shader: `renderer/shaders/peripheral2.frag`)
- Neuro-architecture pipeline: LGN (gating) -> V1 (geometry/distortion) -> V4 (aesthetics)
- DoG band decomposition (v1.6+): exploits hardware MIP chain for eccentricity-dependent spatial frequency attenuation
- Key doc: `docs/foveated-vision-model.md`
- BGRA->RGBA swap throughout shader due to Electron capture quirk

## Review Findings (2026-02-27)
- See `dog-review-findings.md` for detailed technical review of DoG implementation

### RESOLVED (2026-03-03)
- ~~MIP chain is NOT a Gaussian pyramid~~ — all docs now say "approximate Laplacian pyramid (box/bilinear, not Gaussian)" with Burt & Adelson 1983 citation
- ~~2x geometric progression for band cutoffs is steeper than biological M-scaling~~ — replaced with linear M-scaling: cutoff_k = E2 * (2^k - 1), giving 1, 3, 7, 15 × E2. E2 recalibrated (0.5→0.15 High-Key, 0.4→0.12 Biological)
- ~~Band differences can go negative; no clamping~~ — shader now clamps final result to [0,1]

### OPEN
- E2 parameter operates in normalized screen coords, not degrees of visual angle -- naming could mislead
- coupledEccentricity in processV4 cancels out fovea_radius, so DoG is driven by distortionStrength not geometric eccentricity
- Cones/"What" and Rods/"Where" labels in Section 1.1 conflate with dorsal/ventral stream terminology

## CMF-to-MIP Review (2026-03-03)
- See `cmf-mip-review.md` for detailed analysis of Blauch feedback
- Key finding: `ln(1+r/a)` is algebraically identical to `ln(r+a)-ln(a)` but Blauch wants the FOVI/Schwartz notation
- Correct shader form: `mipLevel = maxMipLevel * [ln(r+a) - ln(a)] / [ln(r_max+a) - ln(a)]`
- Pass `u_cortical_max = ln(r_max+a) - ln(a)` as uniform instead of collapsed `k`
- Two interpretations: "halvings" (log2, direct MIP) vs "normalized cortical distance" (ln, FOVI-style)
- Schwartz (1980): w = log(z+a), cortical distance = ln(r+a) - ln(a), CMF = 1/(r+a)
- FOVI code (coords.py): `log(radius+cmf_a) - log(cmf_a)` normalized by `log(fov/2+cmf_a) - log(cmf_a)`

## Chromatic Pooling Review (2026-03-04)
- See `chromatic-pooling-review.md` for detailed findings
- castleCSF k_e values (0.059 RG, 0.004 YV) are DETECTION THRESHOLDS, not suprathreshold appearance
- Fix implemented: suprathreshold power-law exponent (default 0.5), Red Kill Switch guarded
- **EMERGING CONSENSUS: peripheral desaturation has been overstated**
  - Rozman & Martinovic 2025: desaturation is NOT color-specific; same for luminance when matched for threshold distance
  - Jiang et al. 2022: power-law exponents 0.39-0.84 (mean ~0.63); no chrom/achrom difference once equated
  - Bowers et al. 2025: RG decay is non-exponential (biphasic); castleCSF over-predicts beyond 20 deg
  - Tyler 2015: eccentricity-scaled stimuli appear vivid — loss is size-dependent
  - Hansen et al. 2009: THRESHOLD study only — shows cone opponency persists to 50 deg with large stimuli, but does NOT measure suprathreshold appearance. Overcited in our docs for saturation retention.
- **Rosenholtz/TTM framework**: pooling preserves mean chromaticity; only fine chromatic detail is lost
- **RESOLVED (2026-03-04)**: RG decay is now frequency-dependent (u_rg_freq_decay = 0.003, ~1/3 of YV's 0.008). Both channels have per-band attenuation — large red regions preserve hue further than small red features. Size-dependent color preservation now works for both RG and YV.
- **Open**: consider raising supra_exponent from 0.5 to 0.65 (Jiang et al. mean ~0.63)

## Visual Verification Duty

After any shader or pipeline change that affects rendering output, the vision-scientist agent should:

1. **Request golden capture regeneration** (`npm run capture-golden`)
2. **Generate before/after comparisons** (`node scripts/generate-chromatic-comparison.js` or similar)
3. **Review comparison images** — verify the visual output matches biological predictions:
   - Does the change produce the expected perceptual effect?
   - Are there artifacts (banding, color shifts, dead zones)?
   - Does the fovea remain clean (no chromatic distortion at fixation)?
   - Do the on/off pairs show the predicted asymmetry?
4. **Flag discrepancies** between claimed behavior and observed output

Comparison images live in `docs/golden/chromatic-comparison/`. The script (`scripts/generate-chromatic-comparison.js`) uses pngjs bitmap compositing — no external dependencies.

## Foveal Size Calibration

### The Core Problem
The shader hardcodes `fovea_deg = 2.0` in 6 places in `peripheral2.frag`. This maps `normEcc` (pixels / fovea_radius) to degrees via `ecc_deg = normEcc * 2.0`. With default `foveaRadius: 180px` on a 1536×914 viewport, the horizontal edge maps to only ~8.5° — far less than the ~40-50° half-field of a real monitor. This is why chromatic pooling color loss isn't visible at viewport edges.

### Foveal Size in Pixels (Reference)
Formula: `S_px = 2 × D × tan(θ/2) × (resolution / screen_width_cm)`

| Setup | px/deg | Fovea radius (2°) | Fovea diam | Viewport H-edge |
|-------|--------|-------------------|------------|-----------------|
| 24" 1080p @ 60cm | 38 | 76 px | 152 px | ~20° |
| **16" MBP M3 @ 20" (Andy's)** | **44 CSS** | **89 CSS px** | **178 CSS px** | **~19°** |
| 14" MBP Retina @ 20" | 44 CSS | 89 CSS px | 178 CSS px | ~16° |
| 27" 4K @ 60cm (2x) | 38 | 76 px | 152 px | ~22° |

Key insight: the 2° foveal diameter is ANGULAR, fixed by eye physiology. It's tiny — about 2% of the visual field. On a 1080p screen at 60cm, it subtends only ~76px diameter.

### Current `foveaRadius: 180px` vs Reality
The default 180px foveal radius (~360px diameter) is ~2× the correct value on Andy's 16" MBP (89px), ~2.4× on 24" 1080p (76px). This means:
- The "fovea" in Scrutinizer extends to ~4° instead of 2°
- Eccentricity values are compressed — viewport edges reach ~9-11° instead of ~19-22°
- All downstream models (DoG, chromatic pooling, crowding) under-attenuate

### Calibration vs Comfort — The Key Architectural Insight
`foveaRadius` currently conflates two roles:
1. **Calibration**: denominator for `normEcc`, feeds eccentricity to all models
2. **Comfort**: size of the unprocessed clear zone (89px feels aggressive)

Inflating for comfort breaks calibration. The clean split (documented in ROADMAP):
- `px_per_deg` — physical calibration (from blind spot / camera / screen geometry)
- `foveaRadius` — comfort clear zone (user preference, allowed to exceed calibrated fovea)
- `ecc_deg = dist_px / px_per_deg` — derived from calibration, NOT from foveaRadius

### Calibration Pipeline — Current State
1. **Implemented (v1.3+)**: Motion Silence Illusion staircase — perceptually calibrates foveal radius in pixels. See `docs/foveal-calibration-logic.md`
2. **NOT implemented**: Pixels-per-degree ratio. The staircase finds fovea_radius but doesn't propagate a proper angular mapping.
3. **Planned (Priority 2 in ROADMAP)**: "Calibrated Visual Angles" — propagate actual px/deg through the pipeline. See `ROADMAP.md` lines 411-458.

### Consumer-Hardware Calibration (Planned)
See `~/Documents/dev/backlog.md` lines 71-112:
- **MediaPipe Iris**: Viewing distance estimation from webcam iris diameter
- **WebGazer.js**: Gaze tracking for fovea center
- **Li et al. 2020 Virtual Chinrest**: ±3.25cm viewing distance accuracy via blind spot method
- **Motion Silence staircase**: Already implemented, validates perceptual fovea boundary

### Student Project: Calibrated Visual Angle Pipeline
See `docs/grad-student-projects.md` Project 1.3:
- Goal: Derive actual pixels-per-degree from viewing distance + screen geometry
- Blind spot calibration (~15° eccentricity) as a second anchor point beyond fovea
- Would make `fovea_deg` data-driven instead of hardcoded
- Ties into the `u_cortical_max` uniform (currently computed from hardcoded params)

### Attenuation Table Diagnostic
`scripts/chromatic-attenuation-table.js` reproduces shader math in JS:
- At horizontal viewport edge (~8.5°): YV coarse retains 94%, RG coarse retains 56%
- Bowers cross-check at 15°: model RG threshold = 11.7% (Bowers = 29%) — model overshoots
- Suprathreshold correction (0.5 exponent) brings appearance to 34%, closer to Bowers

### Implication for Reviews
When reviewing chromatic pooling or any eccentricity-dependent effect, always note:
- The `fovea_deg = 2.0` mapping compresses the visual field
- Real-world attenuation would be MORE dramatic with calibrated angular mapping
- Current model is conservative (under-attenuates) at viewport edges

## Key Parameters
- dog_e2: default 0.15 (High-Key), 0.12 (Biological) -- normalized units, not degrees
- dog_sharpness: 0.0=biological (wide transitions), 1.0=sharp
- fovea_radius normalized to screen height
- parafovea = 2.5x fovea_radius
- fovea_deg = 2.0 (hardcoded in shader, 6 places) -- the critical calibration bottleneck
