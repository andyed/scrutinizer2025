# Scrutinizer v2.8.0 — Verification-First Hardening

**Date:** 2026-07-11
**Previous:** [v2.7.3](release_notes_v2.7.3.md)

This release makes the instrument tell the truth about itself. The scientific default is restored to isotropic cortical sampling, the peripheral degradation the model *claims* is now gated by validators that actually run, and two classes of "spurious peripheral structure" — where the shader fabricated detail from nothing — are fixed. It also lands a new structural-chrome-suppression mode and first-class static-image foveation.

## Highlights

### Default restored to isotropic cortical sampling (Mode 12)

The default reverts from Mode 14 (Pyramid Mongrel) to **Mode 12 (FOVI Cortical Grid)** — the isotropic cortical-sampling geometry (Blauch, Alvarez & Konkle 2026) that is the project's stated scientific anchor. Mode 14 had displaced it with no comparative validation, leaving the shipped model out of step with the science. Mode 12's parameters are unchanged from v2.6.0.

### RC-2.6 — spurious peripheral structure fixed (radial + OCR)

The deep periphery now degrades to an honest local mean instead of manufacturing structure that reads as text or contrast on a blank field:

- **Rod "eigengrau" grain** (High-Key / Biological modes) is now contrast-gated by local source structure. On a zero-variance field it switches off, eliminating the per-pixel grain that rose monotonically toward the periphery on a blank wall (`validate:radial:injection` rise 0.0020 → 0.0007).
- **DoG-reconstruction phantom glyphs** are washed toward the coarse local mean in the far field, so crowded/displaced letter fragments lose the glyph-scale contrast OCR misread as peripheral text (Mode 0 far-periphery phantom chars 16 → 6; Mode 12 stays clean). Foveal, parafoveal, and near readability all preserved.

### Verification-first hardening

The validation layer was overhauled so gates fail loudly instead of passing vacuously:

- **Peripheral-OCR readability gate revived** — three defects had silently zeroed it (tesseract.js v7 block-tree reader, DPR pinning, hard-fail on size/zero/unreadable-fovea). Baseline and per-mode curves regenerated as real DPR-2 data; Mode 0 (fovea 80.9%) and Mode 12 (fovea 82.4%) pass the full gate.
- **Radial contrast-profile validator** gained stimulus classification (flat / uniform / content) so monotonicity is asserted only where it's physically meaningful, plus a DPR-mismatch guard; content + uniform baselines frozen.
- **Cortical-pooling honesty** — the WebGPU probe now requests the adapter's full storage-buffer count and surfaces a loud `corticalPoolingAvailable:false` warning instead of silently falling back to MIP/DoG while labeled "Pyramid Mongrel."
- **Release + CI hygiene** — version/tag sync guard, no-op golden-gate guard, compute-tier stamped into captures with a `--require-tier` gate, headless clean-clone-safe unit suite, pinned + provenance-recorded tessdata model.

### Mode 17 — Structural Chrome Suppression

New research mode applying **V1 length-tuning / end-stopping** (Hubel-Wiesel 1965): page-tall borders, table rules, and divider lines are recognized as long edges and quieted, while letter-scale edges survive. The length-tuning probe is wired through the saliency worker with resolution-scaled stride.

### Static stimulus foveation

Foveation is now a first-class capability over any captured image, not just live pages — the static capture path dwells to zero gaze velocity so velocity-gated foveal stabilization engages correctly (fixing every prior static golden of a cortical mode).

## Notes

- A documented ~2× units-convention gap between the shader's foveal radius and the validators' `foveaRadiusPx` is tracked for a future calibration pass; it does not affect any RC gate (baselines are frozen from real captures and thresholds tuned to actual shader output).
- ARM64, signed and notarized. Auto-update via GitHub Releases.
