# Mode Graduation Spec

> **Created:** 2026-03-19
> **Status:** Draft — first pass
> **Trigger:** Mode 12 (FOVI Cortical Grid) graduation exposed missing process

## Problem

Scrutinizer's fidelity improves incrementally. Each major upgrade ships as a new mode, gets tested visually and scientifically, then eventually becomes the default. But "becoming the default" is currently a one-line change (`aestheticMode = 12`) that silently breaks:

- OCR baselines (calibrated against old default)
- Subband entropy baselines
- Golden capture comparisons
- Integration test screenshots
- Blog screenshots and CodePen demos
- README screenshots

Mode 12's graduation broke OCR validation (0% foveal recognition) because the OCR test inherits the global default rather than specifying its target mode.

## Design Principles

1. **Tests specify their mode explicitly.** No validation should inherit the global default. Each test declares which mode(s) it validates and what thresholds apply per mode.

2. **Graduation is a checklist, not a flag.** Changing the default is the last step, after all baselines are recalibrated and documentation is updated.

3. **Every graduation adds a toggle.** The specific upgrade that the new mode brings should be expressible as an independent pipeline toggle, not just a mode switch. This matters for:
   - **RFV practitioners** who want comfort (stability) over fidelity
   - **Researchers** who want to isolate one variable
   - **Regression testing** — toggle the upgrade off to verify the delta

4. **The previous default stays accessible.** Not just as a mode number, but with a clear label in the menu explaining what it is and when to use it.

## Graduation Checklist

### Phase 1: Candidate Validation (before touching the default)

- [ ] **Smoke tests pass** with candidate mode active
- [ ] **Unit tests pass** (mode-independent, should always pass)
- [ ] **Visual regression passes** — no new artifacts
- [ ] **Rendering validation** for the candidate mode specifically
- [ ] **Science review** — biology claims are accurate, approximations documented
- [ ] **Comparison captures** — candidate vs current default, side-by-side
- [ ] **Identify the toggle** — what's the independent pipeline parameter this mode upgrades?

### Phase 2: Baseline Migration

- [ ] **OCR baselines** — capture and calibrate thresholds for candidate mode
- [ ] **Subband entropy baselines** — recalibrate or verify pre-existing pass
- [ ] **Golden captures** — regenerate with candidate as default
- [ ] **Integration test screenshot** — verify it captures meaningfully
- [ ] **Isotropic rendering validation** — if applicable, run the full suite

### Phase 3: Documentation

- [ ] **modes.json description** — accurate for shipped implementation
- [ ] **Spec docs** — mark stale claims, update status
- [ ] **Blog post** — update or draft for the release
- [ ] **CodePen demo** — update to match current pipeline
- [ ] **README screenshots** — regenerate from golden captures
- [ ] **CHANGELOG** — entry for the graduation

### Phase 4: Ship

- [ ] **Change default** in `renderer/scrutinizer.js`
- [ ] **Update menu labels** — add "(Default)" to new, remove from old
- [ ] **Tag release** — version bump if warranted
- [ ] **Push** — after all above is verified

## Toggle Architecture

Each graduation should add a toggle to the pipeline config. The toggle controls the *specific upgrade*, not the entire mode.

### Mode 12 Example

The upgrade mode 12 brings: **sector-parameterized V1 displacement** (Bender frequency and Cutter cell size derived from cortical sector extent, rather than fixed constants).

Toggle: `v1_distortion_type` — already exists.
- Type 1: Fixed-grid Shredder (previous default behavior)
- Type 5: Sector-parameterized Shredder (mode 12's upgrade)

This is already toggleable via modes.json. What's missing is a UI-accessible toggle within a mode — the ability to say "I want all of mode 12's settings but with type 1 displacement" without creating a separate mode entry.

### Future: Pipeline Toggles as First-Class UI

The current mode system is a flat list of presets. The natural evolution:

```
Mode = preset combination of independent toggles
Toggle = one pipeline parameter with named values

Example toggles:
  V1 displacement:    [fixed-grid | sector-scaled]
  DoG bands:          [8 | 12]
  Chromatic pooling:  [off | uniform | per-band]
  CMF:                [linear | logarithmic]
  Crowding model:     [smoothstep | corticalStrength]
```

A mode is a named snapshot of toggle values. A user or researcher can override individual toggles without switching modes entirely. This is the direction the mode naming memory already points toward ("modes should evolve toward preset combinations of independent toggles").

This is future work. For now, the graduation checklist operates on modes as atomic presets.

## Test Infrastructure Changes Needed

### Make tests mode-explicit

Currently, tests like OCR capture with whatever mode is the global default:

```javascript
// BAD: inherits global default
this.aestheticMode = 12;
```

Should be:

```javascript
// GOOD: test specifies its target
const TEST_MODE = 0;  // OCR baselines calibrated for mode 0
// ...capture with explicit mode override
```

### Mode-specific baselines

```
tests/validation/
  ocr-baseline-mode0.json      # mode 0 thresholds
  ocr-baseline-mode12.json     # mode 12 thresholds (after calibration)
  subband-entropy-mode0.json
  subband-entropy-mode12.json
```

### Graduation gate script

A script that checks all Phase 1-3 items before allowing Phase 4:

```bash
node scripts/check-graduation.js --candidate 12
# Checks: baselines exist, captures generated, docs updated, toggle identified
```

This is the "measure twice" before the "cut once" of changing the default.

## History

| Date | Default | Notes |
|------|---------|-------|
| v1.0–v2.4 | Mode 0 | High-Key Ghosting (smoothstep zones) |
| v2.5.0 | Mode 10 | Compute Mongrel (texture synthesis + CMF) |
| v2.5.x | Mode 12 | FOVI Cortical Grid (sector-parameterized displacement) — graduated 2026-03-19, broke OCR |
