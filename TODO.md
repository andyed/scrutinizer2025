# Scrutinizer TODO

Migrated from master backlog on 2026-03-25. Detailed tasks for the Scrutinizer foveated vision simulator.

> **Active roadmap:** the remediation tail below (M1–M4, B3) plus robustness, automation, and the usability-testing pivot are now tracked as executable, low-complexity-runnable tickets in [`docs/sprucing/`](docs/sprucing/README.md) (5-agent broad audit, 2026-07-11). Phase 0 there is the verification-gate fix; do it before building on the default. This TODO section is superseded once Phase 0 lands.

---

## ⚠️ Post-Isotropic Audit Remediation — 2026-06-05

From the 17-agent release audit (`docs/assessments/2026-06-05-post-isotropic-release-audit.md`, covering v2.6.0 → HEAD). Net trajectory: biological plausibility **MIXED** (leaning regress on the *default*), usability **MIXED**. Honesty + engineering hygiene improved while the scientific centerpiece slipped out of the default and the validation layer rotted. Recommendation is **fix-forward, not revert to v2.6.1** — a hard revert would discard the master curve, scanpath replay, the Visual-Memory-Off fix, the v2.7.3 honesty taxonomy, and the BGRA/self-heal stability fixes, while curing only the default-mode regression that B1 fixes in one line. See "Revert vs. fix-forward" note at the end of this section.

### Blockers

- [ ] **B1 — Decide & set the canonical default model.** Shipped default is mode 14 (shatter `v1_distortion_type=1` + `acuity_loss` DoG/MIP), NOT the v2.6.0 anchor mode 12 (FOVI isotropic, type 5, 50 rings). The default churned 12→14 only ~5 days after isotropic shipped, with no comparative validation. **Recommended: restore mode 12 as default** (`main.js:28` and `renderer/scrutinizer.js:109` both hardcode `14`; no settings override exists). This also sidesteps B2 (mode 12 needs no compute path). ⚠️ Verify mode 12 still renders correctly at HEAD first — a v2.7.2 V4-eccentricity shader change silently touched mode 12 (audit #14), so it is NOT identical to the v2.6.1 mode 12. *Fork:* if pyramid-mongrel is judged the better model, instead fix B2 and add the comparative validation that justifies 14 as default.
- [ ] **B2 — Probe the storage-buffer COUNT limit (silent fallback on the default).** `reconBGL` binds 9 storage buffers (`renderer/webgpu-pyramid-compute.js:409`) but `webgpu-probe.js` (~:59-66) only raises buffer *size*, never `maxStorageBuffersPerShaderStage`. On common 8-buffer GPUs `createBindGroupLayout` fails → silent MIP/DoG pixel-blur fallback while the menu still says "Pyramid Mongrel." v2.7.3 disclosed this for mode 15 but NOT for the default mode 14 (rings=50 at HEAD). Fix: add `maxStorageBuffersPerShaderStage` to `requiredLimits` with a feature-detect; if the adapter can't grant 9, surface a loud "cortical pooling unavailable on this GPU" status and badge/disable modes 14 & 15. (Alt: refactor reconBGL to ≤8 buffers.)
- [ ] **B3 — Fix release hygiene.** `git describe` = `v2.7.2-83-g4805f5e` but `package.json` = 2.7.3 and v2.7.3 was never tagged; 83 commits / a whole feature line (length-tuning, Mode 17, BGRA fix, self-heal) sit past the last tag with no CHANGELOG entry. Tag v2.7.3 at `4bf06ac`; decide whether HEAD is v2.8.0 (tag it) or roll `package.json` back; add a release/CI check asserting `package.json version == latest git tag`; delete or populate the phantom `docs/golden/summary-2.8.0.json` + empty `figma/v2.8.0` dirs. (v2.6.1 is also untagged.)
- [x] **B4 — Make the published OCR profile real (Fovea 84/Para 60/Near 62/Far 52).** _DONE 2026-06-06: gate revived, re-captured + calibrated at DPR-2; mode 12 (default) PASSES (fovea 82.4%)._ The dead gate had **three** causes, not just DPR: (1) a tesseract.js-v7 API break — `ocrByRing` read a flat `data.words` that v7 removed, so it read **0 chars on every image**, even a perfect baseline; (2) DPR never pinned; (3) a 0-read recorded as a `0%` datum, only `console.warn` on mismatch.
    - **Done (no-Electron, in `scripts/validate-peripheral-ocr.js` + `main.js` + `package.json`):** v7 block-tree reader + confidence floor (**proven 0→55 chars on a DPR-2 capture**); offline repo-local `eng.traineddata`; **hard-fail exit 2 = INVALID** on DPR/size/zero-read/unreadable-fovea; RC-2.5 over-degradation floor; declining-trend predicate replacing the broken strict-monotonic; `--mode` flag; `force-device-scale-factor` pinned under `TEST_MODE`; `tesseract.js@7.0.0` declared + lockfile synced; CHANGELOG "monotonically declining" corrected.
    - **Done (Electron + calibration):** re-froze the baseline at DPR-2 (2511 chars); regenerated mode-0 + mode-12 curves; both PASS (mode 0 fovea 80.9%, mode 12 fovea 82.4%); rescoped RC-2.5 to the parafovea with a 10% obliteration floor; corrected the CHANGELOG. Negative test confirmed: a DPR-mismatched capture exits 2 (INVALID), not a scored 0%.
    - **Follow-up (deterministic DPR pin):** `force-device-scale-factor` floats with the host display (captures ranged DPR-1↔DPR-2), so the gate currently leans on the size hard-fail to reject mismatches. Pin DPR-2 deterministically via CDP `Emulation.setDeviceMetricsOverride` on the capture targets (the mechanism the mobile path already uses) so it works on any display, not just retina.

### Majors

- [ ] **M1 — Crowding validation is 5/6 failing while releases advertise "0 regressions."** `tests/validation/wave7c-crowding.json`: `mode14_isolated_recognized` fails (conf 0.00), `mode14_flanked_crowded` fails (conf 1.00 = no crowding), asymmetry 0.00; the single "pass" passes only because OCR returned conf 0.00 (<0.5) — passing by failure-to-detect. Crowding is mode 14's *stated mechanism*. Fix the capture/OCR so isolated letters read and flanked letters crowd, or relabel the file a known-failing diagnostic and drop crowding from the validated-claims list. Never let "OCR read nothing" count as a pass.
- [ ] **M2 — radial-profile regression compares a file to a 2 ms clone of itself.** `radial-profile-baseline.json` and `radial-profile.json` are identical except a 2ms timestamp — both written from the same in-memory object on `--freeze-baseline`, frozen on mode 0, never re-frozen across the 12→14 or mode-15 changes → 0% drift by construction. Freeze the baseline from the *current default* in a separate run; record source mode-id in the JSON and fail if it ≠ modes.json default.
- [ ] **M3 — Mode 17 length-tuning: build the named CBM-2002 validation or downgrade the claim.** The two promised scripts (`scripts/validate-cavanaugh-length-tuning.js`, `scripts/validate-length-tuning.js`) **do not exist**, and the 3 unit tests named in mode 17's metadata exist nowhere. Either build the Cavanaugh-Bair-Movshon 2002 synthetic-Gabor curve-replication harness, or change modes.json/spec language from "replicates" to "inspired by, validation pending" and remove the phantom test names. (Mechanism + citation chain are sound; the *quantitative* bio claim is unvalidated.)
- [ ] **M4 — HEAD length-tuning validation artifacts are gitignored.** Every number backing the feature lives in PNGs under `tests/golden-captures/length-tuning-ab/`, which is `git check-ignore`'d (ls-files empty) — unreproducible from a clone. Force-add the A/B captures + a machine-readable manifest, or commit a deterministic regeneration script.

### Minors

- [ ] **m1 — Default label drift.** Shipping default is mode 14, but `shared/modes.json` bakes "(Default)" into the mode-0 label and `menu-template.js` tags both mode 0 and mode 12 "(Default)". Render the Default suffix dynamically from `category:"default"` so three sources can't disagree.
- [ ] **m2 — Headline claims outrunning evidence (relabel, don't re-derive).** v2.7.0 pyramid reference is hand-rolled numpy/scipy but labeled "pyrtools" → call it a self-consistency check; v2.7.1 "C2-continuous" is mathematically C1 → "de-stacked smoothstep boundaries"; v2.7.1 "Figma plugin parity with desktop v2.7" has zero backing files in-repo → scope to its own repo w/ cross-link; v2.7.0 "MAD=0.86" measures the gap to a variance-0.000 *dead* baseline → reframe as "baseline was dead," not a fidelity proof.
- [ ] **m3 — Empty golden summaries + phantom v2.8.0.** `docs/golden/summary-2.6.0.json` and `summary-2.8.0.json` both have `results:[]`; the latter declares an untagged version with `maxPixelDiff:255` (a no-op gate). Populate with real SSIM/PSNR that can fail, or delete; update `docs/golden/README.md` to state parity is not currently computed.
- [ ] **m4 — Stale Brown-SSIM table in an "implemented" spec.** `tier3_lessons_learned.md` still presents mode-15 Brown-comparison SSIM as a sector-pipeline win ("hit or exceeded Brown metamer targets"), but those numbers measured the MIP/DoG fallback geometry mismatch (corrected in CHANGELOG + next-steps, not back-annotated here). Add a dated caveat banner.
- [ ] **m5 — v2.7.2 tagged build silently bundled ~5900 lines of undocumented work** (incl. the mode-12 V4-eccentricity shader change and re-adding `num_cortical_rings=50` to mode 14) under a one-line "hotfix" CHANGELOG. Adopt a policy that all shader/modes.json changes get a CHANGELOG line; retroactively document the 2.7.2 bundle.
- [ ] **m6 — Confirmed standalone defect: off-center fixation not applied.** Top-left fixation captures are byte-identical to center captures (surfaced while refuting audit claim KC4). The isotropic-rendering.json "frozen capture set" framing was itself OVERSTATED (mode 0 is a foveation render, so the 4-decimal parity is an intended regression guard) — the *real* residue is this fixation bug + a provenance gap (committed JSON not byte-reproducible from current artifacts; m0 dashboard 0.0642 committed vs 0.1680 recomputed).

### Revert vs. fix-forward (decision note)

A hard revert to v2.6.1 cures only B1 (default = shatter mode 14) — which B1 fixes in one line — while discarding real post-v2.6.1 gains (eccentricity master curve, scanpath replay, Visual-Memory-Off fix, the honesty taxonomy, BGRA/self-heal). It does **not** fix the validation rot (those baselines were already stale at v2.6.0). The only fair point for a reset — that mode 12 itself drifted via a silent v2.7.2 shader change — argues for *verifying* mode 12 at HEAD (part of B1), not unwinding the tree. The one genuinely open call is scientific, not mechanical: is pyramid-mongrel (14) a better peripheral model than isotropic (12) when it actually runs? The audit established the *churn* was unjustified, not that 14 < 12.

---

## Biological-plausibility roadmap — 2026-06-06

**Where it stands after the post-isotropic session:** the bio-anchored isotropic model (mode 12) is the default again AND empirically validated for the first time (foveal recognition **82.4%**, declining periphery — a real foveation profile, not the old prose fiction). Cortical pooling no longer silently degrades (B2). There is now a working measurement instrument (the peripheral-OCR gate) producing regenerable per-eccentricity curves. Net: bio-plausibility moved from the audit's **MIXED-leaning-regress** toward **MIXED-leaning-advance**. Next, in priority order:

1. **Calibrate the foveation profile against human psychophysics — not OCR readability.** The OCR curve (mode 12 @ DPR-2: fovea 82% / para 15% / near 1% / far 1%) is a machine-readability *proxy*. Compare it to human text-recognition-by-eccentricity (acuity falloff, Bouma crowding b≈0.4–0.5×ecc, reading span) to learn whether each ring over/under-degrades vs human vision, and to convert the gate's thresholds (currently **guessed** — see the RC-2.5 calibration episode) into psychophysics-anchored targets. **The single biggest bio lever now that the instrument exists.**
2. **Settle the L1 cortical-geometry gap honestly** (`docs/next-steps-2026-04.md`, L1–L4). B2 lets mode 15's sector pipeline actually run on capable GPUs again — so test whether sector pooling is salvageable (partition-of-unity / Gaussian-weighted sector overlap per Freeman-Simoncelli, killing the dithered-wedge artifacts) or whether to formally retire it and frame the shipped model as "acuity-graded isotropic displacement." Don't calibrate L2/L3/L4 until L1 is decided.
3. **Validate the unvalidated bio claims.** (a) Mode 17 length-tuning — build the Cavanaugh-Bair-Movshon 2002 synthetic-Gabor curve-replication harness or downgrade "replicates" → "inspired by" (see M3). (b) Re-run the Brown-metamer per-eccentricity SSIM now that mode 12 is the default and captures are DPR-2 (the old numbers measured the broken fallback path).
4. **Deterministic DPR pin (prerequisite).** Without CDP `Emulation.setDeviceMetricsOverride` the bio-validation curves aren't reproducible across machines — this gates the trustworthiness of #1 and #3.
5. **(After L1) Extend per-sector statistics (L2)** toward 4-orientation steerable pyramids — only once L1 is correct.

**Session learnings worth carrying forward:**
- **OCR readability ≠ biological plausibility** — the gate is a proxy; anchor its thresholds in human psychophysics, not round numbers.
- **Captures are display-DPR-dependent and cortical-mode foveation is velocity-gated** — any capture-based validation must pin DPR (DPR-2) and dwell gaze to zero velocity, or it measures artifacts.
- **Recurring "prose vs. artifact" failure mode** (84/60/62/52, mode-15 cortical pooling, Brown SSIM): every bio claim needs a *regenerable artifact* plus a gate that exercises it — prose drifts, data doesn't.
- **Mode 12's first real foveation profile (DPR-2): 82 / 15 / 1 / 1** — the empirical anchor for future bio comparison.

---

## Codebase Cleanup

- [ ] **Rename `mongrelMode` -> `poolingMode`** -- "Mongrel" is academic; "pooling" describes the shader. ~42 files.
- [ ] **Rename peripheral2.frag -> peripheral.frag** -- peripheral2 is the active shader; peripheral.frag is dead code. Delete old, rename, update imports.
- [ ] **ContentAnalyzer interface** -- Formalize registry in PipelineOrchestrator for pluggable analyzers.
- [ ] **Evaluate removing legacy chromatic paths** -- `chromatic_pooling: true` is default (v2.5), legacy branches may be dead code.
- [ ] **Prepare CLAUDE.md for scrutinizer2025 repo**

## Validation & Science

- [ ] **Restore peripheral-OCR validation gate** -- `scripts/validate-peripheral-ocr.js` is currently unusable: tesseract.js returns 0 words on captures because the integration test pipeline now produces images at DPR 1 (1920×984), but the original baseline was DPR 2 (3840×1888) where text is large enough for reliable OCR. Two paths: (a) force the integration capture pipeline back to DPR 2, or (b) add a 2× upscale pre-OCR step in the validator. Either restores the only validation gate that meaningfully discriminates "text readable in periphery" from "no text anywhere" — the gap that allowed a regression to slip through smoke + temporal-variance + unit tests during v2.7.3 development. v2.7.3 release notes call this out as the next big bit.
- [ ] **Update eccentricity peripheral overlay to isotropic cortical grid** -- Current overlay uses simple concentric rings. Should render the FOVI isotropic grid (adaptive spoke count per ring, square cells in cortical space). Match `computeCorticalSector()` geometry from peripheral.frag / Blauch et al. 2026.
- [x] **Restricted Focus Viewer usability-testing guide** -- Practitioner guide for preparing, running, and interpreting moderated observation sessions, including reproducible Study Links. See [`docs/tutorials/usability-testing-practitioner-guide.md`](docs/tutorials/usability-testing-practitioner-guide.md).
- [ ] **MIP chain explainer post update** -- Three sampling paths, DoG isotropy, box vs Gaussian tradeoff, v2.5 Jacobian fix.
- [ ] **Applied UI Saliency Validation** -- Survey applied saliency studies (Halverson/Hornof, UEyes, MIT300, HCEye). Design Wave 4b UI element protection validation.
- [ ] **LukeW Inline Validation Replication** -- Obtain stimulus materials, run through Scrutinizer at measured eccentricities.
- [ ] **"What Peripheral Vision Does to Your UI"** -- Real web content through validated pipeline. CHI/UIST paper potential.
- [ ] **D3 Brown et al. Ground Truth Validation** -- Run Brown metamer pipeline, per-eccentricity SSIM comparison. Scripts set up, needs execution.
- [ ] **Psychophysics Validation Suite** -- Phases 1-4: literature mining, synthesis, technology planning, progressive execution (Waves 1-5).
- [ ] **Covert Peripheral Attention Model** -- Option-hold zoom lens (Eriksen & St. James 1986).
- [ ] **Consumer-Hardware Calibration Pipeline** -- MediaPipe Iris distance + WebGazer gaze + Motion Silence staircase.
- [ ] **Continuous Chromatic Integration** -- Replace discrete DoG-band pooling with continuous perceptive-field integration via 2D LUT.
- [x] **Scanpath Replay & Validation** -- Common format, ScanpathPlayer, `scrutinizer-audit replay` CLI. Shipped v2.7.1: ScanpathPlayer, 3 importers (AdSERP, UEyes, COCO-Search18), replay-adserp.js CLI, fullpage gazeplot tile capture.
- [x] **Mouse Position Replay** -- MouseCursorPlayer renders cursor independently from gaze. Orange arrow cursor + click pulse in SVG overlay. Shipped v2.7.1.
- [ ] **Gaze Replay Blog Post** -- `scrutinizer-www/src/blog/drafts/2026-04-02-gaze-replay.html`. Needs: hero image (raw vs gazeplot side-by-side), 4-up gazeplot grid crops, task model SVG, interactive explorer screenshot. Fix image paths once assets are finalized.
- [x] **Fix scanpath coordinate alignment** -- FPOGX/FPOGY are screenshot-space at 1280px (confirmed by AdSERP authors). Render SERPs at screenWidth, map coordinates directly. Previously had wrong 1422px window-width rendering causing reflow drift.
- [ ] **Full-page gazeplot scroll offset** -- Tile capture scrolls by physical pixels (DPR-scaled) instead of CSS pixels. Tiles overlap or gap on some trials. Need `th` from CSS content bounds, not physical.
- [ ] **Suppress mouse during TEST_MODE captures** -- Physical mouse movement contaminates gazeplot renders. TEST_MODE should ignore real cursor events.
- [ ] **Golden Captures** -- Retroactive v1.8.0 captures, optimize capture suite performance.
- [ ] **FOVI Demo Page Redo** -- Fix flipped images, color decay, clean interactive demo.
- [ ] **Color Search Experiment** -- PostHog opt-in logging for color-search.html.
- [ ] **jsPsych Integration** -- Spec at `docs/JSPSYCH_INTEGRATION_SPEC.md`. Phases 1-3.

## Minecraft Mode Rework

- [ ] Block size = MIP level, color averaging, grid alignment, update modes.json/docs

## Mongrel Textures / PS Synthesis

- [ ] Ship Tier 2: contrast-preserving statistical MIP
- [ ] Ship Tier 3: tile atlas matching
- [ ] Async PS synthesis "Research" mode (WASM)
- [ ] Adopt log-polar warp from Brown et al. 2023
- [ ] End-stopped feature detection pass
- [ ] Generate ground truth mongrels offline
- [ ] Populate Tier 3 atlas via Brown et al.
- [ ] Pre-pool chromatic attenuation in crowding-synth.wgsl

## Blog -- Pending Posts

- [ ] **"Why Zebra Stripes Work"** -- Six reinforcing mechanisms. Concrete UI pattern, clear science.
- [ ] **"500 Million Years of Blue"** -- Evolutionary color vision history. Nature Brief.
- [ ] **"What Painters Already Knew"** -- Neuroscience -> design practice bridge. Design Brief. Includes EXIT sign showdown, school zone sign A/B.
- [ ] **"Your Color Palette Has a Viewing Distance"** -- UX color guidance is eccentricity-blind. Side-by-side captures of popular sites.
