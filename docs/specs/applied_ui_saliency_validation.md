# Applied UI Saliency Validation (Wave 4b)

> **Last updated:** 2026-03-08

**Status:** Research phase
**Priority:** High — bottom-up saliency is non-functional for UI elements <60px
**Tracks:** v2.2+ validation expansion
**Depends on:** Saliency resolution upgrade (currently 256px DoG can't resolve small UI elements)

## The Problem

Wave 4 validated saliency using basic psychophysics stimuli (color singletons, faces). The face detector (640px input) works — 4.79× protection ratio. But the bottom-up DoG saliency (256px input) cannot resolve individual UI elements smaller than ~60px. For non-face content, there is **no validated protection mechanism**.

This means: nav items, notification badges, status indicators, CTAs, and most interactive UI elements are invisible to the current saliency pipeline. The pipeline protects faces and large color pop-outs, not the things designers actually need protected.

## Two Gaps to Close

### Gap 1: Saliency Resolution
The 256px DoG downscale destroys spatial information needed to detect UI elements. Options:
- Increase DoG input to 512px or 1024px (2-4× compute cost)
- Use the DOM structure map (already at full resolution) as an additional saliency channel
- Hybrid: DoG for color/luminance pop-out, structure map for layout-semantic saliency

### Gap 2: Validation Against Real UI Behavior
No ground truth for "which UI elements should be protected." Need datasets where eye tracking or click behavior on real UIs reveals what users actually attend to peripherally.

## Available Datasets & Studies

### Tier 1: Directly Usable (open data, UI content, eye tracking)

| Dataset | Content | Observers | Key Signal | Access |
|---------|---------|-----------|------------|--------|
| **UEyes** | 1,980 UIs (desktop, mobile, web, posters) | 62 | Fixation maps on real UIs | [Zenodo](https://zenodo.org/record/8010312) |
| **HCEye** | 150 web screenshots + cognitive load conditions | 27 | Saliency under task load | [OSF](https://osf.io/x8p9b/) |
| **UMSI/Imp1k** | 1,000 designs (web, posters, mobile, infographics) | crowdsourced | Importance annotations | [predimportance.mit.edu](https://predimportance.mit.edu/) |
| **WebSaliency** | 450 web pages | 41 | Fixation density maps | [Project page](https://www-users.cse.umn.edu/~qzhao/webpage_saliency.html) |
| **DVSal** | 1,216 dashboards | 60 | Dashboard-specific saliency | [OSF](https://osf.io/eyvda/) |
| **MIT300** | 300 natural scenes | 39 | Benchmark fixations (3s free viewing) | [Download](http://saliency.mit.edu/BenchmarkIMAGES.zip) |
| **CAT2000** | 4,000 images × 20 categories | 24/image (120 total) | Category-specific saliency | [Train](http://saliency.mit.edu/trainSet.zip) + [Test](http://saliency.mit.edu/testSet.zip) |

### Tier 2: Requires Stimulus Recreation

| Study | What They Found | Validation Opportunity |
|-------|-----------------|----------------------|
| **Halverson & Hornof (2011)** | Dense text processed within 0.5° vs sparse within 1°. Sparse groups searched first. EPIC retinal availability: text within 1°, color within 7.5°. | Render their mixed-density layouts through Scrutinizer — does peripheral degradation predict sparse-first search pattern? |
| **Mairena et al. (2019)** | Peripheral notification detection up to 62°. Motion + color > either alone. Task interference degrades detection. | Test Scrutinizer's saliency map on notification-like stimuli at measured eccentricities. |
| **SalChartQA (2024)** | Same chart → different fixations depending on question asked. | Task-driven saliency is beyond current pipeline (no task model), but useful as a ceiling comparison. |

### Tier 3: Reference Models

| Tool | What It Does | How to Use |
|------|-------------|------------|
| **AIM (Aalto)** | 17 computational GUI metrics including saliency, clutter | Feed Scrutinizer output through AIM as independent quality check |
| **CogTool-Explorer** | ACT-R visual search prediction for UIs | Compare Scrutinizer's structure-map-based search difficulty against CogTool predictions |
| **GBVS** | Graph-Based Visual Saliency (Harel et al. 2006) | Baseline comparison — does Scrutinizer's DoG saliency at least match GBVS on UI content? |

## Validation Protocol

### Phase 1: Benchmark (no code changes needed)

1. Download UEyes dataset (1,980 UI screenshots + fixation maps)
2. For each UI screenshot:
   - Run through Scrutinizer in bypass mode → get saliency map texture
   - Compare saliency map against UEyes fixation density map
   - Compute AUC-Judd, NSS, CC, KLD (standard saliency metrics)
3. Decompose by saliency channel:
   - Face detector contribution
   - DoG bottom-up contribution
   - Structure map contribution (if enabled)
4. Report: "Scrutinizer saliency predicts X% of human fixations on UIs" with channel decomposition

**Expected finding:** Face detector carries performance on portrait-heavy UIs; DoG underperforms on text/layout-heavy UIs; structure map (if enabled) may add value for navigation elements.

### Phase 2: Halverson Density Layouts

1. Recreate Halverson & Hornof's mixed-density layouts as HTML reference pages
   - Sparse groups (5 words, 0.66° spacing) and dense groups (10 words, 0.33° spacing)
   - CVC pseudoword layouts (1, 2, 4, 6 groups)
2. Render through Scrutinizer at central fixation
3. Measure: at each group location, what MIP level / DoG band / structure density does Scrutinizer assign?
4. Predict: sparse groups should have higher peripheral "availability" (lower degradation) than dense groups
5. Compare against their eye-tracking finding: participants searched sparse groups first

**This is the strongest behavioral validation available** — it directly tests whether Scrutinizer's density-gated peripheral model predicts real search behavior on structured layouts.

### Phase 3: Resolution Upgrade Validation

1. Implement saliency resolution increase (256→512 or 1024)
2. Re-run Phase 1 benchmark
3. Measure: does higher-resolution saliency improve AUC-Judd on UI content?
4. Specifically: do small UI elements (badges, nav items, icons) now appear in saliency map?

### Phase 4: HCEye Cognitive Load

1. Download HCEye dataset (150 web screenshots × 3 cognitive load conditions)
2. Compare Scrutinizer saliency against fixation maps under:
   - No cognitive load (baseline)
   - Low cognitive load
   - High cognitive load
3. Test: does Scrutinizer's degradation model approximate the attention narrowing seen under load?

## Success Criteria

- **AUC-Judd > 0.70** on UEyes UI fixation prediction (competitive with GBVS baseline)
- **Halverson prediction**: sparse groups get lower degradation scores → correctly predicts search order
- **Channel decomposition**: quantify face detector vs DoG vs structure map contribution
- **Resolution upgrade**: measurable improvement in small-element detection after 256→512px change

## Key References

- Halverson, T. & Hornof, A.J. (2011). A Computational Model of "Active Vision" for Visual Search in HCI. *Human-Computer Interaction*, 26, 285-314. DOI: 10.1080/07370024.2011.625237
- Jiang, Y. et al. (2023). UEyes: Understanding Visual Saliency across User Interface Types. *CHI 2023*. DOI: 10.1145/3544548.3581096
- Fosco, C. et al. (2020). Predicting Visual Importance Across Graphic Design Types. *UIST 2020*. arXiv: 2008.02912
- Mairena, A. et al. (2019). Peripheral Notifications in Large Displays. *CHI 2019*. DOI: 10.1145/3290605.3300870
- Bylinskii, Z. et al. (2017). Learning Visual Importance for Graphic Designs and Data Visualizations. *UIST 2017*. arXiv: 1708.02660
- Shen, C. & Zhao, Q. (2014). Webpage Saliency. *ECCV 2014*.
- Yang, M. et al. (2024). Dashboard Vision. *IEEE TVCG*. DOI: 10.1109/TVCG.2025.3535879
- Wang, Y. et al. (2024). SalChartQA. *CHI 2024*. DOI: 10.1145/3613904.3642942
- Judd, T. et al. (2012). A Benchmark of Computational Models of Saliency to Predict Human Fixations. MIT Tech Report.
- Borji, A. & Itti, L. (2015). CAT2000: A Large Scale Fixation Dataset. arXiv: 1505.03581
- Harel, J. et al. (2006). Graph-Based Visual Saliency. *NIPS*.
- Oulasvirta, A. et al. (2018). Aalto Interface Metrics (AIM). *UIST 2018*.
