# Scrutinizer v2.4.0 Release Notes

**Release Date:** 2026-03-13
**Previous:** [v2.3.0 release notes](release_notes_v2.3.0.md)

## In This Release

1. [Reading Span — Asymmetric Foveal Envelope](#reading-span--asymmetric-foveal-envelope) — Velocity-gated fovea center shift extends protection in the reading direction during horizontal pursuit over text. Based on Rayner (1998) perceptual span asymmetry.
2. [Fovea Degree Correction](#fovea-degree-correction) — fovea_deg 2.0→1.0 (1° radius = 2° diameter), default fovealRadius 90→45px. Corrects the angular-to-pixel mapping across all shader stages.
3. [Saccadic Blindness Default](#saccadic-blindness-default) — Now ON by default for all modes that support it.
4. [Wave 6: COCO-Periph Validation Scaffolding](#wave-6-coco-periph-validation-scaffolding) — System-level peripheral encoding validation against Harrington et al. 2024.
5. [Citation Export Improvements](#citation-export-improvements) — foveaDeg and pxPerDeg metadata fields in PNG captures.

---

## Reading Span — Asymmetric Foveal Envelope

Rayner (1998, 2009) showed the perceptual span during reading is asymmetric: ~1.3° left of fixation, ~5° right (for LTR). This is attentional, not acuity-driven — it reverses for RTL readers. Scrutinizer now reshapes the foveal protection zone during horizontal reading motion.

### Mechanism

The fovea center shifts in the reading direction by up to `fovea_radius × 0.7` when three gates are active:

- **Speed gate**: Horizontal velocity in pursuit range (0.05–2.5 px/ms). Saccade-speed motion and jitter are excluded.
- **Horizontality gate**: Movement must be predominantly horizontal (hSpeed / totalSpeed).
- **Text gate**: Structure map B channel under cursor must indicate text content (smoothstep 0.3–0.6).

The shift feeds into the existing `dist` calculation, so all downstream stages (LGN gating, V1 crowding, V4 chromatic decay) automatically get the asymmetric boundary without any changes to their logic.

### Configuration

| Mode | reading_span | Rationale |
|------|-------------|-----------|
| Compute Mongrel (default) | ON | Primary user-facing mode — reading comfort |
| Blueprint (presentation) | ON | Demos benefit from reading ease |
| Highkey, Biological (research) | OFF | Strict circular fovea for scientific accuracy |
| Congestion-gated (experimental) | OFF | Testing specific predictions |

Menu toggle: **Vision Model → Reading Span (Rayner)**

### Files

| File | Change |
|------|--------|
| `renderer/gaze-model.js` | Directional velocity tracking (vx/vy) with EMA smoothing |
| `renderer/shaders/peripheral.frag` | 3 uniforms + reading span gate logic in `main()` |
| `renderer/webgl-renderer.js` | Uniform plumbing, config defaults, render() params |
| `renderer/scrutinizer.js` | Pass velocity components, toggle method |
| `shared/modes.json` | Per-mode reading_span + reading_span_strength |
| `menu-template.js` | Checkbox toggle |
| `renderer/overlay.js` | IPC handler |
| `scripts/capture-reading-span.js` | 4-scenario trajectory capture with mid-sweep screenshot |

---

## Fovea Degree Correction

The `fovea_deg` constant was 2.0 (treating the radius as a diameter). Corrected to 1.0 — the foveal radius subtends ~1° of visual angle (2° diameter total). This propagates through:

- **Default fovealRadius**: 90→45px (preserving ppd at 45)
- **Shader**: All `fovea_deg` references (CMF MIP derivation, oblique effect scaling, chromatic attenuation, FOVI color decay, Bouma edge density)
- **px_per_deg derivation**: `fovea_radius / 1.0` instead of `fovea_radius / 2.0`
- **Settings migration**: `_foveaDegMigrated` flag in settings-manager halves existing user radius on first launch

### Menu Label Updates

Foveal radius options now show px/° units (e.g. "Medium (45px radius, 45 px/°)") to clarify the angular mapping.

---

## Saccadic Blindness Default

Saccadic blindness (foveal suppression during high-velocity eye movements) now defaults to ON. The previous default (OFF) meant most users never experienced the feature unless they found it in the menu.

---

## Wave 6: COCO-Periph Validation Scaffolding

Scripts and published data for system-level validation against Harrington et al. (2024) COCO-Periph benchmark:

- 50 COCO images selected by congestion quintile
- Annular patch extraction at 4 eccentricities (5°, 10°, 15°, 20°)
- SSIM, PSNR, and DFT band energy comparison against TTM reference
- `npm run wave6` runs the full pipeline

Results pending — scaffolding ships in this release, validation results in v2.5.

---

## Citation Export Improvements

PNG capture metadata now includes `foveaDeg` (angular fovea radius) and `pxPerDeg` (pixels per degree) fields, making captures self-documenting for the angular calibration used.

---

## References

- Rayner, K. (1998). Eye movements in reading and information processing: 20 years of research. *Psychological Bulletin*, 124(3), 372–422.
- Rayner, K. (2009). The 35th Sir Frederick Bartlett Lecture: Eye movements and attention in reading, scene perception, and visual search. *QJEP*, 62(8), 1457–1506.
- Harrington, C., Pepe, A., Ling, S. & Rosenholtz, R. (2024). COCO-Periph: Bridging the gap between human and machine perception with a peripheral vision benchmark. *ICLR 2024*.
