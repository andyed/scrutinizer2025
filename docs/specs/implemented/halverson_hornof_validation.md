# Halverson & Hornof Active Vision Validation

> **Last updated:** 2026-03-08

**Status:** v2.1 — stimulus built, automated pipeline complete, **density gate granularity gap identified**
**Priority:** High — behavioral validation of density gate and peripheral processing
**Contact:** Tim Halverson pinged (Mar 2026); Air Force Research Laboratory, Applied Neuroscience Branch
**Tracks:** Wave 5 (UI visual search behavioral validation)

### What ships in v2.1
- `tests/reference-pages/halverson-mixed-density.html` — stimulus (interactive + static modes, seeded PRNG)
- `scripts/capture-halverson.js` — 3 conditions × 3 modes (Mode 0, Mode 9, bypass) with configurable radius
- `scripts/analyze-halverson.js` — per-group SSIM, edge density, OCR legibility (ground-truth word pool matching)
- `scripts/analyze-halverson.js` — per-group SSIM, edge density, text contrast, availability score
- Tier 1-3 validation criteria defined and auto-checked

### What ships later
- Human subjects data collection (`docs/specs/human_subjects_data_collection.md`)
- CVC pseudoword stimulus (Experiment 2)
- Semantic grouping stimulus (Experiment 3)
- Eye tracking integration (WebGazer or external tracker)
- EPIC × Scrutinizer integration study

## Why This Paper Matters

Halverson & Hornof (2011) "A Computational Model of Active Vision for Visual Search in Human-Computer Interaction" (*HCI Journal* 26:285-314, DOI: 10.1080/07370024.2011.625237) is the closest existing work to what Scrutinizer does — but from the cognitive architecture side rather than the rendering side. They model what the visual system *can perceive* at each eccentricity during UI search; Scrutinizer renders what the visual system *would see* at each eccentricity. The predictions should converge.

Their EPIC-based model answers four questions about active vision during UI search:
1. **When do the eyes move?** → process-monitoring: saccade after perceptual encoding completes
2. **What can be perceived?** → density-dependent encoding within a fixed 1° region
3. **Where do the eyes move?** → fixate-nearby: lowest eccentricity unfixated object
4. **What is integrated between fixations?** → coarse spatial memory of group locations

Each answer has a direct analog in Scrutinizer's pipeline. This is not a coincidence — both systems are instantiating the same perceptual constraints. The difference is that Halverson validated against eye-tracking behavioral data from real UI search tasks (24 participants, 3 experiments), while Scrutinizer validated against psychophysical stimuli (Waves 1-4). This spec bridges the two.

## Parameter Mapping: EPIC → Scrutinizer

| EPIC Parameter | Value | Scrutinizer Analog | Current Value | Match? |
|---------------|-------|-------------------|---------------|--------|
| Text availability radius | 1° visual angle | Foveal radius | ~2° (calibration-dependent) | Scrutinizer is wider — includes parafovea |
| Color availability radius | 7.5° visual angle | Chromatic pooling onset | ~5° (castleCSF RG/BY decay) | Similar order of magnitude |
| Dense recoding threshold | nearest neighbor < 0.15° → 150ms | Density gate threshold | structure map density > threshold | Conceptually identical — density modulates processing |
| Sparse recoding time | 50ms (neighbor ≥ 0.15°) | — | — | Scrutinizer doesn't model temporal encoding |
| Dense recoding time | 150ms (neighbor < 0.15°) | — | — | 3× slower for dense = more fixations needed |
| Effective field of view | 1° radius (constant) | Foveal MIP level 0 region | ~2° radius | — |
| Encoding error (sparse) | 10% miss rate | Peripheral degradation (sparse) | MIP-level dependent | Need to measure |
| Encoding error (dense) | 50% miss rate | Peripheral degradation (dense) | MIP-level + density gate | Need to measure |
| Saccade destination | lowest eccentricity unfixated object | — | No saccade model (mouse-driven) | Scrutinizer shows what's available; search strategy is the user's |
| Working memory | coarse spatial: which groups visited | Visual memory module | `visual-memory.js`: fixation history with decay | Both track group-level, not item-level |

### The Critical Mapping: TEE Model ↔ Density Gate

Halverson's **Text-Encoding Error (TEE) model** (p.299) is the key finding:
- All objects within 1° of fixation are perceived (constant region)
- But the **probability of correct encoding** varies: 90% if nearest neighbor ≥ 0.15°, 50% if < 0.15°
- This beat the Reduced Region model (which shrank the perception area for dense text) with AAE 8.8% vs 21.1%
- The insight: **the field of view doesn't shrink with density — encoding accuracy drops**

Scrutinizer's density gate does conceptually the same thing:
- The rendered region doesn't change with density
- But the **distortion applied** varies with local structure density
- Dense regions get more aggressive V1 crowding (higher displacement, more scramble)
- The effect: dense peripheral content is less "readable" without the perception region shrinking

**The TEE model validates the density gate architecture.** Both say: fixed spatial extent, variable encoding quality as a function of local density. Halverson showed this predicts real search behavior better than shrinking the perceptual window.

### The Semantic Gap

Halverson's Section 4 validation (semantic grouping task, 18 participants) revealed a limit: the model fails when semantic structure is present (AAE = 42.6% for search time, 37.3% for fixations). People pass over semantically coherent groups with a single fixation — they read "nuts: cashew, peanut, almond" and skip the group without searching item-by-item.

Scrutinizer has no semantic model and shouldn't try to build one. But this finding is important for interpreting validation results: on layouts where semantic grouping is strong (nav menus, labeled sections), Scrutinizer's purely visual predictions will overestimate the number of fixations needed. This is a known architectural limit, not a bug.

## Three Experiments, Three Stimulus Types

### Experiment 1: Mixed Density (Figure 3)
- **Layout:** 6 groups of words arranged in a grid
- **Sparse groups:** 5 words, 0.66° inter-word spacing
- **Dense groups:** 10 words, 0.33° inter-word spacing
- **Three conditions:** all sparse (6 groups), all dense (6 groups), mixed (3 sparse + 3 dense)
- **Total layout:** ~7.5° visual angle wide
- **Participants:** 24
- **Key finding:** Sparse groups searched first and faster. Fixation duration: ~250ms sparse, ~350ms dense.
- **Scrutinizer prediction:** Dense groups should show higher MIP-level degradation + stronger density-gate distortion at any given eccentricity → less peripheral "availability" → model predicts sparse-first search

### Experiment 2: CVC Search (Figure 4)
- **Layout:** 1, 2, 4, or 6 groups of CVC pseudowords (ZEJ, HAN, etc.) in fixed positions
- **Groups:** 5 items each, labeled with digits flanked by Xs (e.g., "X1X")
- **Layout size:** scales with group count
- **Participants:** 16
- **Key finding:** Mean saccade distance increases with layout size (1.5° for 1 group → 2.5° for 6 groups). People fixate nearby objects. Scanpath A→B→D→C observed 30% of time in 6-group layouts.
- **Scrutinizer prediction:** At central fixation, groups closer to center should have lower MIP levels and more preserved structure → model predicts fixate-nearby as the rational strategy given peripheral degradation

### Experiment 3: Semantic Grouping (Figure 10)
- **Layout:** 8 groups of 5 words, with/without semantic cohesion, with/without labels, with/without metagroups
- **Layout size:** ~5.77° wide, ~1.54° between groups, ~0.76° within groups
- **Participants:** 18
- **Key finding:** Semantic cohesion substitutes for labels (single fixation to assess group relevance). Metagroups don't affect behavior.
- **Scrutinizer prediction:** No semantic model → can only predict spatial search patterns on the random-grouping condition. For random layouts, model predicted AAE < 10% on all measures.

## Validation Protocol

### Phase 1: Stimulus Recreation

Build HTML reference pages reproducing the three experiment layouts at correct visual angles. The stimuli are simple — words in groups on a white background — easily reproducible in HTML/CSS.

**`reference-pages/halverson-mixed-density.html`**
- Query params: `?condition=sparse|dense|mixed&trial=N`
- Sparse groups: 5 words, 0.66° spacing (at 35px/dva ≈ 23px line spacing)
- Dense groups: 10 words, 0.33° spacing (at 35px/dva ≈ 12px line spacing)
- 6 groups in fixed positions matching Figure 3 geometry
- Word lists from the paper (or equivalent frequency-matched words)

**`reference-pages/halverson-cvc.html`**
- Query params: `?groups=1|2|4|6`
- CVC pseudowords (3-letter consonant-vowel-consonant)
- Groups in positions A-F matching Figure 4
- Label condition: digit flanked by Xs (e.g., "X1X")

**`reference-pages/halverson-semantic.html`**
- Query params: `?semantic=true|false&labels=true|false&metagroups=true|false`
- 8 groups × 5 words
- Semantic categories from Figure 10 (jewelry, nuts, cloth, building parts, homes, farm animals, birds, extinct animals)
- Random condition shuffles words across groups

### Phase 2: Scrutinizer Rendering + Measurement

For each stimulus × condition:

1. **Capture at central fixation** through Scrutinizer Mode 0 (High-Key)
2. **Extract per-group metrics:**
   - Mean MIP level at each group centroid
   - Structure map density value at each group
   - Density gate output (suppression factor) at each group
   - DoG band attenuation at each group (which spatial frequencies survive?)
   - Oklab chroma retention at each group
3. **Compute "peripheral availability score"** per group: composite of MIP level, density gate, and chromatic retention. Higher = more information available peripherally.

### Phase 3: Behavioral Prediction

**Mixed density experiment:**
- Predict: sparse groups have higher availability scores than dense groups at matched eccentricity
- Predict: in mixed layouts, the availability gap between sparse and dense groups should predict the observed search-order preference (sparse first)
- Compare: Halverson's fixation-count data (Figure 7) — does availability score correlate with number of fixations needed?

**CVC experiment:**
- Predict: availability score decreases with eccentricity from fixation center
- Predict: availability gradient should predict saccade distance distribution (Figure 8)
- Compare: mean saccade distance observed (1.5-2.5°) vs the eccentricity at which availability drops below a threshold

**Semantic grouping (random condition only):**
- Predict: search time, fixation count, and saccade distance for the random-layout conditions
- Compare: Halverson's model achieved AAE < 10% on random layouts. Can Scrutinizer's peripheral degradation map predict the same behavioral measures?

### Phase 4: Quantitative Comparison

| Metric | H&H Observed | H&H TEE Model | Scrutinizer Prediction | Source |
|--------|-------------|---------------|----------------------|--------|
| Fixations/trial (sparse) | ~10 | ~9 (AAE 8.8%) | ? | Figure 7 |
| Fixations/trial (dense) | ~17 | ~16 (AAE 8.8%) | ? | Figure 7 |
| Fixation duration (sparse) | ~250ms | ~260ms (AAE 10%) | N/A (no temporal model) | Figure 5 |
| Fixation duration (dense) | ~350ms | ~340ms (AAE 10%) | N/A | Figure 5 |
| Mean saccade distance (6 groups) | ~2.5° | ~2.5° (AAE 4.2%) | ? | Figure 8 |
| Top scanpath (6 groups) | A→B→D→C (30%) | A→B→D→C (30%) | ? | Figure 9 |

Scrutinizer can't predict fixation duration (no temporal model) or fixation count directly (no search termination model). But it CAN predict:
- **Relative difficulty** (dense > sparse) from degradation magnitude
- **Search order** (sparse first, nearby first) from availability gradients
- **Saccade distance** from the eccentricity profile of available information

## v2.1 Findings: Density Gate Granularity Gap

Automated capture-analyze pipeline (Mode 0, Mode 9 "Congestion-Gated", and baseline at multiple foveal radii) reveals a structural limitation:

### The problem: block-level vs word-level density

| Regime | Foveal Radius | Sparse SSIM | Dense SSIM | Discrimination | Result |
|--------|--------------|-------------|------------|----------------|--------|
| Gentle | 90px (2.37°) | 0.990 | 0.987 | 0.3% | Both fully readable; OCR 100% everywhere |
| Medium | 60px (1.58°) | 0.985 | 0.986 | 0.1% | Slight degradation, no density effect |
| Aggressive | 38px (1°) | 0.506 | 0.555 | ~10% wrong direction | Both destroyed equally |

**Mode 9 (Congestion-Gated) vs Mode 0:** Only 0.1% change in sparse/dense discrimination. The congestion gate does not differentiate sparse from dense text groups.

### Root cause

H&H's TEE model computes density at **individual word level** — nearest-neighbor distance < 0.15° triggers 50% encoding error. Scrutinizer's density gate operates at **DOM structure block level** — the structure map sees "a group of text" regardless of whether it contains 5 widely-spaced words or 10 tightly-packed words.

The congestion map (which feeds Mode 9) aggregates structure blocks into a spatial density field. A sparse group (5 words, 0.65° spacing) and a dense group (10 words, 0.33° spacing) occupy similar spatial extent and produce similar congestion values. The intra-group text density that H&H found critical is below the resolution of the structure map.

### Implications

1. **The density gate validates at the macro level** (whole page regions of varying content density) but not at the micro level (word-level spacing within a single text block).
2. **A word-level density signal** would require either: (a) OCR/text detection in the content analysis pipeline, or (b) a pixel-level edge density computation in the shader itself, bypassing the DOM structure map.
3. **The eccentricity gradient is the dominant signal.** The MIP chain correctly degrades periphery > center. But density-within-eccentricity discrimination is absent.

This is a v2.2+ enhancement target, not a v2.1 blocker. The finding is honestly reported in the arxiv paper's Open Problems section.

## Success Criteria (revised)

1. ~~**Density discrimination:** Scrutinizer's density gate assigns measurably different degradation to sparse vs dense groups at matched eccentricity (p < 0.05)~~ → **Not met.** Density gate granularity too coarse for word-level density differences. See above.
2. **Search order prediction:** Availability score rank-orders groups in the same order humans search them (sparse before dense, near before far) → **Partially met.** Eccentricity gradient correct (near > far). Density gradient absent.
3. **Saccade distance correlation:** Availability falloff with eccentricity correlates with observed saccade distances (r > 0.7) → **Deferred** pending human subjects data.
4. **Random-layout prediction:** For the semantic grouping random condition, availability-based search order matches observed patterns → **Deferred.**

## Collaboration Opportunities

If Tim Halverson is responsive:

1. **Share the original stimuli** — exact word lists, pixel coordinates, timing parameters. Saves recreation effort and ensures exact reproduction.
2. **Share raw eye-tracking data** — fixation sequences per participant per trial. Enables per-trial comparison rather than just aggregate means.
3. **Run Scrutinizer on his stimuli** — show him what the pipeline produces on his layouts. The visual output alone would be a compelling demonstration.
4. **Co-author potential** — a paper showing that a real-time rendering pipeline and a cognitive architecture make convergent predictions about UI visual search, validated against the same behavioral data, would be a strong contribution. Bridges the graphics/perception gap that both communities acknowledge.
5. **EPIC integration** — Halverson's Section 5.3 explicitly calls for replacing the step-function availability functions with continuous eccentricity-dependent degradation. Scrutinizer's shader IS that continuous function. Could Scrutinizer's output serve as the "retinal image" input to EPIC's visual processor?

## Architectural Implications for Scrutinizer

### What H&H validates
- **Density gate concept:** TEE model proves encoding quality (not perception region) varies with density
- **Structure map value:** Their model only needs object location — Scrutinizer's structure map provides exactly this
- **Coarse spatial memory:** Their working memory model matches `visual-memory.js` — group-level tracking
- **Fixate-nearby strategy:** When saliency is uniform, proximity drives search — Scrutinizer's eccentricity gradient already models this

### What H&H reveals as missing
- **Word-level density resolution (v2.1 finding):** The density gate operates at DOM block level. H&H's TEE model requires word-level nearest-neighbor distance (< 0.15° threshold). A sparse group and a dense group register as similar-sized structure blocks. Fix path: pixel-level edge density in the shader, or OCR/text-detection in content analysis.
- **No temporal model:** Scrutinizer renders a static frame; H&H model fixation duration and saccade timing. Adding process-monitoring would let Scrutinizer predict not just what's visible but when it becomes visible.
- **No search termination:** Scrutinizer can't predict how many fixations a task needs. This requires task models (SNIF-ACT, CogTool) beyond rendering.
- **No semantic processing:** H&H model fails on semantic layouts (AAE 42.6%). Scrutinizer's DOM structure map captures visual hierarchy (headers, labels) but not semantic content. Both systems share this limit.
- **Horizontal/vertical asymmetry:** Ojanpää et al. (2002, cited in paper) found horizontal word lists searched differently from vertical. Scrutinizer's radially symmetric model doesn't capture this. The polar sector R:T ratio (2:1 radial:tangential) partially addresses this but wasn't designed for reading direction effects.

## Future Direction: EPIC × Scrutinizer

Section 5.3 (p.310) describes exactly the integration path:

> "The default availability of text is that text can be perceived up to 1° of visual angle from the center of gaze, but this could be replaced with a continuous function in which the availability of text (or some other feature) degrades continuously as a function of eccentricity — a more veridical account of how human perception really works."

Scrutinizer's fragment shader IS this continuous function. The MIP chain provides continuous (well, 5-band discrete) eccentricity-dependent degradation. The density gate modulates it by local density. The chromatic pooling adds feature-specific (color) degradation.

A future integration could:
1. Feed Scrutinizer's rendered output as the "retinal image" into EPIC's visual processor
2. EPIC's production rules would then operate on the degraded image rather than the ideal layout
3. This would replace EPIC's step-function availability with Scrutinizer's continuous rendering
4. Predictions would automatically inherit both the spatial degradation (from Scrutinizer) and the cognitive strategy (from EPIC)

This is a research project, not an implementation task — but it's the intellectually honest next step if the validation in Phase 3 shows convergent predictions.

## References

### Primary
- Halverson, T. & Hornof, A.J. (2011). A Computational Model of "Active Vision" for Visual Search in Human-Computer Interaction. *Human-Computer Interaction*, 26, 285-314. DOI: 10.1080/07370024.2011.625237
- Halverson, T. (2008). *An "active vision" computational model of visual search for human-computer interaction*. PhD Dissertation, University of Oregon.

### Halverson & Hornof Series
- Halverson, T. & Hornof, A.J. (2004a). Explaining eye movements in the visual search of varying density layouts. *ICCM 2004*, 124-129.
- Halverson, T. & Hornof, A.J. (2004b). Local density guides visual search: Sparse groups are first and faster. *HFES Annual Meeting*.
- Halverson, T. & Hornof, A.J. (2007). A minimal model for predicting visual search in HCI. *CHI 2007*, 431-434.
- Hornof, A.J. & Halverson, T. (2002). Cleaning up systematic error in eye tracking data. *BRMIC*, 34, 592-604.
- Hornof, A.J. & Halverson, T. (2003). Cognitive strategies and eye movements for searching hierarchical computer displays. *CHI 2003*, 249-256.

### Cognitive Architectures Referenced
- Kieras, D.E. & Meyer, D.E. (1997). An overview of the EPIC architecture. *HCI*, 12, 391-438.
- Anderson, J.R., Matessa, M. & Lebiere, C. (1997). ACT-R: A theory of higher level cognition and its relation to visual attention. *HCI*, 12, 439-462.
- Salvucci, D.D. (2001). An integrated model of eye movements and visual encoding. *Cognitive Systems Research*, 1, 201-220. [EMMA]
- Fu, W. & Pirolli, P. (2007). SNIF-ACT: A cognitive model of user navigation on the world wide web. *HCI*, 22, 355-412.

### Related Search Models
- Wolfe, J.M. (1994). Guided search 2.0. *Psychonomic Bulletin and Review*, 1, 202-238.
- Fleetwood, M.D. & Byrne, M.D. (2006). Modeling the visual search of displays. *HCI*, 21, 153-197.
- Lohse, G.L. (1993). A cognitive model for understanding graphical perception. *HCI*, 8, 353-388.
- Pomplun, M., Reingold, E.M. & Shen, J. (2003). Area activation: A computational model of saccadic selectivity. *Cognitive Science*, 27, 299-312.

### Perceptual Constraints
- Bertera, J.H. & Rayner, K. (2000). Eye movements and the span of effective stimulus in visual search. *P&P*, 62, 576-585.
- Bouma, H. (1970). Interaction effects in parafoveal letter recognition. *Nature*, 226, 177-178.
- Ojanpää, H., Näsänen, R. & Kojo, I. (2002). Eye movements in the visual search of word lists. *Vision Research*, 42, 1499-1512.
- Casco, C. & Campana, G. (1999). Spatial interactions in simple and combined-feature visual search. *Spatial Vision*, 12, 467-483.
