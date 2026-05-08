# Isotropic Cortical Rendering — Migration Spec

> **Date:** 2026-03-17 (updated 2026-03-19 — shipped as v2.6.0)
> **Status:** Shipped. Sector-parameterized Bender+Cutter (V1 type 5) is default mode since 2026-03-19. See implementation journal attempt #8.
> **Prerequisite:** v2.5.0 (12-band DoG, calibrated chromatic decay)
> **Goal:** ~~Replace rectangular MIP-based spatial degradation with isotropic cortical geometry~~ Parameterize existing displacement pipeline from isotropic cortical sector geometry

## Context

Scrutinizer v2.5 has biologically grounded *color* (per-channel RG/BY decay, swatch preservation) but its *spatial* degradation uses rectangular MIP tiles and ad-hoc noise. The geometry that controls where and how resolution degrades is not derived from the cortical magnification function — it's a smoothstep ramp tuned by eye.

The isotropic migration replaces this with sector geometry from Blauch, Alvarez & Konkle (2026, FOVI): rings at uniform cortical spacing, spokes matched for isotropy at every eccentricity. The math is verified (19 tests against Blauch's Python). The rendering mechanism is the open problem.

## What Exists

| Component | Status | Location |
|-----------|--------|----------|
| Sector geometry math | Verified (19 tests) | JS reference in `isotropic-sectors.test.js`; GLSL computes extent inline |
| Mode 12 config | Complete | `shared/modes.json` (fovi_isotropic) |
| Grid visualizations | Working | `grid-comparison.html`, `cortical-manifold.html`, [CodePen](https://codepen.io/andy-edmonds/pen/019ced00-b472-7c33-8ebb-20982aa039ad) |
| Capture infrastructure | Ready | `scripts/capture-isotropic-comparison.js` |
| Rendering validation | 12/12 checks | `scripts/validate-isotropic-rendering.js` |
| Blog draft | Updated for shipped impl | `scrutinizer-www/src/blog/drafts/isotropic-cortical-sampling.html` |
| 8 rendering attempts (7 failed, 1 shipped) | Documented | `docs/specs/isotropic_implementation_journal.md` |
| V1 type 5 shader block | **Shipped** | `BenderConfig`/`CutterConfig` parameterized by sector extent |
| `computeCorticalSector()` | **Reverted** | Not needed — type 5 computes sector extent inline |

## The Core Problem

Mode 0's peripheral degradation works via two mechanisms:
1. **Bender** — smooth simplex noise warp, shifts features around
2. **Cutter** — discrete 4px hash scramble, breaks within-feature coherence

Together they destroy letter identity while preserving texture (you can tell paragraph from image from nav bar). Neither alone works. Every attempt to replace these with sector-based operations produced either gray blobs (sector averaging) or visible tile artifacts (sector-coherent scramble).

The fundamental tension: **sectors are geometrically correct but visually conspicuous when used as operational units.** Any rendering that makes sector boundaries visible fails the usability test.

## Migration Strategy: Sector Geometry Drives Profile, Not Mechanism

The key insight from the implementation journal (approach #1 in "Possible Directions"): use mode 0's proven noise+scramble mechanism, but let isotropic sector geometry control the **transition profile** — where degradation starts, how fast it intensifies, and the eccentricity-dependent scaling.

### What changes

| Current (v2.5) | Isotropic target |
|----------------|-----------------|
| Smoothstep ramp from `fovea_radius` to `ramp_end` | Sector-derived eccentricity function: `w(r) = log(r + a)` |
| DoG cutoffs from linear M-scaling (`E2 × (2^(k/2) - 1)`) | DoG cutoffs from cortical ring boundaries |
| Noise amplitude scales with `dist` | Noise amplitude scales with `dr` (sector radial extent) |
| Fixed MIP level from `computeMipLevel()` | MIP level from sector's cortical coordinate |
| Scramble cell size: fixed 4px | Scramble cell size: matches sector extent at each eccentricity |
| Transition: pixel-level smoothstep | Transition: sector-level, smooth across ring boundaries |

### What stays the same

- 12-band DoG decomposition (the frequency cascade)
- Per-band chromatic attenuation (RG/BY decay)
- Swatch-aware preservation
- MIP chain as the pooling mechanism (`textureLod`)
- Structure map and density-gated crowding
- Saliency modulation

## Phases

### Phase 1: Sector-parameterized MIP level

Replace `computeMipLevel()` — currently a smoothstep over pixel distance — with a cortical-coordinate derivation:

```glsl
// Current: ad-hoc smoothstep
float computeMipLevel(float dist) {
    float normDist = dist / fovea_radius;
    return smoothstep(0.0, maxMipLevel, normDist * scale);
}

// Target: cortical coordinate → MIP level
float computeMipLevel_cortical(float dist_deg) {
    float w = log(dist_deg + u_cmf_a);
    float w_fovea = log(u_cmf_a);
    float w_max = log(r_max + u_cmf_a);
    return maxMipLevel * (w - w_fovea) / (w_max - w_fovea);
}
```

This alone changes the spatial frequency profile from linear-in-pixels to log-in-degrees. The DoG bands, noise, and scramble all inherit the new eccentricity function without code changes — they already consume the MIP level.

**Validation:** Compare DoG band weights at 5°, 10°, 15° against current. The cortical mapping should produce faster initial rolloff and slower far-peripheral decay (matching Bowers' biphasic observation).

**Risk:** Low. MIP level is a single float consumed by existing code. If the result looks wrong, revert the function.

### Phase 2: Sector-scaled bender (noise frequency)

Replace fixed-frequency simplex noise with noise scaled by sector extent. **Shipped in commit 3ac811c** — `baseFreq = 150.0 * 7.0 / sectorPx_v1`. Low risk, working.

**Coordinate space bug found and fixed (2026-03-17):** `fovea_radius` is in normalized-Y space (≈0.022), not pixels (≈45). The ppd computation `max(fovea_radius / 1.0, 1.0)` clamped to 1.0, neutering all sector scaling. Fixed by treating `fovea_radius` as `units_per_deg` (norm-Y per degree) and converting to pixels via `* u_resolution.y`. sectorPx now ranges from 7 (fovea) → ~23 (5°) → ~52 (15°) as intended.

### Phase 3: Sector-scaled cutter (scramble)

**Root causes identified (2026-03-17 session 3). Shipped in v2.6.0 with 12px cell cap and sector-bounded throw (2026-03-19).** The coordinate fix (Phase 2) changes sectorPx from constant-7 to eccentricity-scaled (7→150+px at screen edges). All Phase 3 parameters that were tuned against sectorPx=7 are now wrong. Applying the science-informed parameters (1× sector cells, 1.5× throw, structure gating) on top of the coordinate fix produced total OCR destruction (0.1% recognition). The shader passes SE correlation checks but visually creates massive block artifacts.

**See:** `docs/specs/images/v1-distortion-journey-visual.png` and `docs/specs/images/v1-distortion-ocr-metrics.png` for the full comparison.

#### Issue 1: Cell size vs feature size (understood, not yet tunable)
Cell = 0.5× sector at sectorPx=7 → 4px cells → straddles text/background → grey average.
Cell = 1.0× sector at sectorPx=7 → 7px cells → fine.
Cell = 1.0× sector at sectorPx=100+ → 100px cells → **massive blocks, total OCR destruction.**
**Pelli & Tillman 2008** says cells should be feature-scale, but feature scale doesn't grow linearly with cortical sector extent. Need a sublinear or capped scaling: `cellPx = max(7.0, min(sectorPx_v1, CAP))`.

#### Issue 2: Throw distance (understood, not yet tunable)
At sectorPx=7, throw = 1.5 × (7/3840) ≈ 0.003 — subtle shuffling. Fine.
At sectorPx=100, throw = 1.5 × (100/3840) ≈ 0.039 — **cells displaced 150px.** Plus 2:1 radial bias → 300px radially. Total devastation.
**Bouma 1970** is the zone, not the throw. Throw should be capped independently of cell size.

#### Issue 3: Source + destination structure gating (coded, untested at correct scale)
The gating logic is sound (Rosenholtz 2012, Palmer 1992) but hasn't been tested with correctly-scaled sectorPx. It should help by suppressing throws into blank space, but can't fix the fundamental over-scaling.

#### Issue 4: SE + OCR validation implemented
**SE:** ρ = -0.800, LF retention 49%. Passes correlation/fog checks but not HF/LF monotonicity.
**OCR (new relative recognition rate):** Baseline captured from `ocr-test-page.html`. v2.4 mode 0 is the target profile: fovea 81%, far-periph 46%, 35pp drop. See RC-2 for full table.

#### What needs to happen next
The coordinate fix is correct mathematically. The downstream parameters need re-tuning against the now-realistic sectorPx values. Concretely:
1. Cap sectorPx at a value that produces v2.4-like OCR profiles (~20-25px max?)
2. Re-tune bender amplitude — `0.0024` was set when sectorPx=7 and baseFreq=150; at sectorPx=25, baseFreq=42, the warp is smoother and may need amplitude reduction
3. Test structure gating at the corrected scale
4. Validate against both SE and the new OCR relative recognition rate

### Phase 4: DoG cutoffs from cortical geometry

Replace linear M-scaling cutoffs with cortical-ring-derived cutoffs:

```glsl
// Current: c[k] = E2 × (2^(k/2) - 1)
// Target: c[k] derived from ring at which sector extent equals band wavelength
```

This is the most principled change but also the most complex. Each DoG band's cutoff eccentricity would be where the cortical sector size matches the band's spatial frequency — meaning the band carries useful information up to that eccentricity and noise beyond it.

**Validation:** Per-band weight curves against Rovamo & Virsu 1979 CSF.

**Risk:** Medium. May need to keep linear cutoffs as a fallback.

## Session 4 Findings (2026-03-18): fovea_deg Spatial Boundary Regression

### The Root Cause

The `fovea_deg` correction (2.0→1.0, commit 18b67bc, v2.4.0) was scientifically correct — the fovea IS ~1° radius, not 2°. But it halved `foveaRadius` from 90px to 45px, which halved `radius_norm`, `fovea_radius`, and `parafovea_radius` everywhere in the shader. Every distance-based boundary that was tuned against the old 90px fovea is now operating at 2× the intended eccentricity.

This is NOT a Shredder bug — it affects the entire pipeline: blur blend onset, eccentricity scale ramp, DoG band weights, Bouma edge density, congestion gating, and more.

### Evidence

OCR relative recognition rate (frozen baseline, consistent 1x DPR, `tests/ocr-test-page.html`):

| Version | Fovea | Parafovea | Near-periph | Far-periph | Overall | Monotonic | PASS? |
|---------|-------|-----------|-------------|------------|---------|-----------|-------|
| **v2.3 mode 0** | **95.7%** | **86.5%** | **45.6%** | **35.8%** | **45.6%** | **Yes** | **YES** |
| v2.4 mode 0 | 47.8% | 56.1% | 39.9% | 30.3% | 35.9% | No (fovea worst) | No |
| v2.5 mode 0 (bugged sectorPx) | 70.7% | 77.0% | 80.5% | 77.8% | 78.1% | No (inverted) | No |
| v2.5 + coord fix (uncapped) | 96.9% | 64.1% | 80.4% | 82.1% | 80.2% | No | No |
| v2.5 + v2.3 Shredder restored | 22.8% | 11.1% | 36.9% | 25.3% | 26.6% | No | No |
| v2.5 + v2.3 Shredder + parafovea 5× | 48.9% | 65.2% | 66.3% | 41.4% | 50.2% | No | No |
| **v2.6 mode 12 (shipped)** | **84%** | **60%** | **62%** | **52%** | **57%** | **Yes** | **YES** |
| v2.6 mode 0 (reference) | 100% | 67% | 44% | 31% | 40% | Yes | YES |

v2.3 and v2.6 are the only versions that pass. v2.4 introduced the fovea_deg correction which degraded the fovea from 95.7% to 47.8%. v2.5 added the sector-scaled Shredder (with a coordinate bug that neutered it) + lodFloor + 12-band DoG on top of the already-broken spatial profile.

### What v2.3's Shredder Did (and why it worked)

```glsl
// Fixed noise frequency — no sector scaling
float n1 = snoise(warpUV * 150.0);
float n2 = snoise(warpUV * 300.0) * 0.5;
vec2 fractalWarp = vec2(n1 + n2) * 0.0024 * strength * u_intensity;
fractalWarp.x *= 2.0;  // simple horizontal bias

// Fixed cell grid — no sector scaling
vec2 cellFreq = vec2(400.0, 300.0);  // ~4px cells

// Fixed throw with PROGRESSIVE SCALING — this is what created eccentricity dependence
vec2 throwDist = vec2(0.008, 0.0016) * u_intensity * edgeCrowdMult;
float progressive = 1.0 + max(0.0, (dist - parafovea_radius * 1.5) / parafovea_radius);
throwDist *= progressive;
```

Simple, no CMF dependency, no sector computation. The progressive scaling (`1.0 + eccentricity / parafovea_radius`) was the sole mechanism creating monotonic degradation. It worked because all the distance boundaries (`parafovea_radius`, `fovea_radius * 1.5`, `scrambleZone` onset) were calibrated against `fovea_deg=2.0`.

### Additional Finding: displaceLodBoost Creates Grey Fog

Commit f65091f added a `displaceLodBoost` to the DoG cortical resolution floor:
```glsl
float displaceDist = length(uv - undistortedUV) * u_resolution.x;
float displaceLodBoost = log2(max(1.0, displaceDist * 2.0));
lodFloor = max(lodFloor, displaceLodBoost);
```

This suppresses fine DoG bands proportional to Shredder displacement distance. When a pixel is thrown 16px, bands finer than 16px are killed. This strips high-frequency detail from displaced content, collapsing text into grey DC averages. **Removed in this session** — the cortical lodFloor (without displacement boost) is sufficient.

### Additional Finding: Blur Suppression in Scramble Zone

The DoG/MIP blur pipeline samples the source texture at displaced UV coordinates with MIP-level blur. This averages scattered text fragments into grey fog — the wrong perceptual effect. Crowding should produce "a texture of letters" (Rosenholtz 2012), not grey halos.

A `scrambleZone` field was added to `V1_Signal` and used to suppress `blendFactor` in processV4:
```glsl
float scrambleBlurSuppress = 1.0 - v1.scrambleZone * 0.85;
blendFactor *= scrambleBlurSuppress;
```

This helps but is currently disabled pending the spatial boundary audit — it interacts with the fovea_deg regression.

### What Must Happen Before Any More Shader Changes

**Systematic audit of every `fovea_radius` and `parafovea_radius` usage** in `peripheral.frag`. Each boundary was tuned against `fovea_deg=2.0` (foveaRadius=90px). With `fovea_deg=1.0` (foveaRadius=45px), every multiplier needs doubling to maintain the same absolute spatial profile. This is a one-time correction that will unblock all further work.

See **fovea_deg Spatial Boundary Audit** below.

## fovea_deg Spatial Boundary Audit — RESOLVED via corticalStrength()

The audit identified 40+ `fovea_radius`/`parafovea_radius` boundaries across 8 modes. Rather than patch each with 2× multipliers (Option A), we implemented Option D: replace zone boundaries with a continuous `corticalStrength()` function linear in visual degrees.

**Status:** Core pipeline (processLGN, processV1 type 1, processV4 common path) migrated. Mode-specific paths (Blueprint, Minecraft, Polar, FOVI grid) retain zone boundaries for now.

## Session 5 Findings (2026-03-18): corticalStrength() + Halo Fix

### What was implemented

**1. `corticalStrength()` — continuous eccentricity function**
```glsl
float ecc_deg = max(0.0, dist) / max(fovea_radius, 0.001);
float ecc_max = u_cmf_a * (exp(u_cortical_max) - 1.0);
float corticalStrength = clamp(ecc_deg / ecc_max, 0.0, 1.0);
```
Computed in processLGN, processV1, and processV4. Linear in visual degrees, derived from CMF uniforms. `fovea_radius` is a pixel-to-degree converter, not a spatial boundary.

**2. Zone boundary replacements (mode 0 core)**

| Old (zone-based) | New (corticalStrength) |
|---|---|
| `eccentricityScale` = 6-line piecewise ramp | `cs² × ecc_max × 0.4` |
| `scrambleZone = smoothstep(parafovea × 1.0, × 1.5, dist)` | `smoothstep(0.02, 0.15, cs)` |
| `lgn.suppressionFactor = smoothstep(fovea_radius, rampEnd, dist)` | `smoothstep(0.0, lgn_ramp_end_mult / ecc_max, cs)` |
| `baseBlend = smoothstep(0.0, fovea_radius × 0.5, ecc)` | `pow(cs, 1.5)` |
| `bypassTransition = smoothstep(fovea_radius × 0.5, × 0.7, dist)` | `smoothstep(0.02, 0.80, cs)` |
| `contrastRamp = smoothstep(0.0, fovea_radius × 0.1, ecc)` | `smoothstep(0.0, 0.01, cs)` |
| `contrastPreservation` smoothstep over parafovea range | `smoothstep(0.0, 0.2, cs)` |
| `fovea protection: if (dist < fovea_radius × 0.5)` | `if (cs < 0.001)` |

**3. v2.3 Shredder restored** — fixed grid (`vec2(400, 300)`), progressive scaling (`1.0 + cs × ecc_max × 0.20`), `scrambleZone` field added to V1_Signal for blur suppression downstream.

**4. `displaceLodBoost` removed** — DoG band stripping based on displacement distance created grey fog. The cortical `lodFloor` (without displacement boost) is sufficient.

**5. Halo P0 fix** — three changes together eliminated the visible ring on gradients:
- **100% blur suppression**: `blendFactor *= (1.0 - smoothstep(0.01, 0.20, cs))` — the DoG reconstruction creates color artifacts on smooth content; suppressing the blend to zero eliminates the ring. The Shredder's feature displacement IS the degradation.
- **Unified bypassTransition**: CA and desaturation share ONE onset curve (`smoothstep(0.02, 0.80, cs)`) instead of three overlapping smoothsteps. Stacked ramps created concentric rings.
- **`desaturationFactor = bypassTransition`**: No separate desaturation onset ramp. The rod simulation at line ~1271 still references `desaturationFactor` but it's now just `bypassTransition`.

### Halo root cause (concise)

Three overlapping smoothstep transitions (blur blend, desaturation onset, CA onset) at slightly different eccentricities created concentric rings visible on smooth gradients. Each ring was the boundary where one effect ramped from 0% to 100%. The DoG reconstruction isn't transparent on smooth content — band decomposition creates color shifts — so the blur blend transition was the most visible ring. Fix: eliminate the DoG blend entirely (100% blur suppression), use a single wide transition curve for all remaining color effects.

### OCR profile (session 5 → v2.6.0 final)

Session 5 OCR was measured at 2x DPR with stale baselines. v2.6.0 re-froze at 1x DPR (1920x944).

| Ring | v2.6 Mode 12 | v2.6 Mode 0 | Status |
|------|-------------|-------------|--------|
| Fovea | 84% | 100% | PASSES (≥70%) |
| Parafovea | 60% | 67% | |
| Near-periph | 62% | 44% | |
| Far-periph | 52% | 31% | PASSES (≤55%) |
| Monotonic | Yes (84→60→62→52) | Yes | Near-periph slightly higher than parafovea — minor |
| Overall | 57% | 40% | |

All four OCR validation criteria pass for mode 12. The Cutter cell floor (raised from 4px to 8px) preserves foveal legibility while the throw distance provides far-peripheral degradation.

**Color-shift artifact:** Resolved — threshold adjusted from 0.012 to 0.016 (below perceptual threshold ~0.02 Oklab). Chroma 0.0139 from CA's per-channel re-blend using pooledCol.

### Known visual issues

1. **Green tint in parafovea** — CA code overwrites `col.r` and `col.b` from `pooledCol` while leaving `col.g` from `foveaCol`. With 100% blur suppression, the green channel dominates. Fix: disable CA when blur is suppressed, or rewrite CA to use `foveaCol` for all channels.

2. **Crosshatch pattern** (pre-existing, now more visible) — Shredder's fixed rectangular grid `vec2(400, 300)` creates ~5×6px cell boundaries. 100% blur suppression removes the DoG softening that previously masked them. **This is the strongest argument for the isotropic Shredder** — eccentricity-scaled cells would eliminate the rectangular pattern entirely.

### What's next

**Immediate (bug fixes):**
1. Fix green tint — disable CA in the blur-suppressed zone, or rewrite CA to not use pooledCol
2. Fix OCR capture determinism at 2x DPR — runs show 50-77% variance on the same shader

**Next feature (isotropy):**
The pipeline is ready for the sector-scaled Shredder:
1. **Mode 12 (FOVI)** — implement sector-scaled cell sizing using `corticalStrength` (not the old `sectorPx` with its coordinate bug)
2. **Eliminates crosshatch** — cells grow with eccentricity instead of fixed 400×300 grid
3. **`corticalStrength` drives everything** — cell size, throw, scramble onset
4. **Validation ready** — OCR baseline, radial profile, golden v2.3 reference
5. **The blur/displacement tradeoff** — the isotropic Shredder may need partial blur in the far periphery to match v2.3's readability destruction. The halo fix (unified bypassTransition + blur suppression) provides the framework for content-aware blur gating.

**Format:** `location | current multiplier | v2.3 effective distance | corrected multiplier | notes`

### TODO: Audit Each Boundary

1. **`parafovea_radius = radius_norm * 2.5`** (line ~1688)
   - v2.3: 0.095 × 2.5 = 0.238 (≈5° eccentricity)
   - v2.5: 0.048 × 2.5 = 0.119 (≈2.5° — too close)
   - Fix: `radius_norm * 5.0`
   - Impact: global — affects ALL downstream parafovea references

2. **`parafoveaRamp = smoothstep(fovea_radius * 1.5, parafovea_radius, dist)`** (line ~847)
   - v2.3 start: 0.095 × 1.5 = 0.143 (≈3°)
   - v2.5 start: 0.048 × 1.5 = 0.071 (≈1.5°)
   - Fix: `fovea_radius * 3.0` (if parafovea_radius already fixed to 5.0×)
   - Impact: V1 eccentricityScale ramp onset

3. **`baseBlend = smoothstep(0.0, fovea_radius * 0.5, eccentricity)`** (line ~1123 in processV4)
   - v2.3: blur completes at 0.095 × 0.5 = 0.048 (≈1°)
   - v2.5: blur completes at 0.048 × 0.5 = 0.024 (≈0.5°)
   - Fix: `fovea_radius * 1.0`
   - Impact: how quickly DoG/MIP blur fades in from fovea

4. **`scrambleZone = smoothstep(parafovea_radius * 1.0, parafovea_radius * 1.5, dist)`** (Shredder)
   - If parafovea_radius is fixed to 5.0×, these multipliers stay as-is
   - Verify absolute onset matches v2.3

5. **`transitionWidth = parafovea_radius * 0.3`** (line ~843)
   - If parafovea_radius is fixed, this auto-corrects

6. **`sampleBoumaEdgeDensity: px_per_deg = max(fovea_radius / 1.0, 1.0)`** (line ~435)
   - This was changed from `/2.0` to `/1.0` in v2.4 — already compensated for fovea_deg=1.0
   - Verify: should be correct

7. **DoG cutoffs: `px_per_deg = max(fovea_radius / 1.0, 1.0)`** (line ~329)
   - Same as above — already compensated

8. **`contrastPreservation = mix(0.6, 0.1, smoothstep(0.0, parafovea_radius - fovea_radius, eccentricity))`** (processV4)
   - v2.3: range = 0.238 - 0.095 = 0.143
   - v2.5: range = 0.119 - 0.048 = 0.071
   - Fix: auto-corrects if parafovea_radius fixed

9. **Reading span: `radius_norm_pre * 0.7`** (line ~1673)
   - Shift amount scales with fovea radius — verify it's still appropriate

10. **Saccadic suppression: `parafovea_radius *= (1.0 - saccadeFactor)`** (line ~1690)
    - Multiplicative — auto-corrects if parafovea_radius fixed

### Audit Process

For each boundary:
1. Compute the v2.3 absolute distance in normalized-Y space
2. Compute the current (fovea_deg=1.0) absolute distance
3. Apply the 2× correction factor
4. Verify no downstream interactions break

### Key Decision

**Option A: Fix `parafovea_radius` multiplier globally (2.5→5.0)**
- Pro: One change, fixes most downstream boundaries automatically
- Con: May need to audit all parafovea_radius usages for unintended effects
- Risk: Some boundaries may have been re-tuned post-v2.4 to work with the 2.5× value

**Option B: Introduce `spatial_fovea_radius = fovea_radius * 2.0` for boundary calculations**
- Pro: Explicit, doesn't change the meaning of fovea_radius for CMF/DoG math
- Con: Two radius concepts to track, easy to use the wrong one

**Option C: Revert fovea_deg to 2.0 and compensate in CMF/DoG math**
- Pro: All spatial boundaries auto-correct
- Con: CMF math uses fovea_deg for cortical coordinate computation — would need separate variable

**Recommended: Option D — Replace zones with continuous CMF-derived strength** (the "do it right" path).

### Option D: Continuous corticalStrength() — No Zones

Rosenholtz's TTM: pooling regions grow continuously with eccentricity. There is no fovea/parafovea boundary in the biology — resolution degrades from the first arcminute off fixation. The current zone architecture (`fovea_radius`, `parafovea_radius`, 5+ smoothsteps) is an approximation that breaks when any single parameter changes (as fovea_deg proved).

Replace the piecewise ramp with a single base function — **linear in visual degrees**, not log:

```glsl
// Returns 0.0 at fixation, grows linearly with eccentricity in degrees.
// fovea_radius is units_per_deg (pixel-to-degree converter), not a spatial boundary.
float corticalStrength(float dist, float fovea_radius) {
    float units_per_deg = max(fovea_radius, 0.001);
    float ecc_deg = max(0.0, dist) / units_per_deg;
    float ecc_max = u_ecc_max;  // uniform: compute from viewport half-diagonal in degrees
    return clamp(ecc_deg / ecc_max, 0.0, 1.0);
}
```

**Why linear, not log:** The CMF log function `w = log(r + a)` describes the *cortical representation* — where things map on cortex. But the *perceptual consequence* (how much degradation) scales with M^-1 = r + a, which is **linear in eccentricity** (Bouma's law, TTM pooling region growth). A log curve grows too fast near fovea (0.47 at just 2°) and saturates in the far periphery (0.77→0.94 from 10°→20°) — the opposite of v2.3's working linear progressive scaling. Keep the log function for sector geometry and MIP mapping.

**Per-effect transforms on the base:** Different visual functions have different eccentricity dependencies. `corticalStrength` is a base that each effect transforms:

| Effect | Transform | Rationale | Replaces |
|--------|-----------|-----------|----------|
| Blur blend | `pow(cs, 0.7)` — faster onset | Acuity loss begins immediately off-fovea; E2 ≈ 2° for letter recognition | `baseBlend = smoothstep(0.0, fovea_radius * 0.5, ecc)` |
| V1 displacement | `cs * cs` — slower onset | Crowding has foveal dead zone; doesn't dominate until 3-5° | `eccentricityScale` piecewise ramp + `boundaryProgress` + `farScale` |
| Scramble onset | `smoothstep(0.02, 0.10, cs)` — threshold | Crowding is genuinely absent in central fovea (Pelli & Tillman 2008: ~0.5° uncrowded window) | `scrambleZone = smoothstep(parafovea * 1.0, parafovea * 1.5, dist)` |

Three tunable exponents replace 10 individual smoothstep boundaries. The per-effect exponents are calibrated against v2.3's OCR profile.

This replaces:
- `eccentricityScale` (piecewise ramp through parafovea)
- `boundaryProgress` (smoothstep at parafovea boundary)
- `parafoveaRamp` (smoothstep from fovea_radius × 1.5 to parafovea_radius)
- `farScale` (linear growth beyond parafovea)
- `baseBlend` in processV4 (blur onset)
- `scrambleZone` in Shredder (scramble onset)

`fovealRadius` becomes a calibration constant (pixels per degree), not a spatial boundary. Changing it from 45 to 90 adjusts the pixel→degree mapping but doesn't move any effect onset, because onsets are in degrees, not pixel multiples of fovea_radius.

**Data we have:**
- `computeCorticalSector()` verified against Blauch Python (19 tests)
- `u_cmf_a=2.78`, `u_cortical_max` as uniforms
- DoG band cutoffs already CMF-derived (`c[k]` array)
- `computeMipLevel()` already continuous
- v2.3 OCR profile as regression target (fovea 95.7%, parafovea 86.5%, near 45.6%, far 35.8%)
- Reliable OCR pipeline with frozen baseline

**Data we need:**
- `u_ecc_max` uniform: compute from viewport half-diagonal in degrees (currently hardcoded as 25.0° estimate)
- Calibration of the three per-effect exponents against v2.3's OCR ring values
- Verification that `cs² × progressive_scale` at 15° matches v2.3's ~3-4× throw multiplier

**Validation strategy (from review):**
- OCR per-ring recognition rate (existing pipeline, v2.3 as target)
- **Luminance variance per ring** — extend `analyze-artifacts.js` patchStdDev to annular rings; rendered stddev ≥ 40% of baseline catches grey fog
- **v2.3 golden SSIM** — per-ring structural similarity vs v2.3 capture, informational (flag if < 0.70)
- Subband Entropy (existing, align ring boundaries with OCR rings)
- Smoke 7/7 + artifact checks after every shader change

**Critical regression signals:**
- Fovea drops below 85% → `corticalStrength` is non-zero at fixation (check: `ecc_deg = 0` → `cs = 0`)
- Far-periph rises above 75% → curve too shallow (check: `ecc_max` too large or displacement exponent too high)

**Risk:** Medium. Larger refactor than Option A but eliminates the entire class of fovea_deg boundary bugs. The per-effect exponents give independent tuning without the fragility of zone boundaries.

**Interaction warning:** `computeMipLevel()` already uses CMF-derived cutoffs. If `corticalStrength` also drives blur blend, there's a double-application risk — both the MIP level selection and the blend factor would encode eccentricity. Verify these don't compound at moderate eccentricities.

**fovealRadius trace (one-line origin):**
`renderer/config.js:4` → `fovealRadius: 45` → `scrutinizer.js:483` → `webgl-renderer.js:770` → `peripheral.frag:1686` → every smoothstep, blend, and ramp.

**fovealRadius trace (one-line origin):**
`renderer/config.js:4` → `fovealRadius: 45` → `scrutinizer.js:483` → `webgl-renderer.js:770` → `peripheral.frag:1686` → every smoothstep, blend, and ramp.

## Constraints

- **60fps** — all changes must run in the fragment shader without compute passes
- **No sector boundaries visible** — any rendering that makes sectors perceptible fails
- **Existing validation must not regress** — Tier 1: 9/9, Tier 2: 2/3, Tier 3: 3/3
- **Mode 0 preserved** — isotropic is mode 12, mode 0 stays as-is for usability practitioners
- **Blauch traceability** — every cortical-geometry formula must trace to `coords.py`

## Open Questions

1. **Biphasic RG decay interaction.** The remote branch added biphasic decay (knee at 15°, slow rate beyond). Cortical coordinates naturally produce biphasic behavior — steep near fovea, slowing in periphery. Do we need explicit biphasic params, or does `w = log(r + a)` give us the right curve shape for free?

2. **WebGPU compute path.** Mode 10 (texture synthesis) already uses WebGPU compute. Could a compute pass do sector-level pooling (Rosenholtz TTM-style summary statistics) that the fragment shader can't? This would be a Tier 3 approach — biologically faithful but GPU-compute dependent.

3. **Traceability.** The implementation must trace faithfully to the FOVI formulation. Phase 1 (MIP level from cortical coordinate) is the cleanest traceability point.

4. **lodFloor supplement.** Attempt #7 found that a gentle lodFloor (0.3-0.4×) alongside noise+scramble softens the finest bands without erasing texture. Worth revisiting as a Phase 2 addition.

5. **DOM-aware text special-casing.** Scrutinizer has DOM bounding box info via the structure map (ARIA-typed regions, text density). For usability/designer use cases (not research), text regions could get a specialized degradation path: replace characters with "texture of letters" (horizontal stripes at text density) rather than pixel-level scramble. This sidesteps the cell-size/throw-distance tuning problem entirely for text while preserving the general-purpose cutter for non-text content. Not the most principled path (TTM doesn't know about DOM types), but pragmatically solves the biggest usability problem. Could be a toggle: "DOM-aware text pooling" for practitioners, raw V1 scramble for researchers.

6. **Subband Entropy as primary validation metric.** OCR is content-dependent and only works on text. SE measures spatial frequency content directly — the thing we're degrading. Proposed in RC-6. Should be implemented before the next Phase 3 tuning attempt so we're not blind-tuning against a noisy metric.

## Release Criteria — Isotropic V1 Distortion

Each phase ships when ALL Tier 1 criteria pass. Tier 2 should pass. Tier 3 is aspirational.

### RC-1: Pipeline Integrity (gate for every change)

| # | Criterion | Test | Threshold |
|---|-----------|------|-----------|
| 1.1 | Shader compiles | `npm run capture-smoke -- --force` | 7/7 captured, 0 failures |
| 1.2 | No color shift artifacts | `analyze-artifacts.js` color-shift check | Max Oklab chroma < 0.012 on achromatic surface |
| 1.3 | No fog artifacts | `analyze-artifacts.js` fog check | Median peripheral contrast ≥ 0.003 |
| 1.4 | Unit tests pass | `npm run test:unit` | 258/258 |
| 1.5 | Color search Tier 1 | `validate-color-search.js` | 9/9 must-pass |

### RC-2: OCR Relative Recognition Rate

**Method change (2026-03-17 session 3):** Replaced OCR confidence with **relative recognition rate** — `scrambled_chars / baseline_chars` per annular ring. Baseline is a `mode_disabled` capture of the same page. This measures what fraction of text the shader destroys, not how confident tesseract is about surviving fragments.

**Test page:** `tests/ocr-test-page.html` — 9-cell grid with dense text at known positions, high-contrast black-on-white. Designed for consistent OCR across the full viewport.

#### Baseline measurements (2026-03-17)

Captured against `ocr-test-page.html` with fixation at center (0.5, 0.5). Baseline (disabled): 2535 chars.

| Version | Fovea | Parafovea | Near-periph | Far-periph | Overall | Drop |
|---------|-------|-----------|-------------|------------|---------|------|
| **v2.4 mode 0** (type 0 aniso noise) | 81.2% | 46.6% | 51.5% | 46.0% | 50.9% | 35.3pp |
| **v2.5 mode 0** (type 1 Shredder, bugged sectorPx=7) | 109.2% | 88.3% | 103.5% | 100.4% | 100.3% | 8.7pp |
| **v2.5 mode 13 coord-fixed** (first attempt, uncapped) | 0.0% | 0.0% | 0.0% | 0.3% | 0.1% | — |
| **v2.5 mode 13 coord-fixed** (capped 32px) | 1.7% | 0.0% | 0.3% | 0.9% | 0.7% | — |

**Key findings:**
- v2.5 Shredder with bugged coordinates does essentially nothing (100% recognition everywhere). The `ppd_v1 = max(fovea_radius / 1.0, 1.0)` clamp neutered it.
- v2.4 mode 0 (anisotropic noise, type 0) is the target profile: fovea ~81%, declining to ~46% far-periph, 35pp drop.
- The coordinate fix produced values 100× too aggressive. sectorPx reached 150+px at screen edges, creating massive blocks. Capping at 32px didn't help — the bender warp frequency also scaled down, creating huge smooth displacements.
- The fix needs parameter tuning that matches v2.4's profile, not just correct coordinates.

#### Acceptance criteria (updated)

| # | Criterion | Test | Threshold |
|---|-----------|------|-----------|
| 2.1 | Foveal text preserved | `validate-peripheral-ocr.js` fovea ring | Recognition rate ≥ 85% |
| 2.2 | Monotonic decline | `validate-peripheral-ocr.js` all rings | Each ring ≤ previous + 5% (noise tolerance) |
| 2.3 | Far peripheral degradation | `validate-peripheral-ocr.js` far_periph ring | Recognition rate ≤ 55% |
| 2.4 | Meaningful overall drop | `validate-peripheral-ocr.js` fovea vs far_periph | Drop ≥ 30pp |
| 2.5 | Not over-degraded | `validate-peripheral-ocr.js` far_periph ring | Recognition rate ≥ 20% (no total destruction) |

### RC-3: Biological Plausibility

| # | Criterion | Test | Threshold |
|---|-----------|------|-----------|
| 3.1 | Crowding Tier 1 | `validate-crowding.js` | Crowding ratio < 0.8 at 6°+ AND radial bias ≥ 1.5:1 |
| 3.2 | Spatial acuity Tier 1 | `validate-spatial-acuity.js` | Frequency ordering + monotonic band decline |
| 3.3 | Sector geometry traces to Blauch | Manual: every `w = log(r + a)` derivation traceable to `coords.py` | Code review |
| 3.4 | Text stays within bounding region | Visual: crowded text remains "block of unreadable squiggles" | No grey fog / scatter into white space (Rosenholtz 2012 "texture of letters") |
| 3.5 | Gestalt grouping preserved | Visual: text blocks, nav bars, image regions distinguishable in periphery | Layout structure readable at 15° (Palmer 1992 common region) |

### RC-4: Restricted Foveal Viewing — Usability

| # | Criterion | Test | Threshold |
|---|-----------|------|-----------|
| 4.1 | No spurious peripheral motion | Visual: static periphery when gaze is still | Zero boiling/shimmer (mode philosophy: stability > fidelity) |
| 4.2 | Foveal reading unimpaired | Saccade through body text — foveal text sharp and stable | No jitter, no lag |
| 4.3 | Page navigation possible | Use Scrutinizer overlay to navigate real sites for 5 min | Can find nav, click links, read headlines |
| 4.4 | 60fps sustained | Performance: frame time < 16.7ms on integrated GPU | No dropped frames on M1 MacBook |

### RC-5: Designer Insight Generation

| # | Criterion | Test | Threshold |
|---|-----------|------|-----------|
| 5.1 | Color hierarchy visible | Compare red vs blue UI elements at 10° | Blue element retains chroma; red does not (BY > RG) |
| 5.2 | Layout structure survives | Dashboard/ecommerce at full viewport | Sidebar, content area, nav bar distinguishable as regions |
| 5.3 | Text density distinguishable | Body text vs heading vs caption | Different textures at matched eccentricity |
| 5.4 | Congestion predicts difficulty | High-congestion region vs low-congestion | High congestion region is harder to parse peripherally |

### RC-6: Subband Entropy Degradation Curve (proposed — replaces OCR as primary metric)

OCR measures letter recognition, which is content-dependent (dense body text vs sparse nav). Subband Entropy (SE) measures spatial frequency content directly — the thing we're actually degrading. SE is content-independent: a region with rich spatial frequency content has high SE; one where frequencies have been pooled away has low SE.

**How it works:**
1. Capture original page (unfiltered) and Scrutinizer-rendered version
2. Crop annular rings at 5 eccentricities (same as OCR rings)
3. Compute steerable pyramid decomposition (3 scales, 4 orientations — matches visual-clutter)
4. Shannon entropy per subband, weighted combination (luminance 1.0, chrominance 0.0625)
5. Report SE per ring for both original and rendered

**Acceptance criteria:**

| # | Criterion | Threshold |
|---|-----------|-----------|
| 6.1 | SE monotonically decreases from fovea to far periphery | Strict monotonic decline |
| 6.2 | Foveal SE preserved | Rendered SE ≥ 90% of original at fovea |
| 6.3 | Far-peripheral SE reduced | Rendered SE ≤ 30% of original at 15° |
| 6.4 | No fog (SE collapse) | SE never drops below 5% of original at any ring |
| 6.5 | Degradation rate correlates with eccentricity | Spearman ρ > 0.9 between ring distance and SE ratio |
| 6.6 | FC predicts SE drop | High-FC regions show greater SE reduction than low-FC regions (ρ > 0.5) |

**Why this is better than OCR:**
- OCR is binary (word recognized or not) and content-dependent (text layout matters)
- SE is continuous and measures the spatial frequency cascade directly
- SE detects both over-degradation (fog, SE → 0) and under-degradation (SE stays flat)
- SE works on any content (images, charts, nav bars), not text alone
- The FC→SE correlation (6.6) validates that clutter drives degradation — biologically correct

**Implementation:** `scripts/validate-subband-entropy.js` — Node.js, uses sharp for image cropping, custom steerable pyramid (port from visual-clutter's pyrtools approach or a JS wavelet library).

### Feature Congestion × Subband Entropy: The Dual Metric

Scrutinizer's mission is to both **simulate** and **measure** the peripheral visual system:

| | Input (pre-filter) | Output (post-filter) |
|---|---|---|
| **Measure** | Feature Congestion (FC) — "how cluttered is this?" | Subband Entropy (SE) — "how much spatial info survived?" |
| **Simulate** | FC drives V1 distortion strength (structure gate) | SE validates the degradation curve |

FC on input predicts where degradation should be strongest.
SE on output measures where degradation actually occurred.
The correlation between them validates biological plausibility:
high-FC regions should show the steepest SE drop.

### Current State (2026-03-17)

| Criterion | Baseline (committed) | Session attempts | Issue |
|-----------|---------------------|------------------|-------|
| 2.1 Foveal | 96% ✅ | 57-91% ❌ | Feature-scale cells + throw bleeding into fovea |
| 2.2 Dashboard monotonic | PASS ✅ | PASS/FAIL mixed | Content-dependent far > near gap |
| 2.3 Article monotonic | PASS ✅ | FAIL ❌ | Dense near-periph text scrambles harder than sparse far-periph |
| 3.4 Text bounding | Broken (grey fog) | Improved with dest structure gate | Needs destination saliency check |
| 4.1 No motion | ✅ | ✅ | Static periphery preserved |

**Key finding from this session**: The coordinate space mismatch (`fovea_radius` is normalized-Y ≈0.022, not pixels ≈45) caused all previous sector-scaling to be neutered (clamped to floor values). With the fix, the sector computation works but the throw distance/cell size tuning breaks the OCR curve. The path forward requires:

1. Fix the coordinate space once (norm-Y throughout)
2. Decouple cell size from throw distance (science: cells = feature-scale, throw = Bouma-zone-gated)
3. Add destination structure check (science: crowding doesn't scatter into empty space)
4. Tune against the full RC-2 suite, not individual parameters

## TTM Approximation Strategy — Fragment Shader Feasible

### What TTM computes (full inventory)

Per pooling region (growing linearly with eccentricity, ~0.5× Bouma):
- Marginal stats: mean, variance, skewness, kurtosis
- Cross-scale magnitude correlations (parent-child bands at same orientation)
- Cross-scale phase correlations (edge coherence across scales)
- Cross-orientation correlations (co-occurrence of H/V/D within a scale)
- Spatial autocorrelation at multiple lags (periodicity — line spacing, letter spacing)
- ~700 parameters per pooling region (Portilla-Simoncelli 2000)

### Which statistics matter most (Rosenholtz 2012, 2016)

| Priority | Statistic | Scrutinizer status | Gap |
|----------|-----------|-------------------|-----|
| 1 | Mean luminance + variance | ✅ MIP chain + DoG bands | — |
| 2 | **Cross-scale magnitude correlation** | ❌ Missing | **Biggest gap** — makes output "noise on blur" vs "structured texture" |
| 3 | Orientation distribution | ✅ 4 orientation energies | — |
| 4 | Spatial frequency content | ✅ MIP-driven, M-scaling cutoffs | — |
| 5 | Cross-orientation correlation | Partial (orient weights, not co-occurrence) | Minor |
| 6 | Phase alignment across scales | ❌ Missing | Causes "texture-ified" look vs edges |
| 7 | Skewness/kurtosis | ❌ Not critical for web UI (flat design) | Low priority |

### The cheapest high-impact fix: cross-scale correlation

One extra `textureLod` sample per fragment. Modulate fine-scale noise by coarse-scale deviation:

```glsl
// Sample coarse structure (1 MIP above current)
float coarseL = dot(textureLod(u_texture, uv, mipLevel + 1.0).rgb, lumaW);
float coarseDev = coarseL - tile_mean_L;
// Fine texture stronger where coarse structure is brighter
float crossScaleWeight = 0.5;  // tune to taste
contrastNoise *= (1.0 + coarseDev * crossScaleWeight);
```

**Effect:** Bright coarse regions get more visible fine texture; dark regions get less. Text body (dark on light) produces texture with correct contrast envelope. Without this, noise is uniformly distributed → reads as TV static, not peripheral text.

### Four ranked improvements (impact per GPU cost)

1. **Cross-scale correlation modulation** — 1 textureLod + multiply. Addresses the biggest perceptual gap. Priority: ship with Phase 3.
2. **Contrast preservation at high MIP** — ensure sigma_L drives noise amplitude even at MIP 4+. Verify compute stats don't sample already-blurred content.
3. **Dual-frequency synthesis** — add line-spacing grating (from rhythm channel) on top of letter-spacing grating. Makes text regions read as "lines of stuff" vs "uniform stuff."
4. **Low-frequency chrominance variation** — blend neighboring tile mean_ab instead of flat per-tile color. Prevents "flat color blocks" at tile boundaries.

### What SideEye/FGN and pix2pixHD taught us

Both achieve near-real-time by training neural networks on TTM ground truth rather than computing statistics explicitly. Key architectural insight: **multi-scale discriminators** (pix2pixHD) implicitly enforce cross-scale consistency — the lesson is that cross-scale structure is the load-bearing statistic. Both sacrifice stochastic variation (producing one deterministic output per gaze position) which is acceptable for a design tool.

Neither runs in a fragment shader. But both confirm: if you get cross-scale correlations right, the rest follows.

### What produces "grey fog" vs "texture of letters"

Must preserve for text:
- Strong horizontal orientation energy (60-70% of text is horizontal)
- Periodic vertical autocorrelation at line-spacing (rhythm channel)
- High luminance variance at letter-body scale
- Low chrominance variance (text is usually monochromatic)

Must destroy:
- Phase alignment at letter scale (individual letter identity)

Grey fog = MIP too high (variance collapses) + no orientation structure + no multi-scale structure. Fix: cross-scale correlation + contrast preservation + orientation-weighted synthesis.

## Session 2 Learnings — Science Agent Findings

### Crowding is local pooling, not global scatter
- Pelli, Palomares & Majaj (2004): features mis-bind within Bouma zone, don't teleport
- Levi (2008), Whitney & Levi (2011): "compulsory averaging" within the pooling region
- Features from outside the pooling region don't participate

### TTM boundary behavior produces attenuation, not debris
- Pooling regions that straddle content/background produce diluted texture (80% text region → 80% text statistics), not scattered pixels
- Grey fog artifact has no TTM analog

### Crowded text still looks like text
- Rosenholtz et al. (2012): peripheral text = "texture of letters" — density, rhythm, contrast preserved
- Balas, Nakano & Rosenholtz (2009): summary statistics explain crowding percept
- Ensemble perception (Haberman & Whitney 2012): set-level stats available even when items unidentifiable

### Gestalt grouping survives peripheral degradation
- Kimchi & Razpurker-Apfeld (2004): perceptual organization occurs without attention
- Palmer (1992): common region principle — text blocks have strong bounded-region cues
- These are low-spatial-frequency, high-contrast features → survive pooling

### Feature Congestion decomposition mirrors our pipeline
From `kargaranamir/visual-clutter` (Rosenholtz 2007):
- **Color clutter** = CIELab covariance determinant^(1/3) → our Oklab chromatic decay
- **Contrast clutter** = DoG → local variance → our 12-band DoG
- **Orientation clutter** = cos(2θ)/sin(2θ) covariance → our oblique effect
- FC combination weights: contrast dominates (15× color weight) — validates edgeDensity as primary structure gate
- **Subband Entropy** = steerable pyramid + Shannon entropy per band → proposed as content-independent validation metric

## References

- Blauch, N. M., Alvarez, G. A., & Konkle, T. (2026). FOVI: arXiv:2602.03766
- Rovamo, J. & Virsu, V. (1979). An estimation and application of the human cortical magnification factor.
- Schwartz, E. L. (1980). Computational anatomy and functional architecture of striate cortex.
- Rosenholtz, R. (2016). Capabilities and limitations of peripheral vision.
- Rosenholtz, R., Li, Y., & Nakano, L. (2007). Measuring visual clutter. *Journal of Vision*.
- Freeman, J. & Simoncelli, E. P. (2011). Metamers of the ventral stream.
- Pelli, D. G. & Tillman, K. A. (2008). The uncrowded window of object recognition. *Nature Neuroscience*.
- Greenwood, J. A., Szinte, M., Sayim, B., & Cavanagh, P. (2017). Variations in crowding, saccadic precision, and spatial localization. *Journal of Vision*.
- Bouma, H. (1970). Interaction effects in parafoveal letter recognition. *Nature*.
- Palmer, S. E. (1992). Common region: A new principle of perceptual grouping. *Cognitive Psychology*.
- Balas, B., Nakano, L., & Rosenholtz, R. (2009). A summary-statistic representation in peripheral vision. *Journal of Vision*.
