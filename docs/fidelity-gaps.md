# Fidelity Gaps: Model vs. Published Literature

Stack-ranked discrepancies between Scrutinizer's peripheral rendering and empirical measurements from peer-reviewed vision science. Each gap includes the published evidence, current model behavior, and severity.

Last updated: 2026-03-15

---

## Ranking criteria

- **Impact**: How much does this gap change the rendered output vs. ground truth?
- **Coverage**: What fraction of the visual field or content does this affect?
- **Evidence quality**: Peer-reviewed > preprint > extrapolation > assumption

---

## 1. Foveal calibration default (all eccentricities ~2x compressed)

**Severity**: Critical — affects every pixel outside the fovea
**Evidence**: Engineering measurement
**Status**: Calibration tool exists, default is wrong for most displays

`fovealRadius` defaults to 45px = 1° visual angle, calibrated for MacBook Pro Retina at 20". On a 27" 4K at 24", 45px ≈ 0.5°, doubling all eccentricities. On a 13" 1080p at 18", 45px ≈ 1.8°, halving them.

**Current model**: Hardcoded default (`renderer/config.js:4`). Calibration tool exists (`renderer/foveal-calibration.js`) but is opt-in with no auto-detection.

**Fix path**: Auto-estimate from `screen.width`, `screen.height`, `devicePixelRatio`, and assumed 60cm viewing distance. Prompt calibration on first run.

**Files**: `renderer/config.js`, `renderer/foveal-calibration.js`, `renderer/webgl-renderer.js:780-784`

---

## ~~2. RG exponential over-predicts beyond 20° (biphasic decay)~~ FIXED

**Severity**: High — RG retention at 75° was 0.2% (model) vs 4% (measured)
**Evidence**: Bowers, Gegenfurtner & Goettker (2025), JOV 25(11):7
**Status**: Fixed in this PR — biphasic piecewise model

castleCSF uses a single exponential for RG eccentricity decay. Bowers et al. show the real decay is biphasic: steep to ~15-20°, then the rate slows. The pure exponential over-predicted RG loss by 20× at 75°.

**Fix applied**: Piecewise decay with fast rate (k=0.054) below 15° and slow rate (k=0.014) above. Parameters calibrated so THRESHOLD matches Bowers normalized to 5°; supra_exponent then converts to appearance. Shader: `peripheral.frag:378-387`. Config: `rg_decay`, `rg_decay_slow`, `rg_knee_deg`.

---

## 3. Suprathreshold exponent at low end of observed range

**Severity**: Medium — affects perceived saturation at all eccentricities
**Evidence**: Jiang, Shooner & Mullen (2022), JOV 22(12):3
**Status**: Open

Current `supra_exponent = 0.5`. Jiang et al. measured power-law exponents: RG mean 0.63, YV mean 0.73, Ach mean 0.66 (5 observers, 12° eccentricity). Our value of 0.5 over-compresses threshold decay, making peripheral colors appear more saturated than they should.

**Current model**: Single shared exponent for all channels (`renderer/webgl-renderer.js:163`).
**Published data**: Per-channel exponents differ — RG ≈ 0.63, YV ≈ 0.73.
**Fix path**: Raise to 0.65 (mean across channels/observers), or split into per-channel exponents.

---

## 4. Screen chromaticity coverage is fabricated

**Severity**: Medium — affects the domain transfer from lab to screen
**Evidence**: No published data; internal assumption
**Status**: Open

The stimulus-domain transfer assumes screen content has specific chromatic spatial coverage (e.g., saturated accents are spatially sparse vs. lab stimuli that fill the field). These numbers are asserted without measurement.

**Fix path**: Measure chromatic spatial coverage across a real web corpus (e.g., top 1000 sites). Compute what fraction of pixels at each eccentricity exceed various chroma thresholds.

---

## 5. RG frequency interaction unsourced

**Severity**: Medium — affects whether fine vs coarse chromatic detail decays differently
**Evidence**: castleCSF reports k_ef ≈ 0 for RG (2e-69); we use 0.003
**Status**: Open

castleCSF's fitted RG frequency-dependent decay is effectively zero, meaning RG sensitivity drops uniformly across spatial frequencies. We use k_ef=0.003 (weak frequency dependence) without published support.

**Current model**: `rg_freq_decay: 0.003` in `shared/modes.json`
**castleCSF source**: k_ef for RG ≈ 0 (Ashraf et al. 2024, MATLAB source)
**Fix path**: Need multi-SF peripheral RG data. Bowers tested multiple SFs — could extract per-SF retention curves.

---

## 6. Crowding regularity constants are fabricated

**Severity**: Medium — affects crowding onset/severity for structured content
**Evidence**: No published data for screen content regularity
**Status**: Open

The crowding model uses regularity constants (0.3/0.8/0.0 for different content types) that were asserted without measurement. Real screen content has varying regularity that affects crowding strength.

**Fix path**: Measure structural regularity (autocorrelation, spectral peaks) across real web content at various eccentricities.

---

## Published data sources

| Paper | What it measured | Eccentricities | Used for |
|-------|-----------------|----------------|----------|
| Bowers et al. 2025 | Threshold CSF (RG, YV, Ach) | 5-90° | RG/YV/Ach decay rates, biphasic shape |
| Jiang et al. 2022 | Suprathreshold contrast matching | 4-18° | supra_exponent (threshold→appearance) |
| castleCSF (Ashraf 2024) | Analytical CSF model | continuous | k_e, k_ef base parameters |
| Hansen et al. 2009 | Threshold detection/identification | 10-50° | Color naming accuracy (NOT appearance) |
| Mullen & Kingdom 2002 | Threshold contrast sensitivity | 0-25° | RG vs BY differential distribution |
| Rozman & Martinovic 2025 | Perceived desaturation (preprint) | 4-18° | Desaturation not color-specific |
| Bouma 1970 | Critical spacing | 2-12° | Crowding geometry |

---

*This document tracks known model-vs-reality gaps. New gaps should be added with published evidence and ranked by impact on rendered output.*
