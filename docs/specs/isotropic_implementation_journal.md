# Isotropic Mode 12: Implementation Journal

> **Date:** 2026-03-15
> **Status:** Abandoned — reverting to v2.4.1 baseline for spec-first redesign
> **Parent spec:** `isotropic_cortical_sampling.md`

## Goal

Make mode 12 (V1 distortion type 5) produce peripheral degradation that:
- Destroys text readability (letters unrecognizable beyond parafovea)
- Preserves texture structure (lines of text visible as lines, not fog)
- Uses isotropic sector geometry from Blauch (2026) to drive degradation
- Looks at least as realistic as mode 0 (v2.4.1 smoothstep baseline)

## What Was Built

### Sector geometry (KEEP)
`computeCorticalSector()` in `peripheral.frag` — computes ring index, spoke count, sector center UV, radial spacing. Math verified against Blauch Python to 3 decimal places (see `tests/unit/isotropic-sectors.test.js`, 19 passing tests). This is correct and should be preserved.

### Sector parameters at key eccentricities (N=50, r_max=15°)

| Eccentricity | Ring | Spokes | Sector size (px @1920) | Letter size (px) |
|-------------|------|--------|----------------------|-----------------|
| 2° | ~15 | ~37 | ~7px | ~16px |
| 5° | ~27 | ~80 | ~13px | ~16px |
| 8° | ~34 | ~104 | ~19px | ~16px |
| 12° | ~41 | ~126 | ~27px | ~16px |

Key observation: at 5° eccentricity, sectors (~13px) are smaller than letter glyphs (~16-20px). Letters span 2-3 sectors. This means sector-level operations (snap, average) don't cleanly isolate features — they either leave letters partly intact or produce sub-letter averaging artifacts.

## Approaches Tried

### 1. UV snap to sector center
**Idea:** Snap each pixel's UV to the center of its cortical sector before sampling. All pixels in a sector see the same texel.

**Result:** Gray blobs everywhere.

**Why:** A sector spanning black text on white background averages to gray. This is spatial averaging, not peripheral vision. Peripheral vision preserves local contrast and texture statistics (Rosenholtz TTM) — it scrambles features, not erases them.

**Lesson:** Any mechanism that converges pixels toward a common sample point produces mean color. UV snap is fundamentally wrong for text-on-background content.

### 2. textureGrad with sector-sized derivatives
**Idea:** Use `textureGrad()` instead of `textureLod()` in the DoG reconstruction. Pass sector-width derivatives so the GPU automatically samples at the MIP level matching sector resolution.

**Result:** Gray blobs (same as #1 but via a different path).

**Why:** The DoG reconstruction subtracts adjacent MIP levels: `sum(w[i] * (mip[i] - mip[i+1]))`. When textureGrad pushes ALL 9 bands to high MIP, adjacent bands converge to the same value, differences → 0, weights sum to ~0, output → gray. The frequency-selective behavior of DoG requires bands at different resolutions. Forcing them all to sector resolution destroys the entire reconstruction.

**Lesson:** textureGrad is the wrong tool for DoG. The DoG bands MUST span different MIP levels. Only `textureLod` with a floor (not a forced level) preserves the frequency cascade.

### 3. Per-pixel hash jitter
**Idea:** Add small random UV displacement per pixel, scaled by sector size.

**Result:** No visible effect on text readability.

**Why:** Hash noise at pixel scale creates ~2.5px displacement cells. A 20px letter glyph spans ~8 noise cells. The noise shifts individual pixels but the letter shape survives because the displacement is incoherent at letter scale — like static on a TV, you can still read through it.

**Lesson:** Displacement must be coherent at the feature scale you want to destroy. For ~20px letters, you need ~10-20px coherent displacement regions. But regions that large create visible tiles (see #5).

### 4. Simplex noise (800/1600 freq) scaled by sector
**Idea:** Use smooth simplex noise (the same frequencies as mode 0's "bender" stage) with amplitude scaled by sector size.

**Result:** Minimal effect on readability. Smooth warping visible but letters still legible.

**Why:** Same scale mismatch as #3. The 800-frequency simplex noise creates ~2.4px wavelength features. Even with larger amplitude (up to 24px throw), the smooth noise warps letters as rigid bodies — they shift position but remain recognizable. Mode 0 works because it combines this smooth warp with a discrete scramble that breaks up the rigid letter shapes.

**Lesson:** Smooth warping alone cannot destroy letter identity. You need either (a) very large coherent displacement that moves letters apart, or (b) a second mechanism that breaks within-letter coherence.

### 5. Sector-coherent scramble (hash per sector)
**Idea:** Assign each cortical sector a random UV offset. All pixels in a sector shift together, scrambling the spatial arrangement of sectors.

**Result:** Minecraft-like tile artifacts, staircase distortion on text lines.

**Why:** Sector boundaries are visible as hard edges between shifted regions. Text lines crossing sector boundaries show staircase patterns. The tiles are geometrically regular (rings and spokes) which makes the pattern even more obvious than random tiles.

**Lesson:** Sector-coherent operations produce sector-shaped artifacts. The isotropic geometry is mathematically elegant but visually conspicuous when used as a scramble unit. Any rendering that makes sector boundaries visible fails.

### 6. Type 0 discrete scramble (hash per 4px cell)
**Idea:** Copy mode 0's "cutter" stage — hash-based displacement per 4px grid cell, 15px throw distance.

**Result:** Pixel dust. Scattered individual pixels displaced into wrong neighborhoods.

**Why:** A 4px cell at the edge of a dark letter on white background contains both dark and light pixels. The cell gets thrown 15px away as a unit, depositing dark pixels in a white region (or vice versa). On dark backgrounds (dark mode), scattered bright pixels are highly visible. On light backgrounds, scattered dark pixels blend in better (which is why mode 0 looks decent on typical light-mode web content).

**Lesson:** The discrete scramble IS what kills readability in mode 0, but it creates non-biological artifacts that are visible in dark mode. It's a practical hack, not a principled solution.

### 7. Type 0 noise + sector lodFloor (best result)
**Idea:** Combine mode 0's smooth simplex warp (no discrete scramble) with a lodFloor derived from sector extent. The lodFloor clamps the finest DoG bands, preventing the reconstruction from resolving features smaller than the sector.

**Result:** Smooth, artifact-free degradation. Text becomes progressively blurry with distance. But text is still readable further into the periphery than mode 0, and the lodFloor removes texture that gives mode 0 its realistic "I can tell what type of content that is" quality.

**lodFloor tuning:**
- `1.0x` of `log2(sectorExtent * resolution)`: At 5°, lodFloor ≈ 3.7 → clamped bands 0-7 → killed all texture → foggy
- `0.4x`: Minimal effect — text still sharp
- `0.6x`: Best balance — noticeable degradation but text still partly readable
- `0.8x`: Too much — texture starts disappearing

**Why it's still not right:** The lodFloor removes fine texture uniformly. Mode 0's strength is that peripheral content retains texture — you can tell whether you're looking at a paragraph, an image, a nav bar. The lodFloor erases this distinction. It's blur (progressive, but still blur), not scrambling.

**Lesson:** lodFloor is a dimmer switch on spatial frequency — it can't selectively destroy feature identity while preserving texture. The fundamental problem is that "destroy letters but keep texture" requires a mechanism that operates at the semantic level of features, not the optical level of spatial frequency.

## The Core Problem

Mode 0 works because it has two complementary mechanisms:
1. **Bender** (smooth noise warp): shifts features around, breaks spatial relationships between them
2. **Cutter** (discrete scramble): breaks within-feature coherence, making individual letters unrecognizable

Neither alone is sufficient. Together they produce realistic peripheral degradation on typical web content.

Mode 12 needs to replicate this two-stage destruction using sector geometry as the organizing principle, but every attempt to use sectors as the operational unit creates sector-shaped artifacts.

## Possible Directions (for next attempt)

1. **Sector geometry drives transition rate, not mechanism.** Use mode 0's existing noise+scramble mechanism, but let the isotropic sector geometry control WHERE transitions happen (eccentricity thresholds). The rendering mechanism stays proven; the sector math controls the spatial profile.

2. **Sector-weighted smooth blending.** Instead of hard sector boundaries, use a smooth weighting function that peaks at sector centers. This could drive a texture-aware pooling operation without visible boundaries.

3. **Work color first.** Peripheral color processing (chromatic decay, S-cone distribution) is less coupled to spatial scrambling. Establish the color pipeline, then layer spatial degradation on top. User's stated preference: "I'm thinking this time we work color then port to isotropic."

4. **lodFloor as supplement, not replacement.** Use a gentle lodFloor (0.3-0.4x) alongside noise+scramble, not instead of it. The lodFloor softens the finest bands; the scramble handles feature destruction.

## What to Carry Forward

| Item | Status | Rationale |
|------|--------|-----------|
| `tests/unit/isotropic-sectors.test.js` | KEEP | Pure math — validates sector geometry against Blauch Python |
| `scripts/ocr-readability-comparison.js` | KEEP | Mode-agnostic validation tool |
| `scripts/capture-isotropic-comparison.js` | KEEP | Comparison capture infrastructure |
| `docs/golden/isotropic-side-by-side.html` | KEEP | 3-way visual comparison viewer |
| `docs/specs/isotropic_cortical_sampling.md` | KEEP | Mathematical spec (correct, pre-dates implementation) |
| `computeCorticalSector()` in peripheral.frag | KEEP | Correct math, needed for any future isotropic work |
| V1 type 5 distortion block | REVERT | All rendering code in this block failed — start fresh |
| `sampleDoGReconstructed` signature changes | REVERT | Removed sectorDx/sectorDy params — restore original |
| `scripts/capture-smoke.js` mode 12 shot | KEEP | Pipeline crash test, independent of rendering quality |
| Remove "Chromatic Aberration" menu item | DO | Vestigial toggle, unrelated to isotropic work |

## References

- Rosenholtz, R. (2016). Capabilities and limitations of peripheral vision. Annual Review of Vision Science, 2, 437-457.
- Blauch, N. M., Alvarez, G. A., & Konkle, T. (2026). FOVI: A biologically-inspired foveated interface for deep vision models. arXiv:2602.03766.
- Freeman, J., & Simoncelli, E. P. (2011). Metamers of the ventral stream. Nature Neuroscience, 14(9), 1195-1201.
