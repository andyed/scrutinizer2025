# Density-Gated V1 Crowding Distortion

**Status**: Planned
**Created**: 2026-03-04
**Diagnostic**: `reference-pages/crowding.html`, `reference-pages/crowding-stimulus.html`

## Context

The crowding reference page (`crowding.html`) exposed that Scrutinizer's V1 Lateral Smash distortion is purely eccentricity-dependent — an isolated letter and a densely flanked letter at the same eccentricity receive identical displacement. In real peripheral vision, the isolated letter remains identifiable (Bouma 1970). The structure map already carries a `density` channel (green) through the LGN signal but it's unused in V1 or V4. This change feeds density into the V1 strength calculation so dense content (text clusters, UI grids) gets full crowding distortion while sparse content (isolated elements on background) is spared.

This is a defensible first-order approximation of TTM-style summary statistic pooling (Rosenholtz 2012) — it models the *consequence* of feature pooling (identity loss scales with feature density in the pooling region) without computing actual statistics. One step shy of true mongrel/metamer texture synthesis (Level 2), which would replace content with statistically-matched texture.

## Approach: Sigmoid density gate on V1 strength

**Why sigmoid, not linear or step:**
- Bouma's law describes a relatively sharp transition — inside critical spacing, recognition drops precipitously. A sigmoid captures this.
- Linear would over-distort sparse regions and under-distort moderate ones.
- A hard step would create visible discontinuity boundaries in the rendered output.

**Why NOT local contrast variance (alternative 4a):**
- Requires 8+ extra texture fetches per fragment — measurable perf hit at 60fps.
- Density is already computed and flowing through the pipeline for free.
- Density captures the dominant first-order effect. Variance is a second-order refinement for later.

**Known limitations (acceptable for now):**
- Isolated complex glyphs (e.g., Chinese characters) have high internal density → may be over-distorted. Mitigated if density is sampled at Bouma-scaled radius, but current structure map is block-level, not pixel-level.
- Same-density but different-similarity flankers (e.g., all-same vs all-different letters) produce identical distortion. This is a second-order effect.
- Density is derived from font-weight + Gestalt group boost (1.2×), giving crowded groups ~0.53 vs isolated ~0.44. Small absolute difference, but the sigmoid amplifies it.

## Changes

### 1. Add uniforms for density gate tuning

**File:** `renderer/config.js` (or wherever uniforms are declared)

Add two new uniforms:
- `u_crowding_density_threshold` (float, default 0.2) — density below this = minimal crowding
- `u_crowding_density_steepness` (float, default 10.0) — sharpness of sigmoid transition

These are tunable via dev tools / modes.json so we can A/B test against the crowding reference page.

### 2. Modify V1 strength calculation in both fragment shaders

**File:** `renderer/shaders/peripheral.frag` — line 426
**File:** `renderer/shaders/peripheral2.frag` — line 514

Current:
```glsl
float strength = lgn.suppressionFactor * config.v1_strength_mult * eccentricityScale;
```

After:
```glsl
// Density-gated crowding: dense content (text clusters, UI) gets full distortion,
// sparse content (isolated elements) gets reduced distortion.
// Sigmoid transfer: sharp onset at threshold, matching Bouma's critical spacing behavior.
float densityCrowding = 1.0 / (1.0 + exp(-u_crowding_density_steepness * (lgn.density - u_crowding_density_threshold)));
// Floor at 0.3 — even isolated elements get some peripheral degradation (acuity loss),
// just not full crowding distortion.
float crowdingFactor = mix(0.3, 1.0, densityCrowding);
float strength = lgn.suppressionFactor * config.v1_strength_mult * eccentricityScale * crowdingFactor;
```

The `mix(0.3, 1.0, ...)` floor is important: isolated peripheral elements still lose acuity (MIP pooling, desaturation) — they just don't get the full Lateral Smash displacement that makes crowded text illegible. Without the floor, isolated text would look unnaturally sharp in the far periphery.

### 3. V4 MIP pooling inherits automatically

No change needed. V4's coupled pooling (line 606) already uses `v1.distortionStrength`:
```glsl
float coupledEccentricity = v1.distortionStrength * u_intensity * fovea_radius * blurMult;
```
When V1 strength is reduced for sparse regions, MIP pooling automatically reduces too — isolated elements get sharper MIP sampling. This is the correct behavior: less feature mixing in sparse pooling regions.

### 4. Wire up uniforms in renderer

**File:** `renderer/scrutinizer-renderer.js` (or equivalent GL setup)

Pass the two new uniforms to the shader program. Read defaults from modes.json or config.js.

### 5. Expose in modes.json (optional but recommended)

Add `crowding_density_threshold` and `crowding_density_steepness` to mode configs so different rendering modes can tune crowding independently.

## Files to modify

| File | Change |
|------|--------|
| `renderer/shaders/peripheral.frag` | Add density sigmoid + crowdingFactor at line 426 |
| `renderer/shaders/peripheral2.frag` | Same change at line 514 |
| `renderer/config.js` | Add uniform declarations for threshold + steepness |
| `renderer/scrutinizer-renderer.js` | Pass new uniforms to shader |
| `renderer/modes.json` | Add crowding_density defaults per mode (optional) |

## Verification

1. **Reference page A/B:** Load `crowding.html` in Scrutinizer. Fixate at center cross.
   - **Before:** Crowded V and isolated V equally degraded at each eccentricity
   - **After:** Isolated V more recognizable than crowded V, especially at 6° and 10° rows

2. **Threshold tuning:** Adjust `u_crowding_density_threshold` via dev tools:
   - Too low (0.05): Even isolated letters get full distortion (no improvement)
   - Too high (0.5): Dense text also gets reduced distortion (crowding disappears)
   - Sweet spot (~0.2): Isolated elements spared, dense clusters distorted

3. **Regression check on existing pages:**
   - `dashboard.html`: Dense UI should still degrade normally in periphery
   - `article.html`: Body text (high density) distorted, headings with spacing (lower density) slightly clearer — this is correct behavior
   - `grid.html`: Regular grid pattern at uniform density → no change from current behavior

4. **Golden capture:** Re-capture crowding goldens at all 4 fixation points. The crowded-vs-isolated asymmetry should now be visible in the screenshots.

## Open question: density signal strength (for Ruth / team review)

The structure map density difference between a 5-letter crowded group (~0.53) and an isolated letter (~0.44) is small. Three options for increasing the signal, each with different tradeoffs:

**Option A: Sigmoid only (current plan).** Keep `density = fontWeight/900 * 1.2` as-is. The sigmoid amplifies the 0.44→0.53 gap into a meaningful crowdingFactor difference. Pro: zero risk to existing pipeline stages that read density. Con: the shader is doing heavy lifting to separate a narrow signal — fragile if font-weight happens to be similar across content types.

**Option B: Scale group boost by cluster size.** Change gestalt-processor.js line 166 from `* 1.2` to `* (1.0 + 0.1 * Math.min(cluster.length, 8))`. A 5-letter cluster gets 1.5×, a single letter stays 1.0×. Pro: gives the shader more dynamic range with a biologically motivated signal (more items in the pooling region = more features to pool). Con: changes the density channel semantics for ALL downstream consumers, including the LGN whitespace gate and any future saliency-density interaction.

**Option C: Spatial coverage density.** Replace font-weight-based density with `totalInkArea / boumaRegionArea` — a direct measure of how much of the local pooling region is occupied by content. Pro: physically meaningful for crowding (this IS what the TTM measures — feature density within pooling regions). Con: requires computing a Bouma-scaled sampling area per block, which means the Gestalt processor needs eccentricity information it currently doesn't have (it operates in screen-space without knowing fixation position). Would need a two-pass approach or deferred computation.

**Recommendation for first implementation:** Option A. Ship the sigmoid gate with current density values and test against the crowding reference page. If the effect is too subtle, try Option B as a quick follow-up. Option C is architecturally cleaner but requires fixation-aware structure analysis — better suited for a future pass when/if the team validates the approach.

## Future path

- **Local contrast variance** as secondary crowding signal (8 texture fetches in Bouma-scaled ring)
- **Radial/tangential asymmetry** — crowding is stronger along the radial axis (Toet & Levi 1992)
- **Tier 2 mongrel textures** — replace content with statistically-matched texture within pooling regions (Level 2 metamers, requires multi-pass architecture)

## References

- Bouma, H. (1970). Interaction effects in parafoveal letter recognition. *Nature*, 226, 177-178.
- Pelli, D. G., & Tillman, K. A. (2008). The uncrowded window of object recognition. *Nature Neuroscience*, 11(10), 1129-1135.
- Rosenholtz, R., Huang, J., Raj, A., Balas, B. J., & Ilie, L. (2012). A summary statistic representation in peripheral vision explains visual search. *Journal of Vision*, 12(4):14.
- Freeman, J., & Simoncelli, E. P. (2011). Metamers of the ventral stream. *Nature Neuroscience*, 14(9), 1195-1201.
- Zhang, J.-Y., Zhang, T., Xue, F., Liu, L., & Yu, C. (2015). Crowding is unlike ordinary masking. *Journal of Vision*, 9(11):23.
- Toet, A., & Levi, D. M. (1992). The two-dimensional shape of spatial interaction zones in the parafovea. *Vision Research*, 32(7), 1349-1357.
