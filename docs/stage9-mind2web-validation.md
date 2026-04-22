# Stage 9 — Mind2Web Target-Discrimination Validation

**Status:** v0 memo, 2026-04-21. Replaces the free-viewing UEyes plan as the primary validation target; UEyes becomes a secondary bottom-up-only ablation.

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
- **Valid transitions** (where prior-action gaze is defined): **6,088**. First-actions (N=1,262) dropped from primary analysis because landing-gaze is a modeling assumption, not data.

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

An **Arm-1 exploratory** run using the latest DOM-aware composite (mode 20+) is a follow-up, not a headline number.

## Primary metric — pre-registered

**L2 distance in pooled texture-statistic space**, computed at each candidate's bounding-box center after peripheral rendering from Arm-0 at the prior-action gaze.

- For each action *i* with prior-action gaze *g = center(target_{i−1})*:
  1. Render the full page through Arm-0 with fovea at *g*.
  2. Extract the pooled-statistic vector at each candidate's bbox center: the correct target *t⁺* and same-type `neg_candidates` *t⁻*.
  3. Compute distinctiveness score `S(c) = ‖stats(c) − stats(surround(c))‖₂` for each candidate *c*.
  4. Compute rank of *t⁺* among same-type distractors by *S*. Convert to per-trial AUC.

**Secondary metrics** reported for triangulation but not headline: KL divergence, crowding-inspired flanker-density measure.

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
- **Bin 2 headline (5–20°):** Arm-0 AUC > distance-only baseline with bootstrap-CI lower bound > baseline upper bound, separately for button, link, and form_input. This is the headline result.
- **Bin 3 differentiator (20–30°):** Arm-0 AUC > 0.6 with bootstrap-CI lower bound > 0.5, separately per primitive.
- **Ablation ordering:** the predicted baseline ordering holds in at least bin 2 for all three primary primitives. Violations flagged but do not by themselves disqualify the result.

## Pre-registered primary analysis

- **Primary primitives:** button, link, form_input (N ≥ 1,300 each).
- **Primary bin:** bin 2 (5–20°).
- **Primary comparison:** Arm-0 vs. distance-only baseline.
- **Primary statistic:** bootstrap CI on AUC-per-primitive-per-bin, 1,000 resamples at trial level.

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

1. **`config_hash` format.** JSON or CLI-arg string? Proposal: JSON committed to `tests/validation/mind2web/arm-0-config.json`, SHA256'd, hash-prefix included in every output filename.
2. **Pooled-statistic vector definition.** Rosenholtz feature bank as currently implemented vs. a pared-down subset. Pin current default; don't tune.
3. **Distractor cap.** Some actions have 1,000+ `neg_candidates`. Cap at top-N by distance-from-target (within viewport) or keep all? Proposal: keep all same-type visible distractors; if mean distractor count > 100 skews bootstrap, revisit.
4. **Per-website stratification.** Should bootstrap resample at trial level, website level, or nested? Proposal: trial-level for primary; per-website breakdown as exploratory.
5. **Rendering geometry.** Mind2Web raw_html uses `bounding_box_rect` from a 1280-wide render. Scrutinizer's BrowserView render geometry must match for bboxes to be valid. Pin viewport size in config_hash.

## What ships next

- This memo, committed.
- `docs/specs/mind2web_attention_experiment.md` + `scripts/mind2web-extract-task.js`, committed alongside.
- Held-out split generator: `scripts/mind2web-split.js` → `data/mind2web-split.json`.
- `tests/validation/mind2web/arm-0-config.json` — the config_hash source.
- Three empty validation-sheet stubs.

Arm-0 renders on eval tasks are the next concrete run, after this memo is committed and the config_hash is frozen.
