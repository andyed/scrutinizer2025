# Tier 3 TTM Synthesis — Lessons Learned (updated 2026-03-27)

## What we tried

Enabling mode 15 (TTM Tier 3) as default: eccentricity-scaled sector pooling replacing V1 displacement entirely. Three code changes:

1. **`useSectors = true`** in `webgpu-pyramid-compute.js` — enabled the sector assignment shader
2. **`maxSectors = 65536`** — fixed sector ID overflow (ring offsets need ~41K IDs)
3. **Fragment shader Tier 3 path** — full-strength blend, bypassed smooth content snap-back and magnocellular contrast restoration

## What happened

The compute pipeline worked correctly:
- Sector assignment shader ran, assigning ring-based sector IDs (4px→64px tiles by eccentricity)
- Stats extraction accumulated per-sector means and cross-scale correlations
- Synthesis produced valid RGBA output with 98%+ non-zero alpha
- Readback and WebGL upload succeeded

But the visual output showed **no visible degradation**. Text remained readable everywhere.

## Root causes (5 stacked issues)

### 1. Sector means too close to original on sparse content
Dashboard/web pages with lots of whitespace: a 64x64 sector containing "Wireless Headphones" on white background has a mean that's ~98% white. The text is a thin line representing <5% of sector pixels. The synthesis output (mean + weak bandpass noise) looks nearly identical to the original.

**This is actually correct TTM behavior for sparse content.** Isolated text on plain background IS readable in peripheral vision (low crowding). It's flanked/dense text that gets destroyed. The dashboard is too sparse to trigger crowding.

### 2. Blend factor capped at 60%
`blendFactor = baseBlend * u_intensity` where intensity=0.6 was tuned for displacement modes. With pooling-only (no displacement), 60% blend of near-identical content = invisible effect.

Even after fixing to 100% blend, the effect was subtle because of issue #1.

### 3. Smooth content snap-back
`pooledCol = mix(pooledCol, foveaCol, smoothContent)` at lines 1300-1302 — designed to prevent Mach bands on smooth gradients. In Tier 3, foveaCol is the ORIGINAL page (no V1 displacement), so any pooledCol close to the original gets snapped back to it. This killed ~80% of the remaining effect.

### 4. Magnocellular contrast preservation
`col *= mix(1.0, lumaRatio, contrastPreservation)` — restores luminance contrast from the clean source image. Partially undoes the contrast reduction from sector-mean pooling.

### 5. Bilinear texture upsampling
The compute texture at half-res (960x506) is upsampled to full canvas (3840x2024) via WebGL bilinear filtering. Sector boundaries (where mean colors change abruptly) get smoothed, making transitions gradual rather than showing distinct pooling blocks.

## What this means for the TTM plan

The tier3_ttm_synthesis_plan.md already identified the quality gap: "no cross-scale magnitude correlations. This is the statistic that makes text look like horizontal stripes instead of random noise." The current Tier 2.75/3.0 synthesis uses **tile mean + weak bandpass noise**, which is equivalent to MIP blur with extra steps.

### The real path forward

1. **Cross-scale correlations** (Phase 2 of TTM plan) are the quality leap. When the synthesis matches parent-child magnitude correlations, text regions produce horizontal-stripe-like textures instead of flat means. This is the difference between "blur" and "mongrel."

2. **Don't bypass displacement.** Tier 3's `v1_strength_mult: 0.0` removes the only visible degradation mechanism that works. Until the synthesis itself produces destructive output, V1 displacement should remain active. Consider a hybrid: Tier 2.75 pyramid synthesis WITH eccentricity-scaled sectors, keeping V1 displacement.

3. **Sector geometry works.** The sector assignment shader is functional, the ring-based eccentricity scaling produces correct sector IDs (with maxSectors bumped to 65K), and the stats/synth pipeline handles sector mode. The infrastructure is ready for better statistics.

4. **The fragment shader Tier 3 path works.** `u_compute_tier >= 3.0` gates correctly, compute texture is sampled, alpha blend is functional. The issues were all about the quality of what the compute texture contains, not the rendering pipeline.

## Key takeaway

Sector pooling alone ≠ visible degradation. The TTM quality comes from the **statistics being matched**, not from the pooling geometry. Sectors provide the correct spatial scale for pooling regions, but without cross-scale correlations and marginal statistics driving the synthesis, the output is just a slightly noisy block average — which, for clean web UI, looks like the original page.

## Files touched (all reverted)

- `renderer/webgpu-pyramid-compute.js` — useSectors parameter, maxSectors increase
- `renderer/scrutinizer.js` — isTier3 flag, sector dispatch, debug logging
- `renderer/shaders/peripheral.frag` — Tier 3 blend/bypass changes

---

## Session 2: Option C + Phase 3a (2026-03-26/27)

### What we built

**Option C: Eccentricity-scaled sectors** (committed ff21eed)
- CMF-based sector assignment (Blauch et al. 2026) replaces fixed 8x8 tiles
- ~3,200 sectors (N=50 rings, 15° max) vs ~7,680 tiles — memory decreases
- `computeSectorId()` in WGSL: 1 sqrt + 1 log + 1 atan2 + 2 buffer reads per pixel
- Activated via `num_cortical_rings: 50` in mode config
- 9 new unit tests validate sector layout against Blauch Python reference
- Both TTM Synthesis and Pyramid Mongrel now use sectors

**Phase 3a: Synthesis improvements** (committed ff21eed)
- Skewness extraction (ACCUM_STRIDE 20→24, STATS_STRIDE 14→18) + power-law matching
- Multiplicative cross-scale correlation (conditional parent→child scaling replaces linear additive)
- Crowding OCR test page (`crowding-ocr-test.html`) — minimal stimulus for Wave 7c
- Brown comparison extended for TTM Synthesis mode
- Zoom reset (`setZoomFactor(1.0)`) in batch capture pipeline

### What we measured

**Brown comparison — dashboard near/mid periphery SSIM:**

| Stage | Near periphery | Mid periphery | Target (Brown) |
|-------|---------------|---------------|-----------------|
| Pre-sectors (Tier 2.75 tiles) | 0.96-1.00 | 0.96-1.00 | 0.21-0.24 |
| Option C sectors only | 0.37 | 0.39 | 0.21-0.24 |
| Phase 3a (graduated frag shader) | 0.71 | 0.73 | 0.21-0.24 |

Sectors produced the biggest single improvement (SSIM 1.0→0.37). The fragment shader changes partially undid it by preserving too much original content (0.37→0.71). Reverting fragment shader changes restores the sector improvement.

### What we tried and reverted

**Fragment shader Tier 3 compositing path** — three changes gated on `u_compute_tier >= 3.0`:
1. Blend cap raised from 0.6 to 0.85 → **caused hard visible band at parafovea**
2. Smooth content snap-back disabled → **allowed synthesis to fully replace content, but synthesis output was too weak to stand alone**
3. Magnocellular contrast preservation disabled → **caused dim/washed-out periphery**

Then graduated (not disabled): 0.85 blend, widened snap-back, reduced magnocellular → **still dim, still large fovea, low peripheral contrast.** Visual regression from utility POV.

Then smoothstep alpha ramp in synthesis to match fragment shader → **fixed parafoveal border but created huge fovea.**

**All reverted.** The synthesis isn't ready for more compositing authority. The standard Tier 2.75 compositing (0.6 blend, standard snap-back, standard magnocellular) works for both modes.

**Residual-based DC** — replaced tile_mean_L with pyramid residual (W/16×H/16) as DC component in synthesis. Destroyed ALL content equally (isolated and flanked) because the 16px blur obliterates letter-scale structure. Reverted to tile_mean_L.

### What we learned

1. **Sector geometry works and produces real degradation.** SSIM dropped from ~1.0 to 0.37 on dense content. The infrastructure (ring assignment, spoke computation, atomic accumulation, sector-aware synthesis) is solid.

2. **The fragment shader compositing is deeply coupled to displacement.** Blend factor, snap-back, magnocellular preservation — all tuned for V1 displacement's spatial jitter. Removing displacement and giving synthesis more authority requires a full decouple (Option A refactor), not per-parameter tweaking.

3. **TTM Synthesis (no displacement) looks better on word boundary destruction** — sectors pool across word boundaries, making spacing imperceptible. But the standard compositing's attenuation makes this hard to see.

4. **The hybrid (Pyramid Mongrel + sectors) is the practical path.** Sectors improve compute texture quality; displacement provides spatial destruction; standard compositing handles visual quality. No fragment shader changes needed.

5. **Crowding asymmetry test blocked by sparse content problem.** Both isolated and flanked letters are equally destroyed because sector mean ≈ white for both. The test needs denser stimuli or lower eccentricity, OR the synthesis needs to be destructive enough that the variance difference between isolated (low) and flanked (high) produces measurably different output.

6. **Zoom consistency in captures is critical.** Text zoom variation between sessions invalidated Brown comparisons. Fixed with `setZoomFactor(1.0)` in batch capture.

### Current state (updated 2026-03-31)

- **Pyramid Mongrel** = sectors + displacement + standard compositing (default, production-ready)
- **TTM Synthesis** = sectors + no displacement + eccentricity-driven V4 (research mode)
- **Option A (fragment shader decouple) = SHIPPED** (v2.7.1+, commits 539d367..9880645)
  - V1_Signal extended with v4PoolingStrength / v4EffectStrength
  - EccentricityProfile struct centralizes master curve computation
  - Mode 15 uses `v4_eccentricity_source: 1` — V4 effects work with zero displacement
  - Modes 0-14 use legacy identity path (zero behavioral change)
- Crowding asymmetry (Wave 7c) = unblocked by Option A, pending synthesis quality
- 314 tests pass, 0 regressions

---

## Session 3: Tier 3 Compositing Tuning (2026-03-31)

### What we built

**Tier 3 fragment shader compositing** (committed cb8bd82):

1. **Foveal gate**: `smoothstep(0.0, fovea_radius * 0.5, eccentricity)` clamps compute texture influence near fovea. Prevents bilinear interpolation bleed from half-res compute texture into foveal region.

2. **Snap-back bypass**: Smooth content snap-back disabled for `u_compute_tier >= 3.0`. The snap-back (`smoothstep(0.01, 0.05, colorDelta)`) was snapping `pooledCol` back to `foveaCol` whenever the synthesis output was close to the original — which on sparse web content (sector mean ≈ original pixel) is always.

3. **Reduced magnocellular contrast preservation**: Inner contrast preservation reduced from 0.6 to 0.3 for Tier 3, letting synthesis contrast structure dominate.

### What we measured

**Brown comparison SSIM — dashboard, center fixation:**

| Band | Brown target | Pre-Option A | Post-Option A (no compositing fix) | **Post compositing fix** |
|------|-------------|-------------|-----------------------------------|-----------------------|
| Fovea | 0.928 | 0.979 | 0.979 | **0.722** (too low) |
| Parafovea | 0.817 | 0.971 | 0.971 | **0.728** |
| **Near periphery** | **0.209** | 0.953 | 0.953 | **0.162** ✓ |
| **Mid periphery** | **0.237** | 0.963 | 0.963 | **0.227** ✓ |
| Far periphery | 0.579 | 0.999 | 0.999 | 0.887 |

Near and mid periphery **hit or exceeded Brown metamer targets** for the first time. This proves the synthesis pipeline produces quality comparable to published ground truth when the fragment shader compositing lets it through.

### What we tried and iterated on

**Snap-back approaches (3 iterations):**
1. Disabled entirely for Tier 3 → near/mid periphery hit targets but foveal SSIM collapsed to 0.37 (synthesis bleed via bilinear interpolation)
2. Eccentricity-gated thresholds → too complex, didn't converge
3. Alpha-scaled snap-back (`smoothContent *= (1.0 - computeAlpha)`) → snap-back still dominated because `pooledCol ≈ foveaCol` after foveal gate zeroes compute alpha

**Foveal gate tuning:**
- `0.5 × fovea_radius` → fovea SSIM 0.72 (acceptable but not ideal), periphery works
- `0.75 × fovea_radius` → too wide, snap-back kills everything
- `1.0 × fovea_radius` → M15 ≈ M0, no synthesis visible

Final: `0.5 × fovea_radius` with snap-back fully disabled for Tier 3.

**Key insight**: The compositing issue was always the bottleneck, not synthesis quality. The synthesis parameters (correlation injection, detail strength) may not even need tuning — once the fragment shader stops undoing the synthesis, the output is already at Brown quality in the periphery.

### What we learned

1. **Snap-back is the dominant compositing issue for Tier 3.** On sparse web content, `colorDelta = length(pooledCol - foveaCol)` is always small because sector means ≈ original pixels. Any snap-back threshold kills the synthesis. The fix is to bypass snap-back entirely for Tier 3.

2. **The foveal gate is needed because of resolution mismatch.** The compute texture is half-res, uploaded via WebGL `texImage2D` with bilinear filtering. Pixels at the foveal boundary interpolate between synthesis (non-zero alpha) and foveal transparent (zero alpha, black RGB), bleeding dark artifacts into the fovea.

3. **Two alpha signals should not be conflated.** The compute texture alpha (synthesis authority) and the fragment shader eccentricity (vision model) are different signals. The fragment shader must independently protect the fovea regardless of what the compute texture says.

4. **Article content doesn't respond (M15 ≈ M0).** Text-on-white has such low spatial statistics contrast that even without snap-back, the synthesis output is nearly identical to the original. The sparse content problem (issue #1 from Session 1) is still the fundamental quality bottleneck for text-heavy pages. Phase 2 synthesis parameter tuning needed.

5. **Dashboard responds strongly because it has richer visual content** — charts, colored elements, product images. The synthesis has more statistical signal to work with.

### Remaining issues

- **Foveal SSIM at 0.72** (target: 0.93+). The foveal gate at `0.5 × fovea_radius` is too tight — bilinear bleed from the compute texture contaminates the inner boundary. Fix options:
  - Expand the compute-side foveal transparent zone (in `pyramid-synth.wgsl`, widen alpha < 0.01 to alpha < 0.05)
  - Widen `blend_start` in `webgpu-pyramid-compute.js` (currently `foveaRadius * 1.5`, try `* 2.0`)
  
- **Article/text content non-responsive.** Need Phase 2 synthesis parameter sweep: increase correlation injection strength, increase detail_strength, increase skewness constant.

- **Dark corner patches.** Sectors at extreme eccentricity with zero stats. Fix in reconstruct: fall back to source texture when tile_mean_L ≈ 0.

### Current state

- **Near/mid periphery at Brown quality** on dashboard content ✓
- **Foveal protection needs tuning** — bilinear bleed from half-res compute texture
- **Text-heavy content non-responsive** — sparse content problem, synthesis parameters next
- Mode 14 unaffected — all compositing changes gated on `u_compute_tier >= 3.0`
- 314 tests pass, integration test passes
