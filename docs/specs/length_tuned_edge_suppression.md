# Length-Tuned Edge Suppression

> **Last updated:** 2026-05-25

**Status**: Proposed (not yet shipped)
**Created**: 2026-05-25
**Diagnostic**: TBD — proposed `tests/reference-pages/border-suppression.html` (page-tall sidebar + horizontal divider stack at varied lengths). Existing `dashboard.html` and `techmeme.html` work as informal probes.
**Validation**: Wave-adjacent — extends Wave 3 (Crowding) by characterizing how V1 length-tuning shapes peripheral saliency on structural chrome. Quantitative target: Cavanaugh, Bair & Movshon (2002) length-tuning curve — ~60-80% surround suppression at lengths well past the CRF preferred length, with a sharp onset around 2× preferred length.

## Context

Web layouts are riddled with **structural chrome**: page-tall sidebar rails, horizontal section dividers, table column rules, card outlines, sticky-header underlines, scrollbar tracks. These are long, parallel, high-contrast edges. They contribute zero content but light up bright on every saliency / DoG output the renderer produces — because the current pipeline treats edge energy uniformly regardless of edge length.

The result is **visual noise in the foveated browser**: page borders compete with content for the user's peripheral attention budget. The cortical-magnification + Bouma crowding model the renderer already implements correctly degrades the *resolution* of these borders in the periphery, but it doesn't change their *salience* relative to content. A page-tall vertical border at 5° eccentricity is still encoded as "high-contrast feature here" — even though humans treat it as background structure they read past.

Biologically this is solved by **end-stopping** in V1: neurons whose response to a preferred-orientation edge **peaks at a preferred length and then drops** as the edge extends further. A short word-baseline activates the cell fully; a page-tall border drives the cell's endzones into its surround and suppresses output. Long contours are still *seen* (V2/V4 contour integration handles them) but they no longer dominate the saliency signal at V1.

Adding length-tuning to the oriented-DoG pass is the bio-grounded knob for reducing this noise.

## Bio motivation

| Mechanism | Key reference | Operational statement |
|---|---|---|
| End-stopping (length-tuning) | Hubel & Wiesel (1965) *J Physiol* — original hypercomplex cell description in cat V1 | V1 neurons respond preferentially to edges of a limited length; response drops as edge extends past preferred length. |
| Iso-orientation surround suppression | Knierim & Van Essen (1992) *J Neurophysiol* | Same-orientation surround stimulation reduces center response in macaque V1; suppression strongest along the cell's preferred orientation axis. |
| Length-tuning curve quantification | Cavanaugh, Bair & Movshon (2002) *J Neurophysiol* — "Selectivity and spatial distribution of signals from the receptive field surround in macaque V1 neurons" | Surround suppression typically 60-80% of CRF response at lengths 4-8× preferred. Sigmoidal transition with steep slope. |
| Co-existence with contour integration | Field, Hayes & Hess (1993) *Vis Res* — "association field" | Long contours suppressed at single-cell V1 but *integrated* at V2/V4 — so long borders remain perceptible (Gestalt good-continuation) without dominating saliency. |

The dual character matters for Scrutinizer: we want to suppress long-edge *saliency* (V1 contribution to attention) without making long borders *invisible* (they're still structural cues a real observer uses for layout parsing).

## Approach: along-edge persistence probe → sigmoid suppression

The Phase-2 oriented DoG at `renderer/shaders/peripheral.frag:203-242` already computes per-pixel gradient `(gx, gy)`, cardinal/oblique energy split, and an `orientBonus` that scales the per-band DoG response. Length-tuning slots in as an additional multiplicative gate on `orientBonus`.

**Core idea:** sample along the **tangent** of the local edge (perpendicular to the gradient) at K steps. Count how many of those samples have edge energy aligned with the same orientation. High count = long edge = suppress. Low count = short edge = preserve.

```glsl
// Already computed in Phase 2 (lines 213-215):
//   float gx = lum_r - lum_l;
//   float gy = lum_t - lum_b;
//   float g2 = gx * gx + gy * gy;

if (g2 > EDGE_GATE && u_length_tuning_enabled > 0.5) {
    // Tangent direction = perpendicular to gradient
    vec2 tan = normalize(vec2(-gy, gx)) * px;   // px = MIP-1 texel size

    // Sample edge persistence along the tangent. K_STEPS controls the
    // length scale being probed — at MIP 1 (~2 px per texel) with K=8,
    // we probe ±16 px = roughly 8-16 px at native resolution. That maps
    // onto Cavanaugh-Bair-Movshon's "well past CRF" range for a fovea
    // ~45 px radius — a meaningful "long" edge in our coordinate system.
    float persist = 0.0;
    for (int k = 1; k <= K_STEPS; k++) {
        float fk = float(k);
        // Sample luminance gradient at +k and -k tangent steps
        vec3 lumW = vec3(0.114, 0.587, 0.299);  // BGRA-aware, see contract block
        float lp_r = dot(textureLod(u_texture, undistortedUV + tan * fk + vec2(px.x, 0.0), 1.0).rgb, lumW);
        float lp_l = dot(textureLod(u_texture, undistortedUV + tan * fk - vec2(px.x, 0.0), 1.0).rgb, lumW);
        float lp_t = dot(textureLod(u_texture, undistortedUV + tan * fk + vec2(0.0, px.y), 1.0).rgb, lumW);
        float lp_b = dot(textureLod(u_texture, undistortedUV + tan * fk - vec2(0.0, px.y), 1.0).rgb, lumW);
        float gx_p = lp_r - lp_l;
        float gy_p = lp_t - lp_b;
        // Inner-product with center gradient. Positive = same orientation
        // *and* same polarity → edge continues. Normalised by both magnitudes
        // so it's robust to contrast variation along the edge.
        float align = (gx * gx_p + gy * gy_p) / max(sqrt(g2 * (gx_p*gx_p + gy_p*gy_p)), 1e-6);
        persist += max(0.0, align);
        // Symmetric step in the other tangent direction
        // (loop body duplicated for -k steps in the actual shader)
    }
    persist /= float(K_STEPS * 2);  // normalised 0..1

    // Sigmoid suppression — sharp transition with tunable midpoint and slope
    // matching the Cavanaugh-Bair-Movshon curve shape.
    float suppress = 1.0 - (u_length_tuning_strength /
                            (1.0 + exp(-u_length_tuning_steepness *
                                       (persist - u_length_tuning_midpoint))));
    orientBonus *= suppress;
}
```

**Why sigmoid, not linear:**
Length-tuning curves in macaque V1 (CBM 2002, Fig 4) show a sharp shoulder around 2× preferred length, then plateau. Linear under-suppresses short-but-long-enough edges (e.g., paragraph baselines) and over-suppresses very long edges. Sigmoid captures the shoulder + plateau shape and gives one knob (steepness) to tune sharpness vs gradualness.

**Why probe along the tangent, not the gradient:**
End-stopping operates along the edge's *own axis*. Sampling perpendicular to the gradient (= along the tangent) is the right direction to ask "does this edge continue?" Sampling along the gradient asks "is there a parallel edge nearby" — that's collinear facilitation, the *opposite* effect (Field-Hayes-Hess association field), and would *boost* long edges instead of suppressing them.

**Why MIP 1 reads, not MIP 0:**
MIP 1 (2×2 averaging) is what Phase 2 already uses for cardinal/oblique energy. Same level keeps the per-pixel cost reasonable (we add 8 extra texture reads — 4 at +k and 4 at -k — per fragment when the edge gate fires) and matches the spatial scale of the orientation tuning the Phase-2 cell models. Reading at MIP 0 would add noise without information.

**Why a gate on `g2 > EDGE_GATE`:**
Length-tuning only matters at locations that already have detectable edge energy. Flat regions don't trigger the probe — saves the 8 extra reads on most of the screen. Same gate already exists in Phase 2 (`gradMag > 0.005`) and we should share it.

## Why this and not the alternatives

| Alternative | Why we're not doing it |
|---|---|
| Drop saliency weight uniformly | Removes useful short-edge saliency along with the noise. Page-tall sidebars and word baselines would degrade together. |
| Detect borders via DOM (`border` CSS property) | Doesn't generalize beyond Scrutinizer's instrumented capture path; misses purely-rendered borders (e.g., divs with shadow gradients, table column rules without `border`). Pixel-domain bio mechanism is dataset-agnostic. |
| End-stopping at higher MIP levels | Tried mentally — at MIP 3+ the tangent step covers too much of the visual field to be biologically meaningful. The mechanism we're modeling operates at the CRF scale (~1° = ~45 px), which is MIP 1 in our coordinate system. |
| Hand-tuned per-page border masks | Doesn't generalize. Bio mechanism is the point — the whole project is "Scrutinizer mirrors what humans actually do, not what the page declares." |
| Combine with Phase-3 radial-tangential anisotropy | Phase 3 (Toet & Levi crowding) already biases radial vs tangential edges. That's a different mechanism (crowding asymmetry, not length-tuning) and operates on *orientation relative to fovea*. Length-tuning is *orientation-agnostic* — vertical borders, horizontal dividers, diagonal sidebar separators all need suppression. The two mechanisms compose cleanly. |

## Changes

### 1. Add uniforms in `renderer/config.js`

```js
// Length-tuning / end-stopping for structural-chrome suppression.
// See docs/specs/length_tuned_edge_suppression.md.
lengthTuningEnabled: false,        // gated off by default until validated
lengthTuningStrength: 0.7,         // max suppression (0=off, 1=full kill).
                                   // CBM 2002 reports ~60-80% max suppression;
                                   // 0.7 sits in the middle of that range.
lengthTuningMidpoint: 0.5,         // persistence value at which suppression
                                   // is half its max. 0.5 = "edge continues
                                   // ~halfway through the probe window"
                                   // before the sigmoid kicks in hard.
lengthTuningSteepness: 8.0,        // sigmoid slope. CBM 2002 shoulder shape
                                   // is matched well by ~6-10.
lengthTuningProbeSteps: 8,         // K_STEPS — bigger probes longer edges
                                   // but costs 2 texture reads per step.
                                   // 8 = ±16 px at MIP 1 = ~32 px native,
                                   // a "very long" edge near the 45 px fovea.
```

### 2. Add uniforms in `renderer/webgl-renderer.js`

Mirror the uniform-location-lookup + per-frame write pattern already used for `u_dog_oriented`, `u_dog_orient_bias`, etc. ~5 new lines around the existing oriented-DoG uniform block.

### 3. Modify Phase-2 oriented DoG in `renderer/shaders/peripheral.frag`

Add the length-tuning block after the existing `orientBonus` computation (~line 242, before Phase 3 radial-tangential code at line 244). Code sketch above; share the `EDGE_GATE` constant with the existing Phase-2 gradient gate.

### 4. Wire mode metadata in `shared/modes.json`

Add `length_tuning_enabled`, `length_tuning_strength`, etc. to the mode-config block. Default `false` everywhere. Phase 5 of this rollout will turn it on for mode 17 ("Structural Chrome Suppression" — research-only) before promoting to default modes.

### 5. Diagnostic reference page

`tests/reference-pages/border-suppression.html` — a stripped-down page rendering:
- A page-tall vertical sidebar rail (1 px stroke, full viewport height)
- A horizontal divider stack at 5 different lengths (50/100/200/400/800 px)
- A text paragraph (the control — short baselines should NOT be suppressed)
- A table grid (column rules — varying lengths)

Capture this page at center fixation with `length_tuning_enabled=true` and `=false`, diff. Long edges should darken (saliency reduced); short text baselines should be unchanged.

## Validation

### Quantitative (Wave-3 adjacent)

`scripts/validate-length-tuning.js` reads two captures (gated on/off) and reports:

| Metric | Target | Reference |
|---|---|---|
| Long-edge saliency ratio (off/on) | 3-5× reduction at the 800-px divider | CBM 2002 reports 4× response ratio at 5° eccentricity for surround stim 4× preferred length |
| Short-edge saliency ratio (off/on) | < 1.2× change for text baselines under 100 px | Length-tuning should be near-flat in the "preferred" regime |
| Cardinal vs oblique difference | < 10% — mechanism should be orientation-agnostic | CBM 2002 surround tuning is broad across orientation |
| Compute cost (median frame time) | < +0.6 ms vs baseline at 1920×1080 | Budget: 8 extra texture reads per edge pixel, gated by EDGE_GATE so most fragments skip |

### Qualitative (visual regression)

Add to the existing smoke set:
- `smoke_dashboard_lengthtuning.png` — dashboard with length-tuning on, default mode
- `smoke_techmeme_lengthtuning.png` — techmeme.html (text-heavy, lots of horizontal dividers)
- `smoke_borders_lengthtuning.png` — the new border-suppression.html

Manual A/B: switch the menu toggle on a real page (e.g. github.com or stackoverflow.com) and confirm the sidebar rails fade into the periphery instead of carrying bright structural energy.

### Bio plausibility check

Reproduce CBM 2002 Fig 4 (response vs stimulus length) using a synthetic Gabor patch at varied lengths. Curve should match within 20% of published shape. This becomes `scripts/validate-cavanaugh-length-tuning.js`.

## Known limitations (acceptable for v1)

- **Curved long edges** (e.g., a column rule that runs through a CSS-rounded corner) will only have suppression at the straight portions. The corner pixels see edge orientation change mid-probe and persistence drops to ~0.5. Acceptable: the corner is a perceptually-relevant feature anyway (terminator).
- **Crossing long edges** (table cell intersections) — each direction's edge is suppressed by its own length-tuning, but the intersection itself might be over-suppressed if both directions are long. Bio reality: V1 cells at junctions DO see lower response than at the middle of either edge, but T-junctions are recognized as a higher-level feature in V2. We accept the V1-level over-suppression.
- **Anti-aliased borders** with width >1 px may have spatially-varying gradient direction across the border thickness, slightly diluting the probe. Sample-direction normalization mitigates but doesn't eliminate.
- **Doesn't help long curves** that look "short" at any local segment (e.g., a circle perimeter). These would be picked up by V2 contour integration in a real visual system but Scrutinizer doesn't model V2.
- **Low-contrast 1-px chrome bypasses the probe entirely** (discovered empirically 2026-05-25 during P1+P2 A/B). The Phase-2 `edgeGate = smoothstep(0.005, 0.03, gradMag)` filter that guards the probe also filters out edges below that gradient threshold. A 1-px `#dddddd` divider on white produces g² ≈ 0.003 at MIP 1, under the gate, so length-tuning never sees it. This is intentional for compute-cost reasons (don't pay 32 texture reads on flat regions) but means real-world web layouts using light shades like `border: 1px solid #e5e5e5` (very common on github.com, stackoverflow.com, most modern designs) get no benefit. The current heavier 2-px/`#333` borders that this mechanism targets are present but no longer dominant in modern web design. Empirical signal at center fixation on `border-suppression.html`: with the original test page (1-px #999 sidebar, 2-px #333 dividers) only the dividers were suppressed; equalizing the sidebar to 2-px #333 brought sidebar-zone suppression up to 879 px (vs 576 in content), confirming the shader is orientation-symmetric and the asymmetry was contrast-driven.

## Phasing

| Phase | Effort | Risk | Target version |
|---|---|---|---|
| P1: Shader implementation + uniforms + mode 17 | 4-6 hrs | Low — additive on top of existing Phase 2 code | v2.8 (research-only) |
| P2: Reference page + smoke captures | 1-2 hrs | None | v2.8 |
| P3: Quantitative validation against CBM 2002 | 2-3 hrs | Medium — may reveal tuning gaps | v2.8 |
| P4: Menu UX (toggle, intensity knob) | 1-2 hrs | None | v2.9 |
| P5: Enable by default in production modes if validation passes | 1 hr + screenshot review | Medium — visual change to all default renders | v3.0 |

Estimated end-to-end: 1-2 working sessions of focused effort to land P1-P3.

## Decisions

These were open questions in the first draft of this spec; resolved 2026-05-25.

### D1. Composition order with Phase-3 radial-tangential anisotropy

Both Phase-3 (Toet & Levi 1992 crowding anisotropy) and length-tuning modify `orientBonus`. **Length-tuning runs first, then radial-tangential.** Rationale: length-tuning is a single-cell mechanism (V1 CRF length response), radial-tangential is a population-level effect (foveation-relative crowding). The single-cell modulation should apply before the population-level reweighting — same order the cortical layers compose them in. Concretely the shader code becomes:

```glsl
// (Phase 2 produces) float orientBonus = cardinalFrac * edgeGate * u_dog_orient_bias;
// D1: length-tuning suppression — cell-level
if (u_length_tuning_enabled > 0.5 && g2 > EDGE_GATE) {
    /* persist probe + sigmoid suppression — see code sketch in "Approach" */
    orientBonus *= length_suppress;
}
// (Phase 3) radial-tangential anisotropy — population-level
if (u_dog_radial_bias > 0.001) {
    orientBonus *= radialTangentialFactor;
}
```

### D2. Probe span scales with local cortical magnification

Length-tuning probe step is in physical pixels; without scaling, the same probe span covers a vanishing slice of the cortical visual field as eccentricity grows. **The probe scales with local CMF MIP level so it stays biologically meaningful at all eccentricities** — a "long" edge means "long relative to the local pooling region" at every retinal location, which is how a real cortical neuron sees it.

Concrete formulation: keep `K_STEPS` constant; scale the per-step tangent magnitude by a factor derived from the existing `computeMipLevel(eccentricity, fovea_radius)` helper at `peripheral.frag:578`. Half-octave per MIP level matches the existing cortical-distance scaling already used by the DoG band cutoffs:

```glsl
float mipForProbe = computeMipLevel(eccentricity, fovea_radius);
// Probe span doubles every 2 MIP levels (1.41× per level — half octave).
// At mip=0 (fovea): unchanged. mip=2: 2×. mip=4: 4×. mip=6: 8×.
float probeScale = pow(2.0, mipForProbe * 0.5);
vec2 tan = normalize(vec2(-gy, gx)) * px * probeScale;
```

The exact exponent (0.5 here = half-octave per MIP) becomes a validation knob: tune against the CBM 2002 curve replicated at multiple eccentricities. If the published length-tuning shoulder shifts cleanly with eccentricity in their data (it does — receptive field size scales with eccentricity), the half-octave default should match. Otherwise validation will return a corrected exponent.

This means parameter count is unchanged (no new uniform) — the scaling is derived. The cost is still bounded since `K_STEPS` stays fixed; only the texture-sample positions move.

### D3. Diagonal / curved borders accepted as graceful-degradation case

`border-image`, `clip-path`, CSS-rounded corners, and SVG-derived borders can produce curved or diagonal long edges. The tangent probe captures persistence on straight portions but loses persistence at the curvature. **This is accepted as a known limitation** — it's not a regression vs current behavior (which over-weights these too), the suppression just doesn't fire maximally at the curve. The straight runs between curves still benefit. In a real visual system V2 contour integration handles curves; Scrutinizer doesn't model V2.

## Risks and open questions

1. **Compute cost in mid-periphery.** 8 extra texture reads per edge fragment, gated by `g2 > EDGE_GATE`. Most fragments don't hit the gate but page-tall sidebars are EXACTLY the worst case. Mitigation if profiling reveals an issue: cap probe activation by eccentricity (no benefit to a long-edge probe in the fovea anyway, since saliency is supposed to be sharp there) and/or reduce `K_STEPS` adaptively at high MIP levels where each sample already covers more area.

2. **`edgeGate` threshold tradeoff.** The Phase-2 `smoothstep(0.005, 0.03, gradMag)` cutoff serves two purposes: keeping noise/JPEG artifacts/anti-aliased fringe out of the cardinal-vs-oblique calculation, AND keeping the new length-tuning probe from firing on flat regions. P1+P2 empirics confirmed it does its job in the "filter noise" direction — but it also filters out genuinely-long but low-contrast structural chrome (1-px `#dddddd`, `#e5e5e5` borders typical of modern web design). Lowering the gate (e.g., `smoothstep(0.001, 0.01, gradMag)`) would catch these but expose the probe to JPEG-block-edge false positives. P3 should profile both: cost of probe-firing on text-dense pages with a lower gate, and whether the lower gate produces visible improvement on real web pages (github.com, news sites, IDE chrome). One viable middle path: **two gates — a tighter one for orientBonus computation, a looser one for length-tuning probe firing.** Worth evaluating once we have the CBM 2002 baseline.

3. **`orientBonus` as the suppression hook may be too weak.** P1+P2 showed only 0.072% of pixels change in the A/B between mode 14 and mode 17 — the mechanism IS firing, the discrimination IS correct (sidebar suppression > content suppression after the test-page contrast fix), but `orientBonus` only contributes a small additive boost on top of per-band cutoffs (`boost = 1.0 + orientBonus * effectiveEccFade * mix(0.5, 0.1, k/11)`). Suppressing it removes a small bonus. If P3 confirms the visual effect on real pages is still subtle, the next escalation is wiring `length_suppress` into the saliency-map output or structure-mask path where it has a more direct handle on saliency rather than band-weighting. That's a bigger architectural decision and would graduate from this spec into a follow-up.

4. **User expectation calibration.** Some users may have built mental models of "Scrutinizer makes borders visible." Removing border saliency changes the qualitative feel of the periphery. Worth a brief screenshot-comparison in the v3.0 release notes if this graduates to default.

## References

- Hubel, D. H., & Wiesel, T. N. (1965). Receptive fields and functional architecture in two nonstriate visual areas (18 and 19) of the cat. *J. Neurophysiol.* 28, 229–289. — Original hypercomplex cell description.
- Knierim, J. J., & Van Essen, D. C. (1992). Neuronal responses to static texture patterns in area V1 of the alert macaque monkey. *J. Neurophysiol.* 67, 961–980. — Surround orientation tuning.
- Cavanaugh, J. R., Bair, W., & Movshon, J. A. (2002). Selectivity and spatial distribution of signals from the receptive field surround in macaque V1 neurons. *J. Neurophysiol.* 88, 2547–2556. — Quantitative length-tuning curve.
- Field, D. J., Hayes, A., & Hess, R. F. (1993). Contour integration by the human visual system: Evidence for a local "association field." *Vis. Res.* 33, 173–193. — V2/V4 contour integration coexisting with V1 length-tuning.
- Rosenholtz, R. (2012). Capabilities and limitations of peripheral vision. *Annu. Rev. Vis. Sci.* — Context for why structural-chrome suppression matters for peripheral scene parsing.

## Cross-references in this repo

- Existing Phase-2 oriented DoG: `renderer/shaders/peripheral.frag:203-242`
- Existing Phase-3 radial-tangential anisotropy: `renderer/shaders/peripheral.frag:244-273`
- BGRA channel-order contract (length-tuning probe reads must respect it): top of `peripheral.frag`
- Sister Brown-dataflow end-stopped feature detection (different mechanism: D2 *enhances* distortion at end-stops; this spec *suppresses* response on long edges): `docs/specs/implemented/brown_dataflow_integration.md` §D2
- Density-gated crowding (compositional with this — orthogonal mechanism): `docs/specs/implemented/density_gated_crowding.md`
