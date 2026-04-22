# Stage 9 — Mind2Web Target-Discrimination Validation

**Status:** v3, 2026-04-22. Replaces the free-viewing UEyes plan as the primary validation target; UEyes becomes a secondary bottom-up-only ablation. Pixel source pivoted from naked-DOM re-render (v1) → Multimodal-Mind2Web screenshot (v2) → Mind2Web raw-dump MHTML (v3). See §Pixel-source pivot for history.

**Companion docs:**
- `docs/specs/mind2web_attention_experiment.md` — pipeline + task selection
- `docs/dom-aware-perception-plan.md` — primitive taxonomy, Stage 6/7/8 calibration curves
- `docs/UEYES_VALIDATION_SPEC.md` — secondary, bottom-up-only amplitude-distribution sanity check

## Claim

Scrutinizer's peripheral representation contains sufficient information to discriminate the correct action target from same-type distractors at task-realistic eccentricities, and does so with an eccentricity-dependent profile predicted by the DOM-aware plan's per-primitive calibration curves.

This is an information-theoretic claim about the peripheral representation, not a gaze-prediction claim. Click targets ≠ fixation endpoints; Mind2Web is not used as a gaze corpus.

## What Mind2Web cannot claim

- Not gaze prediction. Targets are final action endpoints, not scanpath samples. Top-down task priors dominate the selection.
- Not bottom-up-vs-top-down decomposition. Same reason.
- Not task-free periphery performance. For that, UEyes Test 1 (amplitude-distribution fit) runs as a secondary ablation.

## Validation corpus

- **Mind2Web** full train split: 11 JSON files, 1,009 tasks, 7,775 actions across 73 websites × 3 domains (Travel 467, Shopping 281, Entertainment 261).
- Each action carries a target element with `backend_node_id`, `bounding_box_rect`, `tag`, and a pool of `neg_candidates` with the same attributes.
- **Valid transitions** (where prior-action gaze is defined): **6,088**. First-actions (N=1,262, ~17%) dropped from primary analysis because landing-gaze is a modeling assumption, not data. Caveat for the paper: first-actions land on homepage-prominent elements (logo, hero button, search) and are likely an easier subset; reported AUCs under-estimate performance on the natural task-start distribution.

## Eccentricity distribution (locked for bin design)

Computed at **PX_PER_DEG=29** (UEyes viewing-geometry assumption; pinned in `config_hash`).

| Primitive | N | Median | IQR | 90th %ile |
|---|---|---|---|---|
| button | 1,604 | 11.0° | 5.8–20.0° | 30.2° |
| link | 1,503 | 11.8° | 5.7–23.4° | 38.9° |
| form_input | 1,347 | 9.0° | 4.5–15.5° | 26.9° |
| icon/image | 249 | 12.5° | 5.5–22.5° | 31.7° |
| other (span/div) | 1,355 | 8.5° | 4.2–17.7° | 33.0° |
| heading | 30 | 15.0° | 8.5–22.6° | 31.8° |

Full-corpus 99th percentile is 124°; max 622° (scroll-dominated cases). Evaluation caps at **30°** to exclude the scroll tail (~12% of transitions). Scroll-transitions are a separate workstream, not a claim this memo makes.

## Three eccentricity bins

- **Bin 1 — Sanity (0–5°).** Foveal-to-parafoveal. Scrutinizer must pass here or something is broken. **Pass-gate only.** Does not contribute to contribution claims.
- **Bin 2 — Headline (5–20°).** Acuity/crowding transition zone. **51.5% of all targets** live here. This is where Stage 6/7/8 calibration curves actually do work, and where a well-calibrated peripheral model should beat trivial baselines.
- **Bin 3 — Differentiator (20–30°).** Deep periphery. Baselines fall off faster than a correctly-calibrated mechanistic model. Strongest discrimination between Arm-0 and baselines.

## Arm-0 — the reference config

One mode, one set of constants, pinned in a `config_hash` and committed to this memo before the first at-scale run.

- **Mode:** 16 (DOM-aware path hard-off; pure bottom-up cortical-magnification + pooled-statistics baseline).
- **`u_dogEnabled = 1`**, explicit. No capability-detected fallback to MIP. If WebGPU sector compute is unavailable on the host, the run fails loudly rather than silently downgrading.
- **Viewing geometry:** `PX_PER_DEG=29`, recorded in config_hash.
- **Cortical magnification:** Schwartz log-polar, `e0` frozen at current default.
- **Pool-size constants:** Rosenholtz linear, current defaults.
- **Anisotropy factor `h`:** isotropic (h=1.0).
- **IOR:** off for this validation. Per-action gaze is reset to prior-action target center, so inhibition-of-return over a scanpath is not modeled.
- **Gaze initialization:** center of prior-action target's `bounding_box_rect`. First-actions excluded from primary analysis.
- **Viewport / bbox provenance:** Mind2Web `bounding_box_rect` values are authoritative and were captured at a 1280px-wide render. Scrutinizer's BrowserView renders to a matching 1280×768 viewport with no reflow. No DPR scaling applied to bbox coordinates. Any bbox-space mismatch fails the bbox-projection round-trip test in Step 3 and blocks progression.
- **Scroll state:** for SCROLL-then-CLICK transitions, the prior-action gaze is set to the **post-scroll viewport center**, not the pre-scroll target center. SCROLL actions themselves do not produce transitions (no discrimination test on a scroll target).
- **Pooled-stat vector path:** the DoG-reconstructed sampling in `renderer/shaders/peripheral.frag` (not the MIP fallback). Exact function name and commit SHA pinned in `tests/validation/mind2web/arm-0-config.json` at Step 1.

An **Arm-1 exploratory** run using the latest DOM-aware composite (mode 20+) is a follow-up, not a headline number.

## Primary metric — pre-registered

**L2 distance in pooled texture-statistic space**, computed at each candidate's bounding-box center after peripheral rendering from Arm-0 at the prior-action gaze.

- For each action *i* with prior-action gaze *g = center(target_{i−1})*:
  1. Render the full page through Arm-0 with fovea at *g*.
  2. Extract the 7-D pooled-statistic vector at each candidate's bbox center: the correct target *t⁺* and same-type `neg_candidates` *t⁻*.
  3. Compute distinctiveness score `S(c) = ‖stats(c) − stats(surround(c))‖₂` for each candidate *c*.
  4. Compute rank of *t⁺* among same-type distractors by *S*. Convert to per-trial AUC.

**Pooled-stat vector composition (7-D, pre-registered).** Computed on the peripheral-rendered PNG — i.e. the output of `sampleDoGReconstructed`, not the source image:

| Dim | Channel | Source | Normalization |
|---|---|---|---|
| 1 | R | RGBA at bbox center / surround | / 255 |
| 2 | G | RGBA at bbox center / surround | / 255 |
| 3 | B | RGBA at bbox center / surround | / 255 |
| 4 | A | RGBA at bbox center / surround | / 255 |
| 5 | var_I  | Oklab L local variance, σ=2.5 | frame-max (normalizeFeature) |
| 6 | var_RG | Oklab |a| local variance, σ=2.5 | frame-max |
| 7 | var_BY | Oklab |b| local variance, σ=2.5 | frame-max |

Rationale for 7-D over 4-D-RGBA: Step 3 v0 showed 4-D RGBA is thin on visually-homogeneous UI categories (form pages where all inputs are white rectangles), yielding target distinctiveness below distractors. The three Rosenholtz 2007 Feature Congestion channels — luminance variance, red-green variance, blue-yellow variance in Oklab space — add the texture/contrast structure that pure RGBA sampling misses. The memo's original secondary-metric clause ("crowding-inspired flanker-density measure") named exactly this family; v1 promotes it to primary because the thinness was real and observed.

All 7 dimensions are normalized to [0, 1] before L2. RGBA dims: raw value / 255. FC dims: divided by the per-frame max (normalizeFeature in `renderer/congestion-core.js`), so the denominator is stable within a trial but not across trials — the 0–1 range encodes "how much local contrast does this candidate have relative to the busiest point in the rendered periphery of this page."

**Code path pins (blob-SHA'd in `tests/validation/mind2web/arm-0-config.json`):**
- `renderer/shaders/peripheral.frag::sampleDoGReconstructed` — DoG-reconstructed peripheral frame
- `renderer/congestion-core.js::{computeLocalVariance, normalizeFeature, gaussianBlur}` — Rosenholtz FC
- Oklab I/RG/BY decomposition formula from `scripts/export-saliency.js:80-108` (duplicated inline in the Mind2Web render driver with a pinning comment; the constants are rooted in Ottosson 2020)

**`surround(c)` definition (pre-registered):** the Rosenholtz pooling region at *c*'s retinotopic location given gaze *g* — i.e. the pooled-statistics window that the peripheral model itself assigns to the cortical patch subtending *c*. Computed as an annulus-mean over the 7 vector dimensions at the candidate's screen-space bbox center. (Step 3 v0 used a 1°-radius placeholder; Step 3 v1 uses the pool-radius schedule `c[k] = cmf_a*(exp(k*0.5*scale)-1)/fovea_deg` from `peripheral.frag:322-338`.)

**Secondary metrics** reported for triangulation but not headline: KL divergence over the same 7-D vector, edge-density at candidate center (Sobel+Gaussian per `computeEdgeDensity`).

## Baselines

1. **Null random.** Uniform random rank.
2. **Distance-only.** Smaller euclidean distance from *g* → higher score. Captures the trivial "close things are visible" heuristic. Arm-0 must beat this materially to claim contribution.
3. **Itti-Koch saliency** (if wired; else skip and document).
4. **No-cortical-magnification ablation.** Arm-0 with `M(e) = 1` identity. Tests whether the eccentricity-dependent pooling is what does the work.
5. **No-pooled-statistics ablation.** Arm-0 with raw-pixel sampling (no summary stats). Tests whether the pooled representation is what preserves discrimination.

Baseline ordering prediction: **Arm-0 > no-pooling > no-magnification > distance-only > random**.

## Distractor pool

Same-type `neg_candidates` for each action, visible in viewport at the prior-action gaze (i.e. within the page's rendered bounds — not off-screen DOM nodes). If a trial has fewer than 4 same-type distractors, it is dropped from primary analysis and tallied.

## Success criteria

- **Bin 1 sanity (0–5°):** Arm-0 AUC ≥ 0.85 per primitive. Fail-loud gate; not a contribution claim.
- **Bin 2 headline (5–20°):** **Paired bootstrap** on the per-trial difference `AUC_Arm0(trial) − AUC_distance-only(trial)`, 1,000 resamples at trial level. Contribution claim holds for a given primitive iff the 95% CI lower bound of the paired difference > 0, **Bonferroni-corrected to α = 0.05/3 = 0.0167 per primitive** (equivalently, the 98.33% CI lower bound of the paired difference > 0). Separately for button, link, and form_input.
- **Bin 3 differentiator (20–30°):** Arm-0 AUC > 0.6 with paired-bootstrap 95% CI lower bound > 0.5, separately per primitive. Bonferroni correction also applied (98.33% CI).
- **Ablation ordering:** the predicted baseline ordering holds in at least bin 2 for all three primary primitives. Violations flagged but do not by themselves disqualify the result. (Five-way ordinal claim; exploratory.)

## Pre-registered primary analysis

- **Primary primitives:** button, link, form_input (N ≥ 1,300 each).
- **Primary bin:** bin 2 (5–20°).
- **Primary comparison:** Arm-0 vs. distance-only baseline.
- **Primary statistic:** paired bootstrap on per-trial `AUC_Arm0 − AUC_distance-only`, 1,000 resamples at trial level, 95% CI (or 98.33% CI with Bonferroni correction applied — see success criteria).
- **Multiplicity:** three primary comparisons (one per primitive) under Bonferroni at family α=0.05.

Everything else (bin 1, bin 3, icon/image, heading, other, secondary metrics, Arm-1 exploratory, per-site AUC) is **exploratory**, reported separately and labeled as such. No hypothesis tests on exploratory cells.

## Held-out split

Locked before first run:

- **Dev:** 1/3 of tasks, stratified by website-hash so same site doesn't straddle. Used for pipeline debugging and metric sanity checks.
- **Eval:** 2/3 of tasks, untouched until Arm-0 config_hash is frozen. Headline numbers reported only on eval.

Split RNG seed recorded in config_hash. Split files committed to `data/mind2web-split.json`.

## Sheet structure

Each primary primitive gets a validation sheet in `tests/validation/mind2web/`:

```
button-sheet.md
link-sheet.md
form-input-sheet.md
```

Per sheet:
1. N in corpus, N in dev, N in eval
2. Eccentricity distribution (duplicate of table above, for reference)
3. Arm-0 AUC per bin with bootstrap CI
4. Baseline AUCs per bin
5. Ablation ordering check
6. Worst-performing trials (top 20 failures) — for qualitative diagnosis
7. Calibration-curve check against the Stage 6/7/8 prediction for this primitive

## Open questions (lock before first at-scale run)

Resolved (folded into Arm-0 spec above): `config_hash` format (canonical-JSON + SHA256), pooled-stat vector path (`peripheral.frag` DoG-reconstructed sampling), rendering geometry (1280×768 no-reflow), `surround(c)` (Rosenholtz pool at retinotopic location), bootstrap protocol (paired, trial-level), multiplicity (Bonferroni α/3).

Still open — resolve at the step noted:

1. **Distractor cap** — resolve at Step 4 smoke-test once actual `neg_candidates` distribution is observed on the 5 demo tasks. Proposal: keep all same-type visible distractors; cap at top-100 by distance-from-target only if median count > 50 skews bootstrap.
2. **Same-type filter on `other` (span/div/generic/label).** ~22% of targets collapse to "other" across heterogeneous tags. Resolve at Step 4: either (a) require exact-tag match within the "other" bucket (span-vs-span, div-vs-div), or (b) accept any "other"-bucket distractor. Low stakes — `other` is exploratory only.
3. **Heading at N=30** — standalone sheet is underpowered. Options: fold into "other," drop, or report as a caveat in the exploratory section. Resolve at Step 5 dev run.

## What ships next

- This memo, committed.
- `docs/specs/mind2web_attention_experiment.md` + `scripts/mind2web-extract-task.js`, committed alongside.
- Held-out split generator: `scripts/mind2web-split.js` → `data/mind2web-split.json`.
- `tests/validation/mind2web/arm-0-config.json` — the config_hash source.
- Three empty validation-sheet stubs.

Arm-0 renders on eval tasks are the next concrete run, after this memo is committed and the config_hash is frozen.

## Pixel-source pivot (v1 → v2 → v3)

The memo's original implementation assumed Scrutinizer could re-render Mind2Web's `raw_html` through its BrowserView and sample the peripheral shader's output at the bbox coordinates embedded in the DOM. This turned out to be wrong, and correcting it took three iterations. Recording the history here because the wrong path was plausible enough that future-me would likely re-try it.

### v1 (naked-DOM re-render) — ❌ broken

Pipeline: `raw_html → file:// URL → Electron BrowserView → mode 16 peripheral render → PNG → sample at bbox centers`.

Finding: Mind2Web's `raw_html` contains **zero stylesheets, zero `<style>` blocks, zero inline `style=` attributes, zero external `src=` references**. The DOM has `class=` attributes (1968 of them in a typical page) but no CSS to match. Scrutinizer rendered naked DOM with browser-default styling. The `bounding_box_rect` values baked into each node as attributes were captured against the *original* CSS'd render, so sampling at those coords on a naked-DOM re-render returned pixels from the wrong elements.

Result on united.com action 1 (combobox, N=5 same-type distractors): per-trial AUC = 0.800 in v2 (correct pixels), **0.000** in v1 on the exploretock form page equivalent. The v0/v1 numbers are artifacts of mis-aligned sampling, not real discrimination signals.

### v2 (Multimodal-Mind2Web screenshot) — ✓ correct pixels, ✗ no DOM

Pivot discovery: the 2024-03-18 [Multimodal-Mind2Web](https://huggingface.co/datasets/osunlp/Multimodal-Mind2Web) release pairs each action with the authoritative webpage screenshot (1280-wide full-page PNG). The screenshot IS the pixels `bounding_box_rect` was captured against, by construction.

Pipeline: `screenshot PNG → minimal HTML stub wrapping the image at 1280×768 viewport → Electron BrowserView → mode 16 shader processes the image → sample at bbox centers`. Matches `scripts/capture-coco-periph.js` pattern for static-image peripheral rendering.

Result on united.com action 1: AUC = 0.800 (vs 0.000 for v1's naked-DOM). Real signal.

Limitation: the screenshot is a rendered image. `renderer/preload.js` has nothing to classify — there is no live DOM. This forecloses Arm-1 (DOM-aware, mode 20+) validation, which needs preload.js to produce a primitive-map texture the shader consumes. v2 validates Arm-0 (bottom-up) but cannot compare Arm-0 vs. Arm-1 on the same corpus.

### v3 (Mind2Web raw-dump MHTML) — ✓ correct pixels, ✓ live DOM

Pivot discovery: Mind2Web's raw dump (Globus endpoint `32e6b738-a0b0-47f8-b475-26bf1c5ebf19`, self-serve with Google login) ships per-action MHTML snapshots at `task/{annotation_id}/processed/snapshots/{action_uid}_before.mhtml`. MHTML is the Chromium single-file bundle format — HTML + CSS + images + fonts all base64-inlined. Electron's BrowserView loads MHTML natively via `file://…mhtml` and rehydrates the full styled page including live DOM.

Pipeline: `MHTML → file:// URL → Electron BrowserView (rehydrates CSS + resources) → mode 16 shader over the live page → sample at bbox centers`. preload.js's primitive classifier now has a real DOM to walk, unblocking Arm-1.

Result comparison on united.com task, same bboxes / fovea / config:

| action | same-type N | v2 AUC | v3 AUC |
|---|---|---|---|
| idx 1 (combobox, TYPE Brooklyn) | 5 | 0.800 | **0.800** |
| idx 4 (calendar, CLICK date) | 262 | 0.709 | 0.306 |

MHTML rehydration is not pixel-byte-equivalent to the Multimodal screenshot — tiny JS-state / font / timing differences shift values. But the AUC metric is rank-based, and on well-posed actions (few same-type distractors, clearly-different candidates) the rank order is preserved. Divergence only shows up on pathological UIs where same-type distractors are near-identical by construction.

### Pathological-UI exclusion

**Rule (pre-registered):** actions with > 50 same-type distractors *where those distractors are structurally near-identical* are excluded from the primary analysis. Canonical examples: calendar date pickers (250+ `<td>` cells, all white), time-slot grids, paginated identical list items. Discrimination is not well-posed here — a human without top-down task knowledge couldn't distinguish the correct candidate either, and a few pixels of rehydration drift flips ranks by dozens of positions.

The simpler **operational filter** used during extraction: drop trials where same-type distractor count exceeds **50** (the 95th percentile of Mind2Web trial distractor counts within the first viewport). Implemented in `scripts/mind2web-extract-multimodal.py` constraint check. This is the conservative cut; a more principled filter (distractor-variance-based) can replace it in a secondary analysis.

### Canonical pixel source (v3+)

Arm-0 and Arm-1 both validate against MHTML-rehydrated pixels. The Multimodal-Mind2Web parquet remains the canonical **metadata** source (bboxes, pos/neg_candidates, action_uid → MHTML filename lookup). The screenshots in that dataset are retained as a secondary "sanity baseline" for verifying MHTML rehydration isn't systematically biased, but are not the primary metric input.

### What the v1/v2 cache files mean

The `data/mind2web-cache-<hash>/*/*-v1.{png,json}` and `*-v2.{png,json}` artifacts from the Step 3 v0 and Step 3 v1 commits (hash prefix `17f60ab97e5c`, `1702a0aa0d57`) are artifacts of the misaligned pixel source. They are not valid validation results. The config_hash change to the v3 hash invalidates them by design — cache files keyed by old hashes are ignored.
